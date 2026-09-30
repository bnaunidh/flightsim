/**
 * The race — the course, and what the HOST decides. No DOM, no three.js:
 * the node tests fly a scripted field of racers through it.
 *
 * "add custom multiplayer map for racing" (the owner's list, list 2).
 *
 * THE COURSE. Coral Atoll: a flat coral island in a ring of sea, the
 * friendliest flying in the game — nothing tall to hit, the runway in the
 * middle, water all round. The Ring Rally is eight big rings in a loop round
 * the lagoon side of the island, fifty-odd metres up, and back down the
 * runway for a low pass through the finish ring. Two laps, about 5.5 km each:
 * about three minutes in the Skylark, under a minute in a jet (which will
 * have to slow down for the turns). Measured against the terrain in node:
 * never less than 30 m between the straight line from ring to ring and the
 * ground.
 *
 * THE START is a grid on the runway, two abreast, 28 m between rows,
 * everybody facing down the runway with the engine running: "3, 2, 1, GO!"
 * and it is a take-off race. While the lights count down nobody can roll.
 *
 * WHO DECIDES. A racer's own game sees its own aeroplane go through a ring
 * (a line from where it was to where it is crossing the ring's disc) and
 * tells the host; the host counts rings IN ORDER, one at a time, and takes a
 * finish only from a racer who has been through every ring of every lap. The
 * time is the host's own clock from its GO, and no faster than the course
 * allows. The finishing order is the host's. Alone,
 * the same code runs in the one tab.
 *
 * ONE FOR EVERY RIDE (list 2, "racing world has: racing for cars, planes,
 * boats etc"). The Ring Rally is now one of four courses — ./courses.js has
 * the car's, the boat's and the helicopter's — and every rule below takes the
 * course it is judging. The shared state says which course (`c`); a state
 * without one is the Ring Rally, as every state was before.
 */

import { OTHER_COURSES } from './courses.js';

export const COURSE = Object.freeze({
  id: 'ring-rally',
  name: 'Ring Rally',
  short: 'Ring Rally',
  cta: '🏁 Race the rings',
  /** Who may race it: aeroplanes — and the helicopter, as it always has. */
  vehicle: 'plane',
  emoji: '🛩️',
  map: 'atoll',
  island: 'Coral Atoll',
  shape: 'ring',
  style: 'rings',
  gateWord: 'ring',
  blurb: 'Eight big rings round the atoll, a take-off race from the runway, two laps.',
  maxMs: 9 * 60000,
  laps: 2,
  /** Where the grid is: the front row's middle, and which way it faces (degrees, 90 = east). */
  grid: { x: -440, z: 0, heading: 90, rowGap: 28, side: 11 },
  /** [x, z, metres above the ground]. The last is the finish line, over the runway. */
  // 55 m up round the lagoon side: ring 3 is over the town, whose roofs are 20-25 m, and the
  // eight-tab playtest's picture of it had a racer skimming them at 40.
  rings: [
    [800, 0, 45],
    [1150, 450, 55],
    [850, 950, 55],
    [250, 700, 55],
    [-350, 1000, 55],
    [-950, 650, 55],
    [-950, 120, 45],
    [-150, 0, 34],
  ],
  radius: 24,
  finishRadius: 26,
});

export const GRID_MS = 5000;
/** After the first racer finishes, the others have this long. */
export const CLOSE_MS = 60000;
/** After the first finish, the others' time to finish (each course may say its own: `closeMs`). */
export function closeMs(course = COURSE) {
  return course.closeMs || CLOSE_MS;
}
/** No Ring Rally goes on longer than this (each course says its own: `maxMs`). */
export const RACE_MAX_MS = 9 * 60000;
/** No time on the wire is longer than this, whatever the course. */
export const RACE_CAP_MS = 15 * 60000;
/** Nobody flies the course faster than this — a jet flat out would be about 250. */
export const MAX_SPEED = 420;

export const S = { idle: 0, grid: 1, go: 2, done: 3 };

