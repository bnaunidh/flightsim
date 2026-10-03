/**
 * Goofy missions — "the most random and silly stuff".
 *
 * Eleven of them, written for the kid who asked, and every one of them is a
 * real flying exercise wearing a silly hat:
 *
 *   Rubber Duck Express      a parachute drop onto a sea stack (aiming, wind)
 *   The Great Balloon Escape catching a moving target and bringing it back
 *   Hello, Tower!            a roll, done low and on purpose (fighter)
 *   Seagull Showdown         a race you can actually lose
 *   Moo-ving Day             a deck landing with a passenger who hates g
 *   Close Encounter          a chase, then leading something that follows you
 *   S'mores on Mount Ember   holding a band of distance and height, both ways round
 *   Loop-the-Loop            a real loop, twice, with rainbow smoke (fighter)
 *   Ice Cream Emergency      altitude as a resource: it is cooler up there
 *   Bubble Trouble           precise 3D navigation, twelve times
 *   Buzz Off!                formating on something slower than you
 *
 * Every check() has been reasoned against the flight model, and the numbers
 * that matter were measured headless on the real physics (see the comments by
 * each one) — a goofy mission you cannot finish is not goofy, it is broken.
 *
 * The props are built when a mission starts and handed to props.js, which
 * takes them away again when the flight ends. Nothing here is a collider:
 * you can fly through a balloon, a bubble, a bee and a UFO, and that is the
 * point of most of them.
 *
 * All of them pin the map they were written for. Coordinates are Kestrel's
 * unless the mission says otherwise.
 */

import * as THREE from '../../vendor/three.module.js';
import { RUNWAY } from '../../world/airport.js';
import { DELIVERY_PAD } from '../../world/scenery.js';
import { heightAt, isOnRunway2, obstacleAt, MAP } from '../../world/terrain.js';
import { missionProps, currentProps, adopt, addLoop, markUi } from '../../features/events/props.js';
import * as P from '../../features/events/goofy-props.js';
import * as SFX from '../../features/events/sfx.js';
import * as UI from '../../features/events/ui.js';

const FT = 3.28084;
const ft = (m) => m * FT;
const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

function flat(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Ground or sea surface, whichever is higher — the sea floor is not somewhere to hover over. */
function surface(x, z) {
  return Math.max(0, heightAt(x, z));
}

function airborne(ctx) {
  return ctx.ac.airborneTime > 3 && ctx.ac.agl > 30;
}

function notify(ctx, text, kind = 'info', secs = 4) {
  ctx.sim.hud.notify(text, kind, secs);
}

/**
 * Down, stopped, on a runway. The same test the main missions use (see
 * landedAndStopped in ../missions.js, which cannot be imported from here
 * without a cycle): landing on a beach is a fine way to save an aeroplane,
 * but it is not "land on the runway".
 */
function landed(ctx) {
  const ac = ctx.ac;
  const t = ctx.data.lastTouchdown;
  const stopped = !!t && !t.crashed && ac.onGround && ac.groundSpeed < 2.5 && ac.groundTime > 1.2;
  if (!stopped) return false;
  if (t.onRunway || isOnRunway2(ac.pos.x, ac.pos.z, 8)) return true;
  if (!ctx.data.saidOffRunway) {
    ctx.data.saidOffRunway = true;
    notify(ctx, 'Safely down — but not on the runway. Take off and come round again.', 'warn', 6);
  }
  return false;
}

/**
 * Somewhere near (cx, cz) with nothing built on it, so a party or a bouncy
 * castle does not end up inside a block of flats. The town's buildings are
 * registered obstacles, so asking is cheap and exact.
 */
function clearSpot(cx, cz, radius = 26, reach = 500) {
  const free = (x, z) => {
    const h = heightAt(x, z);
    if (h < 2) return false;
    for (const [dx, dz] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius], [radius * 0.7, radius * 0.7], [-radius * 0.7, -radius * 0.7]]) {
      if (obstacleAt(x + dx, heightAt(x + dx, z + dz) + 3, z + dz)) return false;
    }
    return true;
  };
  if (free(cx, cz)) return new THREE.Vector3(cx, heightAt(cx, cz), cz);
  for (let r = 40; r <= reach; r += 40) {
    for (let a = 0; a < 16; a++) {
      const x = cx + Math.sin((a / 16) * Math.PI * 2) * r;
      const z = cz - Math.cos((a / 16) * Math.PI * 2) * r;
      if (free(x, z)) return new THREE.Vector3(x, heightAt(x, z), z);
    }
  }
  return new THREE.Vector3(cx, heightAt(cx, cz), cz);
}

/**
 * True five times a second. The meters do not need sixty updates a second,
 * and every update builds an options object and a string or two — which in
 * a tick that runs every frame is exactly the allocation the rules forbid.
 */
function uiTick(ctx, dt) {
  ctx.data.uiT = (ctx.data.uiT || 0) - dt;
  if (ctx.data.uiT > 0) return false;
  ctx.data.uiT = 0.2;
  return true;
}

/** Heading, in the game's convention, from one point to another. */
function bearing(from, to) {
  return (Math.atan2(to.x - from.x, -(to.z - from.z)) / DEG + 360) % 360;
}

const CALM = { time: 'day', condition: 'clear', windSpeedKts: 4, windDirDeg: 90 };

/* Scratch vectors. Every tick below reuses these; nothing is allocated per frame. */
const V1 = new THREE.Vector3();
const V2 = new THREE.Vector3();
const V3 = new THREE.Vector3();
const Q1 = new THREE.Quaternion();

/* ================================================================== *
 * 1. Rubber Duck Express
 * ================================================================== */

const LIGHTHOUSE = new THREE.Vector3(-3100, 0, -3600);
const T_DUCK = new THREE.Vector3();

function lighthouseAt(out) {
  out.set(LIGHTHOUSE.x, heightAt(LIGHTHOUSE.x, LIGHTHOUSE.z), LIGHTHOUSE.z);
  return out;
}

const duck = {
  id: 'goofy-duck',
  category: 'goofy',
  game: 'flight',
  name: 'Rubber Duck Express',
  short: 'A bath toy the size of a shed',
  difficulty: 'Easy',
  icon: '🦆',
  map: 'kestrel',
  aircraft: 'skylark',
  blurb:
    'The lighthouse keeper on Needle Rock has one birthday wish: a bath toy. The only rubber duck we '
    + 'could find is the size of a garden shed. Fly it out and drop it to him by parachute.',
  reward: 'Teaches aiming a drop — release early, and let the wind help.',
  weather: { ...CALM, windSpeedKts: 3 },
  parTime: 360,
  onStart(ctx) {
    const pr = missionProps(ctx.sim, 'goofy-duck');
    ctx.sim.hasCargo = true;
    ctx.data.misses = 0;
    ctx.data.floaters = [];
    const lh = lighthouseAt(V1);
    // A sign over the lighthouse, readable from miles out.
    const sign = P.makeSign(['DUCK', 'HERE PLEASE!'], { width: 44 });
    sign.position.set(lh.x, lh.y + 95, lh.z);
    pr.group.add(sign);
  },
  tick(ctx, dt) {
    const pr = currentProps('goofy-duck');
    if (!pr) return;
    // Put a duck on every crate that comes off the aeroplane.
    const crate = ctx.sim.crate;
    if (crate && crate.group && !crate.group.userData.duck) {
      const d = P.makeDuck(4.4);
      d.position.y = 0.5;
      crate.group.add(d);
      crate.group.userData.duck = d;
      adopt(d);
      SFX.quack(ctx.sim);
    }
    // Missed ducks float about in the sea, looking pleased with themselves.
    ctx.data.t = (ctx.data.t || 0) + dt;
    for (const f of ctx.data.floaters) {
      f.position.y = f.userData.baseY + Math.sin(ctx.data.t * 1.7 + f.userData.phase) * 0.35;
      f.rotation.y += dt * 0.2;
    }
  },
  steps: [
    {
      id: 'takeoff',
      text: 'Your cargo today: one ENORMOUS rubber duck. Take off from runway 09.',
      hint: 'Full power with Shift, and lift off gently with S at 55 knots.',
      atc: { text: 'Skylark one seven two, Kestrel Tower, cleared for take-off runway zero nine. Mind the duck.', voice: 'tower' },
      targetLabel: 'Needle Rock',
      target: () => lighthouseAt(T_DUCK).setY(T_DUCK.y + 150),
      check: airborne,
    },
    {
      id: 'fly',
      text: 'Fly to the lighthouse on Needle Rock, north-west of the island. Look for the big sign.',
      hint: 'Follow the arrow. The lighthouse stands on a tall rock in the sea.',
      targetLabel: 'Lighthouse',
      target: () => lighthouseAt(T_DUCK).setY(T_DUCK.y + 150),
      check: (ctx) => flat(ctx.ac.pos, lighthouseAt(V1)) < 1300,
    },
    {
      id: 'drop',
      text: 'Come in low and slow, and press X just BEFORE you reach the lighthouse. The duck has a parachute!',
      hint: 'About 400 feet above the rock is plenty. The duck keeps some of your speed, so let go a little early.',
      targetLabel: 'Drop the duck',
      target: () => lighthouseAt(T_DUCK).setY(T_DUCK.y + 110),
      check: (ctx) => {
        const crate = ctx.sim.crate;
        if (!crate || !crate.landed) return false;
        const p = crate.group.position;
        const lh = lighthouseAt(V1);
        const d = flat(p, lh);
        if (d <= 130) {
          ctx.data.dropDistance = d;
          SFX.quack(ctx.sim);
          SFX.cheer(ctx.sim, 1.8, 0.7);
          notify(ctx, `Direct duck! It landed ${Math.round(d)} m from the lighthouse.`, 'good', 5);
          return true;
        }
        // Missed. Leave that duck where it fell and load another.
        ctx.data.misses++;
        const pr = currentProps('goofy-duck');
        const wet = heightAt(p.x, p.z) < 0;
        if (pr && ctx.data.floaters.length < 6) {
          const f = P.makeDuck(4.4);
          f.position.set(p.x, wet ? 0.2 : heightAt(p.x, p.z), p.z);
          f.userData.baseY = f.position.y;
          f.userData.phase = ctx.data.misses;
          pr.group.add(f);
          if (wet) ctx.data.floaters.push(f);
        }
        notify(ctx, wet
          ? 'SPLOOSH! The duck floats (of course it does) but the keeper cannot swim. Here is another duck!'
          : 'The duck landed in a bush. The keeper cannot reach it. Here is another duck!', 'warn', 6);
        ctx.sim.removeCrate();
        ctx.sim.hasCargo = true;
        return false;
      },
    },
    {
      id: 'home',
      text: 'The keeper says QUACK. (He means thank you.) Fly home and land on runway 09.',
      hint: 'Turn back to the south-east and follow the arrow to the runway.',
      atc: { text: 'Skylark one seven two, the lighthouse keeper says thank you. He is already in the bath.', voice: 'tower' },
      targetLabel: 'Runway 09',
      target: () => RUNWAY.touchdown,
      check: landed,
    },
  ],
  score: (ctx) => {
    const l = ctx.data.lastTouchdown;
    const aim = ctx.data.dropDistance != null ? Math.max(0, 1 - ctx.data.dropDistance / 130) : 0.3;
    return Math.round(aim * 45 + (l ? l.score : 40) * 0.4 + Math.max(0, 15 - ctx.data.misses * 5));
  },
};

