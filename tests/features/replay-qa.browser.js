/**
 * The instant replay, attacked (2026-10-25, the replay QA:
 * .claude/devtools/briefs/replay-qa.md).
 *
 * tests/features/replay.mjs holds the replay's own clock in node on a bare
 * sim; breakup.browser.js holds its key, its bar and the crash screen on the
 * real game. This is the matrix the owner asked for, on the real game: every
 * way of crashing, on the aeroplanes that differ most, and for each crash
 *
 *   EARLY     nothing of the crash before the hit: no effect of ANY feature
 *             (the break-up's, the crash cam's, the fire crews', the game's
 *             wreck), no scorch, no light, no raft — every object that came
 *             into the world with the crash is hidden until its moment, and
 *             the pieces ride the airframe.
 *   START     the replay opens a second and a half before the hit, with the
 *             airframe flying where it really was.
 *   SCRUB     forwards and back gives the same world at the same time.
 *   PAUSE, ±2 s, DRAG, CLOSE, RESTART, END — each does what it says and
 *             gives the live world back.
 *   COST      a replay frame and a scrub are cheap.
 *   ERRORS    no console error anywhere in it.
 *
 * `check(sim, r, say)` runs a cross-section (every mode once, every type at
 * least once, both Reduce flashing settings); `sweep(sim, r, say, opts)` runs
 * the whole matrix (types x modes x Reduce flashing on/off).
 */

export const TYPES = ['skylark', 'a320', 'a380', 'f22', 'c17', 'uh60'];
export const MODES = ['wingtip', 'belly', 'nose', 'tail', 'water', 'midair', 'rotor'];
/** The cross-section `check` runs: [type, mode, reduceFlashing]. */
const QUICK = [
  ['skylark', 'wingtip', true],
  ['a320', 'belly', true],
  ['a380', 'nose', false],
  ['f22', 'tail', true],
  ['c17', 'water', true],
  ['skylark', 'midair', false],
  ['uh60', 'rotor', true],
  ['a320', 'water', false],
];

const D2R = Math.PI / 180;
/** Run-in speeds, m/s: comfortably flying, low down. */
const RUN_IN = { skylark: 40, a320: 78, a380: 82, f22: 95, c17: 72, uh60: 30 };

async function load() {
  return {
    bu: await import('../../src/features/breakup.js'),
    cr: await import('../../src/features/crashes.js'),
    T: await import('../../src/world/terrain.js'),
    THREE: await import('../../src/vendor/three.module.js'),
    TY: await import('../../src/aircraft/types.js'),
    P: await import('../../src/aircraft/physics.js'),
  };
}

/** Is this object drawn: it and every parent visible. */
function shown(o) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/** Every object in the scene that draws something (or lights it), by uuid. */
function drawnSet(scene) {
  const out = new Set();
  scene.traverse((o) => {
    if ((o.isMesh || o.isPoints || o.isSprite || o.isLine || o.isLight) && shown(o)) out.add(o.uuid);
  });
  return out;
}

function within(o, THREE, at, r) {
  const p = o.getWorldPosition(new THREE.Vector3());
  return Math.hypot(p.x - at.x, p.z - at.z) < r;
}

function under(o, root) {
  for (let p = o; p; p = p.parent) if (p === root) return true;
  return false;
}

/** A flat patch of dry land (nine points 40 m apart, all over 4 m, within 2.5 m of each other) round `from`. */
function landNear(T, from, minR = 150, maxR = 6000) {
  const flat = (x, z) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const h = T.heightAt(x + i * 40, z + j * 40);
        if (!(h > 4) || T.platformAt(x + i * 40, z + j * 40)) return false;
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    }
    return hi - lo < 2.5;
  };
  for (let rr = minR; rr <= maxR; rr += 150) {
    const n = Math.max(8, Math.round(rr / 80));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = from.x + Math.cos(a) * rr;
      const z = from.z + Math.sin(a) * rr;
      if (flat(x, z)) return { x, z };
    }
  }
  return null;
}

/** Open sea (no land, no platform, 8 m deep or more for 700 m east) round `from`. */
function seaNear(T, from) {
  for (let rr = 0; rr <= 12000; rr += 200) {
    const n = rr === 0 ? 1 : Math.max(8, Math.round(rr / 100));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = from.x + Math.cos(a) * rr;
      const z = from.z + Math.sin(a) * rr;
      let ok = true;
      for (let d = -700; d <= 700 && ok; d += 100) if (T.heightAt(x + d, z) > -8 || T.platformAt(x + d, z)) ok = false;
      if (ok) return { x, z };
    }
  }
  return null;
}

