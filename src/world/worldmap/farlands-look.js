/**
 * World Map: how the ring past the sea looks (the shape is worldmap/farlands.js).
 *
 *   RING_FRAG  the Farlands' paint, a block in the World Map's ground shader
 *              (worldmap/world-terrain.js): strata by height, four palettes
 *              through the depth of it, pale treads, dark under every lip so a
 *              stack reads as overhanging though a height field cannot.
 *   FarRim     the whole ring in one coarse mesh, one draw call, for what is
 *              past the streamed tiles: the range on the horizon from the
 *              sea, the next wall in the haze. Flat under the sea level, so not
 *              drawn, inside the streamed range: the two never fight.
 *   VoidSky    a dome over the sky: the Farlands' own dusk as you get there,
 *              and past the edge near-black. Static: it is a function of
 *              where the eye is and nothing else, so nothing in it can flash.
 *
 * All of it loads with the World Map only (features/farlands-run.js).
 */
import * as THREE from '../../vendor/three.module.js';
import { RENDER_ORIGIN } from '../../render/render-origin.js';
import { depthOf, height, wanderOf, SEA_HALF, CORNER, RANGE_DEEP, FAR_DEEP, EDGE_D, TEAR, WOBBLE, ZONE_START, ZONE_M } from './farlands.js';

const F1 = (v) => v.toFixed(1);
/** Nearer the middle than this on both axes, a point is not on the ring, corners included. */
const NEAR_RING = F1(SEA_HALF - CORNER * (1 - Math.SQRT1_2) - WOBBLE - 400);

/**
 * The Farlands' ground. `wp` is world metres, `base` the colour so far; vUrban
 * carries the zone (farlands.js coverOf), which on the ring is not a town.
 * Everything here costs one branch on the mainland and the range.
 */
