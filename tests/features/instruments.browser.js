/**
 * Browser checks for the instruments team: the cockpit warning system
 * (src/features/warnings.js) and the minimap (src/ui/minimap.js).
 *
 *   const { check } = await import('./tests/features/instruments.browser.js');
 *   const r = { checks: [], ok(n, p, d) { this.checks.push({ n, p: !!p, d }); return !!p; } };
 *   await check(window.__sim, r, console.log); console.table(r.checks);
 *
 * Two promises are tested, and the second matters as much as the first:
 *
 *   1. every warning fires in its own condition, flown for real through the
 *      flight model rather than faked by writing numbers into the readouts;
 *   2. NONE of them fires in a normal circuit — take-off, climb, a turn, an
 *      approach and a landing, flown by the same controller the main suite
 *      lands with — and the radio altitude callouts come out in order.
 *
 * And the minimap draws in the aeroplane, the boat and the van without an
 * error, shows the objective in the boat and the van, and keeps quiet about
 * terrain on a normal approach.
 *
 * Everything is imported dynamically and every contract is read defensively,
 * so a missing piece is one failed line, not a dead suite.
 */

const FT = 3.28084;
const FPM = 196.85;
const KTS = 1.94384;

/** What was lit at any moment during `fn`, and what was played. */
function watch(sim) {
  const seen = new Set();
  const W = sim.warnings;
  const start = W.logN;
  return {
    seen,
    sample() {
      for (const id of W.active()) seen.add(id);
    },
    plays() {
      return W.log.filter((p) => p.n > start);
    },
  };
}

/** Step the game `seconds`, sampling what is lit every frame. */
function run(sim, seconds, w, each) {
  const dt = 1 / 30;
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    if (each) each(i * dt);
    sim.update(dt);
    if (w) w.sample();
    if (sim.aircraft.crashed) break;
  }
}

/**
 * The same trouble said twice on screen: a panel row beside the game's own
 * toast (main.js) or the HUD's STALL slab. Returns the row's title, or null.
 */
function saidTwice(sim) {
  const rows = [];
  for (const el of document.querySelectorAll('.wx-row')) {
    if (el.hidden || el.offsetParent === null) continue;
    const b = el.querySelector('b');
    if (b) rows.push(b.textContent);
  }
  if (!rows.length) return null;
  const hud = sim.hud || {};
  const toasts = (hud.toasts || []).map((t) => (t.node && t.node.textContent) || '');
  const slab = !!(hud.stallWarn && hud.stallWarn.style.display !== 'none');
  if (rows.includes('STALL') && (slab || toasts.some((t) => /^Stall!/.test(t)))) return 'STALL';
  if (rows.includes('OVERSPEED') && toasts.some((t) => /^Too fast/.test(t))) return 'OVERSPEED';
  if (rows.includes('LOW FUEL') && toasts.some((t) => /^Low fuel/.test(t))) return 'LOW FUEL';
  if (rows.includes('ENGINE OFF') && toasts.some((t) => /^Engine off$/.test(t))) return 'ENGINE OFF';
  return null;
}

function allUp(sim) {
  for (const code of ['ShiftLeft', 'ControlLeft', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'Space']) sim.key(code, false);
}

/**
 * Hold a vertical speed (ft/min) and a heading with the stick, as a pilot
 * would. Damped on pitch rate and softer at speed: the main suite's
 * approach gain (1/700 per ft/min, undamped) is fine at 68 kt with the wheels
 * almost down, but measured at 105 kt it porpoised between -12 and +15
 * degrees of alpha every 0.7 s — which lit the stall warning, correctly, and
 * would have been a test of the controller rather than of the warnings.
 */
function holdVs(sim, wantFpm, wantHdg = 90, maxBank = 20) {
  const ac = sim.aircraft;
  const vs = ac.vs * FPM;
  const k = 1 / (500 + ac.ias * KTS * 9);
  const hdgErr = ((ac.heading - wantHdg + 540) % 360) - 180;
  const wantBank = Math.max(-maxBank, Math.min(maxBank, -hdgErr * 0.8));
  sim.override = {
    pitch: Math.max(-0.6, Math.min(0.85, (wantFpm - vs) * k - ac.omega.x * 2.5)),
    roll: Math.max(-0.7, Math.min(0.7, (wantBank - ac.bankAngleDeg()) / 16 - ac.omega.z * 0.3)),
    yaw: 0,
  };
}

/**
 * A normal approach to runway 09: down a glide path of `deg` degrees to the
 * touchdown point at 68 kt, flare in the last few metres, track the
 * centreline, brake to a stop. The flare and the speed and lateral control
 * are the main suite's; the pitch loop is holdVs's damped one.
 */
function flyApproach(sim, w, { deg = 3.6, seconds = 220, touchdownX = -350, elev = 14 } = {}) {
  const ac = sim.aircraft;
  const dt = 1 / 30;
  const tan = Math.tan((deg * Math.PI) / 180);
  let t = 0;
  let worstSink = 0;
  let flareAlpha = 0;
  while (t < seconds) {
    const aglFt = ac.agl * FT;
    const iasKt = ac.ias * KTS;
    const toGo = touchdownX - ac.pos.x;
    const wantY = elev + Math.max(0, toGo) * tan;
    let wantVs = -Math.max(10, ac.groundSpeed) * tan * FPM + (wantY - ac.pos.y) * 25;
    wantVs = Math.max(-900, Math.min(200, wantVs));
    if (aglFt < 25) wantVs = -110;
    if (aglFt < 10) wantVs = -35;
    sim.input.throttleTarget = Math.max(0, Math.min(1, 0.42 + ((68 - iasKt) / 25) * 0.5 - (aglFt < 20 ? 0.42 : 0)));
    const lateral = ac.pos.z;
    const hdgErr = ((ac.heading - 90 + 540) % 360) - 180;
    const wantBank = Math.max(-14, Math.min(14, -lateral * 0.35 - hdgErr * 0.9));
    const k = 1 / (500 + iasKt * 9);
    sim.override = {
      pitch: Math.max(-0.6, Math.min(0.85, (wantVs - ac.vs * FPM) * k - ac.omega.x * 2.5)),
      roll: Math.max(-0.7, Math.min(0.7, (wantBank - ac.bankAngleDeg()) / 16)),
      yaw: Math.max(-0.6, Math.min(0.6, -hdgErr / 26)),
    };
    sim.update(dt);
    if (w) w.sample();
    t += dt;
    if (!ac.onGround && aglFt < 400) worstSink = Math.max(worstSink, -ac.vs * FPM);
    if (!ac.onGround && aglFt < 15) flareAlpha = Math.max(flareAlpha, (ac.alpha * 180) / Math.PI);
    if (ac.crashed) break;
    if (ac.onGround && ac.groundSpeed < 3 && ac.groundTime > 1) break;
    if (ac.onGround && ac.groundTime > 0.2) {
      sim.override = { pitch: 0, roll: 0, yaw: 0 };
      sim.input.throttleTarget = 0;
      sim.key('Space', true);
    }
  }
  sim.key('Space', false);
  sim.override = null;
  return { t, worstSink, flareAlpha };
}

