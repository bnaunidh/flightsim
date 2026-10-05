/**
 * Node checks for Achievements. Plain node:
 *
 *   node tests/features/achievements.mjs
 *
 *   1. The catalogue: 30-45 entries, unique ids, every one has a name, a
 *      how-to, a real icon glyph and a group; "The Sky's the Limit" is the
 *      owner's exact name and how-to line.
 *   2. The store: blank/save/load round-trips, and a broken save starts
 *      fresh instead of throwing.
 *   3. The rules, pure — no game, no DOM: one event in, the right ids out,
 *      each one once, and the counted ones (every plane, every map, five
 *      golds, ten flights) build up correctly. "Full house" fires once
 *      everything else has.
 *   4. The top of the sky, in the real flight model: a climbing aeroplane at
 *      69,900 ft reaches the achievement, never climbs past about 70,000 ft,
 *      and the event fires once — the same physics the browser check flies.
 *   5. The plug-in registers itself and survives being loaded without a page.
 */

// ui.js touches the DOM at inject time, and world/terrain.js paints textures
// on a canvas when it builds — a minimal stand-in covers both (the same
// canvas stub tests/features/fire.mjs and fun.mjs use).
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
    setAttribute() {},
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  }),
  head: { appendChild() {} },
  body: { appendChild() {} },
};

const root = new URL('../../src/', import.meta.url);
const imp = (p) => import(new URL(p, root).href);

let passed = 0;
let failed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const Data = await imp('features/achievements/data.js');
const Icons = await imp('features/achievements/icons.js');
const Store = await imp('features/achievements/store.js');
const Rules = await imp('features/achievements/rules.js');

/* ---- 1. the catalogue -------------------------------------------------- */
{
  const { ACHIEVEMENTS } = Data;
  ok('catalogue: 30-45 achievements', ACHIEVEMENTS.length >= 30 && ACHIEVEMENTS.length <= 45, `${ACHIEVEMENTS.length}`);
  ok('catalogue: every id is unique', new Set(ACHIEVEMENTS.map((a) => a.id)).size === ACHIEVEMENTS.length);
  ok(
    'catalogue: every one has a name, a how-to, a group and a boolean hidden',
    ACHIEVEMENTS.every((a) => a.name && a.how && a.group && (a.hidden === undefined || typeof a.hidden === 'boolean')),
    ACHIEVEMENTS.find((a) => !a.name || !a.how || !a.group)?.id
  );
  ok(
    'catalogue: every glyph is one this file actually draws',
    ACHIEVEMENTS.every((a) => Icons.GLYPH_IDS.includes(a.glyph)),
    ACHIEVEMENTS.find((a) => !Icons.GLYPH_IDS.includes(a.glyph))?.id
  );
  ok(
    'catalogue: every achievement names a real medallion tier',
    ACHIEVEMENTS.every((a) => Icons.TIER_IDS.includes(a.tier)),
    ACHIEVEMENTS.find((a) => !Icons.TIER_IDS.includes(a.tier))?.id
  );
  ok('catalogue: at least a few are hidden, and most are not', ACHIEVEMENTS.some((a) => a.hidden) && ACHIEVEMENTS.some((a) => !a.hidden));
  const sky = Data.ACHIEVEMENTS_BY_ID.get('sky-limit');
  ok(
    "catalogue: \"The Sky's the Limit\" is the owner's exact name and how-to",
    !!sky && sky.name === "The Sky's the Limit" && sky.how === 'Reach the top of the sky: 70,000 ft.',
    sky && `${sky.name} / ${sky.how}`
  );
  ok('catalogue: every progress target is a real, positive number', ACHIEVEMENTS.filter((a) => a.progress).every((a) => Number.isFinite(a.progress.target) && a.progress.target > 0));
  ok('catalogue: "land every plane" matches the live hangar economy', Data.ALL_LANDABLE_AIRCRAFT.length === Data.ACHIEVEMENTS_BY_ID.get('every-plane').progress.target);
  ok('catalogue: "land on every map" matches the live map list', Data.ALL_MAP_IDS.length === Data.ACHIEVEMENTS_BY_ID.get('every-map').progress.target && Data.ALL_MAP_IDS.length > 10);
  // One category achievement per menus.js heading, read generously (menus.js
  // is not imported here — see progression.js's own CATEGORY_TIERS for the
  // same nine ids this reads).
  const cats = ['training', 'airline', 'delivery', 'rescue', 'fire', 'challenge', 'events', 'meteor', 'military'];
  ok('catalogue: one achievement per mission category', cats.every((c) => Data.ACHIEVEMENTS_BY_ID.has(`cat-${c}`)));
}

