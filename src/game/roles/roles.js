/**
 * Seats: on a few missions you can fly as somebody else in the same story.
 *
 * The owner asked for it in one line: "in some missions you can play as
 * another plane — like hijacking, you can be the lead fighter jet". So a
 * mission whose story already has a second aircraft in it carries a `roles`
 * list. The first entry is the seat everybody has always flown, and it is
 * the mission exactly as it was: picking it changes nothing. Every other
 * entry is a seat of its own — its own aeroplane, start, steps, score and
 * closing line — and the aircraft that are not you are flown by the game,
 * through the same story, so it still plays out.
 *
 *   roles: [
 *     { id: 'captain', base: true, actor: 'airliner', label: () => 'The 747 captain', line: '…' },
 *     { id: 'lead', actor: 'lead', label: 'The lead fighter', line: '…',
 *       aircraft, spawn, parTime, steps, onStart, failIf, score, onComplete,
 *       cast: { story: 'hijack-real-lead', actors: { airliner: {…}, wing: {…} } } },
 *   ]
 *
 * The `id` values are stable keys — saves use them now, and a game with
 * friends in it would use them on the wire later (see the co-op note in
 * src/game/roles/cast.js). `actor` names which aircraft in the story the
 * person in this seat flies.
 *
 * This file is pure: no DOM, no three.js, no game. main.js calls withRole()
 * once, when a mission starts; the chooser on the mission card calls
 * setRole(); the roles feature calls recordRole() when a seat is finished.
 */

/*
 * What a seat takes from the mission it belongs to, and nothing else.
 *
 * A whitelist rather than a prototype, on purpose. The base missions carry
 * flags that are about the base seat's own flying — `failOnCrash`, a brace
 * rule, the pizza car's "hold position" failIf, the Dev passcode gate, a
 * fuel figure for an air start — and a prototype would hand every one of
 * them to a fighter that never asked for it. A seat that wants the base's
 * gate says so (`baseGate: true`, below).
 */
export const BASE_FIELDS = Object.freeze(['id', 'name', 'category', 'game', 'icon', 'map', 'weather', 'difficulty', 'devOnly', 'military']);

/* Seat fields that describe the seat on the card, not the flight. */
const CARD_ONLY = new Set(['id', 'base', 'label', 'line']);

const CACHE = new WeakMap();

/** The seats a mission offers, default first; an empty list for a mission with only one. */
export function rolesOf(def) {
  return def && Array.isArray(def.roles) && def.roles.length > 1 ? def.roles : [];
}

/** The default seat's id ('captain'), or null. */
export function defaultRoleId(def) {
  const r = rolesOf(def);
  return r.length ? r[0].id : null;
}

/** A seat's name on the card. `label` may be a function, because "the 747 captain" depends on which airliners loaded. */
export function roleLabel(seat) {
  if (!seat) return '';
  const l = typeof seat.label === 'function' ? seat.label() : seat.label;
  return String(l || seat.id || '');
}

/**
 * The mission to fly for this seat.
 *
 * No seat, the default seat, or a seat the mission does not have: the
 * mission itself — the same object, so nothing anywhere can tell the
 * difference. Any other seat: a mission built from the whitelist above with
 * the seat on top, plus `roleId` and `baseId`. `id` stays the base id, so the
 * music, findMission, the records and runner.result.id all go on working.
 *
 * Built once per seat and kept, because main.js and the tests ask again on
 * every restart. Property descriptors are copied, not values: the base
 * missions use getters (`aircraft` is whichever long-haul jet the roster
 * has), and reading them here, at import, would fix the answer for ever.
 */
export function withRole(def, roleId) {
  if (!def || !roleId) return def;
  const seats = rolesOf(def);
  const seat = seats.find((r) => r && r.id === roleId);
  if (!seat || seat.base || seat === seats[0]) return def;
  let byDef = CACHE.get(def);
  if (!byDef) {
    byDef = new Map();
    CACHE.set(def, byDef);
  }
  if (byDef.has(roleId)) return byDef.get(roleId);

  const out = {};
  for (const k of BASE_FIELDS) {
    const d = Object.getOwnPropertyDescriptor(def, k);
    if (d) Object.defineProperty(out, k, { ...d, configurable: true });
  }
  const own = Object.getOwnPropertyDescriptors(seat);
  for (const k of Object.keys(own)) {
    if (CARD_ONLY.has(k)) continue;
    Object.defineProperty(out, k, { ...own[k], configurable: true });
  }
  Object.defineProperty(out, 'id', { value: def.id, enumerable: true, configurable: true });
  out.baseId = def.id;
  out.roleId = seat.id;
  out.roleLabel = roleLabel(seat);
  /*
   * The base mission's gate, composed on purpose rather than inherited. The
   * by-the-book hijack keeps its Dev passcode check in its failIf; the
   * fighter seat of the same mission wants that gate and nothing else.
   */
  if (seat.baseGate && typeof def.failIf === 'function') {
    const gate = def.failIf;
    const mine = typeof seat.failIf === 'function' ? seat.failIf : null;
    out.failIf = (ctx) => gate(ctx) || (mine ? mine(ctx) : null);
  }
  byDef.set(roleId, out);
  return out;
}

/* ------------------------------------------------------------------ *
 * Which seat is picked.
 *
 * In memory, and only for this session: a reload puts every mission back
 * on its default seat, so the default really is the default and nobody
 * opens the game to find themselves somewhere they did not choose.
 * ------------------------------------------------------------------ */

const CHOSEN = new Map();

export function currentRole(missionId) {
  return CHOSEN.get(missionId) || null;
}

export function setRole(missionId, roleId) {
  if (!missionId) return;
  if (!roleId) CHOSEN.delete(missionId);
  else CHOSEN.set(missionId, String(roleId));
}

/** For the tests: every mission back on its default seat. */
export function clearRoles() {
  CHOSEN.clear();
}

/* ------------------------------------------------------------------ *
 * Records, per seat.
 *
 * Kept under progress.roles[missionId][seatId], NOT as keys in
 * progress.missions: the front page counts Object.values(progress.missions)
 * for its "done / total", and a seat counted as a mission would push that
 * past the total. progress.missions[id] stays "best in any seat", so the
 * card's tick means "flown, in some seat"; the chooser shows each seat's own.
 * ------------------------------------------------------------------ */

export function recordRole(progress, missionId, roleId, { score = 0, time = 0 } = {}) {
  if (!progress || !missionId || !roleId) return progress;
  if (!progress.roles || typeof progress.roles !== 'object') progress.roles = {};
  const byMission = progress.roles[missionId] && typeof progress.roles[missionId] === 'object' ? progress.roles[missionId] : (progress.roles[missionId] = {});
  const prev = byMission[roleId] || { complete: false, bestScore: 0, bestTime: null };
  byMission[roleId] = {
    complete: true,
    bestScore: Math.max(prev.bestScore || 0, Math.round(score) || 0),
    bestTime: prev.bestTime == null ? time : Math.min(prev.bestTime, time),
  };
  return progress;
}

/**
 * A seat's own record, or null. The default seat falls back on the
 * mission's record when no seat has ever been recorded — that is a player
 * who finished it before there were seats, and it was the default they flew.
 */
export function roleRecord(progress, def, roleId) {
  if (!progress || !def) return null;
  const mine = progress.roles && progress.roles[def.id];
  if (mine && mine[roleId]) return mine[roleId];
  if (roleId === defaultRoleId(def) && !mine && progress.missions && progress.missions[def.id]) {
    return progress.missions[def.id];
  }
  return null;
}
