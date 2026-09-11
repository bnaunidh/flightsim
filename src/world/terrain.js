/**
 * Island terrain.
 *
 * A single analytic height function drives everything: the mesh, the aircraft's
 * ground collision, and where trees and buildings get placed. That means the
 * wheels always touch exactly the ground you can see.
 *
 * The airport sits on a flattened coastal plateau on the main island. The
 * delivery island is a second, smaller landmass to the south-east.
 */

import * as THREE from '../vendor/three.module.js';
import { fbm, clamp, smoothstep, lerp, makeRandom } from '../core/noise.js';
import { getMap, DEFAULT_MAP_ID } from './maps.js';
import {
  grassTexture,
  sandTexture,
  rockTexture,
  terrainSplatNoise,
  groundNormal,
} from '../render/textures.js';

/**
 * Airport geometry. Heading 090 means the runway points east (+X).
 *
 * Deliberately identical on every map: same position, same length, same
 * elevation. That is what lets the tutorial, all the missions and the landing
 * scoring work unchanged wherever you choose to fly.
 */
const KESTREL_AIRPORT = {
  elev: 14,
  headingDeg: 90,
  runway: { cx: 0, cz: 0, length: 1100, halfWidth: 17 },
  /**
   * The crosswind runway, 18/36, crossing the main one east of the apron.
   *
   * One runway means a strong crosswind is simply a bad day. Two crossing
   * runways means it is a decision — which is the interesting version, and it
   * is why real airfields are laid out like this. Deliberately shorter and
   * narrower than 09/27, so choosing it costs you something.
   */
  runway2: { cx: 250, cz: -70, length: 900, halfWidth: 15, headingDeg: 180 },
  // Smooth flattening region (a bit larger than the paved area).
  pad: { x0: -680, x1: 680, z0: -230, z1: 190, blend: 190 },
  // ...and a second one for 18/36, so its ends are level too.
  pad2: { x0: 170, x1: 330, z0: -580, z1: 440, blend: 170 },
};

/**
 * The valley kept clear along the extended runway centreline, so runway 09/27
 * has a flyable approach and departure at both ends. Every map gets one,
 * including the mountainous ones — especially the mountainous ones.
 */
export const CORRIDOR = { halfWidth: 380, blend: 320, fadeFrom: 3600, length: 5400 };
/** The same idea for 18/36, running north-south instead. */
export const CORRIDOR2 = { halfWidth: 300, blend: 260, fadeFrom: 2600, length: 4200 };

/* ------------------------------------------------------------------ */
/* Active map                                                          */
/* ------------------------------------------------------------------ */

/**
 * These are `let`, not `const`, and everything that imports them gets a live
 * binding — so swapping the map really does swap the world underneath.
 * Call `applyMap()` and then rebuild the terrain, ocean and scenery.
 */
/**
 * The airfield you are flying from.
 *
 * This was a `const`, which quietly meant every map in the game had the same
 * runway in the same place — fine while every map was an island with one strip,
 * and wrong the moment a real airport with four parallel runways turns up. It
 * is now a live binding like MAP and ISLANDS, so a map may bring its own.
 *
 * A map that does not specify one gets Kestrel's, so nothing that existed
 * before has to change.
 */
export let AIRPORT = KESTREL_AIRPORT;

export let MAP = getMap(DEFAULT_MAP_ID);
export let SEA_FLOOR = MAP.seaFloor;
export let ISLANDS = MAP.islands;
export let PALETTE = MAP.palette;

export function applyMap(idOrDef) {
  MAP = typeof idOrDef === 'string' ? getMap(idOrDef) : idOrDef;
  SEA_FLOOR = MAP.seaFloor;
  ISLANDS = MAP.islands;
  AIRPORT = MAP.airport || KESTREL_AIRPORT;
  PALETTE = MAP.palette;
  return MAP;
}

/**
 * How "inside" an island a point is: 1 in the middle, 0 out at sea.
 * The early distance rejection matters — this runs millions of times while the
 * terrain mesh is built and a few hundred times a frame for wheel contact.
 */
