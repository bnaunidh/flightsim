/**
 * The people in the cabin, as you see them: in the windows from outside, and
 * in their seats from the Cabin view.
 *
 * FROM OUTSIDE. An airliner's skin is opaque and its windows are dark glass
 * laid on it (fleet/extra/airliner-kit.js windowRows: one InstancedMesh per
 * fuselage piece, named 'Cabin window rows'), so there is no cabin behind them
 * to see into — and cutting the skin open for one would cost every airliner
 * an interior whether anybody looked or not. What a window shows from outside
 * is a head and shoulders against the glass, so that is what is drawn: one
 * more InstancedMesh per window mesh, a quad over each pane with a person's
 * outline on it, faint (they are behind tinted glass), one per occupied seat
 * by the window. Cheap — a quad a window, one draw a piece — and only drawn
 * while the camera is within SIL_NEAR of the aeroplane (the LOD: past that a
 * head is under a pixel). It is NOT a child of the model: the crash breaks
 * the model's pieces off (game/breakup*.js clones them), and nobody should
 * fly off with a piece of fuselage. It sits in the scene and copies its
 * window mesh's world matrix just before it is drawn; on a crash it hides.
 *
 * A model without that mesh (the Meridian's civil build merges its panes into
 * one static mesh) gets no silhouettes; it still has the Cabin view.
 *
 * THE CABIN VIEW. Built when you first switch to it, thrown away with the
 * flight: a shell a little inside the skin — floor, carpet, sidewalls with a
 * real hole at every window (the skin is FrontSide, so from in here it is not
 * drawn and the holes look straight out at the sky, and at the wing over it),
 * overhead bins, a ceiling with its light strip, the front bulkhead — the
 * seats, three, four or ten abreast, and everybody aboard in them, all
 * instanced. The camera stands at the back of the cabin in the aisle, looking
 * forward over the rows of heads. Every number comes from layout.js
 * cabinFor(), which reads the doors, so a type nobody has seen still gets a
 * cabin of the right width and length.
 */

import * as THREE from '../../vendor/three.module.js';
import { seatedGeometry, headGeometry } from './jumpers.js';
import { seatOrder, seeded } from './layout.js';
import { walkerParts } from './walkers.js';

/** People standing in the aisle at once while the cabin fills (or empties). */
export const AISLE_WALKERS = 6;
const _w = new THREE.Vector3();
const _wq = new THREE.Quaternion();
const _ws = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);

/** Metres from the camera to the aeroplane beyond which no silhouettes are drawn. */
export const SIL_NEAR = 240;

/* ------------------------------------------------------------------ */
/* Window silhouettes                                                  */
/* ------------------------------------------------------------------ */

