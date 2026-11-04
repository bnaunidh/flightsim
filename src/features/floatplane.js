/**
 * The floatplane: everything the Petrel does on the sea. The flight model
 * asks ac.floatStep (./floatplane/hydro.js) after the gear; this file installs
 * that, grades a water landing, puts her on the water at the start of a flight
 * and throws the spray. On land she has no wheels: her keels are a skid.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { heightAt, obstacleAt, harbourBerth, MAP } from '../world/terrain.js';
import { RUNWAY } from '../world/airport.js';
import { SPEC } from '../aircraft/physics.js';
import { multiplayer } from './multiplayer.js';
import { floatStep, gradeWater } from './floatplane/hydro.js';

/** How much clear water she wants ahead for a take-off, metres. */
export const TAKEOFF_RUN = 1100;
const _p = new THREE.Vector3();
const S = { sim: null, fx: null, loading: null, sprayAcc: 0, gap: 0, flip: 1, last: null };

const isFloat = (sim) => !!(sim && sim.aircraftType && sim.aircraftType.floats);

function loadFx(sim) {
  if (S.loading) return S.loading;
  const low = !!(sim.settings && sim.settings.quality === 'low');
  S.loading = import('./ditching/water-fx.js')
    .then((m) => {
      S.fx = new m.SeaFx(sim.scene, { low });
    })
    .catch((e) => console.warn('[floatplane] no spray', e));
  return S.loading;
}

/** Is this a straight run of open water from (x, z) along `a` radians? */
function clearRun(x, z, a, run = TAKEOFF_RUN) {
  for (let d = 0; d <= run; d += 100) {
    const px = x + Math.sin(a) * d;
    const pz = z - Math.cos(a) * d;
    if (heightAt(px, pz) > -2 || obstacleAt(px, 3, pz)) return false;
  }
  return true;
}

/** The nearest open water with a take-off run, from the field outwards. Null on a map with no sea. */
export function waterStart(from = RUNWAY.touchdown || { x: 0, z: 0 }) {
  const fx = from.x || 0;
  const fz = from.z || 0;
  for (let r = 300; r <= 9000; r += 300) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const x = fx + Math.sin(a) * r;
      const z = fz - Math.cos(a) * r;
      if (heightAt(x, z) > -3) continue;
      for (let k = 0; k < 8; k++) {
        const h = a + (k / 8) * Math.PI * 2;
        if (clearRun(x, z, h)) return { x, z, headingDeg: (((h * 180) / Math.PI) % 360 + 360) % 360 };
      }
    }
  }
  return null;
}

function onTheWater(sim, spot) {
  const ac = sim.aircraft;
  _p.set(spot.x, 0, spot.z);
  ac.reset({ pos: _p, headingDeg: spot.headingDeg, speed: 0, altAGL: null, engineOn: true, fuel: 1 });
  ac.parkingBrake = false;
  if (sim.input) sim.input.throttleTarget = 0;
  // No taxi route out here, and the tower's words for a runway would be wrong.
  if (sim.taxi && sim.taxi.active && sim.taxi.stop) sim.taxi.stop();
  if (sim.atc && sim.atc.said) sim.atc.said.start = true;
  if (sim.rig && typeof sim.rig === 'object') sim.rig.initialised = false;
  if (sim.hud && sim.hud.setObjective) {
    sim.hud.setObjective(`Free Flight — ${MAP && MAP.name ? MAP.name : 'the islands'}`, 'You are on the water. Flaps one notch, full power, stick back as she climbs on to the step, and she lifts off at about 60 knots. Hold 70 and climb.');
  }
  S.last = spot;
}

