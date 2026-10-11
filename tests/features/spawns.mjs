/**
 * Node checks for the spawn data and resolver (src/world/spawns.js):
 *
 *   node tests/features/spawns.mjs            every map
 *   node tests/features/spawns.mjs gateway    one map
 *
 * No page. For every one of the 30 maps, the real airfield is built the way
 * main.js builds it (Airport + Apron with a stub scene, so the obstacle boxes
 * and the airport's own parked aeroplanes are real) and the pads are built,
 * then every class — airliner, light, military, heli, water, open — is
 * resolved with a representative type and the answer is checked:
 *
 *   - a finite point, with a heading, that is CLEAR under the rule in
 *     spawns.js (clearReasons() is empty for it);
 *   - within 1 m of the surface its kind needs: the ground or a deck for a
 *     land start, sea level over 3 m of water for the water class, 60 m or
 *     more up for the hover start;
 *   - a nose-in stand start puts the nose NOSE_STOP ± 0.5 m short of the line;
 *   - a fallback (the runway, because nothing else fitted) is allowed, but it
 *     is LISTED in the output, with what was tried and why it was refused.
 *
 * Then the classifier over the whole roster, the picker's lists (Auto first,
 * the runway last, never more than six), and the map overrides the plan
 * names (a gate on Gateway, the carrier on Task Force Resolute, the
 * flight line on Ironhead, a pad on every heli map).
 *
 * Exits 1 if anything fails.
 */

globalThis.document = globalThis.document || {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
  head: { appendChild() {} },
};
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };

const src = new URL('../../src/', import.meta.url).href;
const THREE = await import(src + 'vendor/three.module.js');
const TR = await import(src + 'world/terrain.js');
const AP = await import(src + 'world/airport.js');
const APR = await import(src + 'world/apron.js');
const AL = await import(src + 'world/airport-layout.js');
const PD = await import(src + 'world/pads.js');
const { MAPS } = await import(src + 'world/maps.js');
const TYPES = await import(src + 'aircraft/types.js');
const SP = await import(src + 'world/spawns.js');

const only = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const quiet = process.argv.includes('--quiet');

let passed = 0;
let failed = 0;
const fails = [];
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else {
    failed++;
    fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
  }
  if (!quiet || !pass) console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${detail}` : ''}`);
}

function loadMap(id) {
  TR.applyMap(id);
  AP.refreshRunways();
  APR.refreshApronElevation();
  TR.clearObstacles();
  TR.clearPlatforms();
  const scene = { add() {} };
  new AP.Airport(scene);
  new APR.Apron(scene, 'high');
  PD.buildPads(new THREE.Group());
}

/* ------------------------------------------------------------------ */
/* 1. The classifier                                                   */
/* ------------------------------------------------------------------ */

{
  const want = {
    harrier: 'heli', a320: 'airliner', b747: 'airliner', a380: 'airliner', meridian: 'airliner',
    f22: 'military', fa18: 'military', f35b: 'military', nightjar: 'military', vanguard: 'military', osprey: 'military',
    skylark: 'light', courier: 'light', tempest: 'light', massimo: 'light', tpose: 'light',
  };
  for (const [id, cls] of Object.entries(want)) {
    const t = TYPES.AIRCRAFT.find((a) => a.id === id);
    if (!t) continue;
    ok(`class: ${id} is ${cls}`, SP.spawnClassOf(t) === cls, SP.spawnClassOf(t));
  }
  ok('class: a floats flag is the water class', SP.spawnClassOf({ class: 'Tourer', floats: true }) === 'water');
  ok('class: a 100 m span is the open class', SP.spawnClassOf({ class: 'Airliner-ish', plan: { span: 100 } }) === 'open');
  ok('class: a huge flag is the open class', SP.spawnClassOf({ class: 'Tourer', huge: true }) === 'open');
  ok('class: nothing at all is light', SP.spawnClassOf(null) === 'light');
}

/* ------------------------------------------------------------------ */
/* 2. Every map × every class                                          */
/* ------------------------------------------------------------------ */

/** A representative type per class — the water and open classes have no type yet. */
const REP = {
  heli: 'harrier',
  airliner: 'a320',
  military: 'f22',
  water: 'skylark',
  open: 'a380',
  light: 'skylark',
};
const fallbacks = [];
const maps = MAPS.filter((m) => !only || m.id === only);
ok('30 maps to check', only ? maps.length === 1 : maps.length === 30, `${maps.length}`);

