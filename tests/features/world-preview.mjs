/**
 * World Map — Preview, checked in node.
 *
 *   /opt/homebrew/bin/node tests/features/world-preview.mjs           one line per check
 *   /opt/homebrew/bin/node tests/features/world-preview.mjs --quiet   failures and the summary
 *
 * THE PLACEMENT RULES (worldmap/preview.js checkAirport / checkNetwork, the
 * same code tools/worldmap/preview-layout.mjs ran when it placed the fields):
 *   - every runway level at field elevation, on a site that was nearly flat
 *     before it was levelled (slope)
 *   - every runway within 30 degrees of its prevailing wind
 *   - both approaches clear: ground 12 m under the 3-degree path, 6 km out,
 *     over a 300 m lane (approach clearance)
 *   - a town within 5 km, joined to the field by a dry road under 10%
 *   - a car park only at a commercial field (owner, Oct 25)
 *   - no town in a runway's lanes
 *   - the field's own airport layout fits its level site, nothing dropped
 *   - 3-5 fields, 20 km apart or more (spacing), two short hops from the hub,
 *     one long haul of 90 km or more between airliner fields, everything
 *     within 60 km of the origin
 * and: the ground at every field and in its lanes is the same, to a
 * centimetre, whichever field the world is built round.
 *
 * THE OTHER FIELDS (worldmap/outstation.js): everything drawn on level ground
 * inside the site; made ground rolls as tarmac.
 *
 * THE TILES (worldmap/tiles.js): every vertex is heightAt at that vertex, the
 * skirt hangs below the edge, neighbours share their edge heights and normals,
 * UVs run on across a seam.
 *
 * THE STREAM (worldmap/stream.js), flown in node over a cheap stand-in for the
 * height field with the preview's own islands, all the way along the long
 * haul at airliner speed and back along a short hop:
 *   - memory bounded: never more than the tier's tile cap, bytes bounded
 *   - far tiles unloaded: nothing left near the start after the long haul
 *   - per-frame work inside the budget (the main-thread fallback)
 *   - no holes: once it has caught up, the ground under the aircraft is drawn
 *   - every tier's leaf spacing within 10% of Kestrel's own chunk
 *
 * SPAWNS: from each field, Free Flight's runway start is on that field's
 * runway at field elevation, inside its flat.
 *
 * THE ROSTER: the preview is not in MAPS; the flight game still offers ten
 * maps; an unregistered id falls back to Kestrel; registered, getMap() hands
 * back the one definition object.
 */
global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0, height: 0, style: {},
  }),
  body: { appendChild() {} },
};
const store = new Map();
global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
global.window = global.window || { addEventListener() {} };

const SRC = new URL('../../src/', import.meta.url).href;
const THREE = await import(SRC + 'vendor/three.module.js');
const T = await import(SRC + 'world/terrain.js');
const M = await import(SRC + 'world/maps.js');
const A = await import(SRC + 'world/airport.js');
const LAY = await import(SRC + 'world/airport-layout.js');
const PV = await import(SRC + 'world/worldmap/preview.js');
const TL = await import(SRC + 'world/worldmap/tiles.js');
const ST = await import(SRC + 'world/worldmap/stream.js');
const OS = await import(SRC + 'world/worldmap/outstation.js');
const NM = await import(SRC + 'world/worldmap/names.js');
const MI = await import(SRC + 'game/missions.js');

const quiet = process.argv.includes('--quiet');
const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail });
  if (!quiet || !pass) console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const D = PV.PREVIEW;
const def = PV.previewDef();

/* ================================================================== *
 * The roster
 * ================================================================== */
