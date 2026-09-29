/**
 * EVERY SKYHOOK MISSION, FLOWN BY DOING WHAT IT SAYS.
 *
 * A key-driven pilot that reads the mission's own current step and its own
 * target — the same arrow and beacon a child follows — and does what the
 * step's words tell a child to do: Shift to lift, let go to hover, point the
 * nose with Q/E, hold W towards the beacon, let go to stop, tap W A S D to
 * shuffle over the spot, Shift/Ctrl until the HEIGHT light is green, hold
 * Ctrl to land. Nothing here touches the flight model or the runner: if a
 * mission cannot be finished this way, a child cannot finish it either.
 *
 * It flies in kid mode (easy), which is what a child gets by default.
 *
 * Measured on the unmodified build (0db28ca), none of these could be finished
 * by anybody: the pads they named did not exist on the maps they flew on
 * (sim.pads was never set), The Ledge spawned the machine 48 m under the sea,
 * Night Deck on a 20-degree hillside, and the first hover of First Light
 * ended "You came down far too fast".
 *
 * Slow: several minutes of wall clock for all seven, and it hands the page
 * back every thirty frames so it can be watched. Run it alone:
 *
 *   const s = window.__sim; s.renderer.render = () => {};
 *   const r = { checks: [], ok(n, p, d = '') { this.checks.push({ n, p: !!p, d: String(d) }); return !!p; } };
 *   await (await import('/tests/features/heli-missions.browser.js')).check(s, r, console.log);
 */

const KEYS = {
  Shift: ['ShiftLeft', 'Shift'],
  Ctrl: ['ControlLeft', 'Control'],
  W: ['KeyW', 'w'],
  A: ['KeyA', 'a'],
  S: ['KeyS', 's'],
  D: ['KeyD', 'd'],
  Q: ['KeyQ', 'q'],
  E: ['KeyE', 'e'],
};

export const MISSION_IDS = ['firstlight', 'covepickup', 'overboard', 'stackrescue', 'nightdeck', 'lastlight', 'oncall'];

