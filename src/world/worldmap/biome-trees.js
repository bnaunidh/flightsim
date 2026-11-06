/**
 * World Map — the biomes' own trees (worldmap/biomes.js), drawn in code: no
 * downloads. Each is built one unit tall and as flora.js wants a tree, one
 * InstancedMesh a species, with the same bill as Scenery's own (200-560
 * vertices). Unlike Scenery's they have soft normals and a little shade baked
 * into the colours, dark under the crown and in the folds, so they read as
 * round masses of leaves rather than as faceted lumps.
 *
 *   hardwood  a jungle emergent: a tall bare trunk, buttresses, a broad cauliflower crown
 *   acacia    a forked trunk under one flat wide table of leaves
 *   cactus    a fluted column with two arms
 *   snowpine  a spire of drooping tiers, each one white on top and dark under the hem
 *   mangrove  arching prop roots holding a dark round crown out of the mud
 *   autumn    a full round broadleaf, in a pale gold each tree tints (flora.js AUTUMN)
 *
 * Kinds are flora.js's SPECIES indices. Lazy: this file is the World Map's.
 */
import * as THREE from '../../vendor/three.module.js';

const lin = (c) => Math.pow(c, 2.2);

/** Vertices, as flat arrays, indexed. */
class Mesh {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.idx = [];
  }

  vert(p, n, c) {
    this.pos.push(p[0], p[1], p[2]);
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    this.nrm.push(n[0] / l, n[1] / l, n[2] / l);
    this.col.push(lin(c[0]), lin(c[1]), lin(c[2]));
    return this.pos.length / 3 - 1;
  }

  /** A limb through `pts` ([x, y, z]) with `radii`, `sides` round; `shade(i, s)` multiplies `color`. */
  tube(pts, radii, sides, color, shade = null) {
    const base = this.pos.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const tl = Math.hypot(...t) || 1;
      t[0] /= tl; t[1] /= tl; t[2] /= tl;
      // A frame round the limb: any vector across it, then its cross.
      const u0 = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const d = u0[0] * t[0] + u0[1] * t[1] + u0[2] * t[2];
      const u = [u0[0] - d * t[0], u0[1] - d * t[1], u0[2] - d * t[2]];
      const ul = Math.hypot(...u) || 1;
      u[0] /= ul; u[1] /= ul; u[2] /= ul;
      const v = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
      for (let s = 0; s < sides; s++) {
        const q = (s / sides) * Math.PI * 2;
        const cq = Math.cos(q);
        const sq = Math.sin(q);
        const n = [u[0] * cq + v[0] * sq, u[1] * cq + v[1] * sq, u[2] * cq + v[2] * sq];
        const k = shade ? shade(i, s) : 1;
        this.vert([p[0] + n[0] * radii[i], p[1] + n[1] * radii[i], p[2] + n[2] * radii[i]], n, [color[0] * k, color[1] * k, color[2] * k]);
      }
    }
    for (let i = 0; i + 1 < pts.length; i++) {
      for (let s = 0; s < sides; s++) {
        const a = base + i * sides + s;
        const b = base + i * sides + ((s + 1) % sides);
        const c = a + sides;
        const d = b + sides;
        this.idx.push(a, b, c, b, d, c);
      }
    }
  }

  /** A crown of leaves: a bumpy ball, its normals out from its middle, darker below (a detail 1 ball is 42 vertices). */
  lump(cx, cy, cz, r, sy, color, seed, detail = 1, under = 0.5) {
    const g = new THREE.IcosahedronGeometry(1, detail);
    const p = g.attributes.position;
    const seen = new Map();
    const remap = [];
    for (let i = 0; i < p.count; i++) {
      const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      let at = seen.get(key);
      if (at === undefined) {
        const x = p.getX(i);
        const y = p.getY(i);
        const z = p.getZ(i);
        const h = Math.sin(x * 91.7 + y * 47.3 + z * 13.1 + seed * 7.7) * 43758.5453;
        const k = 0.82 + 0.3 * (h - Math.floor(h));
        // Light from above: full at the top, `under` at the bottom, and a little from the bumps.
        const sh = (under + (1 - under) * (y * 0.5 + 0.5)) * (0.82 + 0.26 * (k - 0.82) / 0.3);
        at = this.vert([cx + x * r * k, cy + y * r * sy * k, cz + z * r * k], [x, y * 1.5 + 0.35, z], [color[0] * sh, color[1] * sh, color[2] * sh]);
        seen.set(key, at);
      }
      remap.push(at);
    }
    for (let i = 0; i < remap.length; i += 3) this.idx.push(remap[i], remap[i + 1], remap[i + 2]);
    g.dispose();
  }

  /** A cone: apex, a white shoulder, a dark hem drooping, and the underside. One tier of a snow-loaded pine. */
  tier(y, r, h, sides, seed, top, hem, under) {
    const a0 = this.pos.length / 3;
    const apex = this.vert([0, y + h, 0], [0, 1, 0], top);
    const shoulder = [];
    const rim = [];
    for (let s = 0; s < sides; s++) {
      const q = (s / sides) * Math.PI * 2 + seed;
      const c = Math.cos(q);
      const n = Math.sin(q);
      // Ragged hem: every other bough a little longer.
      const rr = r * (s % 2 ? 1 : 0.86);
      shoulder.push(this.vert([c * rr * 0.62, y + h * 0.4, n * rr * 0.62], [c, 0.9, n], top));
      rim.push(this.vert([c * rr, y - h * 0.05 - (s % 2 ? h * 0.16 : 0), n * rr], [c, 0.35, n], hem));
    }
    const low = this.vert([0, y + h * 0.12, 0], [0, -1, 0], under);
    for (let s = 0; s < sides; s++) {
      const t = (s + 1) % sides;
      this.idx.push(apex, shoulder[t], shoulder[s]);
      this.idx.push(shoulder[s], shoulder[t], rim[s], rim[s], shoulder[t], rim[t]);
      this.idx.push(low, rim[s], rim[t]);
    }
    return a0;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}

