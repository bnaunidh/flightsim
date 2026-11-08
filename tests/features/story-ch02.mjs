/**
 * Node checks for SIGNAL ZERO chapter 2, FIRE LINE (src/story/ch02-fire-line.js),
 * and the chapter graph of every shipped chapter. Run with plain node:
 *
 *   node tests/features/story-ch02.mjs
 *
 *   1. THE CHAPTER GRAPH, for every shipped chapter: each beat is a story def
 *      on a real map in a real machine with a spawn, steps that each have an
 *      id, text and a check, and an objective list and a briefing with three
 *      bullets and a route; every line id a chapter file names resolves in
 *      the script, to a real cast member; a chapter has 40 lines or fewer.
 *   2. CHECKPOINTS: chapter 2's, in the bible's order (departure · on the pad
 *      · crew aboard · after each drop · the burn scar), every step one by
 *      default, none authored more than 75 s of play apart.
 *   3. RESUME FROM EVERY CHECKPOINT ID: a save at every beat and step of
 *      every shipped chapter resumes exactly there; chapter 2's fire is put
 *      back by its fronts' save()/restore() on a fresh grid.
 *   4. THE FIRE, on Firewatch's real height field: the bench burns, the
 *      lookout's deck and the fire road do not, the inlet is open sea; the
 *      head reaches the "smoke closes the pad" mark at the bible's pace on
 *      each difficulty (Story kindest, Ace strictest) and later than a
 *      sensible pilot gets there; left alone, the back of the fire reaches
 *      the road (the threat is real), and three drops at a child's pace
 *      hold it off.
 *   5. THE MEDAL TABLE, the achievements and the File.
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
const fs = await import('node:fs');

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
const Ch2 = await imp('src/story/ch02-fire-line.js');
const { MAPS } = await imp('src/world/maps.js');
const { AIRCRAFT } = await imp('src/aircraft/types.js');
const T = await imp('src/world/terrain.js');
const { FireGrid, FUEL, STATE } = await imp('src/features/wildfire/grid.js');
const { FireScenario } = await imp('src/features/wildfire/scenario.js');
const { FireFront } = await imp('src/features/wildfire/front.js');
const { makeSampler } = await imp('src/features/wildfire/ground.js');
const { tankSpec } = await imp('src/features/wildfire/tank.js');

// The chapters after the first load lazily: bring every shipped one in before the graph is read.
for (const c of Chapters.CHAPTERS) if (c.available) await Chapters.loadModule(c);
const shipped = Chapters.CHAPTERS.filter((c) => c.available && c.module);

/* ------------------------------------------------------------------ *
 * 1. The chapter graph, for every shipped chapter.
 * ------------------------------------------------------------------ */
{
  ok('graph: chapters 1 and 2 ship', shipped.map((c) => c.id).slice(0, 2).join() === 'ch01-the-glint,ch02-fire-line', shipped.map((c) => c.id).join());
  const fileOf = { 'ch01-the-glint': 'src/story/ch01-the-glint.js', 'ch02-fire-line': 'src/story/ch02-fire-line.js' };
  for (const ch of shipped) {
    const mod = ch.module;
    ok(`graph ${ch.id}: the module is the chapter (same id), with beats, objectives, a briefing and a recap`,
      mod.id === ch.id && mod.beats.length >= 1 && mod.objectives.length >= 3 && mod.briefing && mod.briefing.bullets.length === 3 && mod.briefing.route.length >= 2 && (Script.RECAPS[ch.id] || []).filter(Boolean).length >= 2);
    ok(`graph ${ch.id}: the briefing route is real places (x, z, a label)`, mod.briefing.route.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && typeof p[2] === 'string' && p[2]));
    ok(`graph ${ch.id}: it has the hooks the director calls`, typeof mod.enterChapter === 'function' && typeof mod.leaveChapter === 'function' && typeof mod.medal === 'function' && typeof mod.finale === 'function');
    for (const b of mod.beats) {
      const mapOk = MAPS.some((m) => m.id === b.map);
      // A boat beat (chapter 4) is a shout: the launch, not an aircraft.
      const acOk = b.vehicle === 'boat' ? b.subject === 'boat' : AIRCRAFT.some((a) => a.id === b.aircraft);
      ok(`graph ${ch.id} / ${b.id}: a story def on a real map in a real machine, with a spawn`, b.game === 'story' && b.hidden === true && mapOk && acOk && !!b.spawn && !!b.spawn.pos && typeof b.onStart === 'function', `${b.map} ${b.aircraft || b.vehicle}`);
      ok(`graph ${ch.id} / ${b.id}: every step has an id, objective text and a check`, b.steps.length >= 2 && b.steps.every((s) => s.id && typeof s.text === 'string' && s.text.length > 8 && typeof s.check === 'function'), b.steps.filter((s) => !(s.id && s.text && s.check)).map((s) => s.id).join());
      ok(`graph ${ch.id} / ${b.id}: step ids are unique in the beat`, new Set(b.steps.map((s) => s.id)).size === b.steps.length);
      ok(`graph ${ch.id} / ${b.id}: save() and resume() for the checkpoints`, typeof b.save === 'function' && typeof b.resume === 'function');
    }
    // Every line id the chapter's file names resolves, to a real cast member.
    const src = fs.readFileSync(new URL(fileOf[ch.id] || `src/story/${ch.id}.js`, root), 'utf8');
    const n = ch.n;
    const used = [...new Set([...src.matchAll(new RegExp(`'(c${n}-[a-z0-9-]+)'`, 'g'))].map((m) => m[1]))];
    const missing = used.filter((id) => !Script.LINES[id]);
    ok(`graph ${ch.id}: every line id it uses resolves in the script`, missing.length === 0 && used.length >= 10, missing.join() || `${used.length} ids`);
    ok(`graph ${ch.id}: …each to a real cast member`, used.every((id) => Script.CAST[Script.LINES[id].who]));
    const own = Object.keys(Script.LINES).filter((id) => Script.chapterOfLine(id) === n);
    ok(`graph ${ch.id}: 40 lines or fewer (story-bible.md §10)`, own.length <= 40 && own.length > 0, `${own.length} lines`);
    // (Chapter 1 keeps one spare line, c1-mara-6, from before this check existed.)
    const unused = own.filter((id) => !used.includes(id));
    if (n >= 2) ok(`graph ${ch.id}: no orphan lines (every one it owns is spoken somewhere)`, unused.length === 0, unused.join());
  }
}

