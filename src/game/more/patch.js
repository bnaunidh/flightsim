/**
 * Lay a change over a mission def that the first load already holds.
 *
 * The mission lists are in the first-load graph (the menu reads them), and
 * that graph has a byte budget (tests/features/first-load.mjs). The fun pass
 * runs to thousands of lines, so it arrives with the features, after the
 * menu, and is laid over the same def objects here: the id, the board and the
 * saved records are all untouched, and startMode waits for the features, so
 * no flight ever starts on an unpatched def.
 *
 *   patch(id, { medals, beats, tick, ..., steps: { stepId: { text, check } } })
 *
 * Fields are copied with their descriptors, so `get spawn()` and `get text()`
 * stay getters. `steps` is by step id and field: a step keeps every field not
 * named. `{ __after: 'release', __new: {...} }` adds a step after `release`.
 */

const PATCHES = new Map();

/** Record a patch; applyPatches() lays them on. */
export function patch(id, fields) {
  PATCHES.set(id, fields);
}

function copyFields(to, from) {
  for (const key of Object.keys(from)) {
    Object.defineProperty(to, key, { ...Object.getOwnPropertyDescriptor(from, key), configurable: true, enumerable: true });
  }
}

function patchSteps(def, steps) {
  for (const id of Object.keys(steps)) {
    const change = steps[id];
    if (change.__new) {
      const at = def.steps.findIndex((s) => s.id === change.__after);
      if (at < 0) throw new Error(`[more] ${def.id}: no step ${change.__after} to add ${id} after`);
      if (!def.steps.some((s) => s.id === id)) def.steps.splice(at + 1, 0, change.__new);
      continue;
    }
    const step = def.steps.find((s) => s.id === id);
    if (!step) throw new Error(`[more] ${def.id}: no step ${id}`);
    copyFields(step, change);
  }
}

/** Lay every recorded patch onto `list`. Returns the ids laid on. Safe to call twice. */
export function applyPatches(list) {
  const done = [];
  for (const def of list) {
    const change = PATCHES.get(def && def.id);
    if (!change || def.__fun) continue;
    const { steps, ...fields } = change;
    copyFields(def, fields);
    if (steps) patchSteps(def, steps);
    Object.defineProperty(def, '__fun', { value: true, enumerable: false });
    done.push(def.id);
  }
  return done;
}
