/**
 * Joining a lobby fast — the owner: "it takes forever to join lobbies" — in
 * one tab, run by tests/selftest.js through tests/features/index.js (CHECKS),
 * or by hand:
 *
 *   const { check } = await import('/tests/features/multiplayer-join.browser.js');
 *   const r = { checks: [], ok(n, p, d) { this.checks.push({ n, p, d }); return p; } };
 *   await check(window.__sim, r, console.log);
 *
 *   a player    Join on a lobby somebody hosts on another island: the line on
 *               the screen goes Connecting… then Syncing…; no ping first (the
 *               list's word); the island is built while the connection is
 *               made, not after it; and what the join adds on top of building
 *               the island is under two seconds
 *   again       Join again with nothing to build: Join to flying in under 3 s
 *   a host      Start an empty lobby: in under 3 s, no ping first
 *
 * Nothing here touches the internet: the signaling server is the fake from
 * multiplayer.fakes.js; the WebRTC connection is real. The numbers from the
 * public server are in tests/features/multiplayer.join.mjs's header.
 */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 6000, step = 25) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    let v = null;
    try {
      v = fn();
    } catch (e) {
      v = null;
    }
    if (v) return v;
    await wait(step);
  }
  return fn();
}

/** Under this, Join to flying, when there is no island to build: the owner's "under ~3 s on a normal network". */
export const JOIN_TARGET_MS = 3000;
/** And what a join may add on top of building the lobby's island. */
export const JOIN_OVER_ISLAND_MS = 2000;