function sprayAndWake(sim, dt) {
  const ac = sim.aircraft;
  const fx = S.fx;
  if (!fx) return;
  fx.update(dt);
  if (!ac.onWater) return;
  fx.setLight(!!sim.weather.isNight);
  const speed = ac.groundSpeed;
  if (speed < 1.5) return;
  const sin = Math.sin((ac.heading * Math.PI) / 180);
  const cos = Math.cos((ac.heading * Math.PI) / 180);
  const k = Math.min(1, speed / 26);
  S.sprayAcc = Math.min(3, S.sprayAcc + dt * fx.N * 0.3 * k);
  const fl = SPEC.floats.stations;
  while (S.sprayAcc >= 1) {
    S.sprayAcc -= 1;
    const side = (S.flip = -S.flip);
    const x = fl[0][0] * side;
    const px = ac.pos.x - cos * x * -1 + sin * 0.6;
    const pz = ac.pos.z - sin * x * -1 - cos * 0.6;
    fx.spray(px + cos * side * 0.4, 0.15, pz + sin * side * 0.4, cos * side * (0.6 + speed * 0.09) + ac.vel.x * 0.4, 1 + k * 3.4 * Math.random() + k, sin * side * (0.6 + speed * 0.09) + ac.vel.z * 0.4, 0.22 + k * 0.28, 0.5 + k * 0.4, 0.5);
  }
  S.gap += speed * dt;
  const gap = Math.max(1.3, (speed * 3) / fx.W);
  if (S.gap >= gap) {
    S.gap = 0;
    for (const side of [-1, 1]) {
      const aft = 2.3;
      fx.wake(ac.pos.x + cos * side * 1.3 - sin * aft, ac.pos.z + sin * side * 1.3 + cos * aft, -(ac.heading * Math.PI) / 180, 0.85, 3.4, 0.6, gap * 2.6, 0.6);
    }
  }
}

function fit(ac) {
  ac.floatStep = floatStep;
  if (ac._gradeLand) return;
  // Fixed floats: the lever does nothing, where a fixed-gear flag would count as wheels up.
  const lever = ac.toggleGear;
  ac.toggleGear = function gearOrFloats() {
    if (!SPEC.floats) return lever.call(this);
    if (S.sim && S.sim.hud) S.sim.hud.notify('Fixed floats: there is no gear to raise', 'info', 2.4);
    return true;
  };
  ac._gradeLand = ac.gradeTouchdown;
  ac.gradeTouchdown = function gradeOnFloats(vsFpm, bank, centreline) {
    return this.onWater ? gradeWater(this, vsFpm, bank, this.difficulty) : this._gradeLand(vsFpm, bank, centreline);
  };
}

export function floatState() {
  const sim = S.sim;
  const ac = sim && sim.aircraft;
  return { float: isFloat(sim), onWater: !!(ac && ac.onWater), last: S.last, fx: !!S.fx, pool: S.fx ? { spray: S.fx.N, foam: S.fx.W, alive: S.fx.alive } : null };
}

registerExtension({
  id: 'floatplane',

  install(sim) {
    S.sim = sim;
    sim.floatplane = { state: floatState, waterStart };
    fit(sim.aircraft);
  },

  startMode(sim, mode, opts) {
    const ac = sim.aircraft;
    fit(ac);
    ac.onWater = false;
    if (S.fx) S.fx.clear();
    if (!isFloat(sim)) return;
    loadFx(sim);
    // On a map with sea she starts on it, unless you asked for the runway or the air.
    if (mode !== 'free' || !opts || opts.airborne || opts.startAt === 'runway' || ac.pos.y > 60) return;
    // A joiner keeps the host's spawn offsets, so two players never share a spot.
    if (multiplayer && multiplayer.role && multiplayer.transition) return;
    // Already at the harbour: features/spawns.js has said so.
    if (heightAt(ac.pos.x, ac.pos.z) < 0) {
      ac.parkingBrake = false;
      return;
    }
    const h = harbourBerth && harbourBerth();
    const spot = waterStart(h && h.x != null ? h : undefined);
    if (spot) onTheWater(sim, spot);
  },

  stop() {
    if (S.fx) S.fx.clear();
  },

  update(sim, dt) {
    if (isFloat(sim) && !sim.vehicle) sprayAndWake(sim, dt);
    else if (S.fx && !S.fx.idle) S.fx.update(dt);
  },
});