/* ------------------------------------------------------------------ *
 * 2. Chapter 2's checkpoints.
 * ------------------------------------------------------------------ */
const mod = Ch2.CHAPTER_2;
const [A, B] = mod.beats;
{
  ok('ch2: two beats in one flight — the lookout, then the line (continues)', mod.beats.length === 2 && A.id === 'story-ch02-lookout' && B.id === 'story-ch02-line' && B.continues === true && !A.continues);
  ok('ch2: the Skyhook on Firewatch Ridge, a hot clear morning', [A, B].every((b) => b.map === 'firewatch' && b.aircraft === 'harrier' && b.weather.time === 'day' && b.weather.condition === 'clear'));
  ok('ch2: built on the fire missions — the line beat is fire-ridge, adapted', B.baseId === 'fire-ridge' && B.category === 'story');
  ok('ch2: six objectives, as the bible lists them', mod.objectives.length === 6 && /lookout/i.test(mod.objectives[0]) && /smoke/.test(mod.objectives[1]) && /crew/.test(mod.objectives[2]) && /bucket/.test(mod.objectives[3]) && /3 drops/.test(mod.objectives[4]) && /photograph/.test(mod.objectives[5]));
  const labels = [A.startLabel, ...A.steps.map((s) => s.checkpoint), B.startLabel, ...B.steps.map((s) => s.checkpoint)];
  ok('ch2: checkpoints in the bible\'s order — departure, on the pad, crew aboard, after each drop, the burn scar', labels.join('|') === 'Departure|Below the Scarp|Short of the pad|On the pad|Crew aboard|false|Clear of the smoke|Bucket full|After drop 1|Bucket full again (2)|After drop 2|Bucket full again (3)|After drop 3|Over the burn scar|Photographed it', labels.join('|'));
  ok('ch2: only the few-second lift-out opts out (the next beat\'s start is its checkpoint)', A.steps.filter((s) => s.checkpoint === false).map((s) => s.id).join() === 'lift');
  ok('ch2: the long stretches roll-save — the hover down onto the pad, every fill and every drop (a full bucket climbs 430 m slowly)', A.steps.find((s) => s.id === 'land').rolling === true && B.steps.filter((s) => /^(fill|drop)-/.test(s.id)).every((s) => s.rolling === true));
  /*
   * The authored one-minute guarantee, at the Skyhook's pace with the assist
   * on (measured in headless Chrome, 2026-10-16: W alone reaches 61 m/s in
   * 20 s, Shift climbs at 10-13 m/s, Ctrl comes down at 8.5 m/s, S stops it
   * from 66 m/s in 10 s) — flown here at 35 m/s on average with every leg's
   * slowing, stopping and lining up added. The robot in
   * story-ch02.browser.js logs the real gaps.
   */
  const pad = Ch2.PLACE.pad;
  const base = Ch2.PLACE.base;
  T.applyMap('firewatch');
  const padH = T.heightAt(pad.x, pad.z);
  const d0 = Math.hypot(pad.x - base.x, pad.z - base.z);
  const est = [
    { id: 'departure → below the Scarp (1.25 km out)', s: Math.round((d0 - 1250) / 35 + 15) },
    { id: 'below the Scarp → short of the pad (320 m), climbing 430 m', s: Math.round(Math.max((1250 - 320) / 30, (padH - 160) / 8) + 5) },
    { id: 'short of the pad → on the pad (slow, stop, set down)', s: 32 },
    { id: 'on the pad → crew aboard', s: 12 },
    { id: 'aboard → lifted clear (the next beat\'s start)', s: 10 },
    { id: 'lifted → bucket full (460 m out, 430 m down, the fill)', s: Math.round(Math.max(460 / 30, padH / 8.5) + 20) },
    { id: 'bucket full → after a drop (900 m, 370 m up, line up)', s: Math.round(Math.max(900 / 30, 370 / 10) + 20) },
    { id: 'after a drop → bucket full again (900 m, 370 m down, the fill)', s: Math.round(Math.max(900 / 30, 370 / 8.5) + 20) },
    { id: 'after drop 3 → over the burn scar', s: 25 },
    { id: 'over the burn scar → photographed', s: 25 },
  ];
  ok('ch2: no two checkpoints authored more than 75 s of play apart', est.every((e) => e.s <= 75), est.map((e) => `${e.id} ${e.s}s`).join('; '));
  // Difficulty: Story the kindest, Ace the strictest.
  const D = Ch2.DIFF;
  ok('ch2: difficulty modes Story / Pilot / Ace, kind to strict', D.story.head < D.pilot.head && D.pilot.head < D.ace.head && D.story.back < D.pilot.back && D.pilot.back < D.ace.back && D.story.photoRange > D.ace.photoRange);
}

