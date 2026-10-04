/**
 * RACES — one for every ride. The Ring Rally ("add custom multiplayer map for
 * racing", list 2) and, since the owner said "racing world has: racing for
 * cars, planes, boats etc", three more on the same machinery:
 *
 *   🛩️ RING RALLY          aeroplanes (and the helicopter) · Coral Atoll
 *   🚗 FENWICK GRAND PRIX  the car · Fenwick — the town's own streets
 *   ⛵ LAGOON REGATTA      the boat · Coral Lagoon — between buoys
 *   🚁 SKYHOOK SPRINT      the helicopter · Harrier Flats — low hoops
 *
 * The courses and the rules are ./race/rules.js and ./race/courses.js; how
 * they are drawn is ./race/draw.js; the Races card is ./race/hub.js. This is
 * the race as a kid plays it.
 *
 * WHERE. Each race is on its own island, and is there whenever you are on
 * that island — the gates to drive (sail, fly) through for fun; a RACE
 * lights them up.
 *
 * HOW TO RACE.
 *   - With friends: in any lobby or private match on a race's island, anybody
 *     in that race's vehicle taps "🏁 Race" on the badge. Everybody in that
 *     vehicle is put on the grid, the lights count 3-2-1-GO, the next gate
 *     glows yellow, an arrow at the top of the screen points at it, and a
 *     line says the lap, the gate, the time and your place. The results card
 *     shows everybody's place and time, and "Race again". Somebody in the
 *     wrong vehicle is told so ("This is a car race — switch to the car").
 *   - Alone: from free play in any of the four games — the 🏁 button — or
 *     the Multiplayer screen's Races card ("Race alone"). The same race
 *     against the clock, and the best time for each race is kept on this
 *     device.
 *
 * Racers are ghosts to everybody for the race — no bumping on the grid, no
 * PvP pellets in the back — and the host (./race/rules.js) keeps the order.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension, extLayer } from '../game/extensions.js';
import { heightAt } from '../world/terrain.js';
import * as RR from './race/rules.js';
import { buildCourse, paintCourse, drawGates } from './race/draw.js';
import { HUB_CSS, buildHub, mountLobbyCard } from './race/hub.js';
import { onFoot } from './onfoot.js';
import { mp, ch, ride, forwardOf, inGame, who, esc, blip, toon, chip, bigCard, feed, ghost, injectStyle } from './mpplay/shared.js';

ch.define('race:ask', { validate: RR.cleanAsk, rate: 0.5 });
ch.define('race:gate', { validate: RR.cleanGate, rate: 6 });
ch.define('race:done', { validate: RR.cleanDone, rate: 1 });
ch.define('race:quit', { validate: RR.cleanQuit, rate: 1 });
ch.define('race', { from: 'host', validate: RR.cleanState });

/** The Ring Rally's best time keeps the key it always had; the others get their own. */
const bestKey = (course) => (course.id === RR.COURSE.id ? 'islandsim.race.best.v1' : `islandsim.race.best.v1.${course.id}`);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const G = {
  sim: null,
  host: null,
  solo: null,
  timer: null,
  lastPub: -Infinity,
  view: null,
  frames: null,
  L: null,
  goArrived: null,
  shown: -1,
  els: null,
  hub: null,
  lobby: null,
  parked: null,
  stats: { rings: 0, finishes: 0, asked: 0, resultsShown: 0, countdown: [], told: [], hubOpened: 0 },
};

/** The race on the island this game is on, or null. */
function islandCourse(sim = G.sim) {
  return RR.courseForMap(sim && sim.settings && sim.settings.map);
}
/** This player's ride as a game id: 'flight' 'heli' 'car' 'boat' — or null (nothing to drive). */
function myGame(sim = G.sim) {
  const r = ride(sim);
  if (!r) return null;
  if (r.kind === 'air') return r.heli ? 'heli' : 'flight';
  if (r.kind === 'car' && sim.vehicle && sim.modeOpts && sim.modeOpts.kind && sim.modeOpts.kind !== 'car') return null; // a tug is not the car
  return r.kind;
}
/** The course a race state is for (the Ring Rally if it does not say). */
function courseOf(st) {
  return RR.courseById(st && st.c);
}
/** Is this race's course the one built in this world (the island this game is on)? */
function builtFor(course) {
  return !!(G.view && G.view.course === course && G.frames);
}

/* ---- the state, wherever it lives -------------------------------------------------------- */

function state() {
  if (inGame()) return RR.cleanState(ch.getState('race'));
  return G.solo ? G.solo.state : null;
}
function myId() {
  return inGame() ? mp.meId : 0;
}
export function raceState() {
  return state();
}

function publish(force = false) {
  if (G.solo && !inGame()) return;
  const h = G.host;
  if (!h || !ch.isHost) return;
  const t = now();
  if (!h.dirty && !force) return;
  if (!force && t - G.lastPub < 150) return;
  h.dirty = false;
  G.lastPub = t;
  ch.setState('race', h.state);
}

/** Everybody who can race this course, in the order they joined: the right vehicle for it. */
function racers(course) {
  return ch.players().filter((p) => (p.ride ? RR.rideFits(course, p.ride.game) : p.me && RR.rideFits(course, myGame(G.sim))))
    .sort((a, b) => a.id - b.id).map((p) => p.id);
}

ch.onState('race', (v) => {
  if (v && v.s === RR.S.go && (!G.goArrived || G.goArrived.n !== v.n)) G.goArrived = { n: v.n, at: now() };
});