export const RING_FRAG = /* glsl */ `
    if (max(abs(wp.x), abs(wp.y)) > ${NEAR_RING} || vUrban.x > 0.002) {
      vec2 rq = abs(wp) - vec2(${F1(SEA_HALF - CORNER)});
      float rd = length(max(rq, vec2(0.0))) + min(max(rq.x, rq.y), 0.0) - ${F1(CORNER)};
      if (rd > ${F1(-WOBBLE - 200)}) {
        float grain = dot(blended.rgb, vec3(0.333));
        // The range above the tree line is bare rock, up to the snow.
        float rockK = smoothstep(560.0, 1250.0, vGroundY + (wtNoise(wp / 640.0) * 0.6 + wtNoise(wp / 2100.0) * 0.4 - 0.5) * 760.0) * (1.0 - snowC);
        if (rockK > 0.0) {
          vec3 stone = mix(vec3(0.30, 0.285, 0.27), vec3(0.46, 0.43, 0.40), wtNoise(wp / 180.0) * 0.5 + wtNoise(wp / 900.0) * 0.5);
          base = mix(base, S2L(stone) * clamp(grain * 3.4, 0.55, 1.35), rockK);
        }
        float rD = ${F1(ZONE_START)} + vUrban.x * ${F1(ZONE_M)};
        float ru = (rD - ${F1(RANGE_DEEP)}) / ${F1(FAR_DEEP)};
        float rk = smoothstep(0.002, 0.03, vUrban.x);
        if (rk > 0.0) {
          // The strata: level at heart, bent by slow noise, in bands of two widths. The wide ones are the wider the deeper.
          float sy = vGroundY + (wtNoise(wp / 5200.0) - 0.5) * 280.0 + (wtNoise(wp / 1300.0) - 0.5) * 50.0;
          float wide = 388.0 + 150.0 * clamp(ru, 0.0, 1.0);
          float thin = wtH21(vec2(floor(sy / 92.0) * 0.37, 11.0));
          float thick = wtH21(vec2(floor(sy / wide) * 0.61, 5.0));
          // Fine bands fade before they are thinner than a pixel; the thick ones stay.
          float fineK = 1.0 - smoothstep(9000.0, 30000.0, dist);
          // Four palettes, in depth: dark, strong, pale, tread.
          float z1 = smoothstep(0.2, 0.38, ru);
          float z2 = smoothstep(0.54, 0.7, ru);
          float z3 = smoothstep(0.82, 0.97, ru);
          vec3 pD = mix(mix(mix(vec3(0.27, 0.15, 0.11), vec3(0.21, 0.13, 0.20), z1), vec3(0.09, 0.14, 0.20), z2), vec3(0.14, 0.13, 0.16), z3);
          vec3 pS = mix(mix(mix(vec3(0.66, 0.33, 0.17), vec3(0.55, 0.26, 0.20), z1), vec3(0.20, 0.42, 0.41), z2), vec3(0.42, 0.40, 0.40), z3);
          vec3 pP = mix(mix(mix(vec3(0.82, 0.62, 0.40), vec3(0.70, 0.56, 0.47), z1), vec3(0.72, 0.72, 0.64), z2), vec3(0.82, 0.79, 0.74), z3);
          vec3 pT = mix(mix(mix(vec3(0.60, 0.44, 0.30), vec3(0.34, 0.25, 0.29), z1), vec3(0.27, 0.33, 0.36), z2), vec3(0.56, 0.54, 0.52), z3);
          vec3 band = thick < 0.42 ? pS : thick < 0.8 ? pD : pP;
          band = mix(band, mix(pS, pP, thin), fineK * 0.5);
          // Dark under each lip: the top of every wide band, so a shelf hangs over what is under it.
          float lip = 1.0 - smoothstep(0.0, 0.16, 1.0 - fract(sy / wide));
          band *= 1.0 - lip * 0.6;
          // How steep this very pixel is, not its corners: a wall spanning a coarse tile's cell, a skirt, is a wall all the way up.
          float steep = smoothstep(0.3, 0.95, fwidth(vGroundY) / (fwidth(wp.x) + fwidth(wp.y) + 0.001));
          // Water has run down the walls, close up: the columns the plan view's noise makes on a vertical face.
          band *= 1.0 + (wtNoise(wp / 74.0) * 0.6 + wtNoise(wp / 23.0) * 0.4 - 0.5) * 0.5 * (1.0 - smoothstep(2500.0, 9000.0, dist));
          // The treads weather in plates: flat ground out here is stepped too, in tone.
          float plate = floor((wtNoise(wp / 900.0) * 0.7 + wtNoise(wp / 260.0) * 0.3) * 7.0) / 7.0;
          vec3 rc = mix(pT * (0.66 + 0.68 * plate), band, steep);
          // The bottom of a canyon is in its own shade.
          rc *= mix(0.6, 1.0, smoothstep(1200.0, 2500.0, vGroundY));
          rc *= (0.86 + 0.28 * wtNoise(wp / 310.0)) * mix(0.9, 1.1, clamp(grain * 2.4, 0.0, 1.0));
          base = mix(base, S2L(rc), rk);
          // What hangs under the edge is torn too, not sliced off at the level of a sea that is not there.
          if (vGroundY < 180.0 + 420.0 * wtNoise(wp / 860.0)) discard;
        }
      }
    }
`;

/**
 * The range's snow line, over the sea's rule (1,300 m anywhere, far lower in the north): the range would
 * otherwise be one white dune from the shore up. `trop` and `cold` are the shader's own.
 */
const RING_SNOW = /* glsl */ `
    if (max(abs(wp.x), abs(wp.y)) > ${NEAR_RING}) sline += mix(1750.0, 2350.0, trop) - cold * 300.0 + (wtNoise(wp / 310.0) - 0.5) * 260.0;
`;

export const RING_LOOK = Object.freeze({ frag: RING_FRAG, snow: RING_SNOW });

/* ------------------------------------------------------------------ */
/* The coarse ring                                                     */
/* ------------------------------------------------------------------ */

/** The Farlands' air in full day: the low colour of the dusk, so land and sky meet without a seam. */
const HAZE = new THREE.Color(0.42, 0.25, 0.20);
const rgb = (hex) => new THREE.Color(hex).convertSRGBToLinear();
const COL = {
  grass: rgb(0x55704a), rock: rgb(0x6f6b66), snow: rgb(0xe6eaf0),
  stair: rgb(0xa35d36), rib: rgb(0x70404f), stack: rgb(0x3c5c5e), fray: rgb(0x8a8784), tread: rgb(0x8a6a4e),
};

