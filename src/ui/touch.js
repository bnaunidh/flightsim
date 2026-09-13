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

export class TouchControls {
  constructor(host, { input, onAction } = {}) {
    this.input = input;
    this.onAction = onAction || (() => {});
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
    host.appendChild(this.layer);
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
      // Drag down to climb.
      this.state.pitch = ny;
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
    }
    // Only offered when there is something to drop.
    if (this.dropPad) this.dropPad.hidden = !(sim && sim.hasCargo);
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

  setVisible(on) {
    this.layer.style.display = on ? '' : 'none';
  }
}
