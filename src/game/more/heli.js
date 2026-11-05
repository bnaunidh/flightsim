/**
 * The Skyhook's new missions — three more rescues, on three more maps.
 *
 *   sling-load   Aurora Fjords. A generator for the keeper of Skerry Light,
 *                carried UNDERSLUNG: hover, hook, lift, carry it 400 m up to
 *                the stack, set it down slow inside the ring. New kit here:
 *                SlingLoad, a damped pendulum on a twelve-metre line.
 *   rig-evac     Ironhead Deep. Two workers off Ironhead Delta before the
 *                storm closes the field, in two short trips to Ironhead
 *                Alpha; a gust front on the first, rain on the second.
 *   raven-crag   Raven Crag. A climber on Anvil Shelf, high on the valley
 *                wall, the winch beside the cliff, and the cloud base coming
 *                down the valley behind you.
 *
 * Everything they stand on comes from missions-heli.js (the hover box, the
 * pads, the props, the winch step) and the fun kit (the beats, the gusts,
 * the medals, the checkpoints). They arrive with the features, through
 * ./index.js, and reach the board by menus.registerMissions().
 *
 * ON THE PLAN'S "DEEP FLOTEL": the plan has the rig workers flown to the
 * Deep Flotel. On Ironhead Deep that pad is 10.4 km from Delta — four legs
 * of it would be forty kilometres, a quarter of an hour of cruise and no
 * "short trips" about it. Ironhead Alpha is 2.9 km from Delta, which is a
 * short trip; the flotel stays on the map for On Call to find.
 */

import * as THREE from '../../vendor/three.module.js';
import { heightAt, platformAt } from '../../world/terrain.js';
import * as Fun from '../fun-kit.js';
import {
  siteAt,
  siteRadius,
  padSpawn,
  landedAt,
  HoverTask,
  winchStep,
  heliTick,
  siteMarker,
  PROPS,
  begin,
  load,
  unload,
  CASUALTY_KG,
  assistWords,
  skidHeight,
  surfaceAt,
  dist2D,
  clearHeliProps,
} from '../missions-heli.js';
import { CREW, gustInHover, drawGustAt, holdOnGround } from './heli-fun.js';

const clamp = THREE.MathUtils.clamp;

/** The shared winch step, plus a fun-kit checkpoint where the mission names one. */
const winchAt = ({ checkpoint, snap, restore, ...spec }) => Object.assign(winchStep(spec), { checkpoint, snap, restore });

/* ------------------------------------------------------------------ *
 * THE UNDERSLUNG LOAD.
 *
 * A point mass on a line of fixed length under the hook, with gravity, a
 * little air damping, and a constraint: when the line is taut the load may
 * not move away from the hook along the line, so the radial part of its
 * velocity (relative to the helicopter) is taken out. Slack line, it falls;
 * taut line, it swings. That is a pendulum, and it costs five vector
 * operations a frame with no allocation.
 *
 * On the ground it sits; hooked and on the ground, it lifts the moment the
 * hook is more than a line's length above it, and it is dragged along the
 * ground if the helicopter wanders off sideways with the line taut. The
 * weight (SLING.kg) goes on the helicopter's extraMass only while it is in
 * the air, which is physically what happens and is also what makes the
 * difference feel like a thing that happened rather than a number.
 *
 * The one number that matters for the mission is `impact`: the load's speed
 * when it meets the ground. Under SLING.gentle is a set-down, over
 * SLING.damaged is a broken generator and a trip back for the spare.
 * ------------------------------------------------------------------ */
export const SLING = { L: 12, kg: 320, half: 0.65, gentle: 2.2, damaged: 3.6 };

