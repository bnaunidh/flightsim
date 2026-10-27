/**
 * The World Map preview's plan: what a person decides. Read by
 * tools/worldmap/preview-layout.mjs, which measures everything else from the
 * height field and checks every rule (worldmap/preview.js) before it writes
 * src/world/worldmap/preview-data.js.
 *
 * x is east, z is south (north is -z), metres from Haven's runway centre.
 * The sea is a 400 km box round the middle (every field within 200 km of it
 * on both axes), in six regions:
 *
 *   Haven Sound           the original five fields, a hub and its short hops
 *   Westreach             a mainland: plains, a mountain range, a volcano,
 *                         the capital (Aldermere) and its long runway
 *   The Sunstring         an archipelago chain to the south-east, palms
 *   The Northern Skerries cold, rocky, steep islands to the north
 *   The Southern Sands    flat sandy cays to the south
 *   The Far Outposts      remote: one long-haul-only field and two rigs
 *
 * Every runway is 09/27, and every region's prevailing wind is within 30
 * degrees of that axis (the trade winds in the south and middle, the
 * westerlies in the north), so you land into the wind on 09 or 27.
 *
 * The islands each field stands on are placed by hand, a little off the
 * runway so both approaches come in over water or low ground; the rest of a
 * region's islands are drawn from a seeded generator (fillerIslands below),
 * kept clear of every runway's approach lanes and of each other. The same
 * seed always gives the same sea, whichever field you start from.
 */
import { makeName, isDenied } from '../../src/world/worldmap/names.js';

export const REGIONS = [
  { id: 'sound', name: 'Haven Sound', band: 'temperate', blurb: 'The hub and its short hops', cx: 0, cz: -5000 },
  { id: 'westreach', name: 'Westreach', band: 'temperate', blurb: 'A mainland: mountains, a volcano and the capital', cx: -150000, cz: 15000 },
  { id: 'sunstring', name: 'The Sunstring', band: 'tropical', blurb: 'An archipelago chain of reefs and palms', cx: 120000, cz: 105000 },
  { id: 'skerries', name: 'The Northern Skerries', band: 'cold', blurb: 'Cold, rocky and steep', cx: -30000, cz: -150000 },
  { id: 'sands', name: 'The Southern Sands', band: 'tropical', blurb: 'Flat sandy cays and one big field', cx: -50000, cz: 160000 },
  { id: 'outposts', name: 'The Far Outposts', band: 'cold', blurb: 'A long-haul diversion field and the rigs', cx: 170000, cz: -150000 },
];

/*
 * The fields. `kind`: hub (an international: long runway, airliners and
 * heavies), regional (airliners and light aircraft), ga (a strip: light
 * aircraft and helicopters; `surface` grass or gravel for the unpaved ones),
 * remote (a long runway with nothing round it but a station: long-haul only).
 * The first five are the preview's original fields, unchanged.
 */
