/**
 * The fleet — five aeroplanes you can actually feel the difference between.
 *
 * Each entry carries two things:
 *
 *   `shape`  the dimensions the model is built from
 *   `spec`   the numbers the flight model flies
 *
 * They are in one file on purpose. The drawn wheels have to touch the ground
 * exactly where the physics thinks the wheels are, and the wing tips have to
 * be where the wing-strike test looks for them — so both are derived from the
 * same `shape` rather than typed in twice and left to drift apart.
 *
 * A note on honesty: these are not the real performance figures of any real
 * aeroplane, and the airliner and the fighter have been given more thrust and
 * a lower stalling speed than their real counterparts so that all five can use
 * the same 1,100 m runway. Everything else — the relative feel of a light
 * trainer against a swept-wing jet, the way a heavy one needs planning and a
 * fighter does not — is honest.
 */

import * as THREE from '../vendor/three.module.js';

/**
 * The trainer's aero numbers, which every other aeroplane is described as a
 * change from. These are the values the whole game was tuned around, so the
 * default aeroplane must keep them exactly.
 */
const TRAINER_AERO = {
  mass: 1100,
  wingArea: 16.2,
  wingSpan: 11,
  chord: 1.47,
  Ixx: 1800,
  Iyy: 2600,
  Izz: 1300,
  CL0: 0.25,
  CLa: 5.0,
  alphaStall: 0.29,
  CD0: 0.044,
  k: 0.0545,
  CYb: -0.31,
  Cmalpha: -1.05,
  Cmq: -16.0,
  Cmde: -0.75,
  Clb: -0.09,
  Clp: -0.52,
  Clda: 0.075,
  Cnb: 0.083,
  Cnr: -0.11,
  Cndr: 0.009,
  thrustMax: 3400,
  fuelCapacity: 160,
  fuelBurnMax: 0.0105,
  gearDragArea: 0.55,
  maxGearSpeed: 74,
  vne: 82,
};

/**
 * The trainer's shape, in metres, before the per-type scale is applied.
 * `halfSpan` is measured from the aircraft centreline to the wing tip.
 */
const TRAINER_SHAPE = {
  scale: 1,
  // Fuselage: the lathe profile is stretched by these.
  bodyLength: 1,
  bodyRadius: 1,
  // Wing
  halfSpan: 5.52,
  rootChord: 1.68,
  tipChord: 1.02,
  sweep: 0.28, // how far aft the tip sits relative to the root
  dihedral: 0.23, // how far up
  wingY: 0.72, // high wing
  wingZ: -1.05,
  wingRootX: 0.62,
  struts: true,
  // Tail
  hSpan: 1.75,
  hRootChord: 1.0,
  hZ: 2.85,
  finHeight: 1.55,
  finRootChord: 1.5,
  finSweep: 0.62,
  finZ: 2.55,
  // Powerplant
  power: { kind: 'prop', count: 1, propRadius: 1.05, z: -2.6 },
  canopy: 'cabin',
  hook: false,
  // Where the pilot's eyes are, before scaling. The camera rig reads this, so
  // the view out of an airliner flight deck is not the view out of a trainer.
  eye: [-0.24, 0.46, 0.06],
  // Undercarriage contact points, which the flight model uses verbatim.
  nose: { x: 0, y: -1.42, z: -1.15 },
  main: { x: 1.42, y: -1.5, z: 0.42 },
  wheelR: { nose: 0.3, main: 0.36 },
  gearStiffness: 1,
  retractable: false,
};

/**
 * Ground-contact and strike points, worked out from the shape so the drawn
 * aeroplane and the flown one always agree.
 */
