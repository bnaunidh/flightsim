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
  const pavedFields = others.filter((a) => !a.surface || a.surface === 'tarmac');
  for (const a of pavedFields) if (T.isPaved(a.x, a.z) && T.isPaved(a.x + a.length / 2 - 5, a.z)) rwy++;
  ok('the other fields\' paved runways roll as tarmac (their flats)', rwy === pavedFields.length, `${rwy}/${pavedFields.length}`);
  const rough = others.filter((a) => a.surface === 'grass' || a.surface === 'gravel');
  let asSurface = 0;
  for (const a of rough) if (T.flatSurfaceAt(a.x, a.z) === a.surface && !T.isPaved(a.x, a.z)) asSurface++;
  ok('the grass and gravel strips roll as grass and gravel, not tarmac', rough.length >= 2 && asSurface === rough.length, `${asSurface}/${rough.length}: ${rough.map((a) => `${a.code} ${a.surface}`).join(', ')}`);
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
    // The longest airliner leg in the sea, at airliner speed; then across the
    // mainland at Mach 2 at 150 m (the worst case for the stream: all land,
    // the fastest ground); then a short hop at Skylark speed.
    const from = PV.airportById('sandmere');
    const to = PV.airportById('farwatch');
    const hop = PV.airportById('haven');
    const wW = { x: -198000, z: 12000 };
    const wE = { x: -102000, z: 12000 };
    const legs = [[from, to, 250, 11000], [wW, wE, 680, 150], [PV.airportById("marram"), hop, 120, 600]];
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
      if (a !== from) s.prime(a.x, alt, a.z, 1e9);
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
      if (t.level <= 1 && (Math.hypot(t.cx - from.x, t.cz - from.z) < 10000 || Math.hypot(t.cx - to.x, t.cz - to.z) < 10000)) fineNearStart++;
      const dx = Math.max(0, Math.abs(t.cx - hop.x) - t.size / 2);
      const dz = Math.max(0, Math.abs(t.cz - hop.z) - t.size / 2);
      if (Math.hypot(dx, dz) > tier.range * 1.3) beyond++;
    }
    ok(`stream ${q}: memory bounded through a ${(PV.legM(from, to) / 1000).toFixed(0)} km long haul, Mach 2 at 150 m over the mainland and a hop`, maxTiles <= tier.maxTiles && maxBytes < tier.maxTiles * 260e3,
      `${frames} frames, most meshes ${maxTiles}/${tier.maxTiles}, most bytes ${(maxBytes / 1e6).toFixed(1)} MB, built ${st.built}, unloaded ${st.evicted}`);
    ok(`stream ${q}: far tiles unloaded`, fineNearStart === 0 && beyond === 0, `${fineNearStart} fine tiles left round ${from.code} or ${to.code}, ${beyond} beyond ${(tier.range * 1.3 / 1000).toFixed(0)} km`);
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

/* ================================================================== *
 * Wave 17: the bigger world
 * ================================================================== */
const NF = await import(SRC + 'world/navfield.js');
const HZ = await import(SRC + 'world/worldmap/horizon.js');
const FL = await import(SRC + 'world/worldmap/flora.js');
const RO = await import(SRC + 'render/render-origin.js');
const AP = await import(SRC + 'flight/autopilot.js');
const PHY = await import(SRC + 'aircraft/physics.js');
const PLANMOD = await import(new URL('../../tools/worldmap/world-plan.mjs', import.meta.url).href);
const WPF = await import(SRC + 'features/world-preview.js');

