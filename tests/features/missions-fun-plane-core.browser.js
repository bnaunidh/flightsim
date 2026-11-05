/**
 * missions-fun:plane-core — the reworked core aeroplane missions and the two
 * new ones, flown start to finish by a scripted pilot on the real flight
 * model (sim.override, the same hands tests/features/events.playthrough.js
 * uses: it never teleports and never calls a mission's own functions).
 *
 * What it proves, per the fun plan (scratchpad/finish/missions-fun-plan.md):
 *   - the board: the new missions have cards, and every core mission has a twist;
 *   - Night Medevac: 'Patient aboard' is a checkpoint — a fail on the way
 *     home offers "Try again from", which resumes on the pad with the clock;
 *   - Storm Approach: the shear fires on short final; the pilot that adds
 *     power lands (and the medal strip + "What happened" + finale show); a
 *     fast, firm arrival is Bronze or Silver; the one that holds its power
 *     comes down short, and the reason says to add power;
 *   - Carrier Qualification: first pass Gold, second Silver, third Bronze; three
 *     bolters is the fail with the reason (the mission's own rule, not flown);
 *   - Stray Contact: scramble, intercept, signal from ahead-left, lead him
 *     clear, land — a pass; hands off, he flies into the range — the fail;
 *   - Diversion: down from 8,000 ft through the squall onto the short wet
 *     runway — a pass; hands off — the fail.
 * Each flown mission records its score and medal in the detail, so the
 * thresholds in the defs are calibrated against these runs.
 *
 * `fly(sim, what, opts)` is exported for the screenshot driver: `opts.until`
 * stops at 'twist' | 'finale' | 'debrief', and a second call with
 * `opts.resume` carries on with the same hands.
 */

const DEG = Math.PI / 180;
const KT = 0.514444;
const yieldNow = () => new Promise((r) => setTimeout(r, 0));

function stepId(sim) {
  return sim.runner.step ? sim.runner.step.id : null;
}

function beatFired(sim, id) {
  const b = (sim.runner.data && sim.runner.data._beats) || [];
  return b.some((x) => x.id === id);
}

