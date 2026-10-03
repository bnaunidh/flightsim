/**
 * Node checks for Air Force One's third seat: the President. Model:
 * tests/features/roles.mjs's own NPC-airliner section — this drives the
 * two stories (src/game/roles/afo-president.js's createPresidentNormal/
 * createPresidentAttack, reached through cast.js's public castStart/
 * castStory/castUpdate, exactly as the real game does) against a bare
 * THREE.Scene and a made-up sim, with no page and no renderer at all.
 *
 *   node tests/features/afo-president.mjs
 *
 * Proves the one thing a browser placement-check cannot: that the whole
 * flight — departs already climbing, turns, and ACTUALLY LANDS — runs to
 * completion on its own clock, for both missions, including the attack
 * mission's own "drones cleared, turn for home" moment.
 *
 * Exits non-zero if anything fails.
 */

if (typeof globalThis.window === 'undefined') {
  const mem = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
  });
}
globalThis.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
  head: { appendChild() {} },
  getElementById: () => null,
};

const root = new URL('../../', import.meta.url);
const imp = (p) => import(new URL(p, root).href);

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail: String(detail) });
  return !!pass;
};

const THREE = await imp('src/vendor/three.module.js');
const T = await imp('src/world/terrain.js');
const AP = await imp('src/world/airport.js');
T.applyMap('kestrel');
AP.refreshRunways();
const CAST = await imp('src/game/roles/cast.js');
const Pres = await imp('src/game/roles/afo-president.js');

const scene = new THREE.Scene();
const weather = { isNight: false, cond: { cloud: 0 }, windSpeedKts: 7, windDirDeg: 90 };
function fakeSim() {
  return { scene, weather, hud: null, audio: null, speak() {} };
}

/** Drive a story to completion (or a cap), the same loop roles.mjs's flyUntil() uses. */
function run(sim, storyId, roleId, seconds, dt = 1 / 30) {
  CAST.castStart(sim, 'mission', { roleId, cast: { story: storyId } });
  const story = CAST.castStory(storyId);
  let t = 0;
  for (; t < seconds; t += dt) {
    CAST.castUpdate(sim, dt);
    if (story.info) {
      const out = {};
      story.info(out);
      if (out.stopped) break;
    }
  }
  return { story, t };
}

/* ------------------------------------------------------------------ *
 * The normal flight: departs already climbing, turns at 65s, lands.
 * ------------------------------------------------------------------ */
{
  const sim = fakeSim();
  const { story, t } = run(sim, Pres.STORY_NORMAL, 'president', 500);
  const out = {};
  story.info(out);
  ok('normal: the whole flight lands and stops inside 500s', out.stopped === true, `stopped ${out.stopped} at ${t.toFixed(0)}s, phase ${out.landPhase}`);
  ok('normal: it stopped on the field, not in the sea', T.heightAt(story.air.pos.x, story.air.pos.z) > -1 && story.air.pos.y < 200, `${story.air.pos.x.toFixed(0)},${story.air.pos.y.toFixed(0)},${story.air.pos.z.toFixed(0)}`);
  ok('normal: the escort followed him down too', !story.escort || story.escort.onGround, story.escort ? `escort onGround ${story.escort.onGround}` : 'no escort built');
  ok('normal: the real exterior model stays hidden throughout (you are inside it)', story.air.model.visible === false);
  // The President never touches the controls, so a well-played run's time
  // component must grade against the seat's OWN parTime (520), not a stale
  // constant copied from another seat — otherwise the fixed simulation time
  // alone could undercut a perfect run.
  const score = Pres.PRESIDENT_NORMAL.score({ elapsed: t });
  ok('normal: a real landing scores high (own parTime, not a borrowed one)', score >= 85, `score ${score} at t=${t.toFixed(0)}s (parTime ${Pres.PRESIDENT_NORMAL.parTime})`);
  CAST.castStop(sim); // dispose() through the public path, same as quitting the game does
  ok('normal: tearing the story down does not throw', true);
}

/* ------------------------------------------------------------------ *
 * Under Attack: warned, drones spawn, the escort clears them, and —
 * the bug this file's own history records — Air Force One must actually
 * turn for home and land once they are down, not fly on forever.
 * ------------------------------------------------------------------ */
{
  const sim = fakeSim();
  CAST.castStart(sim, 'mission', { roleId: 'president', cast: { story: Pres.STORY_ATTACK } });
  const story = CAST.castStory(Pres.STORY_ATTACK);
  const dt = 1 / 30;
  let t = 0;
  let sawWarned = false;
  let sawDrones = false;
  let stopped = false;
  for (; t < 10 && !stopped; t += dt) {
    CAST.castUpdate(sim, dt);
    const out = {};
    story.info(out);
    if (out.warned) sawWarned = true;
    if (out.dronesAlive > 0) sawDrones = true;
    if (out.stopped) stopped = true;
    if (t > 9.9) break;
  }
  ok('attack: the warning fires on its own clock (t > 8)', sawWarned, `t ${t.toFixed(1)}`);
  // Keep going until the drones are actually spawned and then cleared, or give up at a generous cap.
  for (; t < 600 && !stopped; t += dt) {
    CAST.castUpdate(sim, dt);
    const out = {};
    story.info(out);
    if (out.dronesAlive > 0) sawDrones = true;
    if (out.stopped) stopped = true;
  }
  const final = {};
  story.info(final);
  ok('attack: the drone wave actually came (unmanned, kid-safe)', sawDrones);
  ok('attack: the escort cleared them, turned for home, and Air Force One actually landed and stopped — the fix: it used to fly on forever once the drones were down', stopped, `stopped ${final.stopped}, phase ${final.landPhase}, dronesAlive ${final.dronesAlive}, hits ${final.stats && final.stats.hits}, t ${t.toFixed(0)}`);
  // The President never touches a flare or a gun, so a hit here is never
  // the fail path (see afo-president.js's own note by attack.stats.hits) —
  // only that the escort's own gun is doing real work, not firing into
  // empty air the whole engagement.
  ok('attack: the escort\'s own gun actually hits something over the engagement', !!final.stats && (final.stats.shotDrones + final.stats.shotMissiles) > 0, JSON.stringify(final.stats));
  ok('attack: it stopped on dry land, not in the sea', T.heightAt(story.air.pos.x, story.air.pos.z) > -1, `${story.air.pos.x.toFixed(0)},${story.air.pos.z.toFixed(0)}`);
  CAST.castStop(sim); // disposes the story for real, the same path the game uses
}

