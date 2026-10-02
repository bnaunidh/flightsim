/**
 * The carrier's working geometry: where the angled deck runs, where the four
 * arresting wires lie across it, where the glideslope comes down, where the
 * catapults are and where the pattern is flown.
 *
 * Pure numbers — no THREE, no DOM — so tests/features/carrier.mjs checks
 * every one of them in node, and the feature, the meatball, the LSO and the
 * missions all ask here instead of keeping their own copies.
 *
 * FRAMES. The ship is drawn by the model pack at a real carrier's 300 m and
 * scaled five times (src/world/carrier.js SCALE), so "local" below is the
 * pack's own coordinates times that scale: +x is starboard, +z is AFT (the
 * stern), the deck surface is `deckY`. The ship points along its heading
 * (0 = north = -z in the world), and the group is turned by -heading, so
 *
 *     world = centre + R(-heading) · local
 *
 * The landing area is the pack's painted angled deck: 9 degrees to port of
 * the ship's axis, centred on the pack point (-10, 35), so a station `s`
 * along it and an offset `lat` across it (positive to the right of a pilot
 * landing) give local = O + s·D + lat·R with D = (-sin 9°, -cos 9°) and
 * R = (cos 9°, -sin 9°).
 *
 * THE WIRES are at their REAL spacing — 12.2 m, forty feet — because the
 * aeroplanes are real size: from the cockpit the four wires look and play
 * exactly as they do on a Nimitz. They sit where the pack painted its wire
 * band and the tyre rubber, centred on the middle of its own four. The ship
 * itself is five times real so it can be seen from anywhere on the map; the
 * deck around the wires is simply very long, which is the forgiving part —
 * a bolter has a kilometre of steel to fly off.
 */

export const TUNE = {
  /** The angled deck, degrees to port of the ship's axis (the pack's own number). */
  angleDeg: 9,
  /** Pack-local origin of the landing centreline, before scaling. */
  originPack: [-10, 35],
  /** Half-length of the painted landing area along its axis, pack units. */
  areaHalfPack: 95,
  /** Half-width of the painted landing area, pack units (22 m wide). */
  areaHalfWidthPack: 11,
  /** Real spacing between cross-deck pendants: 40 ft. */
  wireSpacing: 12.2,
  wireCount: 4,
  /** Station of the middle of the four, pack units: the pack's wires 2-3 midpoint (-47 and -35). */
  wireCentrePack: -41,
  /*
   * The glideslope. 3.5 degrees is the Fresnel lens's standard basic angle,
   * set so that a hook on the ball touches down between the 2 and 3 wires
   * and rolls into the 3 — the target wire.
   */
  glideDeg: 3.5,
  /** The ball moves one cell per 0.375 degrees; five cells, so ±0.94° is the whole lens. */
  cellDeg: 0.375,
  /** Pack-local catapult tracks: [x, forward end z, aft end z]. Bow cats 1 and 2. */
  catsPack: [
    [11, -137, -28],
    [-11, -135, -82],
  ],
  /** Metres of track from the shuttle's start to its forward end (a C-13 is 94 m). */
  catStroke: 80,
  /** Seconds the shot takes, end to end — "zero to flying speed in about two seconds". */
  catSeconds: 2.1,
  /** Launch end speed, as a multiple of the type's clean stall speed. */
  catEndOverStall: 1.45,
  /** Where an F-35B starts a rolling take-off: starboard side, aft of the island, pointing up the deck. */
  stoPack: [12, 12],
  /*
   * The pattern, in metres, around a ship that is five times real. Heights
   * are over the DECK — the deck is 104 m up, and "800 feet" means 800 over
   * it, which is what a pilot actually flies to.
   */
  initialAstern: 5500, // 3 nm behind the stern, on the ship's heading
  initialFt: 800,
  downwindFt: 600,
  abeamPort: 2100, // the 180: abeam the landing area, 1.1 nm to port
  abeamAft: 450, // ...a little aft of midships, abeam the LSO
  grooveStart: 1400, // the groove: 3/4 nm from touchdown
};

const D2R = Math.PI / 180;
export const FT = 3.28084;
export const KT = 1.94384;

