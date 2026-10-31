/**
 * The achievement notes main.js calls (a liftoff, a touchdown, an arrested
 * landing, the ceiling, a mission done), as a module with no imports.
 *
 * main.js used to import them from ./index.js, and that one import pulled
 * the whole achievements feature -- and through it multiplayer, the race and
 * the rest -- into the first load, before the menu. The features are now
 * imported after the menu (main.js featuresReady), so main.js imports THIS
 * and index.js plugs itself in on arrival (setAchievementNotes). A note that
 * arrives before the feature does is simply dropped: nobody earns a medal
 * for a liftoff the game has not finished loading for.
 */
let impl = null;

/** achievements/index.js hands over its note functions here. */
export function setAchievementNotes(fns) {
  impl = fns || null;
}

const call = (name) => (...args) => {
  if (impl && typeof impl[name] === 'function') return impl[name](...args);
  return undefined;
};

export const noteLiftoff = call('noteLiftoff');
export const noteTouchdown = call('noteTouchdown');
export const noteArrested = call('noteArrested');
export const noteCeiling = call('noteCeiling');
export const noteMissionComplete = call('noteMissionComplete');
