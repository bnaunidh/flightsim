/**
 * Everything about driving that is not the physics: the pedals, the camera and
 * the touch layout.
 *
 * It is a separate file on purpose. `input.js` belongs to the aeroplane, and
 * the aeroplane's controls are wrong for a car in three specific ways:
 *
 *   1. THE THROTTLE IS A LEVER. Hold Shift and it winds up at 0.62 per second
 *      and then STAYS there. That is exactly right for an engine you set and
 *      leave, and exactly wrong for a van: you press the pedal, you lift, it
 *      slows down. Under the old code the van had no idea you had let go.
 *   2. IT WAS DOUBLED AND CLIPPED. `updateDrive` passed `ctrl.throttle * 2`
 *      into a value the vehicle clamps to 1, so the top half of the lever did
 *      nothing at all and the bottom half was twice as sensitive as it looked.
 *   3. STEERING CAME OFF THE AILERON SPRING, which recentres at a fixed rate
 *      whatever the speed. A car needs the wheel to get heavier as it goes
 *      faster or it is undriveable above about sixty.
 *
 * So driving gets its own pedals, built from the SAME key bindings — no new
 * actions, nothing for anyone to re-learn or re-bind:
 *
 *   Shift / Up      accelerator
 *   Ctrl  / Down    brake, and reverse once you are stopped
 *   A / D           steer
 *   Space           handbrake
 *   C               change view
 *
 * None of this touches input.js or touch.js. The touch widgets write into the
 * same shared `input.touch` object the flight layer already owns, under three
 * new field names nothing else reads.
 */

import * as THREE from '../vendor/three.module.js';
import { heightAt } from '../world/terrain.js';
import { clamp, lerp } from '../core/noise.js';

/* ========================================================== the pedals == */

export class DriveInput {
  /** @param {object} input the game's Input instance */
  constructor(input) {
    this.input = input;
    this.throttle = 0;
    this.brake = 0;
    this.steer = 0;
    this.handbrake = false;
    /**
     * True once the brake has brought you to a stop while still held. That is
     * what puts it in reverse, and it latches so that easing off the brake at
     * walking pace does not throw the van forward again.
     */
    this.reversing = false;
  }

  /**
   * @param {number} dt
   * @param {number} speed signed, m/s — needed to know when to select reverse
   * @returns {{throttle:number, brake:number, steer:number, handbrake:boolean}}
   */
  update(dt, speed) {
    const I = this.input;
    const touch = I.touch || null;
    const pad = I.gamepad ? I.gamepad() : null;

    /* ---- accelerator and brake, as pedals ------------------------------ */

    let go = I.held('throttleUp') ? 1 : 0;
    let stop = I.held('throttleDown') ? 1 : 0;
    if (touch) {
      if (touch.driveGo) go = Math.max(go, touch.driveGo);
      if (touch.driveStop) stop = Math.max(stop, touch.driveStop);
    }
    if (pad) {
      const rt = pad.buttons[7] ? pad.buttons[7].value : 0;
      const lt = pad.buttons[6] ? pad.buttons[6].value : 0;
      if (rt > 0.04) go = Math.max(go, rt);
      if (lt > 0.04) stop = Math.max(stop, lt);
    }

    /*
     * Both pedals at once: the brake wins.
     *
     * A ten-year-old holds every key. With Shift and Ctrl both down, both
     * pedals ramped to full and stayed there — the van fought itself, and the
     * reverse latch could never engage because it is cleared on any throttle
     * at all, so holding both was a van that would not go and would not back
     * out either. Every car ever built does it this way: the brake overrides
     * the accelerator, and the child feels the thing they expect, which is
     * that the brake works.
     */
    if (stop > 0.02 && go > 0.02) go = 0;

    /*
     * Pedals move fast but not instantly. 0.18 s to the floor means a tap is a
     * tap and a stab of brake is a stab of brake, while still being smooth
     * enough that the engine note and the body pitch do not snap.
     */
    const rate = dt / 0.18;
    this.throttle = go > this.throttle ? Math.min(go, this.throttle + rate) : Math.max(go, this.throttle - rate * 1.6);
    this.brake = stop > this.brake ? Math.min(stop, this.brake + rate) : Math.max(stop, this.brake - rate * 1.6);

    /*
     * Reverse, which the old car simply did not have — you could nose into a
     * fence and the only way out was the Escape key.
     *
     * The rule is the one every arcade racer uses and every ten-year-old
     * already knows: brake until you stop, keep holding, and you back up.
     */
    if (this.brake > 0.1 && speed <= 0.35) this.reversing = true;
    if (this.throttle > 0.05 || this.brake < 0.05) this.reversing = false;

    let throttleOut = this.throttle;
    let brakeOut = this.brake;
    if (this.reversing) {
      throttleOut = -this.brake;
      brakeOut = 0;
    }

    /* ---- steering ------------------------------------------------------ */

    let want = 0;
    if (I.held('rollRight')) want += 1;
    if (I.held('rollLeft')) want -= 1;
    if (touch && typeof touch.driveSteer === 'number' && touch.driveSteer !== 0) {
      want = clamp(want + touch.driveSteer, -1, 1);
    }
    if (pad) {
      const ax = pad.axes[0] || 0;
      if (Math.abs(ax) > 0.12) want = clamp(want + ax, -1, 1);
    }

    /*
     * The wheel gets heavier with speed.
     *
     * On the keyboard the only steering input available is "all of it", so the
     * rate at which the wheel winds on is the *entire* difference between a
     * van and a shopping trolley. At a walk it takes a quarter of a second to
     * full lock; at a hundred it takes nearly half, which is what stops a
     * child flicking it straight into the scenery at speed. The vehicle's grip
     * limit then decides how much of that lock it can actually use.
     */
    const frac = clamp(Math.abs(speed) / 29, 0, 1);
    const on = dt / lerp(0.24, 0.44, frac);
    const back = dt / 0.16;
    if (Math.abs(want) > 0.02) {
      this.steer = want > this.steer ? Math.min(want, this.steer + on) : Math.max(want, this.steer - on);
    } else {
      this.steer = this.steer > 0 ? Math.max(0, this.steer - back) : Math.min(0, this.steer + back);
    }

    this.handbrake =
      I.held('brakes') ||
      !!(touch && touch.brakes) ||
      !!(pad && pad.buttons[0] && pad.buttons[0].pressed);

    return {
      throttle: throttleOut,
      brake: brakeOut,
      steer: this.steer,
      handbrake: this.handbrake,
    };
  }
}

