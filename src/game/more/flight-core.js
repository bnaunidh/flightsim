/**
 * The aeroplane's two new core missions (finish/missions-fun-plan.md,
 * plane-core 13 and 14), appended to the mission list by
 * ./index.js:
 *
 *   stray-contact  STRAY CONTACT — Military, Hard, Northwatch. A Skylark with a
 *                  dead radio is drifting toward the live-firing area. You
 *                  scramble, intercept and SIGNAL him: he cannot see you until
 *                  you are ahead-left of his nose, rocking your wings. Then a
 *                  slow level left turn and he follows, and you lead him clear.
 *                  A cloud base comes down and keeps you both under two
 *                  thousand feet. No weapons.
 *   diversion      DIVERSION — Passengers & cargo, Hard, the A320 at Kestrel.
 *                  Ten thousand feet over the sea with a passenger in trouble:
 *                  turn, get down fast without overspeeding, through a squall
 *                  line, onto a short wet runway in the first third, and stop
 *                  with runway left.
 *
 * They arrive with the features, after the menu, through ./index.js.
 */

import * as THREE from '../../vendor/three.module.js';
import { RUNWAY } from '../../world/airport.js';
import { SPEC } from '../../aircraft/physics.js';
import { AIRCRAFT } from '../../aircraft/types.js';
import { RockWatch } from '../roles/cast.js';
import { cruiseSpeed } from '../../features/events/common.js';
import * as Fun from '../fun-kit.js';
import { RUNWAY_START, landedAndStopped, ft } from '../missions.js';
import { hdgDiff, flatDist, cameDownShort } from './flight-fun.js';

const DEG = Math.PI / 180;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Heading (degrees, 0 = north, 90 = east) from a to b on the ground. */
function bearing(a, b) {
  return ((Math.atan2(b.x - a.x, -(b.z - a.z)) / DEG) + 360) % 360;
}

/* ================================================================== *
 * Stray Contact
 * ================================================================== */

/** The live-firing danger area: open sea south-east of Northwatch (measured, -52 m floor throughout). */
const DANGER = { x: 4500, z: 5500, r: 1800 };
const DANGER_POS = V(DANGER.x, 0, DANGER.z);
/** Where the Skylark starts and the height it drifts at (1,700 ft). */
const STRAY_START = V(-6500, 520, 2600);
const STRAY_SPEED = 42;
const STRAY_HEADING = bearing(STRAY_START, DANGER_POS);
/** The cloud base the twist brings down to: 2,100 ft. Below it you can see each other. */
const STRAY_CLOUD_BASE = 640;
/** Where you lead him: north of the field, well clear. */
const CLEAR_POINT = V(1500, 520, -1200);
const SCRATCH_NPC = V(0, 0, 0);
const SCRATCH_STATION = V(0, 0, 0);

/** His position now: the aeroplane when it exists, else where it would be. */
function strayPos(ctx) {
  const n = ctx.data.stray;
  if (n) return SCRATCH_NPC.copy(n.pos);
  const t = ctx.runner ? ctx.runner.elapsed : 0;
  const h = STRAY_HEADING * DEG;
  return SCRATCH_NPC.set(STRAY_START.x + Math.sin(h) * STRAY_SPEED * t, STRAY_START.y, STRAY_START.z - Math.cos(h) * STRAY_SPEED * t);
}

/** His heading now, degrees. */
function strayHeading(ctx) {
  const n = ctx.data.stray;
  return n ? n.heading : STRAY_HEADING;
}

/**
 * Where you have to be for him to see you: 260 m ahead and 140 m left of his
 * nose, at his height. The 'signal' step's arrow points here.
 */
function strayStation(ctx) {
  const p = strayPos(ctx);
  const h = strayHeading(ctx) * DEG;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  // Left of his nose: rotate forward 90° anticlockwise seen from above.
  const lx = -fz;
  const lz = fx;
  return SCRATCH_STATION.set(p.x + fx * 260 + lx * 140, p.y, p.z + fz * 260 + lz * 140);
}

