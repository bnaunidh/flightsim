/**
 * What heat-seeking missiles LOOK like: the missile itself, the pylons it
 * hangs from, the white smoke trail, the flares, an unmanned launcher and a
 * practice target drone. The rules are in ./rules.js (no three.js there); the
 * things that fly are in ./world.js.
 *
 * Everything is made once and shared (one geometry and a handful of
 * materials for every missile in the sky), the smoke is ONE draw call however
 * many missiles are up, and nothing here flashes: the flame and the flares
 * hold steady, and the launcher's beacon swells and fades through
 * blinkLevel() — a soft pulse with Reduce flashing on, which is the default.
 */

import * as THREE from '../../vendor/three.module.js';
import { blinkLevel } from '../../render/flash-safety.js';

/* ------------------------------------------------------------------ *
 * A glow, shared
 * ------------------------------------------------------------------ */

let glowTex = null;
function glowTexture() {
  if (glowTex || typeof document === 'undefined') return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g && g.createRadialGradient) {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.3, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
  }
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

export function glowSprite(color, size, opacity = 0.9) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(size);
  return s;
}

/* ------------------------------------------------------------------ *
 * The smoke trail: one Points object for every puff of every missile
 * ------------------------------------------------------------------ */

const SMOKE_VERT = `
attribute float aAge;
attribute float aSize;
uniform float uScale;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float grow = 1.0 + aAge * 2.4;
  float px = aSize * grow * uScale / max(-mv.z, 1.0);
  gl_PointSize = aAge >= 1.0 ? 0.0 : clamp(px, 1.0, 64.0);
  vA = (1.0 - aAge) * (1.0 - aAge) * 0.8;
  gl_Position = projectionMatrix * mv;
}`;
const SMOKE_FRAG = `
varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = smoothstep(1.0, 0.2, r) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(0.96, 0.97, 0.98, a);
}`;

