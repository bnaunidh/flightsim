/**
 * The pilot: your legs on the pedals and your hands on the controls, from the
 * seat. One skinned mesh, one draw, vertex-coloured (sleeve, glove, trouser,
 * boot), its bones posed every frame from the controls the cockpit has just
 * moved: a hand is wherever its grip is now, the arm reaches it (two-bone IK
 * from a shoulder under the camera), a boot sits on its pedal.
 *
 * Grips are found from the controls' own geometry (the top of a stick, the
 * outer horn of a wheel, the end of a collective), so any cockpit whose movers
 * are named the usual way gets a pilot, and one whose are not gets none.
 */
import * as THREE from '../../vendor/three.module.js';

const COCKPIT_FIRST = -100;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();

/** What each kind of cockpit's crew wears: sleeve, glove (or hand), trouser, boot, torso, strap. */
export const OUTFIT = {
  light: { sleeve: '#5d6f86', hand: '#b9876a', leg: '#6f6754', boot: '#3a2b21', torso: '#5d6f86', strap: '#2a2b2e' },
  airliner: { sleeve: '#d4d8dc', hand: '#b9876a', leg: '#23262c', boot: '#121315', torso: '#d4d8dc', strap: '#33363b', tie: '#1d2230' },
  jet: { sleeve: '#5c6652', hand: '#9f8a66', leg: '#4b5443', boot: '#141414', torso: '#3d4436', strap: '#24272a' },
  racer: { sleeve: '#8e2020', hand: '#1b1c1e', leg: '#8e2020', boot: '#151515', torso: '#8e2020', strap: '#1b1c1e' },
  heli: { sleeve: '#676650', hand: '#2a2a2a', leg: '#5c5b47', boot: '#1b1a18', torso: '#4a4a3a', strap: '#25262a' },
};

/** Every mover the cockpit batched (kit.js batchMovers), with its name. */
export function moversOf(cp) {
  const set = new Set();
  cp.traverse((o) => {
    if (o.isSkinnedMesh && o.userData.movers) for (const b of o.userData.movers) set.add(b);
  });
  return [...set];
}

/** `o`'s matrix in `root`'s frame, from the local matrices (current this frame, whatever matrixWorld says). */
export function relMatrix(root, o, out = new THREE.Matrix4()) {
  out.identity();
  for (let p = o; p && p !== root; p = p.parent) {
    p.updateMatrix();
    out.premultiply(p.matrix);
  }
  return out;
}

/** Vertices of every mesh under `o`, in `o`'s own frame. */
function pointsOf(o) {
  const out = [];
  o.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(o.matrixWorld).invert();
  o.traverse((m) => {
    if (!m.isMesh || m.isSkinnedMesh || !m.geometry || !m.geometry.attributes.position) return;
    _m.multiplyMatrices(inv, m.matrixWorld);
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(_m));
  });
  return out;
}

function boxOf(pts, pick) {
  const b = new THREE.Box3();
  for (const p of pts) if (pick(p)) b.expandByPoint(p);
  return b;
}

/**
 * Where a hand holds `o`, in o's frame: { c (centre), a (grip axis), r (grip radius) }.
 *   top   a stick, a lever: round the top of it
 *   left / right   a wheel: round the outer horn on that side
 *   end   a collective: round its far (forward) end
 */
export function gripOf(o, how) {
  const pts = pointsOf(o);
  if (!pts.length) return null;
  const all = boxOf(pts, () => true);
  const size = all.getSize(new THREE.Vector3());
  let b;
  let a;
  if (how === 'top') {
    const top = all.max.y;
    b = boxOf(pts, (p) => p.y > top - 0.1 && p.y < top - 0.012);
    a = new THREE.Vector3(0, 1, 0);
    const c = b.getCenter(new THREE.Vector3());
    c.y = top - Math.min(0.06, size.y * 0.3);
    const s = b.getSize(_v);
    return { c, a, r: THREE.MathUtils.clamp(Math.max(s.x, s.z) / 2, 0.012, 0.03) };
  }
  if (how === 'left' || how === 'right') {
    const edge = how === 'left' ? all.min.x : all.max.x;
    b = boxOf(pts, (p) => (how === 'left' ? p.x < edge + 0.04 : p.x > edge - 0.04));
    a = new THREE.Vector3(0, 1, 0);
    const c = b.getCenter(new THREE.Vector3());
    const s = b.getSize(_v);
    return { c, a, r: THREE.MathUtils.clamp(Math.max(s.x, s.z) / 2, 0.012, 0.03) };
  }
  // end: the forward (-z) end
  b = boxOf(pts, (p) => p.z < all.min.z + 0.12);
  a = new THREE.Vector3(0, 0, 1);
  const c = b.getCenter(new THREE.Vector3());
  const s = b.getSize(_v);
  return { c, a, r: THREE.MathUtils.clamp(Math.max(s.x, s.y) / 2, 0.012, 0.035) };
}

