/**
 * THE SKYHOOK IN NODE: the helicopter every player flies, checked headless
 * against the real flight model and the real stability assist, in seconds.
 *
 *   node tests/features/heli.mjs
 *
 * tests/features/heli-playtest.browser.js presses the keys a player presses
 * in a real browser (61 checks, two minutes of headless Chrome). This is the
 * same helicopter driven the same way — a lever that ramps at the input
 * layer's 0.62/s while Shift or Ctrl is down, a stick that moves at its
 * 3.1/s and springs back at 4.4/s, the assist's own lever follow-up applied
 * the way main.js applies it — without a browser, so the numbers that decide
 * whether the helicopter is a game or a trap are pinned where `node` can
 * run them:
 *   - let go of the lever and the climb stops and the height holds;
 *   - the lever comes to the hover mark by itself;
 *   - hands off, calm or in fifteen knots of wind, it stays put;
 *   - taps in wind move it the tapped way and never back;
 *   - W flies it forwards at its height, nose down no more than the
 *     envelope allows, and let go it levels and comes back to a hover;
 *   - E turns it on the spot and stops within twelve degrees;
 *   - W and A held together for fifteen seconds turns it and keeps its
 *     height (the hold's lever pinned at 100% while it sank, before);
 *   - Shift and W together from the pad lift off level and fly, in both
 *     modes (nose first into the pad, before);
 *   - Ctrl held to the ground is a soft landing, and Ctrl at speed keeps
 *     the skids up until it slows;
 *   - the assist switched off, the lever stays where it is left;
 *   - P in the hover holds the spot, and P at speed holds height and heading;
 *   - the Follow lens beside a building sees the machine and never jumps;
 *   - nothing a player can read in the helicopter's files says "kid";
 *   - and the whole of it costs what a frame can afford (the numbers are
 *     printed; the budget is generous so a slow Mac does not fail it, and a
 *     real regression — a scan of every box every frame — still would).
 *
 * The thresholds are the browser playtest's. Where the two disagree, the
 * browser is the game and this file is wrong.
 */
global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0, height: 0, style: {},
  }),
  body: { appendChild() {} },
};

import { readFileSync } from 'node:fs';

const SRC = new URL('../../src/', import.meta.url).href;
const THREE = await import(SRC + 'vendor/three.module.js');
const P = await import(SRC + 'aircraft/physics.js');
const TER = await import(SRC + 'world/terrain.js');
const { RUNWAY_START } = await import(SRC + 'game/missions.js');
const { Autopilot } = await import(SRC + 'flight/autopilot.js');
let CAM = null;
let camErr = '';
try {
  CAM = await import(SRC + 'flight/camera.js');
} catch (e) {
  camErr = String(e && e.message);
}

TER.applyMap(TER.MAP.id);

let failed = 0;
let passed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${detail}` : ''}`);
}
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));

/* ------------------------------------------------------------------ *
 * The air
 * ------------------------------------------------------------------ */
const wind = new THREE.Vector3();
const weather = {
  windVector: (o) => (o || new THREE.Vector3()).copy(wind),
  gustVector: (o) => (o || new THREE.Vector3()).set(0, 0, 0),
  turbulenceLevel: () => 0,
  cond: { rain: 0, cloud: 0 },
  time_s: 0,
  downdraft: 0,
  vortex: null,
  isNight: false,
};
const KT = 0.514444;
/** A steady wind of `kts` blowing towards +x (from the west). */
const setWind = (kts) => wind.set(kts * KT, 0, 0);

/* ------------------------------------------------------------------ *
 * The pilot: the input layer's lever and stick, without a keyboard
 * ------------------------------------------------------------------ */
class Pilot {
  constructor(simple = true) {
    this.keys = new Set();
    this.target = 0; // the lever (input.throttleTarget)
    this.out = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
    this.leverHeld = false;
    this.rate = simple ? 3.1 : 2.3;
    this.center = simple ? 4.4 : 2.4;
  }
  press(...ks) {
    for (const k of ks) this.keys.add(k);
  }
  release(...ks) {
    for (const k of ks) this.keys.delete(k);
  }
  allUp() {
    this.keys.clear();
  }
  /** input.js update(): one 60 Hz frame of key ramps. */
  frame(dt) {
    const k = this.keys;
    const want = {
      pitch: (k.has('W') ? -1 : 0) + (k.has('S') ? 1 : 0),
      roll: (k.has('A') ? -1 : 0) + (k.has('D') ? 1 : 0),
      yaw: (k.has('Q') ? -1 : 0) + (k.has('E') ? 1 : 0),
    };
    for (const key of ['pitch', 'roll', 'yaw']) {
      const cur = this.out[key];
      const target = want[key];
      if (Math.abs(target) > 0.01) {
        this.out[key] = THREE.MathUtils.clamp(cur + Math.sign(target) * this.rate * dt * (0.4 + Math.abs(target)), -1, 1);
      } else {
        this.out[key] = Math.abs(cur) < 0.02 ? 0 : cur - Math.sign(cur) * Math.min(Math.abs(cur), this.center * dt);
      }
    }
    const up = k.has('Shift');
    const down = k.has('Ctrl');
    if (up) this.target = THREE.MathUtils.clamp(this.target + dt * 0.62, 0, 1);
    if (down) this.target = THREE.MathUtils.clamp(this.target - dt * 0.62, 0, 1);
    this.out.throttle = THREE.MathUtils.lerp(this.out.throttle, this.target, Math.min(1, dt * 6));
    this.leverHeld = up || down;
  }
  /** main.js: the assist's lever follow-up moves the lever on screen. */
  nudge(d) {
    if (d) this.target = THREE.MathUtils.clamp(this.target + d, 0, 1);
  }
}