/**
 * Fly in to `spot`: put the aeroplane two seconds short of it, `alt` metres
 * up, flying east at `speed`, and fly those two seconds — so the replay's
 * second and a half before the hit is real flying, as a real crash's is.
 */
function runIn(L, sim, spot, { speed = 40, alt = 30, beforeHit = () => {} } = {}) {
  const { THREE } = L;
  const ac = sim.aircraft;
  const back = speed * 2;
  ac.reset({ pos: new THREE.Vector3(spot.x - back, 0, spot.z), headingDeg: 90, speed, altAGL: alt, engineOn: true, gearDown: true });
  sim.override = { pitch: 0, roll: 0, yaw: 0, throttle: 0.6 };
  for (let i = 0; i < 60 && !ac.crashed; i++) {
    beforeHit();
    sim.update(1 / 30);
    clearTimeout(sim._crashDebriefT);
  }
  sim.override = null;
}

/**
 * Crash the aeroplane `mode`'s way, after a real run-in (runIn). The stock
 * ones through crashes.js stageCrash where it now is (the real CRASH event);
 * a tail strike, a mid-air and a rotor strike the same way by hand. Returns
 * a word for what happened, or null.
 */
function crashIt(L, sim, mode, beforeHit = () => {}) {
  const { cr, T, THREE } = L;
  const ac = sim.aircraft;
  const speed = mode === 'rotor' ? 12 : RUN_IN[sim.aircraftType.id] || 45;
  if (mode !== 'midair') {
    const spot = mode === 'water' ? seaNear(T, ac.pos) : landNear(T, ac.pos, 150, 8000);
    if (!spot) return null;
    runIn(L, sim, spot, { speed, alt: mode === 'rotor' ? 6 : mode === 'water' ? 45 : 25, beforeHit });
    // Flown into the ground (or the sea) on its own on the way in: a real crash, all the better.
    if (ac.crashed) return 'flown in';
  }
  beforeHit();
  const stock = { wingtip: 'wingclip', belly: 'bellyflop', nose: 'noseplant', water: 'splash' }[mode];
  if (stock) return cr.stageCrash(sim, stock);
  const hdg = (ac.heading || 0) * D2R;
  const fwd = new THREE.Vector3(Math.sin(hdg), 0, -Math.cos(hdg));
  if (mode === 'midair') {
    // Another aeroplane met head-on: the CRASH sky.js raises.
    const other = ac.pos.clone().addScaledVector(fwd, 9).add(new THREE.Vector3(0, 1.5, 0));
    ac.crash('You collided with another aircraft', { part: 'fuselage', surfaceKind: 'aircraft', worldPoint: ac.pos.clone().addScaledVector(fwd, 4), otherPos: other, closing: 140, other: 'qa', otherKind: 'plane' });
    return 'midair';
  }
  const g = T.heightAt(ac.pos.x, ac.pos.z);
  if (mode === 'tail') {
    // Over-rotated on the flare: nose 16 degrees up, sinking.
    ac.quat.setFromEuler(new THREE.Euler(16 * D2R, -hdg, 0, 'YXZ'));
    ac.pos.y = g + 1.2;
    ac.vel.copy(fwd).multiplyScalar(36).add(new THREE.Vector3(0, -4, 0));
    ac.crash('The tail struck the ground', { part: 'tail', worldPoint: ac.pos.clone().addScaledVector(fwd, -6) });
    return 'tail';
  }
  if (mode === 'rotor') {
    // A dynamic rollover: rolled 75 degrees at a crawl, the side (and the disc) into the ground.
    ac.quat.setFromEuler(new THREE.Euler(0, -hdg, -75 * D2R, 'YXZ'));
    ac.pos.y = g + 1.4;
    ac.vel.copy(fwd).multiplyScalar(4).add(new THREE.Vector3(0, -3, 0));
    ac.crash('The rotor blades struck the ground', { part: 'rightWing', worldPoint: ac.pos.clone() });
    return 'rotor';
  }
  return null;
}

/** Where a model is in the world (the fleet's models keep matrixAutoUpdate off: their .position is stale). */
function worldPos(o) {
  o.updateMatrixWorld(true);
  return { x: o.matrixWorld.elements[12], y: o.matrixWorld.elements[13], z: o.matrixWorld.elements[14] };
}

