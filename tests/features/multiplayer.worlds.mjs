/**
 * List 3's lobbies: each on its own island, and the WORLD lobbies — for
 * tests/features/multiplayer.mjs (which runs this with its own signaling
 * server and its own `ok`), or alone against the fakes:
 *
 *   node tests/features/multiplayer.worlds.mjs
 *
 * What it proves, with the shipped lobby.js, session.js and link.js:
 *   - world lobby ids: five, the same for everybody, this version's own,
 *     never mistaken for a Wi-Fi lobby's; their names and islands from the
 *     lists, every island one an aeroplane can fly from;
 *   - two players on two different networks ("Palo Alto" and "Berkeley",
 *     two Wi-Fi hashes): their Wi-Fi lobby lists are different, their world
 *     lists are the same, and they meet in a world lobby — on its island;
 *   - a world lobby is kid-safe the same way a Wi-Fi one is: eight at most, a
 *     ninth refused, a username already in it refused, no Kick, no Lock, and
 *     a player's name for the lobby is their own copy's, whatever the host
 *     says;
 *   - it connects the way a join by code does: STUN servers asked, the
 *     public IPv4 sent, the IPv6 kept back;
 *   - its host goes: it re-forms round the next in line, on the same island;
 *   - no path on the first try (two strict networks): the second goes
 *     through a relay when one is configured, as a join by code's does;
 *   - gentle on the public server: the world list asks each lobby every
 *     eight seconds, spread out, nothing while the tab is hidden, backs off
 *     while the server is out of reach, and a list opened again straight
 *     after shows what was seen and asks nothing until it is due.
 */