/* ================================================================== *
 * 2. The Great Balloon Escape
 * ================================================================== */

const T_BALLOON = new THREE.Vector3();

const balloon = {
  id: 'goofy-balloon',
  category: 'goofy',
  game: 'flight',
  name: 'The Great Balloon Escape',
  short: 'Catch a runaway birthday balloon',
  difficulty: 'Easy',
  icon: '🎈',
  map: 'kestrel',
  aircraft: 'skylark',
  blurb:
    "Grandma Rosa is 100 today, and her giant birthday balloon has come untied and is floating away "
    + 'over the town. Catch its ribbon with your aeroplane and bring it back to the party before it drifts out to sea.',
  reward: 'Teaches closing on a moving target, and matching its height.',
  weather: CALM,
  parTime: 300,
  onStart(ctx) {
    const pr = missionProps(ctx.sim, 'goofy-balloon');
    // The party: between the airfield and the town, somewhere nothing is built.
    const party = clearSpot(560, 480, 26, 420);
    ctx.data.party = party;
    const cake = P.makeParty();
    cake.position.copy(party);
    pr.group.add(cake);
    ctx.data.cake = cake;
    const sign = P.makeSign(['HAPPY 100th', 'GRANDMA ROSA!'], { width: 46, border: '#ff8fc6' });
    sign.position.set(party.x, party.y + 42, party.z);
    pr.group.add(sign);
    const b = P.makeBalloon();
    b.position.set(party.x, party.y + 150, party.z);
    pr.group.add(b);
    ctx.data.balloon = b;
    ctx.data.caught = false;
    ctx.data.t = 0;
  },
  tick(ctx, dt) {
    const b = ctx.data.balloon;
    if (!b || !currentProps('goofy-balloon')) return;
    ctx.data.t += dt;
    const t = ctx.data.t;
    if (ctx.data.cake && ctx.data.cake.userData.flame) {
      ctx.data.cake.userData.flame.scale.setScalar(6.5 + Math.sin(t * 13) * 0.8);
    }
    if (!ctx.data.caught) {
      /*
       * Drifting north-east, up and out towards the sea, a little faster than
       * a jog. It was 4 m/s, and measured against a normal take-off that left
       * it within a few hundred metres of the party when you caught it — so
       * the "tow it back" half of the mission was over before it began.
       * At 6.5 m/s it is about half a kilometre away by then, and it stops
       * drifting two and a half kilometres out so nobody has to chase it to
       * Mango Cay.
       */
      if (flat(b.position, ctx.data.party) < 2500) {
        b.position.x += 5.2 * dt;
        b.position.z -= 3.9 * dt;
      }
      const top = ctx.data.party.y + 430;
      if (b.position.y < top) b.position.y += 0.9 * dt;
      b.rotation.y += dt * 0.3;
      b.rotation.z = Math.sin(t * 0.8) * 0.08;
    } else {
      ctx.data.towT = (ctx.data.towT || 0) + dt;
      // Towed: trailing behind and below on its ribbon, swinging a little.
      const ac = ctx.ac;
      ac.forward(V1);
      V2.copy(ac.pos).addScaledVector(V1, -40);
      V2.y -= 9;
      const floor = surface(V2.x, V2.z) + 25;
      if (V2.y < floor) V2.y = floor;
      b.position.lerp(V2, 1 - Math.exp(-dt * 3));
      b.rotation.z = Math.sin(t * 2.2) * 0.2;
    }
  },
  steps: [
    {
      id: 'takeoff',
      text: "Grandma Rosa's 100th birthday balloon has floated away from her party! Take off, quick!",
      hint: 'Full power with Shift, then S at 55 knots to lift off.',
      atc: { text: 'Skylark one seven two, there is a very large balloon drifting over the town. Please go and get it. Cleared for take-off.', voice: 'tower' },
      targetLabel: 'Balloon',
      target: (ctx) => (ctx.data.balloon ? T_BALLOON.copy(ctx.data.balloon.position) : null),
      check: airborne,
    },
    {
      id: 'catch',
      text: 'Fly right up to the big red balloon to hook its ribbon. Match its height and get really close!',
      hint: 'Come at it slowly and level. It will not pop — it is a very strong balloon.',
      targetLabel: 'Balloon',
      target: (ctx) => (ctx.data.balloon ? T_BALLOON.copy(ctx.data.balloon.position) : null),
      check: (ctx) => {
        const b = ctx.data.balloon;
        if (!b) return false;
        const near = flat(ctx.ac.pos, b.position) < 60 && Math.abs(ctx.ac.pos.y - b.position.y) < 45;
        if (near) {
          ctx.data.caught = true;
          notify(ctx, 'Got it! The ribbon is hooked on your tail.', 'good', 4);
          SFX.pop(ctx.sim);
        }
        return near;
      },
    },
    {
      id: 'tow',
      text: 'Now tow it back to the party! Fly low over the cake — below 800 feet.',
      hint: 'The party is between the airfield and the town. Look for the giant cake.',
      atc: { text: 'Skylark one seven two, Grandma Rosa can see you. She is waving her walking stick. In a good way.', voice: 'tower' },
      targetLabel: 'The party',
      target: (ctx) => T_BALLOON.copy(ctx.data.party).setY(ctx.data.party.y + 150),
      check: (ctx) => {
        // It has to have actually been towed: catching it right over the
        // cake and calling that a delivery is not what anybody signed up for.
        const ok = (ctx.data.towT || 0) > 6 && flat(ctx.ac.pos, ctx.data.party) < 380 && ft(ctx.ac.agl) < 800;
        if (ok) {
          // Tie it to the cake before the debrief covers the screen.
          ctx.data.caught = false;
          ctx.data.balloon.position.set(ctx.data.party.x + 10, ctx.data.party.y + 40, ctx.data.party.z);
          SFX.cheer(ctx.sim, 2.6, 1);
          notify(ctx, 'HOORAY! The balloon is back and Grandma Rosa is doing a little dance.', 'good', 6);
        }
        return ok;
      },
    },
  ],
  onComplete(ctx) {
    ctx.sim.speak('Skylark one seven two, the party says thank you. There is cake in the tower for you.', 'tower');
  },
  score: (ctx) => Math.round(60 + Math.max(0, 1 - ctx.elapsed / 420) * 40),
};

/* ================================================================== *
 * 3. Hello, Tower!
 *
 * Measured on the flight model (tests/features/events.mjs): the Vanguard
 * is upside down 0.7 s after full stick, and let go it rolls itself upright
 * again — but the whole manoeuvre, roll and recovery, costs up to 113 m.
 * The window was first 90 to 420 m up; flip at the bottom of that and
 * recovery bottoms out twenty metres off the grass beside an 80 m tower.
 * So the window is 180 to 450 m (about 600 to 1,500 ft): a roll anywhere
 * in it recovers with at least 65 m in hand.
 * ================================================================== */

const TOWER = new THREE.Vector3(40, 0, -206);
const T_TOWER = new THREE.Vector3();

function towerTarget(h = 260) {
  return T_TOWER.set(TOWER.x, heightAt(TOWER.x, TOWER.z) + h, TOWER.z);
}

