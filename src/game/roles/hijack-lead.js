/**
 * The hijacks, from the fighter's seat.
 *
 * The captain's side is src/features/events/hijack.js and the two missions in
 * src/game/extra/events.js; nothing here changes either. These are the other
 * seat in the same two stories — "you can be the lead fighter jet", in the
 * owner's words — with the airliner, its captain, your wingman and the
 * police flown by the game:
 *
 *   Hijack: By the Book, seat 'lead'. Scramble from Kestrel, come up behind
 *   the jet squawking 7500, slow to its speed, move up on its LEFT where the
 *   captain can see you, and give the real ICAO intercept signals (Annex 2,
 *   Appendix 2): rock your wings — "you have been intercepted, follow me" —
 *   and he rocks back; a slow level turn, normally to the left; lead him down
 *   the slope; wheels down — "land at this aerodrome" — and his come down
 *   too; then an abrupt climbing turn away without crossing his path — "you
 *   may proceed" — and he lands at the far end, away from the terminal, and
 *   the police go in while you hold overhead.
 *
 *   Hijacked! (the film version), seat 'shadow'. The man on the flight deck
 *   must not see the fighters, so you and your wingman sit low behind the
 *   airliner's tail all the way to the island. Once he looks out of the side
 *   window. Then you peel off and let the police take it.
 *
 * WHAT IT IS NOT. As the captain's seat: nobody has a weapon, nobody is hurt,
 * and the hijacker is never on screen — from the fighter, the cabin's story
 * reaches you only as short radio relays. The fighters guide and watch. They
 * never threaten anybody.
 *
 * The facts both seats share with the captain's story — the code phrase, the
 * remote runway rule, the callsigns — are restated here rather than imported,
 * because hijack.js keeps them private and is being worked on by the
 * emergency-services builder at the same time; pulling them out into one
 * shared module is a small follow-up once that has landed.
 */

import * as THREE from '../../vendor/three.module.js';
import { RUNWAY } from '../../world/airport.js';
import { heightAt } from '../../world/terrain.js';
import { AIRCRAFT, getAircraft } from '../../aircraft/types.js';
import * as Prog from '../progression.js';
import { Escort } from '../../features/events/escort.js';
import * as UI from '../../features/events/ui.js';
import {
  longHaulId, cruiseSpeed, field, runwayWordsFor, runwayNumberFor, headingWords, secondRunway,
  speak, notify, VOICE_FIGHTER, registerVoices, runwayFrame, RW, flat, bearing, angleDiff, FT,
} from '../../features/events/common.js';
import { NpcFlyer, TAN3 } from './npc-flyer.js';
import {
  registerStory, castStory, castSkip, castSim, SlotRing, PoliceResponse, padlock, localOf, worldOf,
  clearanceTo, RockWatch, BreakWatch,
} from './cast.js';

/* ================================================================== *
 * Shared
 * ================================================================== */

export const STORY_REAL = 'hijack-real-lead';
export const STORY_FILM = 'hijack-film-shadow';

const LEAD = 'Guardian lead';
/** The airline's made-up code for "trouble on board" — the same phrase as hijack.js's CODE_PHRASE. */
export const CODE_PHRASE = 'the coffee is cold';

function progNow() {
  const s = castSim();
  if (s && s.prog) return s.prog;
  try {
    return Prog.load();
  } catch (e) {
    return null;
  }
}

/**
 * Which fighter you fly. The Vanguard F-1 for everybody; the F-22 once the
 * military passcode is in and the roster has one. Not the F-22 regardless:
 * it is a passcode aeroplane, and a mission that is not behind that code
 * must not hand it out. Your wingman is always the same type as you.
 */
export function fighterId(prog = progNow()) {
  if (prog && prog.militaryUnlocked && AIRCRAFT.some((a) => a.id === 'f22')) return 'f22';
  return 'vanguard';
}

function typeById(id) {
  return AIRCRAFT.find((a) => a.id === id) || getAircraft(id);
}

/** "747", "A380", "Meridian": the airliner's name as a pilot would say it. */
export function shortName(id) {
  if (id === 'b747') return '747';
  if (id === 'a380') return 'A380';
  const t = typeById(id);
  return t && t.name ? String(t.name).split(' ')[0] : 'airliner';
}

/** The type's name in the plural, for "two Vanguards" on the radio. */
function plural(id) {
  const t = typeById(id);
  const n = t && t.name ? String(t.name) : 'fighter';
  return n.endsWith('s') ? n : `${n}s`;
}

/**
 * Where the fighters bring him: the remote runway, away from the terminal.
 * The rule is hijack.js's chooseRemote(): the crosswind runway when it is
 * long enough for this aeroplane (1,500 m for anything with more than 45 m
 * of wing, 1,100 m otherwise), else the main runway in its own direction,
 * rolled right to its far end. At Kestrel the crosswind strip is 900 m, so
 * a jumbo goes to the far end of 09.
 */
export function remoteRunway(spanM, from) {
  runwayFrame();
  const R2 = secondRunway();
  const out = { thr: new THREE.Vector3(), dir: new THREE.Vector3(), hdg: 90, td: new THREE.Vector3(), stop: new THREE.Vector3(), real: false, name: '' };
  if (R2.real && R2.L >= (spanM > 45 ? 1500 : 1100)) {
    const side = from ? (from.x - R2.c.x) * R2.f.x + (from.z - R2.c.z) * R2.f.z : -1;
    const dir = side > 0 ? -1 : 1;
    out.dir.copy(R2.f).multiplyScalar(dir);
    out.hdg = (R2.headingDeg + (dir < 0 ? 180 : 0)) % 360;
    out.thr.copy(R2.c).addScaledVector(out.dir, -R2.L / 2);
    out.real = true;
    out.L = R2.L;
  } else {
    out.hdg = RUNWAY.headingDeg ?? 90;
    out.dir.copy(RW.f);
    out.thr.copy(RW.c).addScaledVector(RW.f, -RW.L / 2);
    out.L = RW.L;
  }
  out.thr.y = heightAt(out.thr.x, out.thr.z);
  out.td.copy(out.thr).addScaledVector(out.dir, Math.min(200, out.L * 0.2));
  out.td.y = heightAt(out.td.x, out.td.z);
  // The remote stand: a hundred metres short of the far end.
  out.stop.copy(out.thr).addScaledVector(out.dir, out.L - 100);
  out.stop.y = heightAt(out.stop.x, out.stop.z);
  out.name = out.real ? `runway ${runwayNumberFor(out.hdg)}, the remote runway` : `runway ${runwayNumberFor(out.hdg)}, right to its far end`;
  return out;
}

/** Along the runway from the threshold (negative before it), across it (+ right), heading off it. */
function rwFrame(rw, p, heading) {
  const along = (p.x - rw.thr.x) * rw.dir.x + (p.z - rw.thr.z) * rw.dir.z;
  const cross = (p.x - rw.thr.x) * -rw.dir.z + (p.z - rw.thr.z) * rw.dir.x;
  return { along, cross, off: Math.abs(angleDiff(heading, rw.hdg)) };
}

/** The approach box the captain's story uses (hijack.js updateFollow): out in front, roughly lined up. */
function inApproachBox(rw, p, heading) {
  const f = rwFrame(rw, p, heading);
  return f.along > -9500 && f.along < -1200 && Math.abs(f.cross) < 1500 && f.off < 70;
}

