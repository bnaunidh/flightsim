/**
 * Which aircraft each mission is flown in (the owner, 2026-10-25: "missions
 * must use fitting specialized aircraft").
 *
 * Every flight and helicopter mission is listed here with the types it
 * accepts, the recommended one FIRST, and a line saying why — the audit
 * itself, kept where it is used. The boat's and the car's missions are not
 * aircraft and are not listed.
 *
 * The rules the owner gave, and where they land:
 *   Class-D transfer        the C-17: the Class-D and their guards walk up the
 *                           rear ramp (features/scp-site.js); the ice strip is
 *                           fine for it
 *   cargo                   a freighter (Dreamlifter, C-5, BelugaXL) — no
 *                           mission here carries cargo yet; Mango Cay's crate
 *                           is a light aeroplane's supply drop (below)
 *   VIP                     Air Force One (the 747 in its colours) for the
 *                           president; Marine One where a VIP flies by
 *                           helicopter — no mission does yet
 *   rescue                  the AW139 (the rescue twin with the hoist), or the
 *                           UH-60; on the mountain (Last Light) the H145, as
 *                           mountain rescue flies it
 *   medevac                 the H145, the air ambulance
 *   airdrop / paratroops    the C-17 — no mission drops paratroops yet
 *   seaplane                a floatplane — the game has none, and no mission
 *                           lands on water
 *   firefighting            the water bomber: the Tempest scoops the sea; the
 *                           helicopters' fires are bucket work, in the
 *                           Skyhook the bucket missions are written round
 *
 * Choosing: a mission is flown in the recommended type, unless the aircraft
 * you asked for — or the one you are already in, picked in the hangar — is
 * one it accepts (pickMissionAircraft). A seat on a mission with roles
 * (game/roles) brings its own aeroplane and is left alone. The mission card
 * and the briefing say which (recommendedLine).
 */

/**
 * id -> { fly: [recommended, ...also accepted], why }.
 * Ids are the missions' own; tests/features/mission-aircraft.mjs holds this
 * table to MISSIONS (every flight and heli mission listed, every type real).
 */
export const MISSION_AIRCRAFT = {
  // Training: written for the trainer, its numbers in the words ("pull back at 55 knots").
  circuit: { fly: ['skylark'], why: 'The trainer the lesson is written for: its speeds are in the instructions.' },
  delivery: { fly: ['skylark'], why: 'A light aeroplane\'s supply drop to a village strip, low and slow over the ring.' },
  storm: { fly: ['skylark'], why: 'A light aeroplane in a crosswind: the lesson is the drift, at the trainer\'s speeds.' },
  deadstick: { fly: ['skylark'], why: 'The glide numbers (65 knots, 7.9 to 1) are the trainer\'s.' },
  // Night Medevac: the patient is picked up off a pad on a small island at night — the air ambulance's job.
  medevac: { fly: ['h145', 'aw139'], why: 'An air ambulance: the H145 lands on the pad beside the patient.' },
  // Tornado research: the aeroplane built to be flown into weather.
  chaser: { fly: ['tempest'], why: 'The weather-research twin with the reinforced spar, built to be flown into storms.' },
  emberrun: { fly: ['vanguard'], why: 'A fast jet\'s time trial round the volcano.' },
  carrierqual: { fly: ['osprey'], why: 'The carrier aeroplane: the hook, the big flaps and the strong legs.' },
  patrol: { fly: ['nightjar'], why: 'Long range and a long loiter over the island.' },
  recon: { fly: ['nightjar'], why: 'The flying wing: quiet, low and hard to see at night.' },
  range: { fly: ['nightjar'], why: 'A bomber on a practice range, with an inert store.' },
  tail: { fly: ['vanguard'], why: 'A fast jet with an enemy one behind it.' },

  // The helicopter's missions. The first is the hover lesson; the rest are rescues and medevacs.
  firstlight: { fly: ['harrier'], why: 'The first hover, in the easy-going trainer helicopter.' },
  covepickup: { fly: ['h145'], why: 'A walker with a broken ankle taken to hospital: the air ambulance.' },
  overboard: { fly: ['aw139', 'uh60'], why: 'A winch rescue at sea: the rescue twin with the hoist over the door.' },
  stackrescue: { fly: ['aw139', 'uh60'], why: 'A winch rescue off a sea stack, in wind: the rescue twin.' },
  nightdeck: { fly: ['aw139'], why: 'A night casualty off an offshore deck: the twin built to reach the rigs.' },
  // Mountain rescue: the light twin the Alpine rescue services fly. The AW139 is accepted too; flown the way the
  // steps say (tests/features/heli-missions.browser.js), it went into Raven Crag's wall three runs in three, the H145 not.
  lastlight: { fly: ['h145', 'aw139'], why: 'Two mountain rescues before dark: the H145, the light twin mountain rescue flies.' },
  oncall: { fly: ['aw139', 'h145', 'uh60'], why: 'On call for rescues round the city: the rescue twin (or the air ambulance).' },

  // Fire: the scooper and the bucket.
  'fire-spot': { fly: ['tempest'], why: 'The water bomber: it skims the sea to fill its tank.' },
  'fire-town': { fly: ['tempest'], why: 'The water bomber.' },
  'fire-bigburn': { fly: ['tempest'], why: 'The water bomber, several fills.' },
  'fire-night': { fly: ['tempest'], why: 'The water bomber, in the dark.' },
  'fire-bucket': { fly: ['harrier'], why: 'Bucket work: the Skyhook with a bucket on a line.' },
  'fire-heli-town': { fly: ['harrier'], why: 'Bucket work.' },
  'fire-ridge': { fly: ['harrier'], why: 'Bucket work on the ridge.' },
  'fire-heli-night': { fly: ['harrier'], why: 'Bucket work, at night.' },
  'fire-lineone': { fly: ['harrier'], why: 'Bucket work along the crews\' line.' },

  // Meteor mode: challenges, flown in what each one was built round.
  'meteor-shower': { fly: ['osprey'], why: 'Slow and steady among the falling stars.' },
  'meteor-dodge': { fly: ['courier'], why: 'Quick and nimble enough to dodge.' },
  'meteor-town': { fly: ['osprey'], why: 'Slow enough to line up a shot.' },
  'meteor-photo': { fly: ['tempest'], why: 'The research aeroplane with the camera.' },

  // Emergencies. The hijack's airliner is whichever long-haul jet the roster has (its own getter: `own`).
  'event-hijack': { own: true, why: 'A long-haul airliner, full of passengers.' },
  'event-hijack-real': { own: true, why: 'A long-haul airliner, full of passengers.' },
  'afo-normal': { fly: ['b747'], why: 'Air Force One: the president\'s 747.' },
  'afo-attack': { fly: ['b747'], why: 'Air Force One: the president\'s 747.' },
  'classd-transfer': { fly: ['c17'], why: 'The C-17: the Class-D and their guards walk up the rear ramp.' },
};

