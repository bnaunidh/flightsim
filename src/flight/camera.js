/**
 * Camera rig: cockpit, chase, orbit, wing and tower views.
 *
 * The cockpit view sits in the left seat and shakes with the engine, the
 * airframe buffet and every touchdown. The chase view is spring-damped so it
 * trails the aeroplane the way a camera aircraft would.
 */

import * as THREE from '../vendor/three.module.js';
import { clamp, lerp } from '../core/noise.js';
import { heightAt, OBSTACLES } from '../world/terrain.js';
import { RUNWAY } from '../world/airport.js';
import { SPEC } from '../aircraft/physics.js';
import { boomClear } from '../vehicles/driving.js';
import { dim, CAPS, shakeClock, FLASH } from '../render/flash-safety.js';

export const VIEWS = ['cockpit', 'chase', 'orbit', 'wing', 'tower'];
export const VIEW_LABELS = {
  cockpit: 'Cockpit',
  chase: 'Follow',
  orbit: 'Orbit',
  wing: 'Wing',
  tower: 'Tower',
};

// Left seat, eye height chosen so you look *over* the engine cowling — the
// single most important measurement in a cockpit view.
/**
 * Pilot's eye point, in the aeroplane's own frame. Left seat, and set back far
 * enough from the panel to actually see out: the instruments sit at z = -0.92
 * and the glareshield at y = 0.02, so sitting at z = -0.28 put your nose on the
 * glass and filled two thirds of the screen with dials, with no runway visible
 * at all. Roughly a metre back and a hand's width higher is what a real light
 * aircraft feels like.
 */
const EYE = new THREE.Vector3(-0.24, 0.46, 0.06);
/** How far below level the cockpit view looks by default (radians). */
const COCKPIT_PITCH = -THREE.MathUtils.degToRad(8);
/**
 * The realistic cockpit view sits further back and sees less at once — you
 * look through the windscreen over the glareshield rather than floating in
 * front of the aeroplane with a wide-angle lens. It is what the pilot sees.
 */
const REALISTIC_FOV = 56;
const REALISTIC_OFFSET = new THREE.Vector3(0, -0.02, 0.16);

/**
 * Chase-camera working vectors, made once instead of three times a frame.
 *
 * At sixty frames a second the chase view was building a fresh Vector3 for the
 * desired position, another for the spring acceleration and a third for the
 * fixed upward bias — a hundred and eighty throwaway objects a second, all of
 * them dead by the end of update(), which is exactly the litter that makes the
 * garbage collector stutter the picture on a school Chromebook.
 *
 * These two are genuinely separate objects, and they have to stay that way:
 * _desired is still being read on the line that fills _accel (subVectors reads
 * both), so sharing one between them would compute the spring against itself.
 * That is the same mistake as the look-behind bug below, and the reason the
 * rig already carries three numbered scratch vectors rather than two. UP_BIAS
 * is a constant, never written to — .add() reads its argument and leaves it
 * alone — so it cannot collide with anything.
 */
const _desired = new THREE.Vector3();
const _accel = new THREE.Vector3();
const UP_BIAS = new THREE.Vector3(0, 0.65, 0);

/*
 * The helicopter's Follow view, kept out of buildings and rock.
 *
 * The chase spring only ever floored the lens at the ground under it plus
 * 2.2 m. A Skyhook hovering beside a building, the carrier's island or a sea
 * stack put the lens behind the wall or inside the island with the machine
 * hidden — measured with a real render (scratchpad camprobe.mjs), hovering
 * 6 m up in the street 9 m off the Cottage Hospital's wall, nose away from
 * it, the sight line from the machine to the lens went through the hospital
 * on 150 of 150 frames, and 12 m off the island of CV-11 Resolute the same.
 * Beside a stack the floor clamp instead threw the lens up onto the rock's
 * top. Aeroplanes do not hover beside things, so this is the rotor's alone
 * and none of the aeroplane views move.
 *
 * So, every frame in Follow: the boxes within NEAR_R of the machine (gathered
 * again every NEAR_MOVE metres, as SurfaceVehicle.nearObstacles does) are
 * asked with the van camera's own boomClear(), and the ground at BOOM_T along
 * the line; on a hit the lens comes in along the line to just short of it,
 * never nearer than MIN_BOOM. Ground starts pulling it in up to SOFT metres
 * before it touches the line (less near the machine, which may be standing
 * on it), so rock sliding towards the line moves the lens
 * smoothly; a box that appears in the line brings it in at up to IN_RATE
 * (measured beside a sea stack, snapping in at once moved the lens 17.6 m
 * in one frame), and it goes back out over EASE_OUT seconds.
 * Only the lens moves (camera.position), never the spring's own state.
 */
