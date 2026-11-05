/**
 * THE HELICOPTER MISSIONS' FUN PASS, laid over the defs in ../missions-heli.js
 * once the menu is up: a twist in every rescue, medals, finales and a
 * checkpoint where a long flight deserves one. See ./patch.js for how it goes
 * on, and ./flight-fun.js for the aeroplane's.
 */

import * as THREE from '../../vendor/three.module.js';
import { heightAt } from '../../world/terrain.js';
import * as Fun from '../fun-kit.js';
import { patch } from './patch.js';
import {
  PROPS, begin, clearHeliProps, deckTarget, assistWords, dist2D, heliTick, landedAt, RescueBoat, siteAt, siteMarker, siteRadius, skidHeight,
} from '../missions-heli.js';

const clamp = THREE.MathUtils.clamp;

/*
 * The crew on the intercom. There is no winchman voice in atc.js's table;
 * 'instructor' is the one that is NOT put through the radio chain, which is
 * exactly what a voice in the same cabin sounds like.
 */
export const CREW = 'instructor';

/**
 * The most level spot `metres` from `from`, among eight bearings, judged by
 * the height range across a landing circle. For a pickup that has to MOVE
 * mid-mission and still be somewhere a helicopter can put down — the
 * terrain is noise, so the answer is measured, not typed.
 */
export function levelSpotNear(from, metres = 40, radius = 10, awayFrom = null) {
  let best = null;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x = from.x + Math.sin(a) * metres;
    const z = from.z + Math.cos(a) * metres;
    const h0 = heightAt(x, z);
    if (h0 <= 0.5) continue; // not into the sea
    let lo = h0;
    let hi = h0;
    for (let k = 0; k < 8; k++) {
      const b = (k / 8) * Math.PI * 2;
      const h = heightAt(x + Math.sin(b) * radius, z + Math.cos(b) * radius);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    let cost = hi - lo;
    // Prefer away from the water (the tide is the reason it moved).
    if (awayFrom) cost += Math.max(0, 1 - dist2D({ x, z }, awayFrom) / (metres * 2)) * 0.5;
    if (!best || cost < best.cost) best = { cost, pos: new THREE.Vector3(x, h0, z) };
  }
  return best ? best.pos : from.clone();
}

/**
 * The deck lights fail, for `secs`, and the crew light the deck with torches.
 *
 * pads.js draws every pad's eight perimeter lamps with ONE shared material
 * (scenery.pads.lampMat) and updatePads() rewrites its emissiveIntensity
 * every frame — so the honest way to black them out is the emissive COLOUR,
 * which nothing else touches, put back when the time is up. Three warm dots
 * on the deck are the torches; they are props, so a failed mission takes
 * them away with everything else.
 */
export function deckLightsFail(ctx, deckPos, secs = 4) {
  const sim = ctx.sim;
  const built = sim && sim.scenery && sim.scenery.pads;
  const lamp = built && built.lampMat;
  const was = lamp ? lamp.emissive.getHex() : null;
  if (lamp) lamp.emissive.setHex(0x000000);
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd28a });
  const geo = new THREE.SphereGeometry(0.35, 6, 5);
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(geo, mat);
    const a = (i / 3) * Math.PI * 2 + 0.4;
    m.position.set(deckPos.x + Math.cos(a) * 6, deckPos.y + 1.3, deckPos.z + Math.sin(a) * 6);
    group.add(m);
  }
  if (sim && sim.scene) sim.scene.add(group);
  const prop = {
    group,
    t: 0,
    update(dt) {
      this.t += dt;
      // Hand torches waver; a steady light would read as a lamp.
      mat.color.setHex(this.t % 0.3 < 0.15 ? 0xffd28a : 0xffb866);
      if (this.t >= secs && !this.done) {
        this.done = true;
        if (lamp && was != null) lamp.emissive.setHex(was);
        if (sim && sim.scene) sim.scene.remove(group);
        if (sim && sim.hud) sim.hud.notify('Deck lights are back.', 'good', 3);
      }
    },
    dispose() {
      if (lamp && was != null) lamp.emissive.setHex(was);
      geo.dispose();
      mat.dispose();
    },
  };
  PROPS.push(prop);
  return prop;
}

