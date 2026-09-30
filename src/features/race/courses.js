/**
 * The other three races — one for every ride. "racing world has: racing for
 * cars, planes, boats etc" (the owner). Pure data, no imports: ./rules.js
 * reads them, the node tests measure them, ../race.js draws them.
 *
 * Every course is the Ring Rally's shape, so the host's rules are the same
 * rules: a list of `rings` flown (driven, sailed) IN ORDER, the last one the
 * lap line; a start grid behind it, two abreast; so many laps. A ring here is
 * [x, z, metres above the ground (or the water), heading of travel (deg)] —
 * the heading is written down, not worked out, because a road turns where
 * the road turns and the gate must face the way the road goes.
 *
 *   shape 'ring' — a hoop you go through (the aeroplane's, the helicopter's)
 *   shape 'gate' — an upright rectangle across a road or between two buoys:
 *                  `radius` is half its width, `halfHeight` half its height.
 *
 * THE CAR — FENWICK GRAND PRIX, on Fenwick (the car's town island). The town's
 * own streets (maps.js, `town` — authored roads, so the node test can hold
 * every metre of the lap against them): the south ring road east, left up
 * the east street, left along the first cross street, left down the west
 * street and back onto the ring road. About 2.2 km a lap, two laps: three to
 * four minutes for a ten-year-old. The gates are 28 m wide on a 10 m road —
 * off the tarmac onto the grass is slower (the tyres know), never a DNF.
 *
 * THE BOAT — LAGOON REGATTA, on Coral Lagoon ("the friendliest map in the
 * game"): six pairs of buoys in the open lagoon just outside the harbour, a
 * rounded oblong about 1.3 km round, two laps. Deep water all the way (the
 * test measures it); nowhere near the marked pass to the sea.
 *
 * THE HELICOPTER — SKYHOOK SPRINT, on Harrier Flats: nine hoops round the
 * airfield, ten to fourteen metres off the grass — lower and tighter than the
 * Ring Rally's (24 m hoops, 55 m up): the Skyhook hovers, so it can thread
 * them slowly. The grid is on the runway, painted as helipads. ONE lap, about
 * 2.7 km from the grid: it was two, and the independent check flew both laps
 * with a kid's real controls (Shift/Ctrl for height, Q/E to turn, W forward,
 * no teleporting) — 6:07 for a quick pilot, and a careful one at half the
 * Skyhook's speed still had a hoop to go when the old nine-minute limit ended
 * it. One lap is about three minutes for a quick pilot, like the car and the
 * boat (3:10 each, flown the same way), five for a careful one. And the
 * limits are the gentlest of the four, because hovering is the hardest thing
 * a ten-year-old learns here: fourteen minutes before a race alone is called
 * off (the wire carries up to fifteen), and four minutes after the winner for
 * everybody else — a pilot at half the winner's speed is about three behind.
 */

export const CAR_COURSE = Object.freeze({
  id: 'car',
  name: 'Fenwick Grand Prix',
  short: 'Grand Prix',
  cta: '🏁 Race the streets',
  vehicle: 'car',
  emoji: '🚗',
  map: 'town',
  island: 'Fenwick',
  laps: 2,
  shape: 'gate',
  style: 'road',
  gateWord: 'gate',
  blurb: 'Round the town’s streets and the ring road, through the gates, two laps. Off the road is slower — never out.',
  grid: { x: -262, z: 500, heading: 90, rowGap: 12, side: 2.6 },
  rings: [
    [100, 500, 2, 90],
    [367, 620, 2, 179],
    [250, 769, 2, 273],
    [-100, 747, 2, 274],
    [-380, 730, 2, 272],
    [-490, 610, 2, 356],
    [-250, 500, 2, 90],
  ],
  radius: 14,
  finishRadius: 14,
  halfHeight: 25,
  /** The van's top speed is 29 m/s (36 downhill); nobody honest laps faster than this. */
  maxSpeed: 60,
  maxMs: 12 * 60000,
  /** Gentle: two minutes after the winner for everybody else to get round (the Ring Rally gives one). */
  closeMs: 120000,
});

export const BOAT_COURSE = Object.freeze({
  id: 'boat',
  name: 'Lagoon Regatta',
  short: 'Regatta',
  cta: '🏁 Race the buoys',
  vehicle: 'boat',
  emoji: '⛵',
  map: 'lagoon',
  island: 'Coral Lagoon',
  laps: 2,
  shape: 'gate',
  style: 'buoys',
  gateWord: 'pair of buoys',
  blurb: 'Between the orange buoys round the lagoon, two laps. Calm water, lots of room.',
  grid: { x: 1692, z: 1610, heading: 270, rowGap: 24, side: 10 },
  rings: [
    [1450, 1600, 0, 290],
    [1370, 1500, 0, 0],
    [1500, 1395, 0, 80],
    [1800, 1395, 0, 100],
    [1930, 1500, 0, 180],
    [1660, 1610, 0, 270],
  ],
  radius: 22,
  finishRadius: 24,
  halfHeight: 20,
  /** The launch tops out at 14 m/s. */
  maxSpeed: 35,
  maxMs: 12 * 60000,
  closeMs: 120000,
});

export const HELI_COURSE = Object.freeze({
  id: 'heli',
  name: 'Skyhook Sprint',
  short: 'Sprint',
  cta: '🏁 Race the hoops',
  vehicle: 'heli',
  emoji: '🚁',
  map: 'meadow',
  island: 'Harrier Flats',
  laps: 1,
  shape: 'ring',
  style: 'hoops',
  gateWord: 'hoop',
  blurb: 'Nine low hoops round the airfield — hover through them. One lap.',
  grid: { x: -440, z: 0, heading: 90, rowGap: 24, side: 10 },
  // Out along the south side of the runway, round the east end (through the
  // hoop going north), back along the north side short of the apron, round
  // the west end (going south) and through the finish over the runway.
  rings: [
    [-150, 60, 12],
    [150, 110, 13],
    [450, 60, 12],
    [620, -40, 14, 0],
    [350, -80, 12],
    [50, -60, 12],
    [-350, -60, 12],
    [-650, -20, 14, 180],
    [-300, 10, 11, 90],
  ],
  radius: 11,
  finishRadius: 13,
  maxSpeed: 120,
  /** Fourteen minutes: a minute inside the fifteen a time may be on the wire (rules.js, RACE_CAP_MS). */
  maxMs: 14 * 60000,
  /** Four minutes after the winner: the slowest hoverers are the ones still learning. */
  closeMs: 240000,
});

export const OTHER_COURSES = [CAR_COURSE, BOAT_COURSE, HELI_COURSE];
