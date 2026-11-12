/**
 * The instant replay's player (features/breakup.js owns the replay itself:
 * the recording, the clock, the seek; this is how a player watches it).
 *
 * Fetched when there is a replay to watch — the crash screen offering one,
 * or a replay starting — so none of it is in the first load. It gives:
 *
 *   - a player bar: play / pause, back and forward 5 s, a timeline you can
 *     drag with the impact, the fires and the splash marked on it (and the
 *     section a video will take, when one is chosen), the pace from 0.25x
 *     to 2x, the camera, hide the controls, save a video, close;
 *   - five cameras: orbit (breakup.js's own), chase, cockpit, tower (a fixed
 *     spot on the ground) and free look (drag the picture; a drag in any
 *     other camera turns into free look from where that camera stands;
 *     pinch or the wheel for distance);
 *   - keys for all of it (registry actions, so Settings can move them), and
 *     thumb-sized buttons (44 px or more) for the same on a phone or iPad;
 *   - a video of the replay, or of a chosen section of it, recorded from the
 *     game's picture while it plays in real time (./replay-video.js, fetched
 *     when the video panel opens).
 *
 * Flash safety, Reduce flashing on (the default): the cameras that stand
 * close — chase, cockpit, free look — cut to the orbit's stood-back distance
 * for the crash itself (0.4 s before the hit), the cockpit view steps
 * outside, and the tower's zoom never makes the wreck look nearer
 * than the orbit does: the distance the flicker probe measured as safe. Any
 * camera that is nearer all the same (R.near), or a pace faster than real
 * time, plays the crash without its flashes (breakup.js calmFlashes).
 */
import * as THREE from '../../vendor/three.module.js';

/** breakup.js's side: S, REPLAY, FLASH, seek, pause, end, airframeAt, flashMoments, surface, isKey, keyName, extLayer, step(), span(). */
let A = null;
export function attach(api) {
  A = api;
}

export const SPEEDS = [0.25, 0.5, 1, 2];
export const CAMS = [
  { id: 'orbit', name: 'Orbit', hint: 'Circles the wreck' },
  { id: 'chase', name: 'Chase', hint: 'Follows behind the aeroplane' },
  { id: 'cockpit', name: 'Cockpit', hint: "From the pilot's seat" },
  { id: 'tower', name: 'Tower', hint: 'A fixed camera on the ground' },
  { id: 'free', name: 'Free look', hint: 'Drag the picture to look round' },
];
export const FPS_CHOICES = [30, 60];

/** The player's state for this session: the choices carry from one replay to the next. */
const P = {
  cam: 'orbit',
  speed: null,
  fps: 30,
  sound: true,
  clean: false,
  section: null,
  ui: null,
  menu: false,
  panel: false,
  video: null,
  videoP: null,
  rec: null,
  last: null,
  url: null,
  note: '',
  msg: '',
  cache: {},
  stats: { shows: 0, recordings: 0, cancelled: 0, failed: 0, camSwitches: 0, drags: 0 },
};

/* ------------------------------------------------------------------ *
 * The cameras
 * ------------------------------------------------------------------ */

const DEFAULT_EYE = new THREE.Vector3(-0.24, 0.46, 0.06);
const PITCH_DOWN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -THREE.MathUtils.degToRad(5));
const C = { R: null, seeks: -1, dir: new THREE.Vector3(), has: false, tower: null, towerFov: 50, look: new THREE.Vector3(), lookHas: false, free: null };
const _a = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _d = new THREE.Vector3();
const _t = new THREE.Vector3();

const ease = (dt, tau) => 1 - Math.exp(-Math.max(0, dt) / tau);
const groundY = (x, z) => {
  try {
    const s = A.surface(x, z, {});
    return s && Number.isFinite(s.y) ? s.y : 0;
  } catch (e) {
    return 0;
  }
};
function keepAbove(p, by) {
  const g = groundY(p.x, p.z);
  if (p.y < g + by) p.y = g + by;
}

/**
 * How close a camera may stand at replay time t: with Reduce flashing, the
 * orbit's distance for the crash. A cut, not a pull back — a camera swept 80 m
 * out in a fraction of a second sweeps the whole picture past it, and a cut
 * changes it once.
 */
const CUT_AT = -0.4;
function minDist(R, t) {
  return A.FLASH.reduce && t > CUT_AT ? R.radius : 0;
}

/** The camera this replay is in at time t: the cockpit steps outside for the crash with Reduce flashing on. */
function camAt(t) {
  if (P.cam === 'cockpit' && A.FLASH.reduce && t > CUT_AT) return 'chase';
  return P.cam;
}

/** Called by breakup.js each replay frame; returns false for the orbit, which breakup.js flies itself. */
export function camera(sim, R, t, dt, pos, quat, look) {
  if (!A || !R || !sim.camera) return false;
  if (C.R !== R) {
    C.R = R;
    C.has = false;
    C.tower = null;
    C.lookHas = false;
    C.free = null;
    C.seeks = R.seeks;
  }
  const snap = C.seeks !== R.seeks;
  C.seeks = R.seeks;
  const mode = camAt(t);
  const note = P.cam === 'cockpit' && mode !== 'cockpit' ? 'Reduce flashing is on: the cockpit view steps outside for the crash' : '';
  if (note !== P.note) {
    P.note = note;
    sync();
  }
  if (mode === 'orbit') return false;
  const cam = sim.camera;
  const L = A.span();
  const md = minDist(R, t);
  if (mode === 'chase') chase(cam, R, t, dt, pos, quat, look, L, md, snap);
  else if (mode === 'cockpit') cockpit(sim, cam, pos, quat);
  else if (mode === 'tower') tower(cam, R, t, dt, pos, look, L, snap);
  else free(cam, R, look, L, md);
  // Free look turns round a point that is not the airframe: it is held off the airframe itself too.
  if (md > 0 && mode === 'free') {
    _d.subVectors(cam.position, pos);
    const l = _d.length();
    if (l < md) {
      cam.position.copy(pos).addScaledVector(l > 1e-3 ? _d.multiplyScalar(1 / l) : _d.set(0, 0.5, 1).normalize(), md);
      keepAbove(cam.position, 2);
      cam.lookAt(look);
    }
  }
  cam.updateProjectionMatrix();
  // Nearer than the orbit stands for the crash (the cockpit is always near): breakup.js plays it without its flashes.
  if (!A.FLASH.reduce) R.near = false;
  else if (mode === 'cockpit') R.near = true;
  else R.near = t > -0.6 && cam.position.distanceTo(pos) < R.radius * 0.8;
  return true;
}

