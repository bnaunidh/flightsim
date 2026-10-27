/**
 * On-screen controls.
 *
 * On a phone or tablet there was previously no way to fly at all — the game
 * needed a keyboard. This adds the four things you cannot fly without:
 *
 *   a stick     left thumb, springs back to centre when you let go
 *   a throttle  right thumb, a vertical slider that stays where you put it
 *   a rudder    a strip along the bottom for the ground and for crosswinds
 *   the pads    gear, flaps, brakes and the camera, which is everything else
 *               you reach for often enough to want a button
 *
 * It writes into `input.touch`, which the input layer *adds* to the keyboard
 * rather than replacing it — so a tablet with a keyboard can use both, and
 * nothing here costs anything on a desktop where the layer is never built.
 *
 * The stick follows the aeroplane convention rather than the mouse one: pull
 * back (drag down) to climb. That is what every other flying game on a phone
 * does, and it is what the label under it says.
 */

import { icon } from './icons.js';
import { dragAxes, tiltAxes, holdAngles, dragClaims, DRAG_RADIUS, TOUCH_KEEP } from './touch-modes.js';

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

/** True on anything whose main pointer is a finger. */
export function isTouchDevice() {
  return (
    (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) ||
    (navigator.maxTouchPoints || 0) > 0
  );
}

/** How far the screen is turned (0 portrait; 90 / 270 landscape), wherever the browser says it. */
function screenAngle() {
  try {
    if (typeof screen !== 'undefined' && screen.orientation && Number.isFinite(screen.orientation.angle)) return screen.orientation.angle;
  } catch (e) {
    /* older browsers */
  }
  const o = typeof window !== 'undefined' ? Number(window.orientation) : 0;
  return Number.isFinite(o) ? (o + 360) % 360 : 0;
}

export class TouchControls {
  /**
   * @param {HTMLElement} host  the HUD wrapper
   * @param {object} o
   *   input     the game's Input (this writes into input.touch)
   *   onAction  (action) => void — a pad or a sheet button pressed once
   *   onHold    (action, down) => void — a sheet's hold button (trim, look behind)
   *   state     () => { crew, pushPref, parkingBrake, autopilot, rotor, assist, brace }
   *             what the sheets show, read a few times a second while one is open
   *   surface   the game's canvas: Drag anywhere starts only on the picture itself
   *   onNotice  (text) => void — a word for the player (tilt unavailable, levelled)
   *   onLevel   (level) => void — the tilt was levelled: save it
   */
  constructor(host, { input, onAction, onHold, state, surface, onNotice, onLevel } = {}) {
    this.surface = surface || null;
    this.onNotice = onNotice || (() => {});
    this.onLevel = onLevel || (() => {});
    this._visible = true;
    this.input = input;
    this.onAction = onAction || (() => {});
    this.onHold = onHold || (() => {});
    this.stateFn = typeof state === 'function' ? state : null;
    this.state = {
      pitch: 0,
      roll: 0,
      yaw: 0,
      /*
       * null means "the on-screen throttle is not being touched, so the
       * keyboard owns it". It used to sit at 0 forever, and input.js copies
       * this value into throttleTarget every frame — so on any touch-capable
       * machine the keyboard could raise the throttle by exactly one frame's
       * ramp before it was zeroed again. Measured: three seconds of holding
       * the throttle key moved it from 0 to 0.01.
       */
      throttle: null,
      /** Which engine detent a finger is holding, or null for "not mine". */
      lever: null,
      brakes: false,
      stickHeld: false,
      rudderHeld: false,
      dragging: false,
    };
    this._shown = 0;
    if (input) input.touch = this.state;

    this.layer = el('div', 'touch-layer');
    this.buildStick();
    this.buildThrottle();
    this.buildRudder();
    this.buildPads();
    this.buildSheets();
    this.buildFlyModes();
    host.appendChild(this.layer);
  }

  /* ------------------------------------------------ touch flying modes -- */

