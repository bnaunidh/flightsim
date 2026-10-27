/**
 * World Map — Preview, in the game.
 *
 *   node .claude/devtools/briefs/one-check.mjs <url> ./tests/features/world-preview.browser.js check "" 1
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail):
 *   - the card is in the map picker, marked PREVIEW, with a start picker
 *     listing every field under its region; the picker's other cards are all
 *     still there
 *   - SPAWN AT EACH AIRPORT (all sixteen): picking each field builds the world
 *     round it; Free Flight starts on that field's runway, on the ground at
 *     field elevation; a helicopter starts on that field's pad; the ground
 *     streams from the worker; the other fifteen fields and the other towns
 *     are built; the radio is that field's tower
 *   - THE HELIPORTS: a helicopter starts on the hospital roof, the lifeboat
 *     pad and both rigs, from the field nearest each
 *   - the tile worker's heights are the game's heightAt at sampled vertices
 *   - A FAR FIELD IS REAL: from Haven, Frigate Bay (250 km away) — the tower
 *     hands over, the PAPI hint is that field's, the approach autopilot flies
 *     its centreline down the slope and hands back; a touchdown on its runway
 *     grades as a runway landing; a full stop there is a visit; the minimap
 *     draws every field's runway; its PAPI lenses are lit; trees on its island
 *   - THE HORIZON: from Haven, the islands past the streamed ground are drawn
 *     as one shape mesh; the far plane reaches them
 *   - THE FLOATING ORIGIN: at Aldermere, 130 km out, the frame drawn with two
 *     different origins is the same picture (the shift changes nothing you
 *     can see), and without one it is not (what the shift is for)
 *   - PERFORMANCE, per tier (Low, Medium, High): across the mainland at Mach
 *     2 at 150 m and along the longest leg's open water at airliner speed,
 *     against the same flying over Kestrel at that tier — frame time, hitches,
 *     the ground under the aircraft drawn, the meshes inside the tier's cap,
 *     the trees inside their pool; geometry count and heap afterwards
 *   - SIM RATE: blocked on the runway, 2x and 4x in an autopilot cruise at
 *     height (twice and four times the ground a frame), back to 1x under
 *     3,000 ft; the RATE button is in the HUD
 *   - the world map opens (5 / the HUD's MAP button / the pause screen),
 *     pauses solo flight, lists every field by region with an ETA; a
 *     destination puts the guidance on that field; it closes and the flight
 *     resumes
 *   - a destination inside 60 km set on the departure's runway leaves the
 *     radio with the departure, whose tower clears the take-off
 * The map, the quality and Free Flight are put back afterwards.
 */
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

function pct(a, p) {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))];
}

async function chooseAndWait(sim, wp, id) {
  const done = wp.whenBuilt();
  wp.choose(id);
  const t = await Promise.race([done, wait(180000).then(() => null)]);
  await wait(50);
  return t;
}

/** Start a Free Flight the way the screen does, with the picker's saved start for this class. */
async function flyFromScreen(sim, aircraft, cls, choice) {
  sim.menus.chosenAircraft = aircraft;
  sim.menus.chosenStart = 'runway';
  sim.spawns.saveChoice(cls, choice);
  sim.spawns.repaint();
  await sim.menus.hooks.startFree({ time: 'day', condition: 'clear', windSpeedKts: 6, windDirDeg: 80, aircraft, airborne: false, taxi: false, fuel: 1 });
  if (sim.state === 'paused') sim.resume();
}