/* ------------------------------------------------------------------ *
 * 3. Resume from every checkpoint id.
 * ------------------------------------------------------------------ */
{
  const CH = Chapters.CHAPTERS.map((c) => ({ id: c.id, available: c.available, beats: c.module ? c.module.beats : [] }));
  const bad = [];
  let n = 0;
  for (const ch of shipped) {
    ch.module.beats.forEach((b, bi) => {
      b.steps.forEach((s, si) => {
        const data = Save.blank();
        data.chapter = ch.id;
        data.beat = b.id;
        data.step = si;
        data.checkpoint = typeof s.checkpoint === 'string' ? s.checkpoint : b.startLabel;
        data.pose = Save.sanitisePose({ game: 'flight', map: b.map, aircraft: b.aircraft, pos: [10, 400, -20], quat: [0, 0, 0, 1], vel: [5, 0, 0] });
        // Through JSON, the way it comes back out of localStorage.
        const back = Save.migrate(JSON.parse(JSON.stringify(data)));
        const p = Save.resumePlan(back, CH);
        n++;
        if (!(p.kind === 'resume' && p.exact && p.beatIndex === bi && p.step === si && p.beat === b.id)) bad.push(`${b.id}#${si}:${JSON.stringify(p)}`);
      });
    });
  }
  ok('resume: a save at every beat and step of every shipped chapter resumes exactly there', bad.length === 0 && n >= 20, bad.slice(0, 3).join(' ') || `${n} checkpoints`);
  ok('resume: chapter 2\'s beats can rebuild their state (save → JSON → resume)', [A, B].every((b) => b.save.length <= 1 && b.resume.length <= 2));
}

