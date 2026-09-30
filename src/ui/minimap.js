/**
 * The minimap — four games, four maps.
 *
 * A map you can glance at without leaving the cockpit: the islands drawn from
 * the same data the terrain is generated from, the runway where the runway
 * actually is, you in the middle, and anything that matters marked on it.
 *
 * Two rules it is built around:
 *
 *   North is up, always. A map that spins with you is easier to *follow* and
 *   much harder to *learn* — you never build a picture of the place, because
 *   the place never looks the same twice. The aeroplane rotates instead.
 *
 *   It warns you. If you are descending towards ground you cannot see, the
 *   ring around the edge goes red and says so, because "I did not know the
 *   hill was there" is the commonest way a flight ends badly.
 *
 * ====================================================================
 * WHY THIS FILE GREW
 * ====================================================================
 *
 * The aviation chart is a good chart for an aeroplane and a bad one for
 * everything else, because the thing it draws — relief, shaded from the
 * north-west, with the runway on it — is the answer to the aeroplane's
 * question and to nobody else's.
 *
 *   A BOAT does not care how high the hill is. It cares how much water is
 *   under the keel, and there is no way to read that off a green blob: the
 *   sea is an opaque plane at y=0 and everything that will stop the boat is
 *   under it. So the boat gets a real chart — depth bands, a safety contour
 *   at two metres, the drying rocks, the dredged channel and the buoyage.
 *
 *   A CAR cares about exactly one thing the aviation chart does not draw at
 *   all: which strips of this island a van can be driven along. Relief on a
 *   road map is scenery. So the relief is washed back to a parchment and the
 *   road corridors, the junctions, the yards and the address are drawn on top
 *   of it — a road map, with the land faded out behind the roads.
 *
 *   A HELICOPTER cares about the pads, and about them from further away than
 *   they are visible, because the whole game is finding one. So the relief
 *   stays (a helicopter flies at two hundred feet and the hills are real) and
 *   every pad on the map is marked, with an arrow on the bezel for the ones
 *   that are off the edge.
 *
 * ====================================================================
 * "THE MINI MAP IS BROKEN" — WHAT WAS ACTUALLY WRONG (2026-09-23)
 * ====================================================================
 *
 * Found by reading this file end to end and then driving it, headless, in a
 * flight, a boat trip and a car job. Each is fixed below where it happened.
 *
 *  1. It flashed red "TERRAIN — 4s" on every single landing. The look-ahead
 *     flagged any point of the path below ground + 45 m, and a descent to a
 *     runway is exactly that. Measured on a normal approach to Kestrel 09:
 *     red from 580 ft, and solid for the last 25 seconds to touchdown; then,
 *     floating along the runway in the flare, it called the hill beyond the
 *     far end. A warning that is always on reads as a broken map. It now
 *     looks for RISING ground, measures heights to the water rather than to
 *     the sea floor (heightAt at sea is the bottom, 34 m down on Kestrel),
 *     ignores airfields, decks and pads, and wants less clearance close to a
 *     runway than out in the hills — `aircraftLookahead` below, the same
 *     function the cockpit warning panel uses, so the two never disagree.
 *  2. In a boat or a van the objective was never on it. main.js only copies
 *     the mission's target to `sim.activeTarget` in the flight branch of the
 *     frame; the drive branch returns before that line. Measured: First Run,
 *     "the town" 1.1 km away, activeTarget null — the map said "DEPOT 0.0 km"
 *     while the job said go to town. Worse, whatever the LAST FLIGHT was
 *     aiming at stayed there. It asks the mission runner itself now.
 *  3. The distance along the bottom and the scale label were drawn on top of
 *     each other in all three new modes: the label is DOM at bottom 12 px, the
 *     footer is canvas at 170–182 px, and they share six pixels. The scale is
 *     drawn on the canvas now, where the layout is in one place.
 *  4. At the 24 km zoom the blit asks for pixels outside the chart image as
 *     soon as you are 2.4 km from the middle of Kestrel. The current spec
 *     says clip, and Chrome does; drawImage has not always behaved that way
 *     everywhere (it used to throw in some engines), and there is no iPad
 *     here to prove Safari. So the source rectangle is clipped by hand, which
 *     is correct in every browser rather than in the one I could test.
 *  5. The second runway — 18/36, on every map, the one ATC sends you to in a
 *     crosswind — was not on it. Nor was the carrier.
 *  6. Other aircraft were yellow dots, the same yellow as the courier's
 *     addresses, with no heading and no height. They are aircraft shapes now,
 *     pointing where they fly, amber or red when the collision-avoidance
 *     system says so, with how far above or below you they are.
 *  7. An objective off the edge of the map simply was not there. It gets an
 *     arrow on the rim, like the helicopter's pads always did — and in the
 *     aeroplane with nothing to aim at, the airfield does.
 *  8. On an iPad the map is drawn at 118 px, and on a phone at 84, so every
 *     label drawn for 190 came out at 5 px or 3.5 px. Text and symbols are
 *     scaled back up by however much the map has been shrunk.
 *  9. Reversing the van, the track line and the warning looked forwards.
 * 10. Any bad entry in `sim.traffic` (somebody else's module) would have
 *     thrown inside the frame and taken the whole game to its error screen.
 *     The map catches its own errors now and logs them once.
 * 11. At the van's closest zoom the map was eighteen chart pixels stretched
 *     across 190 — blocks. The van gets a sharper sliding window like the
 *     boat's (see windowChart).
 * 12. It sat on the front page. main.js ticks it every frame, menus
 *     included, and the menu layer is a see-through gradient, so the main
 *     menu, the mission list and every debrief card had a dark disc in the
 *     corner with the last flight frozen in it. It is only on screen while
 *     something is being flown or driven now (`_apply`).
 * 13. Free driving's discoveries never reached it. jobs.js calls
 *     `minimap.setLabels()` when you find a place — "writes its name on the
 *     minimap" — and this file had no such method, so the name was never
 *     written. See drawDiscoveries.
 * 14. Building the chart took 3.8 ms a frame here for the first second of
 *     every flight (20 rows of 512 height samples at 0.37 µs), which on a
 *     2019 Chromebook is most of a 30 fps frame. It has a time budget now.
 * 15. The mayday escorts are `{ pos }` in sim.traffic with no heading, so they
 *     all pointed north while they circled you. A heading worked out from how
 *     they move is used whenever they are moving.
 *
 * And it stopped writing to the DOM every frame when nothing had changed.
 *
 * Found by the reviewer of the first pass, fixed in the second:
 *
 * 16. On a free drive a courier address kept its name beside its own "?", so
 *     "Weather Station" was printed next to the question mark meant to hide
 *     it. The discovery markers speak for those places now (drawCar).
 * 17. The footer greeted every free drive with "DEPOT 0.0 km". It says AT
 *     THE DEPOT there, and otherwise how far the nearest place still to find
 *     is — SOMEWHERE NEW 1.2 km — with a rim arrow when it is off the map.
 * 18. Traffic colours and headings were remembered per sim.traffic entry
 *     OBJECT. A feed that builds new entries every frame would never have
 *     been coloured amber or red. By `id` now, where there is one.
 * 19. The last per-frame allocations: dash and symbol arrays, a sort
 *     comparator, the boat's look-ahead object, a runway array per
 *     look-ahead sample, and a tint closure and eight arrays per chart slice.
 *
 * ====================================================================
 * WHAT IT COSTS
 * ====================================================================
 *
 * The chart underneath is SAMPLED, not drawn: one `heightAt` per pixel of a
 * 512² offscreen canvas, a few rows a frame, once per map. Panning it is then
 * one `drawImage` however far you fly. Everything a mode draws on top is
 * vector work over a handful of objects, and it is batched into as few
 * fill/stroke calls as the shapes allow — all the red buoys are one path and
 * one fill, all the pad rings are one path and one stroke. Measured counts
 * per mode are in the report that came with this file.
 *
 * Two tile KINDS exist, not four: 'relief' (flight, car, helicopter) and
 * 'bathy' (boat). The van and the helicopter re-use the aeroplane's relief and
 * modify it with a single translucent rectangle, which costs one draw call
 * and no sampling at all. Close in, every mode draws from a WINDOW that
 * follows it — 12 km at 23 m a pixel — rather than from the picture of the
 * whole map at 56, for the measured reasons set out at "WHY THE BOAT CHART IS
 * NOT THE WHOLE MAP" below and at windowChart; zoomed out, the aeroplane, the
 * helicopter and the van use the whole-map picture, which is built in the
 * background once the window is done. Windows are double-buffered, so a
 * re-centre happens behind a chart that is already on screen, and building
 * any chart has a time budget per frame (Chart.slice).
 *
 * The map redraws at most thirty times a second, whatever the screen does.
 *
 * ====================================================================
 * WHAT THIS FILE DOES NOT OWN
 * ====================================================================
 *
 * The road network. `MAP.waters.roads` exists and is real on Kestrel; the
 * three car maps (drovers, cape, cullen) carry a `courier` block and NO
 * roads, because the router that joins those places up is somebody else's
 * drop. This file therefore:
 *
 *   - reads `MAP.waters.roads` when it is there, and draws the corridors and
 *     the junctions it can work out from them;
 *   - reads `sim.roads` DYNAMICALLY — never as a static import — when the
 *     router lands, exactly the way `game/jobs.js` line 316 already does;
 *   - draws the courier places and the depot either way, so the car map is
 *     useful on a map with no roads in it at all.
 *
 * The signature it wants, when the road specialist writes it, is written out
 * in `roadsOf()` below. A static import of a name that does not exist yet
 * fails at module link time and takes the whole game down with it, so there
 * is not one in this file.
 */

/*
 * Everything imported here has been checked to exist as a named export of the
 * file it is taken from, in the tree, today:
 *
 *   terrain.js  ISLANDS AIRPORT MAP PALETTE FLATS heightAt depthUnderKeel
 *               channelMarks dryingShoals harbourBerth harbourMouth
 *   pads.js     PADS nearestPad
 *
 * `shoalHeight` is NOT among them — it is a module-private function in
 * terrain.js and importing it would not link. It does not need to be: it is
 * folded into `heightAt` by `applyWaters`, so every depth this file reads
 * already has the shoals, the channel and the harbour in it.
 */
import {
  ISLANDS,
  AIRPORT,
  MAP,
  PALETTE,
  FLATS,
  PLATFORMS,
  heightAt,
  depthUnderKeel,
  channelMarks,
  dryingShoals,
  harbourBerth,
  harbourMouth,
  padWeight,
  platformAt,
} from '../world/terrain.js';
import { PADS, nearestPad } from '../world/pads.js';
import { SPEC } from '../aircraft/physics.js';

const SIZE = 190;
const FONT = '"Helvetica Neue", Arial, sans-serif';

/*
 * Dash patterns and symbol lists, made once. setLineDash([5, 4]) in a draw
 * routine is a new array every frame it runs, thirty times a second; these
 * were the last of the minimap's per-frame allocations (the reviewer's list).
 */
const DASH_NONE = [];
const DASH_CHANNEL = [5, 4];
const DASH_ROCK = [2, 3];
const DASH_ROAD = [4, 5];
const DASH_UNFOUND = [2, 2];
const DASH_TRACK = [3, 3];
const BUOY_KINDS = ['port', 'starboard', 'fairway'];
const PAD_ROLES = ['pad', 'hospital'];

/* ------------------------------------------------------------------ */
/* Looking ahead — shared with the cockpit warnings                    */
/* ------------------------------------------------------------------ */

/*
 * These live here, not in the warnings feature, on purpose: main.js imports
 * this file directly, so it has to link even on a day the feature does not.
 * The feature imports them from here; the dependency points the safe way.
 */

/**
 * Seconds until the straight-line path ahead meets RISING ground, or Infinity.
 *
 * The old test flagged any point of the path lower than the ground plus 45 m,
 * and a descent to a runway is exactly that — see bug 1 in the header. Real
 * terrain awareness ignores the runway you are landing on and the ground you
 * are simply descending towards; it looks for ground higher than the ground
 * you are over. So:
 *
 *   - a sample only counts if the ground there is `rise` metres higher than
 *     the ground under you now (a hill, a cliff, a ridge — not the sea);
 *   - and only if the path will pass within `floor` metres of it;
 *   - samples on an airfield, a deck or a pad are skipped (`exclude`);
 *   - and if the whole path stays above the highest ground on the map, not
 *     one height sample is taken — the bounding-box reject.
 *
 * p = { x, y, z, vx, vy, vz, headingDeg }, world metres and m/s.
 */
export function terrainConflict(p, o) {
  const hAt = o.heightAt || heightAt;
  const horizon = o.horizon || 30;
  const step = o.step || 1.5;
  const floor = o.floor == null ? 45 : o.floor;
  const rise = o.rise == null ? 25 : o.rise;
  const maxTerrain = o.maxTerrain == null ? Infinity : o.maxTerrain;
  const minSpeed = o.minSpeed || 20;
  const vy = Number.isFinite(p.vy) ? p.vy : 0;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return Infinity;
  if (p.y + Math.min(0, vy) * horizon > maxTerrain + floor) return Infinity;
  const vx = p.vx || 0;
  const vz = p.vz || 0;
  let sp = Math.hypot(vx, vz);
  let dx;
  let dz;
  if (sp >= minSpeed) {
    dx = vx / sp;
    dz = vz / sp;
  } else {
    const h = ((p.headingDeg || 0) * Math.PI) / 180;
    dx = Math.sin(h);
    dz = -Math.cos(h);
    sp = minSpeed;
  }
  // Heights are measured to the SURFACE: over the sea heightAt is the sea
  // floor, thirty-odd metres down, and a sandbank rising from it is not a hill.
  const hNow = Math.max(0, hAt(p.x, p.z));
  for (let s = step; s <= horizon + 1e-6; s += step) {
    const py = p.y + vy * s;
    if (py > maxTerrain + floor) {
      if (vy >= 0) break; // climbing clear of everything from here on
      continue;
    }
    const px = p.x + dx * sp * s;
    const pz = p.z + dz * sp * s;
    if (o.exclude && o.exclude(px, pz)) continue;
    const h = Math.max(0, hAt(px, pz));
    if (h <= hNow + rise) continue;
    // The clearance wanted where the ground IS, not where you are.
    const f = o.floorAt ? o.floorAt(px, pz, floor) : floor;
    if (py < h + f) return s;
  }
  return Infinity;
}

/** The options a caller did not give, shared, so a call allocates nothing. */
const NO_OPTS = Object.freeze({});

/**
 * Seconds until the boat's track runs into water too shallow for her, or
 * Infinity. The same numbers the map always used — ninety seconds ahead, a
 * floor under the speed so that at one knot the warning still comes before
 * the bang, "shallow" meaning under 0.4 m beneath the keel — but going
 * astern it looks astern.
 *
 * p = { x, z, headingDeg, speed (signed), draught }
 */
