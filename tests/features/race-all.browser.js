/**
 * Races for every ride, played ALONE in the real game — run by tests/selftest.js
 * through tests/features/index.js (CHECKS), or by hand in headless Chrome:
 *
 *   node .claude/devtools/cdp.mjs eval http://127.0.0.1:9190/index.html \
 *     "const r = { checks: [], ok(n, p, d) { this.checks.push({ n, p, d }); return p; } }; \
 *      const { check } = await import('/tests/features/race-all.browser.js'); return await check(sim, r);"
 *
 * The frame loop is frozen (cdp.mjs, the self-test) — this steps the game
 * itself, 15 times a second of game time.
 *
 *   1. Free flight in an aeroplane on Harrier Flats — the helicopter's island.
 *      The 🏁 button says "Races" (not "Race the hoops"); the Races card says
 *      "This is a helicopter race — switch to the Skyhook" and lists all four
 *      races, each with its vehicle and its island.
 *   2. Its button: the Skyhook on the helipads, 3-2-1-GO, a scripted pilot
 *      hovering through every hoop of its one lap, the results.
 *   3. The Races card's "Race it" for the car: Fenwick, the van on the grid on
 *      the road, a scripted driver following the streets (the road network's
 *      own route) through every gate, the results.
 *   4. The boat: Coral Lagoon, between every pair of buoys.
 *   5. The Ring Rally, as it was.
 *
 * Each race: on the grid in its own place, held there through the count,
 * "3 2 1 GO", every gate counted IN ORDER (the host's count equals the
 * pilot's), the gates on the minimap, a results card with the race's name, a
 * time and "Race again", and the best time kept for THAT race.
 *
 * The scripted racer moves the vehicle (teleports it a little each step, as
 * the part-2 playtests do). The loop is driven by hand, faster than real
 * time, so before the last gate the race clock is set to the game time the
 * pilot took — the host's "no faster than the course allows" is judged on
 * that honest number.
 */
import * as THREE from '../../src/vendor/three.module.js';
import * as race from '../../src/features/race.js';
import * as RR from '../../src/features/race/rules.js';
import * as shared from '../../src/features/mpplay/shared.js';
import * as T from '../../src/world/terrain.js';
import * as roadsMod from '../../src/world/roads.js';
import { multiplayer as mp, openMultiplayer } from '../../src/features/multiplayer.js';

export async function check(sim, r, say = () => {}) {
const out = { checks: [], numbers: {} };
const ok = (name, pass, detail = '') => {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  out.checks.push({ name, pass: !!pass, detail: d });
  if (r && typeof r.ok === 'function') r.ok(`races: ${name}`, pass, d.slice(0, 400));
  return pass;
};
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const DT = 1 / 15;
const text = (sel) => { const el = document.querySelector(sel); return el && !el.hidden ? el.textContent.replace(/\s+/g, ' ').trim() : null; };
const shown = (sel) => { const el = document.querySelector(sel); return !!(el && !el.hidden && el.getBoundingClientRect().width > 0); };
const errs = [];
window.addEventListener('error', (e) => errs.push(String(e.message)));
try { localStorage.removeItem('islandsim.race.best.v1'); for (const c of RR.COURSES) localStorage.removeItem(`islandsim.race.best.v1.${c.id}`); } catch (e) { /* none */ }

/** A few frames of the game, waiting real time too (the host's clock is real). */
async function frames(n, ms = 0) {
  for (let i = 0; i < n; i++) {
    sim.update(DT);
    if (ms) await sleep(ms);
  }
}
async function until(fn, maxMs = 15000, stepMs = 40) {
  const t0 = performance.now();
  for (;;) {
    let v = null;
    try { v = fn(); } catch (e) { v = null; }
    if (v) return v;
    if (performance.now() - t0 > maxMs) return null;
    sim.update(DT);
    await sleep(stepMs);
  }
}

/** What of the game's own screen a thing of ours sits on top of: visible HUD boxes it overlaps. */
function covered(sel) {
  const el = document.querySelector(sel);
  if (!el || el.hidden) return [];
  const a = el.getBoundingClientRect();
  if (!a.width) return [];
  const out = [];
  for (const e of document.querySelectorAll('#ui *')) {
    if (el.contains(e) || e.contains(el)) continue;
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height || r.width > innerWidth * 0.6 || r.height > innerHeight * 0.6) continue;
    const cs = getComputedStyle(e);
    if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue;
    const boxy = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || e.children.length === 0 && e.textContent.trim();
    if (!boxy) continue;
    const ix = Math.min(a.right, r.right) - Math.max(a.left, r.left);
    const iy = Math.min(a.bottom, r.bottom) - Math.max(a.top, r.top);
    if (ix > 2 && iy > 2) out.push(`${e.className || e.tagName}`.slice(0, 40));
  }
  return [...new Set(out)].slice(0, 6);
}