/** Base-line points and outward normals round the box: a position is base + normal * (CORNER + D). */
function ringColumns(sideCols, arcCols) {
  const I = SEA_HALF - CORNER;
  const out = [];
  // Clockwise seen from above, from the north-east corner's end, a side and a corner at a time.
  const sides = [[I, -I, 0, 1, 1, 0], [I, I, -1, 0, 0, 1], [-I, I, 0, -1, -1, 0], [-I, -I, 1, 0, 0, -1]];
  for (const [bx, bz, tx, tz, nx, nz] of sides) {
    for (let i = 0; i < sideCols; i++) {
      const k = (i / sideCols) * 2 * I;
      out.push({ bx: bx + tx * k, bz: bz + tz * k, nx, nz });
    }
    const cx = bx + tx * 2 * I;
    const cz = bz + tz * 2 * I;
    for (let i = 0; i < arcCols; i++) {
      const a = (i / arcCols) * Math.PI * 0.5;
      out.push({ bx: cx, bz: cz, nx: nx * Math.cos(a) + tx * Math.sin(a), nz: nz * Math.cos(a) + tz * Math.sin(a) });
    }
  }
  return out;
}

/*
 * Two grids, one mesh: the range fine round the ring and across it (it is
 * what the sea sees, 30 to 100 km off in clear air), the Farlands coarse round
 * the ring and fine across it (they are bands, and always behind their haze).
 */
const GRIDS = [
  { sideCols: 118, arcCols: 26, from: -WOBBLE - 200, to: RANGE_DEEP + 1500, rows: 30 },
  { sideCols: 44, arcCols: 26, from: RANGE_DEEP - 1500, to: EDGE_D + TEAR + WOBBLE + 800, rows: 84 },
];

/** A height for the coarse mesh: what a far look sees of a cell, not whatever one point happens to hit. */
function heightFor(x, z, spread) {
  const a = height(x, z);
  if (a < -99) return a;
  const b = height(x + spread, z + spread * 0.6);
  const c = height(x - spread * 0.6, z + spread);
  const d = height(x - spread, z - spread * 0.6);
  const e = height(x + spread * 0.6, z - spread);
  return Math.max(a, 0.5 * Math.max(a, b, c, d, e) + 0.1 * (a + b + c + d + e));
}

function shadeInto(c, h, slope, D, z) {
  if (D < RANGE_DEEP - 2000) {
    const cold = z < -50000 ? 1 : z < -40000 ? (-40000 - z) / 10000 : 0;
    const trop = z > 27000 ? 1 : z > 21000 ? (z - 21000) / 6000 : 0;
    const line = 2900 + 600 * trop - cold * 1500;
    c.copy(COL.grass).lerp(COL.rock, Math.min(1, Math.max(0, (h - 300) / 800)));
    if (h > line) c.lerp(COL.snow, Math.min(1, (h - line) / 400));
    return c;
  }
  const u = (D - RANGE_DEEP) / FAR_DEEP;
  if (u < 0.3) c.copy(COL.stair);
  else if (u < 0.62) c.copy(COL.stair).lerp(COL.rib, Math.min(1, (u - 0.3) / 0.12));
  else if (u < 0.86) c.copy(COL.rib).lerp(COL.stack, Math.min(1, (u - 0.62) / 0.1));
  else c.copy(COL.stack).lerp(COL.fray, Math.min(1, (u - 0.86) / 0.1));
  // The band the shader paints, in its thickest: enough that a wall reads as striped at thirty kilometres.
  const b = Math.floor(h / 388);
  c.multiplyScalar(b % 3 === 0 ? 0.72 : b % 3 === 1 ? 1 : 1.25);
  return c.lerp(COL.tread, slope < 0.25 ? 0.35 : 0);
}

