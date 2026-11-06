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
 *
 * THE BIOMES (worldmap/biomes.js): the atlas grew to eight columns by four rows,
 * the old block top-left, and every species has its own picture now: the birch,
 * and the biomes' six drawn here on the canvas, so a jungle, a flat-topped
 * savanna, a snowed-in pine wood and an autumn wood differ from high up. All of
 * them draw in ONE call: mergedCardGeometry + mergedCardMaterial take each card's
 * picture and width from its species (`aKind`), which is what lets twelve species
 * cost no more draw calls than four did, and Low have cards at all.
 */
import * as THREE from '../../vendor/three.module.js';

/** Atlas cells: [u0, v0, u1, v1] for the side view and the top view of each picture. */
const COLS = 8;
const ROWS = 4;
/** Each picture's slot, [column, block]: a block is two rows, the side view over the top view. */
const SLOT = {
  broad: [0, 0], conifer: [1, 0], palm: [2, 0], scrub: [3, 0],
  birch: [4, 0], hardwood: [5, 0], acacia: [6, 0], cactus: [7, 0],
  snowpine: [0, 1], mangrove: [1, 1], autumn: [2, 1],
};
const CELLS = Object.fromEntries(Object.entries(SLOT).map(([name, [col, block]]) => {
  const u0 = col / COLS;
  const u1 = (col + 1) / COLS;
  const v = 1 - (block * 2) / ROWS;
  return [name, { side: [u0, v - 1 / ROWS, u1, v], top: [u0, v - 2 / ROWS, u1, v - 1 / ROWS] }];
}));
/** flora.js SPECIES to pictures (thorn, which the World Map does not plant, is an acacia in all but name). */
const PICTURE = ['palm', 'broad', 'conifer', 'scrub', 'birch', 'acacia', 'hardwood', 'acacia', 'cactus', 'snowpine', 'mangrove', 'autumn'];
/** Half-width of each picture's card (unit height), as wide as the real tree it was drawn from. */
const WIDTH = { palm: 0.5, broad: 0.58, conifer: 0.22, scrub: 0.6, birch: 0.3, hardwood: 0.84, acacia: 0.6, cactus: 0.3, snowpine: 0.3, mangrove: 0.5, autumn: 0.6 };
/** Where the card's crown quad lies (unit height). */
const CROWN = { conifer: 0.55, hardwood: 0.74, acacia: 0.82, cactus: 0.6, snowpine: 0.5, mangrove: 0.76 };
/** The real trees' pictures (made by drawing the real models; see above). */
export const REAL_CARDS_URL = new URL('../../../assets/models/real/scenery/tree-cards.webp', import.meta.url).href;
let realCards = null; // 'loading' | 'ready' | 'failed'

