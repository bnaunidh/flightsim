/**
 * The bug hunt before the class demo (2026-11-02): one check per bug a
 * player hit, each written to fail on the code before its fix.
 *
 *   node .claude/devtools/briefs/one-check.mjs '<url>?mute=1' ./tests/features/bughunt.browser.js check "" 1
 *
 * @param {object} sim   window.__sim
 * @param {object} r     reporter: r.ok(name, pass, detail)
 * @param {function} say logger
 */
const wait = (ms) => new Promise((f) => setTimeout(f, ms));

/** Turn of heading, degrees, -180..180. */
const turned = (a, b) => ((b - a + 540) % 360) - 180;

export async function check(sim, r, say = () => {}) {
  const realRender = sim.renderer.render;
  sim.renderer.render = () => {};
  try {
    await boatRudder(sim, r, say);
    await pausedCrash(sim, r, say);
    await boatPauseCard(sim, r, say);
    await boatAgain(sim, r, say);
    await pauseOnTop(sim, r, say);
    await mouseCapture(sim, r, say);
    await fighterButtonsClear(sim, r, say);
    await rampRestart(sim, r, say);
    await lockOffPause(sim, r, say);
    await crashNoFail(sim, r, say);
    await phoneUpright(sim, r, say);
    await footPauseCard(sim, r, say);
    await noticesOffMenu(sim, r, say);
    await boatRaceRestart(sim, r, say);
    await worldMapCard(sim, r, say);
  } finally {
    sim.renderer.render = realRender;
    sim.override = null;
    if (sim.state !== 'menu') sim.quitToMenu();
  }
}

/*
 * 1. The boat's touch RUDDER bar. The boat's touch layout shows the RUDDER
 * strip beside the wheel, and the strip writes the touch yaw — but the boat
 * steered by roll alone, so dragging it did nothing at all.
 */
async function boatRudder(sim, r) {
  if (sim.state !== 'menu') sim.quitToMenu();
  await wait(50);
  sim.startDrive('boat');
  for (let i = 0; i < 300 && !(sim.vehicle && sim.vehicle.isBoat); i++) await wait(10);
  const v = sim.vehicle;
  if (!v || !v.isBoat) {
    r.ok('bughunt: the boat starts', false, `vehicle ${v && v.kind}`);
    return;
  }
  const input = sim.input;
  const hadTouch = input.touch;
  const touch = hadTouch || { stickHeld: false, roll: 0, pitch: 0, yaw: 0, rudderHeld: false, lever: null, brakes: false };
  input.touch = touch;
  const saved = { yaw: touch.yaw, rudderHeld: touch.rudderHeld, lever: touch.lever };
  try {
    touch.lever = 3; // HALF ahead
    sim.step(6); // under way
    const run = (yaw, held) => {
      touch.yaw = yaw;
      touch.rudderHeld = held;
      const h0 = v.heading;
      sim.step(5);
      return turned(h0, v.heading);
    };
    const straight = run(0, false);
    const right = run(1, true);
    run(0, false);
    const left = run(-1, true);
    r.ok('bughunt: the touch RUDDER bar steers the boat (right and left, against none)',
      Math.abs(right - straight) > 8 && Math.abs(left - straight) > 8 && Math.sign(right - straight) === -Math.sign(left - straight),
      `5 s at half ahead: none ${straight.toFixed(1)}°, rudder right ${right.toFixed(1)}°, rudder left ${left.toFixed(1)}°`);
  } finally {
    Object.assign(touch, saved);
    input.touch = hadTouch;
    sim.quitToMenu();
    await wait(50);
  }
}

/*
 * 2. Esc straight after a crash. The crash debrief waits 2.2 s so the wreck is
 * worth watching; a pause inside that wait made it give up for good, and the
 * player came back to a wreck with no debrief and nothing to press.
 */
async function pausedCrash(sim, r) {
  if (sim.state !== 'menu') sim.quitToMenu();
  await wait(50);
  await sim.startMode('free', { aircraft: 'skylark' });
  for (let i = 0; i < 300 && sim.state !== 'flying'; i++) await wait(10);
  sim.step(1);
  sim.aircraft.crash('bug hunt: a crash on the runway');
  sim.step(0.3);
  sim.pause();
  const paused = sim.state === 'paused';
  await wait(2700); // the debrief's own 2.2 s pass while the pause card is up
  sim.resume();
  sim.step(0.2);
  await wait(1200);
  sim.step(0.2);
  const state = sim.state;
  r.ok('bughunt: a pause straight after a crash does not lose the crash debrief (it comes once the game resumes)',
    paused && state === 'debrief',
    `paused ${paused}; state after resuming ${state}, crashed ${sim.aircraft.crashed}`);
  sim.quitToMenu();
  await wait(50);
}

