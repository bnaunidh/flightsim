/**
 * Heads-up display.
 *
 * Every number is paired with plain English: "1,200 ft · about as high as four
 * football pitches laid end to end" is too chatty, but "climbing" next to a
 * vertical speed, and "wind pushing from the left" next to 12 kt, tells a young
 * pilot what to actually do.
 */

import { UNITS } from '../aircraft/physics.js';
import { icon } from './icons.js';
import { clamp } from '../core/noise.js';
import { installRotorHud, rotorSpeedWord } from './hud-rotor.js';
import { HudStack } from './hud-stack.js';
import { SPEC } from '../aircraft/physics.js';
import { rekey, keyName, shortKey, bindingsVersion, HELI_MAP } from '../flight/input.js';
import { TouchdownCard } from './touchdown.js';
import { PillLane, pillsFor } from './pills.js';
import { lightPresetOf } from '../aircraft/systems.js';
import { DestRibbon } from './ribbon.js';
import { damagePlanform } from './damage-planform.js';
import { conditionsWords, DENSITY_SHORT } from './conditions.js';

const KTS = UNITS.KTS;
const FT = UNITS.FT;
const FPM = UNITS.FPM;

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/*
 * Never "-0".
 *
 * A vertical speed of -3 ft/min rounds to minus nothing, and toLocaleString
 * keeps the sign: sitting still on the runway the panel read "-0 ft/min".
 * Rounding here first and folding -0 (and NaN) into a plain 0 means no number
 * this formatter prints can ever carry a sign it has not earned.
 */
