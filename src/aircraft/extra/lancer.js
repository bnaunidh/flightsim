/**
 * The B-1B Lancer (owner, 2026-10-16: "also note: add b1 lancers"): swing
 * wings that sweep back at speed — and that the pilot can sweep — four
 * afterburning engines, a low-level dash, and flight faster than sound high
 * up. Drawn in src/fleet/extra/lancer.js; the wing and the afterburners are
 * flown by src/aircraft/swing-wing.js, which src/features/swing-wing.js puts
 * on the aeroplane in the game (keys, the wing panel on the HUD, the model).
 *
 * This file is the measurements and the numbers, with no THREE in it: the
 * roster (types.js) imports it at boot and in node.
 *
 * THE REAL ONE, from the published figures: 44.5 m long, 41.67 m across with
 * the wings forward at 15 degrees and 23.84 m with them back at 67.5, 10.4 m
 * tall, 181 m² of wing, four 137 kN afterburning turbofans, Mach 1.25 at
 * altitude and about Mach 0.92 at sea level, a twin-wheel nose leg and two
 * four-wheel main bogies 4.42 m apart on a 17.5 m wheelbase.
 *
 * THE GAME ONE flies as a lightly loaded version of itself, the way every
 * jet here does (./jets.js has the reasoning): 24 t on 120 m² of game wing
 * (the airliners' 200 kg/m²), thrust for 0.4 of its weight, so it uses the
 * 1,100 m Kestrel strip with the wings forward and the flaps down — which is
 * exactly what the swing wing is FOR. Swept back it needs far more runway and
 * a much faster approach, and the flaps will not come down at all.
 *
 * WHAT THE OTHER FILES READ OFF THE ENTRY (beyond the usual roster fields):
 *   swingWing   src/features/swing-wing.js gives a type with this the sweep
 *               keys, the auto schedule and the afterburners (LANCER_WING here)
 *   unarmed     features/carrier/who.js: military, behind the passcode and in
 *               the hangar's Military shelf, but no guns, no heat-seekers, no
 *               flares and no tail hook; heatseek/rules.js never locks it
 *   carrier     false: world/spawns.js never starts it on the carrier's deck
 *               (it is 42 m across and lands at 130 kt; no hook could hold it)
 *   price, why  the hangar's sale row (src/features/swing-wing.js adds it)
 *   takeoffFlaps  the flap set for a flight that starts on the ground
 */
import { station, strikeAngle } from './jet-shapes.js';

const D2R = Math.PI / 180;
const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/* ------------------------------------------------------------------ *
 * The swing wing
 * ------------------------------------------------------------------ */

/**
 * The outer wing panel, in metres in the aeroplane's frame (origin at the
 * centre of gravity, -Z forward, +X starboard), drawn at its FORWARD stop.
 * It turns about a vertical pin in the fixed glove at `pivot`. The pin's
 * place and the panel's size are solved from the two published spans and the
 * two leading-edge sweeps: tip x = 20.835 at 15 degrees and 11.92 at 67.5.
 */
export const LANCER_WING = Object.freeze({
  pivot: Object.freeze({ x: 5.6, y: -0.12, z: -2.0 }),
  // The panel's root leading edge is this far ahead of the pin.
  rootAhead: 0.358,
  span: 15.235, // across, root to tip, at the forward stop
  rootChord: 5.6,
  tipChord: 1.75,
  thickness: 0.42,
  tipThickness: 0.1,
  dihedral: 0.0,
  /** The stops and the four notches the real one is flown at. */
  min: 15,
  max: 67.5,
  detents: Object.freeze([15, 25, 45, 67.5]),
  /** How fast it moves, degrees a second: 9 s end to end. */
  rate: 6,
});

