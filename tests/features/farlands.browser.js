/**
 * The World Map past the sea, in the game:
 *
 *   node .claude/devtools/briefs/one-check.mjs '<url>?mute=1' ./tests/features/farlands.browser.js check "" 1
 *
 * At Low (the class's Chromebooks), a Free Flight in a Skylark, put down at
 * each place in turn:
 *   - the ring is there: loaded with the World Map, in the worker's tiles too
 *   - the two first-time notices, once each, kept across flights
 *   - the sea plane off past the range and back on the way home; none under
 *     the void; the fog, the dome and the clouds follow where the eye is
 *   - no cloud, no rain and no deck past the edge
 *   - the void is calm: thirty frames, nothing moves, day and with Reduce
 *     flashing off; nothing strobes
 *   - no sim rate out there; the autopilot flies off the edge without throwing
 *   - falling, and flying on, each end in the calm card: Try again and Main
 *     menu both work, no wreck, no crash
 *   - each cardinal side and a corner: the same void
 *   - the minimap: the range, the Farlands, then black, at every zoom
 *   - the live map: all of it charted, the void black
 *   - the traffic stays inside the sea
 *   - the frame time at Low over the Farlands holds to the mainland's
 *   - leaving for Kestrel leaves nothing behind
 * The map, the quality and Free Flight are put back afterwards.
 */
export const id = 'farlands';

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