function islandField(x, z, isl) {
  const dx = x - isl.cx;
  const dz = z - isl.cz;
  const d2 = dx * dx + dz * dz;
  // Coastline wobble is at most ±42%, so anything past 1.45 R is open water.
  const maxR = isl.radius * 1.45;
  if (d2 > maxR * maxR) return 0;
  const d = Math.sqrt(d2);
  // Wobble the coastline so islands are not circles.
  const ang = Math.atan2(dz, dx);
  const wob =
    fbm(Math.cos(ang) * 2 + isl.seed, Math.sin(ang) * 2, { octaves: 3, seed: isl.seed }) - 0.5;
  const r = isl.radius * (1 + wob * 0.42);
  return 1 - smoothstep(r * 0.55, r, d);
}

/** Weight of the flattened airport plateau at this point (0..1). */
function regionWeight(p, x, z) {
  // A map with only one runway has no second pad, and reading x0 off nothing
  // threw on the first height sample — before a single frame had been drawn.
  if (!p) return 0;
  if (x < p.x0 - p.blend || x > p.x1 + p.blend || z < p.z0 - p.blend || z > p.z1 + p.blend) return 0;
  const inX = smoothstep(p.x0 - p.blend, p.x0, x) * (1 - smoothstep(p.x1, p.x1 + p.blend, x));
  const inZ = smoothstep(p.z0 - p.blend, p.z0, z) * (1 - smoothstep(p.z1, p.z1 + p.blend, z));
  return inX * inZ;
}

/** Both runways sit on the same level plateau, so take whichever is stronger. */
function padWeight(x, z) {
  return Math.max(regionWeight(AIRPORT.pad, x, z), regionWeight(AIRPORT.pad2, x, z));
}

/**
 * The outlying delivery strip. Somebody bulldozed this flat, exactly like the
 * airfield — which is why you can put a cargo crate on it or, if you are
 * feeling brave, land on it. On the fjords map it is the only level ground for
 * miles.
 */
function outpostWeight(x, z) {
  const o = MAP.outpost;
  if (!o) return 0;
  const dx = Math.abs(x - o.cx);
  const dz = Math.abs(z - o.cz);
  if (dx > o.halfLen + o.blend || dz > o.halfWidth + o.blend) return 0;
  const inX = 1 - smoothstep(o.halfLen, o.halfLen + o.blend, dx);
  const inZ = 1 - smoothstep(o.halfWidth, o.halfWidth + o.blend, dz);
  return inX * inZ;
}

/**
 * Solid structures you can fly into.
 *
 * The ground has always been solid; buildings were not, so the tower and the
 * terminal were scenery you passed straight through. Each entry is an
 * axis-aligned box in world metres — good enough for a tower, a hangar or a
 * terminal, and cheap enough to test every hard point against every frame.
 *
 * The world owns these: `buildWorld` clears the list and each piece registers
 * itself as it is built, so switching map or graphics level cannot leave a
 * ghost building behind to crash into.
 */
export const OBSTACLES = [];

export function clearObstacles() {
  OBSTACLES.length = 0;
}

/**
 * @param {object} box {x0,x1,y0,y1,z0,z1, what} — `what` is the crash message.
 */
export function addObstacle(box) {
  OBSTACLES.push(box);
  return box;
}

/** Register a box by centre and size, which is how everything is modelled. */
export function addObstacleAt(cx, cz, width, depth, baseY, height, what) {
  return addObstacle({
    x0: cx - width / 2,
    x1: cx + width / 2,
    z0: cz - depth / 2,
    z1: cz + depth / 2,
    y0: baseY,
    y1: baseY + height,
    what,
  });
}

/** The structure at this point, or null. */
export function obstacleAt(x, y, z) {
  for (let i = 0; i < OBSTACLES.length; i++) {
    const o = OBSTACLES[i];
    if (x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1 && y >= o.y0 && y <= o.y1) return o;
  }
  return null;
}

/** Terrain height in metres above sea level (sea level is y = 0). */
/**
 * Flat surfaces standing above the world: the carrier deck, and anything else
 * you are meant to be able to land on that is not the ground.
 *
 * Kept as a list the world can register into, rather than special-cased inside
 * heightAt, so adding a second ship — or an oil rig, or a rooftop pad — costs
 * one push and nothing else has to know.
 */