const NEAR_R = 60;
const NEAR_MOVE = 12;
const BOOM_T = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
const MIN_BOOM = 6;
const BOOM_PAD = 1.2;
const SOFT = 3;
const IN_RATE = 30; // m/s along the boom
const EASE_OUT = 0.4;
const _boomEnd = new THREE.Vector3();

/**
 * Where the chase view stands at rest, behind and above the centre of
 * gravity: the trainer's numbers. main.js setAircraft() hands the rig the
 * pair for the aeroplane actually drawn (rig.chaseBack / rig.chaseUp, from
 * chaseScaleFor below).
 */
export const CHASE_BACK = 17;
export const CHASE_UP = 5.2;

/**
 * How much of the aeroplane's speed the chase spring is allowed to lag.
 *
 * The spring damped the camera's ABSOLUTE velocity, so in steady flight it
 * sat 2/sqrt(k) = 0.31 s of travel behind its own target, and the look-at
 * point 1/8 s behind the aeroplane. Measured in level flight (a node replay
 * of this rig, which matches the in-game camera to within 2.3 cm): 39 m from
 * the Skylark at 111 kt, 60 m from any jet at 224 kt, 98 m from Air Massimo
 * at 476 kt, where it covered 4% of the screen's width — a speck.
 *
 * Damping relative to the aeroplane's velocity (the fighters' proposal)
 * removes the lag entirely, and on its own it lost the jets altogether: the
 * look-at point still trailed, so with the camera 25 m back it aimed 40-45
 * degrees below the aeroplane and the Vanguard, F-22 and Massimo sat off the
 * top of the screen in cruise. With the look-at point carried too it holds
 * every type at 22-25 m whatever its speed, but the lag is also most of what
 * the trainer's follow view is: the Skylark came in from 41 m to 22 m in
 * cruise, and because all of that distance then rides the body axis instead
 * of the flight path, the view's angular acceleration in cruise went up from
 * 0.4 to 0.7 degrees/s2 — twitchier, for the aeroplane every child starts in.
 *
 * So the spring and the look-at point are carried along with the part of the
 * aeroplane's velocity above this speed and lag the rest, as they always did.
 * It is the trainer's never-exceed speed (82 m/s, 159 kt): anywhere the
 * Skylark can legally fly its follow view is the same arithmetic as before
 * (through a real 32 s take-off and climb the camera did not move by one bit
 * from where it used to be), and nothing falls back more than 0.31 s x 82 m/s
 * = 25 m however fast it goes: 50 m from a jet at 224 kt, 48 m from Massimo
 * at 476 kt, where it now covers 9% of the screen's width instead of 4%.
 *
 * What that does to the picture, measured with the old rig and this one fed
 * the same real flight every frame (the game's autopilot holding height and
 * speed, then a 45-degree bank). The aeroplane's own wobble on the screen
 * (frame-to-frame second difference of its centre's screen position) is
 * within a few per cent of what it was — the Vanguard in 295 kt cruise
 * 4.3e-5 to 4.4e-5 of the screen, Massimo at 330 kt 3.5e-5 to 3.6e-5, the
 * most any jet gained was 13%, Massimo in a turn — and 7-36% smaller for the
 * aeroplane's size, because it is drawn bigger. The VIEW turns more, though:
 * its angular acceleration rose 7-36% for every jet at a steady 60 Hz (the
 * Vanguard in cruise 36.8 to 48.1 degrees/s2, Massimo at 330 kt 24.2 to
 * 33.0), because the camera is 48-50 m back instead of 53-76 m, and the
 * same motion of the aeroplane is a bigger angle from nearer. That is the
 * view following the aeroplane more closely, not a new source of shake: the
 * camera's own acceleration against the aeroplane went down slightly for
 * every jet, and on a perfectly smooth flight (no physics) the view's
 * angular acceleration in a steady 224 kt turn is the same 0.41 degrees/s2;
 * only rolling in is it higher, 2.9 to 3.0 at 224 kt and 1.9 to 2.9 at
 * Massimo's 476 kt. With uneven frame times (a fifth of them long) the
 * F-22's view acceleration is within 2% and its on-screen wobble the same,
 * 2.83e-3 to 2.80e-3. For the Meridian see chaseScaleFor below: its view
 * turns more too, for a different reason.
 */
