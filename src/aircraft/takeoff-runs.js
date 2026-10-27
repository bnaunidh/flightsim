/**
 * How much runway each aeroplane needs to get airborne, in the game's own
 * flight model (tools/takeoff-runs.mjs measures it; the World Map test checks
 * the table has not drifted from the physics by more than 15%).
 *
 * Why: the World Map — Preview has grass strips of 580-750 m (Gull Cay, Dune
 * Cay, Mangrove Cay, Saltmarsh, Petrel Skerry). An airliner put on one of
 * them can never leave it (checker, wave 17b). The spawner reads runwayNeedM
 * and starts such a type in the air instead, with a toast saying why.
 */

/* TABLE */
export const TAKEOFF_RUN_M = Object.freeze({
  skylark: 270,
  courier: 390,
  meridian: 1780,
  vanguard: 230,
  osprey: 340,
  tempest: 1090,
  nightjar: 570,
  f22: 180,
  f35b: 180,
  fa18: 170,
  massimo: 180,
  a320: 560,
  b747: 700,
  a380: 650,
  tpose: 140,
  b737: 540,
  a321: 670,
  b787: 590,
  a350: 610,
  b777: 660,
  q400: 650,
  concorde: 520,
  belugaxl: 1500,
  dreamlifter: 1490,
  an225: 2280,
  c5: 1750,
  b1b: 590,
  c17: 980,
  a10: 290,
});

/** Ground run to lift-off, metres (measured, or estimated from the aero for a type not in the table). */
export function takeoffRunM(type) {
  if (!type) return 0;
  if (type.class === 'Helicopter' || (type.aero && type.aero.rotor) || !type.aero || !type.aero.thrustMax) return 0;
  const m = TAKEOFF_RUN_M[type.id];
  if (m) return m;
  // Not measured: a cautious estimate (lift-off at 1.3x the flapped stall, a third of the thrust's acceleration).
  const a = type.aero;
  const CLmax = (a.CL0 || 0.25) + (a.CLa || 5) * (a.alphaStall || 0.25);
  const vs = Math.sqrt((2 * a.mass * 9.81) / (1.225 * a.wingArea * CLmax));
  const acc = Math.max(0.4, 9.81 * ((0.38 * a.thrustMax) / (a.mass * 9.81) - 0.03));
  return Math.round(((1.3 * vs) ** 2) / (2 * acc));
}

/**
 * Runway a type needs to be offered a runway start: its run, 15% more (35%
 * on grass or gravel, which drag at the wheels), and the 80 m the start is
 * from the threshold.
 */
export function takeoffNeedM(type, surface = 'tarmac') {
  const run = takeoffRunM(type);
  const rough = surface === 'grass' || surface === 'gravel';
  return run ? Math.round(run * (rough ? 1.35 : 1.15) + 80) : 0;
}
