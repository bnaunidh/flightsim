/**
 * People, built from primitives: the pilot who climbs out of the aeroplane,
 * the ramp crew in their hi-vis vests, and the passengers who come down the
 * steps.
 *
 * One rig for all of them. A person is a handful of jointed groups — hips,
 * chest, head, two arms with elbows, two legs with knees — and a pose function
 * that swings them. Everything visible on one bone is merged into ONE mesh
 * with the colours baked into the vertices, so the walker is eleven draw calls
 * and a passenger is five, rather than the thirty-odd a person made of
 * separate primitives costs. Twenty passengers would otherwise be six hundred
 * draw calls on a school Chromebook for people on screen for thirty seconds.
 *
 * Faces -Z, feet at y = 0, 1.72 m tall. Low-poly and flat-shaded on purpose:
 * it reads as a toy figure at the distance the camera sits, and it is cheap.
 */

import * as THREE from '../../vendor/three.module.js';

/* ------------------------------------------------------------------ */
/* Colours                                                             */
/* ------------------------------------------------------------------ */

export const SKIN_TONES = [0xf6d3b8, 0xe8b894, 0xd09a6e, 0xb07a4e, 0x8a5a36, 0x5e3b22];
const HAIR = [0x2a1b12, 0x4a2e1a, 0x7a4a24, 0xc89a4a, 0x151515, 0x9a9a9a, 0xb5582a];
const SHIRTS = [0xe0473c, 0x2f7fd8, 0x3aa66b, 0xf2b233, 0x8a52c9, 0xf07fa8, 0x2bb3b0, 0xf4f4f4];
const TROUSERS = [0x2b3444, 0x5a4636, 0x3b5f8a, 0x444444, 0x6b7280];

export const OUTFITS = {
  /** White shirt, dark trousers, a cap with a gold band. The one you fly. */
  pilot: { shirt: 0xf4f6f8, trousers: 0x1f2a3a, shoes: 0x16181c, cap: 0x1f2a3a, band: 0xe0b53a, tie: 0x1f2a3a },
  /** Ramp crew: navy overalls, hi-vis vest, ear defenders. */
  staff: { shirt: 0x24324a, trousers: 0x24324a, shoes: 0x2a2a2a, vest: 0xd2f51c, stripe: 0xdfe6ea, muffs: 0xf07a1c },
  /*
   * The people in the airport's stories (events/hijack.js): a police officer
   * in a hi-vis vest and a peaked cap, the team in dark kit and a helmet, and
   * the man in the hoodie. They were a box for legs, a box for a body and a
   * ball for a head, slid along the apron with a hop; now they are people
   * like everybody else and walk.
   */
  police: { shirt: 0x1f2d4a, trousers: 0x1b2438, shoes: 0x141414, vest: 0xd2f51c, stripe: 0xdfe6ea, cap: 0x1b2438, band: 0xf4f6f8 },
  tactical: { shirt: 0x30353d, trousers: 0x2a2f36, shoes: 0x141414, vest: 0x3d444d, helmet: 0x262b31 },
  hijacker: { shirt: 0x7d838c, trousers: 0x3b5f8a, shoes: 0xe8e8e8 },
};

/** Outfits with long sleeves: the forearm is the shirt, not skin. */
const LONG_SLEEVES = new Set(['pilot', 'police', 'tactical', 'hijacker']);

/* ------------------------------------------------------------------ */
/* Merging parts into one vertex-coloured geometry                      */
/* ------------------------------------------------------------------ */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * One part: a geometry, a colour and where it sits on its bone. The geometry
 * is cloned and flattened, so the shared primitives below are never touched.
 */
