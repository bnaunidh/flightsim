/**
 * The airport, working for you.
 *
 * Taxi onto a stand and the docking board on the terminal talks you in — the
 * metres left, an arrow if you are off the line, STOP. Stop there and the jet
 * bridge swings out to your door. Press Y (or tap the prompt) and the ground
 * crew drives out from behind the terminal: stairs to the back door, the
 * catering truck lifting its box to the galley, the belt loader and the
 * baggage train, the fuel bowser (which really does fill your tanks), a power
 * cart under the nose, a tug on your nose leg. Press Y again and the tug
 * pushes you back off the stand and swings you round onto the apron, facing
 * the start of the runway the tower gives you (09). Y (or a tap)
 * during the push stops it where it is. Then it is yours to taxi.
 *
 * Also: every bridge on the field docks to anything parked on its stand —
 * you, or the traffic — and swings back when it leaves; and hangar doors
 * slide open for anything on the ground nearby, so you can taxi into one.
 *
 * Everything the player sees is on-screen text, plus the tower's radio call
 * through sim.speak(), which honours the voice setting. No voice is assumed.
 *
 * KEY: Y, and only while you are stopped on a stand, being serviced or being
 * pushed — anywhere else the key is left alone for whoever else wants it. The
 * prompt itself is a button while it offers something, because half the class
 * is on an iPad with no Y to press. It is only on screen, and only tappable,
 * while the game is actually flying with its interface showing: paused, in a
 * menu, at the debrief or with the HUD hidden (U) it is out of the way.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension, extLayer, extStatus } from '../game/extensions.js';
import { airportLayout, standAt, standApproach, standTaken, standFits, pavedIn, NOSE_STOP } from '../world/airport-layout.js';
import { estimateInfo } from '../world/apron.js';
import { measureModel, yawOf } from '../world/airport-kit.js';
import { TUG_BAR_TIP } from '../world/airport-vehicles.js';
import * as Physics from '../aircraft/physics.js';
import { AIRPORT, isOnAnyRunway } from '../world/terrain.js';

const D2R = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();

/*
 * How fast a tug pushes, m/s. It was 1.4, walking pace, which is honest and
 * made the push off a San Francisco stand 94 m and 75 s of watching a wall.
 * 2.2 is the 8 km/h a tug really does once it is rolling.
 */
const PUSH_SPEED = 2.2;
/** Radius of the swing off the stand, metres. */
const PUSH_RADIUS = 24;
/** Faster than this over the ground and nobody is docking anything. */
const DOCK_SPEED = 12;

const S = {
  sim: null,
  state: 'idle', // idle | onStand | calling | serviced | pushback | pushed
  stand: null,
  info: null,
  apron: null,
  t: 0,
  scan: 0,
  push: null,
  prompt: null,
  // True while the prompt is kept off screen (paused, a menu, HUD hidden).
  away: false,
  said: '',
  action: null,
  promptKey: -1,
  measured: new Map(),
  // What keeps the prompt out of the way while update() is not running.
  watch: 0,
  observer: null,
  // Set once the game has switched this feature off: the prompt is gone.
  retired: false,
  fuelFrom: 0,
  crewUsed: false,
  dock: { stand: null, toGo: 0, lateral: 0 },
  // Stands with somebody else's aeroplane on them, from the last scan, and
  // which aeroplane (for the pushback's clearance).
  busy: new Set(),
  busyBy: new Map(),
  reading: { toGo: 0, lateral: 0, speed: 0, name: '' },
};

function reset(sim) {
  if (sim && sim.apron && sim.apron.dismissCrew) sim.apron.dismissCrew();
  if (sim && sim.apron && sim.apron.showDocking) sim.apron.showDocking(null);
  S.state = 'idle';
  S.stand = null;
  S.push = null;
  S.apron = null;
  S.t = 0;
  S.promptKey = -1;
  setPrompt('');
}

/* ------------------------------------------------------------------ */
/* On screen                                                           */
/* ------------------------------------------------------------------ */

function ensurePrompt() {
  if (S.prompt) return S.prompt;
  if (typeof document === 'undefined' || !document.head) return null;
  const style = document.createElement('style');
  /*
   * Above the coach line (bottom 224 px) and the radio subtitle (118), which
   * is where the eye already is on the ground; on a narrow screen those two
   * move to the top, and so does this, below them.
   */
  style.textContent = `
    .ap-prompt {
      position: absolute; left: 50%; bottom: 276px; transform: translateX(-50%);
      background: rgba(14, 22, 30, 0.84); color: #f4f7fa;
      font: 600 15px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif;
      padding: 10px 16px; border-radius: 12px;
      /*
       * max-content, or it shrinks to the half of the screen right of its
       * left edge: at 390 px wide it was 195 px and four lines tall.
       */
      width: max-content; max-width: min(520px, 86vw); box-sizing: border-box;
      text-align: center; border: 1px solid rgba(255, 210, 90, 0.55);
      box-shadow: 0 6px 22px rgba(0, 0, 0, 0.35); pointer-events: none;
      transition: opacity 0.25s; opacity: 0; user-select: none; -webkit-user-select: none;
    }
    .ap-prompt.on { opacity: 1; }
    .ap-prompt.act { pointer-events: auto; cursor: pointer; border-color: #f2c53d; }
    .ap-prompt.act:active { transform: translateX(-50%) scale(0.97); }
    .ap-prompt.away, .ap-prompt.act.away { visibility: hidden; pointer-events: none; }
    .ap-prompt b { color: #ffd166; }
    .ap-prompt .stop { color: #ff5a4a; font-weight: 800; letter-spacing: 0.06em; }
    .ap-prompt kbd {
      display: inline-block; min-width: 1.4em; padding: 1px 6px; margin: 0 2px;
      border-radius: 6px; background: #f2c53d; color: #1a1d20; font-weight: 800;
    }
    @media (max-width: 620px) {
      .ap-prompt { bottom: auto; top: 160px; font-size: 13px; }
    }`;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.className = 'ap-prompt';
  el.setAttribute('role', 'status');
  /*
   * A tap is the same as Y. pointerdown rather than click so it answers at
   * once on a touch screen, and stopped here so the game underneath never
   * sees it — the flight controls must not also get a press.
   */
  el.addEventListener('pointerdown', (ev) => {
    /*
     * Only while flying. The layer this sits in is above the menus, and a
     * tap on the prompt over the pause screen used to call the crew with the
     * game paused (measured: onStand -> calling, sim.state still 'paused').
     */
    if (!S.action || !promptAllowed(S.sim) || !stillLive()) return;
    ev.preventDefault();
    ev.stopPropagation();
    const fn = S.action;
    fn();
  });
  extLayer().appendChild(el);
  S.prompt = el;
  S.away = false;
  syncPromptVisibility();
  return el;
}

