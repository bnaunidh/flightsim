/**
 * Better sound: the soundscape (./soundscape/layers.js) on the game's own
 * audio, after the menu. This file is the wiring: where the ear is this
 * frame, which other aircraft and cars are round it, and the first-load
 * one-shots (touchdown, gear, flaps, thunder) made richer by wrapping them.
 *
 * Sound starts muted, and while it is muted nothing here is built or run:
 * a class of iPads on mute pays nothing for it. On Low (the iPads' tier) the
 * reverb, the ground's echo and the other traffic are left out.
 */
import { registerExtension } from '../game/extensions.js';
import { heightAt, isPaved, MAP } from '../world/terrain.js';
import { getAircraft } from '../aircraft/types.js';
import { engineFamily } from '../audio/profile.js';
import { bodies } from './sky.js';
import { NEAR } from './flight-sound.js';
import { Soundscape } from './soundscape/layers.js';
import { aspectCos, nearestBodies, bodyVoice, carBed } from './soundscape/maths.js';

/**
 * Wrap the first-load sounds so each one also plays its extra layer. The
 * originals stay as they are (and still play when the soundscape is not
 * built); `unwrap` puts them back exactly.
 */
export function wrap(audio, scape) {
  const amb = audio.ambience;
  const keep = {
    playTouchdown: amb.playTouchdown,
    playGear: amb.playGear,
    playFlaps: amb.playFlaps,
    playThunder: amb.playThunder,
    update: amb.update,
    hush: audio.hush,
    enginePlug: audio.engine.plug,
    jetPlug: audio.jet.plug,
  };
  const live = () => scape.built && !scape.parked && !audio.mixer.frozen;
  amb.playTouchdown = function (impact, surface) {
    keep.playTouchdown.call(this, impact, surface);
    if (live()) scape.touchdown(impact, surface);
  };
  amb.playGear = function (down) {
    keep.playGear.call(this, down);
    if (live()) scape.gear(down);
  };
  amb.playFlaps = function () {
    keep.playFlaps.call(this);
    if (live()) scape.flaps();
  };
  // The first-load rain is one hiss; with the drops on, it is turned down so the hits carry the rain.
  amb.update = function (dt, ac, weather, cloud) {
    keep.update.call(this, dt, ac, weather, cloud);
    if (live() && this.built) scape.duckRain(this, ac, weather, MAP && MAP.precip === 'snow');
  };
  amb.playThunder = function (distance) {
    if (live()) scape.thunder(distance);
    else keep.playThunder.call(this, distance);
  };
  audio.hush = function () {
    keep.hush.call(this);
    scape.silence();
  };
  audio.engine.plug = function (on) {
    keep.enginePlug.call(this, on);
    scape.retap();
  };
  audio.jet.plug = function (on) {
    keep.jetPlug.call(this, on);
    scape.retap();
  };
  for (const f of [amb.playTouchdown, amb.playGear, amb.playFlaps, amb.playThunder]) f.__scape = true;
  return function unwrap() {
    Object.assign(amb, { playTouchdown: keep.playTouchdown, playGear: keep.playGear, playFlaps: keep.playFlaps, playThunder: keep.playThunder, update: keep.update });
    audio.hush = keep.hush;
    audio.engine.plug = keep.enginePlug;
    audio.jet.plug = keep.jetPlug;
  };
}

const S = {
  scape: null,
  ear: null,
  surfT: 0,
  surface: 'grass',
  pickT: 0,
  picked: [],
  prev: new Map(),
  carT: 0,
  cars: { weight: 0, near: Infinity },
  sw: null,
  trimT: 0,
};

const FWD = { x: 0, y: 0, z: -1 };

function fwdOf(ac) {
  if (typeof ac.forward === 'function') {
    if (!S.fwd) S.fwd = ac.pos.clone();
    return ac.forward(S.fwd);
  }
  return FWD;
}

/** Families by type id, worked out once each. */
const FAM = new Map();
function familyOf(id) {
  if (!id) return null;
  if (!FAM.has(id)) {
    let f = null;
    try {
      const t = getAircraft(id);
      f = t ? engineFamily(t) : null;
    } catch (e) {
      f = null;
    }
    FAM.set(id, f);
  }
  return FAM.get(id);
}

