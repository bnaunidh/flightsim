/**
 * "troll thing for admin", in one tab — run by tests/selftest.js through
 * tests/features/index.js (CHECKS), or by hand:
 *
 *   const { check } = await import('/tests/features/admin-trolls.browser.js');
 *   const r = { checks: [], ok(n, p, d) { this.checks.push({ n, p, d }); return p; } };
 *   await check(window.__sim, r, console.log);
 *
 * THIS TAB HOSTS a private match (real WebRTC through the fake signalling
 * server, as owner-trolls.browser.js does) and is made an ADMIN the way a
 * host is: its own session's word (what multiplayer.js tryCode does for a
 * host — the host takes its own, checked, key). Three friends join: a plain
 * player, the OWNER and a second ADMIN (the host's record of them is set as
 * the door check would set it: ownerUntil from a checked pass, admin from a
 * checked key — no code or key is in this file). Then, through the game's
 * real code paths:
 *
 *   the menu       the admin's list has 🃏 Troll on the plain friend's row and
 *                  on neither the owner's nor the other admin's; the gold row
 *                  opens for the plain friend (thirteen trolls, Teleport them,
 *                  the Disasters tab)
 *   trolls         a click reaches the plain friend through the host, stamped
 *                  with this admin; the OWNER trolls this admin and it lands
 *                  here (the tag says the owner), wears off, and puts things
 *                  back; a troll from the other admin, or from the plain
 *                  friend, on this admin is refused; this admin's troll on
 *                  the owner (and on the other admin) is refused by the host
 *   disasters      a tornado sent after the plain friend reaches everybody;
 *                  one after the owner never starts; STOP NOW ends it
 *   teleport       "Teleport them" and a tap on the minimap send the plain
 *                  friend there; the owner is not sent anywhere; the admin's
 *                  tools bar has no Take over
 *   take over      stays the owner's: an admin's ask reaches nothing
 *
 * Nothing is left behind: the match is left, the aeroplane put back, the
 * settings and the profile restored.
 */

export const id = 'admin-trolls';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 6000, step = 25) {
  const t0 = performance.now();
  for (;;) {
    let v = null;
    try {
      v = fn();
    } catch (e) {
      v = null;
    }
    if (v) return v;
    if (performance.now() - t0 > ms) return null;
    await wait(step);
  }
}

