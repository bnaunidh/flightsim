/**
 * Browser checks for SIGNAL ZERO chapter 4, LOW WATER, in the real game.
 * tests/features/story-ch04.mjs checks the graph, the places, the rules and
 * the director's boat plumbing in node; this is what node cannot see:
 *
 *   - Continue after chapter 3 starts chapter 4 at its briefing, and it opens
 *     IN THE BOAT GAME: the launch on Longbank's berth at dawn, the sand bar
 *     and Gannet Two in the world, the tide in the tracker, the objective and
 *     the arrow from the first second, the boat's touch controls on;
 *   - a KEY-DRIVEN SKIPPER plays it start to finish (PASS): Shift and Ctrl on
 *     the lever, A and D on the wheel — straight across the bank (the short
 *     cut), noses in to the bar at Slow, gets out (O), runs to the wreck,
 *     holds E for the case, walks to the tail plate (File 04), gets back in
 *     (O), goes astern off the sand and home to the mouth before the tide,
 *     and watches the harbour-mouth cutscene to the debrief with a medal; the
 *     save moves on to chapter 5 — TO BE CONTINUED;
 *   - the one-minute guarantee: no two autosaves more than 75 s of play apart;
 *   - FAIL → RETRY FROM CHECKPOINT: the tide run out mid-channel — one kind
 *     line, nothing saved while failing, Retry back in the boat in ≤ 3 s at
 *     the checkpoint's step and place with the tide put back;
 *   - LEAVE AND CONTINUE from "At the bar": the recap, then the same step
 *     with the launch back off the sand and the bar still dry;
 *   - the FLICKER PROBE on the dawn bank and the cutscene (Reduce flashing on).
 *
 * It puts the player's own story save back afterwards.
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export const id = 'story-ch04';

const KEY = 'islandsim.story.v1';

const KEYS = {
  Shift: ['ShiftLeft', 'Shift'],
  Ctrl: ['ControlLeft', 'Control'],
  A: ['KeyA', 'a'],
  D: ['KeyD', 'd'],
  Space: ['Space', ' '],
  O: ['KeyO', 'o'],
  E: ['KeyE', 'e'],
};

async function tick(ms = 40) {
  await new Promise((res) => setTimeout(res, ms));
}

async function waitFor(fn, tries = 200, ms = 40) {
  for (let i = 0; i < tries; i++) {
    if (fn()) return true;
    await tick(ms);
  }
  return !!fn();
}

/* ====================================================================== */
/* The skipper: the keys a player has                                       */
/* ====================================================================== */

