/**
 * Node checks for the seats ("fly as the lead fighter"). Run from anywhere:
 *
 *   node tests/features/roles.mjs
 *
 * THE DATA — withRole() hands back the mission itself for the default seat
 * (so the default really is today's mission, object for object), builds a
 * seat from a whitelist and nothing else (no base flags leak into a seat),
 * keeps the base's getters live, composes the base's gate only when a seat
 * asks for it; per-seat records stay out of progress.missions; every mission
 * that offers seats offers sound ones.
 *
 * THE NPC — the airliner the game flies for you must never crash, whatever
 * it is led into, and must always end up stopped on the runway before its
 * far end: from a clean final, from a release over the field, from a bad
 * leader who dives at the sea and turns into the island.
 *
 * Exits non-zero if anything fails.
 */

if (typeof globalThis.window === 'undefined') {
  const mem = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
  });
}
globalThis.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};

const root = new URL('../../', import.meta.url);
const imp = (p) => import(new URL(p, root).href);

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail: String(detail) });
  return !!pass;
};

const R = await imp('src/game/roles/roles.js');

/* ------------------------------------------------------------------ *
 * withRole on a made-up mission, so the rules are checked apart from
 * any real mission's details.
 * ------------------------------------------------------------------ */
{
  let reads = 0;
  const base = {
    id: 'base-x',
    name: 'Base X',
    category: 'events',
    game: 'flight',
    icon: '*',
    map: 'kestrel',
    weather: { time: 'day' },
    difficulty: 'Hard',
    devOnly: true,
    failOnCrash: false,
    brace: true,
    fuel: 0.8,
    get aircraft() {
      reads++;
      return 'b747';
    },
    spawn: { pos: { x: 1, y: 2, z: 3 } },
    onStart() {},
    failIf: (ctx) => (ctx.gateShut ? 'gate' : null),
    steps: [{ id: 'one', check: () => true }],
    roles: null,
  };
  const seatSteps = [{ id: 'a', check: () => true }, { id: 'b', duration: 2 }];
  const lead = {
    id: 'lead',
    label: () => 'The lead fighter',
    line: 'Fly the jet.',
    actor: 'lead',
    get aircraft() {
      return 'vanguard';
    },
    steps: seatSteps,
    failIf: (ctx) => (ctx.tooClose ? 'close' : null),
    baseGate: true,
    cast: { story: 'nothing' },
  };
  const loose = { id: 'loose', label: 'Loose', steps: seatSteps };
  base.roles = [{ id: 'captain', base: true, label: 'The captain', actor: 'airliner' }, lead, loose];

  ok('roles: no seat is the mission itself', R.withRole(base, null) === base && R.withRole(base, undefined) === base);
  ok('roles: the default seat is the mission itself', R.withRole(base, 'captain') === base);
  ok('roles: an unknown seat is the mission itself', R.withRole(base, 'stowaway') === base);
  ok('roles: a mission without seats is itself', R.withRole({ id: 'plain' }, 'lead').id === 'plain');
  ok('roles: undefined in, undefined out', R.withRole(undefined, 'lead') === undefined);
  const d = R.withRole(base, 'lead');
  ok('roles: a seat keeps the base id (music, records, findMission)', d.id === 'base-x' && d.baseId === 'base-x' && d.roleId === 'lead', `${d.id} ${d.baseId} ${d.roleId}`);
  ok('roles: a seat takes the whitelisted base fields', d.map === 'kestrel' && d.weather === base.weather && d.name === 'Base X' && d.devOnly === true && d.category === 'events');
  ok('roles: a seat does not inherit base flags', !('failOnCrash' in d) && !('brace' in d) && !('fuel' in d) && !('spawn' in d) && !('onStart' in d));
  ok('roles: the seat\'s own steps and aircraft', d.steps === seatSteps && d.aircraft === 'vanguard');
  ok('roles: card-only fields stay on the card', !('label' in d) && !('line' in d) && !('base' in d) && d.roleLabel === 'The lead fighter');
  ok('roles: baseGate composes the base gate first', d.failIf({ gateShut: true, tooClose: true }) === 'gate' && d.failIf({ tooClose: true }) === 'close' && d.failIf({}) === null);
  const l = R.withRole(base, 'loose');
  ok('roles: no baseGate, no base gate', !l.failIf);
  ok('roles: built once and kept', R.withRole(base, 'lead') === d);
  ok('roles: base getters are not read by withRole', reads === 0, `reads ${reads}`);
  ok('roles: rolesOf / defaultRoleId', R.rolesOf(base).length === 3 && R.defaultRoleId(base) === 'captain' && R.rolesOf({ roles: [{ id: 'x' }] }).length === 0);
  ok('roles: a label can be a function', R.roleLabel(lead) === 'The lead fighter' && R.roleLabel(base.roles[0]) === 'The captain');

  R.clearRoles();
  ok('roles: nothing chosen is the default', R.currentRole('base-x') === null);
  R.setRole('base-x', 'lead');
  ok('roles: a choice is remembered', R.currentRole('base-x') === 'lead');
  R.setRole('base-x', null);
  ok('roles: and can be cleared', R.currentRole('base-x') === null);

  const progress = { missions: { 'base-x': { complete: true, bestScore: 61, bestTime: 300 } } };
  ok('roles: an old record counts for the default seat', R.roleRecord(progress, base, 'captain').bestScore === 61 && R.roleRecord(progress, base, 'lead') === null);
  R.recordRole(progress, 'base-x', 'lead', { score: 72.4, time: 400 });
  R.recordRole(progress, 'base-x', 'lead', { score: 50, time: 380 });
  const rec = R.roleRecord(progress, base, 'lead');
  ok('roles: a seat record keeps the best', rec.complete && rec.bestScore === 72 && rec.bestTime === 380, JSON.stringify(rec));
  ok('roles: seat records stay out of progress.missions', Object.keys(progress.missions).length === 1 && !progress.missions.lead);
  ok('roles: once a seat is recorded, the default seat is its own', R.roleRecord(progress, base, 'captain') === null);
}

