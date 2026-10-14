/**
 * SIGNAL ZERO — CHAPTER 1: THE GLINT
 * Condor Rock · 23:41 · a squall line rolling in · Tempest WR-4 · about 6 min
 *
 * Cold open, airborne. The observatory pays for the first clean photo of a
 * fireball due off the Rock tonight; Cole Bannerman is up there too. Catch
 * it, get alongside inside the squall, take the shot before he does, then
 * land on a wet clifftop strip. In the hangar the photo blows up: a tumbling
 * cylinder, a fin, a faded seabird. Mara goes very still.
 *
 * BUILT ON (story-bible.md §6, "Reuses"):
 *   - meteor-photo "Photograph the Big One" (src/game/extra/meteor.js), adapted:
 *     same giant, same splash, same camera — with a hand-held shutter (the
 *     feature's manualPhoto/photoRange knobs) and a 400 m range;
 *   - the squall: the game's own 'stormy' night with lightning, dimmed by
 *     Reduce flashing as everywhere (render/flash-safety.js);
 *   - Cole's aeroplane: roles/npc-flyer.js, which is a body in the sky — do
 *     not ram him;
 *   - the Condor Rock map and its runway; markers.js's RingGate for the gap;
 *   - the letterbox and cards: story/cinema.js (from afo-movie.js).
 *
 * NEW HERE: Cole's racing brain (a racing line with gentle rubber-banding),
 * the photo reveal (a still, zoomed in on the fin decal), the Kittiwake logo,
 * the cliff-light marker (the "Early Bird" secret that pays off in chapter
 * 12), the observatory on The Beak (File 01).
 *
 * Two beats, one flight: the CHASE (climb · catch · photo · turn) and the
 * LANDING (approach · land). Checkpoints: air start · alongside · after the
 * photo · on final · landed — never more than about a minute apart.
 */

import * as THREE from '../vendor/three.module.js';
import { RUNWAY } from '../world/airport.js';
import * as Terrain from '../world/terrain.js';
import { NpcFlyer } from '../game/roles/npc-flyer.js';
import { RingGate } from '../game/markers.js';
import { MISSIONS as METEOR_MISSIONS } from '../game/extra/meteor.js';
import { isKey, playerClaimed, keyName } from '../flight/input.js';
import { extLayer } from '../game/extensions.js';
import { adapt, landedAndStopped } from './beats.js';
import { LINES } from './script.js';
import { createCoach, wantsLessons } from './lessons.js';

const BASE = METEOR_MISSIONS.find((m) => m.id === 'meteor-photo');

/** What each difficulty changes, and nothing else (story-bible.md §7). */
/*
 * The fireball flies slower than the Tempest cruises (about 95 m/s), so you
 * can overtake it and hold formation for the shot; its track is about 8 km
 * long whatever the speed, so the clock to the splash is giantT seconds.
 */
export const DIFF = {
  story: { photoRange: 650, coleBase: 80, coleHold: 3.5, giantSpeed: 62, giantT: 130, climbFt: 5500 },
  pilot: { photoRange: 450, coleBase: 60, coleHold: 2.5, giantSpeed: 74, giantT: 110, climbFt: 6000 },
  ace: { photoRange: 350, coleBase: 44, coleHold: 1.5, giantSpeed: 85, giantT: 96, climbFt: 6000 },
};
const FT = 0.3048;
/*
 * The fireball comes in from your right and drifts across to the left,
 * 25° off your heading — converging, so you can join it and hold formation
 * (straight across, the photo run's −90°, it is a pass, not a formation).
 */
const CROSS_DEG = -25;
const DIVE_DEG = 11; // the meteor feature's giant comes down at 11°

/**
 * Where to send the giant so it STARTS `ahead` m in front of you and `right`
 * m to your right, travelling `cross`° off your heading at `speed` m/s for `T`
 * s: the meteor feature places it back along its line from the splash, so
 * this hands it the splash (giantAhead/giantSide) that puts the start there.
 */
export function giantLayout(speed, T, cross, ahead, right) {
  const L = speed * T * Math.cos((DIVE_DEG * Math.PI) / 180);
  const c = (cross * Math.PI) / 180;
  return { giantCross: cross, giantAhead: ahead + Math.cos(c) * L, giantSide: right + Math.sin(c) * L };
}
const CATCH_M = 400;
const SHORT_FINAL_M = 2400; // on a 3° slope, about 125 m up: above the 300 ft no-save line
const GIANT_AT = 22; // seconds after the air start
const COLE_LIVERY = { id: 'bannerman', name: 'Bannerman Salvage', base: '#b8341f', accent: '#f0d060', cheatline: 'rgba(30,20,10,0.85)', tail: 0x1a1a1a, reg: 'CB-11' };

/** The chapter's live state: one object, reset by enterChapter(). */
const K = {
  api: null,
  diff: DIFF.pilot,
  t: 0,
  beat: null, // 'chase' | 'land'
  timeline: [],
  cole: null,
  colePhase: 'wait',
  coleT: 0,
  coleHoldT: 0,
  coleD0: 0,
  coleOffset: 1,
  coleAvoidT: 0,
  coleLeaveT: 0,
  coleSaid: {},
  giantSpawnT: null,
  playerShotT: null,
  coleShotT: null,
  photoDist: 0,
  photoQuality: 0,
  eyeGate: null,
  eyePassed: false,
  eyeSaid: false,
  props: [],
  cliffLight: null,
  observatory: null,
  secretFound: false,
  fileFound: false,
  goArounds: 0,
  lowPass: false,
  landing: null,
  turnTarget: null,
  climbTarget: null,
  tapBtn: null,
  coachUi: null, // teach-by-doing (lessons.js): power, nose, bank for a first-timer
  reveal: null,
  trackT: 0,
  v: new THREE.Vector3(),
  v2: new THREE.Vector3(),
};

/* ====================================================================== */
/* helpers                                                                 */
/* ====================================================================== */

function groundAt(x, z) {
  try {
    const h = Terrain.heightAt(x, z);
    return Number.isFinite(h) ? Math.max(0, h) : 0;
  } catch (e) {
    return 0;
  }
}

function meteors(sim) {
  return (sim && sim.meteors) || null;
}

function stats(sim) {
  const m = meteors(sim);
  return (m && m.stats) || null;
}

function bearing(ax, az, bx, bz) {
  return ((Math.atan2(bx - ax, -(bz - az)) * 180) / Math.PI + 360) % 360;
}

