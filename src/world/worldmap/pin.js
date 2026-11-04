/**
 * World Map — the pin: start anywhere on the sea, not only at a field.
 *
 * The owner, 2026-11-03: "you can choose where u wanna be, like drop a pin and
 * youll spawn there". This is the arithmetic: where a pin may go, what is near
 * it, and the start it gives. The map you drop it on is features/wm-pin.js;
 * the start itself is features/world-preview.js (startAtPin).
 *
 * A pin on or right by a field is that field: its normal start, nothing new.
 * Anywhere else you start in the air with the gear up, level, flying at a
 * speed the type likes, clear of the highest ground round the pin and along
 * the way, with the nose on the nearest field that can take you.
 *
 * Past the sea is worldmap/pin-far.js: the ring is not loaded until the World
 * Map is asked for, and this file loads with the features.
 *
 * Pure: no meshes, no DOM. heightAt is passed in, because on the menu the map
 * loaded is usually not this one.
 */

import { PREVIEW, AIRPORTS, nearestAirport, headingTo, seaBox } from './preview.js';

export const PIN = Object.freeze({
  /** A pin stays this far inside the sea's square. */
  insetM: 4000,
  /** Past a runway's end, how near still counts as being at the field. */
  fieldM: 1000,
  /** Over the highest ground in reach: aeroplane, then helicopter. */
  clearM: 450,
  clearRotorM: 150,
  /** How far round the pin and along the way that ground is looked for. */
  reachM: 4000,
  aheadM: 10000,
  reachRotorM: 1500,
  aheadRotorM: 3000,
  /** The ground did not load in time (world-preview.js): this much higher, so nothing empty is close. */
  fallbackM: 600,
  /** Stall speed times this, never slower than minMs. A helicopter flies at rotorMs. */
  stallK: 1.5,
  minMs: 45,
  rotorMs: 25,
  /** The runway a big jet (world/spawns.js isBigJet) is sent to: it has to land there. */
  bigJetM: 2500,
  /** The ground lever, and the wait for a world that never came. */
  throttle: 0.7,
  buildCapMs: 90000,
});

/** Inside the sea, whatever was tapped. (With the ring loaded, pin-far.js clampFar.) */
export function clampPin(x, z) {
  const b = seaBox();
  const m = PIN.insetM;
  return { x: Math.min(b.x1 - m, Math.max(b.x0 + m, x)), z: Math.min(b.z1 - m, Math.max(b.z0 + m, z)) };
}

/** The field a pin is on or right by, or null. */
export function fieldAt(x, z) {
  const { airport: a, distM } = nearestAirport(x, z);
  return distM <= a.length / 2 + PIN.fieldM ? a : null;
}

/**
 * The field to fly to: the nearest one `fits` allows (an A380 is not sent to a
 * 580 m strip), or the nearest of all when none does.
 */
export function goalFor(x, z, fits = () => true) {
  let best = null;
  let bd = Infinity;
  for (const a of AIRPORTS) {
    const d = Math.hypot(a.x - x, a.z - z);
    if (d < bd && fits(a)) { bd = d; best = a; }
  }
  return best || nearestAirport(x, z).airport;
}

/** The highest ground round (x, z) and along `headingDeg`, never below the sea. */
export function highestNear(heightAt, x, z, headingDeg, reachM, aheadM) {
  let top = 0;
  const at = (px, pz) => {
    const h = heightAt(px, pz);
    if (h > top) top = h;
  };
  at(x, z);
  for (let r = 250; r <= reachM; r += 250) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + r;
      at(x + Math.sin(a) * r, z + Math.cos(a) * r);
    }
  }
  const h = (headingDeg * Math.PI) / 180;
  for (let d = 200; d <= aheadM; d += 200) at(x + Math.sin(h) * d, z - Math.cos(h) * d);
  return top;
}

/** Metres a second through the air at height y: thin air wants more of it for the same wing (e^(-y / 8500) is physics.js's density). */
export function pinSpeed(y, rotor, stallMs) {
  return rotor ? PIN.rotorMs : Math.max(PIN.minMs, stallMs * PIN.stallK) * Math.exp(y / 17000);
}

/**
 * The start a pin gives: { x, y, z, headingDeg, speed, throttle }.
 * y is a height above the sea (the sea bed is below 0, so not above the ground).
 */
export function pinStart(heightAt, pin, goal, { rotor = false, stallMs = 30 } = {}) {
  const headingDeg = headingTo(pin.x, pin.z, goal.x, goal.z);
  const top = highestNear(heightAt, pin.x, pin.z, headingDeg, rotor ? PIN.reachRotorM : PIN.reachM, rotor ? PIN.aheadRotorM : PIN.aheadM);
  const y = top + (rotor ? PIN.clearRotorM : PIN.clearM);
  return {
    x: pin.x,
    z: pin.z,
    y,
    headingDeg,
    speed: pinSpeed(y, rotor, stallMs),
    throttle: PIN.throttle,
  };
}

/** Land or sea with no height field to ask (no worker): the islands' own circles. */
export function roughHeightAt(x, z) {
  for (const i of PREVIEW.islands) if (Math.hypot(x - i.cx, z - i.cz) < i.radius * 0.9) return 20;
  return -40;
}

function km(m) {
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

/**
 * What a pin is, in words. `h` is the ground's height there, or null when not
 * known yet, and `zone` the part of the ring it is in (pin-far.js zoneOf), or
 * null at sea: { field, near, distM, title, where, note, short }.
 */
export function pinWords(x, z, h = null, zone = null) {
  const { airport: a, distM } = nearestAirport(x, z);
  const at = fieldAt(x, z);
  const where = zone || (h == null ? 'Checking the ground…' : h > 0.5 ? 'Over land' : 'Over the sea');
  if (at) {
    return { field: at, near: at, distM, title: `${at.code} ${at.name}`, where: 'On the field', note: 'You start here the usual way.', short: `at ${at.code} ${at.name}` };
  }
  return {
    field: null,
    near: a,
    distM,
    title: `${km(distM)} from ${a.code} ${a.name}`,
    where,
    note: zone
      ? 'You start in the air if your aircraft can get that high. If not, you start at the nearest place it can: a canyon, a pass or low ground.'
      : 'You start in the air, heading for the nearest field that suits your aircraft.',
    short: `${km(distM)} from ${a.code}${zone ? `, ${zone}` : h == null ? '' : `, ${where.toLowerCase()}`}`,
  };
}
