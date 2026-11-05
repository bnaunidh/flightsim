/**
 * Skyscrapers: every map's downtown (scenery.js addTown).
 *
 * Owner, 2026-11-04: "and better skycrapers etc.. like dude". A tower was one
 * tall box wearing a stretched picture of windows, with a smaller box on top.
 * Now each is a building: a podium with its street front, a shaft that steps
 * back as it rises, chamfered, round, twinned or cut on a slant; bands at the
 * setbacks, a plant room and its machinery on the roof, masts, and on the
 * city's tallest a crown and a spire. No two alike, and a couple in every big
 * city you could steer by.
 *
 * ONE MESH OF GLASS, ONE OF EVERYTHING ELSE, however many towers: two draw calls
 * and the lamps. The glass carries no texture. Its curtain wall is arithmetic on
 * each wall's own metres, so a mullion is the same size on any tower, floors
 * line up round a corner and it never stretches: mullions and spandrels close
 * in, floors further off, a clean tinted surface far away (faded by the
 * fragment's own footprint, so nothing shimmers at a distance). Every pane
 * tilts a hair differently, which is what makes a reflection on a real glass
 * building break up instead of lying on it like a mirror. After dark the rooms
 * light by their own numbers, the same ones every night; nothing blinks but the
 * aviation lamp.
 *
 * `towers` are { x, z, base, top, w, d, rot, q } in world metres; a spot's rank
 * in the list is how important it is, tallest first.
 */
import * as THREE from '../vendor/three.module.js';
import { glassMaterial } from '../render/surfaces.js';

/** The glass, as sRGB tints: blue-grey, sea green, bronze, smoke, sky. */
const GLASS = [[0.30, 0.42, 0.52], [0.26, 0.44, 0.46], [0.46, 0.38, 0.30], [0.30, 0.33, 0.37], [0.40, 0.52, 0.64], [0.24, 0.34, 0.46]];
const STONE = [[0.78, 0.75, 0.70], [0.62, 0.60, 0.58], [0.70, 0.66, 0.58], [0.44, 0.44, 0.46]];
const METAL = [0.70, 0.72, 0.74];
const DARK = [0.24, 0.25, 0.27];
const ROOF = [0.40, 0.40, 0.41];

class Parts {
  constructor(ox, oz) {
    this.ox = ox;
    this.oz = oz;
    this.glass = { pos: [], nrm: [], col: [], fac: [], idx: [] };
    this.trim = { pos: [], nrm: [], col: [], idx: [] };
  }

  /** A tower's frame: its middle, its turn. */
  frame(x, y, z, rot) {
    this.fx = x - this.ox;
    this.fy = y;
    this.fz = z - this.oz;
    this.c = Math.cos(rot);
    this.s = Math.sin(rot);
  }

  at(lx, ly, lz) {
    return [this.fx + this.c * lx + this.s * lz, this.fy + ly, this.fz - this.s * lx + this.c * lz];
  }

  dir(nx, nz) {
    return [this.c * nx + this.s * nz, -this.s * nx + this.c * nz];
  }