let silTex = null;
function silhouetteTexture() {
  if (silTex) return silTex;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 96;
  const g = c.getContext('2d');
  if (!g || typeof g.arc !== 'function') return null;
  g.clearRect(0, 0, 64, 96);
  // Inside the pane's own rounded outline (a little in from it), so no corner
  // of a shoulder ever shows on the paint beside the glass.
  g.save();
  g.beginPath();
  const R = 22;
  g.moveTo(6 + R, 6);
  g.lineTo(58 - R, 6);
  g.quadraticCurveTo(58, 6, 58, 6 + R);
  g.lineTo(58, 90 - R);
  g.quadraticCurveTo(58, 90, 58 - R, 90);
  g.lineTo(6 + R, 90);
  g.quadraticCurveTo(6, 90, 6, 90 - R);
  g.lineTo(6, 6 + R);
  g.quadraticCurveTo(6, 6, 6 + R, 6);
  g.closePath();
  g.clip();
  // Shoulders: a rounded hump from the bottom; a head above. Greys, so the
  // per-person colour tints them.
  g.fillStyle = '#8c8c8c';
  g.beginPath();
  g.moveTo(4, 96);
  g.bezierCurveTo(6, 64, 18, 60, 32, 60);
  g.bezierCurveTo(46, 60, 58, 64, 60, 96);
  g.closePath();
  g.fill();
  g.fillStyle = '#e6e6e6';
  g.beginPath();
  g.ellipse(32, 40, 13, 16, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#5a5a5a';
  g.beginPath();
  g.ellipse(32, 31, 13.5, 9, 0, Math.PI, Math.PI * 2);
  g.fill();
  g.restore();
  silTex = new THREE.CanvasTexture(c);
  silTex.colorSpace = THREE.SRGBColorSpace;
  return silTex;
}

let silMat = null;
function silhouetteMaterial() {
  if (silMat) return silMat;
  silMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map: silhouetteTexture(),
    alphaTest: 0.5,
    // Over the pane, which is itself a decal on the skin (offset -2): further still.
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  silMat.name = 'Passenger_silhouette';
  return silMat;
}

const SIL_TINTS = [0x6b5a4e, 0x4e4a46, 0x705e50, 0x3f3a36, 0x5e544a, 0x7a6656, 0x4a4440];

const _m = new THREE.Matrix4();
const _t = new THREE.Matrix4().makeTranslation(0, -0.02, 0.006);
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _c = new THREE.Color();

/** The window meshes of a model: [{ mesh, count }]. */
export function windowMeshesOf(model) {
  const out = [];
  if (!model || typeof model.traverse !== 'function') return out;
  model.traverse((o) => {
    if (o.isInstancedMesh && o.name === 'Cabin window rows' && o.count > 0) out.push(o);
  });
  return out;
}

export class WindowFaces {
  constructor(scene, model, seed = 1) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'passengers:windows';
    this.list = [];
    this.total = 0;
    this.shown = -1;
    this.visible = true;
    const mat = silhouetteMaterial();
    const geo = new THREE.PlaneGeometry(1, 1);
    this.geo = geo;
    const rnd = seeded(seed * 31 + 7);
    for (const w of windowMeshesOf(model)) {
      const im = new THREE.InstancedMesh(geo, mat, w.count);
      im.name = 'passengers:window-faces';
      im.frustumCulled = false;
      im.castShadow = false;
      im.receiveShadow = false;
      im.matrixAutoUpdate = false;
      // Every window gets a place in the boarding order, and a person's tint.
      const order = [];
      for (let i = 0; i < w.count; i++) {
        order.push({ i, k: rnd() });
        im.setColorAt(i, _c.setHex(SIL_TINTS[Math.floor(rnd() * SIL_TINTS.length)]));
      }
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      // Copy the window mesh's place in the world just before drawing: it
      // moves with the aeroplane, and this is not parented to it (see above).
      im.onBeforeRender = () => {
        im.matrixWorld.copy(w.matrixWorld);
      };
      this.list.push({ win: w, im, order });
      this.total += w.count;
      this.root.add(im);
    }
    // Ranks across every piece, so "half full" is half of all the windows.
    const all = [];
    for (const L of this.list) for (const o of L.order) all.push(o);
    all.sort((a, b) => a.k - b.k);
    all.forEach((o, n) => {
      o.rank = n;
    });
    scene.add(this.root);
  }

  get count() {
    return this.total;
  }

  /**
   * Show `fraction` (0..1) of the windows occupied: the first so many in the
   * boarding order. Only rewrites the matrices when the number changes.
   */
  setFull(fraction) {
    const want = Math.round(Math.max(0, Math.min(1, fraction)) * this.total * 0.82);
    if (want === this.shown) return;
    this.shown = want;
    for (const L of this.list) {
      const w = L.win;
      for (const o of L.order) {
        if (o.rank < want) {
          w.getMatrixAt(o.i, _m);
          _m.multiply(_t);
          L.im.setMatrixAt(o.i, _m);
        } else L.im.setMatrixAt(o.i, _zero);
      }
      L.im.instanceMatrix.needsUpdate = true;
    }
  }

  /** Drawn or not (the LOD, a crash, the cabin view). */
  setVisible(on) {
    on = !!on && this.shown > 0;
    if (on === this.visible) return;
    this.visible = on;
    this.root.visible = on;
  }

  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);
    for (const L of this.list) L.im.dispose();
    this.geo.dispose();
    this.list.length = 0;
  }
}

/* ------------------------------------------------------------------ */
/* The cabin, from inside                                               */
/* ------------------------------------------------------------------ */

