/**
 * "troll thing for admin" — the owner's toys (the troll menu, the disaster
 * trolls, teleport; src/features/owner/*.js) given to ADMINS, in plain node:
 *
 *   node tests/features/admin.trolls.mjs
 *
 * The rule, from the owner: an admin gets every troll, the disaster trolls and
 * teleport, with the same cooldowns and wear-off; an admin can NEVER troll the
 * owner; only the owner trolls admins; taking an aircraft over stays the
 * owner's; and the HOST judges who is who, so a plain client cannot spoof an
 * admin. The checkers' blockers: "an admin can't troll", "an admin can troll
 * the owner", "a plain player can troll".
 *
 * This process's multiplayer.events is made the HOST of a game with five
 * players — 0 the host (a plain player), 1 the owner, 2 and 3 admins, 4 a plain
 * player — against a fake session with the shape the real one has: isOwner
 * (the pass, checked) and p.admin === true (the key's signature, checked).
 * The real handlers then do what they do on a real host. Roles are read off the
 * session, never off anything a player sent; the codes and keys are not here.
 */
import { performance } from 'node:perf_hooks';

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

const C = await import('../../src/features/owner/common.js');
const T = await import('../../src/features/owner/trolls.js');
const D = await import('../../src/features/owner/disasters.js');
const TP = await import('../../src/features/owner/teleport.js');
const E = await import('../../src/features/multiplayer/events.js');
await import('../../src/features/wildfire-disaster.js');

/* ============================================================ the rule, as a function */

{
  const roles = ['owner', 'admin', 'player'];
  const want = {
    'owner>owner': false, 'owner>admin': true, 'owner>player': true,
    'admin>owner': false, 'admin>admin': false, 'admin>player': true,
    'player>owner': false, 'player>admin': false, 'player>player': false,
  };
  const got = {};
  for (const a of roles) for (const b of roles) got[`${a}>${b}`] = C.mayTroll(a, b);
  ok('who may troll whom: the owner trolls admins and players, never an owner; an admin trolls plain players only (never the owner, never another admin); a plain player trolls nobody',
    JSON.stringify(got) === JSON.stringify(want), got);
  ok('…and nobody who is not in the game, or a role that is not one, either way round',
    !C.mayTroll(null, 'player') && !C.mayTroll('owner', null) && !C.mayTroll('admin', undefined) && !C.mayTroll('god', 'player') && !C.mayTroll('owner', 'god') && !C.mayTroll('toString', 'player'));
  ok('the ranks are player < admin < owner', C.ROLE_RANK.player < C.ROLE_RANK.admin && C.ROLE_RANK.admin < C.ROLE_RANK.owner);
}

/* ============================================================ the host's game */

