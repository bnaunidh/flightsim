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
 * FLIGHT MODE IS UNCHANGED. Not "mostly unchanged" — the flight path through
 * this file issues the same canvas operations in the same order against the
 * same relief tile as the file it replaces. That is deliberate and it is
 * testable: see `__minimapSelfTest` at the foot of the file.
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
 * 'bathy' (boat). The car and the helicopter re-use the aeroplane's relief
 * and modify it with a single translucent rectangle, which costs one draw
 * call and no sampling at all. Only picking up a boat ever builds a second
 * 512² tile — and that one, alone of the four, is a WINDOW that follows the
 * boat rather than a picture of the whole map, for the measured reason set
 * out at BATHY_EXTENT below. It is double-buffered, so a re-centre happens
 * behind a chart that is already on screen and nothing ever goes blank.
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
  heightAt,
  depthUnderKeel,
  channelMarks,
  dryingShoals,
  harbourBerth,
  harbourMouth,
} from '../world/terrain.js';
import { PADS, nearestPad } from '../world/pads.js';
import { SPEC } from '../aircraft/physics.js';

const SIZE = 190;

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
 */
const MODES = {
  flight: { chart: 'relief', ranges: [3000, 6000, 12000, 24000], start: 1 },
  boat: { chart: 'bathy', ranges: [1200, 2400, 4800, 9600], start: 1 },
  car: { chart: 'relief', ranges: [1000, 2000, 4000, 8000], start: 1 },
  heli: { chart: 'relief', ranges: [2000, 4000, 8000, 16000], start: 1 },
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
const BATHY_EXTENT = 12000;
const BATHY_RECENTRE = BATHY_EXTENT / 2 - MODES.boat.ranges[MODES.boat.ranges.length - 1] / 2;
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
function craftOf(sim, mode) {
  if (mode === 'boat' || mode === 'car') {
    const v = sim.vehicle;
    const spec = (v && v.spec) || {};
    return {
      x: v.pos.x,
      y: v.pos.y,
      z: v.pos.z,
      headingDeg: v.heading,
      speed: Math.abs(v.speed || 0),
      vy: 0,
      onGround: true,
      crashed: !!v.crashed,
      aground: !!v.aground,
      draught: spec.draught || 1,
      kind: spec.kind || 'boat',
    };
  }
  const ac = sim.aircraft;
  const r = ac.readouts();
  return {
    x: ac.pos.x,
    y: ac.pos.y,
    z: ac.pos.z,
    headingDeg: r.heading,
    speed: ac.groundSpeed,
    vy: ac.vel ? ac.vel.y : 0,
    onGround: !!ac.onGround,
    crashed: !!ac.crashed,
    aground: false,
    draught: 0,
    kind: mode === 'heli' ? 'heli' : 'aeroplane',
  };
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
    this.used = 0;
  }

  get done() {
    return this.row >= TILE;
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
   */
  slice(rows = TILE_ROWS_PER_FRAME) {
    const half = this.extent / 2;
    const step = this.extent / TILE;
    const pal = PALETTE || {};
    const tint = (rgb, mul) => [
      Math.min(255, rgb[0] * (mul ? mul[0] : 1)),
      Math.min(255, rgb[1] * (mul ? mul[1] : 1)),
      Math.min(255, rgb[2] * (mul ? mul[2] : 1)),
    ];
    // Base colours, warped by the map's own palette so a desert map gets a
    // desert chart rather than a tropical one painted the wrong colour.
    const SAND = tint([176, 158, 118], pal.sand);
    const GRASS = tint([74, 104, 62], pal.grass);
    const ROCK = tint([124, 116, 104], pal.rock);
    // The boat chart's land is one flat buff. A chart's land is not the
    // subject; it is the thing the water stops at.
    const LAND = tint([198, 184, 152], pal.sand);
    const bathy = this.kind === 'bathy';
    const end = Math.min(TILE, this.row + rows);
    const img = this.ctx.createImageData(TILE, end - this.row);
    const d = img.data;
    const row = new Float32Array(TILE);
    for (let j = this.row; j < end; j++) {
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
    this.ctx.putImageData(img, 0, this.row);
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

/** Text with a dark plate behind it, because white on pale blue is nothing. */
function label(ctx, text, x, y, colour) {
  ctx.font = '600 8px "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  const w = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(8, 14, 22, 0.62)';
  ctx.fillRect(x - w / 2 - 2, y - 7.5, w + 4, 10);
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
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

    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE * 2;
    this.canvas.height = SIZE * 2;
    this.canvas.className = 'minimap-canvas';
    this.ctx = this.canvas.getContext('2d');
    this.ctx.scale(2, 2);

    this.warn = document.createElement('div');
    this.warn.className = 'minimap-warn';
    this.warn.style.display = 'none';

    this.scaleLabel = document.createElement('div');
    this.scaleLabel.className = 'minimap-scale';

    this.el.appendChild(this.canvas);
    this.el.appendChild(this.warn);
    this.el.appendChild(this.scaleLabel);
    root.appendChild(this.el);

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
    this.bathy = { cur: null, next: null, curFor: null, nextFor: null };

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

  get visible() {
    return this.el.style.display !== 'none';
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
    this.el.style.display = this._suppressed || !this._want ? 'none' : '';
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
    this.el.style.display = on && !this._suppressed ? '' : 'none';
    return on;
  }

  /** Step through the zoom levels of the mode you are in. */
  cycleRange() {
    const m = MODES[this.mode] || MODES.flight;
    this.rangeIndex[this.mode] = (this.rangeIndex[this.mode] + 1) % m.ranges.length;
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
    return mode;
  }

  /* ---- charts and derived data --------------------------------- */

  /**
   * The chart for this map and this kind, built or building.
   *
   * Its extent covers everything anyone can reach: the furthest island edge
   * on this map, with a wide margin of sea around it so the coastline is not
   * clipped by the edge of the image.
   */
  chartFor(kind, craft) {
    /*
     * The bathymetric chart is a sliding window and gets its own book-keeping,
     * because it is the only one that is ever thrown away mid-voyage.
     */
    if (kind === 'bathy') return this.bathyChart(craft);
    const key = `${MAP && MAP.id}|${kind}`;
    let c = this.charts.get(key);
    if (!c) {
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
   * The boat's chart: 12 km of sea, centred near the boat, double-buffered.
   *
   * `cur` is what is on screen. When the boat wanders more than BATHY_RECENTRE
   * from the middle of it, `next` is started, centred on the boat, and built
   * ten rows a frame BEHIND the one that is showing — half the usual rate,
   * because there is no hurry: nothing is missing from the screen while it
   * happens, and half the rate is half the frame cost.
   *
   * `nextFor` keys the pending chart to the map as well as the position, so
   * changing map mid-build does not swap in a chart of somewhere else.
   */
  bathyChart(craft) {
    const id = MAP && MAP.id;
    const b = this.bathy;
    /*
     * A chart centred on NaN samples NaN for a quarter of a million pixels
     * and comes back a black square that never rebuilds, because the offset
     * test against NaN is false forever. One line, and it has been paid for
     * elsewhere in this project already.
     */
    const px = Number.isFinite(craft.x) ? Math.round(craft.x) : 0;
    const pz = Number.isFinite(craft.z) ? Math.round(craft.z) : 0;
    if (!b.cur || b.curFor !== id) {
      b.cur = new Chart('bathy', BATHY_EXTENT, px, pz);
      b.curFor = id;
      b.next = null;
      return b.cur;
    }
    if (!b.cur.done) return b.cur;
    const off = Math.max(Math.abs(px - b.cur.cx), Math.abs(pz - b.cur.cz));
    if (!b.next && off > BATHY_RECENTRE) {
      b.next = new Chart('bathy', BATHY_EXTENT, px, pz);
      b.nextFor = id;
    }
    if (b.next) {
      if (b.nextFor !== id) b.next = null;
      else {
        b.next.slice(TILE_ROWS_BACKGROUND);
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
   */
  update(dt, sim) {
    if (!this.visible) return;
    this.t += dt;

    const mode = resolveMode(sim);
    if (mode !== this.mode) this.setMode(mode);
    this.ranges = MODES[mode].ranges;

    const ctx = this.ctx;
    const craft = craftOf(sim, mode);
    const span = this.span;
    const k = SIZE / span; // pixels per metre
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    // World → map. North (-Z) is up.
    const mx = (x) => cx + (x - craft.x) * k;
    const my = (z) => cy + (z - craft.z) * k;

    ctx.clearRect(0, 0, SIZE, SIZE);

    // The chart. Rebuilt when the map or the vehicle changes, twenty rows a
    // frame; whatever is finished is what gets drawn.
    const chart = this.chartFor(MODES[mode].chart, craft);
    this.chart = chart;
    if (!chart.done) chart.slice();

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
     * window is looking at, and let the canvas scale it.
     */
    const ppm = TILE / chart.extent; // chart pixels per metre
    const half = chart.extent / 2;
    const sw = span * ppm;
    const sx = (craft.x - chart.cx + half) * ppm - sw / 2;
    const sy = (craft.z - chart.cz + half) * ppm - sw / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(chart.canvas, sx, sy, sw, sw, 0, 0, SIZE, SIZE);

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
    for (const f of [0.25, 0.5]) {
      ctx.beginPath();
      ctx.arc(cx, cy, (SIZE / 2 - 2) * f * 2 * 0.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    const g = { ctx, cx, cy, k, span, mx, my, craft, sim, t: this.t, mode };
    const d = this.derivedFor(sim, mode);

    if (mode === 'flight') this.drawFlight(g);
    else if (mode === 'boat') this.drawBoat(g, d);
    else if (mode === 'car') this.drawCar(g, d);
    else this.drawHeli(g, d);

    // Hazards: a tornado is worth a great deal of ink, in any vehicle.
    if (sim.tornado && sim.tornado.active) {
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

    // The objective. One symbol in all four games, because it is one idea:
    // the place the game is currently asking you to get to.
    this.drawTarget(g);

    /*
     * Every aeroplane on the map.
     *
     * Right now that is you and nothing else, because there is no other
     * traffic in the game yet — so rather than pretend, this draws whatever
     * `sim.traffic` contains and simply finds it empty. When there is traffic
     * to show, it will already be here.
     */
    for (const other of sim.traffic || []) {
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.arc(mx(other.pos.x), my(other.pos.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

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
    ctx.font = '700 10px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', cx, 23);

    this.scaleLabel.textContent = span >= 1000 ? `${span / 1000} km` : `${span} m`;

    // The one number this vehicle is steered by, along the bottom of the
    // glass. Drawn on the canvas rather than in a new element, because a new
    // element needs a new CSS rule and the stylesheet is not mine this hour.
    if (mode !== 'flight') this.drawFoot(g, d);

    this.setWarning(this.warningFor(g, d));
  }

  /* ---- mode: flight -------------------------------------------- */

  /**
   * The aviation chart, exactly as it was.
   *
   * The runway, drawn where it really is: a dark strip with a centreline,
   * which is what tells it apart from a road at a glance.
   */
  drawFlight(g) {
    const { ctx, k, mx, my } = g;
    const R = AIRPORT.runway;
    const rw = Math.max(2.5, 60 * k);
    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(18, 22, 28, 0.9)';
    ctx.lineWidth = rw;
    ctx.beginPath();
    ctx.moveTo(mx(R.cx - R.length / 2), my(R.cz));
    ctx.lineTo(mx(R.cx + R.length / 2), my(R.cz));
    ctx.stroke();
    ctx.strokeStyle = '#f2f6fa';
    ctx.lineWidth = Math.max(1, rw * 0.3);
    ctx.beginPath();
    ctx.moveTo(mx(R.cx - R.length / 2), my(R.cz));
    ctx.lineTo(mx(R.cx + R.length / 2), my(R.cz));
    ctx.stroke();
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
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      addPath(ctx, d.channel, mx, my);
      ctx.stroke();
      ctx.setLineDash([]);
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
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      for (const s of d.dries) {
        const r = Math.max(3, s.r * k);
        ctx.moveTo(mx(s.cx) + r, my(s.cz));
        ctx.arc(mx(s.cx), my(s.cz), r, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      // The asterisks, all of them in one path and one stroke.
      ctx.strokeStyle = '#ffd682';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (const s of d.dries) {
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
      for (const kind of ['port', 'starboard', 'fairway']) {
        let any = false;
        ctx.beginPath();
        for (const b of d.buoys) {
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
        ctx.setLineDash([4, 5]);
        ctx.beginPath();
        for (const rd of roads) addPath(ctx, rd.path, mx, my);
        ctx.stroke();
        ctx.setLineDash([]);
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
      const drivable = [];
      const not = [];
      for (const p of d.places) (p.boatOnly ? not : drivable).push(p);
      if (drivable.length) {
        ctx.fillStyle = '#2b2118';
        ctx.beginPath();
        for (const p of drivable) addDot(ctx, mx(p.x), my(p.z), 3);
        ctx.fill();
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath();
        for (const p of drivable) addDot(ctx, mx(p.x), my(p.z), 1.7);
        ctx.fill();
      }
      if (not.length) {
        ctx.strokeStyle = 'rgba(70, 60, 44, 0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const p of not) addDot(ctx, mx(p.x), my(p.z), 2.6);
        ctx.stroke();
      }
      /*
       * Names, but only the ones near enough to read and only while the map
       * is zoomed in far enough that they are not a wall of text. Eight
       * labels on a 190-pixel map is a mess; the three nearest is a map.
       */
      const near = d.places
        .map((p) => ({ p, d2: (p.x - g.craft.x) ** 2 + (p.z - g.craft.z) ** 2 }))
        .sort((a, b) => a.d2 - b.d2)
        .slice(0, 3);
      for (const { p } of near) {
        const x = mx(p.x);
        const y = my(p.z);
        if (x < 8 || x > SIZE - 8 || y < 14 || y > SIZE - 8) continue;
        label(ctx, p.name, x, y - 6, p.boatOnly ? 'rgba(226,216,196,0.7)' : '#ffe9a8');
      }
    }

    // The depot: where the van lives and where every job starts and ends.
    if (d.depot) {
      const x = mx(d.depot.x);
      const y = my(d.depot.z);
      ctx.fillStyle = '#4ea3ff';
      ctx.strokeStyle = 'rgba(8,14,22,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 4, y + 3);
      ctx.lineTo(x - 4, y - 1);
      ctx.lineTo(x, y - 4.5);
      ctx.lineTo(x + 4, y - 1);
      ctx.lineTo(x + 4, y + 3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
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
    const offscreen = [];

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
    for (const role of ['pad', 'hospital']) {
      let any = false;
      ctx.beginPath();
      for (const p of PADS) {
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
      offscreen.sort(
        (a, b) =>
          (a.pos.x - craft.x) ** 2 +
          (a.pos.z - craft.z) ** 2 -
          ((b.pos.x - craft.x) ** 2 + (b.pos.z - craft.z) ** 2)
      );
      const show = offscreen.slice(0, 4);
      ctx.fillStyle = 'rgba(240, 246, 252, 0.8)';
      ctx.beginPath();
      for (const p of show) {
        const a = Math.atan2(p.pos.z - craft.z, p.pos.x - craft.x);
        const bx = cx + Math.cos(a) * (edge - 7);
        const by = cy + Math.sin(a) * (edge - 7);
        ctx.moveTo(bx + Math.cos(a) * 5, by + Math.sin(a) * 5);
        ctx.lineTo(bx + Math.cos(a + 2.5) * 4.5, by + Math.sin(a + 2.5) * 4.5);
        ctx.lineTo(bx + Math.cos(a - 2.5) * 4.5, by + Math.sin(a - 2.5) * 4.5);
      }
      ctx.fill();
    }
  }

  /* ---- shared: the objective, you, the footer, the warning ------ */

  /**
   * The objective.
   *
   * A diamond rather than another dot, and the distance beside it, so the map
   * answers "how far" without anybody doing arithmetic. Unchanged from the
   * aviation chart in every particular, because it was already right and it
   * means the same thing in a boat, a van and a helicopter.
   */
  drawTarget(g) {
    const { ctx, mx, my, craft, sim } = g;
    const target = sim.activeTarget;
    if (!target || !target.pos) return;
    const tx = mx(target.pos.x);
    const ty = my(target.pos.z);
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#7dffb4';
    ctx.strokeStyle = 'rgba(8,14,22,0.8)';
    ctx.lineWidth = 1;
    ctx.fillRect(-3.4, -3.4, 6.8, 6.8);
    ctx.strokeRect(-3.4, -3.4, 6.8, 6.8);
    ctx.restore();
    ctx.strokeStyle = `rgba(125,255,180,${0.5 + Math.sin(g.t * 3) * 0.2})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(tx, ty, 9 + Math.sin(g.t * 3) * 2, 0, Math.PI * 2);
    ctx.stroke();
    const dkm = Math.hypot(target.pos.x - craft.x, target.pos.z - craft.z) / 1000;
    ctx.fillStyle = 'rgba(190, 255, 220, 0.95)';
    ctx.font = '600 9px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(dkm < 10 ? `${dkm.toFixed(1)} km` : `${Math.round(dkm)} km`, tx, ty - 13);
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
   * just a cursor.
   */
  drawOwnCraft(g) {
    const { ctx, cx, cy, k, craft, mode } = g;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((craft.headingDeg * Math.PI) / 180);

    const leadSecs = mode === 'flight' ? 60 : mode === 'heli' ? 30 : mode === 'car' ? 30 : 90;
    const lead = Math.min(SIZE * 0.42, Math.max(10, craft.speed * leadSecs * k));
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(0, -lead);
    ctx.stroke();
    ctx.setLineDash([]);

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
   * The one number along the bottom.
   *
   * Flight has none: the aviation chart is unchanged and the altimeter is
   * three inches away on the panel. The other three each have exactly one
   * number that the map, and only the map, can answer.
   */
  drawFoot(g, d) {
    const { ctx, craft, sim, mode } = g;
    let text = '';
    if (mode === 'boat') {
      const u = depthUnderKeel(craft.x, craft.z, craft.draught);
      text = craft.aground ? 'AGROUND' : `UNDER KEEL ${u < 10 ? u.toFixed(1) : Math.round(u)} m`;
    } else if (mode === 'car') {
      const t = sim.activeTarget;
      text = t
        ? `${(t.label || 'DESTINATION').toUpperCase()}  ${km(
            Math.hypot(t.pos.x - craft.x, t.pos.z - craft.z)
          )}`
        : d.depot
        ? `DEPOT  ${km(Math.hypot(d.depot.x - craft.x, d.depot.z - craft.z))}`
        : '';
    } else {
      const p = nearestPad(craft.x, craft.z);
      if (p) {
        text = `${p.name.toUpperCase()}  ${km(
          Math.hypot(p.pos.x - craft.x, p.pos.z - craft.z)
        )}`;
      }
    }
    if (!text) return;
    ctx.font = '700 8px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    const w = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(6, 12, 20, 0.7)';
    ctx.fillRect(SIZE / 2 - w / 2 - 5, SIZE - 20, w + 10, 12);
    ctx.fillStyle = '#dfeaf4';
    ctx.fillText(text, SIZE / 2, SIZE - 11.5);
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
    const hdg = (craft.headingDeg * Math.PI) / 180;
    const dirX = Math.sin(hdg);
    const dirZ = -Math.cos(hdg);

    if (mode === 'flight' || mode === 'heli') {
      /*
       * Terrain ahead. Sample the ground along the track for the next half
       * minute at the current speed. If the ground out there is higher than
       * where this descent puts you, say so — that is a warning you can act
       * on, unlike a number.
       *
       * The helicopter gets the same scan with a shorter horizon and a floor
       * under the speed it assumes, because at a hover the track is a point
       * and scanning thirty seconds of it says "TERRAIN" about the hillside
       * you are deliberately holding station over.
       */
      if (craft.onGround) return null;
      const far = mode === 'heli' ? 14 : 30;
      if (mode === 'heli' && craft.speed < 8) return null;
      const spd = Math.max(20, craft.speed);
      for (let s = 4; s <= far; s += 2) {
        const px = craft.x + dirX * spd * s;
        const pz = craft.z + dirZ * spd * s;
        const py = craft.y + craft.vy * s;
        if (py < heightAt(px, pz) + 45) return `TERRAIN — ${Math.round(s)}s`;
      }
      return null;
    }

    if (mode === 'boat') {
      if (craft.aground) return 'AGROUND';
      /*
       * Shallow water ahead — which is the boat's whole version of this, and
       * a harder problem than the hill, because the hill is visible and the
       * rock is not. Ninety seconds of lookahead at the speed she is doing,
       * and the test is the depth under the keel rather than the depth,
       * because a metre of water is deep for a dinghy and aground for this.
       *
       * A slow boat gets a distance floor: at one knot, ninety seconds is
       * forty-five metres and the warning would only ever fire after the bang.
       */
      const spd = Math.max(2.5, craft.speed);
      for (let s = 3; s <= 90; s += 3) {
        const px = craft.x + dirX * spd * s;
        const pz = craft.z + dirZ * spd * s;
        if (depthUnderKeel(px, pz, craft.draught) < 0.4) return `SHOAL — ${Math.round(s)}s`;
      }
      return null;
    }

    /*
     * The van. There is nothing ahead of it that can kill it, so the warning
     * is the one thing that actually goes wrong: the road is behind you.
     * Silent while the map has no roads on it at all, because on drovers
     * today that would mean a warning light that never goes out.
     */
    if (!d.roads.length) return null;
    let best = Infinity;
    for (const rd of d.roads) {
      const lim = (rd.halfWidth || 26) + (rd.blend || 55);
      best = Math.min(best, distToPath(craft.x, craft.z, rd.path) - lim);
      if (best <= 0) break;
    }
    return best > 40 ? 'OFF ROAD' : null;
  }

  setWarning(text) {
    if (text) {
      this.warn.style.display = '';
      this.warn.textContent = text;
      this.el.classList.add('is-alert');
    } else {
      this.warn.style.display = 'none';
      this.el.classList.remove('is-alert');
    }
  }
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