  /*
   * Settings → Controls → Touch flying (ui/touch-modes.js has the maths):
   *   stick  the fixed stick above, as it always was;
   *   drag   a floating stick wherever a finger lands on the left 55% of the
   *          PICTURE — never on a button, a sheet, a card or the map, which
   *          are all elements over the canvas and keep their taps;
   *   tilt   the gyroscope, with a LEVEL button where the stick was.
   * They write the same state.roll / state.pitch / state.stickHeld the stick
   * does, so the aeroplane, the helicopter and the boat (roll only) all fly
   * by them with nothing else changed, and the throttle, the rudder and the
   * pads keep working under other fingers at the same time.
   */
  buildFlyModes() {
    this.flyMode = 'stick';
    this.flyOpts = { sens: 1, tiltSens: 1, level: null };
    const float = el('div', 'touch-float');
    const fknob = el('div', 'touch-float-knob');
    float.appendChild(fknob);
    float.hidden = true;
    this.layer.appendChild(float);
    this.floatEl = float;
    this.floatKnob = fknob;
    const lvl = el('button', 'touch-tilt-level', 'LEVEL');
    lvl.type = 'button';
    lvl.hidden = true;
    lvl.setAttribute('aria-label', 'Level the tilt: the way you hold the phone now is straight and level');
    lvl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this._tiltNeedsAsk) this.askTilt();
      else this.levelTilt();
    });
    this.layer.appendChild(lvl);
    this.levelBtn = lvl;
    this._drag = null;
    const axes = {};
    this._onDragDown = (e) => {
      if (this.flyMode !== 'drag' || this.mode === 'drive' || !this._visible) return;
      const width = (typeof window !== 'undefined' && window.innerWidth) || 0;
      if (!dragClaims({ target: e.target, surface: this.surface, x: e.clientX, width, busy: !!this._drag, pointerType: e.pointerType, pressable: (t) => this.pressable(t) })) return;
      // The map keeps its patch of screen even where it lets taps through to the picture.
      if (this.overKept(e.clientX, e.clientY)) return;
      // Ours: the cockpit's finger look (flight/input.js) leaves this finger alone.
      e.__flyClaimed = true;
      this._drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
      float.style.left = `${e.clientX}px`;
      float.style.top = `${e.clientY}px`;
      fknob.style.transform = '';
      float.hidden = false;
      float.classList.add('is-held');
      this.state.stickHeld = true;
      this.state.roll = 0;
      this.state.pitch = 0;
      if (e.cancelable) e.preventDefault();
    };
    this._onDragMove = (e) => {
      const d = this._drag;
      if (!d || e.pointerId !== d.id) return;
      dragAxes(e.clientX - d.x0, e.clientY - d.y0, { radius: DRAG_RADIUS, sens: this.flyOpts.sens, boat: !!this._boatMode }, axes);
      fknob.style.transform = `translate(${axes.kx}px, ${axes.ky}px)`;
      this.state.roll = axes.roll;
      this.state.pitch = axes.pitch;
      if (e.cancelable) e.preventDefault();
    };
    this._onDragUp = (e) => {
      const d = this._drag;
      if (!d || e.pointerId !== d.id) return;
      this.endDrag();
    };
    const tilt = {};
    this._onTilt = (e) => {
      if (e.beta == null || e.gamma == null) return;
      this._tiltSeen = true;
      if (this.flyMode !== 'tilt') return;
      const angle = screenAngle();
      this._tiltLast = { beta: e.beta, gamma: e.gamma, angle };
      if (!this.flyOpts.level) this.levelTilt(true);
      if (this.mode === 'drive' || !this._visible) return;
      tiltAxes(e.beta, e.gamma, angle, { level: this.flyOpts.level, sens: this.flyOpts.tiltSens, boat: !!this._boatMode }, tilt);
      this.state.roll = tilt.roll;
      this.state.pitch = tilt.pitch;
      this.state.stickHeld = tilt.held;
    };
    if (typeof window !== 'undefined' && window.addEventListener) {
      // Capture: before the cockpit's finger look (a bubbling listener on window) sees the same finger.
      window.addEventListener('pointerdown', this._onDragDown, { capture: true, passive: false });
      window.addEventListener('pointermove', this._onDragMove, { capture: true, passive: false });
      window.addEventListener('pointerup', this._onDragUp, true);
      window.addEventListener('pointercancel', this._onDragUp, true);
    }
  }

  /**
   * Can this element be pressed? Then it keeps its finger. Only the HUD's own
   * readouts over the picture (inside the HUD, not pressable) let a finger
   * through to the floating stick; anything outside the HUD (a menu, a dialog)
   * keeps it too.
   */
  pressable(t) {
    if (!t || !t.closest) return true;
    if (t.closest(TOUCH_KEEP)) return true;
    const hud = this.layer && this.layer.parentElement;
    if (!hud || !hud.contains(t)) return true;
    for (let n = t; n && n !== hud; n = n.parentElement) {
      try {
        if (getComputedStyle(n).cursor === 'pointer') return true;
      } catch (e) {
        return true;
      }
    }
    return false;
  }

  /** Is (x, y) on the minimap or the dock, drawn or not tappable? */
  overKept(x, y) {
    const hud = this.layer && this.layer.parentElement;
    const root = (hud && hud.parentElement) || (typeof document !== 'undefined' ? document : null);
    if (!root || !root.querySelectorAll) return false;
    for (const n of root.querySelectorAll('.minimap, .hud-buttons')) {
      if (!n.getClientRects || !n.getClientRects().length) continue;
      const b = n.getBoundingClientRect();
      if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return true;
    }
    return false;
  }

  endDrag() {
    this._drag = null;
    if (this.floatEl) {
      this.floatEl.hidden = true;
      this.floatEl.classList.remove('is-held');
    }
    if (this.flyMode === 'drag') {
      this.state.stickHeld = false;
      this.state.roll = 0;
      this.state.pitch = 0;
    }
  }

  /**
   * Change how the stick is flown. `opts`: sens (the mouse & touch
   * sensitivity), tiltSens, level ({ roll, pitch } or null). Returns the mode
   * it is really in (Tilt with no gyroscope comes back as 'drag', later).
   */
  setFlyMode(mode, opts = {}) {
    Object.assign(this.flyOpts, opts);
    const want = mode === 'drag' || mode === 'tilt' ? mode : 'stick';
    if (want !== this.flyMode) {
      // Leave nothing held from the way it was flown a moment ago.
      this.endDrag();
      this.state.stickHeld = false;
      this.state.roll = 0;
      this.state.pitch = 0;
      if (this.flyMode === 'tilt') this.stopTilt();
      this.flyMode = want;
    }
    this.layer.classList.toggle('fly-stick', want === 'stick');
    this.layer.classList.toggle('fly-drag', want === 'drag');
    this.layer.classList.toggle('fly-tilt', want === 'tilt');
    if (this.levelBtn) this.levelBtn.hidden = want !== 'tilt';
    if (want === 'tilt') this.startTilt();
    return this.flyMode;
  }

  /** Tilt on: ask for the motion permission where the browser wants a tap for it (iOS). */
  startTilt() {
    if (this._tiltOn) return;
    const DOE = typeof window !== 'undefined' ? window.DeviceOrientationEvent : undefined;
    if (!DOE) return this.tiltFails('No tilt sensor on this device — flying with Drag anywhere instead.');
    if (typeof DOE.requestPermission === 'function' && !this._tiltGranted) {
      // iOS: only from a tap. The LEVEL button asks for it until it is given.
      this._tiltNeedsAsk = true;
      if (this.levelBtn) this.levelBtn.textContent = 'TAP TO TILT';
      return;
    }
    this.listenTilt();
  }

  /** From a tap: the iOS motion permission. */
  askTilt() {
    const DOE = typeof window !== 'undefined' ? window.DeviceOrientationEvent : undefined;
    if (!DOE || typeof DOE.requestPermission !== 'function') return this.listenTilt();
    let p;
    try {
      p = DOE.requestPermission();
    } catch (e) {
      return this.tiltFails('Tilt needs the motion sensor — flying with Drag anywhere instead.');
    }
    Promise.resolve(p).then((r) => {
      if (r === 'granted') {
        this._tiltGranted = true;
        this._tiltNeedsAsk = false;
        if (this.levelBtn) this.levelBtn.textContent = 'LEVEL';
        this.listenTilt();
      } else this.tiltFails('Motion access was not allowed — flying with Drag anywhere instead.');
    }, () => this.tiltFails('Motion access was not allowed — flying with Drag anywhere instead.'));
  }

  listenTilt() {
    if (this._tiltOn || typeof window === 'undefined') return;
    this._tiltOn = true;
    this._tiltSeen = false;
    window.addEventListener('deviceorientation', this._onTilt);
    // Nothing from the sensor in two seconds (a laptop, a sensor switched off): Drag anywhere.
    clearTimeout(this._tiltWatch);
    this._tiltWatch = setTimeout(() => {
      if (this.flyMode === 'tilt' && !this._tiltSeen) this.tiltFails('No tilt sensor readings — flying with Drag anywhere instead.');
    }, 2000);
  }

  stopTilt() {
    clearTimeout(this._tiltWatch);
    if (this._tiltOn && typeof window !== 'undefined') window.removeEventListener('deviceorientation', this._onTilt);
    this._tiltOn = false;
    this._tiltNeedsAsk = false;
    if (this.levelBtn) this.levelBtn.textContent = 'LEVEL';
  }

  tiltFails(why) {
    this.stopTilt();
    this.tiltUnavailable = true;
    this.setFlyMode('drag');
    this.onNotice(why);
  }

  /** The way the phone is held now is straight and level. */
  levelTilt(quiet = false) {
    const t = this._tiltLast;
    if (!t) {
      if (!quiet) this.onNotice('Hold the phone the way you want to fly, then press LEVEL.');
      return null;
    }
    const h = holdAngles(t.beta, t.gamma, t.angle);
    this.flyOpts.level = { roll: Math.round(h.roll * 10) / 10, pitch: Math.round(h.pitch * 10) / 10 };
    this.onLevel(this.flyOpts.level);
    if (!quiet) this.onNotice('Tilt levelled — this is straight and level now.');
    return this.flyOpts.level;
  }

  /* ------------------------------------------------------------- stick -- */

  buildStick() {
    const stick = el('div', 'touch-stick');
    const knob = el('div', 'touch-knob');
    stick.appendChild(knob);
    this.layer.appendChild(stick);
    this.stick = stick;
    this.knob = knob;

    let id = null;
    const radius = () => stick.clientWidth / 2 - 12;

    const move = (e) => {
      const r = stick.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const R = radius();
      // Clamp to the circle so the knob cannot be dragged off the dial.
      const len = Math.hypot(dx, dy) || 1;
      const f = Math.min(1, len / R);
      const nx = (dx / len) * f;
      const ny = (dy / len) * f;
      knob.style.transform = `translate(${nx * R}px, ${ny * R}px)`;
      this.state.roll = nx;
      /*
       * A boat has no pitch axis, and a child will find the axis that does
       * nothing and push it for a minute before deciding the game is broken.
       * In boat mode the knob only moves sideways and the pitch value is
       * forced to zero, so nothing downstream can pick up a stale number.
       */
      if (this._boatMode) {
        knob.style.transform = `translate(${nx * R}px, 0px)`;
        this.state.pitch = 0;
      } else {
        // Drag down to climb.
        this.state.pitch = ny;
      }
    };

    stick.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      id = e.pointerId;
      stick.setPointerCapture(id);
      stick.classList.add('is-held');
      this.state.stickHeld = true;
      move(e);
      e.preventDefault();
    });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      move(e);
      e.preventDefault();
    });
    const release = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      stick.classList.remove('is-held');
      this.state.stickHeld = false;
      this.state.pitch = 0;
      this.state.roll = 0;
      knob.style.transform = '';
    };
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);
  }

  /* ---------------------------------------------------------- throttle -- */

  buildThrottle() {
    const t = el('div', 'touch-throttle');
    const fill = el('div', 'touch-throttle-fill');
    const label = el('div', 'touch-throttle-label', '0%');
    t.appendChild(fill);
    t.appendChild(el('div', 'touch-throttle-ticks'));
    t.appendChild(label);
    this.layer.appendChild(t);
    this.throttleEl = t;
    this.throttleFill = fill;
    this.throttleLabel = label;

    let id = null;
    const paint = (v) => {
      fill.style.height = `${v * 100}%`;
      label.textContent = `${Math.round(v * 100)}%`;
    };
    this.paintThrottle = paint;
    const set = (e) => {
      const r = t.getBoundingClientRect();
      // Top of the slider is full power.
      const v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
      this.state.throttle = v;
      paint(v);
    };
    t.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      t.setPointerCapture(id);
      this.state.dragging = true;
      set(e);
      e.preventDefault();
    });
    t.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      set(e);
      e.preventDefault();
    });
    const release = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      // Hand it back to the keyboard. The lever stays where it is on screen;
      // it just stops insisting on that value every frame.
      this.state.dragging = false;
      this.state.throttle = null;
    };
    t.addEventListener('pointerup', release);
    t.addEventListener('pointercancel', release);
  }

  /* ------------------------------------------------------------ rudder -- */

  buildRudder() {
    const r = el('div', 'touch-rudder');
    const mark = el('div', 'touch-rudder-mark');
    r.appendChild(mark);
    r.appendChild(el('div', 'touch-rudder-label', 'RUDDER'));
    this.layer.appendChild(r);

    let id = null;
    const set = (e) => {
      const b = r.getBoundingClientRect();
      const v = Math.max(-1, Math.min(1, ((e.clientX - b.left) / b.width - 0.5) * 2));
      this.state.yaw = v;
      mark.style.left = `${50 + v * 42}%`;
    };
    r.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      r.setPointerCapture(id);
      this.state.rudderHeld = true;
      set(e);
      e.preventDefault();
    });
    r.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      set(e);
      e.preventDefault();
    });
    const release = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      this.state.rudderHeld = false;
      this.state.yaw = 0;
      mark.style.left = '50%';
    };
    r.addEventListener('pointerup', release);
    r.addEventListener('pointercancel', release);
  }

  /* -------------------------------------------------------------- pads -- */

  buildPads() {
    const pads = el('div', 'touch-pads');
    this.layer.appendChild(pads);

    // Brakes are held, not toggled — exactly like the space bar.
    const brake = el('button', 'touch-pad', 'BRAKES');
    const down = (on) => {
      this.state.brakes = on;
      brake.classList.toggle('is-on', on);
    };
    brake.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      brake.setPointerCapture(e.pointerId);
      down(true);
    });
    brake.addEventListener('pointerup', () => down(false));
    brake.addEventListener('pointercancel', () => down(false));
    brake.addEventListener('pointerleave', () => down(false));
    pads.appendChild(brake);
    this.brakePad = brake;
    // Aeroplane-only pads (main.css hides them in the helicopter, whose skids
    // have no wheel brakes, nothing to retract and no flaps).
    brake.classList.add('is-wing');

    const tap = (label, action) => {
      const b = el('button', 'touch-pad', label);
      b.addEventListener('click', (e) => {
        e.preventDefault();
        b.blur();
        this.onAction(action);
      });
      pads.appendChild(b);
      return b;
    };
    /*
     * The starter, which had no on-screen control at all.
     *
     * The tutorial spawns with the engine off and its second step will not
     * pass until it is running. Starting it was bound to the I key and to
     * nothing else — no pad here, no case in hudAction — so on an iPad the
     * second instruction in the game was unreachable, and the objective sat
     * there repeating "Press I to start the engine" at a child holding a
     * device with no keys. The self-test never caught it because it presses
     * KeyI directly; the touch path had never been walked.
     *
     * First of the pads, because it is the first thing you do.
     */
    this.enginePad = tap('ENGINE', 'starter');
    this.gearPad = tap('GEAR', 'gear');
    this.flapPad = tap('FLAPS', 'flaps');
    this.gearPad.classList.add('is-wing');
    this.flapPad.classList.add('is-wing');
    /*
     * And the release, for the same reason: X was the only way to let go of a
     * crate or a bomb, so Mango Cay Delivery and Weapons Range were both
     * unfinishable on a touch device — each with a step that says "Press X to
     * release" and no X to press.
     *
     * Hidden until there is something aboard, so it is not a dead button on
     * every other flight.
     */
    this.dropPad = tap('DROP', 'drop');
    this.dropPad.hidden = true;
    tap(icon('camera', 18), 'camera');
    this.pads = pads;
  }

  /* ------------------------------------------------------------ sheets -- */

  /*
   * Everything else a thumb needs, in two sheets instead of twenty pads.
   *
   * The owner (2026-10-24): "update mobile controls so u can do pushback
   * etc". The pads above are the four things you reach for every minute;
   * the rest of the aeroplane — the ground crew and the tug, which way the
   * push swings, the parking brake, the autopilot, the trim wheel, looking
   * behind, the map, the mayday — had a key each and no button at all, so
   * on an iPad none of it existed. Two more pads open two sheets:
   *
   *   GROUND    on the ground, in an aeroplane: the crew (fuel, bags,
   *             catering, boarding come with them), PUSH BACK / STOP PUSH,
   *             which way the nose ends up, the parking brake.
   *   SYSTEMS   aeroplane and helicopter: autopilot, the helicopter's
   *             assist, trim (held, like the wheel), look behind (held), the
   *             mayday when one is on offer, the map, its range, the H card.
   *
   * A button presses the action's own key (main.js hudAction's default
   * branch), so Settings → Controls and the features' own rules apply
   * unchanged. Hold buttons hold the key down and let it go, and every hold
   * is released when the sheet closes or the layer hides: an invisible
   * finger on the trim wheel is how you end up in a loop.
   *
   * Where a sheet sits is measured, not guessed (placeSheet): in the gap
   * between the stick and the pads when there is one (a tablet, a phone on
   * its side), else across the screen above the pads (a phone held upright).
   * It never lands on a pad, the stick, the throttle or the rudder.
   * tests/features/touch-coverage.mjs lists every action's touch control.
   */
  buildSheets() {
    this.openSheet = null;
    this._holds = new Set();
    this.sheets = {};
    this.sheetPads = {};
    this.groundPad = this.sheetPad('GROUND', 'ground');
    // Aeroplane only: the helicopter has no tug and no stand (main.css hides .is-wing in the rotor).
    this.groundPad.classList.add('is-wing');
    this.groundPad.hidden = true;
    this.systemsPad = this.sheetPad('SYSTEMS', 'systems');

    const G = this.buildSheet('ground', 'Ground ops', 'The crew brings fuel, bags, catering and boarding, then the tug pushes you back.');
    this.crewBtn = this.sheetButton(G, 'CALL CREW', 'services', { wide: true });
    this.sheetLabel(G, 'Push back with the nose to the…');
    this.pushBtns = {
      noseLeft: this.sheetButton(G, '◀ LEFT', 'pushNoseLeft'),
      auto: this.sheetButton(G, 'RUNWAY (AUTO)', 'pushAuto'),
      noseRight: this.sheetButton(G, 'RIGHT ▶', 'pushNoseRight'),
    };
    this.parkBtn = this.sheetButton(G, 'PARKING BRAKE', 'parkingBrake', { wide: true });
    // The pilot's levers on the ground (features/pilot-systems.js): the
    // reversers (idle / MAX / stowed) and arming the ground spoilers.
    this.reverseBtn = this.sheetButton(G, 'REVERSERS', 'reversers');
    this.armBtn = this.sheetButton(G, 'SPOILERS: ARMED', 'spoilers');

    const Y = this.buildSheet('systems', 'Systems', '');
    this.apBtn = this.sheetButton(Y, 'AUTOPILOT', 'autopilot', { wide: true });
    this.assistBtn = this.sheetButton(Y, 'STABILITY ASSIST', 'heliAssist', { wide: true });
    this.assistBtn.hidden = true;
    this.sheetLabel(Y, 'Trim (hold)');
    this.sheetButton(Y, '▼ NOSE DOWN', 'trimDown', { hold: true });
    this.sheetButton(Y, 'NEUTRAL', 'trimReset');
    this.sheetButton(Y, 'NOSE UP ▲', 'trimUp', { hold: true });
    this.sheetButton(Y, 'LOOK BEHIND (hold)', 'lookBehind', { hold: true, wide: true });
    this.braceBtn = this.sheetButton(Y, 'MAYDAY — DECLARE AN EMERGENCY', 'brace', { wide: true });
    this.braceBtn.hidden = true;
    // The pilot's switches (features/pilot-systems.js): every lamp's preset,
    // the speedbrake lever (aeroplane only), the radio menu.
    this.lightsBtn = this.sheetButton(Y, 'LIGHTS: AUTO', 'lights');
    this.radioBtn = this.sheetButton(Y, 'RADIO (ATC)', 'atcRequest');
    this.speedbrakeBtn = this.sheetButton(Y, 'SPEEDBRAKE', 'spoilers', { wide: true });
    this.speedbrakeBtn.classList.add('is-wing');
    this.sheetButton(Y, 'MAP', 'minimap');
    this.sheetButton(Y, 'MAP RANGE', 'minimapRange');
    // The H card opens in the middle of the screen, under a sheet: the sheet steps away for it.
    this.sheetButton(Y, 'CONTROLS', 'help', { closes: true });

    this._onResize = () => {
      if (this.openSheet) this.placeSheet(this.sheets[this.openSheet]);
    };
  }

  /** A pad in the grid that opens a sheet (lit while it is open). */
  sheetPad(label, id) {
    const b = el('button', 'touch-pad is-sheet', label);
    b.type = 'button';
    b.dataset.sheet = id;
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', (e) => {
      e.preventDefault();
      b.blur();
      this.toggleSheet(id);
    });
    this.pads.appendChild(b);
    this.sheetPads[id] = b;
    return b;
  }

  buildSheet(id, title, note) {
    const s = el('div', 'touch-sheet');
    s.dataset.sheet = id;
    s.hidden = true;
    s.setAttribute('role', 'group');
    s.setAttribute('aria-label', title);
    const head = el('div', 'touch-sheet-head');
    head.appendChild(el('strong', null, title));
    const close = el('button', 'touch-sheet-close', icon('close', 18));
    close.type = 'button';
    close.setAttribute('aria-label', `Close ${title}`);
    close.addEventListener('click', (e) => {
      e.preventDefault();
      this.closeSheets();
    });
    head.appendChild(close);
    s.appendChild(head);
    if (note) s.appendChild(el('p', 'touch-sheet-note', note));
    const grid = el('div', 'touch-sheet-grid');
    s.appendChild(grid);
    s.grid = grid;
    this.layer.appendChild(s);
    this.sheets[id] = s;
    return s;
  }

  sheetLabel(sheet, text) {
    const l = el('div', 'touch-sheet-label', text);
    sheet.grid.appendChild(l);
    return l;
  }

  /**
   * A sheet button for `action`. A plain one presses it on click; a `hold`
   * one holds its key from finger down to finger up. `data-act` carries the
   * action id, which is what tests/features/touch-coverage.mjs reads.
   */
  sheetButton(sheet, label, action, { wide = false, hold = false, closes = false } = {}) {
    const b = el('button', `touch-sheet-btn${wide ? ' is-wide' : ''}${hold ? ' is-hold' : ''}`, label);
    b.type = 'button';
    b.dataset.act = action;
    if (hold) {
      let id = null;
      const set = (on) => {
        if (on === this._holds.has(action)) return;
        if (on) this._holds.add(action);
        else this._holds.delete(action);
        b.classList.toggle('is-held', on);
        this.onHold(action, on);
      };
      b.addEventListener('pointerdown', (e) => {
        if (id !== null || b.getAttribute('aria-disabled') === 'true') return;
        e.preventDefault();
        id = e.pointerId;
        try {
          b.setPointerCapture(id);
        } catch (err) {
          /* a synthetic pointer in a test has nothing to capture */
        }
        set(true);
      });
      const off = (e) => {
        if (id !== null && e && e.pointerId !== undefined && e.pointerId !== id) return;
        id = null;
        set(false);
      };
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('pointerleave', off);
      b.addEventListener('lostpointercapture', off);
      b._release = () => off(null);
    } else {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        b.blur();
        if (b.getAttribute('aria-disabled') === 'true') return;
        if (closes) this.closeSheets();
        this.onAction(action);
      });
    }
    sheet.grid.appendChild(b);
    return b;
  }

  toggleSheet(id) {
    if (this.openSheet === id) {
      this.closeSheets();
      return;
    }
    this.closeSheets();
    const s = this.sheets[id];
    if (!s) return;
    this.openSheet = id;
    s.hidden = false;
    const pad = this.sheetPads[id];
    if (pad) {
      pad.classList.add('is-on');
      pad.setAttribute('aria-expanded', 'true');
    }
    if (this.stateFn) this.syncSheets(this.stateFn());
    this.placeSheet(s);
    this._markOpen();
    window.addEventListener('resize', this._onResize);
  }

  /** Every sheet away, every held key let go. */
  closeSheets() {
    this.releaseHolds();
    if (!this.openSheet) return;
    const s = this.sheets[this.openSheet];
    if (s) s.hidden = true;
    const pad = this.sheetPads[this.openSheet];
    if (pad) {
      pad.classList.remove('is-on');
      pad.setAttribute('aria-expanded', 'false');
    }
    this.openSheet = null;
    this._markOpen();
    window.removeEventListener('resize', this._onResize);
  }

  releaseHolds() {
    if (!this._holds || !this._holds.size) return;
    for (const s of Object.values(this.sheets)) {
      for (const b of s.querySelectorAll('.touch-sheet-btn.is-hold')) if (b._release) b._release();
    }
    // Belt and braces: anything a button did not report, let go of here.
    for (const a of [...this._holds]) {
      this._holds.delete(a);
      this.onHold(a, false);
    }
  }

  /**
   * Where the sheet goes, measured against the controls that are actually
   * on screen right now. Beside: in the gap between the stick (or the wheel)
   * and the pads, when that gap is wide enough for a sheet worth having
   * (or a little narrower, when there is no room above), above the rudder.
   * Above: across the screen, over the top edge of every control (pads,
   * stick, throttle, eject), when it is not (a phone held upright). Its height stops under the
   * objective banner where it can; the banner is words, the pads are not.
   */
  placeSheet(s) {
    if (!s || s.hidden) return;
    const L = this.layer.getBoundingClientRect();
    if (L.width < 2 || L.height < 2) return;
    const box = (n) => {
      if (!n || n.hidden) return null;
      const r = n.getBoundingClientRect();
      return r.width > 1 && r.height > 1 ? r : null;
    };
    let stick = box(this.stick);
    // Drag anywhere / Tilt: no fixed stick, but the left thumb still works down there (a floating
    // ring, or LEVEL): keep the sheet off the same corner the stick would have had.
    if (!stick && this.flyMode && this.flyMode !== 'stick' && this.mode !== 'drive') {
      const lv = box(this.levelBtn);
      const size = Math.min(148, L.height * 0.4);
      stick = { left: L.left + 8, right: Math.max(L.left + 8 + size, lv ? lv.right : 0), top: Math.min(L.bottom - 8 - size, lv ? lv.top : Infinity), bottom: L.bottom - 8 };
    }
    const pads = box(this.pads);
    const rudder = box(this.layer.querySelector('.touch-rudder'));
    const lever = box(this.leverEl) || box(this.throttleEl);
    const pedals = box(this.layer.querySelector('.touch-pedals'));
    const wheel = box(this.layer.querySelector('.touch-wheel'));
    const leftEdge = Math.max(stick ? stick.right : 0, wheel ? wheel.right : 0);
    const rightEdge = Math.min(pads ? pads.left : L.right, lever ? lever.left : L.right, pedals ? pedals.left : L.right);
    const gap = rightEdge - leftEdge;
    /*
     * Under the objective banner when that leaves a sheet worth reading
     * (260 px); on a phone on its side it does not, and a sheet 150 px tall
     * that scrolls is worse than one over the banner's words for a moment.
     * Then it stops under the dock instead.
     */
    const topLimit = (bottom) => {
      const obj = this.layer.parentElement && this.layer.parentElement.querySelector(':scope > .hud-top');
      const r = obj ? obj.getBoundingClientRect() : null;
      const under = r && r.height > 1 ? r.bottom - L.top + 8 : 72;
      return L.height - bottom - under >= 260 ? under : 64;
    };
    /*
     * The eject column (features/eject/ui.js) is a fixed layer above the
     * whole HUD, on the left above the stick: a sheet under it had its MAP
     * button under EJECT on an upright phone. It is a control like the
     * others, so the sheet keeps off it rather than hiding it.
     */
    const eject = box(document.querySelector('.ej-col'));
    /*
     * Above: the sheet is the screen's whole width, so it has to clear the
     * top of every control, not just the pads (on a phone on its side the
     * stick and the throttle are taller than the pads in a helicopter).
     */
    const tops = [pads, rudder, stick, lever, pedals, wheel, eject].filter(Boolean).map((r) => r.top);
    const aboveBottom = tops.length ? L.bottom - Math.min(...tops) + 8 : 180;
    const aboveRoom = L.height - aboveBottom - 8;
    /*
     * Beside when the gap is wide; also when it is narrower but going above
     * leaves no room (a 667 x 375 or 640 x 360 phone on its side: the gap is
     * 254-281 px, and "above" put the sheet's head, close button and all,
     * 43-58 px off the top of the screen).
     */
    const beside = gap >= 300 || (gap >= 220 && aboveRoom < 260);
    let left, width, bottom;
    if (beside) {
      width = Math.min(520, gap - 16);
      left = leftEdge - L.left + 8 + Math.max(0, (gap - 16 - width) / 2);
      // Above the rudder, which is the lowest thing in the gap.
      bottom = rudder ? L.bottom - rudder.top + 10 : 80;
    } else {
      left = 8;
      width = L.width - 16;
      bottom = aboveBottom;
    }
    // Never taller than the screen above it: the head (and its close button) stays on screen.
    const room = Math.max(0, L.height - bottom - 8);
    const maxH = Math.min(room, Math.max(150, L.height - bottom - topLimit(bottom)));
    const put = (k, v) => {
      if (s.style[k] !== v) s.style[k] = v;
    };
    put('right', 'auto');
    put('left', `${Math.round(left)}px`);
    put('width', `${Math.round(width)}px`);
    put('bottom', `${Math.round(bottom)}px`);
    put('maxHeight', `${Math.round(maxH)}px`);
  }

  /** While a sheet is open the stand prompt ("tap here for the ground crew") steps aside: the sheet says the same with a bigger button. */
  _markOpen() {
    if (typeof document === 'undefined' || !document.documentElement) return;
    document.documentElement.classList.toggle('has-touch-sheet', !!this.openSheet);
  }

  /** The sheets' words and lights, from main.js touchState(). Writes on change only. */
  syncSheets(st) {
    if (!st) return;
    const text = (b, t) => {
      if (b && b.textContent !== t) b.textContent = t;
    };
    const lit = (b, on) => {
      if (b && b.classList.contains('is-on') !== !!on) b.classList.toggle('is-on', !!on);
    };
    const able = (b, on) => {
      if (!b) return;
      const want = on ? 'false' : 'true';
      if (b.getAttribute('aria-disabled') !== want) {
        b.setAttribute('aria-disabled', want);
        b.classList.toggle('is-off', !on);
      }
    };
    const CREW = {
      onStand: ['CALL THE GROUND CREW', true],
      calling: ['CREW ON THE WAY…', false],
      serviced: ['PUSH BACK', true],
      pushback: ['STOP THE PUSH', true],
      pushed: ['TUG IS CLEAR — TAXI OUT', false],
    };
    const c = CREW[st.crew] || ['STOP ON A STAND FOR THE CREW', false];
    text(this.crewBtn, c[0]);
    able(this.crewBtn, c[1]);
    lit(this.crewBtn, st.crew === 'pushback');
    for (const k in this.pushBtns) lit(this.pushBtns[k], (st.pushPref || 'auto') === k);
    text(this.parkBtn, st.parkingBrake ? 'PARKING BRAKE — ON (tap to release)' : 'PARKING BRAKE — OFF (tap to set)');
    lit(this.parkBtn, st.parkingBrake);
    lit(this.apBtn, st.autopilot);
    if (this.assistBtn.hidden !== !st.rotor) this.assistBtn.hidden = !st.rotor;
    lit(this.assistBtn, st.rotor && st.assist);
    if (this.braceBtn.hidden !== !st.brace) this.braceBtn.hidden = !st.brace;
    // The pilot's switches (features/pilot-systems.js touchState).
    if (this.lightsBtn) {
      text(this.lightsBtn, `LIGHTS: ${st.lights || 'AUTO'}`);
      lit(this.lightsBtn, st.lightsAuto === false);
    }
    if (this.radioBtn) lit(this.radioBtn, !!st.radioOpen);
    if (this.speedbrakeBtn) {
      const sb = st.speedbrake || 0;
      // Only on a type that has one (features/pilot-systems.js touchState: not the light aeroplanes).
      const wing = !st.rotor && st.hasSpoilers !== false;
      if (this.speedbrakeBtn.hidden !== !wing) this.speedbrakeBtn.hidden = !wing;
      text(this.speedbrakeBtn, sb >= 1 ? 'SPEEDBRAKE: FULL (tap: in)' : sb > 0 ? 'SPEEDBRAKE: ½ (tap: full)' : 'SPEEDBRAKE: IN (tap: ½)');
      lit(this.speedbrakeBtn, sb > 0);
    }
    if (this.reverseBtn) {
      const rv = st.reverse || 0;
      text(this.reverseBtn, rv >= 1 ? 'REVERSE: MAX (tap: stow)' : rv > 0 ? 'REVERSE: IDLE (tap: MAX)' : 'REVERSERS (tap: idle)');
      lit(this.reverseBtn, rv > 0);
      // A type without reversers (the light aeroplanes, the fighters) does not offer a dead button.
      const has = st.hasReversers !== false;
      if (this.reverseBtn.hidden !== !has) this.reverseBtn.hidden = !has;
    }
    if (this.armBtn) {
      const has = st.hasSpoilers !== false;
      if (this.armBtn.hidden !== !has) this.armBtn.hidden = !has;
      const up = (st.spoilerPos || 0) > 0.3;
      text(this.armBtn, up ? 'SPOILERS: UP' : st.spoilersArmed ? 'SPOILERS: ARMED (tap: disarm)' : 'SPOILERS: OFF (tap: arm)');
      lit(this.armBtn, up || !!st.spoilersArmed);
    }
  }

  /** Reflect the aeroplane's state back onto the pads. */
  update(ac, sim) {
    if (!ac) return;
    /*
     * The engine pad says what pressing it will do, the way GEAR already
     * reflects the undercarriage — "START" on a dead engine, "STOP" on a
     * running one. A button that does two opposite things without saying
     * which is worse than two buttons.
     */
    if (this.enginePad) {
      const running = !!ac.engineOn;
      const label = running ? 'STOP' : 'START';
      if (this.enginePad.textContent !== label) this.enginePad.textContent = label;
      this.enginePad.classList.toggle('is-on', running);
      /*
       * In a helicopter in the air the pad is greyed out. On a phone it sits
       * beside the camera pad, under the same thumb, and one tap on STOP at
       * 30 ft was "ENGINE OFF" and -18.7 m/s at the ground (measured, 390 x
       * 844, real touches): a rotor has no glide to fall back on and a
       * restart takes 1.8 s. The tap still lands — main.js pressStarter()
       * answers it with a word instead of a shutdown — so the look says what
       * the rule is. Written on a change only: this runs every frame.
       */
      const off = running && !ac.onGround && !!(this.input && this.input.context === 'heli');
      if (off !== this._enginePadOff) {
        this._enginePadOff = off;
        this.enginePad.classList.toggle('is-off', off);
        this.enginePad.setAttribute('aria-disabled', off ? 'true' : 'false');
      }
    }
    // Only offered when there is something to drop.
    if (this.dropPad) this.dropPad.hidden = !(sim && sim.hasCargo);
    /*
     * The sheets' pads. GROUND is an aeroplane-on-the-ground thing; SYSTEMS
     * is for anything that flies. Neither means anything in the van or the
     * boat (their own controls are in hud-drive.js and hud-boat.js), and a
     * sheet whose pad has just gone closes with it: a GROUND sheet left open
     * after take-off would be a stale page of ground-crew buttons.
     */
    if (this.groundPad) {
      const ctx = this.input ? this.input.context : 'plane';
      const vehicle = this.mode === 'drive' || !!this._boatMode;
      const ground = !vehicle && ctx === 'plane' && !!ac.onGround;
      if (this.groundPad.hidden === ground) this.groundPad.hidden = !ground;
      const systems = !vehicle && (ctx === 'plane' || ctx === 'heli');
      if (this.systemsPad.hidden === systems) this.systemsPad.hidden = !systems;
      if ((this.openSheet === 'ground' && !ground) || (this.openSheet === 'systems' && !systems)) this.closeSheets();
      if (this.openSheet && this.stateFn) {
        // A few times a second is plenty for words on a sheet.
        this._sheetTick = (this._sheetTick || 0) + 1;
        if (this._sheetTick % 8 === 0) {
          this.syncSheets(this.stateFn());
          // What it has to keep clear of changes in flight (the eject column, the pads): writes only on change.
          this.placeSheet(this.sheets[this.openSheet]);
        }
      }
    }
    if (this.gearPad) this.gearPad.classList.toggle('is-on', ac.gearDown);
    if (this.flapPad) {
      const step = ac.flapStep || 0;
      this.flapPad.textContent = step ? `FLAPS ${step}` : 'FLAPS';
      this.flapPad.classList.toggle('is-on', step > 0);
    }
    /*
     * The lever shows the real throttle whenever a finger is not on it.
     *
     * Only the picture is updated — writing it back into state.throttle is
     * what created the deadlock, because that value is then forced onto the
     * game next frame. The keyboard, the gamepad and the autopilot can all
     * move the throttle now, and the lever follows them.
     */
    if (this.input && !this.state.dragging && this.paintThrottle) {
      const v = this.input.throttleTarget;
      if (Math.abs(v - this._shown) > 0.005) {
        this._shown = v;
        this.paintThrottle(v);
      }
    }
  }

  /* --------------------------------------------------------- boat mode -- */

  /**
   * Turn the aeroplane controls into boat controls.
   *
   * Two things are wrong with the plane's layer in a boat and both of them
   * are the kind of thing twenty-nine ten-year-olds find in the first minute:
   *
   * 1. The stick is two axes and one of them does nothing. A boat has no
   *    pitch control. A child will find the axis that does nothing and push
   *    it for a minute before deciding the game is broken. So the dial
   *    collapses to a horizontal wheel: same element, same finger, one axis,
   *    and the pitch value is forced to zero so nothing downstream can pick
   *    up a stale number.
   * 2. The throttle is a continuous slider reading a percentage, which is the
   *    aeroplane idea of power. A boat is driven with a handle that has named
   *    positions, and on a touchscreen named positions are far better than a
   *    slider anyway: you can hit ASTERN with a thumb without looking, and
   *    you cannot do that with a percentage.
   *
   * Reversible, because the same layer flies the aeroplane five seconds later.
   */
  setBoatMode(on) {
    const want = !!on;
    if (want === this._boatMode) return;
    this._boatMode = want;
    this.layer.classList.toggle('is-boat', want);
    if (this.stick) this.stick.classList.toggle('is-wheel', want);
    if (!this.leverEl) this.buildLever();
    this.leverEl.hidden = !want;
    if (this.throttleEl) this.throttleEl.hidden = want;
    // Pads that mean nothing on a boat. The brake pad stays but changes what
    // it says, because on a boat the emergency is the same gesture with a
    // different name.
    for (const p of [this.gearPad, this.flapPad, this.enginePad, this.groundPad, this.systemsPad]) if (p) p.hidden = want;
    if (want) this.closeSheets();
    // main.js calls this straight after setMode('drive') (driving.js), so the
    // van's 'HAND' has to survive it, or the van's pad read BRAKES.
    if (this.brakePad) this.brakePad.textContent = want ? 'CRASH STOP' : this.mode === 'drive' ? 'HAND' : 'BRAKES';
    // Leaving a stale axis behind is how a boat ends up in a permanent turn.
    this.state.pitch = 0;
    this.state.lever = want ? this.state.lever ?? 1 : null;
  }

  /**
   * The engine lever: five stacked detents, FULL at the top where a real one
   * is. 46 px each, which clears the 44 px that a ten-year-old's thumb on a
   * moving boat actually needs — the slider it replaces was 62 px wide and
   * asked for precision within about four pixels.
   */
  buildLever() {
    const wrap = el('div', 'touch-lever');
    this.leverEl = wrap;
    this.leverButtons = [];
    // Top of the panel is ahead, bottom is astern, which is which way the
    // handle moves on the real thing.
    const rows = [
      { i: 4, label: 'FULL' },
      { i: 3, label: 'HALF' },
      { i: 2, label: 'SLOW' },
      { i: 1, label: 'STOP' },
      { i: 0, label: 'ASTERN' },
    ];
    for (const row of rows) {
      const b = el('button', 'touch-detent', row.label);
      b.dataset.i = String(row.i);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.setLever(row.i);
      });
      wrap.appendChild(b);
      this.leverButtons[row.i] = b;
    }
    wrap.hidden = true;
    this.layer.appendChild(wrap);
    this.setLever(this.state.lever ?? 1);
  }

  setLever(i) {
    this.state.lever = i;
    for (let k = 0; k < this.leverButtons.length; k++) {
      const b = this.leverButtons[k];
      if (b) b.classList.toggle('is-on', k === i);
    }
  }

  /**
   * Follow the boat's own lever, so the keyboard and the crash-stop pad move
   * the picture too. Read-only in that direction — writing back into
   * state.lever is what deadlocked the throttle slider when it was first
   * written, and the comment explaining that is still on buildThrottle.
   */
  updateBoat(vehicle) {
    if (!this._boatMode || !vehicle || !this.leverButtons) return;
    if (vehicle.lever !== this.state.lever) {
      this.state.lever = vehicle.lever;
      for (let k = 0; k < this.leverButtons.length; k++) {
        const b = this.leverButtons[k];
        if (b) b.classList.toggle('is-on', k === vehicle.lever);
      }
    }
  }

  setVisible(on) {
    if (!on) this.closeSheets();
    this._visible = !!on;
    // A finger flying the floating stick when the menu comes up lets go.
    if (!on) this.endDrag();
    if (!on && this.flyMode === 'tilt') {
      this.state.stickHeld = false;
      this.state.roll = 0;
      this.state.pitch = 0;
    }
    this.layer.style.display = on ? '' : 'none';
  }
}
