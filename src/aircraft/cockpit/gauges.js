/**
 * Steam gauges that cost nothing to run.
 *
 * The old panel repainted a 1600 x 800 canvas thirty times a second and sent
 * all five megabytes of it to the graphics card each time — a texture upload
 * per frame, which on a school Chromebook is the expensive part, not the
 * drawing. Here the panel is painted ONCE (paint.js: bezels, faces, ticks,
 * radios, placards) and everything that moves is a small mesh in front of it:
 *
 *   needles        flat tapered shapes turned about their pivot
 *   attitude ball  a disc whose texture is slid (pitch) and turned (bank) by
 *                  its UV matrix — one uniform, no repaint
 *   heading card   a painted rose, turned
 *   turn & slip    a little aeroplane that banks, a ball that slides
 *   lamps          emissive quads (gear greens, AP, annunciators)
 *
 * so a frame is a dozen rotations and a few material numbers. The only canvas
 * that is ever repainted is the altimeter's drum window, at most ten times a
 * second and only when the number on it changes.
 *
 * Coordinates: a GaugePanel is a flat face in its own plane — u to the right,
 * v up, in metres from its centre; +z faces the pilot. The builder places and
 * tilts the panel's group in the cockpit.
 */

import * as THREE from '../../vendor/three.module.js';
import { clamp, lerp } from '../../core/noise.js';
import { UNITS } from '../physics.js';
import {
  ring,
  label,
  wrinkle,
  roundRect,
  asiFace,
  altFace,
  vsiFace,
  aiFace,
  hiFace,
  tcFace,
  roundGauge,
  twinGauge,
  DIM,
  TEXT,
} from './paint.js';

const { KTS, FT, FPM } = UNITS;

/* ------------------------------------------------------------------ *
 * Shared, painted-once textures
 * ------------------------------------------------------------------ */

const cache = new Map();
function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

/** The attitude ball spans +/- BALL_DEG of pitch top to bottom (and across). */
const BALL_DEG = 125;
/** How much of the ball the dial window shows, top to bottom, in degrees. */
const BALL_WINDOW = 70;

function ballCanvas() {
  return cached('ball', () => {
    const S = 1024;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const pxPerDeg = S / (2 * BALL_DEG);
    const mid = S / 2;
    const sky = g.createLinearGradient(0, 0, 0, mid);
    sky.addColorStop(0, '#0b3a6b');
    sky.addColorStop(1, '#3f8fd0');
    g.fillStyle = sky;
    g.fillRect(0, 0, S, mid);
    const gr = g.createLinearGradient(0, mid, 0, S);
    gr.addColorStop(0, '#7a5230');
    gr.addColorStop(1, '#3d2814');
    g.fillStyle = gr;
    g.fillRect(0, mid, S, mid);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(0, mid);
    g.lineTo(S, mid);
    g.stroke();
    g.font = '700 22px "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    for (let d = -80; d <= 80; d += 5) {
      if (d === 0) continue;
      const y = mid - d * pxPerDeg;
      const w = d % 10 === 0 ? 70 : 34;
      g.lineWidth = d % 10 === 0 ? 4 : 3;
      g.beginPath();
      g.moveTo(mid - w, y);
      g.lineTo(mid + w, y);
      g.stroke();
      if (d % 10 === 0) {
        g.fillText(String(Math.abs(d)), mid - w - 24, y);
        g.fillText(String(Math.abs(d)), mid + w + 24, y);
      }
    }
    // Ground perspective lines, as a real ball has below the horizon.
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    for (const a of [-45, -30, -15, 15, 30, 45]) {
      const r = (a * Math.PI) / 180;
      g.beginPath();
      g.moveTo(mid, mid);
      g.lineTo(mid + Math.sin(r) * 200, mid + Math.cos(r) * 200);
      g.stroke();
    }
    return c;
  });
}

