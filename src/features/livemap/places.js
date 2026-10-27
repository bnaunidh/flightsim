/**
 * What the live map draws and what DIRECT TO can pick, for whichever map is
 * loaded: one shape for every map, read from the data the world is built
 * from (read only — nothing here builds or moves anything).
 *
 *   airports   { id, code, name, place, kind, x, z, elev, hdg, runways[], cls, region, layout? }
 *   heliports  { id, name, x, z, kind }
 *   towns      { id, name, x, z, r }
 *   islands    { id, name, x, z, r, region }  (the ones that are islands, not hills on one)
 *   regions    { id, name, x, z }
 *   roads      { name, pts: [[x, z]...], kind: 'road' | 'highway' }
 *   fixes      geo.js makeFixes
 *   zones      the control zones (airspace): { id, field, name, freq, x, z, r }
 *
 * The World Map preview reads PREVIEW (worldmap/preview-data.js); every other
 * map its own airport (terrain.js AIRPORT, both runways), the outlying strip
 * if it has one, the carrier if one is out, the pads, the town and the
 * islands. Each field gets a four-letter code (the preview's own, or one made
 * from the map's name: X + three letters) and a radio frequency.
 */

import { AIRPORT, MAP, ISLANDS, FLATS } from '../../world/terrain.js';
import { PADS } from '../../world/pads.js';
import { PREVIEW, WORLD_PREVIEW_ID } from '../../world/worldmap/preview.js';
import { airportLayout } from '../../world/airport-layout.js';
import { makeFixes, originFor } from './geo.js';

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A field's approach frequency: 118.00-135.95 MHz in 50 kHz steps, from its id. */
export function freqFor(id) {
  const k = hash(`freq:${id}`) % 360;
  return (118 + k * 0.05).toFixed(2);
}

/** "Kestrel Island" → "XKST": X and three letters of the first word (consonants first). */
export function codeFor(name, used = new Set()) {
  const w = String(name || 'Field').toUpperCase().replace(/[^A-Z ]/g, '').split(/\s+/).filter(Boolean);
  const first = w[0] || 'FIELD';
  const cons = first.slice(1).replace(/[AEIOU]/g, '');
  const tries = [first[0] + cons.slice(0, 2), first.slice(0, 3), first[0] + (w[1] || first).slice(0, 2), first[0] + cons.slice(-2)];
  for (const t of tries) {
    const c = `X${(t + 'XXX').slice(0, 3)}`;
    if (!used.has(c)) {
      used.add(c);
      return c;
    }
  }
  for (let i = 0; i < 26; i++) {
    const c = `X${first.slice(0, 2)}${String.fromCharCode(65 + i)}`;
    if (!used.has(c)) {
      used.add(c);
      return c;
    }
  }
  return 'XXXX';
}

/** Runway designators for a heading: 90 → "09/27". */
export function idents(hdg) {
  const a = Math.round((((hdg % 360) + 360) % 360) / 10) || 36;
  const b = ((a + 17) % 36) + 1;
  return `${String(Math.min(a, b)).padStart(2, '0')}/${String(Math.max(a, b)).padStart(2, '0')}`;
}

/** Size class for the runway symbol: 4 heavy, 3 international, 2 regional, 1 strip. */
export function sizeClass(lengthM, kind) {
  let c = lengthM >= 3000 ? 4 : lengthM >= 2000 ? 3 : lengthM >= 1200 ? 2 : 1;
  if (kind === 'hub') c = Math.max(c, 3);
  return c;
}

/** Control zone radius by class, metres. */
export function zoneRadius(cls, kind) {
  if (kind === 'carrier') return 6000;
  return cls >= 4 ? 16000 : cls === 3 ? 14000 : cls === 2 ? 10000 : 6000;
}

const firstWord = (s) => String(s || '').split(/\s+/)[0] || 'Kestrel';

function previewPlaces() {
  const P = PREVIEW;
  const used = new Set();
  const airports = (P.airports || []).map((a) => {
    const hdg = Number.isFinite(a.headingDeg) ? a.headingDeg : 90;
    const cls = sizeClass(a.length, a.kind);
    if (a.code) used.add(a.code);
    return {
      id: a.id, code: a.code || codeFor(a.name, used), name: a.name, place: a.place, kind: a.kind || 'strip', region: a.region || null,
      x: a.x, z: a.z, elev: a.elev || 0, hdg, cls, surface: a.surface || 'tarmac',
      runways: [{ cx: a.x, cz: a.z, length: a.length, width: (a.halfWidth || 15) * 2, hdg, ident: idents(hdg) }],
      site: a.site || null, ref: a,
    };
  });
  const heliports = (P.heliports || []).map((h) => ({ id: h.id, name: h.name, x: h.x, z: h.z, kind: h.kind || 'ground', role: h.role || null }));
  const towns = (P.towns || []).map((t, i) => ({ id: `town:${t.name || i}`, name: t.name, x: t.cx, z: t.cz, r: t.radius || 400 }));
  const roads = (P.roads || []).map((r) => ({ name: r.name || '', kind: r.kind === 'highway' || r.highway ? 'highway' : 'road', pts: (r.path || []).map((q) => [q[0], q[1]]) }));
  const { islands, hills } = splitIslands(P.islands || []);
  const regions = (P.regions || []).map((r) => ({ id: r.id, name: r.name, x: r.cx, z: r.cz, blurb: r.blurb || '' }));
  return { airports, heliports, towns, roads, islands, hills, regions, flats: P.flats || [] };
}