/**
 * The gust that lands INSIDE a hover, at a second nobody can predict.
 *
 * A beat with `at` counts from the step's start, and a child may take a
 * minute to get into the circle — a gust at step-second six would be over
 * before the hover began. So the moment is a number of seconds of HELD
 * hover, drawn once per run in onStart, and the beat waits for it. The
 * tolerance never changes: the gust is a push to correct, not a new rule.
 */
export function gustInHover(ctx) {
  const h = ctx.data.hover;
  return !!h && !h.done && h.held > (ctx.data.gustAt == null ? 3 : ctx.data.gustAt);
}

export function drawGustAt(ctx, lo = 2, hi = 6) {
  ctx.data.gustAt = lo + Math.random() * (hi - lo);
}

/**
 * "Hold it on the deck while they board" — ACTIVE, not a wait. Six seconds
 * light on the skids: down, or no more than three metres up, and still.
 * It drains when you bounce, so a child who lifts off watches the bar fall
 * and puts it back down, which is the lesson. The runner passes dt to check.
 */
export function holdOnGround(ctx, dt, secs = 6, key = 'boardHeld') {
  const ac = ctx.ac;
  const light = (ac.onGround || skidHeight(ac) < 3) && ac.groundSpeed < 1.2;
  const was = ctx.data[key] || 0;
  const now = clamp(was + (light ? dt : -dt * 1.5), 0, secs);
  ctx.data[key] = now;
  if (!light && was > 0.5 && now <= 0.05 && ctx.sim.hud) ctx.sim.hud.notify('They are still boarding — settle it back down.', 'warn', 3.5);
  return now >= secs;
}

patch('firstlight', {
  finale: { view: 'orbit', say: "Skyhook three, that's a hover. Everything else we do is that.", voice: 'tower' },
  medals: { silver: 72, gold: 86, goldHint: 'A soft touchdown on the H, inside four minutes' },
  onComplete: (ctx) => {
    // The line is the finale's (def.finale.say), spoken over the orbit.
    clearHeliProps(ctx.sim);
  },
  steps: {
    turn: {
      targetLabel: 'The pad',
      target: (ctx) => siteAt(ctx, 'harbour'),
    },
  },
});

