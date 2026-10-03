/**
 * The pilot bot for Air Force One's third seat: the President, on foot,
 * never touching a flight control. Model: tests/features/afo.playthrough.js,
 * but steering a walker towards a named spot (src/game/roles/afo-president.js's
 * own SPOTS) instead of flying a heading — the same real key presses
 * (sim.key on the walkForward/walkLeft/walkRight bindings) a person would use.
 *
 *   const { playthrough } = await import('./tests/features/afo-president.playthrough.js');
 *   const out = await playthrough(sim, 'afo-normal');
 *   const out2 = await playthrough(sim, 'afo-attack', { fail: true });
 *
 * `opts.fail` for 'afo-attack' is simply never walking to the secure room:
 * the Secret Service gives up after a while and the mission fails with a
 * kind word (see afo-president.js's own `secureSinceWarn`). 'afo-normal' has
 * no fail path of its own — a calm ride-along, on purpose — so `fail` there
 * just walks the same route; the caller is expected to know that (afo.md's
 * "pass + fail where it applies").
 *
 * @returns {Promise<{ ok, status, seconds, score, log, shots }>}
 */
export async function playthrough(sim, missionId, { fail = false, shots = false, maxSeconds } = {}) {
  const Pres = await import('../../src/game/roles/afo-president.js');
  // Generous, both missions: the schedule's own waits are time-gated (the
  // flight's own out-and-back timeline, measured at up to ~565s for the
  // attack mission in tests/features/afo-president.mjs) rather than pure
  // walking, the same reason afo.playthrough.js gives the escort seat 420s
  // on a 300s par time.
  const cap = maxSeconds || 650;

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

  const B = {
    fwd: (sim.input.bindings.walkForward || [])[0] || 'KeyW',
    left: (sim.input.bindings.walkLeft || [])[0] || 'KeyA',
    right: (sim.input.bindings.walkRight || [])[0] || 'KeyD',
  };
  let heldF = false;
  let heldL = false;
  let heldR = false;
  const set = (code, want, cur) => {
    if (want !== cur) sim.key(code, want);
    return want;
  };

  /** Turn to face `target` and walk, both at once — the same way a person would. @returns {boolean} arrived */
  const walkTo = (target, radius = 0.45) => {
    const w = Pres.walkerPos();
    const dx = target.x - w.x;
    const dz = target.z - w.z;
    const dist = Math.hypot(dx, dz);
    if (dist < radius) {
      heldF = set(B.fwd, false, heldF);
      heldL = set(B.left, false, heldL);
      heldR = set(B.right, false, heldR);
      return true;
    }
    const wantYaw = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
    const err = ((wantYaw - w.yaw + 540) % 360) - 180;
    heldL = set(B.left, err < -6, heldL);
    heldR = set(B.right, err > 6, heldR);
    heldF = set(B.fwd, Math.abs(err) < 70, heldF);
    return false;
  };
  const stopWalk = () => {
    heldF = set(B.fwd, false, heldF);
    heldL = set(B.left, false, heldL);
    heldR = set(B.right, false, heldR);
  };

  /** Which spot (local to the cabin) this step wants the President at, or null to just wait. */
  const SPOT_FOR = {
    call: () => Pres.SPOTS.office,
    brief: () => Pres.SPOTS.conference,
    cockpit: () => Pres.SPOTS.cockpitDoor,
    seatbelt: () => Pres.SPOTS.seat,
    secure: () => Pres.SPOTS.secureInside,
    land: () => Pres.SPOTS.seat,
  };

  try {
    await sim.startMode('mission', { id: missionId, role: 'president' });
    say(`start ${missionId}/president`);
    let lastStepId = null;
    while (T < cap) {
      sim.step(0.25, 1 / 30);
      T += 0.25;
      const step = sim.runner.step;
      const stepId = step ? step.id : null;
      if (stepId !== lastStepId) {
        say(`step ${stepId} (${sim.runner.status})`);
        lastStepId = stepId;
        shot(`${missionId}-president-${fail ? 'fail' : 'pass'}-${stepId}`);
      }
      if (sim.runner.status !== 'running') {
        say(`mission ${sim.runner.status}`);
        break;
      }
      if (fail && missionId === 'afo-attack') {
        // The one deliberate fail path this seat has: never go to the
        // secure room. Stand still in the press section instead.
        stopWalk();
      } else {
        const spotFn = stepId && SPOT_FOR[stepId];
        if (spotFn) walkTo(spotFn());
        else stopWalk();
      }
      if (T % 20 < 0.25) say(`… walker at ${Pres.walkerPos().x.toFixed(1)},${Pres.walkerPos().z.toFixed(1)}`);
    }
    stopWalk();
    shot(`${missionId}-president-${fail ? 'fail' : 'pass'}-end`);
  } finally {
    sim.renderer.render = realRender;
    stopWalk();
  }
  const status = sim.runner.status;
  return {
    ok: fail ? status === 'failed' : status === 'complete',
    missionId, roleId: 'president', fail, status, seconds: T,
    score: sim.runner.data ? sim.runner.data.score : null,
    log, shots: pics,
  };
}
