/**
 * The three vehicles built in Blender: the Skyhook helicopter, the Island
 * Courier van and the Kestrel launch.
 *
 * Everything else in this game is built from primitives in code, and these
 * three were too — a helicopter that was a trainer with a disc on a stick, a
 * van of eight boxes, a boat that was a box with a cone on the front. They are
 * now modelled properly, by script, in tools/blender/, and shipped as .glb
 * files in assets/models/. This file is the only part of the game that knows
 * they exist:
 *
 *   await preloadVehicleModels()     fetch + parse all three, once. Never
 *                                    throws: a file that is missing or broken
 *                                    is logged and that vehicle keeps its old
 *                                    model. A game that will not start is
 *                                    worse than one that looks plain.
 *   blenderHeli() / blenderCar() / blenderBoat()
 *                                    a fresh copy, or null if not loaded.
 *                                    Copies share geometry and materials; the
 *                                    lamps each get their own material so one
 *                                    van braking does not light another.
 *   animateBlenderVehicle(model, state, dt)
 *                                    rotors, wheels, props, radar, steering
 *                                    and lamps, from the state object below.
 *                                    The launch's wake too; never her pose,
 *                                    which is surface.js's (blenderHullFit
 *                                    hands it her numbers).
 *
 * Plus the two adapters the game's hooks call, so each hook is one line:
 * blenderDriveState() reads a SurfaceVehicle, blenderAircraftModel() wraps
 * the helicopter for model-adapter.js.
 *
 * THE STATE OBJECT. Every field is optional; a missing one means "off",
 * "still" or "straight ahead".
 *
 *   speed         m/s, signed, + forward. Wheels roll with it (van), props
 *                 turn with it (launch).
 *   steer         -1..1, + turns right (the game's sign: it raises the
 *                 heading). Outboards swing with it; the van's indicators
 *                 blink past 0.2, as the old van's did.
 *   steerAngle    van: radians of front-wheel lock, + right. Defaults to
 *                 steer * 0.52. blenderDriveState works out the real one.
 *   bodyPitch, bodyRoll
 *                 van: radians the body leans on its springs (dive, squat,
 *                 cornering roll) relative to the road. The wheels are turned
 *                 back by the same amount so they stay on the road while the
 *                 body leans over them.
 *   braking, reverse, hazard, headlights (default on: they are also the DRLs)
 *   beacon        van: the amber roof beacon turns.
 *   lights        nav lights (heli, launch). Default on.
 *   sea           launch: the sea's level (default 0), which the wash is
 *                 pinned to and the bow wave cuts the hull at. She is not
 *                 posed here: surface.js owns her pose (see blenderHullFit).
 *   wake          launch: draw the bow wave and wash (default on).
 *   rotor         heli: main-rotor speed, 0..1 of 400 rpm.
 *   cyclicPitch, cyclicRoll
 *                 heli: the stick, -1..1; tilts the disc up to 3 degrees.
 *   searchlight   heli: 0..1, the nose light and its spot.
 *   searchTilt    heli: radians the lamp points below the nose.
 *   winch         heli: metres of hoist cable out (0.5 is stowed).
 *   dark          0..1, how dark it is: sizes the heli's glow sprites.
 *
 * Nothing here needs a DOM: the tests run all of it in node.
 */

import * as THREE from '../vendor/three.module.js';
import { parseGLB, drawStats } from './glb.js';
import { createBoatWater } from './blender-boat-water.js';

/**
 * What each file must contain. `maxTriangles` is the budget the modeller was
 * given; the tests hold the shipped files to it.
 */
export const BLENDER_VEHICLES = {
  heli: {
    file: 'skyhook.glb',
    root: 'skyhook',
    maxTriangles: 32000,
    parts: [
      'body', 'glass', 'interior', 'rotor_main', 'rotor_main_blur', 'rotor_tail', 'searchlight',
      'winch_cable', 'winch_hook', 'light_nav_red', 'light_nav_green', 'light_nav_white', 'light_beacon',
    ],
  },
  car: {
    file: 'courier-van.glb',
    root: 'courier_van',
    maxTriangles: 22000,
    parts: [
      'body', 'glass', 'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr', 'steering_wheel', 'light_head',
      'light_tail', 'light_brake', 'light_reverse', 'light_indicator_l', 'light_indicator_r', 'beacon',
    ],
  },
  boat: {
    file: 'kestrel-launch.glb',
    root: 'kestrel_launch',
    maxTriangles: 25000,
    parts: [
      'hull', 'deck', 'ttop', 'glass', 'radar', 'light_blue', 'light_mast', 'light_nav_red',
      'light_nav_green', 'outboard_l', 'outboard_r', 'prop_l', 'prop_r',
    ],
  },
};