function pointsFor(shape, aero) {
  const s = shape.scale;
  // Spring rate has to scale with what it is holding up. On the trainer's
  // springs a 16.5 tonne airliner needed 1.4 m of travel and only had 0.53,
  // so its oleos bottomed out and it sat on its belly with the tail in the
  // ground. Scaling by mass makes every aeroplane sit at the same fraction of
  // its travel, and `gearStiffness` stays what it was meant to be — a
  // character knob, stiff for a naval undercarriage, soft for a light single.
  const massScale = (aero && aero.mass ? aero.mass : 1100) / 1100;
  const g = shape.gearStiffness * massScale;
  const tipX = (shape.wingRootX + shape.halfSpan) * s;
  const tipY = (shape.wingY + shape.dihedral) * s;
  const noseZ = -2.6 * shape.bodyLength * s;
  const tailZ = 3.95 * shape.bodyLength * s;
  return {
    gearPoints: [
      {
        name: 'nose',
        pos: new THREE.Vector3(shape.nose.x * s, shape.nose.y * s, shape.nose.z * s),
        steer: true,
        brake: false,
        k: 26000 * g,
        c: 4200 * g,
        travel: 0.2 * s,
        stopRate: 60,
      },
      {
        name: 'left',
        pos: new THREE.Vector3(-shape.main.x * s, shape.main.y * s, shape.main.z * s),
        steer: false,
        brake: true,
        k: 34000 * g,
        c: 5200 * g,
        travel: 0.26 * s,
        stopRate: 50,
      },
      {
        name: 'right',
        pos: new THREE.Vector3(shape.main.x * s, shape.main.y * s, shape.main.z * s),
        steer: false,
        brake: true,
        k: 34000 * g,
        c: 5200 * g,
        travel: 0.26 * s,
        stopRate: 50,
      },
    ],
    hardPoints: [
      {
        pos: new THREE.Vector3(0, -0.9 * s, noseZ),
        what: shape.power.kind === 'jet' ? 'The nose struck the ground' : 'The propeller struck the ground',
      },
      { pos: new THREE.Vector3(-tipX, tipY, -0.5 * s), what: 'The left wing tip hit the ground' },
      { pos: new THREE.Vector3(tipX, tipY, -0.5 * s), what: 'The right wing tip hit the ground' },
      { pos: new THREE.Vector3(0, -0.12 * s, tailZ), what: 'The tail struck the ground' },
      { pos: new THREE.Vector3(0, -0.82 * s, 0.3 * s), what: 'The belly hit the ground' },
    ],
  };
}