/** A point of the starboard panel (relative to the pin, at the forward stop) with the wing at `deg`. */
export function panelPoint(dx, dz, deg) {
  const d = (deg - LANCER_WING.min) * D2R;
  const c = Math.cos(d);
  const s = Math.sin(d);
  return { x: LANCER_WING.pivot.x + dx * c - dz * s, z: LANCER_WING.pivot.z + dx * s + dz * c };
}

/** The starboard tip's leading edge with the wing at `deg`. */
export function tipAt(deg) {
  const W = LANCER_WING;
  const dz = -W.rootAhead + W.span * Math.tan(W.min * D2R);
  return panelPoint(W.span, dz, deg);
}

/** Tip-to-tip, metres, with the wing at `deg`. */
export function spanAt(deg) {
  return r3(2 * tipAt(deg).x);
}

/* ------------------------------------------------------------------ *
 * The fuselage and the rest of the drawing, in metres
 * ------------------------------------------------------------------ */

/*
 * A blended body: a long, pointed, slightly drooping radome, the flight deck
 * on the upper slope behind it, then a body that widens into the fixed glove
 * and narrows again past the engines to an upswept tail cone. The underside
 * sweeps up hard behind the main wheels, so a rotation to 12 degrees clears.
 */
const STATIONS = [
  station(-25.0, -0.35, -0.35, 0.0, -0.35),
  station(-24.6, -0.12, -0.58, 0.22, -0.35),
  station(-23.8, 0.12, -0.85, 0.48, -0.36),
  station(-22.6, 0.42, -1.12, 0.78, -0.36),
  station(-21.2, 0.7, -1.32, 1.02, -0.34),
  station(-20.0, 0.98, -1.44, 1.16, -0.3),
  station(-19.0, 1.3, -1.5, 1.24, -0.22),
  station(-18.0, 1.52, -1.54, 1.28, -0.12),
  station(-16.5, 1.62, -1.58, 1.32, -0.05),
  station(-14.0, 1.64, -1.62, 1.4, 0, 2.2, 2.4),
  station(-11.0, 1.62, -1.66, 1.55, -0.05, 2.2, 2.6),
  station(-7.0, 1.58, -1.7, 1.75, -0.1, 2.2, 2.8),
  station(-2.0, 1.55, -1.72, 1.9, -0.12, 2.2, 2.8),
  station(3.0, 1.5, -1.68, 1.85, -0.1, 2.2, 2.8),
  station(8.0, 1.4, -1.42, 1.55, -0.02, 2.2, 2.6),
  station(12.0, 1.28, -0.98, 1.2, 0.12),
  station(15.5, 1.14, -0.22, 0.85, 0.32),
  station(18.0, 0.98, 0.28, 0.48, 0.55),
  station(19.5, 0.8, 0.58, 0.08, 0.66),
];

/** Everything the model and the flight model share, in metres. */
export const LANCER_GEOMETRY = (() => {
  const ground = -3.55; // tyre contact below the centreline
  const main = { x: 2.21, z: 1.0, r: 0.584 }; // half of the 4.42 m track
  const nose = { z: -16.5, r: 0.445 };
  // Engines, starboard pair (mirrored): two to a nacelle under the glove.
  const engines = [
    { x: 3.25, y: -1.62, z: 3.6, r: 0.66, length: 9.8 },
    { x: 4.65, y: -1.62, z: 3.6, r: 0.66, length: 9.8 },
  ];
  const nacelle = { x0: 2.48, x1: 5.42, top: -0.38, bottomFront: -2.56, bottomAft: -1.82, z0: -1.4, z1: 8.4 };
  const fin = { rootZ: 9.0, rootY: 1.2, height: 5.85, rootChord: 9.5, tipChord: 3.0, sweep: 5.8 };
  const tail = { rootZ: 11.8, rootY: 0.95, span: 6.85, rootChord: 5.2, tipChord: 1.7, sweep: 5.35, dihedral: 0.25 };
  // The nacelles' aft lower corners and the stabilator tips are the other places a tail strike could start.
  const extra = [
    [nacelle.z1, nacelle.bottomAft],
    [tail.rootZ + tail.sweep + tail.tipChord, tail.rootY + tail.dihedral - 0.1],
  ];
  const strike = strikeAngle(STATIONS, main.z, ground, { extraPoints: extra });
  return Object.freeze({
    length: 44.5,
    noseZ: -25.0,
    tailZ: 19.5,
    belly: 1.72,
    ground,
    main,
    nose,
    engines: [...engines.map((e) => ({ ...e, x: -e.x })), ...engines],
    nacelle,
    fin,
    tail,
    // The fixed glove, starboard: the root along the body and the outer edge at the pin.
    glove: { rootX: 1.45, rootLe: -12.5, rootTe: 7.6, outX: 5.85, outLe: -2.95, outTe: 4.1, y: -0.12, rootThick: 0.95, outThick: 0.6 },
    eye: [-0.55, 0.92, -18.15],
    stations: STATIONS,
    strike,
    spanSpread: spanAt(LANCER_WING.min),
    spanSwept: spanAt(LANCER_WING.max),
  });
})();