export const PLATFORMS = [];

export function clearPlatforms() {
  PLATFORMS.length = 0;
}

/**
 * @param {number} cx centre
 * @param {number} cz centre
 * @param {number} w  full width  (across)
 * @param {number} d  full depth  (along)
 * @param {number} y  deck height above sea level
 * @param {string} name
 */
/**
 * @param {object} [arrest] world-space {z0, z1} band where the wires are, if
 *   this deck has any. A deck without it is just somewhere to land.
 */
export function addPlatform(cx, cz, w, d, y, name, arrest = null) {
  PLATFORMS.push({ cx, cz, hw: w / 2, hd: d / 2, y, name, arrest });
}

/** The deck under this point, or null. */
export function platformAt(x, z) {
  for (let i = 0; i < PLATFORMS.length; i++) {
    const p = PLATFORMS[i];
    if (Math.abs(x - p.cx) <= p.hw && Math.abs(z - p.cz) <= p.hd) return p;
  }
  return null;
}

export function heightAt(x, z) {
  // A deck wins over whatever is underneath it — that is the point of a deck.
  if (PLATFORMS.length) {
    const p = platformAt(x, z);
    if (p) return p.y;
  }
  // Ground operations happen almost entirely on the airfield, so short-circuit
  // the whole noise stack when we are well inside the flattened plateau.
  const padW = padWeight(x, z);
  if (padW > 0.9995) return AIRPORT.elev;

  let h = SEA_FLOOR;

  for (let i = 0; i < ISLANDS.length; i++) {
    const isl = ISLANDS[i];
    const m = islandField(x, z, isl);
    if (m <= 0.0001) continue;

    const s = 1 / 900;
    const hills = fbm(x * s, z * s, { octaves: 4, gain: 0.52, seed: isl.seed * 7 });
    const ridge =
      1 - Math.abs(fbm(x * s * 0.45 + 30, z * s * 0.45, { octaves: 3, seed: isl.seed * 13 }) - 0.5) * 2;
    const detail = fbm(x / 130, z / 130, { octaves: 2, seed: isl.seed * 3 });

    // Beach → inland: rise quickly out of the water, then roll into whatever
    // shape this island is supposed to be.
    let local;
    switch (isl.profile) {
      case 'plains': {
        // Wide and gentle. No ridge term at all, so there is nothing steep
        // anywhere — this is the map you learn to land on.
        const inland = smoothstep(0.02, 0.6, m);
        local =
          lerp(-4, 22, smoothstep(0, 0.3, m)) + inland * hills * isl.peak * 0.85 + inland * detail * 5;
        break;
      }
      case 'flat': {
        // A sandy cay barely out of the water: broad beaches, a low spine of
        // scrub down the middle.
        const inland = smoothstep(0.04, 0.5, m);
        local =
          lerp(-3, 9, smoothstep(0, 0.36, m)) + inland * hills * isl.peak * 0.6 + inland * detail * 3;
        break;
      }
      case 'ridge': {
        // Steep and craggy, with the ridges running right down into the water.
        const inland = smoothstep(0.01, 0.42, m);
        local =
          lerp(-8, 34, smoothstep(0, 0.2, m)) +
          inland * (Math.pow(ridge, 1.5) * isl.peak * 1.05 + hills * isl.peak * 0.3) +
          inland * detail * 15;
        break;
      }
      case 'cone': {
        // A volcano.
        //
        // This used to be shaped from `m`, the island field — but that
        // saturates at 1 across the whole middle of the island, so the "cone"
        // came out as a flat table 2 km wide at a constant height and the
        // "crater" never appeared at all. That is why Ember Isle read as a
        // mountain rather than a volcano.
        //
        // Shape it from the radius instead. The summit is the crater *rim*,
        // the flanks fall away from there with the slight concavity a real
        // strato-volcano has, and the middle is a genuine bowl you can fly
        // down into.
        const dRel = Math.min(1, Math.hypot(x - isl.cx, z - isl.cz) / isl.radius);
        const rimRel = (isl.craterRadius || isl.radius * 0.12) / isl.radius;
        const inland = smoothstep(0.02, 0.5, m);

        // 1 at the rim, 0 down at the shoreline.
        const flank = Math.pow(clamp((1 - dRel) / (1 - rimRel), 0, 1), 1.55);
        // Radial gullies down the flanks — real cones are fluted, not smooth.
        const ang = Math.atan2(z - isl.cz, x - isl.cx);
        const gully =
          (Math.sin(ang * 13 + isl.seed) * 0.5 + 0.5) * smoothstep(rimRel, 0.85, dRel);
        // The crater bowl: flat-floored in the middle, up to the rim.
        const bowl = 1 - smoothstep(rimRel * 0.55, rimRel, dRel);

        local =
          lerp(-5, 20, smoothstep(0, 0.3, m)) +
          inland * (flank * isl.peak * (1 - gully * 0.045) + hills * isl.peak * 0.06) -
          inland * (isl.crater || 0) * bowl +
          inland * detail * 7;
        break;
      }
      default: {
        const inland = smoothstep(0.02, 0.55, m);
        local =
          lerp(-4, 26, smoothstep(0, 0.28, m)) +
          inland * (hills * isl.peak * 0.55 + Math.pow(ridge, 2.2) * isl.peak * 0.75) +
          inland * detail * 9;
      }
    }

    // Islands are far apart, so max() keeps each coastline clean.
    const candidate = lerp(SEA_FLOOR, local, smoothstep(0, 0.16, m));
    if (candidate > h) h = candidate;
  }

  if (padW > 0) h = lerp(h, AIRPORT.elev, padW);

  const outW = outpostWeight(x, z);
  if (outW > 0) h = lerp(h, MAP.outpost.elev, outW);

  // Approach corridor. Without this the airfield sits in a bowl with 1,100 ft
  // hills a kilometre off each end of the runway, and every take-off and every
  // approach flies straight into one. Keeping the extended centreline low turns
  // it into a valley through the hills, which is both flyable and good-looking.
  const along = Math.abs(x - AIRPORT.runway.cx);
  const across = Math.abs(z - AIRPORT.runway.cz);
  if (along < CORRIDOR.length && across < CORRIDOR.halfWidth + CORRIDOR.blend) {
    const lateral = 1 - smoothstep(CORRIDOR.halfWidth, CORRIDOR.halfWidth + CORRIDOR.blend, across);
    const longitudinal = 1 - smoothstep(CORRIDOR.fadeFrom, CORRIDOR.length, along);
    const w = lateral * longitudinal;
    const ceiling = AIRPORT.elev + 10;
    if (h > ceiling) h = lerp(h, ceiling, w);
  }

  // And the same the other way, for 18/36. A second runway you cannot approach
  // is not a second runway.
  const along2 = Math.abs(z - AIRPORT.runway2.cz);
  const across2 = Math.abs(x - AIRPORT.runway2.cx);
  if (along2 < CORRIDOR2.length && across2 < CORRIDOR2.halfWidth + CORRIDOR2.blend) {
    const lateral = 1 - smoothstep(CORRIDOR2.halfWidth, CORRIDOR2.halfWidth + CORRIDOR2.blend, across2);
    const longitudinal = 1 - smoothstep(CORRIDOR2.fadeFrom, CORRIDOR2.length, along2);
    const w = lateral * longitudinal;
    const ceiling = AIRPORT.elev + 10;
    if (h > ceiling) h = lerp(h, ceiling, w);
  }

  return h;
}

