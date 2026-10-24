/**
 * Reflective surfaces: glass, metal cladding and wet tarmac.
 *
 * Three things the world's materials could not do on their own:
 *
 *   1. REFLECT THE SKY. On Medium and up the sky is pre-filtered into an
 *      environment map every couple of seconds (sky.js) and every
 *      MeshStandardMaterial in the scene picks it up through
 *      scene.environment. A glass curtain wall, a tower cab or a hangar's
 *      cladding only needs the right roughness, metalness and
 *      envMapIntensity, which glassMaterial() and metalMaterial() give it.
 *      Low has NO environment map (main.js: a cube render plus a filter chain
 *      is exactly what a school laptop cannot afford), so there a material
 *      would reflect nothing and glass reads as grey card. Low's glass and
 *      metal get a FAKE instead: a few lines added to the standard shader
 *      that reflect an analytic sky — a horizon-to-zenith gradient and a sun
 *      highlight — with no texture read at all. It is not the real sky, but
 *      it is blue where the sky is blue, warm at sunset and gone at night.
 *
 *   2. GLINT AT SUNSET. With the sun a few degrees up, glass facing it
 *      flares. The real sun is in the environment map (its disc is in the
 *      sky shader the map is made from) and the directional light's specular
 *      term already does the rest; what was missing was the strength: the
 *      map is averaged over the sky and a low sun through it is weak.
 *      updateSurfaces() lifts every glass material's envMapIntensity while
 *      the sun is low and the sky clear, and feeds the Low fake the same.
 *
 *   3. WET AFTER RAIN. Rain (weather.cond.rain) wets the runway, the
 *      taxiways and the apron: the tarmac goes darker and glossy, with
 *      puddles where the roughness map says the surface dips, and the sky
 *      reflects in it. The wetness is a slow state, not the rain itself: it
 *      takes half a minute of rain to soak the field and several minutes of
 *      dry weather to dry it, so a shower leaves a sheen behind it.
 *
 * Every material made here is registered so updateSurfaces() can drive it;
 * resetSurfaces() empties the registry when the world is rebuilt, which is
 * also when the tier is set (main.js buildWorldSteps, beside setPaintTier).
 */

import * as THREE from '../vendor/three.module.js';

let tier = 'high';

/** The registry: what updateSurfaces() drives. Cleared by resetSurfaces(). */
const glass = [];
const wet = [];

/** Wetness of the field, 0 dry .. 1 soaked. */
let wetness = 0;
/** The low-sun glint factor, 0 .. 1, as last computed. */
let glint = 0;
/** What was last written to the registered materials, so writes only happen on change. */
let _lastGlint = -1;
let _lastWet = -1;
let _paletteTimer = 1;

export function setSurfaceTier(q) {
  tier = q === 'low' || q === 'medium' || q === 'high' || q === 'ultra' ? q : 'high';
}

export function surfaceTier() {
  return tier;
}

/** True when this tier lights its materials from the sky's environment map. */
export function surfacesHaveEnvMap() {
  return tier !== 'low';
}

/** Forget every registered material (the world is being rebuilt) and set the tier. */
export function resetSurfaces(q) {
  if (q) setSurfaceTier(q);
  glass.length = 0;
  wet.length = 0;
  _lastGlint = -1;
  _lastWet = -1;
}

/** For tests and the HUD: how wet the field is right now. */
export function fieldWetness() {
  return wetness;
}

export function sunGlint() {
  return glint;
}

/** Jump the wetness (a world built in the rain starts wet; tests). */
export function setFieldWetness(w) {
  wetness = Math.max(0, Math.min(1, Number(w) || 0));
}

/* ------------------------------------------------------------------ *
 * Low's fake sky
 * ------------------------------------------------------------------ */

/*
 * One set of uniform objects shared by every fake-sky material, so a single
 * write in updateSurfaces() reaches all of them: the sky's zenith and horizon
 * colours, the sun's direction and colour, and the glint factor.
 */
