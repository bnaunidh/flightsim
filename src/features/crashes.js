/**
 * CUSTOM CRASHES — "custom crashe" and "crashes show on minimap", from the
 * owner's list.
 *
 * A crash used to be one thing: a bang, a banner that said "Crashed" and the
 * aeroplane sitting where it hit. Now the way you hit decides what happens,
 * and each one is its own little cartoon:
 *
 *   CARTWHEEL   a wing tip digs in fast — it rolls tip over tip along the
 *               ground and ends upside down.            "KA-TUMBLE!"
 *   BELLY FLOP  flat and fast — it slaps down, bounces and skids, leaving a
 *               skid mark.                                   "FWUMP!"
 *   SPLASH      the sea — it ducks under and bobs back up like a cork, in a
 *               burst of spray and a ring.                 "SPLOOSH!"
 *   WING CLIP   a wing tip, slower — it spins round like a top on the tip.
 *                                                            "WHIRRR!"
 *   NOSE PLANT  steep — it sticks in nose first, tail up, and wobbles.
 *                                                             "THUNK!"
 *   BONK        a building — it bounces off and sits there seeing stars.
 *                                                              "BONK!"
 *
 * (which is which: ./crashes/kinds.js; how each moves: ./crashes/motion.js;
 * the dust, spray, stars, skid and comic word: ./crashes/fx.js)
 *
 * Every crash gets a CRASH CAM: two seconds of camera from beside the wreck
 * so you actually see the cartwheel, then the debrief comes up as before.
 * Changing the view skips it, the same rule as the bomb cam. The banner and
 * the debrief say what kind of crash it was and add a one-line joke — about
 * the aeroplane, never the pilot — under the flight model's own reason,
 * which still says what went wrong.
 *
 * And every crash leaves a mark on the MINIMAP where it happened (see
 * ./crashes/marks.js for how that stays tidy), which fades after a minute or
 * so. A crash another player has in multiplayer arrives through
 * ../game/happenings.js and is marked in their colour.
 *
 * A mayday that ends on the ground is left alone: the brace sequence writes
 * its own ending, and a joke on top of "everyone walked away" would be wrong.
 * The mark still goes on the map.
 *
 * WIRING, all through the plug-in layer: a listener on the aircraft's own
 * CRASH event (after main.js's, so the wreck and the banner are already
 * there), the update/camera/startMode/stop hooks, and three small wrappers
 * that pass straight through when this feature is switched off — the
 * minimap's frame() (to draw the marks after it has drawn itself), the
 * menus' showDebrief() (to put the crash's name on it) and the game's
 * triggerNatural() (so a summoned disaster is a happening other players can
 * be told about).
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension, extLayer, extStatus } from '../game/extensions.js';
import { heightAt, platformAt, MAP } from '../world/terrain.js';
import { SPEC, EVENTS } from '../aircraft/physics.js';
import { findEvent, SELECTABLE_EVENTS } from '../game/disasters.js';
import { emitHappening, setHappeningReceiver, setSummonPoint } from '../game/happenings.js';
import { KINDS, KIND_IDS, classifyCrash, pickCaption, titleFor } from './crashes/kinds.js';
import { makeScript, poseAt, dimsFrom, CRASH_SECONDS } from './crashes/motion.js';
import { CrashFx } from './crashes/fx.js';
import { shakeClock } from '../render/flash-safety.js';
import { CrashMarks, drawCrashMarks } from './crashes/marks.js';
import { renderedHeight } from './explosions.js';

export const CRASH_CAM_SECONDS = 2.1;
const MINIMAP_SIZE = 190;

const WORD_FILL = {
  cartwheel: '#ffd23f',
  bellyflop: '#ffb347',
  splash: '#7fd8ff',
  wingclip: '#b8f05a',
  noseplant: '#ffd23f',
  bonk: '#ff9ec4',
  midair: '#ffd23f',
};

const C = {
  sim: null,
  fx: null,
  marks: new CrashMarks(),
  newestMine: null,
  script: null,
  target: null,
  bodyScale: 1,
  crash: null,
  lastCaption: null,
  clock: 0,
  listenedOn: null,
  emitAcc: 0,
  lastSlams: 0,
  starsShown: false,
  dims: null,
  replaying: false,
  summoning: false,
  armedSeen: {},
  warned: false,
  stats: { crashes: 0, byKind: {}, remote: 0 },
};

const CAM = { active: false, t: 0, life: CRASH_CAM_SECONDS, view: null, ang: 0, dist: 30, h: 12, ax: 0, ay: 0, az: 0, shake: 0, el: null, bar: null, barW: 100 };

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _look = new THREE.Vector3();

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function live() {
  try {
    const me = extStatus().find((e) => e.id === 'crashes');
    return !me || me.live;
  } catch (e) {
    return true;
  }
}

function drawnHeight(x, z) {
  try {
    const q = (C.sim && C.sim.settings && C.sim.settings.quality) || 'high';
    const h = renderedHeight(x, z, q);
    if (Number.isFinite(h)) return h;
  } catch (e) {
    /* fall through */
  }
  return heightAt(x, z);
}