/** terrain.js, the game's own instance; set in check(). */
let TERRAIN = null;

/**
 * Put the aeroplane somewhere, flying. `agl` is metres above the SURFACE —
 * land or water — because reset()'s altAGL is above heightAt, which at sea is
 * the sea floor.
 */
function placeAirborne(sim, { x = -3400, z = 0, hdg = 90, speed = 58, agl = 610, gear = true, flaps = 0, thr = 0.62 } = {}) {
  const ac = sim.aircraft;
  const V = ac.pos.constructor;
  const g = TERRAIN ? TERRAIN.heightAt(x, z) : 0;
  ac.reset({ pos: new V(x, 0, z), headingDeg: hdg, speed, altAGL: agl + Math.max(0, -g), engineOn: true, gearDown: gear });
  ac.setFlaps(flaps);
  ac.controls.throttle = thr;
  sim.input.throttleTarget = thr;
  sim.input.out.throttle = thr;
  sim.warnings.reset();
}

async function freeFlight(sim, aircraft = 'skylark', extra = {}) {
  if (sim.mode === 'drive' && sim.stopDrive) sim.stopDrive();
  await sim.startMode('free', {
    aircraft,
    time: 'day',
    condition: 'clear',
    windSpeedKts: 0,
    windDirDeg: 90,
    airborne: false,
    taxi: false,
    // AI traffic's TCAS calls would sit over the PAPI and approach checks.
    traffic: false,
    ...extra,
  });
  if (sim.state === 'paused') sim.resume();
  allUp(sim);
  sim.override = null;
}

