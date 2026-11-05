/**
 * YOUR RUNWAY (src/features/traffic/priority.js), with no page.
 *
 *   node tests/features/traffic.priority.mjs              everything
 *   node tests/features/traffic.priority.mjs --quick      one seed each way
 *   node tests/features/traffic.priority.mjs --json=f     the numbers, written to f
 *
 * The owner: "in free flight there's still NPCs flying, but the runway is
 * yours till you get off", and "if you're near the runway — you decide —
 * it's your own again". Three parts:
 *
 * 1. THE CLAIMS, on their own: on the runway, rolling and lifting off,
 *    climbing away and when that ends, a sensible final and a jet passing
 *    high over the same line, the circuit and flying away from it, taxiing
 *    clear, and the runways a map has (a third one parallel to 09/27 holds
 *    nobody; one that crosses it does).
 *
 * 2. A WHOLE FLIGHT on Kestrel with the real traffic hooks (traffic.harness.mjs),
 *    seeded, with the traffic using 09 and using 27: the traffic gets going
 *    while you are away; an arrival is put on final and you line up — it goes
 *    round; you sit a minute — departures hold short and the tower says so,
 *    once; you take off and climb away — they use the runway again; another
 *    arrival is put on final and you come back on a 7 km final — the
 *    runway is empty when you touch down; you roll out and taxi clear — it
 *    is theirs again. Every frame, the harness's own seams (nobody through
 *    you, nobody inside anybody, nobody under the ground, nothing jumping),
 *    and these:
 *      - while you are on the runway, nobody touches down on it, and nobody
 *        starts a take-off roll on it — except one lined up AHEAD of you
 *        when you came on behind it, which R3 sends off away from you
 *        (counted, and said);
 *      - while you climb away, nobody starts a take-off roll;
 *      - while you are on final or in the circuit, nobody starts a take-off
 *        roll unless it was already cleared on to the runway when you joined
 *        (lining up, or lined up and told to go now) — a minute or more
 *        ahead of you; within 45 s of you it stops short instead;
 *      - when you touch down, nobody is on the runway in front of you;
 *      - the claim ends within 90 s of lifting off and 3 s of taxiing clear,
 *        and the traffic uses the runway (a take-off or a landing) while you
 *        are away.
 *
 * 3. A LOBBY: the same claims for another pilot handed over the way
 *    ../../src/features/mpworld.js does on the host (setOtherPilots) — on
 *    the runway, departures hold; on final, an arrival goes round; on the
 *    ground in its way, a taxiing aeroplane stops for them.
 */

const H = await import('./traffic.harness.mjs');
const PR = await import('../../src/features/traffic/priority.js');
const F = H.F;
const TR = H.TR;
const TF = H.TF;

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const jsonArg = args.find((a) => a.startsWith('--json='));

let failed = 0;
let checks = 0;
const NUM = {};
function ok(name, pass, detail = '') {
  checks++;
  if (!pass) {
    failed++;
    console.log(`  FAIL ${name}${detail !== '' ? ` — ${detail}` : ''}`);
  } else if (process.env.VERBOSE) console.log(`  ok   ${name}${detail !== '' ? ` — ${detail}` : ''}`);
  return pass;
}

