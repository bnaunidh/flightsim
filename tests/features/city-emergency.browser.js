/**
 * Browser checks for the town's emergency services
 * (src/features/emergency-scene/city.js), in the real game.
 * tests/features/city-emergency.mjs has read the dispatch rules; this comes
 * down in and round a town and watches who turns up:
 *
 *   - nothing of it is fetched for a healthy flight
 *   - a forced landing in a town street (classic map): police, an engine and
 *     an ambulance drive the streets from the town's stations, park round the
 *     aeroplane without driving through it, cone it off; the ambulance leaves
 *   - a crash in a field at the edge of town: foam on the wreck, the fire out,
 *     "Watch the rescue" on the crash card and back again (by tap)
 *   - the light bars: never more than three flashes a second, a soft swell
 *     with Reduce flashing; the police bars always the soft swell
 *   - a crash on the runway: the airfield's case, nothing of ours
 *   - in the sea by the town: the harbour boat comes by water
 *   - out in the hills: the rescue helicopter, overhead and never low
 *   - a new flight clears it all away (objects, pins, the ambient hole)
 *   - Low: three vehicles, nobody on foot, no tape, cheap to build and to run
 *   - the World Map: the same in a town there, from that town's stations
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export const id = 'city-emergency';

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

export async function check(sim, r, say) {
  const log = (m) => { if (say) say(`city-emergency: ${m}`); };
  const ok = (name, pass, detail = '') => r.ok(`city-emergency: ${name}`, !!pass, `${name}${detail !== '' ? ` — ${detail}` : ''}`);
  const THREE = await import('../../src/vendor/three.module.js');
  const T = await import('../../src/world/terrain.js');
  const D = await import('../../src/features/emergency-scene/dispatch.js');
  const FS = await import('../../src/render/flash-safety.js');
  const calm = { loadingScreen: false, airborne: true, aircraft: 'skylark', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 };
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const startMap = sim.settings.map;
  const startQuality = sim.settings.quality;
  const startReduce = FS.FLASH.reduce;
  const st = () => (sim.cityEmergency ? sim.cityEmergency.state() : { active: false });
  const wasLoaded = !!sim.cityEmergency;
  const held = (n, dt = 0.1) => { for (let i = 0; i < n; i++) sim.step(dt); };

  /** Sit the aeroplane on the ground here, stopped. */
  function park(x, z, hdg = 90) {
    const ac = sim.aircraft;
    ac.reset({ pos: new THREE.Vector3(x, T.heightAt(x, z) + 1.2, z), headingDeg: hdg, speed: 0, engineOn: false });
    sim.override = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 1 };
    held(10, 0.05);
    return ac;
  }
  /** Step until `done()` or `secs` of game time; watching every unit on the way. Returns what was seen. */
  function run(secs, done, polys = null) {
    const seen = { offRoad: 0, nearest: Infinity, sunk: 0, maxSpeed: 0 };
    const last = new Map();
    for (let t = 0; t < secs; t += 0.1) {
      sim.step(0.1);
      const s = st();
      if (!s.active) break;
      s.units.forEach((u, i) => {
        if (u.state === 'gone') return;
        const d = Math.hypot(u.x - s.incident.x, u.z - s.incident.z);
        if (d < seen.nearest) seen.nearest = d;
        // On the ground, to a hand: never under it, never hovering.
        const gy = T.heightAt(u.x, u.z);
        if (Math.abs(u.y - gy) > 0.3) seen.sunk++;
        const p = last.get(i);
        if (p) seen.maxSpeed = Math.max(seen.maxSpeed, Math.hypot(u.x - p.x, u.z - p.z) / 0.1);
        last.set(i, { x: u.x, z: u.z });
        if (polys && u.state === 'drive' && Math.hypot(u.x - u.park.x, u.z - u.park.z) > D.OFFROAD_MAX) seen.offRoad = Math.max(seen.offRoad, D.offNetwork([[u.x, u.z]], polys));
      });
      if (done && done(s)) break;
    }
    return seen;
  }
  const allHere = (s) => s.units.every((u) => u.state !== 'drive');
  const scene = () => sim.scene.getObjectByName('city-emergency');

  try {
    /* ---- 1: a healthy flight fetches nothing ---- */
    log('a healthy flight');
    if (sim.settings.map !== 'kestrel') {
      sim.applySetting('map', 'kestrel');
      await sleep(400);
    }
    await sim.startMode('free', calm);
    held(20);
    await sleep(300);
    if (wasLoaded) ok('a healthy flight has fetched none of it', true, 'already fetched by an earlier check in this page (the node suite reads the rule)');
    else ok('a healthy flight has fetched none of it', !sim.cityEmergency);

    /* ---- 2: a forced landing in a town street ---- */
    log('a forced landing in a street');
    const town = T.MAP.scenery.town;
    const polys = sim.ambient.polylines().filter((p) => p.pts && p.pts.length > 1);
    let spot = null;
    for (const p of polys) {
      if (p.kind !== 'street') continue;
      for (const q of p.pts) {
        const e = Math.abs(Math.hypot(q[0] - town.cx, q[1] - town.cz) - 150);
        if (!spot || e < spot.e) spot = { x: q[0], z: q[1], e };
      }
    }
    ok('Kestrel\'s town has a street to come down in', !!spot && polys.length > 3, `${polys.length} polylines`);
    let ac = park(spot.x, spot.z);
    held(40);
    ok('a healthy aeroplane parked in the street: nobody is called', !st().active);
    ac.failures.engine = true;
    held(10);
    for (let i = 0; i < 40 && !sim.cityEmergency; i++) await sleep(100);
    ok('an engine failure fetches the module', !!sim.cityEmergency);
    held(40);
    let s = st();
    ok('stopped in the street with a dead engine: the town answers', s.active && s.case === 'town' && s.kind === 'forced', `${s.case} ${s.kind}`);
    ok('...from Kestrel\'s own town, with a fire station and a police station built', s.town && s.stations.length === 2 && s.stations[0].built, `${s.town} ${JSON.stringify(s.stations.map((q) => [q.kind, q.built, q.shared]))}`);
    ok('...police, a fire engine and an ambulance', s.units.some((u) => u.kind === 'police') && s.units.filter((u) => u.kind === 'fire').length === 1 && s.units.filter((u) => u.kind === 'ambulance').length === 1, s.units.map((u) => u.kind).join(' '));
    ok('...the HUD says so', s.said[0] && /on the way from/.test(s.said[0]), s.said[0]);
    ok('...each on the minimap (a pin a vehicle, and the station)', Array.isArray(sim.mapPins) && s.pins === s.units.length + 1 && sim.mapPins.length >= s.pins, `${s.pins} pins`);
    ok('...and the ambient traffic is kept out', s.thin === true);
    const pin0 = sim.mapPins.find((p) => p.label === '' && Number.isFinite(p.x));
    const pinWas = pin0 ? { x: pin0.x, z: pin0.z } : null;
    let seen = run(60, allHere, polys);
    s = st();
    ok('everybody arrives (inside 45 s of the call)', allHere(s) && s.t <= 46, `${s.t.toFixed(1)} s ${s.units.map((u) => `${u.kind}:${u.state}`).join(' ')}`);
    ok('...along the streets (never more than 12 m off one until the last stretch)', seen.offRoad <= 12, `${seen.offRoad.toFixed(1)} m`);
    ok('...on the ground all the way', seen.sunk === 0, `${seen.sunk} samples off the ground`);
    ok('...no faster than 95 km/h', seen.maxSpeed * 3.6 <= 95 && seen.maxSpeed > 5, `${(seen.maxSpeed * 3.6).toFixed(0)} km/h`);
    ok('...and nobody drove through the aeroplane', seen.nearest >= 12, `nearest ${seen.nearest.toFixed(1)} m`);
    ok('...the pins moved with them', pinWas && Math.hypot(pin0.x - pinWas.x, pin0.z - pinWas.z) > 20);
    const parked = s.units.filter((u) => u.state === 'parked');
    let close = Infinity;
    for (let i = 0; i < parked.length; i++) for (let j = i + 1; j < parked.length; j++) close = Math.min(close, Math.hypot(parked[i].x - parked[j].x, parked[i].z - parked[j].z));
    ok('they park round it, not on each other', close >= 7 && parked.every((u) => Math.hypot(u.x - s.incident.x, u.z - s.incident.z) < 120), `${close.toFixed(1)} m apart`);
    ok('cones round the aeroplane, and tape between them', s.cones >= 6 && s.tapes >= 3, `${s.cones} cones, ${s.tapes} tapes`);
    ok('crews on foot: police, firefighters, paramedics', ['police', 'firefighter', 'paramedic'].every((k) => s.people.some((p) => p.role === k)) && s.people.length <= 7, s.people.map((p) => p.role).join(' '));
    ok('nothing is on fire, so no foam', s.burning === false && !s.foam.on);
    run(70, (q) => q.done);
    s = st();
    ok('the ambulance crew go to the aeroplane and back, and the ambulance leaves', s.ambulanceGone && s.people.filter((p) => p.role === 'paramedic').every((p) => p.gone), s.said[s.said.length - 1]);
    ok('...and the words say everybody is well', s.said.some((w) => /all well|safe|unhurt/.test(w)));
    ok('the response is finished inside two minutes', s.done && s.t < 120, `${s.t.toFixed(0)} s`);
    ok('nothing shown is hurt: no figure lies down (every one stands on the ground)', scene().children.filter((o) => /^city-(police|firefighter|paramedic)/.test(o.name)).every((o) => Math.abs(o.rotation.x) < 0.01 && Math.abs(o.rotation.z) < 0.01));

    /* ---- 3: the light bars ---- */
    log('the light bars');
    const lamps = [];
    scene().traverse((o) => { if (o.isSprite && o.material && !lamps.includes(o.material)) lamps.push(o.material); });
    const bars = [];
    scene().traverse((o) => { if (o.isMesh && o.material && o.material.emissive && o.material.emissiveIntensity != null && /police|car/i.test((o.parent && o.parent.name) || '') && !bars.includes(o.material)) bars.push(o.material); });
    const flashes = () => {
      const series = lamps.map(() => []);
      for (let i = 0; i < 360; i++) {
        sim.cityEmergency.tick(1 / 60);
        lamps.forEach((m, k) => series[k].push(m.opacity));
      }
      let worst = 0;
      let step = 0;
      let peak = 0;
      for (const sr of series) {
        const lo = Math.min(...sr);
        const hi = Math.max(...sr);
        if (hi - lo < 0.05) continue;
        peak = Math.max(peak, hi);
        const mid = (lo + hi) / 2;
        const ups = [];
        for (let i = 1; i < sr.length; i++) {
          step = Math.max(step, Math.abs(sr[i] - sr[i - 1]));
          if (sr[i - 1] < mid && sr[i] >= mid) ups.push(i / 60);
        }
        for (let a = 0; a < ups.length; a++) {
          let n = 0;
          for (let b = a; b < ups.length && ups[b] < ups[a] + 1; b++) n++;
          worst = Math.max(worst, n);
        }
      }
      return { worst, step, peak, lit: series.filter((sr) => Math.max(...sr) - Math.min(...sr) >= 0.05).length };
    };
    FS.setReduceFlashing(true);
    const soft = flashes();
    ok('Reduce flashing on: the bars swell, never step (under 8% a frame), one or two a second', soft.lit >= 2 && soft.worst <= 2 && soft.step < 0.08, JSON.stringify(soft));
    FS.setReduceFlashing(false);
    const hard = flashes();
    ok('Reduce flashing off: never more than three flashes in any second', hard.lit >= 2 && hard.worst <= 3, JSON.stringify(hard));
    // The police bars: sprite materials that still swell with the switch off are theirs.
    const policeSoft = lamps.filter((m) => {
      const a = [];
      for (let i = 0; i < 120; i++) {
        sim.cityEmergency.tick(1 / 60);
        a.push(m.opacity);
      }
      let stepMax = 0;
      for (let i = 1; i < a.length; i++) stepMax = Math.max(stepMax, Math.abs(a[i] - a[i - 1]));
      return Math.max(...a) - Math.min(...a) > 0.05 && stepMax < 0.08;
    }).length;
    ok('...and the police bars here take the soft swell even then', policeSoft >= 1, `${policeSoft} soft materials of ${lamps.length}`);
    ok('...leaving the player\'s own switch as it was', FS.FLASH.reduce === false);
    FS.setReduceFlashing(startReduce);

    /* ---- 4: a new flight clears it ---- */
    log('a new flight');
    const pinsBefore = (sim.mapPins || []).length;
    await sim.startMode('free', calm);
    held(5);
    ok('a new flight: the scene, its pins and its hole in the traffic are gone', !st().active && !scene() && (sim.mapPins || []).length <= Math.max(0, pinsBefore - 5) && !document.querySelector('[data-city-back]'), `${(sim.mapPins || []).length} pins`);

    /* ---- 5: a crash at the edge of town ---- */
    log('a crash in a field by the town');
    let field = null;
    for (let a = 0; a < 360 && !field; a += 20) {
      const x = town.cx + Math.sin(a / 57.3) * (town.radius + 120);
      const z = town.cz - Math.cos(a / 57.3) * (town.radius + 120);
      const h = T.heightAt(x, z);
      if (h > 3 && Math.abs(T.heightAt(x + 15, z) - h) < 1.5 && Math.abs(T.heightAt(x, z + 15) - h) < 1.5 && !T.isOnAnyRunway(x, z, 450)) field = { x, z };
    }
    ok('there is a field at the edge of town', !!field);
    ac = park(field.x, field.z);
    ac.crash('Test: came down in a field');
    held(30);
    s = st();
    ok('a crash in the field: the town answers', s.active && s.case === 'town' && s.kind === 'crash', `${s.case} ${s.kind}`);
    ok('...two engines on High', sim.settings.quality !== 'high' || s.units.filter((u) => u.kind === 'fire').length === 2, s.units.map((u) => u.kind).join(' '));
    // The card comes up 2.2 real seconds after the crash.
    for (let i = 0; i < 50 && sim.state !== 'debrief'; i++) {
      await sleep(100);
      sim.step(0.02);
    }
    const watchBtn = document.querySelector('[data-screen="debrief"] [data-actions] [data-city-watch]');
    ok('the crash card offers "Watch the rescue"', sim.state === 'debrief' && !!watchBtn, sim.state);
    const others = [...document.querySelectorAll('[data-screen="debrief"] [data-actions] button')].map((b) => b.textContent);
    ok('...beside the card\'s own buttons, which are all still there', others.some((t) => /Reset on the runway|Try again/.test(t)) && others.includes('Main menu'), others.join(' | '));
    seen = run(60, (q) => q.fireOut && allHere(q));
    s = st();
    ok('behind the card the scene goes on: everybody arrives', allHere(s), s.units.map((u) => `${u.kind}:${u.state}`).join(' '));
    ok('the wreck was burning, so the engine puts foam on it', s.burning === true && s.foam.on && s.foam.scale > 3, JSON.stringify(s.foam));
    ok('...and the fire is out about ten seconds later', s.fireOut && s.said.includes('The fire is out.'));
    ok('...with no more smoke to come', sim.wreck.smoke.state.every((q) => q.age >= 0));
    ok('nobody drove through the wreck', seen.nearest >= 12, `nearest ${seen.nearest.toFixed(1)} m`);
    if (watchBtn) {
      watchBtn.click();
      held(5);
      const back = document.querySelector('[data-city-back]');
      ok('tapping it puts the card away and gives a "Back to results" button', !sim.menus.current && !!back && st().watching);
      const rect = back ? back.getBoundingClientRect() : { height: 0, width: 0 };
      ok('...big enough for a finger (44 px or more)', rect.height >= 44 && rect.width >= 44, `${Math.round(rect.width)} x ${Math.round(rect.height)}`);
      const camWas = sim.camera.position.clone();
      held(20);
      const inc = st().incident;
      const dCam = Math.hypot(sim.camera.position.x - inc.x, sim.camera.position.z - inc.z);
      ok('...and the camera walks round the scene, above the ground', sim.camera.position.distanceTo(camWas) > 1 && dCam > 25 && dCam < 90 && sim.camera.position.y > T.heightAt(sim.camera.position.x, sim.camera.position.z) + 3, `${dCam.toFixed(0)} m off`);
      if (back) back.click();
      ok('"Back to results" brings the card back as it was', sim.menus.current === 'debrief' && !document.querySelector('[data-city-back]') && !st().watching);
      const again = document.querySelector('[data-screen="debrief"] [data-actions] [data-city-watch]');
      if (again) {
        again.click();
        held(3);
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true, cancelable: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape', key: 'Escape', bubbles: true }));
        held(2);
        ok('...and Esc does the same from the keyboard, and only that (the game is not paused by it)', sim.menus.current === 'debrief' && !st().watching && sim.state === 'debrief', sim.state);
      }
    }

    /* ---- 6: the airfield is the airfield's ---- */
    log('the runway');
    await sim.startMode('free', calm);
    ac = park(0, 0);
    ac.crash('Test: on the runway');
    held(40);
    s = st();
    ok('a crash on the runway: nothing of ours comes (the airfield is unchanged)', !s.active && s.no && s.no.case === 'airport' && !scene(), JSON.stringify(s.no));
    for (let i = 0; i < 40 && sim.state !== 'debrief'; i++) {
      await sleep(100);
      sim.step(0.02);
    }
    ok('...and its crash card has no rescue button', sim.state === 'debrief' && !document.querySelector('[data-city-watch]'));

    await sim.startMode('free', calm);
    ok('beside the runway (the apron side, 150 m off) is the airfield too', sim.cityEmergency.respond('crash', { x: 0, z: 150 }) === 'airport' && sim.cityEmergency.respond('forced', { x: -300, z: -120 }) === 'airport');
    // The town's own middle is the town's, however near the airfield the town is (Kestrel's second runway ends 450 m off).
    let centre = null;
    for (const p of polys) {
      if (p.kind !== 'street') continue;
      for (const q of p.pts) {
        const e = Math.abs(Math.hypot(q[0] - town.cx, q[1] - town.cz) - 60);
        if (!centre || e < centre.e) centre = { x: q[0], z: q[1], e };
      }
    }
    const mid = sim.cityEmergency.respond('crash', centre);
    ok('a crash in the middle of town is the town\'s, and is answered', mid === 'town' && st().units.length >= 3, `${mid} at ${Math.round(centre.x)}, ${Math.round(centre.z)}`);
    ok('...in among the houses the crews still find somewhere to stand, clear of every wall', st().units.every((u) => !T.obstacleAt(u.park.x, T.heightAt(u.park.x, u.park.z) + 1, u.park.z)));
    sim.cityEmergency.clear();

    /* ---- 7: the sea by the town ---- */
    log('the sea by the town');
    await sim.startMode('free', calm);
    const LN = await import('../../src/features/ambient/lanes.js');
    const keep = LN.seaKeepOuts(T.MAP);
    const shore = LN.nearestSea(keep, town.cx, town.cz, town.radius + 2800);
    // A couple of hundred metres out from the nearest good water.
    let sea = null;
    if (shore) {
      const d = Math.hypot(shore[0] - town.cx, shore[1] - town.cz) || 1;
      for (const out of [250, 150, 60, 0]) {
        const x = shore[0] + ((shore[0] - town.cx) / d) * out;
        const z = shore[1] + ((shore[1] - town.cz) / d) * out;
        if (!sea && LN.seaOk(keep, x, z)) sea = { x, z };
      }
    }
    ok('there is sea within the harbour boat\'s reach of the town', !!sea);
    const got = sim.cityEmergency.respond('crash', sea);
    s = st();
    ok('down in the sea by the town: the harbour patrol boat', got === 'water' && s.case === 'water' && !!s.boat, got);
    const boatFrom = { x: s.boat.x, z: s.boat.z };
    let dry = 0;
    for (let t = 0; t < 60 && !st().boat.here; t += 0.1) {
      sim.cityEmergency.tick(0.1);
      const b = st().boat;
      if (T.heightAt(b.x, b.z) > -0.5) dry++;
    }
    s = st();
    const bd = Math.hypot(s.boat.x - sea.x, s.boat.z - sea.z);
    ok('...it comes by water all the way', dry === 0 && T.heightAt(boatFrom.x, boatFrom.z) < -1, `${dry} samples aground`);
    ok('...and stops alongside inside 45 s', s.boat.here && s.t <= 45 && bd > 15 && bd < 60, `${s.t.toFixed(0)} s, ${bd.toFixed(0)} m off`);
    ok('...with the words', s.said.some((w) => /Harbour patrol alongside/.test(w)), s.said.join(' / '));
    const quay = s.units.find((u) => u.quay);
    ok('...and any ambulance sent to meet it stays on the road, on dry land', !quay || (T.heightAt(quay.park.x, quay.park.z) > 1 && D.offNetwork([[quay.park.x, quay.park.z]], polys) < 12), quay ? `to ${Math.round(quay.park.x)}, ${Math.round(quay.park.z)}` : 'no road within reach of the harbour here: the boat alone');
    sim.cityEmergency.clear();

    /* ---- 7b: a real ditching off the town ---- */
    log('a ditching off the town');
    await sim.startMode('free', calm);
    ac = sim.aircraft;
    {
      const PH = await import('../../src/aircraft/physics.js');
      ac.reset({ pos: new THREE.Vector3(sea.x, 40, sea.z), headingDeg: 90, speed: 28, altAGL: null, engineOn: false, gearDown: false });
      ac._spawnOnGround = false;
      ac.onGround = false;
      ac.flaps = ac.flapsTarget = 1;
      ac.quat.setFromEuler(new THREE.Euler((3 * Math.PI) / 180, -Math.PI / 2, 0, 'YXZ'));
      ac.vel.set(28, -1, 0);
      ac.omega.set(0, 0, 0);
      ac.pos.y = 0.22;
      sim.override = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
      void PH;
    }
    for (let i = 0; i < 120 && !st().active; i++) sim.step(0.25);
    s = st();
    const dz = sim.ditching ? sim.ditching.state() : {};
    ok('a gentle arrival on the sea by the town is a ditching, and the harbour boat is called', ac.ditched && !ac.crashed && s.active && s.case === 'water' && s.kind === 'ditch', JSON.stringify({ ditched: ac.ditched, crashed: ac.crashed, case: s.case, kind: s.kind, phase: dz.phase }));
    if (s.active) {
      for (let i = 0; i < 240 && !st().boat.here; i++) sim.step(0.25);
      s = st();
      const off = Math.hypot(s.boat.x - s.incident.x, s.boat.z - s.incident.z);
      ok('...it arrives and stands well off (the ditching\'s own boat has the wing tip)', s.boat.here && off >= 30 && off < 80, `${off.toFixed(0)} m off`);
      ok('...and the ditching goes on as it did: afloat, its own rescue, its own card to come', !!dz.phase && sim.ditching.state().phase !== 'none' && !ac.crashed, sim.ditching.state().phase);
    }

    /* ---- 8: the hills ---- */
    log('the hills');
    let hill = null;
    for (let x = -4000; x <= 4000 && !hill; x += 250) {
      for (let z = -4000; z <= 4000 && !hill; z += 250) {
        if (T.heightAt(x, z) > 8 && Math.hypot(x - town.cx, z - town.cz) > town.radius + D.TOWN_REACH + 150 && !T.isOnAnyRunway(x, z, 600)) hill = { x, z };
      }
    }
    if (!hill) ok('out of the town\'s reach: a helicopter', true, 'no land that far from the town on this island');
    else {
      const how = sim.cityEmergency.respond('crash', hill);
      s = st();
      ok('out of the town\'s reach: a rescue helicopter, no road vehicles', how === 'remote' && !!s.heli && s.units.length === 0, how);
      let low = 0;
      for (let t = 0; t < 50 && !st().heli.here; t += 0.1) {
        sim.cityEmergency.tick(0.1);
        const h = st().heli;
        if (h.y < Math.max(0, T.heightAt(h.x, h.z)) + 18) low++;
      }
      s = st();
      const hd = Math.hypot(s.heli.x - hill.x, s.heli.z - hill.z);
      ok('...overhead inside 45 s, off to one side, never under 18 m', s.heli.here && s.t <= 45 && low === 0 && hd > 10 && hd < 60, `${s.t.toFixed(0)} s, ${hd.toFixed(0)} m off, ${low} low samples`);
      ok('...a real helicopter model, and the words', s.heli.model && s.said.some((w) => /Rescue helicopter overhead/.test(w)));
      for (let t = 0; t < 70 && !st().heli.gone; t += 0.1) sim.cityEmergency.tick(0.1);
      ok('...which leaves again with everyone aboard', st().heli.gone && st().said.some((w) => /heading back/.test(w)));
      sim.cityEmergency.clear();
    }

    /* ---- 9: Low ---- */
    log('Low');
    sim.applySetting('quality', 'low');
    await sleep(400);
    await sim.startMode('free', calm);
    ac = park(field.x, field.z);
    ac.crash('Test: Low');
    held(30);
    s = st();
    ok('Low: one engine, one ambulance, one police car', s.active && s.tier === 'low' && s.units.length === 3, `${s.tier} ${s.units.map((u) => u.kind).join(' ')}`);
    ok('Low: planned and built in a few milliseconds', s.planMs < 30 && s.buildMs < 30, `plan ${s.planMs.toFixed(1)} ms, build ${s.buildMs.toFixed(1)} ms`);
    // While all three are driving: what a frame of it costs.
    const t0 = performance.now();
    for (let i = 0; i < 240; i++) sim.cityEmergency.tick(1 / 60);
    const per = (performance.now() - t0) / 240;
    ok('Low: a frame of it, with everybody driving, costs next to nothing (under 0.3 ms)', per < 0.3 && st().units.some((u) => u.state === 'drive'), `${per.toFixed(3)} ms`);
    run(60, (q) => q.fireOut && allHere(q));
    s = st();
    ok('Low: nobody on foot, no tape, no foam jet — and the fire is still put out', s.people.length === 0 && s.tapes === 0 && !s.foam.jet && s.fireOut && s.cones === 6, `${s.people.length} people, ${s.tapes} tapes, ${s.cones} cones`);
    const g = scene();
    let meshes = 0;
    g.traverse((o) => { if (o.isMesh || o.isSprite || o.isPoints) meshes++; });
    ok('Low: a small scene (under 70 things to draw)', meshes < 70, `${meshes}`);

    /* ---- 10: the World Map ---- */
    log('the World Map');
    const wp = sim.worldPreview;
    if (!wp) ok('the World Map: a town there answers too', true, 'no World Map in this build');
    else {
      sim.applySetting('quality', 'medium');
      await sleep(300);
      sim.applySetting('map', wp.id);
      await sleep(300);
      const built = wp.whenBuilt();
      wp.choose('haven');
      await Promise.race([built, sleep(200000)]);
      await sleep(100);
      await sim.startMode('free', calm);
      const G = await import('../../src/world/worldmap/town-grid.js');
      const frames = wp.towns3d().ctx.towns;
      const F = frames.find((t) => t.name === 'Aldermere') || frames[0];
      const streets = G.townStreets(F);
      const sp = streets[Math.floor(streets.length / 2)].pts;
      const at = sp[Math.floor(sp.length / 2)];
      // Low over the town first, so its ground and houses are there.
      for (let i = 0; i < 30; i++) {
        sim.aircraft.reset({ pos: new THREE.Vector3(at[0], 0, at[1]), headingDeg: 315, speed: 60, altAGL: 120, engineOn: true, fuel: 1 });
        sim.step(1 / 30);
        await sleep(25);
      }
      ac = park(at[0], at[1]);
      ac.failures.engine = true;
      held(45);
      s = st();
      ok(`the World Map: a forced landing in a street in ${F.name} is answered from ${F.name}`, s.active && s.case === 'town' && s.town === F.name, `${s.case} ${s.town}`);
      ok('...its stations inside that town', s.stations.every((q) => Math.hypot(q.x - F.cx, q.z - F.cz) < Math.max(F.hx, F.hz) * 1.3), JSON.stringify(s.stations.map((q) => [Math.round(q.x - F.cx), Math.round(q.z - F.cz)])));
      const wpolys = [...streets.map((q) => ({ pts: q.pts })), ...((sim.roads && sim.roads.list) || []).map((q) => ({ pts: q.path }))];
      seen = run(60, allHere, wpolys);
      s = st();
      ok('...everybody arrives inside 45 s, along the streets, on the ground', allHere(s) && s.t <= 46 && seen.offRoad <= 12 && seen.sunk === 0, `${s.t.toFixed(0)} s, ${seen.offRoad.toFixed(1)} m off, ${seen.sunk} off the ground`);
      ok('...parked round it with the cones out, nobody through the aeroplane', s.cones >= 6 && seen.nearest >= 12 && s.units.every((u) => Math.hypot(u.x - s.incident.x, u.z - s.incident.z) < 130), `${s.cones} cones, nearest ${seen.nearest.toFixed(1)} m`);
      // Another town answers for itself.
      const other = frames.find((t) => t !== F && G.townStreets(t).length > 0 && Math.hypot(t.cx - F.cx, t.cz - F.cz) > 6000);
      if (other) {
        const os = G.townStreets(other);
        const op = os[0].pts[Math.floor(os[0].pts.length / 2)];
        const how = sim.cityEmergency.respond('crash', { x: op[0], z: op[1] });
        ok(`...and ${other.name} answers for ${other.name}`, how === 'town' && st().town === other.name, `${how} ${st().town}`);
      }
      sim.cityEmergency.clear();
    }
  } finally {
    try {
      if (sim.cityEmergency) sim.cityEmergency.clear();
      FS.setReduceFlashing(startReduce);
      sim.override = null;
      sim.quitToMenu && sim.state !== 'menu' && sim.quitToMenu();
      if (sim.settings.quality !== startQuality) sim.applySetting('quality', startQuality);
      if (startMap && sim.settings.map !== startMap) sim.applySetting('map', startMap);
    } catch (e) {
      /* leave the page as it is */
    }
    sim.autoPauseOnHide = origAuto;
  }
}
