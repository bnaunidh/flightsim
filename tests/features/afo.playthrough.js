/**
 * The pilot bot for Air Force One: plays either mission, from either seat,
 * to a pass or — deliberately — to a fail, on the real game.
 *
 *   const { playthrough } = await import('./tests/features/afo.playthrough.js');
 *   const out = await playthrough(sim, 'afo-normal', 'captain');
 *   const out2 = await playthrough(sim, 'afo-attack', 'escort', { fail: true });
 *
 * Model: tests/features/events.playthrough.js. It is simpler than that bot
 * because these two missions ask less of a pilot — no cards, no ICAO wing
 * rock, no interphone — so ONE generic controller flies every step of both
 * seats of both missions: it reads sim.runner.activeTarget() (the same
 * point the on-screen arrow points at — including its own look-ahead to the
 * next step while the current one names nowhere, e.g. "take off") and steers
 * heading, height and speed at it; a step named 'land' switches it onto a
 * three-degree glide to the runway; a step named 'taxi' switches it to a
 * walking-pace taxi at the target. It never calls a story's own functions —
 * it reads sim.runner, castActor() and afoInfo(), the same things a step's
 * own check() reads, and presses real keys (sim.key / sim.tap) for the gun
 * and the flares.
 *
 * `opts.fail`, per mission x seat, is the ONE thing this file decides is
 * worth two different flights rather than one:
 *   - afo-normal / captain:  fail = dive into the sea on departure (the
 *     generic crash path every mission already fails on).
 *   - afo-normal / escort:   fail = close on the airliner itself rather than
 *     its wing slot (ESCORT_NORMAL's own too-close failIf).
 *   - afo-attack / captain:  fail = never touch the flares. Nothing else
 *     stops a missile once a drone has fired it.
 *   - afo-attack / escort:   fail = never fire the gun. The NPC captain's own
 *     four flares run out and the drones keep coming.
 *
 * @returns {Promise<{ ok, status, seconds, score, log, shots }>}
 */
