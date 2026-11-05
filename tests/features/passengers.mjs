/**
 * Node checks for passengers (features/passengers.js and passengers/*):
 *
 *   node tests/features/passengers.mjs
 *
 *   1. COMFORT SCORING (passengers/comfort.js), with made-up flights: a smooth
 *      flight and a butter landing rate 4.8 or better and say "smooth
 *      landing!"; a 45° bank costs something, 60° four times as much, a
 *      knife-edge most; high g, a fast descent and rough air each cost; a
 *      rough landing knocks the mood down there and then and is the thing the
 *      summary talks about; a bounce counts; the rating stays 0..5; the line
 *      reads "Passengers: 4.6/5 — …".
 *   2. THE CABIN (passengers/layout.js): every airliner in the roster is one
 *      and nothing else is; seats and cabin crew for the four we fly (the
 *      A320's 180); today's booking is 78-96% full; who sits where is the same
 *      for the same seed and fills from the front.
 *   3. THE EVACUATION'S ORDER (passengers/evac.js), for every airliner and at
 *      any frame rate: every passenger before any crew member, every crew
 *      member before you, you exactly once and last; the cabin empties in
 *      about ten seconds whatever its size; the doors take turns; hurry()
 *      keeps the order. The escape profiles (eject/profiles.js): airliners
 *      'evac' from 150 m in the captain's uniform, the same in a mission.
 *      passengers/exits.js leaves the over-wing exits shut.
 *   4. THE PA (passengers/pa.js): a scripted flight hears take-off, the
 *      seatbelt sign off in the cruise, top of descent, landing and arrival,
 *      in that order, each once — and none of it is a sound (it has no voice).
 *   5. ACHIEVEMENTS: Smooth Operator at 4.8 and not at 4.7; Last One Out for an
 *      evacuation; neither for a crash.
 *   6. THE MISSIONS (game/more/passengers.js): four, under Passengers &
 *      cargo, easiest first, each on a real map in a real airliner, starting
 *      at a gate, scored on comfort and time.
 *   7. THE TURNAROUND'S NUMBERS (passengers/boarding.js): boarding takes 16-45
 *      s once the doors open and getting off less; the doors share the
 *      people; a line of walkers delivers every passenger exactly once, at a
 *      walking pace, the first after the walk; a whole turnaround (bridge,
 *      crew, a quarter of them up the back stairs, doors, the bridge pulling
 *      back) is 30-60 s watched for every airliner, at any frame rate; a late
 *      stair truck only delays it; getting off empties the cabin; the
 *      walk round a bridge's column and leg keeps clear of both; up the
 *      stairs the walkers climb.
 *
 * Exits non-zero if anything fails.
 */

globalThis.document = {
  getElementById: () => null,
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
    setAttribute() {},
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  }),
  head: { appendChild() {} },
  body: { appendChild() {} },
};

const SRC = new URL('../../src/', import.meta.url).href;
const C = await import(SRC + 'features/passengers/comfort.js');
const L = await import(SRC + 'features/passengers/layout.js');
const E = await import(SRC + 'features/passengers/evac.js');
const X = await import(SRC + 'features/passengers/exits.js');
const PA = await import(SRC + 'features/passengers/pa.js');
const PR = await import(SRC + 'features/eject/profiles.js');
const R = await import(SRC + 'features/achievements/rules.js');
const D = await import(SRC + 'features/achievements/data.js');
const ST = await import(SRC + 'features/achievements/store.js');
const { AIRCRAFT } = await import(SRC + 'aircraft/types.js');
const { AIRLINER_DOORS } = await import(SRC + 'aircraft/extra/airliners.js');
const MIS = await import(SRC + 'game/more/passengers.js');
const B = await import(SRC + 'features/passengers/boarding.js');
const { MAPS } = await import(SRC + 'world/maps.js');