/*
 * The touch layout, for a moment, on this desktop: the classes main.js sets on
 * an iPad or a touchscreen Chromebook, where the instruments are a band across
 * the top. The independent check found the race line on top of that band (the
 * car's speed, the boat's lever, the Skyhook's hover box); race.js now puts it
 * in the objective's place below the band. Where it went, and what it covers.
 */
async function touchLayout() {
  const wrap = document.querySelector('#ui .hud');
  const root = document.documentElement;
  if (!wrap) return null;
  const had = [wrap.classList.contains('is-touch'), root.classList.contains('is-touch-device')];
  const G = race.raceDebug().G;
  try {
    wrap.classList.add('is-touch');
    root.classList.add('is-touch-device');
    G.barAt = 0;
    await frames(1, 10);
    G.barAt = 0;
    await frames(1, 300);
    const bar = document.querySelector('.race-hud');
    return { top: bar && !bar.hidden ? Math.round(bar.getBoundingClientRect().top) : null, covers: covered('.race-hud') };
  } finally {
    if (!had[0]) wrap.classList.remove('is-touch');
    if (!had[1]) root.classList.remove('is-touch-device');
    G.barAt = 0;
    await frames(1, 10);
  }
}

/** Put this player's ride at a place, facing a way (the scripted racer's hand). */
function put(p, hd, speed) {
  const v = sim.mode === 'drive' ? sim.vehicle : null;
  if (v) {
    const y = v.isBoat ? 0 : Math.max(0, T.heightAt(p.x, p.z)) + 0.4;
    v.reset({ pos: new THREE.Vector3(p.x, y, p.z), headingDeg: hd });
    v.pos.y = y;
    return;
  }
  const ac = sim.aircraft;
  ac.reset({ pos: new THREE.Vector3(p.x, 0, p.z), headingDeg: hd, speed, altAGL: 5, engineOn: true, gearDown: false });
  ac.pos.y = p.y;
}

/** The racer's path for a course: through every gate of every lap, and on over the line. */
function pathFor(course, frames, slot) {
  const g = RR.gridSlot(slot, course);
  const air = course.vehicle === 'plane' || course.vehicle === 'heli';
  const pts = [{ x: g.x, y: air ? frames[0].y : 0, z: g.z }];
  if (course.vehicle === 'car') {
    const roads = sim.roads && sim.roads.list;
    let prev = { x: g.x, z: g.z };
    for (let k = 0; k < RR.totalRings(course); k++) {
      const f = frames[k % frames.length];
      const r = roadsMod.routeOnRoads(roads, prev, { x: f.x, z: f.z }) || [prev, { x: f.x, z: f.z }];
      for (const q of r.slice(1)) pts.push({ x: q.x, y: 0, z: q.z });
      prev = { x: f.x, z: f.z };
    }
    const f = frames[frames.length - 1];
    pts.push({ x: f.x + f.nx * 40, y: 0, z: f.z + f.nz * 40 });
    return pts;
  }
  const lead = course.vehicle === 'plane' ? 60 : course.vehicle === 'heli' ? 25 : 30;
  for (let k = 0; k < RR.totalRings(course); k++) {
    const f = frames[k % frames.length];
    pts.push({ x: f.x - f.nx * lead, y: f.y, z: f.z - f.nz * lead });
    pts.push({ x: f.x + f.nx * lead, y: f.y, z: f.z + f.nz * lead });
  }
  const f = frames[frames.length - 1];
  pts.push({ x: f.x + f.nx * 300, y: f.y + (air ? 30 : 0), z: f.z + f.nz * 300 });
  return pts;
}

