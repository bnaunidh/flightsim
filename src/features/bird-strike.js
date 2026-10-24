/**
 * BIRD STRIKE — the hit, not a cutscene (the owner, 2026-10-22: the bird was
 * "way oversized" and "slowly drifts ~3 s before hitting the engine").
 *
 * What the owner saw was the island's ambient flock (world/features.js: 2.6 m
 * birds circling at a stroll) while the Bird strike event — which drew nothing
 * at all — thumped and roughened the engine. Now the event has its own birds:
 *
 *   - a SMALL FLOCK of three to six, gull to goose sized (0.7-1.5 m span), in
 *     a loose V, flapping;
 *   - they appear AHEAD of you less than half a second before the hit, placed
 *     so that at your closing speed (yours plus theirs, they fly across and
 *     towards you at a real bird's 10-14 m/s) the lead bird meets an ENGINE
 *     exactly: at 120 kt that is thirty metres out, 0.4 s, a flash of wings;
 *   - the hit: the thump (the alerts' thud), a camera kick, a puff of feathers
 *     (no blood: a bird through an engine is feathers), the lead bird gone
 *     into the intake, and the engine running rough — disasters.js's own
 *     effect, which it now applies at the moment of the hit, not when the
 *     event was rolled. features/warnings.js's engine fire waits for it too.
 *   - the rest of the flock scatters past and is gone in a few seconds.
 *
 * On the ground, or with nothing to fly into, the event does what it always
 * did at once. Nothing here is a player action, so there is no key and no
 * touch control. No flashes (the thump is sound and a camera kick).
 *
 * Everything is pooled and built with the world; a strike allocates nothing.
 * The shaders are compiled at world build.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';

/** The numbers, in one place (the tests read them). */
export const BIRD = Object.freeze({
  /** Seconds between the flock appearing and the lead bird meeting the engine. */
  lead: 0.4,
  /** The lead has to be under this: it is a hit, not a cutscene. */
  leadMax: 0.5,
  /** Wingspans, metres: a gull to a goose. */
  spanMin: 0.7,
  spanMax: 1.5,
  /** The ambient mesh's span as drawn (world/features.js draws it 2.6 m across). */
  meshSpan: 2.6,
  /** Birds in the flock. */
  flockMin: 3,
  flockMax: 6,
  /** How fast a bird flies, m/s. */
  speedMin: 10,
  speedMax: 14,
  /** How long the survivors are drawn after the hit, seconds. */
  linger: 3,
  /** Feathers in the puff, and how long they fall. */
  feathers: 10,
  featherLife: 1.6,
  /** The camera kick at the hit. */
  kick: 0.35,
});

/** A gull, a goose, a crow: light to dark, never garish. */
const PLUMAGE = [0xeef0f0, 0xd8d4cc, 0x8a8278, 0x4a4642];

const F = {
  sim: null,
  group: null,
  birds: [], // { mesh, vel: Vector3, span, phase, rate, hit: bool }
  feathers: [], // { mesh, vel: Vector3, spin, age }
  /** The strike in progress: { t, lead, onHit, done, linger } or null. */
  strike: null,
  stats: { strikes: 0, hits: 0, immediate: 0 },
  /** Compile the shaders again on the next frame without a strike (warm). */
  warmPending: false,
};

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Is a strike waiting for its hit (so the fire and the warning wait with it)? */
function pending() {
  return !!(F.strike && !F.strike.done);
}