export async function check(sim, r, say) {
  say && say('admin trolls: the menu, the trolls, the disasters and teleport for an admin');
  const THREE = await import('../../src/vendor/three.module.js');
  const mpMod = await import('../../src/features/multiplayer.js');
  const P = await import('../../src/features/multiplayer/protocol.js');
  const S = await import('../../src/features/multiplayer/session.js');
  const E = await import('../../src/features/multiplayer/events.js');
  const { Net } = await import('../../src/features/multiplayer/link.js');
  const { Signaling } = await import('../../src/features/multiplayer/signaling.js');
  const { FakeSignalServer } = await import('./multiplayer.fakes.js');
  const T = await import('../../src/features/owner/trolls.js');
  const D = await import('../../src/features/owner/disasters.js');
  const TP = await import('../../src/features/owner/teleport.js');
  const C = await import('../../src/features/owner/common.js');
  const shared = await import('../../src/features/mpplay/shared.js');
  const mp = mpMod.multiplayer;
  const ch = mp.events;
  const TD = T.trollsDebug();
  const DD = D.disastersDebug();
  const TPD = TP.teleportDebug();
  if (typeof RTCPeerConnection !== 'function') {
    r.ok('admin trolls: this browser has WebRTC', false, 'no RTCPeerConnection');
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
  const typeBefore = sim.aircraftType ? sim.aircraftType.id : 'skylark';
  const minimapBefore = sim.minimap ? sim.minimap._want : true;
  const server = new FakeSignalServer();
  const backend = { id: 'fake', url: 'wss://fake.invalid/peerjs', key: 'peerjs', label: 'the test server' };
  const hash = 'b0a7c0ffee78';
  const makeSig = () => new Signaling(backend, { WebSocketImpl: server.WebSocket });
  const cleanups = [];
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
  const frames = async (n, each = null) => {
    for (let i = 0; i < n; i++) {
      if (each) each(i);
      sim.update(1 / 60);
      if (i % 4 === 3) await wait(0);
    }
  };
  const airborne = (x, z, heading = 90, agl = 400) => {
    sim.aircraft.reset({ pos: new THREE.Vector3(x, 0, z), headingDeg: heading, speed: 55, altAGL: agl, engineOn: true, gearDown: false });
    sim.aircraft.controls.throttle = 0.7;
    if (sim.input) {
      sim.input.throttleTarget = 0.7;
      if (sim.input.out) sim.input.out.throttle = 0.7;
    }
  };

  /** A friend in the game: a ClientSession with its own events channel. */
  async function friend(code, i, name, colour) {
    const sig = makeSig();
    await sig.open(P.playerPeerId());
    cleanups.push(() => sig.close());
    const ev = new E.GameEvents();
    for (const [k, def] of ch.kinds) ev.kinds.set(k, def);
    const heard = [];
    const at = { pos: { x: 0, y: 300, z: 0 }, vel: { x: 0, y: 0, z: 0 }, quat: { w: 1 }, onGround: false };
    const c = new S.ClientSession({
      net: new Net(sig), target: P.codeId(code), profile: { name, colour, key: `adminkey${i}abcdefghijk`.slice(0, 20) },
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
      c.tick(t, P.encodeState({ id: w.you, seq: seq++, t, pos: at.pos, quat: at.quat, vel: at.vel, game: 'flight', type: 'skylark', pvp: false, ghost: false, onGround: at.onGround, engineOn: true }));
    }, 1000 / 15);
    cleanups.push(() => clearInterval(tm));
    return { c, ev, heard, at, id: w.you, name, of: (k) => heard.filter((h) => h.kind === k), stop: () => { clearInterval(tm); c.leave(); } };
  }

  try {
    mp.configure({ backend, hash, WebSocketImpl: server.WebSocket });
    mp.setProfile({ name: 'Swift Falcon', colour: P.COLOURS[0], chosen: true });
    mp.setPvp(false);
    mp.profile.ride = { game: 'flight', type: 'skylark' };
    mpMod.openLobbies(sim);
    const le = document.querySelector('[data-screen="lobbies"]');
    le.querySelector('[data-mp-private]').click();
    const up = await until(() => mp.role === 'host' && mp.ready && sim.state === 'flying', 20000);
    const code = mp.server && mp.server.code;
    r.ok('admin trolls: this tab hosts a private match', !!up && !!code, `${sim.settings.map} ${code}`);
    const A = await friend(code, 1, 'Brave Otter', P.COLOURS[3]); // plain
    const B = await friend(code, 2, 'Calm Heron', P.COLOURS[2]); // the owner
    const Cc = await friend(code, 3, 'Quick Newt', P.COLOURS[4]); // a second admin
    await until(() => mp.remotes.players.size === 3, 8000);
    airborne(0, 0);
    const me = () => sim.aircraft.pos;
    const near = () => {
      for (const [i, f] of [A, B, Cc].entries()) {
        f.at.pos = { x: me().x + 120 + i * 40, y: me().y, z: me().z };
        f.at.vel = { x: sim.aircraft.vel.x, y: 0, z: sim.aircraft.vel.z };
      }
    };
    await frames(20, near);

    /* ---- the roles, by the host's own record --------------------------------------------------- */
    const listOf = () => {
      mp.hud.hold(true);
      mp.syncRoster();
      const box = document.querySelector('[data-mp-list]');
      const rows = [...box.querySelectorAll('.mp-prow')].map((row) => ({
        id: Number((row.querySelector('[data-mp-ping]') || { dataset: {} }).dataset.mpPing), text: row.textContent.replace(/\s+/g, ' ').trim(), troll: !!row.querySelector('[data-mp-own-open]'),
      }));
      return { box, rows };
    };
    const noRole = listOf();
    // What tryCode does for a host with an admin key, and what the door check records for a pass / a key.
    mp.host.me.admin = true;
    mp.host._rosterDirty = true;
    mp.host.players.get(B.id).ownerUntil = Date.now() + 3600e3;
    mp.host.players.get(Cc.id).admin = true;
    mp.host._rosterDirty = true;
    mp.syncSelf();
    await wait(50);
    const withRoles = listOf();
    const rowFor = (id) => withRoles.rows.find((x) => x.id === id) || { missing: true };
    r.ok('admin trolls: before any role nobody has a Troll button; this admin gets 🃏 Troll on the plain friend’s row only — not on the owner’s, not on the other admin’s, not on its own',
      !noRole.rows.some((x) => x.troll) && mp.me.admin && !mp.me.owner && withRoles.rows.length === 4 && rowFor(A.id).troll === true && rowFor(B.id).troll === false && rowFor(Cc.id).troll === false && rowFor(mp.meId).troll === false,
      withRoles.rows.map((x) => `${x.text}${x.troll ? ' [🃏]' : ''}`).join(' | '));
    const click = (sel) => {
      const el = document.querySelector(`[data-mp-list] ${sel}`);
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    };
    click(`[data-mp-own-open="${A.id}"]`);
    const row = document.querySelector(`[data-mp-list] [data-mp-ownrow="${A.id}"]`);
    const trollBtns = row ? [...row.querySelectorAll('[data-mp-own^="troll:"]')] : [];
    r.ok('admin trolls: the Troll button opens the gold row with the thirteen trolls, Teleport them and the Disasters tab',
      !!row && trollBtns.length === T.TROLLS.length && !!row.querySelector('[data-mp-own^="tp:"]') && !!row.querySelector('[data-mp-own^="tab:dis:"]'), row ? row.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) : 'no row');

    /* ---- trolls out ------------------------------------------------------------------------------ */
    const kPink = T.trollIndex('pink');
    click(`[data-mp-own="troll:${kPink}:${A.id}"]`);
    const arrived = await until(() => A.of('owner:trolled').find((h) => h.data.k === kPink && h.data.t === A.id), 4000);
    r.ok('admin trolls: a click on “Pink paint” reaches the plain friend through the host, stamped with this admin',
      !!arrived && arrived.data.by === mp.meId && B.of('owner:trolled').some((h) => h.data.k === kPink), JSON.stringify(arrived && arrived.data));
    // The owner and the other admin cannot be trolled from here, even with the request made by hand.
    const before = TD.stats.sent;
    await wait(6200); // the cooldown on the friend is its own; the owner's is untouched
    ch.toHost('owner:troll', { k: T.trollIndex('ducks'), t: B.id });
    ch.toHost('owner:troll', { k: T.trollIndex('ducks'), t: Cc.id });
    await wait(300);
    r.ok('admin trolls: the host refuses this admin’s troll on the OWNER and on the other admin, even asked by hand — nobody hears it',
      TD.stats.sent === before && ![A, B, Cc].some((f) => f.of('owner:trolled').some((h) => h.data.t === B.id || h.data.t === Cc.id)), JSON.stringify(TD.stats));

    /* ---- trolls in ------------------------------------------------------------------------------- */
    const kMoon = T.trollIndex('moon');
    B.ev.toHost('owner:troll', { k: kMoon, t: mp.meId });
    const landed = await until(() => TD.mine().includes('moon'), 4000);
    const tag = C.tagText();
    r.ok('admin trolls: the OWNER trolls this admin (the host allows it): Moon gravity lands here and the tag says the owner', !!landed && /trolled by the owner — Moon gravity/.test(tag), tag);
    const eff = TD.A.mine.get('moon');
    if (eff) eff.until = performance.now() - 1;
    await frames(2);
    r.ok('admin trolls: …and it wears off by itself and the tag goes with it', !TD.mine().includes('moon') && C.tagText() === '', C.tagText());
    const sentNow = TD.stats.sent;
    await wait(6200);
    Cc.ev.toHost('owner:troll', { k: kMoon, t: mp.meId });
    A.ev.toHost('owner:troll', { k: kMoon, t: mp.meId });
    await wait(400);
    r.ok('admin trolls: the other admin’s troll on this admin, and a plain friend’s, are refused by the host — nothing lands', TD.stats.sent === sentNow && !TD.mine().includes('moon'), JSON.stringify(TD.stats));

    /* ---- disasters ------------------------------------------------------------------------------- */
    await wait(1100);
    const sentDis = DD.stats.started;
    ch.toHost('owner:dis', { id: 'tornado', t: B.id, s: 30 });
    await wait(300);
    r.ok('admin trolls: a disaster sent after the OWNER never starts', DD.stats.started === sentDis && !DD.desk.onTarget(B.id), JSON.stringify(DD.stats));
    await wait(600);
    ch.toHost('owner:dis', { id: 'tornado', t: A.id, s: 30 });
    const gotGo = await until(() => A.of('owner:disgo').find((h) => h.data.t === A.id && h.data.id === 'tornado'), 4000);
    r.ok('admin trolls: a tornado sent after the plain friend starts for everybody, saying this admin sent it, and runs on this screen',
      !!gotGo && gotGo.data.by === mp.meId && B.of('owner:disgo').length >= 1 && DD.active().some((i) => i.id === 'tornado' && i.t === A.id), JSON.stringify(gotGo && gotGo.data));
    // The owner's disaster on the same friend cannot be replaced by this admin, nor stopped.
    await wait(1100);
    B.ev.toHost('owner:dis', { id: 'lightning', t: A.id, s: 60 });
    await until(() => DD.desk.onTarget(A.id) && DD.desk.onTarget(A.id).by === B.id, 3000);
    const ownersN = DD.desk.onTarget(A.id) && DD.desk.onTarget(A.id).n;
    await wait(1100);
    ch.toHost('owner:dis', { id: 'tornado', t: A.id, s: 30 });
    await wait(300);
    ch.toHost('owner:disstop', { n: ownersN });
    await wait(300);
    r.ok('admin trolls: the owner replaced this admin’s disaster on the friend; this admin cannot replace it back or stop it',
      !!ownersN && DD.desk.onTarget(A.id) && DD.desk.onTarget(A.id).n === ownersN && DD.desk.onTarget(A.id).id === 'lightning', JSON.stringify([...DD.desk.running.values()].map((x) => `${x.id}>${x.t} by ${x.by}`)));
    await wait(1100);
    B.ev.toHost('owner:disstop', { n: 0 });
    await wait(400);
    r.ok('admin trolls: the owner’s STOP ALL puts it out for everybody', !DD.desk.running.size && !DD.active().length, JSON.stringify(DD.active()));

    /* ---- teleport -------------------------------------------------------------------------------- */
    await wait(1100);
    TPD.sync();
    const tools = TPD.tools();
    const takeBtn = tools && tools.querySelector('[data-owner-take-list]');
    r.ok('admin trolls: in the match an admin’s tools bar is up — tap the map to teleport — and it has no Take over', !!tools && !tools.hidden && !!takeBtn && takeBtn.hidden && /tap the map/.test(tools.textContent), tools ? tools.textContent.replace(/\s+/g, ' ') : 'no bar');
    TPD.arm(A.id, 'Brave Otter');
    const rect = sim.minimap && sim.minimap.canvas ? sim.minimap.canvas.getBoundingClientRect() : null;
    TPD.tapped({ x: sim.aircraft.pos.x + 1500, z: sim.aircraft.pos.z, craft: null, rect });
    TPD.setFt(12000);
    const takeInPicker = TPD.picker() && TPD.picker().querySelector('[data-tp-take]');
    TPD.go();
    const gotTp = await until(() => A.of('owner:tpgo').find((h) => h.data.t === A.id), 4000);
    r.ok('admin trolls: “Teleport them” + a tap on the map + 12,000 ft sends the plain friend there through the host, stamped with this admin',
      !!gotTp && gotTp.data.by === mp.meId && Math.abs(gotTp.data.y - 12000 * 0.3048) < 40 && (!takeInPicker || takeInPicker.hidden), JSON.stringify(gotTp && gotTp.data));
    await wait(1100);
    ch.toHost('owner:tp', { t: B.id, x: 10, y: 400, z: 10 });
    ch.toHost('owner:tp', { t: Cc.id, x: 10, y: 400, z: 10 });
    await wait(300);
    r.ok('admin trolls: a teleport of the owner, or of the other admin, is refused by the host — nobody is sent anywhere', ![A, B, Cc].some((f) => f.of('owner:tpgo').some((h) => h.data.t === B.id || h.data.t === Cc.id)));
    const asked = TPD.stats.takeAsked;
    ch.toHost('owner:take', { id: 1 });
    await wait(300);
    r.ok('admin trolls: taking an aircraft over stays the owner’s — this admin’s ask reaches nothing', TPD.stats.takeAsked === asked);
    A.stop();
    B.stop();
    Cc.stop();
    await wait(400);
    r.ok('admin trolls: the friends leave and nothing of theirs is left running on this screen', !DD.active().length && !TD.theirs()[A.id]);
  } catch (err) {
    r.ok('admin trolls: the checks ran to the end', false, String(err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : err));
  } finally {
    for (const fn of cleanups.reverse()) {
      try {
        fn();
      } catch (e) {
        /* already gone */
      }
    }
    try {
      TD.endAll();
      DD.endAll();
      TPD.closePicker();
      TPD.arm(null);
      TPD.sync();
      if (sim.renderer && sim.renderer.domElement) sim.renderer.domElement.style.transform = '';
      shared.feedLines();
    } catch (e) {
      /* over */
    }
    if (mp.role || mp.lobby) mp.leave('menu');
    mp.stopLooking();
    mp.stopWatchingLobbies();
    mp.configure(null);
    mp.profile = profileBefore;
    try {
      if (savedProfile === null) localStorage.removeItem('islandsim.multiplayer.v1');
      else localStorage.setItem('islandsim.multiplayer.v1', savedProfile);
    } catch (e) {
      /* storage is not ours to fix */
    }
    if (sim.meteors && sim.meteors.active) sim.meteors.end();
    if (sim.tornado && sim.tornado.active) sim.tornado.clear();
    if (sim.minimap) sim.minimap.toggle(minimapBefore);
    if (sim.state !== 'menu' && typeof sim.quitToMenu === 'function') sim.quitToMenu();
    if (sim.aircraftType && sim.aircraftType.id !== typeBefore) {
      sim.setAircraft(typeBefore);
      sim.settings.aircraft = typeBefore;
    }
    if (sim.menus) {
      if (wasScreen && !['multiplayer', 'lobbies'].includes(wasScreen)) sim.menus.show(wasScreen);
      else if (!wasScreen) sim.menus.hide();
      else sim.menus.show('main');
    }
    await wait(300);
  }
}
