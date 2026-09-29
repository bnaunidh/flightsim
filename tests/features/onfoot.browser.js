/**
 * Browser checks for getting out and walking about, and for the ramp crew.
 *
 *   const { check } = await import('./tests/features/onfoot.browser.js');
 *   const r = { checks: [], ok(n, p, d) { this.checks.push({ n, p: !!p, d }); } };
 *   window.__sim.renderer.render = () => {};   // a hidden pane never paints
 *   await check(window.__sim, r, console.log); console.table(r.checks);
 *
 * What it drives, all through the real keys (sim.key dispatches the same
 * KeyboardEvents a keyboard does):
 *
 *   the aeroplane  stop on the runway, O out, walk ten metres, run, walk
 *                  into a building and be stopped by it, walk at the sea and
 *                  be stopped by it, O back in, and take off.
 *   the van        O out, walk, O back in.
 *   the ramp crew  the Dev button; the stair truck to the door and the
 *                  passengers down; the tug pinned to the nose leg and a push
 *                  back into the box; the departure; marshalling the next one
 *                  onto the line with the wands.
 *
 * Every import is dynamic and wrapped, so a missing module is one failed
 * check with its name on it.
 */

async function load(path) {
  try {
    return await import(path);
  } catch (e) {
    return { __error: String((e && e.message) || e) };
  }
}

const D2R = Math.PI / 180;