/**
 * May the prompt be on screen? Only while the game is flying with its
 * interface up. The feature layer sits above the menus (z-index 30 against
 * 10), so the prompt left showing at pause stood opaque over the pause
 * screen's autopilot card at 1024x768 and took its taps; nothing hid it,
 * because update() does not run while paused.
 */
function promptAllowed(sim) {
  if (!sim || sim.state !== 'flying') return false;
  const hud = sim.hud;
  if (hud && (hud.hidden || hud.enabled === false)) return false;
  if (sim.menus && sim.menus.current) return false;
  return true;
}

/** Hide or show the prompt to match promptAllowed(). No-op when unchanged. */
function syncPromptVisibility() {
  const el = S.prompt;
  if (!el) return;
  const away = !promptAllowed(S.sim);
  if (away === S.away) return;
  S.away = away;
  el.classList.toggle('away', away);
}

/**
 * Is this feature still switched on? A hook that throws gets it switched off
 * for the session, and then nothing calls update() or key() again — but the
 * prompt would still be on screen, and a tap on it would still call a crew
 * that nothing is driving any more.
 */
function stillLive() {
  if (S.retired) return false;
  const me = extStatus().find((e) => e.id === 'airport');
  return !me || me.live;
}

/** Take the prompt down for good, and stop watching. */
function retire() {
  S.retired = true;
  S.action = null;
  if (S.watch) clearInterval(S.watch);
  S.watch = 0;
  if (S.observer) S.observer.disconnect();
  S.observer = null;
  if (S.prompt && S.prompt.parentNode) S.prompt.parentNode.removeChild(S.prompt);
}

/**
 * The watcher, for while update() is not running. Its own try/catch: it runs
 * from a timer and an observer, outside the fence extensions.js puts round
 * every hook, so a throw here would repeat four times a second for ever.
 */
function watchPrompt() {
  try {
    if (S.retired) return;
    if (!stillLive()) {
      retire();
      return;
    }
    syncPromptVisibility();
  } catch (e) {
    console.error('[ext] "airport" prompt watcher failed; the prompt is off for this session:', e);
    try {
      retire();
    } catch (e2) {
      /* nothing more to do */
    }
  }
}

/**
 * Hide the prompt the moment the pause screen, a menu or the debrief opens,
 * or the interface is hidden (U): each of those changes one attribute, on the
 * menu layer or on the HUD's wrapper, and an observer hears it before the
 * next frame is drawn. A quarter-second timer backs it up for anything that
 * stops the game without touching either.
 */
function watchForMenus(sim) {
  if (S.watch || S.retired) return;
  if (typeof setInterval === 'function') S.watch = setInterval(watchPrompt, 250);
  if (typeof MutationObserver !== 'function' || !sim) return;
  const obs = new MutationObserver(watchPrompt);
  const layer = sim.menus && sim.menus.layer;
  const wrap = sim.hud && sim.hud.wrap;
  if (layer && layer.nodeType === 1) obs.observe(layer, { attributes: true, attributeFilter: ['hidden'] });
  if (wrap && wrap.nodeType === 1) obs.observe(wrap, { attributes: true, attributeFilter: ['style'] });
  S.observer = obs;
}

/** Show `html`; `action`, if given, is what a tap on it does. */
function setPrompt(html, action = null) {
  S.action = html ? action : null;
  if (S.retired) return;
  const el = ensurePrompt();
  if (el) el.classList.toggle('act', !!S.action);
  if (S.said === html) return;
  S.said = html;
  if (!el) return;
  if (html) el.innerHTML = html;
  el.classList.toggle('on', !!html);
}

function say(sim, text, kind = 'info', seconds = 4) {
  if (sim.hud && sim.hud.notify) sim.hud.notify(text, kind, seconds);
}

function radio(sim, text) {
  if (typeof sim.speak === 'function') sim.speak(text, 'ground', 0);
}

/* ------------------------------------------------------------------ */
/* Your aeroplane                                                      */
/* ------------------------------------------------------------------ */

