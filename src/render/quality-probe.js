/**
 * Graphics quality: "Auto" — pick a tier for this computer from a short
 * frame-time probe.
 *
 * The contract (see main.js applySetting and storage.js coerceQuality):
 *   settings.quality           ALWAYS one of TIERS. Nineteen modules compare
 *                              it with 'low' / 'high' / 'ultra', so "auto" is
 *                              never written there.
 *   settings.qualityAuto       true when the player left it on Auto (the
 *                              default for a new install).
 *   settings.qualityAutoPicked the tier the probe chose, or null before it
 *                              has run. Later boots read it and do not probe
 *                              again; choosing Auto from the menu re-probes.
 *
 * The probe times frames the game really draws — the island, the aeroplane
 * on the runway — at High, behind the loading screen, with a one-pixel read
 * after each so the GPU's share of the frame is counted and not only the
 * CPU's. It stops after `frames` frames or `budgetMs`, whichever is first,
 * so it never holds the loading screen up by more than about a second.
 */

export const TIERS = ['low', 'medium', 'high', 'ultra'];

export function isTier(q) {
  return TIERS.includes(q);
}

export function tierRank(q) {
  return TIERS.indexOf(q);
}

/**
 * The tier for a measured average frame time (milliseconds, at High).
 *
 *   over 22 ms  → low     (under ~45 fps at High: the class laptop)
 *   over 15 ms  → medium
 *   otherwise   → high
 *   under 6 ms on a dense screen (dpr ≥ 2) → ultra
 *
 * Anything that is not a usable number keeps High, which is what every
 * install had before Auto existed.
 */
export function pickTier(avgMs, dpr = 1) {
  if (typeof avgMs !== 'number' || !Number.isFinite(avgMs) || avgMs <= 0) return 'high';
  if (avgMs > 22) return 'low';
  if (avgMs > 15) return 'medium';
  if (avgMs < 6 && dpr >= 2) return 'ultra';
  return 'high';
}

/**
 * What one frame at each tier costs relative to High, so a probe run while a
 * different tier is built (choosing Auto from the menu in-game) can be read
 * as "what would High cost here". Measured on the shared camera spots
 * (scratchpad/looks/baseline.md, GPU-synced frame time, 1366×768, dpr 1).
 */
export const TIER_COST = { low: 0.55, medium: 0.75, high: 1, ultra: 1.45 };

/** Turn a frame time measured at `built` into the equivalent at High. */
export function asHighMs(ms, built = 'high') {
  const k = TIER_COST[built] || 1;
  return ms / k;
}

/**
 * Time `draw()` a few dozen times. `sync()` should wait for the GPU (a
 * one-pixel readPixels does). Returns the trimmed mean — the slowest and
 * fastest tenth dropped, so one garbage-collection pause or one frame that
 * compiled a late shader does not decide the tier — plus what it spent.
 */
export function probeFrames(draw, { sync = null, warmup = 3, frames = 40, budgetMs = 800, now = () => performance.now() } = {}) {
  const t0 = now();
  for (let i = 0; i < warmup; i++) {
    draw();
    if (sync) sync();
  }
  const warmMs = now() - t0;
  const times = [];
  const t1 = now();
  while (times.length < frames && now() - t1 < budgetMs) {
    const a = now();
    draw();
    if (sync) sync();
    times.push(now() - a);
  }
  const sorted = [...times].sort((x, y) => x - y);
  const cut = Math.floor(sorted.length * 0.1);
  const mid = sorted.slice(cut, sorted.length - cut);
  const avgMs = mid.length ? mid.reduce((s, v) => s + v, 0) / mid.length : NaN;
  return { avgMs, frames: times.length, warmMs, totalMs: now() - t0 };
}
