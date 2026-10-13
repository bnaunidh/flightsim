/**
 * The owner's toys — the troll menu, the disaster trolls, teleport and taking
 * aircraft over (src/features/owner/*.js) — in plain node, no browser:
 *
 *   node tests/features/owner.trolls.mjs
 *
 * Two halves. The RULES, as plain functions and classes: what may travel
 * (every validator), the per-target cooldown (TrollGate), the host's desk of
 * running disasters (one per target, three in the game), the duration words,
 * the lists (built from the game's own code: every disaster a player may arm,
 * the wildfire and the meteor shower), and the placing sums (feet, the map's
 * geometry backwards, "beside" somebody). Then the HOST ITSELF: this
 * process's multiplayer.events is made the host of a game with two players,
 * one the owner (the session's own isOwner says so — a fake session here,
 * with the shape the real one has), one not — and the real handlers do what
 * they do on a real host: the owner's troll reaches everybody, the other
 * player's reaches nobody, a second troll too soon is told to wait, a
 * disaster starts, is capped, replaced and stopped, a teleport is relayed.
 */
import { performance } from 'node:perf_hooks';

// What the features touch of the page when they are only loaded, not shown.
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
global.document = { createElement: el, body: el(), head: el(), getElementById: () => null, querySelectorAll: () => [], addEventListener() {} };
global.window = { innerWidth: 1280, innerHeight: 720, setInterval, clearInterval, addEventListener() {} };

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  return !!pass;
};
process.on('unhandledRejection', (err) => ok('no unhandled rejections', false, err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err));

