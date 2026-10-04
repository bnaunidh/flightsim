/**
 * Air Force One, from the escort's seat.
 *
 * The captain's side is src/game/extra/afo.js and src/features/events/afo.js
 * (same split as the hijacks: a mission, and a feature that flies the NPC
 * when you are not it); nothing here changes either. These are the other
 * seat in the same two missions — the lead fighter, the model being
 * src/game/roles/hijack-lead.js — with the presidential 747 flown by the
 * game, through src/game/roles/npc-flyer.js, exactly the way the hijacks fly
 * the airliner when you choose the fighter there.
 *
 *   Air Force One, seat 'escort': scramble, join up on the wing, hold
 *   station through the cruise and the turns, peel off as he starts his
 *   approach, land yourself. NpcFlyer's own approach logic (proven on any
 *   heading — see tests/features/roles.mjs) brings him home from wherever the
 *   turns leave him, the same way it already recovers a hijack's airliner
 *   from a bad leader.
 *
 *   Air Force One — Under Attack, seat 'escort': join up, then unidentified
 *   drones come out of the sea for him — intercept them and shoot them down
 *   (src/features/events/afo-combat.js) and stay between them and the jet,
 *   then escort him home and land. Kid-safe throughout: see afo-combat.js.
 *
 * The gun reads sim.input directly (the same way hijack-lead.js's padlock
 * reads `held('lookBehind')`) rather than a signal: there is nobody else to
 * signal in single player, and this is a key like any other, registered
 * once by the captain's own feature file (afo.js) so Settings → Controls
 * shows it whichever seat you are in. The touch button lives there too
 * (afo.js owns every DOM element this pair of missions needs); this file
 * only reads touchFireHeld() back from it.
 */

import * as THREE from '../../vendor/three.module.js';
import { RUNWAY } from '../../world/airport.js';
import { heightAt } from '../../world/terrain.js';
import { AIRCRAFT, getAircraft } from '../../aircraft/types.js';
import { schemeFor } from '../../aircraft/liveries.js';
import {
  cruiseSpeed, field, speak, notify, registerVoices, runwayFrame, RW, flat,
} from '../../features/events/common.js';
import { AttackField } from '../../features/events/afo-combat.js';
import { touchFireHeld } from '../../features/events/afo.js';
import { NpcFlyer } from './npc-flyer.js';
import { registerStory, castStory, castSkip, worldOf, localOf, clearanceTo } from './cast.js';
import { fighterId } from './hijack-lead.js';
import { PRESIDENT_NORMAL, PRESIDENT_ATTACK } from './afo-president.js';

export const STORY_NORMAL = 'afo-normal-escort';
export const STORY_ATTACK = 'afo-attack-escort';

const LEAD = 'Guardian lead';
const DEG = Math.PI / 180;
const T1 = new THREE.Vector3();
const T2 = new THREE.Vector3();
const T3 = new THREE.Vector3();
const LOC = { x: 0, y: 0, z: 0 };

function typeById(id) {
  return AIRCRAFT.find((a) => a.id === id) || getAircraft(id);
}

const AFO_SCHEME = () => schemeFor(typeById('b747'), 'potus');

/** Ground start, the normal way every mission on this field begins. */
function groundStart() {
  const r = ((RUNWAY.headingDeg ?? 90) * Math.PI) / 180;
  return {
    pos: new THREE.Vector3(RUNWAY.thresholdWest.x + Math.sin(r) * 80, RUNWAY.elev, RUNWAY.thresholdWest.z - Math.cos(r) * 80),
    headingDeg: RUNWAY.headingDeg ?? 90,
  };
}

/** The home field's own runway, in the shape NpcFlyer.land() wants. */
function homeRunway() {
  runwayFrame();
  const out = { thr: new THREE.Vector3(), dir: new THREE.Vector3(), hdg: RUNWAY.headingDeg ?? 90, td: new THREE.Vector3(), stop: new THREE.Vector3() };
  out.dir.copy(RW.f);
  out.thr.copy(RW.c).addScaledVector(RW.f, -RW.L / 2);
  out.thr.y = heightAt(out.thr.x, out.thr.z);
  out.td.copy(out.thr).addScaledVector(out.dir, Math.min(200, RW.L * 0.2));
  out.td.y = heightAt(out.td.x, out.td.z);
  out.stop.copy(out.thr).addScaledVector(out.dir, RW.L * 0.55);
  out.stop.y = heightAt(out.stop.x, out.stop.z);
  return out;
}

