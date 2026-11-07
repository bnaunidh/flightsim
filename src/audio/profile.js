/**
 * Which engine an aeroplane has, as far as the ear is concerned.
 *
 * 44 aircraft shared three synths: a Q400 was a Skylark, a 747 was an F-22.
 * The numbers below are the ones that tell them apart. bp0 and bp1 are the fan's
 * blade-pass tone at idle and full power (Hz), rot its shaft rate (the buzzsaw
 * at take-off is a comb of those), n2 the core's whine; whine, blast and buzz
 * mix the parts; up and down are the spool rates (1/s), the heavier the slower;
 * inside is how much of it reaches the cockpit.
 */
export const FAMILIES = {
  rotor: { rotor: 1, heavy: 0.2 },
  piston: { prop: 1, idleRpm: 800, maxRpm: 2500, blades: 2, inside: 0.75, heavy: 0 },
  turboprop: { prop: 1, turbo: 1, idleRpm: 680, maxRpm: 1020, blades: 6, inside: 0.55, heavy: 0.45 },
  regional: { bp0: 900, bp1: 3400, rot: 120, n2: 7000, whine: 1.25, blast: 0.7, buzz: 0, up: 0.9, down: 1.1, inside: 0.7, heavy: 0.4 },
  narrow: { bp0: 520, bp1: 2300, rot: 85, n2: 6200, whine: 1, blast: 1, buzz: 0.5, up: 0.55, down: 0.8, inside: 0.62, heavy: 0.65 },
  wide: { bp0: 320, bp1: 1250, rot: 46, n2: 5200, whine: 0.8, blast: 1.15, buzz: 0.85, up: 0.38, down: 0.6, inside: 0.5, heavy: 1 },
  fighter: { bp0: 700, bp1: 2600, rot: 180, n2: 7500, whine: 0.5, blast: 1.35, buzz: 0, up: 1.1, down: 1.3, inside: 0.75, heavy: 0.3 },
  turbojet: { bp0: 760, bp1: 2900, rot: 150, n2: 6800, whine: 0.35, blast: 1.5, buzz: 0, up: 0.7, down: 0.9, inside: 0.55, heavy: 0.8, crackle: 1 },
  highbypass: { bp0: 1100, bp1: 3900, rot: 150, n2: 7800, whine: 1.35, blast: 0.55, buzz: 0, up: 0.8, down: 1, inside: 0.75, heavy: 0.3 },
};

const NAMED = { concorde: 'turbojet', a10: 'highbypass' };

/** The family's name for a roster entry (aircraft/types.js). */
export function engineFamily(t) {
  const p = (t && t.shape && t.shape.power) || {};
  const n = p.count || 1;
  if (p.rotor) return 'rotor';
  if (t && NAMED[t.id]) return NAMED[t.id];
  if (p.kind !== 'jet') return n > 1 ? 'turboprop' : 'piston';
  if (/Fighter|Carrier|Racer|Prototype/.test((t && t.class) || '')) return 'fighter';
  const kN = ((t.aero && t.aero.thrustMax) || 0) / 1000;
  return n >= 4 || kN >= 78 ? 'wide' : kN < 62 ? 'regional' : 'narrow';
}

/** A periodic wave of n partials, amp(h) each. */
export function partials(ctx, n, amp) {
  const re = new Float32Array(n + 1);
  for (let h = 1; h <= n; h++) re[h] = amp(h);
  return ctx.createPeriodicWave(re, new Float32Array(n + 1));
}