export async function check(sim, r, say = () => {}, opts = {}) {
  const ids = opts.ids || MISSION_IDS;
  const press = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { code: KEYS[k][0], key: KEYS[k][1], bubbles: true }));
  const release = (k) => window.dispatchEvent(new KeyboardEvent('keyup', { code: KEYS[k][0], key: KEYS[k][1], bubbles: true }));
  const allUp = () => {
    for (const k in KEYS) release(k);
  };
  const ac = () => sim.aircraft;
  // The height a child reads off the card: metres of air under the skids.
  const surfaceH = () => {
    const R = ac().rotor;
    return R && Number.isFinite(R.heightAbove) ? R.heightAbove : ac().pos.y - Math.max(0, ac().pos.y - ac().agl) - 1.69;
  };
  const wrap = (d) => ((d + 540) % 360) - 180;
  const DT = 1 / 15;
  let clock = 0; // game seconds flown in this mission
  const progress = (sim.__heliMissionProgress = { id: null, clock: 0, step: null, results: [] });
  let budget = 0;
  const running = () => sim.runner && sim.runner.status === 'running';
  const over = () => !running() || ac().crashed || clock > budget;
  /*
   * Hand the page back every few frames, or a four-minute run holds the main
   * thread the whole time and nothing can ask how it is going. A
   * MessageChannel and not setTimeout: a hidden tab throttles timers to one
   * a second, which would make this run for an hour.
   */
  const chan = new MessageChannel();
  let wake = null;
  chan.port1.onmessage = () => {
    const w = wake;
    wake = null;
    if (w) w();
  };
  let sinceYield = 0;
  const yieldNow = () =>
    new Promise((res) => {
      wake = res;
      chan.port2.postMessage(0);
    });
  const tick = async (secs = DT) => {
    const n = Math.max(1, Math.round(secs / DT));
    for (let i = 0; i < n; i++) {
      if (sim.state === 'paused' && sim.resume) sim.resume();
      sim.step(DT);
      clock += DT;
      if (++sinceYield >= 30) {
        sinceYield = 0;
        progress.clock = Math.round(clock);
        progress.step = stepId();
        await yieldNow();
      }
      if (over()) return;
    }
  };
  const holdFor = async (k, secs) => {
    press(k);
    await tick(secs);
    release(k);
  };
  const stepId = () => (sim.runner && sim.runner.step ? sim.runner.step.id : null);
  const target = () => {
    const t = sim.runner && sim.runner.activeTarget ? sim.runner.activeTarget() : null;
    return t ? t.pos : null;
  };

  /* ------------------------------------------------ the pilot's hands */
  /** Q/E until the nose points at (x, z). */
  const face = async (x, z, tol = 8) => {
    for (let i = 0; i < 40 && !over(); i++) {
      const brg = (Math.atan2(x - ac().pos.x, -(z - ac().pos.z)) * 180) / Math.PI;
      const err = wrap(brg - ac().heading);
      if (Math.abs(err) < tol) return;
      await holdFor(err > 0 ? 'E' : 'Q', Math.min(0.5, Math.abs(err) / 45));
    }
  };
  /** Shift or Ctrl until the height over the surface is about h. */
  const heightTo = async (h, tol = 1.5) => {
    for (let i = 0; i < 60 && !over(); i++) {
      const e = h - surfaceH();
      if (Math.abs(e) < tol) break;
      const k = e > 0 ? 'Shift' : 'Ctrl';
      press(k);
      // Let go early: it takes a couple of metres to stop.
      for (let j = 0; j < 400 && !over(); j++) {
        await tick();
        const now = h - surfaceH();
        if (Math.abs(now) < 2.5 || Math.sign(now) !== Math.sign(e)) break;
      }
      release(k);
      await tick(2.5);
    }
  };
  /** Point at it, hold W, let go in time to stop; then shuffle over it. */
  const flyTo = async (getPos, within = 5, stopOnStep = null, maxLegs = 400) => {
    const startStep = stepId();
    for (let leg = 0; leg < maxLegs && !over(); leg++) {
      if (stopOnStep && stepId() !== startStep) return;
      const p = getPos();
      if (!p) return;
      const dx = p.x - ac().pos.x;
      const dz = p.z - ac().pos.z;
      const d = Math.hypot(dx, dz);
      const gs = ac().groundSpeed;
      if (d < within && gs < 1.2) return;
      // Sitting on the skids nothing turns or moves: lift first.
      if (ac().onGround) {
        await liftOff(30);
        continue;
      }
      if (d > 45) {
        await face(p.x, p.z, d > 400 ? 10 : 6);
        const stop = (gs * gs) / (2 * 3.2) + 15;
        if (d > stop) {
          press('W');
          await tick(0.5);
        } else {
          release('W');
          await tick(1);
        }
      } else {
        release('W');
        if (gs > 2) {
          await tick(1);
          continue;
        }
        // Shuffle: in the nose's own frame, a tap for every few metres off.
        const h = (ac().heading * Math.PI) / 180;
        const fwd = dx * Math.sin(h) - dz * Math.cos(h);
        const right = dx * Math.cos(h) + dz * Math.sin(h);
        if (Math.abs(fwd) > within * 0.5) await holdFor(fwd > 0 ? 'W' : 'S', clampN(Math.abs(fwd) / 25, 0.15, 0.6));
        if (Math.abs(right) > within * 0.5) await holdFor(right > 0 ? 'D' : 'A', clampN(Math.abs(right) / 25, 0.15, 0.6));
        await tick(2);
      }
    }
    release('W');
  };
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
  /** Hold Ctrl until the skids are on something. */
  const landHere = async () => {
    press('Ctrl');
    for (let i = 0; i < 900 && !over() && !ac().onGround; i++) await tick();
    await tick(0.5);
    release('Ctrl');
    await tick(2);
  };
  const liftOff = async (h = 35) => {
    if (ac().onGround) {
      press('Shift');
      for (let i = 0; i < 900 && !over() && surfaceH() < h - 4; i++) await tick();
      release('Shift');
      await tick(2);
    } else await heightTo(h);
  };
  /**
   * A winch: over the spot, into the band, then hands off until it is done.
   * "Done" is the gauge going away — On Call has one step for the whole
   * shift, so the step id never changes, and a pilot that waited for it kept
   * flying winch passes towards the hospital and holding Ctrl over the town.
   */
  const winch = async () => {
    const active = () => !!sim.hoverBox && !over();
    for (let tries = 0; tries < 6 && active(); tries++) {
      const band = (sim.hoverBox.minAgl + sim.hoverBox.maxAgl) / 2;
      if (surfaceH() < band - 6) await heightTo(band);
      // Into the circle (it is 12 m across), THEN the height: chasing a
      // drifting swimmer to the last metre before touching the height is how
      // this pilot once spent fifteen minutes sixty metres over him.
      await flyTo(() => (sim.hoverBox ? sim.hoverBox.pos : null), 7, null, 60);
      if (!active()) break;
      await heightTo(band, 1.2);
      for (let i = 0; i < 25 / DT && active(); i++) {
        await tick();
        const b = sim.hoverBox;
        if (b && b.inCircle === false && i > 30) break; // drifted off: go round again
      }
    }
  };

  const results = [];
  const origRender = sim.renderer.render;
  sim.renderer.render = () => {};
  const origAutoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const origDiff = (sim.settings && sim.settings.difficulty) || 'normal';
  try {
    if (sim.applyDifficulty) sim.applyDifficulty('easy');
    for (const id of ids) {
      say(`heli missions: ${id}`);
      progress.id = id;
      allUp();
      clock = 0;
      budget = id === 'oncall' ? 700 : 900;
      if (sim.switchGame) sim.switchGame('heli');
      await sim.startAnyMission(id);
      allUp();
      await tick(1);
      const trail = [];
      let lastStep = null;
      let saved = 0;
      while (!over()) {
        const sid = stepId();
        if (sid !== lastStep) {
          trail.push(sid);
          lastStep = sid;
        }
        const t = target();
        if (id === 'oncall') {
          // No steps to read: the radio and the objective panel say what to do.
          const d = sim.runner.data;
          saved = d.saved || 0;
          if (saved >= 1) break;
          if (d.phase === 'wait') {
            await tick(1);
          } else if (d.phase === 'out') {
            await liftOff(40);
            await flyTo(() => d.call && d.call.pos, 60);
          } else if (d.phase === 'winch') {
            await winch();
          } else if (d.phase === 'home') {
            if (ac().onGround) await liftOff(40);
            await flyTo(target, 5);
            await landHere();
          } else await tick(1);
          continue;
        }
        if (sid === 'lift') {
          press('Shift');
          for (let i = 0; i < 200 && !over() && surfaceH() < 5.5; i++) await tick();
          release('Shift');
          await tick(3);
        } else if (sid === 'hold' || sid === 'winch' || sid === 'first') {
          if (sid === 'first') await liftOff(30);
          await winch();
        } else if (sid === 'turn') {
          await holdFor('E', 0.5);
        } else if (sid === 'down') {
          await flyTo(target, 4);
          await landHere();
          await tick(3);
        } else if (sid === 'out' || sid === 'choose') {
          await liftOff(45);
          // The Ledge's hint: "The top of the stack is two hundred metres up.
          // Hold Shift on the way."
          if (t && t.y > ac().pos.y - 20) {
            press('Shift');
            for (let i = 0; i < 900 && !over() && ac().pos.y < t.y + 30; i++) await tick();
            release('Shift');
            await tick(2);
          }
          if (t) await flyTo(target, 60, true);
          else await tick(1);
        } else if (sid === 'land') {
          if (ac().onGround) await liftOff(30);
          await flyTo(target, 4);
          await landHere();
          await tick(3);
        } else if (sid === 'wait') {
          await tick(1);
        } else if (sid === 'home' || sid === 'drop' || sid === 'finish') {
          if (ac().onGround) await liftOff(40);
          await flyTo(target, 4);
          // Ctrl until the skids are down and the step has taken it.
          press('Ctrl');
          for (let i = 0; i < 900 && !over() && !ac().onGround; i++) await tick();
          for (let i = 0; i < 60 && !over() && stepId() === sid; i++) await tick();
          release('Ctrl');
        } else if (sid === 'second') {
          // "Go for the second one, or stay on the pad." Go if there is time.
          // This pilot's second call — lift, Gannet Point, winch, home, land
          // on St Brendan — took 378 s measured (207 s out and winching, 171 s
          // home and down; 2026-09-26, headless Chrome, kid mode), and whole
          // runs of the mission took 534-581 s. At the old 240 s one
          // full-suite run went anyway and ran out at the 600 s limit.
          // Staying on the pad is one of the mission's own two answers and
          // completes it with one saved.
          const left = (sim.runner.def.timeLimit || 600) - sim.runner.elapsed;
          if (left > 420) {
            await liftOff(45);
            await flyTo(target, 60, true);
            await winch();
          } else await tick(1);
        } else {
          await tick(1);
        }
      }
      allUp();
      const status = sim.runner ? sim.runner.status : '?';
      const ok = id === 'oncall' ? saved >= 1 && !ac().crashed : status === 'complete';
      const why = ac().crashed ? `CRASHED: ${ac().crashReason}` : status === 'failed' ? `failed` : '';
      results.push({ id, ok, status, clock: Math.round(clock), trail: trail.join(' > '), why });
      progress.results = results;
      r.ok(
        `mission ${id} can be finished by doing what it says`,
        ok,
        `${id === 'oncall' ? `${saved} saved` : status} in ${Math.round(clock)} s of flying: ${trail.join(' > ')}${why ? ' — ' + why : ''}`
      );
    }
    /*
     * And what a mission leaves behind. Man Overboard puts a fishing boat
     * and a lit ring in the sea; the flight after it — here the Skylark,
     * reached through the menu and then straight from the mission — must not
     * have them. missions-heli.js clears them through the plug-in hooks now,
     * not from main.js (the review of 30a4007 listed that call as outside the
     * helicopter's branches).
     */
    if (!opts.ids || ids.includes('overboard')) {
      say('heli missions: what Man Overboard leaves behind');
      const planeFree = async () => {
        if (sim.switchGame) sim.switchGame('flight');
        await sim.startMode('free');
        await tick(0.5);
        return sim.scene.children.length;
      };
      sim.quitToMenu();
      const before = await planeFree();
      const got = [];
      for (const how of ['menu', 'straight']) {
        sim.quitToMenu();
        if (sim.switchGame) sim.switchGame('heli');
        await sim.startAnyMission('overboard');
        await tick(1);
        const during = sim.scene.children.length;
        if (how === 'menu') sim.quitToMenu();
        const after = await planeFree();
        got.push({ how, during, after, box: sim.hoverBox == null });
      }
      r.ok(
        'the flight after Man Overboard has none of its props',
        got.every((g) => g.during > before && g.after === before && g.box),
        `scene children: Skylark ${before}; ` + got.map((g) => `${g.how}: mission ${g.during}, Skylark after ${g.after}, gauge gone ${g.box}`).join('; ')
      );
      sim.quitToMenu();
    }
  } catch (e) {
    r.ok('heli missions ran without throwing', false, (e && e.stack) || String(e));
  } finally {
    allUp();
    if (sim.applyDifficulty) sim.applyDifficulty(origDiff);
    sim.autoPauseOnHide = origAutoPause;
    sim.renderer.render = origRender;
  }
  return results;
}

export default check;