const realNow = performance.now.bind(performance);
let skew = 0;
performance.now = () => realNow() + skew;
const later = (ms) => { skew += ms; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const P = await import('../../src/features/owner/place.js');
const C = await import('../../src/features/owner/common.js');
const T = await import('../../src/features/owner/trolls.js');
const D = await import('../../src/features/owner/disasters.js');
const TP = await import('../../src/features/owner/teleport.js');
const E = await import('../../src/features/multiplayer/events.js');
const { NATURAL_EVENTS } = await import('../../src/game/disasters.js');
await import('../../src/features/wildfire-disaster.js');

/* ============================================================ the lists */

{
  const ids = T.TROLLS.map((t) => t.id);
  const want = ['roll', 'yeet', 'tiny', 'giant', 'harrison', 'flip', 'wasted', 'pink', 'ducks', 'moon', 'bring', 'go', 'freeze'];
  ok('thirteen trolls, the brief’s list, each with a name, a picture, how long it lasts and a line about it',
    want.every((id) => ids.includes(id)) && new Set(ids).size === T.TROLLS.length
    && T.TROLLS.every((t) => t.name && t.icon && Number.isFinite(t.secs) && t.hint), ids.join(' '));
  const secs = Object.fromEntries(T.TROLLS.map((t) => [t.id, t.secs]));
  ok('the durations the owner asked for: tiny/giant 30 s, Harrison 30 s, upside-down 5 s, pink 60 s, moon 20 s, freeze 3 s',
    secs.tiny === 30 && secs.giant === 30 && secs.harrison === 30 && secs.flip === 5 && secs.pink === 60 && secs.moon === 20 && secs.freeze === 3, secs);
  const list = D.trollDisasters();
  const dids = list.map((d) => d.id);
  const armable = NATURAL_EVENTS.filter((e) => !e.hidden).map((e) => e.id);
  ok('the disaster list is the game’s own: every disaster a player may arm (disasters.js, the wildfire among them) plus the shared world’s meteor shower; the hidden eruption is not offered',
    armable.every((id) => dids.includes(id)) && dids.includes('wildfire') && dids.includes('meteors') && !dids.includes('eruption') && list.every((d) => d.name && d.icon),
    dids.join(' '));
  ok('the four that hunt the target are in the list: tornado, lightning, meteors, wildfire', D.HUNTERS.every((id) => dids.includes(id)) && D.HUNTERS.length === 4, D.HUNTERS.join(' '));
  ok('the duration words: 10 s, 30 s, 1 min, 1 min 30 s, 10 min, and 0 is “until I stop it”',
    D.secsLabel(10) === '10 s' && D.secsLabel(30) === '30 s' && D.secsLabel(60) === '1 min' && D.secsLabel(90) === '1 min 30 s' && D.secsLabel(600) === '10 min' && D.secsLabel(0) === 'until I stop it');
  ok('the presets run from 10 s to “until I stop it”, and the slider from 10 s to 10 min', D.PRESETS[0] === 10 && D.PRESETS[D.PRESETS.length - 1] === 0 && D.MIN_S === 10 && D.MAX_S === 600);
}

/* ============================================================ what may travel */

{
  const bad = [null, 7, 'x', {}, { k: 'roll', t: 1 }, { k: 0, t: 8 }, { k: -1, t: 1 }, { k: T.TROLLS.length, t: 1 }, { k: 1.5, t: 1 }, { k: 0, t: '1' }];
  ok('a troll on the wire is two small numbers: k (which) and t (whom) — anything else is dropped',
    JSON.stringify(T.cleanTroll({ k: 8, t: 2, extra: 'no' })) === '{"k":8,"t":2}' && bad.every((d) => T.cleanTroll(d) === null));
  ok('what the host relays carries `by`, and never a player trolling themselves',
    JSON.stringify(T.cleanTrolled({ k: 8, t: 2, by: 1 })) === '{"k":8,"t":2,"by":1}' && T.cleanTrolled({ k: 8, t: 2, by: 2 }) === null && T.cleanTrolled({ k: 8, t: 2 }) === null);
  ok('“not yet” is seconds (1-60) and which line (0-2)', JSON.stringify(C.cleanWait({ s: 4, w: 1 })) === '{"s":4,"w":1}' && C.cleanWait({ s: 0, w: 0 }) === null && C.cleanWait({ s: 61, w: 0 }) === null && C.cleanWait({ s: 4, w: 9 }) === null);
  ok('a disaster ask: a disaster id from the game’s list, whom, and 0 or 10-600 seconds',
    JSON.stringify(D.cleanAsk({ id: 'tornado', t: 1, s: 0 })) === '{"id":"tornado","t":1,"s":0}' && D.cleanAsk({ id: 'meteors', t: 0, s: 600 }) !== null
    && D.cleanAsk({ id: 'tornado', t: 1, s: 5 }) === null && D.cleanAsk({ id: 'tornado', t: 1, s: 601 }) === null && D.cleanAsk({ id: 'eruption', t: 1, s: 30 }) === null
    && D.cleanAsk({ id: 'nope', t: 1, s: 30 }) === null && D.cleanAsk({ id: 'tornado', t: 9, s: 30 }) === null && D.cleanAsk({ id: 'tornado', t: 1, s: 30.5 }) === null);
  ok('the host’s word on one running carries who and a number', D.cleanGo({ id: 'tornado', t: 1, s: 30, by: 2, n: 4 }) !== null && D.cleanGo({ id: 'tornado', t: 1, s: 30, by: 2, n: 0 }) === null && D.cleanGo({ id: 'tornado', t: 1, s: 30, n: 4 }) === null);
  ok('STOP NOW is a number (0: all of mine); the host’s “over” is a number too', JSON.stringify(D.cleanStop({ n: 0 })) === '{"n":0}' && D.cleanStop({ n: -1 }) === null && D.cleanEnd({ n: 0 }) === null && D.cleanEnd({ n: 3 }) !== null);
  const at0 = D.cleanAt({ n: 2, k: 0, x: 1234.6, z: -99.2 });
  const at2 = D.cleanAt({ n: 2, k: 2, x: 10, y: 400, z: 20, a: 90, dv: 40, v: 220, T: 6 });
  ok('the hunt: a tornado’s place is metres; a meteor carries its aim, way, dive, speed and time; a strike or a fire is a place',
    JSON.stringify(at0) === '{"n":2,"k":0,"x":1235,"z":-99}' && at2 && at2.y === 400 && at2.T === 6 && D.cleanAt({ n: 2, k: 2, x: 10, z: 20 }) === null
    && D.cleanAt({ n: 2, k: 4, x: 1, z: 1 }) === null && D.cleanAt({ n: 2, k: 1, x: 3e5, z: 1 }) === null && D.cleanAt({ n: 2, k: 2, x: 10, y: 400, z: 20, a: 90, dv: 40, v: 10, T: 6 }) === null);
  ok('a teleport for somebody: whom and where, the height never below the ground', JSON.stringify(TP.cleanTp({ t: 3, x: 1.4, y: 300.6, z: -2 })) === '{"t":3,"x":1,"y":301,"z":-2}' && TP.cleanTp({ t: 3, x: 1, y: -5, z: 2 }) === null && TP.cleanTp({ t: 8, x: 1, y: 5, z: 2 }) === null);
  ok('taking the host’s aeroplane over names it by its traffic number (0-999)', TP.cleanTake({ id: 7 }) !== null && TP.cleanTake({ id: 1000 }) === null && TP.cleanTook({ id: 7, by: 1 }) !== null && TP.cleanTook({ id: 7 }) === null);
}

/* ============================================================ the gate and the desk */

{
  let t = 1000;
  const g = new T.TrollGate(() => t, 6000);
  const a = g.ask(3);
  const b = g.ask(3);
  const c = g.ask(4);
  t += 5999;
  const d = g.ask(3);
  t += 1;
  const e = g.ask(3);
  ok('the cooldown is per target: a second troll on the same player inside six seconds waits (the time left, exactly); another player is fine at once; after six seconds, fine',
    a.ok && !b.ok && b.waitMs === 6000 && c.ok && !d.ok && d.waitMs === 1 && e.ok, { a, b, c, d, e });
}
{
  let t = 0;
  const desk = new D.DisasterDesk(() => t, { cap: 3 });
  const r1 = desk.ask({ id: 'tornado', t: 2, s: 30, by: 1 });
  const r2 = desk.ask({ id: 'lightning', t: 0, s: 0, by: 1 });
  const r3 = desk.ask({ id: 'meteors', t: 3, s: 60, by: 1 });
  const r4 = desk.ask({ id: 'wildfire', t: 4, s: 60, by: 1 });
  const r5 = desk.ask({ id: 'wildfire', t: 2, s: 20, by: 1 });
  ok('the desk: three disasters in the game at once; a fourth on a new target is refused; a new one on a target that has one REPLACES it (one per target)',
    r1.ok && r2.ok && r3.ok && !r4.ok && r4.why === 'cap' && r5.ok && r5.replaced === r1.n && desk.running.size === 3 && desk.onTarget(2).id === 'wildfire', { r4, r5, size: desk.running.size });
  ok('“until I stop it” runs an hour on the desk if nobody does; 20 s runs 20 s', desk.running.get(r2.n).until === D.UNTIL_STOPPED_S * 1000 && desk.running.get(r5.n).until === 20000);
  t = 20000;
  const due = desk.due();
  ok('on time: the 20 s one is due at 20 s and no other', due.length === 1 && due[0] === r5.n && desk.running.size === 2, due);
  const stopped = desk.stop(r3.n, 1);
  const all = desk.stop(0, 1);
  ok('STOP NOW ends the one named; STOP ALL (0) ends every one this owner started', stopped.length === 1 && stopped[0] === r3.n && all.length === 1 && all[0] === r2.n && desk.running.size === 0, { stopped, all });
}

/* ============================================================ placing */

{
  ok('the altitude picker clamps to whole hundreds of feet between the ground and 50,000', P.clampAltFt(-5) === 0 && P.clampAltFt(50049) === 50000 && P.clampAltFt(99999) === 50000 && P.clampAltFt(1234) === 1200 && P.clampAltFt('x') === 0 && P.MAX_ALT_FT === 50000);
  const low = P.saneSpeed(0, 0);
  const top = P.saneSpeed(P.ftToM(50000), 0);
  const kept = P.saneSpeed(100, 90);
  ok('a sane arriving speed: 60 m/s low down, 150 m/s at 50,000 ft (thin air), never slower than it was going', low === 60 && Math.abs(top - 150) < 1e-9 && kept === 90, { low, top, kept });
  const g = { cx: 95, cy: 95, k: 190 / 4000, craft: { x: 1200, z: -300 } };
  const m = P.clientToMap(g, 130 / 2, 130 / 2, 130, 130); // a tap at the middle of a 130 px map
  const w = P.mapToWorld(g, m.px, m.py);
  const edge = P.mapToWorld(g, 190, 95);
  ok('a tap on the map comes back as the place it shows: the middle is the craft; the right edge is half the span east',
    Math.abs(w.x - 1200) < 1e-9 && Math.abs(w.z - (-300)) < 1e-9 && Math.abs(edge.x - 3200) < 1e-9 && Math.abs(edge.z - (-300)) < 1e-9 && P.mapToWorld(null, 0, 0) === null, { w, edge });
  const n = P.headingVec(0);
  const e = P.headingVec(90);
  const beside = P.besideOf({ x: 0, y: 500, z: 0 }, 0, 70, 25);
  ok('north is -Z, east is +X; “beside” somebody heading north is 70 m south of them (behind) and 25 m to one side, at their height',
    Math.abs(n.z + 1) < 1e-9 && Math.abs(e.x - 1) < 1e-9 && Math.abs(beside.z - 70) < 1e-9 && Math.abs(Math.abs(beside.x) - 25) < 1e-9 && beside.y === 500, beside);
}

/* ============================================================ the host itself */

const { multiplayer: mp } = await import('../../src/features/multiplayer.js');
const ch = mp.events;
const NAMES = { 0: 'Swift Falcon', 1: 'Brave Otter', 2: 'Sunny Puffin' };
const COLS = { 0: '#ff5a4f', 1: '#4fd684', 2: '#58c6ff' };
const whoIs = (id) => ({ id, name: NAMES[id], colour: COLS[id], host: id === 0 });
const players = {};
const heard = { 1: [], 2: [] };
for (const id of [1, 2]) {
  const ev = new E.GameEvents({ now: () => performance.now() });
  for (const [k, def] of ch.kinds) ev.kinds.set(k, def);
  players[id] = ev;
}
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
  const orig = players[id]._deliver.bind(players[id]);
  players[id]._deliver = (kind, data, from, meta) => {
    heard[id].push({ kind, data, from: from && from.id });
    return orig(kind, data, from, meta);
  };
}
const pos = { 0: { x: 0, y: 300, z: 0 }, 1: { x: 0, y: 300, z: -150 }, 2: { x: 60, y: 300, z: -150 } };
ch.roster = () => [0, 1, 2].map((id) => ({
  id, name: NAMES[id], colour: COLS[id], host: id === 0, me: id === 0, owner: id === 1, admin: false, ride: { game: 'flight', type: 'skylark' },
  pos: pos[id], quat: { x: 0, y: 0, z: 0, w: 1 }, vel: { x: 0, y: 0, z: 0 }, visible: true, ghost: false, pvp: false, radius: 6,
}));
for (const id of [1, 2]) players[id].roster = ch.roster;
// The session's own answer to "is this player the owner?" — the shape HostSession has (isOwner checks the pass; here player 1 holds one).
mp.host = { me: { id: 0, name: NAMES[0] }, players: new Map([[1, { id: 1, name: NAMES[1] }], [2, { id: 2, name: NAMES[2] }]]), isOwner: (p) => !!p && p.id === 1 };
mp.profile = { name: NAMES[0], colour: COLS[0], pvp: false, key: 'k', chosen: true };
mp.role = 'host';
mp.ready = true;
mp.meId = 0;
ch.attach(hostSession, 'host', 0);
for (const id of [1, 2]) ch.joined(whoIs(id));
await sleep(20);
const TD = T.trollsDebug();
const DD = D.disastersDebug();
const of = (id, kind) => heard[id].filter((h) => h.kind === kind);