/** Everything about one ship that every other function here needs. */
export function frameFor(carrier, scale = 5) {
  if (!carrier || !carrier.pos) return null;
  const hdg = Number.isFinite(carrier.headingDeg) ? carrier.headingDeg : 0;
  const th = -hdg * D2R;
  const a = TUNE.angleDeg * D2R;
  const f = {
    cx: carrier.pos.x,
    cz: carrier.pos.z,
    deckY: carrier.deckY,
    halfWidth: carrier.halfWidth,
    halfDepth: carrier.halfDepth,
    headingDeg: hdg,
    scale,
    cos: Math.cos(th),
    sin: Math.sin(th),
    // Landing axis, local.
    O: { x: TUNE.originPack[0] * scale, z: TUNE.originPack[1] * scale },
    D: { x: -Math.sin(a), z: -Math.cos(a) },
    R: { x: Math.cos(a), z: -Math.sin(a) },
    landingHeadingDeg: (hdg - TUNE.angleDeg + 360) % 360,
  };
  f.areaHalf = TUNE.areaHalfPack * scale;
  f.areaHalfWidth = TUNE.areaHalfWidthPack * scale;
  f.wireCentreS = TUNE.wireCentrePack * scale;
  // The hook touchdown point the lens is set for: between wires 2 and 3.
  f.touchdownS = f.wireCentreS;
  return f;
}

/** Local (ship) to world, on the ground plane. */
export function toWorld(f, lx, lz, out = {}) {
  out.x = f.cx + lx * f.cos + lz * f.sin;
  out.z = f.cz - lx * f.sin + lz * f.cos;
  return out;
}

/** World to local (ship). */
export function toLocal(f, wx, wz, out = {}) {
  const dx = wx - f.cx;
  const dz = wz - f.cz;
  out.x = dx * f.cos - dz * f.sin;
  out.z = dx * f.sin + dz * f.cos;
  return out;
}

/** A world direction for a local one (no translation). */
export function dirWorld(f, lx, lz, out = {}) {
  out.x = lx * f.cos + lz * f.sin;
  out.z = -lx * f.sin + lz * f.cos;
  return out;
}

/** Station along the landing axis and offset across it, for a world point. */
export function station(f, wx, wz, out = {}) {
  const l = toLocal(f, wx, wz);
  const px = l.x - f.O.x;
  const pz = l.z - f.O.z;
  out.s = px * f.D.x + pz * f.D.z;
  out.lat = px * f.R.x + pz * f.R.z;
  return out;
}

/** World point at a landing-axis station and offset. */
export function atStation(f, s, lat = 0, out = {}) {
  const lx = f.O.x + s * f.D.x + lat * f.R.x;
  const lz = f.O.z + s * f.D.z + lat * f.R.z;
  return toWorld(f, lx, lz, out);
}

/** The four wires: number, station, and the two deck sheaves they run between. */
export function wires(f) {
  const out = [];
  const n = TUNE.wireCount;
  const half = f.areaHalfWidth;
  for (let i = 0; i < n; i++) {
    const s = f.wireCentreS + (i - (n - 1) / 2) * TUNE.wireSpacing;
    out.push({ n: i + 1, s, a: atStation(f, s, -half), b: atStation(f, s, half), halfSpan: half });
  }
  return out;
}

/** Where the deck ends at the back, along the landing centreline (the ramp). */
export function rampS(f) {
  // local z of the stern is +halfDepth (the deck box), solve O.z + s·D.z = halfDepth.
  return (f.halfDepth - f.O.z) / f.D.z;
}

/**
 * Where a point sits against the glideslope.
 *
 * `h` is height over the deck, `range` the distance still to go to the
 * touchdown point along the centreline, and `devDeg` how far above (+) or
 * below (-) the 3.5 degree path it is, as the lens would show it.
 */
export function glide(f, wx, wy, wz, out = {}) {
  const st = station(f, wx, wz);
  out.s = st.s;
  out.lat = st.lat;
  out.range = f.touchdownS - st.s;
  out.h = wy - f.deckY;
  const r = Math.max(out.range, 1);
  out.angleDeg = Math.atan2(out.h, r) / D2R;
  out.devDeg = out.angleDeg - TUNE.glideDeg;
  out.pathH = Math.tan(TUNE.glideDeg * D2R) * Math.max(0, out.range);
  return out;
}

/**
 * The ball, in cells off the datum: +1 is one cell high. Off the top of the
 * lens it is gone (null); off the bottom it sits in the bottom cell, which
 * is red — that is what a real lens does.
 */
export function ballCells(devDeg) {
  const c = devDeg / TUNE.cellDeg;
  if (c > 2.5) return { cells: 2.5, off: 'high' };
  if (c < -2.5) return { cells: -2.5, off: 'low', red: true };
  return { cells: c, off: null, red: c < -1.5 };
}

