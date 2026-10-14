/**
 * CRASH PHYSICS — "we need awesome crash physeics btw", and then "add break
 * points to all plane models, so if you crash those parts break, depending
 * on how close they are to which part are crashed" (the owner, 2026-10-04).
 *
 * Every aircraft model now has break zones (src/game/breakup.js): the nose,
 * the centre and rear fuselage, the inner and outer wing each side, the fin,
 * each tailplane, each gear leg, each engine — and on a helicopter the main
 * rotor, the tail boom and the tail rotor. They are found on the DRAWN model,
 * triangle by triangle (src/game/breakup-mesh.js), so they fit every model
 * the game draws without touching one model builder.
 *
 * WHEN SOMETHING HITS, the zone nearest the contact takes the blow and the
 * others less the further away they are, over a reach that grows with the
 * closing energy (planBreak). So:
 *   a wing tip clipping the ground   snaps off that wing's outer zone
 *   a tail strike                    bends or breaks the fin and tailplanes
 *   a nose-first dive                crushes the nose; harder, the fuselage
 *                                    breaks into sections
 *   a belly / heavy landing          scrapes, and the gear legs fold
 *   a huge hit                       takes nearly everything
 * What comes off becomes a rigid body (src/game/breakup-body.js) that
 * tumbles, bounces, slides and scrapes — sparks on concrete, dust on grass, a
 * splash and then floating or sinking at sea — and comes to rest as a
 * wreck. What is left of the airframe goes on as before (the crash
 * choreography of ./crashes.js, or flying on) with the zone gone. Fuel and
 * engines burn and smoke where they lie, with the odd secondary pop
 * (./breakup/fx.js). The existing fireball and smoke column are untouched.
 *
 * SURVIVABLE DAMAGE. With the damage model on (Settings: "Damage instead of
 * crashes"), a knock that does not end the flight can still take a piece:
 * an outer wing, the fin, a tailplane, an engine. The flight model reads what
 * is gone through ../aircraft/damage-handling.js — the ONE place damage turns
 * into handling — so losing an outer wing rolls you towards it, losing the
 * fin makes the yaw wander, losing an engine costs thrust and swings the
 * nose. Nothing gone, nothing changes: an undamaged flight is bit-for-bit
 * the same flight.
 *
 * EVERYWHERE: your own aeroplane, the helicopter (the rotor breaks up into
 * its blades), and the other aircraft you hit in the sky (./sky.js tells us,
 * and they come apart where they were struck while their owners bring them
 * down).
 *
 * THE FEEL: a hard camera kick, a short slow-motion beat (Settings → Flying,
 * on by default; never during a mayday or on foot), and an INSTANT REPLAY —
 * one key (` by default, in the key registry under View) or the button on
 * the crash screen — that plays the last seconds again from just before the
 * hit, slower, with the camera orbiting the wreck.
 *
 * SCHOOL-SAFE: nobody is ever hurt. The cockpit is in the centre zone, which
 * never comes away; crews of aircraft you hit come down under parachutes
 * (sky.js). T-Pose Harrison is a man, so his zones are soft: nothing of him
 * ever comes off or bends.
 *
 * PERFORMANCE: pieces are pooled with a cap (10 on Low, 16 Medium, 24 High,
 * 32 Ultra; the oldest at rest is cleared first), effects are pooled, an
 * asleep piece costs nothing, and with nothing broken the per-frame cost is
 * one early return.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension, extLayer, extStatus, extKeyContext } from '../game/extensions.js';
import { isKey, keyName } from '../flight/input.js';
import { heightAt, platformAt, isPaved, obstacleAt } from '../world/terrain.js';
import { SPEC, EVENTS } from '../aircraft/physics.js';
import { AIRCRAFT, getAircraft } from '../aircraft/types.js';
import { ZONES, CORE, frameFor, refineFrame, layoutFor, planBreak, lostFrom } from '../game/breakup.js';
import { surveyModel, classifyModel, breakZones, deformZones, restoreModel, disposePiece, isBroken, bakeWhole } from '../game/breakup-mesh.js';
import { makeBody, stepBody } from '../game/breakup-body.js';
import { BreakupFx } from './breakup/fx.js';
import { onBodyHit, BODY } from './sky.js';
import { renderedHeight } from './explosions.js';
import { createUniformPerson, uniformFor } from './uniforms.js';
import { CRASH_SECONDS, dimsFrom } from './crashes/motion.js';
import { syncAircraftModel } from '../aircraft/model-adapter.js';
import { FLASH } from '../render/flash-safety.js';

/** Pieces in the world at once, by quality. */
export const PIECE_CAP = { low: 10, medium: 16, high: 24, ultra: 32 };
/**
 * How fast a piece may turn over. A tumbling piece's ends really move at a
 * couple of tens of metres a second, so a big one turns slowly and a small
 * one fast: TIP_SPEED over its half-size, between MIN and 30 rad/s (a flat
 * 30 had an airliner's fuselage section rolling over five times a second).
 * And a piece turning over is a flasher of its own — its lit and its shaded
 * sides swap over twice a turn — so with Reduce flashing on (the default)
 * nothing turns faster than REDUCED: under one turn a second.
 */
export const SPIN = { TIP_SPEED: 18, REDUCED: 5, MIN: 1.5 };
export function spinCap(size, reduce = FLASH.reduce) {
  const r = 0.5 * (size && size.isVector3 ? size.length() : Number(size) || 1);
  const own = clamp(SPIN.TIP_SPEED / Math.max(0.3, r), SPIN.MIN, 30);
  return reduce ? Math.min(own, SPIN.REDUCED) : own;
}

/** The slow-motion beat: this fraction of real time, for this long (real seconds), then back over EASE. */
export const SLOWMO = { scale: 0.3, hold: 0.55, ease: 0.3 };
/**
 * The replay: how far before the hit it starts, how long it records after,
 * how fast it plays — and, with Reduce flashing on, how much further back its
 * camera orbits. Measured (tests/flicker-probe.js), the A320's replay after a
 * cartwheel put 19-30% of WCAG's 10-degree field flashing — the pieces
 * tumbling past a close camera again, over the standard's 25%; half as far
 * back again, 6-19% (nose-first, 6-13%) on its own — but 18-27% where the
 * self-test crashes it, over the line one run in five (the v63 repair). Twice
 * as far back: 11-12% there. The crash cam stands back too (crashes.js
 * CRASH_CAM_BACK_REDUCED), less far: it holds 14-16% there.
 */
export const REPLAY = { pre: 1.5, post: 6.5, speed: 0.55, hz: 30, backReduced: 2 };