/**
 * The cabin's own light (its emissive) tinted by each instance's colour, as
 * the diffuse already is. Inside the fuselage the sun hardly reaches, so the
 * emissive is most of what you see — and three.js adds it untinted: every
 * seat, person and head came out the same grey. Patched into the shader.
 */
function tintedGlow(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\n#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )\n\ttotalEmissiveRadiance *= vColor.rgb;\n#endif'
    );
  };
  mat.customProgramCacheKey = () => 'passengers-tinted-glow';
  return mat;
}

let IM = null;
function interiorMaterials() {
  if (IM) return IM;
  const lit = (color, emissive, k = 0.42) => new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(emissive ?? color).multiplyScalar(k) });
  IM = {
    wall: lit(0xe9ecef, 0xe9ecef, 0.5),
    bin: lit(0xdfe3e7, 0xdfe3e7, 0.5),
    ceiling: lit(0xf4f6f8, 0xf4f6f8, 0.62),
    lights: new THREE.MeshBasicMaterial({ color: 0xfff6e0 }),
    carpet: lit(0x3c4a63, 0x3c4a63, 0.3),
    aisle: lit(0x6f7c93, 0x6f7c93, 0.3),
    bulkhead: lit(0xc8ced6, 0xc8ced6, 0.45),
    curtain: lit(0x24406e, 0x24406e, 0.35),
    seat: tintedGlow(lit(0xffffff, 0xffffff, 0.55)),
    body: tintedGlow(lit(0xffffff, 0xffffff, 0.6)),
    head: tintedGlow(lit(0xffffff, 0xffffff, 0.6)),
    // The people walking down the aisle: the apron walkers' shading (vertex colours), lit the same way.
    walker: tintedGlow(new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, emissive: new THREE.Color(0xffffff).multiplyScalar(0.6) })),
    frame: lit(0xbfc5cc, 0xbfc5cc, 0.4),
  };
  for (const m of Object.values(IM)) m.side = THREE.DoubleSide;
  return IM;
}

/** Quads into position/normal arrays. */
class Quads {
  constructor() {
    this.p = [];
    this.n = [];
  }

  /** a, b, c, d: [x, y, z] corners in order; n: [x, y, z] normal. */
  quad(a, b, c, d, n) {
    this.p.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let k = 0; k < 6; k++) this.n.push(...n);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.computeBoundingSphere();
    return g;
  }
}

function seatGeometry() {
  const parts = [
    new THREE.BoxGeometry(0.46, 0.12, 0.48).translate(0, 0.42, 0), // cushion
    new THREE.BoxGeometry(0.46, 0.72, 0.1).translate(0, 0.82, 0.24), // back
    new THREE.BoxGeometry(0.3, 0.16, 0.11).translate(0, 1.22, 0.25), // headrest
    new THREE.BoxGeometry(0.05, 0.08, 0.42).translate(-0.24, 0.62, 0), // armrests
    new THREE.BoxGeometry(0.05, 0.08, 0.42).translate(0.24, 0.62, 0),
    new THREE.BoxGeometry(0.06, 0.36, 0.06).translate(0, 0.18, 0), // leg
  ];
  const nonIdx = parts.map((g) => g.toNonIndexed());
  let n = 0;
  for (const g of nonIdx) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of nonIdx) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  for (const g of [...parts, ...nonIdx]) g.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