const BARK = [0.3, 0.24, 0.18];

function hardwood(m) {
  const bark = [0.4, 0.35, 0.28];
  m.tube([[0, -0.01, 0], [0.012, 0.22, 0.006], [-0.006, 0.44, 0], [0, 0.6, 0]], [0.06, 0.036, 0.028, 0.018], 6, bark, (i) => (i === 0 ? 0.7 : 1));
  // Buttresses: thin fins at the foot.
  for (let i = 0; i < 3; i++) {
    const a = i * 2.09 + 0.5;
    m.tube([[Math.cos(a) * 0.13, -0.01, Math.sin(a) * 0.13], [Math.cos(a) * 0.05, 0.06, Math.sin(a) * 0.05], [0, 0.13, 0]], [0.01, 0.018, 0.012], 3, bark, () => 0.8);
  }
  // Limbs out to the crown.
  for (let i = 0; i < 3; i++) {
    const a = i * 2.09 + 0.2;
    m.tube([[0, 0.48, 0], [Math.cos(a) * 0.13, 0.6, Math.sin(a) * 0.13], [Math.cos(a) * 0.25, 0.68, Math.sin(a) * 0.25]], [0.016, 0.01, 0.006], 4, bark);
  }
  // A deep crown in tiers of leaf, not a plate on a stick: the top half of the tree, deep greens.
  const leaf = [[0.14, 0.32, 0.12], [0.19, 0.39, 0.14], [0.11, 0.28, 0.11], [0.23, 0.42, 0.16]];
  m.lump(0, 0.8, 0, 0.3, 0.62, leaf[0], 1);
  m.lump(0.24, 0.7, 0.1, 0.22, 0.72, leaf[1], 2, 0);
  m.lump(-0.22, 0.72, 0.14, 0.22, 0.72, leaf[2], 3, 0);
  m.lump(-0.1, 0.7, -0.24, 0.22, 0.7, leaf[1], 4, 0);
  m.lump(0.15, 0.86, -0.15, 0.17, 0.62, leaf[3], 5, 0);
}

function acacia(m) {
  m.tube([[0, -0.01, 0], [0.02, 0.2, 0], [0, 0.4, 0]], [0.038, 0.03, 0.024], 6, BARK);
  const limbs = [[0.34, 0.1], [-0.3, 0.17], [0.06, -0.33], [-0.1, 0.3]];
  for (const [x, z] of limbs) m.tube([[0, 0.36, 0], [x * 0.45, 0.58, z * 0.45], [x, 0.76, z]], [0.018, 0.012, 0.005], 4, BARK);
  const leaf = [[0.42, 0.47, 0.2], [0.5, 0.53, 0.24], [0.36, 0.42, 0.18]];
  m.lump(0, 0.82, 0, 0.46, 0.14, leaf[0], 11, 1, 0.35);
  m.lump(0.3, 0.84, 0.12, 0.27, 0.15, leaf[1], 12, 0, 0.35);
  m.lump(-0.28, 0.83, -0.08, 0.28, 0.15, leaf[2], 13, 0, 0.35);
  m.lump(0.02, 0.84, 0.3, 0.2, 0.15, leaf[1], 14, 0, 0.35);
}