/** Just off the 747's wingtip, a little back — Escort.js's own 'wing' slot, so it reads the same from any seat. */
function wingSlot(air, side, out) {
  return worldOf(air, side * (air.span * 0.5 + 36), 5, 30, out);
}

function scoreFor(elapsed, par) {
  if (elapsed <= par) return 1;
  return Math.max(0, 1 - (elapsed - par) / par);
}

/** The escort's own gun: fired from the player's aircraft, at whatever the attack field is tracking. */
function fireEscortGun(sim, attack, state) {
  const ac = sim.aircraft;
  if (!ac || ac.crashed || ac.onGround) {
    state.fireCd = 0;
    return;
  }
  const firing = (sim.input && typeof sim.input.held === 'function' && sim.input.held('afoFire')) || touchFireHeld();
  state.fireCd -= 1 / 60;
  if (!firing || state.fireCd > 0) return;
  state.fireCd = 1 / 7;
  const dir = ac.forward(T3);
  const muzzle = ac.pos.clone().addScaledVector(dir, 8);
  attack.fireGun(muzzle, dir, ac.vel);
}

/* ================================================================== *
 * Air Force One — the normal flight, seat 'escort'
 * ================================================================== */

function createNormalEscort(sim, def) {
  registerVoices();
  const air = new NpcFlyer(sim.scene, 'b747', { name: 'af1', livery: AFO_SCHEME() });
  const start = groundStart();
  const h = (start.headingDeg * Math.PI) / 180;
  const airPos = new THREE.Vector3(start.pos.x + Math.sin(h) * 1600, start.pos.y + 230, start.pos.z - Math.cos(h) * 1600);
  air.place({ pos: airPos, headingDeg: start.headingDeg, speed: 82, gearDown: false });
  air.direct(start.headingDeg, 1250, cruiseSpeed('b747'));

  const st = {
    id: STORY_NORMAL,
    actors: { airliner: air, lead: sim.aircraft },
    air,
    def,
    t: 0,
    side: 1,
    joinT: 0,
    holdGood: 0,
    holdTotal: 0,
    turned: false,
    squared: false,
    peeled: false,
    failWhy: null,
    minClear: Infinity,
    closeWarnT: 0,
    home: false,
  };

  air.onEvent = (what) => {
    if (what === 'touchdown') notify(sim, `${field()}'s own field — he is down.`, 'good', 4);
  };

  st.update = (sim, dt) => {
    st.t += dt;
    const ac = sim.aircraft;
    // Out on the departure heading, turn back onto the reciprocal, then turn
    // again onto the runway heading — two turns to "keep station through",
    // and the same flight the President's seat flies (afo-president.js).
    // Two 180s the same way round put him back on the runway's extended
    // centreline, so land() finds him close to an approach. The old single
    // 55° turn left him 9.6 km past the field and 3 km off it when land()
    // was called; NpcFlyer's 'vector' loop then took until t ≈ 451 s just
    // to reach 'final' (which 'peel' waits on), past the escort bot's own
    // 420 s cap. Measured (tests/features/afo-lead.mjs): 'final' ≈ 324 s.
    if (!st.turned && st.t > 40) {
      st.turned = true;
      air.direct(((RUNWAY.headingDeg ?? 90) + 180) % 360, 1250, cruiseSpeed('b747'));
      speak(sim, `${LEAD}, ${field()} Approach, turning back towards the field, stand by.`, 'approach');
    }
    if (st.turned && !st.squared && st.t > 220) {
      st.squared = true;
      air.direct(RUNWAY.headingDeg ?? 90, 1250, cruiseSpeed('b747'));
      speak(sim, `${LEAD}, he is turning in. Stay with him.`, 'approach');
    }
    if (st.squared && air.mode !== 'land' && st.t > 225) {
      air.rw = homeRunway();
      air.vecAlt = air.pos.y;
      air.land(air.rw);
      speak(sim, `${LEAD}, bringing him home for ${field()}. Peel off when you are clear.`, 'approach');
    }
    air.update(dt, sim.weather);
    if (!ac || ac.crashed) return;

    wingSlot(air, st.side, T1);
    localOf(air, ac.pos, LOC);
    const sx = LOC.x - st.side * (air.span * 0.5 + 36);
    const sy = LOC.y - 5;
    const sz = LOC.z + 30;
    const inSlot = Math.abs(sx) < 45 && Math.abs(sy) < 30 && Math.abs(sz) < 70;
    // Station-keeping is judged from the moment you have joined him — the
    // take-off and the chase to catch him are not time out of the slot.
    if (st.joinT > 3) {
      st.holdTotal += dt;
      if (inSlot) st.holdGood += dt;
    }
    if (flat(ac.pos, air.pos) < 220 && Math.abs(ac.pos.y - air.pos.y) < 90) st.joinT += dt;

    if (air.landPhase === 'final' || air.landPhase === 'flare' || air.landPhase === 'roll' || air.landPhase === 'stopped') {
      st.peeled = true;
    }

    const clear = clearanceTo(air, ac.pos);
    if (clear < st.minClear) st.minClear = clear;
    if (clear < 2) st.failWhy = st.failWhy || "Far too close — you would have hit him. Give the president's aeroplane room.";
    else if (clear < 20) {
      st.closeWarnT -= dt;
      if (st.closeWarnT <= 0) {
        st.closeWarnT = 6;
        notify(sim, 'Too close! Give him room', 'warn', 3);
      }
    }
    runwayFrame();
    st.home = flat(ac.pos, RW.c) < 1500 && ac.onGround;
  };

  st.info = (out) => {
    out.airliner = [Math.round(air.pos.x), Math.round(air.pos.y), Math.round(air.pos.z)];
    out.airPhase = air.landPhase;
    out.inSlotShare = st.holdTotal > 0 ? Math.round((st.holdGood / st.holdTotal) * 100) / 100 : null;
    out.peeled = st.peeled;
    out.failWhy = st.failWhy;
    out.minClear = Number.isFinite(st.minClear) ? Math.round(st.minClear) : null;
  };

  st.dispose = () => {
    air.dispose();
  };

  return st;
}

