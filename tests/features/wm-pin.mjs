/**
 * World Map — the pin, checked in node (src/world/worldmap/pin.js).
 *
 *   /opt/homebrew/bin/node tests/features/wm-pin.mjs           one line per check
 *   /opt/homebrew/bin/node tests/features/wm-pin.mjs --quiet   failures and the summary
 *
 * On the World Map's real height field (terrain.js with the preview applied):
 *   - a pin stays inside the sea, whatever was tapped
 *   - a pin on or right by a field is that field; a little further is not
 *   - the goal is the nearest field the aircraft can use
 *   - the start clears the ground: at sea, on land, on the highest ground on
 *     the map, at the sea's corners, aeroplane and helicopter, against a
 *     finer search than the one the start itself makes
 *   - the nose is on the goal, at a speed over the stall
 *   - past the sea (worldmap/pin-far.js): a pin reaches the land's end and never
 *     the void; every aircraft's start is under what it can hold and has a clear
 *     run, from a grid of pins, every corner and the highest peak; the weak are
 *     moved and told so, the strong are not; the same pin gives the same start
 * And, from the source: the map is fetched only when opened, the pin belongs
 * to the flight that asked for it, the ring stays out of what loads before the
 * World Map, and the offline list has the new files.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const src = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const quiet = process.argv.includes('--quiet');

let passed = 0;
let failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++;
  else failed++;
  if (!pass || !quiet) console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
};

global.window = global.window || { addEventListener() {}, removeEventListener() {} };
global.document = global.document || { createElement: () => ({ style: {}, appendChild() {} }), body: { appendChild() {} }, documentElement: { classList: { toggle() {} } } };

const T = await import(new URL('../../src/world/terrain.js', import.meta.url).href);
const P = await import(new URL('../../src/world/worldmap/preview.js', import.meta.url).href);
const Pin = await import(new URL('../../src/world/worldmap/pin.js', import.meta.url).href);
T.applyMap(P.previewDef());
const { PIN, clampPin, fieldAt, goalFor, pinStart, pinWords, roughHeightAt } = Pin;

/* ---- the sea's edge ---- */
const box = P.seaBox();
for (const [x, z] of [[-1e7, -1e7], [1e7, -1e7], [-1e7, 1e7], [1e7, 1e7], [0, 1e9]]) {
  const c = clampPin(x, z);
  ok(`edge: (${x}, ${z}) comes back inside the sea`, c.x >= box.x0 + PIN.insetM - 1e-6 && c.x <= box.x1 - PIN.insetM + 1e-6 && c.z >= box.z0 + PIN.insetM - 1e-6 && c.z <= box.z1 - PIN.insetM + 1e-6, `${Math.round(c.x)}, ${Math.round(c.z)}`);
}
{
  const c = clampPin(1234, -987);
  ok('edge: a pin inside the sea is not moved', c.x === 1234 && c.z === -987);
}

/* ---- at a field ---- */
for (const a of P.AIRPORTS) {
  ok(`field: a pin on ${a.code} is ${a.code}`, fieldAt(a.x, a.z) === a);
  ok(`field: just past ${a.code}'s runway end is still ${a.code}`, fieldAt(a.x + a.length / 2 + PIN.fieldM - 10, a.z) === a);
  ok(`field: 400 m further out is not a field`, fieldAt(a.x + a.length / 2 + PIN.fieldM + 400, a.z) === null);
}

/* ---- the goal ---- */
{
  const gul = P.airportById('gull');
  ok('goal: the nearest field with no limit', goalFor(gul.x + 2000, gul.z + 2000) === gul);
  const long = goalFor(gul.x + 2000, gul.z + 2000, (a) => a.length >= 2000);
  ok('goal: a type that needs 2,000 m is not sent to the 580 m strip', long !== gul && long.length >= 2000, long.code);
  ok('goal: when nothing fits, still the nearest', goalFor(gul.x + 2000, gul.z + 2000, () => false) === gul);
}

