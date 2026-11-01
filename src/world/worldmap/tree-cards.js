/**
 * World Map — Preview: the woods between the trees.
 *
 * worldmap/flora.js plants real trees (scenery.js's own, 200-560 vertices
 * each), and a forest of those as dense as a forest is would be millions of
 * vertices. So the forests are filled in with tree CARDS: each a tree's
 * picture on three quads — two crossed upright and one lying flat at the
 * crown, so it is a tree from the side and a crown from above — twelve
 * vertices, drawn from one atlas texture, alpha-tested. Thousands of them
 * cost what a few dozen real trees would. They stand only where the land
 * cover says forest (worldmap/landcover.js), densely, and only close in
 * (the tier's radius); further out the forest floor's own colour carries
 * the woods (worldmap/world-terrain.js).
 *
 * The atlas is drawn once on a canvas: a broadleaf crown, a conifer and a
 * palm, each shaded from the top-left with a darker underside, and their
 * crowns seen from above. Instances are tinted per tree (flora.js colours).
 *
 * REPAINTED from the real trees (owner, 2026-10-31: "sketchfab models for all
 * trees"): the broadleaf, conifer and palm pictures are the real oak, pine
 * and palm (world/real-scenery.js) drawn from the side and from above,
 * shipped as assets/models/real/scenery/tree-cards.webp (84 KB, fetched with
 * the World Map, never before the menu). The canvas drawing stays: it is what
 * shows until the picture arrives, and if it never does; the scrub's cell is
 * still drawn. The cards are as wide as the real trees' pictures (WIDTH), so
 * close up (world/real-trees.js) and far off are the same trees.
 */
import * as THREE from '../../vendor/three.module.js';

/** Atlas cells: [u0, v0, u1, v1] for the side view and the top view of each picture. */
const CELLS = {
  broad: { side: [0, 0.5, 0.25, 1], top: [0, 0, 0.25, 0.5] },
  conifer: { side: [0.25, 0.5, 0.5, 1], top: [0.25, 0, 0.5, 0.5] },
  palm: { side: [0.5, 0.5, 0.75, 1], top: [0.5, 0, 0.75, 0.5] },
  scrub: { side: [0.75, 0.5, 1, 1], top: [0.75, 0, 1, 0.5] },
};
/** flora.js SPECIES (palm, broadleaf, conifer, scrub, birch, thorn) to pictures. */
const PICTURE = ['palm', 'broad', 'conifer', 'scrub', 'broad', 'scrub'];
/** Half-width of each picture's card (unit height), as wide as the real tree it was drawn from. */
const WIDTH = { palm: 0.5, broad: 0.58, conifer: 0.22, scrub: 0.6 };
/** The real trees' pictures (made by drawing the real models; see above). */
export const REAL_CARDS_URL = new URL('../../../assets/models/real/scenery/tree-cards.webp', import.meta.url).href;
let realCards = null; // 'loading' | 'ready' | 'failed'