export async function check(sim, r, say) {
  say && say('farlands: the World Map past the sea');
  const wp = sim.worldPreview;
  if (!wp) {
    r.ok('farlands: the World Map preview is installed', false, 'sim.worldPreview missing');
    return;
  }
  const before = { map: sim.settings.map, quality: sim.settings.quality, flash: sim.settings.reduceFlashing };
  const errors = [];
  const oe = console.error;
  console.error = (...a) => {
    errors.push(a.map(String).join(' ').slice(0, 300));
    oe.apply(console, a);
  };
  sim.autoPauseOnHide = false;
  localStorage.removeItem('islandsim.farlands.v1');
  const step = (s) => {
    const n = Math.max(1, Math.round(s * 60));
    for (let i = 0; i < n; i++) sim.step(1 / 60);
  };
  const stopped = () => sim.state !== 'flying';
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
    await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark' });
    if (sim.state === 'paused') sim.resume();
    const F = await import('../../src/world/worldmap/farlands.js');
    const T = await import('../../src/world/terrain.js');
    const far = wp.farlands();
    r.ok('farlands: the ring came with the World Map', !!far && T.MAP._outer === F.FARLANDS, far ? '' : 'wp.farlands() is null');
    if (!far) return;
    const { SEA_HALF: SH, EDGE_D, RANGE_DEEP, VOID_RUN_ON, VOID_FLOOR_Y } = F;
    const ac = sim.aircraft;
    const put = (x, y, z, hdg = 90) => {
      ac.crashed = false;
      const rad = (hdg * Math.PI) / 180;
      ac.pos.set(x, y, z);
      ac.vel.set(Math.sin(rad) * 62, 0, -Math.cos(rad) * 62);
      ac.setAttitude ? ac.setAttitude(hdg, 0, 0) : ac.quat.setFromAxisAngle({ x: 0, y: 1, z: 0 }, -rad);
      ac.omega.set(0, 0, 0);
      ac.engineOn = true;
      ac.controls.throttle = 0.8;
      if (sim.input) sim.input.throttleTarget = 0.8;
      sim.state = 'flying';
    };
    const hold = (x, y, z, s, hdg = 90) => {
      for (let i = 0; i < Math.round(s * 60); i++) {
        put(x, y, z, hdg);
        sim.step(1 / 60);
        // A teleport: the chase view does not take a second to catch up with it.
        if (Math.hypot(sim.camera.position.x - x, sim.camera.position.z - z) > 400) {
          sim.camera.position.set(x, y + 4, z + 14);
          if (sim.rig.chasePos) sim.rig.chasePos.copy(ac.pos);
          sim.step(1 / 60);
        }
      }
    };

    /* ---- the notices ---- */
    const shown = () => sim.location.banner.shown.map((e) => e.name);
    hold(SH + 30000, 9000, 0, 1);
    r.ok('farlands: no notice in the range', !shown().includes('The Farlands'));
    hold(SH + RANGE_DEEP + 6000, 9000, 0, 2);
    r.ok('farlands: a notice on crossing in', shown().includes('The Farlands'), shown().join(' / '));
    r.ok('farlands: no sim rate past the mountains', /far out/.test(wp.warp().blocked) || !!wp.warp().blocked, wp.warp().blocked);
    hold(SH + EDGE_D + 200, 9000, 0, 8);
    r.ok('farlands: a notice at the edge', shown().includes('The Edge of the World'), shown().join(' / '));
    const st = JSON.parse(localStorage.getItem('islandsim.farlands.v1') || '{}');
    r.ok('farlands: both are kept, with the furthest yet', st.seen === true && st.edge === true && st.furthest > 130000, JSON.stringify(st));

    /* ---- the tiles ---- */
    const str = wp.stream();
    {
      const x = SH + 90000;
      hold(x, 9000, 0, 0.1);
      str.update(0.02, x, 9000, 0);
      const t0 = performance.now();
      while (str.stats().building + str.stats().missing > 0 && performance.now() - t0 < 12000) {
        await wait(20);
        str.update(0.02, x, 9000, 0);
      }
      const before2 = str.stats();
      let bad = 0;
      let n = 0;
      for (const t of str.tiles.values()) {
        if (!t.mesh || t.cx < SH + 41000) continue;
        const p = t.mesh.geometry.attributes.position;
        for (let i = 0; i < 289; i += 37) {
          n++;
          if (Math.abs(p.getY(i) - T.heightAt(p.getX(i) + t.cx, p.getZ(i) + t.cz)) > 0.01) bad++;
        }
      }
      r.ok('farlands: the worker builds the ring, the same ground as the game', before2.worker && before2.meshes > 10 && n > 50 && bad === 0, `${before2.meshes} tiles, ${n} points, ${bad} off`);
    }

    /* ---- the sea, the air, the clouds ---- */
    const sea = sim.ocean.deep;
    hold(0, 3000, 0, 0.2);
    const fog0 = sim.scene.fog.density;
    r.ok('farlands: at home the sea is on, the dome down', sea.visible && !far.sky.mesh.visible, `sea ${sea.visible}, dome ${far.sky.mesh.visible}`);
    hold(SH + 90000, 9500, 0, 0.3);
    sim.renderFrame();
    // The weather's own fog changes from place to place: what holds is that the air is at least the haze that hides the tier's range.
    r.ok('farlands: past the range the sea is off, the dome up, the air thick enough', !sea.visible && far.sky.mesh.visible && sim.scene.fog.density >= far.sky.haze * 0.99, `fog at home ${fog0.toExponential(2)}, out there ${sim.scene.fog.density.toExponential(2)}, haze ${far.sky.haze.toExponential(2)}`);
    hold(SH + EDGE_D + 20000, 6000, 0, 8);
    let puffs = 0;
    for (const b of sim.clouds.batches || []) puffs += b.count || 0;
    const decks = (sim.clouds.decks || []).filter((d) => d.visible).length;
    const cirrus = (sim.clouds.cirrus || []).filter((d) => d.visible).length;
    const stats = far.stats();
    r.ok('farlands: past the edge the clouds are gone', stats.thin === 1 && decks === 0 && cirrus === 0 && !sim.rain.mesh.visible, `thin ${stats.thin}, ${decks} decks, ${cirrus} cirrus, rain ${sim.rain.mesh.visible}`);
    r.ok('farlands: nothing under the void: no sea, no tile', !sea.visible && T.heightAt(SH + EDGE_D + 20000, 0) === F.VOID_H, `h ${T.heightAt(SH + EDGE_D + 20000, 0)}`);
    {
      const seen = [];
      sim.renderFrame();
      sim.scene.traverseVisible((o) => {
        if (!o.isMesh || !/world-tile/.test(o.name)) return;
        if (o.position.x - 8192 > SH + EDGE_D + 12000) seen.push(o.name);
      });
      r.ok('farlands: no ground tile drawn out in the void', seen.length === 0, seen.slice(0, 4).join(' '));
    }
    /* ---- calm: nothing moves ---- */
    {
      const cv = document.createElement('canvas');
      cv.width = 32;
      cv.height = 18;
      const g = cv.getContext('2d', { willReadFrequently: true });
      const flash = sim.settings.reduceFlashing;
      const samples = async (x, y, z, hdg, n) => {
        const out = [];
        hold(x, y, z, 1.2, hdg);
        for (let i = 0; i < n; i++) {
          hold(x, y, z, 1 / 60, hdg);
          sim.renderFrame();
          g.drawImage(sim.renderer.domElement, 0, 0, 32, 18);
          // The top of the picture: the aeroplane is in the middle of it, and lit whatever the sky does.
          const d = g.getImageData(0, 0, 32, 5).data;
          let s = 0;
          for (let k = 0; k < d.length; k += 4) s += d[k] + d[k + 1] + d[k + 2];
          out.push(s / (d.length * 0.75));
        }
        return out;
      };
      const worst = (a) => a.slice(1).reduce((m, v, i) => Math.max(m, Math.abs(v - a[i])), 0);
      const a = await samples(SH + EDGE_D + 20000, 6000, 0, 90, 30);
      r.ok('farlands: looking out into the void, thirty frames, nothing changes', worst(a) < 1.2 && a[0] < 40, `mean ${a[0].toFixed(1)}, worst step ${worst(a).toFixed(2)}`);
      const b = await samples(SH + EDGE_D + 20000, 6000, 0, 270, 30);
      r.ok('farlands: looking back at the land, thirty frames, nothing strobes', worst(b) < 2, `mean ${b[0].toFixed(1)}, worst step ${worst(b).toFixed(2)}`);
      sim.settings.reduceFlashing = false;
      const c = await samples(SH + EDGE_D + 20000, 6000, 0, 90, 12);
      sim.settings.reduceFlashing = flash;
      r.ok('farlands: Reduce flashing off, the same', worst(c) < 1.2, `worst step ${worst(c).toFixed(2)}`);
      // Night: near-black, not a glow; the same dome.
      const w0 = { time: sim.weather.time };
      sim.weather.load({ time: 'night', condition: 'clear', windSpeedKts: 5, windDirDeg: 80 });
      const n = await samples(SH + EDGE_D + 20000, 6000, 0, 90, 4);
      sim.weather.load({ time: w0.time, condition: 'clear', windSpeedKts: 5, windDirDeg: 80 });
      r.ok('farlands: at night the void is as dark, with no horizon band', n[0] < 20, `mean ${n[0].toFixed(1)}`);
    }

    /* ---- every side, and a corner ---- */
    {
      const I = SH - F.CORNER;
      const o = (F.CORNER + EDGE_D + 12000) / Math.SQRT2;
      const at = { east: [SH + EDGE_D + 12000, 30000], west: [-SH - EDGE_D - 12000, -30000], north: [20000, -SH - EDGE_D - 12000], south: [-20000, SH + EDGE_D + 12000], corner: [I + o, I + o] };
      for (const [name, [x, z]] of Object.entries(at)) {
        hold(x, 7000, z, 0.5);
        sim.renderFrame();
        r.ok(`farlands: the void past the ${name}`, !stopped() && !sea.visible && far.stats().voidK === 1 && T.heightAt(x, z) === F.VOID_H, `h ${T.heightAt(x, z)}, voidK ${far.stats().voidK.toFixed(2)}`);
      }
    }

    /* ---- the minimap ---- */
    {
      const mm = sim.minimap;
      const range0 = mm.rangeIndex.flight;
      const read = (cv, x, y) => cv.getContext('2d').getImageData(x, y, 1, 1).data;
      const chart = (x, z) => {
        hold(x, 7000, z, 0.1);
        const c = mm.chartFor('flight', { x, z });
        for (let i = 0; i < 2000 && !c.done; i++) c.slice(40);
        const px = (c.extent / 2 + (x - c.cx)) / (c.extent / 512);
        const py = (c.extent / 2 + (z - c.cz)) / (c.extent / 512);
        return { c, px: Math.max(0, Math.min(511, Math.round(px))), py: Math.max(0, Math.min(511, Math.round(py))) };
      };
      for (const [name, set] of [['window', 3000], ['wide', 24000]]) {
        mm.rangeIndex.flight = set === 3000 ? 0 : 3;
        const a = chart(SH + EDGE_D + 12000, 0);
        const v = read(a.c.canvas, a.px, a.py);
        r.ok(`farlands: minimap (${name}): the void is black`, v[0] + v[1] + v[2] < 24, `${v[0]},${v[1]},${v[2]}`);
        const b = chart(SH + 90000, 0);
        const l = read(b.c.canvas, b.px, b.py);
        r.ok(`farlands: minimap (${name}): the Farlands are land, not sea`, l[0] > l[2], `${l[0]},${l[1]},${l[2]}`);
      }
      mm.rangeIndex.flight = range0;
    }

    /* ---- the live map ---- */
    {
      hold(SH + EDGE_D + 12000, 7000, 0, 0.1);
      const opened = wp.openMap();
      await wait(600);
      step(0.5);
      const P = sim.liveMap.places();
      const half = P.box.size / 2;
      r.ok('farlands: the live map charts all of it, and opens on the sea', opened !== false && half > SH + EDGE_D && P.box.x0 + half === 0 && P.extent.x1 < SH, `box ±${(half / 1000).toFixed(0)} km, extent to ${(P.extent.x1 / 1000).toFixed(0)} km`);
      r.ok('farlands: the live map names them', ['The Border Range', 'The Farlands', 'The Edge'].every((n) => P.regions.some((g) => g.name === n)));
      wp.closeMap();
    }

    /* ---- the traffic ---- */
    {
      const Tr = wp.traffic();
      const list = Tr ? Tr.state().list : [];
      const out = list.filter((c) => F.depthOf(c.x, c.z) > 0);
      r.ok('farlands: the traffic stays inside the sea', out.length === 0, `${list.length} flying, ${out.length} past the coast`);
    }

    /* ---- the autopilot at the edge ---- */
    {
      put(SH + EDGE_D - 1500, 5000, 0, 90);
      const a = sim.autopilot;
      a.holdHeadingDeg = 90;
      a.targetAltFt = 16000;
      a.setEngaged(true, ac);
      const e0 = errors.length;
      for (let i = 0; i < 60 * 40 && !stopped(); i++) sim.step(1 / 60);
      r.ok('farlands: the autopilot flies off the edge and on', !ac.crashed && ac.pos.x > SH + EDGE_D + 500 && errors.length === e0, `x ${(ac.pos.x / 1000).toFixed(1)} km, y ${ac.pos.y.toFixed(0)}, ${sim.state}`);
      a.setEngaged(false, ac);
    }

    /* ---- through a pass, the slowest way ---- */
    {
      await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark' });
      if (sim.state === 'paused') sim.resume();
      const cut = F.CUTS.east[0];
      const at = (D) => [SH + D, F.cutCentre(cut, D)];
      const D0 = 11000;
      hold(at(D0)[0], 2500, at(D0)[1], 0.2);
      const a = sim.autopilot;
      a.holdHeadingDeg = 90;
      a.targetAltFt = 8200;
      a.setEngaged(true, ac);
      let low = Infinity;
      let top = 0;
      for (let t = 0; t < 400 && !stopped() && !ac.crashed; t++) {
        const D = ac.pos.x - SH;
        if (D > 34000) break;
        const [x, z] = at(D + 900);
        a.holdHeadingDeg = ((Math.atan2(x - ac.pos.x, -(z - ac.pos.z)) * 180) / Math.PI + 360) % 360;
        sim.step(1, 1 / 30);
        low = Math.min(low, ac.agl);
        top = Math.max(top, ac.pos.y);
      }
      r.ok('farlands: a Skylark on the autopilot crosses the range through a pass', !ac.crashed && ac.pos.x - SH > 33000, `${((ac.pos.x - SH) / 1000).toFixed(1)} km in, lowest ${low.toFixed(0)} m over the ground, highest ${top.toFixed(0)} m${ac.crashed ? `, ${ac.crashReason}` : ''}`);
      a.setEngaged(false, ac);
    }

    /* ---- quit and come back, out there ---- */
    {
      hold(SH + 92000, 9500, 0, 0.3);
      sim.saveCheckpoint();
      // What a reload finds: the quit itself would clear it.
      const raw = localStorage.getItem('islandsim.checkpoint.v1');
      sim.quitToMenu('main');
      await wait(200);
      localStorage.setItem('islandsim.checkpoint.v1', raw);
      const plan = sim.offerResume();
      r.ok('farlands: a flight out there offers to continue', !!plan && plan.free === true, plan ? plan.name : 'no plan');
      if (plan) {
        await sim.resumeCheckpoint();
        const t0 = performance.now();
        while (sim.state !== 'flying' && performance.now() - t0 < 30000) await wait(50);
        if (sim.state === 'paused') sim.resume();
        sim.step(0.2, 1 / 60);
        r.ok('farlands: Continue puts you back out there', sim.state === 'flying' && !ac.crashed && Math.abs(ac.pos.x - SH - 92000) < 1500 && !sea.visible, `x ${(ac.pos.x / 1000).toFixed(1)} km, y ${ac.pos.y.toFixed(0)}, sea ${sea.visible}`);
      }
    }

    /* ---- the weather is thinned for the clouds, and only for them ---- */
    {
      const W = await import('../../src/world/weather.js');
      const before = JSON.stringify(W.CONDITIONS);
      await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark', condition: 'stormy', time: 'day' });
      if (sim.state === 'paused') sim.resume();
      let threw = 0;
      for (const k of [116, 120, 126, 132, 138]) {
        for (let i = 0; i < 8; i++) {
          try {
            hold(SH + k * 1000, 9500, 0, 1 / 60);
          } catch (e) {
            threw++;
          }
        }
      }
      r.ok('farlands: the clouds thin as you near the edge', far.stats().thin === 1 && threw === 0, `thin ${far.stats().thin}, ${threw} threw`);
      r.ok('farlands: the world\'s skies are not touched by it', JSON.stringify(W.CONDITIONS) === before, JSON.stringify(W.CONDITIONS.stormy).slice(0, 120));
      await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark', condition: 'stormy', time: 'day' });
      if (sim.state === 'paused') sim.resume();
      step(0.1);
      r.ok('farlands: home again, a storm is a storm', sim.weather.cond.rain === 1 && sim.weather.cond.cloud === 1, `rain ${sim.weather.cond.rain}, cloud ${sim.weather.cond.cloud}`);
    }

    /* ---- the end, falling ---- */
    {
      await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark' });
      if (sim.state === 'paused') sim.resume();
      hold(SH + EDGE_D + 9000, VOID_FLOOR_Y + 60, 0, 0.2);
      ac.engineOn = false;
      ac.controls.throttle = 0;
      if (sim.input) sim.input.throttleTarget = 0;
      for (let i = 0; i < 60 * 40 && !stopped(); i++) sim.step(1 / 60);
      await wait(50);
      const card = document.querySelector('.debrief, #debrief, [data-screen="debrief"]') || document.body;
      const text = card.textContent || '';
      r.ok('farlands: falling ends with the card, not a crash', sim.state === 'debrief' && !ac.crashed && /Lost in the void/.test(text), `${sim.state}, crashed ${ac.crashed}, y ${ac.pos.y.toFixed(0)}`);
      const buttons = [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null).map((b) => b.textContent.trim());
      r.ok('farlands: the card offers Try again and Main menu', buttons.some((b) => /Try again/.test(b)) && buttons.some((b) => /Main menu/.test(b)), buttons.join(' | '));
      const again = [...document.querySelectorAll('button')].find((b) => b.offsetParent !== null && /Try again/.test(b.textContent));
      if (again) again.click();
      const t0 = performance.now();
      while (sim.state !== 'flying' && performance.now() - t0 < 30000) await wait(50);
      if (sim.state === 'paused') sim.resume();
      step(0.3);
      r.ok('farlands: Try again is a new flight at the field', sim.state === 'flying' && F.depthOf(ac.pos.x, ac.pos.z) < -8000 && sea.visible && !ac.crashed, `${sim.state} at ${(ac.pos.x / 1000).toFixed(1)} km`);
    }

    /* ---- the end, flying on ---- */
    {
      put(SH + EDGE_D + VOID_RUN_ON + 3000, 6000, 0, 90);
      step(0.4);
      r.ok('farlands: flying on ends it too', sim.state === 'debrief', sim.state);
      const again = [...document.querySelectorAll('button')].find((b) => b.offsetParent !== null && /Main menu/.test(b.textContent));
      if (again) again.click();
      await wait(300);
      r.ok('farlands: Main menu works from the card', sim.state === 'menu', sim.state);
    }

    /* ---- the frame time ---- */
    {
      await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark' });
      if (sim.state === 'paused') sim.resume();
      const timed = async (x, y, z, hdg) => {
        hold(x, y, z, 0.1, hdg);
        const st2 = wp.stream();
        const t0 = performance.now();
        while (st2.stats().missing > 0 && performance.now() - t0 < 15000) {
          await wait(16);
          st2.update(0.02, x, y, z);
        }
        hold(x, y, z, 0.4, hdg);
        const ts = [];
        for (let i = 0; i < 40; i++) {
          put(x, y, z, hdg);
          const a = performance.now();
          sim.step(1 / 60);
          sim.renderFrame();
          sim.renderer.getContext().finish();
          ts.push(performance.now() - a);
        }
        ts.sort((p, q) => p - q);
        return { mean: ts.reduce((p, q) => p + q, 0) / ts.length, p95: ts[Math.floor(ts.length * 0.95)] };
      };
      const home = await timed(-72000, 1500, 7000, 90);
      const out = await timed(SH + 90000, 9500, 0, 90);
      const edge = await timed(SH + EDGE_D - 4000, 4000, 0, 270);
      r.ok('farlands: the frame at Low holds to the mainland\'s', out.mean < home.mean * 1.2 + 1 && edge.mean < home.mean * 1.2 + 1, `mainland ${home.mean.toFixed(1)} ms (p95 ${home.p95.toFixed(1)}), Farlands ${out.mean.toFixed(1)} (p95 ${out.p95.toFixed(1)}), edge ${edge.mean.toFixed(1)} (p95 ${edge.p95.toFixed(1)})`);
      console.info('[farlands] frame ms', JSON.stringify({ home, out, edge }));
    }

    /* ---- leaving ---- */
    {
      done = sim.menus.hooks.chooseMap('kestrel');
      await wait(100);
      const t0 = performance.now();
      while (sim.settings.map !== 'kestrel' && performance.now() - t0 < 10000) await wait(50);
      await wait(1500);
      const left = !Object.prototype.hasOwnProperty.call(sim.clouds, 'update') && !Object.prototype.hasOwnProperty.call(sim.rain, 'update');
      r.ok('farlands: leaving for another map leaves nothing behind', left && !wp.farlands() && !T.MAP._outer && sim.ocean.deep.visible && T.heightAt(SH + 30000, 0) === T.MAP.seaFloor, `wrapped ${!left}, map ${T.MAP.id}`);
    }

    r.ok('farlands: nothing threw', errors.length === 0, errors.slice(0, 3).join(' || '));
  } catch (e) {
    r.ok('farlands: the run finished', false, `${e.message} ${e.stack ? e.stack.split('\n')[1] : ''}`);
  } finally {
    console.error = oe;
    sim.settings.reduceFlashing = before.flash;
  }
}
