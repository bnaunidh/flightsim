/**
 * Node checks for the Tomm1z video pass, item 3 — THE SCARY SOUND
 * (.claude/devtools/briefs/tomm1z-video.md, 2:49-3:20: "that's scary ...
 * is this like a horror game?" after a collision, still going in the menu).
 *
 *   node tests/features/tomm1z-sound.mjs
 *
 * The crash is noise only, nothing on a timer, over inside a second, no
 * narrow screech (audio/ambience.js playCrash); asked for quiet (the menus,
 * the debrief) the flight audio hushes: the engine and the radio are not
 * updated, the radio's queue is dropped, and the hush lifts in flight
 * (audio/index.js). The audio graph itself: tests/features/tomm1z-sound.browser.js.
 */
import { win, load, near, ok, report } from './tomm1z-common.mjs';
void win;
void near;

/* ---------------- 3. the crash sound ---------------- */
{
  const { Ambience } = await load('src/audio/ambience.js');
  const calls = [];
  const fakeMixer = {
    ctx: { currentTime: 10 },
    get time() {
      return 10;
    },
    noiseBurst(o) {
      calls.push({ kind: 'burst', end: (o.when == null ? 10 : o.when) + o.duration - 10, ...o });
      return null;
    },
    tone(o) {
      calls.push({ kind: 'tone', ...o });
      return null;
    },
  };
  const timers = [];
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => {
    timers.push(ms);
    return 0;
  };
  try {
    new Ambience(fakeMixer).playCrash();
  } finally {
    globalThis.setTimeout = realTimeout;
  }
  const max = Ambience.CRASH_SOUND_SECONDS;
  const bursts = calls.filter((c) => c.kind === 'burst');
  ok('the crash sound is noise only: no tone (the 120 → 40 Hz square growl is gone)', !calls.some((c) => c.kind === 'tone'), JSON.stringify(calls.map((c) => c.kind)));
  ok('...nothing of it is queued on a timer (the five "tearing metal" screeches were)', timers.length === 0, JSON.stringify(timers));
  ok(`...and all of it is over inside ${max} s`, bursts.length >= 3 && bursts.every((b) => b.end <= max + 1e-9), bursts.map((b) => b.end.toFixed(2)).join(' '));
  ok('...with no narrow screech (Q above 3 at 700-3100 Hz, 0.2 s or longer)', !bursts.some((b) => b.q >= 3 && b.duration >= 0.2), JSON.stringify(bursts.map((b) => [b.freq, b.q, b.duration])));
}

/* ---------------- 3. quiet in the menus ---------------- */
{
  const { GameAudio } = await load('src/audio/index.js');
  const a = new GameAudio();
  // "Available" without a real context: the synths are unbuilt and every stop is a no-op.
  a.started = true;
  let engineUpdates = 0;
  let radioUpdates = 0;
  a.engine.update = () => engineUpdates++;
  a.radio.update = () => radioUpdates++;
  a.radio.queue = [{ text: 'left over' }];
  const ac = { rpm: 0.3, airspeed: 0, controls: { throttle: 0 }, fuel: 100, onGround: true, crashed: false, agl: 0, vs: 0, groundSpeed: 0 };
  const weather = { cond: { turb: 0, rain: 0 }, windSpeedKts: 5, lightningFlash: 0, thunderSeq: null };
  a.update(1 / 60, ac, weather, 0, true);
  ok('quiet: the audio hushes (hushed is readable as data)', a.hushed === true);
  ok('...and neither the engine nor the radio is updated', engineUpdates === 0 && radioUpdates === 0, `${engineUpdates} ${radioUpdates}`);
  ok('...and the radio queue is dropped', Array.isArray(a.radio.queue) && a.radio.queue.length === 0, a.radio.queue && a.radio.queue.length);
  a.update(1 / 60, ac, weather, 0, false);
  ok('flying again: the hush lifts and the engine is driven', a.hushed === false && engineUpdates === 1, `${a.hushed} ${engineUpdates}`);
  ok('loopLevels() reports the loops as numbers', (() => {
    const l = a.loopLevels();
    return l && typeof l.engine === 'number' && typeof l.wind === 'number' && typeof l.radioQueue === 'number' && 'hushed' in l;
  })());
}


report();
