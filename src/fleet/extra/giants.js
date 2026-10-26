/**
 * The giants, drawn at full size: the BelugaXL, the 747 Dreamlifter, the
 * An-225 and the C-5 Galaxy. Built the way ./jets.js and ./airliners.js
 * build every airliner — the airliner kit's fuselage, livery, glazing,
 * doors, turbofans and undercarriage — from GIANT_GEOMETRY
 * (../../aircraft/extra/giants.js), the same metres the flight model flies.
 *
 * WHAT MAKES EACH ONE ITSELF:
 *
 *   BelugaXL     a cargo bubble nine metres across on an airliner's lower
 *                half, its front rising straight off the flight deck like a
 *                forehead; a whale's eye and smile painted on (an original
 *                take on a generic idea — no maker's art); finlets on the
 *                tailplane tips
 *   Dreamlifter  a 747 swollen behind its flight deck into a hold that
 *                overhangs the fuselage sides, the fin raised on top of it,
 *                and the seam where the tail swings open
 *   An-225       six engines under a high, drooping wing; a twin tail with
 *                the fins at the tailplane tips; gear pods with seven pairs
 *                of wheels each side and four on the nose
 *   C-5          a high wing with four engines, a T-tail, gear pods with
 *                four six-wheel bogies, a four-wheel nose leg; plain
 *                military grey (no insignia: this game names no air force)
 *
 * The bubble on the Beluga and the Dreamlifter is the kit's second loft, as
 * the 747's hump is (dress(): S.hump), painted from the roof of the livery.
 */

import * as THREE from '../../vendor/three.module.js';
import { GIANT_GEOMETRY } from '../../aircraft/extra/giants.js';
import {
  bodyOf, refitAirlinerLeg as refitLeg, plate, wingAt, trailingEdgeFill, levelBogies, bodyLeg, tyres, findByName,
} from './airliners.js';
import { axleY, enginesOf, dressWithout, specOf, dorsalFairing, removeNamed } from './jets.js';
import { meshOf, piecewise, registration, DECAL } from './airliner-kit.js';
import { skinPatch } from '../../aircraft/models/airliner-parts.js';
import { aircraftDecalTexture } from '../aircraft-textures.js';

const mix = (a, b, t) => a + (b - a) * t;
const ringsBetween = (a, b, step) => {
  const out = [];
  for (let z = a + step; z < b - step * 0.4; z += step) out.push(+z.toFixed(3));
  return out;
};

/* ------------------------------------------------------------------ *
 * Painted art
 * ------------------------------------------------------------------ */