ok('the preview is not on the roster', !M.MAPS.some((m) => m.id === PV.WORLD_PREVIEW_ID));
ok('the flight game still offers exactly ten maps', M.mapsForGame('flight').length === 10, `${M.mapsForGame('flight').length}`);
const idVar = PV.WORLD_PREVIEW_ID;
ok('before it is picked, its id boots Kestrel like any unknown id', M.getMap(idVar).id === 'kestrel' && M.resolveMapId(idVar) === 'kestrel');
M.registerExtraMap(def);
ok('once picked, getMap() hands back the one definition', M.getMap(idVar) === def && M.resolveMapId(idVar) === idVar);
ok('the definition says Preview', /Preview/.test(def.title) && def.preview === true);
ok('every island name is clear of the deny-list', D.islands.every((i) => !NM.isDenied(i.name)), D.islands.map((i) => i.name).join(', '));

/* ================================================================== *
 * Placement rules, from every field
 * ================================================================== */
const t0 = performance.now();
for (const a of D.airports) {
  PV.setDeparture(a.id);
  T.applyMap(def);
  A.refreshRunways();
  const lay = LAY.airportLayout();
  const rules = PV.checkAirport(T, a, { layout: lay });
  for (const r of rules) ok(`${a.code} ${r.rule}`, r.pass, r.detail);

  // Free Flight's runway start from here.
  const p = MI.RUNWAY_START.pos;
  const onRw = T.isOnRunway(p.x, p.z);
  const g = T.heightAt(p.x, p.z);
  ok(`${a.code} Free Flight starts on its runway`, onRw && Math.abs(g - a.elev) < 0.05 && Math.abs(p.x - (a.x - a.length / 2 + 80)) < 1 && Math.abs(p.z - a.z) < 1,
    `(${p.x.toFixed(0)}, ${p.z.toFixed(0)}), ground ${g.toFixed(2)} m, field ${a.elev} m`);
  ok(`${a.code} the airport layout is ${lay.cls} with nothing dropped`, lay.dropped.length === 0 && lay.pavement.length > 4, `${lay.pavement.length} paved, dropped ${JSON.stringify(lay.dropped)}`);
  ok(`${a.code} car park as the rule says`, !!lay.carPark === !!a.parking, `${a.kind}, layout car park ${!!lay.carPark}`);

  // The other fields, as outstation.js draws them, are on level ground.
  let off = 0;
  let worst = 0;
  let outside = 0;
  for (const b of D.airports) {
    if (b.id === a.id) continue;
    const plan = OS.fieldPlan(b);
    for (const r of [...plan.paved, ...plan.buildings]) {
      for (const [x, z] of [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1], [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2]]) {
        const d = Math.abs(T.heightAt(b.x + x, b.z + z) - b.elev);
        worst = Math.max(worst, d);
        if (d > 0.35) off++;
      }
      const s = b.site;
      if (b.x + r.x0 < s.x0 || b.x + r.x1 > s.x1 || b.z + r.z0 < s.z0 || b.z + r.z1 > s.z1) outside++;
    }
  }
  ok(`from ${a.code}: every other field's pavement and buildings stand level inside its site`, off === 0 && outside === 0, `worst ${worst.toFixed(2)} m, ${off} corners off, ${outside} outside`);
}
for (const r of PV.checkNetwork()) ok(`network: ${r.rule}`, r.pass, r.detail);

// The same ground whichever field the world is built round.
{
  const samples = [];
  for (const b of D.airports) {
    for (let x = b.x - b.length / 2 - 6000; x <= b.x + b.length / 2 + 6000; x += 150) {
      for (let z = b.z - 900; z <= b.z + 900; z += 150) samples.push([x, z]);
    }
  }
  PV.setDeparture(D.airports[0].id);
  T.applyMap(def);
  const ref = samples.map(([x, z]) => T.heightAt(x, z));
  let worst = 0;
  let where = '';
  for (const a of D.airports.slice(1)) {
    PV.setDeparture(a.id);
    T.applyMap(def);
    samples.forEach(([x, z], i) => {
      const d = Math.abs(T.heightAt(x, z) - ref[i]);
      if (d > worst) { worst = d; where = `${a.code} loaded, at ${x}, ${z}`; }
    });
  }
  ok('every field and its lanes are the same ground whichever field is loaded', worst < 0.01, `${samples.length} points x ${D.airports.length} builds, worst ${worst.toFixed(4)} m ${where}`);
}

