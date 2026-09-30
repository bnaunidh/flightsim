/**
 * Lobbies and usernames, for tests/features/multiplayer.mjs (which runs this
 * with its own signaling server — the fake, or a real one with --lan/--real —
 * and its own `ok`). Also runnable alone, against the fakes:
 *
 *   node tests/features/multiplayer.lobbies.mjs
 *
 * What it proves, with the shipped lobby.js, session.js and link.js:
 *   - the username lists: a few hundred words, every pair a call sign, the
 *     refused idioms refused, and every pair read against the old word filter
 *     as a mechanical second pass (ROOTS and WHOLE come from multiplayer.mjs);
 *   - the lobby list: five lobbies, counts and maps, no connection needed;
 *   - list 3: every lobby on its own island — an empty one starts there,
 *     whatever island its first player had picked;
 *   - eight in a lobby, a ninth told it is full and shown another;
 *   - a username already in the lobby refused with a free one to take, also
 *     when two ask at once;
 *   - two claiming an empty lobby at once: one host;
 *   - the host leaves, or its tab dies: the lobby re-forms round the next in
 *     line, and how long that took;
 *   - the next in line gone too: the one after claims;
 *   - split brain: a host that lost its signaling socket gives way to the
 *     tab that claimed the lobby meanwhile, and a duplicate username coming
 *     with it is refused.
 */

