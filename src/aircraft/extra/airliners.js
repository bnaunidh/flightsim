/**
 * The airliners from the wishlist: "Add Boeing 747", "Add Airbus", and "add 2
 * more airliners" for long-haul flights. Three of them — the 747, the A380 and
 * the A320 — drawn at full size in src/fleet/extra/airliners.js.
 *
 * A FUNCTION, not an array, and it has to be. These entries want to spread
 * TRAINER_SHAPE and TRAINER_AERO from ../types.js, and types.js imports this
 * file — so importing types.js from here is a cycle, and at the moment this
 * module runs those constants are not defined yet. types.js calls TYPES(base)
 * at its own bottom, once they are.
 *
 *   base = { TRAINER_SHAPE, TRAINER_AERO }
 *
 * ONE SET OF MEASUREMENTS, TWO READERS.
 *
 * The flight model does not look at the drawing. It lands on the gear points
 * and crashes on the hard points that pointsFor() in ../types.js works out
 * from `shape`, and those are fixed fractions of `shape.scale`: the belly at
 * 0.82 of it below the centre of gravity, the tail at 0.12 of it below and
 * 3.95 × bodyLength of it behind. Typed in separately, the two would drift
 * apart the first time anybody moved a wheel — so both are derived here from
 * AIRLINER_GEOMETRY, in metres, and the model file imports the same object.
 *
 *   scale      = belly depth / 0.82, so the belly point IS the drawn belly
 *   bodyLength = tail-strike point / (3.95 × scale), so the tail point sits on
 *                the drawn underside of the tail cone
 *   gear       = the drawn tyre contact points, divided by scale
 *   wing tip   = the drawn wing tip, divided by scale
 *
 * The one thing that does not land on the drawing is the nose point, which is
 * pinned by the same fractions at 2.6 × bodyLength forward: it sits inside the
 * forward fuselage rather than at the tip of the radome. It is only ever hit
 * by nosing over, and the nose leg is in the way of that.
 *
 * THE HONEST PART. The real aeroplanes weigh 78, 397 and 575 tonnes and need
 * two to three kilometres of runway. The Kestrel strip is 1,100 m and the
 * class starts there, so these fly as a lightly loaded version of themselves:
 * the real span, chord, length and inertia per kilogram, with the wing loading
 * of the Meridian (about 200 kg/m² rather than 600-700) and flaps that lift
 * more. Heavy and slow to answer the controls — they take longer to roll,
 * longer to pitch and much longer to stop — but not impossible where you start.
 *
 * `mass` is the number the flight model divides by, not the brochure weight.
 * The undercarriage model caps every leg at 160 kN (physics.js), so a
 * 400-tonne aeroplane would sit on its belly; what matters to how it flies is
 * the RATIO of thrust, wing area and inertia to mass, and those are kept.
 * Inertias are mass × radius of gyration², with radii from published data for
 * the 747 (NASA CR-2144) scaled by span and length for the other two.
 */

/*
 * Everything in metres, in the aeroplane's own frame: origin at the centre of
 * gravity, -Z forward, +Y up, fuselage centreline at y = 0.
 *
 *   belly      depth of the fuselage underside below the centreline
 *   ground     tyre contact height (negative: below the centreline)
 *   tailStrike the point on the drawn underside of the tail cone that meets
 *              the runway first when the nose is raised — see the model file,
 *              which measures its own strike angle against this
 *   tip        the wing tip (the root of the winglet, fence or sharklet)
 */
/** Starboard engines, mirrored to port: [port inboard, port outboard, starboard inboard, ...]. */
const pair = (list) => [...list.map((e) => ({ ...e, x: -e.x })), ...list];

