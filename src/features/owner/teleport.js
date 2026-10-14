/**
 * OWNER MODE: TELEPORT, AND TAKE OVER ANY AIRCRAFT.
 *
 * "teleporting everywhere I want on the minimap, including their altitude
 * maxing at 50,000": in owner mode (../owner.js — the fan x10 and the code,
 * this device's hour; no game with others needed), tap or click any point on
 * the minimap and a small picker opens beside it: where that is, a height
 * slider from the ground up to 50,000 ft with presets, Teleport. The aircraft
 * arrives there level, at a speed it flies at (./place.js: faster the higher,
 * for the thin air), the follow camera snapped to it; "Ground" stands it on
 * its wheels. The same for another player: "🗺 Teleport them" in their troll
 * row (./trolls.js) arms it, the next tap on the map is for them, and the
 * host relays it ('owner:tp' → 'owner:tpgo', after its own check that the
 * asker is the owner) so their copy places them. There is no big map in the
 * game — the minimap is the map.
 *
 * "I wanna get INTO other planes if mine ejects or crashes": in owner mode,
 * any time — in the air, after ejecting, on the ground after a crash, even on
 * the crash debrief — "✈ Take over" (a button by the owner chip) lists every
 * aircraft within TAKE_RANGE_M: the AI traffic (../traffic.js — airliners,
 * light aeroplanes and jets, flying or parked on the apron), in a game with
 * others the host's traffic too (../mpworld.js mirrors it), a mission's
 * NPC aircraft (the pursuers main.js puts in sim.traffic), and everybody
 * else in the sky's list (../sky.js: a story's airliner or escort, an
 * ambient helicopter — anything with a type the owner can fly). Pick one, or tap it
 * on the minimap: you are in its seat where it is, at its speed, on its
 * heading; its NPC brain is switched off and its route forgotten (the traffic
 * gives the aeroplane up: takeCraft; the host does the same for a mirrored
 * one on 'owner:take'). From a parachute, the ground or a debrief the flight
 * is started afresh first (sim.startMode, the same path as Restart), then
 * placed. Everybody else sees you flying it: your snapshot carries the type.
 * For non-owners the ordinary way stays the pilot job's "find another ride".
 *
 * ADMINS ("troll thing for admin") get the teleport — the map tap, the height
 * picker, "Teleport them" — in a game where the host has checked their admin
 * key, on plain players only: an admin never teleports the owner or another
 * admin (common.js mayTroll, judged by the HOST on 'owner:tp'). TAKING OVER
 * stays the owner's: no list, no button on the picker for an admin, and the
 * host refuses 'owner:take' from anybody who is not the owner.
 */

import { registerExtension, extLayer } from '../../game/extensions.js';
import { owner } from '../multiplayer/owner.js';
import { getAircraft } from '../../aircraft/types.js';
import { takeCraft } from '../traffic.js';
import { mirrorTraffic } from '../mpworld.js';
import { bodies as skyBodies, unregisterBody } from '../sky.js';
import { eject } from '../eject.js';
import { onFoot } from '../onfoot.js';
import { mp, ch, inGame, esc, feed, bigCard, who } from '../mpplay/shared.js';
import { placeAircraft, clampAltFt, mapToWorld, clientToMap, mToFt, ftToM, MAX_ALT_FT } from './place.js';
import { hostOwner, hostMayTroll, amOwnerInGame, amStaffInGame, mayTroll, myRole, rosterRole, playerOf, byWho, placeOf, isId, num, now, showTag, injectOwnerStyle, OWNER_GOLD } from './common.js';

export const TAKE_RANGE_M = 8000;
export const PRESET_FT = Object.freeze([0, 1000, 5000, 10000, 25000, 50000]);
/** A tap this near an aircraft's dot on the map (in the map's own units) is a tap on it. */
export const MAP_HIT = 9;