/**
 * Can he see you? Ahead-left of his nose (relative bearing between -80° and
 * -8°), between 120 and 700 m, and within 130 m of his height. From behind,
 * or from his right where a Skylark's pilot sits on the left, he cannot.
 */
function inHisView(ctx) {
  const n = ctx.data.stray;
  if (!n) return false;
  const ac = ctx.ac;
  const dx = ac.pos.x - n.pos.x;
  const dz = ac.pos.z - n.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 120 || d > 700 || Math.abs(ac.pos.y - n.pos.y) > 130) return false;
  const rel = hdgDiff(bearing(n.pos, ac.pos), n.heading);
  return rel > -80 && rel < -8;
}

function strayLineToDanger(ctx) {
  const n = ctx.data.stray;
  return n ? flatDist(n.pos, DANGER_POS) : flatDist(strayPos(ctx), DANGER_POS);
}

/** The danger area drawn on the sea: a red ring with blinking orange markers round it. */
function dangerRing(ctx) {
  const sim = ctx.sim;
  if (!sim || !sim.scene) return null;
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(DANGER.r * 0.955, DANGER.r, 96),
    new THREE.MeshBasicMaterial({ color: 0xff3b2f, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.8;
  group.add(ring);
  const lampGeo = new THREE.SphereGeometry(6, 8, 6);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x3a1a00, emissive: 0xff8a1a, emissiveIntensity: 2, roughness: 0.5 });
  const lamps = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const m = new THREE.Mesh(lampGeo, lampMat);
    m.position.set(Math.cos(a) * DANGER.r, 7, Math.sin(a) * DANGER.r);
    group.add(m);
    lamps.push(m);
  }
  group.position.set(DANGER.x, 0, DANGER.z);
  sim.scene.add(group);
  const prop = {
    group,
    t: 0,
    update(dt) {
      this.t += dt;
      lampMat.emissiveIntensity = (this.t % 1.2) < 0.6 ? 2.4 : 0.4;
    },
    dispose() {
      sim.scene.remove(group);
      ring.geometry.dispose();
      ring.material.dispose();
      lampGeo.dispose();
      lampMat.dispose();
    },
  };
  Fun.own(ctx, prop);
  return prop;
}

