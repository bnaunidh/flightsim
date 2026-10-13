/**
 * The owner's toys, in one tab — run by tests/selftest.js through
 * tests/features/index.js (CHECKS), or by hand:
 *
 *   const { check } = await import('/tests/features/owner-trolls.browser.js');
 *   const r = { checks: [], ok(n, p, d) { this.checks.push({ n, p, d }); return p; } };
 *   await check(window.__sim, r, console.log);
 *
 * THIS TAB HOSTS a private match and one friend joins it by the code (a
 * ClientSession in this same tab over real WebRTC, with a GameEvents of its
 * own, as multiplayer-part2.browser.js does). This tab is made the owner the
 * way a host is: its own session's word (HostSession.setOwner — the host
 * takes its own, checked, pass). Then, through the game's real code paths:
 *
 *   the menu       the 🃏 Troll button beside Admin on the friend's row and not
 *                  on this player's; the gold row of thirteen trolls, Teleport
 *                  them, the Disasters tab with every disaster, the durations,
 *                  GO and STOP NOW; a click on a troll reaches the friend
 *   every troll    arriving on THIS player: each shows (the roll, the yeet's
 *                  jump, tiny/giant on the model's scale, Harrison standing
 *                  in, the picture upside down, the WASTED screen and its
 *                  "jk", the pink paint, the ducks falling, moon gravity,
 *                  Bring here, Go there, frozen controls), the tag says who,
 *                  and each wears off and puts things back
 *   on a friend    the trolls that can be seen on them are drawn on their model
 *   disasters      a tornado sent after the friend chases where the friend is
 *                  and the host says where it is; lightning strikes beside
 *                  them and this player, standing close, is struck too; a
 *                  meteor is aimed; a fire is lit under them; STOP NOW puts
 *                  the fire out; one ends on time for everybody
 *   teleport       a real tap on the minimap opens the picker at the place it
 *                  shows; 10,000 ft and 50,000 ft arrive flying at a sane speed
 *                  and stay flying; Ground stands it on its wheels; "Teleport
 *                  them" goes through the host to the friend
 *   take over      a traffic aeroplane spawned nearby is taken over in the air
 *                  (its type, its place, out of the traffic); after a crash the
 *                  flight starts afresh in the other aeroplane
 *
 * Nothing is left behind: the match is left, the aeroplane put back, the
 * settings and the profile restored.
 */