/** Which aeroplane ids the Blender models draw, and with which file. */
export const BLENDER_AIRCRAFT = { harrier: 'heli' };

/* Rotor figures, the same ones the rotor sound uses (audio/vehicles.js). */
const MAIN_RPM = 400;
const TAIL_RATIO = 5.25;
/** 41.9 rad/s at 100 per cent. */
const MAIN_RAD_S = (MAIN_RPM / 60) * Math.PI * 2;
/*
 * The most a rotor may turn in one frame, as drawn.
 *
 * At 400 rpm the real disc turns 40 degrees per frame at 60 fps and 80 at
 * 30 fps. Four blades repeat every 90 degrees, so at 30 fps — a Chromebook —
 * the picture steps 80 forward, which the eye reads as 10 BACK: the rotor
 * appeared to crawl backwards at full power. Capping the step at 0.5 rad
 * (29 degrees, a third of the blade spacing) keeps it reading as fast and
 * forwards at any frame rate; the faint blur disc says the rest.
 */
const MAX_MAIN_STEP = 0.5;
/** Ten fan blades repeat every 36 degrees; the same rule, a third of that. */
const MAX_TAIL_STEP = 0.2;
/** Van wheel radius, measured off the tyre (0.690 m diameter). */
const VAN_WHEEL_R = 0.345;
const TAU = Math.PI * 2;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};

/* ------------------------------------------------------------- loading -- */

const templates = { heli: null, car: null, boat: null };
const status = { heli: 'idle', car: 'idle', boat: 'idle' };
const errors = {};
const timings = {};
let pending = null;
let enabled = true;

function offByUrl() {
  try {
    return typeof location !== 'undefined' && /[?&]blender=off\b/.test(location.search || '');
  } catch (e) {
    return false;
  }
}