export function shoalConflict(p, o = NO_OPTS) {
  const depth = o.depthUnderKeel || depthUnderKeel;
  const horizon = o.horizon || 90;
  const step = o.step || 3;
  const limit = o.limit == null ? 0.4 : o.limit;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return Infinity;
  const back = (p.speed || 0) < -0.2;
  const spd = Math.max(o.minSpeed || 2.5, Math.abs(p.speed || 0));
  const h = (((p.headingDeg || 0) + (back ? 180 : 0)) * Math.PI) / 180;
  const dx = Math.sin(h);
  const dz = -Math.cos(h);
  for (let s = step; s <= horizon + 1e-6; s += step) {
    if (depth(p.x + dx * spd * s, p.z + dz * spd * s, p.draught || 1) < limit) return s;
  }
  return Infinity;
}

/**
 * Somewhere you are MEANT to put an aircraft down, so the look-ahead does
 * not count it as terrain: the airfield's levelled plateau, a deck, a pad.
 */
export function onLandingGround(x, z) {
  // The airfield's plateau AND the graded ramp around it (the blend band,
  // where padWeight is between 0 and 1): that is earthworks, not a hill.
  if (padWeight(x, z) > 0) return true;
  if (platformAt(x, z)) return true;
  for (let i = 0; i < PADS.length; i++) {
    const p = PADS[i].pos;
    const dx = p.x - x;
    const dz = p.z - z;
    if (dx * dx + dz * dz < 8100) return true; // 90 m
  }
  return false;
}

/*
 * The highest the ground can be on this map, for the bounding-box reject.
 *
 * Measured over all thirty-two maps (heightAt on a 71x71 grid over every
 * island): the highest point is at most 1.44 times the tallest island's
 * `peak` (Skerries and Desert Run), so 1.6 times plus the field elevation
 * plus 80 m clears every map with room to spare.
 */
let ceilingFor = null;
let ceilingValue = Infinity;
export function terrainCeiling() {
  const id = MAP && MAP.id;
  if (ceilingFor === id) return ceilingValue;
  let peak = 0;
  for (const isl of ISLANDS || []) peak = Math.max(peak, isl.peak || 0);
  ceilingValue = Math.max(150, peak * 1.6 + ((AIRPORT && AIRPORT.elev) || 0) + 80);
  ceilingFor = id;
  return ceilingValue;
}

/**
 * How close to a runway end you are, along its extended centreline, as a
 * fraction of five kilometres: 0 at the threshold, 1 at 5 km or anywhere off
 * the centreline or pointing across it.
 *
 * Why it exists. Measured on Kestrel 09 (heightAt along the centreline): the
 * ground 1,300 to 850 m short of the runway is a ridge 43–47 m high, thirty
 * metres above the runway, and the PAPI's own three-degree path to the
 * touchdown point crosses it with 0 to 4 m to spare — and 3.6 m UNDER it at
 * 850 m, where the ridge meets the graded ramp down to the runway. The
 * approach corridor in terrain.js allows ground to rise at 0.12 from the
 * threshold, which is steeper than any glide path. So any clearance floor
 * that means something out in the hills — 45 m — says TERRAIN on every
 * approach to the main runway of the default map. Real terrain awareness has
 * the same problem near runways and the same answer: on the centreline the
 * floor shrinks with distance to the runway, until close in it warns only if
 * the path actually meets the ground. Which on Kestrel, at exactly three
 * degrees, it does — see the report; that is the map's to fix, not this.
 */
export function runwayProximity(x, z, headingDeg) {
  let best = 1;
  for (let i = 0; i < 2; i++) {
    // Picked, not put in an array: this runs once per look-ahead sample.
    const R = AIRPORT ? (i === 0 ? AIRPORT.runway : AIRPORT.runway2) : null;
    if (!R) continue;
    const alongX = i === 0 || Math.abs(((R.headingDeg ?? 180) % 180) - 90) < 45;
    const along = alongX ? x - R.cx : z - R.cz; // along the runway axis
    const lat = alongX ? z - R.cz : x - R.cx;
    if (Math.abs(lat) > 450) continue;
    const beyond = Math.abs(along) - R.length / 2; // metres past the nearer end
    if (beyond > 5000) continue;
    // Pointing along the axis, either way — arriving or departing.
    const axis = alongX ? 90 : 0;
    const off = Math.abs(((((headingDeg - axis) % 180) + 270) % 180) - 90);
    if (off > 35) continue;
    best = Math.min(best, Math.max(0, beyond) / 5000);
  }
  return best;
}

/*
 * The clearance wanted over a piece of ground: the full floor out in the
 * hills, shrinking towards three metres as that ground gets close to a runway
 * end on its centreline (aeroplane) or to a helipad (helicopter). Evaluated at
 * the SAMPLE, because it is the ground's distance from the runway that makes
 * it part of an approach, not yours — measured, scaling by the aircraft's own
 * distance put a correct 3.6-degree approach to Kestrel 09 in TERRAIN AHEAD
 * for five seconds, 2.2 km out, over a ridge it clears by fifteen metres.
 */
let floorHeading = 0;
function floorNearRunway(x, z, floor) {
  return Math.max(3, floor * runwayProximity(x, z, floorHeading));
}
function floorNearPad(x, z, floor) {
  let k = 1;
  for (let i = 0; i < PADS.length; i++) {
    const d = Math.hypot(PADS[i].pos.x - x, PADS[i].pos.z - z);
    if (d < 600) k = Math.min(k, d / 600);
  }
  return Math.max(3, floor * k);
}

const LANDING_LOOK = { horizon: 12, floor: 20 };
const lookP = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, headingDeg: 0 };

/**
 * The look-ahead for the aircraft being flown (a physics.js Aircraft), as the
 * map AND the cockpit warning panel ask it — one function, so the red ring and
 * the TERRAIN light can never disagree.
 *
 *   - Not below 30 ft of radio altitude (to the water, at sea). Down there you
 *     are landing or taking off, and the ground ahead is the point. Measured:
 *     floating along Kestrel's runway in the flare, the far end's hill is 26 s
 *     away down the track and the map used to call it TERRAIN.
 *   - Wheels and flap out and slow: you are landing somewhere — maybe not on a
 *     runway — so look twelve seconds ahead, not thirty, and less fussily.
 *   - A helicopter crawling along at under 8 m/s has no track to look along.
 */
export function aircraftLookahead(ac, heli) {
  if (!ac || !ac.pos || ac.onGround || ac.crashed) return Infinity;
  const ra = Math.min(ac.agl || 0, ac.pos.y);
  if (ra < 9) return Infinity;
  // A jet holding itself up on its lift fans (the F-35B's hover sets
  // `jetBorne`) is a helicopter for this purpose: hovering beside a hillside
  // at 3 m/s, the aeroplane look-ahead would project it forward at its 20 m/s
  // floor and call TERRAIN on the hill it is holding station beside.
  if (ac.jetBorne) heli = true;
  if (heli && (ac.groundSpeed || 0) < 8) return Infinity;
  const p = lookP;
  p.x = ac.pos.x;
  p.y = ac.pos.y;
  p.z = ac.pos.z;
  p.vx = ac.vel ? ac.vel.x : 0;
  p.vy = ac.vel ? ac.vel.y : 0;
  p.vz = ac.vel ? ac.vel.z : 0;
  p.headingDeg = ac.heading || 0;
  const flaps = typeof ac.flapStep === 'function' ? ac.flapStep() : 0;
  const landing = !heli && ac.gearDown && flaps >= 1 && SPEC && ac.ias < SPEC.vne * 0.5;
  return aircraftTerrainAhead(p, heli, landing ? LANDING_LOOK : null);
}

/** The look-ahead as the aeroplane and the helicopter use it. */
export function aircraftTerrainAhead(p, heli, opts = null) {
  floorHeading = p.headingDeg || 0;
  return terrainConflict(p, {
    horizon: (opts && opts.horizon) || (heli ? 14 : 30),
    floor: (opts && opts.floor) || (heli ? 25 : 45),
    floorAt: heli ? floorNearPad : floorNearRunway,
    rise: heli ? 15 : 25,
    minSpeed: heli ? 8 : 20,
    maxTerrain: terrainCeiling(),
    exclude: onLandingGround,
  });
}

/**
 * Draw part of an image, clipping the SOURCE rectangle to the image and the
 * destination in proportion — which is what the spec says drawImage does, and
 * what not every browser has always done. See bug 4 in the header.
 */
function blit(ctx, img, sx, sy, sw, sh, dx, dy, dw, dh) {
  const W = img.width;
  const H = img.height;
  const x0 = Math.max(0, sx);
  const y0 = Math.max(0, sy);
  const x1 = Math.min(W, sx + sw);
  const y1 = Math.min(H, sy + sh);
  if (x1 <= x0 || y1 <= y0 || sw <= 0 || sh <= 0) return;
  const kx = dw / sw;
  const ky = dh / sh;
  ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0, dx + (x0 - sx) * kx, dy + (y0 - sy) * ky, (x1 - x0) * kx, (y1 - y0) * ky);
}

/*
 * 512, not 256.
 *
 * The chart covers the whole map — around 29 km across on Kestrel — so at 256
 * a pixel is 112 m of the world, and the closest zoom then stretches fifty of
 * them across 190 screen pixels. It looked like a chart drawn in Lego. At 512
 * a pixel is 56 m and the same view is sharp enough to steer by.
 *
 * Paid for by sampling the ground once per pixel instead of three times: the
 * hillshade needs the neighbours to the north and west, and those are pixels
 * this loop has already done. One row of them is kept, which is all it takes.
 */
const TILE = 512;
/** Rows of the chart sampled per frame while it is being built. */
const TILE_ROWS_PER_FRAME = 20;
/**
 * ...and no more than this many milliseconds of them — half that for a chart
 * building behind one already on screen. See Chart.slice.
 */
const SLICE_BUDGET_MS = 3;
/**
 * How many finished 512² charts to keep. Each is 1 MiB of canvas. Two is
 * enough for the only switch anyone makes in a lesson — fly out, take the
 * boat, fly home — without paying 262,144 height samples for the return trip.
 */
const CHART_CACHE = 3;

/* ------------------------------------------------------------------ */
/* Modes                                                               */
/* ------------------------------------------------------------------ */

/**
 * The four maps, and what each one is for.
 *
 * `ranges` are not the same list four times over. Twenty-four kilometres is a
 * sensible outer zoom in an aeroplane doing 60 m/s and an absurd one in a
 * boat doing five: the boat would be a stationary dot in an empty blue circle
 * for the whole lesson. The ranges are the distances each vehicle actually
 * covers, and each mode remembers its own, so taking the boat out does not
 * leave the aeroplane zoomed to a kilometre when you get back in it.
 *
 * `window` is the size of the sharp chart that follows you, and `windowUpTo`
 * the widest range that uses it; wider than that, the whole-map picture.
 * The aeroplane and the helicopter had only the whole map, 56 m a pixel, so
 * at the aeroplane's default 6 km a coastline was 107 chart pixels stretched
 * over 190 — stair-stepped, on the zoom a child actually looks at. Measured
 * in the browser against the 3D view, the coast was right and looked broken.
 */
const MODES = {
  flight: { chart: 'relief', ranges: [3000, 6000, 12000, 24000], start: 1, window: 12000, windowUpTo: 6000 },
  boat: { chart: 'bathy', ranges: [1200, 2400, 4800, 9600], start: 1, window: 12000, windowUpTo: 9600 },
  car: { chart: 'relief', ranges: [1000, 2000, 4000, 8000], start: 1, window: 12000, windowUpTo: 8000 },
  heli: { chart: 'relief', ranges: [2000, 4000, 8000, 16000], start: 1, window: 12000, windowUpTo: 4000 },
};

/*
 * WHY THE BOAT CHART IS NOT THE WHOLE MAP, AND MOVES.
 *
 * Measured on the maps in the tree: the relief chart covers 28,800 m across
 * 512 pixels, which is 56.3 m per pixel. On the smallest shoal on the boat
 * maps — Sennen's, r = 125 m — that is four pixels; the dredged channel is
 * 110 m wide, which is two; and when the whole of Skerries was sampled at
 * that scale the two-metre contour came out at TWENTY-TWO pixels for the
 * entire map. A chart whose safety contour is twenty-two pixels long is not a
 * chart, and no amount of drawing on top of it fixes that, because the thing
 * that is missing is in the sampling.
 *
 * A boat does not need 28.8 km. It does eight knots. So the bathymetric chart
 * covers 12 km — 23.4 m per pixel, which puts eleven pixels across that same
 * shoal and five across the channel — and it MOVES WITH THE BOAT, rebuilt a
 * few rows a frame into a second canvas while the first one is still on
 * screen, so a re-centre is invisible.
 *
 * RECENTRE is derived and not typed, because the one thing that must be true
 * is that the window never shows sea the chart does not cover: the widest
 * boat range is 9.6 km, so the far edge of the view sits 4.8 km from the
 * boat, and the boat may therefore be at most 6000 - 4800 = 1200 m from the
 * middle of a 12 km chart. Change the ranges above and this follows.
 */
// The 12 km is MODES.boat.window; the van has one of these now too (see
// windowChart), and the re-centre distance is worked out there, per mode.
/** Rows a frame while a re-centred chart builds BEHIND one that is already up. */
const TILE_ROWS_BACKGROUND = 10;

/**
 * Which of the four we are in.
 *
 * Worked out from the sim rather than pushed into the minimap, so no caller
 * has to remember to tell it — the one thing that is certain about a mode
 * toggle is that somebody will add a fifth path into it and forget. An
 * explicit `sim.minimapMode` overrides, for the menus and for the tests.
 *
 * The helicopter is not a separate vehicle: it is an aircraft whose spec has
 * `rotor: true` (see aircraft/types.js, `rotor: !!t.shape.power.rotor`), and
 * that flag is what the rotor HUD already switches on, so this uses the same
 * one rather than inventing a second source of truth.
 */
export function resolveMode(sim) {
  if (!sim) return 'flight';
  if (sim.minimapMode && MODES[sim.minimapMode]) return sim.minimapMode;
  if (sim.mode === 'drive' && sim.vehicle) {
    const kind = (sim.vehicle.spec && sim.vehicle.spec.kind) || 'boat';
    return kind === 'car' ? 'car' : 'boat';
  }
  /*
   * The rotor flag lives on the module-level SPEC that physics.js swaps when
   * the aeroplane changes, not on the Aircraft instance — `ac.spec` does not
   * exist, so the test was always false and the helicopter always got the
   * aeroplane's chart.
   */
  if (SPEC && SPEC.rotor) return 'heli';
  return 'flight';
}

/**
 * You, whatever you are sitting in, in the one shape the map needs.
 *
 * The old file read `sim.aircraft` directly in eleven places. Three of the
 * four modes do not have one, so this is the single seam: every mode below
 * reads this and nothing else, and adding a fifth vehicle is one branch here
 * rather than a hunt through the drawing code.
 */
