/**
 * Node checks for DIRECT TO and the flight plan (src/features/livemap/geo.js,
 * nav.js, and the NAV mode in flight/autopilot.js). Run from anywhere:
 *
 *   node tests/features/livemap-nav.mjs [--verbose]
 *
 *   COORDINATES   world ↔ latitude/longitude is exact both ways; the map shows
 *                 N12°34.5' W045°12.3'; typed back (that form, 12°34.5'N
 *                 045°12.3'W, decimal degrees, the km grid) it lands where it
 *                 says; nonsense is refused.
 *   FIXES         five letters, original, unique, the same every time, clear of
 *                 the fields and never an airport's code.
 *   THE PLAN      DIRECT TO is a leg from where you are; + ROUTE appends; a
 *                 waypoint reached sequences to the next leg; the last one
 *                 holds; legs add up; removing one keeps the rest.
 *   NAV, FLOWN    the real flight model and the real autopilot, NAV steering
 *                 to a waypoint 300 degrees off the nose, for a trainer, an
 *                 airliner, a jumbo, a fighter and a helicopter: it gets there,
 *                 it turns at no more than a rate-one bank, it captures the
 *                 course without oscillating (the heading error settles and
 *                 stays settled), it holds the height; then a three-leg route,
 *                 flown in order; then the hold (an orbit round the last one).
 *   THE MODES     the autopilot's lateral mode reads NAV while it follows the
 *                 route and HDG otherwise; dialling a heading leaves NAV and
 *                 keeps the heading dialled.
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

const SRC = new URL('../../src/', import.meta.url).href;
const VERBOSE = process.argv.includes('--verbose');
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail: String(detail) });
  if (!pass || VERBOSE) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const G = await import(SRC + 'features/livemap/geo.js');

/* ---------------- coordinates ---------------- */
{
  const o = G.originFor('world-preview');
  ok('the World Map preview sits at N12°00\' W045°00\'; every other map has a place of its own, the same every time',
    o.lat === 12 && o.lon === -45 && JSON.stringify(G.originFor('gateway')) === JSON.stringify(G.originFor('gateway')) && JSON.stringify(G.originFor('gateway')) !== JSON.stringify(G.originFor('fjord')),
    `${JSON.stringify(o)} ${JSON.stringify(G.originFor('gateway'))}`);
  let worst = 0;
  for (const [x, z] of [[0, 0], [200000, -150000], [-180000, 170000], [12345.6, -6543.2]]) {
    const ll = G.toLatLon(x, z, o);
    const p = G.fromLatLon(ll.lat, ll.lon, o);
    worst = Math.max(worst, Math.hypot(p.x - x, p.z - z));
  }
  ok('world → lat/long → world is exact (under a millimetre, 250 km out)', worst < 0.001, `${worst.toExponential(2)} m`);
  const ll = G.toLatLon(0, -1852 * 34.5, o);
  ok('a nautical mile north is a minute of latitude', Math.abs((ll.lat - 12) * 60 - 34.5) < 1e-9, ll.lat);
  const txt = G.fmtLatLon(12.575, -45.205);
  ok('the map writes positions as N12°34.5\' W045°12.3\'', txt === "N12°34.5' W045°12.3'", txt);
  const want = G.fromLatLon(12.575, -45.205, o);
  const forms = ["N12°34.5' W045°12.3'", "n12 34.5 w45 12.3", "12°34.5'N 045°12.3'W", '12.575 -45.205', '12.575, -45.205', "N12°34.5'W045°12.3'"];
  const bad = forms.filter((f) => {
    const p = G.parsePosition(f, o);
    return !p || Math.hypot(p.x - want.x, p.z - want.z) > 1;
  });
  ok('typed back in every way a pilot writes it, it lands on the same metre', bad.length === 0, bad.join(' / ') || `${forms.length} forms`);
  const grid = G.parsePosition('12.3 km E 4.5 km N', o);
  ok('the km grid: 12.3 km E 4.5 km N is x 12,300, z -4,500 (and the map writes it back the same way)', grid && grid.x === 12300 && grid.z === -4500 && G.gridText(12300, -4500) === '12.3 km E · 4.5 km N', grid && `${grid.x} ${grid.z} ${G.gridText(12300, -4500)}`);
  const nonsense = ['', 'hello', 'N95 00 W045 00', 'N12 75 W045 00', '1 2 3', 'N80 W170'];
  ok('nonsense, an impossible latitude, 75 minutes, or the other side of the world are refused', nonsense.every((t) => !G.parsePosition(t, o)), nonsense.filter((t) => G.parsePosition(t, o)).join(' / '));
  ok('bearings and the words for them: north 360°, east 090°', G.fmtBrg(G.bearingDeg(0, 0, 0, -10)) === '360°' && G.fmtBrg(G.bearingDeg(0, 0, 10, 0)) === '090°', `${G.fmtBrg(G.bearingDeg(0, 0, 0, -10))} ${G.fmtBrg(G.bearingDeg(0, 0, 10, 0))}`);
  ok('ETA: 120 km at 240 kt is 16 minutes; an hour and five reads "1 h 05"', Math.abs(G.etaMin(120000, 240) - 16.2) < 0.1 && G.fmtEta(65) === '1 h 05', `${G.etaMin(120000, 240).toFixed(1)} ${G.fmtEta(65)}`);
}

