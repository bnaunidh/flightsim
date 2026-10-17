/**
 * Node checks for the secret runway hitbox and the three-second rule
 * (src/game/landing-zone.js; the owner, 2026-10-16: "for things where u need
 * aland on runway just add a runway hitbox thats secret and if you land on
 * there for more than 3 seconds you land"). Run with plain node:
 *
 *   node tests/features/landing-zone.mjs
 *
 *   1. THE BOXES: every map has one box per runway in its data, and each is
 *      the runway plus 60 m past both ends and 15 m of shoulder both sides,
 *      a slab round the runway's height — checked from both ends (09 and
 *      27 are one box), against the thresholds and the touchdown point, and
 *      against terrain.js's own isOnRunway/isOnRunway2. A map from the
 *      future (a parallel second runway, a diagonal third) gets its boxes
 *      from its data with nothing named.
 *   2. THE DWELL: 2.9 s does not count and 3.1 s does; a bounce under 0.3 s
 *      is forgiven and a longer one is a take-off; leaving the box starts it
 *      again; a crash never counts; the clock-driven form agrees, and a gap
 *      nobody watched starts it again.
 *   3. EVERY LANDING STEP: each runway landing in the game (the missions,
 *      the tutorial, Air Force One's two and the lead fighter's two, the
 *      story's chapter 1 landing) completes after three seconds of a long,
 *      fast roll on its own map's runway — not at 2.9 — and never for an
 *      aeroplane stopped on the grass beside it; the helicopter pads and the
 *      medevac's strip the same on their disc.
 */

const NOOP = () => {};
const el = () => ({
  getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
  width: 0,
  height: 0,
  style: {},
  classList: { add() {}, toggle() {}, remove() {} },
  addEventListener() {},
  appendChild() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  setAttribute() {},
});
globalThis.document = {
  createElement: el,
  body: { appendChild() {} },
  head: { appendChild() {} },
  getElementById: () => null,
  documentElement: { classList: { toggle() {}, add() {} } },
};
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = globalThis.window || { addEventListener() {} };

const root = new URL('../../', import.meta.url);
const imp = (p) => import(new URL(p, root).href);