export async function playthrough(sim, missionId, roleId, { fail = false, shots = false, maxSeconds } = {}) {
  const THREE = await import('../../src/vendor/three.module.js');
  const AfoFeat = await import('../../src/features/events/afo.js');
  const Cast = await import('../../src/game/roles/cast.js');
  const { RUNWAY } = await import('../../src/world/airport.js');

  const ac = sim.aircraft;
  const realRender = sim.renderer.render.bind(sim.renderer);
  sim.renderer.render = () => {};
  const pics = [];
  const taken = new Set();
  const log = [];
  let T = 0;
  const say = (s) => log.push(`${T.toFixed(0)}s ${s}`);
  const shot = (name) => {
    if (!shots || taken.has(name)) return;
    taken.add(name);
    realRender(sim.scene, sim.camera);
    pics.push({ name, url: sim.renderer.domElement.toDataURL('image/jpeg', 0.75) });
  };

  const isCaptain = roleId === 'captain';
  const defaultMax = missionId === 'afo-normal' ? (isCaptain ? 700 : 420) : (isCaptain ? 520 : 520);
  const cap = maxSeconds || (fail ? Math.min(defaultMax, 170) : defaultMax);

  /* ---- the controller: generic heading/height/speed, taxi, and a glide-slope landing ---- */
  const TAN3 = Math.tan((3 * Math.PI) / 180);
  const B = { hdg: ac.heading, alt: ac.pos.y, spd: 75, glide: false, flare: false, tookOff: false, L: 90, td: new THREE.Vector3(), taxi: null, I: 0, Is: 0, out: {} };
  const compute = () => {
    const dt = 1 / 30;
    const o = B.out;
    // Once airborne, for good: tells the ground logic below "rolling for
    // take-off" (full power, wheels down, rotate near flying speed) from
    // "down again" (brakes, stop) — onGround alone cannot tell those apart,
    // and a mission that starts ON the runway (afo-normal, either seat) sees
    // both in one flight, unlike the hijacks this controller was modelled on.
    if (ac.airborneTime > 0.3) B.tookOff = true;
    const rolling = ac.onGround && !B.tookOff;
    let wantHdg = B.hdg;
    let wantY = B.alt;
    let ffVs = 0;
    if (rolling) {
      // Track the runway centreline, not the eventual cruise point — real
      // rudder authority on the roll, not a hard turn at flying speed.
      wantHdg = B.hdg;
    } else if (B.taxi && ac.onGround) {
      wantHdg = ((Math.atan2(B.taxi.x - ac.pos.x, -(B.taxi.z - ac.pos.z)) * 180) / Math.PI + 360) % 360;
    } else if (B.glide) {
      const L = (B.L * Math.PI) / 180;
      const cross = (ac.pos.x - B.td.x) * Math.cos(L) + (ac.pos.z - B.td.z) * Math.sin(L);
      const along = (B.td.x - ac.pos.x) * Math.sin(L) - (B.td.z - ac.pos.z) * Math.cos(L);
      B.Ix = Math.max(-8, Math.min(8, (B.Ix || 0) + cross * dt * 0.004));
      wantHdg = B.L - Math.max(-30, Math.min(30, cross * (along < 3000 ? 0.12 : 0.05) + B.Ix));
      wantY = B.td.y + Math.max(0, along) * TAN3;
      ffVs = -ac.groundSpeed * TAN3;
    } else if (B.target) {
      wantHdg = ((Math.atan2(B.target.x - ac.pos.x, -(B.target.z - ac.pos.z)) * 180) / Math.PI + 360) % 360;
    }
    const err = ((wantHdg - ac.heading + 540) % 360) - 180;
    const lim = B.glide && ac.agl < 150 ? 15 : 25;
    const wantBank = ac.onGround ? 0 : Math.max(-lim, Math.min(lim, err * 0.8));
    const bank = ac.bankAngleDeg();
    o.roll = Math.max(-0.7, Math.min(0.7, (wantBank - bank) * 0.055 - ac.omega.z * 0.55));
    let wantVs = Math.max(-9, Math.min(6, (wantY - ac.pos.y) * 0.08 + ffVs));
    if (B.glide && ac.pos.y - B.td.y < 40) wantVs = Math.max(wantVs, -3.5);
    if (B.flare) wantVs = ac.pos.y - B.td.y > 2 ? -1.6 : -0.8;
    if (ac.agl < 60 && !B.glide && !ac.onGround) wantVs = Math.max(wantVs, 2);
    // Wheels down until flying speed, then rotate (`rolling`, above) — the
    // self-test's own take-off recipe (tests/selftest.js), not the
    // glide/cruise pitch law, which would hold the nose level at zero knots
    // forever.
    B.I = Math.max(-0.4, Math.min(0.5, B.I + (wantVs - ac.vs) * dt * 0.03));
    o.pitch = rolling ? (ac.ias > B.spd * 0.72 ? 0.5 : 0)
      : ac.onGround ? 0
      : Math.max(-0.6, Math.min(0.75, B.I + (wantVs - ac.vs) * 0.12 - ac.omega.x * 0.6 + (Math.abs(bank) / 25) * 0.06));
    B.Is = Math.max(-0.4, Math.min(0.5, B.Is + (B.spd - ac.ias) * dt * 0.01));
    o.throttle = (B.flare && ac.agl < 8) ? 0
      : rolling ? 1
      : ac.onGround ? 0
      : Math.max(0, Math.min(1, 0.45 + (B.spd - ac.ias) * 0.05 + B.Is + wantVs * 0.02));
    o.yaw = ac.onGround ? Math.max(-1, Math.min(1, err * 0.08)) : Math.max(-0.5, Math.min(0.5, (ac.beta || 0) * 1.6));
    o.brakes = rolling ? 0 : ac.onGround && ac.groundTime > 1 ? 1 : 0;
    if (B.taxi && ac.onGround) {
      const d = Math.hypot(B.taxi.x - ac.pos.x, B.taxi.z - ac.pos.z);
      const want = d < 45 ? 0 : Math.abs(err) > 40 ? 3 : 8;
      o.throttle = want === 0 ? 0 : Math.max(0, Math.min(0.5, 0.1 + (want - ac.groundSpeed) * 0.08));
      o.brakes = want === 0 || ac.groundSpeed > want + 1 ? 1 : 0;
      o.yaw = Math.max(-1, Math.min(1, err * 0.05));
    }
  };
  const CTRL = {};
  Object.defineProperty(CTRL, 'pitch', { enumerable: true, get() { compute(); return B.out.pitch; } });
  for (const k of ['roll', 'yaw', 'throttle', 'brakes']) Object.defineProperty(CTRL, k, { enumerable: true, get() { return B.out[k]; } });
  sim.override = CTRL;

  const fireCode = (sim.input.bindings.afoFire || [])[0] || 'Digit3';
  const flareCode = (sim.input.bindings.afoFlare || [])[0] || 'Digit4';
  let firing = false;
  let flareCd = 0;
  let evadeT = 0;

  try {
    await sim.startMode('mission', { id: missionId, role: roleId });
    say(`start ${sim.aircraftType.id} ${missionId}/${roleId} at ${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)} y ${ac.pos.y.toFixed(0)}`);
    B.hdg = ac.heading;
    B.alt = ac.pos.y;
    B.spd = isCaptain ? 75 : 95;

    // Deliberate dive, afo-normal captain's own fail path: nothing else on
    // this mission can fail it, so a real crash is the honest proof.
    let diveArmed = fail && missionId === 'afo-normal' && isCaptain;

    let lastStepId = null;
    while (T < cap) {
      sim.step(0.25, 1 / 30);
      T += 0.25;
      const step = sim.runner.step;
      const stepId = step ? step.id : null;
      if (stepId !== lastStepId) {
        say(`step ${stepId} (${sim.runner.status}) at ${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)} y ${ac.pos.y.toFixed(0)} ias ${ac.ias.toFixed(0)}`);
        lastStepId = stepId;
        shot(`${missionId}-${roleId}-${fail ? 'fail' : 'pass'}-${stepId}`);
      }
      if (ac.crashed) { say(`CRASHED: ${ac.crashReason}`); break; }
      if (sim.runner.status !== 'running') { say(`mission ${sim.runner.status}`); break; }

      // Where to steer: the same point the on-screen arrow points at,
      // including the runner's own look-ahead while the current step names
      // nowhere ("take off", "evade").
      const at = sim.runner.activeTarget();
      B.target = at ? at.pos : null;
      if (B.target && !B.glide && !B.taxi) B.alt = B.target.y;

      if (diveArmed && ac.airborneTime > 6) {
        diveArmed = false;
        say('diving into the sea on purpose (fail path)');
      }
      if (fail && missionId === 'afo-normal' && isCaptain && ac.airborneTime > 6) {
        B.target = null;
        B.alt = -200; // well under the sea: the controller dives for it and never pulls up.
        B.spd = 90;
      }

      // afo-normal / escort fail: close on the airliner itself, not its slot.
      if (fail && missionId === 'afo-normal' && !isCaptain && stepId === 'hold') {
        const air = Cast.castActor('airliner');
        if (air) B.target = air.pos;
      }

      // Landing and taxi switches.
      if (!B.glide && (stepId === 'approach' || stepId === 'land') && !ac.onGround && B.target) {
        B.glide = true;
        // The field's actual runway heading, not whatever heading the
        // aircraft happens to be on at this instant — both AFO missions
        // always land at the one home field (map: 'kestrel').
        B.L = RUNWAY.headingDeg ?? 90;
        B.td.copy(at.pos);
        say(`on the glide for ${B.td.x.toFixed(0)},${B.td.z.toFixed(0)}`);
      }
      if (B.glide) {
        B.spd = 65;
        if (!ac.gearDown) sim.tap('KeyG');
        if (ac.flapStep && ac.flapStep() < 2 && ac.pos.y - B.td.y < 1200) ac.setFlaps(ac.flapStep() + 1);
        if (!B.flare && ac.pos.y - B.td.y < Math.max(10, -ac.vs * 3.5) && !ac.onGround) { B.flare = true; say('flare'); }
      }
      if (stepId === 'taxi') {
        B.taxi = at ? at.pos : null;
      } else {
        B.taxi = null;
      }

      // The attack mission's own tools. afoInfo() is the CAPTAIN-seat
      // feature's own state — always zero from the escort seat, where the
      // drones are read back through castInfo() instead (afo-lead.js's own
      // steps do exactly this split; see afo.browser.js for the same rule).
      if (missionId === 'afo-attack') {
        if (isCaptain) {
          const info = AfoFeat.afoInfo();
          // A little weave while evading, purely cosmetic — the flares are
          // the real defence (see this file's header).
          if (stepId === 'evade') {
            evadeT += 0.25;
            if (!B.glide) B.hdg = ac.heading + Math.sin(evadeT * 0.3) * 20;
          }
          flareCd = Math.max(0, flareCd - 0.25);
          if (!fail && info.missilesInbound > 0 && flareCd <= 0) {
            sim.tap(flareCode);
            flareCd = 3;
            say('flare');
          }
          if (info.failWhy) shot(`${missionId}-${roleId}-${fail ? 'fail' : 'pass'}-missile-hit`);
        } else {
          const info = Cast.castInfo();
          const wantFire = !fail && (stepId === 'join' || stepId === 'warning' || stepId === 'defend') && info.dronesAlive > 0;
          if (wantFire !== firing) { sim.key(fireCode, wantFire); firing = wantFire; }
        }
      }

      if (T % 20 < 0.25) say(`… at ${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)} y ${ac.pos.y.toFixed(0)} ias ${ac.ias.toFixed(0)} hdg ${ac.heading.toFixed(0)}`);
    }
    if (firing) sim.key(fireCode, false);
    shot(`${missionId}-${roleId}-${fail ? 'fail' : 'pass'}-end`);
  } finally {
    sim.override = null;
    sim.renderer.render = realRender;
    if (firing) sim.key(fireCode, false);
  }
  const status = sim.runner.status;
  return {
    ok: fail ? status === 'failed' : status === 'complete',
    missionId, roleId, fail, status, seconds: T,
    score: sim.runner.data ? sim.runner.data.score : null,
    crashed: ac.crashed, crashReason: ac.crashReason,
    log, shots: pics,
  };
}
