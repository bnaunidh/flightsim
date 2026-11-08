/**
 * Node checks for SIGNAL ZERO chapter 3, RANGE CONTROL (src/story/ch03-range-control.js).
 *
 *   node tests/features/story-ch03.mjs
 *
 * What node can see without a browser:
 *   1. the chapter graph — it ships third, lazily; two beats in one flight on
 *      the Aurora Fjords in the Kestrel Courier; every step has an objective,
 *      a check and (bar none) a checkpoint; the bible's four objectives;
 *   2. the places, on the fjord's real height field: the air start and the
 *      corridor over the sea, the valley waypoints on the low shelf under the
 *      ridge band, the radar head on dry ground, runway 27's touchdown on
 *      the runway, the fjord box containing the field;
 *   3. the pure rules — under-the-ridges, terrain line of sight, the lock
 *      meter's fill and drain per difficulty, the cargo's knocks — and the
 *      medal table (bronze / silver / gold as the bible lists them);
 *   4. the script — RANGE CONTROL in capitals with no contractions, the new
 *      cast member (Aurora Approach), File 03, the chapter's recap — and
 *      the achievements for the chapter and the Low Road;
 *   5. resume: a save at every step of both beats resumes exactly there.
 */

globalThis.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
    classList: { add() {}, toggle() {}, remove() {} },
    addEventListener() {},
    appendChild() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute() {},
  }),
  body: { appendChild() {} },
  head: { appendChild() {} },
  getElementById: () => null,
  documentElement: { classList: { toggle() {}, add() {} } },
};

const root = new URL('../../', import.meta.url);
const imp = (p) => import(new URL(p, root).href);

let passed = 0;
let failed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const Chapters = await imp('src/story/chapters.js');
// Chapters 2-4 are Dev-mode only until the demo is done (chapters.js `dev`): this suite reads them with the door open.
Chapters.setDevCheck(() => true);
const Script = await imp('src/story/script.js');
const Save = await imp('src/story/save.js');
const Ch3 = await imp('src/story/ch03-range-control.js');
const { MAPS } = await imp('src/world/maps.js');
const { AIRCRAFT } = await imp('src/aircraft/types.js');
const T = await imp('src/world/terrain.js');
const A = await imp('src/world/airport.js');
const LZ = await imp('src/game/landing-zone.js');
const Ach = await imp('src/features/achievements/data.js');
const Rules = await imp('src/features/achievements/rules.js');

const mod = Ch3.CHAPTER_3;
const [CO, HO] = mod.beats;
const P = Ch3.PLACE;