/** Where a model file lives, relative to this module rather than to the page. */
export function blenderModelUrl(kind) {
  return new URL(`../../assets/models/${BLENDER_VEHICLES[kind].file}`, import.meta.url).href;
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.arrayBuffer();
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Fetch and parse the three models, once.
 *
 * Resolves to blenderModelStatus() whatever happens; it cannot reject.
 * `opts.load(url, kind)` replaces fetch (the node tests read the files off
 * disk), `opts.reload` parses them again.
 */
export function preloadVehicleModels(opts = {}) {
  if (pending && !opts.reload) return pending;
  const load = opts.load || fetchBuffer;
  const kinds = opts.only || Object.keys(BLENDER_VEHICLES);
  if (offByUrl()) {
    for (const k of kinds) status[k] = 'off';
    pending = Promise.resolve(blenderModelStatus());
    return pending;
  }
  pending = Promise.all(
    kinds.map(async (kind) => {
      const t0 = now();
      status[kind] = 'loading';
      try {
        const buf = await load(blenderModelUrl(kind), kind);
        templates[kind] = prepare(kind, parseGLB(buf, { name: BLENDER_VEHICLES[kind].file }));
        status[kind] = 'ready';
        delete errors[kind];
      } catch (e) {
        templates[kind] = null;
        status[kind] = 'failed';
        errors[kind] = String((e && e.message) || e);
        console.warn(`The Blender ${kind} could not be loaded; keeping the built-in one.`, e);
      }
      timings[kind] = Math.round(now() - t0);
    })
  ).then(blenderModelStatus, blenderModelStatus);
  return pending;
}

/** What loaded, what did not and why, and how long each took (ms). */
export function blenderModelStatus() {
  const out = { enabled };
  for (const k of Object.keys(BLENDER_VEHICLES)) {
    out[k] = status[k];
    if (templates[k]) out[`${k}Triangles`] = templates[k].triangles;
  }
  out.errors = { ...errors };
  out.ms = { ...timings };
  return out;
}

/** For the console and the tests: switch the Blender models off (or on) for new vehicles. */
export function setBlenderModels(on) {
  enabled = !!on;
}

/** Turn a parsed file into a template: find the root, check the parts, set shadows. */
function prepare(kind, parsed) {
  const def = BLENDER_VEHICLES[kind];
  const root = parsed.scene.getObjectByName(def.root);
  if (!root) throw new Error(`${def.file} has no root node called ${def.root}`);
  const missing = def.parts.filter((p) => !root.getObjectByName(p));
  if (missing.length) throw new Error(`${def.file} is missing ${missing.join(', ')}`);
  root.removeFromParent();
  root.traverse((o) => {
    if (!o.isMesh) return;
    // As the fleet pack does it (fleet/common.js): opaque parts cast, glass
    // and blur discs do not, everything receives.
    o.castShadow = !o.material.transparent;
    o.receiveShadow = true;
  });
  if (kind === 'boat') {
    /*
     * Every decal on the launch (KESTREL, RESCUE, the slash, the transom tape,
     * the roof ID) and every non-skid panel sits 5-6 mm proud of these three.
     * The game has no logarithmic depth buffer and a far plane at 60 km, so
     * from the helicopter the decals z-fought their paint. Stepping the bases
     * back fixes it for every view, and costs nothing.
     */
    for (const name of ['paint_orange', 'roof_nonskid', 'paint_white']) {
      root.traverse((o) => {
        if (o.isMesh && o.material.name === name) {
          o.material.polygonOffset = true;
          o.material.polygonOffsetFactor = 2;
          o.material.polygonOffsetUnits = 2;
        }
      });
    }
  }
  const { triangles, drawCalls } = drawStats(root);
  return { root, triangles, drawCalls, extras: root.userData.extras || null };
}

/* ------------------------------------------------------------ instances -- */

/** Materials that animate, and so are cloned per copy. The rest are shared. */
const OWN_MATERIAL = /^(light_|rotor_blur$|screen$)/;

function instance(kind) {
  const t = templates[kind];
  if (!t || !enabled) return null;
  const model = t.root.clone(true);
  // The clone deep-copies userData; point the extras back at the one copy.
  model.userData.extras = t.extras;
  model.userData.blender = kind;
  model.userData.triangles = t.triangles;
  const parts = {};
  for (const name of BLENDER_VEHICLES[kind].parts) parts[name] = model.getObjectByName(name);
  const lamps = {};
  model.traverse((o) => {
    if (!o.isMesh || !OWN_MATERIAL.test(o.material.name)) return;
    const owner = o.parent && o.parent.name;
    o.material = o.material.clone();
    (lamps[owner] ||= {})[o.material.name] = o.material;
  });
  model.userData.parts = parts;
  model.userData.lamps = lamps;
  model.userData.anim = { t: 0, first: true };
  // Where each moving part sits at rest, so animating never accumulates drift.
  const rest = {};
  for (const [name, o] of Object.entries(parts)) rest[name] = { p: o.position.clone(), q: o.quaternion.clone() };
  model.userData.rest = rest;
  return model;
}

/** The base glow a lamp material was exported with. */
const baseGlow = (m) => (m.userData.gltf ? m.userData.gltf.emissiveIntensity : 1);

let glowTex = null;
/** A soft white dot, painted into a DataTexture once and shared by every sprite. */
function glowTexture() {
  if (glowTex) return glowTex;
  const S = 64;
  const d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const r = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) / (S / 2);
      // The same falloff as model.js glowSprite: 1 at the centre, 0.5 at 0.3, 0 at the edge.
      const a = r < 0.3 ? 1 - (r / 0.3) * 0.5 : Math.max(0, 0.5 * (1 - (r - 0.3) / 0.7));
      const i = (y * S + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(a * 255);
    }
  }
  glowTex = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  glowTex.magFilter = THREE.LinearFilter;
  glowTex.minFilter = THREE.LinearMipmapLinearFilter;
  glowTex.generateMipmaps = true;
  glowTex.needsUpdate = true;
  return glowTex;
}

function glow(color, size) {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture(),
      color,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    })
  );
  s.scale.setScalar(size);
  s.userData.baseScale = size;
  return s;
}

/** A copy of the Skyhook, with its night glows and a real searchlight. */
export function blenderHeli() {
  const m = instance('heli');
  if (!m) return null;
  const P = m.userData.parts;
  /*
   * The lamps on the model are 5 cm lenses. They are right close up and
   * invisible from the chase camera at night, which is the one time an
   * aircraft is mostly its lights — so, like every other aircraft in the
   * game, it gets glow sprites that grow with the dark.
   */
  const sprites = {
    navRed: glow(0xff2020, 0.5),
    navGreen: glow(0x20ff40, 0.5),
    navWhite: glow(0xffffff, 0.38),
    beacon: glow(0xff3010, 0.6),
    search: glow(0xfff0c0, 0.9),
  };
  P.light_nav_red.add(sprites.navRed);
  P.light_nav_green.add(sprites.navGreen);
  P.light_nav_white.add(sprites.navWhite);
  P.light_beacon.add(sprites.beacon);
  sprites.beacon.position.y = 0.03;
  // The lens is 0.14 m below and 0.1 m ahead of the lamp's pivot.
  sprites.search.position.set(0, -0.14, -0.13);
  P.searchlight.add(sprites.search);
  /*
   * One SpotLight, as the old helicopter had (its landing light). Keeping the
   * count the same matters more than it looks: a change in the number of
   * lights in the scene recompiles every lit material in the world.
   */
  const spot = new THREE.SpotLight(0xfff0c8, 0, 260, 0.34, 0.45, 1.2);
  spot.name = 'searchlight_spot';
  spot.position.set(0, -0.14, -0.12);
  const target = new THREE.Object3D();
  target.position.set(0, -0.14, -60);
  P.searchlight.add(spot, target);
  spot.target = target;
  m.userData.sprites = sprites;
  m.userData.spot = spot;
  return m;
}

