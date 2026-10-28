/**
 * Node checks for the Tomm1z video pass, item 2 — Ctrl+W CLOSING THE TAB
 * (.claude/devtools/briefs/tomm1z-video.md, 3:51 and 5:42: "see if it saved
 * my progress... No, it did not").
 *
 *   node tests/features/tomm1z-unload.mjs
 *
 * game/checkpoint.js: the leave-page guard says yes with a flight on (flying
 * or paused) and no on the menu or a debrief; a running mission's checkpoint
 * captures the mode, its options, the step and the pose, round-trips through
 * storage, is refused when crashed / on foot / in a mayday / Free Flight /
 * the Story, goes stale after two hours, and resumePlan() names the step and
 * refuses a mission that no longer exists.
 */
import { load, ok, report, near } from './tomm1z-common.mjs';

const C = await load('src/game/checkpoint.js');

/* ---- the guard ---- */
ok('the leave-page guard is on while flying', C.guardUnload('flying') === true);
ok('...and while paused (Esc up, the flight still there)', C.guardUnload('paused') === true);
ok('...and off on the menu, in a debrief, and while loading', !C.guardUnload('menu') && !C.guardUnload('debrief') && !C.guardUnload('loading') && !C.guardUnload(undefined));

/* ---- the checkpoint ---- */
const V3 = class {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
};
function fakeSim(over = {}) {
  const def = { id: 'circuit', name: 'Island Circuit', steps: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] };
  const sim = {
    state: 'flying',
    mode: 'mission',
    modeOpts: { id: 'circuit', fn: () => 1 },
    runner: { status: 'running', def, stepIndex: 2, step: def.steps[2], elapsed: 61.26 },
    aircraft: {
      pos: new V3(1200, 420, -300), quat: { x: 0, y: 0.1, z: 0, w: 0.99 }, vel: new V3(40, 1, -2), heading: 95,
      controls: { throttle: 0.7 }, gearDown: false, flapStep: () => 1, fuel: 80, onGround: false, crashed: false,
      readouts: () => ({ fuelPct: 0.8 }),
    },
    aircraftType: { id: 'skylark' },
    settings: { map: 'kestrel' },
    walking: null,
    bracing: false,
    vehicle: null,
  };
  return Object.assign(sim, over);
}
const now = 1700000000000;
{
  const cp = C.captureCheckpoint(fakeSim(), now);
  ok('a running mission captures: mode, options, mission, step, pose, time', !!cp && cp.mode === 'mission' && cp.missionId === 'circuit' && cp.stepIndex === 2 && cp.steps === 4 && cp.stepId === 'c' && cp.savedAt === now && cp.pose && cp.pose.pos[0] === 1200, JSON.stringify(cp));
  ok('...the options as plain data (a function in them is dropped, not thrown on)', cp.opts && cp.opts.id === 'circuit' && !('fn' in cp.opts), JSON.stringify(cp.opts));
  ok('...the pose keeps the heading, the power, the gear, the flaps and the fuel', cp.pose.headingDeg === 95 && near(cp.pose.throttle, 0.7) && cp.pose.gear === false && cp.pose.flaps === 1 && near(cp.pose.fuel, 0.8), JSON.stringify(cp.pose));
  ok('...elapsed to a tenth', cp.elapsed === 61.3);

  const mem = new Map();
  const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  ok('it saves and loads back the same', C.saveCheckpoint(cp, store) && JSON.stringify(C.loadCheckpoint(store)) === JSON.stringify(cp));
  const find = (id) => (id === 'circuit' ? fakeSim().runner.def : null);
  const plan = C.resumePlan(C.loadCheckpoint(store), find, now + 60000);
  ok('resumePlan() a minute later: the same mission, at step 3 of 4, with the pose', plan && plan.mode === 'mission' && plan.stepIndex === 2 && plan.steps === 4 && plan.pose && plan.name === 'Island Circuit', JSON.stringify(plan));
  ok('...described for the card', C.describe(plan, cp, now + 60000) === 'step 3 of 4 · 1 min ago', C.describe(plan, cp, now + 60000));
  ok('two hours later it is stale: no plan', C.resumePlan(C.loadCheckpoint(store), find, now + C.MAX_AGE_MS + 1) === null);
  ok('a checkpoint from the future is not fresh either', !C.isFresh(cp, now - 1000));
  ok('a mission that no longer exists: no plan', C.resumePlan(cp, () => null, now) === null);
  ok('a step past the mission\'s end: no plan', C.resumePlan({ ...cp, stepIndex: 9 }, find, now) === null);
  C.clearCheckpoint(store);
  ok('clearCheckpoint() empties the store', C.loadCheckpoint(store) === null);
  ok('a broken store is harmless', C.saveCheckpoint(cp, { setItem() { throw new Error('quota'); } }) === false && C.loadCheckpoint({ getItem() { throw new Error('blocked'); } }) === null);
  ok('rubbish in the store is no checkpoint', C.loadCheckpoint({ getItem: () => '{"v":1,"mode":"free"}' }) === null && C.loadCheckpoint({ getItem: () => 'not json' }) === null);
}

