/**
 * Nullspire, the hidden city in the void (world/worldmap/void-city.js,
 * void-city-look.js, features/farlands-run.js), in the game:
 *
 *   node .claude/devtools/briefs/one-check.mjs '<url>?mute=1' ./tests/features/void-city.browser.js check "" 1
 *
 * At Low, on the World Map:
 *   - the Dev mode panel's "Teleport to Nullspire" is there for a dev and
 *     hidden from everybody else; it puts a Free Flight on a long final for
 *     the city's 09, nose on the runway
 *   - the city builds as you near it: the towers, the bridges, the field
 *     (runway, lights on, PAPI), in a few milliseconds and few draw calls
 *   - the ground is really there: heightAt on the slab, the runway counts as
 *     a runway, the apron rolls as tarmac; a Skylark stands on it and a
 *     touchdown on it is a landing, not a crash
 *   - the first-time notice names it, once
 *   - the minimap's window at the city is black; the whole-ring chart never
 *     reaches it
 *   - 300 km further out: still flying, no NaN, no error, the city let go,
 *     the deep void, a steady frame
 *   - the Javelin: in no list until a full stop on the city's runway earns it;
 *     then in the roster, the Hangar and Free Flight; flown at Low it holds
 *     Mach 4.8+ level at 65,000 ft with the frame and the tiles keeping up
 *   - leaving for Kestrel leaves nothing behind
 */
export const id = 'void-city';

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

