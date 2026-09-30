/**
 * What the rocket game looks like: the three rockets, the pad and its
 * tower, the landing pad, the ship, the flame and the smoke.
 *
 * All built from primitives in code — no files to fetch, nothing to cache
 * beyond this module — and kept to a small number of draw calls, because
 * the class plays on Chromebooks: a rocket is about a dozen meshes, the
 * tower is one instanced mesh, the smoke is one set of points.
 *
 * Every model's origin is its BOTTOM CENTRE with +Y up the body, which is
 * what the physics calls the body's position, so placing one is a copy.
 */

import * as THREE from '../../vendor/three.module.js';
import { PAD_HALF, LZ_R, BARGE_HALF, BARGE_HALF_W, BARGE_DECK } from './site.js';

const WHITE = 0xf1f3f6;

const DARK = 0x24282f;
const STEEL = 0x8d939b;

/** Shared materials, per flight, so dispose() can find them all. */
export class Kit {
  constructor() {
    this.mats = [];
    this.geos = [];
    this.texs = [];
  }

  mat(opts) {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05, ...opts });
    this.mats.push(m);
    return m;
  }

  geo(g) {
    this.geos.push(g);
    return g;
  }

  tex(t) {
    this.texs.push(t);
    return t;
  }

  dispose() {
    for (const m of this.mats) m.dispose();
    for (const g of this.geos) g.dispose();
    for (const t of this.texs) t.dispose();
    this.mats.length = this.geos.length = this.texs.length = 0;
  }
}

