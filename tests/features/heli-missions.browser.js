/**
 * EVERY SKYHOOK MISSION, FLOWN BY DOING WHAT IT SAYS.
 *
 * A key-driven pilot that reads the mission's own current step and its own
 * target — the same arrow and beacon a player follows — and does what the
 * step's words tell a player to do: Shift to raise the collective and lift,
 * let go to hover, point the nose with Q/E, hold W towards the beacon, let go
 * or brake with S to stop, tap W A S D to shuffle over the spot, tap Shift or
 * Ctrl until the HEIGHT light is green, hold Ctrl to land. Nothing here
 * touches the flight model or the runner: if a mission cannot be finished
 * this way, a player cannot finish it either.
 *
 * It flies at normal difficulty with the stability assist on, which is what
 * every player gets by default: the collective is a lever, and letting go of
 * it holds the height where the machine can stop (so this pilot lets go
 * early, by the stopping distance, the way a player learns to).
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
  /*
   * A held key repeats, as a real keyboard's does: if anything clears the
   * game's held-key table (a window blur does), the key is down again within
   * a few frames. Without it this pilot once sat for minutes "holding Ctrl"
   * over Night Deck's hospital while the card said HOVERING.
   */
  const down = new Set();
  const keyEvent = (type, k) => window.dispatchEvent(new KeyboardEvent(type, { code: KEYS[k][0], key: KEYS[k][1], bubbles: true }));
  const press = (k) => {
    down.add(k);
    keyEvent('keydown', k);
  };
  const release = (k) => {
    down.delete(k);
    keyEvent('keyup', k);
  };
  const allUp = () => {
    for (const k in KEYS) release(k);
    down.clear();
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
  let doing = '';
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
      if (sinceYield % 8 === 0) for (const k of down) keyEvent('keydown', k);
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
  /**
   * Q/E until the nose points at (x, z). At speed a player turns with the
   * stick as well (a bank, which the assist coordinates) and lets go of W
   * for a big turn: the pedals alone at 55 m/s, W still held, took this
   * pilot round a 1 km circle for 60 s on Night Deck.
   */
  const face = async (x, z, tol = 8) => {
    for (let i = 0; i < 40 && !over(); i++) {
      const brg = (Math.atan2(x - ac().pos.x, -(z - ac().pos.z)) * 180) / Math.PI;
      const err = wrap(brg - ac().heading);
      if (Math.abs(err) < tol) return;
      const fast = ac().groundSpeed > 15;
      if (fast && Math.abs(err) > 30) release('W');
      const ks = fast ? [err > 0 ? 'E' : 'Q', err > 0 ? 'D' : 'A'] : [err > 0 ? 'E' : 'Q'];
      for (const k of ks) press(k);
      await tick(Math.min(0.5, Math.abs(err) / 45));
      for (const k of ks) release(k);
    }
  };
  /** Where letting go of the lever now would stop it: the hold's 3 m/s^2, and a little lag. */
  const stopsAt = () => {
    const vs = ac().vs;
    return surfaceH() + (vs * Math.abs(vs)) / 6 + vs * 0.3;
  };
  /** Shift or Ctrl until the height over the surface is about h. */
  const heightTo = async (h, tol = 1.5) => {
    doing = `going to ${Math.round(h)} m`;
    for (let i = 0; i < 60 && !over(); i++) {
      const e = h - surfaceH();
      if (Math.abs(e) < tol) break;
      const k = e > 0 ? 'Shift' : 'Ctrl';
      press(k);
      // Let go early, by the stopping distance.
      for (let j = 0; j < 400 && !over(); j++) {
        await tick();
        const now = h - stopsAt();
        if (Math.abs(now) < 1 || Math.sign(now) !== Math.sign(e)) break;
      }
      release(k);
      await tick(3);
    }
  };
  /** Point at it, hold W, let go in time to stop; then shuffle over it. */
  /*
   * Before a long leg, get above what is in the way, as a player does who can
   * see the hills: the highest ground or roof within 60 m of the straight
   * line there, plus 30 m. (At 150 m it went over the next mountain as
   * well, 775 m up on Last Light's map, and ran out of time coming down.) The hold's own look-ahead climbs for what is
   * left, but not for a 150 m ridge at 60 m/s.
   */
  let T = null;
  const routeTop = (x, z) => {
    if (!T) return -Infinity;
    const a = ac().pos;
    const d = Math.hypot(x - a.x, z - a.z);
    let top = 0;
    for (let k = 0; k <= Math.ceil(d / 40); k++) {
      const t = Math.min(1, (k * 40) / Math.max(1, d));
      const px = a.x + (x - a.x) * t;
      const pz = a.z + (z - a.z) * t;
      for (const [ox, oz] of [[0, 0], [30, 0], [-30, 0], [0, 30], [0, -30]]) top = Math.max(top, T.heightAt(px + ox, pz + oz));
      for (const o of T.OBSTACLES) if (px > o.x0 - 60 && px < o.x1 + 60 && pz > o.z0 - 60 && pz < o.z1 + 60) top = Math.max(top, o.y1);
    }
    return top;
  };
  const flyTo = async (getPos, within = 5, stopOnStep = null, maxLegs = 400) => {
    const startStep = stepId();
    doing = `flying to within ${within} m`;
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
      // Looked at again every ten legs: the line there moves as the pilot
      // turns and brakes (Man Overboard's pilot, home from the swimmer at
      // 60 m, met CV-11 Resolute's side at 62 m/s).
      if (d > 300 && leg % 10 === 0 && !ac().onGround) {
        const need = routeTop(p.x, p.z) + 30 - (ac().pos.y - surfaceH());
        if (need > surfaceH() + 3) await heightTo(need, 3);
      }
      if (d > 45) {
        await face(p.x, p.z, d > 400 ? 10 : 6);
        // "Slow down over the ring — let go of W, or S to brake."
        const stop = (gs * gs) / (2 * 2.2) + 20;
        // A sensible cruise, not flat out: at 45 m/s the hold's look-ahead
        // can still climb for what comes up; at 70-77 m/s this pilot met a
        // ship's side and a hill before it could.
        if (d > stop && gs > 45) {
          release('W');
          await tick(0.5);
        } else if (d > stop) {
          press('W');
          await tick(0.5);
        } else {
          release('W');
          if (gs > 4) await holdFor('S', 0.5);
          else await tick(1);
        }
      } else {
        release('W');
        if (gs > 2) {
          // Still moving over the place: brake against it in the nose's own
          // frame, as a player stops (coasting, it went 150 m past the deck
          // and back, again and again).
          const hr = (ac().heading * Math.PI) / 180;
          const v = ac().vel;
          const vf = v.x * Math.sin(hr) - v.z * Math.cos(hr);
          const vr = v.x * Math.cos(hr) + v.z * Math.sin(hr);
          if (Math.abs(vf) > 2.5) await holdFor(vf > 0 ? 'S' : 'W', 0.4);
          else if (Math.abs(vr) > 2.5) await holdFor(vr > 0 ? 'A' : 'D', 0.3);
          else await tick(0.5);
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
    // Only over the place: flyTo gives up after its legs wherever it is, and
    // On Call's pilot once held Ctrl 1.2 km short of the hospital.
    const t = target();
    if (t && Math.hypot(t.x - ac().pos.x, t.z - ac().pos.z) > 12) return;
    doing = 'holding Ctrl to land';
    // "Can't land here — turn her across or down the slope": when the card
    // says so for three seconds, let go, turn a quarter with E, try again.
    for (let attempt = 0; attempt < 5 && !over() && !ac().onGround; attempt++) {
      press('Ctrl');
      let refused = 0;
      for (let i = 0; i < 900 && !over() && !ac().onGround && refused < 3; i++) {
        await tick();
        refused = /CAN.T LAND/.test(sim.hud && sim.hud.heliState ? sim.hud.heliState.textContent : '') ? refused + DT : 0;
      }
      if (ac().onGround) break;
      release('Ctrl');
      // Drifted off the middle (the card says so at an edge): back over it
      // first, as a player would; on the middle, turn a quarter and retry.
      const tt = target();
      if (tt && Math.hypot(tt.x - ac().pos.x, tt.z - ac().pos.z) > 4) await flyTo(target, 4, null, 30);
      else await holdFor('E', 1.5);
      await tick(1);
    }
    await tick(0.5);
    release('Ctrl');
    await tick(2);
  };
  const liftOff = async (h = 35) => {
    if (ac().onGround) {
      press('Shift');
      for (let i = 0; i < 900 && !over() && stopsAt() < h; i++) await tick();
      release('Shift');
      await tick(3);
    } else await heightTo(h);
  };
  /**
   * A winch: over the spot, into the band, then hands off until it is done.
   * "Done" is the gauge going away — On Call has one step for the whole
   * shift, so the step id never changes, and a pilot that waited for it kept
   * flying winch passes towards the hospital and holding Ctrl over the town.
   */
  const winch = async () => {
    doing = 'winching';
    const active = () => !!sim.hoverBox && !over();
    for (let tries = 0; tries < 6 && active(); tries++) {
      const band = (sim.hoverBox.minAgl + sim.hoverBox.maxAgl) / 2;
      if (surfaceH() < band - 6) await heightTo(band);
      // Into the circle (it is 12 m across), THEN the height: chasing a
      // drifting swimmer to the last metre before touching the height is how
      // this pilot once spent fifteen minutes sixty metres over him.
      await flyTo(() => (sim.hoverBox ? sim.hoverBox.pos : null), 7, null, 60);
      if (!active()) break;
      // Down to the band only over the circle: flyTo gives up after its legs
      // wherever it is, and coming down to sixty feet over the sea beside
      // Gannet Stack and then flying at the ledge put this pilot into the
      // cliff at 23 m/s.
      const hb = sim.hoverBox;
      if (hb && Math.hypot(hb.pos.x - ac().pos.x, hb.pos.z - ac().pos.z) > 12) continue;
      await heightTo(band, 1.2);
      for (let i = 0; i < 25 / DT && active(); i++) {
        await tick();
        const b = sim.hoverBox;
        if (b && b.inCircle === false && i > 30) break; // drifted off: go round again
      }
    }
  };

  const results = [];
  try {
    T = await import('../../src/world/terrain.js');
  } catch (e) {
    T = null;
  }
  const origRender = sim.renderer.render;
  sim.renderer.render = () => {};
  const origAutoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const origDiff = (sim.settings && sim.settings.difficulty) || 'normal';
  const origAssist = sim.settings ? sim.settings.heliAssist : undefined;
  try {
    if (sim.applyDifficulty) sim.applyDifficulty('normal');
    if (sim.settings) sim.settings.heliAssist = true;
    for (const id of ids) {
      say(`heli missions: ${id}`);
      progress.id = id;
      allUp();
      clock = 0;
      budget = id === 'oncall' ? 700 : 900;
      if (sim.switchGame) sim.switchGame('heli');
      // Why it failed, from the runner's own report.
      let failWhy = '';
      const origFail = sim.runner && sim.runner.onFail;
      if (sim.runner) {
        sim.runner.onFail = function (e) {
          failWhy = (e && e.reason) || '';
          return origFail ? origFail.call(this, e) : undefined;
        };
      }
      await sim.startAnyMission(id);
      allUp();
      await tick(1);
      const trail = [];
      let lastStep = null;
      let saved = 0;
      while (!over()) {
        const sid = stepId();
        if (sid !== lastStep) {
          trail.push(`${sid}@${Math.round(clock)}`);
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
          for (let i = 0; i < 200 && !over() && surfaceH() < 3; i++) await tick();
          release('Shift');
          await tick(4);
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
          // Hold Shift on the way and arrive above the rock, not beside it."
          if (t && t.y > ac().pos.y - 20) {
            press('Shift');
            for (let i = 0; i < 900 && !over() && ac().pos.y + (stopsAt() - surfaceH()) < t.y + 30; i++) await tick();
            release('Shift');
            await tick(3);
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
          const tp = target();
          if (tp && Math.hypot(tp.x - ac().pos.x, tp.z - ac().pos.z) > 12) continue;
          // Ctrl until the skids are down (turning if the card says it
          // cannot land there, as landHere does), then until the step has
          // taken it.
          await landHere();
          doing = 'holding Ctrl onto the pad';
          press('Ctrl');
          for (let i = 0; i < 60 && !over() && stepId() === sid; i++) await tick();
          release('Ctrl');
        } else if (sid === 'second') {
          // "Go for the second one, or stay on the pad." Go if there is time.
          // This pilot's second call — lift, Gannet Point, winch, home, land
          // on St Brendan — took 378 s measured (207 s out and winching, 171 s
          // home and down; 2026-09-26, headless Chrome, the old easy mode), and whole
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
      const where = () => {
        const t = target();
        const card = sim.hud && sim.hud.heliState ? sim.hud.heliState.textContent : '';
        return ` at ${Math.round(ac().pos.x)}, ${Math.round(ac().pos.z)}, ${surfaceH().toFixed(1)} m up, ${ac().groundSpeed.toFixed(1)} m/s${
          t ? `, ${Math.round(Math.hypot(t.x - ac().pos.x, t.z - ac().pos.z))} m from the target` : ''}${ac().onGround ? ', on the ground' : ''}, card "${card}", last ${doing}`;
      };
      const why = ac().crashed
        ? `CRASHED: ${ac().crashReason}${where()}`
        : !ok
          ? `${status === 'failed' ? `failed${failWhy ? ': ' + failWhy : ''}` : status}${where()}`
          : '';
      if (sim.runner) sim.runner.onFail = origFail;
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
    if (sim.settings && origAssist !== undefined) sim.settings.heliAssist = origAssist;
    sim.autoPauseOnHide = origAutoPause;
    sim.renderer.render = origRender;
  }
  return results;
}

export default check;