/* ------------------------------------------------------------------ *
 * 4. The fire, on Firewatch's real ground.
 * ------------------------------------------------------------------ */
T.applyMap('firewatch');
const P = Ch2.PLACE;
/** The pad's deck is a platform; the fire must be lit with it in the world. */
const padY = Math.max(...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => T.heightAt(P.pad.x + Math.sin(k) * 9, P.pad.z + Math.cos(k) * 9))) + 0.9;
T.addPlatform(P.pad.x, P.pad.z, P.pad.r * 2, P.pad.r * 2, padY, 'test pad');

function lightFire(diff) {
  const spec = Ch2.fireSpec(diff);
  const g = new FireGrid({ size: 320, cell: 20, maxBurning: 520, seed: 7 });
  g.sampler = makeSampler(null, { woods: spec.woods });
  const sc = new FireScenario(g);
  sc.start(spec, { wind: { x: -6, z: 0 } });
  for (const s of spec.scars) g.scorch(s.x, s.z, s.r);
  const fronts = spec.fronts.map((f) => {
    const ff = new FireFront(g, f);
    if (f.startAt) ff.seek(f.startAt);
    return ff;
  });
  return { g, sc, spec, head: fronts[0], back: fronts[1], head0: fronts[0].aheadOf(P.pad) };
}

function roadDist(f) {
  const path = Ch2.roadPath();
  let best = Infinity;
  const q = { x: 0, z: 0 };
  for (const c of f.cols) {
    f.pointOf(c, q);
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1];
      const b = path[k];
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      let t = ((q.x - a.x) * ex + (q.z - a.z) * ez) / (ex * ex + ez * ez);
      t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(a.x + ex * t - q.x, a.z + ez * t - q.z));
    }
  }
  return best;
}