/*
 * 3. The pause card in the boat. It read the parked aeroplane: its speed,
 * its height, its FUEL and the camera's name, none of them the boat's.
 */
async function boatPauseCard(sim, r) {
  if (sim.state !== 'menu') sim.quitToMenu();
  await wait(50);
  sim.startDrive('boat');
  for (let i = 0; i < 300 && !(sim.vehicle && sim.vehicle.isBoat); i++) await wait(10);
  const v = sim.vehicle;
  if (!v || !v.isBoat) {
    r.ok('bughunt: the boat starts (pause card)', false);
    return;
  }
  v.setLever(4); // FULL
  const touch = sim.input.touch;
  const lever0 = touch ? touch.lever : null;
  if (touch) touch.lever = 4; // a touch layout's lever holds its own detent
  sim.step(8);
  if (touch) touch.lever = lever0;
  const kts = Math.round(v.readouts().speedKts);
  sim.pause();
  const info = sim.menus.screens.pause.querySelector('[data-pause-info]');
  const text = info ? info.textContent.replace(/\s+/g, ' ').trim() : '';
  sim.resume();
  r.ok('bughunt: the pause card in the boat shows the boat (her speed, the engine lever), not the parked aeroplane\'s height and fuel',
    /Engine\s*FULL/i.test(text) && new RegExp(`Speed\\s*${kts} kt`).test(text) && !/Fuel|Height/.test(text) && kts > 2,
    `boat at ${kts} kt; card: ${text}`);
  sim.quitToMenu();
  await wait(50);
}

/*
 * 4. Restart, "Back to the start" and the debrief's "Fly again" in the boat.
 * Each went through the aeroplane's paths: a Free Flight on runway 09 with no
 * boat in it (and the mode still 'drive'), the mission gone. The van had its
 * own way round this (game/jobs.js); the boat had none.
 */
async function boatAgain(sim, r) {
  const M = await import('../../src/game/missions.js');
  const boatMission = (M.MISSIONS.find((m) => m.vehicle === 'boat') || {}).id;
  const looks = () => ({ boat: !!(sim.vehicle && sim.vehicle.isBoat), state: sim.state, mode: sim.mode, run: sim.runner.status, mission: sim.runner.def && sim.runner.def.id, plane: !!(sim.model && sim.model.visible) });
  const settle = async () => {
    for (let i = 0; i < 100 && !(sim.vehicle && sim.state === 'flying'); i++) await wait(10);
    sim.step(1);
  };
  const say = (o) => JSON.stringify(o);
  if (sim.state !== 'menu') sim.quitToMenu();
  await wait(50);
  // Free patrol: pause -> Restart, then pause -> Back to the start.
  sim.startDrive('boat');
  await settle();
  const pos0 = sim.vehicle && { x: sim.vehicle.pos.x, z: sim.vehicle.pos.z };
  if (sim.vehicle) sim.vehicle.setLever(4);
  if (sim.input.touch) sim.input.touch.lever = null;
  sim.step(6);
  sim.pause();
  sim.pauseAction('restart');
  await settle();
  const afterRestart = looks();
  const back = sim.vehicle && pos0 ? Math.hypot(sim.vehicle.pos.x - pos0.x, sim.vehicle.pos.z - pos0.z) : null;
  sim.pause();
  sim.pauseAction('airport');
  await settle();
  const afterAirport = looks();
  // A boat mission: wound to the end, then the debrief's first button.
  let afterAgain = null;
  let againLabel = null;
  if (boatMission) {
    sim.quitToMenu();
    await wait(50);
    sim.startAnyMission(boatMission);
    for (let i = 0; i < 300 && sim.runner.status !== 'running'; i++) await wait(10);
    sim.step(1);
    for (let g = 0; g < 40 && sim.runner.status === 'running'; g++) {
      sim.runner.skipStep();
      sim.step(0.5);
    }
    await wait(100);
    const again = [...sim.menus.screens.debrief.querySelectorAll('button')][0];
    againLabel = again ? again.textContent.trim() : null;
    if (again) again.click();
    for (let i = 0; i < 300 && sim.runner.status !== 'running'; i++) await wait(10);
    await settle();
    afterAgain = looks();
  }
  const ok = (o) => o && o.boat && o.state === 'flying' && o.mode === 'drive' && !o.plane;
  r.ok('bughunt: in the boat, pause -> Restart and pause -> Back to the start put you back in the boat at her start (not the aeroplane on runway 09)',
    ok(afterRestart) && ok(afterAirport) && back !== null && back < 5,
    `after Restart ${say(afterRestart)} (${back === null ? '?' : back.toFixed(1)} m from her start); after Back to the start ${say(afterAirport)}`);
  r.ok('bughunt: a boat mission\'s debrief "Sail again" (not "Fly again") runs the same mission again, in the boat',
    !boatMission || (ok(afterAgain) && afterAgain.run === 'running' && afterAgain.mission === boatMission && againLabel === 'Sail again'),
    `${boatMission}: button "${againLabel}", then ${say(afterAgain)}`);
  sim.quitToMenu();
  await wait(50);
}