export const AIRPORTS = [
  {
    id: 'haven', code: 'XHVN', name: 'Haven International', place: 'Haven Island', region: 'sound', kind: 'hub',
    x: 0, z: 0, length: 2800, halfWidth: 23, prevailingDeg: 80, parking: true,
    town: { name: 'Haven', dx: 2600, dz: -2300, radius: 680, count: 160, towers: 6, towerMaxH: 64 },
  },
  {
    id: 'gull', code: 'XGUL', name: 'Gull Cay Strip', place: 'Gull Cay', region: 'sound', kind: 'ga',
    x: 30000, z: 6000, length: 580, halfWidth: 10, prevailingDeg: 75, parking: false,
    town: { name: 'Gull Harbour', dx: 380, dz: -760, radius: 230, count: 12 },
  },
  {
    id: 'tern', code: 'XTRN', name: 'Tern Field', place: 'Tern Island', region: 'sound', kind: 'regional',
    x: -14000, z: -26000, length: 1300, halfWidth: 15, prevailingDeg: 80, parking: true,
    town: { name: 'Tern Harbour', dx: 1500, dz: -1350, radius: 430, count: 48 },
  },
  {
    id: 'marram', code: 'XMRM', name: 'Marram Regional', place: 'Marram Point', region: 'sound', kind: 'regional',
    x: -40000, z: 20000, length: 2400, halfWidth: 23, prevailingDeg: 85, parking: true,
    town: { name: 'Marram', dx: 1900, dz: -1650, radius: 540, count: 70 },
  },
  {
    id: 'farhold', code: 'XFHD', name: 'Farhold International', place: 'Farhold Island', region: 'sound', kind: 'hub',
    x: 42000, z: -40000, length: 2600, halfWidth: 23, prevailingDeg: 70, parking: true,
    town: { name: 'Farhold', dx: -2200, dz: -2400, radius: 740, count: 180, towers: 8, towerMaxH: 80 },
  },
  // Westreach, the mainland.
  {
    id: 'aldermere', code: 'XALD', name: 'Aldermere International', place: 'Westreach', region: 'westreach', kind: 'hub',
    x: -128000, z: 20000, length: 3800, halfWidth: 30, prevailingDeg: 75, parking: true, capital: true,
    town: { name: 'Aldermere', dx: 2600, dz: -2900, radius: 1350, count: 420, towers: 24, towerMaxH: 170 },
  },
  {
    id: 'highfold', code: 'XHFR', name: 'Highfold Regional', place: 'Highfold Vale', region: 'westreach', kind: 'regional',
    x: -165000, z: 30000, length: 2300, halfWidth: 23, prevailingDeg: 80, parking: true,
    town: { name: 'Highfold', dx: -1700, dz: -2100, radius: 540, count: 75 },
  },
  {
    id: 'saltmarsh', code: 'XSMS', name: 'Saltmarsh Strip', place: 'Saltmarsh Point', region: 'westreach', kind: 'ga', surface: 'grass',
    x: -176000, z: 52000, length: 700, halfWidth: 12, prevailingDeg: 80, parking: false,
    town: { name: 'Saltmarsh', dx: 500, dz: -900, radius: 240, count: 12 },
  },
  // The Sunstring.
  {
    id: 'frigate', code: 'XFRG', name: 'Frigate Bay Regional', place: 'Frigate Island', region: 'sunstring', kind: 'regional',
    x: 108000, z: 88000, length: 2300, halfWidth: 23, prevailingDeg: 85, parking: true,
    town: { name: 'Frigate Bay', dx: 1600, dz: -1700, radius: 480, count: 58 },
  },
  {
    id: 'mangrove', code: 'XMGV', name: 'Mangrove Cay Strip', place: 'Mangrove Cay', region: 'sunstring', kind: 'ga', surface: 'grass',
    x: 145000, z: 125000, length: 650, halfWidth: 12, prevailingDeg: 85, parking: false,
    town: { name: 'Mangrove Landing', dx: 400, dz: -800, radius: 220, count: 12 },
  },
  {
    id: 'conch', code: 'XCNC', name: 'Conch Island Field', place: 'Conch Island', region: 'sunstring', kind: 'ga',
    x: 72000, z: 58000, length: 1000, halfWidth: 15, prevailingDeg: 80, parking: false,
    town: { name: 'Conch Harbour', dx: 1000, dz: -1100, radius: 340, count: 30 },
  },
  // The Northern Skerries: the westerlies, so runway 27 most days.
  {
    id: 'eider', code: 'XEDR', name: 'Eider Bay Regional', place: 'Eider Island', region: 'skerries', kind: 'regional',
    x: -42000, z: -138000, length: 1450, halfWidth: 23, prevailingDeg: 260, parking: true,
    town: { name: 'Eider Bay', dx: 1500, dz: -1800, radius: 460, count: 52 },
  },
  {
    id: 'petrel', code: 'XPTL', name: 'Petrel Skerry Strip', place: 'Petrel Skerry', region: 'skerries', kind: 'ga', surface: 'gravel',
    x: 22000, z: -168000, length: 750, halfWidth: 12, prevailingDeg: 265, parking: false,
    town: { name: 'Petrel Wick', dx: 500, dz: -900, radius: 230, count: 12 },
  },
  // The Southern Sands.
  {
    id: 'sandmere', code: 'XSDM', name: 'Sandmere International', place: 'Sandmere', region: 'sands', kind: 'hub',
    x: -62000, z: 150000, length: 3200, halfWidth: 30, prevailingDeg: 90, parking: true,
    town: { name: 'Sandmere', dx: 2500, dz: -2600, radius: 880, count: 140, towers: 4, towerMaxH: 60 },
  },
  {
    id: 'dune', code: 'XDUN', name: 'Dune Cay Strip', place: 'Dune Cay', region: 'sands', kind: 'ga', surface: 'grass',
    x: -5000, z: 176000, length: 600, halfWidth: 12, prevailingDeg: 90, parking: false,
    town: { name: 'Dune Cay', dx: 400, dz: -800, radius: 220, count: 12 },
  },
  // The Far Outposts: a long runway 150 km and more from any other field.
  {
    id: 'farwatch', code: 'XFWT', name: 'Farwatch Field', place: 'Farwatch Island', region: 'outposts', kind: 'remote',
    x: 172000, z: -168000, length: 3000, halfWidth: 23, prevailingDeg: 255, parking: false,
    town: { name: 'Farwatch Station', dx: 1400, dz: -1500, radius: 260, count: 12 },
  },
];

