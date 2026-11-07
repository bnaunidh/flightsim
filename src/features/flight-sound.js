/**
 * What the flight sounds like beyond the engine, read from the flight itself:
 * where the listener is, the switches, the seatbelt sign, the recorded layer.
 * After the menu, like every feature; src/audio holds only what first load needs.
 *
 * WHERE YOU ARE. The camera's distance from the aeroplane sets a level, how much
 * top end the air has left, and a doppler ratio from how fast that distance is
 * changing. Nothing here asks which view it is: chase and cockpit sit inside
 * NEAR and come out unchanged, the tower and the fly-by do not, and neither does
 * walking away from a parked aeroplane.
 *
 * SWITCHES. Anything the pilot moved, whichever way they moved it (key, touch
 * sheet, pill, a mission), shows up as a changed field, so nothing hooks the
 * dozen places that can do it. Heard in the cockpit only. Compares numbers
 * every frame and allocates nothing.
 *
 * THE SIGN. An airliner's seatbelt chime, on the same flight as the PA's words
 * (features/passengers/pa.js): on before the roll, off once settled above 3,000
 * ft, on again for rough air or the descent.
 */
import { registerExtension } from '../game/extensions.js';
import { SoundSamples } from './sound-samples.js';

/** Metres. Inside this the listener is on the aeroplane. Past it, 1/distance-ish. */
export const NEAR = 60;
const SOUND = 343;
const FT = 3.281;

/** Level and top end at `d` metres. Pure, for the node test. */
export function atDistance(d) {
  const r = Math.max(0, d - NEAR);
  return { gain: Math.max(0.015, 1 / (1 + (r / 110) ** 1.5)), cut: r > 0 ? 700 + 19300 * Math.exp(-r / 320) : 20000 };
}

/** The doppler ratio for a distance growing at `rate` m/s. Pure, for the node test. */
export function doppler(rate) {
  return Math.min(1.5, Math.max(0.7, SOUND / Math.max(1, SOUND + rate)));
}

/** The sign's state for this frame, from `on` and how long the climb has been settled. Pure, for the node test. */
export function beltSign(on, f) {
  if (f.onGround) return true;
  if (on) return f.settled > 8 && f.aglFt > 3000 && f.turb < 0.6 ? false : true;
  return f.turb > 0.7 || (f.vsFpm < -500 && f.aglFt < 9000 && f.settled === 0) ? true : false;
}

const S = {
  fx: null,
  sign: true,
  signSaid: false,
  settled: 0,
  flown: 0,
  dist: 0,
  rate: 0,
  camX: 0,
  init: false,
  sw: { gear: 0, flaps: 0, brake: 0, speedbrake: 0, armed: 0, ap: 0, lights: 0 },
};

export class FlightFx {
  constructor(sim) {
    this.sim = sim;
    this.mixer = sim.audio.mixer;
    this.samples = new SoundSamples(this.mixer);
    this.mixer.samples = this.samples;
  }

  /** A toggle: a dry tick off the panel. */
  click() {
    const m = this.mixer;
    if (!m.ctx || m.sampled('click.switch', { bus: 'alerts' })) return;
    m.noiseBurst({ bus: 'alerts', duration: 0.028, gain: 0.24, freq: 2800, q: 1.6, attack: 0.001 });
    m.noiseBurst({ bus: 'alerts', duration: 0.05, gain: 0.14, freq: 700, q: 1.4, attack: 0.002 });
  }

  /** A big lever going home: gear, flaps. */
  lever() {
    const m = this.mixer;
    if (!m.ctx || m.sampled('click.lever', { bus: 'alerts' })) return;
    m.noiseBurst({ bus: 'alerts', duration: 0.09, gain: 0.3, freq: 460, q: 1.2, attack: 0.002 });
    m.noiseBurst({ bus: 'alerts', duration: 0.03, gain: 0.16, freq: 1900, q: 1.6, attack: 0.001 });
  }

  /** The seatbelt sign's chime: one soft struck note, a touch inharmonic like a small bell. */
  chime() {
    const m = this.mixer;
    if (!m.ctx || m.sampled('chime.seatbelt', { bus: 'alerts' })) return;
    for (const [f, g, d] of [[880, 0.16, 1.5], [1759, 0.05, 0.9], [2429, 0.022, 0.5]]) {
      m.tone({ bus: 'alerts', freq: f, duration: d, gain: g, type: 'sine', attack: 0.004 });
    }
  }

  /** A cabin door: the latch, the weight of it, the seal. */
  door() {
    const m = this.mixer;
    if (!m.ctx || m.sampled('door', {})) return;
    const t = m.time;
    m.noiseBurst({ bus: 'environment', duration: 0.05, gain: 0.26, freq: 1500, q: 1.3, attack: 0.002 });
    m.noiseBurst({ bus: 'environment', when: t + 0.05, duration: 0.3, gain: 0.42, freq: 260, q: 1, attack: 0.006 });
    m.noiseBurst({ bus: 'environment', when: t + 0.08, duration: 0.5, gain: 0.05, type: 'highpass', freq: 2600, attack: 0.04 });
  }
}

