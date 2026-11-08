/**
 * Node checks for SIGNAL ZERO chapter 4, LOW WATER (src/story/ch04-low-water.js).
 *
 *   node tests/features/story-ch04.mjs
 *
 * What node can see without a browser:
 *   1. the chapter graph — it ships fourth, lazily; ONE beat, a boat shout
 *      (vehicle 'boat') on Longbank Sands; seven steps, every one a
 *      checkpoint with a target; the bible's six objectives;
 *   2. the places, on Longbank's own height field: the harbour and its
 *      mouth, the channel 9 m deep, the bar on a drying patch, the wreck and
 *      the case on the bar, Cole's line grounding at the bar's edge, the
 *      launch's own depth down the direct line;
 *   3. the pure rules — distance to the bar, the tide's bar height, the
 *      short cut — and the medal table;
 *   4. the script — Esi and Cole speak, Mara's "Lightning doesn't fly
 *      formation" lands here, the fail lines are kind — File 04, the recap,
 *      the achievements;
 *   5. the story director's boat plumbing: a boat beat goes into the boat
 *      list for startDrive and comes out again; a boat's pose is captured
 *      and put back through its own reset();
 *   6. resume: a save at every step resumes exactly there; after chapter 4
 *      the pointer is on chapter 5 (unshipped: TO BE CONTINUED).
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
const Beats = await imp('src/story/beats.js');
const Ch4 = await imp('src/story/ch04-low-water.js');
const { MAPS } = await imp('src/world/maps.js');
const T = await imp('src/world/terrain.js');
const Boat = await imp('src/game/missions-boat.js');
const Ach = await imp('src/features/achievements/data.js');
const Rules = await imp('src/features/achievements/rules.js');

const mod = Ch4.CHAPTER_4;
const [B] = mod.beats;
const P = Ch4.PLACE;

/* ------------------------------------------------------------------ *
 * 1. The graph.
 * ------------------------------------------------------------------ */
{
  const entry = Chapters.CHAPTERS.find((c) => c.id === 'ch04-low-water');
  ok('ch4: the fourth chapter ships, lazily, as the boat on Longbank', !!entry && entry.available && typeof entry.load === 'function' && entry.n === 4 && entry.game === 'boat' && entry.map === 'longbank');
  const loaded = await Chapters.loadModule(entry);
  ok('ch4: loadModule brings the chapter in', loaded === mod && entry.module === mod);
  const shipped = Chapters.availableChapters().map((c) => c.n);
  ok('ch4: the shipped chapters run 1, 2, 3, 4 with no gaps; 5 onward are coming soon', shipped.join() === '1,2,3,4' && Chapters.CHAPTERS.filter((c) => c.n >= 5).every((c) => !c.available && !c.module && !c.load), shipped.join());
  ok('ch4: one beat, a boat shout on Longbank Sands at dawn', mod.beats.length === 1 && B.id === 'story-ch04-bank' && B.vehicle === 'boat' && B.subject === 'boat' && B.map === 'longbank' && B.weather.time === 'sunset' && MAPS.some((m) => m.id === 'longbank' && m.game === 'boat'));
  ok('ch4: a story def, hidden from every board, failing on a crash', B.game === 'story' && B.hidden === true && B.category === 'story' && B.failOnCrash === true);
  ok('ch4: six objectives, as the bible lists them', mod.objectives.length === 6 && /channel/.test(mod.objectives[0]) && /Cole/.test(mod.objectives[1]) && /bar/.test(mod.objectives[2]) && /On foot/.test(mod.objectives[3]) && /Hold E/.test(mod.objectives[4]) && /tide/.test(mod.objectives[5]));
  ok('ch4: a briefing — one line, three bullets, a route of three real places', mod.briefing.line.length > 20 && mod.briefing.bullets.length === 3 && mod.briefing.route.length === 3 && mod.briefing.route.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[2]));
  const labels = [B.startLabel, ...B.steps.map((s) => s.checkpoint)];
  ok('ch4: checkpoints in the bible\'s order — start, out of the harbour, past the halfway buoy, at the bar, at the wreck, case in hand, back aboard, home', labels.join('|') === 'Chapter start|Out of the harbour|Past the halfway buoy|At the bar|At the wreck|Case in hand|Back aboard|Home', labels.join('|'));
  ok('ch4: every step has an id, text, a check and a target', B.steps.every((s) => s.id && typeof s.text === 'string' && s.text.length > 10 && typeof s.check === 'function' && typeof s.target === 'function'));
  ok('ch4: the long boat legs roll-save (the channel, the bar, the way out)', ['channel', 'bar', 'out'].every((id) => B.steps.find((s) => s.id === id).rolling === true));
  ok('ch4: the on-foot steps say which key (O to get out and in, E held for the case)', /O,|\bO\b/.test(B.steps.find((s) => s.id === 'walk').text) && /Hold E/.test(B.steps.find((s) => s.id === 'case').text) && /O/.test(B.steps.find((s) => s.id === 'back').text));
  ok('ch4: the hooks the director calls', ['enterChapter', 'leaveChapter', 'medal', 'finale', 'update', 'onFail', 'onBeatDone'].every((k) => typeof mod[k] === 'function'));
  ok('ch4: difficulty modes Story / Pilot / Ace — more tide and a slower Cole on Story', Ch4.DIFF.story.tide > Ch4.DIFF.pilot.tide && Ch4.DIFF.pilot.tide > Ch4.DIFF.ace.tide && Ch4.DIFF.story.cole < Ch4.DIFF.pilot.cole && Ch4.DIFF.pilot.cole < Ch4.DIFF.ace.cole);
}