/* ---- the start ---- */
function worstAround(p, reach, ahead) {
  // Finer than pinStart's own search: a 100 m square round the pin, then a ribbon along the way.
  let top = -Infinity;
  for (let dx = -reach; dx <= reach; dx += 100) for (let dz = -reach; dz <= reach; dz += 100) if (Math.hypot(dx, dz) <= reach) top = Math.max(top, T.heightAt(p.x + dx, p.z + dz));
  const h = (p.headingDeg * Math.PI) / 180;
  for (let d = 0; d <= ahead; d += 50) for (const s of [-100, 0, 100]) top = Math.max(top, T.heightAt(p.x + Math.sin(h) * d + Math.cos(h) * s, p.z - Math.cos(h) * d + Math.sin(h) * s));
  return top;
}
// The highest ground on the map, found the slow way.
let peak = { h: -Infinity, x: 0, z: 0 };
for (let x = box.x0; x <= box.x1; x += 400) {
  for (let z = box.z0; z <= box.z1; z += 400) {
    const h = T.heightAt(x, z);
    if (h > peak.h) peak = { h, x, z };
  }
}
ok('start: the map has real high ground to test on', peak.h > 200, `${Math.round(peak.h)} m at ${Math.round(peak.x)}, ${Math.round(peak.z)}`);
const land = P.PREVIEW.islands[0];
const spots = {
  'open sea': { x: 40000, z: -40000 },
  land: { x: land.cx + 2600, z: land.cz + 2600 },
  'the highest ground': { x: peak.x, z: peak.z },
  'the south-east corner': clampPin(1e7, 1e7),
  'the north-west corner': clampPin(-1e7, -1e7),
};
for (const [name, pin] of Object.entries(spots)) {
  const goal = goalFor(pin.x, pin.z);
  for (const rotor of [false, true]) {
    const who = rotor ? 'helicopter' : 'aeroplane';
    const s = pinStart(T.heightAt, pin, goal, { rotor, stallMs: 40 });
    const top = Math.max(0, worstAround(s, rotor ? PIN.reachRotorM : PIN.reachM, rotor ? PIN.aheadRotorM : PIN.aheadM));
    // The margin is what the start asked for, less what a coarser search can miss between its samples.
    const need = (rotor ? PIN.clearRotorM : PIN.clearM) * 0.7;
    ok(`start: ${name}, ${who}, clears the ground`, Number.isFinite(s.y) && s.y - top >= need, `y ${Math.round(s.y)}, ground ${Math.round(top)}`);
    ok(`start: ${name}, ${who}, nose on ${goal.code}`, Math.abs(((s.headingDeg - P.headingTo(pin.x, pin.z, goal.x, goal.z) + 540) % 360) - 180) < 1e-6);
  }
}
{
  const s = pinStart(T.heightAt, spots['open sea'], goalFor(40000, -40000), { stallMs: 60 });
  ok('start: an aeroplane flies well over its stall', s.speed >= 60 * 1.4, `${s.speed} m/s`);
  const low = pinStart(T.heightAt, spots['open sea'], goalFor(40000, -40000), { stallMs: 10 });
  ok('start: never crawling', low.speed >= PIN.minMs);
  ok('start: a helicopter at its own speed, whatever the stall sum says', pinStart(T.heightAt, spots['open sea'], goalFor(40000, -40000), { rotor: true, stallMs: 60 }).speed === PIN.rotorMs);
}

/* ---- the words ---- */
{
  const sea = pinWords(40000, -40000, -60);
  ok('words: sea', /sea/i.test(sea.where) && /XFHD/.test(sea.title), `${sea.title} / ${sea.where}`);
  const l = pinWords(40000, -40000, 120);
  ok('words: land', /land/i.test(l.where), l.where);
  const hub = P.airportById('haven');
  const on = pinWords(hub.x, hub.z, 13);
  ok('words: on a field names it and says the usual start', on.field === hub && /usual/.test(on.note), on.note);
  ok('words: not known yet is said calmly', /Checking/.test(pinWords(40000, -40000, null).where));
  ok('words: the stand-in height field is sea far out, land on an island', roughHeightAt(box.x0, box.z0) < 0 && roughHeightAt(land.cx, land.cz) > 0);
}

