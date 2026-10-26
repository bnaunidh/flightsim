/**
 * What the three big airliners need from the game that a roster entry and a
 * model cannot give them on their own: to be stood on their wheels properly,
 * and to be seen from outside.
 *
 * 1. STANDING ON THE WHEELS — now done by the flight model itself.
 *
 *    Aircraft.settleOnGear() in physics.js used to find the static attitude by
 *    fixed-step relaxation, which diverged on these three (the A320 came out
 *    of it at +7.1° pitch and crashed on its wing tip, the 747 at +34° and
 *    1,140 m up), so this file carried a Newton solve and wrapped the settle
 *    for these three types. physics.js now solves height and pitch together
 *    for every type, including the loads this solve left out (idle thrust
 *    held by the tyres), and it converges for the Meridian, Osprey and
 *    Tempest, where this one ran out of iterations at 13-15° nose up.
 *    Measured with the wrapper removed, 3 s hands off on the runway: A320
 *    0.14 cm / 0.030°, 747 0.10 cm / 0.011°, A380 0.10 cm / 0.009° (with it:
 *    0.10 / 0.023, 0.06 / 0.007, 0.05 / 0.005 — both well inside 2 cm and
 *    0.2°, and both end at the same attitude), so the wrapper is gone.
 *
 * 2. BEING SEEN.
 *
 *    The chase camera sits 17-26 m behind the centre of gravity whatever you
 *    fly, which is right for an eight-metre trainer and puts you inside the
 *    fin of a 70 m jumbo, whose tail is 40 m back. For these types the rig
 *    still runs — its spring, its ground clamp, its look-behind — and the
 *    offset it produces is then stretched by the aeroplane's length over 24 m
 *    (A320 1.57, 747 2.94, A380 3.03), with the height lifted a further 40%
 *    in the follow view so the camera clears the fin. The orbit view is
 *    stretched the same way, and the wing view is mounted at the rig's offset
 *    times the same factor, which lands it over the outboard wing: the
 *    window-seat view. The cockpit and tower views are left to the rig.
 *
 * 3. THE PANEL, moved to where the pilot sits — see seatPanel() below.
 *
 * 4. TAKE-OFF FLAP, set when a flight starts on the ground, with one line on
 *    screen saying so and when to pull back — see setTakeoffFlaps() below.
 *
 * One thing here reaches past the plug-in hooks, and says why where it does
 * it: the camera rig's update() is wrapped. The wrapper acts only for these
 * three types, passes straight through for everything else, and catches its
 * own errors — it runs inside main.js's frame, outside the fence the hooks
 * get.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { performanceFor, AIRCRAFT } from '../aircraft/types.js';
import { heightAt } from '../world/terrain.js';
import { AIRLINER_GEOMETRY } from '../aircraft/extra/airliners.js';
import * as PROG from '../game/progression.js';
import { FLASH } from '../render/flash-safety.js';

export const AIRLINER_IDS = Object.freeze(Object.keys(AIRLINER_GEOMETRY));
const MINE = new Set(AIRLINER_IDS);

/*
 * The airliners added since these three (aircraft/extra/jets.js, giants.js)
 * register their geometry in AIRLINER_GEOMETRY and carry their own sale row
 * and take-off flap on the roster entry (`price`, `why`, `takeoffFlaps`), so
 * adding one never means editing the tables below.
 */
function fromRoster(key) {
  const out = {};
  for (const t of AIRCRAFT) if (MINE.has(t.id) && t[key] != null) out[t.id] = t[key];
  return out;
}

/** True when the aeroplane being flown is one of the three. */
export function isAirliner(sim) {
  return !!(sim && sim.aircraftType && MINE.has(sim.aircraftType.id));
}

/* ------------------------------------------------------------------ *
 * Camera
 * ------------------------------------------------------------------ */

/** How much further back the views stand, by aeroplane. */
export function viewScale(id) {
  const g = AIRLINER_GEOMETRY[id];
  return g ? Math.max(1, g.length / 24) : 1;
}

/*
 * Only the follow view now. The orbit and wing views size themselves to the
 * airframe in the rig (flight/camera.js setFrame), for every type alike;
 * stretched again here they stood three times too far off the three
 * airliners. The follow view's fit (main.js) is still made through this.
 */
const STRETCHED = new Set(['chase']);
const _target = new THREE.Vector3();
const _off = new THREE.Vector3();
const _aim = new THREE.Vector3();
/*
 * Where the rig itself put the camera last frame, before it was stretched.
 * The wing view eases the camera towards its offset starting from wherever
 * `camera.position` is — its state IS the camera — so handing it back the
 * stretched position would ease from there and be stretched again, which
 * runs away (with k = 3 and the rig's 0.15 per frame it diverges). The chase
 * view keeps its own spring and the orbit view sets the camera outright, so
 * for them this changes nothing.
 */