const tower = {
  id: 'goofy-tower',
  category: 'goofy',
  game: 'flight',
  name: 'Hello, Tower!',
  short: 'Fly past the tower upside down',
  difficulty: 'Medium',
  icon: '🙃',
  map: 'kestrel',
  aircraft: 'vanguard',
  blurb:
    'The air traffic controllers are bored. They have dared you to fly past their windows UPSIDE DOWN. '
    + 'Just once. For science. They have borrowed the fighter for you, because it rolls very fast.',
  reward: 'Teaches rolling a fast jet — and that it rolls itself back if you let go.',
  weather: CALM,
  spawn: { pos: new THREE.Vector3(-4600, 0, -600), headingDeg: 90, speed: 140, altAGL: 330 },
  parTime: 150,
  onStart(ctx) {
    missionProps(ctx.sim, 'goofy-tower');
    ctx.data.near = false;
  },
  steps: [
    {
      id: 'approach',
      text: 'Fly towards the control tower — the tall one by the terminal. Stay above 600 feet.',
      hint: 'The arrow points at the tower. Do not fly into it: go past it, not through it!',
      atc: { text: 'Vanguard zero one, Kestrel Tower. We dare you. Upside down, past the windows, and we will give you marks out of ten.', voice: 'tower' },
      targetLabel: 'Control tower',
      target: () => towerTarget(),
      check: (ctx) => flat(ctx.ac.pos, TOWER) < 2600,
    },
    {
      id: 'flip',
      text: 'Now roll upside down as you pass the tower! Hold A or D until the world is on its head.',
      // The words are inside the check's window (180 to 450 m, 591 to 1,476
      // ft). They said "700 to 1,400", so a roll at 650 ft counted while the
      // screen said it was too low.
      hint: 'Stay between 600 and 1,400 feet — rolling costs height. Let go once you are upside down and the fighter rolls itself back.',
      targetLabel: 'Control tower',
      target: () => towerTarget(),
      check: (ctx) => {
        const ac = ctx.ac;
        const d = flat(ac.pos, TOWER);
        const inverted = Math.abs(ac.bankAngleDeg()) > 140;
        if (d < 650 && inverted && ac.agl > 180 && ac.agl < 450) {
          notify(ctx, 'UPSIDE DOWN! The controllers are pressing their noses on the glass!', 'good', 4);
          SFX.cheer(ctx.sim, 1.5, 0.8);
          return true;
        }
        if (d < 700) ctx.data.near = true;
        else if (ctx.data.near && d > 1500) {
          ctx.data.near = false;
          notify(ctx, 'Missed it! Turn round and try another pass.', 'warn', 4);
        }
        return false;
      },
    },
    {
      id: 'marks',
      text: 'Brilliant! Now fly past again the RIGHT way up, so they can hold up their scores.',
      hint: 'Wings level, and fly past the tower once more.',
      targetLabel: 'Control tower',
      target: () => towerTarget(),
      check: (ctx) => {
        const ac = ctx.ac;
        const ok = flat(ac.pos, TOWER) < 900 && Math.abs(ac.bankAngleDeg()) < 35 && ac.agl > 60;
        if (ok) {
          const pr = currentProps('goofy-tower');
          if (pr) {
            const cards = P.makeScorecards();
            cards.position.copy(towerTarget(110));
            pr.group.add(cards);
          }
          notify(ctx, 'The judges say: 9.5! 9.8! 10! ... and a 3 from Grumpy Gary.', 'good', 6);
          SFX.fanfare(ctx.sim);
        }
        return ok;
      },
    },
    {
      id: 'cards',
      text: 'Look back at the tower — the judges are holding up their scores!',
      duration: 5,
    },
  ],
  onComplete(ctx) {
    ctx.sim.speak('Vanguard zero one, that was the silliest thing we have seen all week. Ten out of ten.', 'tower');
  },
  score: (ctx) => Math.round(70 + Math.max(0, 1 - ctx.elapsed / 300) * 30),
};

/* ================================================================== *
 * 4. Seagull Showdown
 *
 * Measured: the Skylark does 124 kt (66 m/s) flat out, and about 55 m/s at
 * the throttle it spawns with. The course is 8.9 km; the gulls fly it at
 * 50 m/s (178 s), so full power and a sensible line wins by twenty-odd
 * seconds, and wandering about sightseeing loses. That is the race.
 * ================================================================== */

/*
 * One course per island the race has lived on, each four points over the
 * sea at the gulls' height: a start by the gulls' own rock, two checkpoints
 * and a finish on another island. The race moved to Condor Rock on
 * 2026-10-02 (the owner: "use different maps for different missions" —
 * Condor is the map with the gulls: `features.birds` in maps.js); Kestrel's
 * course is kept so pinning it back is one line. Measured in node on
 * Condor's height field: every point is open sea (-15 to -44 m) except the
 * finish on Egg Rock at 39 m, and nothing under any leg is higher than 41 m
 * — so the 250 m race height clears everything by two hundred metres.
 */
const GULL_COURSES = {
  kestrel: {
    pts: [
      new THREE.Vector3(-2700, 0, -3300), // start, by Needle Rock
      new THREE.Vector3(-600, 0, -2400), // checkpoint 1: off the north shore
      new THREE.Vector3(2400, 0, -3200), // checkpoint 2: over the shallows
      new THREE.Vector3(5900, 0, -5000), // finish: Mango Cay
    ],
    hdg: 113,
    rock: 'Needle Rock',
    cp1: 'off the north shore of Kestrel',
    cp2: 'out over the shallow water to the north-east',
    finish: 'Mango Cay',
    finishVoice: 'Mango Cay confirms',
  },
  condor: {
    pts: [
      new THREE.Vector3(650, 0, -2600), // start, off The Beak
      new THREE.Vector3(-2600, 0, -900), // checkpoint 1: off Condor Ledge, the west side
      new THREE.Vector3(-4200, 0, 1300), // checkpoint 2: open sea, south-west
      new THREE.Vector3(-3560, 0, 2600), // finish: Egg Rock
    ],
    hdg: 298,
    rock: 'The Beak',
    cp1: 'off Condor Ledge, round the west side',
    cp2: 'out over the open sea to the south-west',
    finish: 'Egg Rock',
    finishVoice: 'Egg Rock confirms',
  },
};
const RACE_ALT = 250;
const GULL_SPEED = 50;
const T_RACE = new THREE.Vector3();
for (const c of Object.values(GULL_COURSES)) {
  let s = 0;
  for (let i = 1; i < c.pts.length; i++) s += flat(c.pts[i - 1], c.pts[i]);
  c.len = s;
}

/** The course for the island that is loaded (the mission pins Condor; Kestrel's is the fallback for its own island). */
function gullCourse() {
  return (MAP && GULL_COURSES[MAP.id]) || GULL_COURSES.condor;
}

/** A point `s` metres along the course, at the gulls' height. */
function raceAt(s, out) {
  const RACE = gullCourse().pts;
  let left = Math.max(0, s);
  for (let i = 1; i < RACE.length; i++) {
    const seg = flat(RACE[i - 1], RACE[i]);
    if (left <= seg || i === RACE.length - 1) {
      const k = Math.min(1, left / seg);
      out.lerpVectors(RACE[i - 1], RACE[i], k);
      out.y = surface(out.x, out.z) + RACE_ALT;
      return out;
    }
    left -= seg;
  }
  return out.copy(RACE[RACE.length - 1]);
}

/** How far along the course the player is, for the scoreboard. */
function playerProgress(ctx) {
  const C = gullCourse();
  const RACE = C.pts;
  const cp = ctx.data.cp || 0; // checkpoints passed
  let s = 0;
  for (let i = 1; i <= cp; i++) s += flat(RACE[i - 1], RACE[i]);
  const next = RACE[Math.min(cp + 1, RACE.length - 1)];
  const seg = flat(RACE[cp], next);
  return Math.min(C.len, s + Math.max(0, seg - flat(ctx.ac.pos, next)));
}

function checkpoint(i) {
  return (ctx) => {
    const RACE = gullCourse().pts;
    if (flat(ctx.ac.pos, RACE[i]) < 450) {
      ctx.data.cp = i;
      if (i < RACE.length - 1) {
        notify(ctx, `Checkpoint ${i} — keep going!`, 'good', 2.5);
        SFX.gull(ctx.sim, 0.6);
      }
      return true;
    }
    return false;
  };
}

/** Distance along the course from the start to checkpoint `i`. */
function courseTo(i) {
  const RACE = gullCourse().pts;
  let s = 0;
  for (let k = 1; k <= i; k++) s += flat(RACE[k - 1], RACE[k]);
  return s;
}

// Made once: the finish step asks every frame, and checkpoint() builds a closure.
const FINISH_CHECK = checkpoint(3);

