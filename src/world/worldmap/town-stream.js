/**
 * World Map: the towns' buildings, streamed round the camera.
 *
 * The plan is worldmap/town-grid.js's: this draws it. The same scheme as the
 * trees (worldmap/flora.js): the world is cut into cells, a cell is answered by
 * the worker (plain arrays, made once, ready to copy), and what is drawn is one
 * InstancedMesh for each kind of thing — a few draw calls whatever the count —
 * filled by copying the cells in range into place: a cell arriving costs a
 * memcpy, not a rebuild. Only cells a town touches are ever asked for.
 *
 * ONE MATERIAL, ONE TEXTURE. The houses, shops, flats, garages, fences and cars
 * all sample one little atlas made here from numbers (no download, no canvas),
 * so each is one more draw call and never another program. The walls take the
 * instance's colour, the roofs a second colour per instance (aRoof), so a street
 * is a street of different houses for the price of one house.
 *
 * NO POP. Past the tier's radius a house is not there; the paint's roof
 * (worldmap/world-terrain.js) is, on the same rectangle, in the same colour.
 * Coming in, the house rises out of it in the vertex shader over the last stretch
 * of the radius. From the air nothing appears at all. Nothing is per-frame here:
 * the fade is the GPU's.
 *
 * SOLID. The buildings round a low aeroplane are made obstacles (terrain.js,
 * flora.js's short list) and taken away again when it climbs or moves on.
 *
 * NIGHT. Windows light by their own numbers in the atlas's alpha, each house
 * different (aRoof's seed); steady, nothing blinks.
 *
 * Precision: as flora.js, relative to a 16 km grid point near the camera.
 */
import * as THREE from '../../vendor/three.module.js';
import { KIND, KIND_COUNT, TOWN_CELL, TOWN_TIERS, placeTownCell, townCells } from './town-grid.js';
import { TOWN_SHADE } from './world-terrain.js';
import { WORKER_TIMEOUT_MS, ORIGIN_SNAP } from './flora.js';

/* ------------------------------------------------------------------ */
/* The atlas                                                            */
/* ------------------------------------------------------------------ */

const AW = 512;
const AH = 512;
/** Rectangles in the atlas, [u0, v0, u1, v1] with v up (three's convention for a texture with flipY false: row 0 is v 0). */
const R = {
  twoFront: [0, 0.75, 0.25, 1],
  twoSide: [0.25, 0.75, 0.5, 1],
  oneFront: [0.5, 0.75, 0.75, 1],
  oneSide: [0.75, 0.75, 1, 1],
  roof: [0, 0.5, 0.25, 0.75],
  garage: [0.25, 0.5, 0.5, 0.75],
  shop: [0.5, 0.5, 0.75, 0.75],
  shopSide: [0.75, 0.5, 1, 0.75],
  flats: [0, 0.25, 0.25, 0.5],
  flatsSide: [0.25, 0.25, 0.5, 0.5],
  flatRoof: [0.5, 0.25, 0.75, 0.5],
  plain: [0.76, 0.26, 0.99, 0.49],
  dark: [0.01, 0.01, 0.24, 0.24],
  glass: [0.26, 0.01, 0.49, 0.24],
};

