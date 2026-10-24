/**
 * The swing wing and the afterburners, as the flight model feels them — for
 * any type with `swingWing: true` in its roster entry (the B-1B Lancer,
 * ./extra/lancer.js, where every number below comes from).
 *
 * No DOM and no drawing: the game puts this on the aeroplane through
 * src/features/swing-wing.js, and tests/features/lancer.mjs puts the very same
 * wrapper on a node Aircraft, so what node measures is what the game flies.
 *
 * HOW IT TOUCHES THE FLIGHT MODEL, the way the F-35B's hover does
 * (src/features/stovl.js): physics.js steps at 120 Hz and SPEC is a live
 * binding shared with the whole game, so wrapUpdate() puts a before and an
 * after round the aeroplane's own update():
 *
 *   before: the fields of SPEC this changes are SAVED as they are (so a
 *           change somebody else made, an upgrade or damage, is carried
 *           through rather than overwritten), then set for the wing where it
 *           is — span, lift slope, camber, stall angle, drag due to lift,
 *           pitch stiffness, roll power and roll inertia — plus the
 *           transonic drag rise for this Mach number and sweep, the
 *           afterburners' thrust and fuel flow, and the wing tips' strike
 *           points moved to where the swept tips are;
 *   after:  every one of them put back.
 *
 * So between steps SPEC reads exactly as the roster wrote it, and nothing in
 * physics.js is edited. A throw inside the wrapper is caught, the SPEC put
 * back, and the wing switched off for the session (onError): it runs inside
 * main's physics loop, outside the extension layer's own fence.
 *
 * THE FLAPS wait for the wing: they will not run out while it is swept past
 * 20 degrees (the real one's interlock), and in AUTO a flap selection brings
 * the wing forward first. A notch aft with the flaps out is refused, with the
 * reason.
 */
import { SPEC } from './physics.js';
import {
  LANCER_WING, sweptNumbers, waveDrag, thrustScale, burnerShare, machOf, autoSweep, panelPoint, BURNER,
} from './extra/lancer.js';

const KT = 1.94384;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/** Flaps run out only with the wing at or forward of this. */
export const FLAP_LIMIT = 20;

/** The SPEC fields the wing and the burners change, saved and put back every step. */
const FIELDS = ['wingSpan', 'CLa', 'CL0', 'alphaStall', 'k', 'CD0', 'Cmalpha', 'Cmq', 'Clda', 'Izz', 'thrustMax', 'fuelBurnMax'];

/**
 * The pitch damper: how much the stability-augmentation system multiplies
 * the airframe's own pitch damping by, at a true airspeed (m/s) and density
 * ratio. An airframe's pitch damping goes with ρV and the simplified mode's
 * height-hold (physics.js: fixed gains on vertical speed, which is V × the
 * flight-path angle) with ρV³, so flying three times faster in a quarter of
 * the air the hold out-ran the airframe: measured hands-off at 520 kt and
 * 40,000 ft it porpoised to 58 deg/s. The real B-1B flies with a pitch
 * damper on (SCAS); this one adds none at the speeds every other jet here
 * flies at, √(ρ0/ρ) × V/180 m/s of it above, up to 3.5 times.
 */
export function pitchDamper(tas, sigma) {
  const f = Math.sqrt(1 / clamp(sigma, 0.05, 1.2)) * ((tas || 0) / 180);
  return clamp(f, 1, 3.5);
}

/** The swept tip's strike point, starboard, relative to the pin, at the forward stop: the tip's mid-chord. */
const TIP = (() => {
  const W = LANCER_WING;
  const le = -W.rootAhead + W.span * Math.tan((W.min * Math.PI) / 180);
  return { dx: W.span, dz: le + W.tipChord * 0.45 };
})();

export class SwingWing {
  constructor() {
    this.broken = false;
    this.reset();
  }

