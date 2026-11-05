/**
 * THE AEROPLANE MISSIONS' FUN PASS, laid over the defs in ../missions.js once
 * the menu is up (owner, Oct 3: "Make missions actually FUN", then "fun but
 * not corny"). Nothing here runs before the features land, so the first load
 * stays where tests/features/first-load.mjs wants it, and every field here is
 * a change to the mission as missions.js defines it: the medals, the twist,
 * the finale, and what the twist needs.
 *
 * Applied by ./index.js through patch(): plain fields replace the def's,
 * `steps` is by step id and field, so a step keeps everything not named here.
 */

import * as THREE from '../../vendor/three.module.js';
import { RUNWAY } from '../../world/airport.js';
import { heightAt } from '../../world/terrain.js';
import * as Fun from '../fun-kit.js';
import { patch } from './patch.js';
import {
  RUNWAY_START, ft, CONTACTS, PHOTO_POINTS, nearestOf, rangeTarget, carrierTarget, onCarrierDeck, nearestPhoto,
} from '../missions.js';

const ELEV = RUNWAY.elev;

/* ------------------------------------------------------------------ *
 * Fixtures for the fun pass (finish/missions-fun.md). Made once, here, so
 * no target() allocates a vector every frame.
 * ------------------------------------------------------------------ */

/** Where the circuit's lap begins, at lap height: the arrow's aim on the climb. */
const CIRCUIT_CLIMB_AIM = new THREE.Vector3(1600, ELEV + 460, -1000);

/**
 * Island Patrol's contacts are aeroplanes now, not points. Each starts where
 * CONTACTS said and orbits there; the second runs for it at T+150 and the
 * third turns away from anyone who closes from the front. `heading` is where
 * each is pointing when the mission opens.
 */
const CONTACT_PLAN = [
  { pos: CONTACTS[0], heading: 200, type: 'courier' },
  { pos: CONTACTS[1], heading: 90, type: 'meridian' },
  { pos: CONTACTS[2], heading: 20, type: 'courier' },
];
/** Live contact positions when the NPCs have not been made yet (tests in node, a slow model load). */
const CONTACT_SCRATCH = CONTACTS.map((p) => p.clone());

/**
 * Low-Level Recon's third point sits under a ridge with a lit mast beside it:
 * the ridge west of the point rises to 421 m (measured), the mast stands 90 m
 * tall 250 m east of it, and "below 500 feet over the point" threads the two.
 */
const RECON_MAST = { x: 3350, z: 2600, height: 90 };
const RECON_AIM = new THREE.Vector3();

/** Weapons Range: the called wind each run, and the second store's run. */
const RANGE_WIND = { dirMin: 250, dirMax: 290, ktsMin: 12, ktsMax: 18 };

/** The pilot's own three-word wind call: "two-seven-zero at one-five". */
function windWords(dirDeg, kts) {
  const digits = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const say = (n, pad) => String(Math.round(n)).padStart(pad, '0').split('').map((d) => digits[Number(d)]).join('-');
  return `${say((dirDeg + 360) % 360, 3)} at ${say(kts, 2)}`;
}

/**
 * How far the wind carries a store let go at `height` metres: the same law
 * markers.js PracticeBomb falls by (velocity relaxing towards half the wind
 * at 0.09/s), integrated over the fall. Shown on the score line so the wind
 * allowance is a number a child can learn, not a feeling.
 */
export function storeDrift(windMs, height) {
  const T = Math.sqrt((2 * Math.max(0, height)) / 9.81);
  const k = 0.09;
  return 0.5 * windMs * (T - (1 - Math.exp(-k * T)) / k);
}

function nearestContact(ctx) {
  // The live positions: the contacts fly (CONTACT_SCRATCH follows the NPCs in tick).
  return nearestOf(ctx, CONTACT_SCRATCH, ctx.data.seen || []);
}

/**
 * Carrier Qualification: a pass without a trap. A bolter is wheels on the
 * deck and then air under them again; a wave-off is into the groove and
 * out of it without touching. One pass counts once (eight seconds apart),
 * Paddles says what to do next three seconds later so it never talks over
 * the carrier-ops feature's own "Bolter, bolter, bolter", and the third
 * miss is left to failIf, which has the reason.
 */
function missedPass(ctx, kind) {
  const d = ctx.data;
  if (ctx.runner.elapsed - (d.lastPassAt == null ? -99 : d.lastPassAt) < 8) return;
  d.lastPassAt = ctx.runner.elapsed;
  d.passes = (d.passes || 0) + 1;
  const n = d.passes;
  if (n >= 3) return;
  const next = n === 1 ? 'two' : 'three';
  Fun.line(ctx, `${kind === 'bolter' ? 'Bolter' : 'Wave-off'} — pass ${n} of 3. Climb out, downwind, come round.`, 'warn', 5);
  Fun.sting(ctx, 'cut');
  Fun.own(ctx, {
    t: 0,
    update(dt) {
      this.t += dt;
      if (this.t < 3) return;
      this.done = true;
      Fun.say(
        ctx,
        kind === 'bolter'
          ? `Osprey two one, Paddles. Bolter. Clean up, climb out, downwind — pass ${next}.`
          : `Osprey two one, Paddles. That one counts. Downwind, set it up again — pass ${next}.`,
        'lso',
        1
      );
    },
    dispose() {},
  });
}