function birdGeometry() {
  // The same silhouette as the ambient flock, nose along +X, 2.6 m across; a
  // bird's size is its scale. Scaling y at run time is the wingbeat.
  const v = [
    0.7, 0, 0, -0.35, 0.35, -1.3, -0.1, 0, 0,
    0.7, 0, 0, -0.1, 0, 0, -0.35, 0.35, 1.3,
    -0.1, 0, 0, -0.55, 0.05, -0.12, -0.55, 0.05, 0.12,
    0.7, 0, 0, -0.1, -0.08, 0, -0.1, 0, 0,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  geo.computeVertexNormals();
  return geo;
}

function build(sim, parent) {
  dispose();
  const group = new THREE.Group();
  group.name = 'bird-strike';
  group.visible = false;
  const geo = birdGeometry();
  const mats = PLUMAGE.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, side: THREE.DoubleSide, name: 'bird-strike' }));
  for (let i = 0; i < BIRD.flockMax; i++) {
    const mesh = new THREE.Mesh(geo, mats[i % mats.length]);
    mesh.name = 'bird';
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    group.add(mesh);
    F.birds.push({ mesh, vel: new THREE.Vector3(), span: 1, phase: 0, rate: 8, hit: false });
  }
  const fGeo = new THREE.PlaneGeometry(0.12, 0.05);
  const fMat = new THREE.MeshBasicMaterial({ color: 0xf2f2ee, side: THREE.DoubleSide, name: 'bird-strike:feather' });
  for (let i = 0; i < BIRD.feathers; i++) {
    const mesh = new THREE.Mesh(fGeo, fMat);
    mesh.name = 'feather';
    mesh.visible = false;
    mesh.frustumCulled = false;
    group.add(mesh);
    F.feathers.push({ mesh, vel: new THREE.Vector3(), spin: 0, age: 1e9 });
  }
  parent.add(group);
  F.group = group;
  // Compile now, with the world's lights, not on the frame the flock appears (and again on each
  // flight's first frame: the fog and the aeroplane's lights are only final then).
  warm(sim);
}

/** Compile the flock's and the feathers' shaders (hidden objects are not compiled, hence the moment of visibility). */
function warm(sim) {
  F.warmPending = false;
  const group = F.group;
  if (!group) return;
  try {
    const r = sim && sim.renderer;
    if (r && sim.camera && typeof r.compile === 'function') {
      group.visible = true;
      for (const b of F.birds) b.mesh.visible = true;
      for (const f of F.feathers) f.mesh.visible = true;
      r.compile(group, sim.camera, sim.scene || undefined);
      for (const b of F.birds) b.mesh.visible = false;
      for (const f of F.feathers) f.mesh.visible = false;
      group.visible = false;
    }
  } catch (e) {
    /* compiled on first use instead */
  }
}

function dispose() {
  if (F.group) {
    F.group.removeFromParent();
    const seen = new Set();
    F.group.traverse((o) => {
      if (o.geometry && !seen.has(o.geometry)) {
        seen.add(o.geometry);
        o.geometry.dispose();
      }
      if (o.material && !seen.has(o.material)) {
        seen.add(o.material);
        o.material.dispose();
      }
    });
  }
  F.group = null;
  F.birds.length = 0;
  F.feathers.length = 0;
  F.strike = null;
}

/** The engine the flock is aimed at, in body metres (an engine on a wing, else the nose). */
export function enginePoint(type, pick = Math.random()) {
  const p = type && type.shape && type.shape.power;
  if (!p) return new THREE.Vector3(0, 0, -3);
  const x = Number.isFinite(p.x) ? p.x : 0;
  const side = x && (p.count || 1) > 1 ? (pick < 0.5 ? -1 : 1) : 0;
  return new THREE.Vector3(side * x, Number.isFinite(p.y) ? p.y : 0, Number.isFinite(p.z) ? p.z : -3);
}

/**
 * Where to put a flock that will meet `engine` (world) in `lead` seconds,
 * when the aeroplane moves at `vel` (world) and the birds fly at `birdVel`:
 * engine + vel·lead − birdVel·lead. A pure function for the tests.
 */
export function flockOrigin(engine, vel, birdVel, lead) {
  return engine.clone().addScaledVector(vel, lead).addScaledVector(birdVel, -lead);
}

/**
 * Start a strike: the flock appears, and `onHit` runs when the lead bird
 * meets the engine. Returns false (and does nothing) when there is nothing to
 * fly into — then the caller does its effect at once, as before.
 */