/** The islands that are islands: an "island" whose middle sits inside a bigger one is a hill range on it. */
export function topIslands(list) {
  return splitIslands(list).islands;
}

/** { islands, hills }: the hill ranges (the shapes inside a bigger island) apart, for the map's smaller labels. */
export function splitIslands(list) {
  const sorted = list.filter((i) => i && Number.isFinite(i.cx)).slice().sort((a, b) => b.radius - a.radius);
  const islands = [];
  const hills = [];
  for (const i of sorted) {
    const on = islands.find((o) => Math.hypot(o.x - i.cx, o.z - i.cz) < o.r * 0.92);
    const rec = { id: `isl:${i.name}`, name: i.name, x: i.cx, z: i.cz, r: i.radius, region: i.region || null };
    if (on) hills.push({ ...rec, id: `hill:${i.name}`, on: on.id });
    else islands.push(rec);
  }
  return { islands, hills };
}

function mapPlaces(sim) {
  const used = new Set();
  const A = AIRPORT || {};
  const R = A.runway || { cx: 0, cz: 0, length: 1100, halfWidth: 17 };
  const hdg = Number.isFinite(A.headingDeg) ? A.headingDeg : 90;
  const nm = String((MAP && MAP.name) || 'Kestrel Island');
  const fieldName = /\b(Airport|International|Air ?Base|Airfield|Field|Station)\b/i.test(nm) ? nm : `${firstWord(nm)} Airfield`;
  const runways = [{ cx: R.cx, cz: R.cz, length: R.length, width: (R.halfWidth || 17) * 2, hdg, ident: idents(hdg) }];
  if (A.runway2) {
    const r2 = A.runway2;
    const h2 = Number.isFinite(r2.headingDeg) ? r2.headingDeg : 180;
    runways.push({ cx: r2.cx, cz: r2.cz, length: r2.length, width: (r2.halfWidth || 15) * 2, hdg: h2, ident: idents(h2) });
  }
  let layout = null;
  try {
    layout = airportLayout();
  } catch (e) {
    layout = null;
  }
  const longest = Math.max(...runways.map((r) => r.length));
  const kind = longest >= 2400 ? 'hub' : 'regional';
  const airports = [{
    id: 'main', code: codeFor(fieldName, used), name: fieldName, place: (ISLANDS[0] && ISLANDS[0].name) || nm, kind,
    x: R.cx, z: R.cz, elev: A.elev || 0, hdg, cls: sizeClass(longest, kind), runways, layout, region: null,
  }];
  const o = MAP && MAP.outpost;
  if (o) {
    const isl = (ISLANDS || []).slice().sort((a, b) => Math.hypot(a.cx - o.cx, a.cz - o.cz) - Math.hypot(b.cx - o.cx, b.cz - o.cz))[0];
    const name = `${isl ? firstWord(isl.name) : 'Outpost'} Strip`;
    airports.push({
      id: 'outpost', code: codeFor(name, used), name, place: isl ? isl.name : '', kind: 'strip', x: o.cx, z: o.cz, elev: Number.isFinite(o.elev) ? o.elev : 0,
      hdg: 90, cls: 1, runways: [{ cx: o.cx, cz: o.cz, length: (o.halfLen || 200) * 2, width: Math.min(30, (o.halfWidth || 20) * 2), hdg: 90, ident: '09/27' }], region: null, surface: 'grass',
    });
  }
  const heliports = (PADS || []).filter((p) => p && p.pos).map((p) => ({ id: `pad:${p.id}`, name: p.name || 'Helipad', x: p.pos.x, z: p.pos.z, kind: p.kind || 'ground', role: p.role || null }));
  const towns = [];
  const T = MAP && MAP.scenery && MAP.scenery.town;
  if (T && Number.isFinite(T.cx)) towns.push({ id: 'town:main', name: T.name || `${firstWord(nm)} Town`, x: T.cx, z: T.cz, r: T.radius || 400 });
  const roads = ((MAP && MAP.waters && MAP.waters.roads) || []).map((r, i) => ({ name: r.name || `road ${i + 1}`, kind: r.halfWidth >= 30 ? 'highway' : 'road', pts: (r.path || []).map((p) => [p[0], p[1]]) }));
  const { islands, hills } = splitIslands(ISLANDS || []);
  return { airports, heliports, towns, roads, islands, hills, regions: [], flats: FLATS || [] };
}