/**
 * Low-Level Recon's lit mast: a tall thin tower with a red lamp on top,
 * 250 m east of the third photo point, under the ridge. Owned by the mission
 * (fun-kit.js own()), so it goes when the mission does. No light source —
 * an emissive lamp reads as lit at night and costs nothing.
 */
function reconMast(ctx) {
  const sim = ctx.sim;
  if (!sim || !sim.scene) return null;
  const base = heightAt(RECON_MAST.x, RECON_MAST.z);
  const group = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 1.6, RECON_MAST.height, 8),
    new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.7, metalness: 0.4 })
  );
  pole.position.y = RECON_MAST.height / 2;
  group.add(pole);
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(2.4, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x3a0a0a, emissive: 0xff2a1a, emissiveIntensity: 2.2, roughness: 0.4 })
  );
  lamp.position.y = RECON_MAST.height + 1.5;
  group.add(lamp);
  group.position.set(RECON_MAST.x, base, RECON_MAST.z);
  sim.scene.add(group);
  const prop = {
    group,
    lamp,
    dispose() {
      sim.scene.remove(group);
      pole.geometry.dispose();
      pole.material.dispose();
      lamp.geometry.dispose();
      lamp.material.dispose();
    },
  };
  Fun.own(ctx, prop);
  return prop;
}

/**
 * Weapons Range: the i-th store has landed — score it, in metres, with the
 * wind allowance beside it (storeDrift, from the height and the wind it was
 * let go in, recorded by the mission's tick the frame it left the aeroplane).
 */
function scoreStore(ctx, i) {
  const crate = ctx.sim.crate;
  if (!crate || !crate.landed) return false;
  const d = ctx.data;
  if (d.misses.length <= i) {
    const bull = rangeTarget(ctx);
    const miss = Math.hypot(crate.mesh.position.x - bull.x, crate.mesh.position.z - bull.z);
    const drift = storeDrift(d.releaseWind || 0, d.releaseH || 0);
    d.misses.push(miss);
    d.drifts.push(drift);
    ctx.sim.hud.notify(
      `${miss < 40 ? 'Shack — ' : ''}${Math.round(miss)} m from the middle · wind allowance ${Math.round(drift)} m`,
      miss < 120 ? 'good' : 'warn',
      5
    );
    Fun.sting(ctx, miss < 40 ? 'score:near' : miss < 120 ? 'score:mid' : 'score:far');
  }
  return true;
}

/** One of the aircraft's own aural alerts (windshear, thud, …), only when sound is on. */
export function alertSound(ctx, name) {
  const sim = ctx.sim;
  if (!sim || !sim.audio || !sim.audio.available || !sim.settings || sim.settings.muted) return;
  const a = sim.audio.alerts;
  if (a && typeof a[name] === 'function') {
    try {
      a[name]();
    } catch (e) {
      /* an alert that cannot play is silence, not a crash */
    }
  }
}

/** Signed heading difference, -180..180. */
export const hdgDiff = (a, b) => ((a - b + 540) % 360) - 180;

/** Flat distance on the ground between two points. */
export const flatDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/*
 * Landing short of the runway, stopped: the fail that names the fix.
 *
 * Shared by the missions whose whole point is arriving with exactly enough —
 * the glide, the shear, the short wet runway. landedAndStopped() only ever
 * said "not on the runway, go round", which is right when you have a working
 * aeroplane and wrong when you have just lost the argument with the weather:
 * a child who sank into the approach lights needs to hear why, not to taxi.
 */
export function cameDownShort(ctx, margin = 60) {
  const ac = ctx.ac;
  return ac.onGround && ac.groundTime > 1 && ac.pos.x < RUNWAY.thresholdWest.x - margin && ac.groundSpeed < 6 && Math.abs(ac.pos.z - RUNWAY.thresholdWest.z) < 400;
}

patch('circuit', {
  finale: { view: 'tower', say: 'Nicely flown — welcome back.' },
  medals: { silver: 70, gold: 88, goldHint: 'A soft touchdown on the numbers, inside 5:00' },
  steps: {
    rotate: {
      targetLabel: 'Runway 09',
      target: () => RUNWAY.thresholdEast,
    },
    climb: {
      // Where the lap begins, at the height it wants: the arrow has somewhere to point on the climb.
      targetLabel: 'North point',
      target: () => CIRCUIT_CLIMB_AIM,
    },
  },
});

