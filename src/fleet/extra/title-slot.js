/**
 * Where an airliner's name goes, measured off the aeroplane.
 *
 * The owner, on the first placing: the name ran back behind the wing and the
 * engine cut it off. The coordinator, on the second: clean, but a tiny tag on a
 * big hull. Real titles are big: a quarter of the fuselage or so, tall against the
 * crown, starting behind the first door and running on back OVER the wing root,
 * because they sit in the band above the windows and the wing sits below it. So
 * the room is worked out for each type from its own doors, windows, wing and
 * engines, and the name is sized to fill it:
 *
 *   ahead    the first door's back edge, and a margin for its hinge and handle
 *   behind   the first point where the near wing, or a nacelle, rises as high as
 *            the band from a chase camera a little above the aeroplane (a rear
 *            three-quarter view may cross the last letters: so it does on a real
 *            one). If a turboprop's nacelles leave no room, the name goes aft of them
 *   under    the top of the window row. A door in the way only tucks its top
 *            frame under the letters: its window and handle stay clear
 *   over     the crown's shoulder, or the sills of a deck above
 *
 * The name never fills more than `MAX_SHARE` of the body's length, so an A380
 * does not wear a banner; and it comes down as one drawing: never squeezed.
 * Pure numbers: no THREE, no canvas.
 */

/** The longest a name may be, as a share of the body's length. */
export const MAX_SHARE = 0.3;
/** The tallest a passenger name may be, in body heights. */
const CAP_SHARE = 0.28;
/** A freighter's name has the side to itself. */
const FREIGHT_CAP = 0.36;
/** How far a door's top frame may tuck under the letters, in body heights: above its window and handle. */
export const DOOR_TUCK = 0.04;
/** A side-on chase camera 6 degrees above the aeroplane: how far things rise per metre towards it. */
export const CHASE_RISE = 0.105;

/**
 * q: { doors, windows, wing, engines, top(z), bot(z), z0, z1, root, after, crown, stop }.
 * (root, after, crown, stop: a downloaded airframe's wing root, nacelle tail, crown, and the station its
 * wing rises to the band, where they differ.)
 * doors [{ z, y, w, h, deck }], windows [{ y, ht, deck }], the wing and engines
 * as an aeroplane's config has them. Returns the room, for titleSlot.
 */
