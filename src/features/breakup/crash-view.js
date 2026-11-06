/**
 * WATCHING THE WRECK, then the crash card.
 *
 * main.js puts the crash card up 2.2 seconds after the hit. That was fine when
 * the wreck had stopped by then, but a 70 m/s belly slide runs for ten seconds
 * and more, and an aeroplane in the sea has only just stopped skipping. So
 * the card waits while there is something to watch, and never long:
 *
 *   slide   until it has stopped, and at most VIEW.slideMax after the card
 *           was due. The camera is the game's own, which stops for a sliding
 *           wreck and keeps looking at it (camera.js). A telephoto that kept
 *           the wreck the same size was tried and is gone: on a runway it
 *           flickered over 40% of a 10-degree field, over WCAG's 25%.
 *   sink    until the water has closed over it and the camera has followed
 *           it under for VIEW.underHold, and at most VIEW.sinkMax.
 *
 * SEIZURE SAFETY, measured with tests/flicker-probe.js in two-second pieces:
 * under the water it is 0-5% of a 10-degree field; a lens moving low over the
 * sea's glitter is 15-35%, going down through the surface 18-28%, and the
 * telephoto on the sea, which magnifies that glitter, 87-95%, against WCAG's
 * 25%. So with Reduce flashing on (the default) the lens neither moves nor
 * zooms over the water: it stays where the game stopped it while the water
 * closes over the wreck, and goes under in one dissolve (the wash). With the switch off it goes round the wreck low over the water and
 * down through the surface.
 *
 * Skip (a button, or the crashSkip key, Space by default) brings the card at once. A wreck aground in
 * the shallows, or a crash nobody is waiting on (out of the aeroplane, a
 * mayday's own ending, a cartoon crash), never holds it.
 *
 * Nothing here knows about the rest of the crash: features/breakup.js hands in
 * `wreck()`, which fills what it needs to know, and `show()`, which is the
 * real crash card. Whatever ends the flight (a restart, the menu) ends this
 * through cancel(), so a camera or a HUD cannot be left behind.
 */

import * as THREE from '../../vendor/three.module.js';
import { extLayer } from '../../game/extensions.js';
import { FLASH } from '../../render/flash-safety.js';

export const VIEW = Object.freeze({
  /** Longest it waits past the moment the card was due, which is 2.2 s after the hit. */
  slideMax: 7.5,
  sinkMax: 10.5,
  /** Slower than this it has stopped (m/s); the card follows this long after. */
  stopped: 2.5,
  afterStop: 1,
  /** How long the camera stays under before the card. */
  underHold: 2.8,
  /** Aground in the shallows: this long after it stops. */
  aground: 1.6,
  /** The lens round a wreck at sea: distance by length, within these. */
  rMin: 20,
  rMax: 75,
  underMax: 38,
  /** Metres a second it may go down, and how long it takes over the view from wherever the game had it. */
  plunge: 3.2,
  takeOver: 1.1,
  cutFrom: 220,
  /** With Reduce flashing: how long the closed water is watched, and the wash that takes the lens under. */
  closeHold: 0.5,
  washIn: 0.35,
  washOut: 0.5,
});

/** Where the sink view wants the lens: `w` is { y, top, L, floor }, `under` the seconds since the wreck's top went under. Pure. */
export function sinkLensHeight(w, under) {
  const up = Math.max(3.2, Math.min(15, 2.6 + (w.L || 10) * 0.16));
  if (!(under > 0)) return Math.max(up, Math.min(up, w.top + 3));
  // Down after it, once the water has closed over it: a little above it, and always clear of the sea bed.
  const after = w.y + Math.max(2.5, (w.L || 10) * 0.12);
  const low = Math.min(-1.6, after);
  const floor = Number.isFinite(w.floor) ? w.floor + 1.6 : -Infinity;
  return Math.max(low, floor);
}

/** How far from it to stand under the water: near enough that the water does not hide it, whatever its size. Pure. */
export function underRange(L) {
  return Math.max(11, Math.min(VIEW.underMax, (L || 10) * 0.6 + 6));
}

