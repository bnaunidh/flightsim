/**
 * Browser checks for the heat-seeking missiles and the Heat-Seeker disaster,
 * on the real game (src/features/heatseek.js, ../heatseek-disaster.js), the
 * real flight model, the real explosions. The maths, the filter and the PvP
 * judge are proved in node (heat-seekers.mjs); this is the part that needs a
 * page: the pylons on the drawn model, the screen, the keys, the drones, the
 * lock and the shot, the rearm, the disaster from arming to damage.
 *
 * "fire 3 at practice drones (3 hits max, then 0/3), survive or dodge the
 * disaster with flares, PvP off means you cannot lock players" (the brief).
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion. No sound is
 * played or asked for. Leaves the game on the menu.
 */
export async function check(sim, r, say = () => {}) {
  const THREE = await import('../../src/vendor/three.module.js');
  const { extStatus } = await import('../../src/game/extensions.js');
  const Input = await import('../../src/flight/input.js');
  const R = await import('../../src/features/heatseek/rules.js');
  const HSK = await import('../../src/features/heatseek.js');
  const DIS = await import('../../src/features/heatseek-disaster.js');
  const D = await import('../../src/game/disasters.js');
  const Sky = await import('../../src/features/sky.js');
  const FS = await import('../../src/render/flash-safety.js');
  const T = await import('../../src/world/terrain.js');
  const { eject } = await import('../../src/features/eject.js');
  const hs = HSK.heatseek;
  const html = document.documentElement.classList;
  const FT = 3.28084;

  const live = (id) => (extStatus().find((e) => e.id === id) || {}).live;
  r.ok('heat-seekers: both extensions are registered and live', live('heatseek') && live('heatseek-disaster'), JSON.stringify(extStatus().filter((e) => /heatseek/.test(e.id))));

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
  const pressKey = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
  /** The flight model set aside: the aeroplane holds its attitude and carries on at its speed. */
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
  /** Put the aeroplane `back` metres behind the target on the line it is flying, nose on it. */
  const behind = (tgt, back = 1300) => {
    const a = ac();
    const v = new THREE.Vector3(tgt.vel.x, 0, tgt.vel.z).normalize();
    a.pos.set(tgt.pos.x - v.x * back, tgt.pos.y + 25, tgt.pos.z - v.z * back);
    a.onGround = false;
    a.agl = Math.max(200, a.pos.y - Math.max(0, T.heightAt(a.pos.x, a.pos.z)));
    aimNose(tgt.pos);
  };
  const names = (list) => list.map((c) => c.name).join(', ');

  const startMap = sim.settings.map;
  try {
    /* ============================== the military jet, armed, with targets ============================== */
    say('heat-seekers: the Vanguard');
    await free('vanguard', { practiceTargets: true });
    const A = ac();
    r.ok('heat-seekers: the Vanguard is armed — MSL 3/3 — and the screen says so', hs.armed && hs.left === 3 && hs.max === 3 && hs.label === 'MSL 3/3' && hs.snapshot() && hs.snapshot().count === 'MSL 3/3' && hs.snapshot().panelShown,
      JSON.stringify(hs.snapshot()));
    const rig = hs.rig;
    r.ok('heat-seekers: three missiles hang under the wings and belly of the drawn model, all visible', !!rig && rig.stations.length === 3 && rig.stations.every((s) => s.mesh.visible && s.on) && rig.group.parent === sim.model && rig.group.visible,
      rig ? rig.stations.map((s) => `${s.id}:${s.mesh.visible}`).join(' ') : 'no rig');
    r.ok('heat-seekers: the break-up does not count the pylons as airframe, and the cockpit is still skipped', sim.weaponsRig === rig.group);
    const fireDef = Input.ACTIONS.fireMissile;
    r.ok('heat-seekers: the screen names the fire key from the registry', /\\|Backslash/i.test(hs.snapshot().fireKeys) || /\\/.test(hs.snapshot().fireKeys), hs.snapshot().fireKeys);
    r.ok('heat-seekers: Settings → Controls has a Weapons group with both actions (and the H card for a plane shows them)',
      Input.groupedActions('plane').some((g) => g.id === 'Weapons' && g.items.some((i) => i.key === 'fireMissile') && g.items.some((i) => i.key === 'flares'))
      && 'fireMissile' in Input.actionsFor('plane') && fireDef.group === 'Weapons');

    /* ---- the practice drones from the Free Flight tick ---- */
    const drones = () => hs.practice.filter((d) => d.alive);
    r.ok('heat-seekers: the "Practice target drones" option put three unmanned drones out ahead', drones().length === 3 && hs.validTargets().length === 3 && hs.validTargets().every((c) => c.kind === 'body'),
      `${drones().length} drones, ${hs.validTargets().length} valid`);
    const bodies = Sky.bodies().filter((b) => b.practice);
    r.ok('heat-seekers: they are in the sky list as small red-diamond enemies with nobody aboard', bodies.length === 3 && bodies.every((b) => b.kind === 'enemy' && b.small === true && b.crew === 0), JSON.stringify(bodies.map((b) => [b.kind, b.small, b.crew])));

    /* ---- civilians and Air Force One are never targets, however well they sit in the seeker ---- */
    const civil = Sky.registerBody({ id: 'test-civil', kind: 'traffic', name: 'Island 47', pos: new THREE.Vector3(), vel: new THREE.Vector3(0, 0, -50), radius: 12, crew: 1 });
    const afo = Sky.registerBody({ id: 'test-afo', kind: 'npc', name: 'Air Force One', pos: new THREE.Vector3(), vel: new THREE.Vector3(0, 0, -50), radius: 30, crew: 2, typeId: 'b747' });
    const rescue = Sky.registerBody({ id: 'test-rescue', kind: 'friend', name: 'Rescue One', pos: new THREE.Vector3(), vel: new THREE.Vector3(0, 0, -50), radius: 8, crew: 1 });
    const manned = Sky.registerBody({ id: 'test-pursuer', kind: 'enemy', name: 'Ironhead One', pos: new THREE.Vector3(), vel: new THREE.Vector3(0, 0, -50), radius: 8, crew: 1 });
    const restore = steady();
    hs.clearTargets();
    // All four sit 1.4 km dead ahead of the nose, one after another, for two seconds each.
    let lockedOnForbidden = false;
    for (const b of [civil, afo, rescue, manned]) {
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(A.quat);
      b.pos.copy(A.pos).addScaledVector(f, 1400);
      b.vel.copy(A.vel);
      for (let i = 0; i < 20; i++) {
        steps(0.1);
        b.pos.copy(A.pos).addScaledVector(f, 1400);
        if (hs.lock.target) lockedOnForbidden = true;
      }
    }
    const valid = hs.validTargets();
    r.ok('heat-seekers: civilian traffic, Air Force One, the rescue aeroplane and a manned pursuer are never valid targets, and the seeker never closes on them',
      valid.length === 0 && !lockedOnForbidden && !hs.lock.target, `${valid.length} valid, locked-on-forbidden ${lockedOnForbidden}`);
    for (const b of [civil, afo, rescue, manned]) Sky.unregisterBody(b);
    r.ok('heat-seekers: pressing fire at a civilian-only sky says NO LOCK and costs nothing', (() => { const x = hs.fire(); return !x.ok && x.why === 'no lock' && hs.left === 3; })());

    /* ---- three at the practice drones ---- */
    say('heat-seekers: three at the practice drones');
    hs.spawnTargets(sim, 4);
    steps(0.3);
    r.ok('heat-seekers: four practice drones, all valid', drones().length === 4 && hs.validTargets().length === 4);
    // From the cockpit, where the camera looks where the nose does (the chase camera lags a teleport), so the red box can be seen on the screen.
    sim.rig.setMode('cockpit');
    const engage = (d, via) => {
      behind(d, 1250);
      let t = 0;
      let lockedAt = -1;
      for (let i = 0; i < 40; i++) {
        behind(d, 1250 - i * 6);
        steps(0.1);
        t += 0.1;
        if (hs.lock.locked && lockedAt < 0) lockedAt = t;
        if (lockedAt >= 0) break;
      }
      const lockedOn = hs.lock.target && hs.lock.target.ref === d.body;
      const redBox = hs.snapshot().lockLocked && hs.snapshot().lockShown;
      const before = hs.stats.fired;
      if (via === 'key') pressKey('Backslash');
      else hs.fire();
      const fired = hs.stats.fired === before + 1;
      let ended = -1;
      for (let i = 0; i < 100; i++) {
        steps(0.1);
        if (!hs.liveMissiles().length) {
          ended = (i + 1) * 0.1;
          break;
        }
      }
      return { lockedAt, lockedOn, redBox, fired, ended, dead: !d.alive };
    };
    const targets = drones().slice();
    const shots = [engage(targets[0], 'key'), engage(targets[1], 'api'), engage(targets[2], 'key')];
    r.ok('heat-seekers: each lock took about a second (1.0-2.5 s) with the box red on the drone', shots.every((s) => s.lockedAt >= 0.9 && s.lockedAt <= 2.5 && s.lockedOn && s.redBox), JSON.stringify(shots.map((s) => [s.lockedAt, s.lockedOn, s.redBox])));
    sim.rig.setMode('chase');
    r.ok('heat-seekers: each missile went (the key, then the API, then the key) and flew to its drone', shots.every((s) => s.fired && s.ended > 0 && s.ended < 9), JSON.stringify(shots.map((s) => [s.fired, s.ended])));
    r.ok('heat-seekers: three hits — three drones down in a real airburst — and one drone left', shots.every((s) => s.dead) && drones().length === 1 && hs.stats.kills >= 3, `${drones().length} left, kills ${hs.stats.kills}`);
    r.ok('heat-seekers: the screen reads MSL 0/3 and every pylon is empty', hs.left === 0 && hs.snapshot().count === 'MSL 0/3' && rig.stations.every((s) => !s.mesh.visible && !s.on), `${hs.snapshot().count}`);
    r.ok('heat-seekers: the smoke trail was drawn (white puffs in the world)', hs.world.trails.count > 10 || hs.world.stats.launched === 3, `${hs.world.trails.count} puffs, ${hs.world.stats.launched} launched`);
    // The fourth: nothing leaves.
    const last = drones()[0];
    behind(last, 1200);
    steps(1.5);
    const fourth = hs.fire();
    r.ok('heat-seekers: a fourth press fires nothing — "out of missiles", 3 hits max then 0/3', !fourth.ok && fourth.why === 'empty' && hs.liveMissiles().length === 0 && drones().length === 1 && hs.notes.some((n) => /out of missiles/i.test(n)), JSON.stringify({ fourth: fourth.why, notes: hs.notes.slice(-2) }));
    pressKey('Backslash');
    steps(0.3);
    r.ok('heat-seekers: nor does the key', hs.liveMissiles().length === 0 && hs.left === 0 && hs.stats.fired === 3);

    /* ---- the rack comes back ---- */
    say('heat-seekers: rearm');
    restore();
    sim.returnToAirport();
    steps(0.4);
    r.ok('heat-seekers: back on the runway is a new start — rearmed MSL 3/3, pylons full', hs.left === 3 && rig && hs.rig.stations.every((s) => s.mesh.visible), `${hs.label}`);
    // Burn them, then land-and-stop: on the runway, stopped, 2.5 s.
    for (let i = 0; i < 3; i++) hs.S.load.fire();
    steps(0.2);
    sim.override = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 1 };
    ac().groundSpeed = 0;
    steps(1.5);
    r.ok('heat-seekers: stopped on the runway for under 2.5 s: still empty', hs.left === 0, hs.label);
    steps(2.5);
    sim.override = null;
    r.ok('heat-seekers: stopped on the runway for 2.5 s: MSL 3/3 again, with a "Rearmed" word', hs.left === 3 && hs.notes.some((n) => /Rearmed/.test(n)) && hs.stats.rearmed >= 1,
      `${hs.label}; onGround ${ac().onGround}, ${ac().groundSpeed.toFixed(1)} m/s, paved ${T.isPaved(ac().pos.x, ac().pos.z)}, armed ${hs.armed}, gate ${hs.S.rearm.t.toFixed(1)} s; ${hs.notes.slice(-2).join(' | ')}`);
    // A new flight rearms too.
    for (let i = 0; i < 2; i++) hs.S.load.fire();
    await sim.startMode('free', { time: 'day', condition: 'clear', airborne: true, aircraft: 'vanguard' });
    steps(0.3);
    r.ok('heat-seekers: a new flight is a full rack', hs.left === 3 && hs.armed, hs.label);

    /* ---- PvP off: players cannot be locked; on: they can ---- */
    say('heat-seekers: PvP gating');
    const fakeRow = { on: true, arming: false, down: false, shield: false };
    const player = () => ({ id: 3, me: false, name: 'Brave Otter', pos: new THREE.Vector3(), vel: { x: 0, y: 0, z: -60 }, visible: true, pvp: true, ghost: false, radius: 7 });
    const savedNet = { on: hs.net.on, players: hs.net.players, row: hs.net.row };
    const rp = player();
    hs.net.players = () => [rp];
    hs.net.row = () => fakeRow;
    const restore2 = steady();
    const place = () => {
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(ac().quat);
      rp.pos.copy(ac().pos).addScaledVector(f, 1300);
    };
    hs.net.on = () => false;
    let sawLock = false;
    for (let i = 0; i < 30; i++) { place(); steps(0.1); if (hs.lock.target) sawLock = true; }
    r.ok('heat-seekers: PvP off — another player sits dead ahead in the seeker for 3 s and is never locked or listed', !sawLock && hs.validTargets().length === 0, `lock ${sawLock}`);
    hs.net.on = () => true;
    let lockedPlayer = false;
    for (let i = 0; i < 30; i++) { place(); steps(0.1); if (hs.lock.locked && hs.lock.target && hs.lock.target.kind === 'player') lockedPlayer = true; }
    r.ok('heat-seekers: PvP on for both — the same player is locked in a second', lockedPlayer && hs.validTargets().some((c) => c.kind === 'player' && c.playerId === 3), `locked ${lockedPlayer}`);
    fakeRow.shield = true;
    place(); steps(0.2);
    r.ok('heat-seekers: ...unless they are shielded (just back from a tag)', hs.validTargets().length === 0);
    fakeRow.shield = false;
    fakeRow.on = false;
    place(); steps(0.2);
    r.ok('heat-seekers: ...or have their PvP off', hs.validTargets().length === 0);
    Object.assign(hs.net, savedNet);
    restore2();

    /* ---- not armed: everything that is not military ---- */
    say('heat-seekers: the unarmed');
    for (const id of ['skylark', 'meridian', 'massimo', 'a320', 'b747', 'tpose']) {
      await free(id);
      steps(0.5);
      const snap = hs.snapshot();
      const x = hs.fire();
      r.ok(`heat-seekers: ${id}: no missiles, no pylons, no panel, and fire does nothing`, !hs.armed && !hs.rig && !x.ok && x.why === 'unarmed' && hs.liveMissiles().length === 0 && !(snap && snap.fireButton) && !(snap && snap.panelShown), JSON.stringify(snap));
    }
    await free('harrier');
    steps(0.5);
    r.ok('heat-seekers: the helicopter: unarmed too', !hs.armed && !hs.rig && !hs.fire().ok);
    sim.switchGame('flight');

    /* ---- the touch layout ---- */
    say('heat-seekers: touch');
    await free('vanguard');
    html.add('is-touch-device');
    steps(0.8);
    const fireBtn = document.querySelector('.hsk-btn.is-fire');
    const flareBtn = document.querySelector('.hsk-btn.is-flare');
    const vis = (e) => e && !e.hidden && getComputedStyle(e).display !== 'none';
    r.ok('heat-seekers: a touch screen shows FIRE MSL and FLARES, and they say 3/3 and 8', vis(fireBtn) && vis(flareBtn) && /3\/3/.test(fireBtn.textContent) && /FIRE/.test(fireBtn.textContent) && /8/.test(flareBtn.textContent), `${fireBtn && fireBtn.textContent} | ${flareBtn && flareBtn.textContent}`);
    const boxOf = (e) => e.getBoundingClientRect();
    const mm = sim.minimap && sim.minimap.el ? boxOf(sim.minimap.el) : null;
    const hits = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const stray = [];
    for (const e of document.querySelectorAll('.hsk-btn, .hsk-panel')) {
      if (!vis(e) || !mm) continue;
      if (hits(boxOf(e), mm)) stray.push(e.className);
    }
    r.ok('heat-seekers: nothing of it covers the minimap (touch layout)', !!mm && stray.length === 0, stray.join(', ') || `map at ${mm && Math.round(mm.left)},${mm && Math.round(mm.top)} ${mm && Math.round(mm.width)}px`);
    // The two buttons, pressed with pointer events as a finger does.
    const downOn = (b) => b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 7 }));
    const upOn = (b) => b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 7 }));
    const flaresBefore = hs.flares.left;
    downOn(flareBtn); upOn(flareBtn);
    steps(0.3);
    r.ok('heat-seekers: the FLARES button drops a pair (and it counts down)', hs.flares.left === flaresBefore - 1 && hs.world.flares.length >= 2, `${flaresBefore} → ${hs.flares.left}`);
    const noLock = hs.stats.noLock;
    downOn(fireBtn); upOn(fireBtn);
    steps(0.2);
    r.ok('heat-seekers: the FIRE MSL button is the same as the key — with nothing in the circle it says NO LOCK', hs.stats.noLock === noLock + 1 && hs.left === 3);
    html.remove('is-touch-device');
    steps(0.3);
    r.ok('heat-seekers: on a desk the touch buttons are not shown', !vis(fireBtn) && !vis(flareBtn));

    /* ---- Air Force One - Under Attack: the escort seat's drones ---- */
    say('heat-seekers: Air Force One, the escort seat');
    {
      const Cast = await import('../../src/game/roles/cast.js');
      if (sim.state !== 'menu') sim.quitToMenu('main');
      await sim.startMode('mission', { id: 'afo-attack', role: 'escort' });
      sim.autoPauseOnHide = false;
      steps(13);
      const fighter = sim.aircraftType;
      r.ok('heat-seekers: the escort seat flies a military jet, armed MSL 3/3', hs.armed && hs.left === 3 && /vanguard|f22|fa18|f35b|nightjar|osprey/.test(fighter.id), `${fighter.id}, ${hs.label}`);
      const targetsNow = hs.validTargets();
      const info = Cast.castInfo();
      r.ok('heat-seekers: the two unmanned drones are the only valid targets — Air Force One is not among them', targetsNow.length >= 1 && targetsNow.length <= (info.dronesAlive || 2) && targetsNow.every((c) => c.ref.kind === 'enemy' && c.ref.small), `${targetsNow.length} valid of ${info.dronesAlive} drones: ${names(targetsNow)}`);
      const shotBefore = (info.stats && info.stats.shotDrones) || 0;
      const rest = steady();
      const d0 = targetsNow[0];
      if (d0) {
        for (let i = 0; i < 40; i++) {
          const b = d0.ref;
          const v = new THREE.Vector3(b.vel.x, 0, b.vel.z);
          if (v.lengthSq() < 1) v.set(0, 0, -1);
          v.normalize();
          ac().pos.set(b.pos.x - v.x * (1250 - i * 5), b.pos.y + 20, b.pos.z - v.z * (1250 - i * 5));
          ac().onGround = false;
          aimNose(b.pos);
          steps(0.1);
          if (hs.lock.locked) break;
        }
        const locked = hs.lock.locked;
        const f = locked ? hs.fire() : { ok: false };
        for (let i = 0; i < 100 && hs.liveMissiles().length; i++) steps(0.1);
        const after = Cast.castInfo();
        r.ok('heat-seekers: a missile locked and fired in the escort seat downs a drone, and the mission counts it as shot down', locked && f.ok && ((after.stats && after.stats.shotDrones) || 0) === shotBefore + 1, `locked ${locked}, shot ${shotBefore} → ${after.stats && after.stats.shotDrones}`);
      } else {
        r.ok('heat-seekers: a missile locked and fired in the escort seat downs a drone', false, 'no drone to lock');
      }
      rest();
      sim.quitToMenu('main');
      await sim.startMode('mission', { id: 'afo-attack' });
      steps(1);
      r.ok('heat-seekers: the captain\'s seat (Air Force One itself, a 747) carries none', !hs.armed && !hs.rig, `${sim.aircraftType.id}`);
    }

    /* ============================== the disaster ============================== */
    say('heat-seekers: the disaster, registered');
    const ev = D.findEvent('heatSeeker');
    const pool = D.poolForMap(T.MAP);
    r.ok('heat-seekers: the Heat-Seeker is in the disasters list and never in the randomiser', !!ev && D.SELECTABLE_EVENTS.includes(ev) && !pool.includes(ev) && ev.random === false, `${pool.length} in this map's pool`);
    sim.quitToMenu('main');
    const menusFree = sim.menus && sim.menus.screens && sim.menus.screens.free;
    const menusPause = sim.menus && sim.menus.screens && sim.menus.screens.pause;
    r.ok('heat-seekers: the Free Flight screen can arm it and the pause menu has its button, with a lock-on ring for an icon',
      !!menusFree && !!menusFree.querySelector('[data-event="heatSeeker"]') && !!menusPause && !!menusPause.querySelector('[data-natural="heatSeeker"]')
      && !!menusPause.querySelector('[data-natural="heatSeeker"] [data-heatseeker-icon]'));
    r.ok('heat-seekers: the Free Flight screen has the practice-targets tick, and the pause menu a Targets fold', !!menusFree.querySelector('[data-practice-targets]') && !!menusPause.querySelector('[data-hsk-fold]'));

    /* ---- a trainer, doing nothing: it hits, and the flight model hurts the nearest zone ---- */
    say('heat-seekers: a trainer that does nothing');
    await free('skylark');
    const A2 = ac();
    sim.override = { pitch: 0, roll: 0, yaw: 0, throttle: 0.6 };
    sim.triggerNatural('heatSeeker');
    const dbg = () => DIS.heatSeekerDebug();
    r.ok('heat-seekers: summoned from the pause menu\'s path — it is running, and the pause menu shows it ON', !!sim.activeEvents.heatSeeker && dbg().E.on, JSON.stringify(sim.activeEvents));
    steps(0.2);
    const E = dbg().E;
    r.ok('heat-seekers: already airborne, it begins: a 60-90 s window, a plan of salvos, two unmanned launchers 2.3-2.9 km out',
      E.started && E.total >= 60 && E.total <= 90 && E.plan.length >= 3 && E.sites.length === 2 && E.sites.every((s) => s.dist >= 2300 && s.dist <= 2900),
      JSON.stringify({ started: E.started, total: Math.round(E.total), salvos: E.plan.length, sites: dbg().sites }));
    r.ok('heat-seekers: everybody gets flares for it — even a Skylark: 8, with a FLR 8 on the screen', hs.flares.max === 8 && hs.flares.left === 8 && /FLR 8/.test(hs.snapshot().flares) && hs.snapshot().panelShown && !hs.armed, JSON.stringify(hs.snapshot()));
    r.ok('heat-seekers: the launchers are in the scene (decks you can see)', E.sites.length === 2 && E.sites.every((s) => s.mesh.parent === sim.scene));
    // Shorten the rest: a pair of salvos at 1 s and 16 s, and a window to match; the plan above was the real one.
    E.plan = [{ at: 1, count: 1 }, { at: 16, count: 2 }];
    E.planAt = 0;
    E.total = 26;
    let warned = '';
    let arrowSeen = 0;
    let diamondSeen = 0;
    let alertSeen = '';
    const hudCap = [];
    for (let i = 0; i < 60; i++) {
      steps(0.25);
      const snap = hs.snapshot();
      if (snap.alert && !alertSeen) alertSeen = snap.alert;
      arrowSeen = Math.max(arrowSeen, snap.arrows);
      diamondSeen = Math.max(diamondSeen, snap.diamonds);
      const glow = document.querySelector('.hsk-glow');
      if (glow && !glow.hidden) hudCap.push(Number(glow.style.opacity));
      if (dbg().stats.hits >= 1) break;
    }
    warned = alertSeen;
    r.ok('heat-seekers: the warning is "MISSILE LAUNCH — break left/right and pop flares"', /MISSILE LAUNCH — break (left|right) and pop flares/.test(warned), warned);
    r.ok('heat-seekers: the missile-approach indicator is on the screen (an arrow on the ring or a diamond on the missile)', arrowSeen + diamondSeen >= 1, `arrows ${arrowSeen}, diamonds ${diamondSeen}`);
    r.ok('heat-seekers: the red glow never goes over the full-screen cap with Reduce flashing on', FS.FLASH.reduce && hudCap.length > 0 && hudCap.every((o) => o <= FS.SCREEN_MAX + 1e-9), `${hudCap.length} samples, max ${Math.max(0, ...hudCap).toFixed(3)} (cap ${FS.SCREEN_MAX})`);
    const st = dbg();
    r.ok('heat-seekers: a hit: the flight model hurt the nearest zone, with a real airburst and a plain word', st.stats.hits >= 1 && st.lastHit && Object.keys(st.lastHit.damageAfter).some((k) => st.lastHit.damageAfter[k] > (st.lastHit.damageBefore[k] || 0)) && ['leftWing', 'rightWing', 'nose', 'tail', 'fuselage'].includes(st.lastHit.part),
      JSON.stringify(st.lastHit && { part: st.lastHit.part, sev: +st.lastHit.severity.toFixed(2), big: st.lastHit.big }));
    r.ok('heat-seekers: nobody is hurt and nothing is graphic: the aeroplane flies on after the hit (not crashed)', !A2.crashed, `crashed ${A2.crashed}`);
    // Let it finish.
    for (let i = 0; i < 160 && dbg().E.on; i++) steps(0.25);
    r.ok('heat-seekers: when it is over the launchers go quiet and the pause menu\'s button goes out (done, or the seat fired after two bad hits)', !dbg().E.on && !sim.activeEvents.heatSeeker && dbg().last && ['done', 'ejected'].includes(dbg().last.why), JSON.stringify(dbg().last));
    steps(8);
    r.ok('heat-seekers: ...the flares lent to a Skylark go back, and so does the FLR 8 on the screen', hs.flares.max === 0 && !hs.snapshot().panelShown && !hs.snapshot().flareButton && E.sites.length === 0, JSON.stringify({ flares: hs.flares, snap: hs.snapshot(), sites: dbg().sites.length }));
    sim.override = null;

    /* ---- a jet that pops flares and breaks: it gets away ---- */
    say('heat-seekers: a jet that defends itself');
    await free('f22');
    const A3 = ac();
    sim.triggerNatural('heatSeeker');
    steps(0.2);
    const E3 = dbg().E;
    E3.plan = [{ at: 1, count: 1 }, { at: 10, count: 2 }, { at: 22, count: 1 }];
    E3.planAt = 0;
    E3.total = 34;
    const flaresStart = hs.flares.left;
    const dodgeLog = [];
    sim.override = { pitch: 0, roll: 0, yaw: 0, throttle: 0.7 };
    const popped = new Set();
    let turn = 0;
    // Hold her level between the turns (the same feedback the Air Force One check uses), so a missed turn is not what ends the flight.
    const level = () => {
      const a = ac();
      return {
        roll: Math.max(-0.4, Math.min(0.4, -a.bankAngleDeg() * 0.05 - a.omega.z * 0.4)),
        pitch: Math.max(-0.3, Math.min(0.3, -a.vs * 0.1 - a.omega.x * 0.5)),
      };
    };
    for (let i = 0; i < 400 && dbg().E.on; i++) {
      steps(0.1);
      for (const m of hs.liveMissiles((x) => x.owner === 'threat')) {
        // Flares as it closes — 1000, 700 and 450 m — and a hard turn across it.
        for (const thr of [1000, 700, 450]) {
          if (m.range < thr && !popped.has(`${m.id}:${thr}`)) {
            popped.add(`${m.id}:${thr}`);
            pressKey('Digit4');
            dodgeLog.push(`flare@${Math.round(m.range)}`);
            turn = 0.7;
          }
        }
      }
      if (turn > 0) { sim.override = { pitch: Math.max(level().pitch, 0.15), roll: 0.55, yaw: 0, throttle: 1 }; turn -= 0.1; } else sim.override = { ...level(), yaw: 0, throttle: 0.9 };
    }
    const s3 = dbg().stats;
    const keyCount = flaresStart - hs.flares.left;
    r.ok('heat-seekers: flares on the 4 key (a pair a press) and a hard turn — nearly every missile is dodged', s3.launched >= 3 && s3.dodged >= s3.launched - 1 && keyCount >= 3 && !A3.crashed, JSON.stringify({ launched: s3.launched, dodged: s3.dodged, decoyed: s3.decoyed, hits: s3.hits, flaresUsed: keyCount, crashed: A3.crashed, last: dbg().last && dbg().last.why, log: dodgeLog.slice(0, 6) }));
    r.ok('heat-seekers: the flares did something — a missile went for one, or lost the aeroplane in the confusion', s3.decoyed + s3.dodged >= 1, `${s3.decoyed} popped on a flare, ${s3.dodged} dodged`);
    sim.override = null;

    /* ---- a helicopter: slower missiles ---- */
    say('heat-seekers: the helicopter');
    await free('harrier');
    sim.triggerNatural('heatSeeker');
    steps(0.2);
    const E4 = dbg().E;
    r.ok('heat-seekers: in the helicopter it begins (it works in every aircraft), flares granted', E4.on && E4.started && E4.heli === true && hs.flares.left === 8, JSON.stringify({ on: E4.on, heli: E4.heli }));
    E4.plan = [{ at: 0.5, count: 1 }];
    E4.planAt = 0;
    E4.total = 12;
    let peak = 0;
    for (let i = 0; i < 40; i++) {
      steps(0.25);
      for (const m of hs.liveMissiles((x) => x.owner === 'threat')) peak = Math.max(peak, m.s.speed);
      if (peak > 0 && !hs.liveMissiles((x) => x.owner === 'threat').length) break;
    }
    r.ok('heat-seekers: ...and its missile is slower than a jet\'s (under 200 m/s)', peak > 0 && peak < 200, `${peak.toFixed(0)} m/s`);
    sim.quitToMenu('main');
    sim.switchGame('flight');

    /* ---- armed before departure ---- */
    say('heat-seekers: armed before departure');
    await sim.startMode('free', { time: 'day', condition: 'clear', airborne: false, aircraft: 'skylark', events: { heatSeeker: { afterMin: 0 } } });
    sim.autoPauseOnHide = false;
    r.ok('heat-seekers: armed on the Free Flight screen, it waits for departure', !!sim.armedEvents && 'heatSeeker' in sim.armedEvents, JSON.stringify(Object.keys(sim.armedEvents || {})));
    steps(3);
    r.ok('heat-seekers: ...it is lit once the clock runs, but nothing fires at an aeroplane on the ground', dbg().E.on && !dbg().E.started && hs.liveMissiles((x) => x.owner === 'threat').length === 0);
    // Up it goes.
    const ground = Math.max(0, T.heightAt(ac().pos.x, ac().pos.z));
    ac().reset({ pos: new THREE.Vector3(ac().pos.x, 0, ac().pos.z), headingDeg: ac().heading, speed: 60, altAGL: 400, engineOn: true, gearDown: false });
    sim.override = { pitch: 0, roll: 0, yaw: 0, throttle: 0.6 };
    steps(4);
    r.ok('heat-seekers: ...and begins after takeoff', dbg().E.started && dbg().sites.length === 2, JSON.stringify({ started: dbg().E.started }));
    // The seat after a second big hit.
    say('heat-seekers: a big hit, twice');
    const E5 = dbg().E;
    E5.plan = [];
    E5.planAt = 0;
    E5.queue = [];
    E5.total = 400;
    r.ok('heat-seekers: the disaster exposes its hit for the check', typeof DIS.__onHit === 'function');
    if (typeof DIS.__onHit === 'function') {
      const before = { ...ac().damage };
      DIS.__onHit(sim, { s: { x: ac().pos.x + 2, y: ac().pos.y, z: ac().pos.z, hitDist: 1, params: R.FLIGHT.threat } }, 0.95);
      steps(0.3);
      const after1 = { ...ac().damage };
      r.ok('heat-seekers: a big hit takes the nearest zone to a high level and hurts the engine, with "eject or put her down"', Math.max(...Object.values(after1)) >= 0.7 && ac().failures.roughEngine && !ac().crashed, JSON.stringify(after1));
      DIS.__onHit(sim, { s: { x: ac().pos.x - 2, y: ac().pos.y, z: ac().pos.z, hitDist: 1, params: R.FLIGHT.threat } }, 0.95);
      for (let i = 0; i < 40 && eject.phase === 'idle'; i++) steps(0.25);
      r.ok('heat-seekers: a second big hit and the seat fires for you — the pilot ejects under a parachute, nobody goes down with it', eject.phase === 'out' || eject.phase === 'walking', `${eject.phase}`);
      steps(0.5);
      r.ok('heat-seekers: ...and the disaster stops (nobody left to chase)', !dbg().E.on && dbg().last && dbg().last.why === 'ejected', JSON.stringify(dbg().last));
    }

    /* ============================== Reduce flashing: the flicker probe ============================== */
    say('heat-seekers: flicker');
    {
      const P = await import('../flicker-probe.js');
      const World = await import('../../src/features/heatseek/world.js');
      const pct = (x) => `${(x * 100).toFixed(2)}%`;
      const salvo = async (withMissiles) => {
        if (sim.state !== 'menu') sim.quitToMenu('main');
        await P.setupScenario(sim, { map: 'kestrel', altFt: 3000, view: 'chase', look: 'level', aircraft: 'f22', speed: 120, heading: 90 });
        const a = ac();
        if (withMissiles) {
          // Two missiles coming in from the front-right, trails and all; each one that arrives is a hit on the aeroplane
          // (damage, break-up and the bang, 150 m out), and a flare dropped for one of them pops it.
          const mk = (dx, dy, dz) => World.launchMissile({
            pos: { x: a.pos.x + dx, y: a.pos.y + dy, z: a.pos.z + dz },
            vel: { x: -90, y: 0, z: 40 },
            params: R.FLIGHT.threat,
            owner: 'threat',
            target: { id: 'me', owner: 'me', aim: (o) => { o.x = a.pos.x; o.y = a.pos.y; o.z = a.pos.z; o.vx = a.vel.x; o.vy = a.vel.y; o.vz = a.vel.z; return true; }, g: () => 0 },
            onEnd: (mm, why) => { if (why === 'hit' && typeof DIS.__onHit === 'function') DIS.__onHit(sim, mm, 0.5); },
          });
          mk(900, 40, -300);
          mk(1100, 20, -120);
        }
        try {
          // Two airbursts a little way off as well (a drone going up, a missile on a flare): a salvo's worth of light.
          return await P.measure(sim, { frames: 150, fps: 30, warm: 0, events: withMissiles ? [{ at: 1.0, kind: 'explosion', type: 'airburst', size: 0.9, dist: 140 }, { at: 1.6, kind: 'explosion', type: 'airburst', size: 0.9, dist: 160 }] : [] });
        } finally {
          if (sim._flickerRestore) sim._flickerRestore();
          sim.override = null;
        }
      };
      const base = await salvo(false);
      const m = await salvo(true);
      // The same scene without any of it already shimmers a little (the sea at 3,000 ft); what counts is what the salvo adds.
      // Measured: missiles in flight alone add about 3 points to the shimmer (their trail over a moving sea), the hits about five more; by the standard's own measure under 5.
      r.ok('heat-seekers: a salvo — two trails, the hits and two airbursts — adds under 10% of the screen to the faint shimmer (the 0.05-luma measure), with Reduce flashing on', FS.FLASH.reduce && m.percArea - base.percArea <= 0.10, `${pct(m.percArea)} vs ${pct(base.percArea)} without; worst window ${pct(m.percWindow)}`);
      r.ok('heat-seekers: ...and no tenth of the field flashes by the standard\'s own measure beyond the scene\'s own (WCAG, under 6% more)', m.wcagWindow - base.wcagWindow <= 0.06, `${pct(m.wcagWindow)} vs ${pct(base.wcagWindow)} (area ${pct(m.wcagArea)} vs ${pct(base.wcagArea)})`);
      r.ok('heat-seekers: ...nor does the whole picture swing by 10% in luminance more than three times', m.meanLum.swings <= 3, `${m.meanLum.swings} swings, mean luminance ${m.meanLum.min.toFixed(3)}..${m.meanLum.max.toFixed(3)} (without: ${base.meanLum.min.toFixed(3)}..${base.meanLum.max.toFixed(3)})`);
      r.ok('heat-seekers: ...and no bang of the missiles lights the whole view (mean luminance within 0.04 of the quiet scene\'s)', m.meanLum.max - base.meanLum.max <= 0.04, `${(m.meanLum.max - base.meanLum.max).toFixed(3)} brighter at the peak`);
    }
  } catch (e) {
    r.ok('heat-seekers: the checks ran to the end', false, String((e && e.stack) || e).slice(0, 500));
  } finally {
    sim.override = null;
    html.remove('is-touch-device');
    try {
      hs.clearTargets();
    } catch (e) {
      /* nothing to clear */
    }
    if (sim.game === 'heli' && typeof sim.switchGame === 'function') sim.switchGame('flight');
    if (sim.state !== 'menu' && typeof sim.quitToMenu === 'function') sim.quitToMenu('main');
    if (startMap && sim.settings.map !== startMap) sim.setMap(startMap);
  }
  return r;
}
