/**
 * Node checks for the high-speed shake hotfix. Run from anywhere:
 *
 *   node tests/features/shake.mjs [--verbose] [--quick]
 *
 * The owner, 2026-10-26, T-Pose Harrison in the follow view at 549 kt,
 * Mach 0.90, 3,540 ft, full power: "really shaky at this speed … the harrison
 * shaking is gonna cause someone a seizure". Two causes, both measured here
 * against the real flight model and the real camera rig, stepped the way
 * main.js steps them (physics.js frameSteps, then CameraRig.update(dt)):
 *
 *   1. THE ALIASING. A whole-step accumulator moved the aeroplane by 1, 2 or
 *      3 steps of 1/120 s a frame while the camera moved by the frame's dt:
 *      at 549 kt a step is 2.3 m, and Harrison is 6 m in front of the lens.
 *   2. THE SHAKE. The continuous vibration was centimetres at 3-10 Hz
 *      whatever the lens's distance (render/flash-safety.js SHAKE_CAP_DEG).
 *
 * For every fast jet (Harrison, Massimo, the F-22, F-35B, F/A-18, Vanguard,
 * Concorde and the Nightjar, the game's B-2) at Mach 0.8, 0.9, 1.0 and 1.2
 * (or as near its red line as it may go down low), low (1,080 m) and high
 * (11,000 m), at 60 and 144 frames a second with rAF's jitter, Reduce
 * flashing on and off, in the Cockpit, Follow, Wing, Orbit, Tower and Flyby
 * views. What the eye sees, in degrees of view:
 *
 *   - the background (the lens's own turn), the aeroplane's place on the
 *     screen and its size (outside), the panel (a metre from the eye, inside);
 *   - each as its wobble round a 0.5 s average (the flying taken out), split
 *     at 3 Hz by its spectrum;
 *   - continuous: the wobble never over SHAKE_CAP_DEG, nothing above 3 Hz
 *     bigger than HF_MAX (under half a pixel), the dominant frequency 3 Hz
 *     or under;
 *   - the aeroplane itself (the flight model): its attitude, the same way —
 *     no hunting.
 *
 * And a knock (a touchdown) may go over the cap, briefly: back under it in
 * KNOCK_DECAY_S, and from Harrison's 6 m no bigger an angle than from the
 * trainer's 17. The old code fails (the measured numbers are in the commit).
 *
 * Exits non-zero if anything fails.
 */

global.document = global.document || {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0, height: 0, style: {},
  }),
  body: { appendChild() {} },
};
if (typeof globalThis.localStorage === 'undefined') {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
}

const SRC = new URL('../../src/', import.meta.url).href;
const THREE = await import(SRC + 'vendor/three.module.js');
const P = await import(SRC + 'aircraft/physics.js');
const R = await import(SRC + 'aircraft/reheat.js');
const CAM = await import(SRC + 'flight/camera.js');
const FS = await import(SRC + 'render/flash-safety.js');
const { getAircraft } = await import(SRC + 'aircraft/types.js');
const { createAircraftModel } = await import(SRC + 'aircraft/model-adapter.js');
const { Weather } = await import(SRC + 'world/weather.js');
const AP = await import(SRC + 'flight/autopilot.js');
const Terrain = await import(SRC + 'world/terrain.js');
Terrain.applyMap('kestrel');

const VERBOSE = process.argv.includes('--verbose');
const QUICK = process.argv.includes('--quick');
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail: String(detail) });
  if (!pass || VERBOSE) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  return !!pass;
};

const DEG = 180 / Math.PI;
const STEP = 1 / 120;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** The comfort cap (render/flash-safety.js); 0.15 degrees if an old tree has none. */
const CAP = FS.SHAKE_CAP_DEG || 0.15;
/** Above 3 Hz, no more than this (degrees): at 68 degrees over 1,080 px, half a pixel. */
const HF_MAX = 0.03;
/** A wobble this small is under a pixel whatever its frequency. */
const SUBPIXEL = 0.03;
const MAX_HZ = 3;
const KNOCK_DECAY_S = 0.8;