/** Story beats in game time, as common.js's after(): pausing pauses them. */
function after(st, s, fn) {
  st.beats.push({ at: st.t + s, fn });
}

function runBeats(st, sim) {
  for (let i = 0; i < st.beats.length; i++) {
    if (st.t >= st.beats[i].at) {
      const b = st.beats[i];
      st.beats.splice(i, 1);
      i--;
      try {
        b.fn(sim);
      } catch (e) {
        console.warn('[roles] a story beat failed', e);
      }
    }
  }
}

function card(sim, o) {
  UI.showCard(sim, { tone: 'info', ttl: 10, ...o });
}

/** The ambient tower must not clear a Vanguard to land while the story is elsewhere. */
function quietTower(sim) {
  const s = sim.atc && sim.atc.said;
  if (!s) return;
  s.start = true;
  s.clearance = true;
  s.airborne = true;
  s.final = true;
  s.shortfinal = true;
}

/** The step the runner is on in THIS mission, or null; 'over' once it has finished. */
function stepOf(sim, def) {
  const r = sim.runner;
  if (!r || r.def !== def) return null;
  if (r.status === 'running') return r.step ? r.step.id : null;
  return 'over';
}

function scoreFor(elapsed, par) {
  if (elapsed <= par) return 1;
  return Math.max(0, 1 - (elapsed - par) / par);
}

const TMP = new THREE.Vector3();
const TMP2 = new THREE.Vector3();
const LOC = { x: 0, y: 0, z: 0 };

/* ================================================================== *
 * Hijack: By the Book — seat 'lead'
 * ================================================================== */

/** Where the airliner is when the story starts: 6.4 km out, bearing 290 from the field, flying his heading away. */
function realStart() {
  runwayFrame();
  const brg = 290;
  const r = (brg * Math.PI) / 180;
  return { pos: new THREE.Vector3(RW.c.x + Math.sin(r) * 6400, 1500, RW.c.z - Math.cos(r) * 6400), heading: brg };
}