function adiff(a, b) {
  return ((b - a + 540) % 360) - 180;
}

/** Schedule a line (or a function) `at` seconds into the beat, once. */
function later(at, what) {
  K.timeline.push({ at, what, done: false });
}

function runTimeline() {
  for (const e of K.timeline) {
    if (e.done || K.t < e.at) continue;
    e.done = true;
    if (typeof e.what === 'function') e.what();
    else K.api.say(e.what);
  }
}

/* ====================================================================== */
/* the spawns                                                              */
/* ====================================================================== */

/** The air start: open sea north of Egg Rock, 1,500 m up, facing north-west. */
const CHASE_SPAWN = {
  pos: new THREE.Vector3(-3800, 0, 1500),
  headingDeg: 330,
  speed: 92,
  get altAGL() {
    return Math.max(150, 1500 - groundAt(-3800, 1500));
  },
};

/** A fresh start of the landing beat (a retry from "after the photo" with no pose): 7 km west, lined up. */
const LAND_SPAWN = {
  get pos() {
    return new THREE.Vector3(RUNWAY.thresholdWest.x - 7000, 0, RUNWAY.thresholdWest.z);
  },
  headingDeg: 90,
  speed: 85,
  get altAGL() {
    return Math.max(150, RUNWAY.touchdown.y + 700 - groundAt(RUNWAY.thresholdWest.x - 7000, RUNWAY.thresholdWest.z));
  },
};

/* ====================================================================== */
/* Cole Bannerman — the rival you love to beat                            */
/* ====================================================================== */

function spawnCole(sim) {
  disposeCole();
  const ac = sim.aircraft;
  let cole;
  try {
    cole = new NpcFlyer(sim.scene, 'courier', { name: 'cole-bannerman', livery: COLE_LIVERY });
  } catch (e) {
    console.warn('[story] Cole could not be built; the race runs without his aeroplane', e);
    return null;
  }
  cole.vMin = 45;
  cole.vMax = 118;
  cole.accel = 4;
  cole.maxBank = 38;
  cole.maxRate = 7;
  cole.maxClimb = 12;
  cole.maxDesc = 14;
  if (cole.body) cole.body.name = "Cole's Courier";
  // Two and a half kilometres ahead and to the right, same height, same way.
  const h = (ac.heading * Math.PI) / 180;
  const fwd = K.v.set(Math.sin(h), 0, -Math.cos(h));
  const right = K.v2.set(Math.cos(h), 0, Math.sin(h));
  const pos = ac.pos.clone().addScaledVector(fwd, 2500).addScaledVector(right, 1400);
  pos.y = ac.pos.y + 40;
  cole.place({ pos, headingDeg: ac.heading, speed: 80 });
  cole.direct(ac.heading, pos.y + 300, 82);
  K.cole = cole;
  K.colePhase = 'wait';
  K.coleT = 0;
  K.coleHoldT = 0;
  K.coleAvoidT = 0;
  return cole;
}

function disposeCole() {
  if (K.cole) {
    try {
      K.cole.dispose();
    } catch (e) {
      /* already gone */
    }
  }
  K.cole = null;
}

function updateCole(sim, dt) {
  const cole = K.cole;
  if (!cole || cole.gone) return;
  const ac = sim.aircraft;
  const m = meteors(sim);
  const st = stats(sim);
  const giant = m && m.giantPos();
  K.coleT += dt;

  if (K.colePhase === 'wait') {
    if (giant) {
      K.colePhase = 'race';
      K.coleT = 0;
      K.coleD0 = Math.max(800, cole.pos.distanceTo(giant));
      // Which side of the giant's line Cole takes: the far side from you.
      const gv = m.meteors().find((x) => x.giant) || null;
      if (gv) {
        const cross = (ac.pos.x - giant.x) * gv.vel.z - (ac.pos.z - giant.z) * gv.vel.x;
        K.coleOffset = cross >= 0 ? -1 : 1;
      }
    } else {
      // Formation-ish: a little ahead and right of you, no lower than you.
      const h = (ac.heading * Math.PI) / 180;
      const want = K.v.set(ac.pos.x + Math.sin(h) * 1800 + Math.cos(h) * 1200, 0, ac.pos.z - Math.cos(h) * 1800 + Math.sin(h) * 1200);
      cole.direct(bearing(cole.pos.x, cole.pos.z, want.x, want.z), Math.max(ac.pos.y + 60, cole.pos.y), 84);
    }
  } else if (K.colePhase === 'race') {
    if (!giant || !st) {
      K.colePhase = 'home';
      K.coleT = 0;
    } else {
      const gv = m.meteors().find((x) => x.giant);
      const side = K.v2.set(0, 0, 0);
      if (gv) side.set(-gv.vel.z, 0, gv.vel.x).normalize().multiplyScalar(380 * K.coleOffset);
      const target = K.v.copy(giant).add(side);
      target.y = Math.max(giant.y + 40, groundAt(target.x, target.z) + 200);
      const d = cole.pos.distanceTo(target);
      // Gentle rubber-banding: Cole arrives about `coleBase` seconds after the
      // giant appears, a little later if you are a long way behind him.
      const dPlayer = ac.pos.distanceTo(giant);
      const slack = Math.max(0, Math.min(14, (dPlayer - d) / 350));
      const base = K.diff.coleBase + slack;
      const wantD = Math.max(CATCH_M + 40, K.coleD0 * (1 - K.coleT / base));
      let spd = 62 + (d - wantD) * 0.06;
      // Never through you: inside 260 m he goes wide and high for a moment.
      if (ac.pos.distanceTo(cole.pos) < 260) K.coleAvoidT = 4;
      if (K.coleAvoidT > 0) {
        K.coleAvoidT -= dt;
        target.addScaledVector(side.clone().normalize(), 420);
        target.y += 90;
      }
      cole.direct(bearing(cole.pos.x, cole.pos.z, target.x, target.z), target.y, Math.max(50, Math.min(118, spd)));
      // His shot: alongside for a few seconds.
      const dg = cole.pos.distanceTo(giant);
      if (dg < CATCH_M + 60) K.coleHoldT += dt;
      else K.coleHoldT = Math.max(0, K.coleHoldT - dt * 0.5);
      if (K.coleShotT == null && K.coleHoldT >= K.diff.coleHold) {
        K.coleShotT = K.t;
        if (K.playerShotT == null) K.api.say('c1-cole-3');
      }
      if (K.coleShotT != null && K.t > K.coleShotT + 6) {
        K.colePhase = 'home';
        K.coleT = 0;
      }
      if (K.playerShotT != null && K.t > K.playerShotT + 9 && K.coleShotT == null) {
        K.coleShotT = K.t;
        K.colePhase = 'home';
        K.coleT = 0;
      }
    }
  } else if (K.colePhase === 'home') {
    // Lowtown is on the south of the Rock; he flies there and out of your evening.
    const home = K.v.set(-350, 0, 2600);
    cole.direct(bearing(cole.pos.x, cole.pos.z, home.x, home.z), Math.max(400, groundAt(cole.pos.x, cole.pos.z) + 350), 96);
    if (!K.coleSaid.leave && K.coleT > 4 && K.beat === 'land') {
      K.coleSaid.leave = true;
      K.api.say('c1-cole-5');
    }
    if (K.coleT > 70 || cole.pos.distanceTo(ac.pos) > 9000) disposeCole();
  }
  try {
    cole.update(dt, sim.weather);
  } catch (e) {
    console.warn('[story] Cole stopped flying', e);
    disposeCole();
  }
}

