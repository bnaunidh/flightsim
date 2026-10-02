/**
 * Uniforms based on planes.
 *
 * "Uniforms based on planes" was on the owner's list: the pilot who climbs
 * out (O on the ground) or floats down under a parachute should be wearing
 * the right thing for what they were flying —
 *
 *   captain   the airliners: navy jacket, four gold stripes on each cuff,
 *             white collar and tie, a peaked cap and gold wings
 *   fighter   the military jets: a sage-green flight suit, G-suit on the
 *             legs, a life-vest harness, flag patches, a white helmet with a
 *             dark visor
 *   heli      the helicopter: a rescue-orange flight suit with reflective
 *             bands and a white helmet
 *   casual    the light aeroplanes: polo shirt, chinos, a baseball cap,
 *             sunglasses and a green headset
 *   racer     Air Massimo: a red racing suit with white stripes and a helmet
 *   harrison  T-Pose Harrison, as himself: green T-shirt with a big white T,
 *             jeans, red trainers, shades, spiky hair — and his arms stay out
 *             in the T-pose even while he walks
 *
 * HOW, without a second rig. Everything is the one person from
 * staff/person.js, built plain, and each extra piece is merged INTO the mesh
 * of the bone it sits on — the helmet into the head, the harness into the
 * chest, the G-suit into the thighs. So a uniformed pilot is still exactly
 * eleven draw calls, like the plain one (tests/features/onfoot.browser.js
 * holds the walker to twelve).
 *
 * Harrison's T-pose: the rig's own arms are hidden and two straight arms are
 * merged into his chest instead, so whatever posePerson() does with the
 * hidden arms, his stay out.
 */

import * as THREE from '../vendor/three.module.js';
import { createPerson, part, mergeParts, SKIN_TONES, rng } from './staff/person.js';
import { profileFor } from './eject/profiles.js';

/** The uniforms, with the words the tests and the help card use. */
export const UNIFORMS = {
  captain: { sleeves: true, name: 'Airline captain', shirt: 0x1d2a45, trousers: 0x1d2a45 },
  fighter: { sleeves: true, name: 'Fighter pilot', shirt: 0x5d6b47, trousers: 0x5d6b47 },
  heli: { sleeves: true, name: 'Helicopter pilot', shirt: 0xf0762a, trousers: 0xf0762a },
  casual: { name: 'Weekend flyer', shirt: 0x45a2dd, trousers: 0xb99a68 },
  racer: { sleeves: true, name: 'Racing pilot', shirt: 0xd4252a, trousers: 0xd4252a },
  harrison: { name: 'T-Pose Harrison', shirt: 0x2fb36b, trousers: 0x2f4f8a, skin: 0xe8b894, hair: 0x5a3a1e },
};

/** Which uniform goes with an aeroplane (a roster entry or a type id). */
export function uniformFor(type) {
  const id = profileFor(type).uniform;
  return UNIFORMS[id] ? id : 'pilot';
}

export function isUniform(id) {
  return !!UNIFORMS[id];
}

/*
 * createPerson() picks a hairstyle from its seed (its second random number:
 * the first is the shoes), and one of the three is long hair down the back,
 * which came out from under a helmet. Uniforms take the nearest seed that
 * gives short hair.
 */
function shortHairSeed(seed) {
  for (let s = seed; s < seed + 60; s++) {
    const r = rng(s);
    r();
    if (Math.floor(r() * 3) === 0) return s;
  }
  return seed;
}

/* Primitives, made once, never touched: part() clones what it uses. */
let G = null;
function prims() {
  if (G) return G;
  G = {
    box: new THREE.BoxGeometry(1, 1, 1),
    ball: new THREE.IcosahedronGeometry(1, 1),
    disc: new THREE.CylinderGeometry(1, 1, 1, 12),
    limb: new THREE.CylinderGeometry(1, 0.85, 1, 6),
    cone: new THREE.ConeGeometry(1, 1, 5),
  };
  G.limb.translate(0, -0.5, 0);
  return G;
}

/** The mesh sitting directly on a bone (not in a child group). */
function meshOn(group) {
  return group ? group.children.find((o) => o.isMesh) : null;
}

/** Merge `parts` into the mesh on `group`, keeping it one draw call. */
function addTo(group, parts) {
  const m = meshOn(group);
  if (!m || !parts.length) {
    for (const g of parts) g.dispose();
    return;
  }
  m.geometry = mergeParts([m.geometry, ...parts]);
}