/** A copy of the Island Courier van. */
export function blenderCar() {
  return instance('car');
}

/**
 * What the game's boat needs to know about this hull to pose her, from the
 * .glb's extras.fit — the shape of `userData.hullFit` that surface.js
 * fitHull() reads. Null if the file does not carry the points.
 *
 * Only facts about the hull are taken: where her deck edge is (the cockpit
 * sole corners and the motor-well lip, `keep_dry_points`, kept `keep_dry_y`
 * above the sea), where her bottom is (the keel and both chines at every
 * hull section) and how far she climbs onto the plane. The rest of the
 * recipe — 0.4 of the sea's heave, pitch and roll, 0.75 of the trim, 0.55
 * of the heel — was written to be applied ON TOP of a game pose that has
 * since been damped by the same amounts in surface.js itself (heaveShown,
 * planeTrim, bankInTurn), so applying it again damped her twice and lifted
 * her twice. surface.js owns the pose; see fitHull there.
 */
export function blenderHullFit(fit) {
  if (!fit || !Array.isArray(fit.keep_dry_points) || fit.keep_dry_points.length < 3) return null;
  const keel = [];
  const NP = fit.hull_section_points;
  const HS = fit.hull_sections;
  if (Array.isArray(HS) && NP > 5) {
    const CHINE = 5; // the section point at the outer edge of the chine flat (as blender-boat-water.js)
    for (let o = 0; o + NP * 3 <= HS.length; o += NP * 3) {
      keel.push(0, HS[o + 1], HS[o + 2]);
      const c = o + CHINE * 3;
      keel.push(HS[c], HS[c + 1], HS[c + 2], -HS[c], HS[c + 1], HS[c + 2]);
    }
  }
  return {
    deck: fit.keep_dry_points.slice(),
    clear: fit.keep_dry_y ?? 0.1,
    keel,
    planeLift: fit.planing_lift_m ?? 0.45,
    liftFrom: fit.lift_from ?? 0.2,
    liftFullAt: fit.lift_full_at ?? 0.7,
  };
}

/** A copy of the Kestrel launch, with her own bow wave and wash. */
export function blenderBoat() {
  const m = instance('boat');
  if (!m) return null;
  const fit = m.userData.extras && m.userData.extras.fit;
  if (fit && fit.hull_sections) {
    try {
      const water = createBoatWater(m, fit, { length: 8.47, beam: 2.8 });
      m.userData.water = water;
      /*
       * Under the names the rest of the game reads a boat's wake by (models.js
       * createBoat, the boat playtest): `wake` counts the patches of wash on
       * the water, `bowWave` is the white at her entry. Both are drawn after
       * the near-sea ripples and the harbour's surf and shallows sheets
       * (water.js renderOrder 0.5 to 2), as the pack launch's are, so nothing
       * in the sea draws over the one thing that says she is moving.
       */
      m.userData.wake = water.wash;
      m.userData.bowWave = water.bow;
      water.wash.renderOrder = 3;
      water.bow.renderOrder = 3;
    } catch (e) {
      console.warn('The launch will not make a wake:', e);
    }
  }
  m.userData.hullFit = blenderHullFit(fit);
  // Her origin is on the design waterline (extras.design_waterline_z = 0).
  m.userData.waterline = 0;
  m.userData.dimensions = { length: 8.47, beam: 2.8, massKg: 3400 };
  m.userData.reset = () => {
    m.userData.anim.first = true;
    if (m.userData.water) m.userData.water.reset();
  };
  return m;
}

/* ----------------------------------------------------------- animation -- */

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Move a Blender vehicle's parts and lamps for one frame. See the state
 * object at the top of this file.
 */
export function animateBlenderVehicle(model, state = {}, dt = 0) {
  const kind = model && model.userData && model.userData.blender;
  if (!kind) return;
  dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
  const A = model.userData.anim;
  A.t += dt;
  if (kind === 'heli') animateHeli(model, state, dt, A);
  else if (kind === 'car') animateCar(model, state, dt, A);
  else if (kind === 'boat') animateBoat(model, state, dt, A);
  A.first = false;
}