/** The pose of everything the replay moves, rounded, for comparing two visits to the same time. */
function poses(D, sim) {
  const S = D().S;
  const r3 = (v) => [v.x, v.y, v.z].map((n) => Math.round(n * 1000) / 1000);
  const w = sim.wreck;
  const ws = w && typeof w.snapshot === 'function' ? w.snapshot() : null;
  return JSON.stringify({
    model: r3(worldPos(S.rec.model)),
    pieces: S.pieces.map((p) => r3(p.group.position)),
    wreck: w ? { visible: !!(w.group && w.group.visible), t: Math.round((w.t || 0) * 1000) / 1000, debris: ws && ws.debris ? String(ws.debris.length) : '' } : null,
    fx: S.fx ? { busy: !!S.fx.busy, cursor: S.replay.fxCursor } : null,
  });
}

/** The live world, for comparing before and after a replay. */
function liveState(D, sim) {
  const S = D().S;
  const r1 = (n) => Math.round(n * 10) / 10;
  return JSON.stringify({
    pieces: S.pieces.map((p) => [r1(p.group.position.x), r1(p.group.position.y), r1(p.group.position.z), p.group.visible]),
    model: sim.model ? [r1(worldPos(sim.model).x), r1(worldPos(sim.model).y), r1(worldPos(sim.model).z), sim.model.visible] : null,
    wreck: sim.wreck && sim.wreck.group ? [sim.wreck.group.visible, !!sim.wreck.held] : null,
    fxBusy: S.fx ? !!S.fx.busy : null,
  });
}

/**
 * One crash and everything done to its replay. `out(name, pass, detail)` per
 * finding. Returns the timings.
 */