/*
 * 5. The pause card on top of the HUD. The state pills ("Parking brake on —
 * tap to release", z-index 2 in #ui) and the carrier's HOOK / LAUNCH buttons
 * (the feature layer; their gate only ran while flying) stayed over the pause
 * card, so a tap on one of its rows hit them instead.
 */
async function pauseOnTop(sim, r) {
  if (sim.state !== 'menu') sim.quitToMenu();
  await wait(50);
  await sim.startMode('free', { aircraft: 'f22' });
  for (let i = 0; i < 300 && sim.state !== 'flying'; i++) await wait(10);
  sim.step(1);
  // The parking brake on, as a fighter at the gate starts (ui/pills.js).
  if (!sim.aircraft.parkingBrake && typeof sim.hudAction === 'function') {
    sim.aircraft.parkingBrake = true;
  }
  sim.step(1);
  const co = document.querySelector('.co-root');
  const coShownFlying = !!co && getComputedStyle(co).display !== 'none';
  sim.pause();
  await wait(400); // the carrier's quarter-second gate
  const pill = [...document.querySelectorAll('.hud-pill')].find((p) => p.getBoundingClientRect().width > 4);
  let pillOnTop = null;
  if (pill) {
    const b = pill.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    pillOnTop = !!hit && (hit === pill || pill.contains(hit));
  }
  const coShownPaused = !!co && getComputedStyle(co).display !== 'none';
  sim.resume();
  sim.step(0.5);
  const coBack = !!co && getComputedStyle(co).display !== 'none';
  r.ok('bughunt: the pause card is on top: no HUD pill and no carrier HOOK button over its rows',
    pillOnTop !== true && !coShownPaused && (!coShownFlying || coBack),
    `pill ${pill ? pill.textContent.trim().slice(0, 40) : 'none'} on top ${pillOnTop}; carrier layer flying ${coShownFlying}, paused ${coShownPaused}, back ${coBack}`);
  sim.quitToMenu();
  await wait(50);
}

/*
 * 6. "Fly with the mouse (click the sky to capture the pointer)". Ticking it
 * captured the pointer at once, on the Settings screen (the cursor went, and
 * only Esc brought it back), and a click on the sky never captured it.
 */
async function mouseCapture(sim, r) {
  if (sim.state !== 'menu') sim.quitToMenu();
  await wait(50);
  const dom = sim.input.dom;
  const real = dom.requestPointerLock;
  const was = !!sim.settings.mouseFlying;
  let asks = 0;
  dom.requestPointerLock = function () { asks++; return Promise.resolve(); };
  let onMenu = null;
  let onSky = null;
  try {
    sim.menus.show('settings');
    const box = sim.menus.screens.settings.querySelector('[data-set="mouseFlying"]');
    if (box.checked) { box.checked = false; box.dispatchEvent(new Event('input', { bubbles: true })); }
    asks = 0;
    box.checked = true;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    onMenu = asks;
    sim.menus.show('main');
    await sim.startMode('free', { aircraft: 'skylark' });
    for (let i = 0; i < 300 && sim.state !== 'flying'; i++) await wait(10);
    sim.step(0.5);
    asks = 0;
    dom.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, clientX: innerWidth / 2, clientY: innerHeight / 3 }));
    onSky = asks;
  } finally {
    dom.requestPointerLock = real;
    sim.applySetting('mouseFlying', was);
    const box = sim.menus.screens.settings.querySelector('[data-set="mouseFlying"]');
    if (box) box.checked = was;
  }
  r.ok('bughunt: mouse flying: ticking it in Settings does not take the cursor away there; a click on the sky captures it',
    onMenu === 0 && onSky === 1, `pointer-lock requests: from the Settings tick ${onMenu}, from a click on the sky ${onSky}`);
  sim.quitToMenu();
  await wait(50);
}