registerStory(STORY_NORMAL, createNormalEscort);

function normalStory() {
  return castStory(STORY_NORMAL);
}

function waitNormal(fn, why = 'The airliner is not running — carry on.') {
  return (ctx, dt) => {
    const s = normalStory();
    if (s && fn(s, ctx)) return true;
    return castSkip(ctx, dt, why);
  };
}

const ESCORT_NORMAL = {
  id: 'escort',
  label: 'The lead fighter',
  line: 'Scramble, join up on his wing, and bring him home.',
  icon: '✈️',
  actor: 'lead',
  get aircraft() {
    return fighterId();
  },
  get spawn() {
    return groundStart();
  },
  // His own schedule sets the floor, not your flying: measured
  // (tests/features/afo-lead.mjs), he reaches 'final' — your cue to peel —
  // at t ≈ 324 s and is stopped at ≈ 467 s; following him in, you land
  // about when he does. 300 s could never be met.
  parTime: 480,
  cast: { story: STORY_NORMAL, actors: { airliner: { type: 'b747', brain: 'captain' } } },
  /*
   * A take-off a player can actually fly. Holding S for about a second at
   * 120-140 knots — what this step's hint used to ask — pitches either
   * fighter (Vanguard or F-22) past its tail-strike angle while the wheels
   * are still on the runway: "The tail struck the ground", ten seconds in,
   * every time it was tried. With take-off flap set (as airliners.js does for
   * the jumbos) it flies itself off at about 145 knots with the stick left
   * alone, and pulling back once it is off the ground is safe.
   */
  onStart(ctx) {
    const ac = ctx.ac;
    if (ac && ac.onGround && typeof ac.setFlaps === 'function' && ac.flapStep() < 2) ac.setFlaps(2);
  },
  steps: [
    {
      id: 'scramble',
      text: 'SCRAMBLE! Air Force One is departing. Full power (Shift), let her fly herself off, and climb after him.',
      hint: 'Take-off flap is set. Full power and keep off S until the wheels leave the runway — then ease back, and wheels up (G).',
      get atc() {
        return { text: `${LEAD}, ${field()} Tower. Scramble, scramble. Cleared for take-off. Contact Approach airborne.`, voice: 'tower', urgency: 1 };
      },
      check: (ctx) => ctx.ac.airborneTime > 3 && ctx.ac.agl > 100,
    },
    {
      id: 'join',
      text: 'Catch up and slide into the wing slot, off his right wingtip.',
      hint: 'Match his height and his speed, then ease sideways into the slot. Follow the arrow.',
      targetLabel: 'The wing slot',
      target: () => {
        const s = normalStory();
        return s ? wingSlot(s.air, 1, T2) : null;
      },
      check: waitNormal((s) => s.joinT > 3),
    },
    {
      id: 'hold',
      text: 'Hold the slot through the cruise and the turns. Stay with him.',
      hint: 'Small corrections. When he banks, bank with him — he is flying the turns, not you.',
      targetLabel: 'The wing slot',
      target: () => {
        const s = normalStory();
        return s ? wingSlot(s.air, 1, T2) : null;
      },
      // Done when you have held it well — or, held well or not, when he turns
      // in for his approach: the slot is over then, and the score says how it
      // went. (It used to wait for the 55% for ever, through his landing.)
      check: waitNormal((s) => (s.holdTotal > 50 && s.holdGood / s.holdTotal > 0.55) || s.peeled),
    },
    {
      id: 'peel',
      text: 'He is starting his approach. Peel off — climb away — and come round to land yourself.',
      hint: 'Power up, bank away from him, climb clear, then come round for your own approach.',
      check: waitNormal((s) => s.peeled),
    },
    {
      id: 'land',
      text: 'Land back at the field.',
      hint: 'Gear down (G), flaps down (F). Any landing on the runway counts.',
      targetLabel: 'Touchdown',
      target: () => RUNWAY.touchdown,
      check: (ctx) => ctx.ac.onGround && ctx.ac.groundSpeed < 2.5 && ctx.ac.groundTime > 1.2,
    },
  ],
  failIf: () => {
    const s = normalStory();
    return s ? s.failWhy : null;
  },
  score: (ctx) => {
    const s = normalStory();
    if (!s) return 50;
    const l = ctx.data.lastTouchdown;
    const pts = {
      join: s.joinT > 0 ? 15 : 0,
      hold: s.holdTotal > 0 ? Math.round(35 * Math.min(1, s.holdGood / s.holdTotal / 0.7)) : 10,
      peel: s.peeled ? 15 : 5,
      landing: Math.round((l ? l.score : 40) * 0.25),
      time: Math.round(10 * scoreFor(ctx.elapsed, ESCORT_NORMAL.parTime)),
    };
    return Math.max(0, Math.min(100, Object.values(pts).reduce((a, b) => a + b, 0)));
  },
  onComplete(ctx) {
    ctx.sim.speak(`${LEAD}, ${field()} Approach. Nicely flown, Guardian. Welcome home.`, 'approach');
  },
};