/* ---------------------------------------------------------------- 1. the claims */
{
  H.loadMap('kestrel');
  const A = TR.AIRPORT;
  const rws = PR.runwayList(A);
  ok('claims: Kestrel has 09/27 and 18/36, both stopping the traffic (18/36 crosses 09/27)',
    rws.length === 2 && rws[0].name === '09/27' && rws[1].name === '18/36' && rws.every((r) => r.crossesMain), rws.map((r) => `${r.name}${r.crossesMain ? '×' : ''}`).join(' '));
  // A third runway, as the maps work may add one: parallel and clear of 09/27, or across it.
  const par = PR.runwayList({ ...A, runway3: { cx: A.runway.cx, cz: A.runway.cz + 400, length: 1000, halfWidth: 15, headingDeg: 90 } });
  const xing = PR.runwayList({ ...A, runways: [{ cx: A.runway.cx - 200, cz: A.runway.cz, length: 900, halfWidth: 15, headingDeg: 150 }] });
  ok('claims: a third runway parallel to 09/27 is read, and does not stop the traffic; one across it does',
    par.length === 3 && !par[2].crossesMain && par[2].name === '09/27' && xing.length === 3 && xing[2].crossesMain && xing[2].name === '15/33',
    `${par.map((r) => `${r.id}:${r.name}${r.crossesMain ? '×' : ''}`).join(' ')} | ${xing.map((r) => `${r.id}:${r.name}${r.crossesMain ? '×' : ''}`).join(' ')}`);

  const rw = A.runway;
  const half = rw.length / 2;
  const west = rw.cx - half;
  const east = rw.cx + half;
  const p = PR.blankPilot();
  const cl = PR.newClaim();
  const set = (o) => Object.assign(p, { x: 0, y: A.elev, z: rw.cz, agl: 0, onGround: true, crashed: false, hdgDeg: 90, vx: 0, vy: 0, vz: 0, gs: 0 }, o);
  let t = 0;
  const step = (secs, o) => {
    for (let k = 0; k < secs * 10; k++) {
      t += 0.1;
      if (typeof o === 'function') o(t);
      PR.updateClaim(cl, p, rws, t);
    }
    return cl.kind;
  };
  set({ x: west + 80 });
  ok('claims: lined up at the start of 09 — the runway is yours', step(1) === 'runway' && cl.rw.id === 'main' && PR.etaFor(cl) === 0 && cl.episode === 1, `${cl.kind} ${cl.rw && cl.rw.name} eta ${PR.etaFor(cl)}`);
  // Rolling, then off the ground and climbing at 4 m/s, 45 m/s along.
  let x = west + 80;
  let v = 0;
  let agl = 0;
  const kinds = new Set();
  let liftAt = null;
  let endAt = null;
  step(120, (tt) => {
    v = Math.min(45, v + 2.5 * 0.1);
    x += v * 0.1;
    if (v > 33) {
      if (liftAt == null) liftAt = tt;
      agl += 4 * 0.1;
    }
    set({ x, agl, onGround: agl <= 0, vx: v, vy: agl > 0 ? 4 : 0, gs: v, y: A.elev + agl });
    if (cl.kind) kinds.add(cl.kind);
    else if (endAt == null && liftAt != null) endAt = tt;
  });
  ok('claims: the take-off is yours all the way — on the runway, then climbing away off it — and ends once you are away',
    kinds.has('runway') && kinds.has('climb') && !kinds.has('circuit') && !kinds.has('final') && endAt != null && endAt - liftAt < 90 && cl.episode === 1,
    `${[...kinds].join(',')}; ended ${endAt == null ? 'never' : `${(endAt - liftAt).toFixed(0)} s after lift-off`} at ${Math.round(x - east)} m past the end, ${Math.round(agl)} m up`);

  // Back on a 7 km final to 09, on a 3-degree slope.
  set({ x: west - 7000, agl: 7000 * 0.0524 + 15, onGround: false, hdgDeg: 90, vx: 45, vy: -2.4, gs: 45 });
  const k1 = step(0.5);
  const eta1 = PR.etaFor(cl);
  ok('claims: on a 7 km final to 09, it is yours again — with how long until you are there', k1 === 'final' && cl.episode === 2 && Math.abs(eta1 - 7000 / 45) < 5, `${k1}, eta ${eta1.toFixed(0)} s, episode ${cl.episode}`);
  // The same line, high: a jet passing over at 2,000 m is not landing.
  const c2 = PR.newClaim();
  PR.updateClaim(c2, { ...p, agl: 2000 }, rws, 0);
  ok('claims: the same line at 2,000 m is not a final', c2.kind === null, `${c2.kind}`);
  // Lined up with 18/36 from the north, low: a final to the crosswind runway.
  const r2 = A.runway2;
  const c3 = PR.newClaim();
  PR.updateClaim(c3, { ...PR.blankPilot(), x: r2.cx, z: r2.cz - r2.length / 2 - 3000, agl: 180, onGround: false, hdgDeg: 180, vz: 40, gs: 40 }, rws, 0);
  ok('claims: low and lined up with 18/36 — a final to it, which crosses 09/27, so it holds the traffic too', c3.kind === 'final' && c3.rw.id === 'r2' && PR.blocksMain(c3), `${c3.kind} ${c3.rw && c3.rw.name}`);
  /*
   * Downwind: 1.2 km south of the runway, 300 m up, flying west. The circuit
   * — IF you show you mean to land (the header of priority.js). The first cut
   * claimed it for anybody low near the field, which on Kestrel is most of
   * the island: the review's lap of the island at 250 m held the runway for
   * fifteen minutes, and a star hunt at 200 m got thirteen tower pop-ups.
   */
  const dw = { ...PR.blankPilot(), x: rw.cx + 400, z: rw.cz + 1200, agl: 300, onGround: false, hdgDeg: 270, vx: -45, gs: 45 };
  const claimOf = (pp, secs = 0.5) => {
    const c = PR.newClaim();
    for (let k = 0; k <= Math.round(secs * 10); k++) PR.updateClaim(c, pp, rws, k * 0.1);
    return c;
  };
  const level = claimOf(dw);
  ok('claims: downwind, 1.2 km off at 300 m, level, wheels fixed, no flaps — flying past: not the circuit, not yours', level.kind === null && level.episode === 0, `${level.kind}`);
  /*
   * The wheels on an aeroplane that can put them up. Down since take-off is
   * NO sign (round 3: a Courier whose wheels had never been up lapped the
   * island at 250 m and held the runway for fifteen minutes — a kid who never
   * pressed G is not landing). Up, then down again: that is the sign.
   */
  const dwL = { ...dw, retractable: true, gearDown: true };
  const never = claimOf(dwL);
  ok('claims: the same with the wheels down since take-off, on an aeroplane that can put them up — no sign, not yours', never.kind === null && never.episode === 0 && !never.gearWasUp, `${never.kind}, wheels were up: ${never.gearWasUp}`);
  const up = claimOf({ ...dw, retractable: true, gearDown: false });
  ok('claims: ... wheels up on that aeroplane: not', up.kind === null && up.gearWasUp, `${up.kind}, wheels were up: ${up.gearWasUp}`);
  // Wheels up, then lowered: a claim built with the wheels up for a second, then down.
  const lowered = (pp, secs = 0.5) => {
    const c = PR.newClaim();
    for (let k = 0; k <= 10; k++) PR.updateClaim(c, { ...pp, gearDown: false }, rws, -1 + k * 0.1);
    for (let k = 0; k <= Math.round(secs * 10); k++) PR.updateClaim(c, pp, rws, k * 0.1);
    return c;
  };
  const c4 = lowered(dwL);
  ok('claims: ... the wheels come DOWN there (they were up) — the circuit is yours, a deliberate sign', c4.kind === 'circuit' && PR.etaFor(c4) >= 30 && c4.deliberate, `${c4.kind}, eta ${PR.etaFor(c4).toFixed(0)} s, deliberate ${c4.deliberate}`);
  // Landed with them down, off again without touching them: a new flight, the memory is gone.
  const relanded = PR.newClaim();
  PR.updateClaim(relanded, { ...dwL, gearDown: false }, rws, 0);
  PR.updateClaim(relanded, { ...PR.blankPilot(), x: rw.cx + 3000, z: rw.cz + 3000, onGround: true, retractable: true, gearDown: true }, rws, 1);
  for (let k = 0; k <= 5; k++) PR.updateClaim(relanded, dwL, rws, 2 + k * 0.1);
  ok('claims: ... landed, then off again with the wheels never raised — a new flight, no sign', relanded.kind === null && !relanded.gearWasUp, `${relanded.kind}, wheels were up: ${relanded.gearWasUp}`);
  const flaps = claimOf({ ...dw, flaps: 1 });
  ok('claims: ... flaps out (wheels fixed): the circuit', flaps.kind === 'circuit' && flaps.deliberate, `${flaps.kind}`);
  const apc = claimOf({ ...dw, apApproach: true });
  ok('claims: ... the autopilot flying its approach: the circuit', apc.kind === 'circuit' && apc.deliberate, `${apc.kind}`);
  // Coming down at 1.5 m/s: a sign after four seconds of it, not before; a two-second dip never.
  const desc = PR.newClaim();
  let claimedAt = null;
  for (let k = 0; k <= 80; k++) {
    PR.updateClaim(desc, { ...dw, vy: -1.5 }, rws, k * 0.1);
    if (desc.kind && claimedAt == null) claimedAt = k * 0.1;
  }
  ok('claims: ... coming down at 1.5 m/s: the circuit after four seconds of it, not before — and not a deliberate sign', desc.kind === 'circuit' && claimedAt != null && claimedAt >= 3.9 && claimedAt < 4.3 && !desc.deliberate, `${desc.kind} after ${claimedAt} s, deliberate ${desc.deliberate}`);
  const dip = PR.newClaim();
  for (let k = 0; k <= 60; k++) PR.updateClaim(dip, { ...dw, vy: k <= 20 ? -2 : 0 }, rws, k * 0.1);
  ok('claims: a two-second dip near the field is not a landing', dip.kind === null && dip.episode === 0, `${dip.kind}, ${dip.episode} episode(s)`);
  const heli = claimOf({ ...dwL, rotor: true, vy: -2 }, 6);
  ok('claims: a helicopter there, wheels down and coming down, claims no circuit of the runway', heli.kind === null && heli.episode === 0, `${heli.kind}`);
  // Wheels back up in the circuit, level: the sign counts for 25 s, then the linger, then it ends.
  const hold = lowered(dwL, 1);
  let heldFor = null;
  for (let k = 1; k <= 500 && heldFor == null; k++) {
    PR.updateClaim(hold, { ...dwL, gearDown: false }, rws, 1 + k * 0.1);
    if (!hold.kind) heldFor = k * 0.1;
  }
  ok('claims: wheels back up in the circuit, level on and on — it lasts the 25 s a sign counts for plus the linger, then ends', hold.kind === null && heldFor != null && heldFor > 25 && heldFor < 33, `${heldFor} s`);
  // Flying straight away from the field, low, inside the circuit's box: not the circuit, whatever the wheels say (ten seconds' grace once in it).
  const c5 = lowered({ ...PR.blankPilot(), x: rw.cx, z: rw.cz + 1400, agl: 300, onGround: false, hdgDeg: 180, vz: 45, gs: 45, retractable: true, gearDown: true });
  ok('claims: low, wheels just lowered, but flying straight away from the field — not the circuit', c5.kind === null && c5.gearWasUp, `${c5.kind}`);
  let tt = 0;
  const away = { ...dwL };
  for (let k = 0; k < 400 && c4.kind; k++) {
    tt += 0.1;
    away.hdgDeg = 180;
    away.vx = 0;
    away.vz = 45;
    away.z += 4.5;
    PR.updateClaim(c4, away, rws, tt);
  }
  ok('claims: the circuit, then away from it — it ends', c4.kind === null && tt < 25, `ended after ${tt.toFixed(1)} s at ${Math.round(away.z - rw.cz)} m off`);
  // Landed, rolled out, taxied off sideways: two seconds after you are off it.
  set({ x: rw.cx, onGround: true });
  step(1);
  let offT = 0;
  let z = rw.cz;
  for (let k = 0; k < 200 && cl.kind; k++) {
    z += 0.8;
    set({ x: rw.cx, z, onGround: true, hdgDeg: 180, vz: 8, gs: 8 });
    t += 0.1;
    PR.updateClaim(cl, p, rws, t);
    if (Math.abs(z - rw.cz) > rw.halfWidth + PR.PRIORITY.onMargin) offT += 0.1;
  }
  ok('claims: taxied clear of the runway, it ends two seconds later', cl.kind === null && offT > 1.8 && offT < 2.4, `${offT.toFixed(1)} s after the edge`);
  // On the edge: no flicker.
  const c6 = PR.newClaim();
  let flips = 0;
  let last = null;
  for (let k = 0; k < 300; k++) {
    const zz = rw.cz + rw.halfWidth + PR.PRIORITY.onMargin + (k % 20 < 10 ? -1 : 1);
    PR.updateClaim(c6, { ...PR.blankPilot(), x: rw.cx, z: zz, onGround: true }, rws, k * 0.1);
    if (c6.kind !== last) flips++;
    last = c6.kind;
  }
  ok('claims: wobbling on the edge of the runway does not flick it on and off', flips <= 1 && c6.episode === 1, `${flips} changes, ${c6.episode} episode(s)`);
  // Parked half-way up 18/36, clear of 09/27: still yours, but after half a minute it holds 09/27 no more; roll, and it does again.
  const r2b = A.runway2;
  const c7 = PR.newClaim();
  const parked = { ...PR.blankPilot(), x: r2b.cx, z: r2b.cz - r2b.length * 0.3, onGround: true, hdgDeg: 180, halfSpan: 6 };
  let blockAt29 = null;
  for (let k = 0; k <= 320; k++) {
    PR.updateClaim(c7, parked, rws, k * 0.1);
    if (k === 290) blockAt29 = PR.blocksMain(c7);
  }
  const parkedOff = c7.kind === 'runway' && !PR.blocksMain(c7);
  PR.updateClaim(c7, { ...parked, gs: 5, vz: 5 }, rws, 32.1);
  ok('claims: parked on 18/36 clear of 09/27 — still yours, but after 30 s the traffic may use 09/27 past you; rolling, it holds again',
    blockAt29 === true && parkedOff && PR.blocksMain(c7), `at 29 s ${blockAt29}, at 32 s ${parkedOff ? 'parked off' : 'still holding'}, rolling ${PR.blocksMain(c7)}`);
  // Parked in the middle of 09/27 itself: always holding.
  const c8 = PR.newClaim();
  for (let k = 0; k <= 400; k++) PR.updateClaim(c8, { ...PR.blankPilot(), x: rw.cx - 200, z: rw.cz, onGround: true }, rws, k * 0.1);
  ok('claims: parked on 09/27 itself, it holds the traffic however long you sit there', PR.blocksMain(c8), `${c8.kind}`);
}