/** Carry the aircraft along a line, a frame at a time; what each frame cost. */
async function carry(sim, from, to, { speed = 250, altM = 610, everyHole = 30, onFrame = null, agl = false } = {}) {
  const ac = sim.aircraft;
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  const hdg = (Math.atan2(to.x - from.x, -(to.z - from.z)) * 180) / Math.PI;
  const dt = 1 / 60;
  const n = Math.ceil(dist / speed / dt);
  const ux = (to.x - from.x) / dist;
  const uz = (to.z - from.z) / dist;
  const T = await import('../../src/world/terrain.js');
  ac.reset({ pos: new sim.aircraft.pos.constructor(from.x, 0, from.z), headingDeg: hdg, speed: 70, altAGL: altM, engineOn: true, fuel: 1 });
  const times = [];
  let holes = 0;
  let checks = 0;
  for (let i = 0; i <= n; i++) {
    const x = from.x + ux * speed * dt * i;
    const z = from.z + uz * speed * dt * i;
    const y = agl ? Math.max(0, T.heightAt(x, z)) + altM : altM;
    ac.pos.set(x, y, z);
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
        const land = T.heightAt(x, z) > 0;
        // Under the aircraft, and 1.5 km ahead of it.
        for (const ahead of [0, 1500]) {
          const px = x + ux * ahead;
          const pz = z + uz * ahead;
          if (T.heightAt(px, pz) <= 0) continue;
          let covered = false;
          for (const k of s.shown) {
            const t = s.tiles.get(k);
            if (t && Math.abs(px - t.cx) <= t.size / 2 && Math.abs(pz - t.cz) <= t.size / 2) covered = true;
          }
          if (land && !covered) holes++;
        }
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
  const before = { map: sim.settings.map, quality: sim.settings.quality, game: sim.game, aircraft: sim.menus.chosenAircraft };
  const savedChoice = sim.spawns ? sim.spawns.state().choice : {};
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
  const T = await import('../../src/world/terrain.js');
  const PADS = (await import('../../src/world/pads.js')).PADS;
  try {
    if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
    /* ---- the card ---- */
    sim.menus.show('maps');
    await wait(50);
    const screen = sim.menus.screens.maps;
    const card = screen && screen.querySelector('[data-world-preview-card]');
    const picks = card ? card.querySelectorAll('[data-wp-pick]') : [];
    const heads = card ? [...card.querySelectorAll('.wp-picks h4')].map((h) => h.textContent) : [];
    const others = screen ? screen.querySelectorAll('[data-map-card]').length : 0;
    r.ok('world preview: its card is in the map picker, titled World Map — Preview, marked PREVIEW, first', !!card && /PREVIEW/.test(card.textContent) && card.querySelector('h3').textContent === 'World Map — Preview' && screen.querySelector('.map-grid').firstElementChild === card,
      card ? card.querySelector('h3').textContent : 'no card');
    const regions = wp.regions();
    r.ok('world preview: the start picker lists every field, grouped by region', picks.length === wp.airports().length && picks.length >= 14 && heads.length === regions.length,
      `${picks.length} of ${wp.airports().length} fields under ${heads.join(', ')}`);
    r.ok('world preview: every other map card is still there', others >= 10, `${others} cards`);
    sim.menus.show('main');

    /* ---- spawn at each airport: a plane on its runway, a helicopter on its pad ---- */
    const builds = [];
    for (const a of wp.airports()) {
      const b = await chooseAndWait(sim, wp, a.id);
      if (b) builds.push(b.ms);
      await sim.startMode('free', { loadingScreen: false, aircraft: 'skylark' });
      sim.step(0.5);
      await wait(150);
      sim.step(0.2);
      const ac = sim.aircraft;
      const st = wp.stats();
      const halfL = a.length / 2;
      const onRw = Math.abs(ac.pos.z - a.z) <= a.halfWidth && Math.abs(ac.pos.x - a.x) <= halfL;
      r.ok(`world preview: ${a.code} start is on its runway, on the ground at field elevation`, !!b && b.id === a.id && onRw && ac.onGround && Math.abs(ac.pos.y - a.elev) < 4 && !ac.crashed,
        `built ${b ? b.id : 'never'} in ${b ? Math.round(b.ms) : '-'} ms; at (${ac.pos.x.toFixed(0)}, ${ac.pos.y.toFixed(1)}, ${ac.pos.z.toFixed(0)}), field (${a.x}, ${a.elev}, ${a.z}), on ground ${ac.onGround}`);
      const out = wp.outstations();
      const towns = out ? out.towns.filter((t) => t.built && t.built.houses + (t.built.blocks || 0) > 0).length : 0;
      r.ok(`world preview: ${a.code} ground streams in, the other fields and towns are built, the radio is its tower`, st && st.visible > 0 && out && out.fields.length === wp.airports().length - 1 && towns === out.towns.length && sim.atc.field === a.name.split(' ')[0],
        st ? `worker ${st.worker}, ${st.visible} tiles drawn, ${out.fields.length} other fields, ${towns}/${out.towns.length} towns, tower "${sim.atc.field}"` : 'no stream');
      // The helicopter on this field's pad (the departure's pad is "the field pad").
      await flyFromScreen(sim, 'harrier', 'heli', 'pad:field');
      for (let i = 0; i < 6; i++) {
        sim.step(0.25);
        await wait(10);
      }
      const h = sim.aircraft;
      const pad = PADS.find((p) => p.id === 'field');
      const dPad = pad ? Math.hypot(h.pos.x - pad.pos.x, h.pos.z - pad.pos.z) : Infinity;
      const nearField = Math.hypot(h.pos.x - a.x, h.pos.z - a.z) < a.length / 2 + 1200;
      r.ok(`world preview: ${a.code} a helicopter starts on its pad, upright on the ground`, sim.aircraftType.id === 'harrier' && dPad < 3 && nearField && h.onGround && !h.crashed,
        `${dPad.toFixed(1)} m from the pad, ${nearField ? 'at' : 'NOT at'} ${a.code}, on ground ${h.onGround}, crashed ${h.crashed}`);
      sim.quitToMenu && sim.quitToMenu();
      await wait(50);
    }
    say(`builds: ${builds.map((m) => Math.round(m)).join(', ')} ms`);

    /* ---- the heliports, from the field nearest each ---- */
    for (const [from, padId] of [['aldermere', 'aldermere-hospital'], ['aldermere', 'westmost-rig'], ['eider', 'eider-lifeboat'], ['dune', 'sentinel-rig']]) {
      await chooseAndWait(sim, wp, from);
      const listed = sim.spawns.choices('harrier').map((c) => c.id);
      await flyFromScreen(sim, 'harrier', 'heli', `pad:${padId}`);
      for (let i = 0; i < 6; i++) {
        sim.step(0.25);
        await wait(10);
      }
      const h = sim.aircraft;
      const pad = PADS.find((p) => p.id === padId);
      const d = pad ? Math.hypot(h.pos.x - pad.pos.x, h.pos.z - pad.pos.z) : Infinity;
      r.ok(`world preview: a helicopter starts on ${pad ? pad.name : padId} (${pad ? pad.kind : '?'}), offered from ${from}`, listed.includes(`pad:${padId}`) && d < 3 && Math.abs(h.pos.y - pad.pos.y) < 3 && !h.crashed,
        `listed ${listed.includes(`pad:${padId}`)} (${listed.join(' ')}), ${d.toFixed(1)} m from it, height ${h.pos.y.toFixed(1)} on a ${pad ? pad.pos.y.toFixed(1) : '?'} m pad, crashed ${h.crashed}`);
      sim.quitToMenu && sim.quitToMenu();
    }
    sim.menus.chosenAircraft = before.aircraft;

    /* ---- the worker's ground is the game's ---- */
    {
      await chooseAndWait(sim, wp, 'haven');
      await sim.startMode('free', { loadingScreen: false, aircraft: 'skylark' });
      for (let i = 0; i < 20; i++) {
        sim.step(0.1);
        await wait(20);
      }
      const s = wp.stream();
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

      /* ---- the horizon ---- */
      const hz = wp.horizon();
      const shown = hz ? hz.shownFrom(sim.camera.position.x, sim.camera.position.z) : [];
      const farthest = shown.reduce((m, i) => Math.max(m, Math.hypot(i.cx - sim.camera.position.x, i.cz - sim.camera.position.z)), 0);
      r.ok('world preview: from Haven the islands past the streamed ground are on the horizon, one mesh, the far plane out to them', !!hz && hz.built === hz.islands.length && shown.length >= 30 && hz.mesh.parent && sim.camera.far >= 100000,
        hz ? `${hz.built} of ${hz.islands.length} shapes built, ${shown.length} drawn from here (furthest ${(farthest / 1000).toFixed(0)} km), far plane ${(sim.camera.far / 1000).toFixed(0)} km` : 'no horizon');
    }

    /* ---- a far field is real: Frigate Bay, from Haven ---- */
    {
      const PHY = await import('../../src/aircraft/physics.js');
      sim.weather.windDirDeg = 80;
      await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark' });
      const fr = wp.airports().find((a) => a.id === 'frigate');
      const ac = sim.aircraft;
      const V3 = ac.pos.constructor;
      ac.reset({ pos: new V3(fr.x - fr.length / 2 - 12000, 0, fr.z + 600), headingDeg: 90, speed: 60, altAGL: 600, engineOn: true, fuel: 1 });
      wp.stream().prime(ac.pos.x, ac.pos.y, ac.pos.z, 2000);
      const said = [];
      const os = sim.speak.bind(sim);
      sim.speak = (t, v, u) => {
        said.push(t);
        return os(t, v, u);
      };
      sim.step(0.2);
      sim.autopilot.setMode('approach');
      sim.toggleAutopilot(true);
      const hints = new Set();
      let maxOff = 0;
      let t = 0;
      for (; t < 400 && sim.autopilot.engaged; t += 0.5) {
        sim.step(0.5);
        if (sim.papiHint) hints.add(sim.papiHint.state);
        if (fr.x - fr.length / 2 - ac.pos.x < 5000) maxOff = Math.max(maxOff, Math.abs(ac.pos.z - fr.z));
        if (t % 10 === 0) await wait(0);
      }
      sim.speak = os;
      const out = fr.x - fr.length / 2 - ac.pos.x;
      const onSlope = Math.abs(ac.pos.y - fr.elev - Math.max(0, out) * Math.tan((3 * Math.PI) / 180));
      r.ok('world preview: far field — the tower hands over to Frigate and clears you to land', sim.atc.field === 'Frigate' && said.some((x) => /contact Frigate Tower/.test(x)) && said.some((x) => /cleared to land runway zero nine/.test(x)),
        said.slice(-3).join(' | '));
      r.ok('world preview: far field — the approach autopilot flies Frigate\'s centreline down the slope and hands back', !sim.autopilot.engaged && !ac.crashed && out > 300 && out < 4000 && onSlope < 45 && maxOff < 60 && wp.navField().code === 'XFRG',
        `handed back after ${t} s, ${Math.round(out)} m short, ${onSlope.toFixed(0)} m off the slope, at most ${maxOff.toFixed(0)} m off the centreline in the last 5 km`);
      r.ok('world preview: far field — the glide-path hint is Frigate\'s', hints.has('good') && hints.size >= 2, [...hints].join(', '));
      const fieldGroup = wp.outstations().fields.find((f) => f.userData.airport.id === 'frigate');
      const papi = fieldGroup && fieldGroup.userData.papi;
      r.ok('world preview: far field — its PAPI lenses are lit for you (white over red on the slope)', !!papi && papi.whites[0] >= 1 && papi.whites[0] <= 3, papi ? `09 end ${papi.whites[0]} white, 27 end ${papi.whites[1]}` : 'no PAPI');
      // The touchdown, then a full stop.
      const grades = [];
      const onTd = (g) => grades.push(g);
      ac.on(PHY.EVENTS.TOUCHDOWN, onTd);
      sim.toggleAutopilot(false);
      ac.reset({ pos: new V3(fr.x - fr.length / 2 + 400, 0, fr.z + 2), headingDeg: 90, speed: 30, altAGL: 1.2, engineOn: true, fuel: 1 });
      sim.override = { throttle: 0, brakes: 1, pitch: 0, roll: 0, yaw: 0 };
      for (let i = 0; i < 80 && !wp.visited().includes('frigate'); i++) {
        sim.step(0.25);
        if (i % 8 === 0) await wait(0);
      }
      sim.override = null;
      if (ac.off) ac.off(PHY.EVENTS.TOUCHDOWN, onTd);
      const g = grades[0];
      r.ok('world preview: far field — a touchdown on its runway grades as a runway landing', !!g && g.onRunway && !g.crashed && g.score >= 50, g ? `on runway ${g.onRunway}, ${g.quality}, ${g.score}` : 'no touchdown');
      r.ok('world preview: far field — a full stop there is a visit', wp.visited().includes('frigate'), wp.visited().join(', '));
      const mm = await import('../../src/ui/minimap.js');
      const strips = mm.extraRunways ? mm.extraRunways() : [];
      const extra = [];
      for (const a of wp.airports()) if (a.id !== 'haven' && T.isOnAnyRunway(a.x, a.z) && strips.some((s) => s.cx === a.x && s.cz === a.z)) extra.push(a.code);
      r.ok('world preview: far field — every other field\'s runway is on the minimap and counts as a runway', extra.length === wp.airports().length - 1 && strips.length === extra.length, `${strips.length} strips on the minimap: ${extra.join(' ')}`);
      const fs = wp.flora().stats();
      r.ok('world preview: far field — trees on its island', fs.drawn > 50 && fs.cells > 0, `${fs.drawn} trees drawn in ${fs.cells} cells (${fs.workerCells} from the worker)`);
    }

    /* ---- the floating origin ---- */
    {
      const RO = await import('../../src/render/render-origin.js');
      await chooseAndWait(sim, wp, 'aldermere');
      await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark' });
      for (let i = 0; i < 30; i++) {
        sim.step(0.1);
        await wait(20);
      }
      const gl = sim.renderer.getContext();
      const W = gl.drawingBufferWidth;
      const H = gl.drawingBufferHeight;
      const grab = () => {
        sim.renderFrame();
        const px = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return px;
      };
      const diff = (a, b) => {
        let n = 0;
        for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) n++;
        return (100 * n) / (a.length / 4);
      };
      const lines = [];
      let same = true;
      let differs = false;
      for (const view of ['chase', 'cockpit']) {
        if (sim.rig && sim.rig.setMode) sim.rig.setMode(view);
        sim.step(0.05);
        RO.setRenderOrigin({ snap: 4096 });
        const A = grab();
        RO.setRenderOrigin({ snap: 4096 * 6 });
        const B = grab();
        RO.setRenderOrigin(null);
        const C = grab();
        RO.setRenderOrigin({});
        const ab = diff(A, B);
        const ac = diff(A, C);
        lines.push(`${view}: two origins ${ab.toFixed(3)}% of pixels apart, no origin ${ac.toFixed(2)}%`);
        if (ab > 0.1) same = false;
        if (ac > ab) differs = true;
      }
      if (sim.rig && sim.rig.setMode) sim.rig.setMode('chase');
      r.ok('world preview: the floating origin draws the same picture whatever the origin, 130 km out', same && differs, lines.join('; '));
    }

    /* ---- performance, per tier ---- */
    const tiers = {};
    for (const q of ['low', 'medium', 'high']) {
      sim.settings.quality = q;
      // Kestrel at this tier first: the same flying, the yardstick.
      sim.setMap('kestrel');
      await wait(2500);
      sim.applyQualityNow(q);
      await sim.startMode('free', { loadingScreen: false, aircraft: 'skylark' });
      const kb = await carry(sim, { x: -9000, z: 400 }, { x: 9000, z: 400 }, { speed: 250, everyHole: 1e9 });
      sim.quitToMenu && sim.quitToMenu();
      const geoBefore = sim.renderer.info.memory.geometries;
      const heapBefore = performance.memory ? performance.memory.usedJSHeapSize : 0;
      await chooseAndWait(sim, wp, 'aldermere');
      if (sim.qualityBuilt !== q) {
        const done = wp.whenBuilt();
        sim.applyQualityNow(q);
        await done;
      }
      await sim.startMode('free', { loadingScreen: false, aircraft: 'skylark' });
      for (let i = 0; i < 30; i++) sim.step(1 / 60);
      wp.perf(true);
      longTasks = [];
      let maxMeshes = 0;
      let maxTrees = 0;
      const track = () => {
        const st = wp.stats();
        if (st) maxMeshes = Math.max(maxMeshes, st.meshes);
        const fl = wp.flora();
        if (fl) maxTrees = Math.max(maxTrees, fl.stats().drawn);
      };
      // Mach 2 at 150 m over the mainland, west to east.
      const m2 = await carry(sim, { x: -170000, z: 10000 }, { x: -150000, z: 10000 }, { speed: 680, altM: 150, agl: true, onFrame: track });
      // Airliner cruise over the open water of the longest leg (Sandmere to Farwatch).
      const sd = wp.airports().find((a) => a.id === 'sandmere');
      const fw = wp.airports().find((a) => a.id === 'farwatch');
      const k0 = 0.45;
      const k1 = 0.5;
      const p0 = { x: sd.x + (fw.x - sd.x) * k0, z: sd.z + (fw.z - sd.z) * k0 };
      const p1 = { x: sd.x + (fw.x - sd.x) * k1, z: sd.z + (fw.z - sd.z) * k1 };
      const cr = await carry(sim, p0, p1, { speed: 250, altM: 3350, onFrame: track });
      const st = wp.stats();
      const fl = wp.flora().stats();
      const work = wp.perf();
      const all = [...m2.times, ...cr.times];
      const kp95 = pct(kb.times, 0.95);
      const kmed = pct(kb.times, 0.5);
      const res = {
        kmed, kp95,
        m2: { p50: pct(m2.times, 0.5), p95: pct(m2.times, 0.95), max: Math.max(...m2.times), holes: m2.holes, checks: m2.checks },
        cr: { p50: pct(cr.times, 0.5), p95: pct(cr.times, 0.95), max: Math.max(...cr.times), holes: cr.holes, checks: cr.checks },
        p95: pct(all, 0.95),
        maxMeshes, cap: st.maxTiles, maxTrees, treeCap: fl.capacity, bytes: st.bytes, workMean: work.mean, workMax: work.max,
        long: longTasks.length, worstLong: Math.round(Math.max(0, ...longTasks)),
        geo: sim.renderer.info.memory.geometries - geoBefore,
        heap: performance.memory ? (performance.memory.usedJSHeapSize - heapBefore) / 1e6 : 0,
      };
      tiers[q] = res;
      const hitch = (ts, med) => ts.filter((t) => t > Math.max(50, med * 3)).length / ts.length;
      say(`${q}: Kestrel p50 ${kmed.toFixed(1)} p95 ${kp95.toFixed(1)} ms; Mach 2 p50 ${res.m2.p50.toFixed(1)} p95 ${res.m2.p95.toFixed(1)} max ${res.m2.max.toFixed(0)}; cruise p50 ${res.cr.p50.toFixed(1)} p95 ${res.cr.p95.toFixed(1)} max ${res.cr.max.toFixed(0)} ms; meshes ${maxMeshes}/${st.maxTiles}, trees ${maxTrees}/${fl.capacity}`);
      r.ok(`world preview: ${q}, Mach 2 at 150 m over the mainland and an airliner cruise, frame time as smooth as Kestrel at ${q}`, res.p95 <= kp95 * 1.25 + 4,
        `Mach 2 p50 ${res.m2.p50.toFixed(1)} / p95 ${res.m2.p95.toFixed(1)} / max ${res.m2.max.toFixed(0)} ms over ${m2.frames} frames; cruise p50 ${res.cr.p50.toFixed(1)} / p95 ${res.cr.p95.toFixed(1)} / max ${res.cr.max.toFixed(0)} ms over ${cr.frames}; Kestrel p50 ${kmed.toFixed(1)} / p95 ${kp95.toFixed(1)} ms`);
      // The world's own work each frame (the ground, the horizon, the trees, the other fields), timed
      // round just that code, so a stall of the whole machine (another program, the OS) is not counted.
      // A machine stall can land inside that window too, so: next to no frames over 8 ms, and a small mean.
      r.ok(`world preview: ${q}, the streaming keeps inside a few ms a frame (no hitch of its own)`, work.over8 <= Math.ceil(work.frames * 0.002) && work.mean < 1.5 && work.frames > 6000,
        `the world's work: mean ${work.mean.toFixed(2)} ms, ${work.over4} frames over 4 ms and ${work.over8} over 8 ms of ${work.frames} (worst ${work.max.toFixed(0)} ms)`);
      // And the whole frame against Kestrel's, which a busy machine can move either way: reported, and only a clear
      // excess fails (twice Kestrel's rate and half a percent more).
      const hp = hitch(all, pct(all, 0.5));
      const hk = hitch(kb.times, kmed);
      r.ok(`world preview: ${q}, hitches (frames over 3x the median, 50 ms at least) not clearly above Kestrel's`, hp <= hk * 2 + 0.005,
        `preview ${(hp * 100).toFixed(2)}%, Kestrel ${(hk * 100).toFixed(2)}%; long tasks ${longTasks.length} (worst ${res.worstLong} ms)`);
      r.ok(`world preview: ${q}, the ground under and ahead of the aircraft drawn all the way`, m2.holes + cr.holes === 0 && m2.checks + cr.checks > 20, `${m2.holes + cr.holes} holes in ${m2.checks + cr.checks} checks`);
      r.ok(`world preview: ${q}, tile meshes and trees inside the tier's caps the whole way`, maxMeshes <= st.maxTiles && maxTrees <= fl.capacity,
        `most ${maxMeshes} of ${st.maxTiles} meshes, ${(st.bytes / 1e6).toFixed(1)} MB now, ${st.evicted} unloaded; most ${maxTrees} trees of ${fl.capacity}`);
      r.ok(`world preview: ${q}, memory after the flying is bounded`, res.geo < 500 && res.heap < 200,
        `geometries +${res.geo}, heap +${res.heap.toFixed(0)} MB`);
      sim.quitToMenu && sim.quitToMenu();
    }
    sim.settings.quality = before.quality;

    /* ---- sim rate ---- */
    {
      const done = wp.whenBuilt();
      sim.applyQualityNow(before.quality || 'medium');
      await done;
      await sim.startMode('free', { loadingScreen: false, aircraft: 'skylark' });
      sim.step(0.2);
      const onRunway = wp.cycleWarp();
      const button = document.querySelector('.wp-hudcard [data-wp-warp]');
      const ac = sim.aircraft;
      const V3 = ac.pos.constructor;
      // An autopilot cruise at 10,000 ft over the open sea, south of Haven.
      ac.reset({ pos: new V3(20000, 0, 60000), headingDeg: 180, speed: 70, altAGL: 3050, engineOn: true, fuel: 1 });
      ac.controls.throttle = 0.75;
      sim.input.throttleTarget = 0.75;
      sim.autopilot.setMode('hold');
      sim.toggleAutopilot(true);
      sim.step(1);
      const run = (sec) => {
        const z0 = ac.pos.z;
        for (let i = 0; i < sec * 60; i++) sim.step(1 / 60);
        return ac.pos.z - z0;
      };
      const d1 = run(2);
      const k2 = wp.cycleWarp();
      const d2 = run(2);
      const k4 = wp.cycleWarp();
      const d4 = run(2);
      const steady = ac.readouts();
      // Down under 3,000 ft: straight back to 1x.
      ac.pos.y = 600;
      sim.step(0.1);
      const after = wp.warp();
      r.ok('world preview: sim rate stays 1x on the runway, the RATE button is in the HUD', onRunway === 1 && !!button && !!button.closest('.wp-hudcard'), `on the runway ${onRunway}x, button ${!!button}`);
      r.ok('world preview: sim rate 2x and 4x in an autopilot cruise cover twice and four times the ground, and the autopilot still holds it',
        k2 === 2 && k4 === 4 && Math.abs(d2 / d1 - 2) < 0.25 && Math.abs(d4 / d1 - 4) < 0.5 && Math.abs(steady.vsFpm) < 600 && !ac.crashed,
        `1x ${d1.toFixed(0)} m, 2x ${d2.toFixed(0)} m, 4x ${d4.toFixed(0)} m in 2 s; ${Math.round(steady.altFt)} ft, ${Math.round(steady.vsFpm)} fpm`);
      r.ok('world preview: sim rate drops to 1x under 3,000 ft over the ground', after.k === 1 && sim.timeScale === 1 && /3,000/.test(after.why), `${after.k}x, ${after.why}`);
      sim.toggleAutopilot(false);
    }

    /* ---- the world map and a destination ---- */
    {
      await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark' });
      sim.step(0.2);
      const opened = wp.openMap();
      await wait(100);
      const ov = document.querySelector('.wp-ov');
      const listed = ov ? ov.querySelectorAll('[data-wp-sel]').length : 0;
      const groups = ov ? ov.querySelectorAll('.wp-list h4').length : 0;
      const eta = ov ? /about \d+ min/.test(ov.querySelector('[data-wp-list]').textContent) : false;
      r.ok('world preview: the world map opens, pauses solo flight, lists every field by region with distance and ETA', opened && ov && !ov.hidden && sim.state === 'paused' && listed === wp.airports().length && groups === wp.regions().length && eta,
        `open ${opened}, state ${sim.state}, ${listed} fields in ${groups} regions, ETA ${eta}`);
      wp.setDestination('farwatch');
      wp.closeMap();
      await wait(50);
      sim.step(0.2);
      const tgt = sim.activeTarget;
      r.ok('world preview: a destination puts the guidance on that field', sim.state === 'flying' && !!tgt && /XFWT/.test(tgt.label || ''),
        `state ${sim.state}, target ${tgt ? tgt.label : 'none'}`);
      const card = document.querySelector('.wp-hudcard');
      r.ok('world preview: the HUD shows the MAP button and the trip', !!card && !card.hidden && /XFWT/.test(card.textContent), card ? card.textContent.trim() : 'no card');
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit5', bubbles: true }));
      await wait(50);
      const byKey = ov && !ov.hidden && sim.state === 'paused';
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit5', bubbles: true }));
      await wait(50);
      r.ok('world preview: 5 opens and closes it', byKey && ov.hidden && sim.state === 'flying', `opened ${byKey}, now hidden ${ov && ov.hidden}, state ${sim.state}`);
      wp.setDestination(null);
    }

    /* ---- a near destination set on the departure runway keeps the departure's tower ---- */
    {
      await sim.startMode('free', { loadingScreen: false, aircraft: 'skylark' });
      if (sim.state === 'paused') sim.resume();
      sim.step(0.3);
      const dep = wp.built() && wp.airports().find((a) => a.id === wp.built().id);
      const near = wp.airports().filter((a) => a.id !== dep.id).sort((p, q) => Math.hypot(p.x - dep.x, p.z - dep.z) - Math.hypot(q.x - dep.x, q.z - dep.z))[0];
      const said = [];
      const os = sim.speak.bind(sim);
      sim.speak = (t, v, u) => {
        said.push(t);
        return os(t, v, u);
      };
      wp.setDestination(near.id);
      // Past the ground's engine-start call (the tower keeps a gap between calls).
      for (let i = 0; i < 8; i++) sim.step(1);
      sim.override = { throttle: 1, brakes: 1 };
      for (let i = 0; i < 20; i++) sim.step(0.1);
      sim.override = null;
      sim.speak = os;
      const radio = dep.name.split(' ')[0];
      r.ok('world preview: a destination inside 60 km set on the runway leaves the radio with the departure, which clears the take-off',
        wp.navField().id === dep.id && sim.atc.field === radio && said.some((s) => new RegExp(`${radio} Tower.*cleared for take-off`).test(s)),
        `${dep.code} → ${near.code} ${(Math.hypot(near.x - dep.x, near.z - dep.z) / 1000).toFixed(0)} km: radio ${sim.atc.field}, field ${wp.navField().code}; said ${said.join(' | ')}`);
      wp.setDestination(null);
    }
    r.ok('world preview: no errors in the console', errors.length === 0, errors.slice(0, 3).join(' | '));
    say(JSON.stringify(tiers));
  } finally {
    console.error = oe;
    if (po) po.disconnect();
    try {
      if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
      for (const k of ['airliner', 'military', 'heli']) sim.spawns && sim.spawns.saveChoice(k, (savedChoice && savedChoice[k]) || 'auto');
      sim.menus.chosenAircraft = before.aircraft;
      sim.settings.quality = before.quality;
      if (before.map && before.map !== sim.settings.map) sim.setMap(before.map);
      await wait(3000);
    } catch (e) {
      /* best effort */
    }
  }
}