/** How wet the field is, for the shaders that gate their puddle map on it. */
export const WET_UNIFORM = { value: 0 };

export const FAKE_SKY = {
  uFakeZenith: { value: new THREE.Color(0x3b74c4) },
  uFakeHorizon: { value: new THREE.Color(0xc5dbee) },
  uFakeSunDir: { value: new THREE.Vector3(0.5, 0.7, 0.5).normalize() },
  uFakeSun: { value: new THREE.Color(0xfff2d4) },
  uFakeGlint: { value: 0 },
  uFakeNight: { value: 0 },
};

const FAKE_SKY_GLSL = /* glsl */ `
  {
    // The reflection direction in world space, and the sky colour there.
    vec3 fakeR = reflect(-geometryViewDir, geometryNormal);
    fakeR = inverseTransformDirection(fakeR, viewMatrix);
    float fakeUp = clamp(fakeR.y, 0.0, 1.0);
    vec3 fakeSky = mix(uFakeHorizon, uFakeZenith, pow(fakeUp, 0.65));
    // Looking down into the reflection: ground, not sky — darker and duller.
    fakeSky *= mix(0.32, 1.0, smoothstep(-0.25, 0.05, fakeR.y));
    fakeSky *= 1.0 - 0.85 * uFakeNight;
    // Schlick: the specular colour at normal incidence, white at grazing.
    float fakeNoV = clamp(dot(geometryNormal, geometryViewDir), 0.0, 1.0);
    float fakeFres = pow(1.0 - fakeNoV, 4.0);
    vec3 fakeF = material.specularColor + (1.0 - material.specularColor) * fakeFres;
    float fakeGloss = 1.0 - material.roughness;
    vec3 fakeRefl = fakeSky * fakeF * fakeGloss * fakeGloss * uFakeStrength;
    // The sun's disc in the glass.
    float fakeSunSpec = pow(max(dot(fakeR, uFakeSunDir), 0.0), 180.0) * fakeGloss * fakeGloss;
    fakeRefl += uFakeSun * fakeF * fakeSunSpec * (0.5 + uFakeGlint * 2.5) * (1.0 - uFakeNight);
    outgoingLight += fakeRefl;
  }
`;

/**
 * Give a MeshStandardMaterial the analytic sky reflection. `strength` scales
 * the sky term (the sun term is scaled by the material's own gloss).
 */
export function fakeSkyReflection(mat, strength = 1) {
  mat.userData.fakeSky = strength;
  mat.onBeforeCompile = (shader) => {
    for (const k of Object.keys(FAKE_SKY)) shader.uniforms[k] = FAKE_SKY[k];
    shader.uniforms.uFakeStrength = { value: strength };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uFakeZenith; uniform vec3 uFakeHorizon; uniform vec3 uFakeSunDir; uniform vec3 uFakeSun; uniform float uFakeGlint; uniform float uFakeNight; uniform float uFakeStrength;'
      )
      .replace('#include <opaque_fragment>', FAKE_SKY_GLSL + '\n#include <opaque_fragment>');
  };
  // Materials with different strengths need different programs.
  mat.customProgramCacheKey = () => 'fakeSky:' + strength;
  return mat;
}

/* ------------------------------------------------------------------ *
 * Material factories
 * ------------------------------------------------------------------ */

function remember(mat, base) {
  mat.userData.surface = {
    roughness: mat.roughness,
    metalness: mat.metalness,
    envMapIntensity: mat.envMapIntensity,
    color: mat.color.clone(),
    ...base,
  };
  return mat;
}

/**
 * Glass: a curtain wall, a tower cab, a shop front. `map` is the glazing
 * (mullions and tint) and `emissiveMap` the lit panes after dark, both
 * optional. Opaque unless `opacity` < 1.
 *
 * Medium and up: a low-roughness standard material; the sky's environment
 * map is the reflection. High and Ultra reflect a little harder (their
 * environment map has more of the sky in it). Low: the fake sky.
 */