/* ------------------------------------------------------------------ *
 * The flight model of the swing wing
 * ------------------------------------------------------------------ */

/**
 * What sweeping the wing does to the numbers the flight model flies, as
 * multiples of (or additions to) the wing-forward ones, at the four notches;
 * between them it is a straight line. Each row is the honest direction of
 * the change and roughly its size:
 *
 *   CLa, CL0   a swept, stubby wing makes less lift per degree and has less
 *              camber (no slats, no flaps): the swept stall is 107 kt clean
 *              against 93 kt with the wings forward, and 72 kt with flaps
 *   stall      ...but it stalls at a larger angle, as low-aspect wings do
 *   k          drag due to lift goes as 1 / aspect ratio: x (b15 / b)², ~3x
 *   CD0        a little less skin facing the air, subsonic
 *   Cmalpha    the lift moves aft with the panels: stiffer in pitch
 *   Clda, Izz  less roll power from the shorter wing, and less roll inertia
 *   mdd, wave  the drag-divergence Mach number, and the height of the
 *              transonic drag rise above it — the reason for the whole thing:
 *              wings forward it is a wall at Mach 0.75, wings back it is a
 *              step at Mach 1 that four afterburners can climb
 */
const ROWS = {
  CLa: [1.0, 0.96, 0.82, 0.6],
  CL0: [1.0, 0.92, 0.7, 0.5],
  stall: [0, 0.01, 0.04, 0.08],
  CD0: [1.0, 0.97, 0.92, 0.88],
  Cmalpha: [1.0, 1.05, 1.2, 1.4],
  Clda: [1.0, 1.0, 0.9, 0.75],
  Izz: [1.0, 0.95, 0.8, 0.6],
  mdd: [0.72, 0.78, 0.87, 0.925],
  wave: [0.075, 0.06, 0.032, 0.0135],
};

function row(name, deg) {
  const D = LANCER_WING.detents;
  const r = ROWS[name];
  const d = clamp(deg, D[0], D[D.length - 1]);
  let i = 0;
  while (i < D.length - 2 && d > D[i + 1]) i++;
  return lerp(r[i], r[i + 1], (d - D[i]) / (D[i + 1] - D[i]));
}

/**
 * The transonic and supersonic drag added at Mach `M` with the wing at
 * `deg`, as a drag coefficient: nothing until 0.08 below the drag-divergence
 * Mach number, rising smoothly to its peak just past Mach 1, easing to two
 * thirds of it by 1.2 — and then the airframe's own limit: the fixed inlets
 * choke past Mach 1.22, and the drag climbs steeply, so 1.25 is as fast as it
 * goes, as on the real one.
 */