const rigCam = { pos: new THREE.Vector3(), mode: null };
/*
 * Reduce flashing (render/flash-safety.js, on by default) and a crash: the
 * point the stretch scales about, held where it was when the aeroplane
 * crashed.
 *
 * The rig stops its own camera where it is for a wreck (flight/camera.js) but
 * keeps easing its look-at point onto the wreck, which is right: the picture
 * stays and the wreck stays in it. Stretched about that moving point, though,
 * the camera is `k * rig - (k - 1) * lookAt`, so every metre the look-at
 * point moves is k - 1 metres (and 1.4 times that in height) of camera travel
 * the other way. An A380 that has nosed in pitches slowly over its nose, its
 * centre rising under two metres a second; k is 3 for it, and the camera sank
 * at a steady six metres a second for the whole of the crash, 120 m above a
 * shoreline, so the ground slid across the picture: 25-42% of a 10-degree
 * field flashing in the crash sweep (tests/features/crash-sweep.browser.js,
 * WCAG's line is 25%; the F-22, with no stretch, 4-8%). Scaled about the
 * held point the camera moves only as the rig's does — braking with it in
 * the first half second, then still — and the aim below still follows the
 * rig's live look-at, so the wreck stays in the middle. With the switch off
 * nothing here changes.
 *
 * Held still, 22-28% still flickered: the stretched follow view of an
 * airliner that has nosed in is 120 m straight above it, and from there the
 * wreck's own footprint — the painted fin and the pieces turning over, the
 * engines burning, the dust and smoke over the ground round them — fills a
 * 10-degree field (measured with the camera frozen outright, and again with
 * the particles and the shadows off: 15% was the wreck and its pieces alone).
 * How much of the picture that covers falls with the square of the distance,
 * so, as the comic crash cam already does with the switch on
 * (features/crashes.js CRASH_CAM_BACK_REDUCED), the stretched view stands
 * further back from a wreck: CRASH_BACK_REDUCED times, eased in over
 * CRASH_BACK_EASE seconds of the rig's clock as a pull-back rather than a
 * cut. 1.5 times (184 m) measured 8.5-13% in three quiet runs, and the F-22's
 * glow and dust at the same distance 4-10%.
 */
const held = { on: false, target: new THREE.Vector3(), t0: 0, retarget: false };
export const CRASH_BACK_REDUCED = 1.5;
export const CRASH_BACK_EASE = 0.6;

function stretchView(sim, camera) {
  const rig = sim.rig;
  rigCam.pos.copy(camera.position);
  rigCam.mode = rig.mode;
  const k = viewScale(sim.aircraftType.id);
  // The rig aims the chase view at its own lagged `lookAt` and the other two
  // straight at the aeroplane; stretching along that line keeps whatever the
  // rig was pointing at exactly where it was on screen.
  let back = 1;
  if (rig.mode === 'chase') {
    if (sim.aircraft.crashed && FLASH.reduce) {
      if (!held.on) {
        held.on = true;
        held.target.copy(rig.lookAt);
        held.t0 = rig.t || 0;
      } else if (held.retarget) {
        /*
         * The rig started its view again over the wreck (the instant replay
         * closing, the comic crash cam ending: rig.initialised = false), so
         * its camera and look-at point were put somewhere new. Scaled about
         * the point held from before, the view came back 21 m from the
         * A380's centre after a nose-in replay instead of 110 m (measured);
         * hold the new look-at point instead. Already stood back: the snap
         * is a cut anyway, so no second ease.
         */
        held.target.copy(rig.lookAt);
      }
      held.retarget = false;
      _target.copy(held.target);
      const u = Math.min(1, Math.max(0, ((rig.t || 0) - held.t0) / CRASH_BACK_EASE));
      back = 1 + (CRASH_BACK_REDUCED - 1) * u * u * (3 - 2 * u);
    } else {
      held.on = false;
      _target.copy(rig.lookAt);
    }
  } else {
    held.on = false;
    _target.copy(sim.aircraft.pos);
  }
  _off.subVectors(camera.position, _target).multiplyScalar(k * back);
  /*
   * And a little higher than straight scaling gives. Stretched evenly the
   * 747's follow view sat 15 m up with a fin whose tip is 13.5 m up, so the
   * fin stood in the middle of the picture and hid the runway (seen in the
   * game). Lifting the height part by another 40% puts the camera over the fin
   * and the runway back above it. Only the chase view: the orbit and wing
   * views are not looking along the fuselage.
   */
  if (rig.mode === 'chase') _off.y *= 1.4;
  camera.position.copy(_target).add(_off);
  const floor = heightAt(camera.position.x, camera.position.z);
  const minY = (Number.isFinite(floor) ? Math.max(floor, 0) : 0) + 2.5;
  if (camera.position.y < minY) camera.position.y = minY;
  if (rig.mode !== 'chase') {
    camera.lookAt(sim.aircraft.pos);
  } else {
    // The lift moved the camera off the rig's line of sight, so aim again the
    // way the rig does: at its lagged target, or sixty metres behind the
    // aeroplane when looking back, then the free-look offsets on top.
    const input = sim.input;
    const behind = input && typeof input.held === 'function' && input.held('lookBehind');
    if (behind) _aim.set(0, 0, 1).applyQuaternion(sim.aircraft.quat).multiplyScalar(60).add(sim.aircraft.pos);
    else _aim.copy(rig.lookAt);
    camera.lookAt(_aim);
    const yaw = input ? input.lookYaw || 0 : 0;
    const pitch = input ? input.lookPitch || 0 : 0;
    if (yaw || pitch) {
      camera.rotateY(yaw * 0.6);
      camera.rotateX(pitch * 0.4);
    }
  }
  camera.updateProjectionMatrix();
}