let passed = 0;
let failed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? `  — ${detail}` : ''}`);
}

const THREE = await imp('src/vendor/three.module.js');
const T = await imp('src/world/terrain.js');
const M = await imp('src/world/maps.js');
const AP = await imp('src/world/airport.js');
const LZ = await imp('src/game/landing-zone.js');
const R = LZ.LANDING_RULE;

/* ------------------------------------------------------------------ */
/* 1. the boxes                                                        */
/* ------------------------------------------------------------------ */

ok('the rule: a touchdown counts at once (owner 2026-10-16: "you land you land"), bounces under 0.3 s, 60 m past each end, 15 m of shoulder',
  R.hold === 0 && R.bounce === 0.3 && R.endMargin === 60 && R.sideMargin === 15, JSON.stringify(R));

/** A point `along` metres down a runway's axis and `across` to one side of it, at `up` over `elev`. */
function at(r, headingDeg, along, across, up, elev) {
  const h = (headingDeg * Math.PI) / 180;
  const ux = Math.sin(h);
  const uz = -Math.cos(h);
  return new THREE.Vector3(r.cx + ux * along - uz * across, elev + up, r.cz + uz * along + ux * across);
}

/** Every geometric promise one box makes, from both ends. */
function boxFaults(zone, r, headingDeg, elev) {
  const bad = [];
  const L = r.length / 2;
  const W = r.halfWidth;
  const inside = (p) => LZ.zoneContains(zone, p);
  for (const end of [1, -1]) {
    // From this end: just inside 60 m past it, and just outside.
    if (!inside(at(r, headingDeg, end * (L + R.endMargin - 1), 0, 1.5, elev))) bad.push(`${end > 0 ? 'far' : 'near'} end +59 m not inside`);
    if (inside(at(r, headingDeg, end * (L + R.endMargin + 1), 0, 1.5, elev))) bad.push(`${end > 0 ? 'far' : 'near'} end +61 m inside`);
    // The threshold itself, and the corner of the box beyond it.
    if (!inside(at(r, headingDeg, end * L, 0, 1.5, elev))) bad.push('threshold not inside');
    if (!inside(at(r, headingDeg, end * (L + R.endMargin - 1), W + R.sideMargin - 1, 1.5, elev))) bad.push('corner not inside');
    for (const side of [1, -1]) {
      if (!inside(at(r, headingDeg, end * L * 0.5, side * (W + R.sideMargin - 1), 1.5, elev))) bad.push(`shoulder ${side} -1 m not inside`);
      if (inside(at(r, headingDeg, end * L * 0.5, side * (W + R.sideMargin + 1), 1.5, elev))) bad.push(`shoulder ${side} +1 m inside`);
    }
  }
  // The slab: an A380's centre on its wheels is in it; a fly-past is not.
  if (!inside(at(r, headingDeg, 0, 0, 7.5, elev))) bad.push('7.5 m up (an A380 on its wheels) not inside');
  if (inside(at(r, headingDeg, 0, 0, R.above + 1, elev))) bad.push(`${R.above + 1} m up inside`);
  if (inside(at(r, headingDeg, 0, 0, -R.below - 1, elev))) bad.push(`${R.below + 1} m under inside`);
  return bad;
}

const mapFaults = [];
const agreeFaults = [];
let zonesSeen = 0;
let runwaysSeen = 0;
for (const map of M.MAPS) {
  T.applyMap(map);
  AP.refreshRunways();
  const a = T.AIRPORT;
  const zones = LZ.runwayZones();
  const want = (a.runway ? 1 : 0) + (a.runway2 ? 1 : 0) + (Array.isArray(a.runways) ? a.runways.length : 0);
  runwaysSeen += want;
  zonesSeen += zones.length;
  if (zones.length !== want) mapFaults.push(`${map.id}: ${zones.length} boxes for ${want} runways`);
  const z1 = zones.find((z) => z.id === 'runway');
  if (!z1) {
    mapFaults.push(`${map.id}: no box on the main runway`);
    continue;
  }
  for (const b of boxFaults(z1, a.runway, a.headingDeg ?? 90, a.elev)) mapFaults.push(`${map.id} ${z1.name}: ${b}`);
  // The points the missions aim at are all in the box.
  for (const [n, p] of [['touchdown', AP.RUNWAY.touchdown], ['west threshold', AP.RUNWAY.thresholdWest], ['east threshold', AP.RUNWAY.thresholdEast]]) {
    if (!LZ.zoneContains(z1, new THREE.Vector3(p.x, a.elev + 1.5, p.z))) mapFaults.push(`${map.id}: the ${n} is not in the box`);
  }
  if (a.runway2) {
    const z2 = zones.find((z) => z.id === 'runway2');
    if (!z2) mapFaults.push(`${map.id}: no box on the second runway`);
    else {
      for (const b of boxFaults(z2, a.runway2, a.runway2.headingDeg ?? 180, a.elev)) mapFaults.push(`${map.id} ${z2.name}: ${b}`);
      for (const [n, p] of [['north threshold', AP.RUNWAY2.thresholdNorth], ['south threshold', AP.RUNWAY2.thresholdSouth]]) {
        if (!LZ.zoneContains(z2, new THREE.Vector3(p.x, a.elev + 1.5, p.z))) mapFaults.push(`${map.id}: runway 2's ${n} is not in its box`);
      }
    }
  }
  // Anywhere terrain.js calls runway is in a box — and 25 m past the
  // shoulder, beside the middle of the main runway, is not (unless the
  // second runway is there).
  for (let i = 0; i < 400; i++) {
    const u = (i * 0.6180339887) % 1;
    const v = (i * 0.7548776662) % 1;
    const x = a.runway.cx + (u - 0.5) * (a.runway.length + 200);
    const z = a.runway.cz + (v - 0.5) * (a.runway.halfWidth * 2 + 160);
    const p = new THREE.Vector3(x, a.elev + 1.5, z);
    if (T.isOnAnyRunway(x, z, 0) && !LZ.inZone(p)) agreeFaults.push(`${map.id}: (${x.toFixed(0)}, ${z.toFixed(0)}) is runway but not boxed`);
    if (!T.isOnAnyRunway(x, z, R.sideMargin + 25) && Math.abs(x - a.runway.cx) < a.runway.length / 2 && LZ.inZone(p)) {
      agreeFaults.push(`${map.id}: (${x.toFixed(0)}, ${z.toFixed(0)}) is grass but boxed`);
    }
  }
}
ok(`every map has one box per runway (${M.MAPS.length} maps, ${runwaysSeen} runways)`, zonesSeen === runwaysSeen && !mapFaults.some((f) => /boxes for|no box/.test(f)),
  mapFaults.filter((f) => /boxes for|no box/.test(f)).slice(0, 3).join('; ') || `${zonesSeen} boxes`);