/* ------------------------------------------------------- 1b. flying past, not landing */
/*
 * The review (round 2) flew Kestrel low WITHOUT landing, through the real
 * hooks — a lap of the island 2.2 km out at 250 m, a star hunt zig-zag at
 * 200 m — and the first cut's circuit claimed the runway 88-100% of the time:
 * no landings, no take-offs, thirteen tower pop-ups in a quarter of an hour.
 * The same flights here, ten minutes each, in the trainer (wheels fixed, no
 * flaps, no autopilot): the runway is the traffic's, the tower says nothing
 * to you, and the only claim the zig-zag gets is 'final', on its one leg
 * along the runway's own line at 200 m — which is where an aeroplane on
 * final is, and a real tower would treat it so.
 */
function tour(label, seed, pathFn, secs, { typeId = 'skylark', gearDown = true } = {}) {
  H.loadMap('kestrel');
  const sim = H.makeSim({ typeId, wind: [90, 3] });
  const said = [];
  sim.speak = (text) => said.push(String(text));
  // Away and high while the traffic starts up, as if you had just climbed out.
  H.placePlayer(sim, 6000, -4000, { headingDeg: 270, agl: 800, speed: 50 });
  H.startFlight(sim, { trafficSeed: seed });
  const W = H.makeWatch(sim);
  let claim = 0;
  let episodes = 0;
  let last = null;
  const kinds = {};
  H.run(sim, W, secs, 0.1, (t, dt) => {
    const pp = pathFn(t);
    H.placePlayer(sim, pp.x, pp.z, { headingDeg: pp.hdg, agl: pp.agl, speed: 50 });
    sim.aircraft.vel.y = pp.vy || 0;
    sim.aircraft.gearDown = gearDown;
    const pr = TF.priorityState();
    if (pr.me.kind) {
      claim += dt;
      kinds[pr.me.kind] = (kinds[pr.me.kind] || 0) + dt;
    }
    if (pr.me.kind && !last) episodes++;
    last = pr.me.kind;
  });
  const s = H.summary(W);
  const tower = sim.notes.filter((n) => /^Tower:|free again/.test(n));
  return {
    label, seed, claimPct: +((100 * claim) / secs).toFixed(1), episodes, kinds: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, Math.round(v)])),
    landings: W.landings, departures: W.departures, towerToasts: tower.length, toasts: sim.notes.slice(0, 6), said: said.slice(0, 6), threw: s.threw,
  };
}
{
  const rw = TR.AIRPORT.runway;
  const lap = (R, agl) => (t) => {
    const a = (50 / R) * t;
    return { x: rw.cx + R * Math.sin(a), z: rw.cz - R * Math.cos(a), agl, hdg: ((Math.atan2(Math.cos(a), -Math.sin(a)) * 180) / Math.PI + 360) % 360 };
  };
  const PTS = [[-2500, -1800], [2400, -2200], [2600, 1500], [-1800, 2200], [-2800, -400], [1000, 400], [3000, -300], [-500, -2500]];
  const hunt = (agl) => {
    const legs = [];
    let t0 = 0;
    for (let i = 0; i < PTS.length * 4; i++) {
      const [ax, az] = PTS[i % PTS.length];
      const [bx, bz] = PTS[(i + 1) % PTS.length];
      const d = Math.hypot(bx - ax, bz - az);
      legs.push({ ax, az, bx, bz, t0, t1: t0 + d / 50 });
      t0 += d / 50;
    }
    return (t) => {
      const L = legs.find((l) => t < l.t1) || legs[legs.length - 1];
      const f = Math.min(1, (t - L.t0) / (L.t1 - L.t0));
      return { x: L.ax + (L.bx - L.ax) * f, z: L.az + (L.bz - L.az) * f, agl, hdg: ((Math.atan2(L.bx - L.ax, -(L.bz - L.az)) * 180) / Math.PI + 360) % 360 };
    };
  };
  const T1 = tour('a lap of the island, 2.2 km out at 250 m', 3, lap(2200, 250), 600);
  ok('flying past: a lap of the island at 250 m for ten minutes — never yours, the tower says nothing to you, and the traffic lands and takes off',
    !T1.threw && T1.claimPct === 0 && T1.episodes === 0 && T1.towerToasts === 0 && T1.landings + T1.departures >= 1,
    T1.threw || `claimed ${T1.claimPct}% in ${T1.episodes} episode(s) ${JSON.stringify(T1.kinds)}; ${T1.landings} landing(s), ${T1.departures} take-off(s); tower toasts ${T1.towerToasts}: ${T1.toasts.join(' | ')}`);
  const T2 = tour('a star hunt zig-zag over the island at 200 m', 7, hunt(200), 600);
  ok('flying past: a star hunt zig-zag over the island at 200 m — no circuit claim; the one leg along the runway\'s line is a final, held for but never spoken of (level is not landing); the traffic still uses the runway',
    !T2.threw && !T2.kinds.circuit && T2.claimPct <= 12 && T2.towerToasts === 0 && T2.landings + T2.departures >= 1,
    T2.threw || `claimed ${T2.claimPct}% in ${T2.episodes} episode(s) ${JSON.stringify(T2.kinds)}; ${T2.landings} landing(s), ${T2.departures} take-off(s); tower toasts ${T2.towerToasts}: ${T2.toasts.join(' | ')}`);
  /*
   * Round 3. The same lap in a Courier whose wheels have never been up —
   * the kid took off and never pressed G. The second cut read wheels down on
   * a retractable as a sign of landing and held the runway for the whole
   * lap (96% claimed, nothing landed or took off in fifteen minutes).
   */
  const T3 = tour('a lap of the island at 250 m, Courier, wheels never raised', 3, lap(2200, 250), 600, { typeId: 'courier', gearDown: true });
  ok('flying past: the same lap in a Courier with the wheels down since take-off — no sign of landing: never yours, the tower says nothing, the traffic lands and takes off',
    !T3.threw && T3.claimPct === 0 && T3.episodes === 0 && T3.towerToasts === 0 && T3.landings + T3.departures >= 1,
    T3.threw || `claimed ${T3.claimPct}% in ${T3.episodes} episode(s) ${JSON.stringify(T3.kinds)}; ${T3.landings} landing(s), ${T3.departures} take-off(s); tower toasts ${T3.towerToasts}: ${T3.toasts.join(' | ')}`);
  /*
   * A kid's star hunt, the way one is really flown: each leg to the next
   * star at that star's own height (150-400 m), climbing or descending to it
   * at 1.5-3 m/s, level once there. The descents near the field are signs
   * of landing (the circuit holds the traffic — the safe way round), but
   * the tower keeps QUIET about them: when a descent alone was spoken of
   * (circTalkAfter, 20 s in) this flight got nine pop-ups a quarter hour.
   * Seeded, so the same for every build.
   */
  const kidHunt = (rseed) => {
    let x = rseed * 9301 + 49297;
    const rnd = () => {
      x = (x * 9301 + 49297) % 233280;
      return x / 233280;
    };
    const legs = [];
    let t0 = 0;
    let h = 250;
    for (let i = 0; i < PTS.length * 4; i++) {
      const [ax, az] = PTS[i % PTS.length];
      const [bx, bz] = PTS[(i + 1) % PTS.length];
      const d = Math.hypot(bx - ax, bz - az);
      const h1 = 150 + Math.round(rnd() * 250);
      const rate = 1.5 + rnd() * 1.5;
      legs.push({ ax, az, bx, bz, t0, t1: t0 + d / 50, h0: h, h1, rate });
      t0 += d / 50;
      h = h1;
    }
    return (t) => {
      const L = legs.find((l) => t < l.t1) || legs[legs.length - 1];
      const f = Math.min(1, (t - L.t0) / (L.t1 - L.t0));
      const dt = t - L.t0;
      const dh = L.h1 - L.h0;
      const tChange = Math.abs(dh) / L.rate;
      return {
        x: L.ax + (L.bx - L.ax) * f, z: L.az + (L.bz - L.az) * f,
        agl: dt < tChange ? L.h0 + Math.sign(dh) * L.rate * dt : L.h1, vy: dt < tChange ? Math.sign(dh) * L.rate : 0,
        hdg: ((Math.atan2(L.bx - L.ax, -(L.bz - L.az)) * 180) / Math.PI + 360) % 360,
      };
    };
  };
  const T4 = tour("a kid's star hunt, each star its own height", 7, kidHunt(7), 600);
  ok("flying past: a kid's star hunt with real climbs and descents, 150-400 m, in the trainer — the tower never speaks to you (a descent near the field holds the traffic quietly), the runway is yours under half the time, and the traffic still lands and takes off",
    !T4.threw && T4.towerToasts === 0 && T4.claimPct < 50 && T4.landings + T4.departures >= 1,
    T4.threw || `claimed ${T4.claimPct}% in ${T4.episodes} episode(s) ${JSON.stringify(T4.kinds)}; ${T4.landings} landing(s), ${T4.departures} take-off(s); tower toasts ${T4.towerToasts}: ${T4.toasts.join(' | ')}`);
  NUM.flyingPast = [T1, T2, T3, T4];
}

