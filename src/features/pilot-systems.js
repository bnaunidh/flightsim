/**
 * The pilot's own switches, in the game: exterior LIGHTS, the SPEEDBRAKE /
 * spoiler lever, the thrust REVERSERS, and an ATC REQUEST menu. The rules
 * are aircraft/systems.js (pure, tested in node); the state and the effect
 * live on the aeroplane (aircraft/physics.js); this file is the keys, the
 * cards, the words and the touch buttons' answers.
 *
 *   the keys    Settings → Controls → Flying: lights (PageUp), spoilers
 *               (PageDown), reversers (End), ATC request (Insert, F8). Every
 *               letter and digit in the cockpit was spoken for (the registry
 *               in flight/input.js), so these take the navigation keys, which
 *               every full keyboard has and a Chromebook reaches with Alt or
 *               Search; a laptop without them has the cards' own buttons,
 *               the touch sheets and Settings to move them.
 *   the cards   LIGHTS (ui/hud-stack.js, informational: it folds to a chip)
 *               with a button per lamp — AUTO / ON / OFF — and the RADIO card
 *               with the four requests, the one that fits the moment first.
 *   the pills   ui/pills.js: speedbrake out, ground spoilers up, spoilers
 *               not armed on the approach, reverse thrust, lights off auto;
 *               each a button that undoes itself (the actions below).
 *   the sheets  ui/touch.js: SYSTEMS → LIGHTS, SPEEDBRAKE, RADIO; GROUND →
 *               REVERSERS, SPOILERS ARM. Each presses the action's own key.
 *   the radio   a request is answered by the field's own controller in the
 *               lines game/atc-director.js already speaks, and marks the
 *               director's once() so the automatic call does not repeat it.
 */
import { registerExtension, extLayer } from '../game/extensions.js';
import { registerActions, isKey, keyName, keyNames, bindingsVersion } from '../flight/input.js';
import { __airportServices } from './airport-services.js';
import { isOnAnyRunway } from '../world/terrain.js';
import { RUNWAY } from '../world/airport.js';
import { icon } from '../ui/icons.js';
import {
  LAMP_KINDS, LAMP_WORDS, LIGHT_PRESETS, lightPresetOf, nextLightPreset, nextSwitch, defaultLights,
  spoilerPress, reversePress, hasReversers, hasSpoilers, isRotorType, ATC_REQUESTS, suggestedRequest, atcAnswer,
} from '../aircraft/systems.js';

const AIR = ['plane', 'heli'];
registerActions({
  lights: { label: 'Exterior lights: AUTO / nav+beacon / taxi / all on / all off', group: 'Flying', ctx: AIR, default: ['PageUp'] },
  spoilers: { label: 'Speedbrake lever (in the air) / arm the ground spoilers (on the ground)', group: 'Flying', ctx: ['plane'], default: ['PageDown'] },
  reversers: { label: 'Thrust reversers: idle reverse / MAX / stow (on the ground)', group: 'Flying', ctx: ['plane'], default: ['End'] },
  /*
   * The radio: F8, and Z beside it (w17). A MacBook's F8 is Play/Pause
   * unless fn is held (the hints say "fn F8" there), and a Chromebook's F8
   * position is a system key too, so a plain letter opens it everywhere.
   * Every letter already means something in the cockpit; Z is the Meteor
   * zapper's, which only listens while a zap mode is running — and then Z
   * zaps and the radio is F8 (handleKey below). Insert stays for a full
   * keyboard. Saved keys from before move on (input.js MIGRATIONS v3).
   */
  atcRequest: { label: 'Radio: request pushback / taxi / take-off / landing', group: 'Missions & events', ctx: AIR, default: ['F8', 'KeyZ', 'Insert'] },
});

/** How long the controller takes to answer a request, seconds. */
export const REPLY_DELAY = 1.4;

const S = {
  ui: null, pending: null, replyT: 0, lastRequest: null, lastAnswer: null, shown: '', radioOpen: false,
};

function notify(sim, text, kind = 'info', seconds = 3) {
  try { sim && sim.hud && sim.hud.notify(text, kind, seconds); } catch (e) { void e; }
}
const inCockpit = (sim) => !!(sim && sim.aircraft && sim.state === 'flying' && sim.mode !== 'drive' && !sim.riding
  && !(sim.onFoot && (sim.onFoot === true || sim.onFoot.active === true)));