ok('every box is the runway + 60 m past both ends + 15 m of shoulder, a few metres tall, from either end',
  mapFaults.length === 0, mapFaults.slice(0, 4).join('; ') || 'all of them');
ok('every point terrain.js calls runway is boxed, and the grass 25 m past the shoulder is not', agreeFaults.length === 0, agreeFaults.slice(0, 3).join('; ') || '400 points a map');

{
  T.applyMap(M.getMap('kestrel'));
  AP.refreshRunways();
  const zones = LZ.runwayZones();
  ok("Kestrel's two: 09/27 and 18/36", zones.map((z) => z.name).join(',') === '09/27,18/36', zones.map((z) => z.name).join(','));
  ok('asking every frame is free: the same boxes come back until the map changes', LZ.runwayZones() === zones);
  T.applyMap(M.getMap('gateway'));
  AP.refreshRunways();
  const gw = LZ.runwayZones();
  ok('...and a new map is a new set', gw !== zones && gw[0].halfLength === 3800 / 2 + 60, `${gw[0] && gw[0].halfLength}`);
}

{
  // A future map: SF Bay with parallel runways, and a diagonal third — all from data.
  const future = {
    elev: 4,
    headingDeg: 90,
    runway: { cx: 100, cz: -50, length: 2000, halfWidth: 25 },
    runway2: { cx: 100, cz: 300, length: 1500, halfWidth: 20, headingDeg: 90 },
    runways: [{ id: '10L', cx: 2500, cz: 900, length: 1200, halfWidth: 22, headingDeg: 135 }],
  };
  const zs = LZ.runwayZones(future);
  const faults = [];
  if (zs.length !== 3) faults.push(`${zs.length} boxes`);
  else {
    faults.push(...boxFaults(zs[0], future.runway, 90, 4).map((f) => `main: ${f}`));
    faults.push(...boxFaults(zs[1], future.runway2, 90, 4).map((f) => `parallel: ${f}`));
    faults.push(...boxFaults(zs[2], future.runways[0], 135, 4).map((f) => `diagonal: ${f}`));
  }
  ok('a map from the future gets its boxes from its own data: parallel, diagonal, both ends', faults.length === 0,
    faults.slice(0, 3).join('; ') || zs.map((z) => `${z.id} ${z.name}`).join(', '));
  // 135 degrees is painted 14 (13.5 rounds up), its other end 32.
  ok('...named by its own numbers', zs[2] && zs[2].name === '14/32', zs[2] && zs[2].name);
}

/* ------------------------------------------------------------------ */
/* 2. the dwell                                                        */
/* ------------------------------------------------------------------ */

const DOWN = { intact: true, onGround: true, inside: true };
const AIR = { intact: true, onGround: false, inside: true };
const OUT = { intact: true, onGround: true, inside: false };
const BROKEN = { intact: false, onGround: true, inside: true };

/** Feed `secs` of state `s` at `dt` a frame; the last answer. */
function feed(d, s, secs, dt = 0.1) {
  let last = false;
  const n = Math.round(secs / dt);
  for (let i = 0; i < n; i++) last = d.update(dt, s);
  return last;
}

