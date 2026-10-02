/**
 * T-Pose Harrison, drawn.
 *
 * "make T-Pose Harrison just float, no hoverboard, and his head is the nose
 * of the plane" — the owner. So there is no aeroplane at all: a 3.3 m man
 * flying head-first, lying along his flight path face-forward like every
 * flying hero, still in his T-pose. His arms, straight out sideways, are the
 * wing; his legs, together, are the tail; his head is the nose (and the head
 * view is from his eyes). Nothing pushes him that you can see: he floats.
 * On the ground he hovers a hand's breadth above it, level, bobbing gently.
 *
 * WHAT HOLDS HIM UP ON THE GROUND is the flight model's own undercarriage —
 * the three contact points in WHEELS, unchanged from when he stood on a board,
 * so take-off, landing and braking are exactly what they were. Nothing is
 * drawn there. tests/features/aircrew.mjs checks he clears the ground by
 * HOVER_GAP and that no board or wheel is drawn.
 *
 * HIS ARMS ARE THE FLAPS ("flaps for Harrison = flap arms"). The flap lever
 * moves his arms the way a big bird uses its wings to land: each notch cups
 * them — down and a little forward at the shoulder, the elbow and wrist
 * curling the tips under — and running the flaps out or in is a wing-beat
 * you can see. While the flaps are out in the air he keeps up a slow, steady
 * flap. Flaps up: dead-straight T. All of it through real joints — shoulder,
 * elbow, wrist — each following the one before on a spring, so a beat
 * follows through to the fingertips and nothing pops (ArmRig below).
 *
 * TURNS: he banks his whole body (that is the flight model's roll), looks
 * into the turn and twists his arms a little like ailerons.
 *
 * THE SPIN CLIMB (T): his body spins round its own axis like a drill, arms
 * out, while the flight model takes him straight up (../../features/tpose/
 * moves.js). The spin is drawn here, from a pattern on the stick bytes that
 * every player's snapshot carries — so everybody sees it, and the camera and
 * the instruments never spin.
 *
 * THE BOOST (P P P): at transonic and supersonic speed a vapour cone forms
 * round his head and shoulders and, past Mach 1, a fainter shock cone at the
 * Mach angle. Drawn from his speed, so other players see it too.
 *
 * Built in METRES and wrapped so the root carries `shape.scale`, as model.js's
 * aeroplanes are (main.js hangs the cockpit on the root and counter-scales it).
 *
 * userData:
 *   update(dt, ac, weather)  arms, hover, spin, vapour cone
 *   setRider(on)             false hides him entirely: he IS the aircraft, so
 *                            when he leaves it there is nothing left to draw
 *   rider, person            for the camera and the tests
 *   arms                     the ArmRig (angles, for the tests)
 */

import * as THREE from '../../vendor/three.module.js';
import { createUniformPerson, FLIGHT_ARM } from '../../features/uniforms.js';
import { isSpinSignal, SIGNAL, SPIN_TURNS, machOf } from '../../features/tpose/signal.js';

/** How big Harrison is drawn: 1.9 x the game's 1.72 m person = 3.3 m tall. */
export const HARRISON_SCALE = 1.9;
/**
 * The flight model's contact points, metres — the old board's three wheels,
 * kept exactly so the physics is unchanged. Never drawn.
 */
export const WHEELS = { nose: [0, -0.66, -1.1], main: [0.42, -0.66, 0.4], r: 0.15 };
/** His body's long axis: this far below the centre of gravity, metres. */
export const AXIS_Y = -0.12;
/** His shoulders (the wing's root): this far ahead of the centre of gravity. */
export const SHOULDER_Z = -0.45;
/**
 * The gap under him parked on the ground, metres: the lowest drawn point of
 * him to the ground the flight model rests him on (measured in aircrew.mjs).
 */
export const HOVER_GAP = 0.23;
/** The hover's bob on the ground: amplitude (m) and rate (Hz). */
export const BOB = { amp: 0.02, hz: 0.45 };
/** The head lifted to look ahead, radians (it would face the ground otherwise). */
export const HEAD_LIFT = 1.08;

/*
 * Where the parts of him are, in his own person units (soles at 0, standing).
 * staff/person.js: hips 0.845, chest +0.06, shoulders +0.42, head +0.62.
 */