function angleDiff(b, a) {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export async function check(sim, r, say = () => {}) {
  say('onfoot: loading');
  const OF = await load('../../src/features/onfoot.js');
  const SF = await load('../../src/features/staff.js');
  const W = await load('../../src/features/staff/walk.js');
  const TERR = await load('../../src/world/terrain.js');
  const EXT = await load('../../src/game/extensions.js');
  const okLoad = !!(OF && OF.onFoot && SF && SF.staff && W && W.Walker && TERR && TERR.heightAt);
  r.ok('onfoot: its modules load', okLoad, okLoad ? '' : [OF, SF, W].map((m) => m && m.__error).filter(Boolean).join(' | '));
  if (!okLoad) return r;
  const live = EXT && EXT.extStatus ? EXT.extStatus() : [];
  r.ok('onfoot: both features are registered and live', ['onfoot', 'staff'].every((id) => live.some((e) => e.id === id && e.live)), JSON.stringify(live));

  const foot = OF.onFoot;
  const staff = SF.staff;
  const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ControlLeft'];
  const allUp = () => {
    for (const c of KEYS) sim.key(c, false);
  };
  const dt = 1 / 60;
  const run = (secs, each) => {
    const n = Math.round(secs / dt);
    for (let i = 0; i < n; i++) {
      sim.update(dt);
      if (each && each(i * dt) === true) return true;
    }
    return false;
  };

  /* ================================================================ */
  say('onfoot: out of the aeroplane');
  allUp();
  await sim.startMode('free', { aircraft: 'skylark', taxi: false });
  run(1.5);
  const ac = sim.aircraft;
  r.ok('onfoot: the aeroplane starts stopped on the ground', ac.onGround && ac.groundSpeed < 1, `gs ${ac.groundSpeed.toFixed(2)}`);
  const parked = ac.pos.clone();
  const overrideBefore = sim.override;
  sim.tap('KeyO');
  run(0.6);
  const s0 = foot.snapshot();
  r.ok('onfoot: O gets you out of the aeroplane', s0.active && s0.from === 'aircraft', JSON.stringify({ active: s0.active, from: s0.from }));
  if (!s0.active) return r;
  const dOut = Math.hypot(s0.x - parked.x, s0.z - parked.z);
  r.ok('onfoot: you are standing beside the aeroplane, not in it', dOut > 1 && dOut < 8, `${dOut.toFixed(1)} m from its middle`);
  r.ok('onfoot: the aeroplane is parked: engine off, brakes on, throttle shut',
    !ac.engineOn && sim.override && sim.override.brakes === 1 && sim.override.throttle === 0);
  let meshes = 0;
  if (foot.model) foot.model.traverse((o) => { if (o.isMesh && o.visible) meshes++; });
  r.ok('onfoot: the walker is a handful of draw calls', meshes > 0 && meshes <= 12, `${meshes} meshes`);
  r.ok('onfoot: the prompt says how to get back in', /get in/i.test(s0.prompt), s0.prompt);

  /*
   * Paused while walking: nothing of the walker's over the pause screen. The
   * feature layer is above the menus, and update() does not run while
   * paused; on a phone the look pad was the element under Restart and Quit to
   * menu. 30 ms is inside the watcher's quarter-second timer, so this is the
   * menu observer's work.
   */
  const ofRoot = document.querySelector('.of-root');
  sim.pause();
  await new Promise((res) => setTimeout(res, 30));
  const hiddenPaused = !!ofRoot && getComputedStyle(ofRoot).display === 'none';
  const covered = [...document.querySelectorAll('.menu-layer button')].filter((b) => {
    if (!b.offsetParent) return false;
    const q = b.getBoundingClientRect();
    const top = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
    return !!(top && top.closest && top.closest('.of-root'));
  }).map((b) => b.textContent.trim());
  sim.resume();
  run(0.1);
  const shownAgain = !!ofRoot && getComputedStyle(ofRoot).display !== 'none' && foot.active;
  r.ok('onfoot: paused, nothing of the walker’s is over the pause screen, and it is back on Resume',
    hiddenPaused && covered.length === 0 && shownAgain, `hidden ${hiddenPaused}; covering ${covered.join(', ') || 'nothing'}; back ${shownAgain}`);

  // Walk ten metres, with W, along the way the camera looks.
  foot.setCamera(ac.heading, -12);
  sim.key('KeyW', true);
  run(0.5);
  const wHeld = sim.input.keys.has('KeyW');
  run(6.5);
  sim.key('KeyW', false);
  run(0.4);
  const s1 = foot.snapshot();
  const walked = Math.hypot(s1.x - s0.x, s1.z - s0.z);
  r.ok('onfoot: W walks you ten metres', walked >= 10, `${walked.toFixed(1)} m in 7 s`);
  r.ok('onfoot: W went to the walker, never to the aeroplane', !wHeld);
  r.ok('onfoot: the parked aeroplane did not move while you walked', ac.pos.distanceTo(parked) < 0.3, `${ac.pos.distanceTo(parked).toFixed(2)} m`);
  r.ok('onfoot: feet on the ground', Math.abs(s1.y - W.groundAt(s1.x, s1.z)) < 0.06, `${(s1.y - W.groundAt(s1.x, s1.z)).toFixed(3)} m`);
  const camD = Math.hypot(sim.camera.position.x - s1.x, sim.camera.position.z - s1.z);
  r.ok('onfoot: the camera follows the walker', camD < 8, `${camD.toFixed(1)} m away`);

  sim.key('ShiftLeft', true);
  sim.key('KeyW', true);
  run(1.5);
  const runSpeed = foot.walker.speed;
  sim.key('KeyW', false);
  sim.key('ShiftLeft', false);
  run(0.5);
  r.ok('onfoot: Shift runs', runSpeed > 4, `${runSpeed.toFixed(1)} m/s`);

  sim.tap('KeyC');
  run(0.1);
  const v1 = foot.view;
  sim.tap('KeyC');
  run(0.1);
  const v2 = foot.view;
  sim.tap('KeyC');
  run(0.1);
  r.ok('onfoot: C changes the view and comes back round', v1 !== 'chase' && v2 !== v1 && foot.view === 'chase', `${v1}, ${v2}, ${foot.view}`);

  /* ---- a building ---- */
  say('onfoot: into a wall');
  const wall = findWall(TERR, W, ac.pos);
  if (!wall) {
    r.ok('onfoot: there is a building near the airfield to walk into', false, `${TERR.OBSTACLES.length} obstacles`);
  } else {
    foot.place(wall.x, wall.z, wall.heading);
    foot.setCamera(wall.heading, -10);
    let inside = 0;
    const o = wall.o;
    const rr = W.WALK.radius - 0.02;
    sim.key('KeyW', true);
    run(6, () => {
      const w = foot.walker;
      if (w.x > o.x0 - rr && w.x < o.x1 + rr && w.z > o.z0 - rr && w.z < o.z1 + rr) inside++;
    });
    sim.key('KeyW', false);
    run(0.3);
    const w = foot.walker;
    const gap = Math.max(o.x0 - w.x, w.x - o.x1, o.z0 - w.z, w.z - o.z1);
    r.ok(`onfoot: you cannot walk through ${String(o.what || 'a building').replace(/^You (flew|hit) into /, '')}`,
      inside === 0 && gap < 0.6, `stopped ${gap.toFixed(2)} m from the wall after walking at it for 6 s; ${inside} frames inside`);
  }

  /* ---- the sea ---- */
  say('onfoot: into the sea');
  const shore = findShore(TERR, ac.pos);
  if (!shore) {
    r.ok('onfoot: there is a shore to walk into', false);
  } else {
    foot.place(shore.x, shore.z, shore.heading);
    foot.setCamera(shore.heading, -10);
    let deepest = 99;
    sim.key('KeyW', true);
    run(12, () => {
      deepest = Math.min(deepest, TERR.heightAt(foot.walker.x, foot.walker.z));
    });
    sim.key('KeyW', false);
    run(0.3);
    r.ok('onfoot: you cannot walk into deep water', deepest >= W.WALK.deep - 0.02, `deepest sea bed stood on ${deepest.toFixed(2)} m (limit ${W.WALK.deep}); stopped by ${foot.walker.lastBlock || 'nothing'}`);
  }

  /* ---- back in and away ---- */
  say('onfoot: back in and fly away');
  foot.place(s0.x, s0.z, s0.heading);
  run(0.3);
  const pr = foot.snapshot().prompt;
  r.ok('onfoot: next to the aeroplane it says "Press O to get in"', /press <kbd>o<\/kbd> to get in|tap here to get in/i.test(pr), pr);
  sim.tap('KeyO');
  run(0.2);
  r.ok('onfoot: O by the door gets you back in', !foot.active);
  r.ok('onfoot: the aeroplane has its controls back', sim.override === (overrideBefore || null) || (!sim.override && !overrideBefore));
  run(2.5);
  r.ok('onfoot: the engine starts again', ac.engineOn);
  sim.key('ShiftLeft', true);
  let rotated = false;
  const flew = run(70, () => {
    if (!rotated && ac.ias * 1.94384 > 56) {
      rotated = true;
      sim.key('KeyS', true);
    }
    if (rotated && ac.agl > 8 && ac.ias * 1.94384 < 60) sim.key('KeyS', false);
    return ac.agl > 20 && !ac.onGround;
  });
  allUp();
  r.ok('onfoot: and you can fly away', flew && !ac.crashed, `agl ${ac.agl.toFixed(0)} m, ${Math.round(ac.ias * 1.94384)} kt`);

  /* ---- walking cost ---- */
  say('onfoot: cost');
  await sim.startMode('free', { aircraft: 'skylark', taxi: false });
  run(1);
  /*
   * The quickest of five blocks each way, not one block each: this runs on a
   * machine where other work gets the CPU in slices, and a single block
   * measured 0.65 ms one run and 3.5 ms the next for the same frames.
   */
  const tIdle = timeFrames(sim, 60, 5);
  sim.tap('KeyO');
  sim.key('KeyW', true);
  run(0.5);
  const tWalk = timeFrames(sim, 60, 5);
  sim.key('KeyW', false);
  r.ok('onfoot: walking adds under a millisecond a frame', tWalk - tIdle < 1, `${tIdle.toFixed(2)} ms flying, ${tWalk.toFixed(2)} ms walking`);
  sim.tap('KeyO');
  run(0.2);
  if (foot.active) foot.end(sim);

  /* ================================================================ */
  say('onfoot: the van');
  if (typeof sim.startDrive === 'function') {
    sim.startDrive('car');
    run(1);
    const v = sim.vehicle;
    const vp = v.pos.clone();
    sim.tap('KeyO');
    run(0.5);
    r.ok('onfoot: O gets you out of the van', foot.active && foot.snapshot().from === 'vehicle');
    const a = foot.snapshot();
    foot.setCamera((v.heading + 90) % 360, -10);
    sim.key('KeyW', true);
    run(3);
    sim.key('KeyW', false);
    run(0.3);
    r.ok('onfoot: the van stays parked while you walk', v.pos.distanceTo(vp) < 0.3, `${v.pos.distanceTo(vp).toFixed(2)} m`);
    foot.place(a.x, a.z);
    run(0.2);
    sim.tap('KeyO');
    run(0.2);
    r.ok('onfoot: O by the van gets you back in', !foot.active);

    /* ---- the boat, alongside the quay it starts at ---- */
    say('onfoot: the boat');
    sim.startDrive('boat');
    run(2);
    const b = sim.vehicle;
    // She starts mid-harbour, well off the wall: O says to come alongside.
    sim.tap('KeyO');
    run(0.3);
    const told = [...document.querySelectorAll('.hud-toast')].some((t) => /alongside/i.test(t.textContent));
    r.ok('onfoot: out in the harbour, O says to bring her alongside first', !foot.active && told);
    // Put her alongside: the nearest wall, four metres off it in deep water.
    const berth = findQuay(TERR, b.pos);
    if (berth) {
      b.pos.x = berth.x;
      b.pos.z = berth.z;
      b.speed = 0;
      run(1.5);
    }
    const bp = b.pos.clone();
    sim.tap('KeyO');
    run(0.8);
    const onQuay = foot.active && foot.snapshot().from === 'vehicle';
    r.ok('onfoot: O steps you off the boat onto the quay', onQuay && TERR.heightAt(foot.walker.x, foot.walker.z) > 0.2,
      onQuay ? `standing ${TERR.heightAt(foot.walker.x, foot.walker.z).toFixed(1)} m above the sea` : foot.snapshot().prompt || 'still aboard');
    if (onQuay) {
      const q = foot.snapshot();
      run(3);
      r.ok('onfoot: the boat stays moored while you are ashore', b.pos.distanceTo(bp) < 1, `${b.pos.distanceTo(bp).toFixed(2)} m`);
      foot.place(q.x, q.z);
      run(0.2);
      sim.tap('KeyO');
      run(0.3);
      r.ok('onfoot: O on the quay gets you back aboard', !foot.active);
    }
    // "Work at the airport" from the boat's own map: the shift opens,
    // at the home airfield if this map has no apron to work on.
    if (foot.active) foot.end(sim);
    const boatMap = sim.settings.map;
    /*
     * What the menu should go back to: whatever the boat trip borrowed its
     * map from (main.js keeps one mapBeforeMission, and each borrow in a row
     * overwrites it; the shift must not).
     */
    const chosenMap = sim.mapBeforeMission || sim.settings.map;
    const opened = staff.start(sim);
    run(0.5);
    r.ok('staff: the Dev button opens a shift even from the boat’s map', opened && staff.active && foot.active,
      `from ${boatMap} to ${sim.settings.map}; ${[...document.querySelectorAll('.hud-toast')].map((t) => t.textContent).join(' | ')}`);
    // The menu puts back the map you chose.
    const shiftMap = sim.settings.map;
    if (foot.active) foot.end(sim);
    sim.quitToMenu('main');
    run(0.2);
    r.ok('staff: back at the menu, the map before the shift is put back', sim.settings.map === chosenMap,
      `chose ${chosenMap}, boat on ${boatMap}, worked on ${shiftMap}, now ${sim.settings.map}`);
  }

  /* ================================================================ */
  say('onfoot: the ramp crew');
  await rampCrew(sim, r, say, { foot, staff, W, TERR, run, allUp });

  allUp();
  if (foot.active) foot.end(sim);
  sim.quitToMenu && sim.quitToMenu('main');
  r.ok('onfoot: back at the menu the ramp crew packs up', !staff.active && !foot.active);
  return r;
}

function timeFrames(sim, n, blocks = 1) {
  let best = Infinity;
  for (let b = 0; b < blocks; b++) {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) sim.update(1 / 60);
    best = Math.min(best, (performance.now() - t0) / n);
  }
  return best;
}