const LAG_SPEED = 82;

/** The frame chaseScaleFor() fits the aeroplane into. */
const FIT_FOV = 62;
const FIT_ASPECT = 4 / 3;
const FIT_EDGE = 0.8;

/**
 * How far the follow view has to stand back for this aeroplane, as a multiple
 * of the trainer's CHASE_BACK / CHASE_UP (the same angle, just further off),
 * from the model actually drawn.
 *
 * 17 m behind and 5.2 m above is right for the Skylark and was used for
 * every type. Measured at rest on the runway (16:9): the Meridian's tail cone
 * ended 3 m in front of the lens and its fin tip stood 0.5 m ABOVE it, so the
 * picture was mostly fin, with both wing tips off the sides (x +/-1.15) and
 * its tail off the bottom (y -1.20); the Nightjar's 33.5 m wing ran off both
 * sides (+/-1.30). The jets, 14-22 m long, were already well inside the frame
 * at 17 m (+/-0.42 at worst).
 *
 * This is the smallest multiple, 1 or more, at which every drawn vertex lies
 * inside the middle 80% of a 62-degree frame on a 4:3 screen (an iPad: the
 * squarest screen a class has; 16:9 has more room). The Skylark and the jets
 * come out at exactly 1, so nothing changes for them; the Meridian 1.64, the
 * Tempest 1.25, the Nightjar 1.83. Measured in the game afterwards, at rest
 * at 16:9: the Meridian's lens 14 m behind its tail and 2.8 m over its fin,
 * and the whole of all three inside +/-0.58. It runs once per aeroplane
 * change and took 0.1-3 ms in headless Chrome.
 *
 * What standing the Meridian off 1.64 times as far costs: the extra distance
 * rides the body axis, so the aeroplane's attitude wobble swings the camera
 * on a longer arm. Measured on the same real flight with the old rig, this
 * rig at the trainer's 17 m, and this rig fitted: in 216 kt cruise the
 * view's angular acceleration was 91.6, 104.1 and 113.3 degrees/s2, and the
 * camera's acceleration against the aeroplane 86.7, 83.2 and 112.1 m/s2; in
 * a 42-degree turn 77.1, 86.7 and 94.4, and 72.2, 69.5 and 93.6. So about
 * half of the Meridian's extra twitch is the lag change it shares with the
 * jets and half is this standoff. On the screen it wobbles 6.6e-5 before and
 * 6.8e-5 after in cruise, 4.8e-5 both in the turn: for its size 9% more in
 * cruise and 5% more in the turn. That is the price of the lens being out of
 * its fin.
 *
 * The Tempest (1.25) and the Nightjar (1.83) pay the same two ways. Measured
 * through the game's own camera, a separate flight each side, so rougher
 * than the Meridian's: the view's angular acceleration rose 13% for the
 * Tempest in 196 kt cruise and 13% in a 42-degree turn, and 25% and 22% for
 * the Nightjar at 218 kt and in a 43-degree turn.
 *
 * `stretch` and `lift` fit a view that something else pushes further out
 * after the rig has placed it: features/airliners.js multiplies the follow
 * view's offset by viewScale(id) (the A320 1.57, the 747 2.94, the A380 3.03)
 * and its height by another 1.4. The multiple returned is then the rig's
 * share, on top of that stretch.
 */