/* ================================================================== *
 * Air Force One — Under Attack, seat 'escort'
 * ================================================================== */

/*
 * Exported: the captain's own mission (src/game/extra/afo.js) spawns the
 * player at this exact point when THEY are the 747 — the one fixed fact
 * both seats of this mission must agree on, wherever it is edited.
 */
export const ATTACK_AIR_START = { x: -9800, z: -2300, y: 1450, hdg: 100 };

/*
 * How long this seat's drones hold fire after they appear, in seconds (each
 * fires within 3 s of it). The captain's seat keeps the engine's own 3-6 s:
 * there, that first head-on pair is what the flares are for. Here it made
 * the mission close to unwinnable — the wave appears 3.4 km ahead, the gun
 * reaches ~370 m, and both drones had fired by t ≈ 18 s, long before any
 * fighter could get to either. 30 s is about what it takes to fly out and
 * shoot the first one down. Measured (tests/features/afo-lead.mjs's
 * chasePilot: flies at the arrow, gun along its own nose), together with
 * autoFlareCaptain's timing below: a 130 m/s, 3 g pilot got him home in 8
 * runs of 30 before, 40 of 40 now; a 110 m/s, 2.5 g one in 0 of 30 before,
 * 37 of 40 now (45 of 60 on the hold alone). One that never fires still
 * fails, 40 of 40, by t ≈ 80 s.
 */
