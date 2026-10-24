/**
 * A piece of aeroplane, as a rigid body: it tumbles, bounces, slides and
 * scrapes along the ground with friction, splashes into the sea and floats
 * there or sinks, and comes to rest as a wreck.
 *
 * IN THE WATER ("if yu crash in the ocena or if something does it slwoly
 * sinks" — the owner): a splash, then it floats on the air trapped in it,
 * bobbing, for a while that grows with its size; then it takes on water,
 * tips towards its heavy end and slips under SLOWLY, a few tens of
 * centimetres a second, sending up bubbles; it settles out of reach below
 * the surface and stays there (the feature culls it a little later). Light
 * debris — a wing tip, a blade — keeps floating and drifts instead.
 *
 * Deliberately small. A piece is a box (its own size) with eight corner
 * points; the ground under it is a plane through the surface at its centre
 * (sampled once a step, not once a corner — a piece is small next to a
 * hill). Contacts are impulses with restitution and Coulomb friction at
 * each corner below the surface, then a push back out; nothing collides with
 * anything else. That is enough for debris to look right and cheap enough
 * for two dozen at once: an asleep piece costs nothing at all.
 *
 *   const b = makeBody({ position, quaternion, velocity, omega, mass, size, float })
 *   stepBody(b, dt, env)
 *   catchPoint(b, point, normal, grip, restitution)
 *                       the surface takes hold of a point of the body: the
 *                       speed into it comes back by `restitution`, `grip` of
 *                       the speed along it is taken at once. A wing tip that
 *                       digs in (grip high) throws the body into a yaw and a
 *                       roll over that tip — the cartwheel; a belly (grip low)
 *                       slides on. Deterministic.
 *
 * THE HULL: a piece is its box's eight corners; the whole airframe (the
 * player's wreck, features/breakup.js) hands in its own points — the nose,
 * the tail, the wing tips, the fin top, the belly — so what touches the
 * ground is what would. `o.hull` is any list of local points.
 *
 * SKIPPING: fast and flat into the water a body skips off it like a stone —
 * SKIP.restitution of the speed into the water comes back, a share of the
 * speed along it is lost — up to SKIP.max times (a tumbling wing tip at 60
 * m/s; an airframe ditched flat at speed) before it goes in. Steep in, it
 * goes straight under (and bobs back).
 *
 * env:
 *   surface(x, z, out)  fill `out` with { y, nx, ny, nz, kind, floor } — kind
 *                       is 'water' (y is the sea's level, floor the sea bed),
 *                       'paved', 'deck' or 'ground'. Required.
 *   obstacle(x, y, z)   a building's box { x0, x1, y0, y1, z0, z1 } or null.
 *   onScrape(b, x, y, z, speed, kind)   a corner sliding fast along it
 *   onImpact(b, x, y, z, speed, kind)   a hard landing (the first, and bounces)
 *   onSplash(b, x, z, speed)            into the water
 *   onBubble(b, x, z)                   slipping under, now and then
 *
 * Pure three.js maths: tests/features/breakup.mjs drops pieces on flat ground
 * and on water in node.
 */

import * as THREE from '../vendor/three.module.js';

const G = 9.81;
const H = 1 / 90;
/** How far under the surface a sunk piece's top settles (it stays faintly visible). */
export const SINK_DEPTH = 2.2;
/** Water's grip on a body going down: sets how slowly it sinks (about 0.3 m/s). */
const SINK_DRAG = 4.8;
/**
 * ...and on one going down FAST: water's drag grows with the speed, so a piece
 * that comes in at 40-60 m/s is stopped inside a couple of metres and bobs back,
 * rather than ploughing ten metres down before the slow drag above can hold it
 * (the whole of a crashed aeroplane's debris was frozen on the sea floor of its
 * own momentum inside a second, floating pieces and all: the crash sweep, finding 2).
 */
const SINK_DRAG_FAST = 1.0;
/** Skipping off the water: fast enough along it, flat enough into it, this much comes back, this many times. */
export const SKIP = { minAlong: 12, maxSteep: 0.3, restitution: 0.55, alongKeep: 0.78, max: 3 };

