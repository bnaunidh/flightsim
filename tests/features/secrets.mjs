/**
 * Node checks for the secret planes in hidden hangars, the one E prompt for
 * everything you can use on foot, and Reset when you are out of your plane.
 *
 *   node tests/features/secrets.mjs            prints one line per check
 *   node tests/features/secrets.mjs --quiet    prints failures and the summary
 *
 * 1. THE INTERACTABLE REGISTRY (src/features/interact.js): what counts as
 *    in reach and looked at, the hold that fills and fires once, a source
 *    that throws, and the E key on the walker — it uses the thing in front
 *    of you, and with nothing there it still waves.
 * 2. RESET (src/features/rides.js): on foot out of an aeroplane it is on
 *    offer, and gone the moment you get back in, in a mission, as a
 *    passenger, or with eject's own "fly again" up.
 * 3. THE SAVE AND THE HINTS (src/features/secrets/store.js): when each hint
 *    comes, that each is said once, the rough mark's distance, finds and
 *    "Found at …", a save round trip and a corrupt save.
 * 4. THE DATA AND THE GROUND (src/features/secrets/data.js, sites.js): one
 *    or two hiding places on every map, every plane a real secret type, and
 *    every map built the way the game builds it, every hiding place given
 *    level, dry, clear ground — at its known place — and the carrier's hatch
 *    clear of the island, the landing lane, both catapults and the parked jets.
 * 5. THE PLANES (src/aircraft/extra/secret.js): versions of real types, drawn
 *    as them, not for sale; the tornado-proof one; Air Force One earned.
 * 6. A HIDEOUT, BUILT (src/features/secrets/build.js): the door's obstacle
 *    rises with the door, the plane is only drawn with the door open, the
 *    lights fade up without a step, inside/outside, the flight's start in
 *    front of the door; the hatch's lift.
 * 7. THE ACHIEVEMENTS for a find and for Air Force One.
 */

global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};
const mem = new Map();
global.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
global.window = global.window || { addEventListener() {} };

const SRC = new URL('../../src/', import.meta.url).href;
const quiet = process.argv.includes('--quiet');
const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail) });
  if (!quiet || !pass) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${String(detail).slice(0, 400)}` : ''}`);
}

const mods = {};
for (const m of [
  'features/interact.js', 'features/rides.js', 'features/secrets.js', 'features/airfield-use.js',
  'features/secrets/data.js', 'features/secrets/sites.js', 'features/secrets/store.js', 'features/secrets/build.js',
  'features/secrets/env.js', 'features/secrets/menu.js', 'features/secrets/reveal.js', 'aircraft/extra/secret.js',
]) {
  try {
    mods[m] = await import(SRC + m);
    ok(`imports ${m}`, true);
  } catch (e) {
    ok(`imports ${m}`, false, e && e.stack);
  }
}
const I = mods['features/interact.js'];
const RD = mods['features/rides.js'];
const D = mods['features/secrets/data.js'];
const ST = mods['features/secrets/sites.js'];
const SS = mods['features/secrets/store.js'];
const B = mods['features/secrets/build.js'];
const EV = mods['features/secrets/env.js'];
const THREE = await import(SRC + 'vendor/three.module.js');
const EXT = await import(SRC + 'game/extensions.js');
const OF = await import(SRC + 'features/onfoot.js');
const TYPES = await import(SRC + 'aircraft/types.js');
const INPUT = await import(SRC + 'flight/input.js');
const PROG = await import(SRC + 'game/progression.js');
const MA = await import(SRC + 'aircraft/model-adapter.js');
const LIV = await import(SRC + 'aircraft/liveries.js');
const AR = await import(SRC + 'features/achievements/rules.js');
const AS = await import(SRC + 'features/achievements/store.js');
const AD = await import(SRC + 'features/achievements/data.js');

