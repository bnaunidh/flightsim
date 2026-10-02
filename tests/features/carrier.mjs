/**
 * Node checks for carrier ops. Run with plain node:
 *
 *   node tests/features/carrier.mjs
 *
 * No page: the deck's geometry (features/carrier/deck.js), the arresting gear
 * and the catapult (carrier/gear.js), Paddles and the grade (carrier/lso.js),
 * who has a hook (carrier/who.js) and where the ship anchors on every map
 * (world/carrier-berth.js) are pure numbers on purpose, and this runs them.
 *
 *   1. The deck: four wires at the real 12.2 m across the angled deck, the
 *      3-wire just past the lens's touchdown point, the catapults on the bow
 *      pointing off it, the lens on the port edge, the pattern's marks.
 *   2. The glideslope and the ball.
 *   3. The wire: every speed stops in 2-3 s and 50-110 m, ~100 m at 140 kt.
 *   4. The catapult: zero to flying speed in about two seconds, every jet.
 *   5. Paddles: an on-speed pass gets "Roger ball" and nothing else; a low
 *      one "You're low" then "Power"; hook up gets "Check your hook" and a
 *      wave-off; the grades for a 3-wire, a 1-wire, a bolter, a wave-off.
 *   6. Who has a hook: every military jet but the F-35B; no civil type.
 *   7. The berth on every map: deep water under the whole deck, clear of
 *      every runway's approach lanes, in sight of the field — and moved out
 *      of the way when a map grows a third runway across it.
 */

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

const DK = await imp('features/carrier/deck.js');
const G = await imp('features/carrier/gear.js');
const L = await imp('features/carrier/lso.js');
const W = await imp('features/carrier/who.js');
const B = await imp('world/carrier-berth.js');

let passed = 0;
let failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${detail}` : ''}`);
};
const near = (a, b, e) => Math.abs(a - b) <= e;

/* ------------------------------------------------------------------ */
/* 1. The deck                                                          */
/* ------------------------------------------------------------------ */