let atlas = null;
function rnd(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** The atlas texture (made once). */
export function cardAtlas() {
  if (atlas) return atlas;
  const W = 1024;
  const H = 512;
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!c || !c.getContext) return null;
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (!g || !g.arc) return null;
  g.clearRect(0, 0, W, H);
  const R = rnd(4242);
  const blob = (x, y, r, col) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };
  const shadeBlobs = (cx, cy, rx, ry, n, light, dark, rr) => {
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2;
      const d = Math.sqrt(R());
      const x = cx + Math.cos(a) * rx * d;
      const y = cy + Math.sin(a) * ry * d;
      // Lit from the upper left: lighter there, darker under and right.
      const k = Math.min(1, Math.max(0, 0.5 + ((cx - x) / rx) * 0.35 + ((cy - y) / ry) * 0.45 + (R() - 0.5) * 0.3));
      const r = Math.round(dark[0] + (light[0] - dark[0]) * k);
      const gg = Math.round(dark[1] + (light[1] - dark[1]) * k);
      const b = Math.round(dark[2] + (light[2] - dark[2]) * k);
      blob(x, y, rr * (0.6 + R() * 0.6), `rgb(${r},${gg},${b})`);
    }
  };
  const S = 256; // one cell is 256 x 256
  // Broadleaf, side: a trunk and a rounded crown of clustered leaf masses.
  g.fillStyle = '#4a3a2a';
  g.fillRect(S * 0.47, S * 0.62, S * 0.06, S * 0.38);
  shadeBlobs(S * 0.5, S * 0.4, S * 0.36, S * 0.3, 90, [168, 196, 118], [52, 76, 34], S * 0.09);
  // Broadleaf, top.
  shadeBlobs(S * 0.5, H / 2 + S * 0.5, S * 0.4, S * 0.4, 110, [158, 190, 110], [46, 70, 30], S * 0.09);
  // Conifer, side: stacked tiers narrowing to the top.
  g.fillStyle = '#3d3025';
  g.fillRect(S + S * 0.48, S * 0.8, S * 0.04, S * 0.2);
  for (let t = 0; t < 7; t++) {
    const y = S * (0.82 - t * 0.11);
    const w = S * (0.36 - t * 0.045);
    for (let i = 0; i < 14; i++) {
      const k = i / 13;
      const col = `rgb(${Math.round(30 + 60 * (1 - k))},${Math.round(56 + 60 * (1 - k))},${Math.round(36 + 30 * (1 - k))})`;
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(S + S * 0.5 - w * (1 - k * 0.2), y);
      g.lineTo(S + S * 0.5 + w * (1 - k * 0.9), y + S * 0.02);
      g.lineTo(S + S * 0.5, y - S * 0.15);
      g.closePath();
      g.fill();
    }
  }
  // Conifer, top: a dark star of branches.
  shadeBlobs(S + S * 0.5, H / 2 + S * 0.5, S * 0.3, S * 0.3, 80, [96, 128, 84], [24, 46, 30], S * 0.07);
  // Palm, side: a curved trunk and a fan of fronds.
  g.strokeStyle = '#8a7558';
  g.lineWidth = S * 0.035;
  g.beginPath();
  g.moveTo(2 * S + S * 0.5, S);
  g.quadraticCurveTo(2 * S + S * 0.42, S * 0.6, 2 * S + S * 0.52, S * 0.3);
  g.stroke();
  for (let f = 0; f < 11; f++) {
    const a = -Math.PI + (f / 10) * Math.PI;
    g.strokeStyle = f % 2 ? '#5e8a3a' : '#7aa64c';
    g.lineWidth = S * 0.03;
    g.beginPath();
    g.moveTo(2 * S + S * 0.52, S * 0.3);
    g.quadraticCurveTo(2 * S + S * 0.52 + Math.cos(a) * S * 0.25, S * 0.3 + Math.sin(a) * S * 0.1 - S * 0.05, 2 * S + S * 0.52 + Math.cos(a) * S * 0.42, S * 0.3 + Math.abs(Math.sin(a)) * S * 0.05 + S * 0.12);
    g.stroke();
  }
  // Palm, top: a star of fronds.
  for (let f = 0; f < 12; f++) {
    const a = (f / 12) * Math.PI * 2;
    g.strokeStyle = f % 2 ? '#5e8a3a' : '#86b058';
    g.lineWidth = S * 0.04;
    g.beginPath();
    g.moveTo(2 * S + S * 0.5, H / 2 + S * 0.5);
    g.lineTo(2 * S + S * 0.5 + Math.cos(a) * S * 0.42, H / 2 + S * 0.5 + Math.sin(a) * S * 0.42);
    g.stroke();
  }
  // Scrub, side and top: a low wide mound.
  shadeBlobs(3 * S + S * 0.5, S * 0.75, S * 0.4, S * 0.2, 70, [150, 150, 96], [60, 64, 36], S * 0.08);
  shadeBlobs(3 * S + S * 0.5, H / 2 + S * 0.5, S * 0.38, S * 0.38, 80, [140, 142, 90], [56, 60, 34], S * 0.08);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  atlas = t;
  repaintFromRealTrees(c, g, t);
  return t;
}

/** The real trees' pictures over the drawn ones, when (and if) they arrive. */
function repaintFromRealTrees(c, g, t) {
  if (realCards || typeof fetch !== 'function' || typeof createImageBitmap !== 'function') return;
  realCards = 'loading';
  fetch(REAL_CARDS_URL)
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((b) => createImageBitmap(b))
    .then((img) => {
      // Broadleaf, conifer and palm (the first three cells, both rows); the scrub keeps its drawing.
      g.clearRect(0, 0, 768, c.height);
      g.drawImage(img, 0, 0, 768, c.height, 0, 0, 768, c.height);
      t.needsUpdate = true;
      realCards = 'ready';
    })
    .catch(() => {
      realCards = 'failed';
    });
}
export const realCardsState = () => realCards;

/**
 * One card's geometry for a flora species (unit height: flora.js scales by
 * the tree's height): two crossed upright quads and a crown quad on top.
 */
export function cardGeometry(kind) {
  const cell = CELLS[PICTURE[kind] || 'broad'];
  const [su0, sv0, su1, sv1] = cell.side;
  const [tu0, tv0, tu1, tv1] = cell.top;
  const w = WIDTH[PICTURE[kind] || 'broad'];
  const pos = [];
  const uv = [];
  const nrm = [];
  const idx = [];
  const quad = (a, b, c, d, u, n) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    uv.push(u[0], u[1], u[2], u[1], u[2], u[3], u[0], u[3]);
    for (let i = 0; i < 4; i++) nrm.push(...n);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  quad([-w, 0, 0], [w, 0, 0], [w, 1, 0], [-w, 1, 0], [su0, sv0, su1, sv1], [0, 0.4, 0.9]);
  quad([0, 0, -w], [0, 0, w], [0, 1, w], [0, 1, -w], [su0, sv0, su1, sv1], [0.9, 0.4, 0]);
  const top = kind === 2 ? 0.55 : 0.62;
  quad([-w, top, w], [w, top, w], [w, top, -w], [-w, top, -w], [tu0, tv0, tu1, tv1], [0, 1, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** The card material: the atlas, alpha-tested, both sides, tinted per tree. */
export function cardMaterial() {
  const map = cardAtlas();
  return new THREE.MeshStandardMaterial({
    map,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    roughness: 0.95,
    metalness: 0,
    vertexColors: false,
  });
}
