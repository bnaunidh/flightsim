/**
 * The ambient cars: one InstancedMesh per kind of vehicle, driven along the
 * lanes of ../ambient/lanes.js.
 *
 *   LOD       the real shape within 400 m; a box of the right size and
 *             colour from 400 m to 1.5 km (one shared InstancedMesh); nothing
 *             beyond. Matrices are written only for instances that are drawn,
 *             and at half rate beyond 600 m.
 *   LANES     right-hand lanes; at a lane's end a car goes straight on to a
 *             lane that starts or passes there, turns off at a junction now
 *             and then, or turns round at a dead end.
 *   SIGNALS   where streets cross: a clock per junction, a stop line per
 *             lane, instanced signal heads whose lamp changes colour.
 *   NIGHT     headlights as one Points draw, two per car in view.
 *   YIELDING  on the driving maps a car holds 25 m clear of the player's car,
 *             ahead or behind; it is never solid. An aeroplane on the ground,
 *             or the player on foot, in its way: it stops short of them.
 *   EACH OTHER  a car keeps its distance from the one in front (FOLLOW_GAP
 *             bumper to bumper at a standstill, more with speed): it brakes
 *             for it as hard as BRAKE allows and never drives into it.
 *   JUNCTIONS it slows for a turning and for the end of its road.
 *   HIT       run into at speed by the player (an aeroplane on its take-off
 *             roll, the van), a car is shoved aside, slews, and stops where
 *             it ends up. Nobody is in it to be hurt, and nothing is shown.
 *   PARKED    cars at the kerb along the town's streets (populate kerb).
 *
 * Nothing is allocated per frame: positions live in flat arrays, the matrix
 * and colour scratch objects live at module scope.
 */

import * as THREE from '../../vendor/three.module.js';
import { Batch, instanced } from '../../world/airport-kit.js';
import { fireEngineGeometry } from '../../world/airport-vehicles.js';
import { sampleLane, signalGreen } from './lanes.js';
import { makeRandom } from '../../core/noise.js';
import { wearRealVehicle } from '../../aircraft/real-models.js';
import { betterCarGeometry, carPaint } from './car-models.js';

/** Metres: the real shape up to here. */
export const CAR_NEAR = 400;
/** Metres: the box stand-in up to here, nothing beyond. */
export const CAR_FAR = 1500;
/** Beyond this the matrices are written every other frame. */
const HALF_RATE = 600;
/** A car holds this far from the player's car. */
export const YIELD_GAP = 25;

const D2R = Math.PI / 180;
const _m = new THREE.Matrix4();
const _c = new THREE.Color();
const S = { x: 0, y: 0, z: 0, i: 0, heading: 0 };

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

/** Size and speed per kind. Length along -Z (the nose), width across X, height. */
export const KINDS = Object.freeze({
  car: { L: 4.4, W: 1.75, H: 1.5, speed: 13, colour: 0xd8d8dc, vary: true },
  taxi: { L: 4.5, W: 1.8, H: 1.6, speed: 13, colour: 0xf2c230 },
  bus: { L: 11, W: 2.5, H: 3.2, speed: 9, colour: 0x2d6fb8 },
  van: { L: 5.4, W: 2.0, H: 2.3, speed: 11, colour: 0xf2f2f0 },
  truck: { L: 8, W: 2.5, H: 3.3, speed: 8, colour: 0x5a6b4e },
  jeep: { L: 4, W: 1.8, H: 1.9, speed: 11, colour: 0x6b7a5a },
  fourx4: { L: 4.8, W: 1.95, H: 2.0, speed: 10, colour: 0x8a3b2e },
  tractor: { L: 3.6, W: 1.9, H: 2.7, speed: 4, colour: 0x2f8a3c },
  firetruck: { L: 9.4, W: 2.6, H: 3.4, speed: 0, colour: 0xc8322a },
  // Shapes a 'car' may be drawn as (CarLayer variety), and the town's police car.
  hatch: { L: 3.9, W: 1.7, H: 1.52, speed: 13, colour: 0xd8d8dc, vary: true },
  pickup: { L: 5.3, W: 1.9, H: 1.8, speed: 12, colour: 0xd8d8dc, vary: true },
  police: { L: 4.6, W: 1.8, H: 1.55, speed: 12, colour: 0xf2f3f0 },
  // Two more a 'car' may be, where the better shapes are drawn (car-models.js): an estate and an SUV.
  estate: { L: 4.65, W: 1.78, H: 1.5, speed: 13, colour: 0xd8d8dc, vary: true },
  suv: { L: 4.6, W: 1.88, H: 1.7, speed: 12, colour: 0xd8d8dc, vary: true },
});

/** Metres, bumper to bumper, a car stops behind the one in front. */
export const FOLLOW_GAP = 3;
/** m/s²: the braking a driver plans on (and twice it when it has to). */
export const BRAKE = 4;
/** Metres ahead a driver looks for the car in front. */
const LOOK = 75;
/** A car is slowed to this share of its pace for a turning or the end of its road, from SLOW_FROM metres out. */
const SLOW_TO = 0.5;
const SLOW_FROM = 24;
/** Metres short of where its road joins another that a car waits for the road to be clear (the other road's own half-width and a bit). */
const GIVE_WAY = 8;
/** The player moving faster than this (m/s) into a car shoves it aside. */
const HIT_SPEED = 3;
/** Following the player (CarLayer.setFollow): a car left behind is brought back to FOLLOW_IN metres from the camera or more... */
const FOLLOW_IN = 150;
/** (In the first FOLLOW_START seconds, as a flight begins, they may be put closer than that: nobody has seen the street empty yet.) */
const FOLLOW_START = 3;
/**
 * ...out to FOLLOW_LOW metres with the camera on the ground (down a street you see 500 m, and the
 * cars there are should be in it), widening with its height to FOLLOW_OUT (from the air you see
 * the whole town); a car FOLLOW_PAST beyond that has been left behind.
 */
const FOLLOW_LOW = 520;
/** Nobody is put on the road within this of the player themselves. */
const FOLLOW_CLEAR = 90;
const FOLLOW_OUT = 1400;
const FOLLOW_PAST = 320;
const FOLLOW_CELL = 300;
/** A street this wide (half, metres) or wider has cars parked at its kerb, KERB_IN from the edge. */
export const KERB_MIN = 5;
const KERB_IN = 0.85;

function wheels(b, halfTrack, axles, r, w = 0.3) {
  for (const z of axles) for (const s of [-1, 1]) b.cyl(r, r, w, s * halfTrack, r - w / 2, z, 0x17191c, 10, { matrix: wheelMatrix(s * halfTrack, r, z) });
}
const _wm = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
function wheelMatrix(x, y, z) {
  _q.setFromAxisAngle(_p.set(0, 0, 1), Math.PI / 2);
  _p.set(x, y, z);
  return _wm.compose(_p, _q, _s);
}