export const AIRLINER_GEOMETRY = {
  a320: {
    length: 37.57, span: 35.8, noseZ: -16.8,
    belly: 2.07, ground: -3.9,
    nose: { z: -11.6, r: 0.39 },
    main: { x: 3.795, z: 1.0, r: 0.585 },
    tailStrike: { z: 15.68 },
    tip: { x: 17.05, y: -0.1 },
    wingZ: -3.72,
    engines: pair([{ x: 5.75, y: -2.35, z: -2.4, r: 1.05, length: 3.4 }]),
    eye: [-0.52, 0.6, -13.35],
  },
  b747: {
    length: 70.6, span: 64.44, noseZ: -31.1,
    belly: 3.3, ground: -5.9,
    nose: { z: -23.4, r: 0.58 },
    main: { x: 5.5, z: 2.4, r: 0.62 },
    tailStrike: { z: 26.3 },
    tip: { x: 31.35, y: 1.35 },
    wingZ: -12.57,
    engines: pair([
      { x: 11.9, y: -3.05, z: -5.9, r: 1.35, length: 4.6 },
      { x: 21.15, y: -1.74, z: 1.82, r: 1.35, length: 4.6 },
    ]),
    eye: [-0.55, 3.55, -27.4],
  },
  a380: {
    length: 72.7, span: 79.75, noseZ: -33.6,
    belly: 4.2, ground: -6.8,
    nose: { z: -27.8, r: 0.64 },
    main: { x: 7.17, z: 2.4, r: 0.7 },
    tailStrike: { z: 29.05 },
    tip: { x: 39.77, y: 1.25 },
    wingZ: -12.99,
    engines: pair([
      { x: 14.6, y: -3.75, z: -6.63, r: 1.7, length: 5.6 },
      { x: 25.7, y: -2.44, z: 0.86, r: 1.7, length: 5.6 },
    ]),
    eye: [-0.6, 0.9, -30.9],
  },
};

/**
 * The drawn aeroplane from above, for whatever parks or pushes it without
 * building the model (the airfield: which stand it fits, and where its nose
 * and tail are). The shape cannot say: its nose point is pinned inside the
 * fuselage (above), 6.5 m short of an A320's radome and 14 m short of a 747's.
 */
function planFrom(g) {
  return { nose: g.noseZ, tail: +(g.noseZ + g.length).toFixed(2), span: g.span };
}

/** The physics shape, worked out from the metres above. */
function shapeFrom(g, base, extra) {
  const s = g.belly / 0.82;
  const bodyLength = g.tailStrike.z / (3.95 * s);
  // z-like numbers in the shape are multiplied by scale AND bodyLength by the
  // hangar's plan view, x-like numbers by scale only.
  const zs = s * bodyLength;
  const wingRoot = extra.wingRootX;
  // The hangar's plan view and the fallback model read one engine and mirror
  // it; give them the starboard inboard one.
  const E = g.engines.find((e) => e.x > 0);
  return {
    ...base.TRAINER_SHAPE,
    scale: +s.toFixed(4),
    bodyLength: +bodyLength.toFixed(4),
    // The legacy model's lathe is 0.78 wide at its fattest; only the fallback
    // draws from this.
    bodyRadius: +(extra.radius / s / 0.78).toFixed(3),
    wingRootX: +(wingRoot / s).toFixed(4),
    halfSpan: +((g.tip.x - wingRoot) / s).toFixed(4),
    rootChord: +(extra.rootChord / zs).toFixed(3),
    tipChord: +(extra.tipChord / zs).toFixed(3),
    sweep: +(extra.sweep / zs).toFixed(3),
    wingY: +(extra.rootY / s).toFixed(4),
    dihedral: +((g.tip.y - extra.rootY) / s).toFixed(4),
    wingZ: +((g.wingZ + extra.rootChord * 0.3) / zs).toFixed(3),
    struts: false,
    retractable: true,
    hSpan: +(extra.hSpan / s).toFixed(3),
    hRootChord: +(extra.hRootChord / zs).toFixed(3),
    hZ: +(extra.hZ / zs).toFixed(3),
    finHeight: +(extra.finHeight / s).toFixed(3),
    finRootChord: +(extra.finRootChord / zs).toFixed(3),
    finSweep: +(extra.finSweep / zs).toFixed(3),
    /*
     * For the hangar card only. Its plan view put every nose at a fixed -2.9
     * units and mirrored one engine, so the 747 and the A380 were drawn as
     * short-nosed twins. These are the real nose, tail and all four engines,
     * in the card's own units (x by scale, z by scale × bodyLength).
     */
    plan: {
      noseZ: +(g.noseZ / zs).toFixed(3),
      tailZ: +((g.noseZ + g.length) / zs).toFixed(3),
      halfWidth: +(extra.radius / s).toFixed(3),
      engines: g.engines.map((e) => ({ x: +(e.x / s).toFixed(3), z: +(e.z / zs).toFixed(3) })),
    },
    finZ: +(extra.finZ / zs).toFixed(3),
    nose: { x: 0, y: +(g.ground / s).toFixed(4), z: +(g.nose.z / s).toFixed(4) },
    main: { x: +(g.main.x / s).toFixed(4), y: +(g.ground / s).toFixed(4), z: +(g.main.z / s).toFixed(4) },
    wheelR: { nose: +(g.nose.r / s).toFixed(4), main: +(g.main.r / s).toFixed(4) },
    gearStiffness: extra.gearStiffness,
    power: {
      kind: 'jet',
      count: g.engines.length,
      x: +(E.x / s).toFixed(3),
      y: +(E.y / s).toFixed(3),
      z: +(E.z / s).toFixed(3),
      radius: +(E.r / s).toFixed(3),
      length: +(E.length / s).toFixed(3),
    },
    canopy: 'airliner',
    eye: g.eye.map((v) => +(v / s).toFixed(3)),
  };
}