const D2R = Math.PI / 180;
for (const m of maps) {
  loadMap(m.id);
  const lay = AL.airportLayout();
  for (const cls of SP.CLASSES) {
    const type = TYPES.AIRCRAFT.find((a) => a.id === REP[cls]);
    const r = SP.resolveSpawn(m.id, cls, { type, ctx: { layout: lay, traffic: [] } });
    const name = `${m.id} × ${cls}`;
    const finite = Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.z) && Number.isFinite(r.headingDeg);
    ok(`${name}: resolves to a finite point`, finite, JSON.stringify({ x: r.x, y: r.y, z: r.z, h: r.headingDeg }));
    if (!finite) continue;
    const reasons = SP.clearReasons({ x: r.x, z: r.z, headingDeg: r.headingDeg, kind: r.kind, span: r.span, stand: null, agl: r.agl }, { traffic: [] });
    ok(`${name}: the point is clear (${r.kind}, ${r.label})`, reasons.length === 0, reasons.join('; '));
    // Within a metre of the surface its kind needs.
    if (r.kind === 'water') {
      ok(`${name}: on the water, over 3 m of it`, Math.abs(r.y) <= 1 && TR.heightAt(r.x, r.z) <= -3, `y ${r.y.toFixed(1)}, depth ${(-TR.heightAt(r.x, r.z)).toFixed(1)}`);
    } else if (r.kind === 'hover') {
      ok(`${name}: airborne, 60 m or more up`, r.agl >= 60 && r.y >= 60, `agl ${r.agl}`);
    } else if (r.kind === 'carrier') {
      ok(`${name}: on the carrier's deck height`, Math.abs(r.y - (TR.platformAt(r.x, r.z) ? TR.platformAt(r.x, r.z).y : r.y)) <= 1, `y ${r.y.toFixed(1)}`);
    } else {
      const p = TR.platformAt(r.x, r.z);
      const surf = p ? p.y : TR.heightAt(r.x, r.z);
      ok(`${name}: within 1 m of the ${p ? 'deck' : 'ground'}`, Math.abs(r.y - surf) <= 1, `y ${r.y.toFixed(1)} surface ${surf.toFixed(1)}`);
    }
    // Nose-in: the nose NOSE_STOP short of the line.
    if (r.kind === 'stand' && r.standId) {
      const st = lay.stands.find((s) => s.id === r.standId);
      const size = SP.sizeOf(type);
      const h = r.headingDeg * D2R;
      const fx = Math.sin(h);
      const fz = -Math.cos(h);
      const tipX = r.x + fx * -size.nose;
      const tipZ = r.z + fz * -size.nose;
      const short = (st.noseX - tipX) * fx + (st.noseZ - tipZ) * fz;
      ok(`${name}: nose-in, the nose ${AL.NOSE_STOP} m short of the line`, Math.abs(short - AL.NOSE_STOP) <= 0.5, `${short.toFixed(2)} m short, on ${st.id}`);
      ok(`${name}: the stand fits it`, AL.standFits(st, size.span, size.length), `${st.id} ${st.size} maxSpan ${st.maxSpan}`);
    }
    if (r.fallback) fallbacks.push(`${name}: ${r.label} (${r.why}); tried ${r.tried.map((t) => `${t.label || JSON.stringify(t.ref)}: ${t.why}`).join(' | ') || 'nothing else named here'}`);
  }

  /* the picker */
  for (const cls of SP.CLASSES) {
    const type = TYPES.AIRCRAFT.find((a) => a.id === REP[cls]);
    const ch = SP.spawnChoices(m.id, cls, { type, ctx: { layout: lay } });
    ok(`${m.id} × ${cls}: picker has 2-6 entries, Auto first, the runway last`,
      ch.length >= 2 && ch.length <= 6 && ch[0].id === 'auto' && ch[ch.length - 1].id === 'runway',
      ch.map((c) => c.id).join(','));
  }
}

/* ------------------------------------------------------------------ */
/* 3. The overrides the plan names                                     */
/* ------------------------------------------------------------------ */