const _r = new THREE.Vector3();
const _w = new THREE.Vector3();
const _vp = new THREE.Vector3();
const _n = new THREE.Vector3();
const _t = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const SURF = { y: 0, nx: 0, ny: 1, nz: 0, kind: 'ground' };
// The surface under one corner of a big piece (see stepGround).
const CORNER = { y: 0, nx: 0, ny: 1, nz: 0, kind: 'ground' };
const _nc = new THREE.Vector3();
/**
 * A piece this big (half its box diagonal, metres) is not on one plane: a
 * 25 m wing or a fuselage section on a hillside has its ends on different
 * slopes. Under it, the ground is read at each corner.
 */
const BIG_PIECE = 2.5;

/**
 * @param o.size    Vector3, the piece's box (metres)
 * @param o.float   how buoyant while its air lasts (above 1 floats)
 * @param o.light   true: light debris, floats and drifts for good
 * @param o.floatT  seconds its air keeps it up (default: from its size)
 * @param o.heavy   -1 nose (-z) heavy, +1 tail heavy, 0 neither: which end goes under first
 * @param o.maxSpin the fastest it may turn over, rad/s (default 30)
 * @param o.hull    the body's own contact points, local metres: [[x,y,z], ...] or Vector3s (default: the box's corners)
 * @param o.rand    a random source (0..1) for the drift; the same one gives the same drift
 * @param o.noSkip  true: never skips off the water (a wreck left lying on it)
 * @param o.skipMax how many times it may skip (default SKIP.max; an airframe fewer than a wing tip)
 * @param o.skip    { maxSteep, restitution, level } for this body (default SKIP's; level: how upright it must
 *                  arrive, the y of its up axis — a whole airframe skips only near level and stays low, a wing
 *                  low it is the tip that goes in and it does not bounce)
 */
export function makeBody(o) {
  const size = o.size || new THREE.Vector3(1, 0.3, 1);
  const sx = Math.max(0.08, size.x);
  const sy = Math.max(0.08, size.y);
  const sz = Math.max(0.08, size.z);
  const mass = Math.max(5, o.mass || 100);
  let hull;
  if (Array.isArray(o.hull) && o.hull.length >= 4) {
    hull = new Float32Array(o.hull.length * 3);
    let i = 0;
    for (const p of o.hull) {
      hull[i++] = p.isVector3 ? p.x : p[0];
      hull[i++] = p.isVector3 ? p.y : p[1];
      hull[i++] = p.isVector3 ? p.z : p[2];
    }
  } else {
    hull = new Float32Array(24);
    let i = 0;
    // The corners, pulled in a touch: a box's corners are sharper than a wing's.
    for (const x of [-0.45, 0.45]) for (const y of [-0.45, 0.45]) for (const z of [-0.45, 0.45]) {
      hull[i++] = x * sx;
      hull[i++] = y * sy;
      hull[i++] = z * sz;
    }
  }
  const rand = typeof o.rand === 'function' ? o.rand : Math.random;
  return {
    pos: (o.position || new THREE.Vector3()).clone(),
    quat: (o.quaternion || new THREE.Quaternion()).clone().normalize(),
    vel: (o.velocity || new THREE.Vector3()).clone(),
    omega: (o.omega || new THREE.Vector3()).clone(),
    mass,
    invMass: 1 / mass,
    // Diagonal inertia of the box, inverted.
    invI: new THREE.Vector3(12 / (mass * (sy * sy + sz * sz)), 12 / (mass * (sx * sx + sz * sz)), 12 / (mass * (sx * sx + sy * sy))),
    size: new THREE.Vector3(sx, sy, sz),
    radius: 0.5 * Math.hypot(sx, sy, sz),
    hull,
    float: o.float == null ? 1.4 : o.float,
    light: !!o.light,
    // Air pockets: a few seconds for a small piece, much longer for a big one.
    floatT: o.floatT != null ? o.floatT : Math.min(40, 3 + Math.max(sx, sy, sz) * 0.9),
    heavy: o.heavy || 0,
    drift: new THREE.Vector3(rand() - 0.5, 0, rand() - 0.5).normalize().multiplyScalar(0.35),
    skips: 0,
    noSkip: !!o.noSkip,
    skipMax: o.skipMax > 0 ? Math.min(SKIP.max, o.skipMax) : SKIP.max,
    skipSteep: o.skip && o.skip.maxSteep > 0 ? Math.min(SKIP.maxSteep, o.skip.maxSteep) : SKIP.maxSteep,
    skipBack: o.skip && o.skip.restitution >= 0 ? Math.min(SKIP.restitution, o.skip.restitution) : SKIP.restitution,
    skipLevel: o.skip && o.skip.level > 0 ? o.skip.level : 0,
    // Whether any of it was in the water on the last step (a skip is the moment it comes back to it).
    inWater: false,
    lastHit: 0,
    wetT: 0,
    // Seconds since it last touched the ground: a thin piece rocking on an edge touches it only part of the time.
    airT: 0,
    bubbleT: 0,
    sunkT: 0,
    restitution: o.restitution == null ? 0.18 : o.restitution,
    maxSpin: o.maxSpin > 0 ? Math.min(30, o.maxSpin) : 30,
    acc: 0,
    sleeping: false,
    sleepT: 0,
    contacts: 0,
    landed: false,
    wet: false,
    sunk: false,
    age: 0,
    scrapeT: 0,
    lastKind: null,
  };
}

