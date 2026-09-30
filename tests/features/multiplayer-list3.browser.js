/**
 * List 3's multiplayer, part 3a, in one tab — run by tests/selftest.js through
 * tests/features/index.js (CHECKS), or by hand:
 *
 *   const { check } = await import('/tests/features/multiplayer-list3.browser.js');
 *   const r = { checks: [], ok(n, p, d) { this.checks.push({ n, p, d }); return p; } };
 *   await check(window.__sim, r, console.log);
 *
 *   lobby islands   every Wi-Fi lobby on its own island, named and pictured on its
 *                   card before anybody is in it; joining an empty one takes you
 *                   there, not to the island picked on the menu
 *   world lobbies   a second row, "World lobbies — anyone, anywhere", five more on
 *                   their own islands; one joined and hosted, a friend from
 *                   somewhere else joins it over a cross-network ('v4') link;
 *                   the badge and the player list say it is a World lobby;
 *                   a second socket only when the world is on another server
 *   no internet     the World row says so, the Wi-Fi row carries on
 *   ride fit        a card says, before you join, when your ride has no room there
 *   private match   its card is built like the others: picture, island, count
 *
 * Nothing here touches the internet: the signaling server is the fake from
 * multiplayer.fakes.js, standing in for the LAN one and the public one; the
 * WebRTC connections are real.
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
    r.ok('list3 mp: this browser has WebRTC', false, 'no RTCPeerConnection');
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
  const backend = { id: 'fake', url: 'wss://fake.invalid/peerjs', key: 'peerjs', label: 'the test server' };
  const worldServer = { id: 'fake-world', url: 'wss://fake-world.invalid/peerjs', key: 'peerjs', label: 'the world test server' };
  const hash = 'l3a7c0ffee12';
  const makeSig = () => new Signaling(backend, { WebSocketImpl: server.WebSocket });
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
  const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const drawn = (c) => {
    const cv = c && c.querySelector('.mp-thumb canvas');
    if (!cv) return false;
    const d = cv.getContext('2d').getImageData(44, 44, 1, 1).data;
    return d[3] > 0;
  };

  try {
    L.forgetLobbyLists();
    // The world lobbies on a server of their own, as on a page the LAN server served: two sockets, each only while needed.
    mp.configure({ backend, hash, world: worldServer, WebSocketImpl: server.WebSocket });
    mp.profile.name = 'Swift Falcon';
    mp.profile.chosen = true;
    mp.profile.ride = { game: 'flight', type: 'skylark' };
    if (sim.menus) sim.menus.currentGame = 'flight';
    mpMod.openMultiplayer(sim);
    const le = document.querySelector('[data-screen="lobbies"]');
    const wifiCards = () => [...le.querySelectorAll('[data-mp-lobby]')];
    const worldCards = () => [...le.querySelectorAll('[data-mp-world]')];

    /* ---- two rows, labelled ---------------------------------------------- */
    const ready = await until(() => wifiCards().every((c) => c.classList.contains('is-empty')) && worldCards().every((c) => c.classList.contains('is-empty')), 20000);
    const heads = [le.querySelector('[data-mp-wifihead]'), le.querySelector('[data-mp-worldhead]')].map(text);
    r.ok('list3 mp: two rows, labelled “Wi-Fi lobbies — people on your network” and “World lobbies — anyone, anywhere”, five lobbies in each',
      !!ready && /^Wi-Fi lobbies — people on your network/.test(heads[0]) && /^World lobbies — anyone, anywhere/.test(heads[1]) && wifiCards().length === 5 && worldCards().length === 5,
      heads.join(' | '));
    const wifiIsles = wifiCards().map((c) => text(c.querySelector('[data-mp-isle]')));
    const worldIsles = worldCards().map((c) => text(c.querySelector('[data-mp-isle]')));
    r.ok('list3 mp: every lobby card names its own island before anybody is in it — five different ones in each row, each with its picture',
      wifiIsles.join('|') === P.LOBBY_MAPS.map(P.mapNameFor).join('|') && worldIsles.join('|') === P.WORLD_MAPS.map(P.mapNameFor).join('|')
        && [...wifiCards(), ...worldCards()].every((c) => drawn(c)) && worldCards().every((c, i) => text(c).includes(`World ${i + 1}`) && text(c).includes(P.WORLD_NAMES[i]) && text(c).includes('0/8')),
      `Wi-Fi: ${wifiIsles.join(', ')}; World: ${worldIsles.join(', ')}`);
    const worldNet = text(le.querySelector('[data-mp-world-net]'));
    r.ok('list3 mp: the World row says where it looks, and says it is for people who aren’t on your Wi-Fi',
      /^On the world test server, not the internet$/.test(worldNet) && /aren’t on your Wi-Fi/.test(text(le.querySelector('[data-mp-worldhead] + .hint'))), worldNet);
    const sockets = () => [mp.lookSig && mp.lookSig.isOpen, mp.worldSig && mp.worldSig.isOpen];
    r.ok('list3 mp: with the world lobbies on another server, the screen holds one socket to each while it is up', sockets().every(Boolean), JSON.stringify(sockets()));

    /* ---- your ride, on the card ----------------------------------------- */
    mp.setRide({ game: 'car', type: 'car' });
    mp.lobbyScreen.lobbies(mp.lobbyWatch.lobbies);
    const fits = wifiCards().map((c) => text(c.querySelector('[data-mp-fit]')));
    r.ok('list3 mp: a card says before you join when your ride has no room on its island — the car on Coral Atoll — and nothing where it has',
      fits[0] === '' && /^No roads for your car — you’ll come in the /.test(fits[1]), fits.join(' | '));
    mp.setRide({ game: 'flight', type: 'skylark' });
    mp.lobbyScreen.lobbies(mp.lobbyWatch.lobbies);

    /* ---- an empty Wi-Fi lobby: its own island, not the menu's ------------- */
    // A lobby whose island is neither the one this tab is on nor the one its menu would start a game on.
    const here = sim.settings.map;
    const menuMap = mp.defaultMap('flight');
    const n = [2, 3, 4, 5, 1].find((k) => P.LOBBY_MAPS[k - 1] !== here && P.LOBBY_MAPS[k - 1] !== menuMap);
    const isle = P.mapNameFor(P.LOBBY_MAPS[n - 1]);
    le.querySelector(`[data-mp-lobby-join="${n}"]`).click();
    const inN = await until(() => mp.lobby && mp.role === 'host' && mp.ready && sim.state === 'flying', 30000);
    mp.syncRoster();
    const badgeN = text(mp.hud.el.querySelector('.mp-badge'));
    r.ok(`list3 mp: starting an empty Wi-Fi lobby takes you to its island — ${isle} for Lobby ${n} — not the one picked on the menu (${P.mapNameFor(menuMap)})`,
      !!inN && sim.settings.map === P.LOBBY_MAPS[n - 1] && mp.server.map === P.LOBBY_MAPS[n - 1] && badgeN.includes(`Lobby ${n} · ${P.LOBBY_NAMES[n - 1]}`) && badgeN.includes(`On ${isle}`),
      `${sim.settings.map}; ${badgeN}`);
    r.ok('list3 mp: in a Wi-Fi lobby the world lobbies’ socket is let go', !(mp.worldSig && mp.worldSig.isOpen), JSON.stringify(sockets()));
    mp.leave('left');
    await wait(400);

    /* ---- a world lobby ---------------------------------------------------- */
    mpMod.openMultiplayer(sim);
    await until(() => worldCards().every((c) => c.classList.contains('is-empty')), 20000);
    // Somebody far away is in World 2 already: its card shows them.
    const wsig = new Signaling(worldServer, { WebSocketImpl: server.WebSocket });
    await wsig.open(P.worldId(2));
    const far = new S.HostSession({ mode: 'lobby', profile: { name: 'Kind Koala', colour: P.COLOURS[1], key: 'l3farhostl3farhostl3' }, server: { map: 'meadow', game: 'flight', lobby: 2, world: true } });
    far.attach(new Net(wsig));
    cleanups.push(() => { far.close(); wsig.close(); });
    const w2 = await until(() => /1\/8/.test(text(worldCards()[1])) && worldCards()[1].classList.contains('is-open'), 20000);
    r.ok('list3 mp: a world lobby somebody is in shows how many, on its island', !!w2 && /Harrier Flats/.test(text(worldCards()[1])) && /Playing now/.test(text(worldCards()[1])), text(worldCards()[1]));
    far.close();
    wsig.close();

    le.querySelector('[data-mp-world-join="4"]').click();
    const in4 = await until(() => mp.lobby && mp.lobby.world && mp.role === 'host' && mp.ready && sim.state === 'flying', 30000);
    r.ok('list3 mp: Start it on an empty world lobby hosts it — on its island, Condor Rock for World 4',
      !!in4 && sim.settings.map === 'condor' && mp.server.world === true && mp.lobby.id === P.worldId(4), `${sim.settings.map}; ${mp.lobby && mp.lobby.id}`);
    r.ok('list3 mp: in a world lobby the Wi-Fi’s socket is let go, and the world’s holds the lobby', !(mp.lookSig && mp.lookSig.isOpen) && mp.lobby.sig && mp.lobby.sig.isOpen,
      JSON.stringify(sockets()));
    // A friend in another town joins it.
    const fsig = new Signaling(worldServer, { WebSocketImpl: server.WebSocket });
    await fsig.open(P.playerPeerId());
    cleanups.push(() => fsig.close());
    const friend = new S.ClientSession({ net: new Net(fsig), target: P.worldId(4), profile: { name: 'Brave Otter', colour: P.COLOURS[3], key: 'l3friendl3friendl3fr' } });
    const welcome = await friend.start().catch((e) => ({ err: e && e.code }));
    const ft = setInterval(() => friend.tick(performance.now()), 66);
    cleanups.push(() => { clearInterval(ft); friend.leave(); });
    const seen = await until(() => mp.remotes.players.size === 1 && mp.host && mp.host.count === 2, 10000);
    const hostLink = mp.host && [...mp.host.players.values()][0];
    r.ok('list3 mp: a friend somewhere else joins the world lobby — told its island and name from their own copy, over a cross-network link',
      !!seen && welcome && welcome.server && welcome.server.world && welcome.server.name === 'Summit Lookout' && welcome.server.map === 'condor'
        && friend.link.share === 'v4' && hostLink && hostLink.link.share === 'v4',
      `${welcome && welcome.server ? `${welcome.server.name}, ${welcome.server.map}` : JSON.stringify(welcome)}; links ${friend.link.share}/${hostLink && hostLink.link.share}`);
    await wait(1100);
    mp.syncRoster();
    mp.hud.hold(true);
    const badge4 = text(mp.hud.el.querySelector('.mp-badge'));
    const foot = text(mp.hud.el.querySelector('[data-mp-list] .mp-foot'));
    const list = mp.hud.el.querySelector('[data-mp-list]');
    r.ok('list3 mp: the badge says World 4 and its island; the player list says it is a world lobby, with Mute and no Kick or Lock',
      /World 4 · Summit Lookout · 2\/8/.test(badge4) && /On Condor Rock/.test(badge4) && /World lobby — players from anywhere/.test(foot)
        && !!list.querySelector('[data-mp-mute="Brave Otter"]') && !list.querySelector('[data-mp-kick]') && !list.querySelector('[data-mp-lock]'),
      `${badge4} | ${foot}`);
    mp.hud.hold(false);
    mp.leave('left');
    await wait(500);
    r.ok('list3 mp: leaving the world lobby lets its socket go too', !(mp.worldSig && mp.worldSig.isOpen) && !mp.lobby, JSON.stringify(sockets()));
    clearInterval(ft);
    friend.leave();

    /* ---- no internet for the world row ------------------------------------ */
    // The fake answers every URL; this one's sockets are refused before they open, as an unreachable server's are.
    const Base = server.WebSocket;
    class NoWorld extends Base {
      constructor(url) {
        super(url);
        if (/127\.0\.0\.1:9\//.test(url)) this.close();
      }
    }
    mp.configure({ backend, hash, world: { id: 'dead', url: 'ws://127.0.0.1:9/peerjs', key: 'peerjs', label: 'nowhere' }, WebSocketImpl: NoWorld });
    L.forgetLobbyLists();
    mpMod.openMultiplayer(sim);
    const saidNo = await until(() => /Can’t reach the world lobbies — they need the internet/.test(text(le.querySelector('[data-mp-world-net]'))), 15000);
    const wifiOk = await until(() => wifiCards().every((c) => c.classList.contains('is-empty')), 10000);
    r.ok('list3 mp: with no way to the world lobbies, the World row says they need the internet and its buttons wait — the Wi-Fi row carries on',
      !!saidNo && !!wifiOk && worldCards().every((c) => c.querySelector('button').disabled && /need the internet/.test(text(c)))
        && wifiCards().every((c) => !c.querySelector('button').disabled) && !!mp._watchRetry,
      `${text(le.querySelector('[data-mp-world-net]'))}; retry queued ${!!mp._watchRetry}`);
    mp.back();
    r.ok('list3 mp: and Back stops it looking again', !mp._watchRetry && !mp.worldWatch && !mp.lobbyWatch);

    /* ---- a private match's card is built like the others ------------------ */
    mp.configure({ backend, hash, WebSocketImpl: server.WebSocket });
    mp.profile.ride = null;
    await mp.hostServer({ serverName: mp.serverName(), map: 'ember', game: 'flight', privateGame: true, ride: mp.ride() });
    await until(() => mp.role === 'host' && mp.ready, 30000);
    const mine = await mp.lobbyScreen.privateCard();
    const pv = le.querySelector('[data-mp-private-card]');
    const parts = (c) => ['.mp-lhead', '.mp-thumb', '.mp-slot-n', 'strong', '.mp-isle', '.mp-count', '.mp-bar', 'button'].map((q) => !!c.querySelector(q));
    r.ok('list3 mp: a private match’s card is built like every lobby card — its island’s picture and name, the count, Join — marked Private with its code, and says it works across Wi-Fi',
      mine && !pv.hidden && parts(pv).every(Boolean) && parts(wifiCards()[0]).every(Boolean) && /Private · /.test(text(pv)) && text(pv).includes(mp.server.code)
        && text(pv.querySelector('.mp-isle')) === 'Ember Isle' && drawn(pv) && /Works with friends who aren’t on your Wi-Fi/.test(text(pv)),
      text(pv));
    mp.leave('left');
    await wait(300);
  } catch (err) {
    r.ok('list3 mp: the checks ran to the end', false, String(err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err));
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