/**
 * Mass × radius of gyration squared, in this flight model's axis naming:
 * Ixx is PITCH, Iyy is YAW, Izz is ROLL (see the integrator in physics.js).
 *
 * The radii are fractions of the aeroplane's own length and span: 0.13 of
 * the span in roll and 0.14 of the length in pitch, with yaw the two added in
 * quadrature. NASA CR-2144 gives the 747 0.133 and 0.152; pitch is taken a
 * little tighter than that on purpose. At 0.152 the simplified mode's
 * height-hold (physics.js, elevator -= vs × 0.085 + q × 0.38, fixed gains)
 * drove the A320 into a growing pitch oscillation above 160 kt — measured
 * 40-65 deg/s of pitch rate hands-off at 200-320 kt, and the 747 the same
 * above 240 kt. At 0.14, with Cmq -30, all three hold within 0.4 deg/s from
 * 120 to 320 kt, which is where the Meridian already sat.
 */
function inertias(mass, g) {
  const r = (v) => Math.round((mass * v * v) / 1000) * 1000;
  const pitch = 0.14 * g.length;
  const roll = 0.13 * g.span;
  return { Ixx: r(pitch), Iyy: r(Math.hypot(pitch, roll)), Izz: r(roll) };
}

/*
 * THE AERO NUMBERS, and what they were measured to do. All three were flown
 * on physics.js in node by tests/features/airliners.mjs, the playtest's own
 * take-off: full power, flaps 2, 0.45 back stick at 1.25 × the hangar's
 * approach speed, then 10 degrees nose up. Distances from brake release at
 * the spawn point (x = -470; the runway ends 1,020 m ahead of it):
 *
 *           lift-off        15 m up   realistic   flaps 1   landing from 15 m
 *   A320    427 m  91 kt    689 m     733 m       840 m     803 m (roll 352)
 *   747     530 m  99 kt    801 m     845 m       961 m     864 m (roll 405)
 *   A380    499 m  96 kt    775 m     822 m       923 m     821 m (roll 380)
 *
 * The Meridian, for comparison, needs 931 m to 15 m in the same test, so the
 * jumbos use less of the strip than the regional jet does; they get there by
 * having the wing loading of the Meridian and a wing four to six times the
 * span, which is honest about what the lift is for. With the flaps UP only
 * the A320 gets to 15 m (1,041 m, just past the end); the 747 and A380 run
 * off the end into the rising ground — and so do the Meridian and the
 * Tempest. So src/features/airliners.js sets take-off flap (1 on the A320,
 * 2 on the jumbos) when a flight starts on the ground, and says so.
 *
 * A child's take-off is not the playtest's: it is full power and the stick
 * held right back from the moment the wheels roll. Measured in simplified
 * mode, that gets all three to 15 m at 741, 860 and 820 m with the flaps up
 * and 639, 649 and 618 m with the take-off flap, the tail never closer than
 * 1.2 m to the runway (0.67 m when the same full pull comes suddenly at
 * 80 kt instead).
 *
 * alphaStall 0.22, CL0 0.40. The simplified mode (the default) stops pulling
 * at alphaStall - 0.045, and on the ground the attitude IS the angle of
 * attack. At 0.26, a child hauling the stick fully back at 60 kt rotated the
 * 747 to 11.7 degrees on the runway, struck the tail (then at 11.8) and
 * crashed before it flew. The gear is now 0.5 m longer, which moves the
 * 747's strike to 12.8 degrees, and at 0.22 the guard stops the rotation near
 * 10, under all three strike angles (12.8-13.8, measured on the drawings);
 * the 0.10 of extra lift at zero alpha — slats and flaps — gives back what
 * the lower stall angle took away. Full-back yanks at 40, 60 and 80 kt, flaps
 * 0 or 2, now all fly in simplified mode with at least 0.7 m of tail
 * clearance. In realistic mode there is no guard and a yank strikes the
 * tail, as it would.
 *
 * Clda 0.065, 0.10, 0.11. They were 0.06, 0.07 and 0.075, and the playtest
 * failed the 747 and the A380 for "will not hold a 30 degree bank": its turn
 * (aileron capped at 0.35, 12 s, just after take-off at 110-115 kt) reached
 * 21.3 and 20.6 degrees against a pass mark of 22; the A320 scraped it at
 * 23.4 and the Meridian gets 24.1. Now 23.8, 23.7 and 23.6. At 180 kt that
 * is 28, 24 and 21 deg/s of roll at full aileron, against the Meridian's 26:
 * the jumbos are still the slowest things here to bank, just not so slow
 * that a gentle turn runs out of time. Full back stick peaks at 36, 22 and
 * 21 deg/s of pitch against the Meridian's 45.
 */
