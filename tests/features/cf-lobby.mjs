/**
 * The Cloudflare lobby server, in plain node — no wrangler, no network:
 *
 *   node tests/features/cf-lobby.mjs
 *
 * server/worker.js and server/lobby.js run as written under the stand-in
 * runtime in cf-lobby.fakes.js (Durable Object state, hibernatable
 * WebSockets, namespaces, WebSocketPair). What it proves:
 *   - the Worker's routes: /health, /lobbies, /lobby/<id>, CORS, bad ids;
 *   - a join: hello → welcome in the host's protocol, the roster, a second
 *     joiner told about the first and dropped beside them, refusals (wrong
 *     version, a username already in, full), the protocol's seat cap;
 *   - the relay: a snapshot goes to everybody else under the sender's id,
 *     at the tick and no faster, the newest wins, three players' snapshots
 *     are bundled;
 *   - the sanity checks: outside the world, impossibly fast, a teleport —
 *     dropped; a respawn (three in a row from the new place) let through;
 *   - chat: preset lines by index relayed, a bad index dropped, free text
 *     through the word filter;
 *   - rate limits: the event bucket, snapshots a second, strikes → kicked
 *     and kept out; joins and list reads a minute per address;
 *   - the lobby list: a room appears with its head-count, and goes when empty;
 *   - hibernation: the object evicted and rebuilt from its kept sockets,
 *     the players still seated and relaying;
 *   - the game's own ClientSession over transport.js CloudNet: welcomed as
 *     in world lobby n on its island, two players see each other's
 *     snapshots and chat, a leave is a leave; CloudWatch's list;
 *   - the fallback: no address, a server that is down, one built for another
 *     version — probeLobbyServer says no, and the controller's joinLobby
 *     goes the tab-to-tab way without a word.
 */

// The DOM stub every module in this game is imported under in node.
global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
  head: { appendChild() {} },
};
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1, matchMedia: () => ({ matches: false, addEventListener() {} }) };

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail: String(detail) });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  return !!pass;
};
process.on('unhandledRejection', (err) => ok('no unhandled rejections', false, err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : err));

const { FakeServer, sleep, until } = await import('./cf-lobby.fakes.js');
const P = await import('../../src/features/multiplayer/protocol.js');
const F = await import('../../server/filter.js');
const LB = await import('../../server/lobby.js');
const worker = await import('../../server/worker.js');
const T = await import('../../src/features/multiplayer/transport.js');
const S = await import('../../src/features/multiplayer/session.js');

const r13 = (s) => s.replace(/[a-z]/gi, (c) => { const b = c <= 'Z' ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b); });
const WORLD1 = T.roomIdFor(P.worldId(1));
const snapOf = (o) => P.encodeState({ id: 0, seq: 1, t: 1000, pos: { x: 0, y: 100, z: 0 }, quat: { w: 1 }, vel: { x: 50, y: 0, z: 0 }, game: 'flight', type: 'skylark', ...o });

/* ---- imports --------------------------------------------------------- */
ok('server/lobby.js, server/worker.js and server/filter.js import in node, as does the game’s transport.js', !!(LB.LobbyRoom && worker.default && worker.Lobby && worker.Directory && F.cleanChat && T.CloudNet));
ok('the server speaks this copy’s protocol version', LB.roomInfoFor(WORLD1).world === true && LB.roomInfoFor(WORLD1).lobby === 1 && LB.roomInfoFor(WORLD1).map === P.worldMap(1) && LB.roomInfoFor('world-1-1').world === false, `${WORLD1} → ${LB.roomInfoFor(WORLD1).name}`);
ok('room ids: lower-case words, digits and dashes, at most 40', LB.validRoomId('world-4-1') && LB.validRoomId('abc') && !LB.validRoomId('') && !LB.validRoomId('World') && !LB.validRoomId('a/b') && !LB.validRoomId('x'.repeat(41)));

/* ---- the word filter ------------------------------------------------- */
{
  const bad = r13('shpx');
  const bad2 = r13('fuvg');
  const whole = r13('nff');
  ok('filter: clean words pass', F.offends('nice landing, Brave Otter') === null && F.cleanText('see you at the runway').ok);
  ok('filter: a refused root is refused, inside a word, in capitals, with look-alike digits and stretched', [F.offends(bad), F.offends(`x${bad}y`), F.offends(bad.toUpperCase()), F.offends(bad2.replace('i', '1')), F.offends(bad2.replace('i', '!')), F.offends(bad2.replace('i', 'iii')), F.offends(bad.split('').join(' '))].every((x) => x === 'root'),
    [F.offends(bad), F.offends(bad2.replace('i', '1')), F.offends(bad.split('').join(' '))].join());
  ok('filter: a refused whole word is refused on its own, not inside another', F.offends(whole) === 'whole' && F.offends(`p${whole}word`) === null);
  ok('filter: chat by preset index is always fine; a bad index, a bad word, an empty line are not', F.cleanChat({ m: 0 }, P.QUICK_CHAT.length).ok && F.cleanChat({ m: 2 }, P.QUICK_CHAT.length).m === 2 && !F.cleanChat({ m: P.QUICK_CHAT.length }, P.QUICK_CHAT.length).ok && !F.cleanChat({ m: -1 }, 9).ok
    && !F.cleanChat({ text: bad }, 9).ok && !F.cleanChat({ text: '   ' }, 9).ok && F.cleanChat({ text: 'gg everyone' }, 9).text === 'gg everyone' && !F.cleanChat({}, 9).ok);
  ok('filter: the lists are the game’s own (tests/features/multiplayer.mjs ROOTS/WHOLE), rot13’d, 50-odd roots', F.ROOTS.length >= 50 && F.WHOLE.length >= 40 && !F.ROOTS.some((w) => /[^a-z]/.test(w)));
}