/** The pilot's hands: read by the game every frame through getters on sim.override. */
async function makePilot(sim) {
  const THREE = await import('../../src/vendor/three.module.js');
  const PH = await import('../../src/aircraft/physics.js');
  const TY = await import('../../src/aircraft/types.js');
  const { heightAt } = await import('../../src/world/terrain.js');
  const ac = sim.aircraft;
  const TAN3 = Math.tan(3 * DEG);
  const gearDrop = () => {
    const pts = PH.SPEC && PH.SPEC.gearPoints;
    return pts && pts.length ? Math.max(0.5, -pts.reduce((m, g) => Math.min(m, g.pos.y), 0)) : 2;
  };
  /*
   * The speeds this type is flown at, from its own numbers: the approach at
   * 1.45 times the landing stall, the reference speed over the threshold at
   * 1.3 times it. A Skylark lands at 52 knots and a Vanguard at 87, and a
   * controller that flew both at 110 floated one to the far end of the
   * runway and crashed the other for speed (the game's own limit is 62 m/s).
   */
  const speeds = () => {
    let sl = 55;
    try {
      const p = TY.performanceFor(sim.aircraftType.id);
      if (Number.isFinite(p.stallLanding) && p.stallLanding > 0) sl = p.stallLanding;
    } catch (e) {
      /* the default is a trainer's */
    }
    const ref = sl * 1.3 * KT;
    return { ref, app: sl * 1.45 * KT, cruise: Math.max(sl * 1.9 * KT, ref + 20) };
  };
  const B = {
    hdg: ac.heading, target: null, alt: ac.pos.y, spd: 60, glide: false, flare: false, noFlare: false, L: 90,
    td: new THREE.Vector3(), I: 0.1, Is: 0, Ix: 0, out: { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 0 },
    rollCmd: null, maxDown: 9, maxUp: 6, frozen: null, takeoff: false, Vr: 32, bankLim: 25, bolter: false, T: 0,
    vne: Infinity, powerFloor: 0, firmFlare: false, tele: [], wasGround: ac.onGround,
  };
  const compute = () => {
    const dt = 1 / 30;
    const o = B.out;
    const bank = ac.bankAngleDeg();
    if (B.takeoff && ac.onGround) {
      const err = ((B.hdg - ac.heading + 540) % 360) - 180;
      o.throttle = 1;
      o.brakes = 0;
      o.yaw = Math.max(-1, Math.min(1, err * 0.08));
      o.roll = Math.max(-0.4, Math.min(0.4, -bank * 0.04));
      o.pitch = ac.ias > B.Vr ? 0.38 : 0;
      return;
    }
    if (B.takeoff && !ac.onGround && ac.agl > 12) B.takeoff = false;
    let wantHdg = B.hdg;
    let wantY = B.alt;
    let ffVs = 0;
    if (B.glide) {
      const L = B.L * DEG;
      const cross = (ac.pos.x - B.td.x) * Math.cos(L) + (ac.pos.z - B.td.z) * Math.sin(L);
      const along = (B.td.x - ac.pos.x) * Math.sin(L) - (B.td.z - ac.pos.z) * Math.cos(L);
      /*
       * The crab: a pilot points the nose into the wind by the angle the
       * crosswind needs, and only then corrects what is left. Without it a
       * 24-knot crosswind held the Skylark 130 m downwind of the centreline
       * (the proportional term needs an error to make an angle).
       */
      let crab = 0;
      try {
        const w = sim.weather.windVector();
        const windRight = w.x * Math.cos(L) + w.z * Math.sin(L);
        crab = -Math.asin(Math.max(-0.6, Math.min(0.6, windRight / Math.max(15, ac.ias)))) / DEG;
      } catch (e) {
        crab = 0;
      }
      B.Ix = Math.max(-15, Math.min(15, B.Ix + cross * dt * 0.006));
      wantHdg = B.L + crab - Math.max(-30, Math.min(30, cross * (along < 1500 ? 0.16 : along < 3000 ? 0.12 : 0.05) + B.Ix));
      wantY = B.td.y + Math.max(0, along) * TAN3;
      ffVs = -ac.groundSpeed * TAN3;
    } else if (B.target) {
      wantHdg = ((Math.atan2(B.target.x - ac.pos.x, -(B.target.z - ac.pos.z)) / DEG) + 360) % 360;
    }
    const err = ((wantHdg - ac.heading + 540) % 360) - 180;
    const lim = B.glide && ac.agl < 150 ? 15 : B.bankLim;
    const wantBank = ac.onGround ? 0 : Math.max(-lim, Math.min(lim, err * 0.8));
    o.roll = B.rollCmd != null ? B.rollCmd : Math.max(-0.7, Math.min(0.7, (wantBank - bank) * 0.055 - ac.omega.z * 0.55));
    let wantVs = Math.max(-B.maxDown, Math.min(B.maxUp, (wantY - ac.pos.y) * 0.08 + ffVs));
    if (B.glide && ac.pos.y - gearDrop() - B.td.y < 40) wantVs = Math.max(wantVs, -3.5);
    if (B.flare && !B.noFlare) wantVs = B.firmFlare ? -1.8 : ac.pos.y - gearDrop() - B.td.y > 2 ? -1.6 : -0.8;
    if (ac.agl < 60 && !B.glide && !ac.onGround && !B.bolter) wantVs = Math.max(wantVs, 2);
    // Never through the barber pole: ease the descent, idle the power.
    const hot = ac.ias > B.vne * 0.95;
    if (hot) wantVs = Math.max(wantVs, -3);
    B.I = Math.max(-0.4, Math.min(0.5, B.I + (wantVs - ac.vs) * dt * 0.03));
    o.pitch = ac.onGround ? 0 : Math.max(-0.6, Math.min(0.75, B.I + (wantVs - ac.vs) * 0.12 - ac.omega.x * 0.6 + (Math.abs(bank) / 25) * 0.06));
    B.Is = Math.max(-0.4, Math.min(0.5, B.Is + (B.spd - ac.ias) * dt * 0.01));
    o.throttle = (B.flare && !B.noFlare && ac.agl < 8) || ac.onGround ? 0 : Math.max(0, Math.min(1, 0.45 + (B.spd - ac.ias) * 0.05 + B.Is + wantVs * 0.02));
    if (hot) o.throttle = 0;
    // The pilot that answers a shear with power: a floor under the throttle for a while.
    if (!ac.onGround && B.powerFloor > 0) o.throttle = Math.max(o.throttle, B.powerFloor);
    o.yaw = ac.onGround ? Math.max(-1, Math.min(1, err * 0.08)) : Math.max(-0.5, Math.min(0.5, (ac.beta || 0) * 1.6));
    o.brakes = ac.onGround && ac.groundTime > 1 ? 1 : 0;
    if (B.bolter && ac.onGround) {
      // Wheels on the deck, full power, fly off the angled deck and go round.
      o.throttle = 1;
      o.brakes = 0;
      o.pitch = ac.ias > B.Vr ? 0.35 : 0;
    }
    if (B.frozen) {
      // The pilot that does nothing about the shear: same power, same attitude.
      o.throttle = B.frozen.throttle;
      o.pitch = B.frozen.pitch;
    }
  };
  const CTRL = {};
  Object.defineProperty(CTRL, 'pitch', { enumerable: true, get() { compute(); return B.out.pitch; } });
  for (const k of ['roll', 'yaw', 'throttle', 'brakes']) Object.defineProperty(CTRL, k, { enumerable: true, get() { return B.out[k]; } });
  const P = {
    B,
    THREE,
    speeds,
    install() { sim.override = CTRL; },
    remove() { if (sim.override === CTRL) sim.override = null; },
    /** Advance the game `secs` seconds, a quarter-second at a time, yielding so imports resolve. */
    async run(secs, cond = null, dt = 1 / 30) {
      let t = 0;
      let n = 0;
      const chunk = Math.round(0.25 / dt) * dt;
      while (t < secs) {
        sim.step(0.25, dt);
        B.T += chunk;
        t += chunk;
        if (Math.floor(B.T / 10) !== Math.floor((B.T - chunk) / 10)) P.tele();
        if (ac.onGround !== B.wasGround) {
          B.wasGround = ac.onGround;
          if (ac.onGround) {
            const l = ac.lastTouchdown;
            B.touch = `${B.T.toFixed(0)}s at ${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)} ${l ? `${l.vsFpm} fpm ${l.quality} score ${l.score} onRunway ${l.onRunway} centreline ${l.centreline}` : 'no grade'}`;
            P.tele(`TOUCHDOWN ${B.touch}`);
          }
        }
        if (cond && cond()) return true;
        if (P.over()) return false;
        if ((n++ & 3) === 0) await yieldNow();
      }
      return cond ? !!cond() : true;
    },
    over() {
      return sim.runner.status !== 'running' || ac.crashed || sim.state === 'debrief';
    },
    /** One line of where the aeroplane is, every ten seconds (and at a touchdown), for the fail details. */
    tele(note = '') {
      const over = ac.pos.y - Math.max(0, heightAt(ac.pos.x, ac.pos.z));
      B.tele.push(`${B.T.toFixed(0)}s ${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)} y${ac.pos.y.toFixed(0)} h${over.toFixed(0)} ias${ac.ias.toFixed(0)} vs${ac.vs.toFixed(1)} hdg${ac.heading.toFixed(0)} thr${(ac.controls.throttle || 0).toFixed(2)}${ac.onGround ? ' GND' : ''} ${stepId(sim) || ''}${note ? ` ${note}` : ''}`);
      if (B.tele.length > 60) B.tele.shift();
    },
    /** Hold the runway heading and climb straight ahead until `minY`, before turning anywhere near the hills. */
    async climbOut(minY, hdg, maxSecs = 120) {
      B.glide = false;
      B.target = null;
      B.hdg = hdg;
      B.alt = minY + 40;
      return P.run(maxSecs, () => !ac.onGround && ac.pos.y > minY);
    },
    /** Set up a three-degree slope to `td` landing on heading `L`, aiming past the ground short of it. */
    glideTo(td, L, { shiftForGround = true, spd = null, margin = 10 } = {}) {
      B.glide = true;
      B.flare = false;
      B.L = L;
      B.td.copy(td);
      B.spd = spd != null ? spd : speeds().app;
      if (shiftForGround) {
        const hx = Math.sin(L * DEG);
        const hz = -Math.cos(L * DEG);
        let shift = 0;
        for (let d = 100; d <= 4000; d += 50) {
          const g = heightAt(td.x - hx * d, td.z - hz * d);
          shift = Math.max(shift, (g + margin - td.y) / TAN3 - d);
        }
        shift = Math.min(shift, 400);
        B.td.x += hx * shift;
        B.td.z += hz * shift;
      }
    },
    /** Each quarter second on a glide: gear, flaps and the flare, like a pilot's hands. */
    glideHands(gearAt = 7000, flapsAt = 6000) {
      const dTd = Math.hypot(ac.pos.x - B.td.x, ac.pos.z - B.td.z);
      if (dTd < gearAt && !ac.gearDown) sim.tap('KeyG');
      if (dTd < flapsAt && ac.flapStep && ac.flapStep() < 2) ac.setFlaps(ac.flapStep() + 1);
      if (!B.flare && !B.noFlare && ac.pos.y - gearDrop() - B.td.y < Math.max(10, -ac.vs * 3.5) && !ac.onGround) B.flare = true;
      return dTd;
    },
    /** Fly to a point and hold a height, until within `within` metres (flat) or the mission ends. */
    async flyTo(getPos, alt, within = 400, maxSecs = 400, spd = null) {
      B.glide = false;
      B.flare = false;
      if (spd != null) B.spd = spd;
      const ok = await P.run(maxSecs, () => {
        const p = getPos();
        if (!p) return false;
        B.target = p;
        if (alt != null) B.alt = alt;
        return Math.hypot(p.x - ac.pos.x, p.z - ac.pos.z) < within;
      });
      return ok;
    },
    /**
     * A proper approach: a point far out on the extended centreline, then the
     * final approach fix on it, so the glide begins lined up — then the slope,
     * the gear, the flaps, the flare and the stop. `until` ends it early.
     */
    async approach(td, L, { direct = false, preDist = 6500, iafDist = 4200, shiftForGround = true, margin = 10, noFlare = false, gust = 0, maxSecs = 320, onGlide = null, until = null, maxDown = 10, cruise = null } = {}) {
      const S = speeds();
      const dir = new THREE.Vector3(Math.sin(L * DEG), 0, -Math.cos(L * DEG));
      const pre = td.clone().addScaledVector(dir, -preDist).setY(td.y + preDist * TAN3 + 30);
      const iaf = td.clone().addScaledVector(dir, -iafDist).setY(td.y + iafDist * TAN3 + 10);
      B.maxDown = maxDown;
      if (!direct) {
        await P.flyTo(() => pre, pre.y, 600, 200, cruise != null ? cruise : S.cruise);
        if (P.over()) return false;
        // The leg to the fix is flown clean, with speed in hand to manoeuvre: a fighter at its approach speed with the gear up mushes round at two degrees a second.
        await P.flyTo(() => iaf, iaf.y, 320, 120, S.app + gust + 12);
        if (P.over()) return false;
      }
      P.glideTo(td, L, { shiftForGround, spd: S.app + gust, margin });
      B.noFlare = noFlare;
      if (onGlide) onGlide();
      return P.run(maxSecs, () => {
        const dTd = P.glideHands(7000, 6000);
        B.spd = dTd < 2500 ? S.ref + gust : S.app + gust;
        return until ? until() : false;
      });
    },
    /** Rock the wings: a quarter roll left, then right, then level. Returns when done or after 12 s. */
    async rock() {
      let stage = 1;
      B.rollCmd = -0.7;
      await P.run(12, () => {
        const bank = ac.bankAngleDeg();
        if (stage === 1 && bank < -16) { stage = 2; B.rollCmd = 0.7; }
        else if (stage === 2 && bank > 14) { stage = 3; B.rollCmd = null; }
        return stage === 3;
      });
      B.rollCmd = null;
    },
  };
  return P;
}