const CSS = `
.owner-tp, .owner-take { position: fixed; z-index: 34; pointer-events: auto; width: min(300px, 92vw); padding: 10px 12px; border-radius: 14px;
  background: rgba(10, 17, 30, 0.94); border: 1px solid rgba(255, 210, 63, 0.6); box-shadow: var(--shadow, 0 8px 30px rgba(0,0,0,.4));
  color: var(--text, #eaf1fb); font: 13px var(--font, system-ui, sans-serif); }
.owner-tp[hidden], .owner-take[hidden], .owner-tools[hidden] { display: none !important; }
.owner-tp h5, .owner-take h5 { margin: 0 0 6px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #ffd23f; }
.owner-tp p { margin: 0 0 6px; color: var(--text-dim, #9fb2cc); font-size: 12px; }
.owner-tp input[type=range] { width: 100%; accent-color: #ffd23f; }
.owner-tp output { display: block; font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; margin: 2px 0 6px; }
.owner-tp .owner-tp-presets, .owner-tp .owner-tp-acts { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.owner-tp button, .owner-take button, .owner-tools button { font: inherit; font-size: 12.5px; cursor: pointer; color: var(--text, #eaf1fb); padding: 5px 9px; border-radius: 9px;
  border: 1px solid var(--panel-line, rgba(140,180,230,.18)); background: rgba(255,255,255,0.08); pointer-events: auto; }
.owner-tp button.is-on { background: rgba(255, 210, 63, 0.26); border-color: rgba(255, 210, 63, 0.85); }
.owner-tp button.owner-tp-go, .owner-take button.owner-take-row { background: rgba(255, 210, 63, 0.22); border-color: rgba(255, 210, 63, 0.8); font-weight: 700; }
.owner-take .owner-take-rows { display: flex; flex-direction: column; gap: 4px; max-height: 40vh; overflow-y: auto; }
.owner-take button.owner-take-row { text-align: left; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 8px; }
.owner-take button.owner-take-row small { grid-column: 1 / -1; color: var(--text-dim, #9fb2cc); font-weight: 500; }
.owner-take .owner-take-foot { display: flex; justify-content: space-between; gap: 6px; margin-top: 8px; color: var(--text-dim, #9fb2cc); font-size: 11.5px; align-items: center; }
.owner-tools { position: fixed; z-index: 33; left: calc(50% + 86px); bottom: max(10px, env(safe-area-inset-bottom)); pointer-events: none; display: flex; gap: 6px; align-items: center;
  font: 12px var(--font, system-ui, sans-serif); color: var(--text-dim, #9fb2cc); }
.owner-tools button { border-radius: 99px; background: rgba(12, 20, 34, 0.92); border-color: rgba(255, 210, 63, 0.6); font-weight: 650; }
.owner-tools .owner-tools-hint { background: rgba(12, 20, 34, 0.7); padding: 4px 9px; border-radius: 99px; white-space: nowrap; }
.owner-tools[data-staff="admin"] { left: 50%; transform: translateX(-50%); }
:root.is-touch-device .owner-tools { top: max(8px, env(safe-area-inset-top)); bottom: auto; }
:root.is-touch-device .owner-tools .owner-tools-hint { display: none; }
`;

const T = {
  sim: null,
  installed: false,
  /** "Teleport them": whose next map tap this is. */
  armed: null,
  picker: null,
  tools: null,
  list: null,
  /** The last tap on the map: where in the world, the nearest aircraft to it, who it is for. */
  tap: null,
  toolsAt: 0,
  stats: { taps: 0, teleports: 0, sentTp: 0, tpIn: 0, taken: 0, takeAsked: 0, tookIn: 0 },
};

/* ---- what may travel ------------------------------------------------------------------- */

export function cleanTp(d) {
  return d && isId(d.t) && num(d.x) && num(d.z) && num(d.y, 20000) && d.y >= 0 ? { t: d.t, x: Math.round(d.x), y: Math.round(d.y), z: Math.round(d.z) } : null;
}
export function cleanTpGo(d) {
  const c = cleanTp(d);
  return c && isId(d.by) ? { ...c, by: d.by } : null;
}
export function cleanTake(d) {
  return d && Number.isInteger(d.id) && d.id >= 0 && d.id <= 999 ? { id: d.id } : null;
}
export function cleanTook(d) {
  const c = cleanTake(d);
  return c && isId(d.by) ? { ...c, by: d.by } : null;
}