export async function lobbyTests(ctx) {
  const { P, S, L, Signaling, Net, backend, WS, RTC, ok, sleep, until, REAL, ROOTS = [], WHOLE = [] } = ctx;
  const untilT = (fn, ms = 3000) => until(fn, REAL ? ms * 4 : ms);
  const mkSig = (token) => new Signaling(backend, { WebSocketImpl: WS, heartbeatMs: REAL ? 5000 : 50, ...(token ? { token } : {}) });

  /* ---- the username lists ------------------------------------------- */
  {
    const A = P.CALLSIGN_ADJECTIVES;
    const N = P.CALLSIGN_NOUNS;
    const FIRST_A = ['Brave', 'Breezy', 'Bright', 'Bubbly', 'Calm', 'Cheerful', 'Chipper', 'Chirpy', 'Clever', 'Cosmic', 'Cosy', 'Curious', 'Dapper', 'Daring',
      'Dazzling', 'Eager', 'Epic', 'Fearless', 'Fluffy', 'Friendly', 'Frosty', 'Fuzzy', 'Gentle', 'Giggly', 'Glowing', 'Golden', 'Groovy', 'Happy', 'Heroic',
      'Honest', 'Jazzy', 'Jolly', 'Joyful', 'Keen', 'Kind', 'Lively', 'Loyal', 'Lucky', 'Merry', 'Mighty', 'Nimble', 'Noble', 'Peppy', 'Plucky', 'Polite',
      'Quick', 'Radiant', 'Rapid', 'Smiley', 'Snappy', 'Snazzy', 'Snowy', 'Sparkly', 'Speedy', 'Starry', 'Steady', 'Stellar', 'Sunny', 'Super', 'Swift',
      'Trusty', 'Valiant', 'Wise', 'Witty', 'Zany', 'Zippy'];
    const FIRST_N = ['Albatross', 'Condor', 'Eagle', 'Falcon', 'Finch', 'Flamingo', 'Hawk', 'Kestrel', 'Lark', 'Osprey', 'Parrot', 'Pelican', 'Penguin', 'Puffin',
      'Robin', 'Sparrow', 'Swan', 'Toucan', 'Wren', 'Dolphin', 'Narwhal', 'Octopus', 'Orca', 'Otter', 'Seahorse', 'Seal', 'Turtle', 'Alpaca', 'Badger',
      'Bumblebee', 'Butterfly', 'Dragonfly', 'Firefly', 'Gecko', 'Giraffe', 'Hedgehog', 'Kangaroo', 'Koala', 'Ladybird', 'Lemur', 'Lion', 'Llama', 'Lynx',
      'Meerkat', 'Moose', 'Panda', 'Rhino', 'Squirrel', 'Tiger', 'Wombat', 'Zebra', 'Dragon', 'Griffin', 'Phoenix', 'Unicorn', 'Yeti', 'Airship', 'Balloon',
      'Biplane', 'Comet', 'Glider', 'Jet', 'Kite', 'Pilot', 'Rocket', 'Seaplane'];
    ok('usernames: a few hundred words — over 180 adjectives and 220 animals, aircraft, space, weather and treat words',
      A.length >= 180 && N.length >= 220, `${A.length} adjectives × ${N.length} nouns = ${A.length * N.length} pairs`);
    ok('every word from the first lists is still there, so a saved username still works', FIRST_A.every((w) => A.includes(w)) && FIRST_N.every((w) => N.includes(w)));
    ok('no word is in both lists, and none is there twice', !A.some((w) => N.includes(w)) && new Set(A).size === A.length && new Set(N).size === N.length);
    const longest = Math.max(...A.map((w) => w.length)) + 1 + Math.max(...N.map((w) => w.length)) + 3;
    ok('the longest username, with a number, fits NAME_MAX', longest <= P.NAME_MAX, `${longest} ≤ ${P.NAME_MAX}`);

    // Pair by pair: every pair, as the lists make it, parses back into itself — unless it is a refused idiom.
    const banned = new Set(P.BANNED_PAIRS);
    let pairs = 0;
    let refused = 0;
    const wrong = [];
    for (const a of A) for (const n of N) {
      pairs++;
      const s = `${a} ${n}`;
      const p = P.parseCallSign(s);
      if (banned.has(s)) {
        refused++;
        if (p) wrong.push(s);
      } else if (!p || p.adjective !== a || p.noun !== n) wrong.push(s);
    }
    ok('every pair of the lists is a username, read pair by pair', wrong.length === 0, wrong.length ? wrong.slice(0, 5).join(', ') : `${pairs} pairs, ${refused} of them refused idioms`);
    const formable = P.BANNED_PAIRS.filter((s) => { const [a, n] = s.split(' '); return A.includes(a) && N.includes(n); });
    const through = P.BANNED_PAIRS.filter((s) => P.parseCallSign(s) || P.parseCallSign(`${s} 7`) || P.cleanName(s).ok);
    ok('the refused idioms: none can be made from the lists, and each is refused if it ever could be', P.BANNED_PAIRS.length >= 60 && formable.length === 0 && through.length === 0,
      `${P.BANNED_PAIRS.length} idioms; formable ${formable.join(', ') || 'none'}; through ${through.join(', ') || 'none'}`);

    // The old word filter, as a mechanical second pass over every pair: run together, and across the space.
    if (ROOTS.length) {
      const hits = [];
      for (const a of A) for (const n of N) {
        const joined = (a + n).toLowerCase();
        if (ROOTS.some((r) => joined.includes(r))) hits.push(`${a} ${n}`);
      }
      const words = [...A, ...N].filter((w) => WHOLE.includes(w.toLowerCase()) || ROOTS.some((r) => w.toLowerCase().includes(r)));
      ok('the old word filter finds nothing in any word or any pair run together', hits.length === 0 && words.length === 0, [...words, ...hits].slice(0, 5).join(', ') || `${pairs} pairs`);
    }
    let bad = 0;
    for (let i = 0; i < 5000; i++) if (!P.parseCallSign(P.randomCallSign())) bad++;
    ok('"Surprise me" only ever rolls usernames', bad === 0);
  }

  /* ---- lobby ids and the line to host ------------------------------- */
  const lh = REAL ? P.sha256Hex(`lobbies-${Math.random()}-${Date.now()}`).slice(0, 12) : P.netHashFor('192.0.2.99');
  {
    const ids = [1, 2, 3, 4, 5].map((n) => P.lobbyId(lh, n));
    ok('five lobbies, five fixed ids, read back', new Set(ids).size === 5 && ids.every((id, i) => P.lobbyOf(lh, id) === i + 1)
      && P.lobbyOf(lh, P.slotId(lh, 1)) === 0 && P.lobbyOf('000000000000', ids[0]) === 0 && P.LOBBY_NAMES.every((x) => P.parseServerName(x)));
    const line = L.successionOrder([{ id: 0, host: true, rank: 0 }, { id: 3, rank: 4 }, { id: 1, rank: 1 }, { id: 2, rank: 2 }, { id: 5, rank: 9 }]);
    ok('the line to host next: earliest to join first, never the host that went', line.join(',') === '1,2,3,5', line.join(','));
    const odd = P.readLobbyCount({ k: 'pong', n: 99, max: 99, m: 1e6, g: 'constructor', v: 2 });
    ok('a lobby host’s pong is only numbers, read against this copy’s lists', odd.players === 8 && odd.max === 8 && odd.map === null && odd.mapName === 'An island' && odd.game === 'flight');
  }

  /* ---- players ------------------------------------------------------ */
  const everyone = [];
  const ticker = setInterval(() => {
    const t = performance.now();
    for (const m of everyone) m.tick(t);
  }, 40);
  async function member(n, name, place = { map: 'kestrel', game: 'flight' }, extra = {}) {
    const sig = mkSig();
    await sig.open(P.playerPeerId());
    const net = new Net(sig, { RTC });
    const events = [];
    const m = new L.LobbyMember({
      n, hash: lh, net, makeSig: mkSig, profile: { name, colour: P.COLOURS[everyone.length % 8], key: `k-${everyone.length}-${Math.random().toString(36).slice(2, 8)}` },
      place: () => place, onEvent: (...e) => events.push(e), netOpts: { RTC }, stepMs: REAL ? 1500 : 300, ...extra,
    });
    m.events = events;
    m.lookSig = sig;
    everyone.push(m);
    return m;
  }
  const enter = async (m) => {
    try {
      return { r: await m.start() };
    } catch (err) {
      return { err };
    }
  };
  const hostsOf = (n, list = everyone) => list.filter((m) => m.n === n && !m.left && m.isHost);
  const inLobby = (n, list = everyone) => list.filter((m) => m.n === n && !m.left && m.session);

  // The list, before anybody is anywhere.
  const wsig = mkSig();
  await wsig.open(P.playerPeerId());
  const watch = new L.LobbyWatch({ net: new Net(wsig, { RTC }), hash: lh, everyMs: REAL ? 1500 : 60 });
  watch.start();
  await untilT(() => watch.lobbies.every((l) => l.state === 'empty'));
  ok('the lobby list: five lobbies, all empty, with their own names', watch.lobbies.every((l) => l.state === 'empty') && watch.lobbies.map((l) => l.name).join('|') === P.LOBBY_NAMES.join('|'),
    watch.lobbies.map((l) => `${l.n}:${l.state}`).join(' '));
  const isles = watch.lobbies.map((l) => l.mapName);
  ok('list 3: and each on its own island, known before anybody is in it — five different ones', watch.lobbies.every((l, i) => l.map === P.LOBBY_MAPS[i] && l.home === P.LOBBY_MAPS[i])
    && new Set(isles).size === 5 && isles.join('|') === 'Kestrel Island|Coral Atoll|Aurora Fjords|Ember Isle|Gateway International', isles.join(', '));

  // The first player into lobby 3 hosts it — on the lobby's island (Aurora Fjords), not the one they had picked (list 3).
  const names = ['Swift Falcon', 'Brave Otter', 'Sunny Puffin', 'Jolly Penguin', 'Clever Koala', 'Mighty Moose', 'Gentle Lark', 'Happy Hedgehog', 'Plucky Puffin'];
  const a = await member(3, names[0], { map: 'atoll', game: 'flight' });
  const ra = await enter(a);
  ok('the first player into an empty lobby hosts it — on the lobby’s own island, not the one they had picked', ra.r && ra.r.role === 'host' && a.server.map === 'fjord' && a.server.name === 'Cloud Base' && a.server.lobby === 3,
    ra.err ? ra.err.code : `${ra.r.role} ${a.server.name} ${a.server.map} (picked atoll)`);
  await untilT(() => watch.lobbies[2].state === 'open');
  const l3 = watch.lobbies[2];
  ok('and the list shows it: 1/8, on Aurora Fjords, with no connection opened to find out', l3.state === 'open' && l3.players === 1 && l3.max === 8 && l3.mapName === 'Aurora Fjords',
    `${l3.state} ${l3.players}/${l3.max} ${l3.mapName}`);

  // Six more.
  const crew = [];
  for (const name of names.slice(1, 7)) crew.push(await member(3, name, { map: 'kestrel', game: 'boat' }));
  const rs = await Promise.all(crew.map(enter));
  ok('six more join lobby 3, each told the lobby’s map, not their own', rs.every((x) => x.r && x.r.role === 'client' && x.r.welcome.server.map === 'fjord' && x.r.welcome.server.max === 8),
    rs.map((x) => (x.err ? x.err.code : x.r.role)).join(','));

  // A username already there: refused, with one that is free.
  const dup = await member(3, 'Brave Otter');
  const rd = await enter(dup);
  const taken = [a, ...crew].map((m) => (m.isHost ? m.session.me.name : m.session.name));
  ok('a username already in the lobby is refused, with a free one to take', rd.err && rd.err.code === 'name' && P.parseCallSign(rd.err.suggest) && !taken.includes(rd.err.suggest),
    rd.err ? `${rd.err.code} → ${rd.err.suggest}` : 'let in');
  dup.leave();

  // The eighth, and a ninth.
  const eighth = await member(3, names[7]);
  const r8 = await enter(eighth);
  crew.push(eighth);
  await untilT(() => a.session.count === 8 && crew.every((m) => m.session && m.session.players.size === 7));
  ok('eight in one lobby, and every one of them sees the other seven', r8.r && a.session.count === 8 && crew.every((m) => m.session.players.size === 7),
    `${a.session.count} in; ${crew.map((m) => m.session && m.session.players.size).join(',')}`);
  const ranks = a.session.roster().map((p) => p.rank);
  ok('the host gives each a place in the line, in the order they came', ranks[0] === 0 && new Set(ranks).size === 8, ranks.join(','));
  const ninth = await member(3, names[8]);
  const r9 = await enter(ninth);
  await untilT(() => watch.lobbies[2].state === 'full');
  const other = watch.emptiest(3);
  ok('a ninth is told it is full, and the list offers another lobby with room', r9.err && r9.err.code === 'full' && watch.lobbies[2].state === 'full' && other && other.n !== 3,
    `${r9.err && r9.err.code}; lobby 3 ${watch.lobbies[2].players}/8 ${watch.lobbies[2].state}; offered lobby ${other && other.n}`);
  ninth.left = true;

  // Nobody in a lobby can lock it or remove anybody.
  ok('in a lobby the host cannot lock, and cannot kick', a.session.setLocked(true) === false && a.session.kick(1) === false && a.session.count === 8 && !a.session.locked);

  // Two ask for the same username at the same moment, in lobby 2.
  const l2host = await member(2, 'Kind Koala');
  await enter(l2host);
  const twinA = await member(2, 'Radiant Robin');
  const twinB = await member(2, 'Radiant Robin');
  const twins = await Promise.all([enter(twinA), enter(twinB)]);
  const inTwins = twins.filter((x) => x.r).length;
  const nameErr = twins.find((x) => x.err);
  ok('two joining at once with the same username: one is in, the other is refused', inTwins === 1 && nameErr && nameErr.err.code === 'name' && l2host.session.count === 2,
    twins.map((x) => (x.err ? x.err.code : x.r.role)).join(','));

  // Two claim an empty lobby at the same moment, in lobby 4: one host.
  const c1 = await member(4, 'Trusty Toucan', { map: 'meadow', game: 'flight' });
  const c2 = await member(4, 'Lucky Llama', { map: 'fjord', game: 'flight' });
  const claims = await Promise.all([enter(c1), enter(c2)]);
  ok('two arriving at an empty lobby together: one hosts, the other joins them — on Ember Isle, whichever claimed it', claims.every((x) => x.r) && hostsOf(4).length === 1 && inLobby(4).length === 2
    && c1.server.map === 'ember' && c2.server.map === 'ember', claims.map((x) => (x.err ? x.err.code : x.r.role)).join(','));

  await untilT(() => watch.lobbies[1].players === 2 && watch.lobbies[3].players === 2);
  const shown = watch.lobbies.map((l) => `${l.n}:${l.players}`).join(' ');
  ok('the list: all five lobbies with the right counts', shown === '1:0 2:2 3:8 4:2 5:0', shown);

  /* ---- the host leaves: the lobby re-forms -------------------------- */
  const stay = [...crew];
  const next = stay.slice().sort((x, y) => x.session.rank - y.session.rank)[0];
  const t0 = performance.now();
  a.leave();
  await untilT(() => hostsOf(3).length === 1 && inLobby(3).length === 7 && hostsOf(3)[0].session.count === 7, 15000);
  const reform1 = performance.now() - t0;
  const h3 = hostsOf(3);
  ok('the host leaves: the lobby re-forms by itself, round the player who joined next', h3.length === 1 && h3[0] === next && inLobby(3).length === 7 && h3[0].session.count === 7,
    `${Math.round(reform1)} ms; host ${h3.map((m) => m.profile.name).join(',')} (next in line: ${next.profile.name}); ${h3[0] && h3[0].session.count} in`);
  ok('everybody was told "reconnecting" and nobody was put out', stay.every((m) => m.events.some((e) => e[0] === 'reconnecting')) && !stay.some((m) => m.events.some((e) => e[0] === 'out')));
  ok('the lobby kept its map', stay.every((m) => m.server && m.server.map === 'fjord'));
  const reNames = h3[0].session.roster().map((p) => p.name);
  ok('and every username in it is still one of a kind', new Set(reNames).size === reNames.length && reNames.length === 7, reNames.join(', '));
  await untilT(() => stay.every((m) => m.session && (m.isHost ? m.session.count === 7 : m.session.players.size === 6)));
  ok('every player sees the other six again', stay.every((m) => m.session && (m.isHost || m.session.players.size === 6)));

  /* ---- the new host's tab dies without a word ----------------------- */
  const dead = h3[0];
  const left6 = stay.filter((m) => m !== dead);
  const next2 = left6.slice().sort((x, y) => x.session.rank - y.session.rank)[0];
  const t1 = performance.now();
  // A closed tab: its sockets drop and its connections die; nothing is sent.
  dead.left = true;
  const hs = dead.session;
  hs.closed = true;
  for (const p of hs.players.values()) p.link.pc.close();
  dead.sig && dead.sig.ws && dead.sig.ws.close();
  await untilT(() => hostsOf(3, left6).length === 1 && inLobby(3, left6).length === 6 && hostsOf(3, left6)[0].session.count === 6, 20000);
  const reform2 = performance.now() - t1;
  ok('the host’s tab dies without a word: the lobby re-forms round the next in line', hostsOf(3, left6).length === 1 && hostsOf(3, left6)[0] === next2 && hostsOf(3, left6)[0].session.count === 6,
    `${Math.round(reform2)} ms; host ${hostsOf(3, left6).map((m) => m.profile.name).join(',')} (next: ${next2.profile.name})`);

  /* ---- the next in line has gone too -------------------------------- */
  const h4 = hostsOf(4)[0];
  const j4 = inLobby(4).find((m) => !m.isHost);
  const late = await member(4, 'Honest Hawk');
  await enter(late);
  await untilT(() => h4.session.count === 3 && j4.session.players.size === 2 && late.session.players.size === 2);
  const t2 = performance.now();
  j4.leave();
  h4.leave();
  await untilT(() => late.isHost, 15000);
  ok('the host and the next in line both go: the one after claims the lobby, a step later', late.isHost && late.session.count === 1,
    `${Math.round(performance.now() - t2)} ms`);

  /* ---- split brain -------------------------------------------------- */
  // Lobby 5: P hosts, Q is in. P's signaling socket drops; before P can take the id back, X claims it.
  const p5 = await member(5, 'Groovy Gecko', { map: 'ember', game: 'flight' });
  await enter(p5);
  const q5 = await member(5, 'Dapper Dragon');
  const r5 = await member(5, 'Loyal Lynx');
  await enter(q5);
  await enter(r5);
  const slow = p5.makeSig;
  p5.makeSig = (tok) => {
    const sgl = slow(tok);
    const open = sgl.open.bind(sgl);
    sgl.open = async (id) => {
      await sleep(REAL ? 3000 : 400);
      return open(id);
    };
    return sgl;
  };
  const x5 = await member(5, 'Dapper Dragon', { map: 'kestrel', game: 'flight' });
  const y5 = await member(5, 'Fuzzy Finch', { map: 'kestrel', game: 'flight' });
  const tSplit = performance.now();
  p5.sig.ws.close();
  const rx = await enter(x5);
  await enter(y5);
  ok('split brain, set up: P lost its socket and X claimed lobby 5 meanwhile', rx.r && rx.r.role === 'host' && p5.isHost, `${rx.r && rx.r.role}; P host ${p5.isHost}`);
  await untilT(() => !p5.isHost && p5.session && q5.left && r5.session && x5.session.count === 4, 15000);
  const split = performance.now() - tSplit;
  ok('P finds the id taken and gives way: one host, the one holding the id', hostsOf(5).length === 1 && hostsOf(5)[0] === x5 && !p5.isHost && p5.session && r5.session,
    `two believed they hosted for ${Math.round(split)} ms; hosts now ${hostsOf(5).map((m) => m.profile.name).join(',')}; ${x5.session.count} in`);
  const outQ = q5.events.find((e) => e[0] === 'out');
  ok('P’s players move to X; the one whose username X’s lobby already has is refused, not doubled', outQ && outQ[1] === 'name'
    && new Set(x5.session.roster().map((p) => p.name)).size === x5.session.count, `${outQ && outQ[1]}; ${x5.session.roster().map((p) => p.name).join(', ')}`);

  /* ---- a host whose lobby socket the server let go without a word ----- */
  let quiet = null;
  if (ctx.server) {
    const qa = await member(1, 'Snazzy Seal', { map: 'kestrel', game: 'flight' }, { verifyEveryMs: 250 });
    await enter(qa);
    const qb = await member(1, 'Keen Kestrel', { map: 'kestrel', game: 'flight' }, { verifyEveryMs: 250 });
    await enter(qb);
    // The signaling server forgets the host's lobby socket; nothing reaches the host's tab.
    ctx.server._disconnect(qa.sig.ws);
    const qx = await member(1, 'Zany Zebra', { map: 'kestrel', game: 'flight' }, { verifyEveryMs: 250 });
    const tq = performance.now();
    const rq = await enter(qx);
    await untilT(() => !qa.isHost && hostsOf(1).length === 1 && qx.session && qx.session.count === 3 && qa.session && qb.session, 8000);
    quiet = Math.round(performance.now() - tq);
    ok('a host whose lobby socket was dropped without a word finds out by itself and gives way', rq.r && rq.r.role === 'host' && hostsOf(1).length === 1 && hostsOf(1)[0] === qx
      && !qa.isHost && qa.session && qb.session && qx.session.count === 3,
      `two believed they hosted for ${quiet} ms; ${qa.history.map((h) => h.why).join(', ')}; x ${qx.session && qx.session.count}, a ${qa.role}${qa.left ? ' out' : ''}, b ${qb.role}${qb.left ? ' out' : ''}`);
  }

  // Numbers for the report.
  const hist = everyone.flatMap((m) => m.history.filter((h) => h.ms != null).map((h) => h.ms));
  ctx.lobbyNumbers = { reformLeaveMs: Math.round(reform1), reformDeadMs: Math.round(reform2), splitBrainMs: Math.round(split), quietDropMs: quiet, rejoinMs: hist };

  clearInterval(ticker);
  watch.stop();
  for (const m of everyone) {
    if (!m.left) m.leave();
  }
  await sleep(REAL ? 1000 : 300);
  for (const m of everyone) m.lookSig.close();
  wsig.close();
}

