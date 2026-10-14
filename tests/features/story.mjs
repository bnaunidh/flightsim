/**
 * Node checks for STORY MODE — "Signal Zero" (src/story). Run with plain node:
 *
 *   node tests/features/story.mjs
 *
 * No page, no canvas: everything here is pure data and pure functions.
 *
 *   1. SAVE AND CONTINUE (save.js): blank, round trip through a stand-in
 *      storage, a broken save, odd-shaped fields, a save from before this
 *      version, storage that refuses, the pose round trip.
 *   2. THE RESUME PLAN: fresh → chapter 1; a saved beat and step → exactly
 *      there; a beat the chapter no longer has → the chapter's start; a
 *      pointer at a chapter that has not shipped → TO BE CONTINUED; a
 *      finished chapter records its best medal and never loses it.
 *   3. THE CHAPTER GRAPH: twelve chapters and an epilogue, ids unique and
 *      in order; every shipped chapter has beats with a spawn, steps, a
 *      briefing with three bullets and a route, a recap, five objectives;
 *      every beat's steps are checkpoints by default, never more than ~75 s
 *      of play apart by the author's own estimates; chapter 1 is built on the
 *      real meteor-photo mission (its check functions, by reference).
 *   4. THE SCRIPT LINT (story-bible.md §10): every line names a real cast
 *      member; a chapter has 40 lines or fewer; most lines are 14 words or
 *      fewer; no "epic"/"awesome"; RANGE CONTROL speaks in capitals with no
 *      contractions; no real brands or countries; the recaps are three
 *      spoiler-safe lines; File 01 belongs to chapter 1.
 *   5. THE MEDAL TABLE (ch01 verdict()): bronze, silver and gold exactly as
 *      the bible writes them, and the score is bounded.
 *   6. THE PLUG-IN: importing the game's feature list registers 'story' with
 *      the one key it declares, and that key clashes with nothing.
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

const Save = await imp('src/story/save.js');
const Chapters = await imp('src/story/chapters.js');
const Script = await imp('src/story/script.js');
const Ch1 = await imp('src/story/ch01-the-glint.js');
const Beats = await imp('src/story/beats.js');
const Meteor = await imp('src/game/extra/meteor.js');

/* ------------------------------------------------------------------ *
 * 1. Save and continue.
 * ------------------------------------------------------------------ */
{
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  const b = Save.blank();
  ok('save: a blank has no chapter, the pilot difficulty and empty flags', !b.chapter && b.difficulty === 'pilot' && b.flags.files.length === 0 && b.v === Save.VERSION);
  ok('save: no storage loads blank and refuses to save', JSON.stringify(Save.load(null)) === JSON.stringify(Save.blank()) && Save.save(Save.blank(), null) === false);
  const s = Save.load(storage);
  s.chapter = 'ch01-the-glint';
  s.beat = 'story-ch01-chase';
  s.step = 2;
  s.checkpoint = 'Alongside the fireball';
  s.elapsed = 61.2;
  s.pose = { game: 'flight', map: 'condor', aircraft: 'tempest', pos: [-2100.5, 1711.2, 400], quat: [0.01, 0.7, 0.02, 0.71], vel: [80, -2, -40], headingDeg: 300, throttle: 0.7, gear: false, flaps: 0, fuel: 0.76, onGround: false };
  s.flags.files.push('f01');
  s.flags.secrets.push('condor-light');
  s.chapters['ch01-the-glint'] = { done: false, medal: null, score: 0, bestTime: null, style: [] };
  ok('save: it saves', Save.save(s, storage) && mem.has(Save.KEY));
  const back = Save.load(storage);
  ok('save: …and loads back the same (savedAt stamped)', back.chapter === 'ch01-the-glint' && back.beat === 'story-ch01-chase' && back.step === 2 && back.elapsed === 61.2 && back.savedAt > 0
    && back.pose.pos[0] === -2100.5 && back.pose.quat[3] === 0.71 && back.pose.fuel === 0.76 && back.pose.gear === false && back.flags.files[0] === 'f01' && back.flags.secrets[0] === 'condor-light', JSON.stringify(back).slice(0, 160));
  mem.set(Save.KEY, '{not json');
  ok('save: a broken save starts fresh instead of throwing', Save.load(storage).chapter === null);
  mem.set(Save.KEY, 'null');
  ok('save: "null" starts fresh instead of throwing', Save.load(storage).chapter === null);
  mem.set(Save.KEY, JSON.stringify({ chapter: 7, beat: ['x'], step: -3, difficulty: 'impossible', pose: { pos: [1, 2] }, flags: { files: 'f01', secrets: [1, 'ok'] }, chapters: { a: 'nope', 'ch01-the-glint': { done: 'yes', medal: 'diamond', score: 400 } }, playTime: 'lots' }));
  const odd = Save.load(storage);
  ok(
    'save: odd-shaped fields fall back to sane values instead of throwing',
    odd.chapter === null && odd.beat === null && odd.step === 0 && odd.difficulty === 'pilot' && odd.pose === null && odd.flags.files.length === 0 && odd.flags.secrets.join() === 'ok'
      && Object.keys(odd.chapters).join() === 'ch01-the-glint' && odd.chapters['ch01-the-glint'].done === false && odd.chapters['ch01-the-glint'].medal === null && odd.chapters['ch01-the-glint'].score === 100 && odd.playTime === 0,
    JSON.stringify(odd).slice(0, 200)
  );
  // A save from before there was a version field migrates as v1.
  mem.set(Save.KEY, JSON.stringify({ chapter: 'ch01-the-glint', beat: 'story-ch01-land', step: 1, pose: { pos: [0, 160, 0], onGround: true } }));
  const old = Save.load(storage);
  ok('save: a save with no version migrates to v1 and keeps its place', old.v === 1 && old.chapter === 'ch01-the-glint' && old.beat === 'story-ch01-land' && old.step === 1 && old.pose && old.pose.onGround === true && old.pose.quat.length === 4);
  const refusing = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } };
  ok('save: storage that refuses returns false and does not throw', Save.save(Save.blank(), refusing) === false);
  ok('save: hasProgress is false for a blank and true once a chapter is set', !Save.hasProgress(Save.blank()) && Save.hasProgress(back));
  ok('save: agoLabel reads naturally', Save.agoLabel(Date.now() - 20e3) === 'saved just now' && Save.agoLabel(Date.now() - 125e3) === 'saved 2 min ago' && /h ago/.test(Save.agoLabel(Date.now() - 3 * 3600e3)) && Save.agoLabel(0) === '');

  // The pose round trip against a stand-in flight model (the real reset() contract: pos, headingDeg, speed, altAGL, gearDown, fuel).
  const THREE = await imp('src/vendor/three.module.js');
  const fake = {
    pos: new THREE.Vector3(10, 500, -20),
    quat: new THREE.Quaternion(0.1, 0.2, 0.3, 0.9).normalize(),
    vel: new THREE.Vector3(70, -1.5, -35),
    heading: 123,
    controls: { throttle: 0.62 },
    gearDown: false,
    fuel: 400,
    onGround: false,
    flapStep: () => 1,
    setFlaps(n) { this._flaps = n; },
    readouts: () => ({ fuelPct: 0.55 }),
    reset(o) { this.pos.copy(o.pos); this.gearDown = o.gearDown; this._reset = o; this.onGround = o.altAGL === null; },
  };
  const sim = { aircraft: fake, aircraftType: { id: 'tempest' }, settings: { map: 'condor' }, mode: 'mission', input: { throttleTarget: 0 }, groundAt: () => 100 };
  const pose = Save.capturePose(sim);
  ok('pose: capture reads the aeroplane', pose.aircraft === 'tempest' && pose.map === 'condor' && pose.pos[1] === 500 && pose.vel[0] === 70 && pose.flaps === 1 && pose.fuel === 0.55 && pose.gear === false && pose.onGround === false && Math.abs(pose.quat[3] - fake.quat.w) < 1e-9);
  const json = Save.sanitisePose(JSON.parse(JSON.stringify(pose)));
  fake.pos.set(0, 0, 0);
  fake.quat.set(0, 0, 0, 1);
  fake.vel.set(0, 0, 0);
  Save.applyPose(sim, json);
  ok('pose: apply puts it back exactly (position, attitude, velocity, flaps, throttle)',
    fake.pos.x === 10 && fake.pos.y === 500 && Math.abs(fake.quat.w - pose.quat[3]) < 1e-9 && fake.vel.x === 70 && fake._flaps === 1 && fake.controls.throttle === 0.62 && sim.input.throttleTarget === 0.62 && fake._reset.altAGL === 400 && fake._reset.speed > 78 && fake._reset.gearDown === false,
    `${fake.pos.toArray()} agl ${fake._reset.altAGL}`);
  ok('pose: a pose with no position is refused', Save.sanitisePose({ quat: [0, 0, 0, 1] }) === null && Save.applyPose(sim, null) === false);
}