export function begin(sim, onHit, rnd = Math.random) {
  const ac = sim && sim.aircraft;
  if (!F.group || !ac || !ac.pos || !ac.vel || !ac.quat || sim.state !== 'flying' || sim.mode === 'drive' || ac.crashed || ac.onGround) return false;
  const speed = ac.vel.length();
  if (speed < 15) return false; // too slow for a bird to be a hit
  if (F.strike && !F.strike.done) return true; // one at a time; the hit is on its way
  // The flock flies across and a little towards you, at a bird's pace.
  const heading = Math.atan2(ac.vel.x, ac.vel.z); // the way you are going, in the horizontal plane
  // 67-90° off head-on, either side: across your path and never AWAY from you
  // (90° ± 23° either way put half the flocks flying along with you).
  const across = (rnd() < 0.5 ? -1 : 1) * (Math.PI / 2 - rnd() * 0.4);
  const birdSpeed = BIRD.speedMin + rnd() * (BIRD.speedMax - BIRD.speedMin);
  const dir = heading + Math.PI + across; // across your path, closing
  const birdVel = new THREE.Vector3(Math.sin(dir) * birdSpeed, 0, Math.cos(dir) * birdSpeed);
  // Which engine, kept in body metres: the hit is wherever that engine IS in `lead` seconds.
  const engineBody = enginePoint(sim.aircraftType, rnd());
  const engine = engineBody.clone().applyQuaternion(ac.quat).add(ac.pos);
  const origin = flockOrigin(engine, ac.vel, birdVel, BIRD.lead);
  const n = BIRD.flockMin + Math.floor(rnd() * (BIRD.flockMax - BIRD.flockMin + 1));
  // The V: the lead at the point, the rest behind it either side, a wingspan or two apart.
  const fwd = birdVel.clone().normalize();
  const side = new THREE.Vector3().crossVectors(UP, fwd).normalize();
  for (let i = 0; i < F.birds.length; i++) {
    const b = F.birds[i];
    b.hit = false;
    if (i >= n) {
      b.mesh.visible = false;
      continue;
    }
    b.span = BIRD.spanMin + rnd() * (BIRD.spanMax - BIRD.spanMin);
    b.phase = rnd() * Math.PI * 2;
    b.rate = 6 + rnd() * 4;
    b.vel.copy(birdVel);
    const rank = Math.ceil(i / 2);
    const s = i === 0 ? 0 : i % 2 ? -1 : 1;
    b.mesh.position.copy(origin).addScaledVector(fwd, -rank * 1.6).addScaledVector(side, s * rank * 1.4);
    b.mesh.position.y += i === 0 ? 0 : (rnd() - 0.5) * 0.8;
    b.mesh.visible = true;
  }
  const yaw = Math.atan2(fwd.x, fwd.z) - Math.PI / 2; // the mesh's nose is +X
  for (const b of F.birds) if (b.mesh.visible) b.mesh.rotation.set(0, yaw, 0, 'YXZ');
  F.group.visible = true;
  F.strike = { t: 0, lead: BIRD.lead, onHit: typeof onHit === 'function' ? onHit : null, done: false, linger: BIRD.linger, engineBody, birdVel };
  F.stats.strikes++;
  return true;
}

