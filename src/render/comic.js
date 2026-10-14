/**
 * Comic effects — Settings → Graphics, OFF by default.
 *
 * The owner: "remove the comic stuff, put it in settings and default off".
 * "Comic" is everything that draws the game as a cartoon instead of as a
 * flight sim: the comic words that pop up over a hit or a tag (BONK!, POOF!,
 * POW!), the big yellow cards, the stars that circle a crashed aeroplane's
 * head, the cartoon crashes that bounce and cartwheel and wobble and tell a
 * joke, the cartoon cloud in place of the fireball, the starburst on the
 * minimap, the cartoon bomb whistle, and the "bonk" wording of the meteor
 * missions.
 *
 * Switched OFF (the default, for a save that predates it too), each of those
 * is replaced by something calm: plain HUD text ("Tagged out", "Mid-air
 * collision"), the break-up and the wreck of the crash physics instead of a
 * choreographed cartoon, a small cross on the map. Switched ON, every one of
 * them is exactly what it was before.
 *
 * Nothing here imports anything: the switch is a plain object that the game
 * sets from the saved setting (main.js), and every effect reads it as it
 * draws, so turning it on or off takes effect on the next thing that
 * happens. It is a LOCAL choice: in multiplayer each player sees the game the
 * way their own setting says, and nothing about it travels on the wire.
 *
 * Reduce flashing (./flash-safety.js) is separate and still applies to every
 * flash either way.
 */

export const COMIC = {
  /** The setting. False unless the player has switched it on. */
  on: false,
};

/** Set it from the saved setting; only a real `true` turns it on. Returns the new state. */
export function setComicEffects(on) {
  COMIC.on = on === true;
  // The interface's own cartoon styling (CSS) keys off a class on the page.
  if (typeof document !== 'undefined' && document.documentElement && document.documentElement.classList) {
    document.documentElement.classList.toggle('comic-effects', COMIC.on);
  }
  return COMIC.on;
}

export const comicOn = () => COMIC.on;

/** One line of wording: the comic one, or the plain one. */
export const pick = (comic, plain) => (COMIC.on ? comic : plain);

/**
 * The plain text for each comic word, for a screen that asks for the comic
 * one (a card in the middle of the screen). Anything else comes back as it
 * was — "GO!" and a count of 3, 2, 1 are signals, not comic words.
 */
export const PLAIN_WORDS = {
  'BONK!': 'Mid-air collision',
  'TAGGED!': 'Tagged out',
  'POOF!': 'Tagged out',
  'BACK IN!': 'Back in the game',
  'POW!': 'Hit',
  'SPLAT!': 'Hit',
  'ZAP!': 'Hit',
  'MISSILE HIT!': 'Missile hit',
  // The owner's and the admins' trolls (features/owner/): the move stays, the comic word is a plain one.
  'YEET!': 'Launched',
  'WHOOSH': 'Teleported',
  'HI 👋': 'Visitor',
};

export function plainWord(word) {
  return Object.prototype.hasOwnProperty.call(PLAIN_WORDS, word) ? PLAIN_WORDS[word] : word;
}

/** The wording to put on screen for a comic word: itself with Comic effects on, its plain text with them off. */
export function wordFor(word) {
  return COMIC.on ? word : plainWord(word);
}