patch('covepickup', {
  blurb:
    'A walker above Cormorant Cove has gone over on her ankle, and the tide is coming in behind her. '
    + 'Put it down on the grass beside her, hold it light while she is loaded, and take her to the hospital pad.',
  medals: { silver: 60, gold: 76, goldHint: 'A soft touchdown at both ends, inside five minutes' },
  tick: (ctx, dt) => {
    heliTick(ctx, dt);
    // The ring follows the point: the tide moves it.
    if (ctx.data.marker && ctx.data.pickup) ctx.data.marker.setPos(ctx.data.pickup);
  },
  onStart: (ctx) => {
    begin(ctx);
    // The pickup is a POINT the mission owns, so the tide can move it.
    ctx.data.pickup = siteAt(ctx, 'cove');
    ctx.data.marker = siteMarker(ctx, ctx.data.pickup, 0xffb347);
  },
  /*
   * THE TWIST. On the way out the tide comes in and she is moved forty
   * metres up the beach: the ring slides to the new spot (moveTarget), the
   * arrow and the beacon follow it, and the radio says so the moment it
   * happens. Where it moves to is MEASURED when it fires — the most level
   * circle forty metres away, inland — so the new spot is always landable.
   */
  beats: [
    {
      id: 'tide',
      step: 'out',
      at: [18, 34],
      when: (ctx) => dist2D(ctx.ac.pos, ctx.data.pickup) > 450,
      run: (ctx) => {
        const to = levelSpotNear(ctx.data.pickup, 40, 10, { x: ctx.data.pickup.x, z: ctx.data.pickup.z + 220 });
        Fun.moveTarget(ctx, 'pickup', to, 6);
      },
      say: { text: 'Medic one, update: tide is coming in, she has moved forty metres up the beach. Marker is updated.', voice: 'approach' },
      line: 'Pickup moved 40 m up the beach — follow the marker.',
      debrief: 'The tide came in — the pickup moved 40 m up the beach',
    },
  ],
  steps: {
    out: {
      atc: {
        text: 'Medic one, Rescue Coordination. Walker with a broken ankle on Cormorant Cove. Land beside her and bring her in.',
        voice: 'approach',
      },
      target: (ctx) => ctx.data.pickup.clone(),
      check: (ctx) => dist2D(ctx.ac.pos, ctx.data.pickup) < 450 && ctx.ac.airborneTime > 8,
    },
    land: {
      text: 'Come to a stop over the orange ring, then let it down onto the grass beside her.',
      target: (ctx) => ctx.data.pickup.clone(),
      check: (ctx) => landedAt(ctx, ctx.data.pickup, siteRadius('cove')),
    },
    wait: {
      /*
       * Six seconds, ACTIVE: light on the skids and still while the
       * stretcher goes in. Bounce and the bar drains. It is still the one
       * moment in the game where a child holds still and watches somebody
       * being helped, and it is where the weight arrives — so the
       * difference on the way home is something they felt happen.
       */
      text: 'Hold it light on the skids — down, or no more than ten feet — while they load her.',
      get hint() {
        return assistWords('Stay down and still. If it lifts, tap Ctrl to settle it.', 'Collective down, feet still. Six seconds.');
      },
      targetLabel: 'Cormorant Cove',
      target: (ctx) => ctx.data.pickup.clone(),
      enter: (ctx) => {
        ctx.data.boardHeld = 0;
        ctx.sim.hud.notify('Loading — hold it still.', 'info', 4);
      },
      check: (ctx, dt) => holdOnGround(ctx, dt, 6),
    },
  },
});

patch('overboard', {
  medals: { silver: 66, gold: 80, goldHint: 'Winch him first time and a soft touchdown, inside six minutes' },
  onStart: (ctx) => {
    begin(ctx);
    const swimmer = siteAt(ctx, 'swimmer');
    ctx.data.boat = new RescueBoat(ctx, swimmer);
    ctx.data.marker = siteMarker(ctx, ctx.data.boat.swimmer, 0xff6a4d);
    drawGustAt(ctx, 2, 6);
  },
  /*
   * THE TWIST: a gust INSIDE the hold, at a second of held hover nobody can
   * predict (gustInHover). The circle, the band and the drift limit do not
   * change — the push has to be corrected, that is all — so it stays fair.
   */
  beats: [
    {
      id: 'gust',
      step: 'winch',
      when: gustInHover,
      run: (ctx) => Fun.gust(ctx, { mult: 1.5, turnDeg: 30, secs: 14 }),
      say: { text: 'Losing him — hold it, hold it.', voice: CREW, urgency: 1 },
      shake: 0.3,
      debrief: 'A gust hit mid-winch and you held him',
    },
  ],
});