patch('delivery', {
  medals: { silver: 65, gold: 85, goldHint: 'Crate inside 20 m of the middle and a gentle landing' },
  /*
   * The twist: the wind gets up as you line up the drop. A gust front swings
   * it 40 degrees and half again as strong for the run — so the crate has to
   * be let go upwind of the pad, which is what the village tells you. The
   * retry-drop logic below is unchanged: a miss is another crate, not a fail.
   */
  beats: [
    {
      id: 'gust',
      step: 'descend',
      at: [2, 6],
      run: (ctx) => Fun.gust(ctx, { mult: 1.6, turnDeg: 40, secs: 30 }),
      say: { text: "Sea Bird, Mango Cay. Wind's picking up down here — aim upwind of the pad.", voice: 'village' },
      shake: 0.2,
      debrief: 'Gust at the drop — the wind swung 40° as you lined up',
    },
  ],
});

patch('storm', {
  medals: { silver: 70, gold: 88, goldHint: 'Hold the slope through the shear and touch down soft' },
  /*
   * The ATC's promise, kept. The tower said "wind shear reported on final"
   * from the first version of this mission and nothing ever happened. Now
   * it does: on final, below 600 feet, a microburst — sinking air and a
   * fifteen-knot swing — for twelve seconds. Add power and hold the slope
   * and you land; sit on the same power and you arrive in the approach
   * lights, and the fail says so (cameDownShort).
   */
  beats: [
    {
      id: 'shear',
      when: (ctx) =>
        ctx.runner.elapsed > 30
        && !ctx.ac.onGround
        && ft(ctx.ac.agl) < 600
        && ft(ctx.ac.agl) > 120
        && ctx.ac.pos.distanceTo(RUNWAY.touchdown) < 2600
        && Math.abs(hdgDiff(ctx.ac.heading, RUNWAY.headingDeg)) < 45,
      run: (ctx) => {
        Fun.shear(ctx, { down: 6, headwind: 10, secs: 12 });
        alertSound(ctx, 'windshear');
      },
      say: { text: 'Skylark one seven two, Kestrel Tower, wind shear reported short final, loss of one-five knots.', voice: 'tower', urgency: 1 },
      shake: 0.3,
      sting: 'hit',
      debrief: 'Wind shear on short final — handled',
    },
  ],
  failIf: (ctx) => {
    if (cameDownShort(ctx)) return 'Came down short of the runway — in wind shear, add power and hold the slope';
    /*
     * Sinking into the approach lights: said before the ground says it,
     * so the reason is the fix and not "you crashed". Only over LOW
     * ground (the sea, the flats): the ridge 450 m short of the threshold
     * is 32 m high and a perfect three-degree approach clears it by a
     * couple of metres, which must never read as "ran out of height".
     */
    const ac = ctx.ac;
    if (!ac.onGround && ctx.elapsed > 20 && ac.vs < 0 && ac.pos.x < RUNWAY.thresholdWest.x - 300 && Math.abs(ac.pos.z - RUNWAY.thresholdWest.z) < 300) {
      // Height over the SURFACE: `agl` over the sea is measured from the seabed.
      const ground = heightAt(ac.pos.x, ac.pos.z);
      const over = ac.pos.y - Math.max(0, ground);
      if (ground < RUNWAY.elev + 6 && over < 15) return 'Ran out of height short of the runway — in wind shear, add power and hold the slope';
    }
    return null;
  },
  steps: {
    brief: {
      text: 'The wind is from your left. Point the nose a little left of the runway to stay lined up.',
    },
  },
});

patch('deadstick', {
  medals: { silver: 70, gold: 88, goldHint: 'A gentle touchdown on the runway, straight out of the glide' },
  /*
   * The twist is small on purpose, because the mission is already the
   * twist: partway down the glide the wind gets up on the nose, which costs
   * range, and the tower tells you. A quarter of the glide is in hand
   * (see the spawn note), so it is survivable by flying the same 65 knots.
   */
  beats: [
    {
      id: 'wind',
      step: 'glide',
      at: [20, 40],
      when: (ctx) => ft(ctx.ac.agl) > 400,
      run: (ctx) => Fun.gust(ctx, { mult: 1.25, turnDeg: 0, secs: 25 }),
      say: { text: 'Skylark one seven two, wind is up, zero nine zero at one-five. Field is yours, emergency services rolling.', voice: 'tower', urgency: 1 },
      debrief: 'The wind got up in the glide — stretched it anyway',
    },
  ],
});

