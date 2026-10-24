#!/usr/bin/env node
/**
 * Every aeroplane in the roster against the real one: the numbers the flight
 * model flies (src/aircraft/types.js and extra/) beside the published figures
 * (./real-aircraft-specs.mjs), with the ratios that say whether the game's
 * scaling is the deliberate kind or a mistake.
 *
 *   node tools/aircraft-specs.mjs            writes docs/aircraft-specs.md
 *   node tools/aircraft-specs.mjs --print    prints it instead
 *
 * tests/features/aircraft-specs.mjs imports gameNumbers() and renderDoc()
 * from here: the same arithmetic holds every type to its bands, and fails if
 * the document on disk is stale.
 *
 * WHAT THE GAME SCALES ON PURPOSE (documented in the roster files):
 *   - mass: the undercarriage caps every leg at 160 kN, so nothing weighs more
 *     than about 28 t; the big aeroplanes fly as lightly loaded versions of
 *     themselves with the RATIOS (thrust, wing, inertia per kilogram) kept;
 *   - thrust-to-weight: the airliners carry 0.36 (a real one 0.22-0.32 at
 *     MTOW, 0.45-0.6 empty) so they unstick inside the 1,100 m Kestrel strip;
 *     the giants carry 0.26 and need a 2,000 m runway, which is their point;
 *   - stalling speeds: well under the real ones (wing loading 180-250 kg/m²
 *     against 600-700), so a child can land them;
 *   - the fighters are lighter than the real jets with more lift at low speed,
 *     for the same runway, with the real relative feel kept.
 * What is NOT scaled is the shape of the ratios — a type whose thrust per
 * weight, stalling speed or ceiling sits outside the band of its real
 * counterpart is simply wrong, and the test says so.
 *
 * The game's "absolute ceiling" below is worked out, not measured: the height
 * at which full thrust (with simplified mode's 1.12, the density lapse and the
 * type's ceiling fade — physics.js ceilingFactor) just equals the minimum drag
 * of the airframe, 2W√(CD0·k). Its initial climb is the best excess power
 * over weight at sea level, clean, scanned over speed.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AIRCRAFT, performanceFor } from '../src/aircraft/types.js';
import { ceilingFactor, CEILING_FADE, SKY_CEILING_FT } from '../src/aircraft/physics.js';
import { REAL_SPECS } from './real-aircraft-specs.mjs';

export const G = 9.80665;
export const RHO0 = 1.225;
export const KT = 1.94384;
export const FT = 3.28084;
export const FPM = 196.85;
/** Simplified mode's thrust factor (physics.js: `simple ? 1.12 : 1`) — the default the class flies. */
export const SIMPLE_THRUST = 1.12;
/** Full flap adds this to CL (physics.js flapCL = flaps × 0.62). */
export const FLAP_CL = 0.62;

export function isProp(t) {
  return t.shape.power.kind === 'prop' && !t.shape.power.rotor;
}
export function isRotor(t) {
  return !!t.shape.power.rotor;
}

/** The flight model's thrust at full power, speed u (m/s, along the body), density ratio rr. */
export function thrustAt(t, u, rr) {
  const a = t.aero;
  const eff = isProp(t) ? Math.max(0.12, 1 - 0.5 * (u / 100)) : 1;
  return a.thrustMax * SIMPLE_THRUST * rr * eff;
}

/** Drag, clean, level, at speed V and density rho (parabolic polar, as physics.js flies it). */
export function dragAt(t, V, rho) {
  const a = t.aero;
  const W = a.mass * G;
  const q = 0.5 * rho * V * V;
  const CL = W / (q * a.wingArea);
  const CD = a.CD0 + a.k * CL * CL;
  return q * a.wingArea * CD;
}

/**
 * Where the climb runs out: the height (m) at which full thrust at the
 * minimum-drag speed equals the minimum drag. Null for the helicopter.
 */
export function absoluteCeilingM(t) {
  if (isRotor(t)) return null;
  const a = t.aero;
  const W = a.mass * G;
  const dmin = 2 * W * Math.sqrt(a.CD0 * a.k);
  const thrust = (h) => {
    const rr = Math.exp(-h / 8500) * ceilingFactor(h * FT, a.ceiling);
    const vMd = Math.sqrt((2 * W) / (RHO0 * rr * a.wingArea)) * Math.pow(a.k / a.CD0, 0.25);
    return thrustAt(t, vMd, rr);
  };
  let lo = 0;
  let hi = 40000;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (thrust(m) > dmin) lo = m;
    else hi = m;
  }
  return lo;
}

