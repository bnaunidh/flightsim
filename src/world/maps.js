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
];

export const DEFAULT_MAP_ID = 'kestrel';

export function getMap(id) {
  return MAPS.find((m) => m.id === id) || MAPS[0];
}