/* ---------------------------------------------------------------- 2. a whole flight */
const RUN = [];
function flight(seed, wind, quality = 'low') {
  H.loadMap('kestrel', quality);
  const sim = H.makeSim({ typeId: 'skylark', quality, wind });
  const said = [];
  sim.speak = (text) => said.push([sim.__t || 0, text]);
  const f = F.buildField();
  const A = TR.AIRPORT;
  const rw = A.runway;
  const ac = sim.aircraft;
  const far = () => H.placePlayer(sim, f.cx, f.cz - 20000, { headingDeg: 90, agl: 2000, speed: 0 });
  far();
  const r = H.startFlight(sim, { trafficSeed: seed });
  const tag = `flight seed ${seed}, traffic on ${wind[0] === 270 ? '27' : '09'}${quality !== 'low' ? `, apron at ${quality}` : ''}`;
  if (!ok(`${tag}: the flight starts with traffic`, r.ok && TF.trafficState().on, r.ok ? TF.trafficState().why : String(r.err))) return null;
  const W = H.makeWatch(sim);
  const M = {
    seed, wind: wind[0], phases: [], spawned: [],
    landOnYou: [], rollOnYou: [], rollAheadOfYou: [], rollClimb: [], rollFinal: [], expedited: [], rollLate: [], landedAheadOnFinal: [],
    touchdown: null, liftoff: null, releasedAfterTakeoff: null, releasedAfterTaxi: null, usesAway: 0, usesAfter: 0, goArounds: 0,
    linesByEpisode: {},
  };
  const T_LINE = 100;
  const T_ROLL = 160;
  const T_BACK = 640;
  let ph = 'away0';
  let x = 0;
  let v = 0;
  let agl = 0;
  let z = 0;
  let claimSince = -1;
  let claimKind = null;
  let liftedAt = null;
  let offAt = null;
  let edgeAt = null;
  const st0 = TF.priorityState().stats;
  let lineupIds = new Set();
  const prevPhase = new Map();
  const prevV = new Map();
  const near = (c) => c.onGround && Math.abs(c.pos[2] - rw.cz) <= rw.halfWidth + c.span / 2 && Math.abs(c.pos[0] - rw.cx) <= rw.length / 2;
  const tdX = f.west + 250;
  const each = (t, dt) => {
    sim.__t = t;
    // ---- the player
    if (ph === 'away0' && t >= T_LINE - 10 && !M.spawned.includes('a1')) {
      const s = TF.spawnTraffic(sim, 'arrive');
      M.spawned.push(s.ok ? 'a1' : `a1:${s.why}`);
    }
    if (ph === 'away0' && t >= T_LINE) {
      ph = 'lined';
      x = f.west + 80;
      H.placePlayer(sim, x, f.cz, { headingDeg: 90 });
      M.phases.push(['lined up', Math.round(t)]);
    }
    if (ph === 'lined' && t >= T_ROLL) {
      ph = 'roll';
      v = 0;
      agl = 0;
      M.phases.push(['rolling', Math.round(t)]);
    }
    if (ph === 'roll' || ph === 'climb') {
      v = Math.min(45, v + 2.5 * dt);
      x += v * dt;
      if (v > 33) agl = Math.min(600, agl + 4 * dt);
      if (agl > 0 && liftedAt == null) {
        liftedAt = t;
        M.liftoff = Math.round(t);
        ph = 'climb';
      }
      if (x > f.east + 9000) {
        ph = 'away1';
        M.phases.push(['away', Math.round(t)]);
      }
      H.placePlayer(sim, x, f.cz, { headingDeg: 90, agl, speed: v });
      ac.vel.y = agl > 0 && agl < 600 ? 4 : 0;
    }
    if (ph === 'away1' && t >= T_BACK - 12 && !M.spawned.includes('a2')) {
      const s = TF.spawnTraffic(sim, 'arrive');
      M.spawned.push(s.ok ? 'a2' : `a2:${s.why}`);
    }
    if (ph === 'away1' && t >= T_BACK) {
      ph = 'final';
      x = tdX - 7000;
      v = 45;
      M.phases.push(['final, 7 km', Math.round(t)]);
    }
    if (ph === 'final') {
      x += v * dt;
      agl = Math.max(0, (tdX - x) * 0.0524);
      if (agl <= 0) {
        ph = 'rollout';
        M.phases.push(['touchdown', Math.round(t)]);
        // Who is on the runway in front of you as your wheels touch?
        const st = TF.trafficState();
        const inFront = st.craft.filter((c) => near(c) && c.pos[0] > x - 200);
        M.touchdown = { t: Math.round(t), x: Math.round(x), inFront: inFront.map((c) => `${c.callsign} ${c.phase} at x ${Math.round(c.pos[0])}`) };
      }
      H.placePlayer(sim, x, f.cz, { headingDeg: 90, agl, speed: v });
      ac.vel.y = agl > 0 ? -v * 0.0524 : 0;
    }
    if (ph === 'rollout') {
      v = Math.max(8, v - 2.5 * dt);
      x += v * dt;
      if (v <= 8) {
        ph = 'taxi';
        z = f.cz;
      }
      H.placePlayer(sim, x, f.cz, { headingDeg: 90, speed: v });
    }
    if (ph === 'taxi') {
      // Off the runway, straight to the airfield side, at taxi speed.
      z += f.side * 6 * dt;
      H.placePlayer(sim, x, z, { headingDeg: f.side > 0 ? 180 : 0, speed: 6 });
      // Past the edge the claim counts from (the runway's, plus its margin).
      if (edgeAt == null && Math.abs(z - f.cz) > rw.halfWidth + PR.PRIORITY.onMargin) edgeAt = t;
      if (Math.abs(z - f.cz) > rw.halfWidth + 40) {
        ph = 'clear';
        offAt = t;
        M.phases.push(['taxied clear', Math.round(t)]);
      }
    }
    if (ph === 'clear' && t - offAt > 6) {
      // Gone home (out of everybody's way) — the runway is theirs.
      ph = 'away2';
      far();
    }
    // ---- the claim, and what the traffic does about it
    const pr = TF.priorityState();
    const kind = pr.me.kind;
    if (kind !== claimKind) {
      if (kind && !claimKind) claimSince = t;
      if (!kind && claimKind === 'climb' && M.releasedAfterTakeoff == null && liftedAt != null) M.releasedAfterTakeoff = +(t - liftedAt).toFixed(1);
      if (!kind && claimKind === 'runway' && edgeAt != null && M.releasedAfterTaxi == null) M.releasedAfterTaxi = +(t - edgeAt).toFixed(1);
      if ((kind === 'final' || kind === 'circuit') && claimKind !== 'final' && claimKind !== 'circuit') {
        // Already cleared on to the runway when you joined final: lining up, or lined up and paused.
        const cs = TF.trafficState().craft;
        lineupIds = new Set(cs.filter((c) => (c.phase === 'takeoff' && c.v < 1) || c.phase === 'lineup').map((c) => c.id));
        M.atFinal = cs.map((c) => `${c.callsign}:${c.phase}/${c.state}`).join(' ');
      }
      claimKind = kind;
    }
    for (const c of TF.trafficState().craft) {
      const pp = prevPhase.get(c.id);
      const pv = prevV.get(c.id) || 0;
      // A touchdown: on to the runway out of the air.
      if (pp && (pp === 'landing' || pp === 'approach') && c.phase === 'rollout') {
        const what = `${c.callsign} t ${Math.round(t)} (claim ${kind || '-'} for ${kind ? Math.round(t - claimSince) : 0} s)`;
        if (kind === 'runway' && t - claimSince > 3) M.landOnYou.push(what);
        if (kind === 'final' || kind === 'circuit') M.landedAheadOnFinal.push(what);
        if (!kind && (ph === 'away1' || ph === 'away2')) {
          if (ph === 'away1') M.usesAway++;
          else M.usesAfter++;
        }
      }
      // A take-off roll starting: in the take-off phase, from standing to moving.
      if (c.phase === 'takeoff' && pv < 1 && c.v >= 1) {
        const what = `${c.callsign} t ${Math.round(t)} (claim ${kind || '-'})`;
        if (kind === 'runway') {
          // R3: lined up ahead of you when you came on behind it, it goes away from you.
          const p0 = sim.aircraft.pos;
          const dir = c.hdgDeg > 0 && c.hdgDeg < 180 ? 1 : -1;
          if ((p0.x - c.pos[0]) * dir < -10) M.rollAheadOfYou.push(what);
          else M.rollOnYou.push(what);
        } else if (kind === 'climb') M.rollClimb.push(what);
        else if (kind === 'final' || kind === 'circuit') {
          if (lineupIds.has(c.id)) M.expedited.push(what);
          else M.rollFinal.push(what);
          // Cleared on to it before you joined or not: never rolling with you due in under a minute (ROLL_NEED).
          if (pr.needAt != null && pr.needAt < 55) M.rollLate.push(`${what} needAt ${pr.needAt}`);
        } else if (ph === 'away1') M.usesAway++;
        else if (ph === 'away2') M.usesAfter++;
      }
      prevPhase.set(c.id, c.phase);
      prevV.set(c.id, c.v);
    }
  };
  H.run(sim, W, T_BACK + 220 + 300, 0.1, each);
  const s = H.summary(W);
  // (The module's counts are for the session: this flight's are the difference.)
  const pr = TF.priorityState().stats;
  M.goArounds = pr.priorityGoArounds - st0.priorityGoArounds;
  M.holdsSaid = pr.holdsSaid - st0.holdsSaid;
  M.freeSaid = pr.freeSaid - st0.freeSaid;
  M.claims = pr.claims - st0.claims;
  M.expeditedCount = pr.expedited - st0.expedited;
  M.said = said.map(([tt, l]) => `${Math.round(tt)}s ${l}`);
  M.harness = { throughPlayer: s.throughPlayer, touchingPlayer: s.touchingPlayer, merged: s.merged, airHit: s.airHit, under: s.under, nan: s.nan, jumps: s.jumps, deadlocks: s.deadlocks, departures: s.departures, landed: s.landed };
  ok(`${tag}: no hook threw`, !s.threw, s.threw || '');
  ok(`${tag}: nobody through you, inside anybody, through anybody in the air, under the ground, or jumping`,
    s.throughPlayer === 0 && s.touchingPlayer === 0 && s.merged === 0 && s.touching === 0 && s.airHit === 0 && s.under === 0 && s.nan === 0 && s.jumps === 0,
    JSON.stringify({ p: s.playerFirst || s.touchPlayerFirst, m: s.mergedFirst || s.touchFirst, a: s.airHitFirst, u: s.underFirst, j: s.jumpFirst }));
  ok(`${tag}: you flew the whole flight`, M.phases.map((p) => p[0]).join(',') === 'lined up,rolling,away,final, 7 km,touchdown,taxied clear', M.phases.map((p) => `${p[0]}@${p[1]}`).join(' '));
  ok(`${tag}: while you are on the runway, nobody lands on it`, M.landOnYou.length === 0, M.landOnYou.join('; '));
  ok(`${tag}: while you are on the runway, nobody starts a take-off roll at you`, M.rollOnYou.length === 0, M.rollOnYou.join('; '));
  ok(`${tag}: while you climb away, nobody starts a take-off roll`, M.rollClimb.length === 0, M.rollClimb.join('; '));
  ok(`${tag}: while you are on final, nobody starts a take-off roll (unless it was already cleared on to the runway before you joined)`, M.rollFinal.length === 0, M.rollFinal.join('; '));
  ok(`${tag}: ... and even one that was never starts its roll with you due in under 55 s`, M.rollLate.length === 0, M.rollLate.join('; '));
  ok(`${tag}: when you touch down, nobody is on the runway in front of you`, M.touchdown && M.touchdown.inFront.length === 0, M.touchdown ? M.touchdown.inFront.join('; ') : 'no touchdown');
  ok(`${tag}: the runway is theirs again within 90 s of lifting off`, M.releasedAfterTakeoff != null && M.releasedAfterTakeoff < 90, `${M.releasedAfterTakeoff} s`);
  ok(`${tag}: ... and within 3 s of taxiing clear of it`, M.releasedAfterTaxi != null && M.releasedAfterTaxi <= 3, `${M.releasedAfterTaxi} s`);
  ok(`${tag}: the tower spoke for you at most once each time the runway was yours`, M.holdsSaid <= M.claims, `${M.holdsSaid} lines in ${M.claims} claims: ${M.said.join(' | ')}`);
  RUN.push({ tag, ...M });
  return M;
}

