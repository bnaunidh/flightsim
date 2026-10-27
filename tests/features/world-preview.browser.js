/**
 * World Map — Preview, in the game.
 *
 *   node .claude/devtools/briefs/one-check.mjs <url> ./tests/features/world-preview.browser.js check "" 1
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail):
 *   - the card is in the map picker, marked PREVIEW, with a start picker
 *     listing every field; the picker's other cards are all still there
 *   - SPAWN AT EACH AIRPORT: picking each field builds the world round it;
 *     Free Flight starts on that field's runway, on the ground at field
 *     elevation; the ground streams from the worker; the other four fields
 *     and the other towns are built; nothing has been switched off
 *   - the tile worker's heights are the game's heightAt at sampled vertices
 *   - FLY BETWEEN TWO AIRPORTS: Haven to Gull Cay (31 km) at 250 m/s, 2,000
 *     ft, at Low — frame time (update + render) against the same flying over
 *     Kestrel at Low, hitches, long tasks; the ground under the aircraft
 *     drawn, the meshes inside the tier's cap, Gull Cay's field there on
 *     arrival; geometry count and heap afterwards
 *   - the world map opens (5 / the HUD's MAP button / the pause screen),
 *     pauses solo flight, shows every field; a destination puts the
 *     guidance on that field; it closes and the flight resumes
 * The map, the quality and Free Flight are put back afterwards.
 */
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

function pct(a, p) {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))];
}

async function built(wp, ms = 90000) {
  const b = wp.whenBuilt();
  return b;
}

async function chooseAndWait(sim, wp, id) {
  const done = wp.whenBuilt();
  wp.choose(id);
  const t = await Promise.race([done, wait(120000).then(() => null)]);
  await wait(50);
  return t;
}

/** Carry the aircraft along a line, a frame at a time; what each frame cost. */
async function carry(sim, from, to, { speed = 250, altM = 610, everyHole = 30, onFrame = null } = {}) {
  const ac = sim.aircraft;
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  const hdg = (Math.atan2(to.x - from.x, -(to.z - from.z)) * 180) / Math.PI;
  const dt = 1 / 60;
  const n = Math.ceil(dist / speed / dt);
  const ux = (to.x - from.x) / dist;
  const uz = (to.z - from.z) / dist;
  ac.reset({ pos: new sim.aircraft.pos.constructor(from.x, 0, from.z), headingDeg: hdg, speed: 70, altAGL: altM, engineOn: true, fuel: 1 });
  const times = [];
  let holes = 0;
  let checks = 0;
  for (let i = 0; i <= n; i++) {
    const x = from.x + ux * speed * dt * i;
    const z = from.z + uz * speed * dt * i;
    ac.pos.set(x, altM, z);
    ac.vel.set(ux * 70, 0, uz * 70);
    const t0 = performance.now();
    sim.step(dt);
    times.push(performance.now() - t0);
    if (onFrame) onFrame(i, x, z);
    if (i % everyHole === 0 && sim.worldPreview && sim.worldPreview.stream()) {
      const s = sim.worldPreview.stream();
      const st = s.stats();
      if (st.missing === 0) {
        checks++;
        const land = sim.worldPreview.heightAt ? sim.worldPreview.heightAt(x, z) > 0 : true;
        let covered = false;
        for (const k of s.shown) {
          const t = s.tiles.get(k);
          if (t && Math.abs(x - t.cx) <= t.size / 2 && Math.abs(z - t.cz) <= t.size / 2) covered = true;
        }
        if (land && !covered) holes++;
      }
    }
    // Let the worker's answers in.
    await wait(0);
  }
  return { times, holes, checks, frames: n + 1 };
}

