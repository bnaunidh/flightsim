/**
 * THE SLIDE AND THE SEA on the real game: a real slide's distance by speed and
 * by what it is on, a wreck that goes under with the lens after it, the sea bed
 * loaded only when it is wanted, and everything put back on a restart and on
 * quitting to the menu. tests/features/water-crash.mjs holds the pure part.
 *
 * `check(sim, r, say)`, as tests/features/index.js expects.
 */
export async function check(sim, r, say = () => {}) {
  const bu = await import('../../src/features/breakup.js');
  const cr = await import('../../src/features/crashes.js');
  const T = await import('../../src/world/terrain.js');
  const THREE = await import('../../src/vendor/three.module.js');
  const D = () => bu.breakupDebug();
  const noDebrief = () => clearTimeout(sim._crashDebriefT);
  const yieldNow = () => new Promise((res) => setTimeout(res, 0));
  const autoWas = sim.autoPauseOnHide;
  const comicWas = sim.settings.comicEffects;
  sim.autoPauseOnHide = false;
  const fly = async (id = 'skylark') => {
    await sim.startMode('free', { airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 0, aircraft: id });
    sim.step(0.3);
    sim.rig.setMode('chase');
  };
  const openSea = (deep) => {
    for (let rr = 2000; rr < 22000; rr += 400) {
      for (let a = 0; a < 16; a++) {
        const x = Math.cos(a) * rr;
        const z = Math.sin(a) * rr;
        let ok = true;
        for (let d = -300; d <= 900 && ok; d += 100) if (T.heightAt(x + d, z) > -deep || T.platformAt(x + d, z)) ok = false;
        if (ok) return { x, z };
      }
    }
    return null;
  };
  /** Into the sea at this speed and rate of descent. */
  const intoSea = (spot, fwd, down, pitch = -8) => {
    const ac = sim.aircraft;
    ac.reset({ pos: new THREE.Vector3(spot.x - 30, 0, spot.z), headingDeg: 90, speed: Math.hypot(fwd, down), altAGL: 4, engineOn: true, gearDown: true });
    ac.quat.setFromEuler(new THREE.Euler((pitch * Math.PI) / 180, -Math.PI / 2, 0, 'YXZ'));
    ac.vel.set(fwd, -down, 0);
    ac.pos.y = 2 + down * 0.1;
    ac.onGround = false;
    ac._spawnOnGround = false;
    sim.override = { pitch: -0.5, roll: 0, yaw: 0, throttle: 0 };
    for (let i = 0; i < 240 && !ac.crashed; i++) {
      sim.update(1 / 60);
      noDebrief();
    }
    sim.override = null;
    noDebrief();
    return ac.crashed;
  };
  /** The game's 30 Hz, the card falling due at 2.2 s as main.js has it. Returns when the card is up, or at `max`. */
  const untilCard = async (max = 16, each = null) => {
    const ac = sim.aircraft;
    let t = 0;
    let due = true;
    while (t < max && sim.state !== 'debrief') {
      sim.update(1 / 30);
      t += 1 / 30;
      noDebrief();
      if (due && t >= 2.2) {
        due = false;
        sim.showCrashDebrief(ac.crashReason);
      }
      if (each) each(t);
      await yieldNow();
    }
    return t;
  };
  const belly = (x, z, fwd) => {
    const ac = sim.aircraft;
    const y = T.heightAt(x, z);
    ac.reset({ pos: new THREE.Vector3(x, 0, z), headingDeg: 90, speed: fwd, altAGL: 3, engineOn: true, gearDown: false });
    ac.quat.setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0, 'YXZ'));
    ac.pos.y = y + 1.2;
    ac.vel.set(fwd, -2, 0);
    ac.onGround = false;
    ac.crash('The belly hit the ground', { worldPoint: ac.pos.clone().setY(y + 0.3), part: 'fuselage' });
    noDebrief();
  };
  const slideFrom = async (x, z, fwd) => {
    await fly();
    sim.crashSeed = 5;
    belly(x, z, fwd);
    const a = sim.aircraft.pos.clone();
    for (let i = 0; i < 30 * 26 && (D().S.hull || i < 3); i++) {
      sim.update(1 / 30);
      noDebrief();
      if (i % 6 === 0) await yieldNow();
    }
    return sim.aircraft.pos.distanceTo(a);
  };
  try {
    sim.applySetting('comicEffects', false);

    /* ---- slides ---- */
    say('water-crash: slides');
    const runwayX = -420;
    const slow = await slideFrom(runwayX, 0, 28);
    const fast = await slideFrom(runwayX, 0, 62);
    r.ok('water-crash: a fast slide on the runway goes much further than a slow one', fast > slow * 2.2 && fast > 180, `${slow.toFixed(0)} m from 28 m/s, ${fast.toFixed(0)} m from 62`);
    let grassAt = null;
    for (let rr = 300; rr < 9000 && !grassAt; rr += 90) {
      for (let a = 0; a < 24 && !grassAt; a++) {
        const x = Math.cos(a) * rr;
        const z = Math.sin(a) * rr;
        const h = T.heightAt(x, z);
        if (h < 22 || T.isPaved(x, z)) continue;
        let flat = true;
        for (let d = 0; d <= 320 && flat; d += 30) if (Math.abs(T.heightAt(x + d, z) - h) > 6 || T.isPaved(x + d, z) || T.obstacleAt(x + d, h + 3, z)) flat = false;
        if (flat) grassAt = { x, z };
      }
    }
    if (grassAt) {
      const grass = await slideFrom(grassAt.x, grassAt.z, 62);
      r.ok('water-crash: the same crash stops sooner on grass than on the runway', grass < fast * 0.85, `${grass.toFixed(0)} m on grass, ${fast.toFixed(0)} m on concrete`);
    } else r.ok('water-crash: a flat bit of grass to slide on', false, 'none found');
    r.ok('water-crash: a slide on land fetches nothing of the sea', D().under.loads === 0 && !D().under.on, JSON.stringify(D().under));
    r.ok('water-crash: nor does flying over it', !performance.getEntriesByType('resource').some((e) => /underwater\/index\.js/.test(e.name)));
    const sc = D().scars;
    r.ok('water-crash: it leaves a mark along the way it went', !!sc && sc.stations >= 8 && sc.visible, JSON.stringify(sc));
    r.ok('water-crash: the follow view is told it may have its lens back after a slide', sim.state === 'flying' || sim.state === 'debrief');

    /* ---- the card waits, briefly ---- */
    say('water-crash: the card after a slide');
    await fly();
    belly(runwayX, 0, 62);
    let cardAt = await untilCard(14);
    r.ok('water-crash: the card waits for a slide, and no longer than ten seconds', sim.state === 'debrief' && cardAt > 3 && cardAt <= 10.1, `${cardAt.toFixed(1)} s`);
    const skipGone = !document.querySelector('[data-crash-skip]');
    r.ok('water-crash: no Skip button is left on the card', skipGone);

    /* ---- under ---- */
    say('water-crash: under');
    const spot = openSea(20);
    if (!spot) throw new Error('no open sea');
    await fly();
    sim.crashSeed = 9;
    const crashed = intoSea(spot, 66, 18);
    r.ok('water-crash: into the sea it is the crash, not a ditching', crashed && !sim.aircraft.ditched, sim.aircraft.crashReason);
    const seen = { minY: Infinity, topUnder: false, camUnder: false, lensEarly: 0, lensMoved: 0, last: null, far: 0 };
    cardAt = await untilCard(15, () => {
      const k = D().S.sink;
      seen.minY = Math.min(seen.minY, sim.aircraft.pos.y);
      if (k && k.last && sim.aircraft.pos.y + (k.last.highest || 0) < -0.3) seen.topUnder = true;
      if (sim.camera.position.y < -0.5) seen.camUnder = true;
      if (D().view && D().view.owning) seen.far = Math.max(seen.far, Math.hypot(sim.camera.position.x - sim.aircraft.pos.x, sim.camera.position.z - sim.aircraft.pos.z));
      if (sim.camera.position.y < -0.5 && !seen.topUnder) seen.lensEarly = (seen.lensEarly || 0) + 1;
      const dv = D().view;
      if (dv && dv.owning && sim.camera.position.y > 0 && seen.last) seen.lensMoved = Math.max(seen.lensMoved, sim.camera.position.distanceTo(seen.last));
      seen.last = dv && dv.owning && sim.camera.position.y > 0 ? sim.camera.position.clone() : null;
      if (seen.camUnder) sim.renderFrame();
    });
    r.ok('water-crash: the wreck goes under, all of it', seen.topUnder && seen.minY < -2, `lowest ${seen.minY.toFixed(1)} m`);
    r.ok('water-crash: the lens follows it through the surface', seen.camUnder, `camera ${sim.camera.position.y.toFixed(1)} m`);
    r.ok('water-crash: the card comes inside thirteen seconds', sim.state === 'debrief' && cardAt <= 13, `${cardAt.toFixed(1)} s`);
    r.ok('water-crash: with Reduce flashing the lens never moved over the water, it stood still and went under in one', seen.lensMoved < 0.6, `${seen.lensMoved.toFixed(2)} m at most in a frame over the water`);
    r.ok('water-crash: the sheet of water it went under behind has gone', !document.querySelector('[data-crash-wash]'));
    r.ok('water-crash: the lens is on the wreck all the way, never off at the far end of the map', seen.far > 0 && seen.far < 260, `${seen.far.toFixed(0)} m at most`);
    r.ok('water-crash: the lens waited for the water to close over it', seen.lensEarly === 0, `${seen.lensEarly} frames early`);
    const u = D().under;
    r.ok('water-crash: under the water it fetched the sea bed, and drew it', u.loads === 1 && u.on && u.info && u.info.drawn > 0 && u.info.on, JSON.stringify({ loads: u.loads, drawn: u.info && u.info.drawn }));
    r.ok('water-crash: the sea bed there is the real height, with things on it', u.info && u.info.rocks > 0 && u.info.weed > 0 && u.info.shells > 0, u.info ? `${u.info.rocks} rocks, ${u.info.weed} weed, ${u.info.shells} shells, ${u.info.debris} panels` : '');
    const hiddenAtRest = sim.scene.children.filter((c) => c.name === 'terrain' || c.name === 'ocean').every((c) => c.visible);
    r.ok('water-crash: between draws the world above is all still there', hiddenAtRest);
    const fog = sim.scene.fog.color.getHex();
    const dens = sim.scene.fog.density;
    sim.renderFrame();
    r.ok('water-crash: a draw gives the fog back as it found it', sim.scene.fog.color.getHex() === fog && sim.scene.fog.density === dens);
    r.ok('water-crash: the lens stays on the wreck behind the card', sim.camera.position.y < 0, `${sim.camera.position.y.toFixed(1)} m`);
    // Behind the card it goes on down to the bottom.
    for (let i = 0; i < 30 * 30; i++) {
      sim.update(1 / 30);
      if (i % 12 === 0) await yieldNow();
    }
    const floor = T.heightAt(sim.aircraft.pos.x, sim.aircraft.pos.z);
    r.ok('water-crash: it comes to rest on the bed, above it and not through it', sim.aircraft.pos.y >= floor && sim.aircraft.pos.y < floor + 12 && sim.model.visible, `y ${sim.aircraft.pos.y.toFixed(1)} over ${floor.toFixed(1)}`);

    /* ---- the replay from under the water ---- */
    if (D().canReplay) {
      const rec = D().S.rec;
      const wall = rec.fx.find((e) => e.name === 'wall');
      r.ok('water-crash: the wall of spray is in the recording, at or after the hit, never before', !!wall && wall.t >= 0, wall ? `at ${wall.t.toFixed(2)} s` : 'none');
      const walls0 = D().S.fx.sea ? D().S.fx.sea.stats.walls : 0;
      const started = D().startReplay(sim, true);
      let above = 0;
      for (let i = 0; i < 16 && D().replaying; i++) {
        sim.update(1 / 30);
        sim.renderFrame();
        if (sim.camera.position.y > 0) above++;
      }
      for (let i = 0; i < 240 && D().replaying && D().replay.t < (wall ? wall.t : 0) + 0.15; i++) sim.update(1 / 30);
      const walls1 = D().S.fx.sea ? D().S.fx.sea.stats.walls : 0;
      if (D().replaying) D().endReplay(sim, true);
      r.ok('water-crash: the replay runs over the water, whatever the lens was doing', !!started && above > 0, `${above} frames above`);
      r.ok('water-crash: and the wall of spray goes up again in it', walls1 > walls0, `${walls0} then ${walls1}`);
    }

    /* ---- restart ---- */
    say('water-crash: restart');
    const before = sim.scene.onBeforeRender;
    r.ok('water-crash: the hook on the scene is ours while it is down there', before !== THREE.Scene.prototype.onBeforeRender);
    sim.restart();
    await yieldNow();
    sim.step(0.5);
    const clean = () => {
      const d = D();
      return { env: d.under.on, hook: sim.scene.onBeforeRender === THREE.Scene.prototype.onBeforeRender, after: sim.scene.onAfterRender === THREE.Scene.prototype.onAfterRender, group: !sim.scene.getObjectByName('underwater'), view: !d.view, sink: !d.sink, rafts: d.rafts.length, pieces: d.pieces.length, lens: sim.camera.position.y > 0, hud: sim.state !== 'flying' || !(sim.hud.root && sim.hud.root.style.display === 'none'), skip: !document.querySelector('[data-crash-skip]') };
    };
    const c1 = clean();
    r.ok('water-crash: a restart leaves nothing of it: no hook, no group, no view, no wreck, the lens in the air', !c1.env && c1.hook && c1.after && c1.group && c1.view && c1.sink && !c1.rafts && !c1.pieces && c1.lens && c1.skip, JSON.stringify(c1));

    /* ---- quit in the middle, and skip ---- */
    say('water-crash: quit and skip');
    await fly();
    intoSea(spot, 66, 18);
    await untilCard(6);
    r.ok('water-crash: on the way down there is a Skip', !!document.querySelector('[data-crash-skip]') && sim.state === 'flying', sim.state);
    sim.quitToMenu('main');
    await yieldNow();
    const c2 = clean();
    r.ok('water-crash: quitting half way down leaves nothing of it, and the lens out of the water', !c2.env && c2.hook && c2.after && c2.group && c2.view && c2.sink && c2.skip && c2.lens, JSON.stringify(c2));
    await new Promise((res) => setTimeout(res, 50));
    r.ok('water-crash: and no card turns up on the menu', sim.state === 'menu', sim.state);
    await fly();
    intoSea(spot, 66, 18);
    await untilCard(3);
    const btn = document.querySelector('[data-crash-skip]');
    if (btn) btn.click();
    r.ok('water-crash: Skip brings the card at once', !!btn && sim.state === 'debrief', sim.state);
    await fly();
    intoSea(spot, 66, 18);
    await untilCard(3);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    await yieldNow();
    r.ok('water-crash: so does its key', sim.state === 'debrief', sim.state);

    /* ---- a sea bed that has not arrived: a slow school network ---- */
    say('water-crash: a late sea bed');
    await fly();
    D().holdUnderBack(true);
    intoSea(spot, 66, 18);
    const late = { under: false };
    const lateT = await untilCard(15, () => {
      if (sim.camera.position.y < 0) late.under = true;
    });
    D().holdUnderBack(false);
    r.ok('water-crash: with the sea bed not here yet the lens stays out of the water: no void', !late.under, `camera ${sim.camera.position.y.toFixed(1)} m`);
    r.ok('water-crash: and the card still comes on time', sim.state === 'debrief' && lateT <= 13, `${lateT.toFixed(1)} s`);

    /* ---- a lens that was a long way off ---- */
    say('water-crash: a lens left high');
    await fly();
    intoSea(spot, 66, 18);
    sim.camera.position.y += 400;
    sim.rig.chasePos.y += 400;
    const highUnder = { v: false };
    await untilCard(14, () => {
      if (sim.camera.position.y < 0) highUnder.v = true;
    });
    r.ok('water-crash: a lens that was high when it crashed still goes down with the wreck', highUnder.v, `ended ${sim.camera.position.y.toFixed(1)} m`);

    /* ---- a gentle arrival stays a ditching ---- */
    say('water-crash: the boundary');
    await fly();
    const views0 = D().stats.views || 0;
    const staged = cr.stageCrash(sim, 'splash');
    noDebrief();
    sim.step(1);
    r.ok('water-crash: with no card waiting the slow sink is what it always was', !!staged && (D().stats.views || 0) === views0 && D().sink && !D().sink.dive, JSON.stringify(D().sink && D().sink.phase));

    /* ---- the cartoon ---- */
    say('water-crash: the cartoon');
    sim.applySetting('comicEffects', true);
    await fly();
    cr.stageCrash(sim, 'splash');
    noDebrief();
    sim.step(0.3);
    const views1 = D().stats.views || 0;
    sim.showCrashDebrief(sim.aircraft.crashReason);
    r.ok('water-crash: the cartoon keeps its own crash: no view, no dive', (D().stats.views || 0) === views1 && !(D().sink && D().sink.dive) && !D().hull);
    if (sim.state === 'debrief' && sim.menus.hideDebrief) sim.menus.hideDebrief();
  } catch (err) {
    r.ok('water-crash: the checks ran', false, String((err && err.stack) || err).slice(0, 400));
  } finally {
    noDebrief();
    sim.override = null;
    sim.autoPauseOnHide = autoWas;
    if (sim.settings.comicEffects !== comicWas) sim.applySetting('comicEffects', comicWas === true);
  }
}
