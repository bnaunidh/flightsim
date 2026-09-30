/**
 * The boat's instruments.
 *
 * WHY THIS IS A SEPARATE FILE AND A SEPARATE PANEL, rather than more branches
 * inside Hud.setVehicle:
 *
 * setVehicle used to borrow the aeroplane's four rows and rewrite their unit
 * labels in place — 'kt' became 'km/h', the altimeter's 'ft' became 'km' and
 * its caption became "travelled". That is why clearVehicle exists at all, and
 * the comment above it names the bug: one trip in the boat left the altimeter
 * reading kilometres for the rest of the session. Every new boat readout added
 * the same way is another label to remember to put back. So the boat gets its
 * own panel, built once, shown and hidden. Nothing is rewritten, so nothing can
 * be left rewritten, and the aeroplane HUD is not touched by any of this.
 *
 * The readouts are in the order a boat is actually steered by, which is NOT the
 * order an aeroplane is flown by:
 *
 *   1. depth under the keel   (the boat's altimeter, and the same number
 *                              upside down — this is what you hit)
 *   2. speed in knots         (with the word, because "4 kt" means nothing
 *                              and "idling along" means everything)
 *   3. the engine lever       (ASTERN / STOP / SLOW / HALF / FULL — a
 *                              percentage is an aeroplane idea)
 *   4. how many people are aboard
 *
 * The chart is the minimap and belongs to the minimap specialist. The heading
 * ribbon is here because it is an instrument, not a map.
 *
 * NOTHING IN THIS FILE IMPORTS ANYTHING THAT DOES NOT EXIST TODAY. In
 * particular it does not import depthUnderKeel() from terrain.js: that helper
 * is in the lead's brief but is not in the tree yet, and a named import that
 * does not resolve is not a missing feature, it is a blank screen. Depth is
 * computed here from heightAt, which has been there all along, and the moment
 * depthUnderKeel lands this becomes a one-line swap — see depthFor() below.
 */

import { heightAt } from '../world/terrain.js';
import { clamp } from '../core/noise.js';
import { boatRoute, resetBoatRoute, warmBoatRoute, hideStrayAirfield, restoreStrayAirfield } from '../game/missions-boat.js';

/*
 * What the boat hides of the aeroplane's HUD, and what it adds of its own.
 *
 * The stylesheet already hid the aeroplane's instrument strip in the boat
 * (.hud-left:not(.hud-boatpanel)), and nothing else. Measured in First Shout:
 * POWER 0%, FUEL 0%, GEAR DOWN, FLAPS 0, BRAKES, EASY MODE and "Power: Shift
 * up · Ctrl down · Space brakes" were all on screen under the boat panel —
 * six aeroplane words and two dead bars, none of which a boat has. The
 * aeroplane's waypoint arrow, coach line, stall slab and PAPI hint are also
 * aeroplane-only and are only ever updated by the flight loop, so in the boat
 * they showed whatever the last flight left in them.
 *
 * styles/main.css belongs to the HUD owner, so these rules live here and are
 * injected once. Every one is scoped to `.hud.is-boat`, which leave() takes
 * off, so leaving the boat by any route puts the aeroplane's HUD back exactly
 * as it was — nothing is rewritten, only not shown.
 */
