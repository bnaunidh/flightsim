/**
 * Node checks for the control zones (src/features/livemap/airspace.js). Run:
 *
 *   node tests/features/airspace.mjs [--verbose]
 *
 *   - every field on Kestrel, Gateway and the World Map preview has a zone
 *     with a name (HAVEN APPROACH) and a frequency, sized by the field
 *   - the watch: the zone you start in is known, not announced; flying out
 *     says leave, flying into another says enter (from where), only after
 *     1.5 s; the edge does not flicker (out at 1.08 of the radius); between
 *     two overlapping zones the clearly nearer middle takes over
 *   - the check-in call reads like one: "level 5,000", "climbing through
 *     3,200"; the approach controller's subtitle names the zone's field
 *   - the radio card shows the frequency, the live map rings the zones
 *
 * Exits non-zero if anything fails.
 */

global.document = global.document || {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0, height: 0, style: {},
  }),
  body: { appendChild() {} },
};
if (typeof globalThis.localStorage === 'undefined') {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
}
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const SRC = new URL('src/', ROOT).href;
const VERBOSE = process.argv.includes('--verbose');
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail: String(detail) });
  if (!pass || VERBOSE) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

await import(SRC + 'features/index.js');
const AS = await import(SRC + 'features/livemap/airspace.js');
const PL = await import(SRC + 'features/livemap/places.js');
const T = await import(SRC + 'world/terrain.js');
const M = await import(SRC + 'world/maps.js');
const PV = await import(SRC + 'world/worldmap/preview.js');

for (const id of ['kestrel', 'gateway', PV.WORLD_PREVIEW_ID]) {
  if (id === PV.WORLD_PREVIEW_ID) M.registerExtraMap(PV.previewDef());
  T.applyMap(id);
  const P = PL.collectPlaces({});
  const good = P.zones.length === P.airports.length && P.zones.every((z) => / APPROACH$/.test(z.name) && /^1[1-3]\d\.\d\d$/.test(z.freq));
  const sized = P.airports.every((a) => {
    const z = P.zones.find((q) => q.field === a.id);
    return z && (a.cls >= 3 ? z.r >= 14000 : a.cls === 2 ? z.r === 10000 : z.r === 6000);
  });
  ok(`${id}: a control zone for every field, named and on its own frequency, sized by the field`, good && sized, P.zones.map((z) => `${z.name} ${z.freq} ${z.r / 1000} km`).join('; '));
}

/* ---------------- the watch ---------------- */
{
  const A = { id: 'zone:a', field: 'a', name: 'HOME APPROACH', freq: '119.20', x: 0, z: 0, r: 10000 };
  const B = { id: 'zone:b', field: 'b', name: 'FAR APPROACH', freq: '124.05', x: 30000, z: 0, r: 6000 };
  const C = { id: 'zone:c', field: 'c', name: 'NEAR APPROACH', freq: '121.30', x: 14000, z: 0, r: 8000 };
  const w = new AS.AirspaceWatch([A, B]);
  w.prime(0, 0);
  const evs = [];
  const fly = (x0, x1, dt = 0.25, v = 80) => {
    const n = Math.ceil(Math.abs(x1 - x0) / (v * dt));
    for (let i = 0; i <= n; i++) {
      const e = w.update(dt, x0 + ((x1 - x0) * i) / n, 0);
      if (e) evs.push(`${e.type}:${e.zone.name}`);
    }
  };
  fly(0, 5000);
  ok('the zone you start in is known, not announced', evs.length === 0 && w.cur === A, evs.join(' '));
  fly(5000, 18000);
  fly(18000, 30000);
  ok('flying out: leave HOME; flying into the next: enter FAR', evs.join(' ') === 'leave:HOME APPROACH enter:FAR APPROACH', evs.join(' '));
  evs.length = 0;
  for (let k = 0; k < 30; k++) {
    const e = w.update(0.5, 30000 - 6000 * (k % 2 ? 1.04 : 0.98), 0);
    if (e) evs.push(e.type);
  }
  ok('its edge does not flicker (out only past 1.08 of the radius)', evs.length === 0, evs.join(' '));
  const w2 = new AS.AirspaceWatch([A, B]);
  w2.prime(25000, 0);
  const brief = [];
  for (const x of [24000, 23000, 24000, 23000]) {
    const e = w2.update(0.5, x, 0);
    if (e) brief.push(e.type);
  }
  ok('a second across a boundary is not a crossing (1.5 s)', brief.length === 0, brief.join(' '));
  const w3 = new AS.AirspaceWatch([A, C]);
  w3.prime(6000, 0);
  const ov = [];
  for (let x = 6000; x <= 14000; x += 100) {
    const e = w3.update(0.25, x, 0);
    if (e) ov.push(`${e.type}:${e.zone.name}:${Math.round(x)}`);
  }
  ok('two zones that overlap: the clearly nearer middle takes over, once', ov.length === 1 && /enter:NEAR APPROACH/.test(ov[0]), ov.join(' '));
}

/* ---------------- the words ---------------- */
ok('the check-in: "level 5,000", "climbing through 3,200", "descending through 2,400"', AS.levelWords(4980, 50) === 'level 5,000' && AS.levelWords(3210, 900) === 'climbing through 3,200' && AS.levelWords(2390, -700) === 'descending through 2,400',
  [AS.levelWords(4980, 50), AS.levelWords(3210, 900), AS.levelWords(2390, -700)].join(' / '));
const ATC = await import(SRC + 'audio/atc.js');
ATC.setApproachField('Haven');
const lbl = ATC.voiceLabel('approach');
ATC.setApproachField(null);
ok('in a zone the approach controller\'s subtitle names its field (HAVEN APPROACH, not "Island Approach")', lbl === 'Haven Approach' && ATC.voiceLabel('approach') === 'Island Approach', `${lbl} / ${ATC.voiceLabel('approach')}`);
const ps = readFileSync(new URL('src/features/pilot-systems.js', ROOT), 'utf8');
ok('the radio card shows the frequency of the zone you are in', /ps-freq/.test(ps) && /sim\.airspace\.label\(\)/.test(ps), '');
const rd = readFileSync(new URL('src/features/livemap/render.js', ROOT), 'utf8');
ok('the live map draws every zone as a faint dashed ring, the one you are in brighter', /P\.zones/.test(rd) && /setLineDash\(\[6, 5\]\)/.test(rd) && /st\.zone/.test(rd), '');

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
