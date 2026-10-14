/**
 * THE HEAT-SEEKER — a natural disaster, like a tornado: "heat seeking missles
 * on miltary pllanes and it as a disaster push now" (the owner, 2026-10-12).
 *
 * It is in the disasters list (registerNaturalEvent), so it is everywhere the
 * tornado is: armed before departure on the Free Flight screen, a button in
 * the pause menu's Disasters fold, and summoned for the lobby like the rest.
 * It is selectable only — `random: false` keeps it out of the randomiser, so
 * the dice never hand it to anybody.
 *
 * WHAT HAPPENS. Once you are airborne, for sixty to ninety seconds, UNMANNED
 * launchers — two low decks with a rack of tubes, off-shore where the map has
 * sea, with a lamp that swells and fades — fire heat-seeking missiles at you,
 * one or two at a time with gaps between (./heatseek/rules.js planSalvos).
 * Nobody is aboard a launcher, ever.
 *
 *   - THE WARNING. "MISSILE LAUNCH — break left and pop flares" (or right:
 *     put the missile on your beam), a red arrow on a ring round the middle
 *     of the screen pointing at each missile that is not on screen, a diamond
 *     with its range on those that are, and a soft red glow at the edges.
 *   - THE DEFENCE. Everybody gets eight pairs of flares for the disaster, on
 *     the flares key (4) and a FLARES button on a touch screen — in an
 *     airliner, a trainer, a helicopter, whatever you are flying. A flare is
 *     hotter than your engine for four and a half seconds, and a missile in
 *     its seeker's view of both may take it: more often if you are also
 *     turning hard. Too early, and it has burned out before the missile
 *     arrives; "MISSILE CLOSE" says when. Or out-turn it: a missile has a
 *     limit on how hard it can turn, and a fast jet pulling a hard break at
 *     short range is more than it can follow.
 *   - IN A HELICOPTER the missiles are slower and not as keen.
 *   - IF YOU ARE HIT. The flight model's own damage to the nearest zone
 *     (physics.js takeHit: the break-up snaps what was nearest the hit), a
 *     real airburst beside the skin, and a plain word about what to do. A big
 *     hit is the engine going and a wing or the tail coming apart: eject
 *     (Enter, twice) or put her down; a second big one and the seat fires you
 *     out for you, three seconds after the warning. An airliner or a
 *     helicopter in a mission has no seat: it is a forced landing. It is a
 *     disaster, like a tornado: nobody is hurt, ever, and nothing is graphic.
 *
 * Every flash and warning light goes through Reduce flashing (render/flash-
 * safety.js): steady glows, slow swells, the game's own capped airburst.
 * No sound is made here.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { keyName } from '../flight/input.js';
import { registerNaturalEvent } from '../game/disasters.js';
import { SPEC } from '../aircraft/physics.js';
import { heightAt } from '../world/terrain.js';
import { dimsFrom } from './crashes/motion.js';
import { explode } from './explosions.js';
import { ejectPilot } from './eject.js';
import * as R from './heatseek/rules.js';
import * as Fly from './heatseek/fly.js';
import * as UI from './heatseek/hud.js';
import { HS, launchMissile, liveMissiles } from './heatseek/world.js';
import { grantFlares, revokeFlares, setDisasterHook, heatseek } from './heatseek.js';

const D2R = Math.PI / 180;

/** The disaster's state. One at a time. */
const E = {
  on: false,
  sitesLeft: 0,
  /** When the decks were last moved because none could see you. */
  rebuilt: -99,
  sim: null,
  heli: false,
  /** Seconds of waiting for the aeroplane to be in the air (it may be armed before departure). */
  wait: 0,
  airborne: 0,
  started: false,
  /** Seconds into the firing window. */
  t: 0,
  total: 75,
  plan: [],
  planAt: 0,
  sites: [],
  siteCursor: 0,
  queue: [],
  stats: { salvos: 0, launched: 0, hits: 0, dodged: 0, decoyed: 0, bigHits: 0, ejected: false, forced: false },
  alertUntil: 0,
  alertText: '',
  autoEject: -1,
  clock: 0,
  lastEnd: null,
  done: 0,
  closeCalled: new Set(),
};

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _l = new THREE.Vector3();

