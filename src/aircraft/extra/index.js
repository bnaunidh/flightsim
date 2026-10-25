/**
 * Aeroplanes added after the original eight, one file per group so that
 * separate pieces of work never edit the same array.
 *
 * Each file exports `TYPES(base)`, a function returning roster entries in
 * exactly the shape of AIRCRAFT in ../types.js (id, name, class, blurb, stats,
 * livery, accent, callsign, shape, aero — and optionally category, military,
 * longHaul, stores, plan). types.js appends what they return to AIRCRAFT, so
 * the hangar, the picker, the physics and the tests all see them without
 * being told.
 *
 * `plan` is the drawn aeroplane seen from above, in metres from the centre of
 * gravity (-Z forward): { nose, tail, span } — the nose tip, the aftmost
 * point, and tip to tip. The airfield reads it to choose which stand an
 * aeroplane fits and to keep a pushback clear of it, without building the
 * model (../../world/airport-layout.js typeSize, ../../world/apron.js
 * estimateInfo). Without it the size is worked out from `shape` with the
 * original eight's proportions (nose 2.6 x bodyLength ahead), which is right
 * for them and wrong by metres for an aeroplane whose bodyLength is set any
 * other way. tests/features/airport.mjs bakes every roster type and fails,
 * naming the type and its drawn numbers, if the airfield's idea of it is more
 * than half a metre short anywhere.
 */
import { TYPES as FIGHTERS } from './fighters.js';
import { TYPES as AIRLINERS } from './airliners.js';
import { TYPES as TPOSE } from './tpose.js';
// new-aircraft (2026-10-16): the popular airliners. After ./airliners.js,
// whose geometry and door tables they register into.
import { TYPES as JETS } from './jets.js';
// ...and the giants (BelugaXL, Dreamlifter, An-225, C-5).
import { TYPES as GIANTS } from './giants.js';
// ...and the B-1B Lancer, the swing-wing bomber (owner: "also note: add b1 lancers").
import { TYPES as LANCER } from './lancer.js';
// ...and the C-17 Globemaster III (owner: "Boeing C-17 Globemaster III ... rear cargo ramp").
import { TYPES as C17 } from './c17.js';
// ...and the A-10 Thunderbolt II (owner: "Fairchild A-10 Thunderbolt II ... slow & tough").
import { TYPES as ATTACK } from './attack.js';
// ...and the helicopter wave: Bell 407, H145, R44, AW139, UH-60, CH-47, AH-64 (owner, 2026-10-21/23).
import { TYPES as HELIS } from './helis.js';

export function extraAircraft(base) {
  return [...FIGHTERS(base), ...AIRLINERS(base), ...TPOSE(base), ...JETS(base), ...GIANTS(base), ...LANCER(base), ...C17(base), ...ATTACK(base), ...HELIS(base)];
}
