/**
 * Joining a lobby, step by step — for tests/features/multiplayer.mjs (which
 * runs this with its own signaling server: the fake, or a real one with
 * --lan/--real), or alone, against the fakes:
 *
 *   node tests/features/multiplayer.join.mjs
 *
 * The owner, twice: "it takes forever to join lobbies" / "it takes forever to
 * join". Measured 2026-10-12, Join pressed → flying, in two real tabs (two
 * headless Chromes through .claude/devtools/cdp.mjs, muted) against the
 * public matchmaking server, under a made-up Wi-Fi so nobody's real lobby
 * was touched — see FAST-JOIN NUMBERS at the bottom of this header.
 *
 * What it proves, with the shipped joinflow.js, lobby.js, session.js and
 * link.js:
 *   - the join's state machine (joinflow.js): the network's steps in order,
 *     a step skipped when the list already knew, a try that went back
 *     counted, the island built alongside, Ready only with both in, nothing
 *     after a failure; the line it says at each step ("Connecting…",
 *     "Syncing…", "Ready") and "still going" when a step drags; and the
 *     time per step;
 *   - the list's fresh word stands in for the first question: a lobby the
 *     list saw empty is claimed and one it saw hosted is joined with no ping
 *     at all, and a word that has gone stale — or turned out wrong either
 *     way — costs one try, then the join asks properly and still gets in;
 *   - with no word at all (a tap before the list answered), the join claims
 *     first, side by side with the matchmaking socket: an empty lobby is
 *     hosted before that socket is even open, a hosted one is told so by
 *     the refused claim, and two claiming at once still make one host;
 *   - a try at a host that never answers is given up after the lobby's own
 *     connect window, not the link's fifteen seconds, and asked again — and
 *     the window is only ever taken from a link this tab starts, never from
 *     what an offer off the wire says;
 *   - the progress steps a real join reports, host and player.
 *
 * FAST-JOIN NUMBERS (ms from Join pressed; the join's own marks):
 *   Public server (0.peerjs.com), 2026-10-13, `node tests/features/multiplayer.mjs
 *   --real` — the real signalling, a pretend WebRTC, a made-up Wi-Fi:
 *     list saw it empty → hosting                         387
 *     list saw it hosted → in as a player                  371
 *     list's word too old → asks first, then in            813
 *     list said empty, somebody hosts now → refused, in   2235
 *     list said hosted, nobody there → offer back, hosts  1136
 *   (that last one was 5.6 s before c4cfafc, in two real tabs on the public
 *   server; the rest of the 2026-10-12 "before" breakdown was not kept.)
 *   One headless Chrome, 2026-10-13, tests/features/multiplayer-join.browser.js
 *   — real WebRTC, the fake signalling server:
 *     a player, lobby on another island: network 344, island 330 built
 *       alongside it, Join → flying 541
 *     the same again, nothing to build: Join → flying 65
 *     a host, empty lobby: Join → flying 26
 *   The target is the owner's "under ~3 s on a normal network".
 */