/* ---- 2. the store ------------------------------------------------------- */
{
  const mem = new Map();
  const fakeStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
  ok('store: no storage at all loads blank', JSON.stringify(Store.load(null)) === JSON.stringify(Store.blank()));
  const b = Store.load(fakeStorage);
  b.unlocked['first-takeoff'] = '2026-10-04';
  b.counts.planes.push('skylark');
  ok('store: it saves', Store.save(b, fakeStorage));
  const back = Store.load(fakeStorage);
  ok('store: …and loads back the same', JSON.stringify(back) === JSON.stringify(b));
  mem.set(Store.KEY, '{not json');
  ok('store: a broken save starts fresh instead of throwing', JSON.stringify(Store.load(fakeStorage)) === JSON.stringify(Store.blank()));
  mem.set(Store.KEY, JSON.stringify({ unlocked: { x: 1 }, counts: { planes: 'not an array', golds: 'NaN' } }));
  const recovered = Store.load(fakeStorage);
  ok(
    'store: odd-shaped fields fall back to sane defaults instead of throwing',
    Array.isArray(recovered.counts.planes) && recovered.counts.planes.length === 0 && recovered.counts.golds === 0,
    JSON.stringify(recovered.counts)
  );
}

/* ---- 3. the rules, pure -------------------------------------------------- */
{
  const { applyEvent } = Rules;

  // First take-off, once.
  let s = Store.blank();
  ok('rules: liftoff unlocks first-takeoff', applyEvent(s, 'liftoff', {}).includes('first-takeoff'));
  ok('rules: …not a second time', applyEvent(s, 'liftoff', {}).length === 0);

  // T-Pose Harrison and Massimo, kept as the fun ones.
  s = Store.blank();
  ok('rules: liftoff as T-Pose Harrison unlocks tpose-up', applyEvent(s, 'liftoff', { aircraft: 'tpose' }).includes('tpose-up'));
  s = Store.blank();
  ok('rules: a slow Massimo take-off does not unlock Mach Massimo', !applyEvent(s, 'liftoff', { aircraft: 'massimo', speedKts: 90 }).includes('massimo-fast'));
  ok('rules: …a fast one does', applyEvent(s, 'liftoff', { aircraft: 'massimo', speedKts: 160 }).includes('massimo-fast'));

  // Touchdown: butter, crosswind, night, storm — and never on a crash.
  s = Store.blank();
  ok('rules: a crashed touchdown unlocks nothing', applyEvent(s, 'touchdown', { crashed: true, vsFpm: 10 }).length === 0);
  s = Store.blank();
  ok('rules: under 60 ft/min unlocks Butter', applyEvent(s, 'touchdown', { vsFpm: -45 }).includes('butter-landing'));
  s = Store.blank();
  ok('rules: 60 ft/min exactly does not', !applyEvent(s, 'touchdown', { vsFpm: -60 }).includes('butter-landing'));
  s = Store.blank();
  ok('rules: a crosswind landing on the runway unlocks Crab Walk', applyEvent(s, 'touchdown', { vsFpm: -200, onRunway: true, crosswindKts: 14 }).includes('crosswind-landing'));
  s = Store.blank();
  ok('rules: the same crosswind off the runway does not', !applyEvent(s, 'touchdown', { vsFpm: -200, onRunway: false, crosswindKts: 14 }).includes('crosswind-landing'));
  s = Store.blank();
  ok('rules: a night landing unlocks Night Owl', applyEvent(s, 'touchdown', { vsFpm: -200, night: true }).includes('night-landing'));
  s = Store.blank();
  ok('rules: a stormy landing unlocks Through the Weather', applyEvent(s, 'touchdown', { vsFpm: -200, stormy: true }).includes('storm-landing'));

  // Every plane, every map: counted, and the catalogue's own targets.
  s = Store.blank();
  {
    let got = false;
    for (const id of Data.ALL_LANDABLE_AIRCRAFT) got = applyEvent(s, 'touchdown', { vsFpm: -200, aircraft: id }).includes('every-plane') || got;
    ok('rules: landing every aeroplane unlocks Hangar Full', got && s.counts.planes.length === Data.ALL_LANDABLE_AIRCRAFT.length);
  }
  s = Store.blank();
  {
    let got = false;
    for (const id of Data.ALL_MAP_IDS) got = applyEvent(s, 'touchdown', { vsFpm: -200, map: id }).includes('every-map') || got;
    ok('rules: landing on every map unlocks Island Hopper', got && s.counts.maps.length === Data.ALL_MAP_IDS.length);
  }
  s = Store.blank();
  applyEvent(s, 'touchdown', { vsFpm: -200, aircraft: 'skylark' });
  ok('rules: landing the same plane twice only counts once', applyEvent(s, 'touchdown', { vsFpm: -200, aircraft: 'skylark' }).length === 0 && s.counts.planes.length === 1);

  // The carrier's wire, and the top of the sky.
  s = Store.blank();
  ok('rules: arrested unlocks Trapped', applyEvent(s, 'arrested', {}).includes('carrier-trap'));
  s = Store.blank();
  ok("rules: ceiling unlocks The Sky's the Limit", applyEvent(s, 'ceiling', {}).includes('sky-limit'));
  ok('rules: …not a second time', applyEvent(s, 'ceiling', {}).length === 0);

  // Missions: one per category, gold medals, five golds, ten flights.
  s = Store.blank();
  ok('rules: a crashed mission unlocks nothing', applyEvent(s, 'missionComplete', { crashed: true, category: 'rescue', score: 95 }).length === 0);
  s = Store.blank();
  ok('rules: finishing a category unlocks its own achievement', applyEvent(s, 'missionComplete', { category: 'rescue', score: 40 }).includes('cat-rescue'));
  s = Store.blank();
  ok('rules: 89 is not a gold medal', !applyEvent(s, 'missionComplete', { category: 'delivery', score: 89 }).includes('gold-medal'));
  s = Store.blank();
  ok('rules: 90 is', applyEvent(s, 'missionComplete', { category: 'delivery', score: 90 }).includes('gold-medal'));
  s = Store.blank();
  {
    let five = false;
    for (let i = 0; i < 5; i++) five = applyEvent(s, 'missionComplete', { category: 'delivery', score: 95 }).includes('five-golds') || five;
    ok('rules: five gold-medal missions unlocks Golden Run', five && s.counts.golds === 5);
  }
  s = Store.blank();
  {
    let ten = false;
    for (let i = 0; i < 10; i++) ten = applyEvent(s, 'missionComplete', { category: 'training', score: 50 }).includes('ten-flights') || ten;
    ok('rules: ten finished flights unlocks Frequent Flyer', ten && s.counts.flights === 10);
  }

  // Air Force One: Captain and the secure room.
  s = Store.blank();
  ok('rules: afo "captain" unlocks Commander in Chief', applyEvent(s, 'missionComplete', { afo: 'captain' }).includes('afo-captain'));
  s = Store.blank();
  ok('rules: afo "president" unlocks To the Secure Room', applyEvent(s, 'missionComplete', { afo: 'president' }).includes('afo-secure'));

  // The other games: one each, from the extension's own startMode hook.
  s = Store.blank();
  ok('rules: startMode heli unlocks Rotors Up', applyEvent(s, 'startMode', { game: 'heli' }).includes('heli-first'));
  s = Store.blank();
  ok('rules: startMode boat unlocks Casting Off', applyEvent(s, 'startMode', { game: 'boat' }).includes('boat-first'));
  s = Store.blank();
  ok('rules: startMode car unlocks Key in the Ignition', applyEvent(s, 'startMode', { game: 'car' }).includes('car-first'));
  s = Store.blank();
  ok('rules: rocketStart unlocks Three, Two, One', applyEvent(s, 'rocketStart', {}).includes('rocket-first'));

  // Multiplayer: a race win, and three friends at once.
  s = Store.blank();
  ok('rules: raceWin unlocks Chequered Flag', applyEvent(s, 'raceWin', {}).includes('race-win'));
  s = Store.blank();
  ok('rules: two friends is not a squadron', !applyEvent(s, 'friends', { count: 2 }).includes('squadron'));
  ok('rules: three is', applyEvent(s, 'friends', { count: 3 }).includes('squadron'));

  // Rank: pilot and captain, read off progression.js's own rank ids.
  s = Store.blank();
  ok('rules: cadet unlocks neither rank achievement', applyEvent(s, 'rank', { rank: 'cadet' }).length === 0);
  s = Store.blank();
  ok('rules: pilot unlocks Pilot (not Captain)', applyEvent(s, 'rank', { rank: 'pilot' }).includes('rank-pilot') && !applyEvent(s, 'rank', { rank: 'pilot' }).includes('rank-captain'));
  s = Store.blank();
  const both = applyEvent(s, 'rank', { rank: 'captain' });
  ok('rules: captain unlocks both Pilot and Captain', both.includes('rank-pilot') && both.includes('rank-captain'));

  // Full house: everything else, then this fires.
  s = Store.blank();
  const everyId = Data.ACHIEVEMENTS.map((a) => a.id).filter((id) => id !== 'full-house');
  for (const id of everyId) s.unlocked[id] = '2026-10-04';
  ok('rules: full house has not fired on its own', !s.unlocked['full-house']);
  ok('rules: …one more event (with nothing left to do) fires it', applyEvent(s, 'liftoff', {}).includes('full-house'));
}