const BOAT_CSS = `
.hud.is-boat .hud-bottom,
.hud.is-boat .hud-waypoint,
.hud.is-boat .hud-coach,
.hud.is-boat .hud-stall,
.hud.is-boat .hud-papi,
.hud.is-boat .hud-taxi,
.hud.is-boat .hud-damage { display: none !important; }
.hud-boatarrow { display: none; }
.hud.is-boat .hud-boatarrow {
  display: flex; align-items: center; gap: 10px; justify-content: center;
  margin: 6px auto 0; padding: 5px 14px 5px 8px; width: max-content; max-width: 92vw;
  background: rgba(10, 18, 30, 0.62); border: 1px solid rgba(140, 180, 230, 0.22);
  border-radius: 999px; color: #eaf2ff; font-weight: 600; font-size: 14px;
  pointer-events: none;
}
.hud-boatarrow-glyph {
  width: 34px; height: 34px; display: grid; place-items: center;
  font-size: 26px; line-height: 1; color: #ffc247; will-change: transform;
}
.hud-boatarrow.is-near .hud-boatarrow-glyph { color: #7dffb4; }
.hud-boatarrow-text small { display: block; font-size: 11px; font-weight: 500; opacity: 0.72; }
.hud-boatkeys { display: none; }
.hud.is-boat .hud-boatkeys {
  display: block; position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%);
  padding: 6px 12px; border-radius: 10px; background: rgba(10, 18, 30, 0.55);
  color: #cfe0f5; font-size: 12px; white-space: nowrap; pointer-events: none;
}
.hud.is-boat .hud-boatkeys kbd { font-size: 11px; padding: 0 5px; }
.hud.is-touch.is-boat .hud-boatkeys { display: none; }
.hud-shoalwarn { display: none; }
.hud.is-boat .hud-shoalwarn.is-on {
  display: block; position: absolute; left: 50%; top: 38%; transform: translateX(-50%);
  padding: 8px 16px; border-radius: 12px; background: rgba(60, 36, 0, 0.72);
  border: 1px solid rgba(255, 194, 71, 0.7); color: #ffd37a; font-weight: 700;
  font-size: 17px; text-align: center; pointer-events: none;
}
/*
 * The toasts open at 96 px, which in the boat — where the objective sits
 * lower to clear the heading ribbon — is exactly where the arrow is: the
 * "Tap Shift to go faster" notice at the start of every trip covered it.
 * Measured at 1280x800: arrow 138-184 px, and at 190 the first toast still
 * began at 182. At 206 they clear it.
 */
@media (min-width: 621px) {
  .hud.is-boat .hud-toasts { top: 206px; }
}
/*
 * The radio line. It sits 118 px up to clear the aeroplane's bottom strip,
 * which the boat hides; there it was drawn across the launch's stern for
 * every call — measured at 1280x713 with the chase camera on her at the
 * berth, 36% of her on-screen box under the subtitle (hull 390-591 px down,
 * subtitle 518-595). In the boat it drops to just above the keys line.
 * Not on a touch screen, where the lever and the wheel are down there, and
 * not on a narrow screen with the chart up, where main.css lifts it clear of
 * the chart.
 */
@media (min-width: 901px) {
  .hud.is-boat:not(.is-touch) .hud-subtitle { bottom: 52px; }
}
@media (max-width: 720px) {
  .hud.is-boat .hud-boatkeys { display: none; }
  .hud.is-boat .hud-boatarrow { font-size: 12px; }
}
/*
 * The wind box and the shout. The objective is centred and min(560px, 52vw)
 * wide and the wind box is pinned top right, and in the boat the objective
 * sits 30 px lower to clear the compass tape, level with the wind box.
 * Measured at 1024x768: objective 246-778 px across, wind box from 689 —
 * the rose was drawn over the end of the first line of every instruction.
 * At 1180 they still overlapped by 25 px; from 1280 up they do not. Below
 * that the wind box drops under the shout, and the toasts under it.
 */
@media (max-width: 1260px) {
  .hud.is-boat:not(.is-touch) .hud-right { top: 130px; }
  .hud.is-boat:not(.is-touch) .hud-toasts { top: 226px; }
}
/*
 * On an iPad. On a touch screen .hud-left is a four-column strip across the
 * top under the buttons, and the boat panel wears .hud-left — but the boat's
 * own display:block rule came later in the stylesheet and won, so the panel
 * was a full-width box of stacked rows 181 px tall (measured 66-247 at
 * 1180x820), and the boat rule that lifts the objective to 46 px put the
 * shout underneath it. Here it is one row — depth, speed, the lever — and
 * the objective goes back below it.
 */
.hud.is-touch.is-boat .hud-boatpanel {
  display: grid; grid-template-columns: 1fr 1fr 2.6fr auto; align-items: center;
  gap: 0 10px; padding: 5px 10px;
}
.hud.is-touch.is-boat .hud-boatpanel .hud-row,
.hud.is-touch.is-boat .hud-boatpanel .hud-lever { border-top: 0; padding: 0; }
.hud.is-touch.is-boat .hud-boatpanel .hud-row.is-depth .hud-value { font-size: 22px; }
.hud.is-touch.is-boat .hud-boatpanel .hud-word { font-size: 9px; }
.hud.is-touch.is-boat .hud-boatpanel .hud-lever-detents { margin-top: 2px; }
.hud.is-touch.is-boat .hud-top { top: 140px; }
/*
 * And on a touch screen the wind box sits at y74, which is now the strip:
 * measured 849-1168 x 74-162, across the lever and the end of the shout.
 * On a phone the stylesheet already hides it; on a tablet in the boat it
 * goes too (the Gale's words say which way the wind is), and the toasts
 * open under the arrow instead of on it (arrow 232-278, toasts from 206).
 */
.hud.is-touch.is-boat .hud-right { display: none; }
.hud.is-touch.is-boat .hud-toasts { top: 290px; }
`;