const JETS = QUICK ? ['tpose', 'f22', 'concorde'] : ['tpose', 'massimo', 'f22', 'f35b', 'fa18', 'vanguard', 'concorde', 'nightjar'];
const MACHS = QUICK ? [0.9, 1.2] : [0.8, 0.9, 1.0, 1.2];
const ALTS = [1080, 11000];
/** Frames a second, and `hitch`: every fifth frame twice as long (a browser's uneven frames). */
const RATES = QUICK ? [{ hz: 144 }, { hz: 60, hitch: true }] : [{ hz: 60 }, { hz: 144 }, { hz: 60, hitch: true }];
const rateName = (r) => `${r.hz} Hz${r.hitch ? ' with hitches' : ''}`;
/** What is judged in each view: the background, the aeroplane's place and size, the panel. */
const SIGNALS = {
  cockpit: ['panelX', 'panelY', 'panelZ', 'headYaw', 'headPitch'],
  chase: ['bgYaw', 'bgPitch', 'acX', 'acY', 'size'],
  wing: ['bgYaw', 'bgPitch', 'acX', 'acY', 'size'],
  orbit: ['bgYaw', 'bgPitch', 'acX', 'acY', 'size'],
  // The two that stand still and turn to follow it: the aeroplane's place on the screen.
  tower: ['acX', 'acY'],
  flyby: ['acX', 'acY'],
};
const VIEWS = ['cockpit', 'chase', 'wing', 'orbit', 'tower', 'flyby'];

/** How main.js steps the flight model across a frame (the old accumulator, on a tree without frameSteps). */
function stepper() {
  if (typeof P.frameSteps === 'function') {
    return (ac, dt, w) => {
      const { n, h } = P.frameSteps(dt);
      for (let i = 0; i < n; i++) ac.update(h, w);
    };
  }
  let acc = 0;
  return (ac, dt, w) => {
    acc += Math.min(dt, 0.1);
    let s = 0;
    while (acc >= STEP && s < 12) {
      ac.update(STEP, w);
      acc -= STEP;
      s++;
    }
  };
}

/* --------------------------------------------------------------- signal -- */

/** x minus its centred moving average over `w` samples each side (edges trimmed). */
function wobble(x, w) {
  const out = [];
  let s = 0;
  for (let i = 0; i < 2 * w + 1 && i < x.length; i++) s += x[i];
  for (let i = w; i < x.length - w; i++) {
    out.push(x[i] - s / (2 * w + 1));
    if (i + w + 1 < x.length) s += x[i + w + 1] - x[i - w];
  }
  return out;
}

/**
 * A wobble's peak, and its rms below and above `split` Hz (Hann window,
 * Parseval: the energy above is the whole less the bins up to `split`).
 */
function spectrum(r, hz, split = MAX_HZ) {
  const N = r.length;
  if (N < 8) return { peak: 0, lo: 0, hi: 0 };
  let peak = 0;
  let total = 0;
  let wsum = 0;
  const y = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    peak = Math.max(peak, Math.abs(r[i]));
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    y[i] = r[i] * w;
    total += y[i] * y[i];
    wsum += w * w;
  }
  const K = Math.floor((split * N) / hz);
  let low = 0;
  for (let k = 0; k <= K; k++) {
    let re = 0;
    let im = 0;
    const a = (-2 * Math.PI * k) / N;
    for (let i = 0; i < N; i++) {
      re += y[i] * Math.cos(a * i);
      im += y[i] * Math.sin(a * i);
    }
    low += (k === 0 ? 1 : 2) * (re * re + im * im);
  }
  low /= N;
  const high = Math.max(0, total - low);
  return { peak, lo: Math.sqrt(low / wsum), hi: Math.sqrt(high / wsum) };
}

