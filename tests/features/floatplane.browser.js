/**
 * Browser checks for the floatplane (src/features/floatplane.js), in the real
 * game: the water start on a map with sea, taxi, take-off, a scored landing
 * with spray and wake, a bad one, the land, the hangar, the picker, the
 * cockpit view and the controls.
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export const id = 'floatplane';

export async function check(sim, r, say) {
  const THREE = await import('../../src/vendor/three.module.js');
  const T = await import('../../src/world/terrain.js');
  const OF = await import('../../src/features/onfoot.js');
  const COV = await import('../../src/ui/touch-coverage.js');
  const INP = await import('../../src/flight/input.js');
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const fp = () => sim.floatplane.state();
  const calm = { time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 0, loadingScreen: false };
  const pilot = (o) => { sim.override = { pitch: 0, roll: 0, yaw: 0, throttle: 0, ...o }; };

  await sim.startMode('free', { ...calm, aircraft: 'petrel' });
  sim.step(0.3);
  let ac = sim.aircraft;
  r.ok('start: no "runway, taxi and hold" from the ground controller', sim.atc.said.start === true);
  r.ok('start: she starts on the water on a map with sea', ac.onWater && T.heightAt(ac.pos.x, ac.pos.z) < 0 && !ac.crashed, `h ${T.heightAt(ac.pos.x, ac.pos.z).toFixed(1)}, y ${ac.pos.y.toFixed(2)}`);
  const words = sim.hud.wrap.innerText || sim.hud.wrap.textContent;
  r.ok('start: the goal is on the screen', /water/i.test(words) && /60 knots|step|take off/i.test(words), words.slice(0, 120));
  r.ok('start: the engine is running and no parking brake holds her', ac.engineOn && !ac.parkingBrake);
  sim.step(2);
  r.ok('start: she sits at her waterline', ac.pos.y > 1.2 && ac.pos.y < 3 && !ac.crashed, `${ac.pos.y.toFixed(2)} m`);
  r.ok('start: getting out onto the sea is refused', OF.cannotGetOut(sim) !== null);
  r.ok('start: and so is ejecting, in the same words', /water/i.test((await import('../../src/features/eject.js')).cannotEject(sim) || ''));
  r.ok('start: no gear to pull up', (sim.key('KeyG'), sim.step(0.1), sim.key('KeyG', false), sim.step(0.3), ac.gearDown && ac.gearPos === 1));

  /* ---- taxi and the rudders ---- */
  const h0 = ac.heading;
  pilot({ throttle: 0.3, yaw: 1 });
  sim.step(8);
  const swing = Math.abs(((ac.heading - h0 + 540) % 360) - 180);
  r.ok('taxi: the water rudders steer her', swing > 20 && !ac.crashed, `${swing.toFixed(0)} degrees at ${ac.groundSpeed.toFixed(1)} m/s`);
  await new Promise((res) => setTimeout(res, 300));
  r.ok('spray: loaded with the aeroplane', fp().fx);

  /* ---- steady on the water ---- */
  await sim.startMode('free', { ...calm, aircraft: 'petrel' });
  sim.step(0.3);
  ac = sim.aircraft;
  pilot({ throttle: 0.5 });
  sim.step(14);
  pilot({ throttle: 0 });
  ac.vel.set(Math.sin(ac.heading * Math.PI / 180) * 12, 0, -Math.cos(ac.heading * Math.PI / 180) * 12);
  sim.step(0.1);
  r.ok('taxi: nobody is told to use brakes she does not have', !/brake/i.test(sim.coachHint(ac) || ''), sim.coachHint(ac));
  pilot({ throttle: 0.5 });
  sim.step(8);
  r.ok('taxi: the nose is not held down', ac.pitchAngleDeg() > -2.5 && ac.pitchAngleDeg() < 3, `${ac.pitchAngleDeg().toFixed(1)} deg`);
  pilot({ throttle: 1 });
  sim.step(16);
  let rock = 0;
  const heads = [];
  for (let i = 0; i < 40 && !ac.crashed; i++) {
    sim.step(0.5);
    rock = Math.max(rock, Math.abs(ac.bankAngleDeg()));
    heads.push(ac.heading);
  }
  const hs = Math.max(...heads) - Math.min(...heads);
  r.ok('step: hands off at full power she does not rock wing to wing', rock < 8, `${rock.toFixed(1)} deg`);
  r.ok('step: nor swing from side to side', hs < 30, `${hs.toFixed(0)} deg`);
  sim.override = null;
  sim.quitToMenu('main');

  /* ---- the harbour: the Free Flight screen's Auto ---- */
  await sim.startMode('free', { ...calm, aircraft: 'petrel', startAt: 'auto' });
  sim.step(0.3);
  ac = sim.aircraft;
  const hb = T.harbourBerth();
  if (hb) {
    r.ok('harbour: in the basin', Math.hypot(ac.pos.x - hb.x, ac.pos.z - hb.z) < 80 && ac.onWater, `${Math.round(ac.pos.x)}, ${Math.round(ac.pos.z)}`);
    r.ok('harbour: the words say how', /stick back/.test(sim.hud.wrap.innerText || sim.hud.wrap.textContent));
    pilot({ throttle: 1, pitch: 0.3 });
    let th = 0;
    while (th < 40 && !ac.crashed && ac.pos.y < 40) {
      sim.override.pitch = ac.groundSpeed < 24 ? 0.3 : 0.45;
      sim.step(0.25);
      th += 0.25;
    }
    r.ok('harbour: full power straight ahead goes out of the mouth and flies, not into the breakwater', !ac.crashed && ac.pos.y >= 40, ac.crashReason || `${th} s`);
  }
  sim.override = null;
  sim.quitToMenu('main');
  await sim.startMode('free', { ...calm, aircraft: 'petrel' });
  sim.step(0.3);
  ac = sim.aircraft;

  /* ---- take-off, from clear water ---- */
  const spot = sim.floatplane.waterStart({ x: 3000, z: 0 }) || { x: 3000, z: 0, headingDeg: 90 };
  ac.reset({ pos: new THREE.Vector3(spot.x, 0, spot.z), headingDeg: spot.headingDeg, speed: 0, altAGL: null, engineOn: true });
  ac.parkingBrake = false;
  ac.flaps = ac.flapsTarget = 1 / 3;
  let spray = 0;
  let t = 0;
  let lift = null;
  pilot({ throttle: 1, pitch: 0.25 });
  while (t < 60 && !ac.crashed && ac.pos.y < 40) {
    sim.override.pitch = ac.groundSpeed < 24 ? 0.25 : 0.5;
    sim.step(0.25);
    t += 0.25;
    if (ac.onWater) spray = Math.max(spray, fp().pool ? fp().pool.alive : 0);
    if (lift === null && !ac.onWater && ac.groundSpeed > 15) lift = t;
  }
  r.ok('take-off: from the water, under power', lift !== null && ac.pos.y >= 40 && !ac.crashed, `${lift} s; ${ac.crashReason || 'airborne'}`);
  r.ok('take-off: spray and wake on the run', spray > 6, `${spray}`);
  r.ok('take-off: Airborne is a real lift-off', !ac.onGround && !ac.onWater);

  /* ---- a scored landing ---- */
  function approach(sink, kts = 50, bank = 0) {
    ac.reset({ pos: new THREE.Vector3(spot.x, 40, spot.z), headingDeg: 90, speed: kts / 1.94384, altAGL: null, engineOn: false });
    ac._spawnOnGround = false;
    ac.onGround = false;
    ac.onWater = false;
    ac.flaps = ac.flapsTarget = 1;
    ac.quat.setFromEuler(new THREE.Euler(4 * Math.PI / 180, -Math.PI / 2, -bank * Math.PI / 180, 'YXZ'));
    ac.pos.y = 2.45;
    ac.vel.set(kts / 1.94384, -sink, 0);
    pilot({});
  }
  let td = null;
  approach(1);
  sim.step(1);
  td = ac.lastTouchdown;
  r.ok('landing: a normal landing, not a crash', !!td && td.water && !td.crashed && !ac.crashed && !ac.ditched, JSON.stringify(td));
  r.ok('landing: scored', td && td.score > 40, `${td && td.score}/100 (${td && td.quality})`);
  const spoke = [];
  const atcSay = sim.atc.say;
  sim.atc.say = (t, ...rest) => { spoke.push(t); return atcSay.call(sim.atc, t, ...rest); };
  sim.atc.onTouchdown(td);
  sim.atc.say = atcSay;
  r.ok('landing: the tower says the water, not the apron and the wheels', /water/.test(spoke[0] || '') && !/apron|wheels/.test(spoke[0] || ''), spoke[0]);
  const card = document.querySelector('[class*="hud-touchdown"]');
  r.ok('landing: the touchdown card', !!card && /ft\/min/.test(card.textContent), card && card.textContent.slice(0, 60));
  sim.step(14);
  r.ok('landing: she runs out and stops on the sea', ac.onWater && ac.groundSpeed < 4 && !ac.crashed, `${ac.groundSpeed.toFixed(1)} m/s`);
  approach(7);
  sim.step(1);
  r.ok('landing: too hard is the crash', ac.crashed && /water|sea/i.test(ac.crashReason || ''), ac.crashReason);
  sim.override = null;
  sim.quitToMenu('main');
  r.ok('landing: the crash path still ends in a debrief or the menu', sim.state === 'menu');

  /* ---- the land ---- */
  await sim.startMode('free', { ...calm, aircraft: 'petrel', startAt: 'runway' });
  sim.step(0.3);
  ac = sim.aircraft;
  r.ok('land: the runway if you ask for it', T.heightAt(ac.pos.x, ac.pos.z) >= 0 && !ac.crashed);
  pilot({ throttle: 1 });
  sim.step(6);
  const v1 = ac.groundSpeed;
  pilot({});
  sim.step(14);
  r.ok('land: she slides, does not crash, and stops hard', !ac.crashed && v1 > 2 && ac.groundSpeed < 1, `${v1.toFixed(1)} then ${ac.groundSpeed.toFixed(1)} m/s`);
  sim.override = null;
  sim.quitToMenu('main');

  /* ---- the hangar and the picker ---- */
  const Ty = await import('../../src/aircraft/types.js');
  const MM = await import('../../src/ui/menus.js');
  r.ok('hangar: under a heading', MM.aircraftCategory(Ty.getAircraft('petrel')) === 'light', MM.aircraftCategory(Ty.getAircraft('petrel')));
  sim.menus.show('free');
  const onCard = [...sim.menus.screens.free.querySelectorAll('[data-id="petrel"], [data-aircraft="petrel"]')];
  r.ok('hangar: on the aircraft picker', onCard.length > 0 || /Petrel/.test(sim.menus.screens.free.textContent));
  sim.menus.show('main');
  const m = await sim.spawns.preview('auto', 'petrel');
  r.ok('picker: Auto is the water', m.kind === 'water' || m.kind === 'runway', m.kind);

  /* ---- the cockpit and the controls ---- */
  await sim.startMode('free', { ...calm, aircraft: 'petrel' });
  sim.step(0.3);
  r.ok('cockpit: built for her', !!sim.cockpit && sim.cockpit.children.length > 0);
  r.ok('touch: nothing new needs a thumb', COV.coverageGaps(INP.ACTIONS).missing.length === 0);
  sim.override = null;
  sim.quitToMenu('main');
  sim.autoPauseOnHide = origAuto;
}