/* ---- the Worker’s routes ---------------------------------------------- */
const srv = await FakeServer.start({ env: { MAX_PLAYERS: '16', TICK_HZ: '15' } });
{
  const h = await srv.fetch('/health');
  const hj = await h.json();
  ok('GET /health: ok, this protocol version, the cap, CORS for the game’s origin', h.status === 200 && hj.ok === true && hj.v === P.PROTO && hj.max === 16 && hj.tickHz === 15 && h.headers.get('access-control-allow-origin') === '*', JSON.stringify(hj));
  const l = await srv.fetch('/lobbies');
  ok('GET /lobbies: an empty list before anybody is in', l.status === 200 && JSON.stringify(await l.json()) === '[]');
  ok('GET /lobby/<bad id>: 400; an unknown path: 404; POST: 405; OPTIONS: 204 with CORS', (await srv.fetch('/lobby/Not%20Valid!')).status === 400 && (await srv.fetch('/nothing')).status === 404
    && (await srv.fetch('/lobbies', { method: 'POST' })).status === 405 && (await srv.fetch('/lobbies', { method: 'OPTIONS' })).status === 204);
  const d = await srv.fetch(`/lobby/${WORLD1}`);
  const dj = await d.json();
  ok('GET /lobby/<id> without an upgrade: the room described — its list name, island and 0 players', d.status === 200 && dj.players === 0 && dj.name === P.worldName(1) && dj.map === P.worldMap(1) && dj.max === Math.min(16, P.PLAYER_IDS - 1), JSON.stringify(dj));
}