/* ------------------------------------------------------------------ *
 * 2. The places, on Longbank's own ground.
 * ------------------------------------------------------------------ */
T.applyMap('longbank');
{
  const berth = T.harbourBerth();
  const mouth = T.harbourMouth();
  ok('place: the harbour has a berth and a mouth, and the chapter\'s mouth is the map\'s', !!berth && !!mouth && Math.hypot(mouth.x - P.mouth.x, mouth.z - P.mouth.z) < 5, JSON.stringify({ berth, mouth }));
  ok('place: the channel is dredged 9 m deep at every turn the chapter names', P.channel.every((c) => -T.heightAt(c.x, c.z) >= 5.9), P.channel.map((c) => (-T.heightAt(c.x, c.z)).toFixed(1)).join());
  ok('place: the bar sits on a drying patch (its natural top is out of the water at the lowest tide)', T.heightAt(P.bar.cx, P.bar.cz) > 0.2 && T.heightAt(P.bar.cx, P.bar.cz) < 1);
  const d = (x, z) => -T.heightAt(x, z) - Boat.DRAUGHT;
  const line = [0.2, 0.4, 0.6, 0.8].map((k) => d(P.mouth.x + (P.landing.x - P.mouth.x) * k, P.mouth.z + (P.landing.z - P.mouth.z) * k));
  ok('place: the launch has water under her keel straight across the bank to the bar (the short cut is real)', line.every((v) => v > 2), line.map((v) => v.toFixed(1)).join());
  ok('place: the wreck, the case and the tail plate all lie on the bar; the plate about 60 m from the case', Ch4.distToBar(P.wreck.x, P.wreck.z) === 0 && Ch4.distToBar(P.case.x, P.case.z) === 0 && Ch4.distToBar(P.plate.x, P.plate.z) === 0 && Math.abs(Math.hypot(P.plate.x - P.case.x, P.plate.z - P.case.z) - 60) < 25, `${Math.round(Math.hypot(P.plate.x - P.case.x, P.plate.z - P.case.z))} m`);
  ok('place: the landing is the bar\'s west edge, the side nearest the channel', Ch4.distToBar(P.landing.x, P.landing.z) === 0 && P.landing.x < P.bar.cx && Math.abs(P.landing.x - (P.bar.cx - P.bar.w / 2)) < 1);
  // Cole's line from the mouth to his aim: the bank catches him at the bar's edge, not before.
  const s = { x: P.mouth.x + 30, z: P.mouth.z + 20 };
  const L = Math.hypot(P.coleAim.x - s.x, P.coleAim.z - s.z);
  let ground = null;
  for (let m = 0; m <= L && ground == null; m += 10) {
    const x = s.x + ((P.coleAim.x - s.x) / L) * m;
    const z = s.z + ((P.coleAim.z - s.z) / L) * m;
    if (-T.heightAt(x, z) - 0.6 <= 0 || Ch4.distToBar(x, z) < 6) ground = { m, x, z };
  }
  ok('place: Cole\'s corner-cut grounds him on the bar\'s edge (the mark), after most of the run', !!ground && ground.m > L * 0.9 && Ch4.distToBar(ground.x, ground.z) < 6, JSON.stringify(ground));
  ok('place: the tide the chapter gives Pilot is about eight minutes, and Cole\'s run is about two and a half', Ch4.DIFF.pilot.tide >= 420 && Ch4.DIFF.pilot.tide <= 540 && 10 + L / Ch4.DIFF.pilot.cole + 8 > 120 && 10 + L / Ch4.DIFF.pilot.cole + 8 < 200, `${Math.round(10 + L / Ch4.DIFF.pilot.cole + 8)} s for Cole`);
  // The platform: added, heightAt honours it, and taken away again.
  const before = T.heightAt(P.landing.x + 5, P.landing.z);
  T.addPlatform(P.bar.cx, P.bar.cz, P.bar.w, P.bar.d, Ch4.BAR_UP, 'test bar');
  const on = T.heightAt(P.landing.x + 5, P.landing.z);
  const off = T.heightAt(P.landing.x - 5, P.landing.z);
  T.PLATFORMS.splice(T.PLATFORMS.length - 1, 1);
  const after = T.heightAt(P.landing.x + 5, P.landing.z);
  ok('place: the bar platform makes dry sand (0.6 m out) the walker can step onto, and water a boat\'s length off it', before < 0 && Math.abs(on - Ch4.BAR_UP) < 0.01 && off < -1 && after === before, `${before.toFixed(2)} → ${on.toFixed(2)} on, ${off.toFixed(2)} off`);
  ok('place: the wet shelf round the bar is 12 m wide and a quarter-metre out — the walker\'s step-off, the launch\'s touch', P.shelf.w === P.bar.w + 24 && P.shelf.d === P.bar.d + 24 && Ch4.SHELF_UP >= 0.25 && Ch4.SHELF_UP < Ch4.BAR_UP && Ch4.distToBar(P.bar.cx - P.bar.w / 2 - 10, P.bar.cz, P.shelf) === 0 && Ch4.distToBar(P.bar.cx - P.bar.w / 2 - 20, P.bar.cz, P.shelf) > 7);
}