/* ========================================================== the camera == */

export const DRIVE_VIEWS = ['chase', 'bonnet', 'far'];
export const DRIVE_VIEW_LABELS = { chase: 'Chase', bonnet: 'Bonnet', far: 'Wide' };

/**
 * The driving camera.
 *
 * What was here before was a security camera on a pole: a fixed 11 m back and
 * 4.5 m up, always pointed at the van itself. It is fine at a standstill and
 * useless at seventy, because you are looking at the roof of the thing you are
 * driving instead of at the road you are about to be on.
 *
 * Three things fix that, and all three are cheap:
 *
 *   THE LOOK POINT MOVES AHEAD WITH SPEED. Six metres in front of the van when
 *   crawling, twenty-six at top speed, and measured along the direction of
 *   TRAVEL rather than the nose — so when the van is sliding wide the camera
 *   shows you the ditch you are sliding towards.
 *
 *   THE CAMERA LAGS THE TURN. It swings to the new heading over about a third
 *   of a second instead of being welded behind the van. That lag is what makes
 *   a corner feel like a corner; without it the world simply rotates.
 *
 *   THE FIELD OF VIEW OPENS UP. 64 degrees parked, 80 flat out. It is the
 *   oldest trick in driving games and still the cheapest sensation of speed
 *   there is — two lines, no geometry, no shader.
 *
 * It also refuses to go underground, which the old one would happily do on any
 * slope steeper than about twenty degrees.
 */
export class DriveCamera {
  constructor() {
    this.mode = 'chase';
    this.yaw = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.fov = 68;
    this.started = false;
    /** Whatever the camera's field of view was before driving started. */
    this.savedFov = null;
    this._shake = 0;
  }

  cycle() {
    const i = DRIVE_VIEWS.indexOf(this.mode);
    this.mode = DRIVE_VIEWS[(i + 1) % DRIVE_VIEWS.length];
    // A view change should not be a swoop across the island.
    this.started = false;
    return this.mode;
  }

  /**
   * Put the field of view back.
   *
   * Exactly the same class of bug as the altimeter that read kilometres for
   * the rest of the session after one trip in the boat: this writes camera.fov
   * every frame, and nothing else ever writes it back. Without this call, one
   * fast drive leaves every subsequent flight at an 80 degree fisheye.
   */
  restore(camera) {
    if (this.savedFov != null) {
      camera.fov = this.savedFov;
      camera.updateProjectionMatrix();
      this.savedFov = null;
    }
    this.started = false;
    this.mode = 'chase';
  }