ch.on('race:ask', (d, from, meta) => {
  if (!ch.isHost || !meta || !meta.toHost || !G.host) return;
  const course = islandCourse(G.sim);
  if (!course) return;
  const r = G.host.ask(racers(course), now(), course.id);
  if (r.ok) publish(true);
});
ch.on('race:gate', (d, from, meta) => {
  if (!ch.isHost || !meta || !meta.toHost || !G.host) return;
  if (G.host.gate(from.id, d.n, d.k, now()).ok) publish(false);
});
ch.on('race:done', (d, from, meta) => {
  if (!ch.isHost || !meta || !meta.toHost || !G.host) return;
  if (G.host.done(from.id, d.n, d.ms, now()).ok) publish(true);
});
ch.on('race:quit', (d, from, meta) => {
  if (!ch.isHost || !meta || !meta.toHost || !G.host) return;
  const st = G.host.state;
  if (d.n === st.n && G.host.quit(from.id, now()).ok) publish(true);
});
ch.on('mp:start', ({ role }) => {
  G.solo = null;
  G.L = null;
  // Every game counts its races from 1: the last game's race 1 is not this one's.
  G.shown = -1;
  G.goArrived = null;
  G.host = role === 'host' ? new RR.RaceHost({ now, course: islandCourse(G.sim) || RR.COURSE }) : null;
  startTimer();
});
ch.on('mp:host', () => {
  G.host = new RR.RaceHost({ now, course: islandCourse(G.sim) || RR.COURSE });
  G.host.load(ch.getState('race'), now());
  publish(true);
});
ch.on('mp:leave', (p) => {
  if (ch.isHost && G.host && G.host.quit(p.id, now()).ok) publish(true);
});
ch.on('mp:end', () => {
  G.toldHere = null;
  G.host = null;
  G.L = null;
  G.shown = -1;
  G.goArrived = null;
  if (G.els) G.els.res.hidden = true;
  stopTimer();
  ghost('race', false);
  hideResults();
});

/*
 * The results card goes with the game it was about. It stayed up after leaving: over the Multiplayer
 * screen, and then over the next game — the playtest's boat, in Lobby 3, still had the Ring Rally's
 * results in the middle of its screen.
 */
function hideResults() {
  const e = G.els;
  if (e && e.res && !e.res.hidden) e.res.hidden = true;
}

function startTimer() {
  stopTimer();
  G.timer = setInterval(() => {
    try {
      const h = inGame() ? (ch.isHost ? G.host : null) : G.solo;
      if (!h) return;
      h.tick(now());
      if (inGame()) publish(false);
    } catch (e) {
      /* next tick */
    }
  }, 100);
}
function stopTimer() {
  clearInterval(G.timer);
  G.timer = null;
}

/** Ask for a race here: the host decides (or, alone, this tab). */
export function askRace() {
  G.stats.asked++;
  const course = islandCourse(G.sim);
  if (inGame()) {
    if (!course) {
      bigCard('RACES', 'There’s no race on this island — the Races card on the Multiplayer screen says where they are', 2.6);
      return false;
    }
    if (!RR.rideFits(course, myGame(G.sim))) {
      tellWrongRide(course);
      return false;
    }
    return ch.toHost('race:ask', {});
  }
  return startSolo();
}

/** "This is a car race — switch to the car". */
function tellWrongRide(course) {
  const line = RR.switchLine(course);
  G.stats.told.push(line);
  bigCard(course.name.toUpperCase(), line, 2.8);
}

/** Alone: this tab is the host of a race of one. */
function startSolo() {
  const sim = G.sim;
  const course = islandCourse(sim);
  if (!sim || !course || !RR.rideFits(course, myGame(sim))) return false;
  G.solo = new RR.RaceHost({ now, course });
  G.solo.ask([0], now(), course.id);
  G.L = null;
  G.shown = -1;
  if (!G.timer) startTimer();
  return true;
}

/**
 * Race alone: to the race's island in the race's vehicle (free play there),
 * then the race. `courseId` omitted is the Ring Rally, which is what "Race
 * alone" always meant — in the aeroplane you fly, or the helicopter.
 */
export async function raceAlone(sim, courseId = RR.COURSE.id) {
  G.sim = sim;
  const course = RR.courseById(courseId);
  if (inGame()) return askRace();
  const game = myGame(sim);
  const o = sim.modeOpts || {};
  const free = sim.state === 'flying' && (sim.mode === 'free' || (sim.mode === 'drive' && !o.job && !o.mission));
  if (islandCourse(sim) === course && RR.rideFits(course, game) && free) return startSolo();
  if (course.vehicle === 'car' || course.vehicle === 'boat') {
    const kind = course.vehicle;
    const had = sim.gameMap ? { has: kind in sim.gameMap, map: sim.gameMap[kind] } : null;
    // The race's island, borrowed the way a mission borrows one (main.js puts yours back
    // at the menu); the island remembered for the car's (the boat's) own menu is left as it was.
    if (sim.gameMap) sim.gameMap[kind] = course.map;
    try {
      sim.startDrive(kind);
    } finally {
      if (had) {
        if (had.has) sim.gameMap[kind] = had.map;
        else delete sim.gameMap[kind];
      }
    }
  } else {
    let aircraft = 'harrier';
    if (course.vehicle === 'plane') {
      aircraft = 'skylark';
      try {
        const r = mp.ride ? mp.ride() : null;
        if (game === 'heli' || (r && r.game === 'heli' && sim.state !== 'flying')) aircraft = 'harrier';
        else if (game === 'flight' && sim.aircraftType) aircraft = sim.aircraftType.id;
        else if (r && r.game === 'flight') aircraft = r.type;
        else if (mp.myAircraft) aircraft = mp.myAircraft();
      } catch (e) {
        aircraft = 'skylark';
      }
    }
    if (mp.borrowMap) {
      mp.install(sim);
      mp.borrowMap(course.map);
    }
    sim.game = aircraft === 'harrier' ? 'heli' : 'flight';
    if (sim.menus && sim.menus.setGame) sim.menus.setGame(sim.game);
    let base = {};
    try {
      base = typeof sim.freeOpts === 'function' ? sim.freeOpts() : {};
    } catch (e) {
      base = {};
    }
    await sim.startMode('free', { ...base, aircraft, airborne: false, taxi: false });
  }
  return startSolo();
}