/* ================================================================== */
/* 1. The interactable registry                                        */
/* ================================================================== */
{
  const w = { x: 0, z: 0 };
  const c = (o) => ({ id: 'x', label: 'Use', x: 0, z: -2, reach: 3, ...o });
  ok('registry: something 2 m in front, looked at, is in focus', I.pickFocus([c()], w, 0)?.id === 'x');
  ok('registry: …not if it is out of reach', I.pickFocus([c({ z: -4 })], w, 0) === null);
  ok('registry: …not if you are looking the other way', I.pickFocus([c()], w, 180) === null);
  ok('registry: right on top of it, any direction will do', I.pickFocus([c({ z: -1 })], w, 180)?.id === 'x');
  // 2 m north of you: facing south (180) it faces you; facing north (0) you are behind it.
  ok('registry: a thing with a front only works from in front of it', I.pickFocus([c({ face: 0 })], w, 0) === null && I.pickFocus([c({ face: 180 })], w, 0)?.id === 'x');
  const two = [c({ id: 'far', z: -2.8 }), c({ id: 'near', z: -1.6 })];
  ok('registry: the nearer of two wins', I.pickFocus(two, w, 0)?.id === 'near');
  const side = [c({ id: 'ahead', z: -2.6 }), c({ id: 'aside', x: 1.8, z: -0.6, look: 90 })];
  ok('registry: being looked at straight on is worth a little distance', I.pickFocus(side, w, 0)?.id === 'ahead');

  // The hold.
  const st = { t: 0, fired: false, fire: false };
  I.stepHold(st, { held: true, pressed: true, hold: 0, dt: 0.016 });
  const tapFired = st.fire;
  I.stepHold(st, { held: true, pressed: false, hold: 0, dt: 0.016 });
  const noRepeat = !st.fire;
  I.stepHold(st, { held: false, pressed: false, hold: 0, dt: 0.016 });
  I.stepHold(st, { held: true, pressed: true, hold: 0, dt: 0.016 });
  ok('hold: a press fires a switch once, and again after it is let go', tapFired && noRepeat && st.fire);
  const h = { t: 0, fired: false, fire: false };
  let firedAt = -1;
  for (let i = 0; i < 120; i++) {
    I.stepHold(h, { held: true, pressed: i === 0, hold: 1, dt: 1 / 60 });
    if (h.fire && firedAt < 0) firedAt = i;
  }
  ok('hold: a 1 s door fills while held and fires once, at about a second', firedAt >= 55 && firedAt <= 62, `fired at frame ${firedAt}`);
  let again = false;
  for (let i = 0; i < 120; i++) {
    I.stepHold(h, { held: true, pressed: false, hold: 1, dt: 1 / 60 });
    if (h.fire) again = true;
  }
  ok('hold: …and not again while it is still held', !again);
  const q = { t: 0, fired: false, fire: false };
  for (let i = 0; i < 20; i++) I.stepHold(q, { held: true, pressed: false, hold: 1, dt: 1 / 60 });
  const part = q.t;
  for (let i = 0; i < 20; i++) I.stepHold(q, { held: false, pressed: false, hold: 1, dt: 1 / 60 });
  ok('hold: let go early, it drains back and nothing happens', part > 0.25 && q.t < part && !q.fired);

  // Sources: one that throws does not stop the others.
  let used = 0;
  I.addInteractSource({ id: 'test-a', list: (sim, ww, add) => add({ id: 'a', label: 'Test A', x: ww.x, z: ww.z - 1.5, reach: 2, run: () => { used++; return ''; } }) });
  I.addInteractSource({ id: 'test-boom', list: () => { throw new Error('boom'); } });
  const warn = console.warn;
  console.warn = () => {};
  const list = I.gather({}, { x: 10, z: 10 });
  console.warn = warn;
  ok('registry: a source that throws is skipped, the others still list', list.some((x) => x.id === 'a'), list.map((x) => x.id).join(','));
  const f = I.frame({ hud: { notify() {} } }, { x: 10, z: 10 }, 0, 1 / 60, false);
  ok('registry: frame() puts it in focus', f && f.id === 'a' && I.focused());
  ok('registry: the prompt names the key, "E — Test A"', /<kbd>E<\/kbd> — Test A/.test(I.promptHtml({})), I.promptHtml({}));
  I.press();
  I.frame({ hud: { notify() {} } }, { x: 10, z: 10 }, 0, 1 / 60, true);
  ok('registry: E on it uses it', used === 1, `${used} uses`);
  I.removeInteractSource('test-a');
  I.removeInteractSource('test-boom');
  I.frame({}, { x: 10, z: 10 }, 0, 1 / 60, false);
  ok('registry: with nothing near there is no focus', !I.focused());
  ok('registry: the airfield and the hiding places are sources', ['secrets', 'airfield'].every((id) => I.interactSources().includes(id)), I.interactSources().join(','));

  // The key: one action, E, in the On foot group, sharing E with Wave by design.
  const A = INPUT.ACTIONS;
  ok('key: "interact" is in the registry, On foot, E by default', A.interact && A.interact.group === 'On foot' && A.interact.ctx.includes('foot') && A.interact.default.includes('KeyE'));
  const clash = INPUT.findConflicts(INPUT.defaultBindings());
  ok('key: no default clashes (E is Wave and Use by design)', Object.keys(clash).length === 0, JSON.stringify(clash).slice(0, 200));
}