const _p = new THREE.Vector3();
const _l = new THREE.Vector3();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

export class CrashView {
  /**
   * @param {object} sim
   * @param {object} o  { kind: 'slide'|'sink', show(), wreck(out), ready() }: `ready` says the sea bed has loaded, and
   *   the lens stays over the water until it has
   */
  constructor(sim, o) {
    this.sim = sim;
    this.kind = o.kind;
    this.show = o.show;
    this.wreck = o.wreck;
    this.ready = o.ready || (() => true);
    this.t = 0;
    this.stopT = 0;
    this.underT = 0;
    this.camUnderT = 0;
    this.owning = false;
    this.ownT = 0;
    this.ended = false;
    /** The card is up, and the lens stays on the wreck behind it until the flight is over. */
    this.parked = false;
    this.skipped = false;
    this.hudHidden = false;
    this.w = { x: 0, y: 0, z: 0, speed: 0, top: 1, L: 10, floor: NaN, sliding: false, closing: false, aground: false };
    this.look = new THREE.Vector3();
    this.lens = new THREE.Vector3();
    this.ang = 0;
    this.lensY = 0;
    this.from = null;
    this.fov0 = sim.camera ? sim.camera.fov : 55;
    // Known from the start: the lens is asked for before the first step, and a wreck "at" 0, 0, 0 is one kilometres off.
    this.wreck(this.w);
    this.button();
  }

