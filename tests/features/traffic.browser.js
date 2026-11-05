/**
 * AI traffic, in the running game.
 *
 * Spawns one aeroplane that departs and one that arrives, steps the real game
 * with sim.step(), and checks each goes through its phases in order — start-up,
 * pushback (or straight out of a nose-out hangar), taxi, hold, line-up,
 * take-off, climb for the one; approach, landing, roll-out, taxi-in (and the
 * push back into a nose-out hangar) and parked for the other — that the
 * arrival touches down on the runway and parks on its slot facing the way the
 * slot does, that sim.traffic is published with the contract's fields, that
 * an aeroplane on a head-on course with the player never comes within 300 m,
 * that a departure holds short and an arrival does not land while the player
 * sits on the runway, and what all of it costs per frame.
 *
 * Everything the game module exports is reached through a namespace import
 * inside a try, so a missing name is a failed check, not a thrown suite.
 */

export const id = 'traffic';

export async function check(sim, r, say) {
  let TF;
  let TR;
  let THREE;
  try {
    TF = await import('../../src/features/traffic.js');
    TR = await import('../../src/world/terrain.js');
    THREE = await import('../../src/vendor/three.module.js');
  } catch (err) {
    r.ok('traffic: modules load', false, String(err && err.message));
    return;
  }
  const state = () => TF.trafficState();
  const byId = (id) => state().craft.find((c) => c.id === id);
  const origAutoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;

  /* ---- a map the traffic runs on ---- */
  if (!TR.MAP || !['kestrel', 'meadow', 'atoll', 'fjord', 'ember', 'airbase', 'sfo', 'oak', 'lax'].includes(TR.MAP.id)) {
    say('traffic: switching to Kestrel');
    sim.setMap('kestrel');
    for (let i = 0; i < 100 && TR.MAP.id !== 'kestrel'; i++) await new Promise((res) => setTimeout(res, 50));
    await new Promise((res) => setTimeout(res, 800));
  }

  /* ---- free flight, parked at the gate out of everybody's way ---- */
  say('traffic: free flight');
  await sim.startMode('free', { time: 'day', condition: 'clear', windSpeedKts: 3, windDirDeg: 90, taxi: true, traffic: true });
  if (sim.state === 'paused') sim.resume();
  const st0 = state();
  r.ok('traffic: starts itself in free flight', st0.on && st0.craft.length >= 2, `${st0.craft.length} aeroplanes, ${st0.why}`);
  r.ok('traffic: some start parked on a slot', st0.craft.some((c) => c.state === 'parked' && c.home), st0.craft.map((c) => `${c.type}:${c.state}`).join(' '));
  r.ok('traffic: sim.traffic is published', Array.isArray(sim.traffic) && sim.traffic.length === st0.craft.length, `${(sim.traffic || []).length}`);
  const e0 = (sim.traffic || [])[0];
  r.ok(
    'traffic: entries carry the contract fields',
    !!e0 && typeof e0.id === 'string' && typeof e0.typeId === 'string' && e0.pos && e0.pos.isVector3 &&
      Number.isFinite(e0.heading) && Number.isFinite(e0.speed) && Number.isFinite(e0.alt) &&
      typeof e0.onGround === 'boolean' && typeof e0.phase === 'string',
    e0 ? Object.keys(e0).join(',') : 'none'
  );

  /* ---- one departure, one arrival, on an otherwise empty field ---- */
  TF.clearTraffic(sim);
  const dep = TF.spawnTraffic(sim, 'depart');
  const arr = TF.spawnTraffic(sim, 'arrive');
  r.ok('traffic: dev spawn adds a departure', dep.ok, dep.why || dep.callsign);
  r.ok('traffic: dev spawn adds an arrival', arr.ok, arr.why || arr.callsign);
  if (!dep.ok || !arr.ok) {
    sim.autoPauseOnHide = origAutoPause;
    return;
  }
  dep.home = byId(dep.id).home;
  arr.home = byId(arr.id).home;
  const seen = { [dep.id]: [], [arr.id]: [] };
  let touchdown = null;
  let depFirstAirborne = null;
  let moved = 0;
  let last = byId(dep.id).pos.slice();
  let parkedAt = null;
  const t0 = performance.now();
  say('traffic: stepping a departure and an arrival');
  for (let t = 0; t < 540; t++) {
    sim.step(1, 1 / 30);
    for (const id of [dep.id, arr.id]) {
      const c = byId(id);
      if (!c) continue;
      const list = seen[id];
      if (list[list.length - 1] !== c.phase) list.push(c.phase);
      if (id === arr.id && c.phase === 'rollout' && !touchdown) touchdown = c.pos.slice();
      if (id === arr.id && c.state === 'parked' && list.includes('taxi-in') && !parkedAt) parkedAt = { pos: c.pos.slice(), home: c.home };
      if (id === dep.id && !c.onGround && depFirstAirborne == null) depFirstAirborne = t;
    }
    const d = byId(dep.id);
    if (d) {
      moved += Math.hypot(d.pos[0] - last[0], d.pos[2] - last[2]);
      last = d.pos.slice();
    }
    if (parkedAt && seen[dep.id].includes('route')) break;
  }
  const realS = (performance.now() - t0) / 1000;
  const inOrder = (list, want) => {
    let i = 0;
    for (const p of list) if (p === want[i]) i++;
    return i === want.length;
  };
  // A nose-in slot is left by pushback; a hangar it was pushed into tail
  // first is left by taxiing straight out.
  const slotOf = (id) => (state().field.slots || []).find((s) => s.id === id) || null;
  const depSlot = slotOf(dep.home);
  const depWant = ['startup', 'pushback', 'taxi-out', 'lineup', 'takeoff', 'climb', 'route'];
  if (depSlot && depSlot.nose === 'out') depWant.splice(1, 1);
  r.ok(
    `traffic: a departure starts up, ${depSlot && depSlot.nose === 'out' ? 'taxis out of its hangar' : 'pushes back, taxis'}, lines up and takes off`,
    inOrder(seen[dep.id], depWant),
    `${seen[dep.id].join(' > ')} (from ${dep.home}, nose ${depSlot && depSlot.nose})`
  );
  r.ok('traffic: the departure actually moved', moved > 800, `${moved.toFixed(0)} m`);
  const arrSlot = slotOf(arr.home);
  const arrWant = ['approach', 'landing', 'rollout', 'taxi-in', 'shutdown', 'parked'];
  if (arrSlot && arrSlot.nose === 'out') arrWant.splice(4, 0, 'push-in');
  r.ok(
    `traffic: an arrival approaches, lands, rolls out, taxis in${arrSlot && arrSlot.nose === 'out' ? ', is pushed into its hangar' : ''} and parks`,
    inOrder(seen[arr.id], arrWant),
    `${seen[arr.id].join(' > ')} (to ${arr.home}, nose ${arrSlot && arrSlot.nose})`
  );
  r.ok(
    'traffic: the arrival touches down on the runway',
    !!touchdown && TR.isOnRunway(touchdown[0], touchdown[2], 0),
    touchdown ? touchdown.map((v) => v.toFixed(0)).join(', ') : 'never touched down'
  );
  {
    const slot = parkedAt && slotOf(parkedAt.home);
    const pub = (sim.traffic || []).find((e) => e.id === arr.id);
    const off = slot ? Math.hypot(parkedAt.pos[0] - slot.x, parkedAt.pos[2] - slot.z) : Infinity;
    const hdgErr = slot && pub ? Math.abs(((pub.heading - slot.headingDeg + 540) % 360) - 180) : Infinity;
    r.ok(
      'traffic: the arrival parks on its slot, facing the way the slot does',
      !!slot && off < 1 && hdgErr < 3,
      slot ? `${slot.id} (${slot.kind}, nose ${slot.nose}): ${off.toFixed(2)} m off, heading ${pub ? pub.heading.toFixed(1) : '?'} for ${slot.headingDeg}` : 'never parked'
    );
  }
  const model = sim.scene.getObjectByName(`traffic:${dep.id}`);
  r.ok('traffic: its model is in the scene', !!model, dep.id);

  /* ---- manners: holds short while the player is on the runway ---- */
  /*
   * Seven minutes, with three departures and an arrival. The first cut of
   * this check held the player there for 200 s with one departure, which is
   * too short to see what the review found: after half a minute in a queue,
   * the second aeroplane drove into the first at the holding point.
   */
  say('traffic: holding short for the player, for seven minutes');
  TF.clearTraffic(sim);
  sim.aircraft.reset({ pos: new THREE.Vector3(-200, 0, 0), headingDeg: 90, speed: 0, engineOn: true });
  sim.aircraft.controls.brakes = 1;
  const hold = TF.spawnTraffic(sim, 'depart');
  /*
   * And one arriving while you sit there: it must hold or go round, not land
   * on you. Added before the queue, so it has somewhere to park: with the
   * airport's parked aeroplanes drawn (every quality but low) Kestrel keeps
   * fewer slots free, and added last it was refused ("nowhere free to park").
   */
  const inbound = TF.spawnTraffic(sim, 'arrive');
  const queue = [TF.spawnTraffic(sim, 'depart'), TF.spawnTraffic(sim, 'depart')].filter((q) => q.ok);
  let landedOnYou = false;
  let inboundSeen = [];
  let heldShort = false;
  let enteredRunway = false;
  let closestPair = Infinity;
  let closestYou = Infinity;
  let pairWhere = '';
  // Inside each other: closer than half their nose-to-tail spacing.
  let inside = 0;
  let insideYou = 0;
  const halfLen = (c) => Math.max(3, (c.length || 8) / 2);
  for (let t = 0; t < 420; t++) {
    // Keep the player sat on the runway.
    sim.aircraft.controls.throttle = 0;
    sim.input.throttleTarget = 0;
    sim.aircraft.controls.brakes = 1;
    sim.step(1, 1 / 30);
    const all = state().craft;
    for (const c of all) {
      if (c.id !== inbound.id && (c.phase === 'lineup' || c.phase === 'takeoff')) enteredRunway = true;
      if (!c.onGround) continue;
      const p = sim.aircraft.pos;
      const dy = Math.hypot(c.pos[0] - p.x, c.pos[2] - p.z);
      closestYou = Math.min(closestYou, dy);
      if (dy < 0.8 * (halfLen(c) + 4)) insideYou++;
      for (const o of all) {
        if (o === c || !o.onGround) continue;
        const d = Math.hypot(c.pos[0] - o.pos[0], c.pos[2] - o.pos[2]);
        if (d < 0.5 * (halfLen(c) + halfLen(o))) inside++;
        if (d < closestPair) {
          closestPair = d;
          pairWhere = `${c.callsign} ${c.phase} and ${o.callsign} ${o.phase} at (${Math.round(c.pos[0])}, ${Math.round(c.pos[2])})`;
        }
      }
    }
    const c = byId(hold.id);
    if (c && c.phase === 'holding') heldShort = true;
    const b = inbound.ok ? byId(inbound.id) : null;
    if (b) {
      if (inboundSeen[inboundSeen.length - 1] !== b.phase) inboundSeen.push(b.phase);
      if (b.phase === 'rollout' || (b.onGround && b.phase !== 'parked')) landedOnYou = true;
    }
  }
  r.ok('traffic: departures hold short while you are on the runway, for seven minutes', hold.ok && heldShort && !enteredRunway,
    `held ${heldShort}, entered ${enteredRunway}, ${1 + queue.length} departures`);
  r.ok('traffic: an arrival does not land while you are on the runway', inbound.ok && !landedOnYou && inboundSeen.length > 0,
    inbound.ok ? inboundSeen.join(' > ') : inbound.why);
  r.ok('traffic: in the queue, no two aeroplanes inside each other', inside === 0, `${inside} seconds inside; closest ${closestPair.toFixed(1)} m: ${pairWhere}`);
  r.ok('traffic: in the queue, none drives into you', insideYou === 0, `closest ${closestYou.toFixed(1)} m`);
  r.ok('traffic: no deadlock had to be broken', state().stats.deadlocks === 0, `${state().stats.deadlocks}`);

  /* ---- manners: nobody leaves their slot while you taxi out ---- */
  say('traffic: waiting while you taxi out');
  TF.clearTraffic(sim);
  {
    // You, rolling west along Kestrel's parallel taxiway at walking pace.
    sim.aircraft.reset({ pos: new THREE.Vector3(200, 0, -95), headingDeg: 270, speed: 4, engineOn: true });
    const waiter = TF.spawnTraffic(sim, 'depart');
    let leftWhileTaxiing = false;
    for (let t = 0; t < 25; t++) {
      // Keep rolling: a little power, no brakes, straight along the taxiway.
      sim.aircraft.controls.brakes = 0;
      sim.aircraft.controls.throttle = 0.12;
      sim.input.throttleTarget = 0.12;
      sim.step(1, 1 / 30);
      const c = waiter.ok ? byId(waiter.id) : null;
      if (c && c.phase !== 'parked' && c.phase !== 'startup') leftWhileTaxiing = true;
    }
    const moving = Math.abs(sim.aircraft.groundSpeed || 0);
    // Then stop and sit: after half a minute it is a parking, not a hold. The
    // game's input writes the brakes every frame, so stopping is done the way
    // the player does it — power off, Space held — from a standstill.
    const here = sim.aircraft.pos.clone();
    sim.aircraft.reset({ pos: new THREE.Vector3(here.x, 0, here.z), headingDeg: 270, speed: 0, engineOn: true });
    if (typeof sim.key === 'function') sim.key('Space', true);
    let leftAfter = false;
    let waited = 0;
    for (let t = 0; t < 60 && !leftAfter; t++) {
      sim.input.throttleTarget = 0;
      sim.step(1, 1 / 30);
      waited = t + 1;
      const c = waiter.ok ? byId(waiter.id) : null;
      if (c && c.phase !== 'parked' && c.phase !== 'startup') leftAfter = true;
    }
    if (typeof sim.key === 'function') sim.key('Space', false);
    r.ok('traffic: nobody leaves their slot while you taxi out, and they go once you stop',
      waiter.ok && !leftWhileTaxiing && leftAfter,
      waiter.ok ? `left while you taxied ${leftWhileTaxiing} (you were rolling at ${moving.toFixed(1)} m/s), left ${leftAfter ? `${waited} s after you stopped` : 'never, after you stopped'}` : waiter.why);
  }

  /* ---- manners: 300 m from you in the air, whichever way you meet ---- */
  say('traffic: separation in the air');
  /*
   * One encounter: an arrival added while you sit on the runway (so it holds
   * at its gate in a circle) or while you are off it (so it is cleared on to
   * final), `lead` seconds to settle, then you put `dist` metres from it at
   * its height, `angle` degrees off its nose, flying straight at where it is.
   * A single head-on against a straight path was the first cut's test; a
   * circle turning towards you is the case that came within 357 m.
   */
  /*
   * `chase`: instead of flying straight on, you are put back on a line at it
   * every frame, at `chase` times its speed. And in every encounter, frame by
   * frame, nothing may move further than it can fly: the review found one
   * that had stepped aside for a chasing child jump by up to 1.3 km in the
   * frame it went around.
   */
  let jumps = 0;
  let jumpWhat = '';
  const encounter = (onRunway, angle, lead, dist, chase = 0) => {
    TF.clearTraffic(sim);
    sim.aircraft.reset({ pos: new THREE.Vector3(onRunway ? -200 : -100, 0, onRunway ? 0 : -300), headingDeg: 90, speed: 0, engineOn: true });
    sim.step(0.2, 1 / 30);
    const a = TF.spawnTraffic(sim, 'arrive');
    if (!a.ok) return { min: -1, what: a.why };
    sim.step(lead, 1 / 30);
    const a0 = byId(a.id);
    const pub = sim.traffic.find((e) => e.id === a.id);
    if (!a0 || !pub) return { min: -1, what: 'lost it' };
    const h = ((pub.heading + angle) * Math.PI) / 180;
    const px = a0.pos[0] + Math.sin(h) * dist;
    const pz = a0.pos[2] - Math.cos(h) * dist;
    const ground = Math.max(TR.heightAt(px, pz), 0);
    sim.aircraft.reset({
      pos: new THREE.Vector3(px, 0, pz),
      headingDeg: (pub.heading + angle + 180) % 360,
      speed: 55,
      altAGL: Math.max(60, a0.pos[1] - ground),
      engineOn: true,
    });
    sim.input.throttleTarget = 0.7;
    let min = Infinity;
    const phases = [];
    let prev = null;
    for (let t = 0; t < 30 * (chase ? 60 : 35); t++) {
      if (chase && prev) {
        const p = sim.aircraft.pos;
        const dx = prev.pos[0] - p.x;
        const dz = prev.pos[2] - p.z;
        const d = Math.hypot(dx, dz) || 1;
        const v = Math.max(40, prev.v * chase);
        const nx = p.x + (dx / d) * v / 30;
        const nz = p.z + (dz / d) * v / 30;
        const g = Math.max(TR.heightAt(nx, nz), 0);
        sim.aircraft.reset({
          pos: new THREE.Vector3(nx, 0, nz),
          headingDeg: ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360,
          speed: v,
          altAGL: Math.max(60, prev.pos[1] - g),
          engineOn: true,
        });
      }
      sim.step(1 / 30, 1 / 30);
      const c = byId(a.id);
      if (!c) break;
      if (prev) {
        const dj = Math.hypot(c.pos[0] - prev.pos[0], c.pos[1] - prev.pos[1], c.pos[2] - prev.pos[2]);
        if (dj > (2.2 * Math.max(c.v, prev.v, 10)) / 30 + 5) {
          jumps++;
          if (!jumpWhat) jumpWhat = `${c.callsign} ${dj.toFixed(0)} m in a frame, ${prev.phase} > ${c.phase}`;
        }
      }
      prev = c;
      if (phases[phases.length - 1] !== c.phase) phases.push(c.phase);
      const p = sim.aircraft.pos;
      if (!sim.aircraft.onGround && !c.onGround && !sim.aircraft.crashed) {
        min = Math.min(min, Math.hypot(c.pos[0] - p.x, c.pos[1] - p.y, c.pos[2] - p.z));
      }
    }
    return { min, what: phases.join('>') };
  };
  const meetings = [
    ['head-on, holding at its gate', true, 0, 2, 1800],
    ['head-on, turning in its hold', true, 0, 30, 1800],
    ['head-on, on final', false, 0, 20, 1800],
    ['from the side', true, 90, 10, 1500],
    ['from behind', false, 180, 5, 900],
  ];
  const seps = meetings.map(([name, rw, ang, lead, dist]) => ({ name, ...encounter(rw, ang, lead, dist) }));
  const worst = seps.reduce((m, e) => Math.min(m, e.min < 0 ? -1 : e.min), Infinity);
  r.ok('traffic: keeps 300 m from you in the air, whichever way you meet it', worst >= 300,
    seps.map((e) => `${e.name}: ${e.min < 0 ? e.what : `${Math.round(e.min)} m (${e.what})`}`).join('; '));
  // Chased round its hold, and chased on final: it may be caught (the
  // chase is the known exception to the 300 m), but it never jumps.
  const chased = [encounter(true, 180, 20, 1200, 1.3), encounter(false, 180, 5, 1200, 1.3)];
  r.ok('traffic: chased, or met any way, nothing jumps further in a frame than it can fly', jumps === 0,
    jumps ? `${jumps}: ${jumpWhat}` : `clear; chased: ${chased.map((e) => (e.min < 0 ? e.what : `closest ${Math.round(e.min)} m (${e.what})`)).join('; ')}`);

  /* ---- cost ---- */
  const stats = state().stats;
  r.ok('traffic: costs under 2 ms a frame', stats.ms < 2, `${stats.ms.toFixed(3)} ms average, ${stats.msMax.toFixed(1)} ms worst (incl. model builds), planning worst ${stats.planMsMax.toFixed(1)} ms (${stats.slowest || '-'}), ${realS.toFixed(1)} s to step 9 min`);

  /* ---- on by default, and the switch ---- */
  /*
   * Out of Dev mode now (the owner: "in free flight there's still NPCs
   * flying"): Free Flight with nothing asked for has traffic, unless the
   * "Other aeroplanes" switch is off. The self-test runs every other check
   * with it off (TEST_SETTINGS); here it is put back to the default.
   */
  say('traffic: on by default, and its switch');
  {
    const prog = sim.menus && sim.menus.prog;
    const devWas = !!(prog && prog.devUnlocked);
    if (prog) prog.devUnlocked = false;
    const had = Object.prototype.hasOwnProperty.call(sim.settings, 'traffic');
    const was = sim.settings.traffic;
    delete sim.settings.traffic;
    try {
      await sim.startMode('free', { time: 'day', condition: 'clear', windSpeedKts: 3, windDirDeg: 90 });
      if (sim.state === 'paused') sim.resume();
      const on0 = state();
      r.ok('traffic: on by default in Free Flight, without the Dev passcode', on0.on && on0.craft.length >= 2 && !(prog && prog.devUnlocked),
        `${on0.craft.length} aeroplanes (${on0.why}), dev ${!!(prog && prog.devUnlocked)}`);
      const free = sim.menus && sim.menus.screens && sim.menus.screens.free;
      const box = free && free.querySelector('[data-fpanel="departure"] [data-traffic-switch]');
      const pause = sim.menus && sim.menus.screens && sim.menus.screens.pause;
      const btn = pause && pause.querySelector('[data-traffic-fold] [data-traffic-toggle]');
      r.ok('traffic: "Other aeroplanes" is on the Free Flight Departure tab and in the pause menu, both saying on',
        !!box && box.checked && !!btn && /on$/.test(btn.textContent), `box ${box ? box.checked : 'missing'}, button "${btn ? btn.textContent : 'missing'}"`);
      // Off from the pause menu: the sky empties now.
      if (btn) btn.click();
      sim.step(0.2, 1 / 30);
      const off = state();
      r.ok('traffic: switched off from the pause menu, every AI aeroplane goes at once, and the box follows',
        sim.settings.traffic === false && !off.on && off.craft.length === 0 && (sim.traffic || []).length === 0 && /off$/.test(btn.textContent) && box && !box.checked,
        `setting ${sim.settings.traffic}, ${off.craft.length} left, button "${btn && btn.textContent}", box ${box && box.checked}`);
      await sim.startMode('free', { time: 'day', condition: 'clear', windSpeedKts: 3, windDirDeg: 90 });
      if (sim.state === 'paused') sim.resume();
      r.ok('traffic: switched off, the next Free Flight has none', !state().on && state().craft.length === 0, state().why);
      if (btn) btn.click();
      sim.step(0.2, 1 / 30);
      const back = state();
      r.ok('traffic: switched on again mid-flight, the airfield fills as at a start', back.on && back.craft.length >= 2 && sim.settings.traffic !== false,
        `${back.craft.length} aeroplanes, setting ${sim.settings.traffic}`);
    } finally {
      if (had) sim.settings.traffic = was;
      else delete sim.settings.traffic;
      if (prog) prog.devUnlocked = devWas;
    }
  }

  /* ---- YOUR RUNWAY, in the running game ---- */
  /*
   * The whole flight, with the real flight model and the node test's
   * numbers behind it (traffic.priority.mjs): lined up, the runway is yours —
   * a departure holds short, an arrival is held or sent round, and the tower
   * says so once; away, they use it; back on final, it is yours again.
   */
  say('traffic: your runway');
  {
    const lines = [];
    const speak0 = sim.speak;
    const ownSpeak = Object.prototype.hasOwnProperty.call(sim, 'speak');
    sim.speak = function (text, ...rest) {
      lines.push(String(text));
      return speak0.call(this, text, ...rest);
    };
    try {
      await sim.startMode('free', { time: 'day', condition: 'clear', windSpeedKts: 3, windDirDeg: 90, traffic: true, trafficSeed: 5 });
      if (sim.state === 'paused') sim.resume();
      TF.clearTraffic(sim);
      // Off the runway for a moment so an arrival is cleared on to final; then lined up on 09.
      sim.aircraft.reset({ pos: new THREE.Vector3(-100, 0, -300), headingDeg: 90, speed: 0, engineOn: true });
      sim.step(0.2, 1 / 30);
      const inbound = TF.spawnTraffic(sim, 'arrive');
      const out = TF.spawnTraffic(sim, 'depart');
      sim.step(15, 1 / 30);
      sim.aircraft.reset({ pos: new THREE.Vector3(TR.AIRPORT.runway.cx - TR.AIRPORT.runway.length / 2 + 80, 0, TR.AIRPORT.runway.cz), headingDeg: 90, speed: 0, engineOn: true });
      let landed = false;
      let rolled = false;
      let held = false;
      let entered = false;
      let heldAt = null;
      /*
       * Until the departure is holding short, and a while after — at most
       * four minutes. The first cut gave it 120 s flat, which a departure
       * from a nose-in stand does not make: with the hangar taken by the
       * arrival it is pushed back 86 m at 2 m/s (43 s) and then taxis 530 m,
       * and reaches the holding point a few seconds after the check had
       * stopped looking — and called that a failure, though nobody had landed
       * or rolled and the departure was on its way to hold short.
       */
      let t = 0;
      for (; t < 240 && !(held && t - heldAt >= 30); t++) {
        sim.aircraft.controls.throttle = 0;
        sim.input.throttleTarget = 0;
        sim.aircraft.controls.brakes = 1;
        sim.step(1, 1 / 30);
        for (const c of state().craft) {
          if (c.id === inbound.id && c.phase === 'rollout') landed = true;
          if (c.id === out.id && c.phase === 'takeoff' && c.v > 1) rolled = true;
          if (c.id === out.id && (c.phase === 'lineup' || c.phase === 'takeoff')) entered = true;
          if (c.id === out.id && c.state === 'waiting' && !held) {
            held = true;
            heldAt = t;
          }
        }
      }
      const p1 = TF.priorityState();
      const said = lines.filter((l) => /hold short runway|go around, traffic|make a three-sixty/.test(l));
      r.ok('traffic: lined up on 09, the runway is yours — nobody lands or rolls, the departure holds short',
        p1.me.kind === 'runway' && inbound.ok && out.ok && !landed && !rolled && !entered && held,
        `claim ${p1.me.kind}; landed ${landed}, rolled ${rolled}, entered ${entered}, held ${held ? `from ${heldAt} s` : 'never'}, ${t} s on the runway`);
      r.ok('traffic: ... and the tower says so, once', said.length === 1 && p1.talk.said, said.join(' | ') || 'nothing said');
      // Away: high and far, the way you would climb out and go.
      sim.aircraft.reset({ pos: new THREE.Vector3(9000, 0, -6000), headingDeg: 90, speed: 60, altAGL: 900, engineOn: true });
      sim.input.throttleTarget = 0.7;
      let used = false;
      let t2 = 0;
      for (; t2 < 240 && !used; t2++) {
        sim.step(1, 1 / 30);
        if (state().craft.some((c) => (c.phase === 'takeoff' && c.v > 5) || c.phase === 'rollout')) used = true;
      }
      r.ok('traffic: you leave — the runway is theirs again: a take-off or a landing', TF.priorityState().me.kind === null && used, `claim ${TF.priorityState().me.kind}, used ${used ? `after ${t2} s` : 'never'}`);
      // Back on a 6 km final to 09.
      const rw = TR.AIRPORT.runway;
      const x0 = rw.cx - rw.length / 2 - 6000;
      sim.aircraft.reset({ pos: new THREE.Vector3(x0, 0, rw.cz), headingDeg: 90, speed: 50, altAGL: 330, engineOn: true, gearDown: true });
      sim.step(0.5, 1 / 30);
      const p3 = TF.priorityState();
      r.ok('traffic: back on a 6 km final, it is yours again', p3.me.kind === 'final' && p3.blocks && p3.needAt > 60, `claim ${p3.me.kind}, needed in ${p3.needAt} s`);
      /*
       * Flying PAST the field low — a sightseeing lap's worth of downwind,
       * 1.2 km abeam at 250 m, level, in the trainer (wheels fixed, no
       * flaps): not yours, and the tower keeps quiet. The review's lap of the
       * island at 250 m held the runway for fifteen minutes. Then the flaps
       * come out: that is somebody landing, and the circuit is theirs.
       */
      const said0 = lines.filter((l) => /hold short runway|go around, traffic|make a three-sixty|vacate runway/.test(l)).length;
      let claimedPast = null;
      let blockedPast = false;
      for (let i = 0; i < 12; i++) {
        // Held level by hand each second (a real Skylark sinks a little at this throttle, and a steady descent IS a sign of landing).
        sim.aircraft.reset({ pos: new THREE.Vector3(rw.cx + 300 - i * 50, 0, rw.cz + 1200), headingDeg: 270, speed: 50, altAGL: 250, engineOn: true });
        sim.input.throttleTarget = 0.6;
        sim.step(1, 1 / 30);
        const ps = TF.priorityState();
        // Past the seconds a claim from the run before holds for.
        if (i >= 6 && ps.me.kind) claimedPast = ps.me.kind;
        if (i >= 6 && ps.blocks) blockedPast = true;
      }
      const said1 = lines.filter((l) => /hold short runway|go around, traffic|make a three-sixty|vacate runway/.test(l)).length;
      r.ok('traffic: flying past the field low and level in the trainer — not yours: no claim, nobody held, the tower says nothing',
        claimedPast === null && !blockedPast && said1 === said0,
        `claim ${claimedPast}, blocked ${blockedPast}, tower lines ${said1 - said0}, wheels ${sim.aircraft.gearDown ? 'down (fixed)' : 'up'}`);
      // Flaps out in the same place: landing — the circuit is yours.
      sim.aircraft.setFlaps(1);
      sim.step(1, 1 / 30);
      const p4 = TF.priorityState();
      r.ok('traffic: ... flaps out in the same place — that is a landing: the circuit is yours', p4.me.kind === 'circuit' && p4.blocks, `claim ${p4.me.kind}, blocks ${p4.blocks}, flap step ${sim.aircraft.flapStep()}`);
      sim.aircraft.setFlaps(0);
    } finally {
      if (ownSpeak) sim.speak = speak0;
      else delete sim.speak;
    }
  }

  /* ---- put down on the runway by a reset: the traffic gets off it first ---- */
  /*
   * "Return to the airfield" (the pause menu) and the taxi lesson's "Skip to
   * runway" put you at the start of 09 — where the traffic lines up. The
   * review: an AI aeroplane lined up 3 m behind your tail on three seeds of
   * three, and the tower calling the runway yours. The game now tells the
   * features you have been put down (extensions.js `placed`) and the traffic
   * clears the runway before you appear: a line-up goes back to its holding
   * point, one lined up goes back to its slot.
   */
  say('traffic: put down on the runway by a reset');
  for (const how of ['airport', 'runway']) {
    const lines = [];
    const speak0 = sim.speak;
    const ownSpeak = Object.prototype.hasOwnProperty.call(sim, 'speak');
    sim.speak = function (text, ...rest) {
      lines.push(String(text));
      return speak0.call(this, text, ...rest);
    };
    try {
      await sim.startMode('free', { time: 'day', condition: 'clear', windSpeedKts: 3, windDirDeg: 90, traffic: true, trafficSeed: 21, taxi: how === 'runway' });
      if (sim.state === 'paused') sim.resume();
      TF.clearTraffic(sim);
      // You: away in the sky (the pause menu's way back), or parked at the stand the taxi lesson starts you on.
      if (how === 'airport') {
        sim.aircraft.reset({ pos: new THREE.Vector3(9000, 0, -6000), headingDeg: 90, speed: 60, altAGL: 900, engineOn: true });
        sim.input.throttleTarget = 0.7;
      }
      const dep = TF.spawnTraffic(sim, 'depart');
      const rw = TR.AIRPORT.runway;
      const spot = { x: rw.cx - rw.length / 2 + 80, z: rw.cz };
      const dist = (c) => Math.hypot(c.pos[0] - spot.x, c.pos[2] - spot.z);
      let found = null;
      for (let t = 0; t < 240 && !found; t++) {
        if (how === 'runway') {
          sim.aircraft.controls.throttle = 0;
          sim.input.throttleTarget = 0;
          sim.aircraft.controls.brakes = 1;
        }
        sim.step(1, 1 / 30);
        const c = dep.ok ? byId(dep.id) : null;
        if (c && c.onGround && ((c.phase === 'lineup' && TR.isOnRunway(c.pos[0], c.pos[2], 2)) || (c.phase === 'takeoff' && c.v < 5)) && dist(c) < 120) {
          found = { t, phase: c.phase, d: Math.round(dist(c)) };
        }
      }
      const label = how === 'airport' ? '"Return to the airfield"' : '"Skip to runway"';
      r.ok(`traffic: an AI aeroplane is lining up where ${label} puts you`, dep.ok && !!found, dep.ok ? (found ? `${dep.callsign} ${found.phase}, ${found.d} m from the spot, after ${found.t} s` : `${dep.callsign} never lined up near it: ${JSON.stringify(byId(dep.id) && [byId(dep.id).phase, byId(dep.id).state])}`) : dep.why);
      if (found) {
        // The reset the child does: the pause menu's button, or the HUD's "Skip to runway".
        lines.length = 0;
        let did = false;
        if (how === 'airport') {
          sim.pause();
          const btn = sim.menus && sim.menus.screens && sim.menus.screens.pause && sim.menus.screens.pause.querySelector('[data-act="airport"]');
          if (btn) {
            btn.click();
            did = true;
          } else {
            sim.returnToAirport();
            did = true;
          }
        } else {
          did = sim.taxi && sim.taxi.active;
          sim.hudAction('skipTaxi');
        }
        const p = sim.aircraft.pos;
        const st = state();
        const onRw = st.craft.filter((c) => c.onGround && TR.isOnRunway(c.pos[0], c.pos[2], c.span / 2 + 5) && !(c.phase === 'takeoff' && c.v > 10));
        const near = st.craft.filter((c) => c.onGround && Math.hypot(c.pos[0] - p.x, c.pos[2] - p.z) < 30);
        const moved = byId(dep.id);
        r.ok(`traffic: ${label} — you are at the start of 09 and the traffic has cleared the runway before you appear`,
          did && sim.state === 'flying' && Math.abs(p.x - spot.x) < 20 && Math.abs(p.z - spot.z) < 20 && onRw.length === 0 && near.length === 0,
          `did ${did}, state ${sim.state}, you at (${Math.round(p.x)}, ${Math.round(p.z)}); on the runway: ${onRw.map((c) => `${c.callsign} ${c.phase}`).join(', ') || 'nobody'}; within 30 m: ${near.map((c) => c.callsign).join(', ') || 'nobody'}`);
        r.ok(`traffic: ${label} — the one that was lining up is holding short again, or back on its slot`,
          !!moved && ((moved.state === 'waiting' && moved.phase === 'holding') || moved.state === 'parked'),
          moved ? `${moved.callsign}: ${moved.phase}/${moved.state} at (${Math.round(moved.pos[0])}, ${Math.round(moved.pos[2])})` : 'gone');
        // Sitting there five seconds: nothing comes at you, nothing is "on the runway ahead" (R4), and the tower's line names one really being held.
        let closest = Infinity;
        let holdPos = false;
        for (let t = 0; t < 50; t++) {
          sim.aircraft.controls.throttle = 0;
          sim.input.throttleTarget = 0;
          sim.aircraft.controls.brakes = 1;
          sim.step(0.1, 1 / 30);
          for (const c of state().craft) if (c.onGround) closest = Math.min(closest, Math.hypot(c.pos[0] - p.x, c.pos[2] - p.z));
          if (state().tower.on) holdPos = true;
        }
        const named = lines.filter((l) => /hold short runway|make a three-sixty|go around, traffic|vacate runway/.test(l));
        const heldNames = state().craft.filter((c) => (c.state === 'waiting' && c.phase === 'holding') || c.phase === 'orbit' || c.phase === 'go-around' || c.phase === 'vacate').map((c) => c.callsign.replace(/\s+\d+$/, ''));
        const namesRight = named.every((l) => heldNames.some((n) => l.startsWith(n)));
        r.ok(`traffic: ${label} — five seconds on: nobody within 30 m, no "hold position" (nothing on the runway ahead), you are not crashed, and the tower named only one really being held`,
          closest > 30 && !holdPos && !sim.aircraft.crashed && namesRight,
          `closest ${closest.toFixed(1)} m, hold position ${holdPos}, crashed ${sim.aircraft.crashed}; said: ${named.join(' | ') || 'nothing'}`);
      }
    } finally {
      if (ownSpeak) sim.speak = speak0;
      else delete sim.speak;
    }
  }

  /* ---- the caution panel is placed clear of the Races buttons ---- */
  /*
   * With the traffic on for everybody a TRAFFIC caution is an ordinary thing
   * on final, and at 1366x768 the review found the yellow Races button lying
   * on the MASTER CAUTION lamp — the one you tap to quiet it. The panel
   * measures the HUD's column once a second (warnings.js placePanel) and now
   * counts the races' bar (in the features' own layer) among the things it
   * must sit under.
   */
  {
    await sim.startMode('free', { time: 'day', condition: 'clear', windSpeedKts: 3, windDirDeg: 90, traffic: true, trafficSeed: 3 });
    if (sim.state === 'paused') sim.resume();
    sim.step(3, 1 / 30);
    const bar = document.querySelector('#ext-layer .race-solobar');
    const panel = document.querySelector('.wx-panel');
    const b = bar && !bar.hidden ? bar.getBoundingClientRect() : null;
    const top = panel ? parseFloat(panel.style.top) : NaN;
    const pr = panel ? panel.getBoundingClientRect() : null;
    const cs = panel ? getComputedStyle(panel) : null;
    const pLeft = cs ? (window.innerWidth - parseFloat(cs.right) - parseFloat(cs.width)) : 0;
    const sameColumn = !!b && cs && b.right > pLeft;
    r.ok('traffic: the caution panel is placed below the Races buttons, not under them',
      !b || (b.height > 0 && Number.isFinite(top) && (!sameColumn || top >= b.bottom + 8)),
      b ? `Races bar ${Math.round(b.left)}-${Math.round(b.right)} x ${Math.round(b.top)}-${Math.round(b.bottom)}; panel top ${top}px (column from ${Math.round(pLeft)})${pr ? `, rect ${Math.round(pr.top)}` : ''}` : `no Races bar shown (${bar ? 'hidden' : 'missing'})`);
  }

  /* ---- a jumbo at a big field: its wings clear of the buildings ---- */
  /*
   * The review's soak on the integrated game: a 747 at SFO put a wing tip
   * through a hangar in 74 taxi-out and 28 taxi-in samples. Now it may only
   * use the ways out and in its span clears. Only where this build has a
   * jumbo and a big field; otherwise it says so and passes.
   */
  let AC = null;
  let MP = null;
  try {
    AC = await import('../../src/aircraft/types.js');
    MP = await import('../../src/world/maps.js');
  } catch (err) {
    /* the check below says it was skipped */
  }
  const big = AC && ['b747', 'a380'].find((id) => AC.AIRCRAFT.some((t) => t.id === id));
  const bigMap = MP && ['sfo', 'lax', 'oak'].find((id) => MP.MAPS.some((m) => m.id === id));
  if (!big || !bigMap) {
    r.ok('traffic: a jumbo at a big field keeps its wings out of the buildings', true, 'skipped: no jumbo or no big field in this build');
  } else {
    const before = TR.MAP.id;
    say(`traffic: a ${big} at ${bigMap}`);
    sim.setMap(bigMap);
    for (let i = 0; i < 100 && TR.MAP.id !== bigMap; i++) await new Promise((res) => setTimeout(res, 50));
    await new Promise((res) => setTimeout(res, 800));
    await sim.startMode('free', { time: 'day', condition: 'clear', windSpeedKts: 3, windDirDeg: 90, taxi: true, traffic: true });
    if (sim.state === 'paused') sim.resume();
    TF.clearTraffic(sim);
    const arr2 = TF.spawnTraffic(sim, 'arrive', big);
    /*
     * The other one leaving: a second jumbo if there is a stand left that one
     * can use, else the other jumbo, else anything. With the airport's own
     * parked aeroplanes drawn, SFO keeps one 80 m stand free, not four (the
     * node test builds the apron at low quality, which draws fewer of them
     * and so leaves more stands free).
     */
    let dep2 = TF.spawnTraffic(sim, 'depart', big);
    if (!dep2.ok) {
      const other = ['b747', 'a380'].find((id) => id !== big && AC.AIRCRAFT.some((t) => t.id === id));
      if (other) dep2 = TF.spawnTraffic(sim, 'depart', other);
    }
    if (!dep2.ok) dep2 = TF.spawnTraffic(sim, 'depart');
    const seen2 = { [arr2.id]: [], [dep2.id]: [] };
    let tips = 0;
    let tipWhere = '';
    const wingHit = (c) => {
      const h = (c.hdgDeg * Math.PI) / 180;
      const half = c.span / 2;
      const top = TR.AIRPORT.elev + Math.max(1.5, c.wingY);
      for (const o of TR.OBSTACLES) {
        if (o.y0 > top || o.y1 < TR.AIRPORT.elev + 0.3) continue;
        // The hangar it is parked in is its own.
        if (c.pos[0] > o.x0 - 2 && c.pos[0] < o.x1 + 2 && c.pos[2] > o.z0 - 2 && c.pos[2] < o.z1 + 2) continue;
        for (let k = -20; k <= 20; k++) {
          const x = c.pos[0] + (Math.cos(h) * half * k) / 20;
          const z = c.pos[2] + (Math.sin(h) * half * k) / 20;
          if (x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1) return `${o.what} at (${Math.round(x)}, ${Math.round(z)}) while ${c.phase}`;
        }
      }
      return null;
    };
    for (let t = 0; t < 900 && (arr2.ok || dep2.ok); t++) {
      sim.aircraft.controls.throttle = 0;
      sim.input.throttleTarget = 0;
      sim.aircraft.controls.brakes = 1;
      sim.step(1, 1 / 30);
      for (const c of state().craft) {
        const list = seen2[c.id];
        if (list && list[list.length - 1] !== c.phase) list.push(c.phase);
        if (!c.onGround) continue;
        const w = wingHit(c);
        if (w) {
          tips++;
          if (!tipWhere) tipWhere = `${c.type}: ${w}`;
        }
      }
      if (seen2[arr2.id] && seen2[arr2.id].includes('parked') && seen2[dep2.id] && seen2[dep2.id].includes('climb')) break;
    }
    r.ok(`traffic: a ${big} at ${bigMap} is added, arriving and departing`, arr2.ok && dep2.ok, `${arr2.why || `${arr2.callsign} (${arr2.type})`}; ${dep2.why || `${dep2.callsign} (${dep2.type})`}`);
    r.ok(`traffic: the ${big} at ${bigMap} lands, taxis in and parks, and the other taxis out and takes off`,
      (seen2[arr2.id] || []).includes('parked') && (seen2[dep2.id] || []).includes('takeoff'),
      `${(seen2[arr2.id] || []).join(' > ')} | ${(seen2[dep2.id] || []).join(' > ')}`);
    r.ok(`traffic: the ${big} at ${bigMap} never puts a wing through a building`, tips === 0, tips ? `${tips} s: ${tipWhere}` : 'clear');
    TF.clearTraffic(sim);
    if (TR.MAP.id !== before) {
      sim.setMap(before);
      for (let i = 0; i < 100 && TR.MAP.id !== before; i++) await new Promise((res) => setTimeout(res, 50));
      await new Promise((res) => setTimeout(res, 800));
    }
  }

  /* ---- off where it should be ---- */
  say('traffic: off in the tutorial');
  await sim.startMode('tutorial');
  r.ok('traffic: off in the tutorial', !state().on && state().craft.length === 0 && (sim.traffic || []).length === 0, state().why);
  sim.quitToMenu('main');
  r.ok('traffic: cleared on the way to the menu', state().craft.length === 0);
  sim.autoPauseOnHide = origAutoPause;
}