export function waveDrag(M, deg) {
  const mdd = row('mdd', deg);
  const peak = row('wave', deg);
  const m0 = mdd - 0.08;
  const mPeak = 1.04;
  if (!(M > m0)) return 0;
  let cd = M <= mPeak ? peak * smooth((M - m0) / (mPeak - m0)) : peak * (1 - (1 / 3) * smooth((M - mPeak) / 0.16));
  if (M > 1.22) cd += 1.6 * (M - 1.22) * (M - 1.22) + 0.04 * (M - 1.22);
  return cd;
}

/**
 * The flight-model numbers with the wing at `deg`, from `base` — the
 * wing-forward set the roster carries. Only the fields that change.
 */
export function sweptNumbers(base, deg) {
  const span = spanAt(deg);
  const ratio = LANCER_GEOMETRY.spanSpread / span;
  return {
    wingSpan: span,
    CLa: base.CLa * row('CLa', deg),
    CL0: base.CL0 * row('CL0', deg),
    alphaStall: base.alphaStall + row('stall', deg),
    k: base.k * ratio * ratio,
    CD0: base.CD0 * row('CD0', deg),
    Cmalpha: base.Cmalpha * row('Cmalpha', deg),
    Clda: base.Clda * row('Clda', deg),
    Izz: base.Izz * row('Izz', deg),
  };
}

/* ------------------------------------------------------------------ *
 * The air and the engines
 * ------------------------------------------------------------------ */

/**
 * The speed of sound, m/s, at `alt` metres in the standard atmosphere:
 * a = √(γRT), with the temperature falling 6.5 K a kilometre to 216.65 K at
 * 11 km and constant above (the game's sky stops at 70,000 ft, 21.3 km).
 * 340 m/s at sea level, 295 m/s from 36,000 ft up.
 */
export function speedOfSound(alt) {
  const h = Math.max(0, alt || 0);
  const T = h < 11000 ? 288.15 - 0.0065 * h : 216.65;
  return Math.sqrt(1.4 * 287.053 * T);
}

/** Mach number of a true airspeed (m/s) at a height (m). */
export function machOf(tas, alt) {
  return (tas || 0) / speedOfSound(alt);
}

/**
 * The afterburners.
 *
 * Every jet in this game shares one thrust law (physics.js): full thrust
 * times the air's density ratio times a propeller-like efficiency that falls
 * with forward speed, to an eighth of it by 340 kt. That is what keeps them
 * all under their red lines, and it is right for the dry engines here too.
 * The throttle's last 15% lights the burners, and with them the Lancer's
 * thrust follows a jet's law instead: falling with height only as the 0.75
 * power of the density (an engine breathes better than a wing lifts, high
 * up) and RISING with Mach number, as an afterburning engine's does when the
 * intake rams air into it — 1 + 0.6 M², 1.86 at Mach 1.2.
 *
 * Returns the multiple of SPEC.thrustMax that gives that thrust through the
 * physics' own law at forward airspeed `u` (m/s): the burner's share of the
 * new law divided by the old law's efficiency, so the old law's numbers are
 * cancelled exactly and nothing in physics.js is touched.
 */
export const BURNER = Object.freeze({ from: 0.85, ram: 0.6, lapse: 0.75, fuel: 2.5 });

export function burnerShare(throttle) {
  return clamp((throttle - BURNER.from) / (1 - BURNER.from), 0, 1);
}

/**
 * IDLE. The shared law gives every jet 18% of its full thrust at idle (rpm
 * 0.18), and the Lancer's full thrust is its afterburning thrust: 19 kN at
 * idle, which no brakes in the game could hold — measured, it crept at 2.8
 * m/s on full brakes and took three minutes to stop after a landing. A real
 * turbofan's thrust goes nearer the square of its spool speed, and the
 * B-1B's idle is a few per cent of its burner thrust; so near idle the
 * thrust is brought down to a third, back to the shared law by 35% throttle
 * (the approach is flown at 30-45%).
 */
export const IDLE = Object.freeze({ share: 0.35, until: 0.35 });