function listen(sim, ac, dt) {
  const v = sim.audio.mixer.view;
  const c = sim.camera && sim.camera.position;
  if (!c || !ac.pos) return;
  const d = c.distanceTo(ac.pos);
  const raw = dt > 0 ? (d - S.dist) / dt : 0;
  S.dist = d;
  // A view change is a jump in distance, not a speed.
  const jumped = !S.init || Math.abs(raw) > 900;
  S.init = true;
  S.rate = jumped ? 0 : S.rate + (raw - S.rate) * Math.min(1, dt * 5);
  const near = atDistance(d);
  v.gain += (near.gain - v.gain) * Math.min(1, dt * 8);
  v.cut = near.cut;
  v.pitch = d < NEAR && Math.abs(S.rate) < 15 ? 1 : doppler(S.rate);
}

function switches(sim, ac, fx) {
  const w = S.sw;
  const L = ac.lights || {};
  const flaps = ac.flapsTarget;
  const lights = (L.nav === 'off') + (L.beacon === 'off') * 2 + (L.strobe === 'off') * 4 + (L.landing === 'off') * 8 + (L.taxi === 'off') * 16 + (L.landing === 'on') * 32 + (L.taxi === 'on') * 64 + (L.nav === 'on') * 128;
  const gear = ac.gearDown ? 1 : 0;
  const brake = ac.parkingBrake ? 1 : 0;
  const sb = ac.speedbrake ? 1 : 0;
  const armed = ac.spoilersArmed ? 1 : 0;
  const ap = sim.autopilot && sim.autopilot.engaged ? 1 : 0;
  const big = gear !== w.gear || flaps !== w.flaps;
  const small = brake !== w.brake || sb !== w.speedbrake || armed !== w.armed || ap !== w.ap || lights !== w.lights;
  if (sim.audio.engine.interior) {
    if (big) fx.lever();
    else if (small) fx.click();
  }
  // The cockpit voice, if its clips are there (owner-approved, recorded clips only; never a device voice).
  const locked = ac.gearPos >= 1 ? 1 : ac.gearPos <= 0 ? 0 : -1;
  if (locked >= 0 && locked !== w.locked) {
    w.locked = locked;
    sim.audio.mixer.sampled(locked ? 'voice.gear-down' : 'voice.gear-up', { bus: 'alerts' });
  }
  w.gear = gear;
  w.flaps = flaps;
  w.brake = brake;
  w.speedbrake = sb;
  w.armed = armed;
  w.ap = ap;
  w.lights = lights;
}

function sign(sim, ac, fx, dt) {
  const t = sim.aircraftType;
  if (!t || t.class !== 'Airliner' || t.category === 'military') return;
  const vsFpm = ac.vs * 196.85;
  S.settled = !ac.onGround && Math.abs(vsFpm) < 700 ? S.settled + dt : 0;
  const next = beltSign(S.sign, { onGround: ac.onGround, aglFt: ac.agl * FT, vsFpm, settled: S.settled, turb: sim.weather.cond.turb });
  if (next !== S.sign) {
    S.sign = next;
    fx.chime();
  }
  // The sign is on from the start of a flight: say so once the engines are heard.
  S.flown += dt;
  if (!S.signSaid && S.flown > 2 && ac.onGround && ac.rpm > 0.1) {
    S.signSaid = true;
    fx.chime();
  }
}

/** Recorded beds, when there are any: the cabin, and the engine's own loop under the synth. */
function beds(sim, ac, fx) {
  const s = fx.samples;
  if (!s.slots.size) return;
  const a = sim.audio;
  const inside = a.engine.interior;
  s.follow('loop.cabin', inside ? 0.5 + Math.min(1, ac.airspeed / 130) * 0.5 : 0);
  const slot = `loop.${a.family}`;
  const had = s.follow(slot, ac.rpm > 0.04 ? (0.35 + ac.rpm * 0.65) * a.mixer.view.gain * (inside ? 0.6 : 1) : 0, (0.72 + ac.rpm * 0.42) * a.mixer.view.pitch, 'engine');
  a.mixer.view.synth = had ? 0.5 : 1;
}

function reset(sim) {
  S.sign = true;
  S.signSaid = false;
  S.settled = 0;
  S.flown = 0;
  S.init = false;
  S.rate = 0;
  const ac = sim.aircraft;
  if (ac) {
    S.sw.gear = ac.gearDown ? 1 : 0;
    S.sw.flaps = ac.flapsTarget;
    S.sw.locked = ac.gearPos >= 1 ? 1 : 0;
  }
  const v = sim.audio.mixer.view;
  v.gain = 1;
  v.pitch = 1;
  v.cut = 20000;
  v.synth = 1;
}

registerExtension({
  id: 'flight-sound',
  install(sim) {
    if (sim.audio && sim.audio.mixer) sim.audio.fx = S.fx = new FlightFx(sim);
  },
  startMode(sim) {
    reset(sim);
  },
  stop(sim) {
    if (S.fx) S.fx.samples.hush();
    reset(sim);
  },
  update(sim, dt) {
    const ac = sim.aircraft;
    const fx = S.fx;
    if (!fx || !ac || !sim.audio.available || sim.state !== 'flying') return;
    // Only for somebody who can hear it: sound starts off, and a muted class on
    // school wifi must not pay for recordings. A few seconds in, past the flight's own first frames.
    if (!S.asked && !sim.settings.muted) {
      S.asked = true;
      setTimeout(() => fx.samples.load({ limitSeconds: sim.settings.quality === 'low' ? 20 : 40 }), 4000);
    }
    listen(sim, ac, dt);
    switches(sim, ac, fx);
    sign(sim, ac, fx, dt);
    beds(sim, ac, fx);
  },
});