const plans = QUICK
  ? [[1, [90, 3]], [2, [270, 12]]]
  : [[1, [90, 3]], [2, [90, 3]], [3, [90, 3]], [4, [270, 12]], [5, [270, 12]], [6, [270, 12]], [7, [90, 3], 'high'], [8, [270, 12], 'high']];
const onlySeed = args.find((a) => a.startsWith('--seed='));
for (const [seed, wind, q] of plans) if (!onlySeed || +onlySeed.slice(7) === seed) flight(seed, wind, q);
{
  const sum = (k) => RUN.reduce((a, m) => a + (Array.isArray(m[k]) ? m[k].length : m[k] || 0), 0);
  const withHold = RUN.filter((m) => m.holdsSaid > 0).length;
  ok('flights: the traffic used the runway while you were away (take-offs and landings, all flights)', sum('usesAway') >= RUN.length, `${sum('usesAway')} in ${RUN.length} flights (${RUN.map((m) => m.usesAway).join(',')})`);
  ok('flights: someone was held or sent round for you, and the tower said so, in most flights', withHold >= Math.ceil(RUN.length / 2), `${withHold} of ${RUN.length}; go-arounds ${sum('goArounds')}`);
  NUM.flights = RUN.map((m) => ({
    tag: m.tag, phases: m.phases, liftoff: m.liftoff, releasedAfterTakeoff: m.releasedAfterTakeoff, releasedAfterTaxi: m.releasedAfterTaxi,
    usesAway: m.usesAway, usesAfter: m.usesAfter, goArounds: m.goArounds, holdsSaid: m.holdsSaid, freeSaid: m.freeSaid,
    rollAheadOfYou: m.rollAheadOfYou, expedited: m.expedited, atFinal: m.atFinal, landedAheadOnFinal: m.landedAheadOnFinal, touchdown: m.touchdown, said: m.said, harness: m.harness, spawned: m.spawned,
  }));
  NUM.totals = { flights: RUN.length, usesAway: sum('usesAway'), usesAfter: sum('usesAfter'), goArounds: sum('goArounds'), rollAheadOfYou: sum('rollAheadOfYou'), expedited: sum('expedited'), landedAheadOnFinal: sum('landedAheadOnFinal'), withTowerLine: withHold };
}

/* ------------------------------------- 2b. already on the runway when you join final */
/*
 * The review's seed 5: a Courier leaving by the middle connector had to
 * backtrack the length of 09 — 130 s at taxi speed — and was still on it,
 * lining up, when you joined an 8 km final. Nothing counted the time it had
 * left: it lined up with you a kilometre out, was told "go now", and lifted
 * off as you passed 250 m, while the tower named the aeroplane holding short
 * as the one being held for you. Here a Tempest is made to backtrack the same
 * way (the threshold connector is taken: you are parked on it), and:
 *   - you join a 6.5 km final: it gives up the departure and leaves the
 *     runway by the nearest exit, the tower names IT, nothing rolls at you,
 *     the runway is empty when you touch down — and once you are off, it
 *     departs after all;
 *   - you join an 8 km final at 40 m/s instead: it has time, lines up, is
 *     told to go, and is airborne well before you — never starting its roll
 *     with you due in under ROLL_NEED (60 s).
 */