const art = new Map();
/** A shared canvas texture, drawn once. */
function artTexture(key, w, h, draw) {
  if (art.has(key)) return art.get(key);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g && typeof g.clearRect === 'function') {
    g.clearRect(0, 0, w, h);
    draw(g, w, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.name = key;
  art.set(key, t);
  return t;
}

/** The whale's eye: friendly, round, with a highlight and a lid line. Drawn facing forward = left. */
function whaleEyeTexture(ink) {
  return artTexture(`giant-whale-eye|${ink}`, 256, 256, (g, w, h) => {
    const cx = w * 0.5;
    const cy = h * 0.54;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(cx, cy, w * 0.4, h * 0.36, 0, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = w * 0.035;
    g.strokeStyle = ink;
    g.stroke();
    // The iris looks forward (to the left of the drawing, which is the nose).
    g.fillStyle = ink;
    g.beginPath();
    g.ellipse(cx - w * 0.07, cy + h * 0.02, w * 0.21, h * 0.23, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0d1a2b';
    g.beginPath();
    g.ellipse(cx - w * 0.09, cy + h * 0.03, w * 0.11, h * 0.12, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(cx - w * 0.15, cy - h * 0.07, w * 0.05, 0, Math.PI * 2);
    g.fill();
    // A happy lid line above.
    g.strokeStyle = ink;
    g.lineWidth = w * 0.045;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(cx, cy + h * 0.1, w * 0.47, Math.PI * 1.18, Math.PI * 1.82);
    g.stroke();
  });
}

/** The smile: one thick curve along the lower nose, rising into a curled corner at the aft (right) end. */
function whaleSmileTexture(ink) {
  return artTexture(`giant-whale-smile|${ink}`, 1024, 256, (g, w, h) => {
    g.strokeStyle = ink;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = h * 0.13;
    g.beginPath();
    g.moveTo(w * 0.04, h * 0.38);
    g.bezierCurveTo(w * 0.3, h * 0.9, w * 0.72, h * 0.86, w * 0.9, h * 0.4);
    g.stroke();
    // The curl at the corner of the mouth.
    g.lineWidth = h * 0.1;
    g.beginPath();
    g.arc(w * 0.905, h * 0.3, h * 0.12, Math.PI * 0.55, Math.PI * 1.9, true);
    g.stroke();
  });
}

/**
 * A decal laid on a hull at (z, y), `width` along and `height` round, on
 * both sides, mapped nose (left of the drawing) to tail on both — so art
 * that has a front and a back (an eye looking forward, a mouth with its
 * corner aft) is right on both sides. Text should use the kit's
 * registration(), which flips one side so it reads left to right.
 */
function decal(ctx, h, { z, y, width, height, texture, name }, parent) {
  const mat = ctx.model.userData.ownMaterial(new THREE.MeshBasicMaterial({
    map: texture, transparent: true, depthWrite: false, toneMapped: true, ...DECAL,
  }));
  mat.name = `Decal_${name}`;
  for (const side of [1, -1]) {
    const s0 = h.angleAt(z, y + height / 2);
    const s1 = h.angleAt(z, y - height / 2);
    const quad = [[z - width / 2, s0], [z + width / 2, s0], [z + width / 2, s1], [z - width / 2, s1]];
    const g = skinPatch(h, quad, side, 0.035, 8, 6, null);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), 1 - uv.getY(i));
    const m = meshOf(ctx, name, g, mat, parent);
    m.castShadow = false;
  }
  // REAL MODELS: the same decal painted onto a real model's skin (src/aircraft/real-models.js), on the
  // hull it was laid on, the same way round on both sides as these two patches.
  const paint = ctx.exports.realPaint;
  if (paint && paint.decals) paint.decals.push({ texture, z, y, w: width, h: height, hump: h === paint.hump, mirror: false });
}

/** A title along a hull: the kit's registration(), wide and flat, reading left to right from both sides. */
function title(ctx, h, text, { z, y, width, ink }, parent) {
  const tex = aircraftDecalTexture(text, { color: ink, background: 'transparent', width: 2048, height: 128 });
  registration(ctx, h, { text, z, y, width, height: width / 16, texture: tex, name: 'Titling' }, parent);
}

/* ------------------------------------------------------------------ *
 * Undercarriage
 * ------------------------------------------------------------------ */

/**
 * A row of axles in a gear pod: the core's main leg refitted with a bogie
 * of `axles` pairs whose REAR axle sits on the physics contact point (the
 * giants pivot on their back wheels; see ../../aircraft/extra/giants.js),
 * so the row runs forward from it — rigid, not levelled: rotating on the
 * back wheels lifts the front ones, as it should. Extra struts along it.
 */
function podRow(ctx, legId, { axles, pitch, track, r, width, oleo, mats }) {
  const b = refitLeg(ctx, legId, { kind: 'bogie', axles, pitch, track, r, width, oleo, mats });
  if (!b) return null;
  // In a pod there is no leg door: the pod is the fairing.
  removeNamed(ctx.parts[legId], 'Gear leg door');
  const shift = ((axles - 1) * pitch) / 2;
  b.position.z -= shift;
  // Struts up into the pod at every other axle (the core's leg is at the back one).
  for (let i = 1; i < axles; i += 2) {
    const z = shift - i * pitch;
    ctx.tube('Pod strut', [0, r * 0.2, z], [0, r * 0.2 + 1.5, z + 0.25], oleo * 0.8, mats.gear, b, 8);
  }
  return b;
}

/** Four nose wheels abreast (the An-225's two legs, the C-5's one): the kit's twin pair plus an outer pair. */
function quadNose(ctx, { inner, outer, r, width, oleo, mats, twoLegs = false }) {
  refitLeg(ctx, 'noseGear', { kind: 'dual', track: inner * 2, r, width, oleo, mats });
  const leg = ctx.parts.noseGear;
  const wheel = leg && findByName(leg, 'Rolling wheels');
  const steering = leg && findByName(leg, 'Wheel steering');
  if (!wheel || !steering) return;
  tyres(ctx, wheel, 'Twin tyres', [[-outer, 0, 0], [outer, 0, 0]], r, width, mats.tyre);
  ctx.tube('Axle', [-outer - width * 0.3, 0, 0], [outer + width * 0.3, 0, 0], r * 0.13, mats.gear, steering, 8);
  if (twoLegs) {
    // A second strut beside the first, so it reads as two legs.
    const top = new THREE.Vector3(0, 0, 0);
    for (const s of [-1, 1]) ctx.tube('Nose strut', [s * (inner + outer) * 0.5, top.y, 0.1], [s * (inner + outer) * 0.5, steering.position.y + r * 0.3, steering.position.z], oleo * 0.9, mats.gear, leg, 8);
  }
}

/** The tailplane's endplate finlets (BelugaXL): small fins at each tip. */
function finlets(ctx, mat, { up, down, chord }) {
  const t = ctx.config.tail;
  const tipX = t.rootX + t.span;
  const y = t.rootY + (t.dihedral || 0);
  const le = t.rootZ + (t.sweep || 0);
  for (const s of [-1, 1]) {
    plate(ctx, 'Tailplane finlet', [
      [s * tipX, y - down, le + chord * 0.15], [s * tipX, y - down, le + chord * 0.95],
      [s * tipX, y + up, le + chord * 1.05], [s * tipX, y + up, le + chord * 0.45],
    ], 0.14, mat, ctx.parts.tail);
  }
}

/** Fin paint for twin fins (the kit's paintFin() paints only a centred one). */
function paintTwinFins(ctx, mat) {
  const fc = ctx.config.fin;
  const fin = ctx.parts.verticalFin;
  if (!fc || !fin) return;
  for (const side of [1, -1]) {
    const x0 = side * (fc.x || 0);
    const geo = new THREE.BoxGeometry(1, 1, 1, 1, 2, 1);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = 0.08 + (p.getY(i) + 0.5) * 0.92;
      const ch = mix(fc.rootChord, fc.tipChord, t);
      const th = mix(fc.thickness || 0.14, 0.045, t);
      p.setXYZ(i, x0 + p.getX(i) * th * 1.14 + Math.sign(p.getX(i)) * 0.004,
        fc.rootY + fc.height * t + (t > 0.999 ? 0.01 : 0),
        fc.rootZ + fc.sweep * t + (0.012 + (p.getZ(i) + 0.5) * 0.735) * ch);
    }
    geo.computeVertexNormals();
    meshOf(ctx, 'Painted fin', geo, mat, fin);
  }
}

/* ------------------------------------------------------------------ *
 * BelugaXL
 * ------------------------------------------------------------------ */
const GBX = GIANT_GEOMETRY.belugaxl;
const BELUGA = {
  ...specOf(GBX, {
    tailStart: 7.0,
    ringStep: 2.0,
    radial: 18,
    cuts: [-17.1, 12.0],
    alongNose: 0.15,
    bellyY: -1.7,
    laps: [1.9, -1.1],
    cheat: { y0: -0.72, y1: -0.36, z0: -22.5, z1: 26.0 },
    reg: { z: 27.0, y: 1.25, w: 2.4 },
    windows: [],
    doors: [{ id: '#1', z: -19.0, y: 0.0, w: 0.8, h: 1.7, kind: 'passenger', sill: -0.85 }],
    fairing: [
      [-12.0, 2.0, 0.45, -2.5], [-8.5, 2.6, 0.8, -2.3], [-3.0, 2.8, 1.0, -2.2],
      [2.5, 2.8, 0.95, -2.23], [6.0, 2.4, 0.65, -2.38], [8.5, 1.6, 0.32, -2.55],
    ],
    aerials: { crown: [-6.0, 12.0], belly: [-15.0, -13.0] },
    beaconZ: 0.0,
  }),
  hump: { stations: GBX.bubble, radial: 18, rings: [...ringsBetween(-21.7, -10.5, 1.0), ...ringsBetween(16.0, 37.12, 2.0)] },
};

const belugaxl = {
  id: 'belugaxl', name: 'Airbus BelugaXL', kind: 'airliner', massKg: 26000,
  paint: '#f2f5f8', accent: '#1d78c8', registration: 'F-WHAL', bodySegments: 8,
  body: bodyOf(BELUGA.fuselage.stations),
  wing: {
    rootX: 2.8, span: GBX.tip.x - 2.8, rootZ: GBX.wingZ, rootY: -2.0,
    rootChord: 8.4, tipChord: 1.65, sweep: 15.4, dihedral: GBX.tip.y + 2.0,
    thickness: 1.25, tipThickness: 0.22, flaps: true, struts: false,
  },
  tail: {
    rootX: 1.2, span: 8.6, rootZ: 25.5, rootY: 2.4,
    rootChord: 6.0, tipChord: 2.1, sweep: 5.6, dihedral: 0.9, thickness: 0.5, tipThickness: 0.14,
  },
  fin: { rootZ: 24.5, rootY: 7.1, height: 6.9, rootChord: 9.5, tipChord: 3.2, sweep: 6.4, thickness: 0.9 },
  canopy: null,
  gear: {
    nose: [0, axleY(GBX, GBX.nose.r), GBX.nose.z], main: [GBX.main.x, axleY(GBX, GBX.main.r), GBX.main.z],
    noseRadius: GBX.nose.r, mainRadius: GBX.main.r,
    noseAttach: [0, -2.35, GBX.nose.z + 0.2], mainAttach: [GBX.main.x, -2.2, GBX.main.z - 0.2],
    retractable: true, dualMain: false, doors: false,
  },
  engines: enginesOf(GBX),
  eye: GBX.eye,
  decorate(ctx) {
    const { M, h, hump } = dressWithout(ctx, BELUGA);
    trailingEdgeFill(ctx, 9.5, 3.0, 0.5);
    // Canted winglets, the A330's.
    const w = ctx.config.wing;
    const tip = wingAt(w, w.rootX + w.span);
    for (const s of [-1, 1]) {
      plate(ctx, 'Winglet', [
        [s * (w.rootX + w.span - 0.05), tip.mid + 0.05, tip.le + 0.4], [s * (w.rootX + w.span - 0.05), tip.mid + 0.05, tip.te - 0.05],
        [s * (GBX.span / 2), tip.mid + 2.7, tip.te + 0.6], [s * (GBX.span / 2), tip.mid + 2.7, tip.te - 0.3],
      ], 0.14, ctx.materials.accent, ctx.parts[s < 0 ? 'leftWing' : 'rightWing']);
    }
    finlets(ctx, ctx.materials.accent, { up: 2.1, down: 0.9, chord: 2.1 });
    // The face: an eye high on each side of the bubble's forehead, a smile along the lower nose.
    const ink = '#13406e';
    if (hump) decal(ctx, hump, { z: -18.2, y: 4.7, width: 1.9, height: 1.7, texture: whaleEyeTexture(ink), name: 'Whale eye' }, ctx.parts.nose);
    decal(ctx, h, { z: -22.6, y: -1.1, width: 6.2, height: 1.55, texture: whaleSmileTexture(ink), name: 'Whale smile' }, ctx.parts.nose);
    refitLeg(ctx, 'noseGear', { kind: 'dual', track: 0.74, r: GBX.nose.r, width: 0.34, oleo: 0.15, mats: M });
    const bogies = [];
    for (const id of ['leftGear', 'rightGear']) {
      const b = refitLeg(ctx, id, { kind: 'bogie', axles: 2, pitch: 1.98, track: 1.4, r: GBX.main.r, width: 0.53, oleo: 0.23, mats: M });
      if (b) bogies.push({ node: b, z: GBX.main.z });
    }
    levelBogies(ctx, bogies, GBX.main.z);
  },
  description: 'The BelugaXL: an airliner\'s lower fuselage, wing and engines under a nine-metre cargo bubble whose front rises off the flight deck, a painted whale\'s eye and smile, a fin on the bubble and finlets on the tailplane.',
  inspiration: 'Drawn to the BelugaXL\'s published dimensions; the whale face and the house livery are the game\'s own.',
};

/* ------------------------------------------------------------------ *
 * 747 Dreamlifter
 * ------------------------------------------------------------------ */
const GLC = GIANT_GEOMETRY.dreamlifter;
const DREAMLIFTER = {
  ...specOf(GLC, {
    tailStart: 11.0,
    ringStep: 2.4,
    radial: 18,
    cuts: [-21.0, 16.0],
    alongNose: 0.17,
    bellyY: -1.9,
    laps: [2.25, -1.3],
    cheat: { y0: -0.95, y1: -0.55, z0: -27.0, z1: 31.0 },
    reg: { z: 26.5, y: 0.45, w: 3.0 },
    windows: [],
    doors: [{ id: '#1', z: -22.3, y: 0.465, w: 1.07, h: 1.93, kind: 'passenger', sill: -0.5 }],
    fairing: [
      [-14.5, 2.4, 0.5, -2.85], [-10.5, 3.05, 0.95, -2.62], [-4.5, 3.3, 1.15, -2.52],
      [1.5, 3.3, 1.1, -2.55], [5.8, 2.9, 0.78, -2.68], [8.8, 2.0, 0.4, -2.86],
    ],
    aerials: { crown: [-14.0, 9.0, 19.5], belly: [-20.5, -17.5] },
    beaconZ: 7.0,
  }),
  hump: { stations: GLC.bubble, radial: 18, rings: [-26.0, -22.8, -19.5, -15.0, -9.0, 21.0, 27.0, 32.5, 36.8, 39.6] },
  flightDeckOn: 'upper',
};

const dreamlifter = {
  id: 'dreamlifter', name: 'Boeing 747 Dreamlifter', kind: 'airliner', massKg: 28000,
  paint: '#f3f5f7', accent: '#163f6e', registration: 'N747LF', bodySegments: 8,
  body: bodyOf(DREAMLIFTER.fuselage.stations),
  wing: {
    rootX: 2.45, span: GLC.tip.x - 2.45, rootZ: GLC.wingZ, rootY: -2.1,
    rootChord: 13.78, tipChord: 3.6, sweep: 24.25, dihedral: GLC.tip.y + 2.1,
    thickness: 1.6, tipThickness: 0.28, flaps: true, struts: false,
  },
  tail: {
    rootX: 0.9, span: 10.2, rootZ: 28.8, rootY: 1.75,
    rootChord: 7.4, tipChord: 2.5, sweep: 7.46, dihedral: 1.2, thickness: 0.7, tipThickness: 0.15,
  },
  fin: { rootZ: 25.0, rootY: 6.4, height: 9.3, rootChord: 13.0, tipChord: 4.3, sweep: 11.0, thickness: 1.0 },
  canopy: null,
  gear: {
    nose: [0, axleY(GLC, GLC.nose.r), GLC.nose.z], main: [GLC.main.x, axleY(GLC, GLC.main.r), 0.8],
    noseRadius: GLC.nose.r, mainRadius: GLC.main.r,
    noseAttach: [0, -2.55, GLC.nose.z + 0.2], mainAttach: [GLC.main.x, -2.2, 0.6],
    retractable: true, dualMain: false, doors: false,
  },
  engines: enginesOf(GLC),
  eye: GLC.eye,
  decorate(ctx) {
    const { M, hump } = dressWithout(ctx, DREAMLIFTER);
    trailingEdgeFill(ctx, 11.5, 3.5, 0.6);
    const w = ctx.config.wing;
    const tip = wingAt(w, w.rootX + w.span);
    for (const s of [-1, 1]) {
      plate(ctx, 'Winglet', [
        [s * (w.rootX + w.span - 0.05), tip.mid + 0.05, tip.le + 0.8], [s * (w.rootX + w.span - 0.05), tip.mid + 0.05, tip.te - 0.1],
        [s * GLC.span / 2, tip.mid + 1.62, tip.te + 0.35], [s * GLC.span / 2, tip.mid + 1.62, tip.te - 0.6],
      ], 0.16, ctx.materials.accent, ctx.parts[s < 0 ? 'leftWing' : 'rightWing']);
    }
    if (hump) {
      title(ctx, hump, 'ISLAND HEAVY LIFT', { z: -2.0, y: 4.9, width: 24, ink: '#163f6e' }, ctx.parts.fuselage);
      // The swing tail's hinge line: a dark band round the hold where the tail opens.
      const seam = artTexture('giant-seam', 64, 64, (g, W, H) => {
        g.fillStyle = 'rgba(25,32,40,0.8)';
        g.fillRect(W * 0.35, 0, W * 0.3, H);
      });
      decal(ctx, hump, { z: 21.0, y: 3.2, width: 0.35, height: 6.0, texture: seam, name: 'Swing tail seam' }, ctx.parts.fuselage);
    }
    refitLeg(ctx, 'noseGear', { kind: 'dual', track: 0.78, r: GLC.nose.r, width: 0.36, oleo: 0.16, mats: M });
    const bogies = [];
    for (const id of ['leftGear', 'rightGear']) {
      const b = refitLeg(ctx, id, { kind: 'bogie', axles: 2, pitch: 1.47, track: 1.12, r: GLC.main.r, width: 0.42, oleo: 0.2, mats: M });
      if (b) bogies.push({ node: b, z: 0.8 });
    }
    for (const s of [-1, 1]) {
      const body = bodyLeg(ctx, s, { x: 1.92, z: 3.7, attachY: -2.5, contactY: GLC.ground, axles: 2, pitch: 1.47, track: 1.12, r: GLC.main.r, width: 0.42, oleo: 0.2, mass: 300, mats: M });
      bogies.push({ node: body.bogie, z: 3.7 });
      ctx.registerAnimation((dt, state) => {
        const gear = state.gear ?? 1;
        body.leg.visible = gear > 0.025;
        body.leg.rotation.x = (1 - gear) * 1.45;
      });
    }
    levelBogies(ctx, bogies, GLC.main.z);
  },
  description: 'The 747 Dreamlifter: a 747-400 whose upper fuselage swells behind the flight deck into a hold wider than the fuselage, the fin raised on top of it and the swing-tail seam behind the wing, four turbofans, eighteen wheels.',
  inspiration: 'Drawn to the 747-400LCF\'s published dimensions; the house livery and titling are the game\'s own.',
};

/* ------------------------------------------------------------------ *
 * An-225
 * ------------------------------------------------------------------ */
const GAN = GIANT_GEOMETRY.an225;
const AN225 = specOf(GAN, {
  tailStart: 12.0,
  ringStep: 2.0,
  radial: 18,
  cuts: [-26.0, 18.0],
  alongNose: 0.12,
  bellyY: -2.3,
  laps: [2.6, -1.6],
  cheat: { y0: -0.4, y1: 0.05, z0: -31.0, z1: 40.0 },
  reg: { z: 34.0, y: 2.5, w: 3.4 },
  windows: [{ y: 3.05, z0: -29.6, z1: -20.6, pitch: 0.75, w: 0.24, ht: 0.32 }],
  doors: [{ id: '#1', z: -25.0, y: -1.2, w: 0.9, h: 1.8, kind: 'passenger', sill: -2.1 }],
  // The gear pods along the belly, standing out from the fuselage sides.
  fairing: [
    [-6.2, 2.8, 0.4, -2.9], [-4.4, 4.15, 1.0, -2.55], [-1.6, 4.4, 1.15, -2.45],
    [6.6, 4.4, 1.15, -2.45], [9.3, 4.15, 0.95, -2.55], [10.9, 2.8, 0.4, -2.9],
  ],
  aerials: { crown: [-20.0, 16.0], belly: [-22.0, -18.0] },
  beaconZ: 20.0,
});

const AN_ENGINES = ['leftInboardEngine', 'leftMiddleEngine', 'leftOutboardEngine', 'rightInboardEngine', 'rightMiddleEngine', 'rightOutboardEngine'];

const an225 = {
  id: 'an225', name: 'Antonov An-225 Mriya', kind: 'airliner', massKg: 28000,
  paint: '#f1f3f6', accent: '#2c5aa0', registration: 'UR-ISL', bodySegments: 8,
  body: bodyOf(AN225.fuselage.stations),
  wing: {
    rootX: 1.5, span: GAN.tip.x - 1.5, rootZ: GAN.wingZ, rootY: 4.0,
    rootChord: 15.0, tipChord: 4.2, sweep: 26.7, dihedral: GAN.tip.y - 4.0,
    thickness: 2.2, tipThickness: 0.5, flaps: true, struts: false,
  },
  tail: {
    rootX: 0.6, span: 15.7, rootZ: 37.0, rootY: 3.75,
    rootChord: 8.5, tipChord: 5.0, sweep: 4.5, dihedral: 0.8, thickness: 0.7, tipThickness: 0.3,
  },
  // Twin fins on the tailplane tips: the core draws one at x and mirrors it.
  // They reach a metre below the tailplane, and no further: lower and their
  // trailing edges, 40 m behind the main wheels, would meet the runway
  // before the tail cone does.
  fin: { x: 16.3, mirror: true, rootZ: 40.6, rootY: 3.6, height: 9.0, rootChord: 7.6, tipChord: 4.2, sweep: 3.2, thickness: 0.6 },
  canopy: null,
  gear: {
    nose: [0, axleY(GAN, GAN.nose.r), GAN.nose.z], main: [GAN.main.x, axleY(GAN, GAN.main.r), GAN.main.z],
    noseRadius: GAN.nose.r, mainRadius: GAN.main.r,
    noseAttach: [0, -2.4, GAN.nose.z + 0.2], mainAttach: [GAN.main.x, -2.5, GAN.main.z],
    retractable: true, dualMain: false, doors: false,
  },
  engines: enginesOf(GAN, { names: AN_ENGINES }),
  eye: GAN.eye,
  decorate(ctx) {
    const { M, h } = dressWithout(ctx, AN225, { fin: true });
    const along = piecewise(AN225.fuselage.alongKnots);
    // The high wing sits in a long fairing on the crown.
    dorsalFairing(ctx, [
      [-11.5, 0.3, 0.1, 4.25], [-9.5, 1.9, 0.75, 4.3], [-5.0, 2.4, 1.0, 4.35],
      [4.0, 2.4, 1.0, 4.35], [8.5, 1.8, 0.7, 4.3], [10.5, 0.3, 0.1, 4.25],
    ], along, M.skin);
    const finMat = ctx.model.userData.ownMaterial(Object.assign(ctx.materials.accent.clone(), DECAL));
    paintTwinFins(ctx, finMat);
    title(ctx, h, 'SKY GIANT', { z: -14.0, y: 2.55, width: 14, ink: '#2c5aa0' }, ctx.parts.fuselage);
    quadNose(ctx, { inner: 0.42, outer: 1.18, r: GAN.nose.r, width: 0.42, oleo: 0.18, mats: M, twoLegs: true });
    for (const id of ['leftGear', 'rightGear']) podRow(ctx, id, { axles: 7, pitch: 1.9, track: 1.05, r: GAN.main.r, width: 0.44, oleo: 0.2, mats: M });
  },
  description: 'The An-225: six turbofans under a high anhedral wing on a crown fairing, a twin tail with endplate fins, gear pods with seven axle pairs each side and four nose wheels, the flight deck high on a round visor nose.',
  inspiration: 'Drawn to the An-225\'s published dimensions; the house livery and titling are the game\'s own.',
};

/* ------------------------------------------------------------------ *
 * C-5 Galaxy
 * ------------------------------------------------------------------ */
const GC5 = GIANT_GEOMETRY.c5;
const C5 = specOf(GC5, {
  tailStart: 9.0,
  ringStep: 2.0,
  radial: 18,
  cuts: [-21.0, 15.0],
  alongNose: 0.12,
  bellyY: -2.2,
  laps: [2.6, -1.5],
  // Military grey: no cheatline, no titling.
  cheat: null,
  reg: { z: 33.0, y: 2.6, w: 3.0 },
  windows: [{ y: 3.0, z0: 2.4, z1: 14.4, pitch: 1.2, w: 0.26, ht: 0.34 }],
  doors: [{ id: '#1', z: -19.5, y: -1.0, w: 0.9, h: 1.8, kind: 'passenger', sill: -1.9 }],
  fairing: [
    [-4.2, 4.0, 0.5, -2.75], [-2.4, 5.95, 1.1, -2.5], [-0.2, 6.2, 1.25, -2.45],
    [5.8, 6.2, 1.25, -2.45], [7.6, 5.95, 1.1, -2.5], [9.3, 4.0, 0.5, -2.75],
  ],
  aerials: { crown: [-16.0, 20.0], belly: [-17.0, -14.0] },
  beaconZ: 18.0,
});

const c5 = {
  id: 'c5', name: 'Lockheed C-5 Galaxy', kind: 'airliner', massKg: 27000,
  paint: '#6e747b', accent: '#4d555d', registration: 'GX-05', bodySegments: 8,
  body: bodyOf(C5.fuselage.stations),
  wing: {
    rootX: 1.5, span: GC5.tip.x - 1.5, rootZ: GC5.wingZ, rootY: 4.0,
    rootChord: 11.0, tipChord: 3.6, sweep: 16.5, dihedral: GC5.tip.y - 4.0,
    thickness: 1.6, tipThickness: 0.35, flaps: true, struts: false,
  },
  // The T-tail: the tailplane on the fin's tip.
  tail: {
    rootX: 0.3, span: 10.15, rootZ: 37.3, rootY: 15.1,
    rootChord: 5.8, tipChord: 2.8, sweep: 3.5, dihedral: -0.4, thickness: 0.5, tipThickness: 0.2,
  },
  fin: { rootZ: 30.0, rootY: 3.9, height: 11.2, rootChord: 11.0, tipChord: 6.0, sweep: 7.0, thickness: 1.0 },
  canopy: null,
  gear: {
    nose: [0, axleY(GC5, GC5.nose.r), GC5.nose.z], main: [GC5.main.x, axleY(GC5, GC5.main.r), GC5.main.z],
    noseRadius: GC5.nose.r, mainRadius: GC5.main.r,
    noseAttach: [0, -2.3, GC5.nose.z + 0.2], mainAttach: [GC5.main.x, -2.5, GC5.main.z],
    retractable: true, dualMain: false, doors: false,
  },
  engines: enginesOf(GC5),
  eye: GC5.eye,
  decorate(ctx) {
    const { M } = dressWithout(ctx, C5);
    const along = piecewise(C5.fuselage.alongKnots);
    dorsalFairing(ctx, [
      [-8.6, 0.3, 0.1, 4.15], [-6.8, 1.7, 0.7, 4.2], [-3.0, 2.2, 0.95, 4.25],
      [3.5, 2.2, 0.95, 4.25], [6.8, 1.6, 0.6, 4.2], [8.4, 0.3, 0.1, 4.15],
    ], along, M.skin);
    quadNose(ctx, { inner: 0.36, outer: 1.02, r: GC5.nose.r, width: 0.4, oleo: 0.18, mats: M });
    // Aft bogies on the core's legs (rear axle on the contact point), forward ones on legs of their own.
    for (const id of ['leftGear', 'rightGear']) podRow(ctx, id, { axles: 3, pitch: 1.15, track: 1.1, r: GC5.main.r, width: 0.42, oleo: 0.2, mats: M });
    for (const s of [-1, 1]) {
      const body = bodyLeg(ctx, s, { x: GC5.main.x, z: GC5.main.z - 5.6, attachY: -2.6, contactY: GC5.ground, axles: 3, pitch: 1.15, track: 1.1, r: GC5.main.r, width: 0.42, oleo: 0.2, mass: 400, mats: M });
      ctx.registerAnimation((dt, state) => {
        const gear = state.gear ?? 1;
        body.leg.visible = gear > 0.025;
        body.leg.rotation.x = (1 - gear) * 1.45;
      });
    }
  },
  description: 'The C-5: a high swept wing with four turbofans, a T-tail, a visor nose with the flight deck above the hold, gear pods with four six-wheel bogies and a four-wheel nose leg, in plain grey.',
  inspiration: 'Drawn to the C-5M\'s published dimensions; no service markings — the game names no air force.',
};

export const DEFINITIONS = [belugaxl, dreamlifter, an225, c5];
export const DRAWS = DEFINITIONS.map((d) => d.id);

/** For tests: each giant's fuselage, deck and door specification, in metres. */
export const GIANT_SPECS = { belugaxl: BELUGA, dreamlifter: DREAMLIFTER, an225: AN225, c5: C5 };