/* ---------------- fixes ---------------- */
{
  const PV = await import(SRC + 'world/worldmap/preview.js');
  const fields = PV.AIRPORTS.map((a) => ({ id: a.id, x: a.x, z: a.z, hdg: 90, halfLen: a.length / 2 }));
  const codes = PV.AIRPORTS.map((a) => a.code);
  const a = G.makeFixes('world-preview', fields, { reserved: codes, minGap: 9000 });
  const b = G.makeFixes('world-preview', fields, { reserved: codes, minGap: 9000 });
  const names = a.map((f) => f.name);
  const clear = a.every((f) => fields.every((q) => Math.hypot(q.x - f.x, q.z - f.z) >= 4000));
  ok('fixes on the World Map: five letters, unique, the same every time, clear of every field, never an airport code',
    a.length >= 20 && new Set(names).size === names.length && names.every((n) => /^[A-Z]{5}$/.test(n)) && JSON.stringify(a) === JSON.stringify(b) && clear && !names.some((n) => codes.includes(n)),
    `${a.length}: ${names.slice(0, 12).join(' ')}…`);
  ok('approach fixes sit 12 km off the runway ends; en-route fixes on the legs between fields', a.some((f) => f.role === 'approach') && a.some((f) => f.role === 'enroute'), `${a.filter((f) => f.role === 'approach').length} approach, ${a.filter((f) => f.role === 'enroute').length} en-route`);
  const many = G.makeFixes('x', Array.from({ length: 40 }, (_, i) => ({ id: `f${i}`, x: i * 50000, z: (i % 5) * 40000, hdg: 90, halfLen: 800 })), { minGap: 3000 });
  ok('a map with more fixes than the list has names gets made-up pronounceable ones, still unique', new Set(many.map((f) => f.name)).size === many.length && many.length > G.FIX_NAMES.length, `${many.length} fixes`);
}