export const AIRCRAFT = [
  {
    id: 'skylark',
    name: 'Skylark 172',
    class: 'Trainer',
    blurb:
      'The one everything else is measured against. Slow, steady and almost impossible to frighten — ' +
      'it will fly itself out of most mistakes if you let go.',
    stats: { speed: 1, handling: 3, ease: 5 },
    livery: '#eef1f5',
    accent: '#c8102e',
    callsign: 'Skylark one seven two',
    shape: { ...TRAINER_SHAPE },
    aero: { ...TRAINER_AERO },
  },

  {
    id: 'courier',
    name: 'Kestrel Courier',
    class: 'Tourer',
    blurb:
      'A quick low-wing single with the wheels tucked away. Twice the range and half again the speed ' +
      'of the trainer, and it will not tolerate a sloppy approach quite as kindly.',
    stats: { speed: 2, handling: 4, ease: 4 },
    livery: '#1d2b3a',
    accent: '#e0a838',
    callsign: 'Courier eight papa',
    shape: {
      ...TRAINER_SHAPE,
      scale: 1.08,
      bodyLength: 1.06,
      halfSpan: 5.3,
      rootChord: 1.72,
      tipChord: 0.94,
      sweep: 0.42,
      dihedral: 0.4,
      wingY: -0.42, // low wing
      wingZ: -0.9,
      struts: false,
      retractable: true,
      main: { x: 1.5, y: -1.5, z: 0.5 },
      power: { kind: 'prop', count: 1, propRadius: 1.15, z: -2.7 },
      eye: [-0.24, 0.44, -0.05],
    },
    aero: {
      ...TRAINER_AERO,
      mass: 1560,
      wingArea: 16.9,
      wingSpan: 11.6,
      chord: 1.5,
      Ixx: 2500,
      Iyy: 3500,
      Izz: 1850,
      CL0: 0.22,
      CD0: 0.031,
      k: 0.050,
      alphaStall: 0.28,
      Clda: 0.082,
      Clp: -0.48,
      thrustMax: 5400,
      fuelCapacity: 340,
      fuelBurnMax: 0.021,
      maxGearSpeed: 88,
      vne: 104,
    },
  },

  {
    id: 'meridian',
    name: 'Meridian 220',
    class: 'Airliner',
    blurb:
      'Forty seats, two engines and a lot of momentum. Think three miles ahead of it, start everything ' +
      'early, and it is the most satisfying thing here to land well.',
    stats: { speed: 4, handling: 2, ease: 2 },
    livery: '#f4f6f8',
    accent: '#12508c',
    callsign: 'Meridian four two zero',
    shape: {
      ...TRAINER_SHAPE,
      scale: 2.05,
      bodyLength: 1.35,
      bodyRadius: 1.15,
      halfSpan: 6.4,
      rootChord: 2.1,
      tipChord: 0.72,
      sweep: 2.1, // swept wing
      dihedral: 0.5,
      wingY: -0.5,
      wingZ: -0.2,
      struts: false,
      retractable: true,
      hSpan: 2.3,
      hRootChord: 1.15,
      hZ: 3.5,
      finHeight: 2.3,
      finRootChord: 1.9,
      finSweep: 1.5,
      finZ: 2.6,
      main: { x: 1.35, y: -1.5, z: 0.9 },
      nose: { x: 0, y: -1.42, z: -1.7 },
      wheelR: { nose: 0.3, main: 0.4 },
      gearStiffness: 1.7,
      // Outboard, and low enough that the top of the nacelle clears the
      // underside of the wing with a pylon in between.
      power: { kind: 'jet', count: 2, x: 3.4, y: -1.5, z: -1.0, radius: 0.6, length: 1.15 },
      canopy: 'airliner',
      eye: [-0.3, 0.3, -1.5],
    },
    aero: {
      ...TRAINER_AERO,
      mass: 16500,
      wingArea: 78,
      wingSpan: 26.2,
      chord: 3.0,
      Ixx: 210000,
      Iyy: 420000,
      Izz: 160000,
      CL0: 0.20,
      CLa: 5.2,
      alphaStall: 0.26,
      CD0: 0.023,
      k: 0.044,
      CYb: -0.42,
      Cmalpha: -1.3,
      Cmq: -24.0,
      Cmde: -0.9,
      Clb: -0.12,
      Clp: -0.62,
      Clda: 0.046, // heavy in roll
      Cnb: 0.11,
      Cnr: -0.16,
      Cndr: 0.011,
      thrustMax: 60000,
      fuelCapacity: 5200,
      fuelBurnMax: 0.62,
      gearDragArea: 2.4,
      maxGearSpeed: 105,
      vne: 168,
    },
  },

  {
    id: 'vanguard',
    name: 'Vanguard F-1',
    class: 'Fighter',
    blurb:
      'Enormous thrust, a wing built for speed rather than comfort, and a roll rate that will surprise ' +
      'you. Wonderful to throw around, unforgiving if you get slow.',
    stats: { speed: 5, handling: 5, ease: 1 },
    livery: '#6d7480',
    accent: '#22303f',
    callsign: 'Vanguard zero one',
    shape: {
      ...TRAINER_SHAPE,
      scale: 1.22,
      bodyLength: 1.45,
      bodyRadius: 0.86,
      halfSpan: 3.5,
      rootChord: 3.0,
      tipChord: 0.8,
      sweep: 2.3,
      dihedral: -0.1, // slight anhedral
      wingY: -0.28,
      wingZ: 0.15,
      wingRootX: 0.45,
      struts: false,
      retractable: true,
      hSpan: 1.5,
      hRootChord: 1.2,
      hZ: 2.9,
      finHeight: 1.5,
      finRootChord: 1.7,
      finSweep: 1.2,
      finZ: 2.2,
      // Tall gear, and the mains well aft. With the short legs it had, the
      // tail hit the ground at 14.6 degrees — before the wing had enough
      // angle to fly — so it could rotate but never unstick. Long legs are
      // why real carrier-capable fighters look like they are on stilts.
      main: { x: 1.1, y: -1.74, z: 0.9 },
      nose: { x: 0, y: -1.69, z: -1.5 },
      wheelR: { nose: 0.26, main: 0.3 },
      gearStiffness: 1.3,
      power: { kind: 'jet', count: 1, x: 0, y: -0.1, z: 2.9, radius: 0.6, length: 1.5, afterburner: true },
      canopy: 'bubble',
      eye: [0, 0.36, -0.62],
    },
    aero: {
      ...TRAINER_AERO,
      // A clean delta could not unstick inside 1,100 m: at the runway end it
      // was still below its own stalling speed. Real fighters solve that with
      // leading-edge slats and blown flaps, so this one has them — a higher
      // zero-alpha lift and a bigger wing. It still needs the most runway of
      // the five, which is the right answer.
      // Sized so it flies off at about 12 degrees of alpha. At the previous
      // wing loading it needed 18 degrees to lift its own weight, and it
      // strikes its tail at 16 — so it would rotate, sit there, and run off
      // the end. Lighter, a bigger wing and more lift at zero alpha fixes it
      // properly rather than by making the runway longer.
      mass: 7200,
      wingArea: 32,
      wingSpan: 9.9,
      chord: 3.4,
      Ixx: 46000,
      Iyy: 100000,
      Izz: 13000,
      CL0: 0.30,
      CLa: 4.0, // low aspect ratio: shallower lift curve, higher stall angle
      alphaStall: 0.45,
      CD0: 0.021,
      k: 0.108,
      CYb: -0.36,
      // "Agile" was taken too literally here: weak pitch stiffness, light
      // pitch damping and almost no weathercock stability together made it
      // wallow and then diverge — it would not hold an attitude hands-off,
      // which is not agility, it is just unflyable. Stiffness and damping are
      // back to sane values; the agility now comes from where it belongs, the
      // control power (Cmde, Clda), which is still far above the trainer's.
      Cmalpha: -0.98,
      Cmq: -19.0,
      Cmde: -1.15,
      Clb: -0.075,
      Clp: -0.58,
      Clda: 0.150, // still twice the trainer's roll authority
      Cnb: 0.115,
      Cnr: -0.19,
      Cndr: 0.012,
      thrustMax: 62000,
      fuelCapacity: 3200,
      fuelBurnMax: 0.95,
      // It could not be slowed to its own approach speed: at idle, gear and
      // full flap it still sat 20 knots fast and simply floated down the
      // runway. A fast jet's undercarriage and boards are enormous — this is
      // three times what it had, and it can now be flown at approach speed.
      gearDragArea: 3.4,
      maxGearSpeed: 128,
      vne: 300,
    },
  },

  {
    id: 'osprey',
    name: 'Osprey CV',
    class: 'Carrier',
    blurb:
      'Built to be flown onto a moving deck: huge flaps, a very low approach speed and undercarriage ' +
      'you would struggle to break. Lands shorter than anything else here.',
    stats: { speed: 3, handling: 4, ease: 3 },
    livery: '#3a4854',
    accent: '#d8d2c4',
    callsign: 'Osprey two one',
    shape: {
      ...TRAINER_SHAPE,
      scale: 1.28,
      bodyLength: 1.28,
      bodyRadius: 0.98,
      halfSpan: 4.3,
      rootChord: 2.3,
      tipChord: 1.0,
      sweep: 1.0,
      dihedral: 0.18,
      wingY: 0.55, // shoulder wing
      wingZ: -0.3,
      wingRootX: 0.55,
      struts: false,
      retractable: true,
      hSpan: 1.9,
      hRootChord: 1.15,
      hZ: 3.0,
      finHeight: 1.7,
      finRootChord: 1.6,
      finSweep: 0.9,
      finZ: 2.4,
      main: { x: 1.35, y: -1.5, z: 0.55 },
      nose: { x: 0, y: -1.45, z: -1.45 },
      wheelR: { nose: 0.3, main: 0.34 },
      gearStiffness: 2.6, // the whole point of a naval undercarriage
      hook: true,
      power: { kind: 'jet', count: 1, x: 0, y: -0.12, z: 2.95, radius: 0.66, length: 1.6 },
      canopy: 'bubble',
      eye: [0, 0.38, -0.55],
    },
    aero: {
      ...TRAINER_AERO,
      // The one that is supposed to land shorter than anything else, so it
      // gets the wing to do it: at the old loading it needed 20 degrees of
      // alpha to unstick, which is both past its stalling angle and past the
      // angle at which the tail hits the ground.
      mass: 8800,
      wingArea: 40,
      wingSpan: 13.2,
      chord: 2.8,
      Ixx: 34000,
      Iyy: 74000,
      Izz: 11000,
      CL0: 0.40, // big high-lift devices
      CLa: 4.6,
      alphaStall: 0.35,
      CD0: 0.030,
      k: 0.076,
      CYb: -0.34,
      Cmalpha: -0.95,
      Cmq: -17.0,
      Cmde: -0.95,
      Clb: -0.10,
      Clp: -0.50,
      Clda: 0.105,
      Cnb: 0.095,
      Cnr: -0.14,
      Cndr: 0.011,
      thrustMax: 52000,
      fuelCapacity: 2600,
      fuelBurnMax: 0.58,
      gearDragArea: 1.4,
      maxGearSpeed: 115,
      vne: 220,
    },
  },

  /* ------------------------------------------------------------------ *
   * The storm penetrator.
   *
   * Built on the real hurricane-hunter idea: a heavy four-engine turboprop
   * with a spar strong enough to be flown deliberately into weather that
   * would take anything else apart. `stormProof` means exactly one thing —
   * the airframe does not fail from tornado loads. It does not mean the
   * tornado ignores it.
   *
   * That distinction is the whole point of the aeroplane. The wind field is
   * unchanged, and because this thing is big and slow it gets thrown about
   * *harder* than the trainer would: more surface for the gust to push on and
   * far more inertia to stop once it is moving. So you survive the core, and
   * you will not enjoy it.
   * ------------------------------------------------------------------ */
  {
    id: 'tempest',
    name: 'Tempest WR-4',
    class: 'Tourer',
    blurb:
      'A twin-turboprop weather-research aeroplane with a reinforced spar, flown on purpose into the ' +
      'things everyone else flies around. A tornado cannot break it — but it is heavy and slab-sided, ' +
      'so getting close throws you about far worse than it would a light single. Survivable, not comfortable.',
    stats: { speed: 3, handling: 2, ease: 3 },
    livery: '#243a4e',
    accent: '#ff7a1a',
    callsign: 'Tempest research one',
    /** The airframe does not fail from tornado loads. Nothing else changes. */
    stormProof: true,
    shape: {
      ...TRAINER_SHAPE,
      scale: 1.75,
      bodyLength: 1.3,
      bodyRadius: 1.1,
      halfSpan: 6.8,
      rootChord: 2.0,
      tipChord: 1.0,
      sweep: 0.5,
      dihedral: 0.55,
      wingY: 0.62, // high wing, as the survey aeroplanes have
      wingZ: -0.6,
      struts: false,
      retractable: true,
      hSpan: 2.4,
      hRootChord: 1.2,
      hZ: 3.4,
      finHeight: 2.2,
      finRootChord: 1.8,
      finSweep: 1.0,
      finZ: 2.6,
      main: { x: 1.2, y: -1.35, z: 0.8 },
      nose: { x: 0, y: -1.3, z: -1.6 },
      wheelR: { nose: 0.28, main: 0.38 },
      gearStiffness: 1.6,
      /*
       * Two propellers, wing-mounted, in nacelles at x = 2.6.
       *
       * The note that used to sit here claimed the model "draws one or two",
       * and it was wrong: `power.count` was read only by the JET branch, so
       * this twin rendered as a single propeller on the nose and the nacelle
       * fields below were dead data. The claim was checked against jets and
       * generalised to propellers without being tested — which is worse than
       * saying nothing, because it made the bug look like a considered
       * decision. The propeller branch reads `count` now, and this really is
       * a twin.
       */
      power: { kind: 'prop', count: 2, propRadius: 1.45, z: -2.2, x: 2.6, radius: 0.5, length: 1.1 },
      canopy: 'cabin',
      eye: [-0.28, 0.42, -1.1],
    },
    aero: {
      ...TRAINER_AERO,
      mass: 13500,
      wingArea: 74,
      wingSpan: 24.0,
      chord: 3.1,
      Ixx: 170000,
      Iyy: 330000,
      Izz: 130000,
      CL0: 0.26,
      CLa: 5.0,
      alphaStall: 0.29,
      CD0: 0.030,
      k: 0.045,
      CYb: -0.52, // slab-sided: the gust has a lot to push against
      Cmalpha: -1.4,
      Cmq: -26.0,
      Cmde: -0.85,
      Clb: -0.13,
      Clp: -0.60,
      Clda: 0.040, // heavy in roll, so a gust takes a while to undo
      Cnb: 0.12,
      Cnr: -0.18,
      Cndr: 0.012,
      thrustMax: 42000,
      fuelCapacity: 4200,
      fuelBurnMax: 0.5,
      gearDragArea: 2.0,
      maxGearSpeed: 110,
      vne: 175,
    },
  },

  /* ------------------------------------------------------------------ *
   * The flying wing.
   *
   * Asked for as "the B2". It is deliberately not one: an original stealth
   * bomber shape rather than a copy of an aircraft in current service, which
   * keeps this game's everything-here-is-ours licence intact. What makes it
   * interesting to fly is the same thing that makes the real ones interesting
   * — no tail at all. Directional stability comes from the wing alone, so Cnb
   * is tiny and it hunts in yaw unless the damper is doing its job.
   * ------------------------------------------------------------------ */
  {
    id: 'nightjar',
    name: 'Nightjar B-2',
    class: 'Fighter',
    blurb:
      'A flying wing with no tail at all. Enormous range, almost no directional stability, and a yaw '
      + 'damper working quietly the whole time. Smooth hands, or it will wander.',
    stats: { speed: 4, handling: 2, ease: 2 },
    livery: '#2b2f35',
    accent: '#6f7681',
    callsign: 'Nightjar zero two',
    military: true,
    shape: {
      ...TRAINER_SHAPE,
      scale: 1.95,
      bodyLength: 0.72,
      bodyRadius: 0.78,
      halfSpan: 8.6,
      rootChord: 4.4,
      tipChord: 0.9,
      sweep: 3.6,
      dihedral: 0.05,
      wingY: -0.05,
      wingZ: 0.1,
      struts: false,
      retractable: true,
      hSpan: 0.2,
      hRootChord: 0.2,
      hZ: 2.2,
      finHeight: 0.05,
      finRootChord: 0.1,
      finSweep: 0.02,
      finZ: 2.0,
      main: { x: 1.5, y: -1.15, z: 0.7 },
      nose: { x: 0, y: -1.1, z: -1.4 },
      wheelR: { nose: 0.26, main: 0.34 },
      gearStiffness: 1.4,
      power: { kind: 'jet', count: 2, x: 2.2, y: -0.2, z: -0.4, radius: 0.5, length: 1.0 },
      canopy: 'fighter',
      eye: [-0.2, 0.34, -1.0],
    },
    aero: {
      ...TRAINER_AERO,
      mass: 9800,
      wingArea: 96,
      wingSpan: 33.5,
      chord: 3.4,
      Ixx: 120000,
      Iyy: 180000,
      Izz: 260000,
      CL0: 0.14,
      CLa: 4.4,
      alphaStall: 0.24,
      CD0: 0.015,
      k: 0.036,
      CYb: -0.18,
      Cmalpha: -0.7,
      Cmq: -14.0,
      Cmde: -0.7,
      Clb: -0.06,
      Clp: -0.5,
      Clda: 0.055,
      Cnb: 0.022,
      Cnr: -0.05,
      Cndr: 0.006,
      thrustMax: 40000,
      fuelCapacity: 6200,
      fuelBurnMax: 0.4,
      gearDragArea: 1.6,
      maxGearSpeed: 130,
      vne: 235,
    },
  },

  /* ------------------------------------------------------------------ *
   * The helicopter.
   *
   * Asked for as its own game; built as an airframe instead, because the
   * 6-DOF body was already right and the only thing genuinely missing was a
   * thrust vector that points up out of the machine rather than forward out
   * of the nose. Collective is the throttle, cyclic is the stick you already
   * have, and the tail rotor is the rudder.
   *
   * The wing is deliberately tiny with almost no lift curve: this thing must
   * not fly when the rotor stops, and a stub wing generating lift would let it
   * glide, which is the one thing a helicopter must not do.
   * ------------------------------------------------------------------ */
  {
    id: 'harrier',
    name: 'Skyhook H-3',
    class: 'Helicopter',
    blurb:
      'Hovers, which nothing else here does. Collective on Shift and Ctrl, cyclic on the stick, tail rotor '
      + 'on the rudder. It will sit still in the air and it will not glide — those are the same fact.',
    stats: { speed: 2, handling: 3, ease: 2 },
    livery: '#2f4a63',
    accent: '#f0a020',
    callsign: 'Skyhook three',
    shape: {
      ...TRAINER_SHAPE,
      scale: 1.25,
      bodyLength: 1.15,
      bodyRadius: 1.05,
      // A stub wing, because the model needs something to hang the gear from.
      halfSpan: 1.5,
      rootChord: 1.0,
      tipChord: 0.6,
      sweep: 0.1,
      dihedral: 0.05,
      wingY: -0.2,
      wingZ: 0.2,
      struts: false,
      retractable: false,
      hSpan: 1.2,
      hRootChord: 0.6,
      hZ: 3.6,
      finHeight: 1.3,
      finRootChord: 0.9,
      finSweep: 0.3,
      finZ: 3.4,
      main: { x: 1.15, y: -1.35, z: 0.55 },
      nose: { x: 0, y: -1.3, z: -1.0 },
      wheelR: { nose: 0.24, main: 0.28 },
      gearStiffness: 1.1,
      // `rotor` is what switches the flight model over.
      power: { kind: 'prop', count: 1, rotor: true, propRadius: 4.2, z: 0.1, y: 1.6 },
      canopy: 'cabin',
      eye: [-0.22, 0.4, -0.9],
    },
    aero: {
      ...TRAINER_AERO,
      mass: 2200,
      // A token wing area. It must not be able to glide.
      wingArea: 3.0,
      wingSpan: 3.6,
      chord: 0.9,
      Ixx: 4200,
      Iyy: 6000,
      Izz: 3000,
      CL0: 0.0,
      CLa: 0.6,
      alphaStall: 0.6,
      CD0: 0.09,
      k: 0.09,
      CYb: -0.36,
      Cmalpha: -0.45,
      Cmq: -12.0,
      Cmde: -0.62,
      Clb: -0.05,
      Clp: -0.42,
      Clda: 0.065,
      Cnb: 0.045,
      Cnr: -0.09,
      Cndr: 0.022, // a tail rotor has a great deal of yaw authority
      rotorDrag: 260,
      thrustMax: 1,
      fuelCapacity: 420,
      fuelBurnMax: 0.035,
      gearDragArea: 0.2,
      maxGearSpeed: 200,
      vne: 140,
    },
  },
];