/* ------------------------------------------------------------------ *
 * 1. The graph.
 * ------------------------------------------------------------------ */
{
  const entry = Chapters.CHAPTERS.find((c) => c.id === 'ch03-range-control');
  ok('ch3: the third chapter ships, lazily (available, a load(), no module until it is asked for)', !!entry && entry.available && typeof entry.load === 'function' && entry.n === 3 && entry.game === 'flight' && entry.map === 'fjord');
  const loaded = await Chapters.loadModule(entry);
  ok('ch3: loadModule brings the chapter in and it is this module', loaded === mod && entry.module === mod);
  const shippedN = Chapters.availableChapters().map((c) => c.n);
  ok('ch3: the shipped chapters run from 1 with no gaps and include 3', shippedN.length >= 3 && shippedN.every((n, i) => n === i + 1), shippedN.join());
  ok('ch3: two beats in one flight — the corridor, then home (continues)', mod.beats.length === 2 && CO.id === 'story-ch03-corridor' && HO.id === 'story-ch03-home' && HO.continues === true && !CO.continues);
  ok('ch3: the Kestrel Courier on the Aurora Fjords at dusk, cloudy', [CO, HO].every((b) => b.map === 'fjord' && b.aircraft === 'courier' && b.weather.time === 'sunset' && b.weather.condition === 'cloudy') && MAPS.some((m) => m.id === 'fjord') && AIRCRAFT.some((a) => a.id === 'courier'));
  ok('ch3: story defs, hidden from every board', [CO, HO].every((b) => b.game === 'story' && b.hidden === true && b.category === 'story'));
  ok('ch3: four objectives, as the bible lists them', mod.objectives.length === 4 && /Cruise/.test(mod.objectives[0]) && /left wing/.test(mod.objectives[1]) && /ridgelines/.test(mod.objectives[2]) && /Aurora Field/.test(mod.objectives[3]));
  ok('ch3: a briefing — one line, three bullets, a route of four real places', mod.briefing.line.length > 20 && mod.briefing.bullets.length === 3 && mod.briefing.route.length === 4 && mod.briefing.route.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[2]));
  const labels = [CO.startLabel, ...CO.steps.map((s) => s.checkpoint), HO.startLabel, ...HO.steps.map((s) => s.checkpoint)];
  ok('ch3: checkpoints in the bible\'s order — air start, the radio voice, the shape on your wing, lost it, on final', labels.join('|') === 'Air start|The corridor|The radio voice|The shape on your wing|Lost it|Clear of it|On final|Short final|Landed', labels.join('|'));
  ok('ch3: every step has an id, text, a check and a target (a marker from the first second)', [...CO.steps, ...HO.steps].every((s) => s.id && typeof s.text === 'string' && s.text.length > 10 && typeof s.check === 'function' && typeof s.target === 'function'));
  ok('ch3: the two cruise stretches roll-save; nothing else needs to', CO.steps[0].rolling === true && HO.steps[0].rolling === true && [...CO.steps.slice(1), ...HO.steps.slice(1)].every((s) => !s.rolling));
  ok('ch3: the hooks the director calls', ['enterChapter', 'leaveChapter', 'medal', 'finale', 'update', 'onFail', 'onBeatDone'].every((k) => typeof mod[k] === 'function'));
  ok('ch3: difficulty modes Story / Pilot / Ace, kind to strict', Ch3.DIFF.story.clock > Ch3.DIFF.pilot.clock && Ch3.DIFF.pilot.clock > Ch3.DIFF.ace.clock && Ch3.DIFF.story.lockFill > Ch3.DIFF.pilot.lockFill && Ch3.DIFF.pilot.lockFill > Ch3.DIFF.ace.lockFill && Ch3.DIFF.story.hideFor < Ch3.DIFF.pilot.hideFor && Ch3.DIFF.pilot.hideFor < Ch3.DIFF.ace.hideFor);
}

/* ------------------------------------------------------------------ *
 * 2. The places, on the fjord's own ground.
 * ------------------------------------------------------------------ */
T.applyMap('fjord');
A.refreshRunways();
{
  ok('place: the air start and the corridor are over the sea, east of the fjord mouth', T.heightAt(P.start.x, P.start.z) < 0 && T.heightAt(P.corridor.x, P.corridor.z) < 0 && P.start.x > P.corridor.x && P.corridor.x > P.mouth.x);
  ok('place: the valley waypoints run west down the low shelf, each under the ridge band', P.valley.every((w, i) => (i === 0 || w.x < P.valley[i - 1].x) && T.heightAt(w.x, w.z) < 120 && Ch3.underRidges(w.x, 110, w.z)), P.valley.map((w) => T.heightAt(w.x, w.z).toFixed(0)).join());
  ok('place: the radar head stands on dry ground on the north point, inside the fjord box', T.heightAt(P.radar.x, P.radar.z) > 60 && Ch3.underRidges(P.radar.x, 200, P.radar.z));
  const north = T.heightAt(700, -1400);
  const south = T.heightAt(-300, 1100);
  ok('place: the walls either side of the shelf stand well above the ridge band (something to hide under)', north > Ch3.CEIL_Y && south > Ch3.CEIL_Y, `north ${north.toFixed(0)} m, south ${south.toFixed(0)} m, ceiling ${Ch3.CEIL_Y} m`);
  const td = P.touchdown;
  ok('place: runway 27\'s touchdown is 200 m in from the east threshold, on the runway', Math.abs(td.x - (A.RUNWAY.thresholdEast.x - 200)) < 1 && LZ.inZone(td, LZ.runwayZones()) && T.isOnRunway(td.x, td.z));
  ok('place: the fjord box holds the field and the mouth, not the corridor', Ch3.underRidges(td.x, 50, td.z) && Ch3.underRidges(P.mouth.x - 300, 100, P.mouth.z) && !Ch3.underRidges(P.corridor.x, 100, P.corridor.z));
  ok('place: the shape\'s floor is above the ridge band (it watches the sky, not the valleys)', Ch3.SHAPE_FLOOR_Y > Ch3.CEIL_Y);
}

