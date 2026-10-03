/**
 * A scripted pilot for the flight missions — the owner's proof that a
 * mission moved to a new island is still a mission somebody can finish
 * (2026-10-02: "use different maps for different missions … keep every
 * mission completable (scripted pilots in the tests)").
 *
 *   const { flyMission } = await import('./tests/features/mission-pilot.js');
 *   const out = await flyMission(window.__sim, 'deadstick');
 *   console.log(out.ok, out.status, out.log.join('\n'));
 *
 * Modelled on tests/features/afo.playthrough.js: ONE controller steers
 * heading, height and speed at sim.runner.activeTarget() — the point the
 * on-screen arrow points at — through sim.override, the input main.js
 * applies over the keyboard every frame. It never teleports and never calls
 * a mission's own functions; it reads the same things a step's check reads
 * (sim.runner, sim.tornado, sim.carrier, the aircraft) and presses real
 * keys (sim.tap) for the cargo drop. On top of the generic controller a
 * small table says what each mission's steps want of a pilot: a glide at
 * best speed with the engine dead, three passes by a tornado, a climb into
 * cloud, weaving under falling rocks, a landing on a ship.
 *
 * LANDINGS: a 'join' point five kilometres short of the touchdown along the
 * runway's axis, then a three-degree glide, flaps, wheels and a flare on
 * the wheels — the afo bot's glide, with the join in front of it so it
 * works from any side of the field. A ship is landed the same way along
 * the deck's axis (sim.carrier.headingDeg), with the deck's height as the
 * ground.
 *
 * `opts.assist` (default false): when the pilot has not finished a step
 * inside its share of the budget, put the aeroplane where the step wants
 * it and carry on, so the REST of the mission is still proved. The result
 * says which steps were assisted; a run that needed none is a clean pass.
 *
 * @returns {Promise<{ ok, status, seconds, assisted: string[], crashed, crashReason, log, steps: string[] }>}
 */