function quitRace() {
  const st = state();
  if (!st) return;
  if (inGame()) ch.toHost('race:quit', { n: st.n });
  else if (G.solo) {
    G.solo.quit(0, now());
  }
  release();
}

/* ---- racing: this player's side --------------------------------------------------------- */

/** On the grid: the aeroplane on the runway, the car on the road, the boat on the water. */
function place(sim, slot, course) {
  const me = ride(sim);
  if (!me) return;
  const s = RR.gridSlot(slot, course);
  if (me.kind === 'air') {
    me.obj.reset({ pos: new THREE.Vector3(s.x, 0, s.z), headingDeg: s.heading, speed: 0, altAGL: null, engineOn: true });
    if (typeof mp.snapCamera === 'function') mp.snapCamera(sim);
    return;
  }
  me.obj.reset({ pos: new THREE.Vector3(s.x, me.kind === 'boat' ? 0 : Math.max(0, heightAt(s.x, s.z)), s.z), headingDeg: s.heading });
  if (me.kind === 'boat') sim._boatCamSnap = true;
  else if (sim.driveCam && typeof sim.driveCam.snap === 'function') sim.driveCam.snap(sim.camera, me.obj);
}

/** Held on the grid until GO: nobody rolls (or motors) off early. */
function hold(sim, slot, course) {
  const me = ride(sim);
  if (!me) return;
  const s = RR.gridSlot(slot, course);
  me.obj.pos.x = s.x;
  me.obj.pos.z = s.z;
  if (me.kind === 'air') {
    me.obj.vel.set(0, me.obj.vel.y < 0 ? me.obj.vel.y : 0, 0);
    return;
  }
  me.obj.speed = 0;
  me.obj.vel.set(0, me.obj.vel.y < 0 ? me.obj.vel.y : 0, 0);
  me.obj.heading = s.heading;
}

function release() {
  ghost('race', false);
  if (G.L) G.L.out = true;
  quiet(G.sim, false);
}

/**
 * While this player races, the race is the only thing telling them where to
 * go: the game's own objective box (top middle, where the race line is) and
 * the boat's arrow to the patrol's harbour mouth are hidden, the van's free
 * drive "places to find" (its turn arrow and its objective) is parked, and
 * no lifeboat shout comes in mid-race. All of it back the moment the race is
 * over for them.
 */
function quiet(sim, on) {
  if (typeof document !== 'undefined') {
    const ui = document.getElementById('ui');
    if (ui && ui.classList.contains('race-on') !== on) ui.classList.toggle('race-on', on);
  }
  if (!sim) return;
  if (on) {
    if (sim.islandRoads && sim.mode === 'drive') {
      G.parked = { roads: sim.islandRoads, vehicle: sim.vehicle };
      sim.islandRoads = null;
    }
    const r = sim.runner;
    if (r && r.def && r.def.id === 'boat-patrol' && r.data && !r.data.shout && !(r.data.nextShout > 90)) r.data.nextShout = 120;
  } else if (G.parked) {
    // Only back into the same drive it was taken from (a new drive makes its own).
    if (sim.mode === 'drive' && sim.vehicle === G.parked.vehicle && !sim.islandRoads) sim.islandRoads = G.parked.roads;
    G.parked = null;
  }
}

