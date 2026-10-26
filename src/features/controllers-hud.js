/**
 * Sim gear on the HUD (flight/controllers.js reads the devices).
 *
 *   the notice  "TCA Quadrant Airbus connected — profile loaded" when a
 *               controller turns up (the browser only shows one once a button
 *               on it has been pressed), "… disconnected" when it goes.
 *   the check   a small card listing what that device now drives — roll,
 *               pitch, rudder, the thrust levers, the toe brakes — each ticked
 *               as you move it end to end, so a lever on the wrong axis shows
 *               up on the apron rather than on the take-off roll. It goes when
 *               everything is ticked, or after half a minute.
 *   the levers  a word when the thrust levers click into an Airbus detent
 *               (CL, FLX/MCT, TOGA, IDLE, REV).
 *
 * Nothing here reads a key, and nothing here changes how anything flies.
 */
import { registerExtension, extLayer } from '../game/extensions.js';
import { ROLE } from '../flight/controllers.js';

const SHORT = {
  roll: 'Roll', pitch: 'Pitch', yaw: 'Rudder', throttle: 'Throttle', throttle1: 'Thrust lever 1', throttle2: 'Thrust lever 2',
  brakeL: 'Left toe brake', brakeR: 'Right toe brake', speedbrake: 'Speedbrake', flaps: 'Flaps',
};
const DETENT_WORDS = { IDLE: 'IDLE', CL: 'CL (climb)', FLX: 'FLX / MCT', TOGA: 'TOGA', REV: 'REVERSE' };
/** How long the check card waits for the levers to be moved, seconds. */
export const CHECK_SECONDS = 30;

const S = { card: null, check: null, detent: null, notes: [] };

const CSS = `
.ctl-check { width: 190px; padding: 8px 10px 9px; border-radius: 14px; background: rgba(12,20,34,.84);
  border: 1px solid var(--panel-line, rgba(140,180,230,.18)); color: var(--text, #eaf1fb);
  font: 600 12px/1.3 var(--font, system-ui, sans-serif); pointer-events: none; display: none; }
.ctl-check.is-shown { display: block; }
.ctl-check h5 { margin: 0 0 4px; font-size: 10.5px; letter-spacing: .08em; color: var(--text-dim, #9fb2cc); font-weight: 700; }
.ctl-check ul { list-style: none; margin: 0; padding: 0; }
.ctl-check li { display: flex; justify-content: space-between; gap: 6px; font-size: 11.5px; }
.ctl-check li b { color: var(--text-dim, #9fb2cc); font-weight: 700; }
.ctl-check li.is-ok b { color: var(--accent-2, #7ee8b2); }
.ctl-check p { margin: 5px 0 0; font-size: 10px; color: var(--text-dim, #9fb2cc); }
.hud-rstack > .ctl-check:not(.is-shown) { display: none !important; }
`;

function notify(sim, text, kind = 'info', seconds = 3) {
  try {
    if (sim && sim.hud) sim.hud.notify(text, kind, seconds);
  } catch (e) {
    void e;
  }
}

function buildCard() {
  if (S.card || typeof document === 'undefined') return S.card;
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);
  const el = document.createElement('div');
  el.className = 'ctl-check';
  el.setAttribute('role', 'status');
  el.innerHTML = '<h5>MOVE EACH LEVER</h5><ul></ul><p>Settings → Controls → Controllers to change any of it</p>';
  S.card = el;
  return el;
}

function placeCard(sim) {
  const el = buildCard();
  if (!el) return;
  const stack = sim && sim.hud && sim.hud.stack;
  if (stack && typeof stack.add === 'function' && stack.el) {
    if (el.parentNode !== stack.el) stack.add(el, { prio: 1.25, id: 'controllers', chip: false });
  } else if (el.parentNode !== extLayer()) {
    Object.assign(el.style, { position: 'absolute', right: '12px', top: '96px' });
    extLayer().appendChild(el);
  }
}

/** Start the "move each lever" check for a device that just connected. Returns the roles it lists. */
export function startCheck(sim, ev) {
  const roles = (ev.roles || []).filter((r) => ROLE[r]);
  if (!roles.length) return [];
  S.check = { key: ev.key, name: ev.name, roles, seen: {}, lo: {}, hi: {}, t: CHECK_SECONDS, done: 0 };
  placeCard(sim);
  drawCheck();
  return roles;
}