patch('emberrun', {
  medals: { silver: 70, gold: 88, goldHint: 'Lap and land inside 2:30, wings level on the runway' },
  /*
   * The twist, kept in its own block (the race job adds a `rival:` field to
   * this def beside it): rounding the north flank the mountain pulses. The
   * sky goes ash-dark for 25 seconds, the air shakes, and Ember Control
   * says to stay below two thousand — because above it the ash is thick
   * enough to make the engine cough (tick, below). Survivable: stay low.
   */
  beats: [
    {
      id: 'ash',
      step: 'lap2',
      at: [1, 4],
      run: (ctx) => {
        Fun.weatherTurn(ctx, 'stormy', 25, { rain: 0, fog: 0.00055, cloud: 1, turb: 0.9, gust: 0.6 });
        ctx.data.ashUntil = ctx.runner.elapsed + 25;
      },
      say: { text: 'Vanguard zero one, Ember Control. Eruption pulse, ash on the north flank — stay below two thousand.', voice: 'tower', urgency: 1 },
      shake: 0.5,
      sting: 'hit',
      debrief: 'Eruption pulse mid-lap — flew the ash below two thousand',
    },
  ],
  tick: (ctx) => {
    const d = ctx.data;
    if (!d.ashUntil || ctx.runner.elapsed > d.ashUntil || d.coughed) return;
    if (ft(ctx.ac.alt) > 2000) {
      d.coughed = true;
      Fun.cough(ctx, 6);
      Fun.line(ctx, 'Ash in the intake — get below two thousand', 'warn', 4);
    }
  },
  score: (ctx) => {
    const l = ctx.data.lastTouchdown;
    /*
     * Full marks for the clock at 2:20 or better, nothing at the limit.
     * It was 1 - elapsed/240, which gave a flawless 150-second lap 23 of
     * the 62 points on offer and made Gold arithmetically impossible.
     */
    const speed = Math.max(0, Math.min(1, 1 - (ctx.elapsed - 140) / 120));
    return Math.round(speed * 62 + (l ? l.score : 30) * 0.38);
  },
});

patch('medevac', {
  medals: { silver: 62, gold: 82, goldHint: 'Keep their pulse under 110 and touch down under 200 ft/min' },
  /*
   * The twist: the fog thickens on the way home. Visibility drops to about
   * eight hundred metres for a minute; the tower turns the runway lights
   * full bright, and you fly them in. Survivable by flying the instruments
   * — which is what the mission has been saying since the first line.
   */
  beats: [
    {
      id: 'fog',
      step: 'back',
      at: [25, 45],
      when: (ctx) => !ctx.ac.onGround,
      run: (ctx) => Fun.weatherTurn(ctx, 'rainy', 60, { fog: 0.0009, cloud: 0.95 }),
      say: { text: 'Skylark one seven two, Kestrel Tower, visibility eight hundred metres in fog. Runway lights full bright.', voice: 'tower', urgency: 1 },
      debrief: 'Fog thickened on the way home — flew the lights in',
    },
  ],
  steps: {
    back: {
      // The long half of the mission starts here, so a fail on the way home
      // offers "Try again from: Patient aboard" — on the pad, with the fuel
      // and the clock you had (fun-kit.js).
      checkpoint: 'Patient aboard',
    },
  },
});

patch('chaser', {
  medals: { silver: 70, gold: 88, goldHint: 'Three clean passes and a good landing in the wind' },
  // The end: the camera swings round you with the funnel behind.
  finale: { view: 'orbit', secs: 3 },
  /*
   * The near miss: the first time you are properly inside the outer band,
   * something goes past the wing. A jolt, a thud through the airframe
   * (sound on only) and the tower says debris is reported. Nothing is
   * damaged — it is the moment the mission stops being a diagram.
   */
  beats: [
    {
      id: 'debris',
      step: 'passes',
      when: (ctx) => ctx.runner.elapsed > 30 && ctx.sim.tornado.active && ctx.sim.tornado.proximity(ctx.ac.pos) > 0.5,
      run: (ctx) => alertSound(ctx, 'thud'),
      say: { text: 'Skylark one seven two, debris reported in the outer band — you are in it now.', voice: 'tower', urgency: 1 },
      shake: 0.4,
      sting: 'hit',
      debrief: 'Debris went past the wing inside the outer band',
    },
  ],
});