export function part(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  _m.compose(_p, _q, _s);
  g.applyMatrix4(_m);
  _c.setHex(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Concatenate parts. Positions, normals and colours only — all a person needs. */
export function mergeParts(parts) {
  let total = 0;
  for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, n * 3), o * 3);
    if (g.attributes.normal) nrm.set(g.attributes.normal.array.subarray(0, n * 3), o * 3);
    col.set(g.attributes.color.array.subarray(0, n * 3), o * 3);
    o += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

/* Shared primitives, low-poly on purpose. Built on first use. */
let PRIM = null;
function prims() {
  if (PRIM) return PRIM;
  PRIM = {
    head: new THREE.IcosahedronGeometry(1, 1),
    ball: new THREE.IcosahedronGeometry(1, 0),
    limb: new THREE.CylinderGeometry(1, 0.85, 1, 6),
    torso: new THREE.CylinderGeometry(1, 0.86, 1, 8),
    box: new THREE.BoxGeometry(1, 1, 1),
    disc: new THREE.CylinderGeometry(1, 1, 1, 10),
    smile: new THREE.TorusGeometry(0.045, 0.011, 3, 8, Math.PI),
  };
  // Every limb hangs DOWN from its joint, so a rotation at the joint swings it.
  PRIM.limb.translate(0, -0.5, 0);
  return PRIM;
}

let MAT = null;
/** One material for every person in the game. */
export function personMaterial() {
  if (!MAT) {
    MAT = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.78, metalness: 0.02 });
  }
  return MAT;
}

let WAND_MAT = null;
function wandMaterial() {
  if (!WAND_MAT) {
    WAND_MAT = new THREE.MeshStandardMaterial({
      color: 0xff8a1c, emissive: 0xff6a00, emissiveIntensity: 1.4, roughness: 0.5,
    });
  }
  return WAND_MAT;
}

function mesh(geo) {
  const m = new THREE.Mesh(geo, personMaterial());
  m.castShadow = true;
  return m;
}

function pick(list, rnd) {
  return list[Math.floor(rnd() * list.length) % list.length];
}

/** Small deterministic random, so a passenger looks the same every rebuild. */
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* The person                                                          */
/* ------------------------------------------------------------------ */

/*
 * Hip height, from the soles up. It was 0.92, which is the leg length plus
 * the hip joint's own 0.075 m — measured with a Box3 round the finished
 * person, the soles sat 7.5 cm above the ground and everybody hovered. The
 * legs are 0.845 m from hip pivot to the bottom of the shoe.
 */
const HIP_Y = 0.845;
const THIGH = 0.42;
const SHIN = 0.42;
const UPPER_ARM = 0.28;
const FOREARM = 0.26;
/** Knee pivot to the bottom of the shoe: the shin and the shoe's own depth. */
const SOLE = HIP_Y - THIGH;
/** The shoe's heel and toe, behind and ahead of the shin (see the legs below). */
const HEEL = 0.08;
const TOE = 0.17;
const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

/**
 * @param {object} opts
 *   outfit   'pilot' | 'staff' | 'passenger'
 *   seed     picks the passenger's colours
 *   lite     merge each limb into one mesh (passengers): 5 draw calls
 *   suitcase give a passenger a case to wheel
 */