export function glassMaterial({ map = null, emissiveMap = null, color = 0xffffff, opacity = 1, side = THREE.FrontSide, roughness = null, metalness = null, envMapIntensity = null, tint = null } = {}) {
  const low = tier === 'low';
  const mat = new THREE.MeshStandardMaterial({
    map,
    color,
    emissiveMap,
    emissive: emissiveMap ? new THREE.Color(0xffffff) : new THREE.Color(0x000000),
    emissiveIntensity: 0,
    roughness: roughness ?? (low ? 0.18 : 0.12),
    metalness: metalness ?? (low ? 0.35 : 0.55),
    envMapIntensity: envMapIntensity ?? (tier === 'ultra' ? 1.45 : tier === 'high' ? 1.3 : 1.15),
    transparent: opacity < 1,
    opacity,
    side,
  });
  if (tint) mat.color.set(tint);
  if (low) fakeSkyReflection(mat, 1.0);
  remember(mat, { kind: 'glass' });
  mat.envMapIntensity = mat.userData.surface.envMapIntensity * (1 + 0.9 * glint);
  glass.push(mat);
  return mat;
}

/**
 * Metal cladding: a hangar's ribbed sheet, a roof's standing seams, a
 * stainless trim. Mostly roughness; it reflects the sky softly.
 */
export function metalMaterial({ map = null, normalMap = null, normalScale = 0.6, color = 0xffffff, roughness = 0.46, metalness = 0.6, side = THREE.FrontSide, vertexColors = false, envMapIntensity = null } = {}) {
  const low = tier === 'low';
  const mat = new THREE.MeshStandardMaterial({
    map,
    normalMap: low ? null : normalMap,
    normalScale: new THREE.Vector2(normalScale, normalScale),
    color,
    roughness: low ? Math.min(1, roughness + 0.08) : roughness,
    metalness: low ? metalness * 0.75 : metalness,
    envMapIntensity: envMapIntensity ?? (tier === 'ultra' ? 1.0 : tier === 'high' ? 0.9 : 0.8),
    side,
    vertexColors,
  });
  if (low) fakeSkyReflection(mat, 0.55);
  remember(mat, { kind: 'metal' });
  mat.envMapIntensity = mat.userData.surface.envMapIntensity * (1 + 0.9 * glint);
  glass.push(mat);
  return mat;
}

/**
 * Register a tarmac material (the runway, the shoulders, the taxiways and
 * apron) to go wet in the rain. `puddles` is a roughness map, white where
 * the surface is flat and darker in the dips; on Low it is not applied (one
 * texture read fewer in every pixel of the biggest surface there is).
 */
export function registerWetSurface(mat, { puddles = null } = {}) {
  if (!mat) return mat;
  if (puddles && tier !== 'low' && !mat.roughnessMap) {
    mat.roughnessMap = puddles;
    gatePuddles(mat);
    mat.needsUpdate = true;
  }
  remember(mat, { kind: 'wet' });
  // No fake sky on Low's tarmac: the runway and the apron are the biggest
  // surfaces on screen, and a few extra instructions in every one of their
  // pixels was the one measurable cost of this lane on Low (+5-8% on the
  // apron spots). Wet, Low's tarmac still darkens and goes glossy — the
  // sun's own specular gives it the sheen — it just does not mirror the sky.
  wet.push(mat);
  applyWet(mat);
  return mat;
}

/*
 * The puddle map only counts when the field is wet.
 *
 * three.js multiplies the roughness by the map in every pixel, so a map with
 * dark dips made mirror puddles on a bone-dry apron (the first cut of this,
 * at sunset: a black apron with the sun in it). The chunk that reads the map
 * is replaced by one that fades the map in with the wetness uniform: dry,
 * the roughness is the material's own; soaked, the dips are glass.
 */
