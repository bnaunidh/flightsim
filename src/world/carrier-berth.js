/**
 * Where the carrier anchors on a map that does not name a berth of its own.
 *
 * "Maps that have no carrier get one placed offshore (deep water, clear of
 * approach lanes, within sight of the island)." So a berth is scored, not
 * just found:
 *
 *   DEEP   the whole deck footprint over water at least 12 m deep (the old
 *          rule, sampled at nine points across 360 x 1500 m);
 *   CLEAR  of every runway's approach lanes — the extended centreline, 900 m
 *          either side, out to 14 km off each end — for every runway the map
 *          has, however many: runway, runway2, runway3 and any `runways`
 *          list a map brings (the maps programme is giving every map three);
 *   ROOM   for the carrier's own pattern: the initial 5.5 km astern, the
 *          downwind 2 km to port and the groove all over the sea, not a
 *          hillside;
 *   SIGHT  4.5 to 9 km from the airfield — far enough to be at sea, near
 *          enough to see from the runway.
 *
 * A map's own `carrier` wins if it is wet, exactly as before. Then the old
 * default, (-5200, 3400), if it passes all four — so every map where the
 * ship already sat happily keeps it where it was. Otherwise a ring search
 * picks the best-scoring spot. Deterministic: the same map always gives the
 * same berth, which is what lets every player in a lobby see the same ship.
 *
 * The ship always points north (heading 0): its landing surface is an axis-
 * aligned box. See src/world/carrier.js.
 */

/** The deck's footprint, metres: matches DECK in carrier.js (72 x 300 x 5). */
const HALF_W = 180;
const HALF_L = 750;

export const BERTH = {
  minDepth: -12,
  laneHalfWidth: 900,
  laneLength: 14000,
  near: 4500,
  far: 9000,
  ideal: 6500,
  legacy: { x: -5200, z: 3400 },
};

/** Every runway the map has, as centre, heading and length. */
export function runwayLanes(airport) {
  const out = [];
  if (!airport) return out;
  const add = (r, hdg) => {
    if (!r || !Number.isFinite(r.cx) || !Number.isFinite(r.cz)) return;
    const h = Number.isFinite(r.headingDeg) ? r.headingDeg : hdg;
    out.push({ cx: r.cx, cz: r.cz, headingDeg: h, length: r.length || 1200 });
  };
  add(airport.runway, Number.isFinite(airport.headingDeg) ? airport.headingDeg : 90);
  add(airport.runway2, 180);
  add(airport.runway3, 90);
  if (Array.isArray(airport.runways)) {
    for (const r of airport.runways) {
      const h = Number.isFinite(r.headingDeg) ? r.headingDeg : 90;
      if (out.some((o) => Math.abs(o.cx - r.cx) < 1 && Math.abs(o.cz - r.cz) < 1 && Math.abs(((o.headingDeg - h) % 180 + 180) % 180) < 1)) continue;
      add(r, 90);
    }
  }
  return out;
}

/** How far inside an approach lane (x, z) is: > 0 means in it, by that many metres. */
export function laneIntrusion(lanes, x, z) {
  let worst = -Infinity;
  for (const l of lanes) {
    const h = (l.headingDeg * Math.PI) / 180;
    const fx = Math.sin(h);
    const fz = -Math.cos(h);
    const dx = x - l.cx;
    const dz = z - l.cz;
    const along = Math.abs(dx * fx + dz * fz);
    const across = Math.abs(dx * fz - dz * fx);
    if (along > l.length / 2 + BERTH.laneLength) continue;
    worst = Math.max(worst, BERTH.laneHalfWidth - across);
  }
  return worst;
}

/** The ship's footprint and pattern, sampled. Heading 0: bow north (-z), port is -x. */
function footprint(x, z) {
  const pts = [];
  for (const fx of [-1, 0, 1]) for (const fz of [-1, 0, 1]) pts.push([x + fx * HALF_W, z + fz * HALF_L]);
  return pts;
}
function patternPts(x, z) {
  return [
    [x, z + HALF_L + 5500], // the initial
    [x, z + HALF_L + 2500],
    [x - 2100, z + 450], // the 180
    [x - 2100, z - 1500],
    [x + 250, z + 1700], // the groove
  ];
}

/**
 * Score a berth: null if it cannot be used, otherwise lower is better.
 * `heightAt(x, z)` is the terrain (negative is sea floor).
 */
export function scoreBerth(x, z, { heightAt, lanes, field }) {
  for (const [px, pz] of footprint(x, z)) if (!(heightAt(px, pz) < BERTH.minDepth)) return null;
  for (const [px, pz] of [[x, z], [x - HALF_W, z - HALF_L], [x + HALF_W, z + HALF_L], [x - HALF_W, z + HALF_L], [x + HALF_W, z - HALF_L]]) {
    if (laneIntrusion(lanes, px, pz) > 0) return null;
  }
  let score = 0;
  for (const [px, pz] of patternPts(x, z)) {
    const h = heightAt(px, pz);
    if (h > 120) return null; // a hill in the pattern
    if (h > 0) score += 1500;
  }
  const d = Math.hypot(x - field.x, z - field.z);
  if (d < BERTH.near - 1500 || d > BERTH.far + 3000) score += 4000;
  score += Math.abs(d - BERTH.ideal);
  return score;
}

/**
 * The berth. `map` may carry `carrier: {x, z}`; `airport` is AIRPORT;
 * `heightAt` the terrain. Returns {x, z, why}.
 */
export function chooseBerth({ map, airport, heightAt }) {
  const wet = (x, z) => footprint(x, z).every(([px, pz]) => heightAt(px, pz) < BERTH.minDepth);
  // A map's own berth is the author's, tested the way it always was (five points down the middle).
  const authoredWet = (x, z) => [[0, 0], [0, -160], [0, 160], [-40, 0], [40, 0]].every(([dx, dz]) => heightAt(x + dx, z + dz) < BERTH.minDepth);
  if (map && map.carrier && authoredWet(map.carrier.x, map.carrier.z)) return { x: map.carrier.x, z: map.carrier.z, why: 'map' };
  const lanes = runwayLanes(airport);
  const r = airport && airport.runway;
  const field = { x: r ? r.cx : 0, z: r ? r.cz : 0 };
  const ctx = { heightAt, lanes, field };
  const L = BERTH.legacy;
  const legacy = scoreBerth(L.x, L.z, ctx);
  if (legacy != null && Math.hypot(L.x - field.x, L.z - field.z) <= BERTH.far + 1000) return { x: L.x, z: L.z, why: 'legacy' };
  let best = null;
  for (let rad = 3000; rad <= 14000; rad += 500) {
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const x = Math.round(field.x + Math.cos(a) * rad);
      const z = Math.round(field.z + Math.sin(a) * rad);
      const s = scoreBerth(x, z, ctx);
      if (s != null && (!best || s < best.s)) best = { x, z, s };
    }
    // Good enough and close: stop looking further out.
    if (best && best.s < 1500 && rad > BERTH.ideal) break;
  }
  if (best) return { x: best.x, z: best.z, why: 'search' };
  // Nothing passes every test: fall back to the old ring walk for deep water alone.
  if (wet(L.x, L.z)) return { x: L.x, z: L.z, why: 'legacy-wet' };
  for (let rad = 4000; rad <= 14000; rad += 1200) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const x = Math.cos(a) * rad;
      const z = Math.sin(a) * rad;
      if (wet(x, z)) return { x: Math.round(x), z: Math.round(z), why: 'wet' };
    }
  }
  return { x: L.x, z: L.z, why: 'none' };
}
