/**
 * Meteor mode.
 *
 * The wishlist said "Add a meteor mode". What that is, for a ten-year-old
 * with an aeroplane: rocks streaking across the sky with glowing tails, most
 * burning up in a pop of sparks, some coming all the way down into the sea or
 * the hills with a proper bang — and a reason to go towards them.
 *
 * Four ways to play it, each a mission in src/game/extra/meteor.js that
 * carries `meteor: { mode }` and turns this on from its onStart:
 *
 *   shower — Meteor Shower. No clock, no way to lose. Burn-ups near you leave
 *            a drifting cloud of gold stars; fly through it to collect the
 *            stardust. Z on a keyboard, the ZAP button on a touch screen,
 *            pops a meteor you are pointing at. Every forty
 *            seconds or so a BIG one comes down somewhere you can see it,
 *            with a warning, a light pillar where it will land and a
 *            countdown, so the bang is something you watch arrive.
 *   dodge  — Rock Dodger. Three minutes. Rocks are aimed at where you WILL
 *            be if you keep flying straight, so turning and climbing is how
 *            you win. Three shields; a hit is a cartoon bonk, not a crash.
 *   town   — Guard the Town. Sixteen rocks in four waves, all heading for the
 *            town. Zap them before they land; five in town and you lose.
 *   photo  — Photograph the Big One. One enormous slow green meteor at night.
 *            Get close, keep it in the picture, and the camera takes a real
 *            photo of the game screen.
 *
 * Tone: a science show, not a disaster film. Nothing hurts anybody. Rocks
 * that land make craters in fields and splashes in the sea; the shower never
 * aims one at the town, and one that does come down in town (Guard the Town)
 * lands as a cartoon thud — dust, stars and a crater, no fire. The town
 * mission counts "bonks", and the words on screen say so.
 *
 * Sound is Web Audio tones and noise, through the game's own mixer and its
 * sliders, and quiet. Spoken lines go through sim.speak() — the radio, which
 * honours the voice setting — and every one of them is also on screen, so
 * the whole mode works with the voices off.
 *
 * Built on explosions.js for every bang and every particle: the trails, the
 * heads and the stardust are the same batched draw calls the bombs use. The
 * rocks themselves are one InstancedMesh (and the giant its own mesh).
 *
 * Everything that makes them visible was measured in the game, not guessed:
 * see spawnBurner() for where they are put so the chase camera sees them,
 * and updateMeteors() for why the trails are solid colour and never thinner
 * than about six pixels.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension, extLayer } from '../game/extensions.js';
import { registerActions, isKey, codesFor, keyName, playerClaimed } from '../flight/input.js';

/* Z, in the one registry: Settings → Controls → Fun Stuff. */
registerActions({
  zap: { label: 'Meteor mode: zap the meteor ahead', group: 'Fun Stuff', ctx: ['plane', 'heli'], default: ['KeyZ'] },
});
import * as FX from './explosions.js';
import { FlashGate, screenOpacity, now as flashNow } from '../render/flash-safety.js';
import * as Terrain from '../world/terrain.js';

const D2R = Math.PI / 180;
const MAX_METEORS = 28;
const MAX_DUST = 12;
const MAX_MARKERS = 6;
const LANDED_CAP = 24;

const ZAP_RANGE = 3500;
const ZAP_CONE = Math.cos(16 * D2R);
const DUST_RADIUS = 85;
const PHOTO_RANGE = 2000;
const PHOTO_CONE_DEG = 13;
// The viewfinder: the middle 55% of the screen across and 60% up and down,
// in normalised device coordinates. It matches the brackets drawn on screen.
const PHOTO_FRAME_X = 0.55;
const PHOTO_FRAME_Y = 0.6;
const PHOTO_HOLD = 1.2;
export const DODGE_SECONDS = 180;
export const TOWN_WAVES = 4;
export const TOWN_PER_WAVE = 4;
export const TOWN_LIMIT = 5;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, t) => a + (b - a) * t;

function safeHeight(x, z) {
  try {
    const h = Terrain.heightAt(x, z);
    return Number.isFinite(h) ? h : 0;
  } catch (e) {
    return 0;
  }
}
const surfaceAt = (x, z) => Math.max(0, safeHeight(x, z));

/* ====================================================================== */
/* State                                                                   */
/* ====================================================================== */

function newMeteor(i) {
  return {
    i, active: false, kind: '', pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(),
    dir: new THREE.Vector3(), speed: 0, radius: 1, size: 1, t: 0, burnY: -1e9,
    impact: new THREE.Vector3(), impactT: 0, hasImpact: false, water: false,
    marker: -1, spin: new THREE.Vector3(), rot: new THREE.Euler(),
    trailAcc: 0, smokeAcc: 0, threat: false, minDist: 1e9, nearMissDone: false,
    stardust: false, town: false, giant: false, big: false, whooshDone: false, warnedNear: false,
  };
}

const S = {
  active: false,
  mode: null,
  missionId: null,
  cfg: null,
  t: 0,
  meteors: Array.from({ length: MAX_METEORS }, (_, i) => newMeteor(i)),
  dust: Array.from({ length: MAX_DUST }, () => ({ active: false, pos: new THREE.Vector3(), t: 0, life: 45, acc: 0 })),
  timers: { burn: 0, land: 0, big: 0, threat: 0, ambient: 0 },
  schedule: [],
  stats: null,
  zapCool: 0,
  invuln: 0,
  photoHold: 0,
  lock: null,
  giant: null,
  beam: { t: 0 },
  lastPhoto: null,
  msgCool: 0,
};

function freshStats() {
  return {
    spawned: 0, burned: 0, landed: 0, zapped: 0, stardust: 0,
    bigSeen: 0, shields: 3, hits: 0, nearMisses: 0, elapsed: 0, survived: false,
    townTotal: TOWN_WAVES * TOWN_PER_WAVE, townResolved: 0, landedTown: 0, townZapped: 0,
    giantSpawned: false, giantLanded: false, photoTaken: false, photoQuality: 0, photoDistance: 0,
  };
}
S.stats = freshStats();

const MODES = {
  shower: { zapper: true, stardust: true, hitPlayer: false, title: 'Meteor shower' },
  dodge: { zapper: false, stardust: false, hitPlayer: true, title: 'Rock dodger' },
  town: { zapper: true, stardust: false, hitPlayer: false, title: 'Guard the town' },
  photo: { zapper: true, stardust: false, hitPlayer: false, title: 'Photo run', giantAt: 7 },
};

let SIM = null;
let G = null; // meshes for this world

/* ====================================================================== */
/* Meshes                                                                  */
/* ====================================================================== */

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _sc = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _c = new THREE.Color();
const _wind = new THREE.Vector3();

function buildMeshes(sim, group) {
  const rockGeo = new THREE.IcosahedronGeometry(1, 1);
  // Squash the sphere a little so a spinning rock visibly tumbles.
  const pa = rockGeo.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i);
    const y = pa.getY(i);
    const z = pa.getZ(i);
    const k = 1 + 0.18 * Math.sin(x * 5.1 + y * 3.7) * Math.cos(z * 4.3);
    pa.setXYZ(i, x * k, y * k * 0.86, z * k);
  }
  rockGeo.computeVertexNormals();
  const flying = new THREE.InstancedMesh(
    rockGeo,
    new THREE.MeshStandardMaterial({ color: 0x4a3a30, emissive: 0xff6a1a, emissiveIntensity: 1.1, roughness: 1, flatShading: true }),
    MAX_METEORS
  );
  flying.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  flying.count = 0;
  flying.frustumCulled = false;
  flying.name = 'meteor-rocks';
  const landed = new THREE.InstancedMesh(
    rockGeo,
    new THREE.MeshStandardMaterial({ color: 0x2f2824, roughness: 1, flatShading: true }),
    LANDED_CAP
  );
  landed.count = 0;
  landed.frustumCulled = false;
  landed.name = 'meteor-landed';

  const markers = [];
  const ringGeo = new THREE.RingGeometry(0.86, 1, 48);
  ringGeo.rotateX(-Math.PI / 2);
  const pillarGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
  pillarGeo.translate(0, 0.5, 0);
  for (let i = 0; i < MAX_MARKERS; i++) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false })
    );
    const inner = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false })
    );
    inner.scale.setScalar(0.45);
    const pillar = new THREE.Mesh(
      pillarGeo,
      new THREE.MeshBasicMaterial({ color: 0xff9a40, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false })
    );
    g.add(ring, inner, pillar);
    g.visible = false;
    group.add(g);
    markers.push({ g, ring, inner, pillar, active: false, t: 0, m: null, radius: 50 });
  }

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5),
    new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
  );
  beam.visible = false;
  beam.frustumCulled = false;

  // The big one in the photo mission is a GREEN meteor; its rock glows green
  // too, which the shared orange-hot material cannot do. One mesh, only ever
  // shown while it is in the sky.
  const giantRock = new THREE.Mesh(
    rockGeo,
    new THREE.MeshStandardMaterial({ color: 0x2c3a30, emissive: 0x3dff8a, emissiveIntensity: 0.9, roughness: 1, flatShading: true })
  );
  giantRock.visible = false;
  giantRock.name = 'meteor-giant';

  group.add(flying, landed, beam, giantRock);
  G = { group, flying, landed, landedNext: 0, landedCount: 0, markers, beam, giantRock };
  // The rocks were made with this world; any in the air belonged to the last one.
  for (const m of S.meteors) m.active = false;
  for (const d of S.dust) d.active = false;
  try {
    if (sim && sim.renderer && sim.camera && sim.renderer.compile) {
      for (const k of markers) k.g.visible = true;
      beam.visible = true;
      giantRock.visible = true;
      flying.count = 1;
      sim.renderer.compile(group, sim.camera, sim.scene);
      flying.count = 0;
      beam.visible = false;
      giantRock.visible = false;
      for (const k of markers) k.g.visible = false;
    }
  } catch (e) {
    /* compiled on first use instead */
  }
}

/* ====================================================================== */
/* Sound                                                                   */
/* ====================================================================== */

function mixer(sim) {
  const a = sim && sim.audio;
  return a && a.available && a.mixer && a.mixer.ctx ? a.mixer : null;
}

/**
 * One note at an exact time on the audio clock. mixer.tone() can only play
 * now, so the second and later notes of a chime used to wait in a
 * setTimeout — which kept counting through a pause and played them over the
 * pause menu. The audio clock stops when the game suspends the mixer.
 */
