/**
 * Scenery: palm groves, the island town, Mango Cay village with its delivery
 * pad, a lighthouse landmark on Needle Rock and a couple of fishing boats.
 *
 * Everything is instanced or built from primitives so the whole island costs
 * only a handful of draw calls.
 */

import * as THREE from '../vendor/three.module.js';
import { heightAt, scatter, MAP, ISLANDS, addObstacleAt, getFlat, flatAt, padWeight, AIRPORT, CORRIDOR, CORRIDOR2 } from './terrain.js';
import { buildingTexture, roofTexture, foamTexture, asphaltTexture, asphaltNormal, hangarTexture } from '../render/textures.js';
import { createFishingBoat } from '../fleet/maritime.js';
import { makeRandom } from '../core/noise.js';
import { buildPads, updatePads, padsOf } from './pads.js';
import { Batch } from './airport-kit.js';

export const DELIVERY_PAD = new THREE.Vector3(6200, 0, -5200);

/**
 * A colour as a person picks one, turned into what a vertex colour holds.
 *
 * Every colour in this file is written the way it is in CSS or a paint
 * program: sRGB, 0..1. A vertex colour is read by the renderer as LINEAR
 * light, so writing sRGB numbers straight into one lifts every mid-tone —
 * [0.22, 0.44, 0.2], a palm-frond green, rendered as (0.51, 0.70, 0.48),
 * and under a 2.75 sun and ACES that came out mint. Measured off a
 * screenshot of Kestrel before this: the palms on the beach were
 * rgb(150, 214, 190), paler than the sand they stood on. Every wood in the
 * game was that colour, and so was Meadow's farmland, which was near white.
 * Instance colours set with setHex() were already converted by three.js;
 * vertex colours are the one path that is not, so it is done here.
 */
const _srgb = new THREE.Color();
export function linearRGB(c) {
  _srgb.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
  return [_srgb.r, _srgb.g, _srgb.b];
}

/**
 * Merge a few small geometries into one, keeping vertex colours.
 *
 * Everything planted in this file is instanced, which means one geometry and
 * one material per species — so a tree made of a trunk and three canopy
 * pieces has to arrive as a single buffer with the colours baked into the
 * vertices. That is cheaper than it sounds and it is what lets a wood of six
 * hundred trees cost four draw calls.
 *
 * Colours come in as sRGB and are stored linear (see linearRGB).
 */