export async function check(sim, r, say = () => {}) {
  const mpMod = await import('../../src/features/multiplayer.js');
  const P = await import('../../src/features/multiplayer/protocol.js');
  const S = await import('../../src/features/multiplayer/session.js');
  const L = await import('../../src/features/multiplayer/lobby.js');
  const { Net } = await import('../../src/features/multiplayer/link.js');
  const { Signaling } = await import('../../src/features/multiplayer/signaling.js');
  const { FakeSignalServer } = await import('./multiplayer.fakes.js');
  const mp = mpMod.multiplayer;
  if (typeof RTCPeerConnection !== 'function') {
    r.ok('join mp: this browser has WebRTC', false, 'no RTCPeerConnection');
    return;
  }
  mp.install(sim);
  let savedProfile = null;
  try {
    savedProfile = localStorage.getItem('islandsim.multiplayer.v1');
  } catch (e) {
    savedProfile = null;
  }
  const profileBefore = { ...mp.profile };
  const wasScreen = sim.menus && sim.menus.current;
  const server = new FakeSignalServer();
  const backend = { id: 'fake', url: 'wss://fake-join.invalid/peerjs', key: 'peerjs', label: 'the test server' };
  const hash = 'f0a5710a1234';
  const cleanups = [];
  // A live connection keeps this tab's timers running (see multiplayer.browser.js).
  const awake = [new RTCPeerConnection(), new RTCPeerConnection()];
  cleanups.push(() => awake.forEach((pc) => pc.close()));
  {
    const [a, b] = awake;
    a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate).catch(() => {});
    b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate).catch(() => {});
    a.createDataChannel('awake', { negotiated: true, id: 0 });
    b.createDataChannel('awake', { negotiated: true, id: 0 });
    const o = await a.createOffer();
    await a.setLocalDescription(o);
    await b.setRemoteDescription(o);
    const an = await b.createAnswer();
    await b.setLocalDescription(an);
    await a.setRemoteDescription(an);
    await until(() => a.connectionState === 'connected', 5000);
  }
  const said = [];
  const join = async (n) => {
    const le = document.querySelector('[data-screen="lobbies"]');
    said.length = 0;
    const t0 = performance.now();
    le.querySelector(`[data-mp-lobby-join="${n}"]`).click();
    const inside = await until(() => (mp.lobby && mp.ready && sim.state === 'flying') || (!mp.busy && !mp.lobby), 40000);
    const ms = Math.round(performance.now() - t0);
    const flow = mp.joinFlow;
    return { ok: !!(inside && mp.lobby && mp.ready), ms, flow, d: flow ? flow.durations() : {}, marks: flow ? flow.marks.map((m) => m.step) : [], said: said.slice(), asked: mp.lobby ? mp.lobby.asked : -1, role: mp.role };
  };
  const openList = async (n, state) => {
    mpMod.openMultiplayer(sim);
    const le = document.querySelector('[data-screen="lobbies"]');
    if (!mp.lobbyScreen.__joinSaid) {
      const status = mp.lobbyScreen.status.bind(mp.lobbyScreen);
      mp.lobbyScreen.status = (text, kind) => {
        if (text) said.push(String(text));
        return status(text, kind);
      };
      mp.lobbyScreen.__joinSaid = true;
    }
    return until(() => le.querySelector(`[data-mp-lobby="${n}"].is-${state}`), 15000);
  };

  try {
    L.forgetLobbyLists();
    mp.configure({ backend, hash, WebSocketImpl: server.WebSocket });
    mp.profile.name = 'Swift Falcon';
    mp.profile.chosen = true;
    mp.profile.ride = { game: 'flight', type: 'skylark' };
    if (sim.menus) sim.menus.currentGame = 'flight';
    // From the menus, as a child joins: the island can then be built while the network works.
    if (sim.state !== 'menu' && typeof sim.quitToMenu === 'function') sim.quitToMenu('main');

    /* ---- a player, onto another island ------------------------------------ */
    const here = sim.settings.map;
    const n = [3, 2, 4, 5, 1].find((k) => P.LOBBY_MAPS[k - 1] !== here);
    const isle = P.LOBBY_MAPS[n - 1];
    const hsig = new Signaling(backend, { WebSocketImpl: server.WebSocket });
    await hsig.open(P.lobbyId(hash, n));
    const other = new S.HostSession({
      mode: 'lobby', profile: { name: 'Kind Koala', colour: P.COLOURS[1], key: 'joinhostjoinhostjoin' },
      server: { name: P.lobbyName(n), map: isle, game: 'flight', lobby: n },
      spawnInfo: () => ({ x: -470, y: 16, z: 0, heading: 90, speed: 0, agl: 0, onGround: true }), weather: () => null,
    });
    other.attach(new Net(hsig));
    const ot = setInterval(() => other.tick(performance.now()), 66);
    cleanups.push(() => { clearInterval(ot); other.close(); hsig.close(); });
    const listed = await openList(n, 'open');
    const j1 = await join(n);
    say(`join mp: a player onto ${isle}: ${j1.ms} ms ${JSON.stringify(j1.d)} ${j1.marks.join('>')}`);
    const conn = j1.said.findIndex((s) => /^Connecting…/.test(s));
    const sync = j1.said.findIndex((s) => /^Syncing…/.test(s));
    r.ok(`join mp: Join on a lobby somebody hosts on ${P.mapNameFor(isle)} — in as a player, on its island, the screen saying Connecting… then Syncing…, and no ping first (the list knew)`,
      !!listed && j1.ok && j1.role === 'client' && sim.settings.map === isle && conn >= 0 && sync > conn && j1.asked === 0 && j1.flow.state === 'ready',
      `${j1.role}, ${sim.settings.map}; said ${j1.said.join(' | ')}; ${j1.asked} pings`);
    const at = (step) => j1.marks.indexOf(step);
    // Built while connecting: started once the offer was out, finished before the welcome was read — not begun after it, as it was.
    r.ok('join mp: the island was built while the connection was being made, not after it — the two overlapped',
      at('connecting') >= 0 && at('connecting') < at('island-in') && at('island-loading') < at('in') && at('island-in') < at('in'),
      `${j1.marks.join(' → ')}; network ${j1.d.network} ms, island ${j1.d.island} ms, Join to flying ${j1.d.total} ms`);
    r.ok(`join mp: timing — what the join adds on top of building the island is under ${JOIN_OVER_ISLAND_MS / 1000} s`,
      j1.ok && j1.d.island != null && j1.d.total - j1.d.island < JOIN_OVER_ISLAND_MS, `${j1.d.total} ms in all, ${j1.d.island} ms of it the island`);
    const seen = await until(() => mp.remotes.players.size === 1 && [...mp.remotes.players.values()][0].name === 'Kind Koala', 5000);
    r.ok('join mp: and the host is there with them', !!seen && other.count === 2, `${mp.remotes.players.size} remote, host count ${other.count}`);

    /* ---- again, with nothing to build -------------------------------------- */
    mp.leave('left');
    await wait(300);
    const sockBefore = mp.lookSig;
    const relisted = await openList(n, 'open');
    const j2 = await join(n);
    say(`join mp: again: ${j2.ms} ms ${JSON.stringify(j2.d)}`);
    r.ok(`join mp: timing — Join again, nothing to build: Join to flying in under ${JOIN_TARGET_MS / 1000} s, on the socket the last lobby left open`,
      !!relisted && j2.ok && j2.role === 'client' && j2.ms < JOIN_TARGET_MS && j2.d.island == null && !!sockBefore && mp.lookSig === sockBefore,
      `${j2.ms} ms (${JSON.stringify(j2.d)}); socket ${sockBefore && mp.lookSig === sockBefore ? 'kept' : 'new'}`);

    /* ---- a host: the same lobby, now empty --------------------------------- */
    mp.leave('left');
    clearInterval(ot);
    other.close();
    hsig.close();
    await wait(300);
    const emptied = await openList(n, 'empty');
    const j3 = await join(n);
    say(`join mp: a host: ${j3.ms} ms ${JSON.stringify(j3.d)}`);
    r.ok(`join mp: timing — Start an empty lobby: hosting and flying in under ${JOIN_TARGET_MS / 1000} s, with no ping first`,
      !!emptied && j3.ok && j3.role === 'host' && j3.ms < JOIN_TARGET_MS && j3.asked === 0 && j3.marks.includes('claiming') && !j3.marks.includes('finding'),
      `${j3.role}, ${j3.ms} ms, ${j3.asked} pings, ${j3.marks.join(' → ')}`);
    mp.leave('left');
    await wait(300);
  } catch (err) {
    r.ok('join mp: the checks ran to the end', false, String(err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err));
  } finally {
    for (const fn of cleanups.reverse()) {
      try {
        fn();
      } catch (e) {
        /* already gone */
      }
    }
    if (mp.role || mp.lobby) mp.leave('menu');
    mp.stopLooking();
    mp.stopWatchingLobbies();
    mp.configure(null);
    mp.profile = profileBefore;
    L.forgetLobbyLists();
    try {
      if (savedProfile === null) localStorage.removeItem('islandsim.multiplayer.v1');
      else localStorage.setItem('islandsim.multiplayer.v1', savedProfile);
    } catch (e) {
      /* storage is not ours to fix */
    }
    if (sim.menus) {
      if (wasScreen && !['multiplayer', 'lobbies'].includes(wasScreen)) sim.menus.show(wasScreen);
      else if (!wasScreen) sim.menus.hide();
      else sim.menus.show('main');
    }
    await wait(300);
  }
}

export default check;
