/**
 * Lays out the World Map preview and writes src/world/worldmap/preview-data.js.
 *
 *   /opt/homebrew/bin/node tools/worldmap/preview-layout.mjs          measure, check, write
 *   /opt/homebrew/bin/node tools/worldmap/preview-layout.mjs --check  measure and check only
 *
 * The PLAN (tools/worldmap/world-plan.mjs) is what a person decides: which islands, where each field
 * goes, how long its runway is, which way the wind usually blows, what kind of
 * field it is. Everything that has to be MEASURED is measured here from the
 * real height field and written out as numbers, so the game never guesses:
 *
 *   - field elevation: the median of the natural ground under the runway
 *   - the field's level site (an authored flat): the runway, both overruns
 *     and the whole airport layout airport-layout.js lays out for it when it
 *     is the field you start from — grown until every piece of it fits
 *   - each town's level ground, at the town's own median height
 *   - the road from the field's landside edge to its town: a polyline whose
 *     points carry the ground's height, smoothed and held under 8%
 *   - where the carrier anchors when you start from that field
 *
 * and then every placement rule (worldmap/preview.js checkAirport and
 * checkNetwork) is run on the result. A rule that fails stops the write.
 * Nothing in the PLAN is moved to make a rule pass: a field that cannot pass
 * is a plan to change by hand, which is the point of the rule.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SRC = new URL('../../src/', import.meta.url).href;
const T = await import(SRC + 'world/terrain.js');
const LAY = await import(SRC + 'world/airport-layout.js');
const CB = await import(SRC + 'world/carrier-berth.js');
const PV = await import(SRC + 'world/worldmap/preview.js');
const NM = await import(SRC + 'world/worldmap/names.js');

const CHECK_ONLY = process.argv.includes('--check');

/* ------------------------------------------------------------------ */
/* The plan: tools/worldmap/world-plan.mjs                             */
/* ------------------------------------------------------------------ */

const { PLAN } = await import('./world-plan.mjs');

/* ------------------------------------------------------------------ */
/* Measuring                                                           */
/* ------------------------------------------------------------------ */

const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

function dataFrom(plan, airports, flats, roads, towns) {
  return {
    version: 2,
    seaFloor: plan.seaFloor,
    regions: plan.regions,
    islands: plan.islands,
    flats,
    roads,
    towns,
    airports,
    heliports: heliportsFor(plan, airports, towns),
    palette: plan.palette,
    weather: plan.weather,
    scenery: sceneryFor(airports, towns, heliportsFor(plan, airports, towns)),
  };
}

/** The pads that are not at a field, in world space (a `near` pad is placed off its field's town). */
function heliportsFor(plan, airports, towns) {
  return (plan.heliports || []).map((h) => {
    let x = h.x;
    let z = h.z;
    if (h.near) {
      const t = towns.find((q) => q.airport === h.near);
      const a = airports.find((q) => q.id === h.near);
      const c = t || { cx: a.x, cz: a.z, radius: 0 };
      x = Math.round(c.cx + Math.sign(h.dx || 1) * (c.radius + Math.abs(h.dx || 0) * 0.2) + (h.dx || 0) * 0.8);
      z = Math.round(c.cz + (h.dz || 0));
    }
    const out = { id: h.id, name: h.name, region: h.region, kind: h.kind, r: h.r, x, z };
    if (h.role) out.role = h.role;
    if (h.above != null) out.above = h.above;
    if (h.elev != null) out.elev = h.elev;
    return out;
  });
}

function sceneryFor(airports, towns, heliports = []) {
  const hub = airports[0];
  const ht = towns.find((t) => t.airport === hub.id);
  return {
    flora: 'tropical',
    // The hub's own island is ISLANDS[0]: Scenery plants its coast and hill
    // trees there and builds its town; the other towns are built by the
    // preview (worldmap/outstation.js) with the same town builder.
    coastTrees: 700,
    coastTreeHeight: 10,
    hillTrees: 420,
    hillTreeHeight: 13,
    hillCentre: [-2400, 3900],
    hillRadius: 1500,
    hillBand: [50, 220],
    town: ht ? { cx: ht.cx, cz: ht.cz, radius: ht.radius, count: ht.count, minH: Math.max(2, ht.elev - 20), maxH: ht.elev + 40 } : undefined,
    lighthouse: [-22000, 7000],
    deliveryPad: [14000, 16000],
    padTrees: 60,
    boats: 3,
    pads: [
      ...airports.map((a) => ({ id: `field-${a.id}`, name: `${a.name} Pad`, x: a.pad.x, z: a.pad.z, kind: 'ground', r: 12 })),
      ...heliports.map((h) => {
        const p = { id: h.id, name: h.name, x: h.x, z: h.z, kind: h.kind, r: h.r };
        for (const k of ['role', 'above', 'elev']) if (h[k] != null) p[k] = h[k];
        return p;
      }),
    ],
  };
}