ch.define('owner:tp', { validate: cleanTp, rate: 1 });
ch.define('owner:tpgo', { from: 'host', validate: cleanTpGo, rate: 2 });
ch.define('owner:take', { validate: cleanTake, rate: 1 });
ch.define('owner:took', { from: 'host', validate: cleanTook, rate: 2 });

ch.on('owner:tp', (d, from, meta) => {
  // The owner, or an admin on a plain player: the host's own reading of both (hostMayTroll), never the asker's word.
  if (!ch.isHost || !meta || !meta.toHost || !from || !hostMayTroll(from.id, d.t)) return;
  if (!ch.players().some((p) => p.id === d.t)) return;
  ch.send('owner:tpgo', { ...d, by: from.id }, { self: true });
});

ch.on('owner:tpgo', (d, from) => {
  if (!from || !from.host) return;
  T.stats.tpIn++;
  const sim = T.sim;
  if (d.t !== mp.meId) return;
  const me = placeOf(mp.meId, sim);
  if (!me) return;
  const done = placeAircraft(sim, { x: d.x, z: d.z, y: d.y, headingDeg: me.heading, speed: me.speed, ground: d.y <= 0 });
  if (!done) return;
  showTag(`teleported by ${who(d.by).name}`, 3, d.by);
  bigCard('WHOOSH', `${byWho(d.by)} teleported you${done.ground ? ' — to the ground' : ` — ${Math.round(mToFt(done.y)).toLocaleString('en-GB')} ft`}`, 1.8);
});

ch.on('owner:take', (d, from, meta) => {
  if (!ch.isHost || !meta || !meta.toHost || !from || !hostOwner(from.id)) return;
  T.stats.takeAsked++;
  const pose = takeCraft(T.sim, `traffic-${d.id}`);
  if (pose) ch.send('owner:took', { id: d.id, by: from.id }, { self: true });
});

ch.on('owner:took', (d, from) => {
  if (!from || !from.host) return;
  T.stats.tookIn++;
  // Gone from the host's traffic: hidden here at once, and dropped at the host's next word.
  const m = mirrorTraffic().get(d.id);
  if (m && m.model) m.model.visible = false;
  if (d.by !== mp.meId) feed(`✈ <b>${esc(who(d.by).name)}</b> took over an aeroplane`, OWNER_GOLD);
});

/* ---- owner mode, here ----------------------------------------------------------------------- */

/**
 * Owner here, in an aircraft game (flying, paused, or on a debrief after a
 * crash): this device's hour, or — in a game with others — the host's own
 * check of the pass (mp.me.owner), which is the same hour seen from the host.
 */
export function ownerOn(sim, states = ['flying', 'paused']) {
  return !!((owner.active || amOwnerInGame()) && sim && sim.aircraft && sim.mode !== 'drive' && states.includes(sim.state));
}

/** The owner's tools, or an admin's (a game, the host has checked the key): the map tap and the picker. Take over is ownerOn's alone. */
export function staffOn(sim, states = ['flying', 'paused']) {
  return ownerOn(sim, states) || !!(amStaffInGame() && sim && sim.aircraft && sim.mode !== 'drive' && states.includes(sim.state));
}

/* ---- the aircraft that can be taken ---------------------------------------------------------- */

const typeOk = (id) => {
  const t = id ? getAircraft(id) : null;
  return t && t.id === id ? t : null;
};

