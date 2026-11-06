/**
 * The kerb's furniture, drawn: benches, bins, planters, lamp posts, bollards,
 * flags, trolley bays, the bus shelter and the signs (life/landside-plan.js
 * says where). Everything is one vertex-coloured mesh, so a forecourt with two
 * hundred things on it is one draw; the signs' lettering is one more, not on
 * Low, and the lamps after dark one Points. On Low the bollards and trolleys
 * stay in the box: it is the shape of the place that matters there.
 */
import * as THREE from '../../vendor/three.module.js';
import { Batch, vcMaterial, glowPoints, glowTexture, canvas, canvasTexture } from '../../world/airport-kit.js';
import { KERB_EDGE } from './landside-plan.js';
import { AIRPORT } from '../../world/terrain.js';

const KERB = KERB_EDGE;
const CONCRETE = 0xa9acaa;
const STEEL = 0x8a9299;
const DARK = 0x2b3037;
const TIMBER = 0x8a6a48;
const LEAF = [0x3f6b39, 0x4c7c41, 0x35602f];
/** Plain flags: colours, no country. */
const FLAGS = [0x20589c, 0xe9ecef, 0xb7372a, 0x2e7d5b, 0xe0a428, 0x4b3f8f];

/** Words on the signs: a row of the atlas each. */
const WORDS = ['TAXI', 'BUS', 'DEPARTURES', 'ARRIVALS', 'CAR PARK'];
const ROW_H = 64;

function signAtlas() {
  const c = canvas(512, ROW_H * WORDS.length);
  const x = c.getContext('2d');
  WORDS.forEach((t, i) => {
    const y = i * ROW_H;
    x.fillStyle = t === 'TAXI' ? '#f2c230' : '#143a6b';
    x.fillRect(0, y, 512, ROW_H);
    x.fillStyle = t === 'TAXI' ? '#15181c' : '#f4f7fa';
    x.font = 'bold 44px "Jost", Arial, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(t, 256, y + ROW_H / 2 + 2);
  });
  return canvasTexture(c);
}

/**
 * The furniture, in the world. `ground(x, z)` the height of the paving there.
 * Returns { group, lights } — `lights` is the Points to show after dark.
 */