/** One race alone, start to results. `start` begins it (a button, the card, raceAlone). */
async function runRace(courseId, speed, start) {
  const course = RR.courseById(courseId);
  const R = { id: courseId };
  const t0 = performance.now();
  await start();
  const grid = await until(() => { const s = race.raceState(); return s && s.s === RR.S.grid && s.c === courseId ? s : null; }, 60000);
  await frames(3, 20);
  const D = race.raceDebug();
  const slot = D.L ? D.L.slot : -1;
  const gs = RR.gridSlot(Math.max(0, slot), course);
  const me = sim.mode === 'drive' ? sim.vehicle : sim.aircraft;
  R.map = sim.settings.map;
  R.mode = `${sim.mode}/${sim.game}`;
  R.loadMs = Math.round(performance.now() - t0);
  R.onGrid = me ? Math.round(Math.hypot(me.pos.x - gs.x, me.pos.z - gs.z) * 10) / 10 : null;
  R.hudGrid = text('.race-hud');
  R.ghost = shared.ghostReasons().includes('race');
  // Racing alone, the bar is only a way out: no "Race" and no "All races".
  R.soloHiddenOnGrid = shown('[data-race-leave]') && !shown('[data-race-solo]') && !shown('[data-race-hub]');
  // Held there through the count, whatever the throttle says.
  if (sim.mode === 'drive' && sim.vehicle) { sim.vehicle.throttle = 1; if (sim.driveInput) sim.driveInput.throttle = 1; }
  const cards = new Set();
  const go = await until(() => { const c = shared.bigCardText(); if (c) cards.add(c.slice(0, 2)); const s = race.raceState(); return s && s.s === RR.S.go ? s : null; }, 9000, 30);
  await frames(2, 10);
  R.countdown = race.raceDebug().stats.countdown.join('');
  R.heldAtGo = me ? Math.round(Math.hypot(me.pos.x - gs.x, me.pos.z - gs.z) * 10) / 10 : null;
  // The race line and the game's own instruments: on this screen, and in the touch layout.
  R.line = { top: Math.round(document.querySelector('.race-hud').getBoundingClientRect().top), covers: covered('.race-hud'), touch: await touchLayout() };
  // The pilot: along the path at `speed` m/s of game time.
  const fr = race.raceDebug().frames;
  const path = pathFor(course, fr, Math.max(0, slot));
  const total = RR.totalRings(course);
  let i = 0;
  let u = 0;
  let gameMs = 0;
  let shifted = false;
  let mm0 = race.raceDebug().stats.minimapDrawn || 0;
  const passedOrder = [];
  let lastK = 0;
  const realStart = performance.now();
  for (let n = 0; n < 40000 && i < path.length - 1; n++) {
    let move = speed * DT;
    while (move > 0 && i < path.length - 1) {
      const a = path[i];
      const b = path[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1e-6;
      const left = len * (1 - u);
      if (move < left) { u += move / len; move = 0; } else { move -= left; i++; u = 0; }
    }
    const a = path[Math.min(i, path.length - 1)];
    const b = path[Math.min(i + 1, path.length - 1)];
    const p = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u };
    const hd = (Math.atan2(b.x - a.x, -(b.z - a.z)) * 180 / Math.PI + 360) % 360;
    put(p, hd, Math.min(speed, 60));
    sim.update(DT);
    gameMs += DT * 1000;
    const L = race.raceDebug().L;
    if (L && L.k !== lastK) { passedOrder.push(RR.ringOf(L.k - 1, course)); lastK = L.k; }
    // One gate to go: the race clock to the game time the pilot took (the loop runs faster than real time).
    if (!shifted && L && L.k === total - 1) {
      const real = performance.now() - realStart;
      const d = race.raceDebug().G.solo;
      const shift = Math.max(0, gameMs - real);
      if (d) d.goAt -= shift;
      L.t0 -= shift;
      shifted = true;
    }
    if (L && L.fin) break;
    if (n % 200 === 0) await sleep(0);
  }
  R.gameS = Math.round(gameMs / 100) / 10;
  const L = race.raceDebug().L;
  R.k = L ? L.k : null;
  R.total = total;
  R.inOrder = passedOrder.every((g, j) => g === j % course.rings.length) && passedOrder.length === total;
  R.minimap = (race.raceDebug().stats.minimapDrawn || 0) - mm0;
  const done = await until(() => { const s = race.raceState(); return s && s.s === RR.S.done ? s : null; }, 6000, 30);
  await frames(2, 20);
  R.state = done ? { fin: done.fin, out: done.out, c: done.c } : race.raceState();
  R.refused = race.raceDebug().refused;
  R.results = text('.race-results');
  R.again = !!document.querySelector('.race-results [data-race-again]');
  try { R.best = Number(localStorage.getItem(courseId === 'ring-rally' ? 'islandsim.race.best.v1' : `islandsim.race.best.v1.${courseId}`)) || null; } catch (e) { R.best = null; }
  const closeBtn = document.querySelector('.race-results [data-race-close]');
  if (closeBtn) closeBtn.click();
  await frames(3, 10);
  R.soloAfter = text('.race-solobar');
  R.covers = covered('.race-solobar');
  const pass = done && R.onGrid !== null && R.onGrid < 4 && R.heldAtGo < 4 && R.countdown === '321GO' && R.k === total && R.inOrder
    && done.fin.length === 1 && done.fin[0][0] === 0 && R.results && R.results.includes(course.name) && /Round in \d+:\d\d\.\d/.test(R.results) && R.again
    && R.best === done.fin[0][1] && R.ghost && R.soloHiddenOnGrid && R.minimap > 10 && R.hudGrid && R.hudGrid.includes(course.name);
  ok(`${course.name} alone (${course.emoji} ${RR.VEHICLE_WORDS[course.vehicle].one} on ${course.island}): on the grid, 3-2-1-GO, every ${course.gateWord} of every lap in order, the results and a best time kept`,
    pass, R);
  out.numbers[courseId] = { gates: `${R.k}/${total}`, time: done && done.fin[0] ? RR.fmtTime(done.fin[0][1]) : null, onGrid: R.onGrid, map: R.map, loadMs: R.loadMs, minimapFrames: R.minimap, covers: R.covers, line: R.line };
  return R;
}