function applyData(data, departureId) {
  const def = PV.makeDef(data);
  PV.setDepartureOn(def, departureId || data.airports[0].id);
  T.applyMap(def);
  return def;
}

/** The natural ground over a rectangle, with no flats at all. */
function natural(plan, x0, x1, z0, z1, step = 40) {
  const hs = [];
  let slope = 0;
  let n = 0;
  for (let x = x0; x <= x1; x += step) {
    for (let z = z0; z <= z1; z += step) {
      const h = T.heightAt(x, z);
      hs.push(h);
      const gx = (T.heightAt(x + 10, z) - T.heightAt(x - 10, z)) / 20;
      const gz = (T.heightAt(x, z + 10) - T.heightAt(x, z - 10)) / 20;
      slope += Math.hypot(gx, gz);
      n++;
    }
  }
  const min = Math.min(...hs);
  const max = Math.max(...hs);
  return { min, max, median: median(hs), slope: slope / n, hs };
}

/** How deep the level site runs north of the runway: by the layout's own size class (airport-layout.js classFor). */
function siteDepth(length) {
  return length >= 1500 ? 980 : length >= 600 ? 620 : 300;
}

function measure(plan) {
  const report = [];
  // 1. The natural ground: islands only.
  const bare = dataFrom(plan, plan.airports.map((a) => ({ ...a, elev: 10, pad: { x: a.x, z: a.z } })), [], [], []);
  applyData(bare);
  const airports = [];
  const naturals = {};
  for (const p of plan.airports) {
    const L = p.length;
    const n = natural(plan, p.x - L / 2, p.x + L / 2, p.z - p.halfWidth - 60, p.z + p.halfWidth + 60, 25);
    const elev = Math.max(6, Math.round(n.median * 2) / 2);
    const cutFill = Math.max(Math.abs(n.max - elev), Math.abs(elev - Math.max(n.min, 0)));
    naturals[p.id] = { ...n, cutFill };
    const depth = siteDepth(p.length);
    airports.push({
      ...p,
      elev,
      // The level site: overruns at both ends, the layout to the north.
      site: { x0: p.x - L / 2 - 600, x1: p.x + L / 2 + 600, z0: p.z - depth, z1: p.z + p.halfWidth + 140 },
    });
    delete airports[airports.length - 1].town;
  }

  // 2. Towns on their own level ground.
  const towns = plan.airports.map((p) => {
    const cx = p.x + p.town.dx;
    const cz = p.z + p.town.dz;
    const n = natural(plan, cx - p.town.radius * 0.6, cx + p.town.radius * 0.6, cz - p.town.radius * 0.6, cz + p.town.radius * 0.6, 30);
    return { airport: p.id, name: p.town.name, cx, cz, radius: p.town.radius, count: p.town.count, elev: Math.max(4, Math.round(n.median)) };
  });

  // 3. Flats, then grow each site until its departure layout fits.
  const flatsOf = (aps) => {
    const out = [];
    for (const a of aps) {
      out.push({ id: `rwy-${a.id}`, name: `${a.name} runway`, kind: 'runway', x0: a.x - a.length / 2, x1: a.x + a.length / 2, z0: a.z - a.halfWidth, z1: a.z + a.halfWidth, blend: 4, surface: a.surface || 'tarmac', elev: a.elev, clear: true });
      out.push({ id: `site-${a.id}`, name: a.name, kind: 'airfield', ...a.site, blend: 260, surface: 'grass', elev: a.elev, clear: true });
    }
    for (const t of towns) {
      const r = t.radius;
      out.push({ id: `town-${t.airport}`, name: t.name, kind: 'town', x0: t.cx - r * 0.8, x1: t.cx + r * 0.8, z0: t.cz - r * 0.8, z1: t.cz + r * 0.8, blend: 240, surface: 'grass', elev: t.elev, clear: false });
    }
    return out;
  };
  const withPads = (aps) => aps.map((a) => ({
    ...a,
    // The helicopter pad: on the site, west of the layout, north of the runway.
    pad: { x: a.x - a.length / 2 - 150, z: a.z - a.halfWidth - 110 },
    // The landside edge, where the road to town starts.
    apron: { x: a.x, z: a.site.z0 - 20 },
  }));
  let aps = withPads(airports);
  const layouts = {};
  for (let pass = 0; pass < 4; pass++) {
    let grew = false;
    const data = dataFrom(plan, aps, flatsOf(aps), [], towns);
    for (const a of aps) {
      applyData(data, a.id);
      const lay = LAY.airportLayout();
      layouts[a.id] = lay;
      const pieces = [...(lay.pavement || []), ...(lay.buildings || [])];
      if (lay.carPark) pieces.push(lay.carPark);
      let { x0, x1, z0, z1 } = a.site;
      for (const r of pieces) {
        if (!Number.isFinite(r.x0)) continue;
        x0 = Math.min(x0, r.x0 - 40); x1 = Math.max(x1, r.x1 + 40);
        z0 = Math.min(z0, r.z0 - 40); z1 = Math.max(z1, r.z1 + 40);
      }
      if (x0 < a.site.x0 || x1 > a.site.x1 || z0 < a.site.z0 || z1 > a.site.z1) {
        a.site = { x0: Math.floor(x0), x1: Math.ceil(x1), z0: Math.floor(z0), z1: Math.ceil(z1) };
        grew = true;
      }
    }
    aps = withPads(aps);
    if (!grew) break;
  }

  // 4. Roads: the landside edge to the town, over the ground as it now is.
  let data = dataFrom(plan, aps, flatsOf(aps), [], towns);
  applyData(data);
  const roads = [];
  for (const a of aps) {
    const t = towns.find((q) => q.airport === a.id);
    // From the car park's landside edge (the terminal's, at a field with none):
    // a car park with no road to it is what the owner asked to be rid of.
    const lay = layouts[a.id];
    const lr = (lay.carPark && lay.carPark.rect) || (lay.terminal && lay.terminal.rect) || { x0: a.x - 20, x1: a.x + 20, z0: a.site.z0 + 40, z1: a.site.z0 + 40 };
    const from = { x: Math.round((lr.x0 + lr.x1) / 2), z: Math.round(lr.z0 - 12) };
    a.apron = { x: from.x, z: from.z };
    const to = { x: t.cx, z: t.cz };
    // Leave the site northwards first, then straight for the town.
    const leg1 = { x: from.x, z: Math.min(from.z, a.site.z0 - 140) };
    const pts = [];
    const segs = [[from, leg1], [leg1, to]];
    for (const [p, q] of segs) {
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      const n = Math.max(1, Math.ceil(d / 120));
      for (let i = pts.length ? 1 : 0; i <= n; i++) pts.push([p.x + ((q.x - p.x) * i) / n, p.z + ((q.z - p.z) * i) / n]);
    }
    let ys = pts.map(([x, z]) => Math.max(1.5, T.heightAt(x, z)));
    // Smooth, then hold the grade.
    for (let k = 0; k < 6; k++) ys = ys.map((y, i) => (i === 0 || i === ys.length - 1 ? y : (ys[i - 1] + y * 2 + ys[i + 1]) / 4));
    ys[0] = a.elev;
    ys[ys.length - 1] = t.elev;
    for (let k = 0; k < 40; k++) {
      for (let i = 1; i < ys.length; i++) {
        const run = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        const max = run * 0.08;
        if (ys[i] - ys[i - 1] > max) ys[i] = ys[i - 1] + max;
        if (ys[i - 1] - ys[i] > max) ys[i - 1] = ys[i] + max;
      }
    }
    roads.push({ airport: a.id, name: `${t.name} road`, halfWidth: 18, blend: 60, path: pts.map(([x, z], i) => [Math.round(x), Math.round(z), Math.round(ys[i] * 10) / 10]) });
  }

  // 4b. The layouts again, with the roads in (an authored road is a keep-out),
  //     and kept: the other fields are drawn to the same plan
  //     (worldmap/outstation.js), so a field looks laid out the same whether
  //     or not you started from it.
  data = dataFrom(plan, aps, flatsOf(aps), roads, towns);
  for (const a of aps) {
    applyData(data, a.id);
    const lay = LAY.airportLayout();
    const rel = (r) => r && { x0: Math.round(r.x0 - a.x), x1: Math.round(r.x1 - a.x), z0: Math.round(r.z0 - a.z), z1: Math.round(r.z1 - a.z) };
    a.layout = {
      cls: lay.cls,
      dropped: lay.dropped.slice(),
      pavement: lay.pavement.map((p) => ({ kind: p.kind, ...rel(p) })),
      terminal: lay.terminal && { ...rel(lay.terminal.rect), h: lay.terminal.H },
      tower: lay.tower && { ...rel(lay.tower.rect), h: lay.tower.H },
      hangars: lay.hangars.map((h) => ({ ...rel(h.rect), h: h.H })),
      fire: lay.fire && lay.fire.rect ? { ...rel(lay.fire.rect), h: 8 } : null,
      fuel: lay.fuel && lay.fuel.rect ? { ...rel(lay.fuel.rect), tanks: lay.fuel.tanks, r: lay.fuel.r, h: lay.fuel.H } : null,
      carPark: lay.carPark && lay.carPark.rect ? rel(lay.carPark.rect) : null,
      windsock: lay.windsock ? { x: Math.round(lay.windsock.x - a.x), z: Math.round(lay.windsock.z - a.z) } : null,
    };
    report.push(`${a.code} layout ${lay.cls}: ${lay.pavement.length} paved, ${lay.buildings.length} buildings, car park ${lay.carPark ? 'yes' : 'no'}, dropped ${JSON.stringify(lay.dropped)}`);
  }

  // 5. The carrier's berth when you start from each field.
  data = dataFrom(plan, aps, flatsOf(aps), roads, towns);
  for (const a of aps) {
    const def = applyData(data, a.id);
    delete def.carrier;
    const b = CB.chooseBerth({ map: def, airport: def.airport, heightAt: T.heightAt });
    a.carrier = b && b.why !== 'none' ? { x: b.x, z: b.z } : null;
    report.push(`${a.code} carrier ${b ? b.why : 'none'} at ${a.carrier ? `${a.carrier.x}, ${a.carrier.z}` : '-'}`);
  }
  data = dataFrom(plan, aps, flatsOf(aps), roads, towns);
  return { data, naturals, layouts, report };
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

const t0 = performance.now();
const { data, naturals, report } = measure(PLAN);
let fails = 0;
const lines = [];
for (const a of data.airports) {
  applyData(data, a.id);
  const lay = LAY.airportLayout();
  for (const r of PV.checkAirport(T, a, { data, natural: naturals[a.id], layout: lay })) {
    if (!r.pass) fails++;
    lines.push(`${r.pass ? 'ok  ' : 'FAIL'}  ${r.airport} ${r.rule} — ${r.detail}`);
  }
  if (process.argv.includes('--debug')) console.log(a.code, lay.cls, lay.shape, JSON.stringify(lay.dropped).slice(0, 600));
}
// Every field's site and lanes must be the same ground whichever field was loaded.
{
  const samples = [];
  for (const b of data.airports) {
    for (let x = b.x - b.length / 2 - 6000; x <= b.x + b.length / 2 + 6000; x += 100) {
      for (let z = b.z - 900; z <= b.z + 900; z += 100) samples.push([x, z, b.code]);
    }
  }
  applyData(data, data.airports[0].id);
  const ref = samples.map(([x, z]) => T.heightAt(x, z));
  for (const a of data.airports.slice(1)) {
    applyData(data, a.id);
    let worst = 0;
    let worstAt = '';
    samples.forEach(([x, z, code], i) => {
      const d = Math.abs(T.heightAt(x, z) - ref[i]);
      if (d > worst) { worst = d; worstAt = `at ${x}, ${z} (${code}'s lanes; ${ref[i].toFixed(1)} m with ${data.airports[0].code} loaded)`; }
    });
    lines.push(`${worst < 0.01 ? 'ok  ' : 'FAIL'}  ${a.code} loaded: every field's lanes and site are the same ground — worst ${worst.toFixed(3)} m ${worstAt}`);
    if (worst >= 0.01) fails++;
  }
}
for (const r of PV.checkNetwork(data)) {
  if (!r.pass) fails++;
  lines.push(`${r.pass ? 'ok  ' : 'FAIL'}  network ${r.rule} — ${r.detail}`);
}
for (const i of data.islands) {
  if (NM.isDenied(i.name)) { fails++; lines.push(`FAIL  name "${i.name}" is on the deny-list`); }
}
if (process.argv.includes('--profile')) {
  for (const a of data.airports) {
    applyData(data, a.id);
    const row = [];
    for (let u = -a.length / 2 - 3000; u <= a.length / 2 + 3000; u += 250) row.push(T.heightAt(a.x + u, a.z).toFixed(0));
    console.log(a.code, 'elev', a.elev, 'centreline every 250 m:', row.join(' '));
  }
}
console.log(lines.join('\n'));
console.log(report.join('\n'));
console.log(`${fails} failing, ${(performance.now() - t0).toFixed(0)} ms`);

if (!CHECK_ONLY) {
  if (fails) {
    console.log('not written: fix the plan');
    process.exit(1);
  }
  const body = `/**
 * GENERATED by tools/worldmap/preview-layout.mjs — do not edit by hand.
 * The World Map preview's islands, fields, level ground, towns and roads,
 * measured from the height field (see that tool). Road points are [x, z, y].
 */
export const PREVIEW_DATA = ${JSON.stringify(data, null, 1)};
`;
  writeFileSync(join(ROOT, 'src/world/worldmap/preview-data.js'), body);
  console.log('wrote src/world/worldmap/preview-data.js');
}