/* ------------------------------------------------------------------ *
 * The real missions that offer seats.
 * ------------------------------------------------------------------ */
const THREE = await imp('src/vendor/three.module.js');
const T = await imp('src/world/terrain.js');
const AP = await imp('src/world/airport.js');
T.applyMap('kestrel');
AP.refreshRunways();
const { MISSIONS, findMission } = await imp('src/game/missions.js');
const { AIRCRAFT } = await imp('src/aircraft/types.js');
const CAST = await imp('src/game/roles/cast.js');
const HL = await imp('src/game/roles/hijack-lead.js');
{
  const withSeats = MISSIONS.filter((m) => R.rolesOf(m).length);
  ok('seats: the two hijacks and the two Air Force One missions offer seats', withSeats.map((m) => m.id).sort().join(',') === 'afo-attack,afo-normal,event-hijack,event-hijack-real', withSeats.map((m) => m.id).join(','));
  for (const m of withSeats) {
    const seats = R.rolesOf(m);
    ok(`seats: ${m.id}: the first seat is the default and flies nothing of its own`, seats[0].base === true && !seats[0].steps && !seats[0].aircraft && !seats[0].spawn);
    ok(`seats: ${m.id}: seat ids are unique`, new Set(seats.map((x) => x.id)).size === seats.length);
    for (const seat of seats.slice(1)) {
      const d = R.withRole(m, seat.id);
      const where = `${m.id}/${seat.id}`;
      ok(`seats: ${where}: steps, each with a check`, Array.isArray(d.steps) && d.steps.length >= 4 && d.steps.every((x) => x.id && (typeof x.check === 'function' || x.duration)));
      ok(`seats: ${where}: step ids unique`, new Set(d.steps.map((x) => x.id)).size === d.steps.length);
      // Every non-default seat used to fly the one fighter ('vanguard'); the
      // President (Air Force One's own seats) rides the airliner itself
      // ('b747') instead — a real, existing aircraft, just not the
      // passcode-locked one ('f22') you'd get without the military code.
      ok(`seats: ${where}: an aircraft that exists, and not a passcode one without the code`, AIRCRAFT.some((a) => a.id === d.aircraft) && d.aircraft !== 'f22', d.aircraft);
      ok(`seats: ${where}: the F-22 once the military code is in`, HL.fighterId({ militaryUnlocked: true }) === (AIRCRAFT.some((a) => a.id === 'f22') ? 'f22' : 'vanguard'));
      // The seat flies the base mission's own island (v55 moved the hijacks and Air Force One off Kestrel).
      ok(`seats: ${where}: the base map and weather`, d.map === m.map && !!d.map && d.weather === m.weather, d.map);
      ok(`seats: ${where}: a story that is registered`, d.cast && CAST.storyIds().includes(d.cast.story), d.cast && d.cast.story);
      ok(`seats: ${where}: a label and a line for the card`, R.roleLabel(seat).length > 3 && String(seat.line || '').length > 10);
      ok(`seats: ${where}: the default seat label names the airliner`, /captain/i.test(R.roleLabel(seats[0])) && /747|A380|Meridian|president/i.test(R.roleLabel(seats[0])), R.roleLabel(seats[0]));
      ok(`seats: ${where}: a score function and par time`, typeof d.score === 'function' && d.parTime > 0);
      ok(`seats: ${where}: findMission still finds the base`, findMission(m.id) === m);
    }
  }
  const real = R.withRole(findMission('event-hijack-real'), 'lead');
  ok('seats: by the book keeps its Dev gate in the fighter seat', typeof real.failIf === 'function' && real.devOnly === true
    && /Dev passcode/.test(real.failIf({ sim: { prog: { devUnlocked: false } }, data: {} }) || ''));
  ok('seats: and the gate opens with the code', real.failIf({ sim: { prog: { devUnlocked: true } }, data: {} }) === null);
  const film = R.withRole(findMission('event-hijack'), 'shadow');
  ok('seats: the film seat starts in the air, behind and below him', film.spawn.altAGL > 1000 && film.spawn.speed > 90);
  ok('seats: the film seat has no Dev gate', !findMission('event-hijack').failIf && film.failIf({ data: {} }) === null);
  const rs = real.spawn;
  ok('seats: the scramble is from the east end, pointing west', rs.altAGL == null && Math.abs(rs.headingDeg - 270) < 1 && rs.pos.x > 300, JSON.stringify(rs));
  const rr = HL.remoteRunway(64.4, new THREE.Vector3(-8000, 0, -3000));
  ok('seats: a jumbo at Kestrel goes to the far end of 09', !rr.real && rr.hdg === 90 && Math.abs(rr.stop.x - 450) < 1 && Math.abs(rr.td.x + 350) < 1, JSON.stringify({ stop: rr.stop, td: rr.td }));
}