/** One RGBA pixel array, drawn by rectangles: rgb the surface, alpha a window's light number (0 = not a window). */
export function makeAtlas() {
  const px = new Uint8Array(AW * AH * 4);
  const fill = (x0, y0, x1, y1, r, g, b, a = 0) => {
    for (let y = Math.round(y0); y < Math.round(y1); y++) {
      for (let x = Math.round(x0); x < Math.round(x1); x++) {
        const o = (y * AW + x) * 4;
        px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = a;
      }
    }
  };
  const R0 = (rect) => [rect[0] * AW, rect[1] * AH, rect[2] * AW, rect[3] * AH];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  /** A wall: pale render, a little grain, darker at the foot, a soffit shadow at the head. */
  const wall = (rect) => {
    const [x0, y0, x1, y1] = R0(rect);
    for (let y = y0; y < y1; y++) {
      const k = (y - y0) / (y1 - y0);
      for (let x = x0; x < x1; x++) {
        const o = (y * AW + x) * 4;
        const g = 232 + rnd() * 16 - (k < 0.05 ? 60 : 0) - (k > 0.95 ? 70 : 0);
        px[o] = g; px[o + 1] = g; px[o + 2] = g; px[o + 3] = 0;
      }
    }
  };
  /** A window: frame, glass a touch blue with a light top corner, a light number. */
  const win = (x, y, w, h, frame = 245) => {
    fill(x - 2, y - 2, x + w + 2, y + h + 2, frame, frame, frame);
    const light = 30 + Math.floor(rnd() * 220);
    fill(x, y, x + w, y + h, 40, 52, 66, light);
    fill(x + w * 0.1, y + h * 0.55, x + w * 0.5, y + h * 0.92, 92, 112, 134, light);
    fill(x + w / 2 - 1, y, x + w / 2 + 1, y + h, frame, frame, frame);
    fill(x, y + h / 2 - 1, x + w, y + h / 2 + 1, frame, frame, frame);
    fill(x - 3, y - 4, x + w + 3, y - 2, 190, 190, 190);
  };
  const door = (x, y, w, h) => {
    fill(x - 2, y, x + w + 2, y + h + 2, 240, 240, 240);
    fill(x, y, x + w, y + h, 74, 46, 36);
    fill(x + w * 0.25, y + h * 0.6, x + w * 0.75, y + h * 0.85, 120, 150, 170, 120);
  };
  const S = AW / 4;
  // Two storeys, front: door, a window each side; three above.
  wall(R.twoFront);
  {
    const [x0, y0] = R0(R.twoFront);
    door(x0 + S * 0.44, y0 + 6, S * 0.12, S * 0.36);
    for (const c of [0.17, 0.73]) win(x0 + S * c, y0 + S * 0.15, S * 0.14, S * 0.22);
    for (const c of [0.14, 0.43, 0.72]) win(x0 + S * c, y0 + S * 0.62, S * 0.14, S * 0.22);
  }
  wall(R.twoSide);
  {
    const [x0, y0] = R0(R.twoSide);
    for (const c of [0.2, 0.62]) {
      win(x0 + S * c, y0 + S * 0.15, S * 0.16, S * 0.22);
      win(x0 + S * c, y0 + S * 0.62, S * 0.16, S * 0.22);
    }
  }
  wall(R.oneFront);
  {
    const [x0, y0] = R0(R.oneFront);
    door(x0 + S * 0.43, y0 + 6, S * 0.13, S * 0.68);
    for (const c of [0.12, 0.7]) win(x0 + S * c, y0 + S * 0.3, S * 0.18, S * 0.42);
  }
  wall(R.oneSide);
  {
    const [x0, y0] = R0(R.oneSide);
    for (const c of [0.2, 0.62]) win(x0 + S * c, y0 + S * 0.3, S * 0.16, S * 0.42);
  }
  // Roof: courses of tile, a little lighter at the lip of each.
  {
    const [x0, y0, x1, y1] = R0(R.roof);
    for (let y = y0; y < y1; y++) {
      const c = ((y - y0) / 7) % 1;
      for (let x = x0; x < x1; x++) {
        const o = (y * AW + x) * 4;
        const row = Math.floor((y - y0) / 7);
        const tile = Math.floor((x - x0 + (row % 2) * 6) / 12);
        const j = ((tile * 37 + row * 91) % 19) / 19;
        const g = 196 + j * 40 + (c < 0.2 ? -46 : 0);
        px[o] = g; px[o + 1] = g; px[o + 2] = g; px[o + 3] = 0;
      }
    }
  }
  // Garage door: ribbed.
  wall(R.garage);
  {
    const [x0, y0] = R0(R.garage);
    fill(x0 + S * 0.08, y0 + 3, x0 + S * 0.92, y0 + S * 0.82, 214, 214, 212);
    for (let r = 0; r < 6; r++) fill(x0 + S * 0.08, y0 + 3 + (r * S * 0.79) / 6, x0 + S * 0.92, y0 + 5 + (r * S * 0.79) / 6, 160, 160, 158);
  }
  // A shop: a big window (always lit after dark: the lowest number) and a door, a fascia, a storey over.
  wall(R.shop);
  {
    const [x0, y0] = R0(R.shop);
    fill(x0 + S * 0.05, y0 + 6, x0 + S * 0.95, y0 + S * 0.5, 38, 50, 62, 0);
    fill(x0 + S * 0.08, y0 + 10, x0 + S * 0.44, y0 + S * 0.47, 92, 118, 138, 20);
    fill(x0 + S * 0.56, y0 + 10, x0 + S * 0.92, y0 + S * 0.47, 92, 118, 138, 20);
    fill(x0 + S * 0.46, y0 + 6, x0 + S * 0.54, y0 + S * 0.42, 30, 34, 38, 20);
    fill(x0, y0 + S * 0.5, x0 + S, y0 + S * 0.6, 150, 148, 142);
    for (const c of [0.18, 0.62]) win(x0 + S * c, y0 + S * 0.68, S * 0.18, S * 0.2);
  }
  wall(R.shopSide);
  // Flats: four floors of windows.
  wall(R.flats);
  wall(R.flatsSide);
  for (const rect of [R.flats, R.flatsSide]) {
    const [x0, y0] = R0(rect);
    const cols = rect === R.flats ? [0.07, 0.31, 0.55, 0.79] : [0.15, 0.6];
    for (let f = 0; f < 4; f++) {
      fill(x0, y0 + (f * S) / 4 + 1, x0 + S, y0 + (f * S) / 4 + 3, 196, 196, 192);
      for (const c of cols) win(x0 + S * c, y0 + ((f + 0.3) * S) / 4, S * 0.14, S * 0.13);
    }
  }
  // A flat roof: gravel.
  {
    const [x0, y0, x1, y1] = R0(R.flatRoof);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * AW + x) * 4; const g = 190 + rnd() * 34; px[o] = g; px[o + 1] = g; px[o + 2] = g; px[o + 3] = 0; }
    fill(x0, y0, x1, y0 + 8, 150, 150, 150);
  }
  fill(R.plain[0] * AW - 4, R.plain[1] * AH - 4, R.plain[2] * AW + 4, R.plain[3] * AH + 4, 255, 255, 255);
  fill(0, 0, AW / 4, AH / 4, 22, 24, 28);
  fill(AW / 4, 0, AW / 2, AH / 4, 58, 74, 92);
  return px;
}