function mergeParts(parts) {
  const pos = [];
  const norm = [];
  const col = [];
  const idx = [];
  let offset = 0;
  for (const { geo, color } of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    const [r, gr, b] = linearRGB(color);
    for (let i = 0; i < p.length; i++) pos.push(p[i]);
    for (let i = 0; i < n.length; i++) norm.push(n[i]);
    for (let i = 0; i < g.attributes.position.count; i++) {
      col.push(r, gr, b);
      idx.push(offset + i);
    }
    offset += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  return out;
}

/**
 * A lump of foliage: a low-poly ball whose corners are pushed in and out.
 *
 * A sphere reads as a sphere — a green balloon on a stick — however many
 * of them are piled up. Twenty or eighty faces, each corner moved by a
 * hash of where it is, reads as leaves. The hash is of the POSITION, not of
 * the vertex index, because the geometry is unindexed: a corner shared by
 * five faces is five vertices, and moving them by different amounts would
 * open cracks between the faces.
 */
function lump(radius, detail, seed, sx = 1, sy = 1, sz = 1, dodeca = false) {
  const g = dodeca ? new THREE.DodecahedronGeometry(radius, detail) : new THREE.IcosahedronGeometry(radius, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const h = Math.sin(x * 91.7 + y * 47.3 + z * 13.1 + seed * 7.7) * 43758.5453;
    const k = 0.8 + 0.34 * (h - Math.floor(h));
    p.setXYZ(i, x * k * sx, y * k * sy, z * k * sz);
  }
  return g;
}

/**
 * One palm frond: a strip that climbs out of the crown, arches over and
 * droops, tapering to a point, folded along its midrib so it has a top and
 * an underside that take the light differently. Four segments, sixteen
 * triangles. Built along +X from the origin, then turned into place.
 */
function frondGeometry(len, width, rise, droop) {
  const seg = 4;
  const pos = [];
  const pt = (t, side) => {
    const x = len * t;
    const y = len * (rise * t - droop * t * t);
    // Widest a third of the way out, a point at the tip.
    const w = width * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95)) * (1 - 0.35 * t);
    // The leaflets fold down from the midrib, so an edge sits a little below it.
    return [x, y - Math.abs(side) * w * 0.35, side * w];
  };
  for (let i = 0; i < seg; i++) {
    const a = i / seg;
    const b = (i + 1) / seg;
    for (const s of [-1, 1]) {
      const m0 = pt(a, 0);
      const m1 = pt(b, 0);
      const e0 = pt(a, s);
      const e1 = pt(b, s);
      // Wound so the upper face points up on both halves.
      if (s > 0) pos.push(...m0, ...e0, ...m1, ...e0, ...e1, ...m1);
      else pos.push(...m0, ...m1, ...e0, ...e0, ...m1, ...e1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * A tree, as geometry rather than as a picture of one.
 *
 * These were two crossed quads with a painted tree on them — four triangles,
 * which is the right answer for a forest seen from a mile up and the wrong
 * one for the tree you are about to land next to.
 *
 * So each species is built: a trunk, and a canopy made of the shape that
 * species actually is. One instanced draw call per species.
 *
 * The second version of these, 2026-09-25. The palm was seven flat boxes
 * sticking straight out of a pole at one angle — a pinwheel, from any
 * height — and the broadleaf, birch and scrub were UV spheres, which read
 * as balloons. Now the palm has a curved, ringed trunk, nine drooping,
 * folded fronds of different lengths and a bunch of coconuts; the leafy
 * species are faceted lumps with their corners jittered. Triangles per tree,
 * measured through this function: palm 160 -> 206, broadleaf 296 -> 252,
 * conifer 82 -> 88, scrub 136 -> 96, birch 180 -> 172, thorn 181 -> 118 —
 * on Meadow, the most wooded map, 432k -> 336k tree triangles.
 *
 * Built to a height of exactly 1 so the planting code can scale it to
 * whatever it wants, and to its own natural width at that height — a conifer
 * is narrow, a palm is wide — so scaling stays uniform and nothing is
 * stretched.
 */
/** Set for the duration of one Scenery build; see addTrees. */
let treeCache = null;

const BARK = [0.36, 0.27, 0.19];
const PALM_BARK = [0.55, 0.45, 0.33];
const PALM_BARK2 = [0.45, 0.36, 0.26];
function treeGeometry(kind = 0) {
  const parts = [];
  const trunk = (topR, botR, h, y, lean = 0, sides = 6) => {
    const g = new THREE.CylinderGeometry(topR, botR, h, sides, 1, true);
    if (lean) g.rotateZ(lean);
    g.translate(lean ? Math.sin(lean) * h * -0.5 : 0, y, 0);
    return g;
  };
  if (kind === 0) {
    /* Palm: a curving trunk in four rings of alternating bark, a crown of
       nine fronds that arch and droop, and coconuts under the crown. */
    let x = 0;
    let y = 0;
    const rings = 4;
    for (let i = 0; i < rings; i++) {
      const h = 0.84 / rings;
      const lean = 0.05 + i * 0.07;
      const r0 = 0.044 - i * 0.006;
      const g = new THREE.CylinderGeometry(r0 - 0.006, r0, h * 1.04, 6, 1, true);
      g.rotateZ(-lean);
      g.translate(x + Math.sin(lean) * h * 0.5, y + Math.cos(lean) * h * 0.5, 0);
      parts.push({ geo: g, color: i % 2 ? PALM_BARK2 : PALM_BARK });
      x += Math.sin(lean) * h;
      y += Math.cos(lean) * h;
    }
    const top = [x, y];
    const greens = [[0.27, 0.5, 0.2], [0.33, 0.56, 0.22], [0.23, 0.44, 0.18]];
    // Eight fronds at uneven bearings, each its own length, rise and droop,
    // so the crown is not a star.
    const bearings = [0, 0.83, 1.52, 2.36, 3.05, 3.9, 4.71, 5.45];
    bearings.forEach((a, i) => {
      const len = 0.42 + ((i * 37) % 11) / 11 * 0.14;
      const g = frondGeometry(len, 0.075, 0.55 + (i % 3) * 0.12, 0.85 + ((i * 5) % 4) * 0.15);
      g.rotateY(a);
      g.translate(top[0], top[1] - 0.01, 0);
      parts.push({ geo: g, color: greens[i % 3] });
    });
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + 0.4;
      parts.push({
        geo: new THREE.TetrahedronGeometry(0.03, 0).translate(top[0] + Math.cos(a) * 0.035, top[1] - 0.045, Math.sin(a) * 0.035),
        color: [0.35, 0.27, 0.14],
      });
    }
  } else if (kind === 1) {
    /* Broadleaf: a short trunk that forks, under three lumpy crowns. */
    parts.push({ geo: trunk(0.03, 0.055, 0.46, 0.23), color: BARK });
    parts.push({ geo: trunk(0.014, 0.024, 0.26, 0.52, 0.55, 5), color: BARK });
    parts.push({ geo: trunk(0.014, 0.024, 0.24, 0.5, -0.6, 5), color: BARK });
    parts.push({ geo: lump(0.3, 1, 1, 1, 0.78, 1).translate(0, 0.64, 0), color: [0.22, 0.4, 0.16] });
    parts.push({ geo: lump(0.21, 0, 2, 1, 0.85, 1, true).translate(0.16, 0.76, -0.07), color: [0.28, 0.47, 0.19] });
    parts.push({ geo: lump(0.2, 0, 3, 1, 0.85, 1, true).translate(-0.15, 0.72, 0.1), color: [0.25, 0.44, 0.17] });
  } else if (kind === 2) {
    /* Conifer: four skirts, each a little ragged, on a straight trunk. */
    parts.push({ geo: trunk(0.024, 0.046, 0.5, 0.25, 0, 5), color: BARK });
    const dark = [0.13, 0.28, 0.17];
    const mid = [0.17, 0.34, 0.2];
    const tiers = [[0.3, 0.36, 0.28], [0.25, 0.34, 0.5], [0.19, 0.3, 0.7], [0.12, 0.26, 0.88]];
    tiers.forEach(([r, h, y], i) => {
      const g = new THREE.ConeGeometry(r, h, 7);
      // Tip each skirt a touch and droop its hem, so the stack is not a
      // perfect pagoda.
      g.rotateY(i * 0.9);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        if (p.getY(k) < 0) p.setY(k, p.getY(k) - 0.03 * Math.sin(p.getX(k) * 17 + p.getZ(k) * 11 + i));
      }
      g.translate(0, y, 0);
      parts.push({ geo: g, color: i % 2 ? mid : dark });
    });
  } else if (kind === 3) {
    /* Scrub: low, wide, no trunk worth speaking of. */
    parts.push({ geo: lump(0.36, 0, 4, 1, 0.6, 1).translate(0, 0.22, 0), color: [0.33, 0.4, 0.2] });
    parts.push({ geo: lump(0.28, 0, 5, 1, 0.62, 1).translate(0.26, 0.16, 0.12), color: [0.28, 0.36, 0.18] });
    parts.push({ geo: lump(0.24, 0, 6, 1, 0.6, 1).translate(-0.22, 0.15, -0.14), color: [0.36, 0.43, 0.22] });
  } else if (kind === 4) {
    /* Birch: a pale, straight trunk under a narrow, tall crown. */
    parts.push({ geo: trunk(0.018, 0.032, 0.72, 0.36, 0, 5), color: [0.86, 0.84, 0.78] });
    parts.push({ geo: lump(0.19, 1, 7, 1, 1.85, 1).translate(0, 0.66, 0), color: [0.36, 0.52, 0.2] });
    parts.push({ geo: lump(0.12, 0, 8, 1, 1.5, 1).translate(0.1, 0.48, 0.05), color: [0.44, 0.58, 0.25] });
  } else {
    /* Umbrella thorn: a bare forked trunk and one flat, wide crown — the
       tree of a dry place, and the only one that reads as dry from the air. */
    parts.push({ geo: trunk(0.02, 0.04, 0.6, 0.3, 0.12, 5), color: BARK });
    parts.push({ geo: trunk(0.014, 0.02, 0.32, 0.62, -0.5, 5), color: BARK });
    parts.push({ geo: lump(0.5, 0, 9, 1.15, 0.2, 1.15).translate(0, 0.8, 0), color: [0.4, 0.45, 0.22] });
    parts.push({ geo: lump(0.3, 0, 10, 1.1, 0.24, 1.1).translate(0.12, 0.88, 0.06), color: [0.45, 0.5, 0.25] });
  }
  const g = mergeParts(parts);
  g.computeVertexNormals();
  return g;
}

/**
 * Which trees grow where.
 *
 * Every map used to plant the same mix — seventy-two per cent palm along
 * every coast — so the fjords, the storm coast, the mountain rescue map and
 * the northern harbours were all fringed with coconut palms. A map now says
 * what climate it is and gets the trees that go with it. Six species: palm,
 * broadleaf, conifer, scrub, birch and umbrella thorn, in that order.
 *
 * A map that says nothing is 'tropical', which is the mix the game always
 * had, so any map nobody has looked at since keeps its palms.
 */
export const FLORA = {
  tropical: {
    coast: [0.72, 0.1, 0.02, 0.16, 0, 0],
    // Rainforest broadleaf on the high ground rather than the conifer that
    // was there, with a few palms in the valleys.
    hill: [0.12, 0.56, 0.1, 0.22, 0, 0],
    pad: [0.6, 0.18, 0.02, 0.2, 0, 0],
  },
  temperate: {
    coast: [0, 0.42, 0.14, 0.3, 0.14, 0],
    hill: [0, 0.5, 0.3, 0.08, 0.12, 0],
    pad: [0, 0.46, 0.18, 0.24, 0.12, 0],
  },
  boreal: {
    coast: [0, 0.04, 0.58, 0.24, 0.14, 0],
    hill: [0, 0.02, 0.8, 0.06, 0.12, 0],
    pad: [0, 0.06, 0.6, 0.2, 0.14, 0],
  },
  arid: {
    coast: [0.06, 0, 0, 0.72, 0, 0.22],
    hill: [0, 0.04, 0.06, 0.64, 0, 0.26],
    pad: [0.04, 0, 0, 0.7, 0, 0.26],
  },
};

/** The flora block for a map, never undefined. */
export function floraOf(mapDef) {
  const k = mapDef && mapDef.scenery && mapDef.scenery.flora;
  return FLORA[k] || FLORA.tropical;
}

/**
 * Plant a grove.
 *
 * `mix` is the weighting of the four species, so a coastline can be mostly
 * palm while high ground is mostly conifer. Each species gets its own
 * instanced mesh — one draw call each, four instead of one, which is nothing
 * next to what it buys.
 *
 * Trees are solid. They were scenery you flew through, which is a strange
 * thing in a game where you can hit a hangar: a palm is a heavy object and a
 * light aeroplane loses an argument with one. Only the ones big enough to
 * matter get a hitbox — a knee-high bush should not end a flight — and the box
 * is deliberately narrower than the canopy, because clipping a frond is not
 * the same as hitting the trunk.
 */
function addTrees(group, spots, height = 9, mix = [0.7, 0.15, 0.05, 0.1], solid = true) {
  const total = mix.reduce((a, b) => a + b, 0) || 1;
  const buckets = [[], [], [], [], [], []];
  // The fall-through species is the last one this mix actually grows. It was
  // simply the last index, which with six species and a zero on the end
  // would have planted the odd umbrella thorn on a fjord on a rounding error.
  let lastLive = 0;
  for (let i = 0; i < mix.length; i++) if (mix[i] > 0) lastLive = i;
  for (const s of spots) {
    // Deterministic from the spot itself, so a given tree is always the same
    // species however many times the world is rebuilt.
    let r = ((Math.sin(s.x * 12.9898 + s.z * 78.233) * 43758.5453) % 1 + 1) % 1;
    r *= total;
    let k = lastLive;
    for (let i = 0; i < mix.length; i++) {
      if (mix[i] > 0 && r < mix[i]) { k = i; break; }
      r -= mix[i];
    }
    buckets[k].push(s);
  }
  // A little variety in the green, per tree: one wood of identical colour is
  // what reads as a texture rather than as trees. Instance colour multiplies
  // the baked vertex colour, so the trunk shifts with it by the same few per
  // cent, which nobody can see.
  const tint = new THREE.Color();

  const meshes = [];
  const d = new THREE.Object3D();
  buckets.forEach((list, kind) => {
    if (!list.length) return;
    /*
     * Vertex colours, no texture, no alpha test.
     *
     * The trunk and the canopy are one geometry, so their colours are baked
     * into the vertices — which is also why the leaves no longer need an
     * alpha-tested cut-out, and why they no longer flicker along their edges
     * at distance the way a cut-out does.
     */
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
      // Palm fronds are single sheets, and you fly under them.
      side: kind === 0 ? THREE.DoubleSide : THREE.FrontSide,
    });
    // One geometry per species per world build, shared by the coast, the
    // hills and the pad groves: it was built afresh for each of the three.
    let geo = treeCache && treeCache.get(kind);
    if (!geo) {
      geo = treeGeometry(kind);
      if (treeCache) treeCache.set(kind, geo);
    }
    const inst = new THREE.InstancedMesh(geo, mat, list.length);
    inst.castShadow = true;
    inst.receiveShadow = false;
    // How tall this species is relative to the grove's nominal height.
    const shape = [
      { w: 0.8, h: 1.0 },
      { w: 0.95, h: 0.9 },
      { w: 0.72, h: 1.15 },
      { w: 1.05, h: 0.42 },
      { w: 0.5, h: 1.1 },
      { w: 1.2, h: 0.62 },
    ][kind];
    list.forEach((s, i) => {
      d.position.set(s.x, s.y - 0.4, s.z);
      d.rotation.set(0, s.rot, 0);
      const h = height * s.scale * shape.h;
      // Uniform: the species' proportions are built into its geometry now,
      // and squashing that by a separate width factor undid the point of it.
      d.scale.set(h, h, h);
      d.updateMatrix();
      inst.setMatrixAt(i, d.matrix);
      // ±12% lightness and a touch of yellow or blue, from the spot itself.
      const q = ((Math.sin(s.x * 3.17 + s.z * 7.61) * 9631.7) % 1 + 1) % 1;
      const l = 0.88 + q * 0.24;
      inst.setColorAt(i, tint.setRGB(l * (0.97 + q * 0.06), l, l * (1.03 - q * 0.08)));
      // Anything over four metres is worth hitting. The trunk box is a
      // quarter of the canopy width and stops short of the very top, so you
      // can brush the leaves without being killed by them.
      if (solid && kind !== 3 && h > 4) {
        const trunkW = Math.max(1.2, h * shape.w * 0.22);
        addObstacleAt(s.x, s.z, trunkW, trunkW, s.y - 0.4, h * 0.86, 'You flew into a tree');
      }
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    group.add(inst);
    meshes.push(inst);
  });
  return meshes;
}

/**
 * A pitched roof: a triangular prism one unit wide (x), deep (z) and high,
 * ridge along z, eaves at y = 0. Scaled per instance. Non-indexed, so the
 * normals come out flat and each slope takes the light as one face.
 */
function gableGeometry() {
  const A = [-0.5, 0, -0.5];
  const B = [0.5, 0, -0.5];
  const C = [0, 1, -0.5];
  const D = [-0.5, 0, 0.5];
  const E = [0.5, 0, 0.5];
  const F = [0, 1, 0.5];
  // Wound so every face points out: two gable ends, two slopes, and the
  // soffit underneath so the overhang is not a hole when seen from below.
  const tris = [A, C, B, D, E, F, A, D, F, A, F, C, B, C, F, B, F, E, A, B, E, A, E, D];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  return g;
}

/**
 * A glass curtain wall, for the city's towers.
 *
 * The house texture is a six-by-seven grid of windows, which on a 180 m
 * tower stretched to windows twenty-five metres tall. This is bands of
 * blue-grey glass with the odd lit pane, drawn to be tiled up a tall box.
 * Made per world build rather than cached — see padTexture in pads.js for
 * why a module-level texture is a trap here.
 */
function towerFacadeTexture(night = false) {
  const W = 128;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  // Same seed both times, so the night map's lit panes are the day map's.
  const rnd = makeRandom(4401);
  g.fillStyle = night ? '#000000' : '#6f8190';
  g.fillRect(0, 0, W, H);
  const rows = 16;
  const cols = 4;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      // More of them lit after dark than show as lit by day.
      const q = rnd();
      const lit = q < 0.12;
      const shade = 70 + rnd() * 40;
      if (night) {
        if (q < 0.42) {
          g.fillStyle = q < 0.12 ? '#fff0c0' : q < 0.3 ? '#e8c890' : '#b8d4ff';
          g.fillRect(k * (W / cols) + 2, r * (H / rows) + 2, W / cols - 4, H / rows - 5);
        }
        continue;
      }
      g.fillStyle = lit ? '#e8d6a0' : `rgb(${shade * 0.72 | 0},${shade * 0.9 | 0},${shade * 1.08 | 0})`;
      g.fillRect(k * (W / cols) + 2, r * (H / rows) + 2, W / cols - 4, H / rows - 5);
    }
    if (night) continue;
    // The spandrel between floors, lighter.
    g.fillStyle = 'rgba(210,220,226,0.55)';
    g.fillRect(0, (r + 1) * (H / rows) - 3, W, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/**
 * A house front: lime-wash, a row of shuttered windows upstairs, windows and
 * a door downstairs, a stone plinth.
 *
 * Houses used to wear the office-block texture — six columns and seven rows
 * of windows — so every cottage in every village was a little tower block
 * with a pitched roof on it. Drawn light so the per-house wall tint shows,
 * and made per world build (see padTexture in pads.js for why a cached
 * module-level texture is a trap here).
 */
function houseTexture(variant, night = false) {
  const W = 128;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const rnd = makeRandom(7100 + variant);
  if (night) return houseNightTexture(c, g, variant);
  g.fillStyle = '#f3f0ea';
  g.fillRect(0, 0, W, H);
  // Weathering, so a wall is not a flat card.
  for (let i = 0; i < 240; i++) {
    const v = (214 + rnd() * 38) | 0;
    g.fillStyle = `rgba(${v},${v - 4},${v - 12},0.35)`;
    g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 6, 1 + rnd() * 3);
  }
  g.fillStyle = '#b3ab9e';
  g.fillRect(0, H - 9, W, 9);
  const shutter = ['#58785a', '#44668a', '#8a4a3a'][variant % 3];
  const doorCol = ['#6a3f2a', '#2f4a63', '#7a2b2b'][variant % 3];
  const cols = variant % 2 ? 2 : 3;
  const colW = W / cols;
  const ww = colW * 0.34;
  const wh = H * 0.2;
  const win = (x, y) => {
    g.fillStyle = '#fbfaf6';
    g.fillRect(x - 2, y - 2, ww + 4, wh + 4);
    const gr = g.createLinearGradient(x, y, x + ww, y + wh);
    gr.addColorStop(0, '#2b3946');
    gr.addColorStop(0.55, '#5c6f81');
    gr.addColorStop(1, '#2e3c49');
    g.fillStyle = gr;
    g.fillRect(x, y, ww, wh);
    g.fillStyle = '#fbfaf6';
    g.fillRect(x + ww / 2 - 1, y, 2, wh);
    g.fillRect(x, y + wh * 0.45, ww, 2);
    g.fillStyle = shutter;
    g.fillRect(x - 3 - ww * 0.4, y - 2, ww * 0.38, wh + 4);
    g.fillRect(x + ww + 3, y - 2, ww * 0.38, wh + 4);
  };
  for (let k = 0; k < cols; k++) {
    const x = k * colW + (colW - ww) / 2;
    win(x, H * 0.16);
    if (k === (cols === 3 ? 1 : 0)) {
      const dw = colW * 0.34;
      const dh = H * 0.34;
      const dx = k * colW + (colW - dw) / 2;
      g.fillStyle = '#fbfaf6';
      g.fillRect(dx - 3, H - 9 - dh - 3, dw + 6, dh + 3);
      g.fillStyle = doorCol;
      g.fillRect(dx, H - 9 - dh, dw, dh);
      g.fillStyle = '#d6b55a';
      g.fillRect(dx + dw * 0.72, H - 9 - dh * 0.5, 3, 3);
    } else {
      win(x, H * 0.55);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * The same house front after dark: black, with a warm pane or two lit, laid
 * out exactly where houseTexture() puts its windows. Used as an emissive map,
 * so it adds light at night and nothing by day.
 */
function houseNightTexture(c, g, variant) {
  const W = c.width;
  const H = c.height;
  g.fillStyle = '#000000';
  g.fillRect(0, 0, W, H);
  const cols = variant % 2 ? 2 : 3;
  const colW = W / cols;
  const ww = colW * 0.34;
  const wh = H * 0.2;
  // Which panes are lit, by variant: never all of them, never none.
  const lit = variant % 2 ? [[0, 0.16], [1, 0.55]] : [[0, 0.55], [2, 0.16], [2, 0.55]];
  for (const [k, y] of lit) {
    if (k === (cols === 3 ? 1 : 0) && y > 0.5) continue; // the door
    g.fillStyle = '#ffd08a';
    g.fillRect(k * colW + (colW - ww) / 2, H * y, ww, wh);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * The town's walls, one storey of one bay at a time: a 4 x 4 atlas of
 * 128 px cells, each 3 m of wall by 2.9 m (one storey).
 *
 *   row 0  four window designs, dark at night
 *   row 1  the same four, lit at night (the day picture is identical)
 *   row 2  plain render (the door's bay, the gables), and a stone plinth
 *
 * Drawn light, so a house's vertex colour tints it. Nothing in it is red.
 * The houses used to wear ONE picture of a whole house front — two floors
 * of windows and a door — stretched over each wall whatever its size, so a
 * long wall had windows twice as wide as they were tall, every wall of every
 * house had a front door, and on a slope the uphill door was underground.
 * Now a wall is cut into bays and storeys that fit it, and the door is a
 * door (see addTown).
 */
function townAtlas(night = false) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S * 4;
  c.height = S * 4;
  const g = c.getContext('2d');
  const rnd = makeRandom(9051);
  g.fillStyle = night ? '#000000' : '#f4f1ea';
  g.fillRect(0, 0, S * 4, S * 4);
  const render = (x0, y0) => {
    if (night) return;
    for (let i = 0; i < 70; i++) {
      const v = (216 + rnd() * 36) | 0;
      g.fillStyle = `rgba(${v},${v - 4},${v - 10},0.35)`;
      g.fillRect(x0 + rnd() * S, y0 + rnd() * S, 2 + rnd() * 5, 1 + rnd() * 3);
    }
  };
  const shutters = ['#58785a', '#44668a', null, '#5d6b78'];
  const warm = ['#ffd08a', '#ffe0a8', '#f6c27a', '#ffe9c0'];
  for (let row = 0; row < 2; row++) {
    for (let k = 0; k < 4; k++) {
      const x0 = k * S;
      const y0 = row * S;
      render(x0, y0);
      const french = k === 3;
      // 44 px to the metre: a 1.05 x 1.35 m window, its sill 0.85 m up; the
      // fourth design a 1.1 x 2.0 m French window with a rail across it.
      const ww = french ? 48 : 46;
      const wh = french ? 88 : 60;
      const wx = x0 + (S - ww) / 2;
      const wy = y0 + S - (french ? 11 : 37) - wh;
      if (night) {
        if (row === 1) {
          g.fillStyle = warm[k];
          g.fillRect(wx + 3, wy + 3, ww - 6, wh - 6);
        }
        continue;
      }
      // Frame, glass, glazing bars, sill.
      g.fillStyle = '#fbfaf6';
      g.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
      const gr = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
      gr.addColorStop(0, '#2b3946');
      gr.addColorStop(0.55, '#5c6f81');
      gr.addColorStop(1, '#2e3c49');
      g.fillStyle = gr;
      g.fillRect(wx, wy, ww, wh);
      g.fillStyle = '#fbfaf6';
      g.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
      g.fillRect(wx, wy + wh * (french ? 0.3 : 0.45), ww, 3);
      g.fillStyle = '#cfc8bb';
      g.fillRect(wx - 6, wy + wh + 3, ww + 12, 5);
      if (shutters[k] && !french) {
        g.fillStyle = shutters[k];
        g.fillRect(wx - 5 - ww * 0.42, wy - 3, ww * 0.4, wh + 6);
        g.fillRect(wx + ww + 5, wy - 3, ww * 0.4, wh + 6);
        g.fillStyle = 'rgba(0,0,0,0.18)';
        for (let i = 1; i < 6; i++) {
          g.fillRect(wx - 5 - ww * 0.42, wy - 3 + (i * (wh + 6)) / 6, ww * 0.4, 1.5);
          g.fillRect(wx + ww + 5, wy - 3 + (i * (wh + 6)) / 6, ww * 0.4, 1.5);
        }
      }
      if (french) {
        g.fillStyle = shutters[k];
        g.fillRect(wx - 8, wy + wh - 40, ww + 16, 3);
        for (let i = 0; i <= 8; i++) g.fillRect(wx - 8 + (i * (ww + 14)) / 8, wy + wh - 40, 2, 38);
      }
    }
  }
  // Row 2: plain render, then a stone plinth.
  render(0, 2 * S);
  if (!night) {
    g.fillStyle = '#b8b0a3';
    g.fillRect(S, 2 * S, S, S);
    g.fillStyle = 'rgba(80,72,62,0.35)';
    for (let r = 0; r < 4; r++) {
      g.fillRect(S, 2 * S + r * 32, S, 2);
      for (let q = 0; q < 3; q++) g.fillRect(S + ((q * 48 + (r % 2) * 24) % S), 2 * S + r * 32, 2, 32);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Axis-aligned half-extents of a w × d rectangle turned by `rot`. */
function turnedHalf(w, d, rot) {
  const c = Math.abs(Math.cos(rot));
  const s = Math.abs(Math.sin(rot));
  return [(c * w + s * d) / 2, (s * w + c * d) / 2];
}

// Lime-wash, cream, ochre, pale rose, sky, sage, white, sand.
const WALL_TINTS = [0xf4efe4, 0xeadcc0, 0xf0dfae, 0xecccbc, 0xd2e0ea, 0xdfe6d0, 0xf7f3ec, 0xdcc8a6];
// Terracotta, brick, slate, dark slate, rust, moss, clay.
const ROOF_TINTS = [0xb0593c, 0x93492f, 0x626870, 0x4a5058, 0x7e3d2e, 0x6c745c, 0xb86f48];
// Concrete and stone for the taller blocks.
const BLOCK_TINTS = [0xe6e2d8, 0xd6d2c6, 0xc9ccc8, 0xe9ddc8, 0xd0d8dc];
// Glass: steel blue, green-blue, bronze, silver.
const TOWER_TINTS = [0x9fb6c8, 0x93b4b2, 0xc0ab8c, 0xc4ccd2, 0x8ea5bf];

/**
 * The town.
 *
 * Every building was a box with a thinner box on top of it, four texture
 * variants dealt out in turn, so a village from the circuit was a field of
 * identical grey sheds with flat roofs — and so was a city. Then, in the
 * first pass at this: pitched roofs, but still scattered at random over the
 * grass at random angles, and the houses still wearing the office-block
 * window grid. Now planTown() lays the town out along streets and decides
 * what each building is; this draws them:
 *
 *   houses  — lime-washed in eight colours, walls cut into 3 m bays and
 *             2.9 m storeys (four window designs, some lit after dark), a
 *             stone plinth, ONE front door facing the street with a step
 *             and a hood, a gabled or hipped roof in one of seven colours
 *             with its ridge along the long side, and a chimney on about
 *             half of them
 *   blocks  — taller, stone and concrete, the office texture laid in metres,
 *             a glazed door to the street, a roof slab with a plant room
 *   towers  — only where a map asks (`town.towers`): glass, with a set-back
 *             crown and a red light on top that blinks
 *
 * Draw calls: one mesh of house walls, two of block walls, one of roofs,
 * doors and everything else, and three for towers when there are any —
 * seven at the most whatever the building count (it was twelve).
 *
 * Every building registers an obstacle — the axis-aligned box that contains
 * its turned footprint — and its walls go down to the LOWEST ground along
 * any of them, sunk 0.3 m below it, so the downhill side of a house on a
 * slope has a taller plinth rather than a gap under it; on the uphill side
 * a storey whose windows would be in the ground is stone wall instead.
 */
export function addTown(group, spots, opts = {}) {
  if (!spots.length) return { houses: 0, blocks: 0, towers: 0, tallest: 0, lampMat: null, nightMats: [] };
  // `solid: false` for buildings you are meant to land among (the delivery
  // pad's huts); `roofTints` for thatch; `meshName` prefixes the meshes.
  const { solid = true, roofTints = ROOF_TINTS, meshName: name = 'town' } = opts;
  // Materials whose windows light up after dark; Scenery.update switches them.
  const nightMats = [];
  const plan = spots.map((s, i) => {
    const q = ((Math.sin(s.x * 0.731 + s.z * 1.173) * 24634.6345) % 1 + 1) % 1;
    const q2 = ((Math.sin(s.x * 1.913 + s.z * 0.417) * 7351.137) % 1 + 1) % 1;
    // A spot with no plan (an old caller) is a house of the old size.
    const kind = s.kind || 'house';
    const w = s.w || 8 + (s.scale || 1) * 8;
    const d = s.d || 9 + q2 * 7;
    const h = s.h || 5.5 + (s.scale || 1) * 6.5;
    const lo = Number.isFinite(s.lo) ? Math.min(s.lo, s.y) : s.y - 2.2;
    return { s, kind, w, d, h, base: lo - 0.3, v: i % 2, q, q2 };
  });

  const d = new THREE.Object3D();
  const col = new THREE.Color();
  const unit = new THREE.BoxGeometry(1, 1, 1);
  // Top of the walls, whatever the base: eaves height above the spot's own
  // ground, so a row of houses along a street keeps a line.
  const top = (b) => b.s.y + b.h;

  /*
   * Houses and blocks, all of them in four meshes.
   *
   *   walls     every house wall: plinth, storeys cut into 3 m bays from the
   *             atlas (townAtlas), and the gable ends
   *   blocks    the taller blocks' walls, two textures, UVs in metres so a
   *             window is the same size on a 13 m block as on a 22 m one
   *   trims     everything else, coloured per vertex: roofs (gabled or
   *             hipped), chimneys, doors with their frames, steps and hoods,
   *             the blocks' roof slabs and plant rooms
   *
   * It was eight meshes: two of house walls and two of block walls (unit
   * boxes wearing one stretched picture each), roofs, chimneys, caps and
   * plant rooms. Every house had a door on all four walls, the door on the
   * uphill wall was underground, and there was one roof shape.
   */
  const walls = new Batch();
  const blockWalls = [new Batch(), new Batch()];
  const trims = new Batch();
  const facts = { doors: 0, doorGap: Infinity, bays: 0, buriedBays: 0, stretch: 1, hipped: 0, gabled: 0, openBays: 0, blankBays: 0 };
  const cellUV = (c, r, m = 0) => [(c + m) / 4, 1 - (r + 1 - m) / 4, (c + 1 - m) / 4, 1 - (r + m) / 4];
  const PLAIN = cellUV(0, 2, 0.15);
  const STONE = cellUV(1, 2, 0.1);
  const hash = (a, b, c) => {
    const v = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
    return v - Math.floor(v);
  };
  const DOORS = [0x3f5a4a, 0x2f4a63, 0x5a4332, 0x3a3f46, 0x4d6f78];
  // A quad whose winding is checked against the way it should face.
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const faceQuad = (batch, a, b2, c, dd, uv, colr, want) => {
    _a.set(b2[0] - a[0], b2[1] - a[1], b2[2] - a[2]);
    _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _a.cross(_b);
    if (_a.x * want[0] + _a.y * want[1] + _a.z * want[2] >= 0) batch.quad(a, b2, c, dd, uv, colr);
    else batch.quad(b2, a, dd, c, [uv[2], uv[1], uv[0], uv[3]], colr);
  };
  const faceTri = (batch, a, b2, c, colr, want) => {
    _a.set(b2[0] - a[0], b2[1] - a[1], b2[2] - a[2]);
    _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _a.cross(_b);
    const t = [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5]];
    if (_a.x * want[0] + _a.y * want[1] + _a.z * want[2] >= 0) batch.tri(a, b2, c, ...t, colr);
    else batch.tri(b2, a, c, ...t, colr);
  };

  plan.forEach((b, bi) => {
    if (b.kind !== 'house' && b.kind !== 'block') return;
    const { s } = b;
    const cr = Math.cos(s.rot);
    const sr = Math.sin(s.rot);
    // Local (x along the street, z across it) to world, as Object3D.rotation.y = rot does it.
    const P = (lx, lz, y) => [s.x + cr * lx + sr * lz, y, s.z - sr * lx + cr * lz];
    const dirW = (nx, nz) => [cr * nx + sr * nz, 0, -sr * nx + cr * nz];
    const hw = b.w / 2;
    const hd = b.d / 2;
    let T = top(b);
    // Each wall from its left end to its right end, as seen from outside.
    const faces = [
      { a: [-hw, hd], b: [hw, hd], n: [0, 1], len: b.w },
      { a: [hw, -hd], b: [-hw, -hd], n: [0, -1], len: b.w },
      { a: [hw, hd], b: [hw, -hd], n: [1, 0], len: b.d },
      { a: [-hw, -hd], b: [-hw, hd], n: [-1, 0], len: b.d },
    ];
    const at = (f, t, y, out = 0) => P(f.a[0] + (f.b[0] - f.a[0]) * t + f.n[0] * out, f.a[1] + (f.b[1] - f.a[1]) * t + f.n[1] * out, y);
    const ground = (f, t0, t1, out, pick = Math.max) => {
      let g = pick === Math.max ? -Infinity : Infinity;
      for (let i = 0; i <= 6; i++) {
        const p = at(f, t0 + ((t1 - t0) * i) / 6, 0, out);
        g = pick(g, heightAt(p[0], p[2]));
      }
      return g;
    };
    // The walls reach below the lowest ground along any of them, not just
    // below the lowest corner: a dip between two corners showed daylight
    // (10 cm of it, under one house in Fenwick).
    let low = b.base + 0.3;
    for (const f of faces) low = Math.min(low, ground(f, 0, 1, 0, Math.min));
    const base = low - 0.3;
    b.base = base;
    const front = faces[(s.front || 1) > 0 ? 0 : 1];
    const want = (f) => dirW(f.n[0], f.n[1]);

    if (b.kind === 'house') {
      const design = Math.floor(b.q2 * 4) % 4;
      const tint = WALL_TINTS[Math.floor(b.q * WALL_TINTS.length) % WALL_TINTS.length];
      // The front door: in the middle bay of the front wall (left of middle
      // on half of them), its sill on the ground in front of it.
      const nbF = Math.max(1, Math.round(front.len / 3));
      const doorBay = b.v ? Math.floor(nbF / 2) : Math.floor((nbF - 1) / 2);
      const gDoor = ground(front, doorBay / nbF, (doorBay + 1) / nbF, 0.7);
      const floor0 = Math.max(s.y, gDoor) + 0.18;
      // Never less than one storey above the door, whatever the slope.
      if (T < floor0 + 2.5) T = floor0 + 2.5;
      const n = Math.max(1, Math.round((T - floor0) / 2.9));
      const sh = (T - floor0) / n;
      for (const f of faces) {
        const nb = Math.max(1, Math.round(f.len / 3));
        const bw = f.len / nb;
        facts.stretch = Math.max(facts.stretch, bw / 3, 3 / bw, sh / 2.9, 2.9 / sh);
        const w0 = want(f);
        for (let j = 0; j < nb; j++) {
          const gBay = ground(f, j / nb, (j + 1) / nb, 0.3);
          const gLow = ground(f, j / nb, (j + 1) / nb, 0.3, Math.min);
          /*
           * The lowest storey with its sill clear of the ground under this
           * bay: below the ground floor (a basement with windows, down the
           * slope), or above it (the uphill wall, where the ground floor's
           * windows would be in the hill). Stone below that, to the foot.
           */
          // (The second term only ever allows basements: on flat ground,
          // floor0 - gLow - 0.4 is a little below zero, and unclamped its
          // floor made the ground floor blank stone.)
          let kLow = Math.ceil((gBay + 0.05 - 0.85 - floor0) / sh - 1e-9);
          kLow = Math.max(kLow, -Math.floor(Math.max(0, floor0 - gLow - 0.4) / sh), -3);
          if (f === front && j === doorBay) kLow = Math.max(kLow, 0);
          kLow = Math.min(kLow, n);
          // A bay whose ground-floor windows would clear the ground, and then
          // whether it has them (a storey of blank stone on flat ground was
          // 68% of all house bays at 9f0ce59: the basement term went +1).
          if (!(f === front && j === doorBay) && Math.ceil((gBay + 0.05 - 0.85 - floor0) / sh - 1e-9) <= 0) {
            facts.openBays++;
            if (kLow > 0) facts.blankBays++;
          }
          const yStone = floor0 + kLow * sh;
          if (yStone > base + 0.01) faceQuad(walls, at(f, j / nb, base), at(f, (j + 1) / nb, base), at(f, (j + 1) / nb, yStone), at(f, j / nb, yStone), STONE, 0xffffff, w0);
          for (let k = kLow; k < n; k++) {
            const y0 = floor0 + k * sh;
            const y1 = y0 + sh;
            const door = f === front && k === 0 && j === doorBay;
            const lit = hash(bi, j + 7 * k, f.n[0] * 3 + f.n[1] * 5) < 0.35;
            faceQuad(walls, at(f, j / nb, y0), at(f, (j + 1) / nb, y0), at(f, (j + 1) / nb, y1), at(f, j / nb, y1), door ? PLAIN : cellUV(design, lit ? 1 : 0), tint, w0);
            if (!door) {
              facts.bays++;
              if (y0 + 0.85 < gBay) facts.buriedBays++;
            }
          }
        }
      }

      /* The roof: gabled, or hipped on about a third of them. */
      const along = b.d >= b.w;
      const span = along ? b.w : b.d;
      const len = along ? b.d : b.w;
      const pitch = span * (0.34 + b.q * 0.16);
      const hip = hash(bi, 3, 11) < 0.36;
      const roofCol = roofTints[Math.floor(((b.q * 7.31) % 1) * roofTints.length)];
      // Roof coordinates: x across the ridge, y along it.
      const R = (xa, yr, y) => (along ? P(xa, yr, y) : P(yr, xa, y));
      const up = [0, 1, 0];
      const oe = 0.5;
      const E = span / 2 + oe;
      const th = 0.18;
      const slope = pitch / (span / 2);
      if (!hip) {
        facts.gabled++;
        // The gable ends are wall: a triangle of render on each end wall.
        for (const f of faces) {
          const gableEnd = along ? f.n[1] !== 0 : f.n[0] !== 0;
          if (!gableEnd) continue;
          const a = at(f, 0, T);
          const c2 = at(f, 1, T);
          const m = at(f, 0.5, T + pitch);
          walls.tri(a, c2, m, [PLAIN[0], PLAIN[1]], [PLAIN[2], PLAIN[1]], [(PLAIN[0] + PLAIN[2]) / 2, PLAIN[3]], tint);
        }
        // Two slabs, 18 cm thick, oversailing the walls by half a metre at
        // the eaves and 45 cm at the gables.
        const L = len / 2 + 0.45;
        const yU = (xa) => T + pitch - slope * Math.abs(xa);
        for (const sg of [-1, 1]) {
          const x1 = sg * E;
          const r0 = R(0, -L, yU(0) + th), r1 = R(0, L, yU(0) + th);
          const e0 = R(x1, -L, yU(x1) + th), e1 = R(x1, L, yU(x1) + th);
          const u0 = R(0, -L, yU(0)), u1 = R(0, L, yU(0));
          const s0 = R(x1, -L, yU(x1)), s1 = R(x1, L, yU(x1));
          const outX = along ? dirW(sg, 0) : dirW(0, sg);
          const outY = along ? dirW(0, 1) : dirW(1, 0);
          faceQuad(trims, r0, e0, e1, r1, [0, 0, 1, 1], roofCol, [outX[0] * slope, 1, outX[2] * slope]);
          faceQuad(trims, u0, s0, s1, u1, [0, 0, 1, 1], 0xe8e2d6, [0, -1, 0]);
          faceQuad(trims, s0, s1, e1, e0, [0, 0, 1, 1], 0xf0ede6, outX);
          faceQuad(trims, u0, s0, e0, r0, [0, 0, 1, 1], 0xf0ede6, [-outY[0], 0, -outY[2]]);
          faceQuad(trims, u1, s1, e1, r1, [0, 0, 1, 1], 0xf0ede6, outY);
        }
      } else {
        facts.hipped++;
        const rl = Math.max(0, len / 2 - span / 2);
        const Ly = len / 2 + oe;
        const ye = T - slope * oe;
        const yr = T + pitch;
        const c = (xa, yy, y) => R(xa, yy, y);
        const outX = (sg) => (along ? dirW(sg, 0) : dirW(0, sg));
        const outY = (sg) => (along ? dirW(0, sg) : dirW(sg, 0));
        for (const sg of [-1, 1]) {
          const o = outX(sg);
          faceQuad(trims, c(sg * E, -Ly, ye + th), c(sg * E, Ly, ye + th), c(0, rl, yr + th), c(0, -rl, yr + th), [0, 0, 1, 1], roofCol, [o[0] * slope, 1, o[2] * slope]);
          const oy = outY(sg);
          faceTri(trims, c(-E, sg * Ly, ye + th), c(E, sg * Ly, ye + th), c(0, sg * rl, yr + th), roofCol, [oy[0] * slope, 1, oy[2] * slope]);
          // The fascia round the eaves.
          faceQuad(trims, c(sg * E, -Ly, ye), c(sg * E, Ly, ye), c(sg * E, Ly, ye + th), c(sg * E, -Ly, ye + th), [0, 0, 1, 1], 0xf0ede6, o);
          faceQuad(trims, c(-E, sg * Ly, ye), c(E, sg * Ly, ye), c(E, sg * Ly, ye + th), c(-E, sg * Ly, ye + th), [0, 0, 1, 1], 0xf0ede6, oy);
        }
        faceQuad(trims, c(-E, -Ly, ye), c(E, -Ly, ye), c(E, Ly, ye), c(-E, Ly, ye), [0, 0, 1, 1], 0xe8e2d6, [0, -1, 0]);
      }
      // A chimney on the ridge of about half of them.
      if (b.q2 > 0.45) {
        const lim = hip ? Math.max(0, len / 2 - span / 2) : len / 2 - 1;
        const t = Math.max(-lim, Math.min(lim, (b.q2 - 0.5) * len * 0.6));
        const p = R(0, t, 0);
        const ry = s.rot + (along ? 0 : Math.PI / 2);
        trims.box(1.1, 2.3, 1.1, p[0], T + pitch + 0.25, p[2], 0x7a5a48, ry);
        trims.box(1.35, 0.16, 1.35, p[0], T + pitch + 1.45, p[2], 0x6b5446, ry);
      }

      /* The door, in its frame, with a step up to it and a hood over it. */
      const tD = (doorBay + 0.5) / nbF;
      const nW = want(front);
      const ry = Math.atan2(nW[0], nW[2]);
      const pd = (out) => at(front, tD, 0, out);
      const colD = DOORS[Math.floor(hash(bi, 1, 2) * DOORS.length)];
      // Their backs are sunk into the wall, so nothing lies flat against it.
      let p = pd(0.03);
      trims.box(1.1, 2.2, 0.2, p[0], floor0 + 1.1, p[2], colD, ry);
      p = pd(0.0);
      trims.box(1.45, 2.46, 0.1, p[0], floor0 + 1.21, p[2], 0xf6f4ee, ry);
      const gStep = ground(front, tD - 0.9 / front.len, tD + 0.9 / front.len, 0.9, Math.min);
      const stepH = floor0 - gStep + 0.3;
      p = pd(0.46);
      trims.box(1.7, stepH, 0.9, p[0], floor0 - stepH / 2, p[2], 0xb3ab9e, ry);
      p = pd(0.38);
      trims.box(1.75, 0.12, 0.76, p[0], floor0 + 2.62, p[2], 0xf6f4ee, ry);
      facts.doors++;
      facts.doorGap = Math.min(facts.doorGap, floor0 - gDoor);
    } else {
      /* A block: walls in metres, a door at the front, a roof slab and a plant room. */
      const tex = blockWalls[b.v];
      const tint = BLOCK_TINTS[Math.floor(b.q * BLOCK_TINTS.length) % BLOCK_TINTS.length];
      const gF = ground(front, 0.35, 0.65, 0.8);
      const floor0 = Math.max(s.y, gF) + 0.12;
      const n = Math.max(1, Math.round((T - floor0) / 3.3));
      const sh = (T - floor0) / n;
      // buildingTexture is six bays by seven storeys, laid a bay at a time.
      let doorAt = null;
      for (const f of faces) {
        const nb = Math.max(1, Math.round(f.len / 3.5));
        const w0 = want(f);
        for (let j = 0; j < nb; j++) {
          const gB = ground(f, j / nb, (j + 1) / nb, 0.3);
          const gBl = ground(f, j / nb, (j + 1) / nb, 0.3, Math.min);
          // The lowest storey whose windows clear the ground under this bay:
          // above the ground floor up a slope, a basement or two down one.
          const k0 = Math.min(n, Math.max(Math.ceil((gB - floor0 - 0.9) / sh - 1e-9), -Math.floor(Math.max(0, floor0 - gBl - 0.4) / sh), -3));
          if (Math.ceil((gB - floor0 - 0.9) / sh - 1e-9) <= 0) {
            facts.openBays++;
            if (k0 > 0) facts.blankBays++;
          }
          const y0 = floor0 + k0 * sh;
          const t0 = j / nb;
          const t1 = (j + 1) / nb;
          // Below it, a stone plinth to the foot of the wall.
          if (y0 > base + 0.01) faceQuad(trims, at(f, t0, base), at(f, t1, base), at(f, t1, y0), at(f, t0, y0), [0, 0, 1, 1], 0xaaa396, w0);
          if (y0 < T - 0.01) faceQuad(tex, at(f, t0, y0), at(f, t1, y0), at(f, t1, T), at(f, t0, T), [j / 6, k0 / 7, (j + 1) / 6, n / 7], tint, w0);
        }
        facts.stretch = Math.max(facts.stretch, f.len / nb / 3.5, 3.5 / (f.len / nb), sh / 3.3, 3.3 / sh);
        if (f === front) doorAt = (Math.floor(nb / 2) + 0.5) / nb;
      }
      const nW = want(front);
      const ry = Math.atan2(nW[0], nW[2]);
      let p = at(front, doorAt, 0, 0.03);
      trims.box(2.6, 2.7, 0.2, p[0], floor0 + 1.35, p[2], 0x24323d, ry);
      p = at(front, doorAt, 0, 0.0);
      trims.box(3.0, 2.99, 0.1, p[0], floor0 + 1.47, p[2], 0xc9ced3, ry);
      p = at(front, doorAt, 0, 0.7);
      trims.box(3.6, 0.2, 1.4, p[0], floor0 + 3.05, p[2], 0xc9ced3, ry);
      // The roof slab, and the plant room off-centre on it.
      trims.box(b.w + 1.0, 0.9, b.d + 1.0, s.x, T + 0.4, s.z, 0x767b80, s.rot);
      const ox = (b.q - 0.5) * b.w * 0.4;
      trims.box(b.w * 0.3, 2.8, b.d * 0.34, s.x + cr * ox, T + 2.2, s.z - sr * ox, 0x8d9296, s.rot);
      facts.doors++;
    }

    const [hx, hz] = turnedHalf(b.w, b.d, s.rot);
    // A roof is at most half its span high, and the span is always the short side.
    if (solid) addObstacleAt(s.x, s.z, hx * 2, hz * 2, base, T - base + (b.kind === 'house' ? Math.min(b.w, b.d) * 0.5 + 0.5 : 1.3), 'You flew into a building');
  });

  const atlas = townAtlas();
  const atlasNight = townAtlas(true);
  const houseMat = new THREE.MeshStandardMaterial({
    map: atlas,
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.02,
    envMapIntensity: 0.6,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: atlasNight,
    emissiveIntensity: 0,
  });
  nightMats.push(houseMat);
  const hw = walls.mesh(houseMat, { name: `${name}-house-walls` });
  if (hw) group.add(hw);
  blockWalls.forEach((bb, v) => {
    const m = bb.mesh(new THREE.MeshStandardMaterial({ map: buildingTexture(v ? 3 : 0), vertexColors: true, roughness: 0.85, metalness: 0.02, envMapIntensity: 0.6 }), { name: `${name}-block-walls` });
    if (m) group.add(m);
  });
  const tm = trims.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.02, flatShading: true, envMapIntensity: 0.6 }), { name: `${name}-roofs` });
  if (tm) group.add(tm);
  const houses = plan.filter((b) => b.kind === 'house');
  const blocks = plan.filter((b) => b.kind === 'block');

  /* ---- towers ---- */
  const towers = plan.filter((b) => b.kind === 'tower');
  // Down to the lowest ground along any wall, like the houses, so a dip
  // between two corners shows no daylight under a 30 m tower either.
  for (const b of towers) {
    const { s } = b;
    const cr = Math.cos(s.rot);
    const sr = Math.sin(s.rot);
    for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
      for (let i = 0; i <= 8; i++) {
        const lx = ((ax + ((bx - ax) * i) / 8) * b.w) / 2;
        const lz = ((az + ((bz - az) * i) / 8) * b.d) / 2;
        b.base = Math.min(b.base, heightAt(s.x + cr * lx + sr * lz, s.z - sr * lx + cr * lz) - 0.3);
      }
    }
  }
  let lights = null;
  if (towers.length) {
    const tex = towerFacadeTexture();
    tex.repeat.set(2, 6);
    const glass = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.28, metalness: 0.55, envMapIntensity: 1.1 });
    // Lit panes after dark: a city at night is its windows.
    const night = towerFacadeTexture(true);
    night.repeat.copy(tex.repeat);
    glass.emissive.setHex(0xffffff);
    glass.emissiveMap = night;
    glass.emissiveIntensity = 0;
    nightMats.push(glass);
    const body = new THREE.InstancedMesh(unit, glass, towers.length);
    const crown = new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ color: 0xc6ccd0, roughness: 0.6, metalness: 0.3 }), towers.length);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x5a0d0a, emissive: 0xff2a1a, emissiveIntensity: 1.2, roughness: 0.5 });
    lights = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), lampMat, towers.length);
    body.castShadow = body.receiveShadow = crown.castShadow = true;
    towers.forEach((b, i) => {
      const { s } = b;
      const hh = top(b) - b.base;
      d.position.set(s.x, b.base + hh / 2, s.z);
      d.rotation.set(0, s.rot, 0);
      d.scale.set(b.w, hh, b.d);
      d.updateMatrix();
      body.setMatrixAt(i, d.matrix);
      body.setColorAt(i, col.setHex(TOWER_TINTS[Math.floor(b.q * TOWER_TINTS.length) % TOWER_TINTS.length]));
      const ch = 6 + b.q * 10;
      d.position.set(s.x, top(b) + ch / 2, s.z);
      d.scale.set(b.w * 0.62, ch, b.d * 0.62);
      d.updateMatrix();
      crown.setMatrixAt(i, d.matrix);
      d.position.set(s.x, top(b) + ch + 0.9, s.z);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      lights.setMatrixAt(i, d.matrix);
      const [hx, hz] = turnedHalf(b.w, b.d, s.rot);
      addObstacleAt(s.x, s.z, hx * 2, hz * 2, b.base, top(b) - b.base + ch + 2, 'You flew into a tower');
    });
    body.instanceMatrix.needsUpdate = true;
    if (body.instanceColor) body.instanceColor.needsUpdate = true;
    crown.instanceMatrix.needsUpdate = true;
    lights.instanceMatrix.needsUpdate = true;
    group.add(body, crown, lights);
  }
  return {
    houses: houses.length,
    blocks: blocks.length,
    towers: towers.length,
    tallest: towers.reduce((m, b) => Math.max(m, b.h), 0),
    lampMat: lights ? lights.material : null,
    nightMats,
    facts,
  };
}