function typeOf(sim) {
  const t = sim.aircraftType;
  if (t && t.id) return t;
  const id = sim.settings && sim.settings.aircraft;
  return id ? { id, name: id } : null;
}

/** Doors, sills and the nose leg of the aeroplane you are flying. */
function playerInfo(sim) {
  const type = typeOf(sim);
  const id = type && type.id;
  if (!id) return null;
  if (S.measured.has(id)) return S.measured.get(id);
  let info = null;
  try {
    if (sim.model) {
      const m = measureModel(sim.model);
      const base = estimateInfo(id);
      if (base) {
        // The measured body and wing, the roster's wheels.
        const b = m.body;
        info = {
          ...base,
          hw: b.halfWidth,
          yc: b.centreY,
          noseZ: m.box.min.z,
          tailZ: m.box.max.z,
          frontDoorZ: b.front + Math.min(1.5, (b.rear - b.front) * 0.08),
          rearDoorZ: b.rear - Math.min(1.8, (b.rear - b.front) * 0.08),
          holdZ: b.front + (b.rear - b.front) * 0.3,
          sill: b.centreY - 0.3 * b.halfWidth,
          holdSill: b.centreY - 0.8 * b.halfWidth,
          halfSpan: m.halfSpan,
          wingTipZ: m.wingTipZ,
          wingLE: m.wingLE,
        };
      }
    }
  } catch (e) {
    info = null;
  }
  if (!info) info = estimateInfo(id);
  if (info) S.measured.set(id, info);
  return info;
}

/** The stand you are stopped on, facing into, or null. */
function standUnder(sim) {
  const ac = sim.aircraft;
  if (!ac || !ac.onGround || ac.crashed) return null;
  // No crew to offer (the air base keeps its own).
  if (!sim.apron || !sim.apron.spare) return null;
  const st = standAt(ac.pos.x, ac.pos.z, 3);
  if (!st || standTaken(st) || S.busy.has(st)) return null;
  const dh = Math.abs((((ac.heading || 0) - st.headingDeg + 540) % 360) - 180);
  return dh < 35 ? st : null;
}

function groundSpeed(ac) {
  return Math.hypot(ac.vel.x, ac.vel.z);
}

function stopped(sim) {
  const ac = sim.aircraft;
  return !!(ac && ac.onGround && !ac.crashed && groundSpeed(ac) < 0.6);
}

/* ------------------------------------------------------------------ */
/* Docking                                                             */
/* ------------------------------------------------------------------ */

/**
 * Where your nose is against the stand you are rolling onto, or null.
 * Allocation-free: it runs every frame you are on the ground.
 */
function dockReading(sim) {
  const ac = sim.aircraft;
  if (!ac || !ac.onGround || ac.crashed) return null;
  if (groundSpeed(ac) > DOCK_SPEED) return null;
  const info = S.measured.get((typeOf(sim) || {}).id) || null;
  const h = (ac.heading || 0) * D2R;
  // The model's nose is at z = noseZ (negative is forward); a guess of 3 m
  // until the aeroplane has been measured, which happens the first time it
  // stops anywhere near a stand.
  const reach = info ? -info.noseZ : 3;
  const nx = ac.pos.x + Math.sin(h) * reach;
  const nz = ac.pos.z - Math.cos(h) * reach;
  const d = standApproach(nx, nz, ac.heading || 0, S.dock);
  /*
   * Not onto a stand that is taken — the airport's own aeroplane, or the
   * traffic's. The board there would have counted you down into the tail
   * of whatever was parked on it.
   */
  if (d && (standTaken(d.stand) || S.busy.has(d.stand))) return null;
  return d;
}

/**
 * The words under the board, or null when they would be the same as now.
 * Everything they say is folded into one number first, so a frame where
 * nothing changed builds no string.
 */
function dockPrompt(d) {
  const n = d.stand.number;
  const state = d.toGo < -0.8 ? 4 : d.toGo <= 0.6 ? 3 : 1;
  const dm = d.toGo < 3 ? Math.max(0, Math.round(d.toGo * 10)) : 100 + Math.min(899, Math.round(d.toGo));
  const side = d.lateral > 1.5 ? 1 : d.lateral < -1.5 ? 2 : 0;
  const key = state === 1 ? 1e7 + side * 1e6 + n * 1000 + dm : state * 1e4 + n;
  if (S.promptKey === key) return null;
  S.promptKey = key;
  if (state === 4) return `Stand ${n} — <b>too far!</b> Stop, and the tug can push you back`;
  if (state === 3) return `Stand ${n} — <span class="stop">STOP</span>`;
  const dist = d.toGo < 3 ? d.toGo.toFixed(1) : String(Math.round(d.toGo));
  const steer = side === 1 ? ' · steer <b>left</b>' : side === 2 ? ' · steer <b>right</b>' : '';
  return `Stand ${n}: <b>${dist} m</b> to the stop${steer}`;
}

/* ------------------------------------------------------------------ */
/* Pushback                                                            */
/* ------------------------------------------------------------------ */

/**
 * Which way to face after the push: towards the start of the runway the
 * ground controller gives you. That is the map's own runway, whatever the
 * wind — atc-director.js reads it from AIRPORT.headingDeg, which is 90 on
 * all 32 maps, so "runway zero nine", and so do the free-flight brief ("Take
 * off from runway 09") and the start position. Runway 09 is flown eastbound,
 * so you taxi west to its start.
 *
 * For a while this picked runway 27 when the wind gave 09 a tailwind. San
 * Francisco's own weather is 16 kt from 290: its ground controller said
 * "runway zero nine, taxi and hold" while the pushback said "taxi east to
 * runway 27" — two instructions a ten-year-old cannot both follow. The
 * airfield follows the tower.
 */