function chase(cam, R, t, dt, pos, quat, look, L, md, snap) {
  // Which way it is going: from where the recording had it a moment ago, the climb flattened.
  A.airframeAt(Math.max(R.start, t - 0.12), _a, _qa);
  _d.subVectors(pos, _a);
  if (_d.lengthSq() > 0.04) {
    _d.y *= 0.35;
    _d.normalize();
    if (!C.has || snap) C.dir.copy(_d);
    else C.dir.lerp(_d, ease(dt, 0.45)).normalize();
    C.has = true;
  } else if (!C.has) {
    C.dir.set(0, 0, -1).applyQuaternion(quat);
    C.dir.y *= 0.35;
    C.dir.normalize();
    C.has = true;
  }
  const near = L * 1.3 + 9;
  const d = Math.max(near, md);
  const back = md > near ? (md - near) / Math.max(1, md) : 0;
  cam.position.copy(pos).addScaledVector(C.dir, -d);
  cam.position.y += d * (0.2 + 0.18 * back) + 1.5;
  keepAbove(cam.position, 3);
  _t.copy(pos).lerp(look, back * 0.5);
  cam.lookAt(_t);
  cam.fov = 60;
}

function cockpit(sim, cam, pos, quat) {
  const eye = (sim.rig && sim.rig.eye) || DEFAULT_EYE;
  cam.position.copy(eye).applyQuaternion(quat).add(pos);
  cam.quaternion.copy(quat).multiply(PITCH_DOWN);
  cam.fov = 62;
  // The game draws the cockpit only in its own cockpit view (main.js sets it each frame, before this runs).
  const ck = sim.cockpit;
  if (ck) {
    ck.visible = true;
    if (ck.userData && typeof ck.userData.viewing === 'function') ck.userData.viewing(true);
  }
}

function tower(cam, R, t, dt, pos, look, L, snap) {
  const first = !C.tower;
  if (first) {
    // Off to one side of the way it came in, standing well back — a camera by the runway.
    A.airframeAt(R.start, _a, _qa);
    _d.subVectors(R.centre, _a).setY(0);
    if (_d.lengthSq() < 1) _d.set(1, 0, 0);
    _d.normalize();
    const side = new THREE.Vector3(-_d.z, 0, _d.x);
    const D = Math.max(R.radius * 1.25, L * 3 + 40);
    C.tower = R.centre.clone().addScaledVector(side, D).addScaledVector(_d, -D * 0.35);
    C.tower.y = groundY(C.tower.x, C.tower.z) + 12;
    if (C.tower.y < R.centre.y + 4) C.tower.y = R.centre.y + 4;
  }
  cam.position.copy(C.tower);
  _t.copy(pos).lerp(look, 0.3);
  if (!C.lookHas || snap) C.look.copy(_t);
  else C.look.lerp(_t, ease(dt, 0.15));
  C.lookHas = true;
  cam.lookAt(C.look);
  // Zoomed to frame the aeroplane — never nearer-looking than the orbit, with Reduce flashing (its fov 55 at R.radius).
  const dist = Math.max(1, cam.position.distanceTo(C.look));
  let fov = THREE.MathUtils.radToDeg(2 * Math.atan((L * 2.4 + 10) / dist));
  if (A.FLASH.reduce) fov = Math.max(fov, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(27.5)) * (dist / R.radius))));
  fov = Math.min(55, Math.max(14, fov));
  C.towerFov += (fov - C.towerFov) * (first || snap ? 1 : ease(dt, 0.4));
  cam.fov = C.towerFov;
}

function seedFree(cam, look) {
  _d.subVectors(cam.position, look);
  const dist = Math.max(4, _d.length());
  C.free = { yaw: Math.atan2(_d.z, _d.x), pitch: Math.asin(Math.min(1, Math.max(-1, _d.y / dist))), dist };
}

function free(cam, R, look, L, md) {
  if (!C.free) seedFree(cam, look);
  const F = C.free;
  F.pitch = Math.min(1.45, Math.max(-0.05, F.pitch));
  F.dist = Math.min(600, Math.max(L * 0.8 + 3, F.dist));
  const d = Math.max(F.dist, md);
  const cp = Math.cos(F.pitch);
  cam.position.set(look.x + Math.cos(F.yaw) * cp * d, look.y + Math.sin(F.pitch) * d, look.z + Math.sin(F.yaw) * cp * d);
  keepAbove(cam.position, 2);
  cam.lookAt(look);
  cam.fov = 55;
}

/* ------------------------------------------------------------------ *
 * Choices
 * ------------------------------------------------------------------ */

const replay = () => (A && A.S.replay) || null;
const sim = () => (A && A.S.sim) || null;

export function setCamera(id) {
  if (!CAMS.some((c) => c.id === id)) return P.cam;
  if (id !== P.cam) P.stats.camSwitches++;
  P.cam = id;
  C.has = false;
  C.lookHas = false;
  C.tower = null;
  if (id !== 'free') C.free = null;
  else if (sim() && replay()) seedFree(sim().camera, replay().centre);
  P.menu = false;
  sync();
  return P.cam;
}

export function nextCamera() {
  const i = CAMS.findIndex((c) => c.id === P.cam);
  return setCamera(CAMS[(i + 1) % CAMS.length].id);
}

export function setSpeed(s) {
  const R = replay();
  if (!SPEEDS.includes(s)) return R ? R.speed : P.speed;
  P.speed = s;
  if (R) R.speed = s;
  sync();
  return s;
}

function stepSpeed(dir) {
  const R = replay();
  const now = R ? R.speed : P.speed || A.REPLAY.speed;
  let i = SPEEDS.findIndex((s) => Math.abs(s - now) < 1e-6);
  if (i < 0) i = SPEEDS.findIndex((s) => s >= now);
  return setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, i + dir))]);
}

export function setClean(on) {
  P.clean = on == null ? !P.clean : !!on;
  if (P.clean) P.menu = false;
  try {
    document.documentElement.classList.toggle('replay-clean', P.clean);
  } catch (e) {
    /* no page */
  }
  sync();
  return P.clean;
}

/** The section a video takes: [from, to] in replay time; null is the whole replay. */
export function setSection(from, to) {
  const R = replay();
  if (from == null || !R) P.section = null;
  else {
    const a = Math.max(R.start, Math.min(R.end, Number(from)));
    const b = Math.max(R.start, Math.min(R.end, Number(to)));
    P.section = b - a >= 0.5 ? [a, b] : null;
  }
  sync();
  return P.section;
}

function section(R) {
  const s = P.section;
  if (s && s[0] >= R.start - 1e-6 && s[1] <= R.end + 1e-6) return s;
  return [R.start, R.end];
}

/* ------------------------------------------------------------------ *
 * Keys
 * ------------------------------------------------------------------ */