/* ------------------------------------------------------------------ *
 * 2. The resume plan.
 * ------------------------------------------------------------------ */
{
  const CH = Chapters.CHAPTERS.map((c) => ({ id: c.id, available: c.available, beats: c.module ? c.module.beats : [] }));
  ok('plan: nothing saved → fresh', Save.resumePlan(Save.blank(), CH).kind === 'fresh' && Save.resumePlan(null, CH).kind === 'fresh');
  const s = Save.blank();
  s.chapter = 'ch01-the-glint';
  ok('plan: a chapter with no beat → that chapter\'s start', Save.resumePlan(s, CH).kind === 'start' && Save.resumePlan(s, CH).chapter === 'ch01-the-glint');
  s.beat = 'story-ch01-land';
  s.step = 1;
  s.pose = Save.sanitisePose({ pos: [0, 400, 0] });
  const p = Save.resumePlan(s, CH);
  ok('plan: a saved beat, step and pose → exactly there', p.kind === 'resume' && p.beat === 'story-ch01-land' && p.beatIndex === 1 && p.step === 1 && p.exact === true, JSON.stringify(p));
  s.step = 9;
  ok('plan: a step the beat no longer has → the beat\'s start, not lost', Save.resumePlan(s, CH).kind === 'resume' && Save.resumePlan(s, CH).step === 0 && Save.resumePlan(s, CH).exact === false);
  s.step = 1;
  s.pose = null;
  ok('plan: no pose → the beat\'s start', Save.resumePlan(s, CH).exact === false && Save.resumePlan(s, CH).step === 0);
  s.beat = 'story-ch01-this-beat-was-renamed';
  ok('plan: a beat that no longer exists → the chapter\'s start', Save.resumePlan(s, CH).kind === 'start');
  // Finished chapter 1: the pointer moves to chapter 2, which has not shipped.
  const done = Save.blank();
  Save.recordChapter(done, 'ch01-the-glint', { medal: 'silver', score: 81, time: 400, style: ['through-the-eye'] });
  done.chapter = 'ch02-fire-line';
  const tbc = Save.resumePlan(done, CH);
  ok('plan: the next chapter has not shipped → TO BE CONTINUED, naming the last finished one', tbc.kind === 'tbc' && tbc.last === 'ch01-the-glint', JSON.stringify(tbc));
  ok('plan: nextChapter / lastDone', Save.nextChapter('ch01-the-glint', CH).id === 'ch02-fire-line' && Save.nextChapter('epilogue-clear-skies', CH) === null && Save.lastDone(done, CH) === 'ch01-the-glint');
  done.chapter = 'ch99-not-in-this-build';
  ok('plan: a chapter id this build does not know → TBC from the last finished one', Save.resumePlan(done, CH).kind === 'tbc' && Save.resumePlan(done, CH).last === 'ch01-the-glint');
  // Medals only go up.
  Save.recordChapter(done, 'ch01-the-glint', { medal: 'bronze', score: 40, time: 900, style: ['early-bird'] });
  const rec = done.chapters['ch01-the-glint'];
  ok('record: a worse replay never loses the medal, the score or the time; badges accumulate', rec.medal === 'silver' && rec.score === 81 && rec.bestTime === 400 && rec.style.join() === 'through-the-eye,early-bird', JSON.stringify(rec));
  Save.recordChapter(done, 'ch01-the-glint', { medal: 'gold', score: 95, time: 380 });
  ok('record: a better one upgrades', done.chapters['ch01-the-glint'].medal === 'gold' && done.chapters['ch01-the-glint'].bestTime === 380);
}