/* ---- raw sockets: joining ---------------------------------------------- */
/** A browser-shaped socket into a room, with what it heard. */
function rawJoin(roomId, hello, ip) {
  const ws = srv.connect(roomId, ip);
  ws.binaryType = 'arraybuffer';
  const got = { events: [], states: [], closed: null, open: false };
  ws.onopen = () => {
    got.open = true;
    if (hello) ws.send(JSON.stringify({ t: 'hello', v: P.PROTO, name: 'Brave Otter', colour: '#ff5a4f', key: 'k-' + Math.random().toString(36).slice(2, 8), ...hello }));
  };
  ws.onmessage = (e) => {
    if (typeof e.data === 'string') got.events.push(JSON.parse(e.data));
    else got.states.push(e.data);
  };
  ws.onclose = (e) => {
    got.closed = e;
  };
  got.ws = ws;
  got.of = (t) => got.events.filter((e) => e.t === t);
  got.last = (t) => got.of(t).at(-1) || null;
  return got;
}
{
  const a = rawJoin(WORLD1, { name: 'Brave Otter' });
  const w = await until(() => a.last('welcome'));
  ok('hello → welcome: seat 1, the name as sent, the room as world lobby 1 on its island, no host position yet, cloud marked', !!w && w.you === 1 && w.name === 'Brave Otter' && w.v === P.PROTO && w.server.lobby === 1 && w.server.map === P.worldMap(1) && w.server.name === P.worldName(1)
    && w.server.max === Math.min(16, P.PLAYER_IDS - 1) && w.at === null && w.server.cloud === 1 && Array.isArray(w.players) && w.players.length === 1 && w.players[0].id === 1 && w.players[0].host === false, JSON.stringify(w && w.server));
  ok('…and it reads back through the game’s own ClientSession checks (readPlayer): a player, not a host', !!w && P.readPlayer(w.players[0]) && P.readPlayer(w.players[0]).host === false);
  a.ws.send(snapOf({ pos: { x: 500, y: 300, z: -200 }, vel: { x: 60, y: 0, z: 0 } }));
  await sleep(30);
  const b = rawJoin(WORLD1, { name: 'Sunny Puffin', colour: '#58c6ff' });
  const wb = await until(() => b.last('welcome'));
  ok('a second player: seat 2, told who is here, and dropped beside the first — where their last snapshot said, heading the way they were going', !!wb && wb.you === 2 && wb.players.length === 2 && wb.at && Math.abs(wb.at.x - 500) < 1 && Math.abs(wb.at.y - 300) < 1 && Math.abs(wb.at.heading - 90) < 1 && wb.at.speed > 59 && wb.at.onGround === false,
    JSON.stringify(wb && wb.at));
  const j = await until(() => a.last('join'));
  ok('…and the first is told “join” with the second’s id, name and colour, as a host would say it', !!j && j.p.id === 2 && j.p.name === 'Sunny Puffin' && j.p.colour === '#58c6ff' && j.p.host === false);
  const ros = await until(() => b.of('roster').length >= 1 && b.last('roster'));
  ok('the roster goes out: both seated, in id order, nobody a host', !!ros && ros.players.map((p) => p.id).join() === '1,2' && ros.players.every((p) => p.host === false));
  const old = rawJoin(WORLD1, { name: 'Clever Lynx', v: P.PROTO + 1 });
  const d1 = await until(() => old.last('deny'));
  ok('an older copy of the game is told “version” and the line closes after it', !!d1 && d1.why === 'version' && !!(await until(() => old.closed)));
  const dup = rawJoin(WORLD1, { name: 'Brave Otter' });
  const d2 = await until(() => dup.last('deny'));
  ok('a username already in the room is refused with a free one to take, and the line closes', !!d2 && d2.why === 'name' && d2.suggest === 'Brave Otter 2' && !!(await until(() => dup.closed)), JSON.stringify(d2));
  const junk = rawJoin(WORLD1, { name: 'not a call sign <b>' });
  const wj = await until(() => junk.last('welcome'));
  ok('a name that is not from the lists gets a call sign made from its seat, never the text', !!wj && P.parseCallSign(wj.name) && !/not a/.test(wj.name), wj && wj.name);
  junk.ws.send(JSON.stringify({ t: 'bye' }));
  await until(() => a.of('leave').length);
  ok('“bye”: everybody is told “leave … left”', !!a.last('leave') && a.last('leave').why === 'left' && a.last('leave').id === wj.you);
  const room = srv.room(WORLD1);
  ok('the room’s own cap is the protocol’s seats (1..PLAYER_IDS-1) under this version, however big MAX_PLAYERS is', room.max === Math.min(16, P.PLAYER_IDS - 1) && room.count === 2, `max ${room.max}, ${room.count} in`);

  /* ---- the relay ---------------------------------------------------------- */
  b.states.length = 0;
  a.ws.send(snapOf({ id: 7, seq: 2, pos: { x: 510, y: 300, z: -200 } }));
  const s1 = await until(() => b.states.length && b.states.at(-1));
  const dec = s1 && P.decodeStates(s1);
  ok('a snapshot reaches the other player under the SENDER’S seat, whatever id it claimed', !!dec && dec.length === 1 && dec[0].id === 1 && Math.abs(dec[0].pos.x - 510) < 0.01, JSON.stringify(dec && dec[0] && dec[0].id));
  // Twenty snapshots in a burst, a few metres apart: the room sends at its tick, the newest wins.
  await sleep(1100);
  b.states.length = 0;
  for (let i = 0; i < 20; i++) a.ws.send(snapOf({ seq: 10 + i, pos: { x: 512 + i * 2, y: 300, z: -200 } }));
  await sleep(350);
  const frames = b.states.length;
  const lastSeq = Math.max(...b.states.map((s) => P.decodeStates(s)[0].seq));
  ok('twenty snapshots in a burst: a handful of frames at the tick (15 Hz), not twenty, and the newest among them', frames >= 1 && frames <= 5 && lastSeq === 29, `${frames} frames, last seq ${lastSeq}`);
  // A third player hears both the others.
  const c = rawJoin(WORLD1, { name: 'Gentle Lark' });
  await until(() => c.last('welcome'));
  await sleep(1100);
  c.states.length = 0;
  a.ws.send(snapOf({ seq: 100, pos: { x: 560, y: 300, z: -200 } }));
  b.ws.send(snapOf({ seq: 101, pos: { x: 800, y: 300, z: -200 } }));
  await sleep(200);
  const bundled = c.states.map((s) => P.decodeStates(s));
  const ids = new Set(bundled.flat().map((s) => s.id));
  ok('three players: the third hears both the others, each under its own seat', ids.has(1) && ids.has(2) && bundled.flat().length === 2, `${c.states.length} frame(s): ${bundled.map((x) => x.map((s) => s.id).join('+')).join(', ')}`);
  ok('the room counted what it did', room.stats.joined >= 4 && room.stats.relayed >= 20 && room.stats.bundles >= 2 && room.stats.dropped.jump === 0 && room.stats.dropped.rate === 0, JSON.stringify(room.stats));

  /* ---- chat ------------------------------------------------------------- */
  b.events.length = 0;
  a.ws.send(JSON.stringify({ t: 'chat', m: 1 }));
  const ch = await until(() => b.last('chat'));
  ok('quick chat: preset line 1 reaches the others as { chat, id, m }', !!ch && ch.id === 1 && ch.m === 1);
  a.ws.send(JSON.stringify({ t: 'chat', m: 2 }));
  await sleep(60);
  ok('…one line per 1.2 s per player: the next one straight after goes nowhere', b.of('chat').length === 1);
  await sleep(1250);
  b.events.length = 0;
  a.ws.send(JSON.stringify({ t: 'chat', m: P.QUICK_CHAT.length + 5 }));
  await sleep(60);
  a.ws.send(JSON.stringify({ t: 'chat', text: r13('shpx') + ' you' }));
  await sleep(60);
  ok('a bad index and a bad word both go nowhere (and count as strikes)', b.of('chat').length === 0 && room.stats.dropped.chat === 2, `dropped.chat ${room.stats.dropped.chat}`);
  await sleep(1250);
  a.ws.send(JSON.stringify({ t: 'chat', text: 'nice landing' }));
  const tx = await until(() => b.last('chat'));
  ok('clean free text, if a client ever sends it, is relayed as text (the shipped client ignores it)', !!tx && tx.text === 'nice landing' && tx.m === undefined);

  /* ---- the lobby list ---------------------------------------------------- */
  const listed = await until(async () => {
    const l = await (await srv.fetch('/lobbies')).json();
    return l.find((e) => e.id === WORLD1 && e.players === 3) || null;
  }, 3000, 50);
  ok('GET /lobbies: the room is listed with its head-count, island and bumping rule as numbers — no names', !!listed && listed.players === 3 && listed.max === room.max && listed.m === P.mapIndex(P.worldMap(1)) && listed.world === true && !JSON.stringify(listed).includes('Otter'), JSON.stringify(listed));
  {
    // A head-count that holds still for a minute: the room says it again before the Directory forgets it (it used to report only on a join or a leave).
    const dirObj = srv.env.DIRECTORY.instance('main');
    dirObj.rooms.get(WORLD1).at = Date.now() - 50000;
    srv.lobby(WORLD1)._reportedAt = Date.now() - worker.REPORT_EVERY_MS - 1;
    const again = await until(() => {
      const r = dirObj.rooms.get(WORLD1);
      return r && Date.now() - r.at < 5000 ? r : null;
    }, 3000, 50);
    ok('a room whose head-count holds still reports it again every REPORT_EVERY_MS, so a busy lobby never drops off the list', !!again && again.players === 3 && worker.REPORT_EVERY_MS < 60000, JSON.stringify(again));
  }

  /* ---- hibernation --------------------------------------------------------- */
  const before = srv.lobby(WORLD1);
  srv.env.LOBBY.evict(WORLD1);
  const after = srv.env.LOBBY.instance(WORLD1);
  const room2 = after._room();
  ok('the object evicted and rebuilt from its kept sockets: a different object, the same three seated by the attachments, same names', after !== before && room2 !== room && room2.count === 3 && [...room2.players.values()].map((p) => p.name).sort().join() === 'Brave Otter,Gentle Lark,Sunny Puffin', [...room2.players.values()].map((p) => `${p.id}:${p.name}`).join(' '));
  b.states.length = 0;
  a.ws.send(snapOf({ seq: 200, pos: { x: 900, y: 300, z: -200 } }));
  const s2 = await until(() => b.states.length && b.states.at(-1));
  ok('…and it relays as before', !!s2 && P.decodeStates(s2)[0].id === 1 && P.decodeStates(s2)[0].seq === 200);

  /* ---- leaving, and the list ----------------------------------------------- */
  a.ws.send(JSON.stringify({ t: 'bye' }));
  b.ws.close();
  c.ws.send(JSON.stringify({ t: 'bye' }));
  const empty = await until(async () => {
    const l = await (await srv.fetch('/lobbies')).json();
    return !l.find((e) => e.id === WORLD1) ? true : null;
  }, 3000, 50);
  ok('everybody leaves (bye, or the socket just closes): the room empties and goes from the list at once', empty === true && room2.count === 0, `${room2.count} in`);
}