export class Trails {
  constructor(max = 480) {
    this.max = max;
    this.head = 0;
    this.pos = new Float32Array(max * 3);
    this.age = new Float32Array(max).fill(1);
    this.size = new Float32Array(max);
    this.t = new Float32Array(max);
    this.life = new Float32Array(max);
    this.live = 0;
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.ageAttr = new THREE.BufferAttribute(this.age, 1).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aAge', this.ageAttr);
    g.setAttribute('aSize', this.sizeAttr);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 700 } },
      vertexShader: SMOKE_VERT,
      fragmentShader: SMOKE_FRAG,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.name = 'heatseek:smoke';
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  emit(x, y, z, size = 2.4, life = 3.2) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.size[i] = size;
    this.t[i] = 0;
    this.life[i] = life;
    this.age[i] = 0;
    this.live = Math.min(this.max, this.live + 1);
    this.dirty = true;
  }

  /** `scale`: pixels per metre at one metre of distance (screen height over twice the tan of half the field of view). */
  update(dt, scale) {
    if (scale > 0) this.material.uniforms.uScale.value = scale;
    if (!this.live) return;
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] >= 1) continue;
      this.t[i] += dt;
      const a = this.t[i] / this.life[i];
      this.age[i] = a >= 1 ? 1 : a;
      any = true;
    }
    if (!any) this.live = 0;
    this.ageAttr.needsUpdate = true;
    if (this.dirty) {
      this.posAttr.needsUpdate = true;
      this.sizeAttr.needsUpdate = true;
      this.dirty = false;
    }
  }

  /** How many puffs are showing. */
  get count() {
    let n = 0;
    for (let i = 0; i < this.max; i++) if (this.age[i] < 1) n++;
    return n;
  }

  clear() {
    this.age.fill(1);
    this.live = 0;
    this.head = 0;
    this.ageAttr.needsUpdate = true;
  }

  dispose() {
    if (this.points.parent) this.points.parent.remove(this.points);
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

/* ------------------------------------------------------------------ *
 * The missile
 * ------------------------------------------------------------------ */

/** Metres. A short-range air-to-air round: about 3 m long, 17 cm across. */
export const MISSILE = { length: 3.1, radius: 0.085 };

function bake(parts) {
  const pos = [];
  const nor = [];
  const m4 = new THREE.Matrix4();
  const nm = new THREE.Matrix3();
  const v = new THREE.Vector3();
  for (const { geo, matrix } of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    m4.copy(matrix);
    nm.getNormalMatrix(m4);
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m4);
      pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      nor.push(v.x, v.y, v.z);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

let MS = null;
function missileKit() {
  if (MS) return MS;
  const R = MISSILE.radius;
  const along = (geo, x, y, z) => ({ geo, matrix: new THREE.Matrix4().makeTranslation(x, y, z) });
  const rotX = (a) => new THREE.Matrix4().makeRotationX(a);
  const at = (m, x, y, z) => m.premultiply(new THREE.Matrix4().makeTranslation(x, y, z));

  // Axis along Z, nose toward -Z (the game's models face -Z).
  const body = new THREE.CylinderGeometry(R, R, 2.0, 12, 1, false);
  const bodyParts = [{ geo: body, matrix: at(rotX(Math.PI / 2), 0, 0, 0.25) }];
  const tailCone = new THREE.CylinderGeometry(R, R * 0.8, 0.26, 12);
  bodyParts.push({ geo: tailCone, matrix: at(rotX(Math.PI / 2), 0, 0, 1.38) });

  const noseGeo = new THREE.ConeGeometry(R, 0.75, 12);
  // ConeGeometry points +Y; turn it so the tip is at -Z.
  const noseParts = [{ geo: noseGeo, matrix: at(rotX(-Math.PI / 2), 0, 0, -1.125) }];
  const dome = new THREE.SphereGeometry(R * 0.55, 8, 6);
  noseParts.push(along(dome, 0, 0, -1.5));

  const bandGeo = new THREE.CylinderGeometry(R * 1.04, R * 1.04, 0.16, 12);
  const bandParts = [
    { geo: bandGeo, matrix: at(rotX(Math.PI / 2), 0, 0, -0.55) },
    { geo: bandGeo, matrix: at(rotX(Math.PI / 2), 0, 0, 0.9) },
  ];

  const finParts = [];
  const rear = new THREE.BoxGeometry(0.012, 0.3, 0.34);
  const canard = new THREE.BoxGeometry(0.012, 0.18, 0.18);
  for (let k = 0; k < 4; k++) {
    const roll = (k * Math.PI) / 2;
    const rz = new THREE.Matrix4().makeRotationZ(roll);
    finParts.push({ geo: rear, matrix: rz.clone().multiply(new THREE.Matrix4().makeTranslation(0, R + 0.1, 1.2)) });
    finParts.push({ geo: canard, matrix: rz.clone().multiply(new THREE.Matrix4().makeTranslation(0, R + 0.05, -0.85)) });
  }

  MS = {
    body: bake(bodyParts),
    nose: bake(noseParts),
    band: bake(bandParts),
    fins: bake(finParts),
    matBody: new THREE.MeshStandardMaterial({ color: 0xe8ebee, roughness: 0.45, metalness: 0.25 }),
    matNose: new THREE.MeshStandardMaterial({ color: 0x24282c, roughness: 0.5, metalness: 0.3 }),
    matBand: new THREE.MeshStandardMaterial({ color: 0xffc233, roughness: 0.6, metalness: 0.1 }),
    matFins: new THREE.MeshStandardMaterial({ color: 0xb9c0c6, roughness: 0.5, metalness: 0.4 }),
    pylon: new THREE.BoxGeometry(0.07, 0.34, 1.7),
    rail: new THREE.BoxGeometry(0.1, 0.04, 1.9),
    matPylon: new THREE.MeshStandardMaterial({ color: 0x3a4045, roughness: 0.6, metalness: 0.35 }),
  };
  return MS;
}

/** One missile, nose toward -Z, its middle at the origin. Shares geometry and materials with every other. */
export function makeMissileMesh() {
  const k = missileKit();
  const g = new THREE.Group();
  g.name = 'heatseek:missile';
  for (const [geo, mat] of [[k.body, k.matBody], [k.nose, k.matNose], [k.band, k.matBand], [k.fins, k.matFins]]) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

/** The glow of the motor, behind the missile. Steady: no flicker to cause one. */
export function makeFlame(size = 3.2) {
  const s = glowSprite(0xffb458, size, 0.95);
  s.position.z = MISSILE.length * 0.5 + 0.4;
  s.name = 'heatseek:flame';
  return s;
}

/* ------------------------------------------------------------------ *
 * Pylons on the wings
 * ------------------------------------------------------------------ */

/** Where on the aeroplane the three missiles hang, in this order: right wing, left wing, belly. */
export const STATION_IDS = ['R', 'L', 'C'];

const _ray = new THREE.Raycaster();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

/** The height, in the model's own frame, of the lowest skin above (x, z) — a wing's underside, the belly. */
export function undersideAt(model, rigGroup, x, z, fallback) {
  model.updateWorldMatrix(true, true);
  _o.set(x, -8, z).applyMatrix4(model.matrixWorld);
  _d.set(0, 1, 0).transformDirection(model.matrixWorld);
  _ray.set(_o, _d);
  _ray.far = 16;
  // Meshes only (a sprite needs a camera to be hit, and a glow is not skin), and not our own pylons.
  const meshes = [];
  model.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    for (let p = o; p; p = p.parent) if (p === rigGroup) return;
    meshes.push(o);
  });
  const hits = _ray.intersectObjects(meshes, false);
  for (const h of hits) {
    if (!h.object) continue;
    const m = h.object.material;
    if (m && m.transparent && m.opacity < 0.5) continue;
    const local = model.worldToLocal(h.point.clone());
    if (local.y > -3 && local.y < 3) return local.y;
  }
  return fallback;
}

/**
 * Where the three stations are on this model, in its own frame (metres):
 * [{ id, x, y, z }] with `y` the skin the pylon hangs from. Read from the
 * drawn model (its wing config, a ray up to the underside), so it fits every
 * military aeroplane the pack draws and the next one added.
 */
export function stationsFor(model, type, rigGroup = null) {
  const ud = (model && model.userData) || {};
  const geo = ud.flightGeometry || null;
  const cfg = ud.config || null;
  const plan = type && type.plan;
  let halfSpan = geo && geo.wingSpan ? geo.wingSpan / 2 : plan && plan.span ? plan.span / 2 : 5;
  if (geo && geo.bounds) halfSpan = Math.max(halfSpan, Math.abs(geo.bounds.max[0]));
  // Out from the fuselage and the main gear, in from the wing tip.
  const x = Math.max(1.9, Math.min(halfSpan - 1.2, halfSpan * 0.44));
  let z = 0.9;
  const w = cfg && cfg.wing;
  if (w) {
    const t = Math.max(0, Math.min(1, (x - w.rootX) / w.span));
    z = w.rootZ + (w.sweep || 0) * t + (w.rootChord + (w.tipChord - w.rootChord) * t) * 0.45;
  }
  const out = [];
  for (const [id, sx, sz] of [['R', 1, z], ['L', -1, z], ['C', 0, 0.9]]) {
    const wingY = w ? w.rootY + (w.dihedral || 0) * Math.max(0, Math.min(1, (x - w.rootX) / w.span)) - 0.06 : -0.35;
    const fallback = id === 'C' ? (geo && geo.hardPoints ? ((geo.hardPoints.find((h) => h.partId === 'fuselage') || { pos: [0, -0.7, 0] }).pos[1]) : -0.7) : wingY;
    const y = undersideAt(model, rigGroup, sx * x, sz, fallback);
    out.push({ id, x: sx * x, y, z: sz });
  }
  return out;
}

/**
 * Hang the three missiles on `model`. Returns { group, stations, ... }: each
 * station { id, x, y, z, mesh, pylon, on } — `on` is true while the missile is
 * still there. Hung on the model so they move with the aeroplane; the break-up
 * skips this group (it is not airframe) and the crash hides it.
 */
export function buildPylons(model, type, count = 3) {
  const k = missileKit();
  const group = new THREE.Group();
  group.name = 'heatseek:pylons';
  group.userData.noAirframe = true;
  model.add(group);
  const spots = stationsFor(model, type, group);
  const stations = [];
  for (let i = 0; i < Math.min(count, spots.length); i++) {
    const s = spots[i];
    const g = new THREE.Group();
    g.name = `heatseek:station:${s.id}`;
    g.position.set(s.x, s.y, s.z);
    const pylon = new THREE.Mesh(k.pylon, k.matPylon);
    pylon.position.set(0, -0.14, 0);
    const rail = new THREE.Mesh(k.rail, k.matPylon);
    rail.position.set(0, -0.31, 0);
    const mesh = makeMissileMesh();
    mesh.position.set(0, -0.31 - 0.025 - MISSILE.radius, 0);
    g.add(pylon, rail, mesh);
    group.add(g);
    stations.push({ id: s.id, x: s.x, y: s.y, z: s.z, group: g, mesh, pylon, rail, on: true });
  }
  return { group, stations, model };
}

/* ------------------------------------------------------------------ *
 * Flares
 * ------------------------------------------------------------------ */

export class FlareSprites {
  constructor(max = 28) {
    this.max = max;
    this.pool = [];
    this.group = new THREE.Group();
    this.group.name = 'heatseek:flares';
    for (let i = 0; i < max; i++) {
      const s = glowSprite(0xffe0a0, 3.6, 1);
      s.visible = false;
      this.group.add(s);
      this.pool.push(s);
    }
  }

  take() {
    for (const s of this.pool) if (!s.visible) return s;
    return null;
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    for (const s of this.pool) s.material.dispose();
  }
}

/**
 * Take a launcher or a target drone out of the world for good: its own geometry and materials go
 * (the glow texture is shared and stays). Not for the missile, whose geometry is shared by all.
 */
export function disposeModel(root) {
  if (!root) return;
  if (root.parent) root.parent.remove(root);
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const m = o.material;
    if (m) (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
  });
}

