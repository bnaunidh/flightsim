/**
 * Node checks for Fun Stuff and the Wildfire disaster. Plain node:
 *
 *   node tests/features/fun.mjs
 *
 *   1. The Wildfire disaster is on the list you can arm, in the random pool,
 *      and does nothing (and says nothing) when there is no fire to start.
 *   2. The stars on every map: ten in the sky and ten on the water, never
 *      inside a hill, never on top of each other, sea ones on real sea, the
 *      same every time; ten on the roads where there are roads.
 *   3. The stunts, flown with made-up attitudes: each one scores, a steep
 *      turn is not a loop, a landing is not a low pass, holding a stunt is
 *      one stunt, quick ones make a combo, a crash ends it.
 *   4. The stickers and the smoke colours they unlock; the save.
 *   5. The plug-in registers itself and survives being loaded without a page.
 */

// fx.js and wildfire's modules paint small textures on import.
globalThis.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};

const root = new URL('../../src/', import.meta.url);
const imp = (p) => import(new URL(p, root).href);

const D = await imp('game/disasters.js');
// The Wildfire disaster is the crashes team's (features/wildfire-disaster.js registers it).
await imp('features/wildfire-disaster.js');
const S = await imp('features/fun/stars.js');
const { StuntMeter, STUNTS, COMBO_WINDOW } = await imp('features/fun/stunts.js');
const K = await imp('features/fun/stickers.js');
const V = await imp('features/fun/save.js');
const T = await imp('world/terrain.js');
const { MAPS } = await imp('world/maps.js');
const R = await imp('world/roads.js');

let passed = 0;
let failed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

/* ---- 1. the disaster -------------------------------------------------- */
{
  const ev = D.findEvent('wildfire');
  ok('disaster: Wildfire is a natural disaster', !!ev && ev.name === 'Wildfire');
  ok('disaster: …you can arm it before a flight', D.SELECTABLE_EVENTS.some((e) => e.id === 'wildfire'));
  ok('disaster: …and Randomised disasters can pick it', D.poolForMap(MAPS[0]).some((e) => e.id === 'wildfire'));
  ok('disaster: its hint says what to do (water, X)', /water/i.test(ev.hint) && /\bX\b/.test(ev.hint), ev.hint);
  // How it starts, and that it never starts in a mission, is tested in crashes.mjs with the implementation.
}