{
  const F = lightFire(Ch2.DIFF.pilot);
  const { g, head } = F;
  const padCell = g.indexAt(P.pad.x, P.pad.z);
  ok('fire: the lookout\'s deck does not burn (a platform is paved)', g.fuelOf(padCell) === FUEL.NONE);
  const road = Ch2.roadPath();
  const onRoad = g.indexAt(road[1].x + (road[2].x - road[1].x) * 0.1, road[1].z + (road[2].z - road[1].z) * 0.1);
  ok('fire: the fire road is cut through the fuel (Line One\'s break)', g.fuelOf(onRoad) === FUEL.NONE);
  ok('fire: the inlet is open sea a bucket can dip in', T.heightAt(P.inlet.x, P.inlet.z) < -10, `${T.heightAt(P.inlet.x, P.inlet.z).toFixed(0)} m`);
  ok('fire: the tarn is a dip pool on the bench — its water above the rim\'s ground, 500 m from the back of the fire, clear of the pad', P.tarn.y > T.heightAt(P.tarn.x, P.tarn.z) && P.tarn.y >= 426 && Math.hypot(P.tarn.x - P.pad.x, P.tarn.z - P.pad.z) > 120 && Math.hypot(P.tarn.x - 900, P.tarn.z + 1990) > 400 && Math.hypot(P.tarn.x - 900, P.tarn.z + 1990) < 700 && Ch2.fireSpec().pools[0] === P.tarn && Ch2.fireSpec().water === P.tarn, `${Math.round(Math.hypot(P.tarn.x - 900, P.tarn.z + 1990))} m from the fire's back`);
  const wreckCell = g.indexAt(P.wreck.x, P.wreck.z);
  ok('fire: the wreck lies in the burn scar on the first frame', g.state[wreckCell] === STATE.BURNT);
  const marker = g.indexAt(P.marker.x, P.marker.z);
  ok('fire: File 02\'s survey marker is in the scar too (off the main line)', g.state[marker] === STATE.BURNT || g.state[marker] === STATE.BURNING, `state ${g.state[marker]}`);
  ok('fire: the head starts across the bench, burning, with the pad well up the slope', head.live >= 10 && g.burning > 40 && head.aheadOf(P.pad) > 350 && head.aheadOf(P.pad) < 450, `${head.live} live columns, ${g.burning} burning, ${head.aheadOf(P.pad).toFixed(0)} m to the pad`);
  ok('fire: the bench under the head is fuel (it does not stall on the first frame)', head.cols.filter((c) => !c.stopped).length >= 10);
}

/** Seconds until the smoke closes the pad, with nobody there. */
function closeTime(diff) {
  const F = lightFire(diff);
  let t = 0;
  let peak = 0;
  while (t < 600 && F.head.aheadOf(P.pad) >= Ch2.CLOSE_M) {
    F.head.update(0.5);
    F.back.update(0.5);
    F.sc.update(0.5, { x: -6, z: 0 }, 0);
    peak = Math.max(peak, F.g.burning);
    t += 0.5;
  }
  return { t, peak, F };
}
{
  const close = { story: closeTime(Ch2.DIFF.story), pilot: closeTime(Ch2.DIFF.pilot), ace: closeTime(Ch2.DIFF.ace) };
  const tt = Object.fromEntries(Object.entries(close).map(([k, v]) => [k, v.t]));
  ok('chase: the smoke closes the pad later on Story than Pilot, later on Pilot than Ace', tt.story > tt.pilot && tt.pilot > tt.ace, JSON.stringify(tt));
  // Re-paced 2026-11-08 for the rotor wave: the Skyhook needs longer to get up the Scarp and onto the pad.
  ok('chase: on Pilot it closes in 2-3.5 minutes (the bible: a race, not a wait)', tt.pilot >= 120 && tt.pilot <= 210, `${tt.pilot} s`);
  /*
   * An honest pilot's time to the pad (base to pad 2.3 km at 35 m/s with the
   * climb flown on the way, then half a minute's worth of slowing, stopping
   * and setting down) is about 85 s; the robot in the browser logs its own.
   * Story leaves a first-timer half as long again.
   */
  const honest = 85;
  const F = lightFire(Ch2.DIFF.pilot);
  for (let t = 0; t < honest; t += 0.5) {
    F.head.update(0.5);
    F.back.update(0.5);
    F.sc.update(0.5, { x: -6, z: 0 }, 0);
  }
  const m = Ch2.headMeter(F.head.aheadOf(P.pad), F.head0);
  ok('chase: an honest pilot lands with the meter well up on Pilot (> 30 %)', m > 0.3, `meter at ${honest} s: ${(m * 100).toFixed(0)}%`);
  ok('chase: Story leaves a slow first-timer (150 s) time to land', tt.story > 150 + 25, `${tt.story} s`);
  ok('chase: Ace is tight but flyable (an expert\'s 85 s)', tt.ace > 85 + 15, `${tt.ace} s`);
  ok('chase: the fire never comes near the Low quality cap', Math.max(close.story.peak, close.pilot.peak, close.ace.peak) < 520 * 0.85, `peak ${Math.max(close.story.peak, close.pilot.peak, close.ace.peak)}`);
}