function mesh(kit, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(kit.geo(geo), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/**
 * The parts of one rocket, each a group with its own bottom at y = 0, so
 * they can be stacked into one body and split into two at separation.
 *
 * Returns { parts: {stageId: Group, payload: Group}, fairing: [L, R] | null,
 * heights: {id: m}, legs: [..], fins: [..], sat: {panels} }.
 */
export function buildRocket(kit, def) {
  const accent = new THREE.Color(def.colour);
  const white = kit.mat({ color: WHITE, roughness: 0.42 });
  const band = kit.mat({ color: accent, roughness: 0.5 });
  const dark = kit.mat({ color: DARK, roughness: 0.7 });
  const metal = kit.mat({ color: 0x5a5f66, roughness: 0.35, metalness: 0.7 });
  const soot = kit.mat({ color: 0x3b3d40, roughness: 0.9 });
  const parts = {};
  const heights = {};
  const legs = [];
  const fins = [];

  for (let i = 0; i < def.stages.length; i++) {
    const s = def.stages[i];
    const g = new THREE.Group();
    g.name = `rocket:${s.id}`;
    const r = s.radius;
    const h = s.height;
    heights[s.id] = h;
    const bell = i === 0 ? Math.min(1.6, h * 0.1) : 1.2;
    // The engine bell (upper stages hide theirs inside the interstage).
    const nozzle = mesh(kit, new THREE.CylinderGeometry(r * 0.28, r * 0.62, bell, 18, 1, true), metal, 0, bell / 2, 0);
    nozzle.material.side = THREE.DoubleSide;
    g.add(nozzle);
    // The tank.
    const tankH = h - bell - (i === 0 && def.stages.length > 1 ? 2 : 0);
    const tank = mesh(kit, new THREE.CylinderGeometry(r, r, tankH, 28), white, 0, bell + tankH / 2, 0);
    g.add(tank);
    // Bands in the rocket's colour — how you tell the three apart.
    const b1 = mesh(kit, new THREE.CylinderGeometry(r * 1.01, r * 1.01, Math.max(0.5, h * 0.05), 28), band, 0, bell + tankH * 0.82, 0);
    g.add(b1);
    if (i === 0) {
      g.add(mesh(kit, new THREE.CylinderGeometry(r * 1.01, r * 1.01, Math.max(0.4, h * 0.03), 28), band, 0, bell + tankH * 0.12, 0));
      // A soot skirt round the bottom, like a flown booster.
      g.add(mesh(kit, new THREE.CylinderGeometry(r * 1.005, r * 1.005, Math.min(2.2, tankH * 0.12), 28), soot, 0, bell + Math.min(1.1, tankH * 0.06), 0));
    }
    if (i === 0 && def.stages.length > 1) {
      // Interstage, black.
      g.add(mesh(kit, new THREE.CylinderGeometry(r, r, 2, 28), dark, 0, h - 1, 0));
    }
    if (s.landable) {
      // Grid fins, folded flat against the top of the booster.
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const fin = new THREE.Group();
        fin.position.set(Math.cos(a) * (r + 0.05), h - 2.6, Math.sin(a) * (r + 0.05));
        fin.rotation.y = -a;
        const plate = mesh(kit, new THREE.BoxGeometry(0.12, 1.1, 1.3), dark, 0.06, 0, 0);
        fin.add(plate);
        g.add(fin);
        fins.push(fin);
      }
      // Four landing legs, hinged low and folded UP along the side, as real
      // ones are; setLegs() swings them down into a wide stance whose feet
      // end level with the bottom of the engine.
      const legLen = Math.round(h * 0.3);
      const pivotY = legLen * LEG_COS - 0.1;
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        const pivot = new THREE.Group();
        pivot.position.set(Math.cos(a) * r * 0.96, pivotY, Math.sin(a) * r * 0.96);
        pivot.rotation.y = -a;
        const leg = mesh(kit, new THREE.BoxGeometry(0.34, legLen, 0.5), dark, 0.2, legLen / 2, 0);
        const foot = mesh(kit, new THREE.CylinderGeometry(0.52, 0.42, 0.2, 12), dark, 0.2, legLen, 0);
        pivot.add(leg, foot);
        g.add(pivot);
        legs.push(pivot);
      }
    }
    if (def.stages.length === 1) {
      // Starling's tail fins.
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.lineTo(1.3, -0.4);
        shape.lineTo(1.3, 0.9);
        shape.lineTo(0, 2.6);
        shape.lineTo(0, 0);
        const fg = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
        fg.translate(0, 0, -0.04);
        const fm = mesh(kit, fg, band, 0, bell + 0.2, 0);
        fm.rotation.y = -a;
        fm.position.x = Math.cos(a) * r * 0.95;
        fm.position.z = Math.sin(a) * r * 0.95;
        g.add(fm);
      }
    }
    parts[s.id] = g;
  }

  // What rides on top.
  const top = def.stages[def.stages.length - 1];
  const R = top.radius;
  const pay = new THREE.Group();
  pay.name = 'rocket:payload';
  const P = def.payload || { kind: 'probe', height: 2.5 };
  heights.payload = P.height;
  let sat = null;
  if (P.kind === 'probe') {
    pay.add(mesh(kit, new THREE.ConeGeometry(R, P.height, 28), white, 0, P.height / 2, 0));
    pay.add(mesh(kit, new THREE.ConeGeometry(R * 0.32, P.height * 0.3, 20), band, 0, P.height * 0.86, 0));
  } else if (P.kind === 'capsule') {
    pay.add(mesh(kit, new THREE.CylinderGeometry(R * 0.42, R, P.height * 0.72, 28), white, 0, P.height * 0.36, 0));
    pay.add(mesh(kit, new THREE.CylinderGeometry(R * 0.2, R * 0.42, P.height * 0.28, 20), band, 0, P.height * 0.86, 0));
    pay.add(mesh(kit, new THREE.CylinderGeometry(R * 0.9, R * 1.0, 0.25, 28), dark, 0, 0.12, 0));
  } else {
    // A satellite: a gold box and two folded blue panels.
    sat = new THREE.Group();
    const gold = kit.mat({ color: 0xd4a64a, roughness: 0.35, metalness: 0.6 });
    const cell = kit.mat({ color: 0x264f9c, roughness: 0.3, metalness: 0.4, emissive: 0x0a1a3a });
    sat.add(mesh(kit, new THREE.BoxGeometry(1.3, 2.2, 1.3), gold, 0, 1.6, 0));
    sat.add(mesh(kit, new THREE.CylinderGeometry(0.5, 0.05, 0.5, 16), white, 0, 3.0, 0));
    const panels = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.66, 1.6, 0);
      const pn = mesh(kit, new THREE.BoxGeometry(3.6, 0.05, 1.2), cell, side * 1.8, 0, 0);
      arm.add(pn);
      arm.scale.set(0.08, 1, 1);
      sat.add(arm);
      panels.push(arm);
    }
    sat.userData.panels = panels;
    pay.add(sat);
  }

  // The fairing: a nose in two halves, round the satellite.
  let fairing = null;
  if (def.fairing) {
    const pts = [];
    const H = P.height + 0.6;
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const y = t * H;
      const rr = t < 0.55 ? R * 1.02 : R * 1.02 * Math.cos(((t - 0.55) / 0.45) * Math.PI * 0.5);
      pts.push(new THREE.Vector2(Math.max(0.02, rr), y));
    }
    fairing = [];
    for (const k of [0, 1]) {
      const g = new THREE.Group();
      const m = mesh(kit, new THREE.LatheGeometry(pts, 20, k * Math.PI, Math.PI), white);
      m.material.side = THREE.DoubleSide;
      g.add(m);
      const stripe = mesh(kit, new THREE.LatheGeometry(pts.slice(3, 5), 20, k * Math.PI, Math.PI), band);
      stripe.material.side = THREE.DoubleSide;
      g.add(stripe);
      fairing.push(g);
    }
    heights.payload = H;
  }
  parts.payload = pay;
  return { parts, heights, legs, fins, fairing, sat };
}