function backtracker(seed, parkX) {
  H.loadMap('kestrel');
  const sim = H.makeSim({ typeId: 'skylark', wind: [90, 3] });
  const said = [];
  sim.speak = (text) => said.push([sim.__t || 0, text]);
  const f = F.buildField();
  // Parked on the threshold connector, off the runway and off the taxiway: the departure takes the next one.
  H.placePlayer(sim, parkX, f.cz - 70, { headingDeg: 90 });
  H.startFlight(sim, { trafficSeed: seed });
  TF.clearTraffic(sim);
  const d = TF.spawnTraffic(sim, 'depart', 'tempest');
  const W = H.makeWatch(sim);
  let onIt = null;
  // A second at a time, and no further once it is on the runway: the player joins final in THAT moment.
  while (!onIt && W.t < 300 && !W.threw) {
    H.run(sim, W, 1, 0.1, (t) => {
      sim.__t = t;
      if (onIt) return;
      const c = TF.trafficState().craft.find((x) => x.id === d.id);
      if (c && c.leg === 'lineup' && c.onGround && TR.isOnRunway(c.pos[0], c.pos[2], 2)) onIt = { t, x: c.pos[0], s: c.s, len: c.legLength };
    });
  }
  return { sim, said, f, d, W, onIt };
}
const tdX = (f) => f.west + 250;
/** Fly a straight-in final from `dist` out at `v` m/s until touchdown, then roll out and taxi off; `each` sees every frame. */
function flyFinal(sim, f, W, dist, v, each) {
  let x = tdX(f) - dist;
  let ph = 'final';
  let z = f.cz;
  const out = { touchdown: null, clearAt: null };
  const t0 = W.t;
  const step = (t, dt) => {
    sim.__t = t;
    if (ph === 'final') {
      x += v * dt;
      const agl = Math.max(0, (tdX(f) - x) * 0.0524);
      if (agl <= 0) {
        ph = 'rollout';
        const near = TF.trafficState().craft.filter((c) => c.onGround && Math.abs(c.pos[2] - f.cz) <= TR.AIRPORT.runway.halfWidth + c.span / 2 && Math.abs(c.pos[0] - f.cx) <= f.length / 2 && c.pos[0] > x - 200);
        out.touchdown = { t: +t.toFixed(1), inFront: near.map((c) => `${c.callsign} ${c.phase} at x ${Math.round(c.pos[0])}`) };
      }
      H.placePlayer(sim, x, f.cz, { headingDeg: 90, agl, speed: v });
      sim.aircraft.vel.y = agl > 0 ? -v * 0.0524 : 0;
    } else if (ph === 'rollout') {
      v = Math.max(8, v - 2.5 * dt);
      x += v * dt;
      if (v <= 8) ph = 'taxi';
      H.placePlayer(sim, x, f.cz, { headingDeg: 90, speed: v });
    } else if (ph === 'taxi') {
      z += f.side * 6 * dt;
      H.placePlayer(sim, x, z, { headingDeg: f.side > 0 ? 180 : 0, speed: 6 });
      if (Math.abs(z - f.cz) > TR.AIRPORT.runway.halfWidth + 40) {
        ph = 'clear';
        out.clearAt = t;
      }
    } else if (ph === 'clear') {
      if (t - out.clearAt > 6) {
        H.placePlayer(sim, f.cx, f.cz - 20000, { headingDeg: 90, agl: 2000, speed: 0 });
        ph = 'away';
        out.awayAt = t;
      }
    }
    if (each) each(t, dt, ph);
  };
  // A second at a time: until you have been gone 150 s, or 400 s in all.
  while (W.t - t0 < 400 && !W.threw && !(ph === 'away' && W.t - out.awayAt > 150)) H.run(sim, W, 1, 0.1, step);
  return out;
}
{
  const B = backtracker(5, -430);
  const { sim, said, f, d, W } = B;
  ok('backtrack: a Tempest leaving by the middle connector backtracks along 09 (the threshold connector is taken)',
    d.ok && !!B.onIt && B.onIt.len > 500 && B.onIt.s < B.onIt.len - 250,
    d.ok ? (B.onIt ? `on the runway at t ${Math.round(B.onIt.t)} s, ${Math.round(B.onIt.len - B.onIt.s)} m of line-up to go` : 'never on the runway lining up') : d.why);
  if (B.onIt) {
    const st0 = TF.priorityState().stats;
    const prev = new Map();
    const rolls = [];
    let vacated = null;
    let claimKinds = new Set();
    let minNeedWhileOn = Infinity;
    let departedAfter = null;
    const td = flyFinal(sim, f, W, 6500, 45, (t, dt, ph) => {
      const pr = TF.priorityState();
      claimKinds.add(pr.me.kind);
      for (const c of TF.trafficState().craft) {
        const p = prev.get(c.id) || { phase: null, v: 0 };
        if (c.id === d.id) {
          // A roll while you have any claim on the runway (on final, on it, climbing away): never. (Once you are gone it may go: departedAfter.)
          if (c.phase === 'takeoff' && p.v < 1 && c.v >= 1 && pr.me.kind) rolls.push(`t ${Math.round(t)} claim ${pr.me.kind} needAt ${pr.needAt}`);
          if (c.phase === 'vacate' && vacated == null) vacated = { t: +t.toFixed(1), needAt: pr.needAt };
          if (c.onGround && TR.isOnRunway(c.pos[0], c.pos[2], 2) && pr.me.kind === 'final' && pr.needAt != null) minNeedWhileOn = Math.min(minNeedWhileOn, pr.needAt);
          if (ph === 'away' && c.phase === 'takeoff' && c.v > 1 && departedAfter == null) departedAfter = +t.toFixed(0);
        }
        prev.set(c.id, { phase: c.phase, v: c.v });
      }
    });
    const st = TF.priorityState().stats;
    const line = said.map(([, l]) => l).find((l) => /vacate runway zero nine/.test(l));
    const tempest = TF.trafficState().craft.find((c) => c.id === d.id);
    ok('backtrack: you join a 6.5 km final — it does not finish the line-up in front of you: it leaves the runway by the nearest exit',
      !!vacated && st.cancelled - st0.cancelled >= 1 && vacated.t - B.onIt.t < 95, // a back-track is 10 m/s now: it first tries to finish, then gives it up
      vacated ? `off its line-up ${(vacated.t - B.onIt.t).toFixed(1)} s after you joined, with you due in ${vacated.needAt} s; ${st.cancelled - st0.cancelled} cancelled` : 'it stayed on its line-up');
    ok('backtrack: ... nothing starts a take-off roll at you', rolls.length === 0, rolls.join('; '));
    ok('backtrack: ... it is off the runway long before you could need it (never on it with you under 40 s out)', minNeedWhileOn >= 40, `still on it with you ${minNeedWhileOn} s out`);
    ok('backtrack: ... the tower names the aeroplane on the runway, once: "vacate runway zero nine, traffic on final"',
      !!line && tempest && line.startsWith(tempest.callsign.replace(/\d+$/, '').trim()) && said.filter(([, l]) => /vacate runway|hold short runway|go around, traffic|make a three-sixty/.test(l)).length === 1,
      said.map(([t, l]) => `${Math.round(t)}s ${l}`).join(' | ') || 'nothing said');
    ok('backtrack: ... when you touch down, nobody is on the runway in front of you', td.touchdown && td.touchdown.inFront.length === 0, td.touchdown ? td.touchdown.inFront.join('; ') : 'no touchdown');
    ok('backtrack: ... and once you have taxied clear and gone, it departs after all', departedAfter != null, departedAfter != null ? `rolled at t ${departedAfter} s` : `never rolled (${tempest ? `${tempest.phase}/${tempest.state}` : 'gone'})`);
    const s = H.summary(W);
    ok('backtrack: nobody through you, inside anybody, under the ground, or jumping', s.throughPlayer === 0 && s.touchingPlayer === 0 && s.merged === 0 && s.airHit === 0 && s.under === 0 && s.jumps === 0 && !s.threw,
      s.threw || JSON.stringify({ p: s.playerFirst || s.touchPlayerFirst, m: s.mergedFirst, a: s.airHitFirst, u: s.underFirst, j: s.jumpFirst }));
    NUM.backtrackClose = { onItAt: Math.round(B.onIt.t), vacated, rolls, minNeedWhileOn, touchdown: td.touchdown, departedAfter, said: said.map(([t, l]) => `${Math.round(t)}s ${l}`) };
  }
}
{
  const B = backtracker(5, -430);
  const { sim, f, d, W } = B;
  if (B.onIt) {
    const prev = new Map();
    const rolls = [];
    let liftOff = null;
    let vacated = false;
    const td = flyFinal(sim, f, W, 8000, 40, (t) => {
      const pr = TF.priorityState();
      for (const c of TF.trafficState().craft) {
        const p = prev.get(c.id) || { phase: null, v: 0, onGround: true };
        if (c.id === d.id) {
          if (c.phase === 'takeoff' && p.v < 1 && c.v >= 1) rolls.push({ t: +t.toFixed(1), needAt: pr.needAt });
          if (p.onGround && !c.onGround && liftOff == null) liftOff = { t: +t.toFixed(1), needAt: pr.needAt, youOut: Math.round(tdX(f) - sim.aircraft.pos.x) };
          if (c.phase === 'vacate') vacated = true;
        }
        prev.set(c.id, { phase: c.phase, v: c.v, onGround: c.onGround });
      }
    });
    ok('backtrack: you join an 8 km final at 40 m/s instead — it has time: it finishes lining up and is told to go', rolls.length === 1 && !vacated, `${rolls.length} roll(s) ${JSON.stringify(rolls)}, vacated ${vacated}`);
    ok('backtrack: ... its roll starts with you at least 60 s out', rolls.length === 1 && rolls[0].needAt >= 60, JSON.stringify(rolls));
    ok('backtrack: ... it is airborne with you still more than a kilometre out', !!liftOff && liftOff.youOut > 1000 && liftOff.needAt >= 25, JSON.stringify(liftOff));
    ok('backtrack: ... and nobody is on the runway when you touch down', td.touchdown && td.touchdown.inFront.length === 0, td.touchdown ? td.touchdown.inFront.join('; ') : 'no touchdown');
    const s = H.summary(W);
    ok('backtrack (far): nobody through you, inside anybody, under the ground, or jumping', s.throughPlayer === 0 && s.touchingPlayer === 0 && s.merged === 0 && s.airHit === 0 && s.under === 0 && s.jumps === 0 && !s.threw, s.threw || '');
    NUM.backtrackFar = { rolls, liftOff, touchdown: td.touchdown };
  } else ok('backtrack (far): the Tempest lined up on the runway', false, 'never on the runway lining up');
}

