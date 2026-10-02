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
 *                       little height for the parachute to open (`bailFrom`
 *                       metres). The helicopter too, from its side door, in
 *                       Free Flight only (`freeOnly`, see profileIn)
 *               'jump'  T-Pose Harrison: there is no seat and no door — he IS the
 *                       aeroplane — so he opens his own parachute where he is
 *               'none'  no way out in the air (airliners; the helicopter in a
 *                       mission) — and `noneWhy` says so kindly
 *   crew        how many OTHER people ride along with ejection seats of their
 *               own. They go first: "Crew out first — press again".
 *   selfDestruct  the special planes' guarded button (never on a person)
 *   dragChute   a landing drag chute that comes out only when YOU pull it
 *               (the Drag chute key, or CHUTE on a touch screen) — and only
 *               the goofy planes carry one: Air Massimo and T-Pose Harrison.
 *               The real military jets stop on their wheel brakes.
 *   uniform     what the pilot wears on foot (see ../uniforms.js)
 *   runaway     a small plane: get out with the power on and it goes without
 *               you (../runaway.js). Every light aeroplane that bails out,
 *               unless it says otherwise.
 *   ends        nothing is left flying when the pilot leaves (T-Pose Harrison:
 *               the man is the whole aeroplane). Out in the air, the flight
 *               simply ends — no empty aeroplane flies on and crashes — and on
 *               the ground he stands up where he was hovering.
 *
 * Anything not listed is read off its roster entry (class, category,
 * military), so an aeroplane another team adds tomorrow still gets a sensible
 * answer rather than an eject button that does nothing.
 *
 * Pure data and functions: no DOM, no THREE, so the node tests read it.
 */

/*
 * A helicopter, any helicopter: out of the side door with a parachute — in
 * Free Flight. A hover gives the canopy no airflow to open with, so it wants
 * more height than an aeroplane's door (100 m, not 60); the empty helicopter
 * does not fly on without you (no runaway). `freeOnly`: in a mission it is
 * the old answer — no way out, "land it, then press O".
 */
const HELI = { escape: 'bail', uniform: 'heli', why: 'heli', runaway: false, bailFrom: 100, freeOnly: true };

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
  // The helicopter: no seat (the rotor is in the way), but in Free Flight you
  // jump from the side door with a parachute, as people really do from
  // helicopters (missions keep 'none'; see HELI below).
  harrier: HELI,
  // Fast jets. No drag chutes on the real military jets (the owner: "only on
  // goofy planes") — they stop on their wheel brakes.
  vanguard: { escape: 'seat', uniform: 'fighter' },
  f22: { escape: 'seat', uniform: 'fighter', selfDestruct: true },
  f35b: { escape: 'seat', uniform: 'fighter', selfDestruct: true },
  fa18: { escape: 'seat', uniform: 'fighter' },
  // Two-seaters and multi-crew: the others go first.
  osprey: { escape: 'seat', uniform: 'fighter', crew: 1 },
  nightjar: { escape: 'seat', uniform: 'fighter', crew: 1, selfDestruct: true },
  // The specials — the goofy planes, and the only two with a drag chute.
  massimo: { escape: 'seat', uniform: 'racer', selfDestruct: true, dragChute: true },
  // A person, not a machine: no self-destruct, and nothing flies on without him.
  tpose: { escape: 'jump', uniform: 'harrison', dragChute: true, ends: true },
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
  if (rotor || /heli|rotor/.test(cls)) return fill(t, HELI);
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
    ends: !!p.ends,
    // Metres above the ground a door bail-out needs for the canopy to open.
    bailFrom: escape === 'bail' ? p.bailFrom || 60 : 0,
    freeOnly: !!p.freeOnly,
    noneWhy: escape === 'none' || p.freeOnly ? NONE_WHY[p.why || 'airliner'] : '',
  };
}

/**
 * The profile for a flight in a given mode ('free', 'mission', …): a
 * `freeOnly` way out (the helicopter's door) is Free Flight's alone, and
 * anywhere else it is the old answer — no way out, and the kind words.
 */
export function profileIn(type, mode) {
  const p = profileFor(type);
  return p.freeOnly && mode !== 'free' ? { ...p, escape: 'none', bailFrom: 0, runaway: false } : p;
}

/** The ids of every listed type with a given flag, for the tests and the help card. */
export function listed(flag) {
  return Object.keys(BY_ID).filter((id) => !!fill({ id }, BY_ID[id])[flag]);
}

/** The pilot's outfit for an aeroplane: ../uniforms.js draws it. */
export function uniformIdFor(type) {
  return profileFor(type).uniform;
}