function departureHeading() {
  const rwy = (AIRPORT && AIRPORT.headingDeg) || 90;
  return (((rwy + 180) % 360) + 360) % 360;
}

/** "zero nine" for "09", the way the tower's own calls read it out. */
const SPOKEN = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
function spoken(name) {
  return String(name)
    .split('')
    .map((d) => SPOKEN[Number(d)] || d)
    .join(' ');
}

/** "09" for the map's runway, the way the tower and the brief write it. */
function runwayName() {
  const rwy = (AIRPORT && AIRPORT.headingDeg) || 90;
  const n = Math.round((((rwy % 360) + 360) % 360) / 10) || 36;
  return String(n).padStart(2, '0');
}

/** East, west, north or south for a heading. */
function compassWord(h) {
  const a = ((h % 360) + 360) % 360;
  return a >= 45 && a < 135 ? 'east' : a >= 135 && a < 225 ? 'south' : a >= 225 && a < 315 ? 'west' : 'north';
}

/**
 * Straight back off the stand, then a quarter turn, so the aeroplane ends up
 * across the field facing the start of the runway (above). Worked out for
 * the aeroplane's position (its centre), which is what the physics moves.
 *
 * Where the turn is made is chosen, not fixed. It was always the apron's taxi
 * lane, 14 m in from its runway edge — but that line runs through the stands
 * themselves wherever they are deep (medium and heavy stands reach to 2 m
 * from the apron edge), and the traffic parks in the middle of a stand's box,
 * further out than the airport's own nose-in aeroplanes. Measured with the
 * node check, the traffic parked on every free stand: 12 pushes in 627, one
 * on each of twelve of the thirteen strip fields, swung a Skylark's wing
 * into the Meridian on the stand next door; and 15 more had no room to turn
 * towards the runway at all and went the wrong way round. So: the apron lane
 * if the push is clear there, else further back, 4 m at a time, as far as
 * the parallel taxiway's centre line — a push onto the taxiway, which is
 * what a small airport does (27 in 627 now). The start of the runway way
 * round first; the other way only when that way is not clear anywhere (none
 * now). Clear means the whole swing keeps nose, tail and both wingtips 1 m
 * clear of every aeroplane parked on the other stands (the airport's own, or
 * the traffic's) and off the runways, and it ends with nose, middle and tail
 * on made ground.
 */
function planPush(sim) {
  const ac = sim.aircraft;
  const lay = airportLayout();
  const F = lay.frame;
  const h0 = ac.heading || 0;
  const f0 = { x: Math.sin(h0 * D2R), z: -Math.cos(h0 * D2R) };
  const r0 = { x: Math.cos(h0 * D2R), z: Math.sin(h0 * D2R) };
  // Distance from the runway, in the layout's frame.
  const w0 = (ac.pos.z - F.cz) * F.side;
  const lane0 = lay.apron ? lay.apron.w0 + 14 : w0 - 40;
  const laneMin = lay.taxiway ? Math.min(lane0, lay.taxiway.w) : lane0;
  /*
   * The push ends at heading h0 - turn * 90. Tail right (turn +1) leaves the
   * nose pointing to the aeroplane's left: from a north stand (heading 0)
   * that is west, from a south one (180) east.
   */
  const want = departureHeading();
  const d = ((((h0 - want) % 360) + 540) % 360) - 180;
  const first = d >= 0 ? 1 : -1;
  const P = {
    p0: { x: ac.pos.x, z: ac.pos.z },
    h0,
    f0,
    r0,
    straight: 4,
    turn: first,
    total: 4,
    s: 0,
    lastH: h0,
    faces: '',
    // The runway it is meant to face the start of, whether it had to swing
    // the other way, and whether it went back onto the taxiway to turn.
    runway: runwayName(),
    flipped: false,
    toTaxiway: false,
    clear: true,
  };
  const setLane = (laneW, minStraight = 4) => {
    P.straight = Math.max(minStraight, w0 - PUSH_RADIUS - laneW);
    P.total = P.straight + (PUSH_RADIUS * Math.PI) / 2;
  };
  const info = S.info || playerInfo(sim);
  const own = S.stand || standAt(ac.pos.x, ac.pos.z, 3);
  const blockers = pushBlockers(lay, own);
  let found = false;
  for (const turn of [first, -first]) {
    for (let lane = lane0; lane >= laneMin - 0.01; lane -= 4) {
      P.turn = turn;
      setLane(lane);
      if (pushClear(P, lay, info, blockers)) {
        found = true;
        P.toTaxiway = lane < lane0 - 0.01;
        break;
      }
    }
    if (found) break;
  }
  /*
   * A short apron and a long aeroplane: four metres straight back and a 24 m
   * turn is 28 m, and on The Stacks (30 m of apron) an F-35B, 15.7 m long on
   * a light stand, went off the far side of the taxiway onto the grass. So
   * before giving up, start the turn as the tug starts pushing.
   */
  for (const turn of found ? [] : [first, -first]) {
    P.turn = turn;
    setLane(lane0, 0);
    if (pushClear(P, lay, info, blockers)) {
      found = true;
      P.toTaxiway = w0 - P.straight - PUSH_RADIUS < lane0 - 0.01;
      break;
    }
  }
  if (!found) {
    // Nothing is clear (a stand boxed in on both sides, say): the apron lane,
    // the way round that at least ends on made ground.
    P.clear = false;
    setLane(lane0);
    P.turn = first;
    if (!pushEndsPaved(P, lay, info)) {
      P.turn = -first;
      if (!pushEndsPaved(P, lay, info)) P.turn = first;
    }
  }
  P.flipped = P.turn !== first;
  P.faces = compassWord(h0 - P.turn * 90);
  return P;
}