/* Colours that more than one uniform uses. */
const GOLD = 0xe7b93c;
const WHITE = 0xf1f4f7;
const VISOR = 0x18202c;
const BOOT = 0x1b1d22;

/** Harrison's arm, shoulder to fingertip (person units, x 1.9 when he flies). */
export const FLIGHT_ARM = { upper: 0.28, fore: 0.26, hand: 0.15 };

/*
 * Harrison in the air (opts.flight). His arms are the wing, so they are real
 * arms again: the rig's own shoulder and elbow, rebuilt as a short green
 * T-shirt sleeve over a bare arm, plus a WRIST joint with a flat open hand
 * (fingers together, palm down when he flies) so a wing-beat can follow
 * through shoulder, elbow and wrist. The feet point back along the legs, toes
 * first and soles to the sky, the way anyone flying head-first holds them.
 *
 * Each rebuilt piece REPLACES the mesh on its joint (the plain person's
 * forearm carries a round fist, and its upper arm is bare or sleeved at
 * random), so there are two more draw calls than on foot: the hands.
 */
function flightLimbs(rig, U, skin) {
  const P = prims();
  const A = FLIGHT_ARM;
  const swap = (group, parts) => {
    const m = meshOn(group);
    if (!m) return null;
    m.geometry.dispose();
    m.geometry = mergeParts(parts);
    return m;
  };
  for (const a of rig.arms) {
    const s = a.side;
    swap(a.arm, [
      part(P.limb, U.shirt, 0, 0.012, 0, 0, 0, 0, 0.066, 0.135, 0.066), // the sleeve
      part(P.limb, skin, 0, 0, 0, 0, 0, 0, 0.051, A.upper, 0.051),
      part(P.ball, skin, 0, -A.upper, 0, 0, 0, 0, 0.047, 0.047, 0.047), // the elbow, so a bent one has no gap
    ]);
    const fore = swap(a.elbow, [part(P.limb, skin, 0, 0, 0, 0, 0, 0, 0.045, A.fore, 0.045)]);
    const wrist = new THREE.Group();
    wrist.name = 'wrist';
    wrist.position.y = -A.fore;
    a.elbow.add(wrist);
    // Flat in the wing's plane: wide along the body (local x), thin through it (local z).
    const hand = new THREE.Mesh(mergeParts([
      part(P.ball, skin, 0, -0.01, 0, 0, 0, 0, 0.042, 0.042, 0.03), // the wrist
      part(P.ball, skin, 0, -0.055, 0, 0, 0, 0, 0.052, 0.06, 0.026), // the palm
      part(P.box, skin, 0, -0.112, 0, 0, 0, 0, 0.085, 0.075, 0.02), // four fingers, together
      part(P.ball, skin, s * 0.05, -0.05, -0.008, 0, 0, s * 0.5, 0.016, 0.045, 0.016), // the thumb, towards his head
    ]), fore ? fore.material : undefined);
    hand.name = 'hand';
    hand.castShadow = true;
    wrist.add(hand);
    a.wrist = wrist;
    a.arm.visible = true;
  }
  // No marshalling wands in a flyer's hands.
  for (const w of rig.wands || []) {
    if (w.parent) w.parent.remove(w);
  }
  if (rig.wands) rig.wands.length = 0;
  for (const L of rig.legs) {
    swap(L.knee, [
      part(P.limb, U.trousers, 0, 0, 0, 0, 0, 0, 0.066, 0.37, 0.066),
      // Red trainers, pointed: heel at the ankle, toes on down the line of the
      // leg, laces to the front, the white sole on the back.
      part(P.box, 0xe0302b, 0, -0.475, -0.004, 0, 0, 0, 0.115, 0.26, 0.088),
      part(P.box, WHITE, 0, -0.478, 0.044, 0, 0, 0, 0.12, 0.262, 0.022),
    ]);
  }
}

/**
 * A person dressed for `id`, or null if `id` is not a uniform (the caller
 * then builds the plain person it always did).
 *
 * opts.flight (Harrison only): the flying T-Pose Harrison — jointed arms with
 * wrists and pointed feet (see flightLimbs). On foot he keeps his stiff T.
 */