export function thrustScale({ throttle, u, M, sigma }) {
  const idle = IDLE.share + (1 - IDLE.share) * smooth(throttle / IDLE.until);
  const ab = burnerShare(throttle);
  if (!(ab > 0)) return idle;
  const propEff = clamp(1 - 0.5 * (Math.max(0, u) / 100), 0.12, 1);
  const s = clamp(sigma, 0.02, 1.2);
  const jet = Math.pow(s, BURNER.lapse - 1) * (1 + BURNER.ram * M * M);
  return (1 - ab) + ab * (jet / propEff);
}

/* ------------------------------------------------------------------ *
 * The automatic schedule
 * ------------------------------------------------------------------ */

/**
 * Where the wing goes when it is left to itself: forward for take-off and
 * landing (and whenever the flaps or the wheels are down), 25 degrees for
 * the climb and cruise, 45 at high subsonic speed, all the way back for the
 * dash and above Mach 0.9. By indicated speed down low (where the air is
 * thick and the dash is fast) and by Mach number up high, whichever asks for
 * more sweep — but never more than leaves 40% over the swept wing's stall.
 */
export function autoSweep({ M = 0, iasKt = 0, flaps = 0, gearDown = false }) {
  if (flaps > 0.02 || gearDown) return LANCER_WING.min;
  const byMach = M <= 0.55 ? 15 : M <= 0.65 ? lerp(15, 25, (M - 0.55) / 0.1) : M <= 0.78 ? lerp(25, 45, (M - 0.65) / 0.13) : lerp(45, 67.5, (M - 0.78) / 0.12);
  const byIas = iasKt <= 200 ? 15 : iasKt <= 240 ? lerp(15, 25, (iasKt - 200) / 40) : iasKt <= 380 ? lerp(25, 45, (iasKt - 240) / 140) : lerp(45, 67.5, (iasKt - 380) / 80);
  const want = clamp(Math.max(byMach, byIas), LANCER_WING.min, LANCER_WING.max);
  // The most sweep the speed allows: 1.4 x the swept stall at that sweep, from 15 deg's 93 kt to 67.5's 107.
  const room = iasKt <= 135 ? 15 : iasKt >= 150 ? 67.5 : lerp(15, 67.5, (iasKt - 135) / 15);
  return r3(Math.min(want, room));
}

/* ------------------------------------------------------------------ *
 * The roster entry
 * ------------------------------------------------------------------ */

/**
 * The flight model's shape, in metres at scale 1 like the fighters'
 * (./fighters.js has the contract): what the physics reads is real metres;
 * chords, sweeps and the tail are the hangar card's units (z over
 * bodyLength). `bodyLength` is chosen so the tail point pointsFor() puts at
 * 3.95 x bodyLength sits on the line from the main wheels at the drawn strike
 * angle less a quarter of a degree: the physics strikes a hair first.
 */
function shapeOf(base, G) {
  const W = LANCER_WING;
  const tailPoint = { y: -0.12 };
  const a = (G.strike.deg - 0.25) * D2R;
  const tailZ = G.main.z + (tailPoint.y - G.ground) / Math.tan(a);
  const bodyLength = r3(tailZ / 3.95);
  const z = (v) => r3(v / bodyLength);
  const tip = tipAt(W.min);
  return {
    ...base.TRAINER_SHAPE,
    scale: 1,
    bodyLength,
    bodyRadius: 1.9,
    wingRootX: 0,
    halfSpan: r3(tip.x),
    // The card draws one trapezoid from the centreline: the glove and the panel together.
    rootChord: z(10.5),
    tipChord: z(W.tipChord),
    sweep: z(tip.z + W.tipChord / 2 - 0.5),
    wingY: W.pivot.y,
    dihedral: W.dihedral,
    wingZ: z(0.5),
    struts: false,
    retractable: true,
    hSpan: G.tail.span,
    hRootChord: z(G.tail.rootChord),
    hZ: z(G.tail.rootZ + G.tail.rootChord / 2),
    finHeight: G.fin.height,
    finRootChord: z(G.fin.rootChord),
    finSweep: z(G.fin.sweep),
    finZ: z(G.fin.rootZ + G.fin.rootChord / 2),
    plan: {
      noseZ: z(G.noseZ),
      tailZ: z(G.tailZ),
      halfWidth: 1.9,
      engines: G.engines.map((e) => ({ x: e.x, z: z(e.z) })),
    },
    main: { x: G.main.x, y: G.ground, z: G.main.z },
    nose: { x: 0, y: G.ground, z: G.nose.z },
    wheelR: { nose: G.nose.r, main: G.main.r },
    gearStiffness: 1.5,
    power: { kind: 'jet', count: 4, x: 3.25, y: -1.62, z: 3.6, radius: 0.66, length: 9.8, afterburner: true },
    canopy: 'airliner',
    hook: false,
    eye: [...G.eye],
  };
}