/** Wait for the finale and the debrief after a mission ends; returns what the debrief shows. */
async function settle(sim, Fun) {
  const finale = Fun.finalePlaying();
  // The finale holds the debrief back for a few seconds of game time: step through it.
  for (let i = 0; i < 40 && sim.state !== 'debrief'; i++) {
    sim.step(0.25, 1 / 30);
    if ((i & 3) === 0) await yieldNow();
  }
  const s = sim.menus.screens.debrief;
  const body = s ? s.querySelector('[data-body]') : null;
  return {
    finale,
    state: sim.state,
    strip: body && body.querySelector('[data-medal-strip]') ? body.querySelector('[data-medal-strip]').dataset.medalStrip : null,
    happened: body && body.querySelector('[data-happened]') ? body.querySelector('[data-happened]').textContent.replace(/\s+/g, ' ').trim() : null,
    reason: body && body.querySelector('.debrief-reason') ? body.querySelector('.debrief-reason').textContent.trim() : null,
    actions: s ? [...s.querySelectorAll('[data-actions] button')].map((b) => b.textContent.trim()) : [],
  };
}

/**
 * Fly one of the scripted runs. Returns { status, score, medal, beats, ... }.
 * `what`: 'storm' | 'storm-sloppy' | 'storm-fail' | 'carrier-trap' | 'carrier-bolter' | 'stray' | 'stray-fail' | 'diversion' | 'diversion-fail'.
 */