export function carShape(k, colour) {
  const b = new Batch();
  const d = KINDS[k];
  const L = d.L;
  const W = d.W;
  const glass = 0x2a3440;
  if (k === 'bus') {
    b.slab(-W / 2, W / 2, 0.5, d.H, -L / 2, L / 2, colour);
    b.slab(-W / 2 - 0.02, W / 2 + 0.02, 1.6, 2.6, -L / 2 + 0.6, L / 2 - 0.4, glass);
    b.slab(-W / 2 + 0.1, W / 2 - 0.1, 1.2, 2.9, -L / 2 - 0.03, -L / 2 + 0.02, glass);
    wheels(b, W / 2 - 0.15, [-L / 2 + 1.6, L / 2 - 2.2], 0.5, 0.35);
  } else if (k === 'truck' || k === 'firetruck') {
    // A cab and a body.
    b.slab(-W / 2, W / 2, 0.75, 2.5, -L / 2, -L / 2 + 2.2, k === 'firetruck' ? colour : 0x4a5a40);
    b.slab(-W / 2 + 0.1, W / 2 - 0.1, 1.6, 2.4, -L / 2 - 0.02, -L / 2 + 0.03, glass);
    b.slab(-W / 2, W / 2, 0.8, d.H, -L / 2 + 2.4, L / 2, colour);
    if (k === 'firetruck') {
      b.slab(-W / 2 - 0.02, W / 2 + 0.02, 1.4, 1.65, -L / 2 + 2.4, L / 2, 0xf2d24a);
      b.slab(-0.9, 0.9, 2.5, 2.7, -L / 2 + 0.4, -L / 2 + 0.9, 0x1d4fb8);
    }
    wheels(b, W / 2 - 0.15, [-L / 2 + 1.3, L / 2 - 2.6, L / 2 - 1.0], 0.55, 0.4);
  } else if (k === 'tractor') {
    b.slab(-0.6, 0.6, 0.6, 1.5, -1.8, 0.4, colour);
    b.slab(-0.8, 0.8, 1.5, 2.7, -0.6, 0.8, colour);
    b.slab(-0.72, 0.72, 1.7, 2.5, -0.62, 0.78, glass);
    b.cyl(0.9, 0.9, 0.5, -0.95, 0, 0.6, 0x17191c, 10, { matrix: wheelMatrix(-0.95, 0.9, 0.6) });
    b.cyl(0.9, 0.9, 0.5, 0.95, 0, 0.6, 0x17191c, 10, { matrix: wheelMatrix(0.95, 0.9, 0.6) });
    b.cyl(0.45, 0.45, 0.3, -0.8, 0, -1.3, 0x17191c, 10, { matrix: wheelMatrix(-0.8, 0.45, -1.3) });
    b.cyl(0.45, 0.45, 0.3, 0.8, 0, -1.3, 0x17191c, 10, { matrix: wheelMatrix(0.8, 0.45, -1.3) });
  } else if (k === 'pickup') {
    // A cab forward, an open bed behind it between low sides.
    b.slab(-W / 2, W / 2, 0.5, 1.05, -L / 2, L / 2, colour);
    b.slab(-W / 2 + 0.1, W / 2 - 0.1, 1.05, d.H, -L / 2 + 1.5, -L / 2 + 3.1, colour);
    b.slab(-W / 2 + 0.13, W / 2 - 0.13, 1.12, d.H - 0.12, -L / 2 + 1.48, -L / 2 + 2.3, glass);
    b.slab(-W / 2 + 0.2, W / 2 - 0.2, 1.15, d.H - 0.15, -L / 2 + 3.08, -L / 2 + 3.12, glass);
    for (const s of [-1, 1]) b.slab(s * (W / 2 - 0.06) - 0.06, s * (W / 2 - 0.06) + 0.06, 1.05, 1.4, -L / 2 + 3.1, L / 2, colour);
    b.slab(-W / 2, W / 2, 1.05, 1.4, L / 2 - 0.12, L / 2, colour);
    b.slab(-W / 2 + 0.12, W / 2 - 0.12, 1.02, 1.08, -L / 2 + 3.1, L / 2 - 0.12, 0x2b2d30);
    for (const s of [-1, 1]) b.slab(s * (W / 2 - 0.3) - 0.2, s * (W / 2 - 0.3) + 0.2, 0.7, 0.9, L / 2 - 0.02, L / 2 + 0.02, 0x8a1414);
    wheels(b, W / 2 - 0.1, [-L / 2 + 1.0, L / 2 - 1.15], 0.4);
  } else {
    // Car, taxi, van, jeep, 4x4, hatchback, police car: a body and a cabin.
    const cabH = k === 'van' ? d.H : d.H * 0.98;
    const cabFront = k === 'van' ? -L / 2 + 1.2 : k === 'hatch' ? -L / 2 + 1.15 : -L / 2 + 1.5;
    const cabBack = k === 'van' ? L / 2 : k === 'hatch' ? L / 2 - 0.12 : L / 2 - 0.6;
    b.slab(-W / 2, W / 2, 0.45, 0.45 + d.H * 0.5, -L / 2, L / 2, colour);
    b.slab(-W / 2 + 0.12, W / 2 - 0.12, 0.45 + d.H * 0.5, cabH, cabFront, cabBack, k === 'van' ? colour : colour);
    b.slab(-W / 2 + 0.14, W / 2 - 0.14, 0.45 + d.H * 0.52, cabH - 0.12, cabFront - 0.02, cabFront + 0.9, glass);
    for (const s of [-1, 1]) b.slab(s * (W / 2 - 0.12) - 0.02, s * (W / 2 - 0.12) + 0.02, 0.45 + d.H * 0.55, cabH - 0.15, cabFront + 0.3, cabBack - 0.3, glass);
    if (k !== 'van') {
      // A rear window, and tail lamps either side at the back of the body.
      b.slab(-W / 2 + 0.16, W / 2 - 0.16, 0.45 + d.H * 0.54, cabH - 0.12, cabBack - 0.02, cabBack + 0.02, glass);
      for (const s of [-1, 1]) b.slab(s * (W / 2 - 0.3) - 0.22, s * (W / 2 - 0.3) + 0.22, 0.45 + d.H * 0.32, 0.45 + d.H * 0.46, L / 2 - 0.02, L / 2 + 0.02, 0x8a1414);
    }
    if (k === 'taxi') b.slab(-0.35, 0.35, cabH, cabH + 0.22, -0.3, 0.3, 0xf2f2f0);
    if (k === 'police') {
      // A dark band along the doors and a light bar across the roof (steady: nothing here flashes).
      for (const s of [-1, 1]) b.slab(s * (W / 2) - 0.015, s * (W / 2) + 0.015, 0.62, 0.45 + d.H * 0.46, -L / 2 + 1.2, L / 2 - 0.9, 0x1d3f8a);
      b.slab(-0.55, -0.05, cabH, cabH + 0.16, -0.15, 0.2, 0x2c5fd8);
      b.slab(0.05, 0.55, cabH, cabH + 0.16, -0.15, 0.2, 0xc8322a);
    }
    wheels(b, W / 2 - 0.1, [-L / 2 + 0.9, L / 2 - 0.9], k === 'fourx4' || k === 'jeep' ? 0.42 : 0.34);
  }
  return b.geometry();
}