/* ---- the sanity checks, on the room alone with a fake clock ------------- */
{
  let t = 100000;
  const now = () => t;
  const room = new LB.LobbyRoom({ id: 'test-room', now, maxPlayers: 3 });
  const sock = () => ({ sent: [], send(d) { this.sent.push(d); }, close() { this.closed = true; }, texts() { return this.sent.filter((x) => typeof x === 'string').map((x) => JSON.parse(x)); }, bins() { return this.sent.filter((x) => typeof x !== 'string'); } });
  const join = (name, key = `k-${name.toLowerCase().replace(/\s+/g, '-')}`) => {
    const s = sock();
    room.connect(s, { ip: '10.0.0.1' });
    room.message(s, JSON.stringify({ t: 'hello', v: P.PROTO, name, colour: '#ff9f1c', key }));
    return s;
  };
  const A = join('Brave Otter');
  const B = join('Sunny Puffin');
  ok('room alone: two in, welcomed', A.texts()[0].t === 'welcome' && B.texts()[0].t === 'welcome' && room.count === 2);
  const C = join('Gentle Lark');
  const D = join('Clever Lynx');
  ok('maxPlayers 3: the fourth is told “full”', C.texts()[0].t === 'welcome' && D.texts()[0].t === 'deny' && D.texts()[0].why === 'full' && room.full);
  t += 500;
  room.tick(now());
  ok('…and its line is closed once the refusal has had its moment', D.closed === true);
  const send = (s, o) => room.message(s, snapOf({ pos: { x: 0, y: 100, z: 0 }, vel: { x: 50, y: 0, z: 0 }, ...o }));
  send(A, {});
  t += 67;
  ok('a plain snapshot is relayed', B.bins().length === 1 && room.stats.relayed === 1);
  send(A, { pos: { x: 70000, y: 100, z: 0 } });
  send(A, { pos: { x: 0, y: -600, z: 0 } });
  send(A, { pos: { x: 0, y: 100, z: 0 }, vel: { x: 1000, y: 0, z: 0 } });
  t += 67;
  room.tick(now());
  ok('outside the world (x 70 km, y -600 m) or faster than anything in the hangar (1000 m/s): dropped, counted', B.bins().length === 1 && room.stats.dropped.bounds === 2 && room.stats.dropped.speed === 1, JSON.stringify(room.stats.dropped));
  t += 67;
  send(A, { pos: { x: 3, y: 100, z: 0 } });
  t += 67;
  send(A, { pos: { x: 12000, y: 100, z: 0 } });
  t += 67;
  room.tick(now());
  const beforeJump = B.bins().length;
  ok('a 12 km jump in one tick: not believed (dropped, a strike)', room.stats.dropped.jump === 1 && beforeJump === 2);
  send(A, { pos: { x: 12001, y: 100, z: 0 } });
  t += 67;
  send(A, { pos: { x: 12002, y: 100, z: 0 } });
  t += 67;
  room.tick(now());
  ok('…but three in a row from the new place is a respawn (a crash, back on the runway): let through, from the third', room.stats.respawns === 1 && B.bins().length === 3 && Math.abs(P.decodeStates(B.bins().at(-1))[0].pos.x - 12002) < 0.01, `${B.bins().length} frames, jump drops ${room.stats.dropped.jump}`);
  // Within one tick: the first snapshot goes at once (the line was idle), the next two wait for the tick and go as ONE bundle.
  t += 67;
  const cb = C.bins().length;
  send(A, { pos: { x: 12003, y: 100, z: 0 } });
  send(B, { pos: { x: 1, y: 100, z: 0 } });
  send(A, { pos: { x: 12004, y: 100, z: 0 } });
  const atOnce = C.bins().length - cb;
  t += 67;
  room.tick(now());
  const frames = C.bins().slice(cb).map((f) => P.decodeStates(f).map((s) => s.id).sort().join('+'));
  ok('the capped tick: the first snapshot goes at once, the next two within the tick wait and go as ONE bundle of two, each under its sender’s seat — never more than one frame a tick', atOnce === 1 && frames.join(', ') === '1, 1+2', frames.join(', '));
  // Snapshots a second: the 31st in one second is not read.
  t += 1100;
  const base = room.stats.relayed;
  for (let i = 0; i < 40; i++) send(A, { pos: { x: 12003 + i * 0.1, y: 100, z: 0 } });
  ok(`snapshots over ${room.opts.statesPerSec} a second are dropped unread`, room.stats.relayed - base === room.opts.statesPerSec && room.stats.dropped.rate === 10, `${room.stats.relayed - base} read, ${room.stats.dropped.rate} dropped`);
  // Bad frames: a byte too many, junk.
  t += 1100;
  room.message(A, new ArrayBuffer(200));
  room.message(A, new ArrayBuffer(45));
  ok('a frame too big or malformed is a strike, never a crash', room.stats.dropped.bad === 2);
  // The event bucket: 20 at once, then a trickle.
  const strikesBefore = A.strikes;
  const conn = [...room.conns.values()].find((c) => c.id === 1);
  const sb = conn.strikes;
  const burst = room.opts.eventsBurst;
  const db = room.stats.dropped.events;
  for (let i = 0; i < burst + 20; i++) room.message(A, JSON.stringify({ t: 'gev', k: 'x', d: i }));
  ok(`events: a bucket of ${burst} then ${room.opts.eventsPerSec}/s — ${burst + 20} at once and 20 are dropped (strikes), ping/pong exempt`, room.stats.dropped.events - db === 20 && conn.strikes > sb && B.texts().filter((e) => e.t === 'gev').length === burst, `${room.stats.dropped.events - db} dropped`);
  room.message(A, JSON.stringify({ t: 'ping', ts: 5 }));
  ok('…a ping is still answered', A.texts().at(-1).t === 'pong' && A.texts().at(-1).ts === 5);
  void strikesBefore;
  // Keep striking: kicked, told, and the key kept out.
  for (let i = 0; i < 100 && room.players.has(1); i++) room.message(A, JSON.stringify({ t: 'gev', k: 'x' }));
  ok('sixty strikes: kicked (told “kick”, everybody told “leave kicked”), key kept out for ten minutes', !room.players.has(1) && A.texts().at(-1).t === 'kick' && B.texts().at(-1).t === 'leave' && B.texts().at(-1).why === 'kicked' && room.banned.has('k-brave-otter') && room.stats.kicked === 1,
    `banned: ${[...room.banned.keys()].join()}`);
  const again = join('Brave Otter');
  const fresh = join('Brave Otter', 'k-fresh');
  ok('…coming back with the same key: “kicked”; with another key (a cleared browser), in', again.texts()[0].t === 'deny' && again.texts()[0].why === 'kicked' && fresh.texts()[0].t === 'welcome');
  room.message(fresh, JSON.stringify({ t: 'bye' }));
  t += 11 * 60 * 1000;
  for (const c of room.conns.values()) c.lastHeard = t;
  const later = join('Brave Otter 2');
  ok('…eleven minutes later, the key is let back in', later.texts()[0].t === 'welcome' && room.conns.has(later), later.texts()[0].why || '');
  room.message(later, JSON.stringify({ t: 'bye' }));
  room.message(again, JSON.stringify({ t: 'bye' }));
  // Silence: a hello that never comes, a player gone quiet.
  const mute = sock();
  room.connect(mute);
  t += 11000;
  room.tick(now());
  ok('a socket that never says hello is closed after ten seconds', mute.closed === true);
  const quiet = room.players.get(2);
  quiet.lastHeard = t - 46000;
  room.tick(now());
  ok('a player silent for the loading timeout is dropped and everybody told', !room.players.has(2) && B.closed === true && C.texts().some((e) => e.t === 'leave' && e.id === 2 && e.why === 'dropped'), C.texts().slice(-3).map((e) => e.t).join());
  const tc = C.texts().filter((e) => e.t === 'ping').length;
  t += 2100;
  room.tick(now());
  ok('the room pings every two seconds, and the roster goes out when it changes', C.texts().filter((e) => e.t === 'ping').length === tc + 1 && C.texts().some((e) => e.t === 'roster'));
  room.shutdown();
  ok('shutdown: everybody told “close”, every line closed', C.texts().at(-1).t === 'close' && C.closed === true && room.count === 0);
}