function step(sim) {
  const st = state();
  const me = ride(sim);
  const id = myId();
  if (!st || st.s === RR.S.idle) {
    ghost('race', false);
    quiet(sim, false);
    paintCourse(G.view, 0, false);
    hud(null);
    return;
  }
  const course = courseOf(st);
  if (!G.L || G.L.n !== st.n) {
    G.stats.countdown = [];
    // A new race: the last one's results card goes.
    if (G.els && !G.els.res.hidden && st.s !== RR.S.done) G.els.res.hidden = true;
    G.L = { n: st.n, c: course.id, slot: st.ent.indexOf(id), k: 0, t0: 0, fin: false, out: false, placed: false, cd: -1, prev: null, goAt: 0, gridAt: now() };
  }
  const L = G.L;
  // The others' race forming on this island, and this player in the wrong vehicle for it: told why they are not on the grid.
  if (L.slot < 0 && !L.toldWhy && st.s === RR.S.grid && inGame() && builtFor(course) && myGame(sim) && !RR.rideFits(course, myGame(sim))) {
    L.toldWhy = true;
    tellWrongRide(course);
  }
  // A racer is somebody on the grid, still in, in the race's vehicle, on its island.
  const here = builtFor(course) && RR.rideFits(course, myGame(sim));
  const racing = L.slot >= 0 && !L.out && !st.out.includes(id) && here;
  quiet(sim, racing && (st.s === RR.S.grid || (st.s === RR.S.go && !L.fin)));
  if (st.s === RR.S.grid && racing) {
    ghost('race', true);
    if (!L.placed) {
      L.placed = true;
      place(sim, L.slot, course);
      bigCard(course.name.toUpperCase(), `${RR.lapsWord(course)}, ${course.rings.length} ${gatesWord(course, course.rings.length)} — through the yellow one next`, 2);
    }
    hold(sim, L.slot, course);
    // 3, 2, 1 on this game's clock from when the grid formed; GO when the host says.
    const left = Math.ceil((RR.GRID_MS - (now() - L.gridAt)) / 1000);
    if (left <= 3 && left >= 1 && left !== L.cd) {
      L.cd = left;
      G.stats.countdown.push(String(left));
      bigCard(String(left), course.vehicle === 'plane' || course.vehicle === 'heli' ? 'Engines running — full power on GO!' : course.vehicle === 'boat' ? 'Hands on the throttle — full ahead on GO!' : 'Foot on the brake — go on GO!', 0.9);
      blip(sim, 'beep');
    }
    paintCourse(G.view, 0, true);
    hud({ st, L, me, id, course, grid: true });
    return;
  }
  if (st.s === RR.S.go && racing && !L.fin) {
    ghost('race', true);
    if (!L.t0) {
      // The race clock starts when the GO arrived, not when this game next drew a frame:
      // a game that hitched at the start would otherwise have a time the host's clock disagrees with.
      const arrived = G.goArrived && G.goArrived.n === st.n ? G.goArrived.at : 0;
      L.t0 = !inGame() && G.solo && G.solo.goAt ? G.solo.goAt : arrived && now() - arrived < 10000 ? arrived : now();
      G.stats.countdown.push('GO');
      const first = course.vehicle === 'plane' ? 'Take off and fly through ring 1' : course.vehicle === 'heli' ? 'Lift off and hover through hoop 1' : course.vehicle === 'boat' ? 'Full ahead — between buoys 1' : 'Go! Through gate 1';
      bigCard('GO!', first, 1.2);
      blip(sim, 'go');
      if (me) toon.word('GO!', me.pos, sim.camera, 1.4);
    }
    if (me && G.frames) {
      if (!L.prev) L.prev = me.pos.clone();
      const f = G.frames[RR.ringOf(L.k, course)];
      if (RR.throughGate(L.prev.x, L.prev.y, L.prev.z, me.pos.x, me.pos.y, me.pos.z, f)) {
        L.k++;
        G.stats.rings++;
        blip(sim, 'gate');
        toon.puff(f, '#ffd23f', { n: 6, size: 4, spread: 10, life: 0.8, up: 0 });
        if (inGame()) ch.toHost('race:gate', { n: st.n, k: L.k });
        else if (G.solo) G.solo.gate(0, st.n, L.k, now());
        if (L.k >= RR.totalRings(course)) finish(sim, st);
        else if (L.k % course.rings.length === 0) bigCard(`LAP ${RR.lapOf(L.k, course)}`, 'Last lap — go go go!', 1.4);
      }
      L.prev.copy(me.pos);
    }
    paintCourse(G.view, L.k, true);
    hud({ st, L, me, id, course });
    return;
  }
  // Watching, finished, or the results. A racer who has finished stays a ghost until
  // the race is over: nobody still racing is bumped (or tagged) by somebody done.
  ghost('race', st.s === RR.S.go && L.slot >= 0 && L.fin);
  paintCourse(G.view, 0, false);
  hud(st.s === RR.S.go ? { st, L, me, id, course, watching: true } : null);
  if (st.s === RR.S.done && G.shown !== st.n) {
    G.shown = st.n;
    showResults(st);
  }
}

function gatesWord(course, n) {
  const one = course.style === 'buoys' ? 'pair of buoys' : course.style === 'road' ? 'gate' : course.style === 'hoops' ? 'hoop' : 'ring';
  if (n === 1) return one;
  return course.style === 'buoys' ? 'pairs of buoys' : `${one}s`;
}

function finish(sim, st) {
  const L = G.L;
  L.fin = true;
  const ms = now() - L.t0;
  G.stats.finishes++;
  ghost('race', false);
  if (inGame()) ch.toHost('race:done', { n: st.n, ms });
  else if (G.solo && !G.solo.done(0, st.n, ms, now()).ok) G.solo.quit(0, now());
  bigCard('FINISHED!', RR.fmtTime(ms), 2.4);
  blip(sim, 'go');
}

/** A time the host took (it is in the results) and faster than any before on this device: kept, per race. */
function keepBest(st, course) {
  const f = st.fin.find((x) => x[0] === myId());
  if (!f) return { best: readBest(course), record: false };
  const best = readBest(course);
  const record = !best || f[1] < best;
  if (record) {
    try {
      localStorage.setItem(bestKey(course), String(Math.round(f[1])));
    } catch (e) {
      /* remembered for this race only */
    }
  }
  return { best: record ? f[1] : best, record };
}

function readBest(course) {
  try {
    return Number(localStorage.getItem(bestKey(course))) || null;
  } catch (e) {
    return null;
  }
}

/* ---- on the screen ------------------------------------------------------------------------ */