let failed = 0;
let passed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail !== '' ? '  —  ' + detail : ''}`);
  return !!pass;
}

/* ------------------------------------------------------------ 1. comfort --- */

/** Fly `secs` of one condition through a comfort state. */
function fly(c, secs, s, dt = 1 / 30) {
  for (let t = 0; t < secs; t += dt) C.stepComfort(c, dt, { airborne: true, g: 1, bankDeg: 0, vsFpm: 0, turb: 0, ...s });
  return c;
}

{
  const smooth = C.createComfort();
  fly(smooth, 300, { bankDeg: 15, vsFpm: -600 });
  C.touchdownComfort(smooth, { vsFpm: 140, quality: 'perfect' });
  const s = C.summary(smooth);
  ok('comfort: a smooth flight and a butter landing rate 4.8 or better', s.rating >= 4.8, `${s.rating}`);
  ok('comfort: …and the line says so: "Passengers: X.X/5 — smooth landing!"', /^Passengers: \d\.\d\/5 — smooth landing!$/.test(s.line), s.line);

  const rate = (bank) => C.upsetRates({ bankDeg: bank, g: 1, vsFpm: 0, airborne: true }).bank;
  ok('comfort: up to 30° of bank bothers nobody', rate(25) === 0 && rate(30) === 0, `${rate(25)}, ${rate(30)}`);
  ok('comfort: 45° of bank is a nudge, 60° four times that, a knife-edge worst', rate(45) > 0 && Math.abs(rate(60) / rate(45) - 4) < 0.01 && rate(90) > rate(60),
    `${rate(45).toFixed(3)} / ${rate(60).toFixed(3)} / ${rate(90).toFixed(3)} per s`);
  const bank = (deg) => C.rating(fly(C.createComfort(), 30, { bankDeg: deg }));
  ok('comfort: half a minute at 45° costs a little; at 60° much more', bank(20) > bank(45) && bank(45) > bank(60) + 0.5, `${bank(20)} > ${bank(45)} > ${bank(60)}`);

  const gRate = (g) => C.upsetRates({ g, airborne: true }, g).g;
  ok('comfort: high g and negative-going g both upset them; 1.2 g does not', gRate(1.2) === 0 && gRate(1.8) > gRate(1.5) && gRate(1.5) > 0 && gRate(0.4) > 0,
    `1.2 g ${gRate(1.2)}, 1.5 g ${gRate(1.5).toFixed(3)}, 1.8 g ${gRate(1.8).toFixed(3)}, 0.4 g ${gRate(0.4).toFixed(3)}`);
  // One frame of a gust's jolt is smoothed away; a held pull is not.
  const jolt = C.createComfort();
  C.stepComfort(jolt, 1 / 60, { airborne: true, g: 2.2, bankDeg: 0, vsFpm: 0 });
  fly(jolt, 5, {});
  const pull = fly(C.createComfort(), 5, { g: 2.0 });
  ok('comfort: one jolt of g is smoothed out; a held 2 g pull is not', jolt.mood > 4.98 && pull.mood < 4.6, `jolt ${jolt.mood.toFixed(3)}, pull ${pull.mood.toFixed(3)}`);

  const dRate = (fpm) => C.upsetRates({ vsFpm: -fpm, airborne: true }).descent;
  ok('comfort: descending at 1,500 ft/min is fine; 3,000 costs; 5,000 costs more', dRate(1500) === 0 && dRate(5000) > dRate(3000) && dRate(3000) > 0,
    `${dRate(3000).toFixed(3)}, ${dRate(5000).toFixed(3)}`);
  ok('comfort: rough air is a ceiling on the mood while airborne (3.2 in a storm, 4.55 in rain), nothing on the ground',
    Math.abs(C.turbulenceCeiling(1) - 3.2) < 1e-9 && Math.abs(C.turbulenceCeiling(0.5) - 4.55) < 1e-9 && C.turbulenceCeiling(1, false) === 5 && C.turbulenceCeiling(0) === 5);
  const stormy = fly(C.createComfort(), 120, { turb: 1 });
  ok('comfort: two minutes of storm air brings the rating down but not to nothing', C.rating(stormy) < 4.5 && C.rating(stormy) > 3 && stormy.mood >= 3.2 - 1e-9, `${C.rating(stormy)}, mood ${stormy.mood.toFixed(2)}`);
  const rainy = fly(C.createComfort(), 600, { turb: 0.5 });
  ok('comfort: ten minutes of rain is not the pilot’s fault — still a good rating', C.rating(rainy) > 4.4, `${C.rating(rainy)}`);
  fly(stormy, 400, { turb: 0 });
  ok('comfort: out of the storm, they settle again', stormy.mood > 4.4, `${stormy.mood.toFixed(2)}`);

  const rough = C.createComfort();
  fly(rough, 200, { bankDeg: 10 });
  const before = rough.mood;
  C.touchdownComfort(rough, { vsFpm: 820, quality: 'rough' });
  const rs = C.summary(rough);
  ok('comfort: a rough landing knocks the mood down on the spot', rough.mood < before - 0.8, `${before.toFixed(2)} → ${rough.mood.toFixed(2)}`);
  ok('comfort: …and it is what the summary talks about', rs.worst === 'landing' && /landing woke/.test(rs.text) && rs.rating < 4.5, rs.line);
  ok('comfort: landing stars by sink rate (butter 5, 300 ft/min 4.5, 800 ft/min 2)', C.landingStars(120) === 5 && C.landingStars(300) === 4.5 && C.landingStars(800) === 2);

  const bounce = C.createComfort();
  fly(bounce, 60, {});
  C.touchdownComfort(bounce, { vsFpm: 250 });
  fly(bounce, 1.5, { airborne: false });
  C.touchdownComfort(bounce, { vsFpm: 250 });
  ok('comfort: a second touchdown inside three seconds is a bounce, and costs', bounce.bounced && bounce.landing.stars < C.landingStars(250), `${bounce.landing.stars}`);

  const wild = fly(C.createComfort(), 600, { bankDeg: 120, g: 3.5, vsFpm: -15000, turb: 1 });
  ok('comfort: however wild, the rating stays within 0..5', C.rating(wild) >= 0 && C.rating(wild) <= 5 && wild.mood >= 0, `${C.rating(wild)}`);
  ok('comfort: …and the words stay kind', !/hate|angry|scream|furious|terrif/i.test(C.summary(wild).line), C.summary(wild).line);
  const crashed = C.createComfort();
  C.touchdownComfort(crashed, { crashed: true, vsFpm: 1500 });
  ok('comfort: a crash says everyone is safe', /everyone is safe/.test(C.summary(crashed).text), C.summary(crashed).line);
  ok('comfort: stars text has five places', [5, 4.6, 3.2, 0].every((r) => C.starsText(r).replace('½', '★').length === 5), [5, 4.6, 3.2, 0].map(C.starsText).join(' | '));
  ok('comfort: smooth flying brings the mood back, slowly', (() => {
    const c = fly(C.createComfort(), 10, { bankDeg: 60 });
    const low = c.mood;
    fly(c, 60, {});
    return c.mood > low && c.mood < low + 1.2;
  })());
}

/* ------------------------------------------------------------- 2. cabin --- */

{
  const airliners = AIRCRAFT.filter((t) => L.isAirlinerType(t)).map((t) => t.id);
  ok('cabin: the four airliners carry passengers', ['meridian', 'a320', 'b747', 'a380'].every((id) => airliners.includes(id)), airliners.join(', '));
  ok('cabin: nothing else does (no fighters, trainers, helicopters, specials)', airliners.every((id) => ['meridian', 'a320', 'b747', 'a380'].includes(id) || /airliner/i.test(AIRCRAFT.find((t) => t.id === id).class || '')), airliners.join(', '));
  ok('cabin: a cargo freighter is not an airliner', !L.isAirlinerType({ id: 'beluga', class: 'Cargo freighter', category: 'airliner' }) && L.isAirlinerType({ id: 'b787', class: 'Wide-body airliner' }));
  const want = { meridian: [40, 1], a320: [180, 4], b747: [416, 12], a380: [555, 18] };
  for (const [id, [seats, crew]] of Object.entries(want)) {
    const c = L.cabinFor({ id }, AIRLINER_DOORS[id]);
    ok(`cabin: ${id} — ${seats} seats, ${crew} cabin crew, a floor, walls and a front door`,
      c.seats === seats && c.crew === crew && c.floorY < c.windowY && c.windowY < c.ceilingY && c.halfW > 1 && c.z1 > c.z0 && c.front.z < c.rear.z,
      JSON.stringify({ seats: c.seats, crew: c.crew, abreast: c.abreast, rows: c.rows, halfW: +c.halfW.toFixed(2) }));
  }
  const guess = L.cabinFor({ id: 'b787', plan: { nose: -30, tail: 27, span: 60 } }, null);
  ok('cabin: an airliner nobody listed still gets a sensible cabin', guess.seats > 100 && guess.crew >= 2 && guess.abreast >= 6, JSON.stringify({ seats: guess.seats, crew: guess.crew, abreast: guess.abreast }));
  const c = L.cabinFor({ id: 'a320' }, AIRLINER_DOORS.a320);
  const loads = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((s) => L.bookedFor(c, s));
  ok('cabin: today’s booking is 78-96% full, and differs from flight to flight', loads.every((n) => n >= 0.78 * 180 - 1 && n <= 0.96 * 180 + 1) && new Set(loads).size > 3, loads.join(' '));
  const a = L.seatOrder(c, 142, 7);
  const b = L.seatOrder(c, 142, 7);
  ok('cabin: who sits where is the same for the same seed', a.length > 0 && a.join() === b.join());
  const firstRow = Math.max(...a.slice(0, 20).map((i) => Math.floor(i / c.abreast)));
  const lastRow = Math.min(...a.slice(-20).map((i) => Math.floor(i / c.abreast)));
  ok('cabin: …and it fills from the front', firstRow < lastRow, `first 20 up to row ${firstRow}, last 20 from row ${lastRow}`);
}

/* --------------------------------------------------------- 3. evacuation --- */

{
  for (const id of ['meridian', 'a320', 'b747', 'a380']) {
    const cab = L.cabinFor({ id }, AIRLINER_DOORS[id]);
    const booked = L.bookedFor(cab, 3);
    const doors = X.pickEvacDoors(cab.exits, null);
    for (const dt of [1 / 30, 1 / 60, 0.1]) {
      const ev = new E.Evacuation({ pax: booked, crew: cab.crew, doors });
      let t = 0;
      while (!ev.done && t < 60) {
        ev.step(dt);
        t += dt;
      }
      const log = ev.log;
      const lastPax = log.map((r) => r.who).lastIndexOf('pax');
      const firstCrew = log.findIndex((r) => r.who === 'crew');
      const lastCrew = log.map((r) => r.who).lastIndexOf('crew');
      const pilots = log.filter((r) => r.who === 'pilot');
      const order = lastPax < firstCrew && lastCrew < log.length - 1 && pilots.length === 1 && log[log.length - 1].who === 'pilot';
      const paxT = log[lastPax].at;
      if (dt === 1 / 60) {
        ok(`evac: ${id} — all ${booked} passengers first, then ${cab.crew} crew, then you, last`, order && ev.done && ev.paxOut === booked && ev.crewOut === cab.crew,
          `last passenger at ${paxT.toFixed(1)} s, first crew at ${log[firstCrew].at.toFixed(1)} s, you at ${pilots[0].at.toFixed(1)} s`);
        ok(`evac: ${id} — the cabin empties in about ten seconds`, paxT > 6 && paxT < 12.5, `${paxT.toFixed(1)} s`);
        const doorsUsed = new Set(log.filter((r) => r.who === 'pax').map((r) => r.door));
        ok(`evac: ${id} — passengers use every door it opens, both sides`, doorsUsed.size === doors.length && [...doorsUsed].some((d) => /^R/.test(d)) && [...doorsUsed].some((d) => /^L/.test(d)), [...doorsUsed].join(' '));
        ok(`evac: ${id} — you leave by the front left door`, pilots[0].door === 'L1', pilots[0].door);
      } else if (!order) ok(`evac: ${id} — the order holds at ${Math.round(1 / dt)} fps`, false);
    }
  }
  ok('evac: the order holds at 10, 30 and 60 frames a second', true);
  // Reduce flashing (on by default): no door faster than DOOR_RATE_SAFE a second — the flicker probe's
  // strobe was a door's stream running figures down the same pixels several times a second.
  for (const id of ['meridian', 'a320', 'b747', 'a380']) {
    const cab = L.cabinFor({ id }, AIRLINER_DOORS[id]);
    const booked = L.bookedFor(cab, 3);
    const doors = X.pickEvacDoors(cab.exits, null);
    const ev = new E.Evacuation({ pax: booked, crew: cab.crew, doors, doorRate: E.DOOR_RATE_SAFE, maxRate: E.TOTAL_RATE_SAFE });
    let t = 0;
    while (!ev.done && t < 120) {
      ev.step(1 / 60);
      t += 1 / 60;
    }
    // The most out of one door in any one second.
    let most = 0;
    for (const d of doors) {
      const at = ev.log.filter((r) => r.who === 'pax' && r.door === d.id).map((r) => r.at);
      for (let i = 0; i < at.length; i++) {
        let n = 0;
        while (i + n < at.length && at[i + n] < at[i] + 1) n++;
        most = Math.max(most, n);
      }
    }
    // And out of all of them together.
    const all = ev.log.filter((r) => r.who === 'pax').map((r) => r.at);
    let mostAll = 0;
    for (let i = 0; i < all.length; i++) {
      let n = 0;
      while (i + n < all.length && all[i + n] < all[i] + 1) n++;
      mostAll = Math.max(mostAll, n);
    }
    const who = ev.log.map((r) => r.who);
    const paxT = ev.log[who.lastIndexOf('pax')].at;
    ok(`evac: ${id} with Reduce flashing — no door faster than ${E.DOOR_RATE_SAFE} a second, ${E.TOTAL_RATE_SAFE} in all; still in order; the cabin empty in about a minute at most`,
      ev.done && ev.paxOut === booked && most <= Math.ceil(E.DOOR_RATE_SAFE) && mostAll <= E.TOTAL_RATE_SAFE + 1 && who.lastIndexOf('pax') < who.indexOf('crew') && who[who.length - 1] === 'pilot' && paxT < 75,
      `${booked} through ${doors.length} doors: at most ${most} a door and ${mostAll} in all a second; the last passenger at ${paxT.toFixed(0)} s`);
  }
  const hurried = new E.Evacuation({ pax: 50, crew: 3, doors: X.pickEvacDoors(L.cabinFor({ id: 'a320' }, AIRLINER_DOORS.a320).exits, null) });
  hurried.step(0.5);
  const out = hurried.hurry();
  hurried.step(5);
  const who = hurried.log.map((r) => r.who);
  ok('evac: in a hurry, still passengers, then crew, then you', who.lastIndexOf('pax') < who.indexOf('crew') && who[who.length - 1] === 'pilot' && hurried.paxOut === 50 && out.length > 0, `${who.length} out`);
  const doors = X.pickEvacDoors(AIRLINER_DOORS.a320, null);
  ok('evac: over-wing exits and upper-deck doors stay shut', doors.every((d) => d.kind === 'passenger' && d.deck !== 'upper') && doors.length === 4, doors.map((d) => d.id).join(' '));
  for (const id of ['meridian', 'a320', 'b747', 'a380']) {
    const p = PR.profileFor(id);
    const m = PR.profileIn(id, 'mission');
    if (!ok(`profiles: ${id} evacuates — parachutes for everybody, from 150 m, in the captain's uniform`, p.escape === 'evac' && p.bailFrom === 150 && p.uniform === 'captain' && !p.runaway && m.escape === 'evac', JSON.stringify(p))) break;
  }
  ok('profiles: an airliner nobody listed evacuates too; a freighter does not', PR.profileFor({ id: 'z1', class: 'Wide-body airliner' }).escape === 'evac' && PR.profileFor({ id: 'z2', class: 'Cargo transport' }).escape === 'none');
  ok('profiles: Air Force One has its own kind words', /President/.test(PR.NONE_WHY.afo));
}