/*
 * 7. The feature buttons off the touch pads, and off each other. FIRE MSL,
 * FLARES, the carrier's HOOK, the meteor ZAP and T-Pose's SPIN / BOOST sit
 * at fixed spots; on a Chromebook with a touchscreen (1366x768) FIRE covered
 * BRAKES, HOOK and BOOST covered STOP, and ZAP met HOOK in the Osprey. Only
 * on a touch layout (a desktop browser has no pads to cover): run it with
 * touch emulation to see it bite.
 */
async function fighterButtonsClear(sim, r) {
  const box = (el) => {
    if (!el || el.hidden) return null;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return b.width < 4 || b.height < 4 || cs.display === 'none' || cs.visibility === 'hidden' ? null : b;
  };
  const name = (el) => (el.getAttribute('aria-label') || el.textContent || el.className).replace(/\s+/g, ' ').trim().slice(0, 24);
  const hits = (a, k) => a.left < k.right - 2 && a.right > k.left + 2 && a.top < k.bottom - 2 && a.bottom > k.top + 2;
  const over = [];
  let layer = null;
  let up = 0;
  for (const run of [{ aircraft: 'f22' }, { aircraft: 'tpose' }, { mission: 'meteor-shower' }]) {
    if (sim.state !== 'menu') sim.quitToMenu();
    await wait(50);
    if (run.mission) sim.startAnyMission(run.mission);
    else await sim.startMode('free', { aircraft: run.aircraft });
    for (let i = 0; i < 1500 && sim.state !== 'flying'; i++) await wait(10);
    // As they come up: no waiting for the twice-a-second re-measure.
    sim.step(1);
    clearTimeout(sim._crashDebriefT);
    layer = document.querySelector('.hud.is-touch .touch-layer');
    if (!layer) break;
    const ours = [...document.querySelectorAll('#ext-layer button')].filter((b) => box(b));
    up += ours.length;
    // The pads one by one, and the other controls whole.
    const controls = [...layer.querySelectorAll('.touch-pads > *')].concat([...layer.children].filter((c) => !c.classList.contains('touch-pads')));
    for (const b of ours) {
      const a = box(b);
      for (const c of controls) {
        const k = box(c);
        if (k && hits(a, k)) over.push(`${run.aircraft || run.mission}: ${name(b)} on ${name(c)}`);
      }
    }
    for (let i = 0; i < ours.length; i++) {
      for (let j = i + 1; j < ours.length; j++) {
        if (ours[i].contains(ours[j]) || ours[j].contains(ours[i]) || ours[i].parentNode === ours[j].parentNode) continue;
        if (hits(box(ours[i]), box(ours[j]))) over.push(`${run.aircraft || run.mission}: ${name(ours[i])} on ${name(ours[j])}`);
      }
    }
  }
  r.ok('bughunt: the feature buttons (FIRE MSL, FLARES, HOOK, ZAP, SPIN, BOOST) cover none of the touch pads, nor each other',
    over.length === 0,
    layer ? `${innerWidth}x${innerHeight}, ${up} buttons up in the F-22, T-Pose and the meteor shower: ${over.join('; ') || 'clear'}` : 'not a touch layout here (nothing to cover)');
  sim.quitToMenu();
  await wait(50);
}

/*
 * 8. Restart on the ramp crew's shift starts the shift over (staff.js
 * startMode: on foot at the start, the first job), as it did before the boat
 * fix: restartDrive() is the boat's and the van's, and for the tug it put you
 * back in the tug where you had got in, mid-shift.
 */