/** Where the ear is, and what is round it. */
function listen(sim, dt) {
  const cam = sim.camera && sim.camera.position;
  if (!cam) return null;
  const driving = sim.mode === 'drive';
  const ac = driving ? null : sim.aircraft;
  const ground = Math.max(0, heightAt(cam.x, cam.z) || 0);
  const ear = S.ear || (S.ear = {});
  ear.ac = ac && ac.pos ? ac : null;
  ear.weather = sim.weather;
  ear.cloud = sim.cloudImmersion || 0;
  ear.inside = !!(sim.audio.engine && sim.audio.engine.interior);
  ear.snow = !!(MAP && MAP.precip === 'snow');
  ear.earAgl = cam.y - ground;
  if (ear.ac) {
    const p = ac.pos;
    const dx = cam.x - p.x;
    const dy = cam.y - p.y;
    const dz = cam.z - p.z;
    ear.dist = Math.hypot(dx, dy, dz);
    ear.horiz = Math.hypot(dx, dz);
    ear.near = ear.dist < NEAR;
    const f = fwdOf(ac);
    ear.cos = aspectCos(f.x, f.y, f.z, dx, dy, dz);
    ear.acAgl = Number.isFinite(ac.agl) ? ac.agl : 0;
    S.surfT -= dt;
    if (S.surfT <= 0) {
      S.surfT = 0.5;
      S.surface = heightAt(p.x, p.z) < 0.3 ? 'water' : isPaved(p.x, p.z) ? 'paved' : ear.snow ? 'snow' : 'grass';
    }
    ear.surface = S.surface;
  } else {
    ear.dist = 0;
    ear.horiz = 0;
    ear.near = true;
    ear.cos = 0;
  }

  if (!S.scape.lite) {
    // The other aircraft: who is nearest, twice a second; how fast each is closing, every frame.
    S.pickT -= dt;
    if (S.pickT <= 0) {
      S.pickT = 0.5;
      S.picked = nearestBodies(bodies(), cam.x, cam.y, cam.z, 2, 1800).map((n) => n.b);
    }
    const voices = ear.voices || (ear.voices = []);
    voices.length = 0;
    for (const b of S.picked) {
      if (!b || b.gone || !b.pos) continue;
      const d = Math.hypot(b.pos.x - cam.x, b.pos.y - cam.y, b.pos.z - cam.z);
      const was = S.prev.get(b);
      const raw = was && dt > 0 ? (d - was.d) / dt : 0;
      const rate = was && Math.abs(raw) < 900 ? was.rate + (raw - was.rate) * Math.min(1, dt * 4) : 0;
      S.prev.set(b, { d, rate });
      voices.push({ key: b.id || b, kind: bodyVoice(b, familyOf(b.typeId)), d, rate });
    }
    if (S.prev.size > 16) S.prev.clear();
    // The town's traffic, four times a second, only with the ear near the ground.
    S.carT -= dt;
    if (S.carT <= 0) {
      S.carT = 0.25;
      const list = ear.earAgl < 80 && sim.ambient && typeof sim.ambient.vehicles === 'function' ? sim.ambient.vehicles() : null;
      S.cars = list && list.length ? carBed(list, cam.x, cam.z) : { weight: 0, near: Infinity };
    }
    ear.cars = S.cars;
  }
  return ear;
}

/** The trim wheel ticks, and the levers the first-load switches miss (fuel/start, reversers, reheat). */
function switches(sim, scape, dt) {
  const ac = sim.aircraft;
  const fx = sim.audio.fx;
  if (!ac || !fx) return;
  const w = S.sw || (S.sw = { trim: ac.trim || 0, engine: !!ac.engineOn, rev: (ac.reverse || 0) > 0.5, burner: (ac.burner || 0) > 0.5 });
  const inside = sim.audio.engine.interior;
  const engine = !!ac.engineOn;
  const rev = (ac.reverse || 0) > 0.5;
  const burner = (ac.burner || 0) > 0.5;
  if (inside && (engine !== w.engine || rev !== w.rev || burner !== w.burner)) fx.lever();
  S.trimT -= dt;
  const trim = ac.trim || 0;
  if (Math.abs(trim - w.trim) > 0.004 && S.trimT <= 0) {
    if (inside) scape.tick();
    S.trimT = 0.07;
    w.trim = trim;
  }
  w.engine = engine;
  w.rev = rev;
  w.burner = burner;
}

function liteFor(sim) {
  return !!(sim.settings && sim.settings.quality === 'low');
}

registerExtension({
  id: 'soundscape',
  install(sim) {
    const a = sim.audio;
    if (!a || !a.mixer || !a.ambience || !a.engine || !a.jet) return;
    S.scape = a.scape = new Soundscape(a, { lite: liteFor(sim) });
    S.unwrap = wrap(a, S.scape);
  },
  startMode(sim) {
    if (!S.scape) return;
    S.scape.reset();
    S.sw = null;
    S.picked = [];
    S.prev.clear();
    // Low is chosen in Settings, and a new flight is where it takes: built lite or not, once.
    const lite = liteFor(sim);
    if (!S.scape.built) S.scape.lite = lite;
  },
  stop() {
    if (S.scape) S.scape.silence();
  },
  update(sim, dt) {
    const scape = S.scape;
    if (!scape || !sim.audio.available) return;
    // Muted (how the game starts): nothing built, nothing running. `hold` keeps it on for a check that wants the numbers.
    const muted = (sim.settings && sim.settings.muted) || sim.audio.mixer.muted;
    if (muted && !scape.hold) {
      scape.park();
      return;
    }
    if (!scape.built) scape.build();
    scape.unpark();
    const ear = listen(sim, dt);
    if (!ear) return;
    switches(sim, scape, dt);
    scape.update(dt, ear);
  },
});