let ATLAS = null;
function atlas() {
  if (ATLAS) return ATLAS;
  const t = new THREE.DataTexture(makeAtlas(), AW, AH, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 2;
  t.flipY = false;
  t.needsUpdate = true;
  t.name = 'town-atlas';
  ATLAS = t;
  return t;
}

/* ------------------------------------------------------------------ */
/* The shapes: a unit footprint, y 0 to 1 at the eaves, the roof above  */
/* ------------------------------------------------------------------ */

class Shape {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.roof = [];
    this.idx = [];
  }

  /** Four corners anticlockwise from outside; `rect` the atlas, `isRoof` takes the roof's colour and stretch. */
  quad(a, b, c, d, rect, isRoof = 0, us = 1, vs = 1) {
    const base = this.pos.length / 3;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const [u0, v0, u1, v1] = rect;
    const uv = [[u0, v0], [u0 + (u1 - u0) * us, v0], [u0 + (u1 - u0) * us, v0 + (v1 - v0) * vs], [u0, v0 + (v1 - v0) * vs]];
    [a, b, c, d].forEach((p, i) => {
      this.pos.push(...p);
      this.nrm.push(nx, ny, nz);
      this.uv.push(...uv[i]);
      this.roof.push(isRoof);
    });
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** A triangle (a gable's top): the walls' texture's upper part, stretched. */
  tri(a, b, c, rect, isRoof = 0) {
    const base = this.pos.length / 3;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const [u0, v0, u1, v1] = rect;
    const uv = [[u0, v0], [u1, v0], [(u0 + u1) / 2, v1]];
    [a, b, c].forEach((p, i) => {
      this.pos.push(...p);
      this.nrm.push(nx, ny, nz);
      this.uv.push(...uv[i]);
      this.roof.push(isRoof);
    });
    this.idx.push(base, base + 1, base + 2);
  }

  /** Four walls of a box from y0 to y1. */
  walls(x0, x1, z0, z1, y0, y1, front, side, back = side) {
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], front);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], back);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], side);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], side);
  }

  lid(x0, x1, z0, z1, y, rect, isRoof = 0) {
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], rect, isRoof);
  }

  /** A gabled roof, ridge along x, over x0..x1 and z0..z1, the eaves at y, the ridge at y + rise, overhanging by o. */
  gable(x0, x1, z0, z1, y, rise, o, wallRect, rich) {
    const zm = (z0 + z1) / 2;
    const ox = rich ? o : 0;
    const oz = rich ? o * 0.9 : 0;
    this.quad([x0 - ox, y, z1 + oz], [x1 + ox, y, z1 + oz], [x1 + ox, y + rise, zm], [x0 - ox, y + rise, zm], R.roof, 1);
    this.quad([x1 + ox, y, z0 - oz], [x0 - ox, y, z0 - oz], [x0 - ox, y + rise, zm], [x1 + ox, y + rise, zm], R.roof, 1);
    this.tri([x1, y, z1], [x1, y, z0], [x1, y + rise, zm], wallRect);
    this.tri([x0, y, z0], [x0, y, z1], [x0, y + rise, zm], wallRect);
    if (rich) {
      // Underneath the overhang, seen from the street.
      this.quad([x1 + ox, y, z1 + oz], [x0 - ox, y, z1 + oz], [x0 - ox, y, z0 - oz], [x1 + ox, y, z0 - oz], R.plain);
    }
  }

  chimney(x, z, y0, y1, w) {
    this.walls(x - w, x + w, z - w, z + w, y0, y1, R.plain, R.plain);
    this.lid(x - w * 1.1, x + w * 1.1, z - w * 1.1, z + w * 1.1, y1, R.dark);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aIsRoof', new THREE.Float32BufferAttribute(this.roof, 1));
    g.setIndex(this.idx);
    return g;
  }
}