const spec = (sim) => (sim && sim.aircraftType) || null;
// sim.aircraftType is the types.js entry: its rotor is shape.power.rotor, which isRotorType reads.
const rotor = (sim) => isRotorType(spec(sim));

/* ------------------------------------------------------------------ *
 * The switches
 * ------------------------------------------------------------------ */

/** The lights key: the next preset for every lamp. Returns the preset. */
export function pressLights(sim) {
  const ac = sim && sim.aircraft;
  if (!ac) return null;
  if (!ac.lights) ac.lights = defaultLights();
  const p = nextLightPreset(ac.lights);
  Object.assign(ac.lights, p.set);
  notify(sim, p.words, 'info', 2.2);
  if (S.ui) {
    syncLights(sim, true);
    pokeCard(sim, S.ui.lights);
  }
  return p;
}

/** One lamp's own switch, cycled (the lights card's buttons). */
export function cycleLamp(sim, kind) {
  const ac = sim && sim.aircraft;
  if (!ac || !LAMP_KINDS.includes(kind)) return null;
  if (!ac.lights) ac.lights = defaultLights();
  ac.lights[kind] = nextSwitch(ac.lights[kind]);
  notify(sim, `${LAMP_WORDS[kind]}: ${ac.lights[kind].toUpperCase()}`, 'info', 1.6);
  syncLights(sim, true);
  return ac.lights[kind];
}

/** The spoiler lever. Returns the rule's result (null when this aeroplane has none). */
export function pressSpoilers(sim) {
  const ac = sim && sim.aircraft;
  if (!ac) return null;
  if (!hasSpoilers(spec(sim))) {
    notify(sim, rotor(sim) ? 'A helicopter has no spoilers' : 'This aeroplane has no spoilers or speedbrake', 'info', 2);
    return null;
  }
  const r = spoilerPress({ onGround: !!ac.onGround, groundSpeed: ac.groundSpeed || 0, lever: ac.speedbrake || 0, armed: ac.spoilersArmed !== false });
  ac.speedbrake = r.lever;
  ac.spoilersArmed = r.armed;
  notify(sim, r.note, r.kind, 2.2);
  return r;
}

/** The reverser lever. Returns the rule's result. */
export function pressReversers(sim) {
  const ac = sim && sim.aircraft;
  if (!ac) return null;
  const r = reversePress({ onGround: !!ac.onGround, reverse: ac.reverse || 0, hasReversers: hasReversers(spec(sim)), groundSpeed: ac.groundSpeed || 0 });
  if (!r.refused) ac.reverse = r.reverse;
  notify(sim, r.note, r.kind, 2.2);
  return r;
}

/* ------------------------------------------------------------------ *
 * The radio
 * ------------------------------------------------------------------ */

/** Where the aeroplane is, for the controller's answer and the menu's suggestion. */
export function radioContext(sim) {
  const ac = sim.aircraft;
  const d = sim.atc;
  const svc = __airportServices && __airportServices.S;
  const onGround = !!ac.onGround;
  const onRunway = onGround && !!(ac.pos && isOnAnyRunway(ac.pos.x, ac.pos.z, 12));
  const lined = onRunway && Math.abs(((ac.heading - RUNWAY.headingDeg + 540) % 360) - 180) < 25;
  const onStand = onGround && !!svc && (svc.state === 'onStand' || svc.state === 'serviced');
  const w = sim.weather;
  let wind = null;
  if (w && Number.isFinite(w.windDirDeg)) {
    const dir = String(Math.round(w.windDirDeg / 10) * 10).padStart(3, '0').split('').join(' ');
    wind = `wind ${dir} at ${Math.round(w.windSpeedKts || 0)}`;
  }
  const pref = svc && svc.pushPref;
  return {
    callsign: d ? d.callsign : null, field: d ? d.field : null, runway: d ? d.runwayCall : null, wind,
    onGround, onStand, onRunway, lined, airborne: !onGround,
    side: pref === 'noseLeft' ? 'left' : pref === 'noseRight' ? 'right' : null,
  };
}