{
  ok('the host knows who the owner is from its own session, not from anybody’s say-so', C.hostOwner(1) && !C.hostOwner(2) && !C.hostOwner(0) && !C.hostOwner(5));
  const k = T.trollIndex('ducks');
  players[2].toHost('owner:troll', { k, t: 1 });
  await sleep(20);
  ok('a player who is not the owner asks for a troll: the host does nothing — nobody hears a thing', TD.stats.refused === 1 && TD.stats.sent === 0 && !of(1, 'owner:trolled').length && !of(2, 'owner:trolled').length);
  players[1].toHost('owner:troll', { k, t: 2 });
  await sleep(20);
  const got1 = of(1, 'owner:trolled');
  const got2 = of(2, 'owner:trolled');
  ok('the owner’s “Duck rain on Sunny Puffin” reaches everybody, stamped with who did it (the host is player 0 and saw it too)',
    got1.length === 1 && got2.length === 1 && got2[0].data.k === k && got2[0].data.t === 2 && got2[0].data.by === 1 && got2[0].from === 0 && TD.stats.sent === 1 && TD.stats.in === 1, got2[0]);
  players[1].toHost('owner:troll', { k: T.trollIndex('pink'), t: 2 });
  await sleep(20);
  const wait = of(1, 'owner:wait');
  ok('a second troll on the same player inside six seconds: the owner alone is told “give them a moment” (the right line, the seconds left); nobody else hears anything',
    wait.length === 1 && wait[0].data.w === 0 && wait[0].data.s >= 1 && wait[0].data.s <= 6 && of(2, 'owner:trolled').length === 1 && !of(2, 'owner:wait').length && TD.stats.waits === 1, wait[0] && wait[0].data);
  later(6100);
  players[1].toHost('owner:troll', { k: T.trollIndex('pink'), t: 2 });
  await sleep(20);
  ok('six seconds later the same player can be trolled again', of(2, 'owner:trolled').length === 2 && of(2, 'owner:trolled')[1].data.k === T.trollIndex('pink'));
  players[1].toHost('owner:troll', { k, t: 0 });
  await sleep(20);
  ok('the host is a player too: the owner can troll the host', of(2, 'owner:trolled').some((h) => h.data.t === 0) && TD.stats.sent === 3);
  players[1].toHost('owner:troll', { k, t: 1 });
  players[1].toHost('owner:troll', { k, t: 6 });
  await sleep(20);
  ok('trolling yourself, or somebody who is not here: nothing', TD.stats.refused === 3 && TD.stats.sent === 3);
  const before = of(2, 'owner:trolled').length;
  players[1].sendGame = null;
  players[1].session.sendGame({ k: 'owner:trolled', d: { k, t: 2, by: 1 } });
  await sleep(20);
  ok('a player sending the host’s word (“trolled”) straight to the host: dropped — only the host says it', of(2, 'owner:trolled').length === before && ch.dropped.some((d) => /owner:trolled/.test(d)), ch.dropped.slice(-1));
}