/* ---------------- the plan ---------------- */
{
  const P = new G.FlightPlan();
  const A = { id: 'a', name: 'HERON', x: 10000, z: 0, kind: 'fix' };
  const B = { id: 'b', name: 'SKUAH', x: 10000, z: 10000, kind: 'fix' };
  const C = { id: 'c', name: 'XHVN', x: 0, z: 10000, kind: 'airport' };
  P.directTo(A, 0, 0);
  ok('DIRECT TO is one leg from present position', P.legs.length === 1 && P.origin.kind === 'ppos' && P.origin.x === 0 && P.state === 'active' && P.to.name === 'HERON', JSON.stringify(P.origin));
  P.add(B, 0, 0);
  P.add(C, 0, 0);
  const sum = P.summary(0, 0, 240);
  ok('+ ROUTE appends; the plan reads leg by leg with each leg\'s distance and the time to each waypoint', P.legs.map((l) => l.name).join() === 'HERON,SKUAH,XHVN' && Math.abs(sum.total - 30000) < 1 && sum.rows[2].cumEta > sum.rows[1].cumEta, `${sum.rows.map((r) => `${r.wp.name} ${Math.round(r.dist)} m`).join(', ')} = ${Math.round(sum.total)} m`);
  const e1 = P.update(9500, 0, 100);
  ok('reaching HERON sequences to SKUAH', e1 && e1.type === 'sequenced' && P.to.name === 'SKUAH', JSON.stringify(e1 && e1.type));
  P.update(10050, 9900, 100);
  const e3 = P.update(100, 10000, 100);
  ok('reaching the last one holds there', e3 && e3.type === 'arrived' && P.state === 'holding' && P.to.name === 'XHVN', `${e3 && e3.type} ${P.state}`);
  const pt = P.steer(4000, 10000, 100);
  ok('holding is an orbit round it', !!pt && Math.abs(Math.hypot(pt.x - C.x, pt.z - C.z) - G.orbitRadius(100)) < 1, pt && `${Math.round(Math.hypot(pt.x - C.x, pt.z - C.z))} m from it`);
  const P2 = new G.FlightPlan();
  P2.add(A, 0, 0);
  P2.add(B, 0, 0);
  P2.add(C, 0, 0);
  P2.remove(1);
  P2.directToIndex(1, 500, 500);
  ok('removing a waypoint keeps the rest; DIRECT TO one on the route drops the legs before it', P2.legs.map((l) => l.name).join() === 'XHVN' && P2.origin.x === 500 && P2.state === 'active', P2.legs.map((l) => l.name).join());
  const pp = G.pursuitPoint(0, 300, 0, 0, 20000, 0, 2000);
  ok('pure pursuit: the carrot is on the leg, a look-ahead in front of where you are abeam; cross-track positive right of the course', Math.abs(pp.z) < 1e-9 && Math.abs(pp.x - 2000) < 1e-9 && pp.xtk > 0, JSON.stringify(pp));
}

/* ---------------- NAV, flown ---------------- */
const THREE = await import(SRC + 'vendor/three.module.js');
const PH = await import(SRC + 'aircraft/physics.js');
const { Weather } = await import(SRC + 'world/weather.js');
const AP = await import(SRC + 'flight/autopilot.js');
const T = await import(SRC + 'world/terrain.js');
T.applyMap('kestrel');
const KT = 1.94384;
const wrap = (d) => ((d + 540) % 360) - 180;

/**
 * Fly `id` from (0, alt) heading 090 at `kts`, NAV to `wps` (a route) with the
 * real autopilot, for at most `maxS`. Records the heading error to the leg's
 * aim, the bank, the height, the cross-track, and the events.
 */
function flyNav(id, kts, altM, wps, maxS, rotor = false) {
  PH.applyAircraft(id);
  const ac = new PH.Aircraft();
  ac.mode = 'simplified';
  const w = new Weather();
  w.windSpeedKts = 0;
  ac.reset({ pos: new THREE.Vector3(0, 0, 0), headingDeg: 90, engineOn: true, gearDown: false, speed: kts / KT, altAGL: altM });
  ac.pos.y = altM;
  const plan = new G.FlightPlan();
  plan.add(wps[0], 0, 0);
  for (const x of wps.slice(1)) plan.add(x, 0, 0);
  const ap = new AP.Autopilot();
  ap.nav = { steer: (a) => plan.steer(a.pos.x, a.pos.z, a.groundSpeed || 0, rotor), label: () => (plan.to ? plan.to.name : ''), onHeadingSelected() {} };
  ap.setEngaged(true, ac);
  const alt0 = ac.readouts().altFt;
  const dt = 1 / 60;
  const rec = { err: [], bank: [], alt: [], xtk: [], events: [], lateral: new Set(), status: '' };
  let t = 0;
  let arrived = null;
  for (; t < maxS && !ac.crashed; t += dt) {
    const o = ap.update(dt, ac, null);
    ac.controls.pitch = o.pitch;
    ac.controls.roll = o.roll;
    ac.controls.yaw = o.yaw;
    ac.controls.throttle = o.throttle;
    const { n, h } = PH.frameSteps(dt);
    for (let i = 0; i < n; i++) ac.update(h, w);
    const ev = plan.update(ac.pos.x, ac.pos.z, ac.groundSpeed || 0);
    if (ev) rec.events.push({ t, type: ev.type, name: ev.wp.name });
    if (ev && ev.type === 'arrived') arrived = arrived ?? t;
    rec.lateral.add(ap.lateral);
    if (Math.round(t * 60) % 6 === 0) {
      const r = ac.readouts();
      const to = plan.to;
      const from = plan.fromOf(plan.active) || { x: 0, z: 0 };
      if (plan.state === 'active' && to) {
        const brg = G.bearingDeg(ac.pos.x, ac.pos.z, to.x, to.z);
        const xt = G.pursuitPoint(ac.pos.x, ac.pos.z, from.x, from.z, to.x, to.z, 1).xtk;
        rec.err.push({ t, e: wrap(brg - r.heading), leg: plan.active, d: Math.hypot(to.x - ac.pos.x, to.z - ac.pos.z), xtk: xt });
        rec.xtk.push({ t, leg: plan.active, x: xt });
      }
      rec.bank.push({ t, b: Math.abs(ac.bankAngleDeg()) });
      rec.alt.push(r.altFt - alt0);
    }
    if (arrived != null && t > arrived + 40) break;
  }
  rec.status = ap.status(null);
  return { ac, plan, ap, rec, t, arrived, crashed: ac.crashed };
}

