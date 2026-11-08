/**
 * Browser checks for SIGNAL ZERO chapter 2, FIRE LINE, in the real game.
 * tests/features/story-ch02.mjs checks the graph, the checkpoints, the fire's
 * pace and the medals in node; this is what node cannot see:
 *
 *   - Continue after chapter 1 starts chapter 2 at its briefing (a route
 *     picture, three bullets), and it opens at Firewatch Base in the Skyhook
 *     with a bucket, a hot clear morning, the fire burning on the Long Scarp,
 *     the lookout, the crew, the wreck and the survey marker in the world,
 *     and the fire panel hidden until the line;
 *   - a KEY-DRIVEN ROBOT plays it start to finish (PASS): Shift and Ctrl on
 *     the lever, W A S D and Q E, X for the bucket, SPACE for the photo —
 *     the same keys a player has, reading the chapter's own step and arrow.
 *     It lands on the pad ahead of the smoke (3 s on the deck), waits while
 *     the crew run to the door, lifts them out, and puts three buckets on
 *     the back of the fire (filled in place — see the fill branch; the dip
 *     in the inlet is flown for real in the fail-and-retry section),
 *     hovers over the survey marker (File 02) and the wreck, photographs it,
 *     and watches the burn-scar cutscene to the debrief and its medal;
 *   - the one-minute guarantee: no two autosaves more than 75 s of play apart;
 *   - FAIL → RETRY FROM CHECKPOINT, twice: sitting at the base until the
 *     smoke closes the pad (the lookout beat), and hovering over the inlet
 *     with a full bucket until the fire reaches the road (the line beat) —
 *     each a kind line, nothing saved while failing, and Retry back in the
 *     air in ≤ 3 s at the checkpoint's step and pose, with the fire, the
 *     bucket's water and the drops so far put back;
 *   - LEAVE AND CONTINUE from a mid-chapter checkpoint: the recap, then the
 *     same beat, step and pose;
 *   - the FLICKER PROBE on the lookout title card, the fire at its peak and
 *     the burn-scar cutscene (Reduce flashing on), and the FRAME TIME there.
 *
 * It puts the player's own story save back afterwards.
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export const id = 'story-ch02';

const KEY = 'islandsim.story.v1';

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
/* The pilot: the keys a player has, nothing else                           */
/* ====================================================================== */

/**
 * Condensed from tests/features/heli-missions.browser.js, which flies every
 * Skyhook mission this way: a held key repeats as a real keyboard's does,
 * the lever is let go of early by the stopping distance (the assist holds the
 * height where it is let go), and long legs are flown above whatever is in
 * the way. Added here: the bucket (fill in a low hover, drop on the green
 * ring with X) and the camera (SPACE).
 */