/* ---- the four courses ---------------------------------------------------------------- */

export const COURSES = Object.freeze([COURSE, ...OTHER_COURSES]);
export const COURSE_IDS = Object.freeze(COURSES.map((c) => c.id));

/** A course by its id; anything else (or nothing) is the Ring Rally. */
export function courseById(id) {
  return COURSES.find((c) => c.id === id) || COURSE;
}

/** The race on an island, or null: each island has at most one. */
export function courseForMap(mapId) {
  return COURSES.find((c) => c.map === mapId) || null;
}

/** The race for a ride (a game id: 'flight' 'heli' 'boat' 'car'): the helicopter has its own now. */
export function courseForGame(game) {
  if (game === 'flight') return COURSE;
  return COURSES.find((c) => c.vehicle === game) || null;
}

/**
 * May a ride of this game race this course? The Ring Rally takes aeroplanes
 * and the helicopter (as it always has); the others only their own vehicle.
 */
export function rideFits(course, game) {
  if (!course) return false;
  if (course.vehicle === 'plane') return game === 'flight' || game === 'heli';
  return game === course.vehicle;
}

/** What each race is for, the way a kid says it. */
export const VEHICLE_WORDS = Object.freeze({
  plane: { for: 'aeroplanes', one: 'an aeroplane', race: 'an aeroplane race', switchTo: 'a plane', game: 'flight' },
  car: { for: 'the car', one: 'the car', race: 'a car race', switchTo: 'the car', game: 'car' },
  boat: { for: 'the boat', one: 'the boat', race: 'a boat race', switchTo: 'the boat', game: 'boat' },
  heli: { for: 'the helicopter', one: 'the Skyhook', race: 'a helicopter race', switchTo: 'the Skyhook', game: 'heli' },
});

/** "2 laps", "1 lap": the Skyhook Sprint is one lap. */
export function lapsWord(course = COURSE) {
  return `${course.laps} lap${course.laps === 1 ? '' : 's'}`;
}

/** "This is a car race — switch to the car". */
export function switchLine(course) {
  const w = VEHICLE_WORDS[course.vehicle] || VEHICLE_WORDS.plane;
  return `This is ${w.race} — switch to ${w.switchTo}`;
}

const okId = (v) => Number.isInteger(v) && v >= 0 && v <= 7;

/** Ring k of the whole race (k counts from 0 over all laps): which ring on the course. */
export function ringOf(k, course = COURSE) {
  return k % course.rings.length;
}
export function totalRings(course = COURSE) {
  return course.rings.length * course.laps;
}
export function lapOf(k, course = COURSE) {
  return Math.min(course.laps, Math.floor(k / course.rings.length) + 1);
}

/** The course's length for one lap, metres, flat (ring to ring, and from the last round to the first). */
export function lapLength(course = COURSE) {
  let m = 0;
  const r = course.rings;
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    m += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return m;
}

/** The fastest a finish can honestly be, ms: from the grid, every ring, every lap, at MAX_SPEED. */
export function minRaceMs(course = COURSE) {
  const first = Math.hypot(course.rings[0][0] - course.grid.x, course.rings[0][1] - course.grid.z);
  const whole = first + lapLength(course) * course.laps - Math.hypot(course.rings[0][0] - course.rings[course.rings.length - 1][0], course.rings[0][1] - course.rings[course.rings.length - 1][1]);
  return (whole / (course.maxSpeed || MAX_SPEED)) * 1000;
}

/** Grid slot i: two abreast, rows behind the first, all facing down the runway. */
export function gridSlot(i, course = COURSE) {
  const g = course.grid;
  const h = (g.heading * Math.PI) / 180;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const rx = Math.cos(h);
  const rz = Math.sin(h);
  const row = Math.floor(i / 2);
  const side = i % 2 ? 1 : -1;
  return { x: g.x - fx * g.rowGap * row + rx * g.side * side, z: g.z - fz * g.rowGap * row + rz * g.side * side, heading: g.heading };
}