/* ------------------------------------------------------------------ *
 * 3. The chapter graph.
 * ------------------------------------------------------------------ */
{
  const C = Chapters.CHAPTERS;
  ok('chapters: twelve chapters and an epilogue', C.length === 13 && Chapters.STORY_CHAPTER_COUNT === 12 && C[12].epilogue === true, `${C.length}`);
  ok('chapters: ids unique, numbered 1..13 in order', new Set(C.map((c) => c.id)).size === 13 && C.every((c, i) => c.n === i + 1));
  ok('chapters: every one names a place, a vehicle, a real map and a spoiler-safe blurb', C.every((c) => c.title && c.place && c.vehicle && c.blurb && c.map && c.minutes > 0));
  const MAPS = (await imp('src/world/maps.js')).MAPS;
  ok('chapters: every map id is a real map', C.every((c) => MAPS.some((m) => m.id === c.map)), C.filter((c) => !MAPS.some((m) => m.id === c.map)).map((c) => c.map).join());
  ok('chapters: chapter 1 is available with a module; 2-13 are locked "coming soon"', C[0].available && C[0].module && C.slice(1).every((c) => !c.available && !c.module));
  ok('chapters: chapterLabel reads "Chapter 1 of 12: The Glint"', Chapters.chapterLabel(C[0]) === 'Chapter 1 of 12: The Glint');
  ok('chapters: every chapter has a recap for "Previously on…"', C.filter((c) => !c.epilogue).every((c) => Array.isArray(Script.RECAPS[c.id]) && Script.RECAPS[c.id].filter(Boolean).length >= 2));

  const mod = C[0].module;
  ok('ch1: two beats, the chase and the landing, in one flight', mod.beats.length === 2 && mod.beats[0].id === 'story-ch01-chase' && mod.beats[1].id === 'story-ch01-land' && mod.beats[1].continues === true);
  ok('ch1: five objectives, as the bible lists them', mod.objectives.length === 5 && /6,000 ft/.test(mod.objectives[0]) && /400 m/.test(mod.objectives[1]) && /photo/i.test(mod.objectives[2]) && /Cole/.test(mod.objectives[3]) && /Land/.test(mod.objectives[4]));
  ok('ch1: a briefing with three bullets and a route of real places', mod.briefing.bullets.length === 3 && mod.briefing.route.length >= 3 && mod.briefing.route.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[2]));
  for (const b of mod.beats) {
    ok(`ch1 beat ${b.id}: a story def — game story, hidden, condor, the Tempest, a night squall, a spawn and steps`,
      b.game === 'story' && b.hidden === true && b.map === 'condor' && b.aircraft === 'tempest' && b.weather.time === 'night' && b.weather.condition === 'stormy' && b.spawn && b.steps.length >= 2 && typeof b.save === 'function' && typeof b.resume === 'function');
    ok(`ch1 beat ${b.id}: every step has an id, text, a check and a target or none on purpose`, b.steps.every((s) => s.id && s.text && typeof s.check === 'function'));
  }
  const base = Meteor.MISSIONS.find((m) => m.id === 'meteor-photo');
  const chase = mod.beats[0];
  ok('ch1: the chase is the real meteor-photo mission, adapted (baseId, the base onStart, the hand-held camera knobs)',
    chase.baseId === 'meteor-photo' && chase.category === 'meteor' && chase.meteor.mode === 'photo' && chase.meteor.manualPhoto === true && chase.meteor.photoRange <= 650 && chase.meteor.giantAt > 0 && typeof chase.failIf === 'function');
  ok('ch1: the base mission is untouched by the adaptation', base.id === 'meteor-photo' && base.meteor.manualPhoto === undefined && base.steps.length === 3 && base.weather.condition === 'clear');
  // Checkpoints: the default is on; the one that opts out (the turn home) is seconds long.
  const cps = (b) => b.steps.map((s) => (s.checkpoint === false ? 'no' : 'yes')).join(',');
  ok('ch1: steps are checkpoints by default; only the short turn home opts out', cps(chase) === 'yes,yes,yes,no' && cps(mod.beats[1]) === 'yes,yes,yes', `${cps(chase)} / ${cps(mod.beats[1])}`);
  ok('ch1: the cruise home is a rolling save (pose every 30 s)', mod.beats[1].steps[0].rolling === true);
  // The one-minute guarantee by the author's estimates: on the track by ~30 s (the climb ends 10 s after the giant at 22 s),
  // alongside within ~50 s of that, the photo soon after, the cruise home under rolling saves, then the final in two
  // halves flown at the Tempest's 45 m/s approach speed (the slowest anyone flies it).
  const lf = mod.beats[1].steps;
  const shortFinal = lf.find((s2) => s2.id === 'short-final');
  const atShort = shortFinal && shortFinal.check({ ac: { onGround: false, pos: { distanceTo: () => 2390 } } });
  const notYet = shortFinal && !shortFinal.check({ ac: { onGround: false, pos: { distanceTo: () => 2600 } } });
  ok('ch1: short final is the checkpoint inside 2.4 km of the touchdown, after "On final" and before the landing', !!shortFinal && atShort && notYet && lf.map((s2) => s2.id).join(',') === 'approach,short-final,land');
  const est = [{ id: 'air start → on the track', s: 22 + 10 }, { id: 'on the track → alongside', s: 50 }, { id: 'alongside → photo', s: 25 }, { id: 'photo → on final (rolling every 30 s)', s: 30 }, { id: 'on final (5.2 km) → short final (2.4 km)', s: Math.round(2800 / 45) }, { id: 'short final → stopped', s: Math.round(2400 / 45 + 12) }];
  ok('ch1: no two checkpoints are authored more than 75 s of play apart', est.every((e) => e.s <= 75), est.map((e) => `${e.id} ${e.s}s`).join('; '));
  // Difficulty: a knob per mode, Story the kindest, Ace the strictest.
  const Dd = Ch1.DIFF;
  ok('ch1: difficulty modes Story / Pilot / Ace, kind to strict', Dd.story.photoRange > Dd.pilot.photoRange && Dd.pilot.photoRange > Dd.ace.photoRange && Dd.story.coleBase > Dd.pilot.coleBase && Dd.pilot.coleBase > Dd.ace.coleBase && Dd.story.giantT > Dd.ace.giantT);

  // adapt(): keeps functions by reference, merges the config objects, patches steps by id.
  const a = Beats.adapt(base, { id: 'x', meteor: { manualPhoto: true } }, { chase: { text: 'changed' } });
  ok('adapt: a clone with the base check functions by reference and the config merged', a.id === 'x' && a.baseId === 'meteor-photo' && a.steps[1].check === base.steps[1].check && a.steps[1].text === 'changed' && a.meteor.mode === 'photo' && a.meteor.manualPhoto === true && base.steps[1].text !== 'changed');
  // registerBeats: in the list only while registered.
  const ALL = await imp('src/game/missions.js');
  const n0 = ALL.MISSIONS.length;
  const undo = Beats.registerBeats(mod.beats);
  ok('beats: registered, findMission() sees them; undone, it does not', ALL.findMission('story-ch01-chase') === chase && ALL.MISSIONS.length === n0 + 2 && (undo(), ALL.MISSIONS.length === n0 && ALL.findMission('story-ch01-chase') === null));
  ok('beats: a story beat is never on a game\'s board or in its count', ALL.missionsFor('flight').every((m) => m.game !== 'story') && ALL.gameOf(chase) === 'story');
}

