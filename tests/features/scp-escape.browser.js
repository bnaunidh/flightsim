/**
 * Browser checks for "Last Flight Out" (src/game/extra/scp-escape.js,
 * src/features/scp-escape.js) in the real game; the node side is
 * tests/features/scp-escape.mjs.
 *
 *   - the mission starts on Nunatak Reach in the C-17, lined up on the ice
 *     strip with over 600 m ahead, ramp DOWN from the first frame, at night;
 *     the Site is built with its six sector lamps lit; the card shows the
 *     warhead at 4:00, every sector held, 0 / 40 aboard
 *   - the first two waves run to the ramp and board: the count climbs, a
 *     cart counts as cargo
 *   - the ramp key closes the ramp: the people still out turn back for the
 *     hangar, the step moves on to the take-off
 *   - a sector lost (the test hook) dims its lamp and the Site's own
 *   - the take-off is placed (the real roll is the C-17's own, c17.browser.js)
 *     and the escape step passes at 5 km; the warhead is wound to go (the
 *     test hook) with the aeroplane clear: the dome, the pressure wave, no
 *     fail; its opacity never over the blast-sprite cap
 *   - the landing at Caribou completes the mission; the debrief is the
 *     mission's own: saved / left behind / cargo / margin / landing, stars
 *   - 0 console errors; the map you had comes back
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export const id = 'scp-escape';

export async function check(sim, r, say = () => {}) {
  let THREE;
  let T;
  let Site;
  let Esc;
  let FS;
  try {
    THREE = await import('../../src/vendor/three.module.js');
    T = await import('../../src/world/terrain.js');
    Site = await import('../../src/features/scp-site.js');
    Esc = await import('../../src/features/scp-escape.js');
    FS = await import('../../src/render/flash-safety.js');
  } catch (err) {
    r.ok('scp-escape: the modules load', false, String(err && err.message));
    return;
  }
  const origAuto = sim.autoPauseOnHide;
  const origMap = sim.settings.map;
  sim.autoPauseOnHide = false;
  const stepId = () => (sim.runner && sim.runner.step ? sim.runner.step.id : null);
  const errors = [];
  const origErr = console.error;
  console.error = (...a) => {
    errors.push(a.map(String).join(' '));
    origErr.apply(console, a);
  };
  const frames = (seconds, each = null) => {
    for (let i = 0; i < Math.round(seconds * 30); i++) {
      sim.update(1 / 30);
      if (each && each(i) === true) return true;
    }
    return false;
  };
  const card = () => document.querySelector('.lfo-card');
  const cardText = () => (card() ? card().textContent.replace(/\s+/g, ' ').trim() : '');

  try {
    say('scp-escape: start');
    await sim.startMode('mission', { id: 'last-flight', seed: 4242 });
    const ac = sim.aircraft;
    const map = T.MAP;
    const c = map.scp;
    r.ok('the mission starts on Nunatak Reach in the C-17, at night, on the ground', map.id === 'nunatak' && sim.aircraftType.id === 'c17' && ac.onGround && !ac.crashed && sim.weather.isNight,
      `${map.id}, ${sim.aircraftType.id}, onGround ${ac.onGround}, night ${sim.weather.isNight}`);
    const ahead = ac.pos.x - (c.strip.cx - c.strip.halfLen);
    r.ok('…lined up on the ice strip facing west with over 600 m ahead', T.iceAt(ac.pos.x, ac.pos.z) && Math.abs(ac.pos.z - c.strip.cz) < 3 && Math.abs(((ac.heading - 270 + 540) % 360) - 180) < 3 && ahead > 600,
      `${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)} hdg ${ac.heading.toFixed(0)}, ${ahead.toFixed(0)} m ahead`);
    frames(0.5);
    const g0 = Site.rampOf(sim);
    r.ok('the ramp is DOWN from the first frame', !!g0 && g0.open && g0.amount > 0.97, g0 ? `amount ${g0.amount.toFixed(2)}` : 'no ramp');
    const R = Esc.run();
    r.ok('the run is the seed asked for, boarding', !!R && R.seed === 4242 && R.phase === 'boarding');
    r.ok('the first step is board', stepId() === 'board', stepId());
    const lampA = sim.scene.getObjectByName('lfo-lamp-A');
    const lamps = Esc.escapeState().lamps;
    r.ok('six sector lamps are built in the Site, lit', !!lampA && lamps.length === 6 && lamps.every((l) => !l.lost && l.lit > 0.9), `${lamps.length} lamps`);
    r.ok('the card: warhead near 4:00, every sector held, 0 / 40 aboard, 0 / 8 cargo, a CLOSE RAMP button', /Warhead\s*3:5\d|Warhead\s*4:00/.test(cardText()) && /all sectors held/.test(cardText()) && /Aboard\s*0 \/ 40/.test(cardText()) && /Cargo\s*0 \/ 8/.test(cardText()) && /CLOSE RAMP/.test(cardText()),
      cardText().slice(0, 120));
    r.ok('…and it is in the HUD\'s right-hand column (the stack), shown', !!card() && card().classList.contains('is-shown') && !!card().closest('.hud-rstack'));
    r.ok('the objective names the goal from the start', /Close the ramp/.test(sim.hud.objectiveText.textContent) && /Last Flight Out/.test(sim.hud.objectiveTitle.textContent), sim.hud.objectiveTitle.textContent);

    /* ---- boarding ---- */
    say('scp-escape: two waves board');
    let highest = 0;
    frames(85, () => {
      const RR = Esc.run();
      const g = Site.rampOf(sim);
      for (const w of RR.walkers) if (w.state === 'out' && w.onRamp && w.fig) highest = Math.max(highest, w.fig.p.position.y - g.ground);
      return RR.saved >= 10 && RR.cargo >= 1;
    });
    const st1 = Esc.escapeState();
    r.ok('inside 85 s the first wave has run to the ramp, climbed it (up on the cargo floor) and gone aboard, the second is arriving; a cart is in', st1.saved >= 6 && st1.cargo >= 1 && highest > 2,
      `saved ${st1.saved}, cargo ${st1.cargo}, up ${highest.toFixed(2)} m, out ${st1.out}`);
    r.ok('…the card counts them', new RegExp(`Aboard\\s*${st1.saved} / 40`).test(cardText()) && new RegExp(`Cargo\\s*${st1.cargo} / 8`).test(cardText()), cardText().slice(0, 140));
    r.ok('…the figures are pooled under the cap for this detail level', st1.figures <= st1.poolMax, `${st1.figures} of ${st1.poolMax}`);
    r.ok('…still on the board step: the choice is yours', stepId() === 'board');

    /* ---- a sector goes ---- */
    say('scp-escape: a sector goes dark');
    // The next sector still held (the schedule may have taken A and B by now): lose it now.
    const nextIx = Esc.escapeState().lost;
    const lit0 = Esc.escapeState().lamps[nextIx].lit;
    const lights0 = Site.siteLightScale();
    Esc.__escape.loseThrough(nextIx);
    frames(2.5);
    const st2 = Esc.escapeState();
    const lostId = Esc.SECTORS[nextIx];
    const nextId = Esc.SECTORS[nextIx + 1];
    r.ok(`sector ${lostId} lost: its lamp dims (no flash, over a second), the red lamp pulses, the Site's own lamps dim a step`, st2.lost === nextIx + 1 && st2.lamps[nextIx].lost && lit0 > 0.9 && st2.lamps[nextIx].lit < 0.2 && (nextIx + 1 >= 6 || !st2.lamps[nextIx + 1].lost) && Site.siteLightScale() < lights0,
      `lit ${lit0.toFixed(2)} → ${st2.lamps[nextIx].lit.toFixed(2)}, lights ${lights0.toFixed(2)} → ${Site.siteLightScale().toFixed(2)}`);
    r.ok('…the card says which', new RegExp(`Sector ${lostId} lost`).test(cardText()) && (nextId ? new RegExp(`${nextId} next`).test(cardText()) : /strip next/.test(cardText())), cardText().slice(0, 140));

    /* ---- the ramp key: close and go ---- */
    say('scp-escape: close the ramp');
    const outBefore = Esc.run().walkers.filter((w) => w.state === 'out' && !w.onRamp).length;
    sim.tap('Digit6');
    frames(0.3);
    const R2 = Esc.run();
    r.ok('the ramp key closes the ramp: phase leaving, the ramp coming up', R2.phase === 'leaving' && Site.rampOf(sim).amount < 0.97 && !Site.rampOf(sim).open, `${R2.phase}, amount ${Site.rampOf(sim).amount.toFixed(2)}`);
    r.ok('…everyone still on the apron turns back for the hangar', outBefore > 0 && R2.walkers.filter((w) => w.state === 'out' && !w.onRamp).length === 0 && R2.walkers.filter((w) => w.state === 'turned').length >= outBefore - 1, `${outBefore} were out, ${R2.walkers.filter((w) => w.state === 'turned').length} turned`);
    const savedAtClose = R2.saved;
    frames(9);
    r.ok('…the ramp is up in about eight seconds and the step moves on to the take-off', Site.rampOf(sim).amount < 0.05 && stepId() === 'takeoff', `amount ${Site.rampOf(sim).amount.toFixed(2)}, step ${stepId()}`);
    r.ok('…nobody boards a shut aeroplane: the count holds (bar whoever was already on the ramp)', Esc.run().saved >= savedAtClose && Esc.run().saved <= savedAtClose + 3, `${savedAtClose} → ${Esc.run().saved}`);
    const go = document.querySelector('.lfo-go');
    r.ok('the big touch button exists (hidden on a desktop; it shows on a touch screen while boarding)', !!go && go.hidden === true);

    /* ---- the take-off and the escape (placed) ---- */
    say('scp-escape: away');
    ac.reset({ pos: new THREE.Vector3(c.strip.cx - 300, 0, c.strip.cz), headingDeg: 240, speed: 85, altAGL: 150, engineOn: true, gearDown: false });
    frames(4);
    r.ok('airborne: the take-off step completes and the escape begins', stepId() === 'escape', stepId());
    // 5.4 km out, towards Caribou.
    ac.reset({ pos: new THREE.Vector3(c.cx - 4200, 0, c.cz + 3400), headingDeg: 240, speed: 90, altAGL: 600, engineOn: true, gearDown: false });
    frames(1);
    const d = Math.hypot(ac.pos.x - c.cx, ac.pos.z - c.cz);
    r.ok(`past ${Esc.BLAST_SAFE_M} m the escape step passes and the margin is recorded`, d > Esc.BLAST_SAFE_M && stepId() === 'land' && Esc.run().crossedAt != null, `${d.toFixed(0)} m, step ${stepId()}, margin ${Esc.run().crossedAt}`);
    // The warhead: wound to go now, with the aeroplane clear.
    const reduce = FS.FLASH.reduce;
    Esc.__escape.detonateIn(0.1);
    let peak = 0;
    frames(3, () => {
      const dome = Esc.run().dome;
      if (dome && dome.visible) peak = Math.max(peak, dome.material.opacity);
      return false;
    });
    const R3 = Esc.run();
    const cap = reduce ? 0.85 * FS.CAPS.blastSprite : 0.85;
    r.ok('the warhead goes behind you: the dome is up and no brighter than its cap', !!R3.blast && R3.blast.outcome === 'clear' && peak > 0.05 && peak <= cap + 1e-6, `peak ${peak.toFixed(3)} (cap ${cap.toFixed(3)}, reduce ${reduce})`);
    r.ok('…and the mission goes on (no fail)', !R3.failReason && sim.runner.status === 'running', String(R3.failReason));
    frames(R3.blast.arrives + 1.5);
    r.ok('…the pressure wave arrives after d / 340 s as a kick and turbulence, nothing more', R3.blast.waved && !Esc.run().failReason && sim.runner.status === 'running', `arrives ${R3.blast.arrives.toFixed(1)} s`);
    frames(6);
    r.ok('…the weather\'s turbulence is given back', Math.abs(sim.weather.turbulenceScale - 1) < 1e-6, `${sim.weather.turbulenceScale}`);

    /* ---- the landing at Caribou ---- */
    say('scp-escape: land at Caribou');
    const RW = (await import('../../src/world/airport.js')).RUNWAY;
    ac.reset({ pos: new THREE.Vector3(RW.thresholdWest.x + 150, 0, RW.thresholdWest.z), headingDeg: 90, speed: 58, altAGL: 4, engineOn: true, gearDown: true });
    sim.override = { throttle: 0, pitch: 0, roll: 0, yaw: 0, brakes: 1 };
    const done = frames(90, () => sim.runner.status === 'complete');
    sim.override = null;
    r.ok('down on Caribou\'s runway the mission completes', done && sim.runner.status === 'complete', `${sim.runner.status}, step ${stepId()}, crashed ${ac.crashed}`);
    const res = Esc.run() && Esc.run().result;
    r.ok('…with the mission\'s result: saved + left = 40, a score in 0..100', !!res && res.kind === 'landed' && res.saved + res.left === 40 && res.score >= 0 && res.score <= 100, JSON.stringify(res && { saved: res.saved, left: res.left, cargo: res.cargo, score: res.score, marginS: res.marginS }));
    const body = document.querySelector('.screen.debrief [data-body], #debrief [data-body], [data-body]');
    const bodyText = body ? body.textContent.replace(/\s+/g, ' ') : '';
    r.ok('the debrief is the mission\'s own: saved / left behind / cargo / margin / landing, stars', /Saved \d+ of 40/.test(bodyText) && /Left behind/.test(bodyText) && /Cargo \d+ of 8/.test(bodyText) && /Margin before the warhead/.test(bodyText) && /Landing/.test(bodyText) && /★/.test(bodyText),
      bodyText.slice(0, 200));

    /* ---- the real roll: "about twenty seconds" is true, and 5 km is 82 s from brake release ---- */
    say('scp-escape: go when the strip\'s sector goes');
    sim.quitToMenu('main');
    await sim.startMode('mission', { id: 'last-flight', seed: 11 });
    const ac2 = sim.aircraft;
    frames(1);
    // The strip's sector has just gone: twenty seconds. Close the ramp and go at once, full power, rotate at 120 kt.
    Esc.__escape.stripIn(Esc.STRIP_GRACE_S);
    const t0 = Esc.run().t;
    sim.tap('Digit6');
    let gsAtLoss = null;
    let lift = null;
    let km5 = null;
    let gear = false;
    for (let i = 0; i < 30 * 110; i++) {
      const spd = ac2.ias || 0;
      const pd = ac2.pitchAngleDeg();
      let pitch = 0;
      if (spd > 60 && ac2.onGround) pitch = 0.55;
      else if (!ac2.onGround) pitch = Math.max(-0.5, Math.min(0.6, ((ac2.agl < 120 ? 8 : spd < 85 ? 2 : 5) - pd) * 0.08));
      const want = !ac2.onGround && ac2.agl > 120 ? (Math.atan2(RW.touchdown.x - ac2.pos.x, -(RW.touchdown.z - ac2.pos.z)) * 180) / Math.PI : 270;
      const err = ((want - ac2.heading + 540) % 360) - 180;
      const tb = ac2.onGround ? 0 : Math.max(-25, Math.min(25, err * 1.2));
      sim.override = { throttle: 1, pitch, roll: ac2.onGround ? 0 : Math.max(-0.4, Math.min(0.4, (tb - ac2.bankAngleDeg()) / 20)), yaw: ac2.onGround ? Math.max(-1, Math.min(1, err / 15)) : 0, brakes: 0 };
      sim.update(1 / 30);
      const R5 = Esc.run();
      if (gsAtLoss == null && R5.stripLost) gsAtLoss = ac2.onGround ? ac2.groundSpeed : Infinity;
      if (lift == null && !ac2.onGround && ac2.airborneTime > 1) lift = R5.t - t0;
      if (!gear && lift != null && ac2.agl > 40) { sim.tap('KeyG'); gear = true; }
      if (km5 == null && !ac2.onGround && Math.hypot(ac2.pos.x - c.cx, ac2.pos.z - c.cz) >= Esc.BLAST_SAFE_M) { km5 = R5.t - t0; break; }
      if (ac2.crashed || R5.failReason) break;
    }
    sim.override = null;
    r.ok(`go the moment the strip's sector goes: rolling over ${Esc.STRIP_ESCAPE_MS} m/s when the breach reaches the strip, and no loss`, gsAtLoss != null && gsAtLoss >= Esc.STRIP_ESCAPE_MS && !Esc.run().failReason,
      `ground speed ${gsAtLoss && gsAtLoss.toFixed(1)} m/s at the loss, fail ${Esc.run().failReason}`);
    r.ok('…airborne about 21 s after brake release, 5 km from the Site in under 90 s (the node test\'s BRAKE_TO_5KM, 82)', lift != null && lift < 26 && km5 != null && km5 < 90 && !ac2.crashed,
      `lift ${lift && lift.toFixed(1)} s, 5 km ${km5 && km5.toFixed(1)} s`);

    r.ok('0 console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (err) {
    r.ok('scp-escape: the check ran to the end', false, String((err && err.stack) || err));
  } finally {
    console.error = origErr;
    sim.override = null;
    try {
      sim.quitToMenu('main');
    } catch (e) {
      /* already there */
    }
    sim.autoPauseOnHide = origAuto;
    r.ok('the map you had chosen comes back after the mission', sim.settings.map === origMap, `${origMap} → ${sim.settings.map}`);
    r.ok('the run is torn down with the flight', Esc.run() === null);
  }
}
