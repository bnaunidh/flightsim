/**
 * Your paint on everybody else's screen, in plain node:
 *
 *   node tests/features/mpskin.mjs
 *
 * features/mpskin.js sends the hangar's livery as one versioned game event
 * ('skin:paint') and multiplayer/remotes.js draws a friend's aeroplane in it.
 * Checked here: what may cross the wire (a livery this copy has, a version
 * that reads, nothing else), that the host relays it and an older copy would
 * drop it, what a remote is painted in, and that a paint change or a lobby
 * re-forming redraws the right models.
 */

globalThis.document = {
  createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }), width: 0, height: 0, style: {} }),
  body: { appendChild() {} },
  documentElement: { classList: { toggle() {} } },
  addEventListener() {},
};
globalThis.window = globalThis;

let passed = 0;
const failed = [];
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed.push(name);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const MS = await import('../../src/features/mpskin.js');
const E = await import('../../src/features/multiplayer/events.js');
const { multiplayer: mp } = await import('../../src/features/multiplayer.js');
const { Remotes } = await import('../../src/features/multiplayer/remotes.js');
const { LIVERIES } = await import('../../src/aircraft/liveries.js');

/* ---- what may cross the wire ----------------------------------------------- */
const ids = LIVERIES.map((l) => l.id);
ok('mpskin: every livery in the hangar can be sent', ids.every((id) => MS.cleanPaint({ v: 1, l: id })?.l === id), ids.join(','));
ok('mpskin: a livery this copy does not have is dropped, whoever sent it', MS.cleanPaint({ v: 1, l: 'xyzair' }) === null && MS.cleanPaint({ v: 1, l: 'ABYSSINIA' }) === null);
ok('mpskin: free text is never a paint', [
  { v: 1, l: 'Look at me!' }, { v: 1, l: '<script>' }, { v: 1, l: '#ff0000' }, { v: 1, l: 'a'.repeat(500) }, { v: 1, l: { id: 'potus' } }, { v: 1, l: ['potus'] }, { v: 1 }, { l: 'potus' },
].every((d) => MS.cleanPaint(d) === null));
ok('mpskin: junk that is not an object is dropped', [null, undefined, 3, 'potus', [], true].every((d) => MS.cleanPaint(d) === null));
ok('mpskin: it is versioned: version 1 now, a later version is still read for its livery and nothing else',
  MS.PAINT_VERSION === 1 && MS.cleanPaint({ v: 1, l: 'potus' }).v === 1 && JSON.stringify(MS.cleanPaint({ v: 2, l: 'potus', colour: '#ff0000', newField: 'x' })) === '{"v":1,"l":"potus"}');
ok('mpskin: …but version 0, a fraction or a made-up one is refused', [0, -1, 1.5, 100, 'a', null].every((v) => MS.cleanPaint({ v, l: 'potus' }) === null));
ok('mpskin: it is a tiny message', JSON.stringify({ k: 'skin:paint', d: { v: 1, l: 'nightfreight' } }).length < 60, `${JSON.stringify({ k: 'skin:paint', d: { v: 1, l: 'nightfreight' } }).length} bytes of JSON`);

