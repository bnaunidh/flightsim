/**
 * World Map — a pin past the sea: over the Border Range and the Farlands, up
 * to just short of the torn edge. The owner said yes, 2026-11-03.
 *
 * pin.js is the sea's sums and loads with the features; this file imports the
 * ring (worldmap/farlands.js), so it loads with the ring: features/farlands-run.js
 * and the pin's map, never before the World Map is asked for.
 *
 * The trouble is the peaks. They reach about 10.3 km, so "450 m over the
 * highest ground in reach" asks a Skylark to fly at 10.7 km. So a start is
 * chosen per aircraft, in this order, stopping at the first that fits under
 * what the type can hold (holdM):
 *   1. at the pin, over everything in reach, nose on the goal, as at sea;
 *   2. at the pin, lower, on whichever heading has a clear run;
 *   3. the nearest place that has one: a slot canyon or a pass (farlands.js
 *      CUTS, nose along it towards the sea), or low ground near the pin.
 * The cuts reach the coast at sea level, so 3 always finds somewhere, and the
 * coast end of one suits anything that flies. The goal stays the nearest field
 * (a run out here still wants a way home), and 3 says that the pin moved.
 *
 * Pure: no meshes, no DOM. heightAt is passed in, as in pin.js.
 */
import { CUTS, CHART_HALF, EDGE_D, RANGE_DEEP, SEA_HALF, TEAR, cutCentre, depthOf, edgeAt, wanderOf } from './farlands.js';
import { pinSpeed, pinStart } from './pin.js';

export const FAR_PIN = Object.freeze({
  /** A pin stops this far short of the land's end. */
  edgeM: 3000,
  /** The share of the service ceiling a type holds level from a standing start: an aeroplane, then a helicopter (their lift goes first). */
  holdK: 0.85,
  holdRotorK: 0.62,
  /** Over the ground of a run, aeroplane then helicopter. A canyon's floor is flat, and its walls are the walls. */
  clearM: 300,
  clearRotorM: 150,
  /** The clear run ahead, and how much room it needs either side and all round the start. */
  runM: 6000,
  runRotorM: 2500,
  laneM: 120,
  roomM: 500,
  /** How far round the pin low ground is looked for. Further than this, the cuts' own lines do it. */
  searchM: 30000,
});

/** Is there land here to pin, or sea, and not the void or its lip? */
function pinnable(x, z) {
  if (depthOf(x, z) < 0) return true;
  return wanderOf(x, z) < edgeAt(x, z) - FAR_PIN.edgeM;
}

/** Anywhere on the map, whatever was tapped: a tap in the void comes back along the line to the middle. */
export function clampFar(x, z) {
  const k = Math.min(1, CHART_HALF / Math.max(Math.abs(x), Math.abs(z), 1));
  const r0 = Math.hypot(x * k, z * k);
  const ux = (x * k) / (r0 || 1);
  const uz = (z * k) / (r0 || 1);
  for (let r = r0; r > 0; r -= 250) if (pinnable(ux * r, uz * r)) return { x: ux * r, z: uz * r };
  return { x: 0, z: 0 };
}

/**
 * The ring's names that fit the pin's map: on a small screen the ones along the
 * middle run into each other and the fields' codes. Each is { name, x, y, w } in
 * pixels, centred at (x, y); `taken` is what is already there, and a name that
 * overlaps it, an earlier name or the map's edge is left off.
 */
export function namesThatFit(names, W, H, taken = []) {
  const box = (b) => [b.x - b.w / 2 - 3, b.x + b.w / 2 + 3, b.y - 8, b.y + 8];
  const hits = (a, b) => a[0] < b[1] && b[0] < a[1] && a[2] < b[3] && b[2] < a[3];
  const used = taken.map(box);
  const out = [];
  for (const n of names) {
    const b = box(n);
    if (b[0] < 0 || b[1] > W || b[2] < 0 || b[3] > H || used.some((u) => hits(b, u))) continue;
    used.push(b);
    out.push(n);
  }
  return out;
}

/** The name of the zone a pin is in, or null at sea (the pin's readout). */
export function zoneOf(x, z) {
  const D = wanderOf(x, z);
  if (D < 0) return null;
  if (D < RANGE_DEEP) return 'The Border Range';
  return edgeAt(x, z) - D < 8000 ? 'The Edge' : 'The Farlands';
}

/** What this type can hold, metres. No published ceiling: a safe guess. */
export function holdM(ceilingM, rotor) {
  return (ceilingM > 0 ? ceilingM : 4000) * (rotor ? FAR_PIN.holdRotorK : FAR_PIN.holdK);
}