/** Every aircraft within range that is not this player's, nearest first: { src, id, type, name, x, y, z, heading, speed, vs, onGround, dist }. */
export function candidates(sim, range = TAKE_RANGE_M) {
  const out = [];
  const ac = sim && sim.aircraft;
  if (!ac) return out;
  const me = ac.pos;
  const push = (c) => {
    c.dist = Math.hypot(c.x - me.x, c.z - me.z);
    if (c.dist <= range) out.push(c);
  };
  for (const e of Array.isArray(sim.traffic) ? sim.traffic : []) {
    if (!e || !e.pos || !Number.isFinite(e.pos.x)) continue;
    const typeId = e.typeId || (e.type && e.type.id);
    const type = typeOk(typeId);
    if (!type) continue;
    const pursuer = !e.typeId && typeof e.dispose === 'function';
    push({
      src: pursuer ? 'pursuer' : 'traffic', id: e.id, ref: e, type: typeId, typeName: type.name, name: e.callsign || e.name || type.name,
      x: e.pos.x, y: e.pos.y, z: e.pos.z, heading: Number(e.heading) || 0, speed: Number(e.speed) || 0, vs: Number(e.vs) || 0, onGround: !!e.onGround,
    });
  }
  if (inGame() && !ch.isHost) {
    for (const m of mirrorTraffic().values()) {
      const type = typeOk(m.type);
      if (!type || (m.model && m.model.visible === false && m.taken)) continue;
      push({ src: 'mirror', id: m.id, ref: m, type: m.type, typeName: type.name, name: `${type.name} ${m.id}`, x: m.dx, y: m.dy, z: m.dz, heading: m.dh, speed: m.v, vs: m.vs, onGround: !!(m.f & 2) });
    }
  }
  /*
   * Everybody else in the sky (../sky.js — the one list every other aircraft
   * registers in: a story's airliner, an escort jet, an ambient helicopter,
   * a pursuer). The traffic registers its own entries there too, and the
   * host's mirrored aeroplanes have their rows above, so those are skipped;
   * so is a drone (nobody is aboard one) and a body without a type the owner
   * could fly.
   */
  const seen = new Set(out.map((c) => c.id));
  for (const b of skyBodies()) {
    if (!b || b.gone || b.small || !b.pos || !Number.isFinite(b.pos.x) || seen.has(b.id) || /^(traffic|mp-traffic)-/.test(String(b.id))) continue;
    const type = typeOk(b.typeId);
    if (!type) continue;
    const vel = b.vel || null;
    const speed = vel ? Math.hypot(vel.x, vel.z) : 0;
    const heading = Number.isFinite(Number(b.heading)) ? Number(b.heading) : vel && speed > 1 ? ((Math.atan2(vel.x, -vel.z) * 180) / Math.PI + 360) % 360 : 0;
    push({ src: 'sky', id: b.id, ref: b, type: b.typeId, typeName: type.name, name: b.bodyName || b.name || type.name, x: b.pos.x, y: b.pos.y, z: b.pos.z, heading, speed, vs: vel ? vel.y : 0, onGround: !!b.onGround });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out.slice(0, 12);
}

/**
 * Into its seat. From the air it is the light way (a new type, a new place);
 * from a parachute, the ground after a crash or a debrief the flight starts
 * afresh first, as Restart does, then the aeroplane is put where the other
 * one was. Returns what was done, or null.
 */
export async function takeOver(sim, c) {
  if (!sim || !c || !typeOk(c.type)) return null;
  const dirty = !!(sim.aircraft.crashed || sim.state !== 'flying' || (eject && eject.phase && eject.phase !== 'idle') || (onFoot && onFoot.active));
  // The NPC gives the aeroplane up first: brain off, route forgotten.
  if (c.src === 'traffic') takeCraft(sim, c.id);
  else if (c.src === 'mirror') {
    if (inGame()) ch.toHost('owner:take', { id: c.id });
    if (c.ref) {
      c.ref.taken = true;
      if (c.ref.model) c.ref.model.visible = false;
    }
  } else if (c.src === 'pursuer' && c.ref) {
    try {
      c.ref.dispose();
    } catch (e) {
      /* it is ours now either way */
    }
    if (Array.isArray(sim.pursuers)) sim.pursuers = sim.pursuers.filter((p) => p !== c.ref);
    if (Array.isArray(sim.traffic)) {
      const i = sim.traffic.indexOf(c.ref);
      if (i >= 0) sim.traffic.splice(i, 1);
    }
    if (sim.pursuer === c.ref) sim.pursuer = sim.pursuers && sim.pursuers[0] ? sim.pursuers[0] : null;
  } else if (c.src === 'sky' && c.ref) {
    /*
     * A body from the sky's list: its owner gives it up through `take()` when
     * it has one; otherwise the aeroplane is simply gone from the world — out
     * of the list (no collisions, off the map) and no longer drawn — while
     * whatever story flew it carries on without it.
     */
    const b = c.ref;
    if (typeof b.take === 'function') {
      try {
        b.take();
      } catch (e) {
        /* ours now either way */
      }
    } else if (b.model) b.model.visible = false;
    unregisterBody(b);
  }
  if (dirty) {
    const mode = sim.mode || 'free';
    await sim.startMode(mode, { ...(sim.modeOpts || {}), aircraft: c.type, airborne: !c.onGround });
  }
  if (!sim.aircraftType || sim.aircraftType.id !== c.type) {
    sim.setAircraft(c.type);
    if (sim.hud && sim.hud.setAircraftName) sim.hud.setAircraftName(sim.aircraftType.name);
  }
  const done = placeAircraft(sim, { x: c.x, z: c.z, y: c.y, headingDeg: c.heading, speed: c.speed, ground: c.onGround });
  if (!done) return null;
  T.stats.taken++;
  bigCard('TAKEN OVER', `you are flying ${c.name}`, 2);
  feed(`✈ You took over <b>${esc(c.name)}</b> (${esc(c.typeName)})`, OWNER_GOLD);
  return { ...done, type: c.type, name: c.name, restarted: dirty };
}

/* ---- the map tap -------------------------------------------------------------------------- */

/**
 * The map takes taps only in owner mode. styles/main.css gives .minimap
 * `pointer-events: none` — a tap on it goes through to the game, as it
 * should for everybody else — so while the owner's tools are on the screen
 * the map's element is made to take them (and shows a crosshair), and when
 * they go it is given back as it was. Without this a real click on the map
 * reached the canvas under it, never this module (the first browser run of
 * the merged game).
 */
export function mapTakesTaps(sim, on) {
  const mm = sim && sim.minimap;
  const el = mm && mm.el;
  if (!el || !el.style) return false;
  const want = on ? 'auto' : '';
  if (el.style.pointerEvents !== want) {
    el.style.pointerEvents = want;
    el.style.cursor = on ? 'crosshair' : '';
  }
  return !!on;
}

/** The minimap's live geometry (ui/minimap.js keeps it on _g): { cx, cy, k, craft }. */
function mapGeometry(sim) {
  const mm = sim && sim.minimap;
  const g = mm && mm._g;
  return g && g.craft && g.k > 0 ? g : null;
}

/** A point on the map (in its own units) → the aircraft drawn nearest it, within MAP_HIT, or null. */
export function craftAtMap(sim, g, px, py) {
  let best = null;
  for (const c of candidates(sim, Infinity)) {
    const mx = g.cx + (c.x - g.craft.x) * g.k;
    const my = g.cy + (c.z - g.craft.z) * g.k;
    const d = Math.hypot(mx - px, my - py);
    if (d <= MAP_HIT && (!best || d < best.d)) best = { d, c };
  }
  return best ? best.c : null;
}

function onPointer(e) {
  const sim = T.sim;
  const mm = sim && sim.minimap;
  if (!mm || !mm.canvas || !staffOn(sim)) return;
  const t = e.target;
  if (t !== mm.canvas && !(mm.el && mm.el.contains(t))) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const g = mapGeometry(sim);
  const r = mm.canvas.getBoundingClientRect();
  if (!g || !(r.width > 0)) return;
  const m = clientToMap(g, e.clientX - r.left, e.clientY - r.top, r.width, r.height);
  const w = m && mapToWorld(g, m.px, m.py);
  if (!w) return;
  e.preventDefault();
  e.stopPropagation();
  T.stats.taps++;
  tapped(sim, { x: w.x, z: w.z, craft: craftAtMap(sim, g, m.px, m.py), rect: r });
}

/** A tap on the map at world (x, z): the picker, for me or for whoever is armed; with an aircraft under it, Take over too. */
export function tapped(sim, tap) {
  T.tap = { ...tap, forId: T.armed ? T.armed.id : null, forName: T.armed ? T.armed.name : null };
  openPicker(sim);
  return T.tap;
}

/** "Teleport them" in the troll row: the next tap on the map is for them. */
export function armTeleport(id, name) {
  T.armed = isId(id) ? { id, name } : null;
  if (T.armed) feed(`🗺 Now tap the map where <b>${esc(name)}</b> should go, and pick a height`, OWNER_GOLD);
  return !!T.armed;
}
export function armed() {
  return T.armed;
}

/* ---- the picker ----------------------------------------------------------------------------- */

const ftText = (ft) => (ft <= 0 ? 'Ground' : `${ft.toLocaleString('en-GB')} ft`);

function compass(dx, dz) {
  const brg = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(brg / 45) % 8];
}