export function chaseScaleFor(model, stretch = 1, lift = 1) {
  if (!model) return 1;
  model.updateMatrixWorld(true);
  // Into the aeroplane's own frame at its DRAWN size: position and rotation
  // taken off, the model's own scale left on. The civil airframes are built
  // at trainer size and scaled up as a whole (the Meridian 2.05x), so undoing
  // the full matrix measured a 10.8 m Meridian and fitted nothing.
  const at = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const size = new THREE.Vector3();
  model.matrixWorld.decompose(at, turn, size);
  const toModel = new THREE.Matrix4().compose(at, turn, size.set(1, 1, 1)).invert();
  const m = new THREE.Matrix4();
  const inst = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const pts = [];
  model.traverseVisible((o) => {
    const p = o.isMesh && o.geometry && o.geometry.attributes.position;
    if (!p) return;
    for (let k = 0, n = o.isInstancedMesh ? o.count : 1; k < n; k++) {
      m.multiplyMatrices(toModel, o.matrixWorld);
      if (o.isInstancedMesh) {
        o.getMatrixAt(k, inst);
        m.multiply(inst);
      }
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m);
        pts.push(v.x, v.y, v.z);
      }
    }
  });
  if (!pts.length) return 1;
  const cam = new THREE.PerspectiveCamera(FIT_FOV, FIT_ASPECT, 0.4, 10000);
  const fits = (s) => {
    cam.position.set(0, CHASE_UP * lift * stretch * s, CHASE_BACK * stretch * s);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    for (let i = 0; i < pts.length; i += 3) {
      v.set(pts[i], pts[i + 1], pts[i + 2]).applyMatrix4(cam.matrixWorldInverse);
      if (v.z > -cam.near) return false;
      v.applyMatrix4(cam.projectionMatrix);
      if (Math.abs(v.x) > FIT_EDGE || Math.abs(v.y) > FIT_EDGE) return false;
    }
    return true;
  };
  if (fits(1)) return 1;
  let lo = 1;
  let hi = 2;
  while (!fits(hi) && hi < 16) hi *= 1.5;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

export class CameraRig {
  constructor(camera, aircraft) {
    this.camera = camera;
    this.ac = aircraft;
    this.mode = 'chase';
    this.reducedMotion = false;
    /** Eye point for the cockpit view; set per aeroplane. */
    this.eye = EYE.clone();
    this.realisticCockpit = false;

    this.chasePos = new THREE.Vector3();
    this.chaseVel = new THREE.Vector3();
    /** Chase-view standoff for this aeroplane, set per type by main.js. */
    this.chaseBack = CHASE_BACK;
    this.chaseUp = CHASE_UP;
    /**
     * For an aeroplane whose follow view features/airliners.js stretches:
     * the standoff that fits it unstretched, used if the stretch turns out
     * not to happen (see checkStretch). Null for everything else.
     */
    this.chaseAlone = null;
    /** Where this rig put the chase camera, to tell whether it was moved. */
    this._chaseOut = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.orbitAngle = 0.6;
    this.orbitHeight = 0.35;
    this.orbitDist = 26;

    this.shake = 0;
    this.shakeDecay = 0;
    this.t = 0;
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    // A third, because two were already spoken for in the chase branch and
    // sharing one is precisely how the look-behind aim went wrong.
    this._tmp3 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._targetQ = new THREE.Quaternion();
    this.initialised = false;
    this.baseFov = 68;
  }

  setMode(m) {
    if (!VIEWS.includes(m)) return;
    this.mode = m;
    this.initialised = false;
  }

  cycle() {
    const i = VIEWS.indexOf(this.mode);
    this.setMode(VIEWS[(i + 1) % VIEWS.length]);
    return this.mode;
  }