function say(text, kind = 'warn', secs = 4) {
  const hud = E.sim && E.sim.hud;
  if (hud && typeof hud.notify === 'function') hud.notify(text, kind, secs);
}

function isHeli(sim) {
  return !!(sim && (sim.game === 'heli' || (sim.aircraftType && sim.aircraftType.id === 'harrier') || (SPEC && SPEC.rotor)));
}

/* ------------------------------------------------------------------ *
 * The launchers
 * ------------------------------------------------------------------ */

/**
 * Two sites round the player: one ahead (inside 35 degrees of the nose), one abeam
 * (70-110 degrees to either side), 2.3-2.9 km out — so a missile has somewhere to
 * come from that is closing, not chasing. Off-shore where there is sea.
 */
export function pickSites(ac, rng = Math.random, n = 2) {
  const hdg = (ac.heading || 0) * D2R;
  const out = [];
  for (let i = 0; i < n; i++) {
    let best = null;
    for (let tries = 0; tries < 40; tries++) {
      const off = i === 0 ? (rng() * 2 - 1) * 35 * D2R : (rng() < 0.5 ? -1 : 1) * (70 + rng() * 40) * D2R;
      const dist = 2300 + rng() * 600;
      const a = hdg + off;
      const x = ac.pos.x + Math.sin(a) * dist;
      const z = ac.pos.z - Math.cos(a) * dist;
      const h = heightAt(x, z);
      const sea = h < -4;
      const y = sea ? 0 : Math.max(0, h);
      // A missile has to be able to see the aeroplane over what is between: no hill in the way.
      const clear = lineClearance(x, y + MUZZLE_UP, z, ac.pos.x, ac.pos.y, ac.pos.z);
      const cand = { x, z, y, sea, dist, bearing: a, clear };
      // Best: sea with a clear line. Then land with one. Then whatever has the clearest line.
      const score = (clear > 25 ? 1000 : clear) + (sea ? 100 : 0);
      cand.score = score;
      if (!best || score > best.score) best = cand;
      if (sea && clear > 25) break;
    }
    out.push(best);
  }
  return out;
}

/** How high the straight line from (ax, ay, az) to (bx, by, bz) stays over the ground, at its worst: metres, negative when a hill is in the way. */
export function lineClearance(ax, ay, az, bx, by, bz, steps = 28) {
  let worst = Infinity;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    const gap = ay + (by - ay) * t - Math.max(0, heightAt(x, z));
    if (gap < worst) worst = gap;
  }
  return worst;
}

/** The muzzle of a launcher is this far above its deck. */
const MUZZLE_UP = 5.2;

function buildSites(sim, spots) {
  for (const s of E.sites) disposeSite(s);
  E.sites = [];
  for (const sp of spots) {
    const mesh = Fly.makeLauncherSite();
    mesh.position.set(sp.x, sp.y, sp.z);
    sim.scene.add(mesh);
    E.sites.push({ ...sp, mesh, born: HS.clock });
  }
}

function disposeSite(s) {
  Fly.disposeModel(s.mesh);
}

function aimSite(s, ac) {
  s.mesh.lookAt(ac.pos.x, s.mesh.position.y + 1, ac.pos.z);
  s.mesh.updateMatrixWorld(true);
}

/* ------------------------------------------------------------------ *
 * Firing at the player
 * ------------------------------------------------------------------ */

function playerTarget(sim) {
  return {
    id: 'me',
    owner: 'me',
    aim: (o) => {
      const a = sim.aircraft;
      if (!a || a.crashed) return false;
      o.x = a.pos.x; o.y = a.pos.y; o.z = a.pos.z;
      o.vx = a.vel.x; o.vy = a.vel.y; o.vz = a.vel.z;
      return true;
    },
    g: () => Math.sqrt(Math.max(0, (sim.aircraft.gLoad || 1) ** 2 - 1)),
  };
}