const RISE = 0.6;

/** The house and the rest of the lot's things, by kind. */
export function townGeometry(kind, rich) {
  const s = new Shape();
  const X = 0.5;
  const Z = 0.5;
  switch (kind) {
    case KIND.GABLE:
      s.walls(-X, X, -Z, Z, 0, 1, R.twoFront, R.twoSide);
      s.gable(-X, X, -Z, Z, 1, RISE, 0.05, R.plain, rich);
      if (rich) s.chimney(-0.28, -0.1, 1.1, 1.75, 0.05);
      break;
    case KIND.HIP: {
      s.walls(-X, X, -Z, Z, 0, 1, R.oneFront, R.oneSide);
      const o = rich ? 0.05 : 0;
      const ix = 0.2;
      s.quad([-X - o, 1, Z + o], [X + o, 1, Z + o], [ix, 1 + RISE, 0], [-ix, 1 + RISE, 0], R.roof, 1);
      s.quad([X + o, 1, -Z - o], [-X - o, 1, -Z - o], [-ix, 1 + RISE, 0], [ix, 1 + RISE, 0], R.roof, 1);
      s.tri([X + o, 1, Z + o], [X + o, 1, -Z - o], [ix, 1 + RISE, 0], R.roof, 1);
      s.tri([-X - o, 1, -Z - o], [-X - o, 1, Z + o], [-ix, 1 + RISE, 0], R.roof, 1);
      if (rich) s.quad([X + o, 1, Z + o], [-X - o, 1, Z + o], [-X - o, 1, -Z - o], [X + o, 1, -Z - o], R.plain);
      break;
    }
    case KIND.ELL:
      // The house, and its garage forward of it on the drive's side, under a lower roof.
      s.walls(-X, 0.12, -Z, Z, 0, 1, R.twoFront, R.twoSide);
      s.walls(0.12, X, -Z, 0.42, 0, 0.56, R.garage, R.oneSide);
      s.gable(-X, 0.12, -Z, Z, 1, RISE, 0.05, R.plain, rich);
      s.gable(0.12, X, -Z, 0.42, 0.56, RISE * 0.55, 0.03, R.plain, rich);
      if (rich) s.chimney(-0.3, -0.12, 1.1, 1.75, 0.05);
      break;
    case KIND.PORCH:
      s.walls(-X, X, -Z, 0.3, 0, 1, R.twoFront, R.twoSide);
      s.gable(-X, X, -Z, 0.3, 1, RISE, 0.05, R.plain, rich);
      // The veranda across the front: a lean-to on posts.
      s.quad([-X, 0.55, Z], [X, 0.55, Z], [X, 0.72, 0.3], [-X, 0.72, 0.3], R.roof, 1);
      s.lid(-X, X, 0.3, Z, 0.02, R.plain);
      for (const x of [-0.46, 0, 0.46]) s.walls(x - 0.018, x + 0.018, Z - 0.03, Z, 0, 0.55, R.plain, R.plain);
      if (rich) s.quad([X, 0.55, Z], [-X, 0.55, Z], [-X, 0.55, 0.3], [X, 0.55, 0.3], R.plain);
      break;
    case KIND.SHOP:
      s.walls(-X, X, -Z, Z, 0, 1, R.shop, R.shopSide);
      s.lid(-X, X, -Z, Z, 1, R.flatRoof, 1);
      if (rich) {
        // A parapet, and a shallow awning over the street.
        s.quad([-X, 0.33, Z + 0.22], [X, 0.33, Z + 0.22], [X, 0.42, Z], [-X, 0.42, Z], R.plain, 1);
        s.walls(-X, X, -Z, Z, 1, 1.06, R.plain, R.plain);
      }
      break;
    case KIND.FLATS:
      s.walls(-X, X, -Z, Z, 0, 1, R.flats, R.flatsSide, R.flats);
      s.lid(-X, X, -Z, Z, 1, R.flatRoof, 1);
      if (rich) {
        s.walls(-X, X, -Z, Z, 1, 1.03, R.plain, R.plain);
        s.walls(-0.14, 0.14, -0.2, 0.2, 1, 1.1, R.plain, R.plain);
        s.lid(-0.14, 0.14, -0.2, 0.2, 1.1, R.flatRoof, 1);
      }
      break;
    case KIND.GARAGE:
      s.walls(-X, X, -Z, Z, 0, 1, R.garage, R.oneSide);
      s.gable(-X, X, -Z, Z, 1, RISE, 0.04, R.plain, false);
      break;
    case KIND.FENCE:
      s.walls(-X, X, -Z, Z, 0, 1, R.plain, R.plain);
      s.lid(-X, X, -Z, Z, 1, R.plain);
      break;
    case KIND.CAR: {
      // A body and a cabin, the glass dark.
      s.walls(-X, X, -Z, Z, 0.16, 0.56, R.plain, R.plain);
      s.lid(-X, X, -Z, Z, 0.56, R.plain);
      s.quad([-0.42, 0.56, 0.16], [0.42, 0.56, 0.16], [0.36, 1, 0.02], [-0.36, 1, 0.02], R.glass);
      s.quad([0.42, 0.56, -0.34], [-0.42, 0.56, -0.34], [-0.36, 1, -0.24], [0.36, 1, -0.24], R.glass);
      s.quad([0.42, 0.56, 0.16], [0.42, 0.56, -0.34], [0.36, 1, -0.24], [0.36, 1, 0.02], R.glass);
      s.quad([-0.42, 0.56, -0.34], [-0.42, 0.56, 0.16], [-0.36, 1, 0.02], [-0.36, 1, -0.24], R.glass);
      s.lid(-0.36, 0.36, -0.24, 0.02, 1, R.plain);
      s.walls(-X, X, -Z, Z, 0, 0.16, R.dark, R.dark);
      break;
    }
    default:
      s.walls(-X, X, -Z, Z, 0, 1, R.plain, R.plain);
  }
  return s.build();
}