export async function check(sim, r, say = () => {}) {
  const wp = sim.worldPreview;
  r.ok('world preview: the feature is installed', !!wp, wp ? '' : 'sim.worldPreview missing');
  if (!wp) return;
  const before = { map: sim.settings.map, quality: sim.settings.quality, game: sim.game };
  const errors = [];
  const oe = console.error;
  console.error = (...a) => {
    errors.push(a.map(String).join(' ').slice(0, 200));
    oe.apply(console, a);
  };
  let longTasks = [];
  let po = null;
  try {
    po = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) longTasks.push(e.duration);
    });
    po.observe({ entryTypes: ['longtask'] });
  } catch (e) {
    po = null;
  }
  try {
    if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
    /* ---- the card ---- */
    sim.menus.show('maps');
    await wait(50);
    const screen = sim.menus.screens.maps;
    const card = screen && screen.querySelector('[data-world-preview-card]');
    const picks = card ? card.querySelectorAll('[data-wp-pick]') : [];
    const others = screen ? screen.querySelectorAll('[data-map-card]').length : 0;
    r.ok('world preview: its card is in the map picker, marked PREVIEW, first', !!card && /PREVIEW/.test(card.textContent) && screen.querySelector('.map-grid').firstElementChild === card,
      card ? card.querySelector('h3').textContent : 'no card');
    r.ok('world preview: the start picker lists every field', picks.length === wp.airports().length, `${picks.length} of ${wp.airports().length}`);
    r.ok('world preview: every other map card is still there', others >= 10, `${others} cards`);
    sim.menus.show('main');

    /* ---- spawn at each airport ---- */
    for (const a of wp.airports()) {
      const b = await chooseAndWait(sim, wp, a.id);
      await sim.startMode('free', { loadingScreen: false });
      sim.step(0.5);
      await wait(200);
      sim.step(0.2);
      const ac = sim.aircraft;
      const st = wp.stats();
      const halfL = a.length / 2;
      const onRw = Math.abs(ac.pos.z - a.z) <= a.halfWidth && Math.abs(ac.pos.x - a.x) <= halfL;
      r.ok(`world preview: ${a.code} start is on its runway, on the ground at field elevation`, !!b && b.id === a.id && onRw && ac.onGround && Math.abs(ac.pos.y - a.elev) < 4 && !ac.crashed,
        `built ${b ? b.id : 'never'} in ${b ? Math.round(b.ms) : '-'} ms; at (${ac.pos.x.toFixed(0)}, ${ac.pos.y.toFixed(1)}, ${ac.pos.z.toFixed(0)}), field (${a.x}, ${a.elev}, ${a.z}), on ground ${ac.onGround}`);
      const out = wp.outstations();
      const towns = out ? out.towns.filter((t) => t.built && t.built.houses + (t.built.blocks || 0) > 0).length : 0;
      r.ok(`world preview: ${a.code} ground streams in, the other fields and towns are built`, st && st.visible > 0 && out && out.fields.length === wp.airports().length - 1 && towns === out.towns.length,
        st ? `worker ${st.worker}, ${st.visible} tiles drawn, ${st.missing} still coming, ${out.fields.length} other fields, ${towns}/${out.towns.length} towns` : 'no stream');
      const exts = (await import('../../src/game/extensions.js')).extensions().map((e) => e.id);
      r.ok(`world preview: ${a.code} nothing switched off`, exts.includes('world-preview'), '');
      sim.quitToMenu && sim.quitToMenu();
      await wait(50);
    }

    /* ---- the worker's ground is the game's ---- */
    {
      const s = wp.stream();
      const T = await import('../../src/world/terrain.js');
      let worst = 0;
      let n = 0;
      for (const t of s.tiles.values()) {
        if (!t.mesh || n > 40) continue;
        n++;
        const p = t.mesh.geometry.attributes.position;
        for (let k = 0; k < p.count; k += 97) {
          const x = t.cx + p.getX(k);
          const z = t.cz + p.getZ(k);
          if (Math.abs(p.getX(k)) > t.size / 2 + 1 || Math.abs(p.getZ(k)) > t.size / 2 + 1) continue;
          if (k >= (s.tier.seg + 1) ** 2) continue; // the skirt
          worst = Math.max(worst, Math.abs(T.heightAt(x, z) - p.getY(k)));
        }
      }
      r.ok('world preview: the tile worker\'s ground is the game\'s heightAt', n > 0 && worst < 0.01, `${n} tiles, worst ${worst.toFixed(4)} m (worker ${s.stats().worker})`);
    }

    /* ---- fly between two airports, at Low ---- */
    {
      const T = await import('../../src/world/terrain.js');
      wp.heightAt = T.heightAt;
      sim.settings.quality = 'low';
      // Kestrel at Low first: the same flying, the yardstick.
      sim.setMap('kestrel');
      await wait(2500);
      await sim.startMode('free', { loadingScreen: false });
      const kb = await carry(sim, { x: -9000, z: 400 }, { x: 9000, z: 400 }, { speed: 250, everyHole: 1e9 });
      sim.quitToMenu && sim.quitToMenu();
      const geoBefore = sim.renderer.info.memory.geometries;
      const heapBefore = performance.memory ? performance.memory.usedJSHeapSize : 0;
      const hub = wp.airports().find((a) => a.id === 'haven');
      const gull = wp.airports().find((a) => a.id === 'gull');
      await chooseAndWait(sim, wp, 'haven');
      await sim.startMode('free', { loadingScreen: false });
      longTasks = [];
      let maxMeshes = 0;
      const fly = await carry(sim, { x: hub.x + 2000, z: hub.z }, { x: gull.x - 1200, z: gull.z }, {
        speed: 250,
        onFrame: () => {
          const st = wp.stats();
          if (st) maxMeshes = Math.max(maxMeshes, st.meshes);
        },
      });
      // A few seconds over Gull Cay to catch up.
      for (let i = 0; i < 180; i++) {
        sim.step(1 / 60);
        await wait(0);
      }
      const st = wp.stats();
      const kp95 = pct(kb.times, 0.95);
      const p50 = pct(fly.times, 0.5);
      const p95 = pct(fly.times, 0.95);
      const p99 = pct(fly.times, 0.99);
      const max = Math.max(...fly.times);
      const kmed = pct(kb.times, 0.5);
      const hitch = (ts, med) => ts.filter((t) => t > Math.max(50, med * 3)).length / ts.length;
      say(`Kestrel low p50 ${kmed.toFixed(1)} p95 ${kp95.toFixed(1)} ms; preview p50 ${p50.toFixed(1)} p95 ${p95.toFixed(1)} p99 ${p99.toFixed(1)} max ${max.toFixed(0)} ms`);
      r.ok('world preview: Low, flying Haven to Gull Cay at 250 m/s, frame time as smooth as Kestrel at Low', p95 <= kp95 * 1.25 + 4,
        `preview p50 ${p50.toFixed(1)} / p95 ${p95.toFixed(1)} / p99 ${p99.toFixed(1)} / max ${max.toFixed(0)} ms over ${fly.frames} frames; Kestrel p50 ${kmed.toFixed(1)} / p95 ${kp95.toFixed(1)} ms`);
      r.ok('world preview: no more hitches than Kestrel (frames over 3x the median, 50 ms at least)', hitch(fly.times, p50) <= hitch(kb.times, kmed) + 0.003,
        `preview ${(hitch(fly.times, p50) * 100).toFixed(2)}%, Kestrel ${(hitch(kb.times, kmed) * 100).toFixed(2)}%; long tasks over the flight ${longTasks.length} (worst ${Math.round(Math.max(0, ...longTasks))} ms)`);
      r.ok('world preview: the ground under the aircraft was drawn all the way', fly.holes === 0 && fly.checks > 20, `${fly.holes} holes in ${fly.checks} checks`);
      r.ok('world preview: tile meshes inside the Low cap the whole way', maxMeshes <= st.maxTiles, `most ${maxMeshes} of ${st.maxTiles}, ${st.evicted} unloaded, ${(st.bytes / 1e6).toFixed(1)} MB now`);
      const gullField = wp.outstations().fields.find((f) => f.userData.airport.id === 'gull');
      r.ok('world preview: Gull Cay\'s field is there on arrival', !!gullField && gullField.visible && st.missing === 0, `field visible ${gullField && gullField.visible}, ${st.missing} tiles still coming`);
      const geoAfter = sim.renderer.info.memory.geometries;
      const heapAfter = performance.memory ? performance.memory.usedJSHeapSize : 0;
      r.ok('world preview: memory after the hop is bounded', geoAfter - geoBefore < 400 && (heapAfter - heapBefore) < 160e6,
        `geometries ${geoBefore} → ${geoAfter}, heap ${(heapBefore / 1e6).toFixed(0)} → ${(heapAfter / 1e6).toFixed(0)} MB`);
    }

    /* ---- the world map and a destination ---- */
    {
      await sim.startMode('free', { loadingScreen: false, airborne: true });
      sim.step(0.2);
      const opened = wp.openMap();
      await wait(100);
      const ov = document.querySelector('.wp-ov');
      const listed = ov ? ov.querySelectorAll('[data-wp-sel]').length : 0;
      r.ok('world preview: the world map opens, pauses solo flight, lists every field', opened && ov && !ov.hidden && sim.state === 'paused' && listed === wp.airports().length,
        `open ${opened}, state ${sim.state}, ${listed} fields listed`);
      wp.setDestination('farhold');
      wp.closeMap();
      await wait(50);
      sim.step(0.2);
      const tgt = sim.activeTarget;
      r.ok('world preview: a destination puts the guidance on that field', sim.state === 'flying' && !!tgt && /XFHD/.test(tgt.label || ''),
        `state ${sim.state}, target ${tgt ? tgt.label : 'none'}`);
      const card = document.querySelector('.wp-hudcard');
      r.ok('world preview: the HUD shows the MAP button and the trip', !!card && !card.hidden && /XFHD/.test(card.textContent), card ? card.textContent.trim() : 'no card');
      // The key.
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit5', bubbles: true }));
      await wait(50);
      const byKey = ov && !ov.hidden && sim.state === 'paused';
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit5', bubbles: true }));
      await wait(50);
      r.ok('world preview: 5 opens and closes it', byKey && ov.hidden && sim.state === 'flying', `opened ${byKey}, now hidden ${ov && ov.hidden}, state ${sim.state}`);
      wp.setDestination(null);
    }
    r.ok('world preview: no errors in the console', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    console.error = oe;
    if (po) po.disconnect();
    try {
      if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
      sim.settings.quality = before.quality;
      if (before.map && before.map !== sim.settings.map) sim.setMap(before.map);
      await wait(3000);
    } catch (e) {
      /* best effort */
    }
  }
}
