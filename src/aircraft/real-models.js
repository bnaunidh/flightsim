/**
 * REAL MODELS: downloaded airframes (CC BY 4.0, credited in the Credits and
 * assets/models/LICENSES.md) worn over the game's own aeroplanes.
 *
 * The game's procedural model of each type is still built, in full, every
 * time: it is what flies (gear points, strike points, the camera frame, the
 * cockpit cut-outs, the breakup pieces, the doors, the lamps all read it).
 * What this file does is put a better-looking SKIN over it once the file for
 * that type has arrived, and hide the procedural outside surfaces under it —
 * moved to an unused render layer, not made invisible, so nothing the
 * procedural model does to its own parts is disturbed. Its landing gear, its
 * doors and its lamps stay in view: they move, and the downloaded models'
 * own gear (static, at its own lengths) was left out of the files.
 *
 * The skin steps aside, and the procedural model is drawn whole again:
 *   - from inside (the cockpit view, a seat in the cabin): the flight deck,
 *     its window frames and its cut-outs are the procedural model's;
 *   - the moment the airframe takes any damage, and for the rest of that
 *     flight: the breakup pieces are the procedural model's sections, so the
 *     wreck is drawn in them from the first frame of the crash;
 *   - if the file cannot be had (offline before it was ever seen, a server
 *     error, a phone short of memory, ?realmodels=off): then it simply never
 *     arrives, and nobody can tell anything was meant to.
 *
 * PAINT. The files carry no images at all (tools/real-models/process.py
 * throws every source texture away, real airline liveries included). The
 * fuselage is painted at run time with the SAME livery canvas the procedural
 * model wears (fleet/extra/airliner-kit.js liveryTexture), mapped by the same
 * (z, y) -> (u, v) the procedural skin uses, plus the cabin windows, the
 * flight-deck panes, the registration and the airline's name drawn into a
 * copy of it — the left side's half and the right side's half, so the words
 * read the right way round from both. The fin takes the tail colour, the
 * cowls the airline's cowl colour, the wings the wing paint.
 *
 * LOADING is lazy: a type's file is fetched the first time that type is
 * picked, spawned for the player or shown in the hangar (createAircraftModel
 * with { realModel: true }). Anything else built of a type whose file is
 * already in memory wears it too — except on Low, where only the player's
 * own aeroplane and the hangar's do. Never in the service worker's install
 * list; sw.js keeps a copy of each once fetched (runtime cache), so a type
 * seen once flies in its real skin offline.
 */

import * as THREE from '../vendor/three.module.js';
import { parseGLB } from '../vehicles/glb.js';
import { textureTier } from '../render/textures.js';

/**
 * Every real model, by roster id. `credit` is the CC BY attribution as the
 * Credits screen prints it; tests/features/real-models.mjs holds the files to
 * these (scale, roles, no images, the credit in the file's own extras).
 */