/**
 * A parked aeroplane the apron draws as instances ("parked:<type>|<livery>"),
 * on a stand in the open: { x, z, heading, type }, or null.
 */
function parkedInstance(sim) {
  const g = sim.apron && sim.apron.group;
  if (!g || !g.traverse) return null;
  let out = null;
  g.updateMatrixWorld(true);
  g.traverse((o) => {
    if (out || !o.isInstancedMesh || !/^parked:/.test(o.name || '') || !(o.count > 0)) return;
    const m = new o.matrixWorld.constructor();
    o.getMatrixAt(0, m);
    m.premultiply(o.matrixWorld);
    const e = m.elements;
    out = { x: e[12], z: e[14], heading: ((Math.atan2(-e[8], e[10]) * 180) / Math.PI + 360) % 360, type: o.name.slice(7).split('|')[0] };
  });
  return out;
}

/** A building near here with open, dry, flat ground in front of one face. */
function findWall(TERR, W, near) {
  let best = null;
  for (const o of TERR.OBSTACLES) {
    if (o.y1 - o.y0 < 3 || o.x1 - o.x0 < 5 || o.z1 - o.z0 < 5) continue;
    const faces = [
      { x: (o.x0 + o.x1) / 2, z: o.z1 + 5, heading: 0 },
      { x: (o.x0 + o.x1) / 2, z: o.z0 - 5, heading: 180 },
      { x: o.x1 + 5, z: (o.z0 + o.z1) / 2, heading: 270 },
      { x: o.x0 - 5, z: (o.z0 + o.z1) / 2, heading: 90 },
    ];
    for (const f of faces) {
      const h = TERR.heightAt(f.x, f.z);
      if (h < 0.5) continue;
      if (Math.abs(W.groundAt(f.x, f.z) - o.y0) > 1.5) continue;
      if (W.solidAt(f.x, f.z, W.groundAt(f.x, f.z), 1.5, null)) continue;
      const d = Math.hypot(f.x - near.x, f.z - near.z);
      if (!best || d < best.d) best = { ...f, o, d };
    }
  }
  return best;
}

