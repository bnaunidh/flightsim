/**
 * THE FRAME BUDGET (the Nov 4 demo pass, 2026-10-30).
 *
 * A 6-second CPU profile of a Free Flight on a fast Mac (the rival study,
 * .claude/devtools/briefs/rival-sr71-deep.md) found the game's own main-thread
 * work going into the DOM: querySelectorAll every frame, getClientRects
 * forcing a layout, the minimap and the HUD's text redrawn 60 times a second
 * for numbers that change a few times a second. We drew a sixth of the
 * rival's triangles and still ran at a fifth of its frame rate.
 *
 * The rates below are the whole game's, in one place, so the tests
 * (tests/features/frame-budget.mjs, frame-budget.browser.js) can read them
 * and so no screen quietly goes back to "every frame":
 *
 *   - the HUD's numbers (speed, altitude, climb, heading, wind, the engine
 *     strip's bars and chips) are written at HUD_TEXT_HZ on a live frame. The
 *     physics still runs every frame; the panel's 20 Hz is what a real
 *     instrument's needle does, and more than a player can read. A driven
 *     check (sim.step(), tests/) is not a live frame and sees every update;
 *   - the minimap's canvas is drawn at MINIMAP_HZ at most (10 Hz on Low and
 *     in Performance mode, render/weak-device.js PERF_MODE);
 *   - the HUD's lanes (where the radio line, the coaching line and the state
 *     pills stand clear of the controls under them) are measured when the
 *     HUD's tree or the window changed, and otherwise once in
 *     LANE_FALLBACK_S, instead of twice a second whatever happened;
 *   - the right-hand stack's cards report their own size through a
 *     ResizeObserver; the layout is asked outright only once in
 *     STACK_FALLBACK_S.
 *
 * None of the game's per-frame paths (Game.update, Hud.update, Minimap.frame,
 * a feature's update()) may look an element up (querySelector,
 * getElementById) or read a layout size (getBoundingClientRect,
 * getClientRects, offsetWidth, clientWidth, getComputedStyle): element
 * references are taken when the DOM is built, sizes on resize or on a
 * mutation. The browser check counts them over 120 frames.
 */

/** The HUD's numbers are written this many times a second on a live frame. */
export const HUD_TEXT_HZ = 20;

/** The minimap's canvas is redrawn at most this many times a second. */
export const MINIMAP_HZ = 15;

/**
 * Behind a menu, the pause card or the debrief the island is drawn at this
 * rate, not the screen's: it is a blurred backdrop there. The rival study's
 * crash screen cost 500-1,500 ms a frame in scene traversal, and its menu
 * idled at 20 fps with long frames; half the draws is half of that.
 */
export const MENU_RENDER_HZ = 30;

/** Without a change in the HUD's tree or the window, the lanes are re-measured this often (seconds). */
export const LANE_FALLBACK_S = 3;

/** Without a change, the right-hand stack asks the layout for the truth this often (seconds). */
export const STACK_FALLBACK_S = 1;

/**
 * A rate gate: `due(dt, live)` is true when `hz` worth of time has gone by
 * since it last said so, and ALWAYS when the frame is not live (a check
 * stepping the sim owns the clock and must see every update). A frame
 * longer than the period counts as one update, never several.
 */
export class RateGate {
  constructor(hz) {
    this.period = 1 / Math.max(1, hz || 1);
    this.acc = this.period; // the first frame is always due
  }

  due(dt, live = true) {
    this.acc += Math.max(0, Number(dt) || 0);
    if (!live || this.acc >= this.period) {
      this.acc = 0;
      return true;
    }
    return false;
  }

  /** Make the next frame due (something changed that must show now). */
  poke() {
    this.acc = this.period;
  }
}