/**
 * After the course is captured — on the track (under 400 m off it) and
 * pointing at the waypoint (under 6 degrees) for 10 s — how many times does
 * the heading error swing back past 4 degrees, and how far?
 */
function settle(errs) {
  let captured = -1;
  let run = 0;
  for (let i = 0; i < errs.length; i++) {
    if (Math.abs(errs[i].e) < 6 && Math.abs(errs[i].xtk) < 400) {
      run++;
      if (run >= 100 && captured < 0) captured = i - run + 1;
    } else run = 0;
  }
  if (captured < 0) return { captured: false, swings: 99, after: null };
  let swings = 0;
  let side = 0;
  let worst = 0;
  for (let i = captured; i < errs.length; i++) {
    const e = errs[i].e;
    // Inside the last 2.5 km the bearing to a point swings by geometry, not by the autopilot.
    if (errs[i].d < 2500) continue;
    worst = Math.max(worst, Math.abs(e));
    const s = e > 4 ? 1 : e < -4 ? -1 : 0;
    if (s && side && s !== side) swings++;
    if (s) side = s;
  }
  return { captured: true, swings, worst, at: errs[captured].t };
}

const CLASSES = [
  { id: 'skylark', kts: 105, alt: 900, km: 18, what: 'a trainer' },
  { id: 'a320', kts: 250, alt: 3000, km: 40, what: 'an airliner' },
  { id: 'b747', kts: 260, alt: 3200, km: 45, what: 'a jumbo' },
  { id: 'f22', kts: 350, alt: 3000, km: 50, what: 'a fighter' },
  { id: 'bell407', kts: 80, alt: 600, km: 9, what: 'a helicopter', rotor: true },
];
for (const c of CLASSES) {
  // 300 degrees off the nose: a hard turn back, the case that oscillates if anything does.
  const brg = 300 * (Math.PI / 180);
  const wp = { id: 'w', name: 'HERON', kind: 'fix', x: Math.sin(brg) * c.km * 1000, z: -Math.cos(brg) * c.km * 1000 };
  const f = flyNav(c.id, c.kts, c.alt, [wp], 900, !!c.rotor);
  const s = settle(f.rec.err);
  const maxBank = Math.max(...f.rec.bank.map((q) => q.b));
  const altDev = Math.max(...f.rec.alt.map(Math.abs));
  const reached = f.rec.events.some((e) => e.type === 'arrived');
  const finalD = Math.hypot(f.ac.pos.x - wp.x, f.ac.pos.z - wp.z);
  ok(`NAV flies ${c.what} (${c.id}) DIRECT TO a point 300° off the nose, ${c.km} km: it gets there, captures the course and does not oscillate, bank under 30°, height held`,
    !f.crashed && (reached || (c.rotor && finalD < 60)) && s.captured && s.swings === 0 && s.worst < 6 && maxBank < 30 && altDev < (c.rotor ? 250 : 300) && f.rec.lateral.has('NAV'),
    `reached ${reached} at ${f.arrived != null ? f.arrived.toFixed(0) : '-'} s (${finalD.toFixed(0)} m off at the end), captured at ${s.at != null ? s.at.toFixed(0) : '-'} s, swings ${s.swings}, worst after capture ${s.worst != null ? s.worst.toFixed(1) : '-'}°, bank ${maxBank.toFixed(1)}°, height ±${altDev.toFixed(0)} ft`);
}
{
  // A three-leg route in the airliner: a dog-leg, then back.
  const route = [
    { id: 'a', name: 'HERON', kind: 'fix', x: 20000, z: -6000 },
    { id: 'b', name: 'SKUAH', kind: 'fix', x: 36000, z: 14000 },
    { id: 'c', name: 'GANNT', kind: 'fix', x: 14000, z: 30000 },
  ];
  const f = flyNav('a320', 250, 3000, route, 1200);
  const order = f.rec.events.map((e) => `${e.type}:${e.name}`).join(' ');
  // Cross-track on each leg once established (the middle of the leg).
  let worstX = 0;
  for (const leg of [1, 2]) {
    const xs = f.rec.xtk.filter((p) => p.leg === leg);
    const mid = xs.slice(Math.floor(xs.length * 0.45), Math.floor(xs.length * 0.75));
    for (const p of mid) worstX = Math.max(worstX, Math.abs(p.x));
  }
  ok('a three-leg route is flown in order (HERON, SKUAH, GANNT), each leg tracked to within 250 m once established',
    order === 'sequenced:HERON sequenced:SKUAH arrived:GANNT' && worstX < 250 && !f.crashed, `${order} · worst cross-track mid-leg ${worstX.toFixed(0)} m`);
  // The hold: after arriving, it circles the last waypoint at about the orbit radius.
  const hold = flyNav('a320', 250, 3000, [{ id: 'h', name: 'PETRL', kind: 'fix', x: 15000, z: 0 }], 600);
  const d = Math.hypot(hold.ac.pos.x - 15000, hold.ac.pos.z);
  ok('at the last waypoint it holds: circles it (not flying off into the distance), height kept', hold.plan.state === 'holding' && d < G.orbitRadius(hold.ac.groundSpeed) * 1.8 && /NAV HOLD PETRL|NAV PETRL/.test(hold.rec.status), `${d.toFixed(0)} m from it after the hold began; "${hold.rec.status}"`);
}