/* ---- legit play is never kicked; a kicked socket says nothing more ------------ */
{
  let t = 500000;
  const now = () => t;
  const room = new LB.LobbyRoom({ id: 'play-room', now });
  const sock = () => ({ sent: [], send(d) { this.sent.push(d); }, close() { this.closed = true; }, texts() { return this.sent.filter((x) => typeof x === 'string').map((x) => JSON.parse(x)); }, bins() { return this.sent.filter((x) => typeof x !== 'string'); } });
  const join = (name, key, ip = '10.1.1.1') => {
    const s = sock();
    room.connect(s, { ip });
    room.message(s, JSON.stringify({ t: 'hello', v: P.PROTO, name, colour: '#ff9f1c', key }));
    return s;
  };
  const A = join('Brave Otter', 'k-a');
  const B = join('Sunny Puffin', 'k-b');
  const ca = [...room.conns.values()].find((c) => c.id === 1);
  // An afternoon of crashing: thirty-five respawns three kilometres away, a few seconds of flying between.
  let x = 0;
  for (let i = 0; i < 35; i++) {
    for (let k = 0; k < 30; k++) {
      t += 66;
      room.message(A, snapOf({ pos: { x, y: 100, z: 0 } }));
      room.tick(t);
    }
    // The wreck, the fade, the reset: a crash takes a good few seconds (still sending, from the wreck) before the plane is back on the runway.
    for (let k = 0; k < 120; k++) {
      t += 66;
      room.message(A, snapOf({ pos: { x, y: 100, z: 0 }, vel: { x: 0, y: 0, z: 0 } }));
      room.tick(t);
    }
    x = x ? 0 : 3000;
    for (let k = 0; k < 3; k++) {
      t += 66;
      room.message(A, snapOf({ pos: { x, y: 100, z: 0 } }));
      room.tick(t);
    }
  }
  ok('thirty-five crashes and respawns (two jump strikes each): strikes wear off, nobody kicked or banned', room.players.has(1) && !ca.kickedFor && room.banned.size === 0 && room.stats.respawns === 35, `strikes ${ca.strikes.toFixed(1)}, respawns ${room.stats.respawns}`);
  // A dogfight at the game's own per-kind limits: pvp:hit claims at 12/s (to a host there is not), pvp:fire, bump:knock.
  const sb = ca.strikes;
  for (let i = 0; i < 40 * 22; i++) {
    t += 1000 / 22;
    const k = i % 11;
    room.message(A, JSON.stringify(k < 6 ? { t: 'gev', k: 'pvp:hit', d: { t: 2 }, h: 1 } : k < 8 ? { t: 'gev', k: 'pvp:fire', d: { on: true } } : { t: 'gev', k: 'bump:knock', d: { t: 2, nx: 1, ny: 0, nz: 0, dv: 3 } }));
    if (i % 3 === 0) room.message(A, snapOf({ pos: { x, y: 100, z: 0 } }));
    room.tick(t);
  }
  ok('forty seconds of dogfight at 22 events a second (the game’s own pvp:hit/fire/knock limits): not one strike', room.players.has(1) && ca.strikes <= sb, `strikes ${sb.toFixed(1)} → ${ca.strikes.toFixed(1)}, dropped.events ${room.stats.dropped.events}`);
  // A flood is still a flood.
  const C = join('Gentle Lark', 'k-c', '10.9.9.9');
  t += 2000;
  for (let i = 0; i < 200; i++) room.message(C, 'not json');
  const cc = [...room.conns.values()].find((c) => c.sock === C);
  ok('…while two hundred junk frames at once still reach sixty strikes: kicked', !!cc && cc.kickedFor === 'strikes' && C.texts().some((e) => e.t === 'kick'));
  // In its last moments on the line, the kicked socket is not heard: its seat may be somebody else's already.
  const chats = B.texts().filter((e) => e.t === 'chat').length;
  const bins = B.bins().length;
  t += 1500;
  room.message(C, JSON.stringify({ t: 'chat', m: 1 }));
  room.message(C, snapOf({ pos: { x: 5, y: 100, z: 0 } }));
  t += 100;
  room.message(C, snapOf({ pos: { x: 6, y: 100, z: 0 } }));
  ok('a kicked socket, before its line goes: its chat and its snapshots go nowhere', B.texts().filter((e) => e.t === 'chat').length === chats && B.bins().length === bins);
  room.tick(t + 400);
  // A fresh key each time from one address: the third kick keeps the address out too.
  const kickOnce = (key) => {
    const s = join('Clever Lynx', key, '10.9.9.9');
    const welcomed = s.texts()[0] && s.texts()[0].t === 'welcome';
    for (let i = 0; i < 200; i++) room.message(s, 'not json');
    t += 500;
    room.tick(t);
    return welcomed;
  };
  const w2 = kickOnce('k-c2');
  const w3 = kickOnce('k-c3');
  const back = join('Clever Lynx', 'k-c4', '10.9.9.9');
  const other = join('Clever Lynx', 'k-c5', '10.9.9.10');
  ok('kicked three times from one address with a fresh key each time: the address is kept out, another address is not', w2 && w3 && back.texts()[0].t === 'deny' && back.texts()[0].why === 'kicked' && other.texts()[0].t === 'welcome', `${back.texts()[0].t}/${back.texts()[0].why || ''}`);
}

