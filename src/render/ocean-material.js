/**
 * The sea's surface shader, and the depth field it reads.
 *
 * One plane, one material, lit by hand rather than through
 * MeshStandardMaterial — because a sea is not a lit solid. What the eye reads
 * on real water, in rough order of importance:
 *
 *   1. Fresnel: the sea is a mirror at a grazing angle and nearly clear when
 *      you look straight down into it. So the horizon is the SKY's colour
 *      exactly (no horizon line: the two meet), and the water under the
 *      aeroplane is the colour of the water itself.
 *   2. Depth: turquoise over a sandy shelf, the bottom showing through in a
 *      metre of water, deep blue past the drop-off. The height field is
 *      sampled into a small texture of the map once per build (buildDepthField)
 *      so the shader knows how deep every pixel is.
 *   3. The sun: one bright glitter path, sharp near the aeroplane and broad
 *      and soft toward the horizon (a GGX lobe whose roughness grows with
 *      distance, which is also what stops it shimmering out there).
 *   4. Waves that do not tile: three octaves of one procedural normal map, in
 *      WORLD metres (23, 97 and 410 m), each moving its own way with the
 *      wind. Nothing repeats at a visible period, the plane can follow the
 *      camera by any amount without the pattern sliding, and the fine octave
 *      fades out with distance so the far sea is calm shading, not noise.
 *   5. Foam: a wash at the beach that rolls in with the waves, and whitecaps
 *      on a rough day.
 *
 * Everything is in the same display space as the sky dome (which encodes to
 * sRGB and is not tone mapped), so the reflection and the sky are the same
 * colour where they meet, and the scene fog is applied the way three applies
 * it to everything else.
 *
 * Cost. Low: two normal taps and the depth texture — less than the two
 * stacked MeshStandardMaterial planes with an environment map that this
 * replaces. High adds the fine octave and two foam taps.
 */

import * as THREE from '../vendor/three.module.js';
import { waterNormal, foamTexture } from './textures.js';
import { heightAt, MAP } from '../world/terrain.js';
import { SEA_DEPTH } from './depth-layers.js';
import { RENDER_ORIGIN } from './render-origin.js';

/**
 * The depth texture: the height field, sampled over the map's chunks (which
 * is where every island is; outside them the sea floor is flat) at
 * `texel` metres a sample. Metres of water are stored as bytes over 0..40 m
 * (land is 0), which covers the sea floor (-34). Bilinear filtering between
 * a land texel and a water texel shallows smoothly to the beach, near
 * enough for a foam band.
 *
 * Cost: heightAt is about 6 µs a call, so a 13 km map at 60 m is ~47 k
 * samples, a quarter of a second once per world build. Low samples coarser.
 */
export const DEPTH_MAX = 40;

export function depthTexelFor(quality) {
  return quality === 'low' ? 110 : quality === 'medium' ? 80 : quality === 'ultra' ? 45 : 60;
}

export function buildDepthField(quality = 'high', { pad = 600, maxN = quality === 'low' ? 160 : 320, foamWeight = null } = {}) {
  const chunks = (MAP && MAP.chunks) || [];
  if (!chunks.length) return null;
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const c of chunks) {
    x0 = Math.min(x0, c.cx - c.size / 2);
    x1 = Math.max(x1, c.cx + c.size / 2);
    z0 = Math.min(z0, c.cz - c.size / 2);
    z1 = Math.max(z1, c.cz + c.size / 2);
  }
  x0 -= pad;
  z0 -= pad;
  x1 += pad;
  z1 += pad;
  // Square, so one texel size serves both axes.
  const size = Math.max(x1 - x0, z1 - z0);
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  let texel = depthTexelFor(quality);
  let n = Math.ceil(size / texel);
  if (n > maxN) {
    n = maxN;
    texel = size / n;
  }
  n = Math.max(16, n);
  // Two channels: metres of water, and how much surf belongs here (none in
  // a harbour: foamWeight, see Ocean.bandWeight).
  const data = new Uint8Array(n * n * 2);
  const half = size / 2;
  for (let j = 0; j < n; j++) {
    const z = cz - half + (j + 0.5) * (size / n);
    for (let i = 0; i < n; i++) {
      const x = cx - half + (i + 0.5) * (size / n);
      // Depth, not height: land is 0, so the filter between a land texel and a
      // water texel shallows smoothly to the beach instead of jumping across
      // a cliff's height in one texel (which drew the shelf as a staircase).
      const d = Math.max(0, -heightAt(x, z));
      const k = (j * n + i) * 2;
      data[k] = Math.round(THREE.MathUtils.clamp(d / DEPTH_MAX, 0, 1) * 255);
      data[k + 1] = foamWeight ? Math.round(THREE.MathUtils.clamp(foamWeight(x, z), 0, 1) * 255) : 255;
    }
  }
  const texture = new THREE.DataTexture(data, n, n, THREE.RGFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.name = 'sea-depth';
  texture.needsUpdate = true;
  // (origin x, origin z, 1 / size, has field) for uv = (xz - origin) / size + 0.5.
  const xform = new THREE.Vector4(cx, cz, 1 / size, 1);
  return { texture, xform, n, texel, size, cx, cz, data };
}