export async function oneCrash(sim, L, { type, mode, reduce, quality = null, out, say = () => {} }) {
  const { bu, THREE, TY } = L;
  const D = () => bu.breakupDebug();
  const tag = `${type} ${mode} (Reduce flashing ${reduce ? 'on' : 'off'}${quality ? `, ${quality}` : ''})`;
  const noDebrief = () => clearTimeout(sim._crashDebriefT);
  const errors = [];
  const onErr = (ev) => errors.push(String((ev && (ev.message || ev.reason)) || ev));
  const origErr = console.error;
  console.error = (...a) => {
    errors.push(a.map(String).join(' ').slice(0, 200));
    origErr.apply(console, a);
  };
  window.addEventListener('error', onErr);
  window.addEventListener('unhandledrejection', onErr);
  const res = { tag };
  try {
    if (sim.settings.reduceFlashing !== reduce) sim.applySetting('reduceFlashing', reduce);
    if (quality && sim.qualityBuilt !== quality) {
      sim.applySetting('quality', quality);
      sim.applyQualityNow(quality);
    }
    sim.settings.crashSlowMo = true;
    await sim.startMode('free', { airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 0, aircraft: type });
    if (!sim.aircraftType || sim.aircraftType.id !== type) {
      out(`${tag}: the flight starts`, false, `flying ${sim.aircraftType && sim.aircraftType.id}`);
      return res;
    }
    if (sim.rig && sim.rig.setMode) sim.rig.setMode('chase');
    // Two seconds of flying, so the pre-roll has all its second and a half.
    for (let i = 0; i < 60; i++) sim.update(1 / 30);
    const heli = TY.isHelicopter(sim.aircraftType);
    if (mode === 'rotor' && !heli) return res;
    let before = null;
    const staged = crashIt(L, sim, mode, () => {
      before = drawnSet(sim.scene);
    });
    noDebrief();
    res.how = staged;
    if (!staged || !sim.aircraft.crashed) {
      out(`${tag}: the crash can be staged`, false, staged ? 'not crashed' : 'refused');
      return res;
    }
    const rec = D().S.rec;
    if (!rec) {
      out(`${tag}: the crash opened a recording`, false, 'none (breakModel refused?)');
      return res;
    }
    const hitAt = rec.wreck.pos.clone();
    const diag = new THREE.Box3().setFromObject(rec.model).getSize(new THREE.Vector3()).length();
    const span = Math.max(diag, (L.P.SPEC && L.P.SPEC.wingSpan) || 0) * 0.75 + 3;
    // Seven seconds of the live crash: the pieces settle, the fire burns, the crews roll.
    let liveMs = 0;
    for (let i = 0; i < 210; i++) {
      const a0 = performance.now();
      sim.update(1 / 30);
      if (i >= 150) liveMs += performance.now() - a0;
      noDebrief();
    }
    res.liveMs = liveMs / 60;
    out(`${tag}: there is a replay to watch`, D().canReplay, JSON.stringify(D().recording));
    if (!D().canReplay) return res;
    const live0 = liveState(D, sim);
    const fov0 = sim.camera.fov;
    const modelVis0 = rec.model.visible;

    /* ---- START: a second and a half before the hit, the airframe where it flew ---- */
    const t0 = performance.now();
    const started = bu.startReplay(sim, sim.state === 'debrief');
    res.startMs = performance.now() - t0;
    const R = D().S.replay;
    out(`${tag}: the replay starts`, started && !!R, '');
    if (!R) return res;
    out(`${tag}: it opens about 1.5 s before the hit`, R.start <= -1.2 && R.start >= -1.75, `start ${R.start.toFixed(2)} s`);
    // Each kept pose a thirtieth of a second from the next: no aeroplane covers 80 m in that.
    const chain = [...rec.pre, rec.frames[0]];
    let jumps = 0;
    for (let i = 1; i < chain.length; i++) if (chain[i].pos.distanceTo(chain[i - 1].pos) > 80) jumps++;
    out(`${tag}: …with the airframe flying where it really was (one unbroken path into the hit)`, jumps === 0 && rec.pre.length >= 30, `${rec.pre.length} poses, ${jumps} jumps`);

    /* ---- EARLY: nothing of the crash before the hit ---- */
    const pieceGroup = D().S.group;
    const early = new Map();
    const checkEarly = (t) => {
      const S = D().S;
      if (S.fx && S.fx.busy) early.set('break-up effects', t);
      if (sim.wreck && sim.wreck.group && shown(sim.wreck.group)) early.set('the game\'s wreck', t);
      // Every other thing drawn near the crash that was not in the world before it.
      sim.scene.traverse((o) => {
        if (!(o.isMesh || o.isPoints || o.isSprite || o.isLine || o.isLight) || before.has(o.uuid) || !shown(o)) return;
        if (under(o, rec.model) || under(o, pieceGroup)) return;
        if (o.isLight && !(o.intensity > 0)) return;
        if (!within(o, THREE, hitAt, 400)) return;
        let n = o;
        while (n.parent && n.parent !== sim.scene && !n.name) n = n.parent;
        const name = `${o.type}:${n.name || o.name || '(unnamed)'}`;
        if (!early.has(name)) early.set(name, t);
      });
      // The pieces ride the airframe: none further from it than the aeroplane is long.
      const rm = rec.model.userData && rec.model.userData.realModel;
      if (rm && rm.on && S.pieces.length) early.set('the real skin drawn over the procedural pieces', t);
      const mp = worldPos(rec.model);
      for (const p of S.pieces) {
        const q = p.group.position;
        if (p.group.visible && Math.hypot(q.x - mp.x, q.y - mp.y, q.z - mp.z) > span) early.set(`a piece off the airframe (${p.zones.join('+')})`, t);
      }
    };
    for (let t = R.start; t < -0.02; t += 0.1) {
      bu.seekReplay(sim, t);
      checkEarly(t);
    }
    // And played, not just sought: from the start to the hit, frame by frame.
    bu.seekReplay(sim, R.start);
    let frames = 0;
    const tf0 = performance.now();
    while (D().S.replay && D().S.replay.t < -0.02 && frames < 200) {
      sim.update(1 / 30);
      frames++;
      if (D().S.replay && D().S.replay.t < -0.02) checkEarly(D().S.replay.t);
    }
    res.frameMs = frames ? (performance.now() - tf0) / frames : 0;
    out(`${tag}: before the hit NOTHING of the crash is drawn — sought or played`, early.size === 0, [...early].map(([k, t]) => `${k} @${t.toFixed(2)}`).join('; ') || `${frames} frames`);
    // At the hit, the crash is there.
    bu.seekReplay(sim, 0.6);
    out(`${tag}: at the hit the effects and the wreck appear`, (D().S.fx && D().S.fx.busy) || (sim.wreck && sim.wreck.group && sim.wreck.group.visible), '');

    /* ---- SCRUB: the same world at the same time, whichever way you came ---- */
    const tA = Math.min(2, R.end - 0.1);
    bu.seekReplay(sim, tA);
    const a = poses(D, sim);
    bu.seekReplay(sim, -1);
    bu.seekReplay(sim, R.end);
    const ts0 = performance.now();
    bu.seekReplay(sim, tA);
    res.seekMs = performance.now() - ts0;
    const b = poses(D, sim);
    bu.seekReplay(sim, 0.3);
    bu.seekReplay(sim, tA);
    const c = poses(D, sim);
    out(`${tag}: scrubbing back and forth to the same time shows the same world`, a === b && b === c, a === b ? (b === c ? '' : `from behind: ${c.slice(0, 160)} vs ${b.slice(0, 160)}`) : `${a.slice(0, 160)} vs ${b.slice(0, 160)}`);

    /* ---- PAUSE ---- */
    bu.pauseReplay(sim, true);
    sim.update(1 / 30);
    const tp = D().S.replay.t;
    const camP = sim.camera.position.clone();
    for (let i = 0; i < 30; i++) sim.update(1 / 30);
    out(`${tag}: paused, time and the camera stand still`, D().S.replay && D().S.replay.t === tp && sim.camera.position.distanceTo(camP) < 0.01, `t ${tp.toFixed(2)} → ${D().S.replay ? D().S.replay.t.toFixed(2) : 'ended'}`);
    bu.pauseReplay(sim, false);

    /* ---- ±2 s, from the bar ---- */
    const bar = document.querySelector('.breakup-replay-bar');
    const btn = (k) => bar && bar.querySelector(`[data-replay="${k}"]`);
    bu.seekReplay(sim, 1);
    if (btn('back')) btn('back').click();
    const tb = D().S.replay.t;
    if (btn('fwd')) btn('fwd').click();
    if (btn('fwd')) btn('fwd').click();
    const tw = D().S.replay.t;
    out(`${tag}: the bar's « and » step two seconds (clamped to the start)`, Math.abs(tb - Math.max(R.start, -1)) < 1e-6 && Math.abs(tw - Math.min(R.end, tb + 4)) < 1e-6, `${tb.toFixed(2)}, ${tw.toFixed(2)}`);

    /* ---- DRAG the rail ---- */
    const scrub = btn('track');
    if (scrub) {
      const rail = scrub.firstElementChild;
      const rect = rail.getBoundingClientRect();
      const ev = (type, k) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: rect.left + rect.width * k, clientY: rect.top + rect.height / 2 });
      const wasPaused = D().S.replay.paused;
      scrub.dispatchEvent(ev('pointerdown', 0.25));
      const t25 = D().S.replay.t;
      const heldWhileDragging = D().S.replay.paused;
      scrub.dispatchEvent(ev('pointermove', 0.75));
      const t75 = D().S.replay.t;
      scrub.dispatchEvent(ev('pointerup', 0.75));
      const want = (k) => R.start + k * (R.end - R.start);
      out(`${tag}: dragging the rail (a finger) seeks where it is, holds the replay while held, and lets go as it was`,
        rect.width > 0 && Math.abs(t25 - want(0.25)) < 0.05 && Math.abs(t75 - want(0.75)) < 0.05 && heldWhileDragging && D().S.replay.paused === wasPaused,
        `rail ${Math.round(rect.width)} px; ${t25.toFixed(2)} (want ${want(0.25).toFixed(2)}), ${t75.toFixed(2)} (want ${want(0.75).toFixed(2)})`);
    }

    /* ---- CLOSE: the live world back as it was ---- */
    if (btn('close')) btn('close').click();
    else bu.endReplay(sim, true);
    const live1 = liveState(D, sim);
    const label = document.querySelector('.breakup-replay-label');
    out(`${tag}: closed, the live world is back exactly (pieces, airframe, wreck, fire) and the bar is gone`,
      !D().S.replay && live1 === live0 && rec.model.visible === modelVis0 && Math.abs(sim.camera.fov - fov0) < 1e-6 && (!bar || bar.style.display === 'none') && (!label || label.style.display === 'none'),
      live1 === live0 ? `fov ${fov0} → ${sim.camera.fov}` : `${live0.slice(0, 200)} vs ${live1.slice(0, 200)}`);

    /* ---- END: played through it ends on its own and gives the world back ---- */
    bu.startReplay(sim, sim.state === 'debrief');
    const Rn = D().S.replay;
    const need = Rn ? (Rn.end - Rn.start) / bu.REPLAY.speed + 2 : 0;
    let n = 0;
    while (D().S.replay && n < need * 30 + 60) {
      sim.update(1 / 30);
      noDebrief();
      n++;
    }
    out(`${tag}: played through, it ends on its own (about ${need.toFixed(0)} s) and gives the world back`, !D().S.replay && liveState(D, sim) === live0, `${(n / 30).toFixed(1)} s`);

    /* ---- RESTART in the middle of one ---- */
    bu.startReplay(sim, sim.state === 'debrief');
    for (let i = 0; i < 20; i++) sim.update(1 / 30);
    sim.restart();
    for (let i = 0; i < 50 && !(sim.state === 'flying' && !sim.aircraft.crashed); i++) await new Promise((ok) => setTimeout(ok, 100));
    for (let i = 0; i < 10; i++) sim.update(1 / 30);
    out(`${tag}: a restart mid-replay ends it, clears the wreck, and the new flight is clean`,
      !D().S.replay && D().S.pieces.length === 0 && !(sim.wreck && sim.wreck.group && sim.wreck.group.visible) && sim.state === 'flying' && !sim.aircraft.crashed && sim.model.visible && (!bar || bar.style.display === 'none'),
      `replay ${!!D().S.replay}, ${D().S.pieces.length} pieces, state ${sim.state}`);
    out(`${tag}: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (err) {
    out(`${tag}: ran`, false, String((err && err.stack) || err).slice(0, 400));
  } finally {
    console.error = origErr;
    window.removeEventListener('error', onErr);
    window.removeEventListener('unhandledrejection', onErr);
    noDebrief();
    if (D().S.replay) bu.endReplay(sim, false);
  }
  return res;
}

/**
 * The ways into a replay that are not a crash flown in:
 *   DEV     Dev mode's "Show me a crash" puts the aeroplane in place and
 *           crashes it on the same frame: its pre-roll is the way it arrived
 *           (R1), not a second and a half kilometres away.
 *   RESPAWN a crash, Try again, and a second crash: the replay is the second
 *           one's, from the second flight only.
 *   EJECT   the empty aeroplane's crash, watched from under the canopy, gives
 *           the camera back to the parachute after.
 */
async function extraCases(sim, L, out) {
  const { bu, cr } = L;
  const D = () => bu.breakupDebug();
  const noDebrief = () => clearTimeout(sim._crashDebriefT);
  const free = (aircraft) => sim.startMode('free', { airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 0, aircraft });
  try {
    /* DEV */
    await free('skylark');
    for (let i = 0; i < 60; i++) sim.update(1 / 30);
    const from = sim.aircraft.pos.clone();
    cr.stageCrash(sim, 'cartwheel');
    noDebrief();
    const rec = D().S.rec;
    const chain = rec ? [...rec.pre, rec.frames[0]] : [];
    let jumps = 0;
    for (let i = 1; i < chain.length; i++) if (chain[i].pos.distanceTo(chain[i - 1].pos) > 80) jumps++;
    const moved = rec ? Math.round(rec.wreck.pos.distanceTo(from)) : 0;
    out('Dev "Show me a crash" (put in place and crashed at once): the pre-roll is the way it arrived, not the place it was taken from', !!rec && rec.pre.length >= 30 && jumps === 0 && rec.pre[0].t <= -1.4,
      rec ? `${rec.pre.length} poses from ${rec.pre.length ? rec.pre[0].t.toFixed(2) : '-'} s, ${jumps} jumps; staged ${moved} m from where it was flying` : 'no recording');
    for (let i = 0; i < 150; i++) {
      sim.update(1 / 30);
      noDebrief();
    }
    if (D().canReplay) {
      bu.startReplay(sim, false);
      const R = D().S.replay;
      const far = R ? Math.round(D().S.rec.model.position.distanceTo(D().S.rec.wreck.pos)) : -1;
      out('…its replay opens on the airframe a second and a half short of the hit, close by', !!R && R.start <= -1.4 && far >= 0 && far < 200, `start ${R ? R.start.toFixed(2) : '-'}, ${far} m from the hit`);
      bu.endReplay(sim, false);
    }

    /* RESPAWN */
    await free('f22');
    for (let i = 0; i < 60; i++) sim.update(1 / 30);
    cr.stageCrash(sim, 'bellyflop');
    noDebrief();
    for (let i = 0; i < 60; i++) {
      sim.update(1 / 30);
      noDebrief();
    }
    const first = D().S.rec;
    sim.restart();
    for (let i = 0; i < 50 && !(sim.state === 'flying' && !sim.aircraft.crashed); i++) await new Promise((ok) => setTimeout(ok, 100));
    out('respawn: Try again leaves no replay of the old crash to start in the new flight', !D().canReplay && !bu.startReplay(sim, false), `canReplay ${D().canReplay}`);
    for (let i = 0; i < 15; i++) sim.update(1 / 30);
    // Half a second into the new flight it comes apart where it is (no teleport): the pre-roll is that half second, nothing older.
    sim.aircraft.crash('Too fast — the aeroplane came apart');
    noDebrief();
    const second = D().S.rec;
    const firstPoses = first ? first.pre.map((f) => f.pos) : [];
    const old = second ? second.pre.filter((f) => firstPoses.some((q) => q.distanceTo(f.pos) < 0.01)).length : -1;
    out('respawn: the second crash records itself, with nothing of the first flight in its pre-roll', !!second && second !== first && old === 0 && second.pre.length >= 2 && second.pre[0].t >= -0.7,
      `${second ? second.pre.length : 0} poses from ${second && second.pre.length ? second.pre[0].t.toFixed(2) : '-'} s, ${old} of them the first flight's`);
    noDebrief();

    /* EJECT */
    await free('f22');
    for (let i = 0; i < 60; i++) sim.update(1 / 30);
    const E = await import('../../src/features/eject.js');
    const ej = E.ejectPilot(sim);
    let n = 0;
    while (!sim.aircraft.crashed && n < 50 * 30) {
      sim.update(1 / 30);
      noDebrief();
      n++;
    }
    for (let i = 0; i < 90; i++) {
      sim.update(1 / 30);
      noDebrief();
    }
    const can = D().canReplay;
    out('eject: the empty aeroplane comes down and its crash is recorded', ej && sim.aircraft.crashed && can, `ejected ${ej}, crashed after ${(n / 30).toFixed(1)} s, replay ${can}`);
    if (can) {
      const camBefore = sim.camera.position.clone();
      bu.startReplay(sim, false);
      for (let i = 0; i < 20; i++) sim.update(1 / 30);
      const R = D().S.replay;
      const camToCentre = R ? sim.camera.position.distanceTo(R.centre) : -1;
      out('eject: the replay is what the camera shows while it plays (not the parachute view)', !!R && camToCentre < R.radius * 2 + 40, `camera ${Math.round(camToCentre)} m from the wreck (orbit ${R ? Math.round(R.radius) : '-'} m)`);
      bu.endReplay(sim, false);
      for (let i = 0; i < 10; i++) sim.update(1 / 30);
      const back = sim.camera.position.distanceTo(camBefore);
      out('eject: closed, the camera is the parachute\'s again', back < 400 && sim.state === 'flying', `${Math.round(back)} m from where it was before`);
    }
  } catch (err) {
    out('the extra cases ran', false, String((err && err.stack) || err).slice(0, 400));
  } finally {
    noDebrief();
    if (D().S.replay) bu.endReplay(sim, false);
  }
}