/* ---- when there is nothing to keep ---- */
{
  const why = (over) => C.whyNot(fakeSim(over));
  ok('Free Flight has nothing to resume', why({ mode: 'free' }) === 'not a mission' && C.captureCheckpoint(fakeSim({ mode: 'free' })) === null);
  ok('the Story keeps its own save', why({ runner: { status: 'running', def: { id: 'story-ch01', game: 'story', steps: [{}] }, stepIndex: 0 } }) === 'the story has its own save');
  ok('crashed: nothing to resume', why({ aircraft: { ...fakeSim().aircraft, crashed: true } }) === 'crashed');
  ok('on foot (ejected, walking): nothing', why({ walking: { active: true, ejected: true } }) === 'on foot');
  ok('a mayday: nothing (the sequence owns the ending)', why({ bracing: true }) === 'mayday');
  ok('not flying (paused, the menu): nothing is written then', why({ state: 'paused' }) === 'not flying' && why({ state: 'menu' }) === 'not flying');
  ok('a mission that has finished: nothing', why({ runner: { status: 'complete', def: { id: 'circuit', steps: [] }, stepIndex: 3 } }) === 'no mission running');
  ok('a lesson (tutorial) is kept too', why({ mode: 'tutorial', runner: { status: 'running', def: { id: 'tutorial', name: 'Flight school', steps: [{}, {}] }, stepIndex: 1, step: {} } }) === null);
}

/* ---- a service worker taking over (main.js setupPwa) ---- */
{
  ok('first visit (no worker had the page): no reload at all — the page already runs what was cached', C.swTakeover(false, 'menu') === 'none' && C.swTakeover(false, 'flying') === 'none' && C.swTakeover(false, 'paused') === 'none');
  ok('an update mid-flight (or paused) waits for the menu', C.swTakeover(true, 'flying') === 'later' && C.swTakeover(true, 'paused') === 'later');
  ok('an update on the menu or a debrief reloads now, as before', C.swTakeover(true, 'menu') === 'now' && C.swTakeover(true, 'debrief') === 'now');
  const { readFileSync } = await import('node:fs');
  const main = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  const pwa = main.slice(main.indexOf('setupPwa() {'), main.indexOf('async promptInstall()'));
  ok('main.js decides the takeover with swTakeover, from whether a worker had the page at load', /const hadController = !!navigator\.serviceWorker\.controller/.test(pwa) && /Checkpoint\.swTakeover\(hadController, this\.state\)/.test(pwa) && !/addEventListener\('controllerchange', \(\) => \{\s*if \(this\._reloadingForUpdate\) return;\s*this\._reloadingForUpdate = true;\s*console\.info\('\[sw\] new version installed — reloading'\);\s*location\.reload\(\);/.test(pwa));
  ok('...and the frame loop reloads a held update only on the menu', /if \(this\._reloadOnMenu && this\.state === 'menu'\)/.test(main));
}

report();
