/**
 * The fun pack's save: the smoke colour. One key in localStorage, so it
 * lives on this device and works offline.
 *
 * Kept apart from the game's own progress on purpose: a broken or cleared
 * fun save can never cost anybody an aeroplane they bought.
 *
 * Used to also hold stars found, stickers earned and best stunt scores (see
 * git history); an old save with those fields is read back here same as any
 * other — the extra keys are simply never looked at, so it loads quietly,
 * with no console error, and the player lands on the default smoke colour.
 */

export const FUN_KEY = 'islandsim.fun.v1';

export function blankFun() {
  return {
    v: 2,
    smoke: { color: 'white' },
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
      smoke: { ...b.smoke, ...(p.smoke || {}) },
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