export async function worldTests(ctx) {
  const { P, L, Signaling, Net, backend, WS, RTC, ok, sleep, until, REAL } = ctx;
  const untilT = (fn, ms = 3000) => until(fn, REAL ? ms * 4 : ms);
  const mkSig = (token) => new Signaling(backend, { WebSocketImpl: WS, heartbeatMs: REAL ? 5000 : 50, ...(token ? { token } : {}) });
  const { MAPS, mapsForGame } = await import('../../src/world/maps.js');

  /* ---- ids, names, islands ------------------------------------------ */
  {
    const ids = [1, 2, 3, 4, 5].map((n) => P.worldId(n));
    const flight = mapsForGame('flight').map((m) => m.id);
    ok('world lobbies: five fixed ids, the same for everybody, read back — and never a Wi-Fi lobby’s',
      new Set(ids).size === 5 && ids.every((id, i) => P.worldOf(id) === i + 1 && id.length <= 64) && P.worldOf(P.lobbyId('0123456789ab', 1)) === 0
        && P.lobbyOf('0123456789ab', ids[0]) === 0 && P.worldOf('ifs-world-1-1') === 0 && P.worldOf(`ifs-world-${P.PROTO}-9`) === 0, ids.join(' '));
    ok('world lobby ids carry this version, so an old copy somewhere holds its own five and locks nobody out', ids.every((id) => id.startsWith(`ifs-world-${P.PROTO}-`)));
    ok('world lobby names are server names from the lists, and differ from the Wi-Fi lobbies’', P.WORLD_NAMES.every((x) => P.parseServerName(x)) && !P.WORLD_NAMES.some((x) => P.LOBBY_NAMES.includes(x)),
      P.WORLD_NAMES.join(', '));
    const locked = MAPS.filter((m) => m.passcode || m.needsPasscode || m.military).map((m) => m.id);
    ok('every lobby’s island, Wi-Fi and World, is a flight island with no passcode, and each row has five different ones',
      [...P.LOBBY_MAPS, ...P.WORLD_MAPS].every((id) => flight.includes(id) && !['airbase', 'northwatch'].includes(id) && !locked.includes(id))
        && new Set(P.LOBBY_MAPS).size === 5 && new Set(P.WORLD_MAPS).size === 5,
      `Wi-Fi: ${P.LOBBY_MAPS.map(P.mapNameFor).join(', ')}; World: ${P.WORLD_MAPS.map(P.mapNameFor).join(', ')}`);
    ok('"Lobby 3" and "World 3": what the screen and the badge call them', P.lobbyLabel(3) === 'Lobby 3' && P.lobbyLabel(3, true) === 'World 3');
  }

  /*
   * Never against the public server (--real): the world lobbies' ids are the
   * real ones, the same for every child on the internet, and a test host
   * there would show up on their lists. --lan (tools/lan-server.py) is fine.
   */
  if (/0\.peerjs\.com/.test(String(backend && backend.url))) {
    ok('world lobbies: the rest is not run against the public server — its world lobbies are real children’s', true, 'skipped with --real');
    return;
  }

  /* ---- two towns, one world ------------------------------------------ */
  const everyone = [];
  const ticker = setInterval(() => {
    const t = performance.now();
    for (const m of everyone) m.tick(t);
  }, 40);
  const paloAlto = REAL ? P.sha256Hex(`pa-${Math.random()}`).slice(0, 12) : P.netHashFor('198.51.100.10');
  const berkeley = REAL ? P.sha256Hex(`bk-${Math.random()}`).slice(0, 12) : P.netHashFor('203.0.113.20');
  async function member(n, name, hash, world, place = { map: 'kestrel', game: 'flight' }, extra = {}) {
    const sig = mkSig();
    await sig.open(P.playerPeerId());
    const net = new Net(sig, { RTC });
    const events = [];
    const m = new L.LobbyMember({
      n, hash, world, net, makeSig: mkSig, profile: { name, colour: P.COLOURS[everyone.length % 8], key: `w-${everyone.length}-${Math.random().toString(36).slice(2, 8)}` },
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
  const hostsOf = (n, list = everyone) => list.filter((m) => m.world && m.n === n && !m.left && m.isHost);
  const inWorld = (n, list = everyone) => list.filter((m) => m.world && m.n === n && !m.left && m.session);

  L.forgetLobbyLists();
  const watchers = [];
  const watchFor = async (hash, world) => {
    const sig = mkSig();
    await sig.open(P.playerPeerId());
    const w = new L.LobbyWatch({ net: new Net(sig, { RTC }), hash, world, everyMs: REAL ? 1500 : 60, freshMs: 1 });
    w.sig = sig;
    w.start();
    watchers.push(w);
    return w;
  };
  const paWifi = await watchFor(paloAlto, false);
  const bkWifi = await watchFor(berkeley, false);
  const paWorld = await watchFor(paloAlto, true);
  const bkWorld = await watchFor(berkeley, true);
  await untilT(() => [paWifi, bkWifi, paWorld, bkWorld].every((w) => w.lobbies.every((l) => l.state === 'empty')));
  ok('two towns: each sees five Wi-Fi lobbies of its own and the same five world lobbies, each on its island',
    paWorld.lobbies.map((l) => l.id).join() === bkWorld.lobbies.map((l) => l.id).join() && paWifi.lobbies[0].id !== bkWifi.lobbies[0].id
      && paWorld.lobbies.every((l, i) => l.state === 'empty' && l.name === P.WORLD_NAMES[i] && l.map === P.WORLD_MAPS[i] && l.world),
    paWorld.lobbies.map((l) => `${l.name} (${l.mapName})`).join(', '));

  // Palo Alto starts World 3 — on its island, Skyline Airport's Gateway International — whatever it had picked.
  const pa = await member(3, 'Swift Falcon', paloAlto, true, { map: 'atoll', game: 'flight' });
  const rpa = await enter(pa);
  ok('the first into an empty world lobby hosts it, on the lobby’s own island', rpa.r && rpa.r.role === 'host' && pa.server.map === 'gateway' && pa.server.world === true
    && pa.server.name === 'Skyline Airport' && pa.session.mode === 'lobby', rpa.err ? rpa.err.code : `${pa.server.name}, ${pa.server.map}`);
  await untilT(() => bkWorld.lobbies[2].state === 'open' && paWifi.lobbies[2].state === 'empty');
  ok('Berkeley’s list shows it (1/8, Gateway International); nobody’s Wi-Fi list does',
    bkWorld.lobbies[2].players === 1 && bkWorld.lobbies[2].mapName === 'Gateway International' && paWifi.lobbies.every((l) => l.state === 'empty') && bkWifi.lobbies.every((l) => l.state === 'empty'),
    `${bkWorld.lobbies[2].state} ${bkWorld.lobbies[2].players}/8 ${bkWorld.lobbies[2].mapName}`);

  // Berkeley joins it.
  const bk = await member(3, 'Brave Otter', berkeley, true, { map: 'kestrel', game: 'boat' });
  const rbk = await enter(bk);
  ok('Berkeley joins Palo Alto’s world lobby, and is told its island and its name from its own copy',
    rbk.r && rbk.r.role === 'client' && rbk.r.welcome.server.map === 'gateway' && rbk.r.welcome.server.world === true && rbk.r.welcome.server.lobby === 3
      && rbk.r.welcome.server.name === 'Skyline Airport', rbk.err ? rbk.err.code : JSON.stringify(rbk.r.welcome.server));
  await untilT(() => pa.session.count === 2 && bk.session.players.size === 1);
  // How it connected: the way a join by code does.
  const cl = bk.session.link;
  const hl = [...pa.session.players.values()][0].link;
  await untilT(() => cl.candidates.sent + cl.candidates.kept >= 4 && hl.candidates.sent + hl.candidates.kept >= 4);
  ok('a world lobby connects across networks the way a join by code does: STUN asked, the public IPv4 sent, the IPv6 kept back',
    cl.share === 'v4' && hl.share === 'v4' && cl.pc.cfg.iceServers.length > 0 && hl.pc.cfg.iceServers.length > 0 && cl.candidates.sent === 2 && cl.candidates.kept === 2,
    `joiner ${cl.share} sent ${cl.candidates.sent} kept ${cl.candidates.kept}; host ${hl.share} sent ${hl.candidates.sent} kept ${hl.candidates.kept}`);
  const wifiHost = await member(2, 'Kind Koala', paloAlto, false);
  await enter(wifiHost);
  const wifiJoin = await member(2, 'Lucky Llama', paloAlto, false);
  await enter(wifiJoin);
  ok('while a Wi-Fi lobby still sends no public address at all, and asks no STUN server', wifiJoin.session.link.share === 'lan' && wifiJoin.session.link.pc.cfg.iceServers.length === 0
    && wifiHost.session.server.map === 'atoll' && !wifiHost.session.server.world, `${wifiJoin.session.link.share}, ${wifiHost.session.server.map}`);
  wifiJoin.leave();
  wifiHost.leave();

  // Kid-safe the same way: a username already in it, no Kick, no Lock.
  const dup = await member(3, 'Brave Otter', paloAlto, true);
  const rd = await enter(dup);
  ok('a username already in a world lobby is refused, with a free one to take', rd.err && rd.err.code === 'name' && P.parseCallSign(rd.err.suggest) && rd.err.suggest !== 'Brave Otter',
    rd.err ? `${rd.err.code} → ${rd.err.suggest}` : 'let in');
  dup.left = true;
  ok('in a world lobby nobody can Lock or Kick', pa.session.setLocked(true) === false && pa.session.kick(1) === false);

  // Six more, from all over: eight, and a ninth refused.
  const far = ['Sunny Puffin', 'Jolly Penguin', 'Clever Koala', 'Mighty Moose', 'Gentle Lark', 'Happy Hedgehog'];
  const crew = [];
  for (const [i, name] of far.entries()) crew.push(await member(3, name, P.netHashFor(`192.0.2.${10 + i}`), true));
  const rs = await Promise.all(crew.map(enter));
  await untilT(() => pa.session.count === 8);
  const ninth = await member(3, 'Plucky Puffin', berkeley, true);
  const r9 = await enter(ninth);
  ninth.left = true;
  await untilT(() => bkWorld.lobbies[2].state === 'full');
  const other = bkWorld.emptiest(3);
  ok('eight in a world lobby from eight networks, and a ninth told it is full and shown another world lobby',
    rs.every((x) => x.r) && pa.session.count === 8 && r9.err && r9.err.code === 'full' && other && other.world && other.n !== 3,
    `${pa.session.count} in; ninth ${r9.err && r9.err.code}; offered World ${other && other.n}`);

  // A modified host that says its lobby is somewhere else, and called something else: this copy's own name for the id it asked.
  {
    const S = ctx.S;
    const lsig = mkSig();
    await lsig.open(P.worldId(5));
    const liar = new S.HostSession({
      mode: 'lobby', profile: { name: 'Zany Zebra', colour: P.COLOURS[2], key: 'liar-liar-liar-liar1' },
      server: { name: 'Anything At All', map: 'condor', game: 'flight', lobby: 2, world: false },
    });
    liar.attach(new Net(lsig, { RTC }));
    const tick = setInterval(() => liar.tick(performance.now()), 40);
    const j = await member(5, 'Lucky Lark', berkeley, true);
    const rj = await enter(j);
    ok('a world lobby’s name and number are this copy’s own, from the id it asked for — never what the host says',
      rj.r && rj.r.welcome.server.world === true && rj.r.welcome.server.lobby === 5 && rj.r.welcome.server.name === 'Glacier Station',
      rj.r ? `${rj.r.welcome.server.name}, lobby ${rj.r.welcome.server.lobby}` : rj.err.code);
    j.leave();
    clearInterval(tick);
    liar.close();
    lsig.close();
  }

  // Palo Alto's host goes: the lobby re-forms round the next in line — Berkeley — on the same island.
  const t0 = performance.now();
  pa.leave();
  await untilT(() => hostsOf(3).length === 1 && inWorld(3).length === 7 && hostsOf(3)[0].session.count === 7, 20000);
  const h3 = hostsOf(3)[0];
  ok('the world lobby’s host leaves: it re-forms round the next in line, on the same island, still a world lobby',
    h3 === bk && h3.server.map === 'gateway' && h3.server.world === true && inWorld(3).every((m) => m.server.map === 'gateway'),
    `${Math.round(performance.now() - t0)} ms; host ${h3 && h3.profile.name}; ${h3 && h3.session.count} in`);
  const aClient = inWorld(3).find((m) => !m.isHost);
  ok('and a world lobby asks the matchmaking server half as often as a Wi-Fi one while it hosts and re-forms, and waits longer before asking whether a quiet host has gone',
    bk.world && bk.pace === 2 && bk.verifyEveryMs === L.WORLD_VERIFY_MS && L.WORLD_VERIFY_MS >= 6000 && aClient && aClient.session.goneQuietMs === L.WORLD_GONE_QUIET_MS,
    `verify every ${bk.verifyEveryMs} ms, pace ×${bk.pace}, a quiet host asked about after ${aClient && aClient.session.goneQuietMs} ms`);

  /* ---- no path on the first try: the second through a relay ----------- */
  if (ctx.makeFakeRTC && !REAL) {
    const { RELAY_SERVERS } = await import('../../src/features/multiplayer/link.js');
    RELAY_SERVERS.push({ urls: 'turn:relay.invalid:3478', username: 'test', credential: 'test' });
    let pairs = 0;
    const RTC2 = ctx.makeFakeRTC({ fail: () => pairs++ === 0 });
    try {
      const hsig = mkSig();
      await hsig.open(P.playerPeerId());
      const h = new L.LobbyMember({ n: 4, world: true, hash: paloAlto, net: new Net(hsig, { RTC: RTC2 }), makeSig: mkSig, netOpts: { RTC: RTC2 },
        profile: { name: 'Keen Kestrel', colour: P.COLOURS[4], key: 'relay-host-relay-hos' }, stepMs: 300 });
      await h.start();
      const tk = setInterval(() => h.tick(performance.now()), 40);
      const jsig = mkSig();
      await jsig.open(P.playerPeerId());
      const said = [];
      const j = new L.LobbyMember({ n: 4, world: true, hash: berkeley, net: new Net(jsig, { RTC: RTC2 }), makeSig: mkSig, netOpts: { RTC: RTC2 },
        profile: { name: 'Merry Moose', colour: P.COLOURS[5], key: 'relay-join-relay-joi' }, stepMs: 300, onEvent: (t, ...a) => said.push([t, ...a]) });
      const rj = await j.start().then((r) => ({ r }), (err) => ({ err }));
      const pol = rj.r ? rj.r.session.link.pc.cfg.iceTransportPolicy : null;
      ok('a world lobby’s host with no path on the first try: the second goes through a relay (when one is configured), and it is said',
        rj.r && rj.r.role === 'client' && j.pathFails === 1 && pol === 'relay' && said.some((e) => e[0] === 'trying') && j.enterGiveUpMs === L.WORLD_ENTER_GIVE_UP_MS && L.WORLD_ENTER_GIVE_UP_MS >= 50000,
        rj.err ? rj.err.code : `in on try ${j.pathFails + 1}, policy ${pol}; gives up after ${j.enterGiveUpMs / 1000} s`);
      clearInterval(tk);
      j.leave();
      h.leave();
      await sleep(100);
      hsig.close();
      jsig.close();
    } finally {
      RELAY_SERVERS.length = 0;
    }
  }

  /* ---- gentle on the public server ----------------------------------- */
  for (const w of watchers) w.stop();
  {
    L.forgetLobbyLists();
    const sig = mkSig();
    await sig.open(P.playerPeerId());
    const net = new Net(sig, { RTC });
    const first = new L.LobbyWatch({ net, world: true });
    first.start();
    await sleep(REAL ? 1500 : 300);
    const early = first.asked;
    ok('the world list asks each lobby every eight seconds, spread out — one question in its first moment, not five',
      first.everyMs === L.WORLD_EVERY_MS && L.WORLD_EVERY_MS >= 8000 && early === 1, `${early} asked in the first ${REAL ? 1500 : 300} ms; every ${first.everyMs} ms each`);
    first.stop();
    // Seen a moment ago: shown at once, nothing asked until it is due.
    const again = new L.LobbyWatch({ net, world: true });
    let painted = null;
    again.onChange = (list) => { painted = list.map((l) => l.state).join(','); };
    again.start();
    await sleep(REAL ? 500 : 100);
    ok('the world list opened again straight after shows what was seen, and asks the server nothing yet',
      again.asked === 0 && again.lobbies[0].state !== 'looking' && painted && painted.startsWith(again.lobbies[0].state), `${again.asked} asked; shown ${painted}`);
    again.stop();
    // A hidden tab asks nothing.
    L.forgetLobbyLists();
    const hidden = new L.LobbyWatch({ net, world: true, everyMs: 40, active: () => false });
    hidden.start();
    await sleep(200);
    ok('a hidden tab’s world list asks the server nothing', hidden.asked === 0, `${hidden.asked} asked`);
    hidden.stop();
    // Out of reach: further and further apart.
    const deadSig = mkSig();
    await deadSig.open(P.playerPeerId());
    const deadNet = new Net(deadSig, { RTC });
    deadSig.close();
    const off = new L.LobbyWatch({ net: deadNet, world: true, everyMs: 20 });
    off.start();
    await sleep(700);
    const l1 = off.lobbies[0];
    ok('with the server out of reach it asks less and less often (up to eight times as far apart), not in a storm',
      l1.backoff === 8 && off.asked < 5 * 8, `${off.asked} tries in 0.7 s at a 20 ms step; backoff ×${l1.backoff}`);
    off.stop();
    net.destroy();
    sig.close();
  }

  clearInterval(ticker);
  for (const m of everyone) if (!m.left) m.leave();
  await sleep(REAL ? 1000 : 300);
  for (const m of everyone) m.lookSig.close();
  for (const w of watchers) w.sig.close();
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
  const { Signaling } = await import('../../src/features/multiplayer/signaling.js');
  const { Net } = await import('../../src/features/multiplayer/link.js');
  const { FakeSignalServer, makeFakeRTC, sleep, until } = await import('./multiplayer.fakes.js');
  const server = new FakeSignalServer();
  const ctx = {
    P, S, L, Signaling, Net, backend: { url: 'wss://fake.test/peerjs', key: 'peerjs' },
    WS: server.WebSocket, RTC: makeFakeRTC(), makeFakeRTC, ok, sleep, until, REAL: false, server,
  };
  await worldTests(ctx);
  const bad = results.filter((x) => !x).length;
  console.log(`\n${results.length - bad}/${results.length} passed`);
  process.exit(bad ? 1 : 0);
}