/* ================================================================== */
/* 1b, 2. The walker's E, and Reset, against a stand-in game           */
/* ================================================================== */
{
  const TERR = await import(SRC + 'world/terrain.js');
  TERR.applyMap('kestrel');
  const ext = EXT.extensions().find((e) => e.id === 'onfoot');
  const type = TYPES.getAircraft('skylark');
  const ac = {
    pos: new THREE.Vector3(0, TERR.heightAt(0, -40) + 1.5, -40),
    heading: 90,
    onGround: true,
    groundSpeed: 0,
    crashed: false,
    engineOn: true,
    starting: 0,
    stopEngine() { this.engineOn = false; },
    startEngine() { this.engineOn = true; },
  };
  let started = null;
  const sim = {
    state: 'flying',
    mode: 'free',
    modeOpts: { aircraft: 'skylark' },
    aircraft: ac,
    aircraftType: type,
    model: MA.createAircraftModel({ type }),
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(68, 1.5, 0.4, 60000),
    input: { keys: new Set(), throttleTarget: 0, out: { throttle: 0 }, mouse: { x: 0, y: 0 } },
    hud: { notify() {}, setCoach() {} },
    override: null,
    startMode(mode, opts) { started = { mode, opts }; return Promise.resolve(); },
  };
  // The plug-ins' install(), as boot runs it: rides.js puts its provider (Reset's key and button) on the walker.
  EXT.extensions().find((e) => e.id === 'rides').install(sim);
  ext.update(sim, 1 / 60);
  ok('reset: not offered in the seat', !RD.resetAvailable(sim));
  ext.key(sim, 'KeyO', true, {});
  ext.key(sim, 'KeyO', false, {});
  ext.update(sim, 1 / 60);
  ok('reset: out of the aeroplane on foot, Reset is on offer', OF.onFoot.active && RD.resetAvailable(sim));
  const prov = { solids() {} };
  // E with nothing in front of you waves (the old E).
  ext.key(sim, 'KeyE', true, {});
  ext.update(sim, 1 / 60);
  ok('E: with nothing in front of you, E still waves', OF.onFoot.waving);
  ext.key(sim, 'KeyE', false, {});
  // E with a door in front of you uses the door and does not wave (away from the aeroplane, whose door is O's).
  let opened = 0;
  OF.onFoot.place(ac.pos.x - 20, ac.pos.z - 20);
  const w = OF.onFoot.walker;
  I.addInteractSource({ id: 'test-door', list: (s, ww, add) => add({ id: 'door', label: 'Open the test door', x: w.x + Math.sin(OF.onFoot.snapshot().camYaw * Math.PI / 180) * 1.5, z: w.z - Math.cos(OF.onFoot.snapshot().camYaw * Math.PI / 180) * 1.5, reach: 3, hold: 0, run: () => { opened++; return ''; } }) });
  for (let i = 0; i < 150; i++) ext.update(sim, 1 / 60);
  ext.update(sim, 1 / 60);
  ok('E: a door in front of you is on the prompt', /Open the test door/.test(OF.onFoot.snapshot().prompt), OF.onFoot.snapshot().prompt);
  const took = ext.key(sim, 'KeyE', true, {});
  ext.update(sim, 1 / 60);
  ext.key(sim, 'KeyE', false, {});
  ext.update(sim, 1 / 60);
  ok('E: E on it opens it, and is taken from the walker', took === true && opened === 1, `took ${took}, opened ${opened}`);
  I.removeInteractSource('test-door');
  void prov;
  // Reset's key is the fly-again key, taken by the walker's provider.
  const before = started;
  ext.key(sim, 'Enter', true, {});
  ext.key(sim, 'Enter', false, {});
  ok('reset: Enter on foot asks for a fresh one of the same aeroplane at a class spawn', started && started !== before && started.mode === 'free' && started.opts.aircraft === 'skylark' && started.opts.startAt && !started.opts.rideFrom, JSON.stringify(started && started.opts));
  // In a mission it is not offered.
  sim.runner = { status: 'running' };
  ok('reset: not in a mission (they have their own restart)', !RD.resetAvailable(sim));
  sim.runner = null;
  sim.mode = 'mission';
  ok('reset: not in a mission mode either', !RD.resetAvailable(sim));
  sim.mode = 'free';
  sim.riding = { seat: 'president' };
  ok('reset: not as a passenger', !RD.resetAvailable(sim));
  sim.riding = null;
  OF.onFoot.setControl({ ejected: true, prompt: 'Safe!' });
  ok('reset: not over eject.js’s own "fly again"', !RD.resetAvailable(sim));
  OF.onFoot.setControl(null);
  ok('reset: back on offer without it', RD.resetAvailable(sim));
  // Back into the aeroplane: gone.
  OF.onFoot.place(ac.pos.x + 0, ac.pos.z + 3);
  ext.update(sim, 1 / 60);
  OF.onFoot.pressO(sim);
  ok('reset: getting into the aeroplane, Reset disappears', !OF.onFoot.active && !RD.resetAvailable(sim));
  // Out again, then into another vehicle (the walker put away by a ride): gone.
  ext.key(sim, 'KeyO', true, {});
  ext.key(sim, 'KeyO', false, {});
  ok('reset: out again, it is back', OF.onFoot.active && RD.resetAvailable(sim));
  OF.onFoot.end(sim);
  ok('reset: into anything else, it is gone', !RD.resetAvailable(sim));
  ok('reset: on a touch screen it is a thumb button too', (() => {
    ext.key(sim, 'KeyO', true, {});
    ext.key(sim, 'KeyO', false, {});
    const b = RD.ridesState(sim).resetAvailable;
    OF.onFoot.end(sim);
    return b;
  })());
}