/* ------------------------------------------------------------------ *
 * The machine
 * ------------------------------------------------------------------ */
const skidH = (ac) => {
  const R = ac.rotor;
  if (R && Number.isFinite(R.heightAbove)) return R.heightAbove;
  return ac.pos.y - TER.heightAt(ac.pos.x, ac.pos.z) - 1.69;
};
const tilt = (ac) => {
  const r = ac.readouts();
  return Math.max(Math.abs(r.pitch), Math.abs(r.bank));
};
const wrap = (d) => ((d + 540) % 360) - 180;
// The lever that holds a hover, on the lever's own 0-1 travel (as the HUD and
// the browser playtest work it out from the hover collective).
const hoverLever = (ac) => {
  const R = ac.rotor || {};
  return Number.isFinite(R.hoverPoint) ? (R.hoverPoint - 0.18) / 0.82 : NaN;
};

/** A fresh Skyhook on the runway, engine on, the assist as asked. */
function spawn({ mode = 'simplified', assist = true } = {}) {
  P.applyAircraft('harrier');
  const ac = new P.Aircraft();
  ac.mode = mode;
  ac.hoverAssist = assist;
  ac.reset({ ...RUNWAY_START, engineOn: true });
  ac.settleOnGear();
  return ac;
}

const FRAME = 1 / 60;
const STEP = 1 / 120;
/**
 * Fly `secs`: the pilot's frame, the controls handed over the way main.js
 * hands them, two 120 Hz physics steps, the assist's lever follow-up. `each`
 * runs after every frame with the time flown; returning true stops early.
 * With `ap` (an engaged Autopilot) its output flies instead of the stick.
 */
function fly(ac, pilot, secs, each, ap = null) {
  const n = Math.max(1, Math.round(secs * 60));
  for (let i = 0; i < n; i++) {
    pilot.frame(FRAME);
    let c = pilot.out;
    if (ap) c = ap.update(FRAME, ac, ap.__target || null);
    ac.controls.pitch = c.pitch;
    ac.controls.roll = c.roll;
    ac.controls.yaw = c.yaw;
    ac.controls.throttle = c.throttle;
    ac.controls.brakes = 0;
    ac.controls.leverHeld = pilot.leverHeld;
    ac.autopilotOn = !!ap;
    if (ap) pilot.target = c.throttle;
    for (let s = 0; s < 2; s++) {
      ac.update(STEP, weather);
      if (!ap && ac.rotor && ac.rotor.trimRequest) pilot.nudge(ac.rotor.trimRequest * STEP);
    }
    if (ac.crashed) return true;
    if (each && each((i + 1) * FRAME) === true) return true;
  }
  return false;
}
const hold = (ac, pilot, keys, secs, each, ap) => {
  pilot.press(...keys);
  const out = fly(ac, pilot, secs, each, ap);
  pilot.release(...keys);
  return out;
};
/** Up to about `h` m of air under the skids, letting go early the way a player learns to. */
function liftTo(ac, pilot, h) {
  hold(ac, pilot, ['Shift'], 20, () => {
    const vs = Math.max(0, ac.vs);
    return skidH(ac) + (vs * vs) / 6 + vs * 0.3 > h;
  });
  fly(ac, pilot, 5);
}
/** A fresh machine hovering at `h` m. */
function hovering(h, opts) {
  const ac = spawn(opts);
  const pilot = new Pilot(ac.mode === 'simplified');
  fly(ac, pilot, 1);
  liftTo(ac, pilot, h);
  return { ac, pilot };
}
const horizMoved = (ac, from) => Math.hypot(ac.pos.x - from.x, ac.pos.z - from.z);

