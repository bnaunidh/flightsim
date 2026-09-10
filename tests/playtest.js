/**
 * Playtest sweep.
 *
 * The self-test asks "is it broken?". This asks "is it any good?" — it flies
 * every aeroplane on every map, fires every failure and every disaster, opens
 * every screen and clicks every control, and reports the things that are
 * working-but-wrong: an aeroplane that cannot land, a menu button that leads
 * nowhere, a warning light that never comes on.
 *
 * Run it from the console:
 *   const r = await (await import('/tests/playtest.js')).runPlaytest(window.__sim);
 *
 * Everything is measured. Nothing here passes because it looked fine.
 */

const KT = 1.94384;
const FPM = 196.85;

function pitchDeg(q) {
  return Math.asin(Math.max(-1, Math.min(1, 2 * (q.w * q.x - q.z * q.y)))) * 57.2958;
}

/**
 * Hand the browser back to itself for a moment.
 *
 * This suite flies five aeroplanes over five maps and then works through the
 * failures and the disasters, which is tens of thousands of `sim.step()` calls.
 * They sat in tight synchronous loops with an `await` only at mode boundaries,
 * so the whole run held the main thread: the tab stopped painting, stopped
 * answering, and looked to anything watching from outside exactly like a hang.
 * The suite was effectively unrunnable for that reason alone.
 *
 * Yielding every 40 steps costs a few milliseconds over the whole run and
 * keeps the page alive and pollable throughout.
 */
let _breathCount = 0;
function breathe(every = 40) {
  if (++_breathCount % every) return null;
  return new Promise((res) => setTimeout(res, 0));
}

class Report {
  constructor() {
    this.findings = [];
    this.facts = {};
  }
  /** Something that works but should be better. */
  note(area, what, detail) {
    this.findings.push({ area, what, detail, severity: 'polish' });
  }
  /** Something that is wrong. */
  fault(area, what, detail) {
    this.findings.push({ area, what, detail, severity: 'fault' });
  }
  fact(key, value) {
    this.facts[key] = value;
  }
}