/**
 * The streets a town was laid out along, drawn: one ribbon mesh, draped on
 * the ground a hand's breadth up. Only the streets planTown() made up —
 * a street that is really a road is already drawn by the road network.
 */
function addStreets(group, streets) {
  const pos = [];
  const idx = [];
  let base = 0;
  for (const st of streets) {
    if (!st.drawn || st.pts.length < 2) continue;
    const n = st.pts.length;
    for (let i = 0; i < n; i++) {
      const a = st.pts[Math.max(0, i - 1)];
      const b = st.pts[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0];
      let tz = b[1] - a[1];
      const L = Math.hypot(tx, tz) || 1;
      tx /= L;
      tz /= L;
      const [x, z] = st.pts[i];
      for (const side of [-1, 1]) {
        const px = x - tz * st.hw * side;
        const pz = z + tx * st.hw * side;
        pos.push(px, heightAt(px, pz) + 0.25, pz);
      }
      if (i > 0) idx.push(base - 2, base - 1, base, base - 1, base + 1, base);
      base += 2;
    }
  }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: 0x4a4d51,
    roughness: 0.95,
    metalness: 0,
    envMapIntensity: 0.35,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  }));
  mesh.receiveShadow = true;
  mesh.name = 'streets';
  group.add(mesh);
  return mesh;
}

/**
 * The lighthouse.
 *
 * It was six stacked cylinders and a cone standing on the bare hillside, with
 * no base, no door and no light you could see from anywhere but the lamp
 * itself — and it was not solid, so you could fly straight through the one
 * landmark every night mission tells you to steer by.
 *
 * Now: a stone plinth sunk into whatever slope it stands on, a tapered tower
 * in red and white bands, a gallery with a railing, a glazed lantern with its
 * glazing bars, a domed cap, a keeper's cottage beside it, and at night two
 * beams sweeping round over the sea, which is what a lighthouse is actually
 * for and what you see of one from ten miles out. Seventeen meshes and one
 * obstacle; there is one lighthouse per map.
 */