export const DEFAULT_AIRCRAFT_ID = 'skylark';

export function getAircraft(id) {
  const found = AIRCRAFT.find((a) => a.id === id);
  if (found) return found;
  /*
   * Falling back to the trainer is right for a stale saved setting, but it
   * must not be silent. A mission asking for an aeroplane that does not exist
   * quietly flew you round an erupting volcano in a Skylark instead of the
   * fighter, and nothing anywhere said so — it simply felt wrong to fly.
   */
  if (id) console.warn(`No aircraft "${id}" — falling back to ${AIRCRAFT[0].id}.`);
  return AIRCRAFT[0];
}

/** The full flight-model spec for one aeroplane. */
export function specFor(id) {
  const t = getAircraft(id);
  return {
    ...t.aero,
    // Whether there is actually a propeller out front. Engine torque, P-factor
    // and the corkscrewing slipstream are all propeller effects — a turbofan
    // has none of them, and applying them anyway rolled the jets off on their
    // own with the stick centred.
    propeller: t.shape.power.kind === 'prop' && !t.shape.power.rotor,
    /*
     * A rotor instead of a wing. The flight model reads this to add thrust
     * along the body's up axis; everything else about the 6-DOF body is
     * unchanged, which is why a helicopter costs one branch rather than a
     * second physics engine.
     */
    rotor: !!t.shape.power.rotor,
    rotorDrag: t.aero.rotorDrag || 0,
    // How much moment the disc makes per unit of stick, as a fraction of the
    // machine's own weight times a lever arm. Tuned by feel, then measured.
    rotorPitchArm: t.aero.rotorPitchArm || 1.1,
    rotorRollArm: t.aero.rotorRollArm || 0.85,
    rotorYawArm: t.aero.rotorYawArm || 0.9,
    // A yaw damper, which is what a real swept-wing jet has and a light single
    // does not. Without one the fighter's Dutch roll sits at a damping ratio
    // of about 0.06 — it wallows from wingtip to wingtip and never settles.
    // This is not a cheat to paper over the aerodynamics; it is the piece of
    // equipment the aerodynamics makes necessary.
    yawDamper: t.shape.power.kind === 'jet',
    ...pointsFor(t.shape, t.aero),
  };
}

/**
 * Speeds worth quoting in the hangar, worked out from the aerodynamics rather
 * than written down beside them — so they cannot be wrong.
 */
export function performanceFor(id) {
  const t = getAircraft(id);
  const a = t.aero;
  const W = a.mass * 9.80665;
  const rho = 1.225;
  const clean = a.CL0 + a.CLa * a.alphaStall;
  const landing = clean + 0.9; // full flap
  const vs = (cl) => Math.sqrt((2 * W) / (rho * a.wingArea * cl));
  const kt = (ms) => Math.round(ms * 1.94384);
  return {
    stallClean: kt(vs(clean)),
    stallLanding: kt(vs(landing)),
    vne: kt(a.vne),
    thrustToWeight: +(a.thrustMax / W).toFixed(2),
    // Still-air endurance at full power, which is the pessimistic case.
    enduranceMin: Math.round(a.fuelCapacity / a.fuelBurnMax / 60),
  };
}