function createRealLead(sim, def) {
  registerVoices();
  const airId = longHaulId();
  const air = new NpcFlyer(sim.scene, airId, { name: 'airliner' });
  const start = realStart();
  air.place({ pos: start.pos, headingDeg: start.heading, speed: cruiseSpeed(airId), gearDown: false });
  air.direct(start.heading, start.pos.y, cruiseSpeed(airId));
  air.rw = remoteRunway(air.span, air.pos);
  const playerType = sim.aircraftType || typeById(fighterId());
  // Now, not on the first frame: the ambient tower speaks before the cast's update does.
  quietTower(sim);

  const st = {
    id: STORY_REAL,
    actors: { airliner: air, wing: null, lead: sim.aircraft },
    air,
    wing: null,
    wingRef: 'player',
    ring: new SlotRing(sim.scene, 16),
    def,
    t: 0,
    beats: [],
    stepId: null,
    stepT: 0,
    brain: 'hijack',
    cs: air.callsign,
    // Run-in.
    saidVector: false,
    relays: 0,
    astern: false,
    inFront: false,
    // Match and identify.
    matched: false,
    matchT: 0,
    speedT: 0,
    slotT: 0,
    idDone: false,
    idAt: 0,
    slotPos: new THREE.Vector3(),
    // The rock.
    rockWatch: new RockWatch(),
    rocked: false,
    rockBy: '',
    rockedBack: false,
    following: false,
    // Leading.
    inBox: false,
    downDone: false,
    leadT: 0,
    leadGood: 0,
    slopeT: 0,
    slopeGood: 0,
    lostT: 0,
    farSaid: 0,
    coachT: 0,
    // "Land here".
    gearSig: false,
    gearBy: '',
    gearBack: false,
    // The breakaway.
    brk: new BreakWatch(),
    released: false,
    releaseBy: '',
    crossed: false,
    broke: false,
    breakHow: '',
    // The ground.
    landed: false,
    stopped: false,
    police: null,
    boarded: false,
    goArounds: 0,
    // Overhead and home.
    ovT: 0,
    ovGood: 0,
    home: false,
    // Fails and warnings.
    failWhy: null,
    closeWarnT: 0,
    minClear: Infinity,
    aim: new THREE.Vector3(),
  };

  air.onEvent = (what) => {
    if (what === 'goaround') {
      st.goArounds++;
      speak(sim, `${st.cs}, ${field()} Approach. Not lined up — go around, we will bring you round again.`, 'approach');
    } else if (what === 'touchdown') {
      st.landed = true;
      notify(sim, `He is down on ${st.air.rw.name.split(',')[0]}.`, 'good', 4);
    } else if (what === 'stopped') {
      st.stopped = true;
      speak(sim, `${LEAD}, ${field()} Tower. The ${shortName(airId)} is stopped at the remote stand. Police are rolling.`, 'tower');
      st.police = new PoliceResponse(sim, air);
    }
  };

  /* ---------------------------------------------------- the brains -- */

  function release(by) {
    if (st.released) return;
    st.released = true;
    st.releaseBy = by;
    st.brain = 'land';
    air.vecAlt = air.pos.y;
    air.land(air.rw);
    if (!air.gearDown) air.setGear(true);
    if (st.wing && !st.wing.gone) {
      st.wing.setMode('breakaway');
      st.wing.setGear(false);
    }
    if (by === 'auto') {
      speak(sim, `${LEAD}, ${field()} Approach. He is on short final — let him go. Break away now.`, 'approach');
    } else {
      speak(sim, `${st.cs}, ${field()} Tower, ${air.rw.name.split(',')[0]}, cleared to land. Roll to the far end, stop, and shut down. That is your remote stand.`, 'tower');
    }
  }

  function spawnWing() {
    if (st.wing) return;
    try {
      const w = new Escort(sim.scene, 1, playerType);
      w.placeBehind(sim.aircraft, 650);
      w.setMode('trail');
      st.wing = w;
      st.actors.wing = w;
      speak(sim, `${LEAD}, Guardian two. Airborne, on your right, half a mile behind.`, VOICE_FIGHTER);
    } catch (e) {
      console.warn('[roles] the wingman could not be built', e);
      st.wing = { gone: true, update() {}, setMode() {}, setGear() {}, dispose() {} };
    }
  }

  function onStep(sim, id) {
    const ac = sim.aircraft;
    if (id === 'match') {
      st.wingRef = 'air';
      speak(sim, `${LEAD}, Guardian two. Dropping back to trail him. I'll watch from behind.`, VOICE_FIGHTER);
    } else if (id === 'identify') {
      st.idAt = st.t;
      card(sim, {
        who: 'Intercept — identify',
        text: `Move up on his LEFT side, a little ahead and above, into the blue ring. That is where the captain can see you from his seat. Hold it for three seconds.`,
        ttl: 14,
      });
    } else if (id === 'rock') {
      st.rockWatch.reset();
      card(sim, {
        who: 'Intercept signal',
        tone: 'warn',
        icon: 'rock',
        text: 'Rock your wings: roll left, then right (A, then D). Every pilot in the world knows it: "You have been intercepted. FOLLOW ME."',
        ttl: 16,
      });
    } else if (id === 'lead') {
      card(sim, {
        who: 'Lead him in',
        text: `A slow, LEVEL turn to the LEFT, towards ${field()}. Gentle: a jumbo turns at three degrees a second, not thirty. Follow the arrow — it shows where to take him.`,
        ttl: 14,
      });
      speak(sim, `${LEAD}, ${field()} Approach. Bring him to ${air.rw.name}. The police are waiting there, away from the terminal.`, 'approach');
    } else if (id === 'down') {
      card(sim, {
        who: 'Down the slope',
        text: 'He is lined up behind you. Power back and the nose a little down: he follows your height down the slope to the runway.',
        ttl: 12,
      });
    } else if (id === 'gear') {
      card(sim, {
        who: 'Intercept signal',
        tone: 'warn',
        icon: 'gear',
        text: `Lower your wheels (G). Wheels down from the leader means "LAND AT THIS AERODROME". Keep flying down the approach to runway ${runwayNumberFor(air.rw.hdg)}.`,
        ttl: 14,
      });
      if (ac.gearDown) signalGear('you');
    } else if (id === 'break') {
      st.brk.reset();
      card(sim, {
        who: 'Intercept signal',
        tone: 'warn',
        icon: 'breakaway',
        text: 'Let him go: an abrupt CLIMBING turn to the LEFT — away from him, never across his nose. That is "YOU MAY PROCEED": he lands on his own.',
        ttl: 14,
      });
    } else if (id === 'overhead') {
      card(sim, {
        who: 'Overhead',
        text: 'Hold above 3,000 ft over the field while he lands at the far end and the police go in. Hold B to look at him.',
        ttl: 12,
      });
    } else if (id === 'rtb') {
      speak(sim, `${LEAD}, ${field()} Approach. The police are aboard; everybody on that aeroplane is safe. Good work, Guardian. Return to base, head east for the mainland.`, 'approach');
      card(sim, { who: 'Job done', tone: 'good', text: 'Everybody on board is safe. Head east, back to the mainland.', ttl: 10 });
    }
  }

  function signalGear(by) {
    if (st.gearSig) return;
    st.gearSig = true;
    st.gearBy = by;
    if (by === 'you') speak(sim, `${LEAD}. Wheels down, runway ${runwayWordsFor(air.rw.hdg)}.`, VOICE_FIGHTER);
    after(st, 2, () => {
      air.setGear(true);
      st.gearBack = true;
      card(sim, {
        who: 'He answered',
        tone: 'good',
        icon: 'gear',
        text: 'His wheels are coming down: "UNDERSTOOD, WILL COMPLY". He will land where you are taking him.',
        ttl: 8,
      });
    });
  }

  /** Rocked, by you or — after half a minute — taken as read. */
  function rocked(by) {
    if (st.rocked) return;
    st.rocked = true;
    st.rockBy = by;
    if (by === 'you') {
      after(st, 2, () => {
        air.rock(5);
        st.rockedBack = true;
        card(sim, {
          who: 'He rocked back',
          tone: 'good',
          icon: 'rock',
          text: '"Understood, will comply." He is following you now. Lead him gently: everything you do, a jumbo has to copy.',
          ttl: 10,
        });
        speak(sim, `${LEAD}. He rocked back. He's following.`, VOICE_FIGHTER);
      });
      after(st, 3, () => {
        st.brain = 'follow';
        st.following = true;
        air.follow(sim.aircraft, { back: 120 + air.span * 0.6, right: air.span * 0.5 + 30, down: 15, lookahead: 600 });
      });
    } else {
      speak(sim, `${LEAD}, ${field()} Approach. The captain says he has seen you and will follow.`, 'approach');
      st.brain = 'follow';
      st.following = true;
      air.follow(sim.aircraft, { back: 120 + air.span * 0.6, right: air.span * 0.5 + 30, down: 15, lookahead: 600 });
    }
  }

  /* ----------------------------------------------------- the frame -- */

  st.update = (sim, dt) => {
    st.t += dt;
    const ac = sim.aircraft;
    const id = stepOf(sim, def);
    if (id !== st.stepId) {
      st.stepId = id;
      st.stepT = 0;
      onStep(sim, id);
    } else {
      st.stepT += dt;
    }
    runBeats(st, sim);
    quietTower(sim);
    if (!ac || ac.crashed) {
      air.update(dt, sim.weather);
      st.ring.hide();
      return;
    }

    // Wingman: off the runway after you, trailing you, then trailing him.
    if (!ac.onGround && ac.airborneTime > 4 && !st.wing) spawnWing();
    if (st.wing && !st.wing.gone) {
      const ref = st.wingRef === 'air' ? air : ac;
      const span = st.wingRef === 'air' ? air.span : (playerType.aero && playerType.aero.wingSpan) || 10;
      st.wing.update(dt, ref, span, sim.weather);
    }

    // The airliner.
    air.update(dt, sim.weather);
    localOf(air, ac.pos, LOC);
    const d3 = ac.pos.distanceTo(air.pos);
    const dFlat = flat(ac.pos, air.pos);

    // The run-in: tell them where he is, then the captain's side, relayed.
    if (!st.saidVector && !ac.onGround && ac.airborneTime > 5) {
      st.saidVector = true;
      const brg = bearing(ac.pos, air.pos);
      const km = Math.round(dFlat / 1000);
      speak(sim, `${LEAD}, ${field()} Approach. Your target is ${st.cs}, squawking seven five zero zero, bearing ${headingWords(brg)}, ${km} kilometres, five thousand feet. Come up behind him — never head-on.`, 'approach');
    }
    if (id === 'vector' || id === 'match') {
      const RELAYS = [
        [8, `${LEAD}, ${field()} Approach. The captain has kept his flight deck door locked. Somebody in the cabin is giving orders on the interphone.`],
        [26, `${LEAD}, we asked him to confirm seven five zero zero. Two clicks on the microphone: it's real.`],
        [44, `${LEAD}, he just told us "${CODE_PHRASE}". That is his airline's code for trouble on board. He is flying the man's heading.`],
      ];
      while (st.relays < RELAYS.length && st.stepT > RELAYS[st.relays][0] && id === 'vector') {
        speak(sim, RELAYS[st.relays][1], 'approach');
        st.relays++;
      }
    }
    // Astern: within 1.5 km, in his rear 60-degree cone. In front of his
    // wing line inside 2 km before that: head-on, which the score remembers.
    const offNose = (Math.atan2(Math.abs(LOC.x), -LOC.z) * 180) / Math.PI;
    if (id === 'vector') {
      if (dFlat < 2000 && offNose < 90) st.inFront = true;
      if (dFlat < 1500 && offNose > 120) st.astern = true;
    }

    // Matching speed: true airspeed, both of you, so the HUD's IAS is near enough.
    const mySpd = Math.hypot(ac.vel.x, ac.vel.z);
    const dv = mySpd - air.speed;
    if (id === 'match') {
      st.matchT = Math.abs(dv) < 8 && dFlat < 900 ? st.matchT + dt : 0;
      if (st.matchT > 1.5) st.matched = true;
    }
    if ((id === 'match' || id === 'identify') && st.stepT > 4) {
      st.speedT -= dt;
      if (st.speedT <= 0 && Math.abs(dv) > 10) {
        st.speedT = 6;
        const kt = Math.round(Math.abs(dv) * 1.944 / 5) * 5;
        notify(sim, dv > 0 ? `${kt} knots faster than him — power back` : `${kt} knots slower than him — a little more power`, 'info', 4);
      }
    }

    // The identify slot: the escorts' 'lead' slot (escort.js), as a ring.
    if (id === 'identify' || id === 'rock') {
      worldOf(air, -(air.span * 0.5 + 25), 12, -(80 + air.span * 0.5), st.slotPos);
      localOf(air, ac.pos, LOC);
      const sx = LOC.x + (air.span * 0.5 + 25);
      const sy = LOC.y - 12;
      const sz = LOC.z + (80 + air.span * 0.5);
      const inside = Math.abs(sx) < 25 && Math.abs(sy) < 18 && Math.abs(sz) < 45;
      if (id === 'identify') {
        st.ring.show(st.slotPos, air.heading, inside);
        st.slotT = inside ? st.slotT + dt : Math.max(0, st.slotT - dt * 0.5);
        if (st.slotT > 3 && !st.idDone) {
          st.idDone = true;
          speak(sim, `${field()} Approach, ${LEAD}. Visual. ${st.cs}. The captain is waving.`, VOICE_FIGHTER);
          card(sim, { who: 'Identified', tone: 'good', text: `${st.cs}. You can see the captain through the side window — and he can see you. He is waving.`, ttl: 7 });
        }
      } else {
        st.ring.hide();
      }
    } else {
      st.ring.hide();
    }
    if (id === 'rock' && !st.rocked) {
      if (st.rockWatch.update(dt, ac.bankAngleDeg())) rocked('you');
      else if (st.stepT > 30) rocked('timeout');
    }

    // Leading: is he in the box, on the slope, still with you?
    if (st.brain === 'follow' && !st.released) {
      st.leadT += dt;
      if (air.leaderDist < 1200) st.leadGood += dt;
      st.inBox = st.inBox || inApproachBox(air.rw, air.pos, air.heading);
      const f = rwFrame(air.rw, air.pos, air.heading);
      const alongTd = (air.pos.x - air.rw.td.x) * air.rw.dir.x + (air.pos.z - air.rw.td.z) * air.rw.dir.z;
      const slopeY = air.rw.td.y + air.ride + Math.max(0, -alongTd) * TAN3;
      if (id === 'down') {
        st.slopeT += dt;
        if (Math.abs(air.pos.y - slopeY) < 90) st.slopeGood += dt;
        if (st.inBox && f.along > -6500) st.downDone = true;
        st.coachT -= dt;
        if (st.coachT <= 0 && air.pos.y - slopeY > 150) {
          st.coachT = 18;
          notify(sim, `He is ${Math.round(((air.pos.y - slopeY) * FT) / 100) * 100} ft high — lead him down: power back, nose a little down`, 'warn', 5);
        }
      }
      if (st.inBox && f.along > -3800 && Math.abs(f.cross) < 400 && f.off < 25) release('auto');
      // Lost: more than 6 km apart for 40 s.
      if (dFlat > 6000) st.lostT += dt;
      else st.lostT = 0;
      if (dFlat > 3000) {
        st.farSaid -= dt;
        if (st.farSaid <= 0) {
          st.farSaid = 15;
          notify(sim, 'He cannot keep up — slow down and turn gently, he has to see you to follow you', 'warn', 5);
        }
      }
      if (st.lostT > 40) st.failWhy = 'He lost you. Lead gently and slowly — a jumbo has to be able to follow.';
    }
    if (id === 'gear' && !st.gearSig && ac.gearDown) signalGear('you');
    if (st.released && !st.gearSig) {
      st.gearSig = true;
      st.gearBy = 'auto';
    }

    // The breakaway: judged only on what is flown in the 'break' step.
    if (id === 'break') {
      st.brk.update(dt, ac.heading, ac.pos.y);
      // Crossing his track: on his right, ahead of his wing line.
      if (LOC.x > 0 && LOC.z < 0 && dFlat < 1500) st.crossed = true;
    }
    if (id === 'break' && !st.broke) {
      const left = st.brk.found(70, 100, -1);
      const any = st.brk.found(70, 100, 0);
      if (left || any) {
        st.broke = true;
        st.breakHow = st.crossed ? 'crossed' : left ? 'clean' : 'right';
        if (!st.released) release('break');
        speak(sim, `${st.cs}, ${LEAD}. You may proceed. Good luck, Captain.`, VOICE_FIGHTER);
        card(sim, {
          who: st.breakHow === 'clean' ? 'You may proceed' : 'Broken away',
          tone: st.breakHow === 'clean' ? 'good' : 'warn',
          icon: 'breakaway',
          text: st.breakHow === 'clean'
            ? 'A climbing turn away, on your own side. He has seen it, and he is landing on his own.'
            : st.breakHow === 'crossed'
              ? 'You crossed in front of him on the way. The rule is AWAY: you are on his left, so the turn is to the left.'
              : 'Away — but to the right, towards his side. You were on his left, so the turn away is to the left.',
          ttl: 8,
        });
      } else if (st.released && st.stepT > 25) {
        st.broke = true;
        st.breakHow = 'late';
      }
    }

    // Too close: a fighter is not a collider, so this is the referee.
    const clear = clearanceTo(air, ac.pos);
    if (clear < st.minClear) st.minClear = clear;
    if (clear < 2) st.failWhy = st.failWhy || 'Far too close — you would have hit him. In formation, keep a wingspan of air between you.';
    else if (clear < 22) {
      st.closeWarnT -= dt;
      if (st.closeWarnT <= 0) {
        st.closeWarnT = 6;
        notify(sim, 'Too close! Give him room', 'warn', 3);
      }
    }

    // On the ground: the police.
    if (st.police) {
      st.police.update(dt);
      if (st.police.boarded && !st.boarded) {
        st.boarded = true;
        card(sim, { who: 'Police', tone: 'good', text: 'The tactical team is aboard. The captain kept the door locked the whole way. Everybody is safe.', ttl: 10 });
      }
    }
    if (id === 'overhead') {
      st.ovT += dt;
      if (ac.pos.y * FT > 2500 && flat(ac.pos, RW.c) < 7000) st.ovGood += dt;
    }
    if (id === 'rtb') {
      runwayFrame();
      st.home = ac.pos.x - RW.c.x > 8000;
    }
  };

  st.camera = (sim, dt, camera) => {
    const input = sim.input;
    if (!input || typeof input.held !== 'function' || !input.held('lookBehind')) return false;
    const ac = sim.aircraft;
    if (!ac || ac.crashed || ac.onGround || air.gone) return false;
    return padlock(sim, dt, camera, air.pos, air.span);
  };

  st.signal = (kind, from) => {
    if (kind === 'rock' && from === 'lead') rocked('you');
    else if (kind === 'gear' && from === 'lead') signalGear('you');
    else if (kind === 'breakaway' && from === 'lead') release('break');
    else return false;
    return true;
  };

  st.info = (out) => {
    out.brain = st.brain;
    out.step = st.stepId;
    out.airliner = [Math.round(air.pos.x), Math.round(air.pos.y), Math.round(air.pos.z)];
    out.airHeading = Math.round(air.heading);
    out.airSpeed = Math.round(air.speed);
    out.airMode = air.mode;
    out.airPhase = air.landPhase;
    out.airGear = air.gearDown;
    out.airMinClear = Math.round(air.minClear * 10) / 10;
    out.astern = st.astern;
    out.idDone = st.idDone;
    out.rocked = st.rocked;
    out.rockBy = st.rockBy;
    out.rockedBack = st.rockedBack;
    out.following = st.following;
    out.inBox = st.inBox;
    out.downDone = st.downDone;
    out.gearSig = st.gearSig;
    out.gearBy = st.gearBy;
    out.gearBack = st.gearBack;
    out.released = st.released;
    out.releaseBy = st.releaseBy;
    out.broke = st.broke;
    out.breakHow = st.breakHow;
    out.landed = st.landed;
    out.stopped = st.stopped;
    out.boarded = st.boarded;
    out.home = st.home;
    out.goArounds = st.goArounds;
    out.wing = !!(st.wing && !st.wing.gone);
    out.failWhy = st.failWhy;
    out.minClear = Number.isFinite(st.minClear) ? Math.round(st.minClear) : null;
    out.stopAt = [Math.round(air.rw.stop.x), Math.round(air.rw.stop.z)];
  };

  st.dispose = () => {
    air.dispose();
    if (st.wing && st.wing.dispose) st.wing.dispose();
    st.ring.dispose();
    if (st.police) st.police.dispose();
    UI.hideCard();
  };

  return st;
}

