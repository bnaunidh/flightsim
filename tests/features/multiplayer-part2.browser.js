/**
 * List 2's multiplayer, part 2, in one tab — run by tests/selftest.js through
 * tests/features/index.js (CHECKS), or by hand:
 *
 *   const { check } = await import('/tests/features/multiplayer-part2.browser.js');
 *   const r = { checks: [], ok(n, p, d) { this.checks.push({ n, p, d }); return p; } };
 *   await check(window.__sim, r, console.log);
 *
 * THIS TAB HOSTS a private match on Coral Atoll and two players join it by
 * the code — ClientSessions in this same tab over real WebRTC, each with a
 * GameEvents of its own, sending snapshots from where the check puts them:
 *
 *   PvP        the switch on the lobby screen and the badge; three seconds to
 *              arm; the game's own pellets from Space tagging a friend flying
 *              150 m ahead (five hearts, the POOF, the scoreboard, the friend
 *              hidden while tagged out); being tagged — the camera circling
 *              the puff, back three seconds later higher up in a shield; a
 *              player with PvP OFF never hit; a crash between two in PvP
 *   bumping    a gentle bump pushes this aeroplane off a friend; nothing on
 *              the ground, inside the spawn shield, against a ghost, or when
 *              two start inside each other
 *   racing     "🏁 Race" on the badge: the grid, 3-2-1-GO, the rings, a
 *              friend's finish, the results card
 *   the world  the host's storm reaching the players; "⚡ Summon": a
 *              tornado for everybody, "not yet" for one straight after, a
 *              wildfire and a meteor shower; the host's AI aeroplanes sent;
 *              a friend's crash marked on the minimap
 *
 * THEN THIS TAB JOINS a private match somebody else hosts: their weather,
 * their AI aeroplane drawn here, their summoned storm, their race grid.
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
  try {
    return fn();
  } catch (e) {
    return null;
  }
}

export async function check(sim, r, say = () => {}) {
  const THREE = await import('../../src/vendor/three.module.js');
  const mpMod = await import('../../src/features/multiplayer.js');
  const P = await import('../../src/features/multiplayer/protocol.js');
  const S = await import('../../src/features/multiplayer/session.js');
  const E = await import('../../src/features/multiplayer/events.js');
  const { Net } = await import('../../src/features/multiplayer/link.js');
  const { Signaling } = await import('../../src/features/multiplayer/signaling.js');
  const { FakeSignalServer } = await import('./multiplayer.fakes.js');
  const pvp = await import('../../src/features/pvp.js');
  const PR = await import('../../src/features/pvp/rules.js');
  const bump = await import('../../src/features/bump.js');
  const race = await import('../../src/features/race.js');
  const RR = await import('../../src/features/race/rules.js');
  const world = await import('../../src/features/mpworld.js');
  const shared = await import('../../src/features/mpplay/shared.js');
  const { extStatus, extCamera } = await import('../../src/game/extensions.js');
  const { wildfireDebug } = await import('../../src/features/wildfire.js');
  const { spawnTraffic, clearTraffic } = await import('../../src/features/traffic.js');
  const { heightAt } = await import('../../src/world/terrain.js');
  const mp = mpMod.multiplayer;
  const ch = mp.events;
  if (typeof RTCPeerConnection !== 'function') {
    r.ok('mp part 2: this browser has WebRTC', false, 'no RTCPeerConnection');
    return;
  }
  const live = extStatus().filter((e) => ['pvp', 'bump', 'race', 'mp-world', 'mpplay-fx'].includes(e.id));
  r.ok('mp part 2: the four features and their effects are plugged in and running', live.length === 5 && live.every((e) => e.live), live.map((e) => `${e.id}:${e.live}`).join(' '));
  mp.install(sim);
  let savedProfile = null;
  try {
    savedProfile = localStorage.getItem('islandsim.multiplayer.v1');
  } catch (e) {
    savedProfile = null;
  }
  const profileBefore = { ...mp.profile };
  const wasScreen = sim.menus && sim.menus.current;
  const mapBefore = sim.settings.map;
  const server = new FakeSignalServer();
  const backend = { id: 'fake', url: 'wss://fake.invalid/peerjs', key: 'peerjs', label: 'the test server' };
  const hash = 'b0a7c0ffee34';
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
  const key = (i) => `part2key${i}abcdefghijk`.slice(0, 20);
  /** The game's frames, for a while, with the network's timers in between. */
  const frames = async (n, each = null) => {
    for (let i = 0; i < n; i++) {
      if (each) each(i);
      sim.update(1 / 30);
      await wait(16);
    }
  };
  const airborne = (x, z, heading = 90, agl = 400) => {
    const ac = sim.aircraft;
    ac.reset({ pos: new THREE.Vector3(x, 0, z), headingDeg: heading, speed: 55, altAGL: agl, engineOn: true, gearDown: false });
    ac.controls.throttle = 0.7;
    if (sim.input) {
      sim.input.throttleTarget = 0.7;
      if (sim.input.out) sim.input.out.throttle = 0.7;
    }
  };
  const fwd = () => new THREE.Vector3(0, 0, -1).applyQuaternion(sim.aircraft.quat);

  /** A friend in the game: a ClientSession with its own events channel, flying where it is told. */
  async function friend(code, i, name, colour) {
    const sig = makeSig();
    await sig.open(P.playerPeerId());
    cleanups.push(() => sig.close());
    const ev = new E.GameEvents();
    for (const [k, def] of ch.kinds) ev.kinds.set(k, def);
    const heard = [];
    const at = { pos: { x: 0, y: 300, z: 0 }, vel: { x: 0, y: 0, z: 0 }, quat: { w: 1 }, pvp: false, ghost: false, onGround: false };
    const c = new S.ClientSession({
      net: new Net(sig), target: P.codeId(code), profile: { name, colour, key: key(i) },
      onEvent: (t, a, b) => {
        if (t === 'gev') ev.fromWire(a, b);
        else if (t === 'gst') ev.stateFromWire(a);
      },
    });
    const w = await c.start();
    ev.attach(c, 'client', w.you);
    const orig = ev._deliver.bind(ev);
    ev._deliver = (kind, data, from, meta) => {
      heard.push({ kind, data, from: from && from.id });
      return orig(kind, data, from, meta);
    };
    let seq = 0;
    const tm = setInterval(() => {
      const t = performance.now();
      c.tick(t, P.encodeState({ id: w.you, seq: seq++, t, pos: at.pos, quat: at.quat, vel: at.vel, game: 'flight', type: 'skylark', pvp: at.pvp, ghost: at.ghost, onGround: at.onGround, engineOn: true }));
    }, 1000 / 15);
    cleanups.push(() => clearInterval(tm));
    return { c, ev, heard, at, id: w.you, w, stop: () => { clearInterval(tm); c.leave(); } };
  }

  try {
    mp.configure({ backend, hash, WebSocketImpl: server.WebSocket });
    mp.setProfile({ name: 'Swift Falcon', colour: P.COLOURS[0], chosen: true });
    mp.setPvp(false);
    mp.profile.ride = { game: 'flight', type: 'skylark' };

    /* ---- the lobby screen: PvP, the bumping rule, the Ring Rally ---------------------------- */
    mpMod.openLobbies(sim);
    const le = document.querySelector('[data-screen="lobbies"]');
    const sw = (v) => le.querySelector(`[data-mp-pvp="${v}"]`);
    const offFirst = sw('off').classList.contains('is-on') && !sw('on').classList.contains('is-on');
    sw('on').click();
    const onAfter = sw('on').classList.contains('is-on') && mp.profile.pvp === true && /Space/.test(le.querySelector('[data-mp-pvphint]').textContent);
    sw('off').click();
    r.ok('mp part 2: the lobby screen has the PvP switch — OFF until turned on, and it says what ON means',
      offFirst && onAfter && mp.profile.pvp === false, le.querySelector('[data-mp-pvphint]').textContent);
    const rules = [...le.querySelectorAll('[data-mp-bump]')].map((b) => b.textContent);
    // Both rows (list 3): the five Wi-Fi lobbies and the five world lobbies.
    const ruleLines = [...le.querySelectorAll('[data-mp-lobby] [data-mp-rule], [data-mp-world] [data-mp-rule]')].map((e) => e.textContent.trim());
    r.ok('mp part 2: every lobby card (Wi-Fi and World) says its bumping rule, and a private match picks its own (default: gentle bumps, a crash in PvP)',
      rules.length === 3 && ruleLines.length === 10 && ruleLines.every((t) => /Bumps · PvP crash/.test(t)) && le.querySelector('[data-mp-bump="2"]').classList.contains('is-on'),
      `${ruleLines[0]} | ${rules.join(' / ')}`);
    const atollTile = le.querySelector('[data-mp-private-map="atoll"]');
    r.ok('mp part 2: the Ring Rally card is on the screen, and Coral Atoll’s tile says it has the race course',
      !!le.querySelector('[data-mp-race-alone]') && atollTile && /race course/.test(atollTile.textContent), atollTile && atollTile.textContent);

    /* ---- this tab hosts a private match on Coral Atoll ------------------------------------------ */
    le.querySelector('[data-mp-race-pick]').click();
    le.querySelector('[data-mp-bump="2"]').click();
    le.querySelector('[data-mp-private]').click();
    const up = await until(() => mp.role === 'host' && mp.ready && sim.state === 'flying', 20000);
    const code = mp.server && mp.server.code;
    r.ok('mp part 2: "Pick Coral Atoll" and Make it: a private match on the race course, with the rule it was made with',
      !!up && sim.settings.map === 'atoll' && mp.bumpRuleNow() === 'pvp' && /Bumps · PvP crash/.test(mp.hud.el.querySelector('[data-mp-badge-code]').textContent),
      `${sim.settings.map}, rule ${mp.bumpRuleNow()}, badge: ${mp.hud.el.querySelector('.mp-badge').textContent.replace(/\s+/g, ' ').trim()}`);
    const A = await friend(code, 1, 'Brave Otter', P.COLOURS[3]);
    const B = await friend(code, 2, 'Sunny Puffin', P.COLOURS[5]);
    await until(() => mp.remotes.players.size === 2, 5000);
    airborne(0, 0);
    await frames(20, () => {
      const f = fwd();
      const me = sim.aircraft.pos;
      A.at.pos = { x: me.x + f.x * 150, y: me.y, z: me.z + f.z * 150 };
      B.at.pos = { x: me.x + 400, y: me.y + 200, z: me.z + 400 };
    });
    await wait(200);
    // In the order they are shown (CSS order), not the order they were made.
    const chips = [...mp.hud.ext.querySelectorAll('[data-mpp-chip]')].filter((b) => !b.hidden).sort((a, b) => Number(a.style.order) - Number(b.style.order)).map((b) => b.textContent.trim());
    r.ok('mp part 2: the badge has the chips — ⚔ PvP OFF, ⚡ Summon and 🏁 Race (on the race course)', chips.length === 3 && /PvP OFF/.test(chips[0]) && /Summon/.test(chips[1]) && /Race/.test(chips[2]), chips.join(' | '));

    /* ---- PvP ------------------------------------------------------------------------------------- */
    mp.hud.ext.querySelector('[data-mpp-chip="pvp"]').click();
    A.ev.toHost('pvp:want', { on: true });
    A.at.pvp = true;
    const armed = await until(() => { sim.update(1 / 30); const s = pvp.pvpDebug(); return s.me && s.me.arming ? s : null; }, 2000);
    const on = await until(() => { sim.update(1 / 30); const a = PR.rowOf(A.ev.getState('pvp'), A.id); const m = pvp.pvpDebug().me; return a && a.on && m && m.on; }, 6000, 50);
    r.ok('mp part 2: tapping ⚔ PvP turns it on after three seconds — for this player and for a friend who asked, on every copy of the scores',
      !!armed && !!on && mp.profile.pvp === true && PR.rowOf(B.ev.getState('pvp'), 0).on, JSON.stringify(A.ev.getState('pvp')));
    await wait(1100);
    let fireShown = false;
    let reticle = false;
    await frames(10, () => {
      const f = fwd();
      const me = sim.aircraft.pos;
      A.at.pos = { x: me.x + f.x * 150, y: me.y + 1, z: me.z + f.z * 150 };
      A.at.vel = { x: sim.aircraft.vel.x, y: sim.aircraft.vel.y, z: sim.aircraft.vel.z };
    });
    fireShown = !document.querySelector('.pvp-fire').hidden;
    reticle = !document.querySelector('.pvp-reticle').hidden;
    // Space, as a child would press it.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
    const shotsBefore = pvp.pvpDebug().stats.shots;
    let downSeen = null;
    for (let i = 0; i < 150 && !downSeen; i++) {
      const f = fwd();
      const me = sim.aircraft.pos;
      A.at.pos = { x: me.x + f.x * 150, y: me.y + 1, z: me.z + f.z * 150 };
      A.at.vel = { x: sim.aircraft.vel.x, y: sim.aircraft.vel.y, z: sim.aircraft.vel.z };
      sim.update(1 / 30);
      await wait(16);
      downSeen = A.heard.find((e) => e.kind === 'pvp:down' && e.data.t === A.id);
    }
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true }));
    const ouches = A.heard.filter((e) => e.kind === 'pvp:ouch' && e.data.t === A.id).length;
    const st1 = pvp.pvpDebug();
    r.ok('mp part 2: Space fires the pellets; a friend 150 m ahead loses four hearts and is TAGGED on the fifth — everybody is told',
      fireShown && reticle && st1.stats.shots > shotsBefore && ouches === 4 && !!downSeen && downSeen.data.by === 0 && B.heard.some((e) => e.kind === 'pvp:down'),
      `${st1.stats.shots - shotsBefore} shots, ${st1.stats.claims} claimed, ${ouches} hearts, down ${!!downSeen}; FIRE button ${fireShown}, reticle ${reticle}`);
    await frames(4);
    const board = mp.hud.ext.querySelector('.mpp-board');
    const feedNow = shared.feedLines().join(' | ');
    r.ok('mp part 2: the scoreboard on the badge counts the tag; the feed says who tagged who; the tagged friend is not drawn until they are back',
      board && !board.hidden && /Swift Falcon.*1/.test(board.textContent) && /Swift Falcon tagged Brave Otter/.test(feedNow) && mp.remotes.hidden(A.id) === true
      && /TAGGED/.test(shared.bigCardText()),
      `${board && board.textContent} | ${feedNow} | ${shared.bigCardText()}`);
    // A friend with PvP OFF is never hit.
    const claimsBefore = pvp.pvpDebug().stats.claims;
    pvp.pvpDebug().fire(true);
    await frames(40, () => {
      const f = fwd();
      const me = sim.aircraft.pos;
      B.at.pos = { x: me.x + f.x * 140, y: me.y, z: me.z + f.z * 140 };
      B.at.vel = { x: sim.aircraft.vel.x, y: sim.aircraft.vel.y, z: sim.aircraft.vel.z };
    });
    pvp.pvpDebug().fire(false);
    r.ok('mp part 2: a friend with PvP OFF flying through the same pellets is never hit — no claim, no heart lost',
      pvp.pvpDebug().stats.claims === claimsBefore && !B.heard.some((e) => e.kind === 'pvp:ouch' && e.data.t === B.id), `${pvp.pvpDebug().stats.claims - claimsBefore} claims`);
    B.at.pos = { x: sim.aircraft.pos.x + 900, y: sim.aircraft.pos.y + 300, z: sim.aircraft.pos.z + 900 };
    // Being tagged: the friend (back, shield given up by firing) shoots this player five times.
    await until(() => { sim.update(1 / 30); const a = PR.rowOf(A.ev.getState('pvp'), A.id); return a && !a.down; }, 6000, 50);
    A.ev.send('pvp:fire', { on: true });
    await wait(100);
    const aglBefore = sim.aircraft.pos.y - Math.max(0, heightAt(sim.aircraft.pos.x, sim.aircraft.pos.z));
    for (let i = 0; i < 5; i++) {
      const me = sim.aircraft.pos;
      A.at.pos = { x: me.x - 80, y: me.y, z: me.z };
      A.ev.toHost('pvp:hit', { t: 0 });
      await wait(60);
      sim.update(1 / 30);
    }
    const downMe = await until(() => { sim.update(1 / 30); return pvp.pvpDebug().P.down; }, 3000);
    const heldAt = downMe ? downMe.pos.clone() : null;
    await frames(20);
    const camOwned = extCamera(sim, 1 / 30);
    const heldStill = heldAt && sim.aircraft.pos.distanceTo(heldAt) < 1;
    const modelHidden = sim.model && sim.model.visible === false;
    await until(() => { sim.update(1 / 30); return !pvp.pvpDebug().P.down; }, 5000, 30);
    await frames(3);
    const aglAfter = sim.aircraft.pos.y - Math.max(0, heightAt(sim.aircraft.pos.x, sim.aircraft.pos.z));
    const shielded = pvp.pvpDebug().P.shieldUntil > performance.now() && shared.ghostReasons().includes('pvp-shield');
    A.ev.send('pvp:fire', { on: false });
    r.ok('mp part 2: tagged — held where it happened, the camera circling the puff, the aeroplane hidden; back three seconds later, higher, in a shield',
      !!downMe && heldStill && camOwned && modelHidden && sim.model.visible && aglAfter >= 250 && shielded && pvp.pvpDebug().stats.respawns >= 1,
      `held ${heldStill}, camera ${camOwned}, hidden ${modelHidden}; ${Math.round(aglBefore)} m → ${Math.round(aglAfter)} m above the ground; shield ${shielded}`);

    /* ---- bumping ---------------------------------------------------------------------------------- */
    // Out of PvP's shield and the spawn one first.
    await until(() => { sim.update(1 / 30); return !shared.ghostReasons().length; }, 8000, 50);
    airborne(300, 400, 90, 300);
    const push = async (setup, n = 20) => {
      const b0 = bump.bumpDebug().stats.pushes;
      const p0 = sim.aircraft.pos.clone();
      await frames(n, setup);
      return { pushes: bump.bumpDebug().stats.pushes - b0, moved: sim.aircraft.pos.distanceTo(p0) };
    };
    // A friend with PvP OFF drifting into this aeroplane's side at 6 m/s: a gentle bump.
    let side = 14;
    B.at.pvp = false;
    B.at.ghost = false;
    const g1 = await push(() => {
      const me = sim.aircraft.pos;
      side = Math.max(4, side - 0.2);
      B.at.pos = { x: me.x, y: me.y, z: me.z + side };
      B.at.vel = { x: sim.aircraft.vel.x, y: sim.aircraft.vel.y, z: sim.aircraft.vel.z - 6 };
    }, 40);
    const bumps1 = bump.bumpDebug().stats.bumps;
    r.ok('mp part 2: a friend drifting into your side is a gentle bump — this aeroplane is pushed off, BONK, nobody crashes',
      g1.pushes > 0 && bumps1 >= 1 && !sim.aircraft.crashed && !pvp.pvpDebug().P.down, `${g1.pushes} pushes, ${bumps1} bumps`);
    B.at.pos = { x: sim.aircraft.pos.x + 900, y: sim.aircraft.pos.y, z: sim.aircraft.pos.z };
    await frames(8);
    // A ghost (just arrived, tagged out, on the ground): never.
    B.at.ghost = true;
    const g2 = await push(() => {
      const me = sim.aircraft.pos;
      B.at.pos = { x: me.x, y: me.y, z: me.z + 6 };
      B.at.vel = { x: sim.aircraft.vel.x, y: 0, z: sim.aircraft.vel.z - 6 };
    }, 20);
    B.at.ghost = false;
    B.at.pos = { x: sim.aircraft.pos.x + 900, y: sim.aircraft.pos.y, z: sim.aircraft.pos.z };
    await frames(8);
    // Two who start inside each other part as ghosts.
    const stuck0 = bump.bumpDebug().stats.stuck;
    const g3 = await push(() => {
      const me = sim.aircraft.pos;
      B.at.pos = { x: me.x + 0.5, y: me.y, z: me.z + 0.5 };
      B.at.vel = { x: sim.aircraft.vel.x, y: sim.aircraft.vel.y, z: sim.aircraft.vel.z };
    }, 20);
    B.at.pos = { x: sim.aircraft.pos.x + 900, y: sim.aircraft.pos.y, z: sim.aircraft.pos.z };
    await frames(8);
    // On the ground: the runway is never a pile-up.
    sim.aircraft.reset({ pos: new THREE.Vector3(-300, 0, 0), headingDeg: 90, speed: 0, altAGL: null, engineOn: true });
    await frames(5);
    const g4 = await push(() => {
      const me = sim.aircraft.pos;
      B.at.pos = { x: me.x + 5, y: me.y, z: me.z };
      B.at.vel = { x: -5, y: 0, z: 0 };
    }, 20);
    r.ok('mp part 2: no bumping into a ghost, none when two start inside each other (they part as ghosts), none on the ground',
      g2.pushes === 0 && g3.pushes === 0 && bump.bumpDebug().stats.stuck > stuck0 && g4.pushes === 0 && shared.ghostReasons().includes('bump-ground'),
      `ghost ${g2.pushes}, inside ${g3.pushes} (stuck ${bump.bumpDebug().stats.stuck - stuck0}), ground ${g4.pushes}`);
    B.at.pos = { x: 900, y: 400, z: 900 };
    // Two players in PvP colliding hard: a crash for both, as the host decides.
    airborne(300, -400, 90, 300);
    await until(() => { sim.update(1 / 30); return !shared.ghostReasons().length && PR.rowOf(A.ev.getState('pvp'), A.id) && !PR.rowOf(A.ev.getState('pvp'), A.id).shield; }, 8000, 50);
    const rams0 = A.heard.filter((e) => e.kind === 'pvp:down' && e.data.how === 1).length;
    let gap = 30;
    await frames(30, () => {
      const me = sim.aircraft.pos;
      gap = Math.max(0, gap - 3);
      A.at.pos = { x: me.x + gap, y: me.y, z: me.z };
      A.at.vel = { x: sim.aircraft.vel.x - 30, y: 0, z: sim.aircraft.vel.z };
    });
    const rams = A.heard.filter((e) => e.kind === 'pvp:down' && e.data.how === 1);
    r.ok('mp part 2: two players both in PvP flying into each other hard: a crash — the host tags both out',
      rams.length - rams0 === 2 && rams.some((e) => e.data.t === 0) && rams.some((e) => e.data.t === A.id), `${rams.length - rams0} downs from the crash`);
    A.at.pos = { x: 2000, y: 400, z: 2000 };
    await until(() => { sim.update(1 / 30); return !pvp.pvpDebug().P.down; }, 6000, 30);

    /* ---- the Ring Rally ------------------------------------------------------------------------------ */
    await frames(3);
    mp.hud.ext.querySelector('[data-mpp-chip="race"]').click();
    const grid = await until(() => { sim.update(1 / 30); const s = race.raceState(); return s && s.s === RR.S.grid ? s : null; }, 3000, 30);
    await frames(5);
    const slot0 = RR.gridSlot(0);
    const onGrid = Math.hypot(sim.aircraft.pos.x - slot0.x, sim.aircraft.pos.z - slot0.z) < 3;
    const gridA = RR.cleanState(A.ev.getState('race'));
    r.ok('mp part 2: 🏁 Race puts everybody flying on the grid — this aeroplane in the first place, the friends told too, racers ghosts to everybody',
      !!grid && grid.ent.length === 3 && onGrid && gridA && gridA.s === RR.S.grid && shared.ghostReasons().includes('race') && !document.querySelector('.race-hud').hidden,
      `${grid && grid.ent.join()}; at ${Math.round(sim.aircraft.pos.x)},${Math.round(sim.aircraft.pos.z)}; ${document.querySelector('.race-hud').textContent}`);
    const cards = new Set();
    const go = await until(() => { sim.update(1 / 30); const t = shared.bigCardText(); if (t) cards.add(t.slice(0, 3)); const s = race.raceState(); return s && s.s === RR.S.go ? s : null; }, 7000, 30);
    await frames(3);
    r.ok('mp part 2: the lights count 3, 2, 1 and it is GO — held on the grid until then',
      !!go && ['3', '2', '1'].every((n) => [...cards].some((c) => c.startsWith(n))) && Math.hypot(sim.aircraft.pos.x - slot0.x, sim.aircraft.pos.z - slot0.z) < 5, [...cards].join(','));
    // Brave Otter flies every ring; Sunny Puffin leaves; this player flies them too, and the race clock is moved on a minute.
    const n = go.n;
    const fr = race.raceDebug().frames;
    for (let k = 1; k <= RR.totalRings(); k++) {
      A.ev.toHost('race:gate', { n, k });
      await wait(180);
    }
    B.ev.toHost('race:quit', { n });
    const Rd = race.raceDebug();
    Rd.G.host.goAt -= 70000;
    Rd.L.t0 -= 70000;
    A.ev.toHost('race:done', { n, ms: Math.round(performance.now() - Rd.G.host.goAt) });
    for (let k = 0; k < RR.totalRings(); k++) {
      const f = fr[k % fr.length];
      const hd = (Math.atan2(f.nx, -f.nz) * 180) / Math.PI;
      sim.aircraft.reset({ pos: new THREE.Vector3(f.x - f.nx * 25, 0, f.z - f.nz * 25), headingDeg: hd, speed: 50, altAGL: 30, engineOn: true, gearDown: false });
      sim.aircraft.pos.y = f.y;
      sim.update(1 / 30);
      sim.aircraft.pos.set(f.x + f.nx * 2, f.y, f.z + f.nz * 2);
      sim.update(1 / 30);
      // A ring every 0.2 s is already thirty times faster than flying it; faster still and the channel's own
      // limit (six a second from any one player, race.js) turns the ring messages away, as it should.
      await wait(200);
    }
    const done = await until(() => { sim.update(1 / 30); const s = race.raceState(); return s && s.s === RR.S.done ? s : null; }, 4000, 30);
    await until(() => { const s = RR.cleanState(B.ev.getState('race')); return s && s.s === RR.S.done; }, 2000);
    const res = document.querySelector('.race-results');
    const resText = res ? res.textContent.replace(/\s+/g, ' ') : '';
    r.ok('mp part 2: every ring in order, a finish each for this player and Brave Otter, Sunny Puffin out — the results card, medals and times',
      !!done && done.fin.length === 2 && res && !res.hidden && /🥇/.test(resText) && /🥈/.test(resText) && /Sunny Puffin.*didn’t finish/.test(resText) && !!res.querySelector('[data-race-again]')
      && RR.cleanState(B.ev.getState('race')).s === RR.S.done,
      `${resText.slice(0, 220)} | state ${JSON.stringify(race.raceState())} | mine ${race.raceDebug().L && race.raceDebug().L.k} rings, refused ${race.raceDebug().refused.join('/')}`);
    // Left open: leaving the game takes it away (below).

    /* ---- the world everybody shares ---------------------------------------------------------------------- */
    airborne(200, 600, 90, 300);
    sim.weather.applyPreset('storm');
    const wx = await until(() => { const v = A.ev.getState('world:wx'); return v && v.c === 3 ? v : null; }, 3000);
    r.ok('mp part 2: the host’s weather is everybody’s — a storm front reaches the players within a second', !!wx && wx.t === 1 && Math.round(wx.w) === 26, JSON.stringify(wx));
    sim.weather.applyPreset('bluebird');
    mp.hud.ext.querySelector('[data-mpp-chip="summon"]').click();
    const menu = mp.hud.ext.querySelector('.mpp-menu');
    const offered = menu ? [...menu.querySelectorAll('[data-summon]')].map((b) => b.dataset.summon) : [];
    r.ok('mp part 2: ⚡ Summon lists what can be summoned for everybody — the weather disasters, a wildfire and a meteor shower',
      menu && !menu.hidden && ['tornado', 'stormCell', 'typhoon', 'lightning', 'fogBank', 'microburst', 'wildfire', 'meteors'].every((id) => offered.includes(id)), offered.join(','));
    menu.querySelector('[data-summon="tornado"]').click();
    await wait(150);
    sim.update(1 / 30);
    const tornadoA = A.heard.find((e) => e.kind === 'world:dis' && e.data.id === 'tornado');
    B.ev.toHost('world:summon', { id: 'meteors', x: 0, z: 0 });
    await wait(200);
    r.ok('mp part 2: a tornado summoned here happens here and for everybody; a meteor shower straight after is “not yet”, told only to who asked',
      !!tornadoA && tornadoA.data.by === 0 && sim.activeEvents && 'tornado' in sim.activeEvents && B.heard.some((e) => e.kind === 'world:wait') && !A.heard.some((e) => e.kind === 'world:wait')
      && /You<\/b> summoned|You summoned/.test(shared.feedLines().join(' ')), shared.feedLines().join(' | '));
    // The cooldowns, moved on.
    world.worldDebug().W.lastGameSummon = -Infinity;
    world.worldDebug().W.lastBy.clear();
    A.ev.toHost('world:summon', { id: 'meteors', x: 0, z: 0 });
    const meteors = await until(() => { sim.update(1 / 30); return sim.meteors && sim.meteors.active; }, 3000, 30);
    r.ok('mp part 2: a meteor shower a friend summons starts here too, and everybody is told', !!meteors && B.heard.some((e) => e.kind === 'world:dis' && e.data.id === 'meteors'),
      `meteors ${!!meteors}`);
    if (sim.meteors && sim.meteors.active) sim.meteors.end();
    // The host's AI aeroplanes go to everybody.
    const sp = spawnTraffic(sim, 'arrive');
    await frames(12);
    const tr = A.heard.filter((e) => e.kind === 'world:traffic').at(-1);
    r.ok('mp part 2: the host’s AI aeroplanes go to everybody, five times a second — type, place, heading and speed',
      sp.ok && tr && tr.data.a.length >= 1 && typeof tr.data.a[0][1] === 'string', `${sp.ok ? 'spawned' : sp.why}; ${tr ? JSON.stringify(tr.data.a[0]) : 'nothing sent'}`);
    clearTraffic(sim);
    // A friend's crash on the minimap.
    A.ev.send('world:hap', { type: 'crash', kind: 'bonk', vehicle: 'plane', x: Math.round(sim.aircraft.pos.x + 300), z: Math.round(sim.aircraft.pos.z), map: 'atoll' });
    const mark = await until(() => world.worldDebug().marks.length || world.worldDebug().crashes, 2000);
    r.ok('mp part 2: a friend’s crash is marked on the minimap in their colour (by the crashes feature where it is here, else by this one)',
      !!mark && (world.worldDebug().crashes || world.worldDebug().marks.some((m) => m.colour === P.COLOURS[3])), JSON.stringify(world.worldDebug().marks));
    A.stop();
    B.stop();
    mp.leave('left');
    await wait(300);
    r.ok('mp part 2: leaving ends it all — no chips, no race, no results card, no scores, no ghost bit left behind',
      !ch.active && !race.raceState() && !pvp.pvpDebug().state && !shared.ghostReasons().includes('race') && document.querySelector('.race-results').hidden,
      shared.ghostReasons().join(','));

    /* ---- this tab JOINS somebody else's game ---------------------------------------------------------------- */
    {
      const claim = await S.claimCode({ makeSig });
      const got = [];
      const host = new S.HostSession({
        mode: 'code', profile: { name: 'Kind Koala', colour: P.COLOURS[1], key: 'p2hostkeyp2hostkeyp2' }, server: { map: 'kestrel', game: 'flight', code: claim.code, bump: 1 },
        spawnInfo: () => ({ x: -300, y: 20, z: 0, heading: 90, speed: 0, agl: 0, onGround: true }),
        weather: () => ({ time: 'day', condition: 'clear', windSpeedKts: 5, windDirDeg: 90 }),
        onEvent: (t, a, b) => { if (t === 'gev') hostEv.fromWire(a, b); if (t === 'join') hostEv.joined(a); if (t === 'state') got.push(a); },
      });
      const hostEv = new E.GameEvents();
      for (const [k, def] of ch.kinds) hostEv.kinds.set(k, def);
      host.attach(new Net(claim.sig));
      hostEv.attach(host, 'host', 0);
      cleanups.push(() => { host.close(); claim.sig.close(); });
      const ht = setInterval(() => host.tick(performance.now(), P.encodeState({ t: performance.now(), pos: { x: -300, y: 20, z: 0 }, quat: { w: 1 }, vel: {}, game: 'flight', type: 'skylark', onGround: true })), 66);
      cleanups.push(() => clearInterval(ht));
      mpMod.openLobbies(sim);
      mp.joinCode(claim.code);
      const inside = await until(() => mp.ready && mp.role === 'client' && sim.state === 'flying', 20000);
      await frames(10);
      r.ok('mp part 2: joining a game somebody else hosts: its bumping rule comes with it, and no AI traffic of this player’s own runs',
        !!inside && mp.bumpRuleNow() === 'gentle' && (!Array.isArray(sim.traffic) || sim.traffic.length === 0), `rule ${mp.bumpRuleNow()}, ${Array.isArray(sim.traffic) ? sim.traffic.length : 0} AI aeroplanes of its own`);
      hostEv.setState('world:wx', { t: 2, c: 2, w: 18, d: 200, tc: -1, tl: 0 });
      const wxIn = await until(() => sim.weather.time === 'night' && sim.weather.condition === 'rainy' && Math.round(sim.weather.windSpeedKts) === 18, 3000);
      r.ok('mp part 2: the host’s weather is this player’s — night, rain, 18 kt from 200°', !!wxIn,
        `${sim.weather.time} ${sim.weather.condition} ${sim.weather.windSpeedKts} kt from ${sim.weather.windDirDeg}`);
      airborne(0, 800, 90, 300);
      const me = sim.aircraft.pos;
      for (let i = 0; i < 6; i++) {
        hostEv.send('world:traffic', { a: [[7, 'skylark', Math.round(me.x + 200 + i * 8), Math.round(me.y), Math.round(me.z), 90, 45, 0, 0]] });
        await frames(6);
      }
      const mir = world.worldDebug().mirror.find((m) => m.id === 7);
      const model = sim.scene.getObjectByName('mp-traffic-7');
      r.ok('mp part 2: the host’s AI aeroplane is drawn here, where the host has it, as its own type',
        mir && mir.model && model && model.visible !== false && Math.hypot(mir.x - (me.x + 240), mir.z - me.z) < 60, JSON.stringify(mir));
      hostEv.send('world:dis', { id: 'stormCell', x: Math.round(me.x), z: Math.round(me.z), by: 0 });
      const storm = await until(() => { sim.update(1 / 30); return sim.activeEvents && sim.activeEvents.stormCell; }, 3000, 30);
      r.ok('mp part 2: a storm cell the host says somebody summoned starts here, and the feed says who', !!storm && /Kind Koala/.test(shared.feedLines().join(' ')), shared.feedLines().join(' | '));
      // The wildfire, summoned by somebody in a game on an island with grass and forest to burn.
      hostEv.send('world:dis', { id: 'wildfire', x: Math.round(me.x), z: Math.round(me.z), by: 0 });
      const fire = await until(() => { sim.update(1 / 30); const w = wildfireDebug(); return w && w.live && w.grid && w.grid.burning > 0 ? w : null; }, 4000, 30);
      r.ok('mp part 2: a WILDFIRE somebody summons is lit here too — a new disaster, for everybody', !!fire, fire ? `${fire.grid.burning} cells alight` : 'not lit');
      const raceChip = mp.hud.ext.querySelector('[data-mpp-chip="race"]');
      r.ok('mp part 2: off the race course, no 🏁 Race chip', !raceChip || raceChip.hidden);
      mp.leave('left');
      clearInterval(ht);
      host.close();
      claim.sig.close();
      await wait(300);
      r.ok('mp part 2: and leaving takes the host’s aeroplane and the race with it', world.worldDebug().mirror.length === 0 && !sim.scene.getObjectByName('mp-traffic-7') && !shared.ghostReasons().includes('race'));
    }

    /* ---- this tab joins IN THE VAN: disasters happen there too, and Space never sticks ------------------------ */
    {
      const claim = await S.claimCode({ makeSig });
      const host = new S.HostSession({
        mode: 'code', profile: { name: 'Kind Koala', colour: P.COLOURS[1], key: 'p2hostkeyp2hostkeyp3' }, server: { map: 'kestrel', game: 'flight', code: claim.code, bump: 1 },
        spawnInfo: () => ({ x: -300, y: 20, z: 0, heading: 90, speed: 0, agl: 0, onGround: true }),
        weather: () => ({ time: 'day', condition: 'clear', windSpeedKts: 5, windDirDeg: 90 }),
        onEvent: (t, a, b) => { if (t === 'gev') hostEv.fromWire(a, b); if (t === 'join') hostEv.joined(a); },
      });
      const hostEv = new E.GameEvents();
      for (const [k, def] of ch.kinds) hostEv.kinds.set(k, def);
      host.attach(new Net(claim.sig));
      hostEv.attach(host, 'host', 0);
      cleanups.push(() => { host.close(); claim.sig.close(); });
      const ht = setInterval(() => host.tick(performance.now(), P.encodeState({ t: performance.now(), pos: { x: -300, y: 20, z: 0 }, quat: { w: 1 }, vel: {}, game: 'flight', type: 'skylark', onGround: true })), 66);
      cleanups.push(() => clearInterval(ht));
      mp.profile.ride = { game: 'car', type: 'car' };
      mpMod.openLobbies(sim);
      mp.joinCode(claim.code);
      const inVan = await until(() => mp.ready && mp.role === 'client' && sim.state === 'flying' && sim.mode === 'drive', 20000);
      await frames(10);
      const van = sim.vehicle;
      const sumChip = mp.hud.ext.querySelector('[data-mpp-chip="summon"]');
      hostEv.send('world:dis', { id: 'tornado', x: Math.round(van.pos.x), z: Math.round(van.pos.z), by: 0 });
      const tor = await until(() => { sim.update(1 / 30); return sim.tornado.active && sim.activeEvents && sim.activeEvents.tornado > 0 ? sim.tornado : null; }, 3000, 30);
      const t0 = tor ? tor.pos.clone() : null;
      await frames(15);
      const near = tor ? Math.round(Math.hypot(tor.pos.x - van.pos.x, tor.pos.z - van.pos.z)) : null;
      r.ok('mp part 2: in the VAN — ⚡ Summon is on its badge, and a tornado somebody summons touches down near the van and moves (the flying game’s clock does not run there)',
        !!inVan && van && van.spec.kind === 'car' && sumChip && !sumChip.hidden && !!tor && near > 500 && near < 2000 && tor.pos.distanceTo(t0) > 0,
        `in ${sim.mode}/${van && van.spec.kind}, chip ${!!(sumChip && !sumChip.hidden)}, tornado ${near} m away`);
      // Somewhere near the van with ground to burn (the smoke is not drawn over the sea).
      const land = [[400, 0], [0, 400], [-400, 0], [0, -400], [200, 200], [0, 0]].map(([dx, dz]) => ({ x: Math.round(van.pos.x + dx), z: Math.round(van.pos.z + dz) })).find((q) => heightAt(q.x, q.z) > 1);
      hostEv.send('world:dis', { id: 'wildfire', x: land.x, z: land.z, by: 0 });
      const smoke = await until(() => { sim.update(1 / 30); return world.worldDebug().sights.smoke; }, 3000, 30);
      hostEv.send('world:dis', { id: 'meteors', x: 0, z: 0, by: 0 });
      await frames(30);
      let puffs = 0;
      let stars = 0;
      sim.scene.traverse((o) => {
        if (o.visible && o.name === 'mp-sight-smoke') puffs++;
        if (o.visible && o.name === 'mp-sight-meteor') stars++;
      });
      r.ok('mp part 2: in the VAN — a WILDFIRE is a column of smoke where it is, and a meteor shower is shooting stars in the sky',
        !!smoke && Math.abs(smoke.x - land.x) < 2 && Math.abs(smoke.z - land.z) < 2 && puffs >= 8 && stars >= 1 && /Kind Koala/.test(shared.feedLines().join(' ')),
        `smoke ${JSON.stringify(smoke)}, ${puffs} puffs, ${stars} stars`);
      // PvP on for this player (the host's word), Space pressed while it was still switching on: the game's input has it (the handbrake).
      const me = mp.meId;
      hostEv.setState('pvp', { p: [[0, 0, 5, 0, 0], [me, 3, 5, 0, 0]] });
      await frames(3);
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
      const heldArming = sim.input.keys.has('Space');
      hostEv.setState('pvp', { p: [[0, 0, 5, 0, 0], [me, 1, 5, 0, 0]] });
      await frames(3);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true }));
      const afterUp = sim.input.keys.has('Space');
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
      await frames(3);
      const firing = pvp.pvpDebug().P.sentFire;
      const heldLive = sim.input.keys.has('Space');
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true }));
      await frames(2);
      r.ok('mp part 2: in the VAN with PvP on — Space held from before PvP was on is let go on release (no stuck handbrake); a press now shoots, and never works the handbrake',
        heldArming && !afterUp && firing && !heldLive && !pvp.pvpDebug().P.sentFire, `held while arming ${heldArming}, after the release ${afterUp}; live: firing ${firing}, handbrake key ${heldLive}`);
      mp.leave('left');
      clearInterval(ht);
      host.close();
      claim.sig.close();
      await wait(300);
      r.ok('mp part 2: and leaving takes the smoke, the stars and the tornado’s line with it', !world.worldDebug().sights.smoke && !world.worldDebug().sights.meteors && !world.worldDebug().hazard);
    }
  } catch (err) {
    r.ok('mp part 2: the checks ran to the end', false, String(err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : err));
  } finally {
    for (const fn of cleanups.reverse()) {
      try {
        fn();
      } catch (e) {
        /* already gone */
      }
    }
    try {
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true }));
    } catch (e) {
      /* no keyboard */
    }
    if (mp.role || mp.lobby) mp.leave('menu');
    mp.stopLooking();
    mp.stopWatchingLobbies();
    mp.configure(null);
    mp.profile = profileBefore;
    try {
      if (savedProfile === null) localStorage.removeItem('islandsim.multiplayer.v1');
      else localStorage.setItem('islandsim.multiplayer.v1', savedProfile);
      localStorage.removeItem('islandsim.race.best.v1');
    } catch (e) {
      /* storage is not ours to fix */
    }
    if (sim.meteors && sim.meteors.active) sim.meteors.end();
    const res = document.querySelector('.race-results');
    if (res) res.hidden = true;
    if (sim.settings.map !== mapBefore && sim.mapBeforeMission) {
      /* quitting to the menu below puts the player's own island back */
    }
    if (sim.state !== 'menu' && typeof sim.quitToMenu === 'function') sim.quitToMenu();
    if (sim.menus) {
      if (wasScreen && !['multiplayer', 'lobbies'].includes(wasScreen)) sim.menus.show(wasScreen);
      else if (!wasScreen) sim.menus.hide();
      else sim.menus.show('main');
    }
    await wait(300);
  }
}

export default check;