export const REAL_MODELS = {
  belugaxl: { file: 'belugaxl.glb', title: 'Airbus_beluga_xl', author: 'rylanmorris (@darkadoo)', url: 'https://sketchfab.com/3d-models/4aaa48591b434701966f95f75f7651ef' },
  a321: { file: 'a321.glb', title: 'Airbus a321-271nx', author: 'piggyrockstar15', url: 'https://sketchfab.com/3d-models/ad5ce46a9082436d9049718f838f6ace' },
  b737: { file: 'b737.glb', title: '737 MAX Lion Air', author: 'Sofyan Kurniawan (@sofyankurniawan)', url: 'https://sketchfab.com/3d-models/2747cad8b4c64122abe992c9ad1e8bd1' },
  b787: { file: 'b787.glb', title: 'Boeing 787-9', author: 'Nobilis 2 (@nobilishornet2)', url: 'https://sketchfab.com/3d-models/b6711e2e698e4e469675c1154a50b7a3' },
  a350: { file: 'a350.glb', title: 'Airbus A350', author: 'jhag (@jhag), based on the model by paperscan', url: 'https://sketchfab.com/3d-models/cfa2836ead8c4278a199a7d34a87f02e' },
  b777: { file: 'b777.glb', title: 'Boeing 777 Airplane', author: 'K-Sto Creations (@K_StoCreations)', url: 'https://sketchfab.com/3d-models/43847f1a45ff43b180955dfd0cce3f19' },
  a380: { file: 'a380.glb', title: 'Airbus A380', author: 'Brout (@davidbroutian)', url: 'https://sketchfab.com/3d-models/98d21f9c8104445f814cef47ef992889' },
  b747: { file: 'b747.glb', title: 'Boeing 747-8i', author: 'AF267 (@jsong.js.us), GeoFS team', url: 'https://sketchfab.com/3d-models/cd1977bedc32412fa1ce2cda23520b84' },
  q400: { file: 'q400.glb', title: 'Bombardier Dash Q400 - Qantas Link', author: 'Sofyan Kurniawan (@sofyankurniawan)', url: 'https://sketchfab.com/3d-models/5b13a73be7d74161a3a9f9ce982a8345' },
  a10: { file: 'a10.glb', title: 'A-10 Thunderbolt II', author: 'AIRMAN Magazine (@AIRMANMagazine)', url: 'https://sketchfab.com/3d-models/9521ff6ba5d448958ea45a89e94ab23d' },
  // Not Concorde: its download has an airline's titles and tail stripes MODELLED into the
  // airframe's geometry (not a texture), so no repaint can take them off. It keeps the game's own.
};

/** Only the ids whose files actually shipped (the test checks every one exists). */
export const realModelIds = () => Object.keys(REAL_MODELS);

/* ------------------------------------------------------------- loading -- */

const templates = new Map(); // id -> { root, extras }
const status = new Map(); // id -> 'loading' | 'ready' | 'failed'
const failedAt = new Map();
const pending = new Map();
let enabled = true;
let loader = null; // tests: (url, id) => ArrayBuffer

/** Switch real models off (or back on) for aeroplanes built from now on. */
export function setRealModels(on) {
  enabled = !!on;
}
export const realModelsOn = () => enabled && !offByUrl() && !shortOfMemory();
/** Tests: read the files off disk instead of fetching them. */
export function setRealModelLoader(fn) {
  loader = fn;
}

function offByUrl() {
  try {
    return typeof location !== 'undefined' && /[?&]realmodels=off\b/.test(location.search || '');
  } catch (e) {
    return false;
  }
}
/** A device that says it has 2 GB or less keeps the procedural models (navigator.deviceMemory, Chrome). */
function shortOfMemory() {
  try {
    const m = typeof navigator !== 'undefined' ? navigator.deviceMemory : undefined;
    return Number.isFinite(m) && m <= 2;
  } catch (e) {
    return false;
  }
}

export function realModelUrl(id) {
  return new URL(`../../assets/models/real/${REAL_MODELS[id].file}`, import.meta.url).href;
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.arrayBuffer();
}

/** Fetch and parse one type's file, once. Resolves to the template or null; never rejects. */
export function loadRealModel(id) {
  if (!REAL_MODELS[id]) return Promise.resolve(null);
  if (templates.has(id)) return Promise.resolve(templates.get(id));
  if (pending.has(id)) return pending.get(id);
  // A failure is not retried for a minute: a flaky school network gets
  // another go later, an offline device does not hammer the network.
  const failed = failedAt.get(id);
  if (failed && now() - failed < 60000) return Promise.resolve(null);
  status.set(id, 'loading');
  const p = (async () => {
    try {
      const buf = await (loader || fetchBuffer)(realModelUrl(id), id);
      const parsed = parseGLB(buf, { name: REAL_MODELS[id].file, warn: () => {} });
      const root = parsed.scene.getObjectByName(id);
      if (!root) throw new Error(`${REAL_MODELS[id].file} has no root node called ${id}`);
      root.removeFromParent();
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
      });
      const t = { root, extras: root.userData.extras || {}, triangles: parsed.stats.triangles, uv: false };
      templates.set(id, t);
      status.set(id, 'ready');
      return t;
    } catch (e) {
      status.set(id, 'failed');
      failedAt.set(id, now());
      console.warn(`The real ${id} model could not be loaded; keeping the built-in one.`, e);
      return null;
    } finally {
      pending.delete(id);
    }
  })();
  pending.set(id, p);
  return p;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function realModelStatus(id) {
  return id ? status.get(id) || 'idle' : Object.fromEntries([...Object.keys(REAL_MODELS)].map((k) => [k, status.get(k) || 'idle']));
}
export const realModelReady = (id) => templates.has(id);