/* ------------------------------------------- 2c. put down on the runway by a reset */
/*
 * "Return to the airfield" (and the taxi lesson's "Skip to runway") put you
 * at the start of 09 — where the traffic lines up. The review: on three seeds
 * of three an AI aeroplane was there, twice 10 m from you, once with its
 * nose 3 m behind your tail, and the tower said the runway was yours. The
 * game now tells the features (`placed`); the traffic clears the runway.
 */
{
  let done = false;
  for (const seed of [21, 3, 5, 11, 2]) {
    if (done) break;
    H.loadMap('kestrel');
    const sim = H.makeSim({ typeId: 'skylark', wind: [90, 3] });
    const f = F.buildField();
    const rw = TR.AIRPORT.runway;
    const spot = { x: f.west + 80, z: f.cz };
    H.placePlayer(sim, f.cx + 9000, f.cz - 6000, { headingDeg: 45, agl: 700, speed: 55 });
    H.startFlight(sim, { trafficSeed: seed });
    const W = H.makeWatch(sim);
    let found = null;
    // A second at a time, stopping in the moment one is there — the moment the child presses the button.
    while (!found && W.t < 600 && !W.threw) {
      H.run(sim, W, 1, 0.1, (t) => {
        if (found) return;
        for (const c of TF.trafficState().craft) {
          if ((c.phase === 'lineup' || c.phase === 'takeoff') && c.onGround && c.v < 3 && Math.hypot(c.pos[0] - spot.x, c.pos[2] - spot.z) < 120) found = { t: Math.round(t), id: c.id, callsign: c.callsign, phase: c.phase, d: Math.round(Math.hypot(c.pos[0] - spot.x, c.pos[2] - spot.z)) };
        }
      });
    }
    if (!found) continue;
    done = true;
    // The reset, as main.js does it: the aeroplane put down, then the features told.
    H.placePlayer(sim, spot.x, spot.z, { headingDeg: 90 });
    const r = H.call('placed', sim, 'airport');
    const after = TF.trafficState();
    const moved = after.craft.find((c) => c.id === found.id);
    const onRw = after.craft.filter((c) => c.onGround && TR.isOnRunway(c.pos[0], c.pos[2], c.span / 2 + 5) && !(c.phase === 'takeoff' && c.v > 10));
    // (The threshold connector's holding point is 59 m from where you appear: one holding short there is where it should be.)
    const nearYou = after.craft.filter((c) => c.onGround && Math.hypot(c.pos[0] - spot.x, c.pos[2] - spot.z) < 30);
    ok(`reset (seed ${seed}): an AI aeroplane was lined up where "Return to the airfield" puts you`, !!found, JSON.stringify(found));
    ok(`reset (seed ${seed}): told you have been put down there, the traffic clears the runway — nobody on it, nobody within 30 m of you`,
      r.ok && onRw.length === 0 && nearYou.length === 0 && after.priority.stats.resetMoved >= 1,
      `${onRw.map((c) => `${c.callsign} ${c.phase}`).join(', ') || 'runway empty'}; near you: ${nearYou.map((c) => c.callsign).join(', ') || 'nobody'}; moved ${after.priority.stats.resetMoved}`);
    ok(`reset (seed ${seed}): the one that was lining up is holding short again, or back on its slot`,
      !!moved && ((moved.state === 'waiting' && moved.phase === 'holding') || moved.state === 'parked'), moved ? `${moved.callsign}: ${moved.phase}/${moved.state} at (${Math.round(moved.pos[0])}, ${Math.round(moved.pos[2])})` : 'gone');
    // You sit there a while: it stays off, and the tower's line names one that really is being held.
    const said = [];
    sim.speak = (text) => said.push(text);
    let closest = Infinity;
    H.run(sim, W, 40, 0.1, () => {
      for (const c of TF.trafficState().craft) if (c.onGround) closest = Math.min(closest, Math.hypot(c.pos[0] - spot.x, c.pos[2] - spot.z));
    });
    const s = H.summary(W);
    const pr = TF.priorityState();
    ok(`reset (seed ${seed}): sitting there 40 s, nobody comes within 30 m of you on the ground, and nothing threw`, closest > 30 && !s.threw && s.throughPlayer === 0 && s.touchingPlayer === 0, `${closest.toFixed(1)} m; ${s.threw || ''}`);
    ok(`reset (seed ${seed}): the runway is yours, and the tower (if it spoke) named one holding short or circling for you`,
      pr.me.kind === 'runway' && said.every((l) => /hold short runway|make a three-sixty|go around, traffic|vacate runway/.test(l)), `${pr.me.kind}; ${said.join(' | ') || 'nothing said'}`);
    NUM.reset = { seed, found, moved: moved ? `${moved.phase}/${moved.state}` : null, closest: +closest.toFixed(1), said };
  }
  ok('reset: a seed put an AI aeroplane at the start of 09 within 10 min', done, done ? '' : 'none of 21, 3, 5, 11, 2 did');
}