/* ------------------------------------------------------------------ *
 * 4. The script lint.
 * ------------------------------------------------------------------ */
{
  const L = Script.LINES;
  const ids = Object.keys(L);
  ok('script: every line names a real cast member and has text', ids.every((id) => Script.CAST[L[id].who] && L[id].text && L[id].text.trim().length > 0), ids.filter((id) => !Script.CAST[L[id].who]).join());
  const byChapter = {};
  for (const id of ids) {
    const n = Script.chapterOfLine(id);
    byChapter[n] = (byChapter[n] || 0) + 1;
  }
  ok('script: every line id names its chapter (c1-…)', !byChapter[0], `unnumbered: ${byChapter[0] || 0}`);
  ok('script: a chapter has 40 lines or fewer', Object.values(byChapter).every((n) => n <= 40), JSON.stringify(byChapter));
  const words = (t) => t.trim().split(/\s+/).length;
  const long = ids.filter((id) => words(L[id].text) > 14);
  ok('script: most lines are 14 words or fewer (at least 85%)', long.length <= Math.floor(ids.length * 0.15), `${long.length} of ${ids.length} over: ${long.join(', ')}`);
  const banned = ids.filter((id) => /\b(epic|awesome)\b/i.test(L[id].text));
  ok('script: no "epic" or "awesome" in dialogue', banned.length === 0, banned.join());
  const shouty = ids.filter((id) => (L[id].text.match(/!/g) || []).length > 1);
  ok('script: no exclamation spam', shouty.length === 0, shouty.join());
  const range = ids.filter((id) => L[id].who === 'range');
  ok('script: RANGE CONTROL speaks in capitals with no contractions', range.every((id) => L[id].text === L[id].text.toUpperCase() && !/'/.test(L[id].text)), `${range.length} lines`);
  const brands = /\b(Boeing|Airbus|Cessna|Lockheed|NASA|USA|America|Britain|England|France|Russia|China|Pentagon|White House|Google|Apple|Microsoft)\b/i;
  const branded = ids.filter((id) => brands.test(L[id].text));
  ok('script: no real brands or countries', branded.length === 0, branded.join());
  ok('script: the cast has a colour, a voice the radio knows and a look for every member', Object.values(Script.CAST).every((c) => /^#[0-9a-f]{6}$/i.test(c.colour) && c.voice && c.look && c.look.kind));
  const VOICES = (await imp('src/audio/atc.js')).VOICES;
  ok('script: every cast voice is one of the radio\'s formant voices (no TTS)', Object.values(Script.CAST).every((c) => VOICES[c.voice]), Object.values(Script.CAST).filter((c) => !VOICES[c.voice]).map((c) => c.voice).join());
  const recap1 = Script.RECAPS['ch01-the-glint'];
  ok('script: chapter 1\'s recap is three short spoiler-safe lines', recap1.length === 3 && recap1.every((l) => words(l) <= 14) && !/SENTINEL|Kittiwake/.test(recap1.join(' ')));
  ok('script: File 01 belongs to chapter 1 and says where to find it', Script.FILES.f01 && Script.FILES.f01.chapter === 'ch01-the-glint' && /observatory/i.test(Script.FILES.f01.where) && Script.FILES.f01.text.length > 40);
  // The chapter module only refers to lines that exist.
  const src = (await import('node:fs')).readFileSync(new URL('src/story/ch01-the-glint.js', root), 'utf8');
  const used = [...src.matchAll(/'(c1-[a-z0-9-]+)'/g)].map((m) => m[1]);
  const missing = [...new Set(used)].filter((id) => !L[id]);
  ok('ch1: every line id the chapter uses resolves in the script', missing.length === 0 && used.length > 10, missing.join() || `${new Set(used).size} ids`);
}

/* ------------------------------------------------------------------ *
 * 5. The medal table.
 * ------------------------------------------------------------------ */
{
  const v = Ch1.verdict;
  const base = { playerShotT: 40, coleShotT: 52, photoDist: 120, photoQuality: 90, landing: { score: 88, vsFpm: -120 }, goArounds: 0 };
  ok('medal: the photo inside 150 m, Cole beaten by over 5 s and a landing of 80+ is GOLD', v(base).medal === 'gold' && v(base).beatCole && v(base).margin === 12);
  ok('medal: inside 250 m with no go-around is SILVER', v({ ...base, photoDist: 240, landing: { score: 60 } }).medal === 'silver');
  ok('medal: the photo and a landing is BRONZE', v({ ...base, photoDist: 300 }).medal === 'bronze' && v({ ...base, goArounds: 1, photoDist: 200 }).medal === 'bronze');
  ok('medal: Cole first is never gold, however close the photo', v({ ...base, coleShotT: 30 }).medal !== 'gold' && !v({ ...base, coleShotT: 30 }).beatCole);
  ok('medal: beating Cole by 4 s is silver, not gold', v({ ...base, coleShotT: 44 }).medal === 'silver');
  ok('medal: Cole never shooting counts as beaten', v({ ...base, coleShotT: null }).medal === 'gold');
  const sc = [v(base).score, v({ ...base, photoQuality: 0, landing: { score: 0 }, coleShotT: 1 }).score];
  ok('medal: the score is 0..100 and a breakdown of five rows comes with it', sc.every((x) => x >= 0 && x <= 100) && sc[0] > sc[1] && v(base).breakdown.length === 5 && v(base).note, sc.join(' / '));
}

/* ------------------------------------------------------------------ *
 * 6. The plug-in.
 * ------------------------------------------------------------------ */
{
  await imp('src/features/index.js');
  const ext = await imp('src/game/extensions.js');
  const I = await imp('src/flight/input.js');
  const st = ext.extStatus().find((e) => e.id === 'story');
  ok('plug-in: "story" is registered and live after importing the feature list', !!(st && st.live));
  ok('plug-in: it declares the photo key (Space, the aeroplane) in Missions & events', I.ACTIONS.storyPhoto && I.ACTIONS.storyPhoto.default.join() === 'Space' && I.ACTIONS.storyPhoto.ctx.join() === 'plane' && I.ACTIONS.storyPhoto.group === 'Missions & events');
  ok('plug-in: Space for the photo is a by-design share with the brakes, not a clash', Object.keys(I.findConflicts(I.defaultBindings())).length === 0);
  const A = await imp('src/features/achievements/data.js');
  const R = await imp('src/features/achievements/rules.js');
  const Store = await imp('src/features/achievements/store.js');
  ok('achievements: the story\'s three are in the catalogue under their own group', ['story-glint', 'story-through-the-eye', 'story-early-bird'].every((id) => A.ACHIEVEMENTS_BY_ID.get(id) && A.ACHIEVEMENTS_BY_ID.get(id).group === 'story'));
  const s = Store.blank();
  const got = R.applyEvent(s, 'storyChapter', { chapter: 'ch01-the-glint', medal: 'gold', style: ['through-the-eye'], secrets: ['condor-light'] });
  ok('achievements: finishing chapter 1 with the gap and the light unlocks all three', ['story-glint', 'story-through-the-eye', 'story-early-bird'].every((id) => got.includes(id)), got.join());
  ok('achievements: a plain finish unlocks only The Glint', R.applyEvent(Store.blank(), 'storyChapter', { chapter: 'ch01-the-glint' }).join() === 'story-glint');
}

/* ------------------------------------------------------------------ *
 * 7. Teach by doing (lessons.js): power, nose and bank for a first-timer,
 *    one prompt each, all inside the first minute; "I know how to fly".
 * ------------------------------------------------------------------ */
{
  const L = await imp('src/story/lessons.js');
  ok('lessons: a first-timer on a fresh start gets them', L.wantsLessons({ knowsFlying: false, landings: 0 }) === true);
  ok('lessons: never for someone who said "I know how to fly", has landed before, or on a resume or a replay',
    !L.wantsLessons({ knowsFlying: true }) && !L.wantsLessons({ landings: 3 }) && !L.wantsLessons({ resume: true }) && !L.wantsLessons({ replay: true }));
  ok('lessons: power, then the nose, then the bank — three prompts', L.LESSONS.map((l) => l.id).join() === 'throttle,pitch,roll');
  // Nobody touches anything: every prompt times out, and the last is over inside the minute.
  const run = (controlsAt, extra = () => {}) => {
    const c = new L.Coach().start({ throttle: 0.7 });
    const shows = [];
    const passes = [];
    let finishedAt = null;
    for (let t = 0; t < 90 && finishedAt == null; t += 0.1) {
      extra(c, t);
      const ev = c.step(0.1, controlsAt(t, c));
      if (!ev) continue;
      if (ev.show) shows.push([ev.show.id, +t.toFixed(1)]);
      if (ev.passed) passes.push([ev.passed, ev.how, +t.toFixed(1)]);
      if (ev.finished) finishedAt = +t.toFixed(1);
    }
    return { c, shows, passes, finishedAt };
  };
  const idle = run(() => ({ throttle: 0.7, pitch: 0, roll: 0 }));
  ok('lessons: hands off, each prompt moves on by itself and all three are over inside 60 s',
    idle.shows.length === 3 && idle.passes.every((p) => p[1] === 'timeout') && idle.finishedAt != null && idle.finishedAt <= L.WITHIN_S,
    `${JSON.stringify(idle.shows)} finished ${idle.finishedAt} s`);
  ok('lessons: the first prompt comes a couple of seconds in, not on the first frame', idle.shows[0][1] >= L.START_S - 0.2 && idle.shows[0][1] <= L.START_S + 0.3);
  // Doing each thing passes it at once (held a beat), and a twitch does not.
  const keen = run((t, c) => {
    const cur = c.current ? c.current.id : null;
    return { throttle: cur === 'throttle' ? 1 : 0.7, pitch: cur === 'pitch' ? 0.5 : 0, roll: cur === 'roll' ? -0.5 : 0 };
  });
  ok('lessons: doing it passes each prompt within a second, and all three are done in under 10 s',
    keen.passes.map((p) => `${p[0]}:${p[1]}`).join() === 'throttle:did,pitch:did,roll:did' && keen.finishedAt < 10, `${JSON.stringify(keen.passes)} finished ${keen.finishedAt}`);
  let twitched = 0;
  const twitch = run((t, c) => {
    const on = c.current && c.current.id === 'pitch' && twitched++ === 0;
    return { throttle: 0.7, pitch: on ? 1 : 0, roll: 0 };
  });
  ok('lessons: a one-frame twitch is not "did it"', twitched > 1 && twitch.passes.find((p) => p[0] === 'pitch')[1] === 'timeout');
  ok('lessons: power counts from where the lever is when its prompt goes up', !L.LESSONS[0].did({ throttle: 0.72 }, { throttle0: 0.7 }) && L.LESSONS[0].did({ throttle: 0.5 }, { throttle0: 0.7 }));
  const skipped = run(() => ({ throttle: 0.7 }), (c, t) => {
    if (Math.abs(t - 3) < 0.05) c.skip();
  });
  ok('lessons: "I know how to fly" ends them at once and nothing more is shown', skipped.shows.length === 1 && skipped.c.over && Object.values(skipped.c.results).every((r) => r === 'skipped'), JSON.stringify(skipped.shows));
  const k = (a) => `[${a}]`;
  const keysText = L.LESSONS.map((l) => l.text(k, false)).join(' ');
  const touchText = L.LESSONS.map((l) => l.text(k, true)).join(' ');
  ok('lessons: the keys are the player\'s own bindings (never a hard-coded W/S)', ['throttleUp', 'throttleDown', 'pitchUp', 'pitchDown', 'rollLeft', 'rollRight'].every((a) => keysText.includes(`[${a}]`)), keysText);
  ok('lessons: on a touch screen they talk about the stick and the throttle slider, not keys', !/\[/.test(touchText) && /stick/.test(touchText) && /throttle/.test(touchText));
  ok('lessons: every prompt is short (14 words or fewer, the script\'s rule)', L.LESSONS.every((l) => l.text((a) => 'K', false).split(/\s+/).length <= 14 && l.text(k, true).split(/\s+/).length <= 14));
  const b = Save.blank();
  ok('lessons: the save keeps "knows how to fly" as a plain boolean', b.flags.knowsFlying === false && Save.migrate({ ...b, flags: { ...b.flags, knowsFlying: true } }).flags.knowsFlying === true && Save.migrate({ ...b, flags: { ...b.flags, knowsFlying: 'yes' } }).flags.knowsFlying === false);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