const { multiplayer: mp } = await import('../../src/features/multiplayer.js');
const ch = mp.events;
const IDS = [1, 2, 3, 4];
const NAMES = { 0: 'Swift Falcon', 1: 'Brave Otter', 2: 'Sunny Puffin', 3: 'Calm Heron', 4: 'Quick Newt' };
const COLS = { 0: '#ff5a4f', 1: '#4fd684', 2: '#58c6ff', 3: '#ffd23f', 4: '#c58bff' };
// The roles the fake SESSION holds — the thing the host reads. (Changed below to test a host that is itself an admin.)
const ROLE = { 0: 'player', 1: 'owner', 2: 'admin', 3: 'admin', 4: 'player' };
const whoIs = (id) => ({ id, name: NAMES[id], colour: COLS[id], host: id === 0 });
const players = {};
const heard = Object.fromEntries([0, ...IDS].map((i) => [i, []]));
for (const id of IDS) {
  const ev = new E.GameEvents({ now: () => performance.now() });
  for (const [k, def] of ch.kinds) ev.kinds.set(k, def);
  players[id] = ev;
}
const hostSession = {
  sendGame(msg, except) {
    for (const id of IDS) if (id !== except) players[id].fromWire(whoIs(msg.f), { k: msg.k, d: msg.d });
    return true;
  },
  sendGameTo(id, msg) {
    players[id].fromWire(whoIs(msg.f), { k: msg.k, d: msg.d });
    return true;
  },
  sendGameState(msg) {
    for (const id of IDS) players[id].stateFromWire(msg);
  },
  sendGameStateTo(id, msg) {
    players[id].stateFromWire(msg);
  },
};
for (const id of IDS) {
  players[id].attach({ sendGame: (msg) => { ch.fromWire(whoIs(id), msg); return true; } }, 'client', id);
  const orig = players[id]._deliver.bind(players[id]);
  players[id]._deliver = (kind, data, from, meta) => {
    heard[id].push({ kind, data, from: from && from.id });
    return orig(kind, data, from, meta);
  };
}
const pos = { 0: { x: 0, y: 300, z: 0 }, 1: { x: 0, y: 300, z: -150 }, 2: { x: 60, y: 300, z: -150 }, 3: { x: 120, y: 300, z: -150 }, 4: { x: 180, y: 300, z: -150 } };
ch.roster = () => [0, 1, 2, 3, 4].map((id) => ({
  id, name: NAMES[id], colour: COLS[id], host: id === 0, me: id === 0, owner: ROLE[id] === 'owner', admin: ROLE[id] === 'owner' || ROLE[id] === 'admin', ride: { game: 'flight', type: 'skylark' },
  pos: pos[id], quat: { x: 0, y: 0, z: 0, w: 1 }, vel: { x: 0, y: 0, z: 0 }, visible: true, ghost: false, pvp: false, radius: 6,
}));
for (const id of IDS) players[id].roster = ch.roster;
// Just the shape session.js has: isOwner(p) is the checked pass, p.admin === true the checked key. Read live, so a test can change a role.
const sessionPlayer = (id) => ({ id, name: NAMES[id], get admin() { return ROLE[id] === 'admin'; } });
mp.host = {
  get me() { return sessionPlayer(0); },
  players: new Map(IDS.map((id) => [id, sessionPlayer(id)])),
  isOwner: (p) => !!p && ROLE[p.id] === 'owner',
};
mp.profile = { name: NAMES[0], colour: COLS[0], pvp: false, key: 'k', chosen: true };
mp.role = 'host';
mp.ready = true;
mp.meId = 0;
ch.attach(hostSession, 'host', 0);
{
  // The host's own tab hears too (it is player 0).
  const orig = ch._deliver.bind(ch);
  ch._deliver = (kind, data, from, meta) => {
    heard[0].push({ kind, data, from: from && from.id });
    return orig(kind, data, from, meta);
  };
}
for (const id of IDS) ch.joined(whoIs(id));
await sleep(20);
const TD = T.trollsDebug();
const DD = D.disastersDebug();
const TPD = TP.teleportDebug();
const of = (id, kind) => heard[id].filter((h) => h.kind === kind);
const clear = () => { for (const id of [0, ...IDS]) heard[id].length = 0; };
const ask = async (from, kind, data) => { players[from].toHost(kind, data); await sleep(15); };

{
  ok('the host reads each role off its own session: the owner is the owner, the two admins admins, the host and the other player plain; nobody else is anything',
    C.hostRole(1) === 'owner' && C.hostRole(2) === 'admin' && C.hostRole(3) === 'admin' && C.hostRole(0) === 'player' && C.hostRole(4) === 'player' && C.hostRole(7) === null,
    [0, 1, 2, 3, 4, 7].map((i) => `${i}:${C.hostRole(i)}`).join(' '));
  ok('hostMayTroll applies the rule to those readings', C.hostMayTroll(2, 4) && C.hostMayTroll(2, 0) && !C.hostMayTroll(2, 1) && !C.hostMayTroll(2, 3) && C.hostMayTroll(1, 2) && C.hostMayTroll(1, 4)
    && !C.hostMayTroll(4, 2) && !C.hostMayTroll(4, 1) && !C.hostMayTroll(3, 2) && !C.hostMayTroll(2, 9));
  // An owner who is also an admin is an owner (the bigger name), whichever flag the session holds.
  ROLE[2] = 'owner';
  const both = C.hostRole(2);
  ROLE[2] = 'admin';
  ok('a player the session calls the owner is the owner, even with an admin key as well', both === 'owner' && C.hostRole(2) === 'admin');
}

