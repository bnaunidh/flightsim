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
const PS = await import(SRC + 'world/worldmap/personas.js');
const NET = await import('./road-network.mjs');

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

/*
 * The ground's shape (terrain.js: relief, rivers, lakes). CALM is where the
 * rolling relief fades to nothing — every runway's lanes (8.5 km out each
 * end), its site, every town, the road from field to town, the heliports —
 * so the placement rules hold and the level ground stays level. WATERS are
 * the rivers and lakes, made once (makeWaters) on the calm, relieved ground.
 */
let WATERS = { rivers: [], lakes: [] };
/** Calm zones added as the layout goes: the villages, the network's corridors. */
let EXTRA_CALM = [];
/** The bridges' decks (road-network.mjs finishNetwork). */
let BRIDGES = [];
function calmFor(plan) {
  const out = [...EXTRA_CALM];
  for (const a of plan.airports) {
    const L = a.length;
    out.push({ x0: a.x - L / 2 - 8500, x1: a.x + L / 2 + 8500, z0: a.z - 900, z1: a.z + 900, blend: 1500 });
    out.push({ x0: a.x - L / 2 - 900, x1: a.x + L / 2 + 900, z0: a.z - 1700, z1: a.z + 450, blend: 900 });
    const tx = a.x + a.town.dx;
    const tz = a.z + a.town.dz;
    const r = a.town.radius;
    out.push({ x0: tx - r * 1.4, x1: tx + r * 1.4, z0: tz - r * 1.4, z1: tz + r * 1.4, blend: 900 });
    out.push({ ax: a.x, az: a.z - 500, bx: tx, bz: tz, r: 280, blend: 700 });
  }
  for (const h of plan.heliports || []) {
    if (h.near) {
      const a = plan.airports.find((q) => q.id === h.near);
      const x = a.x + a.town.dx + (h.dx || 0);
      const z = a.z + a.town.dz + (h.dz || 0);
      out.push({ x0: x - 900, x1: x + 900, z0: z - 600, z1: z + 600, blend: 600 });
    }
  }
  return out;
}