/* ------------------------------------------------------------------ *
 * An unmanned launcher, and a practice target
 * ------------------------------------------------------------------ */

/** A launch site: a low deck with a rack of tubes aimed up, and a mast with a lamp. Nobody is ever aboard. */
export function makeLauncherSite() {
  const g = new THREE.Group();
  g.name = 'heatseek:launcher';
  const steel = new THREE.MeshStandardMaterial({ color: 0x4b545b, roughness: 0.7, metalness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23282c, roughness: 0.6, metalness: 0.4 });
  const warn = new THREE.MeshStandardMaterial({ color: 0xe8a317, roughness: 0.7, metalness: 0.1 });
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 8.2, 1.4, 20), steel);
  deck.position.y = 0.4;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(7.6, 0.25, 6, 24), warn);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 1.15;
  g.add(deck, ring);
  // The rack: two tubes on a swivel, tipped up.
  const swivel = new THREE.Group();
  swivel.position.set(0, 2.1, 0);
  swivel.rotation.x = -0.9;
  const base = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.6, 2.4), dark);
  base.position.y = -0.7;
  swivel.add(base);
  for (const sx of [-0.8, 0.8]) {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 6.2, 10), steel);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(sx, 0.4, 0);
    swivel.add(tube);
  }
  g.add(swivel);
  g.userData.swivel = swivel;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 7, 6), dark);
  mast.position.set(-5, 4.6, 0);
  g.add(mast);
  const lamp = glowSprite(0xff6a4a, 6, 0.9);
  lamp.position.set(-5, 8.4, 0);
  g.add(lamp);
  g.userData.lamp = lamp;
  /** The soft pulse of the lamp (blinkLevel: a gentle swell with Reduce flashing on). */
  g.userData.tick = (t) => {
    lamp.material.opacity = 0.3 + 0.6 * blinkLevel(t, 2.4, 0.5);
  };
  return g;
}