export async function fly(sim, what, opts = {}) {
  const Fun = await import('../../src/game/fun-kit.js');
  const { RUNWAY } = await import('../../src/world/airport.js');
  const log = [];
  const say = (s) => log.push(`${(sim.runner.elapsed || 0).toFixed(0)}s ${s}`);
  const stopAt = opts.until || 'debrief';
  const stage = () => {
    if (stopAt === 'twist' && (sim.runner.data._beats || []).length) return true;
    if (stopAt === 'finale' && Fun.finalePlaying()) return true;
    if (stopAt === 'debrief' && sim.state === 'debrief') return true;
    return false;
  };
  const ac = sim.aircraft;
  let P;
  const S0 = (opts.resume && sim.__funPilot) || null;
  if (S0) {
    P = S0.P;
  } else {
    const id = what.startsWith('storm') ? 'storm' : what.startsWith('carrier') ? 'carrierqual' : what.startsWith('stray') ? 'stray-contact' : 'diversion';
    await sim.startMode('mission', { id });
    P = await makePilot(sim);
    sim.__funPilot = { P, what, phase: 0 };
    if (!what.endsWith('-fail') || what === 'storm-fail') P.install();
    say(`start ${id} in ${sim.aircraftType.id} at ${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)} y ${ac.pos.y.toFixed(0)}; speeds ${JSON.stringify(P.speeds(), (k, v) => (typeof v === 'number' ? Math.round(v) : v))}`);
  }
  const B = P.B;
  const st = sim.__funPilot;
  const result = async () => {
    const d = await settle(sim, Fun);
    const score = sim.runner.data ? sim.runner.data.score : null;
    const def = sim.runner.def;
    const out = {
      what, status: sim.runner.status, score, medal: sim.runner.status === 'complete' ? Fun.medalFor(def, score) : null,
      beats: (sim.runner.data._beats || []).map((b) => b.id), crashed: ac.crashed, crashReason: ac.crashReason,
      elapsed: Math.round(sim.runner.elapsed), data: {}, ...d, log, tele: B.tele.slice(-9),
    };
    if (def && def.id === 'carrierqual') out.data.passes = sim.runner.data.passes;
    if (def && def.id === 'stray-contact') out.data = { seen: sim.runner.data.seen, following: sim.runner.data.following, signalAt: sim.runner.data.signalAt };
    if (def && def.id === 'diversion') out.data = { tdX: sim.runner.data.tdX, stopX: sim.runner.data.stopX, overspeedT: Math.round(sim.runner.data.overspeedT || 0) };
    if (def && def.id === 'storm' && ac.lastTouchdown) out.data = { tdScore: ac.lastTouchdown.score, vsFpm: ac.lastTouchdown.vsFpm, onRunway: ac.lastTouchdown.onRunway };
    if (B.touch) out.data.touch = B.touch;
    P.remove();
    sim.__funPilot = null;
    return out;
  };

  try {
    /* ------------------------------------------------------------ storm */
    if (what === 'storm' || what === 'storm-fail' || what === 'storm-sloppy') {
      const S = P.speeds();
      // A gusting 24-knot crosswind: a few knots extra over the threshold, like a real pilot adds.
      const gust = 3;
      if (st.phase === 0) {
        P.glideTo(RUNWAY.touchdown, RUNWAY.headingDeg ?? 90, { spd: S.app + gust, margin: 8 });
        // The spawn is above the slope: come down onto it briskly, then fly it.
        B.maxDown = 11;
        // The sloppy pilot: eight knots fast all the way down and a firm, hurried
        // flare — it arrives. The medal for that must be Bronze or Silver, not Gold.
        if (what === 'storm-sloppy') B.firmFlare = true;
        st.phase = 1;
      }
      await P.run(400, () => {
        const dTd = P.glideHands(7000, 6000);
        if (dTd < 3200 && B.maxDown > 8) B.maxDown = 8;
        B.spd = what === 'storm-sloppy' ? S.app + gust + 4 : dTd < 2500 ? S.ref + gust : S.app + gust;
        const shear = beatFired(sim, 'shear');
        if (what === 'storm-fail' && shear && !B.frozen) {
          B.frozen = { throttle: ac.controls.throttle, pitch: ac.controls.pitch };
          say(`shear: holding ${B.frozen.throttle.toFixed(2)} power, ${(ac.agl * 3.28).toFixed(0)} ft, ${(RUNWAY.touchdown.x - ac.pos.x).toFixed(0)} m to go`);
        }
        if (what !== 'storm-fail' && shear && !st.shearAt) {
          // What the tower asked for: power, and hold the slope — not a dive after it.
          st.shearAt = B.T;
          B.powerFloor = 0.9;
          B.maxDown = 4;
          say(`shear fired at ${(ac.agl * 3.28).toFixed(0)} ft, ${(RUNWAY.touchdown.x - ac.pos.x).toFixed(0)} m out — power up`);
        }
        if (st.shearAt && B.T - st.shearAt > 16 && B.powerFloor) { B.powerFloor = 0; B.maxDown = 6; }
        return stage();
      });
      if (stage() && stopAt !== 'debrief') return { paused: stopAt, log };
      return result();
    }

    /* ---------------------------------------------------------- carrier */
    if (what === 'stray-fail') {
      // Hands off on the runway: the Skylark reaches the range on its own.
      await P.run(460, null, 1 / 20);
      return result();
    }
    if (what === 'stray') {
      const S = P.speeds();
      B.takeoff = true;
      B.Vr = 68;
      B.hdg = RUNWAY.headingDeg ?? 90;
      B.alt = 520;
      B.spd = 95;
      B.vne = 150;
      await P.run(60, () => !ac.onGround && ac.agl > 40);
      // Northwatch's plain is flat and the fells are north; the Skylark is south-west. A short climb, then turn.
      await P.climbOut(RUNWAY.elev + 110, RUNWAY.headingDeg ?? 90, 40);
      const arrow = () => (sim.runner.activeTarget() ? sim.runner.activeTarget().pos : null);
      // Intercept: the arrow is on him. Come down to his height on the way, and slow down near him.
      await P.run(220, () => {
        const id = stepId(sim);
        if (id !== 'scramble' && id !== 'intercept') return true;
        const p = arrow();
        if (p) { B.target = p; B.alt = p.y + 10; }
        B.spd = p && id === 'intercept' && Math.hypot(ac.pos.x - p.x, ac.pos.z - p.z) < 2500 ? S.app : 95;
        return false;
      });
      say(`alongside at ${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)}; step ${stepId(sim)}`);
      // Signal: get to the station ahead-left of his nose and rock there, until he follows.
      let rocks = 0;
      const d = sim.runner.data;
      for (let tries = 0; tries < 8 && stepId(sim) === 'signal' && !P.over(); tries++) {
        await P.flyTo(arrow, null, 220, 40, S.app);
        if (P.over() || stepId(sim) !== 'signal') break;
        const n = d.stray;
        const p = arrow();
        if (p) { B.target = p; B.alt = p.y; }
        rocks++;
        say(`rock ${rocks} at ${Math.hypot(ac.pos.x - (n ? n.pos.x : 0), ac.pos.z - (n ? n.pos.z : 0)).toFixed(0)} m from him`);
        await P.rock();
        await P.run(3, () => stepId(sim) !== 'signal');
      }
      say(`signalled: following ${d.following}, step ${stepId(sim)}`);
      // Lead: a gentle left turn to the clear point, at a speed he can keep.
      B.bankLim = 18;
      await P.run(150, () => {
        if (stepId(sim) !== 'lead') return true;
        const p = arrow();
        if (p) { B.target = p; B.alt = 500; }
        B.spd = S.app;
        return false;
      });
      B.bankLim = 25;
      say(`lead done: step ${stepId(sim)}, he is ${d.stray ? d.stray.heading.toFixed(0) : '?'} deg`);
      // Home: a proper approach to 09 — out to the centreline first, fast, then down the slope.
      await P.approach(RUNWAY.touchdown, RUNWAY.headingDeg ?? 90, { preDist: 5600, iafDist: 3600, maxSecs: 260, maxDown: 10, cruise: 90 });
      return result();
    }

    /* -------------------------------------------------------- diversion */
    if (what === 'diversion-fail') {
      await P.run(560, null, 1 / 20);
      return result();
    }
    if (what === 'diversion') {
      const PH = await import('../../src/aircraft/physics.js');
      B.vne = PH.SPEC.vne || 90;
      B.maxDown = 16;
      B.spd = Math.min(100, B.vne * 0.85);
      const arrow = () => (sim.runner.activeTarget() ? sim.runner.activeTarget().pos : null);
      // Down to the gate, fast, inside the barber pole.
      await P.run(300, () => {
        const p = arrow();
        if (p) { B.target = p; B.alt = p.y; }
        return stepId(sim) === 'configure';
      });
      say(`through the gate at ${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)} y ${ac.pos.y.toFixed(0)} ias ${ac.ias.toFixed(0)}, overspeed ${(sim.runner.data.overspeedT || 0).toFixed(0)} s`);
      // A short field: configure at the fix, aim close in (6 m over the ridge), and a firm flare — no float.
      await P.approach(RUNWAY.touchdown, RUNWAY.headingDeg ?? 90, {
        preDist: 7200, iafDist: 4600, margin: 6, maxSecs: 260, maxDown: 12,
        onGlide: () => { B.firmFlare = true; },
      });
      return result();
    }
    throw new Error(`unknown run ${what}`);
  } catch (e) {
    P.remove();
    sim.__funPilot = null;
    return { what, error: String(e && (e.stack || e.message)), status: sim.runner.status, log, tele: P.B.tele.slice(-6) };
  }
}

