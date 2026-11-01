/**
 * The SCP Foundation models of "Last Flight Out" (batch 6): the five SCPs
 * that breach as the Site's sectors go dark, the Foundation guards and the
 * hazmat staff at the ramp and the gate, the task force's gunship circling
 * the Site, the containment cases on the carts and the loadmaster's
 * clipboard. Lazily imported by features/scp-escape.js when a run of the
 * mission is built (never before the menu, never on any other flight); the
 * files are fetched then, and only then.
 *
 * SCP Foundation content by the SCP Wiki community, CC BY-SA 3.0,
 * scpwiki.com (LICENSE, "SCP FOUNDATION CONTENT"). The models are CC BY 4.0
 * (Sketchfab; credits below, on the Credits screen and in
 * assets/models/LICENSES.md), baked by tools/real-models/scp.py: no image
 * ships, the colours are read per vertex at 64 px.
 *
 * THE RULES OF THE MISSION ARE NOT CHANGED. What breaches is drawn, nothing
 * more: the clock, the sectors, the strip's twenty seconds, the warhead and
 * every way to win or lose are scp-escape.js's, as they were. Each SCP
 * comes out of its sector when that sector goes dark (scp-escape's own
 * schedule) and moves along its own route round the compound so that it is
 * at the end of it when the breach reaches the strip — no sooner, at most
 * its own believable pace — and it HOLDS STILL whenever anybody is near it
 * (HOLD_M): nobody is shown being caught, chased or hurt.
 *
 *   SCP-682  sector A: round the outside of the fence on the east, a big
 *            reptile crawling (unrigged: its body sways side to side as it
 *            goes, a wave down its length; no hop, no bob).
 *   SCP-939  sector B: down the inside of the east fence (its own walk).
 *   SCP-106  sector C: rises out of the yard (its own clip), walks, sinks
 *            back, and rises again further on (that is what it does).
 *   SCP-096  sector E: sits by the west fence, its back to the strip, its
 *            head bowed over its knees (its own sitting clip) — the whole
 *            mission. Its face is never turned to the camera, and the file
 *            has no red that reads as blood (scp.py `calm`).
 *   SCP-173  sector F: moves only while it is not on screen, a few metres at
 *            a time. Looked at, it stands.
 *
 * CHEAP: one mesh each (skinned on the GPU for the three with clips, the
 * clips' joint matrices read from the file, no glTF loader), no lights, no
 * shadows; animation skipped when hidden and slowed when far. On Low: two
 * guards and one hazmat suit at the ramp (Medium and up: two more guards at
 * the gate and a second suit), every model shared, never cloned geometry.
 *
 * FALLBACK: until a model arrives, and if it never does (or the real models
 * are switched off), the posted guards and staff are the game's own figures
 * (staff/person.js), the carts their plain boxes, and what breaches stays
 * unseen, as it was before batch 6.
 */
import * as THREE from '../vendor/three.module.js';
import { parseGLB } from '../vehicles/glb.js';
import { fetchRetry } from '../core/load-retry.js';
import { realModelsOn } from '../aircraft/real-models.js';
import { qualityRank } from '../aircraft/model-quality.js';
import { heightAt } from '../world/terrain.js';
import { Builder } from '../aircraft/models/civil-build.js';
import { createPerson, posePerson, disposePerson } from './staff/person.js';

const SF = 'https://sketchfab.com/3d-models/';

/** Every model, by id: the file, the credit, and what it is in the game (the Credits screen's words). */
export const SCP_MODELS = {
  'scp-173': { file: 'scp-173.glb', title: 'SCP-173', author: 'ThatJamGuy', url: SF + 'e4ef798fb0284b31bf90bad0d3bc7fc8', used: 'Last Flight Out: the statue loose on the Site' },
  'scp-096': { file: 'scp-096.glb', title: 'SCP-096', author: 'ThatJamGuy', url: SF + '86f6620d460945ef9992ea19126c675e', used: 'Last Flight Out: the one sitting by the west fence' },
  'scp-106': { file: 'scp-106.glb', title: 'SCP-106', author: 'ThatJamGuy', url: SF + '21296abb0a224acea2bce6cdd6005289', used: 'Last Flight Out: the old man rising out of the yard' },
  'scp-682': { file: 'scp-682.glb', title: 'Scp 682', author: 'cg097', url: SF + 'effff1cd246542919a0aad70eaad8bc5', used: 'Last Flight Out: the big reptile coming round the fence' },
  'scp-939': { file: 'scp-939.glb', title: 'SCP-939', author: 'ThatJamGuy', url: SF + '1b99ae814fad47ebb558076e8b5beb49', used: 'Last Flight Out: the one prowling the east fence' },
  guard: { file: 'guard.glb', title: 'SCP Foundation Guard', author: 'ThatJamGuy', url: SF + '11134bf497ba46eba645274511ff14f7', used: 'Last Flight Out: Foundation guards at the ramp and the gate' },
  hazmat: { file: 'hazmat.glb', title: 'Hazmat (SCP Containment Breach)', author: 'SCPGames', url: SF + '6361b4474c9b4e65b88b23cda4640a7c', used: 'Last Flight Out: hazmat staff at the ramp' },
  apache: { file: 'apache.glb', title: 'Apache (SCP Containment Breach)', author: 'SCPGames', url: SF + 'aafe3d3091d44412ad710068a9b99b5d', used: 'Last Flight Out: the task force gunship circling the Site' },
  'crate-173': { file: 'crate-173.glb', title: 'SCP 173 Box (SCP Containment Breach)', author: 'SCPGames', url: SF + '48ecf48e25884d11876d58cd35f8f4b7', used: 'Last Flight Out: the sealed containment cases on the carts and by the ramp' },
  clipboard: { file: 'clipboard.glb', title: 'Clipboard (SCP Containment Breach)', author: 'SCPGames', url: SF + 'f26829100fcc45de99e2b99385ef9bc9', used: 'Last Flight Out: the clipboards the Site staff carry' },
};