/** The player's own keys (breakup.js asks first, while a replay plays). The four basic ones are breakup.js's. */
export function key(simRef, code) {
  if (!A || !replay()) return false;
  const k = (id) => A.isKey(simRef, id, code);
  if (k('replayCamera')) {
    nextCamera();
    return true;
  }
  if (k('replaySlower')) {
    stepSpeed(-1);
    return true;
  }
  if (k('replayFaster')) {
    stepSpeed(1);
    return true;
  }
  if (k('replayHideUi')) {
    setClean();
    return true;
  }
  if (k('replayVideo')) {
    openVideo(!P.panel);
    return true;
  }
  // Recording: the timeline is the video's, so the skips wait (pause and close still work).
  if (P.rec && (k('replayBack') || k('replayForward'))) return true;
  // The controls hidden: Escape brings them back first; a menu or the video panel open, Escape shuts it.
  if (P.clean && k('replayClose')) {
    setClean(false);
    return true;
  }
  if ((P.menu || (P.panel && !P.rec)) && k('replayClose')) {
    P.menu = false;
    P.panel = false;
    sync();
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * The screen
 * ------------------------------------------------------------------ */

const SVG = (body, vb = '0 0 24 24') => `<svg viewBox="${vb}" width="22" height="22" aria-hidden="true" focusable="false">${body}</svg>`;
const ICON = {
  play: SVG('<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>'),
  pause: SVG('<rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor"/>'),
  back: SVG('<path d="M11 7l-5 5 5 5M18 7l-5 5 5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
  fwd: SVG('<path d="M13 7l5 5-5 5M6 7l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
  camera: SVG('<path d="M4 8h3l1.6-2h6.8L17 8h3v10H4z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.2" fill="none" stroke="currentColor" stroke-width="1.9"/>'),
  hide: SVG('<path d="M3 12s3.2-6 9-6 9 6 9 6-3.2 6-9 6-9-6-9-6z" fill="none" stroke="currentColor" stroke-width="1.9"/><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M4 20L20 4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'),
  video: SVG('<rect x="3.5" y="6.5" width="12" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M15.5 10.5l5-3v9l-5-3z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>'),
  close: SVG('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
};

const CSS = `
.rp-tag{position:absolute;left:50%;top:12%;transform:translateX(-50%);display:none;align-items:center;gap:10px;padding:8px 16px;border-radius:var(--r-2,14px);
 background:var(--glass-strong,rgba(14,24,42,.78));border:1px solid var(--glass-line,rgba(160,195,240,.16));box-shadow:var(--glass-hi,none);
 -webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);color:var(--text,#eaf1fb);font:700 13px/1.2 var(--font,system-ui,sans-serif);pointer-events:none;z-index:41;white-space:nowrap;max-width:calc(100vw - 24px)}
.rp-tag-dot{width:9px;height:9px;border-radius:50%;background:var(--red,#ff6a5a);flex:none}
.rp-tag-title{letter-spacing:.16em}
.rp-tag-sub{color:var(--text-dim,#9fb2cc);font-weight:600;letter-spacing:.02em;overflow:hidden;text-overflow:ellipsis}
.rp-surface{position:absolute;inset:0;pointer-events:auto;z-index:40;touch-action:none;cursor:grab;background:transparent;display:none}
.rp-surface.is-dragging{cursor:grabbing}
.rp-dock{position:absolute;left:50%;bottom:max(14%,calc(env(safe-area-inset-bottom,0px) + 72px));transform:translateX(-50%);width:min(780px,calc(100vw - 24px));
 display:flex;flex-direction:column;align-items:stretch;gap:8px;pointer-events:none;z-index:42}
.rp-bar{display:none;flex-direction:column;gap:4px;padding:6px 10px 10px;border-radius:var(--r-3,20px);background:var(--glass-strong,rgba(14,24,42,.78));
 border:1px solid var(--glass-line,rgba(160,195,240,.16));box-shadow:var(--shadow,0 18px 50px rgba(0,0,0,.55)),var(--glass-hi,none);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);
 color:var(--text,#eaf1fb);font:600 14px/1 var(--font,system-ui,sans-serif);pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none}
.rp-timeline{display:flex;align-items:center;gap:10px}
.rp-time{font:700 15px/1 var(--mono,'Arial Narrow',sans-serif);font-variant-numeric:tabular-nums;min-width:52px;color:var(--text,#eaf1fb)}
.rp-time.rp-end{text-align:right;color:var(--text-dim,#9fb2cc)}
.rp-track{flex:1;position:relative;height:44px;display:flex;align-items:center;cursor:pointer;touch-action:none;outline:none}
.rp-track:focus-visible .rp-rail{box-shadow:0 0 0 2px var(--accent,#58c6ff)}
.rp-rail{position:relative;width:100%;height:6px;border-radius:3px;background:rgba(255,255,255,.18);pointer-events:none}
.rp-fill{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:3px;background:var(--accent,#58c6ff)}
.rp-section{position:absolute;top:-5px;bottom:-5px;border-radius:4px;background:rgba(255,106,90,.16);border:1px solid rgba(255,106,90,.55);display:none}
.rp-mark{position:absolute;top:50%;width:10px;height:10px;margin:-5px 0 0 -5px;transform:rotate(45deg);border-radius:2px;background:var(--amber,#ffc247);box-shadow:0 0 0 2px rgba(10,17,30,.85)}
.rp-mark.is-hit{background:var(--red,#ff6a5a);width:12px;height:12px;margin:-6px 0 0 -6px}
.rp-mark.is-splash{background:var(--accent,#58c6ff)}
.rp-mark-label{position:absolute;bottom:13px;transform:translateX(-50%);font:700 10px/1 var(--font,system-ui,sans-serif);letter-spacing:.12em;color:var(--red,#ff6a5a);white-space:nowrap}
.rp-knob{position:absolute;top:50%;left:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.5)}
.rp-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px 10px}
.rp-group{display:flex;align-items:center;gap:4px}
.rp-sep{width:1px;align-self:stretch;margin:6px 2px;background:var(--glass-line,rgba(160,195,240,.16))}
.rp-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:44px;height:44px;padding:0 10px;border-radius:var(--r-1,10px);
 border:1px solid var(--glass-line,rgba(160,195,240,.16));background:rgba(255,255,255,.06);color:var(--text,#eaf1fb);font:600 14px/1 var(--font,system-ui,sans-serif);
 cursor:pointer;touch-action:manipulation;text-decoration:none;transition:background var(--dur-1,150ms) var(--ease,ease),border-color var(--dur-1,150ms) var(--ease,ease)}
.rp-btn:hover{background:rgba(88,198,255,.16);border-color:rgba(88,198,255,.5)}
.rp-btn:focus-visible{outline:2px solid var(--accent,#58c6ff);outline-offset:2px}
.rp-btn[disabled],.rp-btn[aria-disabled=true]{opacity:.45;cursor:not-allowed}
.rp-btn.is-on{background:var(--accent,#58c6ff);border-color:var(--accent,#58c6ff);color:#0b1220}
.rp-btn.is-big{min-width:56px;border-radius:50%;width:56px;height:56px;padding:0;background:#fff;color:#0b1220;border-color:#fff}
.rp-btn.is-big:hover{background:#dff2ff}
.rp-btn.is-rec{background:var(--red,#ff6a5a);border-color:var(--red,#ff6a5a);color:#14161a;font-weight:700}
.rp-btn.is-primary{background:var(--accent,#58c6ff);border-color:var(--accent,#58c6ff);color:#0b1220;font-weight:700}
.rp-num{font:700 13px/1 var(--mono,sans-serif)}
.rp-seg{display:flex;padding:3px;gap:2px;border-radius:12px;background:rgba(0,0,0,.25);border:1px solid var(--glass-line,rgba(160,195,240,.16))}
.rp-seg .rp-btn{border-color:transparent;background:transparent;min-width:46px;padding:0 8px;font:700 14px/1 var(--mono,sans-serif)}
.rp-seg .rp-btn.is-on{background:var(--accent,#58c6ff);color:#0b1220}
.rp-label{white-space:nowrap}
.rp-pop{display:none;pointer-events:auto;align-self:center;width:min(520px,100%);max-height:min(52vh,460px);overflow:auto;padding:14px;border-radius:var(--r-2,14px);
 background:var(--glass-solid,rgba(10,17,30,.92));border:1px solid var(--glass-line,rgba(160,195,240,.16));box-shadow:var(--shadow,0 18px 50px rgba(0,0,0,.55));
 color:var(--text,#eaf1fb);font:600 14px/1.35 var(--font,system-ui,sans-serif);touch-action:pan-y}
.rp-pop h3{margin:0 0 10px;font:700 13px/1 var(--font,system-ui,sans-serif);letter-spacing:.14em;text-transform:uppercase;color:var(--text-dim,#9fb2cc)}
.rp-cams{display:none;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.rp-cam{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:4px;height:auto;min-height:58px;padding:8px 12px;text-align:left}
.rp-cam small{font-weight:600;font-size:12px;color:var(--text-dim,#9fb2cc)}
.rp-cam.is-on small{color:#0b1220}
.rp-line{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 10px}
.rp-line > b{min-width:64px;color:var(--text-dim,#9fb2cc);font-weight:600}
.rp-dim{color:var(--text-dim,#9fb2cc);font-size:13px}
.rp-msg{margin:0 0 10px;padding:10px 12px;border-radius:var(--r-1,10px);background:rgba(255,194,71,.12);border:1px solid rgba(255,194,71,.4);color:var(--text,#eaf1fb)}
.rp-msg:empty{display:none}
.rp-msg.is-bad{background:rgba(255,106,90,.12);border-color:rgba(255,106,90,.5)}
.rp-prog{position:relative;height:8px;border-radius:4px;background:rgba(255,255,255,.14);overflow:hidden;margin:0 0 10px}
.rp-prog > i{position:absolute;left:0;top:0;bottom:0;width:0;background:var(--red,#ff6a5a)}
.rp-toggle{display:inline-flex;align-items:center;gap:8px;min-height:44px;cursor:pointer}
.rp-toggle input{width:20px;height:20px;accent-color:var(--accent,#58c6ff)}
.rp-unhide{position:absolute;top:max(12px,env(safe-area-inset-top,0px));right:max(12px,env(safe-area-inset-right,0px));display:none;pointer-events:auto;z-index:43;
 animation:rp-fade 1.2s ease 2.5s forwards}
@keyframes rp-fade{to{opacity:.35}}
html.replay-clean #ui,html.replay-clean #ext-layer > :not(.rp-keep),html.replay-clean .rp-tag,html.replay-clean .rp-dock{visibility:hidden!important}
html.replay-clean .rp-unhide{display:inline-flex}
html.is-replaying .hud-objective{visibility:hidden}
@media (max-width:560px){.rp-label{display:none}.rp-time{min-width:40px;font-size:13px}.rp-bar{padding:4px 8px 8px}.rp-sep{display:none}}
@media (prefers-reduced-motion:reduce){.rp-btn{transition:none}.rp-unhide{animation:none;opacity:.6}}
`;

function el(tag, cls, attrs) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

function button(parent, what, html, label, cls = '') {
  const b = el('button', `rp-btn ${cls}`.trim(), { type: 'button', 'aria-label': label, title: label });
  b.dataset.replay = what;
  b.innerHTML = html;
  parent.appendChild(b);
  return b;
}

function build() {
  if (!document.getElementById('rp-style')) {
    const st = el('style');
    st.id = 'rp-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const layer = A.extLayer();

  const tag = el('div', 'breakup-replay-label rp-tag rp-keep', { role: 'status' });
  tag.innerHTML = '<span class="rp-tag-dot"></span><span class="rp-tag-title">INSTANT REPLAY</span><span class="rp-tag-sub"></span>';

  const surface = el('div', 'rp-surface rp-keep', { 'aria-hidden': 'true' });
  surface.dataset.replay = 'look';

  const dock = el('div', 'rp-dock rp-keep');
  const cams = el('div', 'rp-pop rp-cams-pop', { role: 'menu', 'aria-label': 'Replay camera' });
  cams.innerHTML = '<h3>Camera</h3>';
  const camGrid = el('div', 'rp-cams');
  camGrid.style.display = 'grid';
  cams.appendChild(camGrid);
  const camBtns = {};
  for (const c of CAMS) {
    const b = button(camGrid, 'cam', `<span>${c.name}</span><small>${c.hint}</small>`, `${c.name} camera: ${c.hint.toLowerCase()}`, 'rp-cam');
    b.dataset.cam = c.id;
    b.setAttribute('role', 'menuitemradio');
    b.addEventListener('click', () => setCamera(c.id));
    camBtns[c.id] = b;
  }
  const video = el('div', 'rp-pop rp-video', { role: 'dialog', 'aria-label': 'Save a video of the replay' });

  const bar = el('div', 'breakup-replay-bar rp-bar', { role: 'toolbar', 'aria-label': 'Instant replay' });
  const tl = el('div', 'rp-timeline');
  const tNow = el('span', 'rp-time rp-now');
  const track = el('div', 'rp-track', { role: 'slider', 'aria-label': 'Replay time', tabindex: '0', 'aria-valuemin': '0', 'aria-valuemax': '0', 'aria-valuenow': '0' });
  track.dataset.replay = 'track';
  const rail = el('div', 'rp-rail');
  const sect = el('div', 'rp-section');
  const fill = el('div', 'rp-fill');
  const marks = el('div', 'rp-marks');
  const knob = el('div', 'rp-knob');
  rail.append(sect, fill, marks, knob);
  track.appendChild(rail);
  const tEnd = el('span', 'rp-time rp-end');
  tl.append(tNow, track, tEnd);

  const row = el('div', 'rp-row');
  const transport = el('div', 'rp-group');
  const back = button(transport, 'back', `${ICON.back}<span class="rp-num">5</span>`, 'Back 5 s');
  const pause = button(transport, 'pause', ICON.pause, 'Pause', 'is-big');
  const fwd = button(transport, 'fwd', `<span class="rp-num">5</span>${ICON.fwd}`, 'Forward 5 s');
  const speedSeg = el('div', 'rp-seg', { role: 'radiogroup', 'aria-label': 'Replay speed' });
  const speedBtns = SPEEDS.map((s) => {
    const b = button(speedSeg, 'speed', `${s}×`, `Speed ${s}×`);
    b.dataset.speed = String(s);
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => setSpeed(s));
    return b;
  });
  const tools = el('div', 'rp-group');
  const camBtn = button(tools, 'camera', `${ICON.camera}<span class="rp-label">Orbit</span>`, 'Camera', '');
  camBtn.setAttribute('aria-haspopup', 'menu');
  const hide = button(tools, 'hide', ICON.hide, 'Hide the controls');
  const vid = button(tools, 'video', `${ICON.video}<span class="rp-label">Video</span>`, 'Save a video');
  vid.setAttribute('aria-haspopup', 'dialog');
  const close = button(tools, 'close', ICON.close, 'Close the replay');
  row.append(transport, el('span', 'rp-sep'), speedSeg, el('span', 'rp-sep'), tools);
  bar.append(tl, row);
  dock.append(cams, video, bar);

  const unhide = el('button', 'rp-btn rp-unhide rp-keep', { type: 'button', 'aria-label': 'Show the replay controls', title: 'Show the replay controls' });
  unhide.dataset.replay = 'unhide';
  unhide.innerHTML = `${ICON.hide}<span>Show controls</span>`;

  layer.append(surface, tag, dock, unhide);

  const seekBy = (d) => {
    const R = replay();
    if (!R || P.rec) return;
    A.seek(sim(), R.t + d);
  };
  back.addEventListener('click', () => seekBy(-A.step()));
  fwd.addEventListener('click', () => seekBy(A.step()));
  pause.addEventListener('click', () => {
    const R = replay();
    // At the end, play goes from the start again.
    if (R && R.paused && R.t >= R.end - 1e-3 && !P.rec) A.seek(sim(), R.start);
    A.pause(sim());
  });
  close.addEventListener('click', () => A.end(sim(), true));
  camBtn.addEventListener('click', () => {
    P.menu = !P.menu;
    if (P.menu) P.panel = false;
    sync();
  });
  hide.addEventListener('click', () => setClean(true));
  unhide.addEventListener('click', () => setClean(false));
  vid.addEventListener('click', () => openVideo(!P.panel));

  // Drag the timeline: pointer events work for a mouse and a finger alike.
  let dragging = false;
  let wasPaused = false;
  const at = (ev) => {
    const rect = rail.getBoundingClientRect();
    return rect.width > 0 ? (ev.clientX - rect.left) / rect.width : 0;
  };
  const timeAt = (k) => {
    const R = replay();
    return R ? R.start + Math.min(1, Math.max(0, k)) * (R.end - R.start) : 0;
  };
  track.addEventListener('pointerdown', (ev) => {
    const R = replay();
    if (!R || P.rec) return;
    dragging = true;
    wasPaused = R.paused;
    R.paused = true;
    try {
      track.setPointerCapture(ev.pointerId);
    } catch (e) {
      /* no capture: moves still arrive while over it */
    }
    A.seek(sim(), timeAt(at(ev)));
    ev.preventDefault();
  });
  track.addEventListener('pointermove', (ev) => {
    if (!dragging || !replay()) return;
    A.seek(sim(), timeAt(at(ev)));
  });
  const release = () => {
    if (!dragging) return;
    dragging = false;
    const R = replay();
    if (R) R.paused = wasPaused;
    sync();
  };
  track.addEventListener('pointerup', release);
  track.addEventListener('pointercancel', release);
  track.addEventListener('lostpointercapture', release);

  // The picture: drag to look round (free look), pinch or wheel for distance, a tap brings hidden controls back.
  const pts = new Map();
  let moved = 0;
  let pinch0 = 0;
  let dist0 = 0;
  surface.addEventListener('pointerdown', (ev) => {
    if (!replay()) return;
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pts.size === 1) moved = 0;
    if (pts.size === 2) {
      const [p, q] = [...pts.values()];
      pinch0 = Math.hypot(p.x - q.x, p.y - q.y) || 1;
      dist0 = C.free ? C.free.dist : 0;
    }
    try {
      surface.setPointerCapture(ev.pointerId);
    } catch (e) {
      /* fine */
    }
    if (P.menu || P.panel) {
      P.menu = false;
      if (!P.rec) P.panel = false;
      sync();
    }
    ev.preventDefault();
  });
  const toFree = () => {
    if (P.cam === 'free') return;
    const s = sim();
    const R = replay();
    if (s && R) {
      // Free look from where the camera stands now, round the point the orbit looks at.
      _t.copy(s.camera.position);
      P.cam = 'free';
      P.stats.camSwitches++;
      C.free = null;
      const look = new THREE.Vector3();
      A.airframeAt(Math.min(R.t, R.end), look, _qa);
      look.lerp(R.centre, Math.min(1, Math.max(0, (Math.min(R.t, R.end) - R.start) / Math.max(0.5, R.end - R.start))) * 0.6);
      _d.subVectors(_t, look);
      const dist = Math.max(4, _d.length());
      C.free = { yaw: Math.atan2(_d.z, _d.x), pitch: Math.asin(Math.min(1, Math.max(-1, _d.y / dist))), dist };
      sync();
    }
  };
  surface.addEventListener('pointermove', (ev) => {
    const p = pts.get(ev.pointerId);
    if (!p || !replay()) return;
    const dx = ev.clientX - p.x;
    const dy = ev.clientY - p.y;
    p.x = ev.clientX;
    p.y = ev.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (moved < 5) return;
    toFree();
    if (!C.free) return;
    if (pts.size >= 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      if (dist0) C.free.dist = dist0 * (pinch0 / d);
    } else {
      C.free.yaw += dx * 0.006;
      C.free.pitch += dy * 0.005;
      P.stats.drags++;
    }
    surface.classList.add('is-dragging');
  });
  const lift = (ev) => {
    pts.delete(ev.pointerId);
    if (pts.size) return;
    surface.classList.remove('is-dragging');
    if (moved < 5 && P.clean) setClean(false);
  };
  surface.addEventListener('pointerup', lift);
  surface.addEventListener('pointercancel', lift);
  surface.addEventListener('wheel', (ev) => {
    if (!replay()) return;
    toFree();
    if (C.free) C.free.dist *= Math.exp(Math.max(-1, Math.min(1, ev.deltaY / 400)));
    ev.preventDefault();
  }, { passive: false });

  P.ui = { tag, sub: tag.querySelector('.rp-tag-sub'), surface, dock, bar, cams, camGrid, camBtns, video, tl, tNow, tEnd, track, rail, sect, fill, marks, knob, back, pause, fwd, speedBtns, camBtn, hide, vid, close, unhide };
}

/** The impact, the fires and the splash, marked on the timeline. */
function markEvents(R) {
  const ui = P.ui;
  const r = A.S.rec;
  ui.marks.textContent = '';
  if (!r) return;
  const span = R.end - R.start || 1;
  const at = (t) => `${Math.round((1000 * (t - R.start)) / span) / 10}%`;
  const add = (t, cls, title) => {
    if (t < R.start || t > R.end) return;
    const m = el('i', `rp-mark ${cls}`, { title });
    m.style.left = at(t);
    ui.marks.appendChild(m);
  };
  const seen = [];
  const near = (t) => seen.some((s) => Math.abs(s - t) < span * 0.03);
  const moments = A.flashMoments(r) || [0];
  const water = !!(r.wreck && r.wreck.inWater);
  const splash = r.fx.find((e) => e.name === 'splash');
  if (splash && !near(splash.t) && Math.abs(splash.t) > 0.05) {
    add(splash.t, 'is-splash', 'Splash');
    seen.push(splash.t);
  }
  for (const t of moments) {
    if (t === 0 || near(t)) continue;
    add(t, '', water && Math.abs(t - 0.85) < 1e-6 ? 'The fuel catches' : 'Fire');
    seen.push(t);
  }
  add(0, 'is-hit', 'Impact');
  const lab = el('span', 'rp-mark-label');
  lab.textContent = /land|touch/i.test(String(r.reason || '')) ? 'TOUCHDOWN' : 'IMPACT';
  lab.style.left = at(0);
  if (0 >= R.start && 0 <= R.end) ui.marks.appendChild(lab);
  ui.markCount = ui.marks.querySelectorAll('.rp-mark').length;
}

function keyHints(simRef) {
  const ui = P.ui;
  const n = (id) => {
    try {
      return A.keyName(id, simRef);
    } catch (e) {
      return '';
    }
  };
  const set = (b, text, id) => {
    const k = id ? n(id) : '';
    const s = k ? `${text} (${k})` : text;
    b.title = s;
    b.setAttribute('aria-label', s);
  };
  set(ui.back, `Back ${A.step()} s`, 'replayBack');
  set(ui.fwd, `Forward ${A.step()} s`, 'replayForward');
  set(ui.close, 'Close the replay', 'replayClose');
  set(ui.hide, 'Hide the controls', 'replayHideUi');
  set(ui.vid, 'Save a video', 'replayVideo');
  set(ui.camBtn, 'Camera', 'replayCamera');
  set(ui.speedBtns[0], `Speed ${SPEEDS[0]}× — slower`, 'replaySlower');
  set(ui.speedBtns[SPEEDS.length - 1], `Speed ${SPEEDS[SPEEDS.length - 1]}× — faster`, 'replayFaster');
  P.pauseKey = n('replayPause');
}

/** Show or hide the player (breakup.js, as a replay starts and ends). */
export function show(on, simRef) {
  if (typeof document === 'undefined') return;
  if (!on) {
    if (!P.ui) return;
    if (P.rec) cancelRecording('closed');
    P.menu = false;
    P.panel = false;
    P.section = null;
    P.note = '';
    P.msg = '';
    if (P.clean) setClean(false);
    dropVideo();
    for (const k of ['tag', 'surface']) P.ui[k].style.display = 'none';
    P.ui.bar.style.display = 'none';
    P.ui.cams.style.display = 'none';
    P.ui.video.style.display = 'none';
    P.cache = {};
    C.R = null;
    return;
  }
  const R = replay();
  if (!R) return;
  if (!P.ui) build();
  P.stats.shows++;
  if (P.speed != null) R.speed = P.speed;
  R.hold = false;
  keyHints(simRef || sim());
  markEvents(R);
  P.ui.tag.style.display = 'flex';
  P.ui.surface.style.display = 'block';
  P.ui.bar.style.display = 'flex';
  P.cache = {};
  sync();
}

function fmt(t) {
  return `${t < 0 ? '−' : '+'}${Math.abs(t).toFixed(1)} s`;
}

/** Bring the screen up to date with the replay (every replay frame, and after any change). */
export function sync() {
  const R = replay();
  const ui = P.ui;
  if (!R || !ui) return;
  const c = P.cache;
  const span = R.end - R.start || 1;
  const k = Math.min(1, Math.max(0, (R.t - R.start) / span));
  const pct = `${Math.round(1000 * k) / 10}%`;
  if (c.pct !== pct) {
    c.pct = pct;
    ui.fill.style.width = pct;
    ui.knob.style.left = pct;
  }
  const now = fmt(Math.min(R.t, R.end));
  if (c.now !== now) {
    c.now = now;
    ui.tNow.textContent = now;
    ui.track.setAttribute('aria-valuenow', (Math.round(R.t * 10) / 10).toString());
    ui.track.setAttribute('aria-valuetext', now);
  }
  const end = fmt(R.end);
  if (c.end !== end) {
    c.end = end;
    ui.tEnd.textContent = end;
    ui.track.setAttribute('aria-valuemin', (Math.round(R.start * 10) / 10).toString());
    ui.track.setAttribute('aria-valuemax', (Math.round(R.end * 10) / 10).toString());
  }
  if (c.paused !== R.paused) {
    c.paused = R.paused;
    ui.pause.innerHTML = R.paused ? ICON.play : ICON.pause;
    const label = `${R.paused ? 'Play' : 'Pause'}${P.pauseKey ? ` (${P.pauseKey})` : ''}`;
    ui.pause.setAttribute('aria-label', label);
    ui.pause.title = label;
  }
  if (c.speed !== R.speed) {
    c.speed = R.speed;
    for (const b of ui.speedBtns) {
      const on = Math.abs(Number(b.dataset.speed) - R.speed) < 1e-6;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }
  const cam = CAMS.find((x) => x.id === P.cam) || CAMS[0];
  if (c.cam !== cam.id) {
    c.cam = cam.id;
    ui.camBtn.querySelector('.rp-label').textContent = cam.name;
    for (const id in ui.camBtns) {
      ui.camBtns[id].classList.toggle('is-on', id === cam.id);
      ui.camBtns[id].setAttribute('aria-checked', id === cam.id ? 'true' : 'false');
    }
  }
  const sub = P.rec ? `● Recording ${Math.round(recProgress(R) * 100)}%` : P.note || `${cam.name} camera · ${R.speed}×${R.paused ? ' · paused' : ''}`;
  if (c.sub !== sub) {
    c.sub = sub;
    ui.sub.textContent = sub;
  }
  const menu = P.menu && !P.clean;
  if (c.menu !== menu) {
    c.menu = menu;
    ui.cams.style.display = menu ? 'block' : 'none';
    ui.camBtn.classList.toggle('is-on', menu);
    ui.camBtn.setAttribute('aria-expanded', menu ? 'true' : 'false');
  }
  const panel = P.panel && !P.clean;
  if (c.panel !== panel) {
    c.panel = panel;
    ui.video.style.display = panel ? 'block' : 'none';
    ui.vid.classList.toggle('is-on', panel);
    ui.vid.setAttribute('aria-expanded', panel ? 'true' : 'false');
  }
  const sect = P.section;
  const sk = sect ? `${sect[0]}:${sect[1]}:${R.start}:${R.end}` : '';
  if (c.sect !== sk) {
    c.sect = sk;
    ui.sect.style.display = sect ? 'block' : 'none';
    if (sect) {
      ui.sect.style.left = `${(100 * (sect[0] - R.start)) / span}%`;
      ui.sect.style.width = `${(100 * (sect[1] - sect[0])) / span}%`;
    }
  }
  const locked = !!P.rec;
  if (c.locked !== locked) {
    c.locked = locked;
    for (const b of [ui.back, ui.fwd]) b.disabled = locked;
    ui.track.setAttribute('aria-disabled', locked ? 'true' : 'false');
  }
  // While it records: the end of the section stops it, and pausing the replay pauses the video too.
  if (P.rec && !P.rec.stopping) {
    if (R.t >= P.rec.to - 1e-4 || (R.paused && R.t >= R.end - 1e-3)) finishRecording();
    else if (!!P.rec.held !== !!R.paused) {
      P.rec.held = !!R.paused;
      try {
        if (R.paused) P.rec.rec.pause();
        else P.rec.rec.resume();
      } catch (e) {
        /* a recorder that cannot pause records the still picture */
      }
    }
  }
  if (P.panel) syncVideo(R);
  R.hold = !!(P.panel || P.rec);
}

/* ------------------------------------------------------------------ *
 * The video (./replay-video.js does the recording)
 * ------------------------------------------------------------------ */

function loadVideo() {
  if (!P.videoP) {
    P.videoP = import('./replay-video.js').then((m) => {
      P.video = m;
      P.cache.vk = null;
      sync();
      return m;
    });
    P.videoP.catch(() => {
      P.videoP = null;
    });
  }
  return P.videoP;
}

function canvasOf() {
  const s = sim();
  return (s && s.renderer && s.renderer.domElement) || null;
}

/** What the game's sound can give a video: a tap on the mixer's output (no new sound is played), or why not. */
function soundTap() {
  const s = sim();
  const mx = s && s.audio && s.audio.mixer;
  if (s && s.settings && s.settings.muted) return { why: 'Sound is off in the game, so the video will be silent.' };
  if (!mx || !mx.ctx || !mx.ceiling) return { why: 'The game has no sound running yet, so the video will be silent.' };
  if (mx.muted) return { why: 'Sound is off in the game, so the video will be silent.' };
  if (typeof mx.ctx.createMediaStreamDestination !== 'function') return { why: "This browser can't record the game's sound; the video will be silent." };
  if (mx.ctx.state !== 'running') return { why: 'The game\'s sound is paused, so the video will be silent.' };
  return { ok: true, mx };
}

function openTap(tap) {
  if (!tap || !tap.ok) return null;
  try {
    const dest = tap.mx.ctx.createMediaStreamDestination();
    tap.mx.ceiling.connect(dest);
    const track = dest.stream.getAudioTracks()[0] || null;
    return {
      track,
      close() {
        try {
          tap.mx.ceiling.disconnect(dest);
        } catch (e) {
          /* already gone */
        }
      },
    };
  } catch (e) {
    return null;
  }
}

export function openVideo(on = true) {
  if (!P.ui || !replay()) return false;
  P.panel = !!on || !!P.rec;
  if (P.panel) {
    P.menu = false;
    if (P.clean) setClean(false);
    buildVideo();
    loadVideo().catch(() => {
      P.msg = "The video recorder didn't load. Check the connection and try again.";
      P.cache.vk = null;
      sync();
    });
  }
  sync();
  return P.panel;
}

function buildVideo() {
  const v = P.ui.video;
  if (v.dataset.built) return;
  v.dataset.built = '1';
  v.innerHTML = `
    <h3>Save a video</h3>
    <p class="rp-msg" data-v="msg" role="status" aria-live="polite"></p>
    <div class="rp-line"><b>Section</b><span data-v="section"></span></div>
    <div class="rp-line"></div>
    <div class="rp-line"><b>Frames</b><span class="rp-seg" data-v="fps" role="radiogroup" aria-label="Frames per second"></span><span class="rp-dim" data-v="format"></span></div>
    <div class="rp-line"><label class="rp-toggle"><input type="checkbox" data-v="sound"><span>Include game sound</span></label><span class="rp-dim" data-v="soundwhy"></span></div>
    <div class="rp-prog" data-v="prog" hidden><i></i></div>
    <div class="rp-line" data-v="actions"></div>
    <p class="rp-dim" data-v="foot">The replay plays in real time at the speed you chose while it records; only the game picture is in the video, not these controls.</p>`;
  const q = (k) => v.querySelector(`[data-v="${k}"]`);
  const lines = v.querySelectorAll('.rp-line');
  const sectBtns = lines[1];
  const mk = (parent, what, text, label, fn, cls) => {
    const b = button(parent, what, text, label, cls);
    b.addEventListener('click', fn);
    return b;
  };
  const inBtn = mk(sectBtns, 'in', 'Start here', 'Start the video at the time shown now', () => {
    const R = replay();
    if (!R) return;
    const s = section(R);
    setSection(R.t, Math.max(R.t + 0.5, s[1]));
  });
  const outBtn = mk(sectBtns, 'out', 'End here', 'End the video at the time shown now', () => {
    const R = replay();
    if (!R) return;
    const s = section(R);
    setSection(Math.min(s[0], R.t - 0.5), R.t);
  });
  const allBtn = mk(sectBtns, 'all', 'Whole replay', 'Use the whole replay', () => setSection(null));
  const fpsBtns = FPS_CHOICES.map((f) => {
    const b = mk(q('fps'), 'fps', `${f} fps`, `${f} frames a second`, () => {
      P.fps = f;
      P.cache.vk = null;
      sync();
    });
    b.dataset.fps = String(f);
    b.setAttribute('role', 'radio');
    return b;
  });
  const sound = q('sound');
  sound.addEventListener('change', () => {
    P.sound = !!sound.checked;
  });
  const acts = q('actions');
  const rec = mk(acts, 'record', '<span aria-hidden="true">●</span> Record video', 'Record the section as a video', () => startRecording(), 'is-rec');
  const cancel = mk(acts, 'cancel', 'Cancel', 'Stop recording and throw it away', () => cancelRecording('cancelled'));
  const save = el('a', 'rp-btn is-primary', { role: 'button' });
  save.dataset.replay = 'save';
  save.textContent = 'Save video';
  acts.appendChild(save);
  const share = mk(acts, 'share', 'Share…', 'Share the video (save it to Photos on an iPad)', () => shareVideo());
  P.ui.v = { msg: q('msg'), section: q('section'), format: q('format'), sound, soundWhy: q('soundwhy'), prog: q('prog'), bar: q('prog').firstElementChild, inBtn, outBtn, allBtn, fpsBtns, rec, cancel, save, share };
}

function recProgress(R) {
  if (!P.rec) return 0;
  return Math.min(1, Math.max(0, (R.t - P.rec.from) / Math.max(0.01, P.rec.to - P.rec.from)));
}

function prettySize(n) {
  return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
}

function syncVideo(R) {
  const v = P.ui.v;
  if (!v) return;
  const s = section(R);
  const rate = R.speed || 1;
  const sup = P.video ? P.video.support(canvasOf()) : null;
  const tap = soundTap();
  const cv = canvasOf();
  const w = cv ? cv.width : 0;
  const h = cv ? cv.height : 0;
  const key = [s[0], s[1], rate, P.fps, !!P.rec, P.rec ? Math.round(recProgress(R) * 100) : 0, P.last ? P.last.url : '', P.msg, sup ? sup.ok + sup.mime : '-', tap.ok, P.sound, w, h].join('|');
  if (P.cache.vk === key) return;
  P.cache.vk = key;
  const dur = s[1] - s[0];
  v.section.textContent = `${fmt(s[0])} → ${fmt(s[1])} · ${dur.toFixed(1)} s of replay, a ${(dur / rate).toFixed(1)} s video at ${rate}×`;
  for (const b of v.fpsBtns) {
    const on = Number(b.dataset.fps) === P.fps;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.disabled = !!P.rec;
  }
  let msg = P.msg;
  let bad = false;
  if (!msg && sup && !sup.ok) {
    msg = sup.why;
    bad = true;
  }
  if (!msg && !sup) msg = 'Getting the recorder ready…';
  v.msg.textContent = msg;
  v.msg.classList.toggle('is-bad', bad || /can't|didn't|failed|wrong/i.test(msg));
  v.format.textContent = sup && sup.ok ? `${sup.label} · ${w}×${h}` : '';
  v.sound.checked = !!(P.sound && tap.ok);
  v.sound.disabled = !tap.ok || !!P.rec;
  v.soundWhy.textContent = tap.ok ? '' : tap.why;
  const recording = !!P.rec;
  v.prog.hidden = !recording;
  if (recording) v.bar.style.width = `${Math.round(recProgress(R) * 1000) / 10}%`;
  v.rec.style.display = recording ? 'none' : '';
  v.rec.disabled = !(sup && sup.ok);
  v.rec.innerHTML = P.last ? '<span aria-hidden="true">●</span> Record again' : '<span aria-hidden="true">●</span> Record video';
  v.cancel.style.display = recording ? '' : 'none';
  for (const b of [v.inBtn, v.outBtn, v.allBtn]) b.disabled = recording;
  const ready = !!(P.last && !recording);
  v.save.style.display = ready ? '' : 'none';
  if (ready) {
    v.save.href = P.last.url;
    v.save.download = P.last.name;
    v.save.textContent = `Save video (${prettySize(P.last.size)})`;
    v.save.title = `Save ${P.last.name}`;
  }
  v.share.style.display = ready && canShareFile() ? '' : 'none';
}

function canShareFile() {
  try {
    if (!P.last || typeof navigator === 'undefined' || typeof navigator.canShare !== 'function' || typeof File !== 'function') return false;
    return navigator.canShare({ files: [new File([P.last.blob], P.last.name, { type: P.last.type })] });
  } catch (e) {
    return false;
  }
}

async function shareVideo() {
  if (!P.last) return;
  try {
    await navigator.share({ files: [new File([P.last.blob], P.last.name, { type: P.last.type })], title: 'Island Flight Simulator replay' });
  } catch (e) {
    /* the player closed the share sheet */
  }
}

function dropVideo() {
  if (P.last && P.last.url) {
    try {
      URL.revokeObjectURL(P.last.url);
    } catch (e) {
      /* fine */
    }
  }
  P.last = null;
}

function aircraftName() {
  const s = sim();
  const t = s && s.aircraftType;
  return (t && (t.id || t.name)) || 'aircraft';
}

/**
 * Record the section: back to its start, play it at the chosen pace in real
 * time, and stop at its end. Resolves with the video (or null) when it stops.
 */
export async function startRecording() {
  const R = replay();
  if (!R || P.rec) return null;
  P.msg = '';
  let V;
  try {
    V = await loadVideo();
  } catch (e) {
    P.msg = "The video recorder didn't load. Check the connection and try again.";
    P.stats.failed++;
    sync();
    return null;
  }
  const cv = canvasOf();
  const sup = V.support(cv);
  if (!sup.ok || replay() !== R) {
    P.cache.vk = null;
    sync();
    return null;
  }
  const [from, to] = section(R);
  const tap = P.sound ? openTap(soundTap()) : null;
  let rec;
  try {
    rec = V.startRecorder({ canvas: cv, fps: P.fps, mime: sup.mime, audioTrack: tap && tap.track });
  } catch (e) {
    if (tap) tap.close();
    P.msg = `Recording failed to start: ${(e && e.message) || e}`;
    P.stats.failed++;
    sync();
    return null;
  }
  dropVideo();
  P.rec = { rec, from, to, tap, ext: sup.ext, type: sup.mime.split(';')[0], stopping: false, t0: Date.now() };
  P.rec.done = new Promise((res) => {
    P.rec.resolve = res;
  });
  P.stats.recordings++;
  const done = P.rec.done;
  rec.onerror = (err) => {
    P.msg = `Something went wrong while recording (${(err && err.message) || 'recorder error'}). Try again, or try 30 fps.`;
    P.stats.failed++;
    cancelRecording('error');
  };
  A.seek(sim(), from);
  R.paused = false;
  P.cache = {};
  sync();
  return done;
}

async function finishRecording() {
  const r = P.rec;
  if (!r || r.stopping) return;
  r.stopping = true;
  const R = replay();
  if (R) R.paused = true;
  let blob = null;
  try {
    blob = await r.rec.stop();
  } catch (e) {
    P.msg = `The video couldn't be finished: ${(e && e.message) || e}`;
    P.stats.failed++;
  }
  if (r.tap) r.tap.close();
  if (P.rec === r) P.rec = null;
  if (blob && blob.size > 0) {
    const name = P.video.fileName(aircraftName(), r.ext);
    P.last = { blob, name, type: blob.type || r.type, size: blob.size, url: URL.createObjectURL(blob), ms: Date.now() - r.t0 };
    P.msg = `Done: ${name}. Tap Save video to keep it.`;
  } else if (!P.msg) {
    P.msg = "The browser made an empty video, so there is nothing to save. Try again, or try 30 fps.";
    P.stats.failed++;
  }
  P.cache = {};
  sync();
  r.resolve(P.last && blob ? P.last : null);
}

export function cancelRecording(why = 'cancelled') {
  const r = P.rec;
  if (!r) return;
  P.rec = null;
  try {
    r.rec.cancel();
  } catch (e) {
    /* already stopped */
  }
  if (r.tap) r.tap.close();
  if (why === 'cancelled') P.stats.cancelled++;
  const R = replay();
  if (R) R.paused = true;
  P.cache = {};
  sync();
  r.resolve(null);
}

/** For the tests and the console. */
export function debug() {
  const ui = P.ui;
  return {
    P,
    C,
    built: !!ui,
    cam: P.cam,
    camNow: replay() ? camAt(replay().t) : null,
    speed: replay() ? replay().speed : P.speed,
    clean: P.clean,
    menu: P.menu,
    panel: P.panel,
    section: P.section ? P.section.slice() : null,
    recording: P.rec ? { from: P.rec.from, to: P.rec.to, stopping: P.rec.stopping, progress: replay() ? recProgress(replay()) : 0 } : null,
    last: P.last ? { name: P.last.name, type: P.last.type, size: P.last.size, url: P.last.url, ms: P.last.ms } : null,
    lastBlob: P.last ? P.last.blob : null,
    msg: P.msg,
    note: P.note,
    marks: ui ? ui.markCount || 0 : 0,
    videoLoaded: !!P.video,
    support: P.video ? P.video.support(canvasOf()) : null,
    sound: soundTap(),
    stats: { ...P.stats },
    reset() {
      P.cam = 'orbit';
      P.speed = null;
      P.fps = 30;
      P.sound = true;
      P.section = null;
      P.msg = '';
      if (P.clean) setClean(false);
    },
    loadVideo,
  };
}
