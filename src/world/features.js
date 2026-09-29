/**
 * Map features — the things that make each map the place its description says
 * it is.
 *
 * The five maps used to differ only in the shape of the ground and the colour
 * of the grass, so "volcanic" was a mountain, "coral atoll" was a sandy lump
 * and "Aurora Fjords" had no aurora. Everything here is per-map set dressing
 * driven by `features` in maps.js:
 *
 *   volcano     a lava lake in the crater, flows down the flanks, an ash
 *               column leaning downwind and embers after dark
 *   reef        the turquoise shallows that ring a tropical island, traced
 *               along the real coastline rather than drawn as a circle
 *   fields      farmland patchwork, so "grassland" reads as grassland
 *   waterfalls  meltwater off the fjord walls into the sea
 *   aurora      the northern lights, at night
 *   bridge      a suspension bridge across a strait, high enough to fly
 *               under (Gateway International)
 *   birds       a flock of gulls wheeling over a cliff (Condor Rock)
 *
 * (The fjord snow line is not here — it is two lines in the terrain shader,
 * because snow is a property of the ground rather than an object on it.)
 *
 * Everything is procedural and everything is disposed by the caller through
 * `group`, in one piece, the same as the rest of the world.
 */

import * as THREE from '../vendor/three.module.js';
import { heightAt, MAP, ISLANDS, addObstacleAt, padWeight, flatAt } from './terrain.js';
import { fbm, makeRandom, clamp, smoothstep, lerp } from '../core/noise.js';

/** Scratch transform for the birds' per-frame matrices, so the loop allocates nothing. */
const _bird = new THREE.Object3D();

/**
 * An sRGB colour (as written, as in CSS) to the linear value a vertex colour
 * holds. Vertex colours are the one colour path three.js does not convert,
 * and writing sRGB straight in pales every mid-tone — see linearRGB in
 * scenery.js for what that did to the trees and to Meadow's farmland.
 */
const _lin = new THREE.Color();
function linear(c) {
  _lin.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
  return [_lin.r, _lin.g, _lin.b];
}

/* ------------------------------------------------------------------ */
/* Textures                                                            */
/* ------------------------------------------------------------------ */

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d') };
}

function asTexture(c, { wrapS = THREE.RepeatWrapping, wrapT = THREE.ClampToEdgeWrapping } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = wrapS;
  t.wrapT = wrapT;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Molten rock: a dark basalt crust with a glowing crack network through it.
 *
 * Ridged noise (1 - |2n - 1|) is what makes the cracks: it peaks along the
 * zero crossings of the underlying noise field, which is exactly the branching
 * web that cooling lava breaks into.
 */
function lavaTexture(seed = 7) {
  const S = 256;
  const { c, g } = canvas(S);
  const img = g.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = fbm(x / 26, y / 26, { octaves: 4, gain: 0.55, seed });
      const ridge = 1 - Math.abs(n * 2 - 1);
      // Sharpen the ridges into cracks, and let a slower field open some of
      // them into wider pools.
      const pool = smoothstep(0.52, 0.78, fbm(x / 70, y / 70, { octaves: 2, seed: seed * 3 }));
      const heat = clamp(Math.pow(ridge, 5) * 1.5 + pool * 0.55, 0, 1);
      const crust = 22 + fbm(x / 9, y / 9, { octaves: 3, seed: seed * 5 }) * 26;
      const i = (y * S + x) * 4;
      // Black crust → deep red → orange → white-hot in the middle of a crack.
      d[i] = crust + heat * 255;
      d[i + 1] = crust * 0.55 + Math.pow(heat, 1.5) * 210;
      d[i + 2] = crust * 0.5 + Math.pow(heat, 4) * 190;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return asTexture(c, { wrapT: THREE.RepeatWrapping });
}

/**
 * A lava flow, mapped along its length: white-hot where it leaves the crater,
 * cooling to black crust at the toe. Baking the cooling into the texture is
 * what lets one material draw a flow that glows at the top and not the bottom.
 */
function lavaFlowTexture(seed = 11) {
  const W = 256;
  const H = 64;
  const { c, g } = canvas(W, H);
  const img = g.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W; // 0 at the vent, 1 at the toe
      const v = y / H; // across the flow
      const n = fbm(x / 20, y / 12, { octaves: 3, seed });
      const ridge = 1 - Math.abs(n * 2 - 1);
      // Cools along its length, and the edges chill before the middle does.
      const cool = Math.pow(1 - u, 1.7) * (1 - Math.pow(Math.abs(v * 2 - 1), 2.2) * 0.85);
      const heat = clamp(Math.pow(ridge, 3.5) * 1.3 * cool + cool * 0.35, 0, 1);
      const crust = 16 + n * 26;
      const i = (y * W + x) * 4;
      d[i] = crust + heat * 255;
      d[i + 1] = crust * 0.5 + Math.pow(heat, 1.6) * 200;
      d[i + 2] = crust * 0.45 + Math.pow(heat, 4.5) * 170;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return asTexture(c);
}

/** A soft round puff, for ash and smoke. */
function smokeSprite() {
  const S = 96;
  const { c, g } = canvas(S);
  const img = g.createImageData(S, S);
  const d = img.data;
  const mid = S / 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const r = Math.hypot(x - mid, y - mid) / mid;
      // Break the circle up so a cluster of these does not read as bubbles.
      const lump = fbm(x / 16, y / 16, { octaves: 3, seed: 21 });
      const a = clamp((1 - r) * 1.25 - 0.35 + lump * 0.5, 0, 1);
      const i = (y * S + x) * 4;
      const shade = 190 + lump * 60;
      d[i] = shade;
      d[i + 1] = shade;
      d[i + 2] = shade;
      d[i + 3] = Math.pow(a, 1.6) * 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A plain radial glow, for embers and the aurora's soft edge. */
function glowSprite() {
  const S = 64;
  const { c, g } = canvas(S);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,215,150,0.75)');
  grd.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Reef: mottled coral in bright shallow water. `u` runs around the island and
 * `v` from the beach out to open water, so the alpha ramp down `v` is what
 * makes the reef fade into the sea instead of ending at a hard line.
 */
function reefTexture() {
  const W = 256;
  const H = 128;
  const { c, g } = canvas(W, H);
  const img = g.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = y / (H - 1);
      // Tileable around the island: blend the two ends of the noise field.
      const n1 = fbm(x / 26, y / 20, { octaves: 4, seed: 31 });
      const n2 = fbm((x - W) / 26, y / 20, { octaves: 4, seed: 31 });
      const n = lerp(n1, n2, smoothstep(0.72, 1, x / W));
      // Coral heads near the beach, sand channels further out.
      const coral = smoothstep(0.42, 0.72, n) * (1 - smoothstep(0.35, 0.95, v));
      const a = (1 - smoothstep(0.0, 1.0, v)) * (0.55 + coral * 0.75) * (0.75 + n * 0.5);
      const i = (y * W + x) * 4;
      d[i] = 170 + coral * 70;
      d[i + 1] = 240 - coral * 30;
      d[i + 2] = 225 - coral * 60;
      d[i + 3] = clamp(a, 0, 1) * 255;
    }
  }
  g.putImageData(img, 0, 0);
  return asTexture(c);
}