/** Read the depth field the way the shader does (nearest texel), for tests: metres of water, 0 on land. */
export function depthAtField(field, x, z) {
  if (!field) return 34;
  const u = (x - field.cx) * field.xform.z + 0.5;
  const v = (z - field.cz) * field.xform.z + 0.5;
  if (u < 0 || u > 1 || v < 0 || v > 1) return 34;
  const i = Math.min(field.n - 1, Math.floor(u * field.n));
  const j = Math.min(field.n - 1, Math.floor(v * field.n));
  return (field.data[(j * field.n + i) * 2] / 255) * DEPTH_MAX;
}

const VERT = /* glsl */ `
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  #include <common>
  #include <fog_pars_fragment>
  varying vec3 vWorld;

  uniform float uTime;
  uniform sampler2D uNormalMap;
  uniform sampler2D uFoamMap;
  uniform sampler2D uDepthMap;
  uniform vec4 uDepthXform;   // origin x, origin z, 1/size, has field
  uniform vec2 uRenderOrigin;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSandy;
  uniform vec3 uSkyTop;
  uniform vec3 uSkyHorizon;
  uniform vec3 uLightDir;     // the sun by day, the moon by night
  uniform vec3 uLightColor;
  uniform float uGlint;       // strength of the glitter path
  uniform float uGlintRough;  // its base roughness
  uniform float uBodyLight;   // how lit the water itself is (day 1, night ~0.1)
  uniform float uChop;        // wave steepness
  uniform vec2 uWindDir;      // which way the waves travel (unit)
  uniform vec3 uFoamColor;
  uniform float uCaps;        // whitecaps, 0 calm .. 1 storm

  vec2 nrm(vec2 uv) {
    return texture2D(uNormalMap, uv).xy * 2.0 - 1.0;
  }

  void main() {
    vec3 toCam = cameraPosition - vWorld;
    float dist = length(toCam);
    vec3 V = toCam / max(dist, 1e-3);
    // The pattern is in world metres: the draw's floating origin added back
    // (render/render-origin.js; zero except far out on the World Map).
    vec2 p = vWorld.xz + uRenderOrigin;
    float t = uTime;
    vec2 w = uWindDir;
    vec2 wp = vec2(-w.y, w.x);

    // Waves: three octaves in world metres, each on its own course.
    float fine = exp(-dist / 900.0);
    float mid = exp(-dist / 6000.0);
    vec2 n = nrm(p / 410.0 + w * t * 0.012) * 0.55;
    mat2 rot = mat2(0.86, -0.5, 0.5, 0.86);
    n += nrm((rot * p) / 97.0 + (w * 0.7 + wp * 0.4) * t * 0.045) * 0.6 * (0.3 + 0.7 * mid);
    #if WATER_DETAIL > 0
      n += nrm(p / 23.0 + (w - wp * 0.6) * t * 0.11) * 0.7 * fine;
    #endif
    n *= uChop;
    // A normal that still tilts at fifteen kilometres is aliasing, not waves.
    n *= mix(1.0, 0.1, smoothstep(2000.0, 15000.0, dist));
    vec3 N = normalize(vec3(n.x, 1.0, n.y));

    // How deep the water is here.
    vec2 duv = (p - uDepthXform.xy) * uDepthXform.z + 0.5;
    vec2 field = texture2D(uDepthMap, duv).rg;
    float depth = mix(34.0, field.r * 40.0, uDepthXform.w);

    // The water's own colour: the shelf, the sand showing through close in.
    // The maps' sea floors are steep (7 m down 20 m off the beach, 34 m by
    // 200 m), so the depth is read generously or the shelf would be a strip.
    float shelf = exp(-depth / 12.0);
    float sandy = exp(-depth / 2.0);
    vec3 body = mix(uDeep, uShallow, shelf);
    body = mix(body, uSandy, sandy * 0.6);
    float NdL = max(dot(N, uLightDir), 0.0);
    body *= uBodyLight * (0.7 + 0.3 * NdL);

    // Fresnel: a mirror at a grazing angle, clear from above.
    float NdV = max(dot(N, V), 0.0);
    float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);

    // The sky this pixel reflects, in the dome's own gradient.
    vec3 R = reflect(-V, N);
    float ry = clamp(R.y, 0.0, 1.0);
    // Bluer than the dome's own gradient at the horizon: wave slopes reflect
    // the sky overhead more than a flat mirror would, and a sea that only
    // mirrored the pale horizon haze read as grey from a boat (measured:
    // boat-playtest P20, mean saturation 0.24 against the 0.33 it asks for).
    vec3 sky = mix(uSkyHorizon, uSkyTop, pow(ry, 0.5));
    sky = mix(sky, uSkyTop, 0.3);
    sky = mix(sky, uSkyHorizon * 1.12, exp(-ry * 9.0) * 0.35);
    vec3 col = mix(body, sky, min(F * 0.85, 0.88));

    // The glitter path: a GGX lobe, sharper close by, broad toward the horizon.
    vec3 H = normalize(uLightDir + V);
    float NdH = max(dot(N, H), 0.0);
    float a = uGlintRough + smoothstep(400.0, 12000.0, dist) * 0.09;
    float a2 = a * a;
    float dd = NdH * NdH * (a2 - 1.0) + 1.0;
    float D = a2 / (PI * dd * dd);
    float Fh = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
    float spec = D * Fh * 0.3 * uGlint;
    spec = spec / (1.0 + spec);
    col += uLightColor * spec;

    // Foam: the wash at the beach, and whitecaps on a rough day.
    #if WATER_DETAIL > 0
      float foamA = texture2D(uFoamMap, p / 14.0 + w * t * 0.02).a;
      float foamB = texture2D(uFoamMap, (rot * p) / 31.0 - wp * t * 0.015).a;
    #else
      float foamA = 0.5;
      float foamB = 0.5;
    #endif
    // Surf: only where the shelf meets the beach, and never in a harbour (field.g).
    float shoreK = smoothstep(7.0, 0.8, depth) * smoothstep(0.0, 0.5, depth) * field.g * uDepthXform.w;
    float wash = 0.55 + 0.45 * sin(depth * 1.1 - t * 1.4 + foamA * 3.0);
    float foam = shoreK * wash * (0.5 + foamA * 1.2);
    // Whitecaps: on the steepest crests, mostly near, where the fine octave
    // still shapes them (further out they read as a pale patch, not caps).
    float cap = smoothstep(1.1, 1.5, length(n)) * uCaps * foamB * (0.35 + 0.65 * fine);
    foam = clamp(foam + cap, 0.0, 1.0);
    col = mix(col, uFoamColor, foam * 0.9);

    // Lightning is NOT added here: the sea is half the screen, and the
    // flash-safety contract (tests/features/flicker.browser.js) caps how
    // much of the screen a strike may flash. The sky and the sun do it.
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/** The shader sources, for the node checks (tests/features/ocean.mjs). */
export const OCEAN_SHADERS = { VERT, FRAG };

/**
 * The sea material. `field` is from buildDepthField (null: a flat deep sea).
 * Low has no fine ripple octave and no foam texture.
 */
export function createOceanMaterial(quality = 'high', field = null) {
  const normalMap = waterNormal().clone();
  normalMap.needsUpdate = true;
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.anisotropy = quality === 'low' ? 2 : 8;
  const foamMap = foamTexture().clone();
  foamMap.needsUpdate = true;
  foamMap.wrapS = foamMap.wrapT = THREE.RepeatWrapping;
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uNormalMap: { value: null },
      uFoamMap: { value: null },
      uDepthMap: { value: null },
      uDepthXform: { value: new THREE.Vector4(0, 0, 1, 0) },
      uRenderOrigin: RENDER_ORIGIN,
      uDeep: { value: new THREE.Color(0x123a5e) },
      uShallow: { value: new THREE.Color(0.31, 0.84, 0.78) },
      uSandy: { value: new THREE.Color(0xb9a77c) },
      uSkyTop: { value: new THREE.Color(0x2f6fd0) },
      uSkyHorizon: { value: new THREE.Color(0xbcd7f2) },
      uLightDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
      uLightColor: { value: new THREE.Color(0xfff4e0) },
      uGlint: { value: 1 },
      uGlintRough: { value: 0.07 },
      uBodyLight: { value: 1 },
      uChop: { value: 0.8 },
      uWindDir: { value: new THREE.Vector2(1, 0) },
      uFoamColor: { value: new THREE.Color(0xffffff) },
      uCaps: { value: 0 },
    },
  ]);
  // merge() clones values; textures are set after so they are shared, not cloned.
  uniforms.uNormalMap.value = normalMap;
  uniforms.uFoamMap.value = foamMap;
  if (field) {
    uniforms.uDepthMap.value = field.texture;
    uniforms.uDepthXform.value.copy(field.xform);
  } else {
    // A one-texel "deep everywhere" so the sampler is never unbound.
    const data = new Uint8Array([255, 255]);
    const tex = new THREE.DataTexture(data, 1, 1, THREE.RGFormat, THREE.UnsignedByteType);
    tex.needsUpdate = true;
    uniforms.uDepthMap.value = tex;
    uniforms.uDepthXform.value.set(0, 0, 1, 0);
  }
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    defines: { WATER_DETAIL: quality === 'low' ? 0 : 1 },
    fog: true,
    // Behind everything at sea level (render/depth-layers.js).
    ...SEA_DEPTH.deep,
  });
  mat.name = 'ocean';
  mat.userData.textures = [normalMap, foamMap, uniforms.uDepthMap.value];
  return mat;
}
