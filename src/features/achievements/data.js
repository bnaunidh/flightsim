/**
 * The achievement catalogue.
 *
 * What is SHOWN — a name, a one-line how-to, an icon glyph, hidden or not,
 * and which group it sits under on the Achievements page — and, for the ones
 * with a progress bar, what they count towards and out of how many. Deciding
 * WHEN one unlocks is rules.js; nothing here fires anything, so adding an
 * achievement to this list never touches the logic that checks it (and
 * forgetting to check it is exactly what tests/features/achievements.mjs's
 * "every id in the catalogue has a rule that can unlock it" guards against).
 *
 * Replaces the sticker book (fun.js, before v57), which paid for smoke
 * colours with points from a star hunt and a stunt meter — all three gone,
 * see git history. These are not currency: nothing here is spent.
 */

import { UNLOCKS } from '../../game/progression.js';
import { MAPS } from '../../world/maps.js';

/**
 * Free from the first flight — progression.js's own private FREE list,
 * mirrored here for display only (it is not exported; this is the same three
 * ids, and the node test checks it against the live hangar economy via
 * UNLOCKS + FREE_AIRCRAFT.length matching what the game actually sells).
 */
export const FREE_AIRCRAFT = ['skylark', 'courier', 'harrier'];

/** Every aeroplane that can be landed and counted — free or bought, military included. */
export const ALL_LANDABLE_AIRCRAFT = [...FREE_AIRCRAFT, ...UNLOCKS.map((u) => u.aircraft)];

/** Every map in the game, read live off world/maps.js so a new map raises the target on its own. */
export const ALL_MAP_IDS = MAPS.map((m) => m.id);

export const CATEGORY_LABELS = {
  training: 'Training',
  airline: 'Passengers & cargo',
  delivery: 'Deliveries',
  rescue: 'Rescue',
  fire: 'Firefighting',
  challenge: 'Challenges',
  events: 'Emergencies',
  meteor: 'Meteor mode',
  military: 'Military',
};

function categoryAchievement(id, name, how, hidden = false, tier = 'bronze') {
  return { id: `cat-${id}`, name, how, glyph: 'medal', group: 'missions', hidden, tier };
}