function cardCanvas() {
  return cached('card', () => {
    const S = 512;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const m = S / 2;
    const r = S / 2 - 4;
    g.fillStyle = '#0b0d10';
    g.beginPath();
    g.arc(m, m, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#e8eaee';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let d = 0; d < 360; d += 5) {
      const a = (d * Math.PI) / 180;
      const major = d % 10 === 0;
      g.lineWidth = major ? 4 : 2;
      const r0 = r - (major ? 34 : 22);
      g.beginPath();
      g.moveTo(m + Math.sin(a) * r0, m - Math.cos(a) * r0);
      g.lineTo(m + Math.sin(a) * (r - 6), m - Math.cos(a) * (r - 6));
      g.stroke();
      if (d % 30 === 0) {
        const t = d === 0 ? 'N' : d === 90 ? 'E' : d === 180 ? 'S' : d === 270 ? 'W' : String(d / 10);
        g.save();
        g.translate(m + Math.sin(a) * (r - 66), m - Math.cos(a) * (r - 66));
        g.rotate(a);
        g.fillStyle = d % 90 === 0 ? '#ffd23f' : '#e8eaee';
        g.font = `700 ${d % 90 === 0 ? 50 : 40}px "Helvetica Neue", Arial, sans-serif`;
        g.fillText(t, 0, 0);
        g.restore();
      }
    }
    return c;
  });
}

function canvasTexture(canvas, { srgb = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

const geoCache = new Map();
function geo(key, make) {
  if (!geoCache.has(key)) {
    const g = make();
    // Shared between cockpits: main.js disposes the old aeroplane's geometry
    // when it changes type, so a shared one must survive that.
    g.dispose = () => {};
    geoCache.set(key, g);
  }
  return geoCache.get(key);
}

/** A needle pointing up +v from its pivot: tapered, with a short tail. */
function needleGeo(len, width, tail = 0.18) {
  const k = `needle:${len.toFixed(4)}:${width.toFixed(4)}:${tail}`;
  return geo(k, () => {
    const s = new THREE.Shape();
    s.moveTo(-width, -len * tail);
    s.lineTo(-width * 0.5, len * 0.9);
    s.lineTo(0, len);
    s.lineTo(width * 0.5, len * 0.9);
    s.lineTo(width, -len * tail);
    s.closePath();
    return new THREE.ShapeGeometry(s);
  });
}

function discGeo(r, segs = 32) {
  return geo(`disc:${r.toFixed(4)}:${segs}`, () => new THREE.CircleGeometry(r, segs));
}

/** The attitude indicator's fixed aeroplane: two wings and a dot. */
function aiSymbolGeo(R) {
  return geo(`aisym:${R.toFixed(4)}`, () => {
    const parts = [];
    const bar = (x0, x1, y0, y1) => {
      const g = new THREE.PlaneGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0));
      g.translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
      parts.push(g);
    };
    const t = R * 0.05;
    bar(-R * 0.62, -R * 0.2, -t / 2, t / 2);
    bar(-R * 0.2 - t, -R * 0.2, -R * 0.14, t / 2);
    bar(R * 0.2, R * 0.62, -t / 2, t / 2);
    bar(R * 0.2, R * 0.2 + t, -R * 0.14, t / 2);
    const dot = new THREE.CircleGeometry(t * 0.8, 12);
    parts.push(dot);
    return mergeGeos(parts);
  });
}

/** The heading indicator's fixed aeroplane outline, nose up. */
function hiSymbolGeo(R) {
  return geo(`hisym:${R.toFixed(4)}`, () => {
    const parts = [];
    const bar = (cx, cy, w, h) => {
      const g = new THREE.PlaneGeometry(w, h);
      g.translate(cx, cy, 0);
      parts.push(g);
    };
    const t = R * 0.045;
    bar(0, 0, t, R * 0.5); // fuselage
    bar(0, R * 0.06, R * 0.42, t); // wings
    bar(0, -R * 0.2, R * 0.18, t); // tailplane
    return mergeGeos(parts);
  });
}

/** The turn coordinator's little aeroplane, seen from behind. */
function tcSymbolGeo(R) {
  return geo(`tcsym:${R.toFixed(4)}`, () => {
    const parts = [];
    const w = new THREE.PlaneGeometry(R * 1.2, R * 0.07);
    parts.push(w);
    const fin = new THREE.PlaneGeometry(R * 0.06, R * 0.22);
    fin.translate(0, R * 0.12, 0);
    parts.push(fin);
    parts.push(new THREE.CircleGeometry(R * 0.08, 16));
    return mergeGeos(parts);
  });
}