function makePilot(sim, { T, W, Ch2, budget = 1200 }) {
  const P = {
    clock: 0,
    budget,
    log: [],
    stopIf: null,
  };
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
  P.allUp = () => {
    for (const k in KEYS) release(k);
    down.clear();
  };
  const ac = () => sim.aircraft;
  const DT = 1 / 15;
  P.DT = DT;
  // The terrain's own height under the skids, always (the rotor's radar reading
  // has read high over the scar: a descent to "60 m" met the ground, 2026-11-08).
  const surfaceH = () => ac().pos.y - Math.max(0, T.heightAt(ac().pos.x, ac().pos.z)) - 1.69;
  P.surfaceH = surfaceH;
  const wrap = (d) => ((d + 540) % 360) - 180;
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
  P.over = () => P.clock > P.budget || ac().crashed || (P.stopIf && P.stopIf());
  P.tick = async (secs = DT) => {
    const n = Math.max(1, Math.round(secs / DT));
    for (let i = 0; i < n; i++) {
      if (sim.state === 'paused' && sim.resume) sim.resume();
      sim.step(DT);
      P.clock += DT;
      if (since % 8 === 0) for (const k of down) keyEvent('keydown', k);
      if (++since >= 30) {
        since = 0;
        await yieldNow();
        // The director's beat and finale hand-offs are promise continuations.
        await Promise.resolve();
      }
      if (P.over()) return;
    }
  };
  const holdFor = async (k, secs) => {
    press(k);
    await P.tick(secs);
    release(k);
  };
  P.holdFor = holdFor;
  P.face = async (x, z, tol = 8) => {
    for (let i = 0; i < 40 && !P.over(); i++) {
      const brg = (Math.atan2(x - ac().pos.x, -(z - ac().pos.z)) * 180) / Math.PI;
      const err = wrap(brg - ac().heading);
      if (Math.abs(err) < tol) return;
      const fast = ac().groundSpeed > 15;
      if (fast && Math.abs(err) > 30) release('W');
      const ks = fast ? [err > 0 ? 'E' : 'Q', err > 0 ? 'D' : 'A'] : [err > 0 ? 'E' : 'Q'];
      for (const k of ks) press(k);
      await P.tick(Math.min(0.5, Math.abs(err) / 45));
      for (const k of ks) release(k);
    }
  };
  const stopsAt = () => {
    const vs = ac().vs;
    return surfaceH() + (vs * Math.abs(vs)) / 6 + vs * 0.3;
  };
  /** Shift or Ctrl until the skids are about h over the surface below. */
  P.heightTo = async (h, tol = 1.5) => {
    for (let i = 0; i < 60 && !P.over(); i++) {
      const e = h - surfaceH();
      if (Math.abs(e) < tol) break;
      const k = e > 0 ? 'Shift' : 'Ctrl';
      press(k);
      for (let j = 0; j < 400 && !P.over(); j++) {
        await P.tick();
        const now = h - stopsAt();
        if (Math.abs(now) < 1 || Math.sign(now) !== Math.sign(e)) break;
        // Coming down to a height above the ground: never through 12 m of it on the way.
        if (k === 'Ctrl' && h > 15 && surfaceH() < 12) break;
        /*
         * Never a fast hover descent with the bucket full: that is vortex ring
         * state (rotor-assist.js, the Oct 24 wave) — the rotor settles with power
         * into the ground, and twice this robot "struck the ground" at a hover
         * over the fire from 60 m. Ease the lever when the sink passes 4 m/s.
         */
        if (k === 'Ctrl' && ac().vs < -4) {
          release('Ctrl');
          await P.tick(0.7);
          if (P.over()) return;
          press('Ctrl');
        }
      }
      release(k);
      await P.tick(1.2);
    }
  };
  /** Shift or Ctrl until the machine is at about y metres above sea level. */
  P.altTo = async (y, tol = 2) => {
    const g = () => Math.max(0, T.heightAt(ac().pos.x, ac().pos.z));
    for (let i = 0; i < 6 && !P.over(); i++) {
      const want = y - g() - 1.69;
      if (Math.abs(want - surfaceH()) < tol) return;
      await P.heightTo(want, tol);
    }
  };
  /** The highest ground on the straight line to (x, z), plus a little sideways. */
  const routeTop = (x, z) => {
    const a = ac().pos;
    const d = Math.hypot(x - a.x, z - a.z);
    let top = 0;
    for (let k = 0; k <= Math.ceil(d / 40); k++) {
      const t = Math.min(1, (k * 40) / Math.max(1, d));
      const px = a.x + (x - a.x) * t;
      const pz = a.z + (z - a.z) * t;
      for (const [ox, oz] of [[0, 0], [30, 0], [-30, 0], [0, 30], [0, -30]]) top = Math.max(top, T.heightAt(px + ox, pz + oz));
    }
    return top;
  };
  /** The highest ground within `m` metres along compass heading `hdg` from here, a little either side. */
  const topAlong = (hdg, m) => {
    const a = ac();
    const h = (hdg * Math.PI) / 180;
    const fx = Math.sin(h);
    const fz = -Math.cos(h);
    let top = -Infinity;
    for (let k = 1; k <= 4; k++) {
      const px = a.pos.x + fx * (m * k) / 4;
      const pz = a.pos.z + fz * (m * k) / 4;
      for (const [ox, oz] of [[0, 0], [-fz * 25, fx * 25], [fz * 25, -fx * 25]]) top = Math.max(top, T.heightAt(px + ox, pz + oz));
    }
    return Math.max(0, top);
  };
  /** The highest ground within `m` metres ahead along the heading, a little either side. */
  const topAhead = (m) => {
    const a = ac();
    const h = (a.heading * Math.PI) / 180;
    const fx = Math.sin(h);
    const fz = -Math.cos(h);
    let top = -Infinity;
    for (let k = 1; k <= 4; k++) {
      const px = a.pos.x + fx * (m * k) / 4;
      const pz = a.pos.z + fz * (m * k) / 4;
      for (const [ox, oz] of [[0, 0], [-fz * 25, fx * 25], [fz * 25, -fx * 25]]) top = Math.max(top, T.heightAt(px + ox, pz + oz));
    }
    return Math.max(0, top);
  };
  /**
   * Point at it, hold W, let go in time to stop; then shuffle over it. Long
   * legs go above the highest ground on the way (+ `clear` m). Returns when
   * within `within` m and nearly stopped, or when `until()` says so.
   */
  P.flyTo = async (getPos, within = 5, { clear = 35, maxLegs = 400, until = null, cruise = 45 } = {}) => {
    let climbing = false;
    const done = () => {
      if (climbing) release('Shift');
      climbing = false;
    };
    // `break`, never `return`, out of the loop: the W (and a climb) held on
    // the way must be let go at the end. On 2026-11-08 the new rotor air
    // (physics.js rotorAir) took a robot that kept W through its descent to
    // the pad on to 61 m/s and into the rock above the bench.
    for (let leg = 0; leg < maxLegs && !P.over(); leg++) {
      if (until && until()) break;
      const p = getPos();
      if (!p) break;
      const dx = p.x - ac().pos.x;
      const dz = p.z - ac().pos.z;
      const d = Math.hypot(dx, dz);
      const gs = ac().groundSpeed;
      // High over the place, near enough is near enough (the heli-missions
      // pilot, 2026-11-04): a hover 60 m up drifts in the wind, and a pilot
      // who shuffles for the last four metres up there never comes down.
      const high = surfaceH() > 60;
      if (d < (high ? Math.max(within, 10) : within) && gs < (high ? 3 : 1.5)) break;
      if (ac().onGround) {
        await P.liftOff(25);
        continue;
      }
      /*
       * Above whatever is in the way, the way a player does it: Shift while
       * the route's top is above you, and NO W while the ground just ahead is
       * — a climb with the nose down at 22 m/s off the inlet went into the
       * cliff below the bench (2026-11-08, the rotor wave's Skyhook). Once the
       * ground ahead is under you the W goes back on and the climb goes on
       * with it (a diagonal, not a lift).
       */
      const need = d > 120 ? routeTop(p.x, p.z) + clear : 0;
      const nearTop = topAhead(160) + 25;
      const mustClimb = ac().pos.y < Math.max(need - 3, nearTop);
      if (mustClimb && !climbing) {
        climbing = true;
        press('Shift');
      } else if (!mustClimb && climbing) done();
      const blocked = ac().pos.y < nearTop;
      if (d > 45) {
        if (blocked) {
          /*
           * The ground ahead is above you: stop and climb where you are
           * (Shift is already held). Never fly at a slope: a robot that
           * flew along the cliff at 20-30 m/s a few tens of metres up put
           * its nose into it twice (2026-11-08).
           */
          release('W');
          if (gs > 4) await holdFor('S', 0.3);
          else await P.tick(0.4);
          continue;
        }
        await P.face(p.x, p.z, d > 400 ? 10 : 6);
        const stop = (gs * gs) / (2 * 2.2) + 20;
        if (d > stop && gs > cruise) {
          release('W');
          await P.tick(0.4);
        } else if (d > stop) {
          press('W');
          await P.tick(0.4);
        } else {
          release('W');
          if (gs > 4) await holdFor('S', 0.4);
          else await P.tick(0.6);
        }
      } else {
        release('W');
        if (gs > 2) {
          const hr = (ac().heading * Math.PI) / 180;
          const v = ac().vel;
          const vf = v.x * Math.sin(hr) - v.z * Math.cos(hr);
          const vr = v.x * Math.cos(hr) + v.z * Math.sin(hr);
          if (Math.abs(vf) > 2.2) await holdFor(vf > 0 ? 'S' : 'W', 0.35);
          else if (Math.abs(vr) > 2.2) await holdFor(vr > 0 ? 'A' : 'D', 0.3);
          else await P.tick(0.4);
          continue;
        }
        const h = (ac().heading * Math.PI) / 180;
        const fwd = dx * Math.sin(h) - dz * Math.cos(h);
        const right = dx * Math.cos(h) + dz * Math.sin(h);
        const c = (v, a, b) => Math.max(a, Math.min(b, v));
        if (Math.abs(fwd) > within * 0.5) await holdFor(fwd > 0 ? 'W' : 'S', c(Math.abs(fwd) / 20, 0.12, 0.7));
        if (Math.abs(right) > within * 0.5) await holdFor(right > 0 ? 'D' : 'A', c(Math.abs(right) / 20, 0.12, 0.7));
        await P.tick(0.9);
      }
    }
    done();
    release('W');
  };
  P.liftOff = async (h = 30) => {
    if (ac().onGround) {
      press('Shift');
      for (let i = 0; i < 900 && !P.over() && stopsAt() < h; i++) await P.tick();
      release('Shift');
      await P.tick(2);
    } else await P.heightTo(h);
  };
  /** Hold Ctrl over the spot until the skids are on it. */
  P.landHere = async (getPos) => {
    for (let attempt = 0; attempt < 5 && !P.over() && !ac().onGround; attempt++) {
      press('Ctrl');
      let refused = 0;
      for (let i = 0; i < 900 && !P.over() && !ac().onGround && refused < 3; i++) {
        await P.tick();
        refused = /CAN.T LAND/.test(sim.hud && sim.hud.heliState ? sim.hud.heliState.textContent : '') ? refused + DT : 0;
        const p = getPos();
        if (p && Math.hypot(p.x - ac().pos.x, p.z - ac().pos.z) > 6 && surfaceH() > 4) break;
      }
      release('Ctrl');
      if (ac().onGround) break;
      const p = getPos();
      if (p && Math.hypot(p.x - ac().pos.x, p.z - ac().pos.z) > 3) await P.flyTo(getPos, 3, { maxLegs: 30 });
      else await holdFor('E', 1.2);
    }
    release('Ctrl');
  };
  /** X, the way a keyboard sends it (at the page, bubbling). */
  P.pressX = () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyX', key: 'x', bubbles: true, cancelable: true }));
    document.body.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyX', key: 'x', bubbles: true, cancelable: true }));
  };
  P.pressSpace = () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true, cancelable: true }));
  };
  /** Over the water (the tarn, or the sea), down until the bucket dips in, and wait for the fill. */
  P.fill = async () => {
    const fp = () => W.fillPoint(new (sim.aircraft.pos.constructor)());
    await P.flyTo(fp, 10, { clear: 30 });
    const tank = () => W.fireWater().tank;
    for (let tries = 0; tries < 6 && !P.over() && tank() && tank().fraction < 0.9; tries++) {
      // Down gently, a metre or two at a time, until the tank says it is filling: the bucket
      // hangs 18 m under the hook and the band where it dips is a few metres deep, and a
      // hover coming down at 8 m/s is vortex ring state (it sank into the tarn's hollow once).
      // Straight to the height the bucket dips at (the pool's water + 0.7 m + the 18 m line, measured
      // 2026-11-08: it fills with the skids 17-20 m over the water), then a metre lower each time it
      // is not filling. Taps of the lever the height hold undoes; altTo() holds the lever until it is there.
      const pool = W.fillPoint(new (sim.aircraft.pos.constructor)());
      const waterY = pool ? pool.y - 25 : 0; // fillPoint stands 25 m over the water
      for (let k = 0; k < 8 && !P.over() && tank() && !tank().filling && tank().fraction < 0.9; k++) {
        await P.altTo(waterY + 19.5 - k * 1.2, 0.8);
        await P.tick(1.5);
      }
      for (let i = 0; i < 14 / DT && !P.over() && tank().fraction < 0.9; i++) {
        await P.tick();
        if (ac().groundSpeed > 3) await P.flyTo(fp, 8, { maxLegs: 6 });
      }
    }
    // Up out of the hollow before flying off.
    await P.heightTo(45, 4);
  };
  /** Over the arrow's point on the fire, down to bucket height, and X when the ring goes green. */
  P.drop = async (getPos) => {
    const dbg = W.wildfireDebug();
    const startDrops = W.fireStatus(sim).drops;
    for (let tries = 0; tries < 6 && !P.over() && W.fireStatus(sim).drops === startDrops; tries++) {
      // From the inlet, straight up first: the bench is 430 m above the water
      // and a full bucket climbs it at about 9 m/s in a hover. Over the sea there
      // is nothing to hit on the way; the flight to the fire starts above the bench.
      const p0 = getPos();
      if (p0) {
        // Above the HIGHEST ground on the way (the bench's rim stands above the fire), not the fire's own.
        const want = routeTop(p0.x, p0.z) + 60;
        if (ac().pos.y < want - 5) {
          release('W');
          await P.altTo(want, 5);
        }
      }
      await P.flyTo(getPos, 14, { clear: 30 });
      const p = getPos();
      if (!p) return;
      // Skids about 60 m over whatever is under them (NOT the target's ground: 30 m short
      // of the target on a bench that rises 30 m, that was a descent into the slope). The
      // ring is green from any height the water still lands on flames from (wildfire.js
      // aimBucket predicts the fall); the Treetop style is a player's to earn, not this robot's.
      await P.heightTo(60, 5);
      await P.flyTo(getPos, 8, { maxLegs: 40 });
      for (let i = 0; i < 6 / DT && !P.over(); i++) {
        await P.tick();
        if (dbg.aimGreen) break;
      }
      P.pressX();
      await P.tick(2.5);
    }
    // Climb back out of the smoke.
    await P.heightTo(60, 4);
  };
  return P;
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
  const origDiff = sim.settings.difficulty;
  const origAssist = sim.settings.heliAssist;
  let Dir;
  let Ch;
  let Ch2;
  let W;
  let T;
  let THREE;
  let Save;
  try {
    Dir = await import('../../src/story/director.js');
    Ch = await import('../../src/story/chapters.js');
    Ch2 = await import('../../src/story/ch02-fire-line.js');
    W = await import('../../src/features/wildfire.js');
    T = await import('../../src/world/terrain.js');
    THREE = await import('../../src/vendor/three.module.js');
    Save = await import('../../src/story/save.js');
  } catch (err) {
    r.ok('ch2: the modules load', false, String(err && err.message));
    return;
  }
  const menus = sim.menus;
  const S = () => sim.story.state;
  const K = Ch2.CHAPTER_2._state;
  const PL = Ch2.PLACE;
  const ac = () => sim.aircraft;
  const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const out = { results: {} };

  try {
    if (sim.applyDifficulty) sim.applyDifficulty('normal');
    sim.settings.heliAssist = true;
    sim.settings.reduceFlashing = true;
    try {
      localStorage.removeItem(KEY);
    } catch (e) {
      /* fine */
    }
    if (sim.state !== 'menu') sim.quitToMenu('main');
    // A player who has finished chapter 1, on Pilot: Continue is chapter 2.
    const data = Save.blank();
    Save.recordChapter(data, 'ch01-the-glint', { medal: 'silver', score: 80, time: 400 });
    data.chapter = 'ch02-fire-line';
    data.flags.knowsFlying = true;
    data.flags.firstSeen = Date.now() - 864e5;
    Save.save(data);
    Dir.reloadSave();

    /* ---- 1. continue → briefing → Firewatch ---------------------------- */
    say('ch2: continue into chapter 2');
    menus.show('story');
    const cont = menus.screens.story.querySelector('[data-story="continue"]');
    r.ok('ch2: after chapter 1 the hub offers Continue into chapter 2', !!cont && /Fire Line|Chapter 2/.test(cont.textContent), cont && cont.textContent.replace(/\s+/g, ' ').trim());
    menus.screens.story.querySelector('[data-story="chapters"]').click();
    const tiles = [...menus.screens['story-chapters'].querySelectorAll('[data-tile]')];
    const shippedN = Ch.availableChapters().length;
    // With the workbench open the dev chapters (2-4) are selectable whatever the pointer says; 5 onward stay coming soon.
    r.ok('ch2 (dev): chapter select — chapters 1-4 open, the rest locked', tiles.length === 13 && shippedN >= 4 && tiles.slice(0, 4).every((t) => !t.classList.contains('is-locked')) && tiles.slice(4).every((t) => t.classList.contains('is-locked')), `${shippedN} shipped, ${tiles.filter((t) => t.classList.contains('is-locked')).length} locked`);
    menus.show('story');
    menus.screens.story.querySelector('[data-story="continue"]').click();
    await waitFor(() => menus.current === 'story-briefing', 80);
    const brief = menus.screens['story-briefing'];
    const bullets = brief.querySelectorAll('[data-brief-bullets] li');
    r.ok('ch2: the briefing — Fire Line, three bullets, a route picture, GO', menus.current === 'story-briefing' && /Fire Line/.test(brief.textContent) && bullets.length === 3 && !!brief.querySelector('[data-go]'), brief.textContent.replace(/\s+/g, ' ').trim().slice(0, 140));
    brief.querySelector('[data-go]').click();
    const started = await waitFor(() => sim.state === 'flying' && sim.runner.def && sim.runner.def.id === 'story-ch02-lookout', 500, 50);
    for (let i = 0; i < 20; i++) sim.step(1 / 30);
    const fs0 = W.fireStatus(sim);
    const head0 = W.fireFront('head');
    r.ok('ch2: it opens at Firewatch Base, in the Skyhook with its bucket, on a clear morning',
      started && sim.settings.map === 'firewatch' && sim.aircraftType.id === 'harrier' && sim.weather.time === 'day' && sim.weather.condition === 'clear' && dist2D(ac().pos, PL.base) < 40 && fs0.kind === 'bucket',
      `${sim.state} ${sim.runner.def && sim.runner.def.id} ${sim.settings.map} ${sim.aircraftType && sim.aircraftType.id} at ${Math.round(dist2D(ac().pos, PL.base))} m from base; ${fs0.kind}`);
    r.ok('ch2: the fire is burning on the Long Scarp, a front running up the bench at the lookout', fs0.live && fs0.burning > 30 && !!head0 && head0.live >= 8 && head0.aheadOf(PL.pad) > 300, `${fs0.burning} burning; head ${head0 && Math.round(head0.aheadOf(PL.pad))} m from the pad`);
    r.ok('ch2: the lookout, the crew, the wreck and the survey marker are in the world', !!K.props && !!K.props.lookout && !!K.props.wreck && !!K.props.marker && K.crew.length === 2 && !!sim.scene.getObjectByName('story:sentinel-4') && !!sim.scene.getObjectByName('story:lookout'));
    const padY = K.props.lookout.pad.y;
    r.ok('ch2: the pad is a deck you can land on (the ground under it is its deck)', Math.abs(T.heightAt(PL.pad.x, PL.pad.z) - padY) < 0.01, `deck ${padY.toFixed(1)} m`);
    r.ok('ch2: one objective line from the first second, and the arrow on the lookout', /Long Scarp/.test(sim.hud.objectiveText.textContent) && !!sim.runner.activeTarget(), sim.hud.objectiveText.textContent);
    const panel = W.wildfireDebug().hud;
    r.ok('ch2: the fire panel waits for the line (the rescue HUD stays clean)', !!panel && !panel.visible);
    r.ok('ch2: it saved at the departure', S().saveLog.length >= 1 && S().data.beat === 'story-ch02-lookout' && !!S().data.pose, JSON.stringify(S().saveLog));

    /* ---- 2. the robot plays it to the end ---------------------------------- */
    say('ch2: the robot plays it');
    const P = makePilot(sim, { T, W, Ch2, budget: 1300 });
    const steps = [];
    const cards = new Set();
    const whos = new Set();
    let lastStep = null;
    const watch = () => {
      const st = sim.runner.step ? sim.runner.step.id : null;
      if (st !== lastStep) {
        steps.push(`${st}@${Math.round(P.clock)}`);
        lastStep = st;
      }
      for (const e of sim.story.cinema.log) {
        if (e.kind === 'card') cards.add(e.main);
        if (e.kind === 'line' && e.who) whos.add(e.who);
      }
    };
    P.stopIf = () => {
      watch();
      return S().phase === 'failed' || S().phase === 'debrief' || !S().active;
    };
    const stepId = () => (sim.runner.step ? sim.runner.step.id : null);
    let meterAtLand = null;
    let tfSeen = false;
    let peak = { burning: 0, at: null };
    const padTarget = () => ({ x: PL.pad.x, z: PL.pad.z });
    /**
     * Onto the lookout pad, the way the heli-missions pilot lands on a deck
     * (2026-11-08, the rotor wave's Skyhook): hands off so the assist stops
     * it; near enough up high (a hover 70 m up drifts in the wind); straight
     * down to 25 m over the deck; then down a little, back over the middle,
     * down a little; then Ctrl held for the last metres.
     */
    const landOnPad = async (R) => {
      R.allUp();
      for (let i = 0; i < 12 / R.DT && !R.over() && ac().groundSpeed > 3; i++) await R.tick();
      await R.flyTo(padTarget, 25, { clear: 20, maxLegs: 60 });
      await R.altTo(padY + 25, 3);
      for (let tries = 0; tries < 30 && !R.over() && stepId() === 'land' && !ac().onGround && R.surfaceH() > 7; tries++) {
        await R.flyTo(padTarget, 3, { maxLegs: 4 });
        await R.holdFor('Ctrl', 0.5);
        await R.tick(1.2);
      }
      await R.flyTo(padTarget, 3, { maxLegs: 4 });
      await R.landHere(padTarget);
    };
    /** Put the helicopter in a hover `agl` m over (x, z), the way the story's own resume does. */
    const placeAt = (x, z, agl, hdg) => {
      const g = Math.max(0, T.heightAt(x, z));
      Save.applyPose(sim, { game: 'flight', map: 'firewatch', aircraft: 'harrier', pos: [x, g + agl, z], quat: [0, 0, 0, 1], vel: [0, 0, 0], headingDeg: hdg, throttle: 0.6, gear: true, flaps: 0, fuel: 1, onGround: false });
    };
    for (let guard = 0; guard < 80 && !P.over(); guard++) {
      const sid = stepId();
      const phase = S().phase;
      if (phase === 'cutscene') {
        await P.tick(0.5);
        continue;
      }
      const fs = W.fireStatus(sim);
      if (fs.burning > peak.burning) peak = { burning: fs.burning, at: sid };
      if (sid === 'climb' || sid === 'approach') {
        await P.liftOff(30);
        // Up the Scarp first, then across the bench to the pad.
        await P.flyTo(padTarget, 30, { clear: 40, until: () => stepId() === 'land' });
      } else if (sid === 'land') {
        await landOnPad(P);
        if (ac().onGround && meterAtLand == null) {
          const h = W.fireFront('head');
          meterAtLand = h ? Ch2.headMeter(h.aheadOf(PL.pad)) : null;
        }
        await P.tick(4);
      } else if (sid === 'board') {
        await P.tick(1);
      } else if (sid === 'lift') {
        await P.liftOff(45);
        await P.flyTo(() => ({ x: PL.inlet.x, z: PL.inlet.z }), 60, { maxLegs: 20, until: () => stepId() !== 'lift' });
      } else if (/^fill-/.test(sid)) {
        // The tarn on the bench: fly to it, hover down until the bucket dips, wait for the fill.
        await P.fill();
        await P.tick(0.5);
      } else if (/^drop-/.test(sid)) {
        const n = Number(sid.slice(5));
        await P.drop(() => {
          const t = sim.runner.activeTarget();
          return t ? t.pos : null;
        });
        if (K.hits < n && W.fireWater().tank.fraction < 0.3) await P.tick(0.5); // a miss: the step's arrow goes back to the water
      } else if (sid === 'scar' || sid === 'photo') {
        // File 02 on the way: low over the survey marker, then the wreck, then SPACE.
        if (!K.fileFound) {
          await P.flyTo(() => K.props.marker.pos, 6, { clear: 40 });
          await P.heightTo(30, 3);
          await P.tick(2);
        }
        await P.flyTo(() => PL.wreck, 6, { clear: 40, maxLegs: 60 });
        await P.heightTo(40, 3);
        await P.tick(1);
        if (stepId() === 'photo') {
          P.pressSpace();
          await P.tick(6);
        }
      } else {
        await P.tick(1);
      }
    }
    // The finale cutscene and the debrief.
    for (let i = 0; i < 60 && S().phase === 'cutscene'; i++) {
      sim.step(0.5, 1 / 30);
      await Promise.resolve();
      await tick(0);
    }
    await waitFor(() => menus.current === 'story-debrief', 150, 40);
    P.allUp();
    watch();
    out.results.pass = { steps, clock: Math.round(P.clock), hits: K.hits, drops: K.drops, meterAtLand, meterAtLift: K.meterAtLift, file: K.fileFound, photo: K.photo, treetop: K.treetop, peak };
    const trail = steps.join(' → ');
    r.ok('ch2 robot: landed on the lookout pad ahead of the smoke', steps.some((s) => s.startsWith('board')) && meterAtLand != null && meterAtLand > 0, `meter at landing ${meterAtLand != null ? Math.round(meterAtLand * 100) : '—'}%; ${trail}`);
    r.ok('ch2 robot: the crew ran to the door and climbed in; lifted them out (crew aboard is saved)', K.boarded === 2 && K.crew.every((c) => c.state === 'gone') && S().saveLog.some((e) => e.id === 'board'), `${K.boarded} aboard`);
    const failInfo = sim.story.director.failInfo;
    const where = ac() ? `at ${Math.round(ac().pos.x)},${Math.round(ac().pos.z)} y ${Math.round(ac().pos.y)} (ground ${Math.round(T.heightAt(ac().pos.x, ac().pos.z))}) gs ${ac().groundSpeed.toFixed(1)}` : '';
    r.ok('ch2 robot: three buckets on the fire before it reached the road', K.hits >= 3 || steps.some((s) => s.startsWith('scar')), `${K.hits} hits of ${K.drops} drops; ${trail}${failInfo ? `; FAIL "${failInfo.reason}" ${where}` : ''}`);
    r.ok('ch2 robot: File 02, the survey marker in the scar', K.fileFound && S().data.flags.files.includes('f02'));
    r.ok('ch2 robot: SPACE took the photo of the SENTINEL unit', K.photo, trail);
    // The burn-scar scene is its caption and lines (no camera rail: flash safety); Thornefield and Priya speak.
    const sceneWhos = sim.story.cinema.log.filter((e) => e.kind === 'line').map((e) => e.who);
    r.ok('ch2 robot: the burn-scar scene played as its caption and lines — Thornefield and Priya spoke — and ended', sceneWhos.includes('thornefield') && sceneWhos.includes('priya') && S().phase === 'debrief', sceneWhos.join(','));
    r.ok('ch2 robot: the title card came up on the approach (FIRE LINE, thin bars)', cards.has('FIRE LINE'), [...cards].join('|'));
    // The cutscene's room lines (Thornefield, Priya) are read from the cinema log as it stands at the end; the radio cast is what the play must show.
    const cutLines = sim.story.cinema.log.filter((e) => e.kind === 'line' && (e.who === 'thornefield' || e.who === 'priya')).length;
    r.ok('ch2 robot: lines were spoken with portraits — Firewatch, the lookout crew, Mara (and the burn-scar scene\'s Thornefield and Priya when its log is kept)', ['firewatch', 'lookout', 'mara', 'lark'].every((w) => whos.has(w)), `${[...whos].join(',')}; scene lines logged ${cutLines}`);
    r.ok('ch2 robot: the debrief, a medal and a score, with Next chapter / Replay / Story menu', menus.current === 'story-debrief' && !!menus.screens['story-debrief'].querySelector('.sz-medal') && /\/100/.test(menus.screens['story-debrief'].textContent), menus.current);
    const rec = S().data.chapters['ch02-fire-line'];
    r.ok('ch2 robot: the save has chapter 2 done with its medal, and the pointer on chapter 3', !!(rec && rec.done && rec.medal) && S().data.chapter === 'ch03-range-control', JSON.stringify({ rec, ch: S().data.chapter }));
    const log = S().saveLog;
    const gaps = [];
    for (let i = 1; i < log.length; i++) gaps.push(+(log[i].t - log[i - 1].t).toFixed(1));
    out.results.pass.gaps = gaps;
    out.results.pass.saves = log.map((e) => e.id);
    r.ok('ch2 robot: no two autosaves more than 75 s of play apart (the one-minute guarantee)', gaps.length >= 8 && Math.max(...gaps) <= 75, `gaps ${gaps.join(',')} s; ${log.map((e) => e.id).join(',')}`);
    r.ok('ch2 robot: Reduce flashing stayed on', sim.settings.reduceFlashing === true);
    menus.screens['story-debrief'].querySelector('[data-dact="next"]').click();
    // Chapter 3 shipped: Next chapter is its briefing (Back stands it down); unshipped, TO BE CONTINUED.
    await waitFor(() => menus.current === 'story-tbc' || menus.current === 'story-briefing', 120);
    const ch3 = Ch.chapterById('ch03-range-control');
    const nextScr = menus.screens[menus.current];
    r.ok(ch3 && ch3.available ? 'ch2: Next chapter → chapter 3\'s briefing, Range Control' : 'ch2: Next chapter → TO BE CONTINUED, naming Range Control', (ch3 && ch3.available ? menus.current === 'story-briefing' : menus.current === 'story-tbc') && /Range Control/.test(nextScr.textContent), `${menus.current}: ${nextScr.textContent.replace(/\s+/g, ' ').trim().slice(0, 120)}`);
    if (menus.current === 'story-briefing') nextScr.querySelector('[data-back]').click();
    await waitFor(() => !S().active, 50);
    r.ok('ch2: nothing of the chapter left in the world afterwards', !sim.scene.getObjectByName('story:lookout') && !sim.scene.getObjectByName('story:sentinel-4') && !W.fireStatus(sim).live && !S().active);

    /* ---- 3. fail in the lookout beat, retry ------------------------------- */
    say('ch2: fail — the smoke closes the pad');
    await Dir.startChapter(Ch.chapterById('ch02-fire-line'), { fresh: true, replay: true, skipBriefing: true });
    await waitFor(() => sim.state === 'flying' && sim.runner.def && sim.runner.def.id === 'story-ch02-lookout', 300, 40);
    const cpA = Dir.D.checkpoint;
    let failed = false;
    for (let t = 0; t < 400 && !failed; t += 0.5) {
      sim.step(0.5, 1 / 30);
      await Promise.resolve();
      failed = S().phase === 'failed';
    }
    await waitFor(() => menus.current === 'story-fail', 60);
    const failScr = menus.screens['story-fail'];
    const smokeLine = (await import('../../src/story/script.js')).LINES['c2-fail-smoke'].text;
    r.ok('ch2 fail: sitting at the base, the smoke closes the pad — one kind line, Retry / Restart / Quit', failed && menus.current === 'story-fail' && failScr.textContent.includes(smokeLine.slice(0, 22)) && !!failScr.querySelector('[data-fact="retry"]'), failScr.textContent.replace(/\s+/g, ' ').trim().slice(0, 140));
    const savesA = S().saveLog.length;
    await tick(100);
    r.ok('ch2 fail: nothing saved while failing', S().saveLog.length === savesA);
    let t0 = performance.now();
    failScr.querySelector('[data-fact="retry"]').click();
    let back = await waitFor(() => sim.state === 'flying' && S().active && S().phase !== 'failed' && sim.runner.step, 150, 20);
    let took = (performance.now() - t0) / 1000;
    const headA = W.fireFront('head');
    r.ok('ch2 retry: back at the departure in ≤ 3 s, the same step, and the fire put back where it was then', back && took <= 3 && sim.runner.def.id === 'story-ch02-lookout' && sim.runner.stepIndex === cpA.step && dist2D(ac().pos, PL.base) < 40 && !!headA && headA.aheadOf(PL.pad) > 300,
      `${took.toFixed(2)} s; step ${sim.runner.stepIndex}; ${Math.round(dist2D(ac().pos, PL.base))} m from base; head ${headA && Math.round(headA.aheadOf(PL.pad))} m from the pad`);

    /* ---- 4. fail in the line beat, retry with the bucket and the fire put back */
    say('ch2: fail — the fire reaches the road');
    const P2 = makePilot(sim, { T, W, Ch2, budget: 900 });
    P2.stopIf = () => S().phase === 'failed' || !S().active || (stepId() && /^drop-1/.test(stepId()));
    for (let guard = 0; guard < 40 && !P2.over(); guard++) {
      const sid = stepId();
      if (sid === 'climb' || sid === 'approach') {
        await P2.liftOff(30);
        await P2.flyTo(padTarget, 30, { clear: 40, until: () => stepId() === 'land' });
      } else if (sid === 'land') {
        await landOnPad(P2);
        await P2.tick(4);
      } else if (sid === 'board') await P2.tick(1);
      else if (sid === 'lift') {
        await P2.liftOff(45);
        await P2.flyTo(() => ({ x: PL.inlet.x, z: PL.inlet.z }), 60, { maxLegs: 20, until: () => stepId() !== 'lift' });
      } else if (sid === 'fill-1') await P2.fill();
      else await P2.tick(1);
    }
    P2.allUp();
    const cpB = Dir.D.checkpoint;
    const litresB = W.fireWater().tank ? W.fireWater().tank.litres : 0;
    const backB = W.fireFront('back');
    const backSaved = cpB && cpB.beatState && cpB.beatState.back;
    r.ok('ch2 line: reached "Bucket full" in the line beat, the checkpoint holding the fire and the water', stepId() === 'drop-1' && cpB && /Bucket full/.test(cpB.label) && !!backSaved && cpB.beatState.litres > 250, JSON.stringify({ step: stepId(), cp: cpB && cpB.label, litres: cpB && cpB.beatState && cpB.beatState.litres }));
    // Hover there, full, and let the back of the fire run to the road.
    failed = false;
    const roadLine = (await import('../../src/story/script.js')).LINES['c2-fail-road'].text;
    for (let t = 0; t < 900 && !failed; t += 0.5) {
      sim.step(0.5, 1 / 30);
      await Promise.resolve();
      failed = S().phase === 'failed';
    }
    await waitFor(() => menus.current === 'story-fail', 60);
    r.ok('ch2 fail: left alone, the fire reaches the road — "the trucks pulled back, all safe"', failed && menus.screens['story-fail'].textContent.includes(roadLine.slice(0, 20)), menus.screens['story-fail'].textContent.replace(/\s+/g, ' ').trim().slice(0, 140));
    t0 = performance.now();
    menus.screens['story-fail'].querySelector('[data-fact="retry"]').click();
    back = await waitFor(() => sim.state === 'flying' && S().active && S().phase !== 'failed' && sim.runner.step, 150, 20);
    took = (performance.now() - t0) / 1000;
    const backR = W.fireFront('back');
    // Within a few metres: the restored front gets one frame of running before this reads it.
    const sameFront = !!(backR && backSaved && backR.cols.every((c, k) => Math.abs(c.d - backSaved.d[k]) < 4));
    const tankR = W.fireWater().tank;
    r.ok('ch2 retry: back at "Bucket full" in ≤ 3 s — the same step, the pose, the bucket still full, the fire where it was',
      back && took <= 3 && sim.runner.def.id === 'story-ch02-line' && stepId() === 'drop-1' && ac().pos.distanceTo(new THREE.Vector3(...cpB.pose.pos)) < 30 && tankR && Math.abs(tankR.litres - litresB) < 40 && sameFront && W.wildfireDebug().hudOn === true,
      `${took.toFixed(2)} s; ${stepId()}; ${Math.round(ac().pos.distanceTo(new THREE.Vector3(...cpB.pose.pos)))} m off; ${tankR && Math.round(tankR.litres)} L (was ${Math.round(litresB)}); fronts restored ${sameFront}`);
    r.ok('ch2 retry: the crew are still aboard (their weight too)', K.boarded === 2 && (ac().extraMass || 0) >= 180, `${K.boarded} aboard, ${Math.round(ac().extraMass || 0)} kg`);

    /* ---- 5. leave and continue from the line ------------------------------- */
    say('ch2: leave and continue');
    // A non-replay run so the pointer is saved: put the save on this checkpoint.
    Dir.D.replay = false;
    Dir.saveCheckpoint('drop-1-test', 'Bucket full');
    const savedPose = S().data.pose;
    sim.step(4, 1 / 30);
    sim.quitToMenu('main');
    menus.show('story');
    const cont2 = menus.screens.story.querySelector('[data-story="continue"]');
    r.ok('ch2 continue: the hub offers Continue at "Bucket full"', !!cont2 && /Bucket full/.test(cont2.textContent), cont2 && cont2.textContent.replace(/\s+/g, ' ').trim());
    cont2.click();
    await waitFor(() => sim.state === 'flying' && S().active, 400, 40);
    const cin = sim.story.cinema;
    r.ok('ch2 continue: "Previously on SIGNAL ZERO…", then the same beat and step within metres of the saved pose', cin.cardKind === 'recap' && sim.runner.def.id === 'story-ch02-line' && stepId() === 'drop-1' && ac().pos.distanceTo(new THREE.Vector3(...savedPose.pos)) < 30 && W.fireStatus(sim).live,
      `${cin.cardKind} ${sim.runner.def && sim.runner.def.id} ${stepId()} ${Math.round(ac().pos.distanceTo(new THREE.Vector3(...savedPose.pos)))} m`);
    sim.tap('KeyC');
    sim.step(0.5, 1 / 30);
    sim.tap('KeyC');
    sim.step(2.5, 1 / 30);

    /* ---- 6. the flicker probe and the frame time ---------------------------- */
    say('ch2: flicker probe');
    sim.quitToMenu('main');
    // A fresh start, a minute and a bit in: the head mid-bench, the fire at its biggest.
    await Dir.startChapter(Ch.chapterById('ch02-fire-line'), { fresh: true, replay: true, skipBriefing: true });
    await waitFor(() => sim.state === 'flying' && sim.runner.def && sim.runner.def.id === 'story-ch02-lookout', 300, 40);
    for (let t = 0; t < 70; t += 0.5) {
      sim.step(0.5, 1 / 30);
      await Promise.resolve();
    }
    const gy = Math.max(0, T.heightAt(640, -1880));
    // Hovering off the south edge of the bench, nose to the fire.
    Save.applyPose(sim, { pos: [640, gy + 90, -1760], quat: [0, 0, 0, 1], vel: [0, 0, 0], headingDeg: 0, throttle: 0.5, gear: true, flaps: 0, fuel: 1, onGround: false });
    const C = await import('../../src/story/cinema.js');
    C.holdStill(true);
    sim.renderer.render = realRender;
    try {
      const Probe = await import('../flicker-probe.js');
      const FB = await import('./flicker.browser.js');
      sim.rig.initialised = false;
      const burningNow = W.fireStatus(sim).burning;
      const m1 = await Probe.measure(sim, { frames: 60, fps: 30, warm: 0, raycast: false });
      out.results.flickerFire = { ...m1, burning: burningNow };
      r.ok(`ch2 flicker: the fire running up the bench, flames and smoke, flickers over under ${(FB.FLICKER_MAX * 100).toFixed(1)}% of the screen (Reduce flashing on)`, m1.meanLum.max > 0.01 && m1.percArea <= FB.FLICKER_MAX && m1.wcagWindow <= FB.WCAG_WINDOW_MAX, `perc ${(m1.percArea * 100).toFixed(2)}%, WCAG window ${(m1.wcagWindow * 100).toFixed(2)}%; ${burningNow} cells burning`);
      r.ok('ch2 frame time: the fire at its peak costs under 40 ms a frame here (headless, software GL, render and all)', m1.stepMs < 40, `${m1.stepMs} ms a frame with ${burningNow} cells burning`);
      // The lookout title card, as it comes up on the approach.
      C.titleCard({ over: 'Chapter 2', main: 'FIRE LINE', sub: 'FIREWATCH RIDGE · 10:20', dur: 4, bars: 'thin' });
      const m2 = await Probe.measure(sim, { frames: 45, fps: 30, warm: 0, raycast: false });
      r.ok('ch2 flicker: the title card over the fire leaves the picture under the line', m2.percArea <= FB.FLICKER_MAX && m2.wcagWindow <= FB.WCAG_WINDOW_MAX, `perc ${(m2.percArea * 100).toFixed(2)}%`);
      C.holdStill(false);
      // The burn-scar scene as it plays now: the caption and lines over the hover view, the fire's moving layers hidden.
      const scene = Ch2.CHAPTER_2.finale(Dir.D.api);
      const m3 = await Probe.measure(sim, { frames: 120, fps: 30, warm: 0, raycast: false });
      out.results.flickerScene = m3;
      r.ok('ch2 flicker: the burn-scar scene flickers under the line (Reduce flashing on)', m3.meanLum.max > 0.01 && m3.percArea <= FB.FLICKER_MAX && m3.wcagWindow <= FB.WCAG_WINDOW_MAX, `perc ${(m3.percArea * 100).toFixed(2)}%, WCAG window ${(m3.wcagWindow * 100).toFixed(2)}%; ${m3.stepMs} ms a frame`);
      Ch2.skipScene();
      for (let i = 0; i < 20 && K.scene; i++) sim.step(0.5, 1 / 30);
      await scene;
    } catch (e) {
      r.ok('ch2 flicker: the probe ran', false, String((e && e.stack) || e).slice(0, 300));
    } finally {
      sim.renderer.render = () => {};
    }
    sim.quitToMenu('main');
    r.ok('ch2: quitting leaves nothing of the chapter behind', !S().active && !sim.scene.getObjectByName('story:lookout') && !sim.scene.getObjectByName('ambient-heli:thornefield') && !W.fireStatus(sim).live);
  } catch (err) {
    r.ok('ch2: the check ran to the end', false, String((err && err.stack) || err).slice(0, 500));
  } finally {
    try {
      if (sim.state !== 'menu') sim.quitToMenu('main');
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
    if (sim.prog) sim.prog.devUnlocked = origDev;
    sim.autoPauseOnHide = origAuto;
    sim.settings.reduceFlashing = origReduce;
    sim.settings.heliAssist = origAssist;
    if (sim.applyDifficulty && origDiff) sim.applyDifficulty(origDiff);
  }
  return out;
}
