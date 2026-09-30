/**
 * T-Pose Harrison — "1 km faster than Air Massimo" (the owner's own words).
 *
 * A man in a T-pose on a rocket board. He flies on Air Massimo's numbers —
 * the same mass, wing, thrust and handling, so he is exactly as sensible to
 * fly as the one aeroplane in the game already built to go this fast and
 * still land on the 1,100 m strip — with ONE change: a little less drag.
 *
 * HOW MUCH LESS. Flat out and level, the thrust is on its floor (physics.js:
 * the propeller-style efficiency bottoms out at 0.12 above 176 m/s), so it
 * is constant, and drag goes as V². Massimo's true top speed, flown level at
 * 2,500 m until it stops rising (30 minutes of game time; it is still
 * climbing at the 5 minutes fighters.mjs's race gives everyone), is 941.5
 * km/h. Taking 0.1911% off his CD0 puts Harrison at 942.5: bisected against
 * the real flight model, 14 steps, to 1.000 km/h. Not a formula because the
 * induced drag, the sideslip term and the speed-dependent thrust make any
 * formula wrong in the third decimal, and the owner asked for ONE km/h.
 * tests/features/fighters.mjs races both to their true top speed and holds
 * the difference to 1 km/h ± 0.25.
 *
 * Derived from Massimo's entry rather than copied, so if Massimo is ever
 * made faster, Harrison stays one km/h ahead of him.
 *
 * THE SHAPE is his, not Massimo's. The board is the undercarriage: a nose
 * wheel 1.1 m ahead of the centre of gravity and two mains 0.4 m behind it,
 * 0.84 m apart, 0.66 m below it. The mains carry 73% of him, which is what
 * the brakes grip with: with them 0.65 m back (59%) he rolled 1,005 m after
 * landing and off the end of the runway; now 578 m, Massimo's 516 (and 241
 * with the drag chute). The centre of gravity is down at his feet,
 * where the rocket is, which is what keeps a 3.3 m man on a 2 m board from
 * falling over on the ground (and why he leans into a turn like a
 * snowboarder). His hands are the wing tips. scale 0.5 keeps the flight
 * model's fixed nose, belly and tail strike points (-0.9, -0.82 and -0.12 x
 * scale) above the wheels. The drawing is ../models/tpose-harrison.js.
 */
import { TYPES as FIGHTERS } from './fighters.js';
import { buildTPoseHarrison, WHEELS } from '../models/tpose-harrison.js';

/** Massimo's true level top speed at 2,500 m, km/h (tests/features/fighters.mjs). */
export const MASSIMO_TOP_KMH = 941.5;
/** How much faster Harrison is at the top: one kilometre an hour. */
export const HARRISON_MARGIN_KMH = 1;
/** The share of Massimo's CD0 Harrison does without. Measured; see above. */
export const HARRISON_DRAG_CUT = 0.001911;

export function TYPES(base) {
  const massimo = FIGHTERS(base).find((t) => t.id === 'massimo');
  if (!massimo) return [];
  const M = massimo.aero;
  const CD0 = M.CD0 * (1 - HARRISON_DRAG_CUT);
  const s = 0.5;
  return [
    {
      id: 'tpose',
      name: 'T-Pose Harrison',
      class: 'Racer',
      category: 'special',
      blurb:
        'A man in a T-pose on a rocket board. Arms out, never blinks, and exactly 1 km/h faster than '
        + 'Air Massimo — measured. Flies just like Massimo, lands just like Massimo. Nobody knows why.',
      stats: { speed: 5, handling: 4, ease: 3 },
      livery: '#2fb36b',
      accent: '#7a3bd1',
      callsign: 'Harrison',
      plan: { nose: -1.37, tail: 1.89, span: 3.31 },
      /** Drawn by ../models/tpose-harrison.js, not by the fleet pack or model.js. */
      buildModel: (opts) => buildTPoseHarrison(opts.type),
      shape: {
        ...base.TRAINER_SHAPE,
        scale: s,
        bodyLength: 0.96, // nose strike 1.25 m ahead (the board's nose), tail 1.9 m behind (the rocket)
        bodyRadius: 0.5,
        halfSpan: 3.3, // x 0.5 = his fingertips, 1.65 m out
        rootChord: 0.6,
        tipChord: 0.3,
        sweep: 0,
        dihedral: 0,
        wingY: 4.64, // x 0.5 = his shoulders, 2.32 m up
        wingZ: 0,
        wingRootX: 0,
        struts: false,
        retractable: true,
        hSpan: 0.8,
        hRootChord: 0.4,
        hZ: 2.4,
        finHeight: 0.6,
        finRootChord: 0.5,
        finSweep: 0.3,
        finZ: 2.4,
        nose: { x: WHEELS.nose[0] / s, y: WHEELS.nose[1] / s, z: WHEELS.nose[2] / s },
        main: { x: WHEELS.main[0] / s, y: WHEELS.main[1] / s, z: WHEELS.main[2] / s },
        wheelR: { nose: WHEELS.r / s, main: WHEELS.r / s },
        gearStiffness: 2.2,
        power: { kind: 'jet', count: 1, x: 0, y: 0.04 / s, z: 1.8 / s, radius: 0.4, length: 1.9, afterburner: true },
        canopy: 'none',
        hook: false,
        eye: [0, 2.7 / s, -0.34 / s],
        tpose: true,
      },
      aero: {
        ...M,
        CD0,
        vne: M.vne + HARRISON_MARGIN_KMH / 3.6,
      },
    },
  ];
}