/** Nose, tail and both wingtips of your aeroplane at a pose, into `out` (4 points). */
const _sweep = [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }];
function sweepPoints(info, pose, out = _sweep) {
  const h = pose.h * D2R;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const rx = Math.cos(h);
  const rz = Math.sin(h);
  const noseZ = info ? info.noseZ : -4;
  const tailZ = info ? info.tailZ : 5;
  const half = info ? info.halfSpan : 6;
  const tipZ = (info && info.wingTipZ) || 0;
  out[0].x = pose.x - fx * noseZ;
  out[0].z = pose.z - fz * noseZ;
  out[1].x = pose.x - fx * tailZ;
  out[1].z = pose.z - fz * tailZ;
  out[2].x = pose.x - rx * half - fx * tipZ;
  out[2].z = pose.z - rz * half - fz * tipZ;
  out[3].x = pose.x + rx * half - fx * tipZ;
  out[3].z = pose.z + rz * half - fz * tipZ;
  return out;
}

/** Does the push end with nose, middle and tail on made ground? */
const _end = { x: 0, z: 0, h: 0 };
function pushEndsPaved(P, lay, info) {
  pushPose(P, P.total, _end);
  const pts = sweepPoints(info, _end);
  return pavedIn(lay, _end.x, _end.z) && pavedIn(lay, pts[0].x, pts[0].z) && pavedIn(lay, pts[1].x, pts[1].z);
}

/**
 * The ground an aeroplane parked at (x, z) facing headingDeg covers, nose to
 * tail and tip to tip, as a box — stands face straight at the terminal, so
 * that is tight.
 */
function footprint(x, z, headingDeg, info) {
  const h = headingDeg * D2R;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const rx = Math.cos(h);
  const rz = Math.sin(h);
  const r = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const mx of [-info.halfSpan, info.halfSpan]) {
    for (const mz of [info.noseZ, info.tailZ]) {
      const px = x + rx * mx - fx * mz;
      const pz = z + rz * mx - fz * mz;
      r.x0 = Math.min(r.x0, px);
      r.x1 = Math.max(r.x1, px);
      r.z0 = Math.min(r.z0, pz);
      r.z1 = Math.max(r.z1, pz);
    }
  }
  return r;
}

/**
 * What the push must keep out of: every aeroplane parked on a stand other
 * than yours. The airport's own where it is drawn (or where it will be); the
 * traffic's where it stands; the whole stand when there is nothing better to
 * go on. Not the empty part of a stand: a medium stand is 36 m deep and a
 * Meridian on it 18 m long, and swinging a wingtip over the empty half of the
 * next stand is what pushbacks do.
 */
function pushBlockers(lay, own) {
  const out = [];
  for (const q of lay.stands) {
    if (q === own) continue;
    const t = S.busyBy.get(q);
    if (t) {
      const ti = t.typeId ? estimateInfo(t.typeId) : null;
      out.push(ti && t.pos ? footprint(t.pos.x, t.pos.z, t.heading || 0, ti) : q.box);
      continue;
    }
    if (!standTaken(q)) continue;
    const tg = q.parked;
    if (tg && tg.info) {
      out.push(footprint(tg.ox, tg.oz, tg.heading, tg.info));
      continue;
    }
    const qi = q.occupant ? estimateInfo(q.occupant) : null;
    if (!qi) {
      out.push(q.box);
      continue;
    }
    const h = q.headingDeg * D2R;
    const back = qi.noseZ - NOSE_STOP;
    out.push(footprint(q.noseX + Math.sin(h) * back, q.noseZ - Math.cos(h) * back, q.headingDeg, qi));
  }
  return out;
}

/** Is the whole push clear? See planPush(). Runs once, when the tug starts. */
const _step = { x: 0, z: 0, h: 0 };
const CLEARANCE = 1;
function pushClear(P, lay, info, blockers) {
  if (!pushEndsPaved(P, lay, info)) return false;
  for (let s = 0; s <= P.total + 1.5; s += 1.5) {
    pushPose(P, Math.min(s, P.total), _step);
    const pts = sweepPoints(info, _step);
    for (let k = 0; k < 4; k++) {
      const p = pts[k];
      if (isOnAnyRunway(p.x, p.z, 0)) return false;
      for (let i = 0; i < blockers.length; i++) {
        const b = blockers[i];
        if (p.x > b.x0 - CLEARANCE && p.x < b.x1 + CLEARANCE && p.z > b.z0 - CLEARANCE && p.z < b.z1 + CLEARANCE) return false;
      }
    }
  }
  return true;
}

