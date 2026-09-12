/**
 * Input: keyboard (fully remappable), optional mouse flying and gamepad.
 *
 * Raw key presses are turned into smoothly moving control surfaces — real
 * controls do not snap to full deflection — and the springs recentre faster in
 * simplified mode so the aeroplane always settles down when you let go.
 */

import { clamp, lerp } from '../core/noise.js';

export const ACTIONS = {
  pitchDown: { label: 'Pitch down (nose down)', group: 'Flying', default: ['KeyW'] },
  pitchUp: { label: 'Pitch up (nose up)', group: 'Flying', default: ['KeyS'] },
  rollLeft: { label: 'Roll left', group: 'Flying', default: ['KeyA'] },
  rollRight: { label: 'Roll right', group: 'Flying', default: ['KeyD'] },
  yawLeft: { label: 'Rudder left', group: 'Flying', default: ['KeyQ'] },
  yawRight: { label: 'Rudder right', group: 'Flying', default: ['KeyE'] },
  // Arrow keys are bound alongside Shift/Ctrl because "how do I slow down?" is
  // the first question every new pilot asks, and Ctrl is easy to miss.
  throttleUp: { label: 'More power', group: 'Engine', default: ['ShiftLeft', 'ShiftRight', 'ArrowUp'] },
  throttleDown: { label: 'Less power (slow down)', group: 'Engine', default: ['ControlLeft', 'ControlRight', 'ArrowDown'] },
  starter: { label: 'Start / stop engine', group: 'Engine', default: ['KeyI'] },
  brakes: { label: 'Wheel brakes', group: 'Ground', default: ['Space'] },
  gear: { label: 'Landing gear up / down', group: 'Ground', default: ['KeyG'] },
  flapsDown: { label: 'Flaps down', group: 'Ground', default: ['KeyF'] },
  flapsUp: { label: 'Flaps up', group: 'Ground', default: ['KeyV'] },
  camera: { label: 'Change camera view', group: 'View', default: ['KeyC'] },
  lookBehind: { label: 'Look behind (hold)', group: 'View', default: ['KeyB'] },
  // L, because it is nowhere near the flight controls. Pressing it by
  // accident would shut the engine off, so it asks twice — see main.js.
  brace: { label: 'Declare an emergency (press twice)', group: 'Missions', default: ['KeyL'] },
  emergencyLand: { label: 'Emergency: attempt to land', group: 'Missions', default: ['Digit1'] },
  emergencyCircle: { label: 'Emergency: circle the airport', group: 'Missions', default: ['Digit2'] },
  drop: { label: 'Release cargo', group: 'Missions', default: ['KeyX'] },
  pause: { label: 'Pause / menu', group: 'Game', default: ['Escape'] },
  help: { label: 'Show controls', group: 'Game', default: ['KeyH'] },
  hideUi: { label: 'Hide / show the whole interface', group: 'View', default: ['KeyU'] },
  guide: { label: 'Guidance lines to the target', group: 'View', default: ['KeyN'] },
  autopilot: { label: 'Autopilot on / off', group: 'Engine', default: ['KeyP'] },
  // Free look. These share the arrow keys with the throttle: whichever one is
  // listening depends on whether free look is switched on, and the throttle
  // always has Shift and Ctrl regardless.
  lookUp: { label: 'Look up (free look on)', group: 'View', default: ['ArrowUp'] },
  lookDown: { label: 'Look down (free look on)', group: 'View', default: ['ArrowDown'] },
  lookLeft: { label: 'Look left (free look on)', group: 'View', default: ['ArrowLeft'] },
  lookRight: { label: 'Look right (free look on)', group: 'View', default: ['ArrowRight'] },
  mute: { label: 'Mute sound', group: 'Game', default: ['KeyM'] },
  // M was already the mute key, so the map gets J — next to the other
  // view keys and free on every layout that matters.
  minimap: { label: 'Show the map', group: 'Game', default: ['KeyJ'] },
  minimapRange: { label: 'Map range', group: 'Game', default: ['KeyK'] },
  /*
   * Trim. Comma and full stop, because they sit side by side like the wheel
   * they represent and because every other sensible key was already taken.
   * Held down they wind continuously, which is how a trim wheel works.
   */
  trimDown: { label: 'Trim nose down', group: 'Flying', default: ['Comma'] },
  trimUp: { label: 'Trim nose up', group: 'Flying', default: ['Period'] },
  trimReset: { label: 'Trim back to neutral', group: 'Flying', default: ['Slash'] },
};

const STORAGE_KEY = 'islandsim.bindings.v1';