/** Inverse inertia in world axes, applied to v (in place). */
function invIWorld(b, v) {
  _qi.copy(b.quat).invert();
  v.applyQuaternion(_qi);
  v.x *= b.invI.x;
  v.y *= b.invI.y;
  v.z *= b.invI.z;
  return v.applyQuaternion(b.quat);
}

function applyImpulse(b, r, imp) {
  b.vel.addScaledVector(imp, b.invMass);
  _a.copy(r).cross(imp);
  b.omega.add(invIWorld(b, _a));
}

/** Effective mass denominator along a direction at arm r. */
function kAlong(b, r, dir) {
  _a.copy(r).cross(dir);
  invIWorld(b, _a);
  _b.copy(_a).cross(r);
  return b.invMass + _b.dot(dir);
}

/**
 * The surface takes hold of the body at `point` (world): see the header.
 * `normal` points out of the surface. Returns the impulse's size, kg m/s.
 */
export function catchPoint(b, point, normal, grip = 0.5, restitution = 0) {
  _n.copy(normal).normalize();
  _r.copy(point).sub(b.pos);
  _vp.copy(b.omega).cross(_r).add(b.vel);
  const vn = _vp.dot(_n);
  let j = 0;
  if (vn < 0) {
    // The speed into the surface stops (and some comes back).
    const jn = (-(1 + Math.max(0, restitution)) * vn) / kAlong(b, _r, _n);
    applyImpulse(b, _r, _t.copy(_n).multiplyScalar(jn));
    j += jn;
  }
  if (grip > 0) {
    _vp.copy(b.omega).cross(_r).add(b.vel);
    _vp.addScaledVector(_n, -_vp.dot(_n));
    const vt = _vp.length();
    if (vt > 1e-6) {
      _t.copy(_vp).multiplyScalar(1 / vt);
      const jt = (Math.min(1, grip) * vt) / kAlong(b, _r, _t);
      applyImpulse(b, _r, _t.multiplyScalar(-jt));
      j += jt;
    }
  }
  const w = b.omega.length();
  if (w > b.maxSpin) b.omega.multiplyScalar(b.maxSpin / w);
  b.sleeping = false;
  b.sleepT = 0;
  return j;
}

export function stepBody(b, dt, env) {
  if (b.sleeping || !(dt > 0)) return b;
  b.age += dt;
  b.acc += Math.min(dt, 0.1);
  let n = 0;
  while (b.acc >= H && n < 9) {
    substep(b, env);
    b.acc -= H;
    n++;
    if (b.sleeping) break;
  }
  if (![b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z].every(Number.isFinite)) {
    // Never let a bad number loose in the scene: stop it where the ground is.
    b.vel.set(0, 0, 0);
    b.omega.set(0, 0, 0);
    if (!Number.isFinite(b.pos.x)) b.pos.set(0, 0, 0);
    env.surface(b.pos.x, b.pos.z, SURF);
    b.pos.y = SURF.y + b.size.y * 0.5;
    b.sleeping = true;
  }
  return b;
}