/** One grid's vertices are `nC * rows`; `base` is where they start in the mesh. */
function makeGrid(g, base) {
  const cols = ringColumns(g.sideCols, g.arcCols);
  const nC = cols.length;
  const D = new Float32Array(g.rows);
  for (let r = 0; r < g.rows; r++) D[r] = g.from + ((g.to - g.from) * r) / (g.rows - 1);
  return { cols, nC, rows: g.rows, D, base, H: new Float32Array(nC * g.rows), col: 0, spread: (2 * (SEA_HALF - CORNER)) / g.sideCols * 0.3 };
}

export class FarRim {
  /**
   * @param {object} o
   * @param {number} o.hideWithin  the streamed range: inside it this mesh is not drawn
   * @param {number} [o.detail]    columns and rows, as a share of GRIDS (Low: 0.6, about 15,000 vertices)
   */
  constructor({ hideWithin, detail = 1 }) {
    let n = 0;
    let tris = 0;
    this.grids = GRIDS.map((g) => {
      const G = makeGrid({ ...g, sideCols: Math.round(g.sideCols * detail), arcCols: Math.round(g.arcCols * detail), rows: Math.round(g.rows * detail) }, n);
      n += G.nC * G.rows;
      tris += G.nC * (G.rows - 1) * 2;
      return G;
    });
    this.pos = new Float32Array(n * 3);
    this.nrm = new Float32Array(n * 3);
    this.rgb = new Float32Array(n * 3);
    const idx = new Uint16Array(tris * 3);
    let k = 0;
    for (const G of this.grids) {
      for (let c = 0; c < G.nC; c++) {
        const c1 = (c + 1) % G.nC;
        for (let r = 0; r < G.rows - 1; r++) {
          const a = G.base + c * G.rows + r;
          const b = a + 1;
          const d = G.base + c1 * G.rows + r;
          const e = d + 1;
          idx[k++] = a; idx[k++] = d; idx[k++] = b;
          idx[k++] = d; idx[k++] = e; idx[k++] = b;
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.rgb, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.geometry = g;
    this.uCam = { value: new THREE.Vector2(0, 0) };
    this.uHide = { value: hideWithin };
    this.uAir = { value: new THREE.Color() };
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uFrCam = this.uCam;
      shader.uniforms.uFrHide = this.uHide;
      shader.uniforms.uFrAir = this.uAir;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec2 uFrCam;\nuniform float uFrHide;\nvarying float vFrY;\nvarying float vFrHaze;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          // Nothing inside the streamed range, up a long ramp past it so no step shows.
          transformed.y = mix(-100.0, position.y, smoothstep(uFrHide, uFrHide + 24000.0, length(position.xz - uFrCam)));
          vFrY = transformed.y;
          // The Farlands stand in their own air, seen from anywhere: a haze of their colour, on top of the fog.
          vec2 frQ = abs(position.xz) - vec2(${F1(SEA_HALF - CORNER)});
          float frD = length(max(frQ, vec2(0.0))) + min(max(frQ.x, frQ.y), 0.0) - ${F1(CORNER)};
          float frRun = length(position.xz - uFrCam) / 34000.0;
          vFrHaze = smoothstep(${F1(RANGE_DEEP - 2000)}, ${F1(RANGE_DEEP + 2000)}, frD) * (1.0 - exp(-frRun * frRun));`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFrY;\nvarying float vFrHaze;\nuniform vec3 uFrAir;')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n  if (vFrY < 0.0) discard;')
        .replace('#include <opaque_fragment>', 'outgoingLight = mix(outgoingLight, uFrAir, vFrHaze);\n#include <opaque_fragment>');
    };
    mat.customProgramCacheKey = () => 'wp-far-rim';
    this.material = mat;
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'world-far-rim';
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    this.mesh = mesh;
    this.done = false;
    this.todo = this.grids.slice();
    this._c = new THREE.Color();
  }

  /** Sample until `budgetMs` is used, a column at a time; the column that finishes a grid also lays it out. */
  build(budgetMs = 1.2, now = () => performance.now()) {
    if (this.done) return true;
    const t0 = now();
    while (this.todo.length && now() - t0 < budgetMs) {
      const G = this.todo[0];
      const c = G.cols[G.col];
      for (let r = 0; r < G.rows; r++) {
        const o = CORNER + G.D[r];
        G.H[G.col * G.rows + r] = heightFor(c.bx + c.nx * o, c.bz + c.nz * o, G.spread);
      }
      if (++G.col === G.nC) {
        this.layOut(G);
        this.todo.shift();
      }
    }
    if (this.todo.length) return false;
    const g = this.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    this.grids = null;
    this.done = true;
    this.mesh.visible = true;
    return true;
  }

  layOut(G) {
    const { cols, H, nC, rows, D: Ds, base } = G;
    const { pos, nrm, rgb: col } = this;
    for (let c = 0; c < nC; c++) {
      const C = cols[c];
      const ce = (c + 1) % nC;
      const cw = (c + nC - 1) % nC;
      // Past the land, every row collapses onto the rim, so nothing is drawn out in the void.
      let last = rows - 1;
      while (last > 0 && H[c * rows + last] < -99) last--;
      for (let r = 0; r < rows; r++) {
        const v = (base + c * rows + r) * 3;
        const o = CORNER + Ds[Math.min(r, Math.min(rows - 1, last + 1))];
        const x = C.bx + C.nx * o;
        const z = C.bz + C.nz * o;
        const h = r > last ? -40 : H[c * rows + r];
        pos[v] = x;
        pos[v + 1] = h;
        pos[v + 2] = z;
        const rn = Math.max(0, r - 1);
        const rf = Math.min(last, r + 1);
        const dh = (H[c * rows + rf] - H[c * rows + rn]) / Math.max(1, Ds[rf] - Ds[rn]);
        const he = H[ce * rows + r];
        const hw = H[cw * rows + r];
        const span = Math.hypot(cols[ce].bx + cols[ce].nx * o - cols[cw].bx - cols[cw].nx * o, cols[ce].bz + cols[ce].nz * o - cols[cw].bz - cols[cw].nz * o) || 1;
        const ds = he < -99 || hw < -99 ? 0 : (he - hw) / span;
        // Along the ring is the normal turned a quarter clockwise, seen from above.
        const gx = C.nx * dh - C.nz * ds;
        const gz = C.nz * dh + C.nx * ds;
        const inv = 1 / Math.hypot(gx, 1, gz);
        nrm[v] = -gx * inv;
        nrm[v + 1] = inv;
        nrm[v + 2] = -gz * inv;
        shadeInto(this._c, h, Math.hypot(gx, gz), wanderOf(x, z), z);
        col[v] = this._c.r;
        col[v + 1] = this._c.g;
        col[v + 2] = this._c.b;
      }
    }
    G.H = null;
  }

  update(cam, budgetMs, day = 1) {
    this.uCam.value.set(cam.x, cam.z);
    this.uAir.value.copy(HAZE).multiplyScalar(0.08 + 0.92 * day);
    // The sky's light on what the sun is not on: the real ground has it from its environment map.
    this.material.emissive.setRGB(0.05, 0.055, 0.065).multiplyScalar(day);
    if (!this.done) this.build(budgetMs);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* The sky out there                                                   */
/* ------------------------------------------------------------------ */

/** The box a horizontal ray has to leave to reach the Farlands, and the edge. */
const FAR_BOX = F1(SEA_HALF + RANGE_DEEP);
const EDGE_BOX = F1(SEA_HALF + EDGE_D);

const VOID_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position * 10.0, 1.0);
    gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
  }
`;

const VOID_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vDir;
  uniform vec2 uOrigin;
  uniform float uDay;
  uniform float uFarK;
  uniform float uVoidK;

  /** How far a ray from p along d runs before it leaves the square of half width b (0 if it starts outside it). */
  float leave(vec2 p, vec2 d, float b) {
    vec2 s = vec2(d.x < 0.0 ? -1.0 : 1.0, d.y < 0.0 ? -1.0 : 1.0);
    vec2 t = (vec2(b) - s * p) / max(abs(d), vec2(1e-3));
    return max(0.0, min(t.x, t.y));
  }

  void main() {
    vec3 dir = normalize(vDir);
    vec2 p = cameraPosition.xz + uOrigin;
    vec2 flat2 = normalize(dir.xz + vec2(1e-5, 0.0));
    float up = abs(dir.y);
    // The Farlands' dusk: seen ahead from the range, all round once you are in it.
    float far = max(uFarK, (1.0 - smoothstep(4000.0, 64000.0, leave(p, flat2, ${FAR_BOX}))) * pow(1.0 - up, 3.0));
    // A sky that has been given up on: ahead as you near the edge, then everywhere.
    float gone = max(uVoidK, (1.0 - smoothstep(4000.0, 62000.0, leave(p, flat2, ${EDGE_BOX}))) * (1.0 - up * 0.55));
    float h = clamp(dir.y, 0.0, 1.0);
    vec3 duskLow = mix(vec3(0.42, 0.25, 0.20), vec3(0.20, 0.13, 0.17), smoothstep(0.0, 0.6, gone));
    vec3 duskHigh = vec3(0.075, 0.075, 0.17);
    vec3 dusk = mix(duskLow, duskHigh, pow(h, 0.5)) * mix(0.08, 1.0, uDay);
    vec3 night = vec3(0.0035, 0.0038, 0.0065) * (1.0 + 0.6 * h);
    vec3 col = mix(dusk, night, gone * gone * (3.0 - 2.0 * gone));
    gl_FragColor = vec4(col, max(far * 0.88, gone));
    #include <colorspace_fragment>
  }
`;

const SCRATCH = new THREE.Color();
const NIGHT_HAZE = new THREE.Color(0.0035, 0.0038, 0.0065);

export class VoidSky {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene     whose fog follows
   * @param {Function} o.day          today's daylight, 0..1
   * @param {number} o.haze           FogExp2 density in the Farlands: the tier's range is lost in it
   */
  constructor({ scene, day, haze }) {
    this.scene = scene;
    this.day = day;
    this.haze = haze;
    this.u = { uOrigin: RENDER_ORIGIN, uDay: { value: 1 }, uFarK: { value: 0 }, uVoidK: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: VOID_VERT,
      fragmentShader: VOID_FRAG,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      // In the opaque list, straight after the sky (renderOrder), but blended: see render/depth-layers.js.
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
    mesh.name = 'world-void-sky';
    mesh.frustumCulled = false;
    mesh.renderOrder = -999;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    // Here and not in the feature's update: every draw, paused or not, sees the fog that goes with the eye.
    mesh.onBeforeRender = (renderer, sc, camera) => this.apply(camera);
    this.mesh = mesh;
    this.fogIn = new THREE.Color();
    this.fogOut = new THREE.Color(-1, -1, -1);
    this.densIn = 0;
    this.densOut = -1;
    this.farK = 0;
    this.voidK = 0;
  }

  /** Every frame: how far in the eye is. */
  update(cam) {
    const d = wanderOf(cam.x, cam.z);
    this.farK = smoothOut(RANGE_DEEP - 6000, RANGE_DEEP + 9000, d);
    this.voidK = smoothOut(EDGE_D - 34000, EDGE_D + 3000, d);
    // From the sea the dusk is on the far side of the range; the dome is up only where it can be seen (VOID_FRAG's 64 km).
    this.mesh.visible = depthOf(cam.x, cam.z) > -26000;
  }

  apply() {
    const fog = this.scene.fog;
    const u = this.u;
    const day = Math.min(1, Math.max(0, this.day()));
    u.uDay.value = day;
    u.uFarK.value = this.farK;
    u.uVoidK.value = this.voidK;
    if (!fog || this.farK <= 0) return;
    // The fog as the sky left it this frame. A draw with no update since (paused) finds our own and keeps the sky's.
    if (!(fog.color.equals(this.fogOut) && fog.density === this.densOut)) {
      this.fogIn.copy(fog.color);
      this.densIn = fog.density;
    }
    SCRATCH.copy(HAZE).multiplyScalar(0.08 + 0.92 * day).lerp(NIGHT_HAZE, this.voidK);
    fog.color.copy(this.fogIn).lerp(SCRATCH, this.farK);
    fog.density = this.densIn + (Math.max(this.densIn, this.haze) - this.densIn) * this.farK;
    this.fogOut.copy(fog.color);
    this.densOut = fog.density;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

function smoothOut(a, b, x) {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
}
