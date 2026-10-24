/**
 * Node checks that every aeroplane in the roster stays within sane bands of
 * the real one — docs/aircraft-specs.md is the table, this is the test.
 *
 *   node tests/features/aircraft-specs.mjs
 *
 *   1. Every roster type has a published row (tools/real-aircraft-specs.mjs)
 *      and a service ceiling, and the table on disk is the current one.
 *   2. THRUST-TO-WEIGHT (jets): between 0.8 × the real aeroplane's at MTOW
 *      and 1.15 × its figure empty — a lightly loaded version of itself, never
 *      more. Propellers: power loading inside the same kind of band.
 *   3. STALLING SPEED, landing flap: 0.45–1.15 × the real one (the game lands
 *      slow on purpose; it must never land faster than the real thing).
 *   4. RED LINE (Vne): 0.6–1.2 × the real Vmo/Vne.
 *   5. CEILINGS: the type's ceiling is the published one; the flight model's
 *      density above it fades (ceilingFactor) exactly as documented; the
 *      height at which full thrust meets minimum drag — where the climb runs
 *      out — lands within 0.9–1.25 × the published service ceiling for every
 *      fixed-wing type; nothing changes at or below 1.05 × the ceiling.
 *   6. CLIMB: the best sea-level climb is sane for the class, and in order —
 *      the fast jets above the airliners above the trainer — and within 0.4–5 × the
 *      real figure where one is published (the big ones climb like the empty
 *      aeroplane they are).
 *   7. IN-GAME ORDER (the fiction has no counterpart, so it is held to the
 *      roster): Air Massimo is the fastest, highest-flying type and the Raptor
 *      the best thrust-to-weight of the real fighters; the giants carry less
 *      thrust per weight than the airliners; the A-10 is the slowest jet.
 *   8. In the real flight model: an A320 at 1.3 × its ceiling sees a third of
 *      the air it would have, and a trainer that could climb to 26,000 ft has
 *      no power in hand at 18,000 any more — while at 8,000 ft, and in a
 *      cruise at 2,000 ft, nothing has changed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

globalThis.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};

const ROOT = new URL('../../', import.meta.url);
const imp = (p) => import(new URL(p, ROOT).href);
const T = await imp('src/aircraft/types.js');
const P = await imp('src/aircraft/physics.js');
const THREE = await imp('src/vendor/three.module.js');
const Tool = await imp('tools/aircraft-specs.mjs');
const { REAL_SPECS } = await imp('tools/real-aircraft-specs.mjs');

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? '  — ' + detail : ''}`);
}
const r2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
const r0 = (v) => Math.round(v).toString();
const { G, FT, KT } = Tool;

const types = T.AIRCRAFT;
const game = Object.fromEntries(types.map((t) => [t.id, Tool.gameNumbers(t)]));

/* ---- 1. rows, ceilings, the document ---------------------------------- */
{
  const missing = types.filter((t) => !REAL_SPECS[t.id]).map((t) => t.id);
  ok('every roster type has a published row', missing.length === 0, missing.join(', ') || `${types.length} types`);
  const extra = Object.keys(REAL_SPECS).filter((id) => !types.some((t) => t.id === id));
  ok('…and no row is for a type that does not exist', extra.length === 0, extra.join(', '));
  const noCeil = types.filter((t) => !(t.aero.ceiling > 8000 && t.aero.ceiling <= 80000)).map((t) => t.id);
  ok('every type carries a service ceiling between 8,000 and 80,000 ft', noCeil.length === 0, noCeil.join(', '));
  const offCeil = types.filter((t) => REAL_SPECS[t.id] && REAL_SPECS[t.id].ceiling && t.aero.ceiling !== REAL_SPECS[t.id].ceiling).map((t) => `${t.id} ${t.aero.ceiling} vs ${REAL_SPECS[t.id].ceiling}`);
  ok('each type\'s ceiling IS the published one', offCeil.length === 0, offCeil.join(', '));
  ok('performanceFor() tells the hangar the ceiling', types.every((t) => T.performanceFor(t.id).ceilingFt === t.aero.ceiling));
  let onDisk = null;
  try {
    onDisk = readFileSync(fileURLToPath(new URL('docs/aircraft-specs.md', ROOT)), 'utf8');
  } catch (e) {
    onDisk = null;
  }
  ok('docs/aircraft-specs.md is the table for these numbers (node tools/aircraft-specs.mjs rewrites it)', onDisk !== null && onDisk === Tool.renderDoc(), onDisk === null ? 'missing' : onDisk === Tool.renderDoc() ? 'current' : 'STALE');
}