// The carrier as main.js builds it: deck 1500 x 360 m at 104 m, bow north.
const ship = { pos: { x: -5200, z: 3400 }, deckY: 104, halfWidth: 180, halfDepth: 750, headingDeg: 0 };
const f = DK.frameFor(ship, 5);
{
  const w = DK.wires(f);
  const gaps = w.slice(1).map((x, i) => x.s - w[i].s);
  ok('four wires, numbered from the stern', w.length === 4 && w.map((x) => x.n).join() === '1,2,3,4' && gaps.every((g) => g > 0));
  ok('at their real spacing, 12.2 m (40 ft)', gaps.every((g) => near(g, 12.2, 1e-9)), gaps.map((g) => g.toFixed(1)).join(', '));
  ok('the lens is set for a touchdown between the 2 and 3 wires, so the hook rolls into the 3',
    w[1].s < f.touchdownS && f.touchdownS < w[2].s, `2-wire ${w[1].s.toFixed(1)}, touchdown ${f.touchdownS}, 3-wire ${w[2].s.toFixed(1)}`);
  const inside = w.every((x) => [x.a, x.b].every((p) => Math.abs(p.x - ship.pos.x) <= 180 && Math.abs(p.z - ship.pos.z) <= 750));
  ok('each wire spans the painted landing area and lies on the deck', inside && near(Math.hypot(w[0].a.x - w[0].b.x, w[0].a.z - w[0].b.z), 110, 1e-6));
  // Station round trip.
  const p = DK.atStation(f, -150, 12);
  const st = DK.station(f, p.x, p.z);
  ok('station and offset round-trip through the world', near(st.s, -150, 1e-9) && near(st.lat, 12, 1e-9));
  ok('the landing heading is 9 degrees left of the ship', near(f.landingHeadingDeg, 351, 1e-9), `${f.landingHeadingDeg}`);
  // Moving along D goes up the angled deck (north-west for a north-bound ship).
  const a = DK.atStation(f, 0);
  const b = DK.atStation(f, 100);
  ok('up the landing axis is forward and to port', b.z < a.z && b.x < a.x);
  const rs = DK.rampS(f);
  ok('the ramp is behind the wires, well clear', rs < w[0].s - 300, `ramp at ${rs.toFixed(0)}, 1-wire at ${w[0].s.toFixed(0)}`);
  const cats = DK.catapults(f);
  ok('two bow catapults, on the deck, pointing off the bow',
    cats.length === 2 && cats.every((c) => c.dir.z === -1 && Math.abs(c.start.x - ship.pos.x) < 180 && c.start.z - ship.pos.z < -400 && c.end.z < c.start.z),
    cats.map((c) => `cat ${c.n} at (${(c.start.x - ship.pos.x).toFixed(0)}, ${(c.start.z - ship.pos.z).toFixed(0)})`).join(', '));
  ok('each shuttle starts 80 m back from the end of its track', cats.every((c) => near(c.start.z - c.end.z, 80, 1e-6)));
  const lens = DK.lensSpot(f);
  ok('the lens is on the port deck edge, abeam the touchdown point',
    lens.local.x < -160 && Math.abs(lens.local.z - (f.O.z + f.touchdownS * f.D.z)) < 40, `local (${lens.local.x}, ${lens.local.z.toFixed(0)})`);
  const pp = DK.patternPoints(f);
  ok('the initial is 5.5 km astern, 800 ft over the deck, on the ship\'s heading',
    near(pp.initial.z - ship.pos.z, 750 + 5500, 1) && near((pp.initial.y - 104) * DK.FT, 800, 1) && pp.initial.headingDeg === 0);
  ok('the 180 is to port, 600 ft over the deck, heading the other way', pp.abeam.x - ship.pos.x < -2000 && near((pp.abeam.y - 104) * DK.FT, 600, 1) && pp.abeam.headingDeg === 180);
  const gs = DK.glide(f, pp.groove.x, pp.groove.y, pp.groove.z);
  ok('the groove starts 1.4 km out, on the glideslope and on centreline', near(gs.range, 1400, 1e-6) && near(gs.devDeg, 0, 1e-6) && near(gs.lat, 0, 1e-6));
  for (const k of [0, 1, 2, 3, 4, 5]) {
    const s = DK.startSlot(f, k);
    if (Math.abs(s.x - ship.pos.x) > 175 || Math.abs(s.z - ship.pos.z) > 745) ok(`start slot ${k} is on the deck`, false, `${s.x}, ${s.z}`);
  }
  ok('six start slots, all on the deck: two catapults, then queued behind them', DK.startSlot(f, 0).kind === 'cat' && DK.startSlot(f, 1).kind === 'cat' && DK.startSlot(f, 2).kind === 'queue');
  // A ship pointing east has everything turned with it.
  const fe = DK.frameFor({ ...ship, headingDeg: 90 }, 5);
  const ce = DK.catapults(fe)[0];
  ok('turned to heading 090, the catapults point east', near(ce.dir.x, 1, 1e-9) && near(ce.dir.z, 0, 1e-9) && near(fe.landingHeadingDeg, 81, 1e-9));
}

/* ------------------------------------------------------------------ */
/* 2. The glideslope and the ball                                      */
/* ------------------------------------------------------------------ */
{
  const p = DK.atStation(f, f.touchdownS - 800, 0);
  const tan = Math.tan((3.5 * Math.PI) / 180);
  const on = DK.glide(f, p.x, 104 + 800 * tan, p.z);
  const hi = DK.glide(f, p.x, 104 + 800 * Math.tan((4.25 * Math.PI) / 180), p.z);
  const lo = DK.glide(f, p.x, 104 + 800 * Math.tan((2.6 * Math.PI) / 180), p.z);
  ok('on the 3.5° path the ball is centred', near(on.devDeg, 0, 1e-9) && near(DK.ballCells(on.devDeg).cells, 0, 1e-9));
  ok('0.75° high is two cells up', near(DK.ballCells(hi.devDeg).cells, 2, 1e-6), DK.ballCells(hi.devDeg).cells.toFixed(2));
  ok('0.9° low shows in the red bottom cell', DK.ballCells(lo.devDeg).red === true, lo.devDeg.toFixed(2));
  ok('far too high and the ball is gone off the top', DK.ballCells(1.2).off === 'high');
  // Zones.
  const zz = (s, lat, y, h) => {
    const q = DK.atStation(f, s, lat);
    return DK.patternZone(f, q.x, y, q.z, h);
  };
  ok('lined up behind the deck on the way down is the groove', zz(f.touchdownS - 900, 0, 104 + 55, 351) === 'groove');
  ok('the downwind is to port, heading south', DK.patternZone(f, ship.pos.x - 2100, 290, ship.pos.z, 180) === 'downwind');
  ok('the initial is astern, heading north', DK.patternZone(f, ship.pos.x, 350, ship.pos.z + 5000, 0) === 'astern');
}