/* ================================================================== */
/* 3. The save and the hints                                           */
/* ================================================================== */
{
  const st = SS.blank();
  const spot = D.SPOTS[0];
  ok('hints: none before four minutes on the map', SS.nextHint(st, spot, 200) === 0);
  ok('hints: the rumour at four minutes', SS.nextHint(st, spot, 241) === 1);
  SS.giveHint(st, spot, 1);
  ok('hints: …said once', SS.nextHint(st, spot, 300) === 0);
  ok('hints: the clue at nine minutes', SS.nextHint(st, spot, 541) === 2);
  SS.giveHint(st, spot, 2);
  ok('hints: the mark on the map at fifteen', SS.nextHint(st, spot, 901) === 3);
  ok('hints: a long gap skips straight to the latest one due', SS.nextHint(SS.blank(), spot, 2000) === 3);
  const lines = D.hintLines(spot);
  ok('hints: three lines, the rumour naming the place', lines.length === 3 && lines[0].includes(spot.place), lines.join(' | '));
  const marks = D.SPOTS.map((s) => {
    const m = SS.roughMark(s, { x: 0, z: 0 });
    return Math.hypot(m.x, m.z);
  });
  ok('hints: the rough mark is 60-140 m off, every spot', marks.every((d) => d >= 59.9 && d <= 140.1), `${Math.min(...marks).toFixed(0)}-${Math.max(...marks).toFixed(0)} m`);
  const a = SS.roughMark(spot, { x: 10, z: 10 });
  const b = SS.roughMark(spot, { x: 10, z: 10 });
  ok('hints: …and the same place every time', a.x === b.x && a.z === b.z);
  const r1 = SS.markFound(st, spot, { mapName: 'Kestrel Island' });
  ok('finds: the first find is first, and a new plane, found at its place', r1.first && r1.newPlane && /Mango Cay, Kestrel Island/.test(r1.where), JSON.stringify(r1));
  ok('finds: …and no more hints for it', SS.nextHint(st, spot, 5000) === 0);
  const other = D.SPOTS.find((s) => s.plane === spot.plane && s.id !== spot.id);
  const r2 = SS.markFound(st, other, { mapName: 'Elsewhere' });
  ok('finds: the same plane somewhere else is a first find, not a new plane, and keeps the first "found at"', r2.first && !r2.newPlane && r2.where === r1.where, JSON.stringify(r2));
  ok('finds: earned, not found (Air Force One)', SS.markEarned(st, 'af1', 'Under Attack') && !SS.markEarned(st, 'af1', 'again') && SS.foundAt(st, 'af1') === 'Under Attack');
  const store = new Map();
  const fake = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  SS.addMapTime(st, 'kestrel', 12.5);
  SS.save(st, fake);
  const back = SS.load(fake);
  ok('save: round trip keeps finds, planes, hints and minutes', back.found[spot.id] && back.planes[spot.plane] && back.hints[spot.id] === 2 && back.mapTime.kestrel === 12.5);
  store.set(SS.KEY, '{not json');
  const bad = SS.load(fake);
  ok('save: a corrupt save is a fresh start, not a throw', bad && Object.keys(bad.found).length === 0);
  ok('save: no storage at all is a fresh start too', Object.keys(SS.load(null).found).length === 0);
}

