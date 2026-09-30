/**
 * What each aeroplane can do to get its pilot out, in one table.
 *
 * The owner's list asked for four things that all hang off the same question
 * — "what kind of aeroplane is this?" — so they are answered here once, per
 * type id, and every other file reads this:
 *
 *   escape      'seat'  a rocket ejection seat (the fast jets): out in one go,
 *                       at any height, parachute opens by itself
 *               'bail'  a light aeroplane: open the door and jump; needs a
 *                       little height for the parachute to open
 *               'jump'  T-Pose Harrison: he simply steps off his rocket board
 *               'none'  no way out in the air (airliners, the helicopter) —
 *                       and `noneWhy` says so kindly
 *   crew        how many OTHER people ride along with ejection seats of their
 *               own. They go first: "Crew out first — press again".
 *   selfDestruct  the special planes' guarded button
 *   dragChute   pops on the landing roll when you brake (fast jets)
 *   uniform     what the pilot wears on foot (see ../uniforms.js)
 *   runaway     a small plane: get out with the power on and it goes without
 *               you (../runaway.js). Every light aeroplane that bails out,
 *               unless it says otherwise.
 *
 * Anything not listed is read off its roster entry (class, category,
 * military), so an aeroplane another team adds tomorrow still gets a sensible
 * answer rather than an eject button that does nothing.
 *
 * Pure data and functions: no DOM, no THREE, so the node tests read it.
 */

/** Ejection seats, crews and specials, by type id. */
const BY_ID = {
  // Light aircraft: no ejection seat, but you can bail out with a parachute.
  skylark: { escape: 'bail', uniform: 'casual', runaway: true },
  courier: { escape: 'bail', uniform: 'casual', runaway: true },
  // A twin turboprop research ship: you bail out, but it is not a small plane.
  tempest: { escape: 'bail', uniform: 'casual', crew: 1, runaway: false },
  // Airliners: no ejection seats for anybody.
  meridian: { escape: 'none', uniform: 'captain' },
  a320: { escape: 'none', uniform: 'captain' },
  b747: { escape: 'none', uniform: 'captain' },
  a380: { escape: 'none', uniform: 'captain' },
  // The helicopter: the rotor is in the way.
  harrier: { escape: 'none', uniform: 'heli', why: 'heli' },
  // Fast jets. The Vanguard is the game's own fighter and lands hot.
  vanguard: { escape: 'seat', uniform: 'fighter', dragChute: true },
  f22: { escape: 'seat', uniform: 'fighter', selfDestruct: true, dragChute: true },
  f35b: { escape: 'seat', uniform: 'fighter', selfDestruct: true },
  fa18: { escape: 'seat', uniform: 'fighter' },
  // Two-seaters and multi-crew: the others go first.
  osprey: { escape: 'seat', uniform: 'fighter', crew: 1 },
  nightjar: { escape: 'seat', uniform: 'fighter', crew: 1, selfDestruct: true, dragChute: true },
  // The specials.
  massimo: { escape: 'seat', uniform: 'racer', selfDestruct: true, dragChute: true },
  tpose: { escape: 'jump', uniform: 'harrison', selfDestruct: true, dragChute: true },
};

/** The words for a type that has no way out, kind and short. */
export const NONE_WHY = {
  airliner: 'Airliners don’t have ejection seats — the safest way out is a good landing. You can do it!',
  heli: 'Helicopters don’t have ejection seats — the rotor is in the way! Land it, then press O to hop out.',
};

/** The escape profile for a roster entry (or a type id). Never null. */
export function profileFor(type) {
  const t = typeof type === 'string' ? { id: type } : type || {};
  const own = BY_ID[t.id];
  if (own) return fill(t, own);
  // An aeroplane nobody listed: guess from what it says it is.
  const cls = String(t.class || '').toLowerCase();
  const cat = String(t.category || '').toLowerCase();
  const rotor = !!(t.shape && t.shape.power && t.shape.power.rotor);
  if (rotor || /heli|rotor/.test(cls)) return fill(t, { escape: 'none', uniform: 'heli', why: 'heli' });
  if (cat === 'airliner' || /airliner|jumbo|transport/.test(cls)) return fill(t, { escape: 'none', uniform: 'captain' });
  if (t.military || /fighter|bomber|carrier/.test(cls)) return fill(t, { escape: 'seat', uniform: 'fighter' });
  const jet = !!(t.shape && t.shape.power && t.shape.power.kind === 'jet');
  return fill(t, jet ? { escape: 'seat', uniform: 'fighter' } : { escape: 'bail', uniform: 'casual' });
}

function fill(t, p) {
  const escape = p.escape || 'none';
  return {
    id: t.id || '',
    escape,
    crew: p.crew || 0,
    selfDestruct: !!p.selfDestruct,
    dragChute: !!p.dragChute,
    uniform: p.uniform || 'pilot',
    runaway: p.runaway != null ? !!p.runaway : escape === 'bail',
    noneWhy: escape === 'none' ? NONE_WHY[p.why || 'airliner'] : '',
  };
}

/** The ids of every listed type with a given flag, for the tests and the help card. */
export function listed(flag) {
  return Object.keys(BY_ID).filter((id) => !!fill({ id }, BY_ID[id])[flag]);
}

/** The pilot's outfit for an aeroplane: ../uniforms.js draws it. */
export function uniformIdFor(type) {
  return profileFor(type).uniform;
}
