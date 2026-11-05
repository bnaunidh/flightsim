/**
 * Browser checks for the ditching (src/features/ditching.js), in the real
 * game. tests/features/ditching.mjs has read the rules; this arrives on the
 * sea and watches:
 *
 *   - a gentle arrival: whole, slides, slows hard, stops, floats level, settles
 *     for a couple of minutes, rafts, rescue, then the card with its numbers,
 *     Try again and Main menu; she goes on sinking behind the card
 *   - a bad arrival (banked, steep, nose down, too fast) is the crash it was
 *   - an airliner's rafts at its doors, a fast jet's dinghy and helicopter
 *   - a helicopter on the water is what it was
 *   - quit while afloat, restart mid-sink, back to the airfield
 *   - a mission that does not expect it fails in the runner's own words;
 *     Both Engines Out expects it and pays
 *   - the rafts and spray are not loaded before they are needed
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export const id = 'ditching';

export async function check(sim, r, say) {
  const log = (m) => { if (say) say(`ditching: ${m}`); };
  const THREE = await import('../../src/vendor/three.module.js');
  const T = await import('../../src/world/terrain.js');
  const J = await import('../../src/features/ditching/judge.js');
  const DF = await import('../../src/features/ditching.js');
  const EXT = await import('../../src/game/extensions.js');
  const calm = { airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 0 };
  const sea = { x: 3000, z: 0 };
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const st = () => sim.ditching.state();
  const KT = 1.94384;
  const title = () => {
    const t = document.querySelector('[data-screen="debrief"] [data-title]');
    return t ? t.textContent : '';
  };
  const debriefText = () => {
    const b = document.querySelector('[data-screen="debrief"] [data-body]');
    return b ? b.innerText || b.textContent : '';
  };
  const buttons = () => [...document.querySelectorAll('[data-screen="debrief"] [data-actions] button')].map((b) => b.textContent);

  async function fly(id, extra = {}) {
    await sim.startMode('free', { ...calm, aircraft: id, ...extra });
    sim.override = null;
    sim.step(0.2);
    return sim.aircraft;
  }

  /** Put the aeroplane a hand above the sea in this attitude and going this fast, and let go. */
  function arrive(ac, { speed, sink = 1.2, bank = 0, pitch = 3, gearDown = false, flaps = 1 }) {
    ac.reset({ pos: new THREE.Vector3(sea.x, 40, sea.z), headingDeg: 90, speed, altAGL: null, engineOn: false, gearDown });
    ac._spawnOnGround = false;
    ac.onGround = false;
    ac.flaps = ac.flapsTarget = flaps;
    const e = new THREE.Euler(pitch * Math.PI / 180, -Math.PI / 2, -bank * Math.PI / 180, 'YXZ');
    ac.quat.setFromEuler(e);
    ac.vel.set(speed, -sink, 0);
    ac.omega.set(0, 0, 0);
    const gear = gearDown ? Math.min(...sim_spec().gearPoints.map((g) => g.pos.y)) : -0.2;
    ac.pos.y = Math.max(0.05, -gear + 0.02);
    sim.override = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
  }
  let PH = null;
  const sim_spec = () => PH.SPEC;
  PH = await import('../../src/aircraft/physics.js');

  const held = (n, dt = 0.25) => { for (let i = 0; i < n; i++) sim.step(dt); };
  const toRest = () => { let n = 0; while (st().phase === 'slide' && n++ < 200) sim.step(0.25); return n * 0.25; };

  /* ---- not before it is needed ---- */
  const first = st();
  if (!first.sceneLoaded) r.ok('lazy: no rafts or spray in memory on a fresh load', performance.getEntriesByType('resource').every((e) => !/ditching\/(scene|water-fx)\.js/.test(e.name)), 'neither fetched');

  /* ---- a good one, a light aeroplane, start to finish ---- */
  let ac = await fly('skylark');
  await sim.ditching.load();
  r.ok('whole: the rafts are ready on demand', st().sceneLoaded);
  const model0 = sim.model;
  arrive(ac, { speed: 28, sink: 1 });
  sim.step(0.05);
  r.ok('whole: a gentle arrival is a ditching, not a crash', st().phase === 'slide' && !ac.crashed && ac.ditched, JSON.stringify({ p: st().phase, c: ac.crashed, why: ac.crashReason }));
  r.ok('whole: the aeroplane stays in one piece', !model0.userData.gameCrash);
  r.ok('whole: the score reads what happened', st().result.speedKts > 45 && st().result.speedKts < 60 && st().result.sinkFpm < 260, JSON.stringify(st().result));
  r.ok('whole: the engine is out', !ac.engineOn);
  r.ok('whole: on the water, not in the air', ac.onGround);
  const v0 = ac.groundSpeed;
  const x0 = ac.pos.x;
  sim.step(1.5);
  r.ok('slide: it slows hard', ac.groundSpeed < v0 - 3, `${v0.toFixed(1)} to ${ac.groundSpeed.toFixed(1)} m/s`);
  r.ok('slide: spray and foam are running', st().pool.alive > 4, `${st().pool.alive}`);
  const slideS = toRest() + 1.5;
  r.ok('slide: it stops in a believable time and distance', slideS > 3 && slideS < 16 && ac.pos.x - x0 > 30 && ac.pos.x - x0 < 400, `${slideS.toFixed(1)} s, ${(ac.pos.x - x0).toFixed(0)} m`);
  r.ok('afloat: at rest', st().phase === 'afloat' && ac.groundSpeed === 0);
  const y0 = ac.pos.y;
  sim.step(6);
  r.ok('afloat: floats level', Math.abs(ac.bankAngleDeg()) < 2 && Math.abs(ac.pitchAngleDeg()) < 4, `bank ${ac.bankAngleDeg().toFixed(1)}, pitch ${ac.pitchAngleDeg().toFixed(1)}`);
  r.ok('afloat: and stays up for now', Math.abs(ac.pos.y - y0) < 0.4 && !ac.crashed);
  const bellyY = PH.SPEC.hardPoints.find((h) => /belly/i.test(h.what)).pos.y;
  r.ok('afloat: she sits down in the water, the belly well under', ac.pos.y + bellyY < bellyY * 0.3, `belly ${(ac.pos.y + bellyY).toFixed(2)} m`);
  r.ok('afloat: soft foam at the waterline', st().pool.alive > 0 && st().pool.light < 0.6, JSON.stringify(st().pool));
  r.ok('afloat: the raft is out', st().rafts >= 1);
  r.ok('afloat: nobody is told to start the engine', !sim.coachHint(ac));
  ac.startEngine();
  r.ok('afloat: and it would not start', !ac.starting && !ac.engineOn);
  const raftMesh = sim.scene.getObjectByName('ditch-dinghy');
  r.ok('afloat: and it is in the scene, on the water', !!raftMesh && raftMesh.parent.visible);
  sim.step(8);
  r.ok('rescue: somebody is coming', st().rescue === 'boat' || st().rescue === 'heli', st().rescue);
  r.ok('rescue: getting out of the aeroplane is refused', (await import('../../src/features/onfoot.js')).cannotGetOut(sim) !== null);
  const d30 = st().depth;
  let n = 0;
  while (sim.state === 'flying' && n++ < 80) sim.step(1);
  r.ok('rescue: it arrives before the card', st().rescueHere);
  // Built for this one ditching, so freed with it: geometry and materials both, or every ditching leaves one behind.
  const watchFreed = (name) => {
    const model = sim.scene.getObjectByName(name);
    const w = { model, geos: 0, mats: 0, nGeos: 0, nMats: 0 };
    const seen = new Set();
    if (model) {
      model.traverse((o) => {
        if (o.geometry && !seen.has(o.geometry)) {
          seen.add(o.geometry);
          w.nGeos++;
          o.geometry.addEventListener('dispose', () => w.geos++);
        }
        for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
          if (seen.has(m)) continue;
          seen.add(m);
          w.nMats++;
          m.addEventListener('dispose', () => w.mats++);
        }
      });
    }
    return w;
  };
  const rescueWas = st().rescue;
  const freed = watchFreed(rescueWas === 'heli' ? 'rescue-heli' : 'rescue-boat');
  r.ok('card: the debrief comes up', sim.state === 'debrief' && title() === 'Ditching', `${sim.state}: ${title()}`);
  const txt = debriefText();
  r.ok('card: touchdown speed, sink rate, bank and a grade', /Touchdown speed/.test(txt) && /Sink rate/.test(txt) && /Bank/.test(txt) && /Grade/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 120));
  r.ok('card: Try again and Main menu', buttons().join() === 'Try again,Main menu', buttons().join());
  const dBefore = st().depth;
  for (let i = 0; i < 40; i++) sim.step(1);
  r.ok('card: she goes on settling behind it', st().depth > dBefore + 0.2, `${dBefore.toFixed(2)} to ${st().depth.toFixed(2)}`);
  for (let i = 0; i < 90 && !st().sunk; i++) sim.step(1);
  r.ok('sink: in the end she goes down, around two minutes after stopping', st().sunk && st().t > 100 && st().t < 210, `${st().t.toFixed(0)} s`);
  r.ok('sink: and the wreck is gone from the surface', sim.model.visible === false);
  [...document.querySelectorAll('[data-screen="debrief"] [data-actions] button')].find((b) => b.textContent === 'Try again').click();
  await new Promise((res) => setTimeout(res, 0));
  for (let i = 0; i < 100 && sim.state !== 'flying'; i++) await new Promise((res) => setTimeout(res, 50));
  sim.step(0.1);
  r.ok('try again: a new flight, whole, none of it left', sim.state === 'flying' && !sim.aircraft.ditched && sim.model.visible !== false && st().phase === null && !sim.scene.getObjectByName('ditching').visible, sim.state);
  sim.override = null;

  /* ---- a reset underneath it ---- */
  ac = await fly('skylark');
  arrive(ac, { speed: 28, sink: 1 });
  sim.step(0.1);
  ac.reset({ pos: new THREE.Vector3(sea.x, 0, sea.z), headingDeg: 90, speed: 60, altAGL: 300, engineOn: true });
  ac._spawnOnGround = false;
  sim.step(0.5);
  r.ok('reset: an aeroplane reset under the ditching flies on, and it is over', st().phase === null && !ac.crashed && !ac.ditched, JSON.stringify({ p: st().phase, c: ac.crashReason }));
  sim.override = null;
  sim.quitToMenu('main');

  /* ---- night ---- */
  await sim.startMode('free', { ...calm, aircraft: 'skylark', time: 'night' });
  sim.step(0.2);
  ac = sim.aircraft;
  await sim.ditching.load();
  arrive(ac, { speed: 28, sink: 1 });
  sim.step(0.5);
  r.ok('night: the foam is dim from the first second, not blinding until the rafts are out', st().phase === 'slide' && st().pool.light < 0.3, JSON.stringify(st().pool));
  sim.override = null;
  sim.quitToMenu('main');

  /* ---- bad arrivals stay the crash ---- */
  for (const [what, args, why] of [
    ['banked', { speed: 28, bank: 30, pitch: 2 }, /sea/],
    ['too steep', { speed: 28, sink: 12 }, /sea/],
    ['nose down', { speed: 30, pitch: -20, sink: 6 }, /sea/],
    ['too fast', { speed: 60 }, /sea/],
  ]) {
    ac = await fly('skylark');
    arrive(ac, args);
    held(6, 0.1);
    r.ok(`crash: ${what} is the crash it always was`, ac.crashed && !ac.ditched && why.test(ac.crashReason || ''), `${ac.crashReason}; ${JSON.stringify(st().refused && st().refused.over)}`);
    held(14, 0.25);
    sim.override = null;
    r.ok(`crash: ${what} leaves no ditching behind it`, st().phase === null && !!sim.model);
  }

  /* ---- an airliner ---- */
  ac = await fly('meridian');
  await sim.ditching.load();
  const stallM = (await import('../../src/aircraft/types.js')).performanceFor('meridian').stallClean;
  arrive(ac, { speed: 62, sink: 1.2 });
  sim.step(0.1);
  r.ok('airliner: whole', st().phase === 'slide' && st().cls === 'airliner', JSON.stringify(st().refused));
  r.ok('airliner: inside its own speed limit', st().result.speedKts < stallM * 1.6);
  toRest();
  sim.step(9);
  r.ok('airliner: rafts at the doors', st().rafts >= 4, `${st().rafts}`);
  const slides = sim.scene.getObjectByName('ditch-slides');
  r.ok('airliner: slides out', !!slides);
  const rafts = sim.scene.getObjectByName('ditch-rafts');
  const rm = new THREE.Matrix4();
  rafts.getMatrixAt(0, rm);
  const along = new THREE.Vector3().setFromMatrixColumn(rm, 2).normalize();
  const across = new THREE.Vector3(1, 0, 0).applyQuaternion(ac.quat);
  r.ok('airliner: a slide-raft lies out from its door, not any old way', Math.abs(along.dot(across)) > 0.9, `${along.dot(across).toFixed(2)}`);
  sim.quitToMenu('main');
  r.ok('quit: quitting while afloat leaves nothing behind', sim.state === 'menu' && st().phase === null && !sim.aircraft.ditched && !sim.scene.getObjectByName('ditching').visible);

  /* ---- a fast jet ---- */
  ac = await fly('vanguard');
  r.ok(`rescue: the ${rescueWas} is gone from the scene and freed, every geometry and material`, !!freed.model && !freed.model.parent && freed.nGeos > 0 && freed.geos >= freed.nGeos && freed.mats >= freed.nMats, `${freed.geos}/${freed.nGeos} geometries, ${freed.mats}/${freed.nMats} materials`);
  arrive(ac, { speed: 55, sink: 1.2 });
  sim.step(0.1);
  r.ok('fast jet: whole, in its own class', st().phase === 'slide' && st().cls === 'fast', JSON.stringify(st().refused));
  toRest();
  sim.step(12);
  r.ok('fast jet: a helicopter comes for it', st().rescue === 'heli');
  r.ok('fast jet: one dinghy', st().rafts === 1);
  const heliFreed = watchFreed('rescue-heli');
  // Restart in the middle of it.
  sim.restart();
  for (let i = 0; i < 100 && sim.aircraft.ditched; i++) await new Promise((res) => setTimeout(res, 50));
  sim.step(0.1);
  r.ok('restart: the helicopter is freed too', !!heliFreed.model && !heliFreed.model.parent && heliFreed.nGeos > 0 && heliFreed.geos >= heliFreed.nGeos, `${heliFreed.geos}/${heliFreed.nGeos} geometries, ${heliFreed.mats}/${heliFreed.nMats} materials`);
  r.ok('restart: mid-sink is a clean new flight', !sim.aircraft.ditched && st().phase === null && sim.scene.getObjectByName('ditching').visible === false && !sim.scene.getObjectByName('rescue-boat'));

  /* ---- wheels down ---- */
  ac = await fly('skylark');
  arrive(ac, { speed: 27, sink: 1, gearDown: true });
  sim.step(0.1);
  r.ok('wheels down: a good arrival is whole, and says so', st().phase === 'slide' && st().result.gearDown, JSON.stringify(st().refused));
  const gearScore = st().result.score;
  sim.returnToAirport();
  sim.step(0.1);
  r.ok('back to the airfield: clears it', !sim.aircraft.ditched && st().phase === null);
  ac = await fly('skylark');
  arrive(ac, { speed: 27, sink: 1 });
  sim.step(0.1);
  r.ok('wheels down: cost marks against the same arrival with them up', gearScore < st().result.score, `${gearScore} v ${st().result.score}`);
  sim.quitToMenu('main');

  /* ---- a helicopter ---- */
  ac = await fly('r44');
  ac.reset({ pos: new THREE.Vector3(sea.x, 30, sea.z), headingDeg: 90, speed: 10, altAGL: null, engineOn: false, gearDown: true });
  ac._spawnOnGround = false;
  ac.pos.y = 0.6;
  ac.vel.set(8, -2, 0);
  ac.onGround = false;
  sim.override = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
  held(20, 0.05);
  r.ok('helicopter: no ditching of ours: what it always did', st().phase === null && !ac.ditched && ac.crashed, ac.crashReason);
  sim.override = null;
  sim.quitToMenu('main');

  /* ---- a mission that does not expect the sea ---- */
  await sim.startMode('mission', { id: 'circuit' });
  sim.step(0.2);
  ac = sim.aircraft;
  await sim.ditching.load();
  arrive(ac, { speed: 28, sink: 1 });
  sim.step(0.1);
  r.ok('forbidden: a mission does not change the aeroplane: still whole', st().phase === 'slide' && !ac.crashed, JSON.stringify(st().refused));
  n = 0;
  while (sim.state === 'flying' && n++ < 120) sim.step(1);
  r.ok('forbidden: the mission ends in its own words, titled for what happened as a crash is', sim.runner.status === 'failed' && title() === 'Ditched' && /ditched/i.test(debriefText()) && /everybody got out/i.test(debriefText()), `${sim.runner.status}: ${title()}`);
  sim.override = null;
  sim.quitToMenu('main');

  /* ---- a mission that ends some other way while she is afloat ---- */
  await sim.startMode('mission', { id: 'circuit' });
  sim.step(0.2);
  ac = sim.aircraft;
  arrive(ac, { speed: 28, sink: 1 });
  sim.step(0.1);
  toRest();
  sim.step(2);
  sim.runner.fail('Ran out of time');
  r.ok('card: the failure is up', sim.state !== 'flying' && /Mission not completed/.test(title()), title());
  for (let i = 0; i < 70; i++) sim.step(1);
  r.ok('card: and ours does not come up over it', /Mission not completed/.test(title()) && /Ran out of time/.test(debriefText()), `${title()}: ${debriefText().slice(0, 60)}`);
  sim.override = null;
  sim.quitToMenu('main');

  /* ---- Both Engines Out, flown badly: it says what went wrong ---- */
  await sim.startMode('mission', { id: 'both-engines-out' });
  sim.step(0.1);
  ac = sim.aircraft;
  arrive(ac, { speed: 90, sink: 1.5, flaps: 0 });
  held(6, 0.1);
  n = 0;
  while (sim.state === 'flying' && n++ < 40) await new Promise((res) => setTimeout(res, 100));
  r.ok('mission: too fast is a crash, and it fails', ac.crashed && sim.runner.status === 'failed', ac.crashReason);
  r.ok('mission: the card says which limit it was', /knots/.test(debriefText()) && /under \d+/.test(debriefText()), debriefText().replace(/\s+/g, ' ').slice(0, 170));
  sim.override = null;
  sim.quitToMenu('main');

  /* ---- Both Engines Out ---- */
  const paintBefore = (await import('../../src/core/plane-paint.js')).liveryOf(sim.settings, 'meridian');
  await sim.startMode('mission', { id: 'both-engines-out' });
  sim.step(0.1);
  ac = sim.aircraft;
  const obj = sim.hud.wrap.innerText || sim.hud.wrap.textContent;
  r.ok('mission: the goal is on the screen from the first second', /engines have failed/i.test(obj), obj.slice(0, 100));
  r.ok('mission: in the airliner, gear up, over the sea', sim.aircraftType.id === 'meridian' && !ac.gearDown && T.heightAt(ac.pos.x, ac.pos.z) < 0);
  const PP = await import('../../src/core/plane-paint.js');
  r.ok('mission: she wears Sandline Air, for this flight', sim.flightPaint === 'sandline');
  r.ok('mission: and the player\'s own paint is not touched', PP.liveryOf(sim.settings, 'meridian') === paintBefore, PP.liveryOf(sim.settings, 'meridian'));
  r.ok('mission: both engines are out', ac.failures.engine && !ac.engineOn || (sim.step(0.3), ac.failures.engine));
  r.ok('mission: there is an arrow to follow', !!sim.activeTarget, sim.runner.step.targetLabel);
  // The runway is out of reach: the gliding range is under the distance to the island.
  const glide = ac.pos.y * 14.8;
  const toField = Math.hypot(ac.pos.x, ac.pos.z);
  const lee = sim.runner.step.target();
  r.ok('mission: the calm water is in glide range and the runway is not', Math.hypot(ac.pos.x - lee.x, ac.pos.z - lee.z) < glide * 0.9 && toField > glide * 1.1, `${(glide / 1000).toFixed(1)} km glide; ${(toField / 1000).toFixed(1)} km to the field`);
  r.ok('mission: the rafts load with it', st().sceneLoaded || !!sim.ditching.load());
  // The panel must not tell you to put down the wheels the mission told you to keep up.
  ac.flaps = ac.flapsTarget = 1;
  ac.pos.y = 180;
  ac.vel.y = -4;
  sim.override = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
  sim.step(1.5);
  r.ok('mission: flaps out, low, wheels up: no GEAR NOT DOWN', !sim.warnings.isActive('gear'), sim.warnings.active().join());
  await sim.ditching.load();
  sim.runner.stepIndex = 1;
  sim.runner.advance();
  ac.pos.x = lee.x;
  ac.pos.z = lee.z;
  arrive(ac, { speed: 60, sink: 1.5, flaps: 1 });
  ac.failures.engine = true;
  sim.step(0.1);
  r.ok('mission: the ditching takes', st().phase === 'slide', JSON.stringify(st().refused));
  toRest();
  sim.step(1);
  r.ok('mission: on to the evacuation', sim.runner.step && sim.runner.step.id === 'evacuate', sim.runner.step && sim.runner.step.id);
  r.ok('mission: no pillar of light over the rafts', !(sim.destBeacon && sim.destBeacon.group && sim.destBeacon.group.visible));
  n = 0;
  while (sim.state === 'flying' && n++ < 120) sim.step(1);
  r.ok('mission: it completes, with the card and the pay', sim.runner.status === 'complete' && title() === 'Ditching' && /Credits|credits/.test(debriefText()), `${sim.runner.status}, ${title()}: ${debriefText().replace(/\s+/g, ' ').slice(0, 130)}`);
  r.ok('mission: Try again and Main menu are on it', buttons().includes('Try again') && buttons().includes('Main menu'), buttons().join());
  sim.override = null;
  sim.quitToMenu('main');
  // The paint ends with the mission, even in the same aeroplane straight after.
  const mBefore = sim.model;
  await sim.startMode('free', { ...calm, aircraft: 'meridian' });
  r.ok('mission: the next flight in that type is back in the player\'s paint', !sim.flightPaint && sim.model !== mBefore);
  sim.quitToMenu('main');
  sim.autoPauseOnHide = origAuto;
  log('done');
}