/* ============================================================ trolls */

{
  clear();
  const duck = T.trollIndex('ducks');
  await ask(4, 'owner:troll', { k: duck, t: 2 });
  await ask(4, 'owner:troll', { k: duck, t: 0 });
  await ask(4, 'owner:troll', { k: duck, t: 1 });
  ok('BLOCKER: a plain player asks for a troll — on an admin, on the host, on the owner: the host does nothing, nobody hears a thing',
    TD.stats.refused === 3 && TD.stats.sent === 0 && IDS.every((i) => !of(i, 'owner:trolled').length), TD.stats);

  // A plain client dressing the request up as an admin's / the owner's: the channel keeps k and t and nothing else.
  const dressed = T.cleanTroll({ k: duck, t: 2, role: 'admin', owner: true, admin: true, by: 2, adm: 1 });
  await ask(4, 'owner:troll', { k: duck, t: 0, role: 'admin', by: 2, adm: 1, owner: true });
  ok('…and dressed up as an admin’s (role, by, adm, owner on the wire): the wire keeps k and t only, and the host still refuses',
    JSON.stringify(dressed) === JSON.stringify({ k: duck, t: 2 }) && TD.stats.sent === 0 && !of(0, 'owner:trolled').length, dressed);

  await ask(2, 'owner:troll', { k: duck, t: 4 });
  const seen = of(4, 'owner:trolled');
  ok('an ADMIN trolls a plain player: Duck rain on Quick Newt reaches everybody, stamped with the admin who did it',
    seen.length === 1 && seen[0].data.k === duck && seen[0].data.t === 4 && seen[0].data.by === 2 && seen[0].from === 0 && IDS.every((i) => of(i, 'owner:trolled').length === 1) && TD.stats.sent === 1, seen[0] && seen[0].data);
  later(6100);
  await ask(2, 'owner:troll', { k: duck, t: 0 });
  ok('an admin trolls the host (a plain player too)', of(3, 'owner:trolled').some((h) => h.data.t === 0 && h.data.by === 2) && TD.stats.sent === 2);

  later(6100);
  const before = TD.stats.sent;
  await ask(2, 'owner:troll', { k: duck, t: 1 });
  await ask(3, 'owner:troll', { k: duck, t: 1 });
  ok('BLOCKER: an admin trolls the OWNER — the host refuses it, from either admin, and nobody hears a thing',
    TD.stats.sent === before && !of(1, 'owner:trolled').some((h) => h.data.t === 1) && IDS.every((i) => !of(i, 'owner:trolled').some((h) => h.data.t === 1)), TD.stats);
  await ask(2, 'owner:troll', { k: duck, t: 3 });
  await ask(3, 'owner:troll', { k: duck, t: 2 });
  ok('an admin trolls another admin: refused too — only the owner trolls admins', TD.stats.sent === before && IDS.every((i) => !of(i, 'owner:trolled').some((h) => h.data.t === 2 || h.data.t === 3)));
  await ask(2, 'owner:troll', { k: duck, t: 2 });
  ok('…and an admin trolling themselves: nothing', TD.stats.sent === before);

  clear();
  await ask(1, 'owner:troll', { k: duck, t: 3 });
  ok('the OWNER trolls an admin: it goes through, stamped with the owner', of(3, 'owner:trolled').length === 1 && of(3, 'owner:trolled')[0].data.by === 1 && of(3, 'owner:trolled')[0].data.t === 3, of(3, 'owner:trolled')[0] && of(3, 'owner:trolled')[0].data);
  later(6100);
  await ask(1, 'owner:troll', { k: duck, t: 1 });
  ok('…and never the owner themselves', !of(2, 'owner:trolled').some((h) => h.data.t === 1));
}

