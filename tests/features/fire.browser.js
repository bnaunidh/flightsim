/**
 * Browser checks for the wildfire: the real game, the real flight model, the
 * real keys. tests/features/fire.mjs has already flown every mission's fire
 * with a robot in node; this is the part node cannot see — that a mission
 * starts on its map in its machine with a fire burning and the water armed,
 * that X is taken only while there is water to drop, that skimming the sea
 * in the Tempest fills its tank and a hover over it fills the Skyhook's
 * bucket, that a drop on the flames puts some out, that nothing is left
 * behind when you quit, and what a fire at the cap costs a frame.
 *
 * Every import is dynamic and every name read off the namespace, the same
 * rule as selftest-three-games.js: a missing module is a failed check with a
 * name, not a suite that will not load.
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export async function check(sim, r, say) {
  let wf;
  let ext;
  let T;
  let THREE;
  try {
    wf = await import('../../src/features/wildfire.js');
    ext = await import('../../src/game/extensions.js');
    T = await import('../../src/world/terrain.js');
    THREE = await import('../../src/vendor/three.module.js');
  } catch (err) {
    r.ok('fire: the wildfire modules load', false, String(err && err.message));
    return;
  }
  const W = wf.wildfireDebug();
  const status = () => wf.fireStatus(sim);
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  /*
   * X the way a keyboard sends it: at the page, bubbling up to the window.
   * sim.tap() dispatches AT the window, where the game's own input listener
   * (registered first) hears it before the plug-in layer's capture listener
   * can take it — which a real key press never does.
   */
  const pressX = () => {
    const down = new KeyboardEvent('keydown', { code: 'KeyX', bubbles: true, cancelable: true });
    document.body.dispatchEvent(down);
    document.body.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyX', bubbles: true, cancelable: true }));
    return down;
  };
  const saidNothingToDrop = () => (sim.hud.toasts || []).some((t) => t.node && /Nothing to drop/.test(t.node.textContent));

  /* ---- registered ---------------------------------------------------- */
  const live = (ext.extStatus ? ext.extStatus() : []).find((e) => e.id === 'wildfire');
  r.ok('fire: the wildfire feature is registered and live', !!(live && live.live), JSON.stringify(live));
  const acts = ext.extDevActions ? ext.extDevActions() : [];
  r.ok('fire: Dev mode offers "Start a wildfire here"', acts.some((a) => a.label === 'Start a wildfire here'));
  let M = null;
  try {
    M = await import('../../src/game/missions.js');
  } catch (err) {
    r.ok('fire: the mission list loads', false, String(err && err.message));
  }
  const ids = ['fire-spot', 'fire-town', 'fire-bigburn', 'fire-night', 'fire-bucket', 'fire-heli-town', 'fire-ridge', 'fire-heli-night', 'fire-lineone'];
  if (M) {
    const missing = ids.filter((id) => !M.findMission(id));
    r.ok('fire: all nine fire missions are in the game', missing.length === 0, missing.join(', '));
    const heli = ids.filter((id) => M.findMission(id) && M.gameOf(M.findMission(id)) === 'heli');
    r.ok('fire: five of them are on the helicopter\'s board', heli.length === 5, heli.join(', '));
  }

  /* ---- Spot Fire: the Tempest ------------------------------------------ */
  say('fire: Spot Fire');
  await sim.startAnyMission('fire-spot');
  sim.step(0.5);
  let s = status();
  r.ok('fire: Spot Fire starts flying the Tempest', sim.state === 'flying' && sim.aircraftType.id === 'tempest', `${sim.state}, ${sim.aircraftType && sim.aircraftType.id}`);
  r.ok('fire: …with a fire burning', s.live && s.burning > 0, `${s.burning} cells`);
  r.ok('fire: …and a scooping tank, empty', s.kind === 'scooper' && s.capacity >= 2000 && s.litres === 0, `${s.kind} ${s.capacity} L`);
  const fill = W.fill;
  r.ok('fire: the fill lane is on open sea', !!fill && T.heightAt(fill.x, fill.z) < -3, fill ? `(${Math.round(fill.x)}, ${Math.round(fill.z)}) depth ${(-T.heightAt(fill.x, fill.z)).toFixed(0)} m` : 'none');
  r.ok('fire: the lane is drawn', W.fillMark && W.fillMark.mesh.visible);
  r.ok('fire: flames, a smoke column and scorched ground are drawn', W.flames.geo.instanceCount > 0 && W.plumes.alive > 20 && !!W.scar, `${W.flames.geo.instanceCount} flames, ${W.plumes.alive} puffs`);
  const panel = W.hud && W.hud.el;
  r.ok('fire: the fire panel is up', !!panel && !panel.hidden && /contained/i.test(panel.textContent) && /TANK/.test(panel.textContent), panel ? panel.textContent.replace(/\s+/g, ' ').slice(0, 90) : 'none');
  const step0 = sim.runner.step;
  const tgt0 = sim.runner.activeTarget();
  r.ok('fire: step one is the water, and the arrow points at it', step0 && step0.id === 'fill' && tgt0 && fill && Math.hypot(tgt0.pos.x - fill.x, tgt0.pos.z - fill.z) < 5);

  // X with nothing aboard: taken by the feature, nothing leaves.
  const ev = pressX();
  sim.step(0.1);
  r.ok('fire: X is the water key while a tank is armed', ev.defaultPrevented && !W.tank.releasing && !saidNothingToDrop(), saidNothingToDrop() ? 'the game said "Nothing to drop"' : '');

  // The scoop, in the real flight model: 25 m over the lane at 100 kt, flaps out.
  const hdg = ((fill.heading || 0) * 180) / Math.PI;
  const ux = Math.sin(fill.heading || 0);
  const uz = -Math.cos(fill.heading || 0);
  const ac = sim.aircraft;
  ac.reset({ pos: V(fill.x - ux * 350, 0, fill.z - uz * 350), headingDeg: hdg, speed: 52, altAGL: 25 - T.heightAt(fill.x - ux * 350, fill.z - uz * 350), engineOn: true, gearDown: false });
  ac.setFlaps(1);
  ac.flaps = ac.flapsTarget;
  ac.controls.throttle = 0.55;
  sim.input.throttleTarget = 0.55;
  let filling = false;
  let lowest = Infinity;
  for (let k = 0; k < 16 && W.tank.litres < W.tank.capacity - 1; k++) {
    sim.step(0.5);
    filling = filling || W.tank.filling;
    lowest = Math.min(lowest, ac.pos.y);
  }
  s = status();
  r.ok('fire: skimming the sea with the flaps out fills the tank', filling && s.litres > s.capacity * 0.5 && !ac.crashed, `${Math.round(s.litres)} L, lowest ${lowest.toFixed(0)} m, ${ac.crashed ? 'CRASHED ' + ac.crashReason : 'flying'}${W.tank.fillWhy ? ', ' + W.tank.fillWhy : ''}`);
  sim.step(0.5);
  r.ok('fire: a full tank moves the mission on to the drop', sim.runner.step && sim.runner.step.id !== 'fill', sim.runner.step && sim.runner.step.id);

  // The drop: run in along the line from the water, 45 m over the fire.
  W.tank.litres = W.tank.capacity;
  const t = wf.dropPoint();
  const before = status().burning;
  if (t) {
    let dx = t.x - fill.x;
    let dz = t.z - fill.z;
    const L = Math.hypot(dx, dz) || 1;
    dx /= L;
    dz /= L;
    const start = { x: t.x - dx * 170, z: t.z - dz * 170 };
    let top = 0;
    for (let k = 0; k <= 10; k++) top = Math.max(top, T.heightAt(start.x + dx * k * 30, start.z + dz * k * 30));
    ac.reset({ pos: V(start.x, 0, start.z), headingDeg: (Math.atan2(dx, -dz) * 180) / Math.PI, speed: 50, altAGL: top + 45 - T.heightAt(start.x, start.z), engineOn: true, gearDown: false });
    ac.controls.throttle = 0.6;
    sim.input.throttleTarget = 0.6;
    sim.step(0.2);
    pressX();
    const released = W.tank.releasing;
    sim.step(7);
    s = status();
    r.ok('fire: X lets the water go, and only the water', released && s.drops === 1 && !saidNothingToDrop(), `releasing ${released}, drops ${s.drops}${saidNothingToDrop() ? ', and the game said "Nothing to drop"' : ''}`);
    r.ok('fire: a drop on the flames puts some of them out', s.hits >= 1 && s.burning < before, `${before} → ${s.burning} burning, ${s.hits} hit`);
    r.ok('fire: …and the ground it lands on is soaked', W.grid.wet.some((w) => w > W.grid.time));
  } else {
    r.ok('fire: there is somewhere to drop', false, 'no target');
  }
  r.ok('fire: the runway and the sea do not burn', !W.grid.canBurn(0, 0) && !W.grid.canBurn(fill.x, fill.z));

  sim.quitToMenu('main');
  s = status();
  r.ok('fire: quitting puts the fire out and takes the panel down', !s.live && s.burning === 0 && W.hud.el.hidden && !W.fillMark.mesh.visible);
  r.ok('fire: …and the water\'s weight off the aeroplane', (sim.aircraft.extraMass || 0) === 0, `${sim.aircraft.extraMass} kg`);

  /* ---- Bucket Brigade: the Skyhook ------------------------------------- */
  say('fire: Bucket Brigade');
  await sim.startAnyMission('fire-bucket');
  sim.step(0.5);
  s = status();
  const heli = sim.aircraft;
  r.ok('fire: Bucket Brigade flies the Skyhook with a bucket', sim.aircraftType.id === 'harrier' && s.kind === 'bucket' && W.bucket.group.visible, `${sim.aircraftType.id} ${s.kind}`);
  const lying = Math.hypot(W.bucket.pos.x - heli.pos.x, W.bucket.pos.z - heli.pos.z);
  r.ok('fire: on the pad the bucket lies behind it, not inside it', lying > 5, `${lying.toFixed(1)} m away`);
  // Hover 17 m over the ring. The helicopter's controls belong to another
  // file and are being rebuilt, so the hover is held here, not flown: this is
  // a check on the bucket, not on the pilot.
  const bf = W.fill;
  // Arriving by teleport from the pad a kilometre away would leave the
  // bucket at the far end of its line, swinging in from the horizontal.
  const arrive = () => { W.bucket.ready = false; };
  const hold = (x, y, z, secs) => {
    for (let k = 0; k < secs * 10; k++) {
      heli.pos.set(x, y, z);
      heli.vel.set(0, 0, 0);
      heli.omega.set(0, 0, 0);
      heli.quat.identity();
      sim.step(0.1);
    }
  };
  heli.pos.set(bf.x, 17, bf.z);
  arrive();
  hold(bf.x, 17, bf.z, 7);
  s = status();
  r.ok('fire: a low hover over the sea fills the bucket', s.litres > s.capacity * 0.9 && !heli.crashed, `${Math.round(s.litres)} L, bucket ${W.bucket.pos.y.toFixed(1)} m, ${W.tank.fillWhy || 'no complaint'}`);
  r.ok('fire: the bucket\'s water is carried as weight', Math.abs((heli.extraMass || 0) - s.litres) < 20, `${Math.round(heli.extraMass || 0)} kg for ${Math.round(s.litres)} L`);
  const bt = wf.dropPoint();
  const b0 = status().burning;
  if (bt) {
    const gy = T.heightAt(bt.x, bt.z);
    heli.pos.set(bt.x, gy + 30, bt.z);
    arrive();
    hold(bt.x, gy + 30, bt.z, 3);
    pressX();
    hold(bt.x, gy + 30, bt.z, 5);
    s = status();
    r.ok('fire: a bucket let go over the fire puts some out', s.hits >= 1 && s.burning < b0, `${b0} → ${s.burning}, ${s.hits} hit`);
  }
  sim.quitToMenu('main');

  /* ---- Night ------------------------------------------------------------ */
  say('fire: Night Watch');
  await sim.startAnyMission('fire-heli-night');
  sim.step(0.5);
  r.ok('fire: a night fire glows', sim.weather.isNight && W.scar && W.scar.mat.uniforms.uNight.value === 1 && W.flames.mat.uniforms.uOpaque.value < 0.5);
  r.ok('fire: the forest missions plant their wood', !!(W.woods && W.woods.count > 200), `${W.woods ? W.woods.count : 0} trees`);
  sim.quitToMenu('main');

  /* ---- Line One ----------------------------------------------------------- */
  say('fire: Line One');
  await sim.startAnyMission('fire-lineone');
  sim.step(0.5);
  s = status();
  const lf = W.fill;
  r.ok('fire: Line One is on Firewatch Ridge with its break drawn', T.MAP.id === 'firewatch' && !!W.breakLine && W.breakLine.mesh.parent === W.group);
  r.ok('fire: …its water is open sea within reach of the line', !!lf && T.heightAt(lf.x, lf.z) < -10 && Math.hypot(lf.x - 250, lf.z + 700) < 1500, lf ? `(${Math.round(lf.x)}, ${Math.round(lf.z)})` : 'none');
  r.ok('fire: …and the crews\' clock is on the panel', /Fire crews here in/.test(W.hud.el.textContent), W.hud.el.textContent.replace(/\s+/g, ' ').slice(0, 120));
  sim.quitToMenu('main');
  r.ok('fire: quitting takes the break away', !W.breakLine);

  /* ---- Dev: a fire in free flight, and what one at the cap costs ---------- */
  say('fire: Dev fire and the cap');
  const dev = acts.find((a) => a.label === 'Start a wildfire here');
  if (dev) dev.run(sim); // from the menu: queued for the next flight
  await sim.startMode('free', { time: 'day', condition: 'clear', windSpeedKts: 8, windDirDeg: 270, airborne: true });
  sim.step(0.5);
  s = status();
  r.ok('fire: the Dev button lights a fire on the next flight, with water armed', s.live && s.burning > 0 && !!s.kind, `${s.burning} burning, ${s.kind}`);
  // Everything at once: a fire bigger than the cap allows.
  const g = W.grid;
  const c = g.centroid({ x: 0, z: 0 });
  for (let k = 0; k < 12; k++) g.ignite(c.x + Math.cos(k) * 600, c.z + Math.sin(k) * 600, 260);
  g.ignite(c.x, c.z, 400);
  sim.step(1);
  r.ok('fire: the cap holds', g.burning <= g.maxBurning, `${g.burning} of ${g.maxBurning}`);
  const upd = wf.__test && wf.__test.update;
  const N = 90;
  let ms = 0;
  if (upd) {
    const t0 = performance.now();
    for (let k = 0; k < N; k++) upd(sim, 1 / 30);
    ms = (performance.now() - t0) / N;
  }
  sim.camera.position.set(c.x + 900, T.heightAt(c.x + 900, c.z) + 250, c.z);
  sim.camera.lookAt(c.x, 50, c.z);
  sim.camera.updateMatrixWorld();
  sim.renderer.render(sim.scene, sim.camera);
  const info = sim.renderer.info.render;
  // Measured on the 2019 Chromebook's stand-in (see the header of
  // wildfire.js): the fire's own frame work at the cap must leave the game
  // most of its 33 ms. 3 ms here is about 12 ms there, the ceiling.
  r.ok('fire: a fire at the cap costs the frame little', ms < 3, `${ms.toFixed(2)} ms a frame for ${g.burning} burning cells, ${W.plumes.alive} puffs, ${W.flames.geo.instanceCount} flames; scene ${info.calls} draw calls`);
  const menu = W.hud;
  sim.quitToMenu('main');
  r.ok('fire: nothing left burning after Free Flight', !status().live && menu.el.hidden);

  sim.autoPauseOnHide = origAuto;
}