/** How far out a deployed leg leans from straight down: 57 degrees. */
const LEG_OUT = (57 * Math.PI) / 180;
const LEG_COS = Math.cos(LEG_OUT);

/** Legs out (0 = folded up the side, 1 = down and out). */
export function setLegs(legs, k) {
  for (const p of legs) p.rotation.z = -k * (Math.PI - LEG_OUT);
}

/** Grid fins: flat against the body (0), or out and working (1). */
export function setFins(fins, k) {
  for (const f of fins) f.rotation.z = k * 1.35;
}

/* ------------------------------------------------------------------ */
/* The flame                                                           */
/* ------------------------------------------------------------------ */

const plumeVert = /* glsl */ `
  varying float vT;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vT = 0.5 - position.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const plumeFrag = /* glsl */ `
  uniform float uTime;
  uniform float uPower;
  uniform float uThin;
  varying float vT;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float edge = abs(dot(normalize(vN), normalize(vV)));
    float flick = 0.86 + 0.14 * sin(uTime * 41.0 + vT * 17.0) * sin(uTime * 23.0 - vT * 9.0);
    float core = pow(edge, 1.6);
    float along = pow(1.0 - clamp(vT, 0.0, 1.0), mix(1.3, 2.4, uThin));
    vec3 hot = vec3(1.0, 0.97, 0.86);
    vec3 warm = vec3(1.0, 0.62, 0.22);
    vec3 red = vec3(0.95, 0.28, 0.12);
    vec3 col = mix(hot, warm, smoothstep(0.05, 0.45, vT));
    col = mix(col, red, smoothstep(0.45, 0.95, vT));
    col = mix(col, vec3(0.62, 0.72, 1.0), uThin * 0.45 * smoothstep(0.1, 0.8, vT));
    float a = core * along * flick * uPower * mix(1.0, 0.55, uThin);
    gl_FragColor = vec4(col * a * 1.6, a);
  }
