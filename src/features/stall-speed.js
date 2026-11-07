/**
 * THE STALL SPEED, for the aeroplane as it is right now: the speed the wing
 * reaches its stalling angle at, in the flight model's own numbers.
 *
 * physics.js builds the lift curve from the aero spec: CL = CL0 + flaps * 0.62
 * + CLa * alpha, up to a stalling angle of alphaStall - flaps * 0.03 (less for
 * ice). So CLmax is that line at that angle, a tenth lower with the spoilers
 * out, and what is left of it on a hurt wing. Lift is q S CL and the airspeed
 * the panels show is indicated (ias = V * sqrt(rho / rho0)), so with the sea
 * level density here the figure holds at any height, as a real one does:
 *
 *   Vs = sqrt(2 W n / (rho0 S CLmax))    n = 1 / cos(bank), a level turn
 *
 * W is the type's mass plus anything carried (extraMass, the water bomber's
 * load). This is NOT performanceFor(): that table's stallLanding counts full
 * flap as CLmax + 0.9, the flight model gives about half of that, so with the
 * flaps down it reads 10 to 15 per cent lower than the aeroplane truly stalls.
 *
 * Power makes it a little lower in the air (the thrust line carries a share
 * of the weight at a high nose), so this is the power-off figure, the safe one
 * to show. tests/features/stall-speed.mjs flies the stall for real.
 */

import { SPEC, UNITS } from '../aircraft/physics.js';
import { handlingFor } from '../aircraft/damage-handling.js';

const G = 9.80665;
const RHO0 = 1.225;
/** A level turn past this stops being a level turn: the figure is capped here (n = 2.9). */
const MAX_BANK_DEG = 70;

/** CLmax of the wing as it stands: `flaps` 0..1. */
export function clMax(spec, flaps = 0, icing = false, spoilers = 0) {
  const a = spec.alphaStall - flaps * 0.03 - (icing ? 0.06 : 0);
  const cl = spec.CL0 + flaps * 0.62 + spec.CLa * a;
  return cl * (1 - 0.12 * (spec.spoilers ? spoilers : 0));
}

/** Indicated stall speed in knots for a spec and a state; 0 for a rotor (no wing to stall). */
export function stallKnots(spec, { flaps = 0, bankDeg = 0, extraMass = 0, icing = false, spoilers = 0, liftShare = 1 } = {}) {
  if (spec.rotor || !(spec.wingArea > 0)) return 0;
  const cl = clMax(spec, flaps, icing, spoilers) * liftShare;
  if (!(cl > 0.02)) return 0;
  const bank = Math.min(Math.abs(bankDeg), MAX_BANK_DEG) * (Math.PI / 180);
  const W = (spec.mass + extraMass) * G;
  return Math.sqrt((2 * W) / Math.cos(bank) / (RHO0 * spec.wingArea * cl)) * UNITS.KTS;
}

/** The same for the aeroplane in flight. Nothing allocated while it is unhurt. */
export function stallKnotsNow(ac) {
  const H = ac.damage ? handlingFor(ac.damage, ac.lost, SPEC) : null;
  return stallKnots(SPEC, {
    flaps: ac.flaps,
    bankDeg: ac.bankAngleDeg ? ac.bankAngleDeg() : 0,
    extraMass: ac.extraMass || 0,
    icing: !!(ac.failures && ac.failures.icing),
    spoilers: ac.spoilerPos || 0,
    liftShare: H ? H.lift : 1,
  });
}
