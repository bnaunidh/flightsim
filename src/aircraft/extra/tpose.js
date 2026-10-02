/**
 * T-Pose Harrison — "1 km faster than Air Massimo" (the owner's own words).
 *
 * A man in a T-pose, flying head-first: no board, no wheels, nothing under
 * him — "make T-Pose Harrison just float ... his head is the nose of the
 * plane". He flies on Air Massimo's numbers — the same mass, wing, thrust and
 * handling, so he is exactly as sensible to fly as the one aeroplane in the
 * game already built to go this fast and still land on the 1,100 m strip —
 * with ONE change: a little less drag.
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
 * the difference to 1 km/h ± 0.25. That is flaps up, flown normally: his
 * flaps (his arms — see the model) only add lift and drag when they are out,
 * and his tricks (the spin climb and the boost, ../../features/tpose/
 * moves.js) never touch an ordinary step.
 *
 * Derived from Massimo's entry rather than copied, so if Massimo is ever
 * made faster, Harrison stays one km/h ahead of him.
 *
 * WHAT HOLDS HIM UP ON THE GROUND is the same undercarriage the flight model
 * always gave him — a contact 1.1 m ahead of the centre of gravity and two
 * 0.4 m behind it, 0.84 m apart, 0.66 m below it — only now nothing is drawn
 * there: he hovers over it. The mains carry 73% of him, which is what the
 * brakes grip with (he stops in 578 m, Massimo in 516, 241 with the drag
 * chute). The gear lever still works those contacts: it is his hover, and a
 * landing with it up is a belly landing, as ever. scale 0.5 keeps the flight
 * model's fixed nose, belly and tail strike points (-0.9, -0.82 and -0.12 x
 * scale) above them.
 *
 * THE SHAPE is the drawing's (../models/tpose-harrison.js): his hands are the
 * wing tips — the tip strike points sit at his fingertips, level with his
 * body, so a hand that touches the runway is a wing tip that touched it — his
 * eyes are the cockpit, his head is the nose, the soles of his feet the tail.
 */
import { TYPES as FIGHTERS } from './fighters.js';
import { buildTPoseHarrison, WHEELS, EYE_M, AXIS_Y } from '../models/tpose-harrison.js';

/** Massimo's true level top speed at 2,500 m, km/h (tests/features/fighters.mjs). */
export const MASSIMO_TOP_KMH = 941.5;
/** How much faster Harrison is at the top: one kilometre an hour. */
export const HARRISON_MARGIN_KMH = 1;
/** The share of Massimo's CD0 Harrison does without. Measured; see above. */
export const HARRISON_DRAG_CUT = 0.001911;
/** The drawing, from above, metres: head to toes and fingertip to fingertip (aircrew.mjs measures it). */
export const HARRISON_PLAN = { nose: -1.15, tail: 2.4, span: 3.51 };

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
        'A man in a T-pose, flying head-first. No board, no engine you can see — he just floats. His arms are '
        + 'the wings (the flaps make him flap them), and he is exactly 1 km/h faster than Air Massimo — measured. Nobody knows why.',
      stats: { speed: 5, handling: 4, ease: 3 },
      livery: '#2fb36b',
      accent: '#7a3bd1',
      callsign: 'Harrison',
      plan: { ...HARRISON_PLAN },
      /** Drawn by ../models/tpose-harrison.js, not by the fleet pack or model.js. */
      buildModel: (opts) => buildTPoseHarrison(opts.type),
      shape: {
        ...base.TRAINER_SHAPE,
        scale: s,
        bodyLength: 0.96, // nose strike 1.25 m ahead (his head), tail 1.9 m behind (his ankles)
        bodyRadius: 0.5,
        halfSpan: 3.5, // x 0.5 = his fingertips, 1.75 m out
        rootChord: 0.6,
        tipChord: 0.3,
        sweep: 0,
        dihedral: 0,
        wingY: AXIS_Y / s, // his arms are level with his body
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
        // The engine is the flight model's, and its sound; nothing of it is drawn.
        power: { kind: 'jet', count: 1, x: 0, y: AXIS_Y / s, z: 2.4 / s, radius: 0.4, length: 1.9, afterburner: false },
        canopy: 'none',
        hook: false,
        // His eyes: the head view is from his head.
        eye: [EYE_M[0] / s, EYE_M[1] / s, EYE_M[2] / s],
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
