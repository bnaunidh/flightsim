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
 *   TOWN       its street plan (worldmap/town-grid.js): the streets everywhere,
 *              the far roofs out past the real buildings' reach;
 *   BIOMES     desert, savanna, jungle and autumn (worldmap/biomes.js, `aBiome`):
 *              each its own ground under all of the above, and its own woods;
 *              mangrove where the marsh is in the jungle;
 *   SNOW       on the cold north's ground (and above 1,150 m anywhere), and the
 *              weather's snow lying over all of it (terrain.js lays that first,
 *              under the cover, where nobody could see it);
 *   DETAIL     fine noise close to the camera, so the ground has grain at
 *              circuit height instead of one smooth colour (not on Low).
 *
 * All of it arithmetic in the fragment shader — no textures beyond the ones
 * terrain.js already binds — and none of it reaches the regular maps, which
 * keep terrain.js's material exactly as it is.
 */
import { makeTerrainMaterial } from '../terrain.js';
import { RENDER_ORIGIN } from '../../render/render-origin.js';
import { GLSL_TOWN, TOWN_ROW as T } from './town-grid.js';

/** The town paint's two knobs, one pair for the whole ground (worldmap/town-stream.js sets them). */
export const TOWN_SHADE = { uTownR: { value: 2000 }, uTownGlow: { value: 0 } };

const VERT_COMMON = `
attribute vec4 aCover;
attribute vec4 aUrban;
attribute vec4 aBiome;
varying vec4 vCover;
varying vec4 vUrban;
varying vec4 vBiome;
varying vec2 vTownCS;
varying vec2 vWXZ;
uniform vec2 uWOrigin;`;
const VERT_BEGIN = `
  vCover = aCover;
  vUrban = aUrban;
  vBiome = aBiome;
  vTownCS = vec2(cos(aUrban.y * 1.5707963267949), sin(aUrban.y * 1.5707963267949));
  vWXZ = (modelMatrix * vec4(transformed, 1.0)).xz + uWOrigin;`;

const FRAG_COMMON = `
varying vec4 vCover;
varying vec4 vUrban;
varying vec4 vBiome;
varying vec2 vTownCS;
varying vec2 vWXZ;
uniform float uTownR;
uniform float uTownGlow;
#define S2L(c) pow(c, vec3(2.2))
float wtH21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float wtNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wtH21(i), wtH21(i + vec2(1.0, 0.0)), f.x), mix(wtH21(i + vec2(0.0, 1.0)), wtH21(i + vec2(1.0, 1.0)), f.x), f.y);
}
/* Blotches with no square grid in them: leaves seen from high up. Turned, pushed about, two sizes. */
float wtCrowns(vec2 p, float s) {
  vec2 q = mat2(0.8, 0.6, -0.6, 0.8) * p + 0.6 * s * vec2(wtNoise(p / (s * 1.7)), wtNoise(p / (s * 1.7) + 7.1));
  return wtNoise(q / s) * 0.62 + wtNoise(mat2(0.6, -0.8, 0.8, 0.6) * q / (s * 0.45) + 3.3) * 0.38;
}${GLSL_TOWN}`;

/**
 * The cover, mixed over terrain.js's `blended` before it is applied. Colours
 * are written in sRGB and turned linear (S2L), the space the shader works in:
 * written straight in, they came out as pale pastels. `DETAIL` is 1.0 on the
 * richer tiers.
 */
