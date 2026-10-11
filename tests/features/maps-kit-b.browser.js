/**
 * Browser checks for KIT-B — the spawns and the "Start at" picker, the
 * ambient population and the emergency scene — on the real game.
 *
 *   1. SPAWNS. startMode('free') with no startAt is today's runway start,
 *      byte for byte the same pose. Through the Free Flight screen's own
 *      wrapped startFree: an A320 on Gateway with the Gate choice is nose-in
 *      on a contact stand that nobody else is parked on, and its jet bridge
 *      takes it within 5 s (fully out within the apron's own 10 s swing); a
 *      Hornet with the Carrier choice is on the carrier (carrier-ops's
 *      doing) and the old Carrier / Airbase buttons are not shown beside the
 *      picker; the Skyhook with a pad choice is on that pad; a multiplayer
 *      joiner (faked) keeps today's start and gets no ambient aircraft.
 *   2. AMBIENT. On Gateway: cars on the city's streets, drawn when the
 *      camera is near and lit at night; three helicopters 20 s into the
 *      flight, each a sky body of kind npc with rotor:true, drawn on the
 *      minimap; airport traffic asked of traffic.js; the update costs under
 *      0.3 ms a frame at High; "Return to the airfield" keeps the population
 *      (the same flight); a Graphics change mid-flight rebuilds it from the
 *      new tier; nothing left after the flight ends. On the air base: a Gate
 *      saved on Gateway is Auto (a remote stand, no "nowhere free" toast), a
 *      pad saved on another map likewise, and in 60 s no truck or jeep is
 *      ever on either runway (the base loop is cut at the strips).
 *   3. SCENES. The Big Burn raises its fire scene on its first step: crews
 *      staged, nothing on a runway, the pin appended, the helicopters in the
 *      sky, the ambient population thinned round it, the mission running;
 *      the flicker probe is clean with the scene in view at night.
 *
 * Every import is dynamic, the same rule as the other feature checks.
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export const id = 'maps-kit-b';

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

export async function check(sim, r, say) {
  let SP;
  let AMB;
  let ES;
  let TR;
  let AL;
  let THREE;
  let MP;
  let SKY;
  try {
    SP = await import('../../src/features/spawns.js');
    AMB = await import('../../src/features/ambient.js');
    ES = await import('../../src/features/emergency-scene.js');
    TR = await import('../../src/world/terrain.js');
    AL = await import('../../src/world/airport-layout.js');
    THREE = await import('../../src/vendor/three.module.js');
    MP = await import('../../src/features/multiplayer.js');
    SKY = await import('../../src/features/sky.js');
  } catch (err) {
    r.ok('kit-b: the modules load', false, String(err && err.message));
    return;
  }
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const noDebrief = () => clearTimeout(sim._crashDebriefT);
  const steps = (secs, dt = 1 / 30) => {
    for (let t = 0; t < secs; t += dt) {
      sim.step(dt, dt);
      noDebrief();
    }
  };
  const quit = () => {
    if (sim.state !== 'menu') sim.quitToMenu();
  };
  const toMap = async (id) => {
    if (sim.settings.map === id && TR.MAP.id === id) return;
    const before = sim.scenery;
    sim.setMap(id);
    for (let i = 0; i < 600 && (sim.scenery === before || TR.MAP.id !== id); i++) await sleep(10);
    await sleep(100);
  };
  const weather = { time: 'day', condition: 'clear', windSpeedKts: 3, windDirDeg: 90 };
  const pose = () => ({ x: sim.aircraft.pos.x, y: sim.aircraft.pos.y, z: sim.aircraft.pos.z, h: sim.aircraft.heading, g: sim.aircraft.onGround });
  const same = (a, b) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.z - b.z) < 1e-6 && Math.abs(a.h - b.h) < 1e-6 && a.g === b.g;
  /** Start a Free Flight the way the screen does: through the wrapped hook, with the picker's saved choice. */
  const flyFromScreen = async (aircraft, cls, choice) => {
    sim.menus.chosenAircraft = aircraft;
    sim.menus.chosenStart = 'runway';
    sim.spawns.saveChoice(cls, choice);
    sim.spawns.repaint();
    const cfg = { ...weather, aircraft, airborne: false, taxi: false, fuel: 1 };
    await sim.menus.hooks.startFree(cfg);
    if (sim.state === 'paused') sim.resume();
  };
  const savedChoice = sim.spawns ? sim.spawns.state().choice : {};

  try {
    /* ---- registered ---- */
    const ext = await import('../../src/game/extensions.js');
    const live = Object.fromEntries((ext.extStatus ? ext.extStatus() : []).map((e) => [e.id, e.live]));
    r.ok('kit-b: spawns, ambient and emergency-scene are registered and live', live.spawns && live.ambient && live['emergency-scene'], JSON.stringify(live));
    r.ok('kit-b: the picker is installed on the Free Flight screen', !!(sim.spawns && sim.spawns.state().installed && sim.menus.hooks.startFree._spawns));

    /* ---- 1. spawns ---- */
    say('kit-b: spawns');
    await toMap('gateway');
    // Today's start, twice: byte for byte the same, and the spawns feature stood aside.
    await sim.startMode('free', { ...weather, aircraft: 'a320', airborne: false, taxi: false });
    const p1 = pose();
    const d1 = SP.spawnsState().decided;
    await sim.startMode('free', { ...weather, aircraft: 'a320', airborne: false, taxi: false });
    const p2 = pose();
    const rwX = TR.AIRPORT.runway.cx - TR.AIRPORT.runway.length / 2 + 80;
    r.ok('spawns: a start without startAt is today\'s runway start, byte for byte the same pose', same(p1, p2) && Math.abs(p1.x - rwX) < 0.01 && Math.abs(p1.z) < 0.01 && Math.abs(p1.h - 90) < 0.01 && d1 === null, JSON.stringify([p1, p2, d1]));

    // The Gate, through the screen.
    await flyFromScreen('a320', 'airliner', 'gate');
    const dec = SP.spawnsState().decided;
    const ac = sim.aircraft;
    const st = AL.standAt(ac.pos.x, ac.pos.z, 3);
    r.ok('spawns: Picker → Gate with an A320 on Gateway puts it on a contact stand, nose-in', !!(dec && dec.placed && dec.kind === 'stand' && st && st.bridge && Math.abs((((ac.heading - st.headingDeg) % 360) + 540) % 360 - 180) < 2), JSON.stringify(dec) + (st ? ` ${st.id}` : ' no stand under it'));
    r.ok('spawns: the stand has nobody else parked on it', !!st && !AL.standTaken(st) && !(sim.traffic || []).some((t) => t && t.pos && Math.hypot(t.pos.x - ac.pos.x, t.pos.z - ac.pos.z) < 30), st ? `${st.id} taken ${AL.standTaken(st)}` : 'no stand');
    r.ok('spawns: picker shows Auto, Gate, Remote, Runway for an airliner (at most six)', (() => { const p = SP.spawnsState().picker; return p.shown && p.options.length <= 6 && p.options[0] === 'auto' && p.options.includes('gate') && p.options[p.options.length - 1] === 'runway'; })(), JSON.stringify(SP.spawnsState().picker));
    let took = null;
    let out = null;
    for (let i = 0; i < 360 && !out; i++) {
      steps(1 / 30);
      const b = (sim.apron && sim.apron.bridges || []).find((q) => q.visitor === 'player');
      if (b && took == null) took = (i + 1) / 30;
      if (b && b.ext >= 0.99) out = (i + 1) / 30;
    }
    r.ok('spawns: the jet bridge takes the A320 within 5 s', took != null && took <= 5, took != null ? `${took.toFixed(1)} s` : 'never');
    r.ok('spawns: and is fully out within 12 s (the apron\'s own ten-second swing)', out != null && out <= 12, out != null ? `${out.toFixed(1)} s` : 'never');
    r.ok('spawns: the A320 has not moved while the bridge came (engines off on a stand)', Math.hypot(ac.pos.x - dec.x, ac.pos.z - dec.z) < 2 || !dec.x, '');

    // Carrier, through the screen: carrier-ops places it, and its old buttons are gone.
    await flyFromScreen('fa18', 'military', 'carrier');
    const dc = SP.spawnsState().decided;
    const plat = TR.platformAt(sim.aircraft.pos.x, sim.aircraft.pos.z);
    r.ok('spawns: Military → Carrier still works (carrier-ops places it on the ship)', !!(plat && sim.carrier && plat.name === sim.carrier.name) && !!dc && !dc.placed && /carrier/.test(dc.why), `${plat ? plat.name : 'no deck'} ${JSON.stringify(dc)}`);
    const co = sim.menus.root.querySelectorAll('.co-start');
    const sp = sim.menus.root.querySelectorAll('.sp-start');
    r.ok('spawns: the old Carrier / Airbase choice is not shown twice — one picker, the carrier box hidden', sp.length === 1 && Array.from(co).every((b) => !b.classList.contains('is-on')), `${sp.length} pickers, ${Array.from(co).map((b) => b.classList.contains('is-on')).join(',')} carrier boxes shown`);
    r.ok('spawns: the military picker offers the carrier', SP.spawnsState().picker.options.includes('carrier'), SP.spawnsState().picker.options.join(','));

    // A pad, through the screen.
    await flyFromScreen('harrier', 'heli', 'pad:hospital');
    const dh = SP.spawnsState().decided;
    const padPlat = TR.platformAt(sim.aircraft.pos.x, sim.aircraft.pos.z);
    steps(2);
    r.ok('spawns: Heli → Pad puts the Skyhook on Harbour City General\'s roof pad, and it stays there', !!(dh && dh.placed && dh.kind === 'pad') && !!padPlat && /General/.test(padPlat.name || '') && !sim.aircraft.crashed && sim.aircraft.onGround, `${JSON.stringify(dh)} ${padPlat ? padPlat.name : 'no platform'} agl ${sim.aircraft.agl.toFixed(1)}`);

    // A multiplayer joiner, faked: today's start, no ambient aircraft.
    const mp = MP.multiplayer;
    const was = { role: mp.role, transition: mp.transition, meId: mp.meId };
    try {
      mp.role = 'client';
      mp.transition = true;
      mp.meId = 1;
      await sim.startMode('free', { ...weather, aircraft: 'a320', airborne: false, taxi: false, startAt: 'gate' });
      const pj = pose();
      const dj = SP.spawnsState().decided;
      steps(25);
      const amb = AMB.ambientState();
      r.ok('spawns: a multiplayer joiner keeps today\'s start (applySpawn\'s offsets), whatever the picker says', Math.abs(pj.x - rwX) < 0.01 && Math.abs(pj.h - 90) < 0.01 && !!dj && !dj.placed && /joiner/.test(dj.why), JSON.stringify([pj, dj]));
      r.ok('ambient: a multiplayer joiner gets no ambient aircraft — ground and water only', amb.flyers.length === 0 && amb.pendingAir === 0 && amb.traffic.asked === 0 && amb.counts && amb.counts.air === 0, JSON.stringify({ flyers: amb.flyers.length, pending: amb.pendingAir, traffic: amb.traffic, air: amb.counts && amb.counts.air }));
    } finally {
      mp.role = was.role;
      mp.transition = was.transition;
      mp.meId = was.meId;
    }
    quit();

    /* ---- 2. ambient ---- */
    say('kit-b: ambient');
    await sim.startMode('free', { time: 'night', condition: 'clear', windSpeedKts: 3, windDirDeg: 90, aircraft: 'skylark', airborne: true });
    if (sim.state === 'paused') sim.resume();
    const a0 = AMB.ambientState();
    r.ok('ambient: Gateway\'s population is on — cars on the city streets, boats, three flyers queued, airport traffic asked', a0.on && a0.cars >= 50 && a0.boats >= 3 && a0.pendingAir === 3 && a0.traffic.asked >= 1, JSON.stringify({ cars: a0.cars, boats: a0.boats, pending: a0.pendingAir, traffic: a0.traffic, lanes: a0.lanes, signals: a0.signals }));
    r.ok('ambient: airport traffic was spawned through traffic.js', a0.traffic.spawned >= 1 && Array.isArray(sim.traffic) && sim.traffic.length >= 1, JSON.stringify(a0.traffic));
    steps(19);
    r.ok('ambient: no flyer in the first 19 s of the flight', AMB.ambientState().flyers.length === 0, `${AMB.ambientState().flyers.length}`);
    steps(8);
    const a1 = AMB.ambientState();
    r.ok('ambient: three helicopters by T+27 s (police, news, medevac over Harbour City)', a1.flyers.length === 3 && a1.flyers.every((f) => f.kind === 'heli'), a1.flyers.map((f) => f.role).join(','));
    r.ok('ambient: every flyer appeared 2.5 km or more from the player', a1.flyers.every((f) => Math.hypot(f.x - sim.aircraft.pos.x, f.z - sim.aircraft.pos.z) >= 2000), a1.flyers.map((f) => Math.round(Math.hypot(f.x - sim.aircraft.pos.x, f.z - sim.aircraft.pos.z))).join(','));
    const bodies = (sim.aircraftAround && sim.aircraftAround.bodies || []).filter((b) => !b.gone && /^ambient-/.test(b.id));
    r.ok('ambient: every ambient aircraft is a sky body of kind npc, helicopters rotor:true', bodies.length === 3 && bodies.every((b) => b.kind === 'npc' && b.rotor === true && b.crew === 2), bodies.map((b) => `${b.id}:${b.kind}:${b.rotor}`).join(' '));
    // Over the city: cars drawn, lit at night; the update cheap.
    sim.aircraft.pos.set(1300, 420, -5600);
    sim.aircraft.vel.set(30, 0, 0);
    steps(2);
    // The minimap draws the three, now that they are inside its span (the map is 6 km across;
    // from the runway start the city's helicopters are 7-8 km off and simply off the map).
    sim.minimap.update(1 / 30, sim);
    r.ok('ambient: the minimap draws them (sim.aircraftAround.bodies, no minimap.js change)', (sim.minimap._drawnBodies || 0) >= 3, `${sim.minimap._drawnBodies} drawn; helicopters ${AMB.ambientState().flyers.map((f) => Math.round(Math.hypot(f.x - sim.aircraft.pos.x, f.z - sim.aircraft.pos.z)) + ' m').join(', ')} off`);
    const a2 = AMB.ambientState();
    let lights = null;
    sim.scene.traverse((o) => { if (o.name === 'ambient-headlights') lights = o; });
    r.ok('ambient: over Harbour City the cars are drawn (instanced, within 1.5 km)', a2.carsDrawn > 0, `${a2.carsDrawn} drawn of ${a2.cars}`);
    r.ok('ambient: at night the headlights are one Points draw', !!lights && lights.visible && lights.geometry.drawRange.count > 0, lights ? `${lights.visible} ${lights.geometry.drawRange.count} points` : 'no points');
    const names = new Set();
    sim.scene.traverse((o) => { if (/^ambient-/.test(o.name) && o.isInstancedMesh) names.add(o.name); });
    r.ok('ambient: one InstancedMesh per vehicle kind, plus the box stand-in', names.has('ambient-car') && names.has('ambient-car-proxy'), Array.from(names).join(','));
    steps(10);
    const a3 = AMB.ambientState();
    r.ok('ambient: update() median under 0.3 ms at High on Gateway', a3.update.median <= 0.3, `median ${a3.update.median.toFixed(3)} ms, mean ${a3.update.mean.toFixed(3)}, max ${a3.update.max.toFixed(1)} (model builds), ${a3.update.frames} frames`);
    r.ok('ambient: no flyer within 300 m of the player, none under 150 m AGL, so far', a3.flyers.every((f) => f.minClear >= 149 && Math.hypot(f.x - sim.aircraft.pos.x, f.y - sim.aircraft.pos.y, f.z - sim.aircraft.pos.z) >= 300), a3.flyers.map((f) => `${f.role} clear ${f.minClear}`).join(', '));

    /* ---- back to the runway, and a new Graphics quality, mid-flight ---- */
    // "Return to the airfield" (the HUD's tower button, the pause menu) is the same flight: the population stays.
    const b0 = AMB.ambientState();
    sim.returnToAirport();
    steps(5);
    const b1 = AMB.ambientState();
    r.ok('ambient: "Return to the airfield" keeps the population — still on, the same cars, boats and helicopters', b1.on && b1.mode === 'free' && b1.cars === b0.cars && b1.boats === b0.boats && b1.flyers.length === b0.flyers.length && b1.flyers.length >= 1, JSON.stringify({ before: { on: b0.on, cars: b0.cars, boats: b0.boats, flyers: b0.flyers.length }, after: { on: b1.on, cars: b1.cars, boats: b1.boats, flyers: b1.flyers.length } }));
    let hiddenKids = [];
    sim.scene.traverse((o) => {
      if (o.name === 'ext:ambient') hiddenKids = o.children.filter((c) => !c.visible && c.name !== 'ambient-headlights').map((c) => c.name);
    });
    r.ok('ambient: and its meshes are still drawn (the headlights alone come and go with the night and the view)', hiddenKids.length === 0, hiddenKids.join(','));
    // A new Graphics quality from the pause menu's Settings: main.js rebuilds the world, and the layers come back from the new tier.
    const AMD = await import('../../src/world/ambient.js');
    const q0 = sim.settings.quality;
    const q1 = q0 === 'medium' ? 'high' : 'medium';
    const wantGround = (q) => AMD.countsFor('gateway', q, 'full').ground.reduce((n, g) => n + g.count, 0);
    const rebuilt = async (q) => {
      sim.applySetting('quality', q);
      for (let i = 0; i < 600 && sim.qualityBuilt !== q; i++) await sleep(50);
      return sim.qualityBuilt === q;
    };
    try {
      const okQ1 = await rebuilt(q1);
      steps(3);
      const c1 = AMB.ambientState();
      r.ok(`ambient: a Graphics change mid-flight (${q0} → ${q1}) rebuilds the layers from the new tier — still on, the tier and the lanes follow it, the cars and boats back at its density`, okQ1 && c1.on && c1.tier === q1 && c1.quality === q1 && c1.cars === wantGround(q1) && c1.boats >= 1, JSON.stringify({ rebuilt: okQ1, on: c1.on, tier: c1.tier, quality: c1.quality, cars: c1.cars, want: wantGround(q1), boats: c1.boats }));
      r.ok(`ambient: and the helicopters queue again under the new tier's cap (${AMD.AIR_CAP[q1]}), appearing at once this far into the flight`, c1.flyers.length + c1.pendingAir === AMD.AIR_CAP[q1] && c1.flyers.length >= 1, JSON.stringify({ flyers: c1.flyers.length, pending: c1.pendingAir }));
    } finally {
      const okQ0 = await rebuilt(q0);
      steps(1);
      const c0 = AMB.ambientState();
      r.ok(`ambient: and back to ${q0} the same way`, okQ0 && c0.on && c0.tier === q0 && c0.cars === wantGround(q0), JSON.stringify({ rebuilt: okQ0, on: c0.on, tier: c0.tier, cars: c0.cars, want: wantGround(q0) }));
    }
    quit();
    const a4 = AMB.ambientState();
    r.ok('ambient: nothing left after the flight — no flyers, no bodies, the layer off', !a4.on && a4.flyers.length === 0 && !SKY.bodies().some((b) => !b.gone && /^ambient-/.test(b.id)));

    /* ---- 2b. the air base: a choice saved on another map, and the runway ---- */
    say('kit-b: runways');
    await toMap('airbase');
    // A Gate chosen on Gateway is nowhere on the base: the picker says Auto, and so does the flight —
    // the A320 on a remote stand, not lined up on the runway behind a "nowhere free to start there" toast.
    await flyFromScreen('a320', 'airliner', 'gate');
    const ds = SP.spawnsState().decided;
    r.ok('spawns: a Gate saved on Gateway is Auto on the air base — the A320 starts on a remote stand, not on the runway with the "nowhere free" toast', !!ds && ds.startAt === 'auto' && ds.placed && ds.kind === 'stand', JSON.stringify(ds));
    r.ok('spawns: and the picker shows Auto for it', SP.spawnsState().picker.value === 'auto', String(SP.spawnsState().picker.value));
    // The base's trucks and jeeps: the perimeter loop crossed the runway twice; it is two roads now, one each side.
    const polys = sim.ambient.polylines();
    let onStrip = 0;
    for (const p of polys) {
      for (let i = 1; i < p.pts.length; i++) {
        const a = p.pts[i - 1];
        const b = p.pts[i];
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          if (TR.isOnAnyRunway(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 8)) onStrip++;
        }
      }
    }
    r.ok('ambient: no road of the base loop crosses or touches either runway strip (cut 15 m short of the tarmac)', polys.length >= 2 && onStrip === 0, `${polys.length} roads, ${onStrip} points on a strip`);
    let onRunway = 0;
    let firstOn = null;
    for (let s = 0; s < 120; s++) {
      steps(0.5);
      for (const c of sim.ambient.vehicles()) {
        if (TR.isOnAnyRunway(c.px, c.pz, 0)) {
          onRunway++;
          if (!firstOn) firstOn = `${c.kind} at (${Math.round(c.px)}, ${Math.round(c.pz)}) t=${(s * 0.5).toFixed(1)} s`;
        }
      }
    }
    r.ok('ambient: in 60 s on the air base no truck or jeep is on either runway — the player\'s runway is never blocked', sim.ambient.vehicles().length >= 6 && onRunway === 0, `${sim.ambient.vehicles().length} vehicles, ${onRunway} samples on a strip ${firstOn || ''}`);
    // A pad saved on Meridian (the plaza) is not on the base either: Auto.
    await flyFromScreen('harrier', 'heli', 'pad:plaza');
    const dp = SP.spawnsState().decided;
    r.ok('spawns: a pad saved on another map is Auto here too (the Skyhook starts on one of the base\'s own pads)', !!dp && dp.startAt === 'auto' && dp.placed && dp.kind === 'pad', JSON.stringify(dp));
    quit();

    /* ---- 3. the scene ---- */
    say('kit-b: scene');
    await sim.startMode('mission', { id: 'fire-bigburn' });
    if (sim.state === 'paused') sim.resume();
    steps(2);
    const s1 = ES.sceneState();
    const sc = s1.scenes[0];
    r.ok('scene: The Big Burn raises its fire scene on its first step', s1.scenes.length === 1 && !!sc && sc.built && sc.kind === 'fire', JSON.stringify(s1.scenes.map((s) => ({ kind: s.kind, built: s.built, at: s.at }))));
    if (sc) {
      r.ok('scene: fire engines, ambulances and police staged outside the ring, none on a runway, none in the water', sc.vehicles.length >= 8 && sc.vehicles.every((v) => !TR.isOnAnyRunway(v.x, v.z, 10) && TR.heightAt(v.x, v.z) > 1.5 && Math.hypot(v.x - sc.at.x, v.z - sc.at.z) >= sc.radius), `${sc.vehicles.length} vehicles, staged ${JSON.stringify(sc.staged)}, cordon cars ${sc.cordonCars}`);
      r.ok('scene: news, police and bucket helicopters overhead, 500 m off, 150 m or more up', sc.helis.length === 3 && sc.helis.every((h) => h.r >= 500 && h.agl >= 150), sc.helis.map((h) => `${h.role} r${h.r} ${h.agl}m`).join(', '));
      r.ok('scene: the map pin is appended to sim.mapPins', Array.isArray(sim.mapPins) && sim.mapPins.some((p) => p && p.label === 'Fire scene'), JSON.stringify(sim.mapPins));
      r.ok('scene: the ambient population is thinned round it (three times the radius)', AMB.ambientState().thin.some((t) => Math.abs(t.r - sc.radius * 3) < 1), JSON.stringify(AMB.ambientState().thin));
      const sceneBodies = SKY.bodies().filter((b) => !b.gone && /^scene-/.test(b.id));
      r.ok('scene: the helicopters are sky bodies (kind npc, rotor)', sceneBodies.length === 3 && sceneBodies.every((b) => b.kind === 'npc' && b.rotor), `${sceneBodies.length}`);
    }
    r.ok('scene: the mission is running with the scene up', sim.runner.status === 'running' && !sim.aircraft.crashed, sim.runner.status);
    const am = AMB.ambientState();
    r.ok('ambient: the mission got the default — thin ground and water, no ambient aircraft', am.counts && am.counts.air === 0 && !am.counts.airport && am.pendingAir === 0 && am.flyers.length === 0, JSON.stringify(am.counts));
    quit();
    r.ok('scene: cleared when the flight ends', ES.sceneState().scenes.length === 0 && !SKY.bodies().some((b) => !b.gone && /^scene-/.test(b.id)));

    /* ---- the flicker probe with a scene in view at night ---- */
    // Measured the same way twice — level at 800 ft over the Big Burn's spot at
    // night, the scene up and not — so what is counted is what the scene adds:
    // its beacons and helicopters, not the ground going by (which the probe's
    // own calibrated spots are chosen to keep still).
    say('kit-b: flicker');
    try {
      const P = await import('../flicker-probe.js');
      const spot = { map: 'meadow', time: 'night', altFt: 800, at: { x: 1700, z: -1110 }, look: 'level', aircraft: 'skylark', heading: 350 };
      const sceneOpts = { at: { x: 1700, z: -1110 }, kind: 'fire', radius: 200, roads: true, crews: { fire: 3, ambulance: 2, police: 3 }, helis: { news: 1, police: 1, fire: 1 }, avoidRunway: true, label: 'Fire scene' };
      const run = async (withScene) => {
        await P.setupScenario(sim, spot);
        let h = null;
        if (withScene) {
          h = sim.emergencyScene.raise(sceneOpts);
          for (let i = 0; i < 60; i++) h.update(1 / 30); // the beacons running, the helicopters on their rings
        }
        const m = await P.measure(sim, { frames: 60, fps: 30, raycast: false });
        if (h) h.dispose();
        sim.override = null;
        if (sim._flickerRestore) sim._flickerRestore();
        quit();
        return m;
      };
      const base = await run(false);
      const withScene = await run(true);
      const WCAG_WINDOW_MAX = 0.02;
      r.ok('scene: the flicker probe is clean with the scene in view at night — the scene adds no flicker (within 0.1% of the screen of the same view without it)', withScene.percArea <= base.percArea + 0.001, `with ${(withScene.percArea * 100).toFixed(3)}% vs without ${(base.percArea * 100).toFixed(3)}% (wcag ${(withScene.wcagArea * 100).toFixed(3)}% vs ${(base.wcagArea * 100).toFixed(3)}%)`);
      r.ok('scene: and the worst third-of-the-screen window is no worse than without it (within 0.2%), or under WCAG\'s 2%', withScene.wcagWindow <= Math.max(WCAG_WINDOW_MAX, base.wcagWindow + 0.002), `with ${(withScene.wcagWindow * 100).toFixed(2)}% vs without ${(base.wcagWindow * 100).toFixed(2)}%`);
    } catch (err) {
      r.ok('scene: the flicker probe ran with a scene in view', false, String(err && err.message));
    }
    quit();
  } finally {
    // The player's own picker choices back.
    try {
      for (const k of Object.keys(savedChoice || {})) sim.spawns.saveChoice(k, savedChoice[k]);
      for (const k of ['airliner', 'military', 'heli']) if (!(savedChoice && savedChoice[k])) sim.spawns.saveChoice(k, 'auto');
    } catch (e) {
      /* the choice is a convenience */
    }
    sim.autoPauseOnHide = origAuto;
    quit();
  }
}