/** Every cut's centre line, a point a kilometre, from the coast out. Worked out once: { x, z, D, inward heading }. */
let LINES = null;
function cutLines() {
  if (LINES) return LINES;
  LINES = [];
  const out = { east: [1, 0], west: [-1, 0], north: [0, -1], south: [0, 1] };
  for (const side of Object.keys(CUTS)) {
    const [ox, oz] = out[side];
    for (const c of CUTS[side]) {
      const line = [];
      for (let t = 1000; t < EDGE_D + TEAR; t += 1000) {
        // The centre is across the side at the wandering D, and D depends on where you are: three rounds settle it.
        const u = SEA_HALF + t;
        let v = c.at;
        let D = t;
        for (let i = 0; i < 3; i++) {
          D = wanderOf(ox ? ox * u : v, oz ? oz * u : v);
          v = cutCentre(c, D);
        }
        const x = ox ? ox * u : v;
        const z = oz ? oz * u : v;
        if (!pinnable(x, z)) break;
        line.push({ x, z, D });
      }
      for (let i = 1; i < line.length; i++) {
        const a = line[i];
        const b = line[i - 1];
        a.toSea = (Math.atan2(b.x - a.x, a.z - b.z) * 180) / Math.PI;
      }
      line[0].toSea = line[1] ? line[1].toSea : 0;
      LINES.push(...line);
    }
  }
  return LINES;
}

/** The highest ground of a run from (x, z) on this heading, or null if it goes over `most` or over the void. */
function runTop(heightAt, x, z, headingDeg, runM, most) {
  const { laneM, roomM } = FAR_PIN;
  const h = (headingDeg * Math.PI) / 180;
  const sx = Math.sin(h);
  const cz = -Math.cos(h);
  let top = 0;
  const at = (px, pz) => {
    const g = heightAt(px, pz);
    if (g > top) top = g;
    return g > most || g < -99;
  };
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    if (at(x + Math.sin(a) * roomM, z + Math.cos(a) * roomM)) return null;
  }
  for (let d = 0; d <= runM; d += 100) {
    const px = x + sx * d;
    const pz = z + cz * d;
    if (at(px, pz) || at(px - cz * laneM, pz + sx * laneM) || at(px + cz * laneM, pz - sx * laneM)) return null;
  }
  return top;
}

const off = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/** Twelve headings, the nearest the goal's first. */
function headingsFrom(headingDeg) {
  const all = [];
  for (let i = 0; i < 12; i++) all.push((headingDeg + i * 30) % 360);
  return all.sort((a, b) => off(a, headingDeg) - off(b, headingDeg));
}

/**
 * The start a pin gives this aircraft, past the sea or anywhere near it: what
 * pinStart gives, and { pin, movedM, where, limitM }. `where` is null at the
 * pin, else 'canyon', 'pass' or 'low ground'.
 */
export function farStart(heightAt, pin, goal, { rotor = false, stallMs = 30, ceilingM = 0 } = {}) {
  const limitM = holdM(ceilingM, rotor);
  const direct = pinStart(heightAt, pin, goal, { rotor, stallMs });
  const done = (o) => ({ ...direct, ...o, limitM });
  if (direct.y <= limitM) return done({ pin, movedM: 0, where: null });
  const clear = rotor ? FAR_PIN.clearRotorM : FAR_PIN.clearM;
  const runM = rotor ? FAR_PIN.runRotorM : FAR_PIN.runM;
  const most = limitM - clear;
  const tryAt = (s) => {
    const g = heightAt(s.x, s.z);
    if (g > most || g < -99) return null;
    for (const headingDeg of s.heads) {
      const top = runTop(heightAt, s.x, s.z, headingDeg, runM, most);
      if (top != null) {
        const y = top + clear;
        return done({ x: s.x, z: s.z, y, headingDeg: (headingDeg + 360) % 360, speed: pinSpeed(y, rotor, stallMs), pin, movedM: s.d, where: s.where });
      }
    }
    return null;
  };
  const here = tryAt({ x: pin.x, z: pin.z, d: 0, where: null, heads: headingsFrom(direct.headingDeg) });
  if (here) return here;
  const spots = [];
  for (const p of cutLines()) spots.push({ x: p.x, z: p.z, d: Math.hypot(p.x - pin.x, p.z - pin.z), where: p.D < RANGE_DEEP ? 'pass' : 'canyon', heads: [p.toSea, p.toSea + 180] });
  for (let r = 1000; r <= FAR_PIN.searchM; r += 1000) {
    const n = Math.ceil((Math.PI * 2 * r) / 1500);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = pin.x + Math.sin(a) * r;
      const z = pin.z + Math.cos(a) * r;
      if (pinnable(x, z)) spots.push({ x, z, d: r, where: 'low ground', heads: null });
    }
  }
  spots.sort((a, b) => a.d - b.d);
  for (const s of spots) {
    if (!s.heads) s.heads = headingsFrom(direct.headingDeg);
    const got = tryAt(s);
    if (got) return got;
  }
  return done({ y: limitM, pin, movedM: 0, where: null });
}