export function createPerson(opts = {}) {
  const P = prims();
  const rnd = rng(opts.seed || 7);
  const outfit = opts.outfit || 'passenger';
  const skin = opts.skin ?? pick(SKIN_TONES, rnd);
  // A pilot's hair is one of the darker browns: the captain you play is not grey.
  const hair = opts.hair ?? pick(outfit === 'pilot' ? HAIR.slice(0, 3) : HAIR, rnd);
  let shirt;
  let trousers;
  let shoes = 0x1c1c1c;
  if (outfit === 'pilot') {
    ({ shirt, trousers, shoes } = OUTFITS.pilot);
  } else if (outfit === 'staff') {
    ({ shirt, trousers, shoes } = OUTFITS.staff);
  } else if (OUTFITS[outfit]) {
    ({ shirt, trousers, shoes } = OUTFITS[outfit]);
  } else {
    shirt = opts.shirt ?? pick(SHIRTS, rnd);
    trousers = opts.trousers ?? pick(TROUSERS, rnd);
    shoes = pick([0x1c1c1c, 0xf2f2f2, 0x7a4a24, 0xd0463a], rnd);
  }
  const lite = !!opts.lite;

  const root = new THREE.Group();
  root.name = `person:${outfit}`;
  const body = new THREE.Group();
  body.position.y = HIP_Y;
  root.add(body);

  /* ---- hips, chest, head ---- */
  const hipsParts = [part(P.torso, trousers, 0, 0.03, 0, 0, 0, 0, 0.17, 0.14, 0.12)];
  const chest = new THREE.Group();
  chest.position.y = 0.06;
  body.add(chest);
  const chestParts = [
    // Torso, a little wider at the shoulders.
    part(P.torso, shirt, 0, 0.24, 0, 0, 0, 0, 0.2, 0.48, 0.13),
    // Neck.
    part(P.limb, skin, 0, 0.56, 0, 0, 0, 0, 0.05, 0.08, 0.05),
  ];
  if (outfit === 'pilot') {
    // Tie and two gold epaulettes.
    chestParts.push(part(P.box, OUTFITS.pilot.tie, 0, 0.3, -0.125, 0, 0, 0, 0.05, 0.28, 0.02));
    for (const sx of [-1, 1]) chestParts.push(part(P.box, OUTFITS.pilot.band, sx * 0.16, 0.47, 0, 0, 0, 0, 0.1, 0.02, 0.07));
  } else if (outfit === 'staff' || outfit === 'police') {
    // The vest, a shell just outside the overalls, and its two reflective bands.
    const o = OUTFITS[outfit];
    chestParts.push(part(P.torso, o.vest, 0, 0.25, 0, 0, 0, 0, 0.212, 0.42, 0.14));
    for (const y of [0.13, 0.3]) chestParts.push(part(P.torso, o.stripe, 0, y, 0, 0, 0, 0, 0.216, 0.035, 0.145));
  } else if (outfit === 'tactical') {
    // A padded vest over the kit.
    chestParts.push(part(P.torso, OUTFITS.tactical.vest, 0, 0.27, 0, 0, 0, 0, 0.22, 0.36, 0.15));
  } else if (outfit === 'hijacker') {
    // The hoodie's front pocket.
    chestParts.push(part(P.box, 0x6d737c, 0, 0.1, -0.125, 0, 0, 0, 0.22, 0.12, 0.02));
  }

  const head = new THREE.Group();
  head.position.y = 0.62;
  const headParts = [
    part(P.head, skin, 0, 0, 0, 0, 0, 0, 0.15, 0.162, 0.15),
    // Eyes and a smile. Tiny, and the thing that makes it a character.
    part(P.ball, 0x1a1a22, -0.052, 0.02, -0.138, 0, 0, 0, 0.022, 0.028, 0.012),
    part(P.ball, 0x1a1a22, 0.052, 0.02, -0.138, 0, 0, 0, 0.022, 0.028, 0.012),
    part(P.smile, 0x8a3a2a, 0, -0.035, -0.142, Math.PI, 0, 0, 1, 1, 1),
  ];
  if (outfit === 'pilot') {
    /*
     * Hair under the cap. Without it the back of the pilot's head was bare
     * skin up to the cap band — from the chase camera, which is behind the
     * pilot nearly all the time, a bald head with a hat on.
     */
    headParts.push(part(P.head, hair, 0, 0.035, 0.03, 0, 0, 0, 0.157, 0.125, 0.15));
    headParts.push(part(P.disc, OUTFITS.pilot.cap, 0, 0.12, 0.005, 0, 0, 0, 0.158, 0.09, 0.158));
    headParts.push(part(P.disc, 0xf4f6f8, 0, 0.17, 0.0, 0, 0, 0, 0.172, 0.035, 0.172));
    headParts.push(part(P.disc, OUTFITS.pilot.band, 0, 0.1, 0.005, 0, 0, 0, 0.162, 0.025, 0.162));
    headParts.push(part(P.box, 0x111111, 0, 0.085, -0.15, 0.25, 0, 0, 0.2, 0.015, 0.1));
  } else if (outfit === 'police') {
    // Hair under a peaked cap with a white band.
    const o = OUTFITS.police;
    headParts.push(part(P.head, hair, 0, 0.035, 0.03, 0, 0, 0, 0.157, 0.125, 0.15));
    headParts.push(part(P.disc, o.cap, 0, 0.12, 0.005, 0, 0, 0, 0.158, 0.09, 0.158));
    headParts.push(part(P.disc, o.cap, 0, 0.17, 0.0, 0, 0, 0, 0.172, 0.035, 0.172));
    headParts.push(part(P.disc, o.band, 0, 0.1, 0.005, 0, 0, 0, 0.162, 0.03, 0.162));
    headParts.push(part(P.box, 0x111111, 0, 0.085, -0.15, 0.25, 0, 0, 0.2, 0.015, 0.1));
  } else if (outfit === 'tactical') {
    // A round helmet down over the ears.
    headParts.push(part(P.head, OUTFITS.tactical.helmet, 0, 0.055, 0.01, 0, 0, 0, 0.168, 0.14, 0.168));
    headParts.push(part(P.torso, OUTFITS.tactical.helmet, 0, 0.0, 0.0, 0, 0, 0, 0.17, 0.05, 0.168));
  } else if (outfit === 'hijacker') {
    // The hood up: a shell round the back and top of the head, the face clear.
    headParts.push(part(P.head, OUTFITS.hijacker.shirt, 0, 0.02, 0.05, 0, 0, 0, 0.172, 0.18, 0.168));
  } else if (outfit === 'staff') {
    // Short hair under ear defenders: a headband and two orange cups.
    headParts.push(part(P.head, hair, 0, 0.05, 0.012, 0, 0, 0, 0.153, 0.13, 0.15));
    headParts.push(part(P.torso, 0x2a2a2a, 0, 0.11, 0, 0, 0, Math.PI / 2, 0.02, 0.33, 0.03));
    for (const sx of [-1, 1]) headParts.push(part(P.disc, OUTFITS.staff.muffs, sx * 0.155, 0, 0, 0, 0, Math.PI / 2, 0.065, 0.05, 0.065));
  } else {
    const style = Math.floor(rnd() * 3);
    headParts.push(part(P.head, hair, 0, 0.05, 0.015, 0, 0, 0, 0.155, 0.13, 0.152));
    if (style === 1) headParts.push(part(P.ball, hair, 0, 0.02, 0.15, 0, 0, 0, 0.07, 0.07, 0.07)); // a bun
    if (style === 2) headParts.push(part(P.box, hair, 0, -0.07, 0.1, 0, 0, 0, 0.26, 0.2, 0.08)); // long hair
  }

  /* ---- arms ---- */
  const arms = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.235, 0.42, 0);
    arm.rotation.z = side * 0.08;
    const elbow = new THREE.Group();
    elbow.position.y = -UPPER_ARM;
    arm.add(elbow);
    const upper = [part(P.limb, outfit === 'passenger' && rnd() < 0.4 ? skin : shirt, 0, 0, 0, 0, 0, 0, 0.055, UPPER_ARM, 0.055)];
    if (outfit === 'staff' || outfit === 'police') upper.push(part(P.limb, OUTFITS[outfit].vest, 0, 0, 0, 0, 0, 0, 0.062, 0.09, 0.062));
    const fore = [
      part(P.limb, skin, 0, 0, 0, 0, 0, 0, 0.045, FOREARM, 0.045),
      part(P.ball, skin, 0, -FOREARM - 0.03, 0, 0, 0, 0, 0.05, 0.06, 0.05),
    ];
    if (LONG_SLEEVES.has(outfit)) fore[0] = part(P.limb, shirt, 0, 0, 0, 0, 0, 0, 0.047, FOREARM, 0.047);
    if (opts.suitcase && side === 1) {
      // A case, held by its handle, hanging beside the leg.
      fore.push(part(P.box, pick([0x2f5d8a, 0xb23a3a, 0x3a3a3a, 0xe0a030], rnd), 0.04, -FOREARM - 0.26, 0, 0, 0, 0, 0.12, 0.4, 0.3));
    }
    if (lite) {
      // One mesh per arm: the forearm parts are moved down to where the elbow is.
      for (const g of fore) g.translate(0, -UPPER_ARM, 0);
      arm.add(mesh(mergeParts(upper.concat(fore))));
    } else {
      arm.add(mesh(mergeParts(upper)));
      elbow.add(mesh(mergeParts(fore)));
    }
    chest.add(arm);
    arms.push({ arm, elbow, side });
  }

  /* ---- legs ---- */
  const legs = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.095, 0, 0);
    const knee = new THREE.Group();
    knee.position.y = -THIGH;
    leg.add(knee);
    const thigh = [part(P.limb, trousers, 0, 0, 0, 0, 0, 0, 0.078, THIGH, 0.078)];
    const shin = [
      part(P.limb, trousers, 0, 0, 0, 0, 0, 0, 0.066, SHIN - 0.04, 0.066),
      part(P.box, shoes, 0, -SHIN + 0.035, -0.045, 0, 0, 0, 0.11, 0.08, 0.25),
    ];
    if (lite) {
      for (const g of shin) g.translate(0, -THIGH, 0);
      leg.add(mesh(mergeParts(thigh.concat(shin))));
    } else {
      leg.add(mesh(mergeParts(thigh)));
      knee.add(mesh(mergeParts(shin)));
    }
    body.add(leg);
    legs.push({ leg, knee, side });
  }

  if (lite) {
    // Hips, chest and head in one: a passenger never turns their head.
    for (const g of headParts) g.translate(0, 0.62 + 0.06, 0);
    for (const g of chestParts) g.translate(0, 0.06, 0);
    body.add(mesh(mergeParts(hipsParts.concat(chestParts, headParts))));
  } else {
    body.add(mesh(mergeParts(hipsParts)));
    chest.add(mesh(mergeParts(chestParts)));
    head.add(mesh(mergeParts(headParts)));
  }
  chest.add(head);

  /* ---- marshalling wands, hidden until wanted ---- */
  const wands = [];
  if (!lite) {
    const wandGeo = new THREE.CylinderGeometry(0.025, 0.035, 0.42, 6);
    wandGeo.translate(0, -0.2, 0);
    for (const a of arms) {
      const w = new THREE.Mesh(wandGeo, wandMaterial());
      w.position.set(0, -FOREARM - 0.05, -0.03);
      w.rotation.x = 1.35; // pointing forward out of the fist
      w.visible = false;
      a.elbow.add(w);
      wands.push(w);
    }
  }

  root.userData.rig = { body, chest, head, arms, legs, wands, lite };
  root.userData.anim = {
    phase: 0, t: rnd() * 10, walk: 0, run: 0, air: 0, wave: 0, stop: 0, look: 0,
    pointL: 0, pointR: 0, hello: 0,
  };
  root.userData.outfit = outfit;
  root.userData.height = 1.72;
  return root;
}