  /** Back to the forward stop, in AUTO. For a new flight. */
  reset(deg = LANCER_WING.min) {
    this.mode = 'auto';
    this.sweep = deg;
    this.target = deg;
    this.manual = deg;
    this.mach = 0;
    this.burner = 0;
    this.wave = 0;
    this.flapsHeld = false;
    this.notes = [];
    this._saved = {};
    this._tips = [];
    this._noteT = {};
  }

  note(key, text, kind = 'info', seconds = 3) {
    // The same advice at most every six seconds: a held key or a held condition must not stream it.
    const now = this._clock || 0;
    if (this._noteT[key] !== undefined && now - this._noteT[key] < 6) return;
    this._noteT[key] = now;
    this.notes.push({ text, kind, seconds });
  }

  /** The notch the wing is at or next past, going `dir` (+1 aft, -1 forward). */
  nextNotch(from, dir) {
    const D = LANCER_WING.detents;
    if (dir > 0) return D.find((d) => d > from + 0.5) ?? D[D.length - 1];
    for (let i = D.length - 1; i >= 0; i--) if (D[i] < from - 0.5) return D[i];
    return D[0];
  }

  /**
   * The pilot's sweep keys: one notch aft (+1, the ] key) or forward (-1,
   * [). Either takes the wing out of AUTO; [ at the forward stop puts it
   * back into AUTO. Returns what it did: 'notch' | 'auto' | 'refused' | 'stop'.
   */
  nudge(dir, ac) {
    const D = LANCER_WING.detents;
    if (dir < 0 && this.mode === 'manual' && this.manual <= D[0] + 0.01) {
      this.mode = 'auto';
      this.note('auto', 'Wings: AUTO — they sweep with your speed');
      return 'auto';
    }
    const from = this.mode === 'auto' ? this.sweep : this.manual;
    const to = this.nextNotch(from, dir);
    if (dir > 0 && to > FLAP_LIMIT && ac && (ac.flapsTarget > 0.01 || ac.flaps > 0.01)) {
      this.note('flapsFirst', 'Flaps up first (V) — the wings cannot sweep back with the flaps down', 'warn');
      return 'refused';
    }
    if (this.mode === 'manual' && Math.abs(to - this.manual) < 0.01) return 'stop';
    this.mode = 'manual';
    this.manual = to;
    this.note('notch', `Wings ${to}° — ${to <= 15 ? 'forward for slow flight' : to >= 67.5 ? 'all the way back for speed' : 'swept'} ([ ] to move, [ at the front for AUTO)`);
    return 'notch';
  }

  setAuto() {
    this.mode = 'auto';
  }

  /** Where the wing wants to be now. */
  aim(ac) {
    const M = machOf(ac.airspeed, ac.pos.y);
    const flaps = Math.max(ac.flapsTarget || 0, ac.flaps || 0);
    if (this.mode === 'auto') return autoSweep({ M, iasKt: (ac.ias || 0) * KT, flaps, gearDown: !!ac.gearDown });
    return this.manual;
  }