function buildPicker() {
  if (T.picker) return T.picker;
  injectOwnerStyle();
  if (!document.getElementById('owner-tp-style')) {
    const s = document.createElement('style');
    s.id = 'owner-tp-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  const el = document.createElement('div');
  el.className = 'owner-tp';
  el.dataset.ownerTp = '';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Teleport');
  el.innerHTML = `<h5>🗺 Teleport <span data-tp-who>me</span></h5><p data-tp-at></p>`
    + `<input type="range" min="0" max="${MAX_ALT_FT}" step="100" value="5000" data-tp-range aria-label="Height, in feet"><output data-tp-out>5,000 ft</output>`
    + `<div class="owner-tp-presets">${PRESET_FT.map((ft) => `<button type="button" data-tp-ft="${ft}">${ftText(ft)}</button>`).join('')}</div>`
    + `<div class="owner-tp-acts"><button type="button" class="owner-tp-go" data-tp-go>Teleport</button><button type="button" class="owner-tp-go" data-tp-take hidden></button><button type="button" data-tp-x>Cancel</button></div>`;
  el.addEventListener('click', (e) => {
    const ft = e.target.closest('[data-tp-ft]');
    if (ft) return setFt(Number(ft.dataset.tpFt));
    if (e.target.closest('[data-tp-go]')) return go(T.sim);
    if (e.target.closest('[data-tp-take]')) {
      const c = T.tap && T.tap.craft;
      closePicker();
      if (c) takeOver(T.sim, c);
      return undefined;
    }
    if (e.target.closest('[data-tp-x]')) return closePicker();
    return undefined;
  });
  el.querySelector('[data-tp-range]').addEventListener('input', (e) => setFt(Number(e.target.value), false));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePicker();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(T.sim);
    }
  });
  // Nothing typed or clicked in here is the game's.
  for (const type of ['pointerdown', 'keydown', 'keyup']) el.addEventListener(type, (e) => e.stopPropagation());
  extLayer().appendChild(el);
  T.picker = el;
  return el;
}

