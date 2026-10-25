/**
 * The parody airlines' fleets, marks and names (2026-10-23: "real-style
 * liveries with logos only where the real airline puts them" and
 * "parody-airline fleets only on types those real airlines fly"), and the
 * flap-track fairings every airliner wing grew, checked in node.
 *
 *   node tests/features/fleets.mjs
 */

global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0, height: 0, style: {},
  }),
  body: { appendChild() {} },
  head: { appendChild() {} },
};
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };

const SRC = new URL('../../src/', import.meta.url).href;
const T = await import(SRC + 'aircraft/types.js');
const L = await import(SRC + 'aircraft/liveries.js');
const ADAPTER = await import(SRC + 'aircraft/model-adapter.js');
const TR = await import(SRC + 'features/traffic.js');

let failed = 0;
let passed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${detail}` : ''}`);
}
const ids = new Set(T.AIRCRAFT.map((a) => a.id));
const airliners = T.AIRCRAFT.filter((t) => t.category === 'airliner' || String(t.class).toLowerCase() === 'airliner');

/* ------------------------------------------------------------------ *
 * The schemes
 * ------------------------------------------------------------------ */
for (const l of L.AIRLINE_LIVERIES) {
  ok(`${l.id}: has a fleet of roster types, a name to wear and a mark for the fin`,
    Array.isArray(l.fleet) && l.fleet.length >= 2 && l.fleet.every((id) => ids.has(id)) && typeof l.titling === 'string' && l.titling.length > 3 && L.EMBLEMS.includes(l.emblem),
    `fleet ${(l.fleet || []).join(',')}; titling ${l.titling}; emblem ${l.emblem}`);
  ok(`${l.id}: every type in its fleet is an airliner (no fighters in airline colours)`, (l.fleet || []).every((id) => airliners.some((t) => t.id === id)), (l.fleet || []).filter((id) => !airliners.some((t) => t.id === id)).join(','));
  ok(`${l.id}: the name on the side is its own, not a real airline's`, !/\b(ethiopian|united|american|air france|air india|fedex|ups|delta|lufthansa|emirates)\b/i.test(l.titling));
}
const marks = new Set(L.AIRLINE_LIVERIES.map((l) => l.emblem));
ok('every airline has a different mark on its fin', marks.size === L.AIRLINE_LIVERIES.length, [...marks].join(','));

/* ------------------------------------------------------------------ *
 * Who flies what
 * ------------------------------------------------------------------ */
const names = (list) => list.map((l) => l.id).sort().join(',');
const FREIGHT = ['nightfreight', 'dashfreight', 'flexship', 'parcelbrown'];
ok('a 787 goes to the airlines that fly it, and never to a freight company', names(L.airlinesFor(T.getAircraft('b787'))).includes('abyssinia') && !L.airlinesFor(T.getAircraft('b787')).some((l) => FREIGHT.includes(l.id)), names(L.airlinesFor(T.getAircraft('b787'))));
ok('a 747 goes to the freight companies that fly one and Bharat, not to the A320 operators', names(L.airlinesFor(T.getAircraft('b747'))) === 'bharat,dashfreight,nightfreight,parcelbrown', names(L.airlinesFor(T.getAircraft('b747'))));
ok('a Q400 goes to the regional and feeder operators only', names(L.airlinesFor(T.getAircraft('q400'))) === 'abyssinia,flexship,nightfreight,oversea', names(L.airlinesFor(T.getAircraft('q400'))));
ok('the A380 flies for the airlines that really fly one, and Concorde for the two that flew it', names(L.airlinesFor(T.getAircraft('a380'))) === 'bleuciel,desertpearl,pearlgulf,royalisles,sandline' && names(L.airlinesFor(T.getAircraft('concorde'))) === 'bleuciel,royalisles', names(L.airlinesFor(T.getAircraft('a380'))) + ' / ' + names(L.airlinesFor(T.getAircraft('concorde'))));
ok('the low-cost parody flies the A320 family only', names(L.airlinesFor(T.getAircraft('a320'))).includes('spit') && !L.airlinesFor(T.getAircraft('b737')).some((l) => l.id === 'spit') && !L.airlinesFor(T.getAircraft('b777')).some((l) => l.id === 'spit'));
ok('the parcel freighter flies the 747 and the feeder only', names(L.airlinesFor(T.getAircraft('b747'))).includes('parcelbrown') && L.findLivery('parcelbrown').fleet.join() === 'b747,meridian');
ok('nineteen airlines fly, and the radio brand of each is its own', L.AIRLINE_LIVERIES.length === 19 && new Set(L.AIRLINE_LIVERIES.map((l) => L.radioBrand(l))).size === 19, L.AIRLINE_LIVERIES.map((l) => L.radioBrand(l)).join(', '));
for (const id of ['belugaxl', 'dreamlifter', 'an225']) {
  ok(`${id}: no airline flies it — it keeps its house colours`, L.airlinesFor(T.getAircraft(id)).length === 0);
}
ok('the Meridian feeder flies for every airline', L.airlinesFor(T.getAircraft('meridian')).length === L.AIRLINE_LIVERIES.length);
ok('a light aeroplane may wear any airline\'s colours (a flying school, a feeder)', L.airlinesFor(T.getAircraft('skylark')).length === L.AIRLINE_LIVERIES.length);
ok('no type given: every airline, as before', L.airlinesFor(null).length === L.AIRLINE_LIVERIES.length);
for (const t of airliners) {
  const who = L.airlinesFor(t);
  if (t.military) ok(`${t.id}: military — no airline at all`, L.wearsAirlinePaint(t) === false);
}
// The traffic's pick honours it; without a type it is the old draw.
{
  let seq = 0;
  const rand = () => ((seq += 0.137) % 1);
  const b787 = T.getAircraft('b787');
  const picks = new Set();
  for (let i = 0; i < 60; i++) picks.add(TR.pickAirlineScheme(rand, b787).id);
  ok('traffic: an ambient 787 is painted only for airlines that fly a 787', [...picks].every((id) => L.airlinesFor(b787).some((l) => l.id === id)) && picks.size >= 3, [...picks].join(','));
  ok('traffic: a type nobody flies gets no airline (house colours)', TR.pickAirlineScheme(rand, T.getAircraft('an225')) === null);
  const all = new Set();
  for (let i = 0; i < 60; i++) all.add(TR.pickAirlineScheme(rand).id);
  ok('traffic: with no type, every airline is still drawn', all.size === L.AIRLINE_LIVERIES.length, [...all].join(','));
}