/** `x` sampled at times `ts`, on an even grid of 1/hz (a hitch is a long frame in time, not in samples). */
function resample(x, ts, hz) {
  if (!ts || ts.length !== x.length || x.length < 2) return x;
  const out = [];
  let j = 0;
  for (let t = ts[0]; t <= ts[ts.length - 1]; t += 1 / hz) {
    while (j < ts.length - 2 && ts[j + 1] < t) j++;
    const u = clamp((t - ts[j]) / Math.max(1e-9, ts[j + 1] - ts[j]), 0, 1);
    out.push(x[j] + (x[j + 1] - x[j]) * u);
  }
  return out;
}

/** The verdict on one signal: under the cap, nothing much above 3 Hz, dominant under 3 Hz. */
function judge(series, hz, ts = null, { raw = false } = {}) {
  const even = resample(series, ts, hz);
  const r = raw ? even : wobble(even, Math.round(hz / 4));
  const s = spectrum(r, hz);
  const hiAmp = s.hi * Math.SQRT2;
  return {
    ...s,
    hiAmp,
    under: s.peak <= CAP,
    hfOk: hiAmp <= HF_MAX,
    // Above 3 Hz only matters if it is more than half a pixel.
    domOk: s.peak < SUBPIXEL || hiAmp <= HF_MAX || s.hi <= s.lo,
  };
}

/* --------------------------------------------------------------- flying -- */

const models = new Map();
function frameFor(id) {
  if (!models.has(id)) {
    P.applyAircraft(id);
    const model = createAircraftModel({ type: getAircraft(id) });
    const pts = CAM.drawnPoints(model);
    models.set(id, { frame: CAM.airframeFrame(model, pts), fit: CAM.chaseScaleFor(model, 1, 1, pts) });
  }
  return models.get(id);
}

/**
 * The aeroplane as one rig sees it, less every source of vibration (engine,
 * buffet, Mach, rolling): the same position, attitude and motion, so a rig on
 * this and a rig on the real one differ by the continuous shake alone.
 */
