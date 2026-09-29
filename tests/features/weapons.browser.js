/**
 * Browser checks for the weapons work — explosions and meteor mode — run in
 * the real game by tests/selftest.js (through tests/features/index.js), or on
 * their own from the console:
 *
 *   const W = await import('./tests/features/weapons.browser.js');
 *   const r = { checks: [], ok(n, p, d = '') { this.checks.push({ n, p: !!p, d: String(d) }); return !!p; } };
 *   await W.check(window.__sim, r, console.log);
 *   console.table(r.checks);
 *
 * Every import is dynamic and inside a try, the way the three-games suite
 * does it: a missing module is a failed check with a name, not a dead suite.
 * Like the rest of the suite this cannot see pixels — it checks that the
 * effect meshes exist, are in the scene and are switched on, that the
 * missions start what they say they start, and what the game object reports.
 */

export async function check(sim, r, say) {
  const log = (s) => {
    try {
      if (say) say(s);
    } catch (e) {
      /* a reporter that cannot print is not a failure */
    }
  };
  let FX;
  let EXT;
  let MIS;
  let Terrain;
  try {
    EXT = await import('../../src/game/extensions.js');
    FX = await import('../../src/features/explosions.js');
    MIS = await import('../../src/game/missions.js');
    Terrain = await import('../../src/world/terrain.js');
  } catch (err) {
    r.ok('weapons: the modules load in the page', false, String(err && err.message));
    return;
  }

  const status = EXT.extStatus();
  r.ok('weapons: the explosions feature is loaded and live', status.some((s) => s.id === 'explosions' && s.live), JSON.stringify(status));
  r.ok('weapons: the meteor feature is loaded and live', status.some((s) => s.id === 'meteor' && s.live), JSON.stringify(status));
  r.ok('weapons: sim.explode and sim.meteors are on the game', typeof sim.explode === 'function' && !!sim.meteors);
  const ids = ['meteor-shower', 'meteor-dodge', 'meteor-town', 'meteor-photo'];
  r.ok('weapons: the four meteor missions are in the missions list', ids.every((id) => MIS.findMission(id) && MIS.findMission(id).category === 'meteor'));
  const cards = ids.filter((id) => document.querySelector(`[data-mission="${id}"]`));
  r.ok('weapons: and each has a card on the Missions screen', cards.length === 4, cards.join(', '));

  const oldAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const step = (s) => sim.step(s, 1 / 60);
  const ahead = (m) => {
    const ac = sim.aircraft;
    const h = (ac.heading * Math.PI) / 180;
    const x = ac.pos.x + Math.sin(h) * m;
    const z = ac.pos.z - Math.cos(h) * m;
    return { x, y: Terrain.heightAt(x, z), z };
  };

  try {
    /* ---------------- A bang, in the real scene ---------------- */
    log('weapons: explosions');
    await sim.startMode('free', { airborne: true, time: 'day', condition: 'clear', windSpeedKts: 5, windDirDeg: 100 });
    // Over the island, so it is a ground blast with a scorch mark.
    sim.aircraft.reset({ pos: sim.aircraft.pos.clone().set(-1600, 0, 200), headingDeg: 90, speed: 60, altAGL: 350, engineOn: true });
    step(0.2);
    const res = FX.explode(sim, ahead(700), { size: 1 });
    step(0.1);
    const s1 = FX.explosionStats();
    r.ok('weapons: one blast makes fire, smoke, debris, a scorch mark and light', !!res && s1.glow > 15 && s1.smoke > 10 && s1.debris > 3 && s1.decals >= 1 && s1.light > 0,
      JSON.stringify({ kind: res && res.kind, water: res && res.water, glow: s1.glow, smoke: s1.smoke, debris: s1.debris, decals: s1.decals, light: Math.round(s1.light) }));
    const shown = [];
    sim.scene.traverse((o) => {
      if (/^fx-/.test(o.name) && o.visible) shown.push(o.name);
    });
    r.ok('weapons: its meshes are in the scene and switched on', ['fx-glow', 'fx-smoke', 'fx-debris', 'fx-decals'].every((n) => shown.includes(n)), shown.join(', '));
    // Heard when the sound would get there, in the real loop.
    let heard = null;
    for (let t = 0.1; t < 6 && heard === null; t += 1 / 60) {
      sim.update(1 / 60);
      const lb = FX.explosionStats().lastBoom;
      if (lb && lb.id === res.id) heard = { at: lb.at, expected: lb.expected };
    }
    r.ok('weapons: the boom is heard about when the sound gets there', heard && Math.abs(heard.at - heard.expected) < 0.25,
      heard ? `${heard.at.toFixed(2)} s, sound needs ${heard.expected.toFixed(2)} s` : 'never heard');

    // Twenty in a row: what the frame costs, in the real game.
    /*
     * The median frame, not the mean. The full self-test on a Mac whose CPU
     * governor pauses busy processes in slices measured 5.56 ms for a
     * "quiet" frame (0.24 ms on the same Mac unloaded) and failed this at
     * 9.83 ms busy: a few paused frames in 240 carry the mean. A school
     * laptop running something else is the same case. The node suite
     * measures its frame costs by median for the same reason.
     */
    const frames = (n) => {
      const t = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        sim.update(1 / 60);
        t[i] = performance.now() - t0;
      }
      t.sort();
      return t[n >> 1];
    };
    FX.clearExplosions();
    frames(30);
    const quiet = frames(120);
    for (let i = 0; i < 20; i++) FX.scheduleExplosion(ahead(500 + i * 80), { size: 1 }, i * 0.15);
    const busy = frames(240);
    r.ok('weapons: twenty blasts in a row add under 3 ms to a frame', busy - quiet < 3, `${quiet.toFixed(2)} ms quiet, ${busy.toFixed(2)} ms with twenty going off`);
    step(0.1);

    /* ---------------- The practice bomb ---------------- */
    log('weapons: practice bomb');
    await sim.startMode('free', { aircraft: 'nightjar', airborne: true, time: 'day', condition: 'clear', windSpeedKts: 5, windDirDeg: 100 });
    r.ok('weapons: free flight in the bomber comes with the rack loaded', sim.hasCargo === true, `hasCargo ${sim.hasCargo}`);
    sim.aircraft.reset({ pos: sim.aircraft.pos.clone().set(-1800, 0, 250), headingDeg: 90, speed: 70, altAGL: 250, engineOn: true });
    step(0.2);
    // Count main.js's instant thunder clip: the boom is explosions.js's now,
    // at the speed of sound, and the clip must not play on top of it.
    let thunders = 0;
    const amb = sim.audio && sim.audio.ambience;
    const origThunder = amb && amb.playThunder;
    if (amb && origThunder) {
      amb.playThunder = (...a) => {
        thunders++;
        return origThunder.apply(amb, a);
      };
    }
    const dropped = sim.dropCargo();
    const bomb = sim.crate;
    r.ok('weapons: X lets a practice bomb go', dropped && !!bomb && !!bomb.fire);
    let whistled = false;
    let camOn = false;
    let t = 0;
    try {
      while (bomb && !bomb.landed && t < 30) {
        step(0.25);
        t += 0.25;
        if (FX.explosionStats().whistling) whistled = true;
      }
      step(0.2);
      camOn = FX.explosionStats().bombCam;
    } finally {
      if (amb && origThunder) amb.playThunder = origThunder;
    }
    const s2 = FX.explosionStats();
    r.ok('weapons: it goes off through explode() when it lands', bomb && bomb.landed && s2.blasts >= 1, `landed ${bomb && bomb.landed} after ${t} s, blasts ${s2.blasts}`);
    r.ok("weapons: the bomb's old sphere and ring are switched off", bomb && ['fire', 'ring', 'dust', 'scorch'].every((k) => bomb[k].material.visible === false));
    r.ok('weapons: one boom, not the old instant thunder clip as well', thunders === 0, `${thunders} thunder clips`);
    r.ok('weapons: the bomb cam cuts to it landing', camOn, `bomb cam ${camOn ? 'on' : 'never came on'}`);
    if (sim.audio && sim.audio.available) r.ok('weapons: it whistled on the way down', whistled);
    // C is the game's camera key: the bomb cam takes no key. Changing the
    // view by any route skips it — here the touch screen's camera button.
    const fxExt = EXT.extensions().find((e) => e.id === 'explosions');
    r.ok('weapons: the bomb cam takes no key (C stays the camera key)', !!fxExt && typeof fxExt.key !== 'function');
    const view0 = sim.rig.mode;
    if (typeof sim.hudAction === 'function') sim.hudAction('camera');
    else sim.rig.cycle();
    step(1 / 60);
    r.ok('weapons: changing the view skips the bomb cam at once', camOn && !FX.explosionStats().bombCam && sim.rig.mode !== view0,
      `view ${view0} -> ${sim.rig.mode}, bomb cam ${FX.explosionStats().bombCam}`);
    sim.rig.setMode(view0);
    // The next store comes off the rack three seconds after the last landed.
    step(3.5);
    sim.aircraft.reset({ pos: sim.aircraft.pos.clone().set(-1800, 0, 250), headingDeg: 90, speed: 70, altAGL: 250, engineOn: true });
    step(0.2);
    const dropped2 = sim.dropCargo();
    const bomb2 = sim.crate;
    let t2 = 0;
    while (bomb2 && !bomb2.landed && t2 < 30) {
      step(0.25);
      t2 += 0.25;
    }
    step(0.2);
    const cam2 = FX.explosionStats().bombCam;
    step(3.2);
    r.ok('weapons: left alone, the bomb cam hands the camera back after 3.2 s', dropped2 && cam2 && !FX.explosionStats().bombCam,
      `second store ${dropped2 ? 'dropped' : 'not dropped'}, cam ${cam2 ? 'on' : 'never on'} then ${FX.explosionStats().bombCam ? 'still on' : 'off'}`);

    /* ---------------- Meteor Shower ---------------- */
    log('weapons: meteor shower');
    await sim.startMode('mission', { id: 'meteor-shower' });
    r.ok('weapons: Meteor Shower starts meteor mode, in the Courier, at sunset',
      sim.meteors.active && sim.meteors.mode === 'shower' && sim.aircraftType.id === 'courier' && sim.weather.time === 'sunset',
      `${sim.meteors.mode}, ${sim.aircraftType.id}, ${sim.weather.time}`);
    for (let i = 0; i < 20; i++) step(1);
    const st = sim.meteors.stats;
    r.ok('weapons: twenty seconds in, meteors have come and gone', st.spawned >= 6 && st.burned + st.landed >= 3, JSON.stringify({ spawned: st.spawned, burned: st.burned, landed: st.landed }));
    const rocks = [];
    sim.scene.traverse((o) => {
      if (o.name === 'meteor-rocks') rocks.push(o);
    });
    r.ok('weapons: the rocks are one instanced mesh in the scene', rocks.length === 1 && rocks[0].isInstancedMesh);
    const ui = document.getElementById('meteor-ui');
    r.ok('weapons: the meteor panel is on screen', !!ui && !ui.hidden && /Stardust/.test(ui.textContent), ui ? ui.textContent.slice(0, 80) : 'no #meteor-ui');
    const zapBtn = ui && ui.querySelector('.mt-zap');
    const touch = document.documentElement.classList.contains('is-touch-device');
    const keysLine = ui && ui.querySelector('.mt-keys');
    if (touch) r.ok('weapons: on a touch screen there is a ZAP button', !!zapBtn && !zapBtn.hidden);
    else {
      r.ok('weapons: on a keyboard the ZAP button stays off the minimap and the panel says Z', !!zapBtn && zapBtn.hidden && !!keysLine && /Z/.test(keysLine.textContent),
        keysLine ? keysLine.textContent : 'no keys line');
    }
    // Z zaps the one in front.
    const ac = sim.aircraft;
    const front = ahead(900);
    front.y = ac.pos.y + 20;
    sim.meteors.spawn({ target: front, az: ac.heading + 180, dive: 8, speed: 90, T: 4, radius: 3, size: 1.5 });
    step(0.05);
    const zBefore = st.zapped;
    sim.key('KeyZ', true);
    sim.key('KeyZ', false);
    step(0.05);
    r.ok('weapons: pressing Z zaps the meteor ahead', sim.meteors.stats.zapped === zBefore + 1, `zapped ${sim.meteors.stats.zapped}`);
    // A big one gets a marker and a warning line.
    const big = sim.meteors.spawnLander(true);
    step(0.3);
    const markerOn = big && big.marker >= 0;
    const warnEl = ui && ui.querySelector('.mt-warn');
    r.ok('weapons: a big one gets a light where it lands and a countdown', markerOn && warnEl && !warnEl.hidden && /BIG ONE/.test(warnEl.textContent), warnEl ? warnEl.textContent : '');

    /* ---------------- Photograph the Big One ---------------- */
    log('weapons: photo');
    await sim.startMode('mission', { id: 'meteor-photo' });
    r.ok('weapons: the photo mission is at night in the Tempest', sim.weather.time === 'night' && sim.aircraftType.id === 'tempest');
    for (let i = 0; i < 9; i++) step(1);
    const gpos = sim.meteors.giantPos();
    const giant = sim.meteors.meteors().find((m) => m.giant);
    r.ok('weapons: the giant has arrived, heading for the sea', !!gpos && giant && giant.water);
    if (giant) {
      // Put the aeroplane 1.2 km behind it, at its height, pointing at it.
      const p = giant.pos.clone().addScaledVector(giant.dir, -1200);
      const hdg = (Math.atan2(giant.dir.x, -giant.dir.z) * 180) / Math.PI;
      sim.aircraft.reset({ pos: p.clone().setY(0), headingDeg: (hdg + 360) % 360, speed: 70, altAGL: p.y - Terrain.heightAt(p.x, p.z), engineOn: true });
      sim.rig.setMode('chase');
      for (let i = 0; i < 10; i++) step(0.25);
    }
    const ps = sim.meteors.stats;
    r.ok('weapons: holding it in the picture takes the photo', ps.photoTaken, `quality ${ps.photoQuality}%, ${ps.photoDistance} m`);
    const card = ui && ui.querySelector('.mt-photo');
    r.ok('weapons: and the photo card shows the real game screen', !!card && card.style.display === 'block' && !!card.querySelector('canvas'));

    /* ---------------- Rock Dodger ---------------- */
    log('weapons: dodge');
    await sim.startMode('mission', { id: 'meteor-dodge' });
    step(0.5);
    const a2 = sim.aircraft;
    const T = 4;
    const at = a2.pos.clone().addScaledVector(a2.vel, T);
    sim.meteors.spawn({ target: at, az: a2.heading + 180, dive: 35, speed: 200, T, radius: 4, size: 1.6, threat: true });
    const shields0 = sim.meteors.stats.shields;
    for (let i = 0; i < 6; i++) step(1);
    r.ok('weapons: a rock straight at you costs a shield, not the aeroplane', sim.meteors.stats.shields === shields0 - 1 && !sim.aircraft.crashed && sim.runner.status === 'running',
      `shields ${shields0} -> ${sim.meteors.stats.shields}, runner ${sim.runner.status}`);
    r.ok('weapons: Rock Dodger has no zapper (Z is left for everyone else)', !ui.querySelector('.mt-zap') || ui.querySelector('.mt-zap').hidden);

    /* ---------------- Guard the Town ---------------- */
    log('weapons: town');
    await sim.startMode('mission', { id: 'meteor-town' });
    for (let i = 0; i < 12; i++) step(1);
    let townMarkers = 0;
    sim.meteors.meteors().forEach((m) => {
      if (m.town && m.marker >= 0) townMarkers++;
    });
    r.ok('weapons: rocks for the town are coming, each with a landing marker', townMarkers >= 1 && sim.runner.status === 'running', `${townMarkers} marked`);
    r.ok('weapons: the HUD arrow points at the nearest rock', sim.activeTarget && sim.activeTarget.label === 'Incoming rock', sim.activeTarget ? sim.activeTarget.label : 'none');
    // One that gets through lands as a thud — dust and stars — not a fireball.
    const town = sim.meteors.town();
    const thuds0 = FX.explosionStats().thuds;
    const inTown0 = sim.meteors.stats.landedTown;
    const hit = { x: town.x, y: Terrain.heightAt(town.x, town.z), z: town.z };
    sim.meteors.spawn({ target: hit, az: 225, dive: 18, speed: 160, T: 1.5, radius: 4, size: 2, town: true });
    step(2);
    r.ok('weapons: a rock that lands in town goes thud, not bang', FX.explosionStats().thuds === thuds0 + 1 && sim.meteors.stats.landedTown === inTown0 + 1,
      `thuds ${thuds0} -> ${FX.explosionStats().thuds}, in town ${inTown0} -> ${sim.meteors.stats.landedTown}`);
  } catch (err) {
    r.ok('weapons: the checks ran to the end', false, String(err && err.stack));
  } finally {
    try {
      sim.quitToMenu('main');
      const ui = document.getElementById('meteor-ui');
      r.ok('weapons: back at the menu, the meteors and their panel are gone', !sim.meteors.active && (!ui || ui.hidden) && FX.explosionStats().blasts === 0);
    } catch (err) {
      r.ok('weapons: can get back to the menu', false, String(err && err.message));
    }
    sim.autoPauseOnHide = oldAuto;
  }
}
