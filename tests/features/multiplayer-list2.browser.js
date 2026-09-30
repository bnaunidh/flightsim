/**
 * List 2's multiplayer, part 1, in one tab — run by tests/selftest.js through
 * tests/features/index.js (CHECKS), or by hand:
 *
 *   const { check } = await import('/tests/features/multiplayer-list2.browser.js');
 *   const r = { checks: [], ok(n, p, d) { this.checks.push({ n, p, d }); return p; } };
 *   await check(window.__sim, r, console.log);
 *
 *   less lag      eight players' real data channels, tab to itself: what the host of
 *                 a lobby of eight sends a second relaying each snapshot vs bundled
 *                 (getStats), and how late they land; a friend drawn where they are
 *                 now; the frame cost of seven remote aircraft
 *   nametags      sized by distance, never on top of each other, a dot when there
 *                 is no room, nothing left behind by a leave or a world rebuild
 *   the badge     docked to the minimap, clear of the toasts; joins in one toast
 *   private match made and joined through the lobby screen, on no list, code on the badge
 *   your ride     the same aeroplanes from every game's screen; a plane picked on the
 *                 Boat page is what arrives, and what the others see
 *   events        the game-events channel through the controller, both ways
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
const pct = (a, p) => {
  if (!a.length) return 0;
  const b = a.slice().sort((x, y) => x - y);
  return b[Math.min(b.length - 1, Math.floor(b.length * p))];
};

export async function check(sim, r, say = () => {}) {
  const THREE = await import('../../src/vendor/three.module.js');
  const mpMod = await import('../../src/features/multiplayer.js');
  const P = await import('../../src/features/multiplayer/protocol.js');
  const S = await import('../../src/features/multiplayer/session.js');
  const E = await import('../../src/features/multiplayer/events.js');
  const R = await import('../../src/features/multiplayer/remotes.js');
  const { Net } = await import('../../src/features/multiplayer/link.js');
  const { Signaling } = await import('../../src/features/multiplayer/signaling.js');
  const { FakeSignalServer } = await import('./multiplayer.fakes.js');
  const mp = mpMod.multiplayer;
  if (typeof RTCPeerConnection !== 'function') {
    r.ok('list2 mp: this browser has WebRTC', false, 'no RTCPeerConnection');
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
  const hash = 'b0a7c0ffee12';
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
  const NAMES = ['Swift Falcon', 'Sunny Puffin', 'Jolly Penguin', 'Clever Koala', 'Mighty Moose', 'Gentle Lark', 'Happy Hedgehog'];
  const key = (i) => `list2key${i}abcdefghijk`.slice(0, 20);

  try {
    mp.configure({ backend, hash, WebSocketImpl: server.WebSocket });

    /* ---- less lag: the host of a lobby of eight, real channels -------------- */
    {
      const lsig = makeSig();
      await lsig.open(P.lobbyId(hash, 2));
      const host = new S.HostSession({ mode: 'lobby', profile: { name: 'Brave Otter', colour: P.COLOURS[5], key: 'l2hostkeyl2hostkeyl2' }, server: { map: 'kestrel', game: 'flight', lobby: 2 } });
      host.attach(new Net(lsig));
      cleanups.push(() => { host.close(); lsig.close(); });
      const late = [];
      const heard = [];
      const clients = [];
      for (let i = 0; i < 7; i++) {
        const sig = makeSig();
        await sig.open(P.playerPeerId());
        cleanups.push(() => sig.close());
        const seen = new Set();
        const c = new S.ClientSession({
          net: new Net(sig), target: P.lobbyId(hash, 2), profile: { name: NAMES[i], colour: P.COLOURS[i], key: key(i) },
          onEvent: (t, snap) => {
            if (t !== 'state') return;
            seen.add(snap.id);
            if (heard.measuring) late.push({ ms: performance.now() - snap.t, host: snap.id === 0 });
          },
        });
        await c.start();
        clients.push({ c, seen });
      }
      heard.measuring = false;
      // Everybody sends 15 a second, staggered like eight separate computers; the host's frames at 30 fps.
      const timers = clients.map((x, i) => {
        let tm = null;
        const t0 = setTimeout(() => {
          tm = setInterval(() => { const t = performance.now(); x.c.tick(t, P.encodeState({ t, pos: { x: i * 10, y: 300, z: 0 }, quat: { w: 1 }, vel: { x: 55 }, game: 'flight', type: 'skylark' })); }, 1000 / 15);
        }, i * 9);
        return () => { clearTimeout(t0); clearInterval(tm); };
      });
      let frame = 0;
      const hostTimer = setInterval(() => {
        const t = performance.now();
        host.tick(t, frame++ % 2 ? null : P.encodeState({ t, pos: { x: 0, y: 300, z: 0 }, quat: { w: 1 }, vel: { x: 55 }, game: 'flight', type: 'skylark' }));
      }, 33);
      cleanups.push(() => { timers.forEach((f) => f()); clearInterval(hostTimer); });
      const statsNow = async () => {
        let msgs = 0;
        let pkts = 0;
        let bytes = 0;
        for (const p of host.players.values()) {
          const st = await p.link.pc.getStats();
          st.forEach((s) => {
            if (s.type === 'data-channel' && s.label === 'st') msgs += s.messagesSent || 0;
            if (s.type === 'transport') { pkts += s.packetsSent || 0; bytes += s.bytesSent || 0; }
          });
        }
        return { msgs, pkts, bytes };
      };
      /*
       * Taken turn about, a second at a time — relaying each, bundled, and so
       * on — so that whatever else this machine is doing lands on both.
       * Timers in a busy tab slip too; how far is said alongside.
       */
      const tally = { 0: { msgs: 0, pkts: 0, bytes: 0, secs: 0, late: [], lateHost: [] }, [S.BUNDLE_MS]: { msgs: 0, pkts: 0, bytes: 0, secs: 0, late: [], lateHost: [] } };
      const slips = [];
      const measure = async (bundleMs) => {
        host.bundleMs = bundleMs;
        await wait(300);
        const a = await statsNow();
        late.length = 0;
        heard.measuring = true;
        const t0 = performance.now();
        let tick = t0;
        while (performance.now() - t0 < 1000) {
          await wait(50);
          const n = performance.now();
          slips.push(n - tick - 50);
          tick = n;
        }
        heard.measuring = false;
        const b = await statsNow();
        const T = tally[bundleMs];
        T.secs += (performance.now() - t0) / 1000;
        T.msgs += b.msgs - a.msgs;
        T.pkts += b.pkts - a.pkts;
        T.bytes += b.bytes - a.bytes;
        for (const x of late) (x.host ? T.lateHost : T.late).push(x.ms);
      };
      const result = (T) => ({
        snapsPerSec: Math.round(T.msgs / T.secs), packetsPerSec: Math.round(T.pkts / T.secs), kbPerSec: +(T.bytes / T.secs / 1024).toFixed(1),
        lateMedian: Math.round(pct([...T.late, ...T.lateHost], 0.5)), lateP95: Math.round(pct([...T.late, ...T.lateHost], 0.95)),
        relayedMedian: Math.round(pct(T.late, 0.5)), hostOwnMedian: Math.round(pct(T.lateHost, 0.5)),
      });
      await until(() => clients.every((x) => x.seen.size === 7), 8000);
      for (let k = 0; k < 3; k++) {
        await measure(0);
        await measure(S.BUNDLE_MS);
      }
      const before = result(tally[0]);
      const after = result(tally[S.BUNDLE_MS]);
      say(`timer slip in this tab while measuring: median ${pct(slips, 0.5).toFixed(0)} ms, p95 ${pct(slips, 0.95).toFixed(0)} ms`);
      const allHeard = clients.every((x) => x.seen.size === 7);
      say(`host of eight: relaying each ${JSON.stringify(before)}; bundled ${JSON.stringify(after)}`);
      r.ok('list2 mp: the host of a lobby of eight sends a fraction of the packets it did, and everybody still hears all seven others',
        // Messages, not packets, carry the assertion: on a machine this busy the stack packs several relayed messages into one packet on its own.
        allHeard && after.snapsPerSec < before.snapsPerSec / 3 && after.packetsPerSec < before.packetsPerSec,
        `real data channels, 3 × 1 s each, turn about: relaying each ${before.snapsPerSec} messages/s, ${before.packetsPerSec} packets/s, ${before.kbPerSec} KB/s, landing ${before.lateMedian} ms (p95 ${before.lateP95}) after sending → bundled ${after.snapsPerSec} messages/s, ${after.packetsPerSec} packets/s, ${after.kbPerSec} KB/s, ${after.lateMedian} ms (p95 ${after.lateP95})`);
      r.ok('list2 mp: and a bundle waits well under a tenth of a second at the host', after.relayedMedian < before.relayedMedian + 60, `relayed ${before.relayedMedian} → ${after.relayedMedian} ms median`);
      timers.forEach((f) => f());
      clearInterval(hostTimer);
      for (const x of clients) x.c.leave();
      host.close();
      lsig.close();
      await wait(300);
    }

    /* ---- a friend drawn where they are now; seven of them, and what they cost ---- */
    {
      const rem = mp.remotes;
      const me = sim.aircraft && sim.aircraft.pos ? sim.aircraft.pos.clone() : new THREE.Vector3();
      const base = performance.now();
      // 15 snapshots a second from a friend flying east at 55 m/s beside us, landing 5 to 40 ms after they were sent.
      const at = (t) => ({ x: me.x + 30 + 55 * ((t - base) / 1000), y: me.y + 10, z: me.z + 20 });
      rem.add(6, { name: 'Gentle Lark', colour: P.COLOURS[6] });
      const push = (sent, arrived) => rem.push({ id: 6, t: sent + 5000, pos: at(sent), quat: { x: 0, y: -Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }, vel: { x: 55, y: 0, z: 0 }, game: 'flight', type: 'skylark', onGround: false, gearDown: false, engineOn: true, throttle: 0.6, rpm: 0.8, pitch: 0, roll: 0, yaw: 0, flaps: 0, gearPos: 0 }, arrived);
      const lat = [5, 25, 40, 12, 33, 8];
      const errNow = [];
      for (let t = base, k = 0; t < base + 1500; t += 33, k++) {
        if (k % 2 === 0) push(t - lat[(k / 2) % lat.length], t);
        rem.update(1 / 30, t, sim, true);
        const p = rem.players.get(6);
        if (t > base + 700 && p.drawn) errNow.push(Math.hypot(p.drawn.x - at(t).x, p.drawn.y - at(t).y, p.drawn.z - at(t).z));
      }
      const worst = Math.max(...errNow);
      r.ok('list2 mp: a friend in formation is drawn where they are now, not a tenth of a second back', errNow.length > 10 && worst < 1.5,
        `worst ${worst.toFixed(2)} m over ${errNow.length} frames (drawn 100 ms back, it was ${(55 * 0.1).toFixed(1)} m and more)`);
      rem.remove(6);

      // Seven, ahead of us in a loose bunch. Distances are from this player's own aeroplane (or boat, or van), so the
      // camera is put just behind it for this — in the full self-test it can be anywhere after the checks before this one.
      const own = sim.mode === 'drive' && sim.vehicle ? sim.vehicle.pos : sim.aircraft.pos;
      const camWas = { p: sim.camera.position.clone(), q: sim.camera.quaternion.clone() };
      cleanups.push(() => { sim.camera.position.copy(camWas.p); sim.camera.quaternion.copy(camWas.q); sim.camera.updateMatrixWorld(true); });
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(sim.camera.quaternion).setY(0);
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      sim.camera.position.copy(own).addScaledVector(fwd, -12).add(new THREE.Vector3(0, 3, 0));
      sim.camera.lookAt(own.clone().addScaledVector(fwd, 100));
      sim.camera.updateMatrixWorld(true);
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      const layout = [[40, 8, 3], [60, -10, 5], [80, 12, 6], [300, 0, 20], [700, 40, 40], [1500, -60, 60], [9000, 0, 200]];
      const types = ['skylark', 'courier', 'skylark', 'harrier', 'courier', 'skylark', 'courier'];
      const cam = own.clone();
      for (let i = 0; i < 7; i++) rem.add(10 + i, { name: NAMES[i], colour: P.COLOURS[i] });
      const feed = (t) => {
        for (let i = 0; i < 7; i++) {
          const [f, s, u] = layout[i];
          const p = cam.clone().addScaledVector(fwd, f).addScaledVector(right, s);
          p.y += u - 2;
          rem.push({ id: 10 + i, t, pos: { x: p.x, y: p.y, z: p.z }, quat: { x: 0, y: 0, z: 0, w: 1 }, vel: { x: 0, y: 0, z: 0 }, game: types[i] === 'harrier' ? 'heli' : 'flight', type: types[i], onGround: false, gearDown: false, engineOn: true, throttle: 0.5, rpm: 0.7, pitch: 0, roll: 0, yaw: 0, flaps: 0, gearPos: 0 }, t);
        }
      };
      const t1 = performance.now();
      for (let k = 0; k < 6; k++) feed(t1 + k * 66);
      const costs = [];
      for (let k = 0; k < 40; k++) {
        const t = t1 + 400 + k * 33;
        if (k % 2 === 0) feed(t);
        const a = performance.now();
        rem.update(1 / 30, t, sim, true);
        costs.push(performance.now() - a);
      }
      const shown = [...rem.players.values()].filter((p) => p.id >= 10);
      // What the game's renderer is asked to draw, with the seven and without.
      const draw = window.__realRender || sim.renderer.render.bind(sim.renderer);
      const info = sim.renderer.info;
      const measureDraw = () => { const a = performance.now(); draw(sim.scene, sim.camera); return { ms: performance.now() - a, calls: info.render.calls, tris: info.render.triangles }; };
      measureDraw();
      const withThem = measureDraw();
      for (const p of shown) { if (p.model) p.model.visible = false; if (p.tag) p.tag.sprite.visible = p.tag.pip.visible = false; }
      const without = measureDraw();
      rem.update(1 / 30, t1 + 400 + 41 * 33, sim, true);
      say(`seven remotes: update median ${pct(costs, 0.5).toFixed(2)} ms; +${withThem.calls - without.calls} draw calls, +${withThem.tris - without.tris} triangles`);
      r.ok('list2 mp: seven remote aircraft cost little of a 30 fps Chromebook frame (33 ms)', pct(costs, 0.5) < 3 && shown.every((p) => p.model),
        `multiplayer update median ${pct(costs, 0.5).toFixed(2)} ms, p95 ${pct(costs, 0.95).toFixed(2)} ms; drawing them: +${withThem.calls - without.calls} draw calls, +${withThem.tris - without.tris} triangles (${withThem.ms.toFixed(1)} vs ${without.ms.toFixed(1)} ms here)`);

      // The tags: sized by distance, never overlapping, a dot when there is no room or past 8 km.
      const W = innerWidth;
      const H = innerHeight;
      const P11 = sim.camera.projectionMatrix.elements[5];
      const L = R.TAG_LAYOUT;
      const rects = [];
      for (const p of shown) {
        if (!p.tag || !p.tag.sprite.visible) continue;
        const sp = p.tag.sprite;
        const v = sp.position.clone().project(sim.camera);
        const hPx = (sp.scale.y * P11 / 2) * H;
        const ax = ((v.x + 1) / 2) * W;
        const ay = ((1 - v.y) / 2) * H - (-sp.center.y) * hPx;
        const pillH = (L.PILL_H / L.TAG_H) * hPx;
        const pillW = (p.tag.pillW / L.TAG_W) * hPx * (L.TAG_W / L.TAG_H);
        const bottom = ay - ((L.TAG_H - L.PILL_Y - L.PILL_H) / L.TAG_H) * hPx;
        rects.push({ name: p.name, d: p.dist, pillH, l: ax - pillW / 2, r: ax + pillW / 2, t: bottom - pillH, b: bottom });
      }
      let overlaps = 0;
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if (a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t) overlaps++;
      }
      const near = rects.reduce((m, x) => (x.d < m.d ? x : m), { d: Infinity });
      const far = rects.reduce((m, x) => (x.d > m.d ? x : m), { d: -1 });
      const pips = shown.filter((p) => p.tag && p.tag.pip.visible);
      const past8 = shown.find((p) => p.dist > 8000);
      r.ok('list2 mp: nametags never sit on top of each other; those with no room, and anybody past 8 km, are a dot in their colour',
        rects.length >= 3 && overlaps === 0 && !!past8 && past8.tag.pip.visible && !past8.tag.sprite.visible && shown.every((p) => !(p.tag.sprite.visible && p.tag.pip.visible)),
        `${rects.length} tags, ${pips.length} dots, ${overlaps} overlapping: ${rects.map((x) => `${x.name} ${Math.round(x.d)} m ${x.pillH.toFixed(1)} px`).join(', ')}`);
      r.ok('list2 mp: and a tag is smaller the further away its friend is — about 3 % of the screen close to, 2 % far off',
        near.pillH > far.pillH && near.pillH / H > 0.026 && near.pillH / H < 0.034 && far.d > near.d, `${near.name} ${near.pillH.toFixed(1)} px at ${Math.round(near.d)} m, ${far.name} ${far.pillH.toFixed(1)} px at ${Math.round(far.d)} m, of ${H}`);
      // Nothing left behind: a leave, and a world rebuild.
      const countTags = () => { let n = 0; sim.scene.traverse((o) => { if ((o.name === 'mp-tag' || o.name === 'mp-pip') && o.visible) n++; }); return n; };
      const inScene = () => { let n = 0; sim.scene.traverse((o) => { if (o.name === 'mp-tag') n++; }); return n; };
      rem.remove(10);
      const afterLeave = inScene();
      const group = new THREE.Group();
      sim.scene.add(group);
      rem.setGroup(group);
      feed(t1 + 2000);
      rem.update(1 / 30, t1 + 2000, sim, true);
      const afterRebuild = inScene();
      r.ok('list2 mp: a player who leaves takes their tag with them, and a world rebuild does not double anybody’s',
        afterLeave === 6 && afterRebuild === 6 && countTags() <= 6, `${afterLeave} tags after a leave, ${afterRebuild} after a rebuild (6 players)`);
      for (let i = 0; i < 7; i++) rem.remove(10 + i);
      rem.setGroup(null);
      group.removeFromParent();
      sim.camera.position.copy(camWas.p);
      sim.camera.quaternion.copy(camWas.q);
      sim.camera.updateMatrixWorld(true);
    }

    /* ---- your ride: the same aeroplanes from every game's screen ---- */
    {
      const menus = sim.menus;
      const was = menus && menus.currentGame;
      const seen = {};
      for (const g of ['flight', 'heli', 'boat', 'car']) {
        if (menus) menus.currentGame = g;
        mp.profile.ride = null;
        mpMod.openMultiplayer(sim);
        const le = document.querySelector('[data-screen="lobbies"]');
        const chips = [...le.querySelectorAll('[data-mp-ride]')].map((b) => b.dataset.mpRide);
        const on = le.querySelector('[data-mp-ride].is-on');
        seen[g] = { chips: chips.join(','), on: on && on.dataset.mpRide };
        mp.back();
      }
      const ref = seen.flight.chips;
      r.ok('list2 mp: every game’s Multiplayer screen offers the same rides — the aeroplanes you can fly, the helicopter, the boat and the car',
        ['heli', 'boat', 'car'].every((g) => seen[g].chips === ref) && /flight:skylark/.test(ref) && /heli:harrier/.test(ref) && /boat:boat/.test(ref) && /car:car/.test(ref)
        && seen.heli.on === 'heli:harrier' && seen.boat.on === 'boat:boat' && seen.car.on === 'car:car' && /^flight:/.test(seen.flight.on),
        `${ref} — preselected: ${Object.entries(seen).map(([g, x]) => `${g}→${x.on}`).join(', ')}`);
      // From the Boat page, pick an aeroplane.
      if (menus) menus.currentGame = 'boat';
      mp.profile.ride = null;
      mpMod.openMultiplayer(sim);
      const le = document.querySelector('[data-screen="lobbies"]');
      const plane = le.querySelector('[data-mp-ride="flight:courier"]') || le.querySelector('[data-mp-ride^="flight:"]');
      plane.click();
      const want = plane.dataset.mpRide.split(':')[1];
      const onK = mp.rideOn('kestrel', 'flight');
      const onBoatMap = mp.rideOn('sennen', 'boat');
      const onHeliMap = mp.rideOn('kestrel-port', 'heli');
      r.ok('list2 mp: an aeroplane picked on the Boat page is the ride; an island with no runway gives the nearest thing it has',
        mp.ride().game === 'flight' && mp.ride().type === want && plane.classList.contains('is-on') && !onK.swapped && onK.ride.type === want
        && onBoatMap.swapped && onBoatMap.ride.game === 'boat' && onHeliMap.swapped && onHeliMap.ride.game === 'heli' && /in the /.test(le.textContent),
        `${want}: Kestrel ${onK.ride.game}/${onK.ride.type}, Sennen ${onBoatMap.ride.game}, Kestrel Port ${onHeliMap.ride.game}`);
      // Into a lobby somebody else hosts in a boat: this player arrives in the aeroplane, and the host sees the aeroplane.
      const hsig = makeSig();
      await hsig.open(P.lobbyId(hash, 3));
      const got = [];
      const host = new S.HostSession({
        mode: 'lobby', profile: { name: 'Kind Koala', colour: P.COLOURS[1], key: 'l2boathostkeyl2boath' }, server: { map: 'kestrel', game: 'boat', lobby: 3 },
        spawnInfo: () => ({ x: 0, y: 0, z: 0, heading: 90, speed: 0, agl: 0, onGround: true }), onEvent: (t, a) => { if (t === 'state') got.push(a); },
      });
      host.attach(new Net(hsig));
      cleanups.push(() => { host.close(); hsig.close(); });
      mp.setProfile({ name: 'Brave Otter', chosen: true });
      const ht = setInterval(() => host.tick(performance.now(), P.encodeState({ t: performance.now(), pos: { x: 0, y: 0, z: 0 }, quat: { w: 1 }, vel: {}, game: 'boat', type: 'boat', onGround: true })), 66);
      cleanups.push(() => clearInterval(ht));
      await mp.joinLobby(3);
      const inside = await until(() => mp.ready && mp.lobby && sim.state === 'flying', 20000);
      // The game's frames, for a moment: it sends its snapshots from them.
      for (let i = 0; i < 20; i++) { sim.update(1 / 30); await wait(33); }
      const hostSaw = await until(() => got.find((s) => s.game === 'flight'), 4000);
      const boatDrawn = await until(() => { const p = mp.remotes.players.get(0); return p && p.model && p.model.userData.mpKind === 'boat'; }, 4000);
      r.ok('list2 mp: in a lobby hosted from a boat, this player arrives in the aeroplane they picked — the host sees the aeroplane, and they see the boat',
        !!inside && sim.mode !== 'drive' && sim.aircraftType && sim.aircraftType.id === want && !!hostSaw && hostSaw.type === want && !!boatDrawn,
        `${sim.mode} in ${sim.aircraftType && sim.aircraftType.id}; host saw ${hostSaw ? `${hostSaw.game}/${hostSaw.type}` : 'nothing'}; drew the host as ${boatDrawn ? 'a boat' : 'no boat'}`);
      // The events channel, through the controller: both ways, and host-owned state.
      const hostEv = new E.GameEvents();
      const define = (ev) => ev.define('list2test:ping', { validate: (d) => (d && Number.isInteger(d.n) && d.n >= 0 && d.n < 100 ? { n: d.n } : null) }).define('list2test:score', { from: 'host' });
      define(hostEv);
      define(mp.events);
      host.emit = ((orig) => (t, a, b) => { if (t === 'gev') hostEv.fromWire(a, b); if (t === 'join') hostEv.joined(a); return orig(t, a, b); })(host.emit);
      hostEv.attach(host, 'host', 0);
      const heardByHost = [];
      hostEv.on('list2test:ping', (d, from) => heardByHost.push({ d, name: from.name }));
      const heardHere = [];
      const offPing = mp.events.on('list2test:score', (d, from) => heardHere.push({ d, host: from && from.host }));
      mp.events.send('list2test:ping', { n: 7 });
      hostEv.setState('list2test:score', { n: 3 });
      hostEv.send('list2test:score', { n: 4 });
      await until(() => heardByHost.length && heardHere.length && mp.events.getState('list2test:score'), 4000);
      const players = mp.events.players();
      r.ok('list2 mp: the game-events channel works through the game itself — a player’s event reaches the host, the host’s event and shared state reach the player',
        heardByHost[0] && heardByHost[0].d.n === 7 && heardByHost[0].name === 'Brave Otter' && heardHere[0] && heardHere[0].host === true && heardHere[0].d.n === 4
        && mp.events.getState('list2test:score').n === 3 && mp.events.active && !mp.events.isHost
        && players.some((p) => p.me && p.ride && p.ride.type === want && p.pos) && players.some((p) => p.id === 0 && p.ride && p.ride.game === 'boat'),
        JSON.stringify({ host: heardByHost, here: heardHere, state: mp.events.getState('list2test:score'), players: players.map((p) => `${p.name}:${p.ride && p.ride.type}`) }));
      offPing();
      mp.leave('left');
      r.ok('list2 mp: leaving ends the events session and clears the shared state', !mp.events.active && mp.events.getState('list2test:score') === undefined);
      clearInterval(ht);
      host.close();
      hsig.close();
      if (menus && typeof menus.setGame === 'function') menus.setGame(was || 'flight');
      else if (menus) menus.currentGame = was;
      await wait(200);
    }

    /* ---- a private match, through the lobby screen ---- */
    {
      mp.profile.ride = null;
      if (sim.menus) sim.menus.currentGame = 'flight';
      mpMod.openMultiplayer(sim);
      const le = document.querySelector('[data-screen="lobbies"]');
      const priv = le.querySelector('[data-mp-private]');
      r.ok('list2 mp: the lobby screen has a Private match section in plain view — make one, or join one by code',
        !!priv && !priv.closest('details') && !!le.querySelector('[data-mp-code]') && /Private match/.test(le.textContent));
      /*
       * The owner: "before you make a private game, you can choose the map".
       * A tile for every island that suits the ride — picture, name, one line —
       * starting on the island you're on; the button says where.
       */
      const tiles = () => [...le.querySelectorAll('[data-mp-private-map]')];
      const onTile = () => le.querySelector('[data-mp-private-map].is-on');
      const flightMaps = mp.mapsFor('flight').map((m) => m.id);
      const here = sim.settings.map;
      const drawn = (b) => { const c = b.querySelector('canvas'); if (!c) return false; const d = c.getContext('2d').getImageData(52, 52, 1, 1).data; return d[3] > 0; };
      const t0 = tiles();
      r.ok('list2 mp: making a private match starts with a map picker — every island your ride can use, each with its picture, name and one line, starting on the island you’re on',
        t0.length === flightMaps.length && t0.every((b) => flightMaps.includes(b.dataset.mpPrivateMap) && b.querySelector('strong').textContent && b.querySelector('em').textContent.length > 5 && drawn(b))
        && (!flightMaps.includes(here) || (onTile() && onTile().dataset.mpPrivateMap === here && /you’re here/.test(onTile().textContent)))
        && priv.textContent === `Make it on ${P.mapNameFor(onTile().dataset.mpPrivateMap)}`,
        `${t0.length} tiles for ${flightMaps.length} maps; on ${onTile() && onTile().dataset.mpPrivateMap} (here: ${here}); button “${priv.textContent}”`);
      // The islands follow the ride: the boat's are harbours.
      le.querySelector('[data-mp-ride="boat:boat"]').click();
      const boatMaps = mp.mapsFor('boat').map((m) => m.id);
      const boatTiles = tiles().map((b) => b.dataset.mpPrivateMap);
      r.ok('list2 mp: and the islands on offer follow your ride — pick the boat and it is the islands with water to sail',
        boatTiles.join() === boatMaps.join() && boatTiles.includes('sennen') && !boatTiles.includes('drovers'), `${boatTiles.length} for the boat`);
      le.querySelector('[data-mp-ride^="flight:"]').click();
      le.querySelector('[data-mp-private-map="meadow"]').click();
      r.ok('list2 mp: tapping an island picks it, and the button says so', onTile().dataset.mpPrivateMap === 'meadow' && priv.textContent === 'Make it on Harrier Flats', priv.textContent);
      priv.click();
      const up = await until(() => mp.role === 'host' && mp.ready && sim.state === 'flying', 20000);
      const code = mp.server && mp.server.code;
      await wait(1100);
      mp.syncRoster();
      const badge = mp.hud.el.querySelector('.mp-badge').textContent.replace(/\s+/g, ' ');
      const listHead = mp.hud.el.querySelector('[data-mp-list] h4').textContent;
      const madeToast = [...document.querySelectorAll('.hud-toast')].map((t) => t.textContent).find((x) => /private match/.test(x)) || '';
      r.ok('list2 mp: Make it hosts the private match on that island — the badge and the player list say which, with a code of two words and a number',
        !!up && mp.server.priv && mp.server.map === 'meadow' && sim.settings.map === 'meadow' && !!P.parseCode(code) && badge.includes('Private match') && badge.includes('On Harrier Flats') && badge.includes(code)
        && /Harrier Flats/.test(listHead) && /on Harrier Flats is ready/.test(madeToast),
        `${badge} | ${listHead} | ${madeToast}`);
      // What the lobby screen's Private match card says now (painted, not opened: this tab is flying).
      mp.lobbyScreen.refresh();
      const nowLine = le.querySelector('[data-mp-privnow]');
      r.ok('list2 mp: and the lobby screen’s Private match card says where your match is, with its code',
        !nowLine.hidden && /private match on Harrier Flats/.test(nowLine.textContent) && nowLine.textContent.includes(code) && priv.disabled, nowLine.textContent);
      // Not a lobby, and on no list: every lobby on this network is still empty.
      const lookSig = makeSig();
      await lookSig.open(P.playerPeerId());
      const look = new Net(lookSig);
      const answers = await Promise.all([1, 2, 3, 4, 5].map((n) => look.ping(P.lobbyId(hash, n), 1500)));
      r.ok('list2 mp: a private match is not one of the lobbies — all five still empty', answers.every((a) => a === 'empty'), answers.join(','));
      look.destroy();
      lookSig.close();
      // Friends join by the code; five at once are one toast.
      const toastsBefore = document.querySelectorAll('.hud-toast').length;
      const friends = [];
      for (let i = 0; i < 5; i++) {
        const sig = makeSig();
        await sig.open(P.playerPeerId());
        cleanups.push(() => sig.close());
        const c = new S.ClientSession({ net: new Net(sig), target: P.codeId(code), profile: { name: NAMES[i], colour: P.COLOURS[i], key: key(i + 20) } });
        friends.push(c.start().then((w) => ({ c, w }), (e) => ({ c, e })));
      }
      const joined = await Promise.all(friends);
      const said = await until(() => [...document.querySelectorAll('.hud-toast')].find((t) => /and 3 more joined/.test(t.textContent)), 5000);
      const joinToasts = [...document.querySelectorAll('.hud-toast')].filter((t) => /joined/.test(t.textContent) && !t.classList.contains('is-out'));
      r.ok('list2 mp: friends join the private match by its code, told its island; five arriving together are one toast, not five',
        joined.every((j) => j.w && j.w.server.priv && j.w.server.map === 'meadow') && !!said && joinToasts.length === 1, `${joined.filter((j) => j.w).length} in; toasts: ${joinToasts.map((t) => t.textContent).join(' | ')} (${toastsBefore} before)`);
      // The badge: docked to the minimap and clear of every toast.
      await wait(1100);
      for (let i = 0; i < 3; i++) { sim.update(1 / 30); await wait(20); }
      const b = mp.hud.el.querySelector('.mp-badge').getBoundingClientRect();
      const mm = sim.minimap && sim.minimap.visible && sim.minimap.canvas ? sim.minimap.canvas.getBoundingClientRect() : null;
      const toasts = [...document.querySelectorAll('.hud-toast')].map((t) => t.getBoundingClientRect());
      const clearOfToasts = toasts.every((t) => !(b.left < t.right && b.right > t.left && b.top < t.bottom && b.bottom > t.top));
      const docked = !mm || (Math.abs(b.bottom - (mm.top - 8)) < 3 || Math.abs(b.top - (mm.bottom + 8)) < 3);
      // Part 2 of list 2 added one row of chips to the badge (⚔ PvP, ⚡ Summon, 🏁 Race): 154 px in the full
      // self-test before they were made compact, from under 150 without them. Still small: under 180.
      r.ok('list2 mp: the badge sits by the minimap, clear of the toasts, and small', clearOfToasts && docked && b.width <= 260 && b.height < 180,
        `badge ${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)}; minimap ${mm ? `${Math.round(mm.left)},${Math.round(mm.top)}` : 'hidden'}; ${toasts.length} toasts`);
      for (const j of joined) if (j.c) j.c.leave();
      mp.leave('left');
      await wait(300);
    }

    /* ---- joining a friend's private match by its code: taken to its island ---- */
    {
      const csig = makeSig();
      const code = 'maple-kite-42';
      await csig.open(P.codeId(code));
      const host = new S.HostSession({
        mode: 'code', profile: { name: 'Kind Koala', colour: P.COLOURS[1], key: 'l2privhostl2privhost' },
        server: { name: 'Cloud Base', map: 'fjord', game: 'flight', code, slot: 0 },
        spawnInfo: () => ({ x: 0, y: 0, z: 0, heading: 90, speed: 0, agl: 0, onGround: true }),
      });
      host.attach(new Net(csig));
      cleanups.push(() => { host.close(); csig.close(); });
      const ht = setInterval(() => host.tick(performance.now()), 66);
      cleanups.push(() => clearInterval(ht));
      mp.profile.ride = null;
      if (sim.menus) sim.menus.currentGame = 'flight';
      mpMod.openMultiplayer(sim);
      const le = document.querySelector('[data-screen="lobbies"]');
      const box = le.querySelector('[data-mp-code]');
      box.value = 'Maple Kite 42';
      box.dispatchEvent(new Event('input', { bubbles: true }));
      le.querySelector('[data-mp-join-code]').click();
      const inside = await until(() => mp.role === 'client' && mp.ready && sim.state === 'flying', 20000);
      await wait(1100);
      mp.syncRoster();
      const badge = mp.hud.el.querySelector('.mp-badge').textContent.replace(/\s+/g, ' ');
      const toast = [...document.querySelectorAll('.hud-toast')].map((t) => t.textContent).find((x) => /private match/.test(x)) || '';
      r.ok('list2 mp: a friend who joins a private match by its code is taken to the island it was made on, and told so',
        !!inside && mp.server.priv && sim.settings.map === 'fjord' && badge.includes('On Aurora Fjords') && badge.includes(code) && /on Aurora Fjords/.test(toast),
        `${sim.settings.map}; ${badge}; ${toast}`);
      mp.leave('left');
      clearInterval(ht);
      host.close();
      csig.close();
      await wait(300);
    }

    /* ---- a private match shown like a lobby, the Wi-Fi line, and the range (list 2, second round) ---- */
    {
      const code = 'lagoon-kite-44';
      const csig = makeSig();
      await csig.open(P.codeId(code));
      const host = new S.HostSession({
        mode: 'code', profile: { name: 'Kind Koala', colour: P.COLOURS[1], key: 'l2rangehostl2rangeho' },
        server: { name: 'Cloud Base', map: 'fjord', game: 'flight', code, slot: 0 },
        spawnInfo: () => ({ x: 0, y: 0, z: 0, heading: 90, speed: 0, agl: 0, onGround: true }),
      });
      host.attach(new Net(csig));
      cleanups.push(() => { host.close(); csig.close(); });
      const ht = setInterval(() => host.tick(performance.now()), 66);
      cleanups.push(() => clearInterval(ht));
      mp.profile.ride = null;
      if (sim.menus) sim.menus.currentGame = 'flight';
      mpMod.openMultiplayer(sim);
      const le = document.querySelector('[data-screen="lobbies"]');
      const box = le.querySelector('[data-mp-code]');
      box.value = 'lagoon kite 44';
      box.dispatchEvent(new Event('input', { bubbles: true }));
      const card = le.querySelector('[data-mp-private-card]');
      const shown = await until(() => !card.hidden && /1\/8/.test(card.textContent) && /Aurora Fjords/.test(card.textContent), 8000);
      const lobbyCard = le.querySelector('[data-mp-lobby="1"]');
      const sameStyle = card.classList.contains('mp-lobby') && card.parentElement === lobbyCard.parentElement
        && getComputedStyle(card).borderRadius === getComputedStyle(lobbyCard).borderRadius;
      const joinBtn = card.querySelector('[data-mp-pv-join]');
      r.ok('list2 mp: a friend’s private match shows up with the lobbies as a lobby card — marked Private with its code, how many out of eight, its island, a Join button',
        !!shown && sameStyle && /Private · lagoon-kite-44/.test(card.textContent) && joinBtn && !joinBtn.disabled && joinBtn.textContent === 'Join',
        card.textContent.replace(/\s+/g, ' ').trim());
      const lines = [le.querySelector('.mp-privhead + .hint'), card].map((el) => (el ? el.textContent : ''));
      r.ok('list2 mp: and says, where the code is, that it works with friends who aren’t on your Wi-Fi',
        lines.every((t) => /Works with friends who aren’t on your Wi-Fi/i.test(t)) && /aren’t on your Wi-Fi/.test(le.querySelector('[data-mp-code]').closest('.mp-card').textContent), lines.join(' | ').slice(0, 300));
      joinBtn.click();
      const inside = await until(() => mp.role === 'client' && mp.ready && sim.state === 'flying', 20000);
      r.ok('list2 mp: its Join takes you in, like a lobby’s', !!inside && mp.server.priv && sim.settings.map === 'fjord', `${mp.role} on ${sim.settings.map}`);
      mp.leave('left');
      await wait(400);

      // Range 1: the matchmaking server drops the connection in the middle of a join — the join opens it again and gets in.
      mpMod.openMultiplayer(sim);
      await mp.ensureLookSocket();
      {
        const sig = mp.lookSig;
        const send = sig.send.bind(sig);
        let dropped = false;
        sig.send = (type, dst, payload) => {
          if (!dropped && type === 'OFFER' && !(payload && payload.metadata && payload.metadata.k === 'ping')) {
            dropped = true;
            sig.close();
            return false;
          }
          return send(type, dst, payload);
        };
        const t0 = performance.now();
        await mp.joinCode(code);
        const ms = Math.round(performance.now() - t0);
        const tried = mp.log.some((l) => /first try failed \(signaling\)/.test(l));
        r.ok('list2 mp: range — the matchmaking server dropping in the middle of a join by code: it opens again and the second try gets in',
          dropped && tried && mp.role === 'client', `${ms} ms; ${mp.log.slice(-3).join(' | ')}`);
        mp.leave('left');
        await wait(400);
      }

      // Range 2: the matchmaking server turns this address away twice (0.peerjs.com rate-limits) — it waits, tries again, and gets in.
      {
        mp.closeLookSocket();
        let refused = 0;
        const Base = server.WebSocket;
        class Refusing extends Base {
          constructor(url) {
            super(url);
            // Refused before it opens, as a server turning an address away does.
            if (refused < 2 && /id=ifs-p-/.test(url)) {
              refused++;
              this.close();
            }
          }
        }
        mp.configure({ backend, hash, WebSocketImpl: Refusing });
        mpMod.openMultiplayer(sim);
        await wait(50);
        mp.closeLookSocket();
        refused = 0;
        const said = [];
        const st = mp.lobbyScreen.status.bind(mp.lobbyScreen);
        mp.lobbyScreen.status = (text, kind) => { said.push(text); return st(text, kind); };
        const t0 = performance.now();
        await mp.joinCode(code);
        const ms = Math.round(performance.now() - t0);
        mp.lobbyScreen.status = st;
        r.ok('list2 mp: range — the matchmaking server refusing twice: the join says it is trying again, waits, and gets in',
          refused === 2 && mp.role === 'client' && said.some((x) => /busy — trying again/.test(x || '')), `${ms} ms after 2 refusals; said: ${said.filter(Boolean).join(' / ')}`);
        mp.leave('left');
        await wait(400);
        mp.closeLookSocket();
        mp.configure({ backend, hash, WebSocketImpl: server.WebSocket });
      }

      // Range 3: only a relay would get through (a symmetric NAT on this side), and none is configured: two tries, then words a child can act on.
      {
        const Real = window.RTCPeerConnection;
        class OnlyRelay extends Real {
          constructor(cfg) { super({ ...(cfg || {}), iceTransportPolicy: 'relay' }); }
        }
        window.RTCPeerConnection = OnlyRelay;
        cleanups.push(() => { window.RTCPeerConnection = Real; });
        try {
          mp.closeLookSocket();
          mpMod.openMultiplayer(sim);
          await mp.ensureLookSocket();
          mp.lookNet.codeConnectMs = 2500;
          mp.lookNet.connectTimeoutMs = 2500;
          const said = [];
          const st = mp.lobbyScreen.status.bind(mp.lobbyScreen);
          mp.lobbyScreen.status = (text, kind) => { said.push(text); return st(text, kind); };
          const t0 = performance.now();
          await mp.joinCode(code);
          const ms = Math.round(performance.now() - t0);
          mp.lobbyScreen.status = st;
          const last = said.filter(Boolean).pop() || '';
          r.ok('list2 mp: range — when only a relay could get through and there is none: a second try, then “Couldn’t reach your friend’s game — ask them to check their internet”',
            mp.role === null && said.some((x) => /Still trying to reach your friend’s game/.test(x || '')) && /Couldn’t reach your friend’s game — ask them to check their internet/.test(last),
            `${ms} ms with a 2.5 s window each (25 s in the game); said: ${said.filter(Boolean).join(' / ')}`);
        } finally {
          window.RTCPeerConnection = Real;
          mp.closeLookSocket();
        }
      }

      // Your own private match: the same card, with a crown.
      mp.profile.ride = null;
      await mp.hostServer({ serverName: mp.serverName(), map: 'kestrel', game: 'flight', privateGame: true, ride: mp.ride() });
      await until(() => mp.role === 'host' && mp.ready, 20000);
      const mine = await mp.lobbyScreen.privateCard();
      const mineCard = le.querySelector('[data-mp-private-card]');
      r.ok('list2 mp: the private match you host is shown the same way, with a crown and its code',
        mine && mine.mine && !mineCard.hidden && /👑/.test(mineCard.textContent) && mineCard.textContent.includes(mp.server.code) && /1\/8/.test(mineCard.textContent),
        mineCard.textContent.replace(/\s+/g, ' ').trim());
      mp.syncRoster();
      const foot = mp.hud.el.querySelector('[data-mp-list] .mp-foot').textContent;
      r.ok('list2 mp: and the player list under the code says it works with friends who aren’t on your Wi-Fi', /Works with friends who aren’t on your Wi-Fi/.test(foot), foot);
      mp.leave('left');
      clearInterval(ht);
      host.close();
      csig.close();
      await wait(300);
    }
  } catch (err) {
    r.ok('list2 mp: the checks ran to the end', false, String(err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err));
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
    for (const k of ['list2test:ping', 'list2test:score']) mp.events.kinds.delete(k);
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