  /** Before one physics step: move the wing, then set SPEC for it. */
  pre(ac, dt) {
    this._clock = (this._clock || 0) + dt;
    this.target = this.aim(ac);
    const step = LANCER_WING.rate * dt;
    this.sweep += clamp(this.target - this.sweep, -step, step);
    const M = machOf(ac.airspeed, ac.pos.y);
    this.mach = M;
    const saved = this._saved;
    for (const f of FIELDS) saved[f] = SPEC[f];
    const n = sweptNumbers(saved, this.sweep);
    for (const k in n) SPEC[k] = n[k];
    this.wave = waveDrag(M, this.sweep);
    SPEC.CD0 = n.CD0 + this.wave;
    // The burners: from the spooled engine, not the lever, so they light as it winds up.
    const thr = clamp(((ac.rpm || 0) - 0.18) / 0.82, 0, 1);
    this.burner = ac.engineOn === false ? 0 : burnerShare(thr);
    const u = (ac.airspeed || 0) * Math.cos(ac.alpha || 0) * Math.cos(ac.beta || 0);
    const sigma = Math.exp(-Math.max(0, ac.pos.y) / 8500);
    SPEC.thrustMax = saved.thrustMax * thrustScale({ throttle: thr, u, M, sigma });
    SPEC.Cmq = saved.Cmq * pitchDamper(ac.airspeed, sigma);
    SPEC.fuelBurnMax = saved.fuelBurnMax * (1 + (BURNER.fuel - 1) * this.burner);
    // The tips' strike points follow the panels.
    this._tips.length = 0;
    for (const h of SPEC.hardPoints || []) {
      const part = h.part || h.partId;
      if (part !== 'leftWing' && part !== 'rightWing') continue;
      const s = part === 'leftWing' ? -1 : 1;
      this._tips.push({ h, x: h.pos.x, z: h.pos.z });
      const p = panelPoint(TIP.dx, TIP.dz, this.sweep);
      h.pos.x = s * p.x;
      h.pos.z = p.z;
    }
    // The flaps wait for the wing.
    this.flapsHeld = this.sweep > FLAP_LIMIT + 0.5 && (ac.flapsTarget || 0) > 0.01;
    if (this.flapsHeld) {
      ac.flaps = 0;
      if (this.mode === 'manual') this.note('flapsWait', 'Flaps wait for the wings — press [ to bring them forward', 'warn');
      else this.note('flapsAuto', 'Wings coming forward for the flaps');
    }
    // Too slow for the sweep the pilot chose, or the wheels down with it swept: say so
    // (in MANUAL the wing does not move by itself).
    if (this.mode === 'manual' && !ac.onGround && this.sweep > 30) {
      const stall = this.stallKt(this.sweep, saved);
      if ((ac.ias || 0) * KT < stall * 1.2) this.note('slow', `Slow for the wings swept back (stall ${Math.round(stall)} kt) — sweep them forward with [`, 'warn');
      else if (ac.gearDown) this.note('gearSwept', 'Wheels down with the wings swept: bring them forward ([) to land slowly — or [ at the front for AUTO', 'warn', 4);
    }
  }

  /** After one physics step: SPEC put back exactly as it was found. */
  post(ac) {
    const saved = this._saved;
    for (const f of FIELDS) if (f in saved) SPEC[f] = saved[f];
    for (const t of this._tips) {
      t.h.pos.x = t.x;
      t.h.pos.z = t.z;
    }
    this._tips.length = 0;
    if (this.flapsHeld) ac.flaps = 0;
  }

  /** Clean stall speed (kt, sea level) with the wing at `deg`, from the wing-forward numbers `base`. */
  stallKt(deg, base = SPEC) {
    const n = sweptNumbers(base, deg);
    const cl = n.CL0 + n.CLa * n.alphaStall;
    return Math.sqrt((2 * base.mass * 9.80665) / (1.225 * base.wingArea * cl)) * KT;
  }
}

/**
 * Put the wing on an Aircraft: its update() gets the before and the after.
 * `active()` is asked every step (the game turns it off out of the cockpit
 * or in another aeroplane); `onError(e)` is told once if it ever throws, and
 * the wing is off from then on. Returns a function that takes it off again.
 */
export function wrapUpdate(ac, sw, { active = () => true, onError = null } = {}) {
  const inner = ac.update;
  ac.update = function swingStep(dt, weather) {
    const on = !sw.broken && active();
    let pre = false;
    if (on) {
      try {
        sw.pre(this, dt);
        pre = true;
      } catch (e) {
        sw.broken = true;
        try { sw.post(this); } catch (e2) { void e2; }
        if (onError) onError(e);
      }
    }
    try {
      return inner.call(this, dt, weather);
    } finally {
      if (pre) {
        try {
          sw.post(this);
        } catch (e) {
          sw.broken = true;
          if (onError) onError(e);
        }
      }
    }
  };
  return () => {
    if (ac.update && ac.update.name === 'swingStep') ac.update = inner;
  };
}