/* ------------------------------------------ 2d. held for you, an arrival holds HIGH */
/*
 * At gate height the hold is a 360 on the final approach course, 100 m over a
 * child coming down final — which is a TRAFFIC caution on an ordinary
 * landing (the review: 25 s of it on a 5 km final). Held for a pilot's claim
 * it now climbs, a lap at a time, to 300 m above its gate, and comes down a
 * lap at a time once the runway is free before it lands.
 */
{
  H.loadMap('kestrel');
  const sim = H.makeSim({ typeId: 'skylark', wind: [90, 3] });
  const f = F.buildField();
  H.placePlayer(sim, f.west + 80, f.cz, { headingDeg: 90 });
  H.startFlight(sim, { trafficSeed: 7 });
  TF.clearTraffic(sim);
  const a = TF.spawnTraffic(sim, 'arrive', 'skylark');
  const W = H.makeWatch(sim);
  let y0 = null;
  let yMax = -Infinity;
  let maxRate = 0;
  let lastY = null;
  let orbitT = 0;
  H.run(sim, W, 240, 0.1, (t, dt) => {
    const c = TF.trafficState().craft.find((x) => x.id === a.id);
    if (!c) return;
    if (c.phase === 'orbit') {
      orbitT += dt;
      if (y0 == null) y0 = c.pos[1];
      yMax = Math.max(yMax, c.pos[1]);
    }
    if (lastY != null && !c.onGround) maxRate = Math.max(maxRate, Math.abs(c.pos[1] - lastY) / dt);
    lastY = c.pos[1];
  });
  const st = TF.priorityState().stats;
  ok('hold high: lined up on 09 with an arrival held for you, it climbs to hold 250 m and more above its gate within four minutes',
    a.ok && y0 != null && yMax - y0 >= 250 && st.holdsHigh >= 1, a.ok ? `from ${y0 == null ? '?' : Math.round(y0)} m up to ${Math.round(yMax)} m (${y0 == null ? '?' : Math.round(yMax - y0)} m) in ${orbitT.toFixed(0)} s of holding; holdsHigh ${st.holdsHigh}` : a.why);
  ok('hold high: ... climbing no faster than an aeroplane does (under 8 m/s)', maxRate < 8, `${maxRate.toFixed(1)} m/s`);
  // You leave: it comes down a lap at a time and lands.
  H.placePlayer(sim, f.cx, f.cz - 20000, { headingDeg: 90, agl: 2000, speed: 0 });
  let landedAt = null;
  let yAtApproach = null;
  H.run(sim, W, 420, 0.1, (t) => {
    const c = TF.trafficState().craft.find((x) => x.id === a.id);
    if (!c) return;
    if (c.phase === 'approach' && yAtApproach == null) yAtApproach = c.pos[1];
    if (c.phase === 'rollout' && landedAt == null) landedAt = Math.round(t);
    if (!c.onGround && lastY != null) maxRate = Math.max(maxRate, Math.abs(c.pos[1] - lastY) / 0.1);
    lastY = c.pos[1];
  });
  const s = H.summary(W);
  ok('hold high: ... you leave — it comes back down to gate height and lands within seven minutes', landedAt != null && yAtApproach != null && Math.abs(yAtApproach - y0) < 40,
    `landed ${landedAt == null ? 'never' : `at ${landedAt} s`}, started its approach at ${yAtApproach == null ? '?' : Math.round(yAtApproach)} m (gate ${y0 == null ? '?' : Math.round(y0)} m)`);
  ok('hold high: nothing jumped, nothing threw, nothing under the ground', s.jumps === 0 && !s.threw && s.under === 0 && maxRate < 8, s.threw || s.jumpFirst || s.underFirst || `${maxRate.toFixed(1)} m/s`);
  NUM.holdHigh = { y0: y0 == null ? null : Math.round(y0), yMax: Math.round(yMax), maxRate: +maxRate.toFixed(1), landedAt, yAtApproach: yAtApproach == null ? null : Math.round(yAtApproach), holdsHigh: st.holdsHigh };
}

/* ---------------------------------------------------------------- 3. a lobby */
{
  H.loadMap('kestrel');
  const sim = H.makeSim({ typeId: 'skylark', wind: [90, 3] });
  const f = F.buildField();
  const rw = TR.AIRPORT.runway;
  H.placePlayer(sim, f.cx, f.cz - 20000, { headingDeg: 90, agl: 2000, speed: 0 });
  // Another pilot, as mpworld.js hands them over on the host.
  const friend = { id: 3, x: f.west + 80, y: TR.AIRPORT.elev, z: f.cz, agl: 0, onGround: true, crashed: false, hdgDeg: 90, vx: 0, vy: 0, vz: 0, gs: 0, halfSpan: 6 };
  let others = [];
  TF.setOtherPilots(() => others);
  H.startFlight(sim, { trafficSeed: 11 });
  const W = H.makeWatch(sim);
  // Warm up with nobody about, then the friend lines up on 09 for three minutes.
  H.run(sim, W, 30, 0.1);
  others = [friend];
  let rolls = 0;
  let lands = 0;
  let waited = 0;
  const prev = new Map();
  H.run(sim, W, 180, 0.1, () => {
    for (const c of TF.trafficState().craft) {
      const p = prev.get(c.id);
      if (p && p.phase === 'takeoff' && p.v < 1 && c.v >= 1 && c.phase === 'takeoff') rolls++;
      if (p && (p.phase === 'landing' || p.phase === 'approach') && c.phase === 'rollout') lands++;
      if (c.state === 'waiting') waited += 0.1;
      prev.set(c.id, { phase: c.phase, v: c.v });
    }
  });
  const ps = TF.priorityState();
  ok('lobby: a friend lined up on 09 claims it — on the host, their claim holds the traffic like yours',
    ps.others.length === 1 && ps.others[0].kind === 'runway' && ps.blocks && ps.me.kind === null, JSON.stringify(ps.others));
  ok('lobby: ... nobody takes off or lands on them in three minutes, and departures wait', rolls === 0 && lands === 0 && waited > 0, `${rolls} rolls, ${lands} landings, ${waited.toFixed(0)} s waiting`);
  // The friend leaves: off into the sky, far away. The traffic gets going again.
  others = [{ ...friend, x: f.cx, z: f.cz - 20000, agl: 2000, onGround: false, gs: 60, vx: 60 }];
  let after = 0;
  H.run(sim, W, 240, 0.1, () => {
    for (const c of TF.trafficState().craft) {
      const p = prev.get(c.id);
      if (p && ((p.phase === 'takeoff' && p.v < 1 && c.v >= 1) || ((p.phase === 'landing' || p.phase === 'approach') && c.phase === 'rollout'))) after++;
      prev.set(c.id, { phase: c.phase, v: c.v });
    }
  });
  ok('lobby: ... and once they have gone, the traffic uses the runway again', after >= 1, `${after} take-offs and landings in 4 min`);
  // A friend on a 6 km final while one of the traffic is on a 2.5 km final: it would not be off in time — it goes round.
  const ar = TF.spawnTraffic(sim, 'arrive');
  others = [{ ...friend, x: f.west + 250 - 2600, z: f.cz, agl: 2600 * 0.0524, onGround: false, hdgDeg: 90, vx: 45, vy: -2.3, gs: 45 }];
  const ga0 = TF.priorityState().stats.priorityGoArounds;
  let landedAhead = 0;
  H.run(sim, W, 40, 0.1, (t, dt) => {
    const o = others[0];
    o.x += o.vx * dt;
    o.agl = Math.max(0, (f.west + 250 - o.x) * 0.0524);
    for (const c of TF.trafficState().craft) {
      const p = prev.get(c.id);
      if (p && (p.phase === 'landing' || p.phase === 'approach') && c.phase === 'rollout') landedAhead++;
      prev.set(c.id, { phase: c.phase, v: c.v });
    }
  });
  const ga = TF.priorityState().stats.priorityGoArounds - ga0;
  ok('lobby: a friend on a short final — the arrival ahead that would not be off in time goes round', ar.ok && ga >= 1 && landedAhead === 0, `${ar.ok ? ar.callsign : ar.why}: ${ga} go-around(s), ${landedAhead} landed`);
  // On the ground, in the way: a taxiing aeroplane stops for the friend.
  others = [];
  TF.setOtherPilots(null);
  H.run(sim, W, 1, 0.1);
  const s = H.summary(W);
  ok('lobby: no hook threw, and nobody through anybody', !s.threw && s.merged === 0 && s.airHit === 0 && s.under === 0, s.threw || s.mergedFirst || s.airHitFirst || s.underFirst || '');
}
{
  // Stopped for on the ground: the friend parked on the taxiway, where the departures go.
  H.loadMap('kestrel');
  const sim = H.makeSim({ typeId: 'skylark', wind: [90, 3] });
  const f = F.buildField();
  H.placePlayer(sim, f.cx, f.cz - 20000, { headingDeg: 90, agl: 2000, speed: 0 });
  const spot = { id: 5, x: f.twX0 + 50, y: TR.AIRPORT.elev, z: f.twZ, agl: 0, onGround: true, crashed: false, hdgDeg: 270, vx: 0, vy: 0, vz: 0, gs: 0, halfSpan: 6 };
  TF.setOtherPilots(() => [spot]);
  H.startFlight(sim, { trafficSeed: 2 });
  const W = H.makeWatch(sim);
  let minD = Infinity;
  let stoppedFor = 0;
  H.run(sim, W, 8 * 60, 0.1, () => {
    for (const c of TF.trafficState().craft) {
      if (!c.onGround) continue;
      const d = Math.hypot(c.pos[0] - spot.x, c.pos[2] - spot.z);
      minD = Math.min(minD, d);
      if (c.blockedBy === 'player' && d < 80) stoppedFor += 0.1;
    }
  });
  TF.setOtherPilots(null);
  const s2 = H.summary(W);
  ok('lobby: a friend parked on the taxiway is stopped for, not driven through', minD > 10 && stoppedFor > 0 && !s2.threw, `closest middle ${minD.toFixed(1)} m; stopped for them ${stoppedFor.toFixed(0)} s`);
  NUM.lobbyTaxiway = { closest: +minD.toFixed(1), stoppedFor: Math.round(stoppedFor) };
}

console.log(`traffic priority: ${checks - failed}/${checks} checks passed`);
if (jsonArg) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(jsonArg.slice(7), JSON.stringify(NUM, null, 1));
}
process.exit(failed ? 1 : 0);
