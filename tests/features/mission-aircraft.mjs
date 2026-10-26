/**
 * Every mission flies a fitting aircraft (the owner, 2026-10-25:
 * "missions must use fitting specialized aircraft"), from one table:
 * src/game/mission-aircraft.js. Run from the repo root:
 *
 *   node tests/features/mission-aircraft.mjs
 *
 *   1. THE TABLE covers every flight and helicopter mission, names only
 *      missions and aircraft that exist, and puts the recommended type on
 *      each mission as its `aircraft` (but leaves a getter alone).
 *   2. THE OWNER'S RULES: the Class-D transfer in the C-17; rescue in the
 *      AW139 (or the UH-60); medevac in the H145; the president in Air
 *      Force One; the fires in the water bomber; tornado research in the
 *      research aeroplane; the lessons in the trainer.
 *   3. CHOOSING: the asked-for type if the mission takes it, else the one
 *      picked on the Free Flight screen if it takes that, else the
 *      recommended one; a mission not listed has no opinion.
 *   4. THE WORDS match the aircraft: no mission flown in the C-17, the
 *      AW139 or the H145 calls you "Courier", "Skyhook" or "Skylark", and
 *      the card says "Recommended aircraft: …".
 */
globalThis.document = {
  createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }), width: 0, height: 0, style: {} }),
  body: { appendChild() {} },
};
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const root = new URL('../../src/', import.meta.url);
const imp = (p) => import(new URL(p, root).href);
const M = await imp('game/missions.js');
const MA = await imp('game/mission-aircraft.js');
const TY = await imp('aircraft/types.js');

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? '  — ' + detail : ''}`);
};
const ids = new Set(TY.AIRCRAFT.map((a) => a.id));
const find = (id) => M.findMission(id);

/* ---- 1. the table ---- */
const flying = M.MISSIONS.filter((m) => ['flight', 'heli'].includes(M.gameOf(m)));
const unlisted = flying.filter((m) => !MA.MISSION_AIRCRAFT[m.id]);
ok('every flight and helicopter mission is in the table', unlisted.length === 0, unlisted.map((m) => m.id).join(', ') || `${flying.length} missions`);
const stray = Object.keys(MA.MISSION_AIRCRAFT).filter((id) => !find(id));
ok('…and the table names no mission that does not exist', stray.length === 0, stray.join(', '));
const badType = Object.entries(MA.MISSION_AIRCRAFT).flatMap(([id, e]) => (e.fly || []).filter((t) => !ids.has(t)).map((t) => `${id}:${t}`));
ok('…nor any aircraft that does not exist', badType.length === 0, badType.join(', '));
ok('…and every entry says why', Object.values(MA.MISSION_AIRCRAFT).every((e) => typeof e.why === 'string' && e.why.length > 10));
const wrongAc = flying.filter((m) => MA.MISSION_AIRCRAFT[m.id].fly && m.aircraft !== MA.MISSION_AIRCRAFT[m.id].fly[0]);
ok('each mission\'s `aircraft` is its recommended type', wrongAc.length === 0, wrongAc.map((m) => `${m.id}=${m.aircraft}`).join(', '));
const hijack = find('event-hijack');
const d = Object.getOwnPropertyDescriptor(hijack, 'aircraft');
ok('…but the hijack keeps its getter (whichever long-haul jet the roster has)', !!(d && d.get) && ids.has(hijack.aircraft) && MA.recommendedFor(hijack) === hijack.aircraft, hijack.aircraft);
ok('the boat\'s and the car\'s missions have no aircraft', M.MISSIONS.filter((m) => ['boat', 'car'].includes(M.gameOf(m))).every((m) => !MA.MISSION_AIRCRAFT[m.id]));

/* ---- 2. the owner's rules ---- */
const rec = (id) => MA.recommendedFor(find(id));
const also = (id) => MA.allowedFor(find(id));
ok('Class-D transfer: the C-17', rec('classd-transfer') === 'c17');
ok('rescue: the AW139, or the UH-60 (Man Overboard, The Ledge)', ['overboard', 'stackrescue'].every((id) => rec(id) === 'aw139' && also(id).includes('uh60')));
ok('…and on the mountain (Last Light) the H145, as mountain rescue flies it, the AW139 accepted too', rec('lastlight') === 'h145' && also('lastlight').includes('aw139'));
ok('…and the offshore night casualty and the patrol in the rescue twin', rec('nightdeck') === 'aw139' && rec('oncall') === 'aw139');
ok('medevac: the H145 (Night Medevac, The Cove)', rec('medevac') === 'h145' && rec('covepickup') === 'h145');
ok('…and Night Medevac is on the helicopter\'s board now', M.gameOf(find('medevac')) === 'heli' && M.missionsFor('heli').includes(find('medevac')) && !M.missionsFor('flight').includes(find('medevac')));
ok('VIP: Air Force One (the 747) for the president', rec('afo-normal') === 'b747' && rec('afo-attack') === 'b747');
ok('firefighting: the water bomber (the Tempest scoops) and the Skyhook\'s bucket', ['fire-spot', 'fire-town', 'fire-bigburn', 'fire-night'].every((id) => rec(id) === 'tempest') && ['fire-bucket', 'fire-heli-town', 'fire-ridge', 'fire-heli-night', 'fire-lineone'].every((id) => rec(id) === 'harrier'));
ok('tornado research: the Tempest, built to be flown into storms', rec('chaser') === 'tempest' && TY.getAircraft('tempest').stormProof === true);
ok('the lessons: the trainer they are written for', ['circuit', 'delivery', 'storm', 'deadstick'].every((id) => rec(id) === 'skylark') && rec('firstlight') === 'harrier');

/* ---- 3. choosing ---- */
const ob = find('overboard');
ok('choosing: the type asked for, when the mission takes it', MA.pickMissionAircraft(ob, { asked: 'uh60', current: 'skylark' }) === 'uh60');
ok('…the one picked on the Free Flight screen, when it takes that', MA.pickMissionAircraft(ob, { asked: null, current: 'uh60' }) === 'uh60');
ok('…else the recommended one (an A380 is not a rescue helicopter)', MA.pickMissionAircraft(ob, { asked: 'a380', current: 'skylark' }) === 'aw139');
ok('…and a mission with no list has no opinion', MA.pickMissionAircraft({ id: 'nothing-here' }, { asked: 'a380' }) === null && MA.pickMissionAircraft(M.FREE_FLIGHT, { asked: 'a380' }) === null);
ok('…a seat on a mission with roles brings its own aeroplane', MA.pickMissionAircraft({ id: 'afo-normal', roleId: 'escort', aircraft: 'f22' }, { current: 'skylark' }) === 'f22');

/* ---- 4. the words ---- */
const nameOf = (id) => (TY.AIRCRAFT.find((a) => a.id === id) || {}).name;
ok('the card line: "Recommended aircraft: …", and what else it takes', MA.recommendedLine(ob, nameOf) === 'Recommended aircraft: AW139 Rescue · also UH-60 Black Hawk' && MA.recommendedLine(find('classd-transfer'), nameOf) === 'Recommended aircraft: Boeing C-17 Globemaster III', MA.recommendedLine(ob, nameOf));
ok('…and nothing for a boat or a car', M.MISSIONS.filter((m) => ['boat', 'car'].includes(M.gameOf(m))).every((m) => MA.recommendedLine(m, nameOf) === ''));
const words = (m) => {
  const out = [m.blurb || '', m.short || '', m.reward || ''];
  for (const s of m.steps || []) {
    out.push(s.text || '', s.hint || '');
    try {
      if (s.atc) out.push(s.atc.text || '');
    } catch (e) {
      /* a getter that needs the map */
    }
  }
  return out.join(' ');
};
const mismatch = [];
for (const m of flying) {
  const t = MA.allowedFor(m);
  const w = words(m) + ' ' + String(m.onComplete || '');
  if (t.every((x) => x !== 'courier') && /\bCourier two\b/.test(w)) mismatch.push(`${m.id}: Courier`);
  if (t.every((x) => x !== 'harrier') && /\bSkyhook three\b/.test(w)) mismatch.push(`${m.id}: Skyhook`);
  if (t.every((x) => x !== 'skylark') && /\bSkylark one\b/.test(w)) mismatch.push(`${m.id}: Skylark`);
}
ok('the radio never calls you by another aircraft\'s name (Courier, Skyhook, Skylark)', mismatch.length === 0, mismatch.join('; '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