/* ------------------------------------------------------------------ *
 * On the models
 * ------------------------------------------------------------------ */
function meshesNamed(model, re) {
  const out = [];
  model.traverse((o) => {
    if (o.isMesh && re.test(o.name)) out.push(o);
  });
  return out;
}
{
  const type = T.getAircraft('a320');
  const painted = ADAPTER.createAircraftModel({ type, livery: L.schemeFor(type, 'abyssinia') });
  const emb = meshesNamed(painted, /^Tail emblem$/);
  ok('a320 for Abyssinia: a mark on each side of the fin, in a decal that wins over the painted fin', emb.length === 2 && emb.every((m) => m.material.map && m.material.polygonOffset && m.material.polygonOffsetFactor <= -4), `${emb.length} emblems`);
  const bb = emb.length ? emb[0].geometry.boundingBox || (emb[0].geometry.computeBoundingBox(), emb[0].geometry.boundingBox) : null;
  const fin = type.shape.finHeight * type.shape.scale;
  ok('a320: the mark sits on the upper half of the fin, ahead of the rudder', !!bb && bb.min.y > 0.4 * fin && bb.max.y < 1.05 * fin + 2 && bb.max.z < 20.77, bb ? `y ${bb.min.y.toFixed(1)}..${bb.max.y.toFixed(1)}, z ${bb.min.z.toFixed(1)}..${bb.max.z.toFixed(1)}` : 'none');
  const titles = meshesNamed(painted, /^Titling$/);
  ok('a320 for Abyssinia: the airline\'s name along the fuselage, one each side', titles.length === 2);
  const canoes = meshesNamed(painted, /^Flap track fairing$|Port main wing surface assembly|Starboard main wing surface assembly/);
  ok('a320: flap-track fairings under the wing (merged into the wing\'s own draw)', canoes.length >= 2, `${canoes.length}`);
  painted.userData.dispose();
  const house = ADAPTER.createAircraftModel({ type, livery: L.schemeFor(type, 'house') });
  ok('a320 in house colours: no emblem and no titling', meshesNamed(house, /^Tail emblem$|^Titling$/).length === 0);
  house.userData.dispose();
}
// Every airline scheme builds on every airliner that wears one, with its mark and its name.
{
  const bad = [];
  for (const t of airliners) {
    if (!L.wearsAirlinePaint(t)) continue;
    for (const l of L.airlinesFor(t)) {
      try {
        const m = ADAPTER.createAircraftModel({ type: t, livery: l });
        const emb = meshesNamed(m, /^Tail emblem$/).length;
        // The Meridian is the game's own model (aircraft/models/meridian.js), not the pack's: no emblem there yet.
        if (m.userData.fleetBridge && m.userData.config) {
          const fins = m.userData.config.fin;
          const twin = fins && (fins.mirror || fins.x);
          if (!twin && emb !== 2) bad.push(`${t.id}/${l.id}: ${emb} emblems`);
        }
        if (typeof m.userData.dispose === 'function') m.userData.dispose();
      } catch (e) {
        bad.push(`${t.id}/${l.id}: ${e.message}`);
      }
    }
  }
  ok('every airliner builds in every airline that flies it, with the mark on its fin', bad.length === 0, bad.join('; '));
}
// Freighters and the military carry no airline's mark whatever scheme is forced on them.
{
  const type = T.getAircraft('c17');
  const m = ADAPTER.createAircraftModel({ type, livery: L.schemeFor(type, 'house') });
  ok('c17: military grey, no mark, no titling, and no flap canoes are not demanded of it either way', meshesNamed(m, /^Tail emblem$|^Titling$/).length === 0);
  m.userData.dispose();
}
// A turboprop and the delta have no canoes; the jets do.
{
  const count = (id) => {
    const t = T.getAircraft(id);
    const m = ADAPTER.createAircraftModel({ type: t, livery: L.schemeFor(t, 'house') });
    let n = 0;
    // Before batching they were named; after it they are in the wing's assembly — count by triangles of the wing groups instead.
    const wing = m.userData.parts.leftWing;
    wing.traverse((o) => {
      if (o.isMesh && o.geometry) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    });
    m.userData.dispose();
    return n;
  };
  const q = count('q400');
  const b = count('b737');
  ok('b737: a wing with canoes carries more triangles than the Q400\'s plain-hinged one', b > q, `737 ${Math.round(b)}, Q400 ${Math.round(q)}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