try {
  // ---- 1. An aeroplane on the helicopter's island --------------------------------------
  if (mp.role) mp.leave('left');
  mp.install(sim);
  mp.borrowMap('meadow');
  sim.game = 'flight';
  await sim.startMode('free', { ...(sim.freeOpts ? sim.freeOpts() : {}), aircraft: 'skylark', airborne: false, taxi: false });
  await frames(4, 10);
  const soloText = text('.race-solobar');
  // One quiet "🏁 Races" button opens the card (the yellow island-race button is gone: the owner asked).
  const main = document.querySelector('.race-solobar [data-race-hub]');
  main.click();
  await frames(1);
  const hubText = text('.race-hub');
  const rows = [...document.querySelectorAll('.race-hub [data-race-row]')].map((li) => li.textContent.replace(/\s+/g, ' ').trim());
  const hubRect = document.querySelector('.race-hub').getBoundingClientRect();
  ok('an aeroplane on Harrier Flats (the helicopter race’s island): the one 🏁 button says "Races" (nothing yellow, no island race started at a tap), and the Races card says "This is a helicopter race — switch to the Skyhook"',
    soloText && /Races/.test(soloText) && !/hoops/.test(soloText) && !document.querySelector('.race-solobar [data-race-solo]') && !document.querySelector('.race-solobar .race-solo-main')
    && hubText && hubText.includes('This is a helicopter race — switch to the Skyhook') && race.raceState() === null,
    { soloText, here: text('.race-hub [data-race-here]') });
  ok('the Races card lists all four, each saying which vehicle it is for and which island it is on — the aeroplane’s first',
    rows.length === 4 && /Ring Rally.*For aeroplanes · on Coral Atoll.*your ride/.test(rows[0]) && rows.some((t) => /Fenwick Grand Prix.*For the car · on Fenwick/.test(t))
    && rows.some((t) => /Lagoon Regatta.*For the boat · on Coral Lagoon/.test(t)) && rows.some((t) => /Skyhook Sprint.*For the helicopter · on Harrier Flats/.test(t)),
    rows.map((t) => t.slice(0, 80)));
  ok('the Races card fits the screen', hubRect.width > 200 && hubRect.left >= 0 && hubRect.right <= innerWidth && hubRect.top >= 0 && hubRect.bottom <= innerHeight, `${Math.round(hubRect.width)}x${Math.round(hubRect.height)} in ${innerWidth}x${innerHeight}`);

  // ---- 2. Its button: the Skyhook, the Sprint ------------------------------------------
  await runRace('heli', 32, async () => {
    document.querySelector('.race-hub [data-race-here] [data-race-go]').click();
    await until(() => sim.aircraftType && sim.aircraftType.id === 'harrier' && sim.state === 'flying', 30000);
  });
  ok('the Sprint was flown in the Skyhook, on Harrier Flats', sim.aircraftType && sim.aircraftType.id === 'harrier' && sim.settings.map === 'meadow', `${sim.aircraftType && sim.aircraftType.id} on ${sim.settings.map}`);
  const heliSolo = text('.race-solobar');
  // The island's race is offered on the card, not as a yellow button in the sky.
  document.querySelector('.race-solobar [data-race-hub]').click();
  await frames(1);
  const heliHere = text('.race-hub [data-race-here]');
  const heliClose = document.querySelector('.race-hub [data-race-hub-close]');
  if (heliClose) heliClose.click();
  await frames(1);
  ok('back in free play in the Skyhook on Harrier Flats: the 🏁 button says "Races", and the card offers "Race the hoops" at the top', heliSolo && /Races/.test(heliSolo) && !/hoops/.test(heliSolo) && heliHere && /Race the hoops/.test(heliHere), { heliSolo, heliHere });

  // ---- 3. The car, from the Races card ---------------------------------------------------
  document.querySelector('[data-race-hub]').click();
  await frames(1);
  const carRow = document.querySelector('.race-hub [data-race-row="car"] [data-race-go]');
  await runRace('car', 26, async () => {
    carRow.click();
    await until(() => sim.mode === 'drive' && sim.vehicle && sim.settings.map === 'town', 40000);
  });
  const v = sim.vehicle;
  const onTarmac = roadsMod.pavedAt(sim.roads && sim.roads.list, RR.gridSlot(0, RR.courseById('car')).x, RR.gridSlot(0, RR.courseById('car')).z);
  ok('the Grand Prix was driven in the car on Fenwick, from a grid place on the tarmac', sim.mode === 'drive' && v && v.spec.kind === 'car' && sim.settings.map === 'town' && onTarmac === 'tarmac', `${sim.mode} ${v && v.spec.kind} on ${sim.settings.map}; grid place is ${onTarmac}`);
  const carSolo = text('.race-solobar');
  document.querySelector('.race-solobar [data-race-hub]').click();
  await frames(1);
  const carHere = text('.race-hub [data-race-here]');
  const carClose = document.querySelector('.race-hub [data-race-hub-close]');
  if (carClose) carClose.click();
  await frames(1);
  ok('in the car on Fenwick the 🏁 button says "Races", and the card offers "Race the streets"', carSolo && /Races/.test(carSolo) && carHere && /Race the streets/.test(carHere), { carSolo, carHere });

  // ---- 4. The boat, from the Multiplayer screen's Races card ("Race alone") ---------------
  let lobbyCard = null;
  await runRace('boat', 13, async () => {
    openMultiplayer(sim);
    await until(() => document.querySelector('.mp-racecard [data-race-alone="boat"]'), 15000);
    const card = document.querySelector('.mp-racecard');
    lobbyCard = {
      head: card.previousElementSibling ? card.previousElementSibling.textContent.trim() : '',
      rows: [...card.querySelectorAll('[data-race-row]')].map((li) => li.dataset.raceRow),
      picks: [...card.querySelectorAll('[data-race-pick], [data-mp-race-pick]')].map((b) => b.textContent.trim()),
    };
    // "Your ride" follows the ride picked on the screen; the Ring Rally's pick with the car as the ride picks a plane too.
    document.querySelector('[data-mp-ride="car:car"]').click();
    await sleep(20);
    lobbyCard.mineWithCar = [...card.querySelectorAll('[data-race-row].is-mine')].map((li) => li.dataset.raceRow).join();
    card.querySelector('[data-mp-race-pick]').click();
    await sleep(20);
    lobbyCard.ringPick = { ride: mp.ride().game, pick: mp.lobbyScreen && mp.lobbyScreen.privatePick, status: text('[data-mp-status]') };
    card.querySelector('[data-race-alone="boat"]').click();
    await until(() => sim.mode === 'drive' && sim.vehicle && sim.vehicle.isBoat && sim.settings.map === 'lagoon', 40000);
    lobbyCard.screenGone = !document.querySelector('[data-screen="lobbies"]') || document.querySelector('[data-screen="lobbies"]').hidden;
  });
  ok('the Multiplayer screen’s card is the Races card: all four races, each with "Race alone" and "Pick <island> for a private match"',
    lobbyCard && /Races — one for every ride/.test(lobbyCard.head) && lobbyCard.rows.length === 4 && lobbyCard.picks.length === 4
    && ['Coral Atoll', 'Fenwick', 'Coral Lagoon', 'Harrier Flats'].every((isl) => lobbyCard.picks.some((t) => t.includes(isl))), lobbyCard);
  ok('on it, "your ride" follows the ride picked (the car → the Grand Prix), and the Ring Rally’s "Pick Coral Atoll" with the car as the ride picks an aeroplane and the atoll',
    lobbyCard && lobbyCard.mineWithCar === 'car' && lobbyCard.ringPick.ride === 'flight' && lobbyCard.ringPick.pick === 'atoll' && !/Pick a plane/.test(lobbyCard.ringPick.status || ''), lobbyCard && { mine: lobbyCard.mineWithCar, ...lobbyCard.ringPick });
  ok('its "Race alone" for the boat: the screen gone, the Regatta sailed in the boat on Coral Lagoon', lobbyCard && lobbyCard.screenGone && sim.mode === 'drive' && sim.vehicle && sim.vehicle.isBoat && sim.settings.map === 'lagoon', `${sim.mode} on ${sim.settings.map}`);

  // ---- 5. The Ring Rally, as it was --------------------------------------------------------
  await runRace('ring-rally', 150, async () => {
    await race.raceAlone(sim, 'ring-rally');
  });
  ok('the Ring Rally was flown in an aeroplane on Coral Atoll, as it always was', sim.mode === 'free' && sim.aircraftType && sim.aircraftType.id !== 'harrier' && sim.settings.map === 'atoll', `${sim.aircraftType && sim.aircraftType.id} on ${sim.settings.map}`);
  const covers = Object.fromEntries(Object.entries(out.numbers).map(([k, v]) => [k, v.covers]));
  ok('in free play in all four games the 🏁 buttons never sit on top of the game’s own HUD', Object.values(covers).every((c) => c && c.length === 0), covers);
  const lines = Object.fromEntries(Object.entries(out.numbers).map(([k, v]) => [k, v.line]));
  ok('in all four races the race line never sits on the game’s own instruments — on this screen, nor in the touch layout (iPads, touchscreen Chromebooks), where it goes below the band of instruments',
    Object.keys(lines).length === 4 && Object.values(lines).every((l) => l && l.covers.length === 0 && l.touch && l.touch.covers.length === 0 && l.touch.top > l.top), lines);
  const bests = RR.COURSES.map((c) => { try { return Number(localStorage.getItem(c.id === 'ring-rally' ? 'islandsim.race.best.v1' : `islandsim.race.best.v1.${c.id}`)) || 0; } catch (e) { return 0; } });
  ok('a best time kept for each race, on its own', bests.every((b) => b > 0) && new Set(bests).size === 4, bests.map((b) => RR.fmtTime(b)).join(' '));
} catch (e) {
  ok('the run finished', false, String(e && e.stack || e).slice(0, 600));
}
ok('no errors on the page', errs.length === 0, errs.slice(0, 3).join(' | '));
out.passed = out.checks.filter((c) => c.pass).length;
out.total = out.checks.length;
say(`races: ${out.passed}/${out.total}`);
return out;
}