export function createUniformPerson(id, opts = {}) {
  const U = UNIFORMS[id];
  if (!U) return null;
  const P = prims();
  const seed = shortHairSeed(opts.seed || 5);
  const skin = U.skin ?? SKIN_TONES[seed % SKIN_TONES.length];
  const person = createPerson({
    outfit: 'passenger',
    seed,
    skin,
    hair: U.hair ?? 0x2a1b12,
    shirt: U.shirt,
    trousers: U.trousers,
  });
  person.name = `person:${id}`;
  person.userData.outfit = id;
  person.userData.uniform = id;
  const rig = person.userData.rig;
  const head = [];
  const chest = [];
  const hips = [];
  const upper = [[], []];
  const fore = [[], []];
  const thigh = [[], []];
  const shin = [[], []];
  // Shoes or boots over the random passenger shoes, per uniform.
  const shoe = (col, big = 1) => {
    for (let i = 0; i < 2; i++) shin[i].push(part(P.box, col, 0, -0.382, -0.047, 0, 0, 0, 0.12 * big, 0.09, 0.265));
  };
  const boots = (col) => {
    for (let i = 0; i < 2; i++) {
      shin[i].push(part(P.box, col, 0, -0.378, -0.045, 0, 0, 0, 0.125, 0.1, 0.27));
      shin[i].push(part(P.limb, col, 0, -0.2, 0, 0, 0, 0, 0.074, 0.16, 0.074));
    }
  };
  // Long sleeves in the suit's colour, whatever sleeves the plain person
  // happened to be given (a passenger has bare arms two times in five).
  if (U.sleeves) {
    for (let i = 0; i < 2; i++) {
      upper[i].push(part(P.limb, U.shirt, 0, 0.005, 0, 0, 0, 0, 0.059, 0.285, 0.059));
      fore[i].push(part(P.limb, U.shirt, 0, 0.005, 0, 0, 0, 0, 0.05, 0.235, 0.05));
    }
  }
  const helmet = (shell, stripe) => {
    head.push(part(P.ball, shell, 0, 0.03, 0.008, 0, 0, 0, 0.176, 0.185, 0.178));
    // The visor, down: a dark band across the eyes.
    head.push(part(P.ball, VISOR, 0, 0.012, -0.1, 0, 0, 0, 0.15, 0.075, 0.085));
    if (stripe != null) head.push(part(P.box, stripe, 0, 0.12, 0.0, 0, 0, 0, 0.04, 0.12, 0.34));
  };
  const shades = (frame = 0x111111) => {
    head.push(part(P.box, frame, 0, 0.028, -0.146, 0, 0, 0, 0.21, 0.05, 0.02));
    head.push(part(P.box, frame, 0, 0.052, -0.14, 0, 0, 0, 0.23, 0.012, 0.02));
  };

  if (id === 'captain') {
    // White collar in the jacket's V, a dark tie, gold wings on the chest.
    chest.push(part(P.box, WHITE, 0, 0.42, -0.127, 0, 0, 0, 0.11, 0.12, 0.02));
    chest.push(part(P.box, 0x14181f, 0, 0.33, -0.134, 0, 0, 0, 0.045, 0.2, 0.02));
    chest.push(part(P.box, GOLD, 0.085, 0.37, -0.132, 0, 0, 0, 0.08, 0.018, 0.012));
    chest.push(part(P.box, GOLD, -0.07, 0.37, -0.132, 0, 0, 0, 0.05, 0.02, 0.012)); // name badge
    // Four gold rings on each cuff: a captain.
    for (let i = 0; i < 2; i++) {
      for (let k = 0; k < 4; k++) fore[i].push(part(P.disc, GOLD, 0, -0.17 - k * 0.022, 0, 0, 0, 0, 0.05, 0.009, 0.05));
    }
    // The cap: navy crown, gold band, shiny black peak.
    head.push(part(P.disc, 0x1d2a45, 0, 0.13, 0.005, 0, 0, 0, 0.162, 0.085, 0.162));
    head.push(part(P.disc, 0x1d2a45, 0, 0.18, 0.0, 0, 0, 0, 0.178, 0.035, 0.178));
    head.push(part(P.disc, GOLD, 0, 0.105, 0.005, 0, 0, 0, 0.166, 0.028, 0.166));
    head.push(part(P.box, 0x0e0f12, 0, 0.09, -0.155, 0.28, 0, 0, 0.2, 0.016, 0.1));
    head.push(part(P.ball, GOLD, 0, 0.16, -0.162, 0, 0, 0, 0.025, 0.02, 0.01)); // cap badge
    shoe(0x0e0f12);
  } else if (id === 'fighter') {
    // Life-vest harness: two tan straps and a waist belt.
    for (const s of [-1, 1]) chest.push(part(P.box, 0xb89a55, s * 0.09, 0.25, -0.132, 0, 0, s * 0.18, 0.05, 0.46, 0.02));
    chest.push(part(P.box, 0xb89a55, 0, 0.07, 0, 0, 0, 0, 0.42, 0.06, 0.29));
    // Flag patches on the shoulders, a name tag on the chest.
    chest.push(part(P.box, 0xe8e2cf, -0.08, 0.36, -0.133, 0, 0, 0, 0.07, 0.03, 0.01));
    for (let i = 0; i < 2; i++) {
      const side = rig.arms[i].side;
      upper[i].push(part(P.box, i ? 0xc8342c : 0x2c5aa0, side * 0.056, -0.07, 0, 0, 0, 0, 0.012, 0.06, 0.06));
    }
    // G-suit over the legs: darker, a little bigger.
    for (let i = 0; i < 2; i++) thigh[i].push(part(P.limb, 0x414c31, 0, -0.03, 0, 0, 0, 0, 0.086, 0.37, 0.086));
    helmet(0xe9edf0, 0x2c5aa0);
    // A dark oxygen mask under the visor.
    head.push(part(P.ball, 0x3a4048, 0, -0.07, -0.13, 0, 0, 0, 0.06, 0.06, 0.05));
    boots(BOOT);
  } else if (id === 'heli') {
    // Reflective bands on the arms and the legs, a name tag, a radio.
    for (let i = 0; i < 2; i++) {
      upper[i].push(part(P.disc, 0xdfe6ea, 0, -0.16, 0, 0, 0, 0, 0.059, 0.035, 0.059));
      fore[i].push(part(P.disc, 0xdfe6ea, 0, -0.14, 0, 0, 0, 0, 0.05, 0.03, 0.05));
      shin[i].push(part(P.disc, 0xdfe6ea, 0, -0.16, 0, 0, 0, 0, 0.07, 0.035, 0.07));
    }
    chest.push(part(P.box, 0xdfe6ea, 0, 0.3, -0.132, 0, 0, 0, 0.36, 0.035, 0.012));
    chest.push(part(P.box, 0x222428, 0.1, 0.4, -0.135, 0, 0, 0, 0.05, 0.08, 0.03)); // radio
    helmet(WHITE, 0xf0762a);
    // Boom microphone.
    head.push(part(P.box, 0x222428, 0.1, -0.06, -0.12, 0, -0.6, 0, 0.012, 0.012, 0.12));
    boots(BOOT);
  } else if (id === 'casual') {
    // Polo collar, a baseball cap, sunglasses and a green headset.
    chest.push(part(P.box, WHITE, 0, 0.45, -0.1, 0, 0, 0, 0.16, 0.05, 0.06));
    chest.push(part(P.ball, WHITE, 0, 0.4, -0.13, 0, 0, 0, 0.012, 0.012, 0.01));
    head.push(part(P.disc, 0xd23b33, 0, 0.1, 0.01, 0, 0, 0, 0.162, 0.095, 0.162));
    head.push(part(P.ball, 0xd23b33, 0, 0.14, 0.01, 0, 0, 0, 0.16, 0.06, 0.16));
    head.push(part(P.box, 0xd23b33, 0, 0.075, -0.18, 0.12, 0, 0, 0.17, 0.016, 0.13));
    shades(0x1a1a1a);
    // The headset over the cap: a band and two big green cups.
    head.push(part(P.box, 0x2a2d31, 0, 0.15, 0.03, 0, 0, 0, 0.36, 0.025, 0.035));
    for (const s of [-1, 1]) head.push(part(P.disc, 0x3f6d3b, s * 0.165, 0, 0.01, 0, 0, Math.PI / 2, 0.075, 0.06, 0.075));
    head.push(part(P.box, 0x2a2d31, -0.12, -0.06, -0.1, 0, 0.6, 0, 0.012, 0.012, 0.12)); // microphone
    shoe(0x8a5a32);
  } else if (id === 'racer') {
    // White racing stripes down the suit, a sponsor patch, gloves.
    for (const s of [-1, 1]) {
      chest.push(part(P.box, WHITE, s * 0.07, 0.24, -0.131, 0, 0, 0, 0.035, 0.47, 0.01));
    }
    chest.push(part(P.box, 0xffd23f, 0.1, 0.38, -0.133, 0, 0, 0, 0.06, 0.04, 0.01));
    for (let i = 0; i < 2; i++) {
      thigh[i].push(part(P.box, WHITE, rig.legs[i].side * 0.075, -0.2, 0, 0, 0, 0, 0.012, 0.4, 0.04));
      fore[i].push(part(P.ball, 0x1a1a1a, 0, -0.29, 0, 0, 0, 0, 0.055, 0.065, 0.055)); // gloves
    }
    helmet(0xd4252a, WHITE);
    boots(0x1a1a1a);
  } else if (id === 'harrison') {
    // The big white T on his chest.
    chest.push(part(P.box, WHITE, 0, 0.37, -0.132, 0, 0, 0, 0.17, 0.04, 0.012));
    chest.push(part(P.box, WHITE, 0, 0.27, -0.132, 0, 0, 0, 0.042, 0.17, 0.012));
    // Spiky hair and cool shades.
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      head.push(part(P.cone, U.hair, Math.sin(a) * 0.08, 0.16, Math.cos(a) * 0.08 + 0.02, Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5, 0.05, 0.12, 0.05));
    }
    head.push(part(P.cone, U.hair, 0, 0.2, 0.02, 0, 0, 0, 0.055, 0.13, 0.055));
    shades(0x0b0b0b);
    if (opts.flight) {
      // Flying: arms that move (they are his wings) and feet pointed back.
      flightLimbs(rig, U, skin);
    } else {
      // Red trainers with white soles.
      for (let i = 0; i < 2; i++) {
        shin[i].push(part(P.box, 0xe0302b, 0, -0.372, -0.05, 0, 0, 0, 0.12, 0.08, 0.27));
        shin[i].push(part(P.box, WHITE, 0, -0.412, -0.05, 0, 0, 0, 0.125, 0.025, 0.275));
      }
      // The T-pose: straight arms merged into the chest, the rig's own hidden.
      for (const a of rig.arms) {
        const s = a.side;
        const sx = s * 0.235;
        chest.push(part(P.limb, U.shirt, sx, 0.42, 0, 0, 0, s * Math.PI / 2, 0.064, 0.15, 0.064)); // sleeve
        chest.push(part(P.limb, skin, sx + s * 0.13, 0.42, 0, 0, 0, s * Math.PI / 2, 0.05, 0.43, 0.05));
        chest.push(part(P.ball, skin, sx + s * 0.58, 0.42, 0, 0, 0, 0, 0.055, 0.05, 0.06));
        a.arm.visible = false;
      }
    }
    person.userData.tpose = true;
  }

  addTo(rig.head, head);
  addTo(rig.chest, chest);
  addTo(rig.body, hips);
  for (let i = 0; i < 2; i++) {
    addTo(rig.arms[i].arm, upper[i]);
    addTo(rig.arms[i].elbow, fore[i]);
    addTo(rig.legs[i].leg, thigh[i]);
    addTo(rig.legs[i].knee, shin[i]);
  }
  return person;
}

/**
 * Pose a person as a parachutist: hands up on the risers, legs together and
 * a little bent. Harrison keeps his T. Called once a frame by the parachute;
 * no allocation.
 */
export function poseHanging(person, t) {
  const rig = person && person.userData.rig;
  if (!rig) return;
  const sway = Math.sin(t * 1.3) * 0.06;
  for (const a of rig.arms) {
    a.arm.rotation.set(2.75, 0, a.side * 0.28);
    a.elbow.rotation.set(0.35, 0, 0);
  }
  for (const L of rig.legs) {
    L.leg.rotation.set(0.12 + sway * L.side, 0, L.side * 0.04);
    L.knee.rotation.set(-0.25 - Math.max(0, sway) * 0.4, 0, 0);
  }
  rig.head.rotation.set(-0.15, Math.sin(t * 0.7) * 0.3, 0);
}