function buildLighthouse(group, x, z) {
  // Stand on the LOWEST ground under the plinth, so a lighthouse on a cliff
  // edge has its base in the rock rather than a corner hanging in the air.
  let y = Infinity;
  for (const [ox, oz] of [[0, 0], [7, 0], [-7, 0], [0, 7], [0, -7]]) y = Math.min(y, heightAt(x + ox, z + oz));
  const top = heightAt(x, z);
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.7 });
  const red = new THREE.MeshStandardMaterial({ color: 0xc8241c, roughness: 0.7 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x8c8a84, roughness: 0.95 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x23282c, roughness: 0.5, metalness: 0.5 });
  const add = (geo, mat, px, py, pz, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px, py, pz);
    m.castShadow = shadow;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };

  // The plinth: nine-sided, rough, and deep enough to reach the ground on
  // the low side.
  const base = top - y + 3;
  add(new THREE.CylinderGeometry(6.2, 8.2, base + 3, 9), stone, 0, y - top + (base + 3) / 2 - 3, 0);

  // The tower: six bands, tapering 3.9 m to 2.6 m over 30 m.
  const H = 30;
  const bands = 6;
  for (let i = 0; i < bands; i++) {
    const r0 = 3.9 - (i / bands) * 1.3;
    const r1 = 3.9 - ((i + 1) / bands) * 1.3;
    add(new THREE.CylinderGeometry(r1, r0, H / bands, 20), i % 2 ? red : white, 0, (i + 0.5) * (H / bands), 0);
  }
  // A door and three windows up the landward side, so it is a building.
  // Landward is whichever of four sides has the highest ground.
  let best = [0, 13];
  let bestH = -Infinity;
  for (const [ox, oz] of [[0, 13], [13, 0], [0, -13], [-13, 0]]) {
    const hh = heightAt(x + ox, z + oz);
    if (hh > bestH) { bestH = hh; best = [ox, oz]; }
  }
  const face = Math.atan2(best[0], best[1]);
  /*
   * The door is on the plinth, not in it. The plinth's top is 3 m up and
   * the door was at the foot of the tower, 0-2.6 m: inside the stone, on
   * every map. It stands on the plinth now, with steps down its landward
   * side to the ground.
   */
  const door = add(new THREE.BoxGeometry(1.6, 2.6, 0.5), iron, Math.sin(face) * 3.72, 3 + 1.3, Math.cos(face) * 3.72, false);
  door.rotation.y = face;
  const steps = new Batch();
  for (let k = 0; k < 6; k++) {
    const r = 6.55 + k * 0.9;
    const stepTop = 3 - 0.6 * (k + 1);
    const gr = heightAt(x + Math.sin(face) * r, z + Math.cos(face) * r) - top;
    if (stepTop < gr - 0.05) break;
    const hS = stepTop - (gr - 0.6);
    steps.box(2.2, hS, 0.9, Math.sin(face) * r, stepTop - hS / 2, Math.cos(face) * r, 0xffffff, face);
  }
  const stair = steps.mesh(stone, { cast: false, name: 'lighthouse-steps' });
  if (stair) g.add(stair);
  for (let i = 0; i < 3; i++) {
    const r = 3.6 - i * 0.32;
    const win = add(new THREE.BoxGeometry(0.9, 1.3, 0.4), iron, Math.sin(face) * r, 8 + i * 7, Math.cos(face) * r, false);
    win.rotation.y = face;
  }

  // The gallery and its railing.
  add(new THREE.CylinderGeometry(3.7, 3.4, 0.6, 20), white, 0, H + 0.3, 0);
  const rail = new THREE.Mesh(new THREE.TorusGeometry(3.55, 0.07, 5, 28), iron);
  rail.rotation.x = Math.PI / 2;
  rail.position.y = H + 1.5;
  g.add(rail);
  // Posts and glazing bars share one instanced mesh.
  const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), iron, 12 + 8);
  const d = new THREE.Object3D();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    d.position.set(Math.cos(a) * 3.55, H + 1.0, Math.sin(a) * 3.55);
    d.rotation.set(0, -a, 0);
    d.scale.set(0.1, 1.2, 0.1);
    d.updateMatrix();
    bars.setMatrixAt(i, d.matrix);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    d.position.set(Math.cos(a) * 2.2, H + 2.4, Math.sin(a) * 2.2);
    d.rotation.set(0, -a, 0);
    d.scale.set(0.16, 3.2, 0.16);
    d.updateMatrix();
    bars.setMatrixAt(12 + i, d.matrix);
  }
  bars.instanceMatrix.needsUpdate = true;
  g.add(bars);

  // The lantern.
  const lamp = add(
    new THREE.CylinderGeometry(2.15, 2.15, 3.2, 16),
    new THREE.MeshStandardMaterial({
      color: 0xffe9b0,
      emissive: 0xffd070,
      emissiveIntensity: 1.4,
      roughness: 0.2,
      transparent: true,
      opacity: 0.85,
    }),
    0, H + 2.4, 0, false
  );
  // Dome, ventilator ball and lightning rod.
  add(new THREE.SphereGeometry(2.45, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), red, 0, H + 4.0, 0);
  add(new THREE.SphereGeometry(0.45, 10, 6), iron, 0, H + 6.6, 0, false);
  add(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 5), iron, 0, H + 7.8, 0, false);

  // The keeper's cottage, on the same landward side as the door — where
  // there IS a landward side. A light on a breakwater head (Sennen's) or a
  // needle of rock has nowhere level beside it, and a cottage hanging off a
  // harbour wall is worse than none.
  const [cx, cz] = best;
  const cy = bestH - top;
  /*
   * Built like the town's houses — it was a plain white box with a roof on,
   * no door and no windows, sunk 2 m. Its door faces the tower. Not solid,
   * as it never was: the courier's van is sent to this coordinate.
   */
  let cottage = null;
  if (bestH > 1.5 && Math.abs(cy) < 5) {
    const w = 11;
    const d = 7;
    const cc = Math.cos(face);
    const sc = Math.sin(face);
    let lo = bestH;
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) lo = Math.min(lo, heightAt(x + cx + (cc * lx * w + sc * lz * d) / 2, z + cz + (-sc * lx * w + cc * lz * d) / 2));
    cottage = addTown(group, [{ x: x + cx, z: z + cz, y: bestH, lo, rot: face, kind: 'house', w, d, h: 5, front: -1 }], { solid: false, meshName: 'cottage' });
  }

  /*
   * The beams. Two long, faint cones back to back from the lamp, turning.
   * Additive and depth-write off, so they brighten whatever is behind them
   * and never hide it; opacity is driven from Scenery.update and is zero in
   * daylight, when the whole group is also hidden so it costs nothing.
   */
  const beamGeo = new THREE.ConeGeometry(22, 320, 18, 1, true);
  beamGeo.translate(0, -160, 0);
  beamGeo.rotateZ(Math.PI / 2);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xfff0c4,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Group();
  const b1 = new THREE.Mesh(beamGeo, beamMat);
  const b2 = new THREE.Mesh(beamGeo, beamMat);
  b2.rotation.y = Math.PI;
  beam.add(b1, b2);
  // Tipped a few degrees down, so the sweep crosses the water rather than
  // the sky.
  b1.rotation.z = -0.05;
  b2.rotation.z = -0.05;
  beam.position.y = H + 2.4;
  beam.visible = false;
  g.add(beam);

  g.position.set(x, top, z);
  group.add(g);
  // Solid, up to the top of the cap. It never was.
  addObstacleAt(x, z, 8, 8, y - 1, top - y + H + 8, 'You flew into the lighthouse');
  return { lamp, beam, beamMat, nightMats: cottage ? cottage.nightMats : [] };
}

/**
 * Where the lighthouse actually stands: the map's coordinate if it is dry,
 * otherwise the nearest shore. Exported so the tests measure the same point
 * the builder uses.
 */
export function lighthouseSpot(mapDef) {
  const main = mapDef.islands[0];
  const want = (mapDef.scenery && mapDef.scenery.lighthouse) || [main.cx - main.radius * 0.8, main.cz];
  return nearestLand(want[0], want[1], 2) || { x: want[0], z: want[1] };
}

function buildDeliveryPad(group) {
  const y = heightAt(DELIVERY_PAD.x, DELIVERY_PAD.z);
  DELIVERY_PAD.y = y;

  // A short grass strip with a painted target circle: the drop zone.
  const padMat = new THREE.MeshStandardMaterial({ color: 0x6b6f5c, roughness: 0.95 });
  const geo = new THREE.PlaneGeometry(240, 44);
  geo.rotateX(-Math.PI / 2);
  const pad = new THREE.Mesh(geo, padMat);
  pad.position.set(DELIVERY_PAD.x, y + 0.08, DELIVERY_PAD.z);
  pad.receiveShadow = true;
  group.add(pad);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(14, 18, 40),
    new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(DELIVERY_PAD.x, y + 0.14, DELIVERY_PAD.z);
  group.add(ring);
  const cross = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 3.5),
    new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9 })
  );
  cross.rotation.x = -Math.PI / 2;
  cross.position.set(DELIVERY_PAD.x, y + 0.14, DELIVERY_PAD.z);
  group.add(cross);
  const cross2 = cross.clone();
  cross2.rotation.z = Math.PI / 2;
  group.add(cross2);

  /*
   * The village round the pad.
   *
   * Nine identical huts at nine identical angles on three radii, which from
   * above was a clock face drawn round the target. Same huts, but each
   * gets its own bearing, distance, size and turn from a seeded random, and
   * they are two instanced meshes rather than eighteen.
   */
  const rnd = makeRandom(Math.round(DELIVERY_PAD.x * 7 + DELIVERY_PAD.z * 3) | 0);
  const huts = [];
  for (let i = 0; i < 12 && huts.length < 9; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 64 + rnd() * 70;
    const hx = DELIVERY_PAD.x + Math.cos(a) * r;
    const hz = DELIVERY_PAD.z + Math.sin(a) * r;
    // Not on the strip itself, which runs east-west through the pad.
    if (Math.abs(hz - DELIVERY_PAD.z) < 30 && Math.abs(hx - DELIVERY_PAD.x) < 130) continue;
    const hy = heightAt(hx, hz);
    if (hy < 2) continue;
    const sz = 0.8 + rnd() * 0.5;
    const rot = rnd() * Math.PI;
    // Not on top of another hut: two of them stood in each other.
    if (huts.some((o) => Math.hypot(o.x - hx, o.z - hz) < (o.s + sz) * 7.5)) continue;
    // Nor on a slope steeper than a house can be built on: on Task Force
    // Resolute's hills one hut's front door was higher than its own eaves.
    let lo = hy;
    let hi = hy;
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const g = heightAt(hx + ox * 5 * sz, hz + oz * 5 * sz);
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
    }
    if (hi - lo > 2.2 * sz) continue;
    huts.push({ x: hx, y: hy, z: hz, s: sz, rot });
  }
  if (huts.length) {
    /*
     * Built like the town's houses. They were unit boxes wearing the old
     * house-front picture, sunk 2 m into the ground so no corner floated —
     * which put the bottom 2 m of the picture underground: every hut had a
     * front door on all four walls, and every one of them was buried to the
     * handle. Still not solid: landing among them is the mission.
     */
    const spots = huts.map((h) => {
      const w = 8 * h.s;
      const c = Math.cos(h.rot);
      const sn = Math.sin(h.rot);
      let lo = h.y;
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) lo = Math.min(lo, heightAt(h.x + (c * lx + sn * lz) * w / 2, h.z + (-sn * lx + c * lz) * w / 2));
      // Front door toward the pad.
      const front = Math.sin(h.rot) * (DELIVERY_PAD.x - h.x) + Math.cos(h.rot) * (DELIVERY_PAD.z - h.z) >= 0 ? 1 : -1;
      return { x: h.x, z: h.z, y: h.y, lo, rot: h.rot, kind: 'house', w, d: w * 1.1, h: 5 * h.s, front };
    });
    const built = addTown(group, spots, { solid: false, roofTints: [0x8d6b3f, 0x7d5f38, 0x9a7a4a], meshName: 'huts' });
    pad.userData.nightMats = built.nightMats;
  }
  return pad;
}

/**
 * A boat, as one merged mesh with its colours in the vertices.
 *
 * The old one was half a cylinder lying on its side with a blue box on it:
 * a bath with a shed, and every one on the map the same. These are three
 * kinds — a trawler, a yacht with its sail up and a small ferry — with a
 * proper pointed bow and a flat transom, in the colours working boats are
 * actually painted. One draw call a boat, same as before (plus its wake).
 *
 * Built bow-forward along +X, because that is the way Scenery.update moves
 * them.
 */
function boatGeometry(kind, hullColour) {
  const parts = [];
  const hullShape = (L, B, D, colour, y0 = 0) => {
    const g = new THREE.BoxGeometry(L, D, B, 10, 2, 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const t = x / L + 0.5; // 0 stern, 1 bow
      // Full to the shoulder, then drawn in to a point at the stem.
      let w = t < 0.58 ? 0.9 + 0.1 * (t / 0.58) : 1 - Math.pow((t - 0.58) / 0.42, 1.7);
      // A V below the waterline.
      if (y < 0) w *= 0.55;
      // Sheer: the deck line rises towards the bow.
      const lift = y > 0 ? D * 0.35 * Math.pow(t, 3) : 0;
      p.setXYZ(i, x, y + lift + y0, p.getZ(i) * Math.max(0.02, w));
    }
    g.computeVertexNormals();
    parts.push({ geo: g, color: colour });
  };
  const box = (w, h, d, x, y, z, colour) => {
    parts.push({ geo: new THREE.BoxGeometry(w, h, d).translate(x, y, z), color: colour });
  };
  const white = [0.92, 0.92, 0.88];
  const dark = [0.12, 0.15, 0.18];
  const wood = [0.55, 0.42, 0.28];
  if (kind === 'yacht') {
    hullShape(12, 3.6, 1.6, white, 0.5);
    box(4.2, 1.0, 2.4, -0.6, 1.8, 0, [0.86, 0.84, 0.78]);
    box(3.0, 0.3, 2.5, -0.6, 2.3, 0, dark);
    // Mast and boom.
    parts.push({ geo: new THREE.CylinderGeometry(0.08, 0.1, 15, 5).translate(0.8, 8.6, 0), color: [0.8, 0.8, 0.82] });
    parts.push({ geo: new THREE.CylinderGeometry(0.07, 0.07, 5.2, 5).rotateZ(Math.PI / 2).translate(-1.8, 2.9, 0), color: [0.8, 0.8, 0.82] });
    // Mainsail and jib, as flat triangles (the material is double-sided).
    const sail = (a, b, c) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
      g.computeVertexNormals();
      return g;
    };
    parts.push({ geo: sail([0.7, 3.1, 0], [0.7, 15.6, 0], [-4.3, 3.1, 0]), color: [0.97, 0.96, 0.92] });
    parts.push({ geo: sail([0.95, 3.4, 0], [0.95, 13.8, 0], [5.6, 2.2, 0]), color: [0.93, 0.92, 0.86] });
  } else if (kind === 'ferry') {
    hullShape(34, 8.5, 3.6, hullColour, 1.2);
    box(20, 3.2, 7.4, -2, 4.4, 0, white);
    box(15, 2.8, 6.8, -3, 7.4, 0, white);
    box(19.6, 1.0, 7.5, -2, 4.9, 0, dark);   // window band, lower deck
    box(14.6, 0.9, 6.9, -3, 7.6, 0, dark);   // upper deck
    box(4.2, 2.4, 6.6, 3.5, 9.9, 0, white);  // bridge
    box(1.8, 4.2, 2.2, -8, 10.8, 0, hullColour); // funnel
    box(1.9, 0.8, 2.3, -8, 13.1, 0, dark);
  } else {
    // Trawler.
    hullShape(16, 5, 2.4, hullColour, 0.9);
    box(13, 0.25, 4.2, -0.8, 2.25, 0, wood);
    box(4.2, 3.2, 3.8, 1.6, 3.9, 0, white);
    box(4.3, 0.8, 3.9, 1.6, 4.8, 0, dark);   // wheelhouse windows
    box(4.6, 0.3, 4.2, 1.6, 5.6, 0, [0.7, 0.2, 0.16]);
    parts.push({ geo: new THREE.CylinderGeometry(0.12, 0.14, 8, 5).translate(-1.4, 6.2, 0), color: [0.75, 0.75, 0.72] });
    parts.push({ geo: new THREE.CylinderGeometry(0.1, 0.1, 7, 5).rotateZ(1.0).translate(-4.4, 4.4, 0), color: [0.75, 0.75, 0.72] });
    box(1.6, 0.9, 2.8, -5.5, 2.8, 0, [0.9, 0.5, 0.12]); // fish boxes
  }
  const g = mergeParts(parts);
  g.computeVertexNormals();
  return g;
}

const BOAT_HULLS = [[0.62, 0.14, 0.12], [0.14, 0.3, 0.52], [0.18, 0.4, 0.3], [0.9, 0.9, 0.86], [0.2, 0.22, 0.26], [0.8, 0.52, 0.12]];

function buildBoats(group, count, home = null, fleet = null) {
  const boats = [];
  const boatMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.62,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const wakeTex = foamTexture();
  // What sails here. A map may say (`boatKinds`); otherwise mostly trawlers
  // with the odd yacht, which is what a working island's water holds.
  const kinds = fleet && fleet.length ? fleet : ['trawler', 'yacht', 'trawler', 'yacht', 'trawler', 'ferry'];
  for (let i = 0; i < count; i++) {
    const g = new THREE.Group();
    const kind = kinds[i % kinds.length];
    const hull = new THREE.Mesh(boatGeometry(kind, BOAT_HULLS[(i * 5 + 1) % BOAT_HULLS.length]), boatMat);
    hull.castShadow = true;
    hull.receiveShadow = true;
    g.add(hull);
    const L = kind === 'ferry' ? 34 : kind === 'yacht' ? 12 : 16;
    const wake = new THREE.Mesh(
      new THREE.PlaneGeometry(L * 4.4, L * 1.0),
      new THREE.MeshBasicMaterial({ map: wakeTex, transparent: true, opacity: 0.4, depthWrite: false })
    );
    wake.rotation.x = -Math.PI / 2;
    wake.position.set(-L * 2.4, 0.3, 0);
    g.add(wake);
    // Start them in open water. Maps differ, so walk outwards from the nominal
    // spot until the sea floor is genuinely below us.
    //
    // `boatHome` is where a map wants its fleet. A working harbour with its
    // boats strung three kilometres across the middle of the map is not a
    // fleet, it is three boats that happen to be floating.
    let bx = home ? home[0] - i * 120 : -1400 - i * 900;
    let bz = home ? home[1] + i * 160 : 1800 + i * 1400;
    for (let tries = 0; tries < 40 && heightAt(bx, bz) > -6; tries++) {
      bx -= 260;
      bz += 190;
    }
    g.position.set(bx, 0, bz);
    g.rotation.y = i * 1.2;
    group.add(g);
    const speed = kind === 'ferry' ? 7 : kind === 'yacht' ? 2.5 + (i % 3) * 0.5 : 3 + (i % 3);
    boats.push({ obj: g, speed, phase: i * 2 });
  }
  return boats;
}

/**
 * A military air base: shelters, revetments, blast walls and a radar.
 *
 * The class asked for military aircraft to have somewhere military to fly
 * from, and they were right to — flying a bomber off the same palm-fringed
 * tropical strip the trainer uses rather undercuts it.
 *
 * Everything here is instanced and solid, so the base costs a handful of draw
 * calls and you cannot fly through a blast wall.
 */
/**
 * The lowest and highest ground under an axis-aligned w x d footprint:
 * a 5 x 5 grid of samples, corners included.
 */
function groundSpan(x, z, w, d) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i <= 4; i++) {
    for (let j = 0; j <= 4; j++) {
      const h = heightAt(x - w / 2 + (w * i) / 4, z - d / 2 + (d * j) / 4);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }
  return [lo, hi];
}