  /** The walls of a prism: `poly` round the footprint (the order rect() gives) at y0, `ptop` at y1 (or the same). */
  walls(poly, y0, y1, tint, seed, ptop = poly, yTop = null) {
    const G = this.glass;
    const n = poly.length;
    const smooth = n > 12;
    let u = 0;
    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      const at = ptop[i];
      const bt = ptop[(i + 1) % n];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const nx = -(b[1] - a[1]) / (L || 1);
      const nz = (b[0] - a[0]) / (L || 1);
      const base = G.pos.length / 3;
      const ya = yTop ? yTop(at[0], at[1]) : y1;
      const yb = yTop ? yTop(bt[0], bt[1]) : y1;
      G.pos.push(...this.at(a[0], y0, a[1]), ...this.at(b[0], y0, b[1]), ...this.at(bt[0], yb, bt[1]), ...this.at(at[0], ya, at[1]));
      const [wx, wz] = this.dir(nx, nz);
      if (smooth) {
        const [ax, az] = this.dir(...norm2(a));
        const [bx, bz] = this.dir(...norm2(b));
        G.nrm.push(ax, 0, az, bx, 0, bz, bx, 0, bz, ax, 0, az);
      } else G.nrm.push(wx, 0, wz, wx, 0, wz, wx, 0, wz, wx, 0, wz);
      G.col.push(...tint, ...tint, ...tint, ...tint);
      const U0 = u;
      G.fac.push(U0, y0, seed, U0 + L, y0, seed, U0 + L, yb, seed, U0, ya, seed);
      G.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      u += L;
    }
  }

  /** The same in the matte material (a band, a podium's stone, a plant room). */
  solid(poly, y0, y1, col, cap = col) {
    const T = this.trim;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const [wx, wz] = this.dir(-(b[1] - a[1]) / L, (b[0] - a[0]) / L);
      const base = T.pos.length / 3;
      T.pos.push(...this.at(a[0], y0, a[1]), ...this.at(b[0], y0, b[1]), ...this.at(b[0], y1, b[1]), ...this.at(a[0], y1, a[1]));
      T.nrm.push(wx, 0, wz, wx, 0, wz, wx, 0, wz, wx, 0, wz);
      T.col.push(...col, ...col, ...col, ...col);
      T.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    this.lid(poly, y1, cap);
  }

  /** A flat top: a fan from the first corner. */
  lid(poly, y, col, yTop = null) {
    const T = this.trim;
    const base = T.pos.length / 3;
    for (const p of poly) {
      T.pos.push(...this.at(p[0], yTop ? yTop(p[0], p[1]) : y, p[1]));
      T.nrm.push(0, 1, 0);
      T.col.push(...col);
    }
    for (let i = 1; i < poly.length - 1; i++) T.idx.push(base, base + i, base + i + 1);
  }
}

