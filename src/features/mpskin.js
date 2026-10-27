/**
 * Your paint, on everybody else's screen.
 *
 * The hangar's paint picker used to be a private matter: a friend's 747 in the
 * Air Force One paint was, on every other screen, a red 747 (their PLAYER
 * colour, the one of eight a ten-year-old can tell apart across a sky) with a
 * red fin and no title (the skins sweep, finding 4). This sends the paint
 * along, so another player's aeroplane wears what its pilot chose, and
 * remotes.js draws it. The colour stays where it identifies somebody: the name
 * tag and the dot on the map; and an aeroplane in the factory colours is still
 * drawn in its player colour, as it always was.
 *
 * ON THE WIRE. One game event, 'skin:paint', through the channel every
 * feature uses (multiplayer/events.js), not a change to the snapshot: the
 * 15-a-second snapshot stays what PROTO 4 says it is, so a copy of the game
 * from before this existed talks to one from after it exactly as before. It
 * drops an event kind it has not heard of ("not a defined kind"), and carries
 * on drawing the red 747. The payload is versioned:
 *
 *     { v: 1, l: <livery id> }
 *
 *   v   this message's own version (PAINT_VERSION). A reader takes any
 *       version from 1 up and reads only `l`; a later version adds fields
 *       beside it, never reshapes it, and a reader that does not know one
 *       ignores it. (Bumping PROTO would lock every older copy out of every
 *       lobby, for a bit of paint.)
 *   l   the livery's id, one of this copy's own list (aircraft/liveries.js).
 *       Never a colour, a name or any free text: an id this copy does not have
 *       is dropped, so nothing anybody types, and nothing a modified tab
 *       makes up, reaches a screen.
 *
 * Sent when you start, when your paint changes, when somebody joins (so they
 * see yours straight away), and every few seconds besides: a lobby that
 * re-forms numbers everybody afresh, and the packet may be the one that was
 * lost. Fifteen bytes.
 *
 * PAINT PER PLANE (wave 18). Paint is saved per aeroplane type now
 * (settings.liveries, core/plane-paint.js) and `mine()` below sends the paint
 * of the aeroplane this tab is flying — a player flies one type at a time, so
 * the receiving side (remotes.js _ensureModel reads the paint by player) and
 * the wire are exactly what they were: `{ v: 1, l }`. An older copy that still
 * keeps one paint for all sends that one paint the same way, and is drawn in
 * it; switching aircraft changes `l`, which goes out at once.
 */

import { registerExtension } from '../game/extensions.js';
import { multiplayer } from './multiplayer.js';
import { LIVERIES } from '../aircraft/liveries.js';
import { currentLivery } from '../core/plane-paint.js';

const ch = multiplayer.events;

/** This message's own version: see the header. */
export const PAINT_VERSION = 1;
/** How often it is said again whatever has happened, seconds. */
export const RESEND_SECONDS = 4;

const KNOWN = new Set(LIVERIES.map((l) => l.id));

/** A paint off the wire, checked: `{ v, l }` with a livery this copy has, or null. */
export function cleanPaint(d) {
  if (!d || typeof d !== 'object') return null;
  const v = Number(d.v);
  if (!Number.isInteger(v) || v < 1 || v > 99) return null;
  if (typeof d.l !== 'string' || !KNOWN.has(d.l)) return null;
  return { v: PAINT_VERSION, l: d.l };
}

ch.define('skin:paint', { validate: cleanPaint, rate: 4 });

const S = { sent: null, at: -Infinity, sentCount: 0, heard: 0 };
const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

/** What this tab flies in, as an id this copy knows. */
function mine(sim) {
  const id = String(currentLivery(sim) || 'house');
  return KNOWN.has(id) ? id : 'house';
}

function say(sim, force = false) {
  if (!ch.active) return false;
  const id = mine(sim);
  const t = clock();
  if (!force && id === S.sent && t - S.at < RESEND_SECONDS) return false;
  if (ch.send('skin:paint', { v: PAINT_VERSION, l: id }) === false) return false;
  S.sent = id;
  S.at = t;
  S.sentCount++;
  return true;
}

ch.on('skin:paint', (d, from) => {
  const c = cleanPaint(d);
  if (!c || !from || from.me || from.id === ch.meId) return;
  S.heard++;
  multiplayer.remotes.setPaint(from.id, c.l);
});

// A new player is in, or a game just began: say it again straight away (the next frame).
ch.on('mp:join', () => {
  S.sent = null;
});
ch.on('mp:start', () => {
  S.sent = null;
});
ch.on('mp:host', () => {
  S.sent = null;
});

registerExtension({
  id: 'mpskin',
  update(sim) {
    say(sim);
  },
  stop() {
    S.sent = null;
  },
});

/** For the tests and the console. */
export const __test = { S, say, mine };