/* ------------------------------------------------------------------ *
 * Item 7 unlocks the Air Force One aircraft at 80+ on "Under Attack", in
 * any seat. The President never touches a flare or a gun, so the score
 * must grade the time term against this seat's OWN parTime (560), not a
 * stale, shorter constant borrowed from another seat (the old 420) — and
 * Guardian's own fixed response (its first launch or two usually gets
 * through before a fighter can reach it; not a player failing to fly)
 * must not be so harshly weighted that a clean, on-schedule run can never
 * clear 80 either. Drive one real flight home (so `home`, `landPhase`
 * and `elapsed` are all genuine), then swap in controlled hit counts —
 * deterministic, not at the mercy of the drones' own random cooldowns.
 * ------------------------------------------------------------------ */
{
  const sim = fakeSim();
  const { story: s, t: tt } = run(sim, Pres.STORY_ATTACK, 'president', 600);
  const out = {};
  s.info(out);
  ok('attack score check: the flight this check scores actually got home', out.stopped && out.home, `stopped ${out.stopped}, home ${out.home}, t ${tt.toFixed(0)}`);
  const savedHits = s.attack.stats.hits;
  s.attack.stats.hits = 0;
  const score0 = Pres.PRESIDENT_ATTACK.score({ elapsed: tt });
  s.attack.stats.hits = 1;
  const score1 = Pres.PRESIDENT_ATTACK.score({ elapsed: tt });
  s.attack.stats.hits = 2;
  const score2 = Pres.PRESIDENT_ATTACK.score({ elapsed: tt });
  s.attack.stats.hits = savedHits;
  ok('attack: a flawless intercept (0 hits) scores well clear of 80', score0 >= 90, `score ${score0} at t=${tt.toFixed(0)}s (parTime ${Pres.PRESIDENT_ATTACK.parTime})`);
  ok('attack: Guardian\'s own usual first hit or two (1-2) still scores 80+ — the point of this whole fix', score1 >= 80 && score2 >= 80, `score1 ${score1}, score2 ${score2}`);
  CAST.castStop(sim);
}

/* ------------------------------------------------------------------ *
 * The fail path: the President never reaches the secure room. The
 * Secret Service's own patience (secureSinceWarn) runs out.
 * ------------------------------------------------------------------ */
{
  const sim = fakeSim();
  Pres.placeWalker(Pres.SPOTS.seat.x, Pres.SPOTS.seat.z); // nowhere near the secure room
  CAST.castStart(sim, 'mission', { roleId: 'president', cast: { story: Pres.STORY_ATTACK } });
  const story = CAST.castStory(Pres.STORY_ATTACK);
  const dt = 1 / 30;
  let t = 0;
  let failedAt = null;
  for (; t < 80; t += dt) {
    CAST.castUpdate(sim, dt);
    const out = {};
    story.info(out);
    if (out.failWhy) {
      failedAt = t;
      break;
    }
  }
  ok('attack fail: never walking to the secure room fails the mission, gently', !!failedAt, `failed at ${failedAt}`);
  const outF = {};
  story.info(outF);
  ok('attack fail: the wording is kind, not a wreck', !!failedAt && /Secret Service/.test(outF.failWhy || ''), outF.failWhy);
  CAST.castStop(sim); // disposes the story for real, the same path the game uses
}

/* ------------------------------------------------------------------ *
 * The secure room really does reach into the room — verified earlier in
 * node-logic-test.mjs by hand; here just the fail timer's own arithmetic,
 * walking INTO the room this time, so it must NOT fail.
 * ------------------------------------------------------------------ */
{
  const sim = fakeSim();
  CAST.castStart(sim, 'mission', { roleId: 'president', cast: { story: Pres.STORY_ATTACK } });
  const story = CAST.castStory(Pres.STORY_ATTACK);
  const dt = 1 / 30;
  let t = 0;
  for (; t < 9; t += dt) CAST.castUpdate(sim, dt); // past the warning at t > 8
  Pres.placeWalker(Pres.SPOTS.secureInside.x, Pres.SPOTS.secureInside.z);
  let failedByT60 = false;
  for (; t < 60; t += dt) {
    CAST.castUpdate(sim, dt);
    const out = {};
    story.info(out);
    if (out.failWhy) failedByT60 = true;
  }
  ok('attack pass path: reaching the secure room after the warning never trips the fail timer', !failedByT60);
  CAST.castStop(sim); // disposes the story for real, the same path the game uses
}

/* ------------------------------------------------------------------ */

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.name}${r.detail && !r.pass ? `  — ${r.detail}` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