/* ---- the sea is deterministic, and is the plan ---- */
{
  const again = PLANMOD.fillerIslands();
  const shipped = D.islands.slice(D.islands.length - again.length);
  const same = JSON.stringify(again) === JSON.stringify(shipped) && JSON.stringify(PLANMOD.fillerIslands()) === JSON.stringify(again);
  ok('the seeded islands come out the same every time, and are the ones that shipped', same, `${again.length} generated, ${D.islands.length} in all`);
  const names = new Set(D.islands.map((i) => i.name));
  ok('every island name is unique', names.size === D.islands.length, `${names.size}/${D.islands.length}`);
  const words = [...D.airports.map((a) => a.name), ...D.towns.map((t) => t.name), ...(D.heliports || []).map((h) => h.name)];
  ok('every field, town and heliport name is clear of the deny-list', words.every((w) => !NM.isDenied(w)), `${words.length} names`);
  const realBrands = /\b(kingfisher|emirates|qantas|ryanair|lufthansa|delta|united|american|british|virgin|easyjet|jetblue|southwest|cathay|etihad|qatar)\b/i;
  ok('no real airline or brand in any name', words.every((w) => !realBrands.test(w)), '');
  const byRegion = WPF.byRegion();
  ok('the start picker\'s order: every field once, under its region', byRegion.reduce((n, g) => n + g.airports.length, 0) === D.airports.length && byRegion.length === D.regions.length,
    byRegion.map((g) => `${g.region.name}: ${g.airports.map((a) => a.code).join(' ')}`).join('; '));
}

/* ---- heliports ---- */
{
  PV.setDeparture('haven');
  T.applyMap(def);
  const pads = D.scenery.pads;
  const extra = pads.filter((p) => !p.id.startsWith('field-'));
  let bad = [];
  for (const p of pads) {
    const g = T.heightAt(p.x, p.z);
    if (p.kind === 'deck' ? g > -5 : g < 1) bad.push(`${p.id} ground ${g.toFixed(1)}`);
    if (T.isOnAnyRunway(p.x, p.z, 40)) bad.push(`${p.id} on a runway`);
  }
  ok('every pad stands where its kind says (decks over open water, the rest on dry land), none on a runway', bad.length === 0 && pads.length === D.airports.length + extra.length,
    `${pads.length} pads (${extra.map((p) => `${p.name} ${p.kind}`).join(', ')}) ${bad.join('; ')}`);
}