/*
 * The instrument panel, put where the pilot is.
 *
 * main.js scales the cockpit by 1 / shape.scale and places it at eye / scale,
 * which is right for model.js — whose airframe is scaled up by that same
 * number — and wrong for a fleet model, which is built in metres at scale 1.
 * With these three's scales of 2.5 to 5.1 it left the panel at a fifth of its
 * size, six metres forward of the A380's centre of gravity and 25 m behind
 * the pilot, so "realistic cockpit" showed nothing at all. The fleet bridge
 * has the right sum (configurePlayerAircraft: scale 1, eye minus the
 * trainer's eye) and nothing calls it; this is that sum, for these three
 * only.
 */
const TRAINER_EYE = [-0.24, 0.46, 0.06];

function seatPanel(sim) {
  const cp = sim.cockpit;
  const model = sim.model;
  const fg = model && model.userData && model.userData.flightGeometry;
  if (!cp || !fg || !model.userData.fleetBridge || cp.parent !== model || !Array.isArray(fg.eye)) return;
  if (cp.scale.x === 1 && cp.userData.airlinerSeated === model) return;
  cp.scale.setScalar(1);
  cp.position.set(fg.eye[0] - TRAINER_EYE[0], fg.eye[1] - TRAINER_EYE[1], fg.eye[2] - TRAINER_EYE[2]);
  cp.userData.airlinerSeated = model;
}

/*
 * Take-off flap, set for you when the flight starts on the ground.
 *
 * Every flight resets the flaps to zero, and the Kestrel strip is only just
 * long enough for these three with flap out. Flown the way the playtest flies
 * a take-off (0.45 back stick at 1.25 x the approach speed, then 10 degrees
 * nose up) with the flaps left up, the 747 and the A380 were still below 15 m
 * at the end of the runway and flew into the rising ground 200 m past it —
 * as the Meridian and the Tempest do. Nobody aged ten reads "flaps down
 * before you roll" in a hangar blurb and remembers it at the holding point.
 * A real crew sets take-off flap before it lines up, so the aeroplane arrives
 * set up that way: 10 degrees on the A320 (15 m up at 840 m from brake
 * release), 20 on the two jumbos (801 and 775 m), with 1,020 m of runway
 * ahead of the wheels. tests/features/airliners.mjs flies it. The flaps
 * lever still works as it always did.
 */
export const TAKEOFF_FLAPS = Object.freeze({ ...fromRoster('takeoffFlaps'), a320: 1, b747: 2, a380: 2 });

function setTakeoffFlaps(sim, ac) {
  const id = sim.aircraftType.id;
  const step = TAKEOFF_FLAPS[id];
  if (!step || typeof ac.setFlaps !== 'function' || ac.flapStep() >= step) return;
  ac.setFlaps(step);
  let rotate = 90;
  try {
    rotate = Math.round((performanceFor(id).stallLanding * 1.3) / 5) * 5;
  } catch (e) {
    /* the hint just says 90 */
  }
  if (sim.hud && typeof sim.hud.notify === 'function') {
    sim.hud.notify(
      `Take-off flaps set (${step * 10}°). Full power, then pull back gently at about ${rotate} knots.`,
      'info',
      7
    );
  }
}