/** Which SCP comes out of which sector (scp-escape SECTORS: A..F, index into its schedule). D: nothing is seen. */
export const BREACH = Object.freeze([
  { id: 'scp-682', sector: 0, pace: 2.6, hold: 45 },
  { id: 'scp-939', sector: 1, pace: 2.4, hold: 28 },
  { id: 'scp-106', sector: 2, pace: 0.95, hold: 25 },
  { id: 'scp-096', sector: 4, pace: 0, hold: 0 },
  { id: 'scp-173', sector: 5, pace: 6, hold: 22 },
]);
/** Metres: nobody within this of an SCP (by default) and it moves; otherwise it stands. */
export const HOLD_M = 25;
/** The gunship: an orbit over the Site, metres and m/s. It is not solid and it never fires. */
export const ORBIT = Object.freeze({ r: 330, agl: 220, speed: 36, leaveSpeed: 62 });
/** Posted figures by quality: [ramp guards, gate guards, hazmat suits]. */
export const POSTED = Object.freeze({ low: [2, 0, 1], medium: [2, 2, 2], high: [2, 2, 2] });

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

const templates = new Map();
const pending = new Map();
const failed = new Set();
let loader = null;

/** Tests: read the files off disk instead of fetching them. */
export function setScpModelLoader(fn) {
  loader = fn;
}

export function scpModelUrl(id) {
  return new URL(`../../assets/models/real/scp/${SCP_MODELS[id].file}`, import.meta.url).href;
}

/** The models wanted at all: the real-models switch (Settings, ?realmodels=off, a 2 GB device). */
export const scpModelsOn = () => realModelsOn();

function chunks(buf) {
  const dv = new DataView(buf);
  const jl = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
  const bl = dv.getUint32(20 + jl, true);
  const bin = new Uint8Array(buf, 28 + jl, bl);
  return { json, bin };
}

const TYPED = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** One accessor as a typed array (a copy when it is strided) and its item size. */
function accessorOf(json, bin, i) {
  const a = json.accessors[i];
  const v = json.bufferViews[a.bufferView];
  const T = TYPED[a.componentType];
  const n = SIZE[a.type];
  const off = bin.byteOffset + (v.byteOffset || 0) + (a.byteOffset || 0);
  const stride = v.byteStride || 0;
  if (!stride || stride === n * T.BYTES_PER_ELEMENT) return { array: new T(bin.buffer, off, a.count * n), n, normalized: !!a.normalized };
  const out = new T(a.count * n);
  const src = new T(bin.buffer, bin.byteOffset + (v.byteOffset || 0), (v.byteLength / T.BYTES_PER_ELEMENT) | 0);
  const step = stride / T.BYTES_PER_ELEMENT;
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = src[((a.byteOffset || 0) / T.BYTES_PER_ELEMENT) + k * step + c];
  return { array: out, n, normalized: !!a.normalized };
}

/** A rigged file: one skinned body, the joints' inverse binds and the clips (tools/real-models/scp.py write). */
function readRig(buf, id) {
  const { json, bin } = chunks(buf);
  const root = json.nodes.find((n) => n.name === id);
  const skin = root.extras.skin;
  const prim = json.meshes[0].primitives[0];
  const g = new THREE.BufferGeometry();
  const at = (name, key) => {
    const a = accessorOf(json, bin, prim.attributes[key]);
    g.setAttribute(name, new THREE.BufferAttribute(a.array, a.n, a.normalized));
  };
  at('position', 'POSITION');
  at('normal', 'NORMAL');
  at('color', 'COLOR_0');
  at('skinIndex', 'JOINTS_0');
  at('skinWeight', 'WEIGHTS_0');
  g.setIndex(new THREE.BufferAttribute(accessorOf(json, bin, prim.indices).array, 1));
  const ibm = accessorOf(json, bin, skin.ibm).array;
  const inverses = [];
  for (let j = 0; j < skin.joints; j++) inverses.push(new THREE.Matrix4().fromArray(ibm, j * 16));
  const clips = {};
  for (const [name, c] of Object.entries(skin.clips)) {
    clips[name] = { ...c, q: accessorOf(json, bin, c.data).array, J: skin.joints };
  }
  return { geometry: g, inverses, clips, joints: skin.joints, radius: skin.radius, extras: root.extras, triangles: g.index.count / 3 };
}

/** Fetch and read one model, once. Resolves to its template or null; never rejects. */
export function loadScpModel(id) {
  if (!SCP_MODELS[id]) return Promise.resolve(null);
  if (templates.has(id)) return Promise.resolve(templates.get(id));
  if (failed.has(id)) return Promise.resolve(null);
  if (!loader && !(typeof location !== 'undefined' && /^https?:$/.test(location.protocol || ''))) return Promise.resolve(null);
  if (pending.has(id)) return pending.get(id);
  const p = (async () => {
    try {
      let buf;
      if (loader) buf = await loader(scpModelUrl(id), id);
      else {
        const res = await fetchRetry(scpModelUrl(id));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        buf = await res.arrayBuffer();
      }
      const { json } = chunks(buf);
      const rootDef = json.nodes.find((n) => n.name === id);
      if (!rootDef) throw new Error(`${SCP_MODELS[id].file} has no root node called ${id}`);
      let t;
      if (rootDef.extras && rootDef.extras.skin) {
        t = { id, kind: 'rig', ...readRig(buf, id) };
      } else {
        const parsed = parseGLB(buf, { name: SCP_MODELS[id].file, warn: () => {} });
        const root = parsed.scene.getObjectByName(id);
        root.removeFromParent();
        const parts = new Map();
        root.traverse((o) => {
          if (!o.isMesh) return;
          parts.set(o.parent && o.parent !== root ? o.parent.name : o.name, o);
        });
        t = { id, kind: 'static', root, parts, extras: root.userData.extras || rootDef.extras || {}, triangles: parsed.stats.triangles };
      }
      templates.set(id, t);
      return t;
    } catch (e) {
      failed.add(id);
      console.warn(`The ${id} model could not be loaded; the mission keeps its own.`, e);
      return null;
    } finally {
      pending.delete(id);
    }
  })();
  pending.set(id, p);
  return p;
}

