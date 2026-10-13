/**
 * Putting the player's aircraft somewhere else, safely — what the owner's
 * teleport (./teleport.js), "Bring here" / "Go there" (./trolls.js) and
 * taking an aircraft over all do.
 *
 * In the air the aircraft arrives level, nose on the heading asked for, at a
 * speed it flies at — faster the higher it is put, because the air up there
 * is thin (physics.js has an ISA-ish density): 60 m/s low down, 150 m/s at
 * 50,000 ft, and never slower than it was going. The flight model's own
 * reset() does the placing, so the attitude, the spin and any damage are
 * clean too. On the ground it is stood on its wheels, engine running. The
 * follow camera snaps to it rather than flying the ten kilometres in between.
 *
 * Pure helpers (metres, feet, the map's geometry) are exported for the node
 * test: nothing in them touches the game.
 */

import * as THREE from '../../vendor/three.module.js';
import { heightAt } from '../../world/terrain.js';

/** The owner's ceiling: "maxing at 50,000" feet. */
export const MAX_ALT_FT = 50000;
export const FT = 0.3048;
/** How high above the ground an aircraft put in the air is, at the least. */
export const MIN_AGL_M = 60;

export const ftToM = (ft) => ft * FT;
export const mToFt = (m) => m / FT;

/** The altitude picker's number, clamped to what it offers: whole hundreds of feet from 0 to 50,000. */
export function clampAltFt(ft) {
  const n = Number(ft);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_ALT_FT, Math.round(n / 100) * 100));
}

/**
 * A speed to arrive at, metres a second: 60 near the ground, 150 at the top of
 * the owner's sky, and never slower than `now` (the speed it had).
 */
export function saneSpeed(altM, now = 0) {
  const k = Math.max(0, Math.min(1, altM / ftToM(MAX_ALT_FT)));
  return Math.max(60 + 90 * k, Number.isFinite(now) ? now : 0);
}

/**
 * A point on the minimap's canvas → a place in the world. The minimap is
 * north-up and centred on the craft (ui/minimap.js: mx = cx + (x - craft.x) k),
 * so the sum is the same backwards. `g` is the map's live geometry
 * ({ cx, cy, k, craft }), `px`/`py` the point in the map's own units (its
 * drawn size, SIZE), the same units cx and cy are in.
 */
export function mapToWorld(g, px, py) {
  if (!g || !g.craft || !(g.k > 0)) return null;
  return { x: g.craft.x + (px - g.cx) / g.k, z: g.craft.z + (py - g.cy) / g.k };
}

/** A click's offset inside the canvas's box (CSS pixels) → the map's own units. */
export function clientToMap(g, offX, offY, cssW, cssH) {
  if (!g || !(cssW > 0) || !(cssH > 0)) return null;
  return { px: (offX / cssW) * g.cx * 2, py: (offY / cssH) * g.cy * 2 };
}

/**
 * Heading in degrees → the unit vector it points along (north is -Z, as the
 * flight model has it), and back.
 */
export function headingVec(deg, out = new THREE.Vector3()) {
  const r = (deg * Math.PI) / 180;
  return out.set(Math.sin(r), 0, -Math.cos(r));
}

/** Where to put somebody "with" another: `back` metres behind them along their heading, and a little to one side. */
export function besideOf(pos, headingDeg, back = 70, side = 25) {
  const f = headingVec(headingDeg);
  return { x: pos.x - f.x * back + -f.z * side, y: pos.y, z: pos.z - f.z * back + f.x * side };
}

/** What counts as land to stand on, metres above the sea. */
const LAND_MIN_M = 1.5;

/** The ground's height, never less than the sea: off the terrain's edge (the heightfield says NaN there) the sea it is. */
export function groundAt(x, z) {
  const h = heightAt(x, z);
  return Number.isFinite(h) ? Math.max(0, h) : 0;
}

/**
 * The nearest land to (x, z) — (x, z) itself when it is land — within `maxR`
 * metres, or null when there is only sea: a ring search outwards, as
 * mpworld.js finds land for a wildfire. An aircraft "teleported to the
 * ground" over the sea is stood on the beach, not ditched.
 */
export function landNearby(x, z, maxR = 8000) {
  const land = (px, pz) => heightAt(px, pz) > LAND_MIN_M;
  if (land(x, z)) return { x, z };
  for (let r = 25; r <= maxR; r += r < 1000 ? 25 : r < 3000 ? 50 : 100) {
    const n = Math.min(160, Math.max(12, Math.round((2 * Math.PI * r) / 40)));
    for (let a = 0; a < n; a++) {
      const ang = (a / n) * Math.PI * 2;
      const px = x + Math.sin(ang) * r;
      const pz = z - Math.cos(ang) * r;
      if (!land(px, pz)) continue;
      const ix = x + Math.sin(ang) * (r + 40);
      const iz = z - Math.cos(ang) * (r + 40);
      return land(ix, iz) ? { x: ix, z: iz } : { x: px, z: pz };
    }
  }
  return null;
}

/**
 * Put the player's aircraft at { x, y, z } on `headingDeg`. `ground: true`
 * stands it on its wheels there instead (on the nearest land, if that is
 * sea); `speed` is what it was doing (kept, if faster than sane). Returns
 * what was done, or null when there is no aircraft to move (a boat, the
 * menus).
 */
export function placeAircraft(sim, { x, z, y = 0, headingDeg = 0, speed = 0, ground = false }) {
  const ac = sim && sim.aircraft;
  if (!ac || typeof ac.reset !== 'function' || sim.mode === 'drive') return null;
  if (![x, z].every((v) => Number.isFinite(v))) return null;
  let terrain = groundAt(x, z);
  const hdg = Number.isFinite(headingDeg) ? ((headingDeg % 360) + 360) % 360 : 0;
  let out;
  if (ground || !(y > terrain + 5)) {
    const spot = landNearby(x, z) || { x, z };
    const moved = spot.x !== x || spot.z !== z;
    x = spot.x;
    z = spot.z;
    terrain = groundAt(x, z);
    const pos = new THREE.Vector3(x, 0, z);
    ac.reset({ pos, headingDeg: hdg, speed: 0, altAGL: null, engineOn: true, gearDown: true });
    ac.controls.throttle = 0;
    if (sim.input) sim.input.throttleTarget = 0;
    out = { x, y: ac.pos.y, z, headingDeg: hdg, speed: 0, ground: true, moved };
  } else {
    const pos = new THREE.Vector3(x, 0, z);
    const alt = Math.max(y, terrain + MIN_AGL_M);
    const v = saneSpeed(alt, speed);
    ac.reset({ pos, headingDeg: hdg, speed: v, altAGL: alt - terrain, engineOn: true, gearDown: false });
    ac.controls.throttle = 0.75;
    ac.parkingBrake = false;
    if (sim.input) {
      sim.input.throttleTarget = 0.75;
      if (sim.input.out) sim.input.out.throttle = 0.75;
    }
    out = { x, y: alt, z, headingDeg: hdg, speed: v, ground: false };
  }
  // The follow camera goes straight there (flight/camera.js: a fresh view snaps rather than easing in).
  if (sim.rig) sim.rig.initialised = false;
  if (sim.autopilot && sim.autopilot.engaged && typeof sim.toggleAutopilot === 'function') sim.toggleAutopilot(false);
  return out;
}
