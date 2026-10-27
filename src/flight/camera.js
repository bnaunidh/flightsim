/**
 * Camera rig: cockpit, chase, orbit, wing, tower and flyby views.
 *
 * The cockpit view sits in the left seat and shakes with the engine, the
 * airframe buffet and every touchdown. The chase view is spring-damped so it
 * trails the aeroplane the way a camera aircraft would.
 */

import * as THREE from '../vendor/three.module.js';
import { clamp, lerp } from '../core/noise.js';
import { heightAt, OBSTACLES, obstacleAt } from '../world/terrain.js';
import { RUNWAY } from '../world/airport.js';
import { SPEC } from '../aircraft/physics.js';
import { boomClear } from '../vehicles/driving.js';
import { dim, CAPS, shakeClock, FLASH, SHAKE_CAP_DEG } from '../render/flash-safety.js';

export const VIEWS = ['cockpit', 'chase', 'orbit', 'wing', 'tower', 'flyby'];
export const VIEW_LABELS = {
  cockpit: 'Cockpit',
  chase: 'Follow',
  orbit: 'Orbit',
  wing: 'Wing',
  tower: 'Tower',
  flyby: 'Flyby',
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
/** The follow view's aim: eased at this rate (1/s), trailing the lagged part of the speed by LOOK_LAG s, as it did at 60 Hz. */
const LOOK_RATE = 8;
const LOOK_LAG = (1 - 8 / 60) / 8;
/** The follow spring's lead, seconds: the frame time it was tuned at (see the chase branch of update()). */
const CHASE_LEAD = 1 / 60;
/** The spring's steady lag, seconds: 2 / sqrt(k) for the chase spring's k = 42. */
const LAG_TIME = 2 / Math.sqrt(42);
/** How much of its own standoff a fitted airframe may lag in steady flight (setFrame). */
const LAG_SHARE = 0.2;
/** Sense of speed (CameraRig.speedFov): extra follow-view FOV, degrees, from and to true airspeeds in m/s. */
const SPEED_FOV = 6;
const SPEED_FOV_FROM = 130;
const SPEED_FOV_TO = 430;

/**
 * The transonic buffet, as camera vibration: a triangle peaked at Mach 1,
 * zero outside 0.88-1.12, scaled by indicated airspeed (thick air shakes, the
 * stratosphere hardly does). At its height 0.035 — a touchdown kick is 0.3+.
 */
export function machBuffet(mach, ias) {
  if (!(mach > 0.88 && mach < 1.12)) return 0;
  return (1 - Math.abs(mach - 1) / 0.12) * 0.035 * clamp((ias || 0) / 160, 0.2, 1);
}

/*
 * The continuous shake, as an ANGLE of view (render/flash-safety.js
 * SHAKE_CAP_DEG / SHAKE_MAX_HZ). It was centimetres on sines of 3-10 Hz,
 * whatever the distance: from the trainer's 17 m that is nothing, from 6 m
 * behind T-Pose Harrison three times the angle, and a metre from a cockpit's
 * panel half a degree. Now `vib` (the same engine + buffet + Mach + rolling
 * as before) is degrees of view, VIB_GAIN a unit, eased over VIB_TAU so a
 * buffet that comes and goes swells rather than snaps, never over the cap,
 * and on the slow sway below — under 2.6 Hz with Reduce flashing on or off.
 * Outside, the engine's own buzz fades out with speed (ENGINE_FADE_SPEED):
 * a chase plane does not feel your engine.
 */
const VIB_GAIN = 1.9;
/** In the seat it is your own airframe: three times as much, still under the cap (and CAPS.cockpitBuzz on top). */
const VIB_GAIN_COCKPIT = 5.7;
const VIB_TAU = 0.25;
const ENGINE_FADE_SPEED = 120;
/** The cockpit's panel, metres from the eye: what its shake is an angle of. */
const PANEL_D = 1;
/** [rad/s, phase, weight] — at most 16.3 rad/s (2.6 Hz); the weights of x and y together never pass 1. */
const SWAY_X = [[16.3, 0, 0.42], [10.1, 1.3, 0.2], [5.9, 2.1, 0.08]];
const SWAY_Y = [[15.1, 0.7, 0.42], [8.7, 2.4, 0.2], [4.3, 0.4, 0.08]];
const SWAY_Z = [[13.7, 1.9, 0.42], [7.3, 0.2, 0.2], [3.1, 2.8, 0.08]];
function sway(t, w) {
  return Math.sin(t * w[0][0] + w[0][1]) * w[0][2] + Math.sin(t * w[1][0] + w[1][1]) * w[1][2] + Math.sin(t * w[2][0] + w[2][1]) * w[2][2];
}
/**
 * A knock (kick()) is still metres, as it was — from the trainer's follow
 * view in flight (23 m) or further. A nearer lens (Harrison's 6 m, the wing view of a small jet)
 * takes its share of it, so the same knock is no bigger an angle.
 */
const KNOCK_REF = 23;
/** Seconds: how quickly the cockpit view's head follows the g. */
const G_HEAD_TAU = 0.25;

/** A wreck with Reduce flashing: the follow view (CameraRig.crashBack) and the other outside views (crashEase) stand at least CRASH_K x standoff + CRASH_ADD m off, eased over CRASH_EASE s. */
const CRASH_K = 2;
const CRASH_ADD = 10;
const CRASH_EASE = 0.6;
/*
 * ...and never nearer than this: as far as the old rig flew the trainer and
 * the jets. 2 x 5.6 + 10 = 21 m was not enough for T-Pose Harrison going into
 * the sea: the spray flickered over 21-35% of a 10-degree field (crash sweep,
 * Follow view) where the old follow view measured 9-12%; from 44 m, 13-14%.
 */
const CRASH_MIN = 44;
/*
 * A pull-back of more than this multiple of the lens's distance is made in
 * one cut; a shorter one is eased over CRASH_EASE, as it always was. Dollied
 * from 7 m to 44 m over the sea, Harrison's lens swept the glitter and the
 * spray across the picture: 30-37% eased, 13-14% cut. The other way round,
 * the cartoon Skylark's bonk (20 m to 45 m) measured 12-23% eased and 15-27%
 * cut (ten runs each), so the short pull-backs stay eased.
 */
const CRASH_CUT_RATIO = 3;

/**
 * A screen narrower than it is tall (a phone held upright, aspect 0.46): the
 * fits above are made for a 4:3 picture, and fitted that close the F-22's,
 * the B-1B's and the airliners' wing tips ran off both sides of a 390 x 844
 * screen in the Follow view (measured: x to +/-1.27..1.70 of the half width,
 * against 0.55..1.2 before the fit). Below NARROW_ASPECT the outside views
 * stand back until the airframe's half span fills at most NARROW_FILL of the
 * half width (CameraRig.narrowK). Landscape and desktop are untouched.
 */
const NARROW_ASPECT = 1.2;
const NARROW_FILL = 0.72;

/** The ground, or the sea's surface (y = 0) where the ground is under it: what a lens must stay above. */
function surfaceAt(x, z) {
  const h = heightAt(x, z);
  return h > 0 ? h : 0;
}

/**
 * The Tower view's reach. Further than this from every tower it stands on a
 * SPOTTER's point instead: SPOT_LEAD ahead on the track and SPOT_SIDE off to
 * one side, SPOT_UP over the ground or the sea, set up again (one cut) once
 * the aeroplane is SPOT_FAR from it. The owner's screenshot, 2026-10-26, the
 * World Map — Preview: T-Pose Harrison 44 km from the start field's tower, the
 * view at its 8-degree zoom across the sea — outside the sky dome (30 km,
 * round the aeroplane), so the sky was black, and the aeroplane nowhere.
 */
export const TOWER_RANGE = 8000;
const SPOT_LEAD = 1500;
const SPOT_SIDE = 1200;
const SPOT_UP = 30;
const SPOT_FAR = 8000;
/** The start field's tower balcony (Kestrel's, the one every map has used), relative to RUNWAY.elev. */
const TOWER_LENS = { x: 40, up: 29, z: -206 + 11 };

/** The flyby view is set up this many seconds of flight ahead. */
const FLYBY_S = 4.5;

/** The orbit view's radius, as a multiple of the airframe's radius (setFrame). */
const ORBIT_K = 2.8;
/** How much of the trainer's old speed allowance (9 m, 2 m up) a fitted airframe gets, per 17 m of its standoff. */
const GROW = 0.35;

/** The frame chaseScaleFor() fits the aeroplane into. */
const FIT_FOV = 62;
const FIT_ASPECT = 4 / 3;
const FIT_EDGE = 0.8;

/**
 * Every vertex of the model as drawn, in the aeroplane's own frame at its
 * DRAWN size (position and rotation taken off, the model's own scale left
 * on), as a flat [x, y, z, ...] array. The civil airframes are built at
 * trainer size and scaled up as a whole (the Meridian 2.05x), so undoing the
 * full matrix measured a 10.8 m Meridian and fitted nothing.
 */
export function drawnPoints(model) {
  if (!model) return [];
  model.updateMatrixWorld(true);
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
  return pts;
}

/**
 * The airframe's size and middle, from the model as drawn (drawnPoints), in
 * its own frame: the box, its centre, the half span, how far it reaches
 * ahead of and behind the centre of gravity, and its radius in plan (the
 * larger of the half span and the half length) — what the orbit, wing and
 * tower views size themselves by. Null for no model.
 */
export function airframeFrame(model, pts = null) {
  const P = pts || drawnPoints(model);
  if (!P.length) return null;
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < P.length; i += 3) {
    if (P[i] < min.x) min.x = P[i];
    if (P[i + 1] < min.y) min.y = P[i + 1];
    if (P[i + 2] < min.z) min.z = P[i + 2];
    if (P[i] > max.x) max.x = P[i];
    if (P[i + 1] > max.y) max.y = P[i + 1];
    if (P[i + 2] > max.z) max.z = P[i + 2];
  }
  const centre = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
  centre.x = 0;
  const halfSpan = Math.max(-min.x, max.x);
  const halfLength = (max.z - min.z) / 2;
  return {
    min, max, centre, halfSpan, halfLength,
    height: max.y - min.y,
    radius: Math.max(halfSpan, halfLength),
    wing: wingFit(P, centre, min, max),
  };
}

