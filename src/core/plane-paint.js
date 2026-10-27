/**
 * Paint per aeroplane (wave 18, owner 2026-10-26: "the paint should modify
 * THAT plane, not all of them").
 *
 * The paint used to be ONE setting, `settings.livery`, worn by every type in
 * the hangar at once: paint the 747 in Kanal and the Skylark, the F-22 and the
 * Courier went Kanal too. It is now a map, `settings.liveries`, from aircraft
 * type id to livery id; a type with no entry wears its own house colours.
 *
 * Every reader of the paint goes through `liveryOf` — the game aeroplane, the
 * fleet cards, the hangar, and both multiplayer messages (features/mpskin.js,
 * features/mplook.js), which send the paint of the aeroplane being flown, so
 * the wire format is unchanged and an older copy of the game still reads it.
 *
 * Pure, no imports: node tests load it directly.
 */

/** The paint this type wears: its own entry, else 'house' (the type's own colours). */
export function liveryOf(settings, typeId) {
  if (!settings) return 'house';
  const map = settings.liveries;
  if (map && typeof map === 'object') {
    const v = typeId ? map[typeId] : undefined;
    return typeof v === 'string' && v ? v : 'house';
  }
  // A settings object from before the map (a test's stand-in, a save not yet
  // migrated): the old single paint is the only answer it has.
  return typeof settings.livery === 'string' && settings.livery ? settings.livery : 'house';
}

/** Paint ONE type. 'house' clears its entry, so the map only holds real choices. */
export function setLiveryOf(settings, typeId, liveryId) {
  if (!settings || !typeId) return settings;
  if (!settings.liveries || typeof settings.liveries !== 'object') settings.liveries = {};
  if (!liveryId || liveryId === 'house') delete settings.liveries[typeId];
  else settings.liveries[typeId] = String(liveryId);
  return settings;
}

/** The type id this game is flying now (or would start in). */
export function currentTypeId(sim) {
  if (!sim) return null;
  if (sim.aircraftType && sim.aircraftType.id) return sim.aircraftType.id;
  return (sim.settings && sim.settings.aircraft) || null;
}

/** The paint of the aeroplane being flown now. */
export function currentLivery(sim) {
  return liveryOf(sim && sim.settings, currentTypeId(sim));
}

/**
 * Old saves: one global `livery`. Every plane goes back to 'house' except the
 * one that save had selected (`settings.aircraft`), which keeps the old paint
 * — nobody's look changes for the aeroplane they were flying.
 *
 * `s` is the loaded (defaults-merged) settings, `saved` the raw save. Mutates
 * `s`; returns true when it changed something worth writing back.
 */
export function migrateLiveries(s, saved) {
  if (!s) return false;
  const hadMap = !!(saved && saved.liveries && typeof saved.liveries === 'object');
  const old = saved && typeof saved.livery === 'string' ? saved.livery : null;
  if (!s.liveries || typeof s.liveries !== 'object') s.liveries = {};
  let changed = false;
  if (!hadMap && old) {
    if (old !== 'house' && s.aircraft) s.liveries[s.aircraft] = old;
    changed = true;
  }
  if ('livery' in s) {
    delete s.livery;
    changed = changed || !!(saved && 'livery' in saved);
  }
  return changed;
}