function craftOf(sim, mode, out = {}) {
  if (mode === 'boat' || mode === 'car') {
    const v = sim.vehicle;
    const spec = (v && v.spec) || {};
    const pos = (v && v.pos) || { x: 0, y: 0, z: 0 };
    out.x = pos.x;
    out.y = pos.y;
    out.z = pos.z;
    out.headingDeg = (v && v.heading) || 0;
    // Signed as well: reversing the van, the track and the look-ahead go
    // backwards (bug 9).
    out.speedSigned = (v && v.speed) || 0;
    out.speed = Math.abs(out.speedSigned);
    out.vx = 0;
    out.vy = 0;
    out.vz = 0;
    out.onGround = true;
    out.crashed = !!(v && v.crashed);
    out.aground = !!(v && v.aground);
    out.draught = spec.draught || 1;
    out.kind = spec.kind || 'boat';
    return out;
  }
  // Straight off the aircraft rather than through readouts(), which builds a
  // thirty-field object every call — this runs every frame.
  const ac = sim.aircraft;
  out.x = ac.pos.x;
  out.y = ac.pos.y;
  out.z = ac.pos.z;
  out.headingDeg = ac.heading || 0;
  out.speed = ac.groundSpeed || 0;
  out.speedSigned = out.speed;
  out.vx = ac.vel ? ac.vel.x : 0;
  out.vy = ac.vel ? ac.vel.y : 0;
  out.vz = ac.vel ? ac.vel.z : 0;
  out.onGround = !!ac.onGround;
  out.crashed = !!ac.crashed;
  out.aground = false;
  out.draught = 0;
  out.kind = mode === 'heli' ? 'heli' : 'aeroplane';
  return out;
}

/**
 * The roads, from whichever of the two places has them.
 *
 * WHAT I NEED FROM THE ROAD SPECIALIST, exactly, and I have deliberately not
 * invented it — this reads whatever is there and copes with nothing:
 *
 *     // src/world/roads.js
 *     export function roadNetwork() : RoadNet | null
 *     // and/or, hung on the sim at map load: sim.roads = RoadNet
 *
 *     RoadNet = {
 *       roads: [{
 *         id:        string,          // 'a1', 'depot-spur'
 *         name:      string,          // 'The Coast Road'  (drawn when it fits)
 *         class:     'main' | 'lane', // only changes the stroke width
 *         path:      [[x, z, y], …],  // world metres, same as MAP.waters.roads
 *         halfWidth: number,          // metres; defaults to 26 if absent
 *         blend:     number,          // metres; defaults to 55 if absent
 *       }],
 *       junctions: [{ x: number, z: number, ways: number }] | undefined,
 *     }
 *
 * `junctions` is optional: if the router does not publish them this file
 * works them out from the paths, once per map, and the result is a marker in
 * the right place either way. If `roadNetwork` never lands, `MAP.waters.roads`
 * is used, which is real on Kestrel and empty on the three car maps.
 */
function roadsOf(sim) {
  const net = sim && sim.roads;
  if (net) {
    if (Array.isArray(net)) return net;
    if (Array.isArray(net.roads)) return net.roads;
  }
  return (MAP.waters && MAP.waters.roads) || [];
}

/* ------------------------------------------------------------------ */
/* The chart underneath                                                */
/* ------------------------------------------------------------------ */

/*
 * The islands used to be drawn as filled circles with a browner circle inside
 * for the high ground, which is what the island list literally contains — a
 * centre, a radius and a peak. It reads as a diagram of an island rather than
 * as a map of this one: every coast a perfect circle, no bays, no ridge, and
 * the same shape on every map in the game.
 *
 * So the chart is sampled from `heightAt` — the same function the terrain
 * itself is built from — and shaded with a hillshade, which is what makes a
 * paper map legible: you can see which way the ground falls. Sampled once per
 * map into an offscreen image and then simply blitted, because the terrain
 * does not move and 262,144 samples is not something to do every frame.
 *
 * It is filled twenty rows at a time so nothing stutters on a school laptop,
 * and whatever is done so far is drawn.
 */

/**
 * The depth bands of the boat chart.
 *
 * `to` is the depth of water in metres at the shallow edge of the band, so
 * the list reads downwards the way a chart legend does. The colours run the
 * OPPOSITE way round from a paper chart, where deep water is white: on a dark
 * cockpit this map is looked at against a night sky and a white sea would be
 * the brightest thing on the screen. Pale means shallow, and pale means be
 * careful, which is the one association worth spending the palette on.
 *
 * The numbers are not decoration. The boat draws one metre (surface.js,
 * `draught: 1`), so the 2 m contour is the line that matters and it is the
 * one drawn bright. A child steering inside the pale blue has a metre under
 * the keel at the best of it and the sea is not flat.
 */
const DEPTH_BANDS = [
  { to: 0.0, c: [126, 169, 107] }, // 0 → 0.5 m: dries, or as near as makes no odds
  { to: 0.5, c: [159, 216, 232] }, // the two-metre band, palest, the one to keep out of
  { to: 2.0, c: [95, 176, 208] },
  { to: 5.0, c: [58, 126, 168] },
  { to: 10.0, c: [36, 88, 126] },
  { to: 20.0, c: [20, 51, 85] }, // and everything deeper
];
/** The safety contour, and the one below it. */
const CONTOUR_2M = [232, 245, 252];
const CONTOUR_10M = [120, 160, 190];

/** Which band a height falls in. h is terrain height, so depth is -h. */
function bandOf(h) {
  if (h > 0) return -1; // land
  const d = -h;
  if (d < 0.5) return 0;
  if (d < 2) return 1;
  if (d < 5) return 2;
  if (d < 10) return 3;
  if (d < 20) return 4;
  return 5;
}

function tintInto(out, r, g, b, mul) {
  out[0] = Math.min(255, r * (mul ? mul[0] : 1));
  out[1] = Math.min(255, g * (mul ? mul[1] : 1));
  out[2] = Math.min(255, b * (mul ? mul[2] : 1));
  return out;
}

class Chart {
  constructor(kind, extent, cx = 0, cz = 0) {
    this.kind = kind;
    this.extent = extent;
    /** Where the middle of this chart is in the world. Zero for the relief. */
    this.cx = cx;
    this.cz = cz;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = TILE;
    this.ctx = this.canvas.getContext('2d');
    this.row = 0;
    this.prevRow = new Float32Array(TILE);
    this.curRow = new Float32Array(TILE);
    /** One strip of pixels, reused for every slice of this chart. */
    this.strip = null;
    this.used = 0;
  }

  get done() {
    return this.row >= TILE;
  }

  /**
   * The land colours, warped by the map's own palette so a desert map gets a
   * desert chart rather than a tropical one painted the wrong colour. Worked
   * out once per chart into arrays it keeps — slice() used to build a tint
   * closure and eight arrays every frame while a chart was building.
   */
  colours() {
    const pal = PALETTE || NO_OPTS;
    if (this._cols && this._pal === pal) return this._cols;
    this._pal = pal;
    const c = this._cols || (this._cols = { SAND: [0, 0, 0], GRASS: [0, 0, 0], ROCK: [0, 0, 0], LAND: [0, 0, 0] });
    tintInto(c.SAND, 176, 158, 118, pal.sand);
    tintInto(c.GRASS, 74, 104, 62, pal.grass);
    tintInto(c.ROCK, 124, 116, 104, pal.rock);
    // The boat chart's land is one flat buff. A chart's land is not the
    // subject; it is the thing the water stops at.
    tintInto(c.LAND, 198, 184, 152, pal.sand);
    return c;
  }

  /**
   * Sample a few more rows.
   *
   * Height at the pixel decides the colour; the slope between it and its
   * neighbour to the north-west decides how much light it gets. That second
   * part is the whole difference between a green blob and something you can
   * read a ridge off. The bathymetric chart uses the same two neighbours for
   * something else entirely — to find where a depth band CHANGES, which is
   * where a contour line goes.
   *
   * `rows` is the most it will do; `budgetMs` stops it sooner. A row is 512
   * height samples, and measured on the Mac this was written on one sample is
   * 0.37 µs, so twenty rows is 3.8 ms — on a 2019 Chromebook, four to six
   * times that, which is most of a 30 fps frame spent on the map for the
   * first second of every flight. With a budget the fast machine still does
   * twenty rows and the slow one does what fits, and the chart simply fills
   * in over a few seconds instead of the game stuttering while it does.
   */
  slice(rows = TILE_ROWS_PER_FRAME, budgetMs = Infinity) {
    const t0 = budgetMs < Infinity && typeof performance !== 'undefined' ? performance.now() : 0;
    const half = this.extent / 2;
    const step = this.extent / TILE;
    const { SAND, GRASS, ROCK, LAND } = this.colours();
    const bathy = this.kind === 'bathy';
    let end = Math.min(TILE, this.row + rows);
    if (!this.strip || this.strip.height < end - this.row) {
      this.strip = this.ctx.createImageData(TILE, Math.max(TILE_ROWS_PER_FRAME, end - this.row));
    }
    const img = this.strip;
    const d = img.data;
    const row = this.curRow;
    for (let j = this.row; j < end; j++) {
      // Out of time: stop after this row's neighbour bookkeeping is done. Two
      // rows at the least, so even the slowest machine gets somewhere.
      if (t0 && j - this.row >= 2 && performance.now() - t0 > budgetMs) {
        end = j;
        break;
      }
      const z = this.cz - half + j * step;
      let west = 0;
      for (let i = 0; i < TILE; i++) {
        const x = this.cx - half + i * step;
        const h = heightAt(x, z);
        row[i] = h;
        let r;
        let g;
        let b;
        const hasWest = i > 0;
        const hasNorth = j > this.row || this.row > 0;
        if (bathy) {
          const band = bandOf(h);
          if (band < 0) {
            // Land: flat buff with a whisper of shade, just enough that an
            // island is recognisable from seaward by its shape and its ridge.
            const dWest = hasWest ? h - west : 0;
            const dNorth = hasNorth ? h - this.prevRow[i] : 0;
            const shade = 1 + Math.max(-0.16, Math.min(0.16, (dWest + dNorth) / (step * 1.4)));
            r = LAND[0] * shade;
            g = LAND[1] * shade;
            b = LAND[2] * shade;
          } else {
            const c = DEPTH_BANDS[band].c;
            r = c[0];
            g = c[1];
            b = c[2];
            /*
             * The contour.
             *
             * A depth band is a wash; a contour is a LINE, and a line is what
             * a chart is actually read by. Both neighbours have already been
             * sampled, so a band change between this pixel and either of them
             * is a crossing, and the crossing gets painted on the shallow
             * side — which is the side you are trying to stay off.
             */
            const bw = hasWest ? bandOf(west) : band;
            const bn = hasNorth ? bandOf(this.prevRow[i]) : band;
            const deeper = Math.max(bw, bn);
            if (deeper > band) {
              if (band === 1) {
                r = CONTOUR_2M[0];
                g = CONTOUR_2M[1];
                b = CONTOUR_2M[2];
              } else if (band === 2 || band === 3) {
                r = CONTOUR_10M[0];
                g = CONTOUR_10M[1];
                b = CONTOUR_10M[2];
              }
            }
          }
        } else if (h <= 0) {
          // Water, darkening with depth.
          const k = Math.min(1, -h / 60);
          r = 22 + (1 - k) * 26;
          g = 58 + (1 - k) * 40;
          b = 84 + (1 - k) * 34;
        } else {
          const beach = Math.min(1, h / 14);
          const high = Math.min(1, Math.max(0, (h - 130) / 420));
          const lo0 = SAND[0] + (GRASS[0] - SAND[0]) * beach;
          const lo1 = SAND[1] + (GRASS[1] - SAND[1]) * beach;
          const lo2 = SAND[2] + (GRASS[2] - SAND[2]) * beach;
          r = lo0 + (ROCK[0] - lo0) * high;
          g = lo1 + (ROCK[1] - lo1) * high;
          b = lo2 + (ROCK[2] - lo2) * high;
          /*
           * Hillshade, lit from the north-west, off the two neighbours this
           * loop has already sampled: the pixel to the west on this row and
           * the pixel to the north on the last one. The first pixel of a row
           * and the first row of the chart have no neighbour, and take the
           * flat value — one pixel at the edge of the sea.
           */
          const dWest = hasWest ? h - west : 0;
          const dNorth = hasNorth ? h - this.prevRow[i] : 0;
          const shade = 1 + Math.max(-0.42, Math.min(0.42, (dWest + dNorth) / (step * 0.5)));
          r *= shade;
          g *= shade;
          b *= shade;
        }
        west = h;
        const o = ((j - this.row) * TILE + i) * 4;
        d[o] = Math.max(0, Math.min(255, r));
        d[o + 1] = Math.max(0, Math.min(255, g));
        d[o + 2] = Math.max(0, Math.min(255, b));
        d[o + 3] = 255;
      }
      this.prevRow.set(row);
    }
    // Only the rows done this time: the strip is reused and its lower rows
    // may be left over from the last slice.
    if (end > this.row) this.ctx.putImageData(img, 0, this.row, 0, 0, TILE, end - this.row);
    this.row = end;
  }
}

/* ------------------------------------------------------------------ */
/* Small drawing helpers                                               */
/* ------------------------------------------------------------------ */

/**
 * A polyline in world coordinates, added to whatever path is open.
 *
 * Deliberately does not open or close a path of its own: a road is a casing
 * stroke, a metal stroke and a centreline, three passes over the same points,
 * and the three roads on a map are one path each time rather than nine.
 */
function addPath(ctx, pts, mx, my) {
  if (!pts || pts.length < 2) return;
  ctx.moveTo(mx(pts[0][0]), my(pts[0][1]));
  for (let i = 1; i < pts.length; i++) ctx.lineTo(mx(pts[i][0]), my(pts[i][1]));
}

/** A dot, added to an open path. `moveTo` first or the arcs join up. */
function addDot(ctx, x, y, r) {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

/**
 * Text with a dark plate behind it, because white on pale blue is nothing.
 * `ts` is the text scale — see `textScale` in the Minimap.
 */
function label(ctx, text, x, y, colour, ts = 1) {
  const px = 8 * ts;
  ctx.font = `600 ${px}px ${FONT}`;
  ctx.textAlign = 'center';
  const w = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(8, 14, 22, 0.62)';
  ctx.fillRect(x - w / 2 - 2, y - px * 0.94, w + 4, px * 1.25);
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
}

/** A five-pointed star with a dark edge: a place you have found. */
function star(ctx, x, y, r, fill) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.strokeStyle = 'rgba(43, 33, 24, 0.9)';
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();
}

/**
 * An arrow on the rim pointing at something off the edge of the map, with a
 * word and a distance under it. `a` is the screen angle (atan2 of dy, dx).
 */