  /** The way out, for fingers and mice. The key is the registry's, in features/breakup.js. */
  button() {
    let host = null;
    try {
      host = extLayer();
    } catch (e) {
      return;
    }
    if (!host || typeof document === 'undefined') return;
    const b = (this.el = document.createElement('button'));
    b.type = 'button';
    b.textContent = 'Skip';
    b.setAttribute('aria-label', 'Skip to the crash card');
    b.dataset.crashSkip = '1';
    Object.assign(b.style, {
      position: 'absolute', right: 'max(16px, env(safe-area-inset-right))', bottom: 'max(18px, env(safe-area-inset-bottom))',
      minWidth: '84px', minHeight: '46px', padding: '0 20px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.28)',
      background: 'rgba(10,16,24,0.72)', color: '#fff', font: '600 15px/1 var(--font, system-ui), sans-serif',
      cursor: 'pointer', pointerEvents: 'auto', zIndex: '45', touchAction: 'manipulation',
    });
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.skip();
    });
    host.appendChild(b);
  }

  skip() {
    this.skipped = true;
    this.finish();
  }

  removeUi() {
    if (this.el) this.el.remove();
    this.el = null;
    if (this.washEl) this.washEl.remove();
    this.washEl = null;
  }

  /** The sheet of water the lens goes under behind. Over the picture, under the HUD, and no finger can hit it. */
  washSheet() {
    if (this.washEl || typeof document === 'undefined') return;
    let host = null;
    try {
      host = extLayer();
    } catch (e) {
      return;
    }
    if (!host) return;
    const d = (this.washEl = document.createElement('div'));
    d.dataset.crashWash = '1';
    Object.assign(d.style, { position: 'absolute', inset: '0', background: 'rgb(16,82,94)', opacity: '0', pointerEvents: 'none', zIndex: '20' });
    host.appendChild(d);
  }

  /** The card. */
  finish() {
    if (this.ended) return;
    this.ended = true;
    this.removeUi();
    this.hud(true);
    this.show();
    // The card is up: the lens stays on the wreck behind it. No card came (a mission going on): the game's view has it back.
    if (this.sim && this.sim.state === 'flying') this.giveBack();
    else this.parked = this.owning;
  }

  /** Nobody is waiting any more (a restart, the menu, a new aeroplane): no card, no camera, no button. */
  cancel() {
    this.parked = false;
    if (this.ended && !this.owning) return;
    this.ended = true;
    this.removeUi();
    this.hud(true);
    this.giveBack();
  }

  giveBack() {
    const { sim } = this;
    if (this.owning) {
      this.owning = false;
      if (sim && sim.rig) sim.rig.initialised = false;
      // Whatever comes next (the menu's backdrop, a new flight) must not begin under the sea with the sea bed gone.
      if (sim && sim.camera && sim.camera.position.y < 2) {
        sim.camera.position.y = 2;
        sim.camera.updateMatrixWorld();
      }
    }
    if (sim && sim.camera && sim.camera.fov !== this.fov0) {
      sim.camera.fov = this.fov0;
      sim.camera.updateProjectionMatrix();
    }
  }

  hud(show) {
    const h = this.sim && this.sim.hud;
    if (!h || typeof h.setVisible !== 'function') return;
    if (show && !this.hudHidden) return;
    if (!show && this.hudHidden) return;
    this.hudHidden = !show;
    if (show && this.sim.state !== 'flying') return;
    h.setVisible(show);
  }

  /** A game frame, outside any replay: is it time for the card? */
  step(dt) {
    if (this.ended) return;
    this.t += dt;
    const w = this.w;
    this.wreck(w);
    if (this.kind === 'slide') {
      if (w.sliding && w.speed > VIEW.stopped) this.stopT = 0;
      else this.stopT += dt;
      if (this.stopT >= VIEW.afterStop || this.t >= VIEW.slideMax) this.finish();
      return;
    }
    // Going down, not a dip on the way across: it can be under for a moment while it is still skidding.
    if (w.closing && w.top < -0.3) this.underT += dt;
    if (this.sim.camera && this.sim.camera.position.y < 0) {
      this.camUnderT += dt;
      this.hud(false);
    }
    if (w.aground) this.stopT += dt;
    if (this.stopT >= VIEW.aground || this.camUnderT >= VIEW.underHold || this.t >= VIEW.sinkMax) this.finish();
  }

  /** The lens: true when this frame's camera is ours. Called in place of the game's own view. */
  camera(dt, cam) {
    if ((this.ended && !this.parked) || !cam) return false;
    this.wreck(this.w);
    return this.kind === 'sink' && this.sinkLens(dt, cam);
  }

  /** Round the wreck, low over the water; down after it when the water has closed over it. */
  sinkLens(dt, cam) {
    const { w } = this;
    // It is still skipping and sliding across the water: the game's own view watches that (and stops for it).
    if (w.sliding) return false;
    if (!this.owning) {
      this.owning = true;
      this.ownT = 0;
      this.from = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov };
      this.fov0 = cam.fov;
      this.ang = Math.atan2(cam.position.x - w.x, cam.position.z - w.z);
      this.look.set(w.x, w.y, w.z);
      // From a long way off (the tower, or a lens left high) there is nothing to ease through: cut to it. The height
      // below is where it is going, not where it was: the move in from where it was is the blend at the end of this.
      this.lensY = Math.max(1, Math.min(cam.position.y, sinkLensHeight(w, 0)));
      this.lens.copy(cam.position);
      this.far = cam.position.distanceTo(_p.set(w.x, w.y, w.z)) > VIEW.cutFrom;
      if (this.far) this.ownT = VIEW.takeOver;
      this.washT = -1;
      this.wentUnder = false;
    }
    this.ownT += dt;
    if (this.washT >= 0) this.stepWash(dt);
    if (!this.wentUnder) return this.standOff(dt, cam); // always: moving through the surface measured 30-66% flash, whatever the switch says
    this.ang += dt * 0.12;
    // Back from the spray over the water; once it is under, in close enough to see it.
    const R0 = Math.max(VIEW.rMin, Math.min(VIEW.rMax, w.L * 1.15 + 12)) * (FLASH.reduce ? 1.2 : 1);
    this.Rnow = this.Rnow == null ? R0 : this.Rnow;
    const want = this.underT > 0 && this.ready() ? underRange(w.L) : R0;
    this.Rnow += (want - this.Rnow) * (1 - Math.exp(-dt * 0.8));
    const R = this.Rnow;
    const wantY = sinkLensHeight(w, this.ready() ? this.underT : 0);
    const k = 1 - Math.exp(-dt * 1.6);
    const step = wantY - this.lensY;
    this.lensY += Math.max(-VIEW.plunge * dt, Math.min(VIEW.plunge * dt * 2, step * k * 2));
    // Under the wreck's own level the look stays on it; above it the look is down the wreck's side, never at the sky.
    const lookY = Math.min(w.y + w.L * 0.03, this.lensY + 1);
    this.look.lerp(_l.set(w.x, lookY, w.z), 1 - Math.exp(-dt * 4));
    _p.set(w.x + Math.sin(this.ang) * R, this.lensY, w.z + Math.cos(this.ang) * R);
    const u = Math.min(1, this.ownT / VIEW.takeOver);
    const e = u * u * (3 - 2 * u);
    cam.position.copy(this.from.pos).lerp(_p, e);
    _m.lookAt(cam.position, this.look, UP);
    _q1.setFromRotationMatrix(_m);
    cam.quaternion.copy(_q0.copy(this.from.quat).slerp(_q1, e));
    const fov = this.from.fov + (58 - this.from.fov) * e;
    if (Math.abs(fov - cam.fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    return true;
  }

  /** Reduce flashing: the lens stands still, and when the water has closed the wash takes it under. */
  standOff(dt, cam) {
    const { w } = this;
    // A lens a long way off has nothing to watch: one cut to a standpoint, and it stands there.
    if (this.far) {
      this.far = false;
      const R = Math.max(VIEW.rMin, Math.min(VIEW.rMax, w.L * 1.15 + 12)) * 2;
      this.lens.set(w.x + Math.sin(this.ang) * R, Math.max(6, w.L * 0.3), w.z + Math.cos(this.ang) * R);
    }
    this.look.lerp(_l.set(w.x, Math.max(w.y, -1) + 0.5, w.z), 1 - Math.exp(-dt * 4));
    cam.position.copy(this.lens);
    _m.lookAt(cam.position, this.look, UP);
    cam.quaternion.setFromRotationMatrix(_m);
    if (this.underT > VIEW.closeHold && this.washT < 0 && this.ready()) {
      this.washT = 0;
      this.washSheet();
    }
    if (this.washT >= VIEW.washIn) this.goUnder(cam);
    return true;
  }

  stepWash(dt) {
    this.washT += dt;
    const u = this.washT < VIEW.washIn ? this.washT / VIEW.washIn : 1 - (this.washT - VIEW.washIn) / VIEW.washOut;
    if (this.washEl) this.washEl.style.opacity = String(Math.max(0, Math.min(1, u)));
    if (this.washT >= VIEW.washIn + VIEW.washOut && this.washEl) {
      this.washEl.remove();
      this.washEl = null;
    }
  }

  /** Behind the wash: under, beside the wreck, and the ordinary lens from here on. */
  goUnder(cam) {
    const { w } = this;
    this.wentUnder = true;
    this.ang = Math.atan2(cam.position.x - w.x, cam.position.z - w.z);
    this.Rnow = underRange(w.L);
    this.lensY = sinkLensHeight(w, 1);
    _p.set(w.x + Math.sin(this.ang) * this.Rnow, this.lensY, w.z + Math.cos(this.ang) * this.Rnow);
    cam.position.copy(_p);
    this.look.set(w.x, Math.min(w.y, this.lensY + 1), w.z);
    _m.lookAt(cam.position, this.look, UP);
    cam.quaternion.setFromRotationMatrix(_m);
    cam.fov = 58;
    cam.updateProjectionMatrix();
    this.from = { pos: _p.clone(), quat: cam.quaternion.clone(), fov: 58 };
    this.ownT = VIEW.takeOver;
  }

  debug() {
    return { lens: +this.lens.y.toFixed(1), far: !!this.far, went: !!this.wentUnder, washT: this.washT, parked: this.parked, kind: this.kind, t: this.t, under: this.underT, camUnder: this.camUnderT, owning: this.owning, ended: this.ended, skipped: this.skipped };
  }
}