const S = {
  sim: null,
  group: null,
  fx: null,
  quality: 'high',
  pieces: [],
  models: new Set(),
  listenedOn: null,
  slow: { left: 0, ease: 0 },
  pre: [],
  preAcc: 0,
  rec: null,
  replay: null,
  lastDebrief: null,
  label: null,
  bar: null,
  warned: false,
  clock: 0,
  /** The player's aeroplane going down slowly in the sea (startSink). */
  sink: null,
  /** Life rafts, each with somebody in it, bobbing where an aeroplane went in. */
  rafts: [],
  /** Aircraft hit in the sky, watched until they are down: { body, model, sink } */
  npcs: [],
  swamped: false,
  /** The last few plans, newest last (stats.lastPlan is the newest). */
  plans: [],
  stats: { breaks: 0, pieces: 0, peak: 0, ms: 0, msMax: 0, idleFrames: 0, lastPlan: null, lastMs: 0, survivable: 0, npc: 0, slowmo: 0, replays: 0, sinks: 0, wrecksSunk: 0, rafts: 0, culled: 0 },
};

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function live() {
  try {
    const me = extStatus().find((e) => e.id === 'breakup');
    return !me || me.live;
  } catch (e) {
    return true;
  }
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/* ------------------------------------------------------------------ *
 * The world the pieces land on
 * ------------------------------------------------------------------ */

function drawnHeight(x, z) {
  try {
    const h = renderedHeight(x, z, S.quality);
    if (Number.isFinite(h)) return h;
  } catch (e) {
    /* fall through */
  }
  return heightAt(x, z);
}

/** The surface under a point: { y, nx, ny, nz, kind } — 'water', 'deck', 'paved' or 'ground'. */
function surface(x, z, out) {
  const deck = platformAt(x, z);
  if (deck) {
    out.y = deck.y;
    out.nx = 0;
    out.ny = 1;
    out.nz = 0;
    out.kind = 'deck';
    return out;
  }
  const sea = heightAt(x, z);
  if (sea < 0) {
    out.y = 0;
    out.nx = 0;
    out.ny = 1;
    out.nz = 0;
    out.kind = 'water';
    out.floor = sea;
    return out;
  }
  const h = drawnHeight(x, z);
  const e = 1.5;
  const hx = drawnHeight(x + e, z) - h;
  const hz = drawnHeight(x, z + e) - h;
  const l = Math.hypot(hx, e, hz) || 1;
  out.y = h;
  out.nx = -hx / l;
  out.ny = e / l;
  out.nz = -hz / l;
  out.kind = isPaved(x, z) ? 'paved' : 'ground';
  return out;
}

const ENV = {
  surface,
  obstacle: (x, y, z) => obstacleAt(x, y, z),
  onScrape(b, x, y, z, speed, kind) {
    if (!S.fx || b.piece?.far) return;
    if (kind === 'paved' || kind === 'deck') S.fx.sparks(x, y, z, speed, 4, b.vel);
    else if (Math.random() < 0.6) S.fx.dust(x, y, z, Math.min(2, 0.5 + b.radius * 0.3), 2);
  },
  onImpact(b, x, y, z, speed, kind) {
    if (!S.fx || b.piece?.far) return;
    if (kind === 'paved' || kind === 'deck') S.fx.sparks(x, y, z, speed, Math.min(12, 3 + Math.round(speed * 0.5)));
    S.fx.dust(x, y, z, Math.min(3, 0.6 + b.radius * 0.4), kind === 'paved' ? 2 : 5, kind === 'paved' ? [0.45, 0.44, 0.42] : null);
  },
  onSplash(b, x, z, speed) {
    if (S.fx && !b.piece?.far) S.fx.splash(x, z, speed, Math.min(3, 0.6 + b.radius * 0.35));
  },
  onBubble(b, x, z) {
    if (!S.fx || b.piece?.far) return;
    S.fx.bubbles(x, z, 2, Math.min(3, b.radius * 0.6));
    if (Math.random() < 0.12) S.fx.foam(x, z, Math.min(2.5, 0.5 + b.radius * 0.3));
  },
};

/* ------------------------------------------------------------------ *
 * Breaking a model
 * ------------------------------------------------------------------ */

/** Which type a model is, as best we can tell. */
function typeOf(model, typeId) {
  const id = typeId || (model && model.userData && (model.userData.aircraftId || model.userData.civil));
  return (id && AIRCRAFT.find((t) => t.id === id)) || null;
}

/** The zones of this model, as drawn now. */
function zonesOf(sim, model, type) {
  const skip = new Set();
  if (sim && sim.cockpit) skip.add(sim.cockpit);
  // The heat-seekers on their pylons (src/features/heatseek.js) are hung on the model but are not airframe.
  if (sim && sim.weaponsRig) skip.add(sim.weaponsRig);
  const survey = surveyModel(model, { skip });
  const config = model.userData && model.userData.fleetBridge ? model.userData.config : null;
  const t = type || typeOf(model) || getAircraft();
  const frame = refineFrame(frameFor(t, config), survey);
  const layout = layoutFor(frame);
  return classifyModel(survey, layout);
}

/** Body-metre point of a world point on this model. */
function toBody(model, world, out) {
  model.updateMatrixWorld(true);
  const s = model.getWorldScale(_s).x || 1;
  return out.copy(world).applyMatrix4(_m.copy(model.matrixWorld).invert()).multiplyScalar(s);
}

function modelPose(model, pos, quat) {
  model.updateMatrixWorld(true);
  model.matrixWorld.decompose(pos, quat, _s);
}

/**
 * Put the player's model where the aeroplane IS, before reading a contact
 * point off it. The game moves the model to the aeroplane once a frame, after
 * the flight model has run — and a crash or a knock is emitted from inside
 * the flight model, so at that instant the model is still where the aeroplane
 * was a frame ago: 1.2 m behind at 70 m/s, 3 m at a fighter's 200, and
 * anywhere at all after a teleport (a staged crash, a reset). A wing tip's
 * strike point read against a model a frame behind lands in the nose. The
 * fleet pack's own crash, once begun, poses its model itself.
 */
function poseLikeAircraft(model, ac) {
  if (!model || !ac || !ac.pos || !ac.quat) return;
  try {
    syncAircraftModel(model, ac);
  } catch (e) {
    model.position.copy(ac.pos);
    model.quaternion.copy(ac.quat);
  }
  if (!model.matrixAutoUpdate) model.updateMatrix();
  model.updateMatrixWorld(true);
}

/**
 * Break `model` at `hit` and set the pieces loose.
 *
 *   hit.world     contact point, world
 *   hit.normal    the surface's normal there, world (out of the surface)
 *   hit.velocity  the touching point's velocity relative to the surface, world
 *   hit.energy    J/kg, instead of the velocity's
 *   hit.bodyVel   the aircraft's own velocity (what the pieces carry)
 *   hit.omega     its angular velocity, world
 *   hit.gearDown, hit.survivable
 *   hit.owner     'player' | 'npc'
 *
 * Returns { plan, pieces, asg } or null.
 */
export function breakModel(sim, model, type, hit) {
  if (!model || !model.isObject3D) return null;
  const t0 = now();
  const asg = zonesOf(sim, model, type);
  const layout = asg.layout;
  model.updateMatrixWorld(true);
  _q.copy(model.getWorldQuaternion(new THREE.Quaternion()));
  _qi.copy(_q).invert();
  const toLocal = (v) => v.clone().applyQuaternion(_qi).toArray();
  const pLocal = toBody(model, hit.world, new THREE.Vector3()).toArray();
  const plan = planBreak(layout, {
    point: pLocal,
    normal: toLocal(hit.normal || _v.set(0, 1, 0)),
    velocity: hit.velocity ? toLocal(hit.velocity) : [0, 0, 0],
    energy: hit.energy,
    survivable: !!hit.survivable,
    gearDown: hit.gearDown == null ? 1 : hit.gearDown,
  }, asg.boxes);
  // Low quality: fewer, bigger pieces — a tip that broke off on its own stays on its wing.
  let pieces = plan.pieces;
  if (S.quality === 'low') pieces = mergeForLow(layout, pieces);
  const made = layout.soft ? [] : breakZones(asg, pieces, { rotorBlades: S.quality === 'low' ? 2 : 4 });
  if (!layout.soft) deformZones(asg, plan.actions, { point: pLocal, normal: toLocal(hit.normal || _v.set(0, 1, 0)) });
  watchModel(model);
  // Out into the world.
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  modelPose(model, pos, quat);
  const centre = pos.clone();
  const mass = Math.max(200, (SPEC && SPEC.mass) || 1100);
  const totalTris = Object.values(asg.counts).reduce((a, b) => a + b, 0) || 1;
  const bodyVel = hit.bodyVel || new THREE.Vector3();
  const omega = hit.omega || new THREE.Vector3();
  const out = [];
  // The first burning piece always catches again a moment later; the rest may.
  let popped = false;
  for (const p of made) {
    const world = p.com.clone().applyQuaternion(quat).add(pos);
    p.group.position.copy(world);
    p.group.quaternion.copy(quat);
    p.group.matrixAutoUpdate = true;
    const e = Math.max(...p.zones.map((z) => (plan.actions.find((a) => a.zone === z) || { e: 0 }).e), 0);
    // What it was doing, plus a shove out from the airframe and off the ground.
    const arm = world.clone().sub(centre);
    const v = bodyVel.clone().multiplyScalar(0.78).add(_v.copy(omega).cross(arm));
    const out2 = arm.clone().setY(0);
    if (out2.lengthSq() > 1e-6) out2.normalize();
    const kick = 1.5 + Math.sqrt(e) * 0.45;
    v.addScaledVector(out2, kick);
    if (hit.normal) v.addScaledVector(hit.normal, 1 + Math.sqrt(e) * 0.35);
    v.add(_v.set(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).multiplyScalar(kick));
    const spin = omega.clone().add(_v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2 + Math.sqrt(e) * 0.5));
    if (p.rotorBlade) {
      // A blade leaves along its own line of flight, turning end over end.
      const tang = _w.set(-arm.z, 0, arm.x);
      if (tang.lengthSq() > 1e-6) v.addScaledVector(tang.normalize(), 12);
      spin.y += 14;
    }
    const share = clamp(p.tris / totalTris, 0.03, 0.45);
    // At sea: a tip, a tailplane, a blade, a leg is light enough to float and
    // drift; anything with an engine or a section of fuselage in it floats on
    // its air for a while and then goes down slowly, heavy end first.
    const light = !p.engine && p.zones.every((z) => /Outer|tailplane|^fin$|rotor|tailRotor|^gear/.test(z)) && p.size.length() < layout.frame.L * 0.6;
    const body = makeBody({
      position: world,
      quaternion: quat,
      velocity: v,
      omega: spin,
      mass: mass * share * (p.engine ? 1.8 : 1),
      size: p.size,
      float: light ? 1.7 : 1.3,
      light,
      heavy: p.zones.includes('nose') || p.engine ? -1 : p.zones.includes('rear') ? 1 : 0,
      maxSpin: spinCap(p.size),
    });
    const piece = { group: p.group, body, zones: p.zones, owner: hit.owner || 'player', born: S.clock, far: false, engine: p.engine, fuel: p.fuel, rotorBlade: p.rotorBlade, model };
    body.piece = piece;
    addPiece(piece);
    out.push(piece);
    // Fire where the fuel and the engines are, and something catching later.
    if (S.fx && (p.engine || p.fuel) && !p.rotorBlade) {
      const size = clamp(0.5 + p.size.length() * 0.12, 0.6, 3.2);
      S.fx.fire((o) => (piece.gone || piece.body.sunk ? false : (o.copy(piece.group.position), (o.y += 0.2), true)), 10 + Math.random() * 10, size);
      if (!popped || Math.random() < 0.8) {
        popped = true;
        S.fx.later(0.7 + Math.random() * 2.6, (o) => (piece.gone ? false : (o.copy(piece.group.position), true)), size * 0.9, () => {
          if (sim && sim.rig && typeof sim.rig.kick === 'function' && piece.owner === 'player') sim.rig.kick(0.3);
        });
      }
    }
  }
  // The airframe burns where a wing came off it.
  if (S.fx && !layout.soft) {
    const f = layout.frame;
    for (const p of made) {
      const inner = p.zones.find((z) => z === 'wingInnerL' || z === 'wingInnerR');
      if (!inner || !f.wing) continue;
      const side = ZONES[inner].side;
      const local = new THREE.Vector3(side * f.wing.rootX, f.wing.y, (f.wing.rootLE + f.wing.rootTE) / 2);
      const s = model.getWorldScale(_s).x || 1;
      local.multiplyScalar(1 / s);
      S.fx.fire((o) => (model.parent ? (o.copy(local).applyMatrix4(model.matrixWorld), true) : false), 14, clamp(f.L * 0.05, 0.8, 2.6));
    }
  }
  // The fleet's own crash body is made of what is still on: tell it.
  if (model.userData && typeof model.userData.refreshStrikeGeometry === 'function' && made.length) {
    try {
      model.userData.refreshStrikeGeometry();
    } catch (e) {
      /* its body rebuilds on its own next contact */
    }
  }
  const ms = now() - t0;
  S.stats.breaks++;
  S.stats.lastMs = ms;
  S.stats.lastPlan = {
    owner: hit.owner || 'player',
    type: type ? type.id : typeOf(model)?.id || null,
    energy: Math.round(plan.energy * 10) / 10,
    hitZone: plan.hitZone,
    pieces: pieces.map((p) => p.join('+')),
    actions: plan.actions.map((a) => `${a.zone}:${a.action}`),
    ms: Math.round(ms * 10) / 10,
  };
  // The last few, for the tests and the console (a mid-air breaks two at once).
  S.plans.push(S.stats.lastPlan);
  if (S.plans.length > 6) S.plans.shift();
  return { plan, pieces: out, asg };
}

function mergeForLow(layout, pieces) {
  // A piece whose parent is also coming off joins its parent's piece.
  const owner = new Map();
  for (const p of pieces) owner.set(p[0], p);
  const out = [];
  for (const p of pieces) {
    let par = layout.parent[p[0]];
    let host = null;
    while (par && par !== CORE) {
      if (owner.has(par)) host = owner.get(par);
      par = layout.parent[par];
    }
    if (host && !(p.length === 1 && p[0] === 'rotor')) host.push(...p);
    else out.push(p);
  }
  return out;
}

/** Put a broken model back the moment it leaves the scene, before anyone disposes it. */
function watchModel(model) {
  if (S.models.has(model)) return;
  S.models.add(model);
  const onRemoved = () => {
    model.removeEventListener('removed', onRemoved);
    S.models.delete(model);
    // An aircraft its owner tidies away where it went into the sea: what was
    // left of it stays there, sinking slowly. (Before the restore: the wreck
    // is what was left, not the aeroplane as built.)
    try {
      const w = model.matrixWorld;
      const x = w.elements[12];
      const y = w.elements[13];
      const z = w.elements[14];
      if (model.userData.breakupNpc && live() && heightAt(x, z) < 0 && y < 6) sinkingWreck(model, w.clone(), { owner: 'npc' });
    } catch (e) {
      /* the wreck is decoration */
    }
    restoreModel(model);
    for (const p of S.pieces) if (p.model === model) p.model = null;
  };
  model.addEventListener('removed', onRemoved);
  model.userData.breakupWatch = onRemoved;
}