{
  // The same cooldown, whoever trolled: a target an admin has just trolled makes the owner wait too, and the wait goes to the asker alone.
  clear();
  later(6100);
  const pink = T.trollIndex('pink');
  await ask(2, 'owner:troll', { k: pink, t: 4 });
  await ask(1, 'owner:troll', { k: pink, t: 4 });
  await ask(3, 'owner:troll', { k: pink, t: 4 });
  const w1 = of(1, 'owner:wait');
  const w3 = of(3, 'owner:wait');
  ok('the cooldown is the same for admins: a second troll on the same player inside six seconds — by the owner or another admin — waits, and only the one who asked is told; the first went through',
    of(4, 'owner:trolled').length === 1 && w1.length === 1 && w3.length === 1 && !of(2, 'owner:wait').length && w1[0].data.s >= 1 && w1[0].data.s <= 6 && w1[0].data.w === 0, { w1: w1[0] && w1[0].data, w3: w3[0] && w3[0].data });
  later(6100);
  await ask(3, 'owner:troll', { k: pink, t: 4 });
  ok('six seconds later the same player can be trolled again — by the other admin', of(4, 'owner:trolled').length === 2 && of(4, 'owner:trolled')[1].data.by === 3);
}

{
  // A plain client cannot send the host's word ('trolled') at all.
  clear();
  const before = TD.stats.in;
  players[4].session.sendGame({ k: 'owner:trolled', d: { k: 0, t: 0, by: 2 } });
  await sleep(15);
  ok('a plain player sending the host’s word (“trolled”, with an admin’s name on it) straight in: dropped — only the host says it', TD.stats.in === before && !of(0, 'owner:trolled').length, ch.dropped.slice(-1));
}

/* ============================================================ disasters */