function noteAt(m, bus, freq, when, duration, gain, type = 'sine') {
  const ctx = m.ctx;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = ctx.createGain();
  const t = Math.max(when, ctx.currentTime);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(g);
  g.connect(m.bus(bus));
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

function sfx(sim, name, level = 1) {
  const m = mixer(sim);
  if (!m) return;
  try {
    const L = clamp(level, 0, 1);
    const now = m.time;
    if (name === 'warn') {
      noteAt(m, 'alerts', 659, now, 0.18, 0.1);
      noteAt(m, 'alerts', 880, now + 0.19, 0.24, 0.1);
    } else if (name === 'warnNear') {
      for (let i = 0; i < 3; i++) noteAt(m, 'alerts', 988, now + i * 0.12, 0.08, 0.09, 'triangle');
    } else if (name === 'zap') {
      m.tone({ bus: 'environment', freq: 1500, sweepTo: 280, duration: 0.17, gain: 0.05, type: 'square' });
      m.noiseBurst({ bus: 'environment', duration: 0.09, gain: 0.04, type: 'bandpass', freq: 3200, q: 1.5 });
    } else if (name === 'fizzle') {
      m.tone({ bus: 'environment', freq: 520, sweepTo: 180, duration: 0.22, gain: 0.035, type: 'sine' });
    } else if (name === 'bonk') {
      m.tone({ bus: 'alerts', freq: 540, sweepTo: 170, duration: 0.3, gain: 0.18, type: 'sine', attack: 0.003 });
      m.tone({ bus: 'alerts', freq: 1080, sweepTo: 340, duration: 0.12, gain: 0.05, type: 'triangle' });
      m.noiseBurst({ bus: 'alerts', duration: 0.16, gain: 0.08, type: 'lowpass', freq: 700 });
    } else if (name === 'collect') {
      [1046.5, 1318.5, 1568, 2093].forEach((f, i) => noteAt(m, 'alerts', f, now + i * 0.07, 0.22, 0.07));
    } else if (name === 'whoosh') {
      const n = m.noiseBurst({ bus: 'environment', duration: 1.1, gain: 0.16 * L, type: 'bandpass', freq: 2400, q: 1.3, attack: 0.25 });
      if (n && n.filter) {
        const t = m.time;
        n.filter.frequency.setValueAtTime(2400, t);
        n.filter.frequency.exponentialRampToValueAtTime(260, t + 1.1);
      }
    } else if (name === 'rumble') {
      m.noiseBurst({ bus: 'environment', duration: 7, gain: 0.22 * L, type: 'lowpass', freq: 85, q: 0.7, attack: 2.2, pink: true });
    } else if (name === 'shutter') {
      m.noiseBurst({ bus: 'alerts', duration: 0.035, gain: 0.12, type: 'highpass', freq: 2500, attack: 0.001 });
      m.noiseBurst({ bus: 'alerts', duration: 0.05, gain: 0.1, type: 'highpass', freq: 1800, attack: 0.001, when: now + 0.095 });
    } else if (name === 'win') {
      [784, 988, 1175, 1568].forEach((f, i) => noteAt(m, 'alerts', f, now + i * 0.11, 0.3, 0.08, 'triangle'));
    }
  } catch (e) {
    /* never let a sound cost a frame */
  }
}

/* ====================================================================== */
/* Spawning                                                                */
/* ====================================================================== */

function freeMeteor() {
  for (const m of S.meteors) if (!m.active) return m;
  return null;
}

function activeCount() {
  let n = 0;
  for (const m of S.meteors) if (m.active) n++;
  return n;
}

/**
 * Put a meteor on a straight line that passes through `target` after `T`
 * seconds. Straight, not ballistic: at these speeds gravity bends the path by
 * a few metres, and a path you can predict is a path the warnings can be
 * honest about.
 *
 * @param {object} o { target, az (deg, the way it travels), dive (deg below
 *   horizontal), speed, T, radius, size, burn, kind, ... }
 */
export function spawnMeteor(o) {
  const m = freeMeteor();
  if (!m) return null;
  m.active = true;
  m.kind = o.kind || 'lander';
  m.t = 0;
  m.radius = o.radius || 2;
  m.size = o.size || 1.5;
  m.speed = o.speed || 250;
  m.threat = !!o.threat;
  m.stardust = !!o.stardust;
  m.town = !!o.town;
  m.giant = !!o.giant;
  m.big = !!o.big || m.giant;
  m.minDist = 1e9;
  m.nearMissDone = false;
  m.whooshDone = false;
  m.warnedNear = false;
  m.trailAcc = 0;
  m.smokeAcc = 0;
  m.marker = -1;
  const az = o.az * D2R;
  const dv = o.dive * D2R;
  m.dir.set(Math.sin(az) * Math.cos(dv), -Math.sin(dv), -Math.cos(az) * Math.cos(dv));
  m.vel.copy(m.dir).multiplyScalar(m.speed);
  m.pos.copy(o.target).addScaledVector(m.dir, -m.speed * o.T);
  m.prev.copy(m.pos);
  m.spin.set(rand(-2, 2), rand(-2, 2), rand(-2, 2));
  m.rot.set(rand(0, 6), rand(0, 6), rand(0, 6));
  m.burnY = o.burn ? o.target.y : -1e9;
  if (o.burn) {
    m.hasImpact = false;
  } else {
    predictImpact(m);
  }
  S.stats.spawned++;
  return m;
}

/** Walk the line until it meets the ground or the sea; refine by halving. */
export function predictImpact(m) {
  const step = 30;
  const maxT = 400;
  let lo = 0;
  let hi = -1;
  for (let d = step; d < m.speed * maxT; d += step) {
    const x = m.pos.x + m.dir.x * d;
    const y = m.pos.y + m.dir.y * d;
    const z = m.pos.z + m.dir.z * d;
    if (y <= surfaceAt(x, z)) {
      hi = d;
      break;
    }
    lo = d;
    if (y < -50) break;
  }
  if (hi < 0) {
    m.hasImpact = false;
    return false;
  }
  for (let k = 0; k < 8; k++) {
    const mid = (lo + hi) / 2;
    const y = m.pos.y + m.dir.y * mid;
    if (y <= surfaceAt(m.pos.x + m.dir.x * mid, m.pos.z + m.dir.z * mid)) hi = mid;
    else lo = mid;
  }
  m.impact.set(m.pos.x + m.dir.x * hi, 0, m.pos.z + m.dir.z * hi);
  const gh = safeHeight(m.impact.x, m.impact.z);
  m.water = gh <= 0;
  m.impact.y = Math.max(0, gh);
  m.impactT = hi / m.speed;
  m.hasImpact = true;
  return true;
}

function headingVec(deg, out) {
  return out.set(Math.sin(deg * D2R), 0, -Math.cos(deg * D2R));
}

/** Shortest distance from point p to the segment a→b. */
function segDist(p, a, b) {
  _v.subVectors(b, a);
  const len2 = _v.lengthSq();
  let t = len2 > 0 ? _v2.subVectors(p, a).dot(_v) / len2 : 0;
  t = clamp(t, 0, 1);
  _v3.copy(a).addScaledVector(_v, t);
  return _v3.distanceTo(p);
}

function player(sim) {
  return sim && sim.aircraft ? sim.aircraft : null;
}

/**
 * How close a meteor starting at `start` and flying `dir` at `speed` for `T`
 * seconds comes to the aeroplane, if the aeroplane carries on as it is: the
 * closest approach of two straight paths, in time. Checking only where a
 * meteor LANDS let a big one's path cross the aeroplane on its way down —
 * 48 m, seed 86 of the node suite's sweep, in the mode that promises
 * nothing comes near you.
 */
function closestApproach(ac, start, dir, speed, T) {
  const v = ac.vel;
  const rx = start.x - ac.pos.x;
  const ry = start.y - ac.pos.y;
  const rz = start.z - ac.pos.z;
  const vx = dir.x * speed - (v ? v.x : 0);
  const vy = dir.y * speed - (v ? v.y : 0);
  const vz = dir.z * speed - (v ? v.z : 0);
  const vv = vx * vx + vy * vy + vz * vz;
  const t = clamp(vv > 0 ? -(rx * vx + ry * vy + rz * vz) / vv : 0, 0, T);
  return Math.hypot(rx + vx * t, ry + vy * t, rz + vz * t);
}

function dirOf(az, dive, out) {
  return out.set(Math.sin(az * D2R) * Math.cos(dive * D2R), -Math.sin(dive * D2R), -Math.cos(az * D2R) * Math.cos(dive * D2R));
}

/*
 * Where the burners go. They were spread round the whole sky, 0.9–8 km out
 * and up to 4 km high, coming down at up to forty degrees from a start
 * point a kilometre and a half further up. Measured in the game at sunset,
 * 14 s into the shower: five meteors in the air and not one of them on the
 * screen — the chase camera looks ten degrees DOWN at the aeroplane and
 * shows nothing above about +24 degrees, and every one of them was above
 * that or behind. "Look up!" said the mission, to a camera that cannot.
 *
 * So they are put where the camera is looking: ahead, within about fifty
 * degrees of the nose, ending two to fourteen degrees above the horizon,
 * travelling ACROSS the line of sight at a shallow dive, so each one draws
 * a long streak through the part of the sky that is actually on screen.
 * The near ones — the ones that leave stardust — end 0.7–1.5 km ahead at
 * about your own height, which is somewhere you can fly to.
 */
function spawnBurner(sim, near) {
  const ac = player(sim);
  if (!ac) return null;
  const hdg = ac.heading || 0;
  const target = new THREE.Vector3();
  for (let tries = 0; tries < 6; tries++) {
    let dive;
    let speed;
    let T;
    let b;
    if (near) {
      b = hdg + rand(-35, 35);
      const dist = rand(700, 1500);
      headingVec(b, target).multiplyScalar(dist).add(ac.pos);
      target.y = clamp(ac.pos.y + rand(-40, 160), surfaceAt(target.x, target.z) + 150, 3500);
      dive = rand(12, 26);
      speed = rand(180, 260);
      T = rand(2.5, 4);
    } else {
      b = hdg + rand(-50, 50);
      const dist = rand(2500, 7000);
      headingVec(b, target).multiplyScalar(dist).add(ac.pos);
      target.y = clamp(ac.pos.y + dist * Math.tan(rand(2, 14) * D2R), surfaceAt(target.x, target.z) + 300, 4500);
      dive = rand(10, 28);
      speed = rand(250, 380);
      T = rand(3, 5);
    }
    // Across the line of sight, one way or the other.
    const az = b + (Math.random() < 0.5 ? 1 : -1) * rand(60, 120);
    // Never through the aeroplane on its way in: this mode is for watching.
    // Against where the aeroplane WILL be, not where it is: it flies 300 m
    // while a burner crosses the sky.
    dirOf(az, dive, _fwd);
    const start = _v3.copy(target).addScaledVector(_fwd, -speed * T);
    // Six goes at it; if none is clear, no burner this time (the next is a
    // second or two away) rather than one through the cockpit.
    if (closestApproach(ac, start, _fwd, speed, T) < 350) continue;
    return spawnMeteor({
      kind: 'burner', target, az, dive, speed, T, burn: true,
      radius: near ? rand(1.2, 2.2) : rand(1.5, 3), size: 0.6,
      stardust: near && S.cfg && S.cfg.stardust && Math.random() < 0.75,
    });
  }
  return null;
}

function awayFromPlayer(sim, p, T, clear) {
  const ac = player(sim);
  if (!ac) return true;
  if (Math.hypot(p.x - ac.pos.x, p.z - ac.pos.z) < clear) return false;
  const fx = ac.pos.x + ac.vel.x * T;
  const fz = ac.pos.z + ac.vel.z * T;
  return Math.hypot(p.x - fx, p.z - fz) >= clear;
}

function spawnLander(sim, big) {
  const ac = player(sim);
  if (!ac) return null;
  const hdg = ac.heading || 0;
  const target = new THREE.Vector3();
  const T = big ? rand(16, 20) : rand(8, 12);
  let ok = false;
  let az = 0;
  let dive = 0;
  let speed = 0;
  for (let tries = 0; tries < (big ? 16 : 10) && !ok; tries++) {
    // In front, for the same reason as the burners: one that lands behind you is one you never saw.
    const b = hdg + (big ? rand(-40, 40) : rand(-60, 60));
    const dist = big ? rand(1600, 3200) : rand(1600, 5000);
    headingVec(b, target).multiplyScalar(dist).add(ac.pos);
    // Fields, hills and sea — never the town, which has its own mission.
    if (!awayFromPlayer(sim, target, T, big ? 900 : 700) || inTown(target.x, target.z, big ? 1.8 : 1.4)) continue;
    target.y = surfaceAt(target.x, target.z);
    az = rand(0, 360);
    dive = big ? rand(24, 34) : rand(30, 55);
    speed = big ? rand(140, 170) : rand(200, 290);
    // And not through you on the way down, either.
    dirOf(az, dive, _fwd);
    _v3.copy(target).addScaledVector(_fwd, -speed * T);
    ok = closestApproach(ac, _v3, _fwd, speed, T) >= (big ? 450 : 300);
  }
  if (!ok) return null;
  const m = spawnMeteor({
    kind: big ? 'big' : 'lander', target, big, az, dive, speed, T,
    radius: big ? rand(7, 10) : rand(1.8, 3.2), size: big ? rand(3.5, 4.5) : rand(1.3, 2.2),
  });
  if (m && big) warnBig(sim, m);
  return m;
}

function spawnThreat(sim, progress) {
  const ac = player(sim);
  if (!ac) return null;
  const hdg = ac.heading || 0;
  const T = lerp(7.5, 5.5, progress) * rand(0.9, 1.1);
  // Where you will be if you keep doing what you are doing.
  _v.copy(ac.vel);
  if (_v.length() > 120) _v.setLength(120);
  const P = new THREE.Vector3().copy(ac.pos).addScaledVector(_v, T);
  P.y = Math.max(P.y, surfaceAt(P.x, P.z) + 120);
  const front = Math.random() < 0.6;
  const az = front ? hdg + 180 + rand(-55, 55) : hdg + (Math.random() < 0.5 ? 90 : -90) + rand(-30, 30);
  const dive = rand(30, 50);
  // Some straight at that point, most close by: fly straight and you will be
  // bonked now and then; turn or climb and you will watch them go past.
  const direct = Math.random() < lerp(0.22, 0.38, progress);
  const miss = direct ? rand(0, 8) : rand(35, 100);
  const dir = new THREE.Vector3(Math.sin(az * D2R) * Math.cos(dive * D2R), -Math.sin(dive * D2R), -Math.cos(az * D2R) * Math.cos(dive * D2R));
  const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
  side.applyAxisAngle(dir, rand(0, Math.PI * 2));
  P.addScaledVector(side, miss);
  return spawnMeteor({
    kind: 'threat', target: P, az, dive, speed: rand(190, 250), T,
    radius: rand(3, 4.5), size: 1.6, threat: true,
  });
}

function townInfo() {
  const t = Terrain.MAP && Terrain.MAP.scenery && Terrain.MAP.scenery.town;
  if (t) return { x: t.cx, z: t.cz, r: t.radius || 400 };
  const i = Terrain.ISLANDS && Terrain.ISLANDS[0];
  return i ? { x: i.cx + i.radius * 0.3, z: i.cz + i.radius * 0.25, r: 400 } : { x: 700, z: 620, r: 420 };
}

/** Inside the town (with a margin, as a multiple of its radius)? */
function inTown(x, z, k = 1.1) {
  const t = townInfo();
  return Math.hypot(x - t.x, z - t.z) < t.r * k;
}

function buildTownSchedule() {
  const town = townInfo();
  const out = [];
  for (let w = 0; w < TOWN_WAVES; w++) {
    for (let k = 0; k < TOWN_PER_WAVE; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * town.r * 0.7;
      const from = 45 + rand(-35, 35);
      out.push({
        at: 8 + w * 40 + k * 7 + rand(-1, 1),
        x: town.x + Math.cos(a) * r,
        z: town.z + Math.sin(a) * r,
        az: from + 180,
        // Shallow, so they come in low over the sea towards you and not from
        // thirty degrees overhead, where the chase camera cannot see them
        // and the aeroplane has to stand on its tail to point at one.
        dive: rand(14, 20),
        speed: rand(150, 175),
        T: 24,
        spawned: false,
      });
    }
  }
  return out;
}

function spawnGiant(sim) {
  const ac = player(sim);
  if (!ac) return null;
  const h = ac.heading || 0;
  const fwd = headingVec(h, new THREE.Vector3());
  const right = headingVec(h + 90, new THREE.Vector3());
  const want = new THREE.Vector3().copy(ac.pos).addScaledVector(fwd, 5200).addScaledVector(right, -1200);
  /*
   * It has to come down in the sea — that splash is the ending — and at
   * eleven degrees its last kilometre is barely two hundred metres up, so a
   * spot that is sea is not enough: the line in has to clear the land too.
   * Each candidate is flown for real through predictImpact() and kept only
   * if it arrives where it was sent.
   */
  let m = null;
  const spot = new THREE.Vector3();
  const giant = (az) => spawnMeteor({ kind: 'giant', target: spot, az, dive: 11, speed: 85, T: 100, radius: 38, size: 6, giant: true });
  search: for (let r = 0; r <= 4800; r += 400) {
    for (let k = 0; k < (r ? 14 : 1); k++) {
      const a = (k / 14) * Math.PI * 2;
      spot.set(want.x + Math.cos(a) * r, 0, want.z + Math.sin(a) * r);
      if (safeHeight(spot.x, spot.z) > -4) continue;
      for (const turn of [0, 25, -25]) {
        const c = giant(h - 90 + turn);
        if (!c) break search;
        if (c.hasImpact && c.water && Math.hypot(c.impact.x - spot.x, c.impact.z - spot.z) < 60) {
          m = c;
          break search;
        }
        c.active = false;
        S.stats.spawned--;
      }
    }
  }
  // A map with no clear sea in reach still gets its giant, wherever it lands:
  // a mission that waits for a meteor that never comes is the worst outcome.
  if (!m) {
    spot.copy(want).setY(surfaceAt(want.x, want.z));
    m = giant(h - 90);
  }
  S.stats.giantSpawned = true;
  if (!m) return null;
  S.giant = m;
  S.stats.giantSpawned = true;
  addMarker(m, 260);
  sim.speak && sim.speak('There it is, off your right — the big one! Get close and keep it in the picture.', 'tower', 0);
  sim.hud && sim.hud.notify('The giant meteor is up — off your right. Fly towards it!', 'warn', 6);
  sfx(sim, 'warn');
  return m;
}

/* ====================================================================== */
/* Warnings and markers                                                    */
/* ====================================================================== */

function addMarker(m, radius) {
  if (!G) return -1;
  const i = G.markers.findIndex((k) => !k.active);
  if (i < 0) return -1;
  const k = G.markers[i];
  k.active = true;
  k.t = 0;
  k.m = m;
  k.radius = radius;
  k.g.position.set(m.impact.x, m.impact.y + 1.5, m.impact.z);
  k.ring.scale.setScalar(radius);
  k.pillar.scale.set(Math.max(4, radius * 0.06), 900, Math.max(4, radius * 0.06));
  k.g.visible = true;
  m.marker = i;
  return i;
}

function dropMarker(m) {
  if (!G || m.marker < 0) return;
  const k = G.markers[m.marker];
  if (k) {
    k.active = false;
    k.m = null;
    k.g.visible = false;
  }
  m.marker = -1;
}

/** How far out the landing marker is drawn: twice the fireball, from the one formula explosions.js uses. */
function blastRadius(m) {
  return (FX.blastRadius ? FX.blastRadius(m.size) : 11 * Math.pow(m.size, 0.75)) * 2;
}

function warnBig(sim, m) {
  S.stats.bigSeen++;
  addMarker(m, blastRadius(m));
  const ac = player(sim);
  const d = ac && m.hasImpact ? Math.hypot(m.impact.x - ac.pos.x, m.impact.z - ac.pos.z) : 0;
  sim.hud && sim.hud.notify(
    `Big meteor! It lands about ${(d / 1000).toFixed(1)} km away in ${Math.round(m.impactT)} s — follow the orange light`,
    'warn', 5
  );
  sfx(sim, 'warn');
}

/** Clock position of a world point relative to the nose, like the tornado warning. */
function clockOf(ac, x, z) {
  let brg = Math.atan2(x - ac.pos.x, -(z - ac.pos.z)) / D2R;
  if (brg < 0) brg += 360;
  const rel = ((brg - (ac.heading || 0) + 540) % 360) - 180;
  return Math.round(((rel + 360) % 360) / 30) || 12;
}

/* ====================================================================== */
/* Per-frame                                                               */
/* ====================================================================== */

function windOf(sim) {
  try {
    if (sim.weather && sim.weather.windVector) return sim.weather.windVector(_wind);
  } catch (e) {
    /* fall through */
  }
  return _wind.set(0, 0, 0);
}

const HEAD = [1, 0.95, 0.8];
const HEAD_GIANT = [0.72, 1, 0.84];
const TRAIL_GIANT = [0.55, 1, 0.72];

function updateMeteors(sim, dt) {
  const ac = player(sim);
  const cam = sim.camera ? sim.camera.position : null;
  const P = FX.PARTICLES;
  let live = 0;
  let giantSeen = false;
  for (const m of S.meteors) {
    if (!m.active) continue;
    m.prev.copy(m.pos);
    m.pos.addScaledVector(m.vel, dt);
    m.t += dt;
    m.rot.x += m.spin.x * dt;
    m.rot.y += m.spin.y * dt;
    m.rot.z += m.spin.z * dt;

    if (m.burnY > -1e8 && m.pos.y <= m.burnY) {
      burnUp(sim, m);
      continue;
    }
    const gh = safeHeight(m.pos.x, m.pos.z);
    const surf = gh > 0 ? gh : 0;
    if (m.pos.y <= surf) {
      land(sim, m, surf, gh <= 0);
      continue;
    }
    if (m.t > 240 || m.pos.y < -60) {
      kill(m);
      continue;
    }

    const dCam = cam ? m.pos.distanceTo(cam) : 1000;
    if (ac && S.cfg.hitPlayer && m.threat) {
      checkHit(sim, m, ac);
      if (!m.active) continue;
    }
    if (!m.whooshDone && dCam < (m.giant ? 2600 : 700)) {
      m.whooshDone = true;
      sfx(sim, m.giant ? 'rumble' : 'whoosh', 1 - dCam / (m.giant ? 2600 : 700) + 0.2);
    }

    /*
     * The trail: puffs laid along the path behind the head, spaced by
     * distance travelled so a fast one is a streak and not a dotted line.
     *
     * It was all additive glow, 0.0028 × distance at the smallest — two
     * pixels at 5 km — and additive light on a bright sunset sky adds up to
     * nothing: the first shower flown in the game had meteors on the screen
     * that could not be seen. Now the body of the trail is SOLID hot colour
     * (white to orange, the smoke batch's ordinary blending), never thinner
     * than about six pixels, with a thinner additive glow over it that is
     * what shows at night. Far ones keep their tail longer, so the streak
     * stays a streak on screen and not a dot.
     */
    const minVis = dCam * 0.009;
    const tSize = Math.max(m.radius * (m.giant ? 2.6 : 3.4), minVis);
    // The giant is slow (85 m/s) and enormous: spaced like the others it laid
    // two puffs a second and had no tail at all. It gets a close-packed one.
    const spacing = Math.max(3, tSize * (m.giant ? 0.12 : 0.35));
    const d = m.speed * dt;
    m.trailAcc += d;
    let k = 0;
    const tr = m.giant ? TRAIL_GIANT : null;
    const tLife = (m.giant ? 7 : m.kind === 'burner' ? 0.7 : 0.9) + Math.min(1.2, dCam / 4000);
    while (m.trailAcc >= spacing && k < 12) {
      m.trailAcc -= spacing;
      k++;
      const back = m.trailAcc;
      const x = m.pos.x - m.dir.x * back;
      const y = m.pos.y - m.dir.y * back;
      const z = m.pos.z - m.dir.z * back;
      FX.fxParticle(sim, P.hotTrail, x, y, z, rand(-1, 1), rand(-0.5, 1), rand(-1, 1), tSize, tLife, 1,
        tr ? tr[0] : -1, tr ? tr[1] : -1, tr ? tr[2] : -1);
      if (k % 2 === 1) {
        FX.fxParticle(sim, P.trail, x, y, z, rand(-2, 2), rand(-1, 2), rand(-2, 2), tSize * 1.8, tLife * 0.8, 0.55,
          tr ? tr[0] : -1, tr ? tr[1] : -1, tr ? tr[2] : -1);
      }
    }
    if (k === 12) m.trailAcc = 0;
    // The smoke train that hangs in the sky after it has gone.
    m.smokeAcc += d;
    const sSpace = Math.max(22, m.radius * 4, tSize * 0.6);
    let j = 0;
    while (m.smokeAcc >= sSpace && j < 4) {
      m.smokeAcc -= sSpace;
      j++;
      FX.fxParticle(sim, P.trailSmoke, m.pos.x - m.dir.x * m.smokeAcc, m.pos.y - m.dir.y * m.smokeAcc, m.pos.z - m.dir.z * m.smokeAcc,
        0, 0, 0, Math.max(m.radius * 1.3 + 2, minVis * 0.9), m.giant ? 3 : 1, m.giant ? 1.4 : 1);
    }
    if (j === 4) m.smokeAcc = 0;
    // The head, re-made every frame: a solid white-hot core, and a wide
    // additive halo round it.
    const hc = m.giant ? HEAD_GIANT : HEAD;
    // The giant's core is smaller than its rock, so the tumbling rock shows
    // inside its own glow — it is the thing being photographed.
    FX.fxParticle(sim, P.hotHead, m.pos.x, m.pos.y, m.pos.z, 0, 0, 0, m.giant ? m.radius * 1.7 : Math.max(m.radius * 3, dCam * 0.013), 1, m.giant ? 0.55 : 1, hc[0], hc[1], hc[2]);
    FX.fxParticle(sim, P.head, m.pos.x, m.pos.y, m.pos.z, 0, 0, 0, Math.max(m.radius * (m.giant ? 7 : 12), dCam * 0.04), 1, m.giant ? 0.4 : 0.5,
      m.giant ? 0.4 : 1, m.giant ? 1 : 0.6, m.giant ? 0.6 : 0.25);
    // And it sheds burning bits, which is most of what makes it look huge.
    if (m.giant && Math.random() < dt * 14) {
      FX.fxParticle(sim, P.ember, m.pos.x + rand(-1, 1) * m.radius, m.pos.y + rand(-0.5, 1) * m.radius, m.pos.z + rand(-1, 1) * m.radius,
        -m.vel.x * 0.3 + rand(-15, 15), rand(-5, 10), -m.vel.z * 0.3 + rand(-15, 15), rand(4, 8), rand(1.5, 2.5), 1, 0.6, 1, 0.7);
    }

    if (G && m.giant) {
      giantSeen = true;
      G.giantRock.position.copy(m.pos);
      G.giantRock.rotation.copy(m.rot);
      G.giantRock.scale.setScalar(m.radius);
      continue;
    }
    if (G) {
      _q.setFromEuler(m.rot);
      _sc.setScalar(m.radius);
      _m4.compose(m.pos, _q, _sc);
      G.flying.setMatrixAt(live, _m4);
    }
    live++;
  }
  if (G) {
    G.flying.count = live;
    if (live) G.flying.instanceMatrix.needsUpdate = true;
    if (G.giantRock.visible !== giantSeen) G.giantRock.visible = giantSeen;
  }
}

function kill(m) {
  dropMarker(m);
  m.active = false;
  if (S.giant === m) S.giant = null;
  if (S.lock === m) S.lock = null;
}

function burnUp(sim, m) {
  const cam = sim.camera ? sim.camera.position : m.pos;
  const d = m.pos.distanceTo(cam);
  FX.explode(sim, m.pos, { size: clamp(m.radius * 0.35, 0.3, 1.1), kind: 'airburst', burnup: true, silent: d > 1500 });
  S.stats.burned++;
  if (m.stardust) addDust(m.pos);
  kill(m);
}

function land(sim, m, surf, water) {
  const x = m.pos.x;
  const z = m.pos.z;
  const townHit = inTown(x, z);
  _v.set(x, surf, z);
  /*
   * Among the houses it is a thud — dust, dirt, stars and a crater with the
   * rock in it — not a fireball. Guard the Town, left alone, put four full
   * meteor blasts into the town in a minute: fire and black smoke over the
   * roofs, in a mission whose words were all "bonk".
   */
  FX.explode(sim, _v, { size: m.size, kind: 'meteor', gentle: townHit && !water });
  S.stats.landed++;
  if (!water && G) {
    // The rock itself, cooled, half sunk in its crater.
    const i = G.landedNext;
    G.landedNext = (G.landedNext + 1) % LANDED_CAP;
    G.landedCount = Math.min(LANDED_CAP, G.landedCount + 1);
    _q.setFromEuler(m.rot);
    _sc.setScalar(m.radius * 0.85);
    _m4.compose(_v.set(x, surf + m.radius * 0.25, z), _q, _sc);
    G.landed.setMatrixAt(i, _m4);
    G.landed.count = G.landedCount;
    G.landed.instanceMatrix.needsUpdate = true;
  }
  if (m.town) {
    S.stats.townResolved++;
    if (townHit) {
      S.stats.landedTown++;
      sim.hud && sim.hud.notify(`Bonk! One landed in town — ${S.stats.landedTown} of ${TOWN_LIMIT}`, 'warn', 3.5);
    }
  }
  if (m.giant) {
    S.stats.giantLanded = true;
    sim.hud && sim.hud.notify('SPLASHDOWN! What a splash.', 'good', 5);
  }
  kill(m);
}

function checkHit(sim, m, ac) {
  const d = segDist(ac.pos, m.prev, m.pos);
  if (d < m.minDist) m.minDist = d;
  // Out of shields is the end of the round; a rock already on its way does
  // not get to count a fourth bonk against nothing.
  if (d < m.radius + 9 && S.invuln <= 0 && S.stats.shields > 0) {
    // Bonk: a shield gone, the rock shatters — fragments and smoke, not a
    // fireball (rock is not fuel). Nobody is hurt.
    S.invuln = 2;
    S.stats.hits++;
    S.stats.shields = Math.max(0, S.stats.shields - 1);
    FX.explode(sim, m.pos, { size: 0.8, kind: 'shatter' });
    sfx(sim, 'bonk');
    if (sim.rig && sim.rig.kick) sim.rig.kick(1.1);
    flashScreen('bonk');
    sim.hud && sim.hud.notify(
      S.stats.shields > 0 ? `BONK! Shield lost — ${S.stats.shields} left` : 'BONK! That was your last shield',
      'warn', 3
    );
    kill(m);
    return;
  }
  if (!m.nearMissDone && m.minDist < 110 && d > m.minDist + 45) {
    m.nearMissDone = true;
    S.stats.nearMisses++;
    sfx(sim, 'whoosh', 1);
    sim.hud && sim.hud.notify(`Close shave! ${Math.round(m.minDist)} m`, 'good', 2);
  }
}

/* ---- Stardust ---- */

function addDust(pos) {
  let d = S.dust.find((k) => !k.active);
  if (!d) {
    d = S.dust[0];
    for (const k of S.dust) if (k.t > d.t) d = k;
  }
  d.active = true;
  d.pos.copy(pos);
  d.t = 0;
  d.life = 45;
  d.acc = 0;
}

function updateDust(sim, dt) {
  const ac = player(sim);
  const cam = sim.camera ? sim.camera.position : null;
  const w = windOf(sim);
  const P = FX.PARTICLES;
  for (const d of S.dust) {
    if (!d.active) continue;
    d.t += dt;
    if (d.t > d.life) {
      d.active = false;
      continue;
    }
    d.pos.addScaledVector(w, dt * 0.6);
    const fade = Math.min(1, (d.life - d.t) / 5, d.t / 0.8);
    const dCam = cam ? d.pos.distanceTo(cam) : 500;
    /*
     * Gold stars, not a glow. Seen in the game from 260 m, the cloud was a
     * white sun with a few specks round it — 3–6 m sparkles are four pixels
     * there — and "fly through the gold sparkles" pointed at something that
     * looked like neither. The stars are bigger, never under about six
     * pixels, drawn solid (explosions.js's star batch) so gold stays gold on
     * a sunset sky, and the glow in the middle is a pale halo behind them.
     */
    const sMin = dCam * 0.009;
    d.acc += dt * 38;
    while (d.acc >= 1) {
      d.acc -= 1;
      const u = rand(-1, 1);
      const a = Math.random() * Math.PI * 2;
      const r = Math.cbrt(Math.random()) * 42;
      const rr = Math.sqrt(1 - u * u) * r;
      // Mostly gold; some white, which is what shows against an orange sky;
      // a few sky-blue, which is what shows against the sea.
      const pick = Math.random();
      if (pick < 0.55) _c.setHSL(rand(0.11, 0.15), 1, 0.58);
      else if (pick < 0.8) _c.setRGB(1, 0.98, 0.9);
      else _c.setHSL(0.53, 0.9, 0.66);
      FX.fxParticle(sim, P.twinkle, d.pos.x + Math.cos(a) * rr, d.pos.y + u * r, d.pos.z + Math.sin(a) * rr,
        0, 0.5, 0, Math.max(rand(9, 15), sMin * rand(1.2, 2)), 1, fade, _c.r, _c.g, _c.b);
    }
    // A pale gold halo in the middle that stays visible from a long way off,
    // like a star you can fly to.
    FX.fxParticle(sim, P.head, d.pos.x, d.pos.y, d.pos.z, 0, 0, 0, Math.max(70, dCam * 0.03), 1, 0.28 * fade, 1, 0.78, 0.3);
    if (ac && ac.pos.distanceTo(d.pos) < DUST_RADIUS) {
      d.active = false;
      S.stats.stardust++;
      FX.explode(sim, ac.pos, { size: 0.6, kind: 'sparkle', silent: true });
      sfx(sim, 'collect');
      sim.hud && sim.hud.notify(`Stardust! ${S.stats.stardust} collected`, 'good', 2.2);
    }
  }
}

export function nearestStardust(from) {
  let best = null;
  let bd = Infinity;
  for (const d of S.dust) {
    if (!d.active) continue;
    const k = from ? d.pos.distanceToSquared(from) : 0;
    if (k < bd) {
      bd = k;
      best = d.pos;
    }
  }
  return best;
}

/* ---- Markers ---- */

function updateMarkers(dt) {
  if (!G) return;
  for (const k of G.markers) {
    if (!k.active) continue;
    k.t += dt;
    const m = k.m;
    if (!m || !m.active) {
      k.active = false;
      k.g.visible = false;
      continue;
    }
    // Faster pulse as it gets closer to landing.
    const left = Math.max(0, m.impactT - m.t);
    const rate = left < 5 ? 9 : left < 10 ? 5 : 3;
    const p = 0.5 + 0.5 * Math.sin(k.t * rate);
    k.ring.material.opacity = 0.45 + 0.45 * p;
    k.inner.material.opacity = 0.25 + 0.35 * (1 - p);
    k.inner.scale.setScalar(k.radius * (0.25 + 0.45 * ((k.t * 0.6) % 1)));
    k.pillar.material.opacity = 0.14 + 0.12 * p;
  }
}

/* ---- Zapper ---- */

function findZapTarget(sim) {
  const ac = player(sim);
  if (!ac) return null;
  _fwd.set(0, 0, -1).applyQuaternion(ac.quat);
  let best = null;
  let bestScore = -Infinity;
  for (const m of S.meteors) {
    if (!m.active) continue;
    _v.subVectors(m.pos, ac.pos);
    const dist = _v.length();
    if (dist > ZAP_RANGE + m.radius || dist < 1) continue;
    const c = _v.dot(_fwd) / dist;
    if (c < ZAP_CONE) continue;
    // Prefer the one nearest the middle of the view, then the nearer one.
    const score = c * 4 - dist / ZAP_RANGE;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

export function zap(sim) {
  if (!S.active || !S.cfg || !S.cfg.zapper) return false;
  const ac = player(sim);
  if (!ac || S.zapCool > 0) return false;
  S.zapCool = 0.45;
  const t = findZapTarget(sim);
  _fwd.set(0, 0, -1).applyQuaternion(ac.quat);
  const from = _v2.copy(ac.pos).addScaledVector(_fwd, 6);
  const to = t ? _v3.copy(t.pos) : _v3.copy(ac.pos).addScaledVector(_fwd, 1400);
  showBeam(from, to);
  sfx(sim, 'zap');
  if (!t) {
    if (S.msgCool <= 0) {
      S.msgCool = 4;
      sim.hud && sim.hud.notify('Missed — point your nose at a meteor, then zap', 'info', 2.4);
    }
    return false;
  }
  if (t.giant) {
    sim.hud && sim.hud.notify('Far too big to zap — take its picture instead!', 'info', 3);
    sfx(sim, 'fizzle');
    return false;
  }
  FX.explode(sim, t.pos, { size: clamp(t.radius * 0.45, 0.6, 2.2), kind: 'shatter' });
  S.stats.zapped++;
  if (t.town) {
    // Counted apart from `zapped`: the everyday meteors in the evening sky
    // can be zapped too, and they are not rocks the town was saved from.
    S.stats.townResolved++;
    S.stats.townZapped++;
    sim.hud && sim.hud.notify(`Zapped! ${S.stats.townZapped} saved`, 'good', 2);
  } else if (S.stats.zapped % 5 === 0 || S.stats.zapped === 1) {
    sim.hud && sim.hud.notify(`Zap! ${S.stats.zapped} popped`, 'good', 2);
  }
  kill(t);
  return true;
}

function showBeam(from, to) {
  if (!G) return;
  const b = G.beam;
  const len = from.distanceTo(to);
  b.position.copy(from);
  b.lookAt(to);
  b.scale.set(1, 1, len);
  b.visible = true;
  b.material.opacity = 0.9;
  S.beam.t = 0.22;
}

function updateBeam(dt) {
  if (!G) return;
  if (S.beam.t > 0) {
    S.beam.t -= dt;
    G.beam.material.opacity = Math.max(0, S.beam.t / 0.22) * 0.9;
    if (S.beam.t <= 0) G.beam.visible = false;
  }
}

/* ---- Photo ---- */

const PHOTO = { inRange: false, aimed: false, d: 0, ang: 0 };

function updatePhoto(sim, dt) {
  const g = S.giant;
  PHOTO.inRange = false;
  PHOTO.aimed = false;
  if (!g || !g.active || S.stats.photoTaken || !sim.camera) {
    S.photoHold = 0;
    return PHOTO;
  }
  /*
   * "In the picture" means in the middle of what is actually on screen. It
   * was an angle from the camera's forward axis, and the chase camera looks
   * DOWN at the aeroplane — so a meteor dead ahead at your own height sat
   * sixteen degrees above the middle of the screen and could never count.
   * Projected, it counts when it is in the middle part of the frame, whichever
   * view you are in.
   */
  const cam = sim.camera;
  const d = g.pos.distanceTo(cam.position);
  _v.copy(g.pos).project(cam);
  const off = _v.z < 1 ? Math.max(Math.abs(_v.x) / PHOTO_FRAME_X, Math.abs(_v.y) / PHOTO_FRAME_Y) : 9;
  const ang = off * PHOTO_CONE_DEG; // for the score: 0 dead centre, PHOTO_CONE_DEG at the frame edge
  const inRange = d < PHOTO_RANGE + g.radius;
  const aimed = off < 1;
  if (inRange && aimed) S.photoHold += dt;
  else S.photoHold = Math.max(0, S.photoHold - dt * 0.6);
  if (S.photoHold >= PHOTO_HOLD) takePhoto(sim, d, Math.min(ang, PHOTO_CONE_DEG));
  PHOTO.inRange = inRange;
  PHOTO.aimed = aimed;
  PHOTO.d = d;
  PHOTO.ang = ang;
  return PHOTO;
}

/**
 * The photo is the game screen. The WebGL canvas keeps no copy of its last
 * frame, so one extra frame is drawn and copied straight away, in the same
 * task, before the browser can clear it. Once, at the moment of the click.
 */
function takePhoto(sim, d, ang) {
  const st = S.stats;
  st.photoTaken = true;
  st.photoDistance = Math.round(d);
  const near = clamp(1 - d / PHOTO_RANGE, 0, 1);
  const centred = clamp(1 - ang / PHOTO_CONE_DEG, 0, 1);
  st.photoQuality = Math.round(100 * clamp(0.4 + 0.38 * near + 0.22 * centred, 0, 1));
  let shot = null;
  try {
    if (sim.renderer && sim.renderer.domElement && sim.scene && sim.camera) {
      sim.renderer.render(sim.scene, sim.camera);
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 180;
      const g = c.getContext('2d');
      if (g && g.drawImage) {
        g.drawImage(sim.renderer.domElement, 0, 0, 320, 180);
        shot = c;
      }
    }
  } catch (e) {
    shot = null;
  }
  S.lastPhoto = shot;
  sfx(sim, 'shutter');
  flashScreen('photo');
  showPhotoCard(shot, st.photoQuality, st.photoDistance);
  sim.hud && sim.hud.notify(`Got it! Photo score ${st.photoQuality}%`, 'good', 4);
  sim.speak && sim.speak('Picture received — that is a beauty. Now watch it come down.', 'tower', 0);
}

/* ====================================================================== */
/* Directors: what each mode spawns, and when                              */
/* ====================================================================== */

function director(sim, dt) {
  const T = S.timers;
  const st = S.stats;
  const busy = activeCount() >= 16;
  if (S.mode === 'shower') {
    T.burn -= dt;
    if (T.burn <= 0) {
      T.burn = rand(1.3, 3);
      if (!busy) spawnBurner(sim, Math.random() < 0.6);
    }
    T.land -= dt;
    if (T.land <= 0) {
      T.land = rand(5.5, 9);
      if (!busy) spawnLander(sim, false);
    }
    T.big -= dt;
    if (T.big <= 0) {
      T.big = rand(38, 52);
      spawnLander(sim, true);
    }
  } else if (S.mode === 'dodge') {
    st.elapsed += dt;
    const p = Math.min(1, st.elapsed / DODGE_SECONDS);
    if (st.elapsed >= DODGE_SECONDS && !st.survived) {
      st.survived = true;
      sfx(sim, 'win');
      sim.hud && sim.hud.notify('Three minutes — you dodged the lot!', 'good', 4);
    }
    if (!st.survived && st.shields > 0) {
      T.threat -= dt;
      if (T.threat <= 0) {
        // Now and then two in a row, later on.
        T.threat = p > 0.5 && Math.random() < 0.3 ? 0.7 : lerp(4.2, 2.0, p) * rand(0.8, 1.2);
        if (!busy) spawnThreat(sim, p);
      }
    }
    T.ambient -= dt;
    if (T.ambient <= 0) {
      T.ambient = rand(3, 6);
      if (!busy) spawnBurner(sim, false);
    }
  } else if (S.mode === 'town') {
    for (const e of S.schedule) {
      if (e.spawned || S.t < e.at) continue;
      e.spawned = true;
      const target = new THREE.Vector3(e.x, surfaceAt(e.x, e.z), e.z);
      const m = spawnMeteor({ kind: 'town', target, az: e.az, dive: e.dive, speed: e.speed, T: e.T, radius: rand(3.5, 5), size: 2, town: true });
      if (m) addMarker(m, 60);
      else st.townResolved++; // no slot: never let the mission hang on one it could not make
    }
    T.ambient -= dt;
    if (T.ambient <= 0) {
      T.ambient = rand(4, 7);
      if (!busy) spawnBurner(sim, false);
    }
  } else if (S.mode === 'photo') {
    if (!st.giantSpawned && S.t >= (S.cfg.giantAt || 7)) spawnGiant(sim);
    T.ambient -= dt;
    if (T.ambient <= 0) {
      T.ambient = rand(2.5, 5);
      if (!busy) spawnBurner(sim, Math.random() < 0.3);
    }
  }
}

/* ====================================================================== */
/* On screen                                                               */
/* ====================================================================== */

const UI = { root: null, panel: null, title: null, line: null, warn: null, keys: null, zap: null, rets: [], flash: null, vf: null, vfBar: null, photo: null, cache: {}, placeT: 0 };

const CSS = `
#meteor-ui { position:absolute; inset:0; pointer-events:none; color:#f3f6fb; font-variant-numeric:tabular-nums; }
#meteor-ui[hidden] { display:none; }
#meteor-ui .mt-panel { position:absolute; right:16px; top:104px; min-width:196px; max-width:250px; padding:8px 12px 9px;
  background:rgba(12,20,34,0.74); border:1px solid rgba(255,170,90,0.5); border-radius:12px;
  -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px); box-shadow:0 6px 24px rgba(0,0,0,0.3); font-size:13px; line-height:1.35; }
#meteor-ui .mt-title { font-size:11px; font-weight:650; letter-spacing:0.12em; text-transform:uppercase; color:#ffbd7a; }
#meteor-ui .mt-line { margin-top:2px; }
#meteor-ui .mt-warn { margin-top:6px; padding:5px 8px; border-radius:8px; font-weight:620;
  background:rgba(255,120,60,0.2); border:1px solid rgba(255,140,80,0.6); color:#ffe6d4; }
#meteor-ui .mt-warn.is-near { background:rgba(255,86,60,0.36); animation:mtPulse 0.5s ease-in-out infinite alternate; }
#meteor-ui .mt-warn[hidden], #meteor-ui .mt-keys[hidden] { display:none; }
#meteor-ui .mt-keys { margin-top:4px; font-size:11px; color:rgba(220,232,248,0.72); }
#meteor-ui .mt-keys kbd { font:inherit; font-weight:700; padding:0 5px; border-radius:4px; border:1px solid rgba(255,255,255,0.35); }
#meteor-ui .mt-zap { position:absolute; right:18px; bottom:232px; width:74px; height:74px; border-radius:50%;
  pointer-events:auto; touch-action:none; -webkit-user-select:none; user-select:none; cursor:pointer;
  border:2px solid rgba(150,232,255,0.9); color:#fff; letter-spacing:0.08em;
  /* longhands: "font:750 15px/1 inherit" is invalid CSS and was dropped whole */
  font-family:inherit; font-weight:750; font-size:15px; line-height:1;
  background:radial-gradient(circle at 50% 40%, rgba(140,228,255,0.62), rgba(26,84,132,0.66));
  box-shadow:0 0 18px rgba(120,220,255,0.45); }
#meteor-ui .mt-zap[hidden] { display:none; }
/* On a desk the corner above the throttle is the minimap's; the button only
   shows there if Z has been given to something else, and then sits left of the map. */
#meteor-ui .mt-zap.is-desk { right:224px; bottom:120px; }
#meteor-ui .mt-zap:active { transform:scale(0.95); }
/*
 * The owner's words, verbatim: "in the metor dodge mission theres a finish
 * cirlce?.." — the rock-is-coming warning used to be a plain open ring, the
 * same shape this game uses elsewhere for a gate to FLY THROUGH (the race
 * rings). This is the opposite of that: a closing target reticle (four
 * inward corner brackets, never a full circle) with a warning triangle in
 * the middle, drawn as one background image so nothing about it reads as an
 * empty hoop. It pulses slowly — never a flash — and that pulse obeys
 * "Reduce flashing" below.
 *
 * placeReticle() moves the real element with an inline style.transform:
 * translate(...) every frame — a CSS animation on that same transform
 * property would win over the inline value and freeze it in place the
 * instant the animation started (the first dodge flown had both pinned
 * reticles stuck at the origin). So the real element only ever positions
 * itself; every bit of look-and-pulse lives on its ::before, a second,
 * un-positioned layer the inline transform never touches.
 */
#meteor-ui .mt-ret { position:absolute; left:0; top:0; width:48px; height:48px; margin:-24px 0 0 -24px;
  display:none; will-change:transform; }
#meteor-ui .mt-ret::before { content:''; position:absolute; inset:0;
  background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Cg fill='none' stroke='%23ff5a3c' stroke-width='4' stroke-linecap='round'%3E%3Cpath d='M4 16 L4 4 L16 4'/%3E%3Cpath d='M32 4 L44 4 L44 16'/%3E%3Cpath d='M4 32 L4 44 L16 44'/%3E%3Cpath d='M44 32 L44 44 L32 44'/%3E%3C/g%3E%3Cpath d='M24 13 L35.5 33.5 H12.5 Z' fill='none' stroke='%23ff5a3c' stroke-width='3' stroke-linejoin='round'/%3E%3Crect x='22.6' y='18.6' width='2.8' height='8.4' rx='1.3' fill='%23ff5a3c'/%3E%3Ccircle cx='24' cy='29.6' r='1.7' fill='%23ff5a3c'/%3E%3C/svg%3E") center/100% 100% no-repeat;
  filter: drop-shadow(0 0 5px rgba(255,70,40,0.55));
  animation: mtThreatPulse 1.3s ease-in-out infinite alternate; will-change:transform, opacity; }
#meteor-ui .mt-ret.is-lock::before { background:none; filter:none; animation:none;
  border:2px solid rgba(130,240,255,0.98); border-radius:10px; box-shadow:0 0 12px rgba(130,240,255,0.6); }
/* Off-screen: a direction pointer, not a danger ring over a place on the view — a filled "look over there" pin. */
#meteor-ui .mt-ret.is-edge { width:34px; height:34px; margin:-17px 0 0 -17px; }
#meteor-ui .mt-ret.is-edge::before { background:rgba(255,70,40,0.42); background-image:none;
  border:2px solid rgba(255,130,90,0.95); border-radius:50% 50% 50% 0; filter:none; animation:none; }
#meteor-ui .mt-ret.is-edge::after { content:'!'; position:absolute; left:0; right:0; top:0; text-align:center; font-size:15px; font-weight:800;
  color:#fff3ea; text-shadow:0 1px 2px rgba(0,0,0,0.6); }
#meteor-ui .mt-ret.is-lock.is-edge::after { content:none; }
#meteor-ui .mt-ret b { position:absolute; left:50%; top:100%; transform:translate(-50%,4px); font-size:11px; font-weight:700;
  white-space:nowrap; text-shadow:0 1px 3px #000, 0 0 2px #000; color:#ffd9c6; }
@keyframes mtThreatPulse { from { transform:scale(1); opacity:0.86; } to { transform:scale(1.12); opacity:1; } }
@media (prefers-reduced-motion: reduce) { #meteor-ui .mt-ret::before { animation:none; } }
html.reduce-flashing #meteor-ui .mt-ret::before { animation-duration: 2.4s; }
#meteor-ui .mt-flash { position:absolute; inset:0; opacity:0; transition:opacity 0.35s ease-out; }
#meteor-ui .mt-flash.is-photo { background:#fff; }
#meteor-ui .mt-flash.is-bonk { background:radial-gradient(circle, rgba(255,255,255,0) 45%, rgba(255,120,90,0.75)); }
#meteor-ui .mt-vf { position:absolute; left:22.5%; right:22.5%; top:20%; bottom:20%; display:none; }
#meteor-ui .mt-vf i { position:absolute; width:26px; height:26px; border:3px solid rgba(255,255,255,0.92); }
#meteor-ui .mt-vf i:nth-child(1) { left:0; top:0; border-right:none; border-bottom:none; }
#meteor-ui .mt-vf i:nth-child(2) { right:0; top:0; border-left:none; border-bottom:none; }
#meteor-ui .mt-vf i:nth-child(3) { left:0; bottom:0; border-right:none; border-top:none; }
#meteor-ui .mt-vf i:nth-child(4) { right:0; bottom:0; border-left:none; border-top:none; }
#meteor-ui .mt-vf.is-aimed i { border-color:#9dffb8; }
#meteor-ui .mt-vf-bar { position:absolute; left:15%; right:15%; bottom:-16px; height:6px; border-radius:6px; background:rgba(255,255,255,0.2); overflow:hidden; }
#meteor-ui .mt-vf-bar span { display:block; height:100%; width:0; background:#9dffb8; }
#meteor-ui .mt-vf-text { position:absolute; left:0; right:0; top:-24px; text-align:center; font-size:13px; font-weight:650; text-shadow:0 1px 3px #000; }
#meteor-ui .mt-photo { position:absolute; left:50%; top:16%; transform:translate(-50%,0) rotate(-3deg); display:none;
  background:#fbfaf6; padding:10px 10px 36px; border-radius:4px; box-shadow:0 14px 40px rgba(0,0,0,0.5); color:#2a2a2a; }
#meteor-ui .mt-photo canvas, #meteor-ui .mt-photo .mt-noimg { display:block; width:240px; height:135px; background:#0f1a2c; }
#meteor-ui .mt-photo .mt-cap { position:absolute; left:0; right:0; bottom:9px; text-align:center; font-size:14px; font-weight:650; }
@keyframes mtPulse { from { transform:scale(1); } to { transform:scale(1.035); } }
@media (prefers-reduced-motion: reduce) { #meteor-ui .mt-warn.is-near { animation:none; } }
@media (max-width: 620px) { #meteor-ui .mt-panel { min-width:0; max-width:190px; font-size:12px; } #meteor-ui .mt-zap { width:64px; height:64px; bottom:214px; } }
`;

function el(tag, cls, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

function buildUi(sim) {
  if (UI.root) return UI.root;
  const style = document.createElement('style');
  style.id = 'meteor-style';
  style.textContent = CSS;
  (document.head || document.body).appendChild(style);
  const root = el('div', '', extLayer());
  root.id = 'meteor-ui';
  root.hidden = true;
  UI.root = root;
  UI.panel = el('div', 'mt-panel', root);
  UI.title = el('div', 'mt-title', UI.panel);
  UI.line = el('div', 'mt-line', UI.panel);
  UI.line2 = el('div', 'mt-line', UI.panel);
  UI.warn = el('div', 'mt-warn', UI.panel);
  UI.warn.hidden = true;
  UI.keys = el('div', 'mt-keys', UI.panel);
  UI.zap = el('button', 'mt-zap', root);
  UI.zap.type = 'button';
  UI.zap.textContent = 'ZAP';
  UI.zap.title = 'Zap the meteor your nose is pointing at (Z)';
  const fire = (e) => {
    e.preventDefault();
    e.stopPropagation();
    zap(sim);
  };
  UI.zap.addEventListener('pointerdown', fire);
  for (let i = 0; i < 4; i++) {
    const r = el('div', 'mt-ret', root);
    el('b', '', r);
    UI.rets.push(r);
  }
  UI.flash = el('div', 'mt-flash', root);
  UI.vf = el('div', 'mt-vf', root);
  for (let i = 0; i < 4; i++) el('i', '', UI.vf);
  UI.vfText = el('div', 'mt-vf-text', UI.vf);
  const bar = el('div', 'mt-vf-bar', UI.vf);
  UI.vfBar = el('span', '', bar);
  UI.photo = el('div', 'mt-photo', root);
  UI.photoImg = el('div', 'mt-noimg', UI.photo);
  UI.photoCap = el('div', 'mt-cap', UI.photo);
  return root;
}

function setText(node, key, text) {
  if (UI.cache[key] === text) return;
  UI.cache[key] = text;
  node.textContent = text;
}

/** Reduce flashing (render/flash-safety.js): at most three a second, and faint. */
const screenGate = new FlashGate();
function flashScreen(kind) {
  if (!UI.flash) return;
  if (!screenGate.allow(flashNow())) return;
  const reduce = SIM && SIM.settings && SIM.settings.reducedMotion;
  UI.flash.className = `mt-flash is-${kind}`;
  UI.flash.style.transition = 'none';
  UI.flash.style.opacity = String(screenOpacity(kind === 'photo' ? (reduce ? 0.35 : 0.85) : reduce ? 0.3 : 0.7));
  // Next frame, fade.
  setTimeout(() => {
    if (!UI.flash) return;
    UI.flash.style.transition = '';
    UI.flash.style.opacity = '0';
  }, 40);
}

let photoTimer = 0;
function showPhotoCard(canvasEl, quality, dist) {
  if (!UI.photo) return;
  if (UI.photoImg) UI.photoImg.remove();
  if (canvasEl) {
    UI.photoImg = canvasEl;
  } else {
    UI.photoImg = document.createElement('div');
    UI.photoImg.className = 'mt-noimg';
  }
  UI.photo.insertBefore(UI.photoImg, UI.photoCap);
  UI.photoCap.textContent = `The Big One · ${quality}% · ${(dist / 1000).toFixed(1)} km`;
  UI.photo.style.display = 'block';
  photoTimer = 7;
}

/**
 * Where the panel can go: at the right, under anything of the HUD's that
 * shares its column. It used to look only at the right-hand column; on a
 * touch screen the instruments are a strip across the top and the objective
 * card sits under it, and on an iPad (seen at 1024x768 and 768x1024, touch
 * emulated) the panel was printed over the right end of the strip and, in
 * portrait, over the objective's title. So anything the panel's own column
 * would cover, in the top half of the screen, pushes it down.
 */
const PANEL_CLEAR = ['.hud-right', '.hud-buttons', '.hud-damage', '.hud-left', '.hud-objective', '.hud-waypoint'];
function placePanel() {
  if (!UI.panel || typeof document.querySelector !== 'function') return;
  const W = window.innerWidth || 1280;
  const H = window.innerHeight || 720;
  const x1 = W - 16;
  const x0 = x1 - (UI.panel.offsetWidth || 220);
  let bottom = 16;
  for (const q of PANEL_CLEAR) {
    const e = document.querySelector(q);
    if (!e || !e.getBoundingClientRect) continue;
    const r = e.getBoundingClientRect();
    if (r.height > 0 && r.width > 0 && r.right > x0 && r.left < x1 && r.top < H * 0.5) bottom = Math.max(bottom, r.bottom);
  }
  const top = `${Math.round(bottom + 10)}px`;
  if (UI.panel.style.top !== top) UI.panel.style.top = top;
  /*
   * And where the minimap is, for the pinned reticles (see placeReticle).
   * Measured here, twice a second with the rest, never per frame.
   */
  const mm = document.querySelector('.minimap');
  const r = mm && mm.style.display !== 'none' && mm.getBoundingClientRect ? mm.getBoundingClientRect() : null;
  if (r && r.width > 0 && r.height > 0) {
    const m = UI.mapRect || (UI.mapRect = { l: 0, t: 0, r: 0, b: 0 });
    m.l = r.left - 4;
    m.t = r.top - 4;
    m.r = r.right + 4;
    m.b = r.bottom + 4;
  } else {
    UI.mapRect = null;
  }
}

/*
 * The footprint of a pinned ("is-edge") reticle round its anchor: the 34 px
 * teardrop and the distance printed under it.
 */
const PIN_HALF = 20;
const PIN_UP = 20;
const PIN_DOWN = 40;

/**
 * A pinned reticle must not sit on the minimap.
 *
 * The owner: "I see a meteor icon on the minimap even though there isn't
 * one". It was this. The pin bands keep the HUD's top and bottom clear, but
 * the minimap lives in a corner INSIDE those bands — bottom-right on a desk,
 * top-left on a touch screen — and a rock behind you or off to the side was
 * pinned straight onto it: an orange teardrop on the chart, over "6 km
 * across", pointing at a rock that was nowhere on the screen. Measured in
 * Rock Dodger at 1366x768 (anchor 1330,618 on a map at 1160–1350 x 470–660)
 * and on an iPad (anchor 41,120 on a map at 8–126).
 *
 * So the anchor is moved the shortest way out of the map's rectangle —
 * up, down, left or right — that stays inside the pin bands (the HUD's top
 * and bottom are still the HUD's: below a desk's map there is only the
 * button strip). Returns the new x and y through `out`.
 */
function keepOffMap(x, y, minX, maxX, minY, maxY, out) {
  out.x = x;
  out.y = y;
  const m = UI.mapRect;
  if (!m) return out;
  if (x + PIN_HALF <= m.l || x - PIN_HALF >= m.r || y + PIN_DOWN <= m.t || y - PIN_UP >= m.b) return out;
  // The four ways out, each with how far it is; an impossible one is Infinity.
  const lx = m.l - PIN_HALF;
  const rx = m.r + PIN_HALF;
  const uy = m.t - PIN_DOWN;
  const dy = m.b + PIN_UP;
  const dl = lx >= minX ? x - lx : Infinity;
  const dr = rx <= maxX ? rx - x : Infinity;
  const du = uy >= minY ? y - uy : Infinity;
  const dd = dy <= maxY ? dy - y : Infinity;
  const best = Math.min(dl, dr, du, dd);
  if (best === Infinity) return out;
  if (best === dl) out.x = lx;
  else if (best === dr) out.x = rx;
  else if (best === du) out.y = uy;
  else out.y = dy;
  return out;
}
const _pin = { x: 0, y: 0 };

function uiVisible(sim) {
  if (!S.active || !sim || sim.state !== 'flying') return false;
  const hud = sim.hud;
  if (hud && hud.wrap && hud.wrap.style && hud.wrap.style.display === 'none') return false;
  return true;
}

function project(p, cam, out) {
  out.copy(p).project(cam);
  return out;
}

function placeReticle(r, p, cam, label, lock, sx, sy) {
  const v = project(p, cam, _v2);
  let x = (v.x * 0.5 + 0.5) * sx;
  let y = (-v.y * 0.5 + 0.5) * sy;
  let edge = false;
  if (v.z > 1 || x < 20 || x > sx - 20 || y < 20 || y > sy - 20) {
    // Off screen, or behind: pin it to the edge, pointing the way to look.
    edge = true;
    let dx = v.x;
    let dy = v.y;
    if (v.z > 1) {
      dx = -dx;
      dy = -dy;
    }
    const k = Math.max(Math.abs(dx), Math.abs(dy)) || 1;
    x = (dx / k * 0.5 * 0.92 + 0.5) * sx;
    y = (-dy / k * 0.5 * 0.88 + 0.5) * sy;
    /*
     * Not in the HUD's bands. A rock coming down from above is pinned to the
     * top edge — which is where the objective panel is, and the first dodge
     * flown had two orange markers printed over "Keep turning, climbing and
     * diving". The top 120 px and bottom 150 px are the HUD's.
     */
    const minY = Math.min(120, sy * 0.25);
    const maxY = Math.max(sy * 0.6, sy - 150);
    y = clamp(y, minY, maxY);
    x = clamp(x, 36, sx - 36);
    // And never on the minimap, whichever corner it is in.
    keepOffMap(x, y, 36, sx - 36, minY, maxY, _pin);
    x = _pin.x;
    y = _pin.y;
  }
  // Only what changed: a new class string and a new transform string every
  // frame for each reticle was garbage every frame for nothing.
  if (r.style.display !== 'block') r.style.display = 'block';
  const cls = lock ? (edge ? 'mt-ret is-lock is-edge' : 'mt-ret is-lock') : edge ? 'mt-ret is-edge' : 'mt-ret';
  if (r.className !== cls) r.className = cls;
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (r._x !== ix || r._y !== iy) {
    r._x = ix;
    r._y = iy;
    r.style.transform = `translate(${ix}px, ${iy}px)`;
  }
  const b = r.firstChild;
  if (b && b.textContent !== label) b.textContent = label;
}

function updateUi(sim, dt, photo) {
  if (!UI.root) return;
  const show = uiVisible(sim);
  if (!show) {
    hideUi();
    return;
  }
  if (UI.root.hidden) UI.root.hidden = false;
  const st = S.stats;
  const ac = player(sim);
  UI.placeT -= dt;
  if (UI.placeT <= 0) {
    UI.placeT = 0.5;
    placePanel();
  }
  // The words change ten times a second at most; building them every frame
  // is garbage every frame. The reticles below still move every frame.
  UI.textT = (UI.textT || 0) - dt;
  if (UI.textT <= 0) {
    UI.textT = 0.1;
    updatePanelText(sim, st, ac);
  }
  updateMarks(sim, dt, photo, st, ac);
}

function updatePanelText(sim, st, ac) {
  setText(UI.title, 'title', (S.cfg && S.cfg.title) || 'Meteors');
  let line = '';
  let line2 = '';
  if (S.mode === 'shower') {
    line = `Stardust ${st.stardust} · Zapped ${st.zapped}`;
    // "Stardust", not "gold stars": the gold stars on the minimap are the
    // Star Hunt's (fun.js), and a kid sent through "the gold stars" went
    // looking for them there.
    line2 = st.stardust ? 'Fly through the stardust for more' : 'Fly through the stardust a meteor leaves behind';
  } else if (S.mode === 'dodge') {
    const left = Math.max(0, DODGE_SECONDS - st.elapsed);
    line = `Shields ${'●'.repeat(st.shields)}${'○'.repeat(Math.max(0, 3 - st.shields))} · ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')} to go`;
    line2 = `Close shaves ${st.nearMisses}`;
  } else if (S.mode === 'town') {
    line = `Saved ${st.townZapped} · In town ${st.landedTown} of ${TOWN_LIMIT}`;
    line2 = `${Math.max(0, st.townTotal - st.townResolved)} still to come`;
  } else if (S.mode === 'photo') {
    const g = S.giant;
    if (g && g.active && ac) {
      const d = ac.pos.distanceTo(g.pos);
      line = `The big one: ${(d / 1000).toFixed(1)} km · ${clockOf(ac, g.pos.x, g.pos.z)} o'clock`;
      line2 = st.photoTaken ? `Photo taken — ${st.photoQuality}%` : `Get within ${(PHOTO_RANGE / 1000).toFixed(0)} km and keep it in view`;
    } else {
      line = st.giantLanded ? 'Splashdown!' : 'Watch the sky…';
      line2 = st.photoTaken ? `Photo taken — ${st.photoQuality}%` : '';
    }
  }
  setText(UI.line, 'line', line);
  setText(UI.line2, 'line2', line2);

  // The most urgent warning: a big one, or the next one into town.
  let warn = '';
  let near = false;
  if (ac) {
    let best = null;
    for (const m of S.meteors) {
      if (!m.active || m.marker < 0 || !m.hasImpact || m.giant) continue;
      const left = m.impactT - m.t;
      if (!best || left < best.impactT - best.t) best = m;
    }
    if (best) {
      const left = Math.max(0, best.impactT - best.t);
      const d = Math.hypot(best.impact.x - ac.pos.x, best.impact.z - ac.pos.z);
      near = d < blastRadius(best) * 3 && ac.agl < 600;
      warn = `${best.town ? 'INTO TOWN' : 'BIG ONE'} · ${(d / 1000).toFixed(1)} km · ${clockOf(ac, best.impact.x, best.impact.z)} o'clock · ${Math.ceil(left)} s`;
      if (near && !best.warnedNear) {
        best.warnedNear = true;
        sfx(sim, 'warnNear');
        sim.hud && sim.hud.notify('Too close to where it lands — climb and turn away!', 'warn', 3);
      }
    }
  }
  if (UI.warn.hidden === !!warn) UI.warn.hidden = !warn;
  setText(UI.warn, 'warn', warn);
  const wantCls = near ? 'mt-warn is-near' : 'mt-warn';
  if (UI.warn.className !== wantCls) UI.warn.className = wantCls;
  /*
   * The ZAP button is for touch screens. On a desk it sat on top of the
   * minimap (both in the bottom-right corner, measured overlapping by 66 px)
   * and Z already does the job, so it only appears there if the player has
   * bound Z to something else and the zapper has left the key alone.
   */
  const zapOn = !!(S.cfg && S.cfg.zapper);
  const touch = isTouch();
  const zFree = zKeyFree(sim);
  const showBtn = zapOn && (touch || !zFree);
  if (UI.keys.hidden === zapOn) UI.keys.hidden = !zapOn;
  if (UI.zap.hidden === showBtn) UI.zap.hidden = !showBtn;
  const zapCls = touch ? 'mt-zap' : 'mt-zap is-desk';
  if (UI.zap.className !== zapCls) UI.zap.className = zapCls;
  const zk = keyName('zap', sim);
  const how = touch ? 'Tap <b>ZAP</b>' : zFree ? `Press <kbd>${zk}</kbd>` : 'Click <b>ZAP</b>';
  // The lock reticle said "Z ZAP" on an iPad too, which has no Z.
  UI.zapLabel = touch || !zFree ? 'ZAP' : `${zk}  ZAP`;
  if (UI.cache.keys !== how) {
    UI.cache.keys = how;
    UI.keys.innerHTML = `${how} to zap the meteor your nose is pointing at`;
  }
}

function isTouch() {
  try {
    return document.documentElement.classList.contains('is-touch-device');
  } catch (e) {
    return false;
  }
}

/**
 * The zap key is the zapper's only while the player has not put one of the
 * game's own actions on it in Settings (then the ZAP button is clicked).
 */
function zKeyFree(sim) {
  try {
    const codes = codesFor('zap', sim);
    return codes.length > 0 && !codes.every((c) => playerClaimed(sim, c, 'zap'));
  } catch (e) {
    return true;
  }
}

function updateMarks(sim, dt, photo, st, ac) {
  const zapOn = !!(S.cfg && S.cfg.zapper);
  // Reticles: the zap lock, then any rock that is coming for you.
  const cam = sim.camera;
  const sx = window.innerWidth || 1280;
  const sy = window.innerHeight || 720;
  let used = 0;
  if (cam) {
    if (zapOn && S.lock && S.lock.active && used < UI.rets.length) {
      placeReticle(UI.rets[used++], S.lock.pos, cam, S.lock.giant ? 'too big!' : UI.zapLabel || 'Z  ZAP', true, sx, sy);
    }
    if (S.mode === 'dodge' && ac) {
      for (const m of S.meteors) {
        if (used >= UI.rets.length) break;
        if (!m.active || !m.threat) continue;
        const d = m.pos.distanceTo(ac.pos);
        if (d > 2200 || m.nearMissDone) continue;
        // Only while it is still coming towards you.
        _v.subVectors(ac.pos, m.pos);
        if (_v.dot(m.dir) < 0) continue;
        placeReticle(UI.rets[used++], m.pos, cam, `${Math.round(d)} m`, false, sx, sy);
      }
    }
  }
  for (let i = used; i < UI.rets.length; i++) if (UI.rets[i].style.display !== 'none') UI.rets[i].style.display = 'none';

  // The viewfinder.
  if (photo && photo.inRange && !st.photoTaken) {
    UI.vf.style.display = 'block';
    const cls = photo.aimed ? 'mt-vf is-aimed' : 'mt-vf';
    if (UI.vf.className !== cls) UI.vf.className = cls;
    UI.vfBar.style.width = `${Math.round(clamp(S.photoHold / PHOTO_HOLD, 0, 1) * 100)}%`;
    setText(UI.vfText, 'vf', photo.aimed ? 'Hold it there…' : 'Turn to put it in the frame');
  } else if (UI.vf.style.display !== 'none') {
    UI.vf.style.display = 'none';
  }
  if (photoTimer > 0) {
    photoTimer -= dt;
    if (photoTimer <= 0 && UI.photo) UI.photo.style.display = 'none';
  }
}

/**
 * Everything off, the reticles included. Hiding the root alone left the
 * reticles `display:block` with the last rock's place and distance in them,
 * for the next session to show for a frame before its own first placement —
 * and for anything that ever unhid the root to show for good.
 */
function hideUi() {
  if (UI.root && !UI.root.hidden) UI.root.hidden = true;
  for (let i = 0; i < UI.rets.length; i++) {
    const r = UI.rets[i];
    if (r.style.display !== 'none') {
      r.style.display = 'none';
      r._x = r._y = undefined;
    }
  }
}

/* ====================================================================== */
/* Session                                                                 */
/* ====================================================================== */

function clearWorldBits() {
  for (const m of S.meteors) {
    m.active = false;
    m.marker = -1;
  }
  for (const d of S.dust) d.active = false;
  if (G) {
    G.flying.count = 0;
    G.giantRock.visible = false;
    for (const k of G.markers) {
      k.active = false;
      k.g.visible = false;
    }
    G.beam.visible = false;
    G.landed.count = 0;
    G.landedCount = 0;
    G.landedNext = 0;
  }
  S.giant = null;
  S.lock = null;
  S.beam.t = 0;
}

/**
 * Start (or restart) a meteor session. Called by the missions' onStart, and
 * by the dev button in the middle of a free flight.
 * @param {{mode:string}} cfg
 */
export function begin(sim, cfg, missionId = null) {
  const mode = cfg && MODES[cfg.mode] ? cfg.mode : 'shower';
  SIM = sim || SIM;
  clearWorldBits();
  S.active = true;
  S.mode = mode;
  S.missionId = missionId;
  S.cfg = { ...MODES[mode], ...(cfg || {}), mode };
  S.t = 0;
  S.stats = freshStats();
  S.zapCool = 0;
  S.invuln = 0;
  S.photoHold = 0;
  S.msgCool = 0;
  S.lastPhoto = null;
  photoTimer = 0;
  if (UI.photo) UI.photo.style.display = 'none';
  UI.cache = {};
  const T = S.timers;
  T.burn = 1.2;
  T.land = 6;
  T.big = 18;
  T.threat = 4;
  T.ambient = 2;
  S.schedule = mode === 'town' ? buildTownSchedule() : [];
  try {
    buildUi(sim);
  } catch (e) {
    /* no DOM (node): the simulation still runs */
  }
  return S.stats;
}

export function end() {
  S.active = false;
  S.mode = null;
  S.missionId = null;
  clearWorldBits();
  hideUi();
  if (UI.photo) UI.photo.style.display = 'none';
}

/** Advance the session; exported for the tests, called by the update hook. */
export function updateMeteorMode(sim, dt) {
  if (!S.active) {
    hideUi();
    return;
  }
  if (!(dt > 0)) return;
  dt = Math.min(dt, 0.1);
  if (!player(sim) || sim.mode === 'drive') {
    end();
    return;
  }
  S.t += dt;
  S.zapCool = Math.max(0, S.zapCool - dt);
  S.invuln = Math.max(0, S.invuln - dt);
  S.msgCool = Math.max(0, S.msgCool - dt);
  director(sim, dt);
  updateMeteors(sim, dt);
  updateDust(sim, dt);
  updateMarkers(dt);
  updateBeam(dt);
  S.lock = S.cfg.zapper ? findZapTarget(sim) : null;
  const photo = S.mode === 'photo' ? updatePhoto(sim, dt) : null;
  try {
    updateUi(sim, dt, photo);
  } catch (e) {
    /* the DOM is a nicety here; the meteors keep flying */
  }
}

/** The mission-facing handle, hung on the game as sim.meteors. */
export const API = {
  get active() { return S.active; },
  get mode() { return S.mode; },
  get stats() { return S.stats; },
  get lastPhoto() { return S.lastPhoto; },
  begin: (cfg, id) => begin(SIM, cfg, id),
  end: () => end(),
  zap: () => zap(SIM),
  nearestStardust: () => nearestStardust(SIM && SIM.aircraft ? SIM.aircraft.pos : null),
  giantPos: () => (S.giant && S.giant.active ? S.giant.pos : null),
  nextWarning: () => {
    let best = null;
    for (const m of S.meteors) if (m.active && m.marker >= 0 && m.hasImpact && (!best || m.impactT - m.t < best.impactT - best.t)) best = m;
    return best ? best.impact : null;
  },
  town: () => townInfo(),
  /** The rock heading for town that is nearest you — what to fly at. */
  nearestTownRock: () => {
    const ac = SIM && SIM.aircraft;
    let best = null;
    let bd = Infinity;
    for (const m of S.meteors) {
      if (!m.active || !m.town) continue;
      const d = ac ? m.pos.distanceToSquared(ac.pos) : 0;
      if (d < bd) {
        bd = d;
        best = m.pos;
      }
    }
    return best;
  },
  count: () => activeCount(),
  meteors: () => S.meteors.filter((m) => m.active),
  /** For the tests and the dev panel: put a meteor somewhere on purpose. */
  spawn: (o) => spawnMeteor(o),
  spawnGiant: () => spawnGiant(SIM),
  spawnLander: (big) => spawnLander(SIM, !!big),
  spawnBurner: (near) => spawnBurner(SIM, !!near),
  spawnThreat: (progress = 0) => spawnThreat(SIM, progress),
  schedule: () => S.schedule,
};

registerExtension({
  id: 'meteor',
  install(sim) {
    SIM = sim;
    sim.meteors = API;
    /*
     * The update hook only runs while flying, so on its own it could never
     * hide the panel: a mission ends on the debrief screen, a pause stops the
     * frame loop, and the panel sat on top of both. Four times a second, which
     * costs nothing, it checks.
     */
    // Only in a page: in node the interval kept the test process alive for
    // ever after its last check had printed.
    if (typeof window !== 'undefined' && typeof window.setInterval === 'function') {
      window.setInterval(() => {
        try {
          if (UI.root && !UI.root.hidden && !uiVisible(SIM)) UI.root.hidden = true;
        } catch (e) {
          /* the stop hook still hides it */
        }
      }, 250);
    }
  },
  buildWorld(sim, group) {
    buildMeshes(sim, group);
  },
  startMode(sim, mode) {
    SIM = sim;
    const def = sim.runner && sim.runner.def;
    const isMeteor = mode === 'mission' && def && def.category === 'meteor' && def.meteor;
    if (!isMeteor) {
      end();
      return;
    }
    // Normally the mission's onStart has already begun it; this is the
    // fallback if it did not.
    if (!S.active || S.missionId !== def.id) begin(sim, def.meteor, def.id);
  },
  stop() {
    end();
  },
  update(sim, dt) {
    updateMeteorMode(sim, dt);
  },
  key(sim, code, down, e) {
    if (!isKey(sim, 'zap', code) || !S.active || !S.cfg || !S.cfg.zapper || playerClaimed(sim, code, 'zap')) return false;
    if (down && !(e && e.repeat)) zap(sim);
    return true;
  },
  devActions: [
    {
      label: 'Start meteor shower',
      hint: 'In a flight: meteors start falling right now. From the menu: starts the Meteor Shower mission.',
      run(sim) {
        if (sim.state === 'flying' && sim.aircraft && sim.mode !== 'drive') {
          begin(sim, { mode: 'shower' }, null);
          sim.hud && sim.hud.notify('Meteor shower! Watch the sky ahead — point your nose at one and zap it', 'good', 4);
          return;
        }
        if (sim.startMode) {
          Promise.resolve(sim.startMode('mission', { id: 'meteor-shower' })).catch((e) => console.error('[meteor] could not start', e));
        }
      },
    },
  ],
});