/** The line: from the lift-out, with drops at `drops` seconds (or none), returns when the road is reached. */
function holdLine(diff, { liftAt = 115, drops = [] } = {}) {
  const F = lightFire(diff);
  const spec = tankSpec({ shape: { power: { rotor: true } } });
  let t = 0;
  let hits = 0;
  const road0 = roadDist(F.back);
  const step = (sp) => {
    F.head.update(0.5);
    F.back.update(0.5);
    F.sc.update(0.5, { x: sp, z: 0 }, hits);
    t += 0.5;
  };
  while (t < liftAt) step(-6);
  F.back.setSpeed(diff.back);
  const pending = drops.slice();
  while (t < liftAt + 1800) {
    step(6);
    if (pending.length && t >= liftAt + pending[0]) {
      pending.shift();
      // The drop: where the chapter's arrow points (the running stretch nearest the road, a
      // little back into the burning band), missing by 12 m to one side or the other.
      const bk = Ch2.backLeadIndex(F.back);
      const q = { x: 0, z: 0 };
      F.back.pointOf(F.back.cols[bk], q);
      let ax = q.x - F.back.dir.x * 12;
      let az = q.z - F.back.dir.z * 12;
      // As the arrow does: held there already, the nearest fire that still burns.
      const near = { x: 0, z: 0 };
      const dn = F.g.nearestBurning(ax, az, near);
      if (dn > 30 && Number.isFinite(dn)) {
        ax = near.x;
        az = near.z;
      }
      if (F.g.burning <= 2) return { reached: false, hits, t: t - liftAt, road0, left: roadDist(F.back), out: true };
      az += ((hits % 2) * 2 - 1) * 12;
      const res = F.g.douse(ax, az, spec.radius, 1, 16, null, 100 + hits);
      if (res.doused > 0) {
        hits++;
        Ch2.slowBack(F.back, diff);
      }
      if (hits >= 3) {
        F.back.stop();
        return { reached: false, hits, t: t - liftAt, road0, left: roadDist(F.back) };
      }
    }
    if (roadDist(F.back) < Ch2.ROAD_M) return { reached: true, hits, t: t - liftAt, road0 };
  }
  return { reached: false, hits, t: t - liftAt, road0, left: roadDist(F.back) };
}
{
  for (const k of ['story', 'pilot', 'ace']) {
    const idle = holdLine(Ch2.DIFF[k]);
    ok(`line (${k}): left alone, the back of the fire reaches the road (the threat is real)`, idle.reached && idle.t < 900, `${idle.reached ? 'reached' : 'not reached'} after ${Math.round(idle.t)} s from ${Math.round(idle.road0)} m`);
  }
  /*
   * The paces, re-measured 2026-11-08 with the rotor wave's Skyhook (the
   * robot in story-ch02.browser.js): the inlet is 430 m under the bench and
   * a full bucket climbs that at about 5 m/s, so a bucket is a two-and-a-
   * half-minute round trip. A child's pace: the first drop 170 s after the
   * lift-out, then one every 150 s.
   */
  // With the tarn on the bench a bucket is about a minute's round trip. A child's pace: the first drop 130 s after the lift-out, then one every 130 s.
  const child = [130, 260, 390];
  const story = holdLine(Ch2.DIFF.story, { liftAt: 200, drops: child });
  ok('line (story): three drops at a child\'s pace hold it off the road', !story.reached && (story.hits >= 3 || story.out), JSON.stringify(story));
  const pilot = holdLine(Ch2.DIFF.pilot, { liftAt: 140, drops: [100, 200, 300] });
  ok('line (pilot): three drops at an honest pace (a first drop at 100 s, then one every 100 s) hold it', !pilot.reached && (pilot.hits >= 3 || pilot.out), JSON.stringify(pilot));
  const ace = holdLine(Ch2.DIFF.ace, { liftAt: 100, drops: [80, 160, 240] });
  ok('line (ace): three drops at an expert\'s pace (80 s) hold it', !ace.reached && (ace.hits >= 3 || ace.out), JSON.stringify(ace));
  const lazy = holdLine(Ch2.DIFF.pilot, { liftAt: 140, drops: [100] });
  ok('line (pilot): one drop and going home does not hold it — the road is still reached, in the end', lazy.reached, JSON.stringify(lazy));
  const late = holdLine(Ch2.DIFF.pilot, { liftAt: 140, drops: [460, 560, 660] });
  ok('line (pilot): starting late (a first drop past seven minutes) loses the road', late.reached, JSON.stringify(late));
}