function calm(ac) {
  return new Proxy(ac, {
    get(t, k) {
      if (k === 'rpm' || k === 'buffet' || k === 'mach') return 0;
      if (k === 'onGround') return false;
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

/** The background's turn, the aeroplane's place and size, the panel: one rig's view this frame. */
function viewOf(Rg, ac, radius, inv, tmp) {
  const cam = Rg.camera;
  const out = {};
  const fwd = tmp.f.set(0, 0, -1).applyQuaternion(cam.quaternion);
  if (!Rg.ref) {
    const f0 = fwd.clone();
    const r0 = new THREE.Vector3().crossVectors(f0, new THREE.Vector3(0, 1, 0)).normalize();
    Rg.ref = { f0, r0, u0: new THREE.Vector3().crossVectors(r0, f0).normalize() };
  }
  out.bgYaw = Math.atan2(fwd.dot(Rg.ref.r0), fwd.dot(Rg.ref.f0)) * DEG;
  out.bgPitch = Math.atan2(fwd.dot(Rg.ref.u0), fwd.dot(Rg.ref.f0)) * DEG;
  if (Rg.view === 'cockpit') {
    // The head in the aeroplane (the world outside moves with the aeroplane, judged on its own).
    fwd.applyQuaternion(inv);
    out.headYaw = Math.atan2(fwd.x, -fwd.z) * DEG;
    out.headPitch = Math.asin(clamp(fwd.y, -1, 1)) * DEG;
    // The eye in the aeroplane's own frame: how far the panel, a metre off, moves.
    const b = tmp.b.subVectors(cam.position, ac.pos).applyQuaternion(inv);
    out.panelX = Math.atan(b.x) * DEG;
    out.panelY = Math.atan(b.y) * DEG;
    out.panelZ = Math.atan(b.z) * DEG;
  } else {
    cam.updateMatrixWorld();
    const to = tmp.t.copy(Rg.rig.aimPoint(ac));
    const d = to.distanceTo(cam.position);
    to.applyMatrix4(cam.matrixWorldInverse);
    out.acX = Math.atan2(to.x, -to.z) * DEG;
    out.acY = Math.atan2(to.y, -to.z) * DEG;
    out.size = 2 * Math.atan(radius / Math.max(0.5, d)) * DEG;
  }
  return out;
}

/**
 * One flight: `id` level at `alt`, from Mach `M` (or as near its red line as
 * it may go down low), full power, at `rate`, with a rig in every view,
 * Reduce flashing on and off, each beside a twin on calm(ac). `pilot`:
 * 'hands-off' (the autopilot trims it out, then the stick is let go: the
 * simplified mode's own leveller flies it) or 'autopilot' (P, throughout).
 */
function fly(id, M, alt, rate, pilot = 'hands-off') {
  const hz = rate.hz;
  const F = frameFor(id);
  P.applyAircraft(id);
  const ac = new P.Aircraft();
  ac.mode = 'simplified';
  const w = new Weather();
  w.windSpeedKts = 0;
  let tas = M * R.speedOfSound(alt);
  const start = () => {
    ac.reset({ pos: new THREE.Vector3(-2500, 0, 0), headingDeg: 90, engineOn: true, gearDown: false, speed: tas, altAGL: alt });
    ac.pos.y = alt;
    ac.rpm = 1;
  };
  start();
  ac.update(STEP, w);
  const vne = P.SPEC.vne;
  let capped = false;
  if (ac.ias > 0.95 * vne) {
    tas *= (0.95 * vne) / ac.ias;
    capped = true;
    start();
  }
  const quiet = calm(ac);
  const rigs = [];
  for (const view of VIEWS) {
    for (const reduce of [true, false]) {
      const pair = [ac, quiet].map((who) => {
        const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.1, 60000);
        const rig = new CAM.CameraRig(camera, who);
        if (id === 'tpose') {
          rig.chaseBack = 5.6; // features/tpose.js CHASE
          rig.chaseUp = 1.8;
        } else {
          rig.chaseBack = CAM.CHASE_BACK * F.fit;
          rig.chaseUp = CAM.CHASE_UP * F.fit;
        }
        if (F.frame) rig.setFrame(F.frame, {});
        rig.setMode(view);
        return { view, rig, camera, who };
      });
      rigs.push({ view, reduce, real: pair[0], twin: pair[1], abs: {}, shake: {} });
    }
  }
  const step = stepper();
  const ap = new AP.Autopilot();
  ap.setEngaged(true, ac);
  ap.targetAltFt = alt * 3.28084;
  const att = { yaw: [], pitch: [], roll: [] };
  const ts = [];
  let clock = 0;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const settle = Math.round(hz * 3);
  const frames = settle + Math.round(hz * 4);
  const radius = F.frame ? F.frame.radius || F.frame.halfSpan || 5 : 5;
  const inv = new THREE.Quaternion();
  const tmp = { f: new THREE.Vector3(), b: new THREE.Vector3(), t: new THREE.Vector3() };
  const e = new THREE.Euler();
  for (let f = 0; f < frames && !ac.crashed; f++) {
    const dt = (rate.hitch && f % 5 === 4 ? 2 : 1) / hz + (rnd() - 0.5) * 0.0008; // rAF's jitter, +/- 0.4 ms
    if (pilot === 'autopilot' || f < settle - hz) {
      const o = ap.update(dt, ac, null);
      ac.controls.pitch = o.pitch;
      ac.controls.roll = o.roll;
      ac.controls.yaw = o.yaw;
    } else {
      ac.controls.pitch = 0;
      ac.controls.roll = 0;
      ac.controls.yaw = 0;
    }
    ac.controls.throttle = 1; // full power, as the owner flew it
    step(ac, dt, w);
    clock += dt;
    for (const rg of rigs) {
      FS.setReduceFlashing(rg.reduce);
      rg.real.rig.update(dt, ac, null, w);
      rg.twin.rig.update(dt, quiet, null, w);
    }
    if (f < settle) continue;
    ts.push(clock);
    e.setFromQuaternion(ac.quat, 'YXZ');
    att.yaw.push(e.y * DEG);
    att.pitch.push(e.x * DEG);
    att.roll.push(e.z * DEG);
    inv.copy(ac.quat).invert();
    for (const rg of rigs) {
      const a = viewOf(rg.real, ac, radius, inv, tmp);
      const b = viewOf(rg.twin, ac, radius, inv, tmp);
      for (const k of SIGNALS[rg.view]) {
        (rg.abs[k] || (rg.abs[k] = [])).push(a[k]);
        (rg.shake[k] || (rg.shake[k] = [])).push(a[k] - b[k]);
      }
    }
  }
  FS.setReduceFlashing(true);
  const chase = rigs.find((x) => x.view === 'chase');
  inv.copy(ac.quat).invert();
  const stand = chase ? chase.real.camera.position.clone().sub(chase.real.rig.aimPoint(ac)).applyQuaternion(inv).z : null;
  const out = { id, M, alt, hz, capped, stand, pilot, crashed: ac.crashed, att: {}, views: [] };
  out.att = { yaw: judge(att.yaw, hz, ts), pitch: judge(att.pitch, hz, ts), roll: judge(att.roll, hz, ts) };
  for (const rg of rigs) {
    const abs = {};
    const shake = {};
    for (const k of SIGNALS[rg.view]) {
      abs[k] = judge(rg.abs[k], hz, ts);
      // The shake on its own: no average taken out (it has none), the whole of it.
      shake[k] = judge(rg.shake[k], hz, ts, { raw: true });
    }
    out.views.push({ view: rg.view, reduce: rg.reduce, abs, shake });
  }
  return out;
}

/* ---------------------------------------------------------------- 1. jets -- */

const W0 = { peak: 0, where: '' };
const worst = { shake: { ...W0 }, shakeHi: { ...W0 }, absHi: { ...W0 }, abs: { ...W0 }, att: { ...W0 }, attHi: { ...W0 } };
const fails = { crash: [], cap: [], hf: [], dom: [], absHf: [], absCap: [], att: [], attHf: [] };
const keep = (slot, v, where) => {
  if (v > slot.peak) Object.assign(slot, { peak: v, where });
};
/** Slow wobble of the aeroplane itself allowed on a steady run (no hunting): a fifth of a degree. */
const ATT_MAX = 0.2;
const t0 = Date.now();
let flights = 0;
for (const pilot of ['hands-off', 'autopilot']) {
  for (const id of JETS) {
    for (const alt of ALTS) {
      for (const M of MACHS) {
        for (const rate of RATES) {
          const r = fly(id, M, alt, rate, pilot);
          flights++;
          const tag = `${pilot} ${id} M${M}${r.capped ? '(red line)' : ''} ${alt} m ${rateName(rate)}`;
          if (r.crashed) {
            fails.crash.push(tag);
            continue;
          }
          for (const [k, j] of Object.entries(r.att)) {
            keep(worst.att, j.peak, `${tag} ${k}`);
            keep(worst.attHi, j.hiAmp, `${tag} ${k}`);
            if (!j.hfOk) fails.attHf.push(`${tag} ${k} ${j.hiAmp.toFixed(3)} deg`);
            if (j.peak > ATT_MAX) fails.att.push(`${tag} ${k} ${j.peak.toFixed(3)} deg`);
          }
          for (const v of r.views) {
            const sw = `reduce=${v.reduce ? 'on' : 'off'}`;
            for (const [k, j] of Object.entries(v.shake)) {
              const where = `${tag} ${v.view} ${k} ${sw}`;
              keep(worst.shake, j.peak, where);
              keep(worst.shakeHi, j.hiAmp, where);
              if (!j.under) fails.cap.push(`${where} ${j.peak.toFixed(3)} deg`);
              if (!j.hfOk) fails.hf.push(`${where} ${j.hiAmp.toFixed(3)} deg`);
              if (!j.domOk) fails.dom.push(`${where} lo ${j.lo.toFixed(4)} hi ${j.hi.toFixed(4)}`);
            }
            for (const [k, j] of Object.entries(v.abs)) {
              const where = `${tag} ${v.view} ${k} ${sw}`;
              keep(worst.abs, j.peak, where);
              keep(worst.absHi, j.hiAmp, where);
              if (!j.hfOk) fails.absHf.push(`${where} ${j.hiAmp.toFixed(3)} deg`);
              if (!j.under) fails.absCap.push(`${where} ${j.peak.toFixed(3)} deg`);
            }
          }
        }
      }
    }
  }
}
const list = (a) => (a.length ? `${a.length}: ${a.slice(0, 4).join('; ')}${a.length > 4 ? ' …' : ''}` : 'none');
const w = (slot) => `worst ${slot.peak.toFixed(3)} deg, ${slot.where}`;
ok(`every fast jet, Mach ${MACHS.join('/')}, low and high, ${RATES.map(rateName).join(', ')}, hands off and on the autopilot: flown without breaking up`, !fails.crash.length, list(fails.crash));
ok(`THE SHAKE, every view, Reduce flashing on AND off: never over the ${CAP} degree cap`, !fails.cap.length, `${w(worst.shake)}; over: ${list(fails.cap)}`);
ok(`...nothing of it above ${MAX_HZ} Hz bigger than ${HF_MAX} degrees (half a pixel)`, !fails.hf.length, `${w(worst.shakeHi)}; over: ${list(fails.hf)}`);
ok(`...and its dominant frequency ${MAX_HZ} Hz or under`, !fails.dom.length, list(fails.dom));
ok(`WHAT THE EYE SEES (flying and shake together): nothing above ${MAX_HZ} Hz bigger than ${HF_MAX} degrees — no aliasing, no jerks`, !fails.absHf.length, `${w(worst.absHi)}; over: ${list(fails.absHf)}`);
ok(`...and on these steady runs it wanders no more than the ${CAP} degree cap`, !fails.absCap.length, `${w(worst.abs)}; over: ${list(fails.absCap)}`);
ok(`THE AEROPLANE does not hunt at 500+ kt: its attitude has nothing above ${MAX_HZ} Hz`, !fails.attHf.length, `${w(worst.attHi)}; ${list(fails.attHf)}`);
ok(`...and wobbles less than ${ATT_MAX} degrees on a steady run, hands off or on the autopilot`, !fails.att.length, `${w(worst.att)}; ${list(fails.att)}`);
if (VERBOSE) console.log(`  (${flights} flights, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);

/* ------------------------------------------------- 2. the owner's moment -- */

{
  // Harrison, Follow, 549 kt at 3,540 ft, full power, both switches, three refresh rates.
  const rows = [];
  for (const rate of [{ hz: 30 }, { hz: 60 }, { hz: 120 }, { hz: 144 }, { hz: 60, hitch: true }]) {
    const r = fly('tpose', (549 / 1.94384) / R.speedOfSound(1080), 1080, rate);
    for (const v of r.views.filter((x) => x.view === 'chase')) {
      const m = Math.max(...Object.values(v.abs).map((j) => j.peak), ...Object.values(v.shake).map((j) => j.peak));
      rows.push({ rate, reduce: v.reduce, m, size: v.abs.size.peak, stand: r.stand });
    }
  }
  const m = Math.max(...rows.map((x) => x.m));
  ok('T-Pose Harrison, Follow, 549 kt at 3,540 ft (the owner\'s screenshot): under the cap at 30, 60, 120 and 144 Hz and with hitches', m <= CAP,
    rows.map((x) => `${rateName(x.rate)} ${x.reduce ? 'on' : 'off'} ${x.m.toFixed(3)} deg`).join(', '));
  const st = rows.map((x) => x.stand).filter((x) => x != null);
  ok('...and the follow lens stands as far behind him at every frame rate (it ran ahead of its spring by speed x dt)', st.length && Math.max(...st) - Math.min(...st) < 0.25,
    `${Math.min(...st).toFixed(2)}..${Math.max(...st).toFixed(2)} m behind`);
}

/* --------------------------------------------------------- 3. the knocks -- */

{
  // A touchdown-sized knock in the follow view: over the cap for a moment, under it again soon after.
  const knock = (id, back, up) => {
    const ac = {
      pos: new THREE.Vector3(0, 800, 0), quat: new THREE.Quaternion(), vel: new THREE.Vector3(0, 0, -60),
      rpm: 0.8, buffet: 0, onGround: false, groundSpeed: 0, airspeed: 60, ias: 60, mach: 0.18, gLoad: 1, bankAngleDeg: () => 0, crashed: false,
    };
    const track = (kick) => {
      const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.1, 60000);
      const rig = new CAM.CameraRig(camera, ac);
      rig.chaseBack = back;
      rig.chaseUp = up;
      rig.setMode('chase');
      const a = [];
      const f = new THREE.Vector3();
      for (let i = 0; i < 240; i++) {
        if (i === 24 && kick) rig.kick(1.0);
        rig.update(1 / 120, ac, null, null);
        f.set(0, 0, -1).applyQuaternion(camera.quaternion);
        a.push(f.clone());
      }
      return a;
    };
    FS.setReduceFlashing(true);
    const k = track(true);
    const n = track(false);
    const ang = k.map((v, i) => Math.acos(clamp(v.dot(n[i]), -1, 1)) * DEG);
    const peak = Math.max(...ang);
    let back2 = null;
    for (let i = 24; i < ang.length; i++) if (ang.slice(i).every((x) => x <= CAP)) { back2 = (i - 24) / 120; break; }
    return { peak, back: back2 };
  };
  const trainer = knock('skylark', 17, 5.2);
  const harrison = knock('tpose', 5.6, 1.8);
  ok(`a knock (a touchdown) may pass the cap briefly, and is back under it within ${KNOCK_DECAY_S} s`, harrison.back !== null && harrison.back <= KNOCK_DECAY_S && trainer.back !== null && trainer.back <= KNOCK_DECAY_S,
    `Harrison ${harrison.peak.toFixed(2)} deg, under the cap after ${harrison.back} s; trainer ${trainer.peak.toFixed(2)} deg, ${trainer.back} s`);
  ok('...and from Harrison\'s 6 m it is no bigger an angle than from the trainer\'s 17 m', harrison.peak <= trainer.peak * 1.15,
    `${harrison.peak.toFixed(2)} vs ${trainer.peak.toFixed(2)} deg`);
}

/* -------------------------------------------------- 4. frame stepping -- */

{
  const has = typeof P.frameSteps === 'function';
  ok('physics.js frameSteps: a frame is cut into equal steps of at most 1/120 s', has);
  if (has) {
    const cases = [1 / 60, 1 / 30, 1 / 144, 1 / 120, 0.0171, 0.0163, 0.25, 0];
    const bad = cases.filter((dt) => {
      const { n, h } = P.frameSteps(dt);
      const want = Math.min(dt, 0.1);
      return want > 0 ? !(h <= STEP + 1e-12 && Math.abs(n * h - want) < 1e-12 && n <= 12) : n !== 0;
    });
    ok('...that add up to exactly the frame (clamped at 0.1 s, at most 12)', !bad.length, bad.join(', '));
    const a = P.frameSteps(1 / 60);
    const b = P.frameSteps(1 / 30);
    ok('...and a 1/60 or 1/30 s frame is still 2 or 4 steps of exactly 1/120 s', a.n === 2 && b.n === 4 && Math.abs(a.h - STEP) < 1e-15 && Math.abs(b.h - STEP) < 1e-15, `${a.n} x ${a.h}, ${b.n} x ${b.h}`);
  }
}

/* --------------------------------------------- 5. reduce motion, cockpit -- */

{
  // Transonic, full power: the buzz at its strongest. Reduce motion takes it further down, and so
  // does Reduce flashing in the cockpit (CAPS.cockpitBuzz), on top of the cap.
  const ac = {
    pos: new THREE.Vector3(0, 800, 0), quat: new THREE.Quaternion(), vel: new THREE.Vector3(0, 0, -330),
    rpm: 1, buffet: 0.6, onGround: false, groundSpeed: 0, airspeed: 330, ias: 300, mach: 1.0, gLoad: 1, bankAngleDeg: () => 0, crashed: false,
  };
  const panel = (reduce, motion) => {
    FS.setReduceFlashing(reduce);
    const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.1, 60000);
    const rig = new CAM.CameraRig(camera, ac);
    rig.reducedMotion = motion;
    rig.setMode('cockpit');
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 480; i++) {
      rig.update(1 / 120, ac, null, null);
      if (i > 120) {
        lo = Math.min(lo, camera.position.y);
        hi = Math.max(hi, camera.position.y);
      }
    }
    return Math.atan((hi - lo) / 2) * DEG; // half the range, a metre off: the panel's swing
  };
  const off = panel(false, false);
  const on = panel(true, false);
  const offRm = panel(false, true);
  ok('cockpit at Mach 1, full power, stall buffet, Reduce flashing off: the panel within the cap', off <= CAP * 1.01 && off > 0.01, `${off.toFixed(3)} deg`);
  ok('...Reduce flashing on: CAPS.cockpitBuzz of that', on <= off * FS.CAPS.cockpitBuzz * 1.05, `${on.toFixed(4)} deg`);
  ok('...Reduce motion: a quarter of it, or less', offRm <= off * 0.26, `${offRm.toFixed(4)} deg`);
  FS.setReduceFlashing(true);
}

/* ------------------------------------------------------- 6. the tower -- */

{
  // The World Map — Preview (the owner's screenshot): Harrison 44 km from the start
  // field, 554 kt, Tower view. The lens must be near him, not 44 km away.
  const ac = {
    pos: new THREE.Vector3(44000, 1100, 0), quat: new THREE.Quaternion(), vel: new THREE.Vector3(285, 0, 0),
    rpm: 1, buffet: 0, onGround: false, groundSpeed: 0, airspeed: 285, ias: 270, mach: 0.86, gLoad: 1, bankAngleDeg: () => 0, crashed: false,
  };
  ac.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
  const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.1, 60000);
  const rig = new CAM.CameraRig(camera, ac);
  const F = frameFor('tpose');
  if (F.frame) rig.setFrame(F.frame, {});
  rig.setMode('tower');
  let maxD = 0;
  let cuts = 0;
  let last = null;
  for (let i = 0; i < 60 * 40; i++) {
    ac.pos.addScaledVector(ac.vel, 1 / 60);
    rig.update(1 / 60, ac, null, null);
    const d = camera.position.distanceTo(ac.pos);
    if (i > 2) maxD = Math.max(maxD, d);
    if (last && camera.position.distanceTo(last) > 1) cuts++;
    last = camera.position.clone();
  }
  const ground = Terrain.heightAt(camera.position.x, camera.position.z);
  ok('Tower view, 44 km from every tower: a spotter\'s lens, within 12 km of the aeroplane all the way', maxD < 12000, `furthest ${(maxD / 1000).toFixed(1)} km, ${cuts} cut(s) in 40 s`);
  ok('...standing still between clean cuts (no sliding lens), above the ground or the sea', cuts >= 1 && cuts <= 8 && camera.position.y >= Math.max(0, ground) + 20, `${cuts} cuts, ${Math.round(camera.position.y - Math.max(0, ground))} m up`);
  // Back near the start field: the old balcony, exactly.
  ac.pos.set(-1500, 300, 0);
  rig.update(1 / 60, ac, null, null);
  const home = camera.position;
  ok('...and near the start field it is the start field\'s tower balcony, as it always was', Math.abs(home.x - 40) < 1e-6 && Math.abs(home.z - -195) < 1e-6,
    `${home.x.toFixed(1)}, ${home.y.toFixed(1)}, ${home.z.toFixed(1)}`);
}

/* -------------------------------------------------------------- report -- */

const failed = results.filter((r) => !r.pass);
console.log(`\nshake: ${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
