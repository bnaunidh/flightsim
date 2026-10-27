/**
 * World Map — Preview: the ground's material.
 *
 * terrain.js's material (the three textures, the de-tiling, the cliffs, the
 * cloud shadows, the wet sand, the snow line) with the land cover painted on
 * top, from each vertex's cover (worldmap/landcover.js, `aCover`) and the
 * world position:
 *
 *   FARMLAND   a patchwork of fields — the grid turned a different way in
 *              each district, its edges a little wandering — each field one
 *              crop (wheat, pasture, ploughed earth, rapeseed, hay; cane,
 *              plantation and red earth in the tropics; pasture and moor in
 *              the north), hedgerows dark along the edges, plough rows in
 *              them close up;
 *   FOREST     dark mottled canopy, the colour the trees on it are;
 *   SCRUB      olive and brown heath;
 *   MARSH      dark reed-green with pools of water in it;
 *   SNOW       on the cold north's high ground (and above 1,300 m anywhere);
 *   DETAIL     fine noise close to the camera, so the ground has grain at
 *              circuit height instead of one smooth colour (not on Low).
 *
 * All of it arithmetic in the fragment shader — no textures beyond the ones
 * terrain.js already binds — and none of it reaches the regular maps, which
 * keep terrain.js's material exactly as it is.
 */
import { makeTerrainMaterial } from '../terrain.js';
import { RENDER_ORIGIN } from '../../render/render-origin.js';

const VERT_COMMON = `
attribute vec4 aCover;
attribute float aUrban;
varying vec4 vCover;
varying float vUrban;
varying vec2 vWXZ;
uniform vec2 uWOrigin;`;
const VERT_BEGIN = `
  vCover = aCover;
  vUrban = aUrban;
  vWXZ = (modelMatrix * vec4(transformed, 1.0)).xz + uWOrigin;`;

const FRAG_COMMON = `
varying vec4 vCover;
varying float vUrban;
varying vec2 vWXZ;
#define S2L(c) pow(c, vec3(2.2))
float wtH21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float wtNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wtH21(i), wtH21(i + vec2(1.0, 0.0)), f.x), mix(wtH21(i + vec2(0.0, 1.0)), wtH21(i + vec2(1.0, 1.0)), f.x), f.y);
}`;

/**
 * The cover, mixed over terrain.js's `blended` before it is applied. Colours
 * are written in sRGB and turned linear (S2L), the space the shader works in:
 * written straight in, they came out as pale pastels. `DETAIL` is 1.0 on the
 * richer tiers.
 */