/* ---- 2. the stars ----------------------------------------------------- */
const spread = (list) => {
  let min = Infinity;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) min = Math.min(min, Math.hypot(list[i].x - list[j].x, list[i].z - list[j].z));
  return min;
};
const clearance = (s) => {
  let top = Math.max(0, T.heightAt(s.x, s.z));
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    top = Math.max(top, T.heightAt(s.x + Math.sin(ang) * 15, s.z + Math.cos(ang) * 15));
  }
  return s.y - top;
};
const badAir = [];
const badSea = [];
const shortSets = [];
for (const m of MAPS) {
  T.applyMap(m.id);
  const w = { map: T.MAP, heightAt: T.heightAt, airport: T.AIRPORT, harbour: T.harbourMouth(), start: { x: 0, z: 0 } };
  const air = S.placeStars('air', w);
  const sea = S.placeStars('sea', w);
  if (air.length !== 10 || sea.length !== 10) shortSets.push(`${m.id} air ${air.length} sea ${sea.length}`);
  for (const s of air) if (clearance(s) < 8) badAir.push(`${m.id} ${s.what} ${clearance(s).toFixed(1)} m`);
  for (const s of sea) if (!(T.heightAt(s.x, s.z) < -2.5) || s.y < 1 || s.y > 5) badSea.push(`${m.id} (${Math.round(s.x)}, ${Math.round(s.z)}) depth ${(-T.heightAt(s.x, s.z)).toFixed(1)}`);
  if (m.id === 'kestrel') {
    ok('stars: the same stars every time on the same map', JSON.stringify(air) === JSON.stringify(S.placeStars('air', w)));
    ok('stars: every star has its own id', new Set(air.map((s) => s.id)).size === air.length);
    ok('stars: they are spread out, 300 m apart or more', spread(air) >= 300 && spread(sea) >= 300, `air ${Math.round(spread(air))} m, sea ${Math.round(spread(sea))} m`);
    ok('stars: one is low over the runway, for a low pass', air.some((s) => s.what === 'low over the runway' && Math.abs(s.x - T.AIRPORT.runway.cx) < 1));
    const h = T.harbourMouth();
    ok('stars: the first boat star is just outside the harbour', sea[0] && Math.hypot(sea[0].x - h.x, sea[0].z - h.z) < 1000, sea[0] && `${Math.round(Math.hypot(sea[0].x - h.x, sea[0].z - h.z))} m`);
  }
}
ok(`stars: ten in the sky and ten on the water on all ${MAPS.length} maps`, shortSets.length === 0, shortSets.join('; '));
ok('stars: no sky star is inside a hill or nearer than 8 m to the ground', badAir.length === 0, badAir.slice(0, 6).join('; '));
ok('stars: every boat star floats on real sea (deeper than 2.5 m)', badSea.length === 0, badSea.slice(0, 6).join('; '));
{
  T.applyMap('drovers');
  const { roads } = R.buildRoads(T.MAP);
  const road = S.placeStars('road', { map: T.MAP, heightAt: T.heightAt, airport: T.AIRPORT, roads, start: { x: T.AIRPORT.runway.cx, z: T.AIRPORT.runway.cz } });
  ok("stars: ten on Drover's Flat's roads", road.length === 10, `${road.length}`);
  // On a road's centreline (the one by the start may be where the road
  // meets the apron, which onRoad() counts as the pad, not the road).
  const off = road.filter((s) => !(R.distanceToRoads(roads, s.x, s.z, 40) <= 1));
  ok('stars: …every one of them on a road', off.length === 0, off.map((s) => `(${Math.round(s.x)}, ${Math.round(s.z)})`).join(' '));
  ok('stars: …a car height above it', road.every((s) => Math.abs(s.y - T.heightAt(s.x, s.z) - 2.2) < 0.01));
  ok('stars: …spread out along the network', spread(road) >= 250, `${Math.round(spread(road))} m`);
  ok('stars: no roads, no car stars (and no crash)', S.placeStars('road', { map: T.MAP, heightAt: T.heightAt, roads: [] }).length === 0);
}
{
  const s = { x: 100, y: 50, z: 100 };
  ok('stars: flying through one catches it', S.catches('air', s, { x: 110, y: 55, z: 95 }));
  ok('stars: …flying past 40 m off does not', !S.catches('air', s, { x: 140, y: 50, z: 100 }));
  ok('stars: a car has to drive over its road star', S.catches('road', { x: 0, y: 2.2, z: 0 }, { x: 4, y: 0.6, z: 3 }) && !S.catches('road', { x: 0, y: 2.2, z: 0 }, { x: 14, y: 0.6, z: 0 }));
  ok('stars: games hunt their own set', S.starSetFor('flight') === 'air' && S.starSetFor('heli') === 'air' && S.starSetFor('boat') === 'sea' && S.starSetFor('car') === 'road');
}