/* ------------------------------------------------------------ dressing -- */

/**
 * Called by model-adapter for every fleet-drawn aeroplane, right after it is
 * built. Puts the skin on now if the file is here, or when it arrives (for
 * the player's and the hangar's own: opts.realModel), or not at all.
 */
export function wearRealModel(model, type, opts = {}) {
  const id = type && type.id;
  if (!id || !REAL_MODELS[id] || !model || !model.userData || !model.userData.fleetBridge) return false;
  if (!realModelsOn()) return false;
  const own = opts.realModel === true;
  if (!own && textureTier() === 'low') return false;
  const t = templates.get(id);
  if (t) return dress(model, id, t);
  if (!own) return false;
  model.userData.realModel = { id, state: 'loading' };
  loadRealModel(id).then((tpl) => {
    const rm = model.userData.realModel;
    if (!tpl || !rm || rm.dead) {
      if (rm) rm.state = tpl ? 'dropped' : 'failed';
      return;
    }
    dress(model, id, tpl);
  });
  return true;
}

/** The procedural parts that stay in view under a real skin: the moving undercarriage, the doors, the heat haze. */
// Spoilers and slats are drawn only while deployed (the procedural model hides them otherwise), so they stay too.
const KEEP = /landing gear|bogie|gear leg door|^door |heat haze|twin tyres|tyres and hubs|^axle$|oleo|propeller|spinner|rocket pod|missile|bomb|weapon|pylon store|spoilers|slats|leading edge slat/i;
/** Flaps are always drawn by the procedural model; under a real skin, only once they are out. */
const FLAP = /^(inboard |outboard |fowler |trailing edge )?flaps?$/i;
/** Render layer the hidden procedural surfaces go to (nothing renders it). */
const HIDDEN_LAYER = 31;

function keepsOwn(o, top) {
  for (let n = o; n && n !== top; n = n.parent) if (KEEP.test(n.name || '')) return true;
  return false;
}

function dress(model, id, tpl) {
  const ud = model.userData;
  // An airliner brings its livery's map (fleet/extra/airliners.js realPaint); anything else is
  // painted in its own materials' colours (the A-10's greys).
  const paint = ud.realPaint || null;
  if (ud.realSkin) return false;
  const airframe = model.children.find((c) => c.isGroup && c.name === model.name) || model.children[0];
  if (!airframe) return false;
  const skin = tpl.root.clone();
  skin.name = 'Real model';
  skin.userData = { realModel: id };
  if (paint && !tpl.uv) {
    skinUVs(tpl.root, paint);
    tpl.uv = true;
  }
  const mats = paint ? materialsFor(model, paint, id) : plainMaterialsFor(model);
  skin.traverse((o) => {
    if (!o.isMesh) return;
    const role = o.parent && o.parent !== skin ? o.parent.name : o.name;
    const m = mats[role] || mats.wing;
    o.material = m;
    o.castShadow = !m.transparent;
    o.receiveShadow = true;
  });
  // What goes under it.
  const hidden = [];
  const flaps = [];
  airframe.traverse((o) => {
    if (!(o.isMesh || o.isInstancedMesh) || o.isSprite) return;
    if (keepsOwn(o, airframe)) return;
    hidden.push([o, o.layers.mask]);
    for (let n = o; n && n !== airframe; n = n.parent) {
      if (FLAP.test(n.name || '')) {
        flaps.push(o);
        break;
      }
    }
  });
  model.add(skin);
  const rm = { id, state: 'on', skin, hidden, flaps, flapsOut: false, on: false, struck: false, inside: false, dead: false };
  ud.realModel = rm;
  ud.realSkin = skin;
  hookDamage(model, rm);
  hookUpdate(model, rm);
  setSkin(rm, true);
  // Whoever built it may want to know (the hangar dims and silhouettes its own).
  if (typeof ud.onRealSkin === 'function') {
    try {
      ud.onRealSkin(skin);
    } catch (e) {
      /* the skin is on either way */
    }
  }
  return true;
}