const strayContact = {
  id: 'stray-contact',
  name: 'Stray Contact',
  short: 'Intercept and lead him clear',
  difficulty: 'Hard',
  icon: '✈',
  military: true,
  category: 'military',
  map: 'northwatch',
  aircraft: 'vanguard',
  blurb:
    'A Skylark with a dead radio is drifting toward the live-firing area south of Northwatch. '
    + 'Scramble, get ahead-left where he can see you, signal him, and lead him clear — no weapons.',
  reward: 'Teaches the real intercept: he cannot follow a jet he has never seen, so you show yourself first.',
  weather: { time: 'day', condition: 'cloudy', windSpeedKts: 9, windDirDeg: 300 },
  get spawn() {
    return RUNWAY_START;
  },
  // Eight minutes on the clock: a careful intercept, the lead-out and a proper approach take a kid six.
  timeLimit: 480,
  parTime: 320,
  medals: { silver: 65, gold: 85, goldHint: 'Signal him inside 2:30 and land clean inside 5:00' },
  finale: { view: 'orbit', secs: 3 },
  /*
   * The twist: a minute or so in, the cloud base comes down to two thousand
   * feet. He will not see a jet in cloud and he will not follow one into it,
   * so the whole intercept happens underneath — low, slow and visible.
   */
  beats: [
    {
      id: 'cloud',
      at: [60, 95],
      run: (ctx) => {
        Fun.weatherTurn(ctx, 'cloudy', 900, { cloudBase: STRAY_CLOUD_BASE, cloud: 0.85 });
        ctx.data.cloudDown = true;
      },
      say: { text: 'Guardian zero one, Northwatch. Cloud base lowering to two thousand feet — stay below it, he will not see you in cloud.', voice: 'tower', urgency: 1 },
      debrief: 'Cloud base came down to two thousand — stayed under it with him',
    },
  ],
  onStart: (ctx) => {
    const d = ctx.data;
    d.stray = null;
    d.seen = false;
    d.following = false;
    d.followT = 0;
    d.lostT = 0;
    d.signalAt = null;
    d.turnFrom = null;
    d.cloudDown = false;
    d.rock = new RockWatch();
    d.ring = dangerRing(ctx);
    d.lastBlindLine = -99;
    d.led = false;
    Fun.npc(ctx, 'skylark', { name: 'stray', pos: STRAY_START, headingDeg: STRAY_HEADING, speed: STRAY_SPEED }).then((n) => {
      if (!n || ctx.runner.status !== 'running' || ctx.runner.def.id !== 'stray-contact') return;
      // A Skylark drifting at eighty knots: the flyer's default floor is a
      // jet's sixty metres a second, which would have him at the range before
      // anyone had got the wheels up.
      n.vMin = STRAY_SPEED - 2;
      n.direct(STRAY_HEADING, STRAY_START.y, STRAY_SPEED);
      d.stray = n;
    });
  },
  tick: (ctx, dt) => {
    const d = ctx.data;
    const n = d.stray;
    const ac = ctx.ac;
    if (!n) return;
    const step = ctx.runner.step;
    if (step && step.id === 'rtb') {
      // Clear: he goes home on his own, north-west, out of the story.
      if (!d.led) {
        d.led = true;
        n.direct(300, STRAY_START.y, STRAY_SPEED);
      }
      return;
    }
    const inView = inHisView(ctx);
    const rocked = d.rock.update(dt, ac.bankAngleDeg());
    const inCloud = d.cloudDown && ac.pos.y > STRAY_CLOUD_BASE + 20;
    if (!d.following) {
      if (rocked) {
        d.rock.reset();
        if (inView && !inCloud) {
          d.following = true;
          d.followT = 0;
          d.lostT = 0;
          d.turnFrom = ac.heading;
          if (!d.seen) {
            d.seen = true;
            d.signalAt = ctx.runner.elapsed;
          }
          n.rock(4);
          n.follow(ac, { back: 230, right: 90, down: 10, lookahead: 600 });
          Fun.say(ctx, "Guardian zero one, he's rocking back — he has you. Easy left turn now and he follows.", 'tower', 1);
          Fun.sting(ctx, 'contact');
        } else if (ctx.runner.elapsed - d.lastBlindLine > 10) {
          d.lastBlindLine = ctx.runner.elapsed;
          Fun.line(ctx, inCloud ? "He can't see you in the cloud — get below two thousand, ahead-left of him" : "He can't see you there — get ahead-left of his nose, in his window", 'warn', 5);
        }
      }
      return;
    }
    // Following. He loses you in the cloud and turns back the way he was going.
    d.followT += dt;
    if (inCloud) d.lostT += dt;
    else d.lostT = Math.max(0, d.lostT - dt);
    if (d.lostT > 4) {
      d.following = false;
      d.lostT = 0;
      n.direct(bearing(n.pos, DANGER_POS), STRAY_START.y, STRAY_SPEED);
      Fun.say(ctx, "Guardian zero one, he's lost you in the cloud — he's turned back toward the range. Get under it and signal again.", 'tower', 1);
    }
  },
  failIf: (ctx) => {
    if (strayLineToDanger(ctx) < DANGER.r) return 'He flew into the live-firing area. He never saw you — intercepts are made ahead-left, slow.';
    if (ctx.elapsed > 470) return ctx.data.seen ? 'Out of time — he saw you, but you never led him clear. A slow, level left turn, and he follows.' : 'Out of time — he never saw you. Intercepts are made ahead-left, slow.';
    return null;
  },
  steps: [
    {
      id: 'scramble',
      text: 'Scramble — a Skylark with a dead radio is drifting toward the danger area. Get airborne.',
      hint: 'Full power, rotate, and turn back west-south-west. The arrow is on him.',
      atc: { text: 'Guardian zero one, scramble, scramble. Stray contact west-south-west, no radio, heading for the range.', voice: 'tower', urgency: 1 },
      targetLabel: 'Stray contact',
      target: (ctx) => strayPos(ctx),
      check: (ctx) => ctx.ac.airborneTime > 3 && ctx.ac.agl > 30,
    },
    {
      id: 'intercept',
      text: 'Intercept him. Come in from behind, then slide up ahead-left where he can see you.',
      hint: 'He is slow — about eighty knots. Get the speed off early or you will shoot past him.',
      targetLabel: 'Stray contact',
      target: (ctx) => strayPos(ctx),
      check: (ctx) => flatDist(ctx.ac.pos, strayPos(ctx)) < 600,
    },
    {
      id: 'signal',
      text: 'Hold ahead-left of his nose and rock your wings. He has to SEE you.',
      hint: 'Match his speed. Roll left, then right (A, then D), a quarter of the way each time, in his window.',
      atc: { text: 'Guardian zero one, Northwatch. You are alongside. Ahead-left and show him your wings.', voice: 'tower' },
      targetLabel: 'Ahead-left of him',
      target: (ctx) => strayStation(ctx),
      check: (ctx) => ctx.data.following,
    },
    {
      id: 'lead',
      text: 'He has you. A slow, level left turn — he follows. Lead him north, clear of the area.',
      hint: 'Gentle bank, hold your height, and keep him in your mirror. If you climb into the cloud he loses you.',
      targetLabel: 'Clear of the range',
      target: () => CLEAR_POINT,
      check: (ctx) => {
        const d = ctx.data;
        if (!d.following || d.followT < 20) return false;
        const turned = d.turnFrom == null ? 0 : -hdgDiff(ctx.ac.heading, d.turnFrom);
        const n = d.stray;
        if (!n) return false;
        const away = Math.abs(hdgDiff(n.heading, bearing(n.pos, DANGER_POS))) > 80;
        return (turned > 40 || away) && strayLineToDanger(ctx) > 4200 && flatDist(n.pos, CLEAR_POINT) < 4500;
      },
    },
    {
      id: 'rtb',
      text: 'He is clear and heading home. Return to Northwatch and land.',
      hint: 'The jet lands fast and flat. Get the speed off early.',
      atc: { text: "Guardian zero one, he's clear of the range and squawking again. Nice work. Return to base, runway zero nine.", voice: 'tower' },
      targetLabel: 'Runway 09',
      target: () => RUNWAY.touchdown,
      check: landedAndStopped,
    },
  ],
  onComplete: (ctx) => {
    ctx.sim.speak('Guardian zero one, Northwatch. Textbook intercept — he never knew what day it was. Welcome home.', 'tower');
  },
  score: (ctx) => {
    const l = ctx.data.lastTouchdown;
    // Full marks for the clock inside 3:20, nothing at seven minutes.
    const quick = Math.max(0, Math.min(1, 1 - (ctx.elapsed - 200) / 220));
    return Math.round(quick * 55 + (l ? l.score : 20) * 0.3 + 15);
  },
};