const gulls = {
  id: 'goofy-gulls',
  category: 'goofy',
  game: 'flight',
  name: 'Seagull Showdown',
  short: 'Race a flock of cheeky seagulls',
  difficulty: 'Medium',
  icon: '🐦',
  // Condor Rock, the island with the gulls (maps.js: features.birds): see GULL_COURSES.
  map: 'condor',
  aircraft: 'skylark',
  blurb:
    'The seagulls of The Beak, off Condor Rock, say they are faster than your aeroplane. They say it every single day. '
    + 'Race them round the island to Egg Rock and settle it — but they know a shortcut, so fly a tidy line.',
  reward: 'Teaches flying a course efficiently: full power, straight lines, no wandering.',
  weather: CALM,
  get spawn() {
    const C = gullCourse();
    return { pos: C.pts[0].clone(), headingDeg: C.hdg, speed: 60, altAGL: RACE_ALT + 34 };
  },
  parTime: 170,
  onStart(ctx) {
    const pr = missionProps(ctx.sim, 'goofy-gulls');
    const flock = P.makeFlock(12, 2.3);
    pr.group.add(flock.mesh);
    ctx.data.flock = flock;
    ctx.data.gs = 0;
    ctx.data.cp = 0;
    ctx.data.t = 0;
    ctx.data.cryT = 3;
    ctx.data.tauntT = 25;
    const fin = P.makeFinish(70);
    const RACE = gullCourse().pts;
    const f = RACE[RACE.length - 1];
    fin.position.set(f.x, surface(f.x, f.z) + RACE_ALT - 35, f.z);
    fin.rotation.y = -bearing(RACE[2], f) * DEG + Math.PI / 2;
    pr.group.add(fin);
    markUi();
  },
  tick(ctx, dt) {
    const flock = ctx.data.flock;
    if (!flock || !currentProps('goofy-gulls')) return;
    const RACE_LEN = gullCourse().len;
    ctx.data.t += dt;
    const t = ctx.data.t;
    ctx.data.gs = Math.min(RACE_LEN, ctx.data.gs + GULL_SPEED * dt);
    // The leader, and the heading the flock is flying.
    raceAt(ctx.data.gs, V1);
    raceAt(ctx.data.gs + 20, V2);
    const hdg = bearing(V1, V2);
    const r = hdg * DEG;
    const fx = Math.sin(r);
    const fz = -Math.cos(r);
    // A loose V behind the leader, each bird flapping on its own beat.
    for (let i = 0; i < 12; i++) {
      const row = Math.ceil(i / 2);
      const side = i === 0 ? 0 : i % 2 ? -1 : 1;
      V3.set(
        V1.x - fx * row * 9 + fz * side * row * 8 + Math.sin(t * 0.9 + i) * 1.5,
        V1.y + Math.sin(t * 1.3 + i * 0.7) * 2 - row * 0.6,
        V1.z - fz * row * 9 - fx * side * row * 8
      );
      // Start them just off your left wing, not on top of you.
      if (ctx.data.gs < 1) V3.x -= 60;
      flock.set(i, V3, hdg, Math.sin(t * 7 + i * 1.3));
    }
    flock.commit();
    // Squawking at you when you are close, laughing at you when you are behind.
    const d = ctx.ac.pos.distanceTo(V1);
    ctx.data.cryT -= dt;
    if (ctx.data.cryT <= 0 && d < 400) {
      ctx.data.cryT = 6 + Math.random() * 4;
      SFX.gull(ctx.sim, SFX.falloff(d, 40, 400));
    }
    const me = playerProgress(ctx);
    ctx.data.tauntT -= dt;
    if (ctx.data.tauntT <= 0) {
      ctx.data.tauntT = 30;
      if (ctx.data.gs > me + 300) notify(ctx, 'The seagulls are ahead. One of them is doing a little dance.', 'warn', 4);
    }
    if (uiTick(ctx, dt)) UI.showMeter(ctx.sim, {
      label: me >= ctx.data.gs ? 'You are winning!' : 'The gulls are winning',
      value: me / RACE_LEN,
      text: `You ${Math.round((me / RACE_LEN) * 100)}% · Gulls ${Math.round((ctx.data.gs / RACE_LEN) * 100)}%`,
      tone: me >= ctx.data.gs ? 'good' : 'warn',
    });
  },
  failIf: (ctx) => (ctx.data.gs >= gullCourse().len ? `The seagulls got to ${gullCourse().finish} first. They are being unbearable about it. Try again!` : null),
  steps: [
    {
      id: 'race1',
      get text() {
        const C = gullCourse();
        return `GO! Race the seagulls to ${C.finish}! Checkpoint 1: ${C.cp1}.`;
      },
      hint: 'Full power (hold Shift) and fly straight at the arrow. Every wiggle is a gull in front of you.',
      atc: { text: 'Skylark one seven two, the race is on. The gulls have asked us to say they are not worried.', voice: 'tower' },
      targetLabel: 'Checkpoint 1',
      target: () => raceAt(courseTo(1), T_RACE),
      check: checkpoint(1),
    },
    {
      id: 'race2',
      get text() {
        return `Checkpoint 2: ${gullCourse().cp2}.`;
      },
      hint: 'Straight line, full power. They are right behind you.',
      targetLabel: 'Checkpoint 2',
      target: () => raceAt(courseTo(2), T_RACE),
      check: checkpoint(2),
    },
    {
      id: 'race3',
      get text() {
        return `Final stretch! Fly through the chequered finish line at ${gullCourse().finish}!`;
      },
      hint: 'Nearly there — do not slow down now.',
      targetLabel: 'Finish',
      target: () => raceAt(gullCourse().len, T_RACE),
      check: (ctx) => {
        if (!FINISH_CHECK(ctx)) return false;
        UI.hideMeter();
        SFX.cheer(ctx.sim, 2.4, 1);
        notify(ctx, 'YOU WIN! The seagulls are pretending they were not really racing.', 'good', 6);
        return true;
      },
    },
  ],
  onComplete(ctx) {
    ctx.sim.speak(`Skylark one seven two, ${gullCourse().finishVoice}: aeroplane first, seagulls second. They want a rematch.`, 'village');
  },
  score: (ctx) => Math.round(55 + Math.max(0, 1 - ctx.data.gs / gullCourse().len) * 180),
};

/* ================================================================== *
 * 5. Moo-ving Day
 *
 * The carrier's deck is 1.5 km of steel at 104 m; the Skylark stops in a
 * few hundred metres, so the landing is generous. The mood meter is the
 * medevac pulse with a cow in it: it never fails you, it only moos.
 * ================================================================== */

const T_COW = new THREE.Vector3();

function deckTarget(ctx) {
  const c = ctx.sim.carrier;
  if (!c) return null;
  return T_COW.set(c.pos.x, c.deckY || 104, c.pos.z);
}

function onDeck(ctx) {
  const c = ctx.sim.carrier;
  if (!c) return false;
  const p = ctx.ac.pos;
  return Math.abs(p.x - c.pos.x) <= c.halfWidth && Math.abs(p.z - c.pos.z) <= c.halfDepth && Math.abs(p.y - (c.deckY || 104)) < 8;
}

const MOOS = [
  'MOOOO! (Daisy did not enjoy that turn.)',
  'Daisy says "moo". That means "steady on!"',
  'Daisy has closed her eyes and is thinking about grass.',
  'MOO! Daisy would like a smoother ride, please.',
];

const cow = {
  id: 'goofy-cow',
  category: 'goofy',
  game: 'flight',
  name: 'Moo-ving Day',
  short: 'Land on the carrier with a cow aboard',
  difficulty: 'Medium',
  icon: '🐄',
  /*
   * Task Force Resolute — the carrier group's own map (the owner, 2026-10-02:
   * "carrier ops on the carrier maps"). You take off from the shore base's
   * 450 m strip (flat at 71 m from 100 m before the start to 300 m past the
   * far end, measured in node) and the ship is 6.3 km east, read live as
   * ever (deckTarget).
   */
  map: 'carriergroup',
  aircraft: 'skylark',
  blurb:
    'The sailors on the aircraft carrier want fresh milk, so Daisy the cow is moving in. She has never flown '
    + 'before and she HATES steep turns. Fly her out from the task force\'s shore base to the ship and land on the deck without upsetting her.',
  reward: 'Teaches gentle flying and landing somewhere that is not a runway.',
  weather: CALM,
  parTime: 420,
  onStart(ctx) {
    missionProps(ctx.sim, 'goofy-cow');
    ctx.data.grump = 0;
    ctx.data.peak = 0;
    ctx.data.mooT = 0;
    markUi();
  },
  tick(ctx, dt) {
    if (!currentProps('goofy-cow')) return;
    const ac = ctx.ac;
    if (ac.onGround && !airborne(ctx)) {
      ctx.data.grump = Math.max(0, ctx.data.grump - dt * 4);
    } else {
      // What a cow feels: bank past a comfortable 30 degrees, and g.
      const bank = Math.abs(ac.bankAngleDeg());
      const g = Math.abs((ac.gLoad || 1) - 1);
      const stress = Math.max(0, bank - 30) * 0.9 + Math.max(0, g - 0.25) * 60;
      ctx.data.grump = Math.max(0, Math.min(100, ctx.data.grump + (stress - 5) * dt));
      ctx.data.mooT -= dt;
      if ((bank > 42 || g > 0.7) && ctx.data.mooT <= 0) {
        ctx.data.mooT = 6;
        SFX.moo(ctx.sim, 0.9 + Math.random() * 0.25);
        notify(ctx, MOOS[Math.floor(Math.random() * MOOS.length)], 'warn', 3.5);
      }
    }
    ctx.data.peak = Math.max(ctx.data.peak, ctx.data.grump);
    const m = ctx.data.grump;
    if (uiTick(ctx, dt)) UI.showMeter(ctx.sim, {
      label: "Daisy's mood",
      value: 1 - m / 100,
      text: m < 25 ? 'Happy' : m < 55 ? 'A bit grumpy' : 'VERY grumpy',
      tone: m < 25 ? 'good' : m < 55 ? 'warn' : 'bad',
    });
  },
  steps: [
    {
      id: 'takeoff',
      text: 'Daisy the cow is strapped into the back seat. Take off — gently!',
      hint: 'A gentle take-off is a happy cow. Ease back on S, do not yank it.',
      atc: { text: 'Skylark one seven two, Task Force Tower, cleared for take-off. Is that a cow?', voice: 'tower' },
      targetLabel: 'Carrier',
      target: deckTarget,
      check: airborne,
    },
    {
      id: 'fly',
      text: 'Fly out to the aircraft carrier, east of the island among the escort ships. Keep your turns gentle — Daisy is watching.',
      hint: 'Small bank angles. The meter shows how Daisy is feeling.',
      targetLabel: 'Carrier',
      target: deckTarget,
      check: (ctx) => {
        const t = deckTarget(ctx);
        return !!t && flat(ctx.ac.pos, t) < 2500;
      },
    },
    {
      id: 'land',
      text: "Land on the carrier's deck. It is enormous — line up with it, slow down, flaps down, and put her down gently.",
      hint: 'The deck is about 340 feet above the sea. Aim for the near end and come down steadily.',
      atc: { text: 'Skylark one seven two, Resolute. Deck is clear. We have a bucket ready. For the milk.', voice: 'tower' },
      targetLabel: 'The deck',
      target: deckTarget,
      check: (ctx) => onDeck(ctx) && ctx.ac.onGround && ctx.ac.groundSpeed < 3,
    },
  ],
  onComplete(ctx) {
    UI.hideMeter();
    const pr = currentProps('goofy-cow');
    if (pr) {
      // Daisy walks out onto the deck to meet the sailors.
      const d = P.makeCow();
      d.scale.setScalar(1.6);
      ctx.ac.forward(V1).setY(0).normalize();
      V2.set(V1.z, 0, -V1.x);
      d.position.copy(ctx.ac.pos).addScaledVector(V2, 9).addScaledVector(V1, 4);
      d.position.y = (ctx.sim.carrier && ctx.sim.carrier.deckY) || ctx.ac.pos.y;
      pr.group.add(d);
    }
    SFX.moo(ctx.sim, 1.1);
    SFX.cheer(ctx.sim, 2, 0.8);
    ctx.sim.speak('Skylark one seven two, the cow is aboard. The sailors have never been so happy. Or so confused.', 'tower');
  },
  score: (ctx) => {
    const l = ctx.data.lastTouchdown;
    return Math.round(Math.max(0, 1 - ctx.data.peak / 100) * 55 + (l ? l.score : 40) * 0.45);
  },
};

/* ================================================================== *
 * 6. Close Encounter of the Silly Kind
 * ================================================================== */

const UFO_SPOTS = [
  [-1800, -1600, 300],
  [1350, 1400, 260],
  [2000, -700, 300],
];
const BEACH = new THREE.Vector3(0, 0, 2200);
const T_UFO = new THREE.Vector3();

function ufoSpot(i, out) {
  const [x, z, h] = UFO_SPOTS[i];
  return out.set(x, surface(x, z) + h, z);
}