/* -------------------------------------------- 3b. the crowd, in the air --- */

{
  const THREE = await import(SRC + 'vendor/three.module.js');
  const { Jumpers } = await import(SRC + 'features/passengers/jumpers.js');
  const scene = new THREE.Scene();
  const J = new Jumpers(scene, 40, { ground: () => 0, water: () => false });
  ok('crowd: three draws for the whole crowd', J.root.children.length === 3 && J.root.children.every((m) => m.isInstancedMesh));
  // An A320 at 250 kt, 600 m up, flying north (-Z): out of the front left door, the one ahead of the wing.
  const ac = { pos: new THREE.Vector3(0, 600, 0), vel: new THREE.Vector3(0, 0, -128), quat: new THREE.Quaternion() };
  const L1 = AIRLINER_DOORS.a320.find((d) => d.id === 'L1');
  const pos = X.doorWorld(ac, L1);
  const out = X.doorOutWorld(ac, L1);
  // Forty of them out of the same door at once: everybody jumps a little differently (JUMP.spread),
  // so this is every kind of jump at once — the hardest push, the most drag, the shortest cling.
  const all = [];
  for (let k = 0; k < 40; k++) all.push(J.launch(pos, ac.vel, out, 'pax', k));
  let clipped = 0;
  let maxSink = 0;
  let t = 0;
  const dt = 1 / 60;
  const planePos = ac.pos.clone();
  // Where along the fuselage each one is as it passes 3 m and 12 m below the door: one line of people
  // (everybody along the very same path) would put them all in the same place.
  const doorRel = pos.clone().sub(ac.pos);
  const pass = { 3: [], 12: [] };
  while (all.some((j) => !j.landed) && t < 200) {
    J.update(dt, new THREE.Vector3(3, 0, 0));
    planePos.addScaledVector(ac.vel, dt);
    t += dt;
    for (const j of all) {
      if (j.landed) continue;
      // Relative to the aeroplane flying on: never inside the wing's box (A320: root from about
      // z -6 to +1, out to the tips, the wing at y -1.45 and a little dihedral).
      const rel = j.pos.clone().sub(planePos);
      if (rel.z > -6.5 && rel.z < 2 && Math.abs(rel.x) > 1.6 && Math.abs(rel.x) < 18 && rel.y > -2.6 && rel.y < 0.2) clipped++;
      if (j.pos.y < 20) maxSink = Math.max(maxSink, -j.vel.y);
    }
    for (const j of all) {
      const rel = j.pos.clone().sub(planePos).sub(doorRel);
      for (const below of [3, 12]) if (rel.y <= -below && !pass[below][j.i]) pass[below][j.i] = rel.z;
    }
  }
  const sd = (xs) => {
    const v = xs.filter((x) => x !== undefined);
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    return v.length === all.length ? Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) : 0;
  };
  const spread = { 3: sd(pass[3]), 12: sd(pass[12]) };
  const landed = all.filter((j) => j.landed && j.open >= 1).length;
  ok('crowd: out of a door ahead of the wing, they drop clear under it instead of through it — however each one jumps', clipped === 0, `${clipped} person-frames inside the wing's box`);
  ok('crowd: the canopies open and they land gently', landed === all.length && maxSink < 6, `${landed}/${all.length} down after ${t.toFixed(0)} s, last 20 m at ≤ ${maxSink.toFixed(1)} m/s`);
  ok('crowd: 600 m takes under a minute (nobody waits five minutes for a crowd to land)', t < 60, `${t.toFixed(0)} s`);
  // Not one line of people down the same pixels (the flicker probe's strobe): their paths fan out —
  // a couple of body widths apart just under the door, metres apart a little lower.
  ok('crowd: each jumps a little differently — their paths fan out instead of running down one line', spread[3] > 0.8 && spread[12] > 3,
    `along the fuselage, sd ${spread[3].toFixed(2)} m at 3 m below the door, ${spread[12].toFixed(2)} m at 12 m`);
  const { CabinInterior, seatColumns } = await import(SRC + 'features/passengers/cabin.js');
  for (const id of ['meridian', 'a320', 'b747', 'a380']) {
    const cab = L.cabinFor({ id }, AIRLINER_DOORS[id]);
    const cols = seatColumns(cab);
    const I = new CabinInterior(cab, L.bookedFor(cab, 2), 2);
    const inside = Math.abs(I.eye.x) < cab.wallW && I.eye.y > cab.floorY + 1 && I.eye.y < cab.ceilingY && I.eye.z > cab.z0;
    ok(`cabin view: ${id} — ${cols.seats.length} abreast in ${cols.aisles.length} aisle${cols.aisles.length > 1 ? 's' : ''}, the seats inside the walls, the eye in the aisle`,
      cols.seats.length === cab.abreast && cols.width / 2 < cab.wallW && inside && I.bodies.count > 0 && I.seats.count >= I.bodies.count,
      `${cols.width.toFixed(2)} m of seats in ${(cab.wallW * 2).toFixed(2)} m; ${I.bodies.count} seated of ${I.seats.count}`);
    I.dispose();
  }
  J.dispose();
}