function setFt(ft, paintRange = true) {
  const el = T.picker;
  if (!el || !T.tap) return;
  T.tap.ft = clampAltFt(ft);
  const range = el.querySelector('[data-tp-range]');
  if (paintRange && Number(range.value) !== T.tap.ft) range.value = String(T.tap.ft);
  el.querySelector('[data-tp-out]').textContent = ftText(T.tap.ft);
  for (const b of el.querySelectorAll('[data-tp-ft]')) b.classList.toggle('is-on', Number(b.dataset.tpFt) === T.tap.ft);
}

function openPicker(sim) {
  const el = buildPicker();
  const tap = T.tap;
  const me = placeOf(mp.meId, sim) || (sim.aircraft ? { x: sim.aircraft.pos.x, y: sim.aircraft.pos.y, z: sim.aircraft.pos.z } : null);
  const them = tap.forId != null ? placeOf(tap.forId, sim) : null;
  const from = them || me;
  const startFt = from ? clampAltFt(mToFt(from.y)) : 5000;
  el.querySelector('[data-tp-who]').textContent = tap.forName || 'me';
  const dx = me ? tap.x - me.x : 0;
  const dz = me ? tap.z - me.z : 0;
  el.querySelector('[data-tp-at]').textContent = `${me ? `${(Math.hypot(dx, dz) / 1000).toFixed(1)} km ${compass(dx, dz)} of you` : 'there'}${tap.craft ? ` — ${tap.craft.name} is there` : ''}`;
  const take = el.querySelector('[data-tp-take]');
  take.hidden = !tap.craft || tap.forId != null || !ownerOn(sim);
  if (tap.craft) take.textContent = `✈ Take over ${tap.craft.name}`;
  setFt(startFt);
  // Beside the map, inside the screen: the map sits in a corner, so the picker goes towards the middle from it.
  const r = tap.rect;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const left = r && r.left + r.width / 2 > W / 2 ? Math.max(8, r.left - 310) : Math.min(W - 310, (r ? r.right : 0) + 10);
  const top = r && r.top + r.height / 2 > H / 2 ? Math.max(8, r.bottom - 260) : Math.min(H - 270, r ? r.top : 8);
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  el.hidden = false;
  setTimeout(() => el.querySelector('[data-tp-range]').focus({ preventScroll: true }), 0);
}