export function TYPES(base) {
  const G = LANCER_GEOMETRY;
  const m = 24000;
  // Inertia per kilogram from the real radii of gyration, as the airliners (./airliners.js inertias()).
  const r = (v) => Math.round((m * v * v) / 1000) * 1000;
  const pitch = 0.14 * G.length;
  const roll = 0.13 * G.spanSpread;
  return [
    {
      id: 'b1b',
      name: 'B-1B Lancer',
      // 'Fighter' for the same reasons as the Nightjar: the jet cockpit (two
      // seats, a centre stick each), ejection seats, and the military files.
      class: 'Fighter',
      category: 'military',
      military: true,
      unarmed: true,
      carrier: false,
      swingWing: true,
      cockpit: 'jet',
      blurb:
        'A bomber whose wings move. Forward for take-off and landing, back for speed: they sweep on their ' +
        'own, or press ] and [ to do it yourself. Push the throttle to the stop to light four afterburners, ' +
        'dash low over the sea — and climb high to fly faster than sound.',
      stats: { speed: 5, handling: 3, ease: 2 },
      livery: '#5d646b',
      accent: '#2e3439',
      callsign: 'Lancer one one',
      price: 3200,
      why: 'Swing wings and four afterburners',
      takeoffFlaps: 2,
      plan: { nose: G.noseZ, tail: G.tailZ, span: G.spanSpread },
      shape: shapeOf(base, G),
      aero: {
        ...base.TRAINER_AERO,
        mass: m,
        wingArea: 120,
        wingSpan: G.spanSpread,
        // The length pitch damping is scaled by (with its square): the 737's,
        // the jet whose pitch inertia per unit of wing it is nearest.
        chord: 4.4,
        Ixx: r(pitch),
        Iyy: r(Math.hypot(pitch, roll)),
        Izz: r(roll),
        CL0: 0.36,
        CLa: 5.0,
        alphaStall: 0.21,
        CD0: 0.017,
        k: 0.042,
        CYb: -0.45,
        Cmalpha: -1.2,
        // 44.5 m of body on a 4.4 m chord: the A321's (length / chord)², and its
        // -40, plus a little. At the airliners' -30 the simplified height-hold
        // drove a 9 deg/s porpoise hands-off at 280 kt. Above that speed the
        // pitch damper adds more (../swing-wing.js pitchDamper()).
        Cmq: -45.0,
        Cmde: -1.0,
        Clb: -0.12,
        Clp: -0.6,
        Clda: 0.075,
        Cnb: 0.11,
        Cnr: -0.16,
        Cndr: 0.011,
        thrustMax: 95000,
        fuelCapacity: 14000,
        fuelBurnMax: 1.2,
        gearDragArea: 2.4,
        maxGearSpeed: 125,
        // Indicated: 622 kt, under Air Massimo's 700 (it keeps the hangar's top "Top").
        vne: 320,
        ceiling: 60000, // service ceiling, ft (published); above it the air thins faster (physics.js ceilingFactor)
      },
    },
  ];
}