/** Deep water four metres off the nearest dry land to `from`, or null. */
function findQuay(TERR, from) {
  let best = null;
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    const sx = Math.sin(a);
    const sz = -Math.cos(a);
    for (let d = 2; d < 120; d += 1) {
      if (TERR.heightAt(from.x + sx * d, from.z + sz * d) > 0.3) {
        if (!best || d < best.d) best = { d, sx, sz };
        break;
      }
    }
  }
  if (!best) return null;
  for (let back = 4; back < 12; back += 0.5) {
    const x = from.x + best.sx * (best.d - back);
    const z = from.z + best.sz * (best.d - back);
    if (TERR.heightAt(x, z) < -1.4) return { x, z };
  }
  return null;
}

/** A point just inland of a coast, facing the sea. */
function findShore(TERR, from) {
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const sx = Math.sin(a);
    const sz = -Math.cos(a);
    let wet = -1;
    for (let d = 50; d < 9000; d += 25) {
      if (TERR.heightAt(from.x + sx * d, from.z + sz * d) < -3) {
        wet = d;
        break;
      }
    }
    if (wet < 0) continue;
    // Back up to dry land, then a few metres more.
    let dry = -1;
    for (let d = wet; d > 0; d -= 1) {
      if (TERR.heightAt(from.x + sx * d, from.z + sz * d) > 0.6) {
        dry = d - 6;
        break;
      }
    }
    if (dry < 0) continue;
    const x = from.x + sx * dry;
    const z = from.z + sz * dry;
    if (TERR.obstacleAt(x, TERR.heightAt(x, z) + 1, z)) continue;
    return { x, z, heading: (a * 180) / Math.PI };
  }
  return null;
}