/* ---- 2. thrust-to-weight / power loading ------------------------------- */
for (const t of types) {
  const R = REAL_SPECS[t.id];
  const g = game[t.id];
  if (!R || R.racer || R.helicopter) continue;
  const rr = Tool.realRatios(R);
  if (rr.twMtow) {
    const lo = 0.8 * rr.twMtow;
    const hi = 1.15 * rr.twEmpty;
    ok(`${t.id}: thrust-to-weight ${r2(g.tw)} within 0.8 × real at MTOW (${r2(rr.twMtow)}) and 1.15 × empty (${r2(rr.twEmpty)})`, g.tw >= lo && g.tw <= hi, `${r2(lo)}–${r2(hi)}`);
  } else if (rr.pwMtow) {
    const pw = (g.powerKW * 1000) / g.mass;
    const lo = 0.45 * rr.pwMtow * 1000;
    const hi = 1.15 * rr.pwEmpty * 1000;
    ok(`${t.id}: power loading ${r0(pw)} W/kg within 0.45 × real at MTOW (${r0(rr.pwMtow * 1000)}) and 1.15 × empty (${r0(rr.pwEmpty * 1000)})`, pw >= lo && pw <= hi, `${r0(lo)}–${r0(hi)}`);
  }
}

/* ---- 3. stalling speed, 4. red line ------------------------------------ */
for (const t of types) {
  const R = REAL_SPECS[t.id];
  const g = game[t.id];
  if (!R || R.racer || R.helicopter) continue;
  if (R.vs0) ok(`${t.id}: Vs0 ${r0(g.vs0)} kt is 0.45–1.15 × the real ${R.vs0}`, g.vs0 / R.vs0 >= 0.45 && g.vs0 / R.vs0 <= 1.15, `×${r2(g.vs0 / R.vs0)}`);
  if (R.vmo) ok(`${t.id}: Vne ${r0(g.vne)} kt is 0.6–1.2 × the real limit ${R.vmo}`, g.vne / R.vmo >= 0.6 && g.vne / R.vmo <= 1.2, `×${r2(g.vne / R.vmo)}`);
  ok(`${t.id}: Vref (1.3 Vs0) is under the red line with room, and above Vs0`, g.vref < g.vne * 0.6 && g.vref > g.vs0);
}

/* ---- 5. ceilings ------------------------------------------------------- */
{
  const F = P.CEILING_FADE;
  ok('the fade is documented as 1.05× → 1.25× down to 0.35', F.from === 1.05 && F.to === 1.25 && F.floor === 0.35);
  ok('ceilingFactor: 1 at and below 1.05 × the ceiling', [0, 1000, 20000, 39100, 41055].every((h) => P.ceilingFactor(h, 39100) === 1));
  ok('ceilingFactor: the floor at and above 1.25 ×', P.ceilingFactor(48875, 39100) === F.floor && P.ceilingFactor(90000, 39100) === F.floor);
  const mid = P.ceilingFactor(39100 * 1.15, 39100);
  ok('ceilingFactor: halfway along, halfway down, and monotonic', Math.abs(mid - (1 + F.floor) / 2) < 1e-9 && P.ceilingFactor(42000, 39100) > P.ceilingFactor(44000, 39100), r2(mid));
  ok('ceilingFactor: a type with no ceiling is left alone', P.ceilingFactor(60000, 0) === 1 && P.ceilingFactor(60000, undefined) === 1 && P.ceilingFactor(60000, null) === 1);
  for (const t of types) {
    const g = game[t.id];
    if (g.rotor) continue;
    const ratio = g.absoluteCeilingFt / g.ceiling;
    ok(`${t.id}: the climb runs out at ${r0(g.absoluteCeilingFt)} ft, 0.9–1.25 × its ${g.ceiling} ft ceiling`, ratio >= 0.9 && ratio <= 1.25, `×${r2(ratio)}`);
  }
}