{
  const d = new LZ.LandingDwell({ hold: 3 });
  const at29 = feed(d, DOWN, 2.9);
  const held29 = d.held;
  const at31 = feed(d, DOWN, 0.2);
  ok('2.9 s down in the box does not count', at29 === false, `held ${held29.toFixed(2)}`);
  ok('3.1 s does', at31 === true, `held ${d.held.toFixed(2)}`);
  ok('...and says what is left on the way: "Hold it… 3"', new LZ.LandingDwell({ hold: 3 }).remaining === 3);
}
{
  const d = new LZ.LandingDwell({ hold: 3 });
  feed(d, DOWN, 1.5);
  feed(d, AIR, 0.2);
  const back = feed(d, DOWN, 1.4);
  ok('a bounce under 0.3 s is forgiven: 1.5 down, 0.2 up, 1.4 down counts', back === true, `held ${d.held.toFixed(2)}`);
}
{
  const d = new LZ.LandingDwell({ hold: 3 });
  feed(d, DOWN, 2.5);
  feed(d, AIR, 0.4);
  const after = feed(d, DOWN, 2.5);
  ok('a longer one is a take-off: 2.5 down, 0.4 up, 2.5 down does not count', after === false, `held ${d.held.toFixed(2)}`);
  ok('...and three seconds after the second touchdown it does', feed(d, DOWN, 0.6) === true);
}
{
  const d = new LZ.LandingDwell({ hold: 3 });
  feed(d, DOWN, 2.8);
  d.update(0.1, OUT);
  const after = feed(d, DOWN, 2.8);
  ok('leaving the box starts the clock again (2.8, out, 2.8: not yet)', after === false && d.held < 3, `held ${d.held.toFixed(2)}`);
}
{
  const d = new LZ.LandingDwell({ hold: 3 });
  ok('a crash never counts, however long', feed(d, BROKEN, 10) === false && d.held === 0);
  feed(d, DOWN, 2.8);
  d.update(0.1, BROKEN);
  ok('...and a crash at 2.8 s is not a landing at 3', feed(d, DOWN, 0.4) === false, `held ${d.held.toFixed(2)}`);
}
{
  const d = new LZ.LandingDwell({ hold: 3 });
  ok('flying over the box without touching starts nothing', feed(d, AIR, 5) === false && d.held === 0);
}
{
  const d = new LZ.LandingDwell({ hold: 3 });
  let t = 0;
  let last = false;
  for (let i = 0; i <= 31; i++) {
    last = d.sample(t, DOWN);
    // Asked twice in a frame (a step and a tick): no extra time.
    d.sample(t, DOWN);
    t += 0.1;
  }
  ok('from a clock: 3.1 s counts, and asking twice a frame adds nothing', last === true && Math.abs(d.held - 3.1) < 1e-6, `held ${d.held.toFixed(3)}`);
  const g = new LZ.LandingDwell({ hold: 3 });
  g.sample(0, DOWN);
  g.sample(2.5, DOWN);
  ok('a gap nobody watched (2.5 s between two looks) is not "continuously"', g.held === 0);
}

/* ------------------------------------------------------------------ */
/* 3. every landing step in the game                                   */
/* ------------------------------------------------------------------ */

const MIS = await imp('src/game/missions.js');
const TUT = await imp('src/game/tutorial.js');
const AFO = await imp('src/game/roles/afo-lead.js');
const CH1 = await imp('src/story/ch01-the-glint.js');
const HELI = await imp('src/game/missions-heli.js');
const SC = await imp('src/world/scenery.js');

const notified = [];
const SIM = { hud: { notify: (t) => notified.push(t) }, notify: NOOP, speak: NOOP };

/**
 * Drive `check` with an aeroplane at `pos` moving `vel` m/s along +`dir`, on
 * the ground, for up to `secs`. The first time it answers true, or null.
 */