patch('stackrescue', {
  blurb:
    'A climber is stuck on top of Gannet Stack with a broken wrist, and their kit covers the little pad '
    + 'up there. Wind spills over the rock, there is nowhere to land, and the winch is the only way.',
  /*
   * Twelve knots on the way out, not eighteen: the eighteen arrives as an
   * EVENT, mid-hold, on the radio — a gust front that takes it to twenty-
   * four for a quarter of a minute — rather than as a number in the card.
   */
  weather: { time: 'day', condition: 'cloudy', windSpeedKts: 12, windDirDeg: 300 },
  medals: { silver: 66, gold: 80, goldHint: 'Off the rock first time and a soft touchdown, inside six minutes' },
  onStart: (ctx) => {
    begin(ctx);
    ctx.data.gaveUp = false;
    siteMarker(ctx, siteAt(ctx, 'ledge'), 0xff6a4d);
    drawGustAt(ctx, 3, 7);
  },
  beats: [
    {
      id: 'gust',
      step: 'winch',
      when: gustInHover,
      run: (ctx) => Fun.gust(ctx, { mult: 1.5, turnDeg: 35, secs: 16 }),
      say: { text: "Wind's picking up, watch your drift.", voice: CREW, urgency: 1 },
      shake: 0.3,
      debrief: 'The wind got up to twenty-four knots in the hover',
    },
  ],
  steps: {
    out: {
      atc: {
        text: 'Rescue three, Rescue Coordination. Climber on top of Gannet Stack, winch job, nowhere to put you down. Wind twelve over the top and building.',
        voice: 'approach',
        urgency: 1,
      },
    },
  },
});

patch('nightdeck', {
  medals: { silver: 66, gold: 80, goldHint: 'Down on the deck first time and a soft landing at the hospital' },
  /*
   * TWO TWISTS on the approach. Inside seven hundred metres the deck lights
   * fail for four seconds and the crew light the deck with torches; on
   * short final a gust comes across the deck. Neither changes what counts
   * as landed — they change what the approach is like.
   */
  beats: [
    {
      id: 'lights',
      step: 'land',
      when: (ctx) => {
        const d = deckTarget(ctx);
        return !!d && !ctx.ac.onGround && dist2D(ctx.ac.pos, d) < 700 && dist2D(ctx.ac.pos, d) > 260;
      },
      run: (ctx) => {
        const d = deckTarget(ctx);
        if (d) deckLightsFail(ctx, d, 4);
      },
      say: { text: 'Rescue three, deck lights have failed. Crew are lighting the deck with torches, continue approach.', voice: 'approach', urgency: 1 },
      debrief: 'The deck lights failed on the approach — the crew lit it with torches',
    },
    {
      id: 'gust',
      step: 'land',
      when: (ctx) => {
        const d = deckTarget(ctx);
        return !!d && !ctx.ac.onGround && dist2D(ctx.ac.pos, d) < 260 && ctx.runner.stepElapsed > 5;
      },
      run: (ctx) => Fun.gust(ctx, { mult: 1.35, turnDeg: 25, secs: 14 }),
      say: { text: 'Gust across the deck, hold your line.', voice: CREW, urgency: 1 },
      shake: 0.3,
      debrief: 'A gust came across the deck on short final',
    },
  ],
});

patch('lastlight', {
  medals: { silver: 66, gold: 84, goldHint: 'Both of them home before the light goes' },
  /*
   * Today's mission is Raven Crag, a valley with no south shore, so the flare
   * and the sea search stay behind. The twist that fits the place does not: a
   * gust in the last hover, with the dark coming.
   */
  beats: [
    {
      id: 'gust',
      step: 'second',
      when: gustInHover,
      run: (ctx) => Fun.gust(ctx, { mult: 1.4, turnDeg: 30, secs: 14 }),
      say: { text: "Wind's getting up with the dark — hold it.", voice: CREW, urgency: 1 },
      shake: 0.3,
      debrief: 'A gust in the last hover, with the light going',
    },
  ],
  steps: {
    second: {
      // A fail on the second call does not fly the first one again.
      checkpoint: 'One at the hospital',
      snap: (ctx) => ({ firstKey: ctx.data.firstKey || 'eastshore' }),
      restore: (ctx, s) => {
        ctx.data.firstKey = (s && s.firstKey) || 'eastshore';
        ctx.data.saved = 1;
      },
    },
  },
});

// On Call's varied shift (two-casualty calls, a burning boat) is not ported: the mission lives in
// Meridian City now and those calls were built for a sea all round. It gets its medals.
patch('oncall', {
  medals: { silver: 60, gold: 80, goldHint: 'Four people home in one shift' },
});