function fmt(n, digits = 0) {
  const f = 10 ** digits;
  const v = Math.round(Number(n) * f) / f || 0;
  return v.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/*
 * Height over the ground as the panel prints it: to 5 ft under 100, so a
 * roof (20 to 30 ft) reads as one, and to 10 ft above, like the altimeter.
 */
export function aboveGroundFt(ft) {
  const v = Math.max(0, Number(ft) || 0);
  return v < 100 ? Math.round(v / 5) * 5 : Math.round(v / 10) * 10;
}

/*
 * The altitude row's words, in two lengths from one place.
 *
 * `word` is the sentence under the altimeter on a laptop ("just off the
 * ground · 20 ft up"). `short` is the same height over the ground in a few
 * characters ("20 ft up"), for the layouts that have no room for a sentence:
 * the touch band (iPads, phones, touchscreen Chromebooks) and a narrow
 * window hide .hud-word (styles/main.css), which was the only place the
 * height over the ground was written. So beside a 29 ft roof an iPad still
 * read the altimeter's 150 ft — or 1,080 on the Skerries — and nothing else:
 * the owner's "200 ft house", unchanged on the devices README names. The
 * short form is built here, from the same rounding and the same bands as
 * the sentence, so the two can never disagree.
 *
 *   on the ground          "on the ground · field 140 ft"   "on the ground"
 *   under 60 ft over it    "just off the ground · 20 ft up"  "20 ft up"
 *   under 400              "low · 150 ft over ground"        "150 ft up"
 *   under 1,500            "safe · 1,200 ft over ground"     "1,200 ft up"
 *   under 6,000            "high above the island"           "high up"
 *   and above              "very high"                       "very high"
 */
export function altitudeWords({ onGround, fieldFt, aglFt }) {
  if (onGround) {
    const field = Math.max(0, Number(fieldFt) || 0);
    return { word: field >= 10 ? `on the ground · field ${fmt(field)} ft` : 'on the ground', short: 'on the ground' };
  }
  const agl = Math.max(0, Number(aglFt) || 0);
  const over = fmt(aboveGroundFt(agl));
  if (agl < 60) return { word: `just off the ground · ${over} ft up`, short: `${over} ft up` };
  // (Short enough for the panel's 158 px at 1,490: "over the ground" was
  // 167 and widened the panel every time the line said it.)
  if (agl < 400) return { word: `low · ${over} ft over ground`, short: `${over} ft up` };
  if (agl < 1500) return { word: `safe · ${over} ft over ground`, short: `${over} ft up` };
  if (agl < 6000) return { word: 'high above the island', short: 'high up' };
  return { word: 'very high', short: 'very high' };
}

/*
 * How long a line takes a ten-year-old to read, in seconds: a second to find
 * it, then about three words a second. Used as the floor for the radio line
 * and for how long the objective stays open before folding into its chip.
 */
function readSeconds(text) {
  const words = String(text || '').split(/\s+/).filter(Boolean).length;
  return 1 + words / 3;
}

// The objective folds to a one-line chip once it has been up this long (at
// least), and stays open while the pointer is over it.
const OBJECTIVE_OPEN_MIN = 6;
const OBJECTIVE_OPEN_MAX = 14;
// A radio line fades out over this long rather than blinking off.
const SUBTITLE_FADE = 0.45;
// Notices on screen at once, and how many may wait behind them.
const TOASTS_SHOWN = 2;
const TOASTS_KEPT = 6;
// The controls along the bottom that the radio line and the dialogue box
// must sit above (updateLanes()). Persistent things only: not the coaching
// line, not the prompts — those sit above the radio line themselves.
const LANE = [
  '#ui .hud-bottom', '#ui .hud-chevron', '#ui .hud-papi', '#ui .hud-boatkeys', '#ui .hud-buttons', '#ui .minimap',
  '#ui .touch-stick', '#ui .touch-throttle', '#ui .touch-pads', '#ui .touch-rudder', '#ui .touch-lever',
  '#ui .touch-wheel', '#ui .touch-pedals', '.ej-btn.is-on', '#ui .hud-pills',
].join(', ');
// The touchscreen action buttons that share the right-hand column (updateLanes()).
const ACTIONS = '.mt-zap, .wf-drop, .co-btn.is-on, .gsk-btn, .hsk-btn, .afo-action, .tp-col';

export class Hud {
  constructor(root, { onAction } = {}) {
    this.root = root;
    this.onAction = onAction || (() => {});
    this.subtitleTimer = 0;
    this.subtitleFade = 0;
    this.toasts = [];
    this.lastValues = {};
    this.build();
  }

  build() {
    const wrap = el('div', 'hud');
    this.wrap = wrap;

    /* ---- Instruments, top left ---- */
    const left = el('div', 'hud-panel hud-left');
    this.speedValue = el('div', 'hud-value', '0');
    this.speedWord = el('div', 'hud-word', 'stopped');
    this.altValue = el('div', 'hud-value', '0');
    this.altWord = el('div', 'hud-word', 'on the ground');
    // The height over the ground in a few characters, for the layouts that
    // hide the sentence (altitudeWords(); .hud-up in styles/main.css).
    this.altUp = el('div', 'hud-up', 'on the ground');
    this.vsValue = el('div', 'hud-value', '0');
    this.vsWord = el('div', 'hud-word', 'level');
    this.hdgValue = el('div', 'hud-value', '090');
    this.hdgWord = el('div', 'hud-word', 'east');

    const row = (label, value, word, unit, short) => {
      const r = el('div', 'hud-row');
      r.appendChild(el('div', 'hud-label', label));
      const v = el('div', 'hud-valuewrap');
      v.appendChild(value);
      // A degree sign is not a unit word: set small on the baseline it read
      // "090 ∘", so it gets its own class and sits up by the figure.
      if (unit) v.appendChild(el('span', unit === '°' ? 'hud-unit is-deg' : 'hud-unit', unit));
      r.appendChild(v);
      // After the figure and before the sentence: a third line under the
      // number where the rows stack (the touch band), on the number's line
      // where they do not (a narrow window).
      if (short) r.appendChild(short);
      r.appendChild(word);
      return r;
    };
    // Which aeroplane you are in. `setAircraftName` has existed for a while
    // and wrote into an element that was never built, so choosing a different
    // aeroplane changed how it flew and nothing on screen ever said so.
    this.acName = el('div', 'hud-acname', '');
    left.appendChild(this.acName);
    left.appendChild(row('Airspeed', this.speedValue, this.speedWord, 'kt'));
    left.appendChild(row('Altitude', this.altValue, this.altWord, 'ft', this.altUp));
    left.appendChild(row('Vertical speed', this.vsValue, this.vsWord, 'ft/min'));
    left.appendChild(row('Heading', this.hdgValue, this.hdgWord, '°'));
    wrap.appendChild(left);

    /* ---- Objective + waypoint, top centre ---- */
    const top = el('div', 'hud-top');
    this.objective = el('div', 'hud-objective');
    this.objectiveTitle = el('div', 'hud-objective-title', 'Free Flight');
    this.objectiveText = el('div', 'hud-objective-text', 'Fly wherever you like. Have fun!');
    /*
     * The mission clock.
     *
     * Five missions fail on a time limit and none of them ever showed it, so
     * "Ran out of time" arrived out of nowhere on a run that felt fine.
     */
    /*
     * The damage panel: a little plan view of an aeroplane with five zones
     * that light up where you have been hit.
     *
     * A number would not do. "Left wing 40%" means nothing at a glance to a
     * ten-year-old halfway through a chase; a wing going orange means
     * something instantly, and it is on the side the aeroplane is rolling
     * towards, which is the connection worth teaching.
     */
    this.damagePanel = el('div', 'hud-damage');
    this.damagePanel.hidden = true;
    /*
     * The plan view is the aircraft you are flying (damage-planform.js): a
     * flying wing for the B-2, an ogival delta for Concorde, the swing wing
     * for the B-1B, a cabin, boom and rotor disc for a helicopter. Drawn as
     * the generic airliner until the first type is known (setDamageShape).
     */
    this.damagePanel.innerHTML = `
      <svg viewBox="0 0 80 80" aria-hidden="true" data-dmg-plan>${damagePlanform(null).svg}</svg>
      <span class="hud-damage-label">DAMAGE</span>
    `;
    this.damageShapeId = 'generic';
    this.damageZones = {};
    this.damagePanel.querySelectorAll('[data-zone]').forEach((z) => {
      this.damageZones[z.dataset.zone] = z;
    });

    this.objectiveClock = el('div', 'hud-objective-clock', '');
    this.objectiveClock.hidden = true;
    this.objective.appendChild(this.objectiveTitle);
    this.objective.appendChild(this.objectiveClock);
    this.objective.appendChild(this.objectiveText);
    /*
     * The objective folds itself away.
     *
     * At the start of every flight the banner, the coach line, the tower's
     * clearance and four panels were all on screen at once. The banner is read
     * once and then only glanced at, so after it has been up long enough to
     * read it shrinks to a one-line chip at the top: title, clock if there is
     * one, and as much of the sentence as fits. It opens again by itself when
     * the objective changes, while the pointer is over it, when it is tapped,
     * and when H (help) is pressed. Nothing is removed from the page, so every
     * check that reads the objective's text still reads all of it.
     */
    this.objectiveOpen = true;
    this.objectiveT = OBJECTIVE_OPEN_MIN;
    this.objectiveHover = false;
    // Set every frame by update(dt, sim); starts false so a HUD that is
    // never ticked (built but never flown) never folds for the wrong reason.
    this._riding = false;
    this.objective.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.objectiveHover = true;
      this.showObjective(2.5);
    });
    this.objective.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.objectiveHover = false;
      this.objectiveT = Math.min(this.objectiveT, 2.5);
    });
    this.objective.addEventListener('click', (e) => {
      e.preventDefault();
      // A tap on the chip opens it; a tap on the open banner puts it away.
      if (this.objectiveOpen && !this.objectiveHover) this.foldObjective();
      else this.showObjective();
    });

    // Taxi instructions, shown only while taxiing out.
    this.taxi = el('div', 'hud-taxi');
    this.taxiText = el('div', 'hud-taxi-text', '');
    this.taxiHint = el('div', 'hud-taxi-hint', '');
    this.taxiSkip = el('button', 'hud-taxi-skip', 'Skip to runway \u2192');
    this.taxiSkip.title = 'Jump straight to the runway, lined up and ready';
    this.taxiSkip.addEventListener('click', (e) => {
      e.preventDefault();
      this.taxiSkip.blur();
      this.onAction('skipTaxi');
    });
    const taxiWords = el('div', 'hud-taxi-words');
    taxiWords.appendChild(this.taxiText);
    taxiWords.appendChild(this.taxiHint);
    this.taxi.appendChild(taxiWords);
    this.taxi.appendChild(this.taxiSkip);
    this.taxi.style.display = 'none';
    /*
     * The destination ribbon (ribbon.js): a slim heading tape with the
     * target marked, above the objective, only while a mission or job gives
     * you somewhere to go. It stands in for the arrow pill below, which
     * hides while the tape is up (update()).
     */
    this.dest = new DestRibbon();
    top.appendChild(this.dest.el);
    top.appendChild(this.objective);
    top.appendChild(this.taxi);

    this.waypoint = el('div', 'hud-waypoint');
    this.waypointArrow = el('div', 'hud-arrow', '➤');
    this.waypointText = el('div', 'hud-waypoint-text', '');
    this.waypoint.appendChild(this.waypointArrow);
    this.waypoint.appendChild(this.waypointText);
    this.waypoint.style.display = 'none';
    top.appendChild(this.waypoint);
    wrap.appendChild(top);
    this.topLane = top;

    /* ---- Weather + wind, top right ---- */
    const right = el('div', 'hud-panel hud-right');
    this.windRose = el('div', 'hud-windrose');
    this.windNeedle = el('div', 'hud-windneedle', '↓');
    this.windRose.appendChild(this.windNeedle);
    this.windRose.appendChild(el('div', 'hud-windrose-label', 'N'));
    const windInfo = el('div', 'hud-windinfo');
    this.windText = el('div', 'hud-windtext', 'Air is calm');
    this.windDetail = el('div', 'hud-winddetail', '0 kt from 090°');
    this.weatherText = el('div', 'hud-weather', 'Clear · Midday');
    // The folded card's one line, in plain words (conditions.js): "Midday ·
    // clear skies · light breeze". Shown by CSS only while the card is a chip.
    this.wxChip = el('div', 'hud-wxchip', 'Midday · clear skies · light breeze');
    windInfo.appendChild(this.wxChip);
    windInfo.appendChild(this.windText);
    windInfo.appendChild(this.windDetail);
    windInfo.appendChild(this.weatherText);
    right.appendChild(this.windRose);
    right.appendChild(windInfo);
    this.weatherCard = right;
    /*
     * The right-hand column is one stack (hud-stack.js): the wind, the
     * damage diagram, the patient's pulse, the notices and every feature's
     * card (the warnings, the meteor and fire panels, the event cards, the
     * carrier's ball, the Races button) go INTO it and CSS stacks them.
     * Wind and damage are information: in the Clean HUD they fold to a chip
     * a few seconds after they change. A tap opens a chip again.
     */
    this.stack = new HudStack(wrap);
    this.stack.add(this.damagePanel, { prio: 3, id: 'damage', info: true });
    this.stack.add(right, { prio: 3.9, id: 'weather', info: true });
    right.addEventListener('click', (e) => {
      e.preventDefault();
      this.stack.poke(right);
    });

    /* ---- Engine strip, bottom left ---- */
    const bottom = el('div', 'hud-panel hud-bottom');
    /*
     * Everything the panel showed before this feature — the two bars, the
     * key hint, the gear/flap/brake/mode/trim/autopilot chips — lives in its
     * own wrapper now. `.hud.is-touch .hud-bottom { display: none; }` hides
     * the whole panel on a touchscreen (a phone has no room for it, and the
     * dock/readouts carry the same state), and a child of a display:none
     * ancestor can never be made visible by its own CSS — so the autopilot
     * bugs below, which a touchscreen is the main reason to have at all,
     * would never render if they stayed inside this. Wrapping the OLD
     * content instead of the new lets touch hide exactly what it hid before
     * and nothing more.
     */
    const bottomContent = el('div', 'hud-bottom-content');
    const mkBar = (label, cls) => {
      const b = el('div', 'hud-bar');
      b.appendChild(el('div', 'hud-bar-label', label));
      const track = el('div', 'hud-bar-track');
      const fill = el('div', `hud-bar-fill ${cls}`);
      track.appendChild(fill);
      b.appendChild(track);
      const val = el('div', 'hud-bar-value', '0%');
      b.appendChild(val);
      return { root: b, fill, val };
    };
    this.throttleBar = mkBar('Power', 'is-throttle');
    this.throttleBar.root.title = 'Shift or ↑ for more power, Ctrl or ↓ to slow down';
    this.fuelBar = mkBar('Fuel', 'is-fuel');
    bottomContent.appendChild(this.throttleBar.root);
    bottomContent.appendChild(this.fuelBar.root);

    // Written with the default keys, like every hint; syncKeyHint() puts the
    // player's own in (whoever last wrote it: this, the helicopter, the van).
    this.keyHintEl = el('div', 'hud-keyhint', 'Power: <kbd>Shift</kbd>/<kbd>↑</kbd> up · <kbd>Ctrl</kbd>/<kbd>↓</kbd> down · <kbd>Space</kbd> brakes');
    bottomContent.appendChild(this.keyHintEl);

    const chips = el('div', 'hud-chips');
    this.gearChip = el('div', 'hud-chip', 'GEAR DOWN');
    this.flapChip = el('div', 'hud-chip', 'FLAPS 0');
    this.flapChip.dataset.chip = 'flaps';
    this.brakeChip = el('div', 'hud-chip', 'BRAKES');
    this.modeChip = el('div', 'hud-chip', 'EASY MODE');
    // Trim, shown only once it has been touched. A chip that always reads
    // "TRIM 0" is clutter; one that appears when you wind the wheel is
    // feedback.
    this.trimChip = el('div', 'hud-chip', 'TRIM');
    this.trimChip.style.display = 'none';
    this.apChip = el('div', 'hud-chip hud-chip-ap', 'AUTOPILOT');
    this.apChip.style.display = 'none';
    chips.appendChild(this.gearChip);
    chips.appendChild(this.flapChip);
    chips.appendChild(this.brakeChip);
    chips.appendChild(this.modeChip);
    chips.appendChild(this.trimChip);
    chips.appendChild(this.apChip);
    bottomContent.appendChild(chips);
    bottom.appendChild(bottomContent);
    // A tap on the strip wakes its key line and chips in the Clean HUD.
    bottom.addEventListener('click', () => this.wakeBottom());

    /*
     * The autopilot's own bugs: heading, speed and climb/descend rate, each
     * with a small +/- so a finger (or the keys in the Autopilot group) can
     * dial a new one in without ever switching it off. A sibling of the old
     * content, not a child of it — see the comment above `bottomContent` —
     * so it survives on a touchscreen where that content is hidden. Shown
     * only while the chip is — nothing to adjust when it is not flying.
     */
    this.apBugs = el('div', 'hud-ap-bugs');
    this.apBugs.style.display = 'none';
    const mkBug = (dec, inc, decTitle, incTitle) => {
      const row = el('div', 'hud-ap-bug');
      const minus = el('button', 'hud-ap-bug-btn', '−');
      minus.type = 'button';
      minus.title = decTitle;
      minus.setAttribute('aria-label', decTitle);
      minus.addEventListener('click', (e) => { e.preventDefault(); this.onAction(dec); });
      const val = el('div', 'hud-ap-bug-val', '');
      const plus = el('button', 'hud-ap-bug-btn', '+');
      plus.type = 'button';
      plus.title = incTitle;
      plus.setAttribute('aria-label', incTitle);
      plus.addEventListener('click', (e) => { e.preventDefault(); this.onAction(inc); });
      row.appendChild(minus);
      row.appendChild(val);
      row.appendChild(plus);
      return { root: row, val };
    };
    this.apHdgBug = mkBug('apHdgLeft', 'apHdgRight', 'Heading left 5°', 'Heading right 5°');
    this.apSpdBug = mkBug('apSpdDown', 'apSpdUp', 'Speed -5 kt', 'Speed +5 kt');
    this.apVsBug = mkBug('apVsDown', 'apVsUp', 'Climb/descend rate -100 ft/min', 'Climb/descend rate +100 ft/min');
    this.apBugs.appendChild(this.apHdgBug.root);
    this.apBugs.appendChild(this.apSpdBug.root);
    this.apBugs.appendChild(this.apVsBug.root);
    bottom.appendChild(this.apBugs);
    wrap.appendChild(bottom);

    /* ---- Quick buttons, bottom right ----
     *
     * Nine buttons sat here permanently, which is eight too many with a runway
     * coming at you. Three stay out — pause, camera, and a tray for the rest —
     * and the tray closes itself as soon as you use it or look away.
     */
    const dock = el('div', 'hud-buttons');
    const tray = el('div', 'hud-tray');
    tray.hidden = true;

    const mkBtn = (name, action, title, host, label) => {
      const b = el('button', host === tray ? 'hud-btn hud-btn-wide' : 'hud-btn');
      b.innerHTML = icon(name, 20) + (label ? `<span>${label}</span>` : '');
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', (e) => {
        e.preventDefault();
        b.blur();
        if (host === tray) this.setTrayOpen(false);
        this.onAction(action);
      });
      host.appendChild(b);
      return b;
    };

    this.btnPause = mkBtn('pause', 'pause', 'Pause (Esc)', dock);
    this.btnCamera = mkBtn('camera', 'camera', 'Change camera (C)', dock);
    // HUD mode, Full / Clean / Photo (conditions.js). In the dock, not the
    // tray: it is the touch control for the mode key, and Photo hides most
    // of the screen, so the way back must stay in sight.
    this.btnHud = mkBtn('hud', 'hudMode', `HUD mode: Full / Clean / Photo (${keyName('hudMode')})`, dock);
    this.btnHud.classList.add('hud-btn-mode');
    this.btnMore = el('button', 'hud-btn');
    this.btnMore.innerHTML = icon('more', 20);
    this.btnMore.title = 'More';
    this.btnMore.setAttribute('aria-label', 'More controls');
    this.btnMore.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.btnMore.blur();
      // Toggle from our own flag rather than from the DOM. Reading `hidden`
      // back meant that anything else touching the attribute — or the handler
      // firing twice — left the button lit with no way to put it out.
      this.setTrayOpen(!this.trayOpen);
    });
    dock.appendChild(this.btnMore);

    this.btnGuide = mkBtn('route', 'guide', 'Guidance lines on/off (N)', tray, 'Guidance');
    this.btnAuto = mkBtn('autopilot', 'autopilot', 'Autopilot on/off (P)', tray, 'Autopilot');
    this.btnCinematic = mkBtn('cinematic', 'hideUi', 'Hide the interface for a clean shot (U)', tray, 'Hide interface');
    this.btnAirport = mkBtn('tower', 'airport', 'Return to the airfield', tray, 'Back to the airfield');
    this.btnRestart = mkBtn('restart', 'restart', 'Start this flight again', tray, 'Restart');
    this.btnMute = mkBtn('soundOn', 'mute', 'Mute sound (M)', tray, 'Sound');
    this.btnHelp = mkBtn('help', 'help', 'Show controls (H)', tray, 'Controls');
    this.btnKeys = mkBtn('help', 'keys', 'Show which keys you are pressing', tray, 'Key monitor');
    // J, not M. M is mute — anyone who followed this tooltip silenced the game
    // and wondered why no map appeared.
    this.btnMap = mkBtn('map', 'minimap', 'Show the map (J)', tray, 'Minimap');
    this.btnBrace = mkBtn('warning', 'brace', 'Shut everything down and brace for impact', tray, 'Brace for impact');
    this.btnBrace.classList.add('is-brace');

    this.tray = tray;
    this.trayOpen = false;
    tray.style.display = 'none';
    wrap.appendChild(tray);
    wrap.appendChild(dock);

    // Clicking anywhere else, or pressing Escape, puts it away. A menu you can
    // only close by using it is a menu you are stuck in.
    document.addEventListener('click', (e) => {
      if (!this.trayOpen) return;
      if (tray.contains(e.target) || this.btnMore.contains(e.target)) return;
      this.setTrayOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.trayOpen) this.setTrayOpen(false);
    });

    /* ---- Centre overlays ----
     *
     * The callouts in the middle of the screen are one lane, a flex column:
     * the warnings' big command (PULL UP, TERRAIN — warnings.js puts it in
     * with addCallout()), then the STALL slab, then the banner. They had a
     * top of their own each (36%, 30%, 34%), so a PULL UP during a
     * "Checkpoint 2 of 5" banner was printed inside it, red on red. Now they
     * cannot overlap, and the banner waits while a command is up.
     */
    this.center = el('div', 'hud-center');
    wrap.appendChild(this.center);
    this.stallWarn = el('div', 'hud-stall', 'STALL — LOWER THE NOSE');
    this.stallWarn.style.display = 'none';
    this.addCallout(this.stallWarn, 1);

    this.papiHint = el('div', 'hud-papi', '');
    this.papiHint.style.display = 'none';
    wrap.appendChild(this.papiHint);

    // Coach line: names the exact key to press next. It only appears when
    // there is something useful to say.
    this.coach = el('div', 'hud-coach', '');
    this.coach.style.display = 'none';
    wrap.appendChild(this.coach);

    // NOT a child of `wrap`: setVisible(false) sets wrap's own display to
    // 'none', which would take every descendant — including a toast that
    // landed the instant before, such as an achievement's — down with it,
    // unseen. Appended straight to `root` below (after `wrap`, and with its
    // own z-index in main.css) so a toast outlives the HUD being hidden for
    // a debrief dialog, a menu, or another game's own loop (the rocket)
    // that never shows this HUD at all.
    this.toastLayer = el('div', 'hud-toasts');

    this.subtitle = el('div', 'hud-subtitle');
    this.subtitle.style.display = 'none';
    this.subtitleWho = el('div', 'hud-subtitle-who', '');
    this.subtitleText = el('div', 'hud-subtitle-text', '');
    this.subtitle.appendChild(this.subtitleWho);
    this.subtitle.appendChild(this.subtitleText);
    wrap.appendChild(this.subtitle);

    this.banner = el('div', 'hud-banner');
    this.banner.style.display = 'none';
    this.addCallout(this.banner, 2);

    // The touchdown card (touchdown.js): under the banner's place in the
    // centre lane, so it can never land on a warning.
    this.touchdown = new TouchdownCard();
    this.addCallout(this.touchdown.el, 2.5);

    // The state pills (pills.js): one lane at the bottom centre, at most
    // two, each a button. The radio and coaching lines sit above it
    // (updateLanes() measures it like any other control).
    this.pills = new PillLane(wrap, (a) => this.onAction(a));

    this.controlsCard = el('div', 'hud-controls-card');
    this.controlsCard.style.display = 'none';
    wrap.appendChild(this.controlsCard);

    /*
     * The key monitor: a little keyboard that lights up as you fly.
     *
     * Useful for two quite different things — seeing that a key really is
     * registering when the aeroplane is not doing what you expect, and
     * watching what your own hands are doing, which is how you notice you have
     * been holding right rudder for the last minute. Off by default and
     * toggled from its own button, because it is a diagnostic, not furniture.
     */
    this.keyMon = el('div', 'hud-keys');
    this.keyMon.style.display = 'none';
    this.keyCells = {};
    /*
     * One cell per ACTION, not per key: it lights when the action is held
     * on whichever keys it is bound to, and shows those keys — so a pilot
     * who moved pitch to the arrow keys sees the arrows light, not a W that
     * never will. (The helicopter's cells are its own actions.)
     */
    const KEY_ROWS = [
      [['yawLeft', ''], ['pitchDown', ''], ['yawRight', '']],
      [['rollLeft', ''], ['pitchUp', ''], ['rollRight', '']],
      [['throttleUp', ' pwr'], ['brakes', ' brk'], ['throttleDown', ' pwr']],
      [['flapsDown', ''], ['flapsUp', ''], ['gear', '']],
    ];
    this.keyCellTags = {};
    for (const row of KEY_ROWS) {
      const r = el('div', 'hud-keys-row');
      for (const [action, tag] of row) {
        const cell = el('div', 'hud-key', '');
        this.keyCells[action] = cell;
        this.keyCellTags[action] = tag;
        r.appendChild(cell);
      }
      this.keyMon.appendChild(r);
    }
    // Stick position, which is the thing the keys are actually driving.
    this.keyAxes = el('div', 'hud-keys-axes');
    this.keyMon.appendChild(this.keyAxes);
    wrap.appendChild(this.keyMon);

    this.root.appendChild(wrap);
    this.root.appendChild(this.toastLayer);
  }

  /**
   * Put a callout in the centre lane, in order (0 the warnings' command, 1
   * the STALL slab, 2 the banner, anything else after). The lane stacks
   * them; nothing positions itself.
   */
  addCallout(node, order = 3) {
    if (!node || !this.center) return node;
    node.dataset.lane = String(order);
    const after = [...this.center.children].find((c) => Number(c.dataset.lane) > order);
    this.center.insertBefore(node, after || null);
    if (order === 0) this.calloutCmd = node;
    return node;
  }

  /** Is the warnings' big command (PULL UP...) on screen? The banner waits for it. */
  commandUp() {
    const c = this.calloutCmd;
    return !!(c && !c.hidden && c.style.display !== 'none');
  }

  /*
   * Where the notices go. While the HUD is up they are a card in the
   * right-hand stack (prio 2: under the warnings and the mission's own
   * panel, over the wind), where they never cover the objective, the
   * waypoint arrow or a touch band again. While it is down — a debrief, a
   * menu, the rocket's own game — they go back to being the HUD's sibling,
   * top centre over everything, so an achievement that unlocks as a mission
   * ends is still seen (the reason toastLayer left the wrap in the first
   * place). Moved only when that changes.
   */
  placeToasts() {
    const inStack = !!this.enabled;
    const layer = this.toastLayer;
    if (!layer || !this.stack) return;
    layer.classList.toggle('is-loose', !inStack);
    if (inStack) {
      if (layer.parentNode !== this.stack.el) this.stack.add(layer, { prio: 2, id: 'notices', chip: false });
      layer.classList.remove('is-in-bar', 'is-low');
      layer.style.removeProperty('--toast-x');
      layer.style.removeProperty('--toast-y');
      layer.style.removeProperty('--toast-w');
    } else {
      if (layer.parentNode !== this.root) this.root.appendChild(layer);
      this.placeLoose();
    }
  }

  /**
   * Where a notice goes while the HUD is down (a menu, a debrief): never over
   * a screen's title or its buttons. In the menus the top bar has an empty
   * middle between the game switcher and the credits, and the notice sits in
   * it; where that gap is too narrow (a phone) it sits at the bottom of the
   * screen instead. With no menu bar showing (the rocket's own game) it keeps
   * the top-centre place it always had. Measured only when a notice arrives
   * or the layer moves, never per frame.
   */
  placeLoose() {
    const layer = this.toastLayer;
    if (!layer || typeof document === 'undefined' || !document.querySelector) return;
    const bars = document.querySelectorAll('.menu-bar');
    let bar = null;
    for (const b of bars) {
      const r = b.getBoundingClientRect ? b.getBoundingClientRect() : null;
      if (r && r.width > 0 && r.height > 0) {
        bar = { el: b, r };
        break;
      }
    }
    layer.classList.remove('is-in-bar', 'is-low');
    if (!bar) return;
    const sw = bar.el.querySelector('.switcher');
    const pill = bar.el.querySelector('.credit-pill');
    const a = sw ? sw.getBoundingClientRect().right : bar.r.left;
    const b = pill ? pill.getBoundingClientRect().left : bar.r.right;
    const gap = b - a - 24;
    if (gap >= 300) {
      layer.classList.add('is-in-bar');
      layer.style.setProperty('--toast-x', `${Math.round((a + b) / 2)}px`);
      layer.style.setProperty('--toast-y', `${Math.round(bar.r.top + bar.r.height / 2)}px`);
      layer.style.setProperty('--toast-w', `${Math.round(Math.min(560, gap))}px`);
    } else {
      layer.classList.add('is-low');
    }
  }

  /**
   * The touchscreen layout (main.js, once, when it adds .is-touch). The
   * column starts under the instrument band — and the helicopter's card,
   * which hangs under the band's right-hand end — so it watches their sizes.
   * And the autopilot's HDG/SPD/VS bugs, which on a touchscreen floated on
   * their own at the top right (where the damage diagram also went: 76x52
   * of one over the other on an iPad), become a card in the column.
   */
  useTouchLayout() {
    if (!this.stack) return;
    this.stack.add(this.apBugs, { prio: 1.2, id: 'autopilot', chip: false });
    const left = this.wrap.querySelector(':scope > .hud-left');
    this.stack.watchBand([left, this.wrap.querySelector(':scope > .hud-top'), this.wrap.querySelector(':scope > .hud-buttons')]);
    this._watchHeli = () => {
      const heli = this.wrap.querySelector('.hud-heli');
      if (heli && !heli._rsWatched) {
        heli._rsWatched = true;
        this.stack.watchBand([heli]);
      }
      // The hover strip too: it appears and goes with is-rotorhover, and the
      // column starts under it (hud-stack.js touchTop()).
      const strip = this.rotorPanel;
      if (strip && !strip._rsWatched) {
        strip._rsWatched = true;
        this.stack.watchBand([strip]);
      }
    };
    this._watchHeli();
  }

  setVisible(v) {
    this.enabled = v;
    this.wrap.style.display = v && !this.hidden ? '' : 'none';
    this.placeToasts();
  }

  /**
   * Hide every overlay for a clean view out of the window. Kept separate from
   * setVisible so that leaving a menu does not undo it.
   *
   * Clean means clean: the notices are in the stack, so they go with the
   * rest — and they are HELD, not run down, while the interface is hidden
   * (updateOverlays()), so one that arrives during a cutscene or a clean
   * shot is read afterwards instead of expiring unseen.
   */
  setHidden(hidden) {
    this.hidden = hidden;
    this.wrap.style.display = this.enabled && !hidden ? '' : 'none';
    if (!hidden) this.setCleanShot(false);
    return hidden;
  }

  /** U: the player's clean shot (a cutscene hiding the HUD is not one). */
  toggleHidden() {
    const hidden = this.setHidden(!this.hidden);
    this.setCleanShot(hidden);
    return hidden;
  }

  /*
   * html.ui-clean while the player has hidden the interface with U, so the
   * pieces that live outside the HUD's wrapper (the story's caption chip and
   * lower third) go too: "hides everything" meant everything.
   */
  setCleanShot(on) {
    if (typeof document === 'undefined' || !document.documentElement) return;
    document.documentElement.classList.toggle('ui-clean', !!on);
  }

  setHighContrast(on) {
    this.wrap.classList.toggle('is-contrast', !!on);
    // toastLayer is no longer a descendant of wrap (see build()), so it does
    // not pick up .hud.is-contrast for free — mirror the class directly.
    this.toastLayer.classList.toggle('is-contrast', !!on);
  }

  setLargeText(on) {
    this.wrap.classList.toggle('is-large', !!on);
  }

  /**
   * HUD density (Settings → Accessibility). 'clean', the default: the
   * information folds away a few seconds after it changes — the wind and the
   * damage diagram to chips in the right-hand stack, the key line and the
   * chips that only say "normal" (GEAR DOWN, FLAPS 0, EASY MODE) out of the
   * engine strip — and comes back when it changes, on H, or on a tap. 'full'
   * is everything open, as it was. Warnings, the objective, the instruments
   * and the minimap are the same in both.
   */
  setDensity(d) {
    this.density = d === 'full' ? 'full' : d === 'photo' ? 'photo' : 'clean';
    const photo = this.density === 'photo';
    // Photo is the Clean HUD with almost everything hidden by CSS (is-photo):
    // the warnings, the centre lane, the radio line and the dock stay.
    this.wrap.classList.toggle('is-clean', this.density !== 'full');
    this.wrap.classList.toggle('is-photo', photo);
    // On <html> too, for the minimap, which is not inside the wrapper.
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.classList.toggle('hud-photo', photo);
    }
    if (this.stack) this.stack.setDensity(this.density === 'full' ? 'full' : 'clean');
    if (this.btnHud) {
      this.btnHud.classList.toggle('is-on', photo);
      this.btnHud.dataset.mode = this.density;
      this.btnHud.setAttribute('aria-label', `HUD mode: ${DENSITY_SHORT[this.density]} (${keyName('hudMode')} cycles Full / Clean / Photo)`);
    }
    this.wakeBottom();
  }

  /** The engine strip's key line and quiet chips, back for `seconds`. */
  wakeBottom(seconds = 6) {
    this._quietT = seconds;
    if (this.wrap.classList.contains('is-quiet')) this.wrap.classList.remove('is-quiet');
  }

  setSubtitlesEnabled(on) {
    this.subtitlesEnabled = on;
    if (!on) this.subtitle.style.display = 'none';
  }

  showControls(bindings, keyLabel, actions) {
    const groups = {};
    for (const key in actions) {
      const a = actions[key];
      groups[a.group] = groups[a.group] || [];
      groups[a.group].push({ key, ...a });
    }
    let html = '<div class="cc-head">Controls</div><div class="cc-grid">';
    for (const g in groups) {
      html += `<div class="cc-group"><h4>${g}</h4>`;
      for (const item of groups[g]) {
        const keys = (bindings[item.key] || []).map((k) => `<kbd>${keyLabel(k)}</kbd>`).join(' ');
        html += `<div class="cc-row"><span>${item.label}</span><span class="cc-keys">${keys}</span></div>`;
      }
      html += '</div>';
    }
    html += `</div><div class="cc-foot">Press ${keyName('help')} to close · change any key in Settings → Controls</div>`;
    this.controlsCard.innerHTML = html;
    this.controlsCard.style.display = '';
    // Help is "what do I press" and "what am I doing": the folded objective
    // opens with the keys, and so does every chip in the right-hand stack.
    this.showObjective();
    if (this.stack) this.stack.openAll(8);
    this.wakeBottom(8);
  }

  hideControls() {
    this.controlsCard.style.display = 'none';
  }

  toggleControls(bindings, keyLabel, actions) {
    if (this.controlsCard.style.display === 'none') this.showControls(bindings, keyLabel, actions);
    else this.hideControls();
  }

  /** One short instruction naming the key to press, or null to hide it. */
  /**
   * Show or clear the taxi strip.
   * @param {string|null} text  the instruction, or null to hide the strip
   */
  setTaxi(text, hint) {
    if (!text) {
      this.taxi.style.display = 'none';
      return;
    }
    // The player's keys, not the defaults the instructions were written with.
    text = rekey(text);
    hint = rekey(hint);
    this.taxi.style.display = '';
    if (this.taxiText.textContent !== text) this.taxiText.textContent = text;
    this.taxiHint.textContent = hint || '';
    this.taxiHint.style.display = hint ? '' : 'none';
  }

  setCoach(text) {
    if (!text) {
      if (this.coach.style.display !== 'none') this.coach.style.display = 'none';
      this.lastValues.coach = null;
      return;
    }
    // "Press <kbd>I</kbd> to start the engine" names the key you have now.
    text = rekey(text);
    if (this.lastValues.coach !== text) {
      this.coach.innerHTML = text;
      this.lastValues.coach = text;
    }
    if (this.coach.style.display === 'none') this.coach.style.display = '';
  }

  /**
   * Wipe every transient overlay. Called when a flight starts, so the banner
   * from the landing you just made does not greet you on the runway as though
   * you had somehow landed at the start of the next flight.
   */
  clearTransient() {
    this.banner.style.display = 'none';
    this.bannerTimer = 0;
    this.bannerHeld = false;
    if (this.touchdown) this.touchdown.hide();
    if (this.pills) this.pills.clear();
    this.subtitle.style.display = 'none';
    this.subtitle.classList.remove('is-out');
    this.subtitleTimer = 0;
    this.subtitleFade = 0;
    // A new flight starts with its objective open, however the last one ended
    // — and with the key line and every chip showing, for a few seconds.
    this.objectiveHover = false;
    this.objectiveOpen = false;
    this.showObjective();
    this.wakeBottom();
    for (const t of this.toasts) t.node.remove();
    this.toasts.length = 0;
    this.setCoach(null);
    this.setTaxi(null);
    this.papiHint.style.display = 'none';
    this.stallWarn.style.display = 'none';
    /*
     * The patient's heart trace goes too.
     *
     * setVital() builds the panel once and then only ever shows or hides it, so
     * a medevac left it on screen and nothing in the next flight ever asked for
     * it again — you took off for a sightseeing lap with a stranger's pulse
     * still beating in the corner. Hidden directly rather than through
     * setVital(null), which would build the canvas for every pilot who has
     * never flown the medevac.
     */
    if (this.vital) this.vital.style.display = 'none';
    /*
     * And the helicopter's panel, for exactly the reason clearVehicle()
     * documents: the mode swap rewrites unit labels and update() only ever
     * writes numbers, so a label left rewritten stays rewritten for the rest
     * of the session. clearTransient() runs from startMode(), which is every
     * way into a flight, so this is the one call that cannot be forgotten.
     * It costs nothing when there is nothing to undo.
     */
    this.clearRotor();
    this.lastValues = {};
  }

  /**
   * Seconds left, or null to hide it. Turns amber under a minute and red
   * under fifteen seconds, because a number you have to read is no warning.
   */
  setMissionClock(secondsLeft) {
    const el2 = this.objectiveClock;
    if (!el2) return;
    if (secondsLeft == null) {
      el2.hidden = true;
      this.lastValues.clock = null;
      return;
    }
    const left = Math.max(0, Math.ceil(secondsLeft));
    if (this.lastValues.clock === left) return;
    this.lastValues.clock = left;
    el2.hidden = false;
    const m = Math.floor(left / 60);
    const sec = String(left % 60).padStart(2, '0');
    el2.textContent = `${m}:${sec} left`;
    el2.classList.toggle('is-warn', left <= 60 && left > 15);
    el2.classList.toggle('is-bad', left <= 15);
  }

  /**
   * Show where the aeroplane is hurt. Pass null to hide the panel entirely.
   *
   * Only repaints a zone whose band has actually changed — the HUD is redrawn
   * every frame and writing the same class sixty times a second is how a
   * panel like this ends up costing more than the scene behind it.
   */
  /**
   * Draw the damage diagram as `type`'s planform. Cheap to call every time:
   * it only rebuilds when the type changes, and keeps each zone's colour.
   */
  setDamageShape(type) {
    const p = this.damagePanel;
    const id = (type && type.id) || 'generic';
    if (!p || id === this.damageShapeId) return;
    const svg = p.querySelector('[data-dmg-plan]');
    if (!svg) return;
    const plan = damagePlanform(type);
    this.damageShapeId = id;
    svg.innerHTML = plan.svg;
    svg.dataset.kind = plan.kind;
    p.dataset.planform = plan.kind;
    const was = this.damageZones || {};
    this.damageZones = {};
    svg.querySelectorAll('[data-zone]').forEach((z) => {
      const old = was[z.dataset.zone];
      if (old && old.dataset.band) {
        z.dataset.band = old.dataset.band;
        const c = old.getAttribute('class');
        if (c) z.setAttribute('class', c);
      }
      this.damageZones[z.dataset.zone] = z;
    });
  }

  setDamage(damage, type = undefined) {
    const p = this.damagePanel;
    if (!p) return;
    // The aircraft's own outline: handed in, or the one being flown.
    const t = type !== undefined ? type : this._sim && this._sim.aircraftType;
    if (t !== undefined) this.setDamageShape(t);
    if (!damage) {
      if (!p.hidden) p.hidden = true;
      return;
    }
    let worst = 0;
    let worse = false;
    for (const k in this.damageZones) {
      const v = damage[k] || 0;
      if (v > worst) worst = v;
      const band = v < 0.06 ? 0 : v < 0.35 ? 1 : v < 0.7 ? 2 : 3;
      const z = this.damageZones[k];
      if (z.dataset.band === String(band)) continue;
      if (band > Number(z.dataset.band || 0)) worse = true;
      z.dataset.band = String(band);
      z.setAttribute('class', band === 0 ? '' : band === 1 ? 'is-light' : band === 2 ? 'is-hurt' : 'is-bad');
    }
    const top = worst < 0.06 ? 0 : worst < 0.35 ? 1 : worst < 0.7 ? 2 : 3;
    if (p.dataset.worst !== String(top)) p.dataset.worst = String(top);
    // The panel appears the moment anything is wrong and stays for the flight:
    // the whole diagram for a few seconds after each new hit, then (in the
    // Clean HUD) a chip in the stack that keeps the worst colour.
    if (worst > 0.06 && p.hidden) p.hidden = false;
    else if (worse && this.stack) this.stack.poke(p);
  }

  /**
   * The one decision left, put plainly in the middle of the screen.
   *
   * Deliberately not in the tray and not a menu: at this moment the player
   * has seconds and one question, so it is two lines and two keys, and it
   * goes away the instant it is answered.
   */
  setEmergencyChoice(options) {
    if (!this.emergencyChoice) {
      this.emergencyChoice = el('div', 'hud-choice');
      this.emergencyChoice.hidden = true;
      this.wrap.appendChild(this.emergencyChoice);
    }
    if (!options || !options.length) {
      this.emergencyChoice.hidden = true;
      return;
    }
    // Each row is a button: on a touch screen there is no 1 or 2 to press,
    // so the row itself is the answer (`action` goes to onAction).
    this.emergencyChoice.innerHTML = options
      .map(
        (o) =>
          `<button type="button" class="hud-choice-row"${o.action ? ` data-choice="${o.action}"` : ''}><kbd>${o.key}</kbd>`
          + `<span><strong>${o.label}</strong><em>${o.hint}</em></span></button>`
      )
      .join('');
    for (const b of this.emergencyChoice.querySelectorAll('button[data-choice]')) {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        b.blur();
        this.onAction(b.dataset.choice);
      });
    }
    this.emergencyChoice.hidden = false;
  }

  setObjective(title, text) {
    // "Press X to release the crate", with the player's X.
    text = rekey(text);
    let changed = false;
    if (this.lastValues.objTitle !== title) {
      this.objectiveTitle.textContent = title;
      this.lastValues.objTitle = title;
      changed = true;
    }
    if (this.lastValues.objText !== text) {
      this.objectiveText.textContent = text;
      this.objectiveText.classList.remove('is-flash');
      // Restart the flash animation so a new instruction catches the eye.
      void this.objectiveText.offsetWidth;
      this.objectiveText.classList.add('is-flash');
      this.lastValues.objText = text;
      changed = true;
    }
    // Something new to read: open up again, for as long as it takes to read.
    if (changed) this.showObjective();
  }

  /**
   * Open the objective banner for `seconds` (by default, long enough to read
   * what it says), after which it folds back into its chip.
   */
  showObjective(seconds) {
    const read = readSeconds(`${this.objectiveTitle.textContent} ${this.objectiveText.textContent}`) + 1;
    const want = seconds ?? Math.min(OBJECTIVE_OPEN_MAX, Math.max(OBJECTIVE_OPEN_MIN, read));
    this.objectiveT = Math.max(this.objectiveOpen ? this.objectiveT : 0, want);
    if (this.objectiveOpen) return;
    this.objectiveOpen = true;
    this.objective.classList.remove('is-chip');
    this.objective.removeAttribute('title');
  }

  /** Fold the objective into its one-line chip now. */
  foldObjective() {
    this.objectiveT = 0;
    if (!this.objectiveOpen) return;
    this.objectiveOpen = false;
    this.objective.classList.add('is-chip');
    this.objective.title = 'Tap, or press H, to read the whole objective';
  }

  /**
   * Count down everything on the screen that is only there for a while: the
   * radio line, the banner, the toasts, and how long the objective stays
   * open. One method, so the boat and the car — whose loops never reach
   * update() — run exactly the same clocks as the aeroplane.
   */
  updateOverlays(dt) {
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) {
        // Fade, then go: a line that blinks off mid-glance reads as a glitch.
        this.subtitle.classList.add('is-out');
        this.subtitleFade = SUBTITLE_FADE;
      }
    } else if (this.subtitleFade > 0) {
      this.subtitleFade -= dt;
      if (this.subtitleFade <= 0) {
        this.subtitle.style.display = 'none';
        this.subtitle.classList.remove('is-out');
      }
    }
    if (this.bannerTimer > 0) {
      // Held, not run down, while PULL UP or TERRAIN has the middle of the
      // screen; it comes back with the time it had left.
      if (this.commandUp()) {
        if (this.banner.style.display !== 'none') this.banner.style.display = 'none';
        this.bannerHeld = true;
      } else {
        if (this.bannerHeld) {
          this.bannerHeld = false;
          this.banner.style.display = '';
        }
        this.bannerTimer -= dt;
        if (this.bannerTimer <= 0) this.banner.style.display = 'none';
      }
    }
    /*
     * Only the notices on screen count down: two at a time (main.css hides
     * the rest), the others wait their turn with their whole time left —
     * and none of them while the interface is hidden (setHidden()).
     */
    this.overlaysAt = typeof performance !== 'undefined' ? performance.now() : 0;
    const showing = this.hidden ? 0 : Math.min(TOASTS_SHOWN, this.toasts.length);
    for (let i = showing - 1; i >= 0; i--) {
      this.toasts[i].life -= dt;
      if (this.toasts[i].life <= 0) {
        this.toasts[i].node.classList.add('is-out');
        const node = this.toasts[i].node;
        setTimeout(() => node.remove(), 400);
        this.toasts.splice(i, 1);
      }
    }
    if (this.stack) this.stack.tick(dt);
    if (this.touchdown) this.touchdown.update(dt, this.commandUp());
    if (this.objectiveOpen && !this.objectiveHover) {
      this.objectiveT -= dt;
      // Not the automatic fold for a passenger (see update()'s own note by
      // this._riding) — a deliberate tap still folds it (the click handler
      // above calls foldObjective() directly, never through this timer).
      if (this.objectiveT <= 0 && !this._riding) this.foldObjective();
    }
    this._keyHintT = (this._keyHintT || 0) - dt;
    if (this._keyHintT <= 0) {
      this._keyHintT = 0.25;
      this.syncKeyHint();
    }
    if (this._quietT > 0) {
      this._quietT -= dt;
      if (this._quietT <= 0) this.wrap.classList.add('is-quiet');
    }
    this._laneT = (this._laneT || 0) - dt;
    if (this._laneT <= 0) {
      this._laneT = 0.5;
      this.updateLanes();
    }
  }

  /**
   * The bottom lane: how far up the radio line, the coaching line and the
   * story's dialogue box have to sit to clear the controls under them.
   *
   * Each of those had a fixed `bottom` (118, 224, 60 px...), and the things
   * under them change size: the engine strip grows 70 px upward when the
   * autopilot's bugs come on, the van has its turn chevron, the boat its
   * engine lever, a touchscreen its pads and its stick. Measured: a two-line
   * call over the van's chevron (129x44), over the autopilot's +/- buttons,
   * over the boat's FULL/HALF. So the lane is measured — the top of the
   * highest control under the line's own span — and written as two custom
   * properties on <html>: --bl-h for the radio line's span, --bl-wide for
   * the screen's middle 92% (the dialogue box). Twice a second and whenever
   * a line goes up, a dozen rectangles; CSS does the rest (main.css,
   * cinema.js) with max(its old place, the lane).
   */
  updateLanes() {
    if (typeof document === 'undefined' || typeof window === 'undefined' || !document.querySelectorAll) return;
    const W = window.innerWidth || 1024;
    const H = window.innerHeight || 768;
    let x0;
    let x1;
    if (this.subtitle.style.display !== 'none') {
      const r = this.subtitle.getBoundingClientRect();
      x0 = r.left;
      x1 = r.right;
    }
    if (!(x1 > x0)) {
      const w = Math.min(720, W * 0.78);
      x0 = (W - w) / 2;
      x1 = (W + w) / 2;
    }
    // tops[2]: the same span as the radio line's, without the state pills
    // themselves — it is where the pills stand (--bl-ctl), and they must
    // not measure their own top.
    // The pills' own span, not the radio line's: on a phone held sideways the
    // radio line is nearly the screen's width and took in the flight stick at
    // the far left, which lifted the pills into the objective mid-screen.
    let p0 = W / 2 - 170;
    let p1 = W / 2 + 170;
    if (this.pills && this.pills.el && this.pills.el.getClientRects().length) {
      const pr = this.pills.el.getBoundingClientRect();
      if (pr.right - pr.left > 4) {
        p0 = pr.left;
        p1 = pr.right;
      }
    }
    const tops = [H, H, H];
    const spans = [[x0, x1], [W * 0.04, W * 0.96], [p0, p1]];
    for (const n of document.querySelectorAll(LANE)) {
      if (!n.getClientRects().length) continue;
      const r = n.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.top < H * 0.55 || r.top >= H) continue;
      const pills = n.classList.contains('hud-pills');
      for (let k = 0; k < 3; k++) {
        if (k === 2 && pills) continue;
        if (r.right > spans[k][0] && r.left < spans[k][1]) tops[k] = Math.min(tops[k], r.top);
      }
    }
    const bl = Math.max(0, Math.round(H - tops[0]));
    const wide = Math.max(0, Math.round(H - tops[1]));
    const ctl = Math.max(0, Math.round(H - tops[2]));
    if (bl !== this._bl || wide !== this._blWide || ctl !== this._blCtl) {
      this._bl = bl;
      this._blWide = wide;
      this._blCtl = ctl;
      const st = document.documentElement.style;
      st.setProperty('--bl-h', `${bl}px`);
      st.setProperty('--bl-wide', `${wide}px`);
      st.setProperty('--bl-ctl', `${ctl}px`);
    }
    /*
     * And the floor of the right-hand stack over a touchscreen's action
     * buttons (ZAP, DROP WATER, HOOK/LAUNCH, the gun and missile buttons),
     * which stand above the throttle in the same column while their mission
     * needs them: --rs-act, the stack stops above the highest one.
     */
    let act = 0;
    const se = this.stack && this.stack.el;
    if (se) {
      const sr = se.getBoundingClientRect();
      for (const n of document.querySelectorAll(ACTIONS)) {
        if (!n.getClientRects().length) continue;
        const r = n.getBoundingClientRect();
        if (r.width < 4 || r.height < 4 || r.right <= sr.left || r.left >= sr.right || r.top < H * 0.3) continue;
        act = Math.max(act, Math.round(H - r.top + 8));
      }
    }
    if (act !== this._act) {
      this._act = act;
      if (act) document.documentElement.style.setProperty('--rs-act', `${act}px`);
      else document.documentElement.style.removeProperty('--rs-act');
      if (this.stack) this.stack.roomPx = 0;
    }
  }

  /**
   * The key line at the bottom names the player's keys. The aeroplane, the
   * helicopter (hud-rotor.js) and the van and boat (hud-drive.js) each write
   * it in their own words with the default keys; this notices a new line, or
   * a key moved in Settings, and puts the live keys in. A few times a second
   * — from updateOverlays, which every game runs.
   */
  syncKeyHint() {
    const h = this.keyHintEl;
    if (!h) return;
    // A different line (another game's keys, a feature's) is worth reading:
    // it shows for a few seconds in the Clean HUD.
    const said = h.textContent;
    if (said !== this._keyHintSaid) {
      if (this._keyHintSaid !== undefined) this.wakeBottom();
      this._keyHintSaid = said;
    }
    /*
     * Key by key, in place: the line has other people's elements in it (the
     * eject feature's span), which rewriting the whole of it would detach.
     * A bare <kbd> remembers the word it was written with; a feature's live
     * one (class="k") is already right and is left alone.
     */
    for (const k of h.querySelectorAll('kbd:not([class])')) {
      if (k.dataset.k0 === undefined) k.dataset.k0 = k.textContent;
      const out = rekey(`<kbd>${k.dataset.k0}</kbd>`);
      const word = out.startsWith('<kbd>') ? out.slice(5, -6).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : k.dataset.k0;
      if (k.textContent !== word) k.textContent = word;
    }
  }

  notify(text, kind = 'info', duration = 4.2) {
    const t = el('div', `hud-toast is-${kind}`, rekey(text));
    const entry = { node: t, life: duration, kind };
    /*
     * Two on screen and the rest queued (TOASTS_SHOWN), newest last. A
     * warning or a failure goes ahead of the information still waiting, so
     * "Stall!" is never stuck behind "Minimap range 4 km".
     */
    let at = this.toasts.length;
    if (kind === 'warn' || kind === 'bad') {
      for (let i = TOASTS_SHOWN; i < this.toasts.length; i++) {
        const k = this.toasts[i].kind;
        if (k !== 'warn' && k !== 'bad') {
          at = i;
          break;
        }
      }
    }
    const before = this.toasts[at] ? this.toasts[at].node : null;
    this.toastLayer.insertBefore(t, before && before.parentNode === this.toastLayer ? before : null);
    this.toasts.splice(at, 0, entry);
    // Keep the queue short: the oldest information still waiting goes
    // first, never a notice somebody is reading or an achievement.
    while (this.toasts.length > TOASTS_KEPT) {
      let drop = -1;
      for (let i = this.toasts.length - 1; i >= TOASTS_SHOWN; i--) {
        if (this.toasts[i].kind === 'info' && this.toasts[i] !== entry) drop = i;
      }
      if (drop < 0) drop = 0;
      const [old] = this.toasts.splice(drop, 1);
      old.node.remove();
    }
    /*
     * A real-clock expiry for every notice, not just the achievements'.
     * `life` only counts down in updateOverlays(), which runs while flying —
     * so a notice raised in the menus ("Locked — unlock it for 500 credits"
     * from the Free Flight picker) sat over the Hangar's title for as long as
     * you stayed in the menus. This ends it on time when nothing is ticking
     * it, and leaves it alone while the HUD's own clock is running (a notice
     * waiting its turn keeps its whole time for when it shows).
     */
    if (typeof setTimeout === 'function') {
      const end = () => {
        const i = this.toasts.indexOf(entry);
        if (i < 0) return;
        const now = typeof performance !== 'undefined' ? performance.now() : 0;
        if (this.overlaysAt && now - this.overlaysAt < 600) {
          setTimeout(end, 1000);
          return;
        }
        this.toasts.splice(i, 1);
        t.classList.add('is-out');
        setTimeout(() => t.remove(), 400);
      };
      setTimeout(end, duration * 1000 + 250);
    }
    if (this.toastLayer.classList.contains('is-loose')) this.placeLoose();
    // Handed back so a caller can still end it early or check on it.
    return entry;
  }

  /**
   * The touchdown card (touchdown.js): rate at touchdown, grade, stars and
   * your best in this aeroplane. `aircraft` is the type ({ id, name }).
   * Waits for a PULL UP like the banner does — a card over a command is the
   * class of bug the centre lane exists to prevent.
   */
  showTouchdown(g, aircraft) {
    if (!this.touchdown || !g || g.crashed) return null;
    const out = this.touchdown.show(g, { id: aircraft && aircraft.id, name: aircraft && aircraft.name });
    // Held (not dropped) while a command is up: updateOverlays() brings it back.
    if (this.commandUp() && this.touchdown.el) this.touchdown.el.style.display = 'none';
    return out;
  }

  showBanner(title, subtitle, kind = 'good', duration = 3.6) {
    this.banner.className = `hud-banner is-${kind}`;
    this.banner.innerHTML = `<div class="hud-banner-title">${title}</div><div class="hud-banner-sub">${subtitle || ''}</div>`;
    this.bannerTimer = duration;
    this.bannerHeld = this.commandUp();
    this.banner.style.display = this.bannerHeld ? 'none' : '';
  }

  setSubtitle(text, who, duration) {
    if (!this.subtitlesEnabled) return;
    this.subtitleWho.textContent = who || '';
    this.subtitleText.textContent = text;
    this.subtitle.style.display = '';
    this.subtitle.classList.remove('is-out');
    this.subtitleFade = 0;
    // Up for as long as it is spoken, and never for less time than it takes
    // to read — the fallback timings (no audio yet) are a flat 3 to 4 s,
    // which is not long enough for a two-line clearance.
    this.subtitleTimer = Math.max(2.4, duration || 3.5, text ? readSeconds(text) : 0);
    // Above whatever is under its span right now, before it is ever drawn.
    this.updateLanes();
  }

  /**
   * A hazard you need to keep track of — currently the tornado.
   *
   * You cannot fly away from something you cannot find, and a funnel two
   * kilometres off is small in a big sky. This says where it is and how far,
   * and updates as you move.
   */
  setHazard(text) {
    if (!this.hazard) {
      this.hazard = el('div', 'hud-hazard');
      this.hazard.style.display = 'none';
      // In the top lane, under the waypoint arrow, not on top of it: at a
      // fixed 96 px it covered the arrow that says the same thing.
      (this.topLane || this.wrap).appendChild(this.hazard);
    }
    if (!text) {
      this.hazard.style.display = 'none';
      this.waypoint.classList.remove('is-arrow-only');
      return;
    }
    this.hazard.innerHTML = text;
    this.hazard.style.display = '';
    // The hazard line names it and says how far: the arrow keeps pointing,
    // its own words would only say it twice.
    this.waypoint.classList.add('is-arrow-only');
  }

  /**
   * A patient's vital sign, for the missions that carry one.
   *
   * Deliberately a real number and a beating trace rather than a bar: a bar
   * says "some quantity is going up", and what you want to feel is that there
   * is a person in the back whose pulse you are personally responsible for.
   *
   * @param {number|null} bpm  null hides it entirely
   * @param {'ok'|'warn'|'bad'} level
   */
  setVital(bpm, level = 'ok') {
    if (!this.vital) {
      this.vital = el('div', 'hud-vital');
      this.vital.style.display = 'none';
      this.vitalTrace = el('canvas', 'hud-vital-trace');
      this.vitalTrace.width = 132;
      this.vitalTrace.height = 34;
      this.vitalLabel = el('div', 'hud-vital-label', 'PATIENT');
      this.vitalValue = el('div', 'hud-vital-value', '—');
      const txt = el('div', 'hud-vital-text');
      txt.appendChild(this.vitalLabel);
      txt.appendChild(this.vitalValue);
      this.vital.appendChild(this.vitalTrace);
      this.vital.appendChild(txt);
      this.wrap.appendChild(this.vital);
      // The mission's own card: under the warnings, never folded away.
      if (this.stack) this.stack.add(this.vital, { prio: 1.5, id: 'vital', chip: false });
      this._vitalPhase = 0;
    }
    if (bpm == null) {
      this.vital.style.display = 'none';
      return;
    }
    this.vital.style.display = '';
    this.vitalValue.innerHTML = `${bpm}<span class="hud-vital-unit">bpm</span>`;
    this.vital.classList.toggle('is-warn', level === 'warn');
    this.vital.classList.toggle('is-bad', level === 'bad');

    // The trace scrolls at the rate the heart is actually beating, so a fast
    // pulse looks fast rather than just reading a bigger number.
    const c = this.vitalTrace;
    const g = c.getContext('2d');
    const col = level === 'bad' ? '#ff5a3c' : level === 'warn' ? '#ffb020' : '#3ec96a';
    this._vitalPhase = (this._vitalPhase + bpm / 60 / 30) % 1;
    g.clearRect(0, 0, c.width, c.height);
    g.strokeStyle = col;
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x < c.width; x++) {
      // One QRS spike per beat, flat between them.
      const t = ((x / c.width) * 2.2 + this._vitalPhase) % 1;
      let y = c.height * 0.62;
      if (t > 0.10 && t < 0.16) y = c.height * 0.72;           // P
      else if (t > 0.18 && t < 0.22) y = c.height * 0.16;      // R
      else if (t > 0.22 && t < 0.26) y = c.height * 0.88;      // S
      else if (t > 0.30 && t < 0.40) y = c.height * 0.48;      // T
      x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
  }

  /**
   * Speed and heading for a boat or a car.
   *
   * The aeroplane's four readouts do not fit: a boat has no altitude and a car
   * has no vertical speed, and showing "0 ft" beside them would be worse than
   * showing nothing. So the same strip is reused with the two numbers that
   * actually mean something, and the rest is hidden.
   */
  setVehicle(r, spec) {
    // Stepping straight from the helicopter into the boat does not go through
    // startMode(), so the hover strip would still be drawn over the launch.
    this.clearRotor();
    this.wrap.classList.add('is-vehicle');
    this.inVehicle = true;
    const kph = Math.round(r.speedKph);
    const kt = Math.round(r.speedKts);
    this.speedValue.textContent = spec.kind === 'boat' ? String(kt) : String(kph);
    this.speedWord.textContent =
      spec.kind === 'boat'
        ? kt < 1 ? 'stopped' : kt < 8 ? 'idling along' : kt < 25 ? 'making way' : 'on the plane'
        : kph < 1 ? 'stopped' : kph < 25 ? 'crawling' : kph < 70 ? 'moving' : 'quick';
    const unit = this.speedValue.parentElement.querySelector('.hud-unit');
    if (unit) unit.textContent = spec.kind === 'boat' ? 'kt' : 'km/h';
    this.hdgValue.textContent = String(Math.round(r.heading)).padStart(3, '0');
    const h = Math.round(r.heading);
    this.hdgWord.textContent =
      h > 315 || h <= 45 ? 'north' : h <= 135 ? 'east' : h <= 225 ? 'south' : 'west';
    this.altValue.textContent = (r.distanceM / 1000).toFixed(1);
    this.altWord.textContent = 'travelled';
    // A van is not up anything: the short height line goes (empty = hidden).
    this.altUp.textContent = '';
    const altUnit = this.altValue.parentElement.querySelector('.hud-unit');
    if (altUnit) altUnit.textContent = 'km';
    this.throttleBar.fill.style.width = `${Math.round(r.throttle * 100)}%`;
    this.throttleBar.val.textContent = `${Math.round(r.throttle * 100)}%`;
  }

  /**
   * Put the strip back the way an aeroplane needs it.
   *
   * setVehicle rewrites the two unit labels in place — 'kt'/'km/h' on the
   * speed, 'km' and the word "travelled" on the altitude — and update() only
   * ever writes the numbers, never the units. So without this, one trip in the
   * boat left the altimeter reading kilometres travelled for the rest of the
   * session, on every flight, until you reloaded the page.
   */
  clearVehicle() {
    if (!this.inVehicle) return;
    this.inVehicle = false;
    this.wrap.classList.remove('is-vehicle');
    const speedUnit = this.speedValue.parentElement.querySelector('.hud-unit');
    if (speedUnit) speedUnit.textContent = 'kt';
    const altUnit = this.altValue.parentElement.querySelector('.hud-unit');
    if (altUnit) altUnit.textContent = 'ft';
    this.altWord.textContent = '';
    this.altUp.textContent = '';
    // So the next update() writes the aeroplane's words straight back.
    this.lastValues.alt = null;
  }

  /** Name of the aeroplane, shown on the top strip. */
  setAircraftName(name) {
    if (this.acName) this.acName.textContent = name || '';
  }

  /**
   * The realistic cockpit has real instruments on the panel, so the overlay
   * that repeats them is just clutter in front of the windscreen.
   */
  /**
   * Lightning strike: the instruments die.
   *
   * Dimming them alone was too quiet to notice. Now the panels go dark, a red
   * caption pulses where they were, and when the power comes back they fade in
   * rather than snapping — which is both nicer to look at and closer to what
   * an instrument does when it spins back up.
   */
  setBlackout(on) {
    const want = !!on;
    if (want === this._blackout) return;
    this._blackout = want;
    this.wrap.classList.toggle('is-blackout', want);
    if (!this.blackoutSign) {
      this.blackoutSign = el('div', 'hud-blackout', 'INSTRUMENTS');
      this.wrap.appendChild(this.blackoutSign);
    }
    this.blackoutSign.classList.toggle('is-on', want);
    if (!want) {
      // Fade back in: the class comes off, the transition does the rest.
      this.wrap.classList.add('is-recovering');
      clearTimeout(this._recoverTimer);
      this._recoverTimer = setTimeout(() => this.wrap.classList.remove('is-recovering'), 1400);
    }
  }

  setMinimal(on) {
    this.wrap.classList.toggle('is-minimal', !!on);
  }

  setMuted(m) {
    this.btnMute.innerHTML = icon(m ? 'soundOff' : 'soundOn', 20) + `<span>${m ? 'Sound off' : 'Sound on'}</span>`;
    this.btnMute.classList.toggle('is-off', m);
  }

  /** Open or close the overflow tray of quick buttons. */
  setTrayOpen(open) {
    if (!this.tray) return;
    this.trayOpen = !!open;
    this.tray.hidden = !this.trayOpen;
    // Belt and braces: the attribute is the truth, but an inline style cannot
    // be beaten by a stylesheet rule loading in a different order.
    this.tray.style.display = this.trayOpen ? '' : 'none';
    this.btnMore.classList.toggle('is-on', this.trayOpen);
    this.btnMore.setAttribute('aria-expanded', this.trayOpen ? 'true' : 'false');
  }

  /** Light the guidance button when the rails are showing. */
  setGuideActive(on) {
    if (this.btnGuide) this.btnGuide.classList.toggle('is-on', !!on);
  }

  /**
   * Show or hide the autopilot chip, and light its button. `ap` (the
   * Autopilot instance) is optional — pass it to keep the HDG/SPD/VS bugs
   * under the chip in step; leave it out (as a plain disengage does) and the
   * bugs simply go away with the chip.
   */
  setAutopilot(on, label, ap) {
    this.apChip.textContent = label || 'AUTOPILOT';
    this.apChip.classList.toggle('is-on', !!on);
    this.apChip.style.display = on ? '' : 'none';
    if (this.btnAuto) this.btnAuto.classList.toggle('is-on', !!on);
    this.setAutopilotBugs(on ? ap : null);
  }

  /** The heading, speed and climb/descend bugs, or hide them when it is not flying. */
  setAutopilotBugs(ap) {
    if (!this.apBugs) return;
    if (!ap || !ap.engaged) {
      this.apBugs.style.display = 'none';
      return;
    }
    this.apBugs.style.display = '';
    this.apHdgBug.val.textContent = `HDG ${String(Math.round(ap.selectedHeadingDeg)).padStart(3, '0')}°`;
    this.apSpdBug.val.textContent = `SPD ${Math.round(ap.selectedSpeedKts)}`;
    this.apVsBug.val.textContent = `VS ${Math.round(ap.selectedVsFpm)}`;
  }

  /** Show or hide the key monitor. @returns {boolean} whether it is now on */
  toggleKeyMonitor(force) {
    const on = force === undefined ? this.keyMon.style.display === 'none' : !!force;
    this.keyMon.style.display = on ? '' : 'none';
    if (this.btnKeys) this.btnKeys.classList.toggle('is-on', on);
    return on;
  }

  /** Light up whichever keys are down, and show where the stick actually is. */
  updateKeyMonitor(input, ac) {
    if (this.keyMon.style.display === 'none' || !input) return;
    const heli = input.context === 'heli';
    const stamp = `${bindingsVersion()}|${heli}`;
    const relabel = this._keyMonStamp !== stamp;
    this._keyMonStamp = stamp;
    for (const action in this.keyCells) {
      const id = (heli && HELI_MAP[action]) || action;
      if (relabel) {
        const codes = (input.bindings && input.bindings[id]) || [];
        this.keyCells[action].textContent = `${codes.length ? shortKey(codes[0]) : '—'}${this.keyCellTags[action] || ''}`;
      }
      const down = typeof input.held === 'function' ? input.held(id) : false;
      this.keyCells[action].classList.toggle('is-down', !!down);
    }
    /*
     * The live control positions live on the aeroplane, not on the input —
     * `input.controls` does not exist, and falling back to `input` itself gave
     * a readout that sat at zero however hard you pulled. Reading the surfaces
     * is also more honest: it shows where the controls actually are after the
     * assists have had their say, which is the interesting number.
     */
    const c = (ac && ac.controls) || {};
    const pct = (v) => `${Math.round(clamp(v, -1, 1) * 100)}`;
    this.keyAxes.textContent =
      `pitch ${pct(c.pitch || 0)}  roll ${pct(c.roll || 0)}  ` +
      `yaw ${pct(c.yaw || 0)}  thr ${Math.round((c.throttle || 0) * 100)}`;
  }

  /** Main per-frame refresh. */
  update(dt, sim) {
    this._sim = sim;
    // A new aircraft mid-flight (the hangar, a mission swap): its own outline.
    if (this.damagePanel && !this.damagePanel.hidden) this.setDamageShape(sim.aircraftType);
    const ac = sim.aircraft;
    const r = ac.readouts();
    const w = sim.weather;
    // A passenger (sim.riding — Air Force One's President seat) has no key
    // or tap bound to "read it again", and walking a first-person cabin
    // gives no hint that the folded chip is even clickable — so the step
    // banner stays open and whole for them instead of folding to an
    // ellipsis after the usual read-it-once timer (updateOverlays()).
    this._riding = !!sim.riding;
    this.updateKeyMonitor(sim.input, ac);
    /*
     * The helicopter's panel, if this is a helicopter. It swaps the four
     * cruise rows for the hover strip below about 30 kt over the ground and
     * swaps them back above 45 — two thresholds and not one, so it cannot
     * flicker at the boundary. The cruise code below keeps running while the
     * hover strip is up: every number in it is change-gated, so it costs
     * almost nothing, and it means the cruise rows are right the instant they
     * come back rather than one frame later.
     */
    const rotor = !!SPEC.rotor;
    this.updateRotor(dt, sim, r);

    // --- Numbers with plain-language captions ---
    /*
     * Indicated airspeed is a wing's number: it says how close the wing is to
     * stopping flying. The Skyhook's wing is a stub that exists to hang the
     * gear from, so on a rotorcraft this row shows GROUNDSPEED instead — the
     * number the fuel, the arrival time and the winch all actually depend on.
     * setRotorUnits() relabels the row to match, so the label and the figure
     * can never disagree.
     */
    const ias = Math.round(rotor ? r.groundKts : r.iasKts);
    /*
     * The Mach number, for the types built to go past it (the burners'
     * profiles, aircraft/reheat.js, and the B-1B's swing wing): from Mach
     * 0.5, in place of the speed word, to two places — "Mach 1.42 ·
     * supersonic". Knots say nothing up high, where 300 indicated is twice
     * the speed of sound.
     */
    const machType = !rotor && !!(SPEC.reheat || (sim && sim.aircraftType && sim.aircraftType.swingWing));
    const mach = machType && ac && ac.mach >= 0.5 ? Math.round(ac.mach * 100) / 100 : 0;
    if (this.lastValues.ias !== ias || this.lastValues.mach !== mach) {
      this.speedValue.textContent = fmt(ias);
      this.lastValues.ias = ias;
      this.lastValues.mach = mach;
      let word;
      if (mach) word = `Mach ${mach.toFixed(2)}${mach >= 1 ? ' · supersonic' : ''}`;
      else if (rotor) word = rotorSpeedWord(ias);
      else {
        word = 'stopped';
        if (ias > 150) word = 'very fast';
        else if (ias > 110) word = 'fast';
        else if (ias > 70) word = 'good cruising speed';
        else if (ias > 52) word = 'flying speed';
        else if (ias > 30) word = 'too slow to fly';
        else if (ias > 3) word = 'rolling';
      }
      this.speedWord.textContent = word;
      // Never amber on a helicopter: 40 kt is an ordinary way for this machine
      // to cross a bay, not an emergency.
      this.speedValue.classList.toggle('is-warn', !rotor && ias > 0 && ias < 52 && !r.onGround);
    }

    /*
     * On the ground the altimeter reads 0, with the field's own height beside
     * the words.
     *
     * In the air this is height above the sea, the same number the cockpit
     * altimeter shows and the tutorial's "climb to 1,000 feet" is checked
     * against, and that is unchanged. But sitting on Kestrel's runway it read
     * "50 ft · on the ground", which to a ten-year-old is simply wrong — you
     * are not fifty feet up, you are on the tarmac — and at the air base it
     * was "940 ft". So on the ground the big number is how high you are (0)
     * and the small line says where the sea-level count starts from, which is
     * also why the number picks up at the field's height the moment the
     * wheels leave it.
     */
    /*
     * And in the air, low down, the line under it says how high you are over
     * the GROUND, in feet, as a number.
     *
     * The owner, 2026-10-04: "houses are like 200 ft tall according to the
     * game". Measured beside the house nearest the middle of Kestrel's town,
     * level with its ridge (9.8 m, 32 ft): the panel read "180 ft · just off
     * the ground". The town stands on a hill 43 m (140 ft) above the sea, and
     * the big number counts from the sea; nothing on the panel said how far
     * down the ground was, so the only reading of it was a 180 ft house. The
     * thirty maps' towns stand 16 to 318 m above the sea (median 66 m), so
     * every one of them told the same story: a roof read anything from 90 ft
     * to over 1,000.
     *
     * The big number stays what it is — the altimeter, the cockpit's and the
     * tutorial's "climb to 1,000 feet" — and under it, below 1,500 ft over
     * the ground, the line now gives the height over it, which is what a
     * house can be measured against. Over the sea that is over the water,
     * not the sea floor (the warnings' radio altitude does the same).
     */
    const onGround = !!r.onGround;
    const fieldFt = Math.max(0, Math.round((r.altFt - r.aglFt) / 10) * 10);
    const alt = onGround ? 0 : Math.round(r.altFt / 10) * 10;
    const agl = Math.max(0, Math.min(r.aglFt, r.altFt));
    const overFt = aboveGroundFt(agl);
    const altKey = onGround ? `ground ${fieldFt}` : `${alt} ${agl < 1500 ? overFt : agl < 6000 ? 'high' : 'very'}`;
    if (this.lastValues.alt !== altKey) {
      this.altValue.textContent = fmt(alt);
      this.lastValues.alt = altKey;
      // Both lengths from one place (altitudeWords): the sentence for the
      // laptop panel, the short form for the touch band and a narrow window,
      // which hide the sentence and showed nothing over the ground at all.
      const { word, short } = altitudeWords({ onGround, fieldFt, aglFt: agl });
      this.altWord.textContent = word;
      this.altUp.textContent = short;
    }

    const vs = Math.round(r.vsFpm / 25) * 25;
    if (this.lastValues.vs !== vs) {
      this.vsValue.textContent = (vs > 0 ? '+' : '') + fmt(vs);
      this.lastValues.vs = vs;
      let word = 'level';
      if (vs > 900) word = 'climbing fast';
      else if (vs > 180) word = 'climbing';
      else if (vs < -900) word = 'dropping fast!';
      else if (vs < -180) word = 'descending';
      this.vsWord.textContent = word;
      this.vsValue.classList.toggle('is-warn', vs < -900 && !r.onGround);
    }

    const hdg = Math.round(r.heading);
    if (this.lastValues.hdg !== hdg) {
      this.hdgValue.textContent = String(hdg).padStart(3, '0');
      this.lastValues.hdg = hdg;
      const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
      this.hdgWord.textContent = dirs[Math.round(hdg / 45) % 8];
    }

    // --- Wind ---
    /*
     * Which way the wind is pushing YOU, not which way it crosses runway 09.
     *
     * This asked for the description against a fixed heading of 90°, which is
     * runway 09. Pointing down the runway the two agree, and the moment you
     * turn off it they do not: fly west with the wind out of the north and the
     * strip said "wind pushing from the left" while north was over your right
     * shoulder — exactly backwards, and it stayed backwards for the whole
     * flight. Turn far enough and it would even call a headwind a tailwind.
     * This sentence is the only explanation of the wind a child gets, so it has
     * to be about the aeroplane. The tower's crosswind call in atc-director.js
     * still asks against 90, and should: that one really is about the runway.
     */
    const desc = w.windDescription(r.heading);
    if (this.lastValues.windText !== desc.text) {
      this.windText.textContent = desc.text;
      this.lastValues.windText = desc.text;
    }
    const detail = `${Math.round(w.windSpeedKts)} kt from ${String(Math.round(w.windDirDeg)).padStart(3, '0')}°`;
    if (this.lastValues.windDetail !== detail) {
      this.windDetail.textContent = detail;
      this.lastValues.windDetail = detail;
    }
    // Needle points the way the wind is blowing, relative to where we point.
    const rel = ((w.windDirDeg - r.heading + 540) % 360) - 180;
    if (this.lastValues.windRel !== rel) {
      this.windNeedle.style.transform = `rotate(${rel}deg)`;
      this.lastValues.windRel = rel;
    }
    const wx = `${w.cond.label} · ${w.timeInfo.label}`;
    if (this.lastValues.wx !== wx) {
      this.weatherText.textContent = wx;
      this.lastValues.wx = wx;
    }
    // The folded card's plain words, changing with the 5 kt band, not the gust.
    const words = conditionsWords({ timeLabel: w.timeInfo.label, condLabel: w.cond.label, windKts: Math.round(w.windSpeedKts / 5) * 5 });
    if (this.lastValues.wxWords !== words) {
      this.wxChip.textContent = words;
      this.lastValues.wxWords = words;
    }
    /*
     * The wind card is information: it opens for a few seconds when the
     * weather changes or the wind picks up or drops by a band (5 kt), and
     * otherwise sits folded as "18 kt" and the needle — not on every gust,
     * and not every time the words change because the aeroplane turned.
     */
    const band = `${wx}|${Math.round(w.windSpeedKts / 5)}`;
    if (this.lastValues.wxBand !== band) {
      if (this.lastValues.wxBand !== undefined && this.stack) this.stack.poke(this.weatherCard);
      this.lastValues.wxBand = band;
    }

    // --- Bars and chips ---
    // Change-gated like everything else here — this panel is repainted sixty
    // times a second and writing the same word into the DOM sixty times a
    // second is how an overlay ends up costing more than the island does.
    const throttlePct = Math.round(r.throttle * 100);
    if (this.lastValues.throttle !== throttlePct) {
      this.throttleBar.fill.style.width = `${throttlePct}%`;
      this.throttleBar.val.textContent = `${throttlePct}%`;
      this.lastValues.throttle = throttlePct;
    }
    const fuelPct = Math.round(r.fuelPct * 100);
    if (this.lastValues.fuel !== fuelPct) {
      this.fuelBar.fill.style.width = `${fuelPct}%`;
      this.fuelBar.val.textContent = `${fuelPct}%`;
      this.fuelBar.fill.classList.toggle('is-low', r.fuelPct < 0.15);
      this.lastValues.fuel = fuelPct;
    }

    const gearText = r.gearPos > 0.95 ? 'GEAR DOWN' : r.gearPos < 0.05 ? 'GEAR UP' : 'GEAR MOVING';
    if (this.lastValues.gear !== gearText) {
      this.gearChip.textContent = gearText;
      this.gearChip.classList.toggle('is-good', r.gearPos > 0.95);
      this.gearChip.classList.toggle('is-warn', r.gearPos < 0.95);
      this.lastValues.gear = gearText;
    }
    const flapText = `FLAPS ${r.flapStep * 10}`;
    if (this.lastValues.flap !== flapText) {
      this.flapChip.textContent = flapText;
      this.flapChip.classList.toggle('is-good', r.flapStep > 0);
      this.lastValues.flap = flapText;
    }
    const brakesOn = r.brakes > 0.4;
    if (this.lastValues.brakes !== brakesOn) {
      this.brakeChip.classList.toggle('is-on', brakesOn);
      this.lastValues.brakes = brakesOn;
    }
    const modeText = ac.mode === 'simplified' ? 'EASY MODE' : 'REAL MODE';
    if (this.lastValues.mode !== modeText) {
      this.modeChip.textContent = modeText;
      this.lastValues.mode = modeText;
    }

    /*
     * Trim, shown only when it is set.
     *
     * A trim that is wound and invisible is worse than no trim at all: the
     * aeroplane behaves differently and nothing on screen says why. Shown as
     * nose-up / nose-down in units of the wheel rather than a raw number,
     * because "UP 4" is a position you can return to and "0.37" is not.
     */
    const t = ac.controls.trim || 0;
    const set = Math.abs(t) > 0.02;
    if (this.lastValues.trimSet !== set) {
      this.trimChip.style.display = set ? '' : 'none';
      this.lastValues.trimSet = set;
    }
    if (set) {
      const notches = Math.round(Math.abs(t) * 10);
      const trimText = `TRIM ${t > 0 ? 'UP' : 'DOWN'} ${notches}`;
      if (this.lastValues.trim !== trimText) {
        this.trimChip.textContent = trimText;
        this.trimChip.classList.toggle('is-on', true);
        this.lastValues.trim = trimText;
      }
    }

    // --- Stall + PAPI guidance ---
    /*
     * A stall is a wing's problem and this warning is a wing's warning.
     *
     * On the Skyhook it fired CONTINUOUSLY in a hover: airspeed sits at a few
     * knots, onGround is false, so "TOO SLOW — add power (Shift)" was printed
     * across the middle of the screen for the whole of every hover, telling a
     * child to do the one thing that would ruin it. A rotorcraft does not
     * stall from lack of airspeed and must not be told that it is about to.
     */
    const stallSoon = !rotor && !r.onGround && r.iasKts < 56 && r.iasKts > 3;
    const showStall = (ac.stalled && !rotor) || stallSoon;
    this.stallWarn.style.display = showStall ? '' : 'none';
    if (showStall) {
      this.stallWarn.textContent = ac.stalled
        ? 'STALL — push the nose down and add power'
        : 'TOO SLOW — add power (Shift)';
      this.stallWarn.classList.toggle('is-hard', ac.stalled);
    }

    /*
     * The glide-path pill only on an approach: pointed at the runway (09,
     * the way the lights face) and under 1,500 ft over the ground. The
     * lights answer anywhere west of the field within 12 km, so it read
     * "Too high — ease off and descend" through every meteor run, fire and
     * free flight that happened to start out there.
     */
    // And not while the coaching line is already saying it ("Too high —
    // ease the power off with Ctrl"): the same words twice in the middle of
    // a short window was the owner's clogged centre column.
    const coachSaysIt = this.coach.style.display !== 'none' && /^Too (high|low)/.test(this.lastValues.coach || '');
    const papiOn = !!sim.papiHint && !r.onGround && r.aglFt < 1500 && !coachSaysIt
      && Math.abs(((r.heading - 90 + 540) % 360) - 180) < 40;
    if (papiOn) {
      this.papiHint.style.display = '';
      this.papiHint.textContent = sim.papiHint.text;
      this.papiHint.className = `hud-papi is-${sim.papiHint.state}`;
    } else {
      this.papiHint.style.display = 'none';
    }

    // --- Waypoint arrow ---
    const target = sim.activeTarget;
    /*
     * The destination ribbon (ribbon.js) takes the target while a mission
     * or job names one, with the mission's final destination marked too
     * when that is somewhere else. The arrow pill below stands down while
     * the tape is up: same place, same distance, said once.
     */
    if (this.dest) {
      const runner = sim.runner;
      const dest = target && runner && runner.status === 'running' && runner.destination ? runner.destination() : null;
      this.dest.update(r.heading, ac.pos, target, dest);
    }
    // In beacon-only mode the shaft of light *is* the guidance, so the arrow
    // stands down rather than duplicating it.
    const arrowWanted = (sim.settings?.guideStyle || 'arrow') !== 'beacon' && !(this.dest && this.dest.shown);
    if (target && arrowWanted) {
      const dx = target.pos.x - ac.pos.x;
      const dz = target.pos.z - ac.pos.z;
      const dist = Math.hypot(dx, dz);
      const bearing = (Math.atan2(dx, -dz) * 180) / Math.PI;
      const relB = ((bearing - r.heading + 540) % 360) - 180;
      this.waypoint.style.display = '';
      // The glyph points east when it is not rotated, but a relative bearing of
      // zero means "dead ahead" — so it needs a quarter turn taken off, or the
      // arrow sends you 90 degrees off every single time.
      this.waypointArrow.style.transform = `rotate(${relB - 90}deg)`;
      /*
       * Distance, at the precision that is useful at that distance.
       *
       * Rounding to the nearest 10 m is fine at two kilometres and useless on
       * short final, where the difference between 120 m and 40 m is the
       * difference between "aim" and "flare". Inside 125 m it counts in fives
       * and says so plainly, because that is the part of the approach where
       * you most want to be told.
       */
      const near = dist <= 125;
      const distText =
        dist > 1200
          ? `${(dist / 1000).toFixed(1)} km`
          : near
            ? `${Math.round(dist / 5) * 5} m`
            : `${Math.round(dist / 10) * 10} m`;
      const txt = near ? `${target.label} · ${distText} — almost there` : `${target.label} · ${distText}`;
      this.waypoint.classList.toggle('is-near', near);
      if (this.lastValues.wp !== txt) {
        this.waypointText.textContent = txt;
        this.lastValues.wp = txt;
      }
    } else {
      this.waypoint.style.display = 'none';
    }

    // --- State pills, bottom centre (pills.js) ---
    if (this.pills) {
      const plane = !sim.input || sim.input.context === 'plane';
      if (plane && !sim.riding && !this.hidden) {
        const v = bindingsVersion();
        if (this._pillKeysV !== v) {
          this._pillKeysV = v;
          this._pillKeys = {
            power: keyName('throttleUp', sim), services: keyName('services', sim), gear: keyName('gear', sim),
            spoilers: keyName('spoilers', sim), reversers: keyName('reversers', sim), lights: keyName('lights', sim),
          };
        }
        this.pills.set(pillsFor({
          onGround: !!r.onGround,
          parkingBrake: !!r.parkingBrake,
          pushing: !!sim.pushingBack,
          engineOn: !!r.engineOn,
          gearPos: r.gearPos,
          aglFt: r.aglFt,
          speedKts: r.iasKts,
          vsFpm: r.vsFpm,
          touch: this.wrap.classList.contains('is-touch'),
          keys: this._pillKeys,
          // The pilot's switches (aircraft/systems.js): the lever positions, and the lights' preset when off auto.
          speedbrake: r.speedbrake,
          spoilerPos: r.spoilerPos,
          spoilersArmed: r.spoilersArmed,
          reverse: r.reverse,
          lightsPreset: (() => {
            const p = lightPresetOf(r.lights);
            return !r.lights || (p && p.id === 'auto') ? null : p ? p.label : 'SET BY HAND';
          })(),
        }));
      } else this.pills.clear();
    }

    // --- Timers ---
    this.updateOverlays(dt);
  }
}

/*
 * The helicopter's rows, mixed into the prototype rather than written inline.
 *
 * hud.js is a thousand lines of aeroplane already, and the hover strip is a
 * different instrument panel that happens to live in the same corner. Doing it
 * this way means the aeroplane's update() is unchanged apart from two words,
 * and the rotor panel can be read on its own.
 */
installRotorHud(Hud);