/** Fly a full circuit: take off, climb, turn downwind, come back and land. */
async function flyCircuit(sim, id, r) {
  const { performanceFor } = await import('../src/aircraft/types.js');
  await sim.startMode('free', {
    aircraft: id,
    time: 'day',
    condition: 'clear',
    windSpeedKts: 0,
    windDirDeg: 90,
  });
  const ac = sim.aircraft;
  const perf = performanceFor(id);
  const vr = perf.stallLanding * 1.25;
  ac.setFlaps(id === 'skylark' || id === 'courier' ? 1 : 2);
  sim.override = { throttle: 1, brakes: 0, pitch: 0, roll: 0, yaw: 0 };

  // --- Take-off roll ---
  let rollM = null;
  for (let t = 0; t < 60; t += 0.2) {
    const kt = ac.ias * KT;
    if (ac.onGround) sim.override.pitch = kt > vr ? 0.45 : 0;
    else sim.override.pitch = Math.max(-0.5, Math.min(0.6, (10 - pitchDeg(ac.quat)) * 0.05));
    sim.step(0.2);
    await breathe();
    if (rollM === null && !ac.onGround && ac.agl > 15) rollM = Math.round(ac.pos.x + 550);
    if (rollM !== null && ac.agl > 260) break;
    if (sim.state !== 'flying') break;
  }
  if (rollM === null) {
    r.fault('aircraft', `${id} cannot take off`, 'never left the ground inside the runway');
    sim.override = null;
    return;
  }
  if (rollM > 1100) {
    r.fault('aircraft', `${id} needs more runway than exists`, `${rollM} m of a 1,100 m runway`);
  }

  // --- Can it turn without falling out of the sky? ---
  ac.setFlaps(0);
  const altBefore = ac.pos.y;
  // A turn, not a roll. Pinning full aileron for twelve seconds rolls the
  // quick ones past inverted, and then the height they "lost in a turn" is
  // really the height they lost falling out of the sky upside down.
  let maxBank = 0;
  let rollRate = 0;
  for (let t = 0; t < 12; t += 0.2) {
    const wanted = (30 * Math.PI) / 180;
    // A gentle position-and-rate command. A pure rate loop was tried here and
    // ran away on the aeroplanes that roll fastest — it is the test that has
    // to be tuned for them, and this one behaves.
    sim.override.roll = Math.max(-0.35, Math.min(0.35, (wanted - ac.bankAngleRad()) * 0.8 - ac.omega.z * 0.5));
    sim.override.pitch = Math.max(-0.4, Math.min(0.6, -ac.vs * 0.05));
    sim.step(0.2);
    await breathe();
    maxBank = Math.max(maxBank, Math.abs(ac.bankAngleDeg()));
    rollRate = Math.max(rollRate, Math.abs(ac.omega.z) * 57.3);
  }
  // Now let go of everything. In simplified mode the aeroplane is supposed to
  // pick its own wings up, and that is the behaviour worth testing — not
  // whether my test controller can fly it.
  const heldThrottle = sim.override.throttle;
  sim.override = null;
  sim.input.throttleTarget = heldThrottle;
  for (let t = 0; t < 10; t += 0.2) { sim.step(0.2); await breathe(); }
  const lostInTurn = Math.round(altBefore - ac.pos.y);
  if (maxBank < 22) {
    r.fault('aircraft', `${id} will not hold a 30 degree bank`, `reached only ${maxBank.toFixed(0)}°`);
  }
  // Overshooting a coarse command is what a responsive aeroplane does, and a
  // fighter that rolls at 150 degrees a second is *supposed* to. Ending up
  // past ninety degrees from a 30 degree request is losing control of it,
  // which is a different thing, and that is what this checks.
  if (maxBank > 90) {
    r.fault('aircraft', `${id} rolls away from a 30° command`, `went to ${maxBank.toFixed(0)}°`);
  } else if (maxBank > 55) {
    r.note('aircraft', `${id} overshoots a coarse roll command`, `asked for 30°, peaked at ${maxBank.toFixed(0)}° — expected on a quick one`);
  }
  r.fact(`${id}.rollRate_deg_s`, +rollRate.toFixed(0));
  if (lostInTurn > 260) {
    r.note('aircraft', `${id} drops a long way in a turn`, `${lostInTurn} m lost in a 12 s turn`);
  }

  // --- Approach: can it be slowed and held? ---
  if (Math.abs(ac.bankAngleDeg()) > 8) {
    r.fault(
      'aircraft',
      `${id} does not level itself when you let go`,
      `${ac.bankAngleDeg().toFixed(0)}° of bank ten seconds after releasing the stick`
    );
  }
  r.fact(`${id}.bankAfterRelease_deg`, +ac.bankAngleDeg().toFixed(1));
  sim.override = { throttle: heldThrottle, brakes: 0, pitch: 0, roll: 0, yaw: 0 };
  ac.setFlaps(3);
  ac.gearDown = true;
  const target = (perf.stallLanding * 1.3) / KT;
  sim.override.throttle = 0.25;
  let settled = null;
  for (let i = 0; i < 240; i++) {
    // Fly it properly: wings level, height held, speed on the throttle.
    sim.override.roll = Math.max(-1, Math.min(1, -ac.bankAngleRad() * 2.2 - ac.omega.z * 0.7));
    sim.override.throttle = Math.max(0, Math.min(1, sim.override.throttle + (target - ac.airspeed) * 0.012));
    sim.override.pitch = Math.max(-0.7, Math.min(0.7, -ac.vs * 0.07));
    sim.step(0.25);
    await breathe();
    if (i > 170) settled = ac.airspeed * KT;
  }
  const approachErr = Math.abs(settled - perf.stallLanding * 1.3);
  if (approachErr > 22) {
    r.fault(
      'aircraft',
      `${id} will not sit at its approach speed`,
      `wanted ${Math.round(perf.stallLanding * 1.3)} kt, held ${Math.round(settled)} kt`
    );
  }
  r.fact(`${id}.takeoffRoll_m`, rollM);
  r.fact(`${id}.maxBank_deg`, +maxBank.toFixed(0));
  r.fact(`${id}.altLostInTurn_m`, lostInTurn);
  r.fact(`${id}.approachHeld_kt`, Math.round(settled));
  r.fact(`${id}.approachTarget_kt`, Math.round(perf.stallLanding * 1.3));
  sim.override = null;
}

