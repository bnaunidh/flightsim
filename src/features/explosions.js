/**
 * Explosions — the one place in the game that knows how to go bang.
 *
 * WHAT WAS WRONG. The practice bomb went off as a sphere that swelled for a
 * second, a ring and a dust ball. Measured from 700 m — a bomber at 1,000 ft
 * looking at its own hit — the fireball was 20 px across and gone in a
 * second; the thunder clip played the instant it landed however far away you
 * were, so the sound and the picture never agreed; and from the chase camera
 * you could not see it at all, because a bomb lands UNDER and behind the
 * aeroplane that dropped it, which is sixty degrees below anything the
 * camera looks at. "Make bombs more satisfying" was the wishlist item.
 *
 * The first version of this file fixed the sound and the pooling and kept
 * real-world sizes: an 11 m fireball, a smoke column that stopped rising at
 * 30 m. Seen in the game it was a pinprick and a grey smudge. So the sizes
 * here are cartoon sizes, chosen by looking at the screen, not by looking
 * up a bomb:
 *
 *   - a FLASH, 130 m of white light for a quarter of a second, a real light
 *     on the ground round it, and the whole sky lifting a little if you are
 *     close (at night, that is the show);
 *   - a FIREBALL about 60 m across that blooms, rolls upward and goes sooty —
 *     solid orange puffs so it reads against a bright sky, with additive
 *     glow on top so it reads at night;
 *   - SPARKS and DEBRIS thrown out on arcs, the chunks trailing smoke and
 *     bouncing once before they lie still;
 *   - a SHOCKWAVE ring running 170 m out along the ground and a skirt of dust;
 *   - a SMOKE COLUMN that climbs to about 150 m and leans with the wind;
 *   - a SCORCH mark (a crater, for a meteor) laid ON the ground as drawn —
 *     not on a flat disc floating over a hillside, see renderedHeight();
 *   - the camera SHAKE and the BOOM, together, when the pressure wave reaches
 *     the listener at 340 m/s. A bomb 1.7 km away is seen five seconds before
 *     it is heard, which is what makes it feel enormous;
 *   - a BOMB CAM: your own bomb, when it hits, gets three seconds of camera
 *     from beside the blast, then the camera comes back. Changing the view
 *     (C, the touch button, the pad) skips it; no key is taken for it.
 *
 * Far away, the flash, the fireball and the column are drawn bigger than
 * life (3.7 times at 4 km), so a blast across the island is still a blast
 * and not a single orange pixel.
 *
 * Water gets a white column, a crown, ripples and (for a hot meteor) steam
 * instead of fire and a scorch mark.
 *
 * WHY IT IS BUILT THIS WAY: the class plays on 2019 Chromebooks.
 *   - Everything is pooled and made at world build. A bang allocates nothing
 *     on the GPU; twenty in a row reuse the same buffers.
 *   - All the fire, sparks and smoke are THREE draw calls: an additive batch,
 *     a star batch and a smoke batch of camera-facing quads, each an
 *     instanced geometry whose live particles are packed at the front, so
 *     only live ones are uploaded and drawn. All debris is one InstancedMesh.
 *     All scorch marks are one mesh.
 *   - The light is a single PointLight that lives in the scene from world
 *     build onwards at zero intensity — the same thing wreck.js and the
 *     volcano do. Adding and removing lights changes the light count every
 *     lit shader was compiled for, and recompiling every material in the
 *     world on the frame of a bang is the exact stutter this is meant to
 *     avoid.
 *   - The shaders are compiled at world build, not on the first bang.
 *
 * Kid-appropriate on purpose: cartoon-satisfying, no people, no wreckage of
 * anything that looks like a building or a vehicle — rocks, dirt and smoke.
 *
 * CONTRACT (fixed between teams): `explode(sim, pos, { size, kind })`.
 *   size 1 is a practice bomb (fireball radius R = 22 m). Meteors pass 0.3–6.
 *   kind  'bomb' (default) | 'meteor' | 'airburst' | 'shatter' | 'sparkle' |
 *         'splash'. Anything else is treated as 'bomb'. WHERE it goes off
 *         decides the rest: over the sea near the surface it is a splash,
 *         well above the ground it is an airburst, on land it is a ground
 *         blast. 'splash' is always a splash, on land too (a water drop, a
 *         burst tank).
 *   'airburst' is a drone or missile going down: a real fireball — bright
 *   core, orange, then sooty smoke — a short shock ring and a handful of
 *   burning chunks thrown out, arcing down on their own smoke trails (they
 *   splash and go if they reach water). Smaller for a missile than a drone
 *   because `size` is smaller, same shapes. 'shatter' is a meteor zapped out
 *   of the sky: rock does not burn like fuel, so it is mostly glowing
 *   fragments on arcs and a drifting dust cloud, with only a small fireball
 *   at the centre — never a scorch mark, there being no ground under it.
 *   'sparkle' remains for cosmetic, non-destructive pops (collecting
 *   stardust) — a four-point rainbow sparkle, no fire, no boom, no shake.
 *   extra options (all optional): silent (no boom), burnup (a meteor burning
 *   up on its own in the dodge missions: sparks and a pale puff, no debris,
 *   not a dark flak burst), gentle (on land: a cartoon thud — dust, dirt,
 *   stars and a crater, no fire or black smoke; for something landing where
 *   people live).
 * Returns a small description of what it did, or null if it could not.
 */

import * as THREE from '../vendor/three.module.js';
import { FLASH, CAPS, FlashGate, FlashSmoother, screenOpacity, shakeClock } from '../render/flash-safety.js';
import { registerExtension, extLayer, extStatus } from '../game/extensions.js';
import * as Terrain from '../world/terrain.js';

export const SOUND_SPEED = 340;
const GRAV = 9.81;

/** Fireball radius in metres for a given size. Size 1 (a practice bomb) is 22 m. */
export function blastRadius(size) {
  return 22 * Math.pow(Math.max(0.05, size), 0.6);
}

// Pool sizes. Measured with the dev button's twenty-in-a-row: peaks of about
// 1,100 glow and 1,900 smoke inside the first five seconds. When a pool is
// full new particles are simply not made — the bang gets thinner, the frame
// rate does not drop.
const GLOW_CAP = 1800;
const SMOKE_CAP = 2200;
const STAR_CAP = 400;
const DEBRIS_CAP = 180;
const DECAL_CAP = 28;
const DECAL_N = 7; // vertices per side of a decal patch
const RING_CAP = 10;
const BLAST_CAP = 24;
const KINDS = ['bomb', 'meteor', 'airburst', 'shatter', 'sparkle', 'splash'];

/** Seconds for a sound to travel `metres`. */
export function soundDelay(metres) {
  return Math.max(0, metres) / SOUND_SPEED;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);

function safeHeight(x, z) {
  try {
    const h = Terrain.heightAt(x, z);
    return Number.isFinite(h) ? h : 0;
  } catch (e) {
    return 0;
  }
}

/**
 * The height of the terrain AS DRAWN, not as defined.
 *
 * heightAt() is the true ground. The terrain mesh is that function sampled on
 * a grid 39 m apart on Kestrel and joined with flat triangles, so between the
 * vertices the picture can sit metres above or below the function. A scorch
 * mark placed at heightAt() on a hillside was buried on one side and floating
 * on the other. This rebuilds the triangle the mesh actually drew — same grid,
 * same diagonal PlaneGeometry uses (terrain.js buildChunk, the same detail
 * factor per quality) — and takes the highest chunk where two chunks overlap,
 * because that is the one that wins the depth test.
 */
export function renderedHeight(x, z, quality = 'high', cache = null) {
  const map = Terrain.MAP;
  const chunks = map && map.chunks;
  if (!chunks || !chunks.length) return safeHeight(x, z);
  const detail = quality === 'low' ? 0.55 : quality === 'medium' ? 0.78 : quality === 'ultra' ? 1.4 : 1;
  let best = -Infinity;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const segs = Math.max(1, Math.round(c.segments * detail));
    const half = c.size / 2;
    const lx = x - (c.cx - half);
    const lz = z - (c.cz - half);
    if (lx < 0 || lz < 0 || lx > c.size || lz > c.size) continue;
    const sp = c.size / segs;
    let ix = Math.floor(lx / sp);
    let iz = Math.floor(lz / sp);
    if (ix >= segs) ix = segs - 1;
    if (iz >= segs) iz = segs - 1;
    const fu = lx / sp - ix;
    const fv = lz / sp - iz;
    const x0 = c.cx - half + ix * sp;
    const z0 = c.cz - half + iz * sp;
    const ha = vertexHeight(cache, i, ix, iz, x0, z0);
    const hb = vertexHeight(cache, i, ix, iz + 1, x0, z0 + sp);
    const hd = vertexHeight(cache, i, ix + 1, iz, x0 + sp, z0);
    let h;
    if (fu + fv <= 1) h = ha + fu * (hd - ha) + fv * (hb - ha);
    else {
      const hc = vertexHeight(cache, i, ix + 1, iz + 1, x0 + sp, z0 + sp);
      h = hc + (1 - fu) * (hb - hc) + (1 - fv) * (hd - hc);
    }
    if (h > best) best = h;
  }
  return best === -Infinity ? safeHeight(x, z) : best;
}

/**
 * One terrain-mesh vertex height, remembered for the length of one decal: its
 * 49 points mostly fall in the same two or three triangles, and asking
 * heightAt() about the same corners again was 0.3 ms per bang.
 */
function vertexHeight(cache, chunk, ix, iz, x, z) {
  if (!cache) return safeHeight(x, z);
  const key = (chunk * 8192 + ix) * 8192 + iz;
  let h = cache.get(key);
  if (h === undefined) {
    h = safeHeight(x, z);
    cache.set(key, h);
  }
  return h;
}
const HCACHE = new Map();

/* ====================================================================== */
/* Textures: drawn once per page, shared by every world build              */
/* ====================================================================== */