/** Best rate of climb at sea level, clean, m/s — the excess power over weight, scanned over speed up to Vne. */
export function bestClimbMps(t) {
  if (isRotor(t)) return null;
  const a = t.aero;
  const W = a.mass * G;
  const vs = stallSpeeds(t).clean;
  let best = 0;
  for (let V = vs * 1.15; V <= a.vne; V += 1) {
    const roc = ((thrustAt(t, V, 1) - dragAt(t, V, RHO0)) * V) / W;
    if (roc > best) best = roc;
  }
  return best;
}

/** Stalling speeds, m/s, at sea level: clean (CL0 + CLa·αstall) and with full flap. */
export function stallSpeeds(t) {
  const a = t.aero;
  const W = a.mass * G;
  const clean = a.CL0 + a.CLa * a.alphaStall;
  const land = clean + FLAP_CL;
  const vs = (cl) => Math.sqrt((2 * W) / (RHO0 * a.wingArea * cl));
  return { clMax: clean, clLand: land, clean: vs(clean), landing: vs(land) };
}

/** Everything the table prints for one type, in the units the table uses. */
export function gameNumbers(t) {
  const a = t.aero;
  const W = a.mass * G;
  const perf = performanceFor(t.id);
  const vs = stallSpeeds(t);
  const ceilM = absoluteCeilingM(t);
  const roc = bestClimbMps(t);
  const prop = isProp(t);
  return {
    id: t.id,
    name: t.name,
    cls: t.class,
    mass: a.mass,
    thrustKN: a.thrustMax / 1000,
    /** Propulsive power at 50 m/s (W), the propeller's honest figure: T(u)·u = Tmax·0.75·50. */
    powerKW: prop ? (a.thrustMax * 0.75 * 50) / 1000 : null,
    engines: (t.shape.power && t.shape.power.count) || 1,
    tw: a.thrustMax / W,
    wingArea: a.wingArea,
    span: a.wingSpan,
    wingLoading: a.mass / a.wingArea,
    clMax: vs.clMax,
    vsClean: vs.clean * KT,
    vs0: vs.landing * KT,
    vr: vs.landing * KT * 1.1,
    vref: vs.landing * KT * 1.3,
    vne: a.vne * KT,
    ceiling: a.ceiling || null,
    absoluteCeilingFt: ceilM == null ? null : ceilM * FT,
    climbFpm: roc == null ? null : roc * FPM,
    enduranceMin: perf.enduranceMin,
    rotor: isRotor(t),
    prop,
  };
}

const r0 = (v) => (v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('en-US'));
const r2 = (v) => (v == null || !Number.isFinite(v) ? '—' : (Math.round(v * 100) / 100).toFixed(2));
const kn = (v) => (v == null ? '—' : r0(v));
const area = (v) => (v == null || !Number.isFinite(v) ? '—' : v < 100 ? (Math.round(v * 10) / 10).toString() : r0(v));

/** Real thrust-to-weight at MTOW and empty (jets), or power loading (props), from the published row. */
export function realRatios(R) {
  if (!R || !R.mtow) return null;
  const out = {};
  if (R.thrust) {
    out.twMtow = (R.thrust * 1000 * R.engines) / (R.mtow * G);
    out.twEmpty = R.empty ? (R.thrust * 1000 * R.engines) / (R.empty * G) : null;
  }
  if (R.power) {
    out.pwMtow = (R.power * R.engines) / R.mtow;
    out.pwEmpty = R.empty ? (R.power * R.engines) / R.empty : null;
  }
  if (R.wingArea) out.wingLoading = R.mtow / R.wingArea;
  return out;
}