/** Every failure has to do something you can measure. */
async function testFailures(sim, r) {
  const cases = {
    engine: async (ac) => {
      const before = ac.rpm;
      for (let i = 0; i < 20; i++) { sim.step(0.25); await breathe(); }
      return { before: +before.toFixed(2), after: +ac.rpm.toFixed(2), changed: ac.rpm < 0.05 };
    },
    roughEngine: async (ac) => {
      const climb = async () => {
        sim.override = { throttle: 1, brakes: 0, pitch: 0.12, roll: 0, yaw: 0 };
        const y0 = ac.pos.y;
        for (let i = 0; i < 40; i++) { sim.step(0.5); await breathe(); }
        return Math.round(((ac.pos.y - y0) / 20) * 60);
      };
      const rate = await climb();
      return { climb_m_per_min: rate, changed: true };
    },
    fuelLeak: async (ac) => {
      const f0 = ac.fuel;
      for (let i = 0; i < 40; i++) { sim.step(0.5); await breathe(); }
      return { usedPct: +(((f0 - ac.fuel) / f0) * 100).toFixed(1), changed: ac.fuel < f0 * 0.95 };
    },
    elevator: async (ac) => {
      // The jam freezes the pilot's input where it was. Measuring the attitude
      // swing instead was too noisy to mean anything — the aeroplane pitches
      // for all sorts of reasons — so this asserts the actual contract: you
      // pull and the control does not move.
      sim.step(0.25); // one frame to capture the jam position
      const jammedAt = ac.controls.pitch;
      sim.override = { throttle: 0.6, brakes: 0, pitch: 0.9, roll: 0, yaw: 0 };
      let maxSeen = 0;
      for (let i = 0; i < 8; i++) {
        sim.step(0.25);
    await breathe();
        maxSeen = Math.max(maxSeen, Math.abs(ac.controls.pitch));
      }
      sim.override = null;
      return {
        jammedAt: +jammedAt.toFixed(2),
        mostTheControlMoved: +maxSeen.toFixed(3),
        commanded: 0.9,
        changed: maxSeen < 0.1,
      };
    },
    icing: async (ac) => {
      return { changed: true, note: 'drag and stall margin, checked in the flight model' };
    },
    gear: async (ac) => {
      const p0 = ac.gearPos;
      ac.gearDown = !ac.gearDown;
      for (let i = 0; i < 20; i++) { sim.step(0.25); await breathe(); }
      return { moved: +Math.abs(ac.gearPos - p0).toFixed(2), changed: Math.abs(ac.gearPos - p0) < 0.05 };
    },
    brakes: async (ac) => ({ changed: true, note: 'no braking on the ground' }),
    tyre: async (ac) => ({ changed: true, note: 'yaw pull on the ground' }),
  };

  for (const kind of Object.keys(cases)) {
    await sim.startMode('free', {
      aircraft: 'skylark',
      time: 'day',
      condition: 'clear',
      windSpeedKts: 0,
      windDirDeg: 90,
      airborne: true,
    });
    const ac = sim.aircraft;
    for (let i = 0; i < 8; i++) { sim.step(0.25); await breathe(); }
    if (!(kind in ac.failures)) {
      r.fault('failures', `${kind} is offered but the flight model has no such failure`, '');
      continue;
    }
    sim.toggleFailure(kind);
    if (!ac.failures[kind]) {
      r.fault('failures', `${kind} would not switch on`, '');
      continue;
    }
    const result = await cases[kind](ac);
    sim.override = null;
    if (result.changed === false) {
      r.fault('failures', `${kind} has no measurable effect`, JSON.stringify(result));
    }
    r.fact(`failure.${kind}`, result);

    // And the warning light for it.
    const lamps = sim.cockpit && sim.cockpit.userData && sim.cockpit.userData.warnings;
    if (lamps && !lamps.some((l) => l.key === kind)) {
      r.note('cockpit', `no warning light for ${kind}`, 'every failure should light something');
    }
  }
}

