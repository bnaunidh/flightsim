/**
 * Which games the menus offer — the one switch for the class demo.
 *
 * The game has four ways to be in its world (and a fifth, the rocket, plugged
 * in by a feature): the aeroplane, the helicopter, the boat and the car. For
 * the class demo (Nov 2-10, 2026) only the aeroplane and the helicopter are
 * offered: fewer doors is fewer things to go wrong in front of a room, and the
 * other two are the ones still being finished. Nothing is deleted — the boat,
 * the car and the rocket all still run (sim.startDrive, sim.switchGame, the
 * self-tests) — they are just not on the bar, the More screen or the hangar.
 *
 * Flip HIDE_EXTRA_GAMES to false and every door comes back. One place; the
 * three screens and the rocket's own menu hook all ask gameShown().
 */
export const HIDE_EXTRA_GAMES = true;

/** The games offered while the extras are hidden: the aeroplane and the helicopter. */
export const DEMO_GAMES = Object.freeze(['flight', 'heli']);

/** Should a game with this id be offered in the menus? */
export function gameShown(id) {
  return !HIDE_EXTRA_GAMES || DEMO_GAMES.includes(id);
}

/** The ids in a list of game entries ({ id } or { drive }) that are offered. */
export function shownGames(list) {
  return list.filter((g) => gameShown(g.id != null ? g.id : g.drive));
}