function substep(b, env) {
  const s = env.surface(b.pos.x, b.pos.z, SURF);
  const water = s.kind === 'water';
  b.vel.y -= G * H;
  // A little air: enough that a flat piece does not fly for ever.
  b.vel.multiplyScalar(Math.exp(-0.035 * H));
  b.omega.multiplyScalar(Math.exp(-0.06 * H));

  if (water) {
    stepWater(b, s, env);
  } else {
    stepGround(b, s, env);
  }
  // Integrate.
  b.pos.addScaledVector(b.vel, H);
  // Limits: nothing in a crash leaves faster than this, or turns over faster
  // than its own limit (its size's, and Reduce flashing's: see breakup.js).
  let w = b.omega.length();
  if (w > b.maxSpin) {
    b.omega.multiplyScalar(b.maxSpin / w);
    w = b.maxSpin;
  }
  if (w > 1e-9) {
    _q.setFromAxisAngle(_t.copy(b.omega).multiplyScalar(1 / w), w * H);
    b.quat.premultiply(_q).normalize();
  }
  const v = b.vel.length();
  if (v > 140) b.vel.multiplyScalar(140 / v);

  const obs = env.obstacle && env.obstacle(b.pos.x, b.pos.y, b.pos.z);
  if (obs) bounceOffBox(b, obs, env);

  // Rest: supported and barely moving for a little while. In the water only
  // once it has gone to the bottom, or — light debris — once the sea has
  // had it for a good while: until then it bobs and drifts.
  const still = b.vel.lengthSq() < 0.09 && b.omega.lengthSq() < 0.09;
  if (b.contacts > 0) b.airT = 0;
  else b.airT += H;
  /*
   * "Supported" is touching the ground now or a moment ago. A gear leg rocking
   * on its edge at 0.1 m/s and 15 degrees a second touches it on most
   * substeps and not on the others, and reset the clock every time it did not:
   * it never slept, for two minutes, and cost a physics step every frame
   * (the crash sweep, finding 6). And a piece that is nearly still on the
   * ground loses what is left of its turning, as a heavy thing does.
   */
  const resting = b.contacts > 0 || b.airT < 0.25;
  if (resting && !b.wet && still && b.contacts > 0) b.omega.multiplyScalar(Math.exp(-7 * H));
  if (b.sunk) b.sleepT += H;
  else if (resting && !b.wet && still) b.sleepT += H;
  else if (b.wet && b.light && b.wetT > 60 && still) b.sleepT += H;
  else b.sleepT = 0;
  if (b.sleepT > 0.6) {
    b.sleeping = true;
    b.vel.set(0, 0, 0);
    b.omega.set(0, 0, 0);
  }
}

function stepGround(b, s, env) {
  _n.set(s.nx, s.ny, s.nz).normalize();
  const mu = s.kind === 'paved' || s.kind === 'deck' ? 0.42 : 0.62;
  let maxDepth = 0;
  let contacts = 0;
  let hitSpeed = 0;
  let scrape = 0;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  const big = b.radius > BIG_PIECE;
  const H3 = b.hull.length;
  for (let i = 0; i < H3; i += 3) {
    _r.set(b.hull[i], b.hull[i + 1], b.hull[i + 2]).applyQuaternion(b.quat);
    _w.copy(_r).add(b.pos);
    // The ground plane through the surface under the centre.
    let planeY = s.y - (s.nx * (_w.x - b.pos.x) + s.nz * (_w.z - b.pos.z)) / Math.max(0.2, s.ny);
    let nrm = _n;
    if (big) {
      // The ground right under this corner, with its own slope: a plane through the centre put
      // the ends of a big piece 1-4 m into a hillside (the crash sweep, finding 4). Only for a
      // corner that could be touching: one well above the plane (by more than a steep hillside
      // could make up over its distance from the centre) is in the air whatever the slope, and
      // the whole airframe's hull has eighty corners, most of them up on the wings and the back.
      const far = Math.hypot(_w.x - b.pos.x, _w.z - b.pos.z);
      if (_w.y - planeY > far * 0.7 + 0.5) continue;
      env.surface(_w.x, _w.z, CORNER);
      planeY = CORNER.y;
      nrm = _nc.set(CORNER.nx, CORNER.ny, CORNER.nz).normalize();
    }
    const depth = (planeY - _w.y) * nrm.y;
    if (depth <= 0) continue;
    contacts++;
    if (depth > maxDepth) maxDepth = depth;
    _vp.copy(b.omega).cross(_r).add(b.vel);
    const vn = _vp.dot(nrm);
    if (vn < 0) {
      if (-vn > hitSpeed) hitSpeed = -vn;
      const e = -vn > 1.2 ? b.restitution : 0;
      const j = (-(1 + e) * vn) / kAlong(b, _r, nrm);
      applyImpulse(b, _r, _t.copy(nrm).multiplyScalar(j));
      // Coulomb friction against the sliding left after it.
      _vp.copy(b.omega).cross(_r).add(b.vel);
      const vnn = _vp.dot(nrm);
      _vp.addScaledVector(nrm, -vnn);
      const vt = _vp.length();
      if (vt > 1e-6) {
        _t.copy(_vp).multiplyScalar(1 / vt);
        const jt = Math.min(vt / kAlong(b, _r, _t), mu * j);
        applyImpulse(b, _r, _t.multiplyScalar(-jt));
        if (vt > scrape) {
          scrape = vt;
          sx = _w.x;
          sy = _w.y;
          sz = _w.z;
        }
      }
    }
  }
  b.contacts = contacts;
  if (maxDepth > 0) {
    b.pos.addScaledVector(_n, maxDepth * 0.85);
    // Rolling resistance: a piece on the ground stops turning over.
    b.omega.multiplyScalar(Math.exp(-2.2 * H));
    b.lastHit = hitSpeed;
    if (hitSpeed > 3 && env.onImpact) env.onImpact(b, b.pos.x, s.y, b.pos.z, hitSpeed, s.kind);
    if (!b.landed) b.landed = true;
  } else b.lastHit = 0;
  b.lastKind = s.kind;
  b.scrapeT -= H;
  if (scrape > 3.5 && env.onScrape && b.scrapeT <= 0) {
    b.scrapeT = 0.05;
    env.onScrape(b, sx, s.y, sz, scrape, s.kind);
  }
}

