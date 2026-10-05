/**
 * Local save data for achievements — its own key, separate from both
 * core/storage.js (settings, missions, landings) and game/progression.js
 * (rank, credits). Unlocking an achievement is not a score and does not pay
 * out, so it does not belong in either of those.
 */

export const KEY = 'islandsim.achievements.v1';

export function blank() {
  return {
    v: 1,
    unlocked: {}, // id -> ISO date string, when it unlocked
    counts: {
      planes: [], // distinct aircraft ids landed, for "every aeroplane"
      maps: [], // distinct map ids landed on, for "every map"
      golds: 0, // missions finished at 90+
      flights: 0, // missions/tutorial/free flights finished at all
    },
  };
}

function safeStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (e) {
    return null;
  }
}

export function load(storage = safeStorage()) {
  const b = blank();
  if (!storage) return b;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return b;
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object') return b;
    const c = (p.counts && typeof p.counts === 'object') ? p.counts : {};
    return {
      v: 1,
      unlocked: (p.unlocked && typeof p.unlocked === 'object') ? { ...p.unlocked } : {},
      counts: {
        planes: Array.isArray(c.planes) ? c.planes.filter((x) => typeof x === 'string') : [],
        maps: Array.isArray(c.maps) ? c.maps.filter((x) => typeof x === 'string') : [],
        golds: Number.isFinite(c.golds) ? c.golds : 0,
        flights: Number.isFinite(c.flights) ? c.flights : 0,
      },
    };
  } catch (e) {
    console.warn('Could not read your achievements — starting fresh.', e);
    return b;
  }
}

export function save(store, storage = safeStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(KEY, JSON.stringify(store));
    return true;
  } catch (e) {
    console.warn('Could not save achievements (storage may be full or blocked).', e);
    return false;
  }
}
