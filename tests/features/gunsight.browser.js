/**
 * Browser checks for the gunsight, the lock key and "meteors need guns", on
 * the real game: the real flight model, the real drones and meteors, the real
 * screen. The maths, the filter and the missions' data are proved in node
 * (gunsight.mjs); this is the part that needs a page.
 *
 * The owner: "make the crosshair better and have a lockon" and "you can only
 * shoot metores if u have a plane with guns or smth".
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion. No sound is
 * played or asked for. Leaves the game on the menu.
 */
export async function check(sim, r, say = () => {}) {
  const THREE = await import('../../src/vendor/three.module.js');
  const { extStatus } = await import('../../src/game/extensions.js');
  const GS = await import('../../src/features/gunsight.js');
  const G = await import('../../src/features/gunsight/rules.js');
  const HSK = await import('../../src/features/heatseek.js');
  const MET = await import('../../src/features/meteor.js');
  const Sky = await import('../../src/features/sky.js');
  const T = await import('../../src/world/terrain.js');
  const gs = GS.gunsight;
  const hs = HSK.heatseek;
  const html = document.documentElement.classList;

  r.ok('gunsight: the extension is registered and live', (extStatus().find((e) => e.id === 'gunsight') || {}).live === true, JSON.stringify(extStatus().filter((e) => e.id === 'gunsight')));

  const ac = () => sim.aircraft;
  const steps = (s, dt = 1 / 30) => sim.step(s, dt);
  const free = async (aircraft, extra = {}) => {
    if (sim.state !== 'menu' && typeof sim.quitToMenu === 'function') sim.quitToMenu('main');
    if (sim.game === 'heli' && aircraft !== 'harrier') sim.switchGame('flight');
    if (aircraft === 'harrier') sim.switchGame('heli');
    await sim.startMode('free', { time: 'day', condition: 'clear', windSpeedKts: 4, windDirDeg: 90, airborne: true, aircraft, ...extra });
    sim.autoPauseOnHide = false;
    steps(0.6);
  };
  const pressLock = () => {
    sim.key('Home', true);
    sim.key('Home', false);
    steps(0.1);
  };
  const steady = () => {
    const a = ac();
    const own = Object.prototype.hasOwnProperty.call(a, 'update') ? a.update : null;
    a.update = function holdSteady(dt) {
      this.pos.addScaledVector(this.vel, dt);
    };
    return () => {
      if (own) a.update = own;
      else delete a.update;
    };
  };
  const aimNose = (to, speed = 110) => {
    const a = ac();
    const dir = new THREE.Vector3().subVectors(to, a.pos).normalize();
    a.quat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    a.vel.copy(dir).multiplyScalar(speed);
    a.groundSpeed = speed;
  };
  const behind = (tgt, back = 1000) => {
    const a = ac();
    const v = new THREE.Vector3(tgt.vel.x, 0, tgt.vel.z).normalize();
    a.pos.set(tgt.pos.x - v.x * back, tgt.pos.y + 25, tgt.pos.z - v.z * back);
    a.onGround = false;
    a.agl = Math.max(200, a.pos.y - Math.max(0, T.heightAt(a.pos.x, a.pos.z)));
    aimNose(tgt.pos);
  };
  const drones = () => hs.practice.filter((d) => d.alive);
  const vis = (e) => e && !e.hidden && getComputedStyle(e).display !== 'none';

  const startMap = sim.settings.map;
  try {
    /* ============================== no gun, no sight ============================== */
    say('gunsight: who has a sight');
    await free('vanguard');
    let snap = gs.snapshot();
    r.ok('gunsight: the Vanguard has a sight — a ring and a dot — and with nothing locked it is just that (no ticks, no pipper, no box)',
      gs.up && snap.sightShown && snap.idle && !snap.pipperShown && !snap.boxShown && !snap.arrowShown && snap.ticksLit === 0, JSON.stringify(snap));
    r.ok('gunsight: it is at the middle of the screen, where the nose points (inside the view, away from the edges)', (() => {
      const el = document.querySelector('.gsk-sight');
      const b = el && el.getBoundingClientRect();
      return !!b && b.width >= 40 && b.width <= 90 && b.left + b.width / 2 > innerWidth * 0.2 && b.left + b.width / 2 < innerWidth * 0.8 && b.top + b.height / 2 > innerHeight * 0.15 && b.top + b.height / 2 < innerHeight * 0.75;
    })(), (() => { const b = document.querySelector('.gsk-sight').getBoundingClientRect(); return `${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}px in ${innerWidth}x${innerHeight}`; })());
    r.ok('gunsight: it is thin and crisp — an svg, a 1.6 px ring, a dot, twelve tick marks', (() => {
      const svg = document.querySelector('.gsk-sight svg');
      return !!svg && svg.querySelectorAll('.gsk-tick').length === 12 && !!svg.querySelector('.gsk-ring') && !!svg.querySelector('.gsk-dot');
    })());
    sim.returnToAirport();
    steps(0.4);
    r.ok('gunsight: on the runway there is no sight (nothing to shoot on the ground)', !gs.up && !gs.snapshot().sightShown, JSON.stringify(gs.snapshot()));
    for (const id of ['courier', 'skylark', 'meridian', 'b747', 'tempest', 'massimo', 'tpose']) {
      await free(id);
      const s = gs.snapshot();
      pressLock();
      r.ok(`gunsight: ${id} has no gun, so no sight, no box and no LOCK button; the key says so and locks nothing`, !gs.up && !s.sightShown && !s.lockButton && !gs.designated && gs.notes.some((n) => /No guns or missiles/i.test(n)), JSON.stringify(s));
    }
    await free('harrier');
    r.ok('gunsight: the helicopter: no sight', !gs.up && !gs.snapshot().sightShown);
    sim.switchGame('flight');

    /* ---- PvP gives any aeroplane the paint pellets, so the sight ---- */
    say('gunsight: PvP');
    await free('courier');
    const player = { id: 3, me: false, name: 'Brave Otter', pos: new THREE.Vector3(), vel: { x: 0, y: 0, z: -70 }, visible: true, pvp: true, ghost: false, radius: 7 };
    const row = { on: true, arming: false, down: false, shield: false };
    const savedNet = { on: hs.net.on, players: hs.net.players, row: hs.net.row };
    hs.net.players = () => [player];
    hs.net.row = () => row;
    const restore0 = steady();
    const place = () => {
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(ac().quat);
      player.pos.copy(ac().pos).addScaledVector(f, 600);
    };
    hs.net.on = () => false;
    place();
    steps(0.3);
    pressLock();
    r.ok('gunsight: a Courier with PvP off has no gun; another player dead ahead cannot be locked', !gs.up && !gs.designated && !gs.gunTargets().some((c) => c.kind === 'player'));
    hs.net.on = () => true;
    place();
    steps(0.3);
    r.ok('gunsight: with PvP on for me, even a Courier has the sight (its paint pellets) — and no pylons, no MSL panel', gs.up && gs.snapshot().sightShown && !hs.armed && !hs.snapshot().panelShown, JSON.stringify(gs.snapshot()));
    place();
    pressLock();
    r.ok('gunsight: the lock key takes the player, the box says their name and a range, and the pipper is up', !!gs.designated && gs.designated.kind === 'player' && gs.snapshot().boxShown && /BRAVE OTTER \d+ m/.test(gs.snapshot().tag) && gs.snapshot().pipperShown, JSON.stringify(gs.snapshot()));
    r.ok('gunsight: ...and it is the PvP pellets that are being led (430 m/s)', gs.gun.id === 'pellet' && gs.gun.speed === 430);
    row.shield = true;
    steps(1.8);
    r.ok('gunsight: a player who is shielded drops out of the list and the lock is let go', !gs.designated && !gs.snapshot().boxShown);
    row.shield = false;
    // The old PvP cross is not drawn on top of the new sight in an aeroplane.
    r.ok('gunsight: in an aeroplane the sight is the only crosshair (the old PvP cross is stood down)', sim.gunsightUp === true);
    Object.assign(hs.net, savedNet);
    restore0();

    /* ============================== the lock key ============================== */
    say('gunsight: the lock key');
    await free('vanguard', { practiceTargets: true });
    const ds = drones();
    r.ok('gunsight: three practice drones out ahead, all lockable for the gun', ds.length === 3 && gs.gunTargets().length === 3, `${ds.length} drones, ${gs.gunTargets().length} lockable`);
    // Put civilians, Air Force One and a rescue plane right in front of the nose, in the middle of the sight.
    const f0 = new THREE.Vector3(0, 0, -1).applyQuaternion(ac().quat);
    const mk = (spec, dist) => Sky.registerBody({ pos: ac().pos.clone().addScaledVector(f0, dist), vel: new THREE.Vector3(0, 0, -50), radius: 12, crew: 1, ...spec });
    const crowd = [mk({ id: 'gs-civil', kind: 'traffic', name: 'Island 47' }, 700), mk({ id: 'gs-afo', kind: 'npc', name: 'Air Force One', typeId: 'b747', crew: 2 }, 900), mk({ id: 'gs-rescue', kind: 'friend', name: 'Rescue One' }, 800), mk({ id: 'gs-pursuer', kind: 'enemy', name: 'Ironhead One' }, 1100)];
    const restore1 = steady();
    const seen = [];
    for (let i = 0; i < 8; i++) {
      pressLock();
      if (gs.designated) seen.push(gs.designated.id);
    }
    r.ok('gunsight: eight presses of the lock key, four civilians dead ahead of the nose: it only ever takes the drones, and never an airliner, Air Force One or a rescue plane',
      seen.length >= 3 && seen.every((id) => /^target-drone-\d+$/.test(id)), seen.join(', '));
    for (const b of crowd) Sky.unregisterBody(b);
    // The cycle: three drones then let go.
    gs.release();
    steps(0.1);
    const order = [];
    for (let i = 0; i < 4; i++) {
      pressLock();
      order.push(gs.designated ? gs.designated.id : null);
    }
    r.ok('gunsight: the key goes through the three drones, nearest the nose first, and the fourth press lets go', order.slice(0, 3).every((x) => x) && new Set(order.slice(0, 3)).size === 3 && order[3] === null, order.join(', '));
    pressLock();
    snap = gs.snapshot();
    r.ok('gunsight: a locked drone gets a box with its range, the sight\'s ticks light, and the lead pipper is on the screen', !!gs.designated && snap.boxShown && /\d+(\.\d)? ?(m|km)/.test(snap.tag) && snap.ticksLit > 0 && snap.pipperShown && !snap.idle, JSON.stringify(snap));
    r.ok('gunsight: the heat-seeker\'s own box is not drawn on top of it (one box)', !hs.snapshot().lockShown || !snap.boxShown, JSON.stringify(hs.snapshot()));

    /* ---- the lead is right: fly the pellet ---- */
    say('gunsight: the lead');
    gs.release();
    steps(0.1);
    const d1 = drones()[0];
    behind(d1, 550);
    steps(0.4);
    let tries = 0;
    while ((!gs.designated || gs.designated.ref !== d1.body) && tries++ < 4) pressLock();
    steps(0.1);
    const lead = gs.lead;
    r.ok('gunsight: locked on the first drone with a solution, inside the pellet\'s reach, all twelve ticks lit', !!gs.designated && gs.designated.ref === d1.body && lead && lead.ok && gs.snapshot().ticksLit === 12, JSON.stringify({ lead: lead && { t: lead.t, range: lead.range, inRange: lead.inRange }, snap: gs.snapshot() }));
    if (lead && lead.ok) {
      // Point the nose along the pipper's line (the aeroplane keeps flying as it was) and fly a pellet and the drone for the pellet's time.
      const dir = new THREE.Vector3(lead.dir.x, lead.dir.y, lead.dir.z);
      const a = ac();
      const vel0 = a.vel.clone();
      const pos0 = a.pos.clone();
      const p = pos0.clone();
      const pv = vel0.clone().addScaledVector(dir, gs.gun.speed);
      const dp = d1.pos.clone();
      const dv = new THREE.Vector3(d1.vel.x, d1.vel.y, d1.vel.z);
      // The drone really flies its circle for that long; the pellet is straight.
      const n = 20;
      for (let i = 0; i < n; i++) d1.update(lead.t / n);
      const arrive = d1.pos.clone();
      p.addScaledVector(pv, lead.t);
      const miss = p.distanceTo(arrive);
      const straight = dp.clone().addScaledVector(dv, lead.t).distanceTo(arrive);
      r.ok('gunsight: a pellet flown along the pipper\'s line (the aeroplane\'s own speed in it) reaches the drone — to within 15 m, with the drone really flying its circle', miss < 15, `miss ${miss.toFixed(1)} m (a straight-line drone would be ${straight.toFixed(1)} m off the circle) over ${lead.t.toFixed(2)} s at ${lead.range.toFixed(0)} m`);
    }
    // The pipper on the screen is where the nose-line of lead.dir meets the sight's own range: compare with the sight's dot for the nose line.
    sim.rig.setMode('cockpit');
    steps(0.2);
    const cam = sim.camera;
    const w = innerWidth;
    const h = innerHeight;
    const proj = (dir) => {
      const q = ac().pos.clone().addScaledVector(dir, G.AIM_DIST).project(cam);
      return { x: (q.x * 0.5 + 0.5) * w, y: (-q.y * 0.5 + 0.5) * h };
    };
    sim.renderer.render(sim.scene, sim.camera);
    steps(0.1);
    const pip = document.querySelector('.gsk-pip');
    const ring = document.querySelector('.gsk-sight');
    if (vis(pip) && gs.lead && gs.lead.ok) {
      const pb = pip.getBoundingClientRect();
      const want = proj(new THREE.Vector3(gs.lead.dir.x, gs.lead.dir.y, gs.lead.dir.z));
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(ac().quat);
      const nose = proj(f);
      const rb = ring.getBoundingClientRect();
      // Both are painted from the camera of the frame before (the same one), so they are compared with each other: the pipper's offset from the ring is the lead line's offset from the nose line.
      const gotDx = pb.left + pb.width / 2 - (rb.left + rb.width / 2);
      const gotDy = pb.top + pb.height / 2 - (rb.top + rb.height / 2);
      const wantDx = want.x - nose.x;
      const wantDy = want.y - nose.y;
      r.ok('gunsight: the pipper sits off the ring exactly as the lead line sits off the nose line (to 3 px), and the ring is near the nose line on the screen',
        Math.abs(gotDx - wantDx) < 3 && Math.abs(gotDy - wantDy) < 3 && Math.hypot(rb.left + rb.width / 2 - nose.x, rb.top + rb.height / 2 - nose.y) < 40,
        `pipper-ring ${gotDx.toFixed(1)},${gotDy.toFixed(1)} want ${wantDx.toFixed(1)},${wantDy.toFixed(1)}; ring ${Math.round(rb.left + rb.width / 2)},${Math.round(rb.top + rb.height / 2)} vs nose ${Math.round(nose.x)},${Math.round(nose.y)}`);
    } else {
      r.ok('gunsight: the pipper is drawn where the lead line projects', false, 'no pipper on the screen');
    }
    restore1();

    /* ---- the same box serves the missiles ---- */
    say('gunsight: the missiles share the lock');
    await free('vanguard', { practiceTargets: true });
    const restore2 = steady();
    const dA = drones()[0];
    const dB = drones()[1];
    // Nose on B, the lock key on A: the seeker must work on A only.
    behind(dB, 1200);
    steps(0.3);
    gs.release();
    let tries2 = 0;
    pressLock();
    while ((!gs.designated || gs.designated.ref !== dA.body) && tries2++ < 4) pressLock();
    let stole = false;
    for (let i = 0; i < 30; i++) {
      behind(dB, 1200);
      steps(0.1);
      if (hs.lock.target && hs.lock.target.ref === dB.body) stole = true;
    }
    r.ok('gunsight: with drone A locked by the key and the nose on drone B, the seeker never takes B (the lock is the player\'s, nothing steals it)', !!gs.designated && gs.designated.ref === dA.body && !stole && hs.prefer === gs.designated.id, `designated ${gs.designated && gs.designated.id}, prefer ${hs.prefer}, stole ${stole}`);
    // Nose on A: the one box goes yellow, then red, in the gunsight's box.
    let sawYellow = false;
    for (let i = 0; i < 40; i++) {
      behind(dA, 1200 - i * 4);
      steps(0.1);
      const s = gs.snapshot();
      if (s.boxAcquire) sawYellow = true;
      if (s.boxRed) break;
    }
    snap = gs.snapshot();
    r.ok('gunsight: nose on A: the box closes yellow then goes red when the seeker has it, with "LOCKED" and the range — and the missile\'s own box is not drawn as a second one', sawYellow && snap.boxRed && /LOCKED/.test(snap.tag) && !hs.snapshot().lockShown, JSON.stringify({ sawYellow, snap, hs: hs.snapshot().lockShown }));
    const before = hs.stats.fired;
    const res = hs.fire();
    r.ok('gunsight: fire goes to the locked drone', res.ok && hs.stats.fired === before + 1 && res.missile.cand.ref === dA.body, JSON.stringify({ ok: res.ok }));
    for (let i = 0; i < 100 && hs.liveMissiles().length; i++) steps(0.1);
    steps(1.2);
    /*
     * The box may be up again by now — on drone B, if the seeker has found it
     * by itself (which the next check wants): B flies at the edge of the
     * seeker's 10 degrees here, and a tenth of a second either way in the
     * missile's flight decides it (the camera audit's new follow view moved
     * when the lock loop above saw its red box, by one frame). What must not
     * be boxed is the drone that is gone.
     */
    const onB = hs.lock.target && hs.lock.target.ref !== dA.body;
    r.ok('gunsight: the drone is down and the gunsight lets the lock go on its own', !dA.alive && !gs.designated && hs.prefer === null && (!gs.snapshot().boxShown || onB), `designated ${gs.designated && gs.designated.id}, prefer ${hs.prefer}, box ${gs.snapshot().boxShown}, seeker on ${hs.lock.target ? hs.lock.target.id : 'nothing'}`);
    // After a loss, the seeker finds targets by itself again.
    behind(dB, 1200);
    for (let i = 0; i < 25; i++) steps(0.1);
    r.ok('gunsight: and with no lock held the seeker looks for itself again (the old way still works)', !!hs.lock.target && hs.lock.target.ref === dB.body, hs.lock.target ? hs.lock.target.id : 'no target');
    restore2();

    /* ---- off the screen: the arrow ---- */
    say('gunsight: the arrow');
    await free('vanguard', { practiceTargets: true });
    const restore3 = steady();
    sim.rig.setMode('cockpit');
    const dC = drones()[0];
    behind(dC, 900);
    steps(0.3);
    pressLock();
    const has = !!gs.designated;
    // Fly past it: the aeroplane is put 700 m beyond the drone, nose still pointing the way it was going, so the locked drone is behind the camera.
    const a3 = ac();
    const fwd3 = new THREE.Vector3(0, 0, -1).applyQuaternion(a3.quat);
    a3.pos.copy(dC.pos).addScaledVector(fwd3, 700);
    // (The sight is painted from the camera of a frame or two before: give it a moment to settle.)
    for (let i = 0; i < 15; i++) {
      steps(0.1);
      if (gs.snapshot().arrowShown) break;
    }
    snap = gs.snapshot();
    const to3 = new THREE.Vector3().subVectors(dC.pos, a3.pos);
    const nose3 = new THREE.Vector3(0, 0, -1).applyQuaternion(a3.quat);
    r.ok('gunsight: with the target off the screen the box is replaced by an arrow with its range, and the pipper is not drawn off in the sky', has && snap.arrowShown && !snap.boxShown && !snap.pipperShown && /\d/.test(snap.arrowText),
      `${JSON.stringify(snap)} designated ${gs.designated && gs.designated.id} (the drone is ${dC.body.id}), range ${to3.length().toFixed(0)}, drone is ${(to3.normalize().dot(nose3) > 0 ? 'ahead' : 'behind')} the nose, view ${sim.rig.mode}`);
    r.ok('gunsight: the arrow sits on a ring round the middle of the screen, inside the view', (() => {
      const el = document.querySelector('.gsk-arrow');
      const b = el && el.getBoundingClientRect();
      return !!b && b.left > 0 && b.right < innerWidth && b.top > 0 && b.bottom < innerHeight;
    })());
    restore3();
    sim.rig.setMode('chase');

    /* ---- a new flight lets go, a lock is not carried over ---- */
    say('gunsight: a new flight');
    await free('vanguard', { practiceTargets: true });
    steps(1.2);
    pressLock();
    const held = !!gs.designated;
    await free('vanguard');
    r.ok('gunsight: a new flight starts with nothing locked', held && !gs.designated && hs.prefer === null && !gs.snapshot().boxShown);
    gs.release();

    /* ============================== meteors need guns ============================== */
    say('gunsight: meteors');
    await sim.startMode('mission', { id: 'meteor-shower' });
    sim.autoPauseOnHide = false;
    steps(0.6);
    r.ok('gunsight: Meteor Shower hands you a jet with guns (the Osprey), at sunset, airborne and flying', sim.meteors.active && sim.meteors.mode === 'shower' && G.hasGuns(sim.aircraftType, sim.game) && sim.aircraftType.id === 'osprey' && !ac().crashed && !ac().onGround, `${sim.aircraftType.id}`);
    const a4 = ac();
    steps(8);
    r.ok('gunsight: ...and the jet flies it: eight seconds in it is still flying above its stall speed', !a4.crashed && a4.vel.length() > 55 && a4.agl > 100, `${a4.vel.length().toFixed(0)} m/s, ${a4.agl.toFixed(0)} m up`);
    const restore4 = steady();
    const front = (d, dy = 20) => {
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(ac().quat);
      const p = ac().pos.clone().addScaledVector(f, d);
      p.y += dy;
      return p;
    };
    // Two rocks ahead: a central one, and a farther, off-centre one. The lock key picks the off-centre one.
    const rock1 = sim.meteors.spawn({ target: front(800), az: ac().heading + 180, dive: 8, speed: 20, T: 4, radius: 3, size: 1.5 });
    const rock2 = sim.meteors.spawn({ target: front(1400, 60), az: ac().heading + 180, dive: 8, speed: 20, T: 4, radius: 3, size: 1.5 });
    const giant = sim.meteors.spawnGiant();
    steps(0.1);
    const ids = gs.gunTargets().filter((c) => c.kind === 'meteor').map((c) => c.uid);
    r.ok('gunsight: both rocks can be locked for the gun, the giant cannot (far too big)', ids.includes(rock1.uid) && ids.includes(rock2.uid) && !ids.includes(giant && giant.uid), ids.join(','));
    gs.release();
    let picked = null;
    for (let i = 0; i < 4 && !(picked && picked.uid === rock2.uid); i++) {
      pressLock();
      picked = gs.designated;
    }
    snap = gs.snapshot();
    r.ok('gunsight: the lock key reaches the meteor: a box that says METEOR and a range, and the pipper', !!picked && picked.kind === 'meteor' && picked.uid === rock2.uid && /METEOR/.test(snap.tag) && snap.pipperShown, JSON.stringify(snap));
    r.ok('gunsight: a meteor is a gun target only — the seeker has nothing to lock and the missile will not go', hs.lock.target === null && hs.prefer === picked.id && (() => { const x = hs.fire(); return !x.ok && x.why === 'no lock'; })());
    r.ok('gunsight: the meteor is led with the zapper\'s gun, out to 3.5 km', gs.gun.id === 'zap' && gs.gun.range === 3500);
    const z0 = sim.meteors.stats.zapped;
    // Aim the nose at the central rock; the zap goes to the one the lock key picked instead.
    aimNose(rock1.pos, 90);
    steps(0.05);
    sim.key('KeyZ', true);
    sim.key('KeyZ', false);
    steps(0.05);
    r.ok('gunsight: Z zaps the meteor that is locked, not just the one nearest the middle', sim.meteors.stats.zapped === z0 + 1 && !rock2.active, `zapped ${z0} → ${sim.meteors.stats.zapped}, locked rock ${rock2.active ? 'still there' : 'gone'}, central rock ${rock1.active ? 'still there' : 'gone'}`);
    steps(2);
    r.ok('gunsight: the lock is let go once it is gone', !gs.designated && hs.prefer === null);
    restore4();
    sim.meteors.end();

    // In a plane with no guns.
    say('gunsight: meteors in a civilian plane');
    await free('courier');
    sim.meteors.begin({ mode: 'shower' }, null);
    steps(0.5);
    const ac5 = ac();
    const f5 = new THREE.Vector3(0, 0, -1).applyQuaternion(ac5.quat);
    const target5 = ac5.pos.clone().addScaledVector(f5, 900);
    const rock3 = sim.meteors.spawn({ target: target5, az: ac5.heading + 180, dive: 5, speed: 20, T: 4, radius: 3, size: 1.5 });
    const restore5 = steady();
    steps(0.1);
    const noteLog = [];
    const realNotify = sim.hud.notify;
    sim.hud.notify = function (t, ...rest) {
      noteLog.push(String(t));
      return realNotify.call(this, t, ...rest);
    };
    const zc = sim.meteors.stats.zapped;
    sim.key('KeyZ', true);
    sim.key('KeyZ', false);
    steps(0.1);
    sim.hud.notify = realNotify;
    const ui = document.getElementById('meteor-ui');
    const zapBtn = ui && ui.querySelector('.mt-zap');
    const keysLine = ui && ui.querySelector('.mt-keys');
    r.ok('gunsight: in a Courier the zap key pops nothing, and says it calmly: "You need a plane with guns to shoot meteors."', sim.meteors.stats.zapped === zc && rock3.active && noteLog.includes('You need a plane with guns to shoot meteors.'), JSON.stringify({ zapped: sim.meteors.stats.zapped, noteLog }));
    r.ok('gunsight: ...no ZAP button, and the panel says the same sentence instead of "Press Z"', (!zapBtn || zapBtn.hidden) && !!keysLine && !keysLine.hidden && /plane with guns/.test(keysLine.textContent) && !/Press/.test(keysLine.textContent), keysLine ? keysLine.textContent : 'no keys line');
    r.ok('gunsight: ...and the "ZAP" lock reticle is not drawn on the rock ahead', !Array.from(document.querySelectorAll('#meteor-ui .mt-ret.is-lock')).some((e) => vis(e) && e.style.display !== 'none'));
    r.ok('gunsight: ...nor can the lock key reach a meteor (a Courier has no gun to lock with)', !gs.up && !gs.gunTargets().some((c) => c.kind === 'meteor'));
    restore5();
    sim.meteors.end();

    // The missions.
    say('gunsight: the meteor missions');
    for (const [id, want] of [['meteor-town', 'osprey'], ['meteor-dodge', 'courier'], ['meteor-photo', 'tempest']]) {
      await sim.startMode('mission', { id });
      sim.autoPauseOnHide = false;
      steps(0.6);
      const isZap = !!MET.MODES[sim.meteors.mode].zapper;
      r.ok(`gunsight: ${id}: the ${want}${isZap ? ', which has guns, for a zap mission' : ' (no zapping in it)'}`, sim.aircraftType.id === want && (!isZap || G.hasGuns(sim.aircraftType, sim.game)), `${sim.aircraftType.id}, zapper ${isZap}`);
      if (id === 'meteor-town') {
        steps(6);
        r.ok('gunsight: Guard the Town: the Osprey flies it (six seconds in, flying, above its stall)', !ac().crashed && ac().vel.length() > 55 && sim.runner.status === 'running', `${ac().vel.length().toFixed(0)} m/s, ${sim.runner.status}`);
        const zb = document.querySelector('#meteor-ui .mt-zap');
        const touch = html.contains('is-touch-device');
        r.ok('gunsight: ...and the panel offers the zap (Z or the button), not the "no guns" line', !!document.querySelector('#meteor-ui .mt-keys') && !/plane with guns/.test(document.querySelector('#meteor-ui .mt-keys').textContent) && (touch ? zb && !zb.hidden : true));
      }
      if (id === 'meteor-dodge') {
        const z1 = sim.meteors.stats.zapped;
        sim.key('KeyZ', true);
        sim.key('KeyZ', false);
        r.ok('gunsight: Rock Dodger: Z does nothing (and tells no tale about guns: you dodge, you do not shoot)', sim.meteors.stats.zapped === z1);
      }
    }

    /* ============================== the touch screen ============================== */
    say('gunsight: touch');
    html.add('is-touch-device');
    await sim.startMode('mission', { id: 'meteor-shower' });
    sim.autoPauseOnHide = false;
    steps(2);
    const btns = [document.querySelector('.gsk-btn.is-lock'), document.querySelector('.hsk-btn.is-fire'), document.querySelector('.hsk-btn.is-flare'), document.querySelector('#meteor-ui .mt-zap')];
    r.ok('gunsight: on a touch screen in the Osprey, LOCK, FIRE MSL, FLARES and ZAP are all there', btns.every((b) => vis(b)), btns.map((b) => (b ? `${(b.className || '').toString().split(' ').pop()}:${vis(b)}` : 'missing')).join(' '));
    const rect = (e) => e.getBoundingClientRect();
    const hits = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const clash = [];
    for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) if (btns[i] && btns[j] && hits(rect(btns[i]), rect(btns[j]))) clash.push(`${btns[i].className} x ${btns[j].className}`);
    r.ok('gunsight: none of the four buttons covers another', clash.length === 0, clash.join(' | ') || btns.map((b) => { const q = rect(b); return `${Math.round(q.left)},${Math.round(q.top)}`; }).join(' '));
    const mm = sim.minimap && sim.minimap.el ? rect(sim.minimap.el) : null;
    r.ok('gunsight: ...nor the minimap, nor does any leave the screen', !!mm && btns.every((b) => !hits(rect(b), mm) && rect(b).left >= 0 && rect(b).right <= innerWidth && rect(b).top >= 0 && rect(b).bottom <= innerHeight), `map at ${mm && Math.round(mm.left)},${mm && Math.round(mm.top)}`);
    // The LOCK button does what the key does.
    gs.release();
    const rock4 = sim.meteors.spawn({ target: front(900), az: ac().heading + 180, dive: 5, speed: 20, T: 4, radius: 3, size: 1.5 });
    const restore6 = steady();
    steps(0.2);
    const lockBtn = btns[0];
    lockBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 9 }));
    lockBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 9 }));
    steps(0.2);
    r.ok('gunsight: the LOCK button is the same as the key — it locks the rock ahead', !!gs.designated && gs.designated.uid === rock4.uid && gs.snapshot().boxShown, JSON.stringify(gs.snapshot()));
    restore6();
    sim.meteors.end();
    html.remove('is-touch-device');
    steps(0.3);
    r.ok('gunsight: on a desk the LOCK button is not shown (the Home key does it)', !vis(document.querySelector('.gsk-btn.is-lock')));
  } catch (e) {
    r.ok('gunsight: the checks ran to the end', false, String((e && e.stack) || e).slice(0, 600));
  } finally {
    sim.override = null;
    html.remove('is-touch-device');
    try {
      if (sim.meteors && sim.meteors.active) sim.meteors.end();
      hs.clearTargets();
      gs.release();
    } catch (e) {
      /* nothing to clear */
    }
    if (sim.game === 'heli' && typeof sim.switchGame === 'function') sim.switchGame('flight');
    if (sim.state !== 'menu' && typeof sim.quitToMenu === 'function') sim.quitToMenu('main');
    if (startMap && sim.settings.map !== startMap) sim.setMap(startMap);
  }
  return r;
}