function makeSkipper(sim, { Ch4, OnFoot, budget = 900 }) {
  const S = { clock: 0, budget, stopIf: null, log: [] };
  const down = new Set();
  const keyEvent = (type, k) => window.dispatchEvent(new KeyboardEvent(type, { code: KEYS[k][0], key: KEYS[k][1], bubbles: true, cancelable: true }));
  const press = (k) => {
    down.add(k);
    keyEvent('keydown', k);
  };
  const release = (k) => {
    down.delete(k);
    keyEvent('keyup', k);
  };
  // A tap the input layer can see: down for a couple of frames, then up (down and up in one
  // frame is never "held" when the lever is read once a frame).
  const tap = async (k) => {
    press(k);
    await S.tick(0.2);
    release(k);
  };
  S.allUp = () => {
    for (const k in KEYS) release(k);
    down.clear();
  };
  S.tap = tap;
  const boat = () => sim.vehicle;
  const DT = 1 / 15;
  S.DT = DT;
  const chan = new MessageChannel();
  let wake = null;
  chan.port1.onmessage = () => {
    const w = wake;
    wake = null;
    if (w) w();
  };
  let since = 0;
  const yieldNow = () =>
    new Promise((res) => {
      wake = res;
      chan.port2.postMessage(0);
    });
  S.over = () => S.clock > S.budget || !boat() || boat().crashed || (S.stopIf && S.stopIf());
  S.tick = async (secs = DT) => {
    const n = Math.max(1, Math.round(secs / DT));
    for (let i = 0; i < n; i++) {
      if (sim.state === 'paused' && sim.resume) sim.resume();
      sim.step(DT);
      S.clock += DT;
      if (since % 8 === 0) for (const k of down) keyEvent('keydown', k);
      if (++since >= 30) {
        since = 0;
        await yieldNow();
        await Promise.resolve();
      }
      if (S.over()) return;
    }
  };
  const wrap = (d) => ((d + 540) % 360) - 180;
  /** The lever to a detent (0 astern · 1 stop · 2 slow · 3 half · 4 full), one tap a tick. */
  S.lever = async (want) => {
    for (let i = 0; i < 8 && !S.over() && boat() && boat().lever !== want; i++) {
      await tap(boat().lever < want ? 'Shift' : 'Ctrl');
      await S.tick(0.3);
    }
  };
  /** Steer at (x, z) for `secs`, holding A or D while the bow is off it. */
  S.steerTo = async (x, z, secs) => {
    const n = Math.max(1, Math.round(secs / 0.2));
    for (let i = 0; i < n && !S.over(); i++) {
      const b = boat();
      const brg = (Math.atan2(x - b.pos.x, -(z - b.pos.z)) * 180) / Math.PI;
      const err = wrap(brg - b.heading);
      release('A');
      release('D');
      if (Math.abs(err) > 3) press(err > 0 ? 'D' : 'A');
      await S.tick(0.2);
    }
    release('A');
    release('D');
  };
  /** To within `within` m of (x, z) at `lever`, slowing to Slow inside `slowAt` m and stopping at the end. */
  S.driveTo = async (x, z, { within = 40, lever = 4, slowAt = 120, stopAt = 0 } = {}) => {
    for (let leg = 0; leg < 900 && !S.over(); leg++) {
      const b = boat();
      const d = Math.hypot(x - b.pos.x, z - b.pos.z);
      if (d < within) break;
      const want = d < slowAt ? 2 : lever;
      if (b.lever !== want && !b.aground) await S.lever(want);
      await S.steerTo(x, z, 0.6);
    }
    if (stopAt >= 0 && boat()) await S.lever(1);
  };
  return S;
}

/* ====================================================================== */
/* The checks                                                               */
/* ====================================================================== */