{
  clear();
  DD.desk.clear();
  later(1100);
  await ask(4, 'owner:dis', { id: 'tornado', t: 0, s: 30 });
  ok('BLOCKER: a plain player sends a disaster: refused, nothing starts', !DD.desk.running.size && !of(0, 'owner:disgo').length);
  later(1100);
  await ask(2, 'owner:dis', { id: 'tornado', t: 4, s: 30 });
  const go = of(0, 'owner:disgo');
  ok('an ADMIN sends a tornado after a plain player, 30 s: the host starts it for everybody, saying which admin sent it',
    go.length === 1 && go[0].data.id === 'tornado' && go[0].data.t === 4 && go[0].data.by === 2 && IDS.every((i) => of(i, 'owner:disgo').length === 1) && DD.desk.running.size === 1, go[0] && go[0].data);
  const nAdmin = go[0].data.n;
  later(1100);
  await ask(2, 'owner:dis', { id: 'lightning', t: 1, s: 30 });
  later(1100);
  await ask(3, 'owner:dis', { id: 'meteors', t: 2, s: 30 });
  later(1100);
  await ask(2, 'owner:dis', { id: 'meteors', t: 3, s: 30 });
  ok('BLOCKER: an admin sends a disaster after the OWNER, or after another admin: refused, nothing starts', DD.desk.running.size === 1 && of(0, 'owner:disgo').length === 1);
  later(1100);
  await ask(2, 'owner:dis', { id: 'fogBank', t: 2, s: 30 });
  ok('an admin’s disaster on themselves is theirs to send, as the owner’s always was', DD.desk.running.size === 2 && DD.desk.onTarget(2) && DD.desk.onTarget(2).by === 2, [...DD.desk.running.values()].map((r) => `${r.id}>${r.t} by ${r.by} r${r.rank}`));
  later(1100);
  await ask(3, 'owner:dis', { id: 'wildfire', t: 0, s: 60 });
  const w = of(3, 'owner:wait');
  ok('the owner keeps a place: the admins together fill two of the three, so a third admin disaster is refused and its sender told “three are running”',
    DD.desk.running.size === 2 && w.length >= 1 && w[w.length - 1].data.w === 1, w.map((h) => h.data));
  later(1100);
  await ask(1, 'owner:dis', { id: 'wildfire', t: 0, s: 60 });
  ok('…and the owner can take the third', DD.desk.running.size === 3 && DD.desk.onTarget(0).by === 1 && DD.desk.onTarget(0).rank === 2);
  const nOwner = DD.desk.onTarget(0).n;
  clear();
  later(1100);
  await ask(2, 'owner:dis', { id: 'lightning', t: 0, s: 60 });
  const held = of(2, 'owner:wait');
  ok('an admin cannot replace the owner’s disaster on a player: the owner’s keeps running, the admin is told so (its own line)', DD.desk.onTarget(0).n === nOwner && !of(0, 'owner:disend').length && held.length === 1 && held[0].data.w === 3, held.map((h) => h.data));
  later(1100);
  await ask(2, 'owner:disstop', { n: nOwner });
  ok('an admin cannot stop the owner’s disaster (STOP NOW by its number): it runs on', DD.desk.onTarget(0) && DD.desk.onTarget(0).n === nOwner && !of(0, 'owner:disend').length);
  later(1100);
  await ask(2, 'owner:disstop', { n: 0 });
  ok('STOP ALL by an admin ends the admin’s own, and only theirs', DD.desk.running.size === 1 && DD.desk.onTarget(0).n === nOwner && of(0, 'owner:disend').length === 2, DD.desk.running.size);
  await ask(4, 'owner:disstop', { n: nOwner });
  ok('a plain player cannot stop anything', DD.desk.running.size === 1);
  later(1100);
  await ask(1, 'owner:dis', { id: 'tornado', t: 3, s: 30 });
  const ownersOnAdmin = DD.desk.onTarget(3);
  ok('the owner sends one after an admin: it starts', !!ownersOnAdmin && ownersOnAdmin.by === 1 && DD.desk.running.size === 2);
  later(1100);
  await ask(3, 'owner:disstop', { n: ownersOnAdmin.n });
  ok('…and that admin cannot stop it', !!DD.desk.onTarget(3));
  later(1100);
  await ask(1, 'owner:dis', { id: 'fogBank', t: 4, s: 30 });
  const adminOne = DD.desk.onTarget(4);
  later(1100);
  await ask(1, 'owner:disstop', { n: adminOne.n });
  ok('the owner can stop any of them, an admin’s by its number', !DD.desk.onTarget(4) && of(0, 'owner:disend').some((h) => h.data.n === adminOne.n));
  await ask(1, 'owner:disstop', { n: 0 });
  ok('(and STOP ALL by the owner ends the owner’s)', DD.desk.running.size === 0, DD.desk.running.size);
}