function ufoSighting(i) {
  return (ctx) => {
    const u = ctx.data.ufo;
    if (!u || ctx.data.zip) return false;
    if (ctx.ac.pos.distanceTo(u.position) < 650) {
      if (i < UFO_SPOTS.length - 1) {
        // Off it goes, to the next place.
        ctx.data.zip = { t: 0, from: u.position.clone(), to: ufoSpot(i + 1, new THREE.Vector3()) };
        SFX.whoosh(ctx.sim);
        notify(ctx, 'WHOOSH! It zoomed off! After it!', 'warn', 3);
      } else {
        u.userData.sign.visible = true;
        SFX.whoosh(ctx.sim);
        UI.showCard(ctx.sim, {
          who: 'The alien',
          tone: 'good',
          text: 'Blip blorp! (That means: hello. Also, WHERE IS THE BEACH? Please show me the way!)',
          ttl: 14,
        });
      }
      return true;
    }
    return false;
  };
}

const ufo = {
  id: 'goofy-ufo',
  category: 'goofy',
  game: 'flight',
  name: 'Close Encounter of the Silly Kind',
  short: 'Find the UFO. Then help it.',
  difficulty: 'Medium',
  icon: '🛸',
  map: 'kestrel',
  aircraft: 'skylark',
  blurb:
    'People keep phoning the tower about a glowing saucer over the island. Every time somebody gets close, '
    + 'it zooms off somewhere else. Find it — and find out what it actually wants.',
  reward: 'Teaches flying to a moving target, then leading something that follows you.',
  weather: { time: 'sunset', condition: 'clear', windSpeedKts: 4, windDirDeg: 90 },
  parTime: 420,
  onStart(ctx) {
    const pr = missionProps(ctx.sim, 'goofy-ufo');
    const u = P.makeUfo();
    ufoSpot(0, u.position);
    pr.group.add(u);
    ctx.data.ufo = u;
    ctx.data.zip = null;
    ctx.data.t = 0;
    ctx.data.hum = addLoop(new SFX.Loop(ctx.sim, 'hum', 0.05));
    markUi();
  },
  tick(ctx, dt) {
    const u = ctx.data.ufo;
    if (!u || !currentProps('goofy-ufo')) return;
    ctx.data.t += dt;
    const t = ctx.data.t;
    u.userData.ring.rotation.y += dt * 2.4;
    u.userData.alien.rotation.y = Math.sin(t * 0.7) * 0.6;
    const step = ctx.runner.step;
    const leading = step && step.id === 'lead';
    if (ctx.data.zip) {
      // Zipping off: fast, in an arc, like they do in films.
      const z = ctx.data.zip;
      z.t += dt / 2.4;
      const k = Math.min(1, z.t);
      const e = k * k * (3 - 2 * k);
      u.position.lerpVectors(z.from, z.to, e);
      u.position.y += Math.sin(k * Math.PI) * 260;
      if (k >= 1) ctx.data.zip = null;
    } else if (leading) {
      // Following you, a little behind and above, never into a hill.
      ctx.ac.forward(V1);
      V2.copy(ctx.ac.pos).addScaledVector(V1, -110);
      V2.y += 30;
      const floor = surface(V2.x, V2.z) + 45;
      if (V2.y < floor) V2.y = floor;
      u.position.lerp(V2, 1 - Math.exp(-dt * 1.6));
    } else {
      u.position.y += Math.sin(t * 1.4) * 0.15;
    }
    u.userData.beam.visible = !ctx.data.zip && !leading;
    if (ctx.data.hum) ctx.data.hum.set(SFX.falloff(ctx.ac.pos.distanceTo(u.position), 60, 900), dt);
  },
  steps: [
    {
      id: 'takeoff',
      text: 'Somebody has spotted a glowing saucer over the island. Take off and have a look.',
      hint: 'Full power with Shift, and ease back on S at 55 knots.',
      atc: { text: 'Skylark one seven two, Kestrel Tower. We have had forty phone calls about a UFO. Please go and look. Cleared for take-off.', voice: 'tower' },
      targetLabel: 'UFO',
      target: (ctx) => (ctx.data.ufo ? T_UFO.copy(ctx.data.ufo.position) : null),
      check: airborne,
    },
    {
      id: 'spot1',
      text: 'The UFO was last seen over the hills to the north-west. Get close to it!',
      hint: 'Follow the arrow. It is the big glowing thing. You cannot miss it. (You can miss it.)',
      targetLabel: 'UFO',
      target: (ctx) => (ctx.data.ufo ? T_UFO.copy(ctx.data.ufo.position) : null),
      check: ufoSighting(0),
    },
    {
      id: 'spot2',
      text: 'It zoomed off to the hills in the south! After it!',
      hint: 'It is hovering again. Sneak up on it.',
      targetLabel: 'UFO',
      target: (ctx) => (ctx.data.ufo ? T_UFO.copy(ctx.data.ufo.position) : null),
      check: ufoSighting(1),
    },
    {
      id: 'spot3',
      text: 'Now it has gone to the east end of the island. Third time lucky!',
      hint: 'Get within about 600 metres of it.',
      targetLabel: 'UFO',
      target: (ctx) => (ctx.data.ufo ? T_UFO.copy(ctx.data.ufo.position) : null),
      check: ufoSighting(2),
    },
    {
      id: 'lead',
      text: 'The alien just wants to go to the BEACH! Lead the UFO to the beach on the south shore — it will follow you.',
      hint: 'Fly to the arrow and come down below 1,500 feet over the sand.',
      targetLabel: 'The beach',
      target: () => T_UFO.set(BEACH.x, surface(BEACH.x, BEACH.z) + 200, BEACH.z),
      check: (ctx) => {
        const ok = flat(ctx.ac.pos, BEACH) < 700 && ft(ctx.ac.agl) < 1500;
        if (ok) {
          const u = ctx.data.ufo;
          u.position.set(BEACH.x + 30, surface(BEACH.x + 30, BEACH.z) + 4, BEACH.z);
          u.userData.shades.visible = true;
          u.userData.sign.visible = false;
          u.userData.beam.visible = false;
          SFX.cheer(ctx.sim, 1.8, 0.7);
          UI.showCard(ctx.sim, {
            who: 'The alien',
            tone: 'good',
            text: 'BLIP BLORP! Thank you, Earth pilot! (It has put on sunglasses. It is staying for a week.)',
            ttl: 10,
          });
        }
        return ok;
      },
    },
  ],
  onComplete(ctx) {
    ctx.sim.speak('Skylark one seven two, Kestrel Tower. We have one new holiday visitor on the beach. It says blip blorp.', 'tower');
  },
  score: (ctx) => Math.round(60 + Math.max(0, 1 - ctx.elapsed / 600) * 40),
};

/* ================================================================== *
 * 7. S'mores on Mount Ember
 *
 * On Ember Isle. The cone's ash column starts inside 962 m of the crater
 * (main.js, updateVolcano), so the warm band is 1,150 - 1,950 m out and
 * 450 - 1,100 m up — measured ground there is 60 to 330 m, so the band is
 * at least 120 m clear of the slope everywhere. Too close (under 1,050 m)
 * and the marshmallow catches fire, which is the joke, not a failure.
 * A side toasts in 32 s in the band: about a third of a lap.
 * ================================================================== */

const CRATER = new THREE.Vector3(2500, 0, -2400);
const T_SMORE = new THREE.Vector3();

/*
 * Ember erupts on its own every four to ten minutes, and the eruption
 * roughens the engine wherever you are. That is right for the Ember map and
 * wrong in the middle of making s'mores, so while this mission runs the
 * volcano's clock is kept at zero.
 *
 * main.js has no public way to say "not now", so this writes its eruption
 * clock, sim._eruptT (updateVolcano: `this._eruptT = (this._eruptT || 0) + dt`).
 * It used to set sim._nextErupt = 1200 as well, which outlived the mission:
 * the next flight on Ember went twenty minutes without an eruption. Holding
 * the clock at zero every frame needs only the one field and leaves nothing
 * behind. If main.js renames it this stops working, so the browser check
 * (tests/features/events.browser.js) asserts the field is still main.js's
 * eruption clock — a rename turns that check red instead of going quiet.
 */
export function holdEruption(sim) {
  if (sim && (sim._eruptT === undefined || typeof sim._eruptT === 'number')) sim._eruptT = 0;
}
const TOAST_SECS = 32;

/** The point on the warm ring nearest the aeroplane, a little ahead of it in the direction you are circling. */
function ringTarget(ctx) {
  const p = ctx.ac.pos;
  let a = Math.atan2(p.x - CRATER.x, p.z - CRATER.z);
  // `dir` is the sign of the turn measure in tick(), which runs opposite to
  // this angle — so "ahead" is a decrease for a positive dir.
  a -= (ctx.data.dir || 1) * 0.45;
  return T_SMORE.set(CRATER.x + Math.sin(a) * 1550, 750, CRATER.z + Math.cos(a) * 1550);
}