patch('carrierqual', {
  /*
   * Three passes, graded like the real thing. Gold is a trap on the first
   * pass with a steady arrival; a second-pass trap is Silver; a third is
   * Bronze (score, below). Missing all three is the one way to fail.
   */
  medals: { silver: 70, gold: 88, goldHint: 'Trap on the first pass with a steady ball' },
  finale: { view: 'orbit', secs: 3 },
  /*
   * The twist: the wind over the deck gets up as you come into the groove
   * on the first pass — half again as strong and thirty degrees across.
   * Paddles calls it and you work the lineup. On pass one so that a
   * first-pass trap is a real Gold, and so that it always happens.
   */
  beats: [
    {
      id: 'deckwind',
      when: (ctx) => {
        const c = carrierTarget(ctx);
        if (!c || ctx.runner.elapsed < 30 || ctx.ac.onGround) return false;
        const d = flatDist(ctx.ac.pos, c);
        return d < 1900 && d > 700 && ctx.ac.pos.y - c.y < 320;
      },
      run: (ctx) => Fun.gust(ctx, { mult: 1.25, turnDeg: 20, secs: 45 }),
      say: { text: "Paddles: wind's picked up over the deck, three-zero knots. Work your lineup.", voice: 'lso', urgency: 1 },
      shake: 0.25,
      debrief: 'Wind got up over the deck in the groove — worked the lineup',
    },
  ],
  onStart: (ctx) => {
    ctx.data.passes = 0; // passes flown without a trap (bolters and go-arounds)
    ctx.data.touchedDeck = false;
    ctx.data.offDeckT = 0;
    ctx.data.nearDeck = false;
    ctx.data.lastPassAt = -99;
  },
  /*
   * The bolter and the go-around, counted here so the mission can grade
   * the pass whether or not the carrier-ops feature is live. A bolter is
   * wheels on the deck and then air under them again without a stop; a
   * go-around is getting into the groove — close and low — and leaving it
   * without touching. Paddles' own calls (carrier-ops) carry on as well.
   */
  tick: (ctx, dt) => {
    const d = ctx.data;
    const c = carrierTarget(ctx);
    if (!c) return;
    const ac = ctx.ac;
    const onDeck = onCarrierDeck(ctx) && ac.onGround;
    const dist = flatDist(ac.pos, c);
    const low = ac.pos.y - c.y < 60;
    if (onDeck) {
      d.touchedDeck = true;
      d.offDeckT = 0;
    } else if (d.touchedDeck) {
      d.offDeckT += dt;
      if (d.offDeckT > 0.6 && !ac.onGround) {
        d.touchedDeck = false;
        d.offDeckT = 0;
        d.nearDeck = false;
        missedPass(ctx, 'bolter');
      }
    }
    if (!onDeck && dist < 350 && low) d.nearDeck = true;
    else if (d.nearDeck && (dist > 900 || ac.pos.y - c.y > 160)) {
      d.nearDeck = false;
      if (!d.touchedDeck) missedPass(ctx, 'waveoff');
    }
  },
  failIf: (ctx) => (ctx.data.passes >= 3 ? 'Three passes, no trap — high and fast every time. Fly the ball: power for the glide path, nose for the speed.' : null),
  onComplete: (ctx) => {
    const p = ctx.data.passes || 0;
    ctx.sim.speak(
      p === 0 ? 'Osprey two one, that is a trap, first pass. Welcome aboard.' : `Osprey two one, trap on pass ${p + 1}. Welcome aboard.`,
      'tower'
    );
  },
  score: (ctx) => {
    const l = ctx.data.lastTouchdown;
    const land = l ? l.score : 20;
    const p = ctx.data.passes || 0;
    // Gold needs the first pass AND a steady arrival; Silver tops out below Gold, Bronze below Silver.
    if (p === 0) return Math.round(82 + land * 0.18);
    if (p === 1) return Math.round(70 + land * 0.12);
    return Math.round(50 + land * 0.12);
  },
  steps: {
    depart: {
      atc: { text: 'Osprey two one, Resolute has you on radar, deck is green. Three passes if you need them.', voice: 'tower' },
    },
    pattern: {
      text: 'Down the port side, then turn back onto the deck. Gear, full flap, hook down.',
    },
    trap: {
      text: 'Fly the ball and put it in the wires. Miss, and it is a bolter: climb out, downwind, again.',
      hint: 'No flare. A carrier landing is a controlled arrival, not a gentle one. Full power the moment the wheels touch, in case.',
      check: (ctx) => onCarrierDeck(ctx) && ctx.ac.onGround && ctx.ac.groundSpeed < 4 && ctx.ac.groundTime > 0.8,
    },
  },
});