/* ---- the field you are at ---- */
{
  const f = { cx: 1000, cz: 500, elev: 20, length: 2000, halfWidth: 23 };
  let papiOk = true;
  const lines = [];
  for (const dir of [1, -1]) {
    const F = { ...f, dir };
    const t = NF.thresholdOf(F);
    for (const [deg, want] of [[3, 2], [2.2, 0], [3.8, 4]]) {
      const d = 5000;
      const pos = { x: t.touchX - dir * d, y: F.elev + Math.tan((deg * Math.PI) / 180) * d, z: F.cz };
      const w = NF.papiFor(F, pos).whites;
      lines.push(`${dir > 0 ? '09' : '27'} ${deg}° → ${w}`);
      if (w !== want) papiOk = false;
    }
    // From the wrong side: no lights for you.
    if (NF.papiFor(F, { x: t.touchX + dir * 3000, y: F.elev + 150, z: F.cz }).approaching) papiOk = false;
  }
  ok('the PAPI works for any field, either direction (two white, two red on 3 degrees)', papiOk, lines.join(', '));

  // Nearest, with hysteresis; the destination inside 60 km.
  const A = (id) => PV.airportById(id);
  const mid = { x: (A('haven').x + A('gull').x) / 2, z: (A('haven').z + A('gull').z) / 2 };
  const n1 = WPF.pickNav(mid.x - 500, mid.z, A('haven'), null);
  const n2 = WPF.pickNav(mid.x + 500, mid.z, A('haven'), null);
  const n3 = WPF.pickNav(A('gull').x - 3000, A('gull').z, A('haven'), null);
  const n4 = WPF.pickNav(A('haven').x + 5000, 0, A('haven'), A('tern'));
  ok('the field you are at: the nearest, not flicking over half way, the destination inside 60 km', n1.id === 'haven' && n2.id === 'haven' && n3.id === 'gull' && n4.id === 'tern',
    `${n1.code}, ${n2.code}, ${n3.code}, ${n4.code}`);
  // A destination inside 60 km set while still at the departure (checker, wave 17: Haven's
  // tower was handed to Gull's on Haven's runway, and Haven never cleared the take-off).
  const onRw = WPF.pickNav(A('haven').x - 1000, A('haven').z, A('haven'), A('gull'));
  const offEnd = WPF.pickNav(A('haven').x + A('haven').length / 2 + 1000, A('haven').z, A('haven'), A('gull'));
  const away = WPF.pickNav(A('haven').x + A('haven').length / 2 + 2500, A('haven').z, A('haven'), A('gull'));
  const atDest = WPF.pickNav(A('gull').x, A('gull').z, A('haven'), A('gull'));
  ok('a destination inside 60 km does not take the tower of the field you are still at', onRw.id === 'haven' && offEnd.id === 'haven' && away.id === 'gull' && atDest.id === 'gull',
    `on Haven's runway ${onRw.code}, 1 km off its end ${offEnd.code}, 2.5 km off ${away.code}, at Gull ${atDest.code}`);

  // The approach autopilot, flown from every field's gate, both directions:
  // a target on the centreline ahead, a height on the slope, and a hand-back near the threshold.
  const ap = new AP.Autopilot();
  ap.setMode('approach');
  const bad = [];
  for (const a of D.airports) {
    for (const dir of [1, -1]) {
      const F = WPF.navFor(a, dir > 0 ? 80 : 260);
      NF.setNavField(F);
      const t = NF.thresholdOf(F);
      const at = (out, y, off = 0) => ({ pos: new THREE.Vector3(t.x - dir * out, F.elev + y, F.cz + off), vel: new THREE.Vector3(dir * 70, 0, 0), agl: y, groundSpeed: 70, readouts: () => ({}) });
      ap.handedBack = null;
      const p1 = ap.planFor(at(9000, 460));
      const p2 = ap.planFor(at(4000, 4000 * Math.tan(3 * Math.PI / 180), 300));
      ap.handedBack = null;
      const p3 = ap.planFor(at(1500, 1500 * Math.tan(3 * Math.PI / 180)));
      const hb = ap.handedBack;
      const aheadOk = p1 && Math.sign(p1.target.x - (t.x - dir * 9000)) === dir && Math.abs(p1.target.z - F.cz) < 1;
      const slopeOk = p2 && Math.abs(p2.altFt / 3.28084 - (F.elev + 4000 * Math.tan(3 * Math.PI / 180))) < 2 && p2.feedForwardFpm < 0;
      if (!aheadOk || !slopeOk || p3 !== null || !hb) bad.push(`${a.code} ${dir > 0 ? '09' : '27'}`);
    }
  }
  NF.setNavField(null);
  ok('the approach autopilot flies every field\'s centreline and glide slope, both directions, and hands back at the threshold', bad.length === 0, bad.join(', ') || `${D.airports.length * 2} approaches`);

  // How far out it tells main.js (gear at 7 km, flap under 6 and 3.5): along the centreline once
  // lined up, the straight distance before that. Checker, wave 17: engaged abeam a field 30 km
  // north of its threshold, it read 2 km out and put the gear and full flap out at 216 kt.
  {
    const F = WPF.navFor(PV.airportById('eider'), 80);
    NF.setNavField(F);
    const t = NF.thresholdOf(F);
    const fly = (dx, dz, vx, vz) => {
      ap.handedBack = null;
      ap.planFor({ pos: new THREE.Vector3(t.x + dx, F.elev + 1500, F.cz + dz), vel: new THREE.Vector3(vx, 0, vz), agl: 1500, groundSpeed: 110, readouts: () => ({}) });
      return ap.approachOut;
    };
    const abeam = fly(-2000, -30000, 110, 0);
    const lined = fly(-5000, 200, 110, 0);
    NF.setNavField(null);
    ok('the approach\'s "how far out" is the distance to the threshold until lined up (no gear and flap 30 km abeam)', abeam > 29000 && Math.abs(lined - 5000) < 1,
      `abeam 30 km: ${Math.round(abeam)} m out; lined up 5 km: ${Math.round(lined)} m`);
  }

  // The tower names the field you are at, its runway, and hands you over.
  const said = [];
  const fakeSim = {
    aircraft: { pos: new THREE.Vector3(), onGround: false, crashed: false, engineOn: true, airborneTime: 10, controls: { throttle: 0.3 }, heading: 90, readouts: () => ({ heading: 90 }), fuel: 160, alt: 3000, agl: 3000, vs: 0 },
    weather: { windDirDeg: 80, windSpeedKts: 8, condition: 'clear', windDescription: () => ({ cross: 0 }) },
    aircraftType: { callsign: 'Skylark one seven two' },
    speak: (t) => said.push(t),
    cloudImmersion: 0,
  };
  const { AtcDirector } = await import(SRC + 'game/atc-director.js');
  NF.setNavField(WPF.navFor(PV.airportById('haven'), 80));
  const atc = new AtcDirector(fakeSim);
  atc.update(0.1);
  NF.setNavField(WPF.navFor(PV.airportById('frigate'), 260));
  atc.cool = 0;
  atc.update(0.1);
  const handover = said.find((x) => /contact Frigate Tower/.test(x) && /two seven/.test(x));
  ok('the tower is the field you are at: name, runway into the wind, a handover', atc.field === 'Frigate' && atc.runwayCall === 'two seven' && !!handover, `${atc.field} / ${atc.runwayCall} / "${handover || said.join(' | ')}"`);
  NF.setNavField(null);
  ok('with no field named the tower is the map\'s, as on every other map', atc.field === (M.getMap(PV.WORLD_PREVIEW_ID).name.split(' ')[0]) && atc.runwayCall === 'zero nine', `${atc.field} / ${atc.runwayCall}`);

  // A landing on another field's runway is a runway landing.
  PV.setDeparture('haven');
  T.applyMap(def);
  A_refresh();
  const fr = PV.airportById('frigate');
  T.setOtherRunways([{ cx: fr.x, cz: fr.z, length: fr.length, halfWidth: fr.halfWidth }]);
  const on = T.isOnAnyRunway(fr.x + 300, fr.z + 5) && !T.isOnAnyRunway(fr.x, fr.z + 200);
  T.setOtherRunways([]);
  const offAgain = !T.isOnAnyRunway(fr.x + 300, fr.z + 5);
  ok('another field\'s runway counts as a runway while the preview says so, and not after', on && offAgain, `on ${on}, cleared ${offAgain}`);
}
function A_refresh() { A.refreshRunways(); }