export function closePicker() {
  if (T.picker) T.picker.hidden = true;
  T.tap = null;
}

/** Teleport: me, here and now; them, through the host. */
function go(sim) {
  const tap = T.tap;
  if (!tap) return false;
  const y = ftToM(tap.ft || 0);
  closePicker();
  if (tap.forId != null) {
    T.armed = null;
    if (!amStaffInGame() || !mayTroll(myRole(), rosterRole(playerOf(tap.forId)))) return false;
    T.stats.sentTp++;
    feed(`🗺 Teleporting <b>${esc(tap.forName)}</b> — ${esc(ftText(tap.ft || 0))}`, OWNER_GOLD);
    return ch.toHost('owner:tp', { t: tap.forId, x: tap.x, y, z: tap.z });
  }
  const me = placeOf(mp.meId, sim) || { heading: 0, speed: 0 };
  const done = placeAircraft(sim, { x: tap.x, z: tap.z, y, headingDeg: me.heading, speed: me.speed, ground: !(tap.ft > 0) });
  if (!done) return false;
  T.stats.teleports++;
  if (sim.state === 'paused' && typeof sim.resume === 'function') sim.resume();
  bigCard('WHOOSH', done.ground ? 'on the ground' : `${Math.round(mToFt(done.y)).toLocaleString('en-GB')} ft`, 1.5);
  return true;
}

/* ---- the tools: Take over ------------------------------------------------------------------------- */

function buildTools() {
  if (T.tools) return T.tools;
  buildPicker();
  const el = document.createElement('div');
  el.className = 'owner-tools';
  el.dataset.ownerTools = '';
  el.hidden = true;
  el.innerHTML = '<button type="button" data-owner-take-list>✈ Take over <span data-take-n></span></button><span class="owner-tools-hint">🗺 tap the map to teleport</span>';
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-owner-take-list]')) toggleList(T.sim);
  });
  extLayer().appendChild(el);
  T.tools = el;
  const list = document.createElement('div');
  list.className = 'owner-take';
  list.dataset.ownerTake = '';
  list.hidden = true;
  list.setAttribute('role', 'dialog');
  list.setAttribute('aria-label', 'Take over an aircraft');
  list.innerHTML = '<h5>✈ Take over an aircraft</h5><div class="owner-take-rows" data-take-rows></div>'
    + '<div class="owner-take-foot"><span>Its pilot steps off; its route is forgotten.</span><button type="button" data-take-x>Close</button></div>';
  list.addEventListener('click', (e) => {
    const row = e.target.closest('[data-take]');
    if (row) {
      const c = (T.cands || []).find((x) => `${x.src}:${x.id}` === row.dataset.take);
      list.hidden = true;
      if (c) takeOver(T.sim, c);
      return;
    }
    if (e.target.closest('[data-take-x]')) list.hidden = true;
  });
  for (const type of ['pointerdown', 'keydown', 'keyup']) list.addEventListener(type, (e) => e.stopPropagation());
  extLayer().appendChild(list);
  T.list = list;
  return el;
}