const UI_CSS = `
.race-hud { position: fixed; left: 50%; top: 54px; transform: translateX(-50%); z-index: 30; pointer-events: none; display: flex; align-items: center; gap: 10px;
  padding: 6px 14px 6px 8px; border-radius: 999px; background: rgba(10, 17, 30, 0.8); color: #fff; font: 700 14px var(--font), sans-serif; white-space: nowrap; }
.race-hud[hidden], .race-results[hidden], .race-solo[hidden] { display: none !important; }
.race-hud .race-arrow { width: 30px; height: 30px; border-radius: 50%; background: #ffd23f; display: grid; place-items: center; color: #1b1030; font-size: 18px; line-height: 1; }
.race-hud .race-arrow b { display: block; transition: transform 0.08s linear; }
.race-hud em { font-style: normal; color: #ffd23f; }
.race-hud small { font-weight: 600; color: rgba(220, 232, 246, 0.85); }
.race-results { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 33; pointer-events: auto; width: min(420px, 92vw);
  padding: 16px 18px; border-radius: 16px; background: rgba(10, 17, 30, 0.94); border: 1px solid var(--panel-line); box-shadow: var(--shadow); color: #fff; font-family: var(--font), sans-serif; }
.race-results h3 { margin: 0 0 4px; font-size: 20px; }
.race-results p { margin: 0 0 10px; font-size: 13px; color: var(--text-dim); }
.race-results ol { list-style: none; margin: 0 0 14px; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.race-results li { display: grid; grid-template-columns: 34px 12px minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 6px 8px; border-radius: 10px; background: rgba(255,255,255,0.05); font-size: 14px; }
.race-results li.is-me { background: rgba(88, 198, 255, 0.16); }
.race-results li span { font-size: 18px; text-align: center; }
.race-results li i { width: 11px; height: 11px; border-radius: 50%; display: block; }
.race-results li b { font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.race-results li em { font-style: normal; font-variant-numeric: tabular-nums; color: var(--text-dim); }
.race-results .race-btns { display: flex; gap: 8px; justify-content: flex-end; }
.race-results button { font: 650 14px var(--font), sans-serif; padding: 8px 14px; border-radius: 10px; cursor: pointer; border: 1px solid var(--panel-line); background: rgba(255,255,255,0.08); color: #fff; }
.race-results button.primary { background: var(--accent); color: #0b1220; border-color: var(--accent); }
html.is-touch-device .race-hud { transition: top 0.25s ease; }
@media (max-width: 520px) { .race-hud { font-size: 12.5px; gap: 7px; padding: 5px 11px 5px 6px; max-width: calc(100vw - 32px); } }
#ui.race-on .hud-objective, #ui.race-on .hud-boatarrow { display: none !important; }
`;

function els() {
  if (G.els || typeof document === 'undefined') return G.els;
  injectStyle();
  if (!document.getElementById('ifs-race-style')) {
    const st = document.createElement('style');
    st.id = 'ifs-race-style';
    st.textContent = UI_CSS + HUB_CSS;
    document.head.appendChild(st);
  }
  const layer = extLayer();
  const bar = document.createElement('div');
  bar.className = 'race-hud';
  bar.hidden = true;
  bar.innerHTML = '<span class="race-arrow"><b>↑</b></span><span data-race-line></span>';
  const res = document.createElement('div');
  res.className = 'race-results';
  res.hidden = true;
  res.setAttribute('role', 'dialog');
  res.setAttribute('aria-label', 'Race results');
  res.addEventListener('click', (e) => {
    if (e.target.closest('[data-race-again]')) {
      res.hidden = true;
      askRace();
    } else if (e.target.closest('[data-race-close]')) res.hidden = true;
  });
  /*
   * Free play, alone: ONE quiet button, "🏁 Races", which opens the Races
   * card — where the race on this island (if there is one, for what you are
   * in) has its own "Race it" at the top, and every other race is listed.
   *
   * There were two buttons here, and the first was a big yellow one that
   * said the island's race ("Race the hoops") and started it at a tap. The
   * owner, looking at the flight screen: "remove this yellow thing please".
   * Fair: it sat in the sky, top right under the wind, the one saturated
   * block of colour on an otherwise calm picture, in every free flight on
   * every island whether or not there was a race there. The card does the
   * same job one tap further in, in the game's own colours.
   */
  const solo = document.createElement('div');
  solo.className = 'race-solobar';
  solo.hidden = true;
  solo.innerHTML = '<button type="button" class="race-solo-all" data-race-hub>🏁 Races</button>'
    + '<button type="button" class="race-solo-leave" data-race-leave hidden>✕ Leave race</button>';
  solo.addEventListener('click', (e) => {
    if (e.target.closest('[data-race-leave]')) {
      quitRace();
      G.stats.left = (G.stats.left || 0) + 1;
    } else if (e.target.closest('[data-race-hub]')) openHub();
  });
  layer.append(bar, res, solo);
  G.hub = buildHub(layer, hubApi());
  G.els = { bar, line: bar.querySelector('[data-race-line]'), arrow: bar.querySelector('.race-arrow b'), res, solo, soloAll: solo.querySelector('[data-race-hub]'), soloLeave: solo.querySelector('[data-race-leave]') };
  return G.els;
}

/** What the Races card asks of the game. */
function hubApi() {
  return {
    here: () => (G.sim && G.sim.state === 'flying' ? islandCourse(G.sim) : null),
    game: () => {
      const g = G.sim && G.sim.state === 'flying' ? myGame(G.sim) : null;
      if (g) return g;
      try {
        return mp.ride ? mp.ride().game : 'flight';
      } catch (e) {
        return 'flight';
      }
    },
    islandName: () => {
      const id = G.sim && G.sim.settings && G.sim.settings.map;
      try {
        return (mp.mapName && mp.mapName(id)) || 'this island';
      } catch (e) {
        return 'this island';
      }
    },
    best: (course) => readBest(course),
    go: (courseId) => goRace(courseId),
    status: (text, kind) => {
      if (mp.lobbyScreen && typeof mp.lobbyScreen.status === 'function') mp.lobbyScreen.status(text, kind);
    },
  };
}

/** A race from the Races card: here and now if it can be, else off to its island in its vehicle. */
function goRace(courseId) {
  const sim = G.sim;
  if (!sim) return false;
  const course = RR.courseById(courseId);
  if (inGame()) {
    if (islandCourse(sim) === course) return askRace();
    bigCard(course.name.toUpperCase(), `It’s on ${course.island} — make a private match there to race with friends`, 2.6);
    return false;
  }
  return raceAlone(sim, course.id);
}