function cactus(m) {
  const skin = [0.36, 0.48, 0.3];
  const ribs = (i, s) => (s % 2 ? 0.74 : 1.04);
  m.tube([[0, -0.02, 0], [0, 0.45, 0], [0, 0.9, 0], [0, 0.985, 0], [0, 1, 0]], [0.082, 0.08, 0.072, 0.05, 0.004], 8, skin, ribs);
  m.tube([[0.07, 0.38, 0], [0.16, 0.42, 0.01], [0.2, 0.5, 0.01], [0.205, 0.68, 0.01], [0.205, 0.735, 0.01], [0.205, 0.75, 0.01]], [0.05, 0.05, 0.05, 0.048, 0.032, 0.003], 6, skin, ribs);
  m.tube([[-0.07, 0.52, 0.01], [-0.14, 0.55, 0.02], [-0.17, 0.62, 0.02], [-0.175, 0.8, 0.02], [-0.175, 0.845, 0.02], [-0.175, 0.86, 0.02]], [0.044, 0.044, 0.044, 0.042, 0.028, 0.003], 6, skin, ribs);
}

function snowpine(m) {
  const snow = [0.92, 0.94, 0.98];
  const hem = [0.42, 0.5, 0.5];
  const under = [0.08, 0.16, 0.12];
  m.tube([[0, -0.01, 0], [0, 0.24, 0]], [0.026, 0.02], 5, [0.24, 0.19, 0.15]);
  const tiers = [[0.13, 0.31, 0.26], [0.29, 0.26, 0.25], [0.45, 0.2, 0.23], [0.6, 0.15, 0.22], [0.74, 0.1, 0.26]];
  tiers.forEach(([y, r, h], i) => m.tier(y, r, h, 8, i * 0.9, snow, hem, under));
}

function mangrove(m) {
  const root = [0.28, 0.22, 0.17];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.3;
    const far = 0.26 + 0.1 * ((i * 5) % 3) * 0.5;
    const top = 0.26 + 0.05 * (i % 2);
    const c = Math.cos(a);
    const s = Math.sin(a);
    m.tube([[c * far, -0.03, s * far], [c * far * 0.84, 0.13, s * far * 0.84], [c * far * 0.5, top, s * far * 0.5], [c * 0.03, top + 0.05, s * 0.03]], [0.014, 0.012, 0.011, 0.013], 3, root, (k) => (k === 0 ? 0.6 : 1));
  }
  m.tube([[0, 0.26, 0], [0.03, 0.42, 0.01], [-0.02, 0.56, 0], [0.01, 0.68, 0]], [0.035, 0.03, 0.022, 0.014], 5, root);
  m.tube([[0.01, 0.46, 0], [0.16, 0.56, 0.08], [0.24, 0.64, 0.12]], [0.014, 0.01, 0.005], 3, root);
  m.tube([[0, 0.5, 0], [-0.15, 0.58, -0.08], [-0.24, 0.66, -0.12]], [0.014, 0.01, 0.005], 3, root);
  const leaf = [[0.1, 0.25, 0.11], [0.14, 0.3, 0.13], [0.085, 0.22, 0.1]];
  m.lump(0, 0.78, 0, 0.27, 0.68, leaf[0], 21);
  m.lump(0.2, 0.68, 0.1, 0.18, 0.7, leaf[1], 22, 0);
  m.lump(-0.2, 0.7, -0.1, 0.19, 0.7, leaf[2], 23, 0);
  m.lump(0.03, 0.72, -0.2, 0.17, 0.7, leaf[1], 24, 0);
}

function autumn(m) {
  m.tube([[0, -0.01, 0], [0.01, 0.26, 0], [0, 0.48, 0]], [0.05, 0.034, 0.024], 6, BARK);
  m.tube([[0, 0.34, 0], [0.13, 0.5, 0.05]], [0.02, 0.01], 4, BARK);
  m.tube([[0, 0.36, 0], [-0.13, 0.52, -0.04]], [0.02, 0.01], 4, BARK);
  const leaf = [[0.96, 0.8, 0.46], [0.9, 0.72, 0.38], [1, 0.84, 0.52]];
  m.lump(0, 0.64, 0, 0.31, 0.92, leaf[0], 31);
  m.lump(0.2, 0.56, 0.08, 0.2, 0.85, leaf[1], 32, 0);
  m.lump(-0.19, 0.58, -0.1, 0.21, 0.85, leaf[2], 33, 0);
  m.lump(0.04, 0.54, 0.2, 0.18, 0.85, leaf[1], 34, 0);
  m.lump(-0.04, 0.84, 0.02, 0.17, 0.85, leaf[2], 35, 0);
}

const MAKERS = { 6: hardwood, 7: acacia, 8: cactus, 9: snowpine, 10: mangrove, 11: autumn };

/** The tree geometry of a biome species (flora.js SPECIES index 6..11): vertex colours, one unit tall. */
export function biomeTreeGeometry(kind) {
  const m = new Mesh();
  MAKERS[kind](m);
  return m.build();
}