function unwatch(model) {
  const fn = model && model.userData && model.userData.breakupWatch;
  if (fn) model.removeEventListener('removed', fn);
  if (model && model.userData) model.userData.breakupWatch = null;
  S.models.delete(model);
}

/**
 * A model back as built. The fleet pack's aeroplanes crush their own skin —
 * and move their own window panes with it — in the game's crash entry
 * BEFORE we survey them, so what our record saved of their instanced meshes
 * is the pack's crushed state. main.js puts a new flight's model back in this
 * order: the pack's own reset (syncAircraftModel), then the features'
 * update, ours — so restoring our record alone wrote the crushed panes back
 * over the pack's reset. Its reset runs again after ours, which puts what it
 * owns back; it is idempotent and cheap.
 */
function putBack(model) {
  restoreModel(model);
  const u = model && model.userData;
  if (u && u.fleetBridge && typeof u.resetDamage === 'function') {
    try {
      u.resetDamage();
    } catch (e) {
      /* the pack's own business; the model is already ours-as-built */
    }
  }
}

/* ------------------------------------------------------------------ *
 * The pool
 * ------------------------------------------------------------------ */

function cap() {
  return PIECE_CAP[S.quality] || PIECE_CAP.high;
}

function addPiece(piece) {
  if (!S.group) return;
  // Over the cap: the oldest piece at rest goes first, then simply the oldest.
  while (S.pieces.length >= cap()) {
    let i = S.pieces.findIndex((p) => p.body.sleeping);
    if (i < 0) i = 0;
    dropPiece(S.pieces[i]);
    S.pieces.splice(i, 1);
  }
  S.group.add(piece.group);
  S.pieces.push(piece);
  S.stats.pieces++;
  if (S.pieces.length > S.stats.peak) S.stats.peak = S.pieces.length;
}

function dropPiece(p) {
  p.gone = true;
  disposePiece(p.group);
}

function clearPieces() {
  for (const p of S.pieces) dropPiece(p);
  S.pieces.length = 0;
  if (S.fx) S.fx.clear();
}

/** The player's aeroplane as built, and nothing broken left in the world. */
function resetAll(sim) {
  S.lastRes = null;
  endReplay(sim, false);
  endSink();
  clearRafts(sim);
  S.npcs.length = 0;
  S.swamped = false;
  clearPieces();
  S.slow.left = 0;
  S.slow.ease = 0;
  S.rec = null;
  for (const f of S.pre) f.t = -1e9;
  for (const m of [...S.models]) {
    unwatch(m);
    putBack(m);
  }
  if (sim && sim.model && isBroken(sim.model)) putBack(sim.model);
  if (sim && sim.aircraft) sim.aircraft.lost = null;
}

/* ------------------------------------------------------------------ *
 * The player's crash
 * ------------------------------------------------------------------ */

/**
 * Where two aircraft touched. sky.js tests two spheres (BODY of each one's
 * size) and hands on the midpoint of their CENTRES, which for a trainer
 * clipping an airliner's wing tip is halfway to the airliner's fuselage:
 * the wrong place to break either of them. They touched at the edge of
 * yours, on the line between the two: that is on your skin facing it, and
 * inside its sphere — the part of it you flew into.
 */
export function touchPoint(sim, mePos, otherPos, out = new THREE.Vector3()) {
  let r = 4;
  try {
    const d = dimsFrom(SPEC && SPEC.hardPoints, sim && sim.aircraftType && sim.aircraftType.plan);
    r = Math.max(2, Math.max(d.semi, d.L / 2)) * BODY;
  } catch (e) {
    /* a trainer's size will do */
  }
  out.copy(otherPos).sub(mePos);
  const d = out.length();
  if (!(d > 1e-6)) return out.copy(mePos);
  return out.multiplyScalar(Math.min(r, d * 0.5) / d).add(mePos);
}

function groundNormal(x, z, out) {
  const e = 1.5;
  const h = heightAt(x, z);
  out.set(-(heightAt(x + e, z) - h), e, -(heightAt(x, z + e) - h)).normalize();
  return out;
}

function onCrash(c) {
  if (!live()) return;
  try {
    crashed(S.sim, c || {});
  } catch (err) {
    if (!S.warned) console.warn('[breakup] the break-up could not run; the crash carries on without it:', err);
    S.warned = true;
  }
}

function crashed(sim, c) {
  if (!sim || !sim.aircraft || sim.mode === 'drive' || !sim.model) return;
  const ac = sim.aircraft;
  const model = sim.model;
  if (!model.visible || sim.riding) return;
  poseLikeAircraft(model, ac);
  const contact = c.contact || {};
  let world = contact.worldPoint ? contact.worldPoint.clone() : ac.pos.clone();
  // A crash that names the part but gives the aeroplane's middle as the point
  // (a staged one, Dev mode's "Show me a crash") hit where that part's strike
  // point is: the outermost of them, so a wing means its tip.
  if (contact.part && world.distanceTo(ac.pos) < 0.5 && SPEC && Array.isArray(SPEC.hardPoints)) {
    let best = null;
    for (const h of SPEC.hardPoints) {
      if ((h.part || h.partId) !== contact.part || !h.pos) continue;
      if (!best || h.pos.lengthSq() > best.pos.lengthSq()) best = h;
    }
    if (best) world = best.pos.clone().applyQuaternion(ac.quat).add(ac.pos);
  }
  const vel = (c.impactVel || ac.vel).clone();
  const omegaBody = (c.impactOmega || ac.omega || _v.set(0, 0, 0)).clone();
  const omega = omegaBody.applyQuaternion(ac.quat);
  const kind = contact.surfaceKind || (heightAt(world.x, world.z) < 0 && world.y < 4 ? 'water' : 'ground');
  const normal = new THREE.Vector3();
  const hit = { world, bodyVel: vel, omega, owner: 'player', gearDown: ac.gearPos == null ? 1 : ac.gearPos };
  if (kind === 'water') normal.set(0, 1, 0);
  else if (kind === 'aircraft') {
    // Another aircraft: the blow comes from it, at the speed the two closed,
    // on your skin where you met it (not the midpoint of the two centres).
    if (contact.otherPos) {
      normal.copy(ac.pos).sub(contact.otherPos).normalize();
      touchPoint(sim, ac.pos, contact.otherPos, world);
    } else normal.copy(vel).multiplyScalar(-1).normalize();
    if (Number.isFinite(contact.closing)) hit.energy = 0.5 * contact.closing * contact.closing * 0.8;
  } else if (kind === 'concrete' && !contact.part) {
    // A building: square into its wall.
    normal.copy(vel).setY(0).multiplyScalar(-1);
    if (normal.lengthSq() < 1e-6) normal.set(0, 1, 0);
    normal.normalize();
  } else groundNormal(world.x, world.z, normal);
  hit.normal = normal;
  // The touching point's own velocity (the aeroplane's, plus its turning).
  const arm = world.clone().sub(ac.pos);
  hit.velocity = vel.clone().add(omega.clone().cross(arm));
  if (!contact.worldPoint) {
    // Came apart in the air (too fast, a tornado): everything takes it.
    hit.energy = Math.max(hit.energy || 0, 900);
  }
  const quiet = !!(sim.bracing || sim.braceRescueT);
  if (quiet) {
    // A mayday's controlled arrival: wrecked, but gently.
    hit.energy = Math.min(hit.energy == null ? 30 : hit.energy, 30);
  }
  const res = breakModel(sim, model, sim.aircraftType, hit);
  if (!res) return;
  // Where it touched: what flies up from the surface.
  if (S.fx) {
    const e = res.plan.energy;
    if (kind === 'water') S.fx.splash(world.x, world.z, Math.sqrt(e) * 2, clamp(Math.sqrt(e) * 0.12, 0.8, 4));
    else if (kind === 'concrete' || kind === 'aircraft' || isPaved(world.x, world.z) || platformAt(world.x, world.z)) {
      S.fx.sparks(world.x, Math.max(world.y, heightAt(world.x, world.z)), world.z, Math.sqrt(e) * 3, Math.min(30, 8 + Math.round(e / 20)), vel);
      S.fx.dust(world.x, world.y, world.z, clamp(Math.sqrt(e) * 0.12, 0.6, 3), 4, [0.45, 0.44, 0.42]);
    } else S.fx.dust(world.x, Math.max(world.y, heightAt(world.x, world.z)), world.z, clamp(Math.sqrt(e) * 0.15, 0.8, 4), Math.min(16, 5 + Math.round(e / 30)));
  }
  // The hit you feel.
  const e = res.plan.energy;
  if (sim.rig && typeof sim.rig.kick === 'function') sim.rig.kick(clamp(0.2 + Math.sqrt(e) * 0.04, 0.2, 1.2));
  // The beat: a moment of slow motion when something has really come apart.
  const onFoot = (() => {
    try {
      const k = extKeyContext(sim);
      return !!k && k !== 'plane' && k !== 'heli';
    } catch (err) {
      return false;
    }
  })();
  if (res.pieces.length && !quiet && !onFoot && slowMoWanted(sim)) {
    S.slow.left = SLOWMO.hold;
    S.slow.ease = SLOWMO.ease;
    S.stats.slowmo++;
  }
  startRecording(sim, res.pieces, c.reason || '');
  S.lastRes = res;
  // At sea it does not stop there: it floats a while, then slowly goes down.
  if (kind === 'water' || (heightAt(world.x, world.z) < 0 && !platformAt(world.x, world.z) && world.y < 6)) startSink(sim, res);
}

function slowMoWanted(sim) {
  return !(sim.settings && sim.settings.crashSlowMo === false);
}

/* ------------------------------------------------------------------ *
 * Survivable damage: a knock that takes a piece and flies on
 * ------------------------------------------------------------------ */

const DAMAGE_WORDS = {
  wingOuterL: 'Left wing tip torn off — she rolls left, hold it with the stick',
  wingOuterR: 'Right wing tip torn off — she rolls right, hold it with the stick',
  fin: 'The fin has gone — the nose wanders, use small rudder',
  tailplaneL: 'Left tailplane gone — the elevator is weak',
  tailplaneR: 'Right tailplane gone — the elevator is weak',
  engine: 'The engine has come off — no power, glide it down',
  engineL: 'Left engine gone — she swings left, hold right rudder',
  engineR: 'Right engine gone — she swings right, hold left rudder',
  engineL1: 'Left engine gone — she swings left, hold right rudder',
  engineL2: 'Left engine gone — she swings left, hold right rudder',
  engineR1: 'Right engine gone — she swings right, hold left rudder',
  engineR2: 'Right engine gone — she swings right, hold left rudder',
  tailRotor: 'Tail rotor gone — she will spin, land now',
};