/**
 * Make a request. The player's call goes up as a note at once; the
 * controller answers after REPLY_DELAY (through the director, so the
 * cooldown and the subtitle are the radio's own). Returns the answer.
 */
export function request(sim, id) {
  if (!inCockpit(sim) || !sim.atc) return null;
  const req = ATC_REQUESTS.find((r) => r.id === id);
  if (!req) return null;
  const ctx = radioContext(sim);
  const ans = atcAnswer(id, ctx);
  const field = ctx.field || 'Kestrel';
  const who = id === 'landing' || id === 'takeoff' ? `${field} Tower` : `${field} Ground`;
  notify(sim, `You: "${who}, ${ctx.callsign || 'Skylark 172'}, ${req.words}."`, 'info', REPLY_DELAY + 1.2);
  S.pending = ans;
  S.replyT = REPLY_DELAY;
  S.lastRequest = id;
  S.lastAnswer = ans;
  closeRadio();
  return ans;
}

function deliver(sim) {
  const ans = S.pending;
  S.pending = null;
  const d = sim && sim.atc;
  // A crash, the menu or a walk away between the call and the answer: the
  // controller does not clear a wreck to land.
  if (!ans || !d || !inCockpit(sim) || (sim.aircraft && sim.aircraft.crashed)) return;
  d.cool = 0;
  d.say(ans.text, ans.voice);
  if (ans.mark) d.said[ans.mark] = true;
}

/** Is this key the Meteor zapper's right now (a zap mode running, Z on both)? Then it zaps, and the radio leaves it. */
function zapperHas(sim, code) {
  const m = sim && sim.meteors;
  return !!(m && m.zapping && isKey(sim, 'zap', code));
}

/**
 * The radio's keys as a hint names them: "F8 or Z" ("fn F8 or Z" on a Mac),
 * the first two, without Insert on a Mac (it has none) and without the
 * zapper's key while it is zapping.
 */
export function radioKeyName(sim) {
  const names = keyNames('atcRequest', sim, (c) => !zapperHas(sim, c));
  return names.length ? names.slice(0, 2).join(' or ') : '—';
}

/** The ATC key: open the menu; pressed again while it is open, send the request that fits the moment. */
export function pressRadio(sim) {
  if (!inCockpit(sim)) return null;
  if (S.radioOpen) {
    const id = suggestedRequest(radioContext(sim));
    return request(sim, id);
  }
  openRadio(sim);
  return 'open';
}

function openRadio(sim) {
  buildUi(sim);
  if (!S.ui) return;
  S.radioOpen = true;
  syncRadio(sim, true);
  // `keep`: a card of answers to tap, like an event's, is never held back
  // off screen. On a landscape phone the column had no room for it at all
  // (Z or the RADIO button opened it, invisibly); now the minimap steps
  // aside for it there (ui/hud-stack.js yieldMap).
  joinStack(sim, S.ui.radio, { prio: 1.3, id: 'radio', chip: false, keep: true });
  S.ui.radio.classList.add('is-shown');
}

function closeRadio() {
  S.radioOpen = false;
  if (S.ui) S.ui.radio.classList.remove('is-shown');
}

/* ------------------------------------------------------------------ *
 * The cards
 * ------------------------------------------------------------------ */