export function buildLandside(lay, plan, ground, quality) {
  if (!plan) return null;
  const low = quality === 'low';
  const F = lay.frame;
  const T = lay.terminal;
  const b = new Batch();
  const words = low ? null : new Batch();
  const glow = [];
  /** Where each lamp's light lands. */
  const pools = [];
  const glowCol = [];
  const out = F.side * 1; // +1: w runs towards +z
  const X = (u) => F.x(u);
  const Z = (w) => F.z(T.back + w);

  const sign = (text, x, y, z, w, h) => {
    if (!words) return;
    const row = WORDS.indexOf(text);
    if (row < 0) return;
    // A face either way along w, reading the right way round from both.
    for (const s of [-1, 1]) {
      const zz = z + s * 0.08;
      const v0 = 1 - (row + 1) / WORDS.length;
      const v1 = 1 - row / WORDS.length;
      const hw = w / 2;
      const flip = s > 0;
      const a = [x + (flip ? -hw : hw), y - h / 2, zz];
      const c = [x + (flip ? hw : -hw), y - h / 2, zz];
      const d = [x + (flip ? hw : -hw), y + h / 2, zz];
      const e = [x + (flip ? -hw : hw), y + h / 2, zz];
      words.quad(a, c, d, e, [0, v0, 1, v1], 0xffffff);
    }
  };

  for (const it of plan.items) {
    const x = X(it.u);
    const z = Z(it.w);
    const y = ground(x, z);
    const toWall = -out; // along z, towards the terminal
    switch (it.kind) {
      case 'bench': {
        b.box(1.9, 0.06, 0.46, x, y + 0.46, z, TIMBER);
        b.box(1.9, 0.42, 0.05, x, y + 0.72, z + toWall * 0.22, TIMBER);
        for (const s of [-0.75, 0.75]) b.box(0.07, 0.46, 0.46, x + s, y + 0.23, z, STEEL);
        break;
      }
      case 'bin':
        b.cyl(0.25, 0.24, 0.92, x, y, z, DARK, 8);
        b.cyl(0.27, 0.27, 0.07, x, y + 0.92, z, STEEL, 8);
        break;
      case 'planter': {
        b.box(2.5, 0.62, 1.0, x, y + 0.31, z, CONCRETE);
        if (!low) {
          b.box(2.3, 0.04, 0.8, x, y + 0.63, z, 0x3b2f24);
          for (let k = 0; k < 4; k++) {
            const g = new THREE.IcosahedronGeometry(0.42 + (k % 2) * 0.08, 0);
            g.scale(1, 0.85, 1);
            g.translate(x - 0.9 + k * 0.6, y + 0.95, z + (k % 2 ? 0.12 : -0.1));
            b.add(g, new THREE.Matrix4(), LEAF[k % 3]);
            g.dispose();
          }
        }
        break;
      }
      case 'lamp': {
        b.cyl(0.07, 0.11, 8, x, y, z, STEEL, 6);
        b.box(0.14, 0.14, 1.7, x, y + 8.0, z + toWall * 0.75, STEEL);
        b.box(0.34, 0.1, 0.8, x, y + 7.92, z + toWall * 1.4, 0xd8dde0);
        glow.push(x, y + 7.78, z + toWall * 1.4);
        glowCol.push(1, 0.92, 0.74);
        pools.push([x, y, z + toWall * 1.4]);
        break;
      }
      case 'bollard':
        if (!low) {
          b.cyl(0.07, 0.08, 0.92, x, y, z, 0x3a3f46, 6);
          b.cyl(0.078, 0.078, 0.1, x, y + 0.72, z, 0xe8ecef, 6);
        }
        break;
      case 'flag': {
        b.cyl(0.04, 0.07, 12, x, y, z, 0xd8dde0, 6);
        b.box(0.04, 1.2, 2.1, x, y + 11.2, z + toWall * 1.1, FLAGS[it.c % FLAGS.length]);
        break;
      }
      case 'trolleys': {
        if (low) break;
        // A rail and a line of nested trolleys.
        for (const s of [-1, 1]) b.box(3.2, 0.05, 0.05, x, y + 0.85, z + s * 0.42, STEEL);
        for (const ex of [-1.6, 1.6]) for (const s of [-1, 1]) b.box(0.05, 0.85, 0.05, x + ex, y + 0.42, z + s * 0.42, STEEL);
        for (let k = 0; k < 5; k++) {
          const tx = x - 1.2 + k * 0.5;
          b.box(0.5, 0.3, 0.5, tx, y + 0.5, z, 0xb6bcc2);
          b.box(0.5, 0.03, 0.56, tx, y + 0.2, z, 0x5c6168);
          b.box(0.03, 0.55, 0.5, tx + 0.25, y + 0.62, z, 0x1f5aa8);
        }
        break;
      }
      case 'shelter': {
        const hl = 4.2;
        const hd = 0.9;
        b.box(hl * 2 + 0.6, 0.12, hd * 2 + 0.5, x, y + 2.7, z, 0xdfe3e6);
        for (const s of [-1, 1]) b.box(0.12, 2.65, 0.12, x + s * hl, y + 1.33, z + toWall * hd, DARK);
        b.box(hl * 2, 2.1, 0.05, x, y + 1.4, z + toWall * hd, 0x6e8596);
        for (const s of [-1, 1]) b.box(0.05, 2.1, hd * 1.4, x + s * hl, y + 1.4, z + toWall * 0.25, 0x6e8596);
        b.box(5, 0.05, 0.4, x, y + 0.48, z + toWall * 0.6, TIMBER);
        for (const s of [-2, 2]) b.box(0.08, 0.46, 0.36, x + s, y + 0.23, z + toWall * 0.6, STEEL);
        b.cyl(0.05, 0.06, 3.2, x + hl + 0.8, y, z - toWall * 0.6, DARK, 6);
        b.box(1.1, 0.5, 0.06, x + hl + 0.8, y + 3.0, z - toWall * 0.6, 0x143a6b);
        sign('BUS', x + hl + 0.8, y + 3.0, z - toWall * 0.6, 1.0, 0.45);
        break;
      }
      case 'sign':
        b.cyl(0.05, 0.06, 3.4, x, y, z, DARK, 6);
        b.box(1.3, 0.56, 0.08, x, y + 3.2, z, 0x143a6b);
        sign(it.text, x, y + 3.2, z, 1.2, 0.5);
        break;
      case 'kiosk': {
        // The stairs up from the car park: a glazed box, black inside, its door facing the terminal.
        const hw = 1.6;
        const hd = 1.0;
        for (const sx of [-1, 1]) b.box(0.2, 2.8, hd * 2, x + sx * (hw + 0.1), y + 1.4, z, 0xe8ecef);
        b.box(hw * 2 + 0.4, 2.8, 0.2, x, y + 1.4, z - toWall * (hd + 0.1), 0xe8ecef);
        b.box(hw * 2 + 0.8, 0.3, hd * 2 + 0.8, x, y + 2.95, z, 0xdfe3e6);
        b.box(hw * 2, 2.8, 0.04, x, y + 1.4, z - toWall * (hd - 0.04), 0x07090b);
        for (const sx of [-1, 1]) b.box(0.04, 2.8, hd * 2, x + sx * (hw - 0.02), y + 1.4, z, 0x07090b);
        b.box(hw * 2, 0.04, hd * 2, x, y + 2.76, z, 0x07090b);
        b.box(1.9, 0.5, 0.08, x, y + 3.45, z, 0x143a6b);
        sign('CAR PARK', x, y + 3.45, z, 1.8, 0.42);
        break;
      }
      case 'totem':
        b.box(0.9, 4.2, 0.28, x, y + 2.1, z, 0x1a2c44);
        sign(it.text, x, y + 3.6, z + 0.08 * 0, 0.84, 0.3);
        break;
      default:
    }
  }
  const group = new THREE.Group();
  group.name = 'world-life:landside';
  // On Low the furniture goes into the forecourt's own mesh: one draw for all of it.
  const lights0 = glow.length ? glowPoints(glow, glowCol, 3.2, { opacity: 0.9, name: 'landside-lamps' }) : null;
  if (lights0) {
    lights0.visible = false;
    group.add(lights0);
  }
  if (low) return { group, lights: lights0, batch: b };
  // After dark the lamps light the ground, and the canopy the doors: soft pools, steady, with the lamps.
  if (lights0) {
    const p = new Batch();
    for (const [x, y, z] of pools) p.flat(17, 17, x, y + 0.1, z, 0xffdfae);
    const w = T.u1 - T.u0;
    const mid = (T.u0 + T.u1) / 2;
    const yk = AIRPORT.elev + 0.14;
    for (let k = -3; k <= 3; k++) p.flat(w / 7.5, 15, F.x(mid + (k * w) / 9), yk, F.z(T.back + 4), 0xfff0d2);
    const mat = new THREE.MeshBasicMaterial({ map: glowTexture(), vertexColors: true, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false });
    const m = p.mesh(mat, { cast: false, receive: false, name: 'landside-light-pools' });
    if (m) lights0.add(m);
  }
  const mesh = b.mesh(vcMaterial({ roughness: 0.75, metalness: 0.08 }), { cast: !low, receive: false, name: 'landside-furniture' });
  if (mesh) group.add(mesh);
  if (words && words.vertexCount) {
    const tex = signAtlas();
    const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.25, roughness: 0.6 });
    const wm = words.mesh(m, { cast: false, receive: false, name: 'landside-signs' });
    wm.geometry.deleteAttribute('color');
    group.add(wm);
  }
  return { group, lights: lights0 };
}