{
  // The desk, as a class: the rank rules and the sweep, on their own clock.
  let t = 0;
  const desk = new D.DisasterDesk(() => t, { cap: 3 });
  const o1 = desk.ask({ id: 'tornado', t: 5, s: 30, by: 1, rank: 2 });
  const a1 = desk.ask({ id: 'fogBank', t: 6, s: 30, by: 2, rank: 1 });
  const a2 = desk.ask({ id: 'fogBank', t: 7, s: 30, by: 3, rank: 1 });
  const a3 = desk.ask({ id: 'fogBank', t: 4, s: 30, by: 2, rank: 1 });
  ok('the desk: with the owner’s one running an admin fills one more and not the third (an admin gets 2 of 3 between them, owner included in the count); the owner always can',
    o1.ok && a1.ok && !a2.ok && a2.why === 'cap' && !a3.ok && D.ADMIN_CAP === 2, { a2, a3 });
  const o2 = desk.ask({ id: 'fogBank', t: 7, s: 30, by: 1, rank: 2 });
  const replaced = desk.ask({ id: 'ashCloud', t: 6, s: 30, by: 2, rank: 1 });
  const overOwner = desk.ask({ id: 'ashCloud', t: 5, s: 30, by: 3, rank: 1 });
  const ownerOverAdmin = desk.ask({ id: 'ashCloud', t: 6, s: 30, by: 1, rank: 2 });
  ok('an admin replaces their own; cannot replace the owner’s (held); the owner replaces an admin’s',
    o2.ok && replaced.ok && replaced.replaced === a1.n && !overOwner.ok && overOwner.why === 'held' && ownerOverAdmin.ok && ownerOverAdmin.replaced === replaced.n, { replaced, overOwner, ownerOverAdmin });
  // The sweep: whoever sent it has left or lost their powers.
  const gone = desk.sweep((by) => by === 1);
  ok('the sweep ends what a sender who has left or lost their powers started, and keeps the rest; one marked kept (a re-formed lobby’s) is left to its own clock',
    gone.length === 0 && desk.running.size === 3, gone);
  const d2 = new D.DisasterDesk(() => t);
  d2.ask({ id: 'fogBank', t: 4, s: 30, by: 2, rank: 1 });
  d2.ask({ id: 'fogBank', t: 3, s: 30, by: 1, rank: 2 });
  d2.running.get(1).kept = true;
  const g2 = d2.sweep((by) => by === 1);
  const g3 = d2.sweep(() => false);
  ok('…sweep: the admin who left takes theirs; kept ones stay until their own clock; with nobody valid the rest go', g2.length === 0 && g3.length === 1 && d2.running.size === 1 && d2.running.get(1).kept === true, { g2, g3 });
}

{
  // The host's own tick does it: the owner's hour runs out, and the disaster they sent "until I stop it" ends by itself.
  const { extensions } = await import('../../src/game/extensions.js');
  const ext = extensions().find((e) => e.id === 'owner-disasters');
  const fakeSim = { state: 'menu', mode: 'free' };
  clear();
  DD.desk.clear();
  later(1100);
  await ask(1, 'owner:dis', { id: 'tornado', t: 4, s: 0 });
  const started = DD.desk.running.size === 1;
  ext.update(fakeSim, 0.016);
  const stillThere = DD.desk.running.size === 1;
  ROLE[1] = 'player'; // the hour is over: the session says so
  later(1100);
  ext.update(fakeSim, 0.016);
  await sleep(10);
  ok('an “until I stop it” disaster ends on the host by itself when whoever sent it loses their powers (the owner’s hour is up), and everybody is told',
    started && stillThere && DD.desk.running.size === 0 && of(4, 'owner:disend').length === 1, { started, stillThere, left: DD.desk.running.size });
  ROLE[1] = 'owner';
  // The sender leaves: what they sent "until I stop it" goes with them.
  clear();
  later(1100);
  await ask(2, 'owner:dis', { id: 'tornado', t: 4, s: 0 });
  const had = DD.desk.running.size === 1;
  ch.left(whoIs(2));
  await sleep(10);
  ok('…and when the admin who sent it leaves the game', had && DD.desk.running.size === 0 && of(4, 'owner:disend').length === 1, { had, left: DD.desk.running.size });
  DD.desk.clear();
}

/* ============================================================ teleport and taking over */