const CSS = `
.ps-card { width: 168px; padding: 8px 10px 9px; border-radius: 14px; background: rgba(12,20,34,.8);
  border: 1px solid var(--panel-line, rgba(140,180,230,.18)); color: var(--text, #eaf1fb);
  font: 600 12px/1.25 var(--font, system-ui, sans-serif); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  display: none; user-select: none; pointer-events: auto; }
.ps-card.is-shown { display: block; }
.ps-head { display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-bottom: 6px; }
.ps-head span { color: var(--text-dim, #9fb2cc); font-size: 10.5px; letter-spacing: .08em; display: inline-flex; align-items: center; gap: 5px; }
.ps-head .icon { width: 14px; height: 14px; }
.ps-head b { font-size: 10px; letter-spacing: .06em; padding: 1px 6px; border-radius: 6px; background: rgba(255,255,255,.08); color: #c9d4e2; }
.ps-head b.is-on { background: rgba(88,198,255,.16); color: #bfe6ff; }
.ps-close { border: 0; background: transparent; color: var(--text-dim, #9fb2cc); padding: 2px; cursor: pointer; display: inline-flex; }
.ps-close .icon { width: 14px; height: 14px; }
.ps-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.ps-btn { pointer-events: auto; display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 6px 8px; border-radius: 9px;
  border: 1px solid rgba(140,180,230,.3); background: rgba(255,255,255,.05); color: inherit; cursor: pointer; text-align: left;
  font: 700 10.5px/1.15 var(--font, system-ui, sans-serif); letter-spacing: .03em; touch-action: manipulation; min-height: 40px; }
.ps-btn small { font-size: 9.5px; font-weight: 600; opacity: .72; letter-spacing: 0; }
.ps-btn.is-on { background: rgba(88,198,255,.2); border-color: rgba(124,199,255,.75); }
.ps-btn.is-off { opacity: .55; }
.ps-btn.is-pick { border-color: var(--accent-2, #7ee8b2); box-shadow: inset 0 0 0 1px rgba(126,232,178,.5); }
.ps-btn.is-wide { grid-column: 1 / -1; }
.ps-note { margin-top: 6px; font-size: 10px; color: var(--text-dim, #9fb2cc); }
.hud-rstack > .ps-card:not(.is-shown) { display: none !important; }
@media (max-width: 700px) { .ps-card { width: 150px; } }
/* An upright phone's column is ~156 px: PUSHBACK and TAXI side by side needed
   157 px of the card's 134 and ran 12 px past it, off the edge of a 375 px
   screen. One request a row there. */
@media (max-width: 440px) { .ps-radio .ps-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-height: 560px) { .ps-card { padding: 6px 8px 7px; } .ps-card .ps-note { display: none; } }
`;

function joinStack(sim, panel, opts) {
  const stack = sim && sim.hud && sim.hud.stack;
  if (!panel || !stack || typeof stack.add !== 'function' || !stack.el) return false;
  if (panel.parentNode !== stack.el) stack.add(panel, opts);
  return true;
}
function pokeCard(sim, panel) {
  const stack = sim && sim.hud && sim.hud.stack;
  if (stack && typeof stack.poke === 'function') {
    try { stack.poke(panel, 6); } catch (e) { void e; }
  }
}

function buildUi(sim) {
  if (S.ui || typeof document === 'undefined') return S.ui;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const lights = document.createElement('div');
  lights.className = 'ps-card ps-lights';
  lights.innerHTML = `<div class="ps-head"><span>${icon('plane', 14)} LIGHTS</span><b class="ps-preset">AUTO</b></div>
    <div class="ps-grid">${LAMP_KINDS.map((k) => `<button class="ps-btn${k === 'taxi' ? ' is-wide' : ''}" type="button" data-lamp="${k}" aria-label="${LAMP_WORDS[k]}">${LAMP_WORDS[k].toUpperCase()}<small>AUTO</small></button>`).join('')}</div>
    <div class="ps-note"><span class="ps-lkey"></span> cycles every lamp · tap one to set it</div>`;
  for (const b of lights.querySelectorAll('[data-lamp]')) {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      b.blur();
      if (inCockpit(sim)) cycleLamp(sim, b.dataset.lamp);
    });
  }

  const radio = document.createElement('div');
  radio.className = 'ps-card ps-radio';
  radio.innerHTML = `<div class="ps-head"><span>${icon('radio', 14)} RADIO</span><button class="ps-close" type="button" aria-label="Close the radio menu">${icon('close', 14)}</button></div>
    <div class="ps-grid">${ATC_REQUESTS.map((r) => `<button class="ps-btn" type="button" data-atc="${r.id}">${r.label.toUpperCase()}<small>${r.words}</small></button>`).join('')}</div>
    <div class="ps-note"><span class="ps-rkey"></span> again sends the one that fits</div>`;
  radio.querySelector('.ps-close').addEventListener('click', (e) => {
    e.preventDefault();
    closeRadio();
  });
  for (const b of radio.querySelectorAll('[data-atc]')) {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      b.blur();
      request(sim, b.dataset.atc);
    });
  }
  extLayer().appendChild(lights);
  extLayer().appendChild(radio);
  S.ui = {
    lights, radio, preset: lights.querySelector('.ps-preset'), lkey: lights.querySelector('.ps-lkey'), rkey: radio.querySelector('.ps-rkey'),
    lamps: Object.fromEntries(LAMP_KINDS.map((k) => [k, lights.querySelector(`[data-lamp="${k}"]`)])),
    picks: Object.fromEntries(ATC_REQUESTS.map((r) => [r.id, radio.querySelector(`[data-atc="${r.id}"]`)])),
    touch: !!(sim && sim.touch) || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches),
    keysVer: -1, lightsShown: false,
  };
  return S.ui;
}