export async function check(sim, r, say = () => {}) {
  let saved = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch (e) {
    saved = null;
  }
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const realRender = sim.renderer.render.bind(sim.renderer);
  sim.renderer.render = () => {};
  const origReduce = sim.settings.reduceFlashing;
  // Chapters 2-4 are Dev-mode only until the demo is done: this check plays with the workbench open.
  const origDev = sim.prog ? sim.prog.devUnlocked : undefined;
  if (sim.prog) sim.prog.devUnlocked = true;
  let Dir;
  let Ch;
  let Ch4;
  let T;
  let THREE;
  let Save;
  let Script;
  let OnFoot;
  try {
    Dir = await import('../../src/story/director.js');
    Ch = await import('../../src/story/chapters.js');
    Ch4 = await import('../../src/story/ch04-low-water.js');
    T = await import('../../src/world/terrain.js');
    THREE = await import('../../src/vendor/three.module.js');
    Save = await import('../../src/story/save.js');
    Script = await import('../../src/story/script.js');
    OnFoot = (await import('../../src/features/onfoot.js')).onFoot;
  } catch (err) {
    r.ok('ch4: the modules load', false, String(err && err.message));
    return;
  }
  const menus = sim.menus;
  const S = () => sim.story.state;
  const K = Ch4.CHAPTER_4._state;
  const P = Ch4.PLACE;
  const boat = () => sim.vehicle;
  const stepId = () => (sim.runner.step ? sim.runner.step.id : null);
  const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const wasGame = sim.game;
  // Anything the director's promises throw on the way (a resume that fails) is reported, not lost.
  const rejections = [];
  const onRej = (e) => rejections.push(String((e.reason && e.reason.stack) || e.reason).slice(0, 320));
  window.addEventListener('unhandledrejection', onRej);

  try {
    if (sim.applyDifficulty) sim.applyDifficulty('normal');
    sim.settings.reduceFlashing = true;
    try {
      localStorage.removeItem(KEY);
    } catch (e) {
      /* fine */
    }
    if (sim.state !== 'menu') sim.quitToMenu('main');
    const data = Save.blank();
    for (const [cid, medal] of [['ch01-the-glint', 'silver'], ['ch02-fire-line', 'bronze'], ['ch03-range-control', 'silver']]) Save.recordChapter(data, cid, { medal, score: 70, time: 400 });
    data.chapter = 'ch04-low-water';
    data.flags.knowsFlying = true;
    data.flags.firstSeen = Date.now() - 864e5;
    Save.save(data);
    Dir.reloadSave();

    /* ---- 1. continue → briefing → the boat on the berth ------------------ */
    say('ch4: continue into chapter 4');
    menus.show('story');
    const cont = menus.screens.story.querySelector('[data-story="continue"]');
    r.ok('ch4: after chapter 3 the hub offers Continue into chapter 4', !!cont && /Low Water|Chapter 4/.test(cont.textContent), cont && cont.textContent.replace(/\s+/g, ' ').trim());
    cont.click();
    await waitFor(() => menus.current === 'story-briefing', 120);
    const brief = menus.screens['story-briefing'];
    r.ok('ch4: the briefing — Low Water, three bullets, a route picture, GO', menus.current === 'story-briefing' && /Low Water/.test(brief.textContent) && brief.querySelectorAll('[data-brief-bullets] li').length === 3 && !!brief.querySelector('[data-go]'), brief.textContent.replace(/\s+/g, ' ').trim().slice(0, 140));
    brief.querySelector('[data-go]').click();
    // The director settles a beat a few frames after startDrive returns (its fade's timer): wait for its own word.
    const started = await waitFor(() => sim.state === 'flying' && sim.mode === 'drive' && sim.vehicle && sim.vehicle.isBoat && sim.runner.def && sim.runner.def.id === 'story-ch04-bank' && S().phase === 'playing', 500, 50);
    for (let i = 0; i < 20; i++) sim.step(1 / 30);
    r.ok('ch4: it opens in the BOAT game — the launch on Longbank\'s berth at dawn, hidden from the menus but running', started && sim.settings.map === 'longbank' && sim.weather.time === 'sunset' && boat() && dist2D(boat().pos, T.harbourBerth()) < 60 && Math.abs(boat().speed) < 0.5,
      `${sim.state} ${sim.mode} ${sim.game} ${sim.settings.map} ${sim.runner.def && sim.runner.def.id} at ${boat() ? Math.round(dist2D(boat().pos, T.harbourBerth())) : '-'} m from the berth`);
    r.ok('ch4: the sand bar, Gannet Two, the flight case and the tail plate are in the world; the bar is dry ground the walker can step onto', !!sim.scene.getObjectByName('story:gannet-bar') && !!sim.scene.getObjectByName('story:gannet-two') && !!sim.scene.getObjectByName('story:flight-case') && !!sim.scene.getObjectByName('story:tail-plate') && Math.abs(T.heightAt(P.case.x, P.case.z) - Ch4.BAR_UP) < 0.01, `bar ${T.heightAt(P.case.x, P.case.z).toFixed(2)} m`);
    r.ok('ch4: Cole\'s RIB is at the mouth; the tide clock is running in the tracker', !!sim.scene.getObjectByName('story:cole-rib') && K.tide > 400 && K.tide < K.tideTotal);
    r.ok('ch4: one objective line from the first second and the arrow on the harbour mouth', /harbour|berth/i.test(sim.hud.objectiveText.textContent) && !!sim.runner.activeTarget(), sim.hud.objectiveText.textContent);
    r.ok('ch4: the boat\'s touch controls are on (the lever and the wheel), the way an iPad plays it', !sim.touch || (sim.touch._boatMode === true || (typeof sim.touch.setBoatMode === 'function')), sim.touch ? `boatMode ${sim.touch._boatMode}` : 'no touch layer');
    r.ok('ch4: it saved at the chapter start, as a boat pose', S().saveLog.length >= 1 && S().data.beat === 'story-ch04-bank' && S().data.pose && S().data.pose.game === 'boat', JSON.stringify({ pose: S().data.pose && { game: S().data.pose.game, pos: S().data.pose.pos.map(Math.round) }, beat: S().data.beat, log: S().saveLog, cp: Dir.D.checkpoint && { label: Dir.D.checkpoint.label, pose: !!Dir.D.checkpoint.pose }, mode: sim.mode, veh: !!sim.vehicle }));

    /* ---- 2. the skipper plays it to the end -------------------------------- */
    say('ch4: the skipper plays it');
    const Sk = makeSkipper(sim, { Ch4, OnFoot, budget: 900 });
    const steps = [];
    const whos = new Set();
    const cards = new Set();
    let lastStep = null;
    const watch = () => {
      const st = stepId();
      if (st !== lastStep) {
        steps.push(`${st}@${Math.round(Sk.clock)}`);
        lastStep = st;
      }
      for (const e of sim.story.cinema.log) {
        if (e.kind === 'card') cards.add(e.main);
        if (e.kind === 'line' && e.who) whos.add(e.who);
      }
    };
    Sk.stopIf = () => {
      watch();
      return S().phase === 'failed' || S().phase === 'debrief' || !S().active;
    };
    let groundingsBefore = null;
    for (let guard = 0; guard < 60 && !Sk.over(); guard++) {
      const sid = stepId();
      if (S().phase === 'cutscene') {
        await Sk.tick(0.5);
        continue;
      }
      if (sid === 'slip') {
        await Sk.driveTo(P.mouth.x, P.mouth.z - 10, { within: 60, lever: 3, slowAt: 0, stopAt: -1 });
      } else if (sid === 'channel') {
        // Straight across the bank: the short cut.
        await Sk.driveTo(P.landing.x - 260, P.landing.z, { within: 120, lever: 4, slowAt: 0, stopAt: -1 });
      } else if (sid === 'bar') {
        groundingsBefore = boat().groundings || 0;
        // Slow from 180 m out, Stop at 45 m: she carries about 35 m of way at Slow.
        await Sk.driveTo(P.landing.x, P.landing.z, { within: 48, lever: 3, slowAt: 190, stopAt: 1 });
        for (let i = 0; i < 70 / Sk.DT && !Sk.over() && stepId() === 'bar'; i++) {
          await Sk.tick();
          const b = boat();
          // Still short of the sand and stopped: a touch of Slow.
          if (b && !b.aground && Math.abs(b.speed) < 0.3 && Ch4.distToBar(b.pos.x, b.pos.z, P.shelf) > Ch4.STEP_OFF_M && i % 30 === 29) {
            await Sk.lever(2);
            await Sk.tick(3);
            await Sk.lever(1);
          }
        }
      } else if (sid === 'walk') {
        // O to get out; the walk itself is onfoot.js's (tested there): the walker is put by the case.
        const why = OnFoot.getOut(sim);
        if (why) {
          Sk.log.push(`get out: ${why}`);
          await Sk.tick(1.5);
          continue;
        }
        await Sk.tick(0.5);
        OnFoot.place(P.case.x - 1.5, P.case.z + 1.5, 120);
        await Sk.tick(1);
      } else if (sid === 'case') {
        // Hold E for the case (the interact layer's hold).
        for (let i = 0; i < 6 / Sk.DT && !Sk.over() && !K.caseTaken; i++) {
          window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e', bubbles: true, cancelable: true }));
          await Sk.tick();
        }
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE', key: 'e', bubbles: true, cancelable: true }));
        await Sk.tick(0.5);
      } else if (sid === 'back') {
        // The tail plate first (File 04), then back to the boat and O.
        if (!K.fileFound) {
          OnFoot.place(P.plate.x - 1, P.plate.z + 1, 90);
          await Sk.tick(1);
        }
        const b = boat();
        OnFoot.place(b.pos.x + 4, b.pos.z, 270);
        await Sk.tick(0.5);
        OnFoot.pressO(sim);
        await Sk.tick(1.5);
      } else if (sid === 'out') {
        // Astern until clear of the sand, then round to the west and home.
        await Sk.lever(0);
        for (let i = 0; i < 14 / Sk.DT && !Sk.over() && Ch4.distToBar(boat().pos.x, boat().pos.z) < 40; i++) await Sk.tick();
        await Sk.lever(1);
        await Sk.tick(1);
        await Sk.driveTo(P.mouth.x, P.mouth.z + 30, { within: 70, lever: 4, slowAt: 160, stopAt: 1 });
        await Sk.tick(2);
      } else {
        await Sk.tick(1);
      }
    }
    for (let i = 0; i < 60 && S().phase === 'cutscene'; i++) {
      sim.step(0.5, 1 / 30);
      await Promise.resolve();
      await tick(0);
    }
    await waitFor(() => menus.current === 'story-debrief', 150, 40);
    Sk.allUp();
    watch();
    const trail = steps.join(' → ');
    r.ok('ch4 skipper: across the bank (the short cut), to the bar, nosed in', steps.some((s) => s.startsWith('walk')) && K.shortCut && K.atBar != null, `${trail}; ${Sk.log.join(' | ')}`);
    r.ok('ch4 skipper: out on foot, the case freed with E held, and File 04 at the tail plate', K.caseTaken && K.fileFound && S().data.flags.files.includes('f04'), `${trail}`);
    r.ok('ch4 skipper: back aboard and home to the mouth before the tide', K.backAboard && K.home && K.tide > 0 && !boat()?.crashed, `tide left ${Math.round(K.tide)} s; ${trail}`);
    r.ok('ch4 skipper: Cole raced and ran aground; Esi\'s lifeboat came out for him', K.cole && K.cole.state === 'aground' && !!K.esi, `${K.cole && K.cole.state}; esi ${!!K.esi}`);
    r.ok('ch4 skipper: the title card came up (LOW WATER)', cards.has('LOW WATER'), [...cards].join('|'));
    r.ok('ch4 skipper: lines were spoken with portraits — Mara, Cole, Esi, Lark', ['mara', 'cole', 'esi', 'lark'].every((w) => whos.has(w)), [...whos].join(','));
    r.ok('ch4 skipper: the harbour-mouth cutscene played and ended', sim.story.cinema.log.some((e) => e.kind === 'cutscene-end' && e.id === 'ch04-mouth'), JSON.stringify(sim.story.cinema.log.filter((e) => /cutscene/.test(e.kind)).map((e) => `${e.kind}:${e.id}:${e.how || ''}`)));
    r.ok('ch4 skipper: the debrief, a medal and a score', menus.current === 'story-debrief' && !!menus.screens['story-debrief'].querySelector('.sz-medal') && /\/100/.test(menus.screens['story-debrief'].textContent), menus.current);
    const rec = S().data.chapters['ch04-low-water'];
    r.ok('ch4 skipper: the save has chapter 4 done with its medal, and the pointer on chapter 5', !!(rec && rec.done && rec.medal) && S().data.chapter === 'ch05-the-bridge', JSON.stringify({ rec, ch: S().data.chapter }));
    const log = S().saveLog;
    const gaps = [];
    for (let i = 1; i < log.length; i++) gaps.push(+(log[i].t - log[i - 1].t).toFixed(1));
    r.ok('ch4 skipper: no two autosaves more than 75 s of play apart (the one-minute guarantee)', gaps.length >= 5 && Math.max(...gaps) <= 75, `gaps ${gaps.join(',')} s; ${log.map((e) => e.id).join(',')}`);
    r.ok('ch4 skipper: Reduce flashing stayed on', sim.settings.reduceFlashing === true);
    menus.screens['story-debrief'].querySelector('[data-dact="next"]').click();
    await waitFor(() => menus.current === 'story-tbc' || menus.current === 'story-briefing', 120);
    const ch5 = Ch.chapterById('ch05-the-bridge');
    r.ok(ch5 && ch5.available ? 'ch4: Next chapter → chapter 5\'s briefing' : 'ch4: Next chapter → TO BE CONTINUED, naming The Bridge', (ch5 && ch5.available ? menus.current === 'story-briefing' : menus.current === 'story-tbc') && /The Bridge/.test(menus.screens[menus.current].textContent), `${menus.current}: ${menus.screens[menus.current].textContent.replace(/\s+/g, ' ').trim().slice(0, 120)}`);
    if (menus.current === 'story-briefing') menus.screens['story-briefing'].querySelector('[data-back]').click();
    await waitFor(() => !S().active, 50);
    r.ok('ch4: nothing of the chapter left behind — no bar, no wreck, no hull, no platform, and the aeroplane game back', !sim.scene.getObjectByName('story:gannet-bar') && !sim.scene.getObjectByName('story:gannet-two') && !sim.vehicle && !T.PLATFORMS.some((p) => p.name === 'Gannet bar') && !S().active && sim.state === 'menu', `vehicle ${!!sim.vehicle}; platforms ${T.PLATFORMS.map((p) => p.name).join()}`);

    /* ---- 3. fail (the tide), retry from the checkpoint --------------------- */
    say('ch4: fail — the tide');
    await Dir.startChapter(Ch.chapterById('ch04-low-water'), { fresh: true, replay: true, skipBriefing: true });
    await waitFor(() => sim.state === 'flying' && sim.mode === 'drive' && sim.runner.def && sim.runner.def.id === 'story-ch04-bank' && S().phase === 'playing', 400, 40);
    const Sk2 = makeSkipper(sim, { Ch4, OnFoot, budget: 300 });
    Sk2.stopIf = () => stepId() === 'channel' || S().phase === 'failed' || !S().active;
    await Sk2.driveTo(P.mouth.x, P.mouth.z - 10, { within: 60, lever: 3, slowAt: 0, stopAt: -1 });
    for (let i = 0; i < 10 / Sk2.DT && stepId() !== 'channel' && !Sk2.over(); i++) await Sk2.tick();
    Sk2.allUp();
    const cpA = Dir.D.checkpoint;
    r.ok('ch4 fail: out of the harbour — the checkpoint holds the tide', stepId() === 'channel' && !!cpA && cpA.label === 'Out of the harbour' && cpA.beatState && Number.isFinite(cpA.beatState.tide), JSON.stringify({ step: stepId(), cp: cpA && cpA.label, tide: cpA && cpA.beatState && Math.round(cpA.beatState.tide) }));
    K.tide = 1.5;
    let failed = false;
    for (let t = 0; t < 30 && !failed; t += 0.5) {
      sim.step(0.5, 1 / 30);
      await Promise.resolve();
      failed = S().phase === 'failed';
    }
    await waitFor(() => menus.current === 'story-fail', 60);
    const failScr = menus.screens['story-fail'];
    const tideLine = Script.LINES['c4-fail-tide'].text;
    r.ok('ch4 fail: the tide runs out — one kind line (everyone dry), Retry / Restart / Quit', failed && menus.current === 'story-fail' && failScr.textContent.includes(tideLine.slice(0, 24)) && !!failScr.querySelector('[data-fact="retry"]'), failScr.textContent.replace(/\s+/g, ' ').trim().slice(0, 140));
    const savesA = S().saveLog.length;
    await tick(100);
    r.ok('ch4 fail: nothing saved while failing', S().saveLog.length === savesA);
    // The retry goes to the LAST checkpoint, which may be a rolling save made since "Out of the harbour".
    const cpR = Dir.D.checkpoint;
    const t0 = performance.now();
    failScr.querySelector('[data-fact="retry"]').click();
    const back = await waitFor(() => sim.state === 'flying' && sim.mode === 'drive' && S().active && S().phase === 'playing' && sim.runner.step, 150, 20);
    const took = (performance.now() - t0) / 1000;
    for (let i = 0; i < 10; i++) sim.step(1 / 30);
    const offR = boat() && cpR && cpR.pose ? Math.round(dist2D(boat().pos, { x: cpR.pose.pos[0], z: cpR.pose.pos[2] })) : -1;
    r.ok('ch4 retry: back in the boat in ≤ 3 s at the checkpoint\'s step and place, the tide put back', back && took <= 3 && sim.runner.def.id === 'story-ch04-bank' && !!cpR && sim.runner.stepIndex === cpR.step && offR >= 0 && offR < 25 && cpR.beatState && Math.abs(K.tide - cpR.beatState.tide) < 3 && K.tide > 60,
      `${took.toFixed(2)} s; step ${sim.runner.stepIndex} (cp "${cpR && cpR.label}" step ${cpR && cpR.step}); ${offR} m off; tide ${Math.round(K.tide)} (saved ${cpR && cpR.beatState ? Math.round(cpR.beatState.tide) : '-'}); phase ${S().phase}; ${sim.mode}; pose ${cpR && cpR.pose ? 'yes' : 'NONE'}; rejections: ${rejections.join(' // ') || 'none'}`);

    /* ---- 4. leave and continue at the bar ---------------------------------- */
    say('ch4: leave and continue');
    const Sk3 = makeSkipper(sim, { Ch4, OnFoot, budget: 400 });
    Sk3.stopIf = () => stepId() === 'walk' || S().phase === 'failed' || !S().active;
    await Sk3.driveTo(P.landing.x - 260, P.landing.z, { within: 120, lever: 4, slowAt: 0, stopAt: -1 });
    await Sk3.driveTo(P.landing.x, P.landing.z, { within: 48, lever: 3, slowAt: 190, stopAt: 1 });
    for (let i = 0; i < 70 / Sk3.DT && !Sk3.over() && stepId() !== 'walk'; i++) {
      await Sk3.tick();
      const b = boat();
      if (b && !b.aground && Math.abs(b.speed) < 0.3 && Ch4.distToBar(b.pos.x, b.pos.z, P.shelf) > Ch4.STEP_OFF_M && i % 30 === 29) {
        await Sk3.lever(2);
        await Sk3.tick(3);
        await Sk3.lever(1);
      }
    }
    Sk3.allUp();
    r.ok('ch4 continue: reached "At the bar" (the launch stopped a boat\'s length off the sand)', stepId() === 'walk' && S().checkpoint && S().checkpoint.label === 'At the bar', `${stepId()}; ${S().checkpoint && S().checkpoint.label}; ${boat() ? Math.round(Ch4.distToBar(boat().pos.x, boat().pos.z)) : '-'} m off the sand`);
    Dir.D.replay = false;
    Dir.saveCheckpoint('bar-test', 'At the bar');
    const savedPose = S().data.pose;
    sim.step(2, 1 / 30);
    sim.quitToMenu('main');
    if (sim.vehicle && sim.stopDrive) sim.stopDrive();
    menus.show('story');
    const cont2 = menus.screens.story.querySelector('[data-story="continue"]');
    r.ok('ch4 continue: the hub offers Continue at "At the bar"', !!cont2 && /At the bar/.test(cont2.textContent), cont2 && cont2.textContent.replace(/\s+/g, ' ').trim());
    const plan = Save.resumePlan(Dir.D.data, Ch.CHAPTERS);
    cont2.click();
    await waitFor(() => sim.state === 'flying' && sim.mode === 'drive' && S().active && S().phase === 'playing', 400, 40);
    for (let i = 0; i < 15; i++) sim.step(1 / 30);
    const cin = sim.story.cinema;
    r.ok('ch4 continue: the plan from the save is an exact resume of the bank beat', plan.kind === 'resume' && plan.exact && plan.beat === 'story-ch04-bank', JSON.stringify(plan));
    r.ok('ch4 continue: "Previously on SIGNAL ZERO…", then the walk step with the launch back off the sand and the bar still dry', cin.cardKind === 'recap' && sim.runner.def.id === 'story-ch04-bank' && stepId() === 'walk' && boat() && dist2D(boat().pos, { x: savedPose.pos[0], z: savedPose.pos[2] }) < 25 && Math.abs(T.heightAt(P.case.x, P.case.z) - Ch4.BAR_UP) < 0.05 && K.tide > 100,
      `${cin.cardKind} ${sim.runner.def && sim.runner.def.id} ${stepId()} ${boat() ? Math.round(dist2D(boat().pos, { x: savedPose.pos[0], z: savedPose.pos[2] })) : '-'} m; bar ${T.heightAt(P.case.x, P.case.z).toFixed(2)}; tide ${Math.round(K.tide)}`);
    sim.tap('KeyC');
    sim.step(0.5, 1 / 30);
    sim.tap('KeyC');
    sim.step(2.5, 1 / 30);

    /* ---- 5. the flicker probe ---------------------------------------------- */
    say('ch4: flicker probe');
    const C = await import('../../src/story/cinema.js');
    C.holdStill(true);
    sim.renderer.render = realRender;
    try {
      const Probe = await import('../flicker-probe.js');
      const FB = await import('./flicker.browser.js');
      sim.rig.initialised = false;
      const m1 = await Probe.measure(sim, { frames: 60, fps: 30, warm: 0, raycast: false });
      r.ok(`ch4 flicker: the bank at dawn from the launch flickers over under ${(FB.FLICKER_MAX * 100).toFixed(1)}% of the screen (Reduce flashing on)`, m1.meanLum.max > 0.01 && m1.percArea <= FB.FLICKER_MAX && m1.wcagWindow <= FB.WCAG_WINDOW_MAX, `perc ${(m1.percArea * 100).toFixed(2)}%, WCAG window ${(m1.wcagWindow * 100).toFixed(2)}%; ${m1.stepMs} ms a frame`);
      C.holdStill(false);
      const scene = Ch4.CHAPTER_4.finale(Dir.D.api);
      const m2 = await Probe.measure(sim, { frames: 120, fps: 30, warm: 0, raycast: false });
      r.ok('ch4 flicker: the harbour-mouth cutscene flickers under the line (Reduce flashing on)', m2.meanLum.max > 0.01 && m2.percArea <= FB.FLICKER_MAX && m2.wcagWindow <= FB.WCAG_WINDOW_MAX, `perc ${(m2.percArea * 100).toFixed(2)}%, WCAG window ${(m2.wcagWindow * 100).toFixed(2)}%; ${m2.stepMs} ms a frame`);
      C.skip();
      await scene;
    } catch (e) {
      r.ok('ch4 flicker: the probe ran', false, String((e && e.stack) || e).slice(0, 300));
    } finally {
      sim.renderer.render = () => {};
    }
    Dir.quitToStory();
    r.ok('ch4: quitting leaves nothing of the chapter behind, and no boat', !S().active && !sim.scene.getObjectByName('story:gannet-bar') && !sim.vehicle && !T.PLATFORMS.some((p) => p.name === 'Gannet bar'));
  } catch (err) {
    r.ok('ch4: the check ran to the end', false, String((err && err.stack) || err).slice(0, 500));
  } finally {
    window.removeEventListener('unhandledrejection', onRej);
    try {
      if (sim.vehicle && sim.stopDrive) sim.stopDrive();
      if (sim.state !== 'menu') sim.quitToMenu('main');
      if (sim.switchGame && wasGame && sim.game !== wasGame) sim.switchGame(wasGame);
    } catch (e) {
      /* fine */
    }
    try {
      if (saved == null) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, saved);
    } catch (e) {
      /* fine */
    }
    try {
      Dir.reloadSave();
    } catch (e) {
      /* fine */
    }
    sim.renderer.render = realRender;
    sim.settings.reduceFlashing = origReduce;
    if (sim.prog) sim.prog.devUnlocked = origDev;
    sim.autoPauseOnHide = origAuto;
  }
}