function drive(check, { pos, dir = new THREE.Vector3(1, 0, 0), speed = 0, secs = 6, dt = 1 / 30, touchdown = { crashed: false, onRunway: true, score: 70 }, crashed = false, stepIndex = 4 }) {
  const ac = {
    pos: pos.clone(),
    vel: dir.clone().multiplyScalar(speed),
    onGround: true,
    crashed,
    groundSpeed: speed,
    groundTime: 0,
    airborneTime: 0,
    heading: 90,
    agl: 1.5,
    alt: pos.y,
    extraMass: 0,
    controls: { throttle: 0 },
    failures: {},
    bankAngleDeg: () => 0,
  };
  const data = { score: 0, lastTouchdown: touchdown };
  const runner = { stepIndex, stepElapsed: 0, elapsed: 100, complete: NOOP };
  for (let t = 0; t <= secs + 1e-9; t += dt) {
    runner.elapsed = 100 + t;
    runner.stepElapsed = t;
    const ctx = { sim: SIM, ac, data, elapsed: runner.elapsed, runner, subject: ac };
    if (check(ctx, dt)) return t;
    ac.pos.addScaledVector(dir, speed * dt);
    ac.groundTime += dt;
  }
  return null;
}

const STEPS = [];
const stepOf = (def, id) => (def && def.steps ? def.steps.find((s) => s.id === id) : null);
for (const [mid, sid] of [
  ['circuit', 'land'], ['delivery', 'land'], ['storm', 'land'], ['deadstick', 'touch'], ['emberrun', 'land'],
  ['medevac', 'land'], ['chaser', 'home'], ['patrol', 'rtb'], ['recon', 'home'], ['range', 'rtb'], ['tail', 'home'],
  ['afo-normal', 'land'], ['afo-attack', 'land'],
]) {
  const def = MIS.findMission(mid);
  STEPS.push({ name: `${mid}/${sid}`, def, step: stepOf(def, sid), map: (def && def.map) || 'kestrel' });
}
STEPS.push({ name: 'tutorial/land', def: TUT.TUTORIAL, step: stepOf(TUT.TUTORIAL, 'land'), map: 'kestrel' });
STEPS.push({ name: 'story ch1 land (step 3, "Land on the numbers and stop. Runway 09")', def: CH1.LAND, step: stepOf(CH1.LAND, 'land'), map: CH1.LAND.map });
for (const [label, roles] of [['afo-normal', AFO.AFO_NORMAL_ROLES], ['afo-attack', AFO.AFO_ATTACK_ROLES]]) {
  const esc = roles.find((r) => r.id === 'escort');
  STEPS.push({ name: `${label} lead fighter/land`, def: esc, step: stepOf(esc, 'land'), map: label === 'afo-normal' ? 'gateway' : 'airbase' });
}

const missing = STEPS.filter((s) => !s.step || typeof s.step.check !== 'function').map((s) => s.name);
ok(`all ${STEPS.length} runway landing steps are where the inventory says`, missing.length === 0, missing.join(', ') || STEPS.map((s) => s.name.split(' ')[0]).join(' '));

const lateFaults = [];
const grassFaults = [];
const crashFaults = [];
const story = [];
for (const s of STEPS) {
  if (!s.step) continue;
  T.applyMap(M.getMap(s.map));
  AP.refreshRunways();
  const rw = AP.RUNWAY;
  const y = T.AIRPORT.elev + 1.5;
  // Long and fast: 400 m past the aiming point at 35 m/s (68 kt), never braking.
  const long = new THREE.Vector3(rw.touchdown.x + 400, y, rw.cz);
  const t = drive(s.step.check, { pos: long, speed: 35 });
  if (t === null || t > 0.2) lateFaults.push(`${s.name} on ${s.map}: ${t === null ? 'never' : `${t.toFixed(2)} s`}`);
  if (/story/.test(s.name)) story.push(t);
  // Stopped on the grass beside the runway, 25 m past the shoulder, for a long time.
  const grass = new THREE.Vector3(rw.touchdown.x + 200, y, rw.cz - (rw.halfWidth + R.sideMargin + 25));
  if (!T.isOnAnyRunway(grass.x, grass.z, R.sideMargin + 20)) {
    const g = drive(s.step.check, { pos: grass, speed: 0, secs: 10, touchdown: { crashed: false, onRunway: false, score: 30 } });
    if (g !== null) grassFaults.push(`${s.name} on ${s.map}: counted at ${g.toFixed(1)} s`);
  }
  // Crashed on the runway: never.
  const c = drive(s.step.check, { pos: long, speed: 20, crashed: true, touchdown: { crashed: true } });
  if (c !== null) crashFaults.push(`${s.name}: counted a crash`);
}
ok('every runway landing completes the moment it touches down on its own map (no 3 s wait)', lateFaults.length === 0, lateFaults.slice(0, 4).join('; ') || `${STEPS.length} steps`);
ok('story ch1 step 3 completes the moment it touches down long and fast on Condor\'s runway 09', story.length === 1 && story[0] !== null && story[0] <= 0.2, String(story[0]));
ok('none of them counts an aeroplane stopped on the grass beside the runway', grassFaults.length === 0, grassFaults.slice(0, 3).join('; '));
ok('none of them counts a crash', crashFaults.length === 0, crashFaults.slice(0, 3).join('; '));
ok('the grass gets the "not on the runway" word once, not a silent wait', notified.filter((n) => /not on the runway/.test(n)).length >= 1, `${notified.length} notes`);

