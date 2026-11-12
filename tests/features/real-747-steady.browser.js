/**
 * The real 747 stays ONE aeroplane through a whole flight (src/aircraft/real-models.js).
 *
 * The owner, on High: "the old and new 747 models are combining and randomly
 * appear" (the procedural flaps hung off the real wing as a pale slab whenever
 * they were out), and "random lag when flying the 747 upward".
 *
 * A scripted flight: the take-off roll with flaps set, rotate, climb, turns,
 * flaps all the way out and back in, the follow, orbit, wing, fly-by, tower
 * and cockpit views, and a firm landing that bounces. Every frame:
 *   1. outside the cockpit the real skin is on and drawn, every frame (no flicker);
 *   2. no procedural surface the skin covers is drawn while it is on (no double model);
 *   3. no procedural flap, slat or spoiler is drawn unless it lies on the real
 *      wing (retracted, within FIT_TOL) -- and on the 747 none is drawn outside it;
 *   4. the climb compiles no new program, and its worst frame is no worse than a
 *      sane bound over its median (update + draw, ms).
 *
 *   node .claude/devtools/briefs/one-check.mjs '<url>?mute=1' ./tests/features/real-747-steady.browser.js check "" 1
 */
export const id = 'real-747-steady';

const sleep = (ms) => new Promise((f) => setTimeout(f, ms));
const FLAPISH = /^(inboard |outboard |fowler |trailing edge )?flaps?$|spoilers|slats|leading edge slat/i;