{
  heard[1].length = heard[2].length = 0;
  players[2].toHost('owner:dis', { id: 'tornado', t: 1, s: 30 });
  await sleep(20);
  ok('a disaster asked for by somebody who is not the owner: refused, nothing starts', DD.stats.refused === 1 && !of(1, 'owner:disgo').length && DD.desk.running.size === 0);
  players[1].toHost('owner:dis', { id: 'tornado', t: 2, s: 30 });
  await sleep(20);
  const go = of(2, 'owner:disgo');
  ok('the owner’s “tornado after Sunny Puffin, 30 s”: the host starts it for everybody, numbered, saying who sent it',
    go.length === 1 && go[0].data.id === 'tornado' && go[0].data.t === 2 && go[0].data.s === 30 && go[0].data.by === 1 && go[0].data.n >= 1 && of(1, 'owner:disgo').length === 1 && DD.desk.running.size === 1 && DD.stats.started === 1, go[0] && go[0].data);
  const n1 = go[0].data.n;
  // A second later each, as a finger does it (the channel's own rate limit is two a second).
  later(1100);
  players[1].toHost('owner:dis', { id: 'lightning', t: 0, s: 0 });
  later(1100);
  players[1].toHost('owner:dis', { id: 'meteors', t: 1, s: 60 });
  await sleep(20);
  ok('one on the host, one on the owner too (“until I stop it”, 60 s): three run — the cap', DD.desk.running.size === 3 && of(2, 'owner:disgo').length === 3);
  heard[1].length = 0;
  later(1100);
  players[1].toHost('owner:dis', { id: 'wildfire', t: 2, s: 60 });
  await sleep(20);
  const end1 = of(2, 'owner:disend').find((h) => h.data.n === n1);
  const go2 = of(2, 'owner:disgo').filter((h) => h.data.id === 'wildfire');
  ok('a new disaster on a player who already has one replaces it: everybody hears the old one end and the new one start; still three',
    !!end1 && go2.length === 1 && go2[0].data.t === 2 && DD.desk.running.size === 3 && DD.desk.onTarget(2).id === 'wildfire', { end1: !!end1, n: go2[0] && go2[0].data.n });
  const n2 = go2.length ? go2[0].data.n : -1;
  later(1100);
  players[1].toHost('owner:disstop', { n: n2 });
  await sleep(20);
  ok('STOP NOW: the host ends that one for everybody at once', of(2, 'owner:disend').some((h) => h.data.n === n2) && DD.desk.running.size === 2 && DD.stats.stopped === 1);
  later(1100);
  players[2].toHost('owner:disstop', { n: 0 });
  await sleep(20);
  ok('STOP ALL from somebody who is not the owner: nothing', DD.desk.running.size === 2);
  later(1100);
  players[1].toHost('owner:disstop', { n: 0 });
  await sleep(20);
  ok('STOP ALL from the owner: every one ends', DD.desk.running.size === 0 && of(2, 'owner:disend').length >= 4);
  // A timed one runs out on the host's clock: the host's tick (through its game) says so; here, the desk's own due().
  later(1100);
  players[1].toHost('owner:dis', { id: 'tornado', t: 2, s: 10 });
  await sleep(20);
  later(10100);
  const due = DD.desk.due();
  ok('a 10 s disaster is due on the host’s clock ten seconds later', due.length === 1 && DD.desk.running.size === 0, due);
}