/* ====================================================================== */
/* the world bits: the gap, the cliff light, the observatory               */
/* ====================================================================== */

function addProps(sim) {
  clearProps(sim);
  // "Through the Eye": a marked gap in the squall wall, 2.2 km ahead of the air start.
  const h = (CHASE_SPAWN.headingDeg * Math.PI) / 180;
  const gatePos = new THREE.Vector3(CHASE_SPAWN.pos.x + Math.sin(h) * 2200, 1600, CHASE_SPAWN.pos.z - Math.cos(h) * 2200);
  try {
    const gate = new RingGate(gatePos, CHASE_SPAWN.headingDeg, 150);
    gate.setActive(true);
    sim.scene.add(gate.group);
    K.eyeGate = gate;
  } catch (e) {
    K.eyeGate = null;
  }
  // The faint light in Condor's west cliff: the first thing that pays off in chapter 12.
  let lx = -720;
  while (lx > -1200 && groundAt(lx, 0) > 55) lx -= 10;
  const ly = groundAt(lx + 20, 0) + 6;
  const light = new THREE.Group();
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(2.4, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe2a0 }));
  const glow = new THREE.Mesh(new THREE.SphereGeometry(9, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, opacity: 0.16, depthWrite: false }));
  light.add(lamp, glow);
  light.position.set(lx + 14, ly, 0);
  light.name = 'story:cliff-light';
  sim.scene.add(light);
  K.cliffLight = light;
  // The observatory on The Beak: a dome and one lit window (File 01).
  const bx = 650;
  const bz = -1250;
  const by = groundAt(bx, bz);
  const obs = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 7, 16), new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.8 }));
  base.position.y = 3.5;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(9, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xcfd6dd, roughness: 0.5 }));
  dome.position.y = 7;
  const win = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.6, 0.4), new THREE.MeshBasicMaterial({ color: 0xffe7b0 }));
  win.position.set(0, 3.6, 9.1);
  const winGlow = new THREE.Mesh(new THREE.SphereGeometry(5, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, opacity: 0.12, depthWrite: false }));
  winGlow.position.set(0, 3.6, 10);
  obs.add(base, dome, win, winGlow);
  obs.position.set(bx, by, bz);
  obs.name = 'story:observatory';
  sim.scene.add(obs);
  K.observatory = obs;
  K.props = [light, obs];
}

function clearProps(sim) {
  for (const p of K.props) {
    try {
      sim.scene.remove(p);
      p.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    } catch (e) {
      /* gone */
    }
  }
  K.props = [];
  K.cliffLight = null;
  K.observatory = null;
  if (K.eyeGate) {
    try {
      K.eyeGate.dispose(sim.scene);
    } catch (e) {
      /* gone */
    }
    K.eyeGate = null;
  }
}

function checkProps(sim, dt) {
  const ac = sim.aircraft;
  if (K.eyeGate && !K.eyePassed) {
    K.eyeGate.update(dt, sim.camera.position);
    if (K.eyeGate.test(ac.pos)) {
      K.eyePassed = true;
      K.eyeGate.markPassed();
      K.api.style('through-the-eye', 'Through the Eye');
    }
  }
  if (K.cliffLight && !K.secretFound && ac.pos.distanceTo(K.cliffLight.position) < 200) {
    K.secretFound = true;
    K.api.foundSecret('condor-light', 'Early Bird — the light in the west cliff');
    K.api.say('c1-secret-light');
  }
  if (K.observatory && !K.fileFound && ac.pos.distanceTo(K.observatory.position) < 260) {
    K.fileFound = true;
    K.api.foundFile('f01');
    K.api.say('c1-file-1');
  }
}

/* ====================================================================== */
/* the hand-held camera                                                    */
/* ====================================================================== */

function tapButton() {
  if (K.tapBtn) return K.tapBtn;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sz-tapphoto';
  b.textContent = 'PHOTO';
  Object.assign(b.style, {
    position: 'fixed', right: '18px', bottom: '34%', zIndex: 31, pointerEvents: 'auto', display: 'none',
    padding: '14px 18px', borderRadius: '999px', border: '2px solid #ffbf47', background: 'rgba(6,10,18,0.8)', color: '#ffd98a',
    font: '800 14px/1 var(--font, sans-serif)', letterSpacing: '0.16em', cursor: 'pointer',
  });
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    snap(K.api.sim);
  });
  extLayer().appendChild(b);
  K.tapBtn = b;
  return b;
}

function snap(sim) {
  const m = meteors(sim);
  if (!m || K.beat !== 'chase') return false;
  const r = m.snap();
  if (r.ok) {
    K.playerShotT = K.t;
    K.photoDist = r.d;
    K.photoQuality = r.quality;
    if (K.coleShotT == null) K.api.say('c1-cole-4');
    K.api.say('c1-mara-3');
    return true;
  }
  if (r.why === 'range') K.api.notify(`Closer — ${Math.round(r.d)} m. Get inside ${K.diff.photoRange} m.`, 'warn', 1.6);
  else if (r.why === 'aim') K.api.notify('Put it in the frame first.', 'warn', 1.6);
  return r.why !== 'nothing';
}

/* ====================================================================== */
/* BEAT A — the chase (meteor-photo, adapted)                              */
/* ====================================================================== */