function fireFrom(sim, site) {
  const ac = sim.aircraft;
  aimSite(site, ac);
  const muzzle = _v.set(0, MUZZLE_UP, 0).add(site.mesh.position);
  // Toward where the aeroplane will be when a missile at ~300 m/s gets there.
  const dx = ac.pos.x - muzzle.x;
  const dy = ac.pos.y - muzzle.y;
  const dz = ac.pos.z - muzzle.z;
  const range = Math.hypot(dx, dy, dz);
  const lead = Math.min(6, range / 300);
  const tx = ac.pos.x + ac.vel.x * lead - muzzle.x;
  const ty = ac.pos.y + ac.vel.y * lead - muzzle.y;
  const tz = ac.pos.z + ac.vel.z * lead - muzzle.z;
  const tl = Math.hypot(tx, ty, tz) || 1;
  const params = E.heli ? R.FLIGHT.slow : R.FLIGHT.threat;
  const v0 = 60;
  const m = launchMissile({
    pos: { x: muzzle.x, y: muzzle.y, z: muzzle.z },
    vel: { x: (tx / tl) * v0, y: (ty / tl) * v0, z: (tz / tl) * v0 },
    params,
    owner: 'threat',
    label: 'launcher',
    target: playerTarget(sim),
    onEnd: (mm, why) => ended(sim, mm, why),
  });
  m.site = site;
  // A plume of smoke where it left.
  if (HS.trails) for (let i = 0; i < 9; i++) HS.trails.emit(muzzle.x + (Math.random() - 0.5) * 4, muzzle.y + i * 0.9, muzzle.z + (Math.random() - 0.5) * 4, 6.5, 4.5);
  E.stats.launched++;
  warnLaunch(sim, m);
  return m;
}

/** "MISSILE LAUNCH — break left and pop flares": the side that puts it on the beam. */
function warnLaunch(sim, m) {
  const ac = sim.aircraft;
  const bearing = (Math.atan2(m.s.x - ac.pos.x, -(m.s.z - ac.pos.z)) / D2R + 360) % 360;
  const rel = ((bearing - (ac.heading || 0) + 540) % 360) - 180;
  const side = R.breakSide(rel);
  const text = `MISSILE LAUNCH — break ${side} and pop flares`;
  // One word on the screen per salvo, not one per missile: the banner already says it for the second.
  const fresh = !(E.alertUntil > E.clock);
  E.alertText = text;
  E.alertUntil = E.clock + 5;
  if (fresh) say(text, 'warn', 4.5);
}

/* ------------------------------------------------------------------ *
 * A missile's ending
 * ------------------------------------------------------------------ */

function ended(sim, m, why) {
  if (!E.started) return;
  if (why === 'hit') {
    // Nobody is in the seat any more: the empty aeroplane is not the disaster's business.
    if (sim.walking && sim.walking.active) return;
    onHit(sim, m);
  } else if (why === 'decoyed') {
    E.stats.decoyed++;
    E.stats.dodged++;
    say('The missile went for a flare — clear!', 'good', 3);
  } else if (why === 'disposed') {
    // cleared with the world
  } else {
    E.stats.dodged++;
    say('The missile missed — clear!', 'good', 2.5);
  }
}

const SKIN = new THREE.Vector3();
const _cw = new THREE.Vector3();
const _bp = new THREE.Vector3();
/**
 * How big the bang on your own aeroplane is, the camera's jolt, and how far from the camera it
 * goes off. Measured with the flicker probe (tests/features/heat-seekers.browser.js, the F-22 at
 * 3,000 ft in the chase view; 5.1% of a third-of-the-screen window flickers by WCAG's measure
 * before anything happens, 8.5% with two missiles in flight):
 *
 *     on the wing, 15-20 m out, any size   whole view lit: mean luminance +0.1..+0.15, 85% (!)
 *     60 m, size 0.45                      85%     120 m, size 0.45   39%
 *     200 m, size 0.45                     9.3%    120 m, size 0.25   9.9%
 *     200 m, size 0.25                     8.8%    350 m, size 0.45   8.7%
 *
 * So a hit goes off 150 m from the camera, on the line through the aeroplane, at a size that
 * reads as a real bang there and adds about a point to the flicker. (explosions.js is real light,
 * and its own near-camera handling is a cap on the full-screen overlay, not a stand-off.)
 */
export const __tune = { size: 0.3, kick: 0.3, standoff: 150 };
const TUNE = __tune;

/**
 * The burst is on the line from the camera through the hit, `standoff` metres out: the
 * aeroplane is in front of it, the fireball just beyond the wing, never in your face.
 */
