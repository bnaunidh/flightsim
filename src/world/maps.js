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
 *
 * A ROAD PATH POINT IS [x, z, y] — the two map coordinates first, the
 * elevation last. Not three.js order, and worth knowing before you edit one:
 * `[0, 300, 24]` is a point three hundred metres up the map at twenty-four
 * metres above the sea, not a point twenty-four metres along at three hundred
 * metres up. Both readings parse, nothing throws, and the wrong one quietly
 * moves the road and cuts a trench along it. roads.js emits the same order.
 *
 * AND THESE ARRAYS ARE LIVE, not a stale bake left behind by the generator.
 * Six maps carry one — kestrel, airfieldperimeter, town, coastroad, desertrun
 * and mountainpass — and main.js `layRoads()` keeps every one of them:
 * a map with no `courier` block returns early and publishes the authored list
 * untouched, and a map with one takes the `already` branch because an authored
 * road is a road somebody decided the line of. `buildRoads()` is never called
 * on any of the six. What is written here is what the terrain is cut to, what
 * the tarmac ribbon is drawn along, what the tyres read as tarmac and what the
 * chart shows. Measured 2026-09-19, over all 222 points of all six networks:
 * `heightAt(p[0], p[1])` comes back within 2.05 m of `p[2]`, and the residual
 * is the airfield pad and the strongest-road-wins rule, both deliberate. Read
 * the same points as [x, y, z] and the best any of them manages is 16 m out
 * and the worst is 4 km, which is what a transposed path looks like.
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
    /*
     * What is under the water.
     *
     * Outside the beaches this map's sea floor was a flat -34 everywhere, so
     * the boat had nothing to steer round and no reason to look where it was
     * going. These are banks and drying rocks: `top` is how close the floor
     * comes to the surface, so anything above about -1 will stop a hull and
     * anything near -3 is a place to be careful. They sit between the island
     * and Mango Cay, which is where the boat actually goes, and clear of the
     * carrier's water off to the south-west.
     */
    waters: {
      harbour: { island: 0, bearingDeg: 200, length: 250, width: 190, mouthWidth: 70, depth: 6, wallW: 26, quayW: 32, blend: 150 },
      /*
       * The island road.
       *
       * Kestrel is a mountain with one flat band cut through its waist, and
       * that band is the only drivable ground on it: measured, a route along
       * it needs a 0.9% grade and 4.6 m of cut, while any route that leaves
       * it — the obvious one, up to the town — needs 27% grades and a 104 m
       * embankment, because the land goes from 50 m to 230 m in two hundred
       * metres. So the road runs the length of the waist, coast to coast, and
       * the car game's real maps will be built flat on purpose rather than
       * carved out of this one.
       *
       * The corridor is 26 m wide and blended over 55, which sounds enormous
       * for a road and is not: the terrain mesh here is 39 m per quad, so the
       * narrowest thing the ground can actually hold is about three quads.
       * The tarmac a player sees is drawn down the middle of it.
       */
      roads: [
        {
          halfWidth: 26,
          blend: 55,
          path: [
            [-1950, -40, 24], [-1600, -80, 22.8], [-1200, -120, 21.4],
            [-800, -150, 19.4], [-400, -160, 16.9], [-80, -150, 14],
            [300, -120, 16.9], [700, -80, 19.4], [1100, -40, 21.4],
            [1500, 0, 22.8], [1900, 40, 24],
          ],
        },
      ],
      shoals: [
        // A long bank guarding the run north-east towards Mango Cay.
        { cx: 2600, cz: -2100, r: 760, top: -1.2 },
        { cx: 3400, cz: -2750, r: 520, top: -0.4 },
        // Drying rocks off Needle Rock — steep-to, which is what makes them
        // dangerous: deep water right up to the edge.
        { cx: -2650, cz: -3050, r: 300, top: 0.6, pow: 2.2 },
        { cx: -3500, cz: -2950, r: 240, top: -0.3, pow: 2 },
        // A shallow spit running off the island's north shore.
        { cx: -500, cz: -2850, r: 640, top: -2.4 },
        // A bank to the east, far enough out to be a surprise.
        { cx: 4200, cz: 900, r: 900, top: -2.9 },
      ],
    },
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
      pads: [
        { id: 'hospital', name: 'Kestrel Cottage Hospital', x: 760, z: 560, kind: 'roof', above: 30, r: 11 },
        { id: 'needle', name: 'Needle Rock', x: -2890, z: -3810, kind: 'stack', r: 9 },
        { id: 'mango', name: 'Mango Cay Village', x: 6350, z: -5200, kind: 'ground', r: 12 },
        { id: 'field', name: 'Kestrel Airfield Pad', x: -520, z: -150, kind: 'ground', r: 11 },
      ],
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
    waters: { harbour: { island: 0, bearingDeg: 250, length: 250, width: 190, mouthWidth: 70, depth: 6, wallW: 26, quayW: 32, blend: 150 } },
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
      pads: [
        { id: 'hospital', name: 'Flats Community Hospital', x: 1560, z: 840, kind: 'roof', above: 26, r: 11 },
        { id: 'point', name: 'Willow Point Light', x: -5820, z: 4140, kind: 'stack', r: 9 },
        { id: 'bank', name: 'Willow Bank Strip', x: -4950, z: 3500, kind: 'ground', r: 12 },
        { id: 'field', name: 'Harrier Flats Pad', x: -520, z: -150, kind: 'ground', r: 11 },
      ],
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
    waters: { harbour: { island: 0, bearingDeg: 150, length: 240, width: 180, mouthWidth: 68, depth: 5, wallW: 24, quayW: 30, blend: 150, shelfTop: -6 } },
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
      pads: [
        { id: 'hospital', name: 'Long Cay Clinic', x: 960, z: 740, kind: 'roof', above: 22, r: 11 },
        { id: 'pelican', name: 'Pelican Cay Light', x: -4120, z: -3320, kind: 'stack', r: 9 },
        { id: 'turtle', name: 'Turtle Cay Strip', x: 4750, z: 2600, kind: 'ground', r: 12 },
        { id: 'field', name: 'Long Cay Pad', x: -520, z: -150, kind: 'ground', r: 11 },
      ],
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
    waters: { harbour: { island: 0, bearingDeg: 250, length: 240, width: 180, mouthWidth: 64, depth: 6, wallW: 26, quayW: 30, blend: 160, shelfTop: -9 } },
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
      pads: [
        { id: 'hospital', name: 'Aurora Sjukhus', x: -840, z: 540, kind: 'roof', above: 30, r: 11 },
        { id: 'skerryLight', name: 'Skerry Light', x: -4470, z: -1000, kind: 'stack', r: 9 },
        { id: 'skerry', name: 'Skerry Strip', x: -4150, z: -800, kind: 'ground', r: 12 },
        { id: 'field', name: 'Aurora Field Pad', x: -520, z: -150, kind: 'ground', r: 11 },
      ],
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
    waters: { harbour: { island: 0, bearingDeg: 240, length: 240, width: 180, mouthWidth: 66, depth: 6, wallW: 26, quayW: 30, blend: 160 } },
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
      pads: [
        { id: 'hospital', name: 'Ember Isle Hospital', x: -1040, z: 640, kind: 'roof', above: 28, r: 11 },
        { id: 'ashLight', name: 'Ash Point Light', x: -4270, z: 3270, kind: 'stack', r: 9 },
        { id: 'cinder', name: 'Cinder Cone Post', x: -3650, z: 2900, kind: 'ground', r: 12 },
        { id: 'field', name: 'Ember Field Pad', x: -520, z: -150, kind: 'ground', r: 11 },
      ],
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
  /**
   * Ironhead Air Base.
   *
   * The class asked for military aircraft to have somewhere military to fly
   * from, and they were right: taking a bomber off the same palm-fringed
   * tropical strip the trainer uses rather undercuts it.
   *
   * Dry, flat, and much bigger than it needs to be, which is what a real air
   * base feels like — a great deal of concrete and not much else. Behind the
   * same passcode as the military aircraft themselves.
   */
  {
    id: 'airbase',
    waters: { harbour: { island: 0, bearingDeg: 300, length: 260, width: 200, mouthWidth: 72, depth: 6, wallW: 28, quayW: 34, blend: 160 } },
    name: 'Ironhead Air Base',
    subtitle: 'Military · long concrete, high desert',
    blurb:
      'Three kilometres of runway in the middle of a dry plain, with hardened shelters, revetments '
      + 'and a radar that turns. Nothing to look at and nowhere to hide, which is rather the idea.',
    difficulty: 3,
    difficultyLabel: 'Exposed',
    military: true,
    seaFloor: -40,
    airport: {
      elev: 300,
      headingDeg: 90,
      runway: { cx: 0, cz: 0, length: 3200, halfWidth: 34 },
      // A crosswind strip, because a base this exposed needs one — and
      // because every code path in the game expects a second runway to exist.
      runway2: { cx: 900, cz: -300, length: 1800, halfWidth: 26, headingDeg: 180 },
      pad: { x0: -2000, x1: 2000, z0: -900, z1: 900, blend: 500 },
      pad2: { x0: 760, x1: 1040, z0: -1300, z1: 700, blend: 320 },
    },
    islands: [
      // A plain, not hills: a big flat pan with the ridge kept well out at the
      // edge. An air base wants somewhere with nothing in the way.
      { name: 'Ironhead Plain', cx: 0, cz: 0, radius: 7600, peak: 360, seed: 91, profile: 'hills' },
      { name: 'The Anvil', cx: -5600, cz: 4600, radius: 1500, peak: 720, seed: 97, profile: 'hills' },
    ],
    chunks: [
      { cx: 0, cz: 0, size: 18000, segments: 256 },
      { cx: -5200, cz: 4200, size: 5000, segments: 96 },
    ],
    palette: {
      /*
       * Dry scrub over pale rock.
       *
       * These are multipliers on the shared green grass texture, so pulling
       * the numbers DOWN just makes a darker green — it took a look at the
       * map to notice that. Red has to go above 1 and blue well below it
       * before the ground stops being a field and starts being a plain.
       */
      /*
       * Further still, and then further again.
       *
       * These are multipliers on a green grass texture, so warming them is
       * not enough on its own: the texture's own green channel starts higher
       * than its red, and until red is pushed nearly twice as hard the result
       * is still a green field, only a brighter one. Measured that way rather
       * than guessed — red 2.45 against green 1.26 is where the ground stops
       * being a lawn and becomes dry scrub over pale rock, which is what
       * "the military map is sad" was actually about.
       */
      grass: [2.45, 1.26, 0.4],
      sand: [1.22, 1.08, 0.74],
      rock: [1.2, 1.06, 0.8],
      deepWater: 0x14323f,
      swell: 0x2b5f70,
      shallow: [0.42, 0.62, 0.58],
      nightSky: 0x7d8ba8,
    },
    /*
     * The outlying strip.
     *
     * Without this the pad is not flattened, and this map had no outpost at
     * all while reusing Kestrel's pad coordinate — which here is open sea,
     * twenty-odd metres under it. Delivery and Night Medevac both end at
     * that pad, so both were unflyable.
     */
    outpost: { cx: 5100, cz: 0, elev: 181, halfLen: 210, halfWidth: 55, blend: 150 },
    scenery: {
      pads: [
        { id: 'hospital', name: 'Base Medical', x: 2600, z: 2200, kind: 'roof', above: 24, r: 11 },
        { id: 'range', name: 'Range Control', x: -3800, z: -1750, kind: 'ground', r: 12 },
        { id: 'strip', name: 'Ironhead Outstation', x: 5250, z: 0, kind: 'ground', r: 12 },
        { id: 'field', name: 'Ironhead Base Pad', x: -520, z: -150, kind: 'ground', r: 11 },
      ],
      // Scrub, and plenty of it: an empty pan reads as unfinished rather than
      // as empty, and there is nothing else out here to give it any scale.
      coastTrees: 240,
      coastTreeHeight: 5,
      hillTrees: 300,
      hillTreeHeight: 7,
      hillCentre: [-5600, 4600],
      hillRadius: 1400,
      hillBand: [380, 700],
      town: { cx: 2600, cz: 2200, radius: 380, count: 22, minH: 290, maxH: 340 },
      lighthouse: [-7000, -5200],
      deliveryPad: [5100, 0],
      padTrees: 10,
      boats: 0,
      // The base itself: shelters, revetments, blast walls and the radar.
      base: { cx: 0, cz: 0, shelters: 8, revetments: 6, walls: 14, spread: 620, radarOffset: 900 },
      /*
       * The practice range: four and a half kilometres out, on a flat shelf
       * that stands a hundred metres above the ground around it. Flat so the
       * pattern is not painted down a hillside, and high so you can see it on
       * the run-in — a bullseye you only find when you are on top of it is no
       * use to anyone. The Weapons Range mission aims at whatever is drawn
       * here rather than at a number of its own.
       */
      range: { cx: -4000, cz: -1750, radius: 130 },
    },
    weather: { time: 'day', cond: 'clear', windSpeedKts: 10, windDirDeg: 270 },
  },

  {
    id: 'sfo',
    waters: { harbour: { island: 0, bearingDeg: 280, length: 280, width: 210, mouthWidth: 76, depth: 7, wallW: 28, quayW: 36, blend: 160 } },
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
    /*
     * The outlying strip.
     *
     * Without this the pad is not flattened, and this map had no outpost at
     * all while reusing Kestrel's pad coordinate — which here is open sea,
     * twenty-odd metres under it. Delivery and Night Medevac both end at
     * that pad, so both were unflyable.
     */
    outpost: { cx: 1722, cz: 4157, elev: 52, halfLen: 210, halfWidth: 55, blend: 150 },
    scenery: {
      pads: [
        { id: 'hospital', name: 'Peninsula General', x: -1800, z: 1800, kind: 'roof', above: 34, r: 11 },
        { id: 'bruno', name: 'San Bruno Mast', x: -3400, z: 2700, kind: 'stack', r: 9 },
        { id: 'strip', name: 'Bayshore Strip', x: 1872, z: 4157, kind: 'ground', r: 12 },
        { id: 'field', name: 'Field Pad', x: -520, z: -150, kind: 'ground', r: 11 },
      ],
      coastTrees: 260,
      coastTreeHeight: 9,
      hillTrees: 420,
      hillTreeHeight: 11,
      hillCentre: [-3200, 2600],
      hillRadius: 1400,
      hillBand: [60, 220],
      town: { cx: -1800, cz: 1800, radius: 900, count: 90, minH: 14, maxH: 150 },
      lighthouse: [-5200, -2600],
      deliveryPad: [1722, 4157],
      padTrees: 60,
      boats: 5,
    },
    weather: { time: 'day', cond: 'cloudy', windSpeedKts: 16, windDirDeg: 290 },
  },

  {
    id: 'oak',
    waters: { harbour: { island: 0, bearingDeg: 270, length: 280, width: 210, mouthWidth: 76, depth: 7, wallW: 28, quayW: 36, blend: 160 } },
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
      /*
       * The two coordinate pairs in here were the wrong way round: 1,900 m of
       * flattening across x and only 280 m along z, which is the shape you cut
       * for an east-west strip. The North Field runway above is on heading 180
       * and 1,921 m long, so all but a couple of hundred metres of it ran off
       * the flattened ground and over whatever the height field happened to be
       * doing. Narrow in x and centred on cx, long in z and centred on cz —
       * the way round the air base and San Francisco already had it.
       */
      pad2: { x0: -840, x1: -560, z0: -1900, z1: 100, blend: 240 },
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
    /*
     * The outlying strip.
     *
     * Without this the pad is not flattened, and this map had no outpost at
     * all while reusing Kestrel's pad coordinate — which here is open sea,
     * twenty-odd metres under it. Delivery and Night Medevac both end at
     * that pad, so both were unflyable.
     */
    outpost: { cx: -1165, cz: 4347, elev: 54, halfLen: 210, halfWidth: 55, blend: 150 },
    scenery: {
      pads: [
        { id: 'hospital', name: 'East Bay General', x: 1600, z: 1500, kind: 'roof', above: 34, r: 11 },
        { id: 'hills', name: 'Oakland Hills Post', x: 3400, z: 3200, kind: 'roof', above: 20, r: 10 },
        { id: 'strip', name: 'Estuary Strip', x: -1015, z: 4347, kind: 'ground', r: 12 },
        { id: 'field', name: 'Field Pad', x: -520, z: -150, kind: 'ground', r: 11 },
      ],
      coastTrees: 220,
      coastTreeHeight: 9,
      hillTrees: 700,
      hillTreeHeight: 13,
      hillCentre: [3400, 3200],
      hillRadius: 2000,
      hillBand: [80, 340],
      town: { cx: 1600, cz: 1500, radius: 800, count: 70, minH: 12, maxH: 90 },
      lighthouse: [-4200, 2400],
      deliveryPad: [-1165, 4347],
      padTrees: 60,
      boats: 4,
    },
    weather: { time: 'day', cond: 'clear', windSpeedKts: 11, windDirDeg: 290 },
  },

  {
    id: 'lax',
    waters: { harbour: { island: 0, bearingDeg: 250, length: 280, width: 210, mouthWidth: 76, depth: 7, wallW: 28, quayW: 36, blend: 160 } },
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
    /*
     * The outlying strip.
     *
     * Without this the pad is not flattened, and this map had no outpost at
     * all while reusing Kestrel's pad coordinate — which here is open sea,
     * twenty-odd metres under it. Delivery and Night Medevac both end at
     * that pad, so both were unflyable.
     */
    outpost: { cx: 3570, cz: -2739, elev: 74, halfLen: 210, halfWidth: 55, blend: 150 },
    scenery: {
      pads: [
        { id: 'hospital', name: 'Basin Medical Center', x: 2600, z: 1400, kind: 'roof', above: 38, r: 11 },
        { id: 'verdes', name: 'Palos Verdes Post', x: -1800, z: 5200, kind: 'roof', above: 20, r: 10 },
        { id: 'strip', name: 'Harbour Strip', x: 3720, z: -2739, kind: 'ground', r: 12 },
        { id: 'field', name: 'Field Pad', x: -520, z: -150, kind: 'ground', r: 11 },
      ],
      coastTrees: 300,
      coastTreeHeight: 11,
      hillTrees: 520,
      hillTreeHeight: 12,
      hillCentre: [-1800, 5200],
      hillRadius: 1700,
      hillBand: [90, 380],
      town: { cx: 2600, cz: 1400, radius: 1200, count: 130, minH: 14, maxH: 170 },
      lighthouse: [-3600, 6400],
      deliveryPad: [3570, -2739],
      padTrees: 70,
      boats: 4,
    },
    weather: { time: 'day', cond: 'clear', windSpeedKts: 10, windDirDeg: 260 },
  },

  /* ==================================================================== *
   * THE BOAT MAPS.
   *
   * A harbour is not an airfield, and these are not flight maps with a boat
   * on them. Each is built round a harbour, at the scale a boat actually
   * moves at: everything that matters is inside two kilometres of the quay.
   *
   * They still carry an airfield, out at the edge, for two reasons. One is
   * that heightAt reads AIRPORT for its pad and its approach corridors and
   * falls back to Kestrel's if a map brings none — which would quarry a
   * fourteen-metre plateau through the middle of the harbour. The other is
   * that a child who has learned to fly should be able to fly to Sennen and
   * see the harbour they took the lifeboat out of, which is the whole
   * argument for one world. Each strip is small, grass, and sited so its
   * approach corridor runs out to sea instead of flattening a headland.
   * ==================================================================== */

  {
    id: 'sennen',
    name: 'Sennen Cove',
    subtitle: 'Home water · a stone harbour under a headland',
    blurb:
      'A proper harbour cut into the foot of a headland, a buoyed channel a kilometre out to the '
      + 'fairway buoy, and deep, quiet water either side of it. Two rocks, both well clear of the '
      + 'channel, both on the chart. This is where everyone learns.',
    difficulty: 1,
    difficultyLabel: 'Gentle',
    game: 'boat',
    seaFloor: -16,
    // The chart's default reach is twelve kilometres, which puts one pixel
    // every fifty-six metres — at that scale this whole harbour is five pixels
    // and the channel is two. See the minimap patch in the notes.
    chartReach: 3400,
    airport: {
      elev: 22,
      headingDeg: 90,
      runway: { cx: -5600, cz: 2400, length: 900, halfWidth: 14 },
      runway2: { cx: -5350, cz: 2560, length: 520, halfWidth: 11, headingDeg: 180 },
      pad: { x0: -6100, x1: -5100, z0: 2260, z1: 2540, blend: 170 },
      pad2: { x0: -5420, x1: -5280, z0: 2300, z1: 2820, blend: 150 },
    },
    islands: [
      { name: 'Sennen Head', cx: 0, cz: -2400, radius: 2300, peak: 150, seed: 3, profile: 'hills' },
      { name: 'Gull Island', cx: 2250, cz: 780, radius: 560, peak: 46, seed: 23, profile: 'hills' },
      { name: 'Carn Point', cx: -2500, cz: 250, radius: 480, peak: 62, seed: 41, profile: 'hills' },
      { name: 'Wester Isle', cx: -5600, cz: 2400, radius: 1700, peak: 90, seed: 47, profile: 'plains' },
    ],
    /*
     * Chunks, and why there is no fine one over the harbour.
     *
     * Planes may not overlap, so local refinement would mean a nine-cell grid
     * round the basin, nine extra draw calls, and a hole cut in the island
     * chunk. It buys nothing: the sea is opaque, so the basin under it is
     * never seen, and the breakwaters and the quay edge are geometry from
     * harbour.js standing on top of this. Ninety-one thousand height samples
     * against Kestrel's eighty-six.
     */
    chunks: [
      { cx: 0, cz: -1400, size: 6400, segments: 256 },
      { cx: 0, cz: -6400, size: 3600, segments: 96 },
      { cx: -5600, cz: 2400, size: 4400, segments: 128 },
    ],
    palette: {
      grass: [0.86, 0.98, 0.78],
      sand: [0.98, 0.96, 0.9],
      rock: [0.88, 0.9, 0.92],
      deepWater: 0x11364f,
      swell: 0x336d8c,
      shallow: [0.3, 0.62, 0.66],
      nightSky: 0x93abc8,
    },
    outpost: { cx: -5600, cz: 2400, elev: 22, halfLen: 210, halfWidth: 55, blend: 150 },
    /*
     * The harbour. Basin 270 × 200 at six metres, mouth facing due south, the
     * quay along the landward end where the ground comes down to meet it.
     * Measured: the ground behind the quay is +3.2 at the wall, +26 eighty
     * metres back and +118 at four hundred. It is a cliff-backed harbour, and
     * that is deliberate — it is the thing you can see from two miles out.
     *
     * The channel is marked but NOT dredged: the approach shelf is nine
     * metres, the boat draws one, and there is nothing to dig. Buoys here mean
     * "this is the way home", not "outside this line you stop".
     *
     * Channel: 1,095 m. 100 seconds at Half, 50 at Full.
     */
    waters: {
      harbour: {
        cx: 0, cz: -70, length: 270, width: 200, mouthDeg: 180, mouthWidth: 74,
        depth: 6, wallW: 26, quayW: 34, wallY: 4.2, quayY: 3.2, blend: 150,
      },
      channel: { halfWidth: 55, blend: 40, path: [[0, 60], [0, 430], [-60, 780], [-60, 1150]] },
      shoals: [
        // The shelf goes first: everything after it stands on it.
        { name: 'The Bar', cx: 0, cz: 100, r: 3000, top: -9, pow: 0.75 },
        // Dries nearly a metre and breaks white — you can see this one.
        { name: 'Cormorant Rock', cx: 470, cz: 540, r: 140, top: 0.9, pow: 1.7 },
        // And this one you cannot. 0.4 m under the keel, 570 m clear of the
        // channel, and on the chart. It is the only trap on the map and it is
        // where Man Overboard sends you.
        { name: 'The Gribbin', cx: -570, cz: 320, r: 125, top: -1.4, pow: 1.3 },
        { name: 'Gull Ledge', cx: 1560, cz: 560, r: 240, top: -0.9, pow: 1.2 },
      ],
    },
    scenery: {
      coastTrees: 420,
      coastTreeHeight: 9,
      hillTrees: 380,
      hillTreeHeight: 12,
      hillCentre: [200, -2000],
      hillRadius: 1600,
      hillBand: [40, 150],
      // The village, up the hill behind the harbour, where a village goes.
      town: { cx: 150, cz: -900, radius: 520, count: 44, minH: 14, maxH: 120 },
      // On the head of the west breakwater arm, not on a hill three miles
      // away. The sweep at night is the boat's only reference in Night Shout,
      // and the code that turns it is already written.
      lighthouse: [-113, 55],
      deliveryPad: [-5600, 2400],
      padTrees: 140,
      boats: 2,
    },
    weather: { time: 'day', cond: 'clear', windSpeedKts: 8, windDirDeg: 240 },
  },

  {
    id: 'skerries',
    name: 'The Skerries',
    subtitle: 'Hard · rock, and one lane through it',
    blurb:
      'Stacks standing out of the water, a field of rock that mostly does not, and a single dredged '
      + 'lane winding through the middle of it. Most of the chart is amber. Read it before you go.',
    difficulty: 4,
    difficultyLabel: 'Hard',
    game: 'boat',
    seaFloor: -20,
    chartReach: 3200,
    airport: {
      elev: 30,
      headingDeg: 90,
      runway: { cx: 5200, cz: -3400, length: 820, halfWidth: 13 },
      runway2: { cx: 5420, cz: -3260, length: 480, halfWidth: 10, headingDeg: 180 },
      pad: { x0: 4740, x1: 5660, z0: -3540, z1: -3260, blend: 170 },
      pad2: { x0: 5350, x1: 5490, z0: -3520, z1: -3000, blend: 150 },
    },
    islands: [
      { name: 'Skerry Head', cx: -1700, cz: -1900, radius: 1500, peak: 230, seed: 211, profile: 'ridge' },
      { name: 'Muckle Stack', cx: 1750, cz: 1450, radius: 430, peak: 120, seed: 233, profile: 'ridge' },
      { name: 'Outer Holm', cx: 5200, cz: -3400, radius: 1500, peak: 80, seed: 239, profile: 'plains' },
    ],
    chunks: [
      { cx: 0, cz: -400, size: 6400, segments: 256 },
      { cx: 5200, cz: -3400, size: 4000, segments: 112 },
    ],
    palette: {
      grass: [0.7, 0.84, 0.72],
      sand: [0.8, 0.82, 0.84],
      rock: [0.84, 0.88, 0.94],
      deepWater: 0x0c2839,
      swell: 0x2a5a72,
      shallow: [0.22, 0.52, 0.58],
      nightSky: 0x8aa2bf,
    },
    outpost: { cx: 5200, cz: -3400, elev: 30, halfLen: 200, halfWidth: 50, blend: 140 },
    /*
     * The shelf is four and a half metres over most of the map, which is what
     * makes the dredged lane worth anything: eight and a half in the lane,
     * three and a half beside it, and nothing at all over a dozen of the
     * rocks. Measured along the whole lane, the least water under the keel is
     * 7.5 m — you cannot touch inside the marks, and you very easily can
     * outside them. That is the map in one sentence.
     *
     * Channel: 1,992 m. 181 seconds at Half. The longest transit in the boat
     * game, and the only one over three minutes — and it is three minutes of
     * steering, not three minutes of holding a key.
     *
     * Wren Reef, at the seaward end, is where the fishing boat goes aground:
     * 0.6 m under the keel at the edge and drying in the middle, 600 m off
     * the lane, which is exactly far enough that you have to leave the lane
     * to do the job.
     */
    waters: {
      harbour: {
        cx: -1180, cz: -620, length: 240, width: 180, mouthDeg: 135, mouthWidth: 64,
        depth: 6, wallW: 24, quayW: 30, wallY: 4.4, quayY: 3.2, blend: 140,
      },
      channel: {
        halfWidth: 50, depth: 8.5, blend: 45,
        path: [[-1050, -490], [-780, -210], [-470, 90], [-360, 470], [-520, 820], [-430, 1200]],
      },
      shoals: [
        { name: 'The Shelf', cx: -200, cz: 200, r: 3100, top: -4.6, pow: 0.7 },
        { cx: -760, cz: 120, r: 130, top: 1.8, pow: 1.8 },
        { cx: -140, cz: 210, r: 150, top: -1.1, pow: 1.3 },
        { cx: -700, cz: 560, r: 140, top: 2.4, pow: 1.9 },
        { cx: -170, cz: 700, r: 160, top: -0.7, pow: 1.2 },
        { cx: -790, cz: 1080, r: 150, top: -1.3, pow: 1.4 },
        { cx: -120, cz: 1180, r: 175, top: 1.2, pow: 1.6 },
        { cx: 260, cz: 880, r: 190, top: -0.5, pow: 1.1 },
        { cx: 340, cz: 1440, r: 165, top: 2.9, pow: 2.0 },
        { cx: -1000, cz: 1620, r: 210, top: -0.8, pow: 1.2 },
        { cx: 60, cz: 1900, r: 180, top: -1.6, pow: 1.3 },
        { cx: 700, cz: 320, r: 155, top: -1.0, pow: 1.3 },
        { cx: 980, cz: 900, r: 200, top: 1.6, pow: 1.7 },
        { name: 'Wren Reef', cx: 640, cz: 1760, r: 170, top: -0.4, pow: 1.2 },
        { cx: -1380, cz: 640, r: 145, top: -1.9, pow: 1.2 },
        { cx: 1420, cz: 300, r: 175, top: -1.2, pow: 1.2 },
      ],
    },
    scenery: {
      coastTrees: 120,
      coastTreeHeight: 6,
      hillTrees: 220,
      hillTreeHeight: 9,
      hillCentre: [-1700, -2100],
      hillRadius: 1300,
      hillBand: [40, 220],
      town: { cx: -1500, cz: -1200, radius: 360, count: 20, minH: 14, maxH: 90 },
      lighthouse: [-1035, -475],
      deliveryPad: [5200, -3400],
      padTrees: 60,
      boats: 2,
    },
    weather: { time: 'day', cond: 'cloudy', windSpeedKts: 18, windDirDeg: 290 },
    features: { waterfalls: 3 },
  },

  {
    id: 'longbank',
    name: 'Longbank Sands',
    subtitle: 'Navigation · one thin channel across a great shallow bank',
    blurb:
      'From the wheel it looks like open sea in every direction. On the chart it is one blue thread '
      + 'across four kilometres of sand, and the sand has patches that dry. Nothing here is steep. '
      + 'Everything here is shallow.',
    difficulty: 3,
    difficultyLabel: 'Medium',
    game: 'boat',
    seaFloor: -13,
    chartReach: 3600,
    airport: {
      elev: 14,
      headingDeg: 90,
      runway: { cx: 0, cz: -5200, length: 1000, halfWidth: 15 },
      runway2: { cx: 260, cz: -5040, length: 560, halfWidth: 12, headingDeg: 180 },
      pad: { x0: -560, x1: 560, z0: -5350, z1: -5050, blend: 180 },
      pad2: { x0: 190, x1: 330, z0: -5340, z1: -4740, blend: 150 },
    },
    islands: [
      { name: 'Stryke Island', cx: -300, cz: -2500, radius: 1200, peak: 34, seed: 307, profile: 'flat' },
      { name: 'The Ness', cx: -400, cz: -5200, radius: 2400, peak: 70, seed: 311, profile: 'plains' },
    ],
    chunks: [
      { cx: 0, cz: -200, size: 7000, segments: 256 },
      { cx: -400, cz: -6200, size: 5000, segments: 128 },
    ],
    palette: {
      grass: [0.92, 1.0, 0.8],
      sand: [1.08, 1.02, 0.88],
      rock: [0.96, 0.94, 0.9],
      deepWater: 0x16455e,
      swell: 0x4585a0,
      // Pale green-grey: sand under three metres of water, not a coral lagoon.
      shallow: [0.42, 0.68, 0.66],
      nightSky: 0x9db4cd,
    },
    outpost: { cx: 0, cz: -5200, elev: 14, halfLen: 210, halfWidth: 55, blend: 150 },
    /*
     * The bank is one shoal four kilometres across, lifting a thirteen-metre
     * sea floor to four and a half — so there is real deep water at the edges
     * of the map, which is what makes the bank read as a bank rather than as
     * "the sea is shallow here". Nine drying patches sit on top of it, four of
     * them within 200 m of the channel.
     *
     * Channel: 2,669 m end to end. 243 seconds at Half — that is the map's
     * free-patrol length, not a mission leg. In the Gale the casualty drifts
     * at about 1.4 km down it, which is 127 seconds at Half and rather longer
     * when you cannot hold Half into it.
     */
    waters: {
      harbour: {
        cx: -300, cz: -1230, length: 250, width: 190, mouthDeg: 170, mouthWidth: 70,
        depth: 6, wallW: 26, quayW: 32, wallY: 4.2, quayY: 3.2, blend: 150,
      },
      channel: {
        halfWidth: 60, depth: 9, blend: 55,
        path: [
          [-280, -1100], [-230, -700], [-420, -180], [-300, 420], [120, 820], [520, 1180],
        ],
      },
      shoals: [
        { name: 'Longbank', cx: 260, cz: 700, r: 4000, top: -4.6, pow: 0.55 },
        { cx: -820, cz: -260, r: 260, top: -0.2, pow: 1.1 },
        { cx: 240, cz: -140, r: 300, top: 0.3, pow: 1.0 },
        { cx: -120, cz: 900, r: 280, top: -0.4, pow: 1.1 },
        { cx: 900, cz: 640, r: 320, top: 0.2, pow: 1.0 },
        { cx: 160, cz: 1560, r: 300, top: -0.3, pow: 1.1 },
        { cx: 1040, cz: 1620, r: 340, top: 0.4, pow: 1.0 },
        { cx: -640, cz: 1420, r: 290, top: -0.5, pow: 1.1 },
        { cx: 820, cz: 2260, r: 310, top: -0.2, pow: 1.0 },
        { cx: -300, cz: 2000, r: 260, top: 0.1, pow: 1.1 },
      ],
    },
    scenery: {
      coastTrees: 260,
      coastTreeHeight: 7,
      hillTrees: 300,
      hillTreeHeight: 10,
      hillCentre: [-400, -5000],
      hillRadius: 2000,
      hillBand: [16, 70],
      town: { cx: -420, cz: -1900, radius: 420, count: 26, minH: 8, maxH: 32 },
      lighthouse: [-411, -1105],
      deliveryPad: [0, -5200],
      padTrees: 120,
      boats: 3,
    },
    weather: { time: 'day', cond: 'cloudy', windSpeedKts: 22, windDirDeg: 250 },
  },


  /* ==================================================================== *
   * THE DRIVING MAPS.
   *
   * Built flat on purpose. The terrain is 30 to 70 metres per quad, so a road
   * is not a thing you draw on the ground — it is a thing the ground is
   * levelled for. Every coordinate in these three was probed against the real
   * height function rather than chosen.
   * ==================================================================== */

  /**
   * Drover's Flat — the courier tutorial island.
   *
   * Low farmland, nothing above 84 m, seven places joined by about twelve
   * kilometres of road. Chosen to be the flattest map in the game on purpose:
   * on ground this gentle a cut road barely deforms the terrain at all, so it
   * is the one place where the road ribbon and the terrain mesh cannot
   * disagree, and therefore the right island to get the roads working on
   * before anybody tries Cape Vessel.
   *
   * Measured: shoreline 1,680-2,100 m from the island centre against a
   * nominal 2,100, so everything inland sits within 1,500 m of it.
   */
  {
    id: 'drovers',
    game: 'car',
    name: "Drover's Flat",
    subtitle: 'Farmland · villages, a relay and a ferry quay',
    blurb:
      'Low green farmland with a village at every turning and a ferry quay on the south-west shore. '
      + 'Nothing here is steep and everything here is somewhere, which is what you want the first time '
      + 'you take the van out. The airstrip sits in the middle of it all.',
    difficulty: 1,
    difficultyLabel: 'Gentle',
    games: ['car', 'flight', 'boat'],
    seaFloor: -26,
    airport: {
      elev: 12,
      headingDeg: 90,
      // A short strip, but not shorter than 900 m: airport.js draws an 880 m
      // taxiway at fixed coordinates, so a strip much under that gets a
      // taxiway sticking out past both ends of it.
      runway: { cx: 0, cz: 0, length: 1000, halfWidth: 18 },
      runway2: { cx: 240, cz: -60, length: 760, halfWidth: 14, headingDeg: 180 },
      pad: { x0: -620, x1: 620, z0: -230, z1: 190, blend: 180 },
      pad2: { x0: 160, x1: 320, z0: -500, z1: 380, blend: 160 },
    },
    // The default corridor is a 5.4 km trench 760 m wide. On an island 4 km
    // across that is most of the driving.
    corridor: { halfWidth: 300, blend: 260, fadeFrom: 1600, length: 3400 },
    corridor2: { halfWidth: 240, blend: 200, fadeFrom: 1200, length: 2600 },
    islands: [
      { name: "Drover's Flat", cx: 400, cz: 200, radius: 2100, peak: 95, seed: 401, profile: 'plains' },
      { name: 'Cobb Rock', cx: -4200, cz: -2600, radius: 300, peak: 70, seed: 409, profile: 'hills' },
    ],
    chunks: [
      // 23.6 m per quad against Kestrel's 39.1, for 84k vertices against 66k.
      { cx: 300, cz: 150, size: 6800, segments: 288 },
      // Far enough out that it does not overlap the main chunk at all. Kestrel
      // tolerates an overlap because its is over open sea; better not to have
      // one.
      { cx: -4200, cz: -2600, size: 1600, segments: 56 },
    ],
    palette: {
      grass: [0.93, 1.05, 0.82],
      sand: [1.05, 1.0, 0.86],
      rock: [0.98, 0.97, 0.94],
      deepWater: 0x13405c,
      swell: 0x3f86a4,
      shallow: [0.35, 0.8, 0.72],
      nightSky: 0x9fb8d8,
    },
    outpost: { cx: 1180, cz: -680, elev: 'auto', minElev: 6, halfLen: 200, halfWidth: 50, blend: 150 },
    flats: [
      // Measured natural ground at each, after resolveFlats: 22, 4.5 (given),
      // 67, 47, 72 m. Worst skirt grade 32%, which is the quay's mole dropping
      // to the seabed and is therefore underwater.
      { id: 'depot', name: 'Drover Depot', kind: 'depot', x0: 840, x1: 1060, z0: -295, z1: -125, elev: 'auto', blend: 100, surface: 'tarmac' },
      // A shore flat straddles the coast, so it gets a NUMBER: 'auto' would
      // average the land and the seabed. The seaward end becomes the mole.
      { id: 'quay', name: 'Ferry Hard', kind: 'harbour', x0: -1780, x1: -1360, z0: -700, z1: -520, elev: 4.5, blend: 95, surface: 'tarmac' },
      { id: 'town', name: 'Drover', kind: 'town', x0: 1130, x1: 1770, z0: 570, z1: 1130, elev: 'auto', blend: 150, surface: 'grass' },
      { id: 'holt', name: 'Holt', kind: 'village', x0: -580, x1: -100, z0: 680, z1: 1080, elev: 'auto', blend: 140, surface: 'grass' },
      { id: 'relay', name: 'Drover Relay', kind: 'relay', x0: 1270, x1: 1450, z0: 1200, z1: 1380, elev: 'auto', blend: 110, surface: 'gravel' },
    ],
    /*
     * Where the van starts and what the road router should join up.
     *
     * `depot` replaces the hardcoded (-430, 0, -95) in main.js's startDrive,
     * which is Kestrel's taxiway and is a field on Los Angeles and open sea on
     * Coral Atoll. `boatOnly` marks a place no road can reach, so the router
     * does not spend an A* search trying to bridge to an offshore rock.
     */
    courier: {
      depot: { x: 950, z: -210, headingDeg: 270 },
      places: [
        { id: 'depot', name: 'Drover Depot', x: 950, z: -210, kind: 'depot' },
        { id: 'apron', name: 'The Airfield', x: -80, z: -148, kind: 'apron' },
        { id: 'town', name: 'Drover', x: 1450, z: 850, kind: 'town' },
        { id: 'holt', name: 'Holt', x: -340, z: 880, kind: 'village' },
        { id: 'quay', name: 'Ferry Hard', x: -1570, z: -610, kind: 'harbour' },
        { id: 'relay', name: 'Drover Relay', x: 1360, z: 1290, kind: 'relay' },
        { id: 'outpost', name: 'Weather Station', x: 1180, z: -680, kind: 'outpost' },
        { id: 'light', name: 'Cobb Light', x: -4200, z: -2600, kind: 'lighthouse', boatOnly: true },
      ],
    },
    scenery: {
      coastTrees: 800, coastTreeHeight: 11,
      hillTrees: 420, hillTreeHeight: 13,
      hillCentre: [1360, 1290], hillRadius: 900, hillBand: [40, 85],
      town: { cx: 1450, cz: 850, radius: 300, count: 48, minH: 30, maxH: 80 },
      lighthouse: [-4200, -2600],
      deliveryPad: [1180, -680],
      padTrees: 220,
      boats: 3,
      harbour: { flat: 'quay', cranes: 1, containers: 16, moored: 2, sheds: 2 },
    },
    weather: { time: 'day', cond: 'clear', windSpeedKts: 5, windDirDeg: 240 },
    features: {
      fields: { cx: 700, cz: 400, radius: 1500, count: 48 },
      reef: { islands: [0], colour: 0x4fc4a8, width: 0.14 },
    },
  },

  /**
   * Cape Vessel — land shaped for a car rather than land with a runway on it.
   *
   * Seven kilometres long and under two wide, which the island system cannot
   * express in one entry because an island is a radial blob. So it is a CHAIN
   * of five overlapping circles strung along the x axis; max() blending fuses
   * them into one continuous cape and the coastline wobble makes the joins
   * invisible. Spacing is 1,150 m against radii of about 850, which was chosen
   * so that at most TWO circles are ever evaluated at any point — a third
   * would be a third set of fbm calls on every height sample in the overlap,
   * and this function runs 200,000 times per terrain build.
   *
   * Measured after halving the ridge peaks: 315 m at the top, the pass at 177,
   * the relay bench at 298. A road climbing 300 m within a 14% gradient clamp
   * needs about 2.1 km of length, and there is 1.7 km of cape width to wind it
   * in — which is precisely how the router ends up inventing its own hairpins.
   *
   * Stated plainly because it is a real cost: the corridor is cut right back,
   * so taking off eastbound out of Vessel Field means climbing at a ridge that
   * starts 1.1 km away. That is deliberate. This is a car map.
   */
  {
    id: 'cape',
    game: 'car',
    name: 'Cape Vessel',
    subtitle: 'Peninsula · one road over the spine',
    blurb:
      'Seven kilometres of cape with a ridge down the middle of it, a quay on the eastern point and a '
      + 'short strip on the low western end. There is one way across the spine and it is not straight. '
      + 'Wonderful to drive; a hard place to fly out of eastbound, which is on purpose.',
    difficulty: 3,
    difficultyLabel: 'Testing',
    games: ['car', 'boat', 'flight'],
    seaFloor: -38,
    airport: {
      elev: 16,
      headingDeg: 90,
      runway: { cx: 0, cz: 0, length: 900, halfWidth: 16 },
      runway2: { cx: 230, cz: -70, length: 640, halfWidth: 13, headingDeg: 180 },
      pad: { x0: -560, x1: 560, z0: -220, z1: 180, blend: 170 },
      pad2: { x0: 150, x1: 310, z0: -440, z1: 300, blend: 150 },
    },
    // Short and narrow. At the default 5,400 m this would hold the whole spine
    // down to 26 m and there would be no map.
    corridor: { halfWidth: 210, blend: 190, fadeFrom: 600, length: 1500 },
    corridor2: { halfWidth: 170, blend: 150, fadeFrom: 500, length: 1200 },
    islands: [
      { name: 'West Head', cx: -1150, cz: 60, radius: 820, peak: 70, seed: 503, profile: 'hills' },
      { name: 'Vessel Field', cx: 0, cz: 0, radius: 880, peak: 55, seed: 509, profile: 'plains' },
      // These two read 'ridge', which overshoots: peaks of 430 and 520 measured
      // 660 m on the ground, an alpine pass on a seven-kilometre cape. Halved.
      { name: 'The Spine', cx: 1150, cz: -90, radius: 840, peak: 190, seed: 521, profile: 'ridge' },
      { name: 'High Vessel', cx: 2300, cz: 40, radius: 860, peak: 230, seed: 523, profile: 'ridge' },
      // The eastern point is 'plains' and low so that the quay works: on
      // 'hills' at peak 210 its flank reached 237 m and a quay at 5 m would
      // have cut a hundred-metre hole in it.
      { name: 'Vessel Point', cx: 3450, cz: -120, radius: 800, peak: 90, seed: 541, profile: 'plains' },
    ],
    // One chunk, 25.0 m per quad, 93k vertices. Half of it is sea, which costs
    // almost nothing: islandField rejects on a squared distance.
    chunks: [{ cx: 1150, cz: -20, size: 7600, segments: 304 }],
    palette: {
      grass: [0.86, 0.97, 0.78],
      sand: [0.94, 0.92, 0.84],
      rock: [0.9, 0.92, 0.95],
      deepWater: 0x0f3450,
      swell: 0x336f92,
      shallow: [0.3, 0.66, 0.68],
      nightSky: 0x93aac6,
    },
    outpost: { cx: 3690, cz: 190, elev: 'auto', minElev: 8, halfLen: 190, halfWidth: 55, blend: 140 },
    flats: [
      // The depot is up on West Head at 97 m, eighty metres above the field it
      // serves. That is not an accident of the noise, it is the map: every job
      // on Cape Vessel starts by coming down the hill.
      { id: 'depot', name: 'Vessel Depot', kind: 'depot', x0: -1000, x1: -800, z0: -480, z1: -320, elev: 'auto', blend: 100, surface: 'tarmac' },
      { id: 'quay', name: 'Vessel Quay', kind: 'harbour', x0: 4180, x1: 4750, z0: -240, z1: -100, elev: 5, blend: 110, surface: 'tarmac' },
      // The saddle the road has to find. 177 m, and the ground rolls only 9 m
      // across the whole bench, so it is a genuine pass rather than a cut.
      { id: 'pass', name: 'The Pass', kind: 'layby', x0: 1520, x1: 1660, z0: -450, z1: -310, elev: 'auto', blend: 130, surface: 'gravel' },
      { id: 'relay', name: 'Vessel Relay', kind: 'relay', x0: 1720, x1: 1880, z0: -60, z1: 100, elev: 'auto', blend: 120, surface: 'gravel' },
      { id: 'kerrow', name: 'Kerrow', kind: 'village', x0: -1160, x1: -820, z0: 340, z1: 660, elev: 'auto', blend: 140, surface: 'grass' },
    ],
    courier: {
      depot: { x: -900, z: -400, headingDeg: 90 },
      places: [
        { id: 'depot', name: 'Vessel Depot', x: -900, z: -400, kind: 'depot' },
        { id: 'apron', name: 'Vessel Field', x: -80, z: -148, kind: 'apron' },
        { id: 'kerrow', name: 'Kerrow', x: -990, z: 500, kind: 'village' },
        { id: 'pass', name: 'The Pass', x: 1590, z: -380, kind: 'layby' },
        { id: 'relay', name: 'Vessel Relay', x: 1800, z: 20, kind: 'relay' },
        { id: 'outpost', name: 'Point Station', x: 3690, z: 190, kind: 'outpost' },
        { id: 'quay', name: 'Vessel Quay', x: 4465, z: -170, kind: 'harbour' },
      ],
    },
    scenery: {
      coastTrees: 640, coastTreeHeight: 10,
      hillTrees: 520, hillTreeHeight: 14,
      hillCentre: [1750, -100], hillRadius: 1300, hillBand: [90, 310],
      town: { cx: -990, cz: 500, radius: 300, count: 34, minH: 60, maxH: 130 },
      // On the harbour mole, which is authored flat ground, so the lighthouse
      // stands on the quay instead of in the sea.
      lighthouse: [4600, -170],
      deliveryPad: [3690, 190],
      padTrees: 180,
      boats: 3,
      harbour: { flat: 'quay', cranes: 1, containers: 20, moored: 2, sheds: 2 },
    },
    weather: { time: 'day', cond: 'cloudy', windSpeedKts: 14, windDirDeg: 250 },
    features: {
      waterfalls: 3,
      reef: { islands: [1, 4], colour: 0x46c6b4, width: 0.16 },
    },
  },

  /**
   * Cullen Sands — the one genuinely new driving idea in the set.
   *
   * Two islands with 900 m of shallow water between them and a causeway across
   * it, and the causeway is the only way over. That is a place the flight maps
   * cannot supply, because from the air a causeway is a line and from a van it
   * is a minute of committed driving with water either side. It is also what
   * the Low Tide job is for.
   *
   * The causeway is 120 metres wide, which is wider than a causeway should be
   * and is not negotiable: the terrain mesh here is 23.6 m per quad, so
   * anything narrower than about three quads simply is not in the geometry the
   * player sees. Read as a sand bar with a road down it, not a viaduct.
   *
   * Measured: Cullen's coast runs 980-1,720 m against a nominal 1,300, the gap
   * runs x 680 to 1,580, Sker Holm tops out at 185 m. The climb from the
   * eastern landfall to the quarry is 12% direct over 1,253 m and to the
   * outpost 18% over 642, so the router will have to switchback on Sker Holm.
   * That is intended and it is the first thing to test.
   */
  {
    id: 'cullen',
    game: 'car',
    name: 'Cullen Sands',
    subtitle: 'Two islands · one causeway',
    blurb:
      'A farming island, a quarry island, and a mile of causeway across the sands between them. The '
      + 'crossing is gravel, it is the only way over, and the tide does not care what you are carrying. '
      + 'Everything else here is easy.',
    difficulty: 2,
    difficultyLabel: 'Steady',
    games: ['car', 'boat', 'flight'],
    // Shallow on purpose: the crossing should read as sand banks, not as a
    // bridge over deep water.
    seaFloor: -14,
    airport: {
      elev: 11,
      headingDeg: 90,
      runway: { cx: 0, cz: 0, length: 980, halfWidth: 18 },
      runway2: { cx: 250, cz: -60, length: 720, halfWidth: 14, headingDeg: 180 },
      pad: { x0: -600, x1: 600, z0: -230, z1: 190, blend: 180 },
      pad2: { x0: 170, x1: 330, z0: -480, z1: 360, blend: 160 },
    },
    corridor: { halfWidth: 260, blend: 220, fadeFrom: 1400, length: 3000 },
    corridor2: { halfWidth: 210, blend: 180, fadeFrom: 900, length: 2100 },
    islands: [
      { name: 'Cullen', cx: -1000, cz: 200, radius: 1300, peak: 90, seed: 601, profile: 'plains' },
      // Peak 230 measured 286 m over an 860 m island — a flank too steep for a
      // van to have any road at all. 140 gives 185 m and a climb the router can
      // wind up.
      { name: 'Sker Holm', cx: 2400, cz: -250, radius: 950, peak: 140, seed: 607, profile: 'hills' },
      { name: 'Gull Skerry', cx: -2500, cz: -2200, radius: 260, peak: 40, seed: 613, profile: 'flat' },
    ],
    chunks: [{ cx: 450, cz: -50, size: 6800, segments: 288 }],
    palette: {
      grass: [0.9, 1.02, 0.8],
      sand: [1.14, 1.08, 0.92],
      rock: [1.0, 0.98, 0.94],
      deepWater: 0x1a5a76,
      swell: 0x4ea4b4,
      shallow: [0.4, 0.86, 0.8],
      nightSky: 0xa4bdd6,
    },
    outpost: { cx: 2150, cz: -510, elev: 'auto', minElev: 8, halfLen: 190, halfWidth: 55, blend: 140 },
    flats: [
      // x 620 and x 1640 are just inside each shoreline, measured. A number,
      // not 'auto', because the middle of it is over water.
      { id: 'causeway', name: 'The Sands Causeway', kind: 'causeway', x0: 620, x1: 1640, z0: -180, z1: -60, elev: 5.5, blend: 95, surface: 'gravel' },
      { id: 'depot', name: 'Cullen Depot', kind: 'depot', x0: -1300, x1: -1100, z0: -250, z1: -90, elev: 'auto', blend: 100, surface: 'tarmac' },
      { id: 'quay', name: 'Cullen Quay', kind: 'harbour', x0: -2700, x1: -2100, z0: 500, z1: 680, elev: 4, blend: 95, surface: 'tarmac' },
      { id: 'town', name: 'Cullen', kind: 'town', x0: -1440, x1: -920, z0: 790, z1: 1230, elev: 'auto', blend: 150, surface: 'grass' },
      { id: 'quarry', name: 'Sker Quarry', kind: 'quarry', x0: 2740, x1: 2940, z0: 140, z1: 340, elev: 'auto', blend: 130, surface: 'gravel' },
    ],
    courier: {
      depot: { x: -1200, z: -170, headingDeg: 90 },
      places: [
        { id: 'depot', name: 'Cullen Depot', x: -1200, z: -170, kind: 'depot' },
        { id: 'apron', name: 'Cullen Strip', x: -80, z: -148, kind: 'apron' },
        { id: 'town', name: 'Cullen', x: -1180, z: 1010, kind: 'town' },
        { id: 'quay', name: 'Cullen Quay', x: -2325, z: 590, kind: 'harbour' },
        // `tidal` is the hook the Low Tide job wants: the one node on the
        // network that a job is allowed to close.
        { id: 'causeway', name: 'The Causeway', x: 1130, z: -120, kind: 'causeway', tidal: true },
        { id: 'quarry', name: 'Sker Quarry', x: 2840, z: 240, kind: 'quarry' },
        { id: 'outpost', name: 'Sker Station', x: 2150, z: -510, kind: 'outpost' },
        { id: 'light', name: 'Gull Light', x: -2500, z: -2200, kind: 'lighthouse', boatOnly: true },
      ],
    },
    scenery: {
      coastTrees: 560, coastTreeHeight: 10,
      hillTrees: 300, hillTreeHeight: 12,
      hillCentre: [2600, 0], hillRadius: 850, hillBand: [50, 180],
      town: { cx: -1180, cz: 1010, radius: 280, count: 38, minH: 30, maxH: 80 },
      lighthouse: [-2500, -2200],
      deliveryPad: [2150, -510],
      padTrees: 160,
      boats: 4,
      harbour: { flat: 'quay', cranes: 1, containers: 12, moored: 3, sheds: 1 },
    },
    weather: { time: 'day', cond: 'clear', windSpeedKts: 12, windDirDeg: 280 },
    features: {
      reef: { islands: [0, 1], colour: 0x58d2bc, width: 0.3, bright: 0.7 },
    },
  },

  /* ==================================================================== *
   * Three places for the helicopter.
   *
   * The rule the lead set — "a harbour is not an airfield" — is right, and
   * the cheap way to honour it is to notice that a map here is PURE DATA.
   * Not one of these three adds a terrain profile, a shader, a texture or a
   * model: they are new arrangements of the five profiles that already exist,
   * and between them they weigh about 180 lines and no bytes at all.
   *
   * Every pad coordinate below was MEASURED against heightAt rather than
   * guessed, which is how the shipped maps came to have lighthouses standing
   * in forty metres of open water (San Francisco, Los Angeles and the air
   * base all still do). Anything with a number attached to it in these three
   * has been read off the height field.
   * ==================================================================== */

  /**
   * Port Kestrel.
   *
   * The same island as Kestrel — the same three land masses, the same three
   * chunks, copied unchanged — seen from the working harbour on its north-west
   * shore instead of from the airfield. The cheapest possible new map: no new
   * terrain is generated anywhere, and the difference is entirely where the
   * town, the quay and the pads are.
   *
   * The airstrip still exists, because it is the same island. That is not an
   * oversight: a rescue flight operating out of a harbour town that happens to
   * have an airstrip on the other side of the hill is truer than pretending
   * runways stopped existing the moment you climbed into a helicopter, and it
   * gives the first tutorial somewhere obvious to go wrong safely.
   *
   * THE HARBOUR IS A CUT PLATFORM, AND IT HAS TO BE. Kestrel Island has no
   * natural flat ground anywhere outside the airfield — measured, not
   * assumed: sweeping the whole island for anywhere under 3 m of fall per 10 m
   * of run, below 40 m elevation, returns the approach corridor and nothing
   * else, and every crossing of the coastline is at about 29 degrees. So the
   * quay is an `outpost` plateau, which is the existing one-line tool for
   * exactly this and costs no new terrain code at all.
   */
  {
    id: 'kestrel-port',
    game: 'heli',
    name: 'Port Kestrel',
    subtitle: 'Harbour town · the same island, the other side of the hill',
    blurb:
      'A working quay cut into the headland, a hospital on the ridge above the town and a light on '
      + 'Needle Rock eight minutes out. The airstrip is still over the hill if you want it.',
    difficulty: 1,
    difficultyLabel: 'Gentle',
    heli: true,
    seaFloor: -34,
    // Identical to Kestrel Island, deliberately and exactly. Copied rather
    // than shared so that tuning one map can never quietly change the other.
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
    /*
     * The quay. 270 m by 144 m of level ground at 15 m, cut into a shore that
     * falls at 29 degrees — so there is a real cut face behind it, which is
     * what a harbour on a coast like this looks like.
     *
     * halfLen is 135 and not less, because `buildDeliveryPad` paints a strip
     * 240 m long and it has to fit on the flat or it hangs off the edge.
     */
    outpost: { cx: -1672, cz: -1672, elev: 15, halfLen: 135, halfWidth: 72, blend: 120 },
    scenery: {
      coastTrees: 900,
      coastTreeHeight: 10,
      hillTrees: 600,
      hillTreeHeight: 13,
      hillCentre: [200, 500],
      hillRadius: 1700,
      hillBand: [60, 260],
      // A bigger town than Kestrel's: this is the place people live, and the
      // hospital pad has to look like it belongs to something.
      town: { cx: 700, cz: 620, radius: 520, count: 64, minH: 16, maxH: 200 },
      lighthouse: [-3100, -3600],
      deliveryPad: [-1672, -1672],
      padTrees: 200,
      // The fishing fleet, out in the bay off the quay.
      boats: 6,
      boatHome: [-2600, -2600],
      pads: [
        { id: 'harbour', name: 'Harbour Head Quay', x: -1672, z: -1620, kind: 'ground', r: 12 },
        { id: 'hospital', name: 'St Brendan Hospital', x: 760, z: 560, kind: 'roof', above: 30, r: 11 },
        { id: 'needle', name: 'Needle Rock Light', x: -2890, z: -3810, kind: 'stack', r: 9 },
        { id: 'field', name: 'Kestrel Airfield Pad', x: -520, z: -150, kind: 'ground', r: 11 },
      ],
    },
    weather: { time: 'day', cond: 'clear', windSpeedKts: 8, windDirDeg: 250 },
    features: { reef: { islands: [0, 1], colour: 0x49d6c0, width: 0.22 } },
  },

  /**
   * The Stacks.
   *
   * The map an aeroplane is simply the wrong machine for, and a ten-year-old
   * will work that out without being told.
   *
   * Nine sea stacks with 170 to 255 m of rock on top of them — those are
   * measured summits, not the `peak` parameter, which the ridge profile
   * overshoots by about half — and no flat land anywhere except the 420 m of
   * grass on Flat Rock at the origin. Every other landing site in the
   * archipelago is a pad on a summit.
   *
   * THE AIRSTRIP EXISTS BECAUSE THE ENGINE REQUIRES IT, and it is honest to
   * say so: `heightAt` cuts an approach corridor along the main runway on
   * every map whether anyone asked for one, `isOnRunway2` reads
   * `AIRPORT.runway2.headingDeg` without checking whether runway2 exists, and
   * the PAPI, the ATC and the landing score all assume a field. So there is a
   * field: 420 m of it, which is nobody's idea of a runway, on the only piece
   * of level rock for four kilometres. No child will ever use it and nothing
   * crashes.
   *
   * The stacks are all placed clear of the two approach corridors (|z| > 900,
   * and clear of x = 60 ± 600) because the corridor planes anything inside it
   * down to 32 m, and a sea stack sheared off flat is not a sea stack.
   */
  {
    id: 'stacks',
    game: 'heli',
    name: 'The Stacks',
    subtitle: 'Sea stacks · nowhere to land but the tops',
    blurb:
      'Nine columns of rock out of deep water, most of them two hundred metres tall, and a pad on '
      + 'each summit. Bring the machine that does not need a runway.',
    difficulty: 4,
    difficultyLabel: 'Hard',
    heli: true,
    seaFloor: -48,
    airport: {
      elev: 22,
      headingDeg: 90,
      runway: { cx: 0, cz: 0, length: 420, halfWidth: 12 },
      runway2: { cx: 70, cz: -40, length: 300, halfWidth: 10, headingDeg: 180 },
      pad: { x0: -250, x1: 250, z0: -90, z1: 80, blend: 130 },
      pad2: { x0: 30, x1: 110, z0: -200, z1: 120, blend: 110 },
    },
    islands: [
      { name: 'Flat Rock', cx: 0, cz: 0, radius: 460, peak: 30, seed: 401, profile: 'flat' },
      { name: 'Gannet Stack', cx: -3400, cz: -2600, radius: 300, peak: 150, seed: 409, profile: 'ridge' },
      { name: 'The Sisters', cx: -1900, cz: -4300, radius: 260, peak: 120, seed: 419, profile: 'ridge' },
      { name: 'Cormorant', cx: 1500, cz: -3600, radius: 340, peak: 175, seed: 421, profile: 'ridge' },
      { name: 'Black Stack', cx: 3600, cz: -2200, radius: 280, peak: 230, seed: 431, profile: 'ridge' },
      { name: 'Skua Rock', cx: 4100, cz: 1800, radius: 320, peak: 265, seed: 433, profile: 'ridge' },
      { name: 'Puffin Stack', cx: 2200, cz: 3900, radius: 300, peak: 210, seed: 439, profile: 'ridge' },
      { name: 'The Chimney', cx: -1600, cz: 3600, radius: 260, peak: 125, seed: 443, profile: 'ridge' },
      { name: 'The Anvil', cx: -4000, cz: 1500, radius: 380, peak: 215, seed: 449, profile: 'ridge' },
    ],
    /*
     * One chunk for Flat Rock and one per stack.
     *
     * Chunks are drawn, not merged — two that overlap are two coincident
     * surfaces that z-fight — so these tile without touching: the middle
     * chunk reaches 2,600 m and every stack chunk is clear of it on at least
     * one axis. The gaps between them are open sea, where the height field is
     * the sea floor and the ocean covers everything anyway.
     *
     * A 220 m stack inside one 10 km chunk would be five vertices across and
     * would read as a bump. At 1,400 m and 88 segments it is sixteen metres a
     * vertex, which is what makes it a column of rock. Total is about 91,000
     * vertices against Kestrel's 85,000 — the small chunks are cheap
     * because they are small.
     */
    chunks: [
      { cx: 0, cz: 0, size: 5200, segments: 160 },
      { cx: -3400, cz: -2600, size: 1400, segments: 88 },
      { cx: -1900, cz: -4300, size: 1400, segments: 88 },
      { cx: 1500, cz: -3600, size: 1400, segments: 88 },
      { cx: 3600, cz: -2200, size: 1400, segments: 88 },
      { cx: 4100, cz: 1800, size: 1400, segments: 88 },
      { cx: 2200, cz: 3900, size: 1400, segments: 88 },
      { cx: -1600, cz: 3600, size: 1400, segments: 88 },
      { cx: -4000, cz: 1500, size: 1600, segments: 96 },
    ],
    palette: {
      // Cold, wet rock with almost nothing growing on it.
      grass: [0.68, 0.78, 0.66],
      sand: [0.78, 0.79, 0.8],
      rock: [0.9, 0.92, 0.96],
      deepWater: 0x0d2a42,
      swell: 0x2a5c7e,
      shallow: [0.24, 0.55, 0.62],
      nightSky: 0x8ea6c4,
    },
    // The one flat apron, beside the strip on Flat Rock — NOT on a stack.
    // Quarrying a 280 m plateau out of a summit would have destroyed the one
    // thing this map is about.
    outpost: { cx: 0, cz: 300, elev: 20, halfLen: 140, halfWidth: 75, blend: 110 },
    scenery: {
      coastTrees: 60,
      coastTreeHeight: 4,
      hillTrees: 40,
      hillTreeHeight: 5,
      hillCentre: [0, 0],
      hillRadius: 520,
      hillBand: [8, 26],
      town: { cx: 120, cz: 250, radius: 260, count: 9, minH: 10, maxH: 26 },
      // A light on a sea stack, which is where lights like this actually go.
      lighthouse: [-1856, -4156],
      deliveryPad: [0, 300],
      padTrees: 20,
      boats: 3,
      /*
       * Ten pads, eight of them summits. The summit coordinates are the
       * measured high points of each stack and not the island centres — the
       * ridge profile puts the top a hundred metres or so off centre, which
       * is why they look like sea stacks rather than cones.
       */
      pads: [
        { id: 'hospital', name: 'Flat Rock Rescue', x: -60, z: 300, kind: 'ground', r: 12 },
        { id: 'gannet', name: 'Gannet Stack', x: -3502, z: -2822, kind: 'stack', r: 9 },
        { id: 'sisters', name: 'The Sisters', x: -1834, z: -4138, kind: 'stack', r: 8 },
        { id: 'cormorant', name: 'Cormorant', x: 1686, z: -3822, kind: 'stack', r: 9 },
        { id: 'black', name: 'Black Stack', x: 3432, z: -2344, kind: 'stack', r: 8 },
        { id: 'skua', name: 'Skua Rock', x: 3836, z: 1836, kind: 'stack', r: 9 },
        { id: 'puffin', name: 'Puffin Stack', x: 2410, z: 3906, kind: 'stack', r: 8 },
        { id: 'chimney', name: 'The Chimney', x: -1666, z: 3474, kind: 'stack', r: 8 },
        { id: 'anvil', name: 'The Anvil', x: -4054, z: 1674, kind: 'stack', r: 10 },
        { id: 'field', name: 'Flat Rock Strip', x: -175, z: -62, kind: 'ground', r: 11 },
      ],
    },
    weather: { time: 'day', cond: 'cloudy', windSpeedKts: 18, windDirDeg: 280 },
    features: { waterfalls: 3 },
  },

  /**
   * Ironhead Deep.
   *
   * Named after the same headland as Ironhead Air Base and nothing else is
   * shared: that one is a dry plain with three kilometres of concrete, this is
   * sixty metres of cold water with eight platforms standing in it. (If two
   * Ironheads is one too many, this is the one to rename — the id is `rigs`
   * and nothing outside this entry and the heli mission list refers to it.)
   *
   * The cheapest map in the game to build, by a distance. One shore island,
   * one skerry, two terrain chunks and about 39,000 vertices against Kestrel's
   * 85,000 — because seven of its ten landing sites are platforms over open
   * water, and a platform is four instanced legs and a disc rather than any
   * terrain at all. Night and weather cost nothing extra here and suit it, so
   * this is where the mission that needs them lives.
   */
  {
    id: 'rigs',
    game: 'heli',
    name: 'Ironhead Deep',
    subtitle: 'Open water · eight decks and one shore',
    blurb:
      'Deep cold water, a rocky head with a shore base on it, and a field of platforms out in the '
      + 'dark. Everything you can land on out here was put there on purpose.',
    difficulty: 3,
    difficultyLabel: 'Exposed',
    heli: true,
    seaFloor: -60,
    islands: [
      { name: 'Ironhead Head', cx: 0, cz: 0, radius: 1500, peak: 120, seed: 503, profile: 'hills' },
      { name: 'Sheer Skerry', cx: -3400, cz: 2400, radius: 300, peak: 150, seed: 509, profile: 'ridge' },
    ],
    chunks: [
      { cx: 0, cz: 0, size: 5200, segments: 176 },
      { cx: -3400, cz: 2400, size: 1400, segments: 88 },
    ],
    palette: {
      grass: [0.7, 0.8, 0.68],
      sand: [0.8, 0.8, 0.82],
      rock: [0.84, 0.88, 0.94],
      deepWater: 0x0b1f31,
      swell: 0x24506b,
      shallow: [0.2, 0.46, 0.55],
      nightSky: 0x7e93b2,
    },
    outpost: { cx: -900, cz: 900, elev: 26, halfLen: 140, halfWidth: 75, blend: 110 },
    scenery: {
      coastTrees: 180,
      coastTreeHeight: 6,
      hillTrees: 120,
      hillTreeHeight: 8,
      hillCentre: [-300, 900],
      hillRadius: 900,
      hillBand: [30, 150],
      town: { cx: -700, cz: 700, radius: 280, count: 20, minH: 12, maxH: 80 },
      lighthouse: [-3502, 2622],
      deliveryPad: [-900, 900],
      padTrees: 60,
      boats: 4,
      /*
       * Eight decks and two on shore. The deck heights run from 19 to 34 m
       * on purpose: a fixed height would let a child learn one radar-altimeter
       * number and stop reading the instrument, which is the opposite of what
       * this game is for.
       */
      pads: [
        { id: 'hospital', name: 'Ironhead Infirmary', x: -900, z: 1010, kind: 'roof', above: 26, r: 11 },
        { id: 'alpha', name: 'Ironhead Alpha', x: 2600, z: -1800, kind: 'deck', elev: 24, r: 12 },
        { id: 'bravo', name: 'Ironhead Bravo', x: 4200, z: 900, kind: 'deck', elev: 30, r: 11 },
        { id: 'charlie', name: 'Ironhead Charlie', x: -2200, z: -3600, kind: 'deck', elev: 21, r: 12 },
        { id: 'delta', name: 'Ironhead Delta', x: 5200, z: -3000, kind: 'deck', elev: 34, r: 11 },
        { id: 'echo', name: 'Ironhead Echo', x: 3400, z: 3600, kind: 'deck', elev: 27, r: 12 },
        { id: 'foxtrot', name: 'Ironhead Foxtrot', x: -1400, z: 4400, kind: 'deck', elev: 19, r: 11 },
        { id: 'flotel', name: 'Deep Flotel', x: -5000, z: -1200, kind: 'deck', elev: 32, r: 13 },
        { id: 'skerry', name: 'Sheer Skerry Light', x: -3502, z: 2622, kind: 'stack', r: 9 },
        { id: 'field', name: 'Ironhead Shore Base', x: -520, z: -150, kind: 'ground', r: 11 },
      ],
    },
    weather: { time: 'sunset', cond: 'cloudy', windSpeedKts: 18, windDirDeg: 240 },
  },

  /* ==================================================================== *
   * The second wave: fourteen more places.
   *
   * Every one of them arrived WITHOUT an airfield, which looks like a saving
   * and is not: heightAt falls back to Kestrel's when a map brings none, so
   * each had a fourteen-metre plateau and two approach corridors quarried
   * through its middle at the origin — invisible in the data and obvious the
   * moment you flew over it. Each now has a 450 m grass strip, sited by
   * searching its own height field for the flattest dry ground clear of
   * everything the map had already named. The worst needed 6.6 m of
   * levelling; half of them needed under two.
   *
   * They are written out as data rather than pasted as source because several
   * were computed — a reef ring worked out from a radius and a spacing, a
   * breakwater chain, a city block grid — and a map that computes itself
   * cannot be copied, only evaluated. The arithmetic ran once; these are its
   * answers.
   * ==================================================================== */

  /* airfieldperimeter — airfieldperimeter.js, 450 m strip sited on Airfield Plain, 2 m of levelling */
  {
    id: 'airfieldperimeter',
    name: 'Airfield Perimeter',
    subtitle: 'Service roads · round the working runway',
    blurb: 'Loop the fence line all the way round the airfield: past the fuel tanks, out to the far ends of the runway, and round to the cargo sheds out back. The road goes AROUND the tarmac, never across it — the only crossings are out past the grass, where the runway has already stopped.',
    difficulty: 2,
    difficultyLabel: 'Steady',
    game: 'car',
    games: ['car'],
    seaFloor: -26,
    airport: {
      elev: 51,
      headingDeg: 90,
      runway: { cx: -582, cz: 801, length: 450, halfWidth: 13 },
      pad: { x0: -917, x1: -247, z0: 671, z1: 931, blend: 200 },
    },
    islands: [
      { name: 'Airfield Plain', cx: 0, cz: 0, radius: 2200, peak: 65, seed: 701, profile: 'plains' },
    ],
    chunks: [
      { cx: 0, cz: 0, size: 6800, segments: 288 },
    ],
    flats: [
      {
        id: 'fuel',
        name: 'Fuel Farm',
        kind: 'depot',
        x0: -1500,
        x1: -1300,
        z0: -90,
        z1: 90,
        elev: 'auto',
        blend: 90,
        surface: 'gravel',
      },
      {
        id: 'cargo',
        name: 'Cargo Apron',
        kind: 'apron',
        x0: 150,
        x1: 450,
        z0: 800,
        z1: 1000,
        elev: 'auto',
        blend: 110,
        surface: 'tarmac',
      },
      {
        id: 'gate',
        name: 'Perimeter Gate',
        kind: 'depot',
        x0: 1200,
        x1: 1400,
        z0: -90,
        z1: 90,
        elev: 'auto',
        blend: 90,
        surface: 'gravel',
      },
    ],
    waters: {
      roads: [
        {
          name: 'Perimeter Loop',
          halfWidth: 20,
          blend: 50,
          path: [
            [-1400, 0, 24],
            [-1400, -320, 24],
            [-1400, -425, 25.1],
            [-1400, -531, 34.2],
            [-1400, -638, 43.8],
            [-1400, -744, 48.7],
            [-1400, -850, 48.2],
            [-1130, -850, 51.4],
            [-860, -850, 50.7],
            [-590, -850, 44.8],
            [-320, -850, 45],
            [-50, -850, 24],
            [220, -850, 24],
            [490, -850, 24],
            [760, -850, 50.2],
            [1030, -850, 50.5],
            [1300, -850, 48.3],
            [1300, -744, 46.7],
            [1300, -638, 42.7],
            [1300, -531, 34.2],
            [1300, -425, 25.4],
            [1300, -319, 24],
            [1300, 0, 24],
            [1300, 319, 24],
            [1300, 425, 25.2],
            [1300, 531, 35.5],
            [1300, 638, 49.6],
            [1300, 744, 51.7],
            [1300, 850, 49.3],
            [1030, 850, 43.3],
            [760, 850, 42.3],
            [490, 850, 24],
            [220, 850, 24],
            [-50, 850, 24],
            [-320, 850, 52.6],
            [-590, 850, 49.9],
            [-860, 850, 53.3],
            [-1130, 850, 53.1],
            [-1400, 850, 55.8],
            [-1400, 744, 56.3],
            [-1400, 638, 48.9],
            [-1400, 531, 36.1],
            [-1400, 425, 25.2],
            [-1400, 319, 24],
            [-1400, 0, 24],
          ],
        },
        {
          name: 'Cargo Spur',
          halfWidth: 16,
          blend: 45,
          path: [[300, 850, 24], [300, 900, 24], [300, 950, 24]],
        },
      ],
    },
    courier: {
      depot: { x: -1400, z: 0, headingDeg: 90 },
      places: [
        { id: 'fuel', name: 'Fuel Farm', x: -1400, z: 0, kind: 'depot' },
        { id: 'apron', name: 'Perimeter Field', x: -80, z: -148, kind: 'apron' },
        { id: 'gate', name: 'Perimeter Gate', x: 1300, z: 0, kind: 'depot' },
        { id: 'cargo', name: 'Cargo Apron', x: 300, z: 900, kind: 'apron' },
      ],
    },
    palette: {
      grass: [0.9, 0.96, 0.84],
      sand: [1, 0.98, 0.88],
      rock: [0.96, 0.95, 0.92],
      deepWater: 1327196,
      swell: 4031648,
      shallow: [0.34, 0.8, 0.72],
      nightSky: 10467544,
    },
    scenery: {
      pads: [
        { id: 'field', name: 'Perimeter Field Pad', x: -520, z: -150, kind: 'ground', r: 11 },
        { id: 'fuel', name: 'Fuel Farm', x: -1400, z: 0, kind: 'ground', r: 10 },
        { id: 'cargo', name: 'Cargo Apron', x: 300, z: 900, kind: 'ground', r: 12 },
        { id: 'gate', name: 'Perimeter Gate', x: 1300, z: 0, kind: 'ground', r: 10 },
      ],
      coastTrees: 650,
      coastTreeHeight: 10,
      hillTrees: 260,
      hillTreeHeight: 11,
      hillCentre: [-1200, 700],
      hillRadius: 900,
      hillBand: [26, 58],
      lighthouse: [-1350, -1350],
      deliveryPad: [300, 900],
      padTrees: 140,
      boats: 2,
    },
    weather: { time: 'day', cond: 'clear', windSpeedKts: 6, windDirDeg: 260 },
  },

  /* archipelago — archipelago-map.js, 450 m strip sited on Current Cay, 0.9 m of levelling */
  {
    id: 'archipelago',
    name: 'Sable Archipelago',
    subtitle: 'A dozen cays · reefs and gates',
    blurb: 'A whole necklace of little islands scattered across bright water. Some gaps between them are wide open — race straight through. Others hide a reef just under the surface, so you have to read the water and find the gate before you get there. Watch the pale patches: that is the bottom coming up to meet you.',
    difficulty: 3,
    difficultyLabel: 'Technical',
    game: 'boat',
    games: ['boat'],
    seaFloor: -26,
    airport: {
      elev: 17,
      headingDeg: 90,
      runway: { cx: 4505, cz: -3614, length: 450, halfWidth: 13 },
      pad: { x0: 4170, x1: 4840, z0: -3744, z1: -3484, blend: 200 },
    },
    islands: [
      { name: 'Gatekeeper Cay', cx: 0, cz: 0, radius: 1700, peak: 140, seed: 401, profile: 'hills' },
      { name: 'Anchor Cay', cx: 3400, cz: 1600, radius: 620, peak: 45, seed: 409, profile: 'flat' },
      { name: 'Bell Rock', cx: 5200, cz: -800, radius: 460, peak: 85, seed: 419, profile: 'ridge' },
      { name: 'Current Cay', cx: 4600, cz: -3400, radius: 520, peak: 30, seed: 421, profile: 'flat' },
      {
        name: 'Spindrift Cay',
        cx: 1800,
        cz: -4800,
        radius: 640,
        peak: 50,
        seed: 431,
        profile: 'flat',
      },
      {
        name: 'Overfall Rock',
        cx: -1200,
        cz: -5400,
        radius: 380,
        peak: 95,
        seed: 433,
        profile: 'ridge',
      },
      {
        name: 'Windward Cay',
        cx: -4000,
        cz: -4200,
        radius: 700,
        peak: 65,
        seed: 439,
        profile: 'hills',
      },
      { name: 'Lee Cay', cx: -5600, cz: -1400, radius: 580, peak: 40, seed: 443, profile: 'flat' },
      {
        name: 'Halyard Rock',
        cx: -5200,
        cz: 1800,
        radius: 420,
        peak: 100,
        seed: 449,
        profile: 'ridge',
      },
      { name: 'Compass Cay', cx: -3000, cz: 4400, radius: 660, peak: 55, seed: 457, profile: 'flat' },
      { name: 'Finish Cay', cx: 400, cz: 5200, radius: 600, peak: 70, seed: 461, profile: 'hills' },
      { name: 'Marker Rock', cx: 2600, cz: 3600, radius: 380, peak: 90, seed: 463, profile: 'ridge' },
    ],
    chunks: [
      { cx: 0, cz: 0, size: 8500, segments: 224 },
      { cx: 3400, cz: 1600, size: 3100, segments: 64 },
      { cx: 5200, cz: -800, size: 2300, segments: 48 },
      { cx: 4600, cz: -3400, size: 2600, segments: 54 },
      { cx: 1800, cz: -4800, size: 3200, segments: 66 },
      { cx: -1200, cz: -5400, size: 1900, segments: 40 },
      { cx: -4000, cz: -4200, size: 3500, segments: 72 },
      { cx: -5600, cz: -1400, size: 2900, segments: 60 },
      { cx: -5200, cz: 1800, size: 2100, segments: 44 },
      { cx: -3000, cz: 4400, size: 3300, segments: 68 },
      { cx: 400, cz: 5200, size: 3000, segments: 62 },
      { cx: 2600, cz: 3600, size: 1900, segments: 40 },
    ],
    waters: {
      harbour: { island: 0, bearingDeg: 120, length: 240, width: 180, mouthWidth: 68, depth: 5, wallW: 26, quayW: 30, blend: 150 },
      shoals: [
        { cx: 2090, cz: 984, r: 500, top: 0.9, pow: 1.8 },
        { cx: 4910, cz: -2058, r: 550, top: -0.5, pow: 2.2 },
        { cx: -2071, cz: -5026, r: 420, top: -0.3, pow: 2.5 },
        { cx: -4314, cz: -3651, r: 600, top: 1, pow: 1 },
        { cx: -4440, cz: -3431, r: 600, top: 1, pow: 1 },
        { cx: -4566, cz: -3210, r: 600, top: 1, pow: 1 },
        { cx: -4692, cz: -2990, r: 600, top: 1, pow: 1 },
        { cx: -4817, cz: -2769, r: 600, top: 1, pow: 1 },
        { cx: -4943, cz: -2549, r: 600, top: 1, pow: 1 },
        { cx: -5069, cz: -2329, r: 600, top: 1, pow: 1 },
        { cx: -5195, cz: -2108, r: 600, top: 1, pow: 1 },
        { cx: -5321, cz: -1888, r: 600, top: 1, pow: 1 },
        { cx: -1293, cz: 4802, r: 480, top: -1.5, pow: 1 },
      ],
    },
    outpost: { cx: 150, cz: 4750, elev: 34, halfLen: 130, halfWidth: 40, blend: 110 },
    palette: {
      grass: [0.98, 1.02, 0.84],
      sand: [1.15, 1.1, 0.92],
      rock: [1.05, 1, 0.92],
      deepWater: 1137286,
      swell: 3118768,
      shallow: [0.3, 0.92, 0.84],
      nightSky: 10274012,
    },
    features: {
      reef: { islands: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], colour: 3727554, width: 0.42, bright: 0.75 },
    },
    scenery: {
      coastTrees: 640,
      coastTreeHeight: 10,
      hillTrees: 260,
      hillTreeHeight: 12,
      hillCentre: [0, 300],
      hillRadius: 1100,
      hillBand: [20, 130],
      town: { cx: -350, cz: -250, radius: 300, count: 20, minH: 8, maxH: 90 },
      lighthouse: [5200, -800],
      deliveryPad: [150, 4750],
      padTrees: 60,
      boats: 8,
    },
    weather: { time: 'day', cond: 'clear', windSpeedKts: 13, windDirDeg: 140 },
  },

  /* town — car-map-2-town.js, 450 m strip sited on Fenwick Island, 1.4 m of levelling */
  {
    id: 'town',
    name: 'Fenwick',
    subtitle: 'Town · streets, a square and a ring road',
    blurb: 'A real town: a grid of streets, a square in the middle and a ring road all the way round it. Every corner is a choice — the short way through the middle, or the long way round on the ring. Deliveries are waiting all over town.',
    difficulty: 1,
    difficultyLabel: 'Gentle',
    game: 'car',
    games: ['car'],
    seaFloor: -24,
    airport: {
      elev: 35,
      headingDeg: 90,
      runway: { cx: 0, cz: 1838, length: 450, halfWidth: 13 },
      pad: { x0: -335, x1: 335, z0: 1708, z1: 1968, blend: 200 },
    },
    islands: [
      {
        name: 'Fenwick Island',
        cx: 0,
        cz: 700,
        radius: 1750,
        peak: 35,
        seed: 401,
        profile: 'plains',
      },
      {
        name: 'Overlook Ridge',
        cx: 3200,
        cz: -2200,
        radius: 550,
        peak: 180,
        seed: 419,
        profile: 'hills',
      },
    ],
    chunks: [
      { cx: 0, cz: 700, size: 5100, segments: 256 },
      { cx: 3200, cz: -2200, size: 1800, segments: 64 },
    ],
    waters: {
      roads: [
        {
          halfWidth: 9,
          blend: 22,
          path: [
            [0, -230, 14],
            [0, 150, 14],
            [0, 200, 14.16],
            [0, 250, 18.78],
            [0, 300, 24],
            [0, 500, 24],
            [0, 750, 24],
            [0, 1000, 24],
            [0, 1250, 24],
            [0, 1500, 24],
            [0, 1600, 24],
          ],
        },
        {
          halfWidth: 8,
          blend: 22,
          path: [
            [-400, 500, 27.61],
            [-400, 600, 32.87],
            [-400, 700, 36.51],
            [-400, 750, 35.71],
            [-400, 800, 34.58],
            [-400, 900, 32.63],
            [-400, 1000, 31.6],
            [-400, 1100, 31.67],
            [-400, 1200, 31.5],
            [-400, 1250, 32.81],
            [-400, 1300, 34.64],
            [-400, 1400, 35.53],
            [-400, 1500, 36.93],
          ],
        },
        {
          halfWidth: 8,
          blend: 22,
          path: [[400, 500, 24], [400, 700, 24], [400, 900, 24], [400, 1100, 24], [400, 1300, 24], [400, 1500, 24]],
        },
        {
          halfWidth: 11,
          blend: 26,
          path: [
            [-600, 500, 29.19],
            [-500, 500, 28.28],
            [-400, 500, 27.61],
            [-300, 500, 27.6],
            [-200, 500, 26.38],
            [-100, 500, 24.43],
            [0, 500, 24],
            [100, 500, 24],
            [200, 500, 20.51],
            [300, 500, 20.42],
            [400, 500, 24],
            [500, 500, 24],
            [600, 500, 24.46],
          ],
        },
        {
          halfWidth: 11,
          blend: 26,
          path: [
            [600, 500, 24.46],
            [600, 600, 25.02],
            [600, 700, 25.14],
            [600, 750, 25.11],
            [600, 800, 25.07],
            [600, 900, 24.99],
            [600, 1000, 25.27],
            [600, 1100, 25.28],
            [600, 1200, 25.24],
            [600, 1250, 25.14],
            [600, 1300, 25.07],
            [600, 1400, 25.33],
            [600, 1500, 25.39],
          ],
        },
        {
          halfWidth: 11,
          blend: 26,
          path: [
            [600, 1500, 25.39],
            [500, 1500, 24],
            [400, 1500, 24],
            [300, 1500, 24],
            [200, 1500, 24],
            [100, 1500, 24],
            [0, 1500, 24],
            [-100, 1500, 24.98],
            [-200, 1500, 31.11],
            [-300, 1500, 34.5],
            [-400, 1500, 36.93],
            [-500, 1500, 37.38],
            [-600, 1500, 37.3],
          ],
        },
        {
          halfWidth: 11,
          blend: 26,
          path: [
            [-600, 1500, 37.3],
            [-600, 1400, 38.1],
            [-600, 1300, 38.15],
            [-600, 1250, 36.33],
            [-600, 1200, 36.01],
            [-600, 1100, 35.88],
            [-600, 1000, 35.53],
            [-600, 900, 37.15],
            [-600, 800, 36.53],
            [-600, 750, 36.43],
            [-600, 700, 37],
            [-600, 600, 35.03],
            [-600, 500, 29.19],
          ],
        },
        {
          halfWidth: 8,
          blend: 22,
          path: [
            [-600, 750, 36.43],
            [-500, 750, 34.28],
            [-400, 750, 35.71],
            [-300, 750, 34.73],
            [-200, 750, 30.76],
            [-100, 750, 25.01],
            [0, 750, 24],
            [100, 750, 24],
            [200, 750, 24],
            [300, 750, 24],
            [400, 750, 24],
            [500, 750, 24],
            [600, 750, 25.11],
          ],
        },
        {
          halfWidth: 8,
          blend: 22,
          path: [
            [-600, 1000, 35.53],
            [-500, 1000, 33.41],
            [-400, 1000, 31.6],
            [-300, 1000, 33.9],
            [-200, 1000, 29.74],
            [-100, 1000, 24.97],
            [0, 1000, 24],
            [100, 1000, 24],
            [200, 1000, 24],
            [300, 1000, 24],
            [400, 1000, 24],
            [500, 1000, 24],
            [600, 1000, 25.27],
          ],
        },
        {
          halfWidth: 8,
          blend: 22,
          path: [
            [-600, 1250, 36.33],
            [-500, 1250, 35.76],
            [-400, 1250, 32.81],
            [-300, 1250, 32.39],
            [-200, 1250, 29.6],
            [-100, 1250, 24.93],
            [0, 1250, 24],
            [100, 1250, 24],
            [200, 1250, 24],
            [300, 1250, 24],
            [400, 1250, 24],
            [500, 1250, 24],
            [600, 1250, 25.14],
          ],
        },
        { halfWidth: 50, blend: 70, path: [[-30, 1000, 24], [30, 1000, 24]] },
      ],
    },
    palette: {
      grass: [1.02, 1, 0.82],
      sand: [1.06, 1, 0.86],
      rock: [0.96, 0.92, 0.86],
      deepWater: 1459806,
      swell: 3966624,
      shallow: [0.34, 0.8, 0.74],
      nightSky: 10466516,
    },
    scenery: {
      coastTrees: 500,
      coastTreeHeight: 10,
      hillTrees: 260,
      hillTreeHeight: 14,
      hillCentre: [3200, -2200],
      hillRadius: 700,
      hillBand: [40, 170],
      town: { cx: 0, cz: 1000, radius: 820, count: 260, minH: 8, maxH: 42 },
      lighthouse: [-1700, 700],
      deliveryPad: [0, 500],
      padTrees: 40,
      boats: 0,
    },
    weather: { time: 'day', cond: 'clear', windSpeedKts: 4, windDirDeg: 200 },
  },

  /* carriergroup — carriergroup.map.js, 450 m strip sited on Task Force Base, 4 m of levelling */
  {
    id: 'carriergroup',
    name: 'Task Force Resolute',
    subtitle: 'Carrier group · deck to deck, out at sea',
    blurb: 'One big aircraft carrier and four small escort ships, alone on open water. Every deck out here is tiny next to the carrier — come in slow, line up early, and do not rush the last few metres.',
    difficulty: 4,
    difficultyLabel: 'Hard',
    game: 'heli',
    games: ['heli'],
    seaFloor: -55,
    airport: {
      elev: 71,
      headingDeg: 90,
      runway: { cx: 203, cz: -954, length: 450, halfWidth: 13 },
      pad: { x0: -132, x1: 538, z0: -1084, z1: -824, blend: 200 },
    },
    islands: [
      { name: 'Task Force Base', cx: 0, cz: 0, radius: 1500, peak: 115, seed: 719, profile: 'hills' },
    ],
    chunks: [
      { cx: 0, cz: 0, size: 5200, segments: 176 },
    ],
    outpost: { cx: -900, cz: 900, elev: 'auto', minElev: 15, halfLen: 140, halfWidth: 75, blend: 110 },
    palette: {
      grass: [0.74, 0.8, 0.72],
      sand: [0.8, 0.8, 0.82],
      rock: [0.86, 0.9, 0.95],
      deepWater: 729138,
      swell: 2312287,
      shallow: [0.2, 0.46, 0.55],
      nightSky: 8360884,
    },
    scenery: {
      coastTrees: 160,
      coastTreeHeight: 6,
      hillTrees: 100,
      hillTreeHeight: 8,
      hillCentre: [-700, 700],
      hillRadius: 900,
      hillBand: [30, 110],
      town: { cx: -1000, cz: 550, radius: 240, count: 14, minH: 12, maxH: 60 },
      lighthouse: [-675, 1169],
      deliveryPad: [-900, 900],
      padTrees: 40,
      boats: 2,
      pads: [
        { id: 'field', name: 'Task Force Shore Base', x: -520, z: -150, kind: 'ground', r: 11 },
        {
          id: 'hospital',
          name: 'Fleet Hospital Ship',
          x: 5850,
          z: -5800,
          kind: 'deck',
          elev: 10,
          r: 12,
        },
        { id: 'escortN', name: 'Escort Picket North', x: 5600, z: -3250, kind: 'deck', elev: 9, r: 11 },
        {
          id: 'escortS',
          name: 'Escort Picket South',
          x: 5600,
          z: -5200,
          kind: 'deck',
          elev: 12,
          r: 11,
        },
        { id: 'escortE', name: 'Escort Screen East', x: 6550, z: -4350, kind: 'deck', elev: 8, r: 11 },
        { id: 'escortW', name: 'Escort Screen West', x: 4700, z: -4050, kind: 'deck', elev: 14, r: 11 },
      ],
    },
    weather: { time: 'day', cond: 'cloudy', windSpeedKts: 14, windDirDeg: 260 },
    heli: true,
    carrier: { x: 5600, z: -4200 },
  },

  /* coastroad — coastroad.js, 450 m strip sited on Cormorant Isle, 2.7 m of levelling */
  {
    id: 'coastroad',
    name: 'Cormorant Coast',
    subtitle: 'Coastal · one long shoreline road',
    blurb: 'Drive the road that hugs the edge of the island. The sea is right there on one side, a green bank rises on the other, and the road bends every few hundred metres — so ease off before every corner.',
    difficulty: 2,
    difficultyLabel: 'Winding',
    game: 'car',
    games: ['car'],
    seaFloor: -30,
    airport: {
      elev: 73,
      headingDeg: 90,
      runway: { cx: -899, cz: 292, length: 450, halfWidth: 13 },
      pad: { x0: -1234, x1: -564, z0: 162, z1: 422, blend: 200 },
    },
    islands: [
      { name: 'Cormorant Isle', cx: 0, cz: 0, radius: 2700, peak: 115, seed: 601, profile: 'plains' },
      { name: 'Skiff Rock', cx: 0, cz: 3100, radius: 300, peak: 45, seed: 700, profile: 'ridge' },
    ],
    chunks: [
      { cx: 0, cz: 0, size: 8200, segments: 356 },
      { cx: 0, cz: 3100, size: 1400, segments: 64 },
    ],
    waters: {
      roads: [
        {
          halfWidth: 15,
          blend: 45,
          path: [
            [2631, 559, 11.2],
            [2312, 1335, 9.8],
            [1586, 1761, 9.6],
            [915, 2055, 9.2],
            [261, 2486, 10.3],
            [-514, 2416, 11.5],
            [-1280, 2217, 9.4],
            [-1761, 1586, 10.6],
            [-2202, 980, 9.7],
            [-2250, 478, 9.3],
          ],
        },
      ],
    },
    outpost: { cx: 60, cz: 2760, elev: 11, halfLen: 130, halfWidth: 40, blend: 110 },
    palette: {
      grass: [0.92, 1.02, 0.86],
      sand: [1.02, 0.98, 0.86],
      rock: [0.96, 0.92, 0.86],
      deepWater: 1264232,
      swell: 3838120,
      shallow: [0.3, 0.86, 0.8],
      nightSky: 10336468,
    },
    features: { reef: { islands: [0], colour: 5230784, width: 0.18 } },
    scenery: {
      coastTrees: 650,
      coastTreeHeight: 10,
      hillTrees: 320,
      hillTreeHeight: 12,
      hillCentre: [-300, 1200],
      hillRadius: 1900,
      hillBand: [20, 100],
      town: { cx: 2400, cz: 900, radius: 320, count: 30, minH: 10, maxH: 40 },
      lighthouse: [0, 3100],
      deliveryPad: [60, 2760],
      padTrees: 90,
      boats: 3,
    },
    weather: { time: 'day', cond: 'clear', windSpeedKts: 9, windDirDeg: 300 },
  },

  /* delta — delta-map.js, 450 m strip sited on Crane Spit, 0.6 m of levelling */
  {
    id: 'delta',
    name: 'Brackwater Delta',
    subtitle: 'River delta · braided channels, shifting bar',
    blurb: 'The river falls apart into a hundred little channels before it reaches the sea. Almost all of it is too shallow to float a boot in — but one channel stays deep enough for you, all the way out past the shifting bar at the mouth. Watch your depth gauge, not just the water.',
    difficulty: 3,
    difficultyLabel: 'Shoal-y',
    game: 'boat',
    games: ['boat'],
    seaFloor: -18,
    airport: {
      elev: 13,
      headingDeg: 90,
      runway: { cx: 1714, cz: -2526, length: 450, halfWidth: 13 },
      pad: { x0: 1379, x1: 2049, z0: -2656, z1: -2396, blend: 200 },
    },
    islands: [
      { name: 'West Bank', cx: -1500, cz: 100, radius: 950, peak: 30, seed: 501, profile: 'flat' },
      { name: 'East Bank', cx: 1500, cz: 100, radius: 950, peak: 28, seed: 503, profile: 'flat' },
      { name: 'Gull Bar', cx: -1550, cz: -1700, radius: 600, peak: 10, seed: 509, profile: 'flat' },
      { name: 'Crane Spit', cx: 1550, cz: -2300, radius: 620, peak: 9, seed: 521, profile: 'flat' },
      { name: 'Reed Flat', cx: -1600, cz: -2900, radius: 650, peak: 11, seed: 523, profile: 'flat' },
      { name: 'Sable Bar', cx: 1600, cz: -3500, radius: 600, peak: 9, seed: 541, profile: 'flat' },
      { name: 'Osprey Flat', cx: -1550, cz: -4100, radius: 580, peak: 8, seed: 547, profile: 'flat' },
      { name: 'Willet Bar', cx: 1550, cz: -4700, radius: 600, peak: 9, seed: 553, profile: 'flat' },
      { name: 'Marsh Spit', cx: -1500, cz: -5300, radius: 560, peak: 7, seed: 559, profile: 'flat' },
      { name: 'Tern Island', cx: 1500, cz: -5700, radius: 650, peak: 26, seed: 557, profile: 'flat' },
    ],
    chunks: [
      { cx: 0, cz: -2900, size: 14000, segments: 256 },
    ],
    waters: {
      harbour: { island: 1, bearingDeg: 90, length: 240, width: 180, mouthWidth: 66, depth: 5, wallW: 26, quayW: 30, blend: 150, shelfTop: -4 },
      shoals: [
        { cx: -950, cz: -1400, r: 560, top: -1.8 },
        { cx: 900, cz: -1600, r: 540, top: -1.9 },
        { cx: -900, cz: -2000, r: 560, top: -1.6, pow: 1.5 },
        { cx: 950, cz: -2600, r: 580, top: -1.7 },
        { cx: -950, cz: -2600, r: 560, top: -1.9, pow: 1.5 },
        { cx: 900, cz: -3200, r: 560, top: -1.6 },
        { cx: -950, cz: -3300, r: 580, top: -1.8, pow: 1.5 },
        { cx: 950, cz: -3900, r: 560, top: -2 },
        { cx: -900, cz: -3900, r: 560, top: -1.7, pow: 1.5 },
        { cx: 900, cz: -4500, r: 580, top: -1.8 },
        { cx: -950, cz: -4500, r: 560, top: -2, pow: 1.5 },
        { cx: 900, cz: -5100, r: 560, top: -1.7 },
        { cx: -900, cz: -5100, r: 540, top: -1.9, pow: 1.5 },
        { cx: -500, cz: -6050, r: 600, top: -0.5, pow: 2.4 },
        { cx: 950, cz: -6100, r: 580, top: -0.4, pow: 2.4 },
        { cx: 300, cz: -6700, r: 750, top: -2.6 },
      ],
    },
    outpost: { cx: 1500, cz: -5700, elev: 26, halfLen: 210, halfWidth: 55, blend: 150 },
    palette: {
      grass: [0.98, 1.02, 0.86],
      sand: [1.1, 1.04, 0.86],
      rock: [1, 0.98, 0.92],
      deepWater: 1722972,
      swell: 4029830,
      shallow: [0.42, 0.78, 0.62],
      nightSky: 10465476,
    },
    features: { reef: { islands: [2, 3, 4, 5, 6, 7, 8], colour: 7055496, width: 0.3, bright: 0.55 } },
    scenery: {
      coastTrees: 480,
      coastTreeHeight: 7,
      hillTrees: 140,
      hillTreeHeight: 8,
      hillCentre: [-1500, 100],
      hillRadius: 950,
      hillBand: [10, 30],
      town: { cx: -1500, cz: 300, radius: 360, count: 24, minH: 10, maxH: 30 },
      lighthouse: [950, -6100],
      deliveryPad: [1500, -5700],
      padTrees: 90,
      boats: 5,
    },
    weather: { time: 'day', cond: 'cloudy', windSpeedKts: 8, windDirDeg: 190 },
  },

  /* desertrun — desertrun.map.js */
  {
    id: 'desertrun',
    name: 'Redrock Flats',
    subtitle: 'Desert · long straight roads, distant mesas',
    blurb: 'Hard red sand, a huge open sky and mesas standing far off in every direction. One straight road runs clear across the flats — the longest delivery in the game — so open it up and keep an eye on the fuel, because there is nowhere out here to hide from an empty tank.',
    difficulty: 2,
    difficultyLabel: 'Long Haul',
    game: 'car',
    games: ['car'],
    seaFloor: -18,
    airport: {
      elev: 22,
      headingDeg: 90,
      runway: { cx: 0, cz: 0, length: 1000, halfWidth: 17 },
      runway2: { cx: 250, cz: -70, length: 760, halfWidth: 14, headingDeg: 180 },
      pad: { x0: -620, x1: 620, z0: -230, z1: 190, blend: 180 },
      pad2: { x0: 170, x1: 330, z0: -500, z1: 400, blend: 160 },
    },
    islands: [
      { name: 'Redrock Flats', cx: 0, cz: 0, radius: 5800, peak: 14, seed: 701, profile: 'plains' },
      {
        name: 'Vermilion Mesa',
        cx: -6800,
        cz: 6100,
        radius: 800,
        peak: 250,
        seed: 703,
        profile: 'ridge',
      },
      {
        name: 'Redwall Mesa',
        cx: 7600,
        cz: -5400,
        radius: 850,
        peak: 280,
        seed: 709,
        profile: 'ridge',
      },
    ],
    chunks: [
      { cx: 0, cz: 0, size: 15000, segments: 256 },
      { cx: -6800, cz: 6100, size: 2400, segments: 72 },
      { cx: 7600, cz: -5400, size: 2600, segments: 78 },
    ],
    flats: [
      {
        id: 'depot',
        name: 'Redrock Depot',
        kind: 'depot',
        x0: -4450,
        x1: -4250,
        z0: -1000,
        z1: -800,
        elev: 'auto',
        blend: 100,
        surface: 'tarmac',
      },
      {
        id: 'oasis',
        name: 'Mirage Oasis',
        kind: 'village',
        x0: -1850,
        x1: -1650,
        z0: -1000,
        z1: -800,
        elev: 'auto',
        blend: 110,
        surface: 'grass',
      },
      {
        id: 'relay',
        name: 'Halfway Pumps',
        kind: 'relay',
        x0: 1650,
        x1: 1850,
        z0: -1000,
        z1: -800,
        elev: 'auto',
        blend: 100,
        surface: 'gravel',
      },
      {
        id: 'town',
        name: 'Sundown',
        kind: 'town',
        x0: 4150,
        x1: 4350,
        z0: -1000,
        z1: -800,
        elev: 'auto',
        blend: 120,
        surface: 'grass',
      },
    ],
    waters: {
      roads: [
        {
          halfWidth: 26,
          blend: 60,
          path: [
            [-4550, -900, 22.1],
            [-3850, -900, 29.1],
            [-3150, -900, 28.8],
            [-2450, -900, 32.1],
            [-1750, -900, 27.8],
            [-1050, -900, 29.8],
            [-350, -900, 28.1],
            [350, -900, 28],
            [1050, -900, 30.6],
            [1750, -900, 27.1],
            [2450, -900, 32.3],
            [3150, -900, 32.1],
            [3850, -900, 29.4],
            [4550, -900, 23.6],
          ],
        },
        { halfWidth: 20, blend: 50, path: [[0, -900, 30.1], [0, -600, 29.9], [0, -300, 25.1]] },
      ],
    },
    courier: {
      depot: { x: -4350, z: -900, headingDeg: 90 },
      places: [
        { id: 'depot', name: 'Redrock Depot', x: -4350, z: -900, kind: 'depot' },
        { id: 'apron', name: 'Redrock Airfield', x: -80, z: -148, kind: 'apron' },
        { id: 'oasis', name: 'Mirage Oasis', x: -1750, z: -900, kind: 'village' },
        { id: 'relay', name: 'Halfway Pumps', x: 1750, z: -900, kind: 'relay' },
        { id: 'town', name: 'Sundown', x: 4250, z: -900, kind: 'town' },
      ],
    },
    palette: {
      grass: [2.3, 1.3, 0.55],
      sand: [1.35, 1, 0.62],
      rock: [1.5, 0.7, 0.42],
      deepWater: 1591900,
      swell: 4161418,
      shallow: [0.4, 0.72, 0.62],
      nightSky: 12095608,
    },
    scenery: {
      coastTrees: 90,
      coastTreeHeight: 6,
      hillTrees: 40,
      hillTreeHeight: 8,
      hillCentre: [-6800, 6100],
      hillRadius: 650,
      hillBand: [60, 260],
      town: { cx: 4250, cz: -900, radius: 240, count: 16, minH: 10, maxH: 34 },
      boats: 0,
    },
    weather: { time: 'day', cond: 'clear', windSpeedKts: 10, windDirDeg: 200 },
  },

  /* firewatch — firewatch.map.js */
  {
    id: 'firewatch',
    name: 'Firewatch Ridge',
    subtitle: 'Forest fire · a ridge, a bay, and a line to hold',
    blurb: 'A wildfire is burning along the ridge above the bay. Fly out over the water, dip your bucket, and drop it on the line the crews are holding before the fire gets down to the trees near the base. Short hops, fast turns — that is the whole job.',
    difficulty: 3,
    difficultyLabel: 'Exposed',
    game: 'heli',
    games: ['heli'],
    seaFloor: -40,
    airport: {
      elev: 14,
      headingDeg: 90,
      runway: { cx: 0, cz: 0, length: 700, halfWidth: 14 },
      runway2: { cx: 150, cz: -80, length: 460, halfWidth: 11, headingDeg: 180 },
      pad: { x0: -400, x1: 400, z0: -190, z1: 150, blend: 140 },
      pad2: { x0: 60, x1: 240, z0: -330, z1: 150, blend: 120 },
    },
    corridor: { halfWidth: 170, blend: 140, fadeFrom: 350, length: 850 },
    corridor2: { halfWidth: 140, blend: 110, fadeFrom: 250, length: 650 },
    islands: [
      { name: 'Ashwood Shelf', cx: 0, cz: 0, radius: 1700, peak: 150, seed: 701, profile: 'hills' },
      {
        name: 'Long Scarp',
        cx: 1900,
        cz: -3400,
        radius: 2600,
        peak: 560,
        seed: 709,
        profile: 'ridge',
      },
      {
        name: 'Cinder Scarp',
        cx: -1600,
        cz: 3000,
        radius: 2100,
        peak: 420,
        seed: 719,
        profile: 'ridge',
      },
      { name: 'Ember Knob', cx: -4300, cz: 200, radius: 320, peak: 170, seed: 727, profile: 'ridge' },
    ],
    chunks: [
      { cx: 450, cz: -550, size: 14000, segments: 256 },
    ],
    outpost: { cx: -1050, cz: -100, elev: 'auto', halfLen: 140, halfWidth: 75, blend: 120 },
    palette: {
      grass: [1.04, 1, 0.72],
      sand: [1, 0.95, 0.8],
      rock: [0.92, 0.88, 0.82],
      deepWater: 1194590,
      swell: 3832744,
      shallow: [0.3, 0.8, 0.76],
      nightSky: 9677510,
    },
    scenery: {
      coastTrees: 620,
      coastTreeHeight: 12,
      hillTrees: 850,
      hillTreeHeight: 17,
      hillCentre: [1200, -1900],
      hillRadius: 2200,
      hillBand: [40, 480],
      town: { cx: -1050, cz: -100, radius: 170, count: 10, minH: 8, maxH: 22 },
      lighthouse: [-4300, 200],
      deliveryPad: [-1050, -100],
      padTrees: 70,
      boats: 0,
      pads: [
        { id: 'field', name: 'Firewatch Strip', x: -150, z: 60, kind: 'ground', r: 11 },
        { id: 'base', name: 'Firewatch Base', x: -1050, z: -100, kind: 'ground', r: 12 },
        { id: 'attack', name: 'Line One Attack Point', x: 679, z: -1343, kind: 'stack', r: 9 },
        { id: 'lookout', name: 'Ember Knob Lookout', x: -4440, z: 260, kind: 'stack', r: 9 },
      ],
    },
    weather: { time: 'day', cond: 'cloudy', windSpeedKts: 16, windDirDeg: 250 },
    heli: true,
    fire: {
      waterSource: {
        name: 'The Bay',
        note: 'Open sea, not a lake or reservoir — terrain.js has no inland-water primitive (see WHAT I COULD NOT DO #1).',
        shoreEdge: 'x -1450..-1475, z in [-200,250] (measured last-land/first-sea)',
        shallowFringeM: { x0: -1550, x1: -1500, depthMin: 14.8, depthMax: 31.1 },
        dip: { x: -1650, z: 0, depthM: 40 },
        dipAlt: { x: -1900, z: -50, depthM: 40 },
      },
      line: {
        note: 'Real heightAt() points, not a designed contour — see the header measurements.',
        path: [
          { x: 1357, z: -2486, h: 627.8 },
          { x: 1086, z: -2029, h: 382.8 },
          { x: 679, z: -1343, h: 259 },
          { x: 407, z: -886, h: 74.9 },
          { x: 0, z: -200, h: 15.6 },
        ],
        lengthM: 2658,
      },
      base: { x: -1050, z: -100, h: 168.5 },
    },
  },

  /* harbour — harbour-map.js, 450 m strip sited on Spindrift Reef, 1.6 m of levelling */
  {
    id: 'harbour',
    name: 'Cutter Bay',
    subtitle: 'Working harbour · breakwater and a marked channel',
    blurb: 'A busy little harbour behind a long stone breakwater. Follow the buoys round its tip — cut the corner and you will find the rocks the hard way — then it is calm water all the way to the fuel jetty. Moorings, a fishing fleet and a lighthouse watch the gap.',
    difficulty: 1,
    difficultyLabel: 'Gentle',
    game: 'boat',
    games: ['boat'],
    seaFloor: -20,
    airport: {
      elev: 23,
      headingDeg: 90,
      runway: { cx: 2256, cz: 3402, length: 450, halfWidth: 13 },
      pad: { x0: 1921, x1: 2591, z0: 3272, z1: 3532, blend: 200 },
    },
    islands: [
      { name: 'Gannet Head', cx: 0, cz: 0, radius: 2450, peak: 160, seed: 501, profile: 'hills' },
      {
        name: 'Spindrift Reef',
        cx: 2400,
        cz: 3600,
        radius: 700,
        peak: 60,
        seed: 617,
        profile: 'flat',
      },
    ],
    chunks: [
      { cx: 0, cz: 0, size: 10000, segments: 256 },
      { cx: 2000, cz: 2700, size: 3000, segments: 120 },
    ],
    waters: {
      harbour: { island: 0, bearingDeg: 60, length: 260, width: 200, mouthWidth: 72, depth: 6, wallW: 28, quayW: 34, blend: 160 },
      shoals: [
        { cx: 2316, cz: 2850, r: 100, top: 2.5 },
        { cx: 2201, cz: 2755, r: 100, top: 2.5 },
        { cx: 2085, cz: 2659, r: 100, top: 2.5 },
        { cx: 1970, cz: 2563, r: 100, top: 2.5 },
        { cx: 1854, cz: 2468, r: 100, top: 2.5 },
        { cx: 1739, cz: 2372, r: 100, top: 2.5 },
        { cx: 1623, cz: 2276, r: 100, top: 1.6 },
        { cx: 5200, cz: 4200, r: 500, top: -2.5 },
      ],
    },
    outpost: { cx: 2400, cz: 3450, elev: 22.5, halfLen: 200, halfWidth: 55, blend: 150 },
    palette: {
      grass: [0.9, 0.98, 0.85],
      sand: [1.05, 0.98, 0.85],
      rock: [0.95, 0.93, 0.9],
      deepWater: 1327196,
      swell: 3110544,
      shallow: [0.3, 0.7, 0.66],
      nightSky: 9677512,
    },
    features: { reef: { islands: [0, 1], colour: 5753264, width: 0.3 } },
    scenery: {
      coastTrees: 500,
      coastTreeHeight: 10,
      hillTrees: 350,
      hillTreeHeight: 12,
      hillCentre: [-600, -600],
      hillRadius: 1700,
      hillBand: [50, 240],
      town: { cx: 1150, cz: 1800, radius: 380, count: 42, minH: 16, maxH: 100 },
      lighthouse: [2400, 3950],
      deliveryPad: [2400, 3450],
      padTrees: 90,
      boats: 6,
      harbour: {
        channel: [[3800, 5200], [3400, 3300], [2400, 2920], [1500, 2200], [1350, 2050], [1288, 2143]],
        breakwater: {
          name: 'Cutter\'s Breakwater',
          links: [[2316, 2850], [2201, 2755], [2085, 2659], [1970, 2563], [1854, 2468], [1739, 2372], [1623, 2276]],
        },
        moorings: [[1481, 2039], [1346, 2154], [1174, 2207], [1001, 2247], [1613, 2065], [1325, 2295], [1594, 1900]],
        fishingFleet: { boats: [[1320, 1957], [1190, 2061], [1043, 2139], [1453, 1860]] },
        fuelJetty: { baseX: 1264, baseZ: 1874, tipX: 1314, tipZ: 1948, width: 14 },
      },
    },
    weather: { time: 'day', cond: 'clear', windSpeedKts: 8, windDirDeg: 210 },
  },

  /* ravencrag — heli-map-rescue.js, 450 m strip sited on Sentinel Knoll, 1.9 m of levelling */
  {
    id: 'ravencrag',
    name: 'Raven Crag',
    subtitle: 'Mountain rescue · a valley, a wall, and thin air at the top',
    blurb: 'A green valley squeezed between two grey mountains. The rescue base sits safe on the valley floor, a tiny ledge waits high on the eastern wall for the jobs nobody else will take, and somewhere up in the rocks near the top a climber has gone through the snow into a crack in the ice. The wind gets much worse the higher you go — believe the gauge, not the view.',
    difficulty: 5,
    difficultyLabel: 'Expert',
    game: 'heli',
    games: ['heli'],
    seaFloor: -30,
    airport: {
      elev: 42,
      headingDeg: 90,
      runway: { cx: -51, cz: -240, length: 450, halfWidth: 13 },
      pad: { x0: -386, x1: 284, z0: -370, z1: -110, blend: 200 },
    },
    corridor2: { halfWidth: 300, blend: 260, fadeFrom: 1200, length: 2200 },
    islands: [
      { name: 'Sentinel Knoll', cx: 0, cz: 0, radius: 700, peak: 45, seed: 701, profile: 'plains' },
      {
        name: 'Corrie Floor',
        cx: 0,
        cz: -5200,
        radius: 1300,
        peak: 90,
        seed: 601,
        profile: 'plains',
      },
      {
        name: 'Scarp West',
        cx: -1900,
        cz: -5200,
        radius: 1700,
        peak: 850,
        seed: 611,
        profile: 'ridge',
      },
      {
        name: 'Scarp East',
        cx: 1900,
        cz: -5200,
        radius: 1700,
        peak: 900,
        seed: 617,
        profile: 'ridge',
      },
    ],
    chunks: [
      { cx: 0, cz: 0, size: 2200, segments: 64 },
      { cx: 0, cz: -5200, size: 9200, segments: 288 },
    ],
    outpost: { cx: 0, cz: -5380, elev: 'auto', halfLen: 140, halfWidth: 130, blend: 90 },
    palette: {
      grass: [0.82, 0.92, 0.8],
      sand: [0.86, 0.86, 0.84],
      rock: [0.88, 0.9, 0.94],
      deepWater: 994370,
      swell: 2907256,
      shallow: [0.26, 0.58, 0.62],
      nightSky: 9348804,
      snow: [700, 1000],
    },
    features: { waterfalls: 4 },
    scenery: {
      coastTrees: 260,
      coastTreeHeight: 8,
      hillTrees: 420,
      hillTreeHeight: 14,
      hillCentre: [0, -5380],
      hillRadius: 2200,
      hillBand: [50, 550],
      town: { cx: 0, cz: -5600, radius: 220, count: 14, minH: 58, maxH: 75 },
      lighthouse: [900, 0],
      deliveryPad: [0, -5380],
      padTrees: 70,
      boats: 0,
      pads: [
        { id: 'hospital', name: 'Corrie Rescue Station', x: 0, z: -5380, kind: 'ground', r: 12 },
        { id: 'field', name: 'Sentinel Strip', x: -520, z: -150, kind: 'ground', r: 11 },
        { id: 'ridge', name: 'Anvil Shelf', x: 1070, z: -4580, kind: 'ground', r: 9 },
      ],
    },
    weather: { time: 'day', cond: 'cloudy', windSpeedKts: 24, windDirDeg: 255 },
    heli: true,
    hoverSites: [
      {
        id: 'crevasse',
        name: 'The Crevasse',
        x: 1980,
        z: -5520,
        note: 'natural col, 505 m, no touchdown',
      },
    ],
  },

  /* lagoon — lagoon-map.js, 450 m strip sited on Pass Motu, 0.7 m of levelling */
  {
    id: 'lagoon',
    name: 'Coral Lagoon',
    subtitle: 'Reef ring · calm water, two gaps to the sea',
    blurb: 'A ring of coral wraps all the way round a bright, glassy lagoon. One pass is marked with buoys; the other is yours to find. Miss either one and the coral heads will stop your boat cold. The friendliest map in the game, and the prettiest.',
    difficulty: 1,
    difficultyLabel: 'Calm',
    game: 'boat',
    games: ['boat'],
    seaFloor: -26,
    chartReach: 3800,
    airport: {
      elev: 16,
      headingDeg: 90,
      runway: { cx: 2590, cz: 2003, length: 450, halfWidth: 13 },
      pad: { x0: 2255, x1: 2925, z0: 1873, z1: 2133, blend: 200 },
    },
    islands: [
      { name: 'Lagoon Isle', cx: 0, cz: 0, radius: 1500, peak: 22, seed: 701, profile: 'flat' },
      { name: 'Pass Motu', cx: 2559, cz: 2147, radius: 420, peak: 13, seed: 709, profile: 'flat' },
    ],
    chunks: [
      { cx: 0, cz: 0, size: 8000, segments: 224 },
      { cx: 2559, cz: 2147, size: 1800, segments: 64 },
    ],
    waters: {
      harbour: {
        cx: 2168,
        cz: 1819,
        length: 170,
        width: 130,
        mouthDeg: -50,
        mouthWidth: 56,
        depth: 5,
        wallW: 20,
        quayW: 26,
        wallY: 3.4,
        quayY: 2.6,
        blend: 110,
        shelf: false,
      },
      channel: { halfWidth: 70, blend: 50, path: [[2323, 3318], [2019, 2883], [1749, 2498], [2367, 1986]] },
      shoals: [
        { cx: 1589, cz: 3006, r: 150, top: 0.7, pow: 1.6 },
        { cx: 1319, cz: 3134, r: 150, top: 0.35, pow: 1.6 },
        { cx: 1040, cz: 3237, r: 150, top: 0.35, pow: 1.6 },
        { cx: 753, cz: 3316, r: 150, top: 0.35, pow: 1.6 },
        { cx: 460, cz: 3369, r: 150, top: 0.35, pow: 1.6 },
        { cx: 163, cz: 3396, r: 150, top: 0.7, pow: 1.6 },
        { cx: -135, cz: 3397, r: 150, top: 0.35, pow: 1.6 },
        { cx: -432, cz: 3372, r: 150, top: 0.35, pow: 1.6 },
        { cx: -725, cz: 3322, r: 150, top: 0.35, pow: 1.6 },
        { cx: -1013, cz: 3246, r: 150, top: 0.35, pow: 1.6 },
        { cx: -1293, cz: 3144, r: 150, top: 0.7, pow: 1.6 },
        { cx: -1564, cz: 3019, r: 150, top: 0.35, pow: 1.6 },
        { cx: -1822, cz: 2871, r: 150, top: 0.35, pow: 1.6 },
        { cx: -2066, cz: 2700, r: 150, top: 0.35, pow: 1.6 },
        { cx: -2295, cz: 2509, r: 150, top: 0.35, pow: 1.6 },
        { cx: -2505, cz: 2298, r: 150, top: 0.7, pow: 1.6 },
        { cx: -2697, cz: 2070, r: 150, top: 0.35, pow: 1.6 },
        { cx: -2868, cz: 1826, r: 150, top: 0.35, pow: 1.6 },
        { cx: -3017, cz: 1568, r: 150, top: 0.35, pow: 1.6 },
        { cx: -3142, cz: 1298, r: 150, top: 0.35, pow: 1.6 },
        { cx: -3244, cz: 1018, r: 150, top: 0.7, pow: 1.6 },
        { cx: -3321, cz: 730, r: 150, top: 0.35, pow: 1.6 },
        { cx: -3372, cz: 437, r: 150, top: 0.35, pow: 1.6 },
        { cx: -3397, cz: 140, r: 150, top: 0.35, pow: 1.6 },
        { cx: -3396, cz: -158, r: 150, top: 0.35, pow: 1.6 },
        { cx: -3369, cz: -455, r: 150, top: 0.7, pow: 1.6 },
        { cx: -3317, cz: -748, r: 150, top: 0.35, pow: 1.6 },
        { cx: -3239, cz: -1035, r: 150, top: 0.35, pow: 1.6 },
        { cx: -3136, cz: -1315, r: 150, top: 0.35, pow: 1.6 },
        { cx: -3008, cz: -1584, r: 150, top: 0.35, pow: 1.6 },
        { cx: -2858, cz: -1841, r: 150, top: 0.7, pow: 1.6 },
        { cx: -2686, cz: -2084, r: 150, top: 0.35, pow: 1.6 },
        { cx: -2493, cz: -2312, r: 150, top: 0.35, pow: 1.6 },
        { cx: -2281, cz: -2521, r: 150, top: 0.35, pow: 1.6 },
        { cx: -1589, cz: -3006, r: 150, top: 0.7, pow: 1.6 },
        { cx: -1319, cz: -3134, r: 150, top: 0.35, pow: 1.6 },
        { cx: -1040, cz: -3237, r: 150, top: 0.35, pow: 1.6 },
        { cx: -753, cz: -3316, r: 150, top: 0.35, pow: 1.6 },
        { cx: -460, cz: -3369, r: 150, top: 0.35, pow: 1.6 },
        { cx: -163, cz: -3396, r: 150, top: 0.7, pow: 1.6 },
        { cx: 135, cz: -3397, r: 150, top: 0.35, pow: 1.6 },
        { cx: 432, cz: -3372, r: 150, top: 0.35, pow: 1.6 },
        { cx: 725, cz: -3322, r: 150, top: 0.35, pow: 1.6 },
        { cx: 1013, cz: -3246, r: 150, top: 0.35, pow: 1.6 },
        { cx: 1293, cz: -3144, r: 150, top: 0.7, pow: 1.6 },
        { cx: 1564, cz: -3019, r: 150, top: 0.35, pow: 1.6 },
        { cx: 1822, cz: -2871, r: 150, top: 0.35, pow: 1.6 },
        { cx: 2066, cz: -2700, r: 150, top: 0.35, pow: 1.6 },
        { cx: 2295, cz: -2509, r: 150, top: 0.35, pow: 1.6 },
        { cx: 2505, cz: -2298, r: 150, top: 0.7, pow: 1.6 },
        { cx: 2697, cz: -2070, r: 150, top: 0.35, pow: 1.6 },
        { cx: 2868, cz: -1826, r: 150, top: 0.35, pow: 1.6 },
        { cx: 3017, cz: -1568, r: 150, top: 0.35, pow: 1.6 },
        { cx: 3142, cz: -1298, r: 150, top: 0.35, pow: 1.6 },
        { cx: 3244, cz: -1018, r: 150, top: 0.7, pow: 1.6 },
        { cx: 3321, cz: -730, r: 150, top: 0.35, pow: 1.6 },
        { cx: 3372, cz: -437, r: 150, top: 0.35, pow: 1.6 },
        { cx: 3397, cz: -140, r: 150, top: 0.35, pow: 1.6 },
        { cx: 3396, cz: 158, r: 150, top: 0.35, pow: 1.6 },
        { cx: 3369, cz: 455, r: 150, top: 0.7, pow: 1.6 },
        { cx: 3317, cz: 748, r: 150, top: 0.35, pow: 1.6 },
        { cx: 3239, cz: 1035, r: 150, top: 0.35, pow: 1.6 },
        { cx: 3136, cz: 1315, r: 150, top: 0.35, pow: 1.6 },
        { cx: 3008, cz: 1584, r: 150, top: 0.35, pow: 1.6 },
        { cx: 2858, cz: 1841, r: 150, top: 0.7, pow: 1.6 },
        { cx: 2686, cz: 2084, r: 150, top: 0.35, pow: 1.6 },
        { cx: 2493, cz: 2312, r: 150, top: 0.35, pow: 1.6 },
        { cx: 2281, cz: 2521, r: 150, top: 0.35, pow: 1.6 },
      ],
    },
    outpost: { cx: 2666, cz: 2237, elev: 12, halfLen: 90, halfWidth: 40, blend: 90 },
    palette: {
      grass: [1.02, 1.05, 0.85],
      sand: [1.15, 1.12, 0.98],
      rock: [1.05, 1.02, 0.96],
      deepWater: 1203846,
      swell: 4171972,
      shallow: [0.28, 0.95, 0.88],
      nightSky: 11063528,
    },
    features: { reef: { islands: [0, 1], colour: 5234888, width: 0.3, bright: 0.75 } },
    scenery: {
      coastTrees: 480,
      coastTreeHeight: 9,
      hillTrees: 40,
      hillTreeHeight: 7,
      hillCentre: [0, 0],
      hillRadius: 800,
      hillBand: [4, 20],
      town: { cx: 250, cz: 150, radius: 340, count: 22, minH: 6, maxH: 20 },
      lighthouse: [2666, 2237],
      deliveryPad: [2666, 2237],
      padTrees: 70,
      boats: 5,
    },
    weather: { time: 'day', cond: 'clear', windSpeedKts: 5, windDirDeg: 140 },
  },

  /* meridian — meridian-city.heli-map.js, 450 m strip sited on Meridian Island, 1.4 m of levelling */
  {
    id: 'meridian',
    name: 'Meridian City',
    subtitle: 'City · rooftops, a hospital and one very tall tower',
    blurb: 'A whole city of roofs to land on: an easy plaza to start on, a hospital pad by the park, four ordinary rooftops at four different heights, and one very tall tower with a pad right on top. Come in slow — the streets between the buildings are canyons, not runways.',
    difficulty: 2,
    difficultyLabel: 'Easy',
    game: 'heli',
    games: ['heli'],
    seaFloor: -30,
    airport: {
      elev: 40,
      headingDeg: 90,
      runway: { cx: 608, cz: -1366, length: 450, halfWidth: 13 },
      pad: { x0: 273, x1: 943, z0: -1496, z1: -1236, blend: 200 },
    },
    islands: [
      { name: 'Meridian Island', cx: 0, cz: 0, radius: 2300, peak: 38, seed: 601, profile: 'plains' },
      {
        name: 'Signal Point',
        cx: 4450,
        cz: -2200,
        radius: 380,
        peak: 70,
        seed: 613,
        profile: 'hills',
      },
    ],
    chunks: [
      { cx: 0, cz: 0, size: 7000, segments: 180 },
      { cx: 4450, cz: -2200, size: 1400, segments: 88 },
    ],
    outpost: { cx: -1500, cz: 1600, elev: 'auto', minElev: 4, halfLen: 150, halfWidth: 60, blend: 120 },
    palette: {
      grass: [0.9, 0.98, 0.88],
      sand: [0.98, 0.97, 0.92],
      rock: [0.86, 0.86, 0.88],
      deepWater: 1194590,
      swell: 3832744,
      shallow: [0.32, 0.8, 0.78],
      nightSky: 9677768,
    },
    scenery: {
      pads: [
        { id: 'field', name: 'Meridian Field Pad', x: -520, z: -150, kind: 'ground', r: 11 },
        { id: 'hospital', name: 'Meridian General', x: 900, z: 700, kind: 'roof', above: 24, r: 11 },
        { id: 'plaza', name: 'Founders Plaza', x: 1300, z: 950, kind: 'ground', r: 14 },
        { id: 'rowhouse', name: 'Lowtown Roof', x: 1550, z: 650, kind: 'roof', above: 13, r: 9 },
        { id: 'midrise', name: 'Canal Street Roof', x: 1050, z: 1250, kind: 'roof', above: 27, r: 10 },
        {
          id: 'highrise',
          name: 'Exchange Tower Roof',
          x: 1735,
          z: 1120,
          kind: 'roof',
          above: 42,
          r: 11,
        },
        { id: 'tower', name: 'Meridian Spire', x: 1400, z: 1450, kind: 'roof', above: 150, r: 16 },
        { id: 'signal', name: 'Signal Point', x: 4450, z: -2200, kind: 'stack', r: 9 },
      ],
      coastTrees: 650,
      coastTreeHeight: 10,
      hillTrees: 380,
      hillTreeHeight: 13,
      hillCentre: [-1000, -1000],
      hillRadius: 1300,
      hillBand: [10, 45],
      town: { cx: 1400, cz: 950, radius: 900, count: 110, minH: 8, maxH: 55 },
      lighthouse: [4450, -2200],
      deliveryPad: [-1500, 1600],
      padTrees: 200,
      boats: 3,
    },
    weather: { time: 'day', cond: 'clear', windSpeedKts: 7, windDirDeg: 240 },
  },

  /* mountainpass — mountainpass.map.js, 450 m strip sited on Trailhead Flats, 6.6 m of levelling */
  {
    id: 'mountainpass',
    name: 'Saddleback Pass',
    subtitle: 'Mountain pass · switchbacks up and over',
    blurb: 'Climb a real mountain the long way round! Wind up hairpin turn after hairpin turn, hold your line through the high shoulder, then wind all the way back down the far side. The steepest drive in the game.',
    difficulty: 5,
    difficultyLabel: 'Treacherous',
    game: 'car',
    games: ['car'],
    seaFloor: -30,
    airport: {
      elev: 102,
      headingDeg: 90,
      runway: { cx: 667, cz: -385, length: 450, halfWidth: 13 },
      pad: { x0: 332, x1: 1002, z0: -515, z1: -255, blend: 200 },
    },
    islands: [
      { name: 'Trailhead Flats', cx: 0, cz: 0, radius: 1400, peak: 110, seed: 577, profile: 'hills' },
      {
        name: 'Saddleback Ridge',
        cx: 4200,
        cz: 2100,
        radius: 2200,
        peak: 260,
        seed: 401,
        profile: 'hills',
      },
    ],
    chunks: [
      { cx: 0, cz: 0, size: 4200, segments: 180 },
      { cx: 4200, cz: 2100, size: 6600, segments: 330 },
    ],
    waters: {
      roads: [
        {
          halfWidth: 26,
          blend: 200,
          path: [
            [4400, 200, 20],
            [4400, 500, 57.1],
            [4300, 700, 84.8],
            [4300, 1000, 121.9],
            [4500, 1150, 152.9],
            [4500, 1450, 190],
            [4300, 1600, 194.6],
            [4300, 1900, 200.1],
            [4500, 2050, 204.7],
            [4500, 2350, 210.3],
            [4300, 2500, 214.9],
            [4300, 2800, 220.4],
            [4500, 2950, 225],
            [4500, 3100, 200.8],
            [4300, 3250, 160.3],
            [4300, 3450, 128],
            [4500, 3600, 87.6],
            [4500, 3750, 63.4],
            [4400, 3850, 40.5],
            [4450, 3980, 18],
          ],
        },
      ],
    },
    palette: {
      grass: [0.88, 0.98, 0.72],
      sand: [1, 0.92, 0.78],
      rock: [1.05, 0.94, 0.82],
      deepWater: 1194590,
      swell: 3832744,
      shallow: [0.3, 0.8, 0.75],
      nightSky: 10467544,
    },
    scenery: {
      coastTrees: 500,
      coastTreeHeight: 10,
      hillTrees: 420,
      hillTreeHeight: 13,
      hillCentre: [3000, 2100],
      hillRadius: 700,
      hillBand: [50, 250],
      town: { cx: 5150, cz: 3650, radius: 180, count: 20, minH: 8, maxH: 160 },
      lighthouse: [-1350, 0],
      deliveryPad: [4500, 2950],
      padTrees: 140,
      boats: 2,
    },
    weather: { time: 'day', cond: 'clear', windSpeedKts: 9, windDirDeg: 210 },
  },

  /* stormcoast — stormcoast.map.js, 450 m strip sited on Squall Head, 4.9 m of levelling */
  {
    id: 'stormcoast',
    name: 'Squall Head',
    subtitle: 'Storm coast · open water, one bay home',
    blurb: 'Grey water in every direction and wind that never lets up. Squall Head has exactly one calm place to land a boat — a small bay tucked behind the point. Everywhere else on this coast is rock. Watch the swell, mind the reefs, and get home before the weather does.',
    difficulty: 4,
    difficultyLabel: 'Rough',
    game: 'boat',
    games: ['boat'],
    seaFloor: -70,
    airport: {
      elev: 119,
      headingDeg: 90,
      runway: { cx: 349, cz: -783, length: 450, halfWidth: 13 },
      pad: { x0: 14, x1: 684, z0: -913, z1: -653, blend: 200 },
    },
    islands: [
      { name: 'Squall Head', cx: 0, cz: 0, radius: 2450, peak: 200, seed: 419, profile: 'hills' },
      {
        name: 'Widow\'s Reef',
        cx: -2970,
        cz: -2970,
        radius: 380,
        peak: 130,
        seed: 447,
        profile: 'ridge',
      },
    ],
    chunks: [
      { cx: 0, cz: 0, size: 11000, segments: 256 },
      { cx: -2970, cz: -2970, size: 1700, segments: 56 },
    ],
    waters: {
      harbour: { island: 0, bearingDeg: 210, length: 260, width: 200, mouthWidth: 70, depth: 7, wallW: 28, quayW: 34, blend: 170, shelfTop: -10 },
      shoals: [
        { cx: 1009, cz: 1898, r: 380, top: -1.6 },
        { cx: -1491, cz: -2130, r: 260, top: 0.9, pow: 2.2 },
        { cx: -906, cz: -2490, r: 220, top: -0.4, pow: 1.8 },
        { cx: 4432, cz: 781, r: 850, top: -2.6 },
        { cx: -3370, cz: -3070, r: 200, top: 0.5, pow: 2.2 },
      ],
    },
    outpost: { cx: 1062, cz: 1575, elev: 42, halfLen: 210, halfWidth: 55, blend: 150 },
    palette: {
      grass: [0.8, 0.86, 0.78],
      sand: [0.7, 0.68, 0.66],
      rock: [0.66, 0.68, 0.74],
      deepWater: 664630,
      swell: 2575202,
      shallow: [0.22, 0.5, 0.56],
      nightSky: 8164267,
    },
    scenery: {
      coastTrees: 480,
      coastTreeHeight: 8,
      hillTrees: 260,
      hillTreeHeight: 10,
      hillCentre: [-1000, -1200],
      hillRadius: 1500,
      hillBand: [50, 200],
      town: { cx: 700, cz: 1000, radius: 280, count: 28, minH: 24, maxH: 175 },
      lighthouse: [-2970, -2970],
      deliveryPad: [1062, 1575],
      padTrees: 110,
      boats: 5,
    },
    weather: { time: 'day', cond: 'stormy', windSpeedKts: 24, windDirDeg: 250 },
  },
];