const norm2 = (p) => {
  const L = Math.hypot(p[0], p[1]) || 1;
  return [p[0] / L, p[1] / L];
};
const rect = (w, d) => [[-w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [w / 2, -d / 2]];
/** A rectangle with its corners cut. */
function chamfer(w, d, c) {
  const a = w / 2;
  const b = d / 2;
  return [[-a, -b + c], [-a, b - c], [-a + c, b], [a - c, b], [a, b - c], [a, -b + c], [a - c, -b], [-a + c, -b]];
}
function round(w, d, n = 20) {
  const p = [];
  for (let i = 0; i < n; i++) {
    const t = -(i / n) * Math.PI * 2;
    p.push([(Math.cos(t) * w) / 2, (Math.sin(t) * d) / 2]);
  }
  return p;
}
const scaled = (poly, k, kz = k) => poly.map((p) => [p[0] * k, p[1] * kz]);
const shifted = (poly, dx, dz) => poly.map((p) => [p[0] + dx, p[1] + dz]);

/** A bit of machinery on a roof: boxes and a mast or two, by the tower's own numbers. */
function roofPlant(P, poly, y, w, d, q, mast) {
  const box = (dx, dz, bw, bd, h, col) => P.solid(shifted(rect(bw, bd), dx, dz), y, y + h, col, DARK);
  P.lid(poly, y + 0.02, ROOF);
  box(-w * 0.12, 0, w * 0.34, d * 0.44, 3.4, [0.60, 0.60, 0.58]);
  box(w * 0.22, d * 0.14, w * 0.12, d * 0.14, 2.2, [0.5, 0.5, 0.5]);
  box(w * 0.2, -d * 0.2, w * 0.16, d * 0.12, 1.6, METAL);
  if (q > 0.45) box(-w * 0.3, d * 0.28, 3, 3, 3.8, [0.34, 0.36, 0.38]);
  if (mast) P.solid(shifted(rect(0.7, 0.7), w * 0.05, -d * 0.1), y, y + mast, METAL, METAL);
}

/** One tower. Returns the height of the very top over its base, and what is solid: [[w, d, y0, y1]...]. */
function raise(P, t, rank, total) {
  const { w, d, q } = t;
  const H = t.top - t.base;
  const seed = t.seed ?? q;
  const tint = GLASS[Math.floor(q * 977) % GLASS.length];
  const stone = STONE[Math.floor(q * 613) % STONE.length];
  const pick = rank === 0 && total >= 8 ? 4 : rank === 1 && total >= 8 ? 2 : rank === 2 && total >= 12 ? 3 : Math.floor(q * 311) % 6;
  // The street front: a podium a little wider than the tower (not where it would take the pavement).
  const pH = Math.min(22, 6 + H * 0.07);
  const pw = w * 1.08;
  const pd = d * 1.08;
  const podium = rect(pw, pd);
  P.walls(podium, -1, pH, [0.22, 0.28, 0.32], seed * 0.37);
  P.solid(rect(pw + 0.8, pd + 0.8), pH, pH + 1.1, stone, ROOF);
  const y0 = pH + 1.1;
  let topY = H;
  let mast = 0;
  const solid = [[pw, pd, 0, pH + 1.1]];
  if (pick === 0) {
    // Setbacks: three steps, a band at each.
    const a = rect(w * 0.94, d * 0.94);
    const b = rect(w * 0.76, d * 0.76);
    const c = rect(w * 0.56, d * 0.56);
    const y1 = y0 + (H - y0) * 0.58;
    const y2 = y0 + (H - y0) * 0.84;
    P.walls(a, y0, y1, tint, seed);
    P.solid(scaled(a, 1.02), y1, y1 + 0.9, METAL, ROOF);
    P.walls(b, y1 + 0.9, y2, tint, seed);
    P.solid(scaled(b, 1.02), y2, y2 + 0.9, METAL, ROOF);
    P.walls(c, y2 + 0.9, H, tint, seed);
    roofPlant(P, c, H, w * 0.56, d * 0.56, q, q > 0.5 ? 14 : 0);
    mast = q > 0.5 ? 14 : 4;
  } else if (pick === 1) {
    // Corners cut, a lantern on top.
    const a = chamfer(w * 0.96, d * 0.96, Math.min(w, d) * 0.2);
    P.walls(a, y0, H * 0.93, tint, seed);
    P.walls(scaled(a, 0.8), H * 0.93, H, tint, seed);
    P.lid(scaled(a, 1.0), H * 0.93, ROOF);
    P.solid(scaled(a, 0.66), H, H + 3.5, [0.56, 0.58, 0.60], DARK);
    mast = 3.5;
  } else if (pick === 2) {
    // Two blades on one podium, the second shorter.
    const offs = w * 0.27;
    const b1 = shifted(rect(w * 0.44, d * 0.94), -offs, 0);
    const b2 = shifted(rect(w * 0.44, d * 0.8), offs, 0);
    P.walls(b1, y0, H, tint, seed);
    P.walls(b2, y0, H * 0.82, tint, seed + 0.13);
    P.lid(b2, H * 0.82, ROOF);
    roofPlant(P, b1, H, w * 0.44, d * 0.94, q, 0);
    P.solid(rect(0.8, 0.8).map((p) => [p[0] - offs, p[1]]), H, H + 22, METAL, METAL);
    mast = 22;
  } else if (pick === 3) {
    // Cut on a slant: the roof a single plane rising to one corner.
    const a = rect(w * 0.94, d * 0.94);
    const rise = Math.min(26, 0.18 * H);
    const ytop = (x, z) => H - rise + rise * (0.5 + (x / (w * 0.94)) * 0.5 + (z / (d * 0.94)) * 0.5);
    P.walls(a, y0, H, tint, seed, a, ytop);
    P.lid(a, H, [0.32, 0.34, 0.36], ytop);
  } else if (pick === 4) {
    // The city's own: steps up to a crown, and a spire.
    const steps = [[0.96, 0.46], [0.84, 0.70], [0.70, 0.86], [0.54, 0.95]];
    let yb = y0;
    let last = rect(w, d);
    for (const [k, to] of steps) {
      const poly = chamfer(w * k, d * k, Math.min(w, d) * k * 0.16);
      const yt = y0 + (H - y0) * to;
      P.walls(poly, yb, yt, tint, seed);
      P.solid(scaled(poly, 1.03), yt, yt + 1.1, METAL, ROOF);
      yb = yt + 1.1;
      last = poly;
    }
    // Louvres round the crown, lit from inside after dark.
    P.walls(scaled(last, 0.8), yb, H, [0.56, 0.60, 0.64], seed + 0.5);
    P.solid(scaled(last, 0.5), H, H + 5, METAL, METAL);
    P.solid(rect(2.4, 2.4), H + 5, H + 16, [0.62, 0.64, 0.66], METAL);
    P.solid(rect(0.9, 0.9), H + 16, H + 42, METAL, METAL);
    mast = 42;
  } else {
    // A drum.
    const a = round(w * 0.98, d * 0.98);
    P.walls(a, y0, H, tint, seed);
    P.solid(scaled(a, 1.02), H, H + 1.2, METAL, ROOF);
    roofPlant(P, scaled(a, 0.98), H + 1.2, w * 0.6, d * 0.6, q, q > 0.6 ? 9 : 0);
    mast = q > 0.6 ? 9 : 4;
  }
  solid.push([w, d, 0, topY + Math.min(mast, 6)]);
  if (mast > 6) solid.push([2, 2, topY, topY + mast]);
  return { top: topY + mast, solid };
}

const VERT_DECL = `
attribute vec3 aFacade;
varying vec3 vFacade;`;

const FRAG_DECL = `
varying vec3 vFacade;
uint skH(int a, int b, int c) {
  uint h = (uint(a) * 0x9E3779B1u) ^ (uint(b) * 0x85EBCA77u) ^ (uint(c) * 0xC2B2AE3Du);
  h ^= h >> 15u;
  h *= 0x2C1B3C6Du;
  h ^= h >> 13u;
  return h;
}
float skB(uint h, uint sh) { return float((h >> sh) & 255u) / 255.0; }
float skFar;
float skPane;
float skMull;
float skSpan;
vec2 skCell;
float skStyle;`;

/** The curtain wall, after the base colour: mullions, spandrels, a faded plain surface further off. */
const FRAG_COLOUR = `
{
  skStyle = fract(vFacade.z * 7.31);
  // One pane: 1.6 m wide; one floor: 3.8 m. Bigger bays on the bigger of the styles.
  vec2 fp = vec2(vFacade.x / (skStyle > 0.6 ? 3.2 : 1.6), vFacade.y / 3.8);
  skCell = floor(fp);
  vec2 g = fp - skCell;
  vec2 fw = fwidth(fp);
  float farU = smoothstep(0.22, 0.6, fw.x);
  float farV = smoothstep(0.22, 0.6, fw.y);
  skFar = max(farU, farV);
  float mw = skStyle > 0.6 ? 0.075 : 0.05;
  skMull = (1.0 - smoothstep(mw, mw + fw.x, min(g.x, 1.0 - g.x))) * (1.0 - farU);
  float sh = skStyle < 0.3 ? 0.14 : skStyle < 0.6 ? 0.42 : 0.26;
  skSpan = (1.0 - smoothstep(sh, sh + fw.y, g.y)) * (1.0 - farV);
  skPane = (1.0 - skMull) * (1.0 - skSpan);
  vec3 tint = diffuseColor.rgb;
  vec3 frame = skStyle < 0.5 ? vec3(0.34, 0.36, 0.38) : vec3(0.62, 0.62, 0.60);
  vec3 span = skStyle < 0.3 ? tint * 0.6 : skStyle < 0.6 ? vec3(0.50, 0.50, 0.48) : tint * 0.8;
  vec3 mean = mix(tint * 0.8, frame, 0.14 + (skStyle < 0.6 && skStyle > 0.3 ? 0.2 : 0.0));
  vec3 fine = mix(mix(tint * 0.72, span, skSpan), frame, skMull);
  diffuseColor.rgb = mix(fine, mean, skFar);
}`;

/** Each pane a hair out of true. */
const FRAG_NORMAL = `
{
  uint h = skH(int(skCell.x), int(skCell.y), int(vFacade.z * 1000.0));
  normal = normalize(normal + (vec3(skB(h, 0u), skB(h, 8u), skB(h, 16u)) - 0.5) * 0.055 * skPane);
}`;

const FRAG_ROUGH = `
roughnessFactor = mix(0.55, roughnessFactor, skPane * (1.0 - skFar) + skFar * 0.85);
`;

/** Rooms lit by their own numbers: three panes to a room, warm or cool. */
const FRAG_EMIT = `
{
  uint h = skH(int(floor(skCell.x / 3.0)), int(skCell.y), int(vFacade.z * 1000.0) + 7);
  float on = step(0.6, skB(h, 0u));
  float room = mix(on * skPane, 0.12 + 0.12 * skB(skH(int(skCell.y), 3, int(vFacade.z * 1000.0)), 0u), skFar);
  vec3 warm = mix(vec3(1.0, 0.8, 0.52), vec3(0.8, 0.9, 1.0), step(0.74, skB(h, 8u)));
  totalEmissiveRadiance *= warm * room * 0.8;
}`;

function skylineMaterial() {
  const mat = glassMaterial({ color: 0xffffff, roughness: 0.14, metalness: 0.72 });
  mat.vertexColors = true;
  mat.emissive.setHex(0xffffff);
  mat.emissiveIntensity = 0;
  const before = mat.onBeforeCompile;
  const beforeKey = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
  mat.onBeforeCompile = (shader, r) => {
    if (before) before(shader, r);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${VERT_DECL}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = aFacade;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>${FRAG_DECL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>${FRAG_COLOUR}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>${FRAG_ROUGH}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>${FRAG_NORMAL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>${FRAG_EMIT}`);
  };
  mat.customProgramCacheKey = () => `skyline:${beforeKey}`;
  return mat;
}

function geometry(b, facade) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col.map((c) => Math.pow(c, 2.2)), 3));
  if (facade) g.setAttribute('aFacade', new THREE.Float32BufferAttribute(b.fac, 3));
  g.setIndex(b.idx);
  return g;
}

/**
 * Add the towers to `group`. Returns the glass (its windows are a night material),
 * the lamp material, and each tower's solid pieces for the caller's obstacles.
 */
export function addSkyline(group, towers, { name = 'town' } = {}) {
  if (!towers.length) return null;
  const ox = towers.reduce((s, t) => s + t.x, 0) / towers.length;
  const oz = towers.reduce((s, t) => s + t.z, 0) / towers.length;
  const P = new Parts(ox, oz);
  const out = [];
  const lampAt = [];
  towers.forEach((t, rank) => {
    P.frame(t.x, t.base, t.z, t.rot);
    const r = raise(P, t, rank, towers.length);
    out.push(r);
    // (Aviation lamps on what an aeroplane must see, not on an office block.)
    if (r.top > 75) lampAt.push([t.x, t.base + r.top + 0.9, t.z]);
  });
  const grp = new THREE.Group();
  grp.name = `skyline-${name}`;
  grp.position.set(ox, 0, oz);
  const glass = new THREE.Mesh(geometry(P.glass, true), skylineMaterial());
  glass.name = `skyline-${name}-glass`;
  glass.castShadow = true;
  glass.receiveShadow = true;
  const trim = new THREE.Mesh(geometry(P.trim, false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, metalness: 0.2 }));
  trim.name = `skyline-${name}-trim`;
  trim.castShadow = true;
  grp.add(glass, trim);
  group.add(grp);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x5a0d0a, emissive: 0xff2a1a, emissiveIntensity: 1.2, roughness: 0.5 });
  const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), lampMat, Math.max(1, lampAt.length));
  lamps.count = lampAt.length;
  lamps.name = `skyline-${name}-lamps`;
  const m = new THREE.Matrix4();
  lampAt.forEach((p, i) => lamps.setMatrixAt(i, m.makeTranslation(p[0] - ox, p[1], p[2] - oz)));
  lamps.instanceMatrix.needsUpdate = true;
  grp.add(lamps);
  return { glass, trim, lampMat, nightMats: [glass.material], towers: out };
}