function rimArrow(ctx, cx, cy, edge, a, fill, text, ts) {
  const bx = cx + Math.cos(a) * (edge - 7 * ts);
  const by = cy + Math.sin(a) * (edge - 7 * ts);
  const s = 5.5 * ts;
  ctx.fillStyle = fill;
  ctx.strokeStyle = 'rgba(6, 12, 20, 0.85)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bx + Math.cos(a) * s, by + Math.sin(a) * s);
  ctx.lineTo(bx + Math.cos(a + 2.45) * s, by + Math.sin(a + 2.45) * s);
  ctx.lineTo(bx + Math.cos(a - 2.45) * s, by + Math.sin(a - 2.45) * s);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (text) {
    // Inside the arrow, towards the middle, so it is never clipped by the rim
    // — and kept above the band along the bottom where the scale and the
    // footer live, and inside the circle sideways.
    const tx = cx + Math.cos(a) * (edge - 22 * ts);
    const ty = Math.min(cy + Math.sin(a) * (edge - 22 * ts) + 3 * ts, SIZE - 44 * ts);
    const half = (String(text).length * 4.6 * ts) / 2 + 4;
    const room = Math.sqrt(Math.max(0, edge * edge - (ty - cy) ** 2)) - 4;
    label(ctx, text, Math.max(cx - room + half, Math.min(cx + room - half, tx)), ty, fill, ts);
  }
}

/** Kilometres, the way a ten-year-old should read them. */
function km(m) {
  const v = m / 1000;
  return v < 10 ? `${v.toFixed(1)} km` : `${Math.round(v)} km`;
}

/* ------------------------------------------------------------------ */
/* The minimap                                                         */
/* ------------------------------------------------------------------ */

export class Minimap {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'minimap';
    this.el.style.display = 'none';
    this._want = false;
    this._suppressed = false;
    this._faulty = false;
    /** No flight or drive running: the menus, a debrief, the loading screen.
     *  The game boots into the loading screen, so it starts true. */
    this._offstage = true;
    /*
     * And a watch on it between frames. update() is how the map normally
     * finds out, but main.js's drive branch only calls it while the state is
     * 'flying' — so a boat or van job ending in a debrief never told it, and
     * the chart stayed up over the "Delivered!" card. Four times a second,
     * one comparison.
     */
    this._sim = null;
    if (typeof setInterval === 'function') {
      const iv = setInterval(() => {
        const s = this._sim;
        if (s && s.state !== 'flying' && s.state !== 'paused' && !this._offstage) {
          this._offstage = true;
          this._apply();
        }
      }, 250);
      if (iv && typeof iv.unref === 'function') iv.unref(); // node tests
    }
    /** Names written on the van's map as places are found (see setLabels). */
    this._labels = [];
    this._labelsFrom = null;
    this._labelsN = -1;

    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE * 2;
    this.canvas.height = SIZE * 2;
    this.canvas.className = 'minimap-canvas';
    this.ctx = this.canvas.getContext('2d');
    this.ctx.scale(2, 2);

    this.warn = document.createElement('div');
    this.warn.className = 'minimap-warn';
    this.warn.style.display = 'none';

    /*
     * Kept in the DOM, empty and hidden, for anything that reads it — the
     * scale is drawn on the canvas now (bug 3 in the header). `textContent`
     * still says the range, for the tests and the console.
     */
    this.scaleLabel = document.createElement('div');
    this.scaleLabel.className = 'minimap-scale';
    this.scaleLabel.style.display = 'none';

    this.el.appendChild(this.canvas);
    this.el.appendChild(this.warn);
    this.el.appendChild(this.scaleLabel);
    root.appendChild(this.el);
    this.el.classList.add('mm-flight');

    /** What the DOM last said, so a frame that changes nothing writes nothing. */
    this._warnText = null;
    this._scaleText = null;
    /** Text and symbols are drawn this much bigger when the map is shown small. */
    this.textScale = 1;
    this._measureT = 1e9;
    /** The look-ahead, a few times a second rather than every frame. */
    this._lookT = 1e9;
    this._lookText = null;
    /** The drive-mode objective, asked of the runner a few times a second. */
    this._tgt = null;
    this._tgtT = 1e9;
    this._tgtDef = null;
    /** Redraw at most thirty times a second. */
    this._acc = 1;
    this._craft = {};
    this._g = { cx: SIZE / 2, cy: SIZE / 2, k: 1, craft: this._craft };
    const g = this._g;
    this._mx = (x) => g.cx + (x - g.craft.x) * g.k;
    this._my = (z) => g.cy + (z - g.craft.z) * g.k;
    this._errors = 0;

    /*
     * How much world fits across the map, in metres, per mode. Cycled by the
     * player with K, and REMEMBERED per mode: see MODES above.
     */
    this.mode = 'flight';
    this.rangeIndex = {};
    for (const m in MODES) this.rangeIndex[m] = MODES[m].start;
    this.t = 0;

    /*
     * The sampled charts, by kind. One entry is a megabyte, so the cache is
     * small and least-recently-used wins — but "used" is per map switch and
     * per vehicle switch, not per frame, so nothing is ever thrown away
     * during a flight.
     */
    this.charts = new Map();
    this.chart = null;
    this._use = 0;
    /** The sliding bathymetric chart: what is up, and what is being built. */
    this.windows = {};

    /** Everything derived from map data that must not be recomputed a frame. */
    this.derived = null;
    this.derivedKey = null;