export const ACHIEVEMENTS = [
  /* ---- Flying --------------------------------------------------------- */
  { id: 'first-takeoff', name: 'Wheels Up', how: 'Take off for the first time.', glyph: 'wing', group: 'flying', tier: 'bronze' },
  { id: 'butter-landing', name: 'Butter', how: 'Land at under 60 ft/min — the smoothest kind of landing.', glyph: 'feather', group: 'flying', tier: 'silver' },
  { id: 'crosswind-landing', name: 'Crab Walk', how: 'Land safely on the runway in a strong crosswind.', glyph: 'windsock', group: 'flying', tier: 'silver' },
  { id: 'every-plane', name: 'Hangar Full', how: 'Land every aeroplane you can unlock.', glyph: 'hangar', group: 'flying', tier: 'gold', progress: { key: 'planes', target: ALL_LANDABLE_AIRCRAFT.length } },
  { id: 'every-map', name: 'Island Hopper', how: 'Land on every map in the game.', glyph: 'globe', group: 'flying', tier: 'gold', progress: { key: 'maps', target: ALL_MAP_IDS.length } },
  { id: 'carrier-trap', name: 'Trapped', how: 'Catch the wire on a carrier landing.', glyph: 'anchor', group: 'flying', tier: 'silver' },
  { id: 'night-landing', name: 'Night Owl', how: 'Land safely at night.', glyph: 'moon', group: 'flying', tier: 'bronze' },
  { id: 'storm-landing', name: 'Through the Weather', how: 'Land safely in strong wind or rain.', glyph: 'cloud', group: 'flying', tier: 'silver' },
  // The owner, 2026-10-04: "if you hit the max of the sky, 70,000 feet you
  // get the achievement: The Sky's the Limit". Exact name, exact how-to line.
  { id: 'sky-limit', name: "The Sky's the Limit", how: 'Reach the top of the sky: 70,000 ft.', glyph: 'star', group: 'flying', tier: 'gold' },

  /* ---- Missions -------------------------------------------------------- */
  categoryAchievement('training', 'Learner', 'Finish a Training mission.', false, 'bronze'),
  categoryAchievement('airline', 'Cabin Crew Cleared', 'Finish a Passengers & cargo mission.', false, 'bronze'),
  categoryAchievement('delivery', 'Signed For', 'Finish a Delivery mission.', false, 'bronze'),
  categoryAchievement('rescue', 'On Scene', 'Finish a Rescue mission.', false, 'bronze'),
  categoryAchievement('fire', 'Fire Out', 'Finish a Firefighting mission.', false, 'bronze'),
  categoryAchievement('challenge', 'Against the Clock', 'Finish a Challenge mission.', false, 'silver'),
  categoryAchievement('events', 'Stayed Calm', 'Finish an Emergencies mission.', false, 'silver'),
  categoryAchievement('meteor', 'Rock Dodger', 'Finish a Meteor Mode run.', false, 'silver'),
  categoryAchievement('military', 'Cleared Hot', 'Finish a Military mission.', true, 'gold'),
  { id: 'gold-medal', name: 'Gold Medal', how: 'Score 90 or more on any mission.', glyph: 'medal', group: 'missions', tier: 'silver' },
  { id: 'five-golds', name: 'Golden Run', how: 'Score gold on five different missions.', glyph: 'medal', group: 'missions', tier: 'gold', progress: { key: 'golds', target: 5 } },

  /* ---- The other games --------------------------------------------------*/
  { id: 'heli-first', name: 'Rotors Up', how: 'Fly the helicopter for the first time.', glyph: 'rotor', group: 'games', tier: 'bronze' },
  { id: 'boat-first', name: 'Casting Off', how: 'Take the boat out for the first time.', glyph: 'boat', group: 'games', tier: 'bronze' },
  { id: 'car-first', name: 'Key in the Ignition', how: 'Drive the car for the first time.', glyph: 'car', group: 'games', tier: 'bronze' },
  { id: 'rocket-first', name: 'Three, Two, One', how: 'Launch the rocket for the first time.', glyph: 'rocket', group: 'games', tier: 'bronze' },

  /* ---- Multiplayer ------------------------------------------------------*/
  { id: 'race-win', name: 'Chequered Flag', how: 'Win a multiplayer race.', glyph: 'flag', group: 'multiplayer', tier: 'silver' },
  { id: 'squadron', name: 'Squadron', how: 'Fly online with three friends at once.', glyph: 'formation', group: 'multiplayer', tier: 'gold' },

  /* ---- Air Force One -----------------------------------------------------*/
  { id: 'afo-captain', name: 'Commander in Chief', how: 'Land Air Force One safely as Captain.', glyph: 'seal', group: 'afo', tier: 'gold' },
  { id: 'afo-secure', name: 'To the Secure Room', how: 'As the President, reach the secure room safely.', glyph: 'shield', group: 'afo', hidden: true, tier: 'gold' },

  /* ---- Massimo & T-Pose Harrison (kept, a few fun ones) -------------------*/
  { id: 'massimo-fast', name: 'Mach Massimo', how: 'Take off in Air Massimo at full tilt.', glyph: 'bolt', group: 'fun', hidden: true, tier: 'silver' },
  { id: 'tpose-up', name: 'Floats Like Harrison', how: 'Take off as T-Pose Harrison.', glyph: 'star', group: 'fun', hidden: true, tier: 'silver' },

  /* ---- Milestones ---------------------------------------------------------*/
  { id: 'rank-pilot', name: 'Pilot', how: 'Reach the rank of Pilot.', glyph: 'seal', group: 'progress', tier: 'bronze' },
  { id: 'rank-captain', name: 'Captain', how: 'Reach the rank of Captain.', glyph: 'seal', group: 'progress', tier: 'silver' },
  { id: 'ten-flights', name: 'Frequent Flyer', how: 'Complete ten flights.', glyph: 'ticket', group: 'progress', tier: 'bronze', progress: { key: 'flights', target: 10 } },
  { id: 'full-house', name: 'Full House', how: 'Unlock every other achievement.', glyph: 'trophy', group: 'progress', hidden: true, tier: 'platinum' },
];

export const ACHIEVEMENTS_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