/** What the wreck lies on: the drawn ground, the sea surface, or a deck. */
function groundAt(x, z) {
  let h = Math.max(0, drawnHeight(x, z));
  const deck = platformAt(x, z);
  if (deck && deck.y > h) h = deck.y;
  return h;
}

function isHeli() {
  return !!(SPEC && SPEC.rotor);
}

function mapId() {
  return (MAP && MAP.id) || null;
}

/* ------------------------------------------------------------------ *
 * The moment of impact.
 * ------------------------------------------------------------------ */

function onCrash(c) {
  // The aircraft's emitter is outside the plug-in fence: nothing thrown here
  // may reach the flight model.
  if (!live()) return;
  try {
    handleCrash(C.sim, c || {});
  } catch (err) {
    if (!C.warned) console.warn('[crashes] the custom crash could not start; the ordinary one carries on:', err);
    C.warned = true;
  }
}

function handleCrash(sim, c) {
  if (!sim || !sim.aircraft || sim.mode === 'drive') return;
  const ac = sim.aircraft;
  const vehicle = isHeli() ? 'heli' : 'plane';
  const vel = c.impactVel || ac.vel;
  _f.set(0, 0, -1).applyQuaternion(ac.quat);
  _r.set(1, 0, 0).applyQuaternion(ac.quat);
  const gh = heightAt(ac.pos.x, ac.pos.z);
  const overWater = gh < 0 && !platformAt(ac.pos.x, ac.pos.z);
  const surface = groundAt(ac.pos.x, ac.pos.z);
  const contact = c.contact || {};
  const dims = dimsFrom(SPEC && SPEC.hardPoints, sim.aircraftType && sim.aircraftType.plan);
  const info = {
    size: dims.semi,
    reason: c.reason,
    part: contact.part,
    surface: contact.surfaceKind,
    vel,
    forward: _f,
    right: _r,
    agl: ac.pos.y - surface,
    overWater,
  };
  const cls = classifyCrash(info);
  const kind = cls.kind;
  const caption = pickCaption(kind, C.lastCaption);
  C.lastCaption = caption;
  const title = titleFor(kind, vehicle);
  const quiet = !!(sim.bracing || sim.braceRescueT);
  C.crash = { kind, caption, title, reason: c.reason || '', vehicle, quiet, x: ac.pos.x, z: ac.pos.z, real: now() };
  C.stats.crashes++;
  C.stats.byKind[kind] = (C.stats.byKind[kind] || 0) + 1;

  // On the map, and out to anybody listening.
  C.newestMine = C.marks.add({ x: ac.pos.x, z: ac.pos.z, kind, map: mapId(), mine: true, now: C.clock });
  emitHappening({ type: 'crash', kind, vehicle, x: round1(ac.pos.x), z: round1(ac.pos.z), map: mapId() });

  if (quiet) return;

  /*
   * A cartoon crash goes "poof", not "boom". wreck.js's fireball, firelight
   * and smoke column are the realistic crash, and from a crash cam 25 m away
   * the light alone whites out the whole picture; so a custom crash clears
   * it (clear() is the wreck's own reset) and ./crashes/fx.js puts a cartoon
   * cloud, and a wisp that keeps curling up off the wreck, in its place.
   */
  if (sim.wreck && typeof sim.wreck.clear === 'function') sim.wreck.clear();

  // The choreography.
  C.dims = dims;
  startScript(sim, kind, cls, vel, dims, info.agl);

  // The cartoon.
  const fx = C.fx;
  if (fx) {
    fx.clear();
    fx.scale = clamp(dims.L / 9, 0.8, 3.5);
    const p = _v.set(ac.pos.x, surface, ac.pos.z);
    const camDist = camDistance(dims);
    const above = new THREE.Vector3(ac.pos.x, Math.max(ac.pos.y, surface) + dims.r + 2 + camDist * 0.16, ac.pos.z);
    fx.showWord(KINDS[kind].word, WORD_FILL[kind], above, camDist);
    if (kind === 'splash') {
      p.y = 0.2;
      fx.burst('spray', p, 46, 9, 1.6, dims.r * 2);
      fx.showRing(p.x, p.z, Math.max(8, dims.L * 0.9));
    } else if (kind === 'noseplant') {
      // Where the nose is, not where the middle of the aeroplane is.
      _r.set(0, dims.noseY, dims.noseZ).applyQuaternion(ac.quat).add(ac.pos);
      p.set(_r.x, groundAt(_r.x, _r.z), _r.z);
      fx.burst('poof', p, 7, 3, 0.5, 2);
      fx.burst('dirt', p, 28, 8, 1.5, 1);
      fx.burst('dust', p, 10, 3.5, 0.6, 2);
    } else if (kind === 'bonk') {
      p.y = ac.pos.y;
      fx.burst('poof', p, 6, 2.5, 0.3, 2);
      fx.burst('spark', p, 18, 7, 0.8, 1);
    } else {
      fx.burst('poof', p, 9, 3.5, 0.5, dims.r * 2);
      fx.burst('dust', p, 12, 4.5, 0.6, dims.r * 2);
      fx.burst('spark', p, 8, 6, 0.9, 1);
      if (kind === 'bellyflop') fx.startSkid(Math.max(1, dims.r * 1.6));
      if (kind === 'wingclip') fx.startSkid(0.7);
    }
  }
  C.emitAcc = 0;
  C.lastSlams = 0;
  C.starsShown = false;
  C.wispLeft = kind === 'splash' ? 0 : 30;
  C.wispAcc = 0;

  // The words. main.js has just put up "Crashed" and the reason; this is the
  // same banner with the crash's name and a joke over the reason.
  if (sim.hud && sim.hud.showBanner) {
    sim.hud.showBanner(
      esc(title),
      `${esc(caption)}<div style="opacity:0.72;font-size:12px;margin-top:3px">${esc(c.reason || '')}</div>`,
      'bad',
      6
    );
  }
  startCam(sim, dims);
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/* ------------------------------------------------------------------ *
 * The choreography, applied to whichever thing draws the aeroplane.
 * ------------------------------------------------------------------ */

function startScript(sim, kind, cls, vel, dims, agl) {
  C.script = null;
  C.target = null;
  const ac = sim.aircraft;
  const model = sim.model;
  const fleet = !!(model && model.userData && model.userData.fleetBridge);
  if (fleet) {
    const gc = model.userData.gameCrash;
    // A fleet aeroplane in the sea is sinking, and the sinking owns it.
    if (!gc || gc.sinking || gc.water) return;
    C.target = 'body';
    model.updateMatrixWorld(true);
    model.getWorldScale(_v);
    C.bodyScale = _v.x || 1;
  } else {
    C.target = 'ac';
  }
  C.script = makeScript(kind, { pos: ac.pos, quat: ac.quat, vel, side: cls.side, dims, ground: groundAt, agl });
}

function applyPose(sim, s) {
  const ac = sim.aircraft;
  if (C.target === 'ac') {
    ac.pos.copy(s.pos);
    ac.quat.copy(s.quat);
    return true;
  }
  const model = sim.model;
  const ud = model && model.userData;
  const body = ud && ud.crashBody;
  if (!body || !body.position || !body.quaternion) {
    // Sinking, or the last piece came off: the fleet's own crash has it.
    if (ud && ud.gameCrash && ud.gameCrash.sinking) C.script = null;
    return false;
  }
  const com = body.centerOfMass || _v.set(0, 0, 0);
  body.position.copy(com).multiplyScalar(C.bodyScale).applyQuaternion(s.quat).add(s.pos);
  body.quaternion.copy(s.quat);
  if (body.velocity) body.velocity.set(0, 0, 0);
  if (body.angularVelocity) body.angularVelocity.set(0, 0, 0);
  // Asleep, the solver leaves it exactly where it is put.
  body.sleeping = true;
  return true;
}

function stepScript(sim, dt) {
  const s = C.script;
  if (!s || s.done) return;
  poseAt(s, s.t + dt);
  if (!applyPose(sim, s)) return;
  const fx = C.fx;
  if (!fx) return;
  const D = C.dims;
  const k = s.kind;
  // Dust and spray where it is touching, as it goes.
  const rate = k === 'splash' ? (s.t < 0.6 ? 60 : 0) : k === 'bellyflop' ? (s.speed > 2 ? 34 : 0) : k === 'wingclip' ? 42 : 0;
  if (rate && s.hasContact) {
    C.emitAcc += rate * dt;
    while (C.emitAcc >= 1) {
      C.emitAcc -= 1;
      const cx = s.contact.x;
      const cz = s.contact.z;
      if (k === 'splash') {
        const a = Math.random() * Math.PI * 2;
        fx.emit('spray', cx + Math.cos(a) * D.r, 0.2, cz + Math.sin(a) * D.r, Math.cos(a) * 3, 6 + Math.random() * 5, Math.sin(a) * 3);
      } else {
        fx.emit('dust', cx + (Math.random() - 0.5) * D.r, s.contact.y + 0.3, cz + (Math.random() - 0.5) * D.r,
          -s.d.x * 2 + (Math.random() - 0.5) * 2, 1 + Math.random(), -s.d.z * 2 + (Math.random() - 0.5) * 2);
        if (Math.random() < 0.25) fx.emit('spark', cx, s.contact.y + 0.2, cz, (Math.random() - 0.5) * 6, 2 + Math.random() * 3, (Math.random() - 0.5) * 6);
      }
    }
  }
  if ((k === 'bellyflop' || k === 'wingclip') && s.hasContact) fx.skidTo(s.contact.x, s.contact.z, k === 'bellyflop' ? s.d.x : s.pos.x - s.contact.x, k === 'bellyflop' ? s.d.z : s.pos.z - s.contact.z);
  // A slam: every wing-tip strike of a cartwheel, a bonk's landing, the nose going in.
  if (s.slams > C.lastSlams) {
    C.lastSlams = s.slams;
    // The dent goes where the nose actually went in.
    if (k === 'noseplant' && s.hasContact) fx.showDent(s.contact.x, s.contact.z, 1.5 + D.L * 0.08);
    if (s.hasContact && (k === 'cartwheel' || k === 'bonk' || k === 'noseplant')) {
      fx.burst('dust', s.contact, k === 'cartwheel' ? 8 : 6, 4, 0.7, 1.5);
      if (k === 'cartwheel') fx.burst('spark', s.contact, 5, 6, 0.9, 0.5);
      const al = sim.audio && sim.audio.available && sim.audio.alerts;
      if (al && al.thud && k === 'cartwheel') al.thud();
    }
  }
  // Seeing stars, once it has stopped (sooner for a bonk).
  const starAt = k === 'bonk' ? 0.3 : 1.1;
  if (!C.starsShown && k !== 'splash' && k !== 'bellyflop' && s.t >= starAt) {
    C.starsShown = true;
    fx.showStars(starPoint(s), Math.max(1.6, D.semi * 0.32), clamp(0.9 + D.L * 0.1, 1.4, 4));
  }
  if (C.starsShown) fx.moveStars(starPoint(s));
}

/** The comic word beside the wreck, and the wisp curling up off it. */
function followWreck(sim, dt) {
  const fx = C.fx;
  const D = C.dims;
  if (!D) return;
  const at = C.script ? C.script.pos : sim.aircraft.pos;
  const base = Math.max(at.y, groundAt(at.x, at.z));
  if (fx.word.visible && fx.wordBase && sim.camera) {
    const dist = camDistance(D);
    _r.set(1, 0, 0).applyQuaternion(sim.camera.quaternion);
    _r.y = 0;
    if (_r.lengthSq() > 1e-6) _r.normalize();
    fx.wordBase.set(at.x + _r.x * dist * 0.3, base + D.r + dist * 0.12, at.z + _r.z * dist * 0.3);
  }
  // The wisp once it has come to rest — while it tumbles it would only leave dots in the air.
  if (C.wispLeft > 0 && (!C.script || C.script.done)) {
    C.wispLeft -= dt;
    C.wispAcc += dt;
    while (C.wispAcc >= 0.3) {
      C.wispAcc -= 0.3;
      fx.emit('wisp', at.x + (Math.random() - 0.5) * D.r, base + D.r * 0.8, at.z + (Math.random() - 0.5) * D.r,
        (Math.random() - 0.5) * 0.8, 1.6 + Math.random(), (Math.random() - 0.5) * 0.8);
    }
  }
}

function starPoint(s) {
  const D = C.dims;
  return _look.set(s.pos.x, Math.max(s.pos.y, groundAt(s.pos.x, s.pos.z) + D.r) + D.r + 1.2 + D.L * 0.05, s.pos.z);
}

function cancelScript() {
  C.script = null;
  C.target = null;
  C.starsShown = false;
}

/* ------------------------------------------------------------------ *
 * The crash cam.
 * ------------------------------------------------------------------ */

function camDistance(dims) {
  return clamp(dims.L * 1.5 + dims.semi * 0.9 + 10, 16, 110);
}

const viewOf = (sim) => (sim && sim.rig && typeof sim.rig.mode === 'string' ? sim.rig.mode : null);

function startCam(sim, dims) {
  if (!sim || !sim.camera || (sim.settings && sim.settings.crashCam === false)) return false;
  const ac = sim.aircraft;
  const s = C.script;
  CAM.active = true;
  CAM.t = 0;
  CAM.life = CRASH_CAM_SECONDS;
  CAM.view = viewOf(sim);
  CAM.dist = camDistance(dims);
  CAM.h = CAM.dist * 0.36 + 2;
  CAM.shake = 0.7;
  // Beside the track and a little ahead, on the side the camera is already
  // on, so the wreck comes across the picture instead of away from it.
  const d = s ? s.d : _v.set(0, 0, -1).applyQuaternion(ac.quat).setY(0).normalize();
  const acx = d.z;
  const acz = -d.x;
  const cp = sim.camera.position;
  const sgn = (cp.x - ac.pos.x) * acx + (cp.z - ac.pos.z) * acz >= 0 ? 1 : -1;
  const ox = acx * sgn * 0.85 + d.x * 0.45;
  const oz = acz * sgn * 0.85 + d.z * 0.45;
  CAM.ang = Math.atan2(oz, ox);
  CAM.spin = -sgn * 0.16;
  // Aim at where it will be halfway through, so the whole slide fits.
  const ahead = s ? Math.min(20, Math.max(s.h, 8) * 0.35) : 0;
  CAM.ax = ac.pos.x + d.x * ahead;
  CAM.az = ac.pos.z + d.z * ahead;
  CAM.ay = groundAt(CAM.ax, CAM.az);
  // The banner lives in the middle of the screen, which is where the wreck
  // is; for the two seconds of the crash cam it sits up top instead.
  const b = sim.hud && sim.hud.banner;
  if (b && b.style) {
    CAM.banner = b;
    CAM.bannerTop = b.style.top;
    b.style.top = '15%';
  }
  cinema(true);
  showCamLabel(true);
  return true;
}

/*
 * For the two seconds of the crash cam, the cards that are about flying —
 * the objective, the coach's hint, the tower's chatter — fade out, so on a
 * phone, where they fill the middle of the screen, the crash is what you
 * see. One class on the page and a few lines of CSS; nothing is moved or
 * rebuilt, and if the HUD's class names ever change this simply does nothing.
 */
function cinema(on) {
  try {
    if (on && !C.cinemaCss) {
      const st = document.createElement('style');
      st.textContent =
        'body.crash-cam-on .hud-objective, body.crash-cam-on .hud-coach, body.crash-cam-on .hud-subtitle' +
        ' { opacity: 0 !important; transition: opacity 0.2s ease; }';
      document.head.appendChild(st);
      C.cinemaCss = st;
    }
    document.body.classList.toggle('crash-cam-on', !!on);
  } catch (e) {
    /* no page */
  }
}

function endCam(sim, viewChanged = false) {
  if (!CAM.active) return;
  CAM.active = false;
  showCamLabel(false);
  cinema(false);
  if (CAM.banner) {
    CAM.banner.style.top = CAM.bannerTop || '';
    CAM.banner = null;
  }
  if (!viewChanged && sim && sim.rig) sim.rig.initialised = false;
}

function camWanted(sim) {
  if (!CAM.active) return false;
  const ac = sim && sim.aircraft;
  if (!ac || !ac.crashed || sim.state !== 'flying' || viewOf(sim) !== CAM.view || CAM.t >= CAM.life) {
    endCam(sim, viewOf(sim) !== CAM.view);
    return false;
  }
  return true;
}

function tickCam(sim, dt) {
  if (!CAM.active) return;
  CAM.t += dt;
  CAM.ang += CAM.spin * dt;
  CAM.shake = Math.max(0, CAM.shake - dt * 1.6);
  if (!camWanted(sim)) return;
  if (CAM.bar) {
    const w = Math.round(100 * (1 - CAM.t / CAM.life));
    if (CAM.barW !== w) {
      CAM.barW = w;
      CAM.bar.style.width = `${w}%`;
    }
  }
}

function crashCamera(sim, dt, camera) {
  if (!camera || !camWanted(sim)) return false;
  const ac = sim.aircraft;
  const at = C.script ? C.script.pos : ac.pos;
  const x = CAM.ax + Math.cos(CAM.ang) * CAM.dist;
  const z = CAM.az + Math.sin(CAM.ang) * CAM.dist;
  let y = CAM.ay + CAM.h;
  const gh = groundAt(x, z);
  if (y < gh + 3) y = gh + 3;
  const reduced = sim.settings && sim.settings.reducedMotion;
  const k = CAM.shake * (reduced ? 0.25 : 1);
  // Reduce flashing: the same shake on a slower clock, under 3 Hz (flash-safety.js).
  const t = shakeClock(CAM.t);
  camera.position.set(x + Math.sin(t * 57) * k, y + Math.sin(t * 49.3 + 1.1) * k, z + Math.sin(t * 41.7) * k * 0.5);
  // The wreck in the middle of the picture: the banner has gone up top
  // for these two seconds, and the comic word sits to one side.
  _look.set(at.x, Math.max(at.y, CAM.ay) + (C.dims ? C.dims.r : 1) + CAM.dist * 0.02, at.z);
  camera.lookAt(_look);
  camera.fov = 50;
  camera.updateProjectionMatrix();
  return true;
}

function showCamLabel(on) {
  try {
    if (!CAM.el) {
      if (!on) return;
      const el = document.createElement('div');
      el.className = 'crash-cam-label';
      el.textContent = 'CRASH CAM';
      Object.assign(el.style, {
        position: 'absolute', left: '50%', top: 'calc(15% - 22px)', transform: 'translateX(-50%) rotate(-3deg)',
        padding: '5px 16px 9px', borderRadius: '9px', font: '800 13px/1.2 system-ui, sans-serif',
        letterSpacing: '0.16em', color: '#1b1b2f', background: '#ffd23f',
        border: '2px solid #1b1b2f', boxShadow: '3px 3px 0 #1b1b2f', pointerEvents: 'none', display: 'none',
      });
      const track = document.createElement('div');
      Object.assign(track.style, {
        position: 'absolute', left: '10px', right: '10px', bottom: '3px', height: '3px',
        borderRadius: '2px', background: 'rgba(27,27,47,0.25)', overflow: 'hidden',
      });
      const bar = document.createElement('div');
      Object.assign(bar.style, { height: '100%', width: '100%', background: '#1b1b2f' });
      track.appendChild(bar);
      el.appendChild(track);
      extLayer().appendChild(el);
      CAM.el = el;
      CAM.bar = bar;
    }
    CAM.el.style.display = on ? 'block' : 'none';
    if (on && CAM.bar) {
      CAM.barW = 100;
      CAM.bar.style.width = '100%';
    }
  } catch (e) {
    /* no page: the camera still works */
  }
}

/* ------------------------------------------------------------------ *
 * The minimap, the debrief and the disasters: small wrappers.
 * ------------------------------------------------------------------ */

function wrapMinimap(sim) {
  const mm = sim && sim.minimap;
  if (!mm || typeof mm.frame !== 'function' || mm.frame.__crashMarks) return;
  const orig = mm.frame;
  const wrapped = function (s) {
    const out = orig.apply(this, arguments);
    if (live() && C.marks.list.length) {
      try {
        drawMarksOn(this, s || sim);
      } catch (err) {
        if (!C.warned) console.warn('[crashes] could not draw the crash marks:', err);
        C.warned = true;
      }
    }
    return out;
  };
  wrapped.__crashMarks = true;
  mm.frame = wrapped;
}

function drawMarksOn(mm, sim) {
  if (!mm.ctx || typeof mm.span !== 'number') return 0;
  const drive = sim.mode === 'drive' && sim.vehicle && sim.vehicle.pos;
  const centre = drive ? sim.vehicle.pos : sim.aircraft.pos;
  // Bigger where the map is drawn small (a phone shows it at 84 px): the same rule the minimap's own text follows.
  const scale = clamp(mm.textScale || 1, 1, 1.9);
  const n = drawCrashMarks(mm.ctx, C.marks, centre, mm.span, MINIMAP_SIZE, C.clock, mapId(), C.newestMine, scale);
  C.lastDrawn = n;
  return n;
}

function wrapDebrief(sim) {
  const menus = sim && sim.menus;
  if (!menus || typeof menus.showDebrief !== 'function' || menus.showDebrief.__crashes) return;
  const orig = menus.showDebrief;
  const wrapped = function (opts) {
    let o = opts;
    // The debrief can arrive while the crash cam is still on (main.js times
    // it in real seconds, the cam in game seconds): the cam is over.
    if (CAM.active) endCam(sim);
    try {
      const cr = C.crash;
      if (live() && o && o.title === 'Crashed' && cr && !cr.quiet && now() - cr.real < 12000) {
        o = {
          ...o,
          title: cr.title,
          body: `<p class="debrief-caption" style="font-size:18px;font-weight:700;color:#ffd23f;margin:0 0 6px">${esc(cr.caption)}</p>${o.body || ''}`,
        };
      }
    } catch (e) {
      o = opts;
    }
    return orig.call(this, o);
  };
  wrapped.__crashes = true;
  menus.showDebrief = wrapped;
}

/** A disaster somebody summoned here is a happening too. */
function wrapDisasters(sim) {
  if (!sim || typeof sim.triggerNatural !== 'function' || sim.triggerNatural.__happenings) return;
  const orig = sim.triggerNatural;
  const wrapped = function (id, ...rest) {
    const out = orig.call(this, id, ...rest);
    try {
      const ev = findEvent(id);
      if (ev && live()) {
        let at = null;
        try {
          at = typeof ev.where === 'function' ? ev.where(sim) : null;
        } catch (e) {
          at = null;
        }
        const p = at || (sim.mode === 'drive' && sim.vehicle ? sim.vehicle.pos : sim.aircraft && sim.aircraft.pos);
        // Asked for — a Disasters button, or armed before departure (it was
        // armed last frame and is not any more) — or the world's own doing.
        const armed = !!C.armedSeen[id] && !(sim.armedEvents && id in sim.armedEvents);
        if (armed) delete C.armedSeen[id];
        const summoned = C.summoning || armed || C.replaying;
        if (p) emitHappening({ type: 'disaster', id, summoned, x: round1(p.x), z: round1(p.z), map: mapId(), remote: C.replaying || undefined });
      }
    } catch (err) {
      /* the disaster itself has already happened */
    }
    return out;
  };
  wrapped.__happenings = true;
  sim.triggerNatural = wrapped;
  // The pause menu's Disasters buttons come through this hook: those are summoned.
  const hooks = sim.menus && sim.menus.hooks;
  if (hooks && typeof hooks.onNatural === 'function' && !hooks.onNatural.__happenings) {
    const press = hooks.onNatural;
    const pressed = function (...args) {
      C.summoning = true;
      try {
        return press.apply(this, args);
      } finally {
        C.summoning = false;
      }
    };
    pressed.__happenings = true;
    hooks.onNatural = pressed;
  }
}

/* ------------------------------------------------------------------ *
 * Somebody else's crash or disaster (see ../game/happenings.js).
 * ------------------------------------------------------------------ */

function cleanName(n) {
  return String(n || '').replace(/[^A-Za-z0-9 '\-]/g, '').trim().slice(0, 24);
}

function cleanColour(c) {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#c9a0ff';
}

function receiveCrash(sim, e, from) {
  if (e.map && mapId() && e.map !== mapId()) return false;
  C.marks.add({ x: e.x, z: e.z, kind: e.kind, map: e.map || mapId(), mine: false, colour: cleanColour(from.colour), now: C.clock });
  C.stats.remote++;
  const name = cleanName(from.name);
  if (name && sim && sim.state === 'flying' && sim.hud && sim.hud.notify) {
    sim.hud.notify(`${esc(name)}: ${esc(titleFor(e.kind, e.vehicle))}`, 'info', 3);
  }
  return true;
}

function receiveDisaster(sim, e, from) {
  const ev = findEvent(e.id);
  if (!ev || !SELECTABLE_EVENTS.includes(ev)) return false;
  const name = cleanName(from.name);
  if (name && sim && sim.hud && sim.hud.notify && (sim.state === 'flying' || sim.state === 'paused')) {
    sim.hud.notify(`${esc(name)} summoned: ${esc(ev.name)}!`, 'warn', 4);
  }
  if (!from.apply || !sim || sim.mode !== 'free' || (sim.state !== 'flying' && sim.state !== 'paused')) return true;
  if (typeof sim.triggerNatural !== 'function') return false;
  if (e.map && e.map === mapId()) setSummonPoint({ x: e.x, z: e.z });
  C.replaying = true;
  try {
    sim.triggerNatural(e.id);
  } finally {
    C.replaying = false;
    setSummonPoint(null);
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Crash on demand — the Dev button and the browser check.
 * ------------------------------------------------------------------ */

function findSpot(ac, wantWater) {
  const ok = (x, z) => {
    const h = heightAt(x, z);
    if (platformAt(x, z)) return false;
    return wantWater ? h < -4 : h > 3 && Math.abs(heightAt(x + 25, z) - h) < 6 && Math.abs(heightAt(x, z + 25) - h) < 6;
  };
  if (ok(ac.pos.x, ac.pos.z)) return { x: ac.pos.x, z: ac.pos.z };
  for (let r = 150; r <= 9000; r += 150) {
    const n = Math.max(12, Math.round(r / 90));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = ac.pos.x + Math.cos(a) * r;
      const z = ac.pos.z + Math.sin(a) * r;
      if (ok(x, z)) return { x, z };
    }
  }
  return null;
}

const STAGE = {
  cartwheel: { bank: 62, pitch: -4, fwd: 62, down: 7, part: 'rightWing', reason: 'The right wing tip hit the ground' },
  bellyflop: { bank: 0, pitch: 1, fwd: 42, down: 4, part: 'fuselage', reason: 'The belly hit the ground' },
  splash: { bank: 0, pitch: -3, fwd: 40, down: 5, part: 'fuselage', reason: 'You flew into the sea', surface: 'water', water: true },
  wingclip: { bank: -50, pitch: 0, fwd: 30, down: 3, part: 'leftWing', reason: 'The left wing tip hit the ground' },
  noseplant: { bank: 0, pitch: -52, fwd: 28, down: 32, part: 'nose', reason: 'The propeller struck the ground' },
  bonk: { bank: 0, pitch: 2, fwd: 38, down: 0, reason: 'You flew into the control tower', surface: 'concrete', up: 14 },
};

/**
 * Put the aeroplane somewhere suitable and crash it the given way — the real
 * CRASH event, through main.js and everything else, exactly as a real crash.
 * Flying only. Returns the kind it asked for, or null.
 */
export function stageCrash(sim, kind) {
  const st = STAGE[kind];
  if (!st || !sim || sim.state !== 'flying' || sim.mode === 'drive' || !sim.aircraft || sim.aircraft.crashed) return null;
  const ac = sim.aircraft;
  const spot = findSpot(ac, !!st.water);
  if (!spot) return null;
  const hdg = ((ac.heading || 0) * Math.PI) / 180;
  const surface = st.water ? 0 : groundAt(spot.x, spot.z);
  const dims = dimsFrom(SPEC && SPEC.hardPoints, sim.aircraftType && sim.aircraftType.plan);
  ac.quat.setFromEuler(new THREE.Euler((st.pitch * Math.PI) / 180, -hdg, (-st.bank * Math.PI) / 180, 'YXZ'));
  const lift = st.water ? 0.4 : st.up || dims.r + (st.bank ? Math.sin((Math.abs(st.bank) * Math.PI) / 180) * dims.semi * 0.8 : 0);
  ac.pos.set(spot.x, surface + lift, spot.z);
  ac.vel.set(Math.sin(hdg) * st.fwd, -st.down, -Math.cos(hdg) * st.fwd);
  const contact = { part: st.part, surfaceKind: st.surface, worldPoint: ac.pos.clone() };
  ac.crash(st.reason, contact);
  return kind;
}

/* ------------------------------------------------------------------ *
 * The plug-in.
 * ------------------------------------------------------------------ */

/** A line of text that shows on the menus too, where the game's own toasts are hidden. */
function note(sim, text) {
  if (sim && sim.state === 'flying' && sim.hud && sim.hud.notify) {
    sim.hud.notify(esc(text), 'info', 3);
    return;
  }
  try {
    let el = C.noteEl;
    if (!el) {
      el = C.noteEl = document.createElement('div');
      Object.assign(el.style, {
        position: 'absolute', left: '50%', bottom: '28px', transform: 'translateX(-50%)',
        maxWidth: 'min(92vw, 520px)', padding: '10px 16px', borderRadius: '12px',
        background: 'rgba(12,20,34,0.9)', color: '#ffe7a3', border: '1px solid rgba(255,210,63,0.5)',
        font: '600 14px/1.35 -apple-system, "Segoe UI", Roboto, Arial, sans-serif', textAlign: 'center',
        pointerEvents: 'none', transition: 'opacity 0.4s ease', zIndex: '40',
      });
      extLayer().appendChild(el);
    }
    el.textContent = text;
    el.style.display = '';
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      el.style.opacity = '0';
    }, 4200);
  } catch (e) {
    /* no page */
  }
}

function ensureListener(sim) {
  const ac = sim && sim.aircraft;
  if (!ac || C.listenedOn === ac || typeof ac.on !== 'function') return;
  C.listenedOn = ac;
  ac.on(EVENTS.CRASH, onCrash);
}

function resetAll(sim) {
  cancelScript();
  endCam(sim, true);
  if (C.fx) C.fx.clear();
  C.crash = null;
}

registerExtension({
  id: 'crashes',

  install(sim) {
    C.sim = sim;
    ensureListener(sim);
    wrapMinimap(sim);
    wrapDebrief(sim);
    wrapDisasters(sim);
    setHappeningReceiver('crash', receiveCrash);
    setHappeningReceiver('disaster', receiveDisaster);
    /*
     * The update hook only runs while flying, so it cannot see a pause or a
     * menu arrive in the middle of the crash cam; this does, four times a
     * second, and puts the label and the banner back so neither is left
     * over the pause screen.
     */
    if (typeof setInterval === 'function') {
      C.watch = setInterval(() => {
        if (CAM.active && C.sim && C.sim.state !== 'flying') endCam(C.sim);
      }, 250);
    }
  },

  buildWorld(sim, group) {
    C.sim = sim;
    C.fx = new CrashFx(group, (x, z) => drawnHeight(x, z));
    cancelScript();
    endCam(sim, true);
  },

  startMode(sim) {
    resetAll(sim);
    /*
     * A new flight starts with a clean chart. The owner, play-testing: "I see
     * crash/meteor icons on the minimap even though I crashed earlier" — the
     * marks (a star burst, which reads as a meteor) outlived the flight they
     * were made in by up to 90 s. Another player's crash in multiplayer still
     * shows while you are flying (mpworld's own crosses, 60 s).
     */
    C.marks.list.length = 0;
    C.newestMine = null;
    C.armedSeen = {};
    // Armed "straight away" can fire before the first frame this sees.
    if (sim.armedEvents) for (const k in sim.armedEvents) C.armedSeen[k] = true;
    if (C.noteEl) C.noteEl.style.display = 'none';
    // The first flight after a crash says, once, what the new star on the map is.
    if (!C.toldMarks && C.marks.list.some((m) => m.mine && m.map === mapId())) C.tellMarksT = 1.5;
  },

  stop(sim) {
    resetAll(sim);
  },

  update(sim, dt) {
    C.sim = sim;
    C.clock += dt;
    // What is armed on the Free Flight screen, so the wrapper can tell an
    // armed disaster going off from the randomiser's.
    const ae = sim.armedEvents;
    if (ae) for (const k in ae) C.armedSeen[k] = true;
    ensureListener(sim);
    wrapMinimap(sim);
    const ac = sim.aircraft;
    // Reset on the runway, or a new flight: whatever was happening is over.
    if (C.script && (!ac || !ac.crashed || sim.mode === 'drive')) {
      cancelScript();
      if (C.fx) C.fx.clear();
    }
    if (C.script) stepScript(sim, dt);
    if (C.fx && ac && ac.crashed) followWreck(sim, dt);
    if (C.fx) C.fx.update(dt, sim.camera);
    tickCam(sim, dt);
    if (C.marks.list.length && (C.clock % 5) < dt) C.marks.prune(C.clock);
    if (C.tellMarksT > 0) {
      C.tellMarksT -= dt;
      if (C.tellMarksT <= 0 && sim.hud && sim.hud.notify && sim.minimap && sim.minimap.visible) {
        C.toldMarks = true;
        sim.hud.notify('The star on your map is where you crashed. It fades after a minute or so.', 'info', 5);
      }
    }
    // The Dev button's crash, once there is air under you to crash out of.
    if (C.pendingStage && ac && !ac.crashed && sim.mode === 'free') {
      C.pendingT = ac.agl > 15 || ac.onGround === false ? C.pendingT + dt : 0;
      if (C.pendingT > 1) {
        const kind = C.pendingStage;
        C.pendingStage = null;
        stageCrash(sim, kind);
      }
    }
  },

  camera(sim, dt, camera) {
    return crashCamera(sim, dt, camera);
  },

  devActions: [
    {
      label: 'Show me a crash',
      hint: 'Crashes the aeroplane on purpose, a different way each press: cartwheel, belly flop, splash, wing clip, nose plant, bonk.',
      run(sim) {
        C.devNext = ((C.devNext ?? -1) + 1) % KIND_IDS.length;
        const kind = KIND_IDS[C.devNext];
        if (sim && sim.state === 'flying' && stageCrash(sim, kind)) return;
        // From the menu or the pause screen: as soon as you are flying again.
        C.pendingStage = kind;
        C.pendingT = 0;
        note(sim, `A ${KINDS[kind].title.replace('!', '').toLowerCase()} is coming as soon as you are flying.`);
      },
    },
  ],
});

/** For the tests and the console. */
export function crashDebug() {
  return { C, CAM, KINDS, CRASH_SECONDS, drawMarksOn };
}
