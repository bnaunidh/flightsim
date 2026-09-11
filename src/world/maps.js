/**
 * Maps.
 *
 * Five places to fly. Every one of them keeps the same runway — 09/27, 1,100 m
 * of tarmac at (0, 0), 14 m above the sea — so the tutorial, every mission and
 * every landing score work identically wherever you go. What changes is the
 * land around it: its shape, its colour, the weather it usually gets and how
 * much room the hills leave you.
 *
 * A map is pure data. `terrain.js` reads it to build the height field, the
 * ocean reads its palette, and the scenery reads what to plant. Nothing here
 * loads a file — the terrain is still one analytic function, so the wheels
 * always touch exactly the ground you can see.
 *
 * Island `profile` values:
 *   hills   rolling ridges and valleys — the classic tropical island
 *   plains  wide and gentle, nothing steep anywhere
 *   flat    a low sandy cay barely out of the water
 *   ridge   steep craggy ridges with narrow inlets between them
 *   cone    a volcano: one big cone with a crater in the top
 */

export const MAPS = [
  {
    id: 'kestrel',
    name: 'Kestrel Island',
    subtitle: 'Tropical · gentle hills',
    blurb:
      'Warm, green and forgiving. Long runway, soft sea breeze and a wide valley off both ends. ' +
      'This is where everyone learns.',
    difficulty: 1,
    difficultyLabel: 'Gentle',
    seaFloor: -34,
    islands: [
      { name: 'Kestrel Island', cx: 0, cz: 0, radius: 2450, peak: 300, seed: 3, profile: 'hills' },
      { name: 'Mango Cay', cx: 6200, cz: -5200, radius: 980, peak: 150, seed: 17, profile: 'hills' },
      { name: 'Needle Rock', cx: -3100, cz: -3600, radius: 380, peak: 210, seed: 29, profile: 'hills' },
    ],
    chunks: [
      { cx: 0, cz: 0, size: 10000, segments: 256 },
      { cx: 6200, cz: -5200, size: 4600, segments: 128 },
      { cx: -3100, cz: -3600, size: 2200, segments: 72 },
    ],
    palette: {
      grass: [1.0, 1.0, 1.0],
      sand: [1.0, 1.0, 1.0],
      rock: [1.0, 1.0, 1.0],
      deepWater: 0x123a5e,
      swell: 0x3a7ba8,
      shallow: [0.31, 0.84, 0.78],
      nightSky: 0x9fb8d8,
    },
    outpost: { cx: 6200, cz: -5200, elev: 118, halfLen: 210, halfWidth: 55, blend: 150 },
    scenery: {
      coastTrees: 900,
      coastTreeHeight: 10,
      hillTrees: 600,
      hillTreeHeight: 13,
      hillCentre: [200, 500],
      hillRadius: 1700,
      hillBand: [60, 260],
      town: { cx: 700, cz: 620, radius: 420, count: 46, minH: 16, maxH: 110 },
      lighthouse: [-3100, -3600],
      deliveryPad: [6200, -5200],
      padTrees: 280,
      boats: 3,
    },
    weather: { time: 'day', cond: 'clear', windSpeedKts: 6, windDirDeg: 250 },
    // Warm and green: a reef fringe in the shallows and a river off the hills.
    features: { reef: { islands: [0, 1], colour: 0x49d6c0, width: 0.22 } },
  },

  {
    id: 'meadow',
    name: 'Harrier Flats',
    subtitle: 'Grassland · almost no hills',
    blurb:
      'A huge green plain with barely a bump on it. Nothing to hit, room to make mistakes, and you can ' +
      'see the airfield from anywhere. The kindest place to practise landings.',
    difficulty: 1,
    difficultyLabel: 'Very gentle',
    seaFloor: -30,
    islands: [
      { name: 'Harrier Flats', cx: 300, cz: 200, radius: 4200, peak: 120, seed: 61, profile: 'plains' },
      { name: 'Willow Bank', cx: -5200, cz: 3600, radius: 1500, peak: 70, seed: 83, profile: 'plains' },
    ],
    chunks: [
      { cx: 0, cz: 0, size: 13000, segments: 256 },
      { cx: -5200, cz: 3600, size: 5200, segments: 112 },
    ],
    palette: {
      grass: [0.94, 1.06, 0.86],
      sand: [1.04, 1.0, 0.88],
      rock: [1.0, 1.0, 0.98],
      deepWater: 0x14425c,
      swell: 0x4b93a8,
      shallow: [0.36, 0.82, 0.7],
      nightSky: 0x9fb8d8,
    },
    outpost: { cx: -5100, cz: 3500, elev: 43, halfLen: 210, halfWidth: 55, blend: 150 },
    scenery: {
      coastTrees: 1100,
      coastTreeHeight: 12,
      hillTrees: 700,
      hillTreeHeight: 15,
      hillCentre: [1400, -1200],
      hillRadius: 2600,
      hillBand: [30, 120],
      town: { cx: 1500, cz: 900, radius: 620, count: 74, minH: 14, maxH: 90 },
      lighthouse: [-5900, 4200],
      deliveryPad: [-5100, 3500],
      padTrees: 300,
      boats: 2,
    },
    weather: { time: 'day', cond: 'clear', windSpeedKts: 4, windDirDeg: 270 },
    // "Grassland" should look like farmland from the air, not one flat green.
    features: {
      fields: { cx: 900, cz: 300, radius: 3400, count: 90 },
      reef: { islands: [0], colour: 0x4fc4a8, width: 0.16 },
    },
  },

  {
    id: 'atoll',
    name: 'Coral Atoll',
    subtitle: 'Reef chain · long water crossings',
    blurb:
      'A necklace of low sandy cays in bright shallow water. The land is flat and easy — it is the ' +
      'distances between islands that will test you. Watch the fuel.',
    difficulty: 2,
    difficultyLabel: 'Easy',
    seaFloor: -22,
    islands: [
      { name: 'Long Cay', cx: 0, cz: 0, radius: 2000, peak: 34, seed: 101, profile: 'flat' },
      { name: 'Turtle Cay', cx: 4600, cz: 2600, radius: 720, peak: 22, seed: 113, profile: 'flat' },
      { name: 'Pelican Cay', cx: -4200, cz: -3400, radius: 640, peak: 26, seed: 127, profile: 'flat' },
      { name: 'Sandspit', cx: 2400, cz: -5200, radius: 480, peak: 18, seed: 139, profile: 'flat' },
      { name: 'Coral Head', cx: -6400, cz: 2200, radius: 400, peak: 30, seed: 151, profile: 'flat' },
    ],
    chunks: [
      { cx: 0, cz: 0, size: 9000, segments: 224 },
      { cx: 4600, cz: 2600, size: 3600, segments: 96 },
      { cx: -4200, cz: -3400, size: 3200, segments: 88 },
      { cx: 2400, cz: -5200, size: 2600, segments: 72 },
      { cx: -6400, cz: 2200, size: 2200, segments: 64 },
    ],
    palette: {
      grass: [0.96, 1.02, 0.78],
      sand: [1.12, 1.08, 0.94],
      rock: [1.1, 1.08, 1.0],
      deepWater: 0x18628f,
      swell: 0x59c2c4,
      shallow: [0.34, 0.94, 0.86],
      nightSky: 0xa8c2dc,
    },
    outpost: { cx: 4600, cz: 2600, elev: 16, halfLen: 210, halfWidth: 55, blend: 150 },
    scenery: {
      coastTrees: 700,
      coastTreeHeight: 11,
      hillTrees: 180,
      hillTreeHeight: 10,
      hillCentre: [-600, -900],
      hillRadius: 1500,
      hillBand: [8, 34],
      town: { cx: 900, cz: 800, radius: 400, count: 28, minH: 6, maxH: 34 },
      lighthouse: [-4200, -3400],
      deliveryPad: [4600, 2600],
      padTrees: 220,
      boats: 4,
    },
    weather: { time: 'day', cond: 'clear', windSpeedKts: 10, windDirDeg: 110 },
    // The point of an atoll is the reef: broad turquoise shallows ringing
    // every cay, which is what you actually navigate by out here.
    features: {
      reef: { islands: [0, 1, 2, 3, 4], colour: 0x5ce0cc, width: 0.55, bright: 0.8 },
    },
  },

  {
    id: 'fjord',
    name: 'Aurora Fjords',
    subtitle: 'Cold · steep ridges and narrow water',
    blurb:
      'Grey rock, dark water and ridges that come right down to the shoreline. The valley off the runway ' +
      'is still clear, but stray off it and the ground comes up fast.',
    difficulty: 4,
    difficultyLabel: 'Hard',
    seaFloor: -60,
    islands: [
      { name: 'Aurora Shelf', cx: 0, cz: 0, radius: 1750, peak: 150, seed: 211, profile: 'hills' },
      { name: 'North Wall', cx: 700, cz: -3100, radius: 2700, peak: 640, seed: 223, profile: 'ridge' },
      { name: 'South Wall', cx: -400, cz: 3000, radius: 2500, peak: 560, seed: 227, profile: 'ridge' },
      { name: 'Skerry', cx: -4300, cz: -800, radius: 520, peak: 190, seed: 233, profile: 'ridge' },
    ],
    chunks: [
      { cx: 0, cz: 0, size: 11000, segments: 256 },
      { cx: -4300, cz: -800, size: 2600, segments: 72 },
    ],
    palette: {
      grass: [0.74, 0.86, 0.74],
      sand: [0.82, 0.84, 0.86],
      rock: [0.86, 0.9, 0.96],
      deepWater: 0x0d2a42,
      swell: 0x2a5c7e,
      shallow: [0.24, 0.55, 0.62],
      nightSky: 0x8ea6c4,
      // Snow line: bare rock below the first figure, full cover above the
      // second. Cold ridges with green valleys, which is the whole look.
      snow: [330, 600],
    },
    outpost: { cx: -4300, cz: -800, elev: 190, halfLen: 200, halfWidth: 50, blend: 130 },
    scenery: {
      coastTrees: 520,
      coastTreeHeight: 12,
      hillTrees: 900,
      hillTreeHeight: 16,
      hillCentre: [400, -1600],
      hillRadius: 2400,
      hillBand: [40, 330],
      town: { cx: -900, cz: 600, radius: 380, count: 34, minH: 16, maxH: 90 },
      lighthouse: [-4550, -1080],
      deliveryPad: [-4300, -800],
      padTrees: 160,
      boats: 2,
    },
    weather: { time: 'sunset', cond: 'cloudy', windSpeedKts: 16, windDirDeg: 300 },
    // It is called Aurora Fjords: snow on the tops, and the lights after dark.
    features: {
      aurora: { colour: 0x4dffa8, colour2: 0x7a5cff, height: 2600 },
      waterfalls: 5,
    },
  },

  {
    id: 'ember',
    name: 'Ember Isle',
    subtitle: 'Volcanic · a mountain on your doorstep',
    blurb:
      'Black sand, ash slopes and a volcano that fills half the sky on the downwind leg. Strong, shifting ' +
      'wind off the cone. The hardest place in the game to fly well.',
    difficulty: 5,
    difficultyLabel: 'Expert',
    seaFloor: -48,
    islands: [
      { name: 'Ember Shelf', cx: -200, cz: 100, radius: 1900, peak: 110, seed: 307, profile: 'hills' },
      {
        name: 'Mount Ember',
        cx: 2500,
        cz: -2400,
        // Taller and narrower than it was. At 880 m over a 2.1 km radius the
        // average slope was 23 degrees, which from the air reads as a big
        // hill; a strato-volcano is nearer 33, and that is the difference
        // between "mountain" and "volcano" at a glance.
        radius: 1750,
        peak: 1150,
        crater: 210,
        craterRadius: 240,
        seed: 311,
        profile: 'cone',
      },
      {
        name: 'Cinder Cone',
        cx: -3800,
        cz: 2900,
        radius: 900,
        peak: 340,
        crater: 70,
        craterRadius: 150,
        seed: 313,
        profile: 'cone',
      },
    ],
    chunks: [
      { cx: 0, cz: 0, size: 11000, segments: 256 },
      { cx: -3800, cz: 2900, size: 3000, segments: 88 },
    ],
    palette: {
      grass: [0.78, 0.8, 0.7],
      sand: [0.5, 0.47, 0.46],
      rock: [0.82, 0.7, 0.64],
      deepWater: 0x0e2233,
      swell: 0x2f5a72,
      shallow: [0.3, 0.6, 0.6],
      nightSky: 0xb09098,
    },
    outpost: { cx: -3800, cz: 2900, elev: 322, halfLen: 200, halfWidth: 50, blend: 140 },
    scenery: {
      coastTrees: 420,
      coastTreeHeight: 9,
      hillTrees: 260,
      hillTreeHeight: 11,
      hillCentre: [-900, 700],
      hillRadius: 1400,
      hillBand: [20, 120],
      town: { cx: -1100, cz: 700, radius: 340, count: 26, minH: 14, maxH: 70 },
      lighthouse: [-4350, 3350],
      deliveryPad: [-3800, 2900],
      padTrees: 120,
      boats: 2,
    },
    weather: { time: 'sunset', cond: 'clear', windSpeedKts: 20, windDirDeg: 200 },
    // An actual volcano: a lava lake in the crater, flows down the north
    // flank, an ash column leaning away downwind and glowing rock at night.
    features: {
      volcano: [
        { island: 'Mount Ember', lake: true, flows: 8, plume: true, embers: true },
        { island: 'Cinder Cone', lake: true, flows: 2, plume: false, embers: false },
      ],
    },
  },

  /* ==================================================================== *
   * Three real airports.
   *
   * The runway numbers, headings, lengths and field elevations below are the
   * real ones. What is *not* real is everything around them: there is no city,
   * no bay and no terminal complex, because this game builds its world out of
   * noise and primitives rather than survey data, and a half-drawn San
   * Francisco would be worse than none.
   *
   * Two runways are modelled at each field. SFO and LAX both have four, and
   * the pair chosen is the pair that matters — the long one you land on and
   * the one you use when the wind is wrong.
   *
   * And one more simplification, stated rather than hidden: the runways are
   * laid out along the game's axes, not on their true compass headings. The
   * whole world — the paved-area test, the flattened pad, the taxiways, the
   * approach corridors — assumes the main runway runs east-west, and bending
   * all of that to a real 284 degrees is a much larger change than this. So
   * what is faithful here is the part that decides how a field flies: the real
   * runway *lengths*, the real field elevation, and the real relationship
   * between the two strips. SFO's cross each other, LAX's run parallel, OAK
   * has one long one and a little one. That is why those three airports feel
   * different from one another, and it survives intact. The compass numbers
   * would not, so they are not painted on.
   * ==================================================================== */
  {
    id: 'sfo',
    name: 'San Francisco',
    subtitle: 'Real field · two intersecting pairs',
    blurb:
      'Flat, low and open to the water, with two runways crossing at almost a right angle. The long ' +
      '28s take the traffic; the 19s are there for when the wind says otherwise.',
    difficulty: 2,
    difficultyLabel: 'Open',
    seaFloor: -28,
    // Field elevation 13 ft. The real 10L/28R is 3,618 m; 01L/19R is 2,332 m.
    airport: {
      elev: 4,
      headingDeg: 90,
      // 10L/28R is 3,618 m in reality. The crossing pair sits at 90 degrees to
      // it, which is what SFO actually gives you: a real choice in a crosswind.
      runway: { cx: 0, cz: 0, length: 3618, halfWidth: 30 },
      runway2: { cx: 700, cz: -200, length: 2332, halfWidth: 27, headingDeg: 180 },
      pad: { x0: -2100, x1: 2100, z0: -420, z1: 380, blend: 340 },
      pad2: { x0: 560, x1: 840, z0: -1500, z1: 1100, blend: 300 },
    },
    islands: [
      { name: 'The Peninsula', cx: 0, cz: 400, radius: 6200, peak: 60, seed: 61, profile: 'hills' },
      { name: 'San Bruno Hill', cx: -3200, cz: 2600, radius: 1500, peak: 240, seed: 67, profile: 'hills' },
    ],
    chunks: [
      { cx: 0, cz: 0, size: 16000, segments: 256 },
      { cx: -3200, cz: 2600, size: 4200, segments: 96 },
    ],
    palette: {
      grass: [0.92, 0.95, 0.82],
      sand: [0.95, 0.92, 0.86],
      rock: [0.86, 0.84, 0.82],
      deepWater: 0x123a4e,
      swell: 0x2e6c86,
      // Cold, green-grey bay water rather than a tropical reef.
      shallow: [0.34, 0.58, 0.60],
      nightSky: 0x8fa6c4,
    },
    scenery: {
      coastTrees: 260,
      coastTreeHeight: 9,
      hillTrees: 420,
      hillTreeHeight: 11,
      hillCentre: [-3200, 2600],
      hillRadius: 1400,
      hillBand: [60, 220],
      town: { cx: -1800, cz: 1800, radius: 900, count: 90, minH: 14, maxH: 150 },
      lighthouse: [-5200, -2600],
      deliveryPad: [6200, -5200],
      padTrees: 60,
      boats: 5,
    },
    weather: { time: 'day', cond: 'cloudy', windSpeedKts: 16, windDirDeg: 290 },
  },

  {
    id: 'oak',
    name: 'Oakland',
    subtitle: 'Real field · one long runway',
    blurb:
      'One long runway across the water from San Francisco, and a short field beside it. Quieter, ' +
      'simpler, and a good place to take something heavy.',
    difficulty: 2,
    difficultyLabel: 'Open',
    seaFloor: -22,
    // Field elevation 9 ft. 12/30 is 3,207 m; the North Field 10R/28L is 1,921 m.
    airport: {
      elev: 3,
      headingDeg: 90,
      // 12/30 is 3,207 m; the North Field strip is 1,921 m and much narrower.
      runway: { cx: 0, cz: 0, length: 3207, halfWidth: 30 },
      runway2: { cx: -700, cz: -900, length: 1921, halfWidth: 23, headingDeg: 180 },
      pad: { x0: -1900, x1: 1900, z0: -380, z1: 340, blend: 320 },
      pad2: { x0: -1900, x1: 100, z0: -840, z1: -560, blend: 240 },
    },
    islands: [
      { name: 'East Bay', cx: 600, cz: 900, radius: 5600, peak: 40, seed: 71, profile: 'hills' },
      { name: 'Oakland Hills', cx: 3400, cz: 3200, radius: 2200, peak: 380, seed: 73, profile: 'hills' },
    ],
    chunks: [
      { cx: 0, cz: 0, size: 15000, segments: 256 },
      { cx: 3400, cz: 3200, size: 5200, segments: 112 },
    ],
    palette: {
      grass: [0.95, 0.94, 0.78],
      sand: [0.93, 0.9, 0.84],
      rock: [0.84, 0.82, 0.78],
      deepWater: 0x14415a,
      swell: 0x316f8a,
      shallow: [0.36, 0.60, 0.62],
      nightSky: 0x93aac8,
    },
    scenery: {
      coastTrees: 220,
      coastTreeHeight: 9,
      hillTrees: 700,
      hillTreeHeight: 13,
      hillCentre: [3400, 3200],
      hillRadius: 2000,
      hillBand: [80, 340],
      town: { cx: 1600, cz: 1500, radius: 800, count: 70, minH: 12, maxH: 90 },
      lighthouse: [-4200, 2400],
      deliveryPad: [6200, -5200],
      padTrees: 60,
      boats: 4,
    },
    weather: { time: 'day', cond: 'clear', windSpeedKts: 11, windDirDeg: 290 },
  },

  {
    id: 'lax',
    name: 'Los Angeles',
    subtitle: 'Real field · four parallels, two flown',
    blurb:
      'Four parallel runways all pointing the same way, which makes it the easiest big airport to ' +
      'line up with and the busiest to share. The 25s are the long pair on the south side.',
    difficulty: 2,
    difficultyLabel: 'Open',
    seaFloor: -30,
    // Field elevation 125 ft. 07L/25R is 3,939 m; 06R/24L is 3,318 m.
    airport: {
      elev: 38,
      headingDeg: 90,
      // 07L/25R is 3,939 m, 06R/24L is 3,318 m. They are PARALLEL, not
      // crossing — that is the thing that makes LAX feel like LAX, and it is
      // the one piece of its geometry worth keeping above all others.
      runway: { cx: 0, cz: 0, length: 3939, halfWidth: 30 },
      runway2: { cx: -120, cz: -1050, length: 3318, halfWidth: 30, headingDeg: 90 },
      pad: { x0: -2300, x1: 2300, z0: -1400, z1: 420, blend: 360 },
      pad2: { x0: -2300, x1: 2300, z0: -1400, z1: -700, blend: 300 },
    },
    islands: [
      { name: 'The Basin', cx: 1200, cz: 600, radius: 7000, peak: 80, seed: 83, profile: 'hills' },
      { name: 'Palos Verdes', cx: -1800, cz: 5200, radius: 1900, peak: 420, seed: 89, profile: 'hills' },
    ],
    chunks: [
      { cx: 0, cz: 0, size: 18000, segments: 256 },
      { cx: -1800, cz: 5200, size: 4800, segments: 104 },
    ],
    palette: {
      grass: [0.96, 0.9, 0.72],
      sand: [1.0, 0.96, 0.86],
      rock: [0.9, 0.86, 0.78],
      deepWater: 0x10486a,
      swell: 0x3b83a4,
      // Warmer and bluer going south.
      shallow: [0.33, 0.70, 0.76],
      nightSky: 0xa2b4cf,
    },
    scenery: {
      coastTrees: 300,
      coastTreeHeight: 11,
      hillTrees: 520,
      hillTreeHeight: 12,
      hillCentre: [-1800, 5200],
      hillRadius: 1700,
      hillBand: [90, 380],
      town: { cx: 2600, cz: 1400, radius: 1200, count: 130, minH: 14, maxH: 170 },
      lighthouse: [-3600, 6400],
      deliveryPad: [6200, -5200],
      padTrees: 70,
      boats: 4,
    },
    weather: { time: 'day', cond: 'clear', windSpeedKts: 10, windDirDeg: 260 },
  },

];

export const DEFAULT_MAP_ID = 'kestrel';

export function getMap(id) {
  return MAPS.find((m) => m.id === id) || MAPS[0];
}