/*
 * The hand-placed islands: the original eighteen, then each new field's own
 * island and the mainland's shape. `region` is for the world map and the
 * vegetation; the height field does not read it.
 */
const HAND = [
  // Haven Sound (unchanged from wave 16).
  { name: 'Haven Island', cx: 1500, cz: -900, radius: 5600, peak: 22, seed: 211, profile: 'plains', region: 'sound' },
  { name: 'Haven Downs', cx: -2400, cz: 3900, radius: 1300, peak: 150, seed: 223, profile: 'hills', region: 'sound' },
  { name: 'Signal Hill', cx: 3800, cz: -4600, radius: 1100, peak: 140, seed: 227, profile: 'hills', region: 'sound' },
  { name: 'Gull Cay', cx: 30200, cz: 5600, radius: 1900, peak: 6, seed: 307, profile: 'flat', region: 'sound' },
  { name: 'Tern Island', cx: -13800, cz: -26700, radius: 3300, peak: 22, seed: 401, profile: 'plains', region: 'sound' },
  { name: 'Tern Fell', cx: -12600, cz: -29600, radius: 1000, peak: 230, seed: 409, profile: 'hills', region: 'sound' },
  { name: 'Marram Point', cx: -39800, cz: 19000, radius: 4200, peak: 20, seed: 503, profile: 'plains', region: 'sound' },
  { name: 'Farhold Island', cx: 42200, cz: -40900, radius: 6000, peak: 26, seed: 601, profile: 'plains', region: 'sound' },
  { name: 'Farhold Peaks', cx: 45600, cz: -46200, radius: 2100, peak: 380, seed: 607, profile: 'ridge', region: 'sound' },
  { name: 'Cinder Peak', cx: 19000, cz: -21000, radius: 2600, peak: 880, seed: 701, profile: 'cone', crater: 110, craterRadius: 360, region: 'sound' },
  { name: 'Pelican Rocks', cx: -22000, cz: 7000, radius: 700, peak: 90, seed: 711, profile: 'hills', region: 'sound' },
  { name: 'Sand Cay', cx: 14000, cz: 16000, radius: 900, peak: 5, seed: 713, profile: 'flat', region: 'sound' },
  { name: 'Skua Holm', cx: -52000, cz: -6000, radius: 1200, peak: 140, seed: 717, profile: 'ridge', region: 'sound' },
  { name: 'Shell Reef', cx: 6000, cz: 34000, radius: 800, peak: 5, seed: 719, profile: 'flat', region: 'sound' },
  { name: 'Heron Isle', cx: -30000, cz: -46000, radius: 1500, peak: 160, seed: 723, profile: 'hills', region: 'sound' },
  { name: 'Kittiwake Rock', cx: 24000, cz: -54000, radius: 600, peak: 120, seed: 729, profile: 'ridge', region: 'sound' },
  { name: 'Lantern Island', cx: 52000, cz: -12000, radius: 1400, peak: 120, seed: 733, profile: 'hills', region: 'sound' },
  { name: 'Driftwood Cay', cx: -8000, cz: 24000, radius: 1000, peak: 6, seed: 739, profile: 'flat', region: 'sound' },

  // Westreach: the mainland's body, the field plains, the range and the volcano.
  { name: 'Westreach', cx: -150000, cz: 12000, radius: 24000, peak: 24, seed: 811, profile: 'plains', region: 'westreach' },
  { name: 'Aldermere Plain', cx: -126800, cz: 19300, radius: 6200, peak: 18, seed: 813, profile: 'plains', region: 'westreach' },
  { name: 'Highfold Vale', cx: -165000, cz: 29200, radius: 5200, peak: 16, seed: 817, profile: 'plains', region: 'westreach' },
  { name: 'Saltmarsh Point', cx: -175800, cz: 51600, radius: 2400, peak: 6, seed: 819, profile: 'flat', region: 'westreach' },
  { name: 'Highfold Range', cx: -158000, cz: -9000, radius: 9000, peak: 1450, seed: 821, profile: 'ridge', region: 'westreach' },
  { name: 'Greyspine Fells', cx: -136000, cz: -12000, radius: 6000, peak: 1050, seed: 823, profile: 'ridge', region: 'westreach' },
  { name: 'Mount Calder', cx: -180000, cz: 4000, radius: 5200, peak: 1650, seed: 827, profile: 'cone', crater: 150, craterRadius: 520, region: 'westreach' },

  // The Sunstring fields.
  { name: 'Frigate Island', cx: 108800, cz: 87300, radius: 4300, peak: 20, seed: 911, profile: 'plains', region: 'sunstring' },
  { name: 'Mangrove Cay', cx: 145200, cz: 124600, radius: 2000, peak: 6, seed: 913, profile: 'flat', region: 'sunstring' },
  { name: 'Conch Island', cx: 72400, cz: 57400, radius: 2900, peak: 18, seed: 917, profile: 'plains', region: 'sunstring' },

  // The Northern Skerries fields, and their rock.
  { name: 'Eider Island', cx: -41500, cz: -138800, radius: 4500, peak: 22, seed: 1011, profile: 'plains', region: 'skerries' },
  { name: 'Eider Crags', cx: -38000, cz: -146500, radius: 2200, peak: 520, seed: 1013, profile: 'ridge', region: 'skerries' },
  { name: 'Petrel Skerry', cx: 22300, cz: -168400, radius: 2400, peak: 14, seed: 1017, profile: 'plains', region: 'skerries' },

  // The Southern Sands fields.
  { name: 'Sandmere', cx: -61000, cz: 149400, radius: 7000, peak: 6, seed: 1111, profile: 'flat', region: 'sands' },
  { name: 'Dune Cay', cx: -4800, cz: 175600, radius: 2000, peak: 5, seed: 1113, profile: 'flat', region: 'sands' },

  // The Far Outposts.
  { name: 'Farwatch Island', cx: 172500, cz: -168600, radius: 5000, peak: 22, seed: 1211, profile: 'plains', region: 'outposts' },
  { name: 'Farwatch Tor', cx: 176500, cz: -175000, radius: 1500, peak: 420, seed: 1213, profile: 'ridge', region: 'outposts' },
];