  /**
   * Called by main.js once the frame's camera is final, after update() and
   * anything wrapped round it.
   *
   * An airliner's chase standoff (chaseBack / chaseUp) is fitted on the
   * understanding that features/airliners.js then stretches it by 1.57-3.03,
   * so it is only the rig's share. Unstretched, that share put the camera
   * 18 m forward of the 747's tail and 7 m below the top of its fin, and 15 m
   * inside the A380 (measured at rest with the stretch unwrapped) — the
   * in-the-fin picture the civil team reported. The stretch is not
   * guaranteed: it switches itself off for the session if it ever throws,
   * and it is never installed if that feature's install() throws first.
   * Neither is visible from here in advance, so this looks at the result. If
   * the camera is still exactly where update() put it, nothing stretched it:
   * the view takes the standoff that fits the aeroplane on its own
   * (chaseAlone) and moves out to it this frame, along the same line to the
   * point it looks at, rather than easing out of the fin over the next half
   * second. Measured both ways (the wrapper taken off, and the stretch made
   * to throw once so that it switched itself off): the A320, 747 and A380
   * then stand at 1.95, 3.72 and 4.43 times the trainer's standoff, fill
   * +/-0.65-0.66 of a 16:10 picture at rest with the lens 13, 24 and 37 m
   * behind the tail, and in the first 30 frames of a flight the lens was
   * never inside the airframe (without this, all 30 of the 747's were).
   */
  checkStretch() {
    if (this.mode !== 'chase' || !this.chaseAlone) return;
    if (!this.camera.position.equals(this._chaseOut)) return;
    const f = this.chaseAlone.back / this.chaseBack;
    this.chaseBack = this.chaseAlone.back;
    this.chaseUp = this.chaseAlone.up;
    this.chaseAlone = null;
    this.chasePos.sub(this.lookAt).multiplyScalar(f).add(this.lookAt);
    this.camera.position.sub(this.lookAt).multiplyScalar(f).add(this.lookAt);
    this._chaseOut.copy(this.camera.position);
  }

  /**
   * Bring the helicopter's Follow lens in short of whatever stands between it
   * and the machine. See NEAR_R. `desired` is where the spring is aiming,
   * before the floor: as the floor lifts the lens above that (a sea stack
   * behind the machine), the line is taken down towards where the spring
   * wanted to be — all of the way once it is lifted 8 m, smoothly from 2 m,
   * so it never jumps — and the lens comes in short of the rock face instead
   * of sitting on its summit.
   */
  rotorBoom(ac, desired, dt) {
    const cam = this.camera.position;
    const px = ac.pos.x;
    const py = ac.pos.y + 1;
    const pz = ac.pos.z;
    const near = this._nearBoxes || (this._nearBoxes = []);
    if (this._nearN !== OBSTACLES.length || !(Math.abs(px - this._nearX) < NEAR_MOVE && Math.abs(pz - this._nearZ) < NEAR_MOVE)) {
      this._nearX = px;
      this._nearZ = pz;
      this._nearN = OBSTACLES.length;
      near.length = 0;
      for (let i = 0; i < OBSTACLES.length; i++) {
        const o = OBSTACLES[i];
        if (o.x1 < px - NEAR_R || o.x0 > px + NEAR_R || o.z1 < pz - NEAR_R || o.z0 > pz + NEAR_R) continue;
        near.push(o);
      }
    }
    const end = _boomEnd.copy(cam);
    const lift = clamp((end.y - desired.y - 2) / 6, 0, 1);
    if (lift > 0) end.y -= lift * (end.y - Math.max(desired.y, py + 2));
    const dx = end.x - px;
    const dy = end.y - py;
    const dz = end.z - pz;
    const len = Math.hypot(dx, dy, dz);
    let k = 1;
    if (len > MIN_BOOM) {
      const shim = this._boomShim || (this._boomShim = { nearObstacles: () => this._nearBoxes });
      const hit = boomClear(shim, px, py, pz, end.x, end.y, end.z);
      if (hit < 1) k = hit - BOOM_PAD / len;
      const pad = BOOM_PAD / len;
      for (let i = 0; i < BOOM_T.length; i++) {
        const t = BOOM_T[i];
        if (t - pad >= k) break;
        // Clearance of the line over the ground here; under SOFT it starts
        // bringing the lens in, at none it is in short of this sample.
        const c = py + dy * t - (heightAt(px + dx * t, pz + dz * t) + 0.6);
        // The margin grows along the boom: by the machine the ground it is
        // standing on is meant to be close.
        const soft = SOFT * t;
        if (c < soft) k = Math.min(k, t - pad + (1 - t + pad) * clamp(c / soft, 0, 1));
      }
      // And the lens itself out of the ground: in along the line rather than
      // lifted by the floor, which beside a cliff threw it up the rock face
      // (4.9 m in one 1/15 s step beside a sea stack).
      while (k > MIN_BOOM / len && heightAt(px + dx * k, pz + dz * k) + 1.6 > py + dy * k) k -= 0.05;
      k = Math.max(MIN_BOOM / len, k);
    }
    // In quickly, out gently, so it never pops.
    const prev = Number.isFinite(this._boomK) ? this._boomK : 1;
    // (A new view — a flight starting, the view key — goes straight there.)
    this._boomK = this._boomSnap
      ? k
      : k < prev
        ? Math.max(k, prev - (IN_RATE * dt) / Math.max(len, MIN_BOOM))
        : prev + (k - prev) * Math.min(1, dt / EASE_OUT);
    this._boomSnap = false;
    if (this._boomK < 0.999 || end.y !== cam.y) {
      cam.set(px + dx * this._boomK, py + dy * this._boomK, pz + dz * this._boomK);
      const gh = heightAt(cam.x, cam.z) + 1.6;
      if (cam.y < gh) cam.y = gh;
    }
  }

