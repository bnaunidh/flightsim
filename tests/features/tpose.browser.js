/**
 * T-Pose Harrison in the real game, through the real keys (sim.key / sim.tap
 * dispatch the same KeyboardEvents a keyboard does). Called from
 * aircrew.browser.js, which owns his air-team cousins.
 *
 *   FLOATING     no board, no wheels drawn; parked he hovers clear of the
 *                runway; the first flight says, once, which keys are his.
 *   FLAP ARMS    F / V (and the FLAPS pad on a tablet) move his arms.
 *   SPIN CLIMB   T: he swings up, spins and climbs to 500 kt; the smoke
 *                trail does NOT come on; the follow camera and his head view
 *                stay upright; T again and he levels off; the camera goes
 *                back to the game's.
 *   BOOST        P P P: 1000 kt, the vapour and shock cones, the boom, no
 *                OVERSPEED, and the autopilot never flipped; P P P again (or
 *                idle) and he slows down; a single P is still the autopilot.
 *   TABLET       SPIN and BOOST buttons in Harrison only.
 *   GETTING OUT  O on the ground: he stands up, his floating self is gone and
 *                a ring marks the spot; O there and he floats again. Enter in
 *                the air: his own parachute, the flight ends (no empty
 *                Harrison, no crash), he lands T-posing; no self-destruct.
 *   CARD         his portrait is the floating pose.
 */

async function load(path) {
  try {
    return await import(path);
  } catch (e) {
    return { __error: String((e && e.message) || e) };
  }
}