    /*
     * Legacy surface. `ranges` and `rangeIndex` were public and main.js does
     * not read them, but the self-test and anything else written against the
     * old file might. `ranges` tracks the active mode.
     */
    this.ranges = MODES.flight.ranges;
  }

  /* ---- the bits main.js already calls, unchanged --------------- */

  /**
   * Switched on, and not hidden with the interface — whether or not a menu
   * happens to be covering it this moment. main.js reads this to lay the HUD
   * out around the map, and that answer must not flicker with the menus.
   */
  get visible() {
    return this._want && !this._suppressed;
  }

  /**
   * One place decides whether the map is on screen: switched on (J), not
   * hidden with the interface (U), and there being a flight or a drive under
   * it at all.
   *
   * The third was missing. main.js ticks the map every frame, the menus
   * included, and the menu layer is a translucent gradient — so on the front
   * page, on the mission list and over every debrief card there was a dark
   * disc in the bottom-right corner with the last flight's chart frozen in
   * it. Measured at 1280x800: elementFromPoint in the middle of it is the
   * menu, and the disc shows through at 42-70% black.
   */
  _apply() {
    const on = this._want && !this._suppressed && !this._offstage;
    const want = on ? '' : 'none';
    if (this.el.style.display !== want) this.el.style.display = want;
  }

  /**
   * Hidden along with the rest of the interface.
   *
   * Kept separate from `toggle`, so pressing U for a clean shot and then
   * pressing it again gives you back exactly the map state you had rather
   * than silently turning the map off for good.
   */
  setSuppressed(on) {
    this._suppressed = !!on;
    this._apply();
    this._measureT = 1e9;
  }

  /**
   * The map runs off the same instruments as everything else, so when they
   * are out it flashes rather than quietly lying to you with a position it
   * cannot actually know.
   */
  setFaulty(on) {
    if (this._faulty === !!on) return;
    this._faulty = !!on;
    this.el.classList.toggle('is-faulty', this._faulty);
  }

  toggle(force) {
    const on = force === undefined ? !this._want : !!force;
    this._want = on;
    this._apply();
    this._measureT = 1e9;
    this._acc = 1; // draw on the very next frame
    return on;
  }

  /** Step through the zoom levels of the mode you are in. */
  cycleRange() {
    const m = MODES[this.mode] || MODES.flight;
    this.rangeIndex[this.mode] = (this.rangeIndex[this.mode] + 1) % m.ranges.length;
    this._acc = 1;
    return m.ranges[this.rangeIndex[this.mode]];
  }

  /** The range now, in metres. */
  get span() {
    const m = MODES[this.mode] || MODES.flight;
    return m.ranges[this.rangeIndex[this.mode]];
  }

  /**
   * Change map by hand. `update` works it out on its own every frame, so this
   * exists for the menus and the tests and not because anything must call it.
   */
  setMode(mode) {
    if (!MODES[mode] || mode === this.mode) return this.mode;
    this.mode = mode;
    this.ranges = MODES[mode].ranges;
    this.el.classList.remove('mm-flight', 'mm-boat', 'mm-car', 'mm-heli');
    this.el.classList.add(`mm-${mode}`);
    this._lookT = 1e9;
    this._lookText = null;
    this._acc = 1;
    return mode;
  }

  /**
   * What the game wants you to get to, in any of the four.
   *
   * In the aeroplane that is `sim.activeTarget`, which main.js refreshes
   * every flying frame. In the boat and the van it is NOT — the drive branch
   * of the frame returns before that line — so the map asks the mission
   * runner directly, four times a second (bug 2 in the header).
   */
  targetOf(sim) {
    if (sim.mode !== 'drive') return sim.activeTarget || null;
    const r = sim.runner;
    if (!r || typeof r.activeTarget !== 'function') return null;
    if (this._tgtT > 0.25 || this._tgtDef !== r.def) {
      this._tgtT = 0;
      this._tgtDef = r.def;
      try {
        this._tgt = r.activeTarget();
      } catch (e) {
        this._tgt = null;
      }
    }
    return this._tgt && this._tgt.pos ? this._tgt : null;
  }

  /* ---- charts and derived data --------------------------------- */

  /**
   * The chart for this mode, built or building, and sampled a few rows this
   * frame if it is not finished.
   *
   * Close in, every mode gets a WINDOW that follows it — sharp, 23 m a pixel
   * (see `windowChart`). Zoomed out past `windowUpTo`, the aeroplane, the
   * helicopter and the van get the whole map in one picture instead.
   */
  chartFor(mode, craft) {
    const m = MODES[mode] || MODES.flight;
    if (m.window && this.span <= m.windowUpTo) {
      // Recentre while the widest range that uses it still fits inside.
      const w = this.windowChart(m.chart, m.window, craft, m.window / 2 - m.windowUpTo / 2);
      if (m.chart === 'bathy') {
        if (!w.done) w.slice(TILE_ROWS_PER_FRAME, SLICE_BUDGET_MS);
        return w;
      }
      if (!w.done) w.slice(TILE_ROWS_PER_FRAME, SLICE_BUDGET_MS);
      else if (!this.windows[m.chart].next) {
        // Nothing else to do: build the whole-map picture in the background,
        // for zooming out and for the fallback below.
        const wh = this.wholeChart(m.chart, true);
        if (!wh.done) wh.slice(TILE_ROWS_BACKGROUND, SLICE_BUDGET_MS / 2);
      }
      /*
       * A sharp window that is still being sampled, or that a fast aeroplane
       * has flown to the edge of before the next one is ready: if the
       * whole-map picture is finished, show that until the window catches
       * up, rather than a half-drawn map or a strip of blank sea.
       */
      const off = Math.max(Math.abs(craft.x - w.cx), Math.abs(craft.z - w.cz));
      if (w.done && off <= w.extent / 2 - this.span / 2) return w;
      const whole = this.wholeChart(m.chart, false);
      return whole && whole.done ? whole : w;
    }
    const c = this.wholeChart(m.chart, true);
    if (!c.done) c.slice(TILE_ROWS_PER_FRAME, SLICE_BUDGET_MS);
    return c;
  }

  /**
   * The whole map in one 512-pixel picture: every island edge on this map,
   * with a wide margin of sea so the coastline is not clipped by the edge of
   * the image. Cached per map.
   */
  wholeChart(kind, create) {
    const id = MAP && MAP.id;
    if (this._wholeId !== id || this._wholeKind !== kind) {
      this._wholeId = id;
      this._wholeKind = kind;
      this._wholeKey = `${id}|${kind}`;
    }
    const key = this._wholeKey;
    let c = this.charts.get(key);
    if (!c) {
      if (!create) return null;
      let reach = 12000;
      for (const isl of ISLANDS) reach = Math.max(reach, Math.hypot(isl.cx, isl.cz) + isl.radius);
      c = new Chart(kind, reach * 2.4);
      this.charts.set(key, c);
      // Evict the coldest, but never the one being asked for.
      while (this.charts.size > CHART_CACHE) {
        let oldest = null;
        let oldestKey = null;
        for (const [k, v] of this.charts) {
          if (k === key) continue;
          if (!oldest || v.used < oldest.used) {
            oldest = v;
            oldestKey = k;
          }
        }
        if (!oldestKey) break;
        this.charts.delete(oldestKey);
      }
    }
    c.used = ++this._use;
    return c;
  }

  /**
   * A chart that follows you: `extent` metres of map centred near you,
   * double-buffered.
   *
   * The boat's has always been one (12 km of sea at 23 m a pixel — see
   * "WHY THE BOAT CHART IS NOT THE WHOLE MAP"). The van's is new, for the same reason: the whole-map
   * picture is 56 m a pixel, so at the van's closest zoom (1 km across) the
   * map was eighteen chart pixels stretched over 190 screen pixels — blocks,
   * not a map. A 12 km window is 23 m a pixel, two and a half times sharper,
   * for one more 512-pixel picture while you drive. The aeroplane and the
   * helicopter use the same one at their close zooms (MODES, `windowUpTo`).
   *
   * `cur` is what is on screen. When you wander further from its middle than
   * `recentre` — half the window minus half the widest range that uses it —
   * `next` is started, centred
   * on you, and built ten rows a frame BEHIND the one that is showing — half
   * the usual rate, because nothing is missing from the screen while it
   * happens. `nextFor` keys the pending chart to the map as well as the
   * position, so changing map mid-build does not swap in somewhere else.
   */
  windowChart(kind, extent, craft, recentre) {
    const id = MAP && MAP.id;
    const b = this.windows[kind] || (this.windows[kind] = { cur: null, next: null, curFor: null, nextFor: null });
    /*
     * A chart centred on NaN samples NaN for a quarter of a million pixels
     * and comes back a black square that never rebuilds, because the offset
     * test against NaN is false forever. One line, and it has been paid for
     * elsewhere in this project already.
     */
    const px = Number.isFinite(craft.x) ? Math.round(craft.x) : 0;
    const pz = Number.isFinite(craft.z) ? Math.round(craft.z) : 0;
    /*
     * Rebuilt in front of you, not behind the old one, when the old one does
     * not have you on it at all: a new flight on the same map starting
     * somewhere else, or a mission that puts you down across the island.
     * Building the replacement behind a chart of somewhere else would show
     * blank sea for the whole build.
     */
    const far = b.cur && Math.max(Math.abs(px - b.cur.cx), Math.abs(pz - b.cur.cz)) > extent / 2;
    if (!b.cur || b.curFor !== id || far) {
      b.cur = new Chart(kind, extent, px, pz);
      b.curFor = id;
      b.next = null;
      return b.cur;
    }
    if (!b.cur.done) return b.cur;
    const off = Math.max(Math.abs(px - b.cur.cx), Math.abs(pz - b.cur.cz));
    if (!b.next && off > recentre) {
      b.next = new Chart(kind, extent, px, pz);
      b.nextFor = id;
    }
    if (b.next) {
      if (b.nextFor !== id) b.next = null;
      else {
        b.next.slice(TILE_ROWS_BACKGROUND, SLICE_BUDGET_MS / 2);
        if (b.next.done) {
          b.cur = b.next;
          b.next = null;
        }
      }
    }
    return b.cur;
  }

  /**
   * Everything that comes out of map data and must not come out of it again
   * next frame: the buoyage, the drying rocks, the junctions, the places.
   *
   * `channelMarks()` walks the whole channel and allocates an object per buoy;
   * `dryingShoals()` filters and allocates; the junction search is O(segments²).
   * Once per map each. The key carries the road count as well as the map id,
   * so a road router that populates `MAP.waters.roads` AFTER the map loads is
   * picked up on the next frame rather than never.
   */
  derivedFor(sim, mode) {
    const roads = roadsOf(sim);
    const key = `${MAP && MAP.id}|${mode}|${roads.length}|${PADS.length}`;
    if (this.derivedKey === key) return this.derived;
    this.derivedKey = key;
    const d = { roads, buoys: [], dries: [], junctions: [], places: [], berth: null, mouth: null };

    if (mode === 'boat') {
      const w = MAP.waters || {};
      d.channel = (w.channel && w.channel.path) || null;
      d.channelHalf = (w.channel && w.channel.halfWidth) || 55;
      try {
        d.buoys = channelMarks();
      } catch (e) {
        d.buoys = [];
      }
      try {
        // 1.8 m is dryingShoals' own default and it is the right one here:
        // it is a shade under the 2 m contour, so the rocks the chart draws
        // as symbols are exactly the ones inside the line it draws bright.
        d.dries = dryingShoals();
      } catch (e) {
        d.dries = [];
      }
      d.berth = harbourBerth();
      d.mouth = harbourMouth();
    }

    if (mode === 'car') {
      const net = sim && sim.roads;
      d.junctions =
        (net && Array.isArray(net.junctions) && net.junctions) || junctionsOf(roads);
      const c = MAP.courier;
      d.places = (c && c.places) || [];
      d.depot = (c && c.depot) || null;
      // The yards, quays and greens somebody levelled on purpose. They are the
      // only places on a car map where a van can actually stand, so they are
      // the one bit of relief a road map wants back.
      d.flats = FLATS ? FLATS.slice() : [];
    }

    this.derived = d;
    return d;
  }

  /* ---- the frame ----------------------------------------------- */

  /**
   * @param {number} dt seconds since the last frame
   * @param {object} sim the game, for the vehicle, the target and the hazards
   *
   * Never throws. main.js calls this from inside its frame, and an exception
   * there is the whole game's error screen — so one bad entry in somebody
   * else's `sim.traffic` would have ended the lesson (bug 10). Errors are
   * logged once and the next frame tries again from a clean canvas state.
   */
  update(dt, sim) {
    if (!sim) return;
    this._sim = sim;
    // Off the screen entirely unless something is being flown or driven — see
    // _apply. Paused keeps it: the pause menu is where you go to read it.
    const offstage = sim.state !== 'flying' && sim.state !== 'paused';
    if (offstage !== this._offstage) {
      this._offstage = offstage;
      this._apply();
      this._measureT = 1e9;
      this._acc = 1;
    }
    if (offstage || !this.visible) return;
    this.t += dt;
    this._tgtT += dt;
    this._lookT += dt;
    this._measureT += dt;
    // Thirty frames a second is plenty for a map, and on a 60 Hz screen it
    // halves the cost.
    this._acc += dt;
    if (this._acc < 1 / 31) return;
    this._acc = 0;
    try {
      this.frame(sim);
    } catch (err) {
      const ctx = this.ctx;
      for (let i = 0; i < 12; i++) ctx.restore();
      ctx.setTransform(2, 0, 0, 2, 0, 0);
      if (this._errors++ === 0) console.error('[minimap] a frame failed to draw; carrying on:', err);
    }
  }

  frame(sim) {
    const mode = resolveMode(sim);
    if (mode !== this.mode) this.setMode(mode);
    this.ranges = MODES[mode].ranges;

    // How small is the map on screen? A phone shows it at 84 px and an iPad
    // at 118, so text drawn for 190 comes out at 3.5 and 5 px (bug 8). Read
    // once a second, not every frame: clientWidth forces a layout.
    if (this._measureT > 1) {
      this._measureT = 0;
      const w = this.el.clientWidth || SIZE;
      this.textScale = Math.max(1, Math.min(1.9, SIZE / Math.max(60, w)));
    }
    const ts = this.textScale;

    const ctx = this.ctx;
    const craft = craftOf(sim, mode, this._craft);
    const span = this.span;
    const k = SIZE / span; // pixels per metre
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    // World → map. North (-Z) is up. Made once in the constructor and fed
    // through `g`, rather than two new closures every frame.
    const g = this._g;
    g.cx = cx;
    g.cy = cy;
    g.k = k;
    g.craft = craft;
    const mx = this._mx;
    const my = this._my;

    ctx.clearRect(0, 0, SIZE, SIZE);

    // The chart. Rebuilt when the map or the vehicle changes, twenty rows a
    // frame; whatever is finished is what gets drawn.
    const chart = this.chartFor(mode, craft);
    this.chart = chart;

    // Sea, which is also what shows through wherever the chart is not built
    // yet. The boat chart's unbuilt sea is its own deepest band, so the thing
    // filling in is a chart rather than a hole.
    ctx.fillStyle = mode === 'boat' ? '#143355' : '#0d2740';
    ctx.beginPath();
    ctx.arc(cx, cy, SIZE / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, SIZE / 2 - 2, 0, Math.PI * 2);
    ctx.clip();

    /*
     * Blit the piece of the chart under you.
     *
     * The chart is a fixed picture of the whole map, so panning it is
     * arithmetic rather than redrawing: work out which rectangle of it the
     * window is looking at, and let the canvas scale it — clipped to the
     * picture by hand, see `blit`.
     */
    const ppm = TILE / chart.extent; // chart pixels per metre
    const half = chart.extent / 2;
    const sw = span * ppm;
    const sx = (craft.x - chart.cx + half) * ppm - sw / 2;
    const sy = (craft.z - chart.cz + half) * ppm - sw / 2;
    ctx.imageSmoothingEnabled = true;
    blit(ctx, chart.canvas, sx, sy, sw, sw, 0, 0, SIZE, SIZE);

    /*
     * A road map is relief with the relief turned down. One rectangle over
     * the blit, no second tile, no second quarter-million height samples —
     * and the roads drawn on top of it then read as the subject, which on a
     * road map they are.
     */
    if (mode === 'car') {
      ctx.fillStyle = 'rgba(234, 228, 210, 0.42)';
      ctx.fillRect(0, 0, SIZE, SIZE);
    } else if (mode === 'heli') {
      // And a pad map is relief with the contrast held back a little, so a
      // white ring on a sunlit hillside is still a white ring.
      ctx.fillStyle = 'rgba(8, 14, 24, 0.2)';
      ctx.fillRect(0, 0, SIZE, SIZE);
    }

    // Range rings, so a glance gives you a distance and not just a picture.
    ctx.strokeStyle =
      mode === 'car' ? 'rgba(60, 52, 40, 0.18)' : 'rgba(190, 214, 236, 0.16)';
    ctx.lineWidth = 1;
    // A quarter and a half of the way out: both in one path.
    ctx.beginPath();
    ctx.moveTo(cx + (SIZE / 2 - 2) * 0.25, cy);
    ctx.arc(cx, cy, (SIZE / 2 - 2) * 0.25, 0, Math.PI * 2);
    ctx.moveTo(cx + (SIZE / 2 - 2) * 0.5, cy);
    ctx.arc(cx, cy, (SIZE / 2 - 2) * 0.5, 0, Math.PI * 2);
    ctx.stroke();

    g.ctx = ctx;
    g.span = span;
    g.mx = mx;
    g.my = my;
    g.sim = sim;
    g.t = this.t;
    g.mode = mode;
    g.ts = ts;
    g.edge = SIZE / 2 - 2;
    g.target = this.targetOf(sim);
    const d = this.derivedFor(sim, mode);

    if (mode === 'flight') this.drawFlight(g);
    else if (mode === 'boat') this.drawBoat(g, d);
    else if (mode === 'car') this.drawCar(g, d);
    else this.drawHeli(g, d);

    // Ships and decks: anything you can land on that is not the ground.
    if (mode !== 'car') this.drawPlatforms(g);

    // Hazards: a tornado is worth a great deal of ink, in any vehicle.
    if (sim.tornado && sim.tornado.active && sim.tornado.pos) {
      const t = sim.tornado;
      const pulse = 0.55 + Math.sin(this.t * 5) * 0.25;
      ctx.fillStyle = `rgba(255, 70, 45, ${pulse})`;
      ctx.beginPath();
      ctx.arc(mx(t.pos.x), my(t.pos.z), Math.max(4, (t.coreR || 130) * k), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,120,90,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(mx(t.pos.x), my(t.pos.z), Math.max(8, (t.reach || 1400) * k), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Everybody else in the sky, and on the water.
    this.drawTraffic(g);

    // The objective. One symbol in all four games, because it is one idea:
    // the place the game is currently asking you to get to.
    this.drawTarget(g);

    ctx.restore();

    // Things off the edge get an arrow on the rim (bug 7): the objective in
    // every game, and in the aeroplane with nothing to aim at, the airfield.
    this.drawRimArrows(g);

    // You, in the middle, pointing where you are pointing.
    this.drawOwnCraft(g);

    /*
     * The compass, on the bezel rather than as a letter floating in the sea.
     *
     * North is always up on this map and that has to be obvious at a glance,
     * because the whole design rests on it: four ticks and an N, which is how
     * every chart and every instrument in the cockpit says the same thing.
     */
    ctx.save();
    ctx.translate(cx, cy);
    const ring = SIZE / 2 - 3;
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.rotate((i * Math.PI) / 2);
      ctx.strokeStyle = i === 0 ? 'rgba(236, 244, 252, 0.85)' : 'rgba(190, 214, 236, 0.45)';
      ctx.lineWidth = i === 0 ? 2 : 1.3;
      ctx.beginPath();
      ctx.moveTo(0, -ring);
      ctx.lineTo(0, -ring + (i === 0 ? 8 : 5));
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(236, 244, 252, 0.9)';
    ctx.font = `700 ${10 * Math.min(ts, 1.5)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('N', cx, 14 + 9 * Math.min(ts, 1.5));

    // What is about to go wrong, if anything — worked out a few times a
    // second, because it samples the ground.
    if (this._lookT > 0.2) {
      this._lookT = 0;
      this._lookText = this.warningFor(g, d);
    }
    const warnText = craft.crashed ? null : this._lookText;
    this.setWarning(warnText);

    // The one number this vehicle is steered by, along the bottom of the
    // glass, and the scale above it — both on the canvas, so they cannot sit
    // on top of each other (bug 3).
    const footTop = mode !== 'flight' ? this.drawFoot(g, d) : SIZE - 6;
    const scaleText = span >= 1000 ? `${span / 1000} km across` : `${span} m across`;
    if (!warnText) {
      ctx.font = `620 ${8.5 * ts}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = mode === 'car' ? 'rgba(40, 34, 26, 0.85)' : 'rgba(170, 190, 210, 0.9)';
      ctx.fillText(scaleText, cx, footTop - 3 * ts);
    }
    if (scaleText !== this._scaleText) {
      this._scaleText = scaleText;
      this.scaleLabel.textContent = span >= 1000 ? `${span / 1000} km` : `${span} m`;
    }
  }

  /* ---- mode: flight -------------------------------------------- */

  /**
   * The aviation chart.
   *
   * The runways, drawn where they really are: a dark strip with a
   * centreline, which is what tells one apart from a road at a glance. BOTH
   * of them — 18/36 is on every map, and it is the one the tower sends you
   * to when the wind is across 09 (bug 5). It lies along whichever axis its
   * own heading says, the same test terrain.js uses to land on it.
   */
  drawFlight(g) {
    const { ctx, k, mx, my } = g;
    for (let pass = 0; pass < 2; pass++) {
      ctx.lineCap = 'butt';
      ctx.beginPath();
      for (let i = 0; i < 2; i++) {
        const R = i === 0 ? AIRPORT.runway : AIRPORT.runway2;
        if (!R) continue;
        const alongX = i === 0 || Math.abs(((R.headingDeg ?? 180) % 180) - 90) < 45;
        const h = R.length / 2;
        if (alongX) {
          ctx.moveTo(mx(R.cx - h), my(R.cz));
          ctx.lineTo(mx(R.cx + h), my(R.cz));
        } else {
          ctx.moveTo(mx(R.cx), my(R.cz - h));
          ctx.lineTo(mx(R.cx), my(R.cz + h));
        }
      }
      const rw = Math.max(2.5, 60 * k);
      ctx.strokeStyle = pass === 0 ? 'rgba(18, 22, 28, 0.9)' : '#f2f6fa';
      ctx.lineWidth = pass === 0 ? rw : Math.max(1, rw * 0.3);
      ctx.stroke();
    }
  }

  /**
   * The carrier, and any other deck big enough to be a ship.
   *
   * A deck is registered with terrain.js as a platform, so this reads the
   * same list the wheels land on. Rooftop pads are platforms too; they are
   * smaller than sixty metres and the pad symbols already cover them.
   */
  drawPlatforms(g) {
    const { ctx, k, mx, my, ts, craft } = g;
    for (let i = 0; i < PLATFORMS.length; i++) {
      const p = PLATFORMS[i];
      if (p.hw * 2 < 60 && p.hd * 2 < 60) continue;
      const x = mx(p.cx);
      const y = my(p.cz);
      const w = Math.max(3 * ts, p.hw * 2 * k);
      const h = Math.max(10 * ts, p.hd * 2 * k);
      ctx.fillStyle = 'rgba(96, 104, 114, 0.95)';
      ctx.strokeStyle = 'rgba(236, 244, 252, 0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      // A hull: pointed bow to the north, the way the ship is moored.
      ctx.moveTo(x, y - h / 2 - w * 0.6);
      ctx.lineTo(x + w / 2, y - h / 2);
      ctx.lineTo(x + w / 2, y + h / 2);
      ctx.lineTo(x - w / 2, y + h / 2);
      ctx.lineTo(x - w / 2, y - h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      const near = Math.hypot(p.cx - craft.x, p.cz - craft.z) < g.span * 0.45;
      if (near && p.name) label(ctx, p.name.replace(/^CV-\d+\s*/, ''), x, y + h / 2 + 10 * ts, '#e6eef6', ts);
    }
  }

  /**
   * Everybody else.
   *
   * These were yellow dots — the same yellow as the courier's addresses —
   * with no heading and no height (bug 6). Now an aircraft is an aircraft
   * shape pointing where it is going, coloured the way the collision-
   * avoidance system sees it: pale blue normally, amber for TRAFFIC, red for
   * a resolution advisory. The nearest few say how far above or below you
   * they are, in feet, because "+300 ft" is the one thing about another
   * aeroplane you cannot see out of the window.
   *
   * Anything on the ground is a small grey dot, and only when zoomed in: a
   * full apron of parked airliners is not traffic.
   */
  drawTraffic(g) {
    const { ctx, mx, my, craft, sim, ts, edge, cx, cy, span } = g;
    const list = sim.traffic;
    const drill = sim.warnings && sim.warnings.drillTraffic;
    const n1 = list && list.length ? list.length : 0;
    const n2 = drill && drill.length ? drill.length : 0;
    if (!n1 && !n2) return;
    const levelOf = sim.warnings && typeof sim.warnings.trafficLevel === 'function' ? sim.warnings.trafficLevel : null;
    let tagged = 0;
    for (let i = 0; i < n1 + n2; i++) {
      const e = i < n1 ? list[i] : drill[i - n1];
      if (!e || !e.pos || !Number.isFinite(e.pos.x) || !Number.isFinite(e.pos.z)) continue;
      const x = mx(e.pos.x);
      const y = my(e.pos.z);
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > edge * edge) continue;
      if (e.onGround) {
        if (span > 6000) continue;
        ctx.fillStyle = 'rgba(170, 180, 190, 0.7)';
        ctx.beginPath();
        ctx.arc(x, y, 1.6 * ts, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const lvl = levelOf ? levelOf(e) : 0;
      const col = lvl >= 2 ? '#ff5a4a' : lvl === 1 ? '#ffc247' : '#9fdcff';
      const hd = this.trafficHeading(e);
      const s = 1.05 * Math.min(ts, 1.5);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((hd * Math.PI) / 180);
      ctx.scale(s, s);
      ctx.fillStyle = col;
      ctx.strokeStyle = 'rgba(6, 12, 20, 0.85)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(0, -5.5);
      ctx.lineTo(1.1, -1.2);
      ctx.lineTo(5, 1.4);
      ctx.lineTo(5, 2.6);
      ctx.lineTo(1, 1.6);
      ctx.lineTo(0.9, 4);
      ctx.lineTo(2.3, 5);
      ctx.lineTo(2.3, 5.8);
      ctx.lineTo(-2.3, 5.8);
      ctx.lineTo(-2.3, 5);
      ctx.lineTo(-0.9, 4);
      ctx.lineTo(-1, 1.6);
      ctx.lineTo(-5, 2.6);
      ctx.lineTo(-5, 1.4);
      ctx.lineTo(-1.1, -1.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      // Height difference for the ones that matter: anything the system has
      // flagged, and otherwise the first few.
      if ((lvl > 0 || tagged < 3) && Number.isFinite(e.pos.y) && craft.kind !== 'boat' && craft.kind !== 'car') {
        tagged++;
        const ft = Math.round(((e.pos.y - craft.y) * 3.28084) / 100) * 100;
        const txt = ft === 0 ? 'same height' : `${ft > 0 ? '+' : '−'}${Math.abs(ft).toLocaleString('en-GB')} ft`;
        label(ctx, txt, x, y + 12 * ts, col, ts * 0.95);
      }
    }
  }

  /**
   * Which way another aircraft is going, in compass degrees.
   *
   * From how it has MOVED when it is moving, and from its own `heading` only
   * when it is not. The mayday escorts main.js puts in `sim.traffic` are
   * `{ pos }` and nothing else, so they were all drawn pointing north while
   * they circled you; and the contract says `heading` without saying degrees,
   * and a direction worked out from positions cannot be in the wrong units.
   * One small record per aircraft, the first time it is seen: by its `id`
   * where it has one, so a traffic feed that makes new entry objects every
   * frame is still one aircraft moving (forgotten a few seconds after it was
   * last drawn), and otherwise in a WeakMap that lets it go with the entry.
   */
  trafficHeading(e) {
    const byId = e.id != null;
    const mem = byId ? this._hdgById || (this._hdgById = new Map()) : this._hdgMem || (this._hdgMem = new WeakMap());
    const key = byId ? e.id : e;
    let m = mem.get(key);
    if (!m) {
      m = { x: e.pos.x, z: e.pos.z, h: NaN, seen: 0 };
      mem.set(key, m);
      if (byId && mem.size > 64) {
        for (const [k2, v] of mem) if (this.t - v.seen > 5) mem.delete(k2);
      }
    }
    m.seen = this.t;
    const dx = e.pos.x - m.x;
    const dz = e.pos.z - m.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 4) {
      if (d2 < 250000) m.h = (Math.atan2(dx, -dz) * 180) / Math.PI; // not a teleport
      m.x = e.pos.x;
      m.z = e.pos.z;
    }
    if (Number.isFinite(m.h)) return m.h;
    return Number.isFinite(e.heading) ? e.heading : 0;
  }

  /* ---- mode: boat ---------------------------------------------- */

  /**
   * The chart.
   *
   * The depth is already underneath, in the tile. What goes on top is the
   * three things a depth wash cannot say:
   *
   *   the channel   where somebody has dredged a lane deep enough to float
   *                 you through ground that would otherwise stop you;
   *   the buoys     which side of that lane you are supposed to be on;
   *   the rocks     the ones with a metre of water over them, which the wash
   *                 draws as "pale blue" and which are actually a bang.
   *
   * Order matters: channel, then rocks, then buoys. The buoys are the
   * smallest and the most important and they go on last so nothing lands on
   * top of one.
   */
  drawBoat(g, d) {
    const { ctx, k, mx, my } = g;

    // The dredged lane. Its edges as well as its middle, because the edge is
    // the thing you are trying not to cross.
    if (d.channel && d.channel.length > 1) {
      const w = Math.max(2, d.channelHalf * 2 * k);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(150, 220, 255, 0.16)';
      ctx.lineWidth = w;
      ctx.beginPath();
      addPath(ctx, d.channel, mx, my);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(190, 240, 255, 0.7)';
      ctx.lineWidth = 1.1;
      ctx.setLineDash(DASH_CHANNEL);
      ctx.beginPath();
      addPath(ctx, d.channel, mx, my);
      ctx.stroke();
      ctx.setLineDash(DASH_NONE);
    }

    /*
     * Drying rocks.
     *
     * The chart symbol for one is an asterisk inside a dotted line, and it is
     * worth copying rather than inventing: the dotted ring is the extent of
     * the danger and the asterisk is the rock. A ten-year-old learns it in
     * one mission and then reads it on any chart for the rest of their life,
     * which is more than a red blob will ever do for them.
     */
    if (d.dries.length) {
      ctx.strokeStyle = 'rgba(255, 214, 130, 0.75)';
      ctx.lineWidth = 1;
      ctx.setLineDash(DASH_ROCK);
      ctx.beginPath();
      for (let i = 0; i < d.dries.length; i++) {
        const s = d.dries[i];
        const r = Math.max(3, s.r * k);
        ctx.moveTo(mx(s.cx) + r, my(s.cz));
        ctx.arc(mx(s.cx), my(s.cz), r, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.setLineDash(DASH_NONE);
      // The asterisks, all of them in one path and one stroke.
      ctx.strokeStyle = '#ffd682';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (let i = 0; i < d.dries.length; i++) {
        const s = d.dries[i];
        const x = mx(s.cx);
        const y = my(s.cz);
        const a = 3.2;
        ctx.moveTo(x - a, y);
        ctx.lineTo(x + a, y);
        ctx.moveTo(x - a * 0.6, y - a * 0.85);
        ctx.lineTo(x + a * 0.6, y + a * 0.85);
        ctx.moveTo(x + a * 0.6, y - a * 0.85);
        ctx.lineTo(x - a * 0.6, y + a * 0.85);
      }
      ctx.stroke();
    }

    // The harbour: the mouth as a gate, the berth as an anchor. Two marks,
    // and between them the whole answer to "where do I go home to".
    if (d.mouth) {
      ctx.strokeStyle = 'rgba(236, 244, 252, 0.6)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(mx(d.mouth.x) - 4, my(d.mouth.z) - 4);
      ctx.lineTo(mx(d.mouth.x) + 4, my(d.mouth.z) + 4);
      ctx.moveTo(mx(d.mouth.x) + 4, my(d.mouth.z) - 4);
      ctx.lineTo(mx(d.mouth.x) - 4, my(d.mouth.z) + 4);
      ctx.stroke();
    }
    if (d.berth) {
      const x = mx(d.berth.x);
      const y = my(d.berth.z);
      ctx.strokeStyle = '#9ff0c8';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x, y + 4);
      ctx.moveTo(x - 3, y - 3);
      ctx.lineTo(x + 3, y - 3);
      ctx.moveTo(x - 4, y + 1.5);
      ctx.arc(x, y + 1.5, 4, Math.PI, 0, true);
      ctx.stroke();
    }

    /*
     * The buoyage. IALA Region A, and the rule said once in one sentence:
     * coming home, keep the red ones on your left.
     *
     * Two paths and two fills for the lot of them, whatever the channel does,
     * because every red buoy is the same colour as every other red buoy and
     * a path can hold as many arcs as you like.
     */
    if (d.buoys.length) {
      const r = Math.max(1.6, Math.min(3.2, 900 * k));
      for (let q = 0; q < BUOY_KINDS.length; q++) {
        const kind = BUOY_KINDS[q];
        let any = false;
        ctx.beginPath();
        for (let i = 0; i < d.buoys.length; i++) {
          const b = d.buoys[i];
          if (b.kind !== kind) continue;
          addDot(ctx, mx(b.x), my(b.z), r);
          any = true;
        }
        if (!any) continue;
        ctx.fillStyle =
          kind === 'port' ? '#d0433a' : kind === 'starboard' ? '#3ec16d' : '#e8635a';
        ctx.fill();
        ctx.strokeStyle = 'rgba(6, 12, 20, 0.75)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }
  }

  /* ---- mode: car ----------------------------------------------- */

  /**
   * The road map.
   *
   * A road is drawn three times over the same points — a dark casing, a pale
   * metal, a dashed centreline — which is what makes a line on a map read as
   * a ROAD rather than as a river or a border. Three strokes for every road
   * on the island, not three per road, because they are all the same colour.
   *
   * What is drawn when there are no roads yet matters more than what is drawn
   * when there are: on drovers, cape and cullen `MAP.waters.roads` is empty
   * today and the router is somebody else's drop. So the yards and the named
   * places go down first and stand on their own, and the corridors appear
   * over them the day the router lands.
   */
  drawCar(g, d) {
    const { ctx, k, mx, my } = g;

    // The levelled ground: yards, quays, greens. The only places a van can
    // actually stand still on, so the map says which they are.
    if (d.flats && d.flats.length) {
      ctx.fillStyle = 'rgba(120, 106, 80, 0.22)';
      ctx.strokeStyle = 'rgba(90, 78, 58, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const f of d.flats) {
        const x0 = mx(f.x0);
        const z0 = my(f.z0);
        ctx.rect(x0, z0, mx(f.x1) - x0, my(f.z1) - z0);
      }
      ctx.fill();
      ctx.stroke();
    }

    const roads = d.roads;
    if (roads.length) {
      const casing = Math.max(3, 2 * (roads[0].halfWidth || 26) * k);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // Casing.
      ctx.strokeStyle = 'rgba(48, 40, 30, 0.85)';
      ctx.lineWidth = casing;
      ctx.beginPath();
      for (const rd of roads) addPath(ctx, rd.path, mx, my);
      ctx.stroke();
      // Metal.
      ctx.strokeStyle = '#e6dcc4';
      ctx.lineWidth = Math.max(1.5, casing * 0.62);
      ctx.beginPath();
      for (const rd of roads) addPath(ctx, rd.path, mx, my);
      ctx.stroke();
      // Centreline, only once the road is wide enough on screen to hold one.
      if (casing > 6) {
        ctx.strokeStyle = 'rgba(70, 60, 44, 0.7)';
        ctx.lineWidth = 1;
        ctx.setLineDash(DASH_ROAD);
        ctx.beginPath();
        for (const rd of roads) addPath(ctx, rd.path, mx, my);
        ctx.stroke();
        ctx.setLineDash(DASH_NONE);
      }
    }

    // Junctions: the places a decision gets made.
    if (d.junctions.length) {
      ctx.fillStyle = '#32281c';
      ctx.strokeStyle = '#f0e7d0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const j of d.junctions) ctx.rect(mx(j.x) - 2.5, my(j.z) - 2.5, 5, 5);
      ctx.fill();
      ctx.stroke();
    }

    /*
     * The addresses.
     *
     * A courier game whose map does not have the addresses on it is a game
     * about following an arrow, which is the failure mode this whole map
     * exists to avoid. Every place is a dot; the ones a van cannot reach at
     * all are hollow, so "Cobb Light — boat only" is a thing you read off the
     * map rather than a thing you discover at the end of a wrong road.
     */
    if (d.places.length) {
      // Two passes over the list rather than two new arrays of it a frame.
      const s = Math.min(g.ts, 1.5);
      let anyNot = false;
      ctx.fillStyle = '#2b2118';
      ctx.beginPath();
      for (const p of d.places) {
        if (p.boatOnly) anyNot = true;
        else addDot(ctx, mx(p.x), my(p.z), 3 * s);
      }
      ctx.fill();
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      for (const p of d.places) if (!p.boatOnly) addDot(ctx, mx(p.x), my(p.z), 1.7 * s);
      ctx.fill();
      if (anyNot) {
        ctx.strokeStyle = 'rgba(70, 60, 44, 0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const p of d.places) if (p.boatOnly) addDot(ctx, mx(p.x), my(p.z), 2.6 * s);
        ctx.stroke();
      }
      /*
       * Names, but only the ones near enough to read and only while the map
       * is zoomed in far enough that they are not a wall of text. Eight
       * labels on a 190-pixel map is a mess; the three nearest is a map.
       */
      // The three nearest, found without building and sorting a new array of
      // every place on the island every frame.
      const near = this._near || (this._near = [null, null, null]);
      const nd = this._nearD || (this._nearD = [0, 0, 0]);
      near[0] = near[1] = near[2] = null;
      nd[0] = nd[1] = nd[2] = Infinity;
      for (const p of d.places) {
        const d2 = (p.x - g.craft.x) ** 2 + (p.z - g.craft.z) ** 2;
        for (let i = 0; i < 3; i++) {
          if (d2 < nd[i]) {
            for (let j = 2; j > i; j--) {
              nd[j] = nd[j - 1];
              near[j] = near[j - 1];
            }
            nd[i] = d2;
            near[i] = p;
            break;
          }
        }
      }
      /*
       * On a free drive the island's places are things to FIND: one not found
       * yet is a question mark, and one found is a star with its name (see
       * drawDiscoveries). The courier address standing on the same spot kept
       * its own name, so "Weather Station" was printed beside its own "?"
       * (the reviewer's capture) and the question mark hid nothing. There, the
       * discovery marker speaks for the place, and the address stays a dot.
       */
      const ir = g.sim && g.sim.islandRoads;
      for (let i = 0; i < 3; i++) {
        const p = near[i];
        if (!p) continue;
        const x = mx(p.x);
        const y = my(p.z);
        if (x < 8 || x > SIZE - 8 || y < 14 || y > SIZE - 8) continue;
        if (ir && islandPlaceNear(ir, p.x, p.z, d.depot)) continue;
        label(ctx, p.name, x, y - 6 * g.ts, p.boatOnly ? 'rgba(226,216,196,0.7)' : '#ffe9a8', g.ts);
      }
    }

    // The depot: where the van lives and where every job starts and ends.
    if (d.depot) {
      const x = mx(d.depot.x);
      const y = my(d.depot.z);
      const s = Math.min(g.ts, 1.5);
      ctx.fillStyle = '#4ea3ff';
      ctx.strokeStyle = 'rgba(8,14,22,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 4 * s, y + 3 * s);
      ctx.lineTo(x - 4 * s, y - 1 * s);
      ctx.lineTo(x, y - 4.5 * s);
      ctx.lineTo(x + 4 * s, y - 1 * s);
      ctx.lineTo(x + 4 * s, y + 3 * s);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    this.drawDiscoveries(g, d);
  }

  /**
   * Island Roads: the places you have found, by name, and a question mark on
   * each one you have not.
   *
   * jobs.js promises "reaching a named place for the first time pays a small
   * bounty and writes its name on the minimap", and calls `setLabels` to do
   * the writing — a method this file never had, behind an `&& setLabels`
   * guard, so the bounty was paid and the map stayed blank. It is here now.
   * The places still to find are drawn too, faintly: free driving's whole
   * loop is "there is always somewhere next", and a child cannot go and find
   * a place they have no idea exists.
   */
  drawDiscoveries(g, d) {
    const { ctx, mx, my, ts, cx, cy, edge } = g;
    const ir = g.sim && g.sim.islandRoads;
    if (ir && typeof ir.labels === 'function' && (ir !== this._labelsFrom || ir.foundCount !== this._labelsN)) {
      // Asked again only when something was found — labels() builds a list.
      this._labelsFrom = ir;
      this._labelsN = ir.foundCount;
      try {
        this._labels = ir.labels() || [];
      } catch (e) {
        this._labels = [];
      }
    } else if (!ir && this._labelsFrom) {
      // The free drive ended. Its discoveries go with it.
      this._labelsFrom = null;
      this._labelsN = -1;
      this._labels = [];
    }
    const s = Math.min(ts, 1.5);
    const lim = (edge - 8) ** 2;
    // Not found yet: a faint ring with a question mark.
    if (ir && Array.isArray(ir.places)) {
      ctx.font = `800 ${7 * s}px ${FONT}`;
      ctx.textAlign = 'center';
      for (const p of ir.places) {
        if (p.found || !p.pos) continue;
        const x = mx(p.pos.x);
        const y = my(p.pos.z);
        if ((x - cx) ** 2 + (y - cy) ** 2 > lim) continue;
        ctx.fillStyle = 'rgba(43, 33, 24, 0.55)';
        ctx.strokeStyle = 'rgba(255, 233, 168, 0.8)';
        ctx.lineWidth = 1;
        ctx.setLineDash(DASH_UNFOUND);
        ctx.beginPath();
        ctx.arc(x, y, 5.5 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash(DASH_NONE);
        ctx.fillStyle = '#ffe9a8';
        ctx.fillText('?', x, y + 2.5 * s);
      }
    }
    // Found: a star and the name.
    const found = this._labels;
    for (let i = 0; i < found.length; i++) {
      const p = found[i];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
      // The depot already has its own house on the map.
      if (d.depot && Math.hypot(p.x - d.depot.x, p.z - d.depot.z) < 60) continue;
      const x = mx(p.x);
      const y = my(p.z);
      if ((x - cx) ** 2 + (y - cy) ** 2 > lim) continue;
      star(ctx, x, y, 4.6 * s, '#ffd23f');
      if (p.text) label(ctx, String(p.text), x, y - 8 * s, '#ffe9a8', ts);
    }
  }

  /**
   * Names for the van's map, from jobs.js (IslandRoads.labels): [{ x, z, text }].
   * The map also reads `sim.islandRoads` itself, so this is belt and braces —
   * but it is the call jobs.js makes, and it now does what it says.
   */
  setLabels(list) {
    this._labels = Array.isArray(list) ? list : [];
    this._acc = 1;
  }

  /* ---- mode: helicopter ---------------------------------------- */

  /**
   * The pads.
   *
   * The whole helicopter game is "get to that pad", and a pad is eleven
   * metres across — at the 6 km range that is a third of a screen pixel. So
   * the pads are drawn at a size that has nothing to do with their real one:
   * a ring you can see, with the real footprint inside it once the zoom is
   * close enough for the real footprint to be more than a dot.
   *
   * And the ones off the edge get an arrow on the bezel. Eight pads on the
   * rigs map and six of them off the screen is the normal case, not the
   * exception, and a map that simply does not mention them is a map that
   * answers the easy question only.
   */
  drawHeli(g, d) {
    const { ctx, k, cx, cy, mx, my, craft } = g;
    if (!PADS.length) return;

    const edge = SIZE / 2 - 2;
    const offscreen = this._off || (this._off = []);
    offscreen.length = 0;

    // The real footprints, where they are big enough to mean anything.
    const foot = PADS[0].r * k;
    if (foot > 2) {
      ctx.strokeStyle = 'rgba(240, 246, 252, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const p of PADS) addDot(ctx, mx(p.pos.x), my(p.pos.z), p.r * k);
      ctx.stroke();
    }

    // The rings. One path per role, one stroke per role.
    for (let q = 0; q < PAD_ROLES.length; q++) {
      const role = PAD_ROLES[q];
      let any = false;
      ctx.beginPath();
      for (let i = 0; i < PADS.length; i++) {
        const p = PADS[i];
        const isHosp = p.role === 'hospital';
        if ((role === 'hospital') !== isHosp) continue;
        const x = mx(p.pos.x);
        const y = my(p.pos.z);
        if (Math.hypot(x - cx, y - cy) > edge - 4) {
          offscreen.push(p);
          continue;
        }
        addDot(ctx, x, y, 5.5);
        any = true;
      }
      if (!any) continue;
      ctx.fillStyle = role === 'hospital' ? 'rgba(214, 58, 58, 0.75)' : 'rgba(12, 20, 30, 0.62)';
      ctx.fill();
      ctx.strokeStyle = role === 'hospital' ? '#ffd8d8' : '#f0f6fc';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    /*
     * The H, and the cross on a hospital.
     *
     * Two glyphs for every pad on the map, in two paths. A hospital gets a
     * cross because that is the symbol it has in the real world and on the
     * roof of the building the pad is on — the same picture from the air and
     * on the map is worth more than any amount of colour coding.
     */
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (const p of PADS) {
      const x = mx(p.pos.x);
      const y = my(p.pos.z);
      if (Math.hypot(x - cx, y - cy) > edge - 4) continue;
      if (p.role === 'hospital') {
        ctx.moveTo(x, y - 3);
        ctx.lineTo(x, y + 3);
        ctx.moveTo(x - 3, y);
        ctx.lineTo(x + 3, y);
      } else {
        ctx.moveTo(x - 2.2, y - 3);
        ctx.lineTo(x - 2.2, y + 3);
        ctx.moveTo(x + 2.2, y - 3);
        ctx.lineTo(x + 2.2, y + 3);
        ctx.moveTo(x - 2.2, y);
        ctx.lineTo(x + 2.2, y);
      }
    }
    ctx.stroke();

    /*
     * Arrows on the bezel for the pads that are off it.
     *
     * Capped at four. Ten arrows round a 190-pixel circle is a sunburst, and
     * the four nearest are the only ones anybody is going to fly to next.
     */
    if (offscreen.length) {
      // The four nearest, by insertion into four slots — the sort this was
      // made a comparator closure every frame and sorted the lot.
      const near = this._offNear || (this._offNear = [null, null, null, null]);
      const nd = this._offNearD || (this._offNearD = [0, 0, 0, 0]);
      near[0] = near[1] = near[2] = near[3] = null;
      nd[0] = nd[1] = nd[2] = nd[3] = Infinity;
      for (let i = 0; i < offscreen.length; i++) {
        const p = offscreen[i];
        const d2 = (p.pos.x - craft.x) ** 2 + (p.pos.z - craft.z) ** 2;
        for (let j = 0; j < 4; j++) {
          if (d2 >= nd[j]) continue;
          for (let m = 3; m > j; m--) {
            nd[m] = nd[m - 1];
            near[m] = near[m - 1];
          }
          nd[j] = d2;
          near[j] = p;
          break;
        }
      }
      ctx.fillStyle = 'rgba(240, 246, 252, 0.8)';
      ctx.beginPath();
      const s = Math.min(g.ts, 1.5);
      for (let i = 0; i < 4; i++) {
        const p = near[i];
        if (!p) break;
        const a = Math.atan2(p.pos.z - craft.z, p.pos.x - craft.x);
        const bx = cx + Math.cos(a) * (edge - 7 * s);
        const by = cy + Math.sin(a) * (edge - 7 * s);
        ctx.moveTo(bx + Math.cos(a) * 5 * s, by + Math.sin(a) * 5 * s);
        ctx.lineTo(bx + Math.cos(a + 2.5) * 4.5 * s, by + Math.sin(a + 2.5) * 4.5 * s);
        ctx.lineTo(bx + Math.cos(a - 2.5) * 4.5 * s, by + Math.sin(a - 2.5) * 4.5 * s);
      }
      ctx.fill();
    }
  }

  /* ---- shared: the objective, you, the footer, the warning ------ */

  /**
   * The objective.
   *
   * A diamond rather than another dot, with its name and its distance beside
   * it, so the map answers "what" and "how far" without anybody doing
   * arithmetic. It means the same thing in a boat, a van and a helicopter.
   * Off the edge of the map it becomes an arrow on the rim instead — see
   * drawRimArrows.
   */
  drawTarget(g) {
    const { ctx, mx, my, craft, ts, cx, cy, edge } = g;
    const target = g.target;
    if (!target || !target.pos) return;
    const tx = mx(target.pos.x);
    const ty = my(target.pos.z);
    if ((tx - cx) ** 2 + (ty - cy) ** 2 > (edge - 6) ** 2) return; // the rim arrow has it
    const s = Math.min(ts, 1.5);
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#7dffb4';
    ctx.strokeStyle = 'rgba(8,14,22,0.8)';
    ctx.lineWidth = 1;
    ctx.fillRect(-3.4 * s, -3.4 * s, 6.8 * s, 6.8 * s);
    ctx.strokeRect(-3.4 * s, -3.4 * s, 6.8 * s, 6.8 * s);
    ctx.restore();
    ctx.strokeStyle = `rgba(125,255,180,${0.5 + Math.sin(g.t * 3) * 0.2})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(tx, ty, (9 + Math.sin(g.t * 3) * 2) * s, 0, Math.PI * 2);
    ctx.stroke();
    const dist = km(Math.hypot(target.pos.x - craft.x, target.pos.z - craft.z));
    // Above the diamond, unless that would put it on top of you in the middle
    // (the objective just below you) — then below it.
    const nearYou = Math.abs(tx - cx) < 40 * ts && ty - cy > -2 * s && ty - cy < 31 * s;
    label(ctx, targetWords(target, dist), tx, nearYou ? ty + 19 * s : ty - 13 * s, 'rgba(190, 255, 220, 0.95)', ts);
  }

  /**
   * Arrows on the rim for what is off the edge (bug 7).
   *
   * The objective, always, in green with its distance. And in the aeroplane
   * and the helicopter with nothing to aim at, the airfield, in white — "which
   * way is home" is the question a ten-year-old who has flown out over the
   * sea actually has, and the map used to answer it with blue.
   */
  drawRimArrows(g) {
    const { ctx, mx, my, craft, cx, cy, edge, ts, mode, target } = g;
    const lim = (edge - 6) ** 2;
    if (target && target.pos) {
      const tx = mx(target.pos.x);
      const ty = my(target.pos.z);
      if ((tx - cx) ** 2 + (ty - cy) ** 2 > lim) {
        const a = Math.atan2(target.pos.z - craft.z, target.pos.x - craft.x);
        rimArrow(ctx, cx, cy, edge, a, '#7dffb4', km(Math.hypot(target.pos.x - craft.x, target.pos.z - craft.z)), ts);
      }
      return;
    }
    if (mode === 'car') {
      // A free drive with nothing to aim at: which way the nearest place you
      // have not found is, when it is off the map. On the map it is its "?".
      const next = unfoundNearest(g.sim && g.sim.islandRoads, craft);
      if (!next) return;
      const nx = mx(next.pos.x);
      const ny = my(next.pos.z);
      if ((nx - cx) ** 2 + (ny - cy) ** 2 <= lim) return;
      const a = Math.atan2(next.pos.z - craft.z, next.pos.x - craft.x);
      rimArrow(ctx, cx, cy, edge, a, '#ffe9a8', `? ${km(Math.hypot(next.pos.x - craft.x, next.pos.z - craft.z))}`, ts);
      return;
    }
    if (mode !== 'flight' && mode !== 'heli') return;
    const R = AIRPORT && AIRPORT.runway;
    if (!R) return;
    // The nearest bit of runway, not its middle: with one end of it on the
    // map there is nothing to point at.
    const nx = Math.max(R.cx - R.length / 2, Math.min(R.cx + R.length / 2, craft.x));
    const nz = R.cz;
    const rx = mx(nx);
    const ry = my(nz);
    if ((rx - cx) ** 2 + (ry - cy) ** 2 <= lim) return;
    const a = Math.atan2(nz - craft.z, nx - craft.x);
    rimArrow(ctx, cx, cy, edge, a, 'rgba(236, 244, 252, 0.92)', `airfield ${km(Math.hypot(nx - craft.x, nz - craft.z))}`, ts);
  }

  /**
   * You, in the middle, pointing where you are pointing — with the track you
   * are on drawn ahead of you.
   *
   * The line is a minute of travel at the speed you are doing. It is the one
   * thing on the map that answers "where will I be", which is a better
   * question than "where am I" and the whole reason to look at a map while
   * moving rather than after arriving.
   *
   * A minute is right for an aeroplane and wrong for everything else. A boat
   * at five knots goes 150 m in a minute, which at the 1.6 km range is nine
   * pixels and reads as no line at all; a van in a town does thirty seconds
   * of useful lookahead and no more. So the lead time is per vehicle, and the
   * shapes are per vehicle too — a swept aeroplane, a hull, a van and a rotor
   * disc, each of which is recognisable at nine pixels where a triangle is
   * just a cursor. Going astern, the line goes astern.
   */
  drawOwnCraft(g) {
    const { ctx, cx, cy, k, craft, mode, ts } = g;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((craft.headingDeg * Math.PI) / 180);

    const leadSecs = mode === 'flight' ? 60 : mode === 'heli' ? 30 : mode === 'car' ? 30 : 90;
    const lead = Math.min(SIZE * 0.42, Math.max(10, craft.speed * leadSecs * k));
    const back = craft.speedSigned < -0.2;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash(DASH_TRACK);
    ctx.beginPath();
    ctx.moveTo(0, back ? 8 : -8);
    ctx.lineTo(0, back ? lead : -lead);
    ctx.stroke();
    ctx.setLineDash(DASH_NONE);

    // A little bigger than the traffic, and bigger again when the map is shown
    // small, so "which one is me" never needs asking.
    const s = 1.12 * Math.min(ts, 1.5);
    ctx.scale(s, s);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(8,14,22,0.9)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    if (mode === 'flight') {
      // The aeroplane: a swept symbol with a tail.
      ctx.moveTo(0, -8.5);
      ctx.lineTo(1.6, -2);
      ctx.lineTo(7.5, 2.2);
      ctx.lineTo(7.5, 4);
      ctx.lineTo(1.6, 2.4);
      ctx.lineTo(1.4, 6);
      ctx.lineTo(3.4, 7.4);
      ctx.lineTo(3.4, 8.6);
      ctx.lineTo(0, 7.6);
      ctx.lineTo(-3.4, 8.6);
      ctx.lineTo(-3.4, 7.4);
      ctx.lineTo(-1.4, 6);
      ctx.lineTo(-1.6, 2.4);
      ctx.lineTo(-7.5, 4);
      ctx.lineTo(-7.5, 2.2);
      ctx.lineTo(-1.6, -2);
      ctx.closePath();
    } else if (mode === 'boat') {
      // A hull seen from above: pointed bow, square transom.
      ctx.moveTo(0, -8);
      ctx.lineTo(3.1, -2.4);
      ctx.lineTo(3.4, 6);
      ctx.lineTo(-3.4, 6);
      ctx.lineTo(-3.1, -2.4);
      ctx.closePath();
    } else if (mode === 'car') {
      // A van: a box with a cab end, which is enough to say which way it faces.
      ctx.moveTo(-2.8, -7);
      ctx.lineTo(2.8, -7);
      ctx.lineTo(3.4, -4);
      ctx.lineTo(3.4, 7);
      ctx.lineTo(-3.4, 7);
      ctx.lineTo(-3.4, -4);
      ctx.closePath();
    } else {
      // The helicopter: a small body, and the rotor disc drawn round it,
      // because the disc is the thing that has to clear the rock.
      ctx.moveTo(0, -6);
      ctx.lineTo(2.2, -1);
      ctx.lineTo(1.4, 4);
      ctx.lineTo(1.1, 8.4);
      ctx.lineTo(-1.1, 8.4);
      ctx.lineTo(-1.4, 4);
      ctx.lineTo(-2.2, -1);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();

    if (mode === 'heli') {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, 7.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * The one number along the bottom. Returns the top of what it drew, so the
   * scale can go above it rather than on top of it.
   *
   * Flight has none: the altimeter is three inches away on the panel. The
   * other three each have exactly one number that the map, and only the map,
   * can answer.
   */
  drawFoot(g, d) {
    const { ctx, craft, mode, ts } = g;
    let text = '';
    if (mode === 'boat') {
      // Floored at 0: a touch under it printed "UNDER KEEL -0.0 m".
      const u = Math.max(0, depthUnderKeel(craft.x, craft.z, craft.draught));
      text = craft.aground ? 'AGROUND' : `UNDER KEEL ${u < 10 ? u.toFixed(1) : Math.round(u)} m`;
    } else if (mode === 'car') {
      /*
       * A job: where it wants you. No job, on a free drive: how far to the
       * nearest place you have not found — the next thing to do, which is the
       * whole of free driving. Otherwise the depot, and "AT THE DEPOT" when you
       * are standing in it: a free drive starts there, and the footer used to
       * greet it with "DEPOT 0.0 km".
       */
      const t = g.target;
      const next = t ? null : unfoundNearest(g.sim && g.sim.islandRoads, craft);
      if (t) text = `${String(t.label || 'destination').toUpperCase()}  ${km(Math.hypot(t.pos.x - craft.x, t.pos.z - craft.z))}`;
      else if (next) text = `SOMEWHERE NEW  ${km(Math.hypot(next.pos.x - craft.x, next.pos.z - craft.z))}`;
      else if (d.depot) {
        const dd = Math.hypot(d.depot.x - craft.x, d.depot.z - craft.z);
        text = dd < 150 ? 'AT THE DEPOT' : `DEPOT  ${km(dd)}`;
      }
    } else {
      const p = nearestPad(craft.x, craft.z);
      if (p) {
        text = `${p.name.toUpperCase()}  ${km(Math.hypot(p.pos.x - craft.x, p.pos.z - craft.z))}`;
      }
    }
    if (!text) return SIZE - 6;
    const px = 8 * ts;
    const h = 12 * ts;
    const top = SIZE - 8 - h;
    ctx.font = `700 ${px}px ${FONT}`;
    ctx.textAlign = 'center';
    let w = ctx.measureText(text).width;
    // Never wider than the circle is at that height.
    const room = 2 * Math.sqrt(Math.max(0, (SIZE / 2) ** 2 - (top + h / 2 - SIZE / 2) ** 2)) - 16;
    if (w > room) {
      ctx.font = `700 ${(px * room) / w}px ${FONT}`;
      w = room;
    }
    ctx.fillStyle = 'rgba(6, 12, 20, 0.7)';
    ctx.fillRect(SIZE / 2 - w / 2 - 5, top, w + 10, h);
    ctx.fillStyle = '#dfeaf4';
    ctx.fillText(text, SIZE / 2, top + h * 0.72);
    return top;
  }

  /**
   * What is about to go wrong, if anything.
   *
   * Same idea in all four: look ahead along the track you are on for as long
   * as you have time to do something about it, and say what is there. The
   * thing being looked for is different, because the thing that kills you is
   * different — a hill, a rock, or nothing at all in a van, where the useful
   * warning is that you have driven off the only road on the island.
   */
  warningFor(g, d) {
    const { craft, mode } = g;
    if (craft.crashed) return null;

    if (mode === 'flight' || mode === 'heli') {
      /*
       * Terrain ahead: rising ground the track you are on will pass too close
       * to in the next half minute (fourteen seconds in the helicopter), not
       * counting the airfield, decks and pads — `terrainConflict` above, the
       * same answer the cockpit warning panel gets.
       *
       * The helicopter needs some speed before a track means anything: at a
       * hover it is a point, and scanning along it says "TERRAIN" about the
       * hillside you are deliberately holding station beside.
       */
      if (craft.onGround) return null;
      const s = aircraftLookahead(g.sim.aircraft, mode === 'heli');
      return Number.isFinite(s) ? `TERRAIN — ${Math.round(s)}s` : null;
    }

    if (mode === 'boat') {
      if (craft.aground) return 'AGROUND';
      /*
       * Shallow water ahead — which is the boat's whole version of this, and
       * a harder problem than the hill, because the hill is visible and the
       * rock is not. Ninety seconds of lookahead at the speed she is doing,
       * and the test is the depth under the keel rather than the depth,
       * because a metre of water is deep for a dinghy and aground for this.
       */
      const bp = this._shoalP || (this._shoalP = { x: 0, z: 0, headingDeg: 0, speed: 0, draught: 1 });
      bp.x = craft.x;
      bp.z = craft.z;
      bp.headingDeg = craft.headingDeg;
      bp.speed = craft.speedSigned;
      bp.draught = craft.draught;
      const s = shoalConflict(bp);
      return Number.isFinite(s) ? `SHOAL — ${Math.round(s)}s` : null;
    }

    /*
     * The van. There is nothing ahead of it that can kill it, so the warning
     * is the one thing that actually goes wrong: the road is behind you.
     * Silent while the map has no roads on it at all, because on a map with
     * no network that would mean a warning light that never goes out.
     */
    if (!d.roads.length) return null;
    let best = Infinity;
    for (const rd of d.roads) {
      if (!rd || !rd.path) continue;
      const lim = (rd.halfWidth || 26) + (rd.blend || 55);
      best = Math.min(best, distToPath(craft.x, craft.z, rd.path) - lim);
      if (best <= 0) break;
    }
    return best > 40 ? 'OFF ROAD' : null;
  }

  /**
   * Only touches the DOM when the words change. On a map drawn small — a
   * phone shows it at 84 px — "TERRAIN — 12s" is wider than the circle and was
   * clipped to "ERRAIN — 1", so there it is the word alone.
   */
  setWarning(text) {
    let t = text || null;
    if (t && this.textScale >= 1.5) t = t.replace(/\s+—.*$/, '');
    if (t === this._warnText) return;
    this._warnText = t;
    if (t) {
      this.warn.style.display = '';
      this.warn.textContent = t;
      this.el.classList.add('is-alert');
    } else {
      this.warn.style.display = 'none';
      this.el.classList.remove('is-alert');
    }
  }
}

/**
 * Is there a free drive's marker within 250 m of here — a "?" for a place not
 * found, or a star with a name for one found? Not the depot's own place:
 * drawDiscoveries leaves that to the depot's house, so the address there
 * keeps its name.
 */
function islandPlaceNear(ir, x, z, depot) {
  const ps = ir && ir.places;
  if (!Array.isArray(ps)) return false;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i] && ps[i].pos;
    if (!p || (p.x - x) ** 2 + (p.z - z) ** 2 >= 62500) continue;
    if (ps[i].found && depot && Math.hypot(p.x - depot.x, p.z - depot.z) < 60) continue;
    return true;
  }
  return false;
}

/** The nearest place on a free drive not found yet, or null. */
function unfoundNearest(ir, craft) {
  const ps = ir && ir.places;
  if (!Array.isArray(ps)) return null;
  let best = null;
  let bd = Infinity;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (!p || p.found || !p.pos || !Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.z)) continue;
    const d2 = (p.pos.x - craft.x) ** 2 + (p.pos.z - craft.z) ** 2;
    if (d2 < bd) {
      bd = d2;
      best = p;
    }
  }
  return best;
}

/**
 * "the town 1.1 km" — the objective's own name where it has a useful one,
 * shortened so it fits over a 190-pixel map.
 */
function targetWords(target, dist) {
  let name = target && target.label ? String(target.label) : '';
  if (/^(target|destination)$/i.test(name)) name = '';
  if (name.length > 16) name = `${name.slice(0, 15)}…`;
  return name ? `${name} ${dist}` : dist;
}

/* ------------------------------------------------------------------ */
/* Geometry the map works out for itself                               */
/* ------------------------------------------------------------------ */

/** Perpendicular distance from a point to a polyline, in metres. */
function distToPath(x, z, path) {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1][0];
    const az = path[i - 1][1];
    const ex = path[i][0] - ax;
    const ez = path[i][1] - az;
    const len2 = ex * ex + ez * ez;
    let t = len2 > 0 ? ((x - ax) * ex + (z - az) * ez) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + ex * t - x;
    const qz = az + ez * t - z;
    const d2 = qx * qx + qz * qz;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/**
 * The closest the two line segments a0→a1 and b0→b1 ever come, and where.
 *
 * If they cross, that is the point and the distance is zero. If they do not,
 * the closest approach of two segments in the plane is always AT AN ENDPOINT
 * of one of them, so four point-to-segment tests settle it exactly — no
 * iteration, no tolerance, no parameter solve that degenerates when the two
 * are parallel.
 */
function segClosest(ax, az, bx, bz, cx, cz, dx, dz) {
  const rx = bx - ax;
  const rz = bz - az;
  const sx = dx - cx;
  const sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) > 1e-9) {
    const t = ((cx - ax) * sz - (cz - az) * sx) / den;
    const u = ((cx - ax) * rz - (cz - az) * rx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      return { d: 0, x: ax + rx * t, z: az + rz * t };
    }
  }
  let best = Infinity;
  let bxx = ax;
  let bzz = az;
  const test = (px, pz, qx, qz, ex, ez) => {
    const len2 = ex * ex + ez * ez;
    let t = len2 > 0 ? ((px - qx) * ex + (pz - qz) * ez) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const nx = qx + ex * t;
    const nz = qz + ez * t;
    const d = Math.hypot(px - nx, pz - nz);
    if (d < best) {
      best = d;
      bxx = (px + nx) / 2;
      bzz = (pz + nz) / 2;
    }
  };
  test(ax, az, cx, cz, sx, sz);
  test(bx, bz, cx, cz, sx, sz);
  test(cx, cz, ax, az, rx, rz);
  test(dx, dz, ax, az, rx, rz);
  return { d: best, x: bxx, z: bzz };
}

/**
 * Where two roads meet, worked out rather than authored.
 *
 * Authored junctions drift out of step with the roads the moment anybody
 * moves a waypoint — the same argument `channelMarks` makes about buoys, and
 * it is the right one. If the road router publishes its own junction list
 * this is never called; it is the fallback that makes `MAP.waters.roads`
 * useful on its own.
 *
 * SEGMENT against segment, not vertex against road. That distinction is the
 * whole function: the first version of this compared each road's CORNERS to
 * the other road, and a plain crossroads — two straight roads crossing at
 * right angles in the middle of both — has no corner anywhere near the
 * crossing, so it found nothing. Measured: two 2 km roads crossing at the
 * origin, zero junctions. It is the commonest junction there is.
 *
 * Every crossing is reported, not one per pair, because a coast road can
 * perfectly well cross a valley road twice; near-duplicates inside one road
 * width of each other collapse into one, so a road that runs alongside
 * another for a kilometre is one junction and not forty.
 *
 * O(segments²), run once per map and cached by `derivedFor`. Kestrel's single
 * road never enters the loop at all; twenty-four ten-segment roads is 28,800
 * segment pairs, which is the worst case anyone could author and is still
 * under a millisecond, once.
 */
function junctionsOf(roads) {
  const out = [];
  if (roads.length < 2) return out;
  for (let a = 0; a < roads.length; a++) {
    for (let b = a + 1; b < roads.length; b++) {
      const near = ((roads[a].halfWidth || 26) + (roads[b].halfWidth || 26)) * 1.6;
      const pa = roads[a].path;
      const pb = roads[b].path;
      for (let i = 1; i < pa.length; i++) {
        for (let j = 1; j < pb.length; j++) {
          const c = segClosest(
            pa[i - 1][0], pa[i - 1][1], pa[i][0], pa[i][1],
            pb[j - 1][0], pb[j - 1][1], pb[j][0], pb[j][1]
          );
          if (c.d > near) continue;
          const dup = out.find((k) => (k.x - c.x) ** 2 + (k.z - c.z) ** 2 < near * near * 4);
          if (dup) dup.ways = Math.max(dup.ways, 2);
          else out.push({ x: c.x, z: c.z, ways: 2 });
        }
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Self-test                                                           */
/* ------------------------------------------------------------------ */

/**
 * Headless check, for node and for the in-game console.
 *
 * It exists for one reason above the others: to prove that FLIGHT MODE STILL
 * DRAWS WHAT IT DREW. Pass it a context recorder and the sim, and it returns
 * the list of canvas operations; the harness compares the flight list against
 * the one the old file produced and they must match operation for operation.
 */
export function __minimapModes() {
  return Object.keys(MODES);
}
export function __minimapRanges(mode) {
  return (MODES[mode] || MODES.flight).ranges.slice();
}
export { junctionsOf as __junctionsOf, distToPath as __distToPath, bandOf as __bandOf, segClosest as __segClosest };