export async function rampRestart(sim, r) {
  if (sim.state !== 'menu') sim.quitToMenu();
  await wait(50);
  const SF = await import('../../src/features/staff.js');
  const OF = await import('../../src/features/onfoot.js');
  const staff = SF.staff;
  await sim.startMode('free', { aircraft: 'skylark', taxi: false });
  sim.step(0.5);
  const opened = staff.start(sim);
  for (let i = 0; i < 20; i++) sim.step(0.2);
  const inTug = opened && staff.drive(sim, 'tug');
  for (let i = 0; i < 10; i++) sim.step(0.2);
  const before = { foot: OF.onFoot.active, veh: sim.vehicle && sim.vehicle.spec && sim.vehicle.spec.id };
  sim.pause();
  await wait(50);
  const b = document.querySelector('.menu-layer [data-act="restart"]');
  if (b) b.click();
  // startMode is async (Restart goes through it): wait for the flight state, then let the shift's walk begin.
  for (let i = 0; i < 300 && sim.state !== 'flying'; i++) await wait(10);
  for (let i = 0; i < 10; i++) {
    sim.step(0.2);
    await wait(10);
  }
  const after = { state: sim.state, mode: sim.mode, foot: OF.onFoot.active, shift: staff.active, job: staff.job };
  r.ok('bughunt: Restart on the ramp crew\'s shift starts the shift over (on foot at the start), not back in the tug',
    !!inTug && before.foot === false && after.state === 'flying' && after.mode === 'drive' && after.shift && after.foot === true,
    `in the tug ${JSON.stringify(before)}; after Restart ${JSON.stringify(after)}`);
  sim.quitToMenu();
  await wait(50);
}

/*
 * 9. The gunsight's LOCK button (ext layer, over the menus) stayed up over the
 * pause card in a fighter in the air: its update() only runs in flight. It is
 * put away while paused and is back on resume.
 */
export async function lockOffPause(sim, r) {
  if (sim.state !== 'menu') sim.quitToMenu();
  await wait(50);
  // The button is a touch one (display: none on a desktop): look at it as a touch screen shows it.
  const root = document.documentElement;
  const hadTouch = root.classList.contains('is-touch-device');
  root.classList.add('is-touch-device');
  try {
    await sim.startMode('free', { aircraft: 'f22', airborne: true, taxi: false });
    for (let i = 0; i < 300 && sim.state !== 'flying'; i++) await wait(10);
    sim.step(0.5);
    const btn = document.querySelector('#ext-layer .gsk-btn.is-lock');
    const seen = () => !!btn && !btn.hidden && getComputedStyle(btn).display !== 'none' && btn.getBoundingClientRect().width > 4;
    const upFlying = seen();
    sim.pause();
    await wait(300);
    const gonePaused = sim.state === 'paused' && !seen();
    sim.resume();
    sim.step(0.2);
    const back = sim.state === 'flying' && seen();
    r.ok('bughunt: the gunsight LOCK button is put away while paused (not over the pause card) and back on resume',
      upFlying && gonePaused && back, `flying ${upFlying}, paused gone ${gonePaused}, resumed ${back}`);
  } finally {
    if (!hadTouch) root.classList.remove('is-touch-device');
  }
  sim.quitToMenu();
  await wait(50);
}

/*
 * 10. A crash in a run that a crash does not fail (failOnCrash: false: Flight
 * School, Meteor Shower, On Call) showed nothing: the runner was still
 * running, so the crash screen stood aside for a mission ending that never
 * came. A wreck and nothing to press. The crash screen comes, and its Try
 * again starts the same run.
 */
export async function crashNoFail(sim, r) {
  const got = [];
  for (const id of ['tutorial', 'meteor-shower']) {
    if (sim.state !== 'menu') sim.quitToMenu();
    await wait(50);
    if (id === 'tutorial') sim.startMode('tutorial');
    else sim.startAnyMission(id);
    for (let i = 0; i < 400 && sim.state !== 'flying'; i++) await wait(10);
    sim.step(1);
    sim.aircraft.crash('bug hunt: a crash that does not fail the run');
    for (let i = 0; i < 60 && sim.state === 'flying'; i++) {
      sim.step(0.1);
      await wait(60);
    }
    const scr = document.querySelector('.menu-layer [data-screen="debrief"]:not([hidden])');
    const btn = scr && [...scr.querySelectorAll('button')].find((b) => /try again/i.test(b.textContent));
    const shown = sim.state === 'debrief' && !!btn;
    if (btn) btn.click();
    for (let i = 0; i < 400 && sim.state !== 'flying'; i++) await wait(10);
    sim.step(0.2);
    const again = sim.state === 'flying' && !sim.aircraft.crashed && sim.runner.status === 'running' && !!sim.runner.def && sim.runner.def.id === id;
    got.push({ id, shown, again, state: sim.state });
  }
  r.ok('bughunt: a crash in Flight School or the Meteor Shower (no fail on a crash) gets the crash screen, and Try again starts it again',
    got.every((g) => g.shown && g.again), JSON.stringify(got));
  sim.quitToMenu();
  await wait(50);
}