{
  clear();
  later(1100);
  await ask(4, 'owner:tp', { t: 2, x: 100, y: 500, z: 200 });
  ok('BLOCKER: a plain player asks to teleport somebody: nothing', IDS.every((i) => !of(i, 'owner:tpgo').length));
  later(1100);
  await ask(2, 'owner:tp', { t: 4, x: 100, y: 500, z: 200 });
  const tp = of(4, 'owner:tpgo');
  ok('an ADMIN teleports a plain player there, 500 m up: relayed to everybody with who asked — the target’s copy places them',
    tp.length === 1 && tp[0].data.t === 4 && tp[0].data.y === 500 && tp[0].data.by === 2 && IDS.every((i) => of(i, 'owner:tpgo').length === 1), tp[0] && tp[0].data);
  later(1100);
  await ask(2, 'owner:tp', { t: 1, x: 100, y: 500, z: 200 });
  later(1100);
  await ask(3, 'owner:tp', { t: 2, x: 100, y: 500, z: 200 });
  ok('BLOCKER: an admin teleports the OWNER, or another admin: refused', of(0, 'owner:tpgo').length === 1);
  later(1100);
  await ask(1, 'owner:tp', { t: 3, x: 5, y: 0, z: 5 });
  ok('the owner teleports an admin (to the ground): relayed', of(3, 'owner:tpgo').length === 2 && of(3, 'owner:tpgo')[1].data.t === 3 && of(3, 'owner:tpgo')[1].data.by === 1);
  later(1100);
  await ask(1, 'owner:tp', { t: 1, x: 5, y: 0, z: 5 });
  ok('…never the owner', of(0, 'owner:tpgo').length === 2);

  // Taking over stays the owner's.
  const asked = TPD.stats.takeAsked;
  later(1100);
  await ask(2, 'owner:take', { id: 3 });
  later(1100);
  await ask(4, 'owner:take', { id: 3 });
  ok('taking an aircraft over stays the owner’s: an admin’s (or a plain player’s) ask never reaches the host’s traffic', TPD.stats.takeAsked === asked && !of(0, 'owner:took').length);
  later(1100);
  await ask(1, 'owner:take', { id: 3 });
  ok('…the owner’s ask is heard', TPD.stats.takeAsked === asked + 1);
}

/* ============================================================ this copy's side: the menu, the buttons, the words */

{
  // What multiplayer/ui.js asks of the menu, per role and per row.
  const row = (id) => ({ id, name: NAMES[id], owner: ROLE[id] === 'owner', admin: ROLE[id] === 'owner' || ROLE[id] === 'admin' });
  const M = T.ownerMenu;
  const asOwner = [1, 2, 3, 4, 0].map((i) => `${i}:${M.button(row(i), 'owner') ? 1 : 0}`).join(' ');
  const asAdmin = [1, 2, 3, 4, 0].map((i) => `${i}:${M.button(row(i), 'admin') ? 1 : 0}`).join(' ');
  ok('the 🃏 Troll button: an owner’s list has it on admins and plain players, not on another owner; an admin’s list has it on plain players only — not on the owner, not on an admin',
    asOwner === '1:0 2:1 3:1 4:1 0:1' && asAdmin === '1:0 2:0 3:0 4:1 0:1', { asOwner, asAdmin });
  T.MENU.open = 4;
  const open = M.row(row(4), 'admin');
  T.MENU.open = 2;
  const shut = M.row(row(2), 'admin');
  const ownerRow = M.row(row(2), 'owner');
  T.MENU.open = 4;
  M.prune([row(4)], 'admin');
  const keeps = T.MENU.open === 4;
  M.prune([{ ...row(4), admin: true }], 'admin');
  ok('the gold row opens for a plain player on an admin’s list, and never for an admin (the owner’s can); a row open on somebody who becomes an admin shuts',
    /data-mp-own="troll:/.test(open) && shut === '' && /data-mp-own="troll:/.test(ownerRow) && keeps && T.MENU.open === null, { open: open.length, shut, keeps, now: T.MENU.open });
  T.MENU.open = null;
}