/* ------------------------------------------------------------------ */
/* 3. The wire                                                          */
/* ------------------------------------------------------------------ */
{
  const rows = [];
  let good = true;
  for (const kt of [80, 100, 120, 140, 160]) {
    const v0 = kt / 1.94384;
    const plan = G.planArrest(v0);
    // Integrate the profile to the stop, the way the feature does.
    let t = 0;
    let r = null;
    for (; t < 10; t += 1 / 60) {
      r = G.arrestAt(v0, plan.A, t);
      if (r.stopped) break;
    }
    rows.push(`${kt} kt: ${r.s.toFixed(0)} m in ${plan.tStop.toFixed(2)} s, ${plan.peakG.toFixed(1)} g`);
    if (!(plan.tStop >= 2.0 && plan.tStop <= 3.3 && r.s >= 49 && r.s <= 111 && near(r.s, plan.D, 0.01))) good = false;
  }
  ok('every trap stops in 2-3.3 s and 50-110 m of run-out', good, rows.join('; '));
  const p140 = G.planArrest(140 / 1.94384);
  ok('a 140 kt trap stops in about 100 m', near(p140.D, 104, 6), `${p140.D.toFixed(0)} m, ${p140.tStop.toFixed(2)} s, ${p140.peakG.toFixed(1)} g`);
  ok('a hard but believable pull: under 3.5 g', [80, 100, 120, 140, 160].every((kt) => G.planArrest(kt / 1.94384).peakG < 3.5));
}

/* ------------------------------------------------------------------ */
/* 4. The catapult, and where the hook is                              */
/* ------------------------------------------------------------------ */
const TYPES = await imp('aircraft/types.js');
try {
  await imp('aircraft/extra/index.js');
} catch (e) {
  /* the extras register themselves when they can */
}
{
  const rows = [];
  let good = true;
  let hooks = true;
  const hookRows = [];
  for (const t of TYPES.AIRCRAFT) {
    if (!W.isMilitary(t)) continue;
    const perf = TYPES.performanceFor(t.id);
    const shot = G.planShot(perf.stallClean / 1.94384, DK.TUNE.catEndOverStall, DK.TUNE.catSeconds);
    rows.push(`${t.id} ${Math.round(shot.vEnd * 1.94384)} kt ${shot.seconds}s ${Math.round(shot.stroke)} m ${shot.peakG.toFixed(1)}g`);
    if (!(shot.seconds >= 1.8 && shot.seconds <= 2.5 && shot.stroke <= 120 && shot.peakG < 4.5 && shot.vEnd > perf.stallClean / 1.94384 * 1.3)) good = false;
    const spec = TYPES.specFor(t.id);
    const h = G.hookGeometry(spec);
    const mainZ = spec.gearPoints.filter((g) => g.name !== 'nose')[0].pos.z;
    const mainY = Math.min(...spec.gearPoints.map((g) => g.pos.y));
    hookRows.push(`${t.id} z ${h.point.z.toFixed(1)} y ${h.point.y.toFixed(2)}`);
    if (!(h.point.z > mainZ + 1 && Math.abs(h.point.y - mainY) < 0.3 && h.length > 0.8)) hooks = false;
  }
  ok('every military jet\'s shot: flying speed in about two seconds, under 4.5 g, inside the track', good, rows.join('; '));
  ok('every hook hangs aft of the main wheels at about wheel height', hooks, hookRows.join('; '));
}

/* ------------------------------------------------------------------ */
/* 5. Paddles                                                           */
/* ------------------------------------------------------------------ */