/*
 * 11. A phone held upright (375 x 812, 390 x 844), on the ground, on a touch
 * load. The helicopter's card brings the objective down past half-way, the
 * column under it was measured from the objective's first line only, and the
 * Races chip sat on the objective; a fighter's FLARES sat on the "Parking
 * brake on" pill; the Fun chip covered half of "Tap here to get out"; and a
 * card arriving in the column slid in from 14 px out, past a 6 px gap, off
 * the right edge. Only on a touch layout under 560 px wide: run it with
 * phone emulation to see it bite.
 */
export async function phoneUpright(sim, r) {
  const box = (el) => {
    if (!el || el.hidden) return null;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return b.width < 4 || b.height < 4 || cs.display === 'none' || cs.visibility === 'hidden' ? null : b;
  };
  const hits = (a, k) => !!a && !!k && a.left < k.right - 1 && a.right > k.left + 1 && a.top < k.bottom - 1 && a.bottom > k.top + 1;
  const R = (b) => (b ? `${Math.round(b.left)},${Math.round(b.top)}..${Math.round(b.right)},${Math.round(b.bottom)}` : '-');
  const start = async (aircraft, game) => {
    if (sim.state !== 'menu') sim.quitToMenu();
    await wait(50);
    if (typeof sim.switchGame === 'function') sim.switchGame(game);
    await sim.startMode('free', { aircraft, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 250 });
    for (let i = 0; i < 300 && sim.state !== 'flying'; i++) await wait(10);
    clearTimeout(sim._crashDebriefT);
    for (let i = 0; i < 30; i++) sim.step(1 / 30);
    await wait(100);
  };
  const phone = () => !!document.querySelector('.hud.is-touch') && innerWidth <= 560;
  if (!phone()) {
    await start('skylark', 'flight');
    const is = phone();
    sim.quitToMenu();
    if (!is) {
      r.ok('bughunt: a phone held upright: the objective, Races, FLARES, the brake pill, the Fun chip and "Tap here to get out" clear of each other, and on the screen', true, `not a phone held upright here (${innerWidth}x${innerHeight})`);
      return;
    }
  }
  const bad = [];
  // The helicopter: the column starts under the whole objective.
  await start('harrier', 'heli');
  for (let i = 0; i < 8; i++) sim.step(0.5);
  const stack = sim.hud && sim.hud.stack;
  if (stack && stack.touchTop) stack.touchTop();
  sim.step(0.5);
  await wait(400); // the column's own glide to its place
  const obj = box(document.querySelector('#ui .hud-top'));
  const col = stack && stack.el && stack.el.getBoundingClientRect();
  if (obj && col && obj.left < col.right && obj.right > col.left && obj.top < innerHeight * 0.5 && col.top < obj.bottom) bad.push(`heli: the column starts at y ${Math.round(col.top)}, on the objective ${R(obj)}`);
  const races = box(document.querySelector('.race-solobar'));
  if (hits(races, obj)) bad.push(`heli: Races ${R(races)} on the objective ${R(obj)}`);
  const radio = box(document.querySelector('#ui .hud-subtitle'));
  if (hits(races, radio)) bad.push(`heli: Races ${R(races)} on the radio line ${R(radio)}`);
  // A card arriving in the column slides in from no further out than the gap to the edge.
  if (stack && stack.el) {
    const d = document.createElement('div');
    d.style.height = '20px';
    const had = stack.el.classList.contains('rs-anim');
    stack.el.classList.add('rs-anim');
    stack.el.appendChild(d);
    const a = d.getAnimations ? d.getAnimations()[0] : null;
    if (a) {
      a.pause();
      a.currentTime = 0;
    }
    const b = d.getBoundingClientRect();
    if (b.right > innerWidth + 0.5) bad.push(`a card sliding into the column starts at x ${Math.round(b.left)}..${Math.round(b.right)}, past the screen's ${innerWidth}`);
    d.remove();
    if (!had) stack.el.classList.remove('rs-anim');
  }
  // A fighter at the gate: FLARES and FIRE MSL off the parking-brake pill.
  await start('f22', 'flight');
  sim.aircraft.parkingBrake = true;
  for (let i = 0; i < 4; i++) sim.step(0.5);
  await wait(50);
  const pill = box(document.querySelector('.hud-pills'));
  for (const sel of ['#ext-layer .is-flare', '#ext-layer .is-fire']) {
    const k = box(document.querySelector(sel));
    if (hits(k, pill)) bad.push(`f22: ${sel.split('.').pop()} ${R(k)} on the pill ${R(pill)}`);
  }
  if (!pill) bad.push('f22: no parking-brake pill to look at');
  // Stopped on the ground: "Tap here to get out", and the Fun chip off it.
  await start('skylark', 'flight');
  for (let i = 0; i < 10; i++) sim.step(0.5);
  await wait(50);
  const prompt = box(document.querySelector('.of-prompt.on'));
  const chip = box(document.querySelector('.fun-chip'));
  if (!prompt) bad.push('skylark: no "Tap here to get out" to look at');
  if (hits(chip, prompt)) bad.push(`skylark: the Fun chip ${R(chip)} on "Tap here to get out" ${R(prompt)}`);
  r.ok('bughunt: a phone held upright: the objective, Races, FLARES, the brake pill, the Fun chip and "Tap here to get out" clear of each other, and on the screen',
    bad.length === 0, `${innerWidth}x${innerHeight}: ${bad.join('; ') || 'clear'}`);
  sim.quitToMenu();
  await wait(50);
}