/**
 * Where the wing view stands, as an offset from the airframe's middle: out
 * along WING_DIR (beyond the right tip, a little over it and aft of it — the
 * trainer's old view as players knew it, the lens trailing its tip by the
 * spring's lag) at the least distance from which every drawn vertex is in
 * front of the lens and inside the middle WING_EDGE of a FIT_FOV-degree 4:3
 * frame, and outside the airframe's box. The same picture of every type: on
 * the trainer 8.9 m from its middle, on the A380 about 105 m.
 */
const WING_DIR = new THREE.Vector3(6.6, 1.1, 4.2).normalize();
const WING_EDGE = 0.95;
const WING_FOV = 64;
function wingFit(P, centre, min, max) {
  const cam = new THREE.PerspectiveCamera(WING_FOV, FIT_ASPECT, 0.2, 10000);
  const v = new THREE.Vector3();
  const box = new THREE.Box3(min, max);
  // At most ~12,000 vertices per pass (the A380 draws far more): thirty
  // passes of the bisection stay a few milliseconds on a Chromebook, at a
  // flight's start only, and the box above still has every vertex.
  const step = 3 * Math.max(1, Math.floor(P.length / 3 / 12000));
  const fits = (d) => {
    cam.position.copy(WING_DIR).multiplyScalar(d).add(centre);
    if (box.containsPoint(cam.position)) return false;
    cam.lookAt(centre);
    cam.updateMatrixWorld(true);
    for (let i = 0; i < P.length; i += step) {
      v.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(cam.matrixWorldInverse);
      if (v.z > -0.6) return false;
      v.applyMatrix4(cam.projectionMatrix);
      if (Math.abs(v.x) > WING_EDGE || Math.abs(v.y) > WING_EDGE) return false;
    }
    return true;
  };
  let lo = 0.5;
  let hi = Math.max(2, max.x - min.x, max.z - min.z);
  let guard = 0;
  while (!fits(hi) && guard++ < 12) hi *= 1.5;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return WING_DIR.clone().multiplyScalar(hi);
}