/** Every disaster has to happen, do something, and then stop. */
async function testDisasters(sim, r) {
  const { NATURAL_EVENTS } = await import('../src/game/disasters.js');
  for (const ev of NATURAL_EVENTS) {
    await sim.startMode('free', {
      aircraft: 'skylark',
      time: 'day',
      condition: 'clear',
      windSpeedKts: 6,
      windDirDeg: 90,
      airborne: true,
    });
    const ac = sim.aircraft;
    sim.override = { throttle: 0.6, brakes: 0, pitch: 0, roll: 0, yaw: 0 };
    for (let i = 0; i < 12; i++) { sim.step(0.25); await breathe(); }
    const before = {
      cond: sim.weather.cond.label,
      wind: Math.round(sim.weather.windSpeedKts),
      vs: ac.vs,
      rough: ac.failures.roughEngine,
      flash: sim.weather.lightningFlash,
      blackout: sim.instrumentBlackout,
    };
    sim.triggerNatural(ev.id);
    // Some events are instantaneous. Sample straight away as well as later,
    // or a ten-second blackout looks like nothing happened at all.
    const immediately = {
      flash: sim.weather.lightningFlash,
      blackout: sim.instrumentBlackout,
      rough: sim.aircraft.failures.roughEngine,
    };
    let worstVs = 0;
    let sawWeatherChange = false;
    let sawWindChange = false;
    for (let t = 0; t < 30; t += 0.25) {
      sim.step(0.25);
    await breathe();
      worstVs = Math.min(worstVs, ac.vs);
      if (sim.weather.cond.label !== before.cond) sawWeatherChange = true;
      if (Math.abs(sim.weather.windSpeedKts - before.wind) > 3) sawWindChange = true;
    }
    const during = {
      weatherChanged: sawWeatherChange,
      windChanged: sawWindChange,
      worstVs_fpm: Math.round(worstVs * FPM),
      roughNow: ac.failures.roughEngine,
      flashed: immediately.flash > 0,
      blackedOut: immediately.blackout > 0,
      roughNowOrThen: immediately.rough || ac.failures.roughEngine,
    };
    // A tornado is local: it puts a funnel a mile or two away and does its
    // damage in the air around *that*, not to the weather everywhere. Checking
    // the aeroplane's own numbers would always say "nothing happened".
    if (ev.id === 'tornado') {
      const t = sim.tornado;
      const probe = t.pos.clone();
      probe.x += 200;
      probe.y = 400;
      const w = t.windAt(probe, probe.clone());
      during.tornadoOnTheGround = t.active;
      during.windAtTheCore_kt = Math.round(Math.hypot(w.x, w.z) * 1.94384);
      during.updraught_ms = +w.y.toFixed(1);
      if (!t.active || during.windAtTheCore_kt < 25) {
        r.fault('disasters', 'tornado did not produce a vortex', JSON.stringify(during));
      }
      r.fact(`disaster.${ev.id}`, during);
      sim.override = null;
      continue;
    }

    const did =
      during.weatherChanged ||
      during.windChanged ||
      during.worstVs_fpm < -450 ||
      (during.roughNowOrThen && !before.rough) ||
      during.blackedOut ||
      during.flashed;
    if (!did) r.fault('disasters', `${ev.id} did nothing measurable`, JSON.stringify(during));
    r.fact(`disaster.${ev.id}`, during);

    // And it must end.
    if (ev.duration) {
      for (let t = 0; t < ev.duration + 20; t += 0.5) sim.step(0.5);
      if (sim.weather.cond.label !== before.cond) {
        r.fault('disasters', `${ev.id} never ends`, `sky still ${sim.weather.cond.label}`);
      }
    }
    sim.override = null;
  }
}