{
  // sendTroll / sendDisaster from this copy: gated on the host's word about me, then on the roster's about them. (The host decides all the same.)
  const was = mp.me;
  const sent = [];
  const realToHost = ch.toHost.bind(ch);
  ch.toHost = (k, d) => { sent.push([k, d]); return true; };
  try {
    mp.me = { admin: false, owner: false };
    const plain = T.sendTroll(0, 4);
    mp.me = { admin: true, owner: false };
    const toPlain = T.sendTroll(0, 4);
    const toOwner = T.sendTroll(0, 1);
    const toAdmin = T.sendTroll(0, 3);
    const dPlain = D.sendDisaster('tornado', 4, 30);
    const dOwner = D.sendDisaster('tornado', 1, 30);
    mp.me = { admin: true, owner: true };
    const oToAdmin = T.sendTroll(0, 3);
    const oToOwner = T.sendTroll(0, 1);
    const dAdmin = D.sendDisaster('tornado', 3, 30);
    ok('this copy asks only for what its role may: a plain copy sends nothing; an admin’s copy sends to a plain player and not to the owner or an admin (nor a disaster); the owner’s sends to an admin',
      plain === false && toPlain === true && toOwner === false && toAdmin === false && dPlain === true && dOwner === false && oToAdmin === true && oToOwner === false && dAdmin === true
      && sent.length === 4, { sent: sent.map((s) => s[0]) });
  } finally {
    ch.toHost = realToHost;
    mp.me = was;
  }
}

{
  // The words on the target's screen: who did it, from the roster. And the troll wears off on its own, an admin's like the owner's.
  const THREE = await import('../../src/vendor/three.module.js');
  const { extensions } = await import('../../src/game/extensions.js');
  const ext = extensions().find((e) => e.id === 'owner-trolls');
  const fakeSim = {
    state: 'flying', mode: 'free', model: null, cockpit: null, input: null, weather: {},
    aircraft: { pos: new THREE.Vector3(0, 300, 0), vel: new THREE.Vector3(60, 0, 0), quat: new THREE.Quaternion(), onGround: false, crashed: false, parkingBrake: false },
    renderer: { domElement: { style: {} } },
  };
  TD.A.sim = fakeSim;
  mp.meId = 0;
  ok('who did it, in words, from the roster the host sent: the owner is “the owner”, an admin “an admin”', C.byWho(1) === 'the owner' && C.byWho(2) === 'an admin' && C.byWho(3) === 'an admin');
  TD.endAll();
  TD.arrive({ id: 'moon', t: 0, by: 2 });
  const adminTag = C.tagText();
  const adminOn = TD.mine().includes('moon');
  TD.arrive({ id: 'flip', t: 0, by: 2 });
  const flipOn = fakeSim.renderer.domElement.style.transform === 'rotate(180deg)';
  TD.arrive({ id: 'freeze', t: 0, by: 2 });
  const frozen = TD.frozen();
  ok('an admin’s troll arrives on the target’s copy: moon gravity, the upside-down camera and the freeze are on, and the tag reads “trolled by an admin”',
    adminOn && flipOn && frozen && /trolled by an admin — /.test(adminTag) && !/the owner/.test(adminTag), { adminTag, mine: TD.mine() });
  later(3100);
  ext.update(fakeSim, 0.016);
  const freezeGone = !TD.frozen() && !TD.mine().includes('freeze');
  later(2000);
  ext.update(fakeSim, 0.016);
  const flipGone = fakeSim.renderer.domElement.style.transform === '' && !TD.mine().includes('flip');
  later(15000);
  ext.update(fakeSim, 0.016);
  const moonGone = !TD.mine().includes('moon');
  ok('…and wears off by itself, the same times as the owner’s: freeze 3 s, upside-down 5 s, moon gravity 20 s', freezeGone && flipGone && moonGone && !TD.mine().length, { freezeGone, flipGone, moonGone, left: TD.mine() });
  ext.update(fakeSim, 0.016);
  ok('…and the tag goes with it', C.tagText() === '', C.tagText());
  TD.arrive({ id: 'moon', t: 0, by: 1 });
  TD.arrive({ id: 'flip', t: 0, by: 2 });
  const mixed = C.tagText();
  TD.arrive({ id: 'freeze', t: 0, by: 1 });
  ok('the owner’s name is on the tag when the owner trolled (a mix of the owner’s and an admin’s reads “the owner”)', /trolled by the owner — /.test(mixed) && /trolled by the owner — /.test(C.tagText()), { mixed });
  TD.endAll();
  TD.A.sim = null;
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  for (const f of failed) console.log(`  FAILED: ${f.name}`);
  process.exit(1);
}
process.exit(0);