function burstPoint(sim, hit) {
  const cam = sim.camera;
  if (!cam || !(TUNE.standoff > 0)) return hit;
  cam.getWorldPosition(_cw);
  const d = _cw.distanceTo(hit);
  if (d >= TUNE.standoff) return hit;
  if (d < 1e-3) {
    // Inside the cockpit: straight ahead of the nose.
    _bp.set(0, 0, -1).applyQuaternion(sim.aircraft.quat);
  } else {
    _bp.copy(hit).sub(_cw).normalize();
  }
  return _bp.multiplyScalar(TUNE.standoff).add(_cw).clone();
}

/** A missile reached you. The aeroplane's own damage model does the rest. `force`: a severity to use (the browser check). */
function onHit(sim, m, force) {
  const ac = sim.aircraft;
  if (!ac || ac.crashed) return;
  // Where, in the aeroplane's frame; pulled onto the skin so the airburst is on the airframe, not in the air beside it.
  _l.set(m.s.x - ac.pos.x, m.s.y - ac.pos.y, m.s.z - ac.pos.z);
  _qi.copy(ac.quat).invert();
  _l.applyQuaternion(_qi);
  const dims = dimsFrom(SPEC && SPEC.hardPoints, sim.aircraftType && sim.aircraftType.plan);
  const heli = E.heli;
  const part = R.nearestPart(_l, dims, heli);
  SKIN.copy(_l);
  const ex = Math.max(1.2, dims.semi * 0.85);
  const ey = Math.max(0.8, dims.r * 0.9);
  const ez = Math.max(2, dims.L * 0.5);
  const k = Math.hypot(SKIN.x / ex, SKIN.y / ey, SKIN.z / ez) || 1;
  SKIN.multiplyScalar(1 / Math.max(1, k));
  const world = _w.copy(SKIN).applyQuaternion(ac.quat).add(ac.pos).clone();
  const closeness = Math.max(0, 1 - (m.s.hitDist || 0) / (m.s.params.fuze || 12));
  const sev = Number.isFinite(force) ? force : R.hitSeverity(closeness, Math.random());
  E.stats.hits++;
  if (TUNE.size > 0) explode(sim, burstPoint(sim, world), { kind: 'airburst', size: TUNE.size });
  if (TUNE.kick > 0 && sim.rig && typeof sim.rig.kick === 'function') sim.rig.kick(TUNE.kick);
  // The flight model's damage, to the nearest zone; the break-up snaps what was nearest the point.
  const before = ac.damage ? { ...ac.damage } : {};
  if (typeof ac.takeHit === 'function') ac.takeHit(part, sev, 'Hit by a heat-seeking missile', world);
  const big = sev >= R.BIG_HIT || (ac.worstDamage || 0) >= 0.9;
  const words = {
    leftWing: 'left wing', rightWing: 'right wing', nose: 'nose', tail: heli ? 'tail boom' : 'tail', fuselage: heli ? 'cabin' : 'fuselage',
  };
  if (big) {
    E.stats.bigHits++;
    // The engine goes with it.
    if (ac.failures && !ac.failures.roughEngine && typeof sim.toggleFailure === 'function') sim.toggleFailure('roughEngine');
    say(`HIT — the ${words[part] || part} is badly damaged and the engine is hurt. Eject (Enter, twice) or put her down!`, 'warn', 7);
    // Two big ones: the seat fires you out, a moment after the warning.
    if ((E.stats.bigHits >= 2 || (ac.worstDamage || 0) >= 0.98) && E.autoEject < 0) {
      E.autoEject = 4;
      say('The airframe is failing — the seat fires in four seconds (or press Enter twice now)', 'warn', 5);
    }
  } else {
    say(`HIT — the ${words[part] || part} is damaged. Fly gently and land when you can.`, 'warn', 5);
  }
  E.lastHit = { part, severity: sev, big, world: { x: world.x, y: world.y, z: world.z }, damageBefore: before, damageAfter: ac.damage ? { ...ac.damage } : {} };
}

/** For the browser check: a hit of a known size, as if a missile had gone off beside the aeroplane. */
export const __onHit = (sim, m, severity) => onHit(sim, m, severity);

/* ------------------------------------------------------------------ *
 * Starting, running, finishing
 * ------------------------------------------------------------------ */

