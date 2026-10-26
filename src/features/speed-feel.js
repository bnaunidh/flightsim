/**
 * Sense of speed at the top end (the owner, 2026-10-25: "ultra fast planes
 * aren't fast"): faint streaks of air rushing past the camera, on High and
 * Ultra graphics only, above SHOW_FROM true airspeed (about 450 kt).
 *
 * The streaks are short, thin lines standing still in the WORLD, laid out in
 * a box ahead of the camera along the airflow; the camera flies through them,
 * so they stream past at exactly the aeroplane's speed and with the right
 * parallax, as moisture and dust do past a real canopy. Each is drawn as long
 * as the distance the air moves in STRETCH seconds (motion blur), and one
 * that has gone behind the camera, or too far to the side, is laid out ahead
 * again. One draw call, COUNT segments, no textures.
 *
 * FLASH-SAFE: one-pixel lines, white at most MAX_ALPHA (MAX_ALPHA_REDUCED
 * with Reduce flashing on, the default) — under 1% of any 10-degree field,
 * where WCAG's flash needs a quarter of it — fading in over 100 kt rather
 * than switching on (at 0.09 they could not be seen at all on a 1280 px
 * screen; at 0.5 they read as streaks drawn on the glass), and none at all under Reduce motion,
 * in the menus, on the ground, crashed, in the Tower and Orbit views (which
 * stand still or circle, so the air is not passing them) or on Low/Medium.
 * Nothing here touches the flight model.
 */
import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { FLASH } from '../render/flash-safety.js';

export const COUNT = 56;
/** True airspeed (m/s) where the streaks begin, and where they are full. */
export const SHOW_FROM = 230;
export const SHOW_FULL = 330;
export const MAX_ALPHA = 0.3;
export const MAX_ALPHA_REDUCED = 0.2;
/*
 * At night: unlit white lines on a black sky read as glowing "speed lines",
 * a cartoon's, not as air. What a real canopy shows at night is next to
 * nothing, so they are kept at this share — just enough to catch the
 * aeroplane's own lights.
 */
export const NIGHT_SHARE = 0.3;
/** Seconds of airflow each streak is drawn as long as. */
const STRETCH = 0.022;
const AHEAD = [18, 140];
const SIDE = 26;
const VIEWS = new Set(['chase', 'cockpit', 'wing']);

const S = {
  lines: null,
  pos: null,
  seeds: null,
  alpha: 0,
  rng: 1,
};

function rand() {
  // A small LCG: deterministic for the tests, and no Math.random churn.
  S.rng = (S.rng * 1664525 + 1013904223) >>> 0;
  return S.rng / 4294967296;
}