registerStory(STORY_REAL, createRealLead);

function realStory() {
  return castStory(STORY_REAL);
}

/** A step that waits on the story: done when `fn(story)` says so, or given up if the story is not running. */
function waitReal(fn, why = 'The other aircraft are not running — carry on.') {
  return (ctx, dt) => {
    const s = realStory();
    if (s && fn(s, ctx)) return true;
    return castSkip(ctx, dt, why);
  };
}

const T_ASTERN = new THREE.Vector3();
const T_LEAD = new THREE.Vector3();
const T_FIELD = new THREE.Vector3();
const T_HOME = new THREE.Vector3();

const LEAD_REAL = {
  id: 'lead',
  label: 'The lead fighter',
  line: 'Intercept him by the rules, and lead him to the remote runway.',
  icon: '✈️',
  actor: 'lead',
  baseGate: true,
  get aircraft() {
    return fighterId();
  },
  /*
   * A scramble, so on the runway with the engine running — from the east
   * end, pointing west, straight out over the sea towards him. Taking off on
   * 09 meant a turn back across the island's high ground at a few hundred
   * feet to go after an airliner to the north-west.
   */
  get spawn() {
    runwayFrame();
    const p = new THREE.Vector3().copy(RW.c).addScaledVector(RW.f, RW.L / 2 - 80);
    p.y = RUNWAY.elev ?? 14;
    return { pos: p, headingDeg: ((RUNWAY.headingDeg ?? 90) + 180) % 360 };
  },
  parTime: 600,
  cast: { story: STORY_REAL, actors: { airliner: { type: 'long-haul', brain: 'captain' }, wing: { type: 'same-as-you', brain: 'wingman' } } },
  steps: [
    {
      id: 'scramble',
      text: 'SCRAMBLE! An airliner is squawking 7500. Full power (Shift), take off down runway 27, and climb.',
      hint: 'Full power, ease back on S at about 140 knots, then wheels up (G).',
      atc: { text: `${LEAD}, Kestrel Tower. Scramble, scramble. Runway two seven, cleared for take-off. Contact Approach airborne.`, voice: 'tower', urgency: 1 },
      check: (ctx) => ctx.ac.airborneTime > 3 && ctx.ac.agl > 120,
    },
    {
      id: 'vector',
      text: 'Fly to him and come up BEHIND him — never head-on. Follow the arrow.',
      hint: 'The arrow points at a spot a mile and a half behind him. Fast is fine for now.',
      targetLabel: 'Behind him',
      target: () => {
        const s = realStory();
        if (!s) return null;
        return worldOf(s.air, 0, 0, 1500, T_ASTERN);
      },
      check: waitReal((s) => s.astern),
    },
    {
      id: 'match',
      text: 'Slow down to his speed — about 145 knots — and close in. Your wingman stays back and watches.',
      hint: 'Power back (Ctrl). The note under the arrow says how much faster than him you are.',
      targetLabel: 'The airliner',
      target: () => {
        const s = realStory();
        return s ? s.air.pos : null;
      },
      check: waitReal((s) => s.matched),
    },
    {
      id: 'identify',
      text: 'Move up on his LEFT, a little ahead and above — into the ring — where the captain can see you.',
      hint: 'Small, slow corrections. Match his speed first, then slide forward.',
      targetLabel: 'Intercept position',
      target: () => {
        const s = realStory();
        return s ? s.slotPos : null;
      },
      check: waitReal((s) => s.idDone),
    },
    {
      id: 'rock',
      text: 'Rock your wings — roll left, then right (A, then D): "You have been intercepted. Follow me."',
      hint: 'A quarter of the way over each way, then wings level again. Stay in front of him.',
      check: waitReal((s) => s.following),
    },
    {
      id: 'lead',
      text: 'A slow, LEVEL turn to the LEFT, towards Kestrel. Gentle — he cannot turn like you.',
      hint: 'Shallow bank, steady height, about his speed. The arrow is where to take him; glance back with B.',
      targetLabel: 'Take him here',
      target: (ctx) => {
        const s = realStory();
        if (!s) return null;
        // The captain's story's own way in: an entry point off to one side, then the gate.
        const rw = s.air.rw;
        const f = rwFrame(rw, s.air.pos, s.air.heading);
        const side = f.cross >= 0 ? 1 : -1;
        if (!s.entryDone) {
          T_LEAD.set(rw.thr.x - rw.dir.x * 9500 - rw.dir.z * side * 1800, s.air.pos.y, rw.thr.z - rw.dir.z * 9500 + rw.dir.x * side * 1800);
          if (flat(s.air.pos, T_LEAD) < 1600 || (f.along < -7500 && Math.abs(f.cross) < 1500)) s.entryDone = true;
        }
        if (s.entryDone) T_LEAD.set(rw.thr.x - rw.dir.x * 7000, s.air.pos.y, rw.thr.z - rw.dir.z * 7000);
        return T_LEAD;
      },
      check: waitReal((s) => s.inBox),
    },
    {
      id: 'down',
      text: 'He is lined up behind you. Lead him down the slope to the runway — he follows your height.',
      hint: 'Power back, nose a little down: about 700 feet a minute. Watch the PAPI lights: two white, two red.',
      targetLabel: 'Runway 09',
      target: () => {
        const s = realStory();
        return s ? s.air.rw.td : RUNWAY.touchdown;
      },
      check: waitReal((s) => s.downDone || s.released),
    },
    {
      id: 'gear',
      text: 'Wheels down (G): "LAND AT THIS AERODROME". Keep leading him down the approach.',
      hint: 'Press G. He answers by putting his wheels down too.',
      targetLabel: 'Runway 09',
      target: () => {
        const s = realStory();
        return s ? s.air.rw.td : RUNWAY.touchdown;
      },
      check: waitReal((s) => s.gearSig && (s.gearBack || s.released)),
    },
    {
      id: 'break',
      text: 'Let him go: an abrupt CLIMBING turn to the LEFT, away from him — never across his nose. "You may proceed."',
      hint: 'Full power, pull up and roll left: at least a quarter turn, and climb.',
      check: waitReal((s) => s.broke),
    },
    {
      id: 'overhead',
      text: 'Hold overhead, above 3,000 ft, while he lands at the far end and the police go in. Hold B to look at him.',
      hint: 'Circle the field. Hold B to see him on the runway.',
      targetLabel: 'Over the field',
      target: () => {
        runwayFrame();
        return T_FIELD.set(RW.c.x, RW.c.y + 1000, RW.c.z);
      },
      check: waitReal((s, ctx) => s.boarded || ctx.runner.stepElapsed > 300),
    },
    {
      id: 'rtb',
      text: 'Job done, Guardian. Return to base: east, to the mainland.',
      hint: 'Head east (090) and climb. Eight kilometres out and you are done.',
      targetLabel: 'The mainland',
      target: () => {
        runwayFrame();
        return T_HOME.set(RW.c.x + 9000, 1200, RW.c.z);
      },
      check: waitReal((s) => s.home),
    },
  ],
  failIf: () => {
    const s = realStory();
    return s ? s.failWhy : null;
  },
  score: (ctx) => {
    const s = realStory();
    if (!s) return 50;
    const pts = {
      astern: s.inFront ? 4 : 10,
      identify: s.idDone ? 10 : 0,
      rock: s.rockBy === 'you' ? 15 : 4,
      lead: s.leadT > 0 ? Math.round(15 * Math.min(1, s.leadGood / s.leadT / 0.9)) : 8,
      slope: s.slopeT > 0 ? Math.round(10 * Math.min(1, s.slopeGood / s.slopeT / 0.8)) : 5,
      gear: s.gearBy === 'you' ? 10 : 0,
      breakaway: s.breakHow === 'clean' ? 15 : s.breakHow === 'late' ? 3 : 8,
      overhead: s.ovT > 0 ? Math.round(5 * Math.min(1, s.ovGood / s.ovT / 0.8)) : 0,
      time: Math.round(10 * scoreFor(ctx.elapsed, 600)),
    };
    s.pts = pts;
    return Math.max(0, Math.min(100, Object.values(pts).reduce((a, b) => a + b, 0)));
  },
  onComplete(ctx) {
    ctx.sim.speak(`${LEAD}, ${field()} Approach. By the book. Everyone on board is safe. Thank you.`, 'approach');
  },
};