/* ================================================================== *
 * Nothing a player reads says "kid"
 * ================================================================== */
{
  const files = ['ui/hud-rotor.js', 'game/missions-heli.js', 'aircraft/rotor-assist.js', 'fleet/helicopter.js', 'ui/touch.js'];
  const hits = [];
  for (const f of files) {
    const src = readFileSync(new URL(SRC + f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(/^.*\bkid\b.*$/gim)) hits.push(`${f}: ${m[0].trim().slice(0, 80)}`);
  }
  ok('nothing a player can read in the helicopter\'s files says "kid" (comments aside)', hits.length === 0, hits.join(' | ') || `${files.length} files clean`);
}

/* ================================================================== *
 * The lever
 * ================================================================== */
{
  const ac = spawn();
  const pilot = new Pilot();
  fly(ac, pilot, 1);
  ok('on the pad, engine at idle, the assist is on and the readouts are there', ac.rotor && ac.rotor.assistOn === true && ac.onGround, `assistOn ${ac.rotor && ac.rotor.assistOn}, on the ground ${ac.onGround}`);

  // Shift until 4 m up and climbing, then let go.
  let letGoH = 0;
  let letGoVs = 0;
  hold(ac, pilot, ['Shift'], 20, () => {
    if (skidH(ac) > 4 && ac.vs > 3) {
      letGoH = ac.pos.y;
      letGoVs = ac.vs;
      return true;
    }
    return false;
  });
  let top = ac.pos.y;
  fly(ac, pilot, 10, () => {
    top = Math.max(top, ac.pos.y);
  });
  const stopH = ac.pos.y;
  let band = 0;
  fly(ac, pilot, 8, () => {
    band = Math.max(band, Math.abs(ac.pos.y - stopH));
  });
  ok(
    'Shift lifts it off, and letting go stops the climb within 12 m and holds that height',
    !ac.crashed && top - letGoH < 12 && Math.abs(ac.vs) < 0.3 && band < 0.6,
    `let go at ${f1(letGoH - TER.heightAt(ac.pos.x, ac.pos.z))} m climbing ${f1(letGoVs)} m/s, stopped ${f1(top - letGoH)} m higher, vs ${f2(ac.vs)} 10 s later, then within ${f2(band)} m over 8 s`
  );
  ok('in the hover the lever has come to the hover mark by itself', Math.abs(pilot.target - hoverLever(ac)) < 0.12, `lever ${f2(pilot.target)}, hover lever ${f2(hoverLever(ac))}`);
  ok('the panel would say HOVERING: the hold has the height and the spot', ac.rotor.holdingHeight === true, `holdingHeight ${ac.rotor.holdingHeight}, holdingSpot ${ac.rotor.holdingSpot}`);

  // The old trap: the lever run right up.
  hold(ac, pilot, ['Shift'], 4);
  const runUpH = ac.pos.y;
  const runUpVs = ac.vs;
  let top2 = ac.pos.y;
  fly(ac, pilot, 12, () => {
    top2 = Math.max(top2, ac.pos.y);
  });
  ok(
    'with the lever run right up for 4 s, letting go still stops the climb (within 25 m) and brings the lever back',
    !ac.crashed && top2 - runUpH < 25 && Math.abs(ac.vs) < 0.4 && pilot.target < 0.7,
    `let go climbing ${f1(runUpVs)} m/s, stopped ${f1(top2 - runUpH)} m higher, vs ${f2(ac.vs)} 12 s later, lever back to ${Math.round(pilot.target * 100)}%`
  );

  // Ctrl starts it down; let go and it holds again (the browser's own test).
  let downVs = 0;
  hold(ac, pilot, ['Ctrl'], 2, (t) => {
    if (t <= 1.501) downVs = Math.min(downVs, ac.vs);
  });
  fly(ac, pilot, 5);
  ok('Ctrl starts it down within 1.5 s, and letting go holds the height again, clear of the ground', downVs <= -1.5 && Math.abs(ac.vs) < 0.3 && skidH(ac) > 3 && !ac.crashed, `${f1(downVs)} m/s within 1.5 s; vs ${f2(ac.vs)} 5 s after letting go, ${f1(skidH(ac))} m up`);
}

/* ================================================================== *
 * Hands off, calm and in wind
 * ================================================================== */
{
  const { ac, pilot } = hovering(20);
  const from = ac.pos.clone();
  let dh = 0;
  let worstTilt = 0;
  fly(ac, pilot, 20, () => {
    dh = Math.max(dh, Math.abs(ac.pos.y - from.y));
    worstTilt = Math.max(worstTilt, tilt(ac));
  });
  ok('hands off for 20 s in calm air it stays within 2 m, 1 m of height and 3 degrees', !ac.crashed && horizMoved(ac, from) < 2 && dh < 1 && worstTilt < 3, `${f2(horizMoved(ac, from))} m, ${f2(dh)} m of height, ${f1(worstTilt)} deg`);
}
{
  setWind(15);
  const { ac, pilot } = hovering(20);
  const from = ac.pos.clone();
  let dh = 0;
  fly(ac, pilot, 30, () => {
    dh = Math.max(dh, Math.abs(ac.pos.y - from.y));
  });
  ok('in 15 kt of wind, hands off for 30 s, it stays within 3 m and 1.5 m of height', !ac.crashed && horizMoved(ac, from) < 3 && dh < 1.5, `${f2(horizMoved(ac, from))} m and ${f2(dh)} m of height, ${f2(ac.groundSpeed)} m/s over the ground at the end`);

  // Six taps of D: each moves it to the right, never back, and it holds where it stops.
  const right = () => {
    const h = (ac.heading * Math.PI) / 180;
    return { x: Math.cos(h), z: Math.sin(h) };
  };
  const start = ac.pos.clone();
  const r0 = right();
  const along = () => (ac.pos.x - start.x) * r0.x + (ac.pos.z - start.z) * r0.z;
  let furthest = 0;
  let back = 0;
  for (let i = 0; i < 6; i++) {
    hold(ac, pilot, ['D'], 0.3);
    fly(ac, pilot, 2.5, () => {
      const a = along();
      furthest = Math.max(furthest, a);
      back = Math.max(back, furthest - a);
    });
  }
  fly(ac, pilot, 6, () => {
    const a = along();
    furthest = Math.max(furthest, a);
    back = Math.max(back, furthest - a);
  });
  const rest = ac.pos.clone();
  let wander = 0;
  fly(ac, pilot, 10, () => {
    wander = Math.max(wander, horizMoved(ac, rest));
  });
  ok('in 15 kt, six taps of D move it right, never back, and it holds where it stops', !ac.crashed && along() > 3 && back < 0.6 && wander < 0.5, `${f1(along())} m to the right, at most ${f2(back)} m back; 6 s after the last tap, within ${f2(wander)} m for 10 s`);
  setWind(0);
}

/* ================================================================== *
 * W, S, E and A
 * ================================================================== */
{
  const { ac, pilot } = hovering(40);
  const y0 = ac.pos.y;
  const hdg0 = ac.heading;
  let worstTilt = 0;
  let dh = 0;
  let gs10 = 0;
  hold(ac, pilot, ['W'], 10, () => {
    worstTilt = Math.max(worstTilt, tilt(ac));
    dh = Math.max(dh, Math.abs(ac.pos.y - y0));
    gs10 = ac.groundSpeed;
  });
  ok('holding W for 10 s flies forwards at its height, nose down no more than 32 degrees', !ac.crashed && gs10 > 30 && worstTilt <= 32 && dh < 2.5 && Math.abs(wrap(ac.heading - hdg0)) < 8, `max tilt ${f1(worstTilt)} deg, ${f1(gs10)} m/s at 10 s, height within ${f2(dh)} m, heading moved ${f1(wrap(ac.heading - hdg0))} deg`);
  let topSpeed = 0;
  hold(ac, pilot, ['W'], 35, () => {
    topSpeed = Math.max(topSpeed, ac.groundSpeed);
    worstTilt = Math.max(worstTilt, tilt(ac));
  });
  ok('held on, it tops out at a sensible 55 to 75 m/s', !ac.crashed && topSpeed > 55 && topSpeed < 75 && worstTilt <= 32, `${f1(topSpeed)} m/s after 45 s of W, max tilt ${f1(worstTilt)} deg`);
  let levelAt = -1;
  let slowAt = -1;
  let dh2 = 0;
  const yTop = ac.pos.y;
  fly(ac, pilot, 60, (t) => {
    if (levelAt < 0 && tilt(ac) < 5) levelAt = t;
    if (slowAt < 0 && ac.groundSpeed < 1.5) slowAt = t;
    dh2 = Math.max(dh2, Math.abs(ac.pos.y - yTop));
    return slowAt > 0 && t > slowAt + 3;
  });
  ok('letting go levels it within 4 s and brings it to a hover, holding its height', !ac.crashed && levelAt >= 0 && levelAt < 4 && slowAt > 0 && dh2 < 3, `level after ${f1(levelAt)} s, under 1.5 m/s after ${f1(slowAt)} s from ${f1(topSpeed)} m/s, height within ${f2(dh2)} m`);
}
{
  const { ac, pilot } = hovering(45);
  hold(ac, pilot, ['W'], 8);
  const v0 = ac.groundSpeed;
  hold(ac, pilot, ['S'], 4);
  fly(ac, pilot, 1);
  ok('S brakes hard: at least 15 m/s off in 4 s, and no crash', !ac.crashed && v0 - ac.groundSpeed >= 15, `${f1(v0)} -> ${f1(ac.groundSpeed)} m/s${ac.crashed ? ', CRASHED: ' + ac.crashReason : ''}`);
}
{
  const { ac, pilot } = hovering(20);
  const h0 = ac.heading;
  let turned = 0;
  let last = ac.heading;
  let tTurn = 0;
  hold(ac, pilot, ['E'], 12, (t) => {
    turned += wrap(ac.heading - last);
    last = ac.heading;
    tTurn = t;
    return turned >= 360;
  });
  const letGo = ac.heading;
  fly(ac, pilot, 4);
  ok('E turns it right round on the spot in under 10 s', !ac.crashed && turned >= 360 && tTurn < 10, `${f1(turned)} deg in ${f1(tTurn)} s`);
  ok('and it stops within 12 degrees of where E was let go', !ac.crashed && Math.abs(wrap(ac.heading - letGo)) < 12, `ran on ${f1(wrap(ac.heading - letGo))} deg`);
  void h0;
}
{
  const { ac, pilot } = hovering(40);
  hold(ac, pilot, ['W'], 8);
  const h0 = ac.heading;
  let worstBank = 0;
  hold(ac, pilot, ['A'], 4, () => {
    worstBank = Math.max(worstBank, Math.abs(ac.readouts().bank));
  });
  const turned = wrap(ac.heading - h0);
  fly(ac, pilot, 3);
  ok('A at speed banks and turns it, no further than 43 degrees, and let go it levels within 3 s', !ac.crashed && worstBank < 43 && Math.abs(turned) > 15 && Math.abs(ac.readouts().bank) < 6, `max bank ${f1(worstBank)} deg, turned ${f1(turned)} deg in 4 s, ${f1(ac.readouts().bank)} deg 3 s after letting go`);
}

/* ================================================================== *
 * Keys together: the two v62 regressions
 * ================================================================== */
/*
 * W and A held together for a long time is how a first-timer curves while
 * moving. Measured before the power margin (rotor-assist.js, THE POWER
 * MARGIN): from 40 m, W 8 s then W+A, "The propeller struck the ground" in
 * 15 s; from 120 m, 40 m lost — the hold's lever pinned at 100% (lift 1.30,
 * the most there is) with the disc 46 degrees off the vertical. The mission-
 * style turn checks hold the keys 4 to 5 s and could not see it.
 */
{
  const { ac, pilot } = hovering(40);
  hold(ac, pilot, ['W'], 8);
  const y0 = ac.pos.y;
  let lost = 0;
  let worstBank = 0;
  let worstTilt = 0;
  let turned = 0;
  let last = ac.heading;
  // The trap itself: the collective pinned at the top while the machine
  // sinks. (The hold may use full lever for a moment climbing over ground
  // ahead; that is not it.)
  let pinnedSinking = 0;
  hold(ac, pilot, ['W', 'A'], 15, () => {
    lost = Math.max(lost, y0 - ac.pos.y);
    worstBank = Math.max(worstBank, Math.abs(ac.readouts().bank));
    worstTilt = Math.max(worstTilt, tilt(ac));
    turned += wrap(ac.heading - last);
    last = ac.heading;
    if ((ac._rotorColl || 0) >= 0.97 && ac.vs < -0.5) pinnedSinking += FRAME;
  });
  ok(
    'W and A held together for 15 s at 40 m turns it and keeps its height: under 3 m lost, never sinking on a pinned lever, no crash',
    !ac.crashed && lost < 3 && pinnedSinking < 0.5 && Math.abs(turned) > 30 && worstBank > 15,
    `${ac.crashed ? 'CRASHED: ' + ac.crashReason + '; ' : ''}lost ${f1(lost)} m, ${f1(pinnedSinking)} s sinking on a pinned lever, turned ${f1(turned)} deg, bank up to ${f1(worstBank)} deg, tilt up to ${f1(worstTilt)} deg, ${f1(ac.groundSpeed)} m/s at the end`
  );
}
{
  // Three S-turns at 30 m: W+A then W+D, 3 s each. Before: about 19 m lost.
  const { ac, pilot } = hovering(30);
  const y0 = ac.pos.y;
  let lost = 0;
  for (let i = 0; i < 3 && !ac.crashed; i++) {
    hold(ac, pilot, ['W', 'A'], 3, () => {
      lost = Math.max(lost, y0 - ac.pos.y);
    });
    hold(ac, pilot, ['W', 'D'], 3, () => {
      lost = Math.max(lost, y0 - ac.pos.y);
    });
  }
  ok('three S-turns of W+A then W+D at 30 m lose under 3 m and do not crash', !ac.crashed && lost < 3, `${ac.crashed ? 'CRASHED: ' + ac.crashReason + '; ' : ''}lost ${f1(lost)} m`);
}
/*
 * Shift and W together from the pad — "power and go", the first thing a
 * player who has flown the aeroplane does. Measured before the ground stop
 * (rotor-assist.js, THE GROUND): W pressed 0 to 0.8 s after Shift, Normal or
 * Realistic, "The propeller struck the ground" at 0.5 m with the nose 15 to
 * 19 degrees down; Shift and S, the tail. From 1.0 s it was already clear of
 * the pad and flew.
 */
{
  const runs = [];
  let bad = '';
  for (const mode of ['simplified', 'realistic']) {
    for (const delay of [0, 0.5]) {
      const ac = spawn({ mode });
      const pilot = new Pilot(mode === 'simplified');
      fly(ac, pilot, 1);
      let lowNose = 0;
      let top = 0;
      pilot.press('Shift');
      if (delay > 0) fly(ac, pilot, delay);
      pilot.press('W');
      fly(ac, pilot, 6 - delay, () => {
        lowNose = Math.min(lowNose, ac.readouts().pitch);
        top = Math.max(top, skidH(ac));
      });
      pilot.allUp();
      const tag = `${mode} W ${f1(delay)} s after Shift: ${ac.crashed ? 'CRASHED ' + ac.crashReason : `${f1(top)} m up, ${f1(ac.groundSpeed)} m/s, nose at worst ${f1(lowNose)} deg`}`;
      runs.push(tag);
      if (ac.crashed || top < 5 || ac.groundSpeed < 10) bad = bad || tag;
    }
  }
  ok('Shift and W together from the pad (and W half a second after Shift) lift off without a strike and fly forward, in both modes', bad === '', bad || runs.join(' | '));
  const ac = spawn();
  const pilot = new Pilot();
  fly(ac, pilot, 1);
  hold(ac, pilot, ['Shift', 'S'], 4);
  ok('Shift and S together from the pad lift off without the tail striking', !ac.crashed && skidH(ac) > 3, `${ac.crashed ? 'CRASHED: ' + ac.crashReason : `${f1(skidH(ac))} m up`}`);
}

/* ================================================================== *
 * Landing
 * ================================================================== */
{
  const { ac, pilot } = hovering(30);
  let lastVs = 0;
  let touchdownFpm = null;
  hold(ac, pilot, ['Ctrl'], 45, () => {
    if (ac.onGround) {
      touchdownFpm = -lastVs * 196.85;
      return true;
    }
    lastVs = ac.vs;
    return false;
  });
  fly(ac, pilot, 2);
  ok('holding Ctrl from 30 m lands it: touchdown under 200 ft/min, no crash, and it stays down with the lever at the bottom', !ac.crashed && ac.onGround && touchdownFpm !== null && touchdownFpm < 200 && pilot.target < 0.05, `${ac.crashed ? 'CRASHED: ' + ac.crashReason + '; ' : ''}touchdown ${touchdownFpm === null ? 'never' : f1(touchdownFpm) + ' ft/min'}, on the ground ${ac.onGround}, lever ${Math.round(pilot.target * 100)}%`);
}
{
  const { ac, pilot } = hovering(30);
  let lowest = Infinity;
  let fastest = 0;
  let touchedFast = false;
  hold(ac, pilot, ['W', 'Ctrl'], 20, () => {
    lowest = Math.min(lowest, skidH(ac));
    fastest = Math.max(fastest, ac.groundSpeed);
    if (ac.onGround && ac.groundSpeed > 8) touchedFast = true;
  });
  ok('W and Ctrl together keep it off the ground at speed (SLOW DOWN TO LAND)', !ac.crashed && !touchedFast && lowest > 5 && fastest > 25, `${ac.crashed ? 'CRASHED: ' + ac.crashReason + '; ' : ''}lowest ${f1(lowest)} m at up to ${f1(fastest)} m/s`);
}
{
  const { ac, pilot } = hovering(150);
  const from = ac.pos.y;
  let fastest = 0;
  let lastVs = 0;
  let touchdownFpm = null;
  let tLand = 0;
  hold(ac, pilot, ['Ctrl'], 60, (t) => {
    fastest = Math.min(fastest, ac.vs);
    if (ac.onGround) {
      touchdownFpm = -lastVs * 196.85;
      tLand = t;
      return true;
    }
    lastVs = ac.vs;
    return false;
  });
  ok('Ctrl from 150 m lands inside 45 s, no faster than 9.5 m/s, and gently', !ac.crashed && touchdownFpm !== null && tLand < 45 && fastest > -9.5 && touchdownFpm < 200, `${ac.crashed ? 'CRASHED: ' + ac.crashReason + '; ' : ''}from ${f1(from - TER.heightAt(ac.pos.x, ac.pos.z))} m: ${f1(tLand)} s, fastest ${f1(fastest)} m/s, ${touchdownFpm === null ? 'never landed' : f1(touchdownFpm) + ' ft/min'}`);
}

/* ================================================================== *
 * The assist off
 * ================================================================== */
{
  const ac = spawn({ assist: false });
  const pilot = new Pilot();
  fly(ac, pilot, 1);
  hold(ac, pilot, ['Shift'], 20, () => skidH(ac) > 4 && ac.vs > 3);
  const lever = pilot.target;
  fly(ac, pilot, 3);
  ok('with the assist off, the lever stays where it is left and the machine keeps climbing', !ac.crashed && ac.rotor.assistOn === false && ac.vs > 2 && Math.abs(pilot.target - lever) < 0.01, `assistOn ${ac.rotor.assistOn}, vs ${f1(ac.vs)} m/s 3 s after letting go of Shift, lever ${Math.round(lever * 100)}% -> ${Math.round(pilot.target * 100)}%`);
}

/* ================================================================== *
 * The autopilot (P)
 * ================================================================== */
{
  const { ac, pilot } = hovering(20);
  const ap = new Autopilot();
  ap.setEngaged(true, ac);
  const from = ac.pos.clone();
  let dh = 0;
  fly(ac, pilot, 20, () => {
    dh = Math.max(dh, Math.abs(ac.pos.y - from.y));
  }, ap);
  ok('P in the hover engages the autopilot, which holds the hover where it was', ap.engaged && !ac.crashed && horizMoved(ac, from) < 3 && dh < 2 && /HOVER/.test(ap.status(null)), `${f2(horizMoved(ac, from))} m and ${f2(dh)} m of height in 20 s, "${ap.status(null)}"`);
  ok('moving the stick hands it straight back', ap.playerTookOver({ pitch: -0.5, roll: 0, yaw: 0, leverHeld: false }) && ap.playerTookOver({ pitch: 0, roll: 0, yaw: 0, leverHeld: true }), 'the stick and the lever both take it back');
  ap.setEngaged(false, ac);
  ac.autopilotOn = false;
}
{
  const { ac, pilot } = hovering(60);
  hold(ac, pilot, ['W'], 10);
  const ap = new Autopilot();
  ap.setEngaged(true, ac);
  const y0 = ac.pos.y;
  const h0 = ap.holdHeadingDeg;
  const v0 = ac.groundSpeed;
  let dh = 0;
  let dhdg = 0;
  let slowest = Infinity;
  fly(ac, pilot, 20, () => {
    dh = Math.max(dh, Math.abs(ac.pos.y - y0));
    dhdg = Math.max(dhdg, Math.abs(wrap(ac.heading - h0)));
    slowest = Math.min(slowest, ac.groundSpeed);
  }, ap);
  ok('P at speed holds the height and the heading and keeps going', ap.engaged && !ac.crashed && dh < 4 && dhdg < 8 && slowest > 15, `engaged at ${f1(v0)} m/s; 20 s: height within ${f1(dh)} m, heading within ${f1(dhdg)} deg, never under ${f1(slowest)} m/s, "${ap.status(null)}"`);
  ap.setEngaged(false, ac);
  ac.autopilotOn = false;
}

/* ================================================================== *
 * The Follow lens beside a building (H2), and what a frame costs
 * ================================================================== */
{
  const { ac, pilot } = hovering(8);
  // A block of flats 9 m behind the machine once it faces west: 30 m tall,
  // 30 x 20 m, so the Follow lens's usual 18 m standoff would be inside it.
  const bx = ac.pos.x + 9 + 15;
  const bz = ac.pos.z;
  const base = TER.heightAt(bx, bz);
  const box = TER.addObstacleAt(bx, bz, 30, 20, base, 30, 'the test block');
  const lineClear = (Pp, C) => {
    for (const o of TER.OBSTACLES) {
      let t0 = 0;
      let t1 = 1;
      for (const [p, d, a, b] of [[Pp.x, C.x - Pp.x, o.x0, o.x1], [Pp.y, C.y - Pp.y, o.y0, o.y1], [Pp.z, C.z - Pp.z, o.z0, o.z1]]) {
        if (Math.abs(d) < 1e-9) {
          if (p < a || p > b) t0 = 2;
          continue;
        }
        let ta = (a - p) / d;
        let tb = (b - p) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
      }
      if (t0 <= t1 && t0 > 0.02) return `through ${o.what}`;
      if (C.x > o.x0 && C.x < o.x1 && C.z > o.z0 && C.z < o.z1 && C.y > o.y0 && C.y < o.y1) return `inside ${o.what}`;
    }
    return '';
  };
  // Nose away from the block (it stands to the east: heading west).
  const pilotTurn = () => {
    for (let i = 0; i < 30; i++) {
      const e = wrap(270 - ac.heading);
      if (Math.abs(e) < 4) return;
      hold(ac, pilot, [e > 0 ? 'E' : 'Q'], Math.min(0.6, Math.abs(e) / 45));
      fly(ac, pilot, 1);
    }
  };
  pilotTurn();
  fly(ac, pilot, 3);
  let camOk = false;
  let detail = camErr ? `camera.js would not load in node: ${camErr}` : '';
  let stepUs = 0;
  let rigUs = 0;
  if (CAM) {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 5000);
    const rig = new CAM.CameraRig(camera, ac);
    rig.setMode('chase');
    for (let i = 0; i < 4; i++) rig.update(FRAME, ac, null, weather);
    let bad = 0;
    let firstBad = '';
    let jump = 0;
    const last = camera.position.clone();
    let tStep = 0;
    let tRig = 0;
    let frames = 0;
    fly(ac, pilot, 20, () => {
      const a = performance.now();
      rig.update(FRAME, ac, null, weather);
      tRig += performance.now() - a;
      frames++;
      const why = lineClear({ x: ac.pos.x, y: ac.pos.y + 1, z: ac.pos.z }, camera.position);
      if (why) {
        bad++;
        if (!firstBad) firstBad = why;
      }
      jump = Math.max(jump, camera.position.distanceTo(last));
      last.copy(camera.position);
    });
    // The physics step on its own, same hover, timed over the next 20 s.
    const t0 = performance.now();
    fly(ac, pilot, 20);
    tStep = performance.now() - t0;
    stepUs = (tStep * 1000) / (20 * 120);
    rigUs = (tRig * 1000) / Math.max(1, frames);
    const dist = camera.position.distanceTo(ac.pos);
    // Pulled in short of the wall (9 m off, 1.2 m pad), never under 6 m.
    camOk = bad === 0 && jump < 3.5 && !ac.crashed && dist >= 5.5 && dist < 10;
    detail = `${bad ? `${bad} frames blocked (${firstBad})` : 'sight line clear on every frame'}, lens pulled in to ${f1(dist)} m (the wall is 9 m off), worst jump ${f2(jump)} m${ac.crashed ? ', CRASHED: ' + ac.crashReason : ''}`;
  }
  ok('hovering with a building 9 m behind it, the Follow lens comes in short of the wall, always sees the helicopter and never jumps', camOk, detail);
  /*
   * The budget. Measured 2026-10-09 on an M-series Mac under other builders'
   * load: ~60-120 us per 120 Hz physics step with the assist (the assist is
   * ~a tenth of that), ~5-20 us per Follow-lens frame beside a box. The
   * limits are twenty times that, so a slow laptop passes and a scan of
   * every obstacle on the island every frame (the thing H2 was written not
   * to do) does not.
   */
  ok('a hover costs what a frame can afford: under 2 ms per physics step and under 0.5 ms per Follow-lens frame', CAM && stepUs < 2000 && rigUs < 500, `${f1(stepUs)} us per 120 Hz step (physics + assist), ${f1(rigUs)} us per Follow-lens frame beside a box`);
  const i = TER.OBSTACLES.indexOf(box);
  if (i >= 0) TER.OBSTACLES.splice(i, 1);
}