export function defaultBindings() {
  const out = {};
  for (const k in ACTIONS) out[k] = [...ACTIONS[k].default];
  return out;
}

export function keyLabel(code) {
  if (!code) return '—';
  return code
    .replace('Key', '')
    .replace('Digit', '')
    .replace('Arrow', '')
    .replace('Left', ' L')
    .replace('Right', ' R')
    .replace('Shift', 'Shift')
    .replace('Control', 'Ctrl')
    .replace('Space', 'Space')
    .replace('Escape', 'Esc');
}

export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.bindings = defaultBindings();
    this.load();

    this.keys = new Set();
    this.pressedThisFrame = new Set();
    this.mouseEnabled = false;
    this.gamepadEnabled = true;
    this.sensitivity = 1;
    this.invertMouse = false;

    this.mouse = { x: 0, y: 0, active: false, locked: false };
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.rightDown = false;
    /**
     * Free look: move your head around the cockpit with the mouse or the
     * arrow keys, without holding anything down. Off by default because it
     * takes the arrow keys away from the throttle; toggled from the pause
     * menu or Settings.
     */
    this.freeLook = false;
    /** Seconds since you last moved your head, used to ease it back forward. */
    this._lookIdle = 0;

    // Smoothed control outputs.
    this.out = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 0, trim: 0 };
    /** Manual trim, -1 (nose down) to +1 (nose up). Does not spring back. */
    this.trimInput = 0;
    this.throttleTarget = 0;
    /**
     * Set by the on-screen controls on a touch device. Left null when there is
     * no touch layer, so a keyboard flight never pays for this.
     */
    this.touch = null;

    this._onKeyDown = (e) => {
      // Let the browser handle typing, but only for things you actually type
      // into. This used to bail on any INPUT or SELECT, which meant that after
      // touching a slider or a dropdown in Settings the focus stayed on it and
      // *every* game key stopped working — including the one that brings the
      // interface back. A range slider is not a text field.
      const el = e.target;
      if (el) {
        const tag = el.tagName;
        const typing =
          tag === 'TEXTAREA' ||
          el.isContentEditable ||
          (tag === 'INPUT' && !/^(range|checkbox|radio|button|submit|color)$/i.test(el.type || 'text'));
        if (typing) return;
      }
      if (e.code === 'Tab') return;
      if (this.captureNext) {
        e.preventDefault();
        const cb = this.captureNext;
        this.captureNext = null;
        cb(e.code);
        return;
      }
      if (!this.keys.has(e.code)) this.pressedThisFrame.add(e.code);
      this.keys.add(e.code);
      // Stop the page scrolling / browser shortcuts for game keys.
      if (this.isGameKey(e.code)) e.preventDefault();
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
    };
    this._onBlur = () => this.keys.clear();

    this._onMouseMove = (e) => {
      if (!this.mouseEnabled && !this.rightDown && !this.freeLook) return;
      const dx = e.movementX || 0;
      const dy = e.movementY || 0;
      // Holding the right button looks around — but only when free look is
      // actually on. It used to work regardless, so with the setting off a
      // right-drag still swung your head, which is precisely the "free look is
      // on even though it should be off" complaint.
      if ((this.freeLook && (this.rightDown || !this.mouse.locked))) {
        this.lookYaw = clamp(this.lookYaw - dx * 0.0035, -2.4, 2.4);
        this.lookPitch = clamp(this.lookPitch - dy * 0.0035, -1.0, 0.75);
        this._lookIdle = 0;
        return;
      }
      const s = 0.0022 * this.sensitivity;
      this.mouse.x = clamp(this.mouse.x + dx * s, -1, 1);
      this.mouse.y = clamp(this.mouse.y + dy * s * (this.invertMouse ? -1 : 1), -1, 1);
      this.mouse.active = true;
    };
    this._onMouseDown = (e) => {
      if (e.button === 2) this.rightDown = true;
    };
    this._onMouseUp = (e) => {
      if (e.button === 2) this.rightDown = false;
    };
    this._onContext = (e) => e.preventDefault();

    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    this.dom.addEventListener('contextmenu', this._onContext);
  }

  isGameKey(code) {
    for (const a in this.bindings) if (this.bindings[a].includes(code)) return true;
    return false;
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        for (const k in this.bindings) if (parsed[k]) this.bindings[k] = parsed[k];
      }
    } catch (e) {
      /* first run, or storage blocked — defaults are fine */
    }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings));
    } catch (e) {
      /* ignore */
    }
  }

  resetBindings() {
    this.bindings = defaultBindings();
    this.save();
  }

  /** Ask the next key press to be assigned to an action. */
  capture(action, done) {
    this.captureNext = (code) => {
      // Remove that key from any other action so bindings stay unique.
      for (const a in this.bindings) {
        this.bindings[a] = this.bindings[a].filter((c) => c !== code);
      }
      this.bindings[action] = [code];
      this.save();
      done(code);
    };
  }

  cancelCapture() {
    this.captureNext = null;
  }

  held(action) {
    const codes = this.bindings[action];
    if (!codes) return false;
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  pressed(action) {
    const codes = this.bindings[action];
    if (!codes) return false;
    for (const c of codes) if (this.pressedThisFrame.has(c)) return true;
    return false;
  }

  requestMouseFlying(on) {
    this.mouseEnabled = on;
    if (on && this.dom.requestPointerLock) {
      this.dom.requestPointerLock();
    } else if (!on && document.exitPointerLock && document.pointerLockElement) {
      document.exitPointerLock();
    }
    this.mouse.x = 0;
    this.mouse.y = 0;
  }

  gamepad() {
    if (!this.gamepadEnabled || !navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /**
   * Produce control values for this frame.
   * `simple` gives stronger self-centring, which suits younger pilots.
   */
  update(dt, { simple = true } = {}) {
    const rate = simple ? 3.1 : 2.3; // how fast the controls move
    const center = simple ? 4.4 : 2.4; // how fast they spring back

    /*
     * Trim, wound by hand.
     *
     * Unlike every other control this one does NOT spring back — that is the
     * entire point of it. You set it and the aeroplane holds the attitude
     * without you holding the stick, which is what makes long flights and
     * precise approaches possible. It winds while the key is held, at a rate
     * chosen so a full sweep takes about four seconds: fast enough not to be
     * tedious, slow enough to stop on the value you wanted.
     */
    if (this.held('trimReset')) this.trimInput = 0;
    else {
      const tRate = 0.5;
      if (this.held('trimUp')) this.trimInput = clamp((this.trimInput || 0) + tRate * dt, -1, 1);
      if (this.held('trimDown')) this.trimInput = clamp((this.trimInput || 0) - tRate * dt, -1, 1);
    }
    this.out.trim = this.trimInput || 0;

    let pitchIn = 0;
    let rollIn = 0;
    let yawIn = 0;

    if (this.held('pitchUp')) pitchIn += 1;
    if (this.held('pitchDown')) pitchIn -= 1;
    if (this.held('rollRight')) rollIn += 1;
    if (this.held('rollLeft')) rollIn -= 1;
    if (this.held('yawRight')) yawIn += 1;
    if (this.held('yawLeft')) yawIn -= 1;

    // ---- Free look -------------------------------------------------------
    // Arrow keys swing your head around the cockpit. They only do this while
    // free look is on; otherwise they stay on the throttle, where beginners
    // find them.
    if (this.freeLook) {
      const lookRate = 1.5 * dt;
      let moved = false;
      if (this.held('lookLeft')) { this.lookYaw += lookRate; moved = true; }
      if (this.held('lookRight')) { this.lookYaw -= lookRate; moved = true; }
      if (this.held('lookUp')) { this.lookPitch += lookRate; moved = true; }
      if (this.held('lookDown')) { this.lookPitch -= lookRate; moved = true; }
      this.lookYaw = clamp(this.lookYaw, -2.4, 2.4);
      this.lookPitch = clamp(this.lookPitch, -1.0, 0.75);
      this._lookIdle = moved ? 0 : this._lookIdle + dt;
      // Ease the head back to straight ahead once you stop looking around, so
      // you never end up flying an approach staring at the side window.
      if (this._lookIdle > 1.6) {
        const back = clamp((this._lookIdle - 1.6) * dt * 1.6, 0, 1);
        this.lookYaw = lerp(this.lookYaw, 0, back);
        this.lookPitch = lerp(this.lookPitch, 0, back);
      }
    } else {
      /*
       * Free look is off, so the head always comes back to straight ahead.
       *
       * This used to be skipped while the right button was held, and nothing
       * re-centred when the setting was switched off — so turning free look
       * off while your head was turned left you stuck staring at the side
       * window with no way back short of restarting. Off means off.
       */
      this.lookYaw = lerp(this.lookYaw, 0, clamp(dt * 3, 0, 1));
      this.lookPitch = lerp(this.lookPitch, 0, clamp(dt * 3, 0, 1));
      if (Math.abs(this.lookYaw) < 0.002) this.lookYaw = 0;
      if (Math.abs(this.lookPitch) < 0.002) this.lookPitch = 0;
    }

    // On-screen controls. They add to the keyboard rather than replacing it,
    // so a tablet with a keyboard attached can use either at any moment.
    if (this.touch) {
      if (this.touch.stickHeld) {
        rollIn = clamp(rollIn + this.touch.roll, -1, 1);
        pitchIn = clamp(pitchIn + this.touch.pitch, -1, 1);
      }
      if (this.touch.rudderHeld) yawIn = clamp(yawIn + this.touch.yaw, -1, 1);
    }

    // Mouse flying overrides the keyboard when it is moving.
    if (this.mouseEnabled) {
      // The virtual stick slowly recentres so you can let go.
      this.mouse.x = lerp(this.mouse.x, 0, clamp(dt * 0.8, 0, 1));
      this.mouse.y = lerp(this.mouse.y, 0, clamp(dt * 0.8, 0, 1));
      rollIn = clamp(rollIn + this.mouse.x * 1.6, -1, 1);
      pitchIn = clamp(pitchIn - this.mouse.y * 1.6, -1, 1);
    }

    const pad = this.gamepad();
    let padThrottle = null;
    if (pad) {
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
      rollIn = clamp(rollIn + dz(pad.axes[0] || 0), -1, 1);
      pitchIn = clamp(pitchIn - dz(pad.axes[1] || 0), -1, 1);
      yawIn = clamp(yawIn + dz(pad.axes[2] || 0), -1, 1);
      // Triggers as throttle (standard mapping puts them on buttons 6/7).
      const rt = pad.buttons[7] ? pad.buttons[7].value : 0;
      const lt = pad.buttons[6] ? pad.buttons[6].value : 0;
      if (rt > 0.02 || lt > 0.02) padThrottle = clamp(this.throttleTarget + (rt - lt) * dt * 1.2, 0, 1);
      this.padButtons = this.padButtons || {};
      const edge = (i) => {
        const now = pad.buttons[i] && pad.buttons[i].pressed;
        const was = this.padButtons[i];
        this.padButtons[i] = now;
        return now && !was;
      };
      this.padEdges = {
        gear: edge(0),
        camera: edge(3),
        brakes: pad.buttons[1] && pad.buttons[1].pressed,
        pause: edge(9),
        drop: edge(2),
      };
    } else {
      this.padEdges = null;
    }

    // Move the smoothed controls toward the input.
    for (const [key, target] of [['pitch', pitchIn], ['roll', rollIn], ['yaw', yawIn]]) {
      const cur = this.out[key];
      if (Math.abs(target) > 0.01) {
        this.out[key] = clamp(cur + Math.sign(target) * rate * dt * (0.4 + Math.abs(target)), -1, 1);
        // Do not overshoot a partial analogue input.
        if (Math.abs(this.out[key]) > Math.abs(target) && Math.abs(target) < 0.98) this.out[key] = target;
      } else {
        this.out[key] = Math.abs(cur) < 0.02 ? 0 : cur - Math.sign(cur) * Math.min(Math.abs(cur), center * dt);
      }
    }

    // Throttle: held keys ramp it, gamepad triggers set it.
    if (padThrottle !== null) this.throttleTarget = padThrottle;
    if (this.touch && this.touch.throttle !== null && this.touch.throttle !== undefined) {
      this.throttleTarget = this.touch.throttle;
    }
    // The arrow keys belong to the throttle until free look claims them, so
    // check the modifier keys separately from the shared arrows.
    const throttleKey = (action, arrows) => {
      const codes = this.bindings[action] || [];
      for (const c of codes) {
        if (!arrows && (c === 'ArrowUp' || c === 'ArrowDown')) continue;
        if (this.keys.has(c)) return true;
      }
      return false;
    };
    const arrowsFree = !this.freeLook;
    if (throttleKey('throttleUp', arrowsFree)) this.throttleTarget = clamp(this.throttleTarget + dt * 0.62, 0, 1);
    if (throttleKey('throttleDown', arrowsFree)) this.throttleTarget = clamp(this.throttleTarget - dt * 0.62, 0, 1);
    this.out.throttle = lerp(this.out.throttle, this.throttleTarget, clamp(dt * 6, 0, 1));

    const braking =
      this.held('brakes') ||
      (this.padEdges && this.padEdges.brakes) ||
      !!(this.touch && this.touch.brakes);
    this.out.brakes = lerp(this.out.brakes, braking ? 1 : 0, clamp(dt * 9, 0, 1));

    return this.out;
  }

  endFrame() {
    this.pressedThisFrame.clear();
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    this.dom.removeEventListener('contextmenu', this._onContext);
  }
}
