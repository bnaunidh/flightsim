/**
 * Who is on board an airliner, and where they sit — numbers only, no THREE,
 * so the node test reads it.
 *
 *   cabinFor(type, doors)  the cabin of one airliner: seats, cabin crew,
 *                          seats across, rows, the floor, the walls, the
 *                          windows and the doors people leave by, in metres in
 *                          the aeroplane's own frame (-Z forward, +Y up, +X
 *                          right; the doors table's frame, aircraft/extra/
 *                          airliners.js AIRLINER_DOORS).
 *   bookedFor(cabin, seed) how many are flying today: 78-96% full.
 *   isAirlinerType(type)   the same question eject/profiles.js asks — listed,
 *                          or a roster entry that says it is one — so an
 *                          airliner another team adds tomorrow carries people.
 *
 * The seat counts are the usual two-class numbers for the real aeroplanes
 * (the A320's 180 is its one-class maximum, which is how most fly it), the
 * Meridian's forty from its hangar card. Anything else is estimated from its
 * doors: seats across from the cabin's width, rows from its length.
 */

const KNOWN = {
  meridian: { seats: 40, crew: 1, abreast: 4 },
  a320: { seats: 180, crew: 4, abreast: 6 },
  b747: { seats: 416, crew: 12, abreast: 10 },
  a380: { seats: 555, crew: 18, abreast: 10 },
};

const AIRLINER_IDS = new Set(Object.keys(KNOWN));

/** Is this roster entry an airliner (people in the back)? */
export function isAirlinerType(t) {
  if (!t) return false;
  if (AIRLINER_IDS.has(t.id)) return true;
  if (t.military) return false;
  const cat = String(t.category || '').toLowerCase();
  const cls = String(t.class || '').toLowerCase();
  if (cat === 'cargo' || /freighter|cargo/.test(cls)) return false;
  return cat === 'airliner' || /airliner|jumbo|wide-?body|narrow-?body|jetliner|regional/.test(cls);
}

/** Main-deck passenger doors, front to back, one side. */
function mainDoors(doors, side = 'left') {
  return (doors || [])
    .filter((d) => d && d.deck !== 'upper' && d.kind === 'passenger' && d.side === side)
    .sort((a, b) => a.z - b.z);
}

/**
 * The cabin. `doors` is a door list (AIRLINER_DOORS[id] or a model's own
 * model.userData.doors.list); without one, a guess from the type's plan.
 */
export function cabinFor(type, doors) {
  const id = (type && type.id) || '';
  const L = mainDoors(doors, 'left');
  const R = mainDoors(doors, 'right');
  let front;
  let rear;
  let halfW;
  let floorY;
  let doorY;
  if (L.length) {
    front = L[0];
    rear = L[L.length - 1];
    halfW = Math.max(...L.map((d) => Math.abs(d.x)));
    floorY = front.sill;
    doorY = front.y;
  } else {
    // A plan, or the trainer's numbers scaled: never null.
    const plan = (type && type.plan) || {};
    const nose = Number.isFinite(plan.nose) ? plan.nose : -12;
    const tail = Number.isFinite(plan.tail) ? plan.tail : 14;
    const len = tail - nose;
    front = { z: nose + len * 0.18, y: 0.3, sill: -0.6 };
    rear = { z: nose + len * 0.72, y: 0.3, sill: -0.6 };
    halfW = Math.max(1.3, Math.min(3.5, len / 18));
    floorY = -0.6;
    doorY = 0.3;
  }
  const known = KNOWN[id];
  const wide = halfW > 2.6;
  const abreast = known ? known.abreast : Math.max(4, Math.min(10, Math.round((halfW * 2 - (wide ? 1.1 : 0.5)) / 0.52)));
  const pitch = 0.81;
  // Seats from just behind the front door to just ahead of the rear one.
  const z0 = front.z + 1.4;
  const z1 = Math.max(z0 + pitch * 4, rear.z - 0.9);
  const rows = Math.max(4, Math.floor((z1 - z0) / pitch));
  const seats = known ? known.seats : Math.max(20, rows * abreast);
  const crew = known ? known.crew : Math.max(1, Math.ceil(seats / 50));
  // Aisles: one in a narrow body (3-3, 2-2), two in a wide one (3-4-3).
  const aisles = wide ? 2 : 1;
  const exits = (doors || []).filter((d) => d && (d.kind === 'passenger' || d.kind === 'overwing'));
  return {
    id,
    seats,
    crew,
    abreast,
    aisles,
    pitch,
    rows,
    z0,
    z1,
    floorY,
    halfW,
    // The interior wall stands a little inside the skin.
    wallW: halfW * 0.93,
    ceilingY: floorY + (wide ? 2.55 : 2.15),
    windowY: doorY + 0.09,
    windowPitch: 0.53,
    front: { ...front },
    rear: { ...rear },
    exits: exits.map((d) => ({ ...d })),
    wide,
  };
}

/** A tiny repeatable random from a seed (mulberry32). */
export function seeded(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How many are booked today: 78-96% of the seats. */
export function bookedFor(cabin, seed = 1) {
  const rnd = seeded(seed * 9301 + 49297);
  const load = 0.78 + rnd() * 0.18;
  return Math.max(1, Math.min(cabin.seats, Math.round(cabin.seats * load)));
}

/**
 * Which seats are taken, for `booked` people in `cabin`: an array of seat
 * indices (row * abreast + column), the same every time for the same seed,
 * filled from the front so a half-boarded cabin looks like one.
 */
export function seatOrder(cabin, booked, seed = 1) {
  const n = cabin.rows * cabin.abreast;
  const rnd = seeded(seed * 7919 + 13);
  const all = [];
  for (let i = 0; i < n; i++) all.push(i);
  // A shuffle, then a sort that keeps roughly front-to-back.
  const keyed = all.map((i) => ({ i, k: Math.floor(i / cabin.abreast) + rnd() * 6 }));
  keyed.sort((a, b) => a.k - b.k);
  const want = Math.min(n, Math.round((booked / Math.max(1, cabin.seats)) * n));
  return keyed.slice(0, want).map((o) => o.i);
}