function setGlow(lamps, part, mat, k) {
  const m = lamps[part] && lamps[part][mat];
  if (m) m.emissiveIntensity = baseGlow(m) * k;
}

/* ---- the helicopter ---- */

function animateHeli(model, s, dt, A) {
  const P = model.userData.parts;
  const R = model.userData.rest;
  const L = model.userData.lamps;
  const nr = clamp(s.rotor || 0, 0, 1.05);

  // Main rotor: clockwise seen from above, as on every fenestron helicopter
  // (the reaction then pushes the nose left, which the fan on the left of the
  // fin is there to hold).
  A.rotor = ((A.rotor || 0) - Math.min(nr * MAIN_RAD_S * dt, MAX_MAIN_STEP)) % TAU;
  const k = clamp(dt * 6, 0, 1);
  A.tiltX = lerp(A.tiltX || 0, clamp(s.cyclicPitch || 0, -1, 1) * 0.05 * nr, k);
  A.tiltZ = lerp(A.tiltZ || 0, -clamp(s.cyclicRoll || 0, -1, 1) * 0.05 * nr, k);
  _e.set(A.tiltX, A.rotor, A.tiltZ, 'XZY');
  P.rotor_main.quaternion.copy(R.rotor_main.q).multiply(_q.setFromEuler(_e));
  _e.set(A.tiltX, 0, A.tiltZ, 'XZY');
  P.rotor_main_blur.quaternion.copy(R.rotor_main_blur.q).multiply(_q.setFromEuler(_e));
  const blur = L.rotor_main_blur && L.rotor_main_blur.rotor_blur;
  if (blur) {
    const b = smooth((nr - 0.3) / 0.6);
    blur.opacity = blur.userData.gltf.opacity * b;
    P.rotor_main_blur.visible = b > 0.01;
  }

  // The fenestron, about the lateral axis, 5.25 times as fast.
  A.tail = ((A.tail || 0) + Math.min(nr * MAIN_RAD_S * TAIL_RATIO * dt, MAX_TAIL_STEP)) % TAU;
  P.rotor_tail.quaternion.copy(R.rotor_tail.q).multiply(_q.setFromAxisAngle(X_AXIS, A.tail));

  // Lamps. Nav lights steady, the fin beacon a double flash.
  const on = s.lights !== false && nr > 0.02 ? 1 : 0;
  const lightsOn = s.lights !== false;
  setGlow(L, 'light_nav_red', 'light_red', lightsOn ? 1 : 0);
  setGlow(L, 'light_nav_green', 'light_green', lightsOn ? 1 : 0);
  setGlow(L, 'light_nav_white', 'light_white', lightsOn ? 1 : 0);
  const cyc = A.t % 1.3;
  const flash = lightsOn && (cyc < 0.07 || (cyc > 0.16 && cyc < 0.23)) ? 1 : 0;
  setGlow(L, 'light_beacon', 'light_red', flash ? 1.4 : 0.06);
  setGlow(L, 'interior', 'screen', on ? 1 : 0.1);

  // Searchlight: tilts down under the nose, lights the ground in the dark.
  const search = clamp(s.searchlight || 0, 0, 1);
  A.search = lerp(A.search ?? search, search, clamp(dt * 4, 0, 1));
  const tilt = clamp(s.searchTilt ?? 0.45, 0, 1.2);
  A.searchTilt = lerp(A.searchTilt ?? tilt, tilt, clamp(dt * 2, 0, 1));
  P.searchlight.quaternion.copy(R.searchlight.q).multiply(_q.setFromAxisAngle(X_AXIS, -A.searchTilt));
  setGlow(L, 'searchlight', 'light_white', 0.08 + A.search * 0.92);
  const dark = clamp(s.dark ?? 0.18, 0, 1);
  if (model.userData.spot) model.userData.spot.intensity = A.search * 190 * (0.25 + dark * 0.75);

  // The hoist: pay the cable out from its top, keep the hook on its end.
  const cable = clamp(s.winch ?? 0.5, 0.5, 60);
  P.winch_cable.scale.y = cable / 0.5;
  P.winch_hook.position.y = R.winch_hook.p.y - (cable - 0.5);

  // Glow sprites: barely there in daylight, the whole show at night.
  const S = model.userData.sprites;
  if (S) {
    const size = 0.55 + dark * 0.75;
    const op = 0.35 + dark * 0.65;
    const set = (sp, lit, boost = 1) => {
      sp.visible = lit > 0.02;
      sp.material.opacity = op * lit;
      sp.scale.setScalar(sp.userData.baseScale * size * boost);
    };
    set(S.navRed, lightsOn ? 1 : 0);
    set(S.navGreen, lightsOn ? 1 : 0);
    set(S.navWhite, lightsOn ? 0.8 : 0);
    set(S.beacon, flash);
    set(S.search, A.search, 1.4);
  }
}