export class SlingLoad {
  constructor(ctx, at) {
    const sim = ctx.sim;
    this.pos = new THREE.Vector3(at.x, surfaceAt(at.x, at.z) + SLING.half, at.z);
    this.vel = new THREE.Vector3();
    this.hook = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._rv = new THREE.Vector3();
    this.hooked = false;
    this.onGround = true;
    this.lifted = false; // has it ever left the ground
    this.carrying = false; // weight on the hook right now
    this.damaged = false;
    this.impact = 0;
    this.touches = 0;
    this.group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd9a21b, roughness: 0.65 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.8 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.1, 1.7), bodyMat);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 1.9), frameMat);
    frame.position.y = -0.58;
    body.position.y = 0.05;
    this.group.add(body, frame);
    this.group.position.copy(this.pos);
    const lineGeo = new THREE.BufferGeometry();
    this.linePos = new Float32Array(6);
    lineGeo.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3));
    this.line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x1c1c1c }));
    this.line.frustumCulled = false;
    this.line.visible = false;
    if (sim.scene) {
      sim.scene.add(this.group);
      sim.scene.add(this.line);
    }
    PROPS.push({
      group: this.group,
      dispose: () => {
        if (sim.scene) sim.scene.remove(this.line);
        body.geometry.dispose();
        frame.geometry.dispose();
        bodyMat.dispose();
        frameMat.dispose();
        lineGeo.dispose();
      },
    });
  }

  attach() {
    this.hooked = true;
    this.line.visible = true;
  }

  release() {
    this.hooked = false;
    this.line.visible = false;
  }

  /** Metres of air under the load's bottom edge. */
  clearance() {
    return this.pos.y - SLING.half - surfaceAt(this.pos.x, this.pos.z);
  }

  update(dt, ctx) {
    const ac = ctx.ac;
    if (this.hooked) {
      this.hook.set(ac.pos.x, ac.pos.y - 1.7, ac.pos.z);
      if (this.onGround) {
        const dy = this.hook.y - (this.pos.y + SLING.half);
        const dh = dist2D(this.hook, this.pos);
        const len = Math.hypot(dy, dh);
        if (len > SLING.L + 0.05) {
          if (dy > SLING.L * 0.75) {
            // Up she comes.
            this.onGround = false;
            this.lifted = true;
            this.carrying = true;
            this.vel.set(0, 0, 0);
            ac.extraMass = (ac.extraMass || 0) + SLING.kg;
          } else if (dh > 0.01) {
            // Dragged along the ground towards the hook.
            const k = (len - SLING.L) / dh;
            this.pos.x += (this.hook.x - this.pos.x) * k;
            this.pos.z += (this.hook.z - this.pos.z) * k;
            this.pos.y = surfaceAt(this.pos.x, this.pos.z) + SLING.half;
          }
        }
      } else {
        this.vel.y -= 9.81 * dt;
        this.vel.multiplyScalar(Math.max(0, 1 - 0.45 * dt));
        this.pos.addScaledVector(this.vel, dt);
        this._d.subVectors(this.pos, this.hook);
        const len = this._d.length();
        if (len > SLING.L) {
          this._d.multiplyScalar(1 / len);
          this.pos.copy(this.hook).addScaledVector(this._d, SLING.L);
          this._rv.subVectors(this.vel, ac.vel);
          const vr = this._rv.dot(this._d);
          if (vr > 0) this.vel.addScaledVector(this._d, -vr);
        }
        const g = surfaceAt(this.pos.x, this.pos.z);
        if (this.pos.y - SLING.half <= g) {
          this.impact = this.vel.length();
          this.touches++;
          this.wet = heightAt(this.pos.x, this.pos.z) <= 0;
          this.pos.y = g + SLING.half;
          this.vel.set(0, 0, 0);
          this.onGround = true;
          if (this.carrying) {
            this.carrying = false;
            ac.extraMass = Math.max(0, (ac.extraMass || 0) - SLING.kg);
          }
        }
      }
      this.linePos[0] = this.hook.x;
      this.linePos[1] = this.hook.y;
      this.linePos[2] = this.hook.z;
      this.linePos[3] = this.pos.x;
      this.linePos[4] = this.pos.y + SLING.half;
      this.linePos[5] = this.pos.z;
      this.line.geometry.attributes.position.needsUpdate = true;
    }
    this.group.position.copy(this.pos);
    if (this.damaged) this.group.rotation.z = 0.55;
  }
}

/* ------------------------------------------------------------------ *
 * Shared bits for the deck landings and the scores.
 * ------------------------------------------------------------------ */

/** Down, still, and ON the steel of this deck. */
function onDeck(ctx, key) {
  const d = siteAt(ctx, key);
  return !!platformAt(ctx.ac.pos.x, ctx.ac.pos.z) && landedAt(ctx, d, 22);
}

