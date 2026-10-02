/**
 * The spaceport: "an actual launch area".
 *
 * Around the pad — a raised concrete hardstand with a flame trench cut
 * through it and a steel deflector in the hole, the rocket standing on a
 * launch mount over it, held by four clamps — stand a lattice service tower
 * whose access arms swing away during the countdown, a water tower for the
 * deluge, the oxygen sphere and the fuel tanks with their pipes, lightning
 * masts with a wire slung between them, floodlights, a fence with a gate and
 * signs. Back along the flight line is the landing zone with its big painted
 * circle; off to the side the hangar the rockets are put together in, the
 * control centre and the crawler road up to the pad; out at sea, the ship.
 *
 * Where each piece goes is worked out (site.js planSpaceport) for whichever
 * island is loaded, on dry and flat enough ground, and every piece stands on
 * a foundation that reaches down below the lowest ground under it — so
 * nothing floats and nothing is half buried. The island's trees are moved
 * out of the way while the spaceport stands (clearFootprints) and put back
 * after.
 *
 * Cheap: all of it that does not move is baked into a few merged meshes per
 * area (paint, steel, ground markings, one textured mesh per kind of wall),
 * the tower is one instanced mesh, each access arm one mesh, and the small
 * things — fence, lights, pipes, signs, wires — are in an LOD that drops
 * them once the camera is far away. About thirty draw calls in all.
 */

import * as THREE from '../../vendor/three.module.js';
import { Bake, mtx, paintMat, drawEmblem, mixHex } from './models.js';
import { PAD_HALF, PAD_TOP, LZ_R, BARGE_HALF, BARGE_HALF_W, BARGE_DECK, padToWorld, worldToPad } from './site.js';

const CONCRETE = 0xa9adb1;
const CONCRETE_DK = 0x8f9397;
const TRENCH = 0x5f6266;
const TOWER_RED = 0xc8432f;
const STEEL_GREY = 0x8d939b;
const WHITE = 0xeef0f2;

/** Half the width of the flame hole and the trench. */
const HOLE = 3.4;
/** How far the trench's apron runs out beyond the deck. */
const SPILL = 16;

/* ------------------------------------------------------------------ */
/* Textures, drawn in code                                             */
/* ------------------------------------------------------------------ */

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function tex(kit, c, { aniso = 4, repeat = false } = {}) {
  const t = kit.tex(new THREE.CanvasTexture(c));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

function speckle(g, w, h, n, seed, dark = 0.07, light = 0.06) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const s = 1 + r() * 2.5;
    g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${dark * r()})` : `rgba(255,255,255,${light * r()})`;
    g.fillRect(r() * w, r() * h, s, s);
  }
}

function hazard(g, x, y, w, h, s = 10) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = '#f2c230';
  g.fillRect(x, y, w, h);
  g.fillStyle = '#1d1f22';
  for (let k = -h; k < w + h; k += s * 2) {
    g.beginPath();
    g.moveTo(x + k, y);
    g.lineTo(x + k + s, y);
    g.lineTo(x + k + s - h, y + h);
    g.lineTo(x + k - h, y + h);
    g.fill();
  }
  g.restore();
}

/** The top of the pad, 48 m square: concrete, joints, scorch, hazard edges, LC-1. */
function deckTexture(kit) {
  const S = 512;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const px = S / (PAD_HALF * 2);
  const X = (u) => (u + PAD_HALF) * px;
  g.fillStyle = '#b2b6ba';
  g.fillRect(0, 0, S, S);
  speckle(g, S, S, 5000, 3);
  // Expansion joints every 6 m.
  g.strokeStyle = 'rgba(90,96,102,0.45)';
  g.lineWidth = 1;
  for (let m = -PAD_HALF + 6; m < PAD_HALF; m += 6) {
    g.beginPath();
    g.moveTo(X(m) + 0.5, 0);
    g.lineTo(X(m) + 0.5, S);
    g.moveTo(0, X(m) + 0.5);
    g.lineTo(S, X(m) + 0.5);
    g.stroke();
  }
  // Scorch round the hole, blown out along the trench.
  const sc = g.createRadialGradient(X(0), X(0), px * 3, X(0), X(0), px * 17);
  sc.addColorStop(0, 'rgba(40,36,32,0.75)');
  sc.addColorStop(0.5, 'rgba(60,54,48,0.32)');
  sc.addColorStop(1, 'rgba(70,64,58,0)');
  g.fillStyle = sc;
  g.fillRect(0, 0, S, S);
  const st = g.createLinearGradient(X(0), 0, X(PAD_HALF), 0);
  st.addColorStop(0, 'rgba(40,36,32,0.55)');
  st.addColorStop(1, 'rgba(40,36,32,0.08)');
  g.fillStyle = st;
  g.fillRect(X(0), X(-HOLE - 5), X(PAD_HALF) - X(0), px * (HOLE * 2 + 10));
  // Hazard stripes along the edges of the hole and the trench.
  const e = px * 0.9;
  hazard(g, X(-HOLE) - e, X(-HOLE) - e, e, px * HOLE * 2 + 2 * e, 6);
  hazard(g, X(-HOLE) - e, X(-HOLE) - e, X(PAD_HALF) - X(-HOLE) + e, e, 6);
  hazard(g, X(-HOLE) - e, X(HOLE), X(PAD_HALF) - X(-HOLE) + e, e, 6);
  // A yellow edge line round the deck, and the crawler's lane up the ramp.
  g.strokeStyle = '#e8b927';
  g.lineWidth = px * 0.4;
  g.strokeRect(px * 1, px * 1, S - px * 2, S - px * 2);
  g.setLineDash([px * 2, px * 1.5]);
  g.beginPath();
  g.moveTo(0, X(-6));
  g.lineTo(X(-10), X(-6));
  g.moveTo(0, X(6));
  g.lineTo(X(-10), X(6));
  g.stroke();
  g.setLineDash([]);
  // The pad's name, painted big where the camera can read it.
  g.fillStyle = 'rgba(245,246,247,0.9)';
  g.font = `900 ${Math.round(px * 7)}px "Arial Black", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('LC-1', X(-13), X(14));
  return tex(kit, c);
}

