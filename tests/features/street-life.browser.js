/**
 * Street life, in the game (features/street-life.js, features/ambient.js):
 *
 *   node .claude/devtools/briefs/one-check.mjs '<url>?mute=1' ./tests/features/street-life.browser.js check "" 1
 *
 * On the World Map from Gateway International (Aldermere), at High:
 *   - every highway is a link with a barrier, lane paint and a flyover; the ones in
 *     sight are drawn, the rest are not
 *   - the flyover is solid to a low aeroplane (deck, ramp, pier) and open underneath
 *   - cars are where the player is (dozens within 1.5 km), on the right side of each
 *     carriageway, none overlapping, and some drive over the flyover's deck
 *   - a parked aeroplane on a carriageway: the cars stop short of it
 *   - in town: people on the pavements (the tier's number), drawn in one call
 *   - what it costs at High: street-life's own update, the cars' update, the draw calls
 * At Low: no lane paint, no people, no kerb cars or police; and at Haven's airfield,
 * where there is no highway, not one draw call more with it than without.
 * On Kestrel (a classic map) at High: cars parked at the kerb, people in the town.
 * The map, the quality and the mode are put back afterwards.
 */
export const id = 'street-life';

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

export async function check(sim, r, say) {
  say && say('street-life: highways, cars and people');
  const wp = sim.worldPreview;
  const SL0 = sim.streetLife;
  if (!wp || !SL0 || !sim.ambient || !sim.ambient.layer) {
    r.ok('street-life: installed (the second bundle is in)', false, `worldPreview ${!!wp}, streetLife ${!!SL0}, ambient ${!!sim.ambient}`);
    return;
  }
  const T = await import('../../src/world/terrain.js');
  const HP = await import('../../src/world/highway-plan.js');
  const SLM = await import('../../src/features/street-life.js');
  const AMB = await import('../../src/features/ambient.js');
  const AW = await import('../../src/world/ambient.js');
  const before = { map: sim.settings.map, quality: sim.settings.quality, perf: sim.settings.performanceMode };
  const errors = [];
  const oe = console.error;
  console.error = (...a) => {
    errors.push(a.map(String).join(' ').slice(0, 300));
    oe.apply(console, a);
  };
  sim.autoPauseOnHide = false;
  const SL = sim.streetLife;
  /** Hold the aeroplane at a point, level, and run the game. */
  const hold = { x: 0, y: 0, z: 0, on: false, hdg: 0 };
  const pin = () => {
    if (!hold.on) return;
    const ac = sim.aircraft;
    ac.pos.set(hold.x, hold.y, hold.z);
    if (ac.vel) ac.vel.set(0, 0, 0);
    if (ac.omega) ac.omega.set(0, 0, 0);
  };
  const run = (s, dt = 1 / 30) => {
    const n = Math.max(1, Math.round(s / dt));
    for (let i = 0; i < n; i++) {
      pin();
      sim.step(dt);
    }
    pin();
  };
  const frame = () => {
    sim.renderer.render(sim.scene, sim.camera);
  };
  const callsNow = () => {
    frame();
    sim.renderer.info.autoReset = false;
    sim.renderer.info.reset();
    frame();
    const c = sim.renderer.info.render.calls;
    sim.renderer.info.autoReset = true;
    return c;
  };
  const build = async (quality, field) => {
    sim.settings.performanceMode = false;
    sim.settings.quality = quality;
    let done = wp.whenBuilt();
    wp.choose(field);
    await Promise.race([done, wait(180000)]);
    if (sim.qualityBuilt !== quality) {
      done = wp.whenBuilt();
      sim.applyQualityNow(quality);
      await Promise.race([done, wait(180000)]);
    }
    await Promise.race([SL.ready, wait(60000)]);
    await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark' });
    if (sim.state === 'paused') sim.resume();
    await Promise.race([SL.ready, wait(60000)]);
  };
  const cars = () => sim.ambient.vehicles();
  try {
    /* ================= HIGH, from Gateway International ================= */
    await build('high', 'aldermere');
    const st0 = SL.state();
    r.ok('street-life: every highway is a link with a flyover (7 on the World Map)', st0.links === 7 && st0.flyovers === 7, `${st0.links} links, ${st0.flyovers} flyovers, tier ${st0.tier}`);
    const fly = SL.flyovers().slice().sort((a, b) => Math.hypot(a.mid.x - sim.aircraft.pos.x, a.mid.z - sim.aircraft.pos.z) - Math.hypot(b.mid.x - sim.aircraft.pos.x, b.mid.z - sim.aircraft.pos.z))[0];
    // Beside the flyover, 60 m over its deck, looking at it.
    Object.assign(hold, { x: fly.mid.x + 170, y: fly.mid.y + 55, z: fly.mid.z + 150, on: true });
    run(4);
    const st1 = SL.state();
    const looks = SL.looks();
    const shown = looks.filter((g) => g.visible);
    const dress = looks.find((g) => g.userData.kind === 'link' && g.visible);
    const fl = looks.find((g) => g.userData.kind === 'flyover' && g.visible && g.userData.fly === fly);
    r.ok('street-life: the link you are on and its flyover are drawn; the far ones are not', !!dress && !!fl && shown.length >= 2 && shown.length < looks.length, `${shown.length} of ${looks.length} groups shown`);
    r.ok('street-life: at High a link is a barrier and lane paint, a flyover three meshes', !!dress && dress.children.length === 2 && !!fl && fl.children.length === 3 && dress.userData.barrierM > 3000 && dress.userData.dashes > 300, dress ? `${dress.userData.barrierM} m of barrier, ${dress.userData.dashes} dashes, ${fl ? fl.userData.piers : 0} piers` : 'none');
    // Solid, and open underneath.
    const m = fly.deck[fly.deck.length >> 1];
    const hitDeck = T.obstacleAt(m.x, m.y - 0.4, m.z);
    const hitUnder = T.obstacleAt(m.x, m.ground + 2.5, m.z);
    const pier = fly.piers[0];
    const hitPier = T.obstacleAt(pier.x, (pier.ground + pier.top) / 2, pier.z);
    r.ok('street-life: flying into the deck or a pier is a crash; under the deck is open air', st1.solids > 40 && !!hitDeck && /flyover/.test(hitDeck.what) && !!hitPier && !hitUnder, `${st1.solids} boxes; deck "${hitDeck && hitDeck.what}", under ${hitUnder ? 'SOLID' : 'open'}`);

    /* ---- the cars ---- */
    const layer = sim.ambient.layer();
    const net = sim.ambient.net();
    r.ok('street-life: the lanes have the flyovers and every town\'s streets', net.lanes.filter((l) => l.flyover).length === 14 && net.lanes.filter((l) => l.kind === 'street').length > 100, `${net.lanes.length} lanes, ${net.lanes.filter((l) => l.flyover).length} on flyovers, ${net.lanes.filter((l) => l.kind === 'street').length} street lanes`);
    let overlaps = 0;
    let wrong = 0;
    let samples = 0;
    const deck = new Set();
    let nearSum = 0;
    const tA = performance.now();
    for (let k = 0; k < 150; k++) {
      run(0.6);
      const cs = cars().filter((c) => c.dist < 1500);
      nearSum += cs.length;
      samples++;
      for (let i = 0; i < cs.length; i++) {
        const a = cs[i];
        if (!a.parked && a.lane >= 0) {
          const L = net.lanes[a.lane];
          if (L.flyover && a.py - T.groundHeightAt(a.px, a.pz) > 6) deck.add(a.idx);
          if (L.oneWay && !L.ring && !L.flyover) {
            const Pp = net.polylines[L.poly].pts;
            const h = (a.heading * Math.PI) / 180;
            const q = Math.min(Pp.length - 2, Math.max(0, Math.round((a.s / L.len) * (Pp.length - 1)) - 1));
            if (Math.sin(h) * (Pp[q + 1][0] - Pp[q][0]) - Math.cos(h) * (Pp[q + 1][1] - Pp[q][1]) < 0) wrong++;
          }
        }
        for (let j = i + 1; j < cs.length; j++) {
          const b = cs[j];
          if (a.lane >= 0 && a.lane === b.lane && !a.parked && !b.parked && Math.abs(a.s - b.s) < (a.len + b.len) / 2 - 0.05) overlaps++;
        }
      }
    }
    const simMs = performance.now() - tA;
    const want = AW.countsFor('world-preview', 'high').ground.reduce((s, g) => s + g.count, 0) + AMB.TOWN_EXTRAS.high.cars;
    r.ok('street-life: the cars are where you are (most of them within 1.5 km)', nearSum / samples > want * 0.45, `${(nearSum / samples).toFixed(0)} of ${cars().length} near, on average over 90 s (${want} driven: the map's list and the town's extra)`);
    r.ok('street-life: none drives into the one in front, none against the traffic', overlaps === 0 && wrong === 0, `${overlaps} overlaps, ${wrong} wrong-way, ${samples} samples`);
    r.ok('street-life: cars drive over the flyover', deck.size >= 2, `${deck.size} different cars seen on the deck in 90 s`);
    const shapes = new Set(cars().map((c) => c.shape));
    r.ok('street-life: a mix of vehicles (saloon, hatchback, pick-up, van, truck, bus)', ['car', 'hatch', 'pickup', 'van', 'truck', 'bus'].every((k) => shapes.has(k)), [...shapes].join(' '));

    /* ---- what it costs at High, beside the flyover with the traffic on it ---- */
    {
      const grp = sim.scene.children.find((g) => g.name === 'ext:street-life');
      run(1);
      const cOn = callsNow();
      grp.visible = false;
      const cOff = callsNow();
      grp.visible = true;
      const s = SL.state();
      const a = sim.ambient.state();
      r.ok('street-life: beside a flyover at High, at most 8 draw calls of its own', cOn - cOff <= 8 && cOn - cOff >= 3, `${cOn} with, ${cOff} without`);
      r.ok('street-life: its own update is under 0.1 ms a frame (median), the cars\' under 0.6 ms', s.msMedian < 0.1 && layer.stats.ms < 0.6, `street-life ${s.msMedian.toFixed(3)} ms median, ${s.msMax.toFixed(2)} worst; cars ${layer.stats.ms.toFixed(3)} ms for ${cars().length}; ambient median ${a && a.msMedian != null ? a.msMedian.toFixed(3) : '?'}; ${(simMs / (150 * 18)).toFixed(2)} ms a whole game step`);
    }

    /* ---- a parked aeroplane on the carriageway ---- */
    {
      const li = net.lanes.findIndex((l) => l.oneWay && !l.ring && !l.flyover && l.slot === 0 && net.polylines[l.poly].name.includes(fly.link));
      const L = net.lanes[li];
      // On the outer lane, 500 m before the flyover's middle along it.
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < L.n; i++) {
        const d = Math.hypot(L.xs[i] - fly.mid.x, L.zs[i] - fly.mid.z);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      const i0 = Math.max(1, best - 8);
      Object.assign(hold, { x: L.xs[i0], y: L.ys[i0] + 1.2, z: L.zs[i0], on: true });
      sim.aircraft.onGround = true;
      let closest = Infinity;
      let stopped = 0;
      let who = '';
      let flying = true;
      for (let k = 0; k < 120; k++) {
        run(0.5);
        sim.aircraft.onGround = true;
        // (Only while the aeroplane is where it was put: a flight that has ended has no aeroplane on the road.)
        if (sim.state !== 'flying' || Math.hypot(sim.aircraft.pos.x - hold.x, sim.aircraft.pos.z - hold.z) > 1) {
          flying = false;
          break;
        }
        for (const c of cars()) {
          if (c.parked || c.lane < 0) continue;
          const d = Math.hypot(c.px - hold.x, c.pz - hold.z);
          if (Math.abs(c.py - L.ys[i0]) < 3 && d < closest) {
            closest = d;
            const Lc = net.lanes[c.lane];
            who = `${c.shape} on ${Lc.name} (${Lc.kind}${Lc.oneWay ? ', one way' : ''}) at ${c.s.toFixed(0)} of ${Lc.len.toFixed(0)} m, ${c.speed.toFixed(1)} m/s, sample ${k}`;
          }
          if (d < 40 && c.speed === 0 && Math.abs(c.py - L.ys[i0]) < 3) stopped++;
        }
      }
      r.ok('street-life: cars stop short of an aeroplane stood on the carriageway (never through it)', flying && closest > 5.5 + 2 && stopped > 0, `the nearest any came: ${closest.toFixed(1)} m (a Skylark's half span is about 5.5 m): ${who}; ${stopped} car-samples stopped behind it${flying ? '' : '; THE FLIGHT ENDED: ' + sim.state}`);
    }

    /* ---- the town ---- */
    {
      const town = SL.towns().slice().sort((a, b) => b.r - a.r)[0];
      Object.assign(hold, { x: town.x + 60, y: T.heightAt(town.x, town.z) + 45, z: town.z + 90, on: true });
      run(6);
      const s = SL.state();
      const ppl = SL.people();
      const wantP = SLM.peopleFor('high', town.r);
      let onStrip = 0;
      let inRoad = 0;
      for (const p of ppl) {
        if (T.isOnAnyRunway(p.x, p.z, 20)) onStrip++;
        if (sim.onRoad(p.x, p.z, 0)) inRoad++;
      }
      r.ok('street-life: the biggest town has the tier\'s people on its pavements', s.people >= wantP * 0.8 && s.people <= wantP && wantP >= 100 && s.drawn > 40 && ppl.every((p) => Math.hypot(p.x - hold.x, p.z - hold.z) < 600), `${s.people} people within 520 m of you (the tier's ${wantP}), ${s.drawn} drawn`);
      r.ok('street-life: none of them on a runway or on a made road', onStrip === 0 && inRoad === 0, `${onStrip} / ${inRoad}`);
      const crowd = sim.scene.getObjectByName('street-life:people');
      r.ok('street-life: all of them are one draw call', !!crowd && crowd.children.length === 1 && crowd.children[0].isInstancedMesh, crowd ? `${crowd.children.length} mesh, ${crowd.children[0].count} instances` : 'no crowd');
      const x0 = ppl.filter((p) => p.w.mode === 'walk').map((p) => [p.x, p.z]);
      run(8);
      const moved = ppl.filter((p) => p.w.mode === 'walk').filter((p, i) => Math.hypot(p.x - x0[i][0], p.z - x0[i][1]) > 1.5).length;
      r.ok('street-life: they walk', moved > x0.length * 0.5, `${moved} of ${x0.length} walkers moved in 8 s`);
      const kerb = cars().filter((c) => c.kerb && c.dist < 1500).length;
      const police = cars().filter((c) => c.kind === 'police').length;
      r.ok('street-life: cars are parked along the town\'s streets, and a police car is about', kerb >= 12 && police === AMB.TOWN_EXTRAS.high.police && cars().filter((c) => !c.parked && Math.hypot(c.px - hold.x, c.pz - hold.z) < 600).length >= 50, `${kerb} at the kerb near here, ${police} police, ${cars().filter((c) => !c.parked && Math.hypot(c.px - hold.x, c.pz - hold.z) < 600).length} being driven within 600 m`);
    }
    r.ok('street-life: nothing logged an error at High', errors.length === 0, errors.slice(0, 2).join(' | '));

    /* ================= LOW ================= */
    sim.quitToMenu();
    await build('low', 'aldermere');
    {
      Object.assign(hold, { x: fly.mid.x + 170, y: fly.mid.y + 55, z: fly.mid.z + 150, on: true });
      run(20);
      const looks2 = SL.looks();
      const d2 = looks2.find((g) => g.userData.kind === 'link' && g.visible);
      const s = SL.state();
      const cs = cars();
      const wantLow = AW.countsFor('world-preview', 'low').ground.reduce((a, g) => a + g.count, 0);
      r.ok('street-life: at Low the barrier and the flyovers stand, with no lane paint', s.flyovers === 7 && !!d2 && d2.children.length === 1 && s.tier === 'low', d2 ? `${d2.children.length} mesh a link` : 'no link shown');
      r.ok('street-life: at Low the cars are the map\'s own list and nothing more', cs.length === wantLow && cs.filter((c) => c.kerb || c.kind === 'police').length === 0 && new Set(cs.map((c) => c.shape)).size <= 4, `${cs.length} cars (list ${wantLow}), shapes ${[...new Set(cs.map((c) => c.shape))].join(' ')}`);
      const town = SL.towns().slice().sort((a, b) => b.r - a.r)[0];
      Object.assign(hold, { x: town.x + 60, y: T.heightAt(town.x, town.z) + 45, z: town.z + 90, on: true });
      run(4);
      r.ok('street-life: at Low there are no people in town', SL.state().people === 0 && !sim.scene.getObjectByName('street-life:people'));
    }
    // Performance mode is Low whatever the quality says.
    sim.settings.performanceMode = true;
    r.ok('street-life: Performance mode counts as Low', SLM.peopleFor('low', 900) === 0);
    sim.settings.performanceMode = false;
    // At Haven's airfield there is no highway: nothing more to draw than without it.
    sim.quitToMenu();
    await build('low', 'haven');
    {
      hold.on = false;
      const run2 = (s) => { for (let i = 0; i < s * 30; i++) sim.step(1 / 30); };
      run2(2);
      const grp = sim.scene.children.find((g) => g.name === 'ext:street-life');
      const cOn = callsNow();
      grp.visible = false;
      const cOff = callsNow();
      grp.visible = true;
      const s = SL.state();
      r.ok('street-life: at Low over Haven, not one draw call more with it than without', cOn === cOff && s.shown === 0, `${cOn} with, ${cOff} without; ${s.shown} groups shown`);
      r.ok('street-life: and its update there costs under 0.05 ms a frame', s.msMedian < 0.05, `${s.msMedian.toFixed(4)} ms median`);
    }

    /* ================= a classic map: Kestrel at High ================= */
    sim.quitToMenu();
    sim.settings.quality = 'high';
    sim.setMap('kestrel');
    await wait(1500);
    if (sim.qualityBuilt !== 'high') {
      sim.applyQualityNow('high');
      await wait(1500);
    }
    await Promise.race([SL.ready, wait(30000)]);
    await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark' });
    if (sim.state === 'paused') sim.resume();
    {
      const town = T.MAP.scenery.town;
      Object.assign(hold, { x: town.cx + 40, y: T.heightAt(town.cx, town.cz) + 40, z: town.cz + 80, on: true });
      run(5);
      const s = SL.state();
      const cs = cars();
      const kerb = cs.filter((c) => c.kerb);
      r.ok('street-life: Kestrel has no highway, and builds none', s.links === 0 && s.flyovers === 0 && s.shown === 0);
      r.ok('street-life: Kestrel\'s town has cars at the kerb and people on its pavements', kerb.length >= 5 && s.people >= SLM.peopleFor('high', town.radius) * 0.6 && s.drawn > 5, `${kerb.length} parked, ${s.people} people, ${s.drawn} drawn`);
      let overlaps = 0;
      for (let k = 0; k < 60; k++) {
        run(0.5);
        for (const a of cs) for (const b of cs) if (a.idx < b.idx && a.lane >= 0 && a.lane === b.lane && !a.parked && !b.parked && Math.abs(a.s - b.s) < (a.len + b.len) / 2 - 0.05) overlaps++;
      }
      r.ok('street-life: Kestrel\'s cars keep their distance', overlaps === 0, `${overlaps} overlaps in 30 s`);
    }
    r.ok('street-life: nothing logged an error', errors.length === 0, errors.slice(0, 2).join(' | '));
  } finally {
    console.error = oe;
    hold.on = false;
    try {
      if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
      sim.settings.performanceMode = before.perf;
      sim.settings.quality = before.quality;
      if (before.map && before.map !== sim.settings.map) sim.setMap(before.map);
      if (sim.qualityBuilt !== before.quality && before.quality) sim.applyQualityNow(before.quality);
      await wait(1500);
    } catch (e) {
      /* best effort */
    }
  }
}
