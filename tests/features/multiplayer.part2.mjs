/**
 * Multiplayer, part 2 of list 2 — PvP, bumping, the Ring Rally and the shared
 * world — in plain node, no network and no browser:
 *
 *   node tests/features/multiplayer.part2.mjs
 *
 * Two halves. The RULES, as plain functions and classes: the PvP judge
 * (pvp/rules.js), the race host and its course (race/rules.js, measured
 * against Coral Atoll's real terrain), the bump contact (bump.js) and what
 * may travel for the shared world (mpworld.js). Then the HOST ITSELF: this
 * process's multiplayer.events is made the host of a game with two players,
 * each a GameEvents of its own joined to it by a loopback — so the features'
 * real handlers judge real claims: hits, tags, a crash, a race from the grid
 * to the results, a summoned storm, a second one too soon, the weather, the
 * AI aeroplanes and a crash mark. Time is moved on by a clock this file owns.
 */

// A DOM stub with just enough in it for the features' on-screen bits to be made and ignored.
const el = () => {
  const e = {
    style: { setProperty() {} }, dataset: {}, children: [], hidden: false, textContent: '', innerHTML: '', className: '', isConnected: true,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild(c) { this.children.push(c); return c; }, append(...c) { this.children.push(...c); }, remove() {}, removeChild() {},
    querySelector: () => el(), querySelectorAll: () => [], setAttribute() {}, addEventListener() {}, getContext: () => null,
    get firstChild() { const self = this; return this.children.length ? { remove() { self.children.shift(); } } : null; },
  };
  return e;
};
global.document = { createElement: el, body: el(), head: el(), getElementById: () => null, querySelectorAll: () => [] };
global.window = { innerWidth: 1280, innerHeight: 720, setInterval, clearInterval, addEventListener() {} };

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  return !!pass;
};
process.on('unhandledRejection', (err) => ok('no unhandled rejections', false, err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err));