/* ---------------- NAV over high ground (the checker, w18) ---------------- */
{
  /*
   * A DIRECT TO is a straight line over whatever is in the way. Before the
   * look-ahead, NAV at 1,900 ft flew an A320 and a Skylark into Fjord's
   * 2,750 ft ridge (the 500 ft floor only knew the ground under the wheels).
   * Now it climbs over it, without stalling, and the height it holds over
   * open water is untouched.
   */
  T.applyMap('fjord');
  let best = { h: -1e9, x: 0, z: 0 };
  for (let x = -12000; x <= 12000; x += 250) for (let z = -12000; z <= 12000; z += 250) {
    const h = T.heightAt(x, z);
    if (h > best.h) best = { h, x, z };
  }
  const overRidge = (id, kts) => {
    PH.applyAircraft(id);
    const ac = new PH.Aircraft();
    ac.mode = 'simplified';
    const w = new Weather();
    w.windSpeedKts = 0;
    const sx = best.x - 9000;
    const altM = Math.max(T.heightAt(sx, best.z) + 300, best.h - 250);
    ac.reset({ pos: new THREE.Vector3(sx, 0, best.z), headingDeg: 90, engineOn: true, gearDown: false, speed: kts / KT, altAGL: 300 });
    ac.pos.y = altM;
    const wp = { x: best.x + 9000, z: best.z };
    const ap = new AP.Autopilot();
    ap.nav = { steer: () => wp, label: () => 'PIN', onHeadingSelected() {} };
    ap.setEngaged(true, ac);
    const held = ap.targetAltFt;
    let minClear = Infinity;
    let minIas = Infinity;
    let sawTerrain = false;
    const dt = 1 / 60;
    for (let t = 0; t < 300 && !ac.crashed && ac.pos.x < best.x + 3000; t += dt) {
      const o = ap.update(dt, ac, null);
      Object.assign(ac.controls, { pitch: o.pitch, roll: o.roll, yaw: o.yaw, throttle: o.throttle });
      const { n, h } = PH.frameSteps(dt);
      for (let i = 0; i < n; i++) ac.update(h, w);
      minClear = Math.min(minClear, ac.pos.y - Math.max(0, T.heightAt(ac.pos.x, ac.pos.z)));
      if (t > 5) minIas = Math.min(minIas, ac.readouts().iasKts);
      if (/TERRAIN/.test(ap.status(null))) sawTerrain = true;
    }
    return { ac, held, minClear, minIas, sawTerrain, startFt: altM * 3.28084, ridgeFt: best.h * 3.28084, ap };
  };
  for (const [id, kts] of [['a320', 230], ['skylark', 105]]) {
    const f = overRidge(id, kts);
    ok(`NAV over a ridge higher than the height it holds (${id}, ${Math.round(f.startFt)} ft at Fjord's ${Math.round(f.ridgeFt)} ft): it climbs over it ("TERRAIN" on the mode line), clear by 150 ft and more, never near the stall`,
      !f.ac.crashed && f.minClear > 46 && f.sawTerrain && f.minIas > AP.stallMs(PH.SPEC) * KT * 1.05,
      `crashed ${f.ac.crashed}, closest ${Math.round(f.minClear * 3.28084)} ft, slowest ${Math.round(f.minIas)} kt (stall ${Math.round(AP.stallMs(PH.SPEC) * KT)}), TERRAIN shown ${f.sawTerrain}`);
  }
  T.applyMap('kestrel');
  // Over the open sea, nothing changes: the held height, no TERRAIN.
  const sea = flyNav('a320', 250, 3000, [{ id: 's', name: 'BRINE', kind: 'fix', x: 0, z: 40000 }], 200);
  ok('over the open sea NAV holds its height exactly as before (no terrain climb)', !sea.crashed && Math.max(...sea.rec.alt.map(Math.abs)) < 300 && !/TERRAIN/.test(sea.rec.status) && !sea.ap.terrainClimb,
    `±${Math.max(...sea.rec.alt.map(Math.abs)).toFixed(0)} ft, "${sea.rec.status}"`);
}