/** Fly a synthetic pass from 1.8 km in at 55 m/s; `dev(range)` and `lat(range)` shape it. */
function fly(dev, lat = () => 0, cfg = {}) {
  const lso = L.createLso();
  const pass = L.createPass();
  const calls = [];
  for (let range = 1800; range > 0; range -= 55 * 0.2) {
    const r = { range, devDeg: dev(range), lat: lat(range), gearDown: cfg.gear !== false, hookDown: cfg.hook !== false, hasHook: true, bankDeg: 0, airborne: true, callsign: 'Hornet three hundred', typeName: 'Hornet', fuelK: '4.2' };
    L.recordSample(pass, r);
    for (const c of L.lsoTick(lso, r, 0.2)) calls.push(c.text);
    if (lso.waveoff) {
      pass.waveoff = true;
      pass.waveoffReason = lso.waveoffReason;
      break;
    }
  }
  return { calls, pass, lso };
}
{
  const a = fly(() => 0);
  ok('on the ball: the pilot calls the ball, Paddles says "Roger ball" — and nothing else', a.calls.length === 2 && /Hornet ball, 4\.2/.test(a.calls[0]) && a.calls[1] === 'Roger ball.', a.calls.join(' | '));
  const g1 = L.gradePass({ ...a.pass, result: 'trap', wire: 3, powerTd: true });
  ok('...and a 3-wire from it is the underlined OK', g1.key === 'OK*' && g1.grade === 'OK' && g1.points === 5, `${g1.key}: ${g1.comment}`);
  const low = fly((r) => (r < 1100 ? -0.55 - (1100 - r) / 2500 : 0));
  ok('settling low: "You\'re low", then "Power"', low.calls.includes("You're low.") && low.calls.includes('Power.') && low.calls.indexOf("You're low.") < low.calls.indexOf('Power.'), low.calls.join(' | '));
  const left = fly(() => 0, (r) => (r < 1200 ? -12 : 0));
  ok('left of centreline: "Right for lineup"', left.calls.includes('Right for lineup.'), left.calls.join(' | '));
  const right = fly(() => 0, (r) => (r < 1200 ? 12 : 0));
  ok('right of centreline: "Come left"', right.calls.includes('Come left.'), right.calls.join(' | '));
  const hookUp = fly(() => 0, () => 0, { hook: false });
  ok('hook still up: "Check your hook", then "Wave off, wave off" inside 700 m',
    hookUp.calls.includes('Check your hook.') && hookUp.calls.includes('Wave off, wave off.') && hookUp.lso.waveoffReason === 'hook', hookUp.calls.join(' | '));
  const dive = fly((r) => (r < 650 ? -1.4 : 0));
  ok('far too low in close: waved off', dive.lso.waveoff && dive.lso.waveoffReason === 'low', dive.calls.join(' | '));
  const gw = L.gradePass({ ...dive.pass, result: 'waveoff' });
  ok('a wave-off is graded as one, with the reason in plain words', gw.grade === 'Wave-off' && /too low/.test(gw.comment), gw.comment);
  const g4 = L.gradePass({ ...low.pass, result: 'trap', wire: 1, powerTd: false });
  ok('low all the way in, no power, 1-wire: No grade', g4.grade === 'No grade', `${g4.grade}: ${g4.comment}`);
  const g2 = L.gradePass({ ...a.pass, result: 'trap', wire: 2, powerTd: false });
  ok('on the ball, 2-wire, no power on touchdown: OK, and it says so', g2.grade === 'OK' && /no power/i.test(g2.comment), `${g2.grade}: ${g2.comment}`);
  const g5 = L.gradePass({ ...a.pass, result: 'trap', wire: 4, powerTd: false, maxHigh: { X: 0, IM: 0.8, IC: 0.7, AR: 0 } });
  ok('high in the middle and in close, long to the 4-wire, no power: No grade or Fair', g5.grade === 'No grade' || g5.grade === 'Fair', `${g5.grade}: ${g5.comment}`);
  const gb = L.gradePass({ ...a.pass, result: 'bolter', powerTd: true });
  ok('a bolter is a Bolter, with why', gb.grade === 'Bolter' && /long/i.test(gb.comment), gb.comment);
  const gs = L.gradePass({ ...a.pass, result: 'bolter', powerTd: true, skip: true });
  ok('a hook skip says so', /skipped/i.test(gs.comment), gs.comment);
  const quietClose = fly((r) => (r < 200 ? 0.6 : 0));
  ok('in close Paddles keeps quiet except for power and the wave-off', !quietClose.calls.includes("You're high."), quietClose.calls.join(' | '));
}