const FRAG_COVER = (detail, ring, ringSnow) => `
  vec3 townGlow = vec3(0.0);
  {
    vec2 wp = vWXZ;
    float dist = length(vViewPosition);
    // Latitude: the north is cold, the south tropical (worldmap/landcover.js climateAt).
    float cold = smoothstep(-46000.0, -56000.0, wp.y);
    float trop = smoothstep(21000.0, 27000.0, wp.y);
    float lum = clamp(dot(blended.rgb, vec3(0.299, 0.587, 0.114)) * 3.0, 0.0, 1.0);
    float shadeK = mix(0.8, 1.08, lum);
    vec3 base = blended.rgb;
    float farm = vCover.x;
    float forest = vCover.y;
    float scrub = vCover.z;
    vec4 bio = vBiome;
    // (A desert has no marsh: there the channel says how much dune stands here.)
    float vDune = vCover.w;
    float wet = vCover.w * (1.0 - step(0.5, bio.x));
    // The tide line stays terrain.js's, wet sand into the shallows.
    float shore = smoothstep(0.6, 3.6, vGroundY);
    if (bio.x > 0.01) {
      // Desert: the real dunes (worldmap/biomes.js dunePhase, the same sum), lit soft on the back and dark down the
      // lee face; ripples close to; banded red rock wherever it is steep.
      float da = (dot(wp, vec2(0.82, 0.57)) + 260.0 * sin(wp.x / 1700.0 + 1.3 * sin(wp.y / 2300.0)) + 180.0 * sin(wp.y / 1300.0 + wp.x / 3100.0)) / 560.0;
      float ph = fract(da);
      float tone = wtNoise(mat2(0.8, 0.6, -0.6, 0.8) * wp / 1300.0);
      vec3 dune = mix(vec3(0.90, 0.73, 0.48), vec3(0.79, 0.58, 0.35), tone);
      float amount = vDune * (1.0 - smoothstep(9000.0, 24000.0, dist));
      dune *= 1.0 + amount * (0.1 * smoothstep(0.15, 0.72, ph) - 0.05);
      dune = mix(dune, dune * vec3(0.74, 0.68, 0.65), amount * (0.45 + 0.55 * wtNoise(wp / 700.0)) * smoothstep(0.7, 0.75, ph) * (1.0 - smoothstep(0.9, 1.0, ph)));
      dune *= 1.0 + ${detail} * 0.05 * sin(da * 80.0 + wtNoise(wp / 40.0) * 8.0) * (1.0 - smoothstep(90.0, 340.0, dist));
      float layer = sin(vGroundY * 0.24 + wtNoise(wp / 420.0) * 5.0) * 0.5 + 0.5;
      vec3 strata = mix(vec3(0.47, 0.25, 0.17), vec3(0.76, 0.52, 0.35), layer) * (0.86 + 0.28 * wtNoise(wp / 26.0));
      base = mix(base, S2L(mix(dune, strata, smoothstep(0.1, 0.42, vBlend.z))) * shadeK, bio.x * shore);
    }
    if (bio.y > 0.01) {
      // Savanna: gold grass in big soft drifts, red earth showing through, darker bush along the low places.
      float m = wtNoise(wp / 64.0) * 0.4 + wtNoise(wp / 290.0) * 0.35 + wtNoise(wp / 1500.0) * 0.25;
      vec3 grassy = mix(vec3(0.84, 0.69, 0.33), vec3(0.62, 0.50, 0.24), smoothstep(0.3, 0.7, m));
      grassy = mix(grassy, vec3(0.60, 0.40, 0.24), smoothstep(0.6, 0.72, wtNoise(wp / 760.0 + 4.0)) * 0.65);
      grassy = mix(grassy, vec3(0.42, 0.42, 0.20), smoothstep(0.58, 0.74, wtCrowns(wp + 9.0, 30.0)) * 0.4);
      base = mix(base, S2L(grassy) * shadeK, bio.y * shore * (1.0 - vBlend.z * 0.7));
    }
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
    // Airfield grass in the jungle: less of a pale square among the dark.
    base = mix(base, base * vec3(0.66, 0.82, 0.6), bio.z);
    if (forest > 0.01) {
      // Canopy: dark and mottled — crowns and shadows between them — bluer in the northern conifers, lusher in the south.
      float m = wtNoise(wp / 18.0) * 0.45 + wtNoise(wp / 70.0) * 0.35 + wtNoise(wp / 400.0) * 0.2;
      // And woods of different kinds across the country: lighter, yellower stands among the dark.
      float stand = wtNoise(wp / 1300.0);
      vec3 canopy = mix(mix(vec3(0.12, 0.19, 0.08), vec3(0.24, 0.33, 0.14), m), mix(vec3(0.18, 0.24, 0.09), vec3(0.32, 0.38, 0.16), m), smoothstep(0.55, 0.8, stand));
      canopy = mix(canopy, mix(vec3(0.08, 0.14, 0.10), vec3(0.17, 0.24, 0.17), m), cold);
      canopy = mix(canopy, mix(vec3(0.10, 0.22, 0.08), vec3(0.22, 0.38, 0.13), m), trop);
      if (bio.z > 0.01) {
        // Jungle: a closed roof of big bright crowns with black gaps, paler emergents standing out of it.
        float c = wtCrowns(wp, 26.0) * 0.8 + wtCrowns(wp + 91.0, 120.0) * 0.2;
        vec3 roof = mix(vec3(0.07, 0.19, 0.08), vec3(0.20, 0.38, 0.13), smoothstep(0.3, 0.68, c));
        canopy = mix(canopy, mix(roof, vec3(0.33, 0.47, 0.18), smoothstep(0.66, 0.78, wtCrowns(wp - 40.0, 70.0)) * 0.5), bio.z);
      }
      if (bio.w > 0.01) {
        // Autumn: stands of gold, orange and scarlet with the evergreens dark among them.
        float st = wtCrowns(wp + 17.0, 64.0) * 0.6 + wtCrowns(wp, 20.0) * 0.4;
        vec3 turn = mix(vec3(0.50, 0.21, 0.12), vec3(0.64, 0.36, 0.15), smoothstep(0.3, 0.44, st));
        turn = mix(turn, vec3(0.68, 0.52, 0.22), smoothstep(0.47, 0.6, st));
        turn = mix(turn, vec3(0.24, 0.31, 0.16), smoothstep(0.62, 0.72, st) * 0.85);
        // Close in the trees stand on their own: what is between them is fallen leaves, not a painted roof.
        turn = mix(mix(turn, vec3(0.42, 0.31, 0.18), 0.6), turn, smoothstep(200.0, 900.0, dist));
        canopy = mix(canopy, turn * (0.78 + 0.34 * m), bio.w);
      }
      // The cold band's woods: snow on the ground between the dark crowns.
      canopy = mix(canopy, mix(vec3(0.15, 0.21, 0.18), vec3(0.84, 0.87, 0.93), smoothstep(0.26, 0.5, wtCrowns(wp, 15.0))), cold);
      base = mix(base, S2L(canopy) * shadeK, forest);
    }
    if (scrub > 0.01) {
      float m = wtNoise(wp / 35.0) * 0.6 + wtNoise(wp / 260.0) * 0.4;
      vec3 heath = mix(vec3(0.50, 0.46, 0.30), vec3(0.34, 0.33, 0.20), m);
      heath = mix(heath, mix(vec3(0.46, 0.42, 0.36), vec3(0.34, 0.36, 0.30), m), cold * 0.7);
      heath = mix(heath, mix(vec3(0.66, 0.58, 0.38), vec3(0.50, 0.48, 0.28), m), trop * 0.6);
      heath = mix(heath, mix(vec3(0.80, 0.66, 0.34), vec3(0.58, 0.48, 0.26), m), clamp(bio.x + bio.y, 0.0, 1.0));
      base = mix(base, S2L(heath) * shadeK, scrub);
    }
    if (wet > 0.01) {
      float pool = smoothstep(0.6, 0.68, wtNoise(wp / 50.0));
      vec3 marsh = mix(vec3(0.27, 0.32, 0.17), vec3(0.20, 0.30, 0.33), pool);
      if (bio.z > 0.01) {
        // Mangrove: a dark wet thicket on mud, tidal creeks winding through it.
        float creek = 1.0 - smoothstep(0.012, 0.05, abs(wtCrowns(wp, 240.0) - 0.5));
        vec3 thicket = mix(vec3(0.08, 0.19, 0.10), vec3(0.19, 0.31, 0.14), wtCrowns(wp, 26.0));
        thicket = mix(thicket, vec3(0.30, 0.25, 0.17), smoothstep(0.6, 0.7, wtNoise(wp / 34.0 + 5.0)) * 0.7);
        marsh = mix(marsh, mix(thicket, vec3(0.13, 0.27, 0.27), creek), bio.z);
      }
      base = mix(base, S2L(marsh) * shadeK, wet);
    }
    // How much street and house there is here: snow lies on it thinner (below).
    float townK = 0.0;
    if (vUrban.x > 0.01 && vUrban.w > 0.1) {
      // A town: its street plan (worldmap/town-grid.js), the same arithmetic the buildings stand on. The streets
      // are drawn here at every distance. A building's roof is drawn here only beyond the buildings' reach
      // (uTownR); inside it the real one stands on the very same rectangle, so nothing doubles and nothing pops.
      // Gardens fade into the country; a street stops where the last house does.
      float um = smoothstep(0.12, 0.42, vUrban.x);
      float us = smoothstep(0.3, 0.36, vUrban.x);
      float zone = vUrban.z;
      int clim = int(vUrban.w * 4.0 - 0.5);
      // A pixel's width on the ground, the long way: at a shallow angle a street edge has to be blurred along the view.
      vec2 wpf = fwidth(wp);
      float aa = max(0.25, 0.8 * max(wpf.x, wpf.y));
      // How much fine grain and lot-to-lot difference the distance can carry without shimmering.
      float grain = 1.0 - smoothstep(350.0, 1100.0, dist);
      vec2 Q = townQ(wp, vTownCS);
      vec2 bf = floor(Q / vec2(TPU, TPV));
      ivec2 bi = ivec2(bf);
      vec2 f = Q - bf * vec2(TPU, TPV);
      bool mU0 = tMainU(bi.x);
      bool mU1 = tMainU(bi.x + 1);
      bool mV0 = tMainV(bi.y);
      bool mV1 = tMainV(bi.y + 1);
      vec2 h0 = vec2(mU0 ? ${T.ROW_MAIN} : ${T.ROW}, mV0 ? ${T.ROW_MAIN} : ${T.ROW});
      vec2 h1 = vec2(mU1 ? ${T.ROW_MAIN} : ${T.ROW}, mV1 ? ${T.ROW_MAIN} : ${T.ROW});
      vec2 e0 = f - h0;
      vec2 e1 = vec2(TPU, TPV) - f - h1;
      vec2 e = min(e0, e1);
      float edge = min(e.x, e.y);
      bool acrossU = e.x < e.y;
      bool streetMain = acrossU ? (e0.x < e1.x ? mU0 : mU1) : (e0.y < e1.y ? mV0 : mV1);
      float walk = streetMain ? ${T.WALK_MAIN} : ${T.WALK};
      float roadK = 1.0 - smoothstep(-walk - aa, -walk + aa, edge);
      float pavedK = 1.0 - smoothstep(-aa, aa, edge);
      uint bh = tuh(bi.x, bi.y, 1);
      vec3 garden = TGARDEN[clim];
      vec3 roofMean = 0.5 * (TROOF[clim * 6] + TROOF[clim * 6 + 3]);
      float far = ${detail === '1.0' ? 'smoothstep(2600.0, 7000.0, dist)' : 'smoothstep(1500.0, 3600.0, dist)'};
      vec3 townCol = mix(garden, roofMean, 0.3) * (0.9 + 0.2 * tub(bh, 16u));
      float lit = 0.0;
      if (far < 1.0) {
        vec3 lotCol = garden * (0.86 + 0.26 * tub(bh, 24u));
        float uA = h0.x;
        float uB = TPU - h1.x;
        float vA = h0.y;
        float vB = TPV - h1.y;
        float n = float(5u + ((bh >> 8u) & 3u));
        float lotW = (uB - uA) / n;
        int r = f.y > 0.5 * (vA + vB) ? 1 : 0;
        int k = clamp(int(floor((f.x - uA) / lotW)), 0, int(n) - 1);
        uint lh = tuh(bi.x * 8 + k, bi.y * 2 + r, 2);
        uint h2 = tuh(bi.x * 8 + k, bi.y * 2 + r, 3);
        bool park = (bh & 255u) < 16u;
        bool onMain = r == 0 ? mV0 : mV1;
        bool shop = onMain && zone < 0.5;
        float coreK = (1.0 - smoothstep(0.235, 0.265, zone)) * (park ? 0.0 : 1.0);
        float w;
        float d;
        float t0;
        float off = 0.0;
        if (shop) {
          w = lotW - 0.7;
          d = 11.0 + 5.0 * tub(lh, 8u);
          t0 = 1.2;
          if (k == 0 || k == int(n) - 1) {
            w -= ${T.SHOP_END};
            off = (k == 0 ? 0.5 : -0.5) * ${T.SHOP_END};
          }
        } else {
          w = min(lotW - 3.2, 8.0 + 5.0 * tub(lh, 0u));
          d = 8.0 + 4.5 * tub(lh, 8u);
          t0 = 4.5 + 4.0 * tub(lh, 16u);
          off = (lotW - 3.2 - w) * (tub(lh, 24u) - 0.5);
        }
        vec2 c = vec2(uA + (float(k) + 0.5) * lotW + off, r == 0 ? vA + t0 + 0.5 * d : vB - t0 - 0.5 * d);
        vec2 sd = abs(f - c) - 0.5 * vec2(w, d);
        float rect = max(sd.x, sd.y);
        float t = r == 0 ? f.y - vA : vB - f.y;
        // The garden: each its own green, hedges down the backs and between the plots.
        lotCol *= 1.0 + (0.2 * tub(h2, 0u) - 0.1) * (1.0 - smoothstep(500.0, 1500.0, dist));
        float back = 0.5 * (vB - vA) - t;
        float side = min(f.x - uA - float(k) * lotW, uA + (float(k) + 1.0) * lotW - f.x);
        float hedge = max(1.0 - smoothstep(0.5, 1.1 + aa, back), (1.0 - smoothstep(0.2, 0.6 + aa, side)) * 0.75) * (1.0 - smoothstep(500.0, 1800.0, dist));
        lotCol = mix(lotCol, vec3(0.20, 0.30, 0.14), hedge * 0.75 * us);
        if (shop) {
          // Shops: paved out to the street, a yard behind, then the gardens of the row behind them.
          lotCol = mix(lotCol, vec3(0.58, 0.55, 0.50), us * (1.0 - smoothstep(t0 + d + 6.0, t0 + d + 6.0 + aa, t)));
        } else {
          // The drive, on the house's own +x side (town-grid.js), from the kerb to its door.
          float dw = c.x + (r == 1 ? 1.0 : -1.0) * (0.5 * w - 1.5);
          float dk = (1.0 - smoothstep(1.35, 1.35 + aa, abs(f.x - dw))) * (1.0 - smoothstep(t0, t0 + aa, t));
          lotCol = mix(lotCol, vec3(0.55, 0.54, 0.51), dk * us);
        }
        if (park) {
          // A park: mown grass, paths across it.
          vec2 pc = f - 0.5 * vec2(uA + uB, vA + vB);
          float path = 1.0 - smoothstep(1.2, 1.8 + aa, min(abs(pc.x * 0.55 - pc.y), abs(pc.x * 0.55 + pc.y)));
          lotCol = mix(garden * 1.08, vec3(0.62, 0.58, 0.48), path);
        } else {
          // Roofs: only out where the real ones have stopped; none on a lot the plan leaves as garden.
          float q = tub(lh, 4u);
          float empty = (q < 0.08 + 0.3 * (1.0 - smoothstep(0.4, 0.8, vUrban.x))) && !shop ? 0.0 : 1.0;
          float fade = smoothstep(uTownR * 0.72, uTownR * 0.92, dist);
          vec3 roof = shop ? vec3(0.5, 0.5, 0.49) : TROOF[clim * 6 + int(tub(h2, 8u) * 5.999)];
          float rk = (1.0 - smoothstep(-aa, aa, rect)) * empty * step(0.36, vUrban.x);
          lotCol = mix(lotCol, roof, rk * fade);
          lit = rk * step(0.55, tub(h2, 16u)) * mix(0.45, 1.0, fade) * fade;
          // The ground darkens a little round every building, the real ones too: it stands on something.
          lotCol *= 1.0 - 0.2 * empty * (1.0 - fade) * step(0.0, rect) * (1.0 - smoothstep(0.0, 3.0, rect));
        }
        // Downtown: paved block to block; the buildings on it are worldmap/outstation.js's.
        // (Slabs, a block's own shade: pale stone, not a car park.)
        vec2 slab = abs(fract(wp / 6.0) - 0.5);
        float joint = smoothstep(0.46, 0.5, max(slab.x, slab.y)) * (1.0 - smoothstep(150.0, 500.0, dist));
        lotCol = mix(lotCol, vec3(0.66, 0.64, 0.60) * (0.94 + 0.12 * tub(bh, 16u)) * (1.0 - 0.1 * joint), coreK);
        lotCol = mix(lotCol, lotCol * (0.9 + 0.2 * wtNoise(wp / 9.0)), ${detail} * grain);
        townCol = mix(lotCol, townCol, far);
      }
      // The street: asphalt with its pavements and kerbs, a broken line down a main one, close in.
      vec3 asph = vec3(0.335, 0.32, 0.30) * (0.99 + grain * (0.14 * wtNoise(wp / 6.0) - 0.07));
      float along = acrossU ? Q.y : Q.x;
      float centre = acrossU ? min(f.x, TPU - f.x) : min(f.y, TPV - f.y);
      if (streetMain) {
        float near0 = 1.0 - smoothstep(350.0, 900.0, dist);
        // Not across a crossing.
        float dash = (1.0 - smoothstep(0.1, 0.16 + aa * 0.5, centre)) * step(0.5, fract(along / 9.0)) * step(0.0, max(e.x, e.y) + walk);
        asph = mix(asph, vec3(0.78, 0.77, 0.72), dash * near0);
      }
      vec3 walkCol = vec3(0.70, 0.67, 0.61) * (1.0 + grain * (0.1 * wtNoise(wp / 11.0) - 0.05));
      vec3 streetCol = mix(walkCol, asph, roadK);
      // The kerb: a pale line between them.
      float kerb = (1.0 - smoothstep(0.18, 0.2 + aa, abs(edge + walk))) * (1.0 - smoothstep(300.0, 1000.0, dist));
      streetCol = mix(streetCol, vec3(0.74, 0.73, 0.70), kerb * 0.8);
      base = mix(base, S2L(townCol) * shadeK, um);
      // From higher up a street is a thin pale line among the roofs, not a dark band as wide as the blur.
      streetCol = mix(streetCol, vec3(0.44, 0.43, 0.41), smoothstep(700.0, 2600.0, dist) * 0.65);
      base = mix(base, S2L(streetCol) * shadeK, pavedK * us / (1.0 + aa * 0.28));
      townK = um * mix(0.35, 0.8, pavedK * us);
      // After dark: the street lamps' pools on the road, and the far windows.
      if (uTownGlow > 0.0) {
        float pool = exp(-pow(mod(along, 36.0) - 18.0, 2.0) / 90.0);
        float lamp = mix(0.25 + 0.75 * pool, 0.42, smoothstep(250.0, 1400.0, dist));
        // Past the kerb it spills a little way onto the verges and the gardens.
        float spill = exp(-max(edge, 0.0) / 3.5);
        float glow = spill * lamp * (streetMain ? 0.15 : 0.085);
        townGlow = (vec3(1.0, 0.70, 0.40) * glow + vec3(1.0, 0.78, 0.5) * lit * 0.06) * us * uTownGlow;
      }
    }
    // Snow: the north's hills and fells, and anything above 1,150 m.
    float sline = mix(1150.0, 110.0, cold) + (wtNoise(wp / 900.0) - 0.5) * 240.0 + (wtNoise(wp / 170.0) - 0.5) * 110.0;
    ${ringSnow}
    // Petrel Skerry, the Nunatak Ice Strip's island: it lies 14 m above the sea, far under the north's snow line, so
    // the strip of packed snow stood on bare ground and read as a white slab (owner, 2026-11-05). Snow to the waterline.
    sline = mix(sline, -200.0, 1.0 - smoothstep(3000.0, 3800.0, distance(wp, vec2(16980.0, -83040.0))));
    float snowC = smoothstep(sline, sline + 190.0, vGroundY) * (1.0 - vBlend.z * 0.5);
    // The cold band's low ground: lying in drifts, thin on the rock. And the weather's snow, over everything.
    // (Not past the sea: the ring keeps its own snow line.)
    snowC = max(snowC, cold * smoothstep(2.0, 16.0, vGroundY) * smoothstep(0.34, 0.56, wtNoise(wp / 260.0) * 0.6 + wtNoise(wp / 58.0) * 0.4) * (1.0 - vBlend.z * 0.7) * 0.92 * (1.0 - smoothstep(101000.0, 104000.0, max(abs(wp.x), abs(wp.y)))));
    snowC = max(snowC, uSnowCover * smoothstep(0.5, 3.0, vGroundY) * mix(0.75, 1.0, tint) * (1.0 - vBlend.z * 0.55)) * (1.0 - townK);
    base = mix(base, vec3(0.86, 0.89, 0.95), snowC);
    ${ring}
    // Grain close in.
    float near = ${detail} * (1.0 - smoothstep(250.0, 1400.0, dist));
    if (near > 0.0) {
      float g = wtNoise(wp / 7.0) * 0.5 + wtNoise(wp / 23.0) * 0.5;
      base *= mix(1.0, 0.86 + 0.28 * g, near);
    }
    blended.rgb = base;
  }
  totalEmissiveRadiance += townGlow;
`;