/*
 * For sale in the hangar.
 *
 * An aeroplane the progression does not list is not in FREE and not in
 * UNLOCKS, so isUnlocked() is false for ever and costOf() is 0: its card is
 * locked, clicking it says "unlock it for 0 credits in the Hangar", and the
 * Hangar's buy button answers "Not for sale". That is how the Skyhook was
 * unreachable once (the comment above FREE in progression.js), and it was
 * true of these three — the wishlist's own aeroplanes could not be picked in
 * Free Flight at all; only the tests, which set the type directly, flew them.
 *
 * progression.js is not this feature's file and has no way to add a row from
 * outside except its exported UNLOCKS array, so the rows go in here, priced
 * on the existing ladder (Meridian 600 ... Nightjar 3000): the A320 beside
 * the Meridian, the two jumbos between the Osprey and the Tempest. Only added
 * if nobody has listed them already, so the same rows written into
 * progression.js itself make this a no-op. Fenced, because a throw at import
 * would take features/index.js, and the game, with it.
 */
export const PRICES = Object.freeze({ ...fromRoster('price'), a320: 600, b747: 1200, a380: 1600 });
const WHY = {
  ...fromRoster('why'),
  a320: 'The airliner you have probably flown on',
  b747: 'The Jumbo, hump and all',
  a380: 'Two decks, four engines, twenty-two wheels',
};
try {
  const rows = PROG.UNLOCKS;
  if (Array.isArray(rows)) {
    for (const id of AIRLINER_IDS) {
      if (!rows.some((u) => u && u.aircraft === id)) rows.push({ aircraft: id, cost: PRICES[id], why: WHY[id] });
    }
  }
} catch (e) {
  console.warn('[airliners] could not list the airliners for sale in the hangar', e);
}

registerExtension({
  id: 'airliners',

  install(sim) {
    installCamera(sim);
  },

  startMode(sim, mode) {
    // Driving leaves the aeroplane type selected but parked; nothing to do.
    if (mode === 'drive' || !isAirliner(sim)) return;
    // A no-op once done; here as well as in install() in case the game ever
    // builds a fresh camera rig after boot.
    installCamera(sim);
    seatPanel(sim);
    // Take-off flap only on the ground, and only before it has moved — and
    // never for a seat that flies nothing (the President rides in Air Force
    // One; the parked 747 under the seat is not anybody's to take off in).
    const def = sim.runner && sim.runner.def;
    if (def && def.passenger) return;
    const ac = sim.aircraft;
    if (!ac || !ac.onGround || ac.distanceFlown > 0) return;
    if (ac.vel && ac.vel.lengthSq() > 0.01) return;
    setTakeoffFlaps(sim, ac);
  },

  update(sim) {
    // The cockpit is rebuilt whenever the aeroplane or its paint changes;
    // this costs two comparisons a frame when nothing has.
    if (isAirliner(sim)) seatPanel(sim);
  },

});

/*
 * Why the rig's own update is wrapped rather than the `camera` hook used.
 *
 * The hook is first-come: whichever feature returns true first owns the
 * camera and the rest are never asked. A feature that walks you about the
 * apron needs the camera while a parked A380 is still the aeroplane type, and
 * this one, asking only "is it an airliner in the follow view?", would take it
 * from them whenever it happened to be registered first. Post-processing what
 * the rig does means this runs exactly when the rig runs and never when some
 * other feature has the camera — and it cannot break the rig: a throw here is
 * caught, logged once, and the stretch is switched off.
 */
let stretchBroken = false;
function installCamera(sim) {
  const rig = sim && sim.rig;
  if (!rig || rig.__airlinerStretch || typeof rig.update !== 'function') return;
  const original = rig.update;
  rig.__airlinerStretch = true;
  rig.update = function updateWithAirliners(dt, ac, input, weather) {
    let mine = false;
    if (!stretchBroken) {
      try {
        mine = isAirliner(sim) && STRETCHED.has(this.mode);
        // A view started again: a crash's held point (stretchView) is stale.
        if (!this.initialised) held.retarget = true;
        // Hand the wing view back its own unstretched position to ease from.
        if (mine && rigCam.mode === this.mode) this.camera.position.copy(rigCam.pos);
      } catch (e) {
        mine = false;
      }
    }
    const out = original.call(this, dt, ac, input, weather);
    if (!mine) {
      rigCam.mode = null;
      return out;
    }
    try {
      stretchView(sim, this.camera);
    } catch (e) {
      stretchBroken = true;
      rigCam.mode = null;
      console.warn('[airliners] camera stretch failed and is off for this session', e);
    }
    return out;
  };
}