/** Show or hide the orange wands. */
export function setWands(person, on) {
  const rig = person && person.userData.rig;
  if (!rig) return;
  for (const w of rig.wands) w.visible = !!on;
}

/**
 * Pose a person for this frame. No allocation.
 *
 * @param {THREE.Object3D} person
 * @param {number} dt
 * @param {object} s
 *   speed   ground speed, m/s
 *   air     true while jumping or falling
 *   wave    'come' (marshal: keep coming), 'stop' (crossed wands),
 *           'left' / 'right' (one wand held out to that side, the other
 *           beckoning: "keep coming, turn this way"), 'hello' (a wave), or null
 *
 * 'left' and 'right' are the marshaller's own left and right, which from
 * behind the marshaller is the screen's left and right as well.
 */
export function posePerson(person, dt, s) {
  const rig = person.userData.rig;
  const A = person.userData.anim;
  if (!rig || !A) return;
  const k = Math.min(1, dt * 8);
  const speed = Math.max(0, s.speed || 0);
  A.t += dt;
  A.walk += (Math.min(1, speed / 1.4) - A.walk) * k;
  A.run += (Math.min(1, Math.max(0, (speed - 2.2) / 2.2)) - A.run) * k;
  A.air += ((s.air ? 1 : 0) - A.air) * Math.min(1, dt * 12);
  A.wave += ((s.wave === 'come' ? 1 : 0) - A.wave) * k;
  A.stop += ((s.wave === 'stop' ? 1 : 0) - A.stop) * k;
  A.pointL += ((s.wave === 'left' ? 1 : 0) - A.pointL) * k;
  A.pointR += ((s.wave === 'right' ? 1 : 0) - A.pointR) * k;
  A.hello += ((s.wave === 'hello' ? 1 : 0) - A.hello) * k;

  /*
   * Stride: a walking step is ~0.7 m, a running one ~1.1 m; a cycle is two.
   * Shorter at a shuffle (a thumb-stick pushed half way), so small steps are
   * small rather than big steps in slow motion.
   */
  const stride = speed < 1.2 ? 0.7 + speed * 0.583 : 1.4 + A.run * 0.8;
  A.phase = (A.phase + (speed / stride) * Math.PI * 2 * dt) % (Math.PI * 2);
  const ph = A.phase;
  const sw = Math.sin(ph);
  const w = A.walk * (1 - A.air);
  const swing = (0.5 + A.run * 0.35) * w;

  /*
   * Hips and knees. +x swings a limb forward (the character faces -Z).
   *
   * PLANTED FEET. The leg used to swing as a sine, so the foot on the ground
   * moved backwards fastest in the middle of the step — 3.4 m/s against the
   * body's 1.8 at a walk — and the walker skated. Now the foot on the ground
   * goes back in a straight line at exactly the walking speed (it stays put
   * on the ground while the body goes over it), and only the foot in the air
   * eases forward. Half a cycle each: the foot travels half a stride under
   * the hip, so the leg reaches a quarter stride either side of it.
   */
  const reach = (stride / 4) * w;
  const lite = !!rig.lite;
  let hipY = 0;
  for (const L of rig.legs) {
    // This leg's phase: the right is half a cycle behind the left.
    let q = L.side < 0 ? ph : ph + Math.PI;
    q = ((q % TAU) + TAU) % TAU;
    let u;
    let fold = 0;
    if (q >= HALF_PI && q <= 3 * HALF_PI) {
      // On the ground: from a quarter stride ahead to a quarter behind, evenly.
      u = reach * (1 - (2 * (q - HALF_PI)) / Math.PI);
    } else {
      // In the air: back to front, easing in and out, knee folded.
      const t = (q < HALF_PI ? q + HALF_PI : q - 3 * HALF_PI) / Math.PI;
      u = -reach * Math.cos(Math.PI * t);
      fold = Math.sin(Math.PI * t);
    }
    const a = Math.asin(Math.max(-0.9, Math.min(0.9, u / HIP_Y)));
    L.leg.rotation.x = a + A.air * 0.55;
    // The knee folds while the leg swings through, and a little at contact.
    const knee = -(fold * (0.55 + A.run * 0.6) * w + 0.06 * w) - A.air * 0.95;
    L.knee.rotation.x = knee;
    // How far below the hip this sole is (a lite passenger's leg is one piece).
    // The shoe tips with the shin: heel down with the leg in front, toe down
    // with it behind.
    const k = lite ? 0 : knee;
    const f = a + k;
    const drop = THIGH * Math.cos(a) + SOLE * Math.cos(f) + (f > 0 ? HEEL : -TOE) * Math.sin(f);
    if (drop > hipY) hipY = drop;
  }

  // Arms: opposite to the legs, elbows bent more when running.
  const idleSway = Math.sin(A.t * 1.7) * 0.03 * (1 - A.walk);
  for (const a of rig.arms) {
    const s1 = a.side < 0 ? -sw : sw;
    let x = s1 * swing * 0.85 + idleSway;
    let z = a.side * (0.08 + A.air * 0.35);
    let elbow = 0.18 + A.run * 0.95 * w + A.air * 0.4;
    // Marshalling. Both arms up, forearms beckoning back over the head.
    if (A.wave > 0.01) {
      const beck = 0.55 + Math.sin(A.t * 7) * 0.5;
      x = x * (1 - A.wave) + 2.75 * A.wave;
      z = z * (1 - A.wave) + a.side * 0.42 * A.wave;
      elbow = elbow * (1 - A.wave) + beck * A.wave;
    }
    // Stop: both wands crossed above the head.
    if (A.stop > 0.01) {
      x = x * (1 - A.stop) + 2.9 * A.stop;
      z = z * (1 - A.stop) - a.side * 0.35 * A.stop;
      elbow = elbow * (1 - A.stop) + 0.25 * A.stop;
    }
    /*
     * Turn signals. The arm on the side the aeroplane should go is held
     * straight out; the other keeps beckoning over the head. A rotation of
     * side * PI/2 about Z swings a hanging arm out level on its own side.
     */
    const out = a.side < 0 ? A.pointL : A.pointR;
    const beckon = a.side < 0 ? A.pointR : A.pointL;
    if (out > 0.01) {
      x = x * (1 - out) + 0.05 * out;
      z = z * (1 - out) + a.side * 1.5 * out;
      elbow = elbow * (1 - out) + 0.05 * out;
    }
    if (beckon > 0.01) {
      x = x * (1 - beckon) + 2.6 * beckon;
      z = z * (1 - beckon) + a.side * 0.3 * beckon;
      elbow = elbow * (1 - beckon) + (0.6 + Math.sin(A.t * 7) * 0.5) * beckon;
    }
    // Hello: the right arm up and out, the forearm waving.
    if (A.hello > 0.01 && a.side > 0) {
      x = x * (1 - A.hello) + 0.35 * A.hello;
      z = z * (1 - A.hello) + 2.5 * A.hello;
      elbow = elbow * (1 - A.hello) + (0.55 + Math.sin(A.t * 9) * 0.45) * A.hello;
    }
    a.arm.rotation.x = x;
    a.arm.rotation.z = z;
    a.elbow.rotation.x = elbow;
  }

  // Body: a bob twice per stride, a lean into a run, breathing at rest.
  /*
   * The hips ride on whichever foot is on the ground: as high as that leg
   * reaches, so the sole touches the floor all through the step — highest
   * over the foot, lowest as the weight changes feet, which is the bob a
   * walk has. They used to bob by a fixed amount whatever the legs did, and
   * mid-run both shoes were up to 21 cm clear of the ground (measured over
   * two seconds at 5.2 m/s: 66 frames in 120 with no foot down).
   */
  rig.body.position.y = hipY * (1 - A.air) + (HIP_Y + 0.05) * A.air;
  rig.chest.rotation.x = -0.05 * w - 0.2 * A.run * w;
  rig.chest.rotation.y = sw * 0.08 * w;
  rig.chest.scale.y = 1 + Math.sin(A.t * 2.1) * 0.012 * (1 - A.walk);
  // At rest, now and then, have a look round.
  const lookWant = A.walk < 0.2 && !s.wave ? Math.sin(A.t * 0.45) * Math.max(0, Math.sin(A.t * 0.17)) * 0.6 : 0;
  A.look += (lookWant - A.look) * Math.min(1, dt * 2);
  rig.head.rotation.y = A.look;
  rig.head.rotation.x = s.wave ? -0.15 : 0.04 * w;
}

/** Free a person's geometry. The material is shared and stays. */
export function disposePerson(person) {
  if (!person) return;
  // The wands' geometry is the person's own too (made in createPerson).
  person.traverse((o) => {
    if (o.isMesh && o.geometry && (o.material === personMaterial() || o.material === WAND_MAT)) o.geometry.dispose();
  });
  if (person.parent) person.parent.remove(person);
}