export const scpTemplate = (id) => templates.get(id) || null;
export function scpModelStatus() {
  return Object.fromEntries(Object.keys(SCP_MODELS).map((k) => [k, templates.has(k) ? 'ready' : pending.has(k) ? 'loading' : failed.has(k) ? 'failed' : 'idle']));
}

/* ------------------------------------------------------------------ */
/* Materials and instances                                             */
/* ------------------------------------------------------------------ */

/*
 * One vertex-coloured material per look, with a little of its own colour as
 * light (`lift`), like the mission's people: at night under the Site's dying
 * lamps a plain lit material is a black shape. One program for all of them.
 * SCP-682's adds its sway (uSway: amplitude, phase), a wave down its length.
 */
const mats = new Map();
function material(kind, lift) {
  const key = `${kind}|${lift}`;
  if (mats.has(key)) return mats.get(key);
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  m.name = `scp-model|${key}`;
  const sway = kind === 'sway';
  m.userData.sway = sway ? { value: new THREE.Vector2(0, 0) } : null;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLift = { value: lift };
    sh.fragmentShader = 'uniform float uLift;\n' + sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * uLift;'
    );
    if (sway) {
      sh.uniforms.uSway = m.userData.sway;
      sh.vertexShader = 'uniform vec2 uSway;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        // Its head (-z) moves least, its tail (+z) most: the body bends as a reptile's does as it crawls.
        '#include <begin_vertex>\n  transformed.x += uSway.x * sin(transformed.z * 0.62 + uSway.y) * (0.35 + 0.65 * clamp((transformed.z + 5.0) / 10.0, 0.0, 1.0));'
      );
    }
  };
  m.customProgramCacheKey = () => (sway ? 'scp-model-sway' : 'scp-model');
  mats.set(key, m);
  return m;
}

/** A static model as a mesh group sharing the template's geometry. */
function staticInstance(t, lift = 0.12, kind = 'plain') {
  const g = new THREE.Group();
  g.name = `scp:${t.id}`;
  for (const [name, src] of t.parts) {
    const m = new THREE.Mesh(src.geometry, material(kind, lift));
    m.name = name;
    m.position.copy(src.position);
    m.quaternion.copy(src.quaternion);
    m.scale.copy(src.scale);
    m.castShadow = false;
    m.receiveShadow = false;
    g.add(m);
  }
  return g;
}

/*
 * A rigged model: a SkinnedMesh whose bones are flat children of its group,
 * each bone's matrix set every frame from the clip (the file's matrices are
 * already joint -> game frame). Two clips cross-fade over FADE_S.
 */
const FADE_S = 0.45;
function rigInstance(t, lift = 0.12) {
  const g = new THREE.Group();
  g.name = `scp:${t.id}`;
  const bones = [];
  for (let j = 0; j < t.joints; j++) {
    const b = new THREE.Bone();
    b.matrixAutoUpdate = false;
    g.add(b);
    bones.push(b);
  }
  const mesh = new THREE.SkinnedMesh(t.geometry, material('plain', lift));
  mesh.name = 'body';
  mesh.castShadow = false;
  g.add(mesh);
  mesh.bind(new THREE.Skeleton(bones, t.inverses.map((m) => m.clone())), new THREE.Matrix4());
  // Every frame of every clip is inside this (scp.py measured it); no per-frame bounds work.
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), t.radius + 0.5);
  const inst = { t, group: g, mesh, bones, clip: null, time: 0, from: null, fromTime: 0, fade: 1, rate: 1 };
  play(inst, Object.keys(t.clips)[0]);
  poseRig(inst, 0);
  return inst;
}

function play(inst, name, { restart = false } = {}) {
  if (!inst.t.clips[name] || (inst.clip === name && !restart)) return;
  if (inst.clip && inst.clip !== name) {
    inst.from = inst.clip;
    inst.fromTime = inst.time;
    inst.fade = 0;
  }
  inst.clip = name;
  inst.time = 0;
}

const _row = new Float32Array(12);
function sampleClip(c, time, j, out, w) {
  const F = c.frames;
  let f = (time / c.seconds) * (c.loop ? F : F - 1);
  if (c.loop) f = ((f % F) + F) % F;
  else f = Math.max(0, Math.min(F - 1, f));
  const f0 = Math.floor(f);
  const f1 = c.loop ? (f0 + 1) % F : Math.min(F - 1, f0 + 1);
  const u = f - f0;
  const q = c.q;
  const a = (f0 * c.J + j) * 12;
  const b = (f1 * c.J + j) * 12;
  for (let k = 0; k < 12; k++) {
    const v0 = c.lo[k] + (q[a + k] / 65535) * c.span[k];
    const v1 = c.lo[k] + (q[b + k] / 65535) * c.span[k];
    out[k] = out[k] * (1 - w) + (v0 + (v1 - v0) * u) * w;
  }
}