export async function flyMission(sim, id, { role = undefined, maxSeconds = undefined, assist = false, shots = false, say: tell = null } = {}) {
  const THREE = await import('../../src/vendor/three.module.js');
  const { RUNWAY } = await import('../../src/world/airport.js');
  const { heightAt } = await import('../../src/world/terrain.js');
  const TY = await import('../../src/aircraft/types.js');
  const ac = sim.aircraft;
  const realRender = sim.renderer.render.bind(sim.renderer);
  sim.renderer.render = () => {};
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const log = [];
  const pics = [];
  const stepsSeen = [];
  const assisted = [];
  let T = 0;
  const say = (s) => {
    log.push(`${T.toFixed(0)}s ${s}`);
    if (tell) tell(`pilot ${id}: ${s}`);
  };
  const noDebrief = () => clearTimeout(sim._crashDebriefT);
  const shot = (name) => {
    if (!shots) return;
    realRender(sim.scene, sim.camera);
    pics.push({ name, url: sim.renderer.domElement.toDataURL('image/jpeg', 0.72) });
  };
  const ground = (x, z) => Math.max(0, heightAt(x, z));
  const KT = 1 / 1.94384;

  /* ---- the mission's own book: what each step wants of a pilot ---- */
  const PLAN = {
    deadstick: { budget: 320, glider: true, land: ['glide', 'touch'] },
    chaser: { budget: 560, weave: 'tornado', land: ['home'] },
    tail: { budget: 540, climbTo: { climb: 1330, lose: 1360 }, land: ['home'], straight: ['lose'], shake: true },
    'meteor-dodge': { budget: 230, weave: 'rocks' },
    'meteor-photo': { budget: 240 },
    'meteor-shower': { budget: 40, neverEnds: true },
    'goofy-gulls': { budget: 320, fullPower: true, alt: 250 },
    'goofy-icecream': { budget: 480, high: { cruise: 760 }, drop: 'drop' },
    'goofy-cow': { budget: 600, deck: ['land'], gentle: true },
    carrierqual: { budget: 900, deck: ['trap'], approachAt: ['pattern'] },
  };
  const plan = PLAN[id] || { budget: 420 };
  const cap = maxSeconds || plan.budget;

  /* ---- the aeroplane's numbers ---- */
  let vApp = 36;
  let vCruise = 55;
  let vRotate = 30;
  const tuneFor = () => {
    const tid = sim.aircraftType ? sim.aircraftType.id : 'skylark';
    try {
      const p = TY.performanceFor(tid);
      if (Number.isFinite(p.stallLanding) && p.stallLanding > 0) vApp = Math.max(30, p.stallLanding * KT * 1.3);
      if (Number.isFinite(p.stallClean) && p.stallClean > 0) {
        vRotate = Math.max(26, p.stallClean * KT * 1.12);
        vCruise = Math.max(50, p.stallClean * KT * 1.9);
      }
      if (Number.isFinite(p.vne) && p.vne > 0) vCruise = Math.min(vCruise, p.vne * KT * 0.6);
    } catch (e) {
      /* the defaults are the trainer's */
    }
  };

  /* ---- the controller ---- */
  const TAN3 = Math.tan((3 * Math.PI) / 180);
  const B = { hdg: 0, alt: 300, spd: 55, target: null, glide: false, flare: false, tookOff: false, L: 90, td: new THREE.Vector3(), join: null, I: 0, Is: 0, Ix: 0, out: {}, glider: false, gliderSpd: 33.4, deckY: null, maxBank: 25, straight: false, holdHdg: false };
  const compute = () => {
    const dt = 1 / 30;
    const o = B.out;
    if (ac.airborneTime > 0.3) B.tookOff = true;
    const rolling = ac.onGround && !B.tookOff;
    let wantHdg = B.hdg;
    let wantY = B.alt;
    let ffVs = 0;
    if (rolling) {
      wantHdg = B.hdg;
    } else if (B.glide) {
      const L = (B.L * Math.PI) / 180;
      const cross = (ac.pos.x - B.td.x) * Math.cos(L) + (ac.pos.z - B.td.z) * Math.sin(L);
      const along = (B.td.x - ac.pos.x) * Math.sin(L) - (B.td.z - ac.pos.z) * Math.cos(L);
      B.Ix = Math.max(-8, Math.min(8, B.Ix + cross * dt * 0.004));
      wantHdg = B.L - Math.max(-30, Math.min(30, cross * (along < 3000 ? 0.12 : 0.05) + B.Ix));
      wantY = B.td.y + Math.max(0, along) * TAN3;
      ffVs = -ac.groundSpeed * TAN3;
    } else if (B.target && !B.holdHdg) {
      wantHdg = ((Math.atan2(B.target.x - ac.pos.x, -(B.target.z - ac.pos.z)) * 180) / Math.PI + 360) % 360;
    }
    const err = ((wantHdg - ac.heading + 540) % 360) - 180;
    const lim = B.glide && ac.agl < 150 ? 15 : B.maxBank;
    const wantBank = ac.onGround ? 0 : Math.max(-lim, Math.min(lim, err * 0.8));
    const bank = ac.bankAngleDeg();
    o.roll = Math.max(-0.7, Math.min(0.7, (wantBank - bank) * 0.055 - ac.omega.z * 0.55));
    let wantVs = Math.max(-9, Math.min(B.glider ? 0 : 7, (wantY - ac.pos.y) * 0.08 + ffVs));
    if (B.glide && ac.pos.y - B.td.y < 40) wantVs = Math.max(wantVs, -3.5);
    if (B.flare) wantVs = ac.pos.y - B.td.y > 2 ? -1.6 : -0.8;
    const floorY = ground(ac.pos.x, ac.pos.z);
    if (!B.glide && !ac.onGround && ac.pos.y - floorY < 60 && !B.glider) wantVs = Math.max(wantVs, 2);
    if (B.glider && !B.flare && !ac.onGround) {
      // No engine: the nose holds the SPEED, not the height. Slow → nose
      // down; fast → nose up. Height takes care of itself along the glide.
      const spdErr = ac.ias - B.gliderSpd;
      B.I = Math.max(-0.3, Math.min(0.3, B.I + spdErr * dt * 0.01));
      o.pitch = Math.max(-0.5, Math.min(0.6, spdErr * 0.03 + B.I - ac.omega.x * 0.5));
    } else {
      B.I = Math.max(-0.4, Math.min(0.5, B.I + (wantVs - ac.vs) * dt * 0.03));
      o.pitch = rolling ? (ac.ias > vRotate ? 0.5 : 0)
        : ac.onGround ? 0
        : Math.max(-0.6, Math.min(0.75, B.I + (wantVs - ac.vs) * 0.12 - ac.omega.x * 0.6 + (Math.abs(bank) / 25) * 0.06));
    }
    B.Is = Math.max(-0.4, Math.min(0.5, B.Is + (B.spd - ac.ias) * dt * 0.01));
    o.throttle = B.glider ? 0
      : (B.flare && ac.agl < 8) ? 0
      : rolling ? 1
      : ac.onGround ? 0
      : Math.max(0, Math.min(1, 0.45 + (B.spd - ac.ias) * 0.05 + B.Is + wantVs * 0.02));
    o.yaw = ac.onGround ? Math.max(-1, Math.min(1, err * 0.08)) : Math.max(-0.5, Math.min(0.5, (ac.beta || 0) * 1.6));
    o.brakes = rolling ? 0 : ac.onGround && ac.groundTime > 1 ? 1 : 0;
  };
  const CTRL = {};
  Object.defineProperty(CTRL, 'pitch', { enumerable: true, get() { compute(); return B.out.pitch; } });
  for (const k of ['roll', 'yaw', 'throttle', 'brakes']) Object.defineProperty(CTRL, k, { enumerable: true, get() { return B.out[k]; } });

  /** Line up for a landing at `td` along heading `L` (degrees): a join point first, then the glide. */
  const planLanding = (td, L, dist = 5000, high = 300) => {
    const r = (L * Math.PI) / 180;
    B.td.copy(td);
    B.L = L;
    B.join = new THREE.Vector3(td.x - Math.sin(r) * dist, td.y + high, td.z + Math.cos(r) * dist);
    B.glide = false;
    B.flare = false;
    say(`landing planned: td ${td.x.toFixed(0)},${td.z.toFixed(0)} y ${td.y.toFixed(0)} on ${L}°, join ${dist} m out`);
  };
  const flyLanding = () => {
    if (!B.join) return;
    if (!B.glide) {
      B.target = B.join;
      B.alt = B.join.y;
      B.spd = Math.max(vApp * 1.3, 45);
      const d = Math.hypot(B.join.x - ac.pos.x, B.join.z - ac.pos.z);
      // At the join and pointing roughly down the runway: on to the glide.
      const err = Math.abs((((B.L - ac.heading) % 360) + 540) % 360 - 180);
      if (d < 700 && err < 50) {
        B.glide = true;
        say('on the glide');
      }
      return;
    }
    B.spd = vApp;
    if (!ac.gearDown) sim.tap('KeyG');
    if (ac.flapStep && ac.flapStep() < 2 && ac.pos.y - B.td.y < 600) ac.setFlaps(ac.flapStep() + 1);
    if (!B.flare && ac.pos.y - B.td.y < Math.max(8, -ac.vs * 3) && !ac.onGround) {
      B.flare = true;
      say('flare');
    }
  };

  const runwayLanding = () => planLanding(RUNWAY.touchdown.clone(), RUNWAY.headingDeg ?? 90, 5000, 280);
  /** Land on the ship: along its heading, aiming a third of the way up the deck, the deck as the ground. */
  const deckLanding = () => {
    const c = sim.carrier;
    if (!c) return false;
    const L = c.headingDeg || 0;
    const r = (L * Math.PI) / 180;
    const deckY = c.deckY || 24;
    // The deck's long axis is `halfDepth` when the ship points north/south, `halfWidth` east/west.
    const alongNS = Math.abs(L % 180) < 45;
    const half = alongNS ? c.halfDepth : c.halfWidth;
    const td = new THREE.Vector3(c.pos.x - Math.sin(r) * half * 0.35, deckY, c.pos.z + Math.cos(r) * half * 0.35);
    planLanding(td, L, 3200, 220);
    B.deckY = deckY;
    return true;
  };

  /* ---- fly ---- */
  tuneFor();
  const t0 = performance.now();
  let lastStepId = null;
  let weaveT = 0;
  let side = 1;
  let passTarget = null;
  let stepT = 0;
  let dropped = false;
  try {
    if (role) await sim.startMode('mission', { id, role });
    else await sim.startMode('mission', { id });
    tuneFor();
    B.hdg = ac.heading;
    B.alt = Math.max(ac.pos.y, ground(ac.pos.x, ac.pos.z) + 150);
    B.spd = vCruise;
    B.maxBank = plan.gentle ? 20 : 25;
    sim.override = CTRL;
    say(`start ${sim.aircraftType.id} on ${sim.settings.map} at ${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)} y ${ac.pos.y.toFixed(0)} ias ${ac.ias.toFixed(0)} (vApp ${vApp.toFixed(0)}, cruise ${vCruise.toFixed(0)})`);
    shot(`${id}-start`);
    const stepShare = cap / Math.max(1, (sim.runner.def && sim.runner.def.steps ? sim.runner.def.steps.length : 3));

    while (T < cap) {
      sim.step(0.25, 1 / 30);
      noDebrief();
      T += 0.25;
      stepT += 0.25;
      const step = sim.runner.step;
      const stepId = step ? step.id : null;
      if (stepId !== lastStepId) {
        say(`step ${stepId} (${sim.runner.status}) at ${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)} y ${ac.pos.y.toFixed(0)} ias ${ac.ias.toFixed(0)} hdg ${ac.heading.toFixed(0)}`);
        stepsSeen.push(stepId);
        lastStepId = stepId;
        stepT = 0;
        B.join = null;
        B.glide = false;
        B.flare = false;
        B.holdHdg = false;
        passTarget = null;
        shot(`${id}-${stepId}`);
      }
      if (ac.crashed) {
        say(`CRASHED: ${ac.crashReason}`);
        break;
      }
      if (sim.runner.status !== 'running') {
        say(`mission ${sim.runner.status}`);
        break;
      }
      if (plan.neverEnds && T >= cap - 0.5) {
        say('a mission with no end: flown for the budget, still flying');
        break;
      }

      const at = sim.runner.activeTarget();
      B.target = at ? at.pos : null;
      if (B.target && !B.join) B.alt = Math.max(B.target.y, ground(ac.pos.x, ac.pos.z) + 120);
      B.spd = plan.fullPower ? 90 : vCruise;
      if (plan.alt && !B.join) B.alt = ground(ac.pos.x, ac.pos.z) + plan.alt;

      // The dead-stick glide: best speed, aim at the threshold, and manage the
      // height — the trainer glides 7.9:1 clean, so with more height than the
      // distance needs it flies a dog-leg (aim beside the threshold until the
      // numbers agree), and over the threshold it puts the flaps out and lands long.
      if (plan.glider && stepId !== null && !ac.onGround) {
        B.glider = ac.failures && ac.failures.engine;
        B.gliderSpd = 65 * KT;
        if (plan.land.includes(stepId) && B.target) {
          const thr = RUNWAY.thresholdWest;
          const dTh = Math.hypot(thr.x - ac.pos.x, thr.z - ac.pos.z);
          const need = dTh / 7.9;
          const have = ac.pos.y - RUNWAY.touchdown.y;
          if (dTh > 2200 && have > need + 140) {
            // Too high: aim 700 m to the side of the threshold to use some up.
            const r = ((RUNWAY.headingDeg ?? 90) * Math.PI) / 180;
            B.target = new THREE.Vector3(thr.x + Math.cos(r) * 700, thr.y, thr.z + Math.sin(r) * 700);
          } else {
            B.target = stepId === 'touch' ? RUNWAY.touchdown : thr;
          }
          if (dTh < 1500 && have > 60 && ac.flapStep && ac.flapStep() < 2) ac.setFlaps(ac.flapStep() + 1);
          if (!ac.gearDown && dTh < 2500) sim.tap('KeyG');
          if (!B.flare && have < 9) {
            B.flare = true;
            B.td.copy(RUNWAY.touchdown);
            say('flare (no engine)');
          }
        }
      }

      // Shake the Tail: inside knife range one of them lines up a shot; a hard
      // break (over 45 degrees of bank for a second) sends him past, and the
      // climb into the cloud goes on. A break whenever any of them has been
      // close for three seconds, alternating sides.
      if (plan.shake && !ac.onGround && (stepId === 'climb' || stepId === 'lose')) {
        const flight = sim.pursuers || [];
        const close = flight.some((j) => j.alive && !j.knocked && j.closeT > 3);
        if (close && T >= (B.breakUntil || 0) + 6) {
          B.breakUntil = T + 2.5;
          side = -side;
          say(`BREAK ${side > 0 ? 'right' : 'left'}`);
        }
        if (T < (B.breakUntil || 0)) {
          B.holdHdg = true;
          B.hdg = (ac.heading + side * 160 + 360) % 360;
          B.maxBank = 62;
        } else {
          B.maxBank = 25;
          if (stepId === 'climb') B.holdHdg = false;
        }
      }

      // Climb into the cloud, then fly straight in it.
      if (plan.climbTo && plan.climbTo[stepId] != null) {
        B.alt = plan.climbTo[stepId];
        B.spd = vCruise;
        if (plan.straight && plan.straight.includes(stepId)) {
          B.holdHdg = true;
          B.hdg = ac.heading;
        }
      }

      // Weaving: by a tornado (passes count when you go through the band and out), or under rocks.
      if (plan.weave === 'tornado' && stepId === 'passes' && sim.tornado && sim.tornado.active) {
        const tp = sim.tornado.pos;
        const d = Math.hypot(tp.x - ac.pos.x, tp.z - ac.pos.z);
        if (!passTarget || (d > 1400 && passTarget.done)) {
          // Aim 480 m to one side of the core: inside the band (0.55 of the reach), well outside the core.
          const dx = tp.x - ac.pos.x;
          const dz = tp.z - ac.pos.z;
          const n = Math.hypot(dx, dz) || 1;
          side = -side;
          const px = -dz / n;
          const pz = dx / n;
          passTarget = { pos: new THREE.Vector3(tp.x + px * side * 480, (tp.y || 0) + 400, tp.z + pz * side * 480), done: false, through: false };
          say(`pass: aiming ${side > 0 ? 'right' : 'left'} of the funnel, ${d.toFixed(0)} m out`);
        }
        if (passTarget) {
          // Keep the aim beside the funnel as it drifts, then run on 1.5 km past it.
          const dx = tp.x - ac.pos.x;
          const dz = tp.z - ac.pos.z;
          const n = Math.hypot(dx, dz) || 1;
          if (!passTarget.through && d < 560) passTarget.through = true;
          if (passTarget.through) {
            passTarget.pos.set(ac.pos.x + (ac.pos.x - tp.x) / n * 1500, (tp.y || 0) + 400, ac.pos.z + (ac.pos.z - tp.z) / n * 1500);
            if (d > 1350) passTarget.done = true;
          } else {
            const px = -dz / n;
            const pz = dx / n;
            passTarget.pos.set(tp.x + px * side * 480, (tp.y || 0) + 400, tp.z + pz * side * 480);
          }
          B.target = passTarget.pos;
          B.alt = Math.max(ground(ac.pos.x, ac.pos.z) + 250, 400);
        }
      }
      if (plan.weave === 'rocks') {
        weaveT += 0.25;
        B.holdHdg = true;
        // A new heading every eight seconds, and a new height: never where a rock was aimed.
        if (weaveT % 8 < 0.25) {
          side = -side;
          B.hdg = (ac.heading + side * 70 + 360) % 360;
          B.alt = Math.max(500, Math.min(1100, ac.pos.y + side * 200));
          say(`weave: ${B.hdg.toFixed(0)}° at ${B.alt.toFixed(0)} m`);
        }
      }

      // Stay high for the ice cream, then come down for the drop — slow, low over the
      // pad, and let it go just short of it, the way the delivery lesson teaches.
      if (plan.high && plan.high[stepId] != null) B.alt = Math.max(B.alt, plan.high[stepId]);
      if (plan.drop === stepId && B.target) {
        const padY = ground(B.target.x, B.target.z);
        B.alt = padY + 70;
        B.spd = Math.max(vApp, 34);
        const d = Math.hypot(B.target.x - ac.pos.x, B.target.z - ac.pos.z);
        const up = ac.pos.y - padY;
        if (!dropped && sim.hasCargo && !sim.crate && d < 95 && up > 30 && up < 130) {
          sim.tap('KeyX');
          dropped = true;
          say(`drop at ${d.toFixed(0)} m, ${up.toFixed(0)} m up, ${ac.groundSpeed.toFixed(0)} m/s`);
        }
        if (dropped && !sim.crate && sim.hasCargo) {
          dropped = false; // a miss: another one is loaded, come round again
          say('missed — coming round');
        }
      }

      // Landings.
      if (plan.land && plan.land.includes(stepId) && !plan.glider) {
        if (!B.join) runwayLanding();
        flyLanding();
      }
      if (plan.deck && plan.deck.includes(stepId)) {
        if (!B.join && !deckLanding()) say('no carrier to land on');
        flyLanding();
      }
      if (plan.approachAt && plan.approachAt.includes(stepId) && B.target) {
        // Within 900 m and under 900 ft of the deck: come down towards it.
        B.alt = (sim.carrier ? sim.carrier.deckY || 24 : 0) + 150;
      }

      // Stuck on a step for its share of the budget: put the aeroplane where the step wants it (and say so).
      if (assist && stepT > stepShare && B.target && !ac.onGround) {
        assisted.push(stepId);
        say(`ASSIST on ${stepId}: placed at the step's target`);
        if ((plan.deck && plan.deck.includes(stepId)) || (plan.land && plan.land.includes(stepId))) {
          const td = plan.deck && plan.deck.includes(stepId) && sim.carrier ? new THREE.Vector3(sim.carrier.pos.x, (sim.carrier.deckY || 24), sim.carrier.pos.z) : RUNWAY.touchdown.clone();
          const L = plan.deck && plan.deck.includes(stepId) && sim.carrier ? sim.carrier.headingDeg || 0 : RUNWAY.headingDeg ?? 90;
          ac.reset({ pos: td, headingDeg: L, speed: 0, altAGL: 0, engineOn: true, gearDown: true });
          ac.onGround = true;
        } else {
          ac.reset({ pos: B.target.clone(), headingDeg: ac.heading, speed: Math.max(45, vCruise), altAGL: Math.max(20, B.target.y - ground(B.target.x, B.target.z)), engineOn: true, gearDown: false });
        }
        stepT = 0;
      }

      if (T % 30 < 0.25) say(`… ${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)} y ${ac.pos.y.toFixed(0)} ias ${ac.ias.toFixed(0)} hdg ${ac.heading.toFixed(0)} vs ${ac.vs.toFixed(1)}${B.glide ? ' glide' : ''}${B.join && !B.glide ? ' joining' : ''}`);
    }
    shot(`${id}-end`);
  } finally {
    sim.override = null;
    sim.renderer.render = realRender;
    sim.autoPauseOnHide = origAuto;
  }
  const status = sim.runner.status;
  return {
    ok: plan.neverEnds ? status === 'running' && !ac.crashed : status === 'complete',
    id, status, seconds: T, wallMs: Math.round(performance.now() - t0), assisted,
    crashed: ac.crashed, crashReason: ac.crashReason, map: sim.settings.map,
    score: sim.runner.data ? sim.runner.data.score : null,
    steps: stepsSeen, log, shots: pics,
  };
}

export default flyMission;