/* ---- past the sea ---- */
const F = await import(new URL('../../src/world/worldmap/farlands.js', import.meta.url).href);
const Far = await import(new URL('../../src/world/worldmap/pin-far.js', import.meta.url).href);
{
  const { clampFar, zoneOf, farStart, holdM, FAR_PIN } = Far;
  const d = P.previewDef();
  d.farlands = true;
  d._outer = F.FARLANDS;
  T.applyMap(d);
  const land = (c) => T.heightAt(c.x, c.z) > -99 && F.wanderOf(c.x, c.z) <= F.edgeAt(c.x, c.z) - FAR_PIN.edgeM + 1e-6;
  const reach = [];
  for (let a = 0; a < 16; a++) reach.push([Math.sin((a * Math.PI) / 8) * 1e7, Math.cos((a * Math.PI) / 8) * 1e7]);
  reach.push([1e7, 1e7], [-1e7, 1e7], [1e7, -1e7], [-1e7, -1e7], [F.CHART_HALF, 12], [0, F.CHART_HALF - 1]);
  for (const [x, z] of reach) {
    const c = clampFar(x, z);
    ok(`far: a tap at (${Math.round(x)}, ${Math.round(z)}) comes back to land`, land(c), `${Math.round(c.x)}, ${Math.round(c.z)}, D ${Math.round(F.wanderOf(c.x, c.z))} of ${Math.round(F.edgeAt(c.x, c.z))}`);
    ok('far: and it is out past the range', F.wanderOf(c.x, c.z) > F.RANGE_DEEP);
  }
  const inFar = { x: F.SEA_HALF + 90000, z: 10000 };
  ok('far: a pin on the land is not moved', clampFar(inFar.x, inFar.z).x === inFar.x && clampFar(inFar.x, inFar.z).z === inFar.z);
  ok('far: a pin on the sea is not moved', clampFar(1234, -987).x === 1234);
  ok('far: nonsense comes back to the sea, not NaN', clampFar(0, 0).x === 0);

  ok('zone: the sea has none', zoneOf(40000, -40000) === null);
  ok('zone: the Border Range', zoneOf(F.SEA_HALF + 20000, 10000) === 'The Border Range');
  ok('zone: the Farlands', zoneOf(inFar.x, inFar.z) === 'The Farlands');
  ok('zone: the Edge', zoneOf(F.SEA_HALF + F.EDGE_D - 4000, 10000) === 'The Edge', zoneOf(F.SEA_HALF + F.EDGE_D - 4000, 10000));
  const said = pinWords(inFar.x, inFar.z, 2000, 'The Farlands');
  ok('words: the readout names the zone', said.where === 'The Farlands' && /Farlands/.test(said.short) && /canyon/.test(said.note), `${said.where} / ${said.short}`);

  // The highest ground of all, the slow way.
  let top = { h: -1, x: 0, z: 0 };
  for (let x = -F.CHART_HALF; x <= F.CHART_HALF; x += 1500) {
    for (let z = -F.CHART_HALF; z <= F.CHART_HALF; z += 1500) {
      const h = T.heightAt(x, z);
      if (h > top.h) top = { h, x, z };
    }
  }
  ok('peaks: the ring has what the brief says', top.h > 9000 && top.h < F.PEAK_MAX, `${Math.round(top.h)} m`);
  const TYPES = { skylark: [14000, false, 25], r44: [14000, true, 0], courier: [18500, false, 30], harrier: [23000, true, 0], q400: [27000, false, 44], a380: [43000, false, 60], f22: [65000, false, 42] };
  const pins = [top, clampFar(1e7, 1e7), clampFar(-1e7, 1e7), clampFar(1e7, -1e7), clampFar(-1e7, -1e7), { x: F.SEA_HALF + 20000, z: 0 }];
  for (let x = -250000; x <= 250000; x += 50000) for (let z = -250000; z <= 250000; z += 50000) if (F.depthOf(x, z) > -6000) pins.push(clampFar(x, z));
  /** The ground ahead of a start, finer than the start's own search: `run` metres on, 80 m lanes. */
  const ahead = (s, run) => {
    let g = T.heightAt(s.x, s.z);
    const h = (s.headingDeg * Math.PI) / 180;
    for (let m = 0; m <= run; m += 40) for (const lane of [-80, 0, 80]) g = Math.max(g, T.heightAt(s.x + Math.sin(h) * m + Math.cos(h) * lane, s.z - Math.cos(h) * m + Math.sin(h) * lane));
    return g;
  };
  for (const [id, [ft, rotor, stallMs]] of Object.entries(TYPES)) {
    const ceilingM = ft * 0.3048;
    let over = 0;
    let hit = 0;
    let moved = 0;
    let lost = 0;
    let same = 0;
    let worst = null;
    let most = 0;
    for (const pin of pins) {
      const goal = goalFor(pin.x, pin.z);
      const s = farStart(T.heightAt, pin, goal, { rotor, stallMs, ceilingM });
      if (s.y > holdM(ceilingM, rotor) + 1) over++;
      // 12 s at the start's speed, and a 35 kt crosswind's worth of nothing else.
      const g = ahead(s, Math.max(800, s.speed * 12));
      if (s.y - g < (rotor ? 90 : 150)) {
        hit++;
        worst = { x: Math.round(s.x), z: Math.round(s.z), y: Math.round(s.y), g: Math.round(g), where: s.where };
      }
      if (T.heightAt(s.x, s.z) < -99) lost++;
      if (s.movedM > 0) moved++;
      if (s.movedM > most) most = s.movedM;
      const again = farStart(T.heightAt, pin, goal, { rotor, stallMs, ceilingM });
      if (again.x === s.x && again.z === s.z && again.y === s.y && again.headingDeg === s.headingDeg) same++;
    }
    ok(`far ${id}: never above what it can hold`, over === 0, `${over} of ${pins.length}`);
    ok(`far ${id}: every start has clear air ahead`, hit === 0, worst ? JSON.stringify(worst) : `${pins.length} pins`);
    ok(`far ${id}: never over the void`, lost === 0);
    ok(`far ${id}: the same pin gives the same start (Restart)`, same === pins.length);
    if (ft <= 20000) ok(`far ${id}: moved from the pins it cannot reach, not far`, moved > 0 && most < 40000, `${moved} moved, at most ${Math.round(most / 1000)} km`);
    // The tallest spikes (11.4 km, not the 10.3 the design says) are over an A380's 36,500 ft: it steps aside, no more.
    if (ft >= 43000) ok(`far ${id}: strong enough to stay, bar a step off the tallest spikes`, moved <= 2 && most < 6000, `${moved} moved, ${Math.round(most)} m`);
  }
  const weak = farStart(T.heightAt, top, goalFor(top.x, top.z), { stallMs: 25, ceilingM: 4267 });
  ok('far: a Skylark on the highest peak is moved, and says where to', weak.movedM > 0 && !!weak.where && weak.y < 4000, `${Math.round(weak.movedM / 1000)} km, ${weak.where}, ${Math.round(weak.y)} m`);
  // High ground this type can clear: a spot of about 9 km.
  let peaks = { h: -1 };
  for (let x = -F.CHART_HALF; x <= F.CHART_HALF; x += 3100) {
    for (let z = -F.CHART_HALF; z <= F.CHART_HALF; z += 3100) {
      const h = T.heightAt(x, z);
      if (h > 8000 && h < 9400 && h > peaks.h) peaks = { h, x, z };
    }
  }
  const big = farStart(T.heightAt, peaks, goalFor(peaks.x, peaks.z), { stallMs: 60, ceilingM: 13100 });
  ok('far: the A380 over the Stacks stays, over the top', big.movedM === 0 && big.y > peaks.h, `${Math.round(big.y)} m over ${Math.round(peaks.h)} m`);
  ok('far: thin air needs more speed for the same wing', big.speed > pinStart(T.heightAt, { x: 40000, z: -40000 }, goalFor(40000, -40000), { stallMs: 60 }).speed * 1.5, `${Math.round(big.speed)} m/s`);
  const heli = farStart(T.heightAt, top, goalFor(top.x, top.z), { rotor: true, ceilingM: 4267 });
  ok('far: a helicopter deep in it keeps its own speed', heli.speed === PIN.rotorMs && heli.movedM > 0, `${heli.where}`);
  const sea = farStart(T.heightAt, { x: 40000, z: -40000 }, goalFor(40000, -40000), { stallMs: 25, ceilingM: 4267 });
  ok('far: at sea it is the sea\'s start', sea.movedM === 0 && sea.x === 40000 && sea.z === -40000 && sea.where === null);
  T.applyMap(P.previewDef());
}