{
  // The pads. A helicopter sits on the hospital pad, sliding a little: three seconds.
  T.applyMap(M.getMap('kestrel'));
  AP.refreshRunways();
  const heliSteps = [['firstlight', 'down', 'harbour'], ['covepickup', 'land', 'cove'], ['covepickup', 'home', 'hospital'], ['overboard', 'home', 'hospital'], ['stackrescue', 'home', 'hospital'], ['nightdeck', 'home', 'hospital']];
  const faults = [];
  for (const [mid, sid, site] of heliSteps) {
    const def = MIS.findMission(mid);
    const step = stepOf(def, sid);
    if (!step) {
      faults.push(`${mid}/${sid} missing`);
      continue;
    }
    if (def.map) T.applyMap(M.getMap(def.map));
    const p = HELI.siteAt(null, site);
    const t = drive(step.check, { pos: new THREE.Vector3(p.x, p.y + 1, p.z), speed: 1.5, touchdown: null });
    if (t === null || t > 0.2) faults.push(`${mid}/${sid} at ${site}: ${t === null ? 'never' : t.toFixed(2)}`);
    const far = drive(step.check, { pos: new THREE.Vector3(p.x + 300, p.y + 1, p.z), speed: 0, touchdown: null });
    if (far !== null) faults.push(`${mid}/${sid}: counted 300 m off the pad`);
  }
  ok('the helicopter pads count on touchdown too (instant rule)', faults.length === 0, faults.slice(0, 3).join('; ') || `${heliSteps.length} pad steps`);
}
{
  const def = MIS.findMission('medevac');
  const step = stepOf(def, 'pickup');
  if (def.map) T.applyMap(M.getMap(def.map));
  const pad = SC.DELIVERY_PAD;
  const t = drive(step.check, { pos: new THREE.Vector3(pad.x - 60, pad.y + 1.5, pad.z), speed: 25 });
  ok("the medevac's strip on the cay: counts on touchdown, no stop", t !== null && t <= 0.2, String(t));
}
{
  // The mission's own data holds the clock: a new step starts a new one.
  T.applyMap(M.getMap('kestrel'));
  AP.refreshRunways();
  const ac = { pos: new THREE.Vector3(0, T.AIRPORT.elev + 1.5, 0), onGround: true, crashed: false };
  const data = { lastTouchdown: { crashed: false } };
  const runner = { stepIndex: 2 };
  let done = false;
  for (let t = 0; t <= 3.2; t += 0.1) done = LZ.landedOnRunway({ ac, data, elapsed: t, runner });
  runner.stepIndex = 3;
  const fresh = LZ.landedOnRunway({ ac, data, elapsed: 3.3, runner });
  ok('a landing step completes on touchdown (instant rule)', done === true);
  ok('no touchdown this mission, no landing (an aeroplane put on the runway has not landed)',
    (() => {
      const d2 = {};
      let any = false;
      for (let t = 0; t <= 5; t += 0.1) any = any || LZ.landedOnRunway({ ac, data: d2, elapsed: t, runner });
      return !any;
    })());
}

console.log(`\nlanding-zone: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