function reset() {
  for (const s of E.sites) disposeSite(s);
  E.sites = [];
  E.on = false;
  E.started = false;
  E.wait = 0;
  E.airborne = 0;
  E.t = 0;
  E.plan = [];
  E.planAt = 0;
  E.queue = [];
  E.autoEject = -1;
  E.alertUntil = 0;
  E.closeCalled.clear();
  UI.setThreats([], 1, 1);
  UI.setAlert('');
  UI.setGlow(0, 0);
}

function airborne(sim) {
  const ac = sim.aircraft;
  return !!ac && !ac.onGround && (ac.agl || 0) > 45;
}

function begin(sim) {
  const ac = sim.aircraft;
  E.started = true;
  E.rebuilt = -99;
  E.t = 0;
  E.total = 60 + Math.random() * 30;
  E.plan = R.planSalvos(E.total);
  E.planAt = 0;
  buildSites(sim, pickSites(ac));
  for (const s of E.sites) aimSite(s, ac);
  grantFlares(sim);
  say(`HEAT-SEEKER — unmanned launchers have you. Flares: press ${flareKey(sim)}, or the FLARES button`, 'warn', 6);
}

function flareKey(sim) {
  return keyName('flares', sim);
}

/** Finish: the launchers go quiet, a plain word on how it went, the pause menu's button goes out. */
function finish(sim, why) {
  if (!E.on) return;
  E.on = false;
  const st = E.stats;
  E.lastEnd = { why, ...st, t: E.t };
  if (why === 'done') {
    say(st.hits ? `The launchers have gone quiet — you took ${st.hits} hit${st.hits === 1 ? '' : 's'} and dodged ${st.dodged}.` : `The launchers have gone quiet — you dodged all ${st.dodged}!`, st.hits ? 'info' : 'good', 6);
  }
  // Anything still in the air when it ends for another reason goes with it.
  if (why !== 'done') for (const m of threats()) m.dispose();
  // Flares were lent for the disaster: a trainer or an airliner has none again.
  if (sim) revokeFlares(sim);
  if (sim && sim.activeEvents) {
    delete sim.activeEvents.heatSeeker;
    if (sim.menus && sim.menus.syncNatural) sim.menus.syncNatural(sim.activeEvents);
  }
  // The decks stay a moment so a pilot can see where it came from, then go.
  E.sitesLeft = 6;
}

/* ------------------------------------------------------------------ *
 * The event
 * ------------------------------------------------------------------ */

export const HEAT_SEEKER_EVENT = {
  id: 'heatSeeker',
  name: 'Heat-Seeker',
  hint: 'Unmanned launchers fire heat-seeking missiles at you for a minute or so: pop flares and break',
  get warn() {
    return this.why === 'mode'
      ? 'The Heat-Seeker can only be summoned in Free Flight.'
      : this.why === 'busy'
        ? 'The Heat-Seeker is already under way.'
        : 'HEAT-SEEKER — launchers are tracking you. Pop flares and break when a missile launches.';
  },
  why: null,
  kind: 'bad',
  // Only ever on purpose (poolForMap in game/disasters.js leaves it out of the randomiser).
  random: false,
  duration: 200,
  apply(sim) {
    this.why = null;
    if (!sim || sim.mode !== 'free' || !sim.aircraft || (sim.state !== 'flying' && sim.state !== 'paused')) {
      this.why = 'mode';
      return false;
    }
    if (E.on) {
      this.why = 'busy';
      return false;
    }
    reset();
    E.sim = sim;
    E.on = true;
    E.heli = isHeli(sim);
    E.stats = { salvos: 0, launched: 0, hits: 0, dodged: 0, decoyed: 0, bigHits: 0, ejected: false, forced: false };
    E.lastHit = null;
    E.lastEnd = null;
    E.clock = 0;
    E.autoEject = -1;
    // Right away if you are already flying; after takeoff if it was armed on the runway.
    if (airborne(sim)) begin(sim);
    return true;
  },
};

registerNaturalEvent(HEAT_SEEKER_EVENT);

/* ------------------------------------------------------------------ *
 * Per frame
 * ------------------------------------------------------------------ */

function threats() {
  return liveMissiles((m) => m.owner === 'threat');
}