/** Where the aeroplane is s metres into the push: { x, z, h }. */
function pushPose(P, s, out) {
  if (s <= P.straight) {
    out.x = P.p0.x - P.f0.x * s;
    out.z = P.p0.z - P.f0.z * s;
    out.h = P.h0;
    return out;
  }
  const phi = Math.min(Math.PI / 2, (s - P.straight) / PUSH_RADIUS);
  const p1x = P.p0.x - P.f0.x * P.straight;
  const p1z = P.p0.z - P.f0.z * P.straight;
  const rx = P.r0.x * P.turn;
  const rz = P.r0.z * P.turn;
  out.x = p1x + PUSH_RADIUS * (-P.f0.x * Math.sin(phi) + rx * (1 - Math.cos(phi)));
  out.z = p1z + PUSH_RADIUS * (-P.f0.z * Math.sin(phi) + rz * (1 - Math.cos(phi)));
  out.h = P.h0 - P.turn * (phi / D2R);
  return out;
}

const _pose = { x: 0, z: 0, h: 0 };

function stepPush(sim, dt) {
  const P = S.push;
  const ac = sim.aircraft;
  P.s = Math.min(P.total, P.s + dt * PUSH_SPEED);
  pushPose(P, P.s, _pose);
  // Move the aeroplane: position in the ground plane, yaw about the vertical
  // by what changed, so the pitch the undercarriage settled it at is kept.
  ac.pos.x = _pose.x;
  ac.pos.z = _pose.z;
  ac.vel.x = 0;
  ac.vel.z = 0;
  if (ac.omega) ac.omega.set(0, 0, 0);
  const dh = _pose.h - P.lastH;
  if (dh) {
    _q.setFromAxisAngle(UP, -dh * D2R);
    ac.quat.premultiply(_q).normalize();
    P.lastH = _pose.h;
  }
  ac.parkingBrake = true;
  // The tug, pinned to the nose leg, facing the aeroplane.
  const I = S.info;
  if (I && sim.apron && sim.apron.placeSpareTug) {
    const h = _pose.h * D2R;
    const fx = Math.sin(h);
    const fz = -Math.cos(h);
    const ng = I.noseGear;
    const gx = _pose.x + Math.cos(h) * ng.x - fx * ng.z;
    const gz = _pose.z + Math.sin(h) * ng.x - fz * ng.z;
    sim.apron.placeSpareTug(gx + fx * TUG_BAR_TIP, gz + fz * TUG_BAR_TIP, yawOf(_pose.h + 180));
  }
  return P.s >= P.total;
}

/* ------------------------------------------------------------------ */
/* Visitors and doors                                                   */
/* ------------------------------------------------------------------ */

/** Tell the bridges and the hangars what is standing about on the ground. */
function scan(sim) {
  const visitors = [];
  const near = [];
  const ac = sim.aircraft;
  const flying = sim.mode && sim.mode !== 'drive';
  if (flying && ac && ac.onGround && !ac.crashed) {
    near.push({ x: ac.pos.x, z: ac.pos.z });
    if (stopped(sim) && S.state !== 'pushback') {
      const type = typeOf(sim);
      if (type) visitors.push({ id: 'player', typeId: type.id, x: ac.pos.x, z: ac.pos.z, headingDeg: ac.heading || 0, info: playerInfo(sim) });
    }
  }
  if (sim.mode === 'drive' && sim.vehicle && sim.vehicle.pos) near.push({ x: sim.vehicle.pos.x, z: sim.vehicle.pos.z });
  S.busy.clear();
  S.busyBy.clear();
  for (const t of sim.traffic || []) {
    if (!t || !t.pos || !t.onGround) continue;
    near.push({ x: t.pos.x, z: t.pos.z });
    const st = standAt(t.pos.x, t.pos.z);
    if (st) {
      S.busy.add(st);
      S.busyBy.set(st, t);
    }
    if (Math.abs(t.speed || 0) < 0.5 && t.typeId) {
      visitors.push({ id: t.id, typeId: t.typeId, x: t.pos.x, z: t.pos.z, headingDeg: t.heading || 0 });
    }
  }
  if (sim.apron && sim.apron.setVisitors) sim.apron.setVisitors(visitors);
  if (sim.airport && sim.airport.watchHangars && near.length) sim.airport.watchHangars(near);
}

/* ------------------------------------------------------------------ */
/* The state machine                                                   */
/* ------------------------------------------------------------------ */

function onApron(sim) {
  const lay = airportLayout();
  const a = lay.apron && lay.apron.rect;
  const p = sim.aircraft.pos;
  return !!a && p.x > a.x0 - 10 && p.x < a.x1 + 10 && p.z > a.z0 - 10 && p.z < a.z1 + 10;
}