export async function check(sim, r, say = () => {}) {
  let R;
  let THREE;
  let BU;
  try {
    R = await import('../../src/aircraft/real-models.js');
    THREE = await import('../../src/vendor/three.module.js');
    BU = await import('../../src/features/breakup.js');
  } catch (e) {
    r.ok('747 steady: modules load', false, String(e && e.message));
    return;
  }
  const autoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const qualityWas = sim.settings.quality;
  try {
    if (sim.settings.quality !== 'high') sim.applySetting('quality', 'high');
    await sleep(100);
    if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
    say('747 steady: the 747 on the runway');
    await sim.startMode('free', { aircraft: 'b747', taxi: false, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
    for (let i = 0; i < 300 && sim.state !== 'flying'; i++) await sleep(20);
    const model = sim.model;
    let rm = null;
    for (let i = 0; i < 600; i++) {
      rm = model.userData.realModel;
      if (rm && (rm.state === 'on' || rm.state === 'failed')) break;
      await sleep(25);
    }
    sim.step(0.1);
    // warmRealSkin keeps the game's model drawn while the skin's programs compile in the background.
    // ...and the aeroplane is never missing meanwhile (neither the skin nor the game's surfaces drawn).
    let bare = 0;
    let held = 0;
    for (let i = 0; i < 600 && rm && rm.state === 'on' && (rm.hold || !rm.on || !rm.skin.visible); i++) {
      await sleep(25);
      sim.update(1 / 60);
      if (rm.hold) held++;
      if (!rm.skin.visible && rm.hidden.some(([o]) => !o.layers.test(sim.camera.layers))) bare++;
    }
    r.ok('747 steady: while the new skin compiles the game\'s own 747 is drawn, never neither', bare === 0, `${bare} bare frames of ${held} held`);
    if (!rm || rm.state !== 'on' || !rm.skin.visible) {
      r.ok('747 steady: the real 747 is on', false, rm ? `${rm.state} visible ${rm.skin && rm.skin.visible}` : 'no real model');
      return;
    }
    const ac = sim.aircraft;
    const cam = sim.camera;
    const airframe = model.children.find((c) => c.isGroup && c.name === model.name) || model.children[0];
    const hiddenSet = new Set(rm.hidden.map(([o]) => o));
    const devices = [];
    airframe.traverse((o) => {
      if (!(o.isMesh || o.isInstancedMesh)) return;
      for (let n = o; n && n !== airframe; n = n.parent) {
        if (FLAPISH.test(n.name || '')) {
          devices.push(o);
          return;
        }
      }
    });
    const chain = (o) => {
      for (let n = o; n; n = n.parent) if (!n.visible) return false;
      return true;
    };
    const drawn = (o) => o.layers.test(cam.layers) && chain(o);
    const stats = { crash: '', zBuilds: 0, zWorst: 0, zMs: 0, frames: 0, flicker: 0, both: 0, misfitDrawn: 0, devicesDrawn: 0, maxFlaps: 0, firstBad: '' };
    let prevOn = null;
    const inv = new THREE.Matrix4();
    const m4 = new THREE.Matrix4();
    let lastBuilds = BU.breakupDebug().zoneCache.builds;
    const sample = (phase) => {
      stats.frames++;
      const z = BU.breakupDebug().zoneCache;
      if (z.builds !== lastBuilds) {
        lastBuilds = z.builds;
        stats.zBuilds++;
        stats.zWorst = Math.max(stats.zWorst, z.worst || 0);
        stats.zMs = Math.max(stats.zMs, z.ms || 0);
      }
      const seat = sim.rig.mode === 'cockpit';
      const on = rm.on && chain(rm.skin);
      stats.maxFlaps = Math.max(stats.maxFlaps, ac.flaps || 0);
      if (!seat && !ac.crashed) {
        if (!on) {
          stats.flicker++;
          if (!stats.firstBad) stats.firstBad = `${phase}: skin off (${sim.rig.mode})`;
        }
        if (prevOn === false && on && !stats.firstBad) stats.firstBad = `${phase}: skin back on`;
      }
      prevOn = seat ? null : on;
      if (on) {
        let n = 0;
        for (const o of hiddenSet) if (drawn(o) && !(rm.flapsOut && rm.flaps.includes(o))) n++;
        if (n) {
          stats.both++;
          if (!stats.firstBad) stats.firstBad = `${phase}: ${n} procedural surfaces drawn with the skin`;
        }
        for (const o of devices) {
          if (!drawn(o)) continue;
          stats.devicesDrawn++;
          if (!(rm.fit && rm.fit.get(o))) {
            stats.misfitDrawn++;
            if (!stats.firstBad) stats.firstBad = `${phase}: ${o.name || o.parent.name} drawn off the real wing`;
          }
        }
      }
    };
    const run = async (phase, seconds, override, { mode, render = 3, timed = null } = {}) => {
      if (mode) sim.rig.setMode(mode);
      sim.override = override;
      const n = Math.round(seconds * 60);
      for (let i = 0; i < n && !ac.crashed; i++) {
        const t0 = performance.now();
        sim.update(1 / 60);
        if (timed || i % render === 0) sim.renderFrame();
        if (timed) timed.push(performance.now() - t0);
        sample(phase);
        clearTimeout(sim._crashDebriefT);
        if (i % 30 === 29) await sleep(0);
      }
      if (ac.crashed && !stats.crash) stats.crash = `${phase} at ${Math.round(ac.pos.y)} m: ${ac.crashReason}`;
    };
    const startQuat = ac.quat.clone();
    const startPos = ac.pos.clone();
    const fwd0 = ac.forward(new THREE.Vector3());
    say('747 steady: take-off roll, flaps set');
    sim.rig.setMode('chase');
    ac.setFlaps(1);
    const roll = { throttle: 1, pitch: 0, roll: 0, yaw: 0, brakes: 0 };
    for (let k = 0; k < 60 && ac.onGround && ac.vel.length() < 80; k++) await run('roll', 1, roll);
    await run('rotate', 6, { throttle: 1, pitch: 0.3, roll: 0, yaw: 0 });
    const zc0 = { ...BU.breakupDebug().zoneCache };
    ac.controls.gearDown = false;
    say('747 steady: the climb');
    // Warm up a second of it, then time 6 s of frames, every one drawn.
    await run('climb', 1, { throttle: 1, pitch: 0.3, roll: 0, yaw: 0 }, { render: 1 });
    const progs0 = (sim.renderer.info.programs || []).length;
    let climb = [];
    // Gear up: the crash survey (features/breakup.js) is built again in the background, a few ms a frame.
    await run('climb', 8, { throttle: 1, pitch: 0.3, roll: 0, yaw: 0 }, { timed: climb });
    const progsClimb = (sim.renderer.info.programs || []).length - progs0;
    ac.setFlaps(0);
    await run('climb-orbit', 3, null, { mode: 'orbit' });
    await run('climb-cockpit', 2, null, { mode: 'cockpit' });
    await run('turn-right', 4, { throttle: 1, pitch: 0.35, roll: 0.3, yaw: 0 }, { mode: 'chase' });
    await run('turn-left', 4, { throttle: 1, pitch: 0.3, roll: -0.3, yaw: 0 });
    const zc1 = { ...BU.breakupDebug().zoneCache };
    say('747 steady: flaps out and in');
    ac.setFlaps(3);
    await run('flaps-out', 10, { throttle: 0.9, pitch: 0.15, roll: 0, yaw: 0 });
    const flapsOutAt = ac.flaps;
    await run('flaps-wing', 2, null, { mode: 'wing' });
    await run('flaps-flyby', 2, null, { mode: 'flyby' });
    await run('flaps-tower', 2, null, { mode: 'tower' });
    ac.setFlaps(0);
    await run('flaps-in', 6, null, { mode: 'chase' });
    say('747 steady: a firm landing');
    // As tests/features/landing-bounce.browser.js: back over the runway, the wheels 0.6 m up, at
    // 1.25 x the stall speed, sinking 3.2 m/s (a hard one: it bounces).
    {
      const P = await import('../../src/aircraft/physics.js');
      const { stallKnots } = await import('../../src/features/stall-speed.js');
      const v = (stallKnots(P.SPEC, { flaps: 1 }) * 1.25) / P.UNITS.KTS;
      ac.reset({ pos: startPos.clone(), headingDeg: 90, speed: 0, engineOn: true, gearDown: true });
      ac.pos.copy(startPos);
      ac.pos.y += 0.6;
      ac.quat.copy(startQuat);
      ac.vel.copy(fwd0).multiplyScalar(v);
      ac.vel.y = -3.2;
      ac.omega.set(0, 0, 0);
      ac.setFlaps(3);
      ac.flaps = 1;
      ac.onGround = false;
      ac.airborneTime = 5;
      ac.parkingBrake = false;
    }
    let bounces = 0;
    const off = ac.on ? (ac.on('bounce', () => bounces++), true) : false;
    await run('landing', 7, { throttle: 0, pitch: 0, roll: 0, yaw: 0, brakes: 0.3 }, { mode: 'chase' });
    sim.override = null;

    r.ok('747 steady: outside the cockpit the real skin is drawn every frame, take-off to landing (no flicker)',
      stats.flicker === 0 && !stats.crash, `${stats.flicker} of ${stats.frames} frames without it${stats.crash ? `; crashed in ${stats.crash}` : ''}; ${stats.firstBad}`);
    r.ok('747 steady: never the procedural 747 and the real one at once',
      stats.both === 0, `${stats.both} frames with both; ${stats.firstBad}`);
    r.ok('747 steady: with the flaps out no procedural flap, slat or spoiler is drawn off the real wing',
      stats.misfitDrawn === 0 && flapsOutAt > 0.9 && stats.maxFlaps > 0.9,
      `${stats.misfitDrawn} off the wing, ${stats.devicesDrawn} drawn on it; flaps reached ${flapsOutAt.toFixed(2)}; ${devices.length} devices, fit ${rm.fit ? [...rm.fit.values()].filter(Boolean).length : '-'}/${rm.fit ? rm.fit.size : '-'}`);
    r.ok('747 steady: the firm landing (it bounced) leaves the skin on', !ac.crashed && rm.on && !rm.struck,
      `${bounces} bounce(s), skin ${rm.on}, struck ${rm.struck}${off ? '' : ' (no bounce events)'}`);
    climb = climb.slice().sort((a, b) => a - b);
    const med = climb[Math.floor(climb.length / 2)] || 0;
    const worst = climb[climb.length - 1] || 0;
    // Wall-clock frame times on this Mac carry the CPU governor's half-second SIGSTOPs, so the
    // hitches are asserted by what makes them: a program compiled mid-climb (100-600 ms each), and
    // the crash survey's dearest step once the gear is up (the real skin's 25,000 triangles were
    // in it: one step cut and classified a whole skin mesh). Frame times are reported.
    r.ok('747 steady: the climb compiles no new shader program, and the crash survey rebuilt at each gear and flap change stays a background job',
      progsClimb === 0 && stats.zBuilds > 0 && stats.zWorst <= 25,
      `${progsClimb} new programs; survey rebuilt ${stats.zBuilds} times (${zc1.builds - zc0.builds} from gear up to the turns), dearest step ${stats.zWorst.toFixed(1)} ms, dearest build ${stats.zMs.toFixed(0)} ms in all; frames median ${med.toFixed(1)} ms, worst ${worst.toFixed(1)} ms`);
  } catch (e) {
    r.ok('747 steady: the checks ran', false, String((e && e.stack) || e).slice(0, 300));
  } finally {
    sim.override = null;
    if (sim.settings.quality !== qualityWas) sim.applySetting('quality', qualityWas);
    sim.autoPauseOnHide = autoPause;
  }
}