export async function joinTests(ctx) {
  const { P, S, L, J, Signaling, Net, backend, WS, RTC, ok, sleep, until, REAL } = ctx;
  const untilT = (fn, ms = 3000) => until(fn, REAL ? ms * 4 : ms);
  const mkSig = (token) => new Signaling(backend, { WebSocketImpl: WS, heartbeatMs: REAL ? 5000 : 50, ...(token ? { token } : {}) });

  /* ---- the state machine, on a pretend clock ------------------------- */
  {
    let t = 1000;
    const f = new J.JoinFlow({ label: 'Lobby 3', island: 'Fjord Island', now: () => t, slowMs: 4000 });
    const lines = [];
    const said = () => lines.push(f.line() && f.line().text);
    said();
    f.step('signalling');
    said();
    t += 100;
    f.island('loading', 'Fjord Island');
    f.step('claiming');
    said();
    t += 600;
    const inOk = f.joined('host');
    said();
    const early = f.ready();
    t += 1300;
    f.island('in');
    const readyOk = f.ready();
    said();
    const d = f.durations();
    ok('join flow, a host: Connecting… then Syncing… while the island finishes, then Ready — and not Ready before the island is in',
      lines[1] === 'Connecting… Reaching the matchmaking server' && lines[2] === 'Connecting… Starting Lobby 3 · loading Fjord Island'
        && lines[3] === 'Syncing… Loading Fjord Island' && lines[4] === 'Ready' && inOk && !early && readyOk && f.state === 'ready' && f.role === 'host',
      lines.join(' | '));
    ok('join flow: the time per step adds up — signalling, claiming, the island side by side, the network and the whole',
      d.signalling === 100 && d.claiming === 600 && d.island === 1900 && d.network === 700 && d.total === 2000 && !('finding' in d),
      JSON.stringify(d));
    ok('join flow: one line for the log says it', /^Lobby 3 in 2\.0 s as host: signalling 0\.1 · claiming 0\.6 · island 1\.9 \(side by side\)$/.test(f.summary()), f.summary());
    ok('join flow: after Ready, nothing moves it', !f.step('finding') && !f.fail('x') && !f.island('loading') && f.state === 'ready');
  }
  {
    let t = 0;
    const f = new J.JoinFlow({ label: 'World 2', now: () => t, slowMs: 4000 });
    f.step('signalling');
    t += 50;
    f.step('connecting');
    t += 300;
    const back = f.step('finding');
    t += 200;
    f.step('connecting');
    t += 4500;
    const slow = f.line();
    f.step('syncing');
    const sync = f.line();
    t += 20;
    f.joined('client');
    const noIsland = f.ready();
    ok('join flow, a player: a try that went back is allowed and counted, the steps it took twice add up, and no island means Ready as soon as it is in',
      back && f.retries === 1 && noIsland && f.durations().connecting === 4800 && f.durations().finding === 200 && /1 retry$/.test(f.summary()), f.summary());
    ok('join flow: a step that drags says it is still going; the next step does not',
      slow.slow && slow.text === 'Connecting… Reaching World 2’s host — still going, this can take a few seconds' && sync.text === 'Syncing… Getting everybody’s planes' && !sync.slow,
      `${slow.text} | ${sync.text}`);
  }
  {
    let t = 0;
    const f = new J.JoinFlow({ now: () => t });
    f.step('signalling');
    const odd = !f.step('teleporting') && !f.step('signalling') && !f.ready();
    f.fail('full');
    const after = [f.step('connecting'), f.joined('client'), f.ready(), f.cancel()];
    const c = new J.JoinFlow({ now: () => t });
    c.step('claiming');
    c.step('connecting');
    const notRetry = c.retries === 0 && c.net === 'connecting';
    c.cancel();
    ok('join flow: a claim refused because somebody hosts, then connecting to them, is the way through — not a retry', notRetry);
    ok('join flow: an unknown step or the same one twice is ignored; a failure or a cancel ends it — no line, no more steps',
      odd && f.state === 'failed' && f.why === 'full' && f.line() === null && after.every((x) => x === false) && c.state === 'cancelled' && c.line() === null && c.done,
      `${f.state}/${c.state}`);
  }

  /* ---- the list's word, and the lobby's connect window ---------------- */
  const lh = REAL ? P.sha256Hex(`join-${Math.random()}-${Date.now()}`).slice(0, 12) : P.netHashFor('192.0.2.77');
  const everyone = [];
  const sockets = [];
  const ticker = setInterval(() => {
    const t = performance.now();
    for (const m of everyone) m.tick(t);
  }, 40);
  let k = 0;
  async function member(n, name, extra = {}) {
    const sig = mkSig();
    await sig.open(P.playerPeerId());
    sockets.push(sig);
    const net = new Net(sig, { RTC });
    const phases = [];
    const m = new L.LobbyMember({
      n, hash: lh, net, makeSig: mkSig, profile: { name, colour: P.COLOURS[k % 8], key: `j-${k++}-${Math.random().toString(36).slice(2, 8)}` },
      place: () => ({ map: 'kestrel', game: 'flight' }), netOpts: { RTC }, stepMs: REAL ? 1500 : 300, onPhase: (s) => phases.push(s), ...extra,
    });
    m.phases = phases;
    everyone.push(m);
    return m;
  }
  const enter = async (m) => {
    const t0 = performance.now();
    try {
      const r = await m.start();
      return { r, ms: Math.round(performance.now() - t0) };
    } catch (err) {
      return { err, ms: Math.round(performance.now() - t0) };
    }
  };
  const fresh = (state) => ({ state, at: performance.now() });

  // The list saw Lobby 1 empty a moment ago: the first join claims it without asking first.
  const a = await member(1, 'Swift Falcon', { hint: fresh('empty') });
  const ra = await enter(a);
  ok('the list saw the lobby empty a moment ago: the first player claims it with no ping first — Starting…, then hosting',
    ra.r && ra.r.role === 'host' && a.asked === 0 && a.phases.join(',') === 'claiming', `${ra.r ? ra.r.role : ra.err.code}; ${a.asked} pings; ${a.phases.join(' → ')}; ${ra.ms} ms`);

  // ...and saw it hosted: the next connects straight to the host.
  const b = await member(1, 'Brave Otter', { hint: fresh('open') });
  const rb = await enter(b);
  ok('the list saw the lobby hosted a moment ago: the next player connects straight to its host, no ping — Reaching the host…, Syncing…',
    rb.r && rb.r.role === 'client' && b.asked === 0 && b.phases.join(',') === 'connecting,syncing' && rb.r.welcome && rb.r.welcome.server.lobby === 1,
    `${rb.r ? rb.r.role : rb.err.code}; ${b.asked} pings; ${b.phases.join(' → ')}; ${rb.ms} ms`);

  // A word too old to trust is not used.
  const c = await member(1, 'Sunny Puffin', { hint: { state: 'open', at: performance.now() - L.HINT_FRESH_MS - 1000 } });
  const rc = await enter(c);
  ok('a word from the list older than HINT_FRESH_MS is not trusted: the join asks first (Finding…), then connects',
    rc.r && rc.r.role === 'client' && c.asked === 1 && c.phases.join(',') === 'finding,connecting,syncing', `${c.asked} pings; ${c.phases.join(' → ')}`);

  // Wrong one way: the list said empty, but somebody has claimed it since. One refused claim, then in as a player.
  const d = await member(1, 'Jolly Penguin', { hint: fresh('empty') });
  const rd = await enter(d);
  ok('the list said empty but somebody hosts it now: the claim is refused, the join asks, and is in as a player',
    rd.r && rd.r.role === 'client' && d.asked === 1 && d.phases.join(',') === 'claiming,finding,connecting,syncing', `${rd.r ? rd.r.role : rd.err.code}; ${d.phases.join(' → ')}`);

  // Wrong the other way: the list said Lobby 2 was hosted, but nobody holds it. The offer comes straight back, which says so; the join claims it.
  const e = await member(2, 'Clever Koala', { hint: fresh('open') });
  const re = await enter(e);
  ok('the list said hosted but nobody is there: the offer comes back at once — which says so as a ping would — and the join claims and hosts it',
    re.r && re.r.role === 'host' && e.asked === 0 && e.phases.join(',') === 'connecting,claiming' && re.ms < (REAL ? 3000 : 1500),
    `${re.r ? re.r.role : re.err.code}; ${e.phases.join(' → ')}; ${re.ms} ms`);

  // Claim and ask at once: no word from the list (a tap before it answered), and the matchmaking socket still opening.
  {
    const slowNet = (m, ms) => {
      const net = m.getNet();
      m.netAt = null;
      m.getNet = () => sleep(ms).then(() => {
        m.netAt = m.netAt ?? performance.now();
        return net;
      });
    };
    const g = await member(4, 'Gentle Lark', { claimFirst: true });
    slowNet(g, REAL ? 1500 : 300);
    const t0 = performance.now();
    const rg = await enter(g);
    const tookMs = Math.round(performance.now() - t0);
    ok('claim first, an empty lobby: hosted on the claim alone — before the matchmaking socket was even open, and with no ping',
      rg.r && rg.r.role === 'host' && g.asked === 0 && g.phases.join(',') === 'finding,claiming' && g.netAt === null,
      `${rg.r ? rg.r.role : rg.err.code} in ${tookMs} ms; ${g.asked} pings; ${g.phases.join(' → ')}; socket ${g.netAt === null ? 'still opening' : 'was waited for'}`);
    const h = await member(4, 'Happy Hedgehog', { claimFirst: true });
    slowNet(h, REAL ? 1500 : 300);
    const rh = await enter(h);
    ok('claim first, a lobby somebody hosts: the refused claim says so — no ping — and the join goes to them as soon as the socket is open',
      rh.r && rh.r.role === 'client' && h.asked === 0 && h.phases.join(',') === 'finding,connecting,syncing',
      `${rh.r ? rh.r.role : rh.err.code}; ${h.asked} pings; ${h.phases.join(' → ')}`);
    // Two at once on an empty lobby, both claiming first: still one host — the claim is the lock it always was.
    const [i1, i2] = [await member(5, 'Witty Wren', { claimFirst: true }), await member(5, 'Zany Zebra', { claimFirst: true })];
    const both = await Promise.all([enter(i1), enter(i2)]);
    const roles = both.map((x) => (x.r ? x.r.role : x.err.code)).sort().join(',');
    ok('claim first, two at once on an empty lobby: one hosts, the other joins them', roles === 'client,host', roles);
    // The ping wins when somebody is there and the claim is slow: the join goes to them on the ping's word, and the claim is not waited for.
    const k2 = await member(4, 'Jazzy Jet', { claimFirst: true });
    const slowSig = k2.makeSig;
    k2.makeSig = (tok) => {
      const sg = slowSig(tok);
      const open = sg.open.bind(sg);
      sg.open = (id) => sleep(REAL ? 4000 : 800).then(() => open(id));
      return sg;
    };
    const t1 = performance.now();
    const rk = await enter(k2);
    const kMs = Math.round(performance.now() - t1);
    ok('claim and ask at once, the claim slow: the ping says the lobby is hosted, and the join goes to the host without waiting for the claim',
      rk.r && rk.r.role === 'client' && k2.asked === 1 && k2.phases.join(',') === 'finding,connecting,syncing' && kMs < (REAL ? 4000 : 800),
      `${rk.r ? rk.r.role : rk.err.code} in ${kMs} ms; ${k2.asked} pings; ${k2.phases.join(' → ')}`);
  }

  // A host that answers pings but never an offer (a frozen tab, a network that keeps devices apart): the lobby's window, not fifteen seconds.
  {
    const hsig = mkSig();
    await hsig.open(P.lobbyId(lh, 3));
    sockets.push(hsig);
    const deaf = new Net(hsig, { RTC });
    deaf.answersPings = true;
    deaf.pongMeta = { n: 1, max: 8, v: P.PROTO };
    const f = await member(3, 'Mighty Moose', { connectMs: REAL ? 1500 : 250, enterGiveUpMs: REAL ? 10000 : 4500 });
    const rf = await enter(f);
    const tries = f.phases.filter((p) => p === 'connecting').length;
    ok('a host that never answers an offer: each try is given up after the lobby’s connect window, the lobby asked again, and the child told in seconds',
      rf.err && rf.err.code === 'unreachable' && tries >= 2 && f.asked >= 2 && rf.ms < (REAL ? 16000 : 9000),
      `${rf.err ? rf.err.code : rf.r.role} after ${rf.ms} ms; ${tries} tries, ${f.asked} pings`);
    deaf.destroy();
  }

  // A give-up timer held up by the tab's own stall (the island being built, joinLobby) waits once more before it gives up.
  {
    const { lateAware, LATE_GRACE_MS } = await import('../../src/features/multiplayer/signaling.js');
    let fired = 0;
    const t0 = performance.now();
    lateAware(() => { fired = performance.now() - t0; }, 50);
    const stop = performance.now() + 600;
    while (performance.now() < stop) { /* the main thread, busy building an island */ }
    await sleep(300);
    const early = fired;
    await until(() => fired, LATE_GRACE_MS + 3000);
    ok('a give-up timer that went off late because the tab itself was busy waits once more for what arrived meanwhile — then gives up',
      early === 0 && fired >= 600 + LATE_GRACE_MS - 50, `went off after ${Math.round(fired)} ms (due at 50, the tab busy for 600)`);
  }
  ok('the connect windows: 8 s a try on the Wi-Fi and 12 across the internet (link.js gives 15 and 25), and a world lobby gives up in 30 s, not 55',
    L.LOBBY_CONNECT_MS === 8000 && L.WORLD_CONNECT_MS === 12000 && L.WORLD_ENTER_GIVE_UP_MS === 30000 && a.connectMs === L.LOBBY_CONNECT_MS
      && new L.LobbyMember({ n: 1, world: true, net: null, makeSig: mkSig, profile: {} }).connectMs === L.WORLD_CONNECT_MS);

  // The window is this tab's own choice: an offer off the wire that names one is not believed.
  {
    const sig = mkSig();
    await sig.open(P.playerPeerId());
    sockets.push(sig);
    const net = new Net(sig, { RTC, connectTimeoutMs: 15000 });
    const L2 = await import('../../src/features/multiplayer/link.js');
    const mine = new L2.Link(net, { peer: 'ifs-p-nobodyatallxx', initiator: true, meta: { connectMs: 40 } });
    const theirs = new L2.Link(net, { peer: 'ifs-p-nobodyatallxx', initiator: false, connectionId: 'dc_wire', meta: { k: 'join', connectMs: 40 } });
    mine._setup();
    theirs._setup();
    // 40 ms, or a moment more if this process was itself held up (lateAware).
    await until(() => mine.state === 'closed', 4000);
    ok('a lobby’s connect window applies to a link this tab starts — never to one an offer off the wire asks for',
      mine.state === 'closed' && mine.closeReason === 'timeout' && theirs.state !== 'closed', `${mine.state}/${mine.closeReason}, ${theirs.state}`);
    mine.close();
    theirs.close();
  }

  // How long the joins above took against this server, for the log.
  ctx.joinNumbers = { hostMs: ra.ms, clientMs: rb.ms, staleHintMs: rc.ms, wrongEmptyMs: rd.ms, wrongOpenMs: re.ms };

  clearInterval(ticker);
  for (const m of everyone) if (!m.left) m.leave();
  await sleep(REAL ? 1000 : 200);
  for (const s of sockets) s.close();
  void untilT;
  void S;
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
  const J = await import('../../src/features/multiplayer/joinflow.js');
  const { Signaling, PUBLIC_BACKEND } = await import('../../src/features/multiplayer/signaling.js');
  const { Net } = await import('../../src/features/multiplayer/link.js');
  const { FakeSignalServer, makeFakeRTC, sleep, until } = await import('./multiplayer.fakes.js');
  // --real: the signaling half against the public PeerJS server (WebRTC is still the fake; the network hash is random).
  const REAL = process.argv.includes('--real');
  const server = REAL ? null : new FakeSignalServer();
  const ctx = {
    P, S, L, J, Signaling, Net, backend: REAL ? PUBLIC_BACKEND : { url: 'wss://fake.test/peerjs', key: 'peerjs' },
    WS: REAL ? globalThis.WebSocket : server.WebSocket, RTC: makeFakeRTC(), ok, sleep, until, REAL, server,
  };
  await joinTests(ctx);
  console.log(JSON.stringify(ctx.joinNumbers));
  const bad = results.filter((x) => !x).length;
  console.log(`\n${results.length - bad}/${results.length} passed`);
  process.exit(bad ? 1 : 0);
}