function tick(sim, dt) {
  S.t += dt;
  const ac = sim.aircraft;
  const flying = sim.state === 'flying' && sim.mode && sim.mode !== 'drive';
  if (!flying || !ac) {
    if (S.state !== 'idle' || S.said) reset(sim);
    return;
  }
  if (ac.crashed) {
    if (S.state !== 'idle' || S.said) reset(sim);
    return;
  }
  // The world was rebuilt under us (a detail change): its crew is not ours.
  if (S.apron && S.apron !== sim.apron) reset(sim);

  /*
   * The docking board, and its words on screen. Not once the tug is on:
   * during a pushback the distance would count back up, which no real board
   * does.
   */
  const docking = S.state === 'idle' || S.state === 'onStand' || S.state === 'calling' || S.state === 'serviced';
  const d = docking ? dockReading(sim) : null;
  if (sim.apron && sim.apron.showDocking) {
    if (d) {
      const r = S.reading;
      r.toGo = d.toGo;
      r.lateral = d.lateral;
      r.speed = groundSpeed(ac);
      const type = typeOf(sim);
      r.name = (type && (type.short || type.name)) || '';
      sim.apron.showDocking(d.stand, r);
      // Measure the aeroplane now, while it is slow, rather than on the frame
      // it stops — so the nose the board counts is the real one.
      if (!S.measured.has((type || {}).id)) playerInfo(sim);
    } else {
      sim.apron.showDocking(null);
    }
  }

  switch (S.state) {
    case 'idle': {
      /*
       * Stopped on a stand — and near its stop, if the board can see you.
       * Anywhere in the stand's box used to count, so an aeroplane parked 23 m
       * short was told "Parked on stand 3" while the board in front of it
       * still read 23 m. Six metres short is parked; further out, the board
       * and the words below it carry on talking you in. Past the stop is
       * parked however far: an aeroplane cannot reverse, and measured, a
       * Skylark braked late at 7 m/s stopped 7.5 m past — it needs the tug,
       * not a lecture.
       */
      const st = stopped(sim) ? standUnder(sim) : null;
      const near = !d || d.stand !== st || d.toGo <= 6;
      if (st && near) {
        S.stand = st;
        S.state = 'onStand';
        S.t = 0;
        S.promptKey = -1;
        setPrompt(`Parked on stand ${st.number}. Press <kbd>Y</kbd> or tap here for the ground crew.`, () => callCrew(sim));
        break;
      }
      if (d && sim.apron && sim.apron.spare) {
        const html = dockPrompt(d);
        if (html) setPrompt(html);
      } else if (!S.crewUsed && sim.mode === 'free' && sim.apron && sim.apron.spare && groundSpeed(ac) < 8 && onApron(sim)) {
        if (S.promptKey !== 1) {
          S.promptKey = 1;
          setPrompt('Follow a yellow line onto a numbered stand and stop there — the ground crew will come out to you.');
        }
      } else if (S.said) {
        S.promptKey = -1;
        setPrompt('');
      }
      break;
    }
    case 'onStand': {
      if (!stopped(sim) || standUnder(sim) !== S.stand) {
        S.state = 'idle';
        S.stand = null;
        S.promptKey = -1;
        setPrompt('');
      }
      break;
    }
    case 'calling': {
      if (!stopped(sim)) {
        say(sim, 'Ground crew stood down — you moved off the stand.', 'warn');
        reset(sim);
        break;
      }
      if (sim.apron && sim.apron.crewReady && sim.apron.crewReady()) {
        S.state = 'serviced';
        S.t = 0;
        S.fuelFrom = ac.fuel;
        setPrompt('Fuelling and loading… press <kbd>Y</kbd> or tap here when you are ready to push back.', () => startPush(sim));
      }
      break;
    }
    case 'serviced': {
      // The bowser fills the tanks over twenty seconds.
      const cap = Physics.SPEC && Physics.SPEC.fuelCapacity;
      if (cap && ac.fuel < cap) ac.fuel = Math.min(cap, ac.fuel + (cap / 20) * dt);
      if (!stopped(sim)) {
        say(sim, 'Ground crew stood down — you moved off the stand.', 'warn');
        reset(sim);
      }
      break;
    }
    case 'pushback': {
      if (stepPush(sim, dt)) finishPush(sim, false);
      break;
    }
    case 'pushed': {
      // Back to idle once you taxi off, or are put somewhere else, or after
      // twenty seconds — so stopping on the next stand offers the crew again.
      const end = S.push ? pushPose(S.push, S.push.total, _pose) : null;
      const away = end ? Math.hypot(ac.pos.x - end.x, ac.pos.z - end.z) > 5 : true;
      if (S.t > 20 || !stopped(sim) || away) {
        S.state = 'idle';
        S.stand = null;
        S.push = null;
        S.apron = null;
        S.promptKey = -1;
      }
      break;
    }
    default:
      break;
  }
}

function callCrew(sim) {
  if (S.state !== 'onStand' && S.state !== 'idle') return false;
  const st = S.stand || standUnder(sim);
  if (!st || !sim.apron || !sim.apron.callCrew) return false;
  const ac = sim.aircraft;
  S.info = playerInfo(sim);
  if (!S.info) return false;
  const ok = sim.apron.callCrew(ac.pos.x, ac.pos.z, ac.heading || 0, S.info, st);
  if (!ok) return false;
  S.stand = st;
  S.apron = sim.apron;
  S.state = 'calling';
  S.t = 0;
  S.crewUsed = true;
  setPrompt('The ground crew is on the way…');
  radio(sim, `Stand ${st.number}, ground crew on the way.`);
  return true;
}

function startPush(sim) {
  if (S.state !== 'serviced') return false;
  S.push = planPush(sim);
  S.state = 'pushback';
  if (sim.apron && sim.apron.showDocking) sim.apron.showDocking(null);
  if (sim.apron && sim.apron.clearForPushback) sim.apron.clearForPushback();
  setPrompt(`Pushing back to face ${S.push.faces}… press <kbd>Y</kbd> or tap here to stop.`, () => stopPush(sim));
  radio(sim, `Pushback approved${S.push.toTaxiway ? ' onto the taxiway' : ''}, facing ${S.push.faces}.`);
  return true;
}

/**
 * Stop the push where it is. There was no way to: once the tug was on, the
 * aeroplane's position was written every frame for 30 s on Kestrel and 48 s
 * on San Francisco, and Y was swallowed doing nothing.
 */
