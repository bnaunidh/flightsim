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

const KTS = UNITS.KTS;
const FT = UNITS.FT;
const FPM = UNITS.FPM;

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function fmt(n, digits = 0) {
  return Number(n).toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export class Hud {
  constructor(root, { onAction } = {}) {
    this.root = root;
    this.onAction = onAction || (() => {});
    this.subtitleTimer = 0;
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
    this.vsValue = el('div', 'hud-value', '0');
    this.vsWord = el('div', 'hud-word', 'level');
    this.hdgValue = el('div', 'hud-value', '090');
    this.hdgWord = el('div', 'hud-word', 'east');

    const row = (label, value, word, unit) => {
      const r = el('div', 'hud-row');
      r.appendChild(el('div', 'hud-label', label));
      const v = el('div', 'hud-valuewrap');
      v.appendChild(value);
      if (unit) v.appendChild(el('span', 'hud-unit', unit));
      r.appendChild(v);
      r.appendChild(word);
      return r;
    };
    // Which aeroplane you are in. `setAircraftName` has existed for a while
    // and wrote into an element that was never built, so choosing a different
    // aeroplane changed how it flew and nothing on screen ever said so.
    this.acName = el('div', 'hud-acname', '');
    left.appendChild(this.acName);
    left.appendChild(row('Airspeed', this.speedValue, this.speedWord, 'kt'));
    left.appendChild(row('Altitude', this.altValue, this.altWord, 'ft'));
    left.appendChild(row('Vertical speed', this.vsValue, this.vsWord, 'ft/min'));
    left.appendChild(row('Heading', this.hdgValue, this.hdgWord, '°'));
    wrap.appendChild(left);

    /* ---- Objective + waypoint, top centre ---- */
    const top = el('div', 'hud-top');
    this.objective = el('div', 'hud-objective');
    this.objectiveTitle = el('div', 'hud-objective-title', 'Free Flight');
    this.objectiveText = el('div', 'hud-objective-text', 'Fly wherever you like. Have fun!');
    this.objective.appendChild(this.objectiveTitle);
    this.objective.appendChild(this.objectiveText);

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
    windInfo.appendChild(this.windText);
    windInfo.appendChild(this.windDetail);
    windInfo.appendChild(this.weatherText);
    right.appendChild(this.windRose);
    right.appendChild(windInfo);
    wrap.appendChild(right);

    /* ---- Engine strip, bottom left ---- */
    const bottom = el('div', 'hud-panel hud-bottom');
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
    bottom.appendChild(this.throttleBar.root);
    bottom.appendChild(this.fuelBar.root);

    bottom.appendChild(el('div', 'hud-keyhint', 'Power: <kbd>Shift</kbd>/<kbd>↑</kbd> up · <kbd>Ctrl</kbd>/<kbd>↓</kbd> down · <kbd>Space</kbd> brakes'));

    const chips = el('div', 'hud-chips');
    this.gearChip = el('div', 'hud-chip', 'GEAR DOWN');
    this.flapChip = el('div', 'hud-chip', 'FLAPS 0');
    this.brakeChip = el('div', 'hud-chip', 'BRAKES');
    this.modeChip = el('div', 'hud-chip', 'EASY MODE');
    this.apChip = el('div', 'hud-chip hud-chip-ap', 'AUTOPILOT');
    this.apChip.style.display = 'none';
    chips.appendChild(this.gearChip);
    chips.appendChild(this.flapChip);
    chips.appendChild(this.brakeChip);
    chips.appendChild(this.modeChip);
    chips.appendChild(this.apChip);
    bottom.appendChild(chips);
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

    /* ---- Centre overlays ---- */
    this.stallWarn = el('div', 'hud-stall', 'STALL — LOWER THE NOSE');
    this.stallWarn.style.display = 'none';
    wrap.appendChild(this.stallWarn);

    this.papiHint = el('div', 'hud-papi', '');
    this.papiHint.style.display = 'none';
    wrap.appendChild(this.papiHint);

    // Coach line: names the exact key to press next. It only appears when
    // there is something useful to say.
    this.coach = el('div', 'hud-coach', '');
    this.coach.style.display = 'none';
    wrap.appendChild(this.coach);

    this.toastLayer = el('div', 'hud-toasts');
    wrap.appendChild(this.toastLayer);

    this.subtitle = el('div', 'hud-subtitle');
    this.subtitle.style.display = 'none';
    this.subtitleWho = el('div', 'hud-subtitle-who', '');
    this.subtitleText = el('div', 'hud-subtitle-text', '');
    this.subtitle.appendChild(this.subtitleWho);
    this.subtitle.appendChild(this.subtitleText);
    wrap.appendChild(this.subtitle);

    this.banner = el('div', 'hud-banner');
    this.banner.style.display = 'none';
    wrap.appendChild(this.banner);

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
    const KEY_ROWS = [
      [
        ['KeyQ', 'Q'],
        ['KeyW', 'W'],
        ['KeyE', 'E'],
      ],
      [
        ['KeyA', 'A'],
        ['KeyS', 'S'],
        ['KeyD', 'D'],
      ],
      [
        ['ShiftLeft', '⇧ pwr'],
        ['Space', '␣ brk'],
        ['ControlLeft', '⌃ pwr'],
      ],
      [
        ['KeyF', 'F'],
        ['KeyV', 'V'],
        ['KeyG', 'G'],
      ],
    ];
    for (const row of KEY_ROWS) {
      const r = el('div', 'hud-keys-row');
      for (const [code, label] of row) {
        const cell = el('div', 'hud-key', label);
        this.keyCells[code] = cell;
        r.appendChild(cell);
      }
      this.keyMon.appendChild(r);
    }
    // Stick position, which is the thing the keys are actually driving.
    this.keyAxes = el('div', 'hud-keys-axes');
    this.keyMon.appendChild(this.keyAxes);
    wrap.appendChild(this.keyMon);

    this.root.appendChild(wrap);
  }

  setVisible(v) {
    this.enabled = v;
    this.wrap.style.display = v && !this.hidden ? '' : 'none';
  }

  /**
   * Hide every overlay for a clean view out of the window. Kept separate from
   * setVisible so that leaving a menu does not undo it.
   */
  setHidden(hidden) {
    this.hidden = hidden;
    this.wrap.style.display = this.enabled && !hidden ? '' : 'none';
    return hidden;
  }

  toggleHidden() {
    return this.setHidden(!this.hidden);
  }

  setHighContrast(on) {
    this.wrap.classList.toggle('is-contrast', !!on);
  }

  setLargeText(on) {
    this.wrap.classList.toggle('is-large', !!on);
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
    html += '</div><div class="cc-foot">Press H to close · change any key in Settings</div>';
    this.controlsCard.innerHTML = html;
    this.controlsCard.style.display = '';
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
    this.subtitle.style.display = 'none';
    this.subtitleTimer = 0;
    for (const t of this.toasts) t.node.remove();
    this.toasts.length = 0;
    this.setCoach(null);
    this.setTaxi(null);
    this.papiHint.style.display = 'none';
    this.stallWarn.style.display = 'none';
    this.lastValues = {};
  }

  setObjective(title, text) {
    if (this.lastValues.objTitle !== title) {
      this.objectiveTitle.textContent = title;
      this.lastValues.objTitle = title;
    }
    if (this.lastValues.objText !== text) {
      this.objectiveText.textContent = text;
      this.objectiveText.classList.remove('is-flash');
      // Restart the flash animation so a new instruction catches the eye.
      void this.objectiveText.offsetWidth;
      this.objectiveText.classList.add('is-flash');
      this.lastValues.objText = text;
    }
  }

  notify(text, kind = 'info', duration = 4.2) {
    const t = el('div', `hud-toast is-${kind}`, text);
    this.toastLayer.appendChild(t);
    this.toasts.push({ node: t, life: duration });
    // Keep the stack short.
    while (this.toasts.length > 4) {
      const old = this.toasts.shift();
      old.node.remove();
    }
  }

  showBanner(title, subtitle, kind = 'good', duration = 3.6) {
    this.banner.className = `hud-banner is-${kind}`;
    this.banner.innerHTML = `<div class="hud-banner-title">${title}</div><div class="hud-banner-sub">${subtitle || ''}</div>`;
    this.banner.style.display = '';
    this.bannerTimer = duration;
  }

  setSubtitle(text, who, duration) {
    if (!this.subtitlesEnabled) return;
    this.subtitleWho.textContent = who || '';
    this.subtitleText.textContent = text;
    this.subtitle.style.display = '';
    this.subtitleTimer = Math.max(2.4, duration || 3.5);
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
      this.wrap.appendChild(this.hazard);
    }
    if (!text) {
      this.hazard.style.display = 'none';
      return;
    }
    this.hazard.innerHTML = text;
    this.hazard.style.display = '';
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

  /** Show or hide the autopilot chip, and light its button. */
  setAutopilot(on, label) {
    this.apChip.textContent = label || 'AUTOPILOT';
    this.apChip.classList.toggle('is-on', !!on);
    this.apChip.style.display = on ? '' : 'none';
    if (this.btnAuto) this.btnAuto.classList.toggle('is-on', !!on);
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
    for (const code in this.keyCells) {
      // Arrow keys double for power, so treat them as the same cell.
      const alt =
        code === 'ShiftLeft' ? 'ArrowUp' : code === 'ControlLeft' ? 'ArrowDown' : null;
      const down = input.keys.has(code) || (alt && input.keys.has(alt));
      this.keyCells[code].classList.toggle('is-down', !!down);
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
    const ac = sim.aircraft;
    const r = ac.readouts();
    const w = sim.weather;
    this.updateKeyMonitor(sim.input, ac);

    // --- Numbers with plain-language captions ---
    const ias = Math.round(r.iasKts);
    if (this.lastValues.ias !== ias) {
      this.speedValue.textContent = fmt(ias);
      this.lastValues.ias = ias;
      let word = 'stopped';
      if (ias > 150) word = 'very fast';
      else if (ias > 110) word = 'fast';
      else if (ias > 70) word = 'good cruising speed';
      else if (ias > 52) word = 'flying speed';
      else if (ias > 30) word = 'too slow to fly';
      else if (ias > 3) word = 'rolling';
      this.speedWord.textContent = word;
      this.speedValue.classList.toggle('is-warn', ias > 0 && ias < 52 && !r.onGround);
    }

    const alt = Math.round(r.altFt / 10) * 10;
    if (this.lastValues.alt !== alt) {
      this.altValue.textContent = fmt(alt);
      this.lastValues.alt = alt;
      const agl = r.aglFt;
      let word;
      if (r.onGround) word = 'on the ground';
      else if (agl < 60) word = 'just off the ground';
      else if (agl < 400) word = 'low — be careful';
      else if (agl < 1500) word = 'a nice safe height';
      else if (agl < 6000) word = 'high above the island';
      else word = 'very high';
      this.altWord.textContent = word;
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
    const desc = w.windDescription(90);
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
    this.windNeedle.style.transform = `rotate(${rel}deg)`;
    const wx = `${w.cond.label} · ${w.timeInfo.label}`;
    if (this.lastValues.wx !== wx) {
      this.weatherText.textContent = wx;
      this.lastValues.wx = wx;
    }

    // --- Bars and chips ---
    this.throttleBar.fill.style.width = `${Math.round(r.throttle * 100)}%`;
    this.throttleBar.val.textContent = `${Math.round(r.throttle * 100)}%`;
    this.fuelBar.fill.style.width = `${Math.round(r.fuelPct * 100)}%`;
    this.fuelBar.val.textContent = `${Math.round(r.fuelPct * 100)}%`;
    this.fuelBar.fill.classList.toggle('is-low', r.fuelPct < 0.15);

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
    this.brakeChip.classList.toggle('is-on', r.brakes > 0.4);
    const modeText = ac.mode === 'simplified' ? 'EASY MODE' : 'REAL MODE';
    if (this.lastValues.mode !== modeText) {
      this.modeChip.textContent = modeText;
      this.lastValues.mode = modeText;
    }

    // --- Stall + PAPI guidance ---
    const stallSoon = !r.onGround && r.iasKts < 56 && r.iasKts > 3;
    const showStall = ac.stalled || stallSoon;
    this.stallWarn.style.display = showStall ? '' : 'none';
    if (showStall) {
      this.stallWarn.textContent = ac.stalled
        ? 'STALL — push the nose down and add power'
        : 'TOO SLOW — add power (Shift)';
      this.stallWarn.classList.toggle('is-hard', ac.stalled);
    }

    if (sim.papiHint && !r.onGround) {
      this.papiHint.style.display = '';
      this.papiHint.textContent = sim.papiHint.text;
      this.papiHint.className = `hud-papi is-${sim.papiHint.state}`;
    } else {
      this.papiHint.style.display = 'none';
    }

    // --- Waypoint arrow ---
    const target = sim.activeTarget;
    // In beacon-only mode the shaft of light *is* the guidance, so the arrow
    // stands down rather than duplicating it.
    const arrowWanted = (sim.settings?.guideStyle || 'arrow') !== 'beacon';
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
      const distText = dist > 1200 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist / 10) * 10} m`;
      const txt = `${target.label} · ${distText}`;
      if (this.lastValues.wp !== txt) {
        this.waypointText.textContent = txt;
        this.lastValues.wp = txt;
      }
    } else {
      this.waypoint.style.display = 'none';
    }

    // --- Timers ---
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) this.subtitle.style.display = 'none';
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.style.display = 'none';
    }
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      this.toasts[i].life -= dt;
      if (this.toasts[i].life <= 0) {
        this.toasts[i].node.classList.add('is-out');
        const node = this.toasts[i].node;
        setTimeout(() => node.remove(), 400);
        this.toasts.splice(i, 1);
      }
    }
  }
}