/* ------------------------------------------------------------------ *
 * The NPC airliner: always down, always stopped short of the far end,
 * never into the ground.
 * ------------------------------------------------------------------ */
const { NpcFlyer } = await imp('src/game/roles/npc-flyer.js');
const scene = new THREE.Scene();
function flyUntil(npc, secs, stop = () => false, each = null) {
  const dt = 1 / 30;
  let t = 0;
  for (; t < secs; t += dt) {
    if (each) each(t, dt);
    npc.update(dt);
    if (stop(t)) break;
  }
  return t;
}
function landFrom(name, pos, hdg, alt, speed = 75) {
  const npc = new NpcFlyer(scene, 'b747', { name });
  npc.place({ pos: new THREE.Vector3(pos[0], alt, pos[1]), headingDeg: hdg, speed });
  npc.rw = HL.remoteRunway(npc.span, npc.pos);
  npc.vecAlt = alt;
  npc.land(npc.rw);
  let tdAt = null;
  npc.onEvent = (w) => {
    if (w === 'touchdown') tdAt = npc.pos.clone();
  };
  const t = flyUntil(npc, 1500, () => npc.stopped);
  const z = Math.abs(npc.pos.z);
  ok(`npc: ${name}: lands and stops`, npc.stopped, `phase ${npc.landPhase} at ${npc.pos.x.toFixed(0)},${npc.pos.y.toFixed(0)},${npc.pos.z.toFixed(0)} after ${t.toFixed(0)} s`);
  ok(`npc: ${name}: touched down on the runway`, tdAt && tdAt.x > -550 && tdAt.x < 300 && Math.abs(tdAt.z) < 12, tdAt && `${tdAt.x.toFixed(0)},${tdAt.z.toFixed(1)}`);
  ok(`npc: ${name}: stopped before the far end, on the centre line`, npc.pos.x < 540 && npc.pos.x > 200 && z < 8, `${npc.pos.x.toFixed(0)},${npc.pos.z.toFixed(1)}`);
  ok(`npc: ${name}: never below its wheels' clearance`, npc.minClear > -0.01, npc.minClear.toFixed(2));
  ok(`npc: ${name}: touchdown at a landing speed`, npc.touchdownV > 55 && npc.touchdownV < 70, npc.touchdownV.toFixed(1));
  npc.dispose();
  return t;
}
landFrom('released on a clean final', [-6000, 0], 90, 14 + 5.3 + 5650 * Math.tan((3 * Math.PI) / 180));
landFrom('from the north-west, high', [-12000, -6000], 290, 1500);
landFrom('released right over the field', [0, 300], 90, 400, 72);
landFrom('from the east, heading the wrong way', [6000, 1500], 270, 900);
landFrom('the film route (WSW, 1,500 m)', [-15300, 5670], 75, 1500);
landFrom('released too high on short final', [-3000, 0], 90, 700, 70);