// The clock the features read (performance.now), moved on by hand.
const realNow = performance.now.bind(performance);
let skew = 0;
performance.now = () => realNow() + skew;
const later = (ms) => { skew += ms; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PR = await import('../../src/features/pvp/rules.js');
const RR = await import('../../src/features/race/rules.js');
const E = await import('../../src/features/multiplayer/events.js');
const T = await import('../../src/world/terrain.js');
const { Weather } = await import('../../src/world/weather.js');

/* ================================================================= the rules */

/* ---- PvP ---------------------------------------------------------------- */
{
  let t = 0;
  const j = new PR.PvpJudge({ now: () => t });
  j.join(0);
  j.join(1);
  j.join(2);
  ok('pvp: everybody starts with PvP OFF and five hearts', [0, 1, 2].every((id) => !j.get(id).on && j.get(id).hp === 5));
  j.want(0, true, t);
  j.want(1, true, t);
  ok('pvp: switching on takes three seconds — nothing counts while it arms', !j.hit(0, 1, 50, t).ok && j.refused.at(-1) === 'shooter has PvP off');
  t = 3001;
  j.tick(t);
  ok('pvp: after three seconds both are on (and a one-second shield as it starts)', j.get(0).on && j.get(1).on && j.get(1).shieldUntil > t);
  t = 4200;
  j.tick(t);
  ok('pvp: a hit needs the shooter to be firing', !j.hit(0, 1, 50, t).ok && j.refused.at(-1) === 'shooter was not firing');
  j.fire(0, true, t);
  ok('pvp: a player with PvP OFF can never be hit', !j.hit(0, 2, 50, t).ok && j.refused.at(-1) === 'target has PvP off');
  ok('pvp: nor from too far away, as the host sees them', !j.hit(0, 1, 5000, t).ok && j.refused.at(-1) === 'too far apart');
  const hits = [1, 2, 3, 4].map(() => j.hit(0, 1, 120, t));
  ok('pvp: each hit takes a heart', hits.every((h) => h.ok && !h.down) && j.get(1).hp === 1, hits.map((h) => h.hp).join(','));
  const last = j.hit(0, 1, 120, t);
  ok('pvp: the fifth is a tag — a point to the shooter, one against the tagged', last.ok && last.down && j.get(0).tags === 1 && j.get(1).outs === 1);
  ok('pvp: nobody hits a tagged player, and a tagged player hits nobody', !j.hit(0, 1, 50, t).ok && !j.hit(1, 0, 50, t).ok);
  const st = PR.rowOf(j.state(t), 1);
  ok('pvp: the shared state says so: down, shielded, hearts gone', st.down && st.shield && st.hp === 0 && PR.cleanState(j.state(t)) !== null);
  t += PR.DOWN_MS + 1;
  const ev = j.tick(t);
  ok('pvp: three seconds later they are back, all five hearts, still shielded', ev.some((e) => e.type === 'up' && e.id === 1) && j.get(1).hp === 5 && j.get(1).shieldUntil > t);
  ok('pvp: the shield is real — no hits inside it', !j.hit(0, 1, 50, t).ok && j.refused.at(-1) === 'target is shielded');
  j.fire(1, true, t);
  ok('pvp: firing gives your own shield up', !(j.get(1).shieldUntil > t));
  j.fire(1, false, t);
  // A heart back every four seconds once not hit for six.
  j.hit(0, 1, 50, t);
  const h0 = j.get(1).hp;
  t += 5000;
  j.tick(t);
  const h1 = j.get(1).hp;
  t += 1100;
  j.tick(t);
  const h2 = j.get(1).hp;
  t += 4100;
  j.tick(t);
  ok('pvp: hearts come back — one after six quiet seconds, then one every four', h0 === 4 && h1 === 4 && h2 === 5, `${h0} → ${h1} → ${h2}`);
  // Turning off in the middle of a fight waits for five calm seconds, then three more.
  j.hit(0, 1, 50, t);
  const w = j.want(1, false, t);
  ok('pvp: switching OFF straight after being hit waits until five seconds after the hit, then the usual three', w.at === t + PR.CALM_MS + PR.ARM_MS, w.at - t);
  t = w.at + 1;
  j.tick(t);
  ok('pvp: ...and then it is off', !j.get(1).on);
  // A crash between two in PvP.
  j.want(1, true, t);
  t += 3001;
  j.tick(t);
  t += 1001;
  j.tick(t);
  const before = JSON.stringify(j.state(t));
  const r1 = j.ram(0, 1, 30, t);
  const r2 = j.ram(1, 0, 30, t + 100);
  ok('pvp: a crash between two players in PvP tags both out, once, and nobody scores', r1.ok && !r2.ok && j.get(0).downUntil > t && j.get(1).downUntil > t && j.get(0).tags === 1, `${j.refused.at(-1)} ${before}`);
  // A new host carries on.
  const j2 = new PR.PvpJudge({ now: () => t });
  j2.load(j.state(t), t);
  ok('pvp: a new host after the lobby re-forms carries on the same scores', j2.get(0).tags === 1 && j2.get(1).outs === 2 && j2.get(0).outs === 1 && j2.get(0).on && j2.get(1).on,
    JSON.stringify(j.state(t)));
  ok('pvp: the scoreboard orders by tags, then fewest times tagged', PR.standings(j.state(t)).map((r) => r.id).join(',') === '0,1');
  ok('pvp: what arrives is checked: a bad state is dropped', PR.cleanState({ p: [[9, 1, 5, 0, 0]] }) === null && PR.cleanState({ p: [[1, 1, 6, 0, 0]] }) === null && PR.cleanState({ p: [[1, 1, 5, 0, 0], [1, 1, 5, 0, 0]] }) === null);
  ok('pvp: a claim names a player id and nothing else', PR.cleanHit({ t: 3, name: 'x' }).name === undefined && PR.cleanHit({ t: 12 }) === null && PR.cleanHit({ t: 'Sam' }) === null);
  ok('pvp: a pellet through a sphere hits it; past it does not', PR.segmentHitsSphere(0, 0, 0, 0, 0, -20, 0, 1, -10, 3) && !PR.segmentHitsSphere(0, 0, 0, 0, 0, -20, 0, 5, -10, 3));
}

/* ---- the Ring Rally ------------------------------------------------------ */
{
  T.applyMap(RR.COURSE.map);
  const frames = RR.ringFrames(T.heightAt);
  let worst = Infinity;
  for (let i = 0; i < frames.length; i++) {
    const a = frames[i];
    const b = frames[(i + 1) % frames.length];
    for (let k = 0; k <= 60; k++) {
      const u = k / 60;
      const x = a.x + (b.x - a.x) * u;
      const z = a.z + (b.z - a.z) * u;
      const y = a.y + (b.y - a.y) * u;
      worst = Math.min(worst, y - Math.max(0, T.heightAt(x, z)));
    }
  }
  ok('race: on Coral Atoll the straight line from every ring to the next is 30 m or more clear of the ground', worst >= 29.9, `${worst.toFixed(1)} m`);
  const lap = RR.lapLength();
  ok('race: a lap is about five and a half kilometres — three minutes in the Skylark for two laps, under one in a jet', lap > 4500 && lap < 6500, `${Math.round(lap)} m`);
  const slots = Array.from({ length: 8 }, (_, i) => RR.gridSlot(i));
  const apart = slots.every((s, i) => slots.every((o, j) => i === j || Math.hypot(s.x - o.x, s.z - o.z) >= 20));
  ok('race: eight places on the grid, on the runway, never within 20 m of each other', apart && slots.every((s) => Math.abs(s.z) <= 16 && s.x > -560 && T.isOnRunway(s.x, s.z)),
    slots.map((s) => `${Math.round(s.x)},${Math.round(s.z)}`).join(' '));
  const f0 = frames[0];
  ok('race: through a ring counts; past its edge or the wrong way does not',
    RR.throughRing(f0.x - f0.nx * 5, f0.y, f0.z - f0.nz * 5, f0.x + f0.nx * 5, f0.y + 3, f0.z + f0.nz * 5, f0)
    && !RR.throughRing(f0.x - f0.nx * 5, f0.y + 40, f0.z - f0.nz * 5, f0.x + f0.nx * 5, f0.y + 40, f0.z + f0.nz * 5, f0)
    && !RR.throughRing(f0.x + f0.nx * 5, f0.y, f0.z + f0.nz * 5, f0.x - f0.nx * 5, f0.y, f0.z - f0.nz * 5, f0));

  let t = 0;
  const h = new RR.RaceHost({ now: () => t });
  ok('race: nobody who can fly it, no race', !h.ask([], t).ok);
  const a = h.ask([0, 3, 5], t);
  ok('race: asked, the grid forms with everybody flying', a.ok && h.state.s === RR.S.grid && h.state.ent.join() === '0,3,5');
  ok('race: a second ask while one is on is turned down', !h.ask([0], t).ok);
  t = RR.GRID_MS + 1;
  ok('race: GO after the countdown', h.tick(t).includes('go') && h.state.s === RR.S.go);
  const total = RR.totalRings();
  ok('race: rings are counted in order — ring 2 before ring 1 is turned down', !h.gate(3, h.state.n, 2, t).ok);
  for (let k = 1; k <= total; k++) h.gate(3, h.state.n, k, t);
  ok('race: a finish before every ring is through is turned down', !h.done(5, h.state.n, 90000, t).ok);
  t = RR.GRID_MS + 1 + 20000;
  ok('race: a finish faster than the course allows is turned down', !h.done(3, h.state.n, 20000, t).ok, `${Math.round(RR.minRaceMs())} ms is the least`);
  t = RR.GRID_MS + 1 + 95000;
  const d3 = h.done(3, h.state.n, 60000, t);
  ok('race: a proper finish is taken, first place — timed by the host’s own clock from its GO, whatever the racer’s game says',
    d3.ok && d3.place === 1 && h.state.fin[0][0] === 3 && h.state.fin[0][1] === 95000, JSON.stringify(h.state.fin));
  h.quit(5, t);
  ok('race: one still racing (the host, id 0), so it is not over yet', h.state.s === RR.S.go);
  t += RR.CLOSE_MS + 1;
  h.tick(t);
  const res = RR.results(h.state);
  ok('race: a minute after the first finish it closes; the results: finishers by time, then everybody who did not finish',
    h.state.s === RR.S.done && res.map((r) => `${r.id}:${r.place || '-'}`).join(' ') === '3:1 0:- 5:-', JSON.stringify(res));
  ok('race: race again after the results', h.ask([0, 3], t).ok && h.state.n === 2 && h.state.fin.length === 0);
  ok('race: what arrives is checked', RR.cleanState({ s: 1, n: 1, ent: [0, 0], k: [0, 0], fin: [], out: [] }) === null
    && RR.cleanGate({ n: 1, k: 99 }) === null && RR.cleanDone({ n: 1, ms: -3 }) === null && RR.cleanState(h.state) !== null);
  ok('race: times read the way a kid reads a stopwatch', RR.fmtTime(95300) === '1:35.3' && RR.fmtTime(9000) === '0:09.0' && RR.ordinal(2) === '2nd');
}

/* ---- bumping ------------------------------------------------------------- */
{
  const B = await import('../../src/features/bump.js');
  const me = { x: 0, y: 100, z: 0, vx: 10, vy: 0, vz: 0, r: 5, flat: false };
  const other = { x: 8, y: 100, z: 0, vx: -10, vy: 0, vz: 0, r: 5, flat: false };
  const c = B.contact(me, other);
  // Closing at 20 m/s: 1.6 m more room (0.08 s of it), so 11.6 m between centres is a touch, and the overlap 3.6 m.
  ok('bump: head-on, each side pushes itself back out by half the overlap and takes half the knock', c && c.nx === -1 && Math.abs(c.push - (3.6 * 0.5 + 0.05)) < 1e-6 && c.dv > 10 && c.closing === 20,
    JSON.stringify(c));
  const far = B.contact({ ...me, vx: 55 }, { ...other, x: 18, vx: -55 });
  const drift = B.contact({ ...me, vx: 0.5 }, { ...other, x: 10.5, vx: -0.5 });
  ok('bump: the faster two close, the less close they must be (a busy machine draws the other up to 20 m off): 18 m apart at 110 m/s meet; 10.5 m apart drifting do not',
    far && far.closing === 110 && drift === null, `${JSON.stringify(far)} / ${drift}`);
  const slow = B.contact({ ...me, vx: 0.5 }, { ...other, vx: -0.5 });
  const vn = (0.5 - -0.5) * slow.nx;
  ok('bump: a slow touch still parts them at 2.5 m/s or more — never grinding along each other', slow && vn + 2 * slow.dv >= B.MIN_PART - 1e-9, `${vn} + 2 × ${slow.dv}`);
  ok('bump: not touching, nothing happens', B.contact(me, { ...other, x: 20 }) === null);
  const boat = B.contact({ ...me, y: 0, flat: true }, { ...other, y: 30 });
  ok('bump: a boat or a car is only ever pushed along the ground', boat && boat.ny === 0);
  // Head-on at 110 m/s with a hitch between frames: 25 m apart, then 14 m past each other.
  const sw = B.swept({ x: -25, y: 0, z: 0 }, { x: 14, y: 0.5, z: 0 }, { x: 0, y: 0, z: 0, vx: 55, vy: 0, vz: 0, r: 4, flat: false }, { vx: -55, vy: 0, vz: 0, r: 4 });
  const miss = B.swept({ x: -25, y: 20, z: 0 }, { x: 14, y: 20, z: 0 }, { vx: 55, vy: 0, vz: 0, r: 4, flat: false }, { vx: -55, vy: 0, vz: 0, r: 4 });
  ok('bump: two who went straight through each other between two frames still bump — back the way they came; 20 m apart they do not',
    sw && sw.nx === -1 && sw.dv > 50 && sw.closing === 110 && miss === null, JSON.stringify(sw));
  ok('bump: flying into each other at 90 m/s is a bump however deep the first overlap; appearing inside somebody (a teleport) is "stuck"',
    B.flewInto({ x: -12, y: 0, z: 0 }, { x: -3, y: 0, z: 0 }, { x: 90, y: 0, z: 0 }, 0.1, 8.4) === true
    && B.flewInto({ x: -900, y: 0, z: 0 }, { x: -0.5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0.033, 8.4) === false
    && B.flewInto({ x: -3, y: 0, z: 0 }, { x: -2, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 0.033, 8.4) === false);
  ok('bump: the knock one side sends the other is numbers only, and capped', B.cleanKnock({ t: 2, nx: 1, ny: 0, nz: 0, dv: 5 }) !== null
    && B.cleanKnock({ t: 2, nx: 3, ny: 0, nz: 0, dv: 5 }) === null && B.cleanKnock({ t: 2, nx: 1, ny: 0, nz: 0, dv: 500 }) === null && B.cleanKnock({ t: 9, nx: 1, ny: 0, nz: 0, dv: 1 }) === null);
}

/* ---- the shared world: what may travel ------------------------------------- */
const MW = await import('../../src/features/mpworld.js');
{
  ok('world: the weather travels as numbers from the game’s own lists', MW.cleanWx({ t: 0, c: 3, w: 12.34, d: 725, tc: -1 }).d === 5 && MW.cleanWx({ t: 9, c: 0, w: 1, d: 0 }) === null);
  ok('world: only a disaster the Summon menu offers can be summoned', MW.cleanSummon({ id: 'tornado', x: 1, z: 2 }) !== null && MW.cleanSummon({ id: 'birdStrike', x: 1, z: 2 }) === null && MW.cleanSummon({ id: 'Hello there', x: 1, z: 2 }) === null);
  ok('world: a crash travels as a kind from the list, a map id and a place', MW.cleanHap({ type: 'crash', kind: 'bonk', vehicle: 'plane', x: 1, z: 2, map: 'kestrel' }) !== null
    && MW.cleanHap({ type: 'crash', kind: 'Oops', x: 1, z: 2, map: 'kestrel' }) === null && MW.cleanHap({ type: 'crash', kind: 'bonk', x: 1, z: 2, map: 'Look at me' }) === null);
  ok('world: the AI aeroplanes travel as numbers and a type id', MW.cleanTraffic({ a: [[3, 'skylark', 1, 2, 3, 90, 50, 1, 1]] }) !== null && MW.cleanTraffic({ a: [[3, 'Sky Lark!', 1, 2, 3, 90, 50, 1, 1]] }) === null);
}

/* ============================================================ the host itself */

const { multiplayer: mp } = await import('../../src/features/multiplayer.js');
const pvp = await import('../../src/features/pvp.js');
const race = await import('../../src/features/race.js');
const ch = mp.events;

// Two players, each a GameEvents of their own, with the features' kinds defined the same way.
const NAMES = { 0: 'Swift Falcon', 1: 'Brave Otter', 2: 'Sunny Puffin' };
const COLS = { 0: '#ff5a4f', 1: '#4fd684', 2: '#58c6ff' };
const whoIs = (id) => ({ id, name: NAMES[id], colour: COLS[id], host: id === 0 });
const players = {};
const heard = { 1: [], 2: [] };
for (const id of [1, 2]) {
  const ev = new E.GameEvents({ now: () => performance.now() });
  for (const [k, def] of ch.kinds) ev.kinds.set(k, def);
  ev.onAny = [];
  players[id] = ev;
}
const pos = { 0: { x: 0, y: 300, z: 0 }, 1: { x: 0, y: 300, z: -150 }, 2: { x: 60, y: 300, z: -150 } };
const flags = { 0: {}, 1: {}, 2: {} };
const hostSession = {
  sendGame(msg, except) {
    for (const id of [1, 2]) if (id !== except) players[id].fromWire(whoIs(msg.f), { k: msg.k, d: msg.d });
    return true;
  },
  sendGameTo(id, msg) {
    players[id].fromWire(whoIs(msg.f), { k: msg.k, d: msg.d });
    return true;
  },
  sendGameState(msg) {
    for (const id of [1, 2]) players[id].stateFromWire(msg);
  },
  sendGameStateTo(id, msg) {
    players[id].stateFromWire(msg);
  },
};
for (const id of [1, 2]) {
  players[id].attach({ sendGame: (msg) => { ch.fromWire(whoIs(id), msg); return true; } }, 'client', id);
  // Everything that reaches a player, by kind.
  const orig = players[id]._deliver.bind(players[id]);
  players[id]._deliver = (kind, data, from, meta) => {
    heard[id].push({ kind, data, from: from && from.id });
    return orig(kind, data, from, meta);
  };
}
ch.roster = () => [0, 1, 2].map((id) => ({
  id, name: NAMES[id], colour: COLS[id], host: id === 0, me: id === 0, ride: { game: 'flight', type: 'skylark' },
  pos: pos[id], quat: { x: 0, y: 0, z: 0, w: 1 }, vel: { x: 0, y: 0, z: 0 }, visible: true, ghost: !!flags[id].ghost, pvp: !!flags[id].pvp, radius: 6,
}));
for (const id of [1, 2]) players[id].roster = ch.roster;

// A game object with only what the host's jobs read.
const triggered = [];
const weather = new Weather();
const sim = {
  mode: 'free', state: 'flying', settings: { map: 'atoll' }, weather, traffic: [], hud: { notify() {} },
  triggerNatural(id) { triggered.push(id); },
  meteors: { active: false, begin() { this.active = true; }, end() { this.active = false; } },
};
race.raceDebug().G.sim = sim;
MW.worldDebug().W.sim = sim;
mp.profile = { name: NAMES[0], colour: COLS[0], pvp: false, key: 'k', chosen: true };
mp.role = 'host';
mp.ready = true;
mp.meId = 0;
mp.server = { map: 'atoll', game: 'flight', bump: 2 };
ch.attach(hostSession, 'host', 0);
for (const id of [1, 2]) ch.joined(whoIs(id));
await sleep(50);

/* ---- PvP through the host ------------------------------------------------------------ */
const judge = () => pvp.pvpDebug().judge;
ok('host: the PvP judge is running and knows all three', !!judge() && judge().players.size === 3);
players[1].toHost('pvp:want', { on: true });
players[2].toHost('pvp:want', { on: true });
later(3100);
await sleep(250);
const row = (id) => PR.rowOf(players[1].getState('pvp'), id);
ok('host: two players switch PvP on; three seconds later every copy of the scores says so', row(1).on && row(2).on && !row(0).on, JSON.stringify(players[1].getState('pvp')));
later(1100);
await sleep(150);
players[1].send('pvp:fire', { on: true });
flags[1].pvp = flags[2].pvp = true;
for (let i = 0; i < 5; i++) players[1].toHost('pvp:hit', { t: 2 });
await sleep(250);
const ouch = heard[2].filter((e) => e.kind === 'pvp:ouch');
const downs = heard[2].filter((e) => e.kind === 'pvp:down');
ok('host: five claimed hits from Brave Otter on Sunny Puffin: four hearts, then a tag — told to everybody', ouch.length === 4 && downs.length === 1 && downs[0].data.by === 1 && downs[0].data.how === 0
  && heard[1].filter((e) => e.kind === 'pvp:down').length === 1, `${ouch.length} ouch, ${downs.length} down`);
ok('host: the scoreboard: a tag to Brave Otter, Sunny Puffin tagged once and shown as down', row(1).tags === 1 && row(2).outs === 1 && row(2).down);
players[1].toHost('pvp:hit', { t: 0 });
await sleep(50);
ok('host: nobody can hit the host, whose PvP is OFF', judge().refused.at(-1) === 'target has PvP off');
flags[2].ghost = true;
later(PR.DOWN_MS + PR.SHIELD_MS + 200);
await sleep(250);
players[1].toHost('pvp:hit', { t: 2 });
await sleep(50);
ok('host: a player on the ground, just arrived or racing (the ghost bit) is never hit, whatever a tab claims', /safe/.test(judge().refused.at(-1)), judge().refused.at(-1));
flags[2].ghost = false;
pos[2] = { x: 0, y: 300, z: -4000 };
players[1].toHost('pvp:hit', { t: 2 });
await sleep(50);
ok('host: nor from four kilometres away', judge().refused.at(-1) === 'too far apart');
pos[2] = { x: 20, y: 300, z: -150 };
pos[1] = { x: 0, y: 300, z: -150 };
players[1].toHost('pvp:ram', { t: 2 });
await sleep(50);
ok('host: a crash between two players in PvP (the lobby rule is "pvp"): both tagged out', heard[1].filter((e) => e.kind === 'pvp:down' && e.data.how === 1).length === 2);
players[1].send('pvp:fire', { on: false });

/* ---- the race through the host ---------------------------------------------------------- */
players[2].toHost('race:ask', {});
await sleep(50);
let rs = RR.cleanState(players[1].getState('race'));
ok('host: anybody asks for a race: the grid forms with everybody flying, and every copy has it', rs && rs.s === RR.S.grid && rs.ent.join() === '0,1,2', JSON.stringify(rs));
later(RR.GRID_MS + 50);
await sleep(250);
rs = RR.cleanState(players[1].getState('race'));
ok('host: GO after the countdown', rs && rs.s === RR.S.go);
players[2].toHost('race:gate', { n: rs.n, k: 2 });
// A ring every few seconds, as flying it would be (the channel holds each player to six a second).
for (let k = 1; k <= RR.totalRings(); k++) {
  later(4000);
  players[1].toHost('race:gate', { n: rs.n, k });
}
later(70000 - RR.totalRings() * 4000);
players[1].toHost('race:done', { n: rs.n, ms: 70000 + 150 });
players[2].toHost('race:quit', { n: rs.n });
await sleep(250);
rs = RR.cleanState(players[1].getState('race'));
ok('host: rings out of order are turned down; Brave Otter’s every ring and finish is taken, first', rs.fin.length === 1 && rs.fin[0][0] === 1 && rs.k[2] === 0 && rs.out.includes(2),
  JSON.stringify(rs));
later(RR.CLOSE_MS + 100);
await sleep(250);
rs = RR.cleanState(players[2].getState('race'));
ok('host: a minute after the first finish the race closes and everybody has the results', rs.s === RR.S.done && RR.results(rs)[0].id === 1);

/* ---- the shared world through the host -------------------------------------------------- */
weather.applyPreset('storm');
MW.worldDebug().hostWeather();
const wx = players[2].getState('world:wx');
ok('host: the host’s weather is everybody’s — a storm front at sunset reaches the players', wx && wx.c === 3 && wx.t === 1 && Math.round(wx.w) === 26, JSON.stringify(wx));
players[1].toHost('world:summon', { id: 'stormCell', x: 100, z: 200 });
players[2].toHost('world:summon', { id: 'tornado', x: 100, z: 200 });
await sleep(50);
const dis = heard[2].filter((e) => e.kind === 'world:dis');
ok('host: a storm cell Brave Otter summons happens for everybody — the host starts it too', dis.length === 1 && dis[0].data.id === 'stormCell' && dis[0].data.by === 1 && triggered.includes('stormCell'));
ok('host: a tornado straight after is "not yet", told only to who asked', heard[2].some((e) => e.kind === 'world:wait') && !heard[1].some((e) => e.kind === 'world:wait') && !triggered.includes('tornado'));
later(MW.PLAYER_COOL_MS + 100);
players[2].toHost('world:summon', { id: 'meteors', x: 0, z: 0 });
await sleep(50);
ok('host: a meteor shower summoned later starts here too', sim.meteors.active && heard[1].some((e) => e.kind === 'world:dis' && e.data.id === 'meteors'));
sim.traffic = [{ id: 'traffic-4', typeId: 'skylark', pos: { x: 100, y: 200, z: 300 }, heading: 270, speed: 45, vs: 2, onGround: false, gearDown: false }];
MW.worldDebug().hostTraffic();
const tr = heard[1].filter((e) => e.kind === 'world:traffic').at(-1);
ok('host: the host’s AI aeroplanes go to everybody: type, place, heading and speed', tr && tr.data.a[0][0] === 4 && tr.data.a[0][1] === 'skylark' && tr.data.a[0][5] === 270, JSON.stringify(tr && tr.data));
players[1].send('world:hap', { type: 'crash', kind: 'noseplant', vehicle: 'plane', x: 50, z: 60, map: 'atoll' });
await sleep(50);
ok('host: a crash reaches everybody — the other player, and a mark on the host’s minimap', heard[2].some((e) => e.kind === 'world:hap' && e.data.kind === 'noseplant') && MW.worldDebug().marks.some((m) => m.x === 50 && m.z === 60));
ok('host: nothing anybody sent was text to show — every drop was a kind or a check, not a name', !ch.dropped.some((d) => /Swift|Brave|Sunny/.test(d)), ch.dropped.join(' | '));

/* ---- a disaster summoned while this player drives the van or sails the boat (the reviewer's third finding) ---- */
{
  const spawned = [];
  const notes = [];
  const hazards = [];
  const V = await import('../../src/vendor/three.module.js');
  const van = { pos: new V.Vector3(500, 3, 800), quat: new V.Quaternion(), vel: new V.Vector3(), spec: { kind: 'car' } };
  Object.assign(sim, {
    mode: 'drive', vehicle: van, activeEvents: {}, lightningStorm: null, camera: { position: new V.Vector3(500, 8, 812), quaternion: new V.Quaternion() },
    hud: { notify: (t) => notes.push(t), setHazard: (t) => hazards.push(t) },
    menus: { syncNatural() {} },
    tornado: {
      active: false, label: 'EF1', pos: new V.Vector3(),
      spawn(p) { this.active = true; this.pos.set(p.x + 1200, 0, p.z); spawned.push({ x: p.x, z: p.z }); return this.pos.clone(); },
      update(dt) { this.pos.x += dt; }, clear() { this.active = false; },
    },
  });
  const before = { tr: triggered.length, applied: MW.worldDebug().stats.applied };
  later(MW.PLAYER_COOL_MS + 100);
  players[1].toHost('world:summon', { id: 'tornado', x: 0, z: 0 });
  await sleep(50);
  ok('drive: a tornado Brave Otter summons happens in the van too — put down near the van, with where it is', spawned.length === 1 && spawned[0].x === 500 && sim.activeEvents.tornado > 0
    && /TORNADO! It touched down 1\.2 km on your right/.test(notes.join(' | ')) && triggered.length === before.tr, notes.join(' | '));
  const ext = (await import('../../src/game/extensions.js')).extensions().find((e) => e.id === 'mp-world');
  const x0 = sim.tornado.pos.x;
  ext.update(sim, 0.5);
  const early = hazards.length;
  later(6100);
  ext.update(sim, 0.5);
  ok('drive: the van game runs the tornado (the flying game’s clock does not run there) and says where it is on the screen',
    early === 0 && sim.tornado.pos.x > x0 && /EF1 TORNADO<\/b> 1\.2 km · on your right/.test(hazards.at(-1) || ''), hazards.at(-1));
  sim.tornado.active = false;
  ext.update(sim, 0.1);
  ok('drive: and the line goes when the tornado has', hazards.at(-1) === null && !MW.worldDebug().hazard);
  later(MW.PLAYER_COOL_MS + 100);
  players[2].toHost('world:summon', { id: 'lightning', x: 0, z: 0 });
  await sleep(50);
  ok('drive: a lightning storm too: the stormy sky, the storm running, and its words for the road', weather._tempCond && weather._tempCond.id === 'stormy' && !!sim.lightningStorm
    && /LIGHTNING STORM — flashes and thunder/.test(notes.at(-1)), notes.at(-1));
  sim.lightningStorm.next = 0;
  const f0 = MW.worldDebug().stats.flashes;
  ext.update(sim, 0.1);
  ok('drive: … and it strikes: a flash in the sky over the van', MW.worldDebug().stats.flashes === f0 + 1 && weather.lightningFlash === 1);
  later(MW.PLAYER_COOL_MS + 100);
  players[1].toHost('world:summon', { id: 'wildfire', x: 900, z: -300 });
  await sleep(50);
  ok('drive: a WILDFIRE is said in the van, not left out (its smoke is drawn where there is a world to draw it in)', /WILDFIRE!/.test(notes.at(-1)) && MW.worldDebug().stats.applied >= before.applied + 3, notes.at(-1));
  /*
   * The independent check's blocker: a wildfire summoned from the BOAT (or an
   * aeroplane over the sea) showed nothing in the van or the boat — the smoke
   * was asked for at the summoner's spot, on the water, where it refuses. It
   * burns on the nearest land now, and the smoke, its line and the minimap's
   * flame are all there. Coral Atoll's land ends before x = 2000 on the x axis.
   */
  {
    const T2 = await import('../../src/world/terrain.js');
    const WD = MW.worldDebug();
    const scene = new V.Scene();
    const g = new V.Group();
    scene.add(g);
    WD.W.sights.build(g);
    const land = MW.landNear(3000, 0);
    const nearest = land ? Math.hypot(land.x - 3000, land.z) : Infinity;
    ok('wildfire from the boat: the nearest land to a spot out at sea is found — on land, about a kilometre west, not across the island',
      !!land && T2.heightAt(land.x, land.z) > 1.5 && nearest > 800 && nearest < 1500 && land.x < 2000, JSON.stringify(land));
    const here = MW.landNear(500, 800);
    ok('wildfire: a spot on land is its own nearest land; open sea with no land in 8 km has none', here && here.x === 500 && here.z === 800 && MW.landNear(20000, 20000) === null);
    later(MW.PLAYER_COOL_MS + 100);
    notes.length = 0;
    const dis0 = heard[2].length;
    players[1].toHost('world:summon', { id: 'wildfire', x: 3000, z: 0 });
    await sleep(50);
    const dis = heard[2].slice(dis0).find((e) => e.kind === 'world:dis' && e.data.id === 'wildfire');
    ok('wildfire from the boat: the host sends it out already on that land, so every game lights it in the same place', dis && dis.data.x === land.x && dis.data.z === land.z, JSON.stringify(dis && dis.data));
    const sm = MW.worldDebug().sights.smoke;
    const w = MW.whereFrom(van.pos, { x: 0, z: -1 }, land.x, land.z);
    ok('wildfire from the boat: the van sees its smoke on that land, and the line says how far and which side from there',
      sm && sm.x === land.x && sm.z === land.z && new RegExp(`See the smoke ${w.km.toFixed(1)} km ${w.side}`).test(notes.join(' | ')), `${JSON.stringify(sm)} · ${notes.join(' | ')}`);
    // The minimap's flame is drawn from the same smoke: into a fake minimap, where does it go?
    const drawn = [];
    const fakeG = new Proxy({}, { get: (o, k) => (k === 'moveTo' ? (x, y) => drawn.push([x, y]) : k in o ? o[k] : () => {}), set: (o, k, v) => ((o[k] = v), true) });
    for (const fn of mp.minimapExtras) fn(fakeG, (x, z) => [x, z, false], sim);
    ok('wildfire from the boat: the minimap flame is drawn at the smoke — the same spot', drawn.some(([x, y]) => x === land.x && y === land.z - 10), JSON.stringify(drawn.slice(-2)));
    // The host's own fire, once it has one, wins over the nearest land — and the smoke follows it as it burns.
    WD.W.fireAt = { x: land.x - 150, z: land.z + 60 };
    const spot = MW.fireSpot({ x: 3000, z: 0 });
    WD.W.fireAt = { x: -5000, z: -5000 };
    const far = MW.fireSpot({ x: 3000, z: 0 });
    WD.W.fireAt = null;
    ok('wildfire: where the fire really is — the host’s live fire when it has one near that land, else the nearest land',
      spot.host && spot.x === land.x - 150 && !far.host && far.x === land.x, `${JSON.stringify(spot)} · ${JSON.stringify(far)}`);
    const moved = WD.W.sights.moveSmoke(land.x - 150, land.z + 60);
    const noSea = WD.W.sights.moveSmoke(4000, 0);
    ok('wildfire: the smoke moves to where the host’s fire is, never onto the sea', moved && !noSea && MW.worldDebug().sights.smoke.x === land.x - 150);
    ok('wildfire: what the host says of its fire is numbers only, checked', MW.cleanFire({ x: 12.4, z: -3.6 }).x === 12 && MW.cleanFire({ x: 'a', z: 0 }) === null && MW.cleanFire(null) === null);
    WD.W.sights.clear();
    WD.W.sights.group = null;
  }
  ok('drive: where a thing is, as a child would say it — ahead, on your left, behind you', MW.whereFrom({ x: 0, z: 0 }, { x: 0, z: -1 }, 0, -2000).side === 'ahead'
    && MW.whereFrom({ x: 0, z: 0 }, { x: 0, z: -1 }, -500, 0).side === 'on your left' && MW.whereFrom({ x: 0, z: 0 }, { x: 0, z: -1 }, 0, 900).side === 'behind you');
  Object.assign(sim, { mode: 'free', vehicle: null, hud: { notify() {} } });
}

/* ---- Space: the brakes and the trigger (the reviewer's first finding) ------------------------ */
{
  const V = await import('../../src/vendor/three.module.js');
  const pvpExt = (await import('../../src/game/extensions.js')).extensions().find((e) => e.id === 'pvp');
  const keys = new Set();
  Object.assign(sim, {
    aircraft: { pos: new V.Vector3(0, 300, 0), quat: new V.Quaternion(), vel: new V.Vector3(), onGround: false },
    input: { keys }, hud: { notify() {}, setCoach() {} }, mode: 'free',
  });
  pvp.pvpDebug().P.sim = sim;
  mp.profile.pvp = true;
  ch.toHost('pvp:want', { on: true });
  later(3100);
  await sleep(250);
  later(1100);
  await sleep(150);
  const live = () => { const m = pvp.pvpDebug().me; return m && m.on && !m.arming && !m.down; };
  // On the runway: Space is the brakes — the game's input has it.
  sim.aircraft.onGround = true;
  const downOnGround = pvpExt.key(sim, 'Space', true);
  keys.add('Space');
  ok('space: PvP on, on the runway — Space is the brakes, as ever (the game’s input gets it)', live() && downOnGround === false);
  // Off the ground still holding it, and let go in the air: the release reaches the game's input.
  sim.aircraft.onGround = false;
  const upInAir = pvpExt.key(sim, 'Space', false);
  if (!upInAir) keys.delete('Space');
  ok('space: pressed on the runway, let go in the air — the release is NOT swallowed, so the brakes come off', upInAir === false && !keys.has('Space'));
  // Held from before (a press the input saw while tagged or arming), then a press that becomes the trigger.
  keys.add('Space');
  const downInAir = pvpExt.key(sim, 'Space', true);
  ok('space: a press in the air is the trigger — and the game’s input lets go of any Space it still held', downInAir === true && !keys.has('Space') && pvp.pvpDebug().P.fireKey === true);
  const upAgain = pvpExt.key(sim, 'Space', false);
  ok('space: its release goes to the game too, and the trigger lets go', upAgain === false && pvp.pvpDebug().P.fireKey === false);
  // In the van with PvP on: Space is the trigger; its release is never swallowed.
  Object.assign(sim, { mode: 'drive', vehicle: { pos: new V.Vector3(10, 2, 10), quat: new V.Quaternion(), vel: new V.Vector3(), spec: { kind: 'car' } } });
  keys.add('Space');
  const vanDown = pvpExt.key(sim, 'Space', true);
  const vanUp = pvpExt.key(sim, 'Space', false);
  ok('space: in the van, a press is the trigger (the handbrake it held is let go), and the release is never swallowed', vanDown === true && vanUp === false && !keys.has('Space'));
  Object.assign(sim, { mode: 'free', vehicle: null });
  mp.profile.pvp = false;
}

/* ---- FIRE on the screen (the reviewer's second finding) ------------------------------------- */
{
  // Measured in the game at these sizes with touch on (touch controls, the minimap, the top buttons, the instrument strip).
  const R = (l, t, r, b, touch = false) => ({ l, t, r, b, touch });
  const layouts = {
    'iPad 1024x768, aeroplane': [1024, 768, [R(14, 618, 150, 754, true), R(952, 590, 1010, 754, true), R(397, 700, 627, 746, true), R(800, 570, 942, 746, true), R(8, 8, 126, 126), R(858, 12, 1012, 58), R(206, 66, 1016, 115)]],
    'iPad 1024x768, van': [1024, 768, [R(746, 694, 888, 746, true), R(16, 658, 356, 750, true), R(898, 572, 1008, 750, true), R(8, 8, 126, 126), R(858, 12, 1012, 58), R(206, 66, 1016, 126)]],
    'iPad 1024x768, boat': [1024, 768, [R(14, 662, 222, 754, true), R(397, 700, 627, 746, true), R(692, 694, 888, 746, true), R(908, 488, 1004, 748, true), R(8, 8, 126, 126), R(858, 12, 1012, 58), R(206, 66, 1016, 113)]],
    'iPad 768x1024, aeroplane': [768, 1024, [R(14, 874, 150, 1010, true), R(696, 846, 754, 1010, true), R(269, 956, 499, 1002, true), R(544, 826, 686, 1002, true), R(8, 8, 126, 126), R(602, 12, 756, 58), R(206, 66, 760, 115)]],
    'iPad 768x1024, boat': [768, 1024, [R(14, 918, 222, 1010, true), R(269, 956, 499, 1002, true), R(436, 950, 632, 1002, true), R(652, 744, 748, 1004, true), R(8, 8, 126, 126), R(602, 12, 756, 58), R(206, 66, 760, 113)]],
    'phone 844x390, aeroplane': [844, 390, [R(14, 240, 150, 376, true), R(772, 194, 830, 368, true), R(307, 322, 537, 368, true), R(620, 196, 762, 368, true), R(8, 8, 126, 126), R(678, 12, 832, 58), R(206, 66, 836, 115)]],
  };
  const clash = (s, rects, size = pvp.FIRE_PX) => rects.filter((a) => s.x < a.r && s.x + size > a.l && s.y < a.b && s.y + size > a.t);
  const res = Object.entries(layouts).map(([name, [w, h, avoid]]) => {
    const s = pvp.fireSpot({ w, h, avoid, touch: true, mm: { l: 8, t: 8, r: 126, b: 126 } });
    const right = avoid.filter((a) => a.touch && (a.l + a.r) / 2 > w / 2);
    return { name, s, clash: clash(s, avoid).length, onScreen: s.x >= 8 && s.y >= 8 && s.x + pvp.FIRE_PX <= w - 8 && s.y + pvp.FIRE_PX <= h - 8, rightHalf: s.x >= w / 2, aboveThumb: s.y + pvp.FIRE_PX <= Math.min(...right.map((a) => a.t)) };
  });
  ok('fire: on a tablet or a phone, FIRE covers nothing — not the minimap, not one touch control, not the buttons or the instruments', res.every((x) => x.clash === 0 && x.onScreen), res.map((x) => `${x.name}: ${x.s.x},${x.s.y} (${x.s.how})`).join(' | '));
  ok('fire: on an iPad it is on the right, straight above the controls under the right thumb', res.filter((x) => /iPad/.test(x.name)).every((x) => x.rightHalf && x.aboveThumb && x.s.how === 'place'));
  const desk = pvp.fireSpot({ w: 1366, h: 768, avoid: [R(1166, 486, 1356, 676), R(1100, 16, 1350, 90)], touch: false, mm: { l: 1166, t: 486, r: 1356, b: 676 } });
  ok('fire: on a laptop it stays where it was — just left of the minimap, level with its middle', desk.x === 1166 - 88 - 14 && desk.y === Math.round(486 + 95 - 44), `${desk.x},${desk.y}`);
}

ch.detach();
mp.role = null;
mp.ready = false;
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('FAILED:', failed.map((f) => f.name).join('; '));
  process.exit(1);
}
process.exit(0);