function build(scene) {
  if (S.lines || !scene) return S.lines;
  const geo = new THREE.BufferGeometry();
  S.pos = new Float32Array(COUNT * 6);
  geo.setAttribute('position', new THREE.BufferAttribute(S.pos, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.LineBasicMaterial({ color: 0xf2f6fb, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.name = 'Speed streaks';
  lines.frustumCulled = false;
  lines.renderOrder = 5;
  lines.visible = false;
  S.seeds = new Float32Array(COUNT * 3);
  S.lines = lines;
  scene.add(lines);
  return lines;
}

/** Is the sense-of-speed layer allowed at all here (graphics, motion setting, view, state)? */
export function streaksAllowed(sim) {
  if (!sim || sim.state !== 'flying' || sim.mode === 'drive') return false;
  const q = sim.settings && sim.settings.quality;
  if (q !== 'high' && q !== 'ultra') return false;
  if (sim.settings && sim.settings.reducedMotion) return false;
  const ac = sim.aircraft;
  if (!ac || ac.crashed || ac.onGround) return false;
  return !!(sim.rig && VIEWS.has(sim.rig.mode));
}

/** How strong the streaks are, 0..1, for a true airspeed in m/s. */
export function streakLevel(tas) {
  const t = Math.max(0, Math.min(1, (tas - SHOW_FROM) / (SHOW_FULL - SHOW_FROM)));
  return t * t * (3 - 2 * t);
}

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();

/** Lay streak i out ahead of the camera, somewhere in the box round the flight path. */
function place(i, cam, flow, len, near) {
  const a = AHEAD[0] + rand() * (AHEAD[1] - AHEAD[0]);
  // Not straight down the middle, where the aeroplane is: a ring round it.
  const ang = rand() * Math.PI * 2;
  const rad = SIDE * (0.35 + 0.65 * Math.sqrt(rand()));
  _p.copy(cam.position).addScaledVector(_f, near ? a * 0.5 : a);
  _p.addScaledVector(_r, Math.cos(ang) * rad).addScaledVector(_u, Math.sin(ang) * rad * 0.7);
  const o = i * 6;
  S.pos[o] = _p.x;
  S.pos[o + 1] = _p.y;
  S.pos[o + 2] = _p.z;
  S.pos[o + 3] = _p.x - flow.x * len;
  S.pos[o + 4] = _p.y - flow.y * len;
  S.pos[o + 5] = _p.z - flow.z * len;
}

function update(sim, dt) {
  const on = streaksAllowed(sim);
  const ac = sim && sim.aircraft;
  const want = on ? streakLevel(ac.airspeed || 0) : 0;
  // Faded in over a third of a second and out over a sixth: never switched.
  S.alpha += (want - S.alpha) * Math.min(1, (dt || 0) * (want > S.alpha ? 3 : 6));
  if (S.alpha < 0.02 && want === 0) {
    if (S.lines && S.lines.visible) S.lines.visible = false;
    S.alpha = 0;
    return;
  }
  const lines = build(sim.scene);
  if (!lines) return;
  // A world rebuild (graphics changed) may have cleared the scene.
  if (lines.parent !== sim.scene && sim.scene) sim.scene.add(lines);
  const cam = sim.camera;
  const v = ac.vel;
  const speed = v.length();
  if (!(speed > 1)) return;
  const flow = _d.copy(v).divideScalar(speed);
  // The box's own axes: along the flight path, and two across it.
  _f.copy(flow);
  _r.set(0, 1, 0).cross(_f);
  if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0);
  _r.normalize();
  _u.crossVectors(_f, _r).normalize();
  const len = speed * STRETCH;
  const first = !lines.visible;
  for (let i = 0; i < COUNT; i++) {
    const o = i * 6;
    if (first) {
      place(i, cam, flow, len, true);
      continue;
    }
    // Behind the camera, or wandered out of the box (a turn): ahead again.
    _p.set(S.pos[o] - cam.position.x, S.pos[o + 1] - cam.position.y, S.pos[o + 2] - cam.position.z);
    const along = _p.dot(_f);
    const across = _p.lengthSq() - along * along;
    if (along < -4 || along > AHEAD[1] * 1.3 || across > SIDE * SIDE * 2.5) {
      place(i, cam, flow, len, false);
    } else {
      // Keep the tail along the airflow and as long as the speed says.
      S.pos[o + 3] = S.pos[o] - flow.x * len;
      S.pos[o + 4] = S.pos[o + 1] - flow.y * len;
      S.pos[o + 5] = S.pos[o + 2] - flow.z * len;
    }
  }
  lines.geometry.attributes.position.needsUpdate = true;
  const night = sim.weather && sim.weather.isNight ? NIGHT_SHARE : 1;
  lines.material.opacity = S.alpha * (FLASH.reduce ? MAX_ALPHA_REDUCED : MAX_ALPHA) * night;
  lines.visible = true;
}

function hide() {
  S.alpha = 0;
  if (S.lines) S.lines.visible = false;
}

registerExtension({
  id: 'speed-feel',
  startMode() {
    hide();
  },
  stop() {
    hide();
  },
  update(sim, dt) {
    update(sim, dt);
  },
});

/** For the browser check and the console. */
export function streakState() {
  return { visible: !!(S.lines && S.lines.visible), opacity: S.lines ? S.lines.material.opacity : 0, alpha: S.alpha, lines: S.lines };
}