/* ---- through the channel: a host and two players ----------------------------- */
const ch = mp.events;
ok('mpskin: the kind is defined, for anyone to send (it is their own paint)', ch.kinds.has('skin:paint') && ch.kinds.get('skin:paint').host === false);
{
  const players = {};
  const heard = { 1: [], 2: [] };
  const who = (id) => ({ id, name: `p${id}`, colour: '#ff5a4f', host: id === 0 });
  for (const id of [1, 2]) {
    const ev = new E.GameEvents({ now: () => performance.now() });
    for (const [k, def] of ch.kinds) ev.kinds.set(k, def);
    ev.on('skin:paint', (d, from) => heard[id].push({ d, from: from.id }));
    players[id] = ev;
  }
  const hostSession = {
    sendGame(msg, except) {
      for (const id of [1, 2]) if (id !== except) players[id].fromWire(who(msg.f), { k: msg.k, d: msg.d });
      return true;
    },
    sendGameTo(id, msg) {
      players[id].fromWire(who(msg.f), { k: msg.k, d: msg.d });
      return true;
    },
    sendGameState() {},
    sendGameStateTo() {},
  };
  const hostHeard = [];
  ch.on('skin:paint', (d, from) => hostHeard.push({ d, from: from.id }));
  for (const id of [1, 2]) players[id].attach({ sendGame: (msg) => { ch.fromWire(who(id), msg); return true; } }, 'client', id);
  ch.roster = () => [0, 1, 2].map((id) => ({ id, name: `p${id}`, colour: '#ff5a4f', host: id === 0, me: id === 0 }));
  for (const id of [1, 2]) players[id].roster = ch.roster;
  ch.attach(hostSession, 'host', 0);

  players[1].send('skin:paint', { v: 1, l: 'potus' });
  ok('mpskin: a player\'s paint reaches the host and the other player, stamped with who sent it',
    hostHeard.length === 1 && hostHeard[0].from === 1 && hostHeard[0].d.l === 'potus' && heard[2].length === 1 && heard[2][0].from === 1 && heard[2][0].d.l === 'potus', JSON.stringify({ hostHeard, h2: heard[2] }));
  ok('mpskin: …and the host\'s own copy of the game has set that remote\'s paint', mp.remotes.paints.get(1) === 'potus');
  players[2].send('skin:paint', { v: 1, l: 'xyzair' });
  players[2].send('skin:paint', { v: 1, l: 'Look at me!' });
  ok('mpskin: a livery nobody has is refused on the way in, and never relayed', hostHeard.length === 1 && heard[1].length === 0 && mp.remotes.paints.get(2) === undefined);
  // A tab that bypasses its own send() check: what the host receives is checked again, so the junk stops at the host.
  ch.fromWire(who(2), { k: 'skin:paint', d: { v: 1, l: '<img src=x>' } });
  ch.fromWire(who(2), { k: 'skin:paint', d: { v: 7, l: 'bharat', extra: 'x' } });
  ok('mpskin: a modified tab cannot get junk through the host; a later version still gets its livery through',
    mp.remotes.paints.get(2) === 'bharat' && heard[1].length === 1 && JSON.stringify(heard[1][0].d) === '{"v":1,"l":"bharat"}', JSON.stringify(heard[1]));
  // An older copy of the game has no 'skin:paint' kind at all: it drops the event ("not a defined kind") and carries on.
  const old = new E.GameEvents({ now: () => performance.now() });
  old.attach({ sendGame: () => true }, 'client', 1);
  old.roster = ch.roster;
  const got = [];
  old.on('skin:paint', () => got.push(1));
  old.fromWire(who(0), { k: 'skin:paint', d: { v: 1, l: 'potus' } });
  ok('mpskin: a copy from before this existed ignores it (no error, nothing delivered)', got.length === 0 && old.dropped.length >= 1 && /not a defined kind/.test(old.dropped.at(-1).why || JSON.stringify(old.dropped.at(-1))), JSON.stringify(old.dropped.at(-1)));
  ch.detach();
  mp.remotes.clear();
}

/* ---- what a remote is painted in ------------------------------------------------ */
{
  const rem = new Remotes();
  const colour = '#58c6ff';
  const player = rem._schemeFor(colour, '');
  ok('remotes: with no paint heard, an aeroplane is in its player colour, as it always was', player.id === 'multiplayer' && player.base === colour && player.reg === null, player.id);
  ok('remotes: factory colours picked ("house") is the player colour too, so they can still be told apart', rem._schemeFor(colour, 'house').id === 'multiplayer');
  const pot = rem._schemeFor(colour, 'potus');
  ok('remotes: Air Force One is the real scheme: its tail, its number, its title', pot.id === 'potus' && pot.reg === 'SAM 42' && pot.title === 'UNITED STATES OF AMERICA' && pot.tail === 0x1c365e);
  ok('remotes: an id nobody has is the player colour, not a crash', rem._schemeFor(colour, 'xyzair').id === 'multiplayer' && rem._schemeFor(colour, 'constructor').id === 'multiplayer');

  // A change of paint redraws that player's model, once; the same one again does nothing.
  rem.add(4, { name: 'Brave Otter', colour });
  const p = rem.players.get(4);
  let released = 0;
  p.model = { removeFromParent() { released++; }, traverse() {}, userData: {} };
  p.modelKey = `air:b747:${colour}:`;
  ok('remotes: a paint heard for a player is kept, and their model is put away to be rebuilt in it', rem.setPaint(4, 'abyssinia') === true && rem.paints.get(4) === 'abyssinia' && p.model === null && released === 1);
  p.model = { removeFromParent() { released++; }, traverse() {}, userData: {} };
  ok('remotes: the same paint again changes nothing', rem.setPaint(4, 'abyssinia') === false && p.model !== null && released === 1);
  ok('remotes: a new paint changes it', rem.setPaint(4, 'potus') === true && rem.paints.get(4) === 'potus' && p.model === null);
  ok('remotes: a paint can arrive before the player does (the event can beat the first snapshot)', rem.setPaint(5, 'bharat') === true && rem.paints.get(5) === 'bharat');
  rem.remove(4);
  ok('remotes: a player who leaves takes their paint with them', !rem.paints.has(4) && rem.paints.has(5));
  rem.dropPlayers();
  ok('remotes: a lobby that re-forms numbers everybody afresh: nobody keeps the old number\'s paint', rem.paints.size === 0);
  rem.setPaint(6, 'liberty');
  rem.clear();
  ok('remotes: leaving the game forgets every paint', rem.paints.size === 0);
}