export const DEFAULT_MAP_ID = 'kestrel';

export function getMap(id) {
  return MAPS.find((m) => m.id === id) || MAPS[0];
}


/**
 * The maps a given game should offer.
 *
 * The map picker showed all twelve to everybody, which would put Longbank
 * Sands — four kilometres of sand with a nine-hundred-metre grass strip on it
 * — in front of a child choosing somewhere to fly a jet, and Ironhead Air Base
 * in front of a child choosing somewhere to take a lifeboat. A map says which
 * game it was built for; anything that does not say is a flight map, which is
 * what all nine of the existing ones are.
 */
export function mapsForGame(game = 'flight') {
  if (game === 'flight') return MAPS.filter((m) => !m.game || m.game === 'flight');
  const own = MAPS.filter((m) => m.game === game);
  const suits = (m) => {
    if (m.game) return false;
    const w = m.waters;
    if (game === 'boat') return !!(w && w.harbour);
    if (game === 'car') return !!(w && w.roads && w.roads.length);
    return true; // a helicopter can land almost anywhere
  };
  return own.concat(MAPS.filter(suits));
}

/** The boat maps proper — the three built round a harbour rather than a runway. */
export function boatMaps() {
  return MAPS.filter((m) => m.game === 'boat');
}

/** The maps built round a road network rather than a runway. */
export function carMaps() {
  return MAPS.filter((m) => m.game === 'car');
}