/** Surface normal from finite differences — used for tyre friction and props. */
export function normalAt(x, z, out = new THREE.Vector3()) {
  const e = 4;
  const hl = heightAt(x - e, z);
  const hr = heightAt(x + e, z);
  const hd = heightAt(x, z - e);
  const hu = heightAt(x, z + e);
  out.set(hl - hr, 2 * e, hd - hu).normalize();
  return out;
}

export function isOnRunway(x, z, margin = 0) {
  const r = AIRPORT.runway;
  return (
    Math.abs(z - r.cz) <= r.halfWidth + margin &&
    Math.abs(x - r.cx) <= r.length / 2 + margin
  );
}

/**
 * The second runway.
 *
 * It used to be assumed north-south, because on Kestrel it is. At a real field
 * the second strip may well be parallel to the first — that is exactly what
 * makes Los Angeles feel like Los Angeles — so it now reads its own heading
 * and tests along whichever axis it actually lies on. Assuming was fine while
 * there was one airport; it is a silent bug the moment there are four.
 */
export function isOnRunway2(x, z, margin = 0) {
  const r = AIRPORT.runway2;
  if (!r) return false;
  const alongX = Math.abs((((r.headingDeg ?? 180) % 180) - 90)) < 45;
  if (alongX) {
    return (
      Math.abs(z - r.cz) <= r.halfWidth + margin &&
      Math.abs(x - r.cx) <= r.length / 2 + margin
    );
  }
  return (
    Math.abs(x - r.cx) <= r.halfWidth + margin &&
    Math.abs(z - r.cz) <= r.length / 2 + margin
  );
}