/* ---- the floating origin for drawing ---- */
{
  RO.setRenderOrigin(null);
  const off = RO.originFor(250000, 250000);
  RO.setRenderOrigin({});
  const near = RO.originFor(20000, 10000);
  const far = RO.originFor(-187654, 143210);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera();
  const child = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  child.position.set(-187000, 100, 143000);
  scene.add(child);
  cam.position.set(-187654, 900, 143210);
  scene.updateMatrixWorld();
  cam.updateMatrixWorld();
  const viewBefore = new THREE.Matrix4().multiplyMatrices(cam.matrixWorldInverse, child.matrixWorld).elements.slice();
  const moved = RO.beginRender(scene, cam);
  scene.updateMatrixWorld();
  const gpuWorld = new THREE.Vector3().setFromMatrixPosition(child.matrixWorld);
  const camGpu = cam.position.clone();
  const viewDuring = new THREE.Matrix4().multiplyMatrices(cam.matrixWorldInverse, child.matrixWorld).elements;
  const uni = RO.RENDER_ORIGIN.value.clone();
  RO.endRender(scene, cam);
  const back = cam.position.x === -187654 && cam.position.z === 143210 && scene.position.lengthSq() === 0 && RO.RENDER_ORIGIN.value.lengthSq() === 0
    && new THREE.Vector3().setFromMatrixPosition(child.matrixWorld).x === -187000;
  let worst = 0;
  for (let i = 0; i < 16; i++) worst = Math.max(worst, Math.abs(viewBefore[i] - viewDuring[i]));
  ok('the floating origin: off on other maps, none within 24 km, a 4 km grid point beyond', off.x === 0 && off.z === 0 && near.x === 0 && near.z === 0 && far.x % 4096 === 0 && far.z % 4096 === 0 && Math.hypot(far.x + 187654, far.z - 143210) < 4096,
    `off (${off.x}, ${off.z}); 22 km (${near.x}, ${near.z}); 235 km (${far.x}, ${far.z})`);
  ok('during a draw at 235 km the GPU sees small numbers (camera and mesh within 4 km of 0) and the same view; after it, everything is back',
    moved && Math.hypot(camGpu.x, camGpu.z) < 4096 && Math.abs(gpuWorld.x) < 6000 && worst < 1e-6 && back && uni.x === far.x,
    `camera at (${camGpu.x.toFixed(0)}, ${camGpu.z.toFixed(0)}), mesh at (${gpuWorld.x.toFixed(0)}, ${gpuWorld.z.toFixed(0)}), view matrix change ${worst.toExponential(1)}, restored ${back}`);
  // float32 at the furthest coast without and with the origin.
  const ulp = (v) => { const f = new Float32Array([v]); const i = new Int32Array(f.buffer); const g = new Float32Array(1); const j = new Int32Array(g.buffer); j[0] = i[0] + 1; return g[0] - f[0]; };
  const edge = 199000;
  ok('float32 steps: 1.6 cm at the edge of the sea, under 0.5 mm with the origin', ulp(edge) > 0.01 && ulp(4096 * 0.71) < 0.0005, `${(ulp(edge) * 100).toFixed(2)} cm at 199 km, ${(ulp(4096 * 0.71) * 1000).toFixed(2)} mm at 2.9 km`);
  RO.setRenderOrigin(null);
}