/* ================================================================== *
 * Hijacked! (the film version) — seat 'shadow'
 * ================================================================== */

/* The captain's own route, measured: 24 km out at (-24000, 8000) on 075. The airliner starts 9 km further along it. */
const FILM_AIR = { x: -15300, z: 5670, y: 1500, hdg: 75 };

function filmStartPlayer() {
  const h = (FILM_AIR.hdg * Math.PI) / 180;
  const back = 2600;
  return {
    pos: new THREE.Vector3(FILM_AIR.x - Math.sin(h) * back, 0, FILM_AIR.z + Math.cos(h) * back),
    headingDeg: FILM_AIR.hdg,
    speed: 112,
    // Over the sea, `altAGL` counts from the sea floor (34 m down at Kestrel): 200 m below him.
    altAGL: FILM_AIR.y - 200 + 34,
  };
}

/**
 * Can the man on the flight deck see this point? Forward and to the sides,
 * not much below the nose and not behind the wings. When he leans to the
 * side window (`wide`), he can see much further back and a little lower.
 */
export function seenFrom(air, p, wide = false) {
  localOf(air, p, LOC);
  const dh = Math.hypot(LOC.x, LOC.z);
  if (Math.hypot(dh, LOC.y) > 1500) return false;
  const offNose = (Math.atan2(Math.abs(LOC.x), -LOC.z) * 180) / Math.PI;
  const elev = (Math.atan2(LOC.y, Math.max(1, dh)) * 180) / Math.PI;
  if (wide) return offNose < 172 && elev > -12;
  return offNose < 120 && elev > -25;
}