/* ---- 6. climb ---------------------------------------------------------- */
{
  const fighters = ['f22', 'f35b', 'fa18', 'vanguard'].map((id) => types.find((t) => t.id === id));
  const airliners = types.filter((t) => t.class === 'Airliner');
  const minF = Math.min(...fighters.map((t) => game[t.id].climbFpm));
  const maxA = Math.max(...airliners.map((t) => game[t.id].climbFpm));
  ok('every fast jet out-climbs every airliner at sea level (Concorde included)', minF > maxA, `fighters from ${r0(minF)} ft/min, airliners to ${r0(maxA)}`);
  ok('every airliner out-climbs the trainer', Math.min(...airliners.map((t) => game[t.id].climbFpm)) > game.skylark.climbFpm, `trainer ${r0(game.skylark.climbFpm)} ft/min`);
  for (const t of types) {
    const g = game[t.id];
    const R = REAL_SPECS[t.id];
    if (g.rotor) continue;
    ok(`${t.id}: a sane best climb (500–90,000 ft/min)`, g.climbFpm > 500 && g.climbFpm < 90000, `${r0(g.climbFpm)} ft/min`);
    if (R && R.climb && !R.racer) ok(`${t.id}: …within 0.4–5 × the real ${R.climb} ft/min`, g.climbFpm / R.climb >= 0.4 && g.climbFpm / R.climb <= 5, `×${r2(g.climbFpm / R.climb)}`);
  }
}

/* ---- 7. in-game order -------------------------------------------------- */
{
  const others = types.filter((t) => t.id !== 'massimo' && t.id !== 'tpose');
  ok('Air Massimo has the highest red line and the highest ceiling of every type (T-Pose Harrison flies on his numbers)',
    others.every((t) => game.massimo.vne > game[t.id].vne && game.massimo.ceiling >= game[t.id].ceiling) && game.tpose.ceiling === game.massimo.ceiling);
  const realFighters = ['f22', 'f35b', 'fa18', 'a10', 'vanguard', 'osprey'];
  ok('the Raptor has the best thrust-to-weight of the real fighters', realFighters.filter((id) => id !== 'f22').every((id) => game.f22.tw > game[id].tw), realFighters.map((id) => `${id} ${r2(game[id].tw)}`).join(', '));
  const giants = ['belugaxl', 'dreamlifter', 'an225', 'c5'];
  const liners = ['a320', 'b747', 'a380', 'b737', 'a321', 'b787', 'a350', 'b777'];
  ok('the giants carry less thrust per weight than the airliners (they need the long runway)', Math.max(...giants.map((id) => game[id].tw)) < Math.min(...liners.map((id) => game[id].tw)));
  const military = types.filter((t) => (t.class === 'Fighter' || t.class === 'Carrier') && t.id !== 'a10');
  ok('the A-10 is the slowest military jet on the red line', military.every((t) => game[t.id].vne > game.a10.vne), `${r0(game.a10.vne)} kt against ${military.map((t) => `${t.id} ${r0(game[t.id].vne)}`).join(', ')}`);
  ok('the airliners\' red lines are their published Vmo to within 3 %', liners.every((id) => Math.abs(game[id].vne / REAL_SPECS[id].vmo - 1) <= 0.03), liners.map((id) => `${id} ${r0(game[id].vne)}/${REAL_SPECS[id].vmo}`).join(' '));
  ok('the Q400 is held to its published Vmo too', Math.abs(game.q400.vne / REAL_SPECS.q400.vmo - 1) <= 0.03, `${r0(game.q400.vne)} kt`);
}