function stopPush(sim) {
  if (S.state !== 'pushback' || !S.push) return false;
  // Where it is now is where the push ends; 'pushed' measures from there.
  S.push.total = S.push.s;
  finishPush(sim, true);
  return true;
}

function finishPush(sim, early) {
  S.state = 'pushed';
  S.t = 0;
  if (sim.apron && sim.apron.dismissCrew) sim.apron.dismissCrew();
  setPrompt('');
  if (early) {
    say(sim, 'Pushback stopped. Tug is clear — engine on, brakes off, and taxi out.', 'good', 6);
    radio(sim, 'Pushback stopped, tug is clear. Taxi when ready.');
  } else {
    const P = S.push;
    const way = P.flipped
      ? `runway ${P.runway} is behind you, so taxi round`
      : `taxi ${P.faces}${P.toTaxiway ? ' along the taxiway' : ''} to runway ${P.runway}`;
    say(sim, `Pushback complete. Tug is clear — engine on, brakes off, and ${way}.`, 'good', 6);
    radio(sim, `Pushback complete, tug is clear. Taxi to runway ${spoken(P.runway)} when ready.`);
  }
}

registerExtension({
  id: 'airport',

  install(sim) {
    S.sim = sim;
    ensurePrompt();
    /*
     * update() does not run while paused, in a menu or at the debrief, so it
     * cannot be what hides the prompt then. See watchForMenus().
     */
    watchForMenus(sim);
  },

  startMode(sim) {
    S.sim = sim;
    reset(sim);
    syncPromptVisibility();
  },

  stop(sim) {
    S.sim = sim;
    reset(sim);
    syncPromptVisibility();
  },

  update(sim, dt) {
    S.sim = sim;
    syncPromptVisibility();
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    /*
     * main.js ticks the airfield from its flight branch only, so in the car
     * the baggage trains stopped and the lights never came on. Tick it here
     * while driving.
     */
    if (sim.mode === 'drive') {
      if (sim.apron && sim.apron.update) sim.apron.update(dt, sim.weather);
      if (sim.airport && sim.airport.update && sim.weather) sim.airport.update(dt, sim.weather);
    }
    S.scan -= dt;
    if (S.scan <= 0) {
      S.scan = 0.5;
      scan(sim);
    }
    tick(sim, dt);
  },

  key(sim, code, down) {
    if (code !== 'KeyY') return false;
    const st = S.state;
    if (st !== 'onStand' && st !== 'calling' && st !== 'serviced' && st !== 'pushback') return false;
    if (!down) return true;
    if (st === 'onStand') callCrew(sim);
    else if (st === 'serviced') startPush(sim);
    else if (st === 'pushback') stopPush(sim);
    else if (st === 'calling') say(sim, 'Wait for the crew to finish parking up.', 'info', 2.5);
    return true;
  },

  devActions: [
    {
      label: 'Park at a free stand',
      hint: 'Puts your aeroplane nose-in on the nearest empty stand it fits, engine off',
      run(sim) {
        const lay = airportLayout();
        const type = typeOf(sim);
        // Your aeroplane as drawn (playerInfo measures it), so an A320 is
        // not put on a stand a metre and a half shorter than it is.
        const est = type ? playerInfo(sim) : null;
        const span = est ? est.halfSpan * 2 : 12;
        const length = est ? est.tailZ - est.noseZ : 8;
        const ac = sim.aircraft;
        /*
         * Fresh news of the traffic first: a stand one of its aeroplanes is
         * on is not free, whatever the airport's own list says. It only
         * looked at the airport's own occupants, and parked you into the
         * traffic's.
         */
        scan(sim);
        const free = lay.stands
          .filter((s) => !standTaken(s) && !S.busy.has(s) && standFits(s, span, length))
          .sort((a, b) => Math.hypot(a.x - ac.pos.x, a.z - ac.pos.z) - Math.hypot(b.x - ac.pos.x, b.z - ac.pos.z));
        const st = free[0];
        if (!st) {
          say(sim, 'No free stand here fits this aeroplane.', 'warn');
          return;
        }
        reset(sim);
        const noseZ = est ? est.noseZ : -3;
        const h = st.headingDeg * D2R;
        const x = st.noseX + Math.sin(h) * (noseZ - NOSE_STOP);
        const z = st.noseZ - Math.cos(h) * (noseZ - NOSE_STOP);
        ac.reset({ pos: new THREE.Vector3(x, 0, z), headingDeg: st.headingDeg, engineOn: false });
        say(sim, `Parked on stand ${st.number}.`, 'good');
      },
    },
    {
      label: 'Call the ground crew',
      hint: 'Same as pressing Y on a stand',
      run(sim) {
        if (!callCrew(sim)) say(sim, 'Stop on an empty stand first.', 'warn');
      },
    },
    {
      label: 'Open every hangar',
      hint: 'Slides every hangar door open for two minutes',
      run(sim) {
        if (sim.airport && sim.airport.openHangar) sim.airport.openHangar(null, 120);
      },
    },
  ],
});

/** For the tests. */
export const __airportServices = {
  S,
  planPush,
  pushPose,
  standUnder,
  playerInfo,
  dockReading,
  callCrew,
  startPush,
  stopPush,
  departureHeading,
  promptAllowed,
  syncPromptVisibility,
  watchPrompt,
  scan,
};