/** The two bow catapults: where the shuttle starts, where the track ends, and the launch heading. */
export function catapults(f) {
  return TUNE.catsPack.map(([x, zf, za], i) => {
    const s = f.scale;
    const lx = x * s;
    const fwdZ = zf * s;
    const startZ = Math.min(za * s, fwdZ + TUNE.catStroke);
    return {
      n: i + 1,
      start: toWorld(f, lx, startZ),
      end: toWorld(f, lx, fwdZ),
      local: { x: lx, z: startZ, fwdZ, aftZ: za * s },
      dir: dirWorld(f, 0, -1),
      headingDeg: f.headingDeg,
    };
  });
}

/** The spot an F-35B starts a rolling take-off from. */
export function stoSpot(f) {
  const [x, z] = TUNE.stoPack;
  const p = toWorld(f, x * f.scale, z * f.scale);
  return { x: p.x, z: p.z, headingDeg: f.headingDeg };
}

/**
 * Where player `k` (0, 1, 2…) starts: the two catapults, then the deck spots
 * behind each — "in the queue" — for a lobby with more jets than catapults.
 */
export function startSlot(f, k) {
  const cats = catapults(f);
  const i = Math.max(0, k | 0);
  if (i < cats.length) return { kind: 'cat', cat: cats[i], x: cats[i].start.x, z: cats[i].start.z, headingDeg: f.headingDeg };
  const cat = cats[i % cats.length];
  const rank = Math.floor(i / cats.length);
  const lx = cat.local.x;
  const lz = cat.local.z + 55 * rank;
  const p = toWorld(f, lx, lz);
  return { kind: 'queue', cat, x: p.x, z: p.z, headingDeg: f.headingDeg };
}

/** The meatball's place on the ship: the port deck edge abeam the touchdown point. */
export function lensSpot(f) {
  const td = f.O.z + f.touchdownS * f.D.z;
  const lx = -(f.halfWidth - 8);
  const lz = td - 20;
  return { local: { x: lx, z: lz }, world: toWorld(f, lx, lz), y: f.deckY };
}

/** The pattern's three marks: the initial, the 180 and the start of the groove. */
export function patternPoints(f) {
  const t = TUNE;
  const ini = toWorld(f, 0, f.halfDepth + t.initialAstern);
  const ab = toWorld(f, -t.abeamPort, t.abeamAft);
  const gs = atStation(f, f.touchdownS - t.grooveStart, 0);
  const tan = Math.tan(t.glideDeg * D2R);
  return {
    initial: { x: ini.x, y: f.deckY + t.initialFt / FT, z: ini.z, headingDeg: f.headingDeg },
    abeam: { x: ab.x, y: f.deckY + t.downwindFt / FT, z: ab.z, headingDeg: (f.headingDeg + 180) % 360 },
    groove: { x: gs.x, y: f.deckY + tan * t.grooveStart, z: gs.z, headingDeg: f.landingHeadingDeg },
  };
}

/** Signed difference a - b in degrees, -180..180. */
export function angleDiff(a, b) {
  return ((a - b + 540) % 360) - 180;
}

/**
 * Where an aeroplane is in the pattern, from where it is and which way it is
 * going. Only geometry; the feature keeps the sequence.
 *
 *   'groove'   behind the deck, lined up and on the way down
 *   'astern'   behind the ship, pointing the ship's way (the initial)
 *   'upwind'   alongside or ahead, pointing the ship's way
 *   'downwind' to port, pointing the other way
 *   'base'     turning in behind the ship
 *   'away'     anywhere else
 */
export function patternZone(f, x, y, z, headingDeg) {
  const l = toLocal(f, x, z);
  const g = glide(f, x, y, z);
  const hOverDeckFt = g.h * FT;
  const toShip = angleDiff(headingDeg, f.headingDeg);
  const toLanding = angleDiff(headingDeg, f.landingHeadingDeg);
  const dist = Math.hypot(l.x, l.z);
  if (
    g.range > 30 &&
    g.range < 3200 &&
    Math.abs(g.lat) < 70 + g.range * 0.32 &&
    Math.abs(toLanding) < 40 &&
    hOverDeckFt < 1100
  ) return 'groove';
  if (dist > 14000) return 'away';
  if (Math.abs(toShip) < 50 && l.z > f.halfDepth && l.z < f.halfDepth + 9000 && Math.abs(l.x) < 1800) return 'astern';
  if (Math.abs(toShip) < 60 && l.z <= f.halfDepth && l.z > -f.halfDepth - 3500 && l.x > -1200 && l.x < 2500) return 'upwind';
  if (Math.abs(angleDiff(headingDeg, f.headingDeg + 180)) < 60 && l.x < -600 && l.x > -5000) return 'downwind';
  if (l.z > 0 && l.x < 1500 && l.x > -4500 && l.z < f.halfDepth + 4500) return 'base';
  return 'away';
}
