/**
 * The achievement rules: pure logic, no DOM, no game object — a store
 * (store.js's shape) and one already-happened event in, the ids it newly
 * unlocked out. index.js is the only caller in the real game; the node test
 * (tests/features/achievements.mjs) calls this directly with made-up events.
 *
 * Kept pure on purpose: a rule that reached into `sim` would need a fake sim
 * to test, and the fake would drift from the real one exactly where a test
 * is supposed to catch that it has. Everything a rule needs travels in on
 * the event's payload, read off the hook that was already there (main.js's
 * touchdown/liftoff/arrested/mission-complete, game/extensions.js's own
 * startMode) — see index.js for where each payload comes from.
 */

import { ACHIEVEMENTS, ALL_LANDABLE_AIRCRAFT, ALL_MAP_IDS } from './data.js';

const GOLD_SCORE = 90;
const FIVE_GOLDS = 5;
const TEN_FLIGHTS = 10;
const SQUADRON_SIZE = 3;

const RANK_ORDER = ['cadet', 'pilot', 'senior', 'captain', 'instructor', 'top', 'mod', 'admin', 'founder'];
const ALL_IDS_EXCEPT_FULL_HOUSE = ACHIEVEMENTS.map((a) => a.id).filter((id) => id !== 'full-house');

function unlock(store, id, out) {
  if (!id || store.unlocked[id]) return;
  store.unlocked[id] = new Date().toISOString();
  out.push(id);
}

function addOnce(list, id) {
  if (id && !list.includes(id)) list.push(id);
}

function checkFullHouse(store, out) {
  if (store.unlocked['full-house']) return;
  if (ALL_IDS_EXCEPT_FULL_HOUSE.every((id) => store.unlocked[id])) unlock(store, 'full-house', out);
}

/**
 * One event in, the ids it newly unlocked out (empty if none). Mutates
 * `store` in place — the caller saves it; this never touches storage itself.
 *
 * Event types, and the payload each expects:
 *   liftoff          { aircraft, speedKts }
 *   touchdown        { vsFpm, onRunway, aircraft, map, crosswindKts, night, stormy }
 *                     (the caller never sends a crashed landing here at all)
 *   arrested         {}                          — the carrier's wire
 *   ceiling          {}                          — 70,000 ft, physics.js's own event
 *   missionComplete  { category, score, crashed, afo }   afo: 'captain' | 'president' | null
 *   startMode        { game }                    game: 'heli' | 'boat' | 'car'
 *   rocketStart      {}
 *   raceWin          {}
 *   friends          { count }
 *   rank             { rank }                    one of progression.js's RANKS ids
 */
export function applyEvent(store, type, payload = {}) {
  const out = [];
  switch (type) {
    case 'liftoff': {
      unlock(store, 'first-takeoff', out);
      if (payload.aircraft === 'tpose') unlock(store, 'tpose-up', out);
      if (payload.aircraft === 'massimo' && Number(payload.speedKts) >= 140) unlock(store, 'massimo-fast', out);
      break;
    }

    case 'touchdown': {
      if (payload.crashed) break;
      if (Math.abs(Number(payload.vsFpm) || 0) < 60) unlock(store, 'butter-landing', out);
      if (payload.onRunway && Number(payload.crosswindKts) >= 12) unlock(store, 'crosswind-landing', out);
      if (payload.night) unlock(store, 'night-landing', out);
      if (payload.stormy) unlock(store, 'storm-landing', out);
      if (payload.aircraft) {
        addOnce(store.counts.planes, payload.aircraft);
        if (ALL_LANDABLE_AIRCRAFT.length && ALL_LANDABLE_AIRCRAFT.every((id) => store.counts.planes.includes(id))) {
          unlock(store, 'every-plane', out);
        }
      }
      if (payload.map) {
        addOnce(store.counts.maps, payload.map);
        if (ALL_MAP_IDS.length && ALL_MAP_IDS.every((id) => store.counts.maps.includes(id))) {
          unlock(store, 'every-map', out);
        }
      }
      break;
    }

    case 'arrested':
      unlock(store, 'carrier-trap', out);
      break;

    case 'ceiling':
      unlock(store, 'sky-limit', out);
      break;

    case 'missionComplete': {
      if (payload.crashed) break;
      if (payload.category) unlock(store, `cat-${payload.category}`, out);
      if (Number(payload.score) >= GOLD_SCORE) {
        unlock(store, 'gold-medal', out);
        store.counts.golds = (store.counts.golds || 0) + 1;
        if (store.counts.golds >= FIVE_GOLDS) unlock(store, 'five-golds', out);
      }
      if (payload.afo === 'captain') unlock(store, 'afo-captain', out);
      else if (payload.afo === 'president') unlock(store, 'afo-secure', out);
      store.counts.flights = (store.counts.flights || 0) + 1;
      if (store.counts.flights >= TEN_FLIGHTS) unlock(store, 'ten-flights', out);
      break;
    }

    case 'startMode': {
      if (payload.game === 'heli') unlock(store, 'heli-first', out);
      else if (payload.game === 'boat') unlock(store, 'boat-first', out);
      else if (payload.game === 'car') unlock(store, 'car-first', out);
      break;
    }

    case 'rocketStart':
      unlock(store, 'rocket-first', out);
      break;

    case 'raceWin':
      unlock(store, 'race-win', out);
      break;

    case 'friends':
      if (Number(payload.count) >= SQUADRON_SIZE) unlock(store, 'squadron', out);
      break;

    case 'rank': {
      const i = RANK_ORDER.indexOf(payload.rank);
      if (i >= 0) {
        if (i >= RANK_ORDER.indexOf('pilot')) unlock(store, 'rank-pilot', out);
        if (i >= RANK_ORDER.indexOf('captain')) unlock(store, 'rank-captain', out);
      }
      break;
    }

    default:
      break;
  }
  checkFullHouse(store, out);
  return out;
}