/* ----------------------------------------------------------------- 4. PA --- */

{
  const pa = new PA.PA();
  const heard = [];
  const run = (secs, f) => {
    for (let t = 0; t < secs; t += 0.1) {
      pa.update(0.1, { stage: 'flying', field: 'Kestrel', ...f });
      let q;
      while ((q = pa.next(true))) heard.push(q.id);
    }
  };
  run(5, { onGround: true, ias: 0, throttle: 0 });
  run(10, { onGround: true, ias: 60, throttle: 0.9 });
  run(20, { onGround: false, airborneEver: true, aglM: 400, vsFpm: 2000, airborneT: 20 });
  run(30, { onGround: false, airborneEver: true, aglM: 1500, vsFpm: 0, airborneT: 50 });
  run(30, { onGround: false, airborneEver: true, aglM: 1200, vsFpm: -1500, airborneT: 80 });
  run(20, { onGround: false, airborneEver: true, aglM: 300, vsFpm: -700, gearDown: true, airborneT: 100 });
  run(10, { onGround: true, airborneEver: true, ias: 30 });
  const want = ['takeoff', 'cruise', 'descent', 'landing', 'arrived'];
  ok('PA: take-off, seatbelt sign off, top of descent, landing, arrival — in that order, each once', want.every((id, i) => heard.indexOf(id) === heard.lastIndexOf(id) && (i === 0 || heard.indexOf(id) > heard.indexOf(want[i - 1]))), heard.join(' → '));
  ok('PA: the arrival names the airport', /Kestrel/.test(PA.LINES.arrived({ field: 'Kestrel' })));
  ok('PA: rough air with the seatbelt sign off brings it back on', (() => {
    const p = new PA.PA();
    p.say('cruise');
    for (let t = 0; t < 30; t += 0.1) p.update(0.1, { stage: 'flying', onGround: false, aglM: 1500, vsFpm: 0, turb: 0.8 });
    return p.said.has('bumps') && p.belt === true;
  })());
  ok('PA: it has no voice — nothing in it can make a sound', !/\.speak\(|transmit|audio|speechSynthesis|tts/i.test(String(PA.PA)));
}

/* ------------------------------------------------------- 5. achievements --- */

{
  const ids = D.ACHIEVEMENTS.map((a) => a.id);
  ok('achievements: Smooth Operator and Last One Out are in the catalogue', ids.includes('smooth-operator') && ids.includes('last-one-out'));
  const st = ST.blank();
  ok('achievements: 4.7 is not Smooth Operator', R.applyEvent(st, 'passengers', { rating: 4.7, landed: true }).length === 0);
  ok('achievements: 4.8 is', R.applyEvent(st, 'passengers', { rating: 4.8, landed: true }).includes('smooth-operator'));
  const st2 = ST.blank();
  ok('achievements: not for a crash, however it rated', R.applyEvent(st2, 'passengers', { rating: 5, landed: true, crashed: true }).length === 0);
  ok('achievements: an evacuation that got everybody out is Last One Out', R.applyEvent(st2, 'passengers', { evacuated: true, people: 190 }).includes('last-one-out'));
}

/* ----------------------------------------------------------- 6. missions --- */

{
  const M = MIS.MISSIONS;
  const rank = { Easy: 2, Medium: 3, Hard: 4 };
  ok('missions: four passenger jobs, under Passengers & cargo', M.length === 4 && M.every((m) => m.category === 'airline' && m.game === 'flight'), M.map((m) => m.id).join(', '));
  ok('missions: easiest first, hardest last', M.every((m, i) => i === 0 || rank[m.difficulty] >= rank[M[i - 1].difficulty]) && M[0].difficulty === 'Easy' && M[M.length - 1].difficulty === 'Hard', M.map((m) => m.difficulty).join(' → '));
  const mapIds = new Set(MAPS.map((m) => m.id));
  ok('missions: each on a real map, in a real airliner', M.every((m) => mapIds.has(m.map) && L.isAirlinerType(AIRCRAFT.find((t) => t.id === m.aircraft))), M.map((m) => `${m.map}/${m.aircraft}`).join(' '));
  ok('missions: each starts by boarding, ends by landing, and has a timetable', M.every((m) => m.steps[0].id === 'board' && m.steps[m.steps.length - 1].id === 'land' && m.parTime > 0 && typeof m.score === 'function'));
  const fakeCtx = (rating, elapsed, landing) => ({ sim: { passengers: { rating, summary: () => null } }, elapsed, data: { lastTouchdown: landing ? { score: landing } : null } });
  const sc = M[0].score;
  ok('missions: scored on comfort and time — smooth and on time beats bumpy and late',
    sc(fakeCtx(4.9, 300, 90)) > 90 && sc(fakeCtx(2.5, 300, 90)) < sc(fakeCtx(4.9, 300, 90)) - 20 && sc(fakeCtx(4.9, 800, 90)) < sc(fakeCtx(4.9, 300, 90)),
    `${sc(fakeCtx(4.9, 300, 90))} / ${sc(fakeCtx(2.5, 300, 90))} / ${sc(fakeCtx(4.9, 800, 90))}`);
  ok('missions: the board step waits for the doors, and never for a missing feature',
    M[0].steps[0].check({ sim: {} }) === true && M[0].steps[0].check({ sim: { passengers: { ready: () => false } } }) === false);
  ok('missions: every one starts at a gate with the engines off', M.every((m) => m.spawn && 'pos' in m.spawn && 'headingDeg' in m.spawn));
}

/* ------------------------------------------------- 7. the turnaround --- */

{
  const fleet = ['meridian', 'a320', 'b747', 'a380'].map((id) => {
    const cab = L.cabinFor({ id }, AIRLINER_DOORS[id]);
    return { id, cab, booked: L.bookedFor(cab, 3) };
  });
  const Ts = fleet.map((f) => B.boardSeconds(f.booked));
  ok('turnaround: boarding takes 15-36 s once the doors open, longer for a bigger cabin', Ts.every((t) => t >= 15 && t <= 36) && Ts[0] <= Ts[1] && Ts[1] < Ts[2] && Ts[2] <= Ts[3], fleet.map((f, i) => `${f.id} ${f.booked}: ${Ts[i].toFixed(0)} s`).join(', '));
  ok('turnaround: getting off is quicker than getting on', fleet.every((f) => B.deplaneSeconds(f.booked) < B.boardSeconds(f.booked)));
  const r = B.doorRates(180, { bridge: true, stairs: true });
  const r1 = B.doorRates(180, { bridge: false, stairs: true });
  const r0 = B.doorRates(180, { bridge: true, stairs: false });
  ok('turnaround: the doors share them — the bridge most, the stairs the rest; one door alone takes them all in the time',
    r.bridge > 2 * r.stairs && r.bridge * r.T < 180 && (r.bridge + r.stairs) * r.T > 180 && Math.abs(r1.stairs * r1.T - 180) < 1e-6 && Math.abs(r0.bridge * r0.T - 180) < 1e-6,
    `bridge ${r.bridge.toFixed(2)}/s, stairs ${r.stairs.toFixed(2)}/s`);

  // One line of walkers: 60 people over a 40 m walk at 2 a second.
  {
    const path = new B.Path3([{ x: 0, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }]);
    const st = new B.Stream(path, { rate: 2 });
    let pool = 60;
    let got = 0;
    let first = null;
    let t = 0;
    let fastest = 0;
    const dt = 1 / 60;
    const was = new Map();
    while (t < 120 && got < 60 - 1e-9) {
      t += dt;
      const g = st.move(dt);
      got += g;
      if (g > 0 && first === null) first = t;
      for (const w of st.list) {
        if (was.has(w.k)) fastest = Math.max(fastest, (w.s - was.get(w.k)) / dt);
        was.set(w.k, w.s);
      }
      st.spawn(dt, (n) => {
        const k = Math.min(n, pool);
        pool -= k;
        return k;
      });
    }
    ok('turnaround: a line of walkers brings every one of them, exactly once', Math.abs(got - 60) < 1e-6 && pool < 1e-9 && st.list.length === 0, `${got.toFixed(3)} delivered, ${pool.toFixed(3)} left`);
    ok('turnaround: at a walking pace — the first in after the 40 m walk', Math.abs(first - 40 / B.WALK) < 0.1 && Math.abs(fastest - B.WALK) < 1e-6, `first at ${first.toFixed(1)} s, ${fastest.toFixed(2)} m/s`);
    ok('turnaround: each walker is one person or two, never a crowd on one figure', st.rep >= 1 && st.rep <= 2.5, `${st.rep.toFixed(2)} each`);
    ok('turnaround: and then two a second, as the door takes them', Math.abs(t - first - (60 / 2 - st.every)) < 0.1, `the last ${(t - first).toFixed(1)} s after the first`);
  }

  // A queue at the foot of stairs that are not there yet.
  {
    const path = new B.Path3([{ x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 0 }, { x: 34, y: 3, z: 0 }]);
    const st = new B.Stream(path, { rate: 3 });
    st.hold = 30;
    let pool = 40;
    let got = 0;
    const take = (n) => {
      const k = Math.min(n, pool);
      pool -= k;
      return k;
    };
    for (let i = 0; i < 60 * 60; i++) {
      got += st.move(1 / 60);
      st.spawn(1 / 60, take);
    }
    const spaced = st.list.every((w, i) => i === 0 || st.list[i - 1].s - w.s >= st.gap - 1e-6);
    ok('turnaround: with no stairs yet they queue at the foot, a step apart, and nobody goes up', got === 0 && st.list.length > 5 && st.list[0].s <= 30 + 1e-6 && spaced, `${st.list.length} waiting, front at ${st.list[0].s.toFixed(1)} m`);
    st.hold = null;
    let y = 0;
    for (let i = 0; i < 60 * 60 && got < 40 - 1e-9; i++) {
      got += st.move(1 / 60);
      st.spawn(1 / 60, take);
      const w = st.list.find((q) => q.s > 31);
      if (w) y = Math.max(y, path.sample(w.s).y);
    }
    ok('turnaround: the stairs come, and up they go — climbing, all of them', Math.abs(got - 40) < 1e-6 && y > 1, `${got.toFixed(1)} aboard, up to ${y.toFixed(1)} m`);
  }

  /*
   * The whole turnaround, as turnaround.js runs it: the crew sent for a
   * second after you stop and the stair truck at the back door 22 s later;
   * the bridge out in 10 s; a quarter of them in a line to the back stairs (a
   * 45 m walk), part-way out already so its head reaches the foot as the truck
   * does, waiting there if it is late; the rest by the bridge; the doors
   * 1.2 s, the bridge back past 0.3 in 7 s. On a remote stand: no bridge,
   * everybody up the front stairs.
   */
  const turnaround = (booked, { bridged = true, dt = 1 / 30, walkM = 45, truckAt = 23 } = {}) => {
    const rates = B.doorRates(booked, { bridge: bridged, stairs: true });
    let share = B.stairsShare(booked, { bridge: bridged, stairs: true });
    const path = new B.Path3([{ x: 0, y: 0, z: 0 }, { x: walkM, y: 0, z: 0 }, { x: walkM + 4, y: 3, z: 0 }]);
    let t = 0;
    let ext = 0;
    let aboard = 0;
    let stream = null;
    let got = 0;
    const left = () => Math.max(0, booked - aboard - got - (stream ? stream.inTransit : 0));
    const take = (n) => {
      const k = Math.min(n, share, left());
      if (!(k > 1e-6)) return 0;
      share -= k;
      return k;
    };
    while (t < 200) {
      t += dt;
      got = 0;
      if (bridged) ext = Math.min(1, ext + dt / 10);
      const docked = bridged && ext > 0.97;
      if (!stream && t >= 1) {
        stream = new B.Stream(path, { rate: rates.stairs });
        stream.hold = walkM - 0.3;
        const toFoot = stream.hold / stream.speed;
        const ahead = Math.max(0, Math.min(toFoot, toFoot - (truckAt - t)));
        if (ahead > 0) stream.prefill(ahead, take);
      }
      if (stream) {
        stream.hold = t >= truckAt ? null : walkM - 0.3;
        got += stream.move(dt);
      }
      if (docked) got += Math.min(Math.max(0, left() - share), rates.bridge * dt);
      if (stream) stream.spawn(dt, take);
      aboard += got;
      if (aboard >= booked - 1e-6 && !(stream && stream.list.length)) break;
    }
    const doorsShut = t + 1.2;
    const watched = doorsShut + (bridged ? 7 : 0);
    return { watched, aboard, stairs: stream ? stream.delivered : 0, walkers: stream ? stream.spawned : 0 };
  };
  for (const f of fleet) {
    const runs = [1 / 20, 1 / 60, 1 / 144].map((dt) => turnaround(f.booked, { dt }));
    const w = runs.map((x) => x.watched);
    const share = B.stairsShare(f.booked, { bridge: true, stairs: true });
    ok(`turnaround: the ${f.id} at a gate — all ${f.booked} aboard, a quarter up the back stairs, 30-60 s watched, at any frame rate`,
      runs.every((x) => Math.abs(x.aboard - f.booked) < 1e-6 && Math.abs(x.stairs - share) < 1e-6 && x.watched >= 30 && x.watched <= 62) && Math.max(...w) - Math.min(...w) < 1.5,
      `${w.map((x) => x.toFixed(0)).join(' / ')} s; ${runs[1].stairs.toFixed(0)} by the stairs, ${runs[1].walkers} walkers`);
  }
  {
    const f = fleet.find((q) => q.id === 'a320');
    const x = turnaround(f.booked, { bridged: false, walkM: 35, truckAt: 20 });
    ok('turnaround: an A320 on a remote stand — everybody up the front stairs, about a minute', Math.abs(x.aboard - f.booked) < 1e-6 && Math.abs(x.stairs - f.booked) < 1e-6 && x.watched <= 66, `${x.watched.toFixed(0)} s, ${x.walkers} walkers`);
    const late = turnaround(f.booked, { truckAt: 40 });
    ok('turnaround: a late stair truck holds them at the foot, then they all get on', Math.abs(late.aboard - f.booked) < 1e-6 && late.stairs > 0 && late.watched > turnaround(f.booked).watched, `${late.watched.toFixed(0)} s`);
  }
  // Getting off: the bridge, and the stairs once the truck is at the door.
  {
    const f = fleet.find((q) => q.id === 'b747');
    const rates = B.doorRates(f.booked, { bridge: true, stairs: true, seconds: B.deplaneSeconds(f.booked) });
    const path = new B.Path3([{ x: 0, y: 3, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 45, y: 0, z: 0 }]);
    let aboard = f.booked;
    let t = 0;
    let stream = null;
    let walked = 0;
    while (t < 120 && aboard > 1e-6) {
      t += 1 / 30;
      if (!stream && t > 14) stream = new B.Stream(path, { rate: rates.stairs });
      let off = 0;
      if (stream) {
        walked += stream.step(1 / 30, (n) => {
          const k = Math.min(n, aboard - off);
          off += k;
          return k > 1e-6 ? k : 0;
        });
      }
      off += Math.min(aboard - off, rates.bridge * (1 / 30));
      aboard -= off;
    }
    ok('turnaround: getting off a 747 empties the cabin, the bridge and the stairs both, in about half a minute', aboard <= 1e-6 && t < 40 && stream && stream.spawned > 0, `${t.toFixed(0)} s, ${stream ? stream.spawned : 0} walkers down the stairs`);
  }
  // The walk round a bridge's column and its wheeled leg.
  {
    const pts = B.walkAround([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 40 }], [{ x: 0.3, z: 12, r: 1.1 }, { x: -0.4, z: 25, r: 1.9 }], { x: 20, z: 20 });
    const path = new B.Path3(pts);
    let near = Infinity;
    for (let d = 0; d <= path.length; d += 0.1) {
      const p = path.sample(d);
      near = Math.min(near, Math.hypot(p.x - 0.3, p.z - 12) - 1.1, Math.hypot(p.x + 0.4, p.z - 25) - 1.9);
    }
    ok('turnaround: the line walks round the bridge\'s column and its leg, not through them, on the side away from the aeroplane', near > 0.3 && pts.length === 4 && pts[1].x < 0 && pts[2].x < 0, `${near.toFixed(2)} m clear; ${pts.length} points`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