/** The worst touchdown of the flight so far, in ft/min, for the score. */
function trackTouchdowns(ctx) {
  const l = ctx.data.lastTouchdown;
  if (l && l !== ctx.data._lastSeenTouch) {
    ctx.data._lastSeenTouch = l;
    ctx.data.worstVs = Math.max(ctx.data.worstVs || 0, Math.abs(l.vsFpm || 0));
  }
}

const RIG_LIMIT = 735;
/*
 * Seconds from the cloud call to the shelf closing. Anvil Shelf is 800 m up
 * and the station is at 57 m: the climb alone is nearly three minutes at the
 * kid computer's 4.5 m/s, so the fuse is four and a half minutes from a call
 * that comes a minute or so in. A clean run is on the wire at about 230 s.
 */
const CRAG_CLOSE = 270;

export const NEW_HELI_MISSIONS = [
  /* ------------------------------------------------------------------ *
   * SLING LOAD — the hook, the line, and a load that swings.
   * ------------------------------------------------------------------ */
  {
    id: 'sling-load',
    game: 'heli',
    category: 'rescue',
    name: 'Sling Load',
    short: 'Underslung generator',
    difficulty: 'Medium',
    icon: '⌁',
    map: 'fjord',
    aircraft: 'harrier',
    blurb:
      'The storm has cut the power to Skerry Light and the keeper is in the dark. Carry a generator across to '
      + 'the lighthouse pad on the hook, and set it down gently inside the ring.',
    reward: 'Teaches the hook: lifting a load, carrying it without swinging it, and setting it down slow.',
    weather: { time: 'sunset', condition: 'cloudy', windSpeedKts: 12, windDirDeg: 300 },
    timeLimit: 660,
    parTime: 360,
    medals: { silver: 62, gold: 78, goldHint: 'Set it down under 2 m/s, first time, inside five minutes' },
    onStart: (ctx) => {
      begin(ctx);
      ctx.data.spares = 0;
      ctx.data.phase = 'out';
      ctx.data.setImpact = null;
      ctx.data.load = new SlingLoad(ctx, siteAt(ctx, 'skerry'));
      ctx.data.ring = siteMarker(ctx, siteAt(ctx, 'skerryLight'), 0x7dffb4);
    },
    spawn: padSpawn('hospital', 300),
    /*
     * A view call-out on the way out (the fjord is the view), and THE TWIST:
     * a gust off the stack in the final hover, with the load on the hook.
     * The load swings; the answer is to wait for it to settle, then lower.
     */
    beats: [
      {
        id: 'callout',
        at: [38, 52],
        step: 'out',
        say: { text: 'Skerry Light, Skyhook three, two minutes out. Keeper, keep clear of the pad — the load comes in on a long line.', voice: 'pilot' },
      },
      {
        id: 'gust',
        step: 'carry',
        when: (ctx) => {
          const l = ctx.data.load;
          return !!l && l.carrying && dist2D(l.pos, siteAt(ctx, 'skerryLight')) < 110 && ctx.data.phase === 'carry';
        },
        run: (ctx) => Fun.gust(ctx, { mult: 1.6, turnDeg: 40, secs: 14 }),
        say: { text: "Gust off the stack — the load's swinging. Let it settle before you lower.", voice: CREW, urgency: 1 },
        shake: 0.3,
        debrief: 'A gust off the stack swung the load over the pad',
      },
    ],
    steps: [
      {
        id: 'out',
        text: 'Lift off and fly west to Skerry Strip. The generator is on the strip above the light.',
        get hint() {
          return assistWords(
            'Follow the arrow across the fjord. Hold W to go, let go to stop.',
            'West across the water. The strip is the flat ground on the hill above the light.'
          );
        },
        atc: {
          text: 'Skyhook three, Rescue Coordination. Skerry Light has lost power, keeper is in the dark. Generator is on Skerry Strip for the hook.',
          voice: 'approach',
          urgency: 1,
        },
        targetLabel: 'Skerry Strip',
        target: (ctx) => siteAt(ctx, 'skerry'),
        check: (ctx) => dist2D(ctx.ac.pos, siteAt(ctx, 'skerry')) < 320 && ctx.ac.airborneTime > 8,
      },
      winchAt({
        id: 'hook',
        text: 'Hover low over the generator, about thirty feet, and hold it while the hook goes on.',
        hint: () =>
          assistWords(
            'Let go of W A S D over the yellow box and it stops. Shift or Ctrl until HEIGHT is green. Four seconds.',
            'Lower than a winch — thirty feet. Stop it over the box first, then the height.'
          ),
        label: 'Hook on',
        at: (ctx) => ctx.data.load.pos,
        spec: { radius: 7, aglMin: 7, aglMax: 14, driftMax: 1.2, seconds: 4, drain: 0.8 },
        onPicked: (ctx) => {
          ctx.data.load.attach();
          ctx.data.phase = 'carry';
          ctx.sim.hud.showBanner('Hook on', 'Climb and the load comes with you.', 'good', 4);
          ctx.sim.speak('Hook is on. Up gently — she lifts at forty feet.', CREW, 1);
        },
      }),
      {
        id: 'carry',
        text: 'Lift it clear, carry it across to the light, and set it down slow inside the ring.',
        get hint() {
          return assistWords(
            'Over the ring, stop, then TAP Ctrl — a little at a time — until the line goes slack.',
            'The load is forty feet under you. Stop over the ring, then lower it a metre at a time.'
          );
        },
        targetLabel: 'Skerry Light',
        /*
         * The ring on the stack — or the spare back on the strip, when the
         * one you were carrying is broken (see tick). The arrow follows.
         */
        target: (ctx) => (ctx.data.phase === 'spare' ? ctx.data.load.pos.clone() : siteAt(ctx, 'skerryLight')),
        enter: (ctx) => {
          ctx.data.slack = 0;
        },
        check: (ctx, dt) => {
          const d = ctx.data;
          const l = d.load;
          if (d.phase === 'spare') {
            // Back for the spare: the hook hover again, run here, so the
            // runner's one step stays one step.
            if (!d.hover) {
              d.hover = new HoverTask({ at: () => l.pos, radius: 7, aglMin: 7, aglMax: 14, driftMax: 1.2, seconds: 4, drain: 0.8, label: 'Hook on' }).attach(ctx);
            }
            if (d.hover.done) {
              d.hover.dispose(ctx);
              d.hover = null;
              l.attach();
              d.phase = 'carry';
              ctx.sim.hud.showBanner('Hook on', 'The spare. Climb, and gently this time.', 'good', 4);
              ctx.sim.hud.setObjective(`${ctx.runner.def.name} · step 3 of 4`, 'Carry the spare across to the light and set it down slow inside the ring.');
            }
            return false;
          }
          if (!l.hooked || !l.lifted || !l.onGround) {
            d.slack = 0;
            return false;
          }
          const pad = siteAt(ctx, 'skerryLight');
          const inRing = dist2D(l.pos, pad) <= 7.5;
          if (!inRing) {
            Fun.line(ctx, 'Outside the ring — lift it and try again.', 'warn', 3.5);
            d.slack = 0;
            return false;
          }
          // Down, in the ring: let the line go slack for a moment and the
          // hook comes off.
          // Slack by most of a metre for a second: the touch itself leaves
          // the line taut, so this is "and then come down a little more".
          const slackBy = SLING.L - (l.hook.y - (l.pos.y + SLING.half));
          d.slack = slackBy > 0.8 ? d.slack + dt : 0;
          if (d.slack < 1.0) return false;
          d.setImpact = l.impact;
          l.release();
          ctx.sim.speak(l.impact <= SLING.gentle ? 'Load is on, hook is clear. Lovely.' : 'Load is on, hook is clear. Firm, but it will run.', CREW, 1);
          ctx.sim.hud.showBanner('Generator delivered', `${l.impact.toFixed(1)} m/s set-down`, 'good', 4);
          return true;
        },
      },
      {
        id: 'home',
        text: 'Set down on Skerry Strip.',
        hint: 'Back up the slope to the strip. Stop over the H, then Ctrl.',
        targetLabel: 'Skerry Strip',
        target: (ctx) => siteAt(ctx, 'skerry'),
        check: (ctx) => landedAt(ctx, siteAt(ctx, 'skerry'), siteRadius('skerry')),
      },
    ],
    tick: (ctx, dt) => {
      heliTick(ctx, dt);
      const d = ctx.data;
      const l = d.load;
      if (!l) return;
      l.update(dt, ctx);
      /*
       * THE FAIR FAIL. A hard set-down — or the sea — breaks the generator.
       * It is not the end: the wreck stays where it fell, a spare is on the
       * strip, and the arrow turns round. It costs the trip back, which is
       * exactly what it should cost.
       */
      if (l.hooked && l.onGround && l.touches > 0 && !l.damaged && d.phase === 'carry' && (l.impact > SLING.damaged || l.wet)) {
        l.damaged = true;
        l.release();
        if (l.carrying) {
          l.carrying = false;
          unload(ctx);
        }
        d.spares++;
        d.phase = 'spare';
        d.load = new SlingLoad(ctx, siteAt(ctx, 'skerry'));
        ctx.sim.speak(l.wet ? "That one's in the sea. There's a spare on the strip — go back for it." : "That one's broken, it came down too hard. There's a spare on the strip — go back for it.", CREW, 1);
        ctx.sim.hud.showBanner('Generator damaged', 'Back to the strip for the spare.', 'warn', 5);
        ctx.sim.hud.setObjective(`${ctx.runner.def.name} · step 3 of 4`, 'Back to Skerry Strip. Hover over the spare and hook it on.');
      }
    },
    // Under the runner's own timeLimit, so this reason is the one that shows.
    failIf: (ctx) => (ctx.elapsed > 645 ? 'Skerry Light went dark before the generator was in — hook up and carry it straight across (under eleven minutes)' : null),
    onComplete: (ctx) => {
      unload(ctx);
      clearHeliProps(ctx.sim);
      ctx.sim.speak('Skyhook three, Skerry Light has power. The keeper says thank you.', 'tower');
    },
    finale: { view: 'orbit', say: 'Skerry Light, lit. Nicely flown, Skyhook.', voice: 'tower' },
    score: (ctx) => {
      const d = ctx.data;
      const imp = d.setImpact == null ? 3 : d.setImpact;
      const gentle = clamp(1 - (imp - 0.6) / 3.0, 0, 1);
      const l = ctx.data.lastTouchdown;
      return Math.round(clamp(30 + gentle * 35 + Math.max(0, 1 - ctx.elapsed / 600) * 20 + (l ? l.score : 25) * 0.15 - (d.spares || 0) * 10, 0, 100));
    },
  },

  /* ------------------------------------------------------------------ *
   * RIG EVACUATION — two short trips, and the weather coming in.
   * ------------------------------------------------------------------ */
  {
    id: 'rig-evac',
    game: 'heli',
    category: 'rescue',
    name: 'Rig Evacuation',
    short: 'Two trips before the storm',
    difficulty: 'Hard',
    icon: '⬢',
    map: 'rigs',
    aircraft: 'harrier',
    blurb:
      'A storm is an hour out and two workers are still on Ironhead Delta. Two short trips across to '
      + 'Ironhead Alpha, and the weather gets worse with each one.',
    reward: 'Teaches deck landings in a rising wind, and flying the same leg twice when it is not the same leg.',
    weather: { time: 'sunset', condition: 'cloudy', windSpeedKts: 16, windDirDeg: 240 },
    timeLimit: 750,
    parTime: 420,
    medals: { silver: 64, gold: 80, goldHint: 'Four soft deck landings, both across inside seven minutes' },
    onStart: (ctx) => {
      begin(ctx);
      ctx.data.across = 0;
      ctx.data.worstVs = 0;
      siteMarker(ctx, siteAt(ctx, 'alpha'), 0x7dffb4);
    },
    spawn: padSpawn('delta', 240),
    /*
     * THE WEATHER WORSENS EACH TRIP. A gust front on the first crossing; the
     * rain arrives as you go back for the second man, so the second crossing
     * is flown in it. Both on the radio the moment they happen.
     */
    beats: [
      {
        id: 'gust',
        step: 'trip1',
        at: [18, 34],
        run: (ctx) => Fun.gust(ctx, { mult: 1.7, turnDeg: 50, secs: 45 }),
        say: { text: 'Skyhook three, gust front coming through the field, wind two nine zero at thirty.', voice: 'approach', urgency: 1 },
        shake: 0.35,
        debrief: 'A gust front came through on the first crossing',
      },
      {
        id: 'rain',
        step: 'back',
        at: [8, 24],
        run: (ctx) => Fun.weatherTurn(ctx, 'rainy', 600),
        say: { text: "Skyhook three, rain's reached the field. Deck lights are on for you.", voice: 'approach', urgency: 1 },
        debrief: 'The rain arrived for the second trip',
      },
    ],
    steps: [
      {
        id: 'board1',
        text: 'Hold it on the deck while the first worker boards.',
        get hint() {
          return assistWords('Stay down and still. Five seconds.', 'Collective down, feet still. Five seconds.');
        },
        atc: {
          text: 'Skyhook three, Ironhead Control. Storm is an hour out, two to come off Delta for Alpha. Two trips, make them quick ones.',
          voice: 'approach',
          urgency: 1,
        },
        targetLabel: 'Ironhead Delta',
        target: (ctx) => siteAt(ctx, 'delta'),
        enter: (ctx) => {
          ctx.data.boardHeld = 0;
        },
        check: (ctx, dt) => holdOnGround(ctx, dt, 5),
        onDone: (ctx) => {
          load(ctx, CASUALTY_KG);
          ctx.sim.hud.notify('First one aboard.', 'good', 3.5);
        },
      },
      {
        id: 'trip1',
        text: 'Take him across to Ironhead Alpha and put down on the deck.',
        get hint() {
          return assistWords(
            'Shift off the deck, then W towards the arrow. Stop over the deck FIRST, then hold Ctrl.',
            'Off the deck and let the speed build. Stop over the deck before you descend — a slide is a swim.'
          );
        },
        targetLabel: 'Ironhead Alpha',
        target: (ctx) => siteAt(ctx, 'alpha'),
        check: (ctx) => onDeck(ctx, 'alpha'),
        onDone: (ctx) => {
          unload(ctx);
          ctx.data.across = 1;
          ctx.sim.hud.showBanner('One across', 'Back to Delta for the second.', 'good', 4);
          ctx.sim.speak('Skyhook three, one off on Alpha, returning Delta.', 'pilot');
        },
      },
      {
        id: 'back',
        /*
         * THE CHECKPOINT: landed on Alpha with one across. A fail on the
         * second trip offers "Try again from: First worker across", with the
         * clock where it was — so the score stays honest.
         */
        checkpoint: 'First worker across',
        snap: (ctx) => ({ across: 1 }),
        restore: (ctx) => {
          ctx.data.across = 1;
          unload(ctx);
        },
        text: 'Back to Delta for the second one.',
        hint: 'Same leg, the other way. The wind has changed, so it is not the same leg.',
        targetLabel: 'Ironhead Delta',
        target: (ctx) => siteAt(ctx, 'delta'),
        check: (ctx) => onDeck(ctx, 'delta'),
      },
      {
        id: 'board2',
        text: 'Hold it on the deck while the second worker boards.',
        get hint() {
          return assistWords('Stay down and still. Five seconds.', 'Collective down, feet still. Five seconds.');
        },
        targetLabel: 'Ironhead Delta',
        target: (ctx) => siteAt(ctx, 'delta'),
        enter: (ctx) => {
          ctx.data.boardHeld = 0;
        },
        check: (ctx, dt) => holdOnGround(ctx, dt, 5),
        onDone: (ctx) => {
          load(ctx, CASUALTY_KG);
          ctx.sim.hud.notify('Second one aboard. Last trip.', 'good', 3.5);
        },
      },
      {
        id: 'trip2',
        text: 'Bring the second one across to Alpha, in the rain.',
        hint: 'Trust the deck lights. Stop over them, then down.',
        atc: { text: 'Skyhook three off Delta, last one aboard, Alpha.', voice: 'pilot' },
        targetLabel: 'Ironhead Alpha',
        target: (ctx) => siteAt(ctx, 'alpha'),
        check: (ctx) => onDeck(ctx, 'alpha'),
        onDone: (ctx) => {
          unload(ctx);
          ctx.data.across = 2;
        },
      },
    ],
    tick: (ctx, dt) => {
      heliTick(ctx, dt);
      trackTouchdowns(ctx);
    },
    failIf: (ctx) =>
      ctx.elapsed > RIG_LIMIT ? 'The storm closed the field with a worker still on Delta — two straight trips, no detours, inside twelve minutes' : null,
    onComplete: (ctx) => {
      unload(ctx);
      clearHeliProps(ctx.sim);
      ctx.sim.speak('Skyhook three, both off Delta and on Alpha. Shut down and sit the storm out. Good job.', 'tower');
    },
    finale: { view: 'orbit', say: 'Both across, and the field is closed behind you.', voice: 'tower' },
    score: (ctx) => {
      const l = ctx.data.lastTouchdown;
      const gentle = l ? Math.max(0, 1 - Math.abs(l.vsFpm) / 500) : 0.3;
      const worst = ctx.data.worstVs || 0;
      return Math.round(clamp(40 + gentle * 20 + Math.max(0, 1 - worst / 700) * 20 + Math.max(0, 1 - ctx.elapsed / 720) * 20, 0, 100));
    },
  },

  /* ------------------------------------------------------------------ *
   * RAVEN CRAG — the hardest hover in the game, with the cloud coming.
   * ------------------------------------------------------------------ */
  {
    id: 'raven-crag',
    game: 'heli',
    category: 'rescue',
    name: 'Raven Crag',
    short: 'Winch off the valley wall',
    difficulty: 'Very hard',
    icon: '▲',
    map: 'ravencrag',
    aircraft: 'harrier',
    blurb:
      'A climber with a broken ankle is on Anvil Shelf, high on the east wall of the valley. Winch him off '
      + 'the cliff before the cloud comes down over the shelf.',
    reward: 'Teaches a hover beside a cliff in the updraught, and a clock you cannot argue with.',
    weather: { time: 'day', condition: 'cloudy', windSpeedKts: 20, windDirDeg: 255 },
    timeLimit: 600,
    parTime: 360,
    medals: { silver: 64, gold: 80, goldHint: 'Off the shelf first time and down in the valley inside six minutes' },
    onStart: (ctx) => {
      begin(ctx);
      ctx.data.cloudAt = null;
      ctx.data.picked = false;
      siteMarker(ctx, siteAt(ctx, 'ridge'), 0xff6a4d);
      drawGustAt(ctx, 3, 7);
    },
    /*
     * AIRBORNE START. Anvil Shelf is 800 m up and the station is at 57 m: a
     * climb from the pad is three minutes of holding Shift with nothing in
     * it, which is exactly the dead minute the plan forbids. So the call
     * comes while Skyhook three is already up on a valley patrol, 450 m
     * over the station, nose on the shelf, at the airborne start's 80% fuel.
     */
    spawn: {
      get pos() {
        return siteAt(null, 'hospital');
      },
      headingDeg: 53,
      altAGL: 450,
      speed: 15,
    },
    /*
     * THE TWIST: the cloud base comes down the valley. It is said on the
     * radio and seen in the world (the air greys, the fog thickens), and
     * from then on there are four minutes before the shelf is in cloud. The
     * updraught off the face is the other thing the hover has to hold
     * against, and a gust in the hold on top of it.
     */
    beats: [
      {
        id: 'cloud',
        at: [60, 90],
        run: (ctx) => {
          ctx.data.cloudAt = ctx.runner.elapsed;
          Fun.weatherTurn(ctx, 'rainy', 900, { rain: 0.15, fog: 0.00032, cloudBase: 520 });
        },
        say: { text: 'Skyhook three, Corrie base. Cloud base is coming down the valley — you have about four and a half minutes on the shelf.', voice: 'approach', urgency: 1 },
        line: 'Cloud coming down the valley — four and a half minutes on the shelf.',
        debrief: 'The cloud base came down the valley',
      },
      {
        id: 'closing',
        when: (ctx) => ctx.data.cloudAt != null && !ctx.data.picked && ctx.runner.elapsed > ctx.data.cloudAt + CRAG_CLOSE - 75,
        run: (ctx) => Fun.weatherTurn(ctx, 'stormy', 900, { rain: 0.25, fog: 0.00048, cloudBase: 420 }),
        say: { text: "Cloud's on the top of the wall. Ninety seconds, then we are off.", voice: CREW, urgency: 1 },
        debrief: 'The shelf was ninety seconds from closing in',
      },
      {
        id: 'updraught',
        step: 'winch',
        at: 1,
        run: (ctx) => Fun.shear(ctx, { down: -4, headwind: 3, secs: 60 }),
        say: { text: "There's lift off the face — watch your height, it wants to climb.", voice: CREW },
      },
      {
        id: 'gust',
        step: 'winch',
        when: gustInHover,
        run: (ctx) => Fun.gust(ctx, { mult: 1.4, turnDeg: 30, secs: 14 }),
        say: { text: 'Gust off the crag — hold it, hold it.', voice: CREW, urgency: 1 },
        shake: 0.35,
        debrief: 'A gust off the crag in the hover',
      },
    ],
    steps: [
      {
        id: 'out',
        text: 'Climb to Anvil Shelf, high on the east wall of the valley ahead of you.',
        get hint() {
          return assistWords(
            'The shelf is still above you. Hold Shift on the way — arrive HIGH, then come down to it.',
            'Climb in the valley first. Arriving at a cliff low is arriving with no options.'
          );
        },
        atc: {
          text: 'Skyhook three, Corrie base. Climber, broken ankle, on Anvil Shelf. Wind two five five at twenty, lift off the face. Winch job.',
          voice: 'approach',
          urgency: 1,
        },
        targetLabel: 'Anvil Shelf',
        target: (ctx) => siteAt(ctx, 'ridge'),
        check: (ctx) => dist2D(ctx.ac.pos, siteAt(ctx, 'ridge')) < 350 && ctx.ac.airborneTime > 8,
      },
      winchAt({
        id: 'winch',
        text: 'Hold a hover over the shelf at fifty feet, beside the cliff, for twelve seconds.',
        hint: () =>
          assistWords(
            'Let go of W A S D over the strobe. The face pushes you UP — tap Ctrl to stay in the green.',
            'The updraught off the face wants you high and the wind wants you off the rock. Small, early corrections.'
          ),
        label: 'The shelf',
        at: (ctx) => siteAt(ctx, 'ridge'),
        spec: { radius: 10, aglMin: 12, aglMax: 22, driftMax: 1.5, seconds: 12 },
        onPicked: (ctx) => {
          load(ctx, CASUALTY_KG);
          ctx.data.picked = true;
          ctx.sim.hud.showBanner('On the wire', 'He is off the shelf. Down to the station.', 'good', 4);
          ctx.sim.speak('Climber aboard. Down the valley, Skyhook.', CREW, 1);
        },
      }),
      {
        id: 'home',
        /*
         * THE CHECKPOINT: airborne, beside the shelf, with him aboard. A fall
         * on the way down restarts here, in the air, with the clock where it
         * was.
         */
        checkpoint: 'Climber aboard',
        snap: (ctx) => ({ picked: true, cloudAt: ctx.data.cloudAt }),
        restore: (ctx, s) => {
          ctx.data.picked = true;
          ctx.data.cloudAt = s && s.cloudAt != null ? s.cloudAt : ctx.runner.elapsed - 60;
          load(ctx, CASUALTY_KG);
        },
        text: 'Take him down to Corrie Rescue Station on the valley floor.',
        get hint() {
          return assistWords(
            'Fly away from the wall first, then hold Ctrl — it comes down faster from high up.',
            'Away from the face before you descend. Let the speed build and trade height on the way.'
          );
        },
        targetLabel: 'Corrie Rescue Station',
        target: (ctx) => siteAt(ctx, 'hospital'),
        check: (ctx) => landedAt(ctx, siteAt(ctx, 'hospital'), siteRadius('hospital')),
      },
    ],
    tick: heliTick,
    failIf: (ctx) => {
      if (ctx.data.cloudAt != null && !ctx.data.picked && ctx.elapsed > ctx.data.cloudAt + CRAG_CLOSE) {
        return 'The cloud closed over Anvil Shelf before the winch was in — climb straight to the shelf and hold the hover first time (four and a half minutes from the cloud call)';
      }
      if (ctx.elapsed > 585) return 'The light went before he was down — off the shelf, away from the wall, and straight down the valley (under ten minutes)';
      return null;
    },
    onComplete: (ctx) => {
      unload(ctx);
      clearHeliProps(ctx.sim);
      ctx.sim.speak('Skyhook three, Corrie base. He is in the ambulance. That was the hardest one we have.', 'tower');
    },
    finale: { view: 'orbit', say: 'Off the wall, under the cloud, and down. That was flown.', voice: 'tower' },
    score: (ctx) => {
      const l = ctx.data.lastTouchdown;
      return Math.round(clamp(50 + (l ? l.score : 25) * 0.3 + Math.max(0, 1 - ctx.elapsed / 600) * 20, 0, 100));
    },
  },
];