export function TYPES(base) {
  const G = AIRLINER_GEOMETRY;
  return [
    /* ---------------------------------------------------------------- *
     * Airbus A320: the short-haul twin most of the class has actually
     * sat in. The gentlest of the three, and the one to learn on.
     * ---------------------------------------------------------------- */
    {
      id: 'a320',
      name: 'Airbus A320',
      class: 'Airliner',
      category: 'airliner',
      military: false,
      longHaul: false,
      blurb:
        'The short-hop twin you have probably flown on — two engines, six wheels and those upturned ' +
        'sharklet wing tips. Lighter on its feet than the jumbos, but still an airliner: plan the turn ' +
        'before you want it.',
      stats: { speed: 3, handling: 2, ease: 3 },
      livery: '#f5f7f9',
      accent: '#c4122f',
      callsign: 'Island three two zero',
      plan: planFrom(G.a320),
      shape: shapeFrom(G.a320, base, {
        radius: 1.975, wingRootX: 1.35, rootChord: 4.82, tipChord: 1.45, sweep: 8.0, rootY: -1.45,
        hSpan: 6.2, hRootChord: 3.7, hZ: 14.4, finHeight: 6.05, finRootChord: 6.0, finSweep: 4.3, finZ: 9.3,
        gearStiffness: 1.7,
      }),
      aero: {
        ...base.TRAINER_AERO,
        mass: 18000,
        wingArea: 100,
        wingSpan: 35.8,
        chord: 4.19,
        ...inertias(18000, G.a320),
        CL0: 0.4,
        CLa: 5.0,
        alphaStall: 0.22,
        CD0: 0.022,
        k: 0.042,
        CYb: -0.45,
        Cmalpha: -1.2,
        Cmq: -30.0,
        Cmde: -1.0,
        Clb: -0.12,
        Clp: -0.6,
        Clda: 0.065,
        Cnb: 0.11,
        Cnr: -0.16,
        Cndr: 0.011,
        thrustMax: 63500,
        fuelCapacity: 6000,
        fuelBurnMax: 0.6,
        gearDragArea: 2.6,
        maxGearSpeed: 115,
        vne: 175,
      },
    },

    /* ---------------------------------------------------------------- *
     * Boeing 747-400: four engines, the hump, and the long way round.
     * ---------------------------------------------------------------- */
    {
      id: 'b747',
      name: 'Boeing 747',
      class: 'Airliner',
      category: 'airliner',
      military: false,
      longHaul: true,
      blurb:
        'The Jumbo. Four engines, eighteen wheels and the famous hump, with the flight deck up on the ' +
        'top floor. It rolls a long way before it flies and takes its time answering the stick — ' +
        'think ahead of it and it will carry you across an ocean.',
      stats: { speed: 4, handling: 1, ease: 2 },
      livery: '#f4f6f8',
      accent: '#123a78',
      callsign: 'Island seven four seven heavy',
      plan: planFrom(G.b747),
      shape: shapeFrom(G.b747, base, {
        radius: 3.25, wingRootX: 2.45, rootChord: 13.78, tipChord: 3.6, sweep: 24.25, rootY: -2.1,
        hSpan: 11.1, hRootChord: 7.4, hZ: 28.8, finHeight: 10.4, finRootChord: 14.0, finSweep: 11.2, finZ: 23.0,
        gearStiffness: 1.7,
      }),
      aero: {
        ...base.TRAINER_AERO,
        mass: 24000,
        wingArea: 117,
        wingSpan: 64.4,
        chord: 8.3,
        ...inertias(24000, G.b747),
        CL0: 0.4,
        CLa: 5.0,
        alphaStall: 0.22,
        CD0: 0.021,
        k: 0.04,
        CYb: -0.45,
        Cmalpha: -1.2,
        Cmq: -30.0,
        Cmde: -1.0,
        Clb: -0.12,
        Clp: -0.6,
        Clda: 0.1,
        Cnb: 0.11,
        Cnr: -0.16,
        Cndr: 0.011,
        thrustMax: 85000,
        fuelCapacity: 20000,
        fuelBurnMax: 0.9,
        gearDragArea: 3.2,
        maxGearSpeed: 120,
        vne: 190,
      },
    },

    /* ---------------------------------------------------------------- *
     * Airbus A380: two full decks, nose to tail, and a wing you could
     * park the A320 on.
     * ---------------------------------------------------------------- */
    {
      id: 'a380',
      name: 'Airbus A380',
      class: 'Airliner',
      category: 'airliner',
      military: false,
      longHaul: true,
      blurb:
        'The biggest airliner there is: two full decks of windows, four engines, twenty-two wheels and ' +
        'a wing eighty metres across. Surprisingly gentle once it is flying — the hard part is that ' +
        'everything, especially stopping, happens slowly.',
      stats: { speed: 4, handling: 1, ease: 2 },
      livery: '#f6f7f9',
      accent: '#0d6f78',
      callsign: 'Island three eight zero heavy',
      plan: planFrom(G.a380),
      shape: shapeFrom(G.a380, base, {
        radius: 3.57, wingRootX: 2.95, rootChord: 16.2, tipChord: 4.0, sweep: 24.84, rootY: -2.3,
        hSpan: 15.2, hRootChord: 9.4, hZ: 26.3, finHeight: 14.3, finRootChord: 17.0, finSweep: 12.0, finZ: 20.5,
        gearStiffness: 1.7,
      }),
      aero: {
        ...base.TRAINER_AERO,
        mass: 27000,
        wingArea: 142,
        wingSpan: 79.75,
        chord: 12.0,
        ...inertias(27000, G.a380),
        CL0: 0.4,
        CLa: 5.0,
        alphaStall: 0.22,
        CD0: 0.021,
        k: 0.038,
        CYb: -0.45,
        Cmalpha: -1.2,
        Cmq: -30.0,
        Cmde: -1.0,
        Clb: -0.12,
        Clp: -0.6,
        Clda: 0.11,
        Cnb: 0.11,
        Cnr: -0.16,
        Cndr: 0.011,
        thrustMax: 95000,
        fuelCapacity: 26000,
        fuelBurnMax: 1.0,
        gearDragArea: 3.6,
        maxGearSpeed: 120,
        vne: 185,
      },
    },
  ];
}