/* fronts' save()/restore(): the chapter's own fire put back on a fresh grid */
{
  const F = lightFire(Ch2.DIFF.pilot);
  for (let t = 0; t < 60; t += 0.5) {
    F.head.update(0.5);
    F.back.update(0.5);
    F.sc.update(0.5, { x: -6, z: 0 }, 0);
  }
  const sHead = JSON.parse(JSON.stringify(F.head.save()));
  const sBack = JSON.parse(JSON.stringify(F.back.save()));
  const G = lightFire(Ch2.DIFF.pilot);
  G.head.restore(sHead);
  G.back.restore(sBack);
  const same = F.head.cols.every((c, k) => Math.abs(c.d - G.head.cols[k].d) < 0.11) && F.back.cols.every((c, k) => Math.abs(c.d - G.back.cols[k].d) < 0.11);
  ok('resume: chapter 2\'s fire comes back from a checkpoint — every column of both fronts where it was', same && Math.abs(F.head.aheadOf(P.pad) - G.head.aheadOf(P.pad)) < 0.5, `${F.head.aheadOf(P.pad).toFixed(1)} vs ${G.head.aheadOf(P.pad).toFixed(1)} m`);
  ok('resume: …burning at its head on the restored grid, not a bare line', G.g.burning > 30, `${G.g.burning} burning (was ${F.g.burning})`);
}