function entryOf(def) {
  if (!def || def.roleId) return null;
  return MISSION_AIRCRAFT[def.id] || null;
}

/**
 * The types a mission accepts, recommended first. A seat with roles, or a
 * mission that is not listed: the one it names, or none (it has no opinion).
 */
export function allowedFor(def) {
  if (!def) return [];
  const e = entryOf(def);
  if (e && Array.isArray(e.fly) && e.fly.length) return e.fly;
  return def.aircraft ? [def.aircraft] : [];
}

/** The recommended type's id, or null. */
export function recommendedFor(def) {
  return allowedFor(def)[0] || null;
}

/** Why that one (the audit's line), or ''. */
export function whyFor(def) {
  const e = entryOf(def);
  return (e && e.why) || '';
}

/**
 * The type to fly the mission in: the one asked for if the mission takes it,
 * else the one you are in if it takes that, else the recommended one. null
 * when the mission has no opinion (then the caller's own order stands).
 */
export function pickMissionAircraft(def, { asked = null, current = null } = {}) {
  const allowed = allowedFor(def);
  if (!allowed.length) return null;
  if (asked && allowed.includes(asked)) return asked;
  if (current && allowed.includes(current)) return current;
  return allowed[0];
}

/**
 * "Recommended aircraft: AW139 Rescue · also UH-60 Black Hawk", from a
 * name lookup (id -> name). '' for a mission with no aircraft.
 */
export function recommendedLine(def, nameOf = (id) => id) {
  const allowed = allowedFor(def);
  if (!allowed.length) return '';
  const names = allowed.map((id) => nameOf(id) || id);
  const also = names.slice(1);
  return `Recommended aircraft: ${names[0]}${also.length ? ` · also ${also.join(' or ')}` : ''}`;
}

/**
 * Put the recommended type on each listed mission as its `aircraft`, the
 * field everything else (the start, the category, the pay) already reads —
 * but not over a getter (the hijack's), and not on a mission that is not
 * listed. Called once by missions.js.
 */
export function applyMissionAircraft(list) {
  for (const m of list || []) {
    const e = MISSION_AIRCRAFT[m && m.id];
    if (!e || e.own || !Array.isArray(e.fly) || !e.fly.length) continue;
    const d = Object.getOwnPropertyDescriptor(m, 'aircraft');
    if (d && (d.get || d.set)) continue;
    m.aircraft = e.fly[0];
  }
  return list;
}