/** A practice target drone: orange and white so it reads against sea and sky, small, unmanned. */
export function makeTargetDroneModel() {
  const g = new THREE.Group();
  g.name = 'heatseek:target-drone';
  const orange = new THREE.MeshStandardMaterial({ color: 0xff7a1c, roughness: 0.55, metalness: 0.15 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f3f4, roughness: 0.5, metalness: 0.1 });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.6, 4.2, 8), orange);
  body.rotation.x = -Math.PI / 2; // tip toward -Z
  const wing = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.14, 1.1), white);
  wing.position.z = 0.5;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.7), white);
  tail.position.z = 1.8;
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.9), orange);
  fin.position.set(0, 0.5, 1.8);
  g.add(body, wing, tail, fin);
  // Something warm to look at: the engine's glow, steady.
  const glow = glowSprite(0xffa050, 8, 0.7);
  glow.position.z = 2.3;
  g.add(glow);
  // And a lamp that swells and fades rather than flashing.
  const lamp = glowSprite(0xff4a3a, 9, 0.8);
  lamp.position.y = 0.8;
  g.add(lamp);
  g.userData.lamp = lamp;
  g.userData.tick = (t) => {
    lamp.material.opacity = 0.35 + 0.55 * blinkLevel(t, 2.0, 0.5);
  };
  return g;
}