function update(sim, dt) {
  E.sim = sim;
  E.clock += dt;
  // The decks come down a few seconds after the last missile.
  if (!E.on) {
    if (E.sitesLeft > 0 && !threats().length) {
      E.sitesLeft -= dt;
      if (E.sitesLeft <= 0) {
        for (const s of E.sites) disposeSite(s);
        E.sites = [];
      }
    }
    return;
  }
  const ac = sim.aircraft;
  // Out of the seat, or the aeroplane is gone: the disaster has nobody to chase.
  if (!ac || ac.crashed || (sim.walking && sim.walking.active)) {
    if (sim.walking && sim.walking.active) E.stats.ejected = true;
    finish(sim, ac && ac.crashed ? 'crashed' : 'ejected');
    return;
  }
  // The pause menu's button stays lit while it runs.
  if (sim.activeEvents && 'heatSeeker' in sim.activeEvents) sim.activeEvents.heatSeeker = Math.max(sim.activeEvents.heatSeeker, 3);

  if (!E.started) {
    E.wait += dt;
    if (airborne(sim)) E.airborne += dt;
    else E.airborne = 0;
    if (E.airborne > 3) begin(sim);
    else if (E.wait > 900) finish(sim, 'never flew');
    return;
  }

  E.t += dt;
  // The next salvo is due.
  while (E.planAt < E.plan.length && E.t >= E.plan[E.planAt].at) {
    const s = E.plan[E.planAt++];
    E.stats.salvos++;
    for (let i = 0; i < s.count; i++) E.queue.push({ at: E.t + i * 1.2 });
  }
  while (E.queue.length && E.queue[0].at <= E.t) {
    // The next deck in turn that can see you over the ground; if none can (a hill between you and both), a moment later.
    let site = null;
    for (let k = 0; k < E.sites.length && !site; k++) {
      const cand = E.sites[E.siteCursor++ % E.sites.length];
      if (lineClearance(cand.x, cand.y + MUZZLE_UP, cand.z, ac.pos.x, ac.pos.y, ac.pos.z) > 15) site = cand;
    }
    if (!site) {
      // Neither can see you (a hill, low over the coast): put the decks somewhere that can, not more than every few seconds.
      if (E.t - E.rebuilt > 3) {
        E.rebuilt = E.t;
        buildSites(sim, pickSites(ac));
        for (const s2 of E.sites) aimSite(s2, ac);
      }
      E.queue[0].at = E.t + 0.6;
      break;
    }
    E.queue.shift();
    fireFrom(sim, site);
  }
  for (const s of E.sites) {
    if (s.mesh.userData.tick) s.mesh.userData.tick(HS.clock);
    aimSite(s, ac);
  }

  // "MISSILE CLOSE" — the call for flares, once per missile.
  for (const m of threats()) {
    if (m.fooled || m.s.lost) continue;
    const ttc = m.closing > 30 ? m.range / m.closing : Infinity;
    if (!E.closeCalled.has(m.id) && m.range < 1300 && ttc < 4.5) {
      E.closeCalled.add(m.id);
      const left = heatseek.flares.left;
      if (left > 0) say(`MISSILE CLOSE — FLARES NOW (${left} left)`, 'warn', 2.5);
      E.alertText = 'MISSILE CLOSE — FLARES NOW';
      E.alertUntil = E.clock + 2.5;
    }
  }

  // Two big hits: the seat fires you out, after a short count.
  if (E.autoEject >= 0) {
    E.autoEject -= dt;
    if (E.autoEject <= 0) {
      E.autoEject = -1;
      if (ejectPilot(sim)) {
        E.stats.ejected = true;
        say('The seat fired you out — nobody goes down with the aeroplane. Your parachute is opening.', 'good', 6);
      } else {
        E.stats.forced = true;
        say('No way out of this one — put her down as gently as you can.', 'warn', 6);
      }
    }
  }

  // Done: the window is over and the last missile has finished.
  if (E.t >= E.total && !E.queue.length && !threats().length && E.planAt >= E.plan.length) finish(sim, 'done');
}