function dataFrom(plan, airports, flats, roads, towns) {
  return {
    version: 2,
    seaFloor: plan.seaFloor,
    regions: plan.regions,
    islands: plan.islands,
    calm: calmFor(plan),
    rivers: WATERS.rivers,
    lakes: WATERS.lakes,
    bridges: BRIDGES,
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
    town: ht ? { cx: ht.cx, cz: ht.cz, radius: ht.radius, count: ht.count, minH: Math.max(2, ht.elev - 20), maxH: ht.elev + 40, ...(ht.towers ? { towers: ht.towers, towerMaxH: ht.towerMaxH } : {}) } : undefined,
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

/*
 * Rivers and lakes, measured on the relieved ground (no flats yet; the calm
 * zones are where nothing may go). A river starts below a range or in the
 * high middle of a big island and walks to the sea: downhill where the
 * ground says so, outward otherwise, meandering, steered round every calm
 * zone (so it never crosses a runway's lanes, a site, a town or a road).
 * Its water level falls with the ground and never rises; the last point is
 * out at sea. A lake sits in flat open country, its level under its rim.
 */
function rngT(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const RIVER_SOURCES = [
  // Westreach: off the Highfold Range and the Greyspine Fells, and across the western plain.
  { island: 'Westreach', x: -151000, z: 1500, w: [22, 70] },
  { island: 'Westreach', x: -139000, z: -2500, w: [18, 56] },
  { island: 'Westreach', x: -166000, z: 9000, w: [16, 50] },
  { island: 'Westreach', x: -143000, z: 6000, w: [14, 40] },
  // And one down through the middle of the plain to the south coast, under the main road.
  { island: 'Westreach', x: -149500, z: 15500, w: [18, 54] },
  // The big Sound islands.
  { island: 'Farhold Island', x: 43500, z: -43500, w: [12, 30] },
  { island: 'Haven Island', x: -2500, z: -4300, w: [6, 16] },
  { island: 'Frigate Island', x: 110500, z: 84000, w: [6, 16] },
];
const LAKE_TRIES = [
  { island: 'Westreach', n: 4, r: [520, 1150] },
  { island: 'Farhold Island', n: 1, r: [380, 650] },
  { island: 'Haven Island', n: 1, r: [260, 420] },
  { island: 'Eider Island', n: 1, r: [300, 520] },
  { island: 'Farwatch Island', n: 1, r: [300, 520] },
];
function makeWaters(plan) {
  const H = (x, z) => T.groundHeightAt(x, z);
  const calm = (x, z) => T.calmAt(x, z);
  const rivers = [];
  const report = [];
  for (const src of RIVER_SOURCES) {
    const isl = plan.islands.find((i) => i.name === src.island);
    if (!isl) continue;
    const R = rngT(isl.seed * 31 + Math.round(src.x));
    let x = src.x;
    let z = src.z;
    let dir = Math.atan2(z - isl.cz, x - isl.cx);
    const pts = [[x, z]];
    let ok = false;
    for (let s = 0; s < 600; s++) {
      const g = 60;
      const gx = (H(x + g, z) - H(x - g, z)) / (2 * g);
      const gz = (H(x, z + g) - H(x, z - g)) / (2 * g);
      const out = Math.atan2(z - isl.cz, x - isl.cx);
      const down = Math.hypot(gx, gz) > 0.004 ? Math.atan2(-gz, -gx) : out;
      const blendTo = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
      let want = blendTo(blendTo(dir, down, 0.3), out, 0.28) + Math.sin(s * 0.45 + R() * 0.3) * 0.14;
      let picked = null;
      for (const turn of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.25, -1.25]) {
        const a = want + turn;
        const nx = x + Math.cos(a) * 160;
        const nz = z + Math.sin(a) * 160;
        if (calm(nx, nz) > 0.02) continue;
        if (rivers.some((r) => r.path.some((p) => Math.hypot(p[0] - nx, p[1] - nz) < 900))) continue;
        picked = { a, nx, nz };
        break;
      }
      if (!picked) break;
      dir = picked.a;
      x = picked.nx;
      z = picked.nz;
      pts.push([x, z]);
      if (H(x, z) < -2) {
        // Out into the sea a little, for the mouth.
        pts.push([x + Math.cos(dir) * 200, z + Math.sin(dir) * 200]);
        ok = true;
        break;
      }
    }
    if (!ok || pts.length < 12) {
      report.push(`river from ${src.island} (${src.x}, ${src.z}) gave up after ${pts.length} points`);
      continue;
    }
    // Thin to every other point, then the levels: under the ground, never rising, to the sea.
    const path = pts.filter((p, i) => i % 2 === 0 || i === pts.length - 1);
    const ground = path.map(([px, pz]) => H(px, pz));
    const lv = [];
    for (let i = 0; i < path.length; i++) {
      const prev = i ? lv[i - 1] : ground[0] - 1.5;
      let l = Math.min(prev - 0.02, ground[i] - 1.8);
      lv.push(l);
    }
    const n = path.length;
    for (let i = 0; i < n; i++) lv[i] = i >= n - 2 ? 0 : Math.max(0.4, lv[i]);
    // Keep it falling to the mouth once clamped.
    for (let i = n - 2; i > 0; i--) if (lv[i - 1] < lv[i]) lv[i - 1] = lv[i];
    const total = n - 1;
    rivers.push({
      name: `${src.island} river ${rivers.filter((r) => r.island === src.island).length + 1}`,
      island: src.island,
      halfWidth: src.w[0],
      mouthHalfWidth: src.w[1],
      bank: 230,
      depth: 3.5,
      path: path.map(([px, pz], i) => [Math.round(px), Math.round(pz), Math.round(lv[i] * 10) / 10, Math.round(src.w[0] + (src.w[1] - src.w[0]) * (i / total))]),
    });
  }
  // Rivers carve as wide as their mouths (terrain.js reads halfWidth); the drawn width follows path[i][3].
  for (const r of rivers) r.halfWidth = r.mouthHalfWidth;
  const lakes = [];
  for (const t of LAKE_TRIES) {
    const isl = plan.islands.find((i) => i.name === t.island);
    if (!isl) continue;
    const R = rngT(isl.seed * 97 + 5);
    let made = 0;
    for (let k = 0; k < 600 && made < t.n; k++) {
      const a = R() * Math.PI * 2;
      const d = Math.sqrt(R()) * isl.radius * 0.7;
      const x = Math.round(isl.cx + Math.cos(a) * d);
      const z = Math.round(isl.cz + Math.sin(a) * d);
      const r = Math.round(t.r[0] + R() * (t.r[1] - t.r[0]));
      const reach = r + Math.min(900, isl.radius * 0.12);
      let rim = Infinity;
      let ok = true;
      for (let i = 0; i < 16 && ok; i++) {
        const b = (i / 16) * Math.PI * 2;
        for (const rr of [r * 0.5, r, r + 260, reach]) {
          const px = x + Math.cos(b) * rr;
          const pz = z + Math.sin(b) * rr;
          if (calm(px, pz) > 0.01) ok = false;
          const h = H(px, pz);
          if (h < 6) ok = false;
          if (rr <= r + 260) rim = Math.min(rim, h);
        }
      }
      if (!ok) continue;
      if (rivers.some((rv) => rv.path.some((p) => Math.hypot(p[0] - x, p[1] - z) < reach + 400))) continue;
      if (lakes.some((l) => Math.hypot(l.x - x, l.z - z) < l.r + r + 2500)) continue;
      lakes.push({ name: `${t.island} lake ${made + 1}`, island: t.island, x, z, r, level: Math.round((rim - 2.2) * 10) / 10, depth: 6, bank: 260 });
      made++;
    }
    if (made < t.n) report.push(`lakes on ${t.island}: ${made} of ${t.n}`);
  }
  return { rivers, lakes, report };
}

function measure(plan) {
  const report = [];
  // 1. The natural ground: islands only.
  WATERS = { rivers: [], lakes: [] };
  EXTRA_CALM = [];
  BRIDGES = [];
  const bare0 = dataFrom(plan, plan.airports.map((a) => ({ ...a, elev: 10, pad: { x: a.x, z: a.z } })), [], [], []);
  applyData(bare0);
  // 0. The rivers and lakes, on the relieved ground (they keep out of every calm zone).
  const w = makeWaters(plan);
  WATERS = { rivers: w.rivers, lakes: w.lakes };
  report.push(`waters: ${w.rivers.length} rivers (${w.rivers.map((r) => `${r.name} ${r.path.length} pts, ${(r.path.reduce((s, p, i, a) => s + (i ? Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) : 0), 0) / 1000).toFixed(1)} km`).join('; ')}), ${w.lakes.length} lakes${w.report.length ? ' — ' + w.report.join('; ') : ''}`);
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
    // Which of our maps' airports this field is (worldmap/personas.js): its name with it.
    const persona = PS.personaFor(p.id);
    airports.push({
      ...p,
      ...(persona ? { name: persona.name, from: persona.from, persona: p.id } : {}),
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
    const t = { airport: p.id, name: p.town.name, cx, cz, radius: p.town.radius, count: p.town.count, elev: Math.max(4, Math.round(n.median)) };
    if (p.town.towers) Object.assign(t, { towers: p.town.towers, towerMaxH: p.town.towerMaxH });
    return t;
  });
  // 2b. Villages in the open country of the big islands (road-network.mjs), and their own calm ground.
  const villages = NET.placeVillages({ T, plan, towns, rivers: WATERS.rivers, lakes: WATERS.lakes, airports: plan.airports });
  for (const v of villages) {
    towns.push(v);
    const r = v.radius;
    EXTRA_CALM.push({ x0: v.cx - r * 1.4, x1: v.cx + r * 1.4, z0: v.cz - r * 1.4, z1: v.cz + r * 1.4, blend: 900 });
  }
  report.push(`villages: ${villages.map((v) => `${v.name} (${v.island}, ${v.count})`).join(', ')}`);

  // 3. Flats, then grow each site until its departure layout fits.
  const flatsOf = (aps) => {
    const out = [];
    for (const a of aps) {
      out.push({ id: `rwy-${a.id}`, name: `${a.name} runway`, kind: 'runway', x0: a.x - a.length / 2, x1: a.x + a.length / 2, z0: a.z - a.halfWidth, z1: a.z + a.halfWidth, blend: 4, surface: a.surface || 'tarmac', elev: a.elev, clear: true });
      out.push({ id: `site-${a.id}`, name: a.name, kind: 'airfield', ...a.site, blend: 260, surface: 'grass', elev: a.elev, clear: true });
    }
    for (const t of towns) {
      const r = t.radius;
      out.push({ id: `town-${t.airport || t.name.toLowerCase().replace(/[^a-z]+/g, '-')}`, name: t.name, kind: 'town', x0: t.cx - r * 0.8, x1: t.cx + r * 0.8, z0: t.cz - r * 0.8, z1: t.cz + r * 0.8, blend: 240, surface: 'grass', elev: t.elev, clear: false });
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

  // 4c. The network: every town on an island joined, highways on the big ones, bridges and roundabouts.
  {
    const routes = NET.planRoutes({ plan, towns, airports: aps });
    const walls = (x, z) => {
      for (const a of aps) {
        if (Math.abs(z - a.z) < 750 && Math.abs(x - a.x) < a.length / 2 + 6500) return true;
        const st = a.site;
        if (x > st.x0 - 80 && x < st.x1 + 80 && z > st.z0 - 80 && z < st.z1 + 80) return true;
      }
      for (const l of WATERS.lakes) if (Math.hypot(x - l.x, z - l.z) < l.r + 60) return true;
      return false;
    };
    const net = NET.buildNetwork({ T, plan, routes, rivers: WATERS.rivers, walls });
    // The ground eased round every new road (a corridor of calm), then the profiles on that ground.
    for (const rd of net.roads) {
      const L = rd.line;
      for (let i = 4; i < L.length; i += 4) EXTRA_CALM.push({ ax: L[i - 4][0], az: L[i - 4][1], bx: L[i][0], bz: L[i][1], r: rd.highway ? 40 : 25, blend: 280 });
      if (L.length % 4 !== 1) EXTRA_CALM.push({ ax: L[L.length - 5 > 0 ? L.length - 5 : 0][0], az: L[L.length - 5 > 0 ? L.length - 5 : 0][1], bx: L[L.length - 1][0], bz: L[L.length - 1][1], r: rd.highway ? 40 : 25, blend: 280 });
    }
    for (const g of net.rings) EXTRA_CALM.push({ x0: g.x - g.r - 30, x1: g.x + g.r + 30, z0: g.z - g.r - 30, z1: g.z + g.r + 30, blend: 200 });
    data = dataFrom(plan, aps, flatsOf(aps), roads, towns);
    applyData(data);
    const fin = NET.finishNetwork({ T, net, rivers: WATERS.rivers });
    roads.push(...fin.roads);
    BRIDGES = fin.bridges;
    const km = (r) => r.path.reduce((s2, p, i, a) => s2 + (i ? Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) : 0), 0) / 1000;
    const hw = fin.roads.filter((r) => r.kind === 'highway');
    report.push(`network: ${routes.length} routes (${net.report.join('; ') || 'all routed'}); ${hw.length} highway carriageways ${hw.reduce((s2, r) => s2 + km(r), 0).toFixed(1)} km, ${fin.roads.filter((r) => r.kind === 'road').reduce((s2, r) => s2 + km(r), 0).toFixed(1)} km of country road, ${net.rings.length} roundabouts, ${fin.bridges.length} bridge decks`);
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
  // 6. Each field's own landmarks (worldmap/personas.js): on its level site,
  //    clear of the final layout, the helipad and the road; and on the real
  //    ground near it.
  data = dataFrom(plan, aps, flatsOf(aps), roads, towns);
  applyData(data);
  for (const a of aps) {
    const persona = PS.personaFor(a.id);
    if (!persona) continue;
    const blocked = [{ x0: a.pad.x - 45, x1: a.pad.x + 45, z0: a.pad.z - 45, z1: a.pad.z + 45 }];
    const road = roads.find((r) => r.airport === a.id);
    if (road) {
      for (const [x, z] of road.path) {
        if (x < a.site.x0 || x > a.site.x1 || z < a.site.z0 || z > a.site.z1) continue;
        blocked.push({ x0: x - 40, x1: x + 40, z0: z - 70, z1: z + 70 });
      }
    }
    a.extras = PS.placeExtras(a, persona, blocked);
    a.landmarks = PS.placeLandmarks(a, persona, T.heightAt, a.carrier);
    const want = (persona.extras || []).reduce((n, k) => n + ((PS.EXTRA_SIZES[k] && PS.EXTRA_SIZES[k].count) || 1), 0);
    report.push(`${a.code} ${a.name} (from ${persona.from}): ${a.extras.length}/${want} extras (${a.extras.map((e) => e.kind).join(' ')}), landmarks ${a.landmarks.map((l) => l.kind).join(' ') || 'none'}`);
  }
  data = dataFrom(plan, aps, flatsOf(aps), roads, towns);
  return { data, naturals, layouts, report };
}

/**
 * The data as JSON, one key a line as before, but a list of plain numbers
 * (a road point, a colour) on one line: the network's thousands of points
 * were a number a line, three times the file.
 */
function compactJSON(v) {
  return JSON.stringify(v, null, 1).replace(/\[\s*(-?[\d.e+-]+(?:,\s*-?[\d.e+-]+)*)\s*\]/g, (m, inner) => `[${inner.replace(/\s+/g, '')}]`);
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
export const PREVIEW_DATA = ${compactJSON(data)};
`;
  writeFileSync(join(ROOT, 'src/world/worldmap/preview-data.js'), body);
  console.log('wrote src/world/worldmap/preview-data.js');
}