/** The landing zone: concrete, a big white ring, a smaller circle, LZ-1, scorch. */
function lzTexture(kit) {
  const S = 512;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  g.fillStyle = '#a6aaae';
  g.fillRect(0, 0, S, S);
  speckle(g, S, S, 4000, 9);
  const m = S / 2;
  g.strokeStyle = 'rgba(90,96,102,0.4)';
  g.lineWidth = 1;
  for (let k = 0; k < S; k += S / 10) {
    g.beginPath();
    g.moveTo(k + 0.5, 0);
    g.lineTo(k + 0.5, S);
    g.moveTo(0, k + 0.5);
    g.lineTo(S, k + 0.5);
    g.stroke();
  }
  const sc = g.createRadialGradient(m, m, 0, m, m, S * 0.3);
  sc.addColorStop(0, 'rgba(36,32,28,0.7)');
  sc.addColorStop(1, 'rgba(50,45,40,0)');
  g.fillStyle = sc;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = '#f5f6f7';
  g.lineWidth = S * 0.045;
  g.beginPath();
  g.arc(m, m, S * 0.42, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = S * 0.02;
  g.beginPath();
  g.arc(m, m, S * 0.15, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#f5f6f7';
  g.font = `900 ${Math.round(S * 0.11)}px "Arial Black", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('LZ-1', m, m + S * 0.29);
  // Little cross-hairs at the middle.
  g.fillRect(m - S * 0.05, m - 2, S * 0.1, 4);
  g.fillRect(m - 2, m - S * 0.05, 4, S * 0.1);
  return tex(kit, c);
}

/** The ship's deck: steel plates, the ring and the cross, edge stripes, its name. */
function bargeTexture(kit, name) {
  const W = 1024;
  const H = 640;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#4b5057';
  g.fillRect(0, 0, W, H);
  speckle(g, W, H, 6000, 21, 0.1, 0.05);
  g.strokeStyle = 'rgba(30,32,36,0.6)';
  g.lineWidth = 1;
  for (let x = 0; x < W; x += 40) {
    g.beginPath();
    g.moveTo(x + 0.5, 0);
    g.lineTo(x + 0.5, H);
    g.stroke();
  }
  for (let y = 0; y < H; y += 80) {
    g.beginPath();
    g.moveTo(0, y + 0.5);
    g.lineTo(W, y + 0.5);
    g.stroke();
  }
  const cx = W / 2;
  const cy = H / 2;
  const R = H * 0.38;
  const sc = g.createRadialGradient(cx, cy, 0, cx, cy, R);
  sc.addColorStop(0, 'rgba(20,18,16,0.55)');
  sc.addColorStop(1, 'rgba(20,18,16,0)');
  g.fillStyle = sc;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#f5f6f7';
  g.lineWidth = 16;
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = '#ffc247';
  g.lineWidth = 30;
  g.lineCap = 'round';
  const a = R * 0.55;
  g.beginPath();
  g.moveTo(cx - a, cy - a);
  g.lineTo(cx + a, cy + a);
  g.moveTo(cx + a, cy - a);
  g.lineTo(cx - a, cy + a);
  g.stroke();
  hazard(g, 0, 0, W, 14, 12);
  hazard(g, 0, H - 14, W, 14, 12);
  g.fillStyle = 'rgba(245,246,247,0.85)';
  g.font = `900 ${Math.round(H * 0.07)}px "Arial Black", Arial, sans-serif`;
  g.textAlign = 'center';
  g.fillText(name, cx, H - 40);
  return tex(kit, c);
}

/** Chain-link: a diamond mesh on clear, repeated along the fence. */
function fenceTexture(kit) {
  const c = canvas(64, 64);
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(160,166,172,1)';
  g.lineWidth = 2;
  for (let k = -64; k <= 64; k += 16) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + 64, 64);
    g.moveTo(k + 64, 0);
    g.lineTo(k, 64);
    g.stroke();
  }
  g.fillStyle = 'rgba(120,126,132,1)';
  g.fillRect(0, 0, 64, 3);
  g.fillRect(0, 61, 64, 3);
  return tex(kit, c, { repeat: true, aniso: 2 });
}

/**
 * Every sign on the site in one picture, eight slots of 512×256:
 *   0 SPACEPORT + island   1 DANGER   2 LAUNCH COMPLEX 1   3 LZ-1
 *   4 the ship's name      5 LAUNCH CONTROL   6 the hangar's name   7 LOX/FUEL
 */
function signAtlas(kit, islandName, shipName) {
  const c = canvas(1024, 1024);
  const g = c.getContext('2d');
  const slot = (i, draw) => {
    g.save();
    g.translate((i % 2) * 512, Math.floor(i / 2) * 256);
    g.beginPath();
    g.rect(0, 0, 512, 256);
    g.clip();
    draw();
    g.restore();
  };
  const text = (t, x, y, size, colour = '#ffffff', weight = '900', family = '"Arial Black", Arial, sans-serif') => {
    g.fillStyle = colour;
    g.font = `${weight} ${size}px ${family}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(t, x, y);
  };
  slot(0, () => {
    g.fillStyle = '#1d2a44';
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#b28dff';
    g.fillRect(0, 226, 512, 30);
    drawEmblem(g, 78, 112, 62);
    text('SPACEPORT', 300, 92, 58);
    text(islandName || 'Island launch site', 300, 160, 30, '#c9d6ea', 'bold', 'Arial, sans-serif');
  });
  slot(1, () => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#c8102e';
    g.fillRect(0, 0, 512, 92);
    text('DANGER', 256, 48, 66);
    text('ROCKET LAUNCH AREA', 256, 140, 40, '#1d1f22');
    text('KEEP OUT', 256, 205, 44, '#c8102e');
  });
  slot(2, () => {
    g.fillStyle = '#1d2a44';
    g.fillRect(0, 0, 512, 256);
    hazard(g, 0, 0, 512, 24, 14);
    hazard(g, 0, 232, 512, 24, 14);
    text('LAUNCH', 256, 92, 70);
    text('COMPLEX 1', 256, 172, 70, '#ffc247');
  });
  slot(3, () => {
    g.fillStyle = '#1d2a44';
    g.fillRect(0, 0, 512, 256);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 12;
    g.beginPath();
    g.arc(110, 128, 80, 0, Math.PI * 2);
    g.stroke();
    text('LZ-1', 340, 100, 84);
    text('LANDING ZONE', 340, 180, 34, '#c9d6ea');
  });
  slot(4, () => {
    g.fillStyle = '#2f3a46';
    g.fillRect(0, 0, 512, 256);
    text(shipName, 256, 128, 78, '#f2f4f7');
  });
  slot(5, () => {
    g.fillStyle = '#e9ebed';
    g.fillRect(0, 0, 512, 256);
    text('LAUNCH CONTROL', 256, 128, 56, '#1d2a44');
  });
  slot(6, () => {
    g.fillStyle = '#e9ebed';
    g.fillRect(0, 0, 512, 256);
    text('ROCKET', 256, 90, 80, '#1d2a44');
    text('ASSEMBLY', 256, 182, 80, '#1d2a44');
  });
  slot(7, () => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#2f6fb5';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#c8102e';
    g.fillRect(256, 0, 256, 256);
    text('LOX', 128, 128, 90);
    text('FUEL', 384, 128, 80);
  });
  return tex(kit, c);
}

/** UV corners for one atlas slot, in the order a PlaneGeometry lists them. */
function slotUV(i) {
  const u0 = (i % 2) * 0.5;
  const v1 = 1 - Math.floor(i / 2) * 0.25;
  return { u0, u1: u0 + 0.5, v0: v1 - 0.25, v1 };
}

/** A sign face: a plane facing +Z, its UVs remapped to an atlas slot. */
function signFace(b, slot, w, h, m, part = null) {
  const g = new THREE.PlaneGeometry(w, h);
  const { u0, u1, v0, v1 } = slotUV(slot);
  const uv = g.attributes.uv;
  const pu0 = part ? part[0] : 0;
  const pu1 = part ? part[1] : 1;
  for (let i = 0; i < uv.count; i++) {
    const uu = pu0 + (pu1 - pu0) * uv.getX(i);
    uv.setXY(i, u0 + (u1 - u0) * uu, v0 + (v1 - v0) * uv.getY(i));
  }
  b.add(g, 0xffffff, m);
}

/**
 * The hangar's walls: the door face (a tall slatted door with striped
 * edges), the face with the island's flag and emblem, and a plain face.
 */
function hangarTexture(kit, accent) {
  const W = 1024;
  const H = 512;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#dfe2e5';
  g.fillRect(0, 0, W, H);
  speckle(g, W, H, 3000, 31, 0.05, 0.05);
  // Vertical cladding panels everywhere.
  g.fillStyle = 'rgba(120,128,138,0.35)';
  for (let x = 0; x < W; x += 10) g.fillRect(x, 0, 1, H);
  g.fillStyle = 'rgba(80,86,94,0.5)';
  for (let y = 60; y < H; y += 120) g.fillRect(0, y, W, 2);
  // A dark plinth band.
  g.fillStyle = '#7d8288';
  g.fillRect(0, H - 18, W, 18);
  // Door face: [0, 0.4).
  const dw = W * 0.4;
  const doorW = dw * 0.42;
  const dx = (dw - doorW) / 2;
  g.fillStyle = '#8c939b';
  g.fillRect(dx, H * 0.08, doorW, H * 0.92 - 18);
  g.fillStyle = 'rgba(40,44,50,0.45)';
  for (let y = H * 0.08; y < H - 18; y += 9) g.fillRect(dx, y, doorW, 2);
  for (let k = 1; k < 4; k++) g.fillRect(dx + (doorW * k) / 4, H * 0.08, 2, H * 0.92 - 18);
  hazard(g, dx - 10, H * 0.08, 10, H * 0.92 - 18, 8);
  hazard(g, dx + doorW, H * 0.08, 10, H * 0.92 - 18, 8);
  // Emblem face: [0.4, 0.8): a big flag of the island and the emblem.
  const ex = W * 0.4;
  const ew = W * 0.4;
  const fx = ex + ew * 0.08;
  const fw = ew * 0.38;
  const fy = H * 0.12;
  const fh = H * 0.55;
  const stripes = ['#1d6fb8', '#f2f4f7', '#3fae5a', '#f2f4f7', '#ffc247'];
  stripes.forEach((col, i) => {
    g.fillStyle = col;
    g.fillRect(fx, fy + (fh * i) / stripes.length, fw, fh / stripes.length + 1);
  });
  drawEmblem(g, ex + ew * 0.72, H * 0.38, ew * 0.2, accent);
  g.fillStyle = '#1d2a44';
  g.font = `900 ${Math.round(H * 0.075)}px "Arial Black", Arial, sans-serif`;
  g.textAlign = 'center';
  g.fillText('ISLAND SPACE CENTRE', ex + ew / 2, H * 0.82);
  // Plain face: [0.8, 1] is the cladding as drawn.
  return tex(kit, c);
}