/* A bad leader: dives at the sea, turns hard, flies across the island's peaks. */
{
  const npc = new NpcFlyer(scene, 'b747', { name: 'bad-leader' });
  npc.place({ pos: new THREE.Vector3(-9000, 1500, -3000), headingDeg: 120, speed: 75 });
  npc.rw = HL.remoteRunway(npc.span, npc.pos);
  const L = { pos: new THREE.Vector3(-8850, 1512, -3080), vel: new THREE.Vector3(), heading: 120 };
  npc.follow(L);
  let minAgl = Infinity;
  let sinceLined = 99;
  flyUntil(npc, 420, () => false, (t, dt) => {
    // 0-60 s: dive to 20 m over the sea; 60-200: hard left circles; 200-420: straight over the peaks at 60 m.
    if (t < 60) L.pos.y = Math.max(20, L.pos.y - 25 * dt);
    else if (t < 200) L.heading = (L.heading - 9 * dt + 360) % 360;
    else L.heading = 95;
    if (t >= 200) L.pos.y = Math.max(60, T.heightAt(L.pos.x, L.pos.z) + 60);
    const h = (L.heading * Math.PI) / 180;
    L.vel.set(Math.sin(h) * 80, 0, -Math.cos(h) * 80);
    L.pos.addScaledVector(L.vel, dt);
    // Off the final approach, that is: lined up for 09 he may follow the
    // leader down to 60 m under the three-degree slope, which is the point.
    const g = Math.max(0, T.heightAt(npc.pos.x, npc.pos.z));
    // (and given half a minute to climb back once it leaves it).
    sinceLined = npc._linedFloor == null ? sinceLined + dt : 0;
    if (sinceLined > 30) minAgl = Math.min(minAgl, npc.pos.y - npc.ride - g);
  });
  ok('npc: a bad leader cannot take him below 250 m off the approach', minAgl > 250, minAgl.toFixed(0));
  ok('npc: and he never came near anything', npc.minClear > 120, npc.minClear.toFixed(0));
  // Then released over the middle of the island: he still lands.
  npc.vecAlt = npc.pos.y;
  npc.land(npc.rw);
  flyUntil(npc, 1500, () => npc.stopped);
  ok('npc: released after the bad leader, he still lands and stops', npc.stopped && npc.pos.x < 540 && Math.abs(npc.pos.z) < 8, `${npc.landPhase} ${npc.pos.x.toFixed(0)},${npc.pos.z.toFixed(0)}`);
  npc.dispose();
}

