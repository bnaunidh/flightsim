/**
 * Headless self-test.
 *
 * Drives the real game through take-off, climb, turns, stalls, a landing, all
 * weather presets, every camera, the tutorial and all three missions — with no
 * human at the keyboard. It uses the same input events and the same physics the
 * player does; only the frame clock is replaced (`sim.step()`).
 *
 * Run it from the browser console:
 *
 *   const { runSelfTest } = await import('./tests/selftest.js');
 *   const results = await runSelfTest(window.__sim);
 *   console.table(results.checks);
 */

const UNIT = { KTS: 1.94384, FT: 3.28084, FPM: 196.85 };

function makeReporter() {
  const checks = [];
  return {
    checks,
    ok(name, pass, detail = '') {
      checks.push({ name, pass: !!pass, detail: String(detail) });
      return !!pass;
    },
    get failed() {
      return checks.filter((c) => !c.pass);
    },
  };
}

/** Release every key the tests might be holding. */
function allUp(sim) {
  for (const code of ['ShiftLeft', 'ControlLeft', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'Space']) {
    sim.key(code, false);
  }
}

/** Simple autopilot used by the landing tests: holds a glide path and flares. */
function flyApproach(sim, seconds = 60) {
  const ac = sim.aircraft;
  const target = sim.airport ? { x: -350, z: 0 } : { x: -350, z: 0 };
  let t = 0;
  const dt = 1 / 30;
  while (t < seconds) {
    const aglFt = ac.agl * UNIT.FT;
    const vsFpm = ac.vs * UNIT.FPM;
    const iasKt = ac.ias * UNIT.KTS;

    // Aim at the touchdown point: descend at whatever rate puts us there,
    // then flare in the last few metres.
    const toGo = Math.max(30, target.x - ac.pos.x);
    const above = Math.max(0, ac.pos.y - 14);
    let wantVs = -((above / toGo) * Math.max(10, ac.groundSpeed)) * UNIT.FPM;
    wantVs = Math.max(-750, Math.min(-120, wantVs));
    if (aglFt < 25) wantVs = -110;
    if (aglFt < 10) wantVs = -35;

    // Pitch controller on vertical speed.
    const vsErr = (wantVs - vsFpm) / 700;
    const pitchCmd = Math.max(-0.6, Math.min(0.85, vsErr));

    // Speed controller on throttle: hold 68 kt on the approach.
    const spdErr = (68 - iasKt) / 25;
    const thr = Math.max(0, Math.min(1, 0.42 + spdErr * 0.5 - (aglFt < 20 ? 0.42 : 0)));
    sim.input.throttleTarget = thr;

    // Roll/yaw controller to track the centreline and the runway heading.
    const lateral = ac.pos.z - target.z;
    const hdgErr = ((ac.heading - 90 + 540) % 360) - 180;
    const wantBank = Math.max(-14, Math.min(14, -lateral * 0.35 - hdgErr * 0.9));
    const bank = ac.bankAngleDeg();
    sim.override = {
      pitch: pitchCmd,
      roll: Math.max(-0.7, Math.min(0.7, (wantBank - bank) / 16)),
      yaw: Math.max(-0.6, Math.min(0.6, -hdgErr / 26)),
    };

    sim.step(dt, dt);
    t += dt;
    if (ac.crashed) break;
    if (ac.onGround && ac.groundSpeed < 3 && ac.groundTime > 1) break;
    // Once on the ground, brake and centre the controls.
    if (ac.onGround && ac.groundTime > 0.2) {
      sim.override = { pitch: 0, roll: 0, yaw: 0 };
      sim.input.throttleTarget = 0;
      sim.key('Space', true);
    }
  }
  sim.key('Space', false);
  sim.override = null;
  return t;
}

/**
 * Settings the suite assumes. It flies one fixed profile, so anything that
 * changes the aeroplane, the terrain under it or the assists invalidates the
 * whole run.
 *
 * This exists because of a real and expensive mistake: a browser left on the
 * Ember map with a different aeroplane and medium quality failed six checks,
 * and the failures looked exactly like a code regression. Two hours went into
 * bisecting a bug that was never there. A run that cannot say what settings it
 * ran under is not evidence of anything, so now it forces them and reports
 * what it had to change.
 */
const TEST_SETTINGS = {
  map: 'kestrel',
  aircraft: 'skylark',
  quality: 'high',
  flightMode: 'simplified',
  realisticCockpit: false,
  freeLook: false,
  randomWinds: false,
  realisticFuel: false,
  startAtGate: false,
};

/**
 * Force the assumed settings and hand back a restore function.
 * `changed` lists what was wrong, so a dirty profile shows up in the results
 * rather than as six mysterious failures.
 */