/* ------------------------------------------------------------------ *
 * 5. Medals, achievements, the File.
 * ------------------------------------------------------------------ */
{
  const v = Ch2.verdict;
  const base = { meterAtLift: 0.6, hits: 5, drops: 6, time: 330, crewOut: true };
  ok('medal: above 50 %, five on-target drops and under six minutes is GOLD', v(base).medal === 'gold');
  ok('medal: above 30 % and four drops is SILVER', v({ ...base, meterAtLift: 0.35, hits: 4 }).medal === 'silver' && v({ ...base, time: 420 }).medal === 'silver');
  ok('medal: the crew out and three drops is BRONZE', v({ ...base, meterAtLift: 0.2, hits: 3 }).medal === 'bronze' && v({ ...base, hits: 3 }).medal === 'bronze');
  ok('medal: gold needs every part (meter, drops, the clock)', v({ ...base, meterAtLift: 0.5 }).medal !== 'gold' && v({ ...base, hits: 4 }).medal !== 'gold' && v({ ...base, time: 361 }).medal !== 'gold');
  const sc = [v(base).score, v({ meterAtLift: 0, hits: 3, time: 900 }).score];
  ok('medal: the score is 0..100, with five breakdown rows and a note', sc.every((x) => x >= 0 && x <= 100) && sc[0] > sc[1] && v(base).breakdown.length === 5 && v(base).note, sc.join(' / '));
  const A2 = await imp('src/features/achievements/data.js');
  const R = await imp('src/features/achievements/rules.js');
  const Store = await imp('src/features/achievements/store.js');
  ok('achievements: Ahead of the Wall and Treetop are in the story group', ['story-fire-line', 'story-treetop'].every((id) => A2.ACHIEVEMENTS_BY_ID.get(id) && A2.ACHIEVEMENTS_BY_ID.get(id).group === 'story'));
  const got = R.applyEvent(Store.blank(), 'storyChapter', { chapter: 'ch02-fire-line', medal: 'gold', style: ['treetop'] });
  ok('achievements: finishing chapter 2 with a treetop drop unlocks both', got.includes('story-fire-line') && got.includes('story-treetop'), got.join());
  ok('achievements: a plain chapter 2 finish unlocks only Ahead of the Wall', R.applyEvent(Store.blank(), 'storyChapter', { chapter: 'ch02-fire-line' }).join() === 'story-fire-line');
  ok('file: File 02 belongs to chapter 2, says where it is and is Priya\'s note', Script.FILES.f02 && Script.FILES.f02.chapter === 'ch02-fire-line' && /survey marker/i.test(Script.FILES.f02.where) && /Kittiwake/.test(Script.FILES.f02.text));
  const recap = Script.RECAPS['ch02-fire-line'];
  ok('script: chapter 2\'s recap is three short, spoiler-safe lines', recap.length === 3 && recap.every((l) => l.split(/\s+/).length <= 14) && !/SENTINEL|Priya Castellano/.test(recap.join(' ')));
  ok('script: the new cast (lookout crew, Firewatch, Thornefield) have a colour, a radio voice and a look', ['lookout', 'firewatch', 'thornefield'].every((k) => Script.CAST[k] && /^#[0-9a-f]{6}$/i.test(Script.CAST[k].colour) && Script.CAST[k].voice && Script.CAST[k].look.kind === 'bust'));
  const own = Object.keys(Script.LINES).filter((id) => Script.chapterOfLine(id) === 2);
  ok('script: nobody is hurt — every fail line says everyone is safe or fine', own.filter((id) => /fail/.test(id)).every((id) => /safe|fine/.test(Script.LINES[id].text)));
}

/* the landing rule: "you land you land" (and the helper's hold, for anything that still wants one) */
{
  ok('landing: the chapter lands on the owner\'s rule — hold 0, it counts the moment the skids touch', Beats.LANDING_HOLD === 0);
  const now = Beats.makeDwell();
  ok('landing: with hold 0 one frame on the deck counts', now.tick(1 / 30, true) === true);
  const off = Beats.makeDwell();
  ok('landing: …but not in the air, and never a crash', off.tick(1, false) === false && Beats.makeDwell().tick(1 / 30, true, true) === false);
  const src = fs.readFileSync(new URL('src/story/ch02-fire-line.js', root), 'utf8');
  ok('landing: chapter 2\'s pad step uses the rule (no 3-second hold)', /makeDwell\(LANDING_HOLD\)/.test(src) && !/makeDwell\(3\)/.test(src));
}
{
  const d = Beats.makeDwell(3);
  let t = 0;
  for (; t < 2.9; t += 0.1) d.tick(0.1, true);
  ok('dwell: 2.9 s on the pad does not count', !d.done);
  d.tick(0.25, true);
  ok('dwell: 3.1 s does', d.done);
  const b = Beats.makeDwell(3);
  for (let k = 0; k < 20; k++) b.tick(0.1, true);
  b.tick(0.2, false); // a bounce
  for (let k = 0; k < 11; k++) b.tick(0.1, true);
  ok('dwell: a bounce under 0.3 s is tolerated', b.done);
  const c = Beats.makeDwell(3);
  for (let k = 0; k < 20; k++) c.tick(0.1, true);
  c.tick(0.5, false);
  for (let k = 0; k < 11; k++) c.tick(0.1, true);
  ok('dwell: lifting off for longer resets it', !c.done);
  const x = Beats.makeDwell(3);
  for (let k = 0; k < 40; k++) x.tick(0.1, true, k > 20);
  ok('dwell: a crash never counts', !x.done);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
