/**
 * The helicopter's half of the head-up display.
 *
 * WHAT WAS WRONG BEFORE THIS FILE
 *
 * Picking Heli in the menu bar gave you a different airframe and the
 * aeroplane's instruments. In a hover those instruments are not merely
 * unhelpful, they are actively wrong:
 *
 *   Airspeed reads 3 kt. That is not a number, it is noise, and the panel
 *   painted it amber and shouted TOO SLOW — ADD POWER at a machine that was
 *   doing exactly what it was told. (See the stall guard in hud.js; that one
 *   is a one-line fix and it is listed with this drop-in.)
 *
 *   Altitude reads height above the SEA. The number that decides whether the
 *   winch reaches, or whether you are about to put the skids through a rock,
 *   is the twenty metres between you and the ground directly underneath.
 *
 *   Nothing at all showed which way you were sliding over the ground, which
 *   is the single thing hovering consists of.
 *
 * So the strip becomes two strips — CRUISE and HOVER — and swaps itself on
 * groundspeed. Everything in here is additive: it lives in its own file, it is
 * mixed into the Hud prototype, and an aeroplane never builds a single node of
 * it. If SPEC.rotor is false this module costs one boolean comparison a frame.
 *
 * WHY THE HOVER READOUT IS A DRIFT CROSS AND NOT A RING IN THE SKY
 *
 * missions.js line 24 already made this decision and was right: a glowing hoop
 * teaches you to stare at the hoop, and the island underneath becomes
 * wallpaper. A hoop you must sit inside for ten seconds would be worse, not
 * better. So the target is a real lit circle on the real ground with smoke and
 * a person in it, and the abstraction lives here on the panel where
 * abstractions belong: a dot in a box that shows which way you are sliding and
 * how fast. Centre the dot. That is the whole instrument, and a ten-year-old
 * has it in two seconds.
 *
 * WHAT IT READS, AND WHAT IS OPTIONAL
 *
 * Everything it needs today already exists: `sim.aircraft.vel`, `.heading`,
 * `.agl`, `readouts()` and `SPEC`. The winch is somebody else's week, so the
 * hold gauge reads an OPTIONAL `sim.hoverBox` and every field on it is
 * optional too — the panel degrades to instruments alone rather than throwing.
 * The shape it expects, when it arrives:
 *
 *   sim.hoverBox = {
 *     pos:     { x, y, z },   // centre of the lit circle, world metres
 *     radius:  12,            // metres; how far off the spot the winch allows
 *     minAgl:  15, maxAgl: 25,// metres; the band the cable needs
 *     need:    10,            // seconds of good hover required
 *     held:    0,             // seconds banked so far. DRAINS, never resets.
 *     label:  'Swimmer',      // shown under the gauge
 *     // Optional; computed here from the fields above when absent, so the
 *     // panel is honest even against a half-built winch.
 *     driftOk, inCircle, aglOk,
 *   }
 *
 * It also reads an optional `sim.rescue = { aboard, saved }` for the counter
 * on the objective panel, and `sim.settings.hoverAssist` for the chip.
 */

import { SPEC } from '../aircraft/physics.js';
import { ROTOR_TUNE } from '../aircraft/rotor-assist.js';
import { rekey } from '../flight/input.js';

/* Groundspeed, in knots, at which the panel swaps.
 *
 * Hysteresis is not a nicety. With a single threshold the panel flips back and
 * forth while the machine decelerates through it, which is precisely the
 * moment the pilot most needs the numbers to sit still. 30 kt in, 45 kt out. */
const HOVER_ENTER_KTS = 30;
const HOVER_LEAVE_KTS = 45;

/* The drift box. Full scale at the edge, and the ring inside it is the
 * tolerance the winch will actually accept. Both are display constants; the
 * authority on what passes is sim.hoverBox, not this file. */
const DRIFT_FULL = 4.0;   // m/s at the edge of the box
const DRIFT_TOL = 1.5;    // m/s — inside the ring is good enough to winch
const VS_FULL = 500;      // ft/min at either end of the vertical-speed bar

/* Circumference of the hold arc's circle, r = 46 in its own viewBox. */
const ARC_C = 2 * Math.PI * 46;

const M_TO_FT = 3.28084;

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/*
 * The helicopter card's own stylesheet. styles/main.css is somebody else's
 * file this week, so the card brings its rules with it, once, on first use.
 */
const HELI_CSS = `
.hud-heli { width: 218px; margin-top: 10px; padding-top: 9px; border-top: 1px solid rgba(140, 180, 230, 0.14); }
.hud-heli[hidden] { display: none; }
/* On a touch screen the instruments are one band across the top, so the card
   hangs under the right-hand end of it, clear of the thumbs. It was in the
   bottom strip, which a touch screen hides: an iPad never saw it at all. */
.hud.is-touch .hud-heli {
  position: absolute; top: calc(100% + 8px); right: 0; width: 236px; margin: 0;
  padding: 8px 10px; border: 1px solid var(--panel-line); border-radius: var(--radius);
  background: var(--panel); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
}
@media (pointer: coarse) and (max-height: 460px) {
  .hud.is-touch .hud-heli-say { display: none; }
}
/* And the objective under the hover band, not behind it. Measured on an
   emulated 1024 x 768 iPad, hovering: the band runs from y66 to y179 and the
   objective panel starts at y140, so its first line was under the band.
   (A phone, under 621 px, already puts the objective at y232.) */
@media (min-width: 621px) {
  .hud.is-touch.is-rotorhover .hud-top { top: 188px; }
}
.hud-heli-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.hud-heli-state { font-size: 12px; font-weight: 700; letter-spacing: 0.1em; color: var(--accent); }
.hud-heli-state.is-good { color: var(--good); }
.hud-heli-state.is-warn { color: var(--amber); }
.hud-heli-h { display: flex; align-items: baseline; gap: 4px; }
.hud-heli-hv { font-size: 24px; font-weight: 660; line-height: 1; letter-spacing: -0.02em; }
.hud-heli-hu { font-size: 11px; color: var(--text-dim); }
.hud-heli-vs { font-size: 12px; color: var(--text-dim); font-family: var(--mono); margin-top: 2px; text-align: right; }
.hud-heli-say { font-size: 12px; line-height: 1.3; margin-top: 4px; color: #e4edf8; }
.hud-heli-land { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 12px; }
.hud-heli-land[hidden] { display: none; }
.hud-heli-land b { font-size: 10px; letter-spacing: 0.1em; color: var(--text-dim); font-weight: 600; }
.hud-heli-land i { display: inline-block; width: 14px; height: 14px; border-radius: 50%; background: rgba(255, 255, 255, 0.12); }
.hud-heli-land.is-good i { background: var(--good); box-shadow: 0 0 10px rgba(79, 214, 132, 0.8); }
.hud-heli-land.is-warn i { background: var(--amber); box-shadow: 0 0 10px rgba(255, 194, 71, 0.8); }
.hud-heli-land.is-bad i { background: var(--red); box-shadow: 0 0 10px rgba(255, 106, 90, 0.9); }
.hud-heli-land.is-good span { color: var(--good); }
.hud-heli-land.is-warn span { color: var(--amber); }
.hud-heli-land.is-bad span { color: var(--red); }
.hud-bar[hidden] { display: none; }
/* The lever's row says COLLECTIVE, which is wider than the 44 px the aeroplane's
   POWER gets: measured at 1280 x 800, the word ran 26 px into the bar under it. */
.hud.is-rotor .hud-bar { grid-template-columns: 74px 1fr 36px; }
/* The PAPI is a runway's glide path. Measured: hovering by Kestrel's pad the
   panel said "Too high — ease off and descend" at a helicopter sitting still. */
.hud.is-rotor .hud-papi { display: none !important; }
@media (max-width: 620px) {
  .hud-heli-hv { font-size: 19px; }
  .hud-heli-say { font-size: 11px; }
}
`;