/* ------------------------------------------------------------------ */
/* 6. Who has a hook                                                    */
/* ------------------------------------------------------------------ */
{
  const mil = TYPES.AIRCRAFT.filter((t) => W.isMilitary(t)).map((t) => t.id);
  const hooked = TYPES.AIRCRAFT.filter((t) => W.hasHookFor(t)).map((t) => t.id);
  ok('the military aeroplanes are the hangar\'s military ones', ['vanguard', 'osprey', 'nightjar'].every((id) => mil.includes(id)) && !mil.includes('skylark') && !mil.includes('harrier') && !mil.includes('massimo') && !mil.includes('tpose'), mil.join(', '));
  ok('every one has a hook except the F-35B', mil.filter((id) => !hooked.includes(id)).join() === (mil.includes('f35b') ? 'f35b' : ''), `hooked: ${hooked.join(', ')}`);
  ok('no civil aeroplane has one', hooked.every((id) => mil.includes(id)));
}

/* ------------------------------------------------------------------ */
/* 7. The berth                                                         */
/* ------------------------------------------------------------------ */
const T = await imp('world/terrain.js');
const { MAPS } = await imp('world/maps.js');
{
  const bad = [];
  const rows = [];
  let authored = 0;
  let placed = 0;
  for (const m of MAPS) {
    T.applyMap(m.id);
    const b = B.chooseBerth({ map: T.MAP, airport: T.AIRPORT, heightAt: T.heightAt });
    const lanes = B.runwayLanes(T.AIRPORT);
    const why = [];
    if (b.why === 'map') authored++;
    else {
      placed++;
      for (const fx of [-1, 0, 1]) for (const fz of [-1, 0, 1]) if (!(T.heightAt(b.x + fx * 180, b.z + fz * 750) < -12)) why.push('shallow');
      if ([[0, 0], [-180, -750], [180, 750], [-180, 750], [180, -750]].some(([dx, dz]) => B.laneIntrusion(lanes, b.x + dx, b.z + dz) > 0)) why.push('in an approach lane');
      const r = T.AIRPORT.runway;
      const d = Math.hypot(b.x - r.cx, b.z - r.cz);
      if (d > 12000) why.push(`${(d / 1000).toFixed(1)} km away`);
    }
    rows.push(`${m.id}:${b.why}`);
    if (why.length) bad.push(`${m.id} (${b.why}) ${[...new Set(why)].join(', ')}`);
  }
  ok('every map\'s carrier: its own berth, or deep water clear of every approach lane, in sight of the field', bad.length === 0, bad.join('; ') || `${authored} authored, ${placed} placed`);
  console.log(`     ${rows.join(' ')}`);
  // A map that grows a third runway pointing straight at the old berth moves the ship.
  T.applyMap('kestrel');
  const before = B.chooseBerth({ map: T.MAP, airport: T.AIRPORT, heightAt: T.heightAt });
  const r = T.AIRPORT.runway;
  const hdg = (Math.atan2(before.x - r.cx, -(before.z - r.cz)) * 180) / Math.PI;
  const grown = { ...T.AIRPORT, runways: [r, { cx: r.cx, cz: r.cz, length: 1400, headingDeg: (hdg + 360) % 360 }] };
  const after = B.chooseBerth({ map: { ...T.MAP, carrier: undefined }, airport: grown, heightAt: T.heightAt });
  const lanes = B.runwayLanes(grown);
  ok('a third runway aimed at the berth moves the ship out of its approach lane',
    (after.x !== before.x || after.z !== before.z) && B.laneIntrusion(lanes, after.x, after.z) <= 0, `(${before.x}, ${before.z}) -> (${after.x}, ${after.z}) ${after.why}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