function addAirBase(group, base) {
  if (!base) return;
  const { cx = 0, cz = 0 } = base;
  const concrete = new THREE.MeshStandardMaterial({ color: 0x9a9a92, roughness: 0.94, metalness: 0.02 });
  const earth = new THREE.MeshStandardMaterial({ color: 0x7d7355, roughness: 1 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x5c6168, roughness: 0.6, metalness: 0.45 });

  /*
   * Hardened aircraft shelters, in a row off the taxiway.
   *
   * A half-cylinder laid on its side is what a HAS actually is, and it reads
   * as one instantly — which matters more than any amount of detail on it.
   */
  const parkSpots = [];
  const count = base.shelters ?? 8;
  const archGeo = new THREE.CylinderGeometry(13, 13, 30, 14, 1, false, 0, Math.PI);
  archGeo.rotateZ(Math.PI / 2);
  archGeo.rotateY(Math.PI / 2);
  const shelters = new THREE.InstancedMesh(archGeo, concrete, count);
  shelters.castShadow = shelters.receiveShadow = true;
  const d = new THREE.Object3D();
  /*
   * Each on a level concrete pad, at the highest ground under it, rather
   * than at the ground under its middle: on a slope that would put one side
   * in the hill and daylight under the other. Both bases so far stand on
   * the levelled airfield, where this changes nothing; the next one might
   * not. The pads are drawn with the blast walls.
   */
  const pads = [];
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const along = (Math.floor(i / 2) - (count / 4 - 0.5)) * 150;
    const x = cx + along;
    const z = cz + side * (base.spread ?? 620);
    const [glo, ghi] = groundSpan(x, z, 30, 26);
    const y = ghi + 0.15;
    pads.push([x, z, glo - 0.4, y, 31, 27]);
    d.position.set(x, y, z);
    d.rotation.set(0, side > 0 ? 0 : Math.PI, 0);
    d.scale.setScalar(1);
    d.updateMatrix();
    shelters.setMatrixAt(i, d.matrix);
    addObstacleAt(x, z, 30, 26, glo - 0.4, y - glo + 13.4, 'You flew into a hardened shelter');
    // The apron in front of the shelter, facing out. parkJets() uses these.
    parkSpots.push({ x, y, z: z - side * 26, heading: side > 0 ? Math.PI : 0 });
  }
  shelters.instanceMatrix.needsUpdate = true;
  shelters.name = 'airbase-shelters';
  group.add(shelters);

  // Earth revetments: open-ended U-shaped banks for the aircraft that live
  // outside. Three boxes each, which is exactly what a revetment looks like.
  const revs = base.revetments ?? 6;
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  const banks = new THREE.InstancedMesh(wallGeo, earth, revs * 3);
  banks.castShadow = banks.receiveShadow = true;
  let n = 0;
  for (let i = 0; i < revs; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const along = (Math.floor(i / 2) - (revs / 4 - 0.5)) * 170 + 80;
    const bx = cx + along;
    const bz = cz + side * ((base.spread ?? 620) + 210);
    const by = heightAt(bx, bz);
    void by;
    // The side banks run from the back bank's inner face: laid over its ends,
    // the two shared faces at every corner (144 m2 of flicker at Ironhead).
    const pieces = [
      [0, -18, 44, 4],   // back wall, across
      [-20, 1, 4, 34],   // left
      [20, 1, 4, 34],    // right
    ];
    for (const [ox, oz, w, dep] of pieces) {
      // Each bank from under the lowest ground along it to 6 m over the highest.
      const [glo, ghi] = groundSpan(bx + ox, bz + oz * side, w, dep);
      const y0 = glo - 0.3;
      const y1 = ghi + 6;
      d.position.set(bx + ox, (y0 + y1) / 2, bz + oz * side);
      d.rotation.set(0, 0, 0);
      d.scale.set(w, y1 - y0, dep);
      d.updateMatrix();
      banks.setMatrixAt(n++, d.matrix);
      addObstacleAt(bx + ox, bz + oz * side, w, dep, y0, y1 - y0 + 0.6, 'You flew into a revetment');
    }
  }
  banks.instanceMatrix.needsUpdate = true;
  banks.name = 'airbase-revetments';
  group.add(banks);

  // Blast walls along the apron edge.
  const walls = base.walls ?? 14;
  const blast = new THREE.InstancedMesh(wallGeo, concrete, walls + pads.length);
  blast.castShadow = blast.receiveShadow = true;
  for (let i = 0; i < walls; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const along = (Math.floor(i / 2) - (walls / 4 - 0.5)) * 96;
    const wx = cx + along;
    const wz = cz + side * (base.spread ?? 620) * 0.62;
    // 60 m long: from under its lowest ground to 5.2 m over its highest, so
    // on a slope neither end is in the air or the hill.
    const [glo, ghi] = groundSpan(wx, wz, 60, 2.2);
    const y0 = glo - 0.3;
    const y1 = ghi + 5.2;
    d.position.set(wx, (y0 + y1) / 2, wz);
    d.rotation.set(0, 0, 0);
    d.scale.set(60, y1 - y0, 2.2);
    d.updateMatrix();
    blast.setMatrixAt(i, d.matrix);
    addObstacleAt(wx, wz, 60, 2.2, y0, y1 - y0 + 0.4, 'You flew into a blast wall');
  }
  pads.forEach(([x, z, y0, y1, w, dep], k) => {
    d.position.set(x, (y0 + y1) / 2, z);
    d.rotation.set(0, 0, 0);
    d.scale.set(w, y1 - y0, dep);
    d.updateMatrix();
    blast.setMatrixAt(walls + k, d.matrix);
  });
  blast.instanceMatrix.needsUpdate = true;
  blast.name = 'airbase-walls';
  group.add(blast);

  // A radar, which turns. It is the one thing on a base that moves, so it is
  // what tells you the place is alive.
  const rx = cx - (base.radarOffset ?? 900);
  const rz = cz + (base.spread ?? 620) * 1.5;
  const ry = heightAt(rx, rz);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.4, 27.5, 8), steel);
  mast.position.set(rx, ry + 12.25, rz);
  mast.castShadow = true;
  group.add(mast);
  const dish = new THREE.Group();
  const face = new THREE.Mesh(new THREE.BoxGeometry(16, 5, 1.1), steel);
  face.castShadow = true;
  dish.add(face);
  dish.position.set(rx, ry + 27, rz);
  group.add(dish);
  addObstacleAt(rx, rz, 6, 6, ry, 29, 'You flew into the radar');

  /*
   * A fuel farm.
   *
   * Three tanks and a bund. It is here because a base made only of things
   * that hide aeroplanes reads as a diagram of a base — you need one or two
   * pieces of ordinary infrastructure before the place looks like somewhere
   * people work. Tanks are the cheapest such piece: everyone knows what they
   * are from any distance and any angle.
   */
  const fx = cx + (base.radarOffset ?? 900) * 1.15;
  const fz = cz - (base.spread ?? 620) * 1.35;
  const tankMat = new THREE.MeshStandardMaterial({ color: 0xb8bcb4, roughness: 0.72, metalness: 0.28 });
  for (let i = 0; i < 3; i++) {
    const tx = fx + (i - 1) * 46;
    const ty = heightAt(tx, fz);
    // Down to the lowest ground under its 30 m footprint, the top where it was.
    const glo = groundSpan(tx, fz, 26, 26)[0] - 0.3;
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, ty + 13 - glo, 20), tankMat);
    tank.position.set(tx, (glo + ty + 13) / 2, fz);
    tank.castShadow = tank.receiveShadow = true;
    group.add(tank);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(15.4, 15.4, 0.7, 20), steel);
    lid.position.set(tx, ty + 13.2, fz);
    group.add(lid);
    addObstacleAt(tx, fz, 30, 30, ty, 14, 'You flew into the fuel farm');
  }
  // The bund wall around them — a low earth bank, which is what a real one is.
  const bundGeo = new THREE.BoxGeometry(1, 1, 1);
  const bund = new THREE.InstancedMesh(bundGeo, earth, 4);
  const bd = new THREE.Object3D();
  const by = heightAt(fx, fz);
  void by;
  // The ends fit between the long sides: laid over them, the corners shared
  // their tops and faces. And each side follows its own ground.
  const sides = [
    [0, -34, 172, 3],
    [0, 34, 172, 3],
    [-86, 0, 3, 65],
    [86, 0, 3, 65],
  ];
  sides.forEach(([ox, oz, w, dep], i) => {
    const [glo, ghi] = groundSpan(fx + ox, fz + oz, w, dep);
    bd.position.set(fx + ox, (glo - 0.3 + ghi + 3.2) / 2, fz + oz);
    bd.rotation.set(0, 0, 0);
    bd.scale.set(w, ghi + 3.2 - (glo - 0.3), dep);
    bd.updateMatrix();
    bund.setMatrixAt(i, bd.matrix);
  });
  bund.instanceMatrix.needsUpdate = true;
  bund.castShadow = bund.receiveShadow = true;
  bund.name = 'airbase-bund';
  group.add(bund);

  return { dish, parkSpots };
}


/**
 * A working harbour, built on whichever authored flat the map points at.
 *
 * Every other named place in this game is made by scattering objects on a
 * lawn, which is why the town reads as a field of sheds and the delivery pad
 * reads as a target painted on a hillside. A harbour cannot be made that way.
 * A quay is a level edge where the land stops, and the entire point of it is
 * that you can drive along it — so this builder scatters nothing. It reads one
 * rectangle out of MAP.flats, works out which end of it the water is at, and
 * lays the harbour out relative to that: deck, stone lip, bollards, container
 * stacks, a gantry, sheds, and the boats moored along the outer face.
 *
 * That is also why it carries no coordinates of its own and works on any map
 * at any elevation — it builds on whatever height resolveFlats decided the
 * ground actually was. About six draw calls, all primitives, nothing
 * downloaded.
 */
export function addHarbour(group, cfg) {
  if (!cfg) return null;
  const f = getFlat(cfg.flat || 'quay');
  if (!f) {
    // A warning rather than a silent nothing: a harbour whose flat has been
    // renamed is a one-word mistake in the map data, and an empty coastline
    // looks like a rendering bug rather than a typo.
    console.warn(`addHarbour: no flat called "${cfg.flat || 'quay'}" on this map.`);
    return null;
  }

  const rnd = makeRandom(cfg.seed || 808);
  const y = f.y;
  const wide = f.x1 - f.x0 > f.z1 - f.z0;
  const len = wide ? f.x1 - f.x0 : f.z1 - f.z0;
  const wid = wide ? f.z1 - f.z0 : f.x1 - f.x0;

  /*
   * Which way is the sea?
   *
   * A shore flat is authored as a rectangle straddling the coast: one end is
   * on the island, the other hangs over the water. Rather than make the map
   * author state which, sample the natural ground a little past each end and
   * take the lower. That keeps the map data to one rectangle and it stays
   * right if somebody nudges the rectangle later.
   */
  const probe = 180;
  const aX = wide ? f.x0 - probe : f.cx;
  const aZ = wide ? f.cz : f.z0 - probe;
  const bX = wide ? f.x1 + probe : f.cx;
  const bZ = wide ? f.cz : f.z1 + probe;
  const sign = heightAt(bX, bZ) < heightAt(aX, aZ) ? 1 : -1;
  /** Quay-local to world: `u` runs along the quay (+ is seaward), `v` across. */
  const P = (u, v) => (wide
    ? new THREE.Vector3(f.cx + u * sign, y, f.cz + v)
    : new THREE.Vector3(f.cx + v, y, f.cz + u * sign));
  const headingSeaward = wide ? (sign > 0 ? 90 : 270) : (sign > 0 ? 180 : 0);

  /* ------------------------------------------------------------- deck -- */

  const deckTex = asphaltTexture().clone();
  deckTex.needsUpdate = true;
  deckTex.wrapS = deckTex.wrapT = THREE.RepeatWrapping;
  deckTex.repeat.set(len / 24, wid / 24);
  const deckNrm = asphaltNormal().clone();
  deckNrm.needsUpdate = true;
  deckNrm.wrapS = deckNrm.wrapT = THREE.RepeatWrapping;
  deckNrm.repeat.set(len / 24, wid / 24);
  const deckGeo = new THREE.PlaneGeometry(wide ? len : wid, wide ? wid : len);
  deckGeo.rotateX(-Math.PI / 2);
  const deck = new THREE.Mesh(deckGeo, new THREE.MeshStandardMaterial({
    map: deckTex,
    normalMap: deckNrm,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.94,
    metalness: 0.02,
  }));
  // Six centimetres proud, the trick the runway and the apron already use: the
  // ground under it is level but its triangles are not exactly at f.y.
  deck.position.set(f.cx, y + 0.06, f.cz);
  deck.receiveShadow = true;
  group.add(deck);

  /* ---------------------------------------------------------- the edge -- */

  // A stone lip round three sides, so the quay stops at something rather than
  // fading into the water.
  const stone = new THREE.MeshStandardMaterial({ color: 0x9a978e, roughness: 0.95 });
  const lip = (cx, cz, w, d) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.8, d), stone);
    m.position.set(cx, y + 0.24, cz);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  };
  const end = P(len / 2, 0);
  lip(end.x, end.z, wide ? 3 : wid, wide ? wid : 3);
  const sideA = P(0, wid / 2);
  const sideB = P(0, -wid / 2);
  lip(sideA.x, sideA.z, wide ? len : 3, wide ? 3 : len);
  lip(sideB.x, sideB.z, wide ? len : 3, wide ? 3 : len);

  const bollards = Math.max(4, Math.round(len / 34));
  const bMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.42, 0.55, 1.1, 8),
    new THREE.MeshStandardMaterial({ color: 0x2f3438, roughness: 0.7, metalness: 0.3 }),
    bollards * 2
  );
  bMesh.castShadow = true;
  const d3 = new THREE.Object3D();
  let bi = 0;
  for (let i = 0; i < bollards; i++) {
    const u = len / 2 - 14 - (i * (len - 40)) / Math.max(1, bollards - 1);
    for (const v of [wid / 2 - 3.2, -wid / 2 + 3.2]) {
      const p = P(u, v);
      d3.position.set(p.x, y + 0.55, p.z);
      d3.rotation.set(0, 0, 0);
      d3.scale.set(1, 1, 1);
      d3.updateMatrix();
      bMesh.setMatrixAt(bi++, d3.matrix);
    }
  }
  bMesh.count = bi;
  bMesh.instanceMatrix.needsUpdate = true;
  group.add(bMesh);

  /* ------------------------------------------------------- containers -- */

  const nBoxes = cfg.containers || 14;
  const boxes = new THREE.InstancedMesh(
    new THREE.BoxGeometry(6.1, 2.6, 2.44),
    new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0.18 }),
    nBoxes
  );
  boxes.castShadow = boxes.receiveShadow = true;
  const tints = [0xb4432c, 0x2f6ea8, 0x3f7a4a, 0xc9973a, 0x6a5f7e, 0xa8a49a];
  const col = new THREE.Color();
  let ci = 0;
  // Stacked down the landward half, which is where a real yard puts them: the
  // seaward half has to stay clear for the crane and the boats. Only the
  // bottom box of each stack registers an obstacle, covering the full stack
  // height — one box per stack rather than one per container.
  for (let row = 0; ci < nBoxes && row < 8; row++) {
    for (let lane = -1; lane <= 1 && ci < nBoxes; lane++) {
      const high = 1 + ((rnd() * 2.4) | 0);
      for (let k = 0; k < high && ci < nBoxes; k++) {
        const u = -len / 2 + 26 + row * 9.2;
        const v = lane * (wid / 3.2);
        const p = P(u, v);
        d3.position.set(p.x, y + 1.35 + k * 2.68, p.z);
        d3.rotation.set(0, wide ? 0 : Math.PI / 2, 0);
        d3.scale.set(1, 1, 1);
        d3.updateMatrix();
        boxes.setMatrixAt(ci, d3.matrix);
        boxes.setColorAt(ci, col.setHex(tints[(rnd() * tints.length) | 0]));
        ci++;
        if (k === 0) {
          addObstacleAt(p.x, p.z, wide ? 6.4 : 2.8, wide ? 2.8 : 6.4, y, 2.7 * high,
            'You hit a shipping container');
        }
      }
    }
  }
  boxes.count = ci;
  boxes.instanceMatrix.needsUpdate = true;
  if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true;
  if (ci) group.add(boxes);

  /* ------------------------------------------------------------ crane -- */

  const steel = new THREE.MeshStandardMaterial({ color: 0xd8892c, roughness: 0.6, metalness: 0.35 });
  for (let c = 0; c < (cfg.cranes ?? 1); c++) {
    const u = len / 2 - 40 - c * 70;
    const beamY = y + 17;
    for (const v of [wid / 2 - 5, -wid / 2 + 5]) {
      const p = P(u, v);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1.6, 17, 1.6), steel);
      leg.position.set(p.x, y + 8.5, p.z);
      leg.castShadow = true;
      group.add(leg);
      addObstacleAt(p.x, p.z, 2.2, 2.2, y, 17, 'You hit the crane');
    }
    const mid = P(u, 0);
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(wide ? 2.2 : wid + 14, 2.2, wide ? wid + 14 : 2.2), steel);
    beam.position.set(mid.x, beamY, mid.z);
    beam.castShadow = true;
    group.add(beam);
    const trolley = new THREE.Mesh(
      new THREE.BoxGeometry(3, 2.4, 3),
      new THREE.MeshStandardMaterial({ color: 0x39404a, roughness: 0.7 })
    );
    const tp = P(u, wid * 0.18);
    trolley.position.set(tp.x, beamY - 2.4, tp.z);
    trolley.castShadow = true;
    group.add(trolley);
  }

  /* ------------------------------------------------------------ sheds -- */

  /*
   * The sheds. They were grey boxes with a flat lid, the same two on every
   * quay. Now each is a corrugated shed in a working colour — oxide red,
   * harbour blue, faded green, cream — with a pitched roof, a big roller door
   * facing across the quay and a personnel door beside it.
   */
  const SHED_COLOURS = [0x9c4a36, 0x3f6a8a, 0x5d7c5a, 0xd8cfb4, 0x8a8f94];
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.6, metalness: 0.4 });
  const shedRoof = new THREE.MeshStandardMaterial({ color: 0x6f757b, roughness: 0.7, metalness: 0.3, flatShading: true });
  for (let i = 0; i < (cfg.sheds ?? 2); i++) {
    const u = -len / 2 + 14;
    const side = i % 2 ? 1 : -1;
    const v = side * (wid / 2 - 11);
    const p = P(u + i * 2, v);
    const w = wide ? 26 : 15;
    const dp = wide ? 15 : 26;
    const hgt = 7.5;
    const shedMat = new THREE.MeshStandardMaterial({
      map: hangarTexture(),
      color: SHED_COLOURS[(i + (cfg.seed || 0)) % SHED_COLOURS.length],
      roughness: 0.7,
      metalness: 0.25,
    });
    // Cladding in metres, 6 m a tile as on the hangars: one tile a face
    // stretched the ribs four times as wide on the long walls.
    const shedGeo = new THREE.BoxGeometry(w, hgt + 1, dp);
    const suv = shedGeo.attributes.uv;
    const faceSize = [[dp, hgt + 1], [dp, hgt + 1], [w, dp], [w, dp], [w, hgt + 1], [w, hgt + 1]];
    for (let k = 0; k < suv.count; k++) {
      const [fu, fv] = faceSize[Math.floor(k / 4)];
      suv.setXY(k, (suv.getX(k) * fu) / 6, (suv.getY(k) * fv) / 6);
    }
    const shed = new THREE.Mesh(shedGeo, shedMat);
    shed.position.set(p.x, y + (hgt - 1) / 2, p.z);
    shed.castShadow = shed.receiveShadow = true;
    group.add(shed);
    // Ridge along the shed's long side.
    const roof = new THREE.Mesh(gableGeometry(), shedRoof);
    roof.position.set(p.x, y + hgt, p.z);
    roof.rotation.y = wide ? Math.PI / 2 : 0;
    roof.scale.set(15 + 1.2, 4.2, 26 + 1.2);
    roof.castShadow = true;
    group.add(roof);
    // The doors, on the face towards the middle of the quay.
    const face = P(u + i * 2, v - side * (wide ? dp : w) / 2 - side * 0.3);
    const roller = new THREE.Mesh(new THREE.BoxGeometry(wide ? 9 : 0.4, 5.6, wide ? 0.4 : 9), doorMat);
    roller.position.set(face.x, y + 2.8, face.z);
    group.add(roller);
    const small = P(u + i * 2 + 8, v - side * (wide ? dp : w) / 2 - side * 0.3);
    const pdoor = new THREE.Mesh(new THREE.BoxGeometry(wide ? 1.2 : 0.4, 2.3, wide ? 0.4 : 1.2), doorMat);
    pdoor.position.set(small.x, y + 1.15, small.z);
    group.add(pdoor);
    addObstacleAt(p.x, p.z, w, dp, y, hgt + 4.4, 'You hit the harbour shed');
  }

  /* ------------------------------------------------------------ boats -- */

  // createFishingBoat has been in the fleet since the maritime models landed
  // and was imported by absolutely nothing. A harbour is what it was for.
  const moored = [];
  for (let i = 0; i < (cfg.moored ?? 2); i++) {
    let boat;
    try {
      boat = createFishingBoat({ color: i % 2 ? '#5d6860' : '#7d6a52' });
    } catch (e) {
      console.warn('Could not build a fishing boat for the harbour.', e);
      break;
    }
    const p = P(len / 2 - 24 - i * 16, (wid / 2 + 6) * (i % 2 ? -1 : 1));
    boat.position.set(p.x, 0, p.z);
    boat.rotation.y = ((headingSeaward + 90) * Math.PI) / 180;
    group.add(boat);
    moored.push(boat);
  }

  return {
    flat: f,
    deck,
    moored,
    /** Where the van is loaded: the middle of the landward half. */
    loadPoint: P(-len / 4, 0),
    headingSeaward,
  };
}

/**
 * Glue coloured, already-positioned geometries into one, so a whole fleet of
 * moored boats is one draw call.
 */