export async function check(sim, r, say = () => {}) {
  const t = await sweep(sim, r, say, { cases: QUICK });
  await layout(sim, r, say);
  return t;
}

/**
 * The replay's bar on whatever screen this is (a phone held either way, a
 * tablet, a laptop): on the screen, every button a thumb's 44 px, nothing
 * of the game's touch layer over it (a tap on each button reaches that
 * button), the INSTANT REPLAY tag clear of it, and a finger's drag along the
 * rail scrubs.
 */
export async function layout(sim, r, say = () => {}) {
  let L;
  try {
    L = await load();
  } catch (err) {
    r.ok('replay QA: the modules load', false, String((err && err.message) || err));
    return;
  }
  const { bu, cr } = L;
  const D = () => bu.breakupDebug();
  const W = window.innerWidth;
  const H = window.innerHeight;
  const tag = `${W}x${H}${sim.touch ? ', touch' : ''}`;
  const autoWas = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  try {
    say(`replay QA: the bar at ${tag}`);
    await sim.startMode('free', { airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 0, aircraft: 'skylark' });
    for (let i = 0; i < 60; i++) sim.update(1 / 30);
    cr.stageCrash(sim, 'cartwheel');
    for (let i = 0; i < 150; i++) {
      sim.update(1 / 30);
      clearTimeout(sim._crashDebriefT);
    }
    const started = bu.startReplay(sim, false);
    sim.update(1 / 30);
    const bar = document.querySelector('.breakup-replay-bar');
    const label = document.querySelector('.breakup-replay-label');
    r.ok(`replay QA (${tag}): the replay and its bar are up`, started && !!bar && bar.style.display !== 'none');
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    r.ok(`replay QA (${tag}): the bar is all on the screen`, rect.left >= 0 && rect.right <= W && rect.top >= 0 && rect.bottom <= H && rect.width > 200, `${Math.round(rect.left)}..${Math.round(rect.right)} x ${Math.round(rect.top)}..${Math.round(rect.bottom)}`);
    const keys = ['back', 'pause', 'fwd', 'close'];
    const small = [];
    const covered = [];
    for (const k of keys) {
      const b = bar.querySelector(`[data-replay="${k}"]`);
      const br = b.getBoundingClientRect();
      if (br.width < 44 || br.height < 44) small.push(`${k} ${Math.round(br.width)}x${Math.round(br.height)}`);
      const hit = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
      if (!(hit === b || b.contains(hit))) covered.push(`${k} under ${hit ? `${hit.tagName.toLowerCase()}.${String(hit.className || '').split(' ')[0]}` : 'nothing'}`);
    }
    const rail = bar.querySelector('[data-replay="track"]');
    const rr = rail.getBoundingClientRect();
    const railHit = document.elementFromPoint(rr.left + rr.width * 0.5, rr.top + rr.height / 2);
    if (!(railHit === rail || rail.contains(railHit))) covered.push(`the rail under ${railHit ? railHit.className : 'nothing'}`);
    r.ok(`replay QA (${tag}): every button is a thumb's 44 px`, small.length === 0, small.join(', '));
    r.ok(`replay QA (${tag}): nothing of the game is over the bar (a tap on each control reaches it)`, covered.length === 0, covered.join('; '));
    const lr = label ? label.getBoundingClientRect() : null;
    r.ok(`replay QA (${tag}): the INSTANT REPLAY tag is clear of the bar and on the screen`, !!lr && (lr.bottom <= rect.top || lr.top >= rect.bottom) && lr.left >= 0 && lr.right <= W, lr ? `tag ${Math.round(lr.top)}..${Math.round(lr.bottom)}, bar ${Math.round(rect.top)}..` : 'no tag');
    // A finger along the rail.
    const R = D().S.replay;
    const ev = (type, k) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 11, pointerType: 'touch', isPrimary: true, clientX: rr.left + 4 + (rr.width - 8) * k, clientY: rr.top + rr.height / 2 });
    rail.dispatchEvent(ev('pointerdown', 0.1));
    rail.dispatchEvent(ev('pointermove', 0.5));
    rail.dispatchEvent(ev('pointermove', 0.9));
    const t9 = D().S.replay.t;
    rail.dispatchEvent(ev('pointerup', 0.9));
    r.ok(`replay QA (${tag}): a finger dragged along the rail scrubs the replay`, t9 > R.start + (R.end - R.start) * 0.7, `${t9.toFixed(2)} of ${R.start.toFixed(1)}..${R.end.toFixed(1)}`);
    bar.querySelector('[data-replay="close"]').click();
    r.ok(`replay QA (${tag}): ✕ closes it`, !D().S.replay && bar.style.display === 'none');
  } catch (err) {
    r.ok(`replay QA (${tag}): the layout check ran`, false, String((err && err.stack) || err).slice(0, 300));
  } finally {
    sim.autoPauseOnHide = autoWas;
    if (D().S.replay) bu.endReplay(sim, false);
  }
}

