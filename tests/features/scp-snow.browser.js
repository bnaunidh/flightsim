/**
 * Browser checks for the snow lane: Nunatak Reach, the ice, the Site and the
 * Class-D transfer, in the real game (the node side is scp-snow.mjs).
 *
 *   - the mission starts on the snow map, in the C-17 (the owner, 2026-10-25:
 *     "Class-D transfer -> C-17"), on a stand at the base with room for its
 *     wing, nose in to the buildings, with the Site built and solid, snow in
 *     the air, and six people walking out of the van
 *   - with the ramp up they wait at its foot; the ramp key lowers it and they
 *     walk up it into the hold one at a time (up on the cargo floor), and the
 *     loadmaster raises it behind them
 *   - THE PUSHBACK on the FOB's stand, on snow: P calls the ground crew (the
 *     tug, the power cart and the bowser — no airliner's catering on a
 *     military apron), P again pushes; the tug works on the snow and ice,
 *     the push misses the van and the de-icing truck by metres, ends facing
 *     the start of runway 09, and nothing slides afterwards
 *   - the taxi to runway 09 by the nearest taxiway (the long way, along
 *     taxiway A, passes the hangar two metres off the C-17's wing tip),
 *     driven on the real ground model, lined up; then the take-off and the
 *     crossing (placed)
 *   - the real flight model lands the C-17 on the ice: a touchdown at 54 m/s
 *     with the brakes and the reversers rolls a long way (ice grip) and stops
 *     on the strip, the HUD says braking action poor, and the landing step
 *     completes inside the strip's box
 *   - stopped on the T, clear of the fence, the ramp comes down and they walk
 *     out of the hold, down it, and to the blast door; the mission completes
 *     with a score, and the map you had chosen comes back
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export const id = 'scp-snow';

const D2R = Math.PI / 180;
const angleDiff = (a, b) => ((((a - b) % 360) + 540) % 360) - 180;

export async function check(sim, r, say = () => {}) {
  let THREE;
  let T;
  let Site;
  let Scp;
  let AS;
  let Ramp;
  let Lay;
  let Airport;
  try {
    THREE = await import('../../src/vendor/three.module.js');
    T = await import('../../src/world/terrain.js');
    Site = await import('../../src/features/scp-site.js');
    Scp = await import('../../src/game/extra/scp.js');
    AS = await import('../../src/features/airport-services.js');
    Ramp = await import('../../src/features/cargo-ramp.js');
    Lay = await import('../../src/world/airport-layout.js');
    Airport = await import('../../src/world/airport.js');
  } catch (err) {
    r.ok('scp-snow: the modules load', false, String(err && err.message));
    return;
  }
  void Scp;
  const origAuto = sim.autoPauseOnHide;
  const origMap = sim.settings.map;
  sim.autoPauseOnHide = false;
  const stepId = () => (sim.runner && sim.runner.step ? sim.runner.step.id : null);
  const toasts = [];
  const origNotify = sim.hud.notify.bind(sim.hud);
  sim.hud.notify = (text, kind, dur) => {
    toasts.push(String(text));
    return origNotify(text, kind, dur);
  };
  const frames = (seconds, each = null) => {
    for (let i = 0; i < Math.round(seconds * 30); i++) {
      sim.update(1 / 30);
      if (each && each(i) === true) return true;
    }
    return false;
  };

  try {
    say('scp-snow: start the transfer');
    await sim.startMode('mission', { id: 'classd-transfer' });
    const ac = sim.aircraft;
    const map = T.MAP;
    const st = Site.transferStand();
    r.ok('the transfer starts on Nunatak Reach in the C-17, on the ground', map.id === 'nunatak' && sim.aircraftType.id === 'c17' && ac.onGround && !ac.crashed,
      `${map.id}, ${sim.aircraftType.id}, onGround ${ac.onGround}`);
    r.ok('…on the base\'s levelled airfield, not on a runway', T.padWeight(ac.pos.x, ac.pos.z) > 0.9 && !T.isOnAnyRunway(ac.pos.x, ac.pos.z, 5), `${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)}`);
    r.ok('…on its stand, facing the buildings the way the stand does', !!st && Math.hypot(ac.pos.x - st.x, ac.pos.z - st.z) < 3 && Math.abs(angleDiff(ac.heading, st.headingDeg)) < 2,
      st ? `stand ${st.number}, heading ${ac.heading.toFixed(1)} (stand ${st.headingDeg})` : 'no stand');
    {
      // The same stand at every detail level: Low draws none of the parked jets (the layout's `undrawn`), and the
      // transfer once started on stand 1 there, 26 m the wrong side of taxiway A2 (checker, 2026-10-26).
      const L = Lay.airportLayout();
      const was = new Set(L.undrawn);
      const parked = L.stands.map((s) => s.parked);
      for (const s of L.stands) if (s.occupant) {
        L.undrawn.add(s);
        s.parked = null;
      }
      const lowSt = Site.transferStand();
      L.undrawn.clear();
      for (const s of was) L.undrawn.add(s);
      L.stands.forEach((s, i) => (s.parked = parked[i]));
      r.ok('…the same stand whatever the detail level drew (none of the parked jets on Low)', !!lowSt && !!st && lowSt.number === st.number && Site.transferStand().number === st.number,
        `${st && st.number} drawn, ${lowSt && lowSt.number} with none drawn`);
    }
    const info = Site.siteInfo();
    r.ok('the Site is built: four towers, three buildings, the fence', !!info && info.towers.length === 4 && info.buildings.length === 3 && info.obstacles >= 12, info ? `${info.obstacles} solids` : 'no site');
    r.ok('the blast door is shut and solid; the main block has no inside', !!T.obstacleAt(map.scp.door.x, info.doorY + 3, map.scp.door.z - 2) && !!T.obstacleAt(map.scp.door.x, info.doorY + 6, map.scp.door.z - 17));
    frames(1.5);
    r.ok('snow is falling (the precipitation is in snow mode and drawn)', sim.rain && sim.rain.kind === 'snow' && sim.rain.mesh.visible, sim.rain ? `${sim.rain.kind}, visible ${sim.rain.mesh.visible}` : 'no rain');
    r.ok('the first step is board', stepId() === 'board', stepId());
    const walk = Site.transferState();
    r.ok('six people are walking out of the van: two escort, four Class-D', !!walk && walk.people.length === 6 && walk.people.filter((p) => p.kind === 'classd').length === 4,
      walk ? walk.people.map((p) => p.kind).join(' ') : 'nobody');

    /* ---- the ramp and the boarding ---- */
    say('scp-snow: board up the ramp');
    const ramp0 = Site.rampOf(sim);
    r.ok('the C-17 has its cargo ramp, up, behind the tail', !!ramp0 && ramp0.amount < 0.05 && Math.hypot(ramp0.foot.x - ac.pos.x, ramp0.foot.z - ac.pos.z) > 15, ramp0 ? `foot ${Math.hypot(ramp0.foot.x - ac.pos.x, ramp0.foot.z - ac.pos.z).toFixed(1)} m behind` : 'no ramp');
    // An impatient pilot: P straight away. The crew comes out; the tug will not push until they are aboard.
    const svc = () => AS.servicesState();
    frames(1);
    r.ok('stopped on the stand, the ground crew is offered (an air base has a crew for a visitor now)', !!sim.apron.spare && svc().state === 'onStand' && svc().stand === st.number, `${svc().state}, stand ${svc().stand}`);
    {
      // On a phone held upright the prompt goes under the mission's objective, not over the step it says
      // (it sat at a fixed 168 px; the objective here runs to 209; checker, 2026-10-26). The width is faked, and
      // the objective pushed down to where a phone's layout puts it, past the old 168 px.
      const prompt = document.querySelector('.ap-prompt');
      const had = Object.getOwnPropertyDescriptor(window, 'innerWidth');
      const objEl = sim.hud.objective;
      const mt = objEl.style.marginTop;
      Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
      objEl.style.marginTop = `${Math.max(0, 210 - objEl.getBoundingClientRect().bottom)}px`;
      frames(0.6);
      const ob = objEl.getBoundingClientRect();
      const top = prompt ? parseFloat(prompt.style.top) : NaN;
      objEl.style.marginTop = mt;
      if (had) Object.defineProperty(window, 'innerWidth', had);
      else delete window.innerWidth;
      frames(0.6);
      r.ok('on a phone the ground crew\'s prompt sits under the mission\'s objective, not over it', !!prompt && prompt.classList.contains('on') && ob.bottom > 168 && top >= ob.bottom,
        `objective ..${Math.round(ob.bottom)}, prompt top ${top}`);
      r.ok('…and back where it was on a wide screen', !!prompt && prompt.style.top === '', prompt && prompt.style.top);
    }
    sim.tap('KeyP');
    frames(0.2);
    r.ok('P calls them', svc().state === 'calling', svc().state);
    // Under the loadmaster's thirty seconds (after which he lowers it himself).
    frames(25);
    const waiting = Site.transferState();
    r.ok('with the ramp up they walk to its foot and wait there: nobody aboard yet', !!waiting && waiting.people.every((w) => !w.done && w.p.visible) && Math.hypot(waiting.people[0].x - ramp0.foot.x, waiting.people[0].z - ramp0.foot.z) < 2.5 && stepId() === 'board',
      waiting ? waiting.people.map((w) => Math.hypot(w.x - ramp0.foot.x, w.z - ramp0.foot.z).toFixed(1)).join(' ') : 'no walk');
    // The ramp key, as a keyboard sends it.
    sim.tap('Digit6');
    frames(0.5);
    const rs = Ramp.rampState();
    r.ok('the ramp key (6) lowers the ramp', Site.rampOf(sim).amount > 0.02 && rs.last === 'opening', `${Site.rampOf(sim).amount.toFixed(2)}, ${rs.last}`);
    // The crew is parked up by now and the people are on their way up the ramp: P for the push is too early.
    frames(12, () => svc().state === 'serviced');
    const early = svc().state;
    toasts.length = 0;
    sim.tap('KeyP');
    frames(0.3);
    r.ok('…but P for the push while the passengers are still boarding: the tug waits, and says so', early === 'serviced' && svc().state === 'serviced' && stepId() === 'board' && toasts.some((t) => /passengers are aboard|ramp down/.test(t)), `${early} → ${svc().state}, step ${stepId()}: ${toasts.slice(-1)}`);
    let highest = 0;
    let goneAt = [];
    const seen = new Set();
    frames(80, () => {
      const W = Site.transferState();
      const g = Site.rampOf(sim);
      if (W) {
        for (const w of W.people) {
          if (!w.done) highest = Math.max(highest, w.p.position.y - g.ground);
          if (w.done && !seen.has(w.i)) {
            seen.add(w.i);
            goneAt.push(Math.hypot(w.x - g.inside.x, w.z - g.inside.z));
          }
        }
      }
      return stepId() !== 'board';
    });
    r.ok('once it is down they walk up it, up onto the cargo floor, and go aboard inside the hold', stepId() === 'pushback' && highest > 2 && goneAt.length === 6 && goneAt.every((d) => d < 0.6),
      `step ${stepId()}, up ${highest.toFixed(2)} m, gone ${goneAt.map((d) => d.toFixed(1)).join(' ')}`);
    frames(9);
    r.ok('…and the loadmaster raises the ramp behind them', Site.rampOf(sim).amount < 0.05 && toasts.some((t) => /aboard/i.test(t) && /ramp/i.test(t)), `${Site.rampOf(sim).amount.toFixed(2)}`);

    /* ---- the pushback, on the FOB's stand, on snow ---- */
    say('scp-snow: push back');
    const ready = frames(90, () => svc().state === 'serviced');
    const crew = sim.apron.spare;
    const shown = (k) => crew && crew.v[k] != null && sim.apron.meshes[k] && (() => {
      const m = new THREE.Matrix4();
      sim.apron.meshes[k].getMatrixAt(crew.v[k], m);
      // A vehicle put away is scaled to nothing (apron.js HIDDEN).
      return m.elements[0] ** 2 + m.elements[1] ** 2 + m.elements[2] ** 2 > 1e-6;
    })();
    r.ok('…they drive out: the tug, the power cart and the bowser — no stairs, catering or baggage on a military apron', ready && shown('tug') && shown('gpu') && !shown('cateringTruck') && !shown('beltLoader'),
      `ready ${ready}; tug ${shown('tug')}, gpu ${shown('gpu')}, catering ${shown('cateringTruck')}`);
    const van = Site.groundVehicles().van;
    const deicer = Site.groundVehicles().deicer;
    const P0 = { x: ac.pos.x, z: ac.pos.z, h: ac.heading };
    sim.tap('KeyP');
    frames(0.2);
    r.ok('P again: the tug pushes', svc().state === 'pushback', svc().state);
    // How close the aeroplane's outline comes to the van and the de-icing truck, all the way round.
    const outline = [[0, -22], [0, 26], [-26, -1], [26, -1], [-10, 24], [10, 24], [-15.6, -2.3], [15.6, -2.3], [-8.9, -5.4], [8.9, -5.4], [-18, -3], [18, -3]];
    let nearVan = Infinity;
    let nearDeicer = Infinity;
    let crashed = false;
    const pushed = frames(150, () => {
      if (ac.crashed) {
        crashed = true;
        return true;
      }
      const h = ac.heading * D2R;
      for (const [bx, bz] of outline) {
        const x = ac.pos.x + Math.cos(h) * bx - Math.sin(h) * bz;
        const z = ac.pos.z + Math.sin(h) * bx + Math.cos(h) * bz;
        if (van) nearVan = Math.min(nearVan, Math.hypot(x - van.x, z - van.z));
        if (deicer) nearDeicer = Math.min(nearDeicer, Math.hypot(x - deicer.x, z - deicer.z));
      }
      return svc().state === 'pushed';
    });
    const faces = AS.__airportServices.departureHeading();
    r.ok('the push runs to the end on the FOB\'s snow and ice, in one piece', pushed && !crashed && svc().pushes >= 1, crashed ? `crashed: ${ac.crashReason || ''}` : `${svc().state}, ${Math.hypot(ac.pos.x - P0.x, ac.pos.z - P0.z).toFixed(0)} m`);
    r.ok('…clear of the van and the de-icing truck by metres (wing tips, nose, tail and tailplane)', nearVan > 4 && nearDeicer > 4, `van ${nearVan.toFixed(1)} m, de-icer ${nearDeicer.toFixed(1)} m (from their middles)`);
    r.ok('…and ends facing the start of runway 09, on made ground', Math.abs(angleDiff(ac.heading, faces)) < 8 && Lay.pavedIn(Lay.airportLayout(), ac.pos.x, ac.pos.z), `heading ${ac.heading.toFixed(0)}, wants ${faces}`);
    frames(1);
    r.ok('the step moves on to the taxi', stepId() === 'taxi-out', stepId());
    const still = ac.pos.clone();
    frames(5);
    r.ok('…and nothing slides on the snow after the tug lets go', ac.pos.distanceTo(still) < 0.5 && !ac.crashed, `${ac.pos.distanceTo(still).toFixed(2)} m in five seconds`);

    /* ---- the taxi to runway 09, on the real ground model ---- */
    say('scp-snow: taxi out');
    const lay = Lay.airportLayout();
    const F = lay.frame;
    const con = lay.connectors.slice().sort((p, q) => Math.abs(F.x(p.u) - st.x) - Math.abs(F.x(q.u) - st.x))[0];
    // West along the apron to the first taxiway, left down it, onto the runway, and round to face east.
    const route = [
      { x: F.x(con.u) + 75, z: ac.pos.z },
      { x: F.x(con.u), z: F.z(lay.taxiway ? lay.taxiway.w - 15 : 155) },
      { x: F.x(con.u), z: F.z(45) },
      { x: F.x(con.u) + 70, z: F.z(0) },
      { x: F.x(con.u) + 220, z: F.z(0) },
    ];
    let leg = 0;
    let taxied = false;
    let minHangar = Infinity;
    ac.parkingBrake = false;
    frames(300, () => {
      if (ac.crashed) return true;
      if (stepId() === 'depart') {
        taxied = true;
        sim.override = { throttle: 0, pitch: 0, roll: 0, yaw: 0, brakes: 1 };
        return true;
      }
      const p = route[Math.min(leg, route.length - 1)];
      const dx = p.x - ac.pos.x;
      const dz = p.z - ac.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 22 && leg < route.length - 1) leg++;
      const want = (Math.atan2(dx, -dz) / D2R + 360) % 360;
      const err = angleDiff(want, ac.heading);
      const vmax = Math.abs(err) > 25 ? 3.5 : 7;
      const gs = ac.groundSpeed || 0;
      sim.override = { pitch: 0, roll: 0, yaw: Math.max(-1, Math.min(1, err / 20)), throttle: gs < vmax ? 0.32 : 0, brakes: gs > vmax + 1.5 ? 0.6 : 0 };
      return false;
    });
    sim.override = null;
    r.ok('taxied by the nearest taxiway onto runway 09 and lined up on its own wheels (steering, power and brakes, nothing placed), and the step moves on', taxied && !ac.crashed && stepId() === 'depart',
      `${taxied ? `lined up via ${con.id}` : `leg ${leg}`}, step ${stepId()}, at ${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)} heading ${ac.heading.toFixed(0)}${ac.crashed ? `, crashed: ${ac.crashReason || ''}` : ''}`);
    void minHangar;
    if (stepId() !== 'depart') {
      // Placed at the runway's start, so the rest can still be checked.
      ac.reset({ pos: new THREE.Vector3(F.x(con.u) + 140, 0, F.z(0)), headingDeg: 90, speed: 0, engineOn: true, gearDown: true });
      frames(2);
      if (stepId() !== 'depart' && sim.runner.skipStep) sim.runner.skipStep();
    }

    say('scp-snow: fly across');
    ac.reset({ pos: ac.pos.clone(), headingDeg: 90, speed: 85, altAGL: 150, engineOn: true, gearDown: false });
    frames(5);
    r.ok('depart completes once airborne', stepId() === 'cross', stepId());
    const strip = map.scp.strip;
    ac.reset({ pos: new THREE.Vector3(strip.cx - 2000, 0, strip.cz + 200), headingDeg: 90, speed: 80, altAGL: 200, engineOn: true, gearDown: false });
    frames(2);
    r.ok('cross completes inside 2.6 km of the strip', stepId() === 'land', stepId());

    /* ---- the C-17 on the ice ---- */
    say('scp-snow: land on the ice');
    // A real touchdown: a few metres over the west end of the strip at 105 knots, sinking, brakes on and the reversers out from the moment the wheels touch.
    ac.reset({ pos: new THREE.Vector3(strip.cx - strip.halfLen + 120, 0, strip.cz), headingDeg: 90, speed: 54, altAGL: 5, engineOn: true, gearDown: true });
    sim.override = { throttle: 0, pitch: 0, roll: 0, yaw: 0, brakes: 1 };
    let tdX = null;
    let stopX = null;
    let iceCrash = false;
    frames(70, () => {
      if (ac.crashed) {
        iceCrash = true;
        return true;
      }
      if (tdX == null && ac.onGround) {
        tdX = ac.pos.x;
        ac.reverse = 1;
      }
      // Stopped: under the T's 1.5 m/s (idle thrust on ice creeps a little, brakes or no brakes).
      if (tdX != null && ac.groundSpeed < 1.2) {
        stopX = ac.pos.x;
        return true;
      }
      return false;
    });
    sim.override = null;
    ac.reverse = 0;
    const roll = tdX != null && stopX != null ? stopX - tdX : null;
    r.ok('the C-17 touches down on the ice in one piece', tdX != null && !iceCrash, iceCrash ? `crashed: ${ac.crashReason || ''}` : `down at x=${tdX && tdX.toFixed(0)}`);
    r.ok('…rolls a long way on it (ice grip), and stops on the strip', roll != null && roll > 350 && ac.pos.x < strip.cx + strip.halfLen, roll == null ? 'never stopped' : `${roll.toFixed(0)} m, ${(strip.cx + strip.halfLen - ac.pos.x).toFixed(0)} m to spare`);
    r.ok('…and stays on the strip with no rudder (the mission\'s wind is down the strip)', Math.abs(ac.pos.z - strip.cz) < strip.halfWidth && T.iceAt(ac.pos.x, ac.pos.z), `drifted ${Math.abs(ac.pos.z - strip.cz).toFixed(1)} m off the centreline over the roll`);
    r.ok('the HUD said "braking action poor" when the wheels were on the ice', toasts.some((t) => /braking action poor/i.test(t)), toasts.slice(-3).join(' | '));
    r.ok('the landing step completes on the ice strip', stepId() === 'gate', stepId());

    /* ---- the T and the handover ---- */
    say('scp-snow: the gate and the handover');
    const gate = map.scp.gate;
    ac.reset({ pos: new THREE.Vector3(gate.x, 0, gate.z), headingDeg: gate.headingDeg, speed: 0, engineOn: true, gearDown: true });
    frames(3);
    const h = ac.heading * D2R;
    const at = (bx, bz, y) => T.obstacleAt(ac.pos.x + Math.cos(h) * bx - Math.sin(h) * bz, info.doorY + y, ac.pos.z + Math.sin(h) * bx + Math.cos(h) * bz);
    const hits = [[-26, -1, 6], [26, -1, 6], [0, -22, 3], [0, 26, 5], [-10, 24, 12], [10, 24, 12]].filter(([x, z, y]) => at(x, z, y)).length;
    r.ok('stopped on the T, the C-17 is clear of the fence and the buildings, and the step moves on', !ac.crashed && hits === 0 && stepId() === 'handover', `${hits} points in something; step ${stepId()}`);
    frames(2);
    r.ok('…nobody gets out with the ramp up', !Site.transferState(), Site.transferState() ? Site.transferState().label : 'nobody');
    sim.tap('Digit6');
    // Eight seconds for the ramp to come down, then out they come, 11 m down from the hold to its foot.
    frames(22);
    const hw = Site.transferState();
    const g2 = Site.rampOf(sim);
    r.ok('the ramp down, they come out of the hold one at a time and down it', !!hw && hw.label === 'handover' && hw.people.some((p) => p.p.visible) && hw.people.some((p) => !p.descending && Math.hypot(p.x - g2.foot.x, p.z - g2.foot.z) > 1),
      hw ? hw.people.map((p) => `${p.p.visible ? 'out' : 'in'}${p.descending ? '↓' : ''}`).join(' ') : 'no walk');
    const done = frames(180, () => sim.runner.status === 'complete');
    r.ok('at the blast door the mission completes', done && sim.runner.status === 'complete', sim.runner.status);
    r.ok('…with a score in 0..100', Number.isFinite(sim.runner.result && sim.runner.result.score) ? sim.runner.result.score >= 0 && sim.runner.result.score <= 100 : true, JSON.stringify(sim.runner.result && sim.runner.result.score));
    r.ok('…and nobody went inside: the people stand outside the shut door', !!hw && hw.people.every((p) => p.p.visible && !T.obstacleAt(p.x, info.doorY + 1, p.z)));
  } catch (err) {
    r.ok('scp-snow: the check ran to the end', false, String((err && err.stack) || err));
  } finally {
    sim.hud.notify = origNotify;
    sim.override = null;
    try {
      sim.quitToMenu('main');
    } catch (e) {
      /* already there */
    }
    sim.autoPauseOnHide = origAuto;
    r.ok('the map you had chosen comes back after the mission', sim.settings.map === origMap, `${origMap} → ${sim.settings.map}`);
  }
}