/* ---- from the source ---- */
const wp = src('src/features/world-preview.js');
const pinMap = src('src/features/wm-pin.js');
ok('source: the map is fetched when it is opened, not with the features', /import\('\.\/wm-pin\.js'\)/.test(wp) && !/^import .*wm-pin/m.test(wp) && !/wm-pin/.test(src('src/features/index.js')));
ok('source: the pin map has its own worker, not the live map\'s shared one', /new Worker\(new URL\('\.\/livemap\/chart-worker\.js'/.test(pinMap) && /worker\.terminate\(\)/.test(pinMap));
ok('source: a flight is only moved when it asked for a pin', /o\.pin && o\.airborne/.test(wp));
ok('source: main.js is untouched by the pin (first-load bytes)', !/\bpin\b/i.test(src('src/main.js').replace(/spin|pinch|ping|\bpinned\b/gi, '')));
const statics = (t) => [...t.matchAll(/^(?:import|export)\s[^'"\n]*from\s+'([^']+)'/gm)].map((m) => m[1]);
ok('source: the ring stays out of what loads with the features', !statics(wp).concat(statics(src('src/world/worldmap/pin.js'))).some((f) => /farlands|pin-far/.test(f)));
ok('source: the ring comes with farlands-run.js and the pin\'s map', statics(src('src/features/farlands-run.js')).some((f) => /pin-far/.test(f)) && statics(pinMap).some((f) => /pin-far/.test(f)));
const sw = src('sw.js');
ok('source: the offline list has the new files', sw.includes("'src/features/wm-pin.js'") && sw.includes("'src/world/worldmap/pin.js'") && sw.includes("'src/world/worldmap/pin-far.js'"));

/* ---- the pin's map on a phone ---- */
{
  const W = 351;
  const H = 582;
  const s = Math.min(W, H) / (F.CHART_HALF * 2);
  const at = (l) => ({ name: l.name, x: W / 2 + l.x * s, y: H / 2 + l.z * s, w: l.name.length * 6 });
  const codes = P.AIRPORTS.map((a) => ({ name: a.code, x: W / 2 + a.x * s, y: H / 2 + a.z * s - 8, w: 30 }));
  const all = F.FARLANDS.labels.map(at);
  const fit = Far.namesThatFit(all, W, H, codes);
  const clash = fit.some((a, i) => fit.some((b, j) => i < j && Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < 14));
  ok('phone: the ring\'s names never run into each other', fit.length > 0 && !clash, `${fit.length} of ${all.length}`);
  ok('phone: none is cut by the map\'s edge', fit.every((b) => b.x - b.w / 2 >= 0 && b.x + b.w / 2 <= W));
  ok('phone: none lies on a field\'s code', !fit.some((a) => codes.some((b) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < 14)));
  ok('phone: on a wide map they all fit', Far.namesThatFit(F.FARLANDS.labels.map((l) => ({ name: l.name, x: 1500 + l.x / 200, y: 1500 + l.z / 200, w: l.name.length * 6 })), 3000, 3000).length === all.length);
  ok('phone: held sideways the map keeps the height, the words go beside it', /@media \(max-width: 560px\), \(orientation: portrait\)/.test(src('src/features/wm-pin.js')));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