function gatePuddles(mat) {
  mat.userData.puddlesGated = true;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWet = WET_UNIFORM;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWet;')
      .replace(
        '#include <roughnessmap_fragment>',
        'float roughnessFactor = roughness;\n#ifdef USE_ROUGHNESSMAP\n  vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );\n  roughnessFactor *= mix( 1.0, texelRoughness.g, uWet );\n#endif'
      );
  };
  mat.customProgramCacheKey = () => 'wetPuddles';
  return mat;
}

/** How many materials of each kind are registered (tests). */
export function surfaceCounts() {
  return { glass: glass.filter((m) => m.userData.surface.kind === 'glass').length, metal: glass.filter((m) => m.userData.surface.kind === 'metal').length, wet: wet.length };
}

/* ------------------------------------------------------------------ *
 * Per-frame drive
 * ------------------------------------------------------------------ */

const _sun = new THREE.Vector3();
const _dark = new THREE.Color();
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Wet tarmac: darker, glossier, and the sky in it. */
function applyWet(mat) {
  const b = mat.userData.surface;
  const w = wetness;
  mat.roughness = b.roughness + (0.3 - b.roughness) * w;
  mat.metalness = b.metalness + (0.1 - b.metalness) * w;
  mat.envMapIntensity = b.envMapIntensity + (1.5 - b.envMapIntensity) * w;
  _dark.copy(b.color).multiplyScalar(0.55);
  mat.color.copy(b.color).lerp(_dark, w);
}

/**
 * Called once a frame from the game loop, with the weather and the frame's
 * dt. Everything here is a handful of material property writes; nothing
 * recompiles and nothing allocates.
 */
export function updateSurfaces(weather, dt = 1 / 60) {
  if (!weather || !weather.cond) return;
  const c = weather.cond;
  const el = weather.timeInfo ? weather.timeInfo.sunElev : 60;

  // Wetness: soaks in about 30 s of real rain, dries over about 4 minutes.
  const want = Math.max(0, Math.min(1, c.rain || 0));
  const step = dt > 0 ? dt : 0;
  if (want > wetness) wetness = Math.min(want, wetness + step / 30);
  else if (want < wetness) wetness = Math.max(want, wetness - step / 240);

  // The glint: the sun between a few degrees under and ten over the horizon,
  // weighted down by cloud.
  glint = smooth(-4, 1, el) * (1 - smooth(9, 22, el)) * (1 - Math.min(1, c.cloud) * 0.9);

  // Materials on Low read the sky from these uniforms; the palette is read
  // a few times a second (it allocates colours).
  _paletteTimer += step;
  if (tier === 'low' && _paletteTimer > 0.25 && typeof weather.palette === 'function') {
    _paletteTimer = 0;
    const p = weather.palette();
    FAKE_SKY.uFakeZenith.value.copy(p.top);
    FAKE_SKY.uFakeHorizon.value.copy(p.horizon);
    FAKE_SKY.uFakeSun.value.copy(p.sun);
    weather.sunDirection(_sun);
    FAKE_SKY.uFakeSunDir.value.copy(_sun);
    FAKE_SKY.uFakeNight.value = weather.isNight ? 1 : 0;
  }
  FAKE_SKY.uFakeGlint.value = glint;
  WET_UNIFORM.value = wetness;

  if (Math.abs(glint - _lastGlint) > 0.01) {
    _lastGlint = glint;
    for (const m of glass) {
      const b = m.userData.surface;
      m.envMapIntensity = b.envMapIntensity * (1 + 0.9 * glint);
    }
  }
  // Written on a change worth a pixel, and always at the ends: bone dry and
  // soaked must be exact, not 0.003 of either.
  if (wetness !== _lastWet && (Math.abs(wetness - _lastWet) > 0.004 || wetness === 0 || wetness === 1)) {
    _lastWet = wetness;
    for (const m of wet) applyWet(m);
  }
}