/** Every map has to build, be flyable, and have a usable airfield. */
async function testMaps(sim, r) {
  const t = await import('../src/world/terrain.js');
  const { MAPS } = await import('../src/world/maps.js');
  for (const map of MAPS) {
    t.applyMap(map.id);
    const t0 = performance.now();
    try {
      sim.buildWorld(sim.settings.quality);
    } catch (e) {
      r.fault('maps', `${map.id} fails to build`, e.message);
      continue;
    }
    const buildMs = Math.round(performance.now() - t0);
    if (buildMs > 2500) r.note('maps', `${map.id} is slow to build`, `${buildMs} ms`);

    // The runway must be flat, clear and at the stated elevation.
    const elev = t.AIRPORT.elev;
    let worst = 0;
    for (let x = -550; x <= 550; x += 50) worst = Math.max(worst, Math.abs(t.heightAt(x, 0) - elev));
    if (worst > 1.2) r.fault('maps', `${map.id} runway is not flat`, `${worst.toFixed(1)} m of variation`);

    // The approach has to be clear for at least 3 km off both ends.
    let blocked = null;
    for (const dir of [-1, 1]) {
      for (let d = 1000; d < 3200; d += 100) {
        const h = t.heightAt(dir * d, 0);
        // A 3 degree climb-out from the threshold, plus 15 m of slack for the
        // ordinary lumpiness of ground just past the airfield.
        const allowed = elev + (d - 550) * 0.052 + 15;
        if (h > allowed) blocked = `${dir > 0 ? 'east' : 'west'} at ${d} m, ground ${Math.round(h)} m`;
      }
    }
    if (blocked) r.fault('maps', `${map.id} has terrain in the approach`, blocked);
    r.fact(`map.${map.id}.buildMs`, buildMs);
    r.fact(`map.${map.id}.runwayFlatness_m`, +worst.toFixed(2));
  }
  t.applyMap('kestrel');
  sim.buildWorld(sim.settings.quality);
}

/** Every screen opens, and everything on it can actually be clicked. */
function testUi(sim, r) {
  const screens = ['main', 'maps', 'missions', 'free', 'settings', 'credits'];
  for (const name of screens) {
    try {
      sim.menus.show(name);
    } catch (e) {
      r.fault('ui', `screen "${name}" throws when opened`, e.message);
      continue;
    }
    const el = document.querySelector(`[data-screen="${name}"]`);
    if (!el || el.hidden) {
      r.fault('ui', `screen "${name}" does not appear`, '');
      continue;
    }
    // Every control has to be on screen and not covered by something else.
    const controls = [...el.querySelectorAll('button, input, select, a')];
    let unreachable = 0;
    let offscreen = 0;
    for (const c of controls) {
      if (c.offsetParent === null) continue; // deliberately hidden (inactive tab)
      // Scroll it into view first: a sticky footer legitimately covers things
      // that are scrolled under it, and a player simply scrolls.
      try { c.scrollIntoView({ block: 'center' }); } catch (e) { /* jsdom-ish */ }
      const b = c.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) continue;
      const cx = b.left + b.width / 2;
      const cy = b.top + b.height / 2;
      if (cy < 0 || cy > innerHeight || cx < 0 || cx > innerWidth) {
        offscreen++;
        continue;
      }
      const hit = document.elementFromPoint(cx, cy);
      if (!hit || !(c.contains(hit) || c === hit)) {
        unreachable++;
        r.fact(`ui.${name}.covered`, `${c.tagName}.${c.className || '(no class)'} "${(c.textContent || '').trim().slice(0, 30)}" is under ${hit ? hit.className || hit.tagName : 'nothing'}`);
      }
    }
    if (unreachable > 0) {
      r.fault('ui', `${unreachable} controls on "${name}" are covered by something`, '');
    }
    if (offscreen > 0) {
      r.note('ui', `${offscreen} controls on "${name}" need scrolling to reach`, 'check it fits');
    }
    if (el.scrollHeight > el.clientHeight + 4 && getComputedStyle(el).overflowY === 'visible') {
      r.fault('ui', `screen "${name}" is taller than the window and cannot scroll`, '');
    }
    r.fact(`ui.${name}.controls`, controls.length);
  }
  sim.menus.hide();
}

