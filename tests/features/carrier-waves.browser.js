/**
 * Browser checks for the moving sea and the carrier under way
 * (src/world/sea-state.js, src/world/carrier-underway.js), in the real game.
 *
 *   - the sea: the swell is attached at this tier, the surface the GPU draws
 *     is the height the CPU answers (measured by lowering a camera onto it),
 *     it is calm in clear weather and rough in a storm, and flat at the beach
 *   - the ship: she steams over a minute, heaves and rolls a little, and a
 *     jet parked on the catapult stays exactly where it is on the deck, with
 *     the wind over the deck on its airspeed
 *   - the catapult launches off the moving deck and the jet flies away
 *   - a trap on the moving deck catches a wire and stays on the ship
 *   - joining the deck's frame from the air changes nothing the jet feels
 *   - through a turn the jet, the deck, the island and the missions' "on the
 *     deck" all turn with the ship
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export const id = 'carrier-waves';

export async function check(sim, r, say) {
  const THREE = await import('../../src/vendor/three.module.js');
  const T = await import('../../src/world/terrain.js');
  const SEA = await import('../../src/world/sea-state.js');
  const UW = await import('../../src/world/carrier-underway.js');
  const MS = await import('../../src/game/missions.js');
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const KT = 1.94384;
  const D2R = Math.PI / 180;
  const wx = (condition, kts) => ({ time: 'day', condition, windSpeedKts: kts, windDirDeg: 0, loadingScreen: false });
  const c = () => sim.carrier;
  /** The aeroplane in the ship's own coordinates: metres to starboard and aft of her middle, and over the deck. */
  const onShip = (ac) => {
    const w = c().way;
    const h = w.pose.headingDeg * D2R;
    const dx = ac.pos.x - w.pose.x;
    const dz = ac.pos.z - w.pose.z;
    const over = w.platform.at(ac.pos.x, ac.pos.z);
    return { lx: dx * Math.cos(h) + dz * Math.sin(h), lz: -dx * Math.sin(h) + dz * Math.cos(h), over, y: over ? ac.pos.y - w.platform.y : NaN };
  };
  const angle = (a, b) => ((a - b + 540) % 360) - 180;

  try {
    /* ---------------- the sea ---------------- */
    await sim.startMode('free', { ...wx('clear', 4), aircraft: 'fa18', startAt: 'carrier', airborne: false });
    sim.step(1);
    const ocean = sim.ocean;
    const sea = ocean && ocean.sea;
    const tier = sim.qualityBuilt;
    r.ok('sea: the swell is attached to the ocean', !!sea && typeof ocean.waveAt === 'function' && T.SWELL.at != null);
    if (!sea) return;
    const wantN = tier === 'low' ? 2 : tier === 'medium' ? 4 : 6;
    const verts = ocean.deep.geometry.attributes.position.count;
    r.ok(`sea: ${wantN} swells and a fine grid at ${tier}`, sea.comps.length === wantN && ocean.deepMat.defines.SWELL_N === wantN && verts > 4000 && verts < 80000, `${sea.comps.length} swells, ${verts} vertices`);
    sim.step(30);
    const calm = { s: sea.s, hs: sea.hs };
    r.ok('sea: calm in clear weather with a light breeze', calm.hs > 0.15 && calm.hs < 0.6, `sea state ${calm.s.toFixed(2)}, ${calm.hs.toFixed(2)} m significant height`);

    await sim.startMode('free', { ...wx('stormy', 26), aircraft: 'fa18', startAt: 'carrier', airborne: false });
    sim.step(45);
    r.ok('sea: rough in a storm', sea.hs > calm.hs * 3 && sea.hs > 1.4 && sea.hs < 3, `sea state ${sea.s.toFixed(2)}, ${sea.hs.toFixed(2)} m`);
    let peak = 0;
    for (let i = 0; i < 400; i++) peak = Math.max(peak, Math.abs(T.swellAt(c().pos.x + 900 + i * 7, c().pos.z + i * 3)));
    r.ok('sea: the swell is there to ask, and never a wall', peak > 0.5 && peak <= sea.peak + 1e-6 && sea.peak < 2.6, `${peak.toFixed(2)} m of ${sea.peak.toFixed(2)} m at most`);

    /*
     * What is drawn is what is answered. Only the sea is drawn, on magenta,
     * and a camera looking straight down is lowered until the surface is no
     * longer under it: that height is the GPU's sea at that point.
     */
    {
      const scene = sim.scene;
      const hidden = [];
      for (const o of scene.children) if (o !== ocean.group && o.visible) { o.visible = false; hidden.push(o); }
      for (const o of ocean.group.children) if (o !== ocean.deep && o.visible) { o.visible = false; hidden.push(o); }
      const bg = scene.background;
      const fog = scene.fog;
      scene.background = new THREE.Color(1, 0, 1);
      scene.fog = null;
      const cam = new THREE.PerspectiveCamera(8, 1, 0.01, 60);
      const gl = sim.renderer.getContext();
      const px = new Uint8Array(4);
      const seen = (x, y, z) => {
        cam.position.set(x, y, z);
        cam.up.set(0, 0, -1);
        cam.lookAt(x, y - 10, z);
        cam.updateMatrixWorld(true);
        sim.renderer.setRenderTarget(null);
        sim.renderer.render(scene, cam);
        gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return !(px[0] > 200 && px[1] < 60 && px[2] > 200);
      };
      const d = SEA.GRID[tier].d;
      const gx = ocean.deep.position.x;
      const gz = ocean.deep.position.z;
      let worst = 0;
      let span = 0;
      const rows = [];
      let drawn = true;
      for (const [i, j] of [[3, 2], [-6, 9], [11, -4], [-9, -12], [17, 6], [2, -15]]) {
        // On a grid vertex, clear of the hull, inside the fine square.
        const x = gx + 260 + i * d;
        const z = gz + j * d;
        if (!seen(x, 4, z)) drawn = false;
        let lo = -4;
        let hi = 4;
        for (let k = 0; k < 14; k++) {
          const m = (lo + hi) / 2;
          if (seen(x, m, z)) hi = m;
          else lo = m;
        }
        const gpu = (lo + hi) / 2;
        const cpu = T.swellAt(x, z);
        worst = Math.max(worst, Math.abs(gpu - cpu));
        span = Math.max(span, Math.abs(gpu));
        rows.push(`${gpu.toFixed(2)}/${cpu.toFixed(2)}`);
      }
      // And where the swell is shoaling: off the island's shore, where the depth field takes part of it away.
      let shoal = null;
      {
        const isl = T.ISLANDS[0];
        for (let rr = isl.radius * 0.5; rr < isl.radius * 2.2 && !shoal; rr += d) {
          const x = Math.round((isl.cx + rr) / d) * d;
          const z = Math.round(isl.cz / d) * d;
          const k = SEA.shoreFactor(sea, x, z);
          if (k > 0.3 && k < 0.8 && T.groundHeightAt(x, z) < -3 && Math.abs(T.swellAt(x, z)) > 0.1) shoal = { x, z, k };
        }
        if (shoal) {
          ocean.follow(shoal);
          ocean.deep.updateMatrixWorld(true);
          let lo = -4;
          let hi = 4;
          for (let k = 0; k < 14; k++) {
            const m = (lo + hi) / 2;
            if (seen(shoal.x, m, shoal.z)) hi = m;
            else lo = m;
          }
          shoal.gpu = (lo + hi) / 2;
          shoal.cpu = T.swellAt(shoal.x, shoal.z);
          ocean.follow(sim.aircraft.pos);
        }
      }
      scene.background = bg;
      scene.fog = fog;
      for (const o of hidden) o.visible = true;
      r.ok('sea: shoaling toward the shore, drawn and answered still agree (within 4 cm)', !!shoal && Math.abs(shoal.gpu - shoal.cpu) < 0.04, shoal ? `${shoal.gpu.toFixed(2)}/${shoal.cpu.toFixed(2)} m where ${(shoal.k * 100).toFixed(0)}% of the swell is left` : 'no shoaling point found');
      r.ok('sea: the surface is drawn', drawn);
      r.ok('sea: the drawn surface is displaced', span > 0.3, `${span.toFixed(2)} m at one of six points`);
      r.ok('sea: the GPU surface is the height the CPU answers (within 3 cm)', worst < 0.03, `drawn/answered ${rows.join(' ')}`);
    }
    // The beach: no swell where the water is a metre deep.
    {
      const isl = T.ISLANDS[0];
      let lo = isl.radius * 0.2;
      let hi = isl.radius * 1.9;
      for (let k = 0; k < 24; k++) {
        const m = (lo + hi) / 2;
        if (T.groundHeightAt(isl.cx + m, isl.cz) > 0) lo = m;
        else hi = m;
      }
      let beach = 0;
      for (let t = 0; t < 40; t++) beach = Math.max(beach, Math.abs(SEA.waveHeightAt(sea, isl.cx + hi + 2, isl.cz, t * 0.7)));
      r.ok('sea: flat at the waterline, so the beach and the surf stay put', beach < 0.12, `${beach.toFixed(3)} m at the shore in a storm`);
    }

    /* ---------------- the ship under way ---------------- */
    await sim.startMode('free', { ...wx('clear', 6), aircraft: 'fa18', startAt: 'carrier', airborne: false });
    sim.step(1);
    let ac = sim.aircraft;
    const way = c().way;
    r.ok('ship: she has a track to steam', !!way && !!way.track && way.track.length > 6000, way && way.track ? `${way.track.leg} m legs, ${way.track.radius} m turns` : 'holding station');
    if (!way || !way.track) return;
    const p0 = { x: c().pos.x, z: c().pos.z };
    const a0 = onShip(ac);
    let heave = 0;
    let roll = 0;
    let pitch = 0;
    for (let i = 0; i < 60; i++) {
      sim.step(1);
      heave = Math.max(heave, Math.abs(way.heave));
      roll = Math.max(roll, Math.abs(way.roll));
      pitch = Math.max(pitch, Math.abs(way.pitch));
    }
    const moved = Math.hypot(c().pos.x - p0.x, c().pos.z - p0.z);
    r.ok('ship: she moves over a minute, at about 14 knots', moved > 380 && moved < 480, `${moved.toFixed(0)} m in 60 s, ${((moved / 60) * KT).toFixed(1)} kt`);
    r.ok('ship: the picture, the deck and the far ship are in the same place', Math.hypot(c().group.position.x - c().pos.x, c().group.position.z - c().pos.z) < 1.5 && way.platform.cx === c().pos.x && way.platform.cz === c().pos.z);
    r.ok('ship: she floats — a little heave, roll and pitch, and only a little', heave > 0.005 && heave < 1.2 && roll > 0.0001 && roll < 0.6 * D2R + 1e-9 && pitch < 0.25 * D2R + 1e-9, `heave ${heave.toFixed(2)} m, roll ${(roll / D2R).toFixed(2)}°, pitch ${(pitch / D2R).toFixed(3)}°`);
    const a1 = onShip(ac);
    const drift = Math.hypot(a1.lx - a0.lx, a1.lz - a0.lz);
    r.ok('deck: a jet parked on the catapult stays where it is on the deck', drift < 0.05 && a1.over && ac.onGround && !ac.crashed, `${drift.toFixed(3)} m of drift in a minute, ${a1.y.toFixed(2)} m over the deck`);
    r.ok('deck: stopped on the deck is stopped (speed is the deck\'s)', ac.groundSpeed < 0.3, `${ac.groundSpeed.toFixed(2)} m/s`);
    const iasKt = ac.ias * KT;
    r.ok('deck: the wind over the deck is on the airspeed (the wind and the ship\'s 14 kt)', iasKt > 15 && iasKt < 25, `${iasKt.toFixed(1)} kt`);
    r.ok('deck: the missions agree the jet is on the deck', MS.onCarrierDeck({ sim, ac }) === true);
    const f = sim.carrierOps.frame;
    r.ok('deck: carrier ops\' frame is the ship\'s', Math.abs(f.cx - c().pos.x) < 1e-6 && Math.abs(f.cz - c().pos.z) < 1e-6 && Math.abs(angle(f.headingDeg, c().headingDeg)) < 1e-6);
    const gearShip = sim.carrierOps.state.gear && sim.carrierOps.state.gear.ship;
    if (gearShip) {
      gearShip.updateMatrixWorld(true);
      const lens = sim.carrierOps.state.gear.lens.group.getWorldPosition(new THREE.Vector3());
      const spot = sim.carrierOps.deck.lensSpot(f).world;
      r.ok('deck: the lens and the wires ride with her', Math.hypot(lens.x - spot.x, lens.z - spot.z) < 1.5, `${Math.hypot(lens.x - spot.x, lens.z - spot.z).toFixed(2)} m off`);
    }

    /* ---------------- the catapult ---------------- */
    sim.override = { pitch: 0, roll: 0, yaw: 0, throttle: 1 };
    sim.step(2.5);
    const saluted = sim.carrierOps.salute();
    let leftAt = null;
    let jump = 0;
    let last = ac.ias;
    for (let i = 0; i < 60 * 14 && !ac.crashed; i++) {
      const was = ac._onShip;
      sim.step(1 / 60, 1 / 60);
      if (was && !ac._onShip && leftAt == null) {
        leftAt = i;
        jump = Math.abs(ac.ias - last);
      }
      last = ac.ias;
    }
    const shot = sim.carrierOps.lastShot;
    r.ok('catapult: salute fires it from the moving deck', saluted && !!shot, shot ? `${shot.vEndKts} kt in ${shot.seconds} s` : sim.carrierOps.mode);
    r.ok('catapult: the jet flies off the bow and away', !ac.crashed && !ac.onGround && leftAt != null && ac.pos.y > c().deckY + 3 && ac.ias * KT > 150 && !onShip(ac).over && !ac._onShip && !ac.ride, `${(ac.pos.y - c().deckY).toFixed(0)} m over the deck at ${(ac.ias * KT).toFixed(0)} kt`);
    r.ok('catapult: leaving the deck\'s frame is not felt (airspeed carries straight on)', leftAt != null && jump * KT < 1.5, `${(jump * KT).toFixed(2)} kt step`);
    sim.override = null;

    /* ---------------- joining the frame from the air ---------------- */
    await sim.startMode('free', { ...wx('clear', 0), aircraft: 'osprey' });
    ac = sim.aircraft;
    {
      const DK = sim.carrierOps.deck;
      const fr = sim.carrierOps.frame;
      sim.step(0.2);
      const st = DK.atStation(fr, DK.rampS(fr) - 420, 0);
      ac.reset({ pos: new THREE.Vector3(st.x, 0, st.z), headingDeg: fr.landingHeadingDeg, speed: 78, gearDown: true });
      ac.pos.y = c().deckY + 30;
      sim.override = { pitch: 0, roll: 0, yaw: 0, throttle: 0.75 };
      let enter = null;
      let prevIas = ac.ias;
      let prevV = Math.hypot(ac.vel.x, ac.vel.z);
      for (let i = 0; i < 60 * 9 && !ac.crashed && !enter; i++) {
        const was = !!ac._onShip;
        sim.step(1 / 60, 1 / 60);
        if (!was && ac._onShip) enter = { dIas: Math.abs(ac.ias - prevIas) * KT, dV: prevV - Math.hypot(ac.vel.x, ac.vel.z) };
        prevIas = ac.ias;
        prevV = Math.hypot(ac.vel.x, ac.vel.z);
      }
      r.ok('frame: a jet crossing the ramp joins the deck\'s frame', !!enter && !ac.crashed, enter ? '' : `never joined, ${(ac.pos.y - c().deckY).toFixed(0)} m over the deck`);
      if (enter) {
        r.ok('frame: its speed is then counted against the deck (about 14 kt less)', enter.dV > 5 && enter.dV < 9, `${enter.dV.toFixed(2)} m/s`);
        r.ok('frame: and the jet feels nothing — airspeed carries straight on', enter.dIas < 1.5, `${enter.dIas.toFixed(2)} kt step`);
      }
    }

    /* ---------------- a trap on the moving deck ---------------- */
    {
      const DK = sim.carrierOps.deck;
      const fr = sim.carrierOps.frame;
      const wires = DK.wires(fr);
      // Far enough back that the jet has finished floating in ground effect and the hook is on the steel at the wires.
      const st = DK.atStation(fr, wires[0].s - 190, 0);
      ac.reset({ pos: new THREE.Vector3(st.x, 0, st.z), headingDeg: fr.landingHeadingDeg, speed: 62, gearDown: true });
      ac.pos.y = c().deckY + 6;
      ac.vel.y = -3.2;
      sim.carrierOps.hookNow();
      const before = sim.carrierOps.lastTrap;
      const shipAt = { x: c().pos.x, z: c().pos.z };
      for (let i = 0; i < 2400 && !ac.crashed; i++) {
        sim.override = { pitch: 0, roll: 0, yaw: 0 };
        sim.step(1 / 60, 1 / 60);
        if (ac.onGround && ac.groundSpeed < 2 && ac.groundTime > 1.2 && sim.carrierOps.lastTrap !== before) break;
        if (ac.onGround && ac.groundTime > 0.15) sim.input.throttleTarget = 0;
      }
      const trap = sim.carrierOps.lastTrap;
      r.ok('trap: a wire catches the jet on the moving deck', !!trap && trap !== before && !ac.crashed, trap && trap !== before ? `${trap.wire}-wire from ${trap.v0Kts} kt, stopped in ${trap.stopM} m` : `${sim.carrierOps.mode}${ac.crashed ? ': ' + ac.crashReason : ''}`);
      r.ok('trap: the catch is at the closing speed, not the speed over the sea', !!trap && trap.v0Kts > 100 && trap.v0Kts < 126, trap ? `${trap.v0Kts} kt` : '');
      const h0 = onShip(ac);
      // Brakes on. At idle this jet still creeps 0.3 m/s against them — on the moored ship of v80 too
      // (measured side by side) — so "stays" is within a few metres here; the catapult check is the exact one.
      sim.override = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 1 };
      sim.step(25);
      const h1 = onShip(ac);
      const went = Math.hypot(c().pos.x - shipAt.x, c().pos.z - shipAt.z);
      r.ok('trap: it stays on the ship as she steams on', h1.over && !ac.crashed && Math.abs(h1.y) < 4 && Math.hypot(h1.lx - h0.lx, h1.lz - h0.lz) < 12 && went > 150, `${Math.hypot(h1.lx - h0.lx, h1.lz - h0.lz).toFixed(2)} m across the deck while the ship went ${went.toFixed(0)} m`);
      sim.override = null;
    }

    /* ---------------- through a turn ---------------- */
    await sim.startMode('free', { ...wx('clear', 6), aircraft: 'fa18', startAt: 'carrier', airborne: false });
    sim.step(1);
    ac = sim.aircraft;
    {
      const w = c().way;
      const b0 = onShip(ac);
      // Put her at the start of the north turn: everything on her goes too.
      w.s = w.track.leg - 5;
      sim.step(1);
      const b1 = onShip(ac);
      r.ok('turn: moved bodily round her track, the jet goes with her', Math.hypot(b1.lx - b0.lx, b1.lz - b0.lz) < 0.2 && b1.over && !ac.crashed, `${Math.hypot(b1.lx - b0.lx, b1.lz - b0.lz).toFixed(3)} m`);
      const hd0 = c().headingDeg;
      const rel0 = angle(ac.heading, hd0);
      sim.step(90);
      const turned = Math.abs(angle(c().headingDeg, hd0));
      const b2 = onShip(ac);
      r.ok('turn: she comes round gently', turned > 10 && turned < 30, `${turned.toFixed(1)}° in 90 s`);
      r.ok('turn: the parked jet turns with the deck and does not slide', Math.hypot(b2.lx - b1.lx, b2.lz - b1.lz) < 0.1 && Math.abs(angle(angle(ac.heading, c().headingDeg), rel0)) < 0.3 && ac.onGround && !ac.crashed, `${Math.hypot(b2.lx - b1.lx, b2.lz - b1.lz).toFixed(3)} m, ${angle(angle(ac.heading, c().headingDeg), rel0).toFixed(2)}°`);
      // The deck's corners and the island, in her own frame, are where the tests say.
      const h = c().headingDeg * D2R;
      const at = (lx, lz) => ({ x: c().pos.x + lx * Math.cos(h) - lz * Math.sin(h), z: c().pos.z + lx * Math.sin(h) + lz * Math.cos(h) });
      const bow = at(0, -c().halfDepth + 20);
      const offBow = at(0, -c().halfDepth - 30);
      const corner = at(c().halfWidth - 10, c().halfDepth - 10);
      r.ok('turn: the landing surface is the turned deck', !!T.platformAt(bow.x, bow.z) && !T.platformAt(offBow.x, offBow.z) && !!T.platformAt(corner.x, corner.z) && T.heightAt(bow.x, bow.z) > c().deckY - 3);
      const isl = at(24.4 * 5, 23 * 5);
      r.ok('turn: the island is solid where the island is', !!T.obstacleAt(isl.x, c().deckY + 30, isl.z) && !T.obstacleAt(bow.x, c().deckY + 30, bow.z));
      r.ok('turn: the minimap\'s hull points the way she is heading', Math.abs(w.platform.yaw - h) < 1e-9);
      // And the track itself: every point of it is deep water clear of the approach lanes.
      const B = await import('../../src/world/carrier-berth.js');
      const ok = UW.checkTrack(w.track, { height: T.groundHeightAt, lanes: B.runwayLanes(T.AIRPORT), field: { x: T.AIRPORT.runway.cx, z: T.AIRPORT.runway.cz }, halfWidth: c().halfWidth, halfLength: c().halfDepth, step: 60 });
      r.ok('track: the whole racetrack is deep water, clear of land and the approach lanes', ok != null && ok < -12, ok == null ? 'aground or in a lane' : `shallowest ${ok.toFixed(0)} m`);
    }
  } finally {
    sim.override = null;
    sim.autoPauseOnHide = origAuto;
    if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu('main');
  }
}