`;

/**
 * A flame hanging under a nozzle. Long and narrow in thick air; in thin air
 * the exhaust has nothing pushing it in, so it balloons wide and goes
 * paler — which is also a real thing you can see on launch videos.
 */
export function buildPlume(kit, radius) {
  const geo = kit.geo(new THREE.CylinderGeometry(0.5, 1, 1, 20, 6, true));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uThin: { value: 0 } },
    vertexShader: plumeVert,
    fragmentShader: plumeFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  kit.mats.push(mat);
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.renderOrder = 5;
  m.userData.radius = radius;
  m.visible = false;
  return m;
}

/** Set a flame for this frame. `thin` 0 at sea level … 1 in space. */
export function updatePlume(m, t, power, thin, radius) {
  if (power <= 0.01) {
    m.visible = false;
    return;
  }
  m.visible = true;
  const u = m.material.uniforms;
  u.uTime.value = t;
  u.uPower.value = Math.min(1, power);
  u.uThin.value = thin;
  const r = radius || m.userData.radius;
  const len = r * (7 + 10 * power) * (1 + thin * 1.6);
  const top = r * 0.55;
  const bottom = r * (1.0 + thin * 5.5);
  // The geometry is a unit cone with radius 0.5 at its top and 1 at its
  // bottom; scale it so the top is the nozzle's width and the bottom spreads.
  m.scale.set(bottom, len, bottom);
  m.position.y = -len / 2;
  m.userData.topFrac = top / bottom;
}

/* ------------------------------------------------------------------ */
/* Smoke                                                               */
/* ------------------------------------------------------------------ */

const smokeVert = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying float vA;
  uniform float uScale;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(1.0, -mv.z);
    vA = aAlpha;
    gl_Position = projectionMatrix * mv;
  }
`;
const smokeFrag = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = dot(p, p);
    if (d > 1.0) discard;
    float a = (1.0 - d) * (1.0 - d) * vA;
    gl_FragColor = vec4(uColor * (0.82 + 0.18 * (1.0 - d)), a);
  }