/* ---- 3. the stunts ---------------------------------------------------- */
const DT = 1 / 30;
function fly(seconds, frame, m = new StuntMeter()) {
  const got = [];
  for (let t = 0; t < seconds; t += DT) for (const e of m.update(DT, frame(t))) got.push({ ...e });
  return { got, m };
}
const base = (o) => ({ craft: 'plane', airborne: true, height: 400, speed: 55, rollRate: 0, pitchRate: 0, upY: 1, noseY: 0, heading: 90, crashed: false, ...o });
{
  const r = fly(4, () => base({ rollRate: 1.9, upY: 0.4 }));
  ok('stunts: a full roll is a BARREL ROLL', r.got.length === 1 && r.got[0].id === 'roll' && r.got[0].points === 200, JSON.stringify(r.got.map((e) => e.id)));
  const half = fly(4, (t) => base({ rollRate: t < 1.5 ? 1.9 : -1.9 }));
  ok('stunts: rolling half way and back is not one', half.got.length === 0);
  const ground = fly(4, () => base({ rollRate: 1.9, airborne: false, height: 0 }));
  ok('stunts: nothing counts on the ground', ground.got.length === 0);
  // A loop: pitch round at 20 degrees a second, nose and wings following.
  const loop = fly(19, (t) => {
    const th = 0.35 * t;
    return base({ pitchRate: 0.35, noseY: Math.sin(th), upY: Math.cos(th) });
  });
  ok('stunts: a loop over the top is a LOOP', loop.got.some((e) => e.id === 'loop'), JSON.stringify(loop.got.map((e) => e.id)));
  // A steep level turn pulls the nose round a long way, but never over the top.
  const turn = fly(60, () => base({ pitchRate: 0.3, upY: 0.5, noseY: 0.02 }));
  ok('stunts: a steep turn, round and round, is never a loop', !turn.got.some((e) => e.id === 'loop'), JSON.stringify(turn.got.map((e) => e.id)));
  const upside = fly(20, () => base({ upY: -0.95 }));
  ok('stunts: upside down for 20 s is ONE upside down', upside.got.filter((e) => e.id === 'upside').length === 1);
  const flip = fly(12, (t) => base({ upY: t % 6 < 3.5 ? -0.95 : 0.95 }));
  ok('stunts: …right way up and over again is another', flip.got.filter((e) => e.id === 'upside').length === 2, JSON.stringify(flip.got.map((e) => e.id)));
  const side = fly(3, () => base({ upY: 0.05 }));
  ok('stunts: on your side for 2 s is SIDEWAYS', side.got.length === 1 && side.got[0].id === 'sideways');
  const slowSide = fly(3, () => base({ upY: 0.05, speed: 12 }));
  ok('stunts: …but not hanging there at stalling speed', slowSide.got.length === 0);
  // Low pass: down low and fast, then climb away.
  const pass = fly(8, (t) => base({ height: t < 1 ? 60 : t < 4 ? 6 : 40, speed: 60 }));
  ok('stunts: low and fast, then climbing away, is a LOW PASS', pass.got.length === 1 && pass.got[0].id === 'low');
  const landing = fly(8, (t) => base({ height: t < 1 ? 60 : Math.max(0, 8 - t), speed: 42, airborne: t < 7 }));
  ok('stunts: a fast landing is not a low pass', landing.got.length === 0, JSON.stringify(landing.got.map((e) => e.id)));
  const heli = fly(12, (t) => base({ craft: 'heli', speed: 1, height: 30, heading: (t * 45) % 360 }));
  ok('stunts: a helicopter turning on the spot is a SPIN', heli.got.length === 1 && heli.got[0].id === 'spin', JSON.stringify(heli.got.map((e) => e.id)));
  const heliFwd = fly(12, (t) => base({ craft: 'heli', speed: 30, height: 60, heading: (t * 45) % 360 }));
  ok('stunts: …but not one flying circles at speed', heliFwd.got.length === 0);
  const car = fly(10, (t) => base({ craft: 'car', airborne: false, speed: 8, heading: (t * 60) % 360 }));
  ok('stunts: a car turning a full circle is a DONUT', car.got.some((e) => e.id === 'donut'));
  const parked = fly(10, (t) => base({ craft: 'car', airborne: false, speed: 0, heading: (t * 60) % 360 }));
  ok('stunts: …standing still does not count', parked.got.length === 0);
  const jump = fly(3, (t) => base({ craft: 'car', airborne: t > 0.5 && t < 1.5, speed: 20 }));
  ok('stunts: a second in the air in the car is BIG AIR', jump.got.length === 1 && jump.got[0].id === 'air');
  const hop = fly(3, (t) => base({ craft: 'car', airborne: t > 0.5 && t < 0.8, speed: 20 }));
  ok('stunts: …a bump is not', hop.got.length === 0);
  // Combo: two stunts inside the window pay double.
  const m = new StuntMeter();
  fly(4, () => base({ rollRate: 1.9 }), m);
  const second = fly(4, () => base({ rollRate: 1.9 }), m);
  ok('stunts: a second stunt straight after is a COMBO ×2 at double points', second.got[0] && second.got[0].combo === 2 && second.got[0].points === 400, JSON.stringify(second.got));
  fly(COMBO_WINDOW + 1, () => base({}), m);
  const later = fly(4, () => base({ rollRate: 1.9 }), m);
  ok('stunts: …after a pause the combo starts again', later.got[0] && later.got[0].combo === 1);
  ok('stunts: the flight total adds them all up', m.total === 200 + 400 + 200, `${m.total}`);
  fly(4, () => base({ rollRate: 1.9 }), m);
  m.update(DT, base({ crashed: true }));
  const after = fly(4, () => base({ rollRate: 1.9 }), m);
  ok('stunts: a crash ends the combo', after.got[0] && after.got[0].combo === 1);
  ok('stunts: every stunt has a name and points', Object.values(STUNTS).every((s) => /!$/.test(s.name) && s.points > 0));
}