/**
 * Drill rows: soft light and dark stripes, a multiplier on a field's own
 * colour. Only its u coordinate is read, so one tiny canvas does every field.
 */
function furrowTexture() {
  const { c, g } = canvas(32, 4);
  for (let x = 0; x < 32; x++) {
    const k = 0.5 + 0.5 * Math.cos((x / 32) * Math.PI * 2);
    const v = Math.round(255 * (0.86 + 0.14 * k));
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(x, 0, 1, 4);
  }
  return asTexture(c);
}

/** Falling water: vertical streaks that scroll downwards. */
function waterfallTexture() {
  const W = 64;
  const H = 128;
  const { c, g } = canvas(W, H);
  const img = g.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Stretched noise: long vertically, fine horizontally = falling water.
      const n = fbm(x / 3.2, y / 26, { octaves: 3, seed: 41 });
      const edge = 1 - Math.pow(Math.abs((x / (W - 1)) * 2 - 1), 2.4);
      const a = clamp(n * 1.5 - 0.35, 0, 1) * edge;
      const i = (y * W + x) * 4;
      d[i] = 240;
      d[i + 1] = 248;
      d[i + 2] = 255;
      d[i + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  return asTexture(c, { wrapT: THREE.RepeatWrapping });
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Where the island actually meets the sea, bearing by bearing.
 *
 * The coastlines are wobbled by noise, so a circle drawn at `isl.radius` sits
 * out in open water on one side and up the beach on the other. Marching in
 * until the ground breaks the surface and then bisecting finds the real thing,
 * and costs a few thousand height samples once at build time.
 */
function coastline(isl, bearings = 96) {
  const out = [];
  const step = isl.radius * 0.02;
  for (let b = 0; b < bearings; b++) {
    const a = (b / bearings) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    let r = isl.radius * 1.5;
    const min = isl.radius * 0.15;
    while (r > min && heightAt(isl.cx + ca * r, isl.cz + sa * r) < 0) r -= step;
    let lo = r;
    let hi = r + step;
    for (let i = 0; i < 7; i++) {
      const mid = (lo + hi) / 2;
      if (heightAt(isl.cx + ca * mid, isl.cz + sa * mid) > 0) lo = mid;
      else hi = mid;
    }
    out.push((lo + hi) / 2);
  }
  return out;
}

/** A closed band between two radii-per-bearing arrays, lying flat at `y`. */
function bandGeometry(cx, cz, inner, outer, y, uRepeat = 12) {
  const n = inner.length;
  const pos = [];
  const uv = [];
  const idx = [];
  for (let b = 0; b <= n; b++) {
    const i = b % n;
    const a = (b / n) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    pos.push(cx + ca * inner[i], y, cz + sa * inner[i]);
    uv.push((b / n) * uRepeat, 0);
    pos.push(cx + ca * outer[i], y, cz + sa * outer[i]);
    uv.push((b / n) * uRepeat, 1);
  }
  for (let b = 0; b < n; b++) {
    const a = b * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/* ------------------------------------------------------------------ */

const _wind = new THREE.Vector3();

export class MapFeatures {
  constructor(scene, quality = 'high') {
    this.group = new THREE.Group();
    this.group.name = 'features';
    this.t = 0;
    this.quality = quality;

    /** Animated bits, collected so `update` does not have to walk the tree. */
    this.lavaMaps = [];
    this.plumes = [];
    this.craterLights = [];
    this.auroraMats = [];
    this.fallMaps = [];
    this.reefMats = [];
    /** Night lamps on anything built here (the bridge), one material each. */
    this.lampMats = [];
    /** Flocks: { mesh, state Float32Array, n } — see buildBirds. */
    this.flocks = [];
    /** What the bridge builder measured, for the tests and the console. */
    this.bridge = null;

    const f = MAP.features || {};
    const density = quality === 'low' ? 0.35 : quality === 'medium' ? 0.7 : quality === 'ultra' ? 1.7 : 1;

    if (f.reef) this.buildReef(f.reef);
    if (f.fields) this.buildFields(f.fields, density);
    if (f.waterfalls) this.buildWaterfalls(f.waterfalls);
    if (f.aurora) this.buildAurora(f.aurora);
    for (const v of f.volcano || []) this.buildVolcano(v, density);
    if (f.bridge) this.bridge = this.buildBridge(f.bridge);
    for (const b of [].concat(f.birds || [])) this.buildBirds(b, density);

    scene.add(this.group);
  }

  /* ------------------------------------------------------------ bridge -- */

  /**
   * A suspension bridge across a strait, running north-south along x = cfg.x
   * from cfg.from to cfg.to (both on land).
   *
   * The builder measures the water itself rather than being told: it walks
   * the line, finds where the sea starts and stops, stands a tower a little
   * way into the water off each shore, and hangs the cables between them. So
   * the island can be retuned and the bridge still lands on both sides.
   *
   * Axis-aligned on purpose, for the same reason the carrier points north:
   * the obstacle boxes are axis-aligned, so a bridge along an axis is solid
   * exactly where it is drawn. What is solid: the deck and its ramps, the
   * tower legs and their portal beams. What is not: the cables and hangers,
   * so a child who threads the gap between deck and cable is not killed by
   * a wire they could barely see. The gap UNDER the deck is the point — the
   * deck is 56 m up and a Skylark's wing is eleven metres across.
   *
   * Eight draw calls: deck, towers, two main cables, hangers, piers,
   * anchorages and lamps.
   */
  buildBridge(cfg) {
    const x = cfg.x;
    const zA = Math.min(cfg.from, cfg.to);
    const zB = Math.max(cfg.from, cfg.to);
    const deckY = cfg.deckY ?? 56;
    const towerH = cfg.towerH ?? 150;
    const halfW = 13;
    let w0 = null;
    let w1 = null;
    for (let z = zA; z <= zB; z += 10) {
      if (heightAt(x, z) < 0) {
        if (w0 === null) w0 = z;
        w1 = z;
      }
    }
    if (w0 === null || w1 - w0 < 200) return null;
    const inset = Math.min(160, (w1 - w0) * 0.14);
    const tA = w0 + inset;
    const tB = w1 - inset;
    // The anchorages sit on land a little back from each shore; the deck is
    // level between them and ramps down to the ground beyond.
    const aA = Math.max(zA + 60, w0 - 130);
    const aB = Math.min(zB - 60, w1 + 130);

    const orange = new THREE.MeshStandardMaterial({ color: 0xc2462c, roughness: 0.55, metalness: 0.35 });
    const concrete = new THREE.MeshStandardMaterial({ color: 0xb8b6ae, roughness: 0.9 });

    /* ---- the deck: a profiled strip, level in the middle, ramped at the ends ---- */
    const step = 20;
    const stations = [];
    for (let z = zA; z <= zB + 0.1; z += step) {
      const g = heightAt(x, z);
      let y = deckY;
      if (z < aA) y = lerp(Math.max(g, 0) + 0.6, deckY, smoothstep(zA, aA, z));
      else if (z > aB) y = lerp(deckY, Math.max(g, 0) + 0.6, smoothstep(aB, zB, z));
      stations.push({ z, y: Math.max(y, g + 0.6) });
    }
    const pos = [];
    const col = [];
    const idx = [];
    const road = linear([0.26, 0.27, 0.29]);
    // The same red as the towers (0xc2462c), which it was meant to be and
    // was not while it went in unconverted.
    const side = linear([0.76, 0.27, 0.17]);
    const under = linear([0.42, 0.18, 0.12]);
    const T = 3.4;
    // Four corners per station: top-left, top-right, bottom-right, bottom-left.
    for (const s of stations) {
      pos.push(x - halfW, s.y, s.z, x + halfW, s.y, s.z, x + halfW, s.y - T, s.z, x - halfW, s.y - T, s.z);
    }
    // Faces are unshared so each side can carry its own colour.
    const quad = (a, b, c, d, colour) => {
      const base = pos.length / 3;
      for (const k of [a, b, c, d]) pos.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
      for (let i = 0; i < 4; i++) col.push(...colour);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (let i = 1; i < stations.length; i++) {
      const p = (i - 1) * 4;
      const q = i * 4;
      quad(p + 0, q + 0, q + 1, p + 1, road);   // top
      quad(p + 1, q + 1, q + 2, p + 2, side);   // east face
      quad(p + 3, q + 3, q + 0, p + 0, side);   // west face
      quad(p + 2, q + 2, q + 3, p + 3, under);  // soffit
    }
    const nStation = stations.length * 4;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos.slice(nStation * 3), 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx.map((k) => k - nStation));
    geo.computeVertexNormals();
    const deck = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.1, side: THREE.DoubleSide }));
    deck.castShadow = deck.receiveShadow = true;
    deck.name = 'bridge-deck';
    this.group.add(deck);
    // Solid: the level span as one box, each ramp as short steps under its
    // own profile.
    addObstacleAt(x, (aA + aB) / 2, halfW * 2 + 2, aB - aA, deckY - T - 0.5, T + 2.2, 'You flew into the bridge');
    for (let i = 1; i < stations.length; i++) {
      const a = stations[i - 1];
      const b = stations[i];
      if (a.z >= aA && b.z <= aB) continue;
      const lo = Math.min(a.y, b.y);
      const hi = Math.max(a.y, b.y);
      addObstacleAt(x, (a.z + b.z) / 2, halfW * 2 + 2, step, lo - T - 0.5, hi - lo + T + 2.2, 'You flew into the bridge');
    }

    /* ---- the towers: two legs and three portal beams each ---- */
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const towerParts = [];
    for (const tz of [tA, tB]) {
      for (const sx of [-1, 1]) {
        towerParts.push([x + sx * (halfW + 3), towerH / 2 - 4, tz, 6.5, towerH + 8, 8]);
        addObstacleAt(x + sx * (halfW + 3), tz, 7.5, 9, -8, towerH + 4, 'You flew into the bridge tower');
      }
      for (const by of [deckY - T - 3, towerH * 0.6, towerH - 5]) {
        towerParts.push([x, by, tz, (halfW + 3) * 2 + 6, 5, 6.5]);
        addObstacleAt(x, tz, (halfW + 3) * 2 + 7, 8, by - 3, 6, 'You flew into the bridge tower');
      }
      // A footing in the water, so the legs do not stand on the surface.
      towerParts.push([x, -2, tz, (halfW + 3) * 2 + 14, 8, 20]);
    }
    const towers = new THREE.InstancedMesh(unit, orange, towerParts.length);
    const d = new THREE.Object3D();
    towerParts.forEach(([px, py, pz, sx, sy, sz], i) => {
      d.position.set(px, py, pz);
      d.rotation.set(0, 0, 0);
      d.scale.set(sx, sy, sz);
      d.updateMatrix();
      towers.setMatrixAt(i, d.matrix);
    });
    towers.instanceMatrix.needsUpdate = true;
    towers.castShadow = towers.receiveShadow = true;
    this.group.add(towers);

    /* ---- the main cables, and the hangers from them ---- */
    const topY = towerH - 3;
    const sagY = deckY + 5;
    const mid = (tA + tB) / 2;
    const half = (tB - tA) / 2;
    const cableY = (z) => {
      if (z >= tA && z <= tB) return sagY + (topY - sagY) * ((z - mid) / half) ** 2;
      // Side spans: a shallow sag from the tower top down to the anchorage.
      const [z0, z1] = z < tA ? [aA, tA] : [tB, aB];
      const t = (z - z0) / (z1 - z0);
      const y0 = z < tA ? deckY + 2 : topY;
      const y1 = z < tA ? topY : deckY + 2;
      return lerp(y0, y1, t) - Math.sin(t * Math.PI) * 6;
    };
    const hangers = [];
    for (const sx of [-1, 1]) {
      const cx = x + sx * (halfW + 3);
      const pts = [];
      for (let z = aA; z <= aB + 0.1; z += 15) pts.push(new THREE.Vector3(cx, cableY(Math.min(z, aB)), Math.min(z, aB)));
      const curve = new THREE.CatmullRomCurve3(pts);
      const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 2, 0.9, 6, false), orange);
      cable.castShadow = true;
      this.group.add(cable);
      for (let z = aA + 18; z < aB - 10; z += 18) {
        if (Math.abs(z - tA) < 8 || Math.abs(z - tB) < 8) continue;
        const top = cableY(z);
        if (top - deckY < 2.5) continue;
        hangers.push([cx, (top + deckY) / 2, z, top - deckY]);
      }
    }
    const hang = new THREE.InstancedMesh(unit, orange, hangers.length);
    hangers.forEach(([px, py, pz, h], i) => {
      d.position.set(px, py, pz);
      d.scale.set(0.35, h, 0.35);
      d.updateMatrix();
      hang.setMatrixAt(i, d.matrix);
    });
    hang.instanceMatrix.needsUpdate = true;
    this.group.add(hang);

    /* ---- piers under the ramps, and the anchorage blocks ---- */
    const piers = [];
    for (const s of stations) {
      if (s.z > w0 - 20 && s.z < w1 + 20) continue;
      if (Math.round(s.z / step) % 3) continue;
      const g = heightAt(x, s.z);
      const top = s.y - T;
      if (top - g < 3) continue;
      piers.push([x, (top + g - 2) / 2, s.z, 9, top - g + 2, 5]);
    }
    for (const az of [aA, aB]) {
      const g = heightAt(x, az);
      piers.push([x, (g + deckY + 4) / 2 - 3, az, (halfW + 3) * 2 + 16, deckY + 10 - g, 26]);
      addObstacleAt(x, az, (halfW + 3) * 2 + 16, 26, g - 4, deckY + 8 - g, 'You flew into the bridge');
    }
    if (piers.length) {
      const pm = new THREE.InstancedMesh(unit, concrete, piers.length);
      piers.forEach(([px, py, pz, sx, sy, sz], i) => {
        d.position.set(px, py, pz);
        d.scale.set(sx, sy, sz);
        d.updateMatrix();
        pm.setMatrixAt(i, d.matrix);
      });
      pm.instanceMatrix.needsUpdate = true;
      pm.castShadow = pm.receiveShadow = true;
      this.group.add(pm);
    }

    /* ---- lamps along the parapets, and red lights on the tower tops ---- */
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff0c8, emissive: 0xffd89a, emissiveIntensity: 0.3, roughness: 0.4 });
    const lamps = [];
    for (const s of stations) {
      if (Math.round(s.z / step) % 2) continue;
      lamps.push([x - halfW + 0.6, s.y + 1.4, s.z], [x + halfW - 0.6, s.y + 1.4, s.z]);
    }
    for (const tz of [tA, tB]) for (const sx of [-1, 1]) lamps.push([x + sx * (halfW + 3), towerH + 0.8, tz]);
    const lm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), lampMat, lamps.length);
    lamps.forEach(([px, py, pz], i) => {
      d.position.set(px, py, pz);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      lm.setMatrixAt(i, d.matrix);
    });
    lm.instanceMatrix.needsUpdate = true;
    this.group.add(lm);
    this.lampMats.push(lampMat);

    return {
      name: cfg.name || 'the bridge',
      x, water: [w0, w1], towers: [tA, tB], anchorages: [aA, aB],
      mainSpan: tB - tA, deckY, towerH,
      // The clearance a pilot actually has: sea to the underside of the deck.
      clearance: deckY - T,
    };
  }

  /* ------------------------------------------------------------- birds -- */

  /**
   * Gulls, wheeling.
   *
   * A cliff with nothing moving on it is a picture of a cliff. A few dozen
   * birds turning slow circles over it — each on its own circle, height,
   * speed and wingbeat, some clockwise and some not — is the cheapest thing
   * in the game that makes a place feel alive: one instanced mesh of
   * four-triangle chevrons, and a per-frame loop that writes their matrices
   * from a flat Float32Array without allocating anything.
   *
   * Drawn a little larger than life (a 2.6 m span against a real gull's
   * 1.4 m), because at the distance a pilot sees them from, life size is
   * one pixel.
   */
  buildBirds(cfg, density) {
    const n = Math.max(4, Math.round((cfg.count || 30) * Math.min(1, density + 0.3)));
    const rnd = makeRandom(cfg.seed || 7331);
    // Nose along +X, wings swept back and up a little; scaling y at run time
    // changes the dihedral, which reads as a wingbeat.
    const v = [
      0.7, 0, 0, -0.35, 0.35, -1.3, -0.1, 0, 0,
      0.7, 0, 0, -0.1, 0, 0, -0.35, 0.35, 1.3,
      -0.1, 0, 0, -0.55, 0.05, -0.12, -0.55, 0.05, 0.12,
      0.7, 0, 0, -0.1, -0.08, 0, -0.1, 0, 0,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xeef0f0, roughness: 0.8, side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.frustumCulled = false;
    mesh.name = 'birds';
    // Per bird: centre x, centre z, radius, height, angle, angular speed,
    // flap phase, flap rate.
    const S = new Float32Array(n * 8);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * (cfg.radius || 600);
      const ox = cfg.cx + Math.cos(a) * r;
      const oz = cfg.cz + Math.sin(a) * r;
      const rad = 50 + rnd() * 170;
      // Never below the ground anywhere on its circle.
      let floor = 0;
      for (let k = 0; k < 8; k++) {
        const b = (k / 8) * Math.PI * 2;
        floor = Math.max(floor, heightAt(ox + Math.cos(b) * rad, oz + Math.sin(b) * rad));
      }
      const h = Math.max((cfg.height || 120) + (rnd() - 0.5) * 80, floor + 25);
      const dir = rnd() < 0.5 ? -1 : 1;
      S.set([ox, oz, rad, h, rnd() * Math.PI * 2, dir * (8 + rnd() * 6) / rad, rnd() * 6.28, 5 + rnd() * 3], i * 8);
    }
    this.group.add(mesh);
    this.flocks.push({ mesh, S, n });
    this.updateBirds(0);
  }

  updateBirds(dt) {
    const d = _bird;
    for (const f of this.flocks) {
      const { S, n, mesh } = f;
      for (let i = 0; i < n; i++) {
        const o = i * 8;
        S[o + 4] += S[o + 5] * dt;
        const a = S[o + 4];
        const x = S[o] + Math.cos(a) * S[o + 2];
        const z = S[o + 1] + Math.sin(a) * S[o + 2];
        // Mostly gliding, with bursts of flapping.
        const beat = Math.sin(this.t * S[o + 7] + S[o + 6]);
        const burst = Math.sin(this.t * 0.35 + S[o + 6]) > 0.2 ? 1 : 0.15;
        d.position.set(x, S[o + 3] + Math.sin(this.t * 0.4 + S[o + 6]) * 4, z);
        // Face along the circle, whichever way round it goes, banked into
        // the turn (positive roll about the nose is right wing down).
        d.rotation.set(S[o + 5] > 0 ? 0.35 : -0.35, S[o + 5] > 0 ? -a - Math.PI / 2 : -a + Math.PI / 2, 0, 'YXZ');
        d.scale.set(1, 0.35 + burst * 0.65 * Math.abs(beat) + (1 - burst) * 0.5, 1);
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /* -------------------------------------------------------------- reef -- */

  buildReef(cfg) {
    const tex = reefTexture();
    for (const index of cfg.islands || [0]) {
      const isl = ISLANDS[index];
      if (!isl) continue;
      const shore = coastline(isl, 96);
      const inner = shore.map((r) => r * 0.985);
      const outer = shore.map((r) => r * (1 + (cfg.width || 0.25)));
      // Just above the sea rather than below it: the ocean is opaque, and from
      // the air a reef reads as bright colour lying *on* the water anyway.
      const geo = bandGeometry(isl.cx, isl.cz, inner, outer, 0.45, Math.round(isl.radius / 220));
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        color: new THREE.Color(cfg.colour || 0x4fd6c0),
        transparent: true,
        opacity: cfg.bright ?? 0.62,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: true,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'reef';
      // After the sea (renderOrder 1 and 2 are the swell and the surf).
      mesh.renderOrder = 3;
      this.group.add(mesh);
      this.reefMats.push(mat);
    }
  }

  /* ------------------------------------------------------------ fields -- */

  /**
   * Farmland: a patchwork of fields with lanes and hedgerows between them.
   *
   * It was up to ninety rectangles dropped at random, overlapping each other
   * wherever they fell, in colours written as sRGB and read as linear — so
   * Meadow's "patchwork" came out as pale paper squares, near white from the
   * circuit, z-fighting where two overlapped. Now:
   *
   *   the layout  rows of fields on one grid turned to the map's own angle,
   *               each row its own depth and each field its own width, the
   *               rows staggered — which is how enclosures actually lie — so
   *               fields share edges instead of overlapping, with a lane of
   *               grass between neighbours
   *   the colour  six crops, converted to linear, and a stripe texture of
   *               drill rows that runs one way or the other per field
   *   hedgerows   along the lanes, with a tree standing in them every so
   *               often and a gap for a gate now and then
   *
   * Nothing is planted on a runway pad, a flat (yard, quay, green), a town,
   * a road, the beach or a slope over 12%. The patchwork is taken nearest
   * the centre first, so it is one farm country rather than a scatter.
   * Three draw calls: fields, hedges, hedgerow trees. Hedges are not solid —
   * two metres of hawthorn should not end a flight — so they register no
   * obstacle.
   */
  buildFields(cfg, density) {
    const rnd = makeRandom(cfg.seed || 4242);
    const R = cfg.radius || 1500;
    const rot = cfg.angleDeg != null ? (cfg.angleDeg * Math.PI) / 180 : rnd() * Math.PI;
    const ca = Math.cos(rot);
    const sa = Math.sin(rot);
    const W = (u, v) => [cfg.cx + u * ca - v * sa, cfg.cz + u * sa + v * ca];
    const want = Math.round((cfg.count || 60) * density);
    const LANE = 5;

    const town = MAP.scenery && MAP.scenery.town;
    const townR2 = town ? (town.radius + 80) ** 2 : 0;
    // Nor over the warehouses and car parks round a big airport.
    const estate = MAP.scenery && MAP.scenery.estate;
    const estateR2 = estate ? (estate.radius || 520) ** 2 : 0;
    // Roads as segments, not as their points: a road passes between its
    // points, and a field corner 30 m from the nearest one can be on it.
    const roadSegs = [];
    for (const r of (MAP.waters && MAP.waters.roads) || []) {
      for (let i = 1; i < r.path.length; i++) {
        const a = r.path[i - 1];
        const b = r.path[i];
        roadSegs.push([a[0], a[1], b[0], b[1], (r.halfWidth || 18) + 8]);
      }
    }
    const nearRoad = (x, z, pad = 0) => roadSegs.some(([ax, az, bx, bz, hw]) => {
      const dx = bx - ax;
      const dz = bz - az;
      const L2 = dx * dx + dz * dz;
      let t = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      return (ax + dx * t - x) ** 2 + (az + dz * t - z) ** 2 < (hw + pad) ** 2;
    });

    // The grid: rows (v) of fields (u), each row staggered.
    const cells = [];
    for (let v = -R; v < R;) {
      const depth = 150 + rnd() * 190;
      for (let u = -R - rnd() * 260; u < R;) {
        const width = 170 + rnd() * 280;
        cells.push({ u0: u, u1: u + width, v0: v, v1: v + depth, r: rnd(), r2: rnd(), r3: rnd() });
        u += width;
      }
      v += depth;
    }
    // Nearest the centre first, validated only until there are enough: the
    // far cells of a 3.4 km farm were all being sampled and then thrown away.
    for (const c of cells) {
      c.uc = (c.u0 + c.u1) / 2;
      c.vc = (c.v0 + c.v1) / 2;
      c.dist = Math.hypot(c.uc, c.vc);
    }
    cells.sort((a, b) => a.dist - b.dist);
    const good = [];
    for (const c of cells) {
      if (good.length >= want) break;
      if (c.dist > R) break;
      const { uc, vc } = c;
      const [x, z] = W(uc, vc);
      if (town && (x - town.cx) ** 2 + (z - town.cz) ** 2 < townR2) continue;
      if (estate && (x - estate.cx) ** 2 + (z - estate.cz) ** 2 < estateR2) continue;
      const h0 = heightAt(x, z);
      if (h0 < 6) continue;
      let ok = true;
      let steep = 0;
      // Ground, pads and flats on a 3 x 3; roads, which are narrow and can
      // clip a corner, on a 5 x 5 — and only on a map that has any.
      const fracs = roadSegs.length ? [0.01, 0.25, 0.5, 0.75, 0.99] : [0.01, 0.5, 0.99];
      for (const fu of fracs) {
        for (const fv of fracs) {
          const u = c.u0 + (c.u1 - c.u0) * fu;
          const v = c.v0 + (c.v1 - c.v0) * fv;
          const [px, pz] = W(u, v);
          if (roadSegs.length && nearRoad(px, pz)) { ok = false; break; }
          const h = heightAt(px, pz);
          if (h < 4 || padWeight(px, pz) > 0 || flatAt(px, pz)) { ok = false; break; }
          const d = Math.hypot(u - uc, v - vc);
          if (d > 1) steep = Math.max(steep, Math.abs(h - h0) / d);
        }
        if (!ok) break;
      }
      if (!ok || steep > 0.12) continue;
      good.push(c);
    }
    const fields = good.slice(0, want);
    if (!fields.length) return;

    // Crops, as sRGB — pasture, barley, kale, ploughed, stubble, rapeseed —
    // and which of them a climate grows.
    const CROPS = [
      [0.42, 0.56, 0.24], [0.8, 0.7, 0.36], [0.3, 0.45, 0.2],
      [0.46, 0.35, 0.24], [0.74, 0.66, 0.42], [0.88, 0.8, 0.24],
    ];
    const flora = MAP.scenery && MAP.scenery.flora;
    const pick = flora === 'boreal' ? [0, 0, 0, 2, 4, 3] : flora === 'arid' ? [4, 4, 1, 3, 0, 1] : [0, 0, 1, 2, 3, 4, 1, 5];

    const pos = [];
    const col = [];
    const uv = [];
    const idx = [];
    let base = 0;
    const tint = new THREE.Color();
    for (const c of fields) {
      const crop = CROPS[pick[Math.floor(c.r * pick.length)]];
      const shade = 0.9 + c.r2 * 0.18;
      tint.setRGB(crop[0] * shade, crop[1] * shade, crop[2] * shade, THREE.SRGBColorSpace);
      const u0 = c.u0 + LANE;
      const u1 = c.u1 - LANE;
      const v0 = c.v0 + LANE;
      const v1 = c.v1 - LANE;
      // Finer than the terrain mesh's own quads (39-51 m), so the field follows
      // the ground closely enough that the ground does not poke through it.
      const N = Math.max(4, Math.min(12, Math.round(Math.max(u1 - u0, v1 - v0) / 30)));
      const along = c.r3 < 0.5;
      for (let iy = 0; iy <= N; iy++) {
        for (let ix = 0; ix <= N; ix++) {
          const u = u0 + ((u1 - u0) * ix) / N;
          const v = v0 + ((v1 - v0) * iy) / N;
          const [x, z] = W(u, v);
          pos.push(x, heightAt(x, z) + 0.55, z);
          col.push(tint.r, tint.g, tint.b);
          // Drill rows every 9 m, one way or the other.
          uv.push(along ? u / 9 : v / 9, 0.5);
        }
      }
      for (let iy = 0; iy < N; iy++) {
        for (let ix = 0; ix < N; ix++) {
          const a0 = base + iy * (N + 1) + ix;
          idx.push(a0, a0 + N + 1, a0 + 1, a0 + 1, a0 + N + 1, a0 + N + 2);
        }
      }
      base += (N + 1) * (N + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        map: furrowTexture(),
        roughness: 0.95,
        metalness: 0,
        envMapIntensity: 0.35,
        // The patches sit a few centimetres over the terrain; the offset stops
        // them shimmering against it at a distance.
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      })
    );
    mesh.receiveShadow = true;
    mesh.name = 'fields';
    this.group.add(mesh);
    this.fields = { count: fields.length };

    /* ---- hedgerows, down the lanes: the u0 and v0 edge of every field ---- */
    const segs = [];
    const oaks = [];
    const SEG = 26;
    const edge = (ua, va, ub, vb, seed) => {
      const L = Math.hypot(ub - ua, vb - va);
      const n = Math.max(1, Math.round(L / SEG));
      for (let i = 0; i < n; i++) {
        const k = ((Math.sin(seed * 12.9 + i * 78.2) * 43758.5) % 1 + 1) % 1;
        if (k < 0.12) continue; // a gate
        const t0 = i / n;
        const t1 = (i + 1) / n;
        const [x0, z0] = W(ua + (ub - ua) * t0, va + (vb - va) * t0);
        const [x1, z1] = W(ua + (ub - ua) * t1, va + (vb - va) * t1);
        const y0 = heightAt(x0, z0);
        const y1 = heightAt(x1, z1);
        const mx = (x0 + x1) / 2;
        const mz = (z0 + z1) / 2;
        if (Math.min(y0, y1) < 3 || padWeight(mx, mz) > 0 || flatAt(mx, mz) || nearRoad(mx, mz)) continue;
        segs.push([mx, (y0 + y1) / 2, mz, Math.atan2(-(z1 - z0), x1 - x0), Math.atan2(y1 - y0, Math.hypot(x1 - x0, z1 - z0)), Math.hypot(x1 - x0, z1 - z0) + 1, k]);
        if (k > 0.86) oaks.push([mx, (y0 + y1) / 2, mz, k]);
      }
    };
    fields.forEach((c, i) => {
      edge(c.u0, c.v0, c.u1, c.v0, i * 2 + 1);
      edge(c.u0, c.v0, c.u0, c.v1, i * 2 + 2);
    });
    if (segs.length) {
      // A five-sided prism lying along x: a hedge with a rounded top.
      const hg = new THREE.CylinderGeometry(0.5, 0.5, 1, 5, 1, false);
      hg.rotateZ(Math.PI / 2);
      hg.translate(0, 0.5, 0);
      const hedges = new THREE.InstancedMesh(
        hg,
        new THREE.MeshStandardMaterial({ color: 0x3d5a2c, roughness: 1, flatShading: true, envMapIntensity: 0.35 }),
        segs.length
      );
      const d = new THREE.Object3D();
      const c = new THREE.Color();
      segs.forEach(([x, y, z, yaw, pitch, len, k], i) => {
        d.position.set(x, y - 0.6, z);
        d.rotation.set(0, yaw, pitch, 'YXZ');
        d.scale.set(len, 2.2 + k * 1.2, 2.6 + k);
        d.updateMatrix();
        hedges.setMatrixAt(i, d.matrix);
        hedges.setColorAt(i, c.setScalar(0.85 + k * 0.3));
      });
      hedges.instanceMatrix.needsUpdate = true;
      if (hedges.instanceColor) hedges.instanceColor.needsUpdate = true;
      hedges.castShadow = true;
      hedges.receiveShadow = true;
      hedges.name = 'hedges';
      this.group.add(hedges);
      this.fields.hedges = segs.length;
    }
    if (oaks.length) {
      const og = new THREE.DodecahedronGeometry(1, 0);
      const trees = new THREE.InstancedMesh(
        og,
        new THREE.MeshStandardMaterial({ color: 0x35532a, roughness: 1, flatShading: true, envMapIntensity: 0.35 }),
        oaks.length
      );
      const d = new THREE.Object3D();
      oaks.forEach(([x, y, z, k], i) => {
        const s = 4.5 + (k - 0.86) * 20;
        d.position.set(x, y + s * 0.9, z);
        d.rotation.set(0, k * 40, 0);
        d.scale.set(s, s * 0.8, s);
        d.updateMatrix();
        trees.setMatrixAt(i, d.matrix);
      });
      trees.instanceMatrix.needsUpdate = true;
      trees.castShadow = true;
      trees.name = 'hedgerow-trees';
      this.group.add(trees);
      this.fields.trees = oaks.length;
    }
  }

  /* -------------------------------------------------------- waterfalls -- */

  buildWaterfalls(count) {
    const tex = waterfallTexture();
    const rnd = makeRandom(9091);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.fallMaps.push(tex);
    let made = 0;
    for (let guard = 0; guard < count * 300 && made < count; guard++) {
      // Look for a steep face close to the water: that is where a fjord
      // waterfall lands.
      const isl = ISLANDS[1 + ((rnd() * Math.max(1, ISLANDS.length - 1)) | 0)] || ISLANDS[0];
      const a = rnd() * Math.PI * 2;
      const r = isl.radius * (0.85 + rnd() * 0.3);
      const x = isl.cx + Math.cos(a) * r;
      const z = isl.cz + Math.sin(a) * r;
      const top = heightAt(x, z);
      if (top < 90 || top > 520) continue;
      if (Math.abs(x) < 2600 && Math.abs(z) < 900) continue; // not over the approach
      const e = 40;
      const gx = heightAt(x + e, z) - heightAt(x - e, z);
      const gz = heightAt(x, z + e) - heightAt(x, z - e);
      const slope = Math.hypot(gx, gz) / (2 * e);
      if (slope < 0.75) continue;
      // Downhill, so the fall hangs off the face rather than through it.
      const dl = Math.hypot(gx, gz) || 1;
      const dx = -gx / dl;
      const dz = -gz / dl;

      const w = 12 + rnd() * 16;
      const drop = top;
      const geo = new THREE.PlaneGeometry(w, drop);
      /*
       * Tile the falling water down the drop instead of stretching one copy of
       * it over the whole face. This repeat was worked out and then parked in
       * `mesh.userData.uvRepeat`, which nothing in the game has ever read — so
       * a 500 m fjord fall and a 100 m one both wore a single smeared copy of
       * a 128-pixel texture, and the taller the fall the more obviously the
       * streaks were the wrong size. Every fall shares one material, so the
       * tiling cannot live on the texture's own repeat; it has to be baked
       * into this mesh's V coordinates. The scroll in update() is an offset,
       * which still works over scaled Vs.
       */
      const uvRepeat = drop / 90;
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * uvRepeat);
      uv.needsUpdate = true;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x + dx * 12, drop / 2, z + dz * 12);
      mesh.rotation.y = Math.atan2(dx, dz);
      this.group.add(mesh);

      // Spray where it hits the water.
      const spray = new THREE.Mesh(
        new THREE.CircleGeometry(w * 1.5, 14),
        new THREE.MeshBasicMaterial({ color: 0xdfefff, transparent: true, opacity: 0.35, depthWrite: false })
      );
      spray.rotation.x = -Math.PI / 2;
      spray.position.set(x + dx * 12, 0.5, z + dz * 12);
      this.group.add(spray);
      made++;
    }
  }

  /* ------------------------------------------------------------ aurora -- */

  /**
   * The northern lights: tall ribbons of light that ripple along their length.
   * Additive, so they brighten the sky rather than sitting in front of it, and
   * they only come out at night.
   */
  buildAurora(cfg) {
    const colour = new THREE.Color(cfg.colour || 0x4dffa8);
    const colour2 = new THREE.Color(cfg.colour2 || 0x7a5cff);
    for (let i = 0; i < 4; i++) {
      const geo = new THREE.PlaneGeometry(26000, 2400, 90, 6);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColour: { value: colour },
          uColour2: { value: colour2 },
          uOpacity: { value: 0 },
          uSeed: { value: i * 3.7 },
        },
        vertexShader: `
          uniform float uTime;
          uniform float uSeed;
          varying vec2 vUv;
          varying float vWave;
          void main() {
            vUv = uv;
            vec3 p = position;
            // Two slow waves along the ribbon: one folds it, one shifts the
            // curtain sideways. Together they never quite repeat.
            float w = sin(p.x * 0.00042 + uTime * 0.19 + uSeed) * 620.0
                    + sin(p.x * 0.00017 - uTime * 0.11 + uSeed * 2.3) * 900.0;
            vWave = sin(p.x * 0.0009 + uTime * 0.32 + uSeed);
            p.z += w;
            p.y += sin(p.x * 0.00031 + uTime * 0.14) * 260.0;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: `
          uniform vec3 uColour;
          uniform vec3 uColour2;
          uniform float uOpacity;
          uniform float uTime;
          varying vec2 vUv;
          varying float vWave;
          void main() {
            // Bright along the bottom edge, fading up — real curtains are lit
            // from below where the particles are densest.
            float v = vUv.y;
            float body = pow(1.0 - v, 1.6) * smoothstep(0.0, 0.12, v);
            // Vertical striations that drift along the curtain.
            float ray = 0.55 + 0.45 * sin(vUv.x * 260.0 + uTime * 0.5 + vWave * 3.0);
            ray *= 0.6 + 0.4 * sin(vUv.x * 61.0 - uTime * 0.23);
            // Ends taper off so the ribbon has no visible edge.
            float ends = smoothstep(0.0, 0.09, vUv.x) * (1.0 - smoothstep(0.91, 1.0, vUv.x));
            vec3 col = mix(uColour, uColour2, pow(v, 1.3));
            gl_FragColor = vec4(col * body * ray * ends * uOpacity, 1.0);
          }`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, (cfg.height || 2600) + i * 380, -5000 - i * 2600);
      mesh.rotation.y = (i - 1.5) * 0.16;
      mesh.renderOrder = -1; // behind the clouds
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.auroraMats.push(mat);
    }
  }

  /* ----------------------------------------------------------- volcano -- */

  buildVolcano(cfg, density) {
    const isl = ISLANDS.find((i) => i.name === cfg.island);
    if (!isl) return;
    const rimR = isl.craterRadius || isl.radius * 0.12;
    const floorY = heightAt(isl.cx, isl.cz);
    const rimY = heightAt(isl.cx + rimR, isl.cz);

    if (cfg.lake) this.buildLavaLake(isl, rimR, floorY);
    if (cfg.flows) this.buildLavaFlows(isl, rimR, cfg.flows);
    if (cfg.plume) this.buildPlume(isl, rimR, rimY, density);
    if (cfg.embers) this.buildEmbers(isl, rimR, floorY, density);

    // One light over the crater. It does very little in daylight and turns the
    // whole summit orange after dark, which is the entire point of it.
    const light = new THREE.PointLight(0xff5a1e, 0, rimR * 26, 2);
    light.position.set(isl.cx, floorY + rimR * 0.4, isl.cz);
    this.group.add(light);
    this.craterLights.push({ light, base: cfg.plume ? 900 : 320 });
  }

  buildLavaLake(isl, rimR, floorY) {
    const tex = lavaTexture(isl.seed);
    tex.repeat.set(3, 3);
    const geo = new THREE.CircleGeometry(rimR * 0.82, 48);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x120806,
      emissive: 0xffffff,
      emissiveMap: tex,
      emissiveIntensity: 1.5,
      map: tex,
      roughness: 0.75,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'lavaLake';
    // Sit just above the crater floor. The bowl is flat in the middle, so the
    // lake lies in it rather than hovering over a slope.
    mesh.position.set(isl.cx, floorY + 2.5, isl.cz);
    this.group.add(mesh);
    this.lavaMaps.push({ tex, speed: 0.012, mat, pulse: 0.35 });
  }

  buildLavaFlows(isl, rimR, count) {
    const tex = lavaFlowTexture(isl.seed);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x120806,
      emissive: 0xffffff,
      emissiveMap: tex,
      emissiveIntensity: 1.25,
      map: tex,
      roughness: 0.9,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    this.lavaMaps.push({ tex, speed: 0.03, mat, pulse: 0.2 });

    const rnd = makeRandom(isl.seed * 17);
    for (let f = 0; f < count; f++) {
      let bearing = (f / count) * Math.PI * 2 + rnd() * 0.5;
      const pos = [];
      const uv = [];
      const idx = [];
      const steps = 42;
      const reach = isl.radius * 0.72;
      let ok = true;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        // Flows wander as they run, and the wander grows further down.
        bearing += (rnd() - 0.5) * 0.06 * t;
        const r = lerp(rimR * 0.95, reach, Math.pow(t, 0.92));
        const ca = Math.cos(bearing);
        const sa = Math.sin(bearing);
        const x = isl.cx + ca * r;
        const z = isl.cz + sa * r;
        // Wider than they were. A 30 m ribbon down a 3 km flank is a thread
        // from anywhere you actually fly; these read as rivers of lava.
        const half = lerp(28, 10, t);
        // Across the flow, perpendicular to the bearing.
        const px = -sa;
        const pz = ca;
        const lx = x + px * half;
        const lz = z + pz * half;
        const rx = x - px * half;
        const rz = z - pz * half;
        const ly = heightAt(lx, lz);
        const ry = heightAt(rx, rz);
        if (ly < 4 || ry < 4) {
          // Ran into the sea — stop here rather than draw lava on the water.
          if (s < 6) ok = false;
          break;
        }
        // Riding 1.5 m proud keeps it out of the ground on the steep bits.
        pos.push(lx, ly + 1.5, lz, rx, ry + 1.5, rz);
        uv.push(t, 0, t, 1);
      }
      const pairs = pos.length / 6;
      if (!ok || pairs < 6) continue;
      for (let s = 0; s < pairs - 1; s++) {
        const a = s * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const flow = new THREE.Mesh(geo, mat);
      flow.name = 'lavaFlow';
      this.group.add(flow);
    }
  }

  /**
   * The ash column.
   *
   * Points with a small custom shader, because the plume needs per-particle
   * opacity and the stock points material cannot fade one particle without
   * fading all of them.
   */
  buildPlume(isl, rimR, rimY, density) {
    const count = Math.round(340 * density);
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const alpha = new Float32Array(count);
    const state = [];
    for (let i = 0; i < count; i++) {
      state.push({ age: (i / count) * 46, life: 40 + (i % 7) * 3, spin: i * 1.7 });
      pos[i * 3] = isl.cx;
      pos[i * 3 + 1] = rimY;
      pos[i * 3 + 2] = isl.cz;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: smokeSprite() },
        uColour: { value: new THREE.Color(0x5b524b) },
        uOpacity: { value: 1 },
      },
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Fade the whole column out at long range: it is a local effect and
          // at 15 km it should be part of the haze, not a hard grey blob.
          vAlpha = aAlpha * (1.0 - smoothstep(11000.0, 19000.0, -mv.z));
          gl_PointSize = clamp(aSize * (320.0 / max(1.0, -mv.z)), 1.0, 780.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform vec3 uColour;
        uniform float uOpacity;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          float a = t.a * vAlpha * uOpacity;
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColour * t.rgb, a);
        }`,
      transparent: true,
      depthWrite: false,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.group.add(points);
    this.plumes.push({ points, geo, state, isl, rimR, rimY, count, mat });
  }

  buildEmbers(isl, rimR, floorY, density) {
    const count = Math.round(90 * density);
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const alpha = new Float32Array(count);
    const state = [];
    for (let i = 0; i < count; i++) {
      state.push({ age: (i / count) * 9, life: 7 + (i % 5), spin: i * 2.3 });
      pos[i * 3] = isl.cx;
      pos[i * 3 + 1] = floorY;
      pos[i * 3 + 2] = isl.cz;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: glowSprite() }, uOpacity: { value: 1 } },
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vAlpha = aAlpha * (1.0 - smoothstep(4000.0, 9000.0, -mv.z));
          gl_PointSize = clamp(aSize * (320.0 / max(1.0, -mv.z)), 1.0, 220.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform float uOpacity;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          float a = t.a * vAlpha * uOpacity;
          if (a < 0.01) discard;
          gl_FragColor = vec4(t.rgb, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.group.add(points);
    this.plumes.push({ points, geo, state, isl, rimR, rimY: floorY, count, mat, ember: true });
  }

  /* ------------------------------------------------------------ update -- */

  update(dt, weather) {
    this.t += dt;
    const night = weather && weather.isNight ? 1 : 0;
    // Dusk counts as half dark for the glow — sunset is when a volcano looks
    // its best and the ember map opens at sunset.
    const dark = weather && weather.time === 'sunset' ? 0.55 : night;

    // Molten rock crawls. Scrolling the texture is what sells it as liquid.
    for (const l of this.lavaMaps) {
      l.tex.offset.y = (l.tex.offset.y - dt * l.speed) % 1;
      l.tex.offset.x = (l.tex.offset.x + dt * l.speed * 0.35) % 1;
      /*
       * A slow breathing pulse, brighter at night.
       *
       * The daylight floor used to be 1.1, which against a bright sky and a
       * sunlit ash slope was almost nothing — the flows were there, and you
       * genuinely could not see them. Molten rock is around 1,100 °C; it does
       * not stop glowing because the sun is up. 2.9 in daylight reads as lava
       * from the circuit, and it still climbs at dusk and after dark.
       */
      const pulse = 1 + Math.sin(this.t * 0.55) * l.pulse * 0.35;
      l.mat.emissiveIntensity = (2.9 + dark * 2.0) * pulse * (l.boost || 1);
    }

    for (const c of this.craterLights) {
      c.light.intensity = c.base * (0.18 + dark * 1.5) * (0.85 + Math.sin(this.t * 0.8) * 0.15);
    }

    // Falling water scrolls downwards.
    for (const t of this.fallMaps) t.offset.y = (t.offset.y - dt * 1.4) % 1;

    // Aurora: night only, brought up and down gently so it does not snap on.
    if (this.auroraMats.length) {
      const want = night ? 1 : weather && weather.time === 'sunset' ? 0.35 : 0;
      for (const m of this.auroraMats) {
        m.uniforms.uTime.value = this.t;
        const cur = m.uniforms.uOpacity.value;
        m.uniforms.uOpacity.value = cur + (want - cur) * Math.min(1, dt * 0.6);
      }
    }

    if (this.plumes.length) this.updatePlumes(dt, weather);
    if (this.flocks.length) this.updateBirds(dt);
    for (const m of this.lampMats) m.emissiveIntensity = night ? 2.4 : dark ? 1.2 : 0.3;
  }

  updatePlumes(dt, weather) {
    // One scratch vector for the life of the module: this runs every frame
    // on Ember and allocated two Vector3s a frame to read the wind.
    const wind = _wind.set(0, 0, 0);
    if (weather) weather.windVector(wind);
    for (const p of this.plumes) {
      const pos = p.geo.attributes.position.array;
      const size = p.geo.attributes.aSize.array;
      const alpha = p.geo.attributes.aAlpha.array;
      for (let i = 0; i < p.count; i++) {
        const s = p.state[i];
        s.age += dt;
        if (s.age > s.life) {
          s.age = 0;
          // Respawn somewhere on the vent, not all from one point.
          const a = (s.spin * 7.3) % (Math.PI * 2);
          const r = p.rimR * 0.6 * ((s.spin * 3.1) % 1);
          pos[i * 3] = p.isl.cx + Math.cos(a) * r;
          pos[i * 3 + 1] = p.rimY + 4;
          pos[i * 3 + 2] = p.isl.cz + Math.sin(a) * r;
        }
        const t = s.age / s.life;
        if (p.ember) {
          // Embers shoot up fast, slow down, and burn out.
          const rise = 46 * (1 - t) * dt;
          pos[i * 3 + 1] += rise;
          pos[i * 3] += (wind.x * 0.5 + Math.sin(this.t * 1.7 + s.spin) * 6) * dt;
          pos[i * 3 + 2] += (wind.z * 0.5 + Math.cos(this.t * 1.3 + s.spin) * 6) * dt;
          size[i] = lerp(26, 6, t);
          alpha[i] = Math.pow(1 - t, 1.5) * 0.9;
        } else {
          // Ash rises hard out of the vent, then loses its buoyancy and gets
          // carried away downwind — which is why a plume leans over.
          const rise = lerp(58, 6, Math.pow(t, 0.7)) * dt;
          pos[i * 3 + 1] += rise;
          const drift = 0.25 + t * 1.5;
          pos[i * 3] += (wind.x * drift + Math.sin(this.t * 0.25 + s.spin) * 5) * dt;
          pos[i * 3 + 2] += (wind.z * drift + Math.cos(this.t * 0.21 + s.spin) * 5) * dt;
          size[i] = lerp(120, 620, Math.pow(t, 0.8));
          // Dense and dark at the vent, thinning as it spreads.
          alpha[i] = Math.sin(Math.min(1, t * 1.15) * Math.PI) * 0.42;
        }
      }
      p.geo.attributes.position.needsUpdate = true;
      p.geo.attributes.aSize.needsUpdate = true;
      p.geo.attributes.aAlpha.needsUpdate = true;
    }
  }
}