/* ================================================================== */
/* 5. The planes                                                       */
/* ================================================================== */
const SECRET_TYPES = TYPES.AIRCRAFT.filter((t) => t.secret);
{
  ok('planes: five secret planes in the roster', SECRET_TYPES.length === 5, SECRET_TYPES.map((t) => t.id).join(','));
  const bad = SECRET_TYPES.filter((t) => !t.variantOf || !TYPES.AIRCRAFT.some((b) => b.id === t.variantOf && !b.secret));
  ok('planes: each a version of a real roster type', bad.length === 0, bad.map((t) => t.id).join(','));
  ok('planes: none for sale (progression.js UNLOCKS) and none free', SECRET_TYPES.every((t) => !PROG.costOf(t.id) && !PROG.load().unlocked.includes(t.id)));
  ok('planes: none behind the military passcode', SECRET_TYPES.every((t) => !t.military));
  const storm = TYPES.getAircraft('stormpetrel');
  ok('planes: the Storm Petrel is tornado-proof (stormProof, the Tempest’s switch)', storm.stormProof === true);
  const af1 = TYPES.getAircraft('af1');
  ok('planes: Air Force One is the 747, earned by 80+ on Under Attack, in the potus scheme', af1.variantOf === 'b747' && af1.secret.how === 'earned' && af1.secret.mission === 'afo-attack' && af1.secret.score === 80 && af1.houseScheme === 'potus');
  ok('planes: baseTypeId() reads through a version', TYPES.baseTypeId('af1') === 'b747' && TYPES.baseTypeId('skylark') === 'skylark' && TYPES.baseTypeId(af1) === 'b747');
  const drawn = [];
  for (const t of SECRET_TYPES) {
    try {
      const m = MA.createAircraftModel({ type: t, livery: LIV.schemeFor(t, 'house') });
      const base = MA.createAircraftModel({ type: TYPES.getAircraft(t.variantOf), livery: LIV.schemeFor(TYPES.getAircraft(t.variantOf), 'house') });
      let n = 0;
      let nb = 0;
      m.traverse((o) => { if (o.isMesh) n++; });
      base.traverse((o) => { if (o.isMesh) nb++; });
      drawn.push({ id: t.id, ok: n > 0 && Math.abs(n - nb) <= 6 && // a scheme's title patches (fleet/extra/title-slot.js) are parts too
         !!m.userData.fleetBridge === !!base.userData.fleetBridge, n, nb });
    } catch (e) {
      drawn.push({ id: t.id, ok: false, e: String(e) });
    }
  }
  ok('planes: each is drawn as the aeroplane it is a version of (same factory, same parts)', drawn.every((d) => d.ok), JSON.stringify(drawn));
  const Air = await import(SRC + 'features/airliners.js');
  ok('planes: Air Force One gets the 747’s take-off flap and its camera stretch', Air.TAKEOFF_FLAPS.b747 && Air.viewScale('af1') === Air.viewScale('b747') && Air.isAirliner({ aircraftType: af1 }));
  const P = await import(SRC + 'features/eject/profiles.js');
  ok('planes: a version escapes like its base (Air Force One: no seat, like the 747)', P.profileFor(af1).escape === P.profileFor(TYPES.getAircraft('b747')).escape && P.profileFor(TYPES.getAircraft('x1')).escape === P.profileFor(TYPES.getAircraft('vanguard')).escape);
}