function createFilmShadow(sim, def) {
  registerVoices();
  const airId = longHaulId();
  const air = new NpcFlyer(sim.scene, airId, { name: 'airliner' });
  air.place({ pos: new THREE.Vector3(FILM_AIR.x, FILM_AIR.y, FILM_AIR.z), headingDeg: FILM_AIR.hdg, speed: cruiseSpeed(airId), gearDown: false });
  // The hijacker's orders: to the island, down to 3,000 ft, land on 09, stop.
  const rw = remoteRunway(air.span, air.pos);
  // He does not want the far end; he wants it on the runway, so it stops two-thirds of the way down.
  rw.stop.copy(rw.thr).addScaledVector(rw.dir, rw.L * 0.72);
  air.vecAlt = FILM_AIR.y;
  air.land(rw);
  const playerType = sim.aircraftType || typeById(fighterId());
  quietTower(sim);

  const st = {
    id: STORY_FILM,
    actors: { airliner: air, wing: null, lead: sim.aircraft },
    air,
    wing: null,
    ring: new SlotRing(sim.scene, 16),
    def,
    t: 0,
    beats: [],
    stepId: null,
    stepT: 0,
    cs: air.callsign,
    joined: false,
    slowed: false,
    slowT: 0,
    speedT: 0,
    slotT: 0,
    slotted: false,
    slotPos: new THREE.Vector3(),
    // The shadow.
    shT: 0,
    hiddenT: 0,
    inSlotT: 0,
    seenT: 0,
    seen: false,
    peekAt: -1,
    peeking: false,
    peeked: false,
    peekSeen: false,
    nearIsland: false,
    // The peel.
    peelTurn: 0,
    peelLast: null,
    peeled: false,
    peelClean: true,
    // The ground.
    landed: false,
    stopped: false,
    police: null,
    boarded: false,
    ovT: 0,
    ovGood: 0,
    home: false,
    failWhy: null,
    closeWarnT: 0,
    minClear: Infinity,
    meterOn: false,
  };

  air.onEvent = (what) => {
    if (what === 'touchdown') {
      st.landed = true;
      notify(sim, 'He is down on runway 09.', 'good', 4);
    } else if (what === 'stopped') {
      st.stopped = true;
      speak(sim, `${LEAD}, ${field()} Tower. He has stopped on the runway. Police are rolling.`, 'tower');
      st.police = new PoliceResponse(sim, air);
    }
  };

  // The wingman: the same jet as you, joining the shadow slot on the right.
  try {
    const w = new Escort(sim.scene, 1, playerType);
    w.placeBehind(air, 2800);
    w.setMode('shadow');
    st.wing = w;
    st.actors.wing = w;
  } catch (e) {
    st.wing = null;
  }

  function onStep(sim, id) {
    if (id === 'join') {
      speak(sim, `${LEAD}, ${field()} Approach. The ${shortName(airId)} ahead of you is squawking seven five zero zero: a man has forced his way onto the flight deck. Join from below and behind. He must not see you.`, 'approach', 1);
      card(sim, {
        who: 'Approach',
        tone: 'warn',
        text: 'The airliner ahead is squawking 7500 — a man has forced his way onto the flight deck. Catch up, coming in LOW and from BEHIND, where he cannot see you.',
        ttl: 14,
      });
    } else if (id === 'slot') {
      card(sim, {
        who: 'The slot',
        text: 'Slide into the ring: low behind his tail, on his left. Nobody on the flight deck can see that spot. Hold it for four seconds.',
        ttl: 12,
      });
    } else if (id === 'shadow') {
      speak(sim, `${LEAD}, Guardian two. In the slot on the right. He can't see us here.`, VOICE_FIGHTER);
      card(sim, {
        who: 'Stay hidden',
        text: 'Stay in the slot while he flies to the island: turn when he turns, go down when he goes down. The meter fills if he can see you.',
        ttl: 12,
      });
    } else if (id === 'peel') {
      speak(sim, `${LEAD}, ${field()} Approach. The police have it from here. Break off — climb away to the left.`, 'approach');
      if (st.wing && !st.wing.gone) st.wing.setMode('break');
      st.peelTurn = 0;
      st.peelLast = null;
    } else if (id === 'overhead') {
      card(sim, { who: 'Overhead', text: 'Circle the field above 2,000 ft while he lands. Hold B to watch him.', ttl: 10 });
    } else if (id === 'rtb') {
      speak(sim, `${LEAD}, ${field()} Approach. The police are aboard and he is on his way to the police station. Nice and quiet, Guardian. Return to base, head east.`, 'approach');
      card(sim, { who: 'Job done', tone: 'good', text: 'He never saw you coming. Head east, back to the mainland.', ttl: 10 });
    }
  }

  st.update = (sim, dt) => {
    st.t += dt;
    const ac = sim.aircraft;
    const id = stepOf(sim, def);
    if (id !== st.stepId) {
      st.stepId = id;
      st.stepT = 0;
      onStep(sim, id);
    } else {
      st.stepT += dt;
    }
    runBeats(st, sim);
    quietTower(sim);
    air.update(dt, sim.weather);
    if (st.wing && !st.wing.gone) {
      st.wing.duck = st.peeking ? 1 : 0;
      st.wing.update(dt, air, air.span, sim.weather);
    }
    if (!ac || ac.crashed) {
      st.ring.hide();
      UI.hideMeter();
      return;
    }
    localOf(air, ac.pos, LOC);
    const dFlat = flat(ac.pos, air.pos);
    const d3 = ac.pos.distanceTo(air.pos);
    const hidden = !seenFrom(air, ac.pos, st.peeking);
    const watched = id === 'join' || id === 'slow' || id === 'slot' || id === 'shadow';

    if (id === 'join') st.joined = d3 < 750 && LOC.z > 0 && LOC.y < -8;
    if (id === 'slow') {
      const dv = Math.hypot(ac.vel.x, ac.vel.z) - air.speed;
      st.slowT = Math.abs(dv) < 8 && d3 < 650 && LOC.y < -5 && hidden ? st.slowT + dt : 0;
      if (st.slowT > 1.5) st.slowed = true;
      st.speedT -= dt;
      if (st.stepT > 4 && Math.abs(dv) > 10 && st.speedT <= 0) {
        st.speedT = 6;
        const kt = Math.round(Math.abs(dv) * 1.944 / 5) * 5;
        notify(sim, dv > 0 ? `${kt} knots faster than him — power back` : `${kt} knots slower than him — a little more power`, 'info', 4);
      }
    }
    // The escorts' own shadow slot (escort.js), on his left.
    worldOf(air, -(air.span * 0.5 + 24), -30, 160 + air.span * 1.2, st.slotPos);
    const sx = LOC.x + (air.span * 0.5 + 24);
    const sy = LOC.y + 30;
    const sz = LOC.z - (160 + air.span * 1.2);
    const inSlot = Math.abs(sx) < 25 && Math.abs(sy) < 16 && Math.abs(sz) < 45;
    if (id === 'slot' || id === 'shadow') {
      st.ring.show(st.slotPos, air.heading, inSlot);
      if (id === 'slot') {
        st.slotT = inSlot ? st.slotT + dt : Math.max(0, st.slotT - dt * 0.5);
        if (st.slotT > 4) st.slotted = true;
      }
    } else {
      st.ring.hide();
    }
    if (id === 'shadow') {
      st.shT += dt;
      if (hidden) st.hiddenT += dt;
      if (Math.abs(sx) < 40 && Math.abs(sy) < 25 && Math.abs(sz) < 70) st.inSlotT += dt;
      // The peek: once, twenty seconds in.
      if (!st.peeked && st.stepT > 20 && !air.onGround) {
        st.peeked = true;
        st.peekAt = st.t;
        speak(sim, `${LEAD}, Guardian two. He's at the side window — drop, drop!`, VOICE_FIGHTER, 1);
        card(sim, {
          who: 'He is looking out!',
          tone: 'bad',
          text: 'He is at the side window, looking back! Drop LOWER — at least 25 metres — NOW, and hold it.',
          ttl: 8,
        });
        after(st, 3, () => {
          st.peeking = true;
        });
        after(st, 8, () => {
          st.peeking = false;
          card(sim, st.peekSeen
            ? { who: 'Close one', tone: 'warn', text: '"Something flashed out there..." He stares for a long time. Then: "...Birds." Stay lower behind the tail.', ttl: 8 }
            : { who: 'Phew', tone: 'good', text: '"...Birds," he mutters, and turns back to the front. He did not see you.', ttl: 8 });
        });
      }
      const d = flat(air.pos, RUNWAY.touchdown);
      st.nearIsland = d < 6000 && air.agl < 450;
    }
    if (watched && !hidden) {
      st.seenT += dt;
      if (st.peeking) st.peekSeen = true;
    }
    if (watched && st.stepId !== 'join') {
      st.meterOn = true;
      UI.showMeter(sim, { label: hidden ? 'Hidden' : 'He can see you!', value: Math.min(1, st.seenT / 10), text: `${Math.round(Math.min(10, st.seenT))} s of 10`, tone: hidden ? 'info' : 'bad' });
    } else if (st.meterOn) {
      st.meterOn = false;
      UI.hideMeter();
    }
    if (st.seenT >= 10) st.failWhy = 'He saw the jets and panicked. Stay low behind his tail — the one place nobody on the flight deck can see.';

    if (id === 'peel') {
      // Which way the peel went: the heading change since it began, + right.
      if (st.peelLast == null) st.peelLast = ac.heading;
      st.peelTurn += angleDiff(st.peelLast, ac.heading);
      st.peelLast = ac.heading;
      if (!hidden) st.peelClean = false;
      if (LOC.x > 0 && LOC.z < 0 && dFlat < 1500) st.peelClean = false;
      if (ac.pos.y * FT > 2000 && dFlat > 1500) {
        st.peeled = true;
        if (st.peelTurn > -30) st.peelClean = false;
      }
    }
    // Too close.
    const clear = clearanceTo(air, ac.pos);
    if (clear < st.minClear) st.minClear = clear;
    if (clear < 2) st.failWhy = st.failWhy || 'Far too close — you would have hit him. Stay in the slot, below and behind.';
    else if (clear < 20) {
      st.closeWarnT -= dt;
      if (st.closeWarnT <= 0) {
        st.closeWarnT = 6;
        notify(sim, 'Too close! Give him room', 'warn', 3);
      }
    }
    if (st.police) {
      st.police.update(dt);
      if (st.police.boarded && !st.boarded) {
        st.boarded = true;
        card(sim, { who: 'Police', tone: 'good', text: 'The police are aboard. He is walked off in handcuffs, still asking where the jets came from.', ttl: 10 });
      }
    }
    if (id === 'overhead') {
      st.ovT += dt;
      runwayFrame();
      if (ac.pos.y * FT > 2000 && flat(ac.pos, RW.c) < 7000) st.ovGood += dt;
    }
    if (id === 'rtb') {
      runwayFrame();
      st.home = ac.pos.x - RW.c.x > 8000;
    }
  };

  st.camera = (sim, dt, camera) => {
    const input = sim.input;
    if (!input || typeof input.held !== 'function' || !input.held('lookBehind')) return false;
    const ac = sim.aircraft;
    if (!ac || ac.crashed || ac.onGround || air.gone) return false;
    return padlock(sim, dt, camera, air.pos, air.span);
  };

  st.info = (out) => {
    out.step = st.stepId;
    out.airliner = [Math.round(air.pos.x), Math.round(air.pos.y), Math.round(air.pos.z)];
    out.airHeading = Math.round(air.heading);
    out.airSpeed = Math.round(air.speed);
    out.airPhase = air.landPhase;
    out.airGear = air.gearDown;
    out.airMinClear = Math.round(air.minClear * 10) / 10;
    out.joined = st.joined;
    out.slowed = st.slowed;
    out.slotted = st.slotted;
    out.seenT = Math.round(st.seenT * 10) / 10;
    out.hiddenShare = st.shT > 0 ? Math.round((st.hiddenT / st.shT) * 100) / 100 : null;
    out.peeked = st.peeked;
    out.peekSeen = st.peekSeen;
    out.nearIsland = st.nearIsland;
    out.peeled = st.peeled;
    out.peelClean = st.peelClean;
    out.landed = st.landed;
    out.stopped = st.stopped;
    out.boarded = st.boarded;
    out.home = st.home;
    out.wing = !!(st.wing && !st.wing.gone);
    out.failWhy = st.failWhy;
    out.minClear = Number.isFinite(st.minClear) ? Math.round(st.minClear) : null;
  };

  st.dispose = () => {
    air.dispose();
    if (st.wing) st.wing.dispose();
    st.ring.dispose();
    if (st.police) st.police.dispose();
    UI.hideCard();
    UI.hideMeter();
  };

  return st;
}