{
  heard[1].length = heard[2].length = 0;
  players[2].toHost('owner:tp', { t: 1, x: 100, y: 500, z: 200 });
  await sleep(20);
  ok('a teleport asked for by somebody who is not the owner: refused', !of(1, 'owner:tpgo').length);
  players[1].toHost('owner:tp', { t: 2, x: 100, y: 500, z: 200 });
  await sleep(20);
  const tp = of(2, 'owner:tpgo');
  ok('the owner’s “teleport Sunny Puffin there, 500 m up” is relayed to everybody with who asked — the target’s copy places them',
    tp.length === 1 && tp[0].data.t === 2 && tp[0].data.x === 100 && tp[0].data.y === 500 && tp[0].data.by === 1 && of(1, 'owner:tpgo').length === 1, tp[0] && tp[0].data);
  players[1].toHost('owner:tp', { t: 7, x: 100, y: 500, z: 200 });
  await sleep(20);
  ok('…and for somebody who is not here, nothing', of(2, 'owner:tpgo').length === 1);
}

{
  // The owner's own copy, not in a game: nothing goes anywhere.
  mp.role = null;
  const sentNo = T.sendTroll(0, 2);
  const disNo = D.sendDisaster('tornado', 2, 30);
  mp.role = 'host';
  ok('out of a game, the owner’s menu sends nothing', sentNo === false && disNo === false);
}