`;

/**
 * Pooled smoke puffs. Positions are world metres; each puff grows and fades
 * on its own clock. `emit()` is cheap and a full pool simply reuses the
 * oldest, so a long burn never allocates.
 */
export class Smoke {
  constructor(kit, count = 220) {
    this.n = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);
    this.age = new Float32Array(count).fill(99);
    this.life = new Float32Array(count).fill(1);
    this.grow = new Float32Array(count);
    this.next = 0;
    const geo = kit.geo(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xe9ecef) }, uScale: { value: 600 } },
      vertexShader: smokeVert,
      fragmentShader: smokeFrag,
      transparent: true,
      depthWrite: false,
    });
    kit.mats.push(mat);
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    this.geo = geo;
  }

  emit(x, y, z, vx, vy, vz, size, life, grow) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.size[i] = size;
    this.age[i] = 0;
    this.life[i] = life;
    this.grow[i] = grow;
  }

  update(dt, viewportH) {
    this.points.material.uniforms.uScale.value = viewportH * 0.9;
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] >= this.life[i]) {
        this.alpha[i] = 0;
        continue;
      }
      this.age[i] += dt;
      const k = this.age[i] / this.life[i];
      const drag = Math.exp(-dt * 0.9);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag + dt * 0.6;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = Math.min(1, k * 8) * (1 - k) * 0.55;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }

  clear() {
    this.age.fill(99);
    this.alpha.fill(0);
  }
}

/* ------------------------------------------------------------------ */
/* The ground: pad, tower, landing pad, ship                           */
/* ------------------------------------------------------------------ */

function landingDecal(kit, label) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#4d5157';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#f5f6f7';
  g.lineWidth = 12;
  g.beginPath();
  g.arc(128, 128, 104, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = '#ffc247';
  g.lineWidth = 22;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(74, 74);
  g.lineTo(182, 182);
  g.moveTo(182, 74);
  g.lineTo(74, 182);
  g.stroke();
  if (label) {
    g.fillStyle = '#f5f6f7';
    g.font = 'bold 20px sans-serif';
    g.textAlign = 'center';
    g.fillText(label, 128, 246);
  }
  const t = kit.tex(new THREE.CanvasTexture(c));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function signTexture(kit, text, sub) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#1d2a44';
  g.fillRect(0, 0, 512, 160);
  g.fillStyle = '#b28dff';
  g.fillRect(0, 138, 512, 22);
  g.fillStyle = '#ffffff';
  g.font = 'bold 60px sans-serif';
  g.textAlign = 'center';
  g.fillText(text, 256, 78);
  g.font = '28px sans-serif';
  g.fillStyle = '#c9d6ea';
  g.fillText(sub, 256, 120);
  const t = kit.tex(new THREE.CanvasTexture(c));
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The launch site, in its own group, oriented so +X is the launch direction.
 * `tallest` sizes the tower to the rocket standing on the pad.
 */
export function buildSite(kit, site, heightAt, tallest, islandName) {
  const g = new THREE.Group();
  g.name = 'rocket:site';
  const yaw = -Math.atan2(site.az.z, site.az.x);
  const concrete = kit.mat({ color: 0xa3a7ab, roughness: 0.9 });
  const concreteDark = kit.mat({ color: 0x74787c, roughness: 0.95 });
  const red = kit.mat({ color: 0xc8432f, roughness: 0.6 });
  const steel = kit.mat({ color: STEEL, roughness: 0.5, metalness: 0.4 });

  // --- the launch pad
  const pad = new THREE.Group();
  pad.position.set(site.pad.x, site.pad.y, site.pad.z);
  pad.rotation.y = yaw;
  const base = site.offshore ? 0 : Math.min(site.pad.y, lowestUnder(heightAt, site.pad, PAD_HALF + 4));
  const deckH = site.pad.y + 1.2 - (base - 3);
  const deck = mesh(kit, new THREE.BoxGeometry(PAD_HALF * 2, deckH, PAD_HALF * 2), concrete, 0, 1.2 - deckH / 2, 0);
  deck.receiveShadow = true;
  pad.add(deck);
  // The flame trench: a dark slot the exhaust is thrown down.
  pad.add(mesh(kit, new THREE.BoxGeometry(PAD_HALF * 1.2, 0.12, 5), concreteDark, -PAD_HALF * 0.35, 1.24, 0));
  // A ring of lamp posts.
  // The tower: posts and braces in one instanced mesh.
  const towerH = tallest + 8;
  const boxes = [];
  const tx = 0;
  const tz = -7.5;
  for (const [dx, dz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) boxes.push([tx + dx, towerH / 2 + 1.2, tz + dz, 0.4, towerH, 0.4]);
  for (let y = 5; y < towerH; y += 5) {
    boxes.push([tx, y + 1.2, tz - 1.6, 3.6, 0.3, 0.3]);
    boxes.push([tx, y + 1.2, tz + 1.6, 3.6, 0.3, 0.3]);
    boxes.push([tx - 1.6, y + 1.2, tz, 0.3, 0.3, 3.6]);
    boxes.push([tx + 1.6, y + 1.2, tz, 0.3, 0.3, 3.6]);
  }
  // Two access arms reaching to the rocket.
  for (const y of [tallest * 0.55, tallest * 0.88]) boxes.push([0, y + 1.2, tz + 3.4, 1.2, 0.8, 5.2]);
  const unit = kit.geo(new THREE.BoxGeometry(1, 1, 1));
  const inst = new THREE.InstancedMesh(unit, red, boxes.length);
  const mtx = new THREE.Matrix4();
  boxes.forEach(([x, y, z, sx, sy, sz], i) => {
    mtx.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
    inst.setMatrixAt(i, mtx);
  });
  inst.castShadow = true;
  pad.add(inst);
  // A light on top, and a lightning mast.
  const lamp = mesh(kit, new THREE.SphereGeometry(0.5, 12, 8), kit.mat({ color: 0xff3b2f, emissive: 0xff2a1a, emissiveIntensity: 2 }), tx, towerH + 1.8, tz);
  pad.add(lamp);
  pad.add(mesh(kit, new THREE.CylinderGeometry(0.1, 0.18, 10, 8), steel, tx, towerH + 6, tz));
  // Hold-down clamps round the rocket's feet.
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    pad.add(mesh(kit, new THREE.BoxGeometry(0.8, 1.6, 0.8), steel, Math.cos(a) * 2.2, 2.0, Math.sin(a) * 2.2));
  }
  // The sign: this is a spaceport.
  const sign = new THREE.Mesh(kit.geo(new THREE.PlaneGeometry(16, 5)), new THREE.MeshBasicMaterial({ map: signTexture(kit, 'SPACEPORT', islandName || 'Island launch site'), side: THREE.DoubleSide }));
  kit.mats.push(sign.material);
  sign.position.set(-PAD_HALF + 2, 8.5, PAD_HALF + 6);
  sign.rotation.y = 0;
  pad.add(sign);
  for (const sx of [-7, 7]) pad.add(mesh(kit, new THREE.BoxGeometry(0.4, 6, 0.4), steel, -PAD_HALF + 2 + sx, 3, PAD_HALF + 6));
  if (site.offshore) addPillars(kit, pad, PAD_HALF, steel);
  g.add(pad);

  // --- the landing pad, behind
  const lz = new THREE.Group();
  lz.position.set(site.lz.x, site.lz.y, site.lz.z);
  lz.rotation.y = yaw;
  const lzBase = site.offshore ? 0 : Math.min(site.lz.y, lowestUnder(heightAt, site.lz, LZ_R + 2));
  const lzH = site.lz.y + 0.5 - (lzBase - 3);
  const lzm = mesh(kit, new THREE.CylinderGeometry(LZ_R, LZ_R + 1.5, lzH, 40), concrete, 0, 0.5 - lzH / 2, 0);
  lzm.receiveShadow = true;
  lz.add(lzm);
  const decal = new THREE.Mesh(kit.geo(new THREE.CircleGeometry(LZ_R - 0.5, 40)), kit.mat({ map: landingDecal(kit, 'LANDING PAD'), roughness: 0.9 }));
  decal.rotation.x = -Math.PI / 2;
  decal.rotation.z = Math.PI / 2;
  decal.position.y = 0.53;
  decal.receiveShadow = true;
  lz.add(decal);
  if (site.offshore) addPillars(kit, lz, LZ_R * 0.8, steel);
  g.add(lz);

  // --- the ship, out at sea along the line
  const ship = new THREE.Group();
  ship.position.set(site.barge.x, 0, site.barge.z);
  ship.rotation.y = yaw;
  const hull = mesh(kit, new THREE.BoxGeometry(BARGE_HALF * 2 + 4, 7, BARGE_HALF_W * 2), kit.mat({ color: 0x2f3a46, roughness: 0.7 }), 0, BARGE_DECK - 3.5 - 0.05, 0);
  ship.add(hull);
  const deckTop = new THREE.Mesh(kit.geo(new THREE.PlaneGeometry(BARGE_HALF * 2, BARGE_HALF_W * 2)), kit.mat({ map: landingDecal(kit, ''), roughness: 0.9 }));
  deckTop.rotation.x = -Math.PI / 2;
  deckTop.position.y = BARGE_DECK + 0.02;
  deckTop.receiveShadow = true;
  ship.add(deckTop);
  // Blast walls at the corners, and a little crane.
  for (const [x, z] of [[-BARGE_HALF, -BARGE_HALF_W + 3], [-BARGE_HALF, BARGE_HALF_W - 3], [BARGE_HALF, -BARGE_HALF_W + 3], [BARGE_HALF, BARGE_HALF_W - 3]]) {
    ship.add(mesh(kit, new THREE.BoxGeometry(4, 4, 5), kit.mat({ color: 0xe6e8ea, roughness: 0.6 }), x, BARGE_DECK + 2, z));
  }
  ship.add(mesh(kit, new THREE.BoxGeometry(0.6, 9, 0.6), red, BARGE_HALF + 1, BARGE_DECK + 4.5, 0));
  g.add(ship);
  g.userData.ship = ship;
  g.userData.lamp = lamp;
  return g;
}

function lowestUnder(heightAt, p, r) {
  let lo = heightAt(p.x, p.z);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    lo = Math.min(lo, heightAt(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r));
  }
  return lo;
}

function addPillars(kit, group, half, mat) {
  for (const [x, z] of [[-half + 3, -half + 3], [half - 3, -half + 3], [-half + 3, half - 3], [half - 3, half - 3]]) {
    group.add(mesh(kit, new THREE.CylinderGeometry(1.4, 1.6, 30, 12), mat, x, -15, z));
  }
}