function stepWater(b, s, env) {
  const level = s.y;
  // Off the ground and into the sea: the last bounce on land is not a jolt any more (it tore what hung on at once).
  b.lastHit = 0;
  if (b.sunk) {
    b.vel.set(0, 0, 0);
    b.omega.set(0, 0, 0);
    return;
  }
  // How much of it is under: the share of its height below the surface, and
  // where the lift acts — the middle of the corners that are under.
  let sub = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  const H3 = b.hull.length;
  for (let i = 0; i < H3; i += 3) {
    _r.set(b.hull[i], b.hull[i + 1], b.hull[i + 2]).applyQuaternion(b.quat);
    const y = b.pos.y + _r.y;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    const d = Math.max(0, level - y);
    if (d > 0) {
      sub += d;
      cx += _r.x * d;
      cy += _r.y * d;
      cz += _r.z * d;
    }
  }
  const f = Math.min(1, Math.max(0, (level - minY) / Math.max(0.05, maxY - minY)));
  const arriving = f > 0 && !b.inWater;
  if (arriving && !b.wet) {
    b.wet = true;
    if (env.onSplash) env.onSplash(b, b.pos.x, b.pos.z, Math.max(0, -b.vel.y) + b.vel.length() * 0.3);
  }
  b.inWater = f > 0;
  b.contacts = 0;
  if (b.wet) b.wetT += H;
  if (f <= 0) return;
  // Coming to the water fast and flat: it skips off it, like a stone.
  if (arriving && !b.noSkip && b.skips < b.skipMax && b.vel.y < 0) {
    const along = Math.hypot(b.vel.x, b.vel.z);
    const steep = -b.vel.y / Math.max(1e-6, Math.hypot(along, b.vel.y));
    const level = !b.skipLevel || _r.set(0, 1, 0).applyQuaternion(b.quat).y >= b.skipLevel;
    if (along >= SKIP.minAlong && steep <= b.skipSteep && level) {
      b.skips++;
      b.vel.y = -b.vel.y * b.skipBack + 0.4;
      b.vel.x *= SKIP.alongKeep;
      b.vel.z *= SKIP.alongKeep;
      // The slap flattens it a little, and it keeps turning over the way it was.
      b.omega.multiplyScalar(0.7);
      if (b.skips > 1 && env.onSplash) env.onSplash(b, b.pos.x, b.pos.z, along * 0.4);
      // Clear of the surface, so the lift below does not add to the skip.
      b.pos.y += Math.max(0, level - minY) + 0.02;
      b.inWater = false;
      b.wetT = 0;
      return;
    }
  }
  // The air in it, running out: floats while it lasts, then slowly less than
  // floats. Light debris never runs out.
  let buoy = b.float;
  if (!b.light) {
    const k = Math.min(1, Math.max(0, (b.wetT - b.floatT) / 6));
    buoy = b.float + (0.84 - b.float) * k;
  }
  _r.set(cx / sub, cy / sub, cz / sub);
  // Taking on water at the heavy end first: the lift moves to the other end,
  // so the heavy one goes down and it slides under tilted — to about forty
  // degrees, not standing on its end.
  if (!b.light && b.heavy && b.wetT > b.floatT * 0.6) {
    _w.set(0, 0, 1).applyQuaternion(b.quat);
    // How far the nose is already down (+) or up (-).
    const pitch = Math.asin(Math.max(-1, Math.min(1, _w.y)));
    const want = 0.7 * (b.heavy < 0 ? 1 : -1);
    const k = Math.max(0, Math.min(1, (want - pitch) / want));
    _w.set(0, 0, -b.heavy * b.size.z * 0.12 * k).applyQuaternion(b.quat);
    _r.add(_w);
  }
  // Upward force at the centre of what is under, so it rights itself.
  _t.set(0, b.mass * G * buoy * f * H, 0);
  applyImpulse(b, _r, _t);
  // Water is thick: hardly any way on it, and slow to go down through it.
  const dh = Math.exp(-1.7 * f * H);
  b.vel.x *= dh;
  b.vel.z *= dh;
  b.vel.y *= Math.exp(-(SINK_DRAG + SINK_DRAG_FAST * Math.abs(b.vel.y)) * f * H);
  b.omega.multiplyScalar(Math.exp(-2.6 * f * H));
  // Afloat: the swell lifts it, and the wind and the tide take it along.
  if (buoy > 1 && f < 0.95) {
    b.vel.y += Math.sin(b.age * 1.35 + b.drift.x * 9) * 0.55 * H;
    b.vel.x += (b.drift.x - b.vel.x) * 0.4 * H;
    b.vel.z += (b.drift.z - b.vel.z) * 0.4 * H;
  }
  // Slipping under: bubbles now and then.
  if (buoy < 1 && b.pos.y < level + b.size.y && b.pos.y > level - 3.5) {
    b.bubbleT -= H;
    if (b.bubbleT <= 0 && env.onBubble) {
      b.bubbleT = 0.12;
      env.onBubble(b, b.pos.x, b.pos.z);
    }
  }
  // Gone under: once its highest corner is a couple of metres down it stops
  // there, still faintly visible — or on the sea bed where that is higher.
  // Only once its air has run out (buoy under 1, which light debris never
  // reaches): a piece that came in fast and is down there for a moment is
  // still rising, and was frozen in place and culled before it could float.
  const floorY = Number.isFinite(s.floor) ? s.floor + (b.pos.y - minY) : -Infinity;
  if ((maxY < level - SINK_DEPTH && buoy < 1) || b.pos.y < floorY) {
    if (b.pos.y < floorY) b.pos.y = floorY;
    b.vel.set(0, 0, 0);
    b.omega.set(0, 0, 0);
    b.sunk = true;
  }
}

function bounceOffBox(b, o) {
  // Out through the nearest wall, and the speed into it turned round.
  const dx0 = b.pos.x - o.x0;
  const dx1 = o.x1 - b.pos.x;
  const dz0 = b.pos.z - o.z0;
  const dz1 = o.z1 - b.pos.z;
  const dy1 = o.y1 - b.pos.y;
  const m = Math.min(dx0, dx1, dz0, dz1, dy1);
  if (m === dy1) {
    b.pos.y = o.y1 + 0.05;
    if (b.vel.y < 0) b.vel.y *= -0.2;
  } else if (m === dx0) {
    b.pos.x = o.x0 - 0.05;
    if (b.vel.x > 0) b.vel.x *= -0.3;
  } else if (m === dx1) {
    b.pos.x = o.x1 + 0.05;
    if (b.vel.x < 0) b.vel.x *= -0.3;
  } else if (m === dz0) {
    b.pos.z = o.z0 - 0.05;
    if (b.vel.z > 0) b.vel.z *= -0.3;
  } else {
    b.pos.z = o.z1 + 0.05;
    if (b.vel.z < 0) b.vel.z *= -0.3;
  }
  b.omega.multiplyScalar(0.7);
}