/* ---- rate limits at the door --------------------------------------------- */
{
  const srv2 = await FakeServer.start({ env: { CONNECTS_PER_MIN: '3', LIST_PER_MIN: '2' } });
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await srv2.fetch('/lobby/busy-room', { headers: { upgrade: 'websocket' }, ip: '198.51.100.9' })).status);
  ok('CONNECTS_PER_MIN 3: the fourth and fifth join from one address are 429, another address is fine', codes.join() === '101,101,101,429,429' && (await srv2.fetch('/lobby/busy-room', { headers: { upgrade: 'websocket' }, ip: '198.51.100.10' })).status === 101, codes.join());
  const lc = [];
  for (let i = 0; i < 3; i++) lc.push((await srv2.fetch('/lobbies', { ip: '198.51.100.9' })).status);
  ok('LIST_PER_MIN 2: the third read of the list is 429 with retry-after', lc.join() === '200,200,429');
}

/* ---- the game’s client over transport.js --------------------------------- */
{
  T.forgetProbes();
  const info = await T.probeLobbyServer(srv.base, { fetchImpl: srv.fetchImpl });
  ok('probeLobbyServer: the server is there and ours', !!info && info.ok && info.v === P.PROTO && info.url === srv.base, JSON.stringify(info));
  ok('lobbyServerUrl: empty, junk and non-http(s) addresses are none; a path or slash is trimmed', T.lobbyServerUrl('') === '' && T.lobbyServerUrl('nope') === '' && T.lobbyServerUrl('ftp://x.y') === '' && T.lobbyServerUrl('https://a.b/lobby/x/') === 'https://a.b' && T.lobbyServerUrl('wss://a.b') === 'wss://a.b');
  {
    // ?lobby= is a developer's switch: honoured on localhost, ignored on the published game (a shared link must not pick players' server).
    const had = Object.getOwnPropertyDescriptor(globalThis, 'location');
    const at = (href) => Object.defineProperty(globalThis, 'location', { value: new URL(href), configurable: true, writable: true });
    at('https://bnaunidh.github.io/flightsim/?lobby=https://evil.example');
    const pub = T.lobbyServerUrl();
    at('http://localhost:8873/?lobby=https://island-lobby.example.workers.dev');
    const dev = T.lobbyServerUrl();
    at('http://127.0.0.1:8873/?lobby=http://127.0.0.1:8787');
    const dev2 = T.lobbyServerUrl();
    if (had) Object.defineProperty(globalThis, 'location', had);
    else delete globalThis.location;
    ok('?lobby= in the address: ignored on the published game, honoured on a localhost copy', pub === '' && dev === 'https://island-lobby.example.workers.dev' && dev2 === 'http://127.0.0.1:8787', `${pub || '(none)'} / ${dev} / ${dev2}`);
  }
  ok('wsUrlFor / roomIdFor: world lobby 1 → wss://…/lobby/world-<v>-1', T.wsUrlFor('https://a.b', T.roomIdFor(P.worldId(1))) === `wss://a.b/lobby/world-${P.PROTO}-1` && T.httpUrlFor('wss://a.b', '/health') === 'https://a.b/health');

  const mk = (name, key) => {
    const net = new T.CloudNet(srv.base, { WebSocketImpl: srv.WebSocket, fetchImpl: srv.fetchImpl, connectTimeoutMs: 2000 });
    const heard = [];
    const client = new S.ClientSession({ net, target: P.worldId(2), profile: { name, colour: '#4fd684', key }, onEvent: (type, ...a) => heard.push({ type, a }) });
    return { net, client, heard };
  };
  const A = mk('Brave Otter', 'ka');
  const wa = await A.client.start();
  ok('ClientSession over CloudNet: welcomed into world lobby 2 on its island, as player 1, by its own name — the session cannot tell it from a host', wa.you === 1 && wa.server.world === true && wa.server.lobby === 2 && wa.server.map === P.worldMap(2) && wa.server.name === P.worldName(2) && wa.name === 'Brave Otter' && wa.players.length === 0 && A.client.server.h, JSON.stringify(wa.server));
  const B = mk('Sunny Puffin', 'kb');
  const wb = await B.client.start();
  ok('a second: sees the first in the welcome; the first hears “join”', wb.you === 2 && wb.players.length === 1 && wb.players[0].name === 'Brave Otter' && !!(await until(() => A.heard.find((h) => h.type === 'join' && h.a[0].name === 'Sunny Puffin'))));
  // Snapshots through the sessions' own tick.
  const buf = snapOf({ seq: 7, pos: { x: 1, y: 150, z: 2 } });
  A.client.tick(A.client.now(), buf);
  const st = await until(() => B.heard.find((h) => h.type === 'state'));
  ok('A’s snapshot (ticked through the ClientSession) arrives at B as a state event under A’s id', !!st && st.a[0].id === 1 && st.a[0].seq === 7 && Math.abs(st.a[0].pos.y - 150) < 0.01);
  A.client.chat(3);
  const chat = await until(() => B.heard.find((h) => h.type === 'chat'));
  ok('A’s quick chat arrives at B with A as the speaker', !!chat && chat.a[0].name === 'Brave Otter' && chat.a[1] === 3);
  await until(async () => ((await A.net.lobbies()) || []).some((e) => e.id === T.roomIdFor(P.worldId(2)) && e.players === 2), 3000, 50);
  const pi = await A.net.pingInfo(P.worldId(2));
  const cnt = P.readLobbyCount(pi.meta);
  ok('net.pingInfo(world 2) answers from the list in a pong’s shape, which the game reads back: 2 in, on its island', pi.r === 'here' && !!cnt && cnt.players === 2 && cnt.map === P.worldMap(2) && (await A.net.ping(P.worldId(5))) === 'empty', JSON.stringify(cnt));
  // CloudWatch: the world list.
  const changes = [];
  const watch = new T.CloudWatch({ net: A.net, onChange: (l) => changes.push(l.map((x) => `${x.n}:${x.state}:${x.players}`).join(' ')), everyMs: 100 });
  watch.start();
  await until(() => changes.length);
  ok('CloudWatch: five rows in LobbyWatch’s shape — world 2 open with 2, the rest empty on their home islands; emptiest() picks an empty one', changes[0] === `1:empty:0 2:open:2 3:empty:0 4:empty:0 5:empty:0` && watch.lobbies[1].map === P.worldMap(2) && watch.lobbies[0].mapName === P.mapNameFor(P.worldMap(1)) && watch.emptiest(2).n === 1, changes[0]);
  watch.stop();
  B.client.leave();
  const lv = await until(() => A.heard.find((h) => h.type === 'leave'));
  ok('B leaves: A hears “leave … left”', !!lv && lv.a[0].name === 'Sunny Puffin' && lv.a[1] === 'left');
  A.client.leave();
  await sleep(50);
  A.net.destroy();
  B.net.destroy();

  /* ---- falling back ------------------------------------------------------- */
  T.forgetProbes();
  ok('no address configured: no probe, no cloud', (await T.probeLobbyServer('', { fetchImpl: srv.fetchImpl })) === null);
  srv.down = true;
  T.forgetProbes();
  ok('the server down: the probe says no within its timeout', (await T.probeLobbyServer(srv.base, { fetchImpl: srv.fetchImpl, ms: 300 })) === null);
  const C = mk('Gentle Lark', 'kc');
  let err = null;
  try {
    await C.client.start();
  } catch (e) {
    err = e;
  }
  ok('…and a join while it is down fails before the welcome with a reason the controller falls back on', !!err && ['ice', 'timeout', 'signaling', 'dropped'].includes(err.code), err && err.code);
  srv.down = false;
  T.forgetProbes();
  const other = await FakeServer.start({ env: {} });
  const realFetch = other.fetchImpl;
  other.fetchImpl = async (u, i) => {
    const res = await realFetch(u, i);
    if (/health/.test(String(u))) return new Response(JSON.stringify({ ok: true, v: P.PROTO + 1, max: 16 }), { headers: { 'content-type': 'application/json' } });
    return res;
  };
  ok('a server built for another protocol version: the probe says no', (await T.probeLobbyServer(other.base, { fetchImpl: other.fetchImpl })) === null);
}