/** Skin on: the procedural surfaces to the hidden layer. Off: back where they were. */
function setSkin(rm, on) {
  if (rm.on === on) return;
  rm.on = on;
  rm.flapsOut = false;
  rm.skin.visible = on;
  for (const [o, mask] of rm.hidden) {
    if (on) o.layers.set(HIDDEN_LAYER);
    else o.layers.mask = mask;
  }
}

/** Any damage hands the airframe back to the procedural model for the rest of the flight. */
function hookDamage(model, rm) {
  const ud = model.userData;
  for (const k of ['impact', 'strike', 'damagePart', 'beginCrash', 'applyCrashImpulse', 'wingtipStrike', 'rampStrike']) {
    const fn = ud[k];
    if (typeof fn !== 'function') continue;
    ud[k] = function (...args) {
      rm.struck = true;
      setSkin(rm, false);
      return fn.apply(this, args);
    };
  }
  const reset = ud.resetDamage;
  if (typeof reset === 'function') {
    ud.resetDamage = function (...args) {
      const out = reset.apply(this, args);
      rm.struck = false;
      return out;
    };
  }
  const dispose = ud.dispose;
  ud.dispose = function (...args) {
    rm.dead = true;
    return typeof dispose === 'function' ? dispose.apply(this, args) : undefined;
  };
}

const _cam = new THREE.Vector3();
let viewCamera = null;
/** main.js: the camera the picture is drawn from, for the from-inside test. */
export function setRealModelCamera(camera) {
  viewCamera = camera || null;
}

/** main.js, each frame: the player is in the seat (no lag on switching to the cockpit view). */
export function realModelInterior(model, inside) {
  const rm = model && model.userData && model.userData.realModel;
  if (!rm || !rm.skin) return;
  rm.inside = !!inside;
  setSkin(rm, wants(model, rm, null));
}

function cameraInside(model) {
  // The hangar's podium is its own little world (it says so by listening for the skin).
  if (typeof model.userData.onRealSkin === 'function') return false;
  const cam = model.userData.gameCamera || viewCamera;
  const f = model.userData.fuselage;
  if (!cam || !f) return false;
  model.worldToLocal(_cam.setFromMatrixPosition(cam.matrixWorld));
  const m = 0.4;
  return _cam.z > f.nose - m && _cam.z < f.tail + m && Math.abs(_cam.x) < f.halfWidth + m && _cam.y > f.bottom - m && _cam.y < f.top + m;
}

function wants(model, rm, ac) {
  const ud = model.userData;
  if (rm.struck || ud.gameCrash || ud.crashBody || ud.crashRetired || ud.hullDriven) return false;
  if (ac && ac.crashed) return false;
  if (rm.inside) return false;
  return !cameraInside(model);
}

function hookUpdate(model, rm) {
  const ud = model.userData;
  const inner = ud.update;
  ud.update = function (dt, ac = {}, weather = {}) {
    const out = inner.call(this, dt, ac, weather);
    setSkin(rm, wants(model, rm, ac));
    // The flaps, once they are out, drawn by the procedural model below the real wing.
    const flapsOut = rm.on && (ac.flaps || 0) > 0.02;
    if (flapsOut !== rm.flapsOut) {
      rm.flapsOut = flapsOut;
      for (const o of rm.flaps) {
        if (flapsOut) o.layers.set(0);
        else if (rm.on) o.layers.set(HIDDEN_LAYER);
      }
    }
    return out;
  };
}

/* --------------------------------------------------------------- paint -- */

/**
 * The fuselage's texture coordinates, once per type (they depend on the
 * type's livery map, never on the livery): u along the body exactly as the
 * procedural skin's, v round it from the same (z, y) -> v, put in the top
 * half of the texture for the left side and the bottom half for the right.
 */
