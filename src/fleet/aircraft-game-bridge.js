/** Runtime adapter for the two audited Island Flight Simulator source trees.
 * Construction is intentionally free of global flight-SPEC mutations. */
import * as THREE from '../vendor/three.module.js';
import { createFleetAircraft, aircraftIds } from './aircraft-fleet.js';
import { createSinkingEffect } from './effects.js';
const SUPPORTED = new Set(aircraftIds);
const eyeReference = new THREE.Vector3(-.24, .46, .06);
const clamp = THREE.MathUtils.clamp;

export function createGameAircraft(options = {}, legacyFactory) {
  const id = options.type?.id ?? 'skylark';
  if (!SUPPORTED.has(id)) {
    if (typeof legacyFactory !== 'function') throw new RangeError(`No legacy factory for aircraft ${id}`);
    return legacyFactory(options);
  }
  const model = createFleetAircraft(id, options), update = model.userData.update, reset = model.userData.resetDamage, dispose = model.userData.dispose;
  let ended = false;
  model.userData.fleetBridge = true;
  model.userData.gameCrash = null;
  function clearWater() {
    const sinking = model.userData.gameCrash?.sinking;
    if (sinking) { sinking.userData.dispose(); sinking.removeFromParent(); }
    model.userData.gameCrash = null;
  }
  model.userData.resetDamage = () => { clearWater(); reset(); };
  model.userData.update = (dt, ac = {}, weather = {}) => {
    if (ended) return;
    if (ac.crashed === false && model.userData.gameCrash) model.userData.resetDamage();
    const control = ac.controls ?? ac, compression = ac.wheelCompression;
    const state = { rpm: ac.rpm ?? 0, gear: ac.gearPos ?? ac.gear ?? 1, flaps: ac.flaps ?? 0,
      pitch: control.pitch ?? 0, roll: control.roll ?? 0, yaw: control.yaw ?? 0,
      onGround: !!ac.onGround, groundSpeed: ac.groundSpeed ?? 0, brakes: control.brakes ?? 0,
      suspension: compression ? [compression.nose ?? 0, compression.left ?? 0, compression.right ?? 0] : ac.suspension ?? 0,
      night: !!weather.isNight, lights: ac.engineOn !== false || ac.rpm > .05,
      worldVelocity: ac.vel ?? { x: 0, y: 0, z: 0 }, camera: model.userData.gameCamera };
    const crash = model.userData.gameCrash;
    const previousPosition = crash && ac.pos ? ac.pos.clone() : null;
    const previousVelocity = crash && ac.vel ? ac.vel.clone() : null;
    if (crash?.sinking) {
      // Sinking owns the aircraft transform; common advances detached pieces only.
      model.userData.updateDebris(dt); model.userData.updateImpact(dt);
      crash.sinking.userData.update(dt, { camera: model.userData.gameCamera });
    } else update(dt, state);
    if (crash && ac.pos && ac.quat) {
      model.getWorldPosition(ac.pos); model.getWorldQuaternion(ac.quat);
      const body = model.userData.crashBody;
      if (body) { ac.vel?.copy(body.velocity); ac.omega?.copy(body.angularVelocity).applyQuaternion(ac.quat.clone().invert()); }
      else if (crash.sinking && ac.vel && previousPosition && dt > 0) ac.vel.copy(ac.pos).sub(previousPosition).divideScalar(dt);
      // The host's crashed flight update exits early, so its instrument caches
      // must follow the wreck as well as its position and attitude.
      ac.alt = ac.pos.y;
      const terrain = typeof crash.groundHeight === 'function' ? crash.groundHeight(ac.pos.x, ac.pos.z) : crash.groundHeight ?? 0;
      const surface = crash.water ? 0 : Number.isFinite(terrain) ? Math.max(0, terrain) : 0;
      ac.agl = Math.max(0, ac.pos.y - surface);
      ac.vs = ac.vel?.y ?? 0; ac.groundSpeed = ac.vel ? Math.hypot(ac.vel.x, ac.vel.z) : 0;
      const wind = new THREE.Vector3(); weather.windVector?.(wind);
      const relative = (ac.vel?.clone() ?? new THREE.Vector3()).sub(wind);
      ac.airspeed = relative.length(); ac.ias = ac.airspeed * Math.sqrt(Math.exp(-Math.max(0, ac.alt) / 8500));
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(ac.quat);
      ac.heading = (THREE.MathUtils.radToDeg(Math.atan2(forward.x, -forward.z)) + 360) % 360;
      ac.turnRate = THREE.MathUtils.radToDeg(-(ac.omega?.y ?? 0));
      ac.onGround = !crash.water && !!body && (body.contacts > 0 || body.sleeping);
      ac.stalled = false; ac.buffet = 0; ac.alpha = 0; ac.beta = 0; ac.slipBall = 0;
      if (previousVelocity && ac.vel && dt > 0) {
        const specificForce = ac.vel.clone().sub(previousVelocity).divideScalar(dt).add(new THREE.Vector3(0, 9.81, 0));
        ac.gLoad = clamp(specificForce.dot(new THREE.Vector3(0, 1, 0).applyQuaternion(ac.quat)) / 9.81, -3, 12);
      }
    }
  };
  model.userData.dispose = () => { if (ended) return; clearWater(); dispose(); ended = true; };
  return model;
}