const SHOULDER_PY = 0.845 + 0.06 + 0.42;
const HEAD_PY = 0.845 + 0.06 + 0.62;
/** Person units up his body -> metres ahead of the CG: z = Z0 - y * scale. */
const Z0 = SHOULDER_PY * HARRISON_SCALE + SHOULDER_Z;

/** Metres forward (negative z) of a point `y` person-units up his standing body. */
export function zOf(py) {
  return Z0 - py * HARRISON_SCALE;
}

/** A slight arch of the back: chest up, the way a flyer holds it, radians. */
export const ARCH = 0.04;

/** His eyes, metres from the CG (worked out from the pose; aircrew.mjs checks it against the drawing). */
export const EYE_M = (() => {
  // The chest arches about its pivot (person y 0.905), carrying the head
  // (0.62 above it) back; the head lifts HEAD_LIFT more; the eyes are 0.02
  // up and 0.138 in front of the head's centre. Rotation about x by r, in
  // the person's frame: y' = y cos r - z sin r, z' = y sin r + z cos r.
  const rot = (y, z, r) => [y * Math.cos(r) - z * Math.sin(r), y * Math.sin(r) + z * Math.cos(r)];
  const [hy, hz] = rot(0.62, 0, ARCH);
  const [ey, ez] = rot(0.02, -0.138, ARCH + HEAD_LIFT);
  const py = 0.905 + hy + ey;
  const pz = hz + ez;
  // Lying face down, head forward: person (x, y, z) -> aircraft (x, AXIS_Y + z k, Z0 - y k).
  return [0, AXIS_Y + pz * HARRISON_SCALE, zOf(py)];
})();

/* ------------------------------------------------------------------ */
/* The arms                                                            */
/* ------------------------------------------------------------------ */

/**
 * The arm pose for a flap position `f` (0 up .. 1 full), at rest: how far the
 * shoulder droops and sweeps forward, how far the elbow and wrist curl the
 * tips under and forward. Radians. Flaps up is all zeros: a dead-straight T.
 */
export const CUP = { droop: 0.3, sweep: 0.13, elbow: 0.24, elbowFwd: 0.12, wrist: 0.32, wristFwd: 0.06 };
export function armRest(f) {
  const k = Math.max(0, Math.min(1, f || 0));
  return {
    droop: CUP.droop * k,
    sweep: CUP.sweep * k,
    elbow: CUP.elbow * k,
    elbowFwd: CUP.elbowFwd * k,
    wrist: CUP.wrist * k,
    wristFwd: CUP.wristFwd * k,
  };
}

/** The flapping: a steady rhythm while the flaps are out, and a beat when they move. */
export const FLAP = {
  hz: 1.1, // a big bird's slow beat
  amp0: 0.1, // radians either way at the first notch...
  ampFull: 0.34, // ...and at full flap
  beat: 0.55, // the wing-beat as the lever moves
  beatHz: 1.35,
  beatDecay: 0.7, // s
};

/** A damped spring towards `to`: x, v in an object. w natural rate, z damping ratio. */
function spring(s, to, w, z, dt) {
  const n = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const a = w * w * (to - s.x) - 2 * z * w * s.v;
    s.v += a * h;
    s.x += s.v * h;
  }
  return s.x;
}

/**
 * Shoulder, elbow and wrist for both arms, one step at a time. Pure numbers:
 * the model applies them to the joints, and the node tests read them.
 *
 *   step(dt, { flaps, airborne, roll, clear, spin })
 *     flaps     0..1, the flap position (ac.flaps)
 *     airborne  in the air (the steady rhythm only flies)
 *     roll      the stick, -1..1: a little aileron twist
 *     clear     metres between his shoulders' height and the ground: the
 *               droop and the downstroke never put a hand into it
 *     spin      0..1: spinning, arms dead straight out
 */
export class ArmRig {
  constructor() {
    this.phase = 0;
    this.beat = 0;
    this.lastFlaps = null;
    this.amp = 0;
    this.side = [-1, 1].map((side) => ({
      side,
      sh: { x: 0, v: 0 }, // shoulder, absolute: down (ventral) positive
      fore: { x: 0, v: 0 }, // forearm, absolute
      hand: { x: 0, v: 0 }, // hand, absolute
      sweep: { x: 0, v: 0 },
      out: { droop: 0, sweep: 0, elbow: 0, elbowFwd: 0, wrist: 0, wristFwd: 0, twist: 0 },
    }));
  }