/** On either runway — what landing scoring and the ATC should ask. */
export function isOnAnyRunway(x, z, margin = 0) {
  return isOnRunway(x, z, margin) || isOnRunway2(x, z, margin);
}

/**
 * Which runway the wind favours, and by how much.
 * Returns the better of the four directions with its head- and crosswind.
 */
export function bestRunway(windDirDeg, windKts) {
  const options = [
    { name: '09', headingDeg: 90, runway: AIRPORT.runway },
    { name: '27', headingDeg: 270, runway: AIRPORT.runway },
    { name: '18', headingDeg: 180, runway: AIRPORT.runway2 },
    { name: '36', headingDeg: 360, runway: AIRPORT.runway2 },
  ].map((o) => {
    const rel = ((windDirDeg - o.headingDeg + 540) % 360) - 180;
    const rad = (rel * Math.PI) / 180;
    return {
      ...o,
      headwind: Math.cos(rad) * windKts,
      crosswind: Math.abs(Math.sin(rad)) * windKts,
    };
  });
  // Most headwind wins; a tailwind is disqualifying before anything else.
  options.sort((a, b) => b.headwind - a.headwind);
  return options[0];
}

/** True when the point is paved (runway, taxiway or apron). */
export function isPaved(x, z) {
  // A steel deck is as paved as it gets.
  if (PLATFORMS.length && platformAt(x, z)) return true;
  if (isOnRunway(x, z, 2)) return true;
  // The crosswind runway.
  if (isOnRunway2(x, z, 2)) return true;
  // Taxiway running parallel, south of the runway.
  if (Math.abs(z + 95) <= 12 && Math.abs(x) <= 430) return true;
  // Two connectors.
  if (Math.abs(x - -430) <= 12 && z >= -95 && z <= 0) return true;
  if (Math.abs(x - 0) <= 12 && z >= -95 && z <= 0) return true;
  // Apron.
  // The apron runs right up to the taxiway edge. It used to stop 3 m short,
  // leaving a strip of grass between them that you had to taxi across.
  if (x >= -260 && x <= 100 && z >= -190 && z <= -106) return true;
  return false;
}