registerStory(STORY_FILM, createFilmShadow);

function filmStory() {
  return castStory(STORY_FILM);
}

function waitFilm(fn, why = 'The other aircraft are not running — carry on.') {
  return (ctx, dt) => {
    const s = filmStory();
    if (s && fn(s, ctx)) return true;
    return castSkip(ctx, dt, why);
  };
}

const T_FILM = new THREE.Vector3();

const SHADOW_FILM = {
  id: 'shadow',
  label: 'The lead fighter',
  line: 'Stay hidden low behind his tail, all the way to the island.',
  icon: '✈️',
  actor: 'lead',
  get aircraft() {
    return fighterId();
  },
  get spawn() {
    return filmStartPlayer();
  },
  parTime: 420,
  onStart(ctx) {
    const ac = ctx.ac;
    if (ac && ac.gearDown && !ac.onGround) {
      ac.gearDown = false;
      ac.gearPos = 0;
    }
  },
  cast: { story: STORY_FILM, actors: { airliner: { type: 'long-haul', brain: 'hijacker-orders' }, wing: { type: 'same-as-you', brain: 'shadow' } } },
  steps: [
    {
      id: 'join',
      text: 'The jet ahead squawks 7500: a man has forced his way onto the flight deck. Catch up — coming in LOW, from behind.',
      hint: 'Stay below his height and behind him. The arrow points at him.',
      targetLabel: 'The airliner',
      target: () => {
        const s = filmStory();
        if (!s) return null;
        return worldOf(s.air, 0, -40, 300, T_FILM);
      },
      check: waitFilm((s) => s.joined),
    },
    {
      id: 'slow',
      text: 'Throttle back to his speed and stay below him.',
      hint: 'Power back (Ctrl). Stay lower than him, and behind.',
      targetLabel: 'Below his tail',
      target: () => {
        const s = filmStory();
        return s ? s.slotPos : null;
      },
      check: waitFilm((s) => s.slowed),
    },
    {
      id: 'slot',
      text: 'Slide into the slot: low behind his tail, on his left — into the ring.',
      hint: 'Tiny corrections. Match his speed, then creep up into the ring.',
      targetLabel: 'The slot',
      target: () => {
        const s = filmStory();
        return s ? s.slotPos : null;
      },
      check: waitFilm((s) => s.slotted),
    },
    {
      id: 'shadow',
      text: 'Stay in the slot while he flies to the island. Turn when he turns; go down when he goes down.',
      hint: 'Watch his wings: when they tilt, he is turning. Keep the ring around you.',
      targetLabel: 'The slot',
      target: () => {
        const s = filmStory();
        return s ? s.slotPos : null;
      },
      check: waitFilm((s) => s.nearIsland || s.landed),
    },
    {
      id: 'peel',
      text: 'Break off: climb away to the LEFT, above 2,000 ft. The police take it from here.',
      hint: 'Power up, roll left and pull. Away from him, never across his nose.',
      check: waitFilm((s) => s.peeled),
    },
    {
      id: 'overhead',
      text: 'Circle the field above 2,000 ft while he lands and the police go in. Hold B to watch him.',
      hint: 'A wide circle round the airfield. Hold B to look at him.',
      targetLabel: 'Over the field',
      target: () => {
        runwayFrame();
        return T_FIELD.set(RW.c.x, RW.c.y + 800, RW.c.z);
      },
      check: waitFilm((s, ctx) => s.boarded || ctx.runner.stepElapsed > 300),
    },
    {
      id: 'rtb',
      text: 'Job done, Guardian. Return to base: east, to the mainland.',
      hint: 'Head east (090). Eight kilometres out and you are done.',
      targetLabel: 'The mainland',
      target: () => {
        runwayFrame();
        return T_HOME.set(RW.c.x + 9000, 1200, RW.c.z);
      },
      check: waitFilm((s) => s.home),
    },
  ],
  failIf: () => {
    const s = filmStory();
    return s ? s.failWhy : null;
  },
  score: (ctx) => {
    const s = filmStory();
    if (!s) return 50;
    const pts = {
      hidden: s.shT > 0 ? Math.round(40 * Math.min(1, s.hiddenT / s.shT)) : 20,
      slot: s.shT > 0 ? Math.round(15 * Math.min(1, s.inSlotT / s.shT / 0.85)) : 7,
      duck: s.peeked ? (s.peekSeen ? 0 : 10) : 5,
      peel: s.peeled ? (s.peelClean ? 10 : 5) : 0,
      overhead: s.ovT > 0 ? Math.round(10 * Math.min(1, s.ovGood / s.ovT / 0.8)) : 0,
      time: Math.round(15 * scoreFor(ctx.elapsed, 420)),
    };
    s.pts = pts;
    return Math.max(0, Math.min(100, Object.values(pts).reduce((a, b) => a + b, 0)));
  },
  onComplete(ctx) {
    ctx.sim.speak(`${LEAD}, ${field()} Approach. He never knew you were there. Nicely done.`, 'approach');
  },
};

/* ================================================================== *
 * The seat lists the two missions carry (`roles:` in src/game/extra/events.js)
 * ================================================================== */

const captain = (line) => ({
  id: 'captain',
  base: true,
  actor: 'airliner',
  label: () => `The ${shortName(longHaulId())} captain`,
  line,
  icon: '👨‍✈️',
});

export const HIJACK_FILM_ROLES = [
  captain('Squawk 7500 in secret, and land where he says.'),
  SHADOW_FILM,
];

export const HIJACK_REAL_ROLES = [
  captain('Keep the door locked, squawk 7500, and follow the fighters in.'),
  LEAD_REAL,
];