export function titleRoom(q) {
  const { doors, windows, wing, engines, top, bot, z0, z1, root = Infinity, after = -Infinity, crown = Infinity, stop: limit = Infinity } = q;
  const L = z1 - z0;
  const margin = 0.012 * L + 0.12;
  const main = doors.filter((d) => d.deck !== 'upper');
  const first = main.reduce((a, d) => (d.z < a.z ? d : a), main[0] || { z: z0 + 0.14 * L, w: 0.8 });
  const zA = first.z + first.w / 2 + margin * 1.4;
  // (a downloaded airframe's wing can start further forward than the game's own: `root` is the nearer of the two)
  const rootZ = wing ? Math.min(wing.rootZ, root) : z1;
  const probe = (zA + rootZ) / 2;
  // (a downloaded airframe's crown can be lower than the game's: letters past it would be cut off the skyline)
  const [t, b] = [Math.min(top(probe), crown), bot(probe)];
  const yc = (t + b) / 2;
  const R = (t - b) / 2;
  const rows = [...(windows || [])].sort((x, y) => x.y - y.y);
  const low = rows[0];
  const floor = low ? low.y + low.ht / 2 + 0.05 * R : yc + 0.12 * R;
  // How far back a name can run with its foot at height y: until the near wing, walked from its root
  // out, or a nacelle, rises to y from a chase camera.
  const reachOf = (y) => {
    let stop = Math.min(z1, limit);
    for (let t = 0; wing && t <= 1; t += 0.01) {
      const x = wing.rootX + wing.span * t;
      const top = wing.rootY + (wing.dihedral || 0) * t + 0.5 * (wing.thickness || 0.3) * (1 - t) + x * CHASE_RISE;
      if (top > y - 0.04 * R) {
        stop = Math.min(stop, rootZ + (wing.sweep || 0) * t);
        break;
      }
    }
    for (const e of engines || []) {
      const front = e.z - e.length / 2 - (e.kind === 'prop' ? 0.4 : 0);
      const rise = (e.kind === 'prop' ? e.y + e.propRadius : e.y + e.radius) + Math.abs(e.x) * CHASE_RISE;
      if (front < stop && rise > y) stop = front;
    }
    return stop;
  };
  // The roof of the band: the crown's shoulder, or the sills of a deck above.
  const upper = rows.find((r) => r !== low && (r.deck === 'upper' || r.y > low.y + 0.6 * R));
  const roof = upper ? upper.y - upper.ht / 2 - 0.05 * R : yc + 0.95 * R;
  // A turboprop's nacelles fill the forward fuselage from the side: its name goes behind them, as they wear it.
  let [from, to] = [zA, (y) => reachOf(y) - margin];
  if (to(floor) - from < 0.16 * L && (engines || []).some((e) => e.kind === 'prop')) {
    const tails = (engines || []).map((e) => e.z + e.length / 2);
    from = Math.max(wing ? wing.rootZ + wing.rootChord : z0, after, ...tails) + margin;
    const aft = main.filter((d) => d.z > from + 1).reduce((a, d) => Math.min(a, d.z - d.w / 2), z0 + 0.78 * L);
    to = () => aft - margin;
  }
  return { zA: from, end: to, floor, roof, bodyD: 2 * R, L, margin, root: rootZ };
}

/**
 * Size a name of a wordmark's proportions (`aspect`, width over height; `high`,
 * the height in caps) into the room. Returns { z, y, w, h, zone } in metres: z
 * and y the middle of the patch.
 */
export function titleSlot(room, aspect, high, doors, freighter = false, capShare = null) {
  const { zA, end, floor, roof, bodyD, L, margin } = room;
  // (`capShare`: an airline whose real name is painted taller than most, a share of the body's height)
  const share = Number.isFinite(capShare) && capShare > 0 ? Math.min(capShare, 0.5) : freighter ? FREIGHT_CAP : CAP_SHARE;
  const wanted = share * bodyD * high;
  const main = freighter ? [] : doors.filter((d) => d.deck !== 'upper').sort((x, y) => x.z - y.z);
  // Every foot the band allows, from the first door or from behind any door after it: the higher the foot,
  // the further back the wing lets the name run, and the less height it has. The biggest name wins.
  const starts = [zA, ...main.filter((d) => d.z > zA).map((d) => d.z + d.w / 2 + margin)];
  let best = null;
  for (const a of starts) {
    for (let k = 0; k <= 24; k++) {
      const foot = floor + ((roof - floor) * k) / 24;
      const b = end(foot);
      const h = Math.min(wanted, roof - foot, Math.min(b - a, MAX_SHARE * L) / aspect);
      if (!(h > 0)) continue;
      const w = h * aspect;
      // A door it crosses: only the door's top frame may go under the letters.
      if (main.some((d) => d.z + d.w / 2 > a && d.z - d.w / 2 < a + w && foot < d.y + d.h / 2 - DOOR_TUCK * bodyD)) continue;
      if (!best || h > best.h * 1.02) best = { a, b, foot, h, w };
    }
  }
  if (!best) return null;
  // Low in the band, just over the windows: a name stands on them, it does not float.
  const y = best.foot + Math.min(Math.max(0, roof - best.foot - best.h), 0.03 * bodyD) + best.h / 2;
  return { z: best.a + best.w / 2, y, w: best.w, h: best.h, zone: { zA, zB: best.b, a: best.a, b: best.b, foot: best.foot, lid: roof, root: room.root } };
}