function pick(mapId, cls, typeId, choice = 'auto') {
  if (TR.MAP.id !== mapId) loadMap(mapId);
  const type = TYPES.AIRCRAFT.find((a) => a.id === typeId);
  return SP.resolveSpawn(mapId, cls, { type, choice, ctx: { layout: AL.airportLayout(), traffic: [] } });
}
if (!only || only === 'gateway') {
  const a = pick('gateway', 'airliner', 'a320');
  ok('gateway: an A320 starts on a contact stand with a bridge', a.kind === 'stand' && /Gate/.test(a.label) && !a.fallback, `${a.label} ${a.why}`);
  const j = pick('gateway', 'airliner', 'b747');
  ok('gateway: a 747 starts on a heavy gate', j.kind === 'stand' && !j.fallback && AL.airportLayout().stands.find((s) => s.id === j.standId).size === 'heavy', `${j.label} ${j.why}`);
  const g = pick('gateway', 'airliner', 'a320', 'gate');
  ok('gateway: the Gate choice is a gate', g.kind === 'stand' && !g.fallback, g.label);
  const rw = pick('gateway', 'airliner', 'a320', 'runway');
  ok('gateway: the Runway choice is today\'s start, not a fallback', rw.kind === 'runway' && !rw.fallback && Math.abs(rw.x - (AP.RUNWAY.thresholdWest.x + 80)) < 0.01, `${rw.x} ${rw.fallback}`);
  const ch = SP.spawnChoices('gateway', 'airliner', { type: TYPES.AIRCRAFT.find((t) => t.id === 'a320') });
  ok('gateway: the airliner picker offers the gate', ch.some((c) => c.id === 'gate'), ch.map((c) => c.id).join(','));
  // Random Auto stays among the clear gates.
  const seen = new Set();
  for (let i = 0; i < 20; i++) seen.add(pick('gateway', 'airliner', 'a320').standId);
  const rnd = SP.resolveSpawn('gateway', 'airliner', { type: TYPES.AIRCRAFT.find((t) => t.id === 'a320'), random: () => 0.99, ctx: { layout: AL.airportLayout(), traffic: [] } });
  ok('gateway: Auto with a random pick still lands on a clear gate', rnd.kind === 'stand' && !rnd.fallback, rnd.label);
  // Traffic on a stand makes it not clear.
  const first = pick('gateway', 'airliner', 'a320');
  const blocked = SP.resolveSpawn('gateway', 'airliner', { type: TYPES.AIRCRAFT.find((t) => t.id === 'a320'), ctx: { layout: AL.airportLayout(), traffic: [{ pos: { x: first.x, z: first.z }, span: 36, callsign: 'Island 1' }] } });
  ok('gateway: a stand with traffic on it is skipped for the next', blocked.standId && blocked.standId !== first.standId && !blocked.fallback, `${first.standId} -> ${blocked.standId}`);
}
if (!only || only === 'airbase') {
  const f = pick('airbase', 'military', 'f22');
  ok('airbase: a fighter starts on the flight line', f.kind === 'base' && !f.fallback, `${f.label} ${f.why}`);
  const a = pick('airbase', 'airliner', 'a320');
  ok('airbase: an A320 gets a medium remote stand', a.kind === 'stand' && !a.fallback, `${a.label} ${a.why}`);
  const j = pick('airbase', 'airliner', 'b747');
  ok('airbase: a 747 falls back to the runway, and says so', j.kind === 'runway' && j.fallback, `${j.label} ${j.why}`);
}
if (!only || only === 'northwatch') {
  const f = pick('northwatch', 'military', 'f35b', 'pad:hover1');
  ok('northwatch: the F-35B may start on hover pad 1', f.kind === 'pad' && f.padId === 'hover1' && !f.fallback, `${f.label} ${f.why}`);
}
if (!only || only === 'carriergroup') {
  const f = pick('carriergroup', 'military', 'fa18');
  ok('carriergroup: a Hornet starts on the carrier (handed to carrier-ops)', f.kind === 'carrier' && f.handoff === 'carrier', `${f.label}`);
  const h = pick('carriergroup', 'heli', 'harrier', 'pad:hospital');
  ok('carriergroup: the hospital ship deck is a helicopter start', h.kind === 'pad' && h.padId === 'hospital', `${h.label} ${h.why}`);
}
if (!only || only === 'rigs') {
  const h = pick('rigs', 'heli', 'harrier');
  ok('rigs: a helicopter starts at the shore base', h.kind === 'pad' && h.padId === 'field', `${h.label}`);
  const fl = pick('rigs', 'heli', 'harrier', 'pad:flotel');
  ok('rigs: the Flotel is on offer', fl.kind === 'pad' && fl.padId === 'flotel', fl.label);
}
if (!only || only === 'meridian') {
  const h = pick('meridian', 'heli', 'harrier');
  ok('meridian: a helicopter starts at the plaza', h.kind === 'pad' && h.padId === 'plaza', `${h.label}`);
}
if (!only || only === 'stacks') {
  const h = pick('stacks', 'heli', 'harrier');
  ok('stacks: Flat Rock Rescue first', h.kind === 'pad' && h.padId === 'hospital', `${h.label}`);
}
if (!only || only === 'ravencrag') {
  const h = pick('ravencrag', 'heli', 'harrier');
  ok('ravencrag: Corrie Rescue Station first', h.kind === 'pad' && h.padId === 'hospital', `${h.label}`);
}
if (!only || only === 'kestrel') {
  const s = pick('kestrel', 'light', 'skylark');
  ok('kestrel: a Skylark starts on a stand or in a hangar, not the runway', (s.kind === 'stand' || s.kind === 'hangar') && !s.fallback, `${s.label} ${s.why}`);
  const m = pick('kestrel', 'military', 'f22');
  ok('kestrel: a jet starts on the carrier', m.kind === 'carrier', m.label);
}

/* ------------------------------------------------------------------ */

console.log('\nFallbacks (allowed, listed):');
for (const f of fallbacks) console.log('  ' + f);
if (!fallbacks.length) console.log('  none');
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log(fails.map((f) => '  FAIL ' + f).join('\n'));
  process.exit(1);
}