export const CHASE = adapt(
  BASE,
  {
    id: 'story-ch01-chase',
    name: 'The Glint',
    short: 'Chapter 1 — the chase',
    game: 'story',
    hidden: true,
    difficulty: 'Medium',
    blurb: 'Signal Zero, chapter 1.',
    weather: { time: 'night', condition: 'stormy', windSpeedKts: 18, windDirDeg: 250 },
    spawn: CHASE_SPAWN,
    meteor: { mode: 'photo', manualPhoto: true, photoRange: 450, giantAt: GIANT_AT, giantAhead: 5200, giantSide: -1200, giantSpeed: 85, giantT: 108 },
    startLabel: 'Air start',
    onStart(ctx) {
      // The difficulty's numbers go into the meteor config before the base begins it.
      const d = K.diff;
      this.meteor.photoRange = d.photoRange;
      this.meteor.giantT = d.giantT;
      this.meteor.giantSpeed = d.giantSpeed;
      Object.assign(this.meteor, giantLayout(d.giantSpeed, d.giantT, CROSS_DEG, 600, 1400));
      BASE.onStart(ctx);
      enterChase(ctx);
    },
    tick(ctx, dt) {
      tickChase(ctx, dt);
    },
    failIf(ctx) {
      const s = stats(ctx.sim);
      return s && s.giantLanded && !s.photoTaken ? LINES['c1-fail-splash'].text : null;
    },
    steps: [
      {
        id: 'climb',
        text: 'Climb to 6,000 ft and turn onto the fireball’s track.',
        hint: 'Hold Shift for power and ease back on S. The fireball comes from your right.',
        hintEvery: 30,
        // A checkpoint, so the catch that follows is never more than a minute
        // of play from the last save (a resume puts the fireball back ahead).
        checkpoint: 'On the fireball’s track',
        targetLabel: 'The track',
        target: () => K.climbTarget,
        check: (ctx) => {
          const s = stats(ctx.sim);
          if (!s || !s.giantSpawned) return false;
          const up = ctx.ac.pos.y >= K.diff.climbFt * FT - 60;
          return up || (K.giantSpawnT != null && K.t - K.giantSpawnT > 10);
        },
      },
      {
        id: 'catch',
        text: `Catch it: get within ${CATCH_M} m of the fireball.`,
        hint: 'Aim ahead of it, not at it. It drifts right to left and down.',
        hintEvery: 30,
        checkpoint: 'Alongside the fireball',
        targetLabel: 'The fireball',
        target: (ctx) => {
          const m = meteors(ctx.sim);
          return m ? m.giantPos() : null;
        },
        enter(ctx) {
          if (!K.api.isResume) {
            K.api.titleCard({ main: 'SIGNAL ZERO', wordmark: true, dur: 2.2, bars: 'thin' });
            K.api.titleCard({ over: 'Chapter 1', main: 'THE GLINT', sub: 'CONDOR ROCK · 23:41', dur: 3, bars: 'thin' });
          }
        },
        check: (ctx) => {
          const m = meteors(ctx.sim);
          const g = m && m.giantPos();
          const s = stats(ctx.sim);
          if (s && s.photoTaken) return true;
          return !!g && ctx.ac.pos.distanceTo(g) < CATCH_M;
        },
      },
      {
        id: 'photo',
        text: 'Hold alongside and take the photo — press SPACE.',
        hint: 'Match its speed. When the frame goes gold, press SPACE.',
        hintEvery: 20,
        checkpoint: 'After the photo',
        targetLabel: 'The fireball',
        target: (ctx) => {
          const m = meteors(ctx.sim);
          return m ? m.giantPos() : null;
        },
        enter() {
          if (!K.api.isResume) {
            K.api.say('c1-lark-2');
            later(K.t + 2.5, 'c1-mara-2');
          }
        },
        check: (ctx) => {
          const s = stats(ctx.sim);
          return !!(s && s.photoTaken);
        },
      },
      {
        id: 'turn',
        text: 'Got it. Turn for Condor Rock.',
        checkpoint: false,
        targetLabel: 'Condor Rock',
        target: () => K.turnTarget,
        enter(ctx) {
          const t = K.turnTarget;
          K.turnStartT = K.t;
          if (t) ctx.data.turnBearing = bearing(ctx.ac.pos.x, ctx.ac.pos.z, t.x, t.z);
        },
        check: (ctx) => {
          const t = K.turnTarget;
          if (!t) return true;
          const b = bearing(ctx.ac.pos.x, ctx.ac.pos.z, t.x, t.z);
          return Math.abs(adiff(ctx.ac.heading, b)) < 70 || K.t - (K.turnStartT || 0) > 12;
        },
      },
    ],
    onComplete() {
      /* the director moves to the landing beat; Mara already spoke */
    },
    score: (ctx) => {
      const s = stats(ctx.sim);
      return s ? s.photoQuality : 50;
    },
    /** Small plain data for the checkpoint. */
    save(ctx) {
      const s = stats(ctx.sim) || {};
      return {
        giantSpawned: !!s.giantSpawned,
        photoTaken: !!s.photoTaken,
        photoDistance: s.photoDistance || 0,
        photoQuality: s.photoQuality || 0,
        playerShotT: K.playerShotT,
        coleShotT: K.coleShotT,
        eyePassed: K.eyePassed,
        secretFound: K.secretFound,
        fileFound: K.fileFound,
        t: K.t,
      };
    },
    /** Rebuild the cast at the saved state: the giant respawned close alongside, Cole where he was in the race. */
    resume(state, ctx) {
      if (!state) return;
      K.t = state.t || 0;
      K.playerShotT = state.playerShotT ?? null;
      K.coleShotT = state.coleShotT ?? null;
      K.eyePassed = !!state.eyePassed;
      K.secretFound = !!state.secretFound;
      K.fileFound = !!state.fileFound;
      const m = meteors(ctx.sim);
      if (!m) return;
      if (state.giantSpawned) {
        const T = Math.max(45, K.diff.giantT - 50);
        m.begin({ ...CHASE.meteor, giantAt: 0, giantT: T, ...giantLayout(K.diff.giantSpeed, T, -8, 650, 220) }, CHASE.id);
        m.spawnGiant();
        K.giantSpawnT = K.t - 1;
        if (K.cole) {
          K.colePhase = 'race';
          K.coleT = Math.min(K.diff.coleBase * 0.6, K.t);
          K.coleD0 = 2400;
        }
      }
      const s = stats(ctx.sim);
      if (s && state.photoTaken) {
        s.photoTaken = true;
        s.photoDistance = state.photoDistance || 0;
        s.photoQuality = state.photoQuality || 0;
        K.photoDist = s.photoDistance;
        K.photoQuality = s.photoQuality;
      }
    },
  }
);