/* ---- 8. in the flight model -------------------------------------------- */
{
  const TER = await imp('src/world/terrain.js');
  TER.applyMap(TER.MAP.id);
  const { Weather } = await imp('src/world/weather.js');
  const weather = new Weather();
  weather.load({ time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
  const plain = (y) => 1.225 * Math.exp(-y / 8500);

  P.applyAircraft('a320');
  const ac = new P.Aircraft();
  ac.reset({ pos: new THREE.Vector3(0, 0, 0), headingDeg: 90, speed: 120, altAGL: 500, engineOn: true });
  ac.pos.y = 39100 / FT;
  ok('a320: at its ceiling the density is the plain atmosphere\'s', Math.abs(ac.density - plain(ac.pos.y)) < 1e-9);
  ac.pos.y = (39100 * 1.3) / FT;
  ok('a320: at 1.3 × its ceiling the flight model sees 0.35 of the air', Math.abs(ac.density / plain(ac.pos.y) - 0.35) < 1e-9, r2(ac.density / plain(ac.pos.y)));
  ac.pos.y = 2000 / FT;
  ok('a320: a cruise at 2,000 ft is untouched', ac.density === plain(ac.pos.y));

  // The trainer: a 172 that could climb to 26,000 ft before this now cannot
  // hold 18,000 — at full power, level, at any speed, the drag beats the
  // thrust; at 8,000 ft (well under its ceiling) there is still power in hand.
  P.applyAircraft('skylark');
  // Level flight at each speed: the nose held at the angle of attack that
  // lifts the weight (CL = W / qS, so alpha = (CL - CL0) / CLa), one step of
  // the flight model, and what thrust has over drag — the most over the
  // speeds it can fly at (a speed that needs more than CLmax is a stall).
  const excess = (altFt) => {
    const a0 = P.SPEC;
    const W = a0.mass * G;
    let best = -Infinity;
    const tried = [];
    for (let V = 24; V <= a0.vne; V += 3) {
      const rho = 1.225 * Math.exp(-(altFt / FT) / 8500) * P.ceilingFactor(altFt, a0.ceiling);
      const CL = W / (0.5 * rho * V * V * a0.wingArea);
      if (CL > a0.CL0 + a0.CLa * a0.alphaStall) continue;
      const alpha = (CL - a0.CL0) / a0.CLa;
      const a = new P.Aircraft();
      a.reset({ pos: new THREE.Vector3(0, 0, 0), headingDeg: 90, speed: V, altAGL: 500, engineOn: true });
      a.pos.y = altFt / FT;
      a.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), alpha));
      a.mode = 'realistic';
      a.controls.throttle = 1;
      a.rpm = 1;
      a.debug = true;
      a.update(1 / 120, weather);
      const d = a.debugData;
      if (!d || Math.abs(d.lift / W - 1) > 0.12) continue; // not level after all
      tried.push(`${V} m/s: ${d.thrust - d.drag >= 0 ? "+" : ""}${Math.round(d.thrust - d.drag)} N`);
      best = Math.max(best, d.thrust - d.drag);
    }
    return { best, tried };
  };
  const e8 = excess(8000);
  const e18 = excess(18000);
  ok('skylark: at 8,000 ft (well under its ceiling), level at full power, there is thrust in hand', e8.best > 50, `${r0(e8.best)} N in hand (${e8.tried.join(', ')})`);
  ok('skylark: at 18,000 ft (1.29 × its ceiling) the drag beats full power at every speed it can fly level — it cannot hold height', e18.tried.length > 0 && e18.best < 0, `${r0(e18.best)} N (${e18.tried.join(', ')})`);
  P.applyAircraft(T.DEFAULT_AIRCRAFT_ID || 'skylark');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