/* ------------------------------------------------------------------ *
 * 3. The rules and the medals.
 * ------------------------------------------------------------------ */
{
  // Line of sight over a ridge: a hump between the two blocks it; flat ground does not.
  const flat = () => 0;
  const hump = (x) => (x > 400 && x < 600 ? 500 : 0);
  ok('rule: line of sight is clear over flat ground and blocked by a ridge between', Ch3.lineOfSight({ x: 0, y: 300, z: 0 }, { x: 1000, y: 300, z: 0 }, flat) && !Ch3.lineOfSight({ x: 0, y: 300, z: 0 }, { x: 1000, y: 100, z: 0 }, hump));
  ok('rule: a shape high above the North Wall cannot see a Courier low in the valley behind it', !Ch3.lineOfSight({ x: 700, y: 480, z: -1700 }, { x: 700, y: 60, z: -150 }, T.heightAt));
  // The lock: fills while seen, drains while hidden, clamped.
  let l = 0.35;
  for (let i = 0; i < 100; i++) l = Ch3.lockStep(l, false, 0.1, Ch3.DIFF.pilot);
  const after10sSeen = l;
  for (let i = 0; i < 100; i++) l = Ch3.lockStep(l, true, 0.1, Ch3.DIFF.pilot);
  ok('rule: the lock fills over about 20 s in sight and drains in about 7 s hidden (Pilot)', Math.abs(after10sSeen - 0.85) < 0.02 && l === 0, `${after10sSeen.toFixed(2)} after 10 s seen, ${l.toFixed(2)} after 10 s hidden`);
  ok('rule: the lock is clamped to 0..1', Ch3.lockStep(0.99, false, 5) === 1 && Ch3.lockStep(0.01, true, 5) === 0);
  const story = Ch3.lockStep(0.5, false, 1, Ch3.DIFF.story);
  const ace = Ch3.lockStep(0.5, false, 1, Ch3.DIFF.ace);
  ok('rule: Ace locks faster than Story', ace > story);
  // The cargo.
  const smooth = Ch3.cargoStep(1, { gLoad: 1.05, bankDeg: 20, dt: 1 });
  const hardG = Ch3.cargoStep(1, { gLoad: 3.0, bankDeg: 20, dt: 0.1 });
  const steep = Ch3.cargoStep(1, { gLoad: 1, bankDeg: 78, dt: 1 });
  const wake = Ch3.cargoStep(1, { wake: true }, Ch3.DIFF.pilot);
  const thump = Ch3.cargoStep(1, { touchdownVs: -4.2 });
  const cooled = Ch3.cargoStep(1, { gLoad: 3.0, knockCool: 1.5, dt: 0.1 });
  ok('rule: smooth flying costs no cargo', smooth.cargo === 1 && smooth.why === null);
  ok('rule: hard g costs 6%, with a 2 s cool-down so one pull is one knock', Math.abs(hardG.cargo - 0.94) < 1e-9 && hardG.why === 'g' && hardG.knockCool === 2 && cooled.cargo === 1);
  ok('rule: a steep bank costs 3% a second', Math.abs(steep.cargo - 0.97) < 1e-9);
  ok('rule: the shape\'s wake costs the difficulty\'s knock (8% on Pilot), a firm touchdown 10%', Math.abs(wake.cargo - 0.92) < 1e-9 && wake.why === 'wake' && Math.abs(thump.cargo - 0.9) < 1e-9 && thump.why === 'touchdown');
  ok('rule: the cargo never goes below zero', Ch3.cargoStep(0.05, { wake: true }).cargo === 0);
  // The medals (story-bible.md §6, chapter 3).
  const bronze = Ch3.verdict({ cargo: 0.6, shapeAt: 40, lostAt: 200, clock: 20, lowRoad: false, landing: { score: 60 } });
  const silver = Ch3.verdict({ cargo: 0.85, shapeAt: 40, lostAt: 110, clock: 40, lowRoad: false, landing: { score: 70 } });
  const gold = Ch3.verdict({ cargo: 0.97, shapeAt: 40, lostAt: 100, clock: 75, lowRoad: true, landing: { score: 85 } });
  const noLow = Ch3.verdict({ cargo: 0.97, shapeAt: 40, lostAt: 100, clock: 75, lowRoad: false, landing: { score: 85 } });
  ok('medal: bronze is delivered; silver needs cargo ≥ 80% and the shape lost under 90 s', bronze.medal === 'bronze' && silver.medal === 'silver', `${bronze.medal} ${silver.medal}`);
  ok('medal: gold needs cargo ≥ 95%, more than 60 s to spare and the Low Road', gold.medal === 'gold' && noLow.medal === 'silver');
  ok('medal: the score is 0..100 and the breakdown names cargo, the shape, the clock, Low Road and the landing', [bronze, silver, gold].every((v) => v.score >= 0 && v.score <= 100) && gold.score > silver.score && silver.score > bronze.score && gold.breakdown.map((b) => b.label).join('|') === 'Cargo|The shape|Insulin clock|Low Road|Landing');
  ok('medal: never lost it reads honestly', /never lost/.test(Ch3.verdict({ cargo: 1, lostAt: null, shapeAt: 10, clock: 100 }).breakdown[1].value));
}