const smores = {
  id: 'goofy-smores',
  category: 'goofy',
  game: 'flight',
  name: "S'mores on Mount Ember",
  short: 'Toast a giant marshmallow on a volcano',
  difficulty: 'Medium',
  icon: '🔥',
  map: 'ember',
  aircraft: 'skylark',
  blurb:
    'The campers on Ember Isle want s’mores, and the only fire big enough for their giant marshmallow is '
    + 'the volcano. Circle Mount Ember to toast it golden — both sides — without setting it on fire.',
  reward: 'Teaches holding a distance and a height while you turn, in both directions.',
  weather: { time: 'day', condition: 'clear', windSpeedKts: 5, windDirDeg: 200 },
  spawn: { pos: new THREE.Vector3(-400, 0, -600), headingDeg: 58, speed: 58, altAGL: 520 },
  parTime: 420,
  onStart(ctx) {
    const pr = missionProps(ctx.sim, 'goofy-smores');
    const m = P.makeMarshmallow();
    m.scale.setScalar(1.5);
    pr.group.add(m);
    ctx.data.mm = m;
    ctx.data.a = 0;
    ctx.data.b = 0;
    ctx.data.side = 'a';
    ctx.data.dir = 0;
    ctx.data.burnT = 0;
    ctx.data.fireT = 0;
    ctx.data.burns = 0;
    ctx.data.wrongT = 0;
    holdEruption(ctx.sim);
    markUi();
  },
  tick(ctx, dt) {
    holdEruption(ctx.sim);
    const m = ctx.data.mm;
    if (!m || !currentProps('goofy-smores')) return;
    const ac = ctx.ac;
    // Hang it under the aeroplane on its stick.
    ac.up(V1);
    ac.forward(V2);
    m.position.copy(ac.pos).addScaledVector(V1, -5.4).addScaledVector(V2, 1.2);
    m.quaternion.copy(ac.quat);

    const dx = ac.pos.x - CRATER.x;
    const dz = ac.pos.z - CRATER.z;
    const r = Math.hypot(dx, dz);
    const y = ac.pos.y;
    // Which way round: the sign of (position x velocity) about the crater.
    const turn = (dx * ac.vel.z - dz * ac.vel.x) / Math.max(1, r * r);
    const circling = Math.abs(turn) > 0.006;
    const warm = r > 1150 && r < 1950 && y > 450 && y < 1100;
    const tooHot = r < 1050 && y < 1500;
    const step = ctx.runner.step;
    const toasting = step && (step.id === 'toastA' || step.id === 'toastB');

    if (ctx.data.fireT > 0) {
      ctx.data.fireT -= dt;
      m.userData.setBurning(true);
      m.userData.flame.scale.setScalar(4 + Math.sin(ctx.elapsed * 20) * 0.8);
      if (ctx.data.fireT <= 0) {
        m.userData.setBurning(false);
        notify(ctx, 'Here is a fresh marshmallow. Not so close this time!', 'info', 3.5);
      }
    } else if (tooHot && toasting) {
      ctx.data.burnT += dt;
      if (ctx.data.burnT > 1.5) {
        ctx.data.burnT = 0;
        ctx.data.fireT = 2.5;
        ctx.data.burns++;
        if (ctx.data.side === 'a') ctx.data.a = 0;
        else ctx.data.b = 0;
        SFX.whoosh(ctx.sim);
        notify(ctx, 'WHOOSH! Your marshmallow caught fire! Too close to the lava!', 'warn', 4);
      }
    } else {
      ctx.data.burnT = Math.max(0, ctx.data.burnT - dt);
    }

    if (toasting && warm && circling && ctx.data.fireT <= 0) {
      const dir = turn > 0 ? 1 : -1;
      if (ctx.data.side === 'a') {
        ctx.data.dir = dir;
        ctx.data.a = Math.min(1, ctx.data.a + dt / TOAST_SECS);
      } else if (dir === -ctx.data.aDir) {
        ctx.data.dir = dir;
        ctx.data.b = Math.min(1, ctx.data.b + dt / TOAST_SECS);
      } else {
        ctx.data.wrongT -= dt;
        if (ctx.data.wrongT <= 0) {
          ctx.data.wrongT = 8;
          notify(ctx, 'Same side again! Turn round and circle the OTHER way.', 'warn', 4);
        }
      }
    }
    m.userData.setToast(ctx.data.a, ctx.data.b);
    const side = ctx.data.side === 'a' ? ctx.data.a : ctx.data.b;
    if (toasting && uiTick(ctx, dt)) {
      UI.showMeter(ctx.sim, {
        label: ctx.data.side === 'a' ? 'Toasting side 1' : 'Toasting side 2 (the other way round!)',
        value: side,
        text: tooHot ? 'TOO HOT!' : warm ? `${Math.round(side * 100)}%` : 'Not warm enough',
        tone: tooHot ? 'bad' : warm ? 'good' : 'warn',
      });
    }
  },
  steps: [
    {
      id: 'fly',
      text: 'Fly to Mount Ember with the giant marshmallow. The volcano is the big mountain to the north-east.',
      hint: 'Follow the arrow. Climb to about 2,000 feet on the way.',
      atc: { text: 'Skylark one seven two, Ember Tower. The campers have their biscuits and chocolate ready. They are counting on you.', voice: 'tower' },
      targetLabel: 'Mount Ember',
      target: (ctx) => ringTarget(ctx),
      check: (ctx) => flat(ctx.ac.pos, CRATER) < 2100,
    },
    {
      id: 'toastA',
      text: 'Circle the mountain in the warm zone to toast one side golden. The meter fills while you are in it.',
      hint: 'Stay 1.2 to 1.9 km from the crater, and between 1,500 and 3,500 feet. Closer than that and it catches fire!',
      targetLabel: 'Warm zone',
      target: (ctx) => ringTarget(ctx),
      check: (ctx) => {
        if (ctx.data.a < 1) return false;
        ctx.data.aDir = ctx.data.dir;
        ctx.data.side = 'b';
        ctx.data.dir = -ctx.data.dir;
        notify(ctx, 'Golden! Now turn the marshmallow over...', 'good', 3);
        return true;
      },
    },
    {
      id: 'toastB',
      text: 'Now the other side: turn round and circle the mountain the OTHER way.',
      hint: 'Make a big U-turn, then keep the mountain on your other wing.',
      targetLabel: 'Warm zone',
      target: (ctx) => ringTarget(ctx),
      check: (ctx) => ctx.data.b >= 1,
    },
    {
      id: 'deliver',
      text: 'Toasted to perfection! Fly it back to the campers at the airfield and land on the runway.',
      hint: 'The airfield is south-west of the mountain. Follow the arrow.',
      enter: () => UI.hideMeter(),
      targetLabel: 'Runway',
      target: () => RUNWAY.touchdown,
      check: landed,
    },
  ],
  onComplete(ctx) {
    UI.hideMeter();
    SFX.cheer(ctx.sim, 2.2, 0.9);
    ctx.sim.speak("Skylark one seven two, the campers say that is the best s'more anybody has ever made.", 'tower');
  },
  score: (ctx) => {
    const l = ctx.data.lastTouchdown;
    return Math.round(Math.max(0, 50 - ctx.data.burns * 12) + (l ? l.score : 40) * 0.5);
  },
};

/* ================================================================== *
 * 8. Loop-the-Loop at the Fete
 *
 * Measured on the flight model with S held and full power: from 180 m/s the
 * Vanguard is round in 21 s, from 150 m/s (the spawn speed, about 290 kt)
 * in 26 s with the top 880 m up and only 29 kt left over it, and from
 * 120 m/s it does not make it over at all — it goes vertical and falls out.
 * So the words ask for 300 knots before the pull, and the meter says so
 * until you have it. It ends no lower than it started. A loop is counted when the nose has
 * gone past 55 degrees up, the aeroplane has been upside down, and it comes
 * back upright with at least 280 degrees of pitch turned — a steep turn
 * piles up pitch rate too, but it never points the nose at the sky.
 * ================================================================== */

const FETE = new THREE.Vector3(700, 0, 620);
const T_FETE = new THREE.Vector3();

function loopDetector(ctx, dt) {
  const L = ctx.data.loop;
  const ac = ctx.ac;
  ac.forward(V1);
  ac.up(V2);
  const pitch = Math.asin(Math.max(-1, Math.min(1, V1.y)));
  if (L.state === 0) {
    if (pitch > 55 * DEG) {
      L.state = 1;
      L.cum = 0;
      L.t = 0;
    }
    return false;
  }
  L.cum += ac.omega.x * dt;
  L.t += dt;
  if (L.state === 1) {
    if (V2.y < -0.3) L.state = 2;
    else if (pitch < 20 * DEG && L.t > 2) {
      L.state = 0;
      notify(ctx, 'Keep pulling — all the way over the top!', 'info', 3);
    }
    return false;
  }
  if (V2.y > 0.5 && pitch < 30 * DEG && pitch > -46 * DEG && L.cum > 280 * DEG) {
    L.state = 0;
    return true;
  }
  if (L.t > 50) L.state = 0;
  return false;
}