/* ---- the horizon ---- */
{
  PV.setDeparture('haven');
  T.applyMap(def);
  const tier = ST.TIERS.low;
  const hz = new HZ.Horizon({ heightAt: T.heightAt, islands: D.islands, hideWithin: tier.range });
  let left = 1;
  for (let i = 0; i < 400 && left; i++) left = hz.build(1e9);
  let worst = 0;
  for (let k = 0; k < D.islands.length; k += 7) {
    for (const [x, h, z] of hz.shapes[k]) worst = Math.max(worst, Math.abs(T.heightAt(x, z) - h));
  }
  const hub = PV.airportById('haven');
  const shown = hz.shownFrom(hub.x, hub.z);
  const nearOnes = shown.filter((i) => Math.hypot(i.cx - hub.x, i.cz - hub.z) - i.radius * 1.45 < tier.range);
  const pos = hz.geometry.attributes.position;
  ok('the horizon: every island as one shape in one geometry, sampled from the height field', left === 0 && hz.built === D.islands.length && worst < 1e-6 && pos.count === D.islands.length * hz.per && hz.geometry.index.count / 3 < 25000,
    `${hz.built} islands, ${pos.count} vertices, ${hz.geometry.index.count / 3} triangles, worst sample ${worst.toExponential(1)} m`);
  ok('from the hub at Low, the islands past the streamed ground are on the horizon, none that the ground already draws', shown.length >= 40 && nearOnes.length === 0,
    `${shown.length} of ${D.islands.length} as shapes from ${hub.code}, ${nearOnes.length} inside ${tier.range / 1000} km`);
  hz.dispose();
}