  update(camera, v, dt) {
    if (this.savedFov == null) this.savedFov = camera.fov;
    const S = v.spec;
    const speed = Math.abs(v.speed);
    const frac = clamp(speed / S.topSpeed, 0, 1);
    // Where the van is actually going, not where its nose points.
    const travel = v.heading * (Math.PI / 180) - (v.drift || 0);
    const ts = Math.sin(travel);
    const tc = Math.cos(travel);

    let wantFov;
    if (this.mode === 'bonnet') {
      /*
       * Sitting on the bonnet. No lag and no look-ahead: the whole point of
       * this view is that the van's nose is the aiming mark, which is how you
       * place it accurately in a gateway or alongside a loading bay.
       */
      const e = S.eye || [0, 1.45, -1.15];
      const off = new THREE.Vector3(e[0], e[1], e[2]).applyQuaternion(v.quat);
      this.pos.set(v.pos.x + off.x, v.pos.y + off.y, v.pos.z + off.z);
      const nose = v.heading * (Math.PI / 180);
      this.look.set(
        this.pos.x + Math.sin(nose) * 60,
        this.pos.y + Math.sin(v.pitch) * 60 - 2,
        this.pos.z - Math.cos(nose) * 60
      );
      wantFov = 72;
      camera.position.copy(this.pos);
      camera.lookAt(this.look);
    } else {
      const wide = this.mode === 'far';
      const back = wide ? 22 : 8.0 + 5.0 * frac;
      const up = wide ? 9 : 3.2 + 0.8 * frac;
      const ahead = wide ? 8 : 6 + 20 * frac;
      wantFov = wide ? 56 : 64 + 16 * frac;

      // The camera's own heading, which chases the van's rather than matching
      // it. Faster at speed so it never falls behind on a motorway sweep.
      const chase = clamp(dt * (2.6 + 3.4 * frac), 0, 1);
      if (!this.started) this.yaw = travel;
      else this.yaw = angleLerp(this.yaw, travel, chase);
      const cs = Math.sin(this.yaw);
      const cc = Math.cos(this.yaw);

      const wx = v.pos.x - cs * back;
      const wz = v.pos.z + cc * back;
      let wy = v.pos.y + up;
      // Never inside the hill. The old camera did exactly this on the fjords.
      wy = Math.max(wy, heightAt(wx, wz) + 2.2);

      if (!this.started) {
        this.pos.set(wx, wy, wz);
        this.started = true;
      } else {
        // Position is smoothed as well as the yaw, but much less, or the van
        // swims around inside the frame over bumps.
        const k = clamp(dt * 9, 0, 1);
        this.pos.x = lerp(this.pos.x, wx, k);
        this.pos.y = lerp(this.pos.y, wy, clamp(dt * 5, 0, 1));
        this.pos.z = lerp(this.pos.z, wz, k);
      }

      this.look.set(v.pos.x + ts * ahead, v.pos.y + 1.1, v.pos.z - tc * ahead);

      /*
       * Shake, from the two things that deserve it: sliding, and a knock. It
       * is deliberately small — 0.12 m at a full slide — because the job of
       * the shake is to tell you the tyres have let go, not to make the game
       * hard to look at.
       */
      const want = (v.slide || 0) * 0.12 + (v.shockFlash || 0) * 0.18;
      this._shake = lerp(this._shake, want, clamp(dt * 10, 0, 1));
      const t = v.t * 46;
      camera.position.set(
        this.pos.x + Math.sin(t) * this._shake,
        this.pos.y + Math.sin(t * 1.7 + 1.1) * this._shake,
        this.pos.z + Math.cos(t * 1.3) * this._shake
      );
      camera.lookAt(this.look);
    }

    if (Math.abs(camera.fov - wantFov) > 0.05) {
      camera.fov = lerp(camera.fov, wantFov, clamp(dt * 3, 0, 1));
      camera.updateProjectionMatrix();
    }
  }
}

/** Shortest-way-round interpolation, so the camera never spins the long way. */
function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/* =========================================================== the thumbs == */

/**
 * Driving controls for a touch screen.
 *
 * Half the audience is on an iPad and the flight layout is wrong for a car in
 * every particular: a round stick whose vertical axis does nothing, a throttle
 * you have to dial to a value and hold there, and a rudder strip that is not
 * connected to anything a car has.
 *
 * This grafts a `setMode('drive' | 'fly')` onto the existing TouchControls
 * without editing that file — fifteen people are in this tree and touch.js
 * belongs to the flight game. The new widgets write `driveSteer`, `driveGo`
 * and `driveStop` into the same shared state object; `DriveInput` above is the
 * only thing that reads them.
 *
 *   installDriveTouch(this.touch);   // once, after TouchControls is built
 *   this.touch.setMode('drive');     // in startDrive
 *   this.touch.setMode('fly');       // in stopDrive
 */