export async function check(sim, r, say = () => {}) {
  const log = (...a) => say('[instruments]', ...a);
  let ext = null;
  try {
    ext = await import('../../src/game/extensions.js');
  } catch (e) {
    r.ok('instruments: extension layer loads', false, e.message);
    return r;
  }
  const status = ext.extStatus().find((e) => e.id === 'warnings');
  r.ok('instruments: warnings feature is registered and live', status && status.live, JSON.stringify(status));
  if (!sim.warnings) {
    r.ok('instruments: sim.warnings exists', false, 'feature not installed — add it to src/features/index.js');
    return r;
  }
  const W = sim.warnings;
  const origRender = sim.renderer.render;
  sim.renderer.render = () => {};
  const origAutoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const before = { map: sim.settings.map, aircraft: sim.settings.aircraft };
  // The same module instance the game uses, so the live bindings are live.
  const T = await import('../../src/world/terrain.js');
  TERRAIN = T;
  const AL = await import('../../src/audio/alerts.js');

  try {
    if (sim.settings.map !== 'kestrel') {
      sim.setMap('kestrel');
      await new Promise((f) => setTimeout(f, 150));
    }

    /* ---------------- 1. The normal circuit ---------------- */
    log('normal circuit');
    await freeFlight(sim, 'skylark');
    const w = watch(sim);
    const ac = sim.aircraft;
    // On the ground with the engine running: nothing.
    run(sim, 2, w);
    r.ok('instruments: nothing lit on the runway before take-off', w.seen.size === 0, [...w.seen].join(', ') || 'clear');
    // Take-off: full power, rotate at 56 kt, climb at 600 ft/min.
    sim.key('ShiftLeft', true);
    let t = 0;
    while (ac.ias * KTS < 56 && t < 40) {
      run(sim, 0.5, w);
      t += 0.5;
    }
    sim.key('ShiftLeft', false);
    sim.input.throttleTarget = 1;
    run(sim, 5, w, () => (sim.override = { pitch: 0.5 }));
    run(sim, 90, w, () => {
      if (ac.agl * FT < 1000) holdVs(sim, 650, 90);
      else holdVs(sim, 0, 90);
    });
    const climbedFt = ac.agl * FT;
    // Level, power back, a 25-degree turn through ninety degrees and back.
    sim.input.throttleTarget = 0.62;
    run(sim, 15, w, () => holdVs(sim, 0, 90));
    run(sim, 25, w, () => holdVs(sim, 0, 180, 25));
    run(sim, 25, w, () => holdVs(sim, 0, 90, 25));
    const circuitSeen = [...w.seen];
    r.ok(
      'instruments: take-off, climb to 1,000 ft and turns light nothing',
      circuitSeen.length === 0 && !ac.crashed && climbedFt > 700,
      `${circuitSeen.join(', ') || 'clear'} · climbed to ${climbedFt.toFixed(0)} ft`
    );
    /*
     * An approach: established on a 3.6-degree path three miles out with
     * flaps, then down to a landing — a child's approach, a little steep,
     * which must still be quiet. The PAPI's own three degrees is the next
     * check.
     */
    const tan36 = Math.tan((3.6 * Math.PI) / 180);
    placeAirborne(sim, { x: -5200, agl: 14 + (5200 - 350) * tan36, speed: 36, flaps: 2, thr: 0.4 });
    const w2 = watch(sim);
    const mmWarned = { n: 0 };
    let flareStall = false;
    const app = flyApproach(sim, {
      sample() {
        w2.sample();
        if (sim.minimap && sim.minimap.warn && sim.minimap.warn.style.display !== 'none') mmWarned.n++;
        if (!ac.onGround && ac.agl < 15 && AL.stallWarning(ac, false)) flareStall = true;
      },
    });
    const landed = ac.onGround && !ac.crashed;
    r.ok('instruments: the approach lands', landed, `${app.t.toFixed(0)} s, worst sink ${app.worstSink.toFixed(0)} ft/min below 400 ft`);
    r.ok(
      'instruments: a normal approach and landing light nothing',
      w2.seen.size === 0,
      [...w2.seen].join(', ') || `clear · peak alpha in the flare ${app.flareAlpha.toFixed(1)}°`
    );
    const callouts = w2.plays().filter((p) => p.sound === 'radioAltitude').map((p) => p.arg);
    r.ok(
      'instruments: radio altitude callouts 100 50 40 30 20 10, in order, once each',
      callouts.join(' ') === '100 50 40 30 20 10',
      callouts.join(' ') || 'none'
    );
    r.ok('instruments: the minimap does not cry TERRAIN on a normal approach', mmWarned.n === 0, `${mmWarned.n} frames red`);
    r.ok('instruments: the stall warner is quiet through the flare', !flareStall, `peak alpha ${app.flareAlpha.toFixed(1)}°`);

    /*
     * The approach the game TEACHES: the PAPI's own three degrees to the
     * touchdown point, "two white, two red". The one above is flown at 3.6,
     * which the reviewer rightly said is not it.
     *
     * On the terrain this branch was built on, that path goes 3.6 m into a
     * 44 m ridge 500 m short of the touchdown point, and every approach the
     * reviewer flew in the PAPI's on-path band crashed there — after TERRAIN
     * and then PULL UP, which is the warning doing its job on a map that is
     * wrong. terrain.js's approachCeiling fixes the map (on the integration
     * branch, 8afe952: the ground stays 12 m under that path). So this
     * measures the map first and checks whichever promise applies, and its
     * name says which: a quiet landing where the path is clear, and TERRAIN
     * before the ground where it is not.
     */
    {
      const AP = await import('../../src/world/airport.js');
      const td = AP.RUNWAY && AP.RUNWAY.touchdown ? AP.RUNWAY.touchdown.x : -350;
      const elev = T.AIRPORT.elev;
      const tan3 = Math.tan((3 * Math.PI) / 180);
      let worst = Infinity;
      let at = 0;
      for (let x = td - 5000; x <= AP.RUNWAY.thresholdWest.x; x += 25) {
        const c = elev + (td - x) * tan3 - Math.max(0, T.heightAt(x, T.AIRPORT.runway.cz));
        if (c < worst) {
          worst = c;
          at = x;
        }
      }
      const where = `${Math.abs(worst).toFixed(1)} m ${worst >= 0 ? 'above' : 'into'} the ground at its closest, ${Math.round(td - at)} m before the touchdown point`;
      await freeFlight(sim, 'skylark');
      placeAirborne(sim, { x: -5200, agl: elev + (td + 5200) * tan3, speed: 36, flaps: 2, thr: 0.4 });
      const wp = watch(sim);
      let first = null;
      // How close the wheels came to the ground short of the runway.
      let closest = Infinity;
      const thrX = AP.RUNWAY.thresholdWest.x;
      flyApproach(
        sim,
        {
          sample() {
            wp.sample();
            if (!first && W.active().length) first = `${W.active().join(', ')} at ${(ac.agl * FT).toFixed(0)} ft, ${Math.round(td - ac.pos.x)} m out`;
            if (!ac.onGround && ac.pos.x < thrX) closest = Math.min(closest, ac.pos.y - Math.max(0, T.heightAt(ac.pos.x, ac.pos.z)));
          },
        },
        { deg: 3, touchdownX: td, elev }
      );
      const outcome = ac.crashed ? 'crashed' : ac.onGround ? 'landed' : 'still flying';
      if (worst >= 5) {
        const co = wp.plays().filter((p) => p.sound === 'radioAltitude').map((p) => p.arg).join(' ');
        r.ok(
          "instruments: the PAPI's own 3-degree approach lands, lights nothing and calls 100 to 10",
          outcome === 'landed' && wp.seen.size === 0 && co === '100 50 40 30 20 10',
          `${outcome}; ${first || 'nothing lit'}; callouts ${co || 'none'}; the path is ${where}`
        );
      } else {
        /*
         * The path is into the ground, so what is flown along it depends on
         * how exactly it is flown: this controller rides a few metres above
         * the line and scrapes over; the reviewer's hand-flown approaches
         * inside the PAPI band hit. Either is allowed. What is not: hitting
         * the ridge with nothing lit first, or lighting TERRAIN on a landing
         * that never came within twenty metres of anything.
         */
        const warned = wp.seen.has('terrain') || wp.seen.has('pullup') || wp.seen.has('terrainAhead');
        const silentCrash = ac.crashed && !warned;
        const nag = outcome === 'landed' && warned && closest > 20;
        r.ok(
          "instruments: the PAPI's 3-degree path is into the ground here (terrain.js): no crash without TERRAIN first, no TERRAIN on a landing that clears it",
          !silentCrash && !nag && outcome !== 'still flying',
          `${first || 'nothing lit'}; ${outcome}, closest ${closest.toFixed(1)} m over the ground short of the runway; the path is ${(-worst).toFixed(1)} m into it, ${Math.round(td - at)} m before the touchdown point`
        );
        log(`note for the map: Kestrel 09's 3-degree path is ${where}. Fixed by terrain.js approachCeiling on the integration branch.`);
      }
    }

    /* ---------------- 2. Each warning in its condition ---------------- */
    const lit = (id) => W.isActive(id);

    // SINK RATE / PULL UP: a dive.
    log('sink rate / pull up');
    await freeFlight(sim, 'skylark');
    placeAirborne(sim, { agl: 750, speed: 55, thr: 0.2 });
    let w3 = watch(sim);
    let sinkFirst = null;
    run(sim, 14, w3, () => {
      sim.override = { pitch: -0.55, roll: 0, yaw: 0 };
      if (!sinkFirst && (lit('sinkrate') || lit('pullup'))) sinkFirst = `${(ac.agl * FT).toFixed(0)} ft at ${(-ac.vs * FPM).toFixed(0)} ft/min`;
      if (ac.agl * FT < 250) sim.override = { pitch: 0.9, roll: 0, yaw: 0 };
    });
    sim.override = null;
    r.ok('instruments: SINK RATE in a dive', w3.seen.has('sinkrate'), sinkFirst || [...w3.seen].join(', '));
    r.ok('instruments: PULL UP in a steep dive near the ground', w3.seen.has('pullup'), [...w3.seen].join(', '));
    r.ok(
      'instruments: PULL UP sounds the ground-proximity whoop',
      w3.plays().some((p) => p.id === 'pullup' && p.sound === 'gpwsWarning'),
      w3.plays().map((p) => p.id).join(', ')
    );

    // TERRAIN: level flight at a hillside.
    log('terrain ahead');
    await freeFlight(sim, 'skylark');
    const hill = findHill(T, 150);
    if (hill) {
      const hdg = hill.hdg;
      placeAirborne(sim, { x: hill.x0, z: hill.z0, hdg, agl: 0, speed: 55, thr: 0.62 });
      // placeAirborne put us at ground level: lift to just under the summit.
      ac.pos.y = hill.h - 25;
      ac.reset({ pos: ac.pos.clone(), headingDeg: hdg, speed: 55, altAGL: Math.max(40, hill.h - 25 - hill.g0), engineOn: true });
      sim.input.throttleTarget = 0.62;
      W.reset();
      w3 = watch(sim);
      run(sim, 25, w3, () => {
        holdVs(sim, 0, hdg);
      });
      sim.override = null;
      r.ok(
        'instruments: TERRAIN AHEAD / TERRAIN flying level at a hill',
        w3.seen.has('terrainAhead') || w3.seen.has('terrain') || w3.seen.has('pullup'),
        `${[...w3.seen].join(', ') || 'nothing'} · hill ${hill.h.toFixed(0)} m, ${hill.dist.toFixed(0)} m away`
      );
      r.ok('instruments: the minimap agrees about the hill', w3.seen.size > 0 && W.terrainAheadS !== undefined, `last look-ahead ${W.terrainAheadS}`);
    } else {
      r.ok('instruments: TERRAIN AHEAD / TERRAIN flying level at a hill', false, 'no hill found on Kestrel');
    }

    // DON'T SINK: take off, then let it sink with the power on.
    log("don't sink");
    await freeFlight(sim, 'skylark');
    sim.key('ShiftLeft', true);
    t = 0;
    while (ac.ias * KTS < 56 && t < 40) {
      run(sim, 0.5);
      t += 0.5;
    }
    sim.key('ShiftLeft', false);
    sim.input.throttleTarget = 1;
    run(sim, 5, null, () => (sim.override = { pitch: 0.5 }));
    w3 = watch(sim);
    // The trainer climbs at about 600 ft/min flat out, so 350 ft is 30 s.
    run(sim, 50, w3, () => {
      if (ac.agl * FT < 350 && !w3.sunk) holdVs(sim, 700, 90);
      else {
        w3.sunk = true;
        holdVs(sim, -700, 90);
        if (ac.agl * FT < 150) sim.override = { pitch: 0.6, roll: 0, yaw: 0 };
      }
    });
    sim.override = null;
    r.ok("instruments: DON'T SINK losing height after take-off", w3.seen.has('dontsink'), [...w3.seen].join(', ') || 'nothing');

    // GEAR NOT DOWN: an approach in the Courier with the wheels up.
    log('gear');
    await freeFlight(sim, 'courier');
    placeAirborne(sim, { x: -4200, agl: 200, speed: 40, gear: false, flaps: 1, thr: 0.2 });
    w3 = watch(sim);
    run(sim, 20, w3, () => holdVs(sim, -500, 90));
    const gearLit = w3.seen.has('gear');
    const horn = !!(sim.audio.alerts && sim.audio.alerts.claimed);
    sim.tap('KeyG');
    run(sim, 3, null, () => holdVs(sim, -300, 90));
    sim.override = null;
    r.ok('instruments: GEAR NOT DOWN on an approach with the wheels up', gearLit, [...w3.seen].join(', '));
    r.ok('instruments: GEAR NOT DOWN goes out when the wheels come down', !lit('gear'), W.active().join(', ') || 'clear');
    r.ok('instruments: the warning panel owns the gear horn while it runs', horn || !sim.audio.available, `claimed ${horn}`);

    // TOO LOW — FLAPS: the airliner on short final, gear down, no flap.
    log('flaps');
    await freeFlight(sim, 'meridian');
    placeAirborne(sim, { x: -2200, agl: 90, speed: 62, gear: true, flaps: 0, thr: 0.35 });
    w3 = watch(sim);
    run(sim, 10, w3, () => holdVs(sim, -500, 90));
    sim.override = null;
    r.ok('instruments: TOO LOW — FLAPS in the airliner, low with no flap', w3.seen.has('flaps'), [...w3.seen].join(', ') || 'nothing');

    // BANK ANGLE.
    log('bank angle');
    await freeFlight(sim, 'skylark');
    placeAirborne(sim, { agl: 700 });
    w3 = watch(sim);
    run(sim, 6, w3, () => {
      const b = ac.bankAngleDeg();
      sim.override = { pitch: 0.15, roll: Math.max(-1, Math.min(1, (62 - b) / 12)), yaw: 0 };
    });
    const bankLit = w3.seen.has('bankangle');
    run(sim, 8, null, () => holdVs(sim, 0, ac.heading, 0));
    sim.override = null;
    r.ok('instruments: BANK ANGLE past 45 degrees in the trainer', bankLit, [...w3.seen].join(', ') || 'nothing');
    r.ok('instruments: BANK ANGLE goes out with the wings level', !lit('bankangle'), W.active().join(', ') || 'clear');

    // STALL.
    log('stall');
    placeAirborne(sim, { agl: 900, speed: 42, thr: 0 });
    w3 = watch(sim);
    const twice = new Set();
    run(sim, 12, w3, () => {
      sim.override = { pitch: 0.9, roll: 0, yaw: 0 };
      const t2 = saidTwice(sim);
      if (t2) twice.add(t2);
    });
    sim.override = null;
    r.ok('instruments: STALL warning with the nose held up and the power off', w3.seen.has('stall'), [...w3.seen].join(', ') || 'nothing');

    // OVERSPEED.
    log('overspeed');
    await freeFlight(sim, 'skylark');
    const vneMs = (await import('../../src/aircraft/physics.js')).SPEC.vne;
    placeAirborne(sim, { agl: 1500, speed: vneMs * 1.06, thr: 1 });
    w3 = watch(sim);
    run(sim, 3, w3, () => {
      sim.override = { pitch: -0.25, roll: 0, yaw: 0 };
      const t2 = saidTwice(sim);
      if (t2) twice.add(t2);
    });
    sim.override = null;
    r.ok('instruments: OVERSPEED above Vne', w3.seen.has('overspeed'), `${[...w3.seen].join(', ') || 'nothing'} · ${(ac.ias * KTS).toFixed(0)} kt`);

    // WINDSHEAR: a microburst on the approach.
    log('windshear');
    placeAirborne(sim, { x: -4800, agl: 240, speed: 36, flaps: 2, thr: 0.4 });
    sim.weather.startShear({ down: 11, headwind: 13, seconds: 40 });
    w3 = watch(sim);
    run(sim, 22, w3, () => holdVs(sim, -400, 90));
    sim.override = null;
    sim.weather.startShear({ down: 0, headwind: 0, seconds: 0.01 });
    run(sim, 0.5);
    r.ok('instruments: WINDSHEAR in a microburst below 1,500 ft', w3.seen.has('windshear'), [...w3.seen].join(', ') || 'nothing');

    // TCAS: the drill's head-on aircraft.
    log('tcas');
    await freeFlight(sim, 'skylark');
    placeAirborne(sim, { agl: 900, speed: 55 });
    const V = ac.pos.constructor;
    W.drillTraffic.length = 0;
    W.drillTraffic.push({
      id: 'check-intruder', typeId: 'skylark', pos: new V(ac.pos.x + 2600, ac.pos.y - 20, 0),
      heading: 270, speed: 55, alt: 0, onGround: false, phase: 'cruise', tcas: true, life: 60,
    });
    w3 = watch(sim);
    let senseSeen = null;
    let mmLevel = 0;
    run(sim, 40, w3, () => {
      holdVs(sim, 0, 90);
      if (W.tcasSense) senseSeen = W.tcasSense;
      mmLevel = Math.max(mmLevel, W.trafficLevel(W.drillTraffic[0] || {}));
    });
    sim.override = null;
    r.ok('instruments: TCAS TRAFFIC for a closing aircraft', w3.seen.has('tcasTA'), [...w3.seen].join(', ') || 'nothing');
    r.ok('instruments: TCAS resolution (CLIMB/DESCEND) when it gets close', w3.seen.has('tcasRA'), `sense ${senseSeen}`);
    r.ok(
      'instruments: CLEAR OF CONFLICT once it has passed',
      w3.plays().some((p) => p.sound === 'tcasClear') && !lit('tcasRA') && !lit('tcasTA'),
      w3.plays().map((p) => p.sound).join(', ')
    );
    r.ok('instruments: the minimap colours the intruder by threat', mmLevel >= 1, `level ${mmLevel}`);
    W.drillTraffic.length = 0;
    // Traffic that is not in the contract (no `phase`) is never an RA.
    placeAirborne(sim, { agl: 900, speed: 55 });
    const escort = { pos: new V(ac.pos.x + 300, ac.pos.y, 40) };
    const savedTraffic = sim.traffic;
    sim.traffic = [escort];
    w3 = watch(sim);
    run(sim, 6, w3, () => {
      escort.pos.x += 55 / 30;
      holdVs(sim, 0, 90);
    });
    sim.traffic = savedTraffic;
    sim.override = null;
    r.ok('instruments: an escort in formation (no phase) is not a TCAS threat', !w3.seen.has('tcasTA') && !w3.seen.has('tcasRA'), [...w3.seen].join(', ') || 'clear');

    // LOW FUEL, FUEL LEAK, ENGINE FAIL, ENGINE FIRE.
    log('fuel and engine');
    await freeFlight(sim, 'skylark', { fuel: 0.1 });
    placeAirborne(sim, { agl: 900 });
    ac.fuel = ac.fuel * 0.1; // reset() refilled it
    w3 = watch(sim);
    run(sim, 2, w3, () => {
      holdVs(sim, 0, 90);
      const t2 = saidTwice(sim);
      if (t2) twice.add(t2);
    });
    r.ok('instruments: LOW FUEL under 12%', w3.seen.has('lowFuel'), `${(ac.fuelFraction() * 100).toFixed(0)}% · ${[...w3.seen].join(', ')}`);
    r.ok(
      "instruments: STALL, OVERSPEED and LOW FUEL are never a panel row beside the game's own words for them",
      twice.size === 0,
      [...twice].join(', ') || 'never twice'
    );
    placeAirborne(sim, { agl: 900 });
    sim.toggleFailure('fuelLeak');
    run(sim, 1.5, w3, () => holdVs(sim, 0, 90));
    r.ok('instruments: FUEL LEAK', lit('fuelLeak'), W.active().join(', '));
    sim.toggleFailure('fuelLeak');
    sim.toggleFailure('engine');
    w3 = watch(sim);
    run(sim, 2, w3, () => holdVs(sim, -300, 90));
    r.ok('instruments: ENGINE FAIL when the engine quits', w3.seen.has('engineFail'), [...w3.seen].join(', '));
    sim.toggleFailure('engine');
    placeAirborne(sim, { agl: 900 });
    W.startFire();
    w3 = watch(sim);
    run(sim, 1.5, w3, () => holdVs(sim, 0, 90));
    const fireLit = lit('engineFire');
    const bell = w3.plays().some((p) => p.sound === 'fireBell');
    sim.key('KeyR', true);
    sim.key('KeyR', false);
    run(sim, 4, w3, () => holdVs(sim, 0, 90));
    r.ok('instruments: ENGINE FIRE rings the fire bell', fireLit && bell, `lit ${fireLit}, bell ${bell}`);
    r.ok(
      'instruments: R pulls the fire handle — fire out, engine on part power',
      !W.fire && w3.seen.has('fireOut') && ac.failures.roughEngine,
      `fire ${W.fire}, rough ${ac.failures.roughEngine}`
    );
    if (ac.failures.roughEngine) sim.toggleFailure('roughEngine');

    // A bird strike sets the engine alight — the one way a fire happens in
    // an ordinary flight — and you can see it, and see it go out.
    log('bird strike');
    placeAirborne(sim, { agl: 900 });
    run(sim, 0.5, null, () => holdVs(sim, 0, 90));
    w3 = watch(sim);
    sim.triggerNatural('birdStrike');
    run(sim, 1.5, w3, () => holdVs(sim, 0, 90));
    const smoke = sim.scene.getObjectByName('engine-fire-smoke');
    const smokeOn = !!(smoke && smoke.visible);
    r.ok('instruments: a bird strike sets the engine on fire', W.fire && w3.seen.has('engineFire'), [...w3.seen].join(', ') || 'nothing');
    r.ok('instruments: an engine fire can be seen — flame and a smoke trail', smokeOn, smoke ? `smoke ${smoke.visible}` : 'no smoke object in the scene');
    sim.key('KeyR', true);
    sim.key('KeyR', false);
    run(sim, 11, w3, () => holdVs(sim, 0, 90));
    r.ok('instruments: after the handle the fire goes out and the smoke clears', !W.fire && !(smoke && smoke.visible), `fire ${W.fire}, smoke ${smoke && smoke.visible}`);
    if (ac.failures.roughEngine) sim.toggleFailure('roughEngine');

    // A lightning strike blacks the panel out with the rest of the instruments.
    log('lightning');
    placeAirborne(sim, { agl: 900 });
    run(sim, 0.5, null, () => holdVs(sim, 0, 90));
    W.startFire();
    run(sim, 0.5, null, () => holdVs(sim, 0, 90));
    const wxRoot = document.querySelector('.wx');
    const shownBefore = !!(wxRoot && !wxRoot.hidden);
    sim.instrumentBlackout = 3;
    w3 = watch(sim);
    run(sim, 1.5, null, () => holdVs(sim, 0, 90));
    const hiddenDuring = !!(wxRoot && wxRoot.hidden);
    const soundsDuring = w3.plays().length;
    run(sim, 3, null, () => holdVs(sim, 0, 90));
    const backAfter = !!(wxRoot && !wxRoot.hidden) && lit('engineFire');
    r.ok(
      'instruments: a lightning strike takes the warning panel out with the instruments, and it comes back',
      shownBefore && hiddenDuring && soundsDuring === 0 && backAfter,
      `before ${shownBefore}, dark ${hiddenDuring} with ${soundsDuring} sounds, back ${backAfter}`
    );
    W.acknowledge();
    run(sim, 3.5, null, () => holdVs(sim, 0, 90));
    if (ac.failures.roughEngine) sim.toggleFailure('roughEngine');

    // Where the panel sits: clear of the map and the HUD, with five lit.
    log('panel layout');
    placeAirborne(sim, { agl: 900 });
    run(sim, 0.5, null, () => holdVs(sim, 0, 90));
    sim.override = null;
    {
      const WM = (await import('../../src/features/warnings.js')).__warnings.W;
      for (const id of ['pullup', 'gear', 'bankangle', 'lowFuel', 'tcasTA']) {
        WM.E.alerts[id].on = true;
        WM.E.alerts[id].acked = false;
      }
      WM.demo = { i: 1e9, t: 1e9, ids: [] }; // hold them lit
      if (WM.ui) WM.ui.fitAt = -1e9;
      run(sim, 0.3);
      const rect = (sel) => {
        const el = document.querySelector(sel);
        return el ? el.getBoundingClientRect() : null;
      };
      const hit = (a, b) => a && b && a.width && b.width && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const pr = rect('.wx-panel');
      const cr = rect('.wx-cmd');
      const clashes = ['.minimap', '.hud-top', '.hud-right', '.hud-buttons', '.hud-left', '.hud-stall'].filter(
        (sel) => hit(pr, rect(`#ui ${sel}`)) || hit(cr, rect(`#ui ${sel}`))
      );
      r.ok(
        'instruments: the warning panel and PULL UP sit clear of the map and the HUD',
        pr && pr.width > 0 && cr && cr.width > 0 && clashes.length === 0,
        clashes.join(', ') || (pr ? `panel ${Math.round(pr.top)}–${Math.round(pr.bottom)} px, ${window.innerWidth}x${window.innerHeight}` : 'no panel')
      );
      WM.demo = null;
      W.reset();
    }

    // Acknowledge: R silences, the lamp stays while the condition does.
    log('acknowledge');
    placeAirborne(sim, { agl: 700 });
    w3 = watch(sim);
    run(sim, 4, w3, () => {
      const b = ac.bankAngleDeg();
      sim.override = { pitch: 0.15, roll: Math.max(-1, Math.min(1, (62 - b) / 12)), yaw: 0 };
    });
    sim.key('KeyR', true);
    sim.key('KeyR', false);
    const afterAck = W.log.length;
    run(sim, 6, null, () => {
      const b = ac.bankAngleDeg();
      sim.override = { pitch: 0.15, roll: Math.max(-1, Math.min(1, (62 - b) / 12)), yaw: 0 };
    });
    const stillLit = lit('bankangle');
    const repeats = W.log.slice(afterAck).filter((p) => p.id === 'bankangle').length;
    run(sim, 6, null, () => holdVs(sim, 0, ac.heading, 0));
    sim.override = null;
    r.ok('instruments: R silences — no repeat after acknowledging, lamp still lit', stillLit && repeats === 0, `lit ${stillLit}, repeats ${repeats}`);

    /*
     * AUTOPILOT OFF: only when it lets go by itself. The first pass wailed
     * when the stick took over — which is what the game tells you to do
     * ("Move the stick to take over") — and when the approach handed the
     * landing back as planned. Its own check asserted the wail for the stick.
     */
    log('autopilot');
    const apOn = () => {
      placeAirborne(sim, { agl: 900 });
      run(sim, 1, null, () => holdVs(sim, 0, 90));
      sim.override = null;
      sim.toggleAutopilot(true);
      run(sim, 2);
      return watch(sim);
    };
    const wailed = (w) => w.plays().some((p) => p.sound === 'autopilotOff');
    w3 = apOn();
    // Pulling on the stick is what makes it let go — the keyboard, because
    // the autopilot reads the player's input, not the test override.
    sim.key('KeyS', true);
    run(sim, 1, w3);
    sim.key('KeyS', false);
    run(sim, 1.5, w3);
    r.ok(
      'instruments: no AUTOPILOT OFF alarm when you take over with the stick',
      !sim.autopilot.engaged && !w3.seen.has('apOff') && !wailed(w3),
      `engaged ${sim.autopilot.engaged} · ${[...w3.seen].join(', ') || 'clear'}`
    );
    {
      // The approach mode's own hand-back, for real: on the 3-degree slope
      // two kilometres out and on the centreline, it says "Established on the
      // approach — landing is yours" and main.js lets go a frame later.
      const AP = await import('../../src/world/airport.js');
      const thr = AP.RUNWAY.thresholdWest;
      const x = thr.x - 2000;
      const z = T.AIRPORT.runway.cz;
      const y = T.AIRPORT.elev + 2000 * Math.tan((3 * Math.PI) / 180);
      placeAirborne(sim, { x, z, hdg: 90, speed: 40, flaps: 2, thr: 0.4, agl: Math.max(30, y - Math.max(0, T.heightAt(x, z))) });
      sim.override = null;
      sim.autopilot.setMode('approach');
      sim.toggleAutopilot(true);
      w3 = watch(sim);
      let said = null;
      run(sim, 3, w3, () => {
        if (!said && sim.autopilot.handedBack) said = sim.autopilot.handedBack;
      });
      w3.said = said;
      sim.autopilot.setMode('hold');
    }
    r.ok(
      'instruments: no AUTOPILOT OFF alarm when the approach hands the landing back',
      !!w3.said && !sim.autopilot.engaged && !w3.seen.has('apOff') && !wailed(w3),
      `"${w3.said || 'no hand-back'}" · engaged ${sim.autopilot.engaged} · ${[...w3.seen].join(', ') || 'clear'}`
    );
    w3 = apOn();
    sim.instrumentBlackout = 2.5;
    run(sim, 1.5, w3);
    const droppedDark = !sim.autopilot.engaged;
    const wailDark = wailed(w3);
    run(sim, 2.5, w3);
    r.ok(
      'instruments: AUTOPILOT OFF when a lightning strike drops it out, told when the instruments come back',
      droppedDark && !wailDark && w3.seen.has('apOff') && wailed(w3),
      `dropped ${droppedDark}, wail while dark ${wailDark}, then ${[...w3.seen].join(', ') || 'nothing'}`
    );
    W.reset();
    placeAirborne(sim, { agl: 900 });
    run(sim, 1, null, () => holdVs(sim, 0, 90));
    sim.override = null;
    sim.toggleAutopilot(true);
    run(sim, 2);
    w3 = watch(sim);
    sim.tap('KeyP');
    run(sim, 2, w3);
    r.ok('instruments: no AUTOPILOT OFF alarm when you switch it off yourself (P)', !sim.autopilot.engaged && !w3.seen.has('apOff'), [...w3.seen].join(', ') || 'clear');

    /* ---------------- 3. The helicopter ---------------- */
    log('helicopter');
    await freeFlight(sim, 'harrier');
    // Kid mode (the heli team's default) never lets the Skyhook sink this fast,
    // on purpose; the warning is for a pilot flying it without the hover assist.
    sim.aircraft.hoverAssist = false;
    placeAirborne(sim, { x: -2000, z: 800, agl: 150, speed: 12, gear: true, thr: 0.15 });
    w3 = watch(sim);
    run(sim, 8, w3, () => {
      sim.override = { pitch: 0, roll: 0, yaw: 0, throttle: 0.12 };
      sim.input.throttleTarget = 0.12;
    });
    sim.override = null;
    sim.aircraft.hoverAssist = true;
    const hornInHeli = !!(sim.audio.alerts && sim.audio.alerts.stallActive);
    r.ok('instruments: helicopter — SINK RATE coming down at 2,500 ft/min', w3.seen.has('sinkrate') || w3.seen.has('pullup'), [...w3.seen].join(', ') || 'nothing');
    r.ok(
      'instruments: helicopter — no stall, gear or flap warnings',
      !w3.seen.has('stall') && !w3.seen.has('gear') && !w3.seen.has('flaps') && !hornInHeli,
      `${[...w3.seen].join(', ')} · stall horn ${hornInHeli}`
    );

    /* ---------------- 4. The minimap ---------------- */
    log('minimap');
    const mm = sim.minimap;
    if (mm) {
      const wasOn = mm.visible;
      mm.toggle(true);
      mm._errors = 0;
      await freeFlight(sim, 'skylark');
      run(sim, 2);
      r.ok('instruments: minimap draws in flight', mm.mode === 'flight' && mm._errors === 0 && mm.chart, `mode ${mm.mode}, errors ${mm._errors}`);
      r.ok('instruments: minimap scale is drawn on the canvas, not over the footer', mm.scaleLabel.style.display === 'none', mm.scaleLabel.textContent);
      const rangeWas = mm.rangeIndex.flight;
      mm.rangeIndex.flight = 1; // 6 km, the default
      // Until the window is built, not a fixed three seconds: the chart has a
      // 3 ms budget a frame, so how long it takes is the machine's speed.
      let waited = 0;
      do {
        run(sim, 0.5);
        waited += 0.5;
      } while (!(mm.windows.relief && mm.windows.relief.cur && mm.windows.relief.cur.done) && waited < 60);
      run(sim, 0.2);
      mm.rangeIndex.flight = rangeWas;
      r.ok(
        'instruments: at 6 km the aeroplane\'s map is the sharp 12 km chart',
        mm.chart && mm.chart.extent === 12000,
        `chart ${mm.chart && mm.chart.extent} m`
      );
      // Not on the menus: the menu layer is see-through and it used to show.
      const flyingShown = mm.el.style.display !== 'none';
      sim.quitToMenu('main');
      sim.update(1 / 30);
      const menuHidden = mm.el.style.display === 'none';
      await freeFlight(sim, 'skylark');
      run(sim, 0.2);
      r.ok(
        'instruments: minimap is on screen in flight and off it on the menus',
        flyingShown && menuHidden && mm.el.style.display !== 'none',
        `flying ${flyingShown}, menu hidden ${menuHidden}`
      );

      // A car job: the objective must be on the map.
      if (sim.startDrive) {
        sim.startDrive('car', { job: 'firstrun' });
        for (let i = 0; i < 40; i++) sim.update(1 / 30);
        const tgt = mm.targetOf(sim);
        const runnerT = sim.runner.activeTarget();
        r.ok('instruments: minimap draws in the van', mm.mode === 'car' && mm._errors === 0, `mode ${mm.mode}, errors ${mm._errors}`);
        r.ok(
          'instruments: minimap shows the job destination in the van',
          !!tgt && !!runnerT && tgt.pos.x === runnerT.pos.x,
          tgt ? `${tgt.label} at ${tgt.pos.x.toFixed(0)}, ${tgt.pos.z.toFixed(0)}` : `none (runner says ${runnerT && runnerT.label})`
        );
        // A free drive: find a place, and its name goes on the map.
        sim.startDrive('car', {});
        for (let i = 0; i < 10; i++) sim.update(1 / 30);
        const roadsGame = sim.islandRoads;
        const unfound = roadsGame && roadsGame.places.find((p) => !p.found && p.pos);
        if (unfound) {
          sim.vehicle.reset({ pos: new V(unfound.pos.x, 0, unfound.pos.z), headingDeg: 0 });
          for (let i = 0; i < 20; i++) sim.update(1 / 30);
          const written = (mm._labels || []).some((l) => l.text === unfound.label);
          r.ok('instruments: a place found on a free drive is written on the map', unfound.found && written, `${unfound.label}: found ${unfound.found}, on the map ${written}`);
        } else {
          r.ok('instruments: a place found on a free drive is written on the map', false, roadsGame ? 'every place already found' : 'no free drive started');
        }
        sim.startDrive('boat', {});
        for (let i = 0; i < 60; i++) sim.update(1 / 30);
        r.ok('instruments: minimap draws in the boat', mm.mode === 'boat' && mm._errors === 0 && mm.chart && mm.chart.kind === 'bathy', `mode ${mm.mode}, errors ${mm._errors}`);
        const boatT = mm.targetOf(sim);
        r.ok('instruments: minimap shows the boat mission objective', !!boatT || sim.runner.status !== 'running', boatT ? boatT.label : 'no running mission');
        // Steer for the beach: SHALLOW WATER before AGROUND.
        const v = sim.vehicle;
        const shoal = findShoal(T, v);
        if (shoal) {
          v.reset({ pos: new V(shoal.x, 0, shoal.z), headingDeg: shoal.hdg });
          W.reset();
          const wb = watch(sim);
          const lever = sim.input;
          sim.key('ShiftLeft', true);
          for (let i = 0; i < 30 * 40 && !v.aground; i++) {
            sim.update(1 / 30);
            wb.sample();
          }
          sim.key('ShiftLeft', false);
          void lever;
          r.ok('instruments: boat — SHALLOW WATER ahead before she grounds', wb.seen.has('shoal'), [...wb.seen].join(', ') || 'nothing');
        } else {
          r.ok('instruments: boat — SHALLOW WATER ahead before she grounds', false, 'no shoal found to steer at');
        }
        r.ok('instruments: minimap still drawing after the boat trip', mm._errors === 0, `errors ${mm._errors}`);
        sim.stopDrive && sim.stopDrive();
      }
      mm.toggle(wasOn);
    }
  } catch (err) {
    r.ok('instruments: checks ran to the end', false, (err && err.stack) || String(err));
  } finally {
    allUp(sim);
    sim.override = null;
    if (W.drillTraffic) W.drillTraffic.length = 0;
    sim.renderer.render = origRender;
    sim.autoPauseOnHide = origAutoPause;
    try {
      if (sim.mode === 'drive' && sim.stopDrive) sim.stopDrive();
      sim.quitToMenu && sim.quitToMenu('main');
      if (before.map && sim.settings.map !== before.map) sim.setMap(before.map);
      if (before.aircraft) sim.settings.aircraft = before.aircraft;
    } catch (e) {
      /* leave it where it is */
    }
  }
  return r;
}