/*
 * The rest of each region, from a seeded generator. Each entry: the region,
 * how many islands, a box (or a chain line) to put them in, and the shapes
 * and sizes the region has.
 */
const FILL = [
  { region: 'westreach', n: 5, box: [-198000, -112000, -40000, 75000], profiles: ['hills', 'ridge', 'plains'], r: [700, 2400], seed: 81 },
  { region: 'sunstring', n: 12, chain: [[58000, 40000], [188000, 170000]], spread: 14000, profiles: ['flat', 'hills', 'plains', 'flat'], r: [600, 2600], seed: 91 },
  { region: 'skerries', n: 11, box: [-135000, 80000, -196000, -108000], profiles: ['ridge', 'ridge', 'hills'], r: [600, 2600], seed: 101 },
  { region: 'sands', n: 8, box: [-140000, 40000, 118000, 196000], profiles: ['flat', 'flat', 'plains'], r: [700, 3000], seed: 111 },
  { region: 'outposts', n: 5, box: [110000, 196000, -196000, -100000], profiles: ['ridge', 'hills'], r: [500, 1800], seed: 121 },
  // Lone rocks in the open water between the regions, so the long legs have
  // something on the horizon.
  { region: 'sound', n: 6, box: [-100000, 110000, -100000, 110000], profiles: ['hills', 'ridge', 'flat'], r: [500, 1600], seed: 131, avoidBox: [-62000, 62000, -62000, 42000] },
];

const PEAK = { flat: [4, 7], plains: [14, 30], hills: [80, 260], ridge: [160, 640], cone: [500, 900] };

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Too near a runway's approach lanes (6 km out each end, with room to spare), or its town. */
function inLanes(x, z, reach) {
  for (const a of AIRPORTS) {
    const along = Math.abs(x - a.x);
    const across = Math.abs(z - a.z);
    if (along < a.length / 2 + 9500 + reach && across < 3000 + reach) return true;
    const tx = a.x + a.town.dx;
    const tz = a.z + a.town.dz;
    if (Math.hypot(x - tx, z - tz) < a.town.radius + 2500 + reach) return true;
  }
  return false;
}

function clashes(list, x, z, r) {
  for (const i of list) {
    if (Math.hypot(x - i.cx, z - i.cz) < (i.radius + r) * 1.45 + 1800) return true;
  }
  return false;
}

/*
 * Wave 18 (owner, Oct 26: "maps sad as hell", flat uniform carpets): the
 * shape each island gets on top of its profile (terrain.js: relief, erode,
 * cliff). Big plains roll in hills up to `relief` metres (the mainland most,
 * 240 m), flattened again round every field's lanes, its site, the towns and
 * the roads (the layout tool's calm zones); the ranges and the hills rise to
 * their middles and are cut by gullies; the cold north's rocks and the
 * Sound's lone stacks stand on cliffs. Deterministic, from the island alone.
 */