/* ------------------------------------------------------------------ */
/* The ground                                                          */
/* ------------------------------------------------------------------ */

const ASPHALT = 0x3d4248;
const ASPHALT2 = 0x43484e;
const SLAB = 0xbfc2c4;
const SLAB2 = 0xb3b7ba;
const KERBSTONE = 0xdcdedf;
const LINE = 0xe6e8e4;

/** A quad lying on the ground, wound to face up whichever way round its corners come. */
function ground4(b, a, c, d, e, col) {
  const up = (c[0] - a[0]) * (d[2] - a[2]) - (c[2] - a[2]) * (d[0] - a[0]) < 0;
  if (up) b.quad(a, c, d, e, [0, 0, 1, 1], col);
  else b.quad(a, e, d, c, [0, 0, 1, 1], col);
}

/**
 * The forecourt in one mesh: the paving from the wall to the kerb, the road and
 * its paint, the crossings, the island's pavement and the car park's way in.
 * Laid on `ground`, a few centimetres proud. `road` may be null: then the
 * paving, and a kerb with grass beyond it.
 */
export function buildForecourt(lay, road, plan, ground, quality, into = null) {
  const F = lay.frame;
  const T = lay.terminal;
  const low = quality === 'low';
  const b = into || new Batch();
  const P = (u, w, lift = 0) => {
    const x = F.x(u);
    const z = F.z(T.back + w);
    return [x, ground(x, z) + lift, z];
  };
  const half = road ? road.L + 6 : plan.half + 6;
  const mid = plan.mid;
  const grid = low ? 4 : 2;
  // The paving, slab by slab, and the kerbstones along its edge.
  for (let u = mid - half; u < mid + half; u += grid) {
    for (let w = 0.2; w < KERB - 0.6; w += grid) {
      const w1 = Math.min(w + grid, KERB - 0.6);
      const col = (Math.floor(u / grid) + Math.floor(w / grid)) % 2 ? SLAB : SLAB2;
      ground4(b, P(u, w), P(u + grid, w), P(u + grid, w1), P(u, w1), col);
    }
    ground4(b, P(u, KERB - 0.6), P(u + grid, KERB - 0.6), P(u + grid, KERB), P(u, KERB), KERBSTONE);
  }
  if (!road) return wrapGround(b);
  // The road: quads across its width, along the loop.
  const pts = road.ring;
  const n = pts.length;
  const steps = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const c = pts[(i + 1) % n];
    const L = Math.hypot(c.x - a.x, c.z - a.z);
    const k = Math.max(1, Math.ceil(L / (low ? 12 : 6)));
    for (let j = 0; j < k; j++) steps.push({ x: a.x + ((c.x - a.x) * j) / k, z: a.z + ((c.z - a.z) * j) / k, dx: (c.x - a.x) / L, dz: (c.z - a.z) / L });
  }
  const at = (s, off, lift) => {
    const x = s.x - s.dz * off;
    const z = s.z + s.dx * off;
    return [x, ground(x, z) + lift, z];
  };
  const hw = road.hw;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const q = steps[(i + 1) % steps.length];
    ground4(b, at(s, -hw, 0.03), at(q, -hw, 0.03), at(q, hw, 0.03), at(s, hw, 0.03), i % 2 ? ASPHALT : ASPHALT2);
    // An edge line each side, and a dashed line down the middle.
    for (const off of [-hw + 0.35, hw - 0.35]) ground4(b, at(s, off - 0.07, 0.05), at(q, off - 0.07, 0.05), at(q, off + 0.07, 0.05), at(s, off + 0.07, 0.05), LINE);
    if (i % 2 === 0 && !low) ground4(b, at(s, -0.06, 0.05), at(q, -0.06, 0.05), at(q, 0.06, 0.05), at(s, 0.06, 0.05), LINE);
  }
  // Zebra crossings, from the kerb to the island: long bars lying along the traffic, stepping across the road.
  for (const u of road.zebras) {
    for (let w = road.near - hw + 0.5; w < road.near + hw - 0.6; w += 1.1) ground4(b, P(u - 2.4, w, 0.06), P(u + 2.4, w, 0.06), P(u + 2.4, w + 0.55, 0.06), P(u - 2.4, w + 0.55, 0.06), LINE);
  }
  // The island's pavement, from the crossings to the stairs from the car park.
  const w0 = road.near + hw;
  for (let u = mid - road.L + 8; u < mid + road.L - 8; u += 6) ground4(b, P(u, w0, 0.03), P(u + 6, w0, 0.03), P(u + 6, w0 + 2.4, 0.03), P(u, w0 + 2.4, 0.03), SLAB2);
  const kiosk = plan.items.find((q) => q.kind === 'kiosk');
  if (kiosk) {
    for (let w = w0 + 2.4; w < kiosk.w - 0.9; w += 2) ground4(b, P(kiosk.u - 1.6, w, 0.03), P(kiosk.u + 1.6, w, 0.03), P(kiosk.u + 1.6, w + 2, 0.03), P(kiosk.u - 1.6, w + 2, 0.03), SLAB);
  }
  // The car park's way in, off the back of the loop.
  if (road.inRing && lay.carPark) {
    const c = lay.carPark;
    const w1 = c.w0 - T.back + c.depth;
    for (let w = w1 - 0.5; w < road.far - hw + 0.5; w += 2) ground4(b, P(mid - 4, w, 0.02), P(mid + 4, w, 0.02), P(mid + 4, w + 2, 0.02), P(mid - 4, w + 2, 0.02), ASPHALT);
  }
  return wrapGround(b);
}

function wrapGround(b) {
  const m = b.mesh(vcMaterial({ roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), { cast: false, receive: true, name: 'world-life:forecourt' });
  return m;
}
