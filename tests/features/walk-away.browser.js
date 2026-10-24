/**
 * Browser check: you got OUT (onfoot.js) and the empty aeroplane crashed.
 * You are safe, so there is no crash screen and no reset (the owner,
 * 2026-10-17: "if i escape the plane and it still crashes i dont needa
 * reset"): the flight goes on with you walking, a small notice says the plane
 * came to grief, the wreck is lit where it fell, and the red "Crashed" banner
 * never shows. In the aeroplane, a crash still ends with the debrief.
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export async function check(sim, r, say) {
  let OF;
  try {
    OF = await import('../../src/features/onfoot.js');
  } catch (err) {
    r.ok('walk-away: the module loads', false, String(err && err.message));
    return;
  }
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const origAircraft = sim.aircraftType ? sim.aircraftType.id : 'skylark';
  const banners = [];
  const origBanner = sim.hud.showBanner.bind(sim.hud);
  sim.hud.showBanner = (title, text, kind, s) => {
    banners.push(`${title}: ${text}`);
    return origBanner(title, text, kind, s);
  };
  const fly = async (id, extra = {}) => {
    await sim.startMode('free', { airborne: false, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 0, aircraft: id, ...extra });
    sim.step(0.5);
  };

  say('walk-away: out and walking');
  await fly('skylark');
  {
    const ac = sim.aircraft;
    // Stopped on the runway, engine off: get out.
    ac.vel.set(0, 0, 0);
    if (ac.engineOn && ac.stopEngine) ac.stopEngine('check');
    sim.step(0.5);
    const out = OF.getOut(sim);
    sim.step(0.5);
    r.ok('walk-away: you can get out of a stopped aeroplane and walk', OF.onFoot.active, `getOut -> ${JSON.stringify(out)}; active ${OF.onFoot.active}`);
    banners.length = 0;
    const flights = sim.progress.flights;
    // The aeroplane you left comes to grief (rolled into something, say).
    ac.crash('The empty aeroplane rolled into the fence');
    sim.step(0.1);
    r.ok('walk-away: the empty aeroplane is wrecked and the wreck is lit where it fell', ac.crashed && sim.wreck.active && sim.wreck.light.intensity > 0, `crashed ${ac.crashed}, wreck ${sim.wreck.active}, light ${Math.round(sim.wreck.light.intensity)}`);
    r.ok('walk-away: a small notice says your plane crashed, in good news, not the red "Crashed" banner (nor the red "Crash landing" of crashes.js)', banners.some((b) => /^Your plane crashed/.test(b)) && banners.every((b) => /^Your plane crashed/.test(b)), banners.join(' | ') || 'no banners');
    // The debrief comes 2.2 s after a crash in the aeroplane. Wait it out, for real.
    await new Promise((res) => setTimeout(res, 2600));
    sim.step(0.5);
    r.ok('walk-away: no crash screen, no reset: the flight goes on with you on foot', sim.state === 'flying' && OF.onFoot.active && sim.progress.flights === flights, `state ${sim.state}, on foot ${OF.onFoot.active}`);
    r.ok('walk-away: you can still walk about', (() => {
      const w0 = { x: OF.onFoot.walker.x, z: OF.onFoot.walker.z };
      for (let i = 0; i < 30; i++) sim.update(1 / 60);
      return Number.isFinite(w0.x) && OF.onFoot.active;
    })(), '');
  }

  say('walk-away: in the aeroplane a crash still ends the flight');
  await fly('skylark', { airborne: true });
  {
    const flights = sim.progress.flights;
    banners.length = 0;
    sim.aircraft.crash('Walk-away check: a crash with you aboard');
    sim.step(0.1);
    r.ok('walk-away: with you aboard the red "Crashed" banner still shows', banners.some((b) => /^Crashed:/.test(b)), banners.join(' | '));
    await new Promise((res) => setTimeout(res, 2600));
    sim.step(0.1);
    r.ok('walk-away: …and the crash screen still comes', sim.state === 'debrief' && sim.progress.flights === flights, `state ${sim.state}`);
    clearTimeout(sim._crashDebriefT);
  }

  sim.hud.showBanner = origBanner;
  try {
    await sim.startMode('free', { airborne: true, time: 'day', condition: 'clear', aircraft: origAircraft });
    sim.step(0.3);
  } catch (e) {
    /* leave it */
  }
  sim.autoPauseOnHide = origAuto;
}