/* ============================================================ on the target's own screen: two trolls whose effect runs on the game's clock */

{
  /*
   * The fake WASTED screen counts the frames' dt (wasted.js: 3.7 s of them);
   * the troll counts the wall clock (4 s). A laptop drawing slowly gives
   * fewer frame-seconds than wall-seconds, so the troll's end takes the
   * screen down itself — and leaves a screen of another cause alone.
   */
  const THREE = await import('../../src/vendor/three.module.js');
  const { wasted, endWasted, showWasted } = await import('../../src/features/wasted.js');
  const { extensions } = await import('../../src/game/extensions.js');
  const { DuckShower, DUCK_BURST, DUCKS_PER_SECOND } = await import('../../src/features/owner/fx.js');
  const TD = T.trollsDebug();
  const ext = extensions().find((e) => e.id === 'owner-trolls');
  const fakeSim = {
    state: 'flying', mode: 'free', model: null, cockpit: null, input: null, weather: {},
    aircraft: { pos: new THREE.Vector3(0, 300, 0), vel: new THREE.Vector3(60, 0, 0), quat: new THREE.Quaternion(), onGround: false, crashed: false, parkingBrake: false },
    renderer: { domElement: { style: {} } },
  };
  TD.A.sim = fakeSim;
  mp.meId = 0;
  TD.arrive({ id: 'wasted', t: 0, by: 1 });
  const up = wasted.active && wasted.cause === T.WASTED_CAUSE && TD.mine().includes('wasted');
  // Not one frame of the game's clock has gone by, and the troll's four seconds are up on the wall's.
  later(4100);
  ext.update(fakeSim, 0.016);
  const down = !wasted.active && !TD.mine().includes('wasted');
  ok('fake WASTED: the screen is up with the troll, in the troll’s name; four wall-clock seconds later the troll is over and takes the screen down with it, whatever the game’s clock says', up && down, { up, down, cause: wasted.cause });
  // A real knock's screen (another cause) is not the troll's to end.
  showWasted(fakeSim, 'plane', { words: 'Knocked down.' });
  TD.arrive({ id: 'wasted', t: 0, by: 1 });
  const left = wasted.active && wasted.cause === 'plane';
  later(4100);
  ext.update(fakeSim, 0.016);
  ok('…but a WASTED of another cause (a real knock) that was already up is left alone when the troll ends', left && wasted.active && wasted.cause === 'plane' && !TD.mine().includes('wasted'));
  endWasted(fakeSim);
  TD.endAll();
  TD.A.sim = null;

  // Duck rain: a handful at once, then six a second — seen the moment it arrives, however slowly the frames come.
  const group = new THREE.Group();
  const shower = new DuckShower(group);
  shower.start(() => ({ x: 0, y: 300, z: 0 }));
  shower.update(1 / 60);
  const burst = shower.dropped;
  shower.update(1);
  const afterSecond = shower.dropped;
  shower.stop();
  const stopped = !shower.on && !shower.idle;
  for (let i = 0; i < 20; i++) shower.update(0.5);
  ok('duck rain: the first frame drops a handful together, then six a second; stopped, the last ducks land and it falls idle',
    burst === DUCK_BURST && afterSecond === DUCK_BURST + DUCKS_PER_SECOND && stopped && shower.idle, { burst, afterSecond, stopped, idle: shower.idle });

  /*
   * The map takes taps only in owner mode: styles/main.css gives .minimap
   * pointer-events: none (a tap on it goes through to the game), so the
   * owner's tools make it take them while they are on, and give it back.
   */
  const map = { el: { style: {} } };
  const withMap = { minimap: map };
  const tookOn = TP.mapTakesTaps(withMap, true);
  const onStyle = { pe: map.el.style.pointerEvents, cursor: map.el.style.cursor };
  TP.mapTakesTaps(withMap, false);
  const offStyle = { pe: map.el.style.pointerEvents, cursor: map.el.style.cursor };
  ok('the minimap takes taps only while the owner’s tools are on: pointer events on (a crosshair) then, and back to the stylesheet’s after; a game without a map is fine',
    tookOn === true && onStyle.pe === 'auto' && onStyle.cursor === 'crosshair' && offStyle.pe === '' && offStyle.cursor === '' && TP.mapTakesTaps({}, true) === false && TP.mapTakesTaps(null, false) === false, { onStyle, offStyle });

  /*
   * Take over, from the sky's list (features/sky.js): a story's airliner is a
   * body there, not a traffic entry. It is offered with the traffic, and taking
   * it puts the owner in its seat where it was, on its heading, at its speed —
   * and it is gone from the world (out of the list, no longer drawn). A drone
   * (small), a body already in the traffic, and one without a type are not
   * offered.
   */
  const { registerBody, unregisterBody, bodies } = await import('../../src/features/sky.js');
  const { getAircraft } = await import('../../src/aircraft/types.js');
  const flown = [];
  const seat = {
    state: 'flying', mode: 'free', aircraftType: getAircraft('skylark'), hud: null, traffic: [], minimap: null, rig: null,
    aircraft: { pos: new THREE.Vector3(0, 400, 0), vel: new THREE.Vector3(60, 0, 0), quat: new THREE.Quaternion(), onGround: false, crashed: false, parkingBrake: false, controls: { throttle: 0 },
      reset(o) { flown.push(o); this.pos.set(o.pos.x, o.pos.y, o.pos.z); } },
    setAircraft(id) { this.aircraftType = getAircraft(id); },
  };
  const airlinerModel = { visible: true };
  const airliner = registerBody({ id: 'npc-story-airliner', kind: 'npc', name: 'the airliner', typeId: 'meridian', pos: new THREE.Vector3(1500, 2500, -800), vel: new THREE.Vector3(0, 0, -120), heading: 0, onGround: false, model: airlinerModel });
  const drone = registerBody({ id: 'drone-1', kind: 'enemy', name: 'a drone', small: true, typeId: 'skylark', pos: new THREE.Vector3(300, 500, 0) });
  const typeless = registerBody({ id: 'balloon-1', kind: 'npc', name: 'a balloon', pos: new THREE.Vector3(200, 500, 0) });
  // The traffic registers its published entries in the same list: a sim.traffic row and its body are one aeroplane, listed once.
  const trafficRow = { id: 'traffic-7', typeId: 'skylark', pos: { x: 900, y: 300, z: 0 }, heading: 90, speed: 50, vs: 0, onGround: false };
  registerBody(trafficRow);
  seat.traffic = [trafficRow];
  const TPD = TP.teleportDebug();
  TPD.T.sim = seat;
  const offered = TPD.candidates();
  const row = offered.find((c) => c.src === 'sky');
  ok('take over: the story’s airliner from the sky’s list is offered with the traffic, once each; the drone, the balloon and the traffic’s own body are not offered twice or at all',
    offered.length === 2 && !!row && row.id === 'npc-story-airliner' && row.type === 'meridian' && row.name === 'the airliner' && Math.round(row.speed) === 120 && row.heading === 0 && !row.onGround
    && offered.filter((c) => c.id === 'traffic-7').length === 1 && !offered.some((c) => c.id === 'drone-1' || c.id === 'balloon-1'),
    offered.map((c) => `${c.src}:${c.id}`));
  const took = await TPD.takeOver(row);
  ok('…taking it: the owner is in its seat — its type, where it was, on its heading, at its speed — and the airliner is gone from the world: off the sky’s list, not drawn',
    !!took && !took.restarted && !took.ground && seat.aircraftType.id === 'meridian' && flown.length === 1 && Math.round(flown[0].pos.x) === 1500 && Math.round(flown[0].pos.z) === -800 && flown[0].headingDeg === 0 && flown[0].speed >= 120
    && airliner.gone === true && airlinerModel.visible === false && !bodies().includes(airliner) && TPD.stats.taken >= 1, { took, flown: flown[0] });
  // A body whose owner gives it up its own way (take()) is asked, not just hidden.
  let given = 0;
  const heli = registerBody({ id: 'ambient-heli-1', kind: 'npc', name: 'the helicopter', typeId: 'skylark', rotor: true, pos: new THREE.Vector3(0, 300, 600), vel: new THREE.Vector3(30, 0, 0), heading: 90, take() { given++; } });
  const heliRow = TPD.candidates().find((c) => c.id === 'ambient-heli-1');
  await TPD.takeOver(heliRow);
  ok('…an aircraft whose owner can give it up (take()) is asked to, and is gone from the list', given === 1 && heli.gone === true && !bodies().includes(heli));
  for (const b of [drone, typeless, trafficRow]) if (b) unregisterBody(b);
  TPD.T.sim = null;

  // Off the terrain's edge the heightfield says NaN: the ground there is the sea, so a teleport to 50,000 ft out there stays in the air.
  const edge = P.groundAt(1500, -800);
  const home = P.groundAt(0, 0);
  const far = P.placeAircraft(seat, { x: 1500, z: -800, y: P.ftToM(50000), headingDeg: 90, speed: 80 });
  ok('the ground off the terrain’s edge is the sea (0 m, never NaN), and a teleport to 50,000 ft out there arrives in the air at 150 m/s, not on the ground',
    edge === 0 && Number.isFinite(home) && home >= 0 && !!far && !far.ground && Math.round(P.mToFt(far.y)) === 50000 && far.speed === 150, { edge, home, far });
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  for (const f of failed) console.log(`  FAILED: ${f.name}`);
  process.exit(1);
}
process.exit(0);