  step(dt, { flaps = 0, airborne = false, roll = 0, clear = 9, spin = 0 } = {}) {
    dt = Math.max(0, Math.min(0.1, dt || 0));
    const f = Math.max(0, Math.min(1, flaps));
    // A beat while the lever is moving the flaps, in or out.
    const moving = this.lastFlaps !== null && Math.abs(f - this.lastFlaps) > 1e-4;
    this.lastFlaps = f;
    if (moving) this.beat = Math.min(1, this.beat + dt / 0.15);
    else this.beat = Math.max(0, this.beat - dt / FLAP.beatDecay);
    const steady = airborne && f > 0.02 ? FLAP.amp0 + (FLAP.ampFull - FLAP.amp0) * f : 0;
    const beatAmp = FLAP.beat * Math.sin((Math.PI / 2) * this.beat);
    const ampWant = Math.max(steady, beatAmp) * (1 - spin);
    // Amplitude eases, so the rhythm starts and stops without a jolt.
    this.amp += (ampWant - this.amp) * Math.min(1, dt * (ampWant > this.amp ? 3 : 4.5));
    const hz = FLAP.hz + (FLAP.beatHz - FLAP.hz) * Math.min(1, this.beat * 1.5);
    this.phase = (this.phase + dt * hz * Math.PI * 2) % (Math.PI * 2);
    // A real stroke: the downstroke (the work) a little quicker than the recovery.
    const ph = this.phase;
    const wave = Math.sin(ph + 0.28 * Math.sin(ph));
    const rest = armRest(f * (1 - spin));
    // Never a hand into the ground: the room under the shoulders, over the
    // length of his arm (1.65 m), and a little to spare.
    const reach = (FLIGHT_ARM.upper + FLIGHT_ARM.fore + FLIGHT_ARM.hand) * HARRISON_SCALE;
    const maxDown = Math.asin(Math.max(0, Math.min(1, (clear - 0.26) / reach)));
    const curl = Math.max(0, Math.min(1, (clear - 0.26) / 0.9));
    for (const S of this.side) {
      const twist = -S.side * roll * 0.2;
      let target = rest.droop + this.amp * wave;
      // Ailerons: the arm on the inside of the turn rides a touch higher.
      target += S.side * roll * 0.05;
      target = Math.min(target, maxDown);
      const sh = spring(S.sh, target, 13, 1, dt);
      // The forearm and the hand follow, a little late and a little loose: follow-through.
      const fore = spring(S.fore, sh, 10.5, 0.55, dt);
      const hand = spring(S.hand, fore, 13, 0.5, dt);
      const sweep = spring(S.sweep, rest.sweep, 9, 1, dt);
      const o = S.out;
      o.droop = sh;
      o.sweep = sweep;
      o.elbow = Math.max(-0.55, Math.min(0.9, fore - sh + rest.elbow * curl));
      o.elbowFwd = rest.elbowFwd;
      o.wrist = Math.max(-0.6, Math.min(0.85, hand - fore + rest.wrist * curl));
      o.wristFwd = rest.wristFwd;
      o.twist = twist;
    }
    return this;
  }

  /** For the tests: the right arm's angles. */
  get right() {
    return this.side[1].out;
  }

  get left() {
    return this.side[0].out;
  }
}

/* ------------------------------------------------------------------ */
/* The vapour cone                                                      */
/* ------------------------------------------------------------------ */