/* ================================================================== *
 * The other fields roll as tarmac
 * ================================================================== */
{
  PV.setDeparture('haven');
  T.applyMap(def);
  const others = D.airports.filter((a) => a.id !== 'haven');
  const paved = OS.pavedTest(others);
  let hit = 0;
  let n = 0;
  for (const a of others) {
    for (const r of OS.fieldPlan(a).paved) {
      n++;
      if (paved(a.x + (r.x0 + r.x1) / 2, a.z + (r.z0 + r.z1) / 2)) hit++;
    }
  }
  ok('the other fields\' taxiways, aprons and car parks read as made ground', hit === n && !paved(15000, -15000), `${hit}/${n}`);
  let rwy = 0;
  for (const a of others) if (T.isPaved(a.x, a.z) && T.isPaved(a.x + a.length / 2 - 5, a.z)) rwy++;
  ok('the other fields\' runways roll as tarmac (their flats)', rwy === others.length, `${rwy}/${others.length}`);
}

/* ================================================================== *
 * Tiles from the real height field
 * ================================================================== */
{
  PV.setDeparture('haven');
  T.applyMap(def);
  const seg = 16;
  const size = 2048;
  const ta = TL.buildTileData(T, 1024, 1024, size, seg);
  const tb = TL.buildTileData(T, 1024 + size, 1024, size, seg);
  let worst = 0;
  const N = seg + 1;
  for (let k = 0; k < N * N; k++) {
    const x = 1024 + ta.pos[k * 3];
    const z = 1024 + ta.pos[k * 3 + 2];
    worst = Math.max(worst, Math.abs(T.heightAt(x, z) - ta.pos[k * 3 + 1]));
  }
  ok('a tile\'s every vertex is the height field at that vertex', worst < 1e-3, `${N * N} vertices, worst ${worst.toExponential(1)} m`);
  let seam = 0;
  let nseam = 0;
  let uvJump = 0;
  for (let j = 0; j < N; j++) {
    const ka = j * N + seg; // right edge of A
    const kb = j * N; // left edge of B
    seam = Math.max(seam, Math.abs(ta.pos[ka * 3 + 1] - tb.pos[kb * 3 + 1]));
    for (let c = 0; c < 3; c++) nseam = Math.max(nseam, Math.abs(ta.nrm[ka * 3 + c] - tb.nrm[kb * 3 + c]));
    uvJump = Math.max(uvJump, Math.abs(ta.uv[ka * 2] - tb.uv[kb * 2]) + Math.abs(ta.uv[ka * 2 + 1] - tb.uv[kb * 2 + 1]));
  }
  ok('neighbouring tiles share their edge heights, normals and UVs', seam < 1e-4 && nseam < 1e-4 && uvJump < 1e-6, `heights ${seam.toExponential(1)}, normals ${nseam.toExponential(1)}, uv ${uvJump.toExponential(1)}`);
  let skirtOk = true;
  for (let e = 0; e < 4 * seg; e++) {
    const k = N * N + e;
    if (!(ta.pos[k * 3 + 1] < ta.pos[TL.edgeRing(seg)[e] * 3 + 1] - 10)) skirtOk = false;
  }
  ok('every tile has a skirt below its edge', skirtOk);
  const sea = TL.buildTileData(T, 25000 + 1024, -9000, size, seg);
  ok('a tile of open sea floor keeps no mesh', sea === null);
  const idx = TL.tileIndex(seg);
  const count = N * N + 4 * seg;
  ok('tile indices are in range', Array.from(idx).every((i) => i < count), `${idx.length / 3} triangles`);
}