/**
 * The World Map's ground material: terrain.js's, plus the land cover, plus
 * `ring`, the range's snow line and the Farlands' paint (worldmap/farlands-look.js)
 * when they have loaded.
 * Shares terrain.js's textures; its own shader program.
 */
export function makeWorldTerrainMaterial(quality = 'medium', ring = {}) {
  const mat = makeTerrainMaterial(quality);
  const rich = quality !== 'low';
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    base(shader, renderer);
    shader.uniforms.uWOrigin = RENDER_ORIGIN;
    Object.assign(shader.uniforms, TOWN_SHADE);
    shader.vertexShader = shader.vertexShader
      .replace('varying float vGroundY;', 'varying float vGroundY;' + VERT_COMMON)
      .replace('vGroundY = position.y;', 'vGroundY = position.y;' + VERT_BEGIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('uniform float uSeaCut;', 'uniform float uSeaCut;' + FRAG_COMMON)
      .replace('diffuseColor *= blended;', FRAG_COVER(rich ? '1.0' : '0.0', ring.frag || '', ring.snow || '') + '\n        diffuseColor *= blended;');
  };
  mat.customProgramCacheKey = () => (rich ? 'world-terrain-rich' : 'world-terrain') + (ring.frag ? '-ring' : '');
  mat.userData.worldTerrain = true;
  return mat;
}