function mergeColoured(geos) {
  const pos = [];
  const nrm = [];
  const col = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.attributes.position.array);
    nrm.push(...g.attributes.normal.array);
    col.push(...g.attributes.color.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

/**
 * A harbour described point by point rather than built on a quay flat.
 *
 * Cutter Bay's map has always carried a breakwater, seven moorings, a fishing
 * fleet of four and a fuel jetty, and its card promises all of them — and
 * nothing read any of it. `new Scenery()` handed the block to addHarbour(),
 * which wants a flat called 'quay', logged "no flat called quay" and built
 * nothing, on every load. So the bay had a lighthouse and some water.
 *
 * This builds what the data says:
 *   breakwater  a stone wall along `links`, armoured both sides with rubble,
 *               and a light on its head
 *   moorings    a buoy on each, with a yacht on every other one
 *   fishingFleet trawlers lying at their spots
 *   fuelJetty   a planked deck on piles from `base` to `tip`, with a pump
 * About six draw calls. The breakwater is also solid ground now — see the
 * shoals under Cutter Bay in maps.js, which were seven separate rocks with
 * thirteen metres of water between each pair.
 */
export function addHarbourDressing(group, cfg) {
  if (!cfg) return null;
  const d = new THREE.Object3D();
  const out = { links: 0, moorings: 0, boats: 0, jetty: false };
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x9a978e, roughness: 0.95 });

  /* ---- the breakwater ---- */
  const links = (cfg.breakwater && cfg.breakwater.links) || [];
  if (links.length > 1) {
    const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), stoneMat, links.length - 1);
    const rocks = [];
    const rnd = makeRandom(9127);
    for (let i = 1; i < links.length; i++) {
      const [ax, az] = links[i - 1];
      const [bx, bz] = links[i];
      const len = Math.hypot(bx - ax, bz - az);
      const rot = Math.atan2(-(bz - az), bx - ax);
      d.position.set((ax + bx) / 2, 0.6, (az + bz) / 2);
      d.rotation.set(0, rot, 0);
      d.scale.set(len + 2, 7.2, 11);
      d.updateMatrix();
      walls.setMatrixAt(i - 1, d.matrix);
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      for (let s = 0; s < len; s += 9) {
        for (const side of [-1, 1]) {
          const off = 7 + rnd() * 5;
          rocks.push([ax + ux * s - uz * off * side, 0.2 + rnd() * 1.4, az + uz * s + ux * off * side, 2.2 + rnd() * 2.6, rnd() * 6]);
        }
      }
      for (let s = 0; s < len; s += 20) {
        addObstacleAt(ax + ux * s, az + uz * s, 16, 16, -3, 7.5, 'You flew into the breakwater');
      }
    }
    walls.instanceMatrix.needsUpdate = true;
    walls.castShadow = walls.receiveShadow = true;
    group.add(walls);
    const rock = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x7f7c74, roughness: 1, flatShading: true }), rocks.length);
    rocks.forEach(([x, y, z, s, r], i) => {
      d.position.set(x, y, z);
      d.rotation.set(r, r * 1.7, r * 0.6);
      d.scale.set(s, s * 0.7, s);
      d.updateMatrix();
      rock.setMatrixAt(i, d.matrix);
    });
    rock.instanceMatrix.needsUpdate = true;
    rock.castShadow = rock.receiveShadow = true;
    group.add(rock);
    // The light on the head: a short white tower with a green lantern, the
    // mark a boat coming in keeps to starboard.
    const [hx, hz] = links[links.length - 1];
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 7, 12), new THREE.MeshStandardMaterial({ color: 0xf0f0ec, roughness: 0.7 }));
    tower.position.set(hx, 7.5, hz);
    tower.castShadow = true;
    group.add(tower);
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.4, 10), new THREE.MeshStandardMaterial({ color: 0x1d6b35, emissive: 0x2cff6a, emissiveIntensity: 1.2 }));
    lantern.position.set(hx, 11.7, hz);
    group.add(lantern);
    out.headLamp = lantern.material;
    out.links = links.length;
  }

  /* ---- moorings, the fleet and the boats on them ---- */
  const boats = [];
  const moorings = cfg.moorings || [];
  if (moorings.length) {
    const buoy = new THREE.InstancedMesh(new THREE.SphereGeometry(0.9, 10, 6), new THREE.MeshStandardMaterial({ color: 0xe8702a, roughness: 0.6 }), moorings.length);
    moorings.forEach(([x, z], i) => {
      d.position.set(x, 0.3, z);
      d.rotation.set(0, 0, 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      buoy.setMatrixAt(i, d.matrix);
      if (i % 2 === 0) boats.push({ kind: 'yacht', x: x - 9, z, rot: 0.4 + i * 0.9, colour: BOAT_HULLS[3] });
    });
    buoy.instanceMatrix.needsUpdate = true;
    group.add(buoy);
    out.moorings = moorings.length;
  }
  const fleet = (cfg.fishingFleet && cfg.fishingFleet.boats) || [];
  fleet.forEach(([x, z], i) => boats.push({ kind: 'trawler', x, z, rot: 2.2 + i * 0.35, colour: BOAT_HULLS[i % 3] }));
  if (boats.length) {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const geos = boats.map((b) => {
      const g = boatGeometry(b.kind, b.colour);
      m4.compose(new THREE.Vector3(b.x, 0, b.z), q.setFromAxisAngle(up, b.rot), new THREE.Vector3(1, 1, 1));
      return g.applyMatrix4(m4);
    });
    const mesh = new THREE.Mesh(mergeColoured(geos), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05, side: THREE.DoubleSide }));
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    out.boats = boats.length;
  }

  /* ---- the fuel jetty ---- */
  const J = cfg.fuelJetty;
  if (J) {
    const len = Math.hypot(J.tipX - J.baseX, J.tipZ - J.baseZ);
    const rot = Math.atan2(-(J.tipZ - J.baseZ), J.tipX - J.baseX);
    const w = J.width || 12;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 0.6, w), new THREE.MeshStandardMaterial({ color: 0x8a6d4c, roughness: 0.9 }));
    deck.position.set((J.baseX + J.tipX) / 2, 2.6, (J.baseZ + J.tipZ) / 2);
    deck.rotation.y = rot;
    deck.castShadow = deck.receiveShadow = true;
    group.add(deck);
    const n = Math.max(2, Math.round(len / 10));
    const piles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.35, 1, 6), new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1 }), n * 2);
    const ux = (J.tipX - J.baseX) / len;
    const uz = (J.tipZ - J.baseZ) / len;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const s = ((i + 0.5) / n) * len;
      for (const side of [-1, 1]) {
        const px = J.baseX + ux * s - uz * (w / 2 - 0.6) * side;
        const pz = J.baseZ + uz * s + ux * (w / 2 - 0.6) * side;
        const ground = Math.min(0, heightAt(px, pz));
        d.position.set(px, (ground + 2.4) / 2, pz);
        d.rotation.set(0, 0, 0);
        d.scale.set(1, 2.4 - ground, 1);
        d.updateMatrix();
        piles.setMatrixAt(k++, d.matrix);
      }
    }
    piles.instanceMatrix.needsUpdate = true;
    group.add(piles);
    const pump = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, 1.0), new THREE.MeshStandardMaterial({ color: 0xc8352a, roughness: 0.5 }));
    pump.position.set(J.tipX - ux * 4, 4, J.tipZ - uz * 4);
    pump.rotation.y = rot;
    group.add(pump);
    out.jetty = true;
  }
  return out;
}

/**
 * The nearest dry ground to a point, or null within `reach`.
 *
 * Nine of the thirty-two maps put their lighthouse in open water — three of
 * them original maps, one of them forty metres under — and four put their town
 * centre on a hilltop outside the town's own declared height band, so the
 * scatter found nowhere to stand a building and the town was silently empty.
 * Both are the same mistake: a coordinate chosen by eye against a coastline
 * that is made of noise. Rather than hand-correct twelve coordinates that will
 * drift again the next time somebody retunes an island, the builders ask.
 */
function nearestLand(x, z, minH = 2, reach = 3200) {
  if (heightAt(x, z) >= minH) return { x, z };
  for (let r = 80; r <= reach; r += 80) {
    let best = null;
    for (let a = 0; a < 24; a++) {
      const ang = (a * Math.PI) / 12;
      const px = x + Math.sin(ang) * r;
      const pz = z - Math.cos(ang) * r;
      const h = heightAt(px, pz);
      if (h >= minH && (!best || h < best.h)) best = { x: px, z: pz, h };
    }
    // The LOWEST land that qualifies, at the smallest radius that has any —
    // which is the shoreline, and a lighthouse belongs on the shoreline.
    if (best) return { x: best.x, z: best.z };
  }
  return null;
}

/**
 * A weapons range you can actually see.
 *
 * The mission has always said "a marked practice range with a bullseye", and
 * there was never anything there. The target was a bare coordinate in
 * missions.js, and on this map that coordinate fell fifty metres off the end
 * of the plain — you flew seven kilometres to an unmarked patch of open sea
 * and dropped a practice bomb into it. Nothing marked the middle, so "twelve
 * metres from the middle" was a number about a place you could not see.
 *
 * So: painted rings, corner markers, three wrecked hulks to aim at and a
 * scoring tower off to the side. The rings are displaced onto the ground
 * rather than laid on a flat disc, because nothing out here is flat, and a
 * bullseye floating over a slope would be worse than none.
 *
 * The range publishes where its middle is, and the mission asks — the same
 * arrangement as the carrier, and for the same reason: a mission carrying its
 * own copy of a coordinate is a mission that silently points at empty ground
 * the day anything moves.
 */
function addWeaponsRange(group, cfg) {
  if (!cfg) return null;
  const { cx, cz } = cfg;
  const R = cfg.radius ?? 130;
  const paint = (color, emissive = 0) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.98,
      metalness: 0,
      emissive,
      // Sit on the ground rather than fighting it for the same pixels.
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
  const white = paint(0xe8e6dc);
  const red = paint(0xb2342c);
  const rust = new THREE.MeshStandardMaterial({ color: 0x6b5344, roughness: 1, metalness: 0.05 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x5c6168, roughness: 0.6, metalness: 0.45 });

  /** Lay a flat ring on the ground, following it. */
  const band = (inner, outer, mat) => {
    const geo =
      inner > 0
        ? new THREE.RingGeometry(inner, outer, 64, 1)
        : new THREE.CircleGeometry(outer, 64);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, heightAt(cx + pos.getX(i), cz + pos.getZ(i)) + 0.14);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.position.set(cx, 0, cz);
    m.receiveShadow = true;
    group.add(m);
  };
  band(R * 0.72, R, white);
  band(R * 0.46, R * 0.6, red);
  band(R * 0.24, R * 0.34, white);
  band(0, R * 0.12, red);

  // Corner markers, so the range reads as a marked place from any height.
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const mx = cx + sx * R * 1.12;
    const mz = cz + sz * R * 1.12;
    const my = heightAt(mx, mz);
    const post = new THREE.Mesh(new THREE.BoxGeometry(2.4, 7, 2.4), white);
    post.position.set(mx, my + 3.5, mz);
    post.castShadow = true;
    group.add(post);
  }

  /*
   * Three hulks in the middle: something to aim at rather than a patch of
   * paint. Deliberately not solid — they are what you are trying to hit, and
   * a ten-year-old flying a low pass over the range should not be killed by
   * the scenery for doing exactly what they were asked to do.
   */
  const hulks = [
    [-22, 14, 0.6],
    [18, -9, 2.2],
    [6, 26, 3.9],
  ];
  for (const [ox, oz, rot] of hulks) {
    const hx = cx + ox;
    const hz = cz + oz;
    const hy = heightAt(hx, hz);
    const body = new THREE.Mesh(new THREE.BoxGeometry(7.2, 2.4, 3.6), rust);
    body.position.set(hx, hy + 1.2, hz);
    body.rotation.y = rot;
    body.castShadow = body.receiveShadow = true;
    group.add(body);
    const turret = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 1.3, 8), rust);
    turret.position.set(hx, hy + 3, hz);
    turret.castShadow = true;
    group.add(turret);
  }

  // The scoring tower, well clear of the pattern.
  const tx = cx + R * 2.1;
  const tz = cz - R * 1.6;
  const ty = heightAt(tx, tz);
  // Each leg down to the ground under it: stood on the ground under the
  // middle, the downhill legs were in the air (the ground under Ironhead's
  // tower falls 1.4 m across it).
  for (const [lx, lz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
    const gy = heightAt(tx + lx, tz + lz) - 0.5;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, ty + 11 - gy, 6), steel);
    leg.position.set(tx + lx, (gy + ty + 11) / 2, tz + lz);
    group.add(leg);
  }
  const cab = new THREE.Mesh(new THREE.BoxGeometry(9, 3.4, 9), steel);
  cab.position.set(tx, ty + 12.7, tz);
  cab.castShadow = true;
  group.add(cab);
  const tLo = groundSpan(tx, tz, 9, 9)[0];
  addObstacleAt(tx, tz, 9, 9, tLo, ty - tLo + 15, 'You flew into the range tower');

  return { pos: new THREE.Vector3(cx, heightAt(cx, cz), cz) };
}

/** A downtown block, street centre to street centre. */
const DOWNTOWN_BLOCK = 110;

/** Squared distance from a point to a segment. */
function segDist2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const L2 = dx * dx + dz * dz;
  let t = L2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px;
  const qz = az + dz * t - pz;
  return qx * qx + qz * qz;
}

/** Do two turned rectangles overlap (with `gap` of air required between)? */
function rectsOverlap(a, b, gap) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  if (dx * dx + dz * dz > (a.r + b.r + gap) ** 2) return false;
  for (const [ax, az] of [[a.ux, a.uz], [a.vx, a.vz], [b.ux, b.uz], [b.vx, b.vz]]) {
    const dist = Math.abs(dx * ax + dz * az);
    const ra = a.hw * Math.abs(a.ux * ax + a.uz * az) + a.hd * Math.abs(a.vx * ax + a.vz * az);
    const rb = b.hw * Math.abs(b.ux * ax + b.uz * az) + b.hd * Math.abs(b.vx * ax + b.vz * az);
    if (dist > ra + rb + gap) return false;
  }
  return true;
}

/**
 * Lay a town out along streets.
 *
 * A town was `scatter()` — N points dropped at random in a circle, each
 * building at a random angle — which from the air is not a town but a spill:
 * no street, no frontage, nothing lined up with anything. This is the
 * order a real place has, cheaply:
 *
 *   streets    where the map's own roads run through the town (every
 *              driving map, and Kestrel's waist road), those ARE the
 *              streets, and nothing else is invented — a street the van
 *              cannot drive down would be a lie on a courier map. Anywhere
 *              else a high street is grown through the centre, curving
 *              gently and stopping at the shore, the airfield, a slope
 *              over 16% or a road it meets, with side streets branching
 *              off it until there is frontage for the whole town.
 *   downtown   where the map asks for towers, a grid of straight streets
 *              round the centre and one tower to a block, tallest in the
 *              middle and never within 120 m of a helipad
 *   frontage   houses along both sides of every street, facing it, set
 *              back behind a pavement, shoulder to shoulder with a gap;
 *              taller blocks towards the middle
 *
 * Every building is checked against everything that has gone wrong with
 * towns before: its ground has to be in the town's height band and dry
 * under all four corners, the footprint no steeper than 30%, clear of both
 * runway pads and the main approach corridor AND the crosswind one, off
 * the tarmac and gravel flats, off every road and street, clear of every
 * helipad, courier address, the lighthouse and the delivery pad, and not
 * overlapping another building. The generated streets are then trimmed
 * back to the last house on them, so none of them runs off into a field.
 *
 * `pool` is the old scatter, kept as the fill: if the streets cannot hold
 * the whole count (a town on a knife-edge ridge), the rest stand where the
 * scatter put them, subject to the same checks.
 */
