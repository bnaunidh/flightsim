/**
 * Which copy of the game this is.
 *
 * The same files are published to two sites (.claude/devtools/deploy.sh):
 * bnaunidh.github.io/flightsim and thankdapro.github.io/flightsim. The owner
 * asked for two of the aeroplanes — T-Pose Harrison and Air Massimo, the two
 * meme ones — to be gone from the thankdapro copy ("remove tpose harrison and
 * air massimo from thankdapro.github"), and for everything else, on both
 * sites and on a developer's localhost, to stay exactly as it is.
 *
 * So the code files still ship to both; this module only says which ids the
 * player must never meet on this copy, and the roster (aircraft/types.js),
 * the shop (game/progression.js), the achievements, the traffic, the keys and
 * the owner's tools all ask it. One answer, read once when the page loads.
 *
 * ?edition=thankdapro in the address turns the thankdapro edition on anywhere
 * (for testing it on localhost). Nothing turns it OFF on thankdapro.
 *
 * Safe in node: with no `location` the edition is the full one and nothing is
 * hidden, so every node test sees the whole fleet unless it asks otherwise.
 */

/** The ids the thankdapro copy does without. */
export const THANKDAPRO_HIDDEN = Object.freeze(['tpose', 'massimo']);

/**
 * Who flies in their place when somebody on the other site does (a remote
 * player in multiplayer): the quickest of the real jets, the nearest thing
 * to a record racer that this copy still has.
 */
export const STAND_IN = 'f22';

/** 'thankdapro' or 'full' for a location-like { hostname, search }. */
export function editionOf(loc) {
  let host = '';
  let search = '';
  try {
    host = loc && typeof loc.hostname === 'string' ? loc.hostname.toLowerCase() : '';
    search = loc && typeof loc.search === 'string' ? loc.search : '';
  } catch (e) {
    host = '';
  }
  if (host.startsWith('thankdapro')) return 'thankdapro';
  try {
    if (search && typeof URLSearchParams === 'function' && new URLSearchParams(search).get('edition') === 'thankdapro') return 'thankdapro';
  } catch (e) {
    /* a malformed query is the full edition */
  }
  return 'full';
}

/** The ids hidden on that location, as a frozen Set (empty for the full edition). */
export function hiddenAircraftFor(loc) {
  return Object.freeze(new Set(editionOf(loc) === 'thankdapro' ? THANKDAPRO_HIDDEN : []));
}

function here() {
  try {
    return typeof globalThis !== 'undefined' ? globalThis.location : undefined;
  } catch (e) {
    return undefined;
  }
}

/** This page's edition. */
export const EDITION = editionOf(here());

/** The aircraft this page never shows. Read once, at load. */
export const HIDDEN_AIRCRAFT = hiddenAircraftFor(here());

/** Is this aircraft id hidden on this copy? */
export function isHiddenAircraft(id) {
  return HIDDEN_AIRCRAFT.has(id);
}

/** `id`, unless this copy hides it — then `fallback` (a stale saved pick). */
export function visibleAircraftId(id, fallback = 'skylark') {
  return id && HIDDEN_AIRCRAFT.has(id) ? fallback : id;
}