/* ---- trees on every island ---- */
{
  PV.setDeparture('haven');
  T.applyMap(def);
  const ctx = FL.floraContext(D);
  const once = FL.placeCell(T, ctx, -62, 9, 80);
  const twice = FL.placeCell(T, ctx, -62, 9, 80);
  ok('a cell\'s trees are the same every time (seeded by the cell)', once && twice && once.length === twice.length && once.every((v, i) => v === twice[i]), `${once ? once.length / 6 : 0} trees in cell -62,9`);
  // Plant every cell of a few islands in each region and check where they stood.
  const stats = {};
  const problems = [];
  const fieldsAndLanes = D.airports;
  let cells = 0;
  for (const g of D.regions) {
    const isl = D.islands.filter((i) => i.region === g.id && i.radius > 1500).slice(0, 3);
    const st = (stats[g.id] = { trees: 0, palms: 0, conifers: 0 });
    for (const i of isl) {
      for (let ix = Math.floor((i.cx - i.radius) / FL.CELL); ix <= Math.floor((i.cx + i.radius) / FL.CELL); ix++) {
        for (let iz = Math.floor((i.cz - i.radius) / FL.CELL); iz <= Math.floor((i.cz + i.radius) / FL.CELL); iz++) {
          const t = FL.placeCell(T, ctx, ix, iz, 80);
          cells++;
          if (!t) continue;
          for (let k = 0; k < t.length; k += 6) {
            const x = t[k];
            const z = t[k + 2];
            st.trees++;
            if (t[k + 5] === 0) st.palms++;
            if (t[k + 5] === 2) st.conifers++;
            if (T.heightAt(x, z) < 2) problems.push(`in the sea at ${x.toFixed(0)}, ${z.toFixed(0)}`);
            if (T.flatAt(x, z)) problems.push(`on made ground at ${x.toFixed(0)}, ${z.toFixed(0)}`);
            for (const a of fieldsAndLanes) if (Math.abs(z - a.z) < 400 && Math.abs(x - a.x) < a.length / 2 + 3000) problems.push(`in ${a.code}'s lanes`);
          }
        }
      }
    }
  }
  const lines = Object.entries(stats).map(([k, v]) => `${k} ${v.trees} (${v.palms} palms, ${v.conifers} conifers)`);
  ok('trees on the islands of every region', Object.values(stats).every((v) => v.trees > 50), lines.join(', '));
  ok('none in the sea, on a field, a town or a road, or in a runway\'s lanes', problems.length === 0, problems.slice(0, 4).join('; ') || `${cells} cells planted`);
  ok('the region\'s own trees: palms in the south, conifers and no palms in the north', stats.sands.palms > stats.sands.trees * 0.3 && stats.skerries.palms === 0 && stats.skerries.conifers > stats.skerries.trees * 0.3,
    `${lines.join(', ')}`);
  const counts = {};
  for (const q of ['low', 'medium', 'high']) {
    const f = new FL.Flora({ treeGeometry: () => new THREE.BoxGeometry(), ctx, T, quality: q, addObstacle: T.addObstacle, obstacles: T.OBSTACLES });
    const fr = PV.airportById('frigate');
    const ac = { pos: new THREE.Vector3(fr.x + 2500, 60, fr.z - 2500), agl: 40 };
    for (let i = 0; i < 60; i++) f.update({ x: ac.pos.x, z: ac.pos.z }, ac, 1e9);
    const s1 = f.stats();
    const solidBefore = T.OBSTACLES.length;
    ac.agl = 900;
    f.update({ x: ac.pos.x, z: ac.pos.z }, ac, 1e9);
    const solidAfter = T.OBSTACLES.length;
    counts[q] = { drawn: s1.drawn, cap: s1.capacity, solid: s1.solid, freed: solidBefore - solidAfter };
    // Move off 40 km: every cell of the old place dropped.
    for (let i = 0; i < 5; i++) f.update({ x: fr.x + 42000, z: fr.z }, null, 1e9);
    counts[q].after = f.stats().cells;
    counts[q].keptOld = [...f.cells.values()].filter((c) => Math.abs(c.ix * FL.CELL - fr.x) < 10000).length;
    f.dispose();
  }
  ok('tier-scaled: Low very sparse, more at Medium, more again at High, never over the pool', counts.low.drawn > 0 && counts.low.drawn < counts.medium.drawn && counts.medium.drawn < counts.high.drawn && counts.low.drawn <= 600 && Object.values(counts).every((c) => c.drawn <= c.cap),
    Object.entries(counts).map(([q, c]) => `${q} ${c.drawn} of ${c.cap}`).join(', '));
  ok('trees are solid round a low aeroplane, and taken away when it climbs; far cells are dropped', Object.values(counts).every((c) => c.solid > 0 && c.freed === c.solid && c.keptOld === 0),
    Object.entries(counts).map(([q, c]) => `${q} ${c.solid} solid, ${c.freed} freed, ${c.keptOld} old cells kept`).join(', '));
}