function onDamage(d) {
  if (!live() || !d || !d.point) return;
  try {
    damaged(S.sim, d);
  } catch (err) {
    if (!S.warned) console.warn('[breakup] a knock could not be shown:', err);
    S.warned = true;
  }
}

function damaged(sim, d) {
  if (!sim || !sim.aircraft || !sim.model || sim.mode === 'drive') return;
  const ac = sim.aircraft;
  if (ac.crashed) return;
  poseLikeAircraft(sim.model, ac);
  // The knock's severity (0.08..0.75) as closing energy: a hard knock snaps a tip.
  const energy = clamp(d.severity, 0, 1) * 40;
  const res = breakModel(sim, sim.model, sim.aircraftType, {
    world: d.point,
    normal: groundNormal(d.point.x, d.point.z, new THREE.Vector3()),
    energy,
    survivable: true,
    bodyVel: ac.vel.clone(),
    omega: ac.omega.clone().applyQuaternion(ac.quat),
    owner: 'player',
    gearDown: ac.gearPos,
  });
  if (!res) return;
  S.stats.survivable++;
  // Set even when only something bent: it is also what tells the frame hook
  // this airframe is meant to look damaged and must not be tidied back.
  ac.lost = lostFrom(res.asg.layout, res.plan, ac.lost);
  const gone = res.plan.pieces.flat();
  if (S.fx) S.fx.sparks(d.point.x, d.point.y, d.point.z, 12, 10, ac.vel);
  const say = gone.map((z) => DAMAGE_WORDS[z]).find(Boolean);
  if (say && sim.hud && sim.hud.notify) sim.hud.notify(say, 'warn', 5);
}

/* ------------------------------------------------------------------ *
 * Other aircraft, hit in the sky
 * ------------------------------------------------------------------ */

function onSkyHit(sim, b, info) {
  if (!live() || !b) return;
  try {
    const model = b.model;
    if (!model || !model.isObject3D || !model.parent) return;
    const me = sim && sim.aircraft;
    const normal = new THREE.Vector3();
    if (me && b.pos) normal.copy(b.pos).sub(me.pos);
    if (normal.lengthSq() < 1e-6) normal.set(0, 1, 0);
    normal.normalize();
    const vel = b.vel && Number.isFinite(b.vel.x) ? b.vel.clone() : new THREE.Vector3();
    const closing = Number.isFinite(info && info.closing) ? info.closing : 30;
    trackNpc(b, model);
    // Where you touched it: at the edge of you, on the line between the two.
    const at = me && b.pos ? touchPoint(sim, me.pos, b.pos) : (info && info.at ? info.at : b.pos).clone();
    breakModel(sim, model, typeOf(model, b.typeId), {
      world: at,
      normal,
      energy: 0.5 * closing * closing * 0.8,
      bodyVel: vel,
      omega: new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2),
      owner: 'npc',
    });
    S.stats.npc++;
  } catch (err) {
    if (!S.warned) console.warn('[breakup] the other aircraft could not come apart:', err);
    S.warned = true;
  }
}

/* ------------------------------------------------------------------ *
 * Every frame
 * ------------------------------------------------------------------ */

/** Seconds a piece that has gone under stays faintly visible before it is cleared away. */
export const SUNK_SHOWN_S = 15;