/* ---------------- geometry ---------------- */

/** Non-indexed pieces with position, normal and colour, one after another in one geometry. */
function merge(list) {
  const n = list.reduce((k, g) => k + g.attributes.position.count, 0);
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['color', 3]]) {
    const a = new Float32Array(n * size);
    let at = 0;
    for (const g of list) {
      a.set(g.attributes[name].array, at);
      at += g.attributes[name].array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(a, size));
  }
  return out;
}

function colour(g, hex) {
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  // A little shade down each piece, so a limb is not one flat colour.
  const p = g.attributes.position;
  g.computeBoundingBox();
  const y0 = g.boundingBox.min.y;
  const dy = g.boundingBox.max.y - y0 || 1;
  for (let i = 0; i < n; i++) {
    const k = 0.92 + 0.08 * ((p.getY(i) - y0) / dy);
    a[i * 3] = c.r * k;
    a[i * 3 + 1] = c.g * k;
    a[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

function clean(g) {
  g = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
  return g;
}

/** A limb along +y from 0 to len: tapered tube with a ball at its root. */
function limb(len, r0, r1, hex, seg, ball = true) {
  const parts = [];
  const t = new THREE.CylinderGeometry(r1, r0, len, seg, 2, true);
  t.translate(0, len / 2, 0);
  parts.push(colour(clean(t), hex));
  if (ball) parts.push(colour(clean(new THREE.SphereGeometry(r0 * 1.02, seg, Math.max(4, seg >> 1))), hex));
  return parts;
}

/**
 * A gloved fist round a grip of radius r, in the hand's frame: y along the grip,
 * +z towards the wrist (the palm side), the fingers wrapped round the far side.
 */
function fist(r, hex, cuff, seg) {
  const parts = [];
  // The back of the hand: rounded, lying along the grip on the palm side.
  const back = new THREE.SphereGeometry(1, seg, Math.max(4, seg >> 1));
  back.scale(0.04, 0.048, 0.026);
  back.translate(0, -0.004, r + 0.02);
  parts.push(colour(clean(back), hex));
  // Four fingers curled round the far side, touching each other.
  for (let i = 0; i < 4; i++) {
    const f = new THREE.TorusGeometry(r + 0.012, 0.0122 - i * 0.0006, seg > 6 ? 5 : 4, seg, Math.PI * 1.25);
    // In the xz plane round y, the open side towards the palm (+z).
    f.rotateX(Math.PI / 2);
    f.rotateY(Math.PI * 1.125);
    f.translate(0, -0.03 + i * 0.0195, 0);
    parts.push(colour(clean(f), hex));
  }
  // The thumb, over the top of the grip.
  const thumb = new THREE.CapsuleGeometry(0.0125, 0.034, 3, 6);
  thumb.rotateZ(Math.PI / 2 - 0.25);
  thumb.translate(0.004, 0.046, r * 0.55);
  parts.push(colour(clean(thumb), hex));
  const wrist = new THREE.CylinderGeometry(0.03, 0.033, 0.05, seg, 1, true);
  wrist.rotateX(Math.PI / 2);
  wrist.translate(0, 0, r + 0.06);
  parts.push(colour(clean(wrist), cuff));
  return parts;
}

/** A boot on a pedal, in the pedal's frame (its face towards +z, up the pedal +y). */
function boot(hex, seg) {
  const parts = [];
  const sole = new THREE.BoxGeometry(0.095, 0.27, 0.035);
  sole.translate(0, 0.03, 0.03);
  parts.push(colour(clean(sole), '#111214'));
  const up = new THREE.CapsuleGeometry(0.046, 0.17, 3, seg);
  up.scale(1, 1, 0.9);
  up.translate(0, 0.03, 0.075);
  parts.push(colour(clean(up), hex));
  const heel = new THREE.CylinderGeometry(0.05, 0.05, 0.12, seg, 1, false);
  heel.rotateX(Math.PI / 2 - 0.5);
  heel.translate(0, -0.08, 0.1);
  parts.push(colour(clean(heel), hex));
  return parts;
}

function torso(o, low) {
  const parts = [];
  const seg = low ? 6 : 10;
  // Chest to hips, front at about the eye's own z: what you see looking down.
  const body = new THREE.CapsuleGeometry(0.17, 0.32, 4, seg);
  body.scale(1, 1, 0.66);
  body.translate(0, -0.47, 0.13);
  parts.push(colour(clean(body), o.torso));
  const lap = new THREE.BoxGeometry(0.36, 0.14, 0.3);
  lap.translate(0, -0.74, 0.03);
  parts.push(colour(clean(lap), o.leg));
  // Shoulder straps and a lap belt.
  for (const s of [-1, 1]) {
    const st = new THREE.BoxGeometry(0.045, 0.36, 0.012);
    st.rotateZ(s * 0.12);
    st.translate(s * 0.075, -0.4, 0.13 - 0.112 - 0.004);
    parts.push(colour(clean(st), o.strap));
  }
  const belt = new THREE.BoxGeometry(0.34, 0.05, 0.02);
  belt.translate(0, -0.63, -0.12);
  parts.push(colour(clean(belt), o.strap));
  if (o.tie) {
    const tie = new THREE.BoxGeometry(0.045, 0.3, 0.01);
    tie.translate(0, -0.36, 0.13 - 0.112 - 0.01);
    parts.push(colour(clean(tie), o.tie));
  }
  return parts;
}

/* ---------------- the rig ---------------- */

const near = (list, x) => list.slice().sort((p, q) => Math.abs(wx(p) - x) - Math.abs(wx(q) - x));
const wx = (o) => o.userData._x;

/**
 * Which grip each hand takes, from the cockpit's movers. Returns
 * { left: { o, how } | null, right: { o, how } | null, pedals: [left, right] }.
 */
export function pickControls(cp, family) {
  const E = cp.userData.eye || new THREE.Vector3(-0.24, 0.46, 0.06);
  const movers = moversOf(cp);
  for (const m of movers) {
    relMatrix(cp, m, _m);
    m.userData._x = _v.setFromMatrixPosition(_m).x;
    m.userData._y = _v.y;
  }
  const named = (re) => movers.filter((m) => re.test(m.name || ''));
  const mine = (list) => near(list, E.x)[0] || null;
  const wheel = mine(named(/^yoke wheel$/)) || mine(named(/^(control wheel|yoke)$/));
  const stick = mine(named(/^(stick|side-stick|cyclic)$/));
  const throttle = mine(named(/^throttle lever$/));
  const collective = mine(named(/^collective$/));
  const thrust = named(/^thrust lever$/);
  let pedals = named(/pedal/);
  if (!pedals.length) pedals = movers.filter((m) => !m.name && m.userData._y < E.y - 0.6);
  pedals = near(pedals, E.x).slice(0, 2).sort((p, q) => wx(p) - wx(q));
  let left = null;
  let right = null;
  if (family === 'heli') {
    if (stick) right = { o: stick, how: 'top' };
    if (collective) left = { o: collective, how: 'end' };
  } else if (family === 'light' && wheel) {
    left = { o: wheel, how: 'left' };
    right = { o: wheel, how: 'right' };
  } else if (thrust.length) {
    // A two-crew deck: the captain flies with the left hand, the right on the thrust levers.
    if (wheel) left = { o: wheel, how: 'left' };
    else if (stick) left = { o: stick, how: 'top' };
    right = { group: near(thrust, E.x).slice(0, 2) };
  } else {
    if (stick) right = { o: stick, how: 'top' };
    else if (wheel) right = { o: wheel, how: 'right' };
    if (throttle) left = { o: throttle, how: 'top' };
    else if (wheel) left = { o: wheel, how: 'left' };
  }
  return { left, right, pedals: pedals.length === 2 ? pedals : [] };
}

/** Two-bone IK: the elbow (or knee) for root S, end W, lengths a, b, bending towards `pole`. */
export function solveJoint(S, W, a, b, pole, out) {
  const d0 = S.distanceTo(W);
  const reach = a + b;
  const d = Math.min(Math.max(d0, Math.abs(a - b) + 1e-3), reach * 0.999);
  const u = _w.subVectors(W, S).normalize();
  const p = _p.copy(pole).addScaledVector(u, -pole.dot(u));
  if (p.lengthSq() < 1e-8) p.set(0, 1, 0).addScaledVector(u, -u.y);
  p.normalize();
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  return out.copy(S).addScaledVector(u, a * cosA).addScaledVector(p, a * sinA);
}

const UP = new THREE.Vector3(0, 1, 0);
function aim(bone, from, to, len) {
  bone.position.copy(from);
  const d = _v.subVectors(to, from);
  const L = d.length();
  bone.quaternion.setFromUnitVectors(UP, d.divideScalar(L || 1));
  // The limb is drawn exactly from joint to joint: a reach a little past its length stretches it.
  bone.scale.set(1, L / len, 1);
}

/** flight/camera.js REALISTIC_OFFSET: where the realistic view's eye is, from the cockpit's. */
const REALISTIC = new THREE.Vector3(0, -0.02, 0.16);
const ARM = { upper: 0.3, fore: 0.29 };
const LEG = { thigh: 0.45, shin: 0.43 };

/**
 * Build the pilot for cockpit `cp` (family `family`), or null when its
 * controls cannot be found. `low`: fewer sides to every limb.
 */
export function buildPilot(cp, family, { low = false } = {}) {
  if (family === 'none') return null;
  const pick = pickControls(cp, family);
  if (!pick.left && !pick.right && !pick.pedals.length) return null;
  const o = OUTFIT[family] || OUTFIT.light;
  const seg = low ? 6 : 10;
  const geos = [];
  const boneOf = [];
  const bones = [];
  const add = (bone, list) => {
    for (const g of list) {
      geos.push(g);
      boneOf.push(bone);
    }
  };
  const root = new THREE.Bone();
  root.name = 'pilot root';
  bones.push(root);
  add(0, torso(o, low));
  const hands = [];
  for (const [side, grip] of [[-1, pick.left], [1, pick.right]]) {
    if (!grip) continue;
    const ua = new THREE.Bone();
    const fa = new THREE.Bone();
    const hb = new THREE.Bone();
    for (const b of [ua, fa, hb]) bones.push(b);
    let g;
    if (grip.group) {
      // Over a pair of thrust levers: the grip across their knobs.
      const tops = grip.group.map((lv) => ({ lv, g: gripOf(lv, 'top') })).filter((x) => x.g);
      if (!tops.length) continue;
      g = { multi: tops, r: 0.016 };
    } else {
      const found = gripOf(grip.o, grip.how);
      if (!found) continue;
      g = { o: grip.o, ...found };
    }
    add(bones.length - 3, limb(ARM.upper, 0.058, 0.048, o.sleeve, seg));
    add(bones.length - 2, limb(ARM.fore, 0.048, 0.038, o.sleeve, seg));
    add(bones.length - 1, fist(g.r, o.hand, family === 'airliner' || family === 'light' ? o.sleeve : o.hand, seg));
    hands.push({ side, g, ua, fa, hb });
  }
  const legs = [];
  for (const [i, ped] of pick.pedals.entries()) {
    const side = i === 0 ? -1 : 1;
    const th = new THREE.Bone();
    const sh = new THREE.Bone();
    const ft = new THREE.Bone();
    for (const b of [th, sh, ft]) bones.push(b);
    add(bones.length - 3, limb(LEG.thigh, 0.075, 0.062, o.leg, seg));
    add(bones.length - 2, limb(LEG.shin, 0.06, 0.047, o.leg, seg));
    add(bones.length - 1, boot(o.boot, seg));
    legs.push({ side, ped, th, sh, ft });
  }
  const geo = merge(geos);
  const n = geo.attributes.position.count;
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  let at = 0;
  geos.forEach((g, i) => {
    for (let k = 0; k < g.attributes.position.count; k++, at++) {
      si[at * 4] = boneOf[i];
      sw[at * 4] = 1;
    }
  });
  for (const g of geos) g.dispose();
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
  mat.name = 'pilot';
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.name = 'pilot';
  mesh.frustumCulled = false;
  mesh.renderOrder = COCKPIT_FIRST;
  mesh.receiveShadow = true;
  mesh.userData.noBatch = true;
  for (const b of bones) mesh.add(b);
  mesh.bind(new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4())), new THREE.Matrix4());
  // Bones are the mesh's children, posed in the cockpit's frame (the mesh sits at its origin);
  // attached binding with identity inverses draws each piece at its bone's local transform.
  cp.add(mesh);

  const E = (cp.userData.eye || new THREE.Vector3(-0.24, 0.46, 0.06)).clone();
  const head = E.clone();
  const S = new THREE.Vector3();
  const J = new THREE.Vector3();
  const Wr = new THREE.Vector3();
  const C = new THREE.Vector3();
  const A = new THREE.Vector3();
  const N = new THREE.Vector3();
  const X = new THREE.Vector3();
  const H = new THREE.Vector3();
  const F = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const poleArm = [new THREE.Vector3(-0.7, -1, 0.25), new THREE.Vector3(0.7, -1, 0.25)];
  const poleLeg = [new THREE.Vector3(-0.3, 1, -0.2), new THREE.Vector3(0.3, 1, -0.2)];

  const pilot = {
    mesh,
    hands,
    legs,
    material: mat,
    head,
    /**
     * Pose every bone from the controls as they are now. `realistic`: the
     * realistic cockpit view's eye, a little back and down (flight/camera.js
     * REALISTIC_OFFSET, in the model's units), which the body follows.
     */
    update(dt, realistic = false) {
      head.copy(E);
      if (realistic) head.addScaledVector(REALISTIC, 1 / (cp.scale.x || 1));
      root.position.copy(head);
      root.quaternion.identity();
      for (const h of hands) {
        const s = h.side;
        // The grip, now.
        if (h.g.multi) {
          C.set(0, 0, 0);
          for (const t of h.g.multi) C.add(_v.copy(t.g.c).applyMatrix4(relMatrix(cp, t.lv, _m)));
          C.divideScalar(h.g.multi.length);
          A.set(1, 0, 0);
        } else {
          relMatrix(cp, h.g.o, _m);
          C.copy(h.g.c).applyMatrix4(_m);
          A.copy(h.g.a).transformDirection(_m);
        }
        // Shoulder under the head; leaning in when the grip is out of reach.
        S.set(head.x + s * 0.19, head.y - 0.25, head.z + 0.08);
        // The palm faces the shoulder, round the grip's axis.
        N.subVectors(S, C);
        N.addScaledVector(A, -N.dot(A));
        if (N.lengthSq() < 1e-6) N.set(0, 0, 1);
        N.normalize();
        X.crossVectors(A, N);
        basis.makeBasis(X, A, N).setPosition(C);
        h.hb.position.copy(C);
        h.hb.quaternion.setFromRotationMatrix(basis);
        h.hb.scale.set(1, 1, 1);
        Wr.copy(C).addScaledVector(N, h.g.r + 0.085);
        const reach = (ARM.upper + ARM.fore) * 0.98;
        const d = S.distanceTo(Wr);
        if (d > reach) S.lerp(Wr, Math.min(0.35, (d - reach) / d));
        solveJoint(S, Wr, ARM.upper, ARM.fore, poleArm[s < 0 ? 0 : 1], J);
        aim(h.ua, S, J, ARM.upper);
        aim(h.fa, J, Wr, ARM.fore);
      }
      for (const l of legs) {
        relMatrix(cp, l.ped, _m);
        l.ft.position.setFromMatrixPosition(_m);
        l.ft.quaternion.setFromRotationMatrix(_m);
        // Ankle: a little up the pedal and off its face.
        F.set(0, -0.06, 0.1).applyMatrix4(_m);
        H.set(head.x * 0.4 + _v.setFromMatrixPosition(_m).x * 0.6, head.y - 0.78, head.z + 0.04);
        // Seated with the feet out on the pedals the legs are nearly straight: the knee rises a
        // little (a long leg to a near pedal is a high knee, into the panel).
        const d = H.distanceTo(F);
        const half = THREE.MathUtils.clamp(d * 0.53, 0.3, 0.47);
        solveJoint(H, F, half, half, poleLeg[l.side < 0 ? 0 : 1], J);
        aim(l.th, H, J, LEG.thigh);
        aim(l.sh, J, F, LEG.shin);
      }
    },
    dispose() {
      cp.remove(mesh);
      geo.dispose();
      mat.dispose();
      mesh.skeleton.dispose();
    },
  };
  pilot.update(0, false);
  return pilot;
}
