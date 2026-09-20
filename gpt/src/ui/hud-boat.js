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
  }

  /* ------------------------------------------------------ enter/leave -- */

  /** Boat mode on: build if needed, show the boat panel, hide the aeroplane's. */
  enter(spec) {
    this.build();
    this.active = true;
    this.hud.wrap.classList.add('is-boat');
    this.panel.style.display = '';
    this.ribbon.style.display = '';
    if (this.sea) this.sea.style.display = '';
    if (spec && spec.name) this.boatName.textContent = spec.name;
    this.last = {};
    this.setAboard(0, 0);
    this.setAground(false);
    // The hint strip under the throttle bar is aeroplane words. Swapping it is
    // the cheapest single thing on this list: the keys are the same keys, and
    // the only reason a child does not find them is that the strip is talking
    // about power and brakes, neither of which is a thing on a boat.
    if (this.hud.keyHint) {
      this.hud.keyHint.innerHTML =
        'Engine: <kbd>Shift</kbd>/<kbd>↑</kbd> ahead · <kbd>Ctrl</kbd>/<kbd>↓</kbd> back · '
        + '<kbd>A</kbd><kbd>D</kbd> wheel · <kbd>J</kbd> chart';
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
    this.pingTimer = 0;
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
    const pos = ctx.pos;
    const depth = typeof ctx.depth === 'number'
      ? ctx.depth
      : pos ? this.depthFor(pos.x, pos.z) : 99;

    /* ---- Depth ---- */
    // Rounded to a tenth under 10 m and to the metre above it: the difference
    // between 1.4 m and 1.1 m is the whole game, and the difference between
    // 41 m and 44 m is nothing at all.
    const shown = depth < 10 ? Math.round(depth * 10) / 10 : Math.round(depth);
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
    const sea = seaStateWord(ctx.weather);
    if (this.last.sea !== sea) {
      this.last.sea = sea;
      this.sea.textContent = `Sea: ${sea}`;
      this.sea.classList.toggle('is-rough', sea === 'rough');
      this.sea.classList.toggle('is-gale', sea === 'gale');
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
    this.aground.innerHTML =
      `<strong>${text || "You're on the putty"}</strong>`
      + '<em>Astern, gently — <kbd>Ctrl</kbd> or <kbd>↓</kbd> to back off</em>';
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
