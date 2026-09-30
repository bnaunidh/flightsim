/**
 * The fun pack's save: stars found, stickers earned, best stunt scores and
 * the smoke colour. One key in localStorage, so it lives on this device —
 * which on a class set of Chromebooks, each signed in as one child, is the
 * same thing as "per kid" — and it works offline.
 *
 * Kept apart from the game's own progress on purpose: a broken or cleared
 * fun save can never cost anybody an aeroplane they bought.
 */

export const FUN_KEY = 'islandsim.fun.v1';

export function blankFun() {
  return {
    v: 1,
    /** 'game:mapId' -> ids of the stars found there (see stars.js starId). */
    stars: {},
    /** sticker id -> the day it was earned, 'YYYY-MM-DD'. */
    stickers: {},
    /** Best single-flight stunt score per game, and how many of each stunt. */
    stunts: { best: {}, count: {} },
    smoke: { color: 'white' },
    /** Seconds spent flying through a disaster, for Storm Chaser. */
    storm: 0,
  };
}

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (e) {
    return null;
  }
}

export function loadFun(store = storage()) {
  try {
    const raw = store && store.getItem(FUN_KEY);
    if (!raw) return blankFun();
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object') return blankFun();
    const b = blankFun();
    return {
      ...b,
      ...p,
      stars: p.stars && typeof p.stars === 'object' ? p.stars : {},
      stickers: p.stickers && typeof p.stickers === 'object' ? p.stickers : {},
      stunts: { ...b.stunts, ...(p.stunts || {}), best: { ...((p.stunts && p.stunts.best) || {}) }, count: { ...((p.stunts && p.stunts.count) || {}) } },
      smoke: { ...b.smoke, ...(p.smoke || {}) },
      storm: Number(p.storm) || 0,
    };
  } catch (e) {
    return blankFun();
  }
}

export function saveFun(data, store = storage()) {
  try {
    if (!store) return false;
    store.setItem(FUN_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    return false;
  }
}

/** Every star found, on every map, in every game. */
export function totalStars(data) {
  let n = 0;
  for (const k in data.stars) n += (data.stars[k] || []).length;
  return n;
}

/** How many different maps have at least one star found on them. */
export function mapsWithStars(data) {
  const maps = new Set();
  for (const k in data.stars) if ((data.stars[k] || []).length) maps.add(k.split(':')[1]);
  return maps.size;
}

/** Today on this device's own calendar (not UTC: a sticker earned after tea is today's). */
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