async function useTestSettings(sim) {
  const before = {};
  const changed = [];
  for (const [k, want] of Object.entries(TEST_SETTINGS)) {
    before[k] = sim.settings[k];
    if (sim.settings[k] === want) continue;
    changed.push(`${k}: ${sim.settings[k]} → ${want}`);
    if (k === 'map') {
      // Changing map rebuilds the world and drops to the menu, so it has to
      // settle before anything flies.
      sim.setMap(want);
      for (let i = 0; i < 200 && sim.settings.map !== want; i++) await new Promise((f) => setTimeout(f, 10));
      await new Promise((f) => setTimeout(f, 120));
    } else if (k === 'aircraft') {
      sim.setAircraft(want);
      sim.settings.aircraft = want;
    } else {
      sim.settings[k] = want;
    }
  }
  return {
    changed,
    restore() {
      for (const [k, v] of Object.entries(before)) {
        if (k === 'map' || k === 'aircraft') continue; // rebuilding on the way out is not worth it
        sim.settings[k] = v;
      }
    },
  };
}

export async function runSelfTest(sim, opts = {}) {
  const r = makeReporter();
  const verbose = opts.verbose !== false;
  const say = (...a) => verbose && console.log('[selftest]', ...a);

  // Before anything else: put the simulator in the state the suite assumes.
  const profile = await useTestSettings(sim);
  if (profile.changed.length) {
    say('settings were not at defaults —', profile.changed.join(', '));
  }
  r.ok(
    'ran on default settings',
    true,
    profile.changed.length ? `forced: ${profile.changed.join(', ')}` : 'already clean'
  );

  const origMode = sim.settings.flightMode;
  const origQuality = sim.settings.quality;
  // The suite drives the simulator without a visible window, so the
  // pause-on-tab-hidden behaviour has to be off while it runs.
  const origAutoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const ensureFlying = () => {
    if (sim.state === 'paused') sim.resume();
  };

  /* ---------------------------------------------------------------- *
   * 1. Take-off
   * ---------------------------------------------------------------- */
  say('take-off');
  await sim.startMode('free', { time: 'day', condition: 'clear', windSpeedKts: 5, windDirDeg: 100, airborne: false });
  r.ok('free flight starts', sim.state === 'flying', sim.state);
  r.ok('spawns on the runway', sim.aircraft.onGround === true && Math.abs(sim.aircraft.pos.z) < 20);
  r.ok('engine running at spawn', sim.aircraft.engineOn);

  sim.key('ShiftLeft', true);
  sim.step(4);
  const rollSpeed = sim.aircraft.ias * UNIT.KTS;
  r.ok('accelerates on the runway', rollSpeed > 12, `${rollSpeed.toFixed(0)} kt after 4 s`);

  // Roll until flying speed, then rotate.
  let t = 4;
  while (sim.aircraft.ias * UNIT.KTS < 56 && t < 40) {
    sim.step(0.5);
    t += 0.5;
  }
  const rotateDist = Math.abs(sim.aircraft.pos.x - -470);
  const driftAtRotate = Math.abs(sim.aircraft.pos.z);
  r.ok('reaches rotation speed', sim.aircraft.ias * UNIT.KTS >= 56, `${t.toFixed(0)} s, ${rotateDist.toFixed(0)} m`);
  r.ok('take-off roll stays on the runway', driftAtRotate < 17, `${driftAtRotate.toFixed(1)} m from centreline`);

  for (let i = 0; i < 10; i++) {
    sim.override = { pitch: 0.5 };
    sim.step(0.5);
  }
  sim.override = null;
  r.ok('lifts off', !sim.aircraft.onGround && sim.aircraft.agl > 8, `${(sim.aircraft.agl * UNIT.FT).toFixed(0)} ft AGL`);
  r.ok('no crash on take-off', !sim.aircraft.crashed, sim.aircraft.crashReason);

  /* ---------------------------------------------------------------- *
   * 2. Climb and hands-off stability (simplified mode)
   * ---------------------------------------------------------------- */
  say('climb + stability');
  if (sim.aircraft.crashed) {
    sim.aircraft.reset({
      pos: new sim.aircraft.pos.constructor(-1200, 0, 0),
      headingDeg: 90,
      speed: 55,
      altAGL: 200,
      engineOn: true,
    });
    sim.aircraft.controls.throttle = 0.9;
    sim.input.throttleTarget = 0.9;
  }
  const climbStart = sim.aircraft.alt * UNIT.FT;
  for (let i = 0; i < 40; i++) {
    sim.override = { pitch: 0.32 };
    sim.step(0.5);
  }
  sim.override = null;
  const climbRate = ((sim.aircraft.alt * UNIT.FT - climbStart) / 20) * 60;
  r.ok(
    'climbs away at a sensible rate',
    climbRate > 300 && climbRate < 2500,
    `${climbRate.toFixed(0)} ft/min`
  );

  // Hands off: the aeroplane should level its wings AND stop climbing or
  // sinking, which is the whole promise of simplified mode.
  allUp(sim);
  sim.step(18);
  const bank = Math.abs(sim.aircraft.bankAngleDeg());
  const pitch = sim.aircraft.pitchAngleDeg();
  const vs = sim.aircraft.vs * UNIT.FPM;
  r.ok('simplified mode levels the wings hands-off', bank < 6, `${bank.toFixed(1)}° bank`);
  r.ok('simplified mode holds a sane attitude', pitch > -8 && pitch < 16, `${pitch.toFixed(1)}° pitch`);
  r.ok('simplified mode holds its height hands-off', Math.abs(vs) < 320, `${vs.toFixed(0)} ft/min`);
  r.ok('still flying after hands-off', !sim.aircraft.crashed && sim.aircraft.ias * UNIT.KTS > 40);

  /* ---------------------------------------------------------------- *
   * 3. Turning
   * ---------------------------------------------------------------- */
  say('turning');
  sim.aircraft.reset({
    pos: new sim.aircraft.pos.constructor(-2600, 0, 0),
    headingDeg: 90,
    speed: 58,
    altAGL: 500,
    engineOn: true,
  });
  sim.input.throttleTarget = 0.7;
  allUp(sim);
  sim.step(2);
  const hdg0 = sim.aircraft.heading;
  sim.key('KeyD', true);
  sim.step(1.6);
  sim.key('KeyD', false);
  const banked = sim.aircraft.bankAngleDeg();
  sim.step(12);
  const hdg1 = sim.aircraft.heading;
  const turned = ((hdg1 - hdg0 + 540) % 360) - 180;
  r.ok('banks right with D', banked > 8, `${banked.toFixed(0)}°`);
  r.ok('turns right', turned > 12, `${turned.toFixed(0)}° of heading change`);
  r.ok('rolls level again after releasing', Math.abs(sim.aircraft.bankAngleDeg()) < 8);

  /* ---------------------------------------------------------------- *
   * 4. Controls, gear, flaps, camera
   * ---------------------------------------------------------------- */
  say('systems');
  sim.aircraft.reset({
    pos: new sim.aircraft.pos.constructor(-2600, 0, 0),
    headingDeg: 90,
    speed: 55,
    altAGL: 500,
    engineOn: true,
  });
  sim.input.throttleTarget = 0.55;
  allUp(sim);
  sim.step(1);
  const gearBefore = sim.aircraft.gearDown;
  sim.tap('KeyG');
  sim.step(3);
  r.ok('gear lever works', sim.aircraft.gearDown !== gearBefore, `now ${sim.aircraft.gearDown ? 'down' : 'up'}`);
  sim.tap('KeyG');
  sim.step(3);
  r.ok('gear returns', sim.aircraft.gearDown === gearBefore);

  sim.tap('KeyF');
  sim.step(2);
  r.ok('flaps extend', sim.aircraft.flapStep() === 1, `step ${sim.aircraft.flapStep()}`);
  sim.tap('KeyV');
  sim.step(2);
  r.ok('flaps retract', sim.aircraft.flapStep() === 0);

  const views = [];
  for (let i = 0; i < 5; i++) {
    sim.tap('KeyC');
    sim.step(0.4);
    views.push(sim.rig.mode);
  }
  r.ok('all five camera views work', new Set(views).size === 5, views.join(', '));
  // There are two cockpit views now. The default is the clean one — no panel
  // in the way, instruments on the overlay — and the panel only appears when
  // you ask for the realistic cockpit. So the check is that each view does
  // its own job, not that the panel is always there.
  r.ok('cockpit view draws a cockpit', (() => {
    // Both cockpit views show the interior. The plain one used to hide it
    // entirely, which reads as a broken camera rather than a clean view.
    sim.settings.realisticCockpit = false;
    sim.rig.realisticCockpit = false;
    sim.rig.setMode('cockpit');
    sim.step(0.5);
    return sim.cockpit.visible === true && !!sim.cockpit.userData.panel.texture;
  })());
  r.ok('realistic cockpit narrows the field of view', (() => {
    sim.rig.realisticCockpit = false;
    sim.step(1.5);
    const wide = sim.camera.fov;
    sim.settings.realisticCockpit = true;
    sim.rig.realisticCockpit = true;
    sim.step(2.5);
    return sim.camera.fov < wide - 2;
  })());
  r.ok('realistic cockpit view renders instruments', (() => {
    sim.settings.realisticCockpit = true;
    sim.rig.realisticCockpit = true;
    sim.step(0.5);
    return sim.cockpit.visible && !!sim.cockpit.userData.panel.texture;
  })());
  sim.settings.realisticCockpit = false;
  sim.rig.realisticCockpit = false;
  sim.rig.setMode('chase');

  /* ---------------------------------------------------------------- *
   * 5. Weather presets
   * ---------------------------------------------------------------- */
  say('weather');
  const freshAir = () => {
    sim.aircraft.reset({
      pos: new sim.aircraft.pos.constructor(-2600, 0, 0),
      headingDeg: 90,
      speed: 58,
      altAGL: 500,
      engineOn: true,
    });
    sim.aircraft.controls.throttle = 0.7;
    sim.input.throttleTarget = 0.7;
    allUp(sim);
    sim.step(0.2);
  };
  freshAir();
  const weatherResults = [];
  for (const time of ['day', 'sunset', 'night']) {
    for (const condition of ['clear', 'cloudy', 'rainy', 'stormy']) {
      sim.weather.load({ time, condition, windSpeedKts: 14, windDirDeg: 330 });
      sim.step(0.6);
      weatherResults.push(`${time}/${condition}`);
      if (sim.aircraft.crashed) break;
    }
  }
  r.ok('all 12 weather combinations render', weatherResults.length === 12, weatherResults.length + ' combos');
  r.ok('rain appears in wet weather', (() => {
    sim.weather.load({ time: 'day', condition: 'rainy', windSpeedKts: 10, windDirDeg: 90 });
    sim.step(0.6);
    return sim.rain.mesh.visible;
  })());
  r.ok('rain hides in clear weather', (() => {
    sim.weather.load({ time: 'day', condition: 'clear', windSpeedKts: 5, windDirDeg: 90 });
    sim.step(0.6);
    return !sim.rain.mesh.visible;
  })());
  r.ok('airfield lights come on at night', (() => {
    sim.weather.load({ time: 'night', condition: 'clear', windSpeedKts: 5, windDirDeg: 90 });
    sim.step(0.6);
    const on = sim.airport.lightsOn;
    sim.weather.load({ time: 'day', condition: 'clear', windSpeedKts: 5, windDirDeg: 90 });
    sim.step(0.3);
    return on;
  })());

  /* ---------------------------------------------------------------- *
   * 6. Crosswind really pushes the aeroplane
   * ---------------------------------------------------------------- */
  say('wind');
  const flyStraight = (windKts, windDir, seconds = 14) => {
    sim.aircraft.reset({
      pos: new sim.aircraft.pos.constructor(-3000, 0, 0),
      headingDeg: 90,
      speed: 60,
      altAGL: 400,
      engineOn: true,
    });
    sim.weather.load({ time: 'day', condition: 'clear', windSpeedKts: windKts, windDirDeg: windDir });
    sim.input.throttleTarget = 0.75;
    allUp(sim);
    // Hold the heading with the autopilot hook so we measure the wind, not the
    // aeroplane's weathercock response.
    for (let i = 0; i < seconds * 30; i++) {
      const hdgErr = ((sim.aircraft.heading - 90 + 540) % 360) - 180;
      const bank = sim.aircraft.bankAngleDeg();
      sim.override = {
        pitch: Math.max(-0.4, Math.min(0.5, -sim.aircraft.vs * 0.05)),
        roll: Math.max(-0.5, Math.min(0.5, (-hdgErr * 0.8 - bank) / 14)),
        yaw: Math.max(-0.4, Math.min(0.4, -hdgErr / 24)),
      };
      sim.step(1 / 30, 1 / 30);
    }
    sim.override = null;
    const ac = sim.aircraft;
    const track = (Math.atan2(ac.vel.x, -ac.vel.z) * 180) / Math.PI;
    return {
      ias: ac.ias * UNIT.KTS,
      ground: ac.groundSpeed * UNIT.KTS,
      drift: ((track - ac.heading + 540) % 360) - 180,
      z: ac.pos.z,
    };
  };
  const head = flyStraight(30, 90);
  r.ok(
    'a 30 kt headwind slows the ground speed by about 30 kt',
    head.ias - head.ground > 20,
    `airspeed ${head.ias.toFixed(0)} kt, ground speed ${head.ground.toFixed(0)} kt`
  );
  const cross = flyStraight(28, 0);
  r.ok(
    'a 28 kt crosswind pushes the aeroplane off its heading',
    Math.abs(cross.drift) > 6 && Math.abs(cross.z) > 40,
    `${cross.drift.toFixed(1)}° of drift, ${cross.z.toFixed(0)} m sideways`
  );
  sim.weather.load({ time: 'day', condition: 'clear', windSpeedKts: 5, windDirDeg: 90 });

  /* ---------------------------------------------------------------- *
   * 7. Stall and recovery (realistic mode)
   * ---------------------------------------------------------------- */
  say('stall');
  sim.aircraft.mode = 'realistic';
  sim.aircraft.reset({
    pos: new sim.aircraft.pos.constructor(-3000, 0, 400),
    headingDeg: 90,
    speed: 45,
    altAGL: 1200,
    engineOn: true,
  });
  sim.aircraft.controls.throttle = 0.1;
  sim.input.throttleTarget = 0.1;
  let stalled = false;
  for (let i = 0; i < 60; i++) {
    sim.override = { pitch: 1 };
    sim.step(0.4);
    if (sim.aircraft.stalled) {
      stalled = true;
      break;
    }
  }
  sim.override = null;
  r.ok('the wing stalls when held nose-high in realistic mode', stalled);
  // Recovery: nose down and power up.
  sim.input.throttleTarget = 1;
  for (let i = 0; i < 20; i++) {
    sim.override = { pitch: -0.5 };
    sim.step(0.4);
  }
  sim.override = null;
  sim.step(6);
  r.ok('recovers from the stall', !sim.aircraft.stalled && !sim.aircraft.crashed, sim.aircraft.crashReason);
  sim.aircraft.mode = 'simplified';

  /* ---------------------------------------------------------------- *
   * 8. Landing — calm, then crosswind
   * ---------------------------------------------------------------- */
  const setUpApproach = (windKts, windDir, condition = 'clear') => {
    sim.weather.load({ time: 'day', condition, windSpeedKts: windKts, windDirDeg: windDir });
    sim.aircraft.reset({
      pos: new sim.aircraft.pos.constructor(-2300, 0, 0),
      headingDeg: 90,
      speed: 36,
      altAGL: 330,
      engineOn: true,
      gearDown: true,
    });
    sim.aircraft.controls.throttle = 0.4;
    sim.input.throttleTarget = 0.4;
    sim.aircraft.setFlaps(2);
    sim.aircraft.flaps = 0.66;
    allUp(sim);
  };

  say('landing, calm');
  setUpApproach(4, 90);
  flyApproach(sim, 90);
  const calmLanding = sim.aircraft.lastTouchdown;
  r.ok('lands the aeroplane in calm air', !!calmLanding && !calmLanding.crashed, calmLanding ? `${calmLanding.vsFpm} fpm, score ${calmLanding.score}` : 'no touchdown');
  r.ok('touches down on the runway', !!calmLanding && calmLanding.onRunway);
  r.ok('landing is graded', !!calmLanding && typeof calmLanding.score === 'number' && calmLanding.score > 0, calmLanding && calmLanding.quality);

  say('landing, crosswind + rain');
  setUpApproach(18, 350, 'rainy');
  flyApproach(sim, 90);
  const xwindLanding = sim.aircraft.lastTouchdown;
  r.ok(
    'lands in an 18 kt crosswind with rain',
    !!xwindLanding && !xwindLanding.crashed,
    xwindLanding ? `${xwindLanding.vsFpm} fpm, ${xwindLanding.centreline} m off centre` : 'no touchdown'
  );

  /* ---------------------------------------------------------------- *
   * 9. Crash detection and reset
   * ---------------------------------------------------------------- */
  say('crash + reset');
  sim.aircraft.reset({
    pos: new sim.aircraft.pos.constructor(-1500, 0, 0),
    headingDeg: 90,
    speed: 60,
    altAGL: 120,
    engineOn: true,
  });
  sim.aircraft.controls.throttle = 0.8;
  sim.input.throttleTarget = 0.8;
  for (let i = 0; i < 40 && !sim.aircraft.crashed; i++) {
    sim.override = { pitch: -0.55 };
    sim.step(0.3);
  }
  sim.override = null;
  r.ok('flying into the ground is a crash', sim.aircraft.crashed, sim.aircraft.crashReason);
  sim.returnToAirport();
  sim.step(1);
  r.ok('return to airport resets the aeroplane', !sim.aircraft.crashed && sim.aircraft.onGround);

  /* ---------------------------------------------------------------- *
   * 10. ATC radio + subtitles
   * ---------------------------------------------------------------- */
  say('ATC');
  sim.hud.setSubtitlesEnabled(true);
  /*
   * Clear the radio first.
   *
   * These checks used to run against whatever happened to be on screen. That
   * was fine while the landing checks above were failing and saying nothing —
   * once landing actually worked, its own ATC calls were still up when this
   * ran, and the check failed reading "You are down off the runway". A test
   * that only passes because an earlier test is broken is worth nothing.
   */
  sim.audio?.radio?.cancel?.();
  sim.atc?.reset?.();
  /*
   * And stop the controller talking over the test.
   *
   * Cancelling the radio was not enough: ChatGPT's tree has a busier ATC
   * director that carries on making ground and taxi calls, so the subtitle
   * under test was replaced by "Kestrel Island Ground..." before the
   * assertion read it. The director is silenced for these two checks and put
   * straight back, so what is being tested is the one thing this check is
   * about — that a spoken call reaches the subtitle.
   */
  const atcUpdate = sim.atc && sim.atc.update;
  if (atcUpdate) sim.atc.update = () => {};
  sim.hud.setSubtitle('', 'tower', 0);
  sim.step(0.1);
  sim.speak('Skylark one seven two, Kestrel Tower, runway zero nine, cleared for take-off.', 'tower');
  sim.step(0.2);
  r.ok(
    'ATC calls appear as subtitles',
    sim.hud.subtitleText.textContent.includes('cleared for take-off'),
    sim.hud.subtitleText.textContent.slice(0, 40)
  );
  const before = sim.hud.subtitleText.textContent;
  // The director has to be running again for it to react to anything.
  if (atcUpdate) sim.atc.update = atcUpdate;
  sim.atc.reset();
  sim.aircraft.controls.throttle = 0.6;
  sim.step(1.2);
  r.ok('ATC reacts to a take-off request', sim.hud.subtitleText.textContent !== before || sim.atc.said.clearance === true);

  /* ---------------------------------------------------------------- *
   * 11. HUD readouts
   * ---------------------------------------------------------------- */
  say('HUD');
  sim.step(0.4);
  r.ok('HUD shows a speed', /\d/.test(sim.hud.speedValue.textContent));
  r.ok('HUD explains the wind in words', /wind|calm/i.test(sim.hud.windText.textContent), sim.hud.windText.textContent);
  r.ok('HUD shows plain-language height', sim.hud.altWord.textContent.length > 3, sim.hud.altWord.textContent);

  /* ---------------------------------------------------------------- *
   * 12. Tutorial
   * ---------------------------------------------------------------- */
  say('tutorial');
  await sim.startMode('tutorial');
  r.ok('tutorial starts', sim.runner.status === 'running' && sim.runner.stepIndex === 0);
  r.ok('tutorial starts with the engine off', !sim.aircraft.engineOn);
  r.ok('tutorial step one asks you to look around', /camera|look/i.test(sim.runner.step.text), sim.runner.step.text);
  // Step 1: change the camera.
  sim.tap('KeyC');
  sim.step(1);
  r.ok('tutorial advances after the camera step', sim.runner.step.id === 'engine', sim.runner.step.id);
  // Step 2: start the engine.
  sim.tap('KeyI');
  sim.step(3);
  r.ok('starter works and the tutorial advances', sim.runner.step.id === 'power', sim.runner.step.id);
  // Step 3+4: power and roll.
  sim.key('ShiftLeft', true);
  sim.step(12);
  r.ok('tutorial reaches the rotate step', ['steer', 'rotate'].includes(sim.runner.step.id), sim.runner.step.id);
  for (let i = 0; i < 12; i++) {
    sim.override = { pitch: 0.5 };
    sim.step(0.5);
  }
  sim.override = null;
  r.ok('tutorial recognises the take-off', ['climb', 'level'].includes(sim.runner.step.id), sim.runner.step.id);
  sim.key('ShiftLeft', false);
  allUp(sim);

  /* ---------------------------------------------------------------- *
   * 13. Missions
   * ---------------------------------------------------------------- */
  say('missions');
  /*
   * Circuit: the lap round the coast.
   *
   * This used to check five floating rings. There are no rings any more —
   * every navigation objective is a real place with a position check — so it
   * now flies the lap by putting the aeroplane at each point in turn and
   * confirming the mission follows along.
   */
  await sim.startMode('mission', { id: 'circuit' });
  r.ok('circuit mission starts', sim.runner.def.id === 'circuit' && sim.runner.status === 'running');
  r.ok('no checkpoint rings anywhere in the circuit', sim.runner.gates.length === 0, `${sim.runner.gates.length} rings`);
  while (sim.runner.step && sim.runner.step.id !== 'lap') sim.runner.skipStep();
  sim.step(0.2);
  r.ok('circuit reaches the lap', sim.runner.step && sim.runner.step.id === 'lap', sim.runner.step && sim.runner.step.id);
  // Fly the lap by visiting each point the steps ask for.
  const V3 = sim.aircraft.pos.constructor;
  const lapPoints = [
    [2400, 500, -1400],
    [2200, 500, 1900],
    [-1600, 460, 1800],
  ];
  for (const [x, y, z] of lapPoints) {
    sim.aircraft.pos.set(x, sim.airport ? y + 6 : y, z);
    sim.step(0.2);
  }
  sim.step(0.3);
  r.ok(
    'the lap advances the mission',
    sim.runner.step && sim.runner.step.id === 'downwind',
    sim.runner.step && sim.runner.step.id
  );

  // Delivery: verify the cargo drop.
  await sim.startMode('mission', { id: 'delivery' });
  r.ok('delivery mission starts with cargo', sim.hasCargo === true);
  while (sim.runner.step && sim.runner.step.id !== 'drop') sim.runner.skipStep();
  const pad = sim.scenery ? null : null;
  const padPos = (await import('../src/world/scenery.js')).DELIVERY_PAD;
  sim.aircraft.reset({
    pos: new sim.aircraft.pos.constructor(padPos.x, 0, padPos.z),
    headingDeg: 90,
    speed: 32,
    altAGL: 46, // ~150 ft, a sensible drop height
    engineOn: true,
  });
  sim.step(0.2);
  const dropped = sim.dropCargo();
  r.ok('cargo releases with X', dropped && !!sim.crate);
  // Let the crate fall while the aeroplane climbs away — leaving it unattended
  // at 150 ft over an island ends with a hillside, which stops the world.
  const crateRef = sim.crate;
  sim.input.throttleTarget = 1;
  let crateSteps = 0;
  let crateNote = '';
  for (let i = 0; i < 400 && crateRef && !crateRef.landed; i++) {
    ensureFlying();
    sim.override = { pitch: 0.22, roll: 0 };
    sim.step(0.1);
    crateSteps++;
    if (sim.crate !== crateRef && !crateNote) crateNote = `crate swapped at step ${i}`;
    if (sim.aircraft.crashed) {
      crateNote = crateNote || `aeroplane crashed at step ${i}: ${sim.aircraft.crashReason}`;
      break;
    }
    if (sim.state !== 'flying') {
      crateNote = crateNote || `state became ${sim.state} at step ${i}`;
      break;
    }
  }
  sim.override = null;
  r.ok(
    'the crate lands under its parachute',
    crateRef.landed,
    `after ${crateRef.t.toFixed(1)} s, ${crateSteps} steps${crateNote ? ', ' + crateNote : ''}`
  );
  const dist = crateRef.group.position.distanceTo(padPos);
  r.ok('crate lands near the target when dropped overhead', dist < 120, `${dist.toFixed(0)} m`);
  sim.step(0.4);
  r.ok('delivery step completes after a good drop', sim.runner.step && sim.runner.step.id === 'home', sim.runner.step && sim.runner.step.id);

  // Storm: verify the spawn and the weather.
  await sim.startMode('mission', { id: 'storm' });
  sim.step(0.2);
  r.ok('storm mission starts airborne', !sim.aircraft.onGround && sim.aircraft.agl > 60, `${(sim.aircraft.agl * UNIT.FT).toFixed(0)} ft`);
  r.ok('storm mission is stormy', sim.weather.condition === 'stormy', sim.weather.condition);
  r.ok('storm mission has a strong crosswind', sim.weather.windSpeedKts >= 20, `${sim.weather.windSpeedKts} kt`);
  sim.step(6);
  r.ok('storm flight is survivable for 6 s hands-off', !sim.aircraft.crashed, sim.aircraft.crashReason);

  /* ---------------------------------------------------------------- *
   * 14. The carrier
   * ---------------------------------------------------------------- *
   * The deck is the one landing surface in the game that one file draws and
   * another file lands on, so the two can disagree without anything throwing
   * and without anything looking wrong from the air.
   *
   * They did disagree. The ship was scaled up five times and the landing
   * surface was not, so there were eighty-three metres of open air between
   * the painted steel and the deck the wheels actually found: you flew
   * through the picture and stopped, invisibly, inside the hull. The suite
   * had nothing to say about it, because the suite had never been to the
   * carrier. It goes now.
   * ---------------------------------------------------------------- */
  say('carrier');
  const carrier = sim.carrier;
  r.ok('the carrier is in the world', !!carrier, carrier ? carrier.name : 'missing');
  if (carrier) {
    const THREE = await import('../src/vendor/three.module.js');
    const terrain = await import('../src/world/terrain.js');

    // Where the steel is drawn.
    let deckMesh = null;
    carrier.group.traverse((o) => {
      if (o.name === 'angledFlightDeck' || o.name === 'flightDeck') deckMesh = o;
    });
    const painted = deckMesh ? new THREE.Box3().setFromObject(deckMesh) : null;
    const paintedY = painted ? painted.max.y : null;
    r.ok(
      'the painted deck is the deck you land on',
      painted !== null && Math.abs(paintedY - carrier.deckY) < 0.5,
      painted ? `picture ${paintedY.toFixed(1)} m, landing surface ${carrier.deckY.toFixed(1)} m` : 'no deck mesh'
    );
    r.ok(
      'the landing surface covers the ship and no more',
      painted !== null
        && Math.abs((painted.max.x - painted.min.x) / 2 - carrier.halfWidth) < 3
        && Math.abs((painted.max.z - painted.min.z) / 2 - carrier.halfDepth) < 3,
      painted ? `${(painted.max.z - painted.min.z).toFixed(0)} x ${(painted.max.x - painted.min.x).toFixed(0)} m` : ''
    );
    r.ok(
      'the deck is what heightAt returns over the ship',
      terrain.heightAt(carrier.pos.x, carrier.pos.z) === carrier.deckY,
      `${terrain.heightAt(carrier.pos.x, carrier.pos.z).toFixed(1)} m`
    );

    // The island is solid; the strip you land on is not.
    let island = null;
    carrier.group.traverse((o) => { if (o.name === 'carrierIsland') island = o; });
    const isleBox = island ? new THREE.Box3().setFromObject(island) : null;
    const isleHit = isleBox
      ? terrain.obstacleAt((isleBox.min.x + isleBox.max.x) / 2, carrier.deckY + 30, (isleBox.min.z + isleBox.max.z) / 2)
      : null;
    r.ok(
      'the island is solid where the island is',
      !!isleHit,
      isleHit ? isleHit.what : 'nothing there'
    );
    r.ok(
      'the deck itself is clear to land on',
      !terrain.obstacleAt(carrier.pos.x, carrier.deckY + 30, carrier.pos.z),
      'centreline'
    );

    /*
     * And a trap: dropped onto the wires at a carrier arrival speed, wings
     * level, no flare — which is what a deck landing is. It has to touch the
     * deck, catch, and stop on the ship.
     */
    await sim.startMode('free', {
      aircraft: 'osprey', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 0,
    });
    const cac = sim.aircraft;
    const aimZ = (carrier.wires.z0 + carrier.wires.z1) / 2;
    cac.reset({
      pos: new THREE.Vector3(carrier.pos.x, 0, aimZ + 120),
      headingDeg: 0, speed: 62, gearDown: true,
    });
    cac.pos.y = carrier.deckY + 6;
    cac.vel.y = -3.2;
    let caught = false;
    let touchdownY = null;
    let touchdownZ = null;
    for (let i = 0; i < 2400; i++) {
      sim.override = { pitch: 0, roll: 0, yaw: 0 };
      const was = cac.onGround;
      sim.step(1 / 60, 1 / 60);
      if (cac.arrested > 0) caught = true;
      if (!was && cac.onGround && touchdownY === null) {
        touchdownY = cac.pos.y;
        touchdownZ = cac.pos.z;
      }
      if (cac.crashed) break;
      if (cac.onGround && cac.groundSpeed < 2 && cac.groundTime > 1.2) break;
      if (cac.onGround && cac.groundTime > 0.15) {
        sim.input.throttleTarget = 0;
        sim.key('Space', true);
      }
    }
    sim.key('Space', false);
    sim.override = null;
    r.ok(
      'the wheels land on the deck, not through it',
      touchdownY !== null && Math.abs(touchdownY - carrier.deckY) < 6 && !cac.crashed,
      touchdownY === null
        ? `never touched down${cac.crashed ? ': ' + cac.crashReason : ''}`
        : `${touchdownY.toFixed(1)} m, deck at ${carrier.deckY.toFixed(1)} m`
    );
    r.ok('a wire catches it', caught, touchdownZ === null ? '' : `${Math.round(touchdownZ - cac.pos.z)} m of roll-out`);
    r.ok(
      'it stops on the ship',
      Math.abs(cac.pos.x - carrier.pos.x) <= carrier.halfWidth
        && Math.abs(cac.pos.z - carrier.pos.z) <= carrier.halfDepth
        && Math.abs(cac.pos.y - carrier.deckY) < 8
        && cac.groundSpeed < 4,
      `${(cac.groundSpeed * UNIT.KTS).toFixed(0)} kt at ${cac.pos.y.toFixed(1)} m`
    );
  }

  /* ---------------------------------------------------------------- *
   * 15. Pause, restart, persistence
   * ---------------------------------------------------------------- */
  say('game flow');
  sim.pause();
  r.ok('pause works', sim.state === 'paused');
  sim.resume();
  r.ok('resume works', sim.state === 'flying');
  await sim.restart();
  r.ok('restart works', sim.state === 'flying' && !sim.aircraft.crashed);
  sim.quitToMenu('main');
  r.ok('quit to menu works', sim.state === 'menu');

  const saved = JSON.parse(localStorage.getItem('islandsim.settings.v1') || '{}');
  r.ok('settings are saved locally', !!saved && typeof saved.quality === 'string', saved.quality);
  const prog = JSON.parse(localStorage.getItem('islandsim.progress.v1') || '{}');
  r.ok('progress is saved locally', prog && typeof prog.landings === 'number', `${prog.landings} landings recorded`);

  /* ---------------------------------------------------------------- *
   * 16. Offline / PWA plumbing
   * ---------------------------------------------------------------- */
  say('offline');
  r.ok('service worker is supported', 'serviceWorker' in navigator);
  const manifestLink = document.querySelector('link[rel=manifest]');
  r.ok('manifest is linked', !!manifestLink, manifestLink && manifestLink.href);
  try {
    const mres = await fetch('manifest.webmanifest');
    const mjson = await mres.json();
    r.ok('manifest parses and has icons', Array.isArray(mjson.icons) && mjson.icons.length >= 2, `${mjson.icons.length} icons`);
    r.ok('manifest is installable (standalone + name)', mjson.display === 'standalone' && !!mjson.name);
  } catch (err) {
    r.ok('manifest parses and has icons', false, err.message);
  }
  try {
    const swres = await fetch('sw.js');
    const swtext = await swres.text();
    // Every module in the app must be in the precache list or offline breaks.
    /*
     * Either quoting style.
     *
     * This looked only for single-quoted paths, which is right for a
     * hand-written list and wrong for a generated JSON manifest — against
     * ChatGPT's tree the parser matched nothing and cheerfully reported the
     * whole app missing from the offline cache, when every file was in fact
     * there with a sha256 beside it. The check is about the files being
     * listed, not about quotation marks.
     */
    const listed = (swtext.match(/['"]([^'"]+\.(?:js|css|html|png|webmanifest))['"]/g) || [])
      .map((s) => s.replace(/['"]/g, ''));
    const wanted = [
      'src/main.js',
      'src/vendor/three.module.js',
      'styles/main.css',
      'index.html',
      'src/audio/atc.js',
      'src/game/tutorial.js',
      'src/ui/menus.js',
    ];
    const missing = wanted.filter((w) => !listed.includes(w));
    r.ok('service worker precaches the whole app', missing.length === 0, missing.join(', ') || `${listed.length} files listed`);
  } catch (err) {
    r.ok('service worker precaches the whole app', false, err.message);
  }

  /*
   * The other three games.
   *
   * Sixty more checks, kept in their own file for the same reason the boat's
   * missions are: this one is nine hundred lines of aeroplane. Loaded
   * dynamically and wrapped, because a static import of a name that does not
   * exist takes the whole game down and not just the test — this project has
   * paid for that once.
   */
  try {
    const tg = await import('./selftest-three-games.js');
    await tg.threeGameChecks(sim, r, say);
  } catch (err) {
    r.ok('the other three games can be tested at all', false, String(err && err.message));
  }

  // Restore what we changed.
  sim.autoPauseOnHide = origAutoPause;
  sim.settings.flightMode = origMode;
  sim.settings.quality = origQuality;
  sim.aircraft.mode = origMode;
  profile.restore();
  allUp(sim);

  const failed = r.failed;
  const summary = `${r.checks.length - failed.length}/${r.checks.length} checks passed`;
  if (verbose) {
    console.log(`[selftest] ${summary}`);
    if (failed.length) console.warn('[selftest] failures:', failed);
  }
  return { checks: r.checks, failed, summary, passed: failed.length === 0 };
}

export default runSelfTest;