/** The control centre: two strips of blue windows and a stripe. */
function lccTexture(kit) {
  const W = 512;
  const H = 128;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#e4e6e9';
  g.fillRect(0, 0, W, H);
  speckle(g, W, H, 800, 41, 0.05, 0.05);
  for (const y of [22, 70]) {
    const gr = g.createLinearGradient(0, y, 0, y + 30);
    gr.addColorStop(0, '#2c4e78');
    gr.addColorStop(1, '#16273f');
    g.fillStyle = gr;
    g.fillRect(0, y, W, 30);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    for (let x = 0; x < W; x += 24) g.fillRect(x, y, 2, 30);
    g.fillStyle = 'rgba(180,210,255,0.25)';
    g.fillRect(0, y + 2, W, 4);
  }
  g.fillStyle = '#b28dff';
  g.fillRect(0, H - 10, W, 10);
  return tex(kit, c);
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

/** A foundation block from below the lowest ground up to `top`. */
function footing(b, u, v, hu, hv, bottom, top, color = CONCRETE_DK) {
  const h = Math.max(0.3, top - bottom);
  b.box(hu * 2, h, hv * 2, color, u, bottom + h / 2, v);
}

/** A ribbon laid on the ground along a polyline (a road), `w` wide. */
function ribbon(b, pts, w, gy, color, lift = 0.14) {
  // Resample every ~5 m so it follows the ground.
  const samples = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const c = pts[i];
    const len = Math.hypot(c.u - a.u, c.v - a.v);
    const n = Math.max(1, Math.ceil(len / 5));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) samples.push({ u: a.u + ((c.u - a.u) * k) / n, v: a.v + ((c.v - a.v) * k) / n });
  }
  const L = [];
  const R = [];
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i - 1] || samples[i];
    const q = samples[i + 1] || samples[i];
    let tu = q.u - p.u;
    let tv = q.v - p.v;
    const tl = Math.hypot(tu, tv) || 1;
    tu /= tl;
    tv /= tl;
    const s = samples[i];
    const lu = s.u - tv * w * 0.5;
    const lv = s.v + tu * w * 0.5;
    const ru = s.u + tv * w * 0.5;
    const rv = s.v - tu * w * 0.5;
    L.push([lu, gy(lu, lv) + lift, lv]);
    R.push([ru, gy(ru, rv) + lift, rv]);
  }
  for (let i = 1; i < samples.length; i++) b.quad(L[i - 1], L[i], R[i], R[i - 1], color, [0, 1, 0]);
}

/**
 * The service tower: a lattice of beams in one instanced mesh — columns,
 * a ring of beams and X-bracing every 4 m, landings, a stair up the back,
 * the lift shaft, a crane and a lightning rod on top.
 */
function towerMesh(kit, tc, base, TH) {
  const list = [];
  const add = (x, y, z, sx, sy, sz, col, rx = 0, rz = 0) => list.push([x, y, z, sx, sy, sz, col, rx, rz]);
  const hw = 2.0;
  for (const [dx, dz] of [[-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw]]) add(tc + dx, base + TH / 2, dz, 0.42, TH, 0.42, TOWER_RED);
  const diag = Math.hypot(4, hw * 2);
  const ang = Math.atan2(hw * 2, 4);
  for (let y = 0; y < TH - 0.5; y += 4) {
    const top = Math.min(4, TH - y);
    add(tc, base + y + top, -hw, hw * 2, 0.26, 0.26, TOWER_RED);
    add(tc, base + y + top, hw, hw * 2, 0.26, 0.26, TOWER_RED);
    add(tc - hw, base + y + top, 0, 0.26, 0.26, hw * 2, TOWER_RED);
    add(tc + hw, base + y + top, 0, 0.26, 0.26, hw * 2, TOWER_RED);
    if (top < 3.5) continue;
    for (const s of [1, -1]) {
      add(tc, base + y + 2, -hw, 0.16, diag, 0.16, 0xa83524, 0, s * ang);
      add(tc, base + y + 2, hw, 0.16, diag, 0.16, 0xa83524, 0, s * ang);
      add(tc - hw, base + y + 2, 0, 0.16, diag, 0.16, 0xa83524, s * ang, 0);
    }
    if ((y / 4) % 2 === 1) add(tc, base + y + 4 - 0.08, 0, hw * 2 + 0.2, 0.16, hw * 2 + 0.2, 0x9aa0a8);
    // The stair up the back, zig-zagging.
    const sx = (y / 4) % 2 === 0 ? 1 : -1;
    const stairAng = Math.atan2(4, hw * 2 - 0.4);
    add(tc, base + y + 2, -hw - 0.6, Math.hypot(4, hw * 2 - 0.4), 0.12, 0.8, 0x9aa0a8, 0, sx * stairAng);
  }
  // The lift shaft on the landward side.
  add(tc - hw - 0.75, base + TH / 2, 0.6, 1.3, TH, 1.5, 0xb9bec5);
  // The roof, a crane, a lightning rod.
  add(tc, base + TH + 0.15, 0, hw * 2 + 0.6, 0.3, hw * 2 + 0.6, 0x9aa0a8);
  add(tc, base + TH + 2.2, 0, 0.5, 4, 0.5, TOWER_RED);
  add(tc - 3.5, base + TH + 4.2, 0, 11, 0.55, 0.55, 0xe6b422);
  add(tc - 8.6, base + TH + 3.4, 0, 1.4, 1.4, 1.2, 0x5d6168);
  add(tc, base + TH + 9, 0, 0.18, 9, 0.18, STEEL_GREY);
  const mat = kit.mat({ color: 0xffffff, roughness: 0.55, metalness: 0.35 });
  const inst = new THREE.InstancedMesh(kit.geo(new THREE.BoxGeometry(1, 1, 1)), mat, list.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  list.forEach(([x, y, z, sx, sy, sz, c, rx, rz], i) => {
    m.compose(new THREE.Vector3(x, y, z), q.setFromEuler(e.set(rx, 0, rz)), new THREE.Vector3(sx, sy, sz));
    inst.setMatrixAt(i, m);
    inst.setColorAt(i, col.set(c));
  });
  inst.castShadow = true;
  inst.receiveShadow = true;
  inst.computeBoundingSphere();
  inst.name = 'tower';
  return inst;
}

/** One access arm, hinged at its root, reaching `len` metres along +X. */
function armMesh(kit, mat, len, room) {
  const b = new Bake();
  const z = 1.5;
  b.box(len, 0.16, 1.7, 0x9aa0a8, len / 2, 0, z);
  for (const s of [-1, 1]) {
    b.box(len, 0.1, 0.1, TOWER_RED, len / 2, 1.1, z + s * 0.8);
    b.box(len, 0.14, 0.14, TOWER_RED, len / 2, -0.55, z + s * 0.75);
    for (let x = 0.2; x < len; x += 0.9) {
      b.box(0.08, 1.1, 0.08, TOWER_RED, x, 0.55, z + s * 0.8);
      b.beam(x, -0.55, z + s * 0.75, Math.min(len, x + 0.9), 0, z + s * 0.75, 0.08, 0xa83524);
    }
  }
  b.box(0.5, 2.6, 0.5, 0x5d6168, 0.25, 0.4, 0);
  if (room) {
    // The white room the crew walk through to the hatch.
    b.box(1.9, 2.6, 2.3, WHITE, len - 0.95, 1.3, z);
    b.box(1.92, 0.25, 2.32, 0x2f6fb5, len - 0.95, 2.4, z);
  } else {
    // Umbilical hoses down to the rocket.
    b.beam(len - 0.4, -0.3, z - 0.4, len + 0.15, -1.6, z - 0.3, 0.14, 0x26282c);
    b.beam(len - 0.4, -0.3, z + 0.4, len + 0.15, -1.3, z + 0.3, 0.12, 0x26282c);
  }
  const m = b.mesh(kit, mat, 'arm');
  m.receiveShadow = true;
  return m;
}

function sphereTank(b, steel, u, v, floor, r, legs, band) {
  steel.add(new THREE.SphereGeometry(r, 28, 16), (x, y) => (Math.abs(y) < r * 0.08 ? band : WHITE), mtx(u, floor + legs + r * 0.2, v));
  steel.add(new THREE.TorusGeometry(r * 1.0, 0.22, 6, 32), 0x8d939b, mtx(u, floor + legs + r * 0.2, v, Math.PI / 2));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    b.cyl(0.3, 0.38, legs + r * 0.2, 8, 0x9aa0a8, u + Math.cos(a) * r * 0.97, floor + (legs + r * 0.2) / 2, v + Math.sin(a) * r * 0.97);
  }
}

/* ------------------------------------------------------------------ */
/* The site                                                            */
/* ------------------------------------------------------------------ */

/**
 * Build it. `o` carries what the rocket on the pad needs from the site:
 *   tallest   metres from the pad to the rocket's tip
 *   mount     { r, base } the booster's radius and the height of its base
 *   arms      [{ y, room }] heights (above the pad) the access arms reach
 *   islandName, accent, quality
 */