/* ---- the van ---- */

const WHEELS = [
  ['wheel_fl', true],
  ['wheel_fr', true],
  ['wheel_rl', false],
  ['wheel_rr', false],
];

function animateCar(model, s, dt, A) {
  const P = model.userData.parts;
  const R = model.userData.rest;
  const L = model.userData.lamps;
  const speed = s.speed || 0;
  // Rolling forward (towards -Z) turns the top of the wheel forward, which is
  // a NEGATIVE turn about +X. The old van spun the other way; with plain
  // cylinders nobody could tell.
  A.spin = ((A.spin || 0) - (speed / VAN_WHEEL_R) * dt) % TAU;
  const lock = s.steerAngle ?? clamp(s.steer || 0, -1, 1) * 0.52;

  /*
   * The body leans on its springs; the wheels do not. Without this a
   * cornering van lifted its inside wheels 15 cm off the road and sank the
   * outside ones into it (0.16 rad of roll over a 0.95 m half-track), and
   * dived its front wheels into the tarmac under braking.
   */
  _e.set(-(s.bodyPitch || 0), 0, -(s.bodyRoll || 0), 'ZXY');
  _q2.setFromEuler(_e);
  for (const [name, steers] of WHEELS) {
    const w = P[name];
    w.position.copy(R[name].p).applyQuaternion(_q2);
    w.quaternion.copy(_q2);
    // + lock is a right turn, which is a negative turn about +Y.
    if (steers) w.quaternion.multiply(_q.setFromAxisAngle(Y_AXIS, -lock));
    w.quaternion.multiply(_q.setFromAxisAngle(X_AXIS, A.spin));
  }
  // A 14:1 rack: full lock at parking speed is a turn and a quarter of the
  // wheel. Positive about the raked column is clockwise from the driver's seat.
  P.steering_wheel.quaternion.copy(R.steering_wheel.q).multiply(_q.setFromAxisAngle(Y_AXIS, lock * 14));

  // Lamps.
  const lightsOn = s.headlights !== false;
  setGlow(L, 'light_head', 'light_head', lightsOn ? 1 : 0.35);
  setGlow(L, 'light_tail', 'light_red', lightsOn ? 1 : 0);
  setGlow(L, 'light_brake', 'light_red', s.braking ? 1.6 : 0);
  // Its exported glow is a faint 0.08 grey, so "on" is a big multiple of it.
  setGlow(L, 'light_reverse', 'light_reverse', s.reverse ? 26 : 1);
  const blink = A.t % 0.85 < 0.43;
  const steer = s.steer || 0;
  const left = s.hazard || s.indicator < 0 || (s.indicator === undefined && steer < -0.2);
  const right = s.hazard || s.indicator > 0 || (s.indicator === undefined && steer > 0.2);
  // Likewise 0.1 of amber exported; lit is 2.2.
  setGlow(L, 'light_indicator_l', 'light_indicator', left && blink ? 22 : 1);
  setGlow(L, 'light_indicator_r', 'light_indicator', right && blink ? 22 : 1);
  if (s.beacon) A.beacon = ((A.beacon || 0) + dt * 7) % TAU;
  P.beacon.quaternion.copy(R.beacon.q).multiply(_q.setFromAxisAngle(Y_AXIS, A.beacon || 0));
  setGlow(L, 'beacon', 'light_beacon', s.beacon ? 1 : 0.15);
}

/* ---- the launch ---- */