/* ---- 4. the top of the sky, in the real flight model --------------------- */
{
  const THREE = await imp('vendor/three.module.js');
  const T = await imp('world/terrain.js');
  const { Weather } = await imp('world/weather.js');
  const { Aircraft, EVENTS, SKY_CEILING_FT } = await imp('aircraft/physics.js');
  const FT = 3.28084;

  ok('physics: the ceiling is 70,000 ft', SKY_CEILING_FT === 70000);

  T.applyMap('kestrel');
  const scene = new THREE.Scene();
  T.createTerrain(scene, 'low');
  const weather = new Weather();
  weather.load({ time: 'day', condition: 'clear', windSpeedKts: 4, windDirDeg: 90 });

  const ac = new Aircraft();
  ac.reset({ pos: new THREE.Vector3(0, 0, 0), headingDeg: 90, speed: 55, altAGL: 500, engineOn: true });
  ac.controls.throttle = 0.85;
  ac.pos.y = 69900 / FT;
  ac.vel.y = 6; // a steady 1,200 ft/min climb, right where the brief sets it
  let ceilingEvents = 0;
  ac.on(EVENTS.CEILING, () => ceilingEvents++);
  let maxFt = 0;
  let belowBandUntouched = true;
  for (let i = 0; i < 20 * 30; i++) {
    const before = ac.vel.y;
    ac.update(1 / 30, weather);
    maxFt = Math.max(maxFt, ac.pos.y * FT);
    // Nothing below 68,000 ft is ever touched by the ceiling at all — checked
    // on the way down, once this run is past it.
    if (ac.pos.y * FT < 68000 && ac.vel.y > before + 1e-6) belowBandUntouched = false;
  }
  ok('physics: it climbs from 69,900 ft towards the top', maxFt > 69900);
  ok('physics: …and never past about 70,000 ft', maxFt < 70010, `reached ${maxFt.toFixed(1)} ft`);
  ok("physics: the ceiling event (and so the achievement) fires", ceilingEvents >= 1, `${ceilingEvents} times`);

  // A normal cruise, nowhere near the ceiling: never touched, never fires.
  const ac2 = new Aircraft();
  ac2.reset({ pos: new THREE.Vector3(0, 0, 0), headingDeg: 90, speed: 55, altAGL: 2000, engineOn: true });
  ac2.controls.throttle = 0.8;
  let fired2 = 0;
  ac2.on(EVENTS.CEILING, () => fired2++);
  for (let i = 0; i < 10 * 30; i++) ac2.update(1 / 30, weather);
  ok('physics: a normal cruise at 2,000 ft never sees the ceiling', fired2 === 0);

  /*
   * The clamp itself, isolated from whether the thin air up there would have
   * stalled the climb anyway (it does, for a light trainer — the run above
   * barely gains any height on its own). Force an unrealistically fast climb
   * 50 ft short of the line and take one physics step: the cap on vel.y is
   * what has to catch this, not a stall.
   */
  const ac3 = new Aircraft();
  ac3.reset({ pos: new THREE.Vector3(0, 0, 0), headingDeg: 90, speed: 55, altAGL: 500, engineOn: true });
  ac3.pos.y = (SKY_CEILING_FT - 50) / FT;
  ac3.vel.y = 300; // nothing in this game climbs anywhere near this fast
  ac3.update(1 / 30, weather);
  const expectedCapMps = (0.15 * 50) / FT;
  ok(
    'physics: an unrealistic 300 m/s climb 50 ft out is clamped to the ceiling pull, not left alone',
    ac3.vel.y >= 0 && ac3.vel.y <= expectedCapMps + 0.5,
    `${ac3.vel.y.toFixed(2)} m/s, expected about ${expectedCapMps.toFixed(2)}`
  );
  ok('physics: …and the one step did not jump past the ceiling', ac3.pos.y * FT <= SKY_CEILING_FT + 1);
}

/* ---- 5. the plug-in ------------------------------------------------------ */
{
  const ext = await imp('game/extensions.js');
  let err = null;
  try {
    await imp('features/achievements/index.js');
  } catch (e) {
    err = e;
  }
  ok('plug-in: features/achievements/index.js loads without a page', !err, err && err.message);
  const st = ext.extStatus().find((e) => e.id === 'achievements');
  ok('plug-in: it registers as "achievements"', !!st && st.live);
  const reg = ext.extensions().find((e) => e.id === 'achievements');
  ok('plug-in: …with the hooks it needs', reg && ['install', 'startMode', 'update'].every((h) => typeof reg[h] === 'function'));
  const idx = (await import('node:fs')).readFileSync(new URL('features/index.js', root), 'utf8');
  ok('plug-in: it is listed in features/index.js', /import '\.\/achievements\/index\.js';/.test(idx));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