/**
 * Each ring's middle and the way through it, given the ground height:
 * [{ x, y, z, nx, ny, nz, r }] — the way through points from the ring before
 * towards the ring after, so every ring faces the line you fly.
 */
export function ringFrames(heightAt, course = COURSE) {
  const n = course.rings.length;
  const pts = course.rings.map(([x, z, agl, hd]) => ({ x, z, y: Math.max(0, heightAt(x, z)) + agl, hd }));
  const gate = course.shape === 'gate';
  return pts.map((p, i) => {
    const a = i === 0 ? { x: course.grid.x, z: course.grid.z, y: p.y } : pts[i - 1];
    const b = pts[(i + 1) % n];
    let nx = b.x - a.x;
    let ny = 0;
    let nz = b.z - a.z;
    // The finish is along the runway, the way everybody lands on it; a gate on a road faces the way the road goes.
    const hd = p.hd != null ? p.hd : i === n - 1 ? course.grid.heading : null;
    if (hd != null) {
      const h = (hd * Math.PI) / 180;
      nx = Math.sin(h);
      nz = -Math.cos(h);
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    const r = i === n - 1 ? course.finishRadius : course.radius;
    const f = { x: p.x, y: p.y, z: p.z, nx: nx / l, ny: ny / l, nz: nz / l, r, shape: gate ? 'gate' : 'ring' };
    if (gate) {
      f.w = r;
      f.h = course.halfHeight || 20;
    }
    return f;
  });
}

/**
 * Did one frame's move, from a to b, go THROUGH ring f? Its line crosses the
 * ring's disc, going the right way, inside its radius (and a little more:
 * the rings are generous, this is for ten-year-olds).
 */
export function throughRing(ax, ay, az, bx, by, bz, f, slack = 4) {
  const da = (ax - f.x) * f.nx + (ay - f.y) * f.ny + (az - f.z) * f.nz;
  const db = (bx - f.x) * f.nx + (by - f.y) * f.ny + (bz - f.z) * f.nz;
  if (!(da < 0 && db >= 0)) return false;
  const u = da / (da - db);
  const px = ax + (bx - ax) * u - f.x;
  const py = ay + (by - ay) * u - f.y;
  const pz = az + (bz - az) * u - f.z;
  return Math.hypot(px, py, pz) <= f.r + slack;
}

/**
 * Through a gate: a ring as above, or — for the car's and the boat's — an
 * upright rectangle across the road or between the buoys: the move crosses
 * its line going the right way, inside its width (and a little more) and
 * its height.
 */
export function throughGate(ax, ay, az, bx, by, bz, f, slack = 4) {
  if (f.shape !== 'gate') return throughRing(ax, ay, az, bx, by, bz, f, slack);
  const da = (ax - f.x) * f.nx + (az - f.z) * f.nz;
  const db = (bx - f.x) * f.nx + (bz - f.z) * f.nz;
  if (!(da < 0 && db >= 0)) return false;
  const u = da / (da - db);
  const px = ax + (bx - ax) * u - f.x;
  const py = ay + (by - ay) * u - f.y;
  const pz = az + (bz - az) * u - f.z;
  const along = Math.abs(px * -f.nz + pz * f.nx);
  return along <= f.w + slack && Math.abs(py) <= f.h;
}

/** The two ends of a gate (its posts, its buoys), for drawing it and the minimap. */
export function gateEnds(f) {
  const w = f.w || f.r;
  return [{ x: f.x + f.nz * w, z: f.z - f.nx * w }, { x: f.x - f.nz * w, z: f.z + f.nx * w }];
}

/* ---- what may travel ---------------------------------------------------------------- */

export const cleanAsk = (d) => (d === null || (d && typeof d === 'object' && Object.keys(d).length === 0) ? {} : null);
export const cleanGate = (d) => (d && Number.isInteger(d.n) && d.n >= 0 && d.n < 1e6 && Number.isInteger(d.k) && d.k >= 1 && d.k <= 64 ? { n: d.n, k: d.k } : null);
export const cleanDone = (d) => (d && Number.isInteger(d.n) && d.n >= 0 && d.n < 1e6 && Number.isFinite(d.ms) && d.ms > 0 && d.ms < RACE_CAP_MS ? { n: d.n, ms: Math.round(d.ms) } : null);
export const cleanQuit = (d) => (d && Number.isInteger(d.n) && d.n >= 0 && d.n < 1e6 ? { n: d.n } : null);

/**
 * The shared state 'race':
 *   { s, n, c: course id, ent: [ids], k: [rings passed, per entrant], fin: [[id, ms]], out: [ids] }
 * No `c` is the Ring Rally; a course nobody has heard of is turned away.
 */
export function cleanState(v) {
  if (!v || !Number.isInteger(v.s) || v.s < 0 || v.s > 3 || !Number.isInteger(v.n) || v.n < 0 || v.n >= 1e6) return null;
  if (v.c != null && !COURSE_IDS.includes(v.c)) return null;
  const c = v.c == null ? COURSE.id : v.c;
  const ids = (a) => Array.isArray(a) && a.length <= 8 && a.every(okId) && new Set(a).size === a.length;
  if (!ids(v.ent) || !ids(v.out)) return null;
  if (!Array.isArray(v.k) || v.k.length !== v.ent.length || !v.k.every((x) => Number.isInteger(x) && x >= 0 && x <= 64)) return null;
  if (!Array.isArray(v.fin) || v.fin.length > 8) return null;
  for (const f of v.fin) if (!Array.isArray(f) || f.length !== 2 || !okId(f[0]) || !Number.isFinite(f[1]) || f[1] < 0 || f[1] > RACE_CAP_MS) return null;
  return { s: v.s, n: v.n, c, ent: v.ent.slice(), k: v.k.slice(), fin: v.fin.map((f) => [f[0], Math.round(f[1])]), out: v.out.slice() };
}

/* ---- the host ------------------------------------------------------------------------ */

export class RaceHost {
  constructor({ now = () => Date.now(), course = COURSE } = {}) {
    this.now = now;
    this.course = course;
    this.st = { s: S.idle, n: 0, c: course.id, ent: [], k: [], fin: [], out: [] };
    this.gridAt = 0;
    this.goAt = 0;
    this.firstFinishAt = 0;
    this.refused = [];
    this.dirty = true;
  }

  _refuse(why) {
    this.refused.push(why);
    if (this.refused.length > 20) this.refused.shift();
    return { ok: false, why };
  }

  /** Carry on after the lobby re-formed: a race on the grid starts again; a race running goes on. */
  load(state, t = this.now()) {
    const s = cleanState(state);
    if (!s) return;
    this.st = s;
    this.course = courseById(s.c);
    if (s.s === S.grid) this.gridAt = t;
    if (s.s === S.go) this.goAt = t - 1;
    this.dirty = true;
  }

  get state() {
    return this.st;
  }

  /**
   * Somebody asked for a race. `racers` is everybody who can fly it (their
   * ids, in the order to put them on the grid).
   */
  ask(racers, t = this.now(), courseId = this.course.id) {
    const st = this.st;
    if (st.s === S.grid || st.s === S.go) return this._refuse('a race is already on');
    const ent = racers.filter(okId).slice(0, 8);
    if (!ent.length) return this._refuse('nobody here can race it');
    this.course = courseById(courseId);
    this.st = { s: S.grid, n: st.n + 1, c: this.course.id, ent, k: ent.map(() => 0), fin: [], out: [] };
    this.gridAt = t;
    this.goAt = 0;
    this.firstFinishAt = 0;
    this.dirty = true;
    return { ok: true, n: this.st.n };
  }

  /** Racer `id` has been through ring number k (counting from 1 over the whole race). */
  gate(id, n, k, t = this.now()) {
    const st = this.st;
    if (st.s !== S.go || n !== st.n) return this._refuse('no race running');
    const i = st.ent.indexOf(id);
    if (i < 0) return this._refuse('not racing');
    if (st.out.includes(id) || st.fin.some((f) => f[0] === id)) return this._refuse('already out or finished');
    if (k !== st.k[i] + 1) return this._refuse(`rings in order: expected ${st.k[i] + 1}, got ${k}`);
    if (k > totalRings(this.course)) return this._refuse('more rings than the course has');
    st.k[i] = k;
    this.dirty = true;
    return { ok: true };
  }

  /**
   * Racer `id` says they have finished. The time that counts is the HOST'S
   * clock from its own GO to the moment the finish arrives — the same clock
   * for everybody. (A time from the racer's own game was the first idea; in
   * the eight-tab playtest a game that hitched for a few seconds at the GO
   * had a time the host could only refuse, and a child who finished was told
   * they had not. `ms` is kept only as a sanity check that it is a number.)
   */
  done(id, n, ms, t = this.now()) {
    const st = this.st;
    if (st.s !== S.go || n !== st.n) return this._refuse('no race running');
    const i = st.ent.indexOf(id);
    if (i < 0) return this._refuse('not racing');
    if (st.fin.some((f) => f[0] === id)) return this._refuse('already finished');
    if (st.k[i] !== totalRings(this.course)) return this._refuse('has not been through every ring');
    const took = Math.round(t - this.goAt);
    if (took < minRaceMs(this.course)) return this._refuse('faster than the course allows');
    // Past the longest time the wire carries, the whole state would stop being readable: the race is over by then anyway.
    if (took >= RACE_CAP_MS) return this._refuse('the race is over');
    st.fin.push([id, took]);
    if (!this.firstFinishAt) this.firstFinishAt = t;
    this.dirty = true;
    this._maybeDone(t);
    return { ok: true, place: st.fin.length };
  }

  /** Racer `id` has left the race (the button, or they left the game). */
  quit(id, t = this.now()) {
    const st = this.st;
    if (st.s !== S.grid && st.s !== S.go) return { ok: false };
    if (!st.ent.includes(id) || st.out.includes(id) || st.fin.some((f) => f[0] === id)) return { ok: false };
    st.out.push(id);
    this.dirty = true;
    this._maybeDone(t);
    return { ok: true };
  }

  _maybeDone(t) {
    const st = this.st;
    const left = st.ent.filter((id) => !st.out.includes(id) && !st.fin.some((f) => f[0] === id));
    if (!left.length && (st.s === S.go || st.s === S.grid)) {
      st.s = S.done;
      this.dirty = true;
    }
  }

  /** Time passing: the GO, the closing time after the first finish, the longest a race may go on. */
  tick(t = this.now()) {
    const st = this.st;
    const out = [];
    if (st.s === S.grid && t - this.gridAt >= GRID_MS) {
      st.s = S.go;
      this.goAt = t;
      this.dirty = true;
      out.push('go');
    }
    if (st.s === S.go && ((this.firstFinishAt && t - this.firstFinishAt >= closeMs(this.course)) || t - this.goAt >= (this.course.maxMs || RACE_MAX_MS))) {
      for (const id of st.ent) if (!st.fin.some((f) => f[0] === id) && !st.out.includes(id)) st.out.push(id);
      st.s = S.done;
      this.dirty = true;
      out.push('done');
    }
    return out;
  }
}

/** The results, in order: finishers by time, then everybody who did not finish. */
export function results(state) {
  const s = cleanState(state);
  if (!s) return [];
  const fin = s.fin.slice().sort((a, b) => a[1] - b[1]).map(([id, ms], i) => ({ id, ms, place: i + 1 }));
  const dnf = s.ent.filter((id) => !s.fin.some((f) => f[0] === id)).map((id) => ({ id, ms: null, place: null }));
  return [...fin, ...dnf];
}

export function fmtTime(ms) {
  if (!Number.isFinite(ms)) return '—';
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}

export function ordinal(n) {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
}