function animateBoat(model, s, dt, A) {
  const P = model.userData.parts;
  const L = model.userData.lamps;
  const fit = (model.userData.extras && model.userData.extras.fit) || {};
  const TOP = fit.top_speed_mps || 14;
  const speed = s.speed || 0;
  const f = Math.min(1, Math.abs(speed) / TOP);
  const steer = clamp(s.steer || 0, -1, 1);
  const sea = Number.isFinite(s.sea) ? s.sea : 0;

  // Steering and the counter-rotating props (prop_r right-hand).
  P.outboard_l.rotation.y = steer * 0.42;
  P.outboard_r.rotation.y = steer * 0.42;
  const spin = Math.sign(speed) * f * 14 * dt;
  P.prop_r.rotation.z -= spin;
  P.prop_l.rotation.z += spin;
  P.radar.rotation.y += dt * 2.5; // 24 rpm

  // The blue beacons double-flash; nav and anchor whites follow `lights`.
  const on = s.lights !== false;
  const ph = (A.t * 1.25) % 1;
  setGlow(L, 'light_blue', 'light_blue', on && (ph < 0.08 || (ph > 0.16 && ph < 0.24)) ? 1.6 : 0.12);
  setGlow(L, 'light_nav_red', 'light_red', on ? 1 : 0);
  setGlow(L, 'light_nav_green', 'light_green', on ? 1 : 0);
  setGlow(L, 'light_mast', 'light_white', on ? 1 : 0);

  /*
   * She is NOT posed here. Where she sits on the sea — her heave, her lift
   * onto the plane, her trim, her heel and the keep-dry lift that stops the
   * cockpit flooding — is surface.js's, from this hull's own numbers
   * (userData.hullFit, handed over by main.js), and main.js copies it onto
   * the model before this runs. There used to be a second pose here, the
   * .glb's fit recipe applied on top of that one: two heaves, two planing
   * lifts, two keep-dry clamps and the roll damped twice.
   */
  if (model.userData.water && s.wake !== false && model.visible !== false) {
    model.userData.water.update(dt, speed, steer, sea);
  }
}

/* ------------------------------------------------------------- adapters -- */

const DEG = Math.PI / 180;

/**
 * The state object for the van or the launch, read off a SurfaceVehicle.
 *
 * Everything is a field the vehicle already has; the only sums are the van's
 * front-wheel lock (the same rack surface.js steers with) and how far the
 * body leans on its springs, which is surface.js applyAttitude's dive, squat
 * and roll smoothed by the same lerp, tracked here on their own so the wheels
 * can be held on the road while the body leans.
 */
export function blenderDriveState(model, v, dt = 0) {
  const A = model.userData.anim || (model.userData.anim = { t: 0, first: true });
  const S = v.spec || {};
  const boat = S.kind === 'boat';
  const out = A.drive || (A.drive = {});
  out.speed = v.speed || 0;
  out.steer = v.steer || 0;
  out.lights = true;
  if (boat) {
    out.sea = 0;
    return out;
  }
  const speed = out.speed;
  const lock = Math.min(
    (S.steerLockMax || 34) * DEG,
    Math.atan(((S.latGrip || 8.6) * (S.rackMargin || 1.12) * (S.wheelbase || 2.7)) / Math.max(speed * speed, 1e-3))
  );
  out.steerAngle = clamp(out.steer, -1, 1) * lock;
  const along = ((v.throttle || 0) * (S.accel || 5) - (v.brakes || 0) * (S.brakeDecel || 7)) * 0.006;
  const lean = clamp(((v.latAccel || 0) / (S.latGrip || 8.6)) * (S.bodyRoll || 0.16), -0.3, 0.3);
  const k = clamp(dt * 6, 0, 1);
  out.bodyPitch = lerp(out.bodyPitch || 0, along, k);
  out.bodyRoll = lerp(out.bodyRoll || 0, lean, k);
  out.braking = (v.brakes || 0) > 0.05;
  out.reverse = v.gear === 'R' || (speed < 0.3 && (v.throttle || 0) < -0.05);
  out.hazard = !!(v.swamped || v.crashed);
  out.headlights = true;
  out.beacon = true;
  return out;
}

/** Defaults the model was painted in: the Skyhook's own livery. */
const HELI_PAINT = { paint_main: '#2f4a63', paint_accent: '#f0a020' };

/** Repaint one copy in a hangar livery, cloning only the paint that changes. */
function repaint(model, livery) {
  if (!livery) return;
  const want = typeof livery === 'string' ? { paint_main: livery } : { paint_main: livery.base, paint_accent: livery.accent };
  const own = {};
  model.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.material.name;
    const colour = want[name];
    if (!colour || String(colour).toLowerCase() === HELI_PAINT[name]) return;
    if (!own[name]) {
      own[name] = o.material.clone();
      try {
        own[name].color.setStyle(colour);
      } catch (e) {
        return;
      }
    }
    o.material = own[name];
  });
}

/**
 * The helicopter as model-adapter.js wants an aeroplane: a Group with
 * userData.update(dt, ac, weather). Null when the Blender helicopter is not
 * loaded, so the caller falls through to the drawing it had before.
 *
 * The game's aeroplane models are built at trainer size and scaled by
 * `shape.scale` (1.25 for the Skyhook), and main.js hangs the cockpit panel
 * on the model counter-scaled by 1 / scale on that assumption. The Blender
 * model is already full size, so it sits inside a group scaled by `scale`,
 * itself scaled by 1 / scale: the outside looks like every other aeroplane,
 * the inside is metres.
 */