/* Follow: a gentle leader is followed closely. */
{
  const npc = new NpcFlyer(scene, 'b747', { name: 'follow' });
  npc.place({ pos: new THREE.Vector3(-9000, 1500, -3000), headingDeg: 290, speed: 75 });
  const L = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), heading: 290 };
  CAST.worldOf(npc, -(npc.span * 0.5 + 25), 12, -(80 + npc.span * 0.5), L.pos);
  npc.follow(L, { back: 120 + npc.span * 0.6, right: npc.span * 0.5 + 30, down: 15, lookahead: 600 });
  let worst = 0;
  flyUntil(npc, 240, () => false, (t, dt) => {
    // A slow level turn to the left at 2.5 degrees a second for 60 s, then straight.
    if (t > 20 && t < 80) L.heading = (L.heading - 2.5 * dt + 360) % 360;
    const h = (L.heading * Math.PI) / 180;
    L.vel.set(Math.sin(h) * 75, 0, -Math.cos(h) * 75);
    L.pos.addScaledVector(L.vel, dt);
    if (t > 30) worst = Math.max(worst, npc.leaderDist);
  });
  ok('npc: a gentle lead is followed within 1.2 km', worst < 1200, worst.toFixed(0));
  ok('npc: and he turned with it', Math.abs(((npc.heading - L.heading + 540) % 360) - 180) < 15, `${npc.heading.toFixed(0)} vs ${L.heading.toFixed(0)}`);
  npc.dispose();
}

/* The intercept geometry helpers. */
{
  const plane = { pos: new THREE.Vector3(0, 1000, 0), heading: 90, span: 64, length: 67 };
  const p = new THREE.Vector3();
  const L = { x: 0, y: 0, z: 0 };
  CAST.worldOf(plane, -10, 5, 200, p);
  CAST.localOf(plane, p, L);
  ok('cast: localOf undoes worldOf', Math.abs(L.x + 10) < 1e-6 && Math.abs(L.y - 5) < 1e-6 && Math.abs(L.z - 200) < 1e-6);
  ok('cast: behind an eastbound jet is west of it', p.x < -150);
  ok('cast: inside the wing is no clearance', CAST.clearanceTo(plane, new THREE.Vector3(0, 1000, 25)) < 0);
  ok('cast: the identify slot clears him', CAST.clearanceTo(plane, CAST.worldOf(plane, -(32 + 25), 12, -(80 + 32), p)) > 20);
  ok('cast: the shadow slot is out of his sight', !HL.seenFrom(plane, CAST.worldOf(plane, -(32 + 24), -30, 160 + 64 * 1.2, p)));
  ok('cast: but not when he looks out of the side window', HL.seenFrom(plane, p, true));
  ok('cast: unless you drop 25 m lower', !HL.seenFrom(plane, CAST.worldOf(plane, -(32 + 24), -55, 160 + 64 * 1.2, p), true));
  ok('cast: alongside him, he sees you', HL.seenFrom(plane, CAST.worldOf(plane, -80, 0, 0, p)));
  const rw = new CAST.RockWatch();
  let got = false;
  for (let t = 0; t < 6; t += 0.1) got = rw.update(0.1, t < 2 ? -20 : t < 4 ? 20 : 0) || got;
  ok('cast: a rock is seen', got);
  const bw = new CAST.BreakWatch();
  for (let t = 0; t < 10; t += 0.05) bw.update(0.05, (90 - t * 12 + 360) % 360, 1000 + t * 15);
  ok('cast: a climbing left turn of 120 degrees is a breakaway', bw.found(70, 100, -1) && !bw.found(70, 100, 1));
}

/* ------------------------------------------------------------------ */

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.name}${r.detail && !r.pass ? `  — ${r.detail}` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