/* ------------------------------------------------------------------ *
 * 4. The script, the file, the achievements.
 * ------------------------------------------------------------------ */
{
  const own = Object.keys(Script.LINES).filter((id) => Script.chapterOfLine(id) === 3);
  ok('script: chapter 3 has lines, 40 or fewer', own.length >= 20 && own.length <= 40, `${own.length}`);
  const range = own.filter((id) => Script.LINES[id].who === 'range');
  ok('script: RANGE CONTROL speaks at least five times, in capitals, no contractions, and never threatens (no "destroy", no "fire")', range.length >= 5 && range.every((id) => Script.LINES[id].text === Script.LINES[id].text.toUpperCase() && !/'|’/.test(Script.LINES[id].text) && !/DESTROY|FIRE\b|KILL/.test(Script.LINES[id].text)), `${range.length} lines`);
  ok('script: the bible\'s lines are in — "YOU ARE INSIDE RANGE KITTIWAKE", "THANK YOU FOR YOUR COOPERATION", "no traffic on radar", and the tide for chapter 4', /INSIDE RANGE KITTIWAKE/.test(Script.LINES['c3-range-1'].text) && /THANK YOU FOR YOUR COOPERATION/.test(Script.LINES['c3-range-6'].text) && /no traffic on radar/.test(Script.LINES['c3-aurora-1'].text) && /tide/.test(Script.LINES['c3-h-mara-4'].text));
  ok('script: Mara tells half the truth in the finale — Gannet Two, something on the wing, "lightning"', /Gannet Two/.test(Script.LINES['c3-h-mara-2'].text) && /wing/.test(Script.LINES['c3-h-mara-3'].text) && /lightning/.test(Script.LINES['c3-h-mara-3'].text));
  ok('script: Aurora Approach is in the cast with a colour, a radio voice and a look', Script.CAST.aurora && /^#[0-9a-f]{6}$/i.test(Script.CAST.aurora.colour) && Script.CAST.aurora.voice && Script.CAST.aurora.look.kind === 'bust' && Script.CAST.aurora.firstSeen === 3);
  ok('script: every line the chapter speaks has a cast member', own.every((id) => Script.CAST[Script.LINES[id].who]));
  ok('script: the fail lines are kind (nobody hurt, go again)', ['c3-fail-clock', 'c3-fail-cargo', 'c3-fail-crash'].every((id) => /again|checkpoint/i.test(Script.LINES[id].text) && !/dead|died|killed/i.test(Script.LINES[id].text)));
  ok('file: File 03 is Aurora\'s radar log — an empty sky — found at the radar head', Script.FILES.f03 && Script.FILES.f03.chapter === 'ch03-range-control' && /radar/i.test(Script.FILES.f03.title) && /radar head/.test(Script.FILES.f03.where) && /empty/.test(Script.FILES.f03.text));
  ok('recap: chapter 3\'s "Previously on" is three short spoiler-safe lines', Script.RECAPS['ch03-range-control'].length === 3 && Script.RECAPS['ch03-range-control'].every((l) => l.split(/\s+/).length <= 14) && !/SENTINEL|Gannet/.test(Script.RECAPS['ch03-range-control'].join(' ')));
  const a1 = Ach.ACHIEVEMENTS.find((a) => a.id === 'story-range-control');
  const a2 = Ach.ACHIEVEMENTS.find((a) => a.id === 'story-low-road');
  ok('achievements: "Thank You for Your Cooperation" (finish) and "Low Road" (style) exist in the story group', !!a1 && a1.group === 'story' && /Cooperation/.test(a1.name) && !!a2 && a2.group === 'story' && a2.tier === 'silver');
  const store = { unlocked: {}, progress: {} };
  const out = Rules.applyEvent(store, 'storyChapter', { chapter: 'ch03-range-control', medal: 'gold', style: ['low-road'], secrets: [], files: ['f03'] });
  const got = (Array.isArray(out) ? out : out && out.unlocked ? out.unlocked : []).map((u) => (typeof u === 'string' ? u : u.id));
  const unlocked = Object.keys(store.unlocked || {});
  ok('achievements: finishing chapter 3 with the Low Road unlocks both', (got.includes('story-range-control') || unlocked.includes('story-range-control')) && (got.includes('story-low-road') || unlocked.includes('story-low-road')), JSON.stringify({ got, unlocked }));
}

/* ------------------------------------------------------------------ *
 * 5. Resume from every checkpoint.
 * ------------------------------------------------------------------ */
{
  const CH = Chapters.CHAPTERS.map((c) => ({ id: c.id, available: c.available, beats: c.module ? c.module.beats : [] }));
  const bad = [];
  let n = 0;
  mod.beats.forEach((b, bi) => {
    b.steps.forEach((s, si) => {
      const data = Save.blank();
      data.chapter = mod.id;
      data.beat = b.id;
      data.step = si;
      data.checkpoint = typeof s.checkpoint === 'string' ? s.checkpoint : b.startLabel;
      data.pose = Save.sanitisePose({ game: 'flight', map: b.map, aircraft: b.aircraft, pos: [3000, 500, 200], quat: [0, 0, 0, 1], vel: [-70, 0, 0] });
      const back = Save.migrate(JSON.parse(JSON.stringify(data)));
      const p = Save.resumePlan(back, CH);
      n++;
      if (!(p.kind === 'resume' && p.exact && p.beatIndex === bi && p.step === si && p.beat === b.id)) bad.push(`${b.id}#${si}:${JSON.stringify(p)}`);
    });
  });
  ok('resume: a save at every step of both beats resumes exactly there', bad.length === 0 && n === 7, bad.slice(0, 3).join(' ') || `${n} checkpoints`);
  // The beats' save() is small plain data and resume() takes it back.
  const K = mod._state;
  K.t = 12;
  K.clock = 250;
  K.cargo = 0.9;
  K.lock = 0.5;
  K.said = { 'c3-range-1': true };
  const saved = JSON.parse(JSON.stringify(CO.save()));
  ok('resume: the corridor\'s save() is small plain data (clock, cargo, lock, the lines said…)', saved.clock === 250 && saved.cargo === 0.9 && saved.lock === 0.5 && saved.said.includes('c3-range-1') && JSON.stringify(saved).length < 600);
  K.clock = 0;
  K.cargo = 0;
  K.lock = 0;
  K.said = {};
  CO.resume(saved, { runner: { step: { id: 'voice' } }, ac: { pos: { x: 0, y: 0, z: 0 } }, sim: {} });
  ok('resume: the corridor\'s resume() puts the clock, the cargo, the lock and the lines said back', K.clock === 250 && K.cargo === 0.9 && K.lock === 0.5 && K.said['c3-range-1'] === true);
  // After chapter 3, the pointer goes to chapter 4, which has not shipped: TO BE CONTINUED.
  const done = Save.blank();
  for (const id of ['ch01-the-glint', 'ch02-fire-line', 'ch03-range-control']) Save.recordChapter(done, id, { medal: 'silver', score: 80, time: 400 });
  done.chapter = 'ch04-low-water';
  const plan = Save.resumePlan(done, CH);
  const ch4 = Chapters.chapterById('ch04-low-water');
  ok('after: with chapter 4 unshipped, Continue after chapter 3 is TO BE CONTINUED from chapter 3; with it shipped, chapter 4 starts', ch4.available ? plan.kind === 'start' && plan.chapter === 'ch04-low-water' : plan.kind === 'tbc' && plan.last === 'ch03-range-control', JSON.stringify(plan));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