/** Seat x positions across the cabin for `cab`: [{ x, col }], window seats first and last. */
export function seatColumns(cab) {
  const n = cab.abreast;
  const aisleW = cab.wide ? 0.55 : 0.5;
  const nAisles = cab.aisles === 1 ? 1 : 2;
  // Half a metre a seat, or what fits between the walls with a hand's width spare each side.
  const seatW = Math.min(0.5, (cab.wallW * 2 - 0.3 - nAisles * aisleW) / n);
  // Blocks: 3-3 / 2-2 for one aisle; 3-4-3 (or the nearest) for two.
  let blocks;
  if (cab.aisles === 1) blocks = [Math.ceil(n / 2), Math.floor(n / 2)];
  else {
    const mid = Math.max(2, n - 2 * Math.floor((n - 2) / 3));
    const side = (n - mid) / 2;
    blocks = [Math.floor(side), mid, Math.ceil(side)];
  }
  const width = n * seatW + (blocks.length - 1) * aisleW;
  let x = -width / 2 + seatW / 2;
  const out = [];
  const aisles = [];
  let col = 0;
  blocks.forEach((b, bi) => {
    for (let k = 0; k < b; k++) {
      out.push({ x, col: col++ });
      x += seatW;
    }
    if (bi < blocks.length - 1) {
      aisles.push(x - seatW / 2 + aisleW / 2);
      x += aisleW;
    }
  });
  return { seats: out, aisles, width, seatW };
}