  /** Add a one-off jolt (touchdown, crash, gust). */
  kick(amount) {
    if (this.reducedMotion) amount *= 0.25;
    this.shake = Math.min(1.4, this.shake + amount);
  }

  update(dt, ac, input, weather) {
    this.t += dt;
    const cam = this.camera;
    const pos = ac.pos;

    // Continuous vibration: engine + buffet + rolling on the ground.
    let vib = ac.rpm * 0.016 + ac.buffet * 0.06;
    if (ac.onGround && ac.groundSpeed > 1) vib += clamp(ac.groundSpeed / 60, 0, 1) * 0.03;
    if (this.reducedMotion) vib *= 0.25;
    /*
     * Reduce flashing (render/flash-safety.js). The eye is a metre from the
     * panel in the cockpit, so the same centimetre of buzz that is nothing
     * from the chase camera moves every edge of the cockpit about five pixels,
     * eight to ten times a second: measured (tests/flicker-probe.js), 6% of
     * the screen flickering in every cockpit flight. With the switch on the
     * continuous buzz there is a tenth of that — under a pixel. Knocks (a
     * hard landing, a bang) still shake as they did.
     */
    if (this.mode === 'cockpit') vib = dim(vib, CAPS.cockpitBuzz);
    this.shake = Math.max(0, this.shake - dt * 2.4);

    const shakeAmp = vib + this.shake * 0.35;
    // Reduce flashing: the same shake on a slower clock, under 3 Hz (flash-safety.js).
    const st = shakeClock(this.t);
    const sx = Math.sin(st * 61) * shakeAmp + Math.sin(st * 27.3) * shakeAmp * 0.6;
    const sy = Math.sin(st * 53.7 + 1.3) * shakeAmp + Math.sin(st * 19.1) * shakeAmp * 0.5;
    const sz = Math.sin(st * 43.3 + 2.7) * shakeAmp * 0.5;

    const lookYaw = input ? input.lookYaw : 0;
    const lookPitch = input ? input.lookPitch : 0;
    const lookBehind = input && input.held ? input.held('lookBehind') : false;

    if (this.mode === 'cockpit') {
      // Eye point rides with the airframe.
      const base = this.eye || EYE;
      this._eyeTmp = this._eyeTmp || new THREE.Vector3();
      this._eyeTmp.copy(base);
      if (this.realisticCockpit) this._eyeTmp.add(REALISTIC_OFFSET);
      const eye = this._tmp.copy(this._eyeTmp).applyQuaternion(ac.quat).add(pos);
      cam.position.copy(eye);
      cam.position.x += sx * 0.5;
      cam.position.y += sy * 0.5;
      cam.position.z += sz * 0.5;
      this._targetQ.copy(ac.quat);
      // Head movement: glance into the turn a little, plus free look.
      const bank = ac.bankAngleDeg();
      const headYaw = lookBehind ? Math.PI : lookYaw - THREE.MathUtils.degToRad(bank) * 0.12;
      // A pilot looks a little down, over the nose: level, the cabin roof filled
      // the top ~40% of the screen and the panel sat behind the HUD.
      // The cockpit may ask for its own (cockpit userData.viewPitchDeg, set
      // by main.js): an airliner's screens sit lower under its big windows
      // than a light aeroplane's dials do, and the realistic view must show them.
      const basePitch = this.cockpitPitchDeg > 0 ? -THREE.MathUtils.degToRad(this.cockpitPitchDeg) : COCKPIT_PITCH;
      const headPitch = basePitch + lookPitch + clamp(ac.gLoad - 1, -0.4, 0.4) * -0.06;
      const q = this._q.setFromEuler(new THREE.Euler(headPitch, headYaw, 0, 'YXZ'));
      cam.quaternion.copy(this._targetQ).multiply(q);
      const want = this.realisticCockpit ? REALISTIC_FOV : this.baseFov + clamp(ac.airspeed / 90, 0, 1) * 4;
      cam.fov = lerp(cam.fov, want, clamp(dt * 3, 0, 1));
      cam.near = 0.08;
    } else if (this.mode === 'chase') {
      // Behind and above, blended between body-axis and velocity-axis so the
      // camera does not spin wildly during aerobatics.
      const back = this._tmp.set(0, 0, 1).applyQuaternion(ac.quat);
      const upV = this._tmp2.set(0, 1, 0).applyQuaternion(ac.quat).multiplyScalar(0.35).add(UP_BIAS);
      const dist = this.chaseBack + clamp(ac.airspeed / 12, 0, 9);
      const desired = _desired
        .copy(pos)
        .addScaledVector(back, dist)
        .addScaledVector(upV.normalize(), this.chaseUp + ac.airspeed * 0.02);
      if (!this.initialised) {
        this.chasePos.copy(desired);
        this._boomK = 1;
        this._boomSnap = true;
        // The look-at point too. It was left wherever the last flight or the
        // last spell in this view ended, so a new flight began with the camera
        // aimed at the old one: measured in the game, a Skylark take-off after
        // an A380 flight started 78-87 degrees off the aeroplane — not on the
        // screen at all — for the first third of a second.
        this.lookAt.copy(pos);
        this.initialised = true;
      }
      // Critically-damped spring.
      const k = 42;
      const c = 2 * Math.sqrt(k);
      const accel = _accel.subVectors(desired, this.chasePos).multiplyScalar(k);
      accel.addScaledVector(this.chaseVel, -c);
      // ...relative to what is left of the aeroplane's velocity once LAG_SPEED
      // of it has been taken off: nothing below that speed, so the trainer's
      // view is untouched, and a constant 25 m of lag above it (see LAG_SPEED).
      const speed = ac.vel.length();
      const carried = speed > LAG_SPEED ? 1 - LAG_SPEED / speed : 0;
      if (carried > 0) accel.addScaledVector(ac.vel, c * carried);
      /*
       * Reduce flashing: a wreck sliding away at 30-60 m/s is not followed.
       * The camera that chases a skidding wreck is a metre or two off the
       * grass moving as fast as it does, and a texture that crosses the whole
       * screen in a few frames is a flicker by WCAG's measure over most of it
       * (tests/flicker-probe.js: 48-75% of a 10-degree field on the pack's
       * jets skidding after a belly-flop or a wall, all of it the ground). So
       * with the switch on a crashed aeroplane stops the camera where it is,
       * braking in a fraction of a second, and it keeps looking at the wreck as
       * it slides on. The instant replay (features/breakup.js) is the way to see
       * the rest of it up close.
       */
      if (ac.crashed && FLASH.reduce) {
        accel.set(0, 0, 0);
        this.chaseVel.multiplyScalar(Math.exp(-Math.min(dt, 0.05) * 14));
      }
      this.chaseVel.addScaledVector(accel, Math.min(dt, 0.05));
      this.chasePos.addScaledVector(this.chaseVel, Math.min(dt, 0.05));
      // Never clip through the ground.
      const gh = heightAt(this.chasePos.x, this.chasePos.z) + 2.2;
      if (this.chasePos.y < gh) {
        this.chasePos.y = gh;
        this.chaseVel.y = Math.max(0, this.chaseVel.y);
      }
      cam.position.copy(this.chasePos);
      cam.position.x += sx * 0.35;
      cam.position.y += sy * 0.35;
      if (SPEC.rotor) this.rotorBoom(ac, desired, dt);
      else this._boomK = 1;
      this._chaseOut.copy(cam.position);
      // The same for the point it looks at: carried along with the part of
      // the aeroplane's velocity the spring does not lag, then eased in. On
      // its own it trails by speed / 8, 26 m at 476 kt; with the camera now
      // 48 m back that aimed 14 degrees off Massimo and put it a third of the
      // way up to the top edge. Carried, it is 2.7 degrees — the Skylark's 1.8.
      if (carried > 0) this.lookAt.addScaledVector(ac.vel, carried * dt);
      this.lookAt.lerp(pos, clamp(dt * 8, 0, 1));
      /*
       * A separate scratch vector.
       *
       * `back` is also this._tmp, so `aim.copy(pos)` overwrote it — and the
       * next line then added sixty times the aeroplane's POSITION to its
       * position. Looking behind aimed the camera at sixty-one times wherever
       * you happened to be, which at the far end of the map is several hundred
       * kilometres into the sky.
       */
      const aim = this._tmp3.copy(this.lookAt);
      if (lookBehind) aim.copy(pos).addScaledVector(back, 60);
      cam.lookAt(aim);
      if (lookYaw || lookPitch) {
        cam.rotateY(lookYaw * 0.6);
        cam.rotateX(lookPitch * 0.4);
      }
      cam.fov = lerp(cam.fov, 62 + clamp(ac.airspeed / 90, 0, 1) * 8, clamp(dt * 3, 0, 1));
      cam.near = 0.4;
    } else if (this.mode === 'orbit') {
      this.orbitAngle += dt * 0.16;
      const d = this.orbitDist + clamp(ac.airspeed * 0.08, 0, 12);
      cam.position.set(
        pos.x + Math.cos(this.orbitAngle) * d,
        pos.y + 6 + Math.sin(this.t * 0.2) * 2,
        pos.z + Math.sin(this.orbitAngle) * d
      );
      const gh = heightAt(cam.position.x, cam.position.z) + 2.5;
      if (cam.position.y < gh) cam.position.y = gh;
      cam.lookAt(pos);
      cam.fov = lerp(cam.fov, 58, clamp(dt * 3, 0, 1));
      cam.near = 0.4;
    } else if (this.mode === 'wing') {
      const offset = this._tmp.set(6.6, 0.6, 1.4).applyQuaternion(ac.quat).add(pos);
      cam.position.lerp(offset, clamp(dt * 9, 0, 1));
      cam.position.x += sx * 0.3;
      cam.position.y += sy * 0.3;
      // Never clip through the ground (same as 'chase' and 'orbit' above) —
      // the offset is rotated by the aircraft's full orientation, so a low
      // bank/pitch/roll (a hovering helicopter, a steep turn near a hill, a
      // crash tumble) can otherwise put the camera below the terrain.
      const gh = heightAt(cam.position.x, cam.position.z) + 2.2;
      if (cam.position.y < gh) cam.position.y = gh;
      const aim = this._tmp2.copy(pos);
      cam.lookAt(aim);
      cam.fov = lerp(cam.fov, 64, clamp(dt * 3, 0, 1));
      cam.near = 0.2;
    } else if (this.mode === 'tower') {
      // On the tower balcony, tracking the aeroplane.
      //
      // This used to sit at (40, elev+30, -206) — the exact centre of the
      // glazed cab, whose cylinder is 8.5 m across at that height. The view was
      // through blue tinted glass in every direction with the roof overhead.
      // Standing just outside the cab on the runway side gives a clean view and
      // still reads as the tower.
      cam.position.set(40, RUNWAY.elev + 29, -206 + 11);
      cam.lookAt(pos);
      const dist = cam.position.distanceTo(pos);
      // Zoom in as the aeroplane gets further away, like a tower controller
      // following it with binoculars.
      cam.fov = lerp(cam.fov, clamp(60 - dist / 90, 12, 60), clamp(dt * 2, 0, 1));
      cam.near = 0.5;
    }

    cam.updateProjectionMatrix();
  }
}