function skinUVs(root, paint) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const role = o.parent && o.parent !== root ? o.parent.name : o.name;
    if (role !== 'skin_l' && role !== 'skin_r') return;
    const g = o.geometry;
    const p = g.attributes.position;
    const uv = new Float32Array(p.count * 2);
    const top = role === 'skin_l';
    // On a hump (the 747's upper deck, the Beluga's bubble) the paint is the hump's own band.
    const hump = paint.hump && paint.vHump && paint.hull ? paint.hump : null;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i);
      const y = p.getY(i);
      let u = paint.along(z);
      const onHump = hump && z > hump.zMin && z < hump.zMax && y > paint.hull.topAt(z) - 0.15;
      let v = onHump ? paint.vHump(z, y) : paint.vAt(z, y);
      if (!Number.isFinite(u)) u = 0;
      if (!Number.isFinite(v)) v = y > 0 ? 1 : 0;
      u = Math.min(1, Math.max(0, u));
      v = Math.min(1, Math.max(0, v));
      uv[i * 2] = u;
      uv[i * 2 + 1] = top ? 0.5 + 0.5 * v : 0.5 * v;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  });
}

const painted = new Map(); // livery texture name + type -> CanvasTexture, least recently used first
const PAINTED_KEEP = 8;
let paintedTier = null;

/**
 * The livery canvas, twice (left side above, right side below), with the
 * windows, the flight-deck panes, the number and the name drawn in. Cached
 * per livery texture: every aeroplane of a type in one paint shares it.
 */