const ESCORT_HOLD_FIRE = 30;

/** Two drones, out of the sea ahead and to each side of his nose. */
function droneWaveAhead(air) {
  const h = air.heading * DEG;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const rx = Math.cos(h);
  const rz = Math.sin(h);
  const ahead = 3400;
  const spread = 900;
  const out = [];
  for (const side of [-1, 1]) {
    out.push(new THREE.Vector3(
      air.pos.x + fx * ahead + rx * spread * side,
      Math.max(20, air.pos.y - 300),
      air.pos.z + fz * ahead + rz * spread * side
    ));
  }
  return out;
}

function createAttackEscort(sim, def) {
  registerVoices();
  const air = new NpcFlyer(sim.scene, 'b747', { name: 'af1-attack', livery: AFO_SCHEME() });
  air.place({ pos: new THREE.Vector3(ATTACK_AIR_START.x, ATTACK_AIR_START.y, ATTACK_AIR_START.z), headingDeg: ATTACK_AIR_START.hdg, speed: cruiseSpeed('b747'), gearDown: false });
  air.direct(ATTACK_AIR_START.hdg, ATTACK_AIR_START.y, cruiseSpeed('b747'));
  const attack = new AttackField(sim);

  const st = {
    id: STORY_ATTACK,
    actors: { airliner: air, lead: sim.aircraft },
    air,
    attack,
    def,
    t: 0,
    joinT: 0,
    warned: false,
    waveSent: false,
    defended: false,
    flareCd: 2,
    flaresUsed: 0,
    gun: { fireCd: 0 },
    failWhy: null,
    minClear: Infinity,
    closeWarnT: 0,
    home: false,
    headingHome: false,
  };

  air.onEvent = (what) => {
    if (what === 'touchdown') notify(sim, `${field()} — he is down, safe.`, 'good', 4);
  };

  function autoFlareCaptain(dt) {
    // The NPC captain's own judgement: four charges, used when a missile is
    // genuinely close and not already chasing a flare — never more often
    // than that, the same limited resource a person flying captain has.
    // "Close" means a flare can still catch it: a flare burns for 5 s, and a
    // missile closes on one at ~210-250 m/s, so 1,000 m. He used to flare at
    // 1,900 m, every 3 s; head-on, the first two flares burned out before
    // the missile got there, and all four were gone on the first pair. A
    // missile the flare did not pull gets another one 1.2 s later.
    if (st.flaresUsed >= 4) return;
    st.flareCd -= dt;
    if (st.flareCd > 0) return;
    const danger = attack.missiles.some((m) => m.alive && !m.flare && m.pos.distanceTo(air.pos) < 1000);
    if (!danger) return;
    attack.deployDecoy(air.pos, air.vel);
    st.flaresUsed++;
    st.flareCd = 1.2;
    notify(sim, 'Air Force One is dropping flares!', 'warn', 4);
  }

  st.update = (sim, dt) => {
    st.t += dt;
    const ac = sim.aircraft;
    air.update(dt, sim.weather);
    if (!st.warned && st.t > 8) {
      st.warned = true;
      speak(sim, `${LEAD}, ${field()} Approach. Unidentified drones, low, off his nose. No transponder, no response. Intercept.`, 'approach', 1);
    }
    if (!st.waveSent && st.t > 11) {
      st.waveSent = true;
      attack.spawnWave(droneWaveAhead(air), { firstLaunch: ESCORT_HOLD_FIRE });
    }
    // Drones down, or 2:30 since the wave arrived (the 'defend' step's own
    // 150 s patience): turn for home either way. Nothing else ever calls
    // land() for him, and 'escort-home' waits on his approach — without
    // this he flew on east at 1,450 m forever. NpcFlyer's own 'vector'
    // phase finds the approach from wherever this leaves him, the same way
    // the normal flight's own land() call does. Before the `ac` check, so
    // he still goes home whatever has happened to the escort.
    if (st.waveSent && !st.headingHome) {
      const clear = attack.dronesAlive === 0 && attack.missilesInbound === 0;
      if (clear || st.t > 11 + 150) {
        st.headingHome = true;
        air.rw = homeRunway();
        air.vecAlt = air.pos.y;
        air.land(air.rw);
        speak(sim, `${LEAD}, ${field()} Approach. ${clear ? 'Drones are down.' : 'Pressing on.'} Bringing him home — stay with him.`, 'approach');
      }
    }
    if (!ac || ac.crashed) return;

    localOf(air, ac.pos, LOC);
    if (flat(ac.pos, air.pos) < 220 && Math.abs(ac.pos.y - air.pos.y) < 90) st.joinT += dt;

    if (st.waveSent) {
      attack.update(dt, air.pos, air.vel);
      autoFlareCaptain(dt);
      fireEscortGun(sim, attack, st.gun);
      if (attack.stats.hits >= 2) st.failWhy = st.failWhy || 'A missile got through to Air Force One. Clear the drones sooner, or decoy earlier.';
      st.defended = attack.dronesAlive === 0 && attack.missilesInbound === 0;
    }

    const clear = clearanceTo(air, ac.pos);
    if (clear < st.minClear) st.minClear = clear;
    if (clear < 2) st.failWhy = st.failWhy || 'Far too close — you would have hit him.';
    else if (clear < 20) {
      st.closeWarnT -= dt;
      if (st.closeWarnT <= 0) {
        st.closeWarnT = 6;
        notify(sim, 'Too close! Give him room', 'warn', 3);
      }
    }
    runwayFrame();
    st.home = flat(ac.pos, RW.c) < 1500 && ac.onGround;
  };

  st.info = (out) => {
    out.airliner = [Math.round(air.pos.x), Math.round(air.pos.y), Math.round(air.pos.z)];
    out.dronesAlive = attack.dronesAlive;
    out.missilesInbound = attack.missilesInbound;
    out.stats = { ...attack.stats };
    out.defended = st.defended;
    out.failWhy = st.failWhy;
    out.minClear = Number.isFinite(st.minClear) ? Math.round(st.minClear) : null;
  };

  st.dispose = () => {
    air.dispose();
    attack.dispose();
  };

  return st;
}