patch('patrol', {
  blurb:
    'Three unidentified aeroplanes are loitering round Ironhead, and one of them will not wait. '
    + 'Reach all three inside eight minutes — the Nightjar has the legs, you have to plan the order.',
  /*
   * Eight minutes. It was ten, which with three fixed points was never
   * tight; now one of the three runs for it and another makes you come
   * round behind it, and the clock is part of the puzzle again.
   */
  timeLimit: 480,
  medals: { silver: 65, gold: 85, goldHint: 'All three inside 3:45, then a clean landing' },
  /*
   * The twist: at about two and a half minutes the second contact leaves
   * the zone, outbound south at ninety metres a second. Arrive late and
   * you chase it down — it slows a little after a while, so it is never
   * simply gone. (The third contact's trick is in tick(): it turns away
   * from anything closing from the front, so it has to be approached from
   * behind.)
   */
  beats: [
    {
      id: 'runner',
      at: [140, 170],
      when: (ctx) => !(ctx.data.seen || []).includes(1),
      run: (ctx) => {
        ctx.data.runnerAt = ctx.runner.elapsed;
        const n = ctx.data.npcs && ctx.data.npcs[1];
        if (n) n.direct(180, n.pos.y, 90);
      },
      say: { text: 'Nightjar zero two, contact two is leaving the zone, outbound south, fast. Do not lose him.', voice: 'tower', urgency: 1 },
      sting: 'contact',
      debrief: 'Contact two ran for it — chased it down',
    },
  ],
  onStart: (ctx) => {
    ctx.data.seen = [];
    ctx.data.npcs = [null, null, null];
    ctx.data.turnedAway = false;
    ctx.data.orbitT = 0;
    for (let i = 0; i < CONTACT_PLAN.length; i++) CONTACT_SCRATCH[i].copy(CONTACT_PLAN[i].pos);
    // Three real aeroplanes, owned by the mission and gone when it ends.
    CONTACT_PLAN.forEach((c, i) => {
      Fun.npc(ctx, c.type, { name: `contact-${i + 1}`, pos: c.pos, headingDeg: c.heading, speed: 62 }).then((n) => {
        if (!n || ctx.runner.status !== 'running' || ctx.runner.def.id !== 'patrol') return;
        n.direct(c.heading, c.pos.y, 62);
        ctx.data.npcs[i] = n;
      });
    });
  },
  tick: (ctx, dt) => {
    const d = ctx.data;
    const npcs = d.npcs || [];
    d.orbitT += dt;
    for (let i = 0; i < npcs.length; i++) {
      const n = npcs[i];
      if (!n) continue;
      CONTACT_SCRATCH[i].copy(n.pos);
      // Contact two, once it has run: a long leg south, easing off after ninety seconds.
      if (i === 1 && d.runnerAt != null) {
        if (ctx.runner.elapsed - d.runnerAt > 90 && n.tSpd > 72) n.direct(180, n.pos.y, 70);
        continue;
      }
      // Contact three sees a jet coming at its nose and turns its tail to it.
      if (i === 2 && !(d.seen || []).includes(2)) {
        const dx = ctx.ac.pos.x - n.pos.x;
        const dz = ctx.ac.pos.z - n.pos.z;
        const dist = Math.hypot(dx, dz);
        const h = (n.heading * Math.PI) / 180;
        const ahead = dist > 1 ? (dx * Math.sin(h) - dz * Math.cos(h)) / dist : 0;
        if (dist < 2600 && ahead > 0.35) {
          // Turn away: fly directly away from the jet, a touch faster.
          const away = ((Math.atan2(-dx, dz) * 180) / Math.PI + 360) % 360;
          n.direct(away, n.pos.y, 95);
          if (!d.turnedAway) {
            d.turnedAway = true;
            Fun.line(ctx, 'Contact three has seen you — he is turning away. Come in from behind him.', 'warn', 5);
          }
          continue;
        }
      }
      // Everybody else loiters: a slow continuous turn, sixteen degrees a second of heading.
      n.direct(n.heading + 18, CONTACT_PLAN[i].pos.y, 62);
    }
  },
  score: (ctx) => {
    const l = ctx.data.lastTouchdown;
    // Full marks for the clock inside three minutes, nothing at seven.
    const speed = Math.max(0, Math.min(1, 1 - (ctx.elapsed - 180) / 240));
    return Math.round(speed * 55 + (l ? l.score : 25) * 0.45);
  },
  steps: {
    brief: {
      text: 'Three contacts, three bearings, eight minutes. Reach all three.',
      atc: { text: 'Nightjar zero two, three contacts loitering, intercept and identify.', voice: 'tower' },
      targetLabel: 'Nearest contact',
      target: (ctx) => nearestContact(ctx),
    },
    intercept: {
      hint: 'Flying past at speed counts — you do not have to slow down. Contact three must be approached from behind.',
      check: (ctx) => {
        const seen = ctx.data.seen || [];
        for (let i = 0; i < CONTACT_SCRATCH.length; i++) {
          if (seen.includes(i)) continue;
          if (ctx.ac.pos.distanceTo(CONTACT_SCRATCH[i]) < 700) {
            seen.push(i);
            ctx.data.seen = seen;
            ctx.sim.hud.notify(`Contact ${seen.length} of 3 identified`, 'good', 3);
            Fun.sting(ctx, 'contact');
          }
        }
        return seen.length >= 3;
      },
    },
  },
});