export function blenderAircraftModel(type, opts = {}) {
  if (!type || BLENDER_AIRCRAFT[type.id] !== 'heli') return null;
  const heli = blenderHeli();
  if (!heli) return null;
  const scale = (type.shape && type.shape.scale) || 1;
  const root = new THREE.Group();
  root.name = `blender_${type.id}`;
  heli.scale.setScalar(1 / scale);
  root.add(heli);
  root.scale.setScalar(scale);
  repaint(heli, opts.livery);
  const A = heli.userData.anim;
  const st = {};
  root.userData.blenderModel = heli;
  root.userData.parts = heli.userData.parts;
  /*
   * The skids give with the springs, as the civil drawings' gear does.
   *
   * The skids are modelled on the flight model's gear points, which are the
   * points at FULL extension. Standing, the springs compress and the machine
   * settles, and nothing drawn gave: the civil team's check measured the
   * Blender skids 0.092 m INTO the runway. Worked out the way civil-build.js
   * squash() does — each gear point through the aeroplane's attitude, against
   * the ground under it — and the whole machine rises by the most any point
   * is pressed in (a skid set is rigid). Zero in the air.
   */
  const contacts = gearContacts(type.shape);
  root.userData.update = (dt, ac = {}, weather = null) => {
    animateBlenderVehicle(heli, heliStateFor(ac, weather, dt, A, st), dt);
    heli.position.y = skidSquash(ac, contacts, scale) / scale;
  };
  return root;
}

function gearContacts(S) {
  const out = [];
  if (S && S.main) { out.push([S.main.x, S.main.y, S.main.z], [-S.main.x, S.main.y, S.main.z]); }
  if (S && S.nose) out.push([S.nose.x || 0, S.nose.y, S.nose.z]);
  return out;
}

const _gp = new THREE.Vector3();
function skidSquash(ac, contacts, scale) {
  if (!ac || ac.onGround !== true || ac.crashed || !ac.pos || !ac.quat || !Number.isFinite(ac.agl)) return 0;
  const groundY = ac.pos.y - ac.agl;
  let most = 0;
  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i];
    _gp.set(c[0] * scale, c[1] * scale, c[2] * scale).applyQuaternion(ac.quat);
    const pressed = groundY - (ac.pos.y + _gp.y);
    if (pressed > most) most = pressed;
  }
  return Math.min(most, 0.3);
}

/**
 * The helicopter's state, off the flight model.
 *
 * The rotor is governed: it runs at 100 per cent whenever the engine drives
 * it, whatever the collective is doing, and the old drawing got that wrong —
 * model.js spun the disc at `rpm` x 42 Hz, and on this machine `rpm` IS the
 * collective, so the blades slowed every time you came down to a hover. The
 * flight model already knows better: `propBlur` is its rotor speed (1 with
 * the engine on, running down with `rpm` when it stops; physics.js). That is
 * the target here, held at 0.86 in the air with the engine off, because a
 * freewheeling rotor keeps turning on the air coming up through it, and
 * chased at the rotor sound's rates (audio/vehicles.js RotorSound) so the
 * picture and the sound spool up together. The first frame starts at the
 * target, so a flight that begins in the air begins turning.
 */
function heliStateFor(ac, weather, dt, A, st) {
  const running = !!ac.engineOn || (ac.rpm || 0) > 0.05;
  const airborne = ac.onGround === false;
  const nr = Number.isFinite(ac.propBlur) ? clamp(ac.propBlur, 0, 1) : running ? 1 : 0;
  const target = !ac.engineOn && airborne ? Math.max(nr, 0.86) : nr;
  if (A.nr === undefined) A.nr = target;
  const rate = running ? (A.nr < target ? 0.25 : 0.9) : 0.22;
  A.nr += (target - A.nr) * clamp(dt * rate, 0, 1);
  if (!running && !airborne && A.nr < 0.05) A.nr = Math.max(0, A.nr - dt * 0.05);
  const dark = weather ? (weather.isNight ? 1 : weather.cond && weather.cond.cloud > 0.75 ? 0.55 : 0.18) : 0.5;
  const agl = Number.isFinite(ac.agl) ? ac.agl : 0;
  st.rotor = A.nr;
  st.cyclicPitch = (ac.controls && ac.controls.pitch) || 0;
  st.cyclicRoll = (ac.controls && ac.controls.roll) || 0;
  st.lights = running;
  st.dark = dark;
  // The searchlight is a landing light: on below 250 m with the engine
  // running, looking further down the lower you are.
  st.searchlight = running && agl < 250 ? 1 : 0;
  st.searchTilt = 0.35 + 0.45 * clamp(1 - agl / 120, 0, 1);
  st.winch = Number.isFinite(ac.winchLength) ? ac.winchLength : 0.5;
  return st;
}
