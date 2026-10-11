/**
 * What damage does to the way the aeroplane flies — in ONE place.
 *
 * Two kinds of hurt reach the flight model:
 *
 *   `damage`  0..1 per part (leftWing, rightWing, nose, tail, fuselage, gear),
 *             from a survivable knock (physics.js takeHit). This is the old
 *             battle-damage model, moved here unchanged: a hurt wing makes
 *             less lift and more drag and rolls you towards it, a hurt tail
 *             goes soft, a hurt nose costs power.
 *
 *   `lost`    the break-up's record of the pieces that have come OFF
 *             (src/game/breakup.js, filled in by src/features/breakup.js) —
 *             a wing tip snapped on a tree, a fin, a tailplane, an engine.
 *             { wingOuterL, wingOuterR, fin, tailplaneL, tailplaneR,
 *               tailRotor, propBent, engines: [{ x }], engineCount }
 *             (each a boolean; `engines` the lost engines, x their lateral
 *             position in metres, + right).
 *
 * handlingFor(damage, lost) turns both into one set of numbers the flight
 * model multiplies or adds in. It returns NULL when nothing at all is hurt
 * or missing, and physics.js skips every term when it is null — so normal
 * flight is not "nearly" unchanged, it is the very same arithmetic it always
 * was (tests/features/breakup.mjs flies the same flight with and without
 * the hook and holds the two to the last bit).
 *
 * SIGNS, in physics.js's body frame (-Z forward, +Y up, +X right):
 *   roll   +Cl rolls LEFT (left wing down)
 *   yaw    +Cn / +Y torque yaws the nose LEFT
 *
 *   losing the LEFT outer wing  -> less lift on the left -> roll LEFT (+)
 *   losing the LEFT engine      -> the right ones push alone -> nose LEFT (+)
 *   losing the fin              -> no weathercock: the yaw wanders off
 *   losing a tail rotor         -> the main rotor's torque spins her round,
 *                                  and the pedals barely answer
 */

/**
 * The most a hurt or missing wing may roll you, as a share of the type's
 * full aileron (its Clda).
 *
 * "Losing an outer wing rolls you toward it" — and a survivable hit has to
 * leave you able to land. The tip-loss roll was a flat 0.035 of Cl (plus the
 * old model's 0.025 x the wing asymmetry), and on the two types that are
 * heavy in roll that is MORE than full aileron: the Tempest's Clda is 0.040,
 * the Meridian's 0.046. Measured (the checker's authority run, a tip snapped
 * at 0.6 of the knock scale): hands off, -64 degrees of bank in 8 s; full
 * opposite stick on the Tempest still drifting from -4 to -19 degrees, the
 * Meridian only just held at 100% stick. So the bias is held to this share of
 * the aeroplane's OWN aileron, which leaves 40% of the stick to fly with on
 * every type — a pull you can feel and hold, never one you cannot.
 */
export const ROLL_SHARE_MAX = 0.6;

/**
 * Pure. See the header. Never throws on missing fields.
 * `spec` (optional): the aeroplane's numbers; with its `Clda`, the roll bias
 * is held to ROLL_SHARE_MAX of it.
 */
export function handlingFor(damage, lost, spec = null) {
  const d = damage || NONE;
  const L = lost || null;
  const lw = +d.leftWing || 0;
  const rw = +d.rightWing || 0;
  const nose = +d.nose || 0;
  const tail = +d.tail || 0;
  const fus = +d.fuselage || 0;
  const anyLost = !!(L && (L.wingOuterL || L.wingOuterR || L.fin || L.tailplaneL || L.tailplaneR || L.propBent || L.tailRotor
    || (Array.isArray(L.engines) && L.engines.length)));
  if (!anyLost && lw === 0 && rw === 0 && nose === 0 && tail === 0 && fus === 0) return null;

  /* ---- the old damage model, term for term (was inline in physics.js) ---- */
  const wingHurt = (lw + rw) / 2;
  const wingAsym = lw - rw;
  const out = {
    /** Multiplies lift. */
    lift: 1 - wingHurt * 0.34,
    /** Added to the drag coefficient. */
    drag: wingHurt * 0.05 + nose * 0.03 + tail * 0.02 + fus * 0.04,
    /** Multiplies thrust. */
    thrust: 1 - nose * 0.55,
    /** Multiplies the pitching-moment coefficient. */
    pitchAuth: 1 - tail * 0.62,
    /** Multiplies the yawing-moment coefficient. */
    yawAuth: 1 - tail * 0.62,
    /** Added to Cl (+ rolls left). */
    roll: wingAsym * 0.025,
    /** Added to Cn as a multiple of Cnb x beta (+ is destabilising). */
    yawDestab: 0,
    /** Yaw torque per newton of thrust (+ nose left), metres: asymmetric engines. */
    yawArm: 0,
    /** Helicopter: multiplies the pedals' (the tail rotor's) authority. */
    pedalAuth: 1,
    /** Helicopter: the main rotor's torque, unopposed, as a share of full pedal. */
    rotorSpin: 0,
  };
  if (!anyLost) return capRoll(out, spec);

  /* ---- pieces that have come off ---- */
  if (L.wingOuterL) {
    out.lift *= 0.88;
    out.roll += 0.035;
    out.drag += 0.012;
  }
  if (L.wingOuterR) {
    out.lift *= 0.88;
    out.roll -= 0.035;
    out.drag += 0.012;
  }
  // A tailplane gone: half the elevator and a little roll towards it.
  if (L.tailplaneL) {
    out.pitchAuth *= 0.62;
    out.roll += 0.004;
  }
  if (L.tailplaneR) {
    out.pitchAuth *= 0.62;
    out.roll -= 0.004;
  }
  // No fin: almost no weathercock and no rudder, and what is left of the
  // body ahead of the CG pushes the nose further OFF the wind — unstable.
  if (L.fin) {
    out.yawAuth *= 0.2;
    out.yawDestab += 0.18;
    out.drag += 0.004;
  }
  // A helicopter's tail rotor gone: nothing holds the main rotor's torque, so
  // she turns against it — harder the harder the rotor pulls — and the pedals
  // do almost nothing. (Its fin goes with it: `fin` above.)
  if (L.tailRotor) {
    out.pedalAuth = 0.1;
    out.rotorSpin = 0.45;
  }
  if (L.propBent) out.thrust *= 0.72;
  const count = Math.max(1, L.engineCount || 1);
  const engines = Array.isArray(L.engines) ? L.engines : [];
  if (engines.length) {
    const remaining = Math.max(0, count - engines.length);
    out.thrust *= remaining / count;
    if (remaining > 0) {
      let sum = 0;
      for (const e of engines) sum += +e.x || 0;
      // Net yaw torque of the engines still running is thrust x (-sum of the lost x) / remaining.
      out.yawArm = -sum / remaining;
    }
    out.drag += 0.006 * engines.length;
  }
  return capRoll(out, spec);
}

/** Holds the roll bias to ROLL_SHARE_MAX of the type's aileron (no spec: as it is). */
function capRoll(out, spec) {
  const clda = spec ? Math.abs(+spec.Clda || 0) : 0;
  if (clda > 0) {
    const cap = ROLL_SHARE_MAX * clda;
    if (out.roll > cap) out.roll = cap;
    else if (out.roll < -cap) out.roll = -cap;
  }
  return out;
}

const NONE = Object.freeze({});