patch('recon', {
  blurb:
    'Four points to photograph below 500 feet, at night, in the flying wing — one of them under a ridge, '
    + 'beside a lit mast. The aeroplane with no tail, in the dark, close to the ground.',
  // The clock shows 8:10; the mission's own failIf at 8:00 says WHY (the ceiling), before the runner's plain "out of time".
  timeLimit: 490,
  medals: { silver: 65, gold: 85, goldHint: 'All four under 500 feet inside 4:30, then a soft landing' },
  /*
   * The twist: as the third photo is taken a fog bank rolls in off the sea
   * for ninety seconds. The last point is flown on the instruments, which
   * the mission has been teaching since the first line. Survivable: it is
   * fog, not a wall; the ground is where the altimeter says it is.
   */
  beats: [
    {
      id: 'fog',
      when: (ctx) => (ctx.data.shot || []).length >= 3 && ctx.runner.elapsed > 30,
      run: (ctx) => Fun.weatherTurn(ctx, 'rainy', 90, { rain: 0, fog: 0.0007, cloud: 0.9 }),
      say: { text: 'Nightjar zero two, fog bank rolling in off the sea. Stay low, stay on the instruments.', voice: 'tower', urgency: 1 },
      debrief: 'Fog rolled in after the third photo — flew the last one blind',
    },
  ],
  onStart: (ctx) => {
    ctx.data.shot = [];
    ctx.data.highT = 0;
    ctx.data.mast = reconMast(ctx);
  },
  tick: (ctx, dt) => {
    // The mast's light blinks (visible in the world); the ceiling clock
    // runs while you are above 1,500 feet between points.
    const m = ctx.data.mast;
    if (m) m.lamp.material.emissiveIntensity = ((ctx.runner.elapsed * 1.5) % 1) < 0.5 ? 2.2 : 0.3;
    const step = ctx.runner.step;
    if (step && step.id === 'shoot') ctx.data.highT = ft(ctx.ac.agl) > 1500 ? ctx.data.highT + dt : Math.max(0, ctx.data.highT - dt);
  },
  failIf: (ctx) => {
    if (ctx.elapsed > 480) {
      const n = (ctx.data.shot || []).length;
      return `Out of time with ${n} of 4 photographed — below 500 feet counts, above it the camera sees nothing`;
    }
    return null;
  },
  score: (ctx) => {
    const l = ctx.data.lastTouchdown;
    // The clock counts now: full marks inside four minutes, nothing at eight.
    const quick = Math.max(0, Math.min(1, 1 - (ctx.elapsed - 240) / 240));
    return Math.round(40 + (l ? l.score : 20) * 0.3 + quick * 30);
  },
  steps: {
    brief: {
      atc: { text: 'Nightjar zero two, you are cleared low level. Nothing below you is lit but the mast.', voice: 'tower' },
      targetLabel: 'Next photo point',
      target: (ctx) => nearestPhoto(ctx),
    },
    shoot: {
      text: 'Overfly each point below 500 feet. Point three is under the ridge, beside the red light.',
      hint: 'Get low BEFORE you arrive. Diving at the point in the dark is how this goes wrong. Thread between the ridge and the mast.',
      check: (ctx) => {
        const shot = ctx.data.shot || [];
        for (let i = 0; i < PHOTO_POINTS.length; i++) {
          if (shot.includes(i)) continue;
          const p = PHOTO_POINTS[i];
          const flat = Math.hypot(ctx.ac.pos.x - p.x, ctx.ac.pos.z - p.z);
          if (flat < 420 && ft(ctx.ac.agl) < 500) {
            shot.push(i);
            ctx.data.shot = shot;
            ctx.sim.hud.notify(`Point ${shot.length} of 4 photographed`, 'good', 3);
            Fun.sting(ctx, 'pass');
          }
        }
        return shot.length >= 4;
      },
    },
  },
});