/** Advance a rigged model's clip by dt (seconds of its own time, times its rate) and set its bones. */
function poseRig(inst, dt) {
  const t = inst.t;
  inst.time += dt * inst.rate;
  if (inst.from) {
    inst.fromTime += dt * inst.rate;
    inst.fade = Math.min(1, inst.fade + dt / FADE_S);
    if (inst.fade >= 1) inst.from = null;
  }
  const c = t.clips[inst.clip];
  const p = inst.from ? t.clips[inst.from] : null;
  for (let j = 0; j < t.joints; j++) {
    _row.fill(0);
    if (p) {
      sampleClip(p, inst.fromTime, j, _row, 1);
      sampleClip(c, inst.time, j, _row, inst.fade);
    } else sampleClip(c, inst.time, j, _row, 1);
    const r = _row;
    const b = inst.bones[j];
    b.matrix.set(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11], 0, 0, 0, 1);
    b.matrixWorldNeedsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/* The routes                                                          */
/* ------------------------------------------------------------------ */

/**
 * Each SCP's way from its sector to the end of its route, in the Site's
 * frame (MAP.scp: the yard, the gate, the strip). Away from the people's
 * routes (scp-escape origins(): the gate, the south of the yard between the
 * block and the fence, the annex's west side, the far hut's diagonal) and
 * never into the apron's queue.
 */
export function routes(c) {
  if (!c) return null;
  const Y = c.yard;
  const cz = (Y.z0 + Y.z1) / 2;
  return {
    // Outside the fence, round the north-east corner and down the east side to the snow off the strip's east end.
    'scp-682': [{ x: Y.x1 + 40, z: Y.z0 + 30 }, { x: Y.x1 + 80, z: Y.z0 + 140 }, { x: Y.x1 + 80, z: Y.z1 - 10 }, { x: Y.x1 + 62, z: c.strip.cz - c.strip.halfWidth - 48 }],
    // Inside the east fence, from sector B's mast south to the yard's south-east corner.
    'scp-939': [{ x: Y.x1 - 40, z: Y.z0 + 72 }, { x: Y.x1 - 16, z: Y.z0 + 118 }, { x: Y.x1 - 15, z: cz + 52 }, { x: Y.x1 - 20, z: Y.z1 - 22 }],
    // Sector C, down the west side behind the annex, to the south-west corner.
    'scp-106': [{ x: Y.x0 + 40, z: Y.z0 + 74 }, { x: Y.x0 + 26, z: cz }, { x: Y.x0 + 30, z: Y.z1 - 26 }],
    // Sitting by the west fence, its back to the strip.
    'scp-096': [{ x: Y.x0 + 9, z: cz + 34 }],
    // From behind the main block's east end towards the gate — never closer to it than thirty metres.
    'scp-173': [{ x: c.door.x + 100, z: Y.z1 - 36 }, { x: c.door.x + 66, z: Y.z1 - 14 }, { x: c.gate.x + 32, z: Y.z1 - 7 }],
  };
}

function routeLength(r) {
  let L = 0;
  for (let i = 1; i < r.length; i++) L += Math.hypot(r[i].x - r[i - 1].x, r[i].z - r[i - 1].z);
  return L;
}

/** The point `s` metres along a route, and the way it is heading there. */
export function along(r, s, out = { x: 0, z: 0, hx: 0, hz: -1 }) {
  let left = Math.max(0, s);
  for (let i = 1; i < r.length; i++) {
    const ax = r[i - 1].x;
    const az = r[i - 1].z;
    const L = Math.hypot(r[i].x - ax, r[i].z - az);
    if (left <= L || i === r.length - 1) {
      const u = L > 0 ? Math.min(1, left / L) : 0;
      out.x = ax + (r[i].x - ax) * u;
      out.z = az + (r[i].z - az) * u;
      out.hx = L > 0 ? (r[i].x - ax) / L : 0;
      out.hz = L > 0 ? (r[i].z - az) / L : -1;
      return out;
    }
    left -= L;
  }
  out.x = r[0].x;
  out.z = r[0].z;
  return out;
}

/**
 * Where an SCP should have got to by time `t` (metres along its route): out
 * at its sector's time, at the end when the breach reaches the strip. Pure;
 * the move towards it is capped at the SCP's own pace, and stops near people.
 */
export function wantedProgress(t, outAt, stripAt, length) {
  if (t < outAt) return 0;
  const span = Math.max(1, stripAt - outAt);
  return Math.min(length, (length * (t - outAt)) / span);
}

/* ------------------------------------------------------------------ */
/* The director (one per run)                                          */
/* ------------------------------------------------------------------ */

const _fr = new THREE.Frustum();
const _pm = new THREE.Matrix4();
const _sp = new THREE.Sphere();
const _pt = { x: 0, z: 0, hx: 0, hz: -1 };

function qualityKey() {
  const r = qualityRank();
  return r <= 0 ? 'low' : r === 1 ? 'medium' : 'high';
}

/**
 * Start the models for a run. `api` is scp-escape's: { cfg, group, run, rampOf, sim }.
 * Returns the director scp-escape steps and tears down.
 */
export function startModels(api) {
  const D = {
    api,
    on: scpModelsOn(),
    q: qualityKey(),
    group: new THREE.Group(),
    scps: [],
    posts: [],
    postsPlaced: false,
    gunship: null,
    t: 0,
    disposed: false,
    figuresDressed: new WeakSet(),
  };
  D.group.name = 'lfo-scp-models';
  api.group.add(D.group);
  if (D.on) {
    for (const id of Object.keys(SCP_MODELS)) loadScpModel(id);
  }
  return {
    D,
    step: (dt) => stepModels(D, dt),
    dressCart: (mesh, kind) => dressCart(D, mesh, kind),
    dressFigure: (p, kind, seed) => dressFigure(D, p, kind, seed),
    dispose: () => disposeModels(D),
    state: () => modelsState(D),
  };
}

/* ---- the SCPs ---- */

function makeScp(D, spec, route) {
  const t = templates.get(spec.id);
  if (!t) return null;
  let inst = null;
  let obj;
  if (t.kind === 'rig') {
    inst = rigInstance(t, spec.id === 'scp-096' ? 0.16 : 0.12);
    obj = inst.group;
  } else obj = staticInstance(t, spec.id === 'scp-173' ? 0.16 : 0.1, spec.id === 'scp-682' ? 'sway' : 'plain');
  obj.visible = false;
  D.group.add(obj);
  const s = { spec, id: spec.id, obj, inst, route, length: routeLength(route), s: 0, out: false, held: false, heading: 0, speed: 0, sway: 0, swayPhase: 0, hopAt: 0, mode: 'idle', modeT: 0, lastSeen: -1 };
  along(route, 0, _pt);
  s.heading = Math.atan2(-_pt.hx, -_pt.hz);
  if (spec.id === 'scp-096') {
    // Facing the fence (west), its back to the strip and the people.
    s.heading = Math.atan2(1, 0);
  }
  return s;
}

function nearestPerson(R, x, z) {
  let best = Infinity;
  if (!R) return best;
  for (const w of R.walkers) {
    if (w.state !== 'out' && w.state !== 'turned') continue;
    const d = Math.hypot(w.x - x, w.z - z);
    if (d < best) best = d;
  }
  return best;
}

function onScreen(D, obj, r = 1.6) {
  const cam = D.api.sim && D.api.sim.camera;
  if (!cam) return false;
  // Once a frame (the camera has not moved between the SCPs' turns).
  if (D.frustumAt !== D.t) {
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _fr.setFromProjectionMatrix(_pm);
    D.frustumAt = D.t;
  }
  _sp.center.set(obj.position.x, obj.position.y + 1, obj.position.z);
  _sp.radius = r;
  if (!_fr.intersectsSphere(_sp)) return false;
  return cam.position.distanceTo(_sp.center) < 1500;
}

function stepScp(D, s, R, dt) {
  const sched = R.sched;
  const outAt = sched.sectors[s.spec.sector] ? sched.sectors[s.spec.sector].at : Infinity;
  const lost = R.lost > s.spec.sector || R.t >= outAt;
  if (!lost) {
    s.obj.visible = false;
    return;
  }
  if (!s.out) {
    s.out = true;
    s.obj.visible = true;
    s.outT = R.t;
    if (s.id === 'scp-106') { s.mode = 'rise'; s.modeT = 0; if (s.inst) play(s.inst, 'rise', { restart: true }); }
  }
  const want = wantedProgress(R.t, outAt, sched.stripLostAt, s.length);
  const near = nearestPerson(R, s.obj.position.x, s.obj.position.z);
  s.held = near < (s.spec.hold || HOLD_M);
  let moved = 0;
  if (s.id === 'scp-173') {
    // It moves only while nobody is looking: a hop of a few metres, unseen, and not near anybody.
    const seen = onScreen(D, s.obj, 1.3);
    if (seen) s.lastSeen = R.t;
    if (!seen && !s.held && want - s.s > 0.5 && R.t - s.hopAt > 0.7) {
      const step = Math.min(s.spec.pace, want - s.s);
      s.s += step;
      s.hopAt = R.t;
      moved = step;
    }
  } else if (s.id === 'scp-106') {
    s.modeT += dt;
    const c = s.inst ? s.inst.t.clips : null;
    if (s.mode === 'rise') {
      if (!c || s.modeT >= c.rise.seconds) { s.mode = 'walk'; s.modeT = 0; if (s.inst) play(s.inst, 'walk'); }
    } else if (s.mode === 'walk') {
      // Behind where it should be by more than a stretch of yard: down through the floor, and up again ahead.
      if (want - s.s > 22 && s.modeT > 8 && !s.held) {
        // (Its rising clip, from the end: nothing below may swap it for the walk or the idle this frame.)
        s.mode = 'sink';
        s.modeT = 0;
        if (s.inst) { play(s.inst, 'rise', { restart: true }); s.inst.time = c.rise.seconds; }
      } else {
        if (!s.held && want - s.s > 0.2) {
          const v = Math.min(s.spec.pace, (want - s.s) / dt);
          s.s += v * dt;
          moved = v * dt;
        }
        if (s.inst) play(s.inst, moved > 0 ? 'walk' : 'idle');
      }
    } else if (s.mode === 'sink') {
      // The rising clip run backwards, quicker.
      if (s.inst) s.inst.rate = -1.6;
      if (!c || s.modeT >= c.rise.seconds / 1.6) { s.mode = 'under'; s.modeT = 0; s.obj.visible = false; }
    } else if (s.mode === 'under') {
      if (s.modeT > 3 && !s.held) {
        s.s = Math.max(s.s, want);
        s.mode = 'rise';
        s.modeT = 0;
        s.obj.visible = true;
        if (s.inst) { s.inst.rate = 1; play(s.inst, 'rise', { restart: true }); }
      }
    }
  } else if (s.spec.pace > 0) {
    if (!s.held && want - s.s > 0.05) {
      const v = Math.min(s.spec.pace, (want - s.s) / Math.max(dt, 1e-3));
      s.s += v * dt;
      moved = v * dt;
    }
  }
  s.speed += ((dt > 0 ? moved / dt : 0) - s.speed) * Math.min(1, dt * 3);
  along(s.route, s.s, _pt);
  const gy = heightAt(_pt.x, _pt.z);
  s.obj.position.set(_pt.x, gy, _pt.z);
  if (s.id !== 'scp-096') {
    const h = Math.atan2(-_pt.hx, -_pt.hz);
    let d = h - s.heading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    // 173 turns only when it moves (it is a statue); the others turn at a walking pace.
    s.heading += s.id === 'scp-173' ? (moved > 0 ? d : 0) : Math.sign(d) * Math.min(Math.abs(d), 1.4 * dt);
  }
  s.obj.rotation.y = s.heading;
  if (s.id === 'scp-682') {
    // Ten metres long on the open snow: laid along the slope under it, head to tail, so neither end floats or sinks.
    const fx = -Math.sin(s.heading);
    const fz = -Math.cos(s.heading);
    const hh = heightAt(_pt.x + fx * 4.2, _pt.z + fz * 4.2);
    const ht = heightAt(_pt.x - fx * 4.2, _pt.z - fz * 4.2);
    s.obj.rotation.order = 'YXZ';
    s.obj.rotation.x = Math.atan2(hh - ht, 8.4);
    s.obj.position.y = Math.min(gy, (hh + ht) / 2);
  }
  // The rigs: walk at the pace they are going (the clip's own speed: no sliding feet), idle when still.
  if (s.inst && s.id !== 'scp-106') {
    const c = s.inst.t.clips;
    if (c.walk && s.speed > 0.15 && s.id !== 'scp-096') {
      play(s.inst, 'walk');
      s.inst.rate = Math.max(0.4, Math.min(2.4, s.speed / (c.walk.speed || 1)));
    } else {
      play(s.inst, c.idle ? 'idle' : c.sit ? 'sit' : s.inst.clip);
      s.inst.rate = 1;
    }
  } else if (s.inst && s.mode === 'walk') {
    const c = s.inst.t.clips;
    s.inst.rate = s.speed > 0.15 ? Math.max(0.5, Math.min(1.8, s.speed / (c.walk.speed || 1))) : 1;
  }
  // 682: the sway grows with its pace and dies away when it stops.
  if (s.id === 'scp-682') {
    const mat = s.obj.children[0] && s.obj.children[0].material;
    s.sway += ((s.speed > 0.2 ? 0.22 : 0) - s.sway) * Math.min(1, dt * 1.5);
    s.swayPhase -= s.speed * dt * 0.9;
    if (mat && mat.userData.sway) mat.userData.sway.value.set(s.sway, s.swayPhase);
  }
  if (s.inst && s.obj.visible) {
    // Far off (or not on screen) the bones move less often.
    const cam = D.api.sim && D.api.sim.camera;
    const far = cam ? cam.position.distanceTo(s.obj.position) : 0;
    s.acc = (s.acc || 0) + dt;
    // Off screen, a few times a second (it still keeps its place in the clip); on Low at most 15 times a second.
    let every = far > 900 ? 0.25 : far > 350 ? 0.1 : D.q === 'low' ? 1 / 15 : 0;
    if (every < 0.25 && !onScreen(D, s.obj, 3)) every = 0.25;
    if (s.acc >= every) {
      poseRig(s.inst, s.acc);
      s.acc = 0;
    }
  }
}

/* ---- the posted guards and staff ---- */

/** Points round the ramp foot and at the gate: { kind, x, z, face } — the ramp's from its geometry at the start. */
export function postPoints(c, geom, counts) {
  const out = [];
  if (geom) {
    const bx = geom.foot.x - geom.hinge.x;
    const bz = geom.foot.z - geom.hinge.z;
    const L = Math.hypot(bx, bz) || 1;
    const ax = bx / L; // aft, along the ramp
    const az = bz / L;
    // The Site's side of the ramp (where the people come from): + or - the ramp's right.
    const rx = -az;
    const rz = ax;
    const side = (c.cx - geom.foot.x) * rx + (c.cz - geom.foot.z) * rz >= 0 ? 1 : -1;
    const P = (aft, lat) => ({ x: geom.foot.x + ax * aft + rx * lat * side, z: geom.foot.z + az * aft + rz * lat * side });
    // Guards: one off the far side of the ramp, one beyond the end of the queue on the Site's side, facing out.
    const guards = [P(3, -5.5), P(15, 7.5)];
    for (let i = 0; i < Math.min(counts[0], guards.length); i++) out.push({ kind: 'guard', ...guards[i], face: Math.atan2(-(rx * side * (i ? 1 : -1)), -(rz * side * (i ? 1 : -1))) });
    // Hazmat staff on the far side, by the case waiting to go aboard.
    const suits = [P(6.5, -7.5), P(9.5, -6.2)];
    for (let i = 0; i < Math.min(counts[2], suits.length); i++) out.push({ kind: 'hazmat', ...suits[i], face: Math.atan2(-(geom.foot.x - suits[i].x), -(geom.foot.z - suits[i].z)) });
    out.push({ kind: 'case', ...P(8, -9.2), face: Math.atan2(ax, az) });
  }
  // The gate: a guard either side of the opening, outside the fence, facing the compound.
  const gates = [{ x: c.gate.x - 9, z: c.yard.z1 + 3 }, { x: c.gate.x + 9, z: c.yard.z1 + 3 }];
  for (let i = 0; i < Math.min(counts[1], 2); i++) out.push({ kind: 'guard', ...gates[i], face: Math.atan2(0, 1) });
  return out;
}

function placePosts(D, R) {
  const geom = D.api.rampOf(D.api.sim);
  // The ramp not there yet: try again next frame, for a few seconds (then the gate's guards alone).
  if (!geom && D.t < 3) return false;
  const c = D.api.cfg();
  const pts = postPoints(c, geom, POSTED[D.q] || POSTED.high);
  let seed = 911;
  for (const p of pts) {
    const post = { ...p, obj: null, real: false };
    if (p.kind !== 'case') {
      // The game's own figure until the model is here (and if it never is).
      const f = createPerson({ outfit: p.kind === 'guard' ? 'tactical' : 'sitestaff', seed: seed++, lite: true });
      f.userData.anim = f.userData.anim || { t: 0, walk: 0, run: 0, air: 0, wave: 0, stop: 0, pointL: 0, pointR: 0, hello: 0, phase: 0 };
      posePerson(f, 0.016, { speed: 0 });
      post.obj = f;
      post.fallback = f;
      f.position.set(p.x, heightAt(p.x, p.z), p.z);
      f.rotation.y = p.face;
      D.group.add(f);
    }
    D.posts.push(post);
  }
  D.postsPlaced = true;
  return true;
}

function upgradePosts(D) {
  for (const p of D.posts) {
    if (p.real || !D.on) continue;
    const id = p.kind === 'case' ? 'crate-173' : p.kind;
    const t = templates.get(id);
    if (!t) continue;
    const obj = staticInstance(t, p.kind === 'case' ? 0.08 : 0.2);
    if (p.kind === 'case') {
      obj.scale.setScalar(2.3);
      // The loadmaster's clipboard on its lid.
      const cb = templates.get('clipboard');
      if (cb) {
        const b = staticInstance(cb, 0.25);
        b.position.set(0.02, 1.003, 0.01);
        b.rotation.y = 0.4;
        b.scale.setScalar(1 / 2.3);
        obj.add(b);
      } else if (!failed.has('clipboard')) continue; // wait for it, so the case and its board arrive together
    }
    obj.position.set(p.x, heightAt(p.x, p.z), p.z);
    obj.rotation.y = p.face;
    D.group.add(obj);
    if (p.fallback) {
      D.group.remove(p.fallback);
      disposePerson(p.fallback);
      p.fallback = null;
    }
    p.obj = obj;
    p.real = true;
  }
}

/* ---- the carts and the people's hands ---- */

const HIDE = new THREE.MeshBasicMaterial({ visible: false });
/** The containment case on a sealed cart: uniform, as deep as the cart (0.9 m), so about 2 m tall. */
export const CART_CASE_SCALE = 0.9 / 0.456;
function dressCart(D, mesh, kind) {
  if (!mesh) return;
  const old = mesh.getObjectByName('lfo-case');
  const want = D.on && kind === 'sealed' && templates.get('crate-173');
  // (A cart taken again for another load has had its own box material put back by scp-escape's takeCart.)
  if (old && !want) mesh.remove(old);
  if (want && !old) {
    // The sealed case: the containment case itself on its trolley, the cart's own box hidden under it.
    const o = staticInstance(templates.get('crate-173'), 0.1);
    o.name = 'lfo-case';
    // The cart box is 1.3 x 0.95 x 0.9 about its middle: the case (0.456 square, 1 tall in the file) stands
    // on the ground in its footprint at its own proportions, the cage on its trolley, never squashed.
    o.scale.setScalar(CART_CASE_SCALE);
    o.position.y = -0.475;
    mesh.add(o);
  }
  if (want) mesh.material = HIDE;
}

/** Every other member of the Site's staff carries a clipboard in the right hand. */
function dressFigure(D, p, kind, seed) {
  if (!p || kind !== 'sitestaff' || !D.on || (seed | 0) % 2) return;
  if (p.getObjectByName('lfo-clipboard')) return;
  const t = templates.get('clipboard');
  const rig = p.userData && p.userData.rig;
  if (!t || !rig || !rig.arms) return;
  const arm = rig.arms.find((a) => a.side > 0) || rig.arms[0];
  const b = staticInstance(t, 0.3);
  b.name = 'lfo-clipboard';
  // In the hand at the end of the arm, held upright against the leg, its face out.
  b.position.set(0.02, -0.6, -0.04);
  b.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  arm.arm.add(b);
}

/* ---- the gunship ---- */

function makeGunship(D) {
  const t = templates.get('apache');
  if (!t) return null;
  const body = staticInstance(t, 0.06);
  const piv = (t.extras && t.extras.pivots) || {};
  // Its own rotors out; the game's (blades, blur disc, the anti-strobe cap) on its hubs.
  for (const n of ['rotor', 'tailrotor']) {
    const m = body.getObjectByName(n);
    if (m) m.visible = false;
  }
  let rotor = null;
  try {
    const b = new Builder({ id: 'mtf-gunship' }, {}, { base: '#2c3128', accent: '#2c3128', finish: 'matte' });
    const hub = piv.rotor ? piv.rotor.hub : [0, 3.8, -1.7];
    const tail = piv.tailrotor ? piv.tailrotor.hub : [-0.24, 3.6, 7.66];
    b.addRotor({
      hub, radius: 7.315, blades: 4, chord: 0.53, droop: -0.03, cone: 0.045, tilt: 0, hz: 4.82, dir: 1, hubR: 0.32, rootCut: 0.68,
      tail: { at: tail, radius: 1.395, blades: 4, chord: 0.25, angles: [0, 0.96, Math.PI, Math.PI + 0.96] },
    });
    rotor = b.rotors[0];
    for (const c of b.root.children.slice()) body.add(c);
    rotor.blades.visible = false;
    rotor.disc.visible = true;
    rotor.disc.userData.opacity = 1;
    if (rotor.tailBlades) rotor.tailBlades.visible = false;
    if (rotor.tailDisc) { rotor.tailDisc.visible = true; rotor.tailDisc.userData.opacity = 1; }
  } catch (e) {
    // No rotor of the game's: its own, standing still, rather than none.
    for (const n of ['rotor', 'tailrotor']) {
      const m = body.getObjectByName(n);
      if (m) m.visible = true;
    }
    rotor = null;
  }
  body.name = 'lfo-gunship';
  D.group.add(body);
  return { obj: body, rotor, ang: Math.random() * Math.PI * 2, leaving: false, gone: false, vx: 0, vz: 0, bank: 0 };
}

/** Where the orbit puts it at angle `a` (anticlockwise seen from above), and its heading there. Pure. */
export function orbitPoint(cx, cz, a, r = ORBIT.r) {
  const x = cx + Math.cos(a) * r;
  const z = cz + Math.sin(a) * r;
  // Moving in +a: velocity (-sin a, cos a). The game's heading convention: rotation.y = atan2(-vx, -vz).
  return { x, z, ry: Math.atan2(Math.sin(a), -Math.cos(a)) };
}

function stepGunship(D, R, dt) {
  const G = D.gunship;
  if (!G || G.gone) return;
  const c = D.api.cfg();
  const o = G.obj;
  if (!G.leaving && R.stripLost) {
    // The breach is at the strip: the task force goes, away to the south-west, and is gone.
    G.leaving = true;
    const ry = o.rotation.y;
    G.vx = -Math.sin(ry) * ORBIT.speed;
    G.vz = -Math.cos(ry) * ORBIT.speed;
  }
  if (!G.leaving) {
    G.ang += (ORBIT.speed / ORBIT.r) * dt;
    const p = orbitPoint(c.cx, c.cz, G.ang);
    const gy = heightAt(c.cx, c.cz);
    o.position.set(p.x, gy + ORBIT.agl, p.z);
    // A right-hand circuit (the centre is on its right): right side down. +z rolls the right side up.
    G.bank = -Math.atan((ORBIT.speed * ORBIT.speed) / (ORBIT.r * 9.81));
    o.rotation.set(0, 0, 0);
    o.rotation.order = 'YXZ';
    o.rotation.y = p.ry;
    o.rotation.x = -0.06; // nose a little down, in forward flight
    o.rotation.z = G.bank;
  } else {
    // Turn to the south-west over a few seconds, speeding up, wings level.
    const want = Math.atan2(1, -1); // south-west: velocity (-x, +z), rotation.y = atan2(-vx, -vz)
    let d = want - o.rotation.y;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    o.rotation.y += Math.sign(d) * Math.min(Math.abs(d), 0.25 * dt);
    G.bank += ((Math.abs(d) > 0.05 ? Math.sign(d) * 0.3 : 0) - G.bank) * Math.min(1, dt);
    o.rotation.z = G.bank;
    const sp = Math.min(ORBIT.leaveSpeed, Math.hypot(G.vx, G.vz) + 4 * dt);
    G.vx = -Math.sin(o.rotation.y) * sp;
    G.vz = -Math.cos(o.rotation.y) * sp;
    o.position.x += G.vx * dt;
    o.position.z += G.vz * dt;
    o.position.y += 3 * dt;
    if (Math.hypot(o.position.x - c.cx, o.position.z - c.cz) > 6500) {
      G.gone = true;
      o.visible = false;
    }
  }
  if (G.rotor) {
    const Rr = G.rotor;
    const w = Rr.hz * Math.PI * 2;
    // The game's anti-strobe cap (civil-build visRev: 9 / blades turns a second at most).
    Rr.spin.rotation.y = (Rr.spin.rotation.y + Math.min(w, (9 / 4) * Math.PI * 2) * dt) % (Math.PI * 2);
    if (Rr.tail) Rr.tail.rotation.x = (Rr.tail.rotation.x + Math.min(w * 5.2, (9 / 4) * Math.PI * 2) * dt) % (Math.PI * 2);
  }
}

/* ---- the frame ---- */

function stepModels(D, dt) {
  if (D.disposed) return;
  const R = D.api.run();
  if (!R) return;
  D.t += dt;
  if (!D.postsPlaced) placePosts(D, R);
  if (!D.on) return;
  upgradePosts(D);
  // The SCPs, as each model arrives.
  if (D.scps.length < BREACH.length) {
    const rts = routes(D.api.cfg());
    for (const spec of BREACH) {
      if (D.scps.some((s) => s.id === spec.id) || !templates.get(spec.id)) continue;
      const s = makeScp(D, spec, rts[spec.id]);
      if (s) D.scps.push(s);
    }
  }
  for (const s of D.scps) stepScp(D, s, R, dt);
  // The carts out now (a pooled cart changes load between runs of it) and the staff's hands.
  for (const c of R.carts) if (c.cartRef && c.state === 'out') dressCart(D, c.cartRef.mesh, c.kind);
  for (let i = 0; i < R.pool.length; i++) if (R.pool[i].busy) dressFigure(D, R.pool[i].p, R.pool[i].kind, i);
  if (!D.gunship && templates.get('apache') && !R.stripLost) D.gunship = makeGunship(D);
  stepGunship(D, R, dt);
}

function disposeModels(D) {
  if (D.disposed) return;
  D.disposed = true;
  for (const p of D.posts) if (p.fallback) disposePerson(p.fallback);
  if (D.group.parent) D.group.parent.remove(D.group);
  // Geometry and materials are the templates' and stay for the next run. What
  // this run made for itself goes with it: each rig's bone texture, and the
  // gunship's rotor (the game's, built for it), so restarting leaks nothing.
  for (const s of D.scps) if (s.inst && s.inst.mesh.skeleton) s.inst.mesh.skeleton.dispose();
  if (D.gunship) {
    const kept = new Set(templates.get('apache') ? [...templates.get('apache').parts.values()].map((m) => m.geometry) : []);
    const ours = new Set(mats.values());
    D.gunship.obj.traverse((o) => {
      if (!o.isMesh || kept.has(o.geometry)) return;
      o.geometry.dispose();
      for (const m of [].concat(o.material)) if (m && !ours.has(m)) m.dispose();
    });
  }
}

function modelsState(D) {
  return {
    on: D.on,
    quality: D.q,
    status: scpModelStatus(),
    scps: D.scps.map((s) => ({ id: s.id, out: s.out, visible: s.obj.visible, s: +s.s.toFixed(2), length: +s.length.toFixed(1), held: s.held, x: s.obj.position.x, y: s.obj.position.y, z: s.obj.position.z, clip: s.inst ? s.inst.clip : null, mode: s.mode })),
    posts: D.posts.map((p) => ({ kind: p.kind, real: p.real, x: p.x, z: p.z })),
    gunship: D.gunship ? { x: D.gunship.obj.position.x, y: D.gunship.obj.position.y, z: D.gunship.obj.position.z, leaving: D.gunship.leaving, gone: D.gunship.gone, rotor: !!D.gunship.rotor } : null,
  };
}