function injectHeliCss() {
  if (typeof document === 'undefined' || document.getElementById('hud-heli-css')) return;
  const st = document.createElement('style');
  st.id = 'hud-heli-css';
  st.textContent = HELI_CSS;
  document.head.appendChild(st);
}

/*
 * What the card says, per state: what the stability assist is actually doing,
 * because the old chip said HOVER ASSIST the whole time — measured on the
 * unmodified build, it said so through a 12 m/s climb to 228 m with the
 * height hold refusing to engage, which is the panel lying at the one moment
 * it matters. Every player flies the same lever; the words follow it.
 */
const HELI_WORDS = {
  engine: ['ENGINE OFF', 'Press I to start the engine.', 'warn'],
  off: ['ASSIST OFF', 'No help at all. The lever and the stick are all yours. F turns the assist back on.', 'warn'],
  ground: ['ON THE GROUND', 'Hold Shift to raise the collective until she lifts.', ''],
  climbing: ['CLIMBING', 'Let go of Shift and the assist stops the climb and holds the height.', ''],
  descending: ['COMING DOWN', 'Hold Ctrl to land — it eases off near the ground. Let go to hold this height.', ''],
  landing: ['LANDING', 'Keep holding Ctrl until the skids touch.', ''],
  // Ctrl held at speed: the assist keeps the skids up until it slows.
  gate: ['SLOW DOWN TO LAND', 'Too fast to put her down. Let go of W, or brake with S, and she comes down the rest.', 'warn'],
  // Ctrl held with a wing tip, the nose or the tail over an edge.
  edge: ['CAN\u2019T LAND HERE', 'Part of her is over an edge or a slope. Turn her across or down the slope with Q or E, or move over flatter ground or the middle of the H.', 'warn'],
  // The height hold climbing for high ground or a roof on the track ahead.
  terrain: ['CLIMBING OVER HIGH GROUND', 'The ground ahead is higher, so the assist is climbing. Ease off W if it is close.', 'warn'],
  lever: ['ON THE LEVER', 'Let go of Shift and Ctrl and the assist holds this height.', ''],
  hover: ['HOVERING', 'Holding this height and this spot over the ground. Hands off is fine.', 'good'],
  height: ['HEIGHT HOLD', 'Holding this height. Let go of the stick and she levels out and slows.', 'good'],
  autopilot: ['AUTOPILOT', 'The autopilot is flying. Move the stick or the lever to take over.', 'good'],
};

/*
 * The same lines on a touch screen, where there is no Shift, Ctrl, W or F:
 * the lever is the slider under the right thumb and the stick is the left
 * one. Measured at 1024 x 768 and 390 x 844 with real touches on the
 * slider: the card said "Let go of Shift" to a thumb.
 */
const TOUCH_SAY = {
  // The pad beside the lever reads START while the engine is off (ui/touch.js).
  engine: 'Tap START to start the engine.',
  off: 'No help at all. The lever and the stick are all yours. Switch the assist back on in Settings.',
  ground: 'Slide the lever up until she lifts.',
  climbing: 'Let go of the lever and the assist stops the climb and holds the height.',
  descending: 'Keep the lever down to land — it eases off near the ground. Let go to hold this height.',
  landing: 'Keep the lever down until the skids touch.',
  gate: 'Too fast to put her down. Let go of the stick, or pull it back to brake, and she comes down the rest.',
  edge: 'Part of her is over an edge or a slope. Turn her across or down the slope, or move over flatter ground or the middle of the H.',
  terrain: 'The ground ahead is higher, so the assist is climbing. Ease off the stick if it is close.',
  lever: 'Let go of the lever and the assist holds this height.',
};

