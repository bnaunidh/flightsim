/**
 * What this player has found, and how long they have looked: saved in their
 * own browser (localStorage), never sent anywhere. In multiplayer every
 * player's finds are their own — nothing here is in a snapshot, so another
 * player sees the aeroplane you fly and nothing about where you found it.
 *
 * PURE: storage is passed in, so tests/features/secrets.mjs runs the save
 * and the hints with a Map.
 *
 * The aeroplane itself goes in progression.js's own `unlocked` list when it
 * is found (features/secrets.js), which is what the Hangar reads; this file
 * is the rest: which hiding places, when, where — the "Found at …" — the
 * minutes spent on each map, which hints have been given and which places
 * have been spotted from the air.
 */

export const KEY = 'islandsim.secrets.v1';

/**
 * When the hints come, in seconds of flying on a map while it still has a
 * hiding place you have not found: a rumour, then the clue, then a mark on
 * the map. Long enough that exploring finds them first; short enough that a
 * child who never would is told before they give up.
 */
export const HINT_AT = [240, 540, 900];

export function blank() {
  return { v: 1, found: {}, planes: {}, mapTime: {}, hints: {}, spotted: {} };
}

function safeStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (e) {
    return null;
  }
}

export function load(storage = safeStorage()) {
  try {
    const raw = storage && storage.getItem(KEY);
    if (!raw) return blank();
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object') return blank();
    const b = blank();
    for (const k of Object.keys(b)) if (p[k] && typeof p[k] === 'object') b[k] = p[k];
    return b;
  } catch (e) {
    return blank();
  }
}

export function save(st, storage = safeStorage()) {
  try {
    if (storage) storage.setItem(KEY, JSON.stringify(st));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * A hiding place found. Returns { first, newPlane, where }: whether it is
 * the first time for this spot, and for its aeroplane.
 */
export function markFound(st, spot, { mapName = '', at = Date.now() } = {}) {
  const where = mapName ? `${spot.place}, ${mapName}` : spot.place;
  const first = !st.found[spot.id];
  if (first) st.found[spot.id] = { at, plane: spot.plane, map: spot.map, where };
  let newPlane = false;
  if (!st.planes[spot.plane]) {
    st.planes[spot.plane] = { at, spot: spot.id, where };
    newPlane = true;
  }
  return { first, newPlane, where: st.planes[spot.plane].where };
}

/** An aeroplane earned rather than found (Air Force One): its own "where". */
export function markEarned(st, planeId, where, at = Date.now()) {
  if (st.planes[planeId]) return false;
  st.planes[planeId] = { at, spot: null, where };
  return true;
}

export function isFound(st, spotId) {
  return !!(st && st.found && st.found[spotId]);
}

export function foundAt(st, planeId) {
  const p = st && st.planes && st.planes[planeId];
  return p ? p.where : null;
}

export function addMapTime(st, mapId, dt) {
  if (!mapId || !(dt > 0)) return 0;
  st.mapTime[mapId] = (st.mapTime[mapId] || 0) + dt;
  return st.mapTime[mapId];
}

/** Which hint a spot is due, given the seconds flown on its map: 0 (none) to 3 (on the map). */
export function hintLevel(secs) {
  let lv = 0;
  for (let i = 0; i < HINT_AT.length; i++) if (secs >= HINT_AT[i]) lv = i + 1;
  return lv;
}

/**
 * The next hint to say for a spot, or 0: the highest level now due that has
 * not been said. Found places have no hints; spotted ones skip to the map
 * mark (they are already marked, exactly).
 */
export function nextHint(st, spot, secs) {
  if (isFound(st, spot.id)) return 0;
  const due = hintLevel(secs);
  const given = st.hints[spot.id] || 0;
  return due > given ? due : 0;
}

export function giveHint(st, spot, level) {
  st.hints[spot.id] = Math.max(st.hints[spot.id] || 0, level);
}

/**
 * The rough mark on the map for the last hint: somewhere 60-140 m from the
 * real place, the same somewhere every time (from the spot's id), so it
 * says "about here" without saying "exactly here".
 */
export function roughMark(spot, site) {
  let h = 0;
  for (const ch of spot.id) h = (h * 131 + ch.charCodeAt(0)) >>> 0;
  const a = ((h % 360) * Math.PI) / 180;
  const r = 60 + ((h >>> 9) % 81);
  return { x: site.x + Math.sin(a) * r, z: site.z - Math.cos(a) * r };
}

export function counts(st) {
  return { spots: Object.keys(st.found || {}).length, planes: Object.keys(st.planes || {}).length };
}