function mergeGeos(list) {
  // Positions only (plus normals and uvs, which ShapeGeometry and friends
  // all have), concatenated and indexed.
  let vCount = 0;
  let iCount = 0;
  for (const g of list) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = [];
  let vo = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, vo * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    if (g.index) for (const i of g.index.array) idx.push(i + vo);
    else for (let i = 0; i < g.attributes.position.count; i++) idx.push(i + vo);
    vo += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

/* ------------------------------------------------------------------ *
 * The panel
 * ------------------------------------------------------------------ */

/**
 * A flat instrument panel with live gauges.
 *
 *   new GaugePanel({ width, height, outline, colour, highContrast })
 *   panel.asi({ u, v, R, ... }), .ai(), .alt(), .vsi(), .hi(), .tc(),
 *   .round({ ... value }), .twin({ ... values }), .lamp({ ... on }),
 *   .paint((ctx, P) => ...)      extra static art (radios, switches, labels)
 *   panel.finish()               after all of the above
 *   panel.update(dt, ac, env)    per frame
 *
 * `outline` is the panel's edge in its own (u, v) metres, so it can follow
 * the cabin's walls; without one it is the full rectangle.
 */
export class GaugePanel {
  constructor({ width, height, outline = null, colour = '#2b2f35', highContrast = false, maxPx = 2048 }) {
    this.width = width;
    this.height = height;
    this.highContrast = highContrast;
    this.ppm = Math.min(maxPx / width, (maxPx / 2) / height);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(width * this.ppm);
    this.canvas.height = Math.round(height * this.ppm);
    this.ctx = this.canvas.getContext('2d');
    this.texture = canvasTexture(this.canvas, { aniso: 8 });
    this.group = new THREE.Group();
    this.group.name = 'instrument panel';
    this.live = [];
    this.lampFns = [];
    this.flags = [];
    this.lcds = [];
    this.smooth = { ias: 0, alt: 0, vs: 0, hdg: 90, pitch: 0, bank: 0, slip: 0, turn: 0 };
    this._f = new THREE.Vector3();
    this.frozen = false;

    // Needles and symbols: white paint, lit by the cabin and by the panel
    // lights at night (emissive), dark in a blackout.
    this.needleMat = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.5, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0.15 });
    this.symbolMat = new THREE.MeshStandardMaterial({ color: 0xffb21a, roughness: 0.5, emissive: 0xffa000, emissiveIntensity: 0.2 });
    this.hubMat = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.6, metalness: 0.3 });
    this.flagMat = new THREE.MeshBasicMaterial({ color: 0xd8291c });
    this.lcdOffMat = new THREE.MeshBasicMaterial({ color: 0x050607 });

    // Paint the panel itself.
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, W, H);
    wrinkle(ctx, 0, 0, W, H, Math.round((W * H) / 110), 20240611, 0.04, 0.08, 2);
    const lit = ctx.createLinearGradient(0, 0, 0, H);
    lit.addColorStop(0, 'rgba(0,0,0,0.38)'); // in the glareshield's shadow
    lit.addColorStop(0.18, 'rgba(0,0,0,0.05)');
    lit.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = lit;
    ctx.fillRect(0, 0, W, H);

    // The face itself: the outline, UV-mapped straight onto the canvas.
    const shape = new THREE.Shape();
    const pts = outline || [
      [-width / 2, -height / 2],
      [width / 2, -height / 2],
      [width / 2, height / 2],
      [-width / 2, height / 2],
    ];
    pts.forEach(([u, v], i) => (i ? shape.lineTo(u, v) : shape.moveTo(u, v)));
    shape.closePath();
    const fg = new THREE.ShapeGeometry(shape);
    const uv = fg.attributes.uv;
    const p = fg.attributes.position;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / width + 0.5, p.getY(i) / height + 0.5);
    this.faceMat = new THREE.MeshStandardMaterial({
      map: this.texture,
      roughness: 0.62,
      metalness: 0.05,
      emissive: 0xffffff,
      emissiveMap: this.texture,
      emissiveIntensity: 0.1,
    });
    this.face = new THREE.Mesh(fg, this.faceMat);
    this.face.name = 'panel face';
    this.group.add(this.face);
  }

  /** Panel metres -> canvas pixels. */
  px(u) {
    return (u + this.width / 2) * this.ppm;
  }
  py(v) {
    return (this.height / 2 - v) * this.ppm;
  }
  pr(r) {
    return r * this.ppm;
  }

  /** Extra static art, in canvas pixels: fn(ctx, panel). */
  paint(fn) {
    fn(this.ctx, this);
    return this;
  }

  _mesh(geometry, mat, u, v, z, name) {
    const m = new THREE.Mesh(geometry, mat);
    m.position.set(u, v, z);
    if (name) m.name = name;
    this.group.add(m);
    return m;
  }

  _needle(u, v, len, width, z = 0.004, tail = 0.18, mat = this.needleMat) {
    const piv = new THREE.Group();
    piv.position.set(u, v, z);
    // It turns: a builder's mergeStatic (kit.js) must leave it be.
    piv.userData.dynamic = true;
    this.group.add(piv);
    this._batch(piv, needleGeo(len, width, tail), mat);
    return piv;
  }

  /**
   * All the needles of a panel are ONE mesh (per material): the pivots stay
   * (callers and checks turn them as before), and each frame their needles'
   * few vertices are moved on the CPU to where the pivots point — a couple
   * of hundred points and one small upload, instead of a draw per needle
   * (fifteen in a light aeroplane's panel, more than the rest of the cockpit
   * view costs over the follow view).
   */
  _batch(piv, geometry, mat) {
    piv.userData.batched = true;
    (this._pending || (this._pending = [])).push({ piv, geometry, mat });
  }

  _flushBatches() {
    if (!this._pending || !this._pending.length) return;
    this.batches = this.batches || [];
    const byMat = new Map();
    for (const b of [...this._pending, ...this.batches.flatMap((x) => x.items)]) {
      if (!byMat.has(b.mat)) byMat.set(b.mat, []);
      byMat.get(b.mat).push(b);
    }
    for (const x of this.batches) {
      this.group.remove(x.mesh);
      x.mesh.geometry.dispose();
    }
    this._pending = [];
    this.batches = [];
    for (const [mat, items] of byMat) {
      let count = 0;
      const srcs = items.map((it) => {
        const g = it.geometry.index ? it.geometry.toNonIndexed() : it.geometry;
        count += g.attributes.position.count;
        return g;
      });
      const pos = new Float32Array(count * 3);
      const nor = new Float32Array(count * 3);
      const uv = new Float32Array(count * 2);
      const local = new Float32Array(count * 3);
      const localN = new Float32Array(count * 3);
      const owner = new Uint16Array(count);
      let o = 0;
      srcs.forEach((g, i) => {
        const p = g.attributes.position;
        const n = g.attributes.normal;
        const t = g.attributes.uv;
        for (let k = 0; k < p.count; k++, o++) {
          local[o * 3] = p.getX(k);
          local[o * 3 + 1] = p.getY(k);
          local[o * 3 + 2] = p.getZ(k);
          localN[o * 3] = n ? n.getX(k) : 0;
          localN[o * 3 + 1] = n ? n.getY(k) : 0;
          localN[o * 3 + 2] = n ? n.getZ(k) : 1;
          if (t) {
            uv[o * 2] = t.getX(k);
            uv[o * 2 + 1] = t.getY(k);
          }
          owner[o] = i;
        }
        if (g !== items[i].geometry) g.dispose();
      });
      const geom = new THREE.BufferGeometry();
      const pa = new THREE.BufferAttribute(pos, 3);
      const na = new THREE.BufferAttribute(nor, 3);
      pa.setUsage(THREE.DynamicDrawUsage);
      na.setUsage(THREE.DynamicDrawUsage);
      geom.setAttribute('position', pa);
      geom.setAttribute('normal', na);
      geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const mesh = new THREE.Mesh(geom, mat);
      mesh.name = 'needles';
      mesh.userData.dynamic = true;
      mesh.userData.noCast = true; // spread across the panel, but each a speck
      mesh.userData.noBatch = true; // it is its own batch
      mesh.frustumCulled = false;
      this.group.add(mesh);
      const batch = { mesh, items, local, localN, owner, keys: new Float64Array(items.length).fill(NaN) };
      for (const it of items) it.piv.userData.batched = mesh;
      this.batches.push(batch);
      this._syncBatch(batch, true);
    }
  }

  /** Move a batch's vertices to where its pivots now point (only if one moved). */
  _syncBatch(b, force = false) {
    let moved = force;
    b.items.forEach((it, i) => {
      const r = it.piv.rotation;
      const p = it.piv.position;
      const key = r.x * 1e6 + r.y * 1e3 + r.z + p.x * 7 + p.y * 11 + p.z * 13 + (it.piv.visible ? 0 : 1e9);
      if (key !== b.keys[i]) {
        b.keys[i] = key;
        moved = true;
      }
    });
    if (!moved) return;
    const mats = b.items.map((it) => {
      it.piv.updateMatrix();
      return it.piv.visible ? it.piv.matrix.elements : null;
    });
    const pos = b.mesh.geometry.attributes.position;
    const nor = b.mesh.geometry.attributes.normal;
    const P = pos.array;
    const N = nor.array;
    const L = b.local;
    const LN = b.localN;
    for (let v = 0; v < b.owner.length; v++) {
      const e = mats[b.owner[v]];
      const i3 = v * 3;
      if (!e) {
        P[i3] = P[i3 + 1] = P[i3 + 2] = 0;
        continue;
      }
      const x = L[i3], y = L[i3 + 1], z = L[i3 + 2];
      P[i3] = e[0] * x + e[4] * y + e[8] * z + e[12];
      P[i3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      P[i3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const nx = LN[i3], ny = LN[i3 + 1], nz = LN[i3 + 2];
      N[i3] = e[0] * nx + e[4] * ny + e[8] * nz;
      N[i3 + 1] = e[1] * nx + e[5] * ny + e[9] * nz;
      N[i3 + 2] = e[2] * nx + e[6] * ny + e[10] * nz;
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
  }

  _hub(u, v, r, z = 0.0055) {
    return this._mesh(discGeo(r, 16), this.hubMat, u, v, z);
  }

  /** A red OFF flag that shows when the instrument has no power. */
  _flag(u, v, R) {
    const m = this._mesh(new THREE.PlaneGeometry(R * 0.42, R * 0.18), this.flagMat, u, v, 0.008, 'OFF flag');
    m.visible = false;
    m.userData.dynamic = true;
    this.flags.push(m);
    return m;
  }

  /* ---------------- Instruments ---------------- */

  asi({ u, v, R, ...o }) {
    const a = asiFace(this.ctx, this.px(u), this.py(v), this.pr(R), o);
    const n = this._needle(u, v, R * 0.86, R * 0.045);
    this._hub(u, v, R * 0.08);
    const max = (o.max || 170) + 5;
    this.live.push((s) => {
      n.rotation.z = -a(clamp(s.ias, o.min || 40, max));
    });
    return this;
  }

  ai({ u, v, R }) {
    const ctx = this.ctx;
    const x = this.px(u);
    const y = this.py(v);
    const r = this.pr(R);
    aiFace(ctx, x, y, r);
    // The fixed bank scale round the top of the dial, outside the ball.
    ctx.strokeStyle = TEXT;
    ctx.lineCap = 'butt';
    for (const d of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const a = (d * Math.PI) / 180;
      const len = d === 0 ? r * 0.12 : d % 30 === 0 ? r * 0.12 : r * 0.07;
      ctx.lineWidth = d % 30 === 0 ? r * 0.035 : r * 0.022;
      ctx.beginPath();
      ctx.moveTo(x + Math.sin(a) * r * 0.97, y - Math.cos(a) * r * 0.97);
      ctx.lineTo(x + Math.sin(a) * (r * 0.97 - len), y - Math.cos(a) * (r * 0.97 - len));
      ctx.stroke();
    }
    ctx.fillStyle = TEXT;
    ctx.beginPath();
    ctx.moveTo(x, y - r * 0.82);
    ctx.lineTo(x - r * 0.06, y - r * 0.95);
    ctx.lineTo(x + r * 0.06, y - r * 0.95);
    ctx.closePath();
    ctx.fill();

    // The ball: a disc whose texture is moved, never repainted. Its own
    // clone of the shared canvas texture, so its UV matrix is its own; the
    // picture itself is uploaded once for all of them.
    const tex = canvasTexture(ballCanvas());
    tex.matrixAutoUpdate = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const ballMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.12 });
    const Rb = R * 0.8;
    const ball = this._mesh(discGeo(Rb, 40), ballMat, u, v, 0.002, 'attitude ball');
    ball.userData.dynamic = true;
    // Sky pointer: rides on the ball's rim, turns with bank.
    const ptr = new THREE.Group();
    ptr.position.set(u, v, 0.0045);
    ptr.userData.dynamic = true;
    const tri = new THREE.Shape();
    tri.moveTo(0, Rb * 0.98);
    tri.lineTo(-R * 0.07, Rb * 0.98 - R * 0.13);
    tri.lineTo(R * 0.07, Rb * 0.98 - R * 0.13);
    tri.closePath();
    ptr.add(new THREE.Mesh(new THREE.ShapeGeometry(tri), this.symbolMat));
    this.group.add(ptr);
    this._mesh(aiSymbolGeo(R), this.symbolMat, u, v, 0.006, 'aircraft symbol');
    this._flag(u + R * 0.45, v + R * 0.3, R);
    const f = Rb / R; // fraction of the dial the ball fills
    const scale = (BALL_WINDOW / (2 * BALL_DEG)) / 1; // texture span the disc shows
    this.live.push((s) => {
      const p = clamp(s.pitch, -90, 90) / (2 * BALL_DEG);
      // Banked right, the horizon turns anticlockwise on the dial: the UV
      // matrix turns the lookup the other way, which is what +bank asks of
      // setUvTransform (it rotates by minus its angle).
      tex.matrix.setUvTransform(0, p, scale, scale, (s.bank * Math.PI) / 180, 0.5, 0.5);
      ptr.rotation.z = (s.bank * Math.PI) / 180;
    });
    this._ballFrac = f;
    return this;
  }

  alt({ u, v, R }) {
    altFace(this.ctx, this.px(u), this.py(v), this.pr(R));
    // The drum window: the one live-painted thing on the panel, and only
    // when its number changes.
    const W = 128;
    const H = 40;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    const tex = canvasTexture(c, { aniso: 2 });
    const dw = R * 0.62;
    const dh = dw * (H / W);
    const drum = this._mesh(
      new THREE.PlaneGeometry(dw, dh),
      new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.3, roughness: 0.5 }),
      u,
      v - R * 0.36,
      0.003,
      'altitude drum'
    );
    let shown = null;
    let since = 1;
    const paintDrum = (ft) => {
      g.fillStyle = '#05070a';
      g.fillRect(0, 0, W, H);
      g.strokeStyle = '#4a5058';
      g.lineWidth = 3;
      g.strokeRect(1.5, 1.5, W - 3, H - 3);
      g.fillStyle = '#e8eaee';
      g.font = '700 30px "Courier New", monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(ft).padStart(5, ' '), W / 2, H / 2 + 1);
      tex.needsUpdate = true;
    };
    paintDrum(0);
    const n10k = this._needle(u, v, R * 0.86, R * 0.018, 0.0035, 0.05);
    const n1k = this._needle(u, v, R * 0.5, R * 0.07, 0.004, 0.22);
    const n100 = this._needle(u, v, R * 0.86, R * 0.04, 0.0045);
    this._hub(u, v, R * 0.08);
    this.live.push((s, dt) => {
      const alt = Math.max(0, s.alt);
      n100.rotation.z = -((alt % 1000) / 1000) * Math.PI * 2;
      n1k.rotation.z = -((alt % 10000) / 10000) * Math.PI * 2;
      n10k.rotation.z = -((alt % 100000) / 100000) * Math.PI * 2;
      since += dt;
      const ft = Math.round(alt / 10) * 10;
      if (ft !== shown && since >= 0.1) {
        shown = ft;
        since = 0;
        paintDrum(ft);
      }
    });
    this.drum = drum;
    return this;
  }

  vsi({ u, v, R }) {
    const a = vsiFace(this.ctx, this.px(u), this.py(v), this.pr(R));
    const n = this._needle(u, v, R * 0.86, R * 0.045);
    this._hub(u, v, R * 0.08);
    this.live.push((s) => {
      n.rotation.z = -a(clamp(s.vs, -2100, 2100));
    });
    return this;
  }

  hi({ u, v, R }) {
    hiFace(this.ctx, this.px(u), this.py(v), this.pr(R));
    const tex = canvasTexture(cardCanvas());
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.12 });
    const card = this._mesh(discGeo(R * 0.86, 48), mat, u, v, 0.002, 'heading card');
    card.userData.dynamic = true;
    this._mesh(hiSymbolGeo(R), this.needleMat, u, v, 0.005, 'heading aircraft');
    this._flag(u - R * 0.42, v + R * 0.3, R);
    this.live.push((s) => {
      card.rotation.z = (s.hdg * Math.PI) / 180;
    });
    return this;
  }

  tc({ u, v, R }) {
    tcFace(this.ctx, this.px(u), this.py(v), this.pr(R));
    const sym = this._mesh(tcSymbolGeo(R), this.needleMat, u, v - R * 0.06, 0.004, 'turn aeroplane');
    sym.userData.dynamic = true;
    // The ball in its tube: the tube is painted at (x, y - 30 s) radius 0.9 r
    // in canvas space, which is v + 0.3 R up here.
    const ballR = R * 0.085;
    const ball = this._mesh(discGeo(ballR, 16), new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.3, metalness: 0.2 }), u, v, 0.004, 'slip ball');
    ball.userData.dynamic = true;
    const cy = v + R * 0.3;
    this._flag(u, v + R * 0.4, R);
    this.live.push((s) => {
      // Rate one (3 deg/s) puts the wing on the lower mark: 0.33 rad.
      sym.rotation.z = -clamp((s.turn / 3) * 0.33, -0.7, 0.7);
      const a = Math.PI * 0.5 + clamp(s.slip, -1, 1) * 0.12;
      ball.position.set(u + Math.cos(a) * R * 0.9, cy - Math.sin(a) * R * 0.9, 0.004);
    });
    return this;
  }

  /** Any single-needle round gauge; `value(s, ac, env)` is in its own units. */
  round({ u, v, R, value, rate = 6, ...spec }) {
    const a = roundGauge(this.ctx, this.px(u), this.py(v), this.pr(R), spec);
    const n = this._needle(u, v, R * 0.82, R * 0.05);
    this._hub(u, v, R * 0.09);
    let cur = spec.min || 0;
    this.live.push((s, dt, ac, env) => {
      cur = lerp(cur, clamp(value(s, ac, env), spec.min || 0, spec.max || 1), clamp(dt * rate, 0, 1));
      n.rotation.z = -a(cur);
    });
    return this;
  }

  /** A two-needle gauge (left / right half-dials); `values(s, ac, env)` -> [l, r]. */
  twin({ u, v, R, values, rate = 4, ...spec }) {
    const a = twinGauge(this.ctx, this.px(u), this.py(v), this.pr(R), spec);
    const nl = this._needle(u, v, R * 0.78, R * 0.045);
    const nr = this._needle(u, v, R * 0.78, R * 0.045);
    this._hub(u, v, R * 0.09);
    const cur = [spec.left.min || 0, spec.right.min || 0];
    const out = [0, 0];
    this.live.push((s, dt, ac, env) => {
      values(s, ac, env, out);
      cur[0] = lerp(cur[0], clamp(out[0], spec.left.min || 0, spec.left.max || 1), clamp(dt * rate, 0, 1));
      cur[1] = lerp(cur[1], clamp(out[1], spec.right.min || 0, spec.right.max || 1), clamp(dt * rate, 0, 1));
      nl.rotation.z = -a.left(cur[0]);
      nr.rotation.z = -a.right(cur[1]);
    });
    return this;
  }

  /**
   * A lamp: a lens painted with its legend, lit by emissive when on(s, ac,
   * env) says so. Gear greens, the autopilot, low-voltage — anything that is
   * either on or off.
   */
  lamp({ u, v, w, h, text = '', colour = 0x3ec96a, on, round = false, size = 0.6 }) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = Math.max(16, Math.round((128 * h) / w));
    const g = c.getContext('2d');
    g.fillStyle = '#101317';
    g.fillRect(0, 0, c.width, c.height);
    if (text) {
      g.fillStyle = '#ffffff';
      g.font = `700 ${Math.round(c.height * size)}px "Helvetica Neue", Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, c.width / 2, c.height / 2 + 1);
    } else {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, c.width, c.height);
    }
    const tex = canvasTexture(c, { aniso: 2 });
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: new THREE.Color(colour),
      emissiveIntensity: 0,
      color: text ? 0x2a2e34 : new THREE.Color(colour).multiplyScalar(0.25),
      roughness: 0.35,
    });
    const geom = round ? new THREE.CircleGeometry(w / 2, 20) : new THREE.PlaneGeometry(w, h);
    const m = this._mesh(geom, mat, u, v, 0.003, `lamp ${text}`);
    // A bezel round it, and its unlit face, painted into the panel: the lamp's
    // own mesh is drawn only while it is lit (a draw saved per dark lamp).
    this.paint((ctx, P) => {
      ctx.fillStyle = '#0c0e11';
      const pad = P.pr(0.004);
      if (round) {
        ctx.beginPath();
        ctx.arc(P.px(u), P.py(v), P.pr(w / 2) + pad, 0, Math.PI * 2);
        ctx.fill();
      } else {
        roundRect(ctx, P.px(u - w / 2) - pad, P.py(v + h / 2) - pad, P.pr(w) + pad * 2, P.pr(h) + pad * 2, pad);
        ctx.fill();
      }
      const dark = '#' + new THREE.Color(colour).multiplyScalar(text ? 0.12 : 0.22).getHexString();
      ctx.fillStyle = text ? '#15181c' : dark;
      if (round) {
        ctx.beginPath();
        ctx.arc(P.px(u), P.py(v), P.pr(w / 2), 0, Math.PI * 2);
        ctx.fill();
      } else ctx.fillRect(P.px(u - w / 2), P.py(v + h / 2), P.pr(w), P.pr(h));
      if (text && typeof ctx.drawImage === 'function') {
        ctx.globalAlpha = 0.4;
        ctx.drawImage(c, P.px(u - w / 2), P.py(v + h / 2), P.pr(w), P.pr(h));
        ctx.globalAlpha = 1;
      }
    });
    m.visible = false;
    m.userData.dynamic = true;
    const lampRec = { mat, on: false, mesh: m };
    this.lampFns.push((s, dt, ac, env) => {
      lampRec.on = !env.blackout && !!on(s, ac, env);
      mat.emissiveIntensity = lampRec.on ? 1.6 : 0;
      m.visible = lampRec.on;
    });
    return lampRec;
  }

  /** A display that goes black when the power goes: covers [u, v, w, h]. */
  lcd({ u, v, w, h }) {
    const m = this._mesh(new THREE.PlaneGeometry(w, h), this.lcdOffMat, u, v, 0.002, 'dead display');
    m.visible = false;
    m.userData.dynamic = true;
    this.lcds.push(m);
    return this;
  }

  /** A mesh that turns about (u, v) every frame: fn(s, dt, ac, env) -> angle. */
  spinner({ u, v, geometry, material, z = 0.004, angle }) {
    const piv = new THREE.Group();
    piv.position.set(u, v, z);
    piv.userData.dynamic = true;
    piv.add(new THREE.Mesh(geometry, material));
    this.group.add(piv);
    this.live.push((s, dt, ac, env) => {
      piv.rotation.z = angle(s, dt, ac, env);
    });
    return piv;
  }

  finish() {
    this._flushBatches();
    this.texture.needsUpdate = true;
    // The panel owns its canvas textures: when main.js disposes the old
    // aeroplane's materials on a type change, they go with them.
    const own = (mat) => {
      if (!mat || mat.userData.ownsMaps) return;
      mat.userData.ownsMaps = true;
      mat.addEventListener('dispose', () => {
        if (mat.map && !mat.map.userData.shared) mat.map.dispose();
      });
    };
    this.group.traverse((o) => o.isMesh && own(o.material));
    return this;
  }

  /**
   * Per frame. Readings are smoothed (real needles have inertia) straight
   * off the aeroplane — no readouts() object, which would be a new
   * allocation every frame.
   */
  update(dt, ac, env) {
    const s = this.smooth;
    const dead = !!env.blackout;
    for (const f of this.flags) f.visible = dead;
    for (const l of this.lcds) l.visible = dead;
    const light = dead ? 0 : env.panelLight || 0;
    this.faceMat.emissiveIntensity = dead ? 0 : 0.08 + light * 0.5;
    this.needleMat.emissiveIntensity = dead ? 0 : 0.12 + light * 0.5;
    this.symbolMat.emissiveIntensity = dead ? 0 : 0.2 + light * 0.5;
    // Lamps every frame: in a blackout they are told, and go out.
    for (const fn of this.lampFns) fn(s, dt, ac, env);
    // The instruments freeze where the power left them.
    if (dead) return;
    const k = clamp(dt * 10, 0, 1);
    s.ias = lerp(s.ias, (ac.ias || 0) * KTS, k);
    s.alt = lerp(s.alt, (ac.alt || 0) * FT, k);
    s.vs = lerp(s.vs, (ac.vs || 0) * FPM, clamp(dt * 6, 0, 1));
    const dh = (((ac.heading || 0) - s.hdg + 540) % 360) - 180;
    s.hdg = (s.hdg + dh * k + 360) % 360;
    const fwd = typeof ac.forward === 'function' ? ac.forward(this._f) : null;
    const pitch = fwd ? (Math.asin(clamp(fwd.y, -1, 1)) * 180) / Math.PI : 0;
    const bank = typeof ac.bankAngleDeg === 'function' ? ac.bankAngleDeg() : 0;
    s.pitch = lerp(s.pitch, pitch, clamp(dt * 14, 0, 1));
    s.bank = lerp(s.bank, bank, clamp(dt * 14, 0, 1));
    s.slip = lerp(s.slip, ac.slipBall || 0, clamp(dt * 6, 0, 1));
    s.turn = lerp(s.turn, ac.turnRate || 0, clamp(dt * 6, 0, 1));
    for (const fn of this.live) fn(s, dt, ac, env);
    if (this._pending && this._pending.length) this._flushBatches();
    if (this.batches) for (const b of this.batches) this._syncBatch(b);
  }
}