registerStory(STORY_ATTACK, createAttackEscort);

function attackStory() {
  return castStory(STORY_ATTACK);
}

function waitAttack(fn, why = 'The airliner is not running — carry on.') {
  return (ctx, dt) => {
    const s = attackStory();
    if (s && fn(s, ctx)) return true;
    return castSkip(ctx, dt, why);
  };
}

/*
 * main.js's reset() defaults every spawn to gear down (see events.js's own
 * gearUp, which this mirrors exactly) — right for the normal escort's ground
 * scramble, wrong for this one: joining up already in the cruise with the
 * wheels hanging is extra drag nobody asked for.
 */
function gearUp(ctx) {
  const ac = ctx.ac;
  if (ac && ac.gearDown && !ac.onGround) {
    ac.gearDown = false;
    ac.gearPos = 0;
  }
}

const ESCORT_ATTACK = {
  id: 'escort',
  label: 'The lead fighter',
  line: 'Shoot down the drones before their missiles get through, then escort him home.',
  icon: '✈️',
  actor: 'lead',
  onStart: gearUp,
  get aircraft() {
    return fighterId();
  },
  get spawn() {
    // A few hundred metres back and to one side of him, same height: close
    // enough that "join up" is a short, visible manoeuvre, not a long chase.
    const h = ATTACK_AIR_START.hdg * DEG;
    const fx = Math.sin(h);
    const fz = -Math.cos(h);
    const rx = Math.cos(h);
    const rz = Math.sin(h);
    return {
      pos: new THREE.Vector3(
        ATTACK_AIR_START.x - fx * 600 + rx * 220,
        ATTACK_AIR_START.y,
        ATTACK_AIR_START.z - fz * 600 + rz * 220
      ),
      headingDeg: ATTACK_AIR_START.hdg,
      speed: cruiseSpeed('b747'),
      // altAGL over water is measured from the sea floor, 34 m down at
      // Kestrel (see hijack-lead.js), so this is the same sea-level height
      // Air Force One itself spawns at.
      altAGL: ATTACK_AIR_START.y + 34,
    };
  },
  parTime: 420,
  cast: { story: STORY_ATTACK, actors: { airliner: { type: 'b747', brain: 'captain' } } },
  steps: [
    {
      id: 'join',
      text: "Join up on Air Force One's wing.",
      hint: 'Match his height and speed and settle in close.',
      targetLabel: 'The wing slot',
      target: () => {
        const s = attackStory();
        return s ? wingSlot(s.air, 1, T2) : null;
      },
      check: waitAttack((s) => s.joinT > 3),
    },
    {
      id: 'warning',
      text: 'Unidentified drones, inbound. No transponder, no response.',
      hint: 'Stand by — they will be in gun range shortly. Press 3 (or FIRE) to shoot.',
      check: waitAttack((s) => s.waveSent),
    },
    {
      id: 'defend',
      text: 'Shoot down the drones and stay between them and Air Force One. Use flares if he needs the room.',
      hint: 'Press 3 (or tap FIRE) to shoot. Lead them a little — they are moving.',
      targetLabel: 'Nearest drone',
      target: () => {
        const s = attackStory();
        if (!s) return null;
        let best = null;
        let bd = Infinity;
        for (const d of s.attack.drones) {
          if (!d.alive) continue;
          const dd = d.pos.distanceToSquared(s.air.pos);
          if (dd < bd) {
            bd = dd;
            best = d;
          }
        }
        return best ? best.pos : null;
      },
      check: waitAttack((s, ctx) => s.defended || ctx.runner.stepElapsed > 150),
    },
    {
      id: 'escort-home',
      get text() {
        return `Escort him home to ${field()}.`;
      },
      hint: 'Stay close. He is heading in on his own.',
      targetLabel: 'Air Force One',
      target: () => {
        const s = attackStory();
        return s ? s.air.pos : null;
      },
      check: waitAttack((s) => s.air.landPhase === 'final' || s.air.landPhase === 'flare' || s.air.onGround),
    },
    {
      id: 'land',
      get text() {
        return `Land at ${field()} yourself.`;
      },
      hint: 'Gear down (G), flaps down (F).',
      targetLabel: 'Touchdown',
      target: () => RUNWAY.touchdown,
      check: (ctx) => ctx.ac.onGround && ctx.ac.groundSpeed < 2.5 && ctx.ac.groundTime > 1.2,
    },
  ],
  failIf: () => {
    const s = attackStory();
    return s ? s.failWhy : null;
  },
  score: (ctx) => {
    const s = attackStory();
    if (!s) return 50;
    const l = ctx.data.lastTouchdown;
    const st2 = s.attack.stats;
    const pts = {
      kills: Math.min(30, (st2.shotDrones + st2.shotMissiles) * 10),
      protected: Math.max(0, 25 - st2.hits * 20),
      home: s.home || s.air.stopped ? 20 : 8,
      landing: Math.round((l ? l.score : 40) * 0.15),
      time: Math.round(10 * scoreFor(ctx.elapsed, ESCORT_ATTACK.parTime)),
    };
    return Math.max(0, Math.min(100, Object.values(pts).reduce((a, b) => a + b, 0)));
  },
  onComplete(ctx) {
    ctx.sim.speak(`${LEAD}, ${field()} Approach. He is down safe. Good flying, Guardian.`, 'approach');
  },
};

/* ================================================================== *
 * The seat lists the two missions carry (`roles:` in src/game/extra/afo.js)
 * ================================================================== */

const captain = (line) => ({
  id: 'captain',
  base: true,
  actor: 'airliner',
  label: 'The president\'s captain',
  line,
  icon: '👨‍✈️',
});

export const AFO_NORMAL_ROLES = [captain('Fly Air Force One: a proper departure, cruise, approach and landing.'), ESCORT_NORMAL, PRESIDENT_NORMAL];
export const AFO_ATTACK_ROLES = [captain('Fly evasive, decoy the missiles, and get Air Force One down safely.'), ESCORT_ATTACK, PRESIDENT_ATTACK];