/* ------------------------------------------------------------------ *
 * 3. The rules and the medals.
 * ------------------------------------------------------------------ */
{
  ok('rule: distToBar is 0 inside the bar and the straight-line gap outside', Ch4.distToBar(P.bar.cx, P.bar.cz) === 0 && Math.abs(Ch4.distToBar(P.bar.cx - P.bar.w / 2 - 30, P.bar.cz) - 30) < 1e-9 && Math.abs(Ch4.distToBar(P.bar.cx - P.bar.w / 2 - 30, P.bar.cz - P.bar.d / 2 - 40) - 50) < 1e-9);
  ok('rule: distToPath measures to the nearest segment', Math.abs(Ch4.distToPath([{ x: 0, z: 0 }, { x: 100, z: 0 }], 50, 30) - 30) < 1e-9 && Math.abs(Ch4.distToPath([{ x: 0, z: 0 }, { x: 100, z: 0 }], 130, 40) - 50) < 1e-9);
  ok('rule: the bar stays up for the first 60% of the tide, then sinks smoothly to 0.3 m under', Ch4.barHeight(480, 480) === Ch4.BAR_UP && Math.abs(Ch4.barHeight(200, 480) - Ch4.BAR_UP) < 0.01 && Ch4.barHeight(96, 480) < Ch4.BAR_UP / 2 && Math.abs(Ch4.barHeight(0, 480) - Ch4.BAR_DOWN) < 1e-9);
  ok('rule: the short cut is off the channel and across the bank before the halfway buoy — not the channel itself, not the harbour', Ch4.isShortCut(-100, -600) && !Ch4.isShortCut(-230, -700) && !Ch4.isShortCut(-250, -1000) && !Ch4.isShortCut(-380, -200));
  const bronze = Ch4.verdict({ caseTaken: true, atBar: 200, coleEta: 160, tideLeft: 40, groundings0: 0, groundingsAtBar: 1, shortCut: false });
  const silver = Ch4.verdict({ caseTaken: true, atBar: 140, coleEta: 160, tideLeft: 80, groundings0: 0, groundingsAtBar: 1, shortCut: false });
  const gold = Ch4.verdict({ caseTaken: true, atBar: 120, coleEta: 160, tideLeft: 150, groundings0: 0, groundingsAtBar: 0, shortCut: true });
  const scraped = Ch4.verdict({ caseTaken: true, atBar: 120, coleEta: 160, tideLeft: 150, groundings0: 0, groundingsAtBar: 1, shortCut: true });
  const noCase = Ch4.verdict({ caseTaken: false, atBar: 120, coleEta: 160, tideLeft: 150, groundings0: 0, groundingsAtBar: 0, shortCut: true });
  ok('medal: bronze is the case; silver beats Cole with over a minute of tide; gold adds the short cut, 90 s and a clean hull', bronze.medal === 'bronze' && silver.medal === 'silver' && gold.medal === 'gold' && scraped.medal === 'silver' && noCase.medal === 'bronze', `${bronze.medal} ${silver.medal} ${gold.medal} ${scraped.medal} ${noCase.medal}`);
  ok('medal: scores rise with the medal and stay in 0..100; the breakdown names the case, Cole, the tide, the hull and the short cut', gold.score > silver.score && silver.score > bronze.score && [bronze, silver, gold].every((v) => v.score >= 0 && v.score <= 100) && gold.breakdown.map((b) => b.label).join('|') === 'The flight case|Cole Bannerman|Tide left|The hull|Short Cut');
}