/**
 * A hillside on Kestrel to fly at: the highest ground more than 150 m above
 * the sea, approached from 2.4 km away over lower ground.
 */
function findHill(T, minH) {
  const heightAt = T && T.heightAt;
  if (!heightAt) return null;
  let best = null;
  for (let x = -9000; x <= 9000; x += 300) {
    for (let z = -9000; z <= 9000; z += 300) {
      const h = heightAt(x, z);
      if (h > minH && (!best || h > best.h)) best = { x, z, h };
    }
  }
  if (!best) return null;
  // Come in from whichever side the ground 2.4 km out is lowest.
  let pick = null;
  for (let a = 0; a < 360; a += 30) {
    const x0 = best.x - Math.sin((a * Math.PI) / 180) * 2400;
    const z0 = best.z + Math.cos((a * Math.PI) / 180) * 2400;
    const g0 = heightAt(x0, z0);
    if (!pick || g0 < pick.g0) pick = { x0, z0, g0, hdg: a };
  }
  return { ...best, ...pick, dist: 2400 };
}

/** Somewhere near the boat with open water, pointing at the shallows. */
function findShoal(T, v) {
  const depth = T && T.depthUnderKeel;
  if (!depth) return null;
  for (let r = 200; r <= 2400; r += 200) {
    for (let a = 0; a < 360; a += 20) {
      const x = v.pos.x + Math.sin((a * Math.PI) / 180) * r;
      const z = v.pos.z - Math.cos((a * Math.PI) / 180) * r;
      if (depth(x, z, 1) > 3) continue;
      // Back off 700 m along the same line into deep water.
      for (let back = 500; back <= 1400; back += 150) {
        const x0 = x - Math.sin((a * Math.PI) / 180) * back;
        const z0 = z + Math.cos((a * Math.PI) / 180) * back;
        if (depth(x0, z0, 1) > 4) return { x: x0, z: z0, hdg: a };
      }
    }
  }
  return null;
}