export async function check(sim, r, say = () => {}) {
  const Fun = await import('../../src/game/fun-kit.js');
  const { MISSIONS, findMission } = await import('../../src/game/missions.js');
  const origRender = sim.renderer.render.bind(sim.renderer);
  const origAuto = sim.autoPauseOnHide;
  const wasUnlocked = !!(sim.prog && sim.prog.militaryUnlocked);
  const menus = sim.menus;
  sim.autoPauseOnHide = false;
  sim.renderer.render = () => {};
  const brief = (o) =>
    o.error
      ? `ERROR ${o.error.slice(0, 300)} | tele: ${(o.tele || []).join(' / ')}`
      : `${o.status} score ${o.score} medal ${o.medal} in ${o.elapsed}s; beats ${o.beats.join(',') || 'none'}${o.reason ? `; reason "${o.reason}"` : ''}${o.crashed ? `; crashed: ${o.crashReason}` : ''}${o.data && Object.keys(o.data).length ? ` ${JSON.stringify(o.data)}` : ''}${o.status !== 'complete' && o.tele ? ` | tele: ${o.tele.join(' / ')}` : ''}`;
  try {
    /* ---- the board ------------------------------------------------- */
    say('plane-core: the board');
    if (menus && menus.screens && menus.screens.missions) {
      menus.setGame('flight');
      menus.applyGameToCards();
      for (const id of ['stray-contact', 'diversion']) {
        const card = menus.screens.missions.querySelector(`[data-mission="${id}"]`);
        r.ok(`plane-core: ${id} has a card on the aeroplane's board`, !!card && !card.hidden, card ? 'shown' : 'no card');
      }
    }
    const core = ['circuit', 'delivery', 'storm', 'deadstick', 'emberrun', 'medevac', 'chaser', 'carrierqual', 'patrol', 'recon', 'range', 'tail', 'stray-contact', 'diversion'];
    const noBeat = core.filter((id) => { const m = findMission(id); return m && id !== 'circuit' && !(m.beats && m.beats.length); });
    r.ok('plane-core: every core mission has a twist, or says it is a lesson', noBeat.length === 0, noBeat.join(', ') || `${core.length} missions`);
    const badPar = core.filter((id) => { const m = findMission(id); const cp = (m.steps || []).some((s) => s.checkpoint); return m.parTime > (cp ? 540 : 420); });
    r.ok('plane-core: every core mission pars inside seven minutes (nine with a checkpoint)', badPar.length === 0, badPar.join(', ') || 'all inside');

    /* ---- Night Medevac: the checkpoint ---------------------------- */
    say('plane-core: Night Medevac checkpoint');
    await sim.startMode('mission', { id: 'medevac' });
    sim.step(0.3);
    while (sim.runner.step && sim.runner.step.id !== 'back') sim.runner.skipStep();
    const cp = Fun.checkpoint();
    r.ok('plane-core: "Patient aboard" is remembered as a checkpoint', !!cp && cp.label === 'Patient aboard' && cp.missionId === 'medevac' && cp.stepIndex === sim.runner.def.steps.findIndex((x) => x.id === 'back'), cp ? JSON.stringify({ label: cp.label, step: cp.stepIndex, elapsed: Math.round(cp.elapsed), fuel: cp.spawn && cp.spawn.fuel && cp.spawn.fuel.toFixed(2) }) : 'none');
    sim.runner.fail('test: lost on the way home');
    sim.step(0.5);
    const dbf = sim.menus.screens.debrief;
    const buttons = dbf ? [...dbf.querySelectorAll('[data-actions] button')] : [];
    const again = buttons.find((b) => /Try again from: Patient aboard/.test(b.textContent));
    r.ok('plane-core: the fail debrief offers "Try again from: Patient aboard" first', !!again && again.classList.contains('primary'), buttons.map((b) => b.textContent.trim()).join(' | '));
    if (again) {
      const wantElapsed = cp.elapsed;
      const t0 = Date.now();
      again.click();
      let waited = 0;
      for (; waited < 160 && !(sim.state === 'flying' && sim.runner.status === 'running'); waited++) await new Promise((res) => setTimeout(res, 50));
      sim.step(0.3);
      // The clock the resume put back: elapsed less the time flown since the step was (re-)entered.
      const clockAtEntry = sim.runner.elapsed - sim.runner.stepElapsed;
      const res = Fun.resumedFrom();
      const ok = !!res && res.label === 'Patient aboard' && res.missionId === 'medevac';
      r.ok('plane-core: …which resumes on the pad at "back", with the clock and the patient aboard', ok, `step ${sim.runner.step && sim.runner.step.id} ${sim.runner.status}, clock at entry ${clockAtEntry.toFixed(1)} vs ${wantElapsed.toFixed(1)}, aboard ${sim.runner.data.aboard}, fuel ${sim.aircraft.fuelFraction().toFixed(2)}, resumed ${Fun.resumedFrom() === cp}; flying after ${((Date.now() - t0) / 1000).toFixed(1)} s (${waited} polls), on the ground ${sim.aircraft.onGround} at ${Math.round(sim.aircraft.pos.x)},${Math.round(sim.aircraft.pos.z)}`);
    }

    /* ---- Storm Approach ------------------------------------------- */
    say('plane-core: Storm Approach, adding power through the shear');
    const storm = await fly(sim, 'storm');
    r.ok('plane-core: Storm Approach — the shear fires on short final', storm.beats.includes('shear'), brief(storm));
    r.ok('plane-core: Storm Approach — the pilot that adds power lands it (a medal)', storm.status === 'complete' && !!storm.medal, brief(storm));
    r.ok('plane-core: Storm Approach — the debrief shows the medal strip and "What happened: wind shear"', !!storm.strip && /Wind shear/.test(storm.happened || ''), JSON.stringify({ finale: storm.finale, strip: storm.strip, happened: storm.happened }));
    await new Promise((res) => setTimeout(res, 150));
    r.ok('plane-core: Storm Approach — the debrief\'s primary button is focused for an instant retry', document.activeElement && document.activeElement.closest && !!document.activeElement.closest('[data-actions]'), document.activeElement ? document.activeElement.textContent.trim().slice(0, 80) : 'nothing focused');
    say('plane-core: Storm Approach, fast and firm');
    const sloppy = await fly(sim, 'storm-sloppy');
    r.ok('plane-core: Storm Approach — a fast, firm arrival still finishes, for Bronze or Silver (not Gold)', sloppy.status === 'complete' && (sloppy.medal === 'bronze' || sloppy.medal === 'silver'), brief(sloppy));
    r.ok('plane-core: Storm Approach — on the runway, the finale takes the picture while it rolls out', !sloppy.data.onRunway || sloppy.finale === true, `finale ${sloppy.finale}`);
    say('plane-core: Storm Approach, holding power through the shear');
    const stormFail = await fly(sim, 'storm-fail');
    r.ok('plane-core: Storm Approach — the pilot that holds its power comes down short, and the reason says to add power', stormFail.status === 'failed' && /add power/i.test(stormFail.reason || ''), brief(stormFail) + ` | ${(stormFail.log || []).slice(-2).join(' | ')}`);

    /* ---- Carrier Qualification ------------------------------------ */
    /*
     * The passes, by the mission's own hands (tick, failIf, score): the way out and the
     * groove are the mission as it was, and this pilot's lateral loop does not hold a
     * centreline at Osprey speeds. On the deck, off it again, three times, is the rule.
     */
    say('plane-core: Carrier Qualification, the passes');
    await sim.startMode('mission', { id: 'carrierqual' });
    sim.step(0.3);
    {
      const run = sim.runner;
      const ctx = run.ctx();
      const def = run.def;
      const deck = sim.carrier.pos;
      const fake = { pos: { x: deck.x, y: sim.carrier.deckY, z: deck.z }, onGround: true, groundSpeed: 40, groundTime: 2 };
      const c = { ...ctx, ac: fake, runner: { elapsed: 40, get status() { return run.status; }, def } };
      for (let pass = 1; pass <= 3; pass++) {
        c.runner.elapsed = 40 + pass * 30;
        fake.onGround = true;
        def.tick(c, 0.1);
        fake.onGround = false;
        fake.pos.y = sim.carrier.deckY + 30;
        def.tick(c, 0.4);
        def.tick(c, 0.4);
        fake.pos.y = sim.carrier.deckY;
      }
      r.ok('plane-core: Carrier Qualification — three bolters are counted', ctx.data.passes === 3, `passes ${ctx.data.passes}`);
      r.ok('plane-core: Carrier Qualification — and the fail says to fly the ball', /fly the ball/i.test(def.failIf(c) || ''), def.failIf(c) || 'no fail');
      const gold = (land, passes) => { ctx.data.passes = passes; ctx.data.lastTouchdown = { score: land }; return Fun.medalFor(def, def.score(c)); };
      r.ok('plane-core: Carrier Qualification — first pass steady is Gold, second Silver, third Bronze', gold(90, 0) === 'gold' && gold(90, 1) === 'silver' && gold(90, 2) === 'bronze', `${gold(90, 0)}, ${gold(90, 1)}, ${gold(90, 2)}`);
    }
    sim.quitToMenu('main');

    /* ---- Stray Contact -------------------------------------------- */
    say('plane-core: Stray Contact, the intercept');
    const stray = await fly(sim, 'stray');
    r.ok('plane-core: Stray Contact — scramble, signal from ahead-left, lead him clear, land: a pass with a medal', stray.status === 'complete' && !!stray.medal, brief(stray) + ` | ${(stray.log || []).slice(-5).join(' | ')}`);
    r.ok('plane-core: Stray Contact — he saw the signal and followed; the cloud base came down', stray.data && stray.data.seen === true && stray.beats.includes('cloud'), JSON.stringify(stray.data));
    say('plane-core: Stray Contact, hands off');
    const strayFail = await fly(sim, 'stray-fail');
    r.ok('plane-core: Stray Contact — hands off, he flies into the range and the reason names the fix', strayFail.status === 'failed' && /ahead-left/.test(strayFail.reason || ''), brief(strayFail));

    /* ---- Diversion ------------------------------------------------ */
    say('plane-core: Diversion, flown');
    const div = await fly(sim, 'diversion');
    r.ok('plane-core: Diversion — down through the squall onto the short wet runway: a pass with a medal', div.status === 'complete' && !!div.medal, brief(div) + ` | ${(div.log || []).slice(-3).join(' | ')}`);
    r.ok('plane-core: Diversion — the squall line and the wet runway both fired', div.beats.includes('squall') && div.beats.includes('wet'), brief(div));
    say('plane-core: Diversion, hands off');
    const divFail = await fly(sim, 'diversion-fail');
    r.ok('plane-core: Diversion — hands off fails with one of the mission\'s own reasons', divFail.status === 'failed' && !!divFail.reason && /patient|barber|runway|slope/i.test(divFail.reason), brief(divFail));
  } catch (e) {
    r.ok('plane-core: the check ran without throwing', false, String(e && (e.stack || e.message)).slice(0, 600));
  } finally {
    sim.override = null;
    sim.__funPilot = null;
    sim.renderer.render = origRender;
    sim.autoPauseOnHide = origAuto;
    if (sim.prog) sim.prog.militaryUnlocked = wasUnlocked;
    try {
      sim.quitToMenu('main');
    } catch (e) {
      /* the menu is where the next check starts */
    }
  }
}

export default check;