function enterChase(ctx) {
  const sim = ctx.sim;
  K.beat = 'chase';
  K.t = 0;
  K.timeline = [];
  K.giantSpawnT = null;
  K.playerShotT = null;
  K.coleShotT = null;
  K.photoDist = 0;
  K.photoQuality = 0;
  K.eyePassed = false;
  K.coleSaid = {};
  K.landing = null;
  K.goArounds = 0;
  K.lowPass = false;
  addProps(sim);
  spawnCole(sim);
  const ac = sim.aircraft;
  const h = (ac.heading * Math.PI) / 180;
  K.climbTarget = new THREE.Vector3(ac.pos.x + Math.sin(h) * 4200 + Math.cos(h) * 900, K.diff.climbFt * FT, ac.pos.z - Math.cos(h) * 4200 + Math.sin(h) * 900);
  K.turnTarget = new THREE.Vector3(RUNWAY.thresholdWest.x - 5200, RUNWAY.touchdown.y + 450, RUNWAY.thresholdWest.z);
  tapButton();
  // Teach by doing: a first-timer gets power, nose and bank, one prompt
  // each, inside the first minute, while it all happens.
  disposeCoach();
  const api = K.api;
  if (wantsLessons({ knowsFlying: !!(api.data && api.data.flags.knowsFlying), landings: sim.progress ? sim.progress.landings : 0, replay: api.replay, resume: api.isResume })) {
    K.coachUi = createCoach(sim, { onDone: () => api.setFlag && api.setFlag('knowsFlying', true) });
  }
  if (!K.api.isResume) {
    later(1.2, 'c1-obs-1');
    later(6.5, 'c1-cole-1');
    later(10.5, 'c1-mara-1');
    later(14, 'c1-lark-1');
  }
}

function disposeCoach() {
  if (K.coachUi) K.coachUi.dispose();
  K.coachUi = null;
}

function tickChase(ctx, dt) {
  const sim = ctx.sim;
  K.t += dt;
  runTimeline();
  if (K.coachUi) K.coachUi.tick(dt);
  const s = stats(sim);
  if (s && s.giantSpawned && K.giantSpawnT == null) {
    K.giantSpawnT = K.t;
    if (!K.api.isResume) {
      later(K.t + 1.5, 'c1-obs-2');
      later(K.t + 7, 'c1-cole-2');
    }
  }
  if (s && s.giantLanded && !K.coleSaid.splash && s.photoTaken) {
    K.coleSaid.splash = true;
    K.api.say('c1-lark-3');
  }
  updateCole(sim, dt);
  checkProps(sim, dt);
  // The tap button for touch screens: only while the shot is possible.
  const m = meteors(sim);
  const info = m && m.photoInfo ? m.photoInfo() : null;
  if (K.tapBtn) {
    const want = !!(info && info.inRange && !info.taken && sim.touch);
    K.tapBtn.style.display = want ? 'block' : 'none';
    if (want) K.tapBtn.style.borderColor = info.aimed ? '#7ee8b2' : '#ffbf47';
  }
}

/* ====================================================================== */
/* BEAT B — the landing                                                    */
/* ====================================================================== */

export const LAND = {
  id: 'story-ch01-land',
  name: 'The Glint',
  short: 'Chapter 1 — the landing',
  game: 'story',
  hidden: true,
  difficulty: 'Medium',
  icon: '🔭',
  category: 'story',
  map: 'condor',
  aircraft: 'tempest',
  blurb: 'Signal Zero, chapter 1.',
  weather: { time: 'night', condition: 'stormy', windSpeedKts: 18, windDirDeg: 250 },
  spawn: LAND_SPAWN,
  continues: true,
  startLabel: 'Heading home',
  onStart(ctx) {
    enterLand(ctx);
  },
  tick(ctx, dt) {
    tickLand(ctx, dt);
  },
  steps: [
    {
      id: 'approach',
      text: 'Fly back to Condor Rock and line up on runway 09. The strip is short and ends in a cliff.',
      hint: 'Aim for the ring 5 km west of the runway, then come down the slope: gear G, flaps F.',
      hintEvery: 30,
      rolling: true,
      checkpoint: 'On final',
      targetLabel: 'Final approach',
      target: () => K.turnTarget,
      check: (ctx) => {
        const ac = ctx.ac;
        const d = ac.pos.distanceTo(RUNWAY.touchdown);
        const hdg = Math.abs(adiff(ac.heading, RUNWAY.headingDeg ?? 90)) < 60;
        return d < 5200 && hdg && ac.agl < 800 && ac.pos.x < RUNWAY.thresholdWest.x - 600;
      },
    },
    {
      // A checkpoint on the slope, so a 5 km final at landing speed is never
      // more than a minute of play from the last save — and a retry puts you
      // back here, gear and flaps as they were, not 5 km out.
      id: 'short-final',
      text: 'Short final. Gear down, full flap, stay on the slope.',
      hint: 'Gear G, flaps F. Keep the runway lights steady in the windscreen.',
      hintEvery: 20,
      checkpoint: 'Short final',
      targetLabel: 'Runway 09',
      target: () => RUNWAY.touchdown,
      check: (ctx) => ctx.ac.onGround || ctx.ac.pos.distanceTo(RUNWAY.touchdown) < SHORT_FINAL_M,
    },
    {
      id: 'land',
      text: 'Land on the numbers and stop. Runway 09 — and the ground ends where the runway does.',
      hint: 'Seventy knots over the threshold, nose up a touch, then brakes with Space.',
      hintEvery: 25,
      checkpoint: 'Landed',
      targetLabel: 'Runway 09',
      target: () => RUNWAY.touchdown,
      enter() {
        if (!K.api.isResume) K.api.say('c1-mara-4');
      },
      check: landedAndStopped,
    },
  ],
  onComplete(ctx) {
    K.landing = ctx.data.lastTouchdown || null;
    K.api.say('c1-mara-5');
  },
  score: (ctx) => {
    const l = ctx.data.lastTouchdown;
    return l ? l.score : 50;
  },
  save() {
    return { goArounds: K.goArounds, t: K.t, playerShotT: K.playerShotT, coleShotT: K.coleShotT, photoDist: K.photoDist, photoQuality: K.photoQuality, eyePassed: K.eyePassed, secretFound: K.secretFound, fileFound: K.fileFound };
  },
  resume(state) {
    if (!state) return;
    K.goArounds = state.goArounds || 0;
    K.t = state.t || 0;
    K.playerShotT = state.playerShotT ?? K.playerShotT;
    K.coleShotT = state.coleShotT ?? K.coleShotT;
    K.photoDist = state.photoDist || K.photoDist;
    K.photoQuality = state.photoQuality || K.photoQuality;
    K.eyePassed = !!state.eyePassed || K.eyePassed;
    K.secretFound = !!state.secretFound || K.secretFound;
    K.fileFound = !!state.fileFound || K.fileFound;
  },
};