/* ================================================================== *
 * Diversion
 * ================================================================== */

const ELEV_K = 14; // Kestrel's field elevation; the mission is pinned to that map
/** The descent gate: 9 km out on the extended centreline, 3,000 ft. */
const DIV_GATE = V(-9000, ELEV_K + 915, 0);
/** Where you must be configured: 4.5 km out, on the slope. */
const DIV_FINAL = V(-4500, ELEV_K + 235, 0);

function diversionType() {
  return AIRCRAFT.some((a) => a.id === 'a320') ? 'a320' : 'meridian';
}

const diversion = {
  id: 'diversion',
  name: 'Diversion',
  short: 'Medical diversion, short wet runway',
  difficulty: 'Hard',
  icon: '✚',
  category: 'airline',
  map: 'kestrel',
  get aircraft() {
    return diversionType();
  },
  blurb:
    'Eight thousand feet over the sea, a passenger with chest pains and a doctor asking how long. '
    + 'Kestrel is nearest, its runway is short and wet — get down fast, land in the first third, and stop.',
  reward: 'Teaches an emergency descent: fast but inside the barber pole, configured early, and a short-field landing.',
  weather: { time: 'day', condition: 'cloudy', windSpeedKts: 8, windDirDeg: 90 },
  /*
   * Eight thousand feet over the open sea, 18 km west, eighty per cent fuel
   * (an airborne start). `altAGL` over water is measured from the sea floor
   * (-34 m at Kestrel), so 2,472 puts you at about 2,438 m. A three-degree
   * slope from here would need 46 km: you have 18, which is the mission.
   * (The plan said ten thousand; this game's A320 cruises at 63 m/s with a
   * 90 m/s barber pole, and ten thousand feet from anywhere it can reach
   * in six minutes is a dive it cannot fly.)
   */
  get spawn() {
    return { pos: V(-18000, 0, 3000), headingDeg: 80, speed: cruiseSpeed(diversionType()), altAGL: 2472 };
  },
  timeLimit: 480,
  parTime: 360,
  medals: { silver: 65, gold: 85, goldHint: 'Down inside 5:30, wheels in the first third, stopped with half the runway left' },
  finale: { view: 'orbit', secs: 3 },
  /*
   * Two twists. A squall line sits between you and the island partway
   * down: a minute of storm and a gust front, go round it or ride the
   * turbulence through. Then on final the runway is wet and the braking
   * action is medium — which the physics really does model (less grip),
   * and the tower tells you before the wheels touch.
   */
  beats: [
    {
      id: 'squall',
      at: [45, 75],
      when: (ctx) => !ctx.ac.onGround,
      run: (ctx) => {
        Fun.weatherTurn(ctx, 'stormy', 60, { rain: 0.8 });
        Fun.gust(ctx, { mult: 1.4, turnDeg: 30, secs: 60 });
      },
      say: { text: 'Island two one, Kestrel Approach, squall line between you and the island, moderate turbulence below eight thousand. Your call to go round it.', voice: 'approach', urgency: 1 },
      shake: 0.4,
      sting: 'hit',
      debrief: 'Through the squall line on the way down',
    },
    {
      id: 'wet',
      step: 'land',
      at: 0.5,
      run: (ctx) => Fun.weatherTurn(ctx, 'rainy', 240),
      say: { text: 'Island two one, braking action medium, runway wet. Wind zero nine zero at eight, cleared to land runway zero nine.', voice: 'tower', urgency: 1 },
      debrief: 'Wet runway, braking action medium — stopped with runway to spare',
    },
  ],
  onStart: (ctx) => {
    const ac = ctx.ac;
    // Wheels up in the cruise (main.js puts every airborne spawn down with the gear down).
    if (ac && ac.gearDown && !ac.onGround) {
      ac.gearDown = false;
      ac.gearPos = 0;
    }
    const d = ctx.data;
    d.overspeedT = 0;
    d.wasAirborne = false;
    d.tdX = null;
    d.stopX = null;
  },
  tick: (ctx, dt) => {
    const d = ctx.data;
    const ac = ctx.ac;
    if (SPEC.vne && ac.ias > SPEC.vne) d.overspeedT += dt;
    if (!ac.onGround) d.wasAirborne = true;
    else if (d.wasAirborne && d.tdX == null) d.tdX = ac.pos.x;
    if (ac.onGround && d.tdX != null && d.stopX == null && ac.groundSpeed < 2 && ac.groundTime > 1) d.stopX = ac.pos.x;
  },
  failIf: (ctx) => {
    const ac = ctx.ac;
    if (ac.onGround && ac.pos.x > RUNWAY.thresholdEast.x + 40 && Math.abs(ac.pos.z) < 220) {
      return 'Off the end of the runway — short and wet: wheels in the first third, brakes on at once.';
    }
    if (cameDownShort(ctx)) return 'Came down short of the runway — hold the slope, two white and two red, all the way in.';
    if (ctx.data.overspeedT > 25) return 'Overspeed for too long — the airframe will not take it. Fast, but inside the barber pole.';
    if (ctx.elapsed > 470) return 'Too slow for the patient — a diversion is flown fast: idle, nose down, inside the barber pole.';
    return null;
  },
  steps: [
    {
      id: 'turn',
      text: 'Chest pains in the cabin, doctor on board. Kestrel is nearest — turn for it, start down.',
      hint: 'Power to idle, nose down, follow the arrow to the gate. Keep the speed inside the barber pole.',
      atc: { text: 'Island two one, Kestrel Approach, roger the medical. Direct Kestrel, descend at your discretion, runway zero nine — it is short.', voice: 'approach', urgency: 1 },
      targetLabel: 'Descent gate',
      target: () => DIV_GATE,
      check: (ctx) => ctx.elapsed > 5 && Math.abs(hdgDiff(ctx.ac.heading, bearing(ctx.ac.pos, DIV_GATE))) < 35 && ctx.ac.vs < -4,
    },
    {
      id: 'descend',
      text: 'Down to 3,000 feet by the gate, 9 km out — fast, but inside the barber pole. No overspeed.',
      hint: 'About three thousand feet a minute down. If the speed runs away, lift the nose a touch, not the power.',
      targetLabel: 'Descent gate',
      target: () => DIV_GATE,
      check: (ctx) => flatDist(ctx.ac.pos, DIV_GATE) < 1800 && ft(ctx.ac.alt) < 3600,
    },
    {
      id: 'configure',
      text: 'Gear and flaps. Line up on 09 — the runway is short, aim for the first third.',
      hint: 'Gear (G), flaps (F), and slow to approach speed before the fix. Two white, two red on the PAPI.',
      targetLabel: 'Final approach fix',
      target: () => DIV_FINAL,
      check: (ctx) =>
        ctx.ac.gearDown
        && flatDist(ctx.ac.pos, DIV_FINAL) < 1500
        && Math.abs(ctx.ac.pos.z) < 600
        && Math.abs(hdgDiff(ctx.ac.heading, RUNWAY.headingDeg)) < 40
        && ft(ctx.ac.agl) < 1600,
    },
    {
      id: 'land',
      text: 'Touch down in the first third and stop with runway left. Wet runway — braking action medium.',
      hint: 'Aim at the numbers, not the middle. Brakes (Space) the moment the wheels are on.',
      targetLabel: 'Touchdown zone',
      target: () => RUNWAY.touchdown,
      check: landedAndStopped,
    },
  ],
  onComplete: (ctx) => {
    ctx.sim.speak('Island two one, Kestrel Tower. Ambulance is on the apron, doors on the left. Well done, Captain.', 'tower');
  },
  score: (ctx) => {
    const d = ctx.data;
    const l = d.lastTouchdown;
    const L = RUNWAY.thresholdEast.x - RUNWAY.thresholdWest.x;
    const firstThird = RUNWAY.thresholdWest.x + L / 3;
    // The clock: full marks inside 5:30, nothing at eight minutes.
    const quick = Math.max(0, Math.min(1, 1 - (ctx.elapsed - 330) / 150));
    // Touchdown: all of it in the first third, fading to nothing by two-thirds.
    const td = d.tdX == null ? 0 : Math.max(0, Math.min(1, 1 - Math.max(0, d.tdX - firstThird) / (L / 3)));
    // Runway left: half of it is full marks.
    const left = d.stopX == null ? 0 : Math.max(0, Math.min(1, (RUNWAY.thresholdEast.x - d.stopX) / (L * 0.5)));
    return Math.round(quick * 35 + td * 25 + left * 20 + (l ? l.score : 20) * 0.2);
  },
};

export const MISSIONS = [strayContact, diversion];