async function rampCrew(sim, r, say, { foot, staff, W, TERR, run, allUp }) {
  const J = staff.J;
  allUp();
  await sim.startMode('free', { aircraft: 'skylark', taxi: false });
  run(0.5);
  /*
   * Only the toasts from here on. With the boat team's HUD, toasts from the
   * boat trip above were still in the page at the start of the shift, and
   * the boat's own "Out you go" read as the patrol starting on the apron.
   */
  for (const t of document.querySelectorAll('.hud-toast')) t.dataset.onfootOld = '1';
  const toasts = () => [...document.querySelectorAll('.hud-toast:not([data-onfoot-old])')].map((t) => t.textContent);
  const started = staff.start(sim);
  run(0.5);
  r.ok('staff: "Work at the airport" starts a shift', started && staff.active,
    `job ${staff.job}, map ${sim.settings.map}; ${toasts().join(' | ')}`);
  if (!staff.active) return;
  const snap = foot.snapshot();
  r.ok('staff: you start on foot in a hi-vis vest', snap.active && snap.outfit === 'staff');
  const fleet = staff.fleet;
  const ids = ['tug', 'baggage', 'stairs', 'catering'];
  r.ok('staff: four vehicles on the apron', ids.every((id) => fleet[id] && fleet[id].model && fleet[id].model.parent), ids.map((id) => `${id}:${!!(fleet[id] && fleet[id].model.parent)}`).join(' '));
  r.ok('staff: an airliner parked on the stand', !!(staff.plane && staff.plane.model.visible && staff.plane.model.parent));
  r.ok('staff: the plane is on dry, level apron', Math.abs(W.groundAt(staff.plane.x, staff.plane.z) - W.groundAt(staff.stand.x, staff.stand.z)) < 0.5);
  const rs = sim.runner;
  r.ok('staff: no boat patrol running on the apron',
    !(rs.status === 'running' && rs.def && rs.def.vehicle === 'boat') && !toasts().some((t) => /putty|Keep the radio on/i.test(t)),
    `runner ${rs.status} ${rs.def && rs.def.id}; toasts: ${toasts().join(' | ')}`);

  // The airliners the apron parks on the other stands are solid to walk into.
  const other = (sim.apron && sim.apron.stands || []).find((s) => s.ac);
  const inst = other ? null : parkedInstance(sim);
  if (other) {
    const cx = other.x;
    const cz = other.z + 6 - 3; // a little ahead of the wing
    foot.place(cx + 9, cz, 270);
    foot.setCamera(270, -10);
    sim.key('KeyW', true);
    run(4);
    sim.key('KeyW', false);
    run(0.2);
    const gap = foot.walker.x - cx;
    r.ok('onfoot: you cannot walk through the airliner parked on the next stand', gap > 1.2, `stopped ${gap.toFixed(2)} m from its centreline by ${foot.walker.lastBlock || 'nothing'}`);
  } else if (inst) {
    /*
     * The rebuilt airfield draws its parked airliners as instances. Walk at
     * one's fuselage from ten metres off its side, level with the middle.
     */
    const side = (inst.heading + 90) % 360;
    const st = J.offset(inst.x, inst.z, inst.heading, 0, 10);
    foot.place(st.x, st.z, (side + 180) % 360);
    foot.setCamera((side + 180) % 360, -10);
    sim.key('KeyW', true);
    run(6);
    sim.key('KeyW', false);
    run(0.2);
    const gap = Math.abs(J.local(inst.x, inst.z, inst.heading, foot.walker.x, foot.walker.z).side);
    r.ok(`onfoot: you cannot walk through the ${inst.type} parked on a stand`, gap > 1.2 && gap < 6,
      `stopped ${gap.toFixed(2)} m from its centreline by ${foot.walker.lastBlock || 'nothing'}`);
  }
  const ms = staff.spots.marshal;
  r.ok('staff: the marshalling spot is clear, with a clear view of the stop line',
    !W.solidAt(ms.x, ms.z, W.groundAt(ms.x, ms.z), 0.8, null), `at ${ms.x.toFixed(1)}, ${ms.z.toFixed(1)}`);

  // Walk up to the stair truck and get in.
  const into = (id) => {
    const e = fleet[id];
    const p = J.offset(e.x, e.z, e.heading, 0, -(e.info.halfWidth + 1.0));
    foot.place(p.x, p.z);
    run(0.2);
    sim.tap('KeyO');
    run(0.3);
    return sim.vehicle && sim.vehicle.spec && sim.vehicle.spec.id === id && !foot.active;
  };
  const inStairs = into('stairs');
  r.ok('staff: walk up to the stair truck and O gets you in', inStairs, `driving ${sim.vehicle && sim.vehicle.spec.id}`);
  r.ok('staff: the stair truck is drawn as itself, not as the van', sim.vehicleModel === fleet.stairs.model);
  r.ok('staff: the tug is still parked where it was', fleet.tug.model.parent && fleet.tug.model.visible !== false);
  if (!inStairs) return;

  say('staff: stairs');
  const door = J.doorPose(staff.plane, staff.plane.prof, 'front');
  const place = J.dockedPlace(fleet.stairs.info.reach, door);
  const start = J.offset(place.x, place.z, place.heading, -5, 0.4);
  staff.placeVehicle(sim, start.x, start.z, (place.heading + 4) % 360);
  run(0.2);
  sim.key('ShiftLeft', true);
  const docked = run(6, () => staff.job === 'passengers');
  sim.key('ShiftLeft', false);
  r.ok('staff: drive the stairs to the door and they dock', docked, `job ${staff.job}`);
  r.ok('staff: a clean approach at full speed is not graded on its outer edge', staff.stars.stairs >= 2, `${staff.stars.stairs} stars`);
  run(4);
  r.ok('staff: the steps rise and passengers come down', staff.passengers > 0, `${staff.passengers} passengers`);
  // Hop out and wave: somebody at the foot of the steps waves back.
  sim.tap('KeyO');
  run(0.5);
  if (foot.active) {
    const pl = staff.plane;
    const near = J.offset(pl.x, pl.z, pl.heading, pl.prof.nose + 8, -3);
    foot.place(near.x, near.z);
    run(1);
    for (let i = 0; i < 6 && !staff.wavedBack; i++) {
      sim.tap('KeyE');
      run(1);
    }
    r.ok('staff: wave (E) at the passengers and one waves back', staff.wavedBack > 0, `${staff.wavedBack} waved back of ${staff.passengers}`);
    into('stairs');
  } else {
    r.ok('staff: O gets you out of the docked stair truck', false);
  }
  const off = run(30, () => staff.job !== 'passengers');
  r.ok('staff: everyone gets off and the steps come down', off && staff.job === 'clear', `job ${staff.job}`);

  // Back the stairs off.
  const sp = staff.spots.stairs;
  staff.placeVehicle(sim, sp.x, sp.z, sp.heading);
  run(0.5);
  r.ok('staff: with the stairs out of the way it is time to push back', staff.job === 'push', `job ${staff.job}`);

  say('staff: pushback');
  sim.tap('KeyO');
  run(0.4);
  const inTug = into('tug');
  r.ok('staff: out of the stairs and into the tug', inTug);
  if (!inTug) return;
  const plane = staff.plane;
  const prof = plane.prof;
  const th = (plane.heading + 180) % 360;
  const ng = J.noseGearPoint(plane, prof);
  const tstart = J.offset(ng.x, ng.z, th, -(fleet.tug.info.hitch + 3), 0);
  staff.placeVehicle(sim, tstart.x, tstart.z, th);
  run(0.2);
  sim.key('ShiftLeft', true);
  const hooked = run(5, () => staff.hooked);
  sim.key('ShiftLeft', false);
  sim.key('Space', true);
  run(0.6);
  sim.key('Space', false);
  r.ok('staff: the tug pins itself to the nose leg', hooked);
  if (!hooked) return;

  // Hop out mid-push, drive the stairs a little, and hop back in the tug:
  // the stairs are not towed, and the tug is still on the bar.
  sim.tap('KeyO');
  run(0.4);
  const sBefore = { x: fleet.stairs.x, z: fleet.stairs.z };
  const inStairs2 = into('stairs');
  sim.key('ShiftLeft', true);
  run(1.6);
  sim.key('ShiftLeft', false);
  // Stopped properly: O will not let you out of a moving truck. Ctrl is the
  // brake (Space, the handbrake, left one still at 1.4 m/s after 2.5 s).
  sim.key('ControlLeft', true);
  run(4, () => Math.abs(sim.vehicle.speed) < 0.05);
  sim.key('ControlLeft', false);
  run(0.3);
  const ngNow = J.noseGearPoint(plane, prof);
  const sv = sim.vehicle;
  const stairsFree = inStairs2 && Math.hypot(sv.pos.x - sBefore.x, sv.pos.z - sBefore.z) > 1 &&
    Math.hypot(sv.pos.x - ngNow.x, sv.pos.z - ngNow.z) > 8;
  sim.tap('KeyO');
  run(0.4);
  const backInTug = into('tug');
  r.ok('staff: mid-push you can take another vehicle; only the tug is on the bar', stairsFree && backInTug && staff.hooked,
    `stairs driven ${inStairs2 ? Math.hypot(sv.pos.x - sBefore.x, sv.pos.z - sBefore.z).toFixed(1) : '-'} m, back in the tug ${backInTug}, hooked ${staff.hooked}`);
  if (!backInTug) return;

  const p0 = { x: plane.x, z: plane.z, heading: plane.heading };
  const box = staff.pushBox;
  let maxBend = 0;
  let pinErr = 0;
  let phase = 0;
  sim.key('ShiftLeft', true);
  const cam0 = sim.camera.position.clone();
  let camInside = 0;
  let end = null;
  const pushed = run(90, () => {
    const v = sim.vehicle;
    const back = -J.local(p0.x, p0.z, p0.heading, plane.x, plane.z).along;
    const tip = J.hitchPoint(v.pos.x, v.pos.z, v.heading, fleet.tug.info.hitch);
    const g = J.noseGearPoint(plane, prof);
    pinErr = Math.max(pinErr, Math.hypot(tip.x - g.x, tip.z - g.z));
    maxBend = Math.max(maxBend, Math.abs(J.towAngle(v.heading, plane.heading)));
    const c = sim.camera.position;
    if (TERR.obstacleAt(c.x, c.y, c.z)) camInside++;
    // Straight back until the nose is off the stand, then swing the tail.
    if (phase === 0 && back > Math.max(4, prof.nose * 0.6)) phase = 1;
    if (phase === 1) {
      const want = J.angleDiff(box.heading, plane.heading);
      const tugWant = (plane.heading + 180 + Math.max(-50, Math.min(50, want * 1.5)) + 360) % 360;
      const e = J.angleDiff(tugWant, v.heading);
      sim.key('KeyD', e > 2);
      sim.key('KeyA', e < -2);
      const ib = J.inPushBox(plane, box, 5, 12);
      if (ib.ok) {
        sim.key('ShiftLeft', false);
        sim.key('KeyD', false);
        sim.key('KeyA', false);
        sim.key('Space', true);
      }
    }
    if (staff.job === 'depart') {
      end = { along: J.local(p0.x, p0.z, p0.heading, plane.x, plane.z).along, side: J.local(p0.x, p0.z, p0.heading, plane.x, plane.z).side };
      return true;
    }
    return false;
  });
  allUp();
  const moved = Math.hypot(plane.x - p0.x, plane.z - p0.z);
  r.ok('staff: the tug pushes the aeroplane back, nose leg pinned to the bar', moved > 8 && pinErr < 0.1, `moved ${moved.toFixed(1)} m, pin error ${pinErr.toFixed(3)} m`);
  r.ok('staff: the towbar never folds past its stop', maxBend <= 60.5, `${maxBend.toFixed(1)} degrees`);
  r.ok('staff: a driver who follows the box finishes in it', pushed && staff.stars.push >= 2, `stars ${staff.stars.push}; plane ${Math.hypot(plane.x - box.x, plane.z - box.z).toFixed(1)} m from the box, heading off by ${Math.abs(J.angleDiff(box.heading, plane.heading)).toFixed(0)}`);
  r.ok('staff: a pushback ends behind the stand, not beside the next one', end && end.along < -6 && Math.abs(end.side) < prof.len, end ? `${(-end.along).toFixed(1)} m back, ${end.side.toFixed(1)} m over` : 'never finished');
  r.ok('staff: the camera stays out of the buildings while you push', camInside === 0 && sim.camera.position.distanceTo(cam0) > 0, `${camInside} frames inside`);
  if (!pushed) {
    // Put it in the box by hand so the rest of the shift can be checked.
    staff.setJob(sim, 'next');
  }

  say('staff: departure and arrival');
  if (pushed) {
    // The tug unhooks and pulls clear by itself, out beyond the wingtip.
    const pl = staff.plane;
    run(3.5);
    const tg = fleet.tug;
    const ngp = J.noseGearPoint(pl, prof);
    const tugOff = Math.hypot(tg.x - ngp.x, tg.z - ngp.z);
    r.ok('staff: after the push the tug pulls clear of the nose by itself', tugOff > prof.halfSpan && !staff.pathBlock,
      `${tugOff.toFixed(1)} m from the nose leg; in the way: ${staff.pathBlock || 'nothing'}`);
    // Park the stair truck across its path: the pilot waits, then goes.
    run(1.5);
    const st = fleet.stairs;
    const keep = { x: st.x, z: st.z, heading: st.heading };
    const ahead = J.offset(pl.x, pl.z, pl.heading, prof.nose + 6, 0);
    st.x = ahead.x;
    st.z = ahead.z;
    st.heading = (pl.heading + 90) % 360;
    run(4);
    const at = { x: pl.x, z: pl.z };
    run(2);
    const waited = staff.pathBlock === 'stairs' && Math.hypot(pl.x - at.x, pl.z - at.z) < 0.05;
    st.x = keep.x;
    st.z = keep.z;
    st.heading = keep.heading;
    run(3);
    const rolled = Math.hypot(pl.x - at.x, pl.z - at.z);
    r.ok('staff: a taxiing aeroplane waits for the stair truck in its way, then goes', waited && rolled > 1,
      `waited ${waited}; rolled ${rolled.toFixed(1)} m once it was moved`);
  }
  const arrived = run(60, () => staff.job === 'marshal');
  r.ok('staff: the pushed aeroplane taxis away and the next one comes', arrived, `job ${staff.job}; in its way: ${staff.pathBlock || 'nothing'}`);
  if (!arrived) return;

  say('staff: marshal');
  sim.tap('KeyO');
  run(0.4);
  const spot = staff.spots.marshal;
  foot.place(spot.x + 0.8, spot.z + 0.3);
  run(0.3);
  r.ok('staff: stand on the spot and the wands come out', staff.marshalling && foot.control != null);
  if (!staff.marshalling) return;
  // O puts them away, and you can walk off; back on the spot they come out again.
  sim.tap('KeyO');
  run(0.2);
  const away = !staff.marshalling && foot.control == null;
  const at0 = { x: foot.walker.x, z: foot.walker.z };
  foot.setCamera((staff.stand.heading + 90) % 360, -10);
  sim.key('KeyW', true);
  run(2.5);
  sim.key('KeyW', false);
  run(0.2);
  const walkedOff = Math.hypot(foot.walker.x - at0.x, foot.walker.z - at0.z);
  foot.place(spot.x, spot.z);
  run(0.3);
  r.ok('staff: O puts the wands away, you can walk off, and they come out again on the spot',
    away && walkedOff > 3 && staff.marshalling, `away ${away}, walked ${walkedOff.toFixed(1)} m, marshalling again ${staff.marshalling}`);
  if (!staff.marshalling) return;
  let result = null;
  let held = '';
  const setSig = (k) => {
    if (held === k) return;
    if (held) sim.key(held, false);
    held = k;
    if (k) sim.key(k, true);
  };
  run(90, () => {
    const a = staff.arrival;
    if (!a) {
      result = 'done';
      return true;
    }
    const e = a.errors();
    if (e.along > -0.4) setSig('Space');
    else {
      const want = Math.max(-8, Math.min(8, -e.side * 4));
      const herr = e.head - want;
      if (herr > 1.5) setSig('KeyD');
      else if (herr < -1.5) setSig('KeyA');
      else setSig('KeyW');
    }
    return false;
  });
  setSig('');
  allUp();
  const st = staff.stars;
  r.ok('staff: marshalled onto the line', result === 'done' && st.round === 2 && staff.job === 'stairs', `round ${st.round}, job ${staff.job}, total ${st.total} stars`);
  r.ok('staff: the wands go away afterwards', !staff.marshalling && foot.control == null);

  // Restart from the pause menu starts the shift over, on foot, in the vest.
  const before = sim.vehicle;
  sim.restart();
  // startMode awaits the audio before it does anything, so nothing has
  // happened yet: yield, then wait for a new vehicle and the shift on foot.
  for (let i = 0; i < 60 && !(sim.vehicle && sim.vehicle !== before && staff.active && foot.active); i++) {
    await new Promise((res) => setTimeout(res, 50));
    run(0.05);
  }
  run(0.6);
  const loose = sim.scene.children.filter((o) => o.name && o.name.startsWith('staff:') && o !== sim.vehicleModel);
  r.ok('staff: Restart starts the shift over',
    staff.active && sim.mode === 'drive' && sim.vehicle && sim.vehicle.spec.id === 'tug' && foot.active && staff.job === 'stairs' && staff.stars.round === 1 && loose.length === 0,
    `active ${staff.active}, mode ${sim.mode}, vehicle ${sim.vehicle && sim.vehicle.spec.id}, on foot ${foot.active}, job ${staff.job}, round ${staff.stars.round}, loose models ${loose.map((o) => o.name).join(',')}`);
}