const FRAG_COVER = (detail) => `
  {
    vec2 wp = vWXZ;
    float dist = length(vViewPosition);
    // Latitude: the north is cold, the south tropical (worldmap/landcover.js climateAt).
    float cold = smoothstep(-92000.0, -112000.0, wp.y);
    float trop = smoothstep(45000.0, 62000.0, wp.y);
    float lum = clamp(dot(blended.rgb, vec3(0.299, 0.587, 0.114)) * 3.0, 0.0, 1.0);
    float shadeK = mix(0.8, 1.08, lum);
    vec3 base = blended.rgb;
    float farm = vCover.x;
    float forest = vCover.y;
    float scrub = vCover.z;
    float wet = vCover.w;
    if (farm > 0.01) {
      // Each farming district (5 km) has its own grid, turned its own way; the field edges wander a little.
      vec2 dc = floor(wp / 5200.0);
      float ang = 1.5708 * wtH21(dc + 0.37);
      float ca = cos(ang);
      float sa = sin(ang);
      vec2 q = vec2(ca * wp.x - sa * wp.y, sa * wp.x + ca * wp.y);
      q += (vec2(wtNoise(wp / 420.0), wtNoise(wp / 420.0 + 7.3)) - 0.5) * 60.0;
      vec2 size = vec2(300.0, 190.0) * (0.75 + 0.6 * wtH21(dc + 1.9));
      vec2 cell = floor(q / size);
      vec2 f = fract(q / size);
      float r = wtH21(cell + dc * 17.0);
      vec3 crop;
      if (r < 0.14) crop = vec3(0.74, 0.64, 0.38);
      else if (r < 0.46) crop = vec3(0.42, 0.54, 0.25);
      else if (r < 0.70) crop = vec3(0.33, 0.45, 0.21);
      else if (r < 0.81) crop = vec3(0.47, 0.37, 0.27);
      else if (r < 0.85) crop = vec3(0.74, 0.70, 0.30);
      else crop = vec3(0.56, 0.56, 0.35);
      // No two fields of the same crop the same shade, and grain within each.
      crop *= 0.88 + 0.24 * wtH21(cell + 9.1);
      crop *= 0.9 + 0.2 * wtNoise(wp / 45.0);
      vec3 tropCrop = r < 0.35 ? vec3(0.40, 0.58, 0.20) : r < 0.6 ? vec3(0.24, 0.42, 0.16) : r < 0.78 ? vec3(0.58, 0.34, 0.22) : vec3(0.52, 0.62, 0.28);
      crop = mix(crop, tropCrop, trop);
      crop = mix(crop, r < 0.5 ? vec3(0.40, 0.50, 0.30) : vec3(0.44, 0.40, 0.30), cold);
      vec3 field = S2L(crop) * shadeK;
      // Plough rows, close in only (a stripe a few metres apart aliases into a shimmer further out).
      float rowsK = ${detail} * (1.0 - smoothstep(250.0, 650.0, dist));
      field *= 1.0 - rowsK * 0.1 * (0.5 + 0.5 * sin(f.x * size.x * 1.3));
      // The hedgerows round the fields (not in the open north), faded out before they are thinner than a pixel.
      vec2 e = min(f, 1.0 - f) * size;
      float hedge = (1.0 - smoothstep(2.5, 6.0, min(e.x, e.y))) * (1.0 - cold * 0.8) * step(0.3, wtH21(cell + 3.7));
      hedge *= 1.0 - smoothstep(1200.0, 3200.0, dist);
      field = mix(field, S2L(vec3(0.17, 0.25, 0.11)) * shadeK, hedge);
      base = mix(base, field, farm);
    }
    if (forest > 0.01) {
      // Canopy: dark and mottled — crowns and shadows between them — bluer in the northern conifers, lusher in the south.
      float m = wtNoise(wp / 18.0) * 0.45 + wtNoise(wp / 70.0) * 0.35 + wtNoise(wp / 400.0) * 0.2;
      // And woods of different kinds across the country: lighter, yellower stands among the dark.
      float stand = wtNoise(wp / 1300.0);
      vec3 canopy = mix(mix(vec3(0.12, 0.19, 0.08), vec3(0.24, 0.33, 0.14), m), mix(vec3(0.18, 0.24, 0.09), vec3(0.32, 0.38, 0.16), m), smoothstep(0.55, 0.8, stand));
      canopy = mix(canopy, mix(vec3(0.08, 0.14, 0.10), vec3(0.17, 0.24, 0.17), m), cold);
      canopy = mix(canopy, mix(vec3(0.10, 0.22, 0.08), vec3(0.22, 0.38, 0.13), m), trop);
      base = mix(base, S2L(canopy) * shadeK, forest);
    }
    if (scrub > 0.01) {
      float m = wtNoise(wp / 35.0) * 0.6 + wtNoise(wp / 260.0) * 0.4;
      vec3 heath = mix(vec3(0.50, 0.46, 0.30), vec3(0.34, 0.33, 0.20), m);
      heath = mix(heath, mix(vec3(0.46, 0.42, 0.36), vec3(0.34, 0.36, 0.30), m), cold * 0.7);
      heath = mix(heath, mix(vec3(0.66, 0.58, 0.38), vec3(0.50, 0.48, 0.28), m), trop * 0.6);
      base = mix(base, S2L(heath) * shadeK, scrub);
    }
    if (wet > 0.01) {
      float pool = smoothstep(0.6, 0.68, wtNoise(wp / 50.0));
      vec3 marsh = mix(vec3(0.27, 0.32, 0.17), vec3(0.20, 0.30, 0.33), pool);
      base = mix(base, S2L(marsh) * shadeK, wet);
    }
    if (vUrban > 0.01) {
      // A town on the ground beyond its houses: blocks of roofs and gardens between streets, a park here and there
      // (the 3D buildings stand in the middle; this is the rest of the place, the way a satellite picture shows it).
      vec2 dc2 = floor(wp / 3000.0);
      float ang2 = 1.5708 * wtH21(dc2 + 5.1);
      float c2 = cos(ang2);
      float s2 = sin(ang2);
      vec2 q2 = vec2(c2 * wp.x - s2 * wp.y, s2 * wp.x + c2 * wp.y);
      vec2 blk = vec2(96.0, 72.0);
      vec2 bc = floor(q2 / blk);
      vec2 be = min(fract(q2 / blk), 1.0 - fract(q2 / blk)) * blk;
      float far = smoothstep(1500.0, 4000.0, dist);
      float street = (1.0 - smoothstep(4.0, 6.5, min(be.x, be.y))) * (1.0 - far);
      float rb = wtH21(bc);
      vec2 lsz = vec2(17.0, 13.0);
      vec2 lc = floor(q2 / lsz);
      vec2 le = min(fract(q2 / lsz), 1.0 - fract(q2 / lsz)) * lsz;
      float roofK = smoothstep(1.2, 2.4, min(le.x, le.y)) * step(0.28, wtH21(lc + 1.7));
      roofK = mix(roofK, 0.55, far);
      float lr = wtH21(lc);
      vec3 roof = lr < 0.42 ? vec3(0.58, 0.36, 0.28) : lr < 0.72 ? vec3(0.46, 0.46, 0.48) : vec3(0.34, 0.32, 0.31);
      vec3 garden = vec3(0.34, 0.46, 0.24);
      float park = step(0.88, rb);
      vec3 townCol = mix(S2L(garden), S2L(roof) * (0.85 + 0.3 * lr), roofK * (1.0 - park));
      townCol = mix(townCol, S2L(vec3(0.33, 0.33, 0.34)), street);
      base = mix(base, townCol * shadeK, clamp(vUrban, 0.0, 1.0));
    }
    // Snow: the north's hills and fells, and anything above 1,300 m.
    float sline = mix(1300.0, 110.0, cold) + (wtNoise(wp / 900.0) - 0.5) * 120.0;
    float snowC = smoothstep(sline, sline + 90.0, vGroundY) * (1.0 - vBlend.z * 0.5);
    base = mix(base, vec3(0.86, 0.89, 0.95), snowC);
    // Grain close in.
    float near = ${detail} * (1.0 - smoothstep(250.0, 1400.0, dist));
    if (near > 0.0) {
      float g = wtNoise(wp / 7.0) * 0.5 + wtNoise(wp / 23.0) * 0.5;
      base *= mix(1.0, 0.86 + 0.28 * g, near);
    }
    blended.rgb = base;
  }
`;

/**
 * The World Map's ground material: terrain.js's, plus the land cover.
 * Shares terrain.js's textures; its own shader program.
 */
export function makeWorldTerrainMaterial(quality = 'medium') {
  const mat = makeTerrainMaterial(quality);
  const rich = quality !== 'low';
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    base(shader, renderer);
    shader.uniforms.uWOrigin = RENDER_ORIGIN;
    shader.vertexShader = shader.vertexShader
      .replace('varying float vGroundY;', 'varying float vGroundY;' + VERT_COMMON)
      .replace('vGroundY = position.y;', 'vGroundY = position.y;' + VERT_BEGIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('uniform float uSeaCut;', 'uniform float uSeaCut;' + FRAG_COMMON)
      .replace('diffuseColor *= blended;', FRAG_COVER(rich ? '1.0' : '0.0') + '\n        diffuseColor *= blended;');
  };
  mat.customProgramCacheKey = () => (rich ? 'world-terrain-rich' : 'world-terrain');
  mat.userData.worldTerrain = true;
  return mat;
}