/*
 * 12. The pause card on foot read the parked aeroplane: its speed, height and
 * fuel (as the boat's did before f68da01a). It reads the walker now.
 */
export async function footPauseCard(sim, r) {
  if (sim.state !== 'menu') sim.quitToMenu();
  await wait(50);
  const OF = await import('../../src/features/onfoot.js');
  await sim.startMode('free', { aircraft: 'skylark', taxi: false });
  for (let i = 0; i < 300 && sim.state !== 'flying'; i++) await wait(10);
  sim.step(2);
  const why = OF.onFoot.getOut(sim);
  for (let i = 0; i < 10; i++) sim.step(0.2);
  const walking = OF.onFoot.active;
  sim.pause();
  const info = sim.menus.screens.pause.querySelector('[data-pause-info]');
  const text = info ? info.textContent.replace(/\s+/g, ' ').trim() : '';
  sim.resume();
  r.ok('bughunt: the pause card on foot shows the walker (on foot, walked, the aeroplane\'s distance), not the parked aeroplane\'s height and fuel',
    walking && /On foot\s*(Standing|Walking|Running|Paddling)/.test(text) && /Aeroplane\s*\d+ m away/.test(text) && !/Fuel|Height/.test(text),
    `on foot ${walking}${why ? ` (${why})` : ''}; card: ${text}`);
  sim.quitToMenu();
  await wait(50);
}

/*
 * 13. Notices raised just before quitting ("Braking action POOR", "7 more
 * coming out of the blast door") went on over the menu's title for their
 * last seconds (and the flight's own first notices with them). The
 * flight's notices end with it; an achievement stays.
 */
export async function noticesOffMenu(sim, r) {
  if (sim.state !== 'menu') sim.quitToMenu();
  await wait(50);
  await sim.startMode('free', { aircraft: 'skylark' });
  for (let i = 0; i < 300 && sim.state !== 'flying'; i++) await wait(10);
  sim.step(0.5);
  sim.hud.notify('Braking action POOR — ice. Brake gently and expect a long roll.', 'warn', 6);
  sim.hud.notify('7 more coming out of the blast door.', 'info', 4);
  sim.hud.notify('<div class="ach-toast">Achievement unlocked: bug hunt</div>', 'unlock', 3);
  sim.step(0.1);
  sim.quitToMenu();
  await wait(100);
  const up = [...document.querySelectorAll('.hud-toast:not(.is-out)')]
    .filter((t) => t.getClientRects().length && getComputedStyle(t).display !== 'none')
    .map((t) => t.textContent.replace(/\s+/g, ' ').trim().slice(0, 40));
  r.ok('bughunt: notices raised just before quitting are gone from the menu (an achievement stays)',
    sim.state === 'menu' && up.length > 0 && up.every((t) => /bug hunt/.test(t)),
    `on the menu: ${JSON.stringify(up)}`);
  for (const e of sim.hud.toasts.splice(0)) e.node.remove();
}