let cssInjected = false;
function injectCss() {
  if (cssInjected || typeof document === 'undefined') return;
  cssInjected = true;
  const st = document.createElement('style');
  st.id = 'hud-boat-css';
  st.textContent = BOAT_CSS;
  document.head.appendChild(st);
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/**
 * The five positions of the engine lever, in the order they sit on the pedestal.
 *
 * Five words rather than a number from 0 to 100 because "go slowly alongside"
 * has to be a thing a ten-year-old can DO, not a thing they approximate. You
 * cannot aim at 34%. You can put the lever on SLOW.
 */
export const LEVERS = ['ASTERN', 'STOP', 'SLOW', 'HALF', 'FULL'];

const TURN_WORDS = ['straight on', 'turn right (D)', 'turn left (A)'];
const CLEAR_WORDS = 'Clear of the bottom — engine on STOP';

/**
 * Which detent the lever is in.
 *
 * Reads vehicle.readouts().lever first — that is where the surface.js work
 * will put it — and falls back to working it out from the throttle, because
 * today readouts() returns `throttle: Math.abs(this.throttle)` and throws the
 * sign away. Without the fallback the HUD would show STOP while the boat went
 * astern, which is precisely the sort of instrument that teaches a child to
 * stop trusting instruments.
 */
function leverIndex(r) {
  if (typeof r.lever === 'number') return clamp(Math.round(r.lever), 0, 4);
  if (typeof r.lever === 'string') {
    const i = LEVERS.indexOf(r.lever.toUpperCase());
    if (i >= 0) return i;
  }
  // Sign, from whichever of these the vehicle actually offers.
  let t = r.throttleSigned;
  if (typeof t !== 'number') {
    const mag = Math.abs(r.throttle || 0);
    t = (r.speedSigned ?? 0) < -0.2 || (r.astern === true) ? -mag : mag;
  }
  if (t < -0.05) return 0;
  if (t < 0.05) return 1;
  if (t < 0.5) return 2;
  if (t < 0.85) return 3;
  return 4;
}

/** Sea state in one word, from the weather that is already being simulated. */
export function seaStateWord(weather) {
  if (!weather) return 'calm';
  const turb = weather.cond ? weather.cond.turb || 0 : 0;
  const wind = weather.windSpeedKts || 0;
  // Wind matters more than cloud: a clear day with 26 kt across the bank is a
  // rough sea, and a grey still day is not. The old HUD only ever said
  // "Stormy", which is a sky, and the child is not sailing on the sky.
  const s = turb * 0.55 + clamp(wind / 30, 0, 1) * 0.75;
  if (s < 0.22) return 'calm';
  if (s < 0.5) return 'choppy';
  if (s < 0.85) return 'rough';
  return 'gale';
}

export class BoatHud {
  /**
   * @param {import('./hud.js').Hud} hud  the host HUD; we append to its wrap
   */
  constructor(hud) {
    this.hud = hud;
    this.built = false;
    this.active = false;
    this.last = {};
    this.pingTimer = 0;
    this.aboard = 0;
    this.aboardOf = 0;
    this.draught = 1.0;
  }

  /* ------------------------------------------------------------ build -- */

  build() {
    if (this.built) return;
    this.built = true;
    const wrap = this.hud.wrap;

    /* ---- The instrument panel, top left, where hud-left sits ---- */
    /*
     * It carries hud-left as well as its own class on purpose. Every
     * responsive rule the instrument strip already has -- where it sits on a
     * phone, how it reflows on a tablet in landscape, what happens to it when
     * the minimap is up -- is written against .hud-left. Wearing the same
     * class means the boat panel gets all of that free and cannot drift out of
     * step with it later. The stylesheet hides the aeroplane's strip with
     * .hud-left:not(.hud-boatpanel), so the two never both appear.
     */
    const p = el('div', 'hud-panel hud-left hud-boatpanel');
    this.panel = p;

    this.boatName = el('div', 'hud-acname', 'Kestrel Launch');
    p.appendChild(this.boatName);

    // 1. DEPTH. The biggest number on the screen, because it is the one that
    //    ends the run, and because a boat has no altitude to put here.
    const depthRow = el('div', 'hud-row is-depth');
    depthRow.appendChild(el('div', 'hud-label', 'Under keel'));
    this.depthValue = el('div', 'hud-value', '—');
    const dv = el('div', 'hud-valuewrap');
    dv.appendChild(this.depthValue);
    dv.appendChild(el('span', 'hud-unit', 'm'));
    depthRow.appendChild(dv);
    this.depthWord = el('div', 'hud-word', 'deep water');
    depthRow.appendChild(this.depthWord);
    p.appendChild(depthRow);

    // 2. SPEED, in knots, with the word.
    const spdRow = el('div', 'hud-row');
    spdRow.appendChild(el('div', 'hud-label', 'Speed'));
    this.spdValue = el('div', 'hud-value', '0');
    const sv = el('div', 'hud-valuewrap');
    sv.appendChild(this.spdValue);
    sv.appendChild(el('span', 'hud-unit', 'kt'));
    spdRow.appendChild(sv);
    this.spdWord = el('div', 'hud-word', 'stopped');
    spdRow.appendChild(this.spdWord);
    p.appendChild(spdRow);

    // 3. THE ENGINE LEVER.
    const lever = el('div', 'hud-lever');
    lever.appendChild(el('div', 'hud-label', 'Engine'));
    const detents = el('div', 'hud-lever-detents');
    this.leverCells = LEVERS.map((name) => {
      const c = el('div', 'hud-lever-detent', name);
      detents.appendChild(c);
      return c;
    });
    lever.appendChild(detents);
    p.appendChild(lever);

    // 4. ABOARD. Hidden until there is somebody in the boat, because a row of
    //    three empty outlines on the way out reads as a score you are losing.
    this.aboardRow = el('div', 'hud-aboard');
    this.aboardRow.hidden = true;
    this.aboardRow.appendChild(el('div', 'hud-label', 'Aboard'));
    this.aboardPips = el('div', 'hud-aboard-pips');
    this.aboardRow.appendChild(this.aboardPips);
    p.appendChild(this.aboardRow);

    wrap.appendChild(p);

    /* ---- The heading ribbon, across the very top ---- */
    /*
     * You steer a boat to a bearing and hold it. A bare three-digit number is
     * hard to hold: it tells you where you are pointing but not which way you
     * are swinging, so the correction is always one beat late. A tape that
     * slides tells you both, and it is the same instrument that is on the
     * bulkhead of every real boat this game is pretending to be.
     *
     * Canvas rather than DOM: it is one 2D context redrawn only when the
     * heading has actually moved half a degree, which on a school Chromebook
     * costs less than the twenty-odd absolutely-positioned tick marks the DOM
     * version would need.
     */
    const rib = el('div', 'hud-ribbon');
    this.ribbonCanvas = el('canvas', 'hud-ribbon-canvas');
    this.ribbonValue = el('div', 'hud-ribbon-value', '090');
    rib.appendChild(this.ribbonCanvas);
    rib.appendChild(this.ribbonValue);
    this.ribbon = rib;
    wrap.appendChild(rib);

    /* ---- Sea state, tucked under the wind ---- */
    this.sea = el('div', 'hud-sea', 'Sea: calm');
    const right = wrap.querySelector('.hud-right .hud-windinfo');
    if (right) right.appendChild(this.sea);
    else wrap.appendChild(this.sea);

    /* ---- Aground caption, middle of the screen ---- */
    /*
     * Deliberately NOT the stall warning's red slab. Touching the bottom in
     * this game is a stop and a dent, not a death, and the caption has to say
     * so or the child simply stops going near the shallow water — which is the
     * only interesting water on the map.
     */
    this.aground = el('div', 'hud-aground', '');
    this.aground.style.display = 'none';
    wrap.appendChild(this.aground);

    /* ---- The arrow, under the objective ---- */
    /*
     * Every shout's text says "the arrow at the top of the screen points at
     * them", and in the boat there was no arrow: the aeroplane's waypoint
     * arrow is only ever updated by the flight loop, so it was either hidden
     * or frozen pointing wherever the last flight had been going. This one is
     * the boat's. It points at the next corner of a route that keeps her
     * afloat (see boatRoute in missions-boat.js), and says how far the
     * target itself is.
     */
    this.arrow = el('div', 'hud-boatarrow');
    this.arrowGlyph = el('div', 'hud-boatarrow-glyph', '\u2191');
    this.arrowText = el('div', 'hud-boatarrow-text', '');
    this.arrow.appendChild(this.arrowGlyph);
    this.arrow.appendChild(this.arrowText);
    const top = wrap.querySelector('.hud-top');
    (top || wrap).appendChild(this.arrow);

    /* ---- The keys, bottom centre, where the aeroplane's strip was ---- */
    this.keys = el(
      'div',
      'hud-boatkeys',
      '<kbd>W</kbd> or <kbd>Shift</kbd> faster · <kbd>S</kbd> or <kbd>Ctrl</kbd> slower · '
        + '<kbd>A</kbd> <kbd>D</kbd> or <kbd>←</kbd> <kbd>→</kbd> steer · <kbd>Space</kbd> stop · <kbd>J</kbd> chart'
    );
    wrap.appendChild(this.keys);

    /* ---- Shallow water ahead: said before the bump, not after ---- */
    this.shoalWarn = el('div', 'hud-shoalwarn', '');
    wrap.appendChild(this.shoalWarn);
    this.route = { x: 0, z: 0, routed: false, legs: 0 };
    this.routeT = 0;
    this.hidden = [];
  }

  /* ------------------------------------------------------ enter/leave -- */

  /** Boat mode on: build if needed, show the boat panel, hide the aeroplane's. */
  enter(spec, sim) {
    injectCss();
    this.build();
    this.active = true;
    this.sim = sim || null;
    this.hud.wrap.classList.add('is-boat');
    this.panel.style.display = '';
    this.ribbon.style.display = '';
    if (this.sea) this.sea.style.display = '';
    if (spec && spec.name) this.boatName.textContent = spec.name;
    this.last = {};
    this.setAboard(0, 0);
    this.setAground(false);
    this.shoalWarn.classList.remove('is-on');
    this.arrowText.textContent = '';
    this.routeT = 0;
    this.clearT = 0;
    this.windT = 0;
    // A new trip can be a new map, and a new map is a new sea floor.
    resetBoatRoute();
    try {
      if (sim) warmBoatRoute(sim);
    } catch (e) {
      console.warn('No route grid for this harbour yet; the arrow will point straight.', e);
    }
    // Anything of the airfield hanging in the air over this harbour, for the
    // length of the trip. See hideStrayAirfield.
    restoreStrayAirfield(this.hidden);
    try {
      this.hidden = hideStrayAirfield(sim);
    } catch (e) {
      console.warn('Could not tidy the airfield out of the harbour:', e);
      this.hidden = [];
    }
  }

  /** Back to the aeroplane. */
  leave() {
    this.active = false;
    if (!this.built) return;
    this.hud.wrap.classList.remove('is-boat');
    this.panel.style.display = 'none';
    this.ribbon.style.display = 'none';
    if (this.sea) this.sea.style.display = 'none';
    this.aground.style.display = 'none';
    this.shoalWarn.classList.remove('is-on');
    this.pingTimer = 0;
    restoreStrayAirfield(this.hidden);
    if (this.hud.setMissionClock) this.hud.setMissionClock(null);
    // The player's own weather, if a shout borrowed the sky (main.js,
    // startDrive). leave() is the one door out of the boat that every route
    // takes — stopDrive, and straight into the van.
    const sim = this.sim;
    if (sim && sim._weatherBeforeBoat && sim.weather) {
      sim.weather.load(sim._weatherBeforeBoat);
      sim._weatherBeforeBoat = null;
    }
  }

  /* ------------------------------------------------------------ depth -- */

  /**
   * The gap between the bottom of the boat and the bottom of the sea.
   *
   * heightAt is negative at sea, so -h is the depth of water and taking the
   * draught off it gives the number that actually matters. When terrain.js
   * gains depthUnderKeel(x, z, draught) this whole function becomes a call to
   * it; it is written out here so the HUD ships without waiting for that.
   */
  depthFor(x, z) {
    return -heightAt(x, z) - this.draught;
  }

  /* ----------------------------------------------------------- update -- */

  /**
   * One frame.
   *
   * @param {number} dt
   * @param {object} r     vehicle.readouts()
   * @param {object} ctx   { pos, weather, audio, depth }
   *                       pos and weather come straight off the sim; depth is
   *                       optional and overrides our own sounding, so a mission
   *                       can lie about it (a fouled transducer) later without
   *                       this file knowing.
   */
  update(dt, r, ctx = {}) {
    if (!this.active) return;
    this.tickHudTimers(dt);
    const pos = ctx.pos;
    const depth = typeof ctx.depth === 'number'
      ? ctx.depth
      : pos ? this.depthFor(pos.x, pos.z) : 99;

    /* ---- Depth ---- */
    // Rounded to a tenth under 10 m and to the metre above it: the difference
    // between 1.4 m and 1.1 m is the whole game, and the difference between
    // 41 m and 44 m is nothing at all.
    // Never below nothing: between touching (0) and AGROUND (-0.3) the swell
    // lifting the hull read "-0.1" and "-0.0", which is not a depth.
    const shown = depth < 10 ? Math.max(0, Math.round(depth * 10) / 10) : Math.round(depth);
    if (this.last.depth !== shown) {
      this.last.depth = shown;
      this.depthValue.textContent =
        depth <= -0.3 ? 'AGROUND' : depth < 10 ? shown.toFixed(1) : String(shown);
      this.depthValue.classList.toggle('is-aground', depth <= -0.3);
    }
    const band = depth < 1 ? 2 : depth < 3 ? 1 : 0;
    if (this.last.depthBand !== band) {
      this.last.depthBand = band;
      this.depthWord.textContent = band === 2 ? 'SHALLOW' : band === 1 ? 'shoaling' : 'deep water';
      this.panel.classList.toggle('is-shoal', band === 1);
      this.panel.classList.toggle('is-shallow', band === 2);
    }

    /* ---- The echo sounder ---- */
    /*
     * Under three metres a ping starts, and it quickens as it shallows. This
     * is the single most useful thing on the boat HUD and it is not on the
     * HUD at all: the whole point is that your eyes are out of the window
     * looking for a person in the water, and the ear is what keeps you off
     * the rock while they are. A number you have to glance down at is a number
     * you glance down at once, too late.
     */
    this.updateSounder(dt, depth, ctx.audio);

    /* ---- Speed ---- */
    const kt = Math.round(r.speedKts || 0);
    const idx = leverIndex(r);
    if (this.last.kt !== kt || this.last.lever !== idx) {
      this.last.kt = kt;
      this.spdValue.textContent = String(kt);
      // "Carrying her way" is the sentence this game exists to teach, so it is
      // said out loud rather than left for the child to infer from a bar that
      // reads zero while the boat is still going somewhere.
      this.spdWord.textContent =
        idx <= 1 && kt > 2 ? 'carrying her way'
          : kt < 1 ? 'stopped'
          : kt < 8 ? 'idling along'
          : kt < 25 ? 'making way'
          : 'on the plane';
    }

    /* ---- The lever ---- */
    if (this.last.lever !== idx) {
      this.last.lever = idx;
      for (let i = 0; i < this.leverCells.length; i++) {
        this.leverCells[i].classList.toggle('is-on', i === idx);
      }
      this.leverCells[0].classList.toggle('is-astern', idx === 0);
    }

    /* ---- Heading ribbon ---- */
    const hdg = (((r.heading || 0) % 360) + 360) % 360;
    if (this.last.hdg === undefined || Math.abs(hdg - this.last.hdg) > 0.4) {
      this.last.hdg = hdg;
      this.drawRibbon(hdg);
      this.ribbonValue.textContent = String(Math.round(hdg) % 360).padStart(3, '0');
    }

    /* ---- Sea state ---- */
    /*
     * The boat's own word for the sea she is in, which knows about the
     * breakwater (surface.js, harbourShelter). This used to work its own word
     * out from the weather, with different edges from the boat's: at the
     * berth in First Shout the panel said "Sea: choppy" while the boat was
     * being moved by a calm, under "Air is calm".
     */
    const sea = r.seaWord || seaStateWord(ctx.weather);
    if (this.last.sea !== sea) {
      this.last.sea = sea;
      this.sea.textContent = `Sea: ${sea}`;
      this.sea.classList.toggle('is-rough', sea === 'rough');
      this.sea.classList.toggle('is-gale', sea === 'gale');
    }

    const sim = ctx.sim || this.sim;
    const boat = ctx.boat || (sim && sim.vehicle) || null;

    /* ---- The wind box ---- */
    this.updateWind(dt, r, ctx.weather);

    /* ---- Who is aboard ---- */
    // missions-boat.js has published `sim.boatAboard` since it was written,
    // and nothing read it, so the row of little figures never lit.
    const ab = sim && sim.boatAboard;
    const abN = ab ? ab.aboard * 100 + ab.total : -1;
    if (this.last.abN !== abN) {
      this.last.abN = abN;
      this.setAboard(ab ? ab.aboard : 0, ab ? ab.total : 0);
    }

    /* ---- On the bottom: what happened and what she is doing about it ---- */
    const agr = !!(boat && boat.aground);
    const agrText = agr ? boat.agroundMessage || '' : '';
    /*
     * And what happens once she is off. surface.js hands the helm back with
     * the lever on STOP and ignores a key that was held through the bump
     * until it is pressed again — so a child still holding Shift sat there
     * with nothing happening and nothing on screen to say why. For four
     * seconds after she comes off, the caption says what to press.
     */
    if (this.last.agr && !agr) this.clearT = 4;
    this.clearT = Math.max(0, (this.clearT || 0) - dt);
    const cap = agr ? agrText : this.clearT > 0 ? CLEAR_WORDS : '';
    if (this.last.agrCap !== cap) {
      this.last.agrCap = cap;
      if (agr) this.setAground(true, agrText);
      else if (cap) this.setClear();
      else this.setAground(false);
    }
    this.last.agr = agr;

    /* ---- Shallow water ahead ---- */
    const ahead = !agr && !cap && boat ? boat.shoalAhead || 0 : 0;
    const aheadKey = ahead ? (ahead < 20 ? 1 : 2) : 0;
    if (this.last.ahead !== aheadKey) {
      this.last.ahead = aheadKey;
      this.shoalWarn.classList.toggle('is-on', !!aheadKey);
      this.shoalWarn.textContent = aheadKey
        ? 'SHALLOW WATER AHEAD — turn away, or S / Ctrl to slow down'
        : '';
    }

    /* ---- The mission clock, if this shout has one ---- */
    const runner = sim && sim.runner;
    const def = runner && runner.status === 'running' ? runner.def : null;
    if (this.hud.setMissionClock) {
      const left = def && def.timeLimit ? Math.ceil(def.timeLimit - runner.elapsed) : null;
      if (this.last.clock !== left) {
        this.last.clock = left;
        this.hud.setMissionClock(left);
      }
    }

    this.updateArrow(dt, r, ctx.target || (sim && sim.activeTarget) || null, boat, sim);
  }

  /* ----------------------------------------------------------- timers -- */

  /**
   * Let the radio line, the banner and the toasts run out.
   *
   * Their clocks are counted down at the end of Hud.update(), and Hud.update
   * is only ever called by the flight loop — so in the boat nothing that was
   * put on the screen ever came off it. Measured in First Shout, twenty
   * seconds in: the Coastguard's opening call (a few seconds of subtitle)
   * and the 8-second "Tap Shift to go faster" notice were both still up, and the
   * subtitle sat across the bottom of the picture over the launch's stern
   * for the whole trip; the toast stack only ever emptied by being pushed
   * past four. Hud.updateOverlays() is that same countdown — the radio
   * line's fade and the objective folding to its chip included — so a line
   * said in the boat lasts exactly as long as one said in the air. Called
   * here, and only while the boat is up.
   */
  tickHudTimers(dt) {
    if (this.hud.updateOverlays) this.hud.updateOverlays(dt);
  }

  /* ------------------------------------------------------------ arrow -- */

  /**
   * The arrow.
   *
   * The route is asked for four times a second (see boatRoute: it is a few
   * hundred heightAt calls at most), the arrow is turned every frame from
   * the answer, and the words change only when the rounded distance does.
   */
  updateArrow(dt, r, target, boat, sim) {
    if (!target || !target.pos || !boat) {
      if (this.last.arrowOn !== false) {
        this.last.arrowOn = false;
        this.arrow.style.visibility = 'hidden';
      }
      return;
    }
    if (this.last.arrowOn !== true) {
      this.last.arrowOn = true;
      this.arrow.style.visibility = '';
    }
    this.routeT -= dt;
    if (this.routeT <= 0 || this.last.targetLabel !== target.label) {
      this.routeT = 0.25;
      try {
        boatRoute(sim, boat.pos, target.pos, this.route);
      } catch (e) {
        this.route.x = target.pos.x;
        this.route.z = target.pos.z;
        this.route.routed = false;
      }
    }
    const dx = this.route.x - boat.pos.x;
    const dz = this.route.z - boat.pos.z;
    const brg = (Math.atan2(dx, -dz) * 180) / Math.PI;
    const rel = ((brg - (r.heading || 0) + 540) % 360) - 180;
    /** The relative bearing the arrow shows, for tests and for the curious. */
    this.arrowRel = rel;
    const rounded = Math.round(rel);
    if (this.last.rel !== rounded) {
      this.last.rel = rounded;
      this.arrowGlyph.style.transform = `rotate(${rounded}deg)`;
      this.arrow.dataset.rel = String(rounded);
    }
    const dist = Math.hypot(target.pos.x - boat.pos.x, target.pos.z - boat.pos.z);
    const near = dist < 120;
    // Compared as numbers, and the words built only when one changes: this
    // runs every frame and a template string is a new object each time.
    const distQ = dist > 1200 ? -Math.round(dist / 100) : Math.round(dist / (near ? 5 : 10)) * (near ? 5 : 10);
    const turnI = Math.abs(rel) < 12 ? 0 : rel > 0 ? 1 : 2;
    const routed = this.route.routed ? 1 : 0;
    if (
      this.last.distQ !== distQ || this.last.turnI !== turnI || this.last.routed !== routed
      || this.last.targetLabel !== target.label
    ) {
      this.last.distQ = distQ;
      this.last.turnI = turnI;
      this.last.routed = routed;
      this.last.targetLabel = target.label;
      const distText = distQ < 0 ? `${(-distQ / 10).toFixed(1)} km` : `${distQ} m`;
      const turn = TURN_WORDS[turnI];
      const hint = routed ? `${turn} · going round the shallows` : turn;
      this.arrowText.innerHTML = `${target.label || 'Target'} · ${distText}<small>${hint}</small>`;
      this.arrow.classList.toggle('is-near', near);
    }
  }

  /* ------------------------------------------------------------- wind -- */

  /**
   * The wind box, top right.
   *
   * It belongs to hud.js and is written by Hud.update(), which only the
   * flight loop calls, so in the boat it showed whatever the last flight or
   * the menu had left in it. Measured at the start of First Shout: "Air is
   * calm · 0 kt from 090°" while the shout's own weather — loaded, and
   * pushing her — was 7 kt from 240. In the Gale it said the same thing in
   * 28 kt. This writes it the way Hud.update does, through the same
   * `lastValues` cache, so the flight loop picks up exactly where this left
   * off; five times a second, because the wind does not change faster than
   * that and windDescription() builds an object.
   */
  updateWind(dt, r, w) {
    const h = this.hud;
    if (!w || !h.windText || !h.lastValues || typeof w.windDescription !== 'function') return;
    this.windT = (this.windT || 0) - dt;
    if (this.windT > 0) return;
    this.windT = 0.2;
    const lv = h.lastValues;
    const heading = r.heading || 0;
    const desc = w.windDescription(heading);
    if (lv.windText !== desc.text) {
      h.windText.textContent = desc.text;
      lv.windText = desc.text;
    }
    const detail = `${Math.round(w.windSpeedKts)} kt from ${String(Math.round(w.windDirDeg)).padStart(3, '0')}°`;
    if (lv.windDetail !== detail) {
      h.windDetail.textContent = detail;
      lv.windDetail = detail;
    }
    if (h.windNeedle) {
      const rel = Math.round(((w.windDirDeg - heading + 540) % 360) - 180);
      if (this.last.windRel !== rel) {
        this.last.windRel = rel;
        h.windNeedle.style.transform = `rotate(${rel}deg)`;
      }
    }
    if (h.weatherText && w.cond && w.timeInfo) {
      const wx = `${w.cond.label} · ${w.timeInfo.label}`;
      if (lv.wx !== wx) {
        h.weatherText.textContent = wx;
        lv.wx = wx;
      }
    }
  }

  /* ---------------------------------------------------------- sounder -- */

  updateSounder(dt, depth, audio) {
    if (!audio || !audio.available || depth > 3 || depth < -0.5) {
      this.pingTimer = 0;
      return;
    }
    // 1.6 s at three metres down to a quarter of a second on the putty. The
    // pitch climbs with it, because two cues are easier to read than one.
    const f = clamp(depth / 3, 0, 1);
    const interval = 0.25 + f * 1.35;
    this.pingTimer -= dt;
    if (this.pingTimer > 0) return;
    this.pingTimer = interval;
    const mixer = audio.mixer;
    if (!mixer || !mixer.tone) return;
    mixer.tone({
      bus: 'alerts',
      freq: 1500 - f * 560,
      duration: 0.07,
      gain: 0.055 + (1 - f) * 0.045,
      type: 'sine',
    });
  }

  /* ----------------------------------------------------------- ribbon -- */

  drawRibbon(hdg) {
    const c = this.ribbonCanvas;
    const w = c.clientWidth || 420;
    const h = c.clientHeight || 26;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    /*
     * Laid out top down: the numbers, then the ticks hanging under them, then
     * the lubber line pointing up at the one you are actually steering.
     *
     * The lubber line is drawn here rather than laid over the tape as its own
     * element. An absolutely-positioned marker has to be told where the middle
     * of the canvas is, and the canvas does not start at the middle of the
     * ribbon once the heading number is sitting beside it — so it ends up a
     * few pixels off the thing it is supposed to be pointing at, which on a
     * compass is the only pixel that matters.
     */
    const labelY = h * 0.28;
    const tickTop = h * 0.52;

    // Sixty degrees either side of where the bow is pointing. Wider than that
    // and the ticks crowd; narrower and a turn scrolls past too fast to read.
    const SPAN = 120;
    const pxPerDeg = w / SPAN;
    const start = Math.floor((hdg - SPAN / 2) / 10) * 10;
    g.font = '600 10px -apple-system, Segoe UI, Roboto, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let d = start; d <= hdg + SPAN / 2 + 10; d += 10) {
      const x = w / 2 + (d - hdg) * pxPerDeg;
      if (x < -20 || x > w + 20) continue;
      const deg = ((d % 360) + 360) % 360;
      const cardinal = deg % 90 === 0;
      const major = deg % 30 === 0;
      g.strokeStyle = cardinal ? 'rgba(126, 232, 178, 0.95)' : 'rgba(159, 178, 204, 0.5)';
      g.lineWidth = cardinal ? 2 : 1;
      g.beginPath();
      g.moveTo(x, tickTop);
      g.lineTo(x, major ? h * 0.82 : h * 0.70);
      g.stroke();
      if (major) {
        g.fillStyle = cardinal ? 'rgba(126, 232, 178, 0.95)' : 'rgba(159, 178, 204, 0.8)';
        // 030 is written 03, the way it is painted on a real compass card —
        // three digits at this size are unreadable and the trailing zero never
        // told anybody anything.
        const label = cardinal
          ? ['N', 'E', 'S', 'W'][deg / 90]
          : String(deg / 10).padStart(2, '0');
        g.fillText(label, x, labelY);
      }
    }

    // The lubber line: where the bow is pointing, under the tape.
    g.fillStyle = 'rgba(255, 194, 71, 0.95)';
    g.beginPath();
    g.moveTo(w / 2, h * 0.84);
    g.lineTo(w / 2 - 5, h);
    g.lineTo(w / 2 + 5, h);
    g.closePath();
    g.fill();
  }

  /* ------------------------------------------------------------ people -- */

  /**
   * How many people are in the boat.
   *
   * Little figures rather than "2/3", because this is the entire emotional
   * payload of the game and a fraction is a score. A figure that fills in when
   * you get someone aboard is the thing a ten-year-old will remember.
   */
  setAboard(n, of) {
    this.build();
    this.aboard = n | 0;
    this.aboardOf = of | 0 || this.aboard;
    const total = Math.max(this.aboardOf, this.aboard);
    this.aboardRow.hidden = total <= 0;
    if (total <= 0) {
      this.aboardPips.innerHTML = '';
      return;
    }
    const key = `${this.aboard}/${total}`;
    if (this.last.aboard === key) return;
    this.last.aboard = key;
    let html = '';
    for (let i = 0; i < total; i++) {
      const on = i < this.aboard;
      html += `<span class="hud-pip${on ? ' is-on' : ''}" aria-hidden="true">`
        + '<svg viewBox="0 0 12 18"><circle cx="6" cy="4" r="3.1"/>'
        + '<path d="M6 8.2c-2.6 0-4.2 1.7-4.2 4.2V18h8.4v-5.6c0-2.5-1.6-4.2-4.2-4.2z"/></svg></span>';
    }
    this.aboardPips.innerHTML = html;
    this.aboardRow.setAttribute('aria-label', `${this.aboard} of ${total} aboard`);
  }

  /* ----------------------------------------------------------- aground -- */

  /**
   * On the putty.
   *
   * @param {boolean} on
   * @param {string}  [text] what to say, if not the default
   */
  setAground(on, text) {
    this.build();
    if (!on) {
      this.aground.style.display = 'none';
      return;
    }
    // She backs herself off now (surface.js, takeTheGround), so the second
    // line says what happens next rather than asking for a key she is
    // already obeying.
    this.aground.innerHTML =
      `<strong>${text || "You're on the putty"}</strong>`
      + '<em>Backing off to deep water — then steer for the arrow</em>';
    this.aground.style.display = '';
  }

  /** Off the bottom again, and what to press now. See update(). */
  setClear() {
    this.build();
    this.aground.innerHTML = `<strong>${CLEAR_WORDS}</strong><em>Tap W or Shift to go, and steer for the arrow</em>`;
    this.aground.style.display = '';
  }

  /* ------------------------------------------------------------- shout -- */

  /**
   * The radio call, in the objective panel.
   *
   * Reuses hud.setObjective rather than building a second banner: the panel is
   * already top-centre, already flashes when the text changes, and already has
   * the mission clock and the bearing pill underneath it. A shout is an
   * objective wearing a lifejacket.
   *
   * @param {object|null} s  { kind, vessel, what, where } or null to clear
   */
  setShout(s) {
    if (!s) {
      this.hud.setObjective('At sea', 'Out on patrol. Keep an eye on the depth.');
      return;
    }
    const title = (s.kind || 'MAYDAY').toUpperCase();
    const parts = [s.vessel, s.what, s.where].filter(Boolean);
    this.hud.setObjective(title, parts.join(' · '));
  }
}