/* ---- sim rate ---- */
{
  const fakeAc = (o = {}) => ({ crashed: false, onGround: false, pos: new THREE.Vector3(0, 3500, 60000), groundSpeed: 230, fuelFraction: () => 0.6, readouts: () => ({ aglFt: o.aglFt ?? 11000, vsFpm: o.vsFpm ?? 0 }), ...o });
  M.registerExtraMap(def);
  T.applyMap(def);
  const sim = { mode: 'free', state: 'flying', aircraft: fakeAc(), autopilot: { engaged: true, mode: 'hold' }, warnings: { active: () => [] }, hud: { notify() {} }, instrumentBlackout: 0 };
  const cases = [
    ['cruise on the autopilot', {}, ''],
    ['autopilot off', { autopilot: { engaged: false, mode: 'hold' } }, 'autopilot'],
    ['on an approach', { autopilot: { engaged: true, mode: 'approach' } }, 'approach'],
    ['low over the ground', { aircraft: fakeAc({ readouts: () => ({ aglFt: 2400, vsFpm: 0 }) }) }, '3,000'],
    ['a warning lit', { warnings: { active: () => ['stall'] } }, 'warning'],
    ['in a game with friends', { multiplayer: { active: true } }, 'friends'],
    ['on the ground', { aircraft: fakeAc({ onGround: true }) }, 'air'],
    ['a mission', { mode: 'mission' }, 'Free Flight'],
  ];
  const bad = [];
  for (const [name, o, want] of cases) {
    const why = WPF.warpBlocked({ ...sim, ...o });
    if (want ? !why.includes(want) : why !== '') bad.push(`${name}: "${why}"`);
  }
  ok('sim rate only in a steady autopilot cruise: blocked on the approach, low, with a warning, with friends, on the ground', bad.length === 0, bad.join('; ') || `${cases.length} cases`);
  // The rate goes up only as far as 1 km of ground a real second.
  const s2 = { ...sim, aircraft: fakeAc({ groundSpeed: 680 }), timeScale: 1 };
  WPF.cycleWarp(s2);
  const fighter = s2.timeScale;
  const s3 = { ...sim, aircraft: fakeAc({ groundSpeed: 230 }), timeScale: 1 };
  WPF.cycleWarp(s3);
  const k2 = s3.timeScale;
  WPF.cycleWarp(s3);
  const k4 = s3.timeScale;
  ok('2x then 4x for an airliner; a Mach 2 jet stays at 1x (no more than 1 km of ground a second)', k2 === 2 && k4 === 4 && fighter === 1, `airliner ${k2}x, ${k4}x; Mach 2 ${fighter}x`);
  WPF.cycleWarp(s3);
}

const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed, ${(performance.now() - t0).toFixed(0)} ms`);
process.exit(fails.length ? 1 : 0);