function hit(sim) {
  const s = F.strike;
  if (!s || s.done) return;
  s.done = true;
  F.stats.hits++;
  const ac = sim.aircraft;
  const lead = F.birds[0];
  // The lead bird goes into the intake: feathers where the engine is now.
  const at = ac && ac.pos && ac.quat ? s.engineBody.clone().applyQuaternion(ac.quat).add(ac.pos) : lead.mesh.position.clone();
  lead.mesh.visible = false;
  lead.hit = true;
  const carry = ac && ac.vel ? ac.vel : _v.set(0, 0, 0);
  for (let i = 0; i < F.feathers.length; i++) {
    const f = F.feathers[i];
    f.age = 0;
    f.mesh.visible = true;
    f.mesh.position.copy(at).add(_w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.6));
    // Carried along with you for a moment, scattered, and drifting down.
    f.vel.copy(carry).multiplyScalar(0.55).add(_w.set(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).multiplyScalar(6));
    f.spin = (Math.random() - 0.5) * 12;
    f.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
  }
  try {
    if (sim.rig && typeof sim.rig.kick === 'function') sim.rig.kick(BIRD.kick);
  } catch (e) {
    /* no camera to kick */
  }
  if (s.onHit) {
    try {
      s.onHit(sim);
    } catch (e) {
      console.warn('[bird-strike] the hit\'s effect threw', e);
    }
  }
}

function step(sim, dt) {
  const s = F.strike;
  if (!s || !F.group) return;
  s.t += dt;
  let alive = false;
  for (const b of F.birds) {
    if (!b.mesh.visible) continue;
    alive = true;
    b.mesh.position.addScaledVector(b.vel, dt);
    // Flapping: the wings' dihedral, as the ambient flock does it; the size is the span.
    const k = b.span / BIRD.meshSpan;
    const beat = Math.sin(s.t * b.rate + b.phase);
    b.mesh.scale.set(k, k * (0.45 + 0.55 * Math.abs(beat)), k);
  }
  if (!s.done && s.t >= s.lead) hit(sim);
  let feathersAlive = false;
  for (const f of F.feathers) {
    if (!f.mesh.visible) continue;
    f.age += dt;
    if (f.age > BIRD.featherLife) {
      f.mesh.visible = false;
      continue;
    }
    feathersAlive = true;
    f.vel.y -= 2.5 * dt; // a feather falls slowly: drag wins
    f.vel.multiplyScalar(Math.max(0, 1 - 2.2 * dt));
    f.mesh.position.addScaledVector(f.vel, dt);
    f.mesh.rotation.x += f.spin * dt;
    f.mesh.rotation.z += f.spin * 0.6 * dt;
  }
  if (s.done && s.t > s.lead + s.linger) {
    for (const b of F.birds) b.mesh.visible = false;
    alive = false;
  }
  if (!alive && !feathersAlive) {
    F.group.visible = false;
    F.strike = null;
  }
}

function clear() {
  for (const b of F.birds) b.mesh.visible = false;
  for (const f of F.feathers) f.mesh.visible = false;
  if (F.group) F.group.visible = false;
  F.strike = null;
}

registerExtension({
  id: 'bird-strike',
  install(sim) {
    F.sim = sim;
    // disasters.js asks here before it does its effect; warnings.js and main.js ask `pending`.
    sim.birdStrike = {
      begin: (s, onHit) => begin(s || sim, onHit),
      get pending() {
        return pending();
      },
    };
  },
  buildWorld(sim, group) {
    F.sim = sim;
    build(sim, group);
  },
  startMode(sim) {
    F.sim = sim;
    clear();
    F.warmPending = true;
  },
  stop() {
    clear();
  },
  update(sim, dt) {
    F.sim = sim;
    if (F.warmPending && !F.strike) warm(sim);
    if (F.strike) step(sim, Number.isFinite(dt) ? dt : 1 / 60);
  },
});

/** For the tests and the console. */
export function birdStrikeDebug() {
  return {
    BIRD,
    pending: pending(),
    strike: F.strike ? { t: F.strike.t, lead: F.strike.lead, done: F.strike.done } : null,
    birds: F.birds.map((b) => ({ visible: b.mesh.visible, span: b.span, hit: b.hit, pos: b.mesh.position.toArray(), vel: b.vel.toArray(), scale: b.mesh.scale.toArray() })),
    feathers: F.feathers.filter((f) => f.mesh.visible).length,
    groupVisible: !!(F.group && F.group.visible),
    stats: { ...F.stats },
    begin,
    clear,
  };
}