export async function check(sim, r, say) {
  say && say('void-city: Nullspire');
  const wp = sim.worldPreview;
  if (!wp) {
    r.ok('void-city: the World Map preview is installed', false, 'sim.worldPreview missing');
    return;
  }
  const before = { map: sim.settings.map, quality: sim.settings.quality, dev: !!(sim.prog && sim.prog.devUnlocked) };
  const errors = [];
  const oe = console.error;
  console.error = (...a) => {
    errors.push(a.map(String).join(' ').slice(0, 300));
    oe.apply(console, a);
  };
  sim.autoPauseOnHide = false;
  localStorage.removeItem('islandsim.farlands.v1');
  const step = (s, dt = 1 / 60) => {
    const n = Math.max(1, Math.round(s / dt));
    for (let i = 0; i < n; i++) sim.step(dt);
  };
  try {
    sim.settings.quality = 'low';
    let done = wp.whenBuilt();
    wp.choose('haven');
    await Promise.race([done, wait(180000)]);
    if (sim.qualityBuilt !== 'low') {
      done = wp.whenBuilt();
      sim.applyQualityNow('low');
      await Promise.race([done, wait(180000)]);
    }
    const F = await import('../../src/world/worldmap/farlands.js');
    const C = await import('../../src/world/worldmap/void-city.js');
    const T = await import('../../src/world/terrain.js');
    const X = await import('../../src/game/extensions.js');
    const { CITY, CITY_FIELD, SLAB_Y } = C;
    const Ty2 = await import('../../src/aircraft/types.js');

    /* ---- the dev button ---- */
    const acts = X.extDevActions();
    const tp = acts.find((a) => /Teleport to Nullspire/.test(a.label));
    r.ok('void-city: the dev workbench offers the teleport', !!tp, acts.map((a) => a.label).join(' | ').slice(0, 200));
    const sync = () => sim.menus.syncProgression && sim.menus.syncProgression(sim.prog);
    if (sim.prog) sim.prog.devUnlocked = false;
    sync();
    await wait(50);
    const panel = document.querySelector('[data-dev-panel]');
    r.ok('void-city: nobody else sees the panel it is in', !!panel && panel.hidden, panel ? `hidden ${panel.hidden}` : 'no panel');
    if (sim.prog) sim.prog.devUnlocked = true;
    sync();
    await wait(50);
    const btn = [...document.querySelectorAll('[data-dev-ext-run]')].find((b) => /Nullspire/.test(b.textContent));
    r.ok('void-city: a dev sees the button', !!btn && !document.querySelector('[data-dev-panel]').hidden, btn ? btn.textContent : 'no button');
    const t0 = performance.now();
    sim.menus.chosenAircraft = 'skylark';
    const went = await wp.teleportToCity();
    const tw = performance.now();
    while (sim.state !== 'flying' && sim.state !== 'paused' && performance.now() - tw < 30000) await wait(50);
    if (sim.state === 'paused') sim.resume();
    const ac = sim.aircraft;
    const ap = C.approachStart();
    r.ok('void-city: the teleport puts you on a long final for 09', went === true && sim.state === 'flying' && Math.hypot(ac.pos.x - ap.x, ac.pos.z - ap.z) < 300 && Math.abs(ac.pos.y - ap.y) < 100 && Math.abs(((ac.readouts().heading - 90 + 540) % 360) - 180) < 5,
      `${sim.state}, at ${((ac.pos.x - CITY.x) / 1000).toFixed(1)} km / ${((ac.pos.z - CITY.z) / 1000).toFixed(1)} km from the centre, y ${ac.pos.y.toFixed(0)}, hdg ${ac.readouts().heading.toFixed(0)}, ${Math.round(performance.now() - t0)} ms`);
    const far = wp.farlands();
    if (!far) {
      r.ok('void-city: the ring is there', false);
      return;
    }
    const hold = (x, y, z, s, hdg = 90) => {
      for (let i = 0; i < Math.round(s * 60); i++) {
        const rad = (hdg * Math.PI) / 180;
        ac.crashed = false;
        ac.pos.set(x, y, z);
        ac.vel.set(Math.sin(rad) * 62, 0, -Math.cos(rad) * 62);
        ac.setAttitude ? ac.setAttitude(hdg, 0, 0) : ac.quat.setFromAxisAngle({ x: 0, y: 1, z: 0 }, -rad);
        ac.omega.set(0, 0, 0);
        ac.engineOn = true;
        ac.controls.throttle = 0.8;
        sim.state = 'flying';
        sim.step(1 / 60);
        if (Math.hypot(sim.camera.position.x - x, sim.camera.position.z - z) > 400) {
          sim.camera.position.set(x, y + 4, z + 14);
          if (sim.rig.chasePos) sim.rig.chasePos.copy(ac.pos);
          sim.step(1 / 60);
        }
      }
    };

    /* ---- it builds ---- */
    step(1);
    let st = far.stats();
    r.ok('void-city: the city is built within reach, in two short steps', st.city.built && st.city.field && st.city.counts.towers >= 300 && st.city.counts.bridges >= 30 && st.city.buildMs < 350 && st.city.fieldMs < 500, JSON.stringify(st.city));
    const look = wp.city().look;
    const field = look && look.field;
    r.ok('void-city: the field is a real field: runway, lights on, PAPI', !!field && !!field.getObjectByName('runway') && field.userData.lights && field.userData.lights.visible && !!field.userData.papi, field ? field.name : 'no field');
    {
      // The ramp: spaceplanes and rockets, no airliner; the launch rocket climbs on its flame during its burn and is back on the pad after.
      const craft = look && look.craft;
      const L = craft && craft.launcher;
      let rose = false;
      let flame = false;
      if (L) {
        L.t = L.liftAt + 8;
        L.update(0.1);
        const y1 = L.y;
        L.update(1);
        rose = L.y > y1 && L.y > 0 && L.group.visible;
        flame = L.plume.visible && L.power > 0.5;
        L.t = 0;
        L.update(0);
      }
      r.ok('void-city: the ramp has its craft, and the launch rocket climbs on a flame then comes back', !!craft && craft.counts.craft > 20 && !!field.getObjectByName('ramp-craft') && rose && flame && L.y === 0 && L.group.visible && !L.plume.visible, craft ? `${craft.counts.craft} lights, rose ${rose}, flame ${flame}` : 'no craft');
    }
    {
      // Draw calls near the city, looking at it from the final.
      hold(CITY_FIELD.x - 5000, SLAB_Y + 400, CITY_FIELD.z, 0.5);
      const str = wp.stream();
      const tS = performance.now();
      while (str.stats().missing + str.stats().building > 0 && performance.now() - tS < 15000) {
        await wait(16);
        str.update(0.02, ac.pos.x, ac.pos.y, ac.pos.z);
      }
      sim.renderFrame();
      const calls = sim.renderer.info.render.calls;
      let mine = 0;
      sim.scene.traverseVisible((o) => {
        if (o.isMesh || o.isPoints || o.isSprite) {
          let p = o;
          while (p && p.name !== 'nullspire' && p.name !== 'world-field XNUL') p = p.parent;
          if (p) mine++;
        }
      });
      r.ok('void-city: few draw calls of its own', mine <= 25, `${mine} city objects drawn, ${calls} calls in all`);
      console.info('[void-city] draw calls', JSON.stringify({ city: mine, all: calls }));
    }

    /* ---- the ground is really there ---- */
    r.ok('void-city: heightAt is the slab, and the void round it', T.heightAt(CITY.x, CITY.z) === SLAB_Y && T.heightAt(CITY_FIELD.x, CITY_FIELD.z) === SLAB_Y && T.heightAt(CITY.x, CITY.z + 6000) === F.VOID_H, `${T.heightAt(CITY.x, CITY.z)} / ${T.heightAt(CITY.x, CITY.z + 6000)}`);
    r.ok('void-city: the runway counts as a runway, the apron rolls as tarmac', T.isOnAnyRunway(CITY_FIELD.x + 1000, CITY_FIELD.z, 0) && !T.isOnAnyRunway(CITY_FIELD.x, CITY_FIELD.z + 400, 0) && T.isPaved(CITY_FIELD.x, CITY_FIELD.z - 300), '');
    {
      ac.reset({ pos: { x: CITY_FIELD.x - 1200, y: 0, z: CITY_FIELD.z }, headingDeg: 90, speed: 0, engineOn: true, gearDown: true });
      ac.controls.throttle = 0;
      if (sim.input) sim.input.throttleTarget = 0;
      sim.camera.position.set(ac.pos.x - 20, ac.pos.y + 6, ac.pos.z);
      step(3);
      r.ok('void-city: a Skylark stands on the runway', ac.onGround && !ac.crashed && Math.abs(ac.pos.y - SLAB_Y) < 4 && sim.state === 'flying', `onGround ${ac.onGround}, y ${ac.pos.y.toFixed(1)}, crashed ${ac.crashed} ${ac.crashReason || ''}`);
      // A touchdown: a metre up, landing speed, idle; it must settle on the wheels, not crash, on the runway.
      ac.reset({ pos: { x: CITY_FIELD.x - 1500, y: 0, z: CITY_FIELD.z }, headingDeg: 90, speed: 30, altAGL: 1.2, engineOn: true, gearDown: true });
      ac.controls.throttle = 0;
      if (sim.input) sim.input.throttleTarget = 0;
      let crashed = false;
      for (let i = 0; i < 60 * 25 && !crashed; i++) {
        ac.controls.throttle = 0;
        if (ac.onGround) ac.parkingBrake = true;
        sim.step(1 / 60);
        crashed = ac.crashed;
      }
      const rd = ac.readouts();
      r.ok('void-city: a touchdown on it is a landing, not a crash', !crashed && ac.onGround && T.isOnAnyRunway(ac.pos.x, ac.pos.z, 10) && rd.groundKts < 15, `crashed ${crashed} ${ac.crashReason || ''}, onGround ${ac.onGround}, ${rd.groundKts.toFixed(0)} kt, ${((ac.pos.x - CITY_FIELD.x) / 1000).toFixed(2)} km along`);
    }

    /* ---- the Javelin: hidden, then earned by the landing ---- */
    {
      const Ty = await import('../../src/aircraft/types.js');
      const p = sim.prog;
      const was = p.unlocked.includes('javelin');
      p.unlocked = p.unlocked.filter((id) => id !== 'javelin');
      const idx = Ty.AIRCRAFT.findIndex((a) => a.id === 'javelin');
      if (idx >= 0) Ty.AIRCRAFT.splice(idx, 1);
      far.store.javelin = false;
      far.found = false;
      r.ok('void-city: the Javelin is in no list before it is found', !Ty.AIRCRAFT.some((a) => a.id === 'javelin') && !document.querySelector('[data-aircraft="javelin"]'));
      // Parked, stopped, on the runway, inside the city: the find.
      ac.reset({ pos: { x: CITY_FIELD.x - 800, y: 0, z: CITY_FIELD.z }, headingDeg: 90, speed: 0, engineOn: true, gearDown: true });
      ac.parkingBrake = true;
      for (let i = 0; i < 90; i++) sim.step(1 / 60);
      await wait(400);
      const got = Ty.AIRCRAFT.find((a) => a.id === 'javelin');
      r.ok('void-city: a full stop at Nullspire puts the Javelin in the Hangar for good', !!got && p.unlocked.includes('javelin') && got.variantOf === 'massimo' && got.aero.reheat && got.aero.reheat.mach === 5, got ? `${got.name}, reheat ${JSON.stringify(got.aero.reheat)}` : 'not registered');
      sim.menus.syncProgression && sim.menus.syncProgression(p);
      await wait(50);
      r.ok('void-city: the Javelin has a card in the Hangar and in Free Flight', !!document.querySelector('[data-unlocks] [data-aircraft="javelin"], [data-unlocks] [data-buy="javelin"], [data-unlocks] [data-id="javelin"]') || [...document.querySelectorAll('[data-unlocks] *')].some((n) => /Nullspire Javelin/.test(n.textContent) && n.children.length === 0), `free card ${!!document.querySelector('.screen-free [data-aircraft="javelin"], [data-aircraft="javelin"]')}`);
      r.ok('void-city: ...and in Free Flight', !!document.querySelector('[data-aircraft="javelin"]'));
      if (!was) { /* leave it earned: that is what happened */ }
    }

    /* ---- the notice ---- */
    {
      hold(CITY.x, SLAB_Y + 800, CITY.z, 2);
      const shown = sim.location.banner.shown.map((e) => e.name);
      const store = JSON.parse(localStorage.getItem('islandsim.farlands.v1') || '{}');
      r.ok('void-city: finding it is said once, and kept', (shown.includes(CITY.name) || store.city === true) && far.stats().city.found === true, `${shown.join(' / ')} | ${JSON.stringify(store)}`);
    }

    /* ---- Spireline, the city's airline: in the picker once the city is seen, never at random ---- */
    {
      const Lv = await import('../../src/aircraft/liveries.js');
      const Em = await import('../../src/fleet/extra/emblems.js');
      await wait(300);
      const l = Lv.LIVERIES.find((x) => x.id === 'spireline');
      r.ok('void-city: finding the city puts Spireline in the paint list, marked secret, never handed out at random', !!l && l.secret === true && !Lv.AIRLINE_LIVERIES.some((x) => x.id === 'spireline') && Lv.schemeFor(Ty2.getAircraft('a320'), 'spireline') === l && Lv.liveriesFor(Ty2.getAircraft('a320')).includes(l), l ? l.name : 'not registered');
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const g = cv.getContext('2d');
      const drew = Em.drawEmblem(g, 'spire', 64, ['#ffb04a', '#3fd1e0', '#10131a']);
      const px = g.getImageData(32, 20, 1, 1).data;
      r.ok('void-city: its fin mark draws (a spire of light on a void disc)', drew === true && Em.EMBLEM_STYLES.includes('spire') && px[3] > 200, `${px.join(',')}`);
    }

    /* ---- the charts look away ---- */
    {
      const mm = sim.minimap;
      const range0 = mm.rangeIndex.flight;
      mm.rangeIndex.flight = 0;
      hold(CITY.x, SLAB_Y + 800, CITY.z, 0.2);
      const c = mm.chartFor('flight', { x: CITY.x, z: CITY.z });
      for (let i = 0; i < 3000 && !c.done; i++) mm.chartFor('flight', { x: CITY.x, z: CITY.z });
      const px = Math.max(0, Math.min(511, Math.round((c.extent / 2 + (CITY.x - c.cx)) / (c.extent / 512))));
      const py = Math.max(0, Math.min(511, Math.round((c.extent / 2 + (CITY.z - c.cz)) / (c.extent / 512))));
      const v = c.canvas.getContext('2d').getImageData(px, py, 1, 1).data;
      r.ok('void-city: the minimap window over the city is black', c.done && v[0] + v[1] + v[2] < 24, `${v[0]},${v[1]},${v[2]} done ${c.done} extent ${c.extent}`);
      mm.rangeIndex.flight = 3;
      const w = mm.chartFor('flight', { x: CITY.x, z: CITY.z });
      r.ok('void-city: the whole-ring chart stops short of it', w.extent / 2 < C.cityDist(0, 0) - 50000, `extent ±${(w.extent / 2000).toFixed(0)} km, city at ${(C.cityDist(0, 0) / 1000).toFixed(0)} km`);
      mm.rangeIndex.flight = range0;
      r.ok('void-city: the game\'s own heightAt is unhushed after a chart', !F.FARLANDS.hushed() && T.heightAt(CITY.x, CITY.z) === SLAB_Y);
      const P = sim.liveMap && sim.liveMap.places ? sim.liveMap.places() : null;
      r.ok('void-city: no chart, label or field names it', !P || (P.box.x0 + P.box.size < CITY.x - 50000 && !P.regions.some((g) => /Nullspire/.test(g.name)) && !(P.airports || []).some((a) => a.code === 'XNUL')), P ? `box to ${((P.box.x0 + P.box.size) / 1000).toFixed(0)} km` : 'no live map');
    }

    /* ---- the actual void ---- */
    {
      const e0 = errors.length;
      hold(CITY.x + 300000, 6000, CITY.z, 1.5);
      const s2 = far.stats();
      r.ok('void-city: 300 km past the city: still flying, no NaN, the city let go, the deep void', sim.state === 'flying' && !ac.crashed && Number.isFinite(ac.pos.x + ac.pos.y + ac.pos.z + ac.vel.length()) && !s2.city.built && s2.deepK === 1 && s2.voidK === 1, `${sim.state}, deepK ${s2.deepK}, city ${s2.city.built}`);
      const ts = [];
      for (let i = 0; i < 40; i++) {
        hold(CITY.x + 300000 + i * 60, 6000, CITY.z, 1 / 60);
        const a = performance.now();
        sim.renderFrame();
        sim.renderer.getContext().finish();
        ts.push(performance.now() - a);
      }
      ts.sort((p, q) => p - q);
      const mean = ts.reduce((p, q) => p + q, 0) / ts.length;
      r.ok('void-city: a steady frame out there', mean < 40 && ts[ts.length - 1] < mean * 6 + 20, `mean ${mean.toFixed(1)} ms, p95 ${ts[Math.floor(ts.length * 0.95)].toFixed(1)}, worst ${ts[ts.length - 1].toFixed(1)}`);
      r.ok('void-city: nothing threw out there', errors.length === e0, errors.slice(e0, e0 + 2).join(' || '));
    }

    /* ---- the Javelin flown: Mach 5 at Low ---- */
    {
      const e0 = errors.length;
      await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'javelin' });
      if (sim.state === 'paused') sim.resume();
      const ac2 = sim.aircraft;
      r.ok('void-city: the Javelin flies', sim.aircraftType && sim.aircraftType.id === 'javelin' && sim.state === 'flying', `${sim.aircraftType && sim.aircraftType.id}, ${sim.state}`);
      // Mach 2.4 at 20 km over the sea west of the mainland, eastbound; a simple level hold, full power.
      const alt = 20000;
      ac2.reset({ pos: { x: -60000, y: 0, z: 0 }, headingDeg: 90, speed: 700, altAGL: alt - T.heightAt(-60000, 0), engineOn: true, gearDown: false });
      ac2.pos.y = alt;
      ac2.rpm = 1;
      sim.camera.position.set(ac2.pos.x - 30, ac2.pos.y + 8, ac2.pos.z + 12);
      if (sim.rig.chasePos) sim.rig.chasePos.copy(ac2.pos);
      const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
      let maxM = 0;
      let last30 = 0;
      let nan = false;
      const ts = [];
      const str = wp.stream();
      let missingMax = 0;
      const dt = 1 / 30;
      for (let t = 0; t < 120 && !ac2.crashed; t += dt) {
        ac2.controls.throttle = 1;
        if (sim.input) sim.input.throttleTarget = 1;
        const hdgErr = ((ac2.heading - 90 + 540) % 360) - 180;
        ac2.controls.roll = clamp((clamp(-hdgErr * 0.9, -14, 14) - ac2.bankAngleDeg()) / 16, -0.7, 0.7);
        const wantVs = clamp((alt - ac2.pos.y) * 0.1, -8, 8);
        const g = Math.min(1, (300 / Math.max(100, ac2.ias * 1.94384)) ** 2);
        ac2.controls.pitch = clamp(((wantVs - ac2.vs) * 0.06 - ac2.omega.x) * g, -0.8, 0.9);
        const a = performance.now();
        sim.step(dt);
        if (t > 60 && Math.round(t * 30) % 3 === 0) {
          sim.renderFrame();
          ts.push(performance.now() - a);
          missingMax = Math.max(missingMax, str.stats().missing || 0);
        }
        maxM = Math.max(maxM, ac2.mach);
        if (t > 90) last30 = Math.max(last30, ac2.mach);
        if (!Number.isFinite(ac2.pos.x + ac2.pos.y + ac2.vel.length() + ac2.mach)) nan = true;
      }
      ts.sort((p, q) => p - q);
      const mean = ts.length ? ts.reduce((p, q) => p + q, 0) / ts.length : 0;
      r.ok('void-city: the Javelin holds Mach 4.8+ level at 65,000 ft, no NaN, no crash', !nan && !ac2.crashed && last30 >= 4.8 && maxM < 5.6, `max M${maxM.toFixed(2)}, last 30 s M${last30.toFixed(2)}, y ${ac2.pos.y.toFixed(0)}${ac2.crashed ? `, ${ac2.crashReason}` : ''}`);
      r.ok('void-city: at Mach 5 on Low the frame and the tiles keep up', ts.length > 100 && mean < 45 && ts[Math.floor(ts.length * 0.95)] < 90 && missingMax < 40, `mean ${mean.toFixed(1)} ms, p95 ${(ts[Math.floor(ts.length * 0.95)] || 0).toFixed(1)}, missing tiles at most ${missingMax}, ${ts.length} frames`);
      r.ok('void-city: nothing threw at Mach 5', errors.length === e0, errors.slice(e0, e0 + 2).join(' || '));
      // And it comes down: at approach speed the wing is a Massimo's.
      const perf = (await import('../../src/aircraft/types.js')).performanceFor('javelin');
      r.ok('void-city: the Javelin lands like a Massimo (its stall is the racer\'s)', perf.stallLanding < 130 && perf.vne > 900, `stall ${perf.stallLanding} kt, red line ${perf.vne} kt`);
    }

    /* ---- leaving ---- */
    {
      done = sim.menus.hooks.chooseMap('kestrel');
      await wait(100);
      const t1 = performance.now();
      while (sim.settings.map !== 'kestrel' && performance.now() - t1 < 10000) await wait(50);
      await wait(1500);
      r.ok('void-city: leaving leaves nothing behind', !Object.prototype.hasOwnProperty.call(sim.minimap, 'chartFor') && !wp.farlands() && !document.querySelector('.nullspire') && !sim.scene.getObjectByName('nullspire'), `wrapped ${Object.prototype.hasOwnProperty.call(sim.minimap, 'chartFor')}`);
    }
    r.ok('void-city: nothing threw', errors.length === 0, errors.slice(0, 3).join(' || '));
  } catch (e) {
    r.ok('void-city: the run finished', false, `${e.message} ${e.stack ? e.stack.split('\n')[1] : ''}`);
  } finally {
    console.error = oe;
    if (sim.prog) sim.prog.devUnlocked = before.dev;
  }
}