/* Alone: against the fakes. */
if (import.meta.url === `file://${process.argv[1]}`) {
  global.document = { createElement: () => ({ getContext: () => null, style: {} }), body: { appendChild() {} } };
  const results = [];
  const ok = (name, pass, detail = '') => {
    results.push(!!pass);
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
    return !!pass;
  };
  const P = await import('../../src/features/multiplayer/protocol.js');
  const S = await import('../../src/features/multiplayer/session.js');
  const L = await import('../../src/features/multiplayer/lobby.js');
  const { Signaling, PUBLIC_BACKEND } = await import('../../src/features/multiplayer/signaling.js');
  const { Net } = await import('../../src/features/multiplayer/link.js');
  const { FakeSignalServer, makeFakeRTC, sleep, until } = await import('./multiplayer.fakes.js');
  // --real: the signaling half against the public PeerJS server (WebRTC is still the fake; the network hash is random).
  const REAL = process.argv.includes('--real');
  const server = REAL ? null : new FakeSignalServer();
  const ctx = {
    P, S, L, Signaling, Net, backend: REAL ? PUBLIC_BACKEND : { url: 'wss://fake.test/peerjs', key: 'peerjs' },
    WS: REAL ? globalThis.WebSocket : server.WebSocket, RTC: makeFakeRTC(), ok, sleep, until, REAL, server,
  };
  await lobbyTests(ctx);
  console.log(JSON.stringify(ctx.lobbyNumbers));
  const bad = results.filter((x) => !x).length;
  console.log(`\n${results.length - bad}/${results.length} passed`);
  process.exit(bad ? 1 : 0);
}