/* ---- the controller: multiplayer.js joinLobby(n, world) ---------------------- */
{
  const { multiplayer: mp } = await import('../../src/features/multiplayer.js');
  const MF = await import('./multiplayer.fakes.js');
  T.forgetProbes();
  const status = [];
  const ui = { el: { hidden: false }, status: (text, kind) => status.push(`${kind || ''}:${text}`), busy() {}, offer() {}, worlds() {}, lobbies() {}, worldNet() {}, net() {} };
  // A game with only what a join reads; entering the world is stubbed — this is about which way the join goes.
  const entered = [];
  mp.sim = { state: 'menu', settings: { map: 'kestrel' }, weather: null, hud: { notify() {} }, menus: {}, prog: null, game: 'flight' };
  mp.profile = { name: 'Brave Otter', colour: '#ff5a4f', key: 'kctrl', chosen: true, ride: null };
  mp.lobbyScreen = ui;
  mp.enterWithRide = async (server, at) => {
    entered.push({ map: server.map, at });
    return { game: 'flight', type: 'skylark' };
  };
  mp.showHud = () => {};
  mp.wake = () => {};
  mp.islandWhileJoining = () => null;
  // The tab-to-tab side: the fakes the other multiplayer tests use.
  const fake = new MF.FakeSignalServer();
  const RTC = MF.makeFakeRTC();
  globalThis.RTCPeerConnection = RTC;
  mp.configure({ backend: { id: 'fake', url: 'ws://fake/peerjs', key: 'peerjs', label: 'fake' }, hash: '0123456789ab', WebSocketImpl: fake.WebSocket, lobby: null });
  const probesBefore = srv.requests.filter((u) => /health/.test(u)).length;
  ok('controller: with no lobby server configured, cloudReady() is null and nothing is probed', (await mp.cloudReady()) === null && srv.requests.filter((u) => /health/.test(u)).length === probesBefore);
  mp.configure({ backend: { id: 'fake', url: 'ws://fake/peerjs', key: 'peerjs', label: 'fake' }, hash: '0123456789ab', WebSocketImpl: fake.WebSocket, lobby: { url: srv.base, WebSocketImpl: srv.WebSocket, fetchImpl: srv.fetchImpl } });
  ok('controller: configured with the fake server, cloudReady() is its address', (await mp.cloudReady()) === srv.base && srv.requests.filter((u) => /health/.test(u)).length === probesBefore + 1);
  await mp.joinLobby(3, true);
  const room3 = srv.room(T.roomIdFor(P.worldId(3)));
  ok('joinLobby(3, world): joined THROUGH THE CLOUD — a client in world lobby 3, the room has one player, the world entered on its island, no PeerJS lobby claimed', mp.role === 'client' && !!mp.cloud && !mp.lobby && mp.server && mp.server.lobby === 3 && mp.server.world === true && !!room3 && room3.count === 1 && entered.length === 1 && entered[0].map === P.worldMap(3)
    && fake.clients.size === 0, `role ${mp.role}, status: ${status.slice(-2).join(' | ')}`);
  mp.leave();
  await until(() => room3.count === 0);
  ok('…and leave(): out of the room, the cloud net gone', mp.role === null && mp.cloud === null && room3.count === 0);
  // Now the server is down: the same join goes tab to tab, with nothing said about the cloud.
  srv.down = true;
  T.forgetProbes();
  status.length = 0;
  entered.length = 0;
  let hosted = false;
  const origTake = mp.takeLobbySession;
  mp.takeLobbySession = function (role, session, welcome) {
    hosted = role === 'host';
    return origTake.call(this, role, session, welcome);
  };
  await mp.joinLobby(3, true);
  ok('server down: joinLobby(3, world) falls back to tab-to-tab silently — this tab claims the world lobby on the fake PeerJS server and hosts it; no “cloud” word on the screen', hosted && mp.lobby && mp.lobby.world === true && !mp.cloud && entered.length === 1 && !status.some((s) => /cloud|Cloudflare/i.test(s)), `status: ${status.join(' | ')}`);
  mp.leave();
  await sleep(100);
  mp.takeLobbySession = origTake;
  srv.down = false;
  mp.configure(null);
}

/* ---- sw.js ------------------------------------------------------------------ */
{
  const { readFileSync } = await import('node:fs');
  const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  ok('sw.js: the game’s transport.js and config.js are precached; nothing under server/ is', /multiplayer\/transport\.js/.test(sw) && /multiplayer\/config\.js/.test(sw) && !/'server\//.test(sw));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  for (const f of failed) console.log(`  FAIL ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  process.exit(1);
}
process.exit(0);
