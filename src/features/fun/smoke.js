/**
 * The smoke trail's colours, its tank and the light it is seen in.
 *
 * The colours used to be unlocked by the sticker book (see git history): now
 * that the sticker book is gone, every colour — Rainbow included — is
 * available from the start. Fewer locks, not a new feature.
 *
 * The tank (SmokeTank) is what makes smoke something you do every so often,
 * and smokeLight() is how the sky lights it. Both are plain numbers with no
 * THREE in them, so the node checks can fly them with made-up seconds.
 */

export const SMOKE_COLOURS = [
  { id: 'white', name: 'Cloud White', rgb: [0.96, 0.96, 0.98] },
  { id: 'red', name: 'Rocket Red', rgb: [1.0, 0.24, 0.2] },
  { id: 'blue', name: 'Sky Blue', rgb: [0.25, 0.55, 1.0] },
  { id: 'green', name: 'Frog Green', rgb: [0.3, 0.9, 0.35] },
  { id: 'pink', name: 'Bubblegum', rgb: [1.0, 0.45, 0.8] },
  { id: 'gold', name: 'Gold Star', rgb: [1.0, 0.8, 0.2] },
  { id: 'rainbow', name: 'Rainbow', rgb: null },
];

/** The colour to fly with: whatever is saved, else white. */
export function activeColour(data) {
  const c = SMOKE_COLOURS.find((k) => k.id === (data.smoke && data.smoke.color));
  return c || SMOKE_COLOURS[0];
}

/* ------------------------------------------------------------------ *
 * The smoke tank — "every so often"
 *
 * Smoke is not endless. A full tank gives about 20 seconds of continuous
 * smoke; when it is dry the smoke stops by itself and the tank fills again
 * over about 30 seconds of not smoking. It is a calm limit, not a penalty:
 * nothing flashes, nothing is lost, you just wait a little.
 *
 * Plain numbers, no THREE, so node can fly it with made-up seconds.
 * ------------------------------------------------------------------ */

export const TANK = {
  /** Seconds of continuous smoke from a full tank. */
  drainSecs: 20,
  /** Seconds to fill an empty tank, while not smoking. */
  refillSecs: 30,
  /**
   * How full it must be to start again. Without this, a tank at 1% would let
   * you press T for a third of a second and stop, over and over.
   */
  minStart: 0.08,
};

export class SmokeTank {
  constructor({ drainSecs = TANK.drainSecs, refillSecs = TANK.refillSecs, minStart = TANK.minStart } = {}) {
    this.drainSecs = drainSecs;
    this.refillSecs = refillSecs;
    this.minStart = minStart;
    this.level = 1;
  }

  /** Full again (a new flight). */
  reset() {
    this.level = 1;
  }

  /** Enough in it to be worth turning the smoke on? */
  canStart() {
    return this.level >= this.minStart;
  }

  get empty() {
    return this.level <= 0;
  }

  /**
   * Move the tank on by dt seconds. `puffing` is whether smoke actually came
   * out this frame (on, flying, not parked): only then does it drain, and
   * only when it is NOT coming out does it fill. Returns 'empty' on the
   * frame it runs dry — the caller turns the smoke off — else null.
   */
  update(dt, puffing) {
    if (!(dt > 0)) return null;
    if (puffing) {
      this.level = Math.max(0, this.level - dt / this.drainSecs);
      return this.level <= 0 ? 'empty' : null;
    }
    this.level = Math.min(1, this.level + dt / this.refillSecs);
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * How the sky lights the smoke
 *
 * The same idea as the clouds: the top of a puff takes the colour of the
 * sun, the underside the colour of the sky, and a heavy overcast takes the
 * sun away. The smoke's own colour is multiplied by these in the shader, so
 * white smoke at noon is white, at sunset it is warm, and at night it is a
 * dim blue-grey and not a lamp.
 * ------------------------------------------------------------------ */

const LIGHT = {
  day: { sun: [1.0, 0.975, 0.93], amb: [0.7, 0.76, 0.86] },
  sunset: { sun: [1.0, 0.7, 0.42], amb: [0.5, 0.42, 0.45] },
  night: { sun: [0.3, 0.36, 0.52], amb: [0.1, 0.13, 0.21] },
};

/**
 * The sun and sky colours for the smoke, written into `out` ({sun, amb}, each
 * [r, g, b]). `cover` is the cloud cover 0..1: under a thick overcast the sun
 * is mostly gone and the top of a puff is only a little brighter than its
 * underside.
 */
export function smokeLight(time, cover = 0, out = { sun: [1, 1, 1], amb: [1, 1, 1] }) {
  const L = LIGHT[time] || LIGHT.day;
  const c = Math.min(1, Math.max(0, cover || 0));
  const flat = 0.55 * c;
  for (let i = 0; i < 3; i++) {
    out.amb[i] = L.amb[i];
    out.sun[i] = L.sun[i] + (L.amb[i] - L.sun[i]) * flat;
  }
  return out;
}