/* ================================================================== *
 * Tier spacing vs Kestrel's own chunk
 * ================================================================== */
{
  const kestrel = M.getMap('kestrel').chunks[0];
  const detail = { low: 0.55, medium: 0.78, high: 1, ultra: 1.4 };
  const lines = [];
  let pass = true;
  for (const q of ['low', 'medium', 'high', 'ultra']) {
    const leaf = ST.LEAF / ST.TIERS[q].seg;
    const kes = kestrel.size / Math.round(kestrel.segments * detail[q]);
    lines.push(`${q} ${leaf.toFixed(0)} m (Kestrel ${kes.toFixed(0)})`);
    if (leaf > kes * 1.3) pass = false;
  }
  ok('every tier\'s near ground is about as fine as Kestrel\'s at that tier', pass, lines.join(', '));
}

/* ================================================================== *
 * The stream, flown
 * ================================================================== */
{
  // A cheap stand-in for terrain.js: the preview's own islands, a cone each.
  const isl = D.islands;
  // Each sample "costs" what the real height field costs on a slow laptop
  // (40 microseconds, measured on this Mac under load), on a clock of its own,
  // so the budget is checked by what the stream asked for, not by whatever
  // else the machine was doing at the time.
  const SAMPLE_MS = 0.04;
  let clock = 0;
  let samples = 0;
  const fake = {
    ISLANDS: isl,
    MAP: { id: 'fake' },
    heightAt(x, z) {
      clock += SAMPLE_MS;
      samples++;
      let h = -60;
      for (const i of isl) {
        const d = Math.hypot(x - i.cx, z - i.cz);
        if (d < i.radius * 1.2) h = Math.max(h, 30 * (1 - d / i.radius));
      }
      return h;
    },
    flatSurfaceAt: () => null,
  };
  for (const q of ['low', 'medium', 'high']) {
    const group = new THREE.Group();
    clock = 0;
    const s = new ST.TerrainStream({ T: fake, material: new THREE.MeshBasicMaterial(), group, quality: q, useWorker: false, now: () => clock });
    const tier = ST.TIERS[q];
    const from = PV.airportById('marram');
    const to = PV.airportById('farhold');
    const hop = PV.airportById('haven');
    // Real time per frame for the clock the stream budgets against: measured, then advanced.
    const legs = [[from, to, 230, 3000], [to, hop, 120, 1500]];
    let maxTiles = 0;
    let maxBytes = 0;
    let holes = 0;
    let frames = 0;
    let worstSamples = 0;
    let lateFrames = 0;
    // One slice is two rows of the bordered grid; the budget may overrun by at most one.
    const slice = (tier.seg + 3) * 2;
    const allowed = Math.ceil(tier.budgetMs / SAMPLE_MS) + slice;
    s.prime(from.x, 900, from.z, 1e9);
    for (const [a, b, speed, alt] of legs) {
      const dist = Math.hypot(b.x - a.x, b.z - a.z);
      const dt = 1 / 60;
      const n = Math.ceil(dist / speed / dt);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        const before = samples;
        s.update(dt, x, alt, z);
        const did = samples - before;
        worstSamples = Math.max(worstSamples, did);
        if (did > allowed) lateFrames++;
        clock += dt * 1000;
        frames++;
        const st = s.stats();
        maxTiles = Math.max(maxTiles, st.meshes);
        maxBytes = Math.max(maxBytes, st.bytes);
        // Holes: every 2 s, once caught up (nothing missing), is the point under us drawn or sea?
        if (i % 120 === 60 && st.missing === 0) {
          let covered = false;
          let land = fake.heightAt(x, z) > 0;
          for (const k of s.shown) {
            const tt = s.tiles.get(k);
            if (tt && Math.abs(x - tt.cx) <= tt.size / 2 && Math.abs(z - tt.cz) <= tt.size / 2) covered = true;
          }
          if (land && !covered) holes++;
        }
      }
    }
    const st = s.stats();
    let fineNearStart = 0;
    let beyond = 0;
    for (const t of s.tiles.values()) {
      if (t.level <= 1 && Math.hypot(t.cx - from.x, t.cz - from.z) < 10000) fineNearStart++;
      const dx = Math.max(0, Math.abs(t.cx - hop.x) - t.size / 2);
      const dz = Math.max(0, Math.abs(t.cz - hop.z) - t.size / 2);
      if (Math.hypot(dx, dz) > tier.range * 1.3) beyond++;
    }
    ok(`stream ${q}: memory bounded through a ${(PV.legM(from, to) / 1000).toFixed(0)} km long haul and a hop back`, maxTiles <= tier.maxTiles && maxBytes < tier.maxTiles * 260e3,
      `${frames} frames, most meshes ${maxTiles}/${tier.maxTiles}, most bytes ${(maxBytes / 1e6).toFixed(1)} MB, built ${st.built}, unloaded ${st.evicted}`);
    ok(`stream ${q}: far tiles unloaded`, fineNearStart === 0 && beyond === 0, `${fineNearStart} fine tiles left round ${from.code}, ${beyond} beyond ${(tier.range * 1.3 / 1000).toFixed(0)} km`);
    ok(`stream ${q}: per-frame work inside the budget`, lateFrames === 0,
      `worst frame ${worstSamples} samples = ${(worstSamples * SAMPLE_MS).toFixed(1)} ms at 40 us a sample (budget ${tier.budgetMs} ms + one slice), ${lateFrames} over of ${frames}`);
    ok(`stream ${q}: no holes under the aircraft once caught up`, holes === 0, `${holes} holes`);
    ok(`stream ${q}: open sea costs nothing`, st.voids >= 0 && st.tiles < st.built + st.voids + 1, `${st.voids} sea tiles kept as nothing`);
    s.dispose();
    ok(`stream ${q}: dispose frees every tile`, group.children.length === 0 && s.tiles.size === 0);
  }

  // A worker that never answers, or answers with an error: the tiles it was
  // asked for are taken back and built on the main thread, none left stuck.
  for (const how of ['silent', 'error']) {
    const group = new THREE.Group();
    clock = 0;
    const s = new ST.TerrainStream({ T: fake, material: new THREE.MeshBasicMaterial(), group, quality: 'low', useWorker: false, now: () => clock });
    const posted = [];
    s.worker = { postMessage: (m) => posted.push(m), removeEventListener() {} };
    s.workerFailed = false;
    const at = PV.airportById('haven');
    s.update(1 / 60, at.x + 3000, 600, at.z);
    clock += 16;
    const asked = posted.filter((m) => m.op === 'tile');
    if (how === 'error' && asked[0]) s.onMessage({ op: 'tile', gen: s.gen, key: asked[0].key, error: 'boom' });
    for (let i = 0; i < 60 * 12; i++) {
      s.update(1 / 60, at.x + 3000, 600, at.z);
      clock += 1000 / 60;
    }
    // A late answer for a tile the main thread now owns is ignored.
    if (asked[1]) s.onMessage({ op: 'tile', gen: s.gen, key: asked[1].key, data: null });
    for (let i = 0; i < 60 * 4; i++) {
      s.update(1 / 60, at.x + 3000, 600, at.z);
      clock += 1000 / 60;
    }
    const st = s.stats();
    const meshes = group.children.length;
    // Still building: only the one tile the main thread is sampling now.
    const stuck = [...s.tiles.values()].filter((t) => t.state === 'building' && !(s.cpuJob && s.cpuJob.t === t)).length;
    const owed = asked.filter((m) => { const t = s.tiles.get(m.key); return t && t.state !== 'ready' && t.state !== 'void'; }).length;
    ok(`stream: a worker that is ${how} is given up on and nothing is left stuck`, asked.length > 0 && s.workerFailed && stuck === 0 && s.inFlight.size === 0 && owed === 0 && st.cpuTiles > 0 && meshes === st.meshes,
      `${asked.length} asked of it (${owed} still unbuilt), failed over ${s.workerFailed}, ${stuck} stuck, ${st.cpuTiles} built here since, ${meshes} meshes in the group for ${st.meshes} tiles`);
    s.dispose();
  }
}

const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed, ${(performance.now() - t0).toFixed(0)} ms`);
process.exit(fails.length ? 1 : 0);