/** Explicit player-only call. Ambient/parked model factories never call it. */
export function configurePlayerAircraft(spec, model, type, cockpit = null, rig = null) {
  const geometry = model?.userData.flightGeometry;
  if (!model?.userData.fleetBridge || !geometry) { if(rig){rig.fleetScale=1;rig.fleetWingOffset=null;} return false; }
  const oldLegs = new Map(spec.gearPoints.map(leg => [leg.name, leg]));
  spec.gearPoints = geometry.gearPoints.map(point => ({ ...oldLegs.get(point.name), ...point,
    pos: new THREE.Vector3(...point.pos), partId: point.name === 'nose' ? 'noseGear' : point.name === 'left' ? 'leftGear' : 'rightGear' }));
  spec.hardPoints = geometry.hardPoints.map(point => ({ ...point, pos: new THREE.Vector3(...point.pos) }));
  spec.fleetGeometry = true;
  // Aerodynamic tuning is retained; collision geometry and spring travel agree
  // with the new visible wheels. The factory's hidden legacy scale is gone.
  if (cockpit) { cockpit.scale.setScalar(1); cockpit.position.copy(new THREE.Vector3(...geometry.eye).sub(eyeReference)); }
  if (rig) {
    rig.eye.set(...geometry.eye); model.userData.gameCamera = rig.camera;
    rig.fleetScale = Math.max(1, geometry.wingSpan / 11, (geometry.bounds.max[2] - geometry.bounds.min[2]) / 11);
    const tips = geometry.hardPoints.filter(p => p.partId === 'rightWing');
    const outer = tips.length ? tips.reduce((a,b) => a.pos[0] > b.pos[0] ? a : b).pos : [geometry.wingSpan/2,0,0];
    rig.fleetWingOffset = [outer[0]+.5,outer[1]+.65,outer[2]+.6];
    if (rig.fleetAircraftId !== model.userData.aircraftId) { rig.initialised=false;rig.chaseVel?.set(0,0,0);rig.fleetAircraftId=model.userData.aircraftId; }
  }
  model.userData.playerGeometryConfigured = true;
  return true;
}

export function synchronizeGameAircraft(model, ac) {
  if (model.userData.fleetBridge && !ac.crashed && (model.userData.gameCrash || model.userData.crashBody || model.userData.crashRetired)) model.userData.resetDamage();
  if (!model.userData.fleetBridge || !model.userData.gameCrash) {
    model.position.copy(ac.pos); model.quaternion.copy(ac.quat);
  }
}

export function beginGameAircraftCrash(model, ac, event = {}, { groundHeight = 0, camera = null } = {}) {
  if (!model?.userData.fleetBridge) return false;
  if (model.userData.gameCrash) return true;
  const position = event.position ?? ac.pos, quaternion = event.quaternion ?? ac.quat;
  model.position.copy(position); model.quaternion.copy(quaternion); model.updateMatrix(); model.updateWorldMatrix(true, true);
  model.userData.gameCamera = camera;
  const velocity = event.worldVelocity?.clone() ?? ac.vel.clone();
  const angular = event.worldAngularVelocity?.clone() ?? ac.omega.clone().applyQuaternion(quaternion);
  const point = event.worldPoint?.clone() ?? position.clone();
  const normal = event.worldNormal?.clone() ?? new THREE.Vector3(0, 1, 0);
  const sample = typeof groundHeight === 'function' ? groundHeight(point.x, point.z) : groundHeight;
  const water = event.surfaceKind === 'water' || (sample < 0 && point.y < 3);
  let partId = event.partId;
  if (partId && !model.userData.strikePoints[partId]) partId = undefined;
  if (!partId) {
    const reason = event.reason ?? '';
    if (/left wing/i.test(reason)) partId = 'leftWing';
    else if (/right wing/i.test(reason)) partId = 'rightWing';
    else if (/nose/i.test(reason)) partId = 'nose';
    else if (/tail/i.test(reason)) partId = 'tail';
    else if (/belly|wheels up/i.test(reason)) partId = 'fuselage';
    if (partId && !model.userData.strikePoints[partId]) partId = undefined;
  }
  const crash = { water, sinking: null, groundHeight, reason: event.reason ?? 'Impact' };
  model.userData.gameCrash = crash;
  const report = model.userData.impact({ worldPoint: point, worldNormal: normal, worldVelocity: velocity, worldAngularVelocity: angular,
    partId, surfaceKind: water ? 'water' : event.surfaceKind ?? 'asphalt',
    groundHeight: water ? (() => NaN) : groundHeight, forceCrash: true, deferCrash: water, debrisParent: model.parent });
  crash.report = report;
  if (water) {
    const sinking = createSinkingEffect({ duration: 18 }); model.parent.add(sinking);
    sinking.userData.start({ aircraft: model, duration: 18 }); crash.sinking = sinking;
  }
  return true;
}

function disposeTree(root) {
  if (!root) return;
  const disposed = new Set(); root.traverse(node => {
    if (node.geometry && !disposed.has(node.geometry)) { disposed.add(node.geometry); node.geometry.dispose(); }
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : [])
      if (!disposed.has(material)) { disposed.add(material); material.dispose(); }
  });
}
export function disposeGameAircraft(model, cockpit = null) {
  // The live instrument cockpit was added by the game and has a separate owner.
  if (cockpit) { cockpit.removeFromParent(); disposeTree(cockpit); }
  if (model?.userData.fleetBridge) model.userData.dispose(); else disposeTree(model);
  model?.removeFromParent();
}