function layTown(cfg, count, pool) {
  const R = cfg.radius;
  let cx = cfg.cx;
  let cz = cfg.cz;
  const rnd = makeRandom(((Math.abs(Math.round(cx * 13 + cz * 7)) % 100000) + 17) | 0);
  const minH = Math.max(1.5, cfg.minH ?? 0);
  const maxH = cfg.maxH ?? 1e9;
  const R2 = AIRPORT.runway2;
  const r2AlongX = R2 && Math.abs((((R2.headingDeg ?? 180) % 180) - 90)) < 45;
  const inCorridor = (x, z) => {
    const rw = AIRPORT.runway;
    if (Math.abs(x - rw.cx) < CORRIDOR.length && Math.abs(z - rw.cz) < CORRIDOR.halfWidth) return true;
    if (R2) {
      const along = r2AlongX ? Math.abs(x - R2.cx) : Math.abs(z - R2.cz);
      const across = r2AlongX ? Math.abs(z - R2.cz) : Math.abs(x - R2.cx);
      if (along < CORRIDOR2.length && across < CORRIDOR2.halfWidth) return true;
    }
    return false;
  };
  const madeGround = (x, z) => {
    const f = flatAt(x, z);
    return !!(f && f.clear);
  };

  /* ---- what has to be kept clear ---- */
  const roadSegs = [];
  for (const r of (MAP.waters && MAP.waters.roads) || []) {
    const hw = r.halfWidth || 18;
    for (let i = 1; i < r.path.length; i++) {
      const a = r.path[i - 1];
      const b = r.path[i];
      roadSegs.push([a[0], a[1], b[0], b[1], hw]);
    }
  }
  const nearRoad = (x, z, pad) => roadSegs.some(([ax, az, bx, bz, hw]) => segDist2(x, z, ax, az, bx, bz) < (hw + pad) ** 2);
  const keepClear = [];
  for (const p of padsOf(MAP)) keepClear.push([p.x, p.z, p.kind === 'roof' ? (p.r || 11) * 1.25 + 12 : (p.r || 11) + 16, true]);
  for (const p of (MAP.courier && MAP.courier.places) || []) keepClear.push([p.x, p.z, 32, false]);
  const sc = MAP.scenery || {};
  // The delivery strip is a 240 x 44 m rectangle running east-west (see
  // buildDeliveryPad); keep its length clear, not a 150 m disc round it,
  // which emptied the Rigs' village.
  const strip = sc.deliveryPad || null;
  try {
    const lh = lighthouseSpot(MAP);
    keepClear.push([lh.x, lh.z, 34, false]);
  } catch (e) {
    /* no lighthouse to keep clear of */
  }
  const pads = keepClear.filter((k) => k[3]);

  /* ---- streets ---- */
  const streets = [];
  const streetSegs = [];
  const addStreet = (pts, hw, drawn) => {
    if (pts.length < 2) return null;
    const st = { pts, hw, drawn, high: false, used: [Infinity, -Infinity] };
    streets.push(st);
    for (let i = 1; i < pts.length; i++) streetSegs.push([pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], hw, st]);
    return st;
  };
  // The roads through town, clipped to it.
  for (const r of (MAP.waters && MAP.waters.roads) || []) {
    let run = [];
    for (const p of r.path) {
      if ((p[0] - cx) ** 2 + (p[1] - cz) ** 2 < (R * 1.15) ** 2) run.push([p[0], p[1]]);
      else {
        if (run.length > 1) streets.push({ pts: run, hw: (r.halfWidth || 18) + 1, drawn: false, road: true, used: [Infinity, -Infinity] });
        run = [];
      }
    }
    if (run.length > 1) streets.push({ pts: run, hw: (r.halfWidth || 18) + 1, drawn: false, road: true, used: [Infinity, -Infinity] });
  }
  const carMap = !!(MAP.courier || MAP.game === 'car');
  const STEP = 18;
  const streetOK = (x, z) => heightAt(x, z) >= 2.5
    && (x - cx) ** 2 + (z - cz) ** 2 <= (R * 1.08) ** 2
    && padWeight(x, z) === 0 && !inCorridor(x, z) && !madeGround(x, z)
    && !pads.some(([px, pz, r]) => (px - x) ** 2 + (pz - z) ** 2 < (r + 8) ** 2);
  /** Grow a street from (x, z) along angle `ang` (radians, x-z plane). */
  const grow = (x, z, ang, maxLen, wiggle = 0.09) => {
    const pts = [[x, z]];
    if (!streetOK(x, z)) return pts;
    let turn = 0;
    let len = 0;
    let py = heightAt(x, z);
    while (len < maxLen) {
      turn = turn * 0.8 + (rnd() - 0.5) * wiggle;
      ang += turn;
      const nx = x + Math.cos(ang) * STEP;
      const nz = z + Math.sin(ang) * STEP;
      if (!streetOK(nx, nz)) break;
      const ny = heightAt(nx, nz);
      if (Math.abs(ny - py) / STEP > 0.16) break;
      pts.push([nx, nz]);
      x = nx;
      z = nz;
      py = ny;
      len += STEP;
      // A street that reaches a road joins it and stops.
      if (roadSegs.length && nearRoad(nx, nz, 2)) break;
    }
    return pts;
  };
  /** A point, its unit tangent and the heading at arc length s along pts. */
  const along = (pts, s) => {
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1];
      const [bx, bz] = pts[i];
      const L = Math.hypot(bx - ax, bz - az);
      if (s <= L || i === pts.length - 1) {
        const t = L > 0 ? Math.min(1, s / L) : 0;
        return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, tx: (bx - ax) / (L || 1), tz: (bz - az) / (L || 1), i };
      }
      s -= L;
    }
    return null;
  };
  const lengthOf = (pts) => {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return L;
  };

  const towersWanted = Math.max(0, cfg.towers | 0);
  let gridTheta = 0;
  if (!carMap) {
    // A centre the street can actually start from.
    if (!streetOK(cx, cz)) {
      const alt = pool.map((p) => p).sort((a, b) => ((a.x - cx) ** 2 + (a.z - cz) ** 2) - ((b.x - cx) ** 2 + (b.z - cz) ** 2)).find((p) => streetOK(p.x, p.z));
      if (alt) {
        cx = alt.x;
        cz = alt.z;
      }
    }
    if (streetOK(cx, cz)) {
      const theta = cfg.streetDeg != null ? (cfg.streetDeg * Math.PI) / 180 : rnd() * Math.PI;
      // Straight through a downtown grid; a village street wanders.
      const wig = towersWanted ? 0.015 : 0.09;
      // Short enough that the side streets are where most people live: a
      // village is a knot of streets, not one long road with houses on it.
      const reach = R * (towersWanted ? 0.8 : 0.55);
      const a = grow(cx, cz, theta, reach, wig);
      const b = grow(cx, cz, theta + Math.PI, reach, wig);
      const high = a.reverse().concat(b.slice(1));
      const main = addStreet(high, towersWanted ? 7 : 5.5, true);
      if (main) main.high = true;
      const target = count * (towersWanted ? 9 : 6.5);
      let total = main ? lengthOf(high) : 0;
      // Downtown: a grid of straight streets round the centre.
      if (main && towersWanted) {
        const SP = DOWNTOWN_BLOCK;
        const k = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(towersWanted / 2) / 2)));
        gridTheta = theta;
        const ux = Math.cos(theta);
        const uz = Math.sin(theta);
        for (let j = -k; j <= k; j++) {
          if (j === 0) continue;
          for (const dir of [1, -1]) {
            const pts = grow(cx - uz * j * SP, cz + ux * j * SP, theta + (dir < 0 ? Math.PI : 0), k * SP + 20, 0);
            if (pts.length > 2) { addStreet(pts, 6, true).downtown = true; total += lengthOf(pts); }
          }
        }
        for (let i = -k; i <= k; i++) {
          for (const dir of [1, -1]) {
            const pts = grow(cx + ux * i * SP, cz + uz * i * SP, theta + Math.PI / 2 + (dir < 0 ? Math.PI : 0), k * SP + 20, 0);
            if (pts.length > 2) { addStreet(pts, 6, true).downtown = true; total += lengthOf(pts); }
          }
        }
      }
      // Side streets off the high street, then off each other, until there
      // is frontage enough.
      const parents = main ? [main] : [];
      // And never fewer than a handful, however long the high street came out.
      const minSides = Math.min(6, Math.floor(count / 12));
      let sides = 0;
      const more = () => total < target || sides < minSides;
      for (let gen = 0; gen < 3 && more() && parents.length; gen++) {
        const next = [];
        for (const par of parents) {
          const L = lengthOf(par.pts);
          for (let s = 30 + rnd() * 40; s < L - 25 && more(); s += 70 + rnd() * 70) {
            const p = along(par.pts, s);
            if (!p) break;
            const side = rnd() < 0.5 ? -1 : 1;
            const ang = Math.atan2(p.tz, p.tx) + side * (Math.PI / 2 + (rnd() - 0.5) * 0.7);
            const pts = grow(p.x, p.z, ang, R * (0.22 + rnd() * 0.3));
            if (pts.length > 3) {
              const st = addStreet(pts, 4.5, true);
              total += lengthOf(pts);
              sides++;
              next.push(st);
            }
          }
        }
        parents.length = 0;
        parents.push(...next);
      }
    }
  }

  /* ---- buildings ---- */
  const placed = [];
  const grid = new Map();
  const CELL = 60;
  const cellKey = (i, j) => i * 100003 + j;
  /*
   * Every road and street segment, bucketed by the 60 m cells its corridor
   * touches, so a building corner is tested against the handful of segments
   * near it rather than all of them. Town's 260 houses along its own roads
   * took 66 ms laid out against every segment; this is what keeps a
   * Chromebook's world build from paying that several times over.
   */
  const segGrid = new Map();
  const clearOf = [];
  for (const [ax, az, bx, bz, hw] of roadSegs) clearOf.push([ax, az, bx, bz, hw + 1.5]);
  for (const [ax, az, bx, bz, hw] of streetSegs) clearOf.push([ax, az, bx, bz, hw + 0.8]);
  for (const sg of clearOf) {
    const [ax, az, bx, bz, need] = sg;
    const i0 = Math.floor((Math.min(ax, bx) - need) / CELL);
    const i1 = Math.floor((Math.max(ax, bx) + need) / CELL);
    const j0 = Math.floor((Math.min(az, bz) - need) / CELL);
    const j1 = Math.floor((Math.max(az, bz) + need) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = cellKey(i, j);
        if (!segGrid.has(k)) segGrid.set(k, []);
        segGrid.get(k).push(sg);
      }
    }
  }
  const onSomeStreet = (px, pz) => {
    const list = segGrid.get(cellKey(Math.floor(px / CELL), Math.floor(pz / CELL)));
    if (!list) return false;
    for (const [ax, az, bx, bz, need] of list) if (segDist2(px, pz, ax, az, bx, bz) < need * need) return true;
    return false;
  };
  const tryPlace = (x, z, w, d, rot, kind, h, st, arcI, gap = kind === 'house' ? 1.2 : 3) => {
    // Cheapest tests first: most plots fail on the height band or on a
    // neighbour, and neither needs the four corner samples.
    const hc = heightAt(x, z);
    if (!(hc >= minH && hc <= maxH)) return false;
    const ux = Math.cos(rot);
    const uz = -Math.sin(rot);
    const vx = Math.sin(rot);
    const vz = Math.cos(rot);
    const hw = w / 2;
    const hd = d / 2;
    const r = Math.hypot(hw, hd);
    for (const [px, pz, clear] of keepClear) if ((px - x) ** 2 + (pz - z) ** 2 < (clear + r * 0.6) ** 2) return false;
    if (strip && Math.abs(x - strip[0]) < 134 + r && Math.abs(z - strip[1]) < 36 + r) return false;
    if (kind === 'tower' && pads.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < 120 * 120)) return false;
    const rect = { x, z, ux, uz, vx, vz, hw, hd, r };
    const ci = Math.floor(x / CELL);
    const cj = Math.floor(z / CELL);
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        const list = grid.get(cellKey(i, j));
        if (list && list.some((o) => rectsOverlap(rect, o, gap))) return false;
      }
    }
    if (padWeight(x, z) > 0 || inCorridor(x, z)) return false;
    let lo = hc;
    let hi = hc;
    for (const [a, b] of [[hw, hd], [-hw, hd], [hw, -hd], [-hw, -hd]]) {
      const px = x + ux * a + vx * b;
      const pz = z + uz * a + vz * b;
      if (onSomeStreet(px, pz)) return false;
      if (padWeight(px, pz) > 0 || inCorridor(px, pz) || madeGround(px, pz)) return false;
      const hp = heightAt(px, pz);
      if (hp < 1.2) return false;
      lo = Math.min(lo, hp);
      hi = Math.max(hi, hp);
    }
    if ((hi - lo) / Math.hypot(w, d) > 0.3) return false;
    const key = cellKey(ci, cj);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(rect);
    placed.push({ x, z, y: hc, lo, rot, kind, w, d, h, scale: 1 });
    if (st && arcI != null) {
      st.used[0] = Math.min(st.used[0], arcI);
      st.used[1] = Math.max(st.used[1], arcI);
    }
    return true;
  };

  // Towers first, one to a downtown block, nearest the centre first.
  if (towersWanted && streets.length) {
    const ux = Math.cos(gridTheta);
    const uz = Math.sin(gridTheta);
    const SP = DOWNTOWN_BLOCK;
    const slots = [];
    // Two to a block, side by side along the block's long way.
    for (let i = -4; i < 4; i++) {
      for (let j = -4; j < 4; j++) {
        for (const e of [-0.24, 0.24]) {
          const a = (i + 0.5 + e) * SP;
          const b = (j + 0.5) * SP;
          slots.push({ x: cx + ux * a - uz * b, z: cz + uz * a + ux * b, d: a * a + b * b });
        }
      }
    }
    slots.sort((p, q) => p.d - q.d);
    let rank = 0;
    for (const sl of slots) {
      if (rank >= towersWanted) break;
      const t = 1 - rank / Math.max(1, towersWanted);
      const q = rnd();
      const h = 60 + (Math.max(60, cfg.towerMaxH || 150) - 60) * Math.pow(t, 1.25) * (0.72 + 0.28 * q);
      if (tryPlace(sl.x, sl.z, 26 + rnd() * 12, 24 + rnd() * 10, Math.atan2(-uz, ux), 'tower', h)) rank++;
    }
  }

  /*
   * Frontage. Every street, both sides, offers a plot every six metres; the
   * plots are tried nearest the centre first, whatever street they are on,
   * so the town fills outwards from its middle along all of its streets at
   * once and the outer ends are what is left empty (and then trimmed). The
   * overlap test is what spaces the houses: a gap of 1.5 to 6 m, drawn per
   * house, so a street is neither a terrace nor evenly spaced.
   */
  const want = count;
  const plots = [];
  for (const st of streets) {
    const L = lengthOf(st.pts);
    for (const side of [-1, 1]) {
      for (let s = 3 + rnd() * 6; s < L - 3; s += 6) {
        const p = along(st.pts, s);
        if (!p) break;
        plots.push({ st, side, p, d: (p.x - cx) ** 2 + (p.z - cz) ** 2 + rnd() * 900 });
      }
    }
  }
  plots.sort((a, b) => a.d - b.d);
  for (const { st, side, p } of plots) {
    if (placed.length >= want) break;
    const dc = Math.hypot(p.x - cx, p.z - cz) / R;
    // A city has mid-rise blocks round its towers; a village has a few
    // taller buildings on its square and houses everywhere else.
    const pBlock = towersWanted ? (dc < 0.3 ? 0.65 : dc < 0.5 ? 0.35 : 0.08) : (dc < 0.25 ? 0.3 : dc < 0.45 ? 0.14 : 0.03);
    const kind = rnd() < pBlock ? 'block' : 'house';
    const w = kind === 'house' ? 7.5 + rnd() * 5 : 13 + rnd() * 9;
    const d = kind === 'house' ? 8 + rnd() * 4 : 11 + rnd() * 6;
    const h = kind === 'house' ? 5.2 + rnd() * 3.8
      : towersWanted ? 14 + rnd() * 20 + (dc < 0.25 ? 10 : 0) : 9 + rnd() * 9 + (dc < 0.2 ? 4 : 0);
    const off = st.hw + 2.5 + rnd() * 2.5 + d / 2;
    const x = p.x - p.tz * off * side;
    const z = p.z + p.tx * off * side;
    tryPlace(x, z, w, d, Math.atan2(-p.tz, p.tx), kind, h, st, p.i, 1.5 + rnd() * 4.5);
  }

  // Whatever the streets could not hold, where the scatter put it — nearest
  // a street first, and squared up to that street, so the second row of a
  // town lines up with the first instead of lying at random angles.
  const segs = roadSegs.concat(streetSegs);
  const fill = pool.map((p) => {
    let best = Infinity;
    let rot = p.rot;
    for (const [ax, az, bx, bz] of segs) {
      const d2 = segDist2(p.x, p.z, ax, az, bx, bz);
      if (d2 < best) {
        best = d2;
        rot = Math.atan2(-(bz - az), bx - ax);
      }
    }
    return { p, rot: best < 150 * 150 ? rot : p.rot, d: best };
  }).sort((a, b) => a.d - b.d);
  for (const { p, rot } of fill) {
    if (placed.length >= want) break;
    const q = rnd();
    tryPlace(p.x, p.z, 7.5 + q * 5, 8 + rnd() * 4, rot, 'house', 5.2 + rnd() * 3.8);
  }

  // Trim each made-up street back to its last house (plus a little), and
  // drop the ones nobody lives on — except the high street.
  const kept = [];
  for (const st of streets) {
    if (!st.drawn) continue;
    // Downtown's grid is the towers' streets; it stays whole.
    if (st.downtown) { kept.push(st); continue; }
    if (!st.high && !Number.isFinite(st.used[0])) continue;
    if (Number.isFinite(st.used[0])) {
      const i0 = Math.max(0, st.used[0] - 2);
      const i1 = Math.min(st.pts.length - 1, st.used[1] + 1);
      // A side street keeps its junction end, so it still meets its parent.
      st.pts = st.pts.slice(st.high ? i0 : 0, i1 + 1);
    }
    kept.push(st);
  }
  /*
   * Which way each building fronts: toward its nearest street or road, on
   * its own local z axis (+1 or -1), which is where addTown puts the door.
   * Every building here is squared to a street, so the street is across z.
   */
  // Only the streets that are drawn (as trimmed) and the roads: a street
  // nobody lives on is gone by now, and a door must not face where it was.
  const fronting = roadSegs.map((q) => q.slice(0, 4));
  for (const st of kept) for (let i = 1; i < st.pts.length; i++) fronting.push([st.pts[i - 1][0], st.pts[i - 1][1], st.pts[i][0], st.pts[i][1]]);
  for (const p of placed) {
    let best = Infinity;
    let fx = 0;
    let fz = 0;
    for (const [ax, az, bx, bz] of fronting) {
      const dx = bx - ax;
      const dz = bz - az;
      const L2 = dx * dx + dz * dz;
      let t = L2 > 0 ? ((p.x - ax) * dx + (p.z - az) * dz) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + dx * t - p.x;
      const qz = az + dz * t - p.z;
      if (qx * qx + qz * qz < best) {
        best = qx * qx + qz * qz;
        fx = qx;
        fz = qz;
      }
    }
    p.front = Math.sin(p.rot) * fx + Math.cos(p.rot) * fz >= 0 ? 1 : -1;
  }

  return { spots: placed, streets: kept, cx, cz };
}

/**
 * Where the town's buildings go: the map's town block, rescued from the
 * three ways a town has come out empty before (below), then laid out along
 * streets by layTown(). Exported so the tests count the same buildings the
 * world builds.
 */
export function planTown(cfgTown, density = 1) {
  /*
   * A town whose ground is outside its own declared height band.
   *
   * `scatter` refuses every point outside [minH, maxH], and four maps put
   * the town centre a hundred to three hundred metres up while declaring a
   * band that stops at ninety — so the scatter found nowhere at all to stand
   * a building and the town was silently, completely empty. Nothing threw
   * and nothing warned; the place named on the map simply was not there.
   *
   * The band is widened to whatever the ground round the centre actually is,
   * rather than the town being moved: the author chose where the town goes,
   * and the band is a filter that was written for a different island.
   */
  const townCfg = cfgTown ? { ...cfgTown } : null;
  if (townCfg) {
    const hs = [];
    for (let a = 0; a < 16; a++) {
      for (const f of [0.25, 0.55, 0.85]) {
        const ang = (a * Math.PI) / 8;
        hs.push(heightAt(townCfg.cx + Math.sin(ang) * townCfg.radius * f,
          townCfg.cz - Math.cos(ang) * townCfg.radius * f));
      }
    }
    const dry = hs.filter((h) => h > 1).sort((a, b) => a - b);
    const inBand = hs.filter((h) => h >= (townCfg.minH ?? 0) && h <= (townCfg.maxH ?? 1e9));
    if (!inBand.length && dry.length) {
      townCfg.minH = Math.max(1, dry[0] - 2);
      townCfg.maxH = dry[dry.length - 1] + 2;
    }
  }
  const townSpots = (c) => scatter({
    cx: c.cx,
    cz: c.cz,
    radius: c.radius,
    count: Math.round(c.count * (density > 0.5 ? 1 : 0.7)),
    seed: 9,
    minH: c.minH,
    maxH: c.maxH,
    maxSlope: c.maxSlope ?? 0.16,
  });
  let town = townCfg ? townSpots(townCfg) : [];
  if (townCfg && !town.length) {
    /*
     * Still nowhere. Three maps put the town centre in open water or on
     * ground too steep for a house — a sea-stack map, a harbour and a
     * mountain pass. Move it to the nearest land and let it climb: a town on
     * the wrong hillside is a place, and an empty one is a hole in the map
     * with a name on it.
     */
    const land = nearestLand(townCfg.cx, townCfg.cz, 2);
    if (land) {
      townCfg.cx = land.x;
      townCfg.cz = land.z;
    }
    townCfg.minH = 1;
    townCfg.maxH = 1e9;
    /*
     * And flat enough to stand on. Saddleback's village is written onto a
     * seventy-one-per-cent mountainside — dry, in band, and far too steep
     * for `scatter`'s slope test at any sane setting. So the last resort
     * looks for the flattest ground within a few hundred metres and eases
     * the slope limit until something stands, rather than shipping a named
     * place with nothing in it.
     */
    let flat = null;
    for (let r = 0; r <= 700 && !flat; r += 140) {
      for (let a = 0; a < 16; a++) {
        const ang = (a * Math.PI) / 8;
        const px = townCfg.cx + (r ? Math.sin(ang) * r : 0);
        const pz = townCfg.cz - (r ? Math.cos(ang) * r : 0);
        const e = 25;
        const h = heightAt(px, pz);
        if (h < 2) continue;
        const g = Math.max(
          Math.abs(heightAt(px + e, pz) - heightAt(px - e, pz)),
          Math.abs(heightAt(px, pz + e) - heightAt(px, pz - e))
        ) / (2 * e);
        if (g < 0.18) { flat = { x: px, z: pz }; break; }
      }
    }
    if (flat) {
      townCfg.cx = flat.x;
      townCfg.cz = flat.z;
    }
    for (const limit of [0.3, 0.45, 0.7]) {
      townCfg.maxSlope = limit;
      town = townSpots(townCfg);
      if (town.length) break;
    }
  }
  /*
   * And never on a helipad. The scatter knew nothing about them, so a ground
   * pad in the middle of a town — Meridian's "Founders Plaza" — had houses
   * standing on it, and a roof pad's block could come up inside somebody's
   * flat. Counted in tests/features/maps.mjs.
   */
  const pads = padsOf(MAP);
  if (pads.length && town.length) {
    town = town.filter((s) => pads.every((p) => {
      const clear = p.kind === 'roof' ? (p.r || 11) * 1.25 + 12 : (p.r || 11) + 16;
      return (s.x - p.x) ** 2 + (s.z - p.z) ** 2 > clear * clear;
    }));
  }
  if (!townCfg || !town.length) return { cfg: townCfg, spots: town, streets: [] };
  /*
   * The scatter is only the fallback now; the town is laid out along streets.
   * A layout that throws must not take the map down with it — new Scenery()
   * is on the path of every world build — so it falls back to the scatter,
   * which is what every town was until today.
   */
  try {
    const laid = layTown(townCfg, town.length, town);
    if (laid.spots.length) {
      return { cfg: { ...townCfg, cx: laid.cx, cz: laid.cz }, spots: laid.spots, streets: laid.streets };
    }
  } catch (err) {
    console.warn('The town could not be laid out along streets; scattering it instead.', err);
  }
  return { cfg: townCfg, spots: town, streets: [] };
}

/**
 * Painted car-park bays: white lines on dark tarmac, tiled per car park.
 */
function carParkTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#3b3e42';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#e8e6de';
  // Two rows of bays with an aisle between.
  for (let x = 0; x < 64; x += 16) {
    g.fillRect(x, 0, 2, 22);
    g.fillRect(x, 42, 2, 22);
  }
  g.fillRect(0, 21, 64, 2);
  g.fillRect(0, 41, 64, 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/**
 * An airport's other half: the warehouses, the car parks full of cars and
 * the hotels that stand round a big field, which is what makes a runway
 * read as an international airport rather than a strip in a field.
 *
 * Laid along one service road (drawn), sheds on one side and car parks on
 * the other, two hotels at the end. Every footprint is checked the way the
 * town's are: dry, off both runway pads and both approach lanes, off made
 * ground, not steeper than 15%. Eight draw calls: road, shed walls, shed
 * roofs, car-park plates, cars, hotel walls, hotel roofs, hotel signs.
 * Sheds and hotels are solid; the car parks and the cars are not — a car
 * park is somewhere a helicopter should be able to put down.
 */
/**
 * The four walls of a turned box into a Batch, UV'd in metres: one texture
 * tile is `tu` metres wide and `tv` tall, the bottom of the tile at `yv`.
 * A unit box scaled to a building wears one tile per wall whatever its size,
 * which on a 60 m hotel made every window ten metres wide.
 */
function wallsInMetres(batch, x, z, rot, w, d, y0, y1, tu, tv, yv, color) {
  const c = Math.cos(rot);
  const sn = Math.sin(rot);
  const P = (lx, lz, y) => [x + c * lx + sn * lz, y, z - sn * lx + c * lz];
  const hw = w / 2;
  const hd = d / 2;
  const v0 = (y0 - yv) / tv;
  const v1 = (y1 - yv) / tv;
  for (const [ax, az, bx, bz, len] of [[-hw, hd, hw, hd, w], [hw, -hd, -hw, -hd, w], [hw, hd, hw, -hd, d], [-hw, -hd, -hw, hd, d]]) {
    batch.quad(P(ax, az, y0), P(bx, bz, y0), P(bx, bz, y1), P(ax, az, y1), [0, v0, len / tu, v1], color);
  }
}

function addEstate(group, cfg) {
  if (!cfg) return null;
  const rot = ((cfg.angleDeg || 0) * Math.PI) / 180;
  const ux = Math.cos(rot);
  const uz = -Math.sin(rot);
  const vx = Math.sin(rot);
  const vz = Math.cos(rot);
  const W = (u, v) => [cfg.cx + ux * u + vx * v, cfg.cz + uz * u + vz * v];
  const nSheds = cfg.sheds ?? 7;
  const nParks = cfg.parks ?? 3;
  const nHotels = cfg.hotels ?? 2;
  const SHED = 56;
  const PARK = 72;
  const L = Math.max(nSheds * SHED, nParks * PARK) + nHotels * 60 + 40;
  const rnd = makeRandom(Math.abs(Math.round(cfg.cx * 3 + cfg.cz * 5)) + 11);
  const R2 = AIRPORT.runway2;
  const r2AlongX = R2 && Math.abs((((R2.headingDeg ?? 180) % 180) - 90)) < 45;
  const clearGround = (x, z) => {
    if (heightAt(x, z) < 2 || padWeight(x, z) > 0) return false;
    const f = flatAt(x, z);
    if (f && f.clear) return false;
    const rw = AIRPORT.runway;
    if (Math.abs(x - rw.cx) < CORRIDOR.length && Math.abs(z - rw.cz) < CORRIDOR.halfWidth) return false;
    if (R2) {
      const along = r2AlongX ? Math.abs(x - R2.cx) : Math.abs(z - R2.cz);
      const across = r2AlongX ? Math.abs(z - R2.cz) : Math.abs(x - R2.cx);
      if (along < CORRIDOR2.length && across < CORRIDOR2.halfWidth) return false;
    }
    return true;
  };
  /** A footprint centred at (u, v), w along u and d along v: its ground, or null. */
  const site = (u, v, w, d) => {
    const pts = [[0, 0], [w / 2, d / 2], [-w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]];
    let lo = Infinity;
    let hi = -Infinity;
    for (const [a, b] of pts) {
      const [x, z] = W(u + a, v + b);
      if (!clearGround(x, z)) return null;
      const h = heightAt(x, z);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    if ((hi - lo) / Math.hypot(w, d) > 0.15) return null;
    const [x, z] = W(u, v);
    return { x, z, y: heightAt(x, z), lo };
  };

  const d = new THREE.Object3D();
  const col = new THREE.Color();
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const out = { sheds: 0, parks: 0, cars: 0, hotels: 0 };

  /* ---- the service road ---- */
  const road = [];
  for (let u = -L / 2; u <= L / 2; u += 20) {
    const [x, z] = W(u, 0);
    if (!clearGround(x, z)) {
      if (road.length) break;
      continue;
    }
    road.push([x, z]);
  }
  if (road.length > 2) addStreets(group, [{ pts: road, hw: 7, drawn: true }]);

  /* ---- warehouses, north side of the road ---- */
  const sheds = [];
  for (let i = 0; i < nSheds; i++) {
    const w = 38 + rnd() * 12;
    const dd = 50 + rnd() * 26;
    const u = -L / 2 + 30 + i * SHED + w / 2;
    const s = site(u, 9 + dd / 2 + 6, w, dd);
    if (s) sheds.push({ ...s, w, d: dd, h: 10 + rnd() * 6 });
  }
  if (sheds.length) {
    // The cladding in metres (6 m a tile, as on the hangars), not one tile
    // stretched over a 76 m wall.
    const wallB = new Batch();
    const roof = new THREE.InstancedMesh(gableGeometry(), new THREE.MeshStandardMaterial({ color: 0x8c949b, roughness: 0.55, metalness: 0.35, flatShading: true }), sheds.length);
    const tints = [0xd9dde0, 0xc8d4dc, 0xe2dccf, 0xb9c6b8, 0xd8c7b5];
    sheds.forEach((b, i) => {
      wallsInMetres(wallB, b.x, b.z, rot, b.w, b.d, b.lo - 0.3, b.y + b.h, 6, 6, b.lo - 0.3, tints[i % tints.length]);
      // Ridge along the long side (v), low pitch.
      d.position.set(b.x, b.y + b.h - 0.05, b.z);
      d.rotation.set(0, rot, 0);
      d.scale.set(b.w + 1, b.w * 0.12, b.d + 1);
      d.updateMatrix();
      roof.setMatrixAt(i, d.matrix);
      const [hx, hz] = turnedHalf(b.w, b.d, rot);
      addObstacleAt(b.x, b.z, hx * 2, hz * 2, b.lo - 0.3, b.y + b.h - b.lo + b.w * 0.12 + 0.6, 'You flew into a warehouse');
    });
    const wall = wallB.mesh(new THREE.MeshStandardMaterial({ map: hangarTexture(), vertexColors: true, roughness: 0.6, metalness: 0.3, envMapIntensity: 0.7 }), { name: 'estate-sheds' });
    roof.instanceMatrix.needsUpdate = true;
    roof.castShadow = true;
    group.add(wall, roof);
    out.sheds = sheds.length;
  }

  /* ---- car parks and their cars, south side ---- */
  const parks = [];
  for (let i = 0; i < nParks; i++) {
    const u = -L / 2 + 30 + i * PARK + 32;
    const s = site(u, -9 - 26, 64, 44);
    if (s) parks.push({ ...s, u });
  }
  if (parks.length) {
    const tex = carParkTexture();
    tex.repeat.set(64 / 16, 1);
    const plate = new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, envMapIntensity: 0.35 }), parks.length);
    const cars = [];
    parks.forEach((p, i) => {
      d.position.set(p.x, p.y + 0.12, p.z);
      d.rotation.set(0, rot, 0);
      d.scale.set(64, 0.5, 44);
      d.updateMatrix();
      plate.setMatrixAt(i, d.matrix);
      // Two rows of bays, about two in three taken.
      for (const row of [-1, 1]) {
        for (let k = 0; k < 16; k++) {
          if (rnd() < 0.34) continue;
          const [x, z] = W(p.u - 30 + k * 4 + 2, -9 - 26 + row * 14);
          cars.push([x, heightAt(x, z) + 0.9, z]);
        }
      }
    });
    plate.instanceMatrix.needsUpdate = true;
    plate.receiveShadow = true;
    group.add(plate);
    if (cars.length) {
      const carMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.9, 1.4, 4.3), new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.5, envMapIntensity: 1 }), cars.length);
      const paint = [0xc8312a, 0x2d5fa8, 0xf2f2ee, 0x1d1f22, 0x9aa3ab, 0x3f7a4a, 0xe0b132, 0x7a2f63];
      cars.forEach(([x, y, z], i) => {
        d.position.set(x, y, z);
        d.rotation.set(0, rot, 0);
        d.scale.set(1, 1, 1);
        d.updateMatrix();
        carMesh.setMatrixAt(i, d.matrix);
        carMesh.setColorAt(i, col.setHex(paint[(i * 7 + (i >> 2)) % paint.length]));
      });
      carMesh.instanceMatrix.needsUpdate = true;
      if (carMesh.instanceColor) carMesh.instanceColor.needsUpdate = true;
      carMesh.castShadow = true;
      group.add(carMesh);
      out.cars = cars.length;
    }
    out.parks = parks.length;
  }

  /* ---- hotels, at the far end ---- */
  const hotels = [];
  for (let i = 0; i < nHotels; i++) {
    const w = 60;
    const dd = 18 + rnd() * 4;
    const u = L / 2 - 40 - i * 64;
    const v = (i % 2 ? -1 : 1) * (9 + dd / 2 + 8);
    const s = site(u, v, w, dd);
    if (s) hotels.push({ ...s, w, d: dd, h: 28 + rnd() * 20 });
  }
  if (hotels.length) {
    // The office texture in metres: six 3.5 m bays and seven 3.3 m storeys a tile.
    const wallB = new Batch();
    const caps = new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ color: 0xd9d6ce, roughness: 0.8 }), hotels.length);
    // A red sign on the roof, lit at night like the tower lights.
    const sign = new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ color: 0x7a1410, emissive: 0xff3322, emissiveIntensity: 0.6 }), hotels.length);
    hotels.forEach((b, i) => {
      wallsInMetres(wallB, b.x, b.z, rot, b.w, b.d, b.lo - 0.3, b.y + b.h, 21, 23.1, b.y + 0.2, 0xffffff);
      d.rotation.set(0, rot, 0);
      d.position.set(b.x, b.y + b.h + 0.5, b.z);
      d.scale.set(b.w + 1, 1, b.d + 1);
      d.updateMatrix();
      caps.setMatrixAt(i, d.matrix);
      d.position.set(b.x, b.y + b.h + 3.2, b.z);
      d.scale.set(b.w * 0.5, 4, 0.8);
      d.updateMatrix();
      sign.setMatrixAt(i, d.matrix);
      const [hx, hz] = turnedHalf(b.w, b.d, rot);
      addObstacleAt(b.x, b.z, hx * 2, hz * 2, b.lo - 0.3, b.y + b.h - b.lo + 6, 'You flew into a hotel');
    });
    const walls = wallB.mesh(new THREE.MeshStandardMaterial({ map: buildingTexture(2), vertexColors: true, roughness: 0.5, metalness: 0.2 }), { name: 'estate-hotels' });
    caps.instanceMatrix.needsUpdate = true;
    sign.instanceMatrix.needsUpdate = true;
    caps.castShadow = true;
    group.add(walls, caps, sign);
    out.hotels = hotels.length;
    out.signMat = sign.material;
  }
  return out;
}

export class Scenery {
  constructor(scene, quality = 'high') {
    treeCache = new Map();
    try {
      this.build(scene, quality);
    } finally {
      treeCache = null;
    }
  }

  build(scene, quality) {
    this.group = new THREE.Group();
    this.group.name = 'scenery';
    this.t = 0;

    const density = quality === 'low' ? 0.35 : quality === 'medium' ? 0.65 : quality === 'ultra' ? 1.8 : 1;
    // Everything planted here is described by the active map: how many trees,
    // how tall, where the town goes, where the lighthouse stands.
    const main = ISLANDS[0];
    /*
     * A map may leave a key out, and leaving one out must not be fatal.
     *
     * This read `cfg.town.cx`, `cfg.hillBand[0]` and `cfg.deliveryPad[0]`
     * unconditionally, because for the first nine maps every one of them was
     * always there. Two of the maps that arrived today are a road network and
     * an airfield with no town — and `new Scenery()` threw before a frame was
     * drawn, from the one call site every game goes through, so those maps did
     * not merely look wrong: they did not load at all.
     *
     * The defaults below are placed off the main island's own geometry, so a
     * map that says nothing gets something sensible rather than Kestrel's
     * coordinates, which is the other way this has gone wrong before.
     */
    const cfg = {
      coastTrees: 0,
      coastTreeHeight: 10,
      hillTrees: 0,
      hillTreeHeight: 11,
      padTrees: 0,
      boats: 0,
      ...MAP.scenery,
    };
    if (!cfg.deliveryPad) cfg.deliveryPad = [main.cx + main.radius * 0.55, main.cz];
    if (!cfg.hillCentre) cfg.hillCentre = [main.cx, main.cz];
    if (!cfg.hillBand) cfg.hillBand = [40, Math.max(80, main.peak * 0.7)];
    if (!cfg.lighthouse) cfg.lighthouse = [main.cx - main.radius * 0.8, main.cz];
    // No town key means no town — not a town of zero houses at the origin.
    this.hasTown = !!cfg.town;

    // The delivery pad moves with the map, but it stays the same object so
    // anything already holding a reference to it stays correct.
    DELIVERY_PAD.set(cfg.deliveryPad[0], 0, cfg.deliveryPad[1]);

    // Trees along the coast of the main island.
    const coast = scatter({
      cx: main.cx,
      cz: main.cz,
      radius: main.radius * 0.96,
      count: Math.round(cfg.coastTrees * density),
      seed: 5,
      minH: 2.5,
      maxH: Math.max(40, cfg.hillBand[0] + 30),
      maxSlope: 0.45,
    });
    // Coast: whatever grows by the sea in this climate — see FLORA.
    const flora = floraOf(MAP);
    addTrees(this.group, coast, cfg.coastTreeHeight, flora.coast);

    // Denser stands up on the higher ground.
    const upland = scatter({
      cx: cfg.hillCentre[0],
      cz: cfg.hillCentre[1],
      radius: cfg.hillRadius,
      count: Math.round(cfg.hillTrees * density),
      seed: 55,
      minH: cfg.hillBand[0],
      maxH: cfg.hillBand[1],
      maxSlope: 0.7,
    });
    // High ground: the climate's upland mix.
    addTrees(this.group, upland, cfg.hillTreeHeight, flora.hill);

    // A military base, on the maps that have one.
    this.base = addAirBase(this.group, cfg.base);
    // And the range it practises on.
    this.range = addWeaponsRange(this.group, cfg.range);
    // The warehouses, car parks and hotels round a big airport.
    this.estate = addEstate(this.group, cfg.estate);

    // The town, in whatever flat land this map has near the field.
    const plan = planTown(cfg.town, density);
    this.town = addTown(this.group, plan.spots, { ...(plan.cfg || {}), avoid: padsOf(MAP) });
    this.streets = addStreets(this.group, plan.streets || []);
    this.town.streets = (plan.streets || []).length;

    // Greenery around the outlying delivery strip.
    const padTrees = scatter({
      cx: DELIVERY_PAD.x,
      cz: DELIVERY_PAD.z,
      radius: 900,
      count: Math.round(cfg.padTrees * density),
      seed: 77,
      minH: 2.5,
      maxH: 240,
      maxSlope: 0.5,
      avoidAirport: false,
    });
    // Round the delivery pad, and NOT solid — landing there is the mission.
    addTrees(this.group, padTrees, cfg.coastTreeHeight, flora.pad, false);

    /*
     * On land, wherever the map meant.
     *
     * Measured across the thirty-two: nine lighthouses stood in open water,
     * three of them on maps that shipped a year ago — Ironhead's is forty
     * metres under. A tower built at a negative height is either invisible or
     * a spire with no base, apparently floating.
     */
    const lh = nearestLand(cfg.lighthouse[0], cfg.lighthouse[1], 2) || {
      x: cfg.lighthouse[0],
      z: cfg.lighthouse[1],
    };
    this.lighthouseAt = lh;
    this.lighthouse = buildLighthouse(this.group, lh.x, lh.z);
    if (this.town) this.town.nightMats.push(...this.lighthouse.nightMats);
    // The lamp mesh, under the name the rest of the game has always read.
    this.lighthouseLamp = this.lighthouse.lamp;
    this.beamOn = 0;
    // The huts' windows light up with the town's.
    const dpad = buildDeliveryPad(this.group);
    if (dpad && dpad.userData.nightMats && this.town) this.town.nightMats.push(...dpad.userData.nightMats);
    // Two kinds of harbour block: a quay built on a flat (the car maps), and
    // one described point by point (Cutter Bay). The second used to be handed
    // to the first, which found no flat and built nothing.
    const hcfg = cfg.harbour;
    const dressed = !!(hcfg && (hcfg.breakwater || hcfg.moorings || hcfg.fishingFleet || hcfg.fuelJetty));
    this.harbour = hcfg && (hcfg.flat || !dressed) ? addHarbour(this.group, hcfg) : null;
    this.harbourDressing = dressed ? addHarbourDressing(this.group, hcfg) : null;
    this.boats = buildBoats(this.group, cfg.boats, cfg.boatHome, cfg.boatKinds);

    /*
     * Helipads, last of everything.
     *
     * Order matters and it is not obvious. `heightAt` returns platform height
     * over a registered platform, so anything that samples the ground —
     * scatter for the trees, buildBoats looking for open water, the terrain
     * mesh itself — has to have finished before the pads register theirs, or
     * a rig deck reads as a hillside and the boats sail round it.
     */
    this.pads = buildPads(this.group);

    scene.add(this.group);
  }

  /**
   * Park a few aeroplanes on the base.
   *
   * Same reasoning as the carrier deck: an empty apron reads as a model of an
   * air base, and you cannot tell how big any of it is until there is
   * something on it whose size you already know. Six shelters with nothing in
   * front of them is a diagram; two Nightjars and a Vanguard sitting out is a
   * place.
   *
   * The model factory is passed in rather than imported, so the world does not
   * have to know anything about aeroplanes — main.js owns that seam already.
   */
  parkJets(makeModel, type, scheme) {
    if (!makeModel || !type || !this.base || !this.base.parkSpots) return;
    const spots = this.base.parkSpots.slice(0, 4);
    for (const spot of spots) {
      let m;
      try {
        m = makeModel({ type, livery: scheme });
      } catch (e) {
        console.warn('Could not park an aeroplane on the base.', e);
        return;
      }
      m.position.set(spot.x, spot.y, spot.z);
      m.rotation.y = spot.heading;
      // Parked: engine off, wheels down, nothing turning.
      if (m.userData.update) {
        try {
          m.userData.update(0.016, {
            controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 1 },
            rpm: 0, flaps: 0, gearPos: 1, gearDown: true, onGround: true,
            groundSpeed: 0, agl: 0, alt: spot.y, engineOn: false,
            vel: new THREE.Vector3(), pos: m.position, quat: m.quaternion,
          }, { isNight: false, cond: { cloud: 0 } });
        } catch (e) {
          /* a model that will not animate parked is still fine to look at */
        }
      }
      this.group.add(m);
    }
  }

  update(dt, weather) {
    this.t += dt;
    // The base radar turns. It is the only moving thing on an air base, which
    // is what stops the place reading as a model of a base.
    if (this.base && this.base.dish) this.base.dish.rotation.y += dt * 0.55;
    updatePads(this.pads, this.t, weather.isNight);
    // Lighthouse sweeps.
    const on = weather.isNight || weather.cond.cloud > 0.75;
    this.lighthouseLamp.material.emissiveIntensity = on
      ? 1.2 + Math.max(0, Math.sin(this.t * 1.6)) * 3.2
      : 0.4;
    // The beams fade in over a few seconds rather than snapping on, and the
    // group is hidden outright in daylight so it costs nothing to draw.
    const L = this.lighthouse;
    if (L && L.beam) {
      const want = weather.isNight ? 1 : on ? 0.45 : 0;
      this.beamOn += (want - this.beamOn) * Math.min(1, dt * 0.8);
      L.beam.visible = this.beamOn > 0.01;
      if (L.beam.visible) {
        L.beam.rotation.y += dt * 0.9;
        L.beamMat.opacity = 0.13 * this.beamOn;
      }
    }
    if (this.estate && this.estate.signMat) this.estate.signMat.emissiveIntensity = weather.isNight ? 2.4 : 0.6;
    // Windows light up after dark. Only written when it changes.
    if (this.town && this.town.nightMats && this.town.nightMats.length) {
      const want = weather.isNight ? 1.15 : weather.time === 'sunset' || weather.time === 'dusk' ? 0.45 : 0;
      if (want !== this.windowGlow) {
        this.windowGlow = want;
        for (const m of this.town.nightMats) m.emissiveIntensity = want;
      }
    }
    // Aviation lights on the towers blink, one second in two.
    if (this.town && this.town.lampMat) {
      this.town.lampMat.emissiveIntensity = (this.t % 2) < 1 ? (weather.isNight ? 3 : 1.4) : 0.15;
    }
    // Boats trundle along. They steer away before they run aground — without
    // this they sail happily up the nearest hillside, which is a very odd
    // thing to fly past.
    for (const b of this.boats) {
      const stepX = Math.cos(b.obj.rotation.y) * b.speed * dt;
      const stepZ = -Math.sin(b.obj.rotation.y) * b.speed * dt;
      // Look 220 m ahead; if that is land, turn away and try again next frame.
      const look = 220 / Math.max(b.speed * dt, 0.001);
      if (heightAt(b.obj.position.x + stepX * look, b.obj.position.z + stepZ * look) > -3) {
        b.obj.rotation.y += 0.9 * dt;
        continue;
      }
      b.obj.position.x += stepX;
      b.obj.position.z += stepZ;
      b.obj.rotation.z = Math.sin(this.t * 0.8 + b.phase) * 0.05 * (1 + weather.cond.turb);
      b.obj.position.y = Math.sin(this.t * 1.1 + b.phase) * 0.35 * (1 + weather.cond.turb);
    }
  }
}