/* ---- 4. stickers, colours, the save ---------------------------------- */
{
  const ids = K.STICKERS.map((s) => s.id);
  ok(`stickers: ${K.STICKERS.length} stickers, every one with its own id`, new Set(ids).size === ids.length && ids.length >= 20);
  ok('stickers: every one says how to get it, in one short line', K.STICKERS.every((s) => s.emoji && s.name && s.how && s.how.length <= 60), K.STICKERS.filter((s) => s.how.length > 60).map((s) => s.id).join(', '));
  const d = V.blankFun();
  const open = () => K.SMOKE_COLOURS.filter((c) => K.colourUnlocked(d, c)).map((c) => c.id).join(',');
  ok('colours: a new player has white smoke', open() === 'white');
  d.stickers['first-star'] = '2026-09-29';
  d.stickers.roll = '2026-09-29';
  d.stickers.loop = '2026-09-29';
  ok('colours: three stickers open red and blue', open() === 'white,red,blue', open());
  d.stickers['star-map'] = '2026-09-29';
  ok('colours: Star Champion opens gold', open().includes('gold'));
  d.smoke.color = 'rainbow';
  ok('colours: a locked colour flies as white', K.activeColour(d).id === 'white');
  ok('colours: each says what unlocks it', K.SMOKE_COLOURS.every((c) => K.colourNeeds(c).length > 2));

  const mem = new Map();
  const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
  d.stars['flight:kestrel'] = ['1:2', '3:4'];
  d.stars['boat:sennen'] = ['5:6'];
  ok('save: it saves', V.saveFun(d, store));
  const back = V.loadFun(store);
  ok('save: …and loads back the same', JSON.stringify(back) === JSON.stringify(d));
  ok('save: counts stars everywhere and the maps they were on', V.totalStars(back) === 3 && V.mapsWithStars(back) === 2);
  mem.set(V.FUN_KEY, '{not json');
  ok('save: a broken save starts fresh instead of throwing', JSON.stringify(V.loadFun(store)) === JSON.stringify(V.blankFun()));
  mem.set(V.FUN_KEY, JSON.stringify({ stickers: { roll: 'x' } }));
  const partial = V.loadFun(store);
  ok('save: an old save missing fields gets them', partial.stickers.roll === 'x' && partial.stunts.best && partial.smoke.color === 'white');
  ok('save: no storage at all is fine', V.saveFun(d, null) === false && V.loadFun(null).v === 1);
}

/* ---- 5. the plug-in ---------------------------------------------------- */
{
  const ext = await imp('game/extensions.js');
  let err = null;
  try {
    await imp('features/fun.js');
  } catch (e) {
    err = e;
  }
  ok('plug-in: features/fun.js loads without a page', !err, err && err.message);
  const st = ext.extStatus().find((e) => e.id === 'fun');
  ok('plug-in: it registers as "fun"', !!st && st.live);
  const reg = ext.extensions().find((e) => e.id === 'fun');
  ok('plug-in: …with the hooks it needs', reg && ['install', 'buildWorld', 'startMode', 'stop', 'update', 'key'].every((h) => typeof reg[h] === 'function'));
  const idx = (await import('node:fs')).readFileSync(new URL('features/index.js', root), 'utf8');
  ok('plug-in: it is listed in features/index.js', /import '\.\/fun\.js';/.test(idx));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