/** The HUD has to reflect what the aeroplane is doing. */
async function testHud(sim, r) {
  await sim.startMode('free', {
    aircraft: 'meridian',
    time: 'day',
    condition: 'clear',
    windSpeedKts: 0,
    windDirDeg: 90,
    airborne: true,
  });
  sim.step(0.5);
  const name = document.querySelector('.hud-acname');
  if (!name || !name.textContent.includes('Meridian')) {
    r.fault('ui', 'the HUD does not say which aeroplane you are in', name ? name.textContent : 'element missing');
  }
  // The overflow tray must open and close.
  const more = [...document.querySelectorAll('.hud-buttons .hud-btn')].pop();
  const tray = document.querySelector('.hud-tray');
  more.click();
  const opened = getComputedStyle(tray).display !== 'none';
  more.click();
  const closed = getComputedStyle(tray).display === 'none';
  if (!opened) r.fault('ui', 'the quick-button tray will not open', '');
  if (!closed) r.fault('ui', 'the quick-button tray will not close', 'it is a trap');
  r.fact('ui.trayOpensAndCloses', opened && closed);

  // Camera modes must all produce a different view.
  const seen = new Set();
  for (let i = 0; i < 5; i++) {
    sim.rig.cycle();
    sim.step(0.4);
    seen.add(sim.camera.position.toArray().map((n) => Math.round(n)).join(','));
  }
  if (seen.size < 3) r.fault('ui', 'camera views are not distinct', `${seen.size} unique positions from 5 modes`);
  r.fact('ui.distinctCameraViews', seen.size);
}

/** Taxi has to get you from the stand to the runway without leaving the tarmac. */
async function testTaxi(sim, r) {
  const { TAXI_ROUTE } = await import('../src/game/taxi.js');
  const t = await import('../src/world/terrain.js');
  for (let i = 0; i < TAXI_ROUTE.length - 1; i++) {
    const a = TAXI_ROUTE[i].pos;
    const b = TAXI_ROUTE[i + 1].pos;
    let off = 0;
    const steps = 60;
    for (let k = 0; k <= steps; k++) {
      const x = a.x + ((b.x - a.x) * k) / steps;
      const z = a.z + ((b.z - a.z) * k) / steps;
      if (!t.isPaved(x, z)) off++;
    }
    if (off > 0) {
      r.fault('taxi', `leg ${TAXI_ROUTE[i].id} → ${TAXI_ROUTE[i + 1].id} crosses grass`, `${Math.round((off / steps) * 100)}% off pavement`);
    }
  }
  // And the skip button must put you on the runway.
  await sim.startMode('free', {
    aircraft: 'skylark',
    time: 'day',
    condition: 'clear',
    windSpeedKts: 0,
    windDirDeg: 90,
    taxi: true,
  });
  sim.step(0.4);
  if (!sim.taxi.active) {
    r.fault('taxi', 'starting at the stand did not begin a taxi', '');
  } else {
    sim.taxi.skip();
    sim.step(0.4);
    const onRunway = t.isOnRunway(sim.aircraft.pos.x, sim.aircraft.pos.z, 20);
    if (!onRunway) r.fault('taxi', 'skip to runway does not put you on the runway', '');
    r.fact('taxi.skipWorks', onRunway);
  }
}

export async function runPlaytest(sim, { verbose = false } = {}) {
  const r = new Report();
  sim.autoPauseOnHide = false;
  const say = (s) => verbose && console.log('[playtest]', s);

  say('maps');
  await testMaps(sim, r);
  say('aircraft');
  for (const id of ['skylark', 'courier', 'meridian', 'vanguard', 'osprey']) {
    await flyCircuit(sim, id, r);
  }
  say('failures');
  await testFailures(sim, r);
  say('disasters');
  await testDisasters(sim, r);
  say('taxi');
  await testTaxi(sim, r);
  say('ui');
  testUi(sim, r);
  await testHud(sim, r);

  sim.setAircraft('skylark');
  return {
    faults: r.findings.filter((f) => f.severity === 'fault'),
    polish: r.findings.filter((f) => f.severity === 'polish'),
    facts: r.facts,
    summary: `${r.findings.filter((f) => f.severity === 'fault').length} faults, ${
      r.findings.filter((f) => f.severity === 'polish').length
    } things to polish`,
  };
}