/** Headlight positions per kind, worked out once: nothing is made per car per frame. */
const LAMPS = Object.freeze(Object.fromEntries(Object.entries(KINDS).map(([k, d]) => [k, Object.freeze({ y: 0.75, x: d.W / 2 - 0.3, z: -d.L / 2 + 0.05 })])));
function lampsOf(k) {
  return LAMPS[k];
}

/* ------------------------------------------------------------------ */
/* The layer                                                           */
/* ------------------------------------------------------------------ */

/** What cars are painted, as often as you see it on a real street: white, silver, grey and black most of all. */
const CAR_TINTS = [0xe9e9e6, 0xe9e9e6, 0xc3c6ca, 0xc3c6ca, 0x8b9096, 0x4a4d52, 0x1b1c1f, 0x1b1c1f, 0x1f2a3a, 0x2f5f9a, 0x7fa3c4, 0x8a1f1f, 0xb5301f, 0xe8e2d0, 0xb9a98a, 0x6d8a3a, 0x24493a, 0xd79a2a, 0x5b2a6e, 0x7a4a2c];

export class CarLayer {
  /**
   * @param {THREE.Group} group    where the meshes go (disposed with the world)
   * @param {object} net           buildLanes()'s result
   */
  /**
   * `shadows`: whether the vehicles cast shadows. Off below High: the shadow
   * pass draws every instanced mesh a second time, and at Medium that was
   * the difference between +8 and +12 draw calls on a town street.
   * `variety`: a 'car' is drawn as a saloon, a hatchback or a pick-up (two more
   * meshes: not at Low). `ground`: (x, z) => y, for a car shoved off its lane.
   * `better`: car-models.js's shapes (not at Low); `rich`: an estate and an SUV among the cars too.
   */
  constructor(group, net, { shadows = true, variety = false, ground = null, better = false, rich = false } = {}) {
    this.group = group;
    this.net = net;
    this.shadows = !!shadows;
    this.variety = !!variety;
    this.better = !!better;
    this.rich = !!rich && this.better && this.variety;
    this.ground = ground;
    this.cars = []; // { kind, shape, lane, s, hint, speed, want, parked, kerb, knock, tint, px, py, pz, heading, dist, lead }
    this.meshes = new Map(); // shape -> InstancedMesh (detail)
    this.meshList = []; // the same, as an array the frame loop walks without an iterator
    this.proxy = null;
    this.signalHeads = null;
    this.signalLamps = null;
    this.lights = null;
    this.lightPos = null;
    this.tails = null;
    this.tailPos = null;
    this.frame = 0;
    this.t = 0;
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 });
    if (this.better) carPaint(this.mat);
    this.proxyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.1 });
    this.boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.rnd = makeRandom(31);
    this.thin = []; // { x, z, r }
    this.stats = { placed: 0, drawn: 0, proxies: 0, ms: 0, parked: 0, hits: 0, tails: 0 };
    this.player = null; // { pos } of the player's car, for yielding
    this.onLane = new Map(); // lane -> [s] of the cars put on it, so no two start on top of each other
    this.kerbs = new Map(); // lane -> [s] of the cars parked along it
    this.camX = 0;
    this.camZ = 0;
    this.playerAt = null;
  }

  /** Which shape a 'car' is, from a random number. */
  pick(r) {
    if (this.rich) return r < 0.26 ? 'hatch' : r < 0.36 ? 'pickup' : r < 0.52 ? 'suv' : r < 0.64 ? 'estate' : 'car';
    return r < 0.34 ? 'hatch' : r < 0.46 ? 'pickup' : 'car';
  }

  /** A car's record. */
  record(kind, shape, parked) {
    const d = KINDS[shape];
    return { kind, shape, len: d.L, lane: -1, s: 0, hint: 0, speed: 0, want: KINDS[kind].speed, stopped: false, parked: !!parked, kerb: false, knock: false, wreck: 0, kvx: 0, kvz: 0, spin: 0, lead: -1, idle: 0, hold: 0, gate: -1, pool: null, tint: d.vary ? CAR_TINTS[Math.floor(this.rnd() * CAR_TINTS.length)] : d.colour, px: 0, py: 0, pz: 0, heading: 0, dist: Infinity, idx: this.cars.length, hidden: false };
  }

  /** Put a car on one of `lanes` (indices), clear of the cars already on it. False if there is no room. */
  place(car, lanes) {
    for (let tries = 0; tries < 10; tries++) {
      const li = lanes[Math.floor(this.rnd() * lanes.length)];
      const L = this.net.lanes[li];
      const s = this.rnd() * Math.max(1, L.len - 8);
      let on = this.onLane.get(li);
      if (!on) this.onLane.set(li, (on = []));
      let clear = true;
      for (let k = 0; k < on.length; k++) if (Math.abs(on[k] - s) < 16) clear = false;
      if (!clear) continue;
      on.push(s);
      car.lane = li;
      car.s = s;
      sampleLane(L, car.s, S, 0);
      car.px = S.x;
      car.py = S.y;
      car.pz = S.z;
      car.heading = S.heading;
      car.hint = S.i;
      return true;
    }
    return false;
  }

  /**
   * Put `count` vehicles of `kind` on lanes of the given kinds ('street', 'road', 'loop'), parked
   * round a point (`park`), or parked at the kerb along the streets (`kerb: true`).
   */
  populate(kind, count, { laneKinds = ['street', 'road'], park = null, kerb = false } = {}) {
    if (!KINDS[kind] || count <= 0) return 0;
    if (kerb) return this.parkAtKerb(kind, count);
    const lanes = this.net.lanes.map((l, i) => i).filter((i) => laneKinds.includes(this.net.lanes[i].kind));
    let made = 0;
    for (let k = 0; k < count; k++) {
      let shape = kind;
      if (this.variety && kind === 'car' && !park) {
        const r = this.rnd();
        shape = this.pick(r);
      }
      const car = this.record(kind, shape, park);
      if (park) {
        const ang = (k / Math.max(1, count)) * Math.PI * 2 + 0.4;
        car.px = park.x + Math.sin(ang) * park.r;
        car.pz = park.z - Math.cos(ang) * park.r;
        car.py = park.y != null ? park.y : 0;
        car.heading = ((ang * 180) / Math.PI + 90) % 360;
        car.speed = 0;
      } else {
        if (!lanes.length) break;
        if (!this.place(car, lanes)) continue;
        car.pool = lanes;
        car.kinds = laneKinds;
        car.speed = car.want * (0.8 + this.rnd() * 0.3);
        car.want = car.speed;
      }
      this.cars.push(car);
      made++;
    }
    return made;
  }

  /**
   * Cars parked at the kerb: along the streets wide enough to pass them (KERB_MIN), nose the way
   * the lane goes, clear of every turning, stop line and corner, and of each other.
   */
  parkAtKerb(kind, count) {
    const net = this.net;
    const lanes = [];
    for (let i = 0; i < net.lanes.length; i++) {
      const L = net.lanes[i];
      const P = net.polylines[L.poly];
      if (L.kind === 'street' && !L.oneWay && P && P.hw >= KERB_MIN && L.len > 60) lanes.push(i);
    }
    if (!lanes.length) return 0;
    let made = 0;
    for (let k = 0; k < count; k++) {
      for (let tries = 0; tries < 8; tries++) {
        const li = lanes[Math.floor(this.rnd() * lanes.length)];
        const L = net.lanes[li];
        const hw = net.polylines[L.poly].hw;
        const s = 18 + this.rnd() * (L.len - 36);
        let ok = true;
        for (let j = 0; ok && j < L.junctions.length; j++) if (Math.abs(L.junctions[j].s - s) < 16) ok = false;
        for (let j = 0; ok && j < L.stops.length; j++) if (Math.abs(L.stops[j].s - s) < 20) ok = false;
        // (Where a lane of another street starts or ends beside this one is a corner too.)
        let at = this.kerbs.get(li);
        if (!at) this.kerbs.set(li, (at = []));
        for (let j = 0; ok && j < at.length; j++) if (Math.abs(at[j] - s) < 7) ok = false;
        if (!ok) continue;
        sampleLane(L, s, S, 0);
        const out = hw - KERB_IN - Math.max(1.6, hw * 0.45);
        const h = S.heading * D2R;
        const x = S.x + Math.cos(h) * out;
        const z = S.z + Math.sin(h) * out;
        if (this.cornerNear(li, x, z)) continue;
        at.push(s);
        let shape = kind;
        if (this.variety && kind === 'car') {
          const r = this.rnd();
          shape = this.rich ? this.pick(r) : r < 0.4 ? 'hatch' : r < 0.5 ? 'pickup' : 'car';
        }
        const car = this.record(kind, shape, true);
        car.kerb = true;
        car.px = x;
        car.pz = z;
        car.py = S.y;
        car.heading = S.heading;
        this.cars.push(car);
        made++;
        break;
      }
    }
    this.stats.parked += made;
    return made;
  }

  /** Is (x, z) within a corner's length of another street's centre line? (Nobody parks across a side road.) */
  cornerNear(li, x, z) {
    const mine = this.net.lanes[li].poly;
    const P = this.net.polylines;
    for (let p = 0; p < P.length; p++) {
      if (p === mine) continue;
      const pts = P[p].pts;
      const r = (P[p].hw || 5) + 4;
      for (let k = 1; k < pts.length; k++) {
        const ax = pts[k - 1][0];
        const az = pts[k - 1][1];
        const ex = pts[k][0] - ax;
        const ez = pts[k][1] - az;
        const l2 = ex * ex + ez * ez;
        let t = l2 > 0 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + ex * t - x;
        const qz = az + ez * t - z;
        if (qx * qx + qz * qz < r * r) return true;
      }
    }
    return false;
  }

  /** Build the meshes once the cars are known. */
  build() {
    const byKind = new Map();
    for (const c of this.cars) byKind.set(c.shape, (byKind.get(c.shape) || 0) + 1);
    let k = 0;
    for (const [kind, n] of byKind) {
      const own = this.better ? betterCarGeometry(kind, KINDS[kind]) : null;
      const geo = own || (kind === 'firetruck' ? fireEngineGeometry() : carShape(kind, KINDS[kind].colour));
      const m = instanced(geo, this.mat, n, { cast: this.shadows, receive: false, name: `ambient-${kind}` });
      m.userData.better = !!own;
      // REAL MODELS: what car-models.js does not draw (the tractor) in its real shape, when that file is here.
      if (!own) wearRealVehicle(m, kind);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.userData.next = 0;
      this.meshes.set(kind, m);
      this.meshList.push(m);
      this.group.add(m);
      k++;
    }
    for (const c of this.cars) {
      const m = this.meshes.get(c.shape);
      c.mesh = m;
      c.slot = m.userData.next++;
      _c.set(c.tint);
      m.setColorAt(c.slot, _c);
      zero(m, c.slot);
    }
    if (this.cars.length) {
      this.proxy = instanced(this.boxGeo, this.proxyMat, this.cars.length, { cast: false, receive: false, name: 'ambient-car-proxy' });
      this.proxy.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cars.length * 3), 3);
      this.proxy.frustumCulled = false;
      for (const c of this.cars) {
        _c.set(c.tint).multiplyScalar(0.8);
        this.proxy.setColorAt(c.idx, _c);
        zero(this.proxy, c.idx);
      }
      this.group.add(this.proxy);
      // Headlights: two points a car, placed each frame for the ones in view; and its tail lamps, red, behind.
      const n = this.cars.length * 2;
      const points = (arr, colour, size, name) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(arr, 3).setUsage(THREE.DynamicDrawUsage));
        const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: colour, size, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
        pts.name = name;
        pts.frustumCulled = false;
        pts.visible = false;
        this.group.add(pts);
        return pts;
      };
      this.lightPos = new Float32Array(n * 3);
      this.lights = points(this.lightPos, 0xfff3d0, 1.1, 'ambient-headlights');
      this.tailPos = new Float32Array(n * 3);
      this.tails = points(this.tailPos, 0xff2a1c, 0.9, 'ambient-taillights');
    }
    // Signal heads: a pole and a lamp per group at each signalled junction.
    const sigs = this.net.signals.filter((s) => s.lanes.length);
    if (sigs.length) {
      const pole = new Batch();
      pole.cyl(0.08, 0.1, 4.2, 0, 0, 0, 0x33373c, 6);
      pole.slab(-0.18, 0.18, 4.2, 5.0, -0.18, 0.18, 0x1c1f23);
      this.signalHeads = instanced(pole.geometry(), this.mat, sigs.length * 2, { cast: false, receive: false, name: 'ambient-signals' });
      const lamp = new THREE.BoxGeometry(0.26, 0.26, 0.26).translate(0, 4.75, 0);
      this.signalLampMat = new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff3020, emissiveIntensity: 1.2 });
      this.signalLamps = instanced(lamp, this.signalLampMat, sigs.length * 2, { cast: false, receive: false, name: 'ambient-signal-lamps' });
      this.signalLamps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(sigs.length * 6), 3);
      this.signalLamps.instanceColor.setUsage(THREE.DynamicDrawUsage);
      sigs.forEach((sg, i) => {
        // One head for each direction group, 6 m off the junction on the kerb.
        for (let g = 0; g < 2; g++) {
          const x = sg.x + (g ? 6 : -6);
          const z = sg.z + (g ? -6 : 6);
          _m.makeTranslation(x, sg.y, z);
          this.signalHeads.setMatrixAt(i * 2 + g, _m);
          this.signalLamps.setMatrixAt(i * 2 + g, _m);
        }
        sg.heads = i;
      });
      this.signalHeads.instanceMatrix.needsUpdate = true;
      this.signalLamps.instanceMatrix.needsUpdate = true;
      this.signalHeads.computeBoundingSphere();
      this.signalHeads.frustumCulled = true;
      this.signalLamps.computeBoundingSphere();
      this.signalLamps.frustumCulled = true;
      this.group.add(this.signalHeads);
      this.group.add(this.signalLamps);
      this.sigs = sigs;
      this.sigState = new Int8Array(sigs.length).fill(9);
    }
    this.stats.placed = this.cars.length;
    this.visible = true;
  }

  setVisible(on) {
    this.visible = on;
    for (const m of this.meshes.values()) m.visible = on;
    if (this.proxy) this.proxy.visible = on;
    if (this.signalHeads) this.signalHeads.visible = on;
    if (this.signalLamps) this.signalLamps.visible = on;
    if (this.lights && !on) this.lights.visible = false;
    if (this.tails && !on) this.tails.visible = false;
  }

  /** Hide every car within r of (x, z) — an emergency scene's ground. */
  thinAround(x, z, r) {
    this.thin.push({ x, z, r });
  }

  clearThin() {
    this.thin.length = 0;
  }

  /** Red or green for a lane's stop line at this time. */
  stopAt(car, lane) {
    for (let k = 0; k < lane.stops.length; k++) {
      const st = lane.stops[k];
      const ahead = st.s - car.s;
      if (ahead < -2 || ahead > 14) continue;
      const g = signalGreen(this.net.signals[st.signal], this.t);
      if (g !== st.group) return ahead;
    }
    return -1;
  }

  /**
   * The car in front of car `i`: the nearest one ahead within LOOK metres that is in its way —
   * further along its own lane, or (another lane, a car shoved into the road) straight ahead of
   * its nose on its own level and going its way or standing still. -1 for a clear road.
   * A car parked at the kerb is beside the lane, not in it.
   */
  leaderOf(i) {
    const cars = this.cars;
    const c = cars[i];
    const h = c.heading * D2R;
    const sh = Math.sin(h);
    const ch = Math.cos(h);
    const L = this.net.lanes[c.lane];
    const nearEnd = L && c.s > L.len - 16;
    let best = LOOK;
    let lead = -1;
    for (let j = 0; j < cars.length; j++) {
      if (j === i) continue;
      const o = cars[j];
      const dx = o.px - c.px;
      const dz = o.pz - c.pz;
      if (dx > LOOK || dx < -LOOK || dz > LOOK || dz < -LOOK) continue;
      let ahead;
      if (o.lane === c.lane && c.lane >= 0 && !o.parked) {
        ahead = o.s - c.s;
        if (ahead <= 0) continue;
      } else {
        if (o.kerb && !o.wreck && !o.knock) continue;
        ahead = dx * sh - dz * ch;
        if (ahead < 0.5) continue;
        const lat = dx * ch + dz * sh;
        const tol = 1.5 + (ahead < 12 && nearEnd ? 1.6 : 0);
        if (lat > tol || lat < -tol) continue;
        const dy = o.py - c.py;
        if (dy > 2.5 || dy < -2.5) continue;
        if (o.speed > 0.5) {
          const dh = Math.abs((((o.heading - c.heading) % 360) + 540) % 360 - 180);
          // Going its way; or crossing close in front of it, when the one that came first (the lower number) has the road.
          if (dh > 70 && !(dh < 125 && ahead < 12 && o.idx < c.idx)) continue;
        }
      }
      if (ahead < best) {
        best = ahead;
        lead = j;
      }
    }
    return lead;
  }

  /**
   * May car `c` move on to `lane` at `s` now? Not while another car is within a length and a half
   * of where it would arrive (the ones behind it in its own lane do not count): it gives way to
   * whoever is already there, as a driver does at a junction.
   */
  entryClear(c, lane, s) {
    sampleLane(this.net.lanes[lane], s + 2, S, 0);
    const tx = S.x;
    const tz = S.z;
    const ty = S.y;
    const h = c.heading * D2R;
    const sh = Math.sin(h);
    const ch = Math.cos(h);
    const cars = this.cars;
    for (let j = 0; j < cars.length; j++) {
      const o = cars[j];
      if (o === c || (o.kerb && !o.wreck)) continue;
      const dx = o.px - tx;
      const dz = o.pz - tz;
      if (dx > 8 || dx < -8 || dz > 8 || dz < -8 || dx * dx + dz * dz > 56) continue;
      if (o.py - ty > 2.5 || o.py - ty < -2.5) continue;
      if (o.lane === c.lane && (o.px - c.px) * sh - (o.pz - c.pz) * ch < 0) continue;
      return false;
    }
    return true;
  }

  /** The player has driven into car `c`: it is shoved the way they were going, and a little aside. */
  hit(c, player) {
    const v = Math.min(16, player.speed || 0);
    const ux = (player.vx || 0) / (player.speed || 1);
    const uz = (player.vz || 0) / (player.speed || 1);
    // Which side of the player's path the car is on: it goes that way.
    const side = (c.px - player.x) * -uz + (c.pz - player.z) * ux >= 0 ? 1 : -1;
    c.kvx = ux * v * 0.7 + -uz * side * v * 0.3;
    c.kvz = uz * v * 0.7 + ux * side * v * 0.3;
    c.spin = side * (35 + this.rnd() * 60);
    c.knock = true;
    c.parked = true;
    c.wreck = 0.001;
    c.speed = 0;
    c.lead = -1;
    this.stats.hits++;
  }

  /** A shoved car sliding to a stop (7 m/s² of tyres sideways on the road). */
  slide(c, dt) {
    const v = Math.hypot(c.kvx, c.kvz);
    if (v < 0.15) {
      c.knock = false;
      c.kvx = c.kvz = 0;
      return;
    }
    const k = Math.max(0, v - 7 * dt) / v;
    c.px += c.kvx * dt;
    c.pz += c.kvz * dt;
    c.kvx *= k;
    c.kvz *= k;
    c.heading += c.spin * dt;
    c.spin *= Math.max(0, 1 - 2.4 * dt);
    if (this.ground) c.py = this.ground(c.px, c.pz);
  }

  /**
   * Keep the cars where the player is: for a map too big to fill (the World Map is 150 km of
   * road, and eighty cars spread along it are one every two kilometres: none, to the eye).
   * A car left FOLLOW_FAR behind is put on a lane between FOLLOW_IN and FOLLOW_OUT metres of
   * the camera, a few a frame; a kerb car likewise, at a kerb. Off, and they stay where they are.
   */
  setFollow(on) {
    this.follow = null;
    if (!on) return;
    const cells = new Map();
    const lanes = this.net.lanes;
    for (let i = 0; i < lanes.length; i++) {
      const L = lanes[i];
      for (let s = 20; s < L.len - 20; s += 90) {
        sampleLane(L, s, S, 0);
        const key = Math.floor(S.x / FOLLOW_CELL) * 100003 + Math.floor(S.z / FOLLOW_CELL);
        let c = cells.get(key);
        if (!c) cells.set(key, (c = []));
        c.push(i, s);
      }
    }
    this.follow = { cells, next: 0, moved: 0, out: FOLLOW_OUT };
  }

  /** Bring car `c` to a lane near the camera (setFollow). False if no road is near, or no room on it. */
  bring(c) {
    const F = this.follow;
    const lanes = this.net.lanes;
    for (let tries = 0; tries < 5; tries++) {
      const a = this.rnd() * Math.PI * 2;
      // (More of them close in than a kilometre off: a street you are standing in has cars on it.)
      const least = this.t < FOLLOW_START ? 35 : FOLLOW_IN;
      const r = least + this.rnd() ** 1.5 * (F.out - least);
      const cell = F.cells.get(Math.floor((this.camX + Math.sin(a) * r) / FOLLOW_CELL) * 100003 + Math.floor((this.camZ - Math.cos(a) * r) / FOLLOW_CELL));
      if (!cell) continue;
      const k = Math.floor(this.rnd() * (cell.length / 2)) * 2;
      const li = cell[k];
      const L = lanes[li];
      const want = c.kerb ? L.kind === 'street' && !L.oneWay && this.net.polylines[L.poly].hw >= KERB_MIN : c.kinds ? c.kinds.includes(L.kind) : true;
      if (!want) continue;
      const s = cell[k + 1] + (this.rnd() - 0.5) * 60;
      sampleLane(L, s, S, 0);
      let x = S.x;
      let z = S.z;
      if (c.kerb) {
        const hw = this.net.polylines[L.poly].hw;
        const out = hw - KERB_IN - Math.max(1.6, hw * 0.45);
        x += Math.cos(S.heading * D2R) * out;
        z += Math.sin(S.heading * D2R) * out;
        let ok = s > 18 && s < L.len - 18;
        for (let j = 0; ok && j < L.junctions.length; j++) if (Math.abs(L.junctions[j].s - s) < 16) ok = false;
        for (let j = 0; ok && j < L.stops.length; j++) if (Math.abs(L.stops[j].s - s) < 20) ok = false;
        if (!ok || this.cornerNear(li, x, z)) continue;
      }
      if ((x - this.camX) ** 2 + (z - this.camZ) ** 2 < least * least * 0.8) continue;
      // Never on to the road beside the player (their aeroplane may be stood on it, or their car).
      if (this.playerAt && (x - this.playerAt.x) ** 2 + (z - this.playerAt.z) ** 2 < FOLLOW_CLEAR * FOLLOW_CLEAR) continue;
      let clear = true;
      const room = c.kerb ? 7 : 22;
      for (let j = 0; clear && j < this.cars.length; j++) {
        const o = this.cars[j];
        if (o !== c && Math.abs(o.px - x) < room && Math.abs(o.pz - z) < room) clear = false;
      }
      if (!clear) continue;
      if (c.kerb) {
        c.px = x;
        c.pz = z;
        c.py = S.y;
        c.heading = S.heading;
        c.knock = false;
        c.wreck = 0;
      } else {
        c.lane = li;
        c.s = s;
        c.hint = 0;
        c.px = x;
        c.py = S.y;
        c.pz = z;
        c.heading = S.heading;
        c.speed = c.want * (L.fast || 1) * 0.8;
        c.gate = -1;
        c.hold = 0;
        c.lead = -1;
        c.idle = 0;
        c.parked = false;
        c.knock = false;
        c.wreck = 0;
      }
      c.dist = Math.hypot(x - this.camX, z - this.camZ);
      F.moved++;
      return true;
    }
    return false;
  }

  /** Put a car back on the road somewhere the player is not looking: the furthest of a few lanes. */
  rehome(c) {
    if (this.follow && this.bring(c)) return true;
    const pool = c.pool && c.pool.length ? c.pool : null;
    if (!pool) return false;
    let best = -1;
    let far = -1;
    for (let k = 0; k < 6; k++) {
      const li = pool[Math.floor(this.rnd() * pool.length)];
      const L = this.net.lanes[li];
      const d = (L.xs[0] - this.camX) ** 2 + (L.zs[0] - this.camZ) ** 2;
      if (d > far) {
        far = d;
        best = li;
      }
    }
    c.lane = best;
    c.s = 0;
    c.hint = 0;
    c.gate = -1;
    c.hold = 0;
    c.speed = 0;
    c.lead = -1;
    c.idle = 0;
    c.parked = false;
    c.knock = false;
    c.wreck = 0;
    return true;
  }

  /**
   * One frame. `cam` is the camera position; `night` switches the lights;
   * `player` is who the cars give way to, or null: { x, z, heading } the player's car on a driving
   * map (YIELD_GAP all round), or with `kind` ('plane', 'foot') and `r` (metres: half a wingspan)
   * an aeroplane on the ground or a walker, stopped for when it is in the way. With `speed`, `vx`
   * and `vz` (m/s) the player can shove a car aside (hit).
   */
  update(dt, cam, night, player) {
    if (!this.visible || !this.cars.length) return;
    const t0 = performance.now();
    this.t += dt;
    this.frame++;
    this.camX = cam.x;
    this.camZ = cam.z;
    const lanes = this.net.lanes;
    const cars = this.cars;
    let drawn = 0;
    let proxies = 0;
    let lit = 0;
    const half = this.frame & 1;
    const phase = this.frame & 3;
    const pr = player ? (player.kind ? player.r || 2 : 0) : 0;
    this.playerAt = player;
    if (this.follow) {
      const F = this.follow;
      const agl = this.ground ? cam.y - this.ground(cam.x, cam.z) : 400;
      F.out = Math.max(FOLLOW_LOW, Math.min(FOLLOW_OUT, FOLLOW_LOW + agl * 2.2));
      // Three a frame, in turn (all of them as a flight begins): whoever has been left behind comes to where the player is now.
      for (let k = this.t < FOLLOW_START ? cars.length >> 2 : 3; k > 0; k--) {
        const c = cars[F.next++ % cars.length];
        if (c.dist > F.out + FOLLOW_PAST && !c.knock && (c.kerb || (c.lane >= 0 && (!c.parked || c.wreck)))) this.bring(c);
      }
    }
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (c.knock) this.slide(c, dt);
      else if (c.wreck) {
        // Left where it stopped until the player has gone; then it is back on the road, out of sight.
        c.wreck += dt;
        if (c.wreck > 30 && c.dist > 500 && !c.kerb) this.rehome(c);
      }
      if (player && !c.knock && (player.speed || 0) > HIT_SPEED) {
        const dx = player.x - c.px;
        const dz = player.z - c.pz;
        const reach = Math.min(pr || 1.6, 5) + c.len * 0.45;
        if (dx * dx + dz * dz < reach * reach) this.hit(c, player);
      }
      if (!c.parked && c.lane >= 0) {
        const L = lanes[c.lane];
        // Speed: stop at a red, hold behind the player's car, else cruise.
        let want = c.want * (L.fast || 1);
        const stop = this.stopAt(c, L);
        if (stop >= 0) want = stop > 3 ? Math.min(want, stop * 1.2) : 0;
        // A turning, or the end of this road, coming up: slow for it.
        const sl = L.slow;
        if (sl) {
          for (let k = 0; k < sl.length; k++) {
            const ahead = sl[k] - c.s;
            if (ahead > SLOW_FROM) break;
            if (ahead > -2) {
              const slow = c.want * SLOW_TO;
              if (want > slow) want = slow + (want - slow) * Math.max(0, (ahead - 6) / (SLOW_FROM - 6));
              break;
            }
          }
        }
        if (player) {
          const dx = player.x - c.px;
          const dz = player.z - c.pz;
          const d = Math.hypot(dx, dz);
          if (!player.kind) {
            if (d < YIELD_GAP) want = 0;
            else if (d < YIELD_GAP * 2.5) {
              const h = c.heading * D2R;
              const ahead = dx * Math.sin(h) - dz * Math.cos(h);
              if (ahead > 0) want = Math.min(want, (d - YIELD_GAP) * 0.6);
            }
          } else {
            // An aeroplane on the ground, or the player on foot: stop short of them when they are in the way.
            const R = pr + c.len * 0.5 + 3;
            if (d < R) want = 0;
            else if (d < R + LOOK) {
              const h = c.heading * D2R;
              const ahead = dx * Math.sin(h) - dz * Math.cos(h);
              const lat = dx * Math.cos(h) + dz * Math.sin(h);
              if (ahead > 0 && lat < pr + 2.5 && lat > -pr - 2.5) want = Math.min(want, Math.sqrt(2 * BRAKE * Math.max(0, ahead - R)));
            }
          }
        }
        // The car in front: looked for every fourth frame, kept clear of every frame.
        if ((i & 3) === phase || (c.lead >= 0 && cars[c.lead].lane !== c.lane && c.speed > 0)) c.lead = this.leaderOf(i);
        let room = Infinity;
        if (c.lead >= 0) {
          const o = cars[c.lead];
          let ahead;
          if (o.lane === c.lane && !o.parked) ahead = o.s - c.s;
          else {
            const h = c.heading * D2R;
            ahead = (o.px - c.px) * Math.sin(h) - (o.pz - c.pz) * Math.cos(h);
          }
          if (ahead > 0) {
            const gap = ahead - (c.len + o.len) * 0.5;
            room = gap - FOLLOW_GAP * 0.4;
            const vo = o.parked ? 0 : o.speed;
            want = gap <= FOLLOW_GAP ? Math.min(want, vo * 0.9) : Math.min(want, Math.sqrt(vo * vo * 0.8 + 2 * BRAKE * (gap - FOLLOW_GAP)));
          } else c.lead = -1;
        }
        c.speed += Math.max(-2 * BRAKE * dt, Math.min(2.5 * dt, want - c.speed));
        if (c.speed < 0.05) c.speed = 0;
        let step = c.speed * dt;
        if (step > room) {
          // Never into the back of it, whatever the brakes managed.
          step = room > 0 ? room : 0;
          c.speed = Math.min(c.speed, cars[c.lead].parked ? 0 : cars[c.lead].speed);
        }
        // ...and never into the player's aeroplane (or the player on foot), whatever the brakes managed:
        // a car that came on it round a bend, at a join or put on the road near it stops at its edge.
        if (player && player.kind && step > 0) {
          const h = c.heading * D2R;
          const dx = player.x - c.px;
          const dz = player.z - c.pz;
          const ahead = dx * Math.sin(h) - dz * Math.cos(h);
          const lat = dx * Math.cos(h) + dz * Math.sin(h);
          const R = pr + c.len * 0.5 + 2;
          if (ahead > -1 && Math.abs(lat) < pr + 2.5 && Math.hypot(ahead - step, lat) < R) {
            step = Math.max(0, Math.min(step, ahead - Math.sqrt(Math.max(0, R * R - lat * lat))));
            c.speed = 0;
          }
        }
        // Stood behind something for half a minute, well away from the player: back on the road elsewhere.
        if (c.speed === 0 && c.lead >= 0) {
          c.idle += dt;
          if (c.idle > 30 && c.dist > 250) this.rehome(c);
        } else c.idle = 0;
        // Coming to where its road joins another: it chooses its way GIVE_WAY metres short, and waits there
        // for whoever is already on that road (a few seconds at most: nobody waits for ever).
        if (c.gate < 0 && L.next.length && c.s + step >= L.len - GIVE_WAY) {
          const k = Math.floor(this.rnd() * L.next.length);
          const pick = L.next[k];
          if (pick.s > 1 && c.hold < 6 && !(this.entryClear(c, pick.lane, pick.s) && this.entryClear(c, c.lane, L.len - 2))) {
            step = Math.max(0, Math.min(step, L.len - GIVE_WAY - c.s));
            c.speed = 0;
            c.hold += dt;
          } else {
            c.gate = k;
            c.hold = 0;
          }
        }
        c.s += step;
        // A junction to turn off at, now and then.
        const L1 = lanes[c.lane];
        for (let j = 0; j < L1.junctions.length; j++) {
          const J = L1.junctions[j];
          if (J.s <= c.s && J.s > c.s - step - 0.01 && this.rnd() < (J.p || 0.3) && this.entryClear(c, J.lane, 0)) {
            c.lane = J.lane;
            c.s = 0;
            c.hint = 0;
            c.lead = -1;
            c.gate = -1;
            break;
          }
        }
        const L2 = lanes[c.lane];
        if (c.s >= L2.len) {
          const nx = L2.next;
          if (nx.length) {
            const pick = nx[c.gate >= 0 && c.gate < nx.length ? c.gate : Math.floor(this.rnd() * nx.length)];
            c.lane = pick.lane;
            c.s = pick.s + (c.s - L2.len);
          } else if (L2.reverse >= 0) {
            c.lane = L2.reverse;
            c.s = c.s - L2.len;
          } else this.rehome(c);
          c.hint = 0;
          c.lead = -1;
          c.gate = -1;
          c.hold = 0;
        }
        const L3 = lanes[c.lane];
        sampleLane(L3, c.s, S, c.hint);
        c.hint = S.i;
        c.px = S.x;
        c.py = S.y;
        c.pz = S.z;
        c.heading = S.heading;
      }
      const dx = c.px - cam.x;
      const dz = c.pz - cam.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      c.dist = dist;
      let hidden = dist > CAR_FAR;
      if (!hidden && this.thin.length) {
        for (let k = 0; k < this.thin.length; k++) {
          const T = this.thin[k];
          if ((c.px - T.x) ** 2 + (c.pz - T.z) ** 2 < T.r * T.r) {
            hidden = true;
            break;
          }
        }
      }
      const m = c.mesh;
      if (hidden) {
        if (!c.hidden) {
          zero(m, c.slot);
          zero(this.proxy, c.idx);
          c.hidden = true;
        }
        continue;
      }
      c.hidden = false;
      // Half rate far out, every frame near.
      if (dist > HALF_RATE && (i & 1) !== half && c.speed > 0) continue;
      const near = dist < CAR_NEAR;
      if (near) {
        pose(m, c.slot, c.px, c.py, c.pz, c.heading, 1, 1, 1);
        if (c.wasProxy) zero(this.proxy, c.idx);
        c.wasProxy = false;
        drawn++;
        // Lamps on what is being driven: a car left at the kerb, or shoved off the road, shows none.
        if (night && this.lightPos && !c.kerb && !c.wreck) {
          const d = KINDS[c.shape];
          const lp = lampsOf(c.shape);
          const h = c.heading * D2R;
          const sh = Math.sin(h);
          const ch = Math.cos(h);
          for (let s = -1; s <= 1; s += 2) {
            const lx = c.px + ch * lp.x * s + sh * -lp.z;
            const lz = c.pz + sh * lp.x * s - ch * -lp.z;
            const o = lit * 3;
            this.lightPos[o] = lx;
            this.lightPos[o + 1] = c.py + lp.y;
            this.lightPos[o + 2] = lz;
            this.tailPos[o] = c.px + ch * lp.x * s - sh * (d.L * 0.5 + 0.03);
            this.tailPos[o + 1] = c.py + lp.y + 0.1;
            this.tailPos[o + 2] = c.pz + sh * lp.x * s + ch * (d.L * 0.5 + 0.03);
            lit++;
          }
        }
      } else {
        const d = KINDS[c.shape];
        pose(this.proxy, c.idx, c.px, c.py, c.pz, c.heading, d.W, d.H, d.L);
        if (!c.wasProxy) zero(m, c.slot);
        c.wasProxy = true;
        proxies++;
      }
    }
    for (let k = 0; k < this.meshList.length; k++) {
      const m = this.meshList[k];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor && !m.userData.coloured) {
        m.instanceColor.needsUpdate = true;
        m.userData.coloured = true;
      }
    }
    if (this.proxy) {
      this.proxy.instanceMatrix.needsUpdate = true;
      if (!this.proxy.userData.coloured) {
        this.proxy.instanceColor.needsUpdate = true;
        this.proxy.userData.coloured = true;
      }
    }
    if (this.lights) {
      const show = night && lit > 0;
      this.lights.visible = show;
      this.tails.visible = show;
      if (show) {
        this.lights.geometry.setDrawRange(0, lit);
        this.lights.geometry.attributes.position.needsUpdate = true;
        this.tails.geometry.setDrawRange(0, lit);
        this.tails.geometry.attributes.position.needsUpdate = true;
      }
    }
    // Signals: the lamp colour, written only when a phase changes.
    if (this.sigs) {
      for (let i = 0; i < this.sigs.length; i++) {
        const g = signalGreen(this.sigs[i], this.t);
        if (this.sigState[i] === g) continue;
        this.sigState[i] = g;
        for (let grp = 0; grp < 2; grp++) {
          _c.set(g === grp ? 0x30e060 : g === -1 ? 0xffb020 : 0xff3020);
          this.signalLamps.setColorAt(i * 2 + grp, _c);
        }
        this.signalLamps.instanceColor.needsUpdate = true;
      }
    }
    this.stats.drawn = drawn;
    this.stats.proxies = proxies;
    this.stats.tails = night ? lit : 0;
    this.stats.ms = performance.now() - t0;
  }

  dispose() {
    for (const m of this.meshes.values()) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.meshes.clear();
    if (this.proxy) {
      this.group.remove(this.proxy);
      this.proxy = null;
    }
    for (const k of ['lights', 'tails']) {
      if (!this[k]) continue;
      this.group.remove(this[k]);
      this[k].geometry.dispose();
      this[k].material.dispose();
      this[k] = null;
    }
    for (const m of [this.signalHeads, this.signalLamps]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.signalHeads = this.signalLamps = null;
    this.boxGeo.dispose();
    this.mat.dispose();
    this.proxyMat.dispose();
    if (this.signalLampMat) this.signalLampMat.dispose();
    this.cars.length = 0;
  }
}

/** Write a pose into an instance: position, heading about Y, a scale. */
function pose(mesh, slot, x, y, z, headingDeg, sx, sy, sz) {
  if (!mesh) return;
  const h = -headingDeg * D2R;
  const c = Math.cos(h);
  const s = Math.sin(h);
  const e = _m.elements;
  e[0] = c * sx; e[1] = 0; e[2] = -s * sx; e[3] = 0;
  e[4] = 0; e[5] = sy; e[6] = 0; e[7] = 0;
  e[8] = s * sz; e[9] = 0; e[10] = c * sz; e[11] = 0;
  e[12] = x; e[13] = y; e[14] = z; e[15] = 1;
  mesh.setMatrixAt(slot, _m);
}

function zero(mesh, slot) {
  if (!mesh) return;
  const e = _m.elements;
  for (let i = 0; i < 16; i++) e[i] = 0;
  e[15] = 1;
  mesh.setMatrixAt(slot, _m);
  mesh.instanceMatrix.needsUpdate = true;
}