{
  /*
   * Replay QA R6: a helicopter that rolled over read "The left wing tip hit
   * the ground". A rotorcraft's side strike points say what happened to a
   * helicopter; they stay the same points with the same parts (the breakup
   * zones, the crash kinds and the model's strike points key off `part`),
   * and every fixed-wing type keeps its wing tips.
   */
  const TY = await import(SRC + 'aircraft/types.js');
  const bad = [];
  let helis = 0;
  for (const a of TY.AIRCRAFT) {
    const hp = TY.specFor(a.id).hardPoints;
    const L = hp.find((h) => h.part === 'leftWing');
    const R = hp.find((h) => h.part === 'rightWing');
    if (!L || !R) { bad.push(`${a.id}: no side points`); continue; }
    if (TY.isHelicopter(a)) {
      helis++;
      if (/wing/i.test(L.what + R.what) || !/rolled over to the left/.test(L.what) || !/rolled over to the right/.test(R.what) || !/rotor/.test(L.what + R.what)) bad.push(`${a.id}: "${L.what}" / "${R.what}"`);
    } else if (!/left wing tip/.test(L.what) || !/right wing tip/.test(R.what)) bad.push(`${a.id}: "${L.what}" / "${R.what}"`);
  }
  ok('a helicopter rolls over and strikes its rotor (no wing tip); every aeroplane keeps its wing tips; the parts are unchanged', helis >= 5 && bad.length === 0, bad.join('; ') || `${helis} helicopters`);
}

{
  /*
   * The same words for a helicopter set down tipped over: the touchdown
   * grade said "A wing hit the ground first" (physics.js, past 22 degrees of
   * bank) for a Skyhook too. The rotor's re-score (rotor-assist.js) gives it
   * the rollover on the low side; an aeroplane keeps its wing.
   */
  const ac = spawn();
  ac.update(STEP, weather);
  const R = ac.gradeTouchdown(150, 30, 0);
  const L = ac.gradeTouchdown(150, -30, 0);
  P.applyAircraft('skylark');
  const pl = new P.Aircraft();
  pl.reset({ ...RUNWAY_START, engineOn: true });
  pl.settleOnGear();
  pl.update(STEP, weather);
  const W = pl.gradeTouchdown(150, 30, 0);
  ok('a helicopter set down tipped over rolls over on the low side (no wing); an aeroplane keeps "a wing hit the ground"',
    R.crashed && /rolled over to the right/.test(R.reason) && L.crashed && /rolled over to the left/.test(L.reason) && !/wing/i.test(R.reason + L.reason) && W.crashed && /wing hit the ground/i.test(W.reason),
    `${R.reason} | ${L.reason} | ${W.reason}`);
  P.applyAircraft('harrier');
}

console.log(`\nheli: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