/* ------------------------------------------------------------------ *
 * 4. The script, the file, the achievements.
 * ------------------------------------------------------------------ */
{
  const own = Object.keys(Script.LINES).filter((id) => Script.chapterOfLine(id) === 4);
  ok('script: chapter 4 has lines, 40 or fewer', own.length >= 18 && own.length <= 40, `${own.length}`);
  const whos = new Set(own.map((id) => Script.LINES[id].who));
  ok('script: Mara, Cole, Esi and Lark speak; Esi and Cole are in the cast with colours and voices', ['mara', 'cole', 'esi', 'lark'].every((w) => whos.has(w)) && Script.CAST.esi.firstSeen === 4 && /^#[0-9a-f]{6}$/i.test(Script.CAST.esi.colour) && Script.CAST.cole.voice);
  ok('script: Esi logs out loud ("Noted. Time and position."), Cole announces his own grounding, Mara says "don\'t be brave, be early" in the briefing', own.some((id) => /Noted/.test(Script.LINES[id].text) && Script.LINES[id].who === 'esi') && /aground/.test(Script.LINES['c4-cole-3'].text) && /brave/.test(mod.briefing.bullets[0]));
  ok('script: the finale — the crew list with M. Voss, the recorder\'s last line, and "Lightning doesn\'t fly formation"', /Voss/.test(Script.LINES['c4-h-lark-1'].text) && /not lightning/.test(Script.LINES['c4-h-lark-2'].text) && /Lightning doesn’t fly formation/.test(Script.LINES['c4-h-mara-3'].text));
  ok('script: the fail lines are kind (everyone dry, go again)', ['c4-fail-tide', 'c4-fail-hull'].every((id) => /again|checkpoint/i.test(Script.LINES[id].text) && !/dead|died|drown|killed/i.test(Script.LINES[id].text)));
  ok('file: File 04 is the tail plate and the 1986 rescue log signed D. Dumas', Script.FILES.f04 && Script.FILES.f04.chapter === 'ch04-low-water' && /tail plate/i.test(Script.FILES.f04.title) && /D\. DUMAS/.test(Script.FILES.f04.text));
  ok('recap: chapter 4\'s "Previously on" is three short lines', Script.RECAPS['ch04-low-water'].length === 3 && Script.RECAPS['ch04-low-water'].every((l) => l.split(/\s+/).length <= 14));
  const a1 = Ach.ACHIEVEMENTS.find((a) => a.id === 'story-low-water');
  const a2 = Ach.ACHIEVEMENTS.find((a) => a.id === 'story-short-cut');
  ok('achievements: "Out Before the Tide" (finish) and "Short Cut" (style) exist in the story group', !!a1 && a1.group === 'story' && /Tide/.test(a1.name) && !!a2 && a2.group === 'story' && a2.tier === 'silver');
  const store = { unlocked: {}, progress: {} };
  Rules.applyEvent(store, 'storyChapter', { chapter: 'ch04-low-water', medal: 'gold', style: ['short-cut'], secrets: [], files: ['f04'] });
  ok('achievements: finishing chapter 4 with the short cut unlocks both', !!store.unlocked['story-low-water'] && !!store.unlocked['story-short-cut'], Object.keys(store.unlocked).join());
}

/* ------------------------------------------------------------------ *
 * 5. The director's boat plumbing.
 * ------------------------------------------------------------------ */
{
  const n0 = Boat.BOAT_MISSIONS.length;
  const undo = Beats.registerBeats(mod.beats);
  ok('plumbing: registering the chapter\'s beats puts the boat beat where startDrive finds it (findBoatMission)', Boat.findBoatMission('story-ch04-bank') === B && Boat.BOAT_MISSIONS.length === n0 + 1);
  undo();
  ok('plumbing: …and the undo takes it out again', Boat.findBoatMission('story-ch04-bank') === null && Boat.BOAT_MISSIONS.length === n0);
  // A boat's pose: captured from a vehicle-shaped thing, put back through its reset().
  const V3 = (await imp('src/vendor/three.module.js')).Vector3;
  const fakeBoat = { spec: { kind: 'boat', id: 'boat' }, isBoat: true, pos: new V3(140, 0, -150), vel: new V3(3, 0, -1), quat: { x: 0, y: 0.2, z: 0, w: 0.98 }, heading: 95, speed: 3.2, throttle: 0.5, onGround: false, reset(o) { this.pos.copy(o.pos); this.heading = o.headingDeg; this.speed = 0; this.vel.set(0, 0, 0); } };
  const sim = { mode: 'drive', vehicle: fakeBoat, settings: { map: 'longbank' }, aircraftType: null };
  const pose = Save.capturePose(sim, Beats.craftOf(sim));
  ok('plumbing: craftOf() is the boat while sailing; its pose says game boat, on the water, at its place and heading', Beats.craftOf(sim) === fakeBoat && pose.game === 'boat' && pose.onGround === true && pose.pos[0] === 140 && pose.headingDeg === 95 && pose.vel[0] === 3, JSON.stringify({ craft: Beats.craftOf(sim) === fakeBoat, pose }));
  const clean = Save.sanitisePose(JSON.parse(JSON.stringify(pose)));
  const moved = { ...fakeBoat, pos: new V3(0, 0, 0), vel: new V3(0, 0, 0), heading: 0, speed: 0 };
  Save.applyPose({ ...sim, vehicle: moved }, clean, moved);
  ok('plumbing: applyPose puts a boat back through its own reset() with the way it had on', Math.abs(moved.pos.x - 140) < 1e-9 && Math.abs(moved.pos.z + 150) < 1e-9 && moved.heading === 95 && Math.abs(moved.speed - Math.hypot(3, 1)) < 1e-9 && moved.vel.x === 3);
  ok('plumbing: an aircraft is still the craft when flying', Beats.craftOf({ mode: 'mission', aircraft: { pos: {} }, vehicle: null }).pos !== undefined);
}

/* ------------------------------------------------------------------ *
 * 6. Resume from every checkpoint, and what comes after.
 * ------------------------------------------------------------------ */
{
  const CH = Chapters.CHAPTERS.map((c) => ({ id: c.id, available: c.available, beats: c.module ? c.module.beats : [] }));
  const bad = [];
  let n = 0;
  B.steps.forEach((s, si) => {
    const data = Save.blank();
    data.chapter = mod.id;
    data.beat = B.id;
    data.step = si;
    data.checkpoint = s.checkpoint;
    data.pose = Save.sanitisePose({ game: 'boat', map: 'longbank', aircraft: null, pos: [100, 0, -150], quat: [0, 0, 0, 1], vel: [2, 0, 0], onGround: true });
    const back = Save.migrate(JSON.parse(JSON.stringify(data)));
    const p = Save.resumePlan(back, CH);
    n++;
    if (!(p.kind === 'resume' && p.exact && p.beatIndex === 0 && p.step === si && p.beat === B.id)) bad.push(`${s.id}:${JSON.stringify(p)}`);
  });
  ok('resume: a save at every step resumes exactly there (a boat pose survives the round trip)', bad.length === 0 && n === 7, bad.slice(0, 3).join(' ') || `${n} checkpoints`);
  const K = mod._state;
  K.t = 30;
  K.tide = 400;
  K.tideTotal = 480;
  K.shortCut = true;
  K.caseTaken = true;
  K.atBar = 120;
  K.coleEta = 160;
  K.said = { 'c4-mara-1': true };
  K.cole = { pos: { x: 10, z: -900 }, state: 'race' };
  const saved = JSON.parse(JSON.stringify(B.save()));
  ok('resume: the beat\'s save() is small plain data (the tide, the case, Cole\'s place…)', saved.tide === 400 && saved.caseTaken === true && saved.shortCut === true && saved.colePos[1] === -900 && saved.said.includes('c4-mara-1') && JSON.stringify(saved).length < 700);
  K.tide = 0;
  K.caseTaken = false;
  K.shortCut = false;
  K.said = {};
  K.cole = null;
  B.resume(saved, { sim: {} });
  ok('resume: the beat\'s resume() puts the tide, the case, the short cut and the lines said back', K.tide === 400 && K.caseTaken === true && K.shortCut === true && K.said['c4-mara-1'] === true && K.atBar === 120);
  const done = Save.blank();
  for (const id of ['ch01-the-glint', 'ch02-fire-line', 'ch03-range-control', 'ch04-low-water']) Save.recordChapter(done, id, { medal: 'silver', score: 80, time: 400 });
  done.chapter = 'ch05-the-bridge';
  const plan = Save.resumePlan(done, CH);
  ok('after: chapter 5 has not shipped, so Continue after chapter 4 is TO BE CONTINUED from chapter 4', plan.kind === 'tbc' && plan.last === 'ch04-low-water', JSON.stringify(plan));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