function enterLand(ctx) {
  const sim = ctx.sim;
  disposeCoach();
  K.beat = 'land';
  K.timeline = [];
  K.lowPass = false;
  if (!K.props.length) addProps(sim);
  K.turnTarget = new THREE.Vector3(RUNWAY.thresholdWest.x - 5200, RUNWAY.touchdown.y + 450, RUNWAY.thresholdWest.z);
  if (K.tapBtn) K.tapBtn.style.display = 'none';
  // Cole goes home and the tower clears you in. On a fresh retry of this beat
  // (no chase this flight) there is no Cole to send home.
  if (K.cole && K.colePhase !== 'home') {
    K.colePhase = 'home';
    K.coleT = 0;
  }
  if (!K.api.isResume) later(K.t + 3, 'c1-nadia-1');
}

function tickLand(ctx, dt) {
  const sim = ctx.sim;
  const ac = ctx.ac;
  K.t += dt;
  runTimeline();
  updateCole(sim, dt);
  checkProps(sim, dt);
  // A go-around: low and close, then climbing away without having landed.
  const d = ac.pos.distanceTo(RUNWAY.touchdown);
  if (!ac.onGround && d < 2500 && ac.agl < 60) K.lowPass = true;
  if (K.lowPass && !ac.onGround && ac.agl > 160 && !ctx.data.lastTouchdown) {
    K.goArounds++;
    K.lowPass = false;
    K.api.notify('Going round. Nothing lost but time.', 'info', 3);
  }
}

/* ====================================================================== */
/* the hangar: cutscene (b) and the photo reveal                            */
/* ====================================================================== */

function revealPanel() {
  if (K.reveal) return K.reveal;
  const root = document.createElement('div');
  root.className = 'sz-reveal';
  Object.assign(root.style, {
    position: 'fixed', left: '50%', top: '42%', transform: 'translate(-50%, -50%) rotate(-2deg)', zIndex: 35, pointerEvents: 'none',
    display: 'none', padding: '10px 10px 28px', background: '#f4efe3', borderRadius: '6px', boxShadow: '0 18px 50px rgba(0,0,0,0.65)',
    opacity: 0, transition: 'opacity 0.6s ease',
  });
  const c = document.createElement('canvas');
  c.width = 560;
  c.height = 315;
  c.style.display = 'block';
  c.style.width = 'min(560px, 72vw)';
  c.style.height = 'auto';
  const cap = document.createElement('div');
  cap.style.cssText = 'position:absolute;left:0;right:0;bottom:7px;text-align:center;font:600 13px/1 var(--font, sans-serif);color:#2b2a26;letter-spacing:0.06em';
  cap.textContent = 'CONDOR OBSERVATORY · 23:44 · HARBOURLIGHT';
  root.appendChild(c);
  root.appendChild(cap);
  extLayer().appendChild(root);
  K.reveal = { root, canvas: c, t: 0, on: false };
  return K.reveal;
}

function showReveal(sim) {
  const r = revealPanel();
  r.on = true;
  r.t = 0;
  r.root.style.display = 'block';
  // Next frame, so the transition runs.
  setTimeout(() => {
    r.root.style.opacity = '1';
  }, 20);
  drawReveal(sim, 0);
}

function hideReveal() {
  const r = K.reveal;
  if (!r) return;
  r.on = false;
  r.root.style.opacity = '0';
  setTimeout(() => {
    if (!r.on) r.root.style.display = 'none';
  }, 650);
}