/* ------------------------------------------------------------------ */
/* The material                                                         */
/* ------------------------------------------------------------------ */

function townMaterial(quality) {
  // (Low: Lambert. A town fills the screen at circuit height, and that is a Chromebook's whole frame.)
  const mat = quality === 'low' ? new THREE.MeshLambertMaterial({ map: atlas() }) : new THREE.MeshStandardMaterial({ map: atlas(), roughness: 0.82, metalness: 0, envMapIntensity: 0.5 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, TOWN_SHADE);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aRoof;
attribute float aIsRoof;
uniform float uTownR;
varying float vTownSeed;`)
      .replace('#include <color_vertex>', `#include <color_vertex>
vColor = mix(vColor, aRoof.rgb, aIsRoof);
vTownSeed = floor(aRoof.w) / 8.0 + 0.06;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  // The roof's own pitch, and the rise out of the paint coming into range.
  float eave = max(0.0, transformed.y - 1.0);
  transformed.y -= eave * (1.0 - fract(aRoof.w) * 2.0);
  vec4 at = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float grow = 1.0 - smoothstep(uTownR * 0.86, uTownR, length(at.xyz));
  transformed.y *= grow;
  if (grow <= 0.0) transformed = vec3(0.0, -1000.0, 0.0);
}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTownGlow;
varying float vTownSeed;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float num = sampledDiffuseColor.a;
  float on = smoothstep(0.02, 0.06, num) * step(num, vTownSeed * 0.6 + 0.12);
  totalEmissiveRadiance += vec3(1.0, 0.72, 0.40) * on * uTownGlow * 0.62;
}`);
  };
  mat.customProgramCacheKey = () => `town-houses-${quality === 'low' ? 'l' : 's'}`;
  return mat;
}

/* ------------------------------------------------------------------ */
/* The stream                                                           */
/* ------------------------------------------------------------------ */

const NAMES = ['gable', 'hip', 'ell', 'porch', 'shop', 'flats', 'garage', 'fence', 'car', 'tree-broad', 'tree-palm', 'tree-conifer'];
/** How many of each the pool holds, per tier (sized for the capital seen from its middle). */
const CAP = Object.freeze({
  low: [1300, 1100, 700, 900, 500, 200, 0, 0, 0, 1400, 1400, 700],
  medium: [1500, 1300, 900, 1100, 600, 300, 700, 0, 1100, 2800, 2800, 1400],
  high: [1700, 1500, 1000, 1200, 700, 350, 900, 2700, 1700, 4200, 4200, 2000],
  ultra: [1800, 1600, 1100, 1300, 800, 400, 1000, 3000, 2000, 5500, 5500, 2600],
});

const _white = new THREE.Color(1, 1, 1);

export class TownStream {
  /**
   * @param {object} o
   * @param {object} o.ctx            town-grid.js townContext
   * @param {object} [o.T]            terrain.js, for the main-thread fallback
   * @param {Worker} [o.worker]       the tile worker
   * @param {Function} [o.treeShape]  (kind) => geometry for the garden trees (tree-cards.js)
   * @param {THREE.Material} [o.treeMaterial]
   */
  constructor({ ctx, T = null, worker = null, gen = 0, quality = 'medium', addObstacle = null, obstacles = null, now = () => performance.now(), workerOk = null, treeShape = null, treeMaterial = null }) {
    this.ctx = ctx;
    this.T = T;
    this.worker = worker;
    this.gen = gen;
    this.quality = quality;
    this.tier = TOWN_TIERS[quality] || TOWN_TIERS.medium;
    this.now = now;
    this.workerOk = workerOk;
    this.addObstacle = addObstacle;
    this.obstacles = obstacles;
    this.known = townCells(ctx);
    this.cells = new Map();
    this.pending = new Map();
    this.group = new THREE.Group();
    this.group.name = 'world-town-stream';
    this.origin = { x: NaN, z: NaN };
    this.material = townMaterial(quality);
    TOWN_SHADE.uTownR.value = this.tier.radius;
    const caps = CAP[quality] || CAP.medium;
    this.meshes = caps.map((cap, kind) => {
      if (!cap) return null;
      const tree = kind >= KIND.TREE_BROAD;
      if (tree && !treeShape) return null;
      const g = tree ? treeShape(kind === KIND.TREE_BROAD ? 1 : kind === KIND.TREE_PALM ? 0 : 2) : townGeometry(kind, this.tier.rich);
      const m = new THREE.InstancedMesh(g, tree ? treeMaterial : this.material, cap);
      m.name = `world-town:${NAMES[kind]}`;
      m.count = 0;
      m.visible = false;
      m.castShadow = this.tier.shadows && !tree && kind !== KIND.CAR && kind !== KIND.FENCE;
      m.receiveShadow = this.tier.shadows;
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, _white);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      if (!tree) {
        m.roofAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
        m.roofAttr.setUsage(THREE.DynamicDrawUsage);
        g.setAttribute('aRoof', m.roofAttr);
      }
      this.group.add(m);
      return m;
    });
    this.dirty = false;
    this.solid = [];
    this.solidAt = null;
    this.counts = { cells: 0, drawn: 0, workerCells: 0, cpuCells: 0, refills: 0, maxRefillMs: 0, dropped: 0 };
    if (this.worker) {
      this._onMsg = (ev) => this.onMessage(ev.data);
      this.worker.addEventListener('message', this._onMsg);
    }
  }

  onMessage(m) {
    if (!m || m.op !== 'town' || m.gen !== this.gen) return;
    this.pending.delete(m.key);
    if (m.error) {
      this.abandonWorker();
      return;
    }
    this.counts.workerCells++;
    this.arrive(m.key, m.ix, m.iz, m.cell);
  }

  abandonWorker() {
    if (this.worker && this._onMsg) this.worker.removeEventListener('message', this._onMsg);
    this.worker = null;
    this.pending.clear();
  }

  arrive(key, ix, iz, cell) {
    this.cells.set(key, { key, ix, iz, cell });
    this.dirty = true;
  }

  /** The town cells inside the reach. The reach is a little more than the radius, so a cell is here before its first house rises. */
  wanted(x, z) {
    const R = this.tier.radius + 600;
    const out = [];
    for (let ix = Math.floor((x - R) / TOWN_CELL); ix <= Math.floor((x + R) / TOWN_CELL); ix++) {
      for (let iz = Math.floor((z - R) / TOWN_CELL); iz <= Math.floor((z + R) / TOWN_CELL); iz++) {
        const key = `${ix}:${iz}`;
        if (!this.known.has(key)) continue;
        const dx = Math.max(0, Math.abs(x - (ix + 0.5) * TOWN_CELL) - TOWN_CELL / 2);
        const dz = Math.max(0, Math.abs(z - (iz + 0.5) * TOWN_CELL) - TOWN_CELL / 2);
        const d = Math.hypot(dx, dz);
        if (d <= R) out.push({ ix, iz, key, d });
      }
    }
    return out.sort((a, b) => a.d - b.d);
  }

  update(cam, ac = null, budgetMs = 1) {
    const ox = Math.round(cam.x / ORIGIN_SNAP) * ORIGIN_SNAP;
    const oz = Math.round(cam.z / ORIGIN_SNAP) * ORIGIN_SNAP;
    if (ox !== this.origin.x || oz !== this.origin.z) {
      this.origin.x = ox;
      this.origin.z = oz;
      for (const m of this.meshes) {
        if (!m) continue;
        m.position.set(ox, 0, oz);
        m.updateMatrix();
      }
      this.dirty = true;
    }
    // Which cells: every 64 m flown, or while some are still to come. (Over the sea this is nothing at all.)
    const t0 = this.now();
    if (this.pending.size || this.behind || !this.wantAt || Math.abs(cam.x - this.wantAt.x) + Math.abs(cam.z - this.wantAt.z) > 64) {
      this.wantAt = { x: cam.x, z: cam.z };
      this.behind = false;
      const want = this.wanted(cam.x, cam.z);
      const keep = new Set(want.map((w) => w.key));
      for (const k of [...this.cells.keys()]) {
        if (!keep.has(k)) {
          this.cells.delete(k);
          this.counts.dropped++;
          this.dirty = true;
        }
      }
      if (this.worker) {
        let stale = this.workerOk && !this.workerOk();
        for (const at of this.pending.values()) if (t0 - at > WORKER_TIMEOUT_MS) stale = true;
        if (stale) this.abandonWorker();
      }
      for (const w of want) {
        if (this.cells.has(w.key) || this.pending.has(w.key)) continue;
        if (this.worker) {
          if (this.pending.size >= 2) {
            this.behind = true;
            break;
          }
          this.pending.set(w.key, t0);
          this.worker.postMessage({ op: 'town', gen: this.gen, key: w.key, ix: w.ix, iz: w.iz, q: this.quality });
        } else if (this.T) {
          if (this.now() - t0 > budgetMs) {
            this.behind = true;
            break;
          }
          this.arrive(w.key, w.ix, w.iz, placeTownCell(this.T, this.ctx, w.ix, w.iz, this.tier));
          this.counts.cpuCells++;
        }
      }
    }
    if (this.dirty) this.refill();
    if (ac) this.makeSolid(ac);
  }

  /** Copy the cells in range into the pools: a memcpy each, and the origin added to each instance. */
  refill() {
    const t0 = this.now();
    const fill = new Array(KIND_COUNT).fill(0);
    for (const c of this.cells.values()) {
      if (!c.cell) continue;
      const dx = c.ix * TOWN_CELL - this.origin.x;
      const dz = c.iz * TOWN_CELL - this.origin.z;
      c.cell.kinds.forEach((b, kind) => {
        const mesh = this.meshes[kind];
        if (!mesh || !b.n) return;
        const n = Math.min(b.n, mesh.instanceMatrix.count - fill[kind]);
        if (n <= 0) return;
        const arr = mesh.instanceMatrix.array;
        const at = fill[kind] * 16;
        arr.set(n === b.n ? b.m : b.m.subarray(0, n * 16), at);
        for (let k = 0; k < n; k++) {
          arr[at + k * 16 + 12] += dx;
          arr[at + k * 16 + 14] += dz;
        }
        mesh.instanceColor.array.set(n === b.n ? b.col : b.col.subarray(0, n * 3), fill[kind] * 3);
        if (mesh.roofAttr) mesh.roofAttr.array.set(n === b.n ? b.roof : b.roof.subarray(0, n * 4), fill[kind] * 4);
        fill[kind] += n;
      });
    }
    let drawn = 0;
    this.meshes.forEach((m, kind) => {
      if (!m) return;
      m.count = fill[kind];
      m.visible = fill[kind] > 0;
      drawn += fill[kind];
      if (fill[kind] > 0) {
        m.instanceMatrix.clearUpdateRanges();
        m.instanceMatrix.addUpdateRange(0, fill[kind] * 16);
        m.instanceMatrix.needsUpdate = true;
        m.instanceColor.clearUpdateRanges();
        m.instanceColor.addUpdateRange(0, fill[kind] * 3);
        m.instanceColor.needsUpdate = true;
        if (m.roofAttr) {
          m.roofAttr.clearUpdateRanges();
          m.roofAttr.addUpdateRange(0, fill[kind] * 4);
          m.roofAttr.needsUpdate = true;
        }
      }
    });
    this.dirty = false;
    this.counts.cells = this.cells.size;
    this.counts.drawn = drawn;
    this.counts.refills++;
    this.counts.maxRefillMs = Math.max(this.counts.maxRefillMs, this.now() - t0);
  }

  /** The buildings the aeroplane could hit: those round it while it is low, and no others. */
  makeSolid(ac) {
    const low = ac.agl != null ? ac.agl < 130 : true;
    if (!low) {
      if (this.solid.length || this.solidAt) this.clearSolid();
      return;
    }
    const p = ac.pos;
    if (this.solidAt && Math.hypot(p.x - this.solidAt.x, p.z - this.solidAt.z) < 90) return;
    this.clearSolid();
    if (!this.addObstacle) return;
    this.solidAt = { x: p.x, z: p.z };
    const reach = 200;
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const c = this.cells.get(`${Math.floor(p.x / TOWN_CELL) + a}:${Math.floor(p.z / TOWN_CELL) + b}`);
        if (!c || !c.cell) continue;
        const s = c.cell.solid;
        for (let i = 0; i < s.length; i += 6) {
          if (s[i + 1] < p.x - reach || s[i] > p.x + reach || s[i + 3] < p.z - reach || s[i + 2] > p.z + reach) continue;
          this.solid.push(this.addObstacle({ x0: s[i], x1: s[i + 1], z0: s[i + 2], z1: s[i + 3], y0: s[i + 4], y1: s[i + 5], what: 'You flew into a house' }));
        }
      }
    }
  }

  clearSolid() {
    if (this.solid.length && this.obstacles) {
      const gone = new Set(this.solid);
      let w = 0;
      for (let i = 0; i < this.obstacles.length; i++) if (!gone.has(this.obstacles[i])) this.obstacles[w++] = this.obstacles[i];
      this.obstacles.length = w;
    }
    this.solid.length = 0;
    this.solidAt = null;
  }

  /** Lit windows and street lamps: from worldmap/outstation.js's own glow. */
  setGlow(v) {
    TOWN_SHADE.uTownGlow.value = v;
  }

  stats() {
    return { ...this.counts, pending: this.pending.size, solid: this.solid.length, meshes: this.meshes.filter((m) => m && m.visible).length, kinds: this.meshes.map((m) => (m ? m.count : 0)) };
  }

  dispose() {
    this.clearSolid();
    if (this.worker && this._onMsg) this.worker.removeEventListener('message', this._onMsg);
    for (const m of this.meshes) {
      if (!m) continue;
      m.geometry.dispose();
      m.dispose();
    }
    this.material.dispose();
    this.cells.clear();
    this.gen = -1;
  }
}