/**
 * Everything for this map. Cheap enough to call once per open; the carrier
 * (it moves) is read live by the map each frame through `carrierOf(sim)`.
 */
export function collectPlaces(sim) {
  const isPreview = !!(MAP && MAP.id === WORLD_PREVIEW_ID);
  const base = isPreview ? previewPlaces() : mapPlaces(sim);
  const mapId = (MAP && MAP.id) || 'kestrel';
  const fields = base.airports.map((a) => ({ id: a.id, x: a.x, z: a.z, hdg: a.hdg, halfLen: (a.runways[0] && a.runways[0].length / 2) || 800 }));
  const fixes = makeFixes(mapId, fields, { reserved: base.airports.map((a) => a.code), minGap: isPreview ? 9000 : 5000 });
  const zones = base.airports.map((a) => ({ id: `zone:${a.id}`, field: a.id, name: `${firstWord(a.name)} Approach`.toUpperCase(), freq: freqFor(`${mapId}:${a.id}`), x: a.x, z: a.z, r: zoneRadius(a.cls, a.kind) }));
  // The world square the chart covers: every island, a margin of sea, square.
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  const isl = isPreview ? PREVIEW.islands || [] : ISLANDS || [];
  for (const i of isl) {
    x0 = Math.min(x0, i.cx - i.radius * 1.4);
    x1 = Math.max(x1, i.cx + i.radius * 1.4);
    z0 = Math.min(z0, i.cz - i.radius * 1.4);
    z1 = Math.max(z1, i.cz + i.radius * 1.4);
  }
  for (const a of base.airports) {
    x0 = Math.min(x0, a.x - 4000);
    x1 = Math.max(x1, a.x + 4000);
    z0 = Math.min(z0, a.z - 4000);
    z1 = Math.max(z1, a.z + 4000);
  }
  if (!Number.isFinite(x0)) {
    x0 = -12000;
    x1 = 12000;
    z0 = -12000;
    z1 = 12000;
  }
  const pad = isPreview ? 8000 : 3000;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const half = Math.max(x1 - x0, z1 - z0) / 2 + pad;
  return {
    mapId, isPreview, origin: originFor(mapId), title: isPreview ? 'World Map — Preview' : String((MAP && MAP.name) || 'Map'),
    ...base, fixes, zones,
    // What the map opens on: every island (the content), and the square the tiles cover (a margin more).
    extent: { x0: cx - half + pad, x1: cx + half - pad, z0: cz - half + pad, z1: cz + half - pad },
    box: { x0: cx - half * 1.15, z0: cz - half * 1.15, size: half * 2.3 },
  };
}

/** The carrier, if one is out: { x, z, hdg } (it moves, so read it each frame). */
export function carrierOf(sim) {
  const c = sim && sim.carrier && sim.carrier.group;
  if (!c || !c.visible || !c.position) return null;
  return { x: c.position.x, z: c.position.z, hdg: ((-(c.rotation ? c.rotation.y : 0) * 180) / Math.PI + 360) % 360 };
}

/** Everything DIRECT TO can pick, as waypoints. */
export function pickables(P) {
  const out = [];
  for (const a of P.airports) out.push({ id: `apt:${a.id}`, name: a.code, long: a.name, x: a.x, z: a.z, kind: 'airport', ref: a.id });
  for (const f of P.fixes) out.push({ id: f.id, name: f.name, long: f.role === 'approach' ? 'approach fix' : 'en-route fix', x: f.x, z: f.z, kind: 'fix' });
  for (const t of P.towns) out.push({ id: t.id, name: t.name, long: 'town', x: t.x, z: t.z, kind: 'town' });
  for (const h of P.heliports) out.push({ id: h.id, name: h.name, long: 'heliport', x: h.x, z: h.z, kind: 'heliport' });
  return out;
}

/** A waypoint by what was typed: a fix, an airport code or name, a town, a heliport (case does not matter). */
export function findPlace(P, text) {
  const t = String(text || '').trim().toUpperCase();
  if (!t) return null;
  const all = pickables(P);
  return all.find((w) => w.name.toUpperCase() === t)
    || all.find((w) => (w.long || '').toUpperCase() === t)
    || all.find((w) => w.kind !== 'fix' && (w.long || w.name).toUpperCase().startsWith(t) && t.length >= 3)
    || all.find((w) => w.name.toUpperCase().startsWith(t) && t.length >= 3)
    || null;
}
