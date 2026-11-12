/**
 * A disaster's weather ends with the flight it came in (owner, 2026-11-11: "if i do fog bank,
 * when i respawn its still there"). world/weather.js clearEvents, called by main.js startMode
 * (Restart / Fly again / Try again) and returnToAirport.
 *
 *   node tests/features/weather-respawn.mjs
 */
import { readFileSync } from 'node:fs';
const { Weather } = await import('../../src/world/weather.js');
const { findEvent } = await import('../../src/game/disasters.js');
let passed = 0;
let failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const w = new Weather();
w.load({ condition: 'clear', windSpeedKts: 8, windDirDeg: 90 });
const sim = { weather: w, audio: {}, aircraft: { failures: {} }, toggleFailure() {} };
for (const id of ['fogBank', 'stormCell']) {
  const ev = findEvent(id);
  ev.apply(sim);
  const during = w.effectiveCondition;
  w.clearEvents();
  ok(`${id}: its sky is in force, then gone after a respawn`, during !== 'clear' && w.effectiveCondition === 'clear' && !w._tempCond, `${during} -> ${w.effectiveCondition}`);
}
w.gustFront({ speedMultiplier: 2.5, turnDeg: 60, seconds: 60 });
w.startShear({ down: 10, headwind: 12, seconds: 30 });
const gusting = w.windSpeedKts;
w.clearEvents();
ok('a gust front: the wind put back as it was before it', gusting > 8 && w.windSpeedKts === 8 && w.windDirDeg === 90 && w.baseWindKts === 8, `${gusting} -> ${w.windSpeedKts} kt from ${w.windDirDeg}`);
ok('a microburst: no downdraft after a respawn', w.downdraft === 0 && !w._shear);
const main = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
const sm = main.slice(main.indexOf('  async startMode('), main.indexOf('  restart() {'));
const rta = main.slice(main.indexOf('  returnToAirport() {'), main.indexOf('  returnToAirport() {') + 600);
ok('main.js: every flight start (Restart, Fly again, Try again) clears it before loading its weather', sm.indexOf('this.weather.clearEvents()') > 0 && sm.indexOf('this.weather.clearEvents()') < sm.indexOf('this.weather.load('));
ok('main.js: Return to airport clears it', rta.includes('this.weather.clearEvents()'));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