function drawCheck() {
  const c = S.check;
  const el = S.card;
  if (!el) return;
  if (!c) {
    el.classList.remove('is-shown');
    return;
  }
  el.querySelector('h5').textContent = `MOVE EACH LEVER — ${c.name.toUpperCase().slice(0, 28)}`;
  el.querySelector('ul').innerHTML = c.roles
    .map((r) => `<li class="${c.seen[r] ? 'is-ok' : ''}"><span>${SHORT[r] || r}</span><b>${c.seen[r] ? '✓' : '…'}</b></li>`)
    .join('');
  el.classList.add('is-shown');
}

/** One frame of the check: a role is ticked once it has travelled most of its range. */
export function stepCheck(sim, dt) {
  const c = S.check;
  if (!c) return;
  const C = sim.input && sim.input.controllers;
  const d = C && C.devices.find((x) => x.key === c.key);
  c.t -= dt;
  let changed = false;
  if (d) {
    for (const r of c.roles) {
      if (c.seen[r]) continue;
      const v = C.roleValue(d, r);
      if (v === null) continue;
      c.lo[r] = Math.min(c.lo[r] ?? v, v);
      c.hi[r] = Math.max(c.hi[r] ?? v, v);
      const need = ROLE[r].kind === 'centre' ? 1.2 : 0.6;
      if (c.hi[r] - c.lo[r] >= need) {
        c.seen[r] = true;
        changed = true;
      }
    }
  }
  const all = c.roles.every((r) => c.seen[r]);
  if (all && !c.done) {
    c.done = 1;
    c.t = Math.min(c.t, 1.5);
    notify(sim, `${c.name}: every lever answers`, 'good', 2.2);
  }
  if (changed) drawCheck();
  if (c.t <= 0 || !d) {
    S.check = null;
    drawCheck();
  }
}

/** The connect / disconnect notices, and the detent words. */
export function update(sim, dt) {
  const C = sim && sim.input && sim.input.controllers;
  if (!C) return;
  for (const ev of C.drainEvents()) {
    if (ev.type === 'connect') {
      const p = ev.profileId === 'standard' ? 'gamepad layout' : ev.profileId === 'none' ? 'ignored (Settings → Controls → Controllers to use it)' : 'profile loaded';
      const text = `${ev.name} connected — ${ev.profileId === 'standard' || ev.profileId === 'none' ? p : `${ev.profile} ${p}`}`;
      S.notes.push(text);
      notify(sim, text, 'good', 4.5);
      if (ev.profileId !== 'standard' && ev.profileId !== 'none') startCheck(sim, ev);
    } else if (ev.type === 'disconnect') {
      S.notes.push(`${ev.name} disconnected`);
      notify(sim, `${ev.name} disconnected`, 'warn', 3.5);
      if (S.check && S.check.key === ev.key) {
        S.check = null;
        drawCheck();
      }
    }
  }
  if (S.notes.length > 12) S.notes.splice(0, S.notes.length - 12);
  stepCheck(sim, dt);
  // The thrust levers' detents: a word as both click into the same one.
  const hw = sim.input.hw;
  const det = hw && hw.detents && hw.detents.every((x) => x && x === hw.detents[0] && x !== 'MAN') ? hw.detents[0] : null;
  if (det && S.detent !== null && det !== S.detent && sim.input._hwThr && sim.input._hwThr.own) {
    notify(sim, `Thrust levers: ${DETENT_WORDS[det] || det}`, 'info', 1.6);
  }
  if (det || !hw || !hw.detents) S.detent = det;
}

registerExtension({
  id: 'controllers-hud',
  update(sim, dt) {
    update(sim, dt);
  },
  stop() {
    S.check = null;
    drawCheck();
  },
});

/** For the browser check and the console. */
export function controllersHudState() {
  return {
    notes: S.notes.slice(),
    check: S.check ? { name: S.check.name, roles: S.check.roles.slice(), seen: { ...S.check.seen } } : null,
    cardShown: !!(S.card && S.card.classList.contains('is-shown')),
    detent: S.detent,
  };
}