let atlas = null;
let atlasScale = 0;
function rnd(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/**
 * The atlas texture (made once a scale: Low's is half the size, a quarter of the memory).
 * The first four columns are drawn on a canvas of their own, `c`, where the real
 * trees' picture lands when it arrives, and copied into the atlas.
 */
export function cardAtlas(scale = atlasScale || 1) {
  if (atlas && atlasScale === scale) return atlas;
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
  const whole = document.createElement('canvas');
  whole.width = (W * 2) * scale;
  whole.height = (H * 2) * scale;
  const wg = whole.getContext('2d');
  wg.scale(scale, scale);
  drawBiomePictures(wg, R);
  const copy = () => {
    wg.clearRect(0, 0, W, H);
    wg.drawImage(c, 0, 0);
  };
  copy();
  if (atlas) atlas.dispose();
  const t = new THREE.CanvasTexture(whole);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  atlas = t;
  atlasScale = scale;
  realCards = null;
  repaintFromRealTrees(c, g, t, copy);
  return t;
}

/* ---- the biomes' pictures ---- */

function mix3(a, b, k) {
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * k)},${Math.round(a[1] + (b[1] - a[1]) * k)},${Math.round(a[2] + (b[2] - a[2]) * k)})`;
}

/** Leaves: dabs in an ellipse, lit from the upper left, darker under; most dabs near the edge of the mass are small. */
function dabs(g, R, cx, cy, rx, ry, n, light, dark, size) {
  // A dark mass first, so no sky shows through the middle of a crown.
  g.fillStyle = mix3(dark, light, 0.12);
  g.beginPath();
  g.ellipse(cx, cy, rx * 0.86, ry * 0.86, 0, 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2;
    const d = Math.sqrt(R());
    const x = cx + Math.cos(a) * rx * d;
    const y = cy + Math.sin(a) * ry * d;
    const k = Math.min(1, Math.max(0, 0.5 + ((cx - x) / rx) * 0.32 + ((cy - y) / ry) * 0.5 + (R() - 0.5) * 0.34));
    g.fillStyle = mix3(dark, light, k);
    g.beginPath();
    g.arc(x, y, size * (0.5 + R() * 0.7) * (1.15 - d * 0.5), 0, Math.PI * 2);
    g.fill();
  }
}

/** Thousands of leaves over a picture's masses (only on what is already drawn): up close a dab is a spray of leaves, not a flat disc. */
function leafGrain(g, R, S, n) {
  g.save();
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < n; i++) {
    g.fillStyle = R() < 0.5 ? 'rgba(255,250,200,0.2)' : 'rgba(0,16,4,0.3)';
    const r = 1 + R() * 2.2;
    g.fillRect(R() * S, R() * S, r, r * (0.6 + R()));
  }
  g.restore();
}

function limb(g, pts, w0, w1, col) {
  g.strokeStyle = col;
  g.lineCap = 'round';
  for (let i = 1; i < pts.length; i++) {
    g.lineWidth = w0 + ((w1 - w0) * i) / (pts.length - 1);
    g.beginPath();
    g.moveTo(pts[i - 1][0], pts[i - 1][1]);
    g.lineTo(pts[i][0], pts[i][1]);
    g.stroke();
  }
}

/** Run `side` and `top` with (0, 0)-(S, S) as each view's own cell of a picture. */
function cell(g, R, name, side, top) {
  const [col, block] = SLOT[name];
  const S = 256;
  g.save();
  g.translate(col * S, block * 2 * S);
  // (A picture draws in its own cell and no further, or the grain would reach its neighbours.)
  g.beginPath();
  g.rect(0, 0, S, S);
  g.clip();
  side(S);
  if (name !== 'cactus' && name !== 'snowpine') leafGrain(g, R, S, 1400);
  g.restore();
  g.save();
  g.translate(col * S, (block * 2 + 1) * S);
  g.beginPath();
  g.rect(0, 0, S, S);
  g.clip();
  top(S);
  if (name !== 'cactus' && name !== 'snowpine') {
    leafGrain(g, R, S, 1100);
  }
  g.restore();
}

function drawBiomePictures(g, R) {
  // Birch: a thin white stem, a narrow lit crown.
  cell(g, R, 'birch', (S) => {
    limb(g, [[S * 0.5, S], [S * 0.5, S * 0.3]], S * 0.03, S * 0.014, '#d8d6cc');
    for (let i = 0; i < 5; i++) {
      g.fillStyle = '#39352e';
      g.fillRect(S * 0.484, S * (0.6 + i * 0.08), S * 0.03, S * 0.01);
    }
    dabs(g, R, S * 0.5, S * 0.4, S * 0.24, S * 0.34, 90, [196, 214, 120], [74, 100, 44], S * 0.06);
  }, (S) => dabs(g, R, S * 0.5, S * 0.5, S * 0.3, S * 0.3, 70, [190, 208, 118], [70, 96, 42], S * 0.07));
  // Jungle: not one tree on a stick but a mass of them, ground to crown, lumpy on the skyline: a tier's few
  // thousand of these have to close the roof, where a forest of stems would show the floor between them.
  cell(g, R, 'hardwood', (S) => {
    const deep = [14, 44, 22];
    // (All well inside the cell: a mass that touches its edge is cut off square, a wall of cubes.)
    dabs(g, R, S * 0.5, S * 0.8, S * 0.36, S * 0.16, 40, [58, 106, 52], deep, S * 0.05);
    dabs(g, R, S * 0.3, S * 0.56, S * 0.2, S * 0.24, 36, [74, 128, 60], deep, S * 0.05);
    dabs(g, R, S * 0.7, S * 0.52, S * 0.2, S * 0.26, 36, [80, 134, 64], deep, S * 0.05);
    dabs(g, R, S * 0.5, S * 0.32, S * 0.28, S * 0.22, 54, [80, 126, 60], [20, 56, 28], S * 0.05);
    dabs(g, R, S * 0.27, S * 0.3, S * 0.13, S * 0.11, 18, [86, 130, 62], [22, 60, 30], S * 0.04);
    dabs(g, R, S * 0.73, S * 0.25, S * 0.14, S * 0.12, 20, [86, 130, 62], [22, 60, 30], S * 0.04);
  }, (S) => {
    dabs(g, R, S * 0.5, S * 0.5, S * 0.38, S * 0.38, 60, [72, 114, 56], [16, 48, 24], S * 0.07);
    for (const [x, y, r] of [[0.32, 0.36, 0.16], [0.66, 0.38, 0.17], [0.38, 0.66, 0.16], [0.66, 0.66, 0.15], [0.5, 0.5, 0.14]]) dabs(g, R, S * x, S * y, S * r, S * r, 22, [84, 128, 60], [26, 70, 32], S * 0.045);
  });
  // Acacia: forked limbs under one thin flat table.
  cell(g, R, 'acacia', (S) => {
    const bark = '#55412f';
    limb(g, [[S * 0.5, S], [S * 0.51, S * 0.62]], S * 0.04, S * 0.03, bark);
    limb(g, [[S * 0.51, S * 0.66], [S * 0.3, S * 0.34]], S * 0.024, S * 0.01, bark);
    limb(g, [[S * 0.51, S * 0.66], [S * 0.72, S * 0.36]], S * 0.024, S * 0.01, bark);
    limb(g, [[S * 0.51, S * 0.7], [S * 0.47, S * 0.33]], S * 0.018, S * 0.008, bark);
    limb(g, [[S * 0.4, S * 0.5], [S * 0.16, S * 0.33]], S * 0.012, S * 0.006, bark);
    limb(g, [[S * 0.62, S * 0.5], [S * 0.86, S * 0.33]], S * 0.012, S * 0.006, bark);
    dabs(g, R, S * 0.5, S * 0.27, S * 0.43, S * 0.07, 90, [172, 178, 92], [76, 86, 40], S * 0.035);
    dabs(g, R, S * 0.26, S * 0.29, S * 0.22, S * 0.055, 30, [164, 170, 86], [70, 80, 38], S * 0.035);
    dabs(g, R, S * 0.74, S * 0.29, S * 0.22, S * 0.055, 30, [180, 184, 96], [78, 88, 42], S * 0.035);
  }, (S) => {
    dabs(g, R, S * 0.5, S * 0.5, S * 0.42, S * 0.4, 110, [176, 182, 94], [70, 80, 38], S * 0.045);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 26; i++) {
      const a = R() * Math.PI * 2;
      const d = 0.34 + R() * 0.2;
      g.beginPath();
      g.arc(S * (0.5 + Math.cos(a) * d), S * (0.5 + Math.sin(a) * d), S * (0.02 + R() * 0.03), 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  });
  // Cactus: a fluted column with two arms, sunlit on the left.
  cell(g, R, 'cactus', (S) => {
    const column = (x0, x1, y0, y1) => {
      const w = x1 - x0;
      const gr = g.createLinearGradient(x0, 0, x1, 0);
      gr.addColorStop(0, '#7f9c63');
      gr.addColorStop(0.45, '#5b7a48');
      gr.addColorStop(1, '#2f4a2c');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(x0, y1);
      g.lineTo(x0, y0 + w / 2);
      g.arc((x0 + x1) / 2, y0 + w / 2, w / 2, Math.PI, 0);
      g.lineTo(x1, y1);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(30,50,28,0.55)';
      g.lineWidth = S * 0.006;
      for (let i = 1; i < 4; i++) {
        g.beginPath();
        g.moveTo(x0 + (w * i) / 4, y0 + w * 0.3);
        g.lineTo(x0 + (w * i) / 4, y1);
        g.stroke();
      }
    };
    column(S * 0.43, S * 0.57, S * 0.02, S);
    column(S * 0.68, S * 0.77, S * 0.24, S * 0.56);
    column(S * 0.24, S * 0.32, S * 0.15, S * 0.46);
    limb(g, [[S * 0.55, S * 0.6], [S * 0.72, S * 0.58]], S * 0.075, S * 0.075, '#4e6c40');
    limb(g, [[S * 0.45, S * 0.48], [S * 0.28, S * 0.46]], S * 0.065, S * 0.065, '#4e6c40');
  }, (S) => {
    dabs(g, R, S * 0.5, S * 0.5, S * 0.17, S * 0.17, 20, [130, 156, 100], [48, 72, 44], S * 0.05);
  });
  // Snow-loaded pine: dark boughs under white shoulders.
  cell(g, R, 'snowpine', (S) => {
    limb(g, [[S * 0.5, S], [S * 0.5, S * 0.8]], S * 0.04, S * 0.03, '#3a2f26');
    for (let t = 0; t < 7; t++) {
      const y = S * (0.87 - t * 0.115);
      const w = S * (0.42 - t * 0.052);
      const h = S * 0.17;
      // The bough, dark, its hem ragged.
      g.fillStyle = '#1d3129';
      g.beginPath();
      g.moveTo(S * 0.5, y - h);
      for (let i = 0; i <= 8; i++) g.lineTo(S * 0.5 - w + (w * 2 * i) / 8, y + (i % 2 ? S * 0.024 : 0));
      g.closePath();
      g.fill();
      // Snow on it: a white cap, thicker to the sunlit left, stopping short of the hem.
      g.fillStyle = t % 2 ? '#eef2f8' : '#e2e8f1';
      g.beginPath();
      g.moveTo(S * 0.5, y - h - S * 0.006);
      g.lineTo(S * 0.5 - w * 0.86, y - S * 0.022);
      for (let i = 0; i <= 6; i++) g.lineTo(S * 0.5 - w * 0.86 + (w * 1.5 * i) / 6, y - S * 0.05 + (i % 2 ? S * 0.024 : -S * 0.004));
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(150,172,200,0.5)';
      g.beginPath();
      g.moveTo(S * 0.5, y - h);
      g.lineTo(S * 0.5 + w * 0.66, y - S * 0.04);
      g.lineTo(S * 0.5 + w * 0.18, y - S * 0.04);
      g.closePath();
      g.fill();
    }
  }, (S) => {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      g.strokeStyle = '#1f352c';
      g.lineWidth = S * 0.07;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(S * 0.5, S * 0.5);
      g.lineTo(S * (0.5 + Math.cos(a) * 0.34), S * (0.5 + Math.sin(a) * 0.34));
      g.stroke();
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + 0.2;
      g.strokeStyle = i % 2 ? '#eef2f8' : '#d6dfeb';
      g.lineWidth = S * 0.05;
      g.beginPath();
      g.moveTo(S * (0.5 + Math.cos(a) * 0.04), S * (0.5 + Math.sin(a) * 0.04));
      g.lineTo(S * (0.5 + Math.cos(a) * 0.26), S * (0.5 + Math.sin(a) * 0.26));
      g.stroke();
    }
  });
  // Mangrove: arching stilt roots under a low dark crown.
  cell(g, R, 'mangrove', (S) => {
    g.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const x = 0.14 + i * 0.09;
      g.strokeStyle = i % 2 ? '#4a3a2d' : '#5c4938';
      g.lineWidth = S * 0.018;
      g.beginPath();
      g.moveTo(S * x, S);
      g.quadraticCurveTo(S * (x + (0.5 - x) * 0.1), S * 0.72, S * 0.5, S * 0.62);
      g.stroke();
    }
    limb(g, [[S * 0.5, S * 0.66], [S * 0.5, S * 0.4]], S * 0.045, S * 0.03, '#4a3a2d');
    dabs(g, R, S * 0.5, S * 0.32, S * 0.38, S * 0.25, 100, [96, 140, 76], [18, 46, 26], S * 0.055);
  }, (S) => dabs(g, R, S * 0.5, S * 0.5, S * 0.39, S * 0.39, 100, [98, 142, 78], [18, 46, 26], S * 0.06));
  // Autumn broadleaf: a full round crown in a pale gold, for flora.js AUTUMN to turn each tree its own colour.
  cell(g, R, 'autumn', (S) => {
    limb(g, [[S * 0.5, S], [S * 0.5, S * 0.56]], S * 0.05, S * 0.03, '#4a3a2c');
    limb(g, [[S * 0.5, S * 0.7], [S * 0.34, S * 0.5]], S * 0.022, S * 0.012, '#4a3a2c');
    limb(g, [[S * 0.5, S * 0.68], [S * 0.66, S * 0.48]], S * 0.022, S * 0.012, '#4a3a2c');
    dabs(g, R, S * 0.5, S * 0.42, S * 0.4, S * 0.34, 130, [232, 196, 126], [126, 80, 38], S * 0.055);
  }, (S) => dabs(g, R, S * 0.5, S * 0.5, S * 0.4, S * 0.4, 130, [232, 198, 128], [122, 78, 36], S * 0.06));
}

/**
 * The conifer cell's tint (linear): the picture's side averages linear (0.085, 0.095, 0.041) where the
 * game's firs are (0.020, 0.080, 0.029) — scenery.js conifer, sRGB 0.13-0.17, 0.28-0.34, 0.17-0.20.
 */
export const CONIFER_CARD_TINT = [0.235, 0.842, 0.707];

/** A linear-light multiplier as the one to apply to sRGB values (a multiply of sRGB values is ~ a multiply of linear by its 2.2 power). */
export function srgbMultiplier(lin) {
  return lin.map((v) => Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2));
}

/**
 * Multiply the colour (not the alpha) of the foliage in a block of the atlas by a linear tint: the
 * green pixels (green over red), fading out to the bark, which keeps its own brown.
 */
export function tintCells(g, x, y, w, h, linTint) {
  if (!linTint || !g || typeof g.getImageData !== 'function') return false;
  const [mr, mg, mb] = srgbMultiplier(linTint);
  const im = g.getImageData(x, y, w, h);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const k = Math.max(0, Math.min(1, (d[i + 1] - d[i]) / 24));
    const f = k * k * (3 - 2 * k);
    d[i] = Math.round(d[i] * (1 + (mr - 1) * f));
    d[i + 1] = Math.round(d[i + 1] * (1 + (mg - 1) * f));
    d[i + 2] = Math.round(d[i + 2] * (1 + (mb - 1) * f));
  }
  g.putImageData(im, x, y);
  return true;
}

/** The real trees' pictures over the drawn ones, when (and if) they arrive. */
function repaintFromRealTrees(c, g, t, copy) {
  if (realCards || typeof fetch !== 'function' || typeof createImageBitmap !== 'function') return;
  realCards = 'loading';
  fetch(REAL_CARDS_URL)
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((b) => createImageBitmap(b))
    .then((img) => {
      // Broadleaf, conifer and palm (the first three cells, both rows); the scrub keeps its drawing.
      g.clearRect(0, 0, 768, c.height);
      g.drawImage(img, 0, 0, 768, c.height, 0, 0, 768, c.height);
      // The conifer's picture is the real pine, pale and yellow-olive beside the game's own firs (flora.js
      // plants those in front of the cards): to the firs' green, as the near real pines are (real-scenery.js
      // leafTint), so the far woods are not paler than the trees in front of them.
      tintCells(g, 256, 0, 256, c.height, CONIFER_CARD_TINT);
      copy();
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
  const top = CROWN[PICTURE[kind]] || 0.62;
  quad([-w, top, w], [w, top, w], [w, top, -w], [-w, top, -w], [tu0, tv0, tu1, tv1], [0, 1, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** The card material: the atlas, alpha-tested, both sides, tinted per tree. */
export function cardMaterial(scale = atlasScale || 1) {
  const map = cardAtlas(scale);
  return new THREE.MeshStandardMaterial({
    map,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    roughness: 0.95,
    metalness: 0,
    vertexColors: false,
  });
}

/**
 * One card for every species: a unit-wide card whose picture, width and crown
 * height come from its instance's species (aKind, set by flora.js). The uv is
 * 0..1 over a quad; the crown quad is the one facing up.
 */
export function mergedCardGeometry() {
  const pos = [];
  const nrm = [];
  const uv = [];
  const idx = [];
  const quad = (a, b, c, d, n) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    for (let i = 0; i < 4; i++) nrm.push(...n);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  // Three upright, sixty degrees apart, so no card is ever seen edge-on as a thin stripe; lit from above, not by which way each faces.
  for (let i = 0; i < 3; i++) {
    const c = Math.cos((i * Math.PI) / 3);
    const s = Math.sin((i * Math.PI) / 3);
    quad([-c, 0, -s], [c, 0, s], [c, 1, s], [-c, 1, -s], [-s * 0.6, 0.8, c * 0.6]);
  }
  quad([-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1], [0, 1, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** cardMaterial, reading the picture off aKind. Species: flora.js SPECIES order. */
export function mergedCardMaterial(scale = 1) {
  const m = cardMaterial(scale);
  const cells = PICTURE.map((p) => CELLS[p].side[0]);
  const rows = PICTURE.map((p) => CELLS[p].side[1]);
  const widths = PICTURE.map((p) => WIDTH[p]);
  const crowns = PICTURE.map((p) => CROWN[p] || 0.62);
  const arr = (list) => `float[${list.length}](${list.map((v) => v.toFixed(5)).join(',')})`;
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aKind;
const float CARD_U[${cells.length}] = ${arr(cells)};
const float CARD_V[${cells.length}] = ${arr(rows)};
const float CARD_W[${cells.length}] = ${arr(widths)};
const float CARD_C[${cells.length}] = ${arr(crowns)};`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
  int cardKind = int(aKind + 0.5);
  bool cardTop = normal.y > 0.95;
  vMapUv = vec2(CARD_U[cardKind], CARD_V[cardKind] - (cardTop ? ${(1 / ROWS).toFixed(5)} : 0.0)) + uv * vec2(${(1 / COLS).toFixed(5)}, ${(1 / ROWS).toFixed(5)});`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  transformed.xz *= CARD_W[cardKind];
  if (cardTop) transformed.y = CARD_C[cardKind];`);
    // Lit the same from both faces. Turned over, a card's far side went dark and two crossed cards read as a box.
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
  normal = normalize(vNormal);`).replace('#include <alphatest_fragment>', `diffuseColor.a *= smoothstep(26.0, 60.0, length(vViewPosition));
#include <alphatest_fragment>`);
    // (And gone within a few dozen metres of the eye: a picture that close is a flat picture, and nothing solid stands there.)
  };
  m.customProgramCacheKey = () => 'tree-cards-merged';
  return m;
}