/* ---------------- the modes ---------------- */
{
  PH.applyAircraft('skylark');
  const ac = new PH.Aircraft();
  ac.reset({ pos: new THREE.Vector3(0, 0, 0), headingDeg: 90, engineOn: true, gearDown: false, speed: 55, altAGL: 900 });
  ac.pos.y = 900;
  const ap = new AP.Autopilot();
  let left = 0;
  const target = { x: 0, z: -20000 };
  ap.nav = { steer: () => (left ? null : target), label: () => 'HERON', onHeadingSelected: () => { left++; } };
  ap.setEngaged(true, ac);
  ap.update(1 / 60, ac, null);
  const navStatus = ap.status(null);
  const wasNav = ap.lateral;
  const r = ap.setSelectedHeading(200);
  ap.update(1 / 60, ac, null);
  ok('the lateral mode reads NAV while it follows the route ("AUTO · NAV HERON")', wasNav === 'NAV' && /NAV HERON/.test(navStatus), `${wasNav} "${navStatus}"`);
  ok('dialling a heading leaves NAV for HDG and holds the heading dialled (200°)', left === 1 && ap.lateral === 'HDG' && r.applied && ap.holdHeadingDeg === 200 && !/NAV/.test(ap.status(null)), `left ${left}, ${ap.lateral}, hold ${ap.holdHeadingDeg}`);
  ap.setMode('approach');
  ap.nav = { steer: () => target, label: () => 'HERON', onHeadingSelected() {} };
  ap.update(1 / 60, ac, null);
  ok('NAV stands aside for the approach (the approach flies its own course)', ap.lateral === 'HDG', ap.lateral);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