export function shapeIsland(isl) {
  const out = { ...isl };
  if (isl.profile === 'plains' && isl.radius >= 2800) out.relief = Math.round(Math.min(320, Math.max(35, isl.radius * 0.0135)));
  if (isl.profile === 'ridge' || isl.profile === 'hills') out.erode = Math.round(isl.peak * (isl.profile === 'ridge' ? 0.26 : 0.2));
  const cold = isl.region === 'skerries' || isl.region === 'outposts';
  if ((isl.profile === 'ridge' || isl.profile === 'hills') && (cold || isl.region === 'sound') && isl.radius <= 3000) out.cliff = 22 + (isl.seed % 7) * 4;
  return out;
}

/** The seeded islands. Deterministic: same plan, same sea. */
export function fillerIslands(hand = HAND) {
  const out = [];
  const taken = new Set(hand.map((i) => i.name));
  const placed = hand.slice();
  let seedNo = 2001;
  for (const f of FILL) {
    const R = rng(f.seed * 7919);
    const band = (REGIONS.find((g) => g.id === f.region) || {}).band || 'temperate';
    let made = 0;
    for (let tries = 0; made < f.n && tries < 4000; tries++) {
      let x;
      let z;
      if (f.chain) {
        const t = R();
        const [[x0, z0], [x1, z1]] = f.chain;
        const nx = -(z1 - z0);
        const nz = x1 - x0;
        const nl = Math.hypot(nx, nz);
        const off = (R() * 2 - 1) * f.spread;
        x = x0 + (x1 - x0) * t + (nx / nl) * off;
        z = z0 + (z1 - z0) * t + (nz / nl) * off;
      } else {
        x = f.box[0] + R() * (f.box[1] - f.box[0]);
        z = f.box[2] + R() * (f.box[3] - f.box[2]);
      }
      x = Math.round(x / 100) * 100;
      z = Math.round(z / 100) * 100;
      const profile = f.profiles[Math.floor(R() * f.profiles.length)];
      const r = Math.round((f.r[0] + R() * (f.r[1] - f.r[0])) / 50) * 50;
      const reach = r * 1.45;
      if (Math.abs(x) + reach > 199000 || Math.abs(z) + reach > 199000) continue;
      if (f.avoidBox && x > f.avoidBox[0] && x < f.avoidBox[1] && z > f.avoidBox[2] && z < f.avoidBox[3]) continue;
      if (inLanes(x, z, reach)) continue;
      if (clashes(placed, x, z, r)) continue;
      const [p0, p1] = PEAK[profile];
      const peak = Math.round(p0 + R() * (p1 - p0));
      const nm = makeName(R(), band, taken);
      if (isDenied(nm.name)) continue;
      taken.add(nm.name);
      const isl = shapeIsland({ name: nm.name, cx: x, cz: z, radius: r, peak, seed: seedNo++, profile, region: f.region });
      placed.push(isl);
      out.push(isl);
      made++;
    }
  }
  return out;
}

/*
 * Helipads that are not at a field: a hospital roof in the capital, a
 * lifeboat station's pad in the north, and two rigs out at sea.
 */
export const HELIPORTS = [
  { id: 'aldermere-hospital', name: 'Aldermere General Hospital', region: 'westreach', kind: 'roof', role: 'hospital', above: 16, r: 11, near: 'aldermere', dx: 1500, dz: 0 },
  { id: 'eider-lifeboat', name: 'Eider Bay Lifeboat Station', region: 'skerries', kind: 'ground', r: 12, near: 'eider', dx: 900, dz: 650 },
  { id: 'westmost-rig', name: 'Westmost Platform', region: 'westreach', kind: 'deck', elev: 26, r: 13, x: -196000, z: -60000 },
  { id: 'sentinel-rig', name: 'Sentinel Reef Platform', region: 'sands', kind: 'deck', elev: 24, r: 13, x: 40000, z: 192000 },
];

export const PLAN = {
  seaFloor: -60,
  weather: { time: 'day', cond: 'clear', windSpeedKts: 8, windDirDeg: 80 },
  palette: {
    grass: [0.98, 1.0, 0.96], sand: [1.0, 0.98, 0.94], rock: [0.98, 0.97, 1.0],
    deepWater: 0x0f3a63, swell: 0x2f78a6, shallow: [0.3, 0.8, 0.76], nightSky: 0x9fb8d8,
  },
  regions: REGIONS,
  airports: AIRPORTS,
  islands: [...HAND.map(shapeIsland), ...fillerIslands(HAND)],
  heliports: HELIPORTS,
};
