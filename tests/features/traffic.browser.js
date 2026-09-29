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