function syncKeys(sim) {
  const ui = S.ui;
  const ver = `${bindingsVersion()}|${sim && sim.meteors && sim.meteors.zapping ? 1 : 0}`;
  if (!ui || ui.keysVer === ver) return;
  ui.keysVer = ver;
  ui.lkey.textContent = ui.touch ? 'LIGHTS on the sheet' : keyName('lights', sim);
  ui.rkey.textContent = ui.touch ? 'RADIO on the sheet' : radioKeyName(sim);
}

function syncLights(sim, force = false) {
  const ui = S.ui;
  const ac = sim && sim.aircraft;
  if (!ui || !ac) return;
  const L = ac.lights || defaultLights();
  const p = lightPresetOf(L);
  const key = LAMP_KINDS.map((k) => L[k]).join() + (p ? p.id : 'mixed');
  if (!force && key === S.shown) return;
  S.shown = key;
  ui.preset.textContent = p ? p.label : 'SET BY HAND';
  ui.preset.classList.toggle('is-on', !p || p.id !== 'auto');
  for (const k of LAMP_KINDS) {
    const b = ui.lamps[k];
    const s = L[k] || 'auto';
    b.lastElementChild.textContent = s.toUpperCase();
    b.classList.toggle('is-on', s === 'on');
    b.classList.toggle('is-off', s === 'off');
  }
}

function syncRadio(sim, force = false) {
  const ui = S.ui;
  if (!ui || !S.radioOpen) return;
  const ctx = radioContext(sim);
  const pick = suggestedRequest(ctx);
  if (!force && ui.pick === pick) return;
  ui.pick = pick;
  for (const id in ui.picks) ui.picks[id].classList.toggle('is-pick', id === pick);
}

function updateUi(sim) {
  const ui = S.ui;
  if (!ui) return;
  const on = inCockpit(sim) && !(sim.hud && (sim.hud.enabled === false || sim.hud.hidden));
  // The lights card joins the column once a lamp is off auto, and stays
  // (folded to a chip by the stack) for the rest of the flight.
  const ac = sim.aircraft;
  const p = ac ? lightPresetOf(ac.lights) : LIGHT_PRESETS[0];
  const wantLights = on && (!p || p.id !== 'auto' || ui.lightsShown);
  if (wantLights && !ui.lightsShown) {
    ui.lightsShown = true;
    joinStack(sim, ui.lights, { prio: 3.5, id: 'lights', info: true });
  }
  const showLights = wantLights && ui.lightsShown;
  if (ui.lights.classList.contains('is-shown') !== showLights) ui.lights.classList.toggle('is-shown', showLights);
  if (!on && S.radioOpen) closeRadio();
  if (!on) return;
  syncKeys(sim);
  syncLights(sim);
  syncRadio(sim);
}

function off() {
  S.pending = null;
  S.replyT = 0;
  S.shown = '';
  closeRadio();
  if (S.ui) {
    S.ui.lightsShown = false;
    S.ui.lights.classList.remove('is-shown');
  }
}

/* ------------------------------------------------------------------ *
 * The pills' and the sheets' actions (main.js hudAction → extHudAction)
 * ------------------------------------------------------------------ */