const loops = {
  id: 'goofy-loops',
  category: 'goofy',
  game: 'flight',
  name: 'Loop-the-Loop at the Fete',
  short: 'Two loops with rainbow smoke',
  difficulty: 'Medium',
  icon: '🌈',
  map: 'kestrel',
  aircraft: 'vanguard',
  blurb:
    'It is the Kestrel school fete, and the head teacher has promised everybody a loop-the-loop. You are the '
    + 'loop-the-loop. The fighter has been fitted with rainbow smoke. Do not let the head teacher down.',
  reward: 'Teaches the loop: speed first, then a steady pull all the way round.',
  weather: CALM,
  spawn: { pos: new THREE.Vector3(-4200, 0, 900), headingDeg: 90, speed: 150, altAGL: 540 },
  parTime: 200,
  onStart(ctx) {
    const pr = missionProps(ctx.sim, 'goofy-loops');
    const spot = clearSpot(FETE.x, FETE.z, 24, 500);
    ctx.data.fete = spot;
    const party = P.makeParty();
    party.position.copy(spot);
    pr.group.add(party);
    const sign = P.makeSign(['KESTREL', 'SCHOOL FETE'], { width: 48, border: '#7ee8b2' });
    sign.position.set(spot.x, spot.y + 45, spot.z);
    pr.group.add(sign);
    const smoke = P.makeSmokeTrail(420);
    pr.group.add(smoke.mesh);
    ctx.data.smoke = smoke;
    ctx.data.emitT = 0;
    ctx.data.loop = { state: 0, cum: 0, t: 0 };
    ctx.data.loops = 0;
    markUi();
  },
  tick(ctx, dt) {
    const smoke = ctx.data.smoke;
    if (!smoke || !currentProps('goofy-loops')) return;
    ctx.data.emitT -= dt;
    if (ctx.data.emitT <= 0 && !ctx.ac.onGround) {
      ctx.data.emitT = 0.07;
      ctx.ac.forward(V1);
      V3.copy(ctx.ac.pos).addScaledVector(V1, -7);
      smoke.emit(V3);
    }
    smoke.update(dt);
    const step = ctx.runner.step;
    if (step && (step.id === 'loop1' || step.id === 'loop2')) {
      if (loopDetector(ctx, dt)) {
        ctx.data.loops++;
        SFX.cheer(ctx.sim, 2, 0.9);
        notify(ctx, ctx.data.loops === 1 ? 'LOOP! The crowd goes wild!' : 'ANOTHER ONE! They are chanting your name!', 'good', 4);
      }
      const L = ctx.data.loop;
      if (uiTick(ctx, dt)) UI.showMeter(ctx.sim, {
        label: `Loop ${Math.min(2, ctx.data.loops + 1)} of 2`,
        value: L.state === 0 ? 0 : Math.min(1, Math.max(0, L.cum) / (2 * Math.PI)),
        text: L.state === 0
          ? (ctx.ac.ias * 1.94384 < 290 ? 'Speed up first — 300 kt' : 'Pull up now!')
          : L.state === 1 ? 'Keep pulling…' : 'Over the top!',
        tone: L.state === 2 ? 'good' : 'info',
      });
    }
  },
  steps: [
    {
      id: 'arrive',
      text: 'Smoke on! Fly to the school fete in Kestrel town — the arrow shows the way.',
      hint: 'Keep your speed up. You will need it for the loop.',
      atc: { text: 'Vanguard zero one, Kestrel Tower. The fete can see your smoke already. Several children are screaming. Happily.', voice: 'tower' },
      targetLabel: 'The fete',
      target: (ctx) => T_FETE.copy(ctx.data.fete || FETE).setY((ctx.data.fete ? ctx.data.fete.y : 40) + 600),
      check: (ctx) => flat(ctx.ac.pos, ctx.data.fete || FETE) < 2500,
    },
    {
      id: 'loop1',
      text: 'Loop-the-loop! Get your speed up past 300 knots, then pull back on S and KEEP pulling, all the way round.',
      hint: 'Full power, and at least 1,500 feet up. Hold S the whole way round — it takes about 25 seconds, and it goes very slow at the top. Keep holding!',
      targetLabel: 'The fete',
      target: (ctx) => T_FETE.copy(ctx.data.fete || FETE).setY((ctx.data.fete ? ctx.data.fete.y : 40) + 600),
      check: (ctx) => ctx.data.loops >= 1,
    },
    {
      id: 'loop2',
      text: 'The crowd loved it! They want ANOTHER one! Same again: speed, then pull all the way round.',
      hint: 'Let the speed build back up before you start pulling.',
      targetLabel: 'The fete',
      target: (ctx) => T_FETE.copy(ctx.data.fete || FETE).setY((ctx.data.fete ? ctx.data.fete.y : 40) + 600),
      check: (ctx) => ctx.data.loops >= 2,
    },
  ],
  onComplete(ctx) {
    UI.hideMeter();
    ctx.sim.speak('Vanguard zero one, the head teacher says that was the best fete ever. She would like you back next year.', 'tower');
  },
  score: (ctx) => Math.round(70 + Math.max(0, 1 - ctx.elapsed / 360) * 30),
};

/* ================================================================== *
 * 9. Ice Cream Emergency
 *
 * Altitude is the resource: it melts at 1/220 of the cone a second at sea
 * level and 1/600 at 2,500 ft and above. The spawn is at 2,000 ft 4.8 km out.
 * Worked through on the flight model (tests/features/events.mjs): a
 * sensible flight arrives with about half the cone left and room for one
 * missed drop; flying it all low melts a third more. The first rates
 * (1/170 and 1/460) left 37% after a good flight and nothing at all after
 * one miss — a mission you had to get right first time.
 * ================================================================== */

const T_ICE = new THREE.Vector3();

function meltRate(yMetres) {
  const k = Math.max(0, Math.min(1, ft(yMetres) / 2500));
  return 1 / 220 + (1 / 600 - 1 / 220) * k;
}

const icecream = {
  id: 'goofy-icecream',
  category: 'goofy',
  game: 'flight',
  name: 'Ice Cream Emergency',
  short: 'Deliver it before it melts',
  difficulty: 'Medium',
  icon: '🍦',
  // Coral Atoll: the hottest day of the year belongs on the reef, and the delivery pad is on Turtle Cay (maps.js deliveryPad).
  map: 'atoll',
  aircraft: 'skylark',
  blurb:
    'It is the hottest day of the year and the children of Turtle Cay have run out of ice cream. You have the '
    + 'biggest ice cream cone in the world. It is melting. Luckily, the higher you fly, the cooler the air.',
  reward: 'Teaches that air gets colder as you climb — about 2 degrees every 1,000 feet.',
  weather: { time: 'day', condition: 'clear', windSpeedKts: 4, windDirDeg: 140 },
  // Over the sea north of Long Cay, pointing at Turtle Cay (bearing 155 from here; measured in node).
  spawn: { pos: new THREE.Vector3(2400, 0, -2200), headingDeg: 155, speed: 58, altAGL: 640 },
  parTime: 240,
  onStart(ctx) {
    missionProps(ctx.sim, 'goofy-icecream');
    ctx.sim.hasCargo = true;
    ctx.data.melt = 0;
    ctx.data.misses = 0;
    ctx.data.delivered = false;
    markUi();
  },
  tick(ctx, dt) {
    if (!currentProps('goofy-icecream')) return;
    const crate = ctx.sim.crate;
    if (crate && crate.group && !crate.group.userData.ice) {
      const ice = P.makeIceCream();
      ice.scale.setScalar(1.3);
      ice.position.y = 0.6;
      crate.group.add(ice);
      crate.group.userData.ice = ice;
      adopt(ice);
    }
    if (!ctx.data.delivered) {
      // Wherever the ice cream is: on the aeroplane, or under its parachute.
      const y = crate && !crate.landed ? crate.group.position.y : ctx.ac.pos.y;
      ctx.data.melt = Math.min(1, ctx.data.melt + meltRate(y) * dt);
    }
    if (crate && crate.group.userData.ice) crate.group.userData.ice.userData.setMelt(ctx.data.melt);
    const left = 1 - ctx.data.melt;
    if (uiTick(ctx, dt)) UI.showMeter(ctx.sim, {
      label: 'Ice cream left',
      value: left,
      text: `${Math.round(left * 100)}% · ${ft(ctx.ac.pos.y) > 1500 ? 'nice and cool' : 'warm down here!'}`,
      tone: left > 0.5 ? 'good' : left > 0.25 ? 'warn' : 'bad',
    });
  },
  failIf: (ctx) => (ctx.data.melt >= 1 ? 'The ice cream melted into a giant milkshake. The children drank it anyway — but it does not count!' : null),
  steps: [
    {
      id: 'cruise',
      text: 'Fly to Turtle Cay, south-east — and stay HIGH. It is cooler up there, so the ice cream melts more slowly.',
      hint: 'Keep above 2,000 feet until you are nearly there. The meter shows how much is left.',
      atc: { text: 'Skylark one seven two, Turtle Cay reports forty children and zero ice creams. Please hurry.', voice: 'village' },
      targetLabel: 'Turtle Cay',
      target: () => T_ICE.copy(DELIVERY_PAD).setY(DELIVERY_PAD.y + 200),
      check: (ctx) => flat(ctx.ac.pos, DELIVERY_PAD) < 1400,
    },
    {
      id: 'drop',
      text: 'Down you come! Press X just before the yellow target to drop the ice cream by parachute.',
      hint: 'Get down to about 500 feet above the target first. Let go a little early — it keeps some of your speed.',
      targetLabel: 'Drop target',
      target: () => T_ICE.copy(DELIVERY_PAD).setY(DELIVERY_PAD.y + 100),
      check: (ctx) => {
        const crate = ctx.sim.crate;
        if (!crate || !crate.landed) return false;
        const d = flat(crate.group.position, DELIVERY_PAD);
        if (d <= 110) {
          ctx.data.delivered = true;
          ctx.data.dropDistance = d;
          SFX.cheer(ctx.sim, 2.6, 1);
          notify(ctx, `Delivered! ${Math.round((1 - ctx.data.melt) * 100)}% of it is still ice cream!`, 'good', 5);
          return true;
        }
        ctx.data.misses++;
        notify(ctx, 'SPLAT! The seagulls are eating that one. Quick — here is another!', 'warn', 5);
        ctx.sim.removeCrate();
        ctx.sim.hasCargo = true;
        return false;
      },
    },
  ],
  onComplete(ctx) {
    UI.hideMeter();
    ctx.sim.speak('Skylark one seven two, the ice cream has landed! Everybody is getting a scoop. Thank you!', 'village');
  },
  score: (ctx) => Math.round((1 - ctx.data.melt) * 80 + Math.max(0, 20 - ctx.data.misses * 8)),
};

/* ================================================================== *
 * 10. Bubble Trouble
 *
 * Eighteen bubbles 40 m across, 170-335 m above the ground in three rings
 * round the island; you need twelve. A pop is any part of the aeroplane
 * within 42 m of a bubble's middle — generous on purpose, because hitting a
 * point in three dimensions at 60 m/s is the hard part and the arrow only
 * helps in two.
 * ================================================================== */

const BUBBLES = 18;
const NEED = 12;
const T_BUB = new THREE.Vector3();

function bubblePositions() {
  const out = [];
  for (let i = 0; i < BUBBLES; i++) {
    const a = (i / BUBBLES) * Math.PI * 2 + (i % 3) * 0.35;
    const r = 900 + (i % 3) * 700;
    const x = Math.sin(a) * r;
    const z = -Math.cos(a) * r;
    out.push(new THREE.Vector3(x, surface(x, z) + 170 + (i % 4) * 55, z));
  }
  return out;
}