/** Everything below is mixed into Hud.prototype by installRotorHud(). */
const ROTOR = {
  /* ------------------------------------------------------------------ */
  /* Building                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Build the hover strip. Called once, the first time a rotorcraft is
   * actually flown — a child who only ever flies the trainer never pays for
   * a single one of these nodes.
   */
  _buildRotor() {
    if (this.rotorPanel) return;

    const p = el('div', 'hud-panel hud-rotor');
    p.appendChild(el('div', 'hud-rotor-head', 'HOVER'));

    /* ---- The drift cross, and the hold arc around it ---- */
    const driftWrap = el('div', 'hud-drift');

    // The arc rings the box rather than sitting somewhere else on the panel,
    // so "centre the dot" and "watch it fill" are one object and one glance
    // instead of two things to look at while the ground is close.
    driftWrap.innerHTML = `
      <svg class="hud-drift-arc" viewBox="0 0 100 100" aria-hidden="true">
        <circle class="hud-drift-arc-bg" cx="50" cy="50" r="46"></circle>
        <circle class="hud-drift-arc-fill" cx="50" cy="50" r="46"
                stroke-dasharray="${ARC_C.toFixed(2)}"
                stroke-dashoffset="${ARC_C.toFixed(2)}"></circle>
      </svg>
      <div class="hud-drift-box">
        <div class="hud-drift-tol"></div>
        <div class="hud-drift-cross"></div>
        <div class="hud-drift-slide"><div class="hud-drift-dot"></div></div>
      </div>`;
    this.driftArc = driftWrap.querySelector('.hud-drift-arc-fill');
    this.driftDot = driftWrap.querySelector('.hud-drift-dot');
    this.driftBox = driftWrap.querySelector('.hud-drift-box');
    /*
     * The dot does not move; a transparent layer exactly the size of the box
     * moves, and the dot rides at its centre.
     *
     * This is not decoration. A percentage in `transform: translate()` is a
     * percentage of the ELEMENT'S OWN box, so translating a 10 px dot by 46%
     * moves it four and a half pixels and the instrument does nothing. Moving
     * a full-size layer instead makes the percentages percentages of the box,
     * which means this works unchanged at every size the CSS gives it — the
     * desktop panel, the squeezed touch strip and the phone — with no layout
     * read per frame and nothing for the compositor to do but translate.
     */
    this.driftSlide = driftWrap.querySelector('.hud-drift-slide');
    // The tolerance ring is drawn from the two constants rather than typed
    // into the stylesheet as "34.5%", so tuning DRIFT_TOL cannot leave the
    // picture disagreeing with the rule.
    const tol = driftWrap.querySelector('.hud-drift-tol');
    const tolPct = (DRIFT_TOL / DRIFT_FULL) * 92;
    tol.style.width = tol.style.height = `${tolPct.toFixed(1)}%`;

    // The vertical-speed bar stands UP the side of the drift box, because up
    // on the screen should mean up in the air. A number that changes sixty
    // times a second cannot be read; a bar that is above or below the middle
    // can be read without reading.
    const vs = el('div', 'hud-vsbar');
    vs.innerHTML = `
      <div class="hud-vsbar-track"><div class="hud-vsbar-fill"></div></div>
      <div class="hud-vsbar-cap">V/S</div>`;
    this.vsBarFill = vs.querySelector('.hud-vsbar-fill');

    /* ---- Radar altimeter and wind, in the column beside the box ----
     *
     * Height above the GROUND, not above the sea. The aeroplane's altimeter
     * answers a question a helicopter is never asking: what matters at the
     * winch is the twenty metres between the skids and the rock underneath,
     * and over a hill those two numbers differ by the whole hill.
     */
    const ra = el('div', 'hud-ra');
    ra.innerHTML = `
      <div class="hud-label">Rad alt</div>
      <div class="hud-ra-line"><span class="hud-ra-value">0</span><span class="hud-unit">ft</span></div>
      <div class="hud-ra-band" hidden>
        <div class="hud-ra-band-good"></div>
        <div class="hud-ra-band-mark"></div>
      </div>`;
    this.raValue = ra.querySelector('.hud-ra-value');
    this.raBand = ra.querySelector('.hud-ra-band');
    this.raBandGood = ra.querySelector('.hud-ra-band-good');
    this.raBandMark = ra.querySelector('.hud-ra-band-mark');

    /* ---- Wind ----
     *
     * A helicopter cares about the wind at zero airspeed, which is exactly the
     * moment the aeroplane's strip stops mentioning it. The arrow is relative
     * to the nose: it points the way the air is pushing you.
     */
    const wd = el('div', 'hud-rwind');
    wd.innerHTML = `
      <div class="hud-label">Wind</div>
      <div class="hud-rwind-body"><span class="hud-rwind-arrow">&#8595;</span><span class="hud-rwind-text">calm</span></div>`;
    this.rWindArrow = wd.querySelector('.hud-rwind-arrow');
    this.rWindText = wd.querySelector('.hud-rwind-text');

    const side = el('div', 'hud-rotor-side');
    side.appendChild(ra);
    side.appendChild(wd);

    const top = el('div', 'hud-rotor-top');
    top.appendChild(driftWrap);
    top.appendChild(vs);
    top.appendChild(side);
    p.appendChild(top);

    /* ---- What the dot is saying, in words as well as a number ---- */
    const info = el('div', 'hud-drift-info');
    this.driftValue = el('div', 'hud-drift-read', '0.0 <span>m/s</span>');
    this.driftWord = el('div', 'hud-word', 'steady');
    info.appendChild(el('div', 'hud-drift-cap', 'DRIFT'));
    info.appendChild(this.driftValue);
    info.appendChild(this.driftWord);
    p.appendChild(info);

    /* ---- Power, with the hover point marked ----
     *
     * The margin above the hover mark IS the game's one resource. A percentage
     * on its own does not show a margin; a gap between where you are and where
     * hovering starts does, and it visibly shrinks when you pick somebody up.
     */
    const pw = el('div', 'hud-power');
    pw.innerHTML = `
      <div class="hud-label">Power</div>
      <div class="hud-power-track">
        <div class="hud-power-fill"></div>
        <div class="hud-power-mark" title="Power needed to hover"></div>
      </div>
      <div class="hud-power-read">50% · hover 50%</div>`;
    this.powerFill = pw.querySelector('.hud-power-fill');
    this.powerMark = pw.querySelector('.hud-power-mark');
    this.powerRead = pw.querySelector('.hud-power-read');
    p.appendChild(pw);

    /* ---- The three conditions, as three lights ----
     *
     * Three separate yes/no answers, not one score. When the arc stops filling
     * a child needs to know WHICH of the three they have lost, and a single
     * amber "not quite" tells them nothing they can act on.
     */
    const hold = el('div', 'hud-hold');
    hold.innerHTML = `
      <div class="hud-hold-lights">
        <span class="hud-hold-lt" data-lt="drift">DRIFT</span>
        <span class="hud-hold-lt" data-lt="pos">SPOT</span>
        <span class="hud-hold-lt" data-lt="agl">HEIGHT</span>
      </div>
      <div class="hud-hold-text">Hold it steady</div>`;
    this.holdLights = {
      drift: hold.querySelector('[data-lt="drift"]'),
      pos: hold.querySelector('[data-lt="pos"]'),
      agl: hold.querySelector('[data-lt="agl"]'),
    };
    this.holdText = hold.querySelector('.hud-hold-text');
    hold.hidden = true;
    this.holdPanel = hold;
    p.appendChild(hold);

    this.rotorPanel = p;
    this.wrap.appendChild(p);

    /* ---- The souls counter, on the objective panel ----
     *
     * Lives is the only number this game keeps, so it sits with the objective
     * rather than among the instruments. Hidden until there is somebody to
     * count, because "0 aboard" on a sightseeing lap is clutter.
     */
    this.rescueLine = el('div', 'hud-rescue', '');
    this.rescueLine.hidden = true;
    this.objective.appendChild(this.rescueLine);

    /* ---- The helicopter card, under the instruments, top left ----
     *
     * What the machine is doing and what to press next, the height over
     * whatever is underneath, and the landing light.
     *
     * It was in the engine strip, bottom left, and the tower's subtitle
     * (bottom 118 px, centred, up to 720 px wide) was printed across the
     * lower half of it — the SHIFT / HOLD / CTRL row and the landing light —
     * whenever the tower spoke, which is the first seconds of every flight
     * and every touchdown. Measured at 1280 x 800: the strip was 430 px wide
     * and the subtitle's left edge is at 280. It now hangs at the foot of
     * whichever top-left panel is showing — the hover strip, or the cruise
     * rows — 218 px wide, which is clear of that subtitle at 1280 px and
     * wider, and clear of it vertically at any width. See _placeHeliCard().
     */
    injectHeliCss();
    const card = el('div', 'hud-heli');
    card.innerHTML = `
      <div class="hud-heli-top">
        <div class="hud-heli-state">ON THE GROUND</div>
        <div class="hud-heli-h"><span class="hud-heli-hv">0</span><span class="hud-heli-hu">ft up</span></div>
      </div>
      <div class="hud-heli-vs">level</div>
      <div class="hud-heli-say"></div>
      <div class="hud-heli-land" hidden><b>LANDING</b><i></i><span></span></div>`;
    this.heliCard = card;
    this.heliState = card.querySelector('.hud-heli-state');
    this.heliH = card.querySelector('.hud-heli-hv');
    this.heliVs = card.querySelector('.hud-heli-vs');
    this.heliSay = card.querySelector('.hud-heli-say');
    this.heliLand = card.querySelector('.hud-heli-land');
    this.heliLandText = card.querySelector('.hud-heli-land span');
    card.hidden = true;
    this._placeHeliCard();
  },

  /**
   * Hang the card at the foot of the top-left panel that is on screen: the
   * hover strip in the hover, the cruise rows in the cruise. Called when the
   * mode changes (with hysteresis, so a few times a flight), never per frame.
   */
  _placeHeliCard() {
    const card = this.heliCard;
    if (!card) return;
    const cruise = this.speedValue && this.speedValue.closest ? this.speedValue.closest('.hud-left') : null;
    const host = this._hoverMode || !cruise ? this.rotorPanel : cruise;
    if (host && card.parentElement !== host) host.appendChild(card);
  },

  /* ------------------------------------------------------------------ */
  /* Mode switching                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Rotorcraft or aeroplane. Everything that is true for the whole flight —
   * the chips, the key hint, the word on the power bar — changes here, once,
   * rather than being rewritten sixty times a second.
   */
  setRotorActive(on) {
    const want = !!on;
    // Double-bang on the stored flag too: it is undefined until the first
    // call, and `false === undefined` is false, so without this every
    // aeroplane ran the whole restore path once for nothing.
    if (want === !!this._rotorActive) return;
    this._rotorActive = want;
    if (want) this._buildRotor();
    this.wrap.classList.toggle('is-rotor', want);
    if (!want) {
      this.wrap.classList.remove('is-rotorhover');
      this._hoverMode = false;
    }

    // The power bar is a collective. Saying so is most of the teaching.
    if (this.throttleBar) {
      const lab = this.throttleBar.root.querySelector('.hud-bar-label');
      if (lab) lab.textContent = want ? 'Collective' : 'Power';
      this.throttleBar.root.title = want
        ? 'The collective lever. Shift or ↑ raises it, Ctrl or ↓ lowers it; let go and the assist holds the height.'
        : 'Shift or ↑ for more power, Ctrl or ↓ to slow down';
    }

    // The key hint. Space is the wheel brakes on an aeroplane and does very
    // little in the air on a helicopter, so it stops being advertised.
    const hint = this.wrap.querySelector('.hud-keyhint');
    if (hint) {
      if (this._cruiseHint == null) this._cruiseHint = hint.innerHTML;
      hint.innerHTML = want
        ? 'Collective: <kbd>Shift</kbd>/<kbd>↑</kbd> up · <kbd>Ctrl</kbd>/<kbd>↓</kbd> down '
          + '· Cyclic: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> · Tail rotor: <kbd>Q</kbd>/<kbd>E</kbd> · Assist: <kbd>F</kbd>'
        : this._cruiseHint;
    }

    // A helicopter has no flaps, and the Skyhook's skids do not retract or
    // carry wheel brakes, so all three chips are permanently meaningless
    // furniture on this airframe.
    if (this.gearChip) this.gearChip.hidden = want;
    if (this.flapChip) this.flapChip.hidden = want;
    if (this.brakeChip) this.brakeChip.hidden = want;
    // And the aeroplane's EASY MODE / REAL MODE chip: the helicopter has one
    // switch, the stability assist, and its own chip says ASSIST ON or OFF.
    // Beside HEIGHT HOLD, "EASY MODE" read as the old easy-mode computer.
    if (this.modeChip) this.modeChip.hidden = want;

    // The stability assist, said out loud. A pilot who finds out later that
    // the machine was holding its own height has been cheated of the thing
    // they were proud of.
    if (want && !this.assistChip && this.gearChip && this.gearChip.parentElement) {
      this.assistChip = el('div', 'hud-chip hud-chip-assist', 'ASSIST ON');
      this.gearChip.parentElement.insertBefore(this.assistChip, this.gearChip);
    }
    if (this.assistChip) this.assistChip.hidden = !want;

    if (!want && this.rescueLine) this.rescueLine.hidden = true;
    if (!want && this.holdPanel) this.holdPanel.hidden = true;
    if (this.heliCard) this.heliCard.hidden = !want;
    if (!want && this.throttleBar) this.throttleBar.root.hidden = false;
  },

  /**
   * The card: state, height, vertical speed, the next thing to press, and
   * the landing light. Every write is change-gated.
   */
  _paintHeliCard(sim, r) {
    if (!this.heliCard) return;
    const ac = sim.aircraft;
    /*
     * Crashed: the card goes. The review of an earlier build has a
     * screenshot of TOO STEEP THIS WAY and a green "gentle" landing light
     * still up behind "The tail struck the ground".
     */
    const crashed = !!ac.crashed;
    if (crashed !== this._heliCrashShown) {
      this._heliCrashShown = crashed;
      this.heliCard.hidden = crashed || !this._rotorActive;
    }
    if (crashed) return;
    const R = ac.rotor || {};

    let key;
    if (!ac.engineOn) key = 'engine';
    else if (sim.autopilot && sim.autopilot.engaged) key = 'autopilot';
    else if (ac.hoverAssist === false) key = 'off';
    else if (r.onGround) key = 'ground';
    else if (R.landGate) key = 'gate';
    else if (R.landEdge) key = 'edge';
    else if (R.climbingOver) key = 'terrain';
    else if (R.arriving) key = 'landing';
    else if (R.holdingHeight) key = R.holdingSpot || ((R.hoverAuth || 0) > 0.5 && (R.drift || 0) < 1.5) ? 'hover' : 'height';
    else if (ac.vs > 1) key = 'climbing';
    else if (ac.vs < -1) key = 'descending';
    else key = 'lever';
    const words = HELI_WORDS[key];
    const touch = !!(this.wrap && this.wrap.classList.contains('is-touch'));
    if (key !== this._heliKey || touch !== this._heliTouch) {
      this._heliKey = key;
      this._heliTouch = touch;
      this.heliState.textContent = words[0];
      this.heliState.classList.toggle('is-good', words[2] === 'good');
      this.heliState.classList.toggle('is-warn', words[2] === 'warn');
      this.heliSay.textContent = (touch && TOUCH_SAY[key]) || rekey(words[1], 'heli');
    }

    // Height above whatever is underneath — sea, rock, roof or deck. The same
    // number the winch band is judged on (missions-heli.js surfaceAt), so the
    // card, the radar altimeter and the HEIGHT light cannot disagree.
    const hFt = Math.max(0, Math.round(this._heightAboveSurface(ac) * M_TO_FT));
    if (hFt !== this._heliHShown) {
      this._heliHShown = hFt;
      this.heliH.textContent = String(hFt);
    }
    const vs = Math.round(r.vsFpm / 20) * 20;
    if (vs !== this._heliVsShown) {
      this._heliVsShown = vs;
      this.heliVs.textContent = vs > 60 ? `\u25B2 up ${vs} ft/min` : vs < -60 ? `\u25BC down ${-vs} ft/min` : 'level';
    }

    /* ---- The landing light ----
     * On whenever the skids are within eight metres of something, or on it.
     * Green is a landing the undercarriage will not notice, amber is firm,
     * red is the one that hurts.
     *
     * It judged the sink rate alone — red over 500 ft/min at any height —
     * and so it told a child doing exactly what it said to be in trouble.
     * Measured on an earlier build: holding Ctrl, it came down at 3 m/s and
     * eased off from 7 m, and the light was red "too fast, keep holding
     * Ctrl" from 19 ft to 16 ft, amber to 9 ft, and the touchdown was
     * 86 ft/min, "perfect". So it judges the ARRIVAL: the sink against the
     * assist's own arrival profile at this height (green within 15%, amber
     * within 60%, red beyond). In the last 40 cm it
     * is the sink rate itself, against the touchdown grading's numbers: under
     * 320 ft/min is "good", over 560 is "rough".
     */
    const skids = R.heightAbove != null ? R.heightAbove : 99;
    // Worked out as a number first and only turned into words when it
    // changes: this runs every frame and a string built every frame is a
    // string the collector has to sweep up on a school Chromebook.
    let word = 0; // 0 off, 1 on the skids, 2 steady, 3 gentle, 4 a bit fast, 5 too fast
    let ft = 0;
    if (r.onGround) word = 1;
    else if (skids < 8) {
      const sink = Math.max(0, -r.vsFpm) / M_TO_FT / 60; // m/s, downwards
      if (sink < 0.2) word = 2;
      else if (skids < 0.4) word = sink < 1.63 ? 3 : sink < 2.85 ? 4 : 5;
      else {
        /*
         * Against the assist's own arrival profile (rotor-assist.js,
         * landSinkMin and landDecel), so Ctrl held all the way is green all
         * the way. Judged as the braking it would take to arrive at
         * landSinkMin at the skids, this went amber at 16 ft and red at 2 ft
         * on a 118 ft/min "perfect" landing (measured, heli-playtest).
         */
        const T = ROTOR_TUNE;
        const ok = Math.sqrt(T.landSinkMin * T.landSinkMin + 2 * T.landDecel * skids);
        word = sink <= ok * 1.15 + 0.15 ? 3 : sink <= ok * 1.6 + 0.3 ? 4 : 5;
      }
      ft = Math.max(0, Math.round(skids * M_TO_FT));
    }
    const landKey = word * 1000 + ft;
    if (landKey !== this._heliLandShown) {
      this._heliLandShown = landKey;
      const land = word === 0 ? '' : word <= 3 ? 'good' : word === 4 ? 'warn' : 'bad';
      const say = ['', 'on the skids', 'steady', 'gentle', 'a bit fast', 'too fast, raise the collective'][word];
      this.heliLand.hidden = !land;
      this.heliLand.classList.toggle('is-good', land === 'good');
      this.heliLand.classList.toggle('is-warn', land === 'warn');
      this.heliLand.classList.toggle('is-bad', land === 'bad');
      this.heliLandText.textContent = word >= 2 ? `${say} · ${ft} ft` : say;
    }
  },

  /**
   * Metres from the SKIDS to the surface under them: sea, ground or deck.
   *
   * This was measured from the machine's centre, so sitting on the pad the
   * card said "5 ft up" and the radar altimeter 5 ft — measured, Free Flight,
   * on Kestrel Airfield Pad before the engine had done anything. On the
   * ground is zero. rotor-assist.js works the number out every step
   * (rotor.heightAbove) and the winch band in missions-heli.js is judged on
   * the same one, so the card, the altimeter and the HEIGHT light agree.
   */
  _heightAboveSurface(ac) {
    const R = ac.rotor;
    if (R && Number.isFinite(R.heightAbove)) return Math.max(0, R.heightAbove);
    const ground = ac.pos.y - ac.agl; // heightAt() under the machine
    return Math.max(0, ac.pos.y - Math.max(0, ground) - 1.69);
  },

  /**
   * CRUISE or HOVER, on groundspeed, with hysteresis.
   *
   * @param {number} gsKts groundspeed in knots
   */
  setRotorMode(gsKts) {
    const want = this._hoverMode ? gsKts < HOVER_LEAVE_KTS : gsKts < HOVER_ENTER_KTS;
    if (want === !!this._hoverMode) return;
    this._hoverMode = want;
    this.wrap.classList.toggle('is-rotorhover', want);
    this._placeHeliCard();
    /*
     * Same trap clearVehicle() is written to document: update() writes numbers
     * and never units, so a unit label rewritten on a mode change stays
     * rewritten until something puts it back. One trip in the boat once left
     * the altimeter reading kilometres for the whole session. Rewrite every
     * label on the transition, and clearRotor() is the undo.
     */
    this.setRotorUnits(want);
  },

  /**
   * Rewrite the cruise strip's labels for whichever mode we are in.
   *
   * In cruise a helicopter still shows the four rows, with one change:
   * airspeed stops being the primary number. Indicated airspeed is what tells
   * a wing whether it is about to stop flying. This machine has no wing worth
   * the name, and what the pilot actually wants to know is how fast the ground
   * is going past, which is the number the winch, the fuel and the arrival
   * time all depend on.
   */
  setRotorUnits(hover) {
    const lab = this.speedValue && this.speedValue.parentElement
      && this.speedValue.parentElement.parentElement;
    const speedLabel = lab ? lab.querySelector('.hud-label') : null;
    if (speedLabel) speedLabel.textContent = this._rotorActive ? 'Ground speed' : 'Airspeed';
    // The hover strip carries its own units in its own markup, so there is
    // nothing to rewrite there; this exists so that the cruise rows are
    // correct the instant we come back to them, rather than one frame later.
    void hover;
  },

  /**
   * Put the strip back the way an aeroplane needs it.
   *
   * Called from clearTransient() (so every startMode gets it) and from
   * setVehicle() (so stepping into the boat gets it). Cheap to call twice,
   * because it does nothing at all unless something is actually to be undone.
   */
  clearRotor() {
    if (!this._rotorActive && !this._hoverMode) return;
    this._hoverMode = false;
    this.wrap.classList.remove('is-rotorhover');
    this.setRotorActive(false);
    this.setRotorUnits(false);
    if (this.holdPanel) this.holdPanel.hidden = true;
    if (this.rescueLine) this.rescueLine.hidden = true;
    this._holdShown = -1;
    this._holdFallback = 0;
  },

  /* ------------------------------------------------------------------ */
  /* Per-frame                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Called once a frame from Hud.update(), straight after readouts().
   *
   * @returns {boolean} true while the hover strip is the one on screen, so a
   *   caller that wants to skip cruise-only work can. Hud.update() does not
   *   bother: its numbers are all change-gated already, and leaving them
   *   running means the cruise strip is correct the moment it reappears.
   */
  updateRotor(dt, sim, r) {
    const isRotor = !!SPEC.rotor;
    if (isRotor !== !!this._rotorActive) this.setRotorActive(isRotor);
    if (!isRotor) return false;

    this.setRotorMode(r.groundKts);
    this._paintRescue(sim);
    this._paintHeliCard(sim, r);
    if (this.assistChip) {
      /*
       * What the equipment is DOING, not whether it is fitted. This read
       * `sim.settings.hoverAssist`, which nothing ever writes, so the chip
       * said HOVER ASSIST through everything — including a 12 m/s climb the
       * height hold had refused to touch. Change-gated like everything else
       * here — this panel is repainted sixty times a second and writing the
       * same word into the DOM sixty times a second is how an overlay ends up
       * costing more than the island does.
       */
      const R = sim.aircraft.rotor || {};
      const txt = sim.aircraft.hoverAssist === false
        ? 'ASSIST OFF'
        : sim.autopilot && sim.autopilot.engaged
          ? 'AUTOPILOT'
          : R.holdingHeight
            ? 'HEIGHT HOLD'
            : R.arriving
              ? 'SOFT LANDING'
              : 'ASSIST ON';
      if (txt !== this._assistShown) {
        this._assistShown = txt;
        this.assistChip.classList.toggle('is-on', txt !== 'ASSIST OFF');
        this.assistChip.textContent = txt;
      }
    }
    if (!this._hoverMode) return false;

    const ac = sim.aircraft;

    /* ---- Drift, in the machine's own axes ----
     *
     * Fore/aft and left/right, not north/east. "You are sliding backwards" is
     * something you can fix with the stick in front of you; "you are moving
     * 0.8 m/s on a bearing of 214" is a sum.
     *
     * Heading convention is the one the waypoint arrow already uses: 0 is -Z,
     * so forward is (sin h, -cos h) and right is (cos h, sin h).
     */
    const h = (r.heading * Math.PI) / 180;
    const sin = Math.sin(h);
    const cos = Math.cos(h);
    const fwd = ac.vel.x * sin - ac.vel.z * cos;
    const lat = ac.vel.x * cos + ac.vel.z * sin;
    const mag = Math.hypot(fwd, lat);

    // 46, not 50: the dot keeps a little of the box to itself at full scale so
    // that "pegged" still looks like a dot on the edge and not a dot half
    // outside the frame.
    const k = 46 / DRIFT_FULL;
    const dx = clamp(lat * k, -46, 46);
    const dy = clamp(-fwd * k, -46, 46);
    this.driftSlide.style.transform = `translate(${dx.toFixed(1)}%, ${dy.toFixed(1)}%)`;
    const pegged = mag > DRIFT_FULL;
    if (pegged !== this._driftPegged) {
      this._driftPegged = pegged;
      this.driftDot.classList.toggle('is-pegged', pegged);
    }
    const good = mag <= DRIFT_TOL;
    if (good !== this._driftGood) {
      this._driftGood = good;
      this.driftBox.classList.toggle('is-good', good);
    }

    // The number, and the sentence. One decimal, because two is a flicker and
    // none is a lie at the speeds that matter here.
    const shown = Math.round(mag * 10) / 10;
    if (shown !== this._driftShown) {
      this._driftShown = shown;
      this.driftValue.innerHTML = `${shown.toFixed(1)} <span>m/s</span>`;
    }
    let word;
    if (mag < 0.5) word = 'steady';
    else {
      // Name the bigger of the two. Two directions at once is a sentence a
      // child has to parse while the ground is twenty metres away.
      const back = Math.abs(fwd) >= Math.abs(lat);
      word = back
        ? (fwd > 0 ? 'sliding forwards' : 'sliding backwards')
        : (lat > 0 ? 'sliding right' : 'sliding left');
      if (mag > DRIFT_TOL) word += ' — too fast to winch';
    }
    if (word !== this._driftWord) {
      this._driftWord = word;
      this.driftWord.textContent = word;
      this.driftWord.classList.toggle('is-warn', mag > DRIFT_TOL);
    }

    /* ---- Vertical speed, as a bar that grows up or down from the middle ---- */
    const vsFrac = clamp(r.vsFpm / VS_FULL, -1, 1);
    const pct = Math.abs(vsFrac) * 50;
    this.vsBarFill.style.height = `${pct}%`;
    this.vsBarFill.style.bottom = vsFrac >= 0 ? '50%' : `${50 - pct}%`;
    const sinking = vsFrac < -0.45;
    if (sinking !== this._vsSink) {
      this._vsSink = sinking;
      this.vsBarFill.classList.toggle('is-bad', sinking);
    }

    /* ---- Radar altimeter ----
     * Over the SURFACE, not r.aglFt. ac.agl is measured to heightAt(), and
     * out at sea heightAt() is the sea floor: over the swimmer in Man
     * Overboard this read 170 ft with the skids 50 ft above the waves, and the
     * band the winch is judged on is measured to the surface
     * (missions-heli.js surfaceAt). Two opinions about one height.
     */
    const aglFt = Math.max(0, Math.round(this._heightAboveSurface(ac) * M_TO_FT));
    if (aglFt !== this._aglShown) {
      this._aglShown = aglFt;
      this.raValue.textContent = String(aglFt);
    }

    const box = sim.hoverBox || null;
    const bandMin = box && box.minAgl != null ? box.minAgl * M_TO_FT : null;
    const bandMax = box && box.maxAgl != null ? box.maxAgl * M_TO_FT : null;
    if (bandMin != null && bandMax != null) {
      // The track zooms to the band rather than running 0-300 ft, so the
      // marker moves a useful distance for the height changes that matter.
      const lo = bandMin - 25;
      const hi = bandMax + 25;
      const span = Math.max(1, hi - lo);
      if (this.raBand.hidden) this.raBand.hidden = false;
      this.raBandGood.style.left = `${((bandMin - lo) / span) * 100}%`;
      this.raBandGood.style.width = `${((bandMax - bandMin) / span) * 100}%`;
      this.raBandMark.style.left = `${clamp(((aglFt - lo) / span) * 100, 0, 100)}%`;
      const inBand = aglFt >= bandMin && aglFt <= bandMax;
      this.raValue.classList.toggle('is-good', inBand);
      this.raValue.classList.toggle('is-warn', !inBand);
    } else if (!this.raBand.hidden) {
      this.raBand.hidden = true;
      this.raValue.classList.remove('is-good', 'is-warn');
    }

    /* ---- Power, and the margin above the hover point ----
     *
     * Hover is 50% collective by construction on an empty machine
     * (physics.js:863). Thrust is proportional to collective, so carrying
     * `extraMass` moves the hover point up by exactly the mass ratio. This
     * ignores density altitude, which moves it by a few percent on a hot day
     * high up — that is a real effect and it is deliberately not modelled
     * here, because a hover mark that drifts about for reasons a child cannot
     * see teaches nothing. The bar is a teaching aid; physics.js is the truth.
     */
    /*
     * CORRECTION, measured 2026-09-23: the bar showed the LEVER (r.throttle)
     * against a mark in COLLECTIVE units, and those are different scales —
     * the lever idles at 0.18 of collective, so a steady hover read "39% ·
     * hover 50%" and looked like it was falling. Both numbers now come from rotor-assist.js on the same
     * scale: the collective the blades actually get, and where the hover is.
     */
    const R = ac.rotor || {};
    const extra = (ac && ac.extraMass) || 0;
    const hoverPt = R.hoverPoint != null
      ? clamp(R.hoverPoint, 0.05, 0.95)
      : clamp(0.5 * ((SPEC.mass + extra) / SPEC.mass), 0.05, 0.95);
    const coll = clamp(R.collective != null ? R.collective : r.throttle, 0, 1);
    this.powerFill.style.width = `${Math.round(coll * 100)}%`;
    const markPct = Math.round(hoverPt * 100);
    if (markPct !== this._hoverPtShown) {
      this._hoverPtShown = markPct;
      this.powerMark.style.left = `${markPct}%`;
    }
    const read = `${Math.round(coll * 100)}% · hover ${markPct}%`;
    if (read !== this._powerRead) {
      this._powerRead = read;
      this.powerRead.textContent = read;
    }
    // Out of margin: at or near the stop and still going down. This is the
    // moment the lead's whole "leave someone behind or burn fuel off" decision
    // becomes visible, so it is the one thing on this panel that turns red.
    const short = coll > 0.97 && r.vsFpm < -60;
    if (short !== this._powerShort) {
      this._powerShort = short;
      this.powerFill.classList.toggle('is-short', short);
    }

    /* ---- Wind, relative to the nose ---- */
    const w = sim.weather;
    if (w) {
      const rel = ((w.windDirDeg - r.heading + 540) % 360) - 180;
      this.rWindArrow.style.transform = `rotate(${rel}deg)`;
      const kt = Math.round(w.windSpeedKts);
      const txt = kt < 1 ? 'calm' : `${kt} kt`;
      if (txt !== this._rWindShown) {
        this._rWindShown = txt;
        this.rWindText.textContent = txt;
      }
    }

    /* ---- The hold gauge ---- */
    this._paintHold(dt, sim, box, mag, aglFt, bandMin, bandMax);
    return true;
  },

  /**
   * The arc, the three lights and the caption.
   *
   * `box.driftOk` / `inCircle` / `aglOk` win whenever the winch supplies them,
   * because the thing that decides whether you pass must be the thing that
   * draws the lights — two opinions about the same question is how a player
   * ends up with three greens and no credit. They are computed here only when
   * the winch has not supplied them.
   */
  _paintHold(dt, sim, box, driftMag, aglFt, bandMin, bandMax) {
    if (!box) {
      if (!this.holdPanel.hidden) {
        this.holdPanel.hidden = true;
        this.driftArc.style.strokeDashoffset = String(ARC_C);
        this._holdShown = -1;
        this._holdFallback = 0;
      }
      return;
    }
    if (this.holdPanel.hidden) this.holdPanel.hidden = false;

    const ac = sim.aircraft;
    let inCircle = box.inCircle;
    if (inCircle == null && box.pos) {
      const rr = box.radius || 12;
      inCircle = Math.hypot(ac.pos.x - box.pos.x, ac.pos.z - box.pos.z) <= rr;
    }
    const driftOk = box.driftOk != null ? box.driftOk : driftMag <= DRIFT_TOL;
    let aglOk = box.aglOk;
    if (aglOk == null) {
      aglOk = bandMin == null || bandMax == null
        ? true
        : aglFt >= bandMin && aglFt <= bandMax;
    }
    const all = !!(driftOk && inCircle && aglOk);

    const light = (node, ok) => {
      const st = ok ? 1 : 0;
      if (node.dataset.st === String(st)) return;
      node.dataset.st = String(st);
      node.classList.toggle('is-on', ok);
    };
    light(this.holdLights.drift, driftOk);
    light(this.holdLights.pos, !!inCircle);
    light(this.holdLights.agl, !!aglOk);

    const need = box.need || 10;
    let held;
    if (box.held != null) {
      held = box.held;
      this._holdFallback = held;
    } else {
      /*
       * A stand-in, and it is load-bearing for exactly one week.
       *
       * The winch is somebody else's job and lands after this panel does, but
       * the gate this whole game is judged against — can a ten-year-old hold
       * a twelve-metre circle for eight seconds on a Chromebook — cannot be
       * tested without a timer. So this counts, on the same rule the winch
       * will use: it fills while all three lights are on and it DRAINS at half
       * rate when one goes out. It never resets to zero, because a child who
       * wobbles at second six should lose two seconds, not eight, and a
       * reset-to-zero reads as the game taking something away.
       *
       * `box.held` overrides it the instant the winch supplies one, and the
       * branch can be deleted then.
       */
      this._holdFallback = clamp(
        (this._holdFallback || 0) + (all ? dt : -dt * 0.5),
        0,
        need
      );
      held = this._holdFallback;
    }

    const frac = clamp(held / need, 0, 1);
    // One write per percent, not one per frame.
    const step = Math.round(frac * 100);
    if (step !== this._holdShown) {
      this._holdShown = step;
      this.driftArc.style.strokeDashoffset = String(ARC_C * (1 - frac));
      this.driftArc.classList.toggle('is-full', frac >= 1);
      const left = Math.max(0, Math.ceil(need - held));
      const label = box.label ? ` · ${box.label}` : '';
      this.holdText.textContent = frac >= 1
        ? `Steady — winch is coming up${label}`
        : all
          ? `Hold it — ${left}s${label}`
          : !inCircle
            ? 'Move over the lit circle'
            : !aglOk
              ? (aglFt < (bandMin || 0) ? 'Too low for the cable — come up' : 'Too high for the cable — come down')
              : 'Too much drift — centre the dot';
      this.holdText.classList.toggle('is-good', all);
    }
  },

  /** Lives aboard and lives saved, on the objective panel. */
  _paintRescue(sim) {
    if (!this.rescueLine) return;
    const rs = sim.rescue;
    if (!rs) {
      if (!this.rescueLine.hidden) this.rescueLine.hidden = true;
      this._rescueShown = null;
      return;
    }
    const aboard = rs.aboard || 0;
    const saved = rs.saved || 0;
    const txt = `${aboard} aboard · ${saved} safe`;
    if (txt === this._rescueShown) return;
    this._rescueShown = txt;
    this.rescueLine.hidden = false;
    this.rescueLine.textContent = txt;
  },
};