/* ================================================================== */
/* 4. The data, and the ground on every map                            */
/* ================================================================== */
{
  const M = await import(SRC + 'world/maps.js');
  const ids = D.SPOTS.map((s) => s.id);
  ok('data: every spot id is unique', new Set(ids).size === ids.length);
  const perMap = M.MAPS.map((m) => ({ id: m.id, n: D.spotsFor(m.id).length }));
  ok('data: one or two hiding places on every map', perMap.every((p) => p.n >= 1 && p.n <= 2), perMap.filter((p) => p.n < 1 || p.n > 2).map((p) => `${p.id}:${p.n}`).join(', ') || `${M.MAPS.length} maps, ${D.SPOTS.length} places`);
  const known = (s) => s.map && M.MAPS.some((m) => m.id === s.map) && ST.KINDS[s.kind] && D.KIND_WORDS[s.kind] && D.CLUE_WORDS[s.clue] && s.place;
  ok('data: every spot names a real map, a known kind and clue, and a place', D.SPOTS.every(known), D.SPOTS.filter((s) => !known(s)).map((s) => s.id).join(','));
  const found = SECRET_TYPES.filter((t) => t.secret.how === 'found').map((t) => t.id);
  ok('data: every spot hides a secret plane that is found, not earned', D.SPOTS.every((s) => found.includes(s.plane)));
  ok('data: every found-type secret plane is hidden somewhere', found.every((id) => D.SPOTS.some((s) => s.plane === id)));
  const kinds = new Set(D.SPOTS.map((s) => s.kind));
  ok('data: all five kinds are used: shed, cave, bunker, the far hangar, the carrier hatch', ['shed', 'cave', 'bunker', 'far', 'hatch'].every((k) => kinds.has(k)), [...kinds].join(','));
  const lm = D.SPOTS.filter((s) => !s.near.carrier && !ST.landmarkPoint(M.getMap(s.map), s.near));
  ok('data: every landmark named is on its map', lm.length === 0, lm.map((s) => s.id).join(','));
  ok('data: positions are by landmark (a known place is only a shortcut)', D.SPOTS.every((s) => s.near && typeof s.near === 'object'));

  // Every map, built the way buildWorld builds it, and every spot sited.
  const T = await import(SRC + 'world/terrain.js');
  const PADS = await import(SRC + 'world/pads.js');
  const ROADS = await import(SRC + 'world/roads.js');
  const SC = await import(SRC + 'world/scenery.js');
  const FE = await import(SRC + 'world/features.js');
  const AP = await import(SRC + 'world/airport.js');
  const CB = await import(SRC + 'world/carrier-berth.js');
  const CV = await import(SRC + 'world/carrier.js');
  const LAY = await import(SRC + 'world/airport-layout.js');
  const DK = await import(SRC + 'features/carrier/deck.js');
  const sited = [];
  const unsited = [];
  const moved = [];
  const hatch = [];
  let slow = 0;
  const log = console.log;
  const dbg = console.debug;
  for (const map of M.MAPS) {
    const spots = D.spotsFor(map.id);
    T.applyMap(map);
    T.clearObstacles(); T.clearPlatforms(); PADS.clearPads();
    let roads = (map.waters && map.waters.roads) || null;
    if (map.courier && !(roads && roads.length)) {
      const b = ROADS.buildRoads(map);
      map.waters = map.waters || {};
      map.waters.roads = b.roads;
      delete map.waters._ready;
      T.applyMap(map);
      T.clearObstacles(); T.clearPlatforms(); PADS.clearPads();
      roads = b.roads;
    }
    const scene = new THREE.Scene();
    console.debug = () => {};
    console.log = () => {};
    try { new AP.Airport(scene); } catch (e) { /* a map with no airfield */ }
    try { new SC.Scenery(scene, 'high'); } catch (e) { /* reported by maps.mjs */ }
    try { new FE.MapFeatures(scene, 'high'); } catch (e) { /* reported by maps.mjs */ }
    const berth = CB.chooseBerth({ map: T.MAP, airport: T.AIRPORT, heightAt: T.heightAt });
    const at = T.MAP.carrier && berth.why === 'map' ? T.MAP.carrier : { x: berth.x, z: berth.z };
    let carrier = null;
    try { carrier = new CV.Carrier(scene, { x: at.x, z: at.z, headingDeg: 0, name: 'CV' }); } catch (e) { carrier = null; }
    console.log = log;
    console.debug = dbg;
    const env = EV.worldEnv({ onRoad: (x, z, m) => ROADS.onRoad(roads, x, z, m), carrier });
    for (const s of spots) {
      const t0 = Date.now();
      const site = ST.findSite(s, LAY.typeSize(s.plane), env, { budgetMs: 0, maxR: 2200 });
      const ms = Date.now() - t0;
      if (!site) {
        unsited.push(`${s.id} (${JSON.stringify(ST.findSite.lastRefused)})`);
        continue;
      }
      sited.push(s.id);
      if (!site.hatch && !(site.from && site.from.known)) moved.push(`${s.id}: known place refused (${ST.findSite.knownRefused}); found ${Math.round(site.x)},${Math.round(site.z)} h${site.headingDeg}`);
      if (site.from && site.from.known && ms > 30) slow++;
      if (site.hatch && carrier) {
        // Clear of the island, the landing lane, both catapults and the parked jets.
        const f = DK.frameFor(carrier);
        const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]].map(([a, b]) => ({ x: site.x + a * site.hx, z: site.z + b * site.hz }));
        const lane = corners.some((p) => {
          const st = DK.station(f, p.x, p.z);
          return Math.abs(st.lat) < f.areaHalfWidth + 6 && st.s > -f.areaHalf - 40 && st.s < f.areaHalf + 400;
        });
        const cats = DK.catapults(f).some((c) => corners.some((p) => Math.abs(p.x - c.start.x) < 12 && p.z > Math.min(c.start.z, c.end.z) - 20 && p.z < Math.max(c.start.z, c.end.z) + 20));
        const island = T.OBSTACLES.some((o) => /flew into/.test(o.what || '') && corners.some((p) => p.x > o.x0 - 4 && p.x < o.x1 + 4 && p.z > o.z0 - 4 && p.z < o.z1 + 4) && o.y0 >= carrier.deckY - 1);
        const W = CV.DECK.width;
        const L = CV.DECK.length;
        const jets = [[W * 0.30, -L * 0.30], [W * 0.31, -L * 0.20], [W * 0.30, -L * 0.10], [-W * 0.34, L * 0.36], [-W * 0.22, L * 0.40], [W * 0.30, L * 0.42]]
          .some(([jx, jz]) => Math.abs(carrier.pos.x + jx - site.x) < site.hx + 12 && Math.abs(carrier.pos.z + jz - site.z) < site.hz + 12);
        const onDeck = T.platformAt(site.x - site.hx, site.z - site.hz) && T.platformAt(site.x + site.hx, site.z + site.hz);
        hatch.push({ id: s.id, ok: !lane && !cats && !island && !jets && !!onDeck, lane, cats, island, jets, onDeck: !!onDeck });
      }
    }
  }
  ok(`ground: every hiding place on every map finds level, dry, clear ground (${D.SPOTS.length})`, unsited.length === 0, unsited.join('; ') || `${sited.length} sited`);
  ok('ground: every land hiding place is still at its known place (the map has not moved under it)', moved.length === 0, moved.join('; '));
  ok('ground: a known place is a millisecond, not a search', slow === 0, `${slow} slow`);
  ok('ground: every carrier hatch is on the deck, clear of the island, the landing lane, the catapults and the parked jets', hatch.length >= 3 && hatch.every((h) => h.ok), JSON.stringify(hatch));
}