const bubbles = {
  id: 'goofy-bubbles',
  category: 'goofy',
  game: 'flight',
  name: 'Bubble Trouble',
  short: 'Pop the giant bubbles',
  difficulty: 'Easy',
  icon: '🫧',
  map: 'kestrel',
  aircraft: 'skylark',
  blurb:
    'The bubble machine at the school science fair has gone a bit wrong. There are GIANT bubbles floating all '
    + 'over the island and they are getting in everybody’s way. Pop twelve of them by flying straight through.',
  reward: 'Teaches accurate flying: getting to an exact point at an exact height.',
  weather: CALM,
  parTime: 360,
  onStart(ctx) {
    const pr = missionProps(ctx.sim, 'goofy-bubbles');
    const mat = P.makeBubbleMaterial();
    ctx.data.bubbles = bubblePositions().map((p, i) => {
      const s = new THREE.Sprite(mat);
      s.position.copy(p);
      s.scale.setScalar(40);
      s.userData = { base: p.y, phase: i * 0.9, popT: -1 };
      pr.group.add(s);
      return s;
    });
    ctx.data.popped = 0;
    ctx.data.t = 0;
    markUi();
  },
  tick(ctx, dt) {
    const list = ctx.data.bubbles;
    if (!list || !currentProps('goofy-bubbles')) return;
    ctx.data.t += dt;
    const ac = ctx.ac;
    for (const b of list) {
      const u = b.userData;
      if (u.popT >= 0) {
        // Popping: a quick swell and gone.
        if (b.visible) {
          u.popT += dt;
          b.scale.setScalar(40 + u.popT * 160);
          if (u.popT > 0.2) b.visible = false;
        }
        continue;
      }
      b.position.y = u.base + Math.sin(ctx.data.t * 0.8 + u.phase) * 4;
      if (ac.pos.distanceTo(b.position) < 42) {
        u.popT = 0;
        ctx.data.popped++;
        SFX.pop(ctx.sim);
        notify(ctx, ctx.data.popped < NEED ? `POP! ${ctx.data.popped} of ${NEED}` : 'POP! That is twelve!', 'good', 2);
      }
    }
    if (uiTick(ctx, dt)) UI.showMeter(ctx.sim, {
      label: 'Bubbles popped',
      value: ctx.data.popped / NEED,
      text: `${Math.min(ctx.data.popped, NEED)} / ${NEED}`,
      tone: 'good',
    });
  },
  steps: [
    {
      id: 'takeoff',
      text: 'Giant bubbles are floating all over the island! Take off and go and pop some.',
      hint: 'Full power with Shift, and lift off gently with S.',
      atc: { text: 'Skylark one seven two, Kestrel Tower, cleared for take-off. Caution, bubbles.', voice: 'tower' },
      check: airborne,
    },
    {
      id: 'pop',
      text: 'Pop 12 giant bubbles by flying right through them! The arrow points at the nearest one.',
      hint: 'Line up early, match the bubble’s height, and fly straight through the middle.',
      targetLabel: 'Nearest bubble',
      target: (ctx) => {
        let best = null;
        let bd = Infinity;
        for (const b of ctx.data.bubbles || []) {
          if (b.userData.popT >= 0) continue;
          const d = ctx.ac.pos.distanceToSquared(b.position);
          if (d < bd) {
            bd = d;
            best = b;
          }
        }
        return best ? T_BUB.copy(best.position) : null;
      },
      check: (ctx) => ctx.data.popped >= NEED,
    },
  ],
  onComplete(ctx) {
    UI.hideMeter();
    SFX.cheer(ctx.sim, 2, 0.9);
    ctx.sim.speak('Skylark one seven two, the science fair says thank you. They have turned the bubble machine off. Mostly.', 'tower');
  },
  score: (ctx) => Math.round(60 + Math.max(0, 1 - ctx.elapsed / 480) * 40),
};

/* ================================================================== *
 * 11. Buzz Off!
 *
 * The bee wanders on a smooth path round the island, slower than the
 * Skylark's 66 m/s everywhere — measured, its fastest moment is about 45 and
 * it mostly potters at 25-35 — so keeping up is never the problem; staying
 * close to something slower and turning is. (The first path peaked at
 * 59 m/s, which is not a bee, it is a trainer with stripes.) The meter
 * counts seconds within 250 m and does not reset when you drift away, so an
 * overshoot costs you time and nothing else.
 * ================================================================== */

const T_BEE = new THREE.Vector3();
const FOLLOW_SECS = 40;
const FLOWER = new THREE.Vector3(-1200, 0, -1450);

function beeAt(t, out) {
  const x = 1400 * Math.sin(0.014 * t) + 300 * Math.sin(0.04 * t + 1);
  const z = 1100 * Math.sin(0.019 * t + 0.5) + 250 * Math.cos(0.045 * t);
  const floor = surface(x, z) + 160;
  out.set(x, Math.max(floor, 290 + 50 * Math.sin(0.07 * t)), z);
  return out;
}

const bee = {
  id: 'goofy-bee',
  category: 'goofy',
  game: 'flight',
  name: 'Buzz Off!',
  short: 'Follow the world’s biggest bee',
  difficulty: 'Easy',
  icon: '🐝',
  map: 'kestrel',
  aircraft: 'skylark',
  blurb:
    'The world’s biggest bumblebee has escaped from the Kestrel Insect Museum and is buzzing round the island. '
    + 'The scientists need somebody to follow it so they can see where it goes. It is very big. It is very fluffy.',
  reward: 'Teaches following another aircraft: staying close to something slower than you.',
  weather: CALM,
  parTime: 300,
  onStart(ctx) {
    const pr = missionProps(ctx.sim, 'goofy-bee');
    const b = P.makeBee();
    b.scale.setScalar(1.4);
    pr.group.add(b);
    ctx.data.bee = b;
    ctx.data.bt = 40;
    ctx.data.follow = 0;
    beeAt(ctx.data.bt, b.position);
    const spot = clearSpot(FLOWER.x, FLOWER.z, 14, 500);
    const f = P.makeFlower();
    f.scale.setScalar(1.6);
    f.position.copy(spot);
    pr.group.add(f);
    ctx.data.flower = f;
    ctx.data.buzz = addLoop(new SFX.Loop(ctx.sim, 'buzz', 0.04));
    markUi();
  },
  tick(ctx, dt) {
    const b = ctx.data.bee;
    if (!b || !currentProps('goofy-bee')) return;
    ctx.data.bt += dt;
    beeAt(ctx.data.bt, b.position);
    beeAt(ctx.data.bt + 0.5, V1);
    V1.sub(b.position);
    if (V1.lengthSq() > 1e-4) {
      V1.normalize();
      Q1.setFromUnitVectors(V2.set(0, 0, -1), V1);
      b.quaternion.slerp(Q1, 1 - Math.exp(-dt * 4));
    }
    b.userData.flap(ctx.data.bt);
    const d = ctx.ac.pos.distanceTo(b.position);
    if (ctx.data.buzz) ctx.data.buzz.set(SFX.falloff(d, 40, 700), dt);
    const step = ctx.runner.step;
    if (step && step.id === 'follow') {
      if (d < 250) ctx.data.follow += dt;
      if (uiTick(ctx, dt)) UI.showMeter(ctx.sim, {
        label: d < 250 ? 'Tracking the bee' : 'Too far away — get closer!',
        value: ctx.data.follow / FOLLOW_SECS,
        text: `${Math.floor(ctx.data.follow)} / ${FOLLOW_SECS} s`,
        tone: d < 250 ? 'good' : 'warn',
      });
    }
  },
  steps: [
    {
      id: 'takeoff',
      text: 'A giant bumblebee has escaped from the insect museum! Take off and find it.',
      hint: 'Full power with Shift, and lift off gently with S.',
      atc: { text: 'Skylark one seven two, Kestrel Tower. There is a bee on the radar. A big one. Cleared for take-off.', voice: 'tower' },
      targetLabel: 'The bee',
      target: (ctx) => (ctx.data.bee ? T_BEE.copy(ctx.data.bee.position) : null),
      check: airborne,
    },
    {
      id: 'find',
      text: 'Find the giant bee — follow the arrow. You will hear it before you see it.',
      hint: 'It flies around the island, a few hundred feet up.',
      targetLabel: 'The bee',
      target: (ctx) => (ctx.data.bee ? T_BEE.copy(ctx.data.bee.position) : null),
      check: (ctx) => !!ctx.data.bee && ctx.ac.pos.distanceTo(ctx.data.bee.position) < 450,
    },
    {
      id: 'follow',
      text: 'Follow that bee! Stay within 250 metres so the scientists can track it. The meter fills while you are close.',
      hint: 'You are faster than the bee. If you shoot past it, make a gentle S-turn and let it catch up.',
      targetLabel: 'The bee',
      target: (ctx) => (ctx.data.bee ? T_BEE.copy(ctx.data.bee.position) : null),
      check: (ctx) => {
        if (ctx.data.follow < FOLLOW_SECS) return false;
        // Home to the biggest flower on the island.
        const f = ctx.data.flower;
        if (f) ctx.data.bee.position.set(f.position.x, f.position.y + 30, f.position.z);
        SFX.cheer(ctx.sim, 1.8, 0.8);
        notify(ctx, 'The bee has landed on the biggest flower on the island. The scientists are delighted!', 'good', 5);
        return true;
      },
    },
  ],
  onComplete(ctx) {
    UI.hideMeter();
    ctx.sim.speak('Skylark one seven two, the museum says thank you. They are bringing a very big jar.', 'tower');
  },
  score: (ctx) => Math.round(60 + Math.max(0, 1 - ctx.elapsed / 420) * 40),
};

export const MISSIONS = [duck, balloon, tower, gulls, cow, ufo, smores, loops, icecream, bubbles, bee];

/**
 * The numbers the missions are balanced on, for tests/features/events.mjs,
 * which flies the real flight model in node and checks each one can still be
 * met — so the day somebody retunes the trainer, the test says which goofy
 * mission just became impossible instead of a child finding out.
 */
export const TUNING = {
  gullSpeed: GULL_SPEED,
  // The course the mission is pinned to (Condor's); the node test's sums hold for either island.
  raceLength: GULL_COURSES.condor.len,
  raceStart: GULL_COURSES.condor.pts[0],
  raceFinish: GULL_COURSES.condor.pts[GULL_COURSES.condor.pts.length - 1],
  raceCourses: GULL_COURSES,
  meltRate,
  iceSpawn: icecream.spawn,
  icePad: DELIVERY_PAD,
  toastSecs: TOAST_SECS,
  followSecs: FOLLOW_SECS,
  followRadius: 250,
  beeAt,
  bubbles: BUBBLES,
  bubblesNeeded: NEED,
  towerFlip: { maxDist: 650, minAgl: 180, maxAgl: 450, bank: 140 },
};