export function installDriveTouch(touch) {
  if (!touch || touch.setMode) return touch;

  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };

  const state = touch.state;
  state.driveSteer = 0;
  state.driveGo = 0;
  state.driveStop = 0;

  /* ---- the wheel: a wide strip under the left thumb ------------------- */
  const wheel = el('div', 'touch-wheel');
  const mark = el('div', 'touch-wheel-mark');
  wheel.appendChild(el('div', 'touch-wheel-centre'));
  wheel.appendChild(mark);
  wheel.appendChild(el('div', 'touch-wheel-label', 'STEER'));
  touch.layer.appendChild(wheel);

  let wid = null;
  const setWheel = (e) => {
    const b = wheel.getBoundingClientRect();
    /*
     * A dead zone in the middle, which a car needs and an aeroplane does not:
     * without it, holding a finger anywhere near the centre of a 300 px strip
     * puts three or four degrees of permanent lock on and the van wanders down
     * every straight on the island.
     */
    let v = ((e.clientX - b.left) / b.width - 0.5) * 2;
    v = Math.abs(v) < 0.08 ? 0 : clamp((v - Math.sign(v) * 0.08) / 0.92, -1, 1);
    state.driveSteer = v;
    mark.style.left = `${50 + v * 44}%`;
  };
  wheel.addEventListener('pointerdown', (e) => {
    if (wid !== null) return;
    wid = e.pointerId;
    wheel.setPointerCapture(wid);
    wheel.classList.add('is-held');
    setWheel(e);
    e.preventDefault();
  });
  wheel.addEventListener('pointermove', (e) => {
    if (e.pointerId !== wid) return;
    setWheel(e);
    e.preventDefault();
  });
  const wheelUp = (e) => {
    if (e.pointerId !== wid) return;
    wid = null;
    wheel.classList.remove('is-held');
    state.driveSteer = 0;
    mark.style.left = '50%';
  };
  wheel.addEventListener('pointerup', wheelUp);
  wheel.addEventListener('pointercancel', wheelUp);

  /* ---- the pedals: two big targets on the right ------------------------ */
  const pedals = el('div', 'touch-pedals');
  const makePedal = (cls, label, field) => {
    const p = el('button', `touch-pedal ${cls}`, label);
    const set = (on) => {
      state[field] = on ? 1 : 0;
      p.classList.toggle('is-on', on);
    };
    p.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      p.setPointerCapture(e.pointerId);
      set(true);
    });
    const off = () => set(false);
    p.addEventListener('pointerup', off);
    p.addEventListener('pointercancel', off);
    p.addEventListener('pointerleave', off);
    pedals.appendChild(p);
    return p;
  };
  const goPad = makePedal('is-go', 'GO', 'driveGo');
  const stopPad = makePedal('is-stop', 'STOP', 'driveStop');
  touch.layer.appendChild(pedals);

  /*
   * Each widget remembers the display value it wants when it is on. Setting
   * `style.display = ''` would fall back to the stylesheet, and the stylesheet
   * says `display: none` — which is how the drive controls end up invisible in
   * the drive mode they were built for.
   */
  touch.driveWidgets = [
    { node: wheel, on: 'block' },
    { node: pedals, on: 'flex' },
  ];
  touch.drivePads = { goPad, stopPad };

  /**
   * Swap the layout. The flight widgets are hidden rather than destroyed,
   * because switching game is something you do a dozen times in a lesson and
   * rebuilding the DOM each time is both slower and a way to lose a pointer
   * capture mid-touch.
   */
  touch.setMode = function setMode(mode) {
    const driving = mode === 'drive';
    this.mode = driving ? 'drive' : 'fly';
    const fly = [this.stick, this.layer.querySelector('.touch-throttle'), this.layer.querySelector('.touch-rudder')];
    for (const n of fly) if (n) n.style.display = driving ? 'none' : '';
    for (const w of this.driveWidgets) w.node.style.display = driving ? w.on : 'none';
    // The flight pads are gear, flaps, engine and drop. None of them mean
    // anything in a van; the camera button does, so it is the one that stays.
    for (const p of [this.enginePad, this.gearPad, this.flapPad, this.dropPad]) {
      if (p) p.style.display = driving ? 'none' : '';
    }
    // The one flight pad that survives: it is the wheel brakes in the air and
    // the handbrake on the ground, and it is the same key either way.
    if (this.brakePad) this.brakePad.textContent = driving ? 'HAND' : 'BRAKES';
    // Leaving one of these latched on the way out is how you end up flying
    // with an invisible finger on the brake.
    state.driveGo = 0;
    state.driveStop = 0;
    state.driveSteer = 0;
    goPad.classList.remove('is-on');
    stopPad.classList.remove('is-on');
  };
  touch.setMode('fly');
  return touch;
}
