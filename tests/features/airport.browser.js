/**
 * Browser checks for the airfield and its ground crew.
 *
 *   const { check } = await import('./tests/features/airport.browser.js');
 *   const r = { checks: [], ok(n, p, d) { this.checks.push({ n, p: !!p, d }); } };
 *   await check(window.__sim, r, console.log); console.table(r.checks);
 *
 * What it drives: the world as built (draw calls, update cost), a jet bridge
 * docking to an aeroplane that stops on its stand and swinging back when it
 * leaves, the docking board counting an aeroplane in, and the whole
 * ground-crew round trip on the player's own aeroplane — park on a stand, Y
 * (or a tap on the prompt) for the crew, the fuel going in, Y for pushback,
 * and the aeroplane ending up off the stand and turned onto the apron, facing
 * the start of the runway the tower gives out, whatever the wind. Also: the
 * dev action does not park you on the traffic, the prompt keeps out of the way
 * of the pause screen and the hidden-HUD view and cannot be tapped under
 * them, and Y during a pushback stops it.
 *
 * Every import is dynamic and wrapped, so a missing module is a failed check
 * with its name on it, not a suite that will not load.
 */

async function load(path) {
  try {
    return await import(path);
  } catch (e) {
    return null;
  }
}

export async function check(sim, r, say = () => {}) {
  say('airport: the field');
  const AP = await load('../../src/world/airport.js');
  const LAY = await load('../../src/world/airport-layout.js');
  const EXT = await load('../../src/game/extensions.js');
  const SVC = await load('../../src/features/airport-services.js');
  const MIS = await load('../../src/game/missions.js');
  r.ok('airport: its modules load', !!(AP && LAY), AP ? '' : 'src/world/airport.js');
  if (!AP || !LAY) return r;

  if (sim.state !== 'flying' || sim.mode === 'drive' || !sim.mode) await sim.startMode('free');
  r.ok('airport: the airfield and the apron are built', !!(sim.airport && sim.apron));
  if (!sim.airport || !sim.apron) return r;

  const slots = AP.parkingSlots ? AP.parkingSlots() : [];
  r.ok(
    'airport: parkingSlots() offers free stands and hangars',
    slots.some((s) => s.kind === 'stand') && slots.some((s) => s.kind === 'hangar'),
    `${slots.length} slots: ${slots.map((s) => s.id).join(', ')}`
  );

  // Draw calls: 409 on Kestrel before this work (120 airport, 289 apron).
  let dc = 0;
  for (const g of [sim.airport.group, sim.apron.group]) {
    g.traverse((o) => {
      let vis = true;
      for (let q = o; q && q !== g.parent; q = q.parent) if (!q.visible) vis = false;
      if (vis && (o.isMesh || o.isPoints || o.isSprite)) dc++;
    });
  }
  r.ok('airport: the whole field is under 110 draw calls', dc <= 110, `${dc} draw calls`);

  // Per-frame cost of the field's own animation, in isolation.
  const w = sim.weather;
  /*
   * Warmed up first, and the best of three batches: the node suite's timed
   * loop failed at 148 ms against 40 on a machine at load average 300, which
   * measured the JIT and the neighbours rather than the code. The fastest
   * batch is the one nobody else interrupted.
   */
  for (let i = 0; i < 30; i++) {
    sim.airport.update(1 / 60, w);
    sim.apron.update(1 / 60, w);
  }
  let perFrame = Infinity;
  for (let b = 0; b < 3; b++) {
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) {
      sim.airport.update(1 / 60, w);
      sim.apron.update(1 / 60, w);
    }
    perFrame = Math.min(perFrame, (performance.now() - t0) / 100);
  }
  r.ok('airport: animating the field costs well under a millisecond a frame', perFrame < 0.5, `${perFrame.toFixed(3)} ms, best of 3 x 100 frames`);

  /* ---- a bridge docks to whoever stops on its stand ---- */
  say('airport: bridges');
  const lay = LAY.airportLayout();
  const bst = lay.stands.find((s) => s.bridge && !s.occupant);
  const bridge = bst && sim.apron.bridges && sim.apron.bridges.find((b) => b.st === bst);
  if (bridge) {
    sim.apron.setVisitors([{ id: 'test-visitor', typeId: 'meridian', x: bst.x, z: bst.z, headingDeg: bst.headingDeg }]);
    for (let i = 0; i < 12 * 30; i++) sim.apron.update(1 / 30, w);
    const docked = bridge.ext;
    sim.apron.setVisitors([]);
    for (let i = 0; i < 12 * 30; i++) sim.apron.update(1 / 30, w);
    r.ok('airport: a jet bridge swings out to an aeroplane on its stand and back when it leaves', docked > 0.99 && bridge.ext < 0.01, `out ${docked.toFixed(2)}, back ${bridge.ext.toFixed(2)}`);
  } else {
    r.ok('airport: a jet bridge swings out to an aeroplane on its stand', lay.bridges === false, 'no free bridge stand on this map');
  }

  /* ---- the ground crew and the pushback, on your own aeroplane ---- */
  if (!SVC || !EXT) {
    r.ok('airport: the ground-crew feature is loaded', false, 'src/features/airport-services.js');
    return r;
  }
  say('airport: ground crew');
  const S = SVC.__airportServices.S;
  const park = EXT.extDevActions().find((a) => a.ext === 'airport' && /free stand/i.test(a.label));
  r.ok('airport: the "park at a free stand" dev action is offered', !!park);
  if (!park) return r;

  /*
   * ---- and it does not park you on the traffic ----
   * It only looked at the airport's own parked aeroplanes and put you into
   * the tail of one of the traffic's. One made-up traffic aeroplane on the
   * stand it chose last time: it has to choose another, or, if no other
   * stand fits, leave you where you are.
   */
  {
    const THREE = await load('../../src/vendor/three.module.js');
    const APR = await load('../../src/world/apron.js');
    const ac = sim.aircraft;
    const hadOwn = Object.prototype.hasOwnProperty.call(sim, 'traffic');
    const was = sim.traffic;
    park.run(sim);
    sim.step(0.2);
    const st1 = LAY.standAt(ac.pos.x, ac.pos.z, 3);
    const type = sim.aircraftType && sim.aircraftType.id;
    const est = APR && APR.estimateInfo && type ? APR.estimateInfo(type) : null;
    const span = est ? est.halfSpan * 2 : 12;
    const others = LAY.airportLayout().stands.filter((s) => s !== st1 && !LAY.standTaken(s) && s.maxSpan + 0.5 >= span).length;
    let st2 = null;
    let err = '';
    try {
      if (THREE && st1) {
        sim.traffic = [{ id: 'airport-check', typeId: 'meridian', pos: new THREE.Vector3(st1.x, 0, st1.z), heading: st1.headingDeg, speed: 0, alt: 0, onGround: true, phase: 'parked' }];
        park.run(sim);
        sim.step(0.2);
        st2 = LAY.standAt(ac.pos.x, ac.pos.z, 3);
      }
    } catch (e) {
      err = String(e && e.message);
    } finally {
      try {
        if (hadOwn) sim.traffic = was;
        else delete sim.traffic;
      } catch (e) {
        /* a getter the traffic feature owns: nothing of ours to put back */
      }
    }
    // Let the next scan forget the made-up aeroplane.
    sim.step(0.6);
    r.ok(
      'airport: "park at a free stand" skips a stand the traffic is on',
      !!st1 && !err && (others > 0 ? !!st2 && st2 !== st1 : st2 === st1),
      `traffic on stand ${st1 && st1.number}; parked on ${st2 && st2.number}; ${others} other stand(s) fit${err ? '; ' + err : ''}`
    );
  }

  /* ---- the docking board talks an aeroplane in ---- */
  say('airport: docking board');
  const dst = lay.stands.find((s) => s.bridge && !s.occupant);
  if (dst && sim.apron.boards) {
    const ac = sim.aircraft;
    const THREE = await load('../../src/vendor/three.module.js');
    // Put the nose 8 m short of the mark, on the line, stopped.
    const info = SVC.__airportServices.playerInfo(sim);
    const reach = info ? -info.noseZ : 3;
    const F = lay.frame;
    const h = (dst.headingDeg * Math.PI) / 180;
    const nose = { x: F.x(dst.u), z: F.z(dst.noseW - LAY.NOSE_STOP - 8) };
    ac.reset({ pos: new THREE.Vector3(nose.x - Math.sin(h) * reach, 0, nose.z + Math.cos(h) * reach), headingDeg: dst.headingDeg, engineOn: false });
    sim.step(0.5);
    const d = S.dock;
    r.ok(
      'airport: the docking board counts the metres to the stop',
      d.stand === dst && Math.abs(d.toGo - 8) < 0.6 && sim.apron.dockMesh && sim.apron.dockMesh.visible && sim.apron.dockStand === dst,
      `stand ${d.stand && d.stand.number}, ${d.toGo && d.toGo.toFixed(2)} m, board ${sim.apron.dockMesh && sim.apron.dockMesh.visible}`
    );
    r.ok('airport: and so do the words under it — not "parked" yet', S.state === 'idle' && /8 m/.test(S.said), S.said.replace(/<[^>]+>/g, ''));
    // Now on the mark.
    ac.reset({ pos: new THREE.Vector3(nose.x - Math.sin(h) * reach, 0, F.z(dst.noseW - LAY.NOSE_STOP) + Math.cos(h) * reach), headingDeg: dst.headingDeg, engineOn: false });
    sim.step(1);
    r.ok('airport: on the mark the board says STOP and OK, and the crew is offered', sim.apron.dockKey >= 300000 && sim.apron.dockKey < 400000 && S.state === 'onStand',
      `board ${sim.apron.dockKey}, state ${S.state}`);
  } else {
    r.ok('airport: the docking board', lay.bridges === false, 'no free contact stand on this map');
  }

  /*
   * An air base keeps its own crews and has none spare for a visitor, so
   * there is nothing more to drive there: check it offers none, and stop.
   */
  if (!sim.apron.spare) {
    park.run(sim);
    sim.step(1.5);
    r.ok('airport: a field with no spare crew offers none, and nothing takes Y', S.state === 'idle' && !S.action, `state ${S.state}`);
    if (MIS && MIS.RUNWAY_START) sim.aircraft.reset({ ...MIS.RUNWAY_START, engineOn: true });
    sim.step(0.5);
    return r;
  }

  /* ---- the prompt keeps out of the way of the pause screen ---- */
  say('airport: prompt and pause');
  {
    park.run(sim);
    sim.step(1.5);
    const el = S.prompt;
    const vis = () => (el ? getComputedStyle(el).visibility : 'none');
    const pe = () => (el ? getComputedStyle(el).pointerEvents : 'none');
    const shown = S.state === 'onStand' && vis() === 'visible' && pe() === 'auto';
    const box = el ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    r.ok('airport: on a stand the prompt is up and tappable', shown, `state ${S.state}, ${vis()}, pointer-events ${pe()}`);
    /*
     * Nothing here hides it for the feature: the pause screen opening is what
     * has to. The observer on the menu layer answers before the next task;
     * the quarter-second timer behind it can be throttled to a second in a
     * hidden tab, so wait up to 1.5 s and say how long it took.
     */
    const tPause = performance.now();
    sim.pause();
    await new Promise((res) => setTimeout(res, 0));
    while (vis() !== 'hidden' && performance.now() - tPause < 1500) await new Promise((res) => setTimeout(res, 20));
    const hideMs = performance.now() - tPause;
    const hit = document.elementFromPoint(cx, cy);
    const under = !!(el && hit && (hit === el || el.contains(hit)));
    const menuHit = !!(hit && sim.menus && sim.menus.layer && sim.menus.layer.contains(hit));
    // Straight at the listener, the way a tap that slipped through would.
    if (el) el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    r.ok(
      'airport: paused, the prompt is hidden, is not what a tap there hits, and a tap on it calls nobody',
      sim.state === 'paused' && vis() === 'hidden' && pe() === 'none' && !under && S.state === 'onStand',
      `sim ${sim.state}, ${vis()} after ${hideMs.toFixed(0)} ms, pointer-events ${pe()}, ` +
        `hit ${hit ? hit.className || hit.tagName : 'nothing'}${menuHit ? ' (the pause screen)' : ''}, crew state ${S.state}`
    );
    sim.resume();
    sim.step(0.2);
    const back = vis() === 'visible' && S.state === 'onStand';
    if (typeof sim.toggleHideUi === 'function') {
      // U, and no frame stepped: the observer on the HUD has to see it.
      sim.toggleHideUi();
      await new Promise((res) => setTimeout(res, 0));
      const hidHud = vis() === 'hidden' && pe() === 'none';
      sim.toggleHideUi();
      sim.step(0.2);
      r.ok('airport: back from pause it returns, and with the HUD hidden (U) it hides', back && hidHud && vis() === 'visible', `after resume ${back}, HUD hidden ${hidHud}, HUD back ${vis()}`);
    } else {
      r.ok('airport: back from pause the prompt returns', back, vis());
    }
  }

  const W = sim.weather;
  const wind0 = W ? { dir: W.windDirDeg, kts: W.windSpeedKts, bdir: W.baseWindDirDeg, bkts: W.baseWindKts } : null;
  const setWind = (dir, kts) => {
    if (!W) return;
    W.windDirDeg = W.baseWindDirDeg = dir;
    W.windSpeedKts = W.baseWindKts = kts;
    W._targetDirDeg = dir;
    W._targetKts = kts;
  };
  const hdgWord = (h) => {
    const a = ((h % 360) + 360) % 360;
    return a >= 45 && a < 135 ? 'east' : a >= 135 && a < 225 ? 'south' : a >= 225 && a < 315 ? 'west' : 'north';
  };
  /*
   * The runway the ground controller gives out ("runway zero nine") as "09",
   * and the way you face to taxi to its start: 09 is flown east, so west.
   */
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const towerCall = (sim.atc && sim.atc.runwayCall) || 'zero nine';
  const towerRwy = towerCall.split(' ').map((w) => WORDS.indexOf(w)).join('');
  const towerFace = hdgWord(Number(towerRwy) * 10 + 180);

  /**
   * Park, call the crew, fuel, push back. `tag` names the aeroplane; `tap`
   * calls the crew with a tap on the prompt instead of Y, the way an iPad has
   * to. `wind` sets the wind first; whatever it is, the push ends facing the
   * start of the runway the tower names, because that is where ground sends
   * you. (It once picked 27 for a tailwind on 09 while ground said "runway
   * zero nine, taxi and hold".)
   */
  const roundTrip = (tag, tap = false, wind = null) => {
    const ac = sim.aircraft;
    if (wind) setWind(wind.dir, wind.kts);
    park.run(sim);
    sim.step(1.5);
    r.ok(`airport (${tag}): stopping on a stand offers the ground crew`, S.state === 'onStand', `state ${S.state}`);
    ac.fuel *= 0.4;
    const fuel0 = ac.fuel;
    if (tap && S.prompt) {
      const tappable = S.prompt.classList.contains('act') && getComputedStyle(S.prompt).pointerEvents === 'auto';
      S.prompt.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      r.ok(`airport (${tag}): a tap on the prompt calls the crew`, tappable && S.state === 'calling', `tappable ${tappable}, state ${S.state}`);
    } else {
      sim.key('KeyY', true);
      sim.key('KeyY', false);
      r.ok(`airport (${tag}): Y calls the crew`, S.state === 'calling', `state ${S.state}`);
    }
    let waited = 0;
    while (S.state === 'calling' && waited < 90) {
      sim.step(1);
      waited++;
    }
    r.ok(`airport (${tag}): the crew drives out and parks up round the aeroplane`, S.state === 'serviced', `state ${S.state} after ${waited} s`);
    sim.step(6);
    r.ok(`airport (${tag}): the bowser puts fuel in`, ac.fuel > fuel0 + 0.5, `${fuel0.toFixed(0)} -> ${ac.fuel.toFixed(0)}`);
    const light = !!(sim.apron.spare && sim.apron.spare.light);
    const p0 = ac.pos.clone();
    const h0 = ac.heading;
    sim.key('KeyY', true);
    sim.key('KeyY', false);
    r.ok(`airport (${tag}): Y again starts the pushback`, S.state === 'pushback', `state ${S.state}`);
    waited = 0;
    while (S.state === 'pushback' && waited < 120) {
      sim.step(1);
      waited++;
    }
    const moved = Math.hypot(ac.pos.x - p0.x, ac.pos.z - p0.z);
    const turned = Math.abs(((((ac.heading - h0) % 360) + 540) % 360) - 180);
    r.ok(
      `airport (${tag}): the tug pushes the aeroplane back and turns it onto the apron`,
      S.state === 'pushed' && moved > 15 && Math.abs(turned - 90) < 15 && !ac.crashed && ac.onGround,
      `${S.state}, moved ${moved.toFixed(0)} m, turned ${turned.toFixed(0)} deg in ${waited} s`
    );
    r.ok(`airport (${tag}): it ends up on made ground (apron or taxiway), not the grass`, LAY.onAirportPavement(ac.pos.x, ac.pos.z), `${ac.pos.x.toFixed(0)}, ${ac.pos.z.toFixed(0)}${S.push && S.push.toTaxiway ? ', turned on the taxiway' : ''}`);
    if (wind) {
      const P = S.push || {};
      // The runway's start, unless that end of the apron has no room to swing
      // (then the other way round, and the plan says so).
      const back = { east: 'west', west: 'east', north: 'south', south: 'north' };
      const want = P.flipped ? back[towerFace] : towerFace;
      r.ok(
        `airport (${tag}): with the wind from ${wind.dir} at ${wind.kts} kt it faces ${towerFace}, for runway ${towerRwy} as ground says`,
        P.faces === want && hdgWord(ac.heading) === want && P.runway === towerRwy,
        `faces ${P.faces} (heading ${Math.round(ac.heading)}), runway ${P.runway}, ground says "runway ${towerCall}"${P.flipped ? ', swung the other way for room' : ''}`
      );
    }
    return light;
  };

  const before = sim.aircraftType && sim.aircraftType.id;
  // A 15 kt westerly, 15 kt of tailwind on 09: ground still says 09.
  const firstLight = roundTrip(before || 'current', false, { dir: 270, kts: 15 });
  if (wind0) setWind(wind0.dir, wind0.kts);

  /*
   * ---- the push keeps clear of the traffic ----
   * The traffic parks in the middle of a stand's box (parkingSlots()), well
   * out from the terminal. Park the traffic on every other free stand, let
   * the feature's own scan read it from sim.traffic, and plan the push: no
   * point of your aeroplane — nose, tail, wingtips — comes within 1 m of
   * one of them at any point of it.
   */
  say('airport: pushback among the traffic');
  {
    const THREE = await load('../../src/vendor/three.module.js');
    const APR = await load('../../src/world/apron.js');
    const X = SVC.__airportServices;
    const ac = sim.aircraft;
    const hadOwn = Object.prototype.hasOwnProperty.call(sim, 'traffic');
    const was = sim.traffic;
    park.run(sim);
    sim.step(0.5);
    const mine = LAY.standAt(ac.pos.x, ac.pos.z, 3);
    const traffic = [];
    for (const sl of AP.parkingSlots()) {
      if (sl.kind !== 'stand' || (mine && sl.id === mine.id)) continue;
      const typeId = ['meridian', 'skylark'].find((id) => APR.estimateInfo(id).halfSpan * 2 <= sl.maxSpan);
      if (typeId) traffic.push({ id: `check-${sl.id}`, typeId, pos: new THREE.Vector3(sl.x, sl.y, sl.z), heading: sl.headingDeg, speed: 0, alt: 0, onGround: true, phase: 'parked' });
    }
    let detail = '';
    let pass = false;
    try {
      sim.traffic = traffic;
      X.scan(sim);
      X.S.info = X.playerInfo(sim);
      const P = X.planPush(sim);
      const info = X.S.info;
      const pose = {};
      let worst = Infinity;
      for (let s = 0; s <= P.total + 0.01; s += 1) {
        X.pushPose(P, Math.min(s, P.total), pose);
        const h = (pose.h * Math.PI) / 180;
        const fx = Math.sin(h);
        const fz = -Math.cos(h);
        const rx = Math.cos(h);
        const rz = Math.sin(h);
        const pts = [
          [0, info.noseZ],
          [0, info.tailZ],
          [-info.halfSpan, info.wingTipZ || 0],
          [info.halfSpan, info.wingTipZ || 0],
        ].map(([mx, mz]) => ({ x: pose.x + rx * mx - fx * mz, z: pose.z + rz * mx - fz * mz }));
        for (const t of traffic) {
          const ti = APR.estimateInfo(t.typeId);
          const th = (t.heading * Math.PI) / 180;
          for (const p of pts) {
            const dx = p.x - t.pos.x;
            const dz = p.z - t.pos.z;
            const lx = dx * Math.cos(th) + dz * Math.sin(th);
            const lz = -(dx * Math.sin(th) - dz * Math.cos(th));
            // How far outside that aeroplane's box the point is (negative: inside).
            const out = Math.max(Math.abs(lx) - ti.halfSpan, ti.noseZ - lz, lz - ti.tailZ);
            worst = Math.min(worst, out);
          }
        }
      }
      pass = traffic.length > 0 && X.S.busy.size === traffic.length && worst >= 1;
      detail = `${traffic.length} traffic aeroplanes read (${X.S.busy.size} stands busy); closest pass ${worst.toFixed(1)} m; ` +
        `faces ${P.faces}${P.toTaxiway ? ', turned on the taxiway' : ''}${P.flipped ? ', swung the other way' : ''}${P.clear ? '' : ', NO clear way'}`;
    } catch (e) {
      detail = String(e && e.message);
    } finally {
      try {
        if (hadOwn) sim.traffic = was;
        else delete sim.traffic;
      } catch (e) {
        /* a getter the traffic feature owns */
      }
      X.S.info = null;
      X.scan(sim);
    }
    r.ok('airport: the pushback keeps 1 m clear of traffic parked on the other stands', pass, detail);
  }

  /* ---- Y during the pushback stops it ---- */
  say('airport: stopping a pushback');
  {
    const ac = sim.aircraft;
    park.run(sim);
    sim.step(1.5);
    sim.key('KeyY', true);
    sim.key('KeyY', false);
    let waited = 0;
    while (S.state === 'calling' && waited < 90) {
      sim.step(1);
      waited++;
    }
    sim.key('KeyY', true);
    sim.key('KeyY', false);
    const pushing = S.state === 'pushback';
    sim.step(3);
    const p1 = ac.pos.clone();
    sim.key('KeyY', true);
    sim.key('KeyY', false);
    const stoppedState = S.state;
    sim.step(2);
    const drift = Math.hypot(ac.pos.x - p1.x, ac.pos.z - p1.z);
    const tugGone = !(sim.apron.spare && sim.apron.spare.state !== 'away');
    r.ok(
      'airport: Y during the pushback stops it where it is and sends the tug away',
      pushing && stoppedState === 'pushed' && drift < 0.3 && tugGone && !ac.crashed,
      `pushing ${pushing}, then ${stoppedState}, moved ${drift.toFixed(2)} m after, crew ${sim.apron.spare && sim.apron.spare.state}`
    );
  }
  /*
   * And once with an airliner, which gets the whole crew — stairs, catering,
   * belt loader and baggage — where a light aeroplane gets fuel, power and
   * the tug only.
   */
  if (typeof sim.setAircraft === 'function' && before !== 'meridian') {
    sim.setAircraft('meridian');
    // The default easterly.
    const light = roundTrip('meridian', true, { dir: 90, kts: 8 });
    r.ok('airport: an airliner gets the full crew', light === false, `meridian: ${light ? 'small crew' : 'full crew'}; ${before}: ${firstLight ? 'small crew' : 'full crew'}`);
    if (before) sim.setAircraft(before);
  }

  // Put everything back where the next check expects it.
  if (wind0 && W) {
    setWind(wind0.dir, wind0.kts);
    W.baseWindDirDeg = wind0.bdir;
    W.baseWindKts = wind0.bkts;
  }
  if (MIS && MIS.RUNWAY_START) sim.aircraft.reset({ ...MIS.RUNWAY_START, engineOn: true });
  sim.step(0.5);
  return r;
}

export default check;