export async function checkHarrison(sim, r, say = () => {}) {
  say('tpose: loading');
  const TP = await load('../../src/features/tpose.js');
  const EJ = await load('../../src/features/eject.js');
  const OF = await load('../../src/features/onfoot.js');
  const FUN = await load('../../src/features/fun.js');
  const PH = await load('../../src/aircraft/physics.js');
  const TERR = await load('../../src/world/terrain.js');
  const TOUCH = await load('../../src/ui/touch.js');
  const THREE = await load('../../src/vendor/three.module.js');
  const loaded = !!(TP.harrison && EJ.eject && OF.onFoot && FUN.__test && PH.SPEC && TERR.heightAt && TOUCH.TouchControls && THREE.Vector3);
  r.ok('tpose: its modules load', loaded, [TP, EJ, OF, FUN, PH, TERR, TOUCH].map((m) => m && m.__error).filter(Boolean).join(' | '));
  if (!loaded) return r;
  const H = TP.harrison;
  const E = EJ.eject;
  const foot = OF.onFoot;
  const F = FUN.__test.F;
  const KT = 1.94384;
  const dt = 1 / 60;
  const run = (secs, each) => {
    const n = Math.round(secs / dt);
    for (let i = 0; i < n; i++) {
      sim.update(dt);
      if (each && each(i * dt) === true) return true;
    }
    return false;
  };
  const toasts = () => [...document.querySelectorAll('.hud-toast')].map((t) => t.textContent);
  const lastToast = () => toasts().slice(-1)[0] || '';
  /** The camera's roll off the horizon, degrees: 0 is upright. */
  const camRoll = () => {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(sim.camera.quaternion);
    return (Math.asin(Math.max(-1, Math.min(1, right.y))) * 180) / Math.PI;
  };
  const visibleMeshes = (root) => {
    let n = 0;
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (let q = o; q; q = q.parent) if (!q.visible) return;
      n++;
    });
    return n;
  };
  const lowestAboveGround = () => {
    const box = new THREE.Box3();
    const one = new THREE.Box3();
    sim.model.updateMatrixWorld(true);
    sim.model.traverse((o) => {
      if (!o.isMesh) return;
      for (let q = o; q; q = q.parent) if (!q.visible) return;
      one.makeEmpty();
      one.expandByObject(o, true);
      box.union(one);
    });
    return box.min.y - TERR.heightAt(sim.aircraft.pos.x, sim.aircraft.pos.z);
  };

  /* ================================================================ */
  say('tpose: floating on the runway');
  try {
    localStorage.removeItem('islandsim.harrison.hint.v1');
  } catch (e) {
    /* private mode: the hint just shows */
  }
  await sim.startMode('free', { aircraft: 'tpose', taxi: false });
  run(1.5);
  const ac = sim.aircraft;
  let bad = [];
  sim.model.traverse((o) => {
    if (o.isMesh && /board|wheel|tyre|rocket|flame|nozzle|deck/i.test(o.name)) bad.push(o.name);
  });
  let lo = Infinity;
  let hi = -Infinity;
  run(2.5, () => {
    const g = lowestAboveGround();
    lo = Math.min(lo, g);
    hi = Math.max(hi, g);
  });
  r.ok('tpose: no board, no wheels drawn — parked, he floats clear of the runway, level, bobbing', bad.length === 0 && ac.onGround && lo > 0.12 && hi < 0.4 && hi - lo > 0.015 && Math.abs(ac.bankAngleDeg()) < 0.5,
    `${bad.join(',') || 'nothing but him'}; ${lo.toFixed(2)}..${hi.toFixed(2)} m of air under him`);
  r.ok('tpose: the first time you fly him, one line says his keys', toasts().some((t) => /spin climb/i.test(t) && /boost/i.test(t)), toasts().join(' | '));

  /* ================================================================ */
  say('tpose: flap arms (F / V)');
  const arm = () => sim.model.userData.arms.right;
  sim.tap('KeyF');
  run(0.5);
  const beat1 = Math.abs(arm().droop);
  run(3);
  const n1 = arm().droop;
  // A tenth of a second apart: a key held down is one press, and three taps
  // inside the same frame are one press too (the keybinds input counts a key
  // once per frame) — nobody's fingers are that fast.
  sim.tap('KeyF');
  run(0.1);
  sim.tap('KeyF');
  run(6);
  const n3 = arm().droop;
  const cup = { elbow: arm().elbow, wrist: arm().wrist };
  sim.tap('KeyV');
  run(0.1);
  sim.tap('KeyV');
  run(0.1);
  sim.tap('KeyV');
  run(6);
  const up = arm();
  r.ok('tpose: the flap keys move his arms — a beat as they go, cupped further each notch, dead-straight T again flaps up',
    ac.flapStep() === 0 && n1 > 0.05 && n3 > n1 + 0.06 && cup.elbow > 0 && cup.wrist > 0 && Math.abs(up.droop) < 0.01 && Math.abs(up.elbow) < 0.01 && beat1 > 0.01,
    `notch 1 ${n1.toFixed(2)} rad, notch 3 ${n3.toFixed(2)} rad (elbow ${cup.elbow.toFixed(2)}, wrist ${cup.wrist.toFixed(2)}), flaps up ${up.droop.toFixed(3)}`);

  /* ================================================================ */
  say('tpose: the tablet (SPIN, BOOST, FLAPS)');
  const hadTouch = sim.touch;
  let tc = null;
  if (!hadTouch) {
    tc = new TOUCH.TouchControls(sim.hud.wrap, { input: sim.input, onAction: (a) => sim.hudAction(a) });
    sim.touch = tc;
    sim.hud.wrap.classList.add('is-touch');
  }
  run(0.3);
  const ui1 = H.ui.snapshot();
  sim.hudAction('flaps');
  run(2.5);
  const padArms = arm().droop;
  sim.hudAction('flaps');
  sim.hudAction('flaps');
  sim.hudAction('flaps');
  run(4);
  H.ui.press('spin');
  run(0.5);
  const tapSpin = H.moves.mode;
  H.ui.press('spin');
  run(0.2);
  const ui2 = H.ui.snapshot();
  await sim.startMode('free', { aircraft: 'massimo', taxi: false });
  run(0.4);
  const ui3 = H.ui.snapshot();
  if (tc) {
    sim.touch = hadTouch || null;
    sim.hud.wrap.classList.remove('is-touch');
    if (tc.layer && tc.layer.parentNode) tc.layer.parentNode.removeChild(tc.layer);
  }
  r.ok('tpose: on a tablet, SPIN and BOOST buttons show in Harrison only, the FLAPS pad moves his arms, and SPIN spins him',
    ui1.spin && ui1.boost && padArms > 0.05 && tapSpin === 'spin' && ui2.spin && !ui3.spin && !ui3.boost,
    `in Harrison ${JSON.stringify({ spin: ui1.spin, boost: ui1.boost })}, FLAPS pad ${padArms.toFixed(2)} rad, SPIN -> ${tapSpin}; in Massimo ${JSON.stringify({ spin: ui3.spin, boost: ui3.boost })}`);

  /* ================================================================ */
  say('tpose: T — the spin climb');
  await sim.startMode('free', { aircraft: 'tpose', airborne: true, taxi: false });
  run(1);
  sim.rig.setMode('chase');
  const smoke0 = F.smokeOn;
  sim.tap('KeyT');
  run(0.2);
  let maxRoll = 0;
  let vertical = null;
  let spinOn = false;
  let at500 = null;
  run(16, (t) => {
    maxRoll = Math.max(maxRoll, Math.abs(camRoll()));
    if (vertical === null && ac.pitchAngleDeg() > 85) vertical = t;
    if (sim.model.userData.spin().on) spinOn = true;
    if (at500 === null && ac.vel.length() * KT > 499) at500 = t;
  });
  r.ok('tpose: T on Harrison is the spin climb — and never the smoke trail', H.moves.mode === 'spin' && F.smokeOn === smoke0 && !F.smokeOn, `mode ${H.moves.mode}, smoke ${F.smokeOn}`);
  r.ok('tpose: he swings head-up, spins round his own body and climbs straight up at 500 kt',
    vertical !== null && vertical < 3 && spinOn && at500 !== null && Math.abs(ac.vel.length() * KT - 500) < 1.5 && ac.vs > 250,
    `vertical after ${vertical === null ? '—' : vertical.toFixed(1)} s, 500 kt after ${at500 === null ? '—' : at500.toFixed(1)} s, climbing ${ac.vs.toFixed(0)} m/s`);
  r.ok('tpose: the follow camera never spins — it is ours while he climbs, upright the whole time', H.camOwned && maxRoll < 1, `camera roll at most ${maxRoll.toFixed(2)}°`);
  sim.rig.setMode('cockpit');
  let headRoll = 0;
  run(2, () => {
    headRoll = Math.max(headRoll, Math.abs(Math.asin(new THREE.Vector3(1, 0, 0).applyQuaternion(sim.camera.quaternion).y) * 57.3));
  });
  const headHidden = !sim.model.userData.person.userData.rig.head.visible;
  sim.rig.setMode('chase');
  r.ok('tpose: in his head view the horizon stays steady too (and his own head is out of the way)', headRoll < 1 && headHidden, `roll at most ${headRoll.toFixed(2)}°`);
  sim.tap('KeyT');
  let lvl = null;
  run(20, (t) => {
    if (H.moves.mode === 'off' && lvl === null) lvl = t;
    return lvl !== null && !H.camOwned;
  });
  run(0.5);
  r.ok('tpose: T again — the spin stops, he eases back to level flight and the game\'s camera takes back over',
    lvl !== null && !H.camOwned && Math.abs(ac.pitchAngleDeg()) < 15 && !sim.model.userData.spin().on && !ac.crashed,
    `level after ${lvl === null ? '—' : lvl.toFixed(1)} s, pitch ${ac.pitchAngleDeg().toFixed(1)}°, camera ${H.camOwned ? 'still ours' : 'the game\'s'}`);

  /* ================================================================ */
  say('tpose: P P P — the boost');
  await sim.startMode('free', { aircraft: 'tpose', airborne: true, taxi: false });
  run(1);
  const ap0 = sim.autopilot.engaged;
  let apFlips = 0;
  const apWas = { v: ap0 };
  sim.tap('KeyP');
  run(0.1);
  sim.tap('KeyP');
  run(0.1);
  sim.tap('KeyP');
  let at1000 = null;
  const lit = new Set();
  let vap = false;
  let shock = false;
  run(12, (t) => {
    if (sim.autopilot.engaged !== apWas.v) {
      apFlips++;
      apWas.v = sim.autopilot.engaged;
    }
    if (at1000 === null && ac.vel.length() * KT > 999) at1000 = t;
    for (const id of sim.warnings ? sim.warnings.active() : []) lit.add(id);
    if (sim.model.getObjectByName('vapourCone').visible) vap = true;
    if (sim.model.getObjectByName('shockCone').visible) shock = true;
  });
  r.ok('tpose: P P P — 1000 kt along his flight path, and the autopilot never flipped', H.moves.mode === 'boost' && at1000 !== null && apFlips === 0 && sim.autopilot.engaged === ap0,
    `1000 kt after ${at1000 === null ? '—' : at1000.toFixed(1)} s (${(ac.vel.length() * KT).toFixed(0)} kt), autopilot flipped ${apFlips} times`);
  r.ok('tpose: through the sound barrier — a vapour cone, then a shock cone, the boom; no OVERSPEED',
    vap && shock && H.events.includes('boom') && !lit.has('overspeed') && !ac.crashed, `warnings seen: ${[...lit].join(', ') || 'none'}`);
  sim.tap('KeyP');
  run(0.1);
  sim.tap('KeyP');
  run(0.1);
  sim.tap('KeyP');
  run(0.2);
  const easing = H.moves.mode;
  run(14);
  r.ok('tpose: P P P again — he eases back down to his own speeds', easing === 'ease' && H.moves.mode === 'off' && ac.vel.length() * KT < 560 && PH.SPEC.vne * KT < 720,
    `${easing} -> ${H.moves.mode}, ${(ac.vel.length() * KT).toFixed(0)} kt, red line ${(PH.SPEC.vne * KT).toFixed(0)} kt`);
  sim.tap('KeyP');
  run(0.2);
  const notYet = sim.autopilot.engaged;
  run(0.5);
  const apOn = sim.autopilot.engaged;
  sim.tap('KeyP');
  run(0.8);
  r.ok('tpose: a single P is still the autopilot (after a moment, in case two more follow)', notYet === ap0 && apOn === !ap0 && sim.autopilot.engaged === ap0,
    `at 0.2 s ${notYet}, at 0.7 s ${apOn}, after another P ${sim.autopilot.engaged}`);
  // The throttle to idle stops it too.
  sim.tap('KeyP');
  run(0.1);
  sim.tap('KeyP');
  run(0.1);
  sim.tap('KeyP');
  run(3);
  sim.input.throttleTarget = 0;
  run(1);
  r.ok('tpose: pulling the throttle to idle ends the boost', H.moves.mode === 'ease' || H.moves.mode === 'off', H.moves.mode);
  run(12);

  /* ================================================================ */
  say('tpose: getting out on the ground');
  await sim.startMode('free', { aircraft: 'tpose', taxi: false });
  run(1.5);
  sim.tap('KeyO');
  run(1);
  const out = foot.snapshot();
  const gone = visibleMeshes(sim.model) === 0;
  const ring = H.ring && H.ring.visible;
  r.ok('tpose: O on the ground — he stands up and walks as himself, nothing is left hovering, a ring marks his spot',
    out.active && out.outfit === 'harrison' && gone && ring && H.hidden, `${JSON.stringify({ active: out.active, outfit: out.outfit, from: out.from })}, drawn ${!gone ? 'still' : 'nothing'}, ring ${!!ring}`);
  foot.place(sim.aircraft.pos.x, sim.aircraft.pos.z + 2.4, 0);
  run(0.3);
  sim.tap('KeyO');
  run(0.5);
  r.ok('tpose: O back at the ring — he lies down and floats again', !foot.active && visibleMeshes(sim.model) > 8 && !H.ring.visible && !H.hidden, `walking ${foot.active}`);

  /* ================================================================ */
  say('tpose: out in the air');
  await sim.startMode('free', { aircraft: 'tpose', airborne: true, taxi: false });
  run(1);
  sim.tap('Backspace');
  run(0.2);
  const sdWords = lastToast();
  r.ok('tpose: no self-destruct — Harrison is a person', E.selfDestruct.state === 'off' && /person/i.test(sdWords), sdWords);
  sim.tap('KeyT');
  run(2);
  sim.tap('Enter');
  run(0.1);
  sim.tap('Enter');
  run(0.3);
  const crashed0 = ac.crashed;
  run(4);
  const p0 = ac.pos.clone();
  const chute = E.me && E.me.flight;
  r.ok('tpose: Enter, Enter in the air (even mid-spin) — his own parachute, and the flight simply ends: no empty Harrison flying on',
    E.phase === 'out' && E.ended && !E.ghost && E.lastEject.kind === 'jump' && visibleMeshes(sim.model) === 0 && H.moves.mode === 'off' && !crashed0 && chute && chute.open > 0.5
      && chute.pos.distanceTo(p0) < 1,
    `phase ${E.phase}, ended ${E.ended}, ghost ${!!E.ghost}, move ${H.moves.mode}, canopy ${chute ? chute.open.toFixed(2) : '—'}, aeroplane ${chute ? chute.pos.distanceTo(p0).toFixed(2) : '—'} m from him`);
  sim.key('KeyS', true);
  run(90, () => E.phase === 'walking');
  sim.key('KeyS', false);
  run(0.5);
  const hs = foot.snapshot();
  r.ok('tpose: he lands T-posing, nothing crashed, no "Crashed" screen', E.phase === 'walking' && hs.outfit === 'harrison' && !!(foot.model && foot.model.userData.tpose) && !ac.crashed && sim.state === 'flying',
    `phase ${E.phase}, outfit ${hs.outfit}, aeroplane crashed ${ac.crashed}`);
  sim.tap('Enter');
  run(0.5);

  /* ================================================================ */
  say('tpose: his card');
  const card = document.querySelector('[data-fleet-art="tpose"] canvas[data-tpose]');
  r.ok('tpose: his hangar card is the new floating pose', !!card && card.dataset.pose === 'floating', card ? card.dataset.pose : 'no card');
  return r;
}