/**
 * Per-type adjustments on top of the fitted numbers, for the few airframes
 * whose box says the wrong thing about them. Every other type is sized from
 * its drawn model alone (CameraRig.setFrame), so a new aeroplane needs no row.
 *
 *   chase   multiple of the fitted follow standoff (main.js)
 *   orbit   multiple of the orbit radius
 *   wing    multiple of the wing view's fitted distance
 */
export const VIEW_TUNE = {
  // (T-Pose Harrison's follow view is his own feature's: features/tpose.js CHASE.)
};

/** The projected half extent below which a fitted follow view comes in (tiny airframes only). */
const MIN_FILL = 0.36;
/** ...but never nearer than this share of the trainer's standoff. */
const MIN_SCALE = 0.35;

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
export function chaseScaleFor(model, stretch = 1, lift = 1, pts = null) {
  if (!model) return 1;
  pts = pts || drawnPoints(model);
  if (!pts.length) return 1;
  const v = new THREE.Vector3();
  const cam = new THREE.PerspectiveCamera(FIT_FOV, FIT_ASPECT, 0.4, 10000);
  const place = (s) => {
    cam.position.set(0, CHASE_UP * lift * stretch * s, CHASE_BACK * stretch * s);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
  };
  const fits = (s) => {
    place(s);
    for (let i = 0; i < pts.length; i += 3) {
      v.set(pts[i], pts[i + 1], pts[i + 2]).applyMatrix4(cam.matrixWorldInverse);
      if (v.z > -cam.near) return false;
      v.applyMatrix4(cam.projectionMatrix);
      if (Math.abs(v.x) > FIT_EDGE || Math.abs(v.y) > FIT_EDGE) return false;
    }
    return true;
  };
  /** How much of the frame it fills at s (the largest |x| or |y| of any vertex). */
  const fill = (s) => {
    place(s);
    let f = 0;
    for (let i = 0; i < pts.length; i += 3) {
      v.set(pts[i], pts[i + 1], pts[i + 2]).applyMatrix4(cam.matrixWorldInverse);
      if (v.z > -cam.near) return Infinity;
      v.applyMatrix4(cam.projectionMatrix);
      f = Math.max(f, Math.abs(v.x), Math.abs(v.y));
    }
    return f;
  };
  if (fits(1)) {
    /*
     * A small airframe (the R44, the Skyhook) filled 10-14% of the follow
     * view's width in cruise at the trainer's 17 m. Brought in until
     * it fills MIN_FILL of the frame at rest, never nearer than MIN_SCALE.
     * Everything the size of the trainer or bigger already fills more and is
     * left exactly where it was.
     */
    if (stretch > 1 || fill(1) >= MIN_FILL) return 1;
    let lo = MIN_SCALE;
    let hi = 1;
    if (fill(lo) <= MIN_FILL) return lo;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (fill(mid) > MIN_FILL) lo = mid;
      else hi = mid;
    }
    return hi;
  }
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
    /** The continuous shake's eased amplitude (VIB_TAU). */
    this._vibS = 0;
    /**
     * Every tower the Tower view may stand on, as world points {x, y, z}: null
     * is the start field's balcony only (TOWER_LENS), as on every map. The
     * World Map — Preview sets its five fields' (features/world-preview.js).
     */
    this.towers = null;
    this._spot = null;
    this._towerAt = null;
    this.t = 0;
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    // A third, because two were already spoken for in the chase branch and
    // sharing one is precisely how the look-behind aim went wrong.
    this._tmp3 = new THREE.Vector3();
    this._tmp4 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._targetQ = new THREE.Quaternion();
    this.initialised = false;
    this.baseFov = 68;
    /**
     * The airframe being viewed (airframeFrame(), set by main.js per type
     * through setFrame()): what the orbit, wing and tower views size
     * themselves by, and the point every outside view looks at. Null until
     * a model is drawn: then the trainer's numbers, exactly as before.
     */
    this.frame = null;
    this.tune = {};
    /** The airframe's middle, in the aeroplane's frame (metres from the CG). */
    this.centre = new THREE.Vector3();
    this._aimC = new THREE.Vector3();
    this._wingOff = new THREE.Vector3();
    this._wingWant = new THREE.Vector3();
  }

  /**
   * The airframe this rig is looking at (camera audit, 2026-10-25). `frame`
   * from airframeFrame(model); `drawnY` the height the model is drawn above
   * the flight model's CG (syncAircraftModel); `tune` a VIEW_TUNE row.
   *
   *   Follow  the standoff stays the fitted chaseBack / chaseUp (main.js),
   *           and what flying adds to it now scales with it: the speed
   *           allowance (up to 9 m on the trainer) and the lag the spring is
   *           allowed (LAG_SHARE) are a share of the standoff, so a small
   *           aeroplane is followed close and a big one far. Measured in
   *           cruise (tests/features/cams.browser.js), the Skylark filled
   *           13% of the picture's width from 39 m and the jets 10-14% from
   *           42-48 m: specks.
   *   Orbit   circles at ORBIT_K x the airframe's radius (it was 26 m for
   *           everything: 3 m outside a Skylark's tip, inside the B-1B's).
   *   Wing    stands off the right tip, over and aft of it, at the distance
   *           fitted to show the whole airframe (wingFit), bolted to the
   *           aeroplane: it trailed by speed / 9 (44 m behind the F-22 at
   *           400 m/s), and at a fixed 6.6 m out it was inside the wing or
   *           the fuselage of everything bigger than the trainer.
   *   Tower   zooms to the airframe's size, not just its distance.
   *
   * All three look at the airframe's middle, not its centre of gravity.
   */
  setFrame(frame, { drawnY = 0, tune = null } = {}) {
    this.frame = frame || null;
    this.tune = tune || {};
    if (frame) this.centre.set(0, frame.centre.y + drawnY, frame.centre.z);
    else this.centre.set(0, 0, 0);
    this.initialised = false;
  }

  /**
   * How much further an outside view must stand on a narrow screen
   * (NARROW_ASPECT) for an airframe of half width `R` seen from `d` metres:
   * 1 on any screen at least NARROW_ASPECT wide, or with nothing fitted.
   */
  narrowK(R, d) {
    const cam = this.camera;
    const a = cam.aspect;
    if (!(a < NARROW_ASPECT) || !(R > 0) || !(d > 0)) return 1;
    const fill = R / (d * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * a);
    return clamp(fill / NARROW_FILL, 1, 3);
  }

  /** Where the outside views aim: the airframe's middle, in the world. */
  aimPoint(ac) {
    return this._aimC.copy(this.centre).applyQuaternion(ac.quat).add(ac.pos);
  }

  setMode(m) {
    if (!VIEWS.includes(m)) return;
    this.mode = m;
    this.initialised = false;
    this._gHead = null;
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

  /**
   * Sense of speed: the follow view widens a little more past 250 kt true,
   * up to SPEED_FOV degrees by 830 kt (half that from the seat), eased in
   * with the FOV's own lag. Never under Reduce motion. Below 250 kt nothing
   * changes, so every slow aeroplane's view is exactly as it was.
   */
  speedFov(ac) {
    if (this.reducedMotion || !ac || ac.crashed) return 0;
    const t = clamp((ac.airspeed - SPEED_FOV_FROM) / (SPEED_FOV_TO - SPEED_FOV_FROM), 0, 1);
    return t * t * (3 - 2 * t) * SPEED_FOV;
  }

  /**
   * Reduce flashing (on by default) and a crash: the follow view stands back
   * from the wreck. Fitted to the airframe it now flies nearer than it used
   * to (setFrame), and a wreck seen from near fills more of the picture —
   * measured in the crash sweep (tests/features/crash-sweep.browser.js), the
   * F-22's nose-plant flickered over 33% of a 10-degree field and T-Pose
   * Harrison's falls 26-65%, where WCAG's line is 25%. So once crashed the
   * lens stands out along its line to the wreck to at least CRASH_K x the
   * standoff + CRASH_ADD metres and never under CRASH_MIN (44 m, as far as
   * the old rig flew the trainer and the jets) — eased over CRASH_EASE
   * seconds, or in one cut if that is more than CRASH_CUT_RATIO times as far
   * — then stays put. The three stretched airliners have their own pull-back
   * (features/airliners.js) and are left to it. Only the lens moves.
   */
  crashBack(ac, lens) {
    if (!ac.crashed || !FLASH.reduce || this.chaseStretched) {
      this._crashAt = null;
      return;
    }
    if (this._crashAt == null) {
      this._crashAt = this.t;
      this._crashCut = null;
    }
    const off = this._tmp2.subVectors(lens, this.lookAt);
    const d = off.length();
    if (!(d > 0.01)) return;
    const want = Math.max(d, CRASH_K * this.chaseBack + CRASH_ADD, CRASH_MIN);
    // Cut or eased (CRASH_CUT_RATIO), decided once, at the crash.
    if (this._crashCut == null) this._crashCut = want / d > CRASH_CUT_RATIO;
    const u = this._crashCut ? 1 : clamp((this.t - this._crashAt) / CRASH_EASE, 0, 1);
    const k = 1 + (want / d - 1) * u * u * (3 - 2 * u);
    lens.copy(this.lookAt).addScaledVector(off, k);
    const gh = surfaceAt(lens.x, lens.z) + 2.2;
    if (lens.y < gh) lens.y = gh;
  }

  /**
   * The same rule for the other outside views (Orbit, Wing, Flyby, Tower),
   * measured under the flicker probe with Reduce flashing on (real crashes,
   * the F-22, T-Pose Harrison and the A380, cartwheel / nose-plant / wing
   * clip): the Tower view, zoomed to the airframe's size, filled the picture
   * with the wreck at 38-61% of a 10-degree field (1-4% at the old fixed
   * zoom); the Wing view, bolted to a tumbling airframe, 7-96%; the Flyby
   * 3-52%; WCAG's line is 25%. So with Reduce flashing, once crashed:
   *   Wing   lets go of the wreck where it was (it no longer tumbles with
   *          it) and eases out to crashStand() metres;
   *   Flyby  makes no more cuts and eases out the same way;
   *   Orbit  circles no nearer than crashStand();
   *   Flyby and Tower widen back out instead of zooming to the wreck (Tower
   *          to its old 60 - distance / 90).
   * crashEase() is 0 when none of this applies, else 0..1 eased over
   * CRASH_EASE seconds from the crash.
   */
  crashEase(ac) {
    if (!ac || !ac.crashed || !FLASH.reduce) {
      this._crashT0 = null;
      return 0;
    }
    if (this._crashT0 == null) this._crashT0 = this.t;
    const u = clamp((this.t - this._crashT0) / CRASH_EASE, 0, 1);
    return Math.max(1e-3, u * u * (3 - 2 * u));
  }

  /** How far from a wreck the outside views stand with Reduce flashing (crashEase), metres. */
  crashStand() {
    return Math.max(CRASH_MIN, CRASH_K * this.chaseBack * (this.chaseStretchK || 1) + CRASH_ADD);
  }

  /**
   * Where an outside view aims: the airframe's middle — but a wreck with
   * Reduce flashing (crashEase `u`) is aimed at its centre of gravity, eased
   * over: the middle is rotated by the airframe, so on a tumbling wreck it
   * swung a metre or two about the CG every turn, and through the Tower's
   * and the Flyby's long lens that shook the whole picture (measured, the
   * Tower view at 29-42% of a 10-degree field from that alone).
   */
  aimAt(ac, u = 0) {
    if (!this.frame) return this._aimC.copy(ac.pos);
    const a = this.aimPoint(ac);
    return u > 0 ? a.lerp(ac.pos, u) : a;
  }

  /** Ease `lens` out along its line from `aim` to at least crashStand(), by `u` (crashEase). */
  standOff(lens, aim, u) {
    const off = this._tmp4.subVectors(lens, aim);
    const d = off.length();
    if (!(d > 0.01)) return;
    const want = Math.max(d, this.crashStand());
    lens.copy(aim).addScaledVector(off, 1 + (want / d - 1) * u);
    const gh = surfaceAt(lens.x, lens.z) + 2.2;
    if (lens.y < gh) lens.y = gh;
  }

  /**
   * Put the Tower view's lens in `out`: the nearest tower within TOWER_RANGE
   * of the aeroplane, or else a spotter's point near it. True when it moved
   * to a new place this frame (a clean cut: the zoom is set, not eased).
   */
  towerLens(ac, crashU, out) {
    const aim = this.aimAt(ac, crashU);
    const list = this.towers;
    let best = null;
    let bd = Infinity;
    if (list && list.length) {
      for (const t of list) {
        const d = Math.hypot(t.x - aim.x, t.z - aim.z);
        if (d < bd) { bd = d; best = t; }
      }
    } else {
      best = this._homeTower || (this._homeTower = { x: 0, y: 0, z: 0 });
      best.x = TOWER_LENS.x;
      best.y = RUNWAY.elev + TOWER_LENS.up;
      best.z = TOWER_LENS.z;
      bd = Math.hypot(best.x - aim.x, best.z - aim.z);
    }
    const was = this._towerAt;
    const fresh = !this.initialised;
    this.initialised = true;
    if (best && bd <= TOWER_RANGE) {
      this._spot = null;
      out.set(best.x, best.y, best.z);
      this._towerAt = best;
      return !fresh && was !== best;
    }
    // A spotter's point: ahead on the track, off to one side, over the ground.
    let sp = this._spot;
    if (!sp || fresh || Math.hypot(sp.x - aim.x, sp.z - aim.z) > SPOT_FAR) {
      const v = ac.vel || { x: 0, z: 0 };
      let fx = v.x;
      let fz = v.z;
      const fl = Math.hypot(fx, fz);
      if (fl > 3) { fx /= fl; fz /= fl; } else {
        const f = this._tmp4.set(0, 0, -1).applyQuaternion(ac.quat);
        const l = Math.hypot(f.x, f.z) || 1;
        fx = f.x / l;
        fz = f.z / l;
      }
      const side = sp && sp.side ? -sp.side : 1;
      sp = this._spot = { x: aim.x + fx * SPOT_LEAD - fz * SPOT_SIDE * side, z: aim.z + fz * SPOT_LEAD + fx * SPOT_SIDE * side, y: 0, side };
      sp.y = surfaceAt(sp.x, sp.z) + SPOT_UP;
      for (let k = 0; k < 8; k++) {
        const o = obstacleAt(sp.x, sp.y, sp.z);
        if (!o) break;
        sp.y = o.y1 + 3;
      }
    }
    out.set(sp.x, sp.y, sp.z);
    this._towerAt = sp;
    return !fresh && was !== sp;
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
    // Reduce flashing and a wreck, for the views other than Follow (crashEase).
    const crashU = this.crashEase(ac);
    if (!(crashU > 0) || this.mode !== 'wing') this._wingHeld = null;

    // Continuous vibration: engine + buffet + rolling on the ground.
    const inside = this.mode === 'cockpit';
    const engineK = inside ? 1 : clamp(1 - (ac.airspeed || 0) / ENGINE_FADE_SPEED, 0.15, 1);
    let vib = (ac.rpm || 0) * 0.016 * engineK + (ac.buffet || 0) * 0.06;
    if (ac.onGround && ac.groundSpeed > 1) vib += clamp(ac.groundSpeed / 60, 0, 1) * 0.03;
    // Through the sound barrier: a transonic buffet, strongest at Mach 1 and in
    // thick air (machBuffet), gone by Mach 0.88 and 1.12.
    if (!ac.crashed) vib += machBuffet(ac.mach, ac.ias);
    this._vibS += (vib - this._vibS) * (1 - Math.exp(-Math.max(0, dt) / VIB_TAU));
    // Degrees of view, never over the cap (see VIB_GAIN), whatever the switch.
    let vibDeg = Math.min(SHAKE_CAP_DEG, Math.max(0, this._vibS) * (inside ? VIB_GAIN_COCKPIT : VIB_GAIN));
    if (this.reducedMotion) vibDeg *= 0.25;
    /*
     * Reduce flashing (render/flash-safety.js). The eye is a metre from the
     * panel in the cockpit, so the buzz moves every edge of the cockpit; with
     * the switch on it is a tenth of what it is with it off (CAPS.cockpitBuzz)
     * — under a pixel. Knocks (a hard landing, a bang) still shake as they did.
     */
    if (inside) vibDeg = dim(vibDeg, CAPS.cockpitBuzz);
    const vibTan = Math.tan(THREE.MathUtils.degToRad(vibDeg));
    const wx = sway(this.t, SWAY_X) * vibTan;
    const wy = sway(this.t, SWAY_Y) * vibTan;
    const wz = sway(this.t, SWAY_Z) * vibTan;

    this.shake = Math.max(0, this.shake - dt * 2.4);
    const knock = this.shake * 0.35;
    // Reduce flashing: the same knock on a slower clock, under 3 Hz (flash-safety.js).
    const st = shakeClock(this.t);
    const sx = Math.sin(st * 61) * knock + Math.sin(st * 27.3) * knock * 0.6;
    const sy = Math.sin(st * 53.7 + 1.3) * knock + Math.sin(st * 19.1) * knock * 0.5;
    const sz = Math.sin(st * 43.3 + 2.7) * knock * 0.5;
    /** Shake an outside lens looking at `at`: the sway as an angle from there, the knock by `share` (KNOCK_REF). */
    const shakeLens = (lens, at, share) => {
      const d = lens.distanceTo(at);
      const k = share * Math.min(1, d / KNOCK_REF);
      lens.x += wx * d + sx * k;
      lens.y += wy * d + sy * k;
    };

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
      cam.position.x += wx * PANEL_D + sx * 0.5;
      cam.position.y += wy * PANEL_D + sy * 0.5;
      cam.position.z += wz * PANEL_D + sz * 0.5;
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
      // The head sinks a little under g — eased (G_HEAD_TAU), so the flight model's step-to-step
      // g does not jiggle the whole view at speed.
      const gWant = clamp((ac.gLoad || 1) - 1, -0.4, 0.4);
      this._gHead = this._gHead == null ? gWant : this._gHead + (gWant - this._gHead) * (1 - Math.exp(-Math.max(0, dt) / G_HEAD_TAU));
      const headPitch = basePitch + lookPitch + this._gHead * -0.06;
      const q = this._q.setFromEuler(new THREE.Euler(headPitch, headYaw, 0, 'YXZ'));
      cam.quaternion.copy(this._targetQ).multiply(q);
      const want = (this.realisticCockpit ? REALISTIC_FOV : this.baseFov + clamp(ac.airspeed / 90, 0, 1) * 4) + this.speedFov(ac) * 0.5;
      cam.fov = lerp(cam.fov, want, clamp(dt * 3, 0, 1));
      cam.near = 0.08;
    } else if (this.mode === 'chase') {
      // Behind and above, blended between body-axis and velocity-axis so the
      // camera does not spin wildly during aerobatics.
      const back = this._tmp.set(0, 0, 1).applyQuaternion(ac.quat);
      const upV = this._tmp2.set(0, 1, 0).applyQuaternion(ac.quat).multiplyScalar(0.35).add(UP_BIAS);
      // What flying adds, as a share of this aeroplane's own standoff (setFrame):
      // GROW of what the trainer used to be given, scaled with the standoff.
      const grow = this.frame ? (this.chaseBack / CHASE_BACK) * GROW : 1;
      let dist = this.chaseBack + clamp(ac.airspeed / 12, 0, 9) * grow;
      let up = this.chaseUp + Math.min(ac.airspeed, 160) * 0.02 * grow;
      // A phone held upright: back far enough for the wing tips (narrowK). The
      // three airliners' standoff is stretched again after this (chaseStretchK).
      if (this.frame) {
        const nk = this.narrowK(this.frame.halfSpan, Math.hypot(dist, up) * (this.chaseStretchK || 1));
        dist *= nk;
        up *= nk;
      }
      /*
       * Starting the view again over a wreck (the instant replay closing, the
       * comic crash cam ending: initialised = false) stands it behind the
       * wreck's heading and up the world's up, not the airframe's. A wreck
       * can lie on its back or with its nose in the air, and "behind and above"
       * in its own axes then put the camera under it or in it: an A380 that
       * had rolled onto its back after a nose-in came back with the follow
       * view 40 m from its centre, inside the wing (airliners.browser.js).
       * Only a wreck more than about 70 degrees off upright: one still more
       * or less on its belly keeps the view it always had.
       */
      if (ac.crashed && !this.initialised && _desired.set(0, 1, 0).applyQuaternion(ac.quat).y < 0.3) {
        back.y = 0;
        if (back.lengthSq() < 0.04) back.set(0, 1, 0).applyQuaternion(ac.quat).setY(0);
        if (back.lengthSq() < 1e-6) back.set(0, 0, 1);
        back.normalize();
        upV.set(0, 1, 0);
      }
      const aimC = this.frame ? this.aimPoint(ac) : pos;
      const desired = _desired
        .copy(aimC)
        .addScaledVector(back, dist)
        .addScaledVector(upV.normalize(), up);
      if (!this.initialised) {
        this.chasePos.copy(desired);
        this._boomK = 1;
        this._boomSnap = true;
        // The look-at point too. It was left wherever the last flight or the
        // last spell in this view ended, so a new flight began with the camera
        // aimed at the old one: measured in the game, a Skylark take-off after
        // an A380 flight started 78-87 degrees off the aeroplane — not on the
        // screen at all — for the first third of a second.
        this.lookAt.copy(aimC);
        this.initialised = true;
      }
      // Critically-damped spring.
      const k = 42;
      const c = 2 * Math.sqrt(k);
      /*
       * ...stepped so that where it sits does not depend on the frame time
       * (CHASE_LEAD). It used to be measured from where the lens WAS and then
       * moved by this frame's dt, so it ran ahead of its own spring by its
       * speed x dt: at 549 kt T-Pose Harrison's lens was 6.7 m behind him at
       * 240 Hz, 3.1 m at 60, 1.6 m IN FRONT of him at 30 Hz — and every long
       * frame (a hitch) threw it metres at him and back. Now it is measured
       * from a pivot, the lens less CHASE_LEAD of its motion, which comes
       * out exactly as it was at 60 Hz, at every frame rate.
       */
      const h = Math.min(dt, 0.05);
      const pivot = this.chasePos.addScaledVector(this.chaseVel, h - CHASE_LEAD);
      const accel = _accel.subVectors(desired, pivot).multiplyScalar(k);
      accel.addScaledVector(this.chaseVel, -c);
      // ...relative to what is left of the aeroplane's velocity once LAG_SPEED
      // of it has been taken off: nothing below that speed, so the trainer's
      // view is untouched, and a constant 25 m of lag above it (see LAG_SPEED).
      const speed = ac.vel.length();
      // The lag a fitted airframe is allowed: LAG_SHARE of its standoff (6 m on
      // the trainer's 17, at most the 25 m every jet had).
      const lagSpeed = this.frame ? Math.min(LAG_SPEED, (this.chaseBack * LAG_SHARE) / LAG_TIME) : LAG_SPEED;
      const carried = speed > lagSpeed ? 1 - lagSpeed / speed : 0;
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
      this.chaseVel.addScaledVector(accel, h);
      this.chasePos.addScaledVector(this.chaseVel, CHASE_LEAD);
      // Never clip through the ground.
      const gh = heightAt(this.chasePos.x, this.chasePos.z) + 2.2;
      if (this.chasePos.y < gh) {
        this.chasePos.y = gh;
        this.chaseVel.y = Math.max(0, this.chaseVel.y);
      }
      cam.position.copy(this.chasePos);
      shakeLens(cam.position, aimC, 0.35);
      if (SPEC.rotor) this.rotorBoom(ac, desired, dt);
      else this._boomK = 1;
      this.crashBack(ac, cam.position);
      this._chaseOut.copy(cam.position);
      // The same for the point it looks at: carried along with the part of
      // the aeroplane's velocity the spring does not lag, then eased in. On
      // its own it trails by speed / 8, 26 m at 476 kt; with the camera now
      // 48 m back that aimed 14 degrees off Massimo and put it a third of the
      // way up to the top edge. Carried, it is 2.7 degrees — the Skylark's 1.8.
      //
      // Eased by the frame's time exactly (LOOK_RATE, LOOK_LAG): a lerp of
      // dt x 8 trailed by (1 - 8 dt) / 8 of the lagged speed, so a long frame
      // (a hitch) jerked the aim a few centimetres — from Harrison's 3 m, a
      // fifth of a degree, at the rate the hitches came. The same trail as at
      // 60 Hz, at any frame time.
      if (carried > 0) this.lookAt.addScaledVector(ac.vel, carried * dt);
      {
        const lagV = this._lookU || (this._lookU = new THREE.Vector3());
        const err = this._lookE || (this._lookE = new THREE.Vector3());
        lagV.copy(ac.vel).multiplyScalar(1 - carried);
        err.subVectors(aimC, this.lookAt).addScaledVector(lagV, -dt);
        const kL = Math.exp(-LOOK_RATE * Math.max(0, dt));
        err.multiplyScalar(kL).addScaledVector(lagV, LOOK_LAG * (1 - kL));
        this.lookAt.subVectors(aimC, err);
      }
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
      if (lookBehind) aim.copy(aimC).addScaledVector(back, 60);
      cam.lookAt(aim);
      if (lookYaw || lookPitch) {
        cam.rotateY(lookYaw * 0.6);
        cam.rotateX(lookPitch * 0.4);
      }
      cam.fov = lerp(cam.fov, 62 + clamp(ac.airspeed / 90, 0, 1) * 8 + this.speedFov(ac), clamp(dt * 3, 0, 1));
      cam.near = 0.4;
    } else if (this.mode === 'orbit') {
      // Round the airframe's middle, at a radius from its size (setFrame):
      // the trainer's 26 m when nothing is known.
      const F = this.frame;
      let base = F ? clamp(F.radius * ORBIT_K, 8, 420) * (this.tune.orbit || 1) : this.orbitDist;
      if (F) base *= this.narrowK(F.radius, base);
      const k = base / 26;
      // Slower round a big one: the same speed along the circle, not the same angle.
      this.orbitAngle += (dt * 0.16) / Math.max(1, Math.sqrt(k));
      let d = base + clamp(ac.airspeed * 0.04, 0, 6) * k;
      if (crashU > 0) d = Math.max(d, d + (this.crashStand() - d) * crashU);
      const aimO = this.aimAt(ac, crashU);
      cam.position.set(
        aimO.x + Math.cos(this.orbitAngle) * d,
        aimO.y + (6 + Math.sin(this.t * 0.2) * 2) * k,
        aimO.z + Math.sin(this.orbitAngle) * d
      );
      const gh = heightAt(cam.position.x, cam.position.z) + 2.5;
      if (cam.position.y < gh) cam.position.y = gh;
      cam.lookAt(aimO);
      cam.fov = lerp(cam.fov, 58, clamp(dt * 3, 0, 1));
      cam.near = 0.4;
    } else if (this.mode === 'wing') {
      /*
       * Just outboard of the right wing tip and a little over it, looking in
       * at the airframe's middle (setFrame). The trainer's (6.6, 0.6, 1.4)
       * when nothing is known. Eased in the aeroplane's OWN frame, so the
       * view never trails the aeroplane by its speed; it only softens a
       * change of offset (a new view, a new aeroplane).
       */
      const F = this.frame;
      const want = this._wingWant;
      if (F && F.wing) {
        want.copy(F.wing).multiplyScalar(this.tune.wing || 1);
        want.multiplyScalar(this.narrowK(F.radius, want.length())).add(this.centre);
      }
      else want.set(6.6, 0.6, 1.4);
      const fresh = !this.initialised;
      if (fresh) {
        this._wingOff.copy(want);
        this.initialised = true;
      }
      this._wingOff.lerp(want, clamp(dt * 9, 0, 1));
      const offset = this._tmp.copy(this._wingOff).applyQuaternion(ac.quat).add(pos);
      if (crashU > 0) {
        // A wreck with Reduce flashing (crashEase): let go of it where the lens
        // was, and stand off. Started again (the replay closing, a teleport):
        // from the wing as it is now, not wherever the lens last was.
        if (!this._wingHeld || fresh) this._wingHeld = (fresh ? offset : cam.position).clone();
        cam.position.copy(this._wingHeld);
        this.standOff(cam.position, this.aimAt(ac, crashU), crashU);
      } else cam.position.copy(offset);
      shakeLens(cam.position, this.aimAt(ac, crashU), 0.3);
      // Never clip through the ground (same as 'chase' and 'orbit' above) —
      // the offset is rotated by the aircraft's full orientation, so a low
      // bank/pitch/roll (a hovering helicopter, a steep turn near a hill, a
      // crash tumble) can otherwise put the camera below the terrain.
      const gh = heightAt(cam.position.x, cam.position.z) + 2.2;
      if (cam.position.y < gh) cam.position.y = gh;
      const aim = this._tmp2.copy(this.aimAt(ac, crashU));
      cam.lookAt(aim);
      cam.fov = lerp(cam.fov, 64, clamp(dt * 3, 0, 1));
      cam.near = 0.2;
    } else if (this.mode === 'flyby') {
      /*
       * The flyby (camera audit, owner 2026-10-25): a camera set up on the
       * flight path ahead, off to one side and a little below, that stands
       * still while the aeroplane comes at it and goes by — then is set up
       * ahead again, on the other side. The picture is still between cuts
       * (nothing sweeps across it but the aeroplane), and it zooms to the
       * airframe's size as the tower does. Placed FLYBY_S seconds of flight
       * ahead, never nearer than three radii, never in the ground or a
       * building.
       */
      const F = this.frame;
      const R = F ? F.radius : 6;
      const aimF = this.aimAt(ac, crashU);
      const fb = this._flyby || (this._flyby = { pos: new THREE.Vector3(), lead: 0, side: 1 });
      const spd = ac.vel.length();
      const dir = this._tmp;
      if (spd > 3) dir.copy(ac.vel).divideScalar(spd);
      else dir.set(0, 0, -1).applyQuaternion(ac.quat);
      dir.y = clamp(dir.y, -0.4, 0.4);
      dir.normalize();
      const rel = this._tmp2.subVectors(aimF, fb.pos);
      // A wreck with Reduce flashing (crashEase): no more cuts — a tumbling
      // wreck's nose would set one up every frame.
      const gone = !(crashU > 0) && (rel.dot(dir) > fb.lead * 0.55 || rel.length() > fb.lead * 2.2 + 60);
      let cut = false;
      if (!this.initialised || gone) {
        const lead = clamp(spd * FLYBY_S, Math.max(3 * R, 40), 1600);
        const side = this._tmp3.set(0, 1, 0).cross(dir);
        if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
        side.normalize();
        fb.side = this.initialised ? -fb.side : 1;
        const off = 1.4 * R + 10 + spd * 0.06;
        const P = fb.pos.copy(aimF).addScaledVector(dir, lead).addScaledVector(side, off * fb.side);
        P.y -= 0.3 * R + 2;
        // The sea's surface, not its bed: set up below a helicopter hovering
        // 4 m over the sea, the lens stood a metre under the water (heightAt
        // is the seabed out there, -34 m).
        const floor = surfaceAt(P.x, P.z) + 3;
        if (P.y < floor) P.y = floor;
        // Out of any building or rock stack it would stand in.
        for (let k = 0; k < 8; k++) {
          const o = obstacleAt(P.x, P.y, P.z);
          if (!o) break;
          P.y = o.y1 + 3;
        }
        fb.lead = lead;
        this.initialised = true;
        cut = true;
      }
      // A wreck with Reduce flashing: ONE cut, out to crashStand() and a wide
      // lens, then still. Eased, the zoom-out itself flickered (every pixel
      // of a long lens moves).
      if (crashU > 0) {
        this.standOff(fb.pos, aimF, 1);
        if (!fb.crashCut) cut = true;
        fb.crashCut = true;
      } else fb.crashCut = false;
      cam.position.copy(fb.pos);
      cam.lookAt(aimF);
      const dist = Math.max(1, cam.position.distanceTo(aimF));
      const want = crashU > 0 ? 60 : clamp(THREE.MathUtils.radToDeg(2 * Math.atan((R * 2.4) / dist)), 12, 60);
      cam.fov = cut ? want : lerp(cam.fov, want, clamp(dt * 4, 0, 1));
      cam.near = 0.4;
    } else if (this.mode === 'tower') {
      // On the tower balcony, tracking the aeroplane.
      //
      // This used to sit at (40, elev+30, -206) — the exact centre of the
      // glazed cab, whose cylinder is 8.5 m across at that height. The view was
      // through blue tinted glass in every direction with the roof overhead.
      // Standing just outside the cab on the runway side gives a clean view and
      // still reads as the tower. Out of every tower's reach: a spotter's
      // point near the aeroplane (towerLens, TOWER_RANGE).
      const towerCut = this.towerLens(ac, crashU, cam.position);
      const aimT = this.aimAt(ac, crashU);
      cam.lookAt(aimT);
      const dist = cam.position.distanceTo(aimT);
      // Zoom in as the aeroplane gets further away, like a tower controller
      // following it with binoculars — to its size: an airframe of radius R
      // fills about a sixth of the picture's height, between 8 and 60 degrees.
      // The old 60 - dist / 90 left a Skylark at 3 km a dot and an A380 at
      // 500 m off both sides.
      let want = this.frame
        ? clamp(THREE.MathUtils.radToDeg(2 * Math.atan((this.frame.radius * 3) / Math.max(1, dist))), 8, 60)
        : clamp(60 - dist / 90, 12, 60);
      // A wreck with Reduce flashing (crashEase): no closer than the old
      // binoculars, reached in ONE cut — eased, the zoom-out from a long lens
      // flickered at 28-43% of a 10-degree field on its own.
      if (crashU > 0) {
        const wide = clamp(60 - dist / 90, 12, 60);
        want = Math.max(want, wide);
        if (!this._towerCut && cam.fov < wide) cam.fov = wide;
        this._towerCut = true;
      } else this._towerCut = false;
      cam.fov = towerCut ? want : lerp(cam.fov, want, clamp(dt * 2, 0, 1));
      cam.near = 0.5;
    }

    cam.updateProjectionMatrix();
  }
}