/* ================================================================== */
/* 6. A hideout, built                                                 */
/* ================================================================== */
{
  const type = TYPES.getAircraft('speedster');
  const spot = { id: 'test-shed', map: 'kestrel', kind: 'shed', plane: 'speedster', clue: 'light', place: 'here' };
  const size = ST.sizeFor('shed', { span: 12.3, length: 7.4 });
  const site = { x: 100, z: 200, headingDeg: 90, w: size.w, d: size.d, h: size.h, doorH: size.doorH, hx: size.d / 2, hz: size.w / 2, floorY: 20, groundLo: 19.7, door: { x: 100 + size.d / 2, z: 200 } };
  const make = (t) => MA.createAircraftModel({ type: t, livery: LIV.schemeFor(t, 'house'), landingLight: false });
  const h = new B.Hideout(spot, site, type, { makeModel: make, ground: () => 19.8 });
  ok('hideout: built with a door, lamps and lining, and no plane behind a shut door', !!h.door && !!h.lampMat && !!h.liningMat && !h.plane);
    ok('hideout: shut, the door is solid from the floor to its top', Math.abs(h.doorBox.y0 - 20) < 1e-6 && Math.abs(h.doorBox.y1 - 20 - size.doorH) < 1e-6);
  h.target = 1;
  h.lightsOn = true;
  const lights = [];
  for (let i = 0; i < 60 * 6; i++) {
    h.update(1 / 60);
    lights.push(h.light);
  }
  ok('hideout: the door rolls up in a few seconds', h.open === 1, `open ${h.open}`);
  ok('hideout: open, the door is no longer in the way', h.doorBox.y0 >= h.doorBox.y1 - 1e-6);
  ok('hideout: open, the plane is drawn', h.plane.visible === true);
  let maxStep = 0;
  let downs = 0;
  for (let i = 1; i < lights.length; i++) {
    maxStep = Math.max(maxStep, Math.abs(lights[i] - lights[i - 1]));
    if (lights[i] < lights[i - 1] - 1e-9) downs++;
  }
  ok('hideout: the lights come on as a steady fade — no flicker, no step', h.light === 1 && downs === 0 && maxStep <= 0.021, `max step ${maxStep.toFixed(3)}, ${downs} dips`);
  ok('hideout: the lamps glow and the lining is lit', h.lampMat.emissiveIntensity > 1.4 && h.liningMat.color.r > 0.7);
  const p = h.planeWorld();
  ok('hideout: the plane is inside, nose to the door', h.inside(p.x, p.z) && p.headingDeg === 90);
  ok('hideout: outside the door is outside', !h.inside(site.door.x + 3, site.door.z));
  const sp = h.spawnWorld();
  ok('hideout: a flight in it starts in front of the door, facing out', sp.x > site.door.x + 3 && Math.abs(sp.z - 200) < 0.01 && sp.headingDeg === 90, JSON.stringify(sp));
  const ob = h.obstacles.length;
  ok('hideout: walls, back, roof and door are solid', ob >= 7, `${ob} boxes`);
  h.target = 0;
  for (let i = 0; i < 60 * 6; i++) h.update(1 / 60);
  ok('hideout: and it closes again', h.open === 0 && h.plane.visible === false && h.doorBox.y0 === 20);
  h.dispose();

  // The hatch: the lift brings the plane up once the doors are apart.
  const ghost = TYPES.getAircraft('seaghost');
  const hs = ST.findSite({ id: 't', kind: 'hatch', plane: 'seaghost', near: { carrier: true } }, { span: 12, length: 15 }, { map: {}, carrier: { x: 0, z: 0, deckY: 104, headingDeg: 0 } });
  const hh = new B.Hideout({ id: 'test-hatch', kind: 'hatch', plane: 'seaghost', clue: 'light', place: 'the carrier' }, hs, ghost, { makeModel: make });
  hh.target = 1;
  let liftUp = -1;
  for (let i = 0; i < 60 * 12; i++) {
    hh.update(1 / 60);
    if (liftUp < 0 && hh.liftT >= 1) liftUp = i / 60;
  }
  ok('hatch: the doors part and then the lift brings the plane up to the deck', hh.open === 1 && hh.liftT === 1 && Math.abs(hh.lift) < 1e-6, `lift ${hh.liftT}, at ${liftUp.toFixed(1)} s`);
  hh.target = 0;
  let shutWhileUp = false;
  for (let i = 0; i < 60 * 14; i++) {
    hh.update(1 / 60);
    if (hh.open < 0.85 && hh.liftT > 0.05) shutWhileUp = true;
  }
  ok('hatch: closing, the lift goes down first and the doors never shut on it', !shutWhileUp && hh.open === 0 && hh.liftT === 0);
  ok('hatch: a flight from it starts on the deck, pointing the way the ship does', hh.spawnWorld().headingDeg === 0);
  hh.dispose();
}

/* ================================================================== */
/* 7. Achievements                                                     */
/* ================================================================== */
{
  const st = AS.blank();
  const a = AR.applyEvent(st, 'secretFound', { plane: 'speedster', allFound: false });
  const b = AR.applyEvent(st, 'secretFound', { plane: 'x1', allFound: true });
  const c = AR.applyEvent(st, 'secretEarned', { plane: 'af1' });
  ok('achievements: a find unlocks "Secret Found"', a.includes('secret-found'));
  ok('achievements: the last one unlocks "Nothing Stays Hidden"', b.includes('secret-all') && !b.includes('secret-found'));
  ok('achievements: Air Force One earned unlocks "Air Force One Unlocked"', c.includes('afo-unlock'));
  ok('achievements: all three are in the catalogue', ['secret-found', 'secret-all', 'afo-unlock'].every((id) => AD.ACHIEVEMENTS_BY_ID.has(id)));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  for (const f of failed) console.log(`FAIL  ${f.name}  — ${f.detail.slice(0, 300)}`);
  process.exitCode = 1;
}