/** The still, then the zoom in on the fin — a smooth zoom, never a cut. */
function drawReveal(sim, t) {
  const r = K.reveal;
  if (!r) return;
  const g = r.canvas.getContext('2d');
  const W = r.canvas.width;
  const H = r.canvas.height;
  const m = meteors(sim);
  const photo = m && m.lastPhoto;
  // The photo (the game screen at the shutter), or a storm if the canvas was lost.
  if (photo) g.drawImage(photo, 0, 0, W, H);
  else {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0a1424');
    sky.addColorStop(1, '#1b2a3d');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
  }
  // A faint green smear where the fireball was, so the zoom has somewhere to go.
  const fx = W * 0.56;
  const fy = H * 0.46;
  const glow = g.createRadialGradient(fx, fy, 2, fx, fy, 60);
  glow.addColorStop(0, 'rgba(160,255,190,0.55)');
  glow.addColorStop(1, 'rgba(160,255,190,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);
  // The zoom: a box shrinking onto the fireball, and an inset growing from it.
  const z = Math.min(1, Math.max(0, (t - 0.8) / 2.6));
  const ease = z * z * (3 - 2 * z);
  const bw = W * (1 - 0.82 * ease);
  const bh = H * (1 - 0.82 * ease);
  const bx = fx - bw * 0.5 + (W / 2 - fx) * (1 - ease);
  const by = fy - bh * 0.5 + (H / 2 - fy) * (1 - ease);
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 2;
  g.strokeRect(bx, by, bw, bh);
  if (ease > 0.15) {
    const iw = W * 0.46 * Math.min(1, (ease - 0.15) / 0.5);
    const ih = iw * 0.62;
    const ix = W - iw - 14;
    const iy = 14;
    g.fillStyle = '#0d1420';
    g.fillRect(ix, iy, iw, ih);
    g.save();
    g.beginPath();
    g.rect(ix, iy, iw, ih);
    g.clip();
    paintObject(g, ix, iy, iw, ih, Math.min(1, Math.max(0, (t - 2.2) / 2.2)));
    g.restore();
    g.strokeStyle = '#eaf1fb';
    g.lineWidth = 2;
    g.strokeRect(ix, iy, iw, ih);
    g.fillStyle = 'rgba(234,241,251,0.9)';
    g.font = '700 11px sans-serif';
    g.fillText('ENLARGED ×8', ix + 8, iy + ih - 8);
  }
  // Scanlines over the whole print: an enlargement, not a photograph of one.
  g.fillStyle = 'rgba(0,0,0,0.08)';
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
}

/** The thing in the picture: a tumbling cylinder, a fin, a faded seabird. */
function paintObject(g, x, y, w, h, reveal) {
  const cx = x + w * 0.5;
  const cy = y + h * 0.55;
  const L = w * 0.6;
  const R = h * 0.17;
  g.save();
  g.translate(cx, cy);
  g.rotate(-0.42);
  // Fire and glow around it.
  const fire = g.createRadialGradient(0, 0, R, 0, 0, L * 0.9);
  fire.addColorStop(0, 'rgba(140,255,170,0.55)');
  fire.addColorStop(1, 'rgba(60,180,120,0)');
  g.fillStyle = fire;
  g.fillRect(-L, -L, 2 * L, 2 * L);
  // The body: scorched metal, a few panel lines.
  const body = g.createLinearGradient(0, -R, 0, R);
  body.addColorStop(0, '#9a9d9f');
  body.addColorStop(0.5, '#5b6166');
  body.addColorStop(1, '#2d3238');
  g.fillStyle = body;
  g.beginPath();
  g.roundRect ? g.roundRect(-L / 2, -R, L, R * 2, R * 0.5) : g.rect(-L / 2, -R, L, R * 2);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 1.2;
  for (let i = -2; i <= 2; i++) {
    g.beginPath();
    g.moveTo((i * L) / 6, -R);
    g.lineTo((i * L) / 6, R);
    g.stroke();
  }
  // The fin.
  g.fillStyle = '#6d7378';
  g.beginPath();
  g.moveTo(L * 0.18, -R);
  g.lineTo(L * 0.42, -R * 2.6);
  g.lineTo(L * 0.5, -R);
  g.closePath();
  g.fill();
  // The seabird on the fin, faded orange on white, revealed last.
  if (reveal > 0) {
    g.globalAlpha = Math.min(1, reveal) * 0.85;
    g.fillStyle = '#f2ebdd';
    g.beginPath();
    g.ellipse(L * 0.37, -R * 1.75, R * 0.55, R * 0.42, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#ff7a1a';
    g.lineWidth = Math.max(1.4, R * 0.1);
    g.lineCap = 'round';
    const kx = L * 0.37;
    const ky = -R * 1.75;
    const s = R * 0.42;
    g.beginPath();
    g.moveTo(kx - s, ky + s * 0.1);
    g.quadraticCurveTo(kx - s * 0.5, ky - s * 0.55, kx, ky - s * 0.05);
    g.quadraticCurveTo(kx + s * 0.5, ky - s * 0.55, kx + s, ky + s * 0.1);
    g.stroke();
    g.beginPath();
    g.moveTo(kx, ky - s * 0.05);
    g.lineTo(kx - s * 0.18, ky + s * 0.5);
    g.moveTo(kx, ky - s * 0.05);
    g.lineTo(kx + s * 0.18, ky + s * 0.5);
    g.stroke();
    g.globalAlpha = 1;
    // Faded stencil under it.
    g.fillStyle = `rgba(242,235,221,${0.5 * reveal})`;
    g.font = `700 ${Math.max(7, R * 0.42)}px monospace`;
    g.fillText('KITTIWAKE', L * 0.1, R * 0.35);
  }
  g.restore();
}

/** Cutscene (b): the hangar, 15 s. Camera on a rail round the parked aeroplane. */
function hangarScene(api) {
  const sim = api.sim;
  const ac = sim.aircraft;
  const p0 = ac.pos.clone();
  const fwd = ac.forward(new THREE.Vector3()).setY(0).normalize();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const from = p0.clone().addScaledVector(fwd, 24).addScaledVector(right, -9).add(new THREE.Vector3(0, 2.4, 0));
  const to = p0.clone().addScaledVector(fwd, 9).addScaledVector(right, -19).add(new THREE.Vector3(0, 4.2, 0));
  const look0 = p0.clone().add(new THREE.Vector3(0, 1.6, 0));
  const look1 = p0.clone().addScaledVector(fwd, 3).add(new THREE.Vector3(0, 2.2, 0));
  const tmp = new THREE.Vector3();
  return api.playCutscene({
    id: 'ch01-hangar',
    dur: 16,
    bars: 'big',
    hideHud: true,
    hold: true,
    caption: 'The photo, blown up: a cylinder, a fin, a faded seabird. Mara goes very still.',
    camera: (t, cam) => {
      const e = t * t * (3 - 2 * t);
      cam.position.lerpVectors(from, to, e);
      tmp.lerpVectors(look0, look1, e);
      cam.lookAt(tmp);
    },
    beats: [
      { at: 0.6, line: 'c1-h-mara-1' },
      { at: 3.3, line: 'c1-h-cole-1' },
      { at: 6.4, line: 'c1-h-mara-2' },
      { at: 7.4, fn: () => showReveal(sim) },
      { at: 10.6, line: 'c1-h-cole-2' },
      { at: 12.8, line: 'c1-h-mara-3' },
      { at: 14.6, line: 'c1-h-lark-1' },
    ],
  }).then((how) => {
    hideReveal();
    return how;
  });
}

/* ====================================================================== */
/* medals                                                                  */
/* ====================================================================== */

export function verdict(k) {
  const photo = !!(k.playerShotT != null || k.photoDist > 0);
  const beatCole = photo && (k.coleShotT == null || k.playerShotT < k.coleShotT);
  const margin = beatCole ? (k.coleShotT == null ? 99 : k.coleShotT - k.playerShotT) : 0;
  const landing = k.landing ? k.landing.score || 0 : 0;
  const q = k.photoQuality || 0;
  const score = Math.round(Math.min(100, 0.4 * q + (beatCole ? 20 : 8) + 0.4 * landing));
  let medal = 'bronze';
  if (photo && k.photoDist <= 250 && k.goArounds === 0) medal = 'silver';
  if (photo && k.photoDist <= 150 && beatCole && margin > 5 && landing >= 80) medal = 'gold';
  return {
    medal,
    score,
    beatCole,
    margin,
    breakdown: [
      { label: 'Photo distance', value: photo ? `${Math.round(k.photoDist)} m (gold ≤ 150 m)` : 'no photo' },
      { label: 'Photo quality', value: `${q}%` },
      { label: 'Cole Bannerman', value: beatCole ? (k.coleShotT == null ? 'beaten — he never got the shot' : `beaten by ${margin.toFixed(1)} s`) : 'he got there first' },
      { label: 'Landing', value: k.landing ? `${landing}/100 · ${Math.abs(k.landing.vsFpm || 0)} ft/min` : '—' },
      { label: 'Go-arounds', value: String(k.goArounds || 0) },
    ],
    note: medal === 'gold' ? 'That is the picture of the year, and the landing to match.' : medal === 'silver' ? 'A clean night. Closer than 150 m and ahead of Cole by five seconds is gold.' : 'The photo is in the file. Replay for a closer shot and a cleaner landing.',
  };
}

/* ====================================================================== */
/* the chapter                                                             */
/* ====================================================================== */

export const CHAPTER_1 = {
  id: 'ch01-the-glint',
  beats: [CHASE, LAND],
  objectives: [
    'Climb to 6,000 ft and turn onto the fireball’s track',
    `Catch it: get within ${CATCH_M} m`,
    'Hold alongside and take the photo (SPACE)',
    'Beat Cole to the shot',
    'Land on Condor Rock — short strip, cliff at the end',
  ],
  briefing: {
    line: 'Condor Rock · 23:41 · a squall line rolling in · Tempest WR-4 · about 6 minutes',
    bullets: [
      'A fireball is due over the western sea at 23:44. The observatory pays for the first clean photo.',
      'Cole Bannerman is up there too. Catch it first: get alongside (400 m) and press SPACE.',
      'Then land on Condor’s clifftop strip. It is short, wet, and ends in the sea.',
    ],
    // World x,z and a label: the air start, the fireball's line, the strip.
    route: [
      [-3800, 1500, 'air start'],
      [-2900, -2200, 'the fireball'],
      [-5700, 0, 'final'],
      [-350, 0, 'runway 09'],
    ],
  },
  /** The chapter begins (a fresh start, a continue or a replay). */
  enterChapter(api) {
    K.api = api;
    K.diff = DIFF[api.difficulty] || DIFF.pilot;
    K.beat = null;
    K.t = 0;
    K.timeline = [];
    K.secretFound = api.hasSecret('condor-light');
    K.fileFound = !!(api.data && api.data.flags.files.includes('f01'));
    K.playerShotT = null;
    K.coleShotT = null;
    K.photoDist = 0;
    K.photoQuality = 0;
    K.eyePassed = false;
    K.goArounds = 0;
    K.landing = null;
    K.trackT = 0;
    api.tracker(trackerItems(api), 'Chapter 1 · The Glint');
  },
  leaveChapter(api) {
    disposeCoach();
    disposeCole();
    clearProps(api.sim);
    hideReveal();
    if (K.tapBtn) K.tapBtn.style.display = 'none';
    K.beat = null;
  },
  onBeatDone(api, i, result) {
    if (i === 1) K.landing = result.landing || K.landing;
  },
  finale(api) {
    return hangarScene(api);
  },
  medal() {
    return verdict(K);
  },
  onFail(api, f) {
    if (/crash/i.test(f.reason || '')) api.say('c1-fail-crash');
  },
  update(api, dt) {
    K.trackT += dt;
    if (K.trackT >= 0.25) {
      K.trackT = 0;
      api.tracker(trackerItems(api));
    }
    if (K.reveal && K.reveal.on) {
      K.reveal.t += dt;
      drawReveal(api.sim, K.reveal.t);
    }
  },
  /** SPACE takes the photo while the shot is on; otherwise the key is the game's. */
  key(api, code, down, e) {
    const sim = api.sim;
    if (!down || K.beat !== 'chase') return false;
    if (!isKey(sim, 'storyPhoto', code) || playerClaimed(sim, code, 'storyPhoto')) return false;
    const m = meteors(sim);
    const info = m && m.photoInfo ? m.photoInfo() : null;
    if (!info || info.taken || !m.giantPos()) return false;
    if (e && e.repeat) return true;
    snap(sim);
    return true;
  },
  /** For the tests. */
  _state: K,
};

function trackerItems(api) {
  const sim = api.sim;
  const r = sim.runner;
  const step = r && r.step ? r.step.id : null;
  const s = stats(sim);
  const m = meteors(sim);
  const g = m && m.giantPos();
  const ac = sim.aircraft;
  const inChase = K.beat === 'chase';
  const taken = !!(s && s.photoTaken) || K.photoDist > 0;
  const stepOrder = ['climb', 'catch', 'photo', 'turn'];
  const si = inChase ? stepOrder.indexOf(step) : 9;
  const item = (text, state, extra = {}) => ({ text, state, ...extra });
  const dist = g && ac ? ac.pos.distanceTo(g) : null;
  const items = [
    item(CHAPTER_1.objectives[0], si > 0 ? 'done' : 'active', si === 0 && ac ? { note: `${Math.round(ac.pos.y / FT).toLocaleString()} ft of ${K.diff.climbFt.toLocaleString()}` } : {}),
    item(CHAPTER_1.objectives[1], si > 1 || taken ? 'done' : si === 1 ? 'active' : 'todo', si === 1 && dist != null ? { meter: 1 - Math.min(1, Math.max(0, (dist - CATCH_M) / 6000)), note: `${(dist / 1000).toFixed(1)} km` } : {}),
    item(CHAPTER_1.objectives[2].replace('SPACE', keyName('storyPhoto', sim) || 'SPACE'), taken ? 'done' : si === 2 ? 'active' : 'todo', taken ? { note: `${Math.round(K.photoDist)} m · ${K.photoQuality}%` } : si === 2 && dist != null ? { note: `${Math.round(dist)} m — inside ${K.diff.photoRange} m` } : {}),
    item(CHAPTER_1.objectives[3], K.playerShotT != null && (K.coleShotT == null || K.playerShotT < K.coleShotT) ? 'done' : K.coleShotT != null ? 'failed' : si >= 1 ? 'active' : 'todo', K.coleShotT != null && K.playerShotT == null ? { note: 'Cole has his shot' } : K.cole && g && si >= 1 && K.playerShotT == null ? { note: `Cole: ${(K.cole.pos.distanceTo(g) / 1000).toFixed(1)} km from it` } : {}),
    item(CHAPTER_1.objectives[4], K.beat === 'land' ? (K.landing ? 'done' : 'active') : 'todo', K.beat === 'land' && ac ? { note: `${(ac.pos.distanceTo(RUNWAY.touchdown) / 1000).toFixed(1)} km to the runway${K.goArounds ? ` · ${K.goArounds} go-around` : ''}` } : {}),
  ];
  return items;
}