function toggleList(sim) {
  const list = T.list;
  if (!list) return;
  if (!list.hidden) {
    list.hidden = true;
    return;
  }
  paintList(sim);
  const r = T.tools.getBoundingClientRect();
  const H = window.innerHeight;
  list.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - 310, r.left)))}px`;
  if (r.top > H / 2) {
    list.style.top = 'auto';
    list.style.bottom = `${Math.round(H - r.top + 8)}px`;
  } else {
    list.style.bottom = 'auto';
    list.style.top = `${Math.round(r.bottom + 8)}px`;
  }
  list.hidden = false;
}

function paintList(sim) {
  const rows = T.list.querySelector('[data-take-rows]');
  T.cands = candidates(sim);
  rows.innerHTML = T.cands.length
    ? T.cands.map((c) => `<button type="button" class="owner-take-row" data-take="${c.src}:${esc(String(c.id))}"><b>${esc(c.name)}</b><span>${(c.dist / 1000).toFixed(1)} km</span>`
      + `<small>${esc(c.typeName)} · ${c.onGround ? 'parked' : `${Math.round(mToFt(c.y)).toLocaleString('en-GB')} ft · flying`}</small></button>`).join('')
    : '<p>No other aircraft within 8 km.</p>';
}

/** Once a second: the tools shown in owner mode, with how many aircraft are near. */
function syncTools(sim) {
  const t = now();
  if (t - T.toolsAt < 1000) return;
  T.toolsAt = t;
  const on = staffOn(sim, ['flying', 'paused', 'debrief']);
  mapTakesTaps(sim, on);
  if (!on) {
    if (T.tools && !T.tools.hidden) {
      T.tools.hidden = true;
      if (T.list) T.list.hidden = true;
    }
    if (T.picker && !T.picker.hidden) closePicker();
    return;
  }
  const el = buildTools();
  // Take over is the owner's: an admin's bar is the map hint alone (and there is no owner chip beside it to make room for).
  const canTake = ownerOn(sim, ['flying', 'paused', 'debrief']);
  el.dataset.staff = canTake ? 'owner' : 'admin';
  const takeBtn = el.querySelector('[data-owner-take-list]');
  if (takeBtn.hidden === canTake) takeBtn.hidden = !canTake;
  if (!canTake && T.list && !T.list.hidden) T.list.hidden = true;
  const n = canTake ? candidates(sim).length : 0;
  const span = el.querySelector('[data-take-n]');
  const text = n ? `(${n})` : '';
  if (span.textContent !== text) span.textContent = text;
  if (el.hidden) el.hidden = false;
  if (T.list && !T.list.hidden) paintList(sim);
}

/* ---- the plug-in --------------------------------------------------------------------------------- */

registerExtension({
  id: 'owner-teleport',
  install(sim) {
    T.sim = sim;
    if (T.installed || typeof document === 'undefined') return;
    T.installed = true;
    document.addEventListener('pointerdown', onPointer, true);
    // Owner off: nothing of this on the screen.
    owner.on((e) => {
      if (!e.on) {
        T.armed = null;
        closePicker();
        if (T.tools) T.tools.hidden = true;
        if (T.list) T.list.hidden = true;
        mapTakesTaps(T.sim, false);
      }
    });
    if (typeof window !== 'undefined') window.__ownerTeleport = teleportDebug();
  },
  update(sim) {
    T.sim = sim;
    if (owner.active || amStaffInGame() || (T.tools && !T.tools.hidden)) syncTools(sim);
  },
  stop(sim, why) {
    if (why === 'airport') return;
    closePicker();
    if (T.list) T.list.hidden = true;
    // The map is the game's again until the next sync says the owner is still here (a debrief shows the tools again).
    mapTakesTaps(sim, false);
    // A crash debrief is where "take over" still shows (syncTools, 'debrief'); the menu is not.
    T.toolsAt = 0;
  },
});

/** For the checks and the console. */
export function teleportDebug() {
  return {
    T,
    stats: T.stats,
    candidates: () => candidates(T.sim),
    tapped: (tap) => tapped(T.sim, tap),
    setFt: (ft) => setFt(ft),
    go: () => go(T.sim),
    takeOver: (c) => takeOver(T.sim, c),
    arm: armTeleport,
    armed: () => T.armed,
    picker: () => T.picker,
    tools: () => T.tools,
    list: () => T.list,
    sync: () => {
      T.toolsAt = 0;
      syncTools(T.sim);
    },
    closePicker,
    craftAtMap: (px, py) => {
      const g = mapGeometry(T.sim);
      return g ? craftAtMap(T.sim, g, px, py) : null;
    },
  };
}