export function openHub() {
  const e = els();
  if (!e || !G.hub) return false;
  G.stats.hubOpened++;
  G.hub.open();
  return true;
}

/** Where everybody is in the race: gates passed, finishers first. */
function placeOf(st, id) {
  const fin = st.fin.findIndex((f) => f[0] === id);
  if (fin >= 0) return fin + 1;
  const i = st.ent.indexOf(id);
  if (i < 0) return null;
  const k = st.k[i];
  let ahead = st.fin.length;
  st.ent.forEach((o, j) => {
    if (o !== id && !st.fin.some((f) => f[0] === o) && !st.out.includes(o) && st.k[j] > k) ahead++;
  });
  return ahead + 1;
}

function hud(o) {
  const e = els();
  if (!e) return;
  const sim = G.sim;
  const show = !!o && !(sim && sim.hud && sim.hud.hidden);
  if (e.bar.hidden === show) e.bar.hidden = !show;
  if (!show) {
    G.barAt = 0;
    return;
  }
  hudLine(e, o);
  placeBar(e.bar);
}

/*
 * Where the race line sits. On a desktop: top centre, 54 px down, where the
 * objective box would be (the race parks it). On a touch screen (iPads,
 * touchscreen Chromebooks) the instruments are a band across the top instead
 * — and the independent check measured the line on top of them: the car's
 * speed, the notches of the boat's throttle lever, the helicopter's hover box
 * and height in an iPad held upright. Every touch layout already keeps the
 * objective's place clear of its instruments (styles/main.css, hud-rotor.js:
 * y140, y188 hovering, y232 on a small screen), so on a touch screen the line
 * takes the objective's place, and steps down past anything still in the way
 * — the helicopter's card, the map, the multiplayer badge, our own Leave
 * button, a message that has popped up (a toast is at y96 on a touch screen
 * too, and would be under the line for its few seconds). Measured twice a
 * second (the helicopter's band grows when it lifts off), not every frame: a
 * layout read a frame is a cost a Chromebook feels.
 */
const BAR_SKIP = /\b(hud-top|hud-toasts|hud-subtitle|hud-coach|touch-layer|hud-bottom)\b/;
function placeBar(bar) {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return;
  const t = now();
  if (G.barAt && t - G.barAt < 500) return;
  G.barAt = t;
  const hudEl = document.querySelector('#ui .hud.is-touch');
  if (!hudEl) {
    if (bar.style.top) bar.style.top = '';
    return;
  }
  const W = innerWidth;
  const H = innerHeight;
  const slot = hudEl.querySelector(':scope > .hud-top');
  let y = 54;
  if (slot) {
    const v = parseFloat(getComputedStyle(slot).top);
    if (Number.isFinite(v)) y = Math.max(y, v);
  }
  const b = bar.getBoundingClientRect();
  const h = b.height || 42;
  const x0 = b.left - 6;
  const x1 = b.right + 6;
  const boxes = [...hudEl.children].filter((el) => !BAR_SKIP.test(typeof el.className === 'string' ? el.className : ''));
  boxes.push(...hudEl.querySelectorAll('.hud-heli, .hud-toasts > .hud-toast:not(.is-out)'));
  if (slot) boxes.push(...slot.children);
  for (const sel of ['#ui .minimap', '.mp-badge', '.race-solobar']) {
    const el = document.querySelector(sel);
    if (el) boxes.push(el);
  }
  const rects = [];
  for (const el of boxes) {
    if (!el || el.hidden) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.right < x0 || r.left > x1 || r.top > H * 0.6) continue;
    if (r.width > W * 0.95 && r.height > H * 0.5) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) continue;
    rects.push(r);
  }
  for (let pass = 0; pass <= rects.length; pass++) {
    const hit = rects.find((r) => r.top < y + h + 4 && r.bottom + 6 > y);
    if (!hit) break;
    y = hit.bottom + 6;
  }
  const px = `${Math.round(Math.min(y, H * 0.55))}px`;
  if (bar.style.top !== px) bar.style.top = px;
}