patch('range', {
  blurb:
    'A marked practice range with a bullseye and a crosswind that is called to you on the way in. '
    + 'Two practice bombs, scored in metres from the middle — two shacks is the gold.',
  weather: { time: 'day', condition: 'clear', windSpeedKts: 15, windDirDeg: 270 },
  parTime: 420,
  medals: { silver: 70, gold: 88, goldHint: 'Two shacks — both stores inside 40 m — and a tidy landing' },
  /*
   * The twist: between the first store and the second the wind backs
   * twenty-five degrees and gains a third. Range Control calls the new
   * wind and you re-work the allowance for the second run. The first
   * store's drift is already on the score line in metres, so there is a
   * number to re-work from.
   */
  beats: [
    {
      id: 'windshift',
      step: 'again',
      at: [4, 10],
      run: (ctx) => {
        Fun.gust(ctx, { mult: 1.3, turnDeg: -25, secs: 150 });
        const w = ctx.weather;
        ctx.data.windKts = w.windSpeedKts;
        ctx.data.windDir = w.windDirDeg;
      },
      say: { text: 'Range: wind shifting, stand by for the new wind.', voice: 'tower' },
      debrief: 'The wind shifted between runs — re-worked the allowance',
    },
    {
      // The new wind, called a few seconds after the shift (the gust front has settled by then).
      id: 'newwind',
      step: 'again',
      at: [14, 16],
      when: (ctx) => ctx.data.windKts != null,
      run: (ctx) => Fun.say(ctx, `Range: wind now ${windWords(ctx.weather.windDirDeg, ctx.weather.windSpeedKts)}.`, 'tower', 1),
    },
  ],
  onStart: (ctx) => {
    ctx.sim.hasCargo = true;
    ctx.data.dropped = false;
    ctx.data.misses = [];
    ctx.data.drifts = [];
    /*
     * A called crosswind each run: 250-290 degrees at 12-18 knots, picked
     * here so two runs are never the same drop. The weather is told, and
     * Range Control says it on the way in (the 'go' step's radio call).
     */
    const w = ctx.weather;
    const dir = RANGE_WIND.dirMin + Math.round(Math.random() * (RANGE_WIND.dirMax - RANGE_WIND.dirMin) / 10) * 10;
    const kts = RANGE_WIND.ktsMin + Math.round(Math.random() * (RANGE_WIND.ktsMax - RANGE_WIND.ktsMin));
    w.windDirDeg = dir;
    w.windSpeedKts = kts;
    w.baseWindDirDeg = dir;
    w.baseWindKts = kts;
    ctx.data.calledWind = windWords(dir, kts);
    // The first step's radio call says this run's wind. onStart runs
    // before the first step is entered, so the words are ready in time.
    const go = ctx.runner.def.steps[0];
    if (go && go.atc) go.atc.text = `Nightjar zero two, range is cold and clear, you are cleared in. Range: wind ${ctx.data.calledWind}.`;
  },
  tick: (ctx) => {
    // The frame a store leaves the aeroplane: remember the height and the
    // wind it fell through, for the allowance on the score line.
    const crate = ctx.sim.crate;
    if (crate && crate !== ctx.data.lastCrate) {
      ctx.data.lastCrate = crate;
      ctx.data.releaseH = Math.max(0, ctx.ac.agl);
      ctx.data.releaseWind = ctx.weather.windVector().length();
    }
  },
  onComplete: (ctx) => {
    const m = ctx.data.misses || [];
    const shacks = m.filter((x) => x < 40).length;
    const avg = m.length ? Math.round(m.reduce((a, b) => a + b, 0) / m.length) : 999;
    ctx.sim.speak(
      shacks === 2 ? 'Nightjar zero two, shack, shack. Two direct hits.' : shacks === 1 ? `Nightjar zero two, one shack, scored at ${avg} metres average.` : `Nightjar zero two, scored at ${avg} metres average.`,
      'tower'
    );
  },
  score: (ctx) => {
    const l = ctx.data.lastTouchdown;
    const m = ctx.data.misses || [];
    const avg = m.length ? m.reduce((a, b) => a + b, 0) / m.length : 400;
    // Accuracy is most of it: two shacks (both inside 40 m) with a tidy landing is Gold.
    const acc = Math.max(0, 1 - avg / 300);
    return Math.round(acc * 62 + (l ? l.score : 20) * 0.38);
  },
  steps: {
    go: {
      text: 'Two practice bombs aboard. Take off and head for the range.',
      hint: 'A practice bomb: a bang and a puff of smoke on an empty range, and a score in metres.',
      atc: { text: 'Nightjar zero two, range is cold and clear, you are cleared in. Range: wind two-seven-zero at one-five.', voice: 'tower' },
    },
    run: {
      text: 'Run in on the target below 1,500 feet and line it up. Allow for the wind.',
    },
    release: {
      text: 'Press X to release. It keeps your speed, so let go BEFORE the bullseye, upwind of it.',
      hint: 'It falls forward as well as down, and the wind carries it — release before you are on top of it.',
      check: (ctx) => scoreStore(ctx, 0),
    },
    // NEW STEP after release
    again: { __after: 'release', __new: {
            id: 'again',
            text: 'Come round for the second run. Two shacks is the gold.',
            hint: 'Same run, same height, and the wind allowance you have just measured — unless the wind changes.',
            targetLabel: 'Bullseye',
            target: (ctx) => rangeTarget(ctx),
            enter: (ctx) => {
              ctx.sim.removeCrate();
              ctx.sim.hasCargo = true;
            },
            check: (ctx) => scoreStore(ctx, 1),
          } },
  },
});

patch('tail', {
  medals: { silver: 70, gold: 88, goldHint: 'Lose them inside three minutes and land clean' },
  /*
   * The twist: the cloud base comes down. A minute in, the tower calls the
   * deck lowering towards three thousand feet — a thousand feet closer
   * than it was — and the hiding place comes to meet you. It changes what
   * you do (ease off, you are nearly in) without changing what the
   * pursuers can do, so it is a gift you have to notice.
   */
  beats: [
    {
      id: 'deck',
      at: [45, 75],
      when: (ctx) => !ctx.data.escaped,
      run: (ctx) => Fun.weatherTurn(ctx, 'cloudy', 240, { cloudBase: 900, cloud: 0.7 }),
      say: { text: 'Vanguard zero one, cloud base is lowering, three thousand feet and dropping. Get up into it.', voice: 'tower', urgency: 1 },
      debrief: 'The cloud base came down — climbed into it early',
    },
  ],
});

