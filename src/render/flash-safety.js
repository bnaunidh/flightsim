/**
 * Reduce flashing — Settings → Graphics, ON by default.
 *
 * The owner: "graphic errors that can cause seziure". Photosensitive
 * epilepsy is set off by light that flashes or flickers, most of all fast,
 * bright and over a large part of the screen. WCAG 2.3.1 (Three Flashes or
 * Below Threshold) puts the line at no more than three flashes in any one
 * second, unless the flash is small or dim: a "flash" being a pair of
 * opposing changes of 10% or more in relative luminance.
 *
 * The rendering errors that flickered (the sea fighting the sea floor in the
 * depth buffer, the bands over the beaches) are simply fixed, for everybody;
 * see render/depth-layers.js and terrain.js SEA_CUT. What is here is for the
 * flashes the game makes ON PURPOSE — lightning, explosions, gun hits, the
 * full-screen washes, strobe and beacon lights, the cockpit's engine buzz —
 * which with this switch on are kept dim, soft and at most three a second.
 * Switched off, every one of them is exactly what it was before.
 *
 * Nothing here imports anything: the switch is a plain object that the game
 * sets from the saved setting (main.js), and every effect reads it as it
 * draws, so turning it on or off takes effect on the next frame.
 */

export const FLASH = {
  /** The setting. True unless the player has switched it off. */
  reduce: true,
};

export function setReduceFlashing(on) {
  FLASH.reduce = on !== false;
  // The interface's own blinking (CSS) keys off a class on the page.
  if (typeof document !== 'undefined' && document.documentElement && document.documentElement.classList) {
    document.documentElement.classList.toggle('reduce-flashing', FLASH.reduce);
  }
  return FLASH.reduce;
}

/** WCAG 2.3.1: no more than three flashes in any one second. */
export const MAX_FLASHES_PER_SECOND = 3;
/**
 * The shortest gap between two flashes with the switch on. 1/3 s would let a
 * fourth one in at exactly the end of a second; a little over that cannot.
 */
export const MIN_FLASH_GAP = 0.35;

/**
 * How bright each kind of flash may get with the switch on, as a fraction of
 * what it is with the switch off. Chosen with tests/flicker-probe.js so that a
 * lightning strike or a close explosion changes no more than a small part of
 * the screen by WCAG's 10% (see tests/features/flicker.browser.js).
 */
export const CAPS = {
  /** The lightning wash on the sky, the clouds and the sunlight. */
  lightning: 0.22,
  /** An explosion's light on the world and on the sky. */
  blastLight: 0.3,
  /** An explosion's white flash sprite. */
  blastSprite: 0.45,
  /** Strobe and beacon lights at their brightest. */
  strobe: 0.55,
  /**
   * The engine's continuous buzz in the cockpit view. The eye is a metre from
   * the panel there, so the same few millimetres of shake that are nothing
   * from the chase camera moved every edge of the cockpit about five pixels,
   * ten times a second: 6% of the screen flickering in the probe, in every
   * cockpit flight. A tenth of it is under a pixel.
   */
  cockpitBuzz: 0.1,
};

/**
 * The most a full-screen overlay (an explosion right beside you, a hit, the
 * camera's photo flash) may cover the picture with the switch on. A wash of
 * near-white (relative luminance about 0.83) at 12% moves any scene, even a
 * black one, by less than WCAG's 0.1, so it is not a flash at all by the
 * standard.
 */
export const SCREEN_MAX = 0.12;

/**
 * The camera's shake runs on sines of 3 to 10 Hz. A jolt (a hard landing, a
 * bang beside you) shakes the whole picture by tens of pixels, so for its
 * half second every edge on the screen goes back and forth up to ten times a
 * second — a full-screen flicker by any measure. With the switch on, the
 * shake's clock runs at this fraction: the same jolt, under 3 Hz.
 */
export const SHAKE_RATE = 0.3;

/** The shake's clock: `t`, slowed with the switch on. */
export function shakeClock(t) {
  return FLASH.reduce ? t * SHAKE_RATE : t;
}

/** `v`, scaled by `cap` when the switch is on. */
export function dim(v, cap) {
  return FLASH.reduce ? v * cap : v;
}

/** A full-screen overlay's opacity, never over SCREEN_MAX when the switch is on. */
export function screenOpacity(a) {
  return FLASH.reduce ? Math.min(a, SCREEN_MAX) : a;
}

/**
 * A rate gate for one kind of flash: with the switch on, `allow(t)` says yes
 * at most once per MIN_FLASH_GAP of the clock it is given (seconds); with it
 * off, always yes. A flash that is refused is simply not flashed — whatever
 * else the event does (the fire, the smoke, the sound) still happens.
 */
export class FlashGate {
  constructor(gap = MIN_FLASH_GAP) {
    this.gap = gap;
    this.last = -Infinity;
  }

  allow(t) {
    if (!FLASH.reduce) return true;
    if (t - this.last < this.gap) return false;
    this.last = t;
    return true;
  }
}

/**
 * A light that several flashes drive at once (the explosions' one light,
 * the sky's bounce from them): with the switch on, it follows its target
 * through a fast-attack, slow-release smoother, so a string of bangs is one
 * swell of light rather than a flash per bang — nothing left to flicker at
 * more than a couple of times a second — and it rises over a few frames
 * instead of in one. Switched off, `step()` returns the target untouched.
 */
export class FlashSmoother {
  constructor(attack = 0.12, release = 0.45) {
    this.attack = attack;
    this.release = release;
    this.v = 0;
  }

  step(target, dt) {
    if (!FLASH.reduce) {
      this.v = target;
      return target;
    }
    const tau = target > this.v ? this.attack : this.release;
    this.v += (target - this.v) * (1 - Math.exp(-Math.max(0, dt) / tau));
    return this.v;
  }
}

/** Seconds, from whatever clock the page has. */
export function now() {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
}

/**
 * A strobe light's brightness at time `t` (seconds) for a cycle of `period`.
 *
 * Switch off: the hard flash the lights have always had — on for `on`
 * seconds, and for a double flash (`gap` given) off for `gap` and on again,
 * then dark for the rest of the cycle. Switch on: ONE soft pulse a cycle (a
 * raised cosine, at most 0.3 s wide), at CAPS.strobe brightness — still
 * unmistakably a strobe from a long way off, never a hard flash, and never
 * more than one a cycle.
 */
export function strobeLevel(t, period = 1.3, on = 0.06, gap = null) {
  const c = ((t % period) + period) % period;
  if (!FLASH.reduce) return c < on || (gap != null && c > on + gap && c < 2 * on + gap) ? 1 : 0;
  const w = Math.min(0.3, period * 0.5);
  if (c >= w) return 0;
  return CAPS.strobe * 0.5 * (1 - Math.cos((c / w) * Math.PI * 2));
}

/**
 * A blinking light (a beacon, a warning lamp): `period` seconds a cycle,
 * lit for the fraction `duty`. Switch off: a hard on/off. Switch on: a smooth
 * swell between `lo` and the lit level at the same rate, which reads as the
 * same light without the edge.
 */
export function blinkLevel(t, period, duty = 0.5, lo = 0) {
  const c = (((t % period) + period) % period) / period;
  if (!FLASH.reduce) return c < duty ? 1 : lo;
  const s = 0.5 - 0.5 * Math.cos(c * Math.PI * 2);
  return lo + (1 - lo) * (1 - s);
}