function hudLine(e, o) {
  const { st, L, me, course } = o;
  if (o.grid) {
    e.line.innerHTML = `<em>${esc(course.name)}</em> · on the grid · <small>${st.ent.length} racing</small>`;
    e.arrow.style.transform = 'rotate(0deg)';
    return;
  }
  if (o.watching) {
    const done = L && L.fin;
    e.line.innerHTML = `<em>${esc(course.name)}</em> · ${done ? 'you’re done — ' : ''}${st.fin.length}/${st.ent.length} finished`;
    return;
  }
  const f = G.frames && G.frames[RR.ringOf(L.k, course)];
  const lap = RR.lapOf(L.k, course);
  const n = course.rings.length;
  const gateNo = (L.k % n) + 1;
  const t = L.t0 ? now() - L.t0 : 0;
  // Through the last gate (the frame the finish goes off): not "hoop 1/9" of a lap that is not coming.
  if (L.k >= RR.totalRings(course)) {
    e.line.innerHTML = `<em>${esc(course.name)}</em> · finished · ${RR.fmtTime(t)}`;
    return;
  }
  let dist = '';
  if (f && me) {
    const dx = f.x - me.pos.x;
    const dz = f.z - me.pos.z;
    const d = Math.hypot(dx, dz);
    dist = d > 999 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d / 10) * 10} m`;
    const fw = forwardOf(me.quat, new THREE.Vector3());
    const rel = Math.atan2(dx, -dz) - Math.atan2(fw.x, -fw.z);
    e.arrow.style.transform = `rotate(${Math.round((rel * 180) / Math.PI)}deg)`;
  }
  const pl = inGame() && st.ent.length > 1 ? ` · <em>${RR.ordinal(placeOf(st, myId()) || 1)}</em>` : '';
  const word = course.style === 'buoys' ? 'buoys' : course.style === 'road' ? 'gate' : course.style === 'hoops' ? 'hoop' : 'ring';
  const gateWord = gateNo === n ? (lap < course.laps ? 'lap line' : 'finish') : `${word} ${gateNo}/${n}`;
  // One lap (the Skyhook Sprint): no "Lap 1/1", just the hoop.
  const lapPart = course.laps > 1 ? `Lap ${lap}/${course.laps} · ` : '';
  const where = lapPart ? gateWord : gateWord[0].toUpperCase() + gateWord.slice(1);
  e.line.innerHTML = `${lapPart}${where} <small>${dist}</small> · ${RR.fmtTime(t)}${pl}`;
}

function showResults(st) {
  const e = els();
  if (!e) return;
  G.stats.resultsShown++;
  const course = courseOf(st);
  const rows = RR.results(st);
  const medal = ['🥇', '🥈', '🥉'];
  const mine = myId();
  const list = rows.map((r) => {
    const w = inGame() ? who(r.id) : { name: (mp.profile && mp.profile.name) || 'You', colour: (mp.profile && mp.profile.colour) || '#58c6ff' };
    return `<li class="${r.id === mine ? 'is-me' : ''}"><span>${r.place ? medal[r.place - 1] || RR.ordinal(r.place) : '—'}</span><i style="background:${esc(w.colour)}"></i>`
      + `<b>${esc(w.name)}</b><em>${r.ms != null ? RR.fmtTime(r.ms) : 'didn’t finish'}</em></li>`;
  }).join('');
  const me = rows.find((r) => r.id === mine);
  const kept = keepBest(st, course);
  const best = kept.best;
  let line = !me ? 'Here’s how the race went.' : me.place && rows.length === 1 ? `Round in ${RR.fmtTime(me.ms)}!` : me.place === 1 ? 'You won! 🎉' : me.place ? `You came ${RR.ordinal(me.place)}.` : 'You didn’t finish this one — race again?';
  if (kept.record && me && me.place) line += ' A new best time!';
  e.res.innerHTML = `<h3>🏁 ${esc(course.name)} — results</h3><p>${esc(line)}${best ? ` Your best on this device: ${RR.fmtTime(best)}.` : ''}</p><ol>${list}</ol>`
    + '<div class="race-btns"><button type="button" data-race-close>Close</button><button type="button" class="primary" data-race-again>Race again</button></div>';
  e.res.hidden = false;
  if (G.hub) G.hub.close();
}

/**
 * The badge's 🏁 chip: on a race's island, for somebody in that race's
 * vehicle. Somebody in another vehicle there gets no chip — it would be a
 * button that cannot start anything, and the badge is kept small (list 2's
 * check: under 180 px with a lobby's worth of names) — and is told instead:
 * once in the corner as they arrive, and on the big card when the others'
 * race forms without them.
 */
function paintChip(sim) {
  const course = islandCourse(sim);
  const fits = !!course && RR.rideFits(course, myGame(sim));
  if (course && !fits && myGame(sim)) {
    const key = `${mp.meId}:${course.id}:${myGame(sim)}`;
    if (G.toldHere !== key) {
      G.toldHere = key;
      G.stats.told.push(RR.switchLine(course));
      feed(`🏁 The ${esc(course.name)} is on this island — ${esc(RR.switchLine(course).replace(/^This is/, 'it’s'))} to race it`);
    }
  }
  const on = fits;
  const b = chip('race', 3, () => {
    const st = state();
    if (st && (st.s === RR.S.grid || st.s === RR.S.go) && G.L && G.L.slot >= 0 && !G.L.fin && !G.L.out) quitRace();
    else askRace();
  });
  if (!b) return;
  if (b.hidden === on) b.hidden = !on;
  if (!on) return;
  const st = state();
  const racing = st && (st.s === RR.S.grid || st.s === RR.S.go) && G.L && G.L.slot >= 0 && !G.L.fin && !G.L.out;
  const text = racing ? '🏁 Leave race' : st && (st.s === RR.S.grid || st.s === RR.S.go) ? '🏁 Race on…' : '🏁 Race';
  if (b.textContent !== text) b.textContent = text;
  const title = `${course.name}: everybody in ${RR.VEHICLE_WORDS[course.vehicle].for === 'aeroplanes' ? 'a plane (or the helicopter)' : RR.VEHICLE_WORDS[course.vehicle].for} goes on the grid — 3, 2, 1, GO! ${RR.lapsWord(course)}.`;
  if (b.title !== title) b.title = title;
}

/* ---- the minimap: the gates --------------------------------------------------------------- */

function nextGate() {
  const st = state();
  const course = st ? courseOf(st) : null;
  const racing = st && st.s === RR.S.go && G.L && G.L.slot >= 0 && !G.L.fin && course && builtFor(course);
  return racing ? RR.ringOf(G.L.k, course) : -1;
}

// With friends: on the multiplayer badge's map, with everybody's dots.
mp.minimapExtras.push((g, toXY, sim) => {
  if (!G.view || islandCourse(sim) !== G.view.course) return;
  drawGates(g, toXY, G.view, nextGate());
  G.stats.minimapDrawn = (G.stats.minimapDrawn || 0) + 1;
});

/**
 * Alone: on the game's own minimap. It redraws itself up to thirty times a
 * second (clearing the canvas), and this runs after it every frame — so the
 * gates go on only in a frame it has just redrawn, never twice over one.
 */
function soloMinimap(sim) {
  const mm = sim.minimap;
  if (!mm || !G.view || inGame() || !mm.ctx || !mm._g || typeof mm._mx !== 'function' || mm._acc !== 0 || !mm.visible || mm._offstage) return;
  if (islandCourse(sim) !== G.view.course) return;
  const g = mm.ctx;
  const { cx, cy } = mm._g;
  const R = cx - 2;
  const edge = R - 10;
  const toXY = (wx, wz) => {
    const x = mm._mx(wx);
    const y = mm._my(wz);
    const dx = x - cx;
    const dy = y - cy;
    const rr = Math.hypot(dx, dy);
    if (rr > edge) return [cx + (dx / rr) * edge, cy + (dy / rr) * edge, true];
    return [x, y, false];
  };
  g.save();
  try {
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.clip();
    drawGates(g, toXY, G.view, nextGate(), 0.8);
  } finally {
    g.restore();
  }
  G.stats.minimapDrawn = (G.stats.minimapDrawn || 0) + 1;
}

/* ---- the plug-in ------------------------------------------------------------------------------ */

/** Free play, alone, in something that can race: where the 🏁 buttons show. */
function freePlay(sim) {
  if (inGame() || sim.state !== 'flying') return false;
  // Out walking about (./onfoot.js): the aeroplane is parked, nobody is racing it.
  if (onFoot && onFoot.active) return false;
  if (sim.mode === 'free') return !!myGame(sim);
  if (sim.mode === 'drive') {
    const o = sim.modeOpts || {};
    return !o.job && !o.mission && (myGame(sim) === 'car' || myGame(sim) === 'boat');
  }
  return false;
}

registerExtension({
  id: 'race',
  install(sim) {
    G.sim = sim;
    // The Multiplayer screen's Races card (the Ring Rally's "Race alone" as it always was),
    // and the note on a race island's tile in the private match picker.
    mp.raceAlone = () => raceAlone(sim);
    mp.mapNote = (id) => (RR.courseForMap(id) ? '🏁 race course' : '');
    // multiplayer/lobbyui.js calls this once, as it builds the screen.
    mp.racesCard = (section) => {
      try {
        els();
        // On the Multiplayer screen "your ride" is the ride picked there, not what this game is in now.
        const api = hubApi();
        G.lobby = mountLobbyCard(section, { ...api, game: () => {
          try {
            return mp.ride ? mp.ride().game : 'flight';
          } catch (e) {
            return 'flight';
          }
        }, plane: () => {
          try {
            return mp.rideFor ? mp.rideFor('flight').type : null;
          } catch (e) {
            return null;
          }
        } });
      } catch (e) {
        G.lobby = null;
      }
    };
  },
  buildWorld(sim, group) {
    G.sim = sim;
    G.view = buildCourse(islandCourse(sim), group, heightAt);
    G.frames = G.view ? G.view.frames : null;
  },
  startMode(sim) {
    G.sim = sim;
    if (!inGame()) {
      G.solo = null;
      G.L = null;
    }
    ghost('race', false);
    hideResults();
    G.parked = null;
    quiet(sim, false);
    if (G.hub) G.hub.close();
  },
  stop(sim, why) {
    if (why === 'airport') return;
    if (!inGame()) {
      G.solo = null;
      G.L = null;
    }
    ghost('race', false);
    quiet(sim, false);
    const e = G.els;
    if (e) {
      e.bar.hidden = true;
      e.solo.hidden = true;
      // Back to the menu: the results card does not stay over it.
      e.res.hidden = true;
    }
    hideResults();
    if (G.hub) G.hub.close();
  },
  update(sim) {
    G.sim = sim;
    step(sim);
    const e = els();
    if (e) {
      const st = state();
      const idle = !st || st.s === RR.S.idle || st.s === RR.S.done;
      // Racing alone: only a way out of the race (with friends it is the badge's "🏁 Leave race").
      const racingSolo = !inGame() && !!st && (st.s === RR.S.grid || st.s === RR.S.go) && !!G.L && G.L.slot >= 0 && !G.L.fin && !G.L.out;
      const show = freePlay(sim) && (idle || racingSolo) && !(sim.hud && sim.hud.hidden) && e.res.hidden && (!G.hub || G.hub.el.hidden);
      if (e.solo.hidden === show) e.solo.hidden = !show;
      if (e.soloLeave.hidden === racingSolo) e.soloLeave.hidden = !racingSolo;
      if (show && racingSolo) {
        // Racing alone: only the way out.
        if (!e.soloAll.hidden) e.soloAll.hidden = true;
      } else if (show) {
        if (e.soloAll.hidden) e.soloAll.hidden = false;
        const c = islandCourse(sim);
        const mine = c && RR.rideFits(c, myGame(sim));
        const title = mine ? `${c.name} is on this island: ${c.blurb}` : c ? `${c.name} is here — ${RR.switchLine(c)}. Every race, and where it is.` : 'Every race in the game, which vehicle each is for and which island it is on';
        if (e.soloAll.title !== title) e.soloAll.title = title;
      }
    }
    if (inGame()) paintChip(sim);
    else soloMinimap(sim);
  },
  devActions: RR.COURSES.map((c) => ({
    label: `${c.name} (race alone)`,
    hint: `${c.island} in ${RR.VEHICLE_WORDS[c.vehicle].one}, and a ${c.laps}-lap race against the clock`,
    run: (sim) => raceAlone(sim, c.id),
  })),
});

/** For the tests and the console. */
export function raceDebug() {
  const h = inGame() ? G.host : G.solo;
  return { G, L: G.L, state: state(), course: state() ? courseOf(state()) : islandCourse(G.sim), frames: G.frames, stats: { ...G.stats }, refused: h ? h.refused.slice() : [] };
}