export class CabinInterior {
  /** `cab`: layout.js cabinFor(); `booked`: how many are flying; `seed` for who sits where. */
  constructor(cab, booked, seed = 1) {
    this.cab = cab;
    this.root = new THREE.Group();
    this.root.name = 'passengers:cabin';
    this.disposables = [];
    const M = interiorMaterials();
    const C = cab;
    const y0 = C.floorY;
    const y1 = C.ceilingY;
    const zf = C.front.z + 0.7; // front bulkhead
    const zr = C.rear.z + 0.2; // rear wall, behind the camera
    const W = C.wallW;
    const cols = seatColumns(C);
    this.columns = cols;
    // Where the floor is wide enough for the seats (the tube narrows below the floor line, not above it).
    const floorW = Math.min(W - 0.05, cols.width / 2 + 0.25);
    const add = (geo, mat, name) => {
      const m = new THREE.Mesh(geo, mat);
      m.name = name;
      m.castShadow = false;
      m.receiveShadow = false;
      m.frustumCulled = false;
      this.root.add(m);
      this.disposables.push(geo);
      return m;
    };

    // The floor, carpet, with the aisles lighter.
    const fl = new Quads();
    fl.quad([-floorW, y0, zf], [floorW, y0, zf], [floorW, y0, zr], [-floorW, y0, zr], [0, 1, 0]);
    add(fl.geometry(), M.carpet, 'cabin floor');
    const ai = new Quads();
    for (const ax of cols.aisles) ai.quad([ax - 0.22, y0 + 0.004, zf], [ax + 0.22, y0 + 0.004, zf], [ax + 0.22, y0 + 0.004, zr], [ax - 0.22, y0 + 0.004, zr], [0, 1, 0]);
    add(ai.geometry(), M.aisle, 'cabin aisle');

    // Sidewalls: from the floor's edge out and up to the bins, with a hole at every window.
    const binLow = y1 - 0.72;
    const wy0 = C.windowY - 0.19;
    const wy1 = C.windowY + 0.19;
    const ww = 0.13;
    const walls = new Quads();
    const frames = new Quads();
    for (const s of [-1, 1]) {
      const xw = s * W;
      const xf = s * floorW;
      const n = [-s, 0, 0];
      // The dado: floor edge up to the wall, a slope.
      walls.quad([xf, y0, zf], [xw, y0 + 0.55, zf], [xw, y0 + 0.55, zr], [xf, y0, zr], [-s * 0.6, 0.6, 0]);
      // Below and above the window band, the length of the cabin.
      walls.quad([xw, y0 + 0.55, zf], [xw, wy0, zf], [xw, wy0, zr], [xw, y0 + 0.55, zr], n);
      walls.quad([xw, wy1, zf], [xw, binLow, zf], [xw, binLow, zr], [xw, wy1, zr], n);
      // The band itself: wall between the windows, holes at them.
      let z = zf;
      const first = Math.ceil((zf + 0.4 - C.z0) / C.windowPitch);
      for (let k = first; ; k++) {
        const wz = C.z0 + k * C.windowPitch;
        if (wz + ww > zr - 0.3) break;
        if (wz - ww > z) walls.quad([xw, wy0, z], [xw, wy1, z], [xw, wy1, wz - ww], [xw, wy0, wz - ww], n);
        // A frame round the hole, a little proud of the wall (the window's surround).
        const xi = xw - s * 0.012;
        frames.quad([xi, wy0 - 0.03, wz - ww - 0.03], [xi, wy0, wz - ww - 0.03], [xi, wy0, wz + ww + 0.03], [xi, wy0 - 0.03, wz + ww + 0.03], n);
        frames.quad([xi, wy1, wz - ww - 0.03], [xi, wy1 + 0.03, wz - ww - 0.03], [xi, wy1 + 0.03, wz + ww + 0.03], [xi, wy1, wz + ww + 0.03], n);
        z = wz + ww;
      }
      if (z < zr) walls.quad([xw, wy0, z], [xw, wy1, z], [xw, wy1, zr], [xw, wy0, zr], n);
    }
    add(walls.geometry(), M.wall, 'cabin sidewalls');
    add(frames.geometry(), M.frame, 'cabin window surrounds');

    // Overhead bins: the wall's top, out over the window seats, both sides
    // (and over the middle block in a wide body).
    const bins = new Quads();
    const binIn = Math.max(0.35, W - 0.62);
    for (const s of [-1, 1]) {
      const xo = s * W;
      const xi = s * binIn;
      bins.quad([xi, binLow + 0.1, zf], [xo, binLow, zf], [xo, binLow, zr], [xi, binLow + 0.1, zr], [0, -1, 0]); // underside
      bins.quad([xi, binLow + 0.1, zf], [xi, y1 - 0.12, zf], [xi, y1 - 0.12, zr], [xi, binLow + 0.1, zr], [s, 0, 0]); // door face (towards the aisle)
      bins.quad([xi, y1 - 0.12, zf], [xo, y1, zf], [xo, y1, zr], [xi, y1 - 0.12, zr], [0, -1, 0]);
    }
    if (C.wide && cols.aisles.length === 2) {
      const a = cols.aisles[0] + 0.3;
      const b = cols.aisles[1] - 0.3;
      bins.quad([a, binLow + 0.1, zf], [b, binLow + 0.1, zf], [b, binLow + 0.1, zr], [a, binLow + 0.1, zr], [0, -1, 0]);
      bins.quad([a, binLow + 0.1, zf], [a, y1 - 0.18, zf], [a, y1 - 0.18, zr], [a, binLow + 0.1, zr], [-1, 0, 0]);
      bins.quad([b, binLow + 0.1, zf], [b, y1 - 0.18, zf], [b, y1 - 0.18, zr], [b, binLow + 0.1, zr], [1, 0, 0]);
    }
    add(bins.geometry(), M.bin, 'cabin overhead bins');

    // The ceiling between the bins, and its light strip.
    const ce = new Quads();
    ce.quad([-binIn, y1 - 0.12, zf], [-binIn, y1 - 0.12, zr], [binIn, y1 - 0.12, zr], [binIn, y1 - 0.12, zf], [0, -1, 0]);
    add(ce.geometry(), M.ceiling, 'cabin ceiling');
    const li = new Quads();
    for (const s of [-1, 1]) {
      const x = s * (binIn - 0.06);
      li.quad([x - 0.03, binLow + 0.12, zf], [x - 0.03, binLow + 0.12, zr], [x + 0.03, binLow + 0.12, zr], [x + 0.03, binLow + 0.12, zf], [0, -1, 0]);
    }
    add(li.geometry(), M.lights, 'cabin light strips');

    // The front bulkhead with its curtain, and the rear wall.
    const bh = new Quads();
    bh.quad([-W, y0, zf], [W, y0, zf], [W, y1, zf], [-W, y1, zf], [0, 0, 1]);
    bh.quad([-W, y0, zr], [-W, y1, zr], [W, y1, zr], [W, y0, zr], [0, 0, -1]);
    add(bh.geometry(), M.bulkhead, 'cabin bulkheads');
    const cu = new Quads();
    for (const ax of cols.aisles.length ? cols.aisles : [0]) cu.quad([ax - 0.36, y0, zf + 0.02], [ax + 0.36, y0, zf + 0.02], [ax + 0.36, y1 - 0.3, zf + 0.02], [ax - 0.36, y1 - 0.3, zf + 0.02], [0, 0, 1]);
    add(cu.geometry(), M.curtain, 'cabin curtain');

    // Seats, and who is in them.
    const rows = Math.max(1, Math.floor((zr - 0.9 - (zf + 0.6)) / C.pitch));
    this.rows = rows;
    const n = rows * cols.seats.length;
    const seatGeo = seatGeometry();
    const bodyGeo = seatedGeometry();
    const headGeo = headGeometry(1.2);
    this.disposables.push(seatGeo, bodyGeo, headGeo);
    const seats = new THREE.InstancedMesh(seatGeo, M.seat, n);
    seats.name = 'cabin seats';
    const rnd = seeded(seed * 17 + 3);
    const seatColour = C.wide ? 0x23406f : 0x1f3c66;
    const zOf = (r) => zf + 0.6 + C.pitch * (r + 0.5);
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (const s of cols.seats) {
        _m.makeScale(cols.seatW / 0.5, 1, 1).setPosition(s.x, y0, zOf(r));
        seats.setMatrixAt(i, _m);
        seats.setColorAt(i, _c.setHex(seatColour).multiplyScalar(0.9 + rnd() * 0.15));
        i++;
      }
    }
    for (const m of [seats]) {
      m.frustumCulled = false;
      m.castShadow = false;
      this.root.add(m);
    }
    this.seats = seats;
    const cabLike = { ...C, rows, abreast: cols.seats.length };
    const taken = seatOrder(cabLike, booked, seed);
    this.taken = taken;
    const bodies = new THREE.InstancedMesh(bodyGeo, M.body, Math.max(1, taken.length));
    const heads = new THREE.InstancedMesh(headGeo, M.head, Math.max(1, taken.length));
    bodies.name = 'cabin passengers';
    heads.name = 'cabin passenger heads';
    const CLOTHES = [0x2f4f8a, 0xb5402f, 0x3a7d44, 0x6b4f9a, 0xd9a03f, 0x445566, 0xc7c2b8, 0x8a3b5c, 0x2b8a8a, 0x5a5a5a];
    const SKIN = [0xf2d0b5, 0xe0b48f, 0xc68c5a, 0x9a6440, 0x6e4528, 0xf5dcc6];
    taken.forEach((seat, k) => {
      const r = Math.floor(seat / cols.seats.length);
      const s = cols.seats[seat % cols.seats.length];
      _m.makeRotationY((rnd() - 0.5) * 0.25);
      _m.setPosition(s.x + (rnd() - 0.5) * 0.04, y0, zOf(r) - 0.02);
      bodies.setMatrixAt(k, _m);
      heads.setMatrixAt(k, _m);
      bodies.setColorAt(k, _c.setHex(CLOTHES[Math.floor(rnd() * CLOTHES.length)]));
      heads.setColorAt(k, _c.setHex(SKIN[Math.floor(rnd() * SKIN.length)]));
    });
    bodies.count = heads.count = taken.length;
    for (const m of [bodies, heads]) {
      m.frustumCulled = false;
      m.castShadow = false;
      this.root.add(m);
    }
    this.bodies = bodies;
    this.heads = heads;
    this.aboard = taken.length;
    this.booked = booked;
    this.zOf = zOf;
    this.y0 = y0;
    this.zf = zf;
    // People in the aisle, boarding or getting off: made the first time anybody is.
    this.standing = null;
    this.standingHeads = null;
    // Where the camera stands: the back of the cabin, in the (first) aisle.
    this.eye = new THREE.Vector3(cols.aisles.length ? cols.aisles[0] : 0, y0 + 1.6, zr - 0.35);
    this.look = new THREE.Vector3(this.eye.x * 0.6, y0 + 1.15, zf);
  }

  /**
   * How many of the booked are in their seats (boarding, getting off,
   * jumping): the rest of the seats empty. `moving` 'in' (boarding) or 'out'
   * (getting off) also puts the next few in the aisle — walking back from the
   * front door to their row, or up the aisle to it — so the cabin fills seat
   * by seat in front of you.
   */
  setAboard(n, moving = null) {
    const f = (n / Math.max(1, this.booked)) * this.taken.length;
    const k = Math.max(0, Math.min(this.taken.length, moving === 'in' ? Math.floor(f) : moving === 'out' ? Math.ceil(f) : Math.round(f)));
    if (k !== this.bodies.count) this.bodies.count = this.heads.count = k;
    this.setAisle(f, k, moving);
  }

  setAisle(f, k, moving) {
    if (!moving) {
      if (this.standing && this.standing.count) this.standing.count = this.standingHeads.count = 0;
      return;
    }
    if (!this.standing) {
      const { GEO } = walkerParts();
      const MAT = interiorMaterials().walker;
      const mk = (geo, name) => {
        const im = new THREE.InstancedMesh(geo, MAT, AISLE_WALKERS);
        im.name = name;
        im.count = 0;
        im.frustumCulled = false;
        im.castShadow = false;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.root.add(im);
        return im;
      };
      this.standing = mk(GEO.body, 'cabin aisle walkers');
      this.standingHeads = mk(GEO.head, 'cabin aisle walker heads');
      const tint = [0x2f4f8a, 0xb5402f, 0x3a7d44, 0x6b4f9a, 0xd9a03f, 0x445566, 0xc7c2b8, 0x8a3b5c];
      const skin = [0xf2d0b5, 0xe0b48f, 0xc68c5a, 0x9a6440, 0x6e4528, 0xf5dcc6];
      for (let j = 0; j < AISLE_WALKERS; j++) {
        this.standing.setColorAt(j, _c.setHex(tint[(j * 5 + 3) % tint.length]));
        this.standingHeads.setColorAt(j, _c.setHex(skin[(j * 7 + 1) % skin.length]));
      }
    }
    const cols = this.columns;
    const ncol = cols.seats.length;
    const m = AISLE_WALKERS;
    const frac = moving === 'in' ? f - k : k - f;
    let c = 0;
    for (let j = 0; j < m; j++) {
      const idx = moving === 'in' ? k + j : k + j;
      if (idx < 0 || idx >= this.taken.length) continue;
      // Boarding, j = 0 is nearly at their row; getting off, j = 0 has just stood up.
      const p = moving === 'in' ? Math.max(0, Math.min(1, 1 - (j + 1 - frac) / m)) : Math.max(0, Math.min(1, (j + frac) / m));
      const seat = this.taken[idx];
      const r = Math.floor(seat / ncol);
      const sx = cols.seats[seat % ncol].x;
      let ax = 0;
      let best = Infinity;
      for (const a of cols.aisles.length ? cols.aisles : [0]) {
        if (Math.abs(a - sx) < best) {
          best = Math.abs(a - sx);
          ax = a;
        }
      }
      const zr = this.zOf(r);
      const z = moving === 'in' ? this.zf + 0.4 + p * (zr - this.zf - 0.4) : zr + p * (this.zf + 0.4 - zr);
      // Facing aft walking in (+z), forward walking out; a step's bob.
      const yaw = moving === 'in' ? Math.PI : 0;
      _w.set(ax + (j % 2 ? 0.05 : -0.05), this.y0 + 0.02 * Math.abs(Math.sin(z * 4.4)), z);
      _wq.setFromAxisAngle(_UP, yaw);
      const h = 0.95 + ((j * 37) % 10) * 0.01;
      _ws.set(Math.sin(z * 4.4) >= 0 ? h : -h, h, h);
      _m.compose(_w, _wq, _ws);
      this.standing.setMatrixAt(c, _m);
      this.standingHeads.setMatrixAt(c, _m);
      c++;
    }
    this.standing.count = this.standingHeads.count = c;
    this.standing.instanceMatrix.needsUpdate = true;
    this.standingHeads.instanceMatrix.needsUpdate = true;
    if (this.standing.instanceColor) this.standing.instanceColor.needsUpdate = true;
    if (this.standingHeads.instanceColor) this.standingHeads.instanceColor.needsUpdate = true;
  }

  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);
    for (const g of this.disposables) g.dispose();
    for (const m of [this.seats, this.bodies, this.heads, this.standing, this.standingHeads]) if (m) m.dispose();
  }
}
