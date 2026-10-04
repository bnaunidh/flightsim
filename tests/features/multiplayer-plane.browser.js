/**
 * v56: the aeroplane you pick is the one you fly in multiplayer — run by
 * tests/selftest.js through tests/features/index.js (CHECKS), or by hand:
 *
 *   const { check } = await import('/tests/features/multiplayer-plane.browser.js');
 *   const r = { checks: [], ok(n, p, d) { this.checks.push({ n, p, d }); return p; } };
 *   await check(window.__sim, r, console.log);
 *
 * The owner, on v55: "picking a plane doesn't let me use it in multiplayer".
 * One tap on a ride on the lobby screen is saved for good
 * (islandsim.multiplayer.v1), and ride() put that before the plane picked in
 * the Hangar ever after — the Hangar's "Free Flight and Multiplayer will start
 * in it" was not true. Measured on v55 in two real tabs over the LAN server:
 * the host picked the Courier and the client the F/A-18, both had once tapped
 * the Skylark, both flew Skylarks and each saw the other's Skylark. And the
 * Races card's "Pick Coral Atoll" from the Boat page tapped the FIRST plane on
 * the screen, the Skylark, over the plane the player had picked.
 *
 *   hangar        after a ride saved on the lobby screen (a plane, or the boat),
 *                 the plane picked in the Hangar is the ride — every aeroplane,
 *                 the passcode ones once it is open; the helicopter from Rotors
 *                 is the helicopter; the Boat page still brings the boat
 *   free flight   the same for a plane card on the Free Flight screen; a locked
 *                 one is still refused and changes nothing
 *   lobby chip    a ride tapped on the lobby screen after that wins again
 *   client        in a lobby somebody else hosts: you fly it, the host sees it
 *   host          a lobby you start: you fly it, a friend who joins sees it
 *   races         "Pick Coral Atoll" from the Boat page takes your plane
 *
 * Nothing here touches the internet: the signaling server is the fake from
 * multiplayer.fakes.js; the WebRTC connections are real.
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
  const { AIRCRAFT } = await import('../../src/aircraft/types.js');
  const { FakeSignalServer } = await import('./multiplayer.fakes.js');
  const mp = mpMod.multiplayer;
  const menus = sim.menus;
  if (!menus || !menus.showcaseUi || !menus.screens || !menus.screens.free) {
    r.ok('mp plane: the Hangar and the Free Flight screen are there to pick from', false, 'no menus');
    return;
  }
  if (typeof RTCPeerConnection !== 'function') {
    r.ok('mp plane: this browser has WebRTC', false, 'no RTCPeerConnection');
    return;
  }
  mp.install(sim);
  const PROFILE_KEY = 'islandsim.multiplayer.v1';
  const PROG_KEY = 'islandsim.progression.v1';
  const stored = {};
  for (const k of [PROFILE_KEY, PROG_KEY]) {
    try {
      stored[k] = localStorage.getItem(k);
    } catch (e) {
      stored[k] = null;
    }
  }
  const profileBefore = { ...mp.profile };
  const prog = menus.prog;
  const progBefore = { unlocked: [...prog.unlocked], militaryUnlocked: prog.militaryUnlocked };
  const chosenBefore = menus.chosenAircraft;
  const gameBefore = menus.currentGame;
  const wasScreen = menus.current;
  const server = new FakeSignalServer();
  const backend = { id: 'fake', url: 'wss://fake.invalid/peerjs', key: 'peerjs', label: 'the test server' };
  const hash = 'b1a7e0ffee56';
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
  const key = (r) => (r ? `${r.game}:${r.type}` : 'none');
  const own = (id) => {
    if (!prog.unlocked.includes(id)) prog.unlocked.push(id);
  };
  /** The lobby screen, as the main menu's card opens it. */
  const lobbyScreen = () => {
    mpMod.openMultiplayer(sim);
    return document.querySelector('[data-screen="lobbies"]');
  };
  /** A ride tapped on the lobby screen, the way a player does — and saved, as it always was. */
  const tapRide = (ride) => {
    const le = lobbyScreen();
    const chip = le.querySelector(`[data-mp-ride="${ride}"]`);
    if (chip) chip.click();
    const on = le.querySelector('[data-mp-ride].is-on');
    mp.back();
    return !!chip && !!on && on.dataset.mpRide === ride;
  };
  const shown = () => {
    const le = lobbyScreen();
    const on = le.querySelector('[data-mp-ride].is-on');
    const out = on ? on.dataset.mpRide : 'none';
    mp.back();
    return out;
  };
  const savedRide = () => {
    try {
      const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
      return p && p.ride ? `${p.ride.game}:${p.ride.type}` : 'none';
    } catch (e) {
      return 'no storage';
    }
  };

  try {
    mp.configure({ backend, hash, WebSocketImpl: server.WebSocket });
    mp.setProfile({ name: 'Brave Otter', chosen: true });
    menus.currentGame = 'flight';
    prog.militaryUnlocked = true;

    /* ---- the Hangar: every aeroplane, after a ride saved on the lobby screen ---- */
    {
      const planes = AIRCRAFT.filter((a) => a.id !== 'harrier');
      const wrong = [];
      for (const a of planes) {
        own(a.id);
        // The ride the owner had saved without knowing: one tap on the Skylark (or, for the Skylark, the Courier).
        const before = a.id === 'skylark' ? 'flight:courier' : 'flight:skylark';
        own('courier');
        tapRide(before);
        const chose = menus.showcaseUi.choose(a.id);
        const got = mp.ride();
        if (!chose || key(got) !== `flight:${a.id}`) wrong.push(`${a.id}→${key(got)}${chose ? '' : ' (not chosen)'}`);
      }
      r.ok(`mp plane: after a ride saved on the lobby screen, the plane picked in the Hangar is the multiplayer ride — all ${planes.length} aeroplanes, the passcode ones too once it is open`,
        wrong.length === 0, wrong.length ? `wrong: ${wrong.join(', ')}` : planes.map((a) => a.id).join(', '));
      // From the boat: a saved boat ride, then a plane in the Hangar.
      tapRide('boat:boat');
      menus.showcaseUi.choose('b747');
      const fromBoat = mp.ride();
      const screenNow = shown();
      const saved = savedRide();
      // And nothing sticky is saved in its place: the Boat page still brings the boat, as it did before any pick.
      menus.currentGame = 'boat';
      const boatPage = mp.ride();
      menus.currentGame = 'flight';
      r.ok('mp plane: a boat saved on the lobby screen, then the 747 picked in the Hangar — the ride is the 747 and the lobby screen shows it; the Boat page still brings the boat',
        key(fromBoat) === 'flight:b747' && screenNow === 'flight:b747' && saved === 'none' && key(boatPage) === 'boat:boat',
        `${key(fromBoat)}; screen ${screenNow}; saved ${saved}; from the Boat page ${key(boatPage)}`);
      // The helicopter, picked in the Hangar from Rotors, is the helicopter.
      tapRide('flight:skylark');
      menus.currentGame = 'heli';
      menus.showcaseUi.choose('harrier');
      const heli = mp.ride();
      menus.currentGame = 'flight';
      r.ok('mp plane: the helicopter picked in the Hangar from Rotors is the helicopter ride', key(heli) === 'heli:harrier', key(heli));
    }

    /* ---- the Free Flight screen's plane cards ---- */
    {
      const free = menus.screens.free;
      own('a320');
      tapRide('flight:skylark');
      free.querySelector('[data-aircraft="a320"]').click();
      const picked = mp.ride();
      r.ok('mp plane: a plane card picked on the Free Flight screen is the multiplayer ride too',
        menus.chosenAircraft === 'a320' && key(picked) === 'flight:a320', `chosen ${menus.chosenAircraft}; ride ${key(picked)}`);
      // Locked stays locked: the passcode shut, and an aeroplane not bought.
      prog.militaryUnlocked = false;
      prog.unlocked = prog.unlocked.filter((id) => id !== 'meridian');
      tapRide('flight:a320');
      for (const id of ['fa18', 'meridian']) {
        const card = free.querySelector(`[data-aircraft="${id}"]`);
        if (card) card.click();
      }
      const after = mp.ride();
      const offered = mp.rides().map((x) => x.type);
      r.ok('mp plane: a locked aeroplane is still refused — behind the passcode, or not bought — and the ride stays the one you had',
        menus.chosenAircraft === 'a320' && key(after) === 'flight:a320' && !offered.includes('fa18') && !offered.includes('meridian'),
        `chosen ${menus.chosenAircraft}; ride ${key(after)}`);
      prog.militaryUnlocked = true;
      // And the lobby screen's own pick, made after, wins in turn.
      own('osprey');
      tapRide('flight:osprey');
      r.ok('mp plane: a ride tapped on the lobby screen after the Hangar wins in turn — the newest pick is the one',
        key(mp.ride()) === 'flight:osprey', key(mp.ride()));
    }

    /* ---- as a client: a lobby somebody else hosts ---- */
    {
      tapRide('flight:skylark');
      menus.showcaseUi.choose('f35b');
      const hsig = makeSig();
      await hsig.open(P.lobbyId(hash, 3));
      const got = [];
      const host = new S.HostSession({
        mode: 'lobby', profile: { name: 'Kind Koala', colour: P.COLOURS[1], key: 'v56planehostkeyv56pl' }, server: { map: 'kestrel', game: 'flight', lobby: 3 },
        spawnInfo: () => ({ x: -470, y: 16, z: 0, heading: 90, speed: 0, agl: 0, onGround: true }), onEvent: (t, a) => { if (t === 'state') got.push(a); },
      });
      host.attach(new Net(hsig));
      cleanups.push(() => { host.close(); hsig.close(); });
      const ht = setInterval(() => host.tick(performance.now(), P.encodeState({ t: performance.now(), pos: { x: -470, y: 16, z: 0 }, quat: { w: 1 }, vel: {}, game: 'flight', type: 'courier', onGround: true })), 66);
      cleanups.push(() => clearInterval(ht));
      lobbyScreen();
      await mp.joinLobby(3);
      const inside = await until(() => mp.ready && mp.lobby && mp.role === 'client' && sim.state === 'flying', 20000);
      for (let i = 0; i < 20; i++) {
        sim.update(1 / 30);
        await wait(33);
      }
      const hostSaw = await until(() => got.find((s) => s.type === 'f35b') || got[got.length - 1], 4000);
      const me = mp.events.players().find((p) => p.me);
      r.ok('mp plane: joining a lobby somebody else hosts, you fly the plane you picked in the Hangar — and the host sees that plane',
        !!inside && sim.aircraftType && sim.aircraftType.id === 'f35b' && !!hostSaw && hostSaw.type === 'f35b' && me && me.ride && me.ride.type === 'f35b',
        `flying ${sim.aircraftType && sim.aircraftType.id}; host saw ${hostSaw ? `${hostSaw.game}/${hostSaw.type}` : 'nothing'}`);
      mp.leave('left');
      clearInterval(ht);
      host.close();
      hsig.close();
      await wait(300);
      if (typeof sim.quitToMenu === 'function') sim.quitToMenu('main');
    }

    /* ---- as the host: a lobby you start, and a friend who joins ---- */
    {
      own('a380');
      tapRide('flight:skylark');
      menus.showcaseUi.choose('a380');
      lobbyScreen();
      await mp.joinLobby(4);
      const up = await until(() => mp.ready && mp.lobby && mp.role === 'host' && sim.state === 'flying', 30000);
      const fsig = makeSig();
      await fsig.open(P.playerPeerId());
      cleanups.push(() => fsig.close());
      const seen = [];
      const friend = new S.ClientSession({
        net: new Net(fsig), target: P.lobbyId(hash, 4), profile: { name: 'Sunny Puffin', colour: P.COLOURS[3], key: 'v56planefriendv56pla' },
        onEvent: (t, snap) => { if (t === 'state' && snap && snap.id === 0) seen.push(snap); },
      });
      const welcome = await friend.start().catch((e) => ({ err: e && e.code }));
      const ft = setInterval(() => friend.tick(performance.now(), P.encodeState({ t: performance.now(), pos: { x: -470, y: 16, z: 10 }, quat: { w: 1 }, vel: {}, game: 'flight', type: 'skylark', onGround: true })), 66);
      cleanups.push(() => { clearInterval(ft); friend.leave(); });
      for (let i = 0; i < 30; i++) {
        sim.update(1 / 30);
        await wait(33);
      }
      const friendSaw = await until(() => seen.find((s) => s.type === 'a380') || seen[seen.length - 1], 4000);
      r.ok('mp plane: starting a lobby, you fly the plane you picked in the Hangar — and a friend who joins sees that plane',
        !!up && !(welcome && welcome.err) && sim.aircraftType && sim.aircraftType.id === 'a380' && !!friendSaw && friendSaw.type === 'a380',
        `flying ${sim.aircraftType && sim.aircraftType.id}; friend saw ${friendSaw ? `${friendSaw.game}/${friendSaw.type}` : 'nothing'}${welcome && welcome.err ? `; join ${welcome.err}` : ''}`);
      clearInterval(ft);
      friend.leave();
      mp.leave('left');
      await wait(300);
      if (typeof sim.quitToMenu === 'function') sim.quitToMenu('main');
    }

    /* ---- the Races card, from the Boat page ---- */
    {
      menus.showcaseUi.choose('courier');
      tapRide('boat:boat');
      const le = lobbyScreen();
      const pick = le.querySelector('.mp-racecard [data-mp-race-pick]');
      if (pick) pick.click();
      await wait(50);
      const got = mp.ride();
      mp.back();
      r.ok('mp plane: the Races card’s “Pick Coral Atoll” from the Boat page puts you in your own plane, not the first one on the list',
        !!pick && key(got) === 'flight:courier', pick ? key(got) : 'no Races card on the lobby screen');
    }
  } catch (err) {
    r.ok('mp plane: the checks ran to the end', false, String(err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err));
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
    L.forgetLobbyLists();
    prog.unlocked = progBefore.unlocked;
    prog.militaryUnlocked = progBefore.militaryUnlocked;
    if (menus.syncFleetLocks) menus.syncFleetLocks();
    if (menus.pickFreeAircraft) menus.pickFreeAircraft(chosenBefore);
    else menus.chosenAircraft = chosenBefore;
    menus.currentGame = gameBefore;
    mp.profile = profileBefore;
    for (const k of [PROFILE_KEY, PROG_KEY]) {
      try {
        if (stored[k] === null) localStorage.removeItem(k);
        else localStorage.setItem(k, stored[k]);
      } catch (e) {
        /* storage is not ours to fix */
      }
    }
    if (sim.state === 'flying' && typeof sim.quitToMenu === 'function') sim.quitToMenu('main');
    if (wasScreen && !['multiplayer', 'lobbies'].includes(wasScreen)) menus.show(wasScreen);
    else if (!wasScreen) menus.hide();
    else menus.show('main');
    await wait(300);
  }
}

export default check;