/* ---- sending ---------------------------------------------------------------------- */
{
  const sent = [];
  const fake = { active: true, send: (k, d) => { sent.push([k, d]); return true; } };
  // Drive say() against a stand-in channel: the real one is not in a game here.
  const realActive = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ch), 'active');
  const realSend = ch.send;
  Object.defineProperty(ch, 'active', { configurable: true, get: () => true });
  ch.send = (k, d) => fake.send(k, d);
  try {
    // PAINT PER PLANE (wave 18): settings.liveries per type; the flown type's paint is sent.
    const sim = { aircraftType: { id: 'b747' }, settings: { aircraft: 'b747', liveries: { b747: 'abyssinia', skylark: 'liberty' } } };
    MS.__test.S.sent = null;
    ok('mpskin: it says its paint when a game begins', MS.__test.say(sim) === true && sent.length === 1 && sent[0][0] === 'skin:paint' && sent[0][1].l === 'abyssinia' && sent[0][1].v === 1);
    ok('mpskin: …and not again every frame', MS.__test.say(sim) === false && sent.length === 1);
    sim.settings.liveries.b747 = 'potus';
    ok('mpskin: a changed paint goes out at once', MS.__test.say(sim) === true && sent.length === 2 && sent[1][1].l === 'potus');
    MS.__test.S.at -= MS.RESEND_SECONDS + 0.1;
    ok(`mpskin: …and it is said again every ${MS.RESEND_SECONDS} seconds whatever, for the packet that was lost`, MS.__test.say(sim) === true && sent.length === 3);
    sim.aircraftType = { id: 'skylark' };
    ok('mpskin: paint per plane: switching aeroplane sends THAT plane\'s paint at once (the payload shape unchanged)', MS.__test.say(sim) === true && sent.at(-1)[1].l === 'liberty' && Object.keys(sent.at(-1)[1]).sort().join() === 'l,v');
    sim.aircraftType = { id: 'c172' };
    ok('mpskin: paint per plane: an aeroplane never painted is sent in its own colours', MS.__test.say(sim) === true && sent.at(-1)[1].l === 'house');
    sim.aircraftType = { id: 'b747' };
    sim.settings.liveries.b747 = 'not-a-livery';
    MS.__test.S.sent = null;
    ok('mpskin: a paint setting from some other version of the game is sent as the factory colours, never as itself', MS.__test.say(sim) === true && sent.at(-1)[1].l === 'house');
    // An older copy keeps one paint for all, and sends it the same way: it still reads as a paint here.
    ok('mpskin: an older copy\'s single-livery message is still read', MS.cleanPaint({ v: 1, l: 'potus' })?.l === 'potus');
    const oldSim = { settings: { livery: 'potus' } };
    ok('mpskin: an unmigrated single-paint settings object is still sent as its paint', MS.__test.mine(oldSim) === 'potus');
    MS.__test.S.sent = null;
  } finally {
    ch.send = realSend;
    if (realActive) Object.defineProperty(ch, 'active', realActive);
    else delete ch.active;
  }
}

console.log(`\n${passed} passed, ${failed.length} failed`);
if (failed.length) {
  console.log(failed.map((f) => `  FAILED: ${f}`).join('\n'));
  process.exit(1);
}
process.exit(0);