/** A cone of condensation, apex forward (-z), open towards his feet; alpha in the vertex colours. */
function vapourCone() {
  const seg = 48;
  const rings = 7;
  const pos = [];
  const col = [];
  const idx = [];
  for (let r = 0; r <= rings; r++) {
    const t = r / rings; // 0 apex .. 1 rim
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      // Unit cone: length 1 along +z, radius 1 at the rim; scaled per frame to the Mach angle.
      pos.push(Math.cos(a) * t, Math.sin(a) * t, t);
      // Densest a third of the way back, thin at the apex and gone at the rim,
      // in uneven streaks round it — what condensation looks like.
      const streak = 0.62 + 0.38 * Math.abs(Math.sin(a * 5 + Math.sin(a * 3) * 1.7));
      const along = Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1 - t * 0.35);
      col.push(1, 1, 1, Math.max(0, along * streak));
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < seg; s++) {
      const a = r * (seg + 1) + s;
      const b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

/* ------------------------------------------------------------------ */
/* Harrison                                                            */
/* ------------------------------------------------------------------ */

export function buildTPoseHarrison(type) {
  const S = (type && type.shape) || { scale: 0.5 };
  const root = new THREE.Group();
  root.name = 'aircraft:tpose';
  root.scale.setScalar(S.scale || 1);
  const m = new THREE.Group(); // everything below is in metres
  m.scale.setScalar(1 / (S.scale || 1));
  root.add(m);

  // hover (the bob) -> body (his long axis; the spin turns it) -> pose (lying
  // face down, head forward) -> person.
  const hover = new THREE.Group();
  hover.name = 'harrison:hover';
  m.add(hover);
  const body = new THREE.Group();
  body.name = 'harrison:body';
  body.position.set(0, AXIS_Y, 0);
  hover.add(body);
  const pose = new THREE.Group();
  pose.name = 'harrison';
  // Standing person: up +y, facing -z. Lying head-first, face down: his up
  // is the aircraft's forward (-z), his front is the aircraft's down (-y).
  pose.rotation.x = -Math.PI / 2;
  pose.position.set(0, 0, Z0);
  body.add(pose);
  const person = createUniformPerson('harrison', { seed: 5, flight: true });
  person.scale.setScalar(HARRISON_SCALE);
  pose.add(person);
  person.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  const rig = person.userData.rig;
  // Legs together and straight, raised a touch behind him: the tail.
  for (const L of rig.legs) {
    L.leg.rotation.set(-0.1, 0, -L.side * 0.035);
    L.knee.rotation.set(-0.1, 0, 0);
  }
  rig.body.rotation.x = 0;
  rig.chest.rotation.x = ARCH;
  rig.head.rotation.set(HEAD_LIFT, 0, 0);
  // Arms: the rig's own, now straight out sideways (see uniforms.js flightLimbs).
  for (const a of rig.arms) a.arm.rotation.set(0, 0, a.side * (Math.PI / 2));

  /* ---- the vapour cone, for the boost ---- */
  const coneMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
  });
  coneMat.name = 'vapour';
  const cone = new THREE.Mesh(vapourCone(), coneMat);
  cone.name = 'vapourCone';
  cone.visible = false;
  cone.renderOrder = 2;
  // The apex just ahead of his head.
  const headZ = zOf(HEAD_PY + 0.2) - 0.05;
  cone.position.set(0, AXIS_Y, headZ);
  m.add(cone);
  const shockMat = coneMat.clone();
  shockMat.name = 'shock';
  const shock = new THREE.Mesh(cone.geometry, shockMat);
  shock.name = 'shockCone';
  shock.visible = false;
  shock.renderOrder = 2;
  shock.position.copy(cone.position);
  m.add(shock);

  const arms = new ArmRig();
  let t = 0;
  let spinA = 0;
  let spinRate = 0;
  let stopAt = null;
  let brake = 0;
  let sigT = 0;
  let spinK = 0;
  root.userData.rider = pose;
  root.userData.person = person;
  root.userData.arms = arms;
  root.userData.harrison = true;
  root.userData.setRider = (on) => {
    // He is the whole aircraft: out of it, nothing is left to draw.
    hover.visible = !!on;
    cone.visible = shock.visible = false;
  };
  root.userData.spin = () => ({ angle: spinA, rate: spinRate, on: sigT >= SIGNAL.hold });

  root.userData.update = (dt, ac = {}, weather = {}) => {
    void weather;
    dt = Math.max(0, Math.min(0.1, dt || 0));
    t += dt;
    const c = ac.controls || {};
    // ---- the spin: the stick pattern, held a moment ----
    sigT = isSpinSignal(c) ? sigT + dt : 0;
    const spinning = sigT >= SIGNAL.hold;
    const full = SPIN_TURNS * Math.PI * 2;
    if (spinning) {
      stopAt = null;
      spinRate += (full - spinRate) * Math.min(1, dt * 2.2);
    } else if (spinRate > 0) {
      // Wind down to belly-down, never back the other way: pick the first
      // belly-down angle he can reach braking at about 7 rad/s², then brake
      // evenly onto exactly it.
      if (stopAt === null) {
        const TAU = Math.PI * 2;
        stopAt = Math.ceil((spinA + (spinRate * spinRate) / 14) / TAU - 1e-9) * TAU;
        if (stopAt - spinA < 1e-3) stopAt += TAU;
        brake = (spinRate * spinRate) / (2 * (stopAt - spinA));
      }
      const left = stopAt - spinA;
      const next = Math.sqrt(Math.max(0, 2 * brake * left));
      if (left <= 1e-3 || next * dt >= left) {
        spinRate = 0;
        spinA = 0;
        stopAt = null;
      } else {
        spinRate = next;
      }
    }
    spinA += spinRate * dt;
    if (stopAt === null && spinA > Math.PI * 200) spinA -= Math.PI * 200;
    body.rotation.z = spinA % (Math.PI * 2);
    spinK += ((spinning ? 1 : 0) - spinK) * Math.min(1, dt * 3);
    // ---- the hover: on the ground he bobs ----
    const ground = !!ac.onGround;
    hover.position.y = ground ? Math.sin(t * BOB.hz * Math.PI * 2) * BOB.amp : 0;
    hover.rotation.z = ground ? Math.sin(t * BOB.hz * Math.PI * 1.3 + 1) * 0.006 : 0;
    rig.chest.scale.y = 1 + Math.sin(t * 1.9) * 0.008; // breathing
    // ---- the arms: the flaps ----
    const agl = Number.isFinite(ac.agl) ? ac.agl : ground ? 0.6 : 500;
    arms.step(dt, {
      flaps: ac.flaps || 0,
      airborne: !ground,
      roll: (spinning ? 0 : c.roll || 0) * (1 - spinK),
      clear: Math.max(0, agl + AXIS_Y + hover.position.y),
      spin: spinK,
    });
    for (const S2 of arms.side) {
      const a = rig.arms[S2.side < 0 ? 0 : 1];
      const o = S2.out;
      const s = a.side;
      a.arm.rotation.set(o.twist, s * o.droop, s * (Math.PI / 2 + o.sweep));
      a.elbow.rotation.set(o.elbow, 0, s * o.elbowFwd);
      if (a.wrist) a.wrist.rotation.set(o.wrist, 0, s * o.wristFwd);
    }
    // ---- the head: into the turn; along the body in the spin ----
    const roll = spinning ? 0 : c.roll || 0;
    rig.head.rotation.y += (-roll * 0.4 - rig.head.rotation.y) * Math.min(1, dt * 4);
    rig.head.rotation.x = HEAD_LIFT - spinK * 0.5;
    // ---- the vapour cone: transonic, then a shock cone past Mach 1 ----
    const v = ac.vel && ac.vel.isVector3 ? ac.vel.length() : 0;
    const alt = ac.pos && ac.pos.isVector3 ? ac.pos.y : 0;
    const M = machOf(v, alt);
    const vap = hover.visible ? Math.max(0, 1 - Math.abs(M - 1) / 0.09) : 0;
    const shk = hover.visible ? Math.max(0, Math.min(1, (M - 1.03) / 0.15)) : 0;
    const flick = 0.85 + 0.15 * Math.sin(t * 37) * Math.sin(t * 23);
    cone.visible = vap > 0.01;
    if (cone.visible) {
      // Round his shoulders, nearly flat at Mach 1.
      const half = Math.min(1.25, Math.max(0.75, Math.asin(1 / Math.max(1.0001, M)) + 0.2));
      const L = 1.5;
      cone.scale.set(Math.tan(half) * L, Math.tan(half) * L, L);
      cone.rotation.z = t * 0.6;
      coneMat.opacity = 0.75 * vap * flick;
    }
    shock.visible = shk > 0.01;
    if (shock.visible) {
      const mu = Math.asin(1 / Math.max(1.0001, M));
      const L = 2.6;
      shock.scale.set(Math.tan(mu) * L, Math.tan(mu) * L, L);
      shock.rotation.z = -t * 0.4;
      shockMat.opacity = 0.32 * shk * flick;
    }
  };
  root.userData.dispose = () => {
    root.traverse((o) => {
      if (o.geometry && o !== shock) o.geometry.dispose();
    });
    coneMat.dispose();
    shockMat.dispose();
  };
  return root;
}