let TEX = null;

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function radial(g, x, y, r, stops) {
  const grd = g.createRadialGradient(x, y, 0, x, y, r);
  for (const [at, col] of stops) grd.addColorStop(at, col);
  g.fillStyle = grd;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

function textures() {
  if (TEX) return TEX;
  const R = seeded(1977);

  // Soft glow: a hot core and a long falloff. Fire, sparks, flashes, trails.
  const glowC = canvas(64, 64);
  radial(glowC.getContext('2d'), 32, 32, 32, [
    [0, 'rgba(255,255,255,1)'],
    [0.16, 'rgba(255,255,255,0.86)'],
    [0.42, 'rgba(255,255,255,0.3)'],
    [1, 'rgba(255,255,255,0)'],
  ]);

  // Smoke: seven overlapping blobs, so a puff has lumps instead of being a
  // perfect disc — a column of perfect discs reads as a stack of coins. The
  // middle is nearly solid, so a puff of fire colour reads as a flame and
  // not as a tint.
  const smokeC = canvas(64, 64);
  const sg = smokeC.getContext('2d');
  radial(sg, 32, 32, 22, [
    [0, 'rgba(255,255,255,0.7)'],
    [0.6, 'rgba(255,255,255,0.45)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  for (let i = 0; i < 7; i++) {
    const a = R() * Math.PI * 2;
    const d = R() * 9;
    radial(sg, 32 + Math.cos(a) * d, 32 + Math.sin(a) * d, 15 + R() * 8, [
      [0, 'rgba(255,255,255,0.55)'],
      [0.55, 'rgba(255,255,255,0.28)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
  }

  // Four-point star for the sparkles.
  const starC = canvas(64, 64);
  const st = starC.getContext('2d');
  radial(st, 32, 32, 14, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]);
  st.fillStyle = 'rgba(255,255,255,0.9)';
  for (let k = 0; k < 4; k++) {
    st.save();
    st.translate(32, 32);
    st.rotate((k * Math.PI) / 2);
    st.beginPath();
    st.moveTo(0, -3.2);
    st.lineTo(30, 0);
    st.lineTo(0, 3.2);
    st.closePath();
    st.fill();
    st.restore();
  }

  // Shockwave ring: nothing in the middle, a bright band, a soft edge.
  const ringC = canvas(128, 128);
  radial(ringC.getContext('2d'), 64, 64, 64, [
    [0, 'rgba(255,255,255,0)'],
    [0.62, 'rgba(255,255,255,0)'],
    [0.86, 'rgba(255,255,255,0.9)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  // Foam patch on water: a lumpy white disc.
  const foamC = canvas(128, 128);
  const fg = foamC.getContext('2d');
  for (let i = 0; i < 14; i++) {
    const a = R() * Math.PI * 2;
    const d = R() * 30;
    radial(fg, 64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 18 + R() * 16, [
      [0, 'rgba(255,255,255,0.5)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
  }

  /*
   * Decals: an atlas, scorch on the left, crater on the right. Drawn as the
   * colour the ground is MULTIPLIED by, with alpha as coverage — see the
   * blend mode in Decals. Each lives inside a circle of radius 0.35 of its
   * half, so a patch rotated to any angle never samples the other half.
   */
  const decC = canvas(256, 128);
  const dg = decC.getContext('2d');
  // Scorch.
  radial(dg, 64, 64, 45, [
    [0, 'rgba(22,16,12,0.96)'],
    [0.5, 'rgba(34,26,18,0.85)'],
    [0.8, 'rgba(52,40,28,0.45)'],
    [1, 'rgba(60,48,34,0)'],
  ]);
  for (let i = 0; i < 26; i++) {
    const a = R() * Math.PI * 2;
    const d = 22 + R() * 18;
    radial(dg, 64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 4 + R() * 7, [
      [0, 'rgba(30,22,16,0.6)'],
      [1, 'rgba(30,22,16,0)'],
    ]);
  }
  // Blast rays.
  dg.strokeStyle = 'rgba(28,20,14,0.35)';
  dg.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const a = R() * Math.PI * 2;
    dg.lineWidth = 1.5 + R() * 2.5;
    dg.beginPath();
    dg.moveTo(64 + Math.cos(a) * 14, 64 + Math.sin(a) * 14);
    dg.lineTo(64 + Math.cos(a) * (34 + R() * 10), 64 + Math.sin(a) * (34 + R() * 10));
    dg.stroke();
  }
  // Crater: a dark bowl, a dusty rim, ejecta rays.
  radial(dg, 192, 64, 45, [
    [0, 'rgba(34,26,20,0.97)'],
    [0.42, 'rgba(58,44,32,0.92)'],
    [0.62, 'rgba(150,120,86,0.75)'],
    [0.78, 'rgba(120,96,70,0.55)'],
    [1, 'rgba(120,96,70,0)'],
  ]);
  dg.strokeStyle = 'rgba(88,68,48,0.45)';
  for (let i = 0; i < 16; i++) {
    const a = R() * Math.PI * 2;
    dg.lineWidth = 2 + R() * 3;
    dg.beginPath();
    dg.moveTo(192 + Math.cos(a) * 26, 64 + Math.sin(a) * 26);
    dg.lineTo(192 + Math.cos(a) * (38 + R() * 7), 64 + Math.sin(a) * (38 + R() * 7));
    dg.stroke();
  }

  TEX = {
    glow: toTexture(glowC),
    smoke: toTexture(smokeC),
    star: toTexture(starC),
    ring: toTexture(ringC),
    foam: toTexture(foamC),
    decal: toTexture(decC),
  };
  return TEX;
}

/* ====================================================================== */
/* Billboard batches                                                       */
/* ====================================================================== */

/**
 * The billboards' near fade (in particle sizes from the camera) and the
 * opacity below which a quad is not drawn at all. Exported so the node
 * suite measures fill with the numbers the shader actually uses.
 */
export const FADE = { near0: 0.5, near1: 1.6, cut: 0.02 };
const glf = (x) => (Number.isInteger(x) ? `${x}.0` : String(x));

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iCol;
attribute vec2 iSR;
varying vec2 vUv;
varying vec4 vCol;
#ifdef USE_FOG
varying float vFogDepth;
#endif
void main() {
  vUv = uv;
  vCol = iCol;
  vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iSR.y);
  float s = sin(iSR.y);
  vec2 p = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iSR.x;
  mvPosition.xy += p;
  // A puff the camera is inside covers the whole screen many times over —
  // that is the worst fill-rate case there is on a Chromebook, and it looks
  // wrong besides. Fade it out as the camera reaches it.
  vCol.a *= smoothstep(${glf(FADE.near0)} * iSR.x, ${glf(FADE.near1)} * iSR.x, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  /*
   * Too faint to see (the camera nearly inside it, or the end of its life):
   * do not draw it at all. The fragment shader discarded these, but only
   * after the GPU had shaded every pixel of the quad. Measured in node on
   * these modules, as the sum of the live quads' on-screen areas in
   * screens, over three seeds: flying through a meteor blast at 60 m peaked at 10.6-16.7 screens of
   * particle pixels with almost all of it puffs at 1-2% opacity a few
   * metres away; the dissipating column of a big meteor, flown towards,
   * 6-10 screens of 400 m puffs at 1-5%. With this cut-off at 2% and the
   * near fade starting a little further out, the fly-through peaks at
   * 8.6-10.5 (mean 2.4 -> 1.4) and the bomb cam and twenty-in-a-row stay
   * at 1.3 and 0.7.
   */
  if (vCol.a < ${glf(FADE.cut)}) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
#ifdef USE_FOG
  vFogDepth = -mvPosition.z;
#endif
}`;

/*
 * The particle colours are written straight to the screen as they are —
 * they were picked by eye, as screen colours. The fog colour is not: it is
 * a linear scene colour that every other material tone-maps and encodes on
 * the way out. Mixed in raw, far smoke faded to a colour noticeably DARKER
 * than the fog around it and stood out as a grey smudge on the horizon; so
 * the fog colour goes through the same tone mapping and encoding first.
 */
const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying vec4 vCol;
#ifdef USE_FOG
uniform vec3 fogColor;
varying float vFogDepth;
#ifdef FOG_EXP2
uniform float fogDensity;
#else
uniform float fogNear;
uniform float fogFar;
#endif
#endif
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vCol.a;
  if (a < 0.004) discard;
  vec3 col = t.rgb * vCol.rgb;
#ifdef USE_FOG
#ifdef FOG_EXP2
  float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
#else
  float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
#endif
#ifdef ADDITIVE
  // Light in fog fades to nothing; it does not turn into fog.
  col *= 1.0 - fogFactor;
#else
  vec3 fc = fogColor;
#ifdef TONE_MAPPING
  fc = toneMapping(fc);
#endif
  fc = linearToOutputTexel(vec4(fc, 1.0)).rgb;
  col = mix(col, fc, fogFactor);
#endif
#endif
  gl_FragColor = vec4(col, a);
}`;

function billboardMaterial(map, additive) {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: null } }]),
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    defines: additive ? { ADDITIVE: 1 } : {},
  });
  // Set after the merge: merge() clones textures, which would upload a second
  // copy of each one.
  m.uniforms.uMap.value = map;
  return m;
}

// Per-particle state, struct-of-arrays in one Float32Array.
const ST = 27;
// 0 x 1 y 2 z 3 vx 4 vy 5 vz 6 age 7 life 8 s0 9 s1 10 a 11 fadeIn
// 12 r0 13 g0 14 b0 15 r1 16 g1 17 b1 18 drag 19 grav 20 windK
// 21 rot 22 rotV 23 flags 24 alphaPow 25 hug 26 ground (cached surface)
export const F_GROUND_DIE = 1;
export const F_WATER_DIE = 2;
export const F_HUG = 4;
export const F_TWINKLE = 8;

/*
 * The ground under a particle, looked up every frame, was most of the cost
 * of a busy sky: twenty blasts at once asked heightAt() about 1,600 times a
 * frame (sparks, dust, debris), 2.5 ms on an M1 and several times that on a
 * Chromebook. Sparks now die at the height of the ground they were thrown
 * from — a spark vanishing a few metres off on a hillside cannot be seen —
 * and ground-hugging dust looks the ground up every fourth frame.
 */
let SURF_HINT = NaN; // surface height for the particles being spawned right now; NaN = look it up
let FRAME = 0;
/**
 * Reduce flashing (render/flash-safety.js): the game seconds the explosions
 * have run for, and the gate that lets at most three of them a second flash.
 * A string of bombs or a meteor shower used to flash the world (and, close
 * up, the whole screen) once per bang, as fast as they came.
 */
let CLOCK = 0;
const _lightTo = new THREE.Vector3();
const FLASH_GATE = new FlashGate();
/**
 * And the one light and the sky's bounce, smoothed with the switch on: the
 * light used to jump to whichever bang was brightest each frame and flash
 * with each, so a string of them lit the whole ground on and off several
 * times a second (measured: eight bombs in a second, the whole runway
 * flickering). Smoothed, they are one swell of light that moves, not hops.
 */
const LIGHT_SMOOTH = new FlashSmoother();
const SKY_SMOOTH = new FlashSmoother();
/*
 * How much daylight there is, 0.15 (night) to 1 (midday). The particle
 * colours are screen colours, not lit materials, so a smoke column at night
 * came out the same pale grey as at noon and glowed against a black island.
 * Smoke, dust and spray are multiplied by this when they are made; fire and
 * sparks are light and are not.
 */
let LIGHT = 1;
function refreshLight(sim) {
  try {
    const p = sim && sim.weather && sim.weather.palette && sim.weather.palette();
    if (p && Number.isFinite(p.sunIntensity) && Number.isFinite(p.ambIntensity)) {
      LIGHT = clamp((p.sunIntensity + 2 * p.ambIntensity) / 5.2, 0.15, 1);
    }
  } catch (e) {
    /* keep the last value */
  }
}

class Batch {
  constructor(cap, map, additive, renderOrder, name) {
    this.cap = cap;
    this.n = 0;
    this.s = new Float32Array(cap * ST);
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSR = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iCol', this.aCol);
    geo.setAttribute('iSR', this.aSR);
    geo.instanceCount = 0;
    this.geo = geo;
    /*
     * Upload only the live front of each buffer. three.js empties an
     * attribute's range list after every upload, so a fresh {start,count}
     * would be allocated per attribute per frame; these three are pushed
     * back in instead and mutated.
     */
    this.attrs = [this.aPos, this.aCol, this.aSR];
    this.ranges = [{ start: 0, count: 0 }, { start: 0, count: 0 }, { start: 0, count: 0 }];
    this.mesh = new THREE.Mesh(geo, billboardMaterial(map, additive));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
    this.mesh.name = name;
  }

  /**
   * One particle from a template. Positional arguments rather than an options
   * object, because meteor trails call this dozens of times a frame and an
   * object literal per call is garbage per call.
   */
  spawn(T, x, y, z, vx, vy, vz, sizeMul = 1, lifeMul = 1, alphaMul = 1, r = -1, g = -1, b = -1) {
    if (this.n >= this.cap) return -1;
    const i = this.n++;
    const s = this.s;
    const o = i * ST;
    s[o] = x;
    s[o + 1] = y;
    s[o + 2] = z;
    s[o + 3] = vx;
    s[o + 4] = vy;
    s[o + 5] = vz;
    s[o + 6] = 0;
    s[o + 7] = Math.max(0.0001, T.life * lifeMul);
    s[o + 8] = T.s0 * sizeMul;
    s[o + 9] = T.s1 * sizeMul;
    s[o + 10] = T.a * alphaMul;
    s[o + 11] = T.fadeIn;
    const k0 = T.lit ? LIGHT : 1;
    const k1 = T.lit || T.litEnd ? LIGHT : 1;
    if (r >= 0) {
      s[o + 12] = r * k0;
      s[o + 13] = g * k0;
      s[o + 14] = b * k0;
      s[o + 15] = r * T.tint * k1;
      s[o + 16] = g * T.tint * k1;
      s[o + 17] = b * T.tint * k1;
    } else {
      s[o + 12] = T.c0[0] * k0;
      s[o + 13] = T.c0[1] * k0;
      s[o + 14] = T.c0[2] * k0;
      s[o + 15] = T.c1[0] * k1;
      s[o + 16] = T.c1[1] * k1;
      s[o + 17] = T.c1[2] * k1;
    }
    s[o + 18] = T.drag;
    s[o + 19] = T.grav;
    s[o + 20] = T.windK;
    s[o + 21] = Math.random() * Math.PI * 2;
    s[o + 22] = (Math.random() - 0.5) * 2 * T.spin;
    s[o + 23] = T.flags;
    s[o + 24] = T.apow;
    s[o + 25] = T.hug || 0;
    s[o + 26] = SURF_HINT;
    // Drawn this frame, not next: a meteor's head is re-made every frame
    // after update() has already run, and would otherwise never be seen.
    this.write(i, 0);
    this.mark();
    return i;
  }

  /** Write particle i's drawable state for age `age`. */
  write(i, age) {
    const s = this.s;
    const o = i * ST;
    const life = s[o + 7];
    const f = Math.min(1, age / life);
    const grow = 1 - (1 - f) * (1 - f);
    const fin = s[o + 11];
    let a = s[o + 10] * (fin > 0 && f < fin ? f / fin : 1) * Math.pow(1 - f, s[o + 24]);
    if (s[o + 23] & F_TWINKLE) a *= 0.55 + 0.45 * Math.sin(age * 23 + o);
    const P = this.aPos.array;
    const C = this.aCol.array;
    const SR = this.aSR.array;
    const p3 = i * 3;
    P[p3] = s[o];
    P[p3 + 1] = s[o + 1];
    P[p3 + 2] = s[o + 2];
    const c4 = i * 4;
    C[c4] = s[o + 12] + (s[o + 15] - s[o + 12]) * f;
    C[c4 + 1] = s[o + 13] + (s[o + 16] - s[o + 13]) * f;
    C[c4 + 2] = s[o + 14] + (s[o + 17] - s[o + 14]) * f;
    C[c4 + 3] = a;
    const p2 = i * 2;
    SR[p2] = s[o + 8] + (s[o + 9] - s[o + 8]) * grow;
    SR[p2 + 1] = s[o + 21];
  }

  /** Tell three.js how much of each buffer is live. */
  mark() {
    const n = this.n;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n === 0) return;
    for (let k = 0; k < 3; k++) {
      const attr = this.attrs[k];
      const r = this.ranges[k];
      r.start = 0;
      r.count = n * attr.itemSize;
      if (attr.updateRanges.length === 0) attr.updateRanges.push(r);
      attr.needsUpdate = true;
    }
  }

  clear() {
    this.n = 0;
    this.geo.instanceCount = 0;
    this.mesh.visible = false;
  }

  update(dt, wind) {
    const s = this.s;
    let n = this.n;
    let i = 0;
    while (i < n) {
      const o = i * ST;
      const age = s[o + 6] + dt;
      const life = s[o + 7];
      if (age >= life) {
        // Swap the last live particle into this slot; do not advance.
        n--;
        if (i !== n) s.copyWithin(o, n * ST, n * ST + ST);
        continue;
      }
      s[o + 6] = age;
      const flags = s[o + 23];
      let vx = s[o + 3];
      let vy = s[o + 4];
      let vz = s[o + 5];
      const windK = s[o + 20];
      if (windK > 0 && wind) {
        const k = Math.min(1, windK * dt);
        vx += (wind.x - vx) * k;
        vz += (wind.z - vz) * k;
      }
      const drag = s[o + 18];
      const d = drag > 0 ? Math.max(0, 1 - drag * dt) : 1;
      vx *= d;
      vz *= d;
      vy = vy * d - GRAV * s[o + 19] * dt;
      const x = s[o] + vx * dt;
      let y = s[o + 1] + vy * dt;
      const z = s[o + 2] + vz * dt;
      if (flags & (F_GROUND_DIE | F_WATER_DIE | F_HUG)) {
        let gh = s[o + 26];
        if (gh !== gh || ((flags & F_HUG) && ((FRAME + i) & 3) === 0)) {
          gh = safeHeight(x, z);
          if (flags & F_HUG) s[o + 26] = gh;
        }
        const surf = gh > 0 ? gh : 0;
        if (flags & F_HUG) {
          y = surf + s[o + 25];
        } else if (vy < 0 && y <= surf + 0.2 && (((flags & F_WATER_DIE) && gh <= 0) || ((flags & F_GROUND_DIE) && gh > 0))) {
          n--;
          if (i !== n) s.copyWithin(o, n * ST, n * ST + ST);
          continue;
        }
      }
      s[o] = x;
      s[o + 1] = y;
      s[o + 2] = z;
      s[o + 3] = vx;
      s[o + 4] = vy;
      s[o + 5] = vz;
      s[o + 21] += s[o + 22] * dt;
      this.write(i, age);
      i++;
    }
    this.n = n;
    this.mark();
  }
}

/**
 * Particle templates. Sizes are metres at sizeMul 1; colours go from c0 to c1
 * over the life (or from a passed colour to that colour times `tint`).
 * `batch` says which draw call: 'glow' (additive light), 'star' (additive
 * four-point sparkles) or 'smoke' (ordinary see-through puffs, which is what
 * lets fire read against a bright sky).
 */
function T(o) {
  return {
    life: 1, s0: 1, s1: 1, a: 1, fadeIn: 0.05, c0: [1, 1, 1], c1: [1, 1, 1], tint: 0.6,
    drag: 0, grav: 0, windK: 0, spin: 0.6, flags: 0, apow: 1.2, hug: 0, batch: 'glow', lit: false, litEnd: false,
    ...o,
  };
}

export const PARTICLES = {
  // --- additive light. Sizes for the fireball are multiplied by R. ---
  flash: T({ life: 0.26, s0: 4, s1: 6, fadeIn: 0.02, c0: [1, 0.97, 0.88], c1: [1, 0.72, 0.36], apow: 2 }),
  core: T({ life: 0.45, s0: 1.2, s1: 2, fadeIn: 0.02, c0: [1, 0.96, 0.8], c1: [1, 0.62, 0.22], drag: 3, grav: -0.5, apow: 1.6 }),
  fire: T({ life: 1.3, s0: 0.8, s1: 1.5, fadeIn: 0.04, c0: [1, 0.86, 0.5], c1: [0.95, 0.3, 0.06], drag: 2.8, grav: -1.1, apow: 1.4, spin: 1.2 }),
  spark: T({ life: 1.8, s0: 3.6, s1: 1, fadeIn: 0.02, c0: [1, 0.92, 0.55], c1: [1, 0.4, 0.08], drag: 0.3, grav: 1, flags: F_GROUND_DIE | F_WATER_DIE, apow: 1 }),
  ember: T({ life: 1.2, s0: 3.2, s1: 0.8, a: 0.85, fadeIn: 0.1, c0: [1, 0.75, 0.3], c1: [0.8, 0.22, 0.04], drag: 1.5, grav: -0.45, windK: 0.6, apow: 1 }),
  hotglow: T({ life: 1.6, s0: 1, s1: 1.3, a: 0.5, fadeIn: 0.3, c0: [1, 0.55, 0.16], c1: [0.8, 0.2, 0.04], apow: 1 }),
  sparkle: T({ batch: 'star', life: 1.5, s0: 1.8, s1: 0.5, fadeIn: 0.03, drag: 1.3, grav: 0.22, flags: F_TWINKLE, apow: 1, tint: 0.9 }),
  head: T({ life: 0.0005, s0: 1, s1: 1, fadeIn: 0, apow: 0, spin: 0 }),
  trail: T({ life: 0.75, s0: 1, s1: 0.35, a: 0.9, fadeIn: 0.02, c0: [1, 0.86, 0.52], c1: [0.95, 0.3, 0.07], drag: 0.9, apow: 1.3 }),
  twinkle: T({ batch: 'star', life: 1.2, s0: 1, s1: 0.4, a: 0.95, fadeIn: 0.2, drag: 0.5, grav: -0.02, flags: F_TWINKLE, apow: 1, tint: 0.8 }),
  // --- ordinary puffs ---
  // The body of the fireball: solid orange that goes to soot. Without it the
  // fire was all additive light, which on a bright afternoon sky adds up to
  // almost nothing.
  flame: T({ batch: 'smoke', litEnd: true, life: 1.9, s0: 1, s1: 1.8, a: 0.95, fadeIn: 0.03, c0: [1, 0.74, 0.3], c1: [0.3, 0.2, 0.14], drag: 2.6, grav: -1.2, apow: 1.1, spin: 1 }),
  smokeDark: T({ batch: 'smoke', lit: true, life: 7, s0: 0.9, s1: 2.3, a: 0.8, fadeIn: 0.2, c0: [0.19, 0.17, 0.16], c1: [0.42, 0.41, 0.4], drag: 0.5, grav: -0.2, windK: 0.3, apow: 1.1, spin: 0.25 }),
  column: T({ batch: 'smoke', lit: true, life: 15, s0: 0.9, s1: 4, a: 0.6, fadeIn: 0.08, c0: [0.28, 0.27, 0.26], c1: [0.64, 0.64, 0.65], drag: 0.15, grav: -0.05, windK: 0.22, apow: 1.3, spin: 0.15 }),
  dust: T({ batch: 'smoke', lit: true, life: 2.4, s0: 0.5, s1: 1.6, a: 0.6, fadeIn: 0.05, c0: [0.62, 0.55, 0.43], c1: [0.7, 0.66, 0.58], drag: 1.6, flags: F_HUG, apow: 1.4, hug: 3, spin: 0.3 }),
  // The thud's dust: a light, warm brown that rises a little and hangs, so a
  // rock landing in town reads as a cartoon poof, not as smoke from a fire.
  poof: T({ batch: 'smoke', lit: true, life: 3.6, s0: 0.6, s1: 2.1, a: 0.8, fadeIn: 0.04, c0: [0.74, 0.65, 0.52], c1: [0.84, 0.8, 0.74], drag: 2.2, grav: -0.18, windK: 0.3, apow: 1.3, spin: 0.3 }),
  puff: T({ batch: 'smoke', lit: true, life: 1.1, s0: 0.5, s1: 1.8, a: 0.5, fadeIn: 0.05, c0: [0.36, 0.33, 0.3], c1: [0.55, 0.53, 0.5], drag: 2, grav: -0.1, windK: 0.3, apow: 1.2 }),
  spray: T({ batch: 'smoke', lit: true, life: 3, s0: 0.25, s1: 0.75, a: 0.88, fadeIn: 0.03, c0: [0.96, 0.98, 1], c1: [0.84, 0.92, 0.98], drag: 0.22, grav: 1, flags: F_WATER_DIE | F_GROUND_DIE, apow: 1 }),
  mist: T({ batch: 'smoke', lit: true, life: 5, s0: 0.6, s1: 2.1, a: 0.42, fadeIn: 0.1, c0: [0.9, 0.94, 0.98], c1: [0.93, 0.95, 0.98], drag: 1, grav: -0.04, windK: 0.4, apow: 1.2, spin: 0.2 }),
  steam: T({ batch: 'smoke', lit: true, life: 7, s0: 0.5, s1: 2.4, a: 0.5, fadeIn: 0.1, c0: [0.95, 0.96, 0.98], c1: [0.9, 0.92, 0.95], drag: 0.8, grav: -0.2, windK: 0.4, apow: 1.2, spin: 0.2 }),
  trailSmoke: T({ batch: 'smoke', lit: true, life: 5, s0: 0.8, s1: 3, a: 0.26, fadeIn: 0.05, c0: [0.72, 0.7, 0.68], c1: [0.8, 0.8, 0.83], drag: 1.2, windK: 0.3, apow: 1, spin: 0.2 }),
  // A meteor's burning head and tail as solid colour, for the same reason as
  // `flame`: an additive streak across a sunset sky was invisible.
  hotTrail: T({ batch: 'smoke', life: 0.7, s0: 1, s1: 0.3, a: 0.95, fadeIn: 0.02, c0: [1, 0.93, 0.62], c1: [1, 0.42, 0.1], drag: 0.8, apow: 1.2, spin: 0.4 }),
  hotHead: T({ batch: 'smoke', life: 0.0005, s0: 1, s1: 1, a: 1, fadeIn: 0, apow: 0, spin: 0 }),
};

/* ====================================================================== */
/* Debris: one InstancedMesh of low-poly rocks                             */
/* ====================================================================== */

const DS = 18; // 0 x 1 y 2 z 3 vx 4 vy 5 vz 6 rx 7 ry 8 rz 9 wx 10 wy 11 wz 12 scale 13 age 14 rest 15 smokeT 16 life 17 water
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _sc = new THREE.Vector3();
const _c = new THREE.Color();

class Debris {
  constructor(cap) {
    this.cap = cap;
    this.n = 0;
    this.s = new Float32Array(cap * DS);
    this.col = new Float32Array(cap * 3);
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, flatShading: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Allocate the colour buffer now, not on the first bang.
    this.mesh.setColorAt(0, _c.setRGB(1, 1, 1));
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.name = 'fx-debris';
  }

  spawn(x, y, z, vx, vy, vz, scale, r, g, b, life) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    const o = i * DS;
    const s = this.s;
    s[o] = x;
    s[o + 1] = y;
    s[o + 2] = z;
    s[o + 3] = vx;
    s[o + 4] = vy;
    s[o + 5] = vz;
    s[o + 6] = Math.random() * 6;
    s[o + 7] = Math.random() * 6;
    s[o + 8] = Math.random() * 6;
    s[o + 9] = rand(-9, 9);
    s[o + 10] = rand(-9, 9);
    s[o + 11] = rand(-9, 9);
    s[o + 12] = scale;
    s[o + 13] = 0;
    s[o + 14] = 0;
    s[o + 15] = rand(0, 0.06);
    s[o + 16] = life;
    s[o + 17] = 0;
    this.col[i * 3] = r;
    this.col[i * 3 + 1] = g;
    this.col[i * 3 + 2] = b;
    this.mesh.setColorAt(i, _c.setRGB(r, g, b));
    this.mesh.instanceColor.needsUpdate = true;
    // Placed now, so a chunk made after this frame's update is not drawn at
    // whatever the last chunk in this slot left behind.
    _e.set(s[o + 6], s[o + 7], s[o + 8]);
    _m4.compose(_p.set(x, y, z), _q.setFromEuler(_e), _sc.set(scale, scale * 0.7, scale * 0.85));
    this.mesh.setMatrixAt(i, _m4);
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.n = 0;
    this.mesh.count = 0;
  }

  update(dt, smoke) {
    const s = this.s;
    let n = this.n;
    let i = 0;
    let colourMoved = false;
    while (i < n) {
      const o = i * DS;
      const age = s[o + 13] + dt;
      const life = s[o + 16];
      if (age >= life) {
        n--;
        if (i !== n) {
          s.copyWithin(o, n * DS, n * DS + DS);
          this.col.copyWithin(i * 3, n * 3, n * 3 + 3);
          this.mesh.setColorAt(i, _c.setRGB(this.col[i * 3], this.col[i * 3 + 1], this.col[i * 3 + 2]));
          colourMoved = true;
        }
        continue;
      }
      s[o + 13] = age;
      let scale = s[o + 12];
      if (!s[o + 14]) {
        s[o + 4] -= GRAV * dt;
        s[o] += s[o + 3] * dt;
        s[o + 1] += s[o + 4] * dt;
        s[o + 2] += s[o + 5] * dt;
        s[o + 6] += s[o + 9] * dt;
        s[o + 7] += s[o + 10] * dt;
        s[o + 8] += s[o + 11] * dt;
        // A thin smoke trail behind each chunk while it is flying: the arcs
        // are what make a blast read as a blast from a kilometre away.
        if (smoke && age < 2) {
          s[o + 15] -= dt;
          if (s[o + 15] <= 0) {
            s[o + 15] = 0.1;
            smoke.spawn(PARTICLES.puff, s[o], s[o + 1], s[o + 2], 0, 0.5, 0, 2 + scale * 2.5, 1.2, 0.8);
          }
        }
        const gh = safeHeight(s[o], s[o + 2]);
        if (gh <= 0 && s[o + 1] <= 0) {
          // Into the sea: gone, with a little white splash.
          if (smoke) smoke.spawn(PARTICLES.spray, s[o], 0.3, s[o + 2], 0, 5, 0, scale * 4, 0.5);
          s[o + 13] = life; // dies next frame
        } else if (s[o + 1] <= gh + scale * 0.45) {
          s[o + 1] = gh + scale * 0.45;
          if (s[o + 4] < -5) {
            // Bounce once, then lie still. Pieces that skitter forever look wrong.
            s[o + 4] *= -0.28;
            s[o + 3] *= 0.45;
            s[o + 5] *= 0.45;
            s[o + 9] *= 0.4;
            s[o + 10] *= 0.4;
            s[o + 11] *= 0.4;
          } else {
            s[o + 14] = 1;
          }
        }
      }
      // Sink into the ground over the last two seconds instead of popping out.
      const left = life - age;
      if (left < 2) scale *= left / 2;
      _e.set(s[o + 6], s[o + 7], s[o + 8]);
      _q.setFromEuler(_e);
      _p.set(s[o], s[o + 1], s[o + 2]);
      _sc.set(scale, scale * 0.7, scale * 0.85);
      _m4.compose(_p, _q, _sc);
      this.mesh.setMatrixAt(i, _m4);
      i++;
    }
    this.n = n;
    this.mesh.count = n;
    if (n > 0) this.mesh.instanceMatrix.needsUpdate = true;
    if (colourMoved) this.mesh.instanceColor.needsUpdate = true;
  }
}

/* ====================================================================== */
/* Decals: scorch marks and craters laid on the ground as drawn            */
/* ====================================================================== */

class Decals {
  constructor(cap, map) {
    this.cap = cap;
    this.next = 0;
    this.live = new Float32Array(cap * 3); // age, life, alive
    const per = DECAL_N * DECAL_N;
    this.per = per;
    const pos = new Float32Array(cap * per * 3);
    const uv = new Float32Array(cap * per * 2);
    const col = new Float32Array(cap * per * 4);
    const idx = [];
    for (let d = 0; d < cap; d++) {
      const base = d * per;
      for (let j = 0; j < DECAL_N - 1; j++) {
        for (let i = 0; i < DECAL_N - 1; i++) {
          const a = base + j * DECAL_N + i;
          const b = a + DECAL_N;
          idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    }
    // Every vertex starts far below the world, so an unused decal draws nothing
    // anybody could see.
    for (let i = 0; i < cap * per; i++) pos[i * 3 + 1] = -9999;
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aUv = new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('uv', this.aUv);
    geo.setAttribute('color', this.aCol);
    geo.setIndex(idx);
    /*
     * The blend: result = ground × (1 − a·(1 − decal)). That is "multiply the
     * ground by the decal colour, by this much" — so a scorch darkens grass,
     * sand and tarmac alike rather than pasting a brown disc on top of each.
     * Built from (DstColor, OneMinusSrcAlpha) with the fragment colour
     * premultiplied by its alpha. Fading a decal out is lowering that alpha.
     */
    const mat = new THREE.MeshBasicMaterial({
      map,
      vertexColors: true,
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -6,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'fx-decals';
    this.geo = geo;
    this.count = 0;
  }

  /** @param {number} which 0 scorch, 1 crater */
  place(x, z, radius, which, life, quality) {
    const d = this.next;
    this.next = (this.next + 1) % this.cap;
    if (!this.live[d * 3 + 2]) this.count = Math.min(this.cap, this.count + 1);
    this.live[d * 3] = 0;
    this.live[d * 3 + 1] = life;
    this.live[d * 3 + 2] = 1;
    const P = this.aPos.array;
    const U = this.aUv.array;
    const C = this.aCol.array;
    const th = Math.random() * Math.PI * 2;
    const ct = Math.cos(th);
    const sn = Math.sin(th);
    const half = (DECAL_N - 1) / 2;
    const off = which ? 0.75 : 0.25;
    HCACHE.clear();
    for (let j = 0; j < DECAL_N; j++) {
      for (let i = 0; i < DECAL_N; i++) {
        const u = (i - half) / half;
        const v = (j - half) / half;
        const k = d * this.per + j * DECAL_N + i;
        const wx = x + u * radius;
        const wz = z + v * radius;
        const h = renderedHeight(wx, wz, quality, HCACHE);
        P[k * 3] = wx;
        P[k * 3 + 1] = h + 0.3;
        P[k * 3 + 2] = wz;
        // Rotate the texture, not the patch; 0.35 keeps the rotated square
        // inside its half of the atlas.
        const ru = u * ct - v * sn;
        const rv = u * sn + v * ct;
        U[k * 2] = off + ru * 0.35 * 0.5;
        U[k * 2 + 1] = 0.5 + rv * 0.35;
        C[k * 4] = 1;
        C[k * 4 + 1] = 1;
        C[k * 4 + 2] = 1;
        // Below the sea the patch cannot be seen, and on the sea it must not
        // be: a crater does not float.
        C[k * 4 + 3] = h < -0.3 ? 0 : 1;
      }
    }
    this.aPos.needsUpdate = true;
    this.aUv.needsUpdate = true;
    this.aCol.needsUpdate = true;
  }

  clear() {
    const P = this.aPos.array;
    for (let i = 0; i < P.length; i += 3) P[i + 1] = -9999;
    this.aPos.needsUpdate = true;
    this.live.fill(0);
    this.count = 0;
  }

  /** Fade the ones near the end of their life. Cheap: only fading ones write. */
  update(dt) {
    let dirty = false;
    const C = this.aCol.array;
    for (let d = 0; d < this.cap; d++) {
      if (!this.live[d * 3 + 2]) continue;
      const age = (this.live[d * 3] += dt);
      const life = this.live[d * 3 + 1];
      const left = life - age;
      if (left > 6) continue;
      const a = Math.max(0, left / 6);
      for (let k = d * this.per; k < (d + 1) * this.per; k++) {
        if (C[k * 4 + 3] > 0) C[k * 4 + 3] = Math.max(0.0001, a);
      }
      dirty = true;
      if (left <= 0) {
        this.live[d * 3 + 2] = 0;
        const P = this.aPos.array;
        for (let k = d * this.per; k < (d + 1) * this.per; k++) P[k * 3 + 1] = -9999;
        this.aPos.needsUpdate = true;
        this.count = Math.max(0, this.count - 1);
      }
    }
    if (dirty) this.aCol.needsUpdate = true;
  }
}

/* ====================================================================== */
/* The effect set, rebuilt with every world                                */
/* ====================================================================== */

let FX = null;

function makeRing(map) {
  const geo = new THREE.PlaneGeometry(2, 2);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map,
    color: 0xffe2b8,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat);
  m.visible = false;
  m.renderOrder = 3;
  return { mesh: m, active: false, t: 0, life: 1, r0: 1, r1: 10, a: 1, x: 0, y: 0, z: 0, water: false, foam: false };
}

function blankBlast() {
  return {
    active: false, id: 0, t: 0, x: 0, y: 0, z: 0, size: 1, R: 10, vis: 1, kind: 'bomb',
    water: false, air: false, surface: 0,
    waveR: 0, heard: false, silent: false,
    columnLeft: 0, columnRate: 0, columnAcc: 0,
    fireLeft: 0, fireAcc: 0, glowLeft: 0, glowAcc: 0, steamLeft: 0, steamAcc: 0,
    lightPeak: 0, lightRange: 100, lightCol: 0xffa050,
    flashK: 0, soft: false, gentle: false, flashSprite: 1, flashLight: 1,
  };
}
const BLANK = blankBlast();

function buildFx(sim, parent) {
  const tx = textures();
  const fx = {
    parent,
    glow: new Batch(GLOW_CAP, tx.glow, true, 6, 'fx-glow'),
    // Solid, not additive: a gold star must stay gold on a bright sunset sky.
    star: new Batch(STAR_CAP, tx.star, false, 7, 'fx-star'),
    smoke: new Batch(SMOKE_CAP, tx.smoke, false, 5, 'fx-smoke'),
    debris: new Debris(DEBRIS_CAP),
    decals: new Decals(DECAL_CAP, tx.decal),
    rings: [],
    blasts: [],
    light: new THREE.PointLight(0xffa050, 0, 200, 2),
    queue: [], // scheduled bangs for the dev "twenty in a row" button
    idSeq: 0,
    booms: 0,
    lastBoom: null,
    screen: null,
    screenA: 0,
    whistle: null,
    tx,
  };
  fx.light.name = 'fx-light';
  parent.add(fx.glow.mesh, fx.smoke.mesh, fx.star.mesh, fx.debris.mesh, fx.decals.mesh, fx.light);
  for (let i = 0; i < RING_CAP; i++) {
    const r = makeRing(tx.ring);
    fx.rings.push(r);
    parent.add(r.mesh);
  }
  for (let i = 0; i < BLAST_CAP; i++) fx.blasts.push(blankBlast());
  fx.light.position.set(0, -5000, 0);
  /*
   * Compile the shaders now, while the world is loading, rather than on the
   * frame of the first bang. The batches are hidden while empty, and compile
   * only visits visible objects, so they are shown for the call.
   */
  try {
    if (sim && sim.renderer && sim.camera && sim.renderer.compile) {
      const hidden = [fx.glow.mesh, fx.smoke.mesh, fx.star.mesh];
      for (const m of hidden) m.visible = true;
      for (const r of fx.rings) r.mesh.visible = true;
      sim.renderer.compile(parent, sim.camera, sim.scene);
      for (const m of hidden) m.visible = false;
      for (const r of fx.rings) r.mesh.visible = false;
    }
  } catch (e) {
    /* a renderer that cannot precompile compiles on first use instead */
  }
  FX = fx;
  return fx;
}

/** The live effect set, building one straight into the scene if no world build has made one yet. */
function ensureFx(sim) {
  if (FX && FX.parent && FX.parent.parent) return FX;
  if (!sim || !sim.scene) return null;
  const g = new THREE.Group();
  g.name = 'ext:explosions(fallback)';
  sim.scene.add(g);
  return buildFx(sim, g);
}

function qualityOf(sim) {
  return (sim && (sim.qualityBuilt || (sim.settings && sim.settings.quality))) || 'high';
}

function particleScale(sim) {
  const q = qualityOf(sim);
  return q === 'low' ? 0.5 : q === 'medium' ? 0.78 : q === 'ultra' ? 1.25 : 1;
}

const _wind = new THREE.Vector3();
function windOf(sim) {
  try {
    if (sim && sim.weather && sim.weather.windVector) return sim.weather.windVector(_wind);
  } catch (e) {
    /* fall through */
  }
  return _wind.set(0, 0, 0);
}

function listenerPos(sim) {
  return sim && sim.camera ? sim.camera.position : null;
}

/* ====================================================================== */
/* explode()                                                               */
/* ====================================================================== */

/**
 * Set something off. See the contract at the top of the file.
 * @returns {{id:number,x:number,y:number,z:number,size:number,kind:string,water:boolean,air:boolean,distance:number,delay:number}|null}
 */
export function explode(sim, pos, opts = {}) {
  if (!sim || !pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return null;
  const fx = ensureFx(sim);
  if (!fx) return null;
  if (fx.lightAt !== FRAME) {
    fx.lightAt = FRAME;
    refreshLight(sim);
  }
  const o = opts || {};
  const size = clamp(Number(o.size) || 1, 0.1, 12);
  let kind = o.kind || 'bomb';
  if (!KINDS.includes(kind)) kind = 'bomb';

  const x = pos.x;
  const z = pos.z;
  const gh = safeHeight(x, z);
  const py = Number.isFinite(pos.y) ? pos.y : Math.max(0, gh);
  const R = blastRadius(size);
  const water = kind === 'splash' || (gh < 0.2 && py < 4 + size * 3 && kind !== 'sparkle' && kind !== 'shatter');
  const surface = water ? Math.max(0, gh) : gh;
  const y = water ? surface : Math.max(py, surface);
  const air = kind === 'airburst' || kind === 'shatter' || kind === 'sparkle' || (!water && y - surface > 6 + 0.5 * R);

  // A slot: a free one, else the oldest (whose only remaining work is smoke).
  let b = null;
  for (let i = 0; i < fx.blasts.length; i++) {
    if (!fx.blasts[i].active) {
      b = fx.blasts[i];
      break;
    }
  }
  if (!b) {
    b = fx.blasts[0];
    for (let i = 1; i < fx.blasts.length; i++) if (fx.blasts[i].t > b.t) b = fx.blasts[i];
  }
  Object.assign(b, BLANK);
  b.active = true;
  b.id = ++fx.idSeq;
  b.x = x;
  b.y = y;
  b.z = z;
  b.size = size;
  b.kind = kind;
  b.water = water;
  b.air = air;
  b.surface = surface;
  // A meteor burning up: sparks and a pale puff. The bomb's dark airburst
  // smoke, hanging in an evening sky, looks exactly like flak — wrong film.
  b.soft = !!o.burnup;
  b.gentle = !!o.gentle && !water && !air && kind !== 'sparkle';
  b.R = R;
  /*
   * How much of its flash this one gets. Switch off: all of it. Switch on:
   * the flash sprite and the light dimmed (CAPS), and only three bangs a
   * second flash at all — the rest keep their fire and smoke and sound and
   * flash a quarter as bright as that again.
   */
  const flashes = FLASH_GATE.allow(CLOCK);
  const spare = flashes ? 1 : 0.25;
  b.flashSprite = FLASH.reduce ? CAPS.blastSprite * spare : 1;
  b.flashLight = FLASH.reduce ? CAPS.blastLight * spare : 1;

  const L = listenerPos(sim);
  const dist = L ? Math.hypot(L.x - x, L.y - y, L.z - z) : 0;
  /*
   * Bigger than life far away. A 60 m fireball at 4 km is 0.9 degrees —
   * about ten pixels on a Chromebook — and a column of smoke is a grey
   * hair. The things that say "that was a bang" — the flash, the fireball,
   * the column — are scaled up past 700 m (3.7 times at 4 km), so on screen
   * they shrink with distance far more slowly than they really would.
   */
  b.vis = Math.pow(clamp(dist / 700, 1, 6), 0.75);
  // Far away there is less to see: fewer particles, same shape. And with
  // many going off together, each is a little thinner, so a carpet of them
  // costs about what six do.
  const lod = dist > 12000 ? 0.25 : dist > 6000 ? 0.5 : 1;
  let busy = 0;
  for (let i = 0; i < fx.blasts.length; i++) if (fx.blasts[i].active && fx.blasts[i].t < 3) busy++;
  const crowd = busy > 6 ? 6 / busy : 1;
  const q = particleScale(sim) * lod * crowd;
  const n = (k) => Math.max(1, Math.round(k * q));

  SURF_HINT = surface;
  try {
    if (kind === 'sparkle') spawnSparkle(fx, b, n);
    else if (kind === 'shatter') spawnShatter(fx, b, n);
    else if (water) spawnSplash(fx, b, n);
    else if (air) spawnAirburst(fx, b, n);
    else if (b.gentle) spawnThud(fx, b, n, qualityOf(sim));
    else spawnGround(fx, b, n, qualityOf(sim));
  } finally {
    SURF_HINT = NaN;
  }

  // Light.
  const heat = kind === 'sparkle' ? 0.12 : kind === 'shatter' ? 0.4 : b.gentle ? 0.3 : water ? (kind === 'meteor' ? 0.7 : 0.35) : air ? 0.7 : kind === 'meteor' ? 1.5 : 1;
  b.lightPeak = 16000 * Math.pow(size, 1.5) * heat;
  b.lightRange = 420 * Math.sqrt(size) * (water ? 0.8 : 1);
  b.lightCol = kind === 'sparkle' ? 0xc8e0ff : kind === 'shatter' ? 0xffb060 : water ? 0xd8ecff : b.gentle ? 0xffe0b0 : 0xffa050;
  b.flashK = heat;
  b.silent = !!o.silent;

  // A very close one flashes the whole screen for a moment.
  if (kind !== 'sparkle' && !b.gentle && L && dist < 12 * R) {
    const reduce = sim.settings && sim.settings.reducedMotion ? 0.4 : 1;
    // Reduce flashing: never over SCREEN_MAX, and not at all past three a second.
    if (flashes) fx.screenA = Math.max(fx.screenA, screenOpacity(0.38 * (1 - dist / (12 * R)) * reduce));
    // And the camera jolts with the light, before the sound arrives — you
    // were close enough to feel the ground move.
    if (sim.rig && sim.rig.kick && dist < 4 * R) sim.rig.kick(0.25);
  }

  return { id: b.id, x, y, z, size, kind, water, air, gentle: b.gentle, distance: dist, delay: soundDelay(dist) };
}

function spawnGround(fx, b, n, quality) {
  const { x, y, z, R, size, vis } = b;
  const meteor = b.kind === 'meteor';
  const G = fx.glow;
  const S = fx.smoke;
  const sq = Math.sqrt(size);
  // The flash, centred a little above the ground.
  G.spawn(PARTICLES.flash, x, y + R * 0.5, z, 0, 0, 0, R * vis, 1, b.flashSprite);
  // A white-hot core, then the fireball body: solid puffs thrown out and up,
  // dragged to a stop inside about one radius, rising, going sooty.
  const nc = n(6);
  for (let i = 0; i < nc; i++) {
    const a = Math.random() * Math.PI * 2;
    G.spawn(PARTICLES.core, x + Math.cos(a) * R * 0.2, y + R * 0.35, z + Math.sin(a) * R * 0.2,
      Math.cos(a) * R * 0.8, R * rand(0.6, 1.4), Math.sin(a) * R * 0.8, R * rand(0.8, 1.1) * vis, rand(0.8, 1.2));
  }
  const nf = n(22 + 6 * sq);
  for (let i = 0; i < nf; i++) {
    const a = Math.random() * Math.PI * 2;
    const el = rand(0.1, 1.35);
    const v = R * rand(0.9, 2.4);
    const vx = Math.cos(a) * Math.cos(el) * v;
    const vy = Math.sin(el) * v + R * 0.4;
    const vz = Math.sin(a) * Math.cos(el) * v;
    S.spawn(PARTICLES.flame, x, y + R * 0.3, z, vx, vy, vz, R * rand(0.75, 1.15) * vis, rand(0.75, 1.25));
    if (i % 2 === 0) G.spawn(PARTICLES.fire, x, y + R * 0.3, z, vx, vy, vz, R * rand(0.8, 1.2) * vis, rand(0.7, 1.2));
  }
  // It goes sooty from the outside in: dark billows that fade in as the fire goes.
  const ns = n(12 + 4 * size);
  for (let i = 0; i < ns; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = R * rand(0.3, 0.9);
    S.spawn(PARTICLES.smokeDark, x + Math.cos(a) * R * 0.35, y + R * rand(0.4, 1.1), z + Math.sin(a) * R * 0.35,
      Math.cos(a) * v, R * rand(0.5, 1.0), Math.sin(a) * v, R * rand(0.8, 1.2) * Math.sqrt(vis), rand(0.8, 1.2));
  }
  // Sparks on ballistic arcs.
  const nsp = n(36 + 10 * size);
  for (let i = 0; i < nsp; i++) {
    const a = Math.random() * Math.PI * 2;
    const el = rand(0.35, 1.4);
    const v = rand(35, 80) * sq;
    G.spawn(PARTICLES.spark, x, y + 2, z, Math.cos(a) * Math.cos(el) * v, Math.sin(el) * v, Math.sin(a) * Math.cos(el) * v,
      rand(0.8, 1.5) * sq * Math.sqrt(vis), rand(0.7, 1.3));
  }
  // Debris: dirt and rock, a meteor's own dark stone as well.
  const nd = Math.min(30, n(10 + 4 * size));
  for (let i = 0; i < nd; i++) {
    const a = Math.random() * Math.PI * 2;
    const el = rand(0.55, 1.35);
    const v = rand(22, 48) * sq;
    const pick = Math.random();
    const c = meteor && pick < 0.35 ? DEBRIS_METEOR : pick < 0.6 ? DEBRIS_DIRT : DEBRIS_ROCK;
    fx.debris.spawn(x, y + 2, z, Math.cos(a) * Math.cos(el) * v, Math.sin(el) * v, Math.sin(a) * Math.cos(el) * v,
      rand(1, 2.6) * sq, c[0], c[1], c[2], rand(8, 12));
  }
  // The shockwave: a ring of light and a skirt of dust running out along the ground.
  ring(fx, x, y + 1.5, z, R * 0.4, R * 8, 0.95, 0.85, false);
  const ndust = n(22 + 4 * size);
  for (let i = 0; i < ndust; i++) {
    const a = (i / ndust) * Math.PI * 2 + rand(-0.1, 0.1);
    const v = R * rand(2.2, 3.2);
    S.spawn(PARTICLES.dust, x + Math.cos(a) * R * 0.5, y, z + Math.sin(a) * R * 0.5, Math.cos(a) * v, 0, Math.sin(a) * v,
      R * rand(0.8, 1.2), rand(0.8, 1.2));
  }
  // The mark on the ground.
  fx.decals.place(x, z, meteor ? R * 1.1 : R * 0.8, meteor ? 1 : 0, meteor ? 120 : 75, quality);
  // What keeps going afterwards.
  b.columnLeft = meteor ? 20 : 12;
  b.columnRate = (meteor ? 4.5 : 4) * Math.sqrt(size);
  b.fireLeft = meteor ? 0 : 5;
  b.glowLeft = meteor ? 24 : 0;
}

const DEBRIS_METEOR = [0.16, 0.13, 0.12];
const DEBRIS_DIRT = [0.42, 0.33, 0.24];
const DEBRIS_ROCK = [0.46, 0.45, 0.44];
// A drone or missile's own abstract chunks — dull gunmetal, or the same dark
// char a burnt rock gets. Low-poly and unmarked on purpose: see the "no
// wreckage that looks like a vehicle" rule at the top of the file.
const DEBRIS_METAL = [0.34, 0.35, 0.37];

/*
 * A thud: something landing where people live, drawn the way a cartoon
 * would. Guard the Town set off full meteor blasts among the houses — a
 * fireball, a burning crater, a black column over the roofs — four of them
 * in a minute if you did nothing. The words said "bonk"; the picture said
 * disaster film. This is the same size of event with the fire taken out: a
 * warm poof of dust, a skirt of dust along the ground, dirt and the rock's
 * own stone on arcs, a ring of cartoon stars, and a crater with the rock
 * sitting in it. No flames, no black smoke, no glow afterwards, no
 * screen flash, and a softer bump in the sound (see playBoom).
 */
function spawnThud(fx, b, n, quality) {
  const { x, y, z, R, size, vis } = b;
  const S = fx.smoke;
  const sq = Math.sqrt(size);
  fx.glow.spawn(PARTICLES.flash, x, y + R * 0.3, z, 0, 0, 0, R * 0.45 * vis, 1, 0.45 * b.flashSprite);
  const np = n(22 + 5 * sq);
  for (let i = 0; i < np; i++) {
    const a = Math.random() * Math.PI * 2;
    const el = rand(0.25, 1.35);
    const v = R * rand(0.8, 1.9);
    S.spawn(PARTICLES.poof, x, y + R * 0.2, z, Math.cos(a) * Math.cos(el) * v, Math.sin(el) * v + R * 0.3, Math.sin(a) * Math.cos(el) * v,
      R * rand(0.7, 1.1) * vis, rand(0.8, 1.2));
  }
  ring(fx, x, y + 1.5, z, R * 0.4, R * 5, 0.8, 0.45, false);
  const ndust = n(18 + 3 * size);
  for (let i = 0; i < ndust; i++) {
    const a = (i / ndust) * Math.PI * 2 + rand(-0.1, 0.1);
    const v = R * rand(1.8, 2.6);
    S.spawn(PARTICLES.dust, x + Math.cos(a) * R * 0.5, y, z + Math.sin(a) * R * 0.5, Math.cos(a) * v, 0, Math.sin(a) * v,
      R * rand(0.8, 1.2), rand(0.8, 1.2));
  }
  const nd = Math.min(24, n(8 + 3 * size));
  for (let i = 0; i < nd; i++) {
    const a = Math.random() * Math.PI * 2;
    const el = rand(0.6, 1.35);
    const v = rand(16, 34) * sq;
    const pick = Math.random();
    const c = pick < 0.3 ? DEBRIS_METEOR : pick < 0.7 ? DEBRIS_DIRT : DEBRIS_ROCK;
    fx.debris.spawn(x, y + 2, z, Math.cos(a) * Math.cos(el) * v, Math.sin(el) * v, Math.sin(a) * Math.cos(el) * v,
      rand(0.8, 2) * sq, c[0], c[1], c[2], rand(8, 12));
  }
  // The stars you see when something goes bonk, in a ring round the top.
  const nst = n(14 + 3 * size);
  for (let i = 0; i < nst; i++) {
    const a = (i / nst) * Math.PI * 2;
    const v = rand(10, 18) * sq;
    _c.setHSL(0.1 + 0.08 * Math.random(), 0.95, 0.68);
    fx.star.spawn(PARTICLES.sparkle, x, y + R * 0.9, z, Math.cos(a) * v, rand(4, 9), Math.sin(a) * v,
      rand(2.2, 3.4) * sq * vis, rand(1, 1.4), 1, _c.r, _c.g, _c.b);
  }
  fx.decals.place(x, z, R * 0.85, 1, 90, quality);
  fx.thuds = (fx.thuds || 0) + 1;
  b.columnLeft = 0;
  b.fireLeft = 0;
  b.glowLeft = 0;
}

function spawnAirburst(fx, b, n) {
  const { x, y, z, R, size, vis } = b;
  const G = fx.glow;
  const sq = Math.sqrt(size);
  G.spawn(PARTICLES.flash, x, y, z, 0, 0, 0, R * 0.8 * vis, 1, b.flashSprite);
  const nf = n(10 + 5 * sq);
  for (let i = 0; i < nf; i++) {
    const u = rand(-1, 1);
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const v = R * rand(0.8, 2);
    G.spawn(PARTICLES.fire, x, y, z, Math.cos(a) * r * v, u * v, Math.sin(a) * r * v, R * rand(0.6, 1) * vis, rand(0.6, 1.1));
    if (!b.soft && i % 2 === 0) {
      fx.smoke.spawn(PARTICLES.flame, x, y, z, Math.cos(a) * r * v, u * v, Math.sin(a) * r * v, R * rand(0.6, 0.9) * vis, rand(0.6, 1));
    }
  }
  const nsp = n(22 + 8 * size);
  for (let i = 0; i < nsp; i++) {
    const u = rand(-0.6, 1);
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const v = rand(25, 60) * sq;
    G.spawn(PARTICLES.spark, x, y, z, Math.cos(a) * r * v, u * v, Math.sin(a) * r * v, rand(0.8, 1.5) * sq * Math.sqrt(vis), rand(0.9, 1.6));
  }
  const ns = n(6 + 3 * size);
  for (let i = 0; i < ns; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = R * rand(0.2, 0.5);
    if (b.soft) {
      fx.smoke.spawn(PARTICLES.trailSmoke, x, y, z, Math.cos(a) * v, rand(-2, 3), Math.sin(a) * v, R * rand(0.35, 0.6) * vis, rand(0.7, 1), 1.4);
    } else {
      fx.smoke.spawn(PARTICLES.smokeDark, x, y, z, Math.cos(a) * v, rand(-2, 3), Math.sin(a) * v, R * rand(0.7, 1.1), rand(0.7, 1.1));
    }
  }
  if (b.soft) {
    // A few stars in the pop.
    const nst = n(10 + 4 * size);
    for (let i = 0; i < nst; i++) {
      const u = rand(-1, 1);
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const v = rand(10, 26);
      fx.star.spawn(PARTICLES.sparkle, x, y, z, Math.cos(a) * r * v, u * v, Math.sin(a) * r * v, rand(2, 3.6) * sq * vis, rand(0.8, 1.2), 1, 1, 0.9, 0.62);
    }
  } else {
    // A drone or missile going down for real: a short shock ring (it has
    // nothing to run along, so it is small and quick next to a ground
    // blast's), and burning chunks thrown out on arcs — the same debris
    // pool as a ground hit, trailing their own smoke as they fall (Debris.
    // update), splashing if they reach the sea. More, and bigger, for a
    // drone than the missile that downed it: `size` already says which.
    ring(fx, x, y, z, R * 0.5, R * 3.4, 0.5, 0.35, false);
    const nd = Math.min(14, n(3 + 6 * size));
    for (let i = 0; i < nd; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = rand(0.1, 1.3);
      const v = rand(18, 42) * sq;
      const c = Math.random() < 0.55 ? DEBRIS_METAL : DEBRIS_METEOR;
      const vx = Math.cos(a) * Math.cos(el) * v;
      const vy = Math.sin(el) * v + R * 0.3;
      const vz = Math.sin(a) * Math.cos(el) * v;
      fx.debris.spawn(x, y, z, vx, vy, vz, rand(0.7, 1.7) * sq, c[0], c[1], c[2], rand(6, 9));
      // A glowing ember riding the same arc, so a falling chunk reads as
      // burning, not just as a dark rock the smoke trail happens to follow.
      fx.glow.spawn(PARTICLES.ember, x, y, z, vx, vy, vz, rand(0.8, 1.3) * sq * vis, rand(0.8, 1.2));
    }
  }
}

function spawnSplash(fx, b, n) {
  const { x, y, z, R, size, vis } = b;
  const meteor = b.kind === 'meteor';
  const S = fx.smoke;
  const up = Math.sqrt(size);
  const y0 = y + 0.4;
  // The column: most of the water leaves nearly vertically and falls straight back.
  const nc = n(40 + 16 * size);
  for (let i = 0; i < nc; i++) {
    const a = Math.random() * Math.PI * 2;
    const spread = rand(0.5, 5) * up;
    S.spawn(PARTICLES.spray, x + Math.cos(a) * R * 0.15, y0, z + Math.sin(a) * R * 0.15,
      Math.cos(a) * spread, rand(26, 52) * up, Math.sin(a) * spread, R * rand(0.7, 1.2) * Math.sqrt(vis), rand(0.8, 1.25));
  }
  // The crown, thrown out at forty-five degrees.
  const nr = n(26 + 8 * size);
  for (let i = 0; i < nr; i++) {
    const a = (i / nr) * Math.PI * 2;
    const v = rand(14, 26) * up;
    S.spawn(PARTICLES.spray, x + Math.cos(a) * R * 0.3, y0, z + Math.sin(a) * R * 0.3,
      Math.cos(a) * v, v * rand(0.8, 1.1), Math.sin(a) * v, R * rand(0.45, 0.8), rand(0.6, 0.9));
  }
  const nm = n(8 + 3 * size);
  for (let i = 0; i < nm; i++) {
    const a = Math.random() * Math.PI * 2;
    S.spawn(PARTICLES.mist, x + Math.cos(a) * R * 0.5, y + R * rand(0.2, 0.8), z + Math.sin(a) * R * 0.5,
      Math.cos(a) * 3, rand(1, 4), Math.sin(a) * 3, R * rand(0.8, 1.3), rand(0.8, 1.3));
  }
  if (meteor) {
    // A hot rock in the sea: a flash under the water and a lot of steam.
    fx.glow.spawn(PARTICLES.flash, x, y + 2, z, 0, 0, 0, R * 0.6 * vis, 1, 0.6 * b.flashSprite);
    b.steamLeft = 9 + size * 2;
  }
  // Ripples, and a foam patch that sits there after.
  ring(fx, x, y + 0.35, z, R * 0.5, R * 7, 5, 0.5, true);
  ring(fx, x, y + 0.4, z, R * 0.3, R * 4.5, 4, 0.45, true);
  ring(fx, x, y + 0.45, z, R * 0.8, R * 2.6, 14, 0.55, true, true);
}

function spawnSparkle(fx, b, n) {
  const { x, y, z, R, size } = b;
  const nsp = n(40 + 12 * size);
  for (let i = 0; i < nsp; i++) {
    const u = rand(-1, 1);
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const v = rand(8, 26) * Math.sqrt(size);
    // Rainbow — hue spread round the wheel, bright and pale.
    _c.setHSL(Math.random(), 0.85, 0.66);
    fx.star.spawn(PARTICLES.sparkle, x, y, z, Math.cos(a) * r * v, u * v + 3, Math.sin(a) * r * v,
      rand(1.6, 3.2) * Math.sqrt(size) * b.vis, rand(0.7, 1.3), 1, _c.r, _c.g, _c.b);
  }
  fx.glow.spawn(PARTICLES.flash, x, y, z, 0, 0, 0, R * 0.3 * b.vis, 1.4, 0.7 * b.flashSprite);
}

/*
 * A meteor zapped out of the sky: it SHATTERS, not burns. A small fireball
 * at the centre (rock is not fuel), a hot fragment burst — glowing chunks
 * on arcs trailing their own smoke, the same debris pool a ground hit uses
 * — and a pale dust cloud drifting off the break. No shockwave ring (there
 * is nothing for it to run along up here) and no scorch mark (nothing under
 * it to mark).
 */
function spawnShatter(fx, b, n) {
  const { x, y, z, R, size, vis } = b;
  const G = fx.glow;
  const S = fx.smoke;
  const sq = Math.sqrt(size);
  G.spawn(PARTICLES.flash, x, y, z, 0, 0, 0, R * 0.55 * vis, 1, 0.65 * b.flashSprite);
  // A little fire at the break — just enough to sell the hit, not a fuel fire.
  const nf = n(5 + 2 * sq);
  for (let i = 0; i < nf; i++) {
    const u = rand(-1, 1);
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const v = R * rand(0.5, 1.3);
    G.spawn(PARTICLES.fire, x, y, z, Math.cos(a) * r * v, u * v, Math.sin(a) * r * v, R * rand(0.4, 0.7) * vis, rand(0.5, 0.9));
  }
  // The fragment burst: hot sparks, same shape a ground hit's spark layer uses.
  const nsp = n(16 + 6 * size);
  for (let i = 0; i < nsp; i++) {
    const u = rand(-1, 1);
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const v = rand(20, 46) * sq;
    G.spawn(PARTICLES.spark, x, y, z, Math.cos(a) * r * v, u * v, Math.sin(a) * r * v, rand(0.7, 1.3) * sq * Math.sqrt(vis), rand(0.8, 1.4));
  }
  // Glowing rock chunks on arcs, trailing smoke as they fall (Debris.update);
  // more fragments than an airburst gets, because this is mostly what the
  // rock has to show for itself.
  const nd = Math.min(18, n(5 + 7 * size));
  for (let i = 0; i < nd; i++) {
    const a = Math.random() * Math.PI * 2;
    const el = rand(0.05, 1.3);
    const v = rand(16, 40) * sq;
    const c = Math.random() < 0.4 ? DEBRIS_METEOR : DEBRIS_ROCK;
    const vx = Math.cos(a) * Math.cos(el) * v;
    const vy = Math.sin(el) * v + R * 0.2;
    const vz = Math.sin(a) * Math.cos(el) * v;
    fx.debris.spawn(x, y, z, vx, vy, vz, rand(0.6, 1.5) * sq, c[0], c[1], c[2], rand(6, 9));
    G.spawn(PARTICLES.ember, x, y, z, vx, vy, vz, rand(0.7, 1.2) * sq * vis, rand(0.9, 1.3));
  }
  // A pale dust cloud off the break — drifting, not hugging the ground
  // (PARTICLES.dust pins itself to the terrain, wrong for something that
  // just shattered in open sky).
  const ndu = n(8 + 3 * size);
  for (let i = 0; i < ndu; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = R * rand(0.15, 0.4);
    S.spawn(PARTICLES.trailSmoke, x, y, z, Math.cos(a) * v, rand(-1, 2), Math.sin(a) * v, R * rand(0.6, 1), rand(0.7, 1.1));
  }
}

function ring(fx, x, y, z, r0, r1, life, a, water, foam = false) {
  let r = null;
  for (let i = 0; i < fx.rings.length; i++) {
    if (!fx.rings[i].active) {
      r = fx.rings[i];
      break;
    }
  }
  if (!r) {
    r = fx.rings[0];
    for (let i = 1; i < fx.rings.length; i++) {
      const k = fx.rings[i];
      if (k.t / k.life > r.t / r.life) r = k;
    }
  }
  r.active = true;
  r.t = 0;
  r.life = life;
  r.r0 = r0;
  r.r1 = r1;
  r.a = a;
  r.x = x;
  r.y = y;
  r.z = z;
  r.water = water;
  r.mesh.material.map = foam ? fx.tx.foam : fx.tx.ring;
  r.mesh.material.color.setHex(water ? 0xe6f4ff : 0xffdcae);
  r.mesh.position.set(x, y, z);
  r.mesh.scale.setScalar(r0);
  r.mesh.material.opacity = a;
  r.mesh.visible = true;
  r.foam = foam;
}

/* ====================================================================== */
/* Per-frame                                                               */
/* ====================================================================== */

export function updateExplosions(sim, dt) {
  const fx = FX;
  if (!fx || !fx.parent || !fx.parent.parent) return;
  if (!(dt > 0)) return;
  dt = Math.min(dt, 0.1);
  FRAME = (FRAME + 1) & 0xffff;
  CLOCK += dt;
  if (FRAME % 30 === 1) refreshLight(sim);
  const wind = windOf(sim);
  const L = listenerPos(sim);

  // Scheduled bangs (the dev button's "twenty in a row").
  for (let i = fx.queue.length - 1; i >= 0; i--) {
    const q = fx.queue[i];
    q.t -= dt;
    if (q.t <= 0) {
      fx.queue.splice(i, 1);
      explode(sim, q.pos, q.opts);
    }
  }

  let bestLight = 0;
  let bestBlast = null;
  let skyBoost = 0;
  let columns = 0;
  for (let i = 0; i < fx.blasts.length; i++) if (fx.blasts[i].active && fx.blasts[i].columnLeft > 0) columns++;
  // With many columns standing, each one breathes less, so a string of bombs
  // cannot fill the smoke pool on its own.
  const columnShare = columns > 4 ? 4 / columns : 1;

  for (let bi = 0; bi < fx.blasts.length; bi++) {
    const b = fx.blasts[bi];
    if (!b.active) continue;
    b.t += dt;
    const { x, y, z, R, size } = b;

    // Light: a hard flash, then (on land) the fire flickering down.
    const flash = Math.exp(-b.t * 9);
    const burn = b.fireLeft > 0 || b.glowLeft > 0 ? Math.min(1, (b.fireLeft + b.glowLeft) / 6) * (0.75 + 0.25 * Math.sin(b.t * 13)) : 0;
    const light = b.lightPeak * (flash * b.flashLight + 0.06 * burn);
    if (light > bestLight) {
      bestLight = light;
      bestBlast = b;
    }
    if (L && flash > 0.02) {
      const d = Math.hypot(L.x - x, L.y - y, L.z - z);
      const reach = 700 * Math.sqrt(size);
      skyBoost += flash * b.flashLight * b.flashK * Math.sqrt(size) * (1 / (1 + (d / reach) * (d / reach)));
    }

    // The column, climbing and leaning with the wind.
    if (b.columnLeft > 0) {
      b.columnLeft -= dt;
      const fade = Math.min(1, b.columnLeft / 4);
      b.columnAcc += dt * b.columnRate * columnShare * fade;
      while (b.columnAcc >= 1) {
        b.columnAcc -= 1;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * R * 0.3;
        fx.smoke.spawn(PARTICLES.column, x + Math.cos(a) * r, y + R * 0.35, z + Math.sin(a) * r,
          rand(-1, 1), rand(16, 24) * Math.sqrt(size), rand(-1, 1), R * rand(0.8, 1.2) * b.vis, rand(0.85, 1.15));
      }
    }
    // Small flames at the middle of a bomb's scorch.
    if (b.fireLeft > 0) {
      b.fireLeft -= dt;
      b.fireAcc += dt * 9;
      while (b.fireAcc >= 1) {
        b.fireAcc -= 1;
        fx.glow.spawn(PARTICLES.ember, x + rand(-R, R) * 0.35, y + 0.8, z + rand(-R, R) * 0.35, 0, rand(1, 3), 0,
          Math.sqrt(size) * rand(0.9, 1.6), rand(0.7, 1.2), Math.min(1, b.fireLeft / 2));
      }
    }
    // A meteor crater stays hot for a while.
    if (b.glowLeft > 0) {
      b.glowLeft -= dt;
      b.glowAcc += dt * 3;
      while (b.glowAcc >= 1) {
        b.glowAcc -= 1;
        fx.glow.spawn(PARTICLES.hotglow, x + rand(-R, R) * 0.25, y + 1, z + rand(-R, R) * 0.25, 0, 0.4, 0,
          R * 0.6, 1, Math.min(1, b.glowLeft / 8));
        if (Math.random() < 0.5) {
          fx.smoke.spawn(PARTICLES.column, x, y + 2, z, rand(-0.5, 0.5), rand(3, 6), rand(-0.5, 0.5), R * 0.4, 0.6, 0.6);
        }
      }
    }
    // Steam off a hot rock in the sea.
    if (b.steamLeft > 0) {
      b.steamLeft -= dt;
      b.steamAcc += dt * 6;
      while (b.steamAcc >= 1) {
        b.steamAcc -= 1;
        fx.smoke.spawn(PARTICLES.steam, x + rand(-R, R) * 0.4, y + 1, z + rand(-R, R) * 0.4, 0, rand(3, 6), 0, R * rand(0.7, 1.1), 1,
          Math.min(1, b.steamLeft / 3));
      }
    }

    // The pressure wave. It reaches you when it reaches you — including when
    // you are flying away from it.
    if (!b.heard) {
      b.waveR += SOUND_SPEED * dt;
      const d = L ? Math.hypot(L.x - x, L.y - y, L.z - z) : 0;
      if (b.waveR >= d || b.t > 40) {
        b.heard = true;
        if (b.t <= 40) arrive(sim, b, d);
      }
    }

    const busy = b.columnLeft > 0 || b.fireLeft > 0 || b.glowLeft > 0 || b.steamLeft > 0 || !b.heard || b.t < 1.5;
    if (!busy) b.active = false;
  }

  // One light, at the brightest thing happening.
  const light = fx.light;
  const lit = LIGHT_SMOOTH.step(bestBlast && bestLight > 1 ? bestLight : 0, dt);
  if (bestBlast && bestLight > 1) {
    // (Reduce flashing: glides to the new bang instead of jumping.)
    const k = FLASH.reduce && lit > 1 ? 1 - Math.exp(-dt * 6) : 1;
    light.position.lerp(_lightTo.set(bestBlast.x, bestBlast.y + bestBlast.R * 0.6, bestBlast.z), k);
    light.distance = bestBlast.lightRange;
    light.color.setHex(bestBlast.lightCol);
  }
  light.intensity = lit > 1 ? lit : 0;
  // The whole sky, briefly, if it was close. sky.update() rewrites the
  // hemisphere light every frame before this runs, so adding to it cannot
  // accumulate.
  const boost = SKY_SMOOTH.step(skyBoost > 0.01 ? Math.min(1.4, skyBoost * 0.9) : 0, dt);
  if (boost > 0.005 && sim && sim.sky && sim.sky.hemi) {
    sim.sky.hemi.intensity += boost;
  }

  // Rings.
  for (let i = 0; i < fx.rings.length; i++) {
    const r = fx.rings[i];
    if (!r.active) continue;
    r.t += dt;
    const f = r.t / r.life;
    if (f >= 1) {
      r.active = false;
      r.mesh.visible = false;
      continue;
    }
    const e = r.foam ? f : 1 - (1 - f) * (1 - f);
    r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * e);
    r.mesh.material.opacity = r.a * (r.foam ? Math.min(1, (1 - f) * 2) : 1 - f);
  }

  fx.glow.update(dt, wind);
  fx.star.update(dt, wind);
  fx.smoke.update(dt, wind);
  fx.debris.update(dt, fx.smoke);
  fx.decals.update(dt);
  updateScreenFlash(sim, fx, dt);
}

/** The wave has reached the listener: the boom and the shake, together. */
function arrive(sim, b, d) {
  const fx = FX;
  const size = b.size;
  if (b.kind !== 'sparkle') {
    const reach = 650 * Math.sqrt(size);
    let k = Math.sqrt(size) * Math.max(0, 1 - d / reach) * 1.1;
    if (b.water) k *= 0.8;
    if (b.air) k *= 0.7;
    if (b.gentle) k *= 0.5;
    if (k > 0.03) {
      if (sim && sim.rig && sim.rig.kick) sim.rig.kick(Math.min(1.3, k));
      // The bomb cam owns the camera, so the rig's shake would not show.
      if (CAM.active) CAM.shake = Math.min(1.2, CAM.shake + k);
    }
  }
  if (!b.silent) playBoom(sim, b, d);
  fx.booms++;
  fx.lastBoom = { id: b.id, distance: d, at: b.t, expected: soundDelay(d) };
}

function updateScreenFlash(sim, fx, dt) {
  if (fx.screenA <= 0.002) {
    if (fx.screen && fx.screen.style.opacity !== '0') fx.screen.style.opacity = '0';
    fx.screenA = 0;
    return;
  }
  if (!fx.screen) {
    try {
      const el = document.createElement('div');
      Object.assign(el.style, {
        position: 'absolute', inset: '0', pointerEvents: 'none', opacity: '0',
        background: 'radial-gradient(circle at 50% 55%, rgba(255,236,200,0.95), rgba(255,170,90,0.55) 60%, rgba(255,140,60,0.25))',
      });
      extLayer().appendChild(el);
      fx.screen = el;
    } catch (e) {
      fx.screenA = 0;
      return;
    }
  }
  fx.screen.style.opacity = fx.screenA.toFixed(3);
  fx.screenA *= Math.exp(-dt * 7);
}

/* ====================================================================== */
/* Sound                                                                   */
/* ====================================================================== */

function mixerOf(sim) {
  const a = sim && sim.audio;
  if (!a || !a.available || !a.mixer || !a.mixer.ctx) return null;
  return a.mixer;
}

/**
 * The boom. Three layers and a tail, all synthesised: a sub-bass thump, a
 * body of pink noise whose brightness drops with distance (air eats the top
 * end, which is why far thunder rumbles and near thunder cracks), a crack for
 * close ones, and a rolling tail that gets LONGER with distance. Quiet by the
 * game's standard — at a hundred metres a practice bomb peaks below the
 * crash sound, and it goes through the environment slider.
 */
function playBoom(sim, b, d) {
  const m = mixerOf(sim);
  if (!m) return;
  try {
    const size = b.size;
    const p = 1 / (1 + d / 320);
    const big = Math.min(1.6, 0.7 + 0.3 * Math.sqrt(size));
    const g = Math.min(0.62, 0.42 * p * big);
    if (g < 0.004) return;
    if (b.kind === 'sparkle') {
      // A pop and a little rising chime, not a bang. Scheduled on the audio
      // clock, so a paused game does not play the end of it later.
      const notes = [1046.5, 1318.5, 1568, 2093];
      for (let i = 0; i < notes.length; i++) {
        chime(m, notes[i], m.time + i * 0.045, 0.07 * p + 0.01);
      }
      m.noiseBurst({ bus: 'environment', duration: 0.12, gain: 0.12 * p, type: 'bandpass', freq: 2600, q: 1.2, attack: 0.002 });
      return;
    }
    if (b.gentle) {
      // A thud and a patter of dirt: no crack, no long roll.
      m.tone({ bus: 'environment', freq: 64, sweepTo: 30, duration: 0.7, gain: g * 0.7, type: 'sine', attack: 0.004 });
      m.noiseBurst({ bus: 'environment', duration: 0.9, gain: g * 0.6, type: 'lowpass', freq: 240 + 500 * p, q: 0.7, attack: 0.006, pink: true });
      for (let i = 0; i < 4 && d < 600; i++) {
        m.noiseBurst({ bus: 'environment', duration: 0.07, gain: g * 0.1, type: 'bandpass', freq: rand(1500, 3800), q: 3, when: m.time + rand(0.4, 1.2) });
      }
      return;
    }
    // Sub thump.
    m.tone({ bus: 'environment', freq: 72, sweepTo: 26, duration: 1.1 + 0.2 * size, gain: g * 0.9, type: 'sine', attack: 0.004 });
    // Body. Brighter close, muffled far.
    m.noiseBurst({
      bus: 'environment', duration: 1.2 + 2.2 * (1 - p) + 0.35 * size, gain: g, type: 'lowpass',
      freq: 180 + 1400 * p * p, q: 0.7, attack: 0.006, pink: true,
    });
    // Crack, if close enough to hear the top of it.
    if (d < 800) m.noiseBurst({ bus: 'environment', duration: 0.28, gain: g * 0.55 * (1 - d / 800), type: 'highpass', freq: 1100, attack: 0.002 });
    // Rolling tail.
    m.noiseBurst({ bus: 'environment', duration: 2.6 + 3 * (1 - p) + size * 0.5, gain: g * 0.35, type: 'lowpass', freq: 110, q: 0.6, attack: 0.25, pink: true });
    if (b.water) {
      // Sploosh, then the spray falling back.
      m.noiseBurst({ bus: 'environment', duration: 1.3, gain: g * 0.7, type: 'lowpass', freq: 900, q: 0.5, attack: 0.03, pink: true });
      m.noiseBurst({ bus: 'environment', duration: 2.2, gain: g * 0.22, type: 'highpass', freq: 2600, attack: 0.4 });
    } else if (!b.air && d < 450) {
      // Pebbles coming back down.
      for (let i = 0; i < 4; i++) {
        m.noiseBurst({ bus: 'environment', duration: 0.07, gain: g * 0.12, type: 'bandpass', freq: rand(1500, 3800), q: 3, when: m.time + rand(0.5, 1.5) });
      }
    }
  } catch (e) {
    /* sound is a nicety; never let it cost the bang */
  }
}

/** One sine note at an exact time on the audio clock (mixer.tone() can only play now). */
function chime(m, freq, when, gain) {
  const ctx = m.ctx;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const g = ctx.createGain();
  const t = Math.max(when, ctx.currentTime);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  osc.connect(g);
  g.connect(m.bus('environment'));
  osc.start(t);
  osc.stop(t + 0.4);
}

/**
 * A falling bomb whistles. Real ones barely do; cartoon ones always have, and
 * this is the cartoon version on purpose — the pitch sliding down tells you
 * it is nearly there. Very quiet, and quieter the further it is from you.
 */
function startWhistle(sim, fallSeconds) {
  const m = mixerOf(sim);
  if (!m || !FX) return;
  stopWhistle();
  try {
    const ctx = m.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1450, t);
    osc.frequency.exponentialRampToValueAtTime(420, t + Math.max(0.6, fallSeconds));
    const vib = ctx.createOscillator();
    vib.frequency.value = 7;
    const vibGain = ctx.createGain();
    vibGain.gain.value = 9;
    vib.connect(vibGain);
    vibGain.connect(osc.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.03, t + 0.25);
    osc.connect(g);
    g.connect(m.bus('environment'));
    osc.start(t);
    vib.start(t);
    osc.stop(t + fallSeconds + 2);
    vib.stop(t + fallSeconds + 2);
    FX.whistle = { osc, vib, g, m };
  } catch (e) {
    FX.whistle = null;
  }
}

function setWhistleLevel(level) {
  const w = FX && FX.whistle;
  if (!w) return;
  try {
    w.g.gain.setTargetAtTime(Math.max(0.0001, 0.03 * level), w.m.ctx.currentTime, 0.1);
  } catch (e) {
    /* ignore */
  }
}

function stopWhistle() {
  const w = FX && FX.whistle;
  if (!w) return;
  FX.whistle = null;
  try {
    const t = w.m.ctx.currentTime;
    w.g.gain.cancelScheduledValues(t);
    w.g.gain.setTargetAtTime(0.0001, t, 0.02);
    w.osc.stop(t + 0.15);
    w.vib.stop(t + 0.15);
  } catch (e) {
    /* already stopped */
  }
}

/* ====================================================================== */
/* The bomb cam                                                            */
/* ====================================================================== */

/*
 * A bomb dropped from 1,000 ft lands behind and below the aeroplane —
 * about sixty degrees under anything the chase camera shows, and out of
 * sight entirely in the cockpit. So the one moment the whole run was for
 * happened off screen, every time. The bomb cam cuts to a spot beside the
 * blast for three seconds, drifting slowly round it, then hands the camera
 * back. It only happens when it is safe to look away: well clear of the
 * ground and not diving at it.
 *
 * Changing the view skips it — C, the touch camera button, the pad, or a
 * rebound key, whichever the player uses — because it watches the view
 * itself (sim.rig.mode) rather than a key. The first version took C through
 * the key hook, and C is the game's own camera key; the label also said "C"
 * on an iPad, which has no C.
 *
 * Its clock runs in the update hook, not the camera hook. If another feature
 * owned the camera that frame, the camera hook was never called, the bomb
 * cam never timed out, and its label stayed on screen.
 */
const CAM = { active: false, t: 0, life: 3.2, x: 0, y: 0, z: 0, R: 20, ang: 0, dist: 200, h: 70, shake: 0, el: null, bar: null, fov: 55, view: null };
export const BOMB_CAM_SECONDS = 3.2;

function camSafe(sim) {
  const ac = sim && sim.aircraft;
  if (!ac || ac.crashed || sim.state !== 'flying' || sim.mode === 'drive') return false;
  if (sim.settings && sim.settings.bombCam === false) return false;
  return ac.agl > 110 && ac.vs > -22;
}

const viewOf = (sim) => (sim && sim.rig && typeof sim.rig.mode === 'string' ? sim.rig.mode : null);

/** Still wanted this frame? Ends it (and says no) if not. */
function camStillWanted(sim) {
  if (!CAM.active) return false;
  if (!camSafe(sim) || viewOf(sim) !== CAM.view || CAM.t >= CAM.life) {
    endBombCam(sim, viewOf(sim) !== CAM.view);
    return false;
  }
  return true;
}

function startBombCam(sim, blast) {
  if (!blast || !camSafe(sim)) return false;
  const ac = sim.aircraft;
  CAM.active = true;
  CAM.t = 0;
  CAM.life = BOMB_CAM_SECONDS;
  CAM.view = viewOf(sim);
  CAM.x = blast.x;
  CAM.y = blast.y;
  CAM.z = blast.z;
  CAM.R = blastRadius(blast.size);
  CAM.dist = CAM.R * 9;
  CAM.h = CAM.R * 2.6;
  CAM.shake = 0;
  // From the side the aeroplane is NOT on, a little round from its track, so
  // the column goes up in front of you with the sky behind it.
  const away = Math.atan2(blast.z - ac.pos.z, blast.x - ac.pos.x);
  CAM.ang = away + (Math.random() < 0.5 ? 0.6 : -0.6);
  showCamLabel(true);
  return true;
}

/**
 * @param {boolean} viewChanged the player changed the view themselves; the
 *   rig is already starting its new view, so leave it be.
 */
function endBombCam(sim, viewChanged = false) {
  if (!CAM.active) return;
  CAM.active = false;
  showCamLabel(false);
  // Snap the chase camera back behind the aeroplane rather than letting its
  // spring haul it across three seconds of flying.
  if (!viewChanged && sim && sim.rig) sim.rig.initialised = false;
}

/** The clock, every frame from the update hook. */
function tickBombCam(sim, dt) {
  if (!CAM.active) return;
  CAM.t += dt;
  CAM.ang += dt * 0.12;
  CAM.shake = Math.max(0, CAM.shake - dt * 2.4);
  if (!camStillWanted(sim)) return;
  if (CAM.bar) {
    const w = Math.round(100 * (1 - CAM.t / CAM.life));
    if (CAM.barW !== w) {
      CAM.barW = w;
      CAM.bar.style.width = `${w}%`;
    }
  }
}

function showCamLabel(on) {
  try {
    if (!CAM.el) {
      if (!on) return;
      // No key named: it is skipped by changing the view, however you do that.
      const el = document.createElement('div');
      el.textContent = 'BOMB CAM';
      Object.assign(el.style, {
        position: 'absolute', left: '50%', top: '18%', transform: 'translateX(-50%)',
        padding: '5px 14px 8px', borderRadius: '8px', font: '650 12px/1.2 system-ui, sans-serif',
        letterSpacing: '0.14em', color: '#fff3e2', background: 'rgba(40,24,12,0.55)',
        border: '1px solid rgba(255,190,120,0.6)', pointerEvents: 'none', display: 'none',
      });
      // How long until it hands back: a bar that empties.
      const track = document.createElement('div');
      Object.assign(track.style, {
        position: 'absolute', left: '10px', right: '10px', bottom: '3px', height: '2px',
        borderRadius: '2px', background: 'rgba(255,220,180,0.25)', overflow: 'hidden',
      });
      const bar = document.createElement('div');
      Object.assign(bar.style, { height: '100%', width: '100%', background: 'rgba(255,200,140,0.9)' });
      track.appendChild(bar);
      el.appendChild(track);
      extLayer().appendChild(el);
      CAM.el = el;
      CAM.bar = bar;
    }
    CAM.el.style.display = on ? 'block' : 'none';
    if (on && CAM.bar) {
      CAM.barW = 100;
      CAM.bar.style.width = '100%';
    }
  } catch (e) {
    /* no DOM: the camera still works */
  }
}

/** Places the camera; the clock is tickBombCam's. */
function bombCamera(sim, dt, camera) {
  if (!camera || !camStillWanted(sim)) return false;
  const x = CAM.x + Math.cos(CAM.ang) * CAM.dist;
  const z = CAM.z + Math.sin(CAM.ang) * CAM.dist;
  let y = CAM.y + CAM.h;
  const gh = safeHeight(x, z);
  if (y < gh + 12) y = gh + 12;
  const k = CAM.shake * (sim.settings && sim.settings.reducedMotion ? 0.25 : 1);
  // Reduce flashing: the same shake on a slower clock, under 3 Hz (flash-safety.js).
  const t = shakeClock(CAM.t);
  camera.position.set(x + Math.sin(t * 61) * k, y + Math.sin(t * 53.7 + 1.3) * k, z + Math.sin(t * 43.3) * k * 0.5);
  camera.lookAt(CAM.x, CAM.y + CAM.R * 1.4, CAM.z);
  camera.fov = CAM.fov;
  camera.near = 0.5;
  camera.updateProjectionMatrix();
  return true;
}

/* ====================================================================== */
/* The practice bomb, hooked where it lands                                */
/* ====================================================================== */

/*
 * main.js owns the bomb (markers.js PracticeBomb, dropped by dropCargo on X).
 * Each frame it calls `crate.update()` and then, if `justExploded` is set,
 * plays the thunder clip and clears the flag — all before any feature's
 * update hook runs. Watching from the update hook alone therefore saw the
 * landing a frame late and could not stop that thunder, so every bomb went
 * off twice in the ears: the clip at once, then the real boom seconds later.
 *
 * So the first time the update hook sees a new bomb, it wraps that one
 * bomb's own update(). The wrapper runs the original, then takes the bang
 * over on the same frame it happens: it clears `justExploded` (so main.js
 * plays nothing), hides the old sphere-and-ring, and calls explode(). If
 * this feature has been switched off for throwing, the wrapper does nothing
 * and the old bang happens exactly as before.
 *
 * The sea: the bomb's own ground test is heightAt(), which is the SEA BED,
 * so over water it used to sail through the surface and go off 34 m down.
 * The wrapper catches it crossing the surface and splashes there instead;
 * the store carries on invisibly to the bottom so the range mission's
 * scoring, which waits for `landed`, still sees it arrive.
 */
const BOMB_SIZE = 1;
const watch = { crate: null, isBomb: false, done: false, splashed: false, fallT: 0, sim: null };

function isPracticeBomb(c) {
  return !!(c && c.fire && c.ring && c.scorch && c.dust && c.group && c.vel && typeof c.update === 'function');
}

function muteLegacy(c) {
  for (const k of ['fire', 'ring', 'dust', 'scorch']) {
    const o = c[k];
    if (o && o.material) o.material.visible = false;
  }
}

function featureLive() {
  try {
    const me = extStatus().find((e) => e.id === 'explosions');
    return !me || me.live;
  } catch (e) {
    return true;
  }
}

function bombBang(sim, c, x, y, z) {
  stopWhistle();
  watch.done = true;
  const r = explode(sim, { x, y, z }, { size: BOMB_SIZE, kind: 'bomb' });
  if (r && watch.fallT > 3) startBombCam(sim, r);
  return r;
}

/** Runs right after the bomb's own update(), inside main.js's frame. */
function afterBombStep(c) {
  const sim = watch.sim;
  if (!sim || watch.crate !== c) return;
  const p = c.group.position;
  if (!watch.done && !c.landed && p.y <= 0.3 && safeHeight(p.x, p.z) < 0) {
    if (!featureLive()) return;
    watch.splashed = true;
    c.group.visible = false;
    bombBang(sim, c, p.x, 0, p.z);
    return;
  }
  if (c.justExploded) {
    if (!featureLive()) return;
    c.justExploded = false;
    muteLegacy(c);
    if (!watch.done) bombBang(sim, c, p.x, p.y, p.z);
  }
}

function adoptBomb(sim, c) {
  if (c.__fxWrapped) return;
  const orig = c.update;
  c.__fxWrapped = true;
  c.update = function fxBombUpdate(dt, heightAt, wind) {
    orig.call(this, dt, heightAt, wind);
    try {
      afterBombStep(this);
    } catch (e) {
      /* the bomb keeps its own bang rather than the frame falling over */
    }
  };
}

function watchBomb(sim, dt) {
  const c = sim.crate;
  if (c !== watch.crate) {
    watch.crate = c || null;
    watch.isBomb = isPracticeBomb(c);
    watch.done = false;
    watch.splashed = false;
    watch.fallT = 0;
    watch.sim = sim;
    stopWhistle();
    if (watch.isBomb) {
      adoptBomb(sim, c);
      if (!c.landed) {
        const p = c.group.position;
        const gh = safeHeight(p.x, p.z);
        const h = Math.max(0, p.y - Math.max(0, gh));
        const vy = c.vel.y;
        const tFall = (vy + Math.sqrt(vy * vy + 2 * GRAV * h)) / GRAV;
        startWhistle(sim, Math.min(40, tFall));
      }
    }
  }
  if (!watch.isBomb || !c) return;
  if (!watch.done) watch.fallT += dt;
  const p = c.group.position;
  const L = listenerPos(sim);
  if (L && !watch.done) setWhistleLevel(1 / (1 + p.distanceTo(L) / 400));
  // Landed on the very frame it was dropped (before it could be wrapped):
  // main.js has already played its clip, but the picture can still be ours.
  if (c.landed && !watch.done) {
    muteLegacy(c);
    bombBang(sim, c, p.x, p.y, p.z);
  }
}

/* ====================================================================== */
/* Housekeeping, stats, the extension                                      */
/* ====================================================================== */

export function clearExplosions() {
  const fx = FX;
  if (!fx) return;
  for (const b of fx.blasts) b.active = false;
  for (const r of fx.rings) {
    r.active = false;
    r.mesh.visible = false;
  }
  fx.glow.clear();
  fx.star.clear();
  fx.smoke.clear();
  fx.debris.clear();
  fx.decals.clear();
  fx.queue.length = 0;
  fx.light.intensity = 0;
  fx.screenA = 0;
  if (fx.screen) fx.screen.style.opacity = '0';
  stopWhistle();
}

/** For the tests and the console. */
export function explosionStats() {
  const fx = FX;
  if (!fx) return { built: false };
  return {
    built: true,
    blasts: fx.blasts.filter((b) => b.active).length,
    glow: fx.glow.n + fx.star.n,
    smoke: fx.smoke.n,
    debris: fx.debris.n,
    decals: fx.decals.count,
    rings: fx.rings.filter((r) => r.active).length,
    pendingBooms: fx.blasts.filter((b) => b.active && !b.heard).length,
    booms: fx.booms,
    lastBoom: fx.lastBoom,
    light: fx.light.intensity,
    caps: { glow: GLOW_CAP, smoke: SMOKE_CAP, star: STAR_CAP, debris: DEBRIS_CAP, decals: DECAL_CAP, blasts: BLAST_CAP },
    whistling: !!fx.whistle,
    bombCam: CAM.active,
    bombCamT: CAM.active ? CAM.t : 0,
    thuds: fx.thuds || 0,
  };
}

/** A shared particle for other features (meteor trails): see PARTICLES. */
export function fxParticle(sim, T, x, y, z, vx, vy, vz, sizeMul = 1, lifeMul = 1, alphaMul = 1, r = -1, g = -1, b = -1) {
  const fx = FX && FX.parent && FX.parent.parent ? FX : ensureFx(sim);
  if (!fx || !T) return -1;
  const batch = T.batch === 'smoke' ? fx.smoke : T.batch === 'star' ? fx.star : fx.glow;
  return batch.spawn(T, x, y, z, vx, vy, vz, sizeMul, lifeMul, alphaMul, r, g, b);
}

/** Bangs a few seconds apart, in game time (paused means paused). */
export function scheduleExplosion(pos, opts, delaySeconds) {
  if (!FX) return false;
  FX.queue.push({ t: Math.max(0, delaySeconds), pos: { x: pos.x, y: pos.y, z: pos.z }, opts: { ...opts } });
  return true;
}

function aheadOf(sim, metres, sideMetres = 0) {
  const ac = sim.aircraft;
  const h = ((ac && ac.heading) || 0) * (Math.PI / 180);
  const x = ac.pos.x + Math.sin(h) * metres + Math.cos(h) * sideMetres;
  const z = ac.pos.z - Math.cos(h) * metres + Math.sin(h) * sideMetres;
  return { x, y: safeHeight(x, z), z };
}

/*
 * Which aeroplanes get the rack in Free Flight. The first version gave it to
 * every `military: true` type, which would have included the fighters team's
 * jets the day they landed — a change to their aeroplanes they never asked
 * for. So: the Nightjar (the one type in the base roster built to carry
 * stores), and any military type that asks with `freeFlightStores: true` in
 * its roster entry. `freeFlightStores: false` opts the Nightjar out.
 */
const FREE_FLIGHT_RACK = new Set(['nightjar']);
export function rackInFreeFlight(t) {
  if (!t || !t.military || t.freeFlightStores === false) return false;
  return t.freeFlightStores === true || FREE_FLIGHT_RACK.has(t.id);
}

async function flyingForDev(sim) {
  if (sim.state === 'flying' && sim.mode !== 'drive') return true;
  if (!sim.startMode) return false;
  await sim.startMode('free', { airborne: true });
  return sim.state === 'flying';
}

registerExtension({
  id: 'explosions',
  install(sim) {
    // A handle for the console and for anything that would rather not import.
    sim.explode = (pos, opts) => explode(sim, pos, opts);
  },
  buildWorld(sim, group) {
    buildFx(sim, group);
  },
  startMode(sim, mode) {
    clearExplosions();
    endBombCam(sim);
    watch.crate = null;
    watch.isBomb = false;
    /*
     * Free flight in the bomber comes with the rack loaded. The bombs were
     * only ever handed out by the Weapons Range, so the one aeroplane built
     * to carry them flew around empty everywhere else and X said "Nothing to
     * drop right now". Only in Free Flight, and only for types that carry
     * stores — see rackInFreeFlight().
     */
    const t = sim.aircraftType;
    if (mode === 'free' && rackInFreeFlight(t) && !sim.hasCargo) {
      sim.hasCargo = true;
      if (sim.hud) sim.hud.notify('Practice stores aboard — press X to drop one', 'info', 4);
    }
  },
  stop(sim) {
    clearExplosions();
    endBombCam(sim);
    watch.crate = null;
    watch.isBomb = false;
  },
  update(sim, dt) {
    watchBomb(sim, dt);
    updateExplosions(sim, dt);
    if (dt > 0) tickBombCam(sim, Math.min(dt, 0.1));
  },
  camera(sim, dt, camera) {
    return bombCamera(sim, dt, camera);
  },
  devActions: [
    {
      label: 'Test explosion',
      hint: 'Sets off one practice-bomb blast 600 m ahead and to the right of you (starts a free flight if you are in the menu).',
      run(sim) {
        flyingForDev(sim)
          .then((ok) => {
            if (!ok) return;
            explode(sim, aheadOf(sim, 600, 250), { size: 1, kind: 'bomb' });
            sim.hud && sim.hud.notify('Test blast ahead — watch, then listen', 'info', 3);
          })
          .catch((e) => console.error('[explosions] test failed', e));
      },
    },
    {
      label: 'Twenty in a row',
      hint: 'Twenty blasts marching away from you, a fifth of a second apart — the stutter test.',
      run(sim) {
        flyingForDev(sim)
          .then((ok) => {
            if (!ok) return;
            for (let i = 0; i < 20; i++) scheduleExplosion(aheadOf(sim, 500 + i * 90, 200), { size: 1, kind: 'bomb' }, i * 0.2);
          })
          .catch((e) => console.error('[explosions] twenty failed', e));
      },
    },
  ],
});