function paintedSkin(paint, id) {
  const src = paint.texture;
  const img = src && src.image;
  const tier = textureTier();
  if (paintedTier !== tier) {
    for (const t of painted.values()) t.dispose();
    painted.clear();
    paintedTier = tier;
  }
  const key = `${id}|${src && src.name}|${src && src.uuid}`;
  if (painted.has(key)) {
    // Most recently used last (the eviction below takes the first).
    const t = painted.get(key);
    painted.delete(key);
    painted.set(key, t);
    return t;
  }
  let g = null;
  let canvas = null;
  const W = (img && img.width) || 0;
  const H = (img && img.height) || 0;
  try {
    if (W && H && typeof document !== 'undefined') {
      canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H * 2;
      g = canvas.getContext && canvas.getContext('2d');
    }
  } catch (e) {
    g = null;
  }
  if (!g || typeof g.drawImage !== 'function') return src; // no canvas (node): the plain livery
  g.drawImage(img, 0, 0);
  g.drawImage(img, 0, H);
  const U = (z) => paint.along(z) * W;
  const V = (z, y, vAt = paint.vAt) => (1 - vAt(z, y)) * H;
  for (const [half, mirror] of [[0, false], [H, true]]) {
    g.save();
    g.beginPath();
    g.rect(0, half, W, H);
    g.clip();
    g.translate(0, half);
    // The flight deck's panes: dark glass in a black frame.
    for (const pane of paint.panes || []) {
      if (pane.side !== 'right') continue;
      const pts = pane.corners.map(([, y, z]) => [U(z), V(z, y)]);
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fillStyle = '#121a21';
      g.fill();
      g.lineWidth = Math.max(1.5, W / 1200);
      g.strokeStyle = '#06090c';
      g.stroke();
    }
    // The cabin windows.
    for (const row of paint.windows || []) {
      const vAt = row.deck === 'upper' && paint.vHump ? paint.vHump : paint.vAt;
      const count = row.count ?? Math.floor((row.z1 - row.z0) / row.pitch) + 1;
      for (let i = 0; i < count; i++) {
        const z = count === 1 ? (row.z0 + row.z1) / 2 : row.z0 + ((row.z1 - row.z0) * i) / (count - 1);
        if ((row.skip || []).some(([a, b]) => z > a && z < b)) continue;
        const x0 = U(z - row.w / 2);
        const x1 = U(z + row.w / 2);
        const y0 = V(z, row.y + row.ht / 2, vAt);
        const y1 = V(z, row.y - row.ht / 2, vAt);
        const w = Math.max(1, x1 - x0);
        const h = Math.max(1, y1 - y0);
        const r = Math.min(w, h) * 0.45;
        g.fillStyle = '#1a232b';
        roundRect(g, x0, y0, w, h, r);
        g.fill();
        g.fillStyle = 'rgba(160,190,210,0.25)';
        roundRect(g, x0 + w * 0.15, y0 + h * 0.1, w * 0.35, h * 0.35, r * 0.5);
        g.fill();
      }
    }
    // The number and the name: as painted, read left to right from either side.
    for (const d of paint.decals || []) {
      const di = d.texture && d.texture.image;
      if (!di) continue;
      const x0 = U(d.z - d.w / 2);
      const x1 = U(d.z + d.w / 2);
      const vAt = d.hump && paint.vHump ? paint.vHump : paint.vAt;
      const y0 = V(d.z, d.y + d.h / 2, vAt);
      const y1 = V(d.z, d.y - d.h / 2, vAt);
      try {
        if (mirror && d.mirror !== false) {
          g.save();
          g.translate(x1, 0);
          g.scale(-1, 1);
          g.drawImage(di, 0, y0, x1 - x0, y1 - y0);
          g.restore();
        } else g.drawImage(di, x0, y0, x1 - x0, y1 - y0);
      } catch (e) {
        /* a decal that will not draw is left off */
      }
    }
    g.restore();
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = src.anisotropy || 4;
  t.name = `real-skin|${key}`;
  painted.set(key, t);
  // A few at a time on the card: the oldest gives its GPU copy back. Nothing
  // breaks if an aeroplane still wears it -- three uploads it again if drawn.
  while (painted.size > PAINTED_KEEP) {
    const [k0, t0] = painted.entries().next().value;
    painted.delete(k0);
    t0.dispose();
  }
  return t;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

const averages = new Map();
/** A texture's average colour (the wing paint is a canvas of panel lines on one colour). */
function averageOf(tex, fallback) {
  const img = tex && tex.image;
  if (!img) return new THREE.Color(fallback);
  if (averages.has(tex.uuid)) return averages.get(tex.uuid).clone();
  let c = new THREE.Color(fallback);
  try {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 8;
    const g = cv.getContext('2d');
    g.drawImage(img, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data;
    let r = 0;
    let gg = 0;
    let b = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      gg += d[i + 1];
      b += d[i + 2];
    }
    const n = d.length / 4;
    if (n && r + gg + b > 0) c = new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
  } catch (e) {
    /* no canvas: the fallback */
  }
  averages.set(tex.uuid, c);
  return c.clone();
}

/** The procedural model's own materials, found by name, re-dressed for the skin's roles. */
function materialsFor(model, paint, id) {
  const byName = new Map();
  const byMesh = new Map();
  model.traverse((o) => {
    if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
    if (!byName.has(o.material.name)) byName.set(o.material.name, o.material);
    if (!byMesh.has(o.name)) byMesh.set(o.name, o.material);
  });
  const own = (m) => (typeof model.userData.ownMaterial === 'function' ? model.userData.ownMaterial(m) : m);
  const plain = (m) => {
    m.polygonOffset = false;
    m.side = THREE.FrontSide;
    return m;
  };
  const from = (name, fallback) => byName.get(name) || null;
  const std = (props) => own(new THREE.MeshStandardMaterial(props));

  const liv = from('Airliner_livery');
  const skin = liv ? own(plain(liv.clone())) : std({ color: 0xf4f6f8, roughness: 0.4, metalness: 0.1 });
  skin.map = paintedSkin(paint, id);
  skin.name = 'Real_livery';
  skin.needsUpdate = true;

  const finSrc = byMesh.get('Painted fin') || from('Aircraft_livery_accent');
  const fin = finSrc ? own(plain(finSrc.clone())) : std({ color: paint.tail ?? paint.accent ?? 0x1f4fa8 });
  fin.name = 'Real_fin';

  const wingSrc = from('Aircraft_wing');
  const wing = wingSrc ? own(plain(wingSrc.clone())) : std({ color: 0xd0d4d9, roughness: 0.6, metalness: 0.15 });
  if (wing.map) {
    // The wing paint's own colour, less its trim: a scheme's accent on a winglet
    // or a leading edge tinted the average, and a whole wing came out green.
    const avg = averageOf(wing.map, '#d0d4d9');
    const lum = 0.2126 * avg.r + 0.7152 * avg.g + 0.0722 * avg.b;
    wing.color = avg.lerp(new THREE.Color(lum, lum, lum), 0.85);
    wing.map = null;
  }
  wing.name = 'Real_wing';

  const cowlSrc = from('Airliner_cowl') || from('Airliner_nacelle');
  const cowl = cowlSrc ? own(plain(cowlSrc.clone())) : std({ color: 0xf0f2f4, roughness: 0.35, metalness: 0.12 });
  cowl.map = null;
  cowl.color = new THREE.Color(paint.cowl || paint.base || '#f0f2f4');
  cowl.name = 'Real_cowl';

  const glassSrc = from('Airliner_flight_deck_glass');
  const glass = glassSrc ? own(plain(glassSrc.clone())) : std({ color: 0x0e161c, roughness: 0.05, metalness: 0.1 });
  const pick = (name, fb) => from(name) || std(fb);
  const dark = pick('Aircraft_dark_hardware', { color: 0x222a2d, roughness: 0.57, metalness: 0.3 });
  return {
    skin_l: skin,
    skin_r: skin,
    fin,
    wing,
    cowl,
    lip: pick('Airliner_intake_lip', { color: 0xc9ced3, roughness: 0.22, metalness: 0.92 }),
    duct: pick('Airliner_duct', { color: 0x2a3036, roughness: 0.6, metalness: 0.35 }),
    core: pick('Airliner_core_cowl', { color: 0x8d949a, roughness: 0.36, metalness: 0.7 }),
    metal: pick('Airliner_core_cowl', { color: 0x8d949a, roughness: 0.36, metalness: 0.7 }),
    glass,
    window: glass,
    dark,
    prop: dark,
  };
}

/**
 * An aeroplane without a livery map (the A-10): each part in the flat colour
 * of the procedural part it stands for -- the skin's, the wing's, the tail's
 * paint averaged off their maps -- and the procedural glazing, nozzles and
 * dark hardware as they are.
 */
function plainMaterialsFor(model) {
  const byName = new Map();
  model.traverse((o) => {
    if (o.isMesh && o.material && !Array.isArray(o.material) && !byName.has(o.material.name)) byName.set(o.material.name, o.material);
  });
  const own = (m) => (typeof model.userData.ownMaterial === 'function' ? model.userData.ownMaterial(m) : m);
  const flat = (name, fallback) => {
    const src = byName.get(name);
    const m = own(src ? src.clone() : new THREE.MeshStandardMaterial({ color: fallback, roughness: 0.6, metalness: 0.2 }));
    if (m.map) {
      m.color = averageOf(m.map, fallback);
      m.map = null;
    }
    m.polygonOffset = false;
    m.side = THREE.FrontSide;
    m.name = `Real_${name}`;
    return m;
  };
  const skin = flat('Aircraft_skin', '#7e868d');
  const wing = flat('Aircraft_wing', '#7e868d');
  const fin = flat('Aircraft_tail', '#7e868d');
  const pick = (name, fb) => byName.get(name) || own(new THREE.MeshStandardMaterial(fb));
  const dark = pick('Aircraft_dark_hardware', { color: 0x222a2d, roughness: 0.57, metalness: 0.3 });
  const glazing = byName.get('Aircraft_reflective_glazing') || byName.get('Aircraft_glass') || byName.get('Airliner_flight_deck_glass');
  const glass = glazing ? own(Object.assign(glazing.clone(), { polygonOffset: false, side: THREE.FrontSide })) : own(new THREE.MeshStandardMaterial({ color: 0x173340, roughness: 0.1, metalness: 0.3 }));
  const core = pick('Aircraft_hot_nozzle', { color: 0x3b332c, roughness: 0.5, metalness: 0.6 });
  return { skin_l: skin, skin_r: skin, fin, wing, cowl: skin, lip: pick('Aircraft_bare_metal', { color: 0x929c9f, roughness: 0.32, metalness: 0.82 }), duct: dark, core, metal: core, glass, window: glass, dark, prop: dark };
}

/** Tests and the console: the template of a loaded type (or null). */
export const realModelTemplate = (id) => templates.get(id) || null;

/* ------------------------------------------------------------ vehicles -- */

/**
 * The ground vehicles (tools/real-models/vehicles.py): the apron's pushback
 * tug, baggage tractor and baggage cart (world/apron.js), and the road
 * traffic's cars, taxis, buses, vans, trucks, jeeps and pick-ups
 * (features/ambient/cars.js). One file, vertex-coloured, no images, in the
 * frame the game's own vehicle shapes are built in, so a shape swaps for its
 * real one inside the same InstancedMesh: same instances, same matrices,
 * same tints (the paint is baked white where the game tints).
 *
 * Fetched the first time a world with any of them is built, except on Low,
 * which keeps the game's own boxes (a hundred cars of 1,500 triangles is not
 * what a school Chromebook's budget is for).
 */
export const REAL_VEHICLES = {
  file: 'vehicles.glb',
  kinds: ['tug', 'tractor', 'cart', 'car', 'taxi', 'bus', 'van', 'truck', 'jeep', 'fourx4'],
  credits: [
    { title: 'Aircraft tractor lowpoly model', author: 'propmaker1 (@menX1151)', url: 'https://sketchfab.com/3d-models/2e9a078c365243c888f4c70f85be7b85', used: 'Pushback tug, baggage tractor' },
    { title: 'Airport baggage equipment (cart) lowpoly', author: 'propmaker1 (@menX1151)', url: 'https://sketchfab.com/3d-models/7ae8444bb5044376a04ee7bb0664ff39', used: 'Baggage carts' },
    { title: 'Free Low Poly Vehicles Pack', author: 'RgsDev (@rgsdev)', url: 'https://sketchfab.com/3d-models/cb7640039e7a40679a53be705ebff50e', used: 'Road traffic' },
  ],
};

let vehicleGeos = null;
let vehiclePending = null;
let vehicleFailedAt = 0;

export function realVehiclesUrl() {
  return new URL(`../../assets/models/real/${REAL_VEHICLES.file}`, import.meta.url).href;
}

/** Fetch and parse the vehicles, once. Resolves to a Map kind -> geometry, or null. Never rejects. */
export function loadRealVehicles() {
  if (vehicleGeos) return Promise.resolve(vehicleGeos);
  if (vehiclePending) return vehiclePending;
  if (vehicleFailedAt && now() - vehicleFailedAt < 60000) return Promise.resolve(null);
  vehiclePending = (async () => {
    try {
      const buf = await (loader || fetchBuffer)(realVehiclesUrl(), 'vehicles');
      const parsed = parseGLB(buf, { name: REAL_VEHICLES.file, warn: () => {} });
      const out = new Map();
      parsed.scene.traverse((o) => {
        if (o.isMesh && o.parent && REAL_VEHICLES.kinds.includes(o.parent.name)) out.set(o.parent.name, o.geometry);
      });
      vehicleGeos = out;
      return out;
    } catch (e) {
      vehicleFailedAt = now();
      console.warn('The real vehicles could not be loaded; keeping the built-in ones.', e);
      return null;
    } finally {
      vehiclePending = null;
    }
  })();
  return vehiclePending;
}

/**
 * Give an InstancedMesh of one vehicle kind its real shape, now if the file
 * is here, or when it arrives (if the mesh is still in a scene by then).
 * Its own geometry is left as it was; the owner disposes what it owns.
 */
export function wearRealVehicle(mesh, kind) {
  if (!mesh || !REAL_VEHICLES.kinds.includes(kind) || !realModelsOn() || textureTier() === 'low') return false;
  const swap = (geos) => {
    const g = geos && geos.get(kind);
    if (!g || mesh.userData.realVehicle) return;
    if (mesh.userData.realVehicleAsked && !mesh.parent) return; // the world it was in is gone
    // A copy each: the owner disposes its mesh's geometry with its world.
    mesh.geometry = g.clone();
    mesh.userData.realVehicle = kind;
    if (mesh.boundingSphere) mesh.computeBoundingSphere();
  };
  if (vehicleGeos) {
    swap(vehicleGeos);
    return true;
  }
  mesh.userData.realVehicleAsked = true;
  loadRealVehicles().then(swap);
  return true;
}

export const realVehiclesReady = () => !!vehicleGeos;