export const id = 'owner-trolls';

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
  say && say('owner trolls: the menu, the trolls, the disasters, teleport and take over');
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
  const PL = await import('../../src/features/owner/place.js');
  const C = await import('../../src/features/owner/common.js');
  const FX = await import('../../src/features/owner/fx.js');
  const { wasted } = await import('../../src/features/wasted.js');
  const shared = await import('../../src/features/mpplay/shared.js');
  const { extStatus } = await import('../../src/game/extensions.js');
  const { heightAt } = await import('../../src/world/terrain.js');
  const { spawnTraffic, clearTraffic } = await import('../../src/features/traffic.js');
  const { fireStatus } = await import('../../src/features/wildfire.js');
  const mp = mpMod.multiplayer;
  const ch = mp.events;
  const TD = T.trollsDebug();
  const DD = D.disastersDebug();
  const TPD = TP.teleportDebug();
  if (typeof RTCPeerConnection !== 'function') {
    r.ok('owner trolls: this browser has WebRTC', false, 'no RTCPeerConnection');
    return;
  }
  const live = extStatus().filter((e) => ['owner-trolls', 'owner-disasters', 'owner-teleport', 'owner'].includes(e.id));
  r.ok('owner trolls: the three toys are plugged in and running, beside the owner’s hour', live.length === 4 && live.every((e) => e.live) && mp.ownerMenu === T.ownerMenu, live.map((e) => `${e.id}:${e.live}`).join(' '));

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
  const hash = 'b0a7c0ffee77';
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
  const ac = () => sim.aircraft;
  const airborne = (x, z, heading = 90, agl = 400) => {
    sim.aircraft.reset({ pos: new THREE.Vector3(x, 0, z), headingDeg: heading, speed: 55, altAGL: agl, engineOn: true, gearDown: false });
    sim.aircraft.controls.throttle = 0.7;
    if (sim.input) {
      sim.input.throttleTarget = 0.7;
      if (sim.input.out) sim.input.out.throttle = 0.7;
    }
  };
  const upY = () => new THREE.Vector3(0, 1, 0).applyQuaternion(sim.aircraft.quat).y;

  /** A friend in the game: a ClientSession with its own events channel, flying where it is told. */
  async function friend(code, i, name, colour) {
    const sig = makeSig();
    await sig.open(P.playerPeerId());
    cleanups.push(() => sig.close());
    const ev = new E.GameEvents();
    for (const [k, def] of ch.kinds) ev.kinds.set(k, def);
    const heard = [];
    const at = { pos: { x: 0, y: 300, z: 0 }, vel: { x: 0, y: 0, z: 0 }, quat: { w: 1 }, onGround: false };
    const c = new S.ClientSession({
      net: new Net(sig), target: P.codeId(code), profile: { name, colour, key: `ownerkey${i}abcdefghijk`.slice(0, 20) },
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
    r.ok('owner trolls: this tab hosts a private match', !!up && !!code, `${sim.settings.map} ${code}`);
    const A = await friend(code, 1, 'Brave Otter', P.COLOURS[3]);
    await until(() => mp.remotes.players.size === 1, 5000);
    airborne(0, 0);
    const me = () => sim.aircraft.pos;
    const near = () => {
      A.at.pos = { x: me().x + 120, y: me().y, z: me().z };
      A.at.vel = { x: sim.aircraft.vel.x, y: 0, z: sim.aircraft.vel.z };
    };
    await frames(20, near);

    /* ---- the owner, by the host's own word; the menu ------------------------------------------- */
    const listOf = () => {
      mp.hud.hold(true);
      mp.syncRoster();
      const box = document.querySelector('[data-mp-list]');
      const rows = [...box.querySelectorAll('.mp-prow')].map((row) => ({ text: row.textContent.replace(/\s+/g, ' ').trim(), troll: !!row.querySelector('[data-mp-own-open]') }));
      return { box, rows };
    };
    const noOwner = listOf();
    mp.host.setOwner(Date.now() + 3600e3);
    mp.syncSelf();
    const withOwner = listOf();
    r.ok('owner trolls: before the host checks a pass nobody has a Troll button; the owner (the host’s own check) gets 🃏 Troll on the friend’s row and not on their own',
      !noOwner.rows.some((x) => x.troll) && mp.me.owner && withOwner.rows.length === 2 && withOwner.rows.find((x) => /Brave Otter/.test(x.text)).troll && !withOwner.rows.find((x) => /Swift Falcon/.test(x.text)).troll,
      withOwner.rows.map((x) => `${x.text}${x.troll ? ' [🃏]' : ''}`).join(' | '));
    const click = (sel) => {
      const el = document.querySelector(`[data-mp-list] ${sel}`);
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    };
    click(`[data-mp-own-open="${A.id}"]`);
    const row = document.querySelector(`[data-mp-list] [data-mp-ownrow="${A.id}"]`);
    const trollBtns = row ? [...row.querySelectorAll('[data-mp-own^="troll:"]')] : [];
    r.ok('owner trolls: the Troll button opens a gold row with the thirteen trolls, Teleport them and the Disasters tab',
      !!row && trollBtns.length === T.TROLLS.length && T.TROLLS.every((t) => trollBtns.some((b) => b.textContent.includes(t.name))) && !!row.querySelector('[data-mp-own^="tp:"]') && !!row.querySelector('[data-mp-own^="tab:dis:"]'),
      row ? row.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) : 'no row');
    const kDucks = T.trollIndex('ducks');
    click(`[data-mp-own="troll:${kDucks}:${A.id}"]`);
    const arrived = await until(() => A.of('owner:trolled').find((h) => h.data.k === kDucks && h.data.t === A.id), 4000);
    await frames(30, near);
    const theirs = TD.theirs();
    const showers = TD.showers();
    r.ok('owner trolls: a click on “Duck rain” reaches the friend through the host (stamped with the owner), and the ducks fall round them on this screen',
      !!arrived && arrived.data.by === mp.meId && theirs[A.id] && theirs[A.id].includes('ducks') && showers.some((s) => s.on && s.dropped > 0) && /trolled .*Brave Otter.*Duck rain/.test(shared.feedLines().join(' ')),
      JSON.stringify({ arrived: arrived && arrived.data, theirs, showers }));
    click(`[data-mp-own="troll:${T.trollIndex('pink')}:${A.id}"]`);
    await wait(150);
    r.ok('owner trolls: a second troll on the same friend straight after is told to wait, and does not arrive',
      /Give them a moment/.test(shared.feedLines().join(' ')) && TD.stats.waits >= 1 && !A.of('owner:trolled').some((h) => h.data.k === T.trollIndex('pink')), `waits ${TD.stats.waits}`);
    // The trolls seen on a friend, drawn on their model (arriving as the host's word, no cooldown).
    const remote = mp.remotes.players.get(A.id);
    const base = remote && remote.model ? remote.model.scale.x : null;
    TD.arrive({ id: 'giant', t: A.id, by: mp.meId });
    await frames(3, near);
    const big = remote && remote.model ? remote.model.scale.x : null;
    TD.A.theirs.get(A.id).get('giant').until = performance.now() - 1;
    await frames(2, near);
    const back = remote && remote.model ? remote.model.scale.x : null;
    TD.arrive({ id: 'pink', t: A.id, by: mp.meId });
    await frames(2, near);
    const pinkOn = remote && remote.model ? FX.pinkCount(remote.model) : 0;
    TD.A.theirs.get(A.id).get('pink').until = performance.now() - 1;
    await frames(2, near);
    const pinkOff = remote && remote.model ? FX.pinkCount(remote.model) : -1;
    TD.arrive({ id: 'harrison', t: A.id, by: mp.meId });
    await frames(3, near);
    const h = TD.A.theirs.get(A.id) && TD.A.theirs.get(A.id).get('harrison');
    const harrisonOn = !!(h && h.h && h.h.visible && remote.model && !remote.model.visible);
    if (h) h.until = performance.now() - 1;
    await frames(2, near);
    const leftOn = TD.theirs()[A.id] || [];
    r.ok('owner trolls: on a friend, Giant is their model at 2.5x, Pink paints every mesh of it, Harrison-ify hides it behind T-Pose Harrison — and each is put back when it wears off (the ducks from the click are still falling)',
      base != null && Math.abs(big - base * T.GIANT) < 1e-6 && Math.abs(back - base) < 1e-6 && pinkOn > 0 && pinkOff === 0 && harrisonOn && h && !h.h.visible && remote.model.visible !== false
      && !leftOn.includes('harrison') && !leftOn.includes('giant') && !leftOn.includes('pink'),
      JSON.stringify({ base, big, back, pinkOn, pinkOff, harrisonOn, leftOn }));

    /* ---- every troll, on this player ------------------------------------------------------------- */
    const mine = () => TD.mine();
    const expire = (idT) => {
      const eff = TD.A.mine.get(idT);
      if (eff) eff.until = performance.now() - 1;
    };
    // Barrel roll: half a roll later the aeroplane is on its back; the roll over, it is the player's again.
    airborne(0, 0);
    await frames(5);
    TD.arrive({ id: 'roll', t: mp.meId, by: A.id });
    const tagRoll = C.tagText();
    await frames(Math.round(T.ROLL_SECS * 60 / 2));
    const inverted = upY();
    await frames(Math.round(T.ROLL_SECS * 60 / 2) + 2);
    const upright = upY();
    expire('roll');
    await frames(1);
    r.ok('owner trolls: Barrel roll — the tag says “trolled by the owner — Barrel roll”; half way the aeroplane is on its back; a roll later it is upright again, and the troll is over',
      /trolled by the owner — Barrel roll/.test(tagRoll) && inverted < -0.5 && upright > 0.5 && !mine().includes('roll'), JSON.stringify({ tagRoll, inverted: inverted.toFixed(2), upright: upright.toFixed(2) }));
    // Yeet: a jump straight up, and only up.
    airborne(0, 0);
    await frames(3);
    const vy0 = ac().vel.y;
    const y0 = ac().pos.y;
    TD.arrive({ id: 'yeet', t: mp.meId, by: A.id });
    const vy1 = ac().vel.y;
    const card = shared.bigCardText();
    await frames(60);
    r.ok('owner trolls: Yeet — 70 m/s straight up (YEET! on the screen), a second later it is higher and not crashed',
      vy1 - vy0 >= T.YEET_MS - 1 && /YEET!/.test(card) && ac().pos.y > y0 + 20 && !ac().crashed, JSON.stringify({ vy0: vy0.toFixed(1), vy1: vy1.toFixed(1), climbed: (ac().pos.y - y0).toFixed(0) }));
    expire('yeet');
    // Tiny / Giant: the model's scale, physics untouched.
    const sx = sim.model.scale.x;
    const speedBefore = ac().airspeed;
    TD.arrive({ id: 'tiny', t: mp.meId, by: A.id });
    await frames(10);
    const tiny = sim.model.scale.x;
    const speedTiny = ac().airspeed;
    expire('tiny');
    await frames(1);
    const tinyBack = sim.model.scale.x;
    TD.arrive({ id: 'giant', t: mp.meId, by: A.id });
    await frames(10);
    const giant = sim.model.scale.x;
    expire('giant');
    await frames(1);
    r.ok('owner trolls: Tiny draws this aeroplane at 0.4x, Giant at 2.5x — the airspeed does not change — and the scale comes back after',
      Math.abs(tiny - sx * T.TINY) < 1e-6 && Math.abs(giant - sx * T.GIANT) < 1e-6 && Math.abs(tinyBack - sx) < 1e-6 && Math.abs(sim.model.scale.x - sx) < 1e-6 && Math.abs(speedTiny - speedBefore) < 6,
      JSON.stringify({ sx, tiny, giant, speedBefore: speedBefore.toFixed(1), speedTiny: speedTiny.toFixed(1) }));
    // Harrison-ify: T-Pose Harrison where the aeroplane is, the aeroplane hidden; back after.
    TD.arrive({ id: 'harrison', t: mp.meId, by: A.id });
    await frames(3);
    const hm = TD.A.mine.get('harrison');
    const harr = !!(hm && hm.h && hm.h.visible && hm.h.parent && !sim.model.visible && hm.h.position.distanceTo(ac().pos) < 15);
    expire('harrison');
    await frames(1);
    r.ok('owner trolls: Harrison-ify — T-Pose Harrison flies where this aeroplane is and the aeroplane is hidden; it is drawn again after', harr && sim.model.visible && hm && !hm.h.visible, JSON.stringify({ harr, visible: sim.model.visible }));
    // Upside-down: the picture, not the HUD.
    TD.arrive({ id: 'flip', t: mp.meId, by: A.id });
    const canvas = sim.renderer.domElement;
    const flipped = canvas.style.transform;
    expire('flip');
    await frames(1);
    r.ok('owner trolls: Upside-down camera — the game’s picture is turned 180° (the HUD stays upright) and turns back after', /rotate\(180deg\)/.test(flipped) && canvas.style.transform === '', `${flipped} → ${JSON.stringify(canvas.style.transform)}`);
    // Fake WASTED: the real screen, then jk.
    const wastedBefore = wasted.count;
    TD.arrive({ id: 'wasted', t: mp.meId, by: A.id });
    await frames(50);
    const root = document.querySelector('.ws-root');
    const word = root && root.classList.contains('is-on') && root.classList.contains('is-word');
    const jk = root ? root.querySelector('.ws-word span').textContent : '';
    await frames(200);
    r.ok('owner trolls: Fake WASTED — the real WASTED screen comes up with “jk 😂” under it, and is gone four seconds later; nobody crashed',
      wasted.count === wastedBefore + 1 && word && /jk 😂/.test(jk) && !wasted.active && !ac().crashed, JSON.stringify({ word, jk }));
    expire('wasted');
    // Pink paint.
    TD.arrive({ id: 'pink', t: mp.meId, by: A.id });
    await frames(2);
    const pinkMe = FX.pinkCount(sim.model);
    expire('pink');
    await frames(1);
    r.ok('owner trolls: Pink paint — every mesh of this aeroplane is hot pink, and the paint comes off after', pinkMe > 0 && FX.pinkCount(sim.model) === 0, `${pinkMe} meshes`);
    // Duck rain on me.
    TD.arrive({ id: 'ducks', t: mp.meId, by: A.id });
    await frames(60);
    const shMe = TD.A.mine.get('ducks') && TD.A.mine.get('ducks').shower;
    const ducksOn = !!(shMe && shMe.on && shMe.dropped >= 4 && shMe.ducks.some((d) => d.live));
    // The newest duck is the one just let go over the aeroplane (the older ones are behind it: it flies at 55 m/s).
    const live = shMe ? shMe.ducks.filter((d) => d.live) : [];
    const nearMe = live.length ? Math.min(...live.map((d) => Math.hypot(d.pos.x - ac().pos.x, d.pos.z - ac().pos.z))) : 1e9;
    const above = live.length ? Math.max(...live.map((d) => d.pos.y - ac().pos.y)) : -1;
    expire('ducks');
    await frames(1);
    const stopped = !!(shMe && !shMe.on);
    await frames(60 * (FX.DUCK_LIFE_S + 1));
    r.ok('owner trolls: Duck rain — six rubber ducks a second are let go over this aeroplane (within 40 m, from above); when it is over no more fall, and the last ones are gone six seconds later',
      ducksOn && nearMe < 45 && above > 20 && stopped && shMe.idle, JSON.stringify({ ducksOn, nearMe: nearMe.toFixed(0), above: above.toFixed(0), stopped, idle: shMe && shMe.idle, dropped: shMe && shMe.dropped }));
    // Moon gravity: against the same half second without it.
    airborne(0, 0);
    await frames(5);
    const a0 = ac().vel.y;
    await frames(30);
    const dNormal = ac().vel.y - a0;
    airborne(0, 0);
    await frames(5);
    TD.arrive({ id: 'moon', t: mp.meId, by: A.id });
    const b0 = ac().vel.y;
    await frames(30);
    const dMoon = ac().vel.y - b0;
    expire('moon');
    await frames(1);
    // Five sixths of gravity is taken off (4 m/s over the half second); the wing gives some of it back as the airflow changes — what is left is a clear float.
    r.ok('owner trolls: Moon gravity — over the same half second the aeroplane floats up with a climb it did not have (five sixths of gravity taken away, the wing answering)',
      dMoon - dNormal > 1.0 && dMoon - dNormal < 6, JSON.stringify({ dNormal: dNormal.toFixed(2), dMoon: dMoon.toFixed(2) }));
    // Bring here: beside the owner (the friend plays the owner here).
    airborne(0, 0);
    A.at.pos = { x: 3000, y: 900, z: -2000 };
    A.at.vel = { x: 60, y: 0, z: 0 };
    // Where this copy draws the friend eases to where they say they are (remotes.js): wait for it, as a real jump would have been smoothed.
    const drawnNear = (p) => until(() => { sim.update(1 / 60); const q = mp.remotes.players.get(A.id); return q && q.drawn && Math.hypot(q.drawn.x - p.x, q.drawn.y - p.y, q.drawn.z - p.z) < 30; }, 8000, 30);
    await drawnNear(A.at.pos);
    TD.arrive({ id: 'bring', t: mp.meId, by: A.id });
    const dBring = Math.hypot(ac().pos.x - 3000, ac().pos.z + 2000);
    const altBring = ac().pos.y;
    r.ok('owner trolls: Bring here — this aeroplane is put beside the owner, 70 m or so off, at their height, flying', dBring > 50 && dBring < 110 && Math.abs(altBring - 900) < 35 && ac().airspeed > 50 && !ac().onGround, JSON.stringify({ dBring: dBring.toFixed(0), altBring: altBring.toFixed(0) }));
    expire('bring');
    // Go there: the owner (this player) goes to the friend.
    airborne(0, 0);
    A.at.pos = { x: -2500, y: 700, z: 2500 };
    await drawnNear(A.at.pos);
    TD.arrive({ id: 'go', t: A.id, by: mp.meId });
    const dGo = Math.hypot(ac().pos.x + 2500, ac().pos.z - 2500);
    r.ok('owner trolls: Go there — the owner is put beside the friend, at their height', dGo > 50 && dGo < 110 && Math.abs(ac().pos.y - 700) < 35, `${dGo.toFixed(0)} m, ${ac().pos.y.toFixed(0)} m up`);
    // Freeze controls: the stick does nothing for three seconds.
    airborne(0, 0);
    await frames(3);
    const inp = sim.input;
    // S is pitch up (flight/input.js ACTIONS); the stick ramps, so a third of a second of it.
    const press = (on) => window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code: 'KeyS', key: 's', bubbles: true }));
    press(true);
    await frames(20);
    const freePitch = ac().controls.pitch;
    TD.arrive({ id: 'freeze', t: mp.meId, by: A.id });
    await frames(6);
    const frozenPitch = ac().controls.pitch;
    const frozenFlag = TD.frozen();
    expire('freeze');
    await frames(20);
    const thawedPitch = ac().controls.pitch;
    press(false);
    await frames(2);
    r.ok('owner trolls: Freeze controls — a held pitch key moves the elevator; frozen, the same key does nothing; three seconds later it works again',
      Math.abs(freePitch) > 0.1 && frozenPitch === 0 && frozenFlag && Math.abs(thawedPitch) > 0.1 && !TD.frozen() && !!inp._ownerGate, JSON.stringify({ freePitch: freePitch.toFixed(2), frozenPitch, thawedPitch: thawedPitch.toFixed(2) }));
    // The tag runs on the clock the trolls do (a few seconds after the last one).
    const tagGone = await until(() => { sim.update(1 / 60); return C.tagText() === '' ? 'gone' : null; }, 6000, 50);
    r.ok('owner trolls: with every troll over, the tag goes and nothing is left on this aeroplane', !mine().length && tagGone === 'gone' && sim.model.visible && FX.pinkCount(sim.model) === 0 && canvas.style.transform === '', `${mine().join(',')} tag "${C.tagText()}"`);

    /* ---- disasters ------------------------------------------------------------------------------------ */
    airborne(0, 0);
    A.at.pos = { x: me().x + 2000, y: 500, z: me().z };
    A.at.vel = { x: 40, y: 0, z: 0 };
    await drawnNear(A.at.pos);
    // The disaster tab in the row: every disaster, the durations, GO.
    click(`[data-mp-own-open="${A.id}"]`);
    click(`[data-mp-own-open="${A.id}"]`);
    click(`[data-mp-own="tab:dis:${A.id}"]`);
    const drow = document.querySelector(`[data-mp-list] [data-mp-owndis="${A.id}"]`);
    const picks = drow ? [...drow.querySelectorAll('[data-mp-own^="pick:"]')].map((b) => b.dataset.mpOwn.split(':')[1]) : [];
    const secsBtns = drow ? [...drow.querySelectorAll('[data-mp-own^="secs:"]')].map((b) => Number(b.dataset.mpOwn.split(':')[1])) : [];
    r.ok('owner trolls: the Disasters tab lists every disaster the game has, the durations from 10 s to “until I stop it”, a slider, and GO',
      picks.length === D.trollDisasters().length && picks.includes('tornado') && picks.includes('wildfire') && picks.includes('meteors') && secsBtns.join(',') === D.PRESETS.join(',') && !!drow.querySelector('[data-mp-own-range]') && !!drow.querySelector(`[data-mp-own="dis:${A.id}"]`),
      `${picks.join(' ')} · ${secsBtns.join('/')}`);
    click(`[data-mp-own="pick:tornado:${A.id}"]`);
    click(`[data-mp-own="secs:60:${A.id}"]`);
    click(`[data-mp-own="dis:${A.id}"]`);
    const goT = await until(() => A.of('owner:disgo').find((h) => h.data.id === 'tornado'), 4000);
    await frames(90, () => { A.at.pos = { x: A.at.pos.x + 0.6, y: 500, z: A.at.pos.z }; });
    const tor = sim.tornado;
    const act = DD.active();
    const toA = tor.active ? ((A.at.pos.x - tor.pos.x) * tor.drift.x + (A.at.pos.z - tor.pos.z) * tor.drift.z) : 0;
    const said = A.of('owner:disat').filter((h) => h.data.k === 0);
    const stopRow = !!document.querySelector(`[data-mp-list] [data-mp-own^="stop:"]`);
    r.ok('owner trolls: GO — a tornado for 1 min after the friend: it starts for everybody, touches down near them and CHASES them (its drift points at them); the host tells everybody where its funnel is; the row has STOP NOW and the foot STOP ALL',
      !!goT && goT.data.s === 60 && goT.data.t === A.id && act.length === 1 && act[0].applied && tor.active && toA > 0 && Math.hypot(tor.pos.x - A.at.pos.x, tor.pos.z - A.at.pos.z) < 3000 && said.length >= 1 && stopRow && !!document.querySelector('[data-mp-list] [data-mp-own="stopall"]'),
      JSON.stringify({ go: goT && goT.data, drift: [tor.drift.x.toFixed(1), tor.drift.z.toFixed(1)], toA: toA.toFixed(0), said: said.length, dist: Math.hypot(tor.pos.x - A.at.pos.x, tor.pos.z - A.at.pos.z).toFixed(0) }));
    const n1 = act[0] && act[0].n;
    click(`[data-mp-own="stop:${n1}:${A.id}"]`);
    const ended1 = await until(() => A.of('owner:disend').find((h) => h.data.n === n1), 4000);
    await frames(2);
    r.ok('owner trolls: STOP NOW — the tornado is gone for everybody at once', !!ended1 && !tor.active && DD.active().length === 0 && !sim.activeEvents.tornado, JSON.stringify({ ended: !!ended1, active: tor.active }));
    // Lightning, with this player standing close to the friend: the strikes beside them hit the bystander too.
    airborne(0, 0);
    A.at.pos = { x: me().x + 30, y: me().y, z: me().z };
    A.at.vel = { x: 0, y: 0, z: 0 };
    await frames(5);
    sim.instrumentBlackout = 0;
    await wait(1100);
    D.sendDisaster('lightning', A.id, 30);
    const goL = await until(() => DD.active().find((i) => i.id === 'lightning'), 3000);
    const instL = goL && DD.D.active.get(goL.n);
    if (instL) instL.nextStrike = 0.05;
    await frames(20, () => { A.at.pos = { x: me().x + 30, y: me().y, z: me().z }; });
    const struck = DD.bolts();
    const strikes = A.of('owner:disat').filter((h) => h.data.k === 1);
    const hit = sim.instrumentBlackout > 0;
    const stormy = sim.weather.effectiveCondition === 'stormy';
    D.sendStop(goL ? goL.n : 0);
    await frames(2);
    r.ok('owner trolls: a lightning storm after the friend — stormy overhead for everybody; the host puts a strike beside them (everybody sees the bolt), and this player, 30 m away, is struck too: instruments out',
      !!goL && stormy && struck && struck.struck >= 1 && strikes.length >= 1 && Math.hypot(strikes[0].data.x - A.at.pos.x, strikes[0].data.z - A.at.pos.z) < 100 && hit && DD.stats.hits >= 1,
      JSON.stringify({ stormy, struck, strikes: strikes.length, hit, blackout: sim.instrumentBlackout.toFixed(1) }));
    await until(() => !DD.active().length, 3000);
    // Meteors aimed at the friend.
    await wait(600);
    D.sendDisaster('meteors', A.id, 30);
    const goM = await until(() => DD.active().find((i) => i.id === 'meteors'), 3000);
    const instM = goM && DD.D.active.get(goM.n);
    if (instM) instM.nextMeteor = 0.05;
    await frames(20);
    const rocks = A.of('owner:disat').filter((h) => h.data.k === 2);
    const aimed = rocks[0] && Math.hypot(rocks[0].data.x - A.at.pos.x, rocks[0].data.z - A.at.pos.z) < 120;
    const showerOn = sim.meteors && sim.meteors.active;
    const spawned = DD.stats.meteors;
    D.sendStop(goM ? goM.n : 0);
    await until(() => !DD.active().length, 3000);
    await frames(2);
    r.ok('owner trolls: a meteor shower after the friend — the shower for everybody, and a rock aimed at where the friend is, on every screen; STOP NOW ends the shower',
      !!goM && showerOn && rocks.length >= 1 && aimed && spawned >= 1 && !(sim.meteors && sim.meteors.active), JSON.stringify({ showerOn, rocks: rocks.length, aimed, spawned }));
    // Wildfire under the friend's path (over land), STOP NOW puts it out.
    const land = (await import('../../src/features/mpworld.js')).landNear(600, 500, 4000) || { x: 600, z: 500 };
    airborne(land.x - 400, land.z, 90, 500);
    A.at.pos = { x: land.x, y: heightAt(land.x, land.z) + 300, z: land.z };
    await frames(5);
    await wait(600);
    D.sendDisaster('wildfire', A.id, 60);
    const goW = await until(() => DD.active().find((i) => i.id === 'wildfire'), 3000);
    await frames(20);
    const lit = A.of('owner:disat').filter((h) => h.data.k === 3);
    const burning = fireStatus(sim).burning;
    D.sendStop(goW ? goW.n : 0);
    await until(() => !DD.active().length, 3000);
    await frames(2);
    const out = fireStatus(sim).burning;
    r.ok('owner trolls: a wildfire after the friend — lit on the land under them, on every screen; STOP NOW puts every flame out', !!goW && lit.length >= 1 && burning > 0 && DD.stats.ignites >= 1 && out === 0, JSON.stringify({ lit: lit.length, burning, out }));
    // Ends on time, for everybody.
    await wait(600);
    D.sendDisaster('fogBank', A.id, 10);
    const goF = await until(() => DD.active().find((i) => i.id === 'fogBank'), 3000);
    const foggy = sim.weather.effectiveCondition === 'rainy' && !!sim.activeEvents.fogBank;
    const desk = goF && DD.desk.running.get(goF.n);
    if (desk) desk.until = performance.now() - 1;
    await frames(3);
    const endedF = await until(() => A.of('owner:disend').find((h) => h.data.n === goF.n), 3000);
    r.ok('owner trolls: a fog bank for 10 s — the weather for everybody, for as long as the owner said; on the host’s clock it ends for everybody and the sky clears',
      !!goF && foggy && !!endedF && !DD.active().length && sim.weather.effectiveCondition !== 'rainy' && !sim.activeEvents.fogBank, JSON.stringify({ foggy, ended: !!endedF, cond: sim.weather.effectiveCondition }));
    mp.hud.hold(false);

    /* ---- teleport ------------------------------------------------------------------------------------ */
    airborne(0, 0, 90, 400);
    if (sim.minimap) sim.minimap.toggle(true);
    await frames(8);
    const mm = sim.minimap;
    const rect = mm.canvas.getBoundingClientRect();
    const g = mm._g;
    // A real tap on the map, a quarter of the way right of its middle: a place half a quarter-span east.
    const tapX = rect.left + rect.width * 0.75;
    const tapY = rect.top + rect.height * 0.5;
    const tapsBefore = TPD.stats.taps;
    mm.canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', button: 0, clientX: tapX, clientY: tapY, bubbles: true, cancelable: true }));
    const picker = TPD.picker();
    const wantX = g.craft.x + (mm.span / 2) * 0.5;
    const tap = TPD.T.tap;
    r.ok('owner trolls: in owner mode a tap on the minimap opens the teleport picker at the place the map shows there (a quarter span east), for “me”, with a height slider to 50,000 ft',
      TPD.stats.taps === tapsBefore + 1 && picker && !picker.hidden && tap && Math.abs(tap.x - wantX) < mm.span * 0.01 && Math.abs(tap.z - g.craft.z) < mm.span * 0.01
      && picker.querySelector('[data-tp-who]').textContent === 'me' && Number(picker.querySelector('[data-tp-range]').max) === PL.MAX_ALT_FT,
      JSON.stringify({ tap: tap && { x: tap.x.toFixed(0), z: tap.z.toFixed(0) }, wantX: wantX.toFixed(0), span: mm.span }));
    TPD.setFt(10000);
    const tx = tap.x;
    const tz = tap.z;
    TPD.go();
    await frames(60);
    const alt10 = (sim.aircraft.pos.y - Math.max(0, heightAt(tx, tz))) / 0.3048;
    r.ok('owner trolls: Teleport to 10,000 ft — the aeroplane is there, at that height, flying level at a sane speed a second later; the picker is shut',
      Math.hypot(sim.aircraft.pos.x - tx, sim.aircraft.pos.z - tz) < 150 && Math.abs(alt10 - 10000) < 400 && sim.aircraft.airspeed > 50 && !sim.aircraft.crashed && !sim.aircraft.stalled && picker.hidden,
      JSON.stringify({ alt: alt10.toFixed(0), speed: sim.aircraft.airspeed.toFixed(0) }));
    TPD.tapped({ x: tx + 2000, z: tz, craft: null, rect });
    TPD.setFt(50000);
    const spd0 = PL.saneSpeed(PL.ftToM(50000), 0);
    TPD.go();
    await frames(120);
    const alt50 = sim.aircraft.pos.y / 0.3048;
    sim.renderer.render(sim.scene, sim.camera);
    r.ok('owner trolls: Teleport to 50,000 ft — it arrives at 50,000 ft at 150 m/s and is still flying two seconds later (not stalled, not crashed, the sky and the camera coped)',
      Math.abs(alt50 - 50000) < 600 && sim.aircraft.airspeed > spd0 * 0.6 && !sim.aircraft.crashed && !sim.aircraft.stalled && upY() > 0.8,
      JSON.stringify({ alt: alt50.toFixed(0), speed: sim.aircraft.airspeed.toFixed(0), up: upY().toFixed(2) }));
    // Ground, over the sea: the nearest beach, not a ditching.
    const seaSpot = { x: -9000, z: 9000 };
    const beach = PL.landNearby(seaSpot.x, seaSpot.z);
    TPD.tapped({ x: seaSpot.x, z: seaSpot.z, craft: null, rect });
    TPD.setFt(0);
    TPD.go();
    await frames(30);
    const dBeach = beach ? Math.hypot(sim.aircraft.pos.x - beach.x, sim.aircraft.pos.z - beach.z) : 1e9;
    r.ok('owner trolls: Teleport to the Ground (a tap on the sea) — stood on its wheels on the nearest land, engine running, not crashed',
      heightAt(seaSpot.x, seaSpot.z) < 1.5 && !!beach && sim.aircraft.onGround && !sim.aircraft.crashed && dBeach < 20 && heightAt(sim.aircraft.pos.x, sim.aircraft.pos.z) > 1,
      JSON.stringify({ onGround: sim.aircraft.onGround, crashed: sim.aircraft.crashed, dBeach: dBeach.toFixed(0), sea: heightAt(seaSpot.x, seaSpot.z).toFixed(1) }));
    // Them.
    airborne(0, 0);
    await frames(3);
    TPD.arm(A.id, A.name);
    TPD.tapped({ x: 1500, z: -1500, craft: null, rect });
    const who = TPD.picker().querySelector('[data-tp-who]').textContent;
    TPD.setFt(8000);
    TPD.go();
    const tpgo = await until(() => A.of('owner:tpgo').find((h) => h.data.t === A.id), 4000);
    r.ok('owner trolls: “Teleport them” — the picker is for the friend; Teleport goes through the host to everybody, for the friend’s copy to place them at 8,000 ft',
      who === A.name && !!tpgo && tpgo.data.x === 1500 && tpgo.data.z === -1500 && Math.abs(tpgo.data.y - PL.ftToM(8000)) < 1 && tpgo.data.by === mp.meId && !TPD.armed(), JSON.stringify({ who, tpgo: tpgo && tpgo.data }));

    /* ---- take over ------------------------------------------------------------------------------------ */
    airborne(0, 0, 90, 500);
    await frames(3);
    const sp = spawnTraffic(sim, 'arrive');
    await frames(10);
    TPD.sync();
    const cands = TPD.candidates();
    const tools = TPD.tools();
    // The list has everybody in the sky now (an ambient helicopter may be nearer): the spawned traffic aeroplane is the one this check is about.
    const c = cands.find((x) => x.src === 'traffic') || cands[0];
    r.ok('owner trolls: a traffic aeroplane spawned nearby is in the Take over list (name, type, distance), and the ✈ Take over button by the chip shows the count',
      !!c && c.src === 'traffic' && !!c.type && tools && !tools.hidden && /\(\d+\)/.test(tools.textContent), JSON.stringify({ spawn: sp, cands: cands.map((x) => `${x.name} ${x.type} ${(x.dist / 1000).toFixed(1)}km`) }));
    const before = { type: sim.aircraftType.id, traffic: (sim.traffic || []).length };
    const took = c ? await TPD.takeOver(c) : null;
    await frames(30);
    const gone = !(sim.traffic || []).some((e) => e.id === c.id);
    r.ok('owner trolls: Take over, in the air — this player is in its seat: its type, its place, its heading, flying; the traffic aeroplane is gone (brain off, route forgotten)',
      !!took && !took.restarted && sim.aircraftType.id === c.type && Math.hypot(sim.aircraft.pos.x - c.x, sim.aircraft.pos.z - c.z) < 400 && !sim.aircraft.crashed && sim.state === 'flying' && gone && (sim.traffic || []).length === before.traffic - 1,
      JSON.stringify({ took, type: sim.aircraftType.id, gone }));
    // After a crash: the flight starts afresh in another aeroplane.
    spawnTraffic(sim, 'depart');
    await frames(10);
    const c2 = TPD.candidates()[0];
    sim.aircraft.crashed = true;
    const took2 = c2 ? await TPD.takeOver(c2) : null;
    await frames(20);
    r.ok('owner trolls: Take over after a crash — the flight starts afresh (as Restart does) in the other aeroplane, where it was; not crashed, still in the match',
      !!took2 && took2.restarted && sim.aircraftType.id === c2.type && !sim.aircraft.crashed && sim.state === 'flying' && mp.role === 'host' && mp.ready && Math.hypot(sim.aircraft.pos.x - c2.x, sim.aircraft.pos.z - c2.z) < 400,
      JSON.stringify({ took2, role: mp.role }));
    A.stop();
    await wait(300);
    r.ok('owner trolls: the friend leaves and nothing of theirs is left on this screen', !TD.theirs()[A.id] && !DD.active().length);
  } catch (err) {
    r.ok('owner trolls: the checks ran to the end', false, String(err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : err));
  } finally {
    for (const fn of cleanups.reverse()) {
      try {
        fn();
      } catch (e) {
        /* already gone */
      }
    }
    try {
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowUp', key: 'ArrowUp', bubbles: true }));
    } catch (e) {
      /* no keyboard */
    }
    try {
      TD.endAll();
      DD.endAll();
      TPD.closePicker();
      TPD.arm(null);
      clearTraffic(sim);
      if (sim.renderer && sim.renderer.domElement) sim.renderer.domElement.style.transform = '';
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