/** The screen: arrows, diamonds, the banner and the glow (called each frame by heatseek.js). */
function paint(sim, dt) {
  const list = threats();
  const cam = sim.camera;
  if (!list.length && !(E.on && E.alertUntil > E.clock)) {
    UI.setThreats([], 1, 1);
    UI.setAlert('');
    UI.setGlow(0, E.clock);
    return;
  }
  const w = window.innerWidth;
  const h = window.innerHeight;
  const out = [];
  let worst = 0;
  if (cam) {
    cam.updateMatrixWorld(true);
    for (const m of list) {
      _v.set(m.s.x, m.s.y, m.s.z);
      const cs = _w.copy(_v).applyMatrix4(cam.matrixWorldInverse);
      const proj = _v.clone().project(cam);
      const front = cs.z < 0;
      const x = (proj.x * 0.5 + 0.5) * w;
      const y = (-proj.y * 0.5 + 0.5) * h;
      const onScreen = front && x > 24 && x < w - 24 && y > 24 && y < h - 24;
      const ang = Math.abs(cs.x) + Math.abs(cs.y) < 1e-3 ? Math.PI : Math.atan2(cs.x, cs.y);
      out.push({ onScreen, x, y, ang, range: m.range });
      const ttc = m.closing > 30 ? m.range / m.closing : 99;
      if (!m.fooled) worst = Math.max(worst, Math.max(0, Math.min(1, 1 - ttc / 9)));
    }
    out.sort((a, b) => a.range - b.range);
  }
  UI.setThreats(out, w, h);
  const missileUp = list.length > 0;
  UI.setAlert(E.alertUntil > E.clock ? E.alertText : missileUp ? 'MISSILE INBOUND' : '', missileUp ? `${heatseek.flares.left} flare${heatseek.flares.left === 1 ? '' : 's'} left — press ${flareKey(sim)}` : '');
  UI.setGlow(missileUp ? 0.25 + worst * 0.75 : 0, E.clock);
}

setDisasterHook({ active: () => E.on || E.sitesLeft > 0, paint });

/*
 * Every Disasters button wears the same cloud; this one is a lock-on ring, so a kid scanning the
 * panel for "the missile one" finds it. Same stroke and size as ui/icons.js, on this button only.
 */
const RING =
  '<svg class="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
  'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" data-heatseeker-icon>' +
  '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1.6"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/></svg>';

export function paintHeatSeekerIcon(sim) {
  const host = sim && sim.menus && sim.menus.screens && sim.menus.screens.pause;
  if (!host || typeof host.querySelectorAll !== 'function') return 0;
  let n = 0;
  host.querySelectorAll('[data-natural="heatSeeker"]').forEach((b) => {
    if (b.querySelector('[data-heatseeker-icon]')) return;
    const old = b.querySelector('svg.icon');
    if (old) old.outerHTML = RING;
    else b.insertAdjacentHTML('afterbegin', RING);
    n++;
  });
  return n;
}

registerExtension({
  id: 'heatseek-disaster',

  install(sim) {
    paintHeatSeekerIcon(sim);
  },

  startMode(sim) {
    paintHeatSeekerIcon(sim);
    reset();
    E.sim = sim;
    E.sitesLeft = 0;
    E.autoEject = -1;
  },

  stop(sim) {
    reset();
    E.sitesLeft = 0;
  },

  buildWorld() {
    // The launchers were in the old world's scene.
    E.sites = [];
    E.on = false;
    E.started = false;
  },

  update,

  devActions: [
    {
      label: 'Heat-Seeker disaster',
      hint: 'Sets the Heat-Seeker going now (Free Flight): launchers fire missiles at you for a minute or so; flares on 4.',
      run(sim) {
        if (sim && typeof sim.triggerNatural === 'function') sim.triggerNatural('heatSeeker');
      },
    },
  ],
});

/** For the tests and the console. */
export function heatSeekerDebug() {
  return {
    E,
    sites: E.sites.map((s) => ({ x: Math.round(s.x), z: Math.round(s.z), sea: s.sea, dist: Math.round(s.dist) })),
    threats: threats().map((m) => ({ id: m.id, range: Math.round(m.range), speed: Math.round(m.s.speed), fooled: m.fooled, lost: m.s.lost, t: +m.s.t.toFixed(1) })),
    stats: { ...E.stats },
    last: E.lastEnd,
    lastHit: E.lastHit,
  };
}