export function renderDoc() {
  const lines = [];
  lines.push('# The roster against the real aeroplanes');
  lines.push('');
  lines.push('Generated by `node tools/aircraft-specs.mjs` from `src/aircraft/types.js` (and `extra/`) and the published figures in `tools/real-aircraft-specs.mjs`. `tests/features/aircraft-specs.mjs` holds every type to the bands below and fails if this file is stale — do not edit it by hand.');
  lines.push('');
  lines.push('## What the game scales on purpose');
  lines.push('');
  lines.push('- **Mass.** The undercarriage model caps every leg at 160 kN, so nothing weighs more than about 28 t: the big aeroplanes fly as lightly loaded versions of themselves, with the real span, length and inertia per kilogram, and the ratios of thrust and wing to mass kept.');
  lines.push('- **Thrust-to-weight.** The airliners carry about 0.36 (a real one has 0.22–0.32 at MTOW and 0.45–0.6 empty) so they unstick inside the 1,100 m Kestrel strip; the giants (BelugaXL, Dreamlifter, An-225, C-5) carry 0.26 and want a 2,000 m runway, which is the point of them; the C-17 carries 0.40 because the real one is built for short strips. Every game figure sits between the real aeroplane\'s ratio at MTOW and its ratio empty.');
  lines.push('- **Stalling speeds.** Wing loadings of 180–250 kg/m² against the real 600–700 put the stall at 65–85 kt instead of 105–130, so a child can land them. The fighters are lighter than the real jets with more lift at low speed, for the same runway; what is kept honest is the relative feel (the Raptor has the best thrust-to-weight and is the fastest of the real jets, the Hornet the gentlest approach, the A-10 the slowest).');
  lines.push(`- **Ceilings** were not scaled — they did not exist. The exponential atmosphere alone let the trainer climb to 26,000 ft and an A320 to 52,000. Every type now carries its published service ceiling, and above ${CEILING_FADE.from}× it the air the flight model uses thins faster (to ${CEILING_FADE.floor} of itself at ${CEILING_FADE.to}×, \`physics.js ceilingFactor\`): less thrust, less lift, the stall nearer. The top of the sky stays at ${SKY_CEILING_FT.toLocaleString('en-US')} ft.`);
  lines.push('- **Indicated limits (Vne).** The airliners\' are their published Vmo (the A380, A350, 777 and Q400 were 6–9 % high and were brought to it); the fighters\' are 65–85 % of the real jets\' — a child-safe red line, not a performance claim; the A-10\'s 330 kt is the slowest jet on purpose.');
  lines.push('');
  lines.push('## Weights, thrust and wing');
  lines.push('');
  lines.push('| id | aircraft | real counterpart | game mass kg | real empty / MTOW kg | game thrust | real thrust (each × n) | T/W game | T/W real MTOW → empty | wing m² game / real | kg/m² game / real |');
  lines.push('|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const t of AIRCRAFT) {
    const g = gameNumbers(t);
    const R = REAL_SPECS[t.id] || {};
    const rr = realRatios(R) || {};
    const gThrust = g.prop ? `${r0(g.thrustKN * 1000)} N (≈${r0(g.powerKW)} kW)` : g.rotor ? 'rotor' : `${r0(g.thrustKN)} kN`;
    const rThrust = R.power ? `${r0(R.power)} kW × ${R.engines}` : R.thrust ? `${R.thrust} kN × ${R.engines}` : '—';
    const tw = g.rotor ? '—' : r2(g.tw);
    const rtw = rr.twMtow ? `${r2(rr.twMtow)} → ${r2(rr.twEmpty)}` : rr.pwMtow ? `${r2(rr.pwMtow * 1000)} → ${r2(rr.pwEmpty * 1000)} W/kg` : '—';
    lines.push(`| ${t.id} | ${t.name} | ${R.real || '—'}${R.fiction ? ' *(game design)*' : ''} | ${r0(g.mass)} | ${kn(R.empty)} / ${kn(R.mtow)} | ${gThrust} | ${rThrust} | ${tw} | ${rtw} | ${g.rotor ? 'rotor' : area(g.wingArea)} / ${R.wingArea ? area(R.wingArea) : '—'} | ${g.rotor ? '—' : r0(g.wingLoading)} / ${rr.wingLoading ? r0(rr.wingLoading) : '—'} |`);
  }
  lines.push('');
  lines.push('## Speeds, climb, ceiling');
  lines.push('');
  lines.push('Game speeds are worked out from the aerodynamics (CLmax = CL0 + CLa·αstall, full flap adds 0.62); Vr is taken as 1.1 × Vs0 and Vref as 1.3 × Vs0, the way the hangar quotes them. The game climb is the best excess power at sea level, clean; the game\'s absolute ceiling is where full thrust meets minimum drag. Real figures marked ≈ are estimates.');
  lines.push('');
  lines.push('| id | Vs0 kt game / real | Vr kt game / real | Vref kt game / real | Vne kt game / real Vmo | climb ft/min game / real | ceiling ft (type) | game absolute ceiling ft | real cruise kt | real range nm | fuel at full power |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const t of AIRCRAFT) {
    const g = gameNumbers(t);
    const R = REAL_SPECS[t.id] || {};
    const ap = (k) => (R.approx && R.approx.includes(k) ? '≈' : '');
    const real = (k) => (R[k] == null ? '—' : `${ap(k)}${r0(R[k])}`);
    const vs = g.rotor ? '—' : r0(g.vs0);
    lines.push(`| ${t.id} | ${vs} / ${real('vs0')} | ${g.rotor ? '—' : r0(g.vr)} / ${real('vr')} | ${g.rotor ? '—' : r0(g.vref)} / ${real('vref')} | ${r0(g.vne)} / ${real('vmo')} | ${g.climbFpm == null ? '—' : r0(g.climbFpm)} / ${real('climb')} | ${r0(g.ceiling)} | ${g.absoluteCeilingFt == null ? '—' : r0(g.absoluteCeilingFt)} | ${real('cruise')} | ${real('range')} | ${g.enduranceMin} min |`);
  }
  lines.push('');
  lines.push('## Notes per type');
  lines.push('');
  lines.push('- **skylark** — the 172 to the number: the same wing, the same weight, a 40 kt stall, 159 kt on the red line; its climb is 1.7× a real 172\'s because the flight model\'s propeller does not lose power with height the way a normally aspirated engine does, which is what the 14,000 ft ceiling now stands in for.');
  lines.push('- **courier** — a Bonanza-class tourer; honest mass, wing and power, a slightly softer stall.');
  lines.push('- **meridian** — a 40-seat regional jet of the game\'s own with a bigger wing than an ERJ (78 m² for 16.5 t); thrust-to-weight 0.37, inside a lightly loaded ERJ-145\'s 0.31–0.56.');
  lines.push('- **vanguard, osprey** — the game\'s own fighter and carrier jet, in the Mirage 2000\'s and the A-7\'s bands; both lighter and slower-stalling for the Kestrel strip (see types.js).');
  lines.push('- **tempest** — a twin where the hurricane hunter it is built on is a four-engined P-3; the wing and ceiling are the Orion\'s class, the red line 340 kt against its 405.');
  lines.push('- **nightjar** — an original flying wing in the B-2\'s bands; thrust-to-weight 0.42 against the B-2\'s 0.18 (MTOW) to 0.44 (empty).');
  lines.push('- **harrier (Skyhook)** — a light helicopter of the H125\'s class; the rotor, not a wing, so no stall or thrust-to-weight is quoted; its ceiling is the H125\'s 23,000 ft.');
  lines.push('- **f22, f35b, fa18, a10** — real jets at a third of their mass with the real relative feel; thrust-to-weight 0.63–0.99 inside each one\'s MTOW→empty band; red lines 65–85 % of the real ones on purpose.');
  lines.push('- **massimo, tpose** — the game\'s own record racer and the man who flies on its numbers: no real counterpart, so only the in-game ordering is held (fastest of all, highest red line, a ceiling above every real type\'s).');
  lines.push('- **airliners (a320 … b777, concorde)** — the real span and wing proportions at a fifth to a fifteenth of the real mass; thrust-to-weight 0.36 inside every one\'s MTOW→empty band; Vmo matched.');
  lines.push('- **giants (belugaxl, dreamlifter, an225, c5)** — thrust-to-weight 0.26 (at or a little under the real MTOW figures: deliberate — they need Gateway\'s 3,800 m), stall near 85 kt because the game grades a touchdown over 120 kt as a crash.');
  lines.push('- **b1b, c17** — 0.40 against real 0.26 → 0.64 and 0.28 → 0.57: lightly loaded, inside the band; the B-1B\'s swing wing changes CLa, CL0 and the stall with sweep (swing-wing.js) and the table shows it spread.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

const here = fileURLToPath(import.meta.url);
if (process.argv[1] && fileURLToPath(new URL(`file://${process.argv[1]}`)) === here) {
  const doc = renderDoc();
  if (process.argv.includes('--print')) process.stdout.write(doc);
  else {
    const out = new URL('../docs/aircraft-specs.md', import.meta.url);
    let was = null;
    try {
      was = readFileSync(out, 'utf8');
    } catch (e) {
      was = null;
    }
    writeFileSync(out, doc);
    console.log(`${was === doc ? 'unchanged' : 'wrote'} ${fileURLToPath(out)} (${AIRCRAFT.length} types)`);
  }
}