/*
 * 14. Restart after a boat race. The race borrows the course's island
 * (Coral Lagoon) and puts the boat menu's own island back in its memory, so
 * Restart (and Back to the start) built the boat menu's island instead and
 * put the boat there. She restarts on the island she is on.
 */
export async function boatRaceRestart(sim, r) {
  if (sim.state !== 'menu') sim.quitToMenu();
  await wait(50);
  const RC = await import('../../src/features/race.js');
  const MP = await import('../../src/world/maps.js');
  const other = (MP.MAPS.find((m) => m.game === 'boat' && m.id !== 'lagoon') || {}).id;
  const had = sim.gameMap && { has: 'boat' in sim.gameMap, map: sim.gameMap.boat };
  const settle = async () => {
    for (let i = 0; i < 1500 && !(sim.vehicle && sim.vehicle.isBoat && sim.state === 'flying'); i++) await wait(10);
    sim.step(1);
  };
  let got = null;
  try {
    if (sim.gameMap && other) sim.gameMap.boat = other;
    await RC.raceAlone(sim, 'boat');
    await settle();
    const inRace = sim.settings.map;
    sim.step(2);
    sim.pause();
    sim.pauseAction('restart');
    await settle();
    const afterRestart = sim.settings.map;
    sim.pause();
    sim.pauseAction('airport');
    await settle();
    got = { other, inRace, afterRestart, afterAirport: sim.settings.map, boat: !!(sim.vehicle && sim.vehicle.isBoat) };
  } finally {
    sim.quitToMenu();
    if (had) {
      if (had.has) sim.gameMap.boat = had.map;
      else delete sim.gameMap.boat;
    }
  }
  r.ok('bughunt: after a boat race, Restart and Back to the start keep the boat on the course\'s island (not the boat menu\'s own)',
    !!other && got && got.boat && got.inRace === 'lagoon' && got.afterRestart === 'lagoon' && got.afterAirport === 'lagoon',
    JSON.stringify(got));
  await wait(50);
}

/*
 * 15. Picking the World Map on the menu held the thread ~6 s on a Chromebook
 * with nothing on screen to say so: it read as frozen. A calm card goes up
 * and is painted before the build (the build runs a task after a frame), a
 * key pressed meanwhile lands on nothing, and the card goes after the build
 * — after a throwing one too.
 */
export async function worldMapCard(sim, r) {
  if (sim.state !== 'menu') sim.quitToMenu();
  await wait(50);
  const WP = await import('../../src/features/world-preview.js');
  const before = sim.settings.map;
  const real = sim.buildWorld;
  const seen = [];
  let boom = false;
  const swallow = (e) => { if (/bughunt: a build that throws/.test(String(e.message))) e.preventDefault(); };
  addEventListener('error', swallow);
  const card = () => document.querySelector('.map-wait');
  const one = async (fail) => {
    let atBuild = null;
    sim.buildWorld = function (...a) {
      const c = card();
      atBuild = { up: !!c && c.isConnected && getComputedStyle(c).display !== 'none', text: c ? c.textContent : '' };
      if (fail) { boom = true; throw new Error('bughunt: a build that throws'); }
      return real.apply(this, a);
    };
    WP.choosePreview(sim);
    const upAtOnce = !!card();
    const key = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(key);
    for (let i = 0; i < 1500 && !atBuild; i++) await wait(10);
    sim.buildWorld = real;
    await wait(600);
    seen.push({ fail, upAtOnce, keyEaten: key.defaultPrevented, atBuild, goneAfter: !card(), state: sim.state });
  };
  try {
    await one(false);
    await one(true);
  } finally {
    sim.buildWorld = real;
    removeEventListener('error', swallow);
    sim.setMap(before && before !== 'world-preview' ? before : 'kestrel');
    await wait(400);
  }
  r.ok('bughunt: picking the World Map puts up a calm "Loading the World Map" card before the build, eats keys meanwhile, and takes it down after (a throwing build too)',
    seen.length === 2 && seen.every((x) => x.upAtOnce && x.keyEaten && x.atBuild && x.atBuild.up && /Loading the World Map/.test(x.atBuild.text) && x.goneAfter && x.state === 'menu') && boom,
    JSON.stringify(seen));
}