export function buildSpaceport(kit, site, plan, heightAt, o = {}) {
  const root = new THREE.Group();
  root.name = 'rocket:site';
  const yaw = -Math.atan2(site.az.z, site.az.x);
  const low = o.quality === 'low';
  const M = {
    paint: paintMat(kit, { roughness: 0.85 }),
    steel: paintMat(kit, { roughness: 0.42, metalness: 0.5 }),
    ground: paintMat(kit, { roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    lamp: kit.mat({ color: 0xfff4d6, emissive: 0xfff0c8, emissiveIntensity: 1.6, roughness: 0.4 }),
  };
  const atlas = signAtlas(kit, o.islandName, 'SEA STAR');
  M.sign = kit.mat({ map: atlas, roughness: 0.6, emissive: 0xffffff, emissiveMap: atlas, emissiveIntensity: 0.18 });

  const frame = new THREE.Group();
  frame.name = 'rocket:site:pad';
  frame.position.set(site.pad.x, site.pad.y, site.pad.z);
  frame.rotation.y = yaw;
  root.add(frame);
  const gy = (u, v) => {
    const w = padToWorld(site, u, v);
    return heightAt(w.x, w.z) - site.pad.y;
  };
  const off = site.offshore;
  const T = PAD_TOP;
  const H = PAD_HALF;
  const rr = (o.mount && o.mount.r) || 1;
  const mountBase = (o.mount && o.mount.base) || 0.4;
  const tallest = o.tallest || 30;

  // Bakes for the pad complex: always drawn (coarse) and only near (fine).
  const P = new Bake();
  const PS = new Bake();
  const F = new Bake();
  const FS = new Bake();
  const lamps = new Bake();
  const signs = new Bake(true);

  /* ---- the pad: a raised hardstand with the trench through it ---- */
  const pg = plan.pad;
  const lo = off ? -6 : Math.min(0, pg.lo - site.pad.y);
  const hi = off ? 0 : Math.max(0, pg.hi - site.pad.y);
  const B = off ? -2 : lo - 1.5;
  const reach = off ? 0 : (T - B) * 1.5;
  // The trench floor sits just above the highest ground it runs over, so the
  // island's own grass never shows through it.
  let floorY = off ? T - 3.2 : -Infinity;
  if (!off) {
    for (let u = -HOLE; u <= H + SPILL; u += 4) for (const v of [-HOLE, 0, HOLE]) floorY = Math.max(floorY, gy(u, v));
    floorY += 0.15;
  }
  floorY = Math.min(floorY, T - 1.2);
  const deckTop = new Bake(true);
  const uvOf = (u, v) => [(u + H) / (2 * H), 1 - (v + H) / (2 * H)];
  const top = (u0, u1, v0, v1) => deckTop.quad([u0, T, v0], [u1, T, v0], [u1, T, v1], [u0, T, v1], 0xffffff, [0, 1, 0], [uvOf(u0, v0), uvOf(u1, v0), uvOf(u1, v1), uvOf(u0, v1)]);
  top(-H, -HOLE, -H, H);
  top(-HOLE, H, HOLE, H);
  top(-HOLE, H, -H, -HOLE);
  const wallCol = (x, y) => mixHex(CONCRETE_DK, 0x6f7377, y < 0 ? 0.6 : 0);
  if (off) {
    // A platform at sea: straight walls down to the water, on legs.
    P.quad([-H, T, -H], [-H, T, H], [-H, B, H], [-H, B, -H], CONCRETE_DK, [-1, 0, 0]);
    P.quad([-H, T, H], [H, T, H], [H, B, H], [-H, B, H], CONCRETE_DK, [0, 0, 1]);
    P.quad([-H, T, -H], [H, T, -H], [H, B, -H], [-H, B, -H], CONCRETE_DK, [0, 0, -1]);
    P.quad([-H, B, -H], [H, B, -H], [H, B, H], [-H, B, H], 0x6f7377, [0, -1, 0]);
    for (const [x, z] of [[-H + 4, -H + 4], [H - 4, -H + 4], [-H + 4, H - 4], [H - 4, H - 4], [0, -H + 4], [0, H - 4]]) {
      PS.cyl(1.4, 1.7, 40 + B, 12, 0x6f7377, x, B - (40 + B) / 2 + 0.01, z);
    }
  } else {
    // The berm: three sloped sides; the seaward side is a wall the trench opens through.
    P.quad([-H, T, -H], [-H, T, H], [-H - reach, B, H + reach], [-H - reach, B, -H - reach], wallCol, [-1, 0.7, 0]);
    P.quad([-H, T, H], [H, T, H], [H, B, H + reach], [-H - reach, B, H + reach], wallCol, [0, 0.7, 1]);
    P.quad([-H, T, -H], [H, T, -H], [H, B, -H - reach], [-H - reach, B, -H - reach], wallCol, [0, 0.7, -1]);
    P.poly([[H, T, H], [H, B, H + reach], [H, B, H]], wallCol, [1, 0, 0]);
    P.poly([[H, T, -H], [H, B, -H - reach], [H, B, -H]], wallCol, [1, 0, 0]);
  }
  P.quad([H, B, -H], [H, T, -H], [H, T, -HOLE], [H, B, -HOLE], CONCRETE_DK, [1, 0, 0]);
  P.quad([H, B, HOLE], [H, T, HOLE], [H, T, H], [H, B, H], CONCRETE_DK, [1, 0, 0]);
  P.quad([H, B, -HOLE], [H, floorY, -HOLE], [H, floorY, HOLE], [H, B, HOLE], CONCRETE_DK, [1, 0, 0]);
  // Inside the trench: blackened walls, floor, back wall.
  const soot = (x, y) => mixHex(TRENCH, 0x2e2b28, Math.min(1, Math.max(0, 1 - (x + HOLE) / (H + 4))));
  P.quad([-HOLE, floorY, HOLE], [H, floorY, HOLE], [H, T, HOLE], [-HOLE, T, HOLE], soot, [0, 0, -1]);
  P.quad([-HOLE, floorY, -HOLE], [H, floorY, -HOLE], [H, T, -HOLE], [-HOLE, T, -HOLE], soot, [0, 0, 1]);
  P.quad([-HOLE, floorY, -HOLE], [-HOLE, T, -HOLE], [-HOLE, T, HOLE], [-HOLE, floorY, HOLE], 0x2e2b28, [1, 0, 0]);
  P.quad([-HOLE, floorY, -HOLE], [H, floorY, -HOLE], [H, floorY, HOLE], [-HOLE, floorY, HOLE], soot, [0, 1, 0]);
  // The deflector: a steel ramp in the hole that turns the flame down the trench.
  const dh = Math.min(3, T - floorY - 0.5);
  PS.quad([-HOLE, floorY + dh, -HOLE], [-HOLE, floorY + dh, HOLE], [HOLE + 1.5, floorY, HOLE], [HOLE + 1.5, floorY, -HOLE], (x) => mixHex(0x4e4a46, 0x6b6560, (x + HOLE) / 8), [1, 1, 0]);
  // Out beyond the deck, the trench's apron and its low walls.
  if (!off) {
    let lowest = Infinity;
    for (let u = H; u <= H + SPILL; u += 4) for (const v of [-HOLE - 1, HOLE + 1]) lowest = Math.min(lowest, gy(u, v));
    const sb = Math.min(lowest - 0.8, floorY - 0.6);
    P.box(SPILL, floorY - sb, HOLE * 2 + 1.2, (x, y) => (y > (floorY - sb) / 2 - 0.05 ? 0x55524e : CONCRETE_DK), H + SPILL / 2, (floorY + sb) / 2, 0);
    for (const s of [-1, 1]) P.box(SPILL, 1.4, 0.5, CONCRETE_DK, H + SPILL / 2, floorY + 0.7, s * (HOLE + 0.35));
    // The ramp up the back for the crawler.
    const rl = 26;
    const g0 = gy(-H - rl, 0) + 0.12;
    P.quad([-H, T, -9], [-H, T, 9], [-H - rl, g0, 9], [-H - rl, g0, -9], 0xb9b3a6, [0, 1, 0]);
    for (const s of [-1, 1]) P.quad([-H, T, s * 9], [-H - rl, g0, s * 9], [-H - rl, B, s * 9], [-H, B, s * 9], CONCRETE_DK, [0, 0, s]);
  }

  /* ---- the launch mount: a steel table over the hole, four clamps ---- */
  const k = rr + 0.38;
  for (const s of [-1, 1]) {
    PS.box(0.6, 0.9, HOLE * 2 + 1.8, 0x5d6168, s * k, T - 0.45, 0);
    PS.box(k * 2 + 0.6, 0.9, 0.6, 0x5d6168, 0, T - 0.45, s * k);
  }
  for (const [su, sv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const ph = mountBase + 0.55;
    PS.box(0.8, ph, 0.8, 0x6b7078, su * k, T + ph / 2, sv * k);
    const a = Math.atan2(sv, su);
    const rIn = rr + 0.04;
    const rOut = k * Math.SQRT2;
    const mid = (rIn + rOut) / 2;
    PS.box(rOut - rIn, 0.34, 0.42, 0x3d4148, Math.cos(a) * mid, T + mountBase + 0.22, Math.sin(a) * mid, 0, -a);
  }
  // Tail service masts, with their hoses to the base of the rocket.
  for (const s of [-1, 1]) {
    PS.box(1.4, 3.4, 1.2, 0x9aa0a8, 0, T + 1.7, s * (HOLE + 0.9));
    PS.beam(0, T + 1.2, s * (HOLE + 0.3), 0, T + mountBase + 0.6, s * (rr + 0.05), 0.2, 0x26282c);
  }
  // The deluge's rainbirds: water nozzles round the hole.
  const rainbirds = [];
  for (const [u, v] of [[-6.5, 6.5], [-6.5, -6.5], [7.5, 6.5], [7.5, -6.5]]) {
    PS.cyl(0.16, 0.16, 1.4, 8, 0x6b7078, u, T + 0.7, v);
    PS.box(0.5, 0.3, 0.3, 0x6b7078, u, T + 1.45, v, 0, Math.atan2(v, -u));
    rainbirds.push({ u, v, y: T + 1.5 });
  }

  /* ---- the tower and its arms ---- */
  const gap = 3.6;
  const tc = Math.min(-HOLE - 2.6, -(rr + gap + 2.0));
  const TH = Math.max(22, Math.ceil((tallest + 8) / 4) * 4);
  const tower = towerMesh(kit, tc, T, TH);
  frame.add(tower);
  const lampMat = kit.mat({ color: 0xff3b2f, emissive: 0xff2a1a, emissiveIntensity: 2.2 });
  const beacon = new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.45, 10, 6)), lampMat);
  beacon.position.set(tc, T + TH + 13.6, 0);
  frame.add(beacon);
  const armMat = paintMat(kit, { roughness: 0.6, metalness: 0.25 });
  const arms = [];
  for (const a of o.arms || []) {
    const len = -rr - 0.12 - (tc + 2.0);
    const pivot = new THREE.Group();
    pivot.name = 'rocket:arm';
    pivot.position.set(tc + 2.0, T + a.y, -1.5);
    pivot.add(armMesh(kit, armMat, len, a.room));
    frame.add(pivot);
    arms.push(pivot);
  }

  /* ---- the pad complex: water, oxygen, fuel, masts, lights, fence ---- */
  const item = (id) => plan.items.find((it) => it.id === id);
  const loc = (it) => ({ bottom: it.lo - site.pad.y - 1.5, floor: it.hi - site.pad.y + 0.25 });
  const pipeTo = (it, colour) => {
    // From the item to the side of the pad: along u, then v, then up the berm.
    const ut = Math.max(-16, Math.min(16, it.u));
    const sv = Math.sign(it.v) || 1;
    const vEdge = sv * (H + reach * 0.4 + 2);
    const path = [[it.u - Math.sign(it.u) * (it.hu * 0.6), it.v], [ut, it.v], [ut, vEdge]];
    let y = -Infinity;
    for (let i = 1; i < path.length; i++) {
      const [u0, v0] = path[i - 1];
      const [u1, v1] = path[i];
      const len = Math.hypot(u1 - u0, v1 - v0);
      for (let s = 0; s <= len; s += 4) y = Math.max(y, gy(u0 + ((u1 - u0) * s) / len, v0 + ((v1 - v0) * s) / len));
    }
    y += 0.8;
    for (let i = 1; i < path.length; i++) {
      const [u0, v0] = path[i - 1];
      const [u1, v1] = path[i];
      FS.beam(u0, y, v0, u1, y, v1, 0.5, colour);
      const len = Math.hypot(u1 - u0, v1 - v0);
      for (let s = 3; s < len; s += 7) {
        const pu = u0 + ((u1 - u0) * s) / len;
        const pv = v0 + ((v1 - v0) * s) / len;
        const g0 = gy(pu, pv);
        F.box(0.5, y - g0 + 0.3, 0.7, CONCRETE_DK, pu, (y + g0 - 0.3) / 2, pv);
      }
    }
    FS.beam(ut, y, vEdge, ut, T + 0.25, sv * (H - 1), 0.5, colour);
  };
  const water = item('water');
  if (water) {
    const { bottom, floor } = loc(water);
    footing(P, water.u, water.v, 4.5, 4.5, bottom, floor);
    PS.cyl(1.3, 1.9, 30, 16, WHITE, water.u, floor + 15, water.v);
    PS.add(new THREE.SphereGeometry(6.6, 28, 16), (x, y) => (Math.abs(y) < 0.9 ? 0x2f6fb5 : y > 5.6 ? 0xc8432f : WHITE), mtx(water.u, floor + 35, water.v));
    PS.add(new THREE.TorusGeometry(6.7, 0.18, 4, 32), 0x8d939b, mtx(water.u, floor + 35, water.v, Math.PI / 2));
    F.box(0.5, 30, 0.12, 0x6b7078, water.u + 1.4, floor + 15, water.v + 1.4, 0, Math.PI / 4);
    pipeTo(water, 0x8fa7c0);
  }
  const lox = item('lox');
  if (lox) {
    const { bottom, floor } = loc(lox);
    footing(P, lox.u, lox.v, 8.5, 8.5, bottom, floor);
    sphereTank(P, PS, lox.u, lox.v, floor, 7.2, 5, 0x6fb3e8);
    pipeTo(lox, 0xe8ecef);
  }
  const fuel = item('fuel');
  if (fuel) {
    const { bottom, floor } = loc(fuel);
    footing(P, fuel.u, fuel.v, fuel.hu, fuel.hv, bottom, floor);
    for (const s of [-1, 1]) {
      const v = fuel.v + s * 3.6;
      PS.cyl(2.4, 2.4, 14, 20, 0xd7dadd, fuel.u, floor + 3.2, v, 0, 0, Math.PI / 2);
      for (const e of [-1, 1]) {
        const cap = new THREE.SphereGeometry(2.4, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
        cap.scale(1, 0.45, 1);
        PS.add(cap, 0xd7dadd, mtx(fuel.u + e * 7, floor + 3.2, v, 0, 0, -e * Math.PI / 2));
      }
      PS.cyl(2.42, 2.42, 0.8, 20, 0xc8102e, fuel.u, floor + 3.2, v, 0, 0, Math.PI / 2);
      for (const x of [-4.5, 0, 4.5]) P.box(0.8, 1.6, 4, CONCRETE_DK, fuel.u + x, floor + 0.8, v);
    }
    // The low wall round the tanks.
    for (const s of [-1, 1]) {
      P.box(fuel.hu * 2, 0.9, 0.4, CONCRETE, fuel.u, floor + 0.45, fuel.v + s * (fuel.hv - 0.2));
      P.box(0.4, 0.9, fuel.hv * 2, CONCRETE, fuel.u + s * (fuel.hu - 0.2), floor + 0.45, fuel.v);
    }
    pipeTo(fuel, 0x5d6168);
    // LOX and FUEL boards.
    signFace(signs, 7, 3.2, 1.6, mtx(fuel.u - fuel.hu - 0.5, floor + 1.8, fuel.v + fuel.hv + 0.35), [0.5, 1]);
  }
  if (lox) signFace(signs, 7, 3.2, 1.6, mtx(lox.u, loc(lox).floor + 2.4, lox.v + 8.6), [0, 0.5]);
  const mastTops = [];
  for (const id of ['mast1', 'mast2']) {
    const m = item(id);
    if (!m) continue;
    const { bottom, floor } = loc(m);
    footing(P, m.u, m.v, 1.6, 1.6, bottom, floor);
    const mh = Math.max(56, TH + 14);
    PS.add(new THREE.CylinderGeometry(0.22, 0.7, mh, 10), (x, y) => (y > mh / 2 - 8 && Math.floor((y - mh / 2 + 8) / 2) % 2 === 0 ? 0xc8432f : 0xe4e7ea), mtx(m.u, floor + mh / 2, m.v));
    mastTops.push([m.u, floor + mh, m.v, floor]);
  }
  const shed = item('shed');
  if (shed) {
    const { bottom, floor } = loc(shed);
    footing(P, shed.u, shed.v, shed.hu, shed.hv, bottom, floor);
    P.box(shed.hu * 2 - 0.6, 4.2, shed.hv * 2 - 0.6, 0xd9dcdf, shed.u, floor + 2.1, shed.v);
    P.box(shed.hu * 2, 0.4, shed.hv * 2, 0x8d939b, shed.u, floor + 4.4, shed.v);
    P.box(1.4, 2.4, 0.1, 0x3a4250, shed.u - 2, floor + 1.2, shed.v + shed.hv - 0.25);
    P.box(4.5, 1.0, 0.1, 0x1f3a5c, shed.u + 2.5, floor + 2.4, shed.v + shed.hv - 0.25);
    F.box(2.2, 1.2, 1.6, 0xb9bec5, shed.u + 3, floor + 5.2, shed.v - 1);
  }
  for (const id of ['light1', 'light2', 'light3', 'light4']) {
    const L = item(id);
    if (!L) continue;
    const { bottom, floor } = loc(L);
    footing(F, L.u, L.v, 1.2, 1.2, bottom, floor);
    const ph = 26;
    FS.cyl(0.18, 0.32, ph, 8, 0x9aa0a8, L.u, floor + ph / 2, L.v);
    const face = Math.atan2(-L.v, -L.u);
    const hx = L.u + Math.cos(face) * 0.6;
    const hz = L.v + Math.sin(face) * 0.6;
    FS.box(0.5, 2.4, 3.4, 0x5d6168, hx, floor + ph + 0.6, hz, 0, -face, -0.35);
    lamps.add(new THREE.BoxGeometry(0.08, 2.0, 3.0), 0xffffff, new THREE.Matrix4().compose(
      new THREE.Vector3(hx + Math.cos(face) * 0.3, floor + ph + 0.6, hz + Math.sin(face) * 0.3),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -face, -0.35, 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    ));
  }
  // The monument sign.
  const sign = item('sign');
  if (sign) {
    const { bottom, floor } = loc(sign);
    footing(F, sign.u, sign.v, 8.5, 0.8, bottom, floor);
    F.box(17, 5.6, 0.5, 0x1d2a44, sign.u, floor + 4.6, sign.v);
    for (const s of [-1, 1]) F.box(0.6, 4, 0.6, 0x5d6168, sign.u + s * 6.5, floor + 2, sign.v);
    signFace(signs, 0, 16, 5.2, mtx(sign.u, floor + 4.6, sign.v + 0.27));
  }
  if (off) {
    // At sea: floodlights on the corners, and a sign on the side.
    signFace(signs, 0, 16, 5.2, mtx(-H + 10, T - 2.6, H + 0.05));
  }

  /* ---- the fence, the gate, the warning signs ---- */
  let fencePanels = null;
  let wire = null;
  if (plan.fence && !off) {
    const half = plan.fence.half;
    const gate = plan.gate;
    const posts = [];
    const edges = [
      [[-half, -half], [half, -half]],
      [[half, -half], [half, half]],
      [[half, half], [-half, half]],
      [[-half, half], [-half, -half]],
    ];
    const panel = new Bake(true);
    for (const [[u0, v0], [u1, v1]] of edges) {
      const len = Math.hypot(u1 - u0, v1 - v0);
      let prev = null;
      let along = 0;
      for (let s = 0; s <= len + 0.01; s += 4) {
        const u = u0 + ((u1 - u0) * s) / len;
        const v = v0 + ((v1 - v0) * s) / len;
        const w = padToWorld(site, u, v);
        const h = heightAt(w.x, w.z);
        const inGate = gate && Math.abs(u - gate.u) < 0.5 && v > gate.v0 && v < gate.v1;
        if (h < 0.5 || inGate) {
          prev = null;
          continue;
        }
        const g0 = h - site.pad.y;
        posts.push([u, g0, v]);
        if (prev) {
          const [pu, pg, pv] = prev;
          panel.quad([pu, pg + 0.05, pv], [u, g0 + 0.05, v], [u, g0 + 2.4, v], [pu, pg + 2.4, pv], 0xffffff, [-(v - pv), 0, u - pu], [[along / 2.4, 0], [(along + 4) / 2.4, 0], [(along + 4) / 2.4, 1], [along / 2.4, 1]]);
        }
        along += 4;
        prev = [u, g0, v];
      }
    }
    if (!low && !panel.empty) {
      fencePanels = panel.mesh(kit, kit.mat({ map: fenceTexture(kit), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 }), 'fence');
      fencePanels.castShadow = false;
    }
    for (const [u, g0, v] of posts) F.box(0.12, 2.7, 0.12, 0x8d939b, u, g0 + 1.35, v);
    // The gate: two tall posts and the LAUNCH COMPLEX 1 board across.
    if (gate) {
      const gc = (gate.v0 + gate.v1) / 2;
      const gg = Math.max(gy(gate.u, gate.v0), gy(gate.u, gate.v1));
      for (const v of [gate.v0, gate.v1]) {
        const g0 = gy(gate.u, v);
        F.box(0.5, gg - g0 + 8.5, 0.5, 0x5d6168, gate.u, (gg + g0 + 8.5 - 1.5) / 2, v);
      }
      F.box(0.4, 3.6, gate.v1 - gate.v0 + 0.4, 0x1d2a44, gate.u, gg + 7.2, gc);
      signFace(signs, 2, (gate.v1 - gate.v0) * 0.92, 3.4, mtx(gate.u - 0.22, gg + 7.2, gc, 0, -Math.PI / 2));
    }
    // DANGER boards on the fence, facing out.
    for (const [u, v, ry] of [[-half - 0.1, (gate ? gate.v1 : 0) + 8, -Math.PI / 2], [-half - 0.1, (gate ? gate.v0 : 0) - 8, -Math.PI / 2], [0, half + 0.1, 0], [half + 0.1, 0, Math.PI / 2], [0, -half - 0.1, Math.PI]]) {
      const w = padToWorld(site, u, v);
      if (heightAt(w.x, w.z) < 0.5) continue;
      signFace(signs, 1, 2.4, 1.2, mtx(u, gy(u, v) + 1.6, v, 0, ry));
    }
    // The lightning masts' wire: slung between them, and guyed to the ground.
    if (mastTops.length === 2 && !low) {
      const pts = [];
      const [a, b] = mastTops;
      for (let i = 0; i < 24; i++) {
        const t0 = i / 24;
        const t1 = (i + 1) / 24;
        const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - 7 * Math.sin(Math.PI * t), a[2] + (b[2] - a[2]) * t];
        pts.push(...at(t0), ...at(t1));
      }
      for (const m of mastTops) {
        for (const s of [-1, 1]) {
          const gu = m[0] + s * 14;
          const gv = m[2] - 26;
          pts.push(m[0], m[1] - 1, m[2], gu, gy(gu, gv), gv);
        }
      }
      const lg = kit.geo(new THREE.BufferGeometry());
      lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const lm = new THREE.LineBasicMaterial({ color: 0x3a3d42 });
      kit.mats.push(lm);
      wire = new THREE.LineSegments(lg, lm);
      wire.name = 'wire';
    }
  }

  // The pad complex's meshes.
  const deckMat = kit.mat({ map: deckTexture(kit), roughness: 0.9 });
  const deck = deckTop.mesh(kit, deckMat, 'deck');
  deck.receiveShadow = true;
  frame.add(deck);
  const padPaint = P.mesh(kit, M.paint, 'pad');
  padPaint.receiveShadow = true;
  frame.add(padPaint);
  frame.add(PS.mesh(kit, M.steel, 'pad-steel'));
  const fine = new THREE.Group();
  fine.name = 'rocket:site:fine';
  if (!F.empty) fine.add(F.mesh(kit, M.paint, 'fine'));
  if (!FS.empty) fine.add(FS.mesh(kit, M.steel, 'fine-steel'));
  if (!lamps.empty) {
    const lm = lamps.mesh(kit, M.lamp, 'lamps');
    lm.castShadow = false;
    fine.add(lm);
  }
  if (!signs.empty) fine.add(signs.mesh(kit, M.sign, 'signs'));
  if (fencePanels) fine.add(fencePanels);
  if (wire) fine.add(wire);
  const lod = new THREE.LOD();
  lod.name = 'rocket:site:lod';
  lod.addLevel(fine, 0);
  lod.addLevel(new THREE.Object3D(), low ? 450 : 900);
  frame.add(lod);

  /* ---- the hangar, the control centre, the crawler road ---- */
  const campus = new THREE.Group();
  campus.name = 'rocket:site:campus';
  const CP = new Bake();
  const CS = new Bake();
  const CG = new Bake();
  const walls = new Bake(true);
  const CF = new Bake();
  const vab = item('vab');
  if (vab) {
    const { bottom, floor } = loc(vab);
    const hh = 62;
    footing(CP, vab.u, vab.v, vab.hu + 1, vab.hv + 1, bottom, floor);
    const u0 = vab.u - vab.hu;
    const u1 = vab.u + vab.hu;
    const v0 = vab.v - vab.hv;
    const v1 = vab.v + vab.hv;
    const y0 = floor;
    const y1 = floor + hh;
    const face = (side) => (side === 'door' ? [0, 0.4] : side === 'emblem' ? [0.4, 0.8] : [0.8, 1]);
    const toLine = -Math.sign(vab.v) || 1;
    const wall = (a, b, n, kind) => {
      const [s0, s1] = face(kind);
      walls.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], 0xffffff, [n[0], 0, n[1]], [[s0, 0], [s1, 0], [s1, 1], [s0, 1]]);
    };
    // Walls are listed so that, looking at each from outside, a is on the left.
    wall([u1, v1], [u1, v0], [1, 0], 'door');
    wall([u0, v0], [u0, v1], [-1, 0], 'plain');
    if (toLine > 0) {
      wall([u0, v1], [u1, v1], [0, 1], 'emblem');
      wall([u1, v0], [u0, v0], [0, -1], 'plain');
    } else {
      wall([u1, v0], [u0, v0], [0, -1], 'emblem');
      wall([u0, v1], [u1, v1], [0, 1], 'plain');
    }
    CP.box(vab.hu * 2 + 0.8, 1.4, vab.hv * 2 + 0.8, 0xb8bcc0, vab.u, y1 + 0.7, vab.v);
    CF.box(8, 3, 6, 0x9aa0a8, vab.u - 10, y1 + 2.9, vab.v - 6);
    CF.box(5, 2.4, 5, 0x9aa0a8, vab.u + 8, y1 + 2.6, vab.v + 8);
    CF.cyl(1.2, 1.2, 1.5, 12, 0x8d939b, vab.u - 12, y1 + 2.1, vab.v + 9);
    // An office block on the back.
    CP.box(14, 14, vab.hv * 1.4, 0xd9dcdf, u0 - 7, y0 + 7, vab.v);
    CP.box(14.4, 0.6, vab.hv * 1.4 + 0.4, 0x8d939b, u0 - 7, y0 + 14.3, vab.v);
    for (let y = 3; y < 13; y += 4) CP.box(0.1, 1.4, vab.hv * 1.3, 0x1f3a5c, u0 - 14.05, y0 + y, vab.v);
    // The hangar's name over the door.
    signFace(signs, 6, 18, 9, mtx(u1 + 0.1, y0 + hh - 6.5, vab.v, 0, Math.PI / 2));
    // A concrete apron in front of the door.
    CG.quad([u1, gy(u1, v0 + 6) + 0.2, v0 + 6], [u1 + 22, gy(u1 + 22, v0 + 6) + 0.2, v0 + 6], [u1 + 22, gy(u1 + 22, v1 - 6) + 0.2, v1 - 6], [u1, gy(u1, v1 - 6) + 0.2, v1 - 6], 0xb4b1aa, [0, 1, 0]);
  }
  if (plan.path) {
    // Two gravel lanes with grass between, as on a real crawlerway.
    const nrm = (a, b) => {
      const l = Math.hypot(b.u - a.u, b.v - a.v) || 1;
      return { u: -(b.v - a.v) / l, v: (b.u - a.u) / l };
    };
    for (const s of [-1, 1]) {
      const lane = plan.path.map((p, i) => {
        const a = plan.path[Math.max(0, i - 1)];
        const b = plan.path[Math.min(plan.path.length - 1, i + 1)];
        const n = nrm(a, b);
        return { u: p.u + n.u * s * 5.5, v: p.v + n.v * s * 5.5 };
      });
      ribbon(CG, lane, 7, gy, 0xbcb19b, 0.16);
    }
  }
  const crawler = item('crawler');
  if (crawler) {
    const g0 = crawler.hi - site.pad.y;
    for (const [su, sv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      CF.box(8.5, 2.6, 4.2, 0x2b2d31, crawler.u + su * 8, g0 + 1.3, crawler.v + sv * 6.5);
      CF.cyl(0.9, 0.9, 2.6, 10, 0x8d939b, crawler.u + su * 8, g0 + 3.4, crawler.v + sv * 6.5);
    }
    CF.box(24, 2.2, 18, 0x9aa0a8, crawler.u, g0 + 5.4, crawler.v);
    CF.box(3, 2.6, 3, 0xc8432f, crawler.u + 10, g0 + 7.8, crawler.v + 7);
    CF.box(3, 2.6, 3, 0xc8432f, crawler.u - 10, g0 + 7.8, crawler.v - 7);
    CF.box(22, 0.4, 0.3, 0xe6b422, crawler.u, g0 + 6.7, crawler.v + 9);
  }
  const lcc = item('lcc');
  if (lcc) {
    const { bottom, floor } = loc(lcc);
    footing(CP, lcc.u, lcc.v, lcc.hu + 1, lcc.hv + 1, bottom, floor);
    const h = 11;
    const u0 = lcc.u - lcc.hu;
    const u1 = lcc.u + lcc.hu;
    const v0 = lcc.v - lcc.hv;
    const v1 = lcc.v + lcc.hv;
    const lw = new Bake(true);
    const q = (a, b, n, rep) => lw.quad([a[0], floor, a[1]], [b[0], floor, b[1]], [b[0], floor + h, b[1]], [a[0], floor + h, a[1]], 0xffffff, [n[0], 0, n[1]], [[0, 0], [rep, 0], [rep, 1], [0, 1]]);
    q([u1, v1], [u1, v0], [1, 0], 0.5);
    q([u0, v0], [u0, v1], [-1, 0], 0.5);
    q([u0, v1], [u1, v1], [0, 1], 1);
    q([u1, v0], [u0, v0], [0, -1], 1);
    const lt = lccTexture(kit);
    lt.wrapS = THREE.RepeatWrapping;
    campus.add(lw.mesh(kit, kit.mat({ map: lt, roughness: 0.5, metalness: 0.1 }), 'lcc'));
    CP.box(lcc.hu * 2 + 0.6, 0.8, lcc.hv * 2 + 0.6, 0x9aa0a8, lcc.u, floor + h + 0.4, lcc.v);
    const toLine = -Math.sign(lcc.v) || 1;
    signFace(signs, 5, 14, 3.5, mtx(lcc.u, floor + h + 2.6, lcc.v + toLine * (lcc.hv - 1), 0, toLine > 0 ? 0 : Math.PI));
    CP.box(14, 3.6, 0.3, 0xe9ebed, lcc.u, floor + h + 2.6, lcc.v + toLine * (lcc.hv - 1.2));
    // The big dish on the roof, and a mast.
    const dish = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      dish.push(new THREE.Vector2(t * 4.2, t * t * 1.4));
    }
    CS.add(new THREE.LatheGeometry(dish, 24), WHITE, mtx(lcc.u + 8, floor + h + 4.5, lcc.v, 0.7, 0, 0.5));
    CS.cyl(0.5, 0.8, 4, 10, 0x9aa0a8, lcc.u + 8, floor + h + 2.4, lcc.v);
    CS.cyl(0.12, 0.2, 14, 6, 0x9aa0a8, lcc.u - 12, floor + h + 7, lcc.v - 4);
    CF.box(3, 1.6, 2, 0xb9bec5, lcc.u - 4, floor + h + 1.6, lcc.v + 3);
  }
  if (!walls.empty) {
    const ht = hangarTexture(kit, o.accent || '#ffc247');
    campus.add(walls.mesh(kit, kit.mat({ map: ht, roughness: 0.75, metalness: 0.05 }), 'hangar'));
  }
  if (!CP.empty) campus.add(CP.mesh(kit, M.paint, 'campus'));
  if (!CS.empty) campus.add(CS.mesh(kit, M.steel, 'campus-steel'));
  if (!CG.empty) {
    const roads = CG.mesh(kit, M.ground, 'roads');
    roads.castShadow = false;
    roads.receiveShadow = true;
    campus.add(roads);
  }
  if (!CF.empty) {
    const cf = new THREE.LOD();
    const g = new THREE.Group();
    g.add(CF.mesh(kit, M.paint, 'campus-fine'));
    cf.addLevel(g, 0);
    cf.addLevel(new THREE.Object3D(), low ? 700 : 1500);
    if (vab) cf.position.set(vab.u, 0, vab.v);
    g.position.copy(cf.position).negate();
    campus.add(cf);
  }
  frame.add(campus);

  /* ---- the landing zone, behind ---- */
  const lz = new THREE.Group();
  lz.name = 'rocket:site:lz';
  lz.position.set(site.lz.x, site.lz.y, site.lz.z);
  lz.rotation.y = yaw;
  {
    const lzLo = off ? -6 : Math.min(0, lowestUnder(heightAt, site.lz, LZ_R + 2) - site.lz.y);
    const lzB = lzLo - 3;
    const lzH = 0.5 - lzB;
    const b = new Bake();
    b.add(new THREE.CylinderGeometry(LZ_R, LZ_R + 1.5, lzH, 48), CONCRETE_DK, mtx(0, 0.5 - lzH / 2, 0));
    if (off) for (const [x, z] of [[-LZ_R * 0.6, -LZ_R * 0.6], [LZ_R * 0.6, -LZ_R * 0.6], [-LZ_R * 0.6, LZ_R * 0.6], [LZ_R * 0.6, LZ_R * 0.6]]) b.cyl(1.4, 1.7, 40 + lzB, 12, 0x6f7377, x, lzB - (40 + lzB) / 2, z);
    const lzMesh = b.mesh(kit, M.paint, 'lz');
    lzMesh.receiveShadow = true;
    lz.add(lzMesh);
    const decal = new THREE.Mesh(kit.geo(new THREE.CircleGeometry(LZ_R - 0.3, 48)), kit.mat({ map: lzTexture(kit), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    decal.rotation.x = -Math.PI / 2;
    decal.rotation.z = Math.PI / 2;
    decal.position.y = 0.51;
    decal.receiveShadow = true;
    decal.name = 'lz-decal';
    lz.add(decal);
    const ll = new Bake();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ll.box(0.4, 0.22, 0.4, 0xffffff, Math.cos(a) * (LZ_R - 0.8), 0.6, Math.sin(a) * (LZ_R - 0.8));
    }
    const lzl = ll.mesh(kit, M.lamp, 'lz-lights');
    lzl.castShadow = false;
    lz.add(lzl);
    if (!off) {
      // The LZ-1 board and a windsock, on the ground beside it.
      const lb = new Bake();
      const ls = new Bake(true);
      const su = -LZ_R - 10;
      const sv = LZ_R * 0.7;
      const at = (u, v) => {
        const w = padToWorld(site, site.lzS + u, v);
        return heightAt(w.x, w.z) - site.lz.y;
      };
      const g0 = at(su, sv);
      for (const s of [-1, 1]) lb.box(0.4, 4.5, 0.4, 0x5d6168, su + s * 4, g0 + 1.75, sv);
      lb.box(9.4, 4.6, 0.35, 0x1d2a44, su, g0 + 3.6, sv);
      signFace(ls, 3, 9, 4.4, mtx(su, g0 + 3.6, sv + 0.2));
      const wu = LZ_R + 8;
      const wv = -LZ_R * 0.6;
      const w0 = at(wu, wv);
      lb.cyl(0.08, 0.12, 9, 6, 0x9aa0a8, wu, w0 + 4.5, wv);
      lb.add(new THREE.CylinderGeometry(0.55, 0.2, 3.2, 10, 1, true), (x, y) => (Math.floor((y + 1.6) / 0.8) % 2 ? 0xffffff : 0xff6a1a), mtx(wu - 1.6, w0 + 8.6, wv, 0, 0, Math.PI / 2 - 0.25));
      lz.add(lb.mesh(kit, M.paint, 'lz-things'));
      lz.add(ls.mesh(kit, M.sign, 'lz-sign'));
    }
  }
  root.add(lz);

  /* ---- the ship, out at sea along the line ---- */
  const shipGroup = new THREE.Group();
  shipGroup.name = 'rocket:site:ship';
  shipGroup.position.set(site.barge.x, 0, site.barge.z);
  shipGroup.rotation.y = yaw;
  const ship = new THREE.Group();
  shipGroup.add(ship);
  {
    const L = BARGE_HALF * 2 + 8;
    const W = BARGE_HALF_W * 2 + 8;
    const D = BARGE_DECK;
    const b = new Bake();
    const s = new Bake();
    b.box(L, 7.5, W, (x, y) => (y < -2.6 ? 0x7a2a22 : y > 3.1 ? 0xe9ebed : 0x2f3a46), 0, D - 3.75, 0);
    // Blast walls down both sides, generator boxes behind them.
    for (const sv of [-1, 1]) {
      b.box(L - 10, 3.4, 1.2, 0xd9dce0, 0, D + 1.7, sv * (BARGE_HALF_W + 2.6));
      for (let i = 0; i < 4; i++) b.box(6, 2.6, 2.2, i % 2 ? 0x2f6fb5 : 0xe9ebed, -21 + i * 14, D + 1.3, sv * (BARGE_HALF_W + 4.4 - 0.4));
      // Thrusters at the corners.
      for (const su of [-1, 1]) {
        b.box(5, 4, 4, 0xe6b422, su * (L / 2 - 3.5), D - 0.5, sv * (W / 2 + 1.2));
        b.box(4, 1.2, 3.2, 0x2b2d31, su * (L / 2 - 3.5), D - 3, sv * (W / 2 + 1.2));
      }
      // Bollards along the edge.
      for (let x = -L / 2 + 6; x < L / 2 - 5; x += 9) s.cyl(0.35, 0.4, 0.8, 8, 0x2b2d31, x, D + 0.4, sv * (W / 2 - 0.8));
    }
    // A mast with antennas and lights at the stern.
    s.cyl(0.18, 0.25, 10, 8, 0x9aa0a8, -L / 2 + 3, D + 5, W / 2 - 3);
    s.box(2.4, 0.14, 0.14, 0x9aa0a8, -L / 2 + 3, D + 8.5, W / 2 - 3);
    s.add(new THREE.SphereGeometry(0.6, 12, 8), 0xf2f4f7, mtx(-L / 2 + 3, D + 10.4, W / 2 - 3));
    ship.add(b.mesh(kit, M.paint, 'hull'));
    ship.add(s.mesh(kit, M.steel, 'ship-steel'));
    const deckTop = new THREE.Mesh(kit.geo(new THREE.PlaneGeometry(L, W)), kit.mat({ map: bargeTexture(kit, 'SEA STAR'), roughness: 0.8, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    deckTop.rotation.x = -Math.PI / 2;
    deckTop.position.y = D + 0.02;
    deckTop.receiveShadow = true;
    deckTop.name = 'ship-deck';
    ship.add(deckTop);
    const nm = new Bake(true);
    for (const sv of [-1, 1]) signFace(nm, 4, 22, 4, mtx(8, D - 1.6, sv * (W / 2 + 0.03), 0, sv > 0 ? 0 : Math.PI));
    ship.add(nm.mesh(kit, M.sign, 'ship-name'));
    const sl = new Bake();
    for (const [x, z] of [[L / 2 - 1, W / 2 - 1], [L / 2 - 1, -W / 2 + 1], [-L / 2 + 1, W / 2 - 1], [-L / 2 + 1, -W / 2 + 1]]) sl.box(0.5, 0.5, 0.5, 0xffffff, x, D + 0.5, z);
    const shipLamps = sl.mesh(kit, M.lamp, 'ship-lights');
    shipLamps.castShadow = false;
    ship.add(shipLamps);
  }
  root.add(shipGroup);

  root.userData = {
    ship,
    lamp: beacon,
    arms,
    rainbirds,
    trench: { u: H + SPILL * 0.6, y: floorY + 1.2, w: HOLE },
    tower: { u: tc, height: TH },
    lod: [lod],
  };
  return root;
}

function lowestUnder(heightAt, p, r) {
  let lo = heightAt(p.x, p.z);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    lo = Math.min(lo, heightAt(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r));
  }
  return lo;
}

/**
 * Per frame: the arms (0 = against the rocket … 1 = swung away), the ship on
 * the swell, the beacon blinking.
 */
export function animateSpaceport(root, t, arms) {
  const u = root.userData;
  if (u.arms) {
    u.arms.forEach((a, i) => {
      const k = Math.max(0, Math.min(1, arms[Math.min(i, arms.length - 1)] || 0));
      a.rotation.y = k * k * (3 - 2 * k) * 1.75;
    });
  }
  if (u.ship) {
    u.ship.position.y = Math.sin(t * 0.8) * 0.25;
    u.ship.rotation.z = Math.sin(t * 0.6) * 0.012;
  }
  if (u.lamp) u.lamp.visible = Math.sin(t * 5) > -0.2;
}

/**
 * Move the island's trees out of the spaceport while it stands: every
 * instance of the scenery's instanced meshes whose middle is in one of the
 * plan's zones is shrunk to nothing. Returns the function that puts them
 * all back exactly as they were.
 */
export function clearFootprints(group, site, zones) {
  const saved = [];
  if (!group || !zones || !zones.length) return () => {};
  const e = new THREE.Matrix4();
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (!o.isInstancedMesh || !o.count) return;
    const arr = o.instanceMatrix.array;
    const mw = o.matrixWorld.elements;
    const list = [];
    for (let i = 0; i < o.count; i++) {
      const x0 = arr[i * 16 + 12];
      const y0 = arr[i * 16 + 13];
      const z0 = arr[i * 16 + 14];
      const x = mw[0] * x0 + mw[4] * y0 + mw[8] * z0 + mw[12];
      const z = mw[2] * x0 + mw[6] * y0 + mw[10] * z0 + mw[14];
      const p = worldToPad(site, x, z);
      let hit = false;
      for (const zn of zones) {
        if (Math.abs(p.u - zn.u) < zn.hu && Math.abs(p.v - zn.v) < zn.hv) { hit = true; break; }
      }
      if (!hit) continue;
      list.push(i, arr.slice(i * 16, i * 16 + 16));
      e.makeScale(0, 0, 0);
      e.setPosition(x0, y0 - 1000, z0);
      o.setMatrixAt(i, e);
    }
    if (list.length) {
      o.instanceMatrix.needsUpdate = true;
      saved.push([o, list]);
    }
  });
  return () => {
    for (const [o, list] of saved) {
      for (let k = 0; k < list.length; k += 2) o.instanceMatrix.array.set(list[k + 1], list[k] * 16);
      o.instanceMatrix.needsUpdate = true;
    }
    saved.length = 0;
  };
}

/** How many instances clearFootprints moved (for the tests). */
export function countCleared(group) {
  let n = 0;
  if (!group) return 0;
  group.traverse((o) => {
    if (!o.isInstancedMesh) return;
    const a = o.instanceMatrix.array;
    for (let i = 0; i < o.count; i++) if (a[i * 16] === 0 && a[i * 16 + 5] === 0 && a[i * 16 + 10] === 0) n++;
  });
  return n;
}