/**
 * The plain-English caption for the cruise strip's speed row on a rotorcraft.
 *
 * The aeroplane's ladder cannot be reused. It says "too slow to fly" below 52
 * knots and paints the number amber, which is true of a wing and a libel
 * against a helicopter: forty knots is a perfectly ordinary way for this
 * machine to cross a bay, and telling a child they are about to fall out of
 * the sky for doing it correctly is how you teach them to distrust the panel.
 *
 * @param {number} kts groundspeed in knots
 */
export function rotorSpeedWord(kts) {
  if (kts < 1) return 'stopped';
  if (kts < 12) return 'easing along';
  if (kts < 45) return 'moving off';
  if (kts < 90) return 'good cruising speed';
  if (kts < 120) return 'fast';
  return 'very fast';
}

/** Mix the helicopter panel into the Hud class. Call once, at import time. */
export function installRotorHud(Hud) {
  Object.assign(Hud.prototype, ROTOR);
  /*
   * The coach line is an aeroplane instructor. Measured on the Skyhook, Free
   * Flight: on the pad it said "Hold Shift for full power", and in a steady
   * hover "Too slow! Add power with Shift and lower the nose with W" — the
   * two things that turn a hover into a crash. In the helicopter the card
   * says what to press, so the coach keeps only its two lines that are true
   * of anything: the restart after a crash and the engine start.
   */
  /*
   * And the banners main.js writes for every aircraft: "Lift-off at 0
   * knots — well flown", "Smooth and on the centreline", "· not on the
   * runway". Measured on the Skyhook after a 90 ft/min landing on grass. The
   * words are swapped for helicopter ones here, on the way to the screen.
   */
  if (Hud.prototype.showBanner && !Hud.prototype._aeroplaneBanner) {
    Hud.prototype._aeroplaneBanner = Hud.prototype.showBanner;
    Hud.prototype.showBanner = function showBanner(title, sub, ...rest) {
      if (this._rotorActive && typeof sub === 'string') {
        sub = sub
          .replace(/^Lift-off at \d+ knots — well flown\.$/, 'Off the ground — well flown.')
          .replace('Smooth and on the centreline.', 'Smooth and level.')
          .replace(' · not on the runway', ' · not on an H');
      }
      return this._aeroplaneBanner(title, sub, ...rest);
    };
  }
  if (Hud.prototype.setCoach && !Hud.prototype._aeroplaneCoach) {
    Hud.prototype._aeroplaneCoach = Hud.prototype.setCoach;
    Hud.prototype.setCoach = function setCoach(text) {
      if (this._rotorActive && text && !/Restart|start the engine/.test(text)) text = null;
      return this._aeroplaneCoach(text);
    };
  }
}
