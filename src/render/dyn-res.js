/**
 * Dynamic resolution: hold the frame rate by drawing the picture a little
 * smaller for a while.
 *
 * The frame rate is sampled once a second (main.js's own counter). Two slow
 * seconds in a row take the drawing-buffer scale down a step; four fast
 * seconds in a row bring it back up a smaller step, so it settles rather than
 * oscillates. It never goes under `min` (0.65: a 1366×768 laptop still draws
 * 888×499, which is a soft picture but a playable one), it starts at 1, and it
 * is reset whenever the tier changes, since a different world is a different
 * cost.
 *
 * Pure arithmetic, no renderer: main.js multiplies the tier's pixel-ratio cap
 * by `scale` and hands the product to renderer.setPixelRatio.
 */
export class DynamicResolution {
  constructor({ min = 0.65, slowFps = 28, fastFps = 55, down = 0.1, up = 0.05, slowRuns = 2, fastRuns = 4 } = {}) {
    this.min = min;
    this.slowFps = slowFps;
    this.fastFps = fastFps;
    this.down = down;
    this.up = up;
    this.slowRuns = slowRuns;
    this.fastRuns = fastRuns;
    this.reset();
  }

  reset() {
    this.scale = 1;
    this.slow = 0;
    this.fast = 0;
  }

  /**
   * One second's frame rate. Returns the new scale, and `changed` says
   * whether it moved (so the renderer is only touched when it did).
   */
  tick(fps) {
    const before = this.scale;
    if (!(fps > 0)) return { scale: this.scale, changed: false };
    if (fps < this.slowFps) {
      this.slow++;
      this.fast = 0;
      if (this.slow >= this.slowRuns) {
        this.scale = Math.max(this.min, Math.round((this.scale - this.down) * 100) / 100);
        this.slow = 0;
      }
    } else if (fps > this.fastFps) {
      this.fast++;
      this.slow = 0;
      if (this.fast >= this.fastRuns) {
        this.scale = Math.min(1, Math.round((this.scale + this.up) * 100) / 100);
        this.fast = 0;
      }
    } else {
      this.slow = 0;
      this.fast = 0;
    }
    return { scale: this.scale, changed: this.scale !== before };
  }
}

/** The pixel-ratio cap for a tier: a school laptop at 1.25, Ultra uncapped to 3. */
export function pixelRatioCap(quality, dpr = 1) {
  return Math.min(dpr || 1, quality === 'ultra' ? 3 : quality === 'high' ? 2 : 1.25);
}