function buildChunk(centerX, centerZ, size, segments, materialFactory) {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const count = pos.count;
  const blend = new Float32Array(count * 3);
  const arr = pos.array;

  // Pass 1: sample the height once per vertex. PlaneGeometry lays vertices out
  // row by row, which lets pass 2 read slopes straight out of this array
  // instead of calling the (expensive) height function four more times.
  const W = segments + 1;
  const heights = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = arr[i * 3] + centerX;
    const z = arr[i * 3 + 2] + centerZ;
    const h = heightAt(x, z);
    heights[i] = h;
    arr[i * 3 + 1] = h;
  }
  pos.needsUpdate = true;

  // Pass 2: slope from neighbouring samples → sand / grass / rock weights.
  const spacing = size / segments;
  for (let iy = 0; iy < W; iy++) {
    for (let ix = 0; ix < W; ix++) {
      const i = iy * W + ix;
      const h = heights[i];
      const hl = heights[iy * W + Math.max(0, ix - 1)];
      const hr = heights[iy * W + Math.min(W - 1, ix + 1)];
      const hd = heights[Math.max(0, iy - 1) * W + ix];
      const hu = heights[Math.min(W - 1, iy + 1) * W + ix];
      const slope = Math.hypot(hr - hl, hu - hd) / (2 * spacing);

      let sand = 1 - smoothstep(2, 30, h);
      let rock = clamp(smoothstep(0.30, 0.95, slope) * 0.9 + smoothstep(150, 300, h) * 0.5, 0, 1);
      let grass = clamp(1 - sand - rock, 0, 1);
      // The airfield plateau is mown grass, never sand or rock.
      const x = arr[i * 3] + centerX;
      const z = arr[i * 3 + 2] + centerZ;
      if (Math.abs(x) < 900 && z > -420 && z < 360 && Math.abs(h - AIRPORT.elev) < 3) {
        sand = 0;
        rock = 0;
        grass = 1;
      }
      const sum = sand + grass + rock || 1;
      blend[i * 3] = sand / sum;
      blend[i * 3 + 1] = grass / sum;
      blend[i * 3 + 2] = rock / sum;
    }
  }

  geo.setAttribute('aBlend', new THREE.BufferAttribute(blend, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, materialFactory());
  mesh.position.set(centerX, 0, centerZ);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

/**
 * Terrain material: three procedural textures blended per-vertex by
 * height + slope, with a low-frequency tint to hide the tiling.
 */
function makeTerrainMaterial() {
  const grass = grassTexture();
  const sand = sandTexture();
  const rock = rockTexture();
  const splat = terrainSplatNoise();
  grass.repeat.set(150, 150);
  sand.repeat.set(150, 150);
  rock.repeat.set(150, 150);
  splat.repeat.set(6, 6);

  // A relief normal map at a different tiling rate from the colour maps gives
  // the ground real surface texture instead of flat shading.
  const nrm = groundNormal().clone();
  nrm.needsUpdate = true;
  nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;
  nrm.repeat.set(620, 620);

  const mat = new THREE.MeshStandardMaterial({
    map: grass,
    normalMap: nrm,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 0.9,
    metalness: 0,
    envMapIntensity: 0.35,
  });

  // Per-map ground tint. The three procedural textures are generated once and
  // shared by every map; a multiply in the shader is what turns tropical green
  // into fjord grey or volcanic ash, for no extra memory and no rebuild cost.
  const tint = PALETTE || {};
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSand = { value: sand };
    shader.uniforms.uRock = { value: rock };
    shader.uniforms.uSplat = { value: splat };
    shader.uniforms.uTintGrass = { value: new THREE.Vector3(...(tint.grass || [1, 1, 1])) };
    shader.uniforms.uTintSand = { value: new THREE.Vector3(...(tint.sand || [1, 1, 1])) };
    shader.uniforms.uTintRock = { value: new THREE.Vector3(...(tint.rock || [1, 1, 1])) };
    shader.uniforms.uShallow = { value: new THREE.Vector3(...(tint.shallow || [0.31, 0.84, 0.78])) };
    // Snow line. Off by default — a start height above anything on the map
    // costs one compare per fragment and changes nothing.
    shader.uniforms.uSnow = { value: new THREE.Vector2(...(tint.snow || [99999, 99999])) };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec3 aBlend;\nvarying vec3 vBlend;\nvarying float vGroundY;'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vBlend = aBlend;\n  vGroundY = position.y;'
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vBlend;
         varying float vGroundY;
         uniform sampler2D uSand;
         uniform sampler2D uRock;
         uniform sampler2D uSplat;
         uniform vec3 uTintGrass;
         uniform vec3 uTintSand;
         uniform vec3 uTintRock;
         uniform vec3 uShallow;
         uniform vec2 uSnow;`
      )
      .replace(
        '#include <map_fragment>',
        `
        // De-tiling: sample every ground texture twice — once at the base
        // scale and once smaller, rotated and offset — then cross-fade with a
        // very low-frequency mask. A single tiled sample reads as an obvious
        // repeating grid from the air; this does not.
        vec2 uvA = vMapUv;
        mat2 rot = mat2(0.8433, -0.5374, 0.5374, 0.8433); // ~32 degrees
        vec2 uvB = rot * vMapUv * 0.41 + vec2(0.37, 0.61);
        float mask = texture2D(uSplat, vMapUv * 0.0045).r;
        mask = smoothstep(0.25, 0.75, mask);

        vec4 texGrass = mix(texture2D(map, uvA), texture2D(map, uvB), mask);
        vec4 texSand  = mix(texture2D(uSand, uvA), texture2D(uSand, uvB), mask);
        vec4 texRock  = mix(texture2D(uRock, uvA), texture2D(uRock, uvB), mask);
        texGrass.rgb *= uTintGrass;
        texSand.rgb  *= uTintSand;
        texRock.rgb  *= uTintRock;
        vec4 blended  = texSand * vBlend.x + texGrass * vBlend.y + texRock * vBlend.z;
        // Large-scale tint breaks up the repeating pattern.
        float tint = texture2D(uSplat, vMapUv * 0.012).r;
        float tint2 = texture2D(uSplat, vMapUv * 0.0031).r;
        blended.rgb *= mix(0.80, 1.16, tint);
        // A second, much larger-scale variation stops the island looking like
        // one flat colour from the air.
        blended.rgb *= mix(0.88, 1.10, tint2);
        // Warm the low ground and cool the high ground very slightly.
        blended.rgb *= mix(vec3(1.03, 1.0, 0.94), vec3(0.95, 0.99, 1.05), vBlend.z);
        // Wet sand. The terrain grid is tens of metres across, so where nearly
        // flat land crosses sea level the waterline lands on polygon edges and
        // reads as a hard staircase from the air. Fading the last few metres
        // into the shallow-water colour hides the geometry under a gradient
        // that matches the sea it meets.
        float wet = 1.0 - smoothstep(-0.6, 3.2, vGroundY);
        blended.rgb = mix(blended.rgb, uShallow, wet * 0.88);
        // Snow on the high ground. The splat noise ragged-edges the snow line
        // so it follows the terrain instead of drawing a contour ring, and
        // steep faces keep their rock — snow does not sit on a cliff.
        float snow = smoothstep(uSnow.x, uSnow.y, vGroundY + (tint - 0.5) * 90.0);
        snow *= 1.0 - vBlend.z * 0.55;
        blended.rgb = mix(blended.rgb, vec3(0.93, 0.95, 0.99), snow);
        diffuseColor *= blended;
        `
      );
  };
  return mat;
}

export function createTerrain(scene, quality = 'high') {
  const group = new THREE.Group();
  group.name = 'terrain';
  const detail = quality === 'low' ? 0.55 : quality === 'medium' ? 0.78 : 1;
  const mat = makeTerrainMaterial();
  const factory = () => mat;

  for (const c of MAP.chunks) {
    group.add(buildChunk(c.cx, c.cz, c.size, Math.round(c.segments * detail), factory));
  }
  scene.add(group);
  return group;
}

/**
 * Scatter helper: returns positions on land that satisfy a predicate.
 * Used for palm trees and the island town.
 */
export function scatter({ cx, cz, radius, count, seed = 1, minH = 3, maxH = 400, maxSlope = 0.4, avoidAirport = true }) {
  const rnd = makeRandom(seed);
  const out = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 40) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * radius;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    const h = heightAt(x, z);
    if (h < minH || h > maxH) continue;
    const e = 12;
    const slope =
      Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) /
      (2 * e);
    if (slope > maxSlope) continue;
    if (avoidAirport && Math.abs(x) < 900 && z > -420 && z < 380) continue;
    // Nothing tall in the approach corridor.
    if (avoidAirport && Math.abs(x) < CORRIDOR.length && Math.abs(z) < CORRIDOR.halfWidth) continue;
    out.push({ x, z, y: h, rot: rnd() * Math.PI * 2, scale: 0.75 + rnd() * 0.6 });
  }
  return out;
}