function stepPieces(sim, dt) {
  const cam = sim && sim.camera ? sim.camera.position : null;
  for (let i = S.pieces.length - 1; i >= 0; i--) {
    const p = S.pieces[i];
    const b = p.body;
    p.far = !!(cam && cam.distanceToSquared(b.pos) > 1200 * 1200);
    if (!b.sleeping) {
      stepBody(b, dt, ENV);
      p.group.position.copy(b.pos);
      p.group.quaternion.copy(b.quat);
    }
    // Gone under: there a little while, faintly, then cleared — which also
    // gives its place in the cap back. One lying on a shallow bed with some
    // of it out of the water is a wreck, like one on land, and stays.
    if (b.sunk && b.pos.y + b.radius < -0.3) {
      p.sunkT = (p.sunkT || 0) + dt;
      if (p.sunkT > SUNK_SHOWN_S) {
        dropPiece(p);
        S.pieces.splice(i, 1);
        S.stats.culled++;
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * At sea: "if yu crash in the ocena or if something does it slwoly sinks"
 *
 * Lakes and rivers too: every water in the game is at sea level (terrain.js
 * has no inland-water primitive — a river delta's channels and a harbour
 * basin are ground cut below 0), so "the ground is under 0 here" is water
 * wherever it is, and everything here treats a river exactly like the sea.
 * ------------------------------------------------------------------ */

/** How the airframe goes down: float time, settling, then the slow sink (seconds). */
export function sinkTimes(L) {
  // A big one floats longer, and takes longer going down too: it has further
  // to go (an A380 is twenty-four metres tall), so its last part is never a
  // drop. All of it inside the minute — so the biggest float a little less
  // than they did (19 s, not 22) and spend it going down instead: an A380
  // has nearly forty metres to go, and at 29 s it went at 1.8 m/s, as fast
  // as the sea check lets anything its size go. At 35 s it is under 1.5.
  const floatT = clamp(5 + L * 0.3, 6, 19);
  const settleT = 4;
  const sinkT = clamp(Math.max(52 - floatT - settleT, L * 0.48), 14, 35);
  return { floatT, settleT, sinkT, total: floatT + settleT + sinkT };
}

/** How fast it may come down settling in, m/s, before the swell's bob is added. */
const SETTLE_IN_SPEED = 0.6;
/**
 * From where the crash left it to floating: the first part of going in. It
 * came in over a flat second and a half whatever its size and however high
 * the crash left it, and with the swell's bob on top that could be a drop of
 * nearly 1.9 m/s for an A380 (measured, a quarter-second apart) — over what
 * the sea check allows its size, and a share of the check's intermittent
 * failure. A small way in (the last SETTLE_TAIL metres, or less) takes
 * longer the bigger it is and the further it has to come (`drop`, metres),
 * never faster than SETTLE_IN_SPEED.
 */
export function settleInT(L, drop = 0) {
  return Math.max(1.5 + (Number(L) || 0) * 0.05, Math.abs(Number(drop) || 0) / SETTLE_IN_SPEED);
}
/**
 * Coming in from further than that went at the slow speed ALL the way: a
 * dive into the sea leaves an airliner's middle ten metres up, its nose in
 * the water, and an A380 hung there level over the water for fifteen
 * seconds, creeping down at 0.6 m/s (v62 recheck). Now only the last
 * SETTLE_TAIL metres go slowly. Above them, up in the air it falls
 * (SETTLE_FALL m/s², a little under g as it pivots on the end that went in
 * first) and ploughs into the water losing that speed; already in the water
 * (its belly in, the rest of it to go under) its weight pushes it in
 * (SETTLE_PUSH m/s²), gathering way and easing off again.
 */
export const SETTLE_TAIL = 1.5;
export const SETTLE_FALL = 8;
export const SETTLE_PUSH = 2;
/**
 * The way in, from where the crash left it (`y0`, its origin) to floating
 * `draft` under: `at(tau)` is how far it has come down by then, of `D`.
 * `belly` is how far under the origin its belly is (from the draft if not
 * given), so `air` is how far its belly fell through the air to the water.
 * `inT` is when it is in — all but the last slow metres: the slow sink's own
 * speed limit holds from there. Pure, so the node test can run it.
 */
export function settleProfile(L, y0, draft = 0, belly) {
  const top = Number(y0) || 0;
  const dr = Math.max(0, Number(draft) || 0);
  const D = top + dr;
  const b = Number.isFinite(belly) && belly > 0 ? belly : Math.max(0.2, dr / 0.55);
  // The slow last metres are all in the water: never a slow bit of falling.
  const inAir = top > b;
  const tail = Math.min(SETTLE_TAIL, D, inAir ? b + dr : D);
  const fast = D - tail;
  if (!(fast > 0.05)) {
    const T = settleInT(L, D);
    return { D, air: 0, fallT: 0, inT: 0, T, ve: 0, vp: 0, at: (tau) => D * clamp(tau / T, 0, 1) };
  }
  const vs = SETTLE_IN_SPEED;
  const air = inAir ? Math.min(top - b, fast) : 0;
  const fallT = air > 0 ? Math.sqrt((2 * air) / SETTLE_FALL) : 0;
  const ve = SETTLE_FALL * fallT;
  const wet = fast - air;
  // In the water above the slow last metres: from ve, ploughing in and
  // losing speed down to vs; or from (nearly) still, gathering way at
  // SETTLE_PUSH to vp and easing off again to vs.
  let vp;
  let t1;
  let t2;
  let a1;
  let a2;
  if (ve >= vs) {
    vp = ve;
    t1 = 0;
    a1 = 0;
    t2 = wet > 0 ? (2 * wet) / (ve + vs) : 0;
    a2 = t2 > 0 ? (ve - vs) / t2 : 0;
  } else {
    vp = Math.sqrt((2 * SETTLE_PUSH * wet + ve * ve + vs * vs) / 2);
    a1 = SETTLE_PUSH;
    a2 = SETTLE_PUSH;
    t1 = (vp - ve) / a1;
    t2 = (vp - vs) / a2;
  }
  const d1 = ve * t1 + 0.5 * a1 * t1 * t1;
  const inT = fallT + t1 + t2;
  const T = inT + tail / vs;
  const at = (tau) => {
    if (!(tau > 0)) return 0;
    if (tau < fallT) return 0.5 * SETTLE_FALL * tau * tau;
    let u = tau - fallT;
    if (u < t1) return air + ve * u + 0.5 * a1 * u * u;
    u -= t1;
    if (u < t2) return air + d1 + vp * u - 0.5 * a2 * u * u;
    if (tau < T) return fast + vs * (tau - inT);
    return D;
  };
  return { D, air, fallT, inT, T, ve, vp, at };
}
/**
 * Its height `tau` seconds into the sink, coming in from `y0` (where the
 * crash left it) to the floating pose's `y`, along a settleProfile `P`.
 */
export function settleAlong(P, y0, y, tau) {
  if (!P || tau >= P.T || Math.abs(P.D) < 1e-6) return y;
  return y0 + (y - y0) * (P.at(tau) / P.D);
}
/**
 * How far round it has turned from the attitude the crash left it in to the
 * floating pose's, 0..1: as it comes in (its tail coming down onto the
 * water after a dive), over a second at least and two at most when it is
 * only a little way — never all at once, which snapped a nose-down airframe
 * level the frame its sink began.
 */
export function settleTurn(P, tau) {
  if (!P) return 1;
  const Tq = P.inT > 0 ? Math.max(0.8, P.inT) : clamp(P.T, 0.8, 2);
  const u = clamp(tau / Tq, 0, 1);
  return u * u * (3 - 2 * u);
}
/**
 * Its height `tau` seconds into the sink, coming in from `y0` (where the
 * crash left it) to the floating pose's `y`; `draft` is how deep it floats,
 * `belly` how far under its origin its belly is.
 */
export function settleIn(y0, y, tau, L, draft = 0, belly) {
  return settleAlong(settleProfile(L, y0, draft, belly), y0, y, tau);
}

/**
 * How far down the slow sink is at s (0..1 of it): it gathers way over the
 * first SINK_RAMP of the time, goes down steadily, and eases to a stop over
 * the last SINK_RAMP. Its fastest is 1 / (1 - SINK_RAMP) of its average —
 * a third over it. (It was a smoothstep, half again over its average, with
 * its end sliding further down as it tipped: an A380 peaked near 1.8 m/s,
 * a hair under what the sea check allows a 72 m airliner.)
 */
export const SINK_RAMP = 0.25;
export function sinkEase(s) {
  const r = SINK_RAMP;
  const v = 1 / (1 - r);
  if (s <= 0) return 0;
  if (s >= 1) return 1;
  if (s < r) return (v * s * s) / (2 * r);
  if (s > 1 - r) return 1 - (v * (1 - s) * (1 - s)) / (2 * r);
  return v * (s - r / 2);
}

const _yaw = new THREE.Quaternion();
const _qs = new THREE.Quaternion();
const _qx = new THREE.Quaternion();
const _qz = new THREE.Quaternion();
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);

/**
 * Where a floating, then sinking, hull is at time tau: { y, pitch, roll, under, phase }.
 * `k` holds its numbers (draft, top, bot, heavy, L, the times, phase, floor).
 * Pure, so the node test can run the whole thing.
 */
export function sinkPose(k, tau) {
  const bob = Math.sin(1.25 * tau + k.phase) * (0.1 + k.L * 0.004);
  const pBob = 0.025 * Math.sin(0.9 * tau + k.phase);
  const rBob = 0.04 * Math.sin(0.7 * tau + k.phase * 1.3);
  const yF = -k.draft;
  const ease = sinkEase;
  if (tau < k.floatT) return onBed(k, { y: yF + bob, pitch: pBob, roll: rBob, under: false, phase: 'afloat' });
  const t2 = tau - k.floatT;
  if (t2 < k.settleT) {
    const u = t2 / k.settleT;
    return onBed(k, { y: yF - u * k.draft * 1.2 + bob * (1 - u), pitch: 0.31 * u * u + pBob * (1 - u), roll: rBob * (1 - u) + 0.08 * u, under: false, phase: 'settling' });
  }
  const s = clamp((t2 - k.settleT) / k.sinkT, 0, 1);
  // The end: its highest point, tilted, a couple of metres under. Where it
  // ends is fixed from the start (the tilt it ends at), so the way down is
  // the one easing and nothing more: worked out from the tilt it has NOW, the
  // end kept sliding further down as it tipped and added that to the speed.
  const pitch = 0.31 + 0.25 * s;
  const highest = k.top * Math.cos(pitch) + (k.L / 2) * Math.sin(pitch);
  const yEnd = -(k.top * Math.cos(0.56) + (k.L / 2) * Math.sin(0.56) + 2.2);
  const y0 = yF - k.draft * 1.2;
  const P = onBed(k, { y: y0 + (Math.min(y0, yEnd) - y0) * ease(s), pitch, roll: 0.08 + 0.05 * s, highest });
  // Gone under only if all of it has: an airliner on a bed five metres down
  // still has its top half out of the water, and stays there, AGROUND, as a
  // wreck does on land — never tidied away in plain sight.
  const done = s >= 1;
  P.under = done && P.y + P.highest < -0.5;
  P.phase = done ? (P.under ? 'under' : 'aground') : 'sinking';
  return P;
}

/**
 * The sea bed under it, where it is shallower than the hull: it may not go
 * into the bed. Down to the bed it comes, and it tilts only as far as there
 * is water for its low end — so it ends lying on the bottom, level where it
 * is shallow, rather than standing on its nose twenty metres into the sand.
 */
function onBed(k, P) {
  if (!Number.isFinite(k.floor)) return P;
  const belly = Number.isFinite(k.bot) ? Math.max(0.2, -k.bot) : Math.max(0.2, k.draft * 1.8);
  const half = k.L / 2;
  const level = k.floor + 0.3 + belly;
  const bedAt = (p) => k.floor + 0.3 + belly * Math.cos(p) + half * Math.sin(Math.abs(p));
  if (P.y >= bedAt(P.pitch)) return P;
  if (P.y <= level) {
    P.y = level;
    P.pitch = 0;
  } else P.pitch = Math.sign(P.pitch) * Math.asin(clamp((P.y - level) / half, 0, 1));
  P.grounded = true;
  if (P.highest != null) P.highest = k.top * Math.cos(P.pitch) + half * Math.sin(Math.abs(P.pitch));
  return P;
}

function poseQuat(yaw, pitch, roll, heavy, out) {
  // Nose down is a turn about the body's -X; tail down about +X.
  _yaw.setFromAxisAngle(AY, yaw);
  _qx.setFromAxisAngle(AX, heavy > 0 ? pitch : -pitch);
  _qz.setFromAxisAngle(AZ, roll);
  return out.copy(_yaw).multiply(_qx).multiply(_qz);
}

function yawOf(q) {
  const f = _v.set(0, 0, -1).applyQuaternion(q);
  return Math.atan2(-f.x, -f.z);
}

/** The player's aeroplane, gone into the sea: it floats a while, then slowly sinks. */
function startSink(sim, res) {
  const model = sim.model;
  const ac = sim.aircraft;
  const fleet = !!(model.userData && model.userData.fleetBridge);
  if (fleet) {
    // The pack sinks its own in eighteen seconds flat; this one takes over.
    const gc = model.userData.gameCrash;
    if (gc && gc.sinking) {
      try {
        gc.sinking.userData.dispose();
      } catch (e) {
        /* already gone */
      }
      gc.sinking.removeFromParent();
      gc.sinking = null;
    }
  }
  const f = res.asg.layout.frame;
  let top = 0;
  let bot = 0;
  for (const id in res.asg.boxes) {
    top = Math.max(top, res.asg.boxes[id].max[1]);
    bot = Math.min(bot, res.asg.boxes[id].min[1]);
  }
  const belly = f.profile.reduce((m, p) => Math.min(m, p.bot), 0);
  let heavy = -1;
  if (f.engines.length) {
    const mz = f.engines.reduce((a, e) => a + e.z, 0) / f.engines.length;
    heavy = mz > 0.08 * f.L ? 1 : -1;
  }
  S.sink = {
    model,
    ac,
    fleet,
    t: 0,
    delay: fleet ? 0.25 : CRASH_SECONDS + 0.05,
    ...sinkTimes(f.L),
    L: f.L,
    top,
    bot,
    draft: Math.max(0.2, -belly * 0.55),
    belly: Math.max(0.2, -belly),
    heavy,
    phase: Math.random() * 6,
    started: false,
    underT: 0,
    hidden: false,
    bubbleT: 0,
    foamT: 0,
    floor: NaN,
  };
  S.stats.sinks++;
}

function stepSink(sim, dt) {
  // Hit in the air over the sea and come down into it afterwards: it sinks too.
  if (!S.sink && S.lastRes && sim.aircraft && sim.aircraft.crashed && sim.model && sim.model.visible && sim.mode !== 'drive') {
    const p = sim.aircraft.pos;
    if (p.y < 3 && heightAt(p.x, p.z) < 0 && !platformAt(p.x, p.z)) startSink(sim, S.lastRes);
  }
  const k = S.sink;
  if (!k) return;
  const model = k.model;
  if (!model || !model.parent || !k.ac || !k.ac.crashed) {
    endSink();
    return;
  }
  k.t += dt;
  if (k.t < k.delay) return;
  if (!k.started) {
    k.started = true;
    const p = k.fleet ? model.position : k.ac.pos;
    k.x = p.x;
    k.z = p.z;
    k.y0 = p.y;
    k.q0 = (k.fleet ? model.quaternion : k.ac.quat).clone();
    k.yaw = yawOf(k.q0);
    k.floor = heightAt(k.x, k.z);
    // The way in: a fall onto the water if the crash left it up over it.
    k.settle = settleProfile(k.L, k.y0, k.draft, k.belly);
    k.slapped = !(k.settle.air > 0);
    // And whoever was flying it is out, in a raft, before it goes.
    spawnRaft(sim, k.x, k.z, k.yaw, k.L);
  }
  const tau = k.t - k.delay;
  const P = sinkPose(k, tau);
  const y = settleAlong(k.settle, k.y0, P.y, tau);
  // The swell drifts it a little.
  k.x += Math.sin(k.phase) * 0.12 * dt;
  k.z += Math.cos(k.phase) * 0.12 * dt;
  const q = poseQuat(k.yaw, P.pitch, P.roll, k.heavy, new THREE.Quaternion());
  // From the attitude the crash left it in, not snapped to the floating one.
  const turn = settleTurn(k.settle, tau);
  if (turn < 1) {
    _qs.copy(q);
    q.copy(k.q0).slerp(_qs, turn);
  }
  // Its belly meets the water: spray along it, and foam.
  if (!k.slapped && tau >= k.settle.fallT) {
    k.slapped = true;
    if (S.fx) {
      S.fx.splash(k.x, k.z, k.settle.ve, clamp(k.L * 0.05, 1, 3));
      S.fx.foam(k.x, k.z, clamp(k.L * 0.12, 1, 5));
    }
  }
  const ac = k.ac;
  ac.pos.set(k.x, y, k.z);
  ac.quat.copy(q);
  if (ac.vel) ac.vel.set(0, 0, 0);
  model.position.set(k.x, y, k.z);
  model.quaternion.copy(q);
  if (!model.matrixAutoUpdate) {
    model.matrix.compose(model.position, model.quaternion, model.scale);
    model.matrixWorldNeedsUpdate = true;
  }
  k.last = P;
  // Bubbles and foam as it goes, along the length of it.
  if (S.fx && (P.phase === 'settling' || P.phase === 'sinking')) {
    k.bubbleT -= dt;
    if (k.bubbleT <= 0) {
      k.bubbleT = 0.07;
      const f = _v.set(0, 0, -1).applyQuaternion(q);
      const a = (Math.random() - 0.5) * k.L * 0.8;
      S.fx.bubbles(k.x + f.x * a, k.z + f.z * a, 3, 0.4 + k.L * 0.03);
    }
    k.foamT -= dt;
    if (k.foamT <= 0) {
      k.foamT = 0.45;
      S.fx.foam(k.x, k.z, clamp(k.L * 0.12, 1, 5));
    }
  }
  if (P.under) {
    k.underT += dt;
    if (k.underT > SUNK_SHOWN_S && !k.hidden) {
      k.hidden = true;
      model.visible = false;
      S.stats.culled++;
    }
  }
  // Keep the camera out of the sea while it follows the wreck down.
  const cam = sim.camera;
  if (cam && !S.replay && cam.position.y < 1.4 && heightAt(cam.position.x, cam.position.z) < 1.4) {
    cam.position.y = 1.4;
    cam.lookAt(k.x, Math.max(-1.5, y), k.z);
  }
}

function endSink() {
  const k = S.sink;
  S.sink = null;
  if (k && k.hidden && k.model) k.model.visible = true;
}

/* ---- the life raft ---- */

let raftParts = null;
function raftKit() {
  if (raftParts) return raftParts;
  const orange = new THREE.MeshStandardMaterial({ color: 0xff6418, roughness: 0.55, metalness: 0 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x262a31, roughness: 0.9, metalness: 0 });
  raftParts = {
    orange,
    dark,
    tube: new THREE.TorusGeometry(0.95, 0.26, 10, 28),
    floor: new THREE.CircleGeometry(0.95, 24),
    arch: new THREE.TorusGeometry(0.85, 0.05, 6, 20, Math.PI),
  };
  return raftParts;
}

/** How deep the water must be under a raft (and all round it), metres: it floats, never on the sand. */
export const RAFT_DEPTH = 1;

/** Water at least RAFT_DEPTH deep under a raft at (x, z) and a raft's width all round. */
function raftWater(x, z) {
  for (const [dx, dz] of [[0, 0], [1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6]]) {
    const px = x + dx;
    const pz = z + dz;
    if (Math.max(heightAt(px, pz), drawnHeight(px, pz)) > -RAFT_DEPTH || platformAt(px, pz)) return false;
  }
  return true;
}

/**
 * Where the raft goes: abeam of the wreck, a little over half its length
 * out, either side — and wherever that is water deep enough. It was put
 * there blind, and a ditching a few metres off a beach put the pilot inside
 * the hill (v62 recheck): so round from abeam towards the nose and tail,
 * nearer in and further out, until it is in the water; failing all of that,
 * the deepest of them (the wreck itself went in at sea). Returns the spot
 * and the way out from the wreck it lies (the way it drifts).
 */
export function raftSpot(x, z, yaw, L, water = raftWater) {
  const d0 = clamp(L * 0.45 + 5, 6, 40);
  const first = Math.random() < 0.5 ? -1 : 1;
  let best = null;
  for (const dm of [1, 0.6, 1.5, 0.35, 2.2]) {
    const d = Math.max(4, d0 * dm);
    for (const turn of [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4]) {
      for (const side of [first, -first]) {
        const dx = Math.cos(yaw + turn) * side;
        const dz = -Math.sin(yaw + turn) * side;
        const px = x + dx * d;
        const pz = z + dz * d;
        if (water(px, pz)) return { x: px, z: pz, dx, dz, wet: true };
        const h = heightAt(px, pz);
        if (!best || h < best.h) best = { x: px, z: pz, dx, dz, h };
      }
    }
  }
  if (best && heightAt(x, z) < best.h) return { x, z, dx: best.dx, dz: best.dz, wet: false };
  return { x: best.x, z: best.z, dx: best.dx, dz: best.dz, wet: false };
}

/**
 * An orange life raft with the pilot sitting in it, waving, a few metres off
 * the wreck — "the pilot is always out first". It bobs and drifts and stays
 * until the flight is reset; sim.lifeRafts lists them, for a rescue mission.
 */
function spawnRaft(sim, x, z, yaw, L) {
  if (!S.group) return null;
  const K = raftKit();
  const g = new THREE.Group();
  g.name = 'breakup:raft';
  const tube = new THREE.Mesh(K.tube, K.orange);
  tube.rotation.x = Math.PI / 2;
  const floor = new THREE.Mesh(K.floor, K.dark);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.12;
  const arch = new THREE.Mesh(K.arch, K.orange);
  arch.rotation.y = Math.PI / 2;
  arch.position.z = -0.35;
  g.add(tube, floor, arch);
  let person = null;
  try {
    person = createUniformPerson(uniformFor(sim.aircraftType), { seed: 11 });
  } catch (e) {
    person = null;
  }
  if (person) {
    person.position.set(0, -0.78, 0.18);
    person.rotation.y = Math.PI;
    g.add(person);
  }
  // Off to one side of where it went in, clear of the wreck — in the water.
  const at = raftSpot(x, z, yaw, L);
  g.position.set(at.x, 0.15, at.z);
  g.rotation.y = yaw + Math.PI / 2;
  S.group.add(g);
  const raft = { group: g, person, t: Math.random() * 4, drift: new THREE.Vector3(at.dx, 0, at.dz).multiplyScalar(0.18) };
  S.rafts.push(raft);
  S.stats.rafts++;
  publishRafts(sim);
  return raft;
}

function publishRafts(sim) {
  if (sim) sim.lifeRafts = S.rafts.map((r) => ({ pos: r.group.position, who: 'pilot' }));
}

function stepRafts(dt) {
  for (const r of S.rafts) {
    r.t += dt;
    const g = r.group;
    g.position.y = 0.15 + Math.sin(r.t * 1.3) * 0.08;
    g.rotation.z = Math.sin(r.t * 0.9) * 0.06;
    g.rotation.x = Math.sin(r.t * 1.1 + 1) * 0.05;
    // It drifts — out to sea, and never up onto the shore: where the water
    // ahead of it is too shallow for it, it stays where it is.
    if (r.drift.x || r.drift.z) {
      r.look = (r.look || 0) - dt;
      if (r.look <= 0) {
        // Twice a second, three metres ahead of it.
        r.look = 0.5;
        const k = 3 / (Math.hypot(r.drift.x, r.drift.z) || 1);
        if (!raftWater(g.position.x + r.drift.x * k, g.position.z + r.drift.z * k)) r.drift.set(0, 0, 0);
      }
      g.position.addScaledVector(r.drift, dt);
    }
    const rig = r.person && r.person.userData.rig;
    if (rig) {
      // Sitting, legs out, one arm up and waving: "over here".
      for (const L of rig.legs) {
        L.leg.rotation.set(-1.45, 0, L.side * 0.12);
        L.knee.rotation.set(1.25, 0, 0);
      }
      const wave = rig.arms[0];
      const rest = rig.arms[1];
      if (wave) {
        wave.arm.rotation.set(2.7, 0, wave.side * (0.35 + Math.sin(r.t * 6) * 0.3));
        wave.elbow.rotation.set(0.25, 0, 0);
      }
      if (rest) {
        rest.arm.rotation.set(0.3, 0, rest.side * 0.25);
        rest.elbow.rotation.set(0.6, 0, 0);
      }
    }
  }
}

function clearRafts(sim) {
  for (const r of S.rafts) r.group.removeFromParent();
  S.rafts.length = 0;
  publishRafts(sim);
}

/* ---- aircraft hit in the sky that come down in the sea ---- */

function trackNpc(b, model) {
  if (!S.npcs.some((n) => n.body === b)) S.npcs.push({ body: b, model, sink: null, still: 0 });
  model.userData.breakupNpc = true;
}

function stepNpcs(dt) {
  for (let i = S.npcs.length - 1; i >= 0; i--) {
    const n = S.npcs[i];
    const m = n.model;
    // Gone from the scene: if that was at sea, onRemoved has left a wreck sinking there.
    if (!m || !m.parent || n.body.gone) {
      S.npcs.splice(i, 1);
      continue;
    }
    const p = n.body.pos;
    if (!n.sink) {
      const moving = n.body.vel && Number.isFinite(n.body.vel.x) ? n.body.vel.length() : 0;
      if (heightAt(p.x, p.z) < 0 && p.y < 3) {
        n.still += dt;
        if (n.still > 0.4 && moving < 1) {
          // Its owner has left it lying on the water: from here it sinks.
          let L = 12;
          try {
            const box = new THREE.Box3().setFromObject(m);
            L = Math.max(4, box.getSize(_v).length() * 0.7);
          } catch (e) {
            /* a rough length will do */
          }
          // The attitude it was left in: the sink tilts it from there (set, not
          // added to, every frame — whether or not its owner still poses it).
          n.sink = { t: 0, y0: p.y, q0: m.quaternion.clone(), L, ...sinkTimes(L), top: L * 0.18, draft: L * 0.04, heavy: -1, phase: Math.random() * 6, floor: heightAt(p.x, p.z), underT: 0 };
          n.sink.settle = settleProfile(L, p.y, n.sink.draft);
          S.stats.sinks++;
        }
      } else n.still = 0;
      continue;
    }
    const k = n.sink;
    k.t += dt;
    const P = sinkPose(k, k.t);
    k.last = P;
    const y = settleAlong(k.settle, k.y0, P.y, k.t);
    // Its owner draws it from this position (and stops moving it once wrecked).
    p.y = y;
    m.position.y = y;
    _qx.setFromAxisAngle(AX, -P.pitch);
    m.quaternion.copy(k.q0).multiply(_qx);
    if (S.fx && (P.phase === 'settling' || P.phase === 'sinking') && Math.random() < dt * 12) S.fx.bubbles(p.x, p.z, 3, 1 + k.L * 0.04);
    if (P.under) {
      k.underT += dt;
      if (k.underT > SUNK_SHOWN_S) {
        m.visible = false;
        S.stats.culled++;
        S.npcs.splice(i, 1);
      }
    } else if (P.phase === 'aground' && k.t > k.total + 1) {
      // On a shallow bed with its top out of the water: a wreck, left where it lies.
      S.npcs.splice(i, 1);
    }
  }
}

/** A wreck left where something went into the sea, sinking slowly as one piece. */
function sinkingWreck(model, world, opts = {}) {
  let baked = null;
  try {
    baked = bakeWhole(model, opts.skip ? { skip: opts.skip } : {});
  } catch (e) {
    baked = null;
  }
  if (!baked || !S.group) return null;
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  world.decompose(pos, quat, _s);
  const at = baked.com.clone().applyQuaternion(quat).add(pos);
  baked.group.position.copy(at);
  baked.group.quaternion.copy(quat);
  const L = Math.max(baked.size.x, baked.size.y, baked.size.z);
  const body = makeBody({
    position: at,
    quaternion: quat,
    velocity: opts.velocity || new THREE.Vector3(0, -1, 0),
    omega: new THREE.Vector3(0, 0, 0),
    mass: opts.mass || 4000,
    size: baked.size,
    float: 1.35,
    floatT: opts.floatT != null ? opts.floatT : sinkTimes(L).floatT,
    heavy: opts.heavy == null ? -1 : opts.heavy,
  });
  const piece = { group: baked.group, body, zones: [opts.kind || 'wreck'], owner: opts.owner || 'npc', born: S.clock, far: false, engine: false, fuel: false, rotorBlade: false, model: null };
  body.piece = piece;
  addPiece(piece);
  S.stats.wrecksSunk++;
  return piece;
}

/* ---- a van that drives into the sea ---- */

function stepVehicle(sim) {
  const v = sim.vehicle;
  if (sim.mode !== 'drive' || !v || v.isBoat || !sim.vehicleModel) {
    S.swamped = false;
    return;
  }
  if (v.swamped && !S.swamped) {
    S.swamped = true;
    // The truck pulls you out and puts you back on the road — and the van you
    // were in stays where it went in, and goes down slowly.
    const m = sim.vehicleModel;
    m.updateMatrixWorld(true);
    const fwd = _v.set(0, 0, -1).applyQuaternion(v.quat || m.quaternion);
    const piece = sinkingWreck(m, m.matrixWorld.clone(), {
      kind: 'vehicle',
      owner: 'player',
      mass: 1900,
      floatT: 5,
      heavy: -1,
      velocity: fwd.clone().multiplyScalar(Math.min(8, Math.abs(v.speed || 0) * 0.5)).add(new THREE.Vector3(0, -1.5, 0)),
    });
    if (piece && S.fx) S.fx.splash(piece.body.pos.x, piece.body.pos.z, 8 + Math.abs(v.speed || 0), 1.4);
  } else if (!v.swamped) S.swamped = false;
}

/** The wrapper every frame's time goes through: slow motion, the pieces, the replay. */
function frame(sim, dt, inner, args) {
  const busy = S.pieces.length || S.slow.left > 0 || S.slow.ease > 0 || S.replay || (S.fx && S.fx.busy) || S.rec || S.sink || S.rafts.length || S.npcs.length;
  if (!busy) {
    // Nothing broken anywhere: the cost of this whole feature is this line,
    // and keeping the last second and a half of the flight for a replay.
    const out = inner.call(sim, dt, ...args);
    recordPre(sim, dt);
    S.stats.idleFrames++;
    return out;
  }
  let scale = 1;
  if (S.slow.left > 0 && sim.state === 'flying') {
    S.slow.left -= dt;
    scale = SLOWMO.scale;
  } else if (S.slow.ease > 0 && sim.state === 'flying') {
    S.slow.ease -= dt;
    scale = SLOWMO.scale + (1 - SLOWMO.scale) * (1 - Math.max(0, S.slow.ease) / SLOWMO.ease);
  }
  if (S.replay) scale = 1;
  const gdt = dt * scale;
  const out = inner.call(sim, gdt, ...args);
  const t0 = now();
  S.clock += gdt;
  const running = sim.state === 'flying' || sim.state === 'debrief';
  if (running && !S.replay) {
    stepPieces(sim, gdt);
    stepSink(sim, gdt);
    stepNpcs(gdt);
    stepRafts(gdt);
    record(sim, gdt);
  }
  if (S.fx && running) S.fx.update(S.replay ? dt * REPLAY.speed : gdt, sim.camera);
  if (S.replay) playReplay(sim, dt);
  recordPre(sim, gdt);
  const ms = now() - t0;
  S.stats.ms = S.stats.ms * 0.95 + ms * 0.05;
  if (ms > S.stats.msMax) S.stats.msMax = ms;
  return out;
}

/* ------------------------------------------------------------------ *
 * The instant replay
 * ------------------------------------------------------------------ */

/**
 * The second and a half before any crash, kept all the time while flying —
 * a ring of 64 poses reused for ever, read straight off the model (which the
 * game has just put where the aeroplane is), so it allocates nothing.
 */
const PRE_N = 64;
for (let i = 0; i < PRE_N; i++) S.pre.push({ t: -1e9, pos: new THREE.Vector3(), quat: new THREE.Quaternion() });
S.preHead = 0;
function recordPre(sim, dt) {
  const ac = sim && sim.aircraft;
  const model = sim && sim.model;
  if (!model || !ac || ac.crashed || sim.state !== 'flying' || sim.mode === 'drive') return;
  S.clockPre = (S.clockPre || 0) + dt;
  S.preAcc += dt;
  if (S.preAcc < 1 / REPLAY.hz) return;
  S.preAcc = 0;
  const f = S.pre[S.preHead];
  S.preHead = (S.preHead + 1) % PRE_N;
  f.t = S.clockPre;
  f.pos.copy(model.position);
  f.quat.copy(model.quaternion);
}

/** The kept poses, oldest first, timed from the moment of the crash (negative). */
function preFrames() {
  const out = [];
  const tNow = S.clockPre || 0;
  for (let i = 0; i < PRE_N; i++) {
    const f = S.pre[(S.preHead + i) % PRE_N];
    const t = f.t - tNow;
    if (t >= -REPLAY.pre - 0.2 && t <= 0) out.push({ t, pos: f.pos.clone(), quat: f.quat.clone() });
  }
  return out;
}

function startRecording(sim, pieces, reason) {
  const model = sim.model;
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  modelPose(model, pos, quat);
  const inv = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1)).invert();
  S.rec = {
    t0: S.clock,
    reason,
    model,
    pre: preFrames(),
    frames: [{ t: 0, pos, quat }],
    tracks: pieces.map((p) => ({
      piece: p,
      // Where it sat on the airframe: before it breaks, the replay keeps it there.
      attach: inv.clone().multiply(new THREE.Matrix4().compose(p.group.position, p.group.quaternion, new THREE.Vector3(1, 1, 1))),
      frames: [{ t: 0, pos: p.group.position.clone(), quat: p.group.quaternion.clone() }],
    })),
    acc: 0,
    done: false,
    at: Date.now(),
  };
  for (const f of S.pre) f.t = -1e9;
}

function record(sim, dt) {
  const r = S.rec;
  if (!r || r.done) return;
  r.acc += dt;
  const t = S.clock - r.t0;
  if (r.acc < 1 / REPLAY.hz && t < REPLAY.post) return;
  r.acc = 0;
  if (r.model && r.model.parent) {
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    modelPose(r.model, pos, quat);
    r.frames.push({ t, pos, quat });
  }
  for (const tr of r.tracks) {
    if (tr.piece.gone) continue;
    tr.frames.push({ t, pos: tr.piece.group.position.clone(), quat: tr.piece.group.quaternion.clone() });
  }
  const still = r.tracks.every((tr) => tr.piece.gone || tr.piece.body.sleeping);
  if (t >= REPLAY.post || (still && t > 3)) r.done = true;
}

/** Interpolated pose from a list of { t, pos, quat } at time t. */
function sample(frames, t, pos, quat) {
  if (!frames.length) return false;
  if (t <= frames[0].t) {
    pos.copy(frames[0].pos);
    quat.copy(frames[0].quat);
    return true;
  }
  const last = frames[frames.length - 1];
  if (t >= last.t) {
    pos.copy(last.pos);
    quat.copy(last.quat);
    return true;
  }
  let lo = 0;
  let hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = frames[lo];
  const b = frames[hi];
  const k = (t - a.t) / (b.t - a.t || 1);
  pos.copy(a.pos).lerp(b.pos, k);
  quat.copy(a.quat).slerp(b.quat, k);
  return true;
}

export function canReplay() {
  const r = S.rec;
  return !!(r && r.frames.length > 3 && r.model && r.model.parent);
}

/** Start the replay. `fromDebrief`: the crash screen is put away and comes back after. */
export function startReplay(sim, fromDebrief = false) {
  sim = sim || S.sim;
  if (!sim || !canReplay() || S.replay) return false;
  const r = S.rec;
  const pre = r.pre.length ? Math.max(r.pre[0].t, -REPLAY.pre) : 0;
  const end = Math.max(r.frames[r.frames.length - 1].t, ...r.tracks.map((tr) => (tr.frames.length ? tr.frames[tr.frames.length - 1].t : 0)));
  // Orbit round where it all ended up.
  const centre = new THREE.Vector3();
  let n = 0;
  sample(r.frames, end, _v, _q);
  centre.add(_v);
  n++;
  for (const tr of r.tracks) {
    if (tr.piece.gone || !tr.frames.length) continue;
    centre.add(tr.frames[tr.frames.length - 1].pos);
    n++;
  }
  centre.multiplyScalar(1 / n);
  const L = (SPEC && SPEC.wingSpan) || 11;
  let spread = 0;
  for (const tr of r.tracks) if (tr.frames.length) spread = Math.max(spread, tr.frames[tr.frames.length - 1].pos.distanceTo(centre));
  const radius = clamp(L * 1.4 + Math.min(spread, 120) * 0.55 + 12, 20, 160) * (FLASH.reduce ? REPLAY.backReduced : 1);
  const cam = sim.camera;
  const ang = cam ? Math.atan2(cam.position.z - centre.z, cam.position.x - centre.x) : 0;
  // The airframe may have gone under and been put away since (the crash
  // screen offers the replay for two minutes, the sink hides it after one):
  // the replay shows it all the same, and puts it away again after.
  S.replay = { t: pre, start: pre, end, centre, radius, ang, fromDebrief, saved: new Map(), fov: cam ? cam.fov : 60, model: r.model, modelVisible: r.model.visible };
  r.model.visible = true;
  if (fromDebrief && sim.menus && typeof sim.menus.hide === 'function') sim.menus.hide();
  showLabel(true);
  S.stats.replays++;
  return true;
}

export function endReplay(sim, showDebriefAgain = true) {
  const R = S.replay;
  if (!R) return;
  S.replay = null;
  showLabel(false);
  if (R.model) R.model.visible = R.modelVisible;
  // Pieces back where their bodies are.
  for (const p of S.pieces) {
    p.group.position.copy(p.body.pos);
    p.group.quaternion.copy(p.body.quat);
    p.group.visible = true;
  }
  sim = sim || S.sim;
  if (sim && sim.camera) {
    sim.camera.fov = R.fov;
    sim.camera.updateProjectionMatrix();
  }
  if (sim && sim.rig) sim.rig.initialised = false;
  if (R.fromDebrief && showDebriefAgain && sim && sim.menus && S.lastDebrief && sim.state === 'debrief') {
    try {
      sim.menus.showDebrief(S.lastDebrief);
    } catch (e) {
      /* the debrief screen will come back on the next crash */
    }
  }
}

function playReplay(sim, dt) {
  const R = S.replay;
  const r = S.rec;
  if (!R || !r) return;
  if ((sim.state !== 'flying' && sim.state !== 'debrief') || !r.model || !r.model.parent) {
    endReplay(sim, true);
    return;
  }
  R.t += dt * REPLAY.speed;
  if (R.t > R.end + 0.4) {
    endReplay(sim, true);
    return;
  }
  const t = R.t;
  // The airframe: before the hit from the moments kept before it, after from the recording.
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  if (t < 0 && r.pre.length) sample(r.pre.concat([{ t: 0, pos: r.frames[0].pos, quat: r.frames[0].quat }]), t, pos, quat);
  else sample(r.frames, t, pos, quat);
  const model = r.model;
  if (model.matrixAutoUpdate) {
    model.position.copy(pos);
    model.quaternion.copy(quat);
    model.updateMatrixWorld(true);
  } else {
    const sc = model.getWorldScale(_s);
    model.matrix.compose(pos, quat, sc);
    model.matrixWorldNeedsUpdate = true;
    model.updateMatrixWorld(true);
  }
  // Each piece: on the airframe until its moment, then along its track.
  _m.compose(pos, quat, _s.set(1, 1, 1));
  for (const tr of r.tracks) {
    const p = tr.piece;
    if (p.gone) continue;
    if (t < 0) {
      new THREE.Matrix4().multiplyMatrices(_m, tr.attach).decompose(p.group.position, p.group.quaternion, _s);
    } else sample(tr.frames, t, p.group.position, p.group.quaternion);
    p.group.visible = true;
  }
  // The camera, orbiting.
  const cam = sim.camera;
  if (cam) {
    R.ang += dt * 0.32;
    const look = pos.clone().lerp(R.centre, clamp((t - R.start) / Math.max(0.5, R.end - R.start), 0, 1) * 0.6);
    const x = look.x + Math.cos(R.ang) * R.radius;
    const z = look.z + Math.sin(R.ang) * R.radius;
    let y = Math.max(look.y, surface(look.x, look.z, {}).y) + R.radius * 0.38 + 2;
    const g = surface(x, z, {}).y;
    if (y < g + 4) y = g + 4;
    cam.position.set(x, y, z);
    cam.lookAt(look);
    cam.fov = 55;
    cam.updateProjectionMatrix();
  }
  if (S.bar) S.bar.style.width = `${Math.round(100 * clamp((t - R.start) / (R.end - R.start || 1), 0, 1))}%`;
}

function showLabel(on) {
  try {
    if (!S.label) {
      if (!on) return;
      const el = document.createElement('div');
      el.className = 'breakup-replay-label';
      Object.assign(el.style, {
        position: 'absolute', left: '50%', top: '12%', transform: 'translateX(-50%)',
        padding: '6px 18px 10px', borderRadius: '10px', font: '800 14px/1.2 system-ui, sans-serif',
        letterSpacing: '0.18em', color: '#fff', background: 'rgba(200,40,40,0.88)',
        border: '2px solid rgba(255,255,255,0.85)', pointerEvents: 'none', display: 'none', zIndex: '41',
      });
      el.textContent = 'INSTANT REPLAY';
      const track = document.createElement('div');
      Object.assign(track.style, { position: 'absolute', left: '10px', right: '10px', bottom: '3px', height: '3px', borderRadius: '2px', background: 'rgba(255,255,255,0.3)', overflow: 'hidden' });
      const bar = document.createElement('div');
      Object.assign(bar.style, { height: '100%', width: '0%', background: '#fff' });
      track.appendChild(bar);
      el.appendChild(track);
      extLayer().appendChild(el);
      S.label = el;
      S.bar = bar;
    }
    S.label.style.display = on ? 'block' : 'none';
  } catch (e) {
    /* no page: the replay still plays */
  }
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

function ensureListener(sim) {
  const ac = sim && sim.aircraft;
  if (!ac || S.listenedOn === ac || typeof ac.on !== 'function') return;
  S.listenedOn = ac;
  ac.on(EVENTS.CRASH, onCrash);
  ac.on(EVENTS.DAMAGE, onDamage);
}

/** The crash screen gets a "Watch the replay" button while there is one to watch. */
function wrapDebrief(sim) {
  const menus = sim && sim.menus;
  if (!menus || typeof menus.showDebrief !== 'function' || menus.showDebrief.__breakup) return;
  const orig = menus.showDebrief;
  const wrapped = function (opts) {
    let o = opts;
    // A replay is playing: the crash screen waits for it to finish.
    if (S.replay && live()) {
      S.lastDebrief = opts;
      S.replay.fromDebrief = true;
      return undefined;
    }
    try {
      S.lastDebrief = opts;
      if (live() && o && canReplay() && Date.now() - S.rec.at < 120000 && Array.isArray(o.actions) && !o.actions.some((a) => a && a.breakupReplay)) {
        o = { ...o, actions: [...o.actions, { label: `Watch the replay (${keyName('crashReplay', sim)})`, breakupReplay: true, onClick: () => startReplay(sim, true) }] };
      }
    } catch (e) {
      o = opts;
    }
    return orig.call(this, o);
  };
  wrapped.__breakup = true;
  menus.showDebrief = wrapped;
}

function wrapUpdate(sim) {
  if (typeof sim.update !== 'function' || sim._breakupClock) return;
  const inner = sim.update;
  sim._breakupClock = true;
  sim.update = function updateWithBreakup(dt, ...rest) {
    if (!live()) return inner.call(this, dt, ...rest);
    try {
      return frame(this, dt, inner, rest);
    } catch (err) {
      // Whatever went wrong here, the game's own frame must still run.
      if (!S.warned) console.warn('[breakup] frame failed; carrying on without it:', err);
      S.warned = true;
      S.slow.left = 0;
      S.slow.ease = 0;
      if (S.replay && S.replay.model) S.replay.model.visible = S.replay.modelVisible;
      S.replay = null;
      return inner.call(this, dt, ...rest);
    }
  };
}

registerExtension({
  id: 'breakup',

  actions: {
    crashReplay: {
      label: 'Instant replay of your crash (the camera orbits the wreck)',
      group: 'View',
      ctx: ['plane', 'heli'],
      default: ['Backquote'],
    },
  },

  install(sim) {
    S.sim = sim;
    S.quality = (sim.settings && sim.settings.quality) || 'high';
    S.group = new THREE.Group();
    S.group.name = 'breakup:pieces';
    if (sim.scene) sim.scene.add(S.group);
    ensureListener(sim);
    wrapUpdate(sim);
    wrapDebrief(sim);
    onBodyHit(onSkyHit);
    // The replay key on the crash screen, where the game's keys are not listened to.
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('keydown', (ev) => {
        if (!live() || !S.sim || S.sim.state !== 'debrief') return;
        const t = ev.target;
        if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
        if (isKey(S.sim, 'crashReplay', ev.code)) {
          if (S.replay) endReplay(S.sim, true);
          else if (!startReplay(S.sim, true)) return;
          ev.preventDefault();
          ev.stopImmediatePropagation();
        } else if (S.replay && S.replay.fromDebrief && isKey(S.sim, 'pause', ev.code)) {
          endReplay(S.sim, true);
          ev.preventDefault();
          ev.stopImmediatePropagation();
        }
      }, true);
    }
  },

  buildWorld(sim, group) {
    S.sim = sim;
    S.quality = (sim.settings && sim.settings.quality) || 'high';
    // A new world: nothing of the old one's wreck belongs in it.
    resetAll(sim);
    if (S.fx) S.fx.dispose();
    S.fx = new BreakupFx(group, S.quality);
    if (S.group && sim.scene && S.group.parent !== sim.scene) sim.scene.add(S.group);
  },

  startMode(sim) {
    S.sim = sim;
    resetAll(sim);
    S.quality = (sim.settings && sim.settings.quality) || S.quality;
    ensureListener(sim);
    wrapDebrief(sim);
  },

  stop(sim) {
    resetAll(sim);
  },

  update(sim) {
    S.sim = sim;
    ensureListener(sim);
    wrapDebrief(sim);
    stepVehicle(sim);
    // The fleet pack leaves what comes off to us while we are live.
    const m = sim.model;
    if (m && m.userData && m.userData.fleetBridge && !m.userData.partsOwner) m.userData.partsOwner = live;
    // A new flight in the same aeroplane, or a reset on the runway: put it back.
    const ac = sim.aircraft;
    if (ac && !ac.crashed && !ac.lost && m && isBroken(m) && !S.replay) {
      putBack(m);
      unwatch(m);
    }
  },

  key(sim, code, down) {
    if (!down || !isKey(sim, 'crashReplay', code)) return false;
    if (S.replay) {
      endReplay(sim, true);
      return true;
    }
    if (sim.aircraft && sim.aircraft.crashed && startReplay(sim, false)) return true;
    return false;
  },

  devActions: [
    {
      label: 'Snap a wing tip off',
      hint: 'Damage on or off, takes the left outer wing as if it had clipped a tree — you keep flying and she rolls left.',
      run(sim) {
        const ac = sim && sim.aircraft;
        if (!ac || ac.crashed || sim.state !== 'flying') return;
        const hp = (SPEC.hardPoints || []).find((h) => h.part === 'leftWing');
        if (!hp) return;
        const world = hp.pos.clone().applyQuaternion(ac.quat).add(ac.pos);
        damaged(sim, { part: 'leftWing', severity: 0.6, point: world });
      },
    },
    {
      label: 'Instant replay',
      hint: 'Plays your last crash again with the camera orbiting the wreck (the ` key does the same).',
      run(sim) {
        startReplay(sim, sim && sim.state === 'debrief');
      },
    },
  ],
});

/** For the tests and the console. */
export function breakupDebug() {
  return {
    S,
    PIECE_CAP,
    SLOWMO,
    REPLAY,
    plans: S.plans.slice(),
    pieces: S.pieces.map((p) => ({ zones: p.zones.join('+'), owner: p.owner, asleep: p.body.sleeping, wet: p.body.wet, sunk: p.body.sunk, y: Math.round(p.body.pos.y * 10) / 10, x: Math.round(p.body.pos.x), z: Math.round(p.body.pos.z), engine: p.engine, fuel: p.fuel })),
    stats: { ...S.stats, alive: S.pieces.length, awake: S.pieces.filter((p) => !p.body.sleeping).length, fx: S.fx ? { ...S.fx.stats, busy: S.fx.busy } : null },
    replaying: !!S.replay,
    canReplay: canReplay(),
    sink: S.sink ? { t: S.sink.t, started: S.sink.started, hidden: S.sink.hidden, floatT: S.sink.floatT, settleT: S.sink.settleT, sinkT: S.sink.sinkT, delay: S.sink.delay, heavy: S.sink.heavy, L: S.sink.L, belly: S.sink.belly, draft: S.sink.draft, inT: S.sink.settle ? S.sink.settle.inT : null, inAt: S.sink.settle ? S.sink.delay + S.sink.settle.inT : null } : null,
    rafts: S.rafts.map((r) => ({ x: Math.round(r.group.position.x), y: Math.round(r.group.position.y * 100) / 100, z: Math.round(r.group.position.z), person: !!r.person })),
    npcs: S.npcs.map((n) => ({ id: n.body.id, sinking: !!n.sink })),
    slow: { ...S.slow },
    zonesOf: (model, type) => zonesOf(S.sim, model || (S.sim && S.sim.model), type),
    breakModel: (model, type, hit) => breakModel(S.sim, model, type, hit),
    putBack: (model) => putBack(model),
    trackNpc: (body, model) => trackNpc(body, model),
    spawnRaft: (x, z, yaw, L) => spawnRaft(S.sim, x, z, yaw, L),
    npcSinks: () => S.npcs.map((n) => (n.sink ? { t: n.sink.t, phase: n.sink.last ? n.sink.last.phase : null, pitch: n.sink.last ? n.sink.last.pitch : null } : null)),
    startReplay,
    endReplay,
  };
}