export async function sweep(sim, r, say = () => {}, { cases = null, types = TYPES, modes = MODES, reduces = [true, false], qualities = [null], extras = true } = {}) {
  let L;
  try {
    L = await load();
  } catch (err) {
    r.ok('replay QA: the modules load', false, String((err && err.message) || err));
    return [];
  }
  const autoWas = sim.autoPauseOnHide;
  const reduceWas = sim.settings.reduceFlashing;
  const slowWas = sim.settings.crashSlowMo;
  sim.autoPauseOnHide = false;
  const list = cases || qualities.flatMap((q) => types.flatMap((t) => modes.flatMap((m) => reduces.map((rf) => [t, m, rf, q]))));
  const timings = [];
  try {
    for (const [type, mode, reduce, quality] of list) {
      say(`replay QA: ${type} ${mode}`);
      timings.push(await oneCrash(sim, L, { type, mode, reduce, quality, out: (n, p, d) => r.ok(`replay QA: ${n}`, p, d), say }));
    }
    if (extras) await extraCases(sim, L, (n, p, d) => r.ok(`replay QA: ${n}`, p, d));
  } finally {
    sim.autoPauseOnHide = autoWas;
    if (sim.settings.reduceFlashing !== reduceWas) sim.applySetting('reduceFlashing', reduceWas !== false);
    sim.settings.crashSlowMo = slowWas;
  }
  return timings;
}
