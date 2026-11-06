/**
 * The mark a sliding wreck leaves: a long ribbon laid on the drawn ground along
 * the way it went, in what that ground is (./slide.js): a dark trench through
 * grass, a pale trough through snow, a black scrape along concrete, a white
 * scratch on ice. One mesh with room for a fixed number of stations, its soft
 * edges fading out through the vertex alpha. Loaded a few seconds into a flight,
 * and nothing is drawn or allocated again after that: a ribbon only grows.
 *
 * Every station keeps its crash time, so the instant replay can show the
 * mark growing as the wreck made it, not lying there before the hit (the
 * owner: "the replay showed the crash damage BEFORE the crash happened").
 */

import * as THREE from '../../vendor/three.module.js';
import { SLIDE } from './slide.js';

/** Metres between stations, and how many there are. */
export const SCAR = { step: 3, stations: { low: 90, medium: 140, high: 200, ultra: 260 }, lift: 0.28 };

/** Across the ribbon, -1..1, and how solid each vertex is: soft at the edges. */
const ACROSS = [-1, -0.55, 0.55, 1];
const SOLID = [0, 1, 1, 0];

/** Furrows along the length of it: a mark torn in the ground is streaks with the ground showing between them, not a stripe of paint. */
function furrows() {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!g || !g.fillRect) return null;
  g.fillStyle = 'rgb(70,70,70)';
  g.fillRect(0, 0, 64, 64);
  let seed = 41;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 46; i++) {
    const v = Math.round(90 + rnd() * 165);
    g.strokeStyle = `rgb(${v},${v},${v})`;
    g.lineWidth = 0.8 + rnd() * 3.4;
    const x = rnd() * 64;
    const y = rnd() * 64;
    const l = 14 + rnd() * 42;
    for (const oy of [0, -64]) {
      g.beginPath();
      g.moveTo(x, y + oy);
      g.lineTo(x + (rnd() - 0.5) * 3, y + oy + l);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class Scars {
  constructor(parent, quality = 'high') {
    this.cap = SCAR.stations[quality] || SCAR.stations.high;
    const n = this.cap * 4;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.uv = new Float32Array(n * 2);
    this.run = 0;
    const nrm = new Float32Array(n * 3);
    for (let i = 1; i < n * 3; i += 3) nrm[i] = 1;
    const idx = new Uint16Array((this.cap - 1) * 18);
    for (let s = 0, o = 0; s < this.cap - 1; s++) {
      const a = s * 4;
      for (let e = 0; e < 3; e++) {
        idx[o++] = a + e;
        idx[o++] = a + e + 4;
        idx[o++] = a + e + 1;
        idx[o++] = a + e + 1;
        idx[o++] = a + e + 4;
        idx[o++] = a + e + 5;
      }
    }
    const g = (this.geo = new THREE.BufferGeometry());
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('color', this.colAttr);
    this.uvAttr = new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('uv', this.uvAttr);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    // Ahead of the ground and of any marking on a runway, a few depth steps (render/depth-layers.js).
    this.tex = furrows();
    this.mat = new THREE.MeshLambertMaterial({ alphaMap: this.tex, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -24 });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.name = 'crash-scars';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    parent.add(this.mesh);
    this.times = new Float32Array(this.cap);
    this.clear();
  }

  clear() {
    this.n = 0;
    this.run = 0;
    this.lastX = NaN;
    this.lastZ = NaN;
    this.lastDirX = 1;
    this.lastDirZ = 0;
    this.geo.setDrawRange(0, 0);
    this.mesh.visible = false;
  }

  /** The wreck is here, at crash time t, on this kind of ground; `ground(x, z)` is the height drawn there. */
  add(x, z, t, kind, width, ground) {
    if (this.n >= this.cap) return false;
    const def = SLIDE[kind];
    if (!def || !def.scar) return false;
    const dx = x - this.lastX;
    const dz = z - this.lastZ;
    const d = Math.hypot(dx, dz);
    if (this.n > 0 && !(d >= SCAR.step)) return false;
    // A jump (the wreck bounced clear, or left the sea): the ribbon stops there and goes on from nothing.
    const gap = this.n > 0 && d > SCAR.step * 5;
    if (d > 1e-3 && this.n > 0) {
      this.lastDirX = dx / d;
      this.lastDirZ = dz / d;
    }
    const sx = -this.lastDirZ;
    const sz = this.lastDirX;
    const hw = width * def.width;
    const i = this.n * 4;
    const [r, g, b] = def.scar;
    if (this.n > 0) this.run += d;
    for (let e = 0; e < 4; e++) {
      const px = x + sx * hw * ACROSS[e];
      const pz = z + sz * hw * ACROSS[e];
      this.pos[(i + e) * 3] = px;
      this.pos[(i + e) * 3 + 1] = ground(px, pz) + SCAR.lift;
      this.pos[(i + e) * 3 + 2] = pz;
      this.uv[(i + e) * 2] = ((ACROSS[e] + 1) / 2) * (hw / 4);
      this.uv[(i + e) * 2 + 1] = this.run / 16;
      this.col[(i + e) * 4] = r;
      this.col[(i + e) * 4 + 1] = g;
      this.col[(i + e) * 4 + 2] = b;
      this.col[(i + e) * 4 + 3] = gap ? 0 : def.alpha * SOLID[e];
    }
    // The first station of a ribbon is faded in, so that it starts from nothing too.
    if (this.n === 0) for (let e = 0; e < 4; e++) this.col[(i + e) * 4 + 3] = 0;
    this.times[this.n] = t;
    this.n++;
    this.lastX = x;
    this.lastZ = z;
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.uvAttr.needsUpdate = true;
    this.geo.setDrawRange(0, Math.max(0, this.n - 1) * 18);
    this.mesh.visible = this.n > 1;
    return true;
  }

  /** The ribbon as it was at crash time t (the replay). */
  showUpTo(t) {
    let n = 0;
    while (n < this.n && this.times[n] <= t) n++;
    this.geo.setDrawRange(0, Math.max(0, n - 1) * 18);
    this.mesh.visible = n > 1;
  }

  debug() {
    return { stations: this.n, cap: this.cap, visible: this.mesh.visible };
  }

  /** Compile and upload ahead of the crash (features/breakup.js warmLazy): a program links on its first draw otherwise. */
  warm(renderer, camera, scene) {
    renderer.compile(this.mesh, camera, scene);
    if (this.tex) renderer.initTexture(this.tex);
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
    if (this.tex) this.tex.dispose();
  }
}