/** An action from a pill or a sheet that is not a key of its own. True when it was ours. */
export function hudAction(sim, a) {
  const ac = sim && sim.aircraft;
  switch (a) {
    case 'lightsAuto':
      if (ac) {
        Object.assign(ac.lights || (ac.lights = defaultLights()), LIGHT_PRESETS[0].set);
        notify(sim, LIGHT_PRESETS[0].words, 'info', 1.8);
        syncLights(sim, true);
      }
      return true;
    case 'speedbrakeIn':
      if (ac) {
        ac.speedbrake = 0;
        notify(sim, 'Speedbrake in', 'info', 1.6);
      }
      return true;
    case 'spoilersDown':
      if (ac) {
        ac.speedbrake = 0;
        ac.spoilersArmed = false;
        notify(sim, 'Ground spoilers down and disarmed', 'info', 1.8);
      }
      return true;
    case 'spoilersArm':
      if (ac) {
        ac.spoilersArmed = true;
        notify(sim, 'Ground spoilers ARMED', 'info', 1.8);
      }
      return true;
    case 'reverseStow':
      if (ac) {
        ac.reverse = 0;
        notify(sim, 'Reversers stowed', 'info', 1.6);
      }
      return true;
    case 'atcRequest':
      pressRadio(sim);
      return true;
    default:
      return false;
  }
}

/** What the touch sheets show for our buttons (main.js touchState). */
export function touchState(sim) {
  const ac = sim && sim.aircraft;
  const p = ac ? lightPresetOf(ac.lights) : LIGHT_PRESETS[0];
  return {
    lights: p ? p.label : 'SET BY HAND',
    lightsAuto: !!p && p.id === 'auto',
    speedbrake: ac ? ac.speedbrake || 0 : 0,
    spoilersArmed: !!ac && ac.spoilersArmed !== false,
    spoilerPos: ac ? ac.spoilerPos || 0 : 0,
    reverse: ac ? ac.reverse || 0 : 0,
    hasReversers: hasReversers(spec(sim)),
    hasSpoilers: hasSpoilers(spec(sim)),
    radioOpen: S.radioOpen,
  };
}

/** The keys (the extension's key hook). True when the key was ours. */
export function handleKey(sim, code, down, e) {
  if (!inCockpit(sim)) return false;
  const repeat = !!(e && e.repeat);
  if (isKey(sim, 'lights', code)) {
    if (down && !repeat) pressLights(sim);
    return true;
  }
  if (isKey(sim, 'atcRequest', code) && !zapperHas(sim, code)) {
    if (down && !repeat) pressRadio(sim);
    return true;
  }
  if (rotor(sim)) return false;
  if (isKey(sim, 'spoilers', code)) {
    if (down && !repeat) pressSpoilers(sim);
    return true;
  }
  if (isKey(sim, 'reversers', code)) {
    if (down && !repeat) pressReversers(sim);
    return true;
  }
  return false;
}

registerExtension({
  id: 'pilot-systems',
  install(sim) {
    buildUi(sim);
  },
  startMode() {
    off();
  },
  stop() {
    off();
  },
  update(sim, dt) {
    if (S.pending) {
      S.replyT -= dt;
      if (S.replyT <= 0) deliver(sim);
    }
    if (!S.ui) {
      if (S.pending) return;
      buildUi(sim);
      if (!S.ui) return;
    }
    updateUi(sim);
  },
  key(sim, code, down, e) {
    return handleKey(sim, code, down, e);
  },
  hudAction(sim, a) {
    return hudAction(sim, a);
  },
  touchState(sim) {
    return touchState(sim);
  },
  devActions: [
    {
      label: 'Landing roll: spoilers up, MAX reverse',
      hint: 'A 737 rolling on the Kestrel strip with the ground spoilers up and the reversers at MAX',
      async run(sim) {
        await sim.startMode('free', { aircraft: 'b737', time: 'day', condition: 'clear', windSpeedKts: 0 });
        const ac = sim.aircraft;
        if (!ac) return;
        ac.parkingBrake = false;
        ac.vel.set(0, 0, -60).applyQuaternion(ac.quat);
        ac.reverse = 1;
      },
    },
  ],
});

/** For the browser check and the console. */
export function systemsState() {
  return {
    radioOpen: S.radioOpen, pending: !!S.pending, lastRequest: S.lastRequest, lastAnswer: S.lastAnswer,
    lightsCard: !!(S.ui && S.ui.lights.classList.contains('is-shown')),
    radioCard: !!(S.ui && S.ui.radio.classList.contains('is-shown')),
    preset: S.ui ? S.ui.preset.textContent : null,
  };
}
