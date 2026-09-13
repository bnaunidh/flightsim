/**
 * SKYHOOK RESCUE — the helicopter missions.
 *
 * Six missions and a patrol, all of them the same four beats: a call comes in,
 * you fly out, YOU HOLD A HOVER, you carry them to the hospital and set down.
 * One verb. Everything else is transport between hovers.
 *
 * They are in their own file rather than appended to missions.js because that
 * file is 1,446 lines of aeroplane and nobody should have to scroll past a
 * tornado to find the winch. missions.js imports this list and concatenates
 * it — see the patch note at the bottom of this comment.
 *
 * WHAT THIS FILE ASSUMES AND WHAT IT DOES IF THE ASSUMPTION IS NOT THERE YET.
 * Four other people are building the rest of this game at the same time as
 * me, so every single thing I depend on that does not exist today is reached
 * through a lookup with a working fallback. Nothing here throws, nothing here
 * imports a module that has not been written, and every mission is flyable on
 * the Kestrel Island map that exists right now:
 *
 *   sim.setHoverBox(spec) / sim.hoverBox   specialist 2's hover box and HUD
 *       arc. If it is absent, HoverTask below does the same arithmetic itself
 *       and talks to the player through hud.notify instead of an arc. The
 *       numbers are identical either way, so the missions do not have to know
 *       which one they got.
 *   sim.pads / MAP.scenery.pads            specialist 3's pad list. If a pad
 *       id is not found, siteAt() falls back to a coordinate measured on the
 *       real Kestrel terrain, so the mission still lands somewhere sensible.
 *   ac.extraMass                           specialist 2's load weight. Setting
 *       a field physics.js does not read yet is harmless; when it is read, the
 *       loaded legs get heavier and these missions get better for free.
 *   maps 'kestrelport' / 'stacks' / 'ironhead'   specialist 3's new maps.
 *       getMap() already returns Kestrel for an unknown id (maps.js:653), so
 *       naming a map that does not exist yet degrades to Kestrel rather than
 *       crashing — which is why every site coordinate in this file was sampled
 *       against Kestrel's own height field and not invented.
 *
 * TWO THINGS THE BRIEF ASKED FOR THAT THE ENGINE CANNOT HONESTLY GIVE, AND
 * WHAT I DID INSTEAD. Both are written up properly beside the missions.
 *   1. Fuel is not a clock. fuelBurnMax is 0.035 L/s against a 420 L tank —
 *      three and a quarter hours at full throttle, fifty minutes with the
 *      realistic-fuel switch on. A twelve-minute mission cannot run a tank
 *      dry, so LAST LIGHT runs on the light going instead, which the runner
 *      already enforces with timeLimit.
 *   2. Power margin barely moves. Hover collective is
 *      0.5 * (1 + extraMass/2200) / (rho/RHO0), so two casualties and a
 *      winchman — 360 kg — take the hover from 50% to 58% of the collective
 *      range. That is a number on the HUD, not a decision. Said out loud here
 *      so nobody writes briefing copy promising a choice the machine does not
 *      actually force.
 *
 * PATCH NOTES for whoever applies this (three small edits, all listed in the
 * hand-over, none of them in this file):
 *   missions.js  import { HELI_MISSIONS } and spread it into MISSIONS; add
 *                gameOf() and missionsFor().
 *   menus.js     one clause in syncMissionLocks, one call in setGame.
 *   main.js      call clearHeliProps(this) beside this.clearPursuer().
 */

import * as THREE from '../vendor/three.module.js';
import { heightAt, platformAt } from '../world/terrain.js';
import { UNITS } from '../aircraft/physics.js';
import { createFishingBoat } from '../fleet/maritime.js';

const clamp = THREE.MathUtils.clamp;
const ft = (m) => m * UNITS.FT;
const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Height above the SURFACE, which over water is not height above the ground.
 *
 * heightAt() returns the sea floor out at sea — minus thirty-four metres on
 * Kestrel — so ac.agl over the swimmer in MAN OVERBOARD reads fifty-two when
 * the skids are eighteen metres above the waves. Every winch height in this
 * file is measured from here instead, and the radar altimeter on the hover
 * HUD needs exactly the same treatment or it will lie over water, which is
 * precisely where this game spends its time.
 */
export function surfaceAt(x, z) {
  return Math.max(0, heightAt(x, z));
}

/* ------------------------------------------------------------------ *
 * Places.
 *
 * Every site is looked up by id first and only falls back to a number.
 * The ids are the contract with the pad system: give a map a pad with one of
 * these ids and the mission moves onto it with no edit here.
 *
 * The fallback coordinates are not guesses. They were sampled against the
 * Kestrel height field: the hospital and harbour sit on the flat 24 m coastal
 * shelf, the cove is the 16-24 m sand on the south shore, the ledge is the
 * 134 m step on the west side of Needle Rock, a hundred and ninety metres
 * clear of the lighthouse that is already standing on top of it.
 * ------------------------------------------------------------------ */
const SITES = {
  hospital: { name: 'St Brendan Hospital', x: 520, z: 760, r: 12 },
  harbour: { name: 'Harbour Head', x: -2050, z: 200, r: 13 },
  cove: { name: 'Cormorant Cove', x: -230, z: 2260, r: 14 },
  ledge: { name: 'Needle Rock ledge', x: -3280, z: -3660, r: 9 },
  eastshore: { name: 'Gannet Point', x: 2060, z: 60, r: 13 },
  swimmer: { name: 'The swimmer', x: -2950, z: 1250, r: 12 },
};

/**
 * Where a site actually is this flight.
 *
 * Order matters: the live pad list wins, then the map data, then the measured
 * fallback. The y is read from the world every time rather than stored, so a
 * pad that moves onto a roof or a rig deck brings the mission's arrow, its
 * beacon and its landing check up onto the deck with it and nothing here has
 * to be told.
 */
export function siteAt(ctx, key) {
  const fb = SITES[key] || SITES.hospital;
  const pads =
    (ctx.sim && ctx.sim.pads) ||
    (ctx.sim && ctx.sim.map && ctx.sim.map.scenery && ctx.sim.map.scenery.pads) ||
    null;
  let x = fb.x;
  let z = fb.z;
  if (pads) {
    const p = pads.find && pads.find((q) => q.id === key);
    if (p) {
      x = p.x;
      z = p.z;
    }
  }
  return new THREE.Vector3(x, surfaceAt(x, z), z);
}

function siteName(ctx, key) {
  const pads = (ctx.sim && ctx.sim.pads) || null;
  const p = pads && pads.find ? pads.find((q) => q.id === key) : null;
  return (p && p.name) || (SITES[key] && SITES[key].name) || 'the pad';
}

function siteRadius(key) {
  return (SITES[key] && SITES[key].r) || 12;
}

/**
 * Down, stopped, not broken, and in the right place.
 *
 * The aeroplane's landedAndStopped() wants a runway; a helicopter's whole
 * argument is that it does not need one. platformAt() means this is true of a
 * rig deck and a hospital roof as well as a patch of grass, with no second
 * version of the function — the deck is already the ground as far as
 * heightAt is concerned (terrain.js:239).
 */
function landedAt(ctx, pos, radius) {
  const ac = ctx.ac;
  const t = ctx.data.lastTouchdown;
  if (!ac.onGround || ac.groundSpeed > 2.2 || ac.groundTime < 1.0) return false;
  if (t && t.crashed) return false;
  return dist2D(ac.pos, pos) <= radius + 8;
}

/* ------------------------------------------------------------------ *
 * THE HOVER BOX.
 *
 * Three conditions at once for N seconds: horizontal drift under 1.5 m/s,
 * inside a 12 m circle on the ground, and the height the winch needs.
 *
 * It DRAINS when you break one. It does not reset. A child who wobbles at
 * second six should lose two seconds, not eight — a reset reads as the game
 * taking something away and they stop trying. The drain rate is 0.9, so
 * recovering costs a little more than the wobble did and holding it steadily
 * is still plainly the fastest way through.
 *
 * The circle is on the GROUND, at a real place, with a beacon standing over
 * it. It is deliberately not a hoop in the sky: missions.js line 24 already
 * threw rings out of this game for teaching you to stare at a hoop instead of
 * at the island, and a hoop you have to hold still inside for ten seconds
 * would be that mistake made worse.
 * ------------------------------------------------------------------ */
export class HoverTask {
  /**
   * @param {object} spec
   *   at        (ctx) => Vector3 — a function, because the swimmer drifts
   *   radius    metres of the lit circle on the ground
   *   aglMin/aglMax  the band the winch needs, above the SURFACE
   *   driftMax  m/s of ground speed the winchman can live with
   *   seconds   how long the cable takes down and back
   */
  constructor(spec) {
    this.spec = {
      radius: 12,
      aglMin: 15,
      aglMax: 25,
      driftMax: 1.5,
      seconds: 10,
      drain: 0.9,
      label: 'Hover',
      ...spec,
    };
    this.pos = new THREE.Vector3();
    this.held = 0;
    this.drift = 0;
    this.agl = 0;
    this.inside = false;
    this.driftOk = false;
    this.aglOk = false;
    this._remote = false;
    this._said = {};
    this._peak = 0;
  }

  /** Hand it to the real hover box if there is one; keep the arithmetic if not. */
  attach(ctx) {
    // Seed the position now. target() hands this to the arrow, the wingtip
    // rails and the beacon, and activeTarget() is asked for it before the
    // first tick — so without this the guidance points at the map origin for
    // one frame every time a winch step begins.
    this.pos.copy(this.spec.at(ctx));
    if (ctx.sim && typeof ctx.sim.setHoverBox === 'function') {
      ctx.sim.setHoverBox({ ...this.spec });
      this._remote = true;
    }
    return this;
  }

  get done() {
    return this.held >= this.spec.seconds;
  }

  /** 0..1, for anything that wants to draw an arc. */
  get fraction() {
    return clamp(this.held / this.spec.seconds, 0, 1);
  }

  update(dt, ctx) {
    this.pos.copy(this.spec.at(ctx));
    /*
     * When specialist 2's box is running, it owns the numbers and this only
     * reads them. Integrating the same seconds twice would fill the arc at
     * double rate and make every winch mission trivially short, which is the
     * kind of bug that only shows up after both halves have shipped.
     */
    if (this._remote) {
      const b = ctx.sim.hoverBox;
      if (b) {
        this.held = b.held || 0;
        this.drift = b.drift != null ? b.drift : ctx.ac.groundSpeed;
        this.agl = b.agl != null ? b.agl : this.agl;
        this.inside = !!b.inside;
        this.driftOk = !!b.driftOk;
        this.aglOk = !!b.aglOk;
      }
      return;
    }

    const ac = ctx.ac;
    this.drift = ac.groundSpeed;
    this.agl = ac.pos.y - surfaceAt(ac.pos.x, ac.pos.z);
    this.inside = dist2D(ac.pos, this.pos) <= this.spec.radius;
    this.driftOk = this.drift <= this.spec.driftMax;
    this.aglOk = this.agl >= this.spec.aglMin && this.agl <= this.spec.aglMax;

    const ok = this.inside && this.driftOk && this.aglOk;
    const before = this.held;
    this.held = clamp(this.held + (ok ? dt : -dt * this.spec.drain), 0, this.spec.seconds);
    this._peak = Math.max(this._peak, this.held);

    /*
     * Without the HUD arc the player has no idea the cable is running, so say
     * so — but four times in the whole hover, not every frame. A notification
     * per second is noise and noise is worse than silence.
     */
    const hud = ctx.sim.hud;
    if (!hud) return;
    if (this.held > 0.4 && !this._said.start) {
      this._said.start = true;
      hud.notify('Cable running — hold it exactly there.', 'good', 3);
    }
    if (this.held > this.spec.seconds * 0.5 && !this._said.half) {
      this._said.half = true;
      hud.notify('Halfway. Do not chase it — small inputs.', 'info', 3);
    }
    if (before > 2 && this.held <= 0.05 && !this._said.broke) {
      this._said.broke = true;
      hud.notify('Cable snapped back. Come to a stop over the circle and try again.', 'warn', 5);
      // Allowed to fire again once they have rebuilt a real hover, or the
      // second failure passes in silence and they learn nothing from it.
      this._said.start = false;
      this._said.half = false;
      setTimeoutSafe(() => {
        this._said.broke = false;
      });
    }
    if (!ok && this.held > 1 && !this._said.why) {
      this._said.why = true;
      hud.notify(
        !this.inside
          ? 'You are drifting off the circle.'
          : !this.aglOk
            ? this.agl < this.spec.aglMin
              ? 'Too low for the winch — a little more collective.'
              : 'Too high for the winch — ease the collective down.'
            : 'Moving too fast over the ground. Stop it, then hold it.',
        'warn',
        3.4
      );
      setTimeoutSafe(() => {
        this._said.why = false;
      });
    }
  }

  dispose(ctx) {
    if (this._remote && ctx.sim && typeof ctx.sim.clearHoverBox === 'function') {
      ctx.sim.clearHoverBox();
    }
  }
}

/*
 * A five-second lockout on the repeatable messages, written as a helper so it
 * is obvious it is a lockout and not a delayed action. Timers are cleared
 * nowhere because they touch nothing but a boolean on an object the next
 * flight will have thrown away.
 */
function setTimeoutSafe(fn) {
  setTimeout(fn, 5000);
}

/* ------------------------------------------------------------------ *
 * Props the missions own: the lit circle on the ground, and the boat.
 *
 * Anything added to the scene by a mission has to be removed by something
 * that runs even when the mission FAILED, and def.onComplete is not that —
 * the runner calls its own onFail callback, not the definition's. So these
 * live in a module-level list and main.js clears it at the top of every
 * flight, exactly the way it already calls clearPursuer().
 * ------------------------------------------------------------------ */
const PROPS = [];

export function clearHeliProps(sim) {
  const scene = sim && sim.scene;
  for (const p of PROPS) {
    if (scene && p.group) scene.remove(p.group);
    if (p.dispose) {
      try {
        p.dispose();
      } catch (e) {
        /* a prop that will not tidy up must not take the next flight with it */
      }
    }
  }
  PROPS.length = 0;
}

/**
 * The place, drawn in the world: a lit ring on the ground and a strobe.
 *
 * Deliberately small. Specialist 2 owns the proper casualty props — a person
 * waving, smoke — and when sim.spawnCasualty exists this steps aside for it.
 * Until then a ring and a flashing light are enough to make the spot a place
 * rather than a coordinate, and the navigation beacon is already standing a
 * shaft of light over whatever the active step points at (main.js:3270), for
 * free, because these missions use target() like every other mission does.
 */
function siteMarker(ctx, pos, colour = 0x7dffb4) {
  if (ctx.sim && typeof ctx.sim.spawnCasualty === 'function') {
    ctx.sim.spawnCasualty({ pos, colour });
    return null;
  }
  const group = new THREE.Group();
  const ringGeo = new THREE.RingGeometry(10, 12.6, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: colour,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 0.6;
  group.add(ring);

  const strobeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), strobeMat);
  strobe.position.y = 2.2;
  group.add(strobe);

  group.position.set(pos.x, pos.y, pos.z);
  ctx.sim.scene.add(group);

  const prop = {
    group,
    t: 0,
    setPos(p) {
      group.position.set(p.x, p.y, p.z);
    },
    update(dt) {
      this.t += dt;
      // A proper aviation strobe: dark most of the second, then a hard flash.
      const f = this.t % 1.15 < 0.09 ? 1 : 0.06;
      strobeMat.color.setScalar(f);
      ringMat.opacity = 0.45 + Math.sin(this.t * 2.2) * 0.2;
    },
    dispose() {
      ringGeo.dispose();
      ringMat.dispose();
      strobe.geometry.dispose();
      strobeMat.dispose();
    },
  };
  PROPS.push(prop);
  return prop;
}

/**
 * The fishing boat, finally used.
 *
 * createFishingBoat() has been in maritime.js since the fleet went in and is
 * imported by nothing at all. It is the reason MAN OVERBOARD exists: a hull
 * making way at four knots with a man in the water astern of her is a picture
 * a ten-year-old reads instantly, and it costs one function call.
 *
 * She is scenery with a heading, not a physics object. The swimmer is the
 * hover reference and he drifts at 0.35 m/s — comfortably inside the 1.5 m/s
 * the winch will accept, because a target that drifts faster than the
 * tolerance is not a challenge, it is an impossibility.
 */
class RescueBoat {
  constructor(ctx, swimmer, headingDeg = 240, speed = 2.06) {
    this.heading = THREE.MathUtils.degToRad(headingDeg);
    this.speed = speed;
    this.swimmer = swimmer.clone();
    this.drift = new THREE.Vector3(Math.sin(this.heading + 1.2), 0, Math.cos(this.heading + 1.2))
      .normalize()
      .multiplyScalar(0.35);
    this.pos = this.swimmer
      .clone()
      .add(new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading)).multiplyScalar(60));
    this.pos.y = 0;
    this.model = null;
    try {
      this.model = createFishingBoat();
    } catch (e) {
      // No hull is survivable; no mission is not. The swimmer, the strobe and
      // the winch all work without her and the radio still says she is there.
      this.model = null;
    }
    if (this.model) {
      this.model.position.copy(this.pos);
      this.model.rotation.y = -this.heading;
      ctx.sim.scene.add(this.model);
      PROPS.push({ group: this.model });
    }
  }

  update(dt) {
    this.pos.x += -Math.sin(this.heading) * this.speed * dt;
    this.pos.z += -Math.cos(this.heading) * this.speed * dt;
    this.swimmer.addScaledVector(this.drift, dt);
    this.swimmer.y = 0;
    if (this.model) {
      this.model.position.copy(this.pos);
      // A little life in her: she rolls to the swell like everything else afloat.
      this.model.rotation.z = Math.sin(performance.now() * 0.0009) * 0.045;
      if (this.model.userData && this.model.userData.update) {
        this.model.userData.update(dt, { speed: this.speed, steer: 0, lights: true });
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * The winch step, written once.
 *
 * All four winch missions are the same beat with different words, different
 * heights and a different thing underneath. Writing it out four times is how
 * four slightly different tolerances end up in the game by accident, and the
 * tolerances are the whole difficulty of this mode — the lead budgeted a day
 * on them. One factory means one place to tune.
 * ------------------------------------------------------------------ */
function winchStep({ id, text, hint, atc, label, at, spec = {}, onPicked }) {
  return {
    id,
    text,
    hint,
    atc,
    targetLabel: label,
    /*
     * The arrow, the wingtip rails and the beacon all follow this. Pointing
     * it at the live hover position rather than a fixed coordinate is what
     * makes the beacon stand over the drifting swimmer instead of over the
     * place he was when the mission started.
     */
    target: (ctx) => (ctx.data.hover ? ctx.data.hover.pos.clone() : at(ctx)),
    enter: (ctx) => {
      ctx.data.hover = new HoverTask({ at, label, ...spec }).attach(ctx);
    },
    check: (ctx) => {
      const h = ctx.data.hover;
      if (!h || !h.done) return false;
      if (onPicked) onPicked(ctx);
      h.dispose(ctx);
      ctx.data.hoverPeak = Math.max(ctx.data.hoverPeak || 0, h._peak);
      ctx.data.hover = null;
      return true;
    },
  };
}

/** Every winch mission ticks its hover and whatever is moving underneath it. */
function heliTick(ctx, dt) {
  if (ctx.data.hover) ctx.data.hover.update(dt, ctx);
  if (ctx.data.boat) ctx.data.boat.update(dt);
  for (const p of PROPS) if (p.update) p.update(dt);
  if (ctx.data.marker && ctx.data.boat) ctx.data.marker.setPos(ctx.data.boat.swimmer);
}

/**
 * What the load weighs.
 *
 * A casualty, a stretcher and the winchman come to about ninety-five kilos on
 * a 2,200 kg machine. SPEC.mass is per-type rather than per-instance, so the
 * weight goes on the instance as extraMass and physics.js adds it to the
 * weight term only — the inertia tensor does not change, so a loaded Skyhook
 * turns exactly as crisply as an empty one. That is knowingly wrong and it is
 * the right trade: modelling the inertia change is a day of tuning for
 * something no ten-year-old will ever perceive, whereas a load that weighs
 * nothing is a lie they notice the first time they cannot climb.
 */
const CASUALTY_KG = 95;

function load(ctx, kg) {
  ctx.ac.extraMass = (ctx.ac.extraMass || 0) + kg;
}

function unload(ctx) {
  ctx.ac.extraMass = 0;
}

/* ================================================================== *
 * THE MISSIONS.
 * ================================================================== */

export const HELI_MISSIONS = [
  /* ------------------------------------------------------------------ *
   * 1. FIRST LIGHT — adds the collective, and nothing else.
   *
   * No winch, no casualty, no way to fail but flying into the ground. The
   * first time a child holds twenty feet for five seconds the arc fills and
   * the radio says so, and that single moment is the whole game in miniature.
   * ------------------------------------------------------------------ */
  {
    id: 'firstlight',
    game: 'heli',
    name: 'First Light',
    short: 'Your first hover',
    difficulty: 'Easy',
    icon: '⇧',
    map: 'kestrel-port',
    aircraft: 'harrier',
    blurb:
      'Lift the skids off the harbour pad, hold twenty feet, turn on the spot with the pedals, and put '
      + 'it back down on the H. That is the entire flight, and it is harder than it sounds.',
    reward: 'Teaches the collective, the pedals, and what holding a hover actually feels like.',
    weather: { time: 'day', condition: 'clear', windSpeedKts: 4, windDirDeg: 250 },
    parTime: 200,
    onStart: (ctx) => {
      unload(ctx);
      ctx.data.turned = 0;
      siteMarker(ctx, siteAt(ctx, 'harbour'));
    },
    spawn: { pos: new THREE.Vector3(SITES.harbour.x, 0, SITES.harbour.z), headingDeg: 250 },
    steps: [
      {
        id: 'lift',
        text: 'Hold Shift to raise the collective until the skids come off the pad.',
        hint: 'Shift lifts, Ctrl lowers. It will take about half of the range before it flies at all.',
        atc: {
          text: 'Skyhook three, Kestrel Rescue. Pad is yours, wind two five zero at four. Take your time.',
          voice: 'tower',
        },
        check: (ctx) => ctx.ac.agl > 2.5 && ctx.ac.airborneTime > 1.2,
      },
      winchStep({
        id: 'hold',
        text: 'Now hold twenty feet for five seconds. Do not chase it — tiny taps of Shift and Ctrl.',
        hint: 'If it climbs, let go of Shift and wait. The machine takes a second to answer. Wait for it.',
        label: 'The pad',
        at: (ctx) => siteAt(ctx, 'harbour'),
        /*
         * Wide on purpose, all four numbers. This is the first hover anybody
         * ever flies, on a school Chromebook, with Shift and Ctrl — which is
         * a rate control with three integrators between the key and the
         * height. An eighteen-metre circle and a seven-metre height band is
         * the difference between a child finishing this and a child deciding
         * helicopters are not for them.
         */
        spec: { radius: 18, aglMin: 4, aglMax: 11, driftMax: 2.5, seconds: 5, drain: 0.7 },
      }),
      {
        id: 'turn',
        text: 'Good. Now turn right on the spot with E, until you are facing the sea.',
        hint: 'Q and E are the pedals. They spin the nose without moving the machine anywhere.',
        enter: (ctx) => {
          ctx.data.startHeading = ctx.ac.heading;
        },
        check: (ctx) => {
          const d = Math.abs(((ctx.ac.heading - ctx.data.startHeading + 540) % 360) - 180);
          return d > 75 && ctx.ac.agl > 2;
        },
      },
      {
        id: 'down',
        text: 'Come back down onto the H and set her down gently.',
        hint: 'Ease the collective off a little at a time. Aim for the middle and let it settle.',
        targetLabel: 'Harbour Head',
        target: (ctx) => siteAt(ctx, 'harbour'),
        check: (ctx) => landedAt(ctx, siteAt(ctx, 'harbour'), siteRadius('harbour')),
      },
    ],
    tick: heliTick,
    onComplete: (ctx) => {
      ctx.sim.speak('Skyhook three, that is a hover. Everything else we do is that.', 'tower');
      clearHeliProps(ctx.sim);
    },
    score: (ctx) => {
      const l = ctx.data.lastTouchdown;
      return Math.round(45 + (l ? l.score : 25) * 0.45 + Math.max(0, 1 - ctx.elapsed / 420) * 10);
    },
  },

  /* ------------------------------------------------------------------ *
   * 2. THE BEACH — adds a confined landing and a passenger.
   *
   * Still no winch. One new idea at a time: approaching a SPOT instead of a
   * strip, and discovering on the way home that the machine is heavier than
   * it was on the way out.
   * ------------------------------------------------------------------ */
  {
    id: 'covepickup',
    game: 'heli',
    name: 'The Cove',
    short: 'Beach pickup',
    difficulty: 'Easy',
    icon: '⌒',
    map: 'kestrel-port',
    aircraft: 'harrier',
    blurb:
      'A walker on Cormorant Cove has gone over on her ankle. There is sand enough to land on, just. '
      + 'Put it down beside her, wait while she is loaded, and take her to the hospital pad.',
    reward: 'Teaches approaching a spot rather than a runway, and that a loaded machine flies differently.',
    weather: { time: 'day', condition: 'clear', windSpeedKts: 7, windDirDeg: 200 },
    parTime: 330,
    onStart: (ctx) => {
      unload(ctx);
      siteMarker(ctx, siteAt(ctx, 'cove'), 0xffb347);
    },
    spawn: { pos: new THREE.Vector3(SITES.harbour.x, 0, SITES.harbour.z), headingDeg: 120 },
    steps: [
      {
        id: 'out',
        text: 'Lift off and fly round the south of the island to Cormorant Cove.',
        hint: 'Nose down a little with W to go forwards. It flies like an aeroplane once it is moving.',
        atc: {
          text: 'Skyhook three, Rescue Coordination. Walker with a broken ankle on Cormorant Cove, she is not going anywhere. No rush, fly it properly.',
          voice: 'approach',
        },
        targetLabel: 'Cormorant Cove',
        target: (ctx) => siteAt(ctx, 'cove'),
        check: (ctx) => dist2D(ctx.ac.pos, siteAt(ctx, 'cove')) < 500 && ctx.ac.airborneTime > 8,
      },
      {
        id: 'land',
        text: 'Come to a stop over the cove, then let it down onto the sand beside her.',
        hint: 'Stop first, THEN descend. Trying to do both at once is what puts helicopters in the sea.',
        targetLabel: 'Cormorant Cove',
        target: (ctx) => siteAt(ctx, 'cove'),
        check: (ctx) => landedAt(ctx, siteAt(ctx, 'cove'), siteRadius('cove')),
      },
      {
        id: 'wait',
        /*
         * Twelve seconds of doing nothing, on the ground, with the rotor
         * running. It is not padding: it is the only moment in the game where
         * a child sits still and watches somebody being helped, and it is
         * where the weight arrives so that the difference on the way home is
         * something they felt happen rather than a number in a briefing.
         */
        text: 'Keep her steady on the ground while they load the stretcher.',
        hint: 'Stay put. Collective down, feet still.',
        enter: (ctx) => {
          ctx.sim.hud.notify('Loading — hold it still.', 'info', 4);
        },
        check: (ctx) => {
          if (!ctx.ac.onGround) {
            ctx.sim.hud.notify('They are still loading — get back down.', 'warn', 4);
            return false;
          }
          return ctx.runner.stepElapsed > 12;
        },
        onDone: (ctx) => {
          load(ctx, CASUALTY_KG);
          ctx.sim.hud.notify('She is aboard. The machine is heavier now.', 'good', 5);
        },
      },
      {
        id: 'home',
        text: 'Take her to the hospital pad. She is aboard, so fly it gently.',
        hint: 'It will want more collective than it did on the way out. That is the extra weight.',
        atc: { text: 'Skyhook three lifting, one aboard, routing to St Brendan.', voice: 'pilot' },
        targetLabel: 'St Brendan Hospital',
        target: (ctx) => siteAt(ctx, 'hospital'),
        check: (ctx) => landedAt(ctx, siteAt(ctx, 'hospital'), siteRadius('hospital')),
      },
    ],
    tick: heliTick,
    onComplete: (ctx) => {
      unload(ctx);
      clearHeliProps(ctx.sim);
      ctx.sim.speak('Skyhook three, she is with the doctors. Nicely flown.', 'tower');
    },
    score: (ctx) => {
      const l = ctx.data.lastTouchdown;
      const gentle = l ? Math.max(0, 1 - Math.abs(l.vsFpm) / 500) : 0.3;
      return Math.round((l ? l.score : 30) * 0.45 + gentle * 30 + Math.max(0, 1 - ctx.elapsed / 600) * 25);
    },
  },

  /* ------------------------------------------------------------------ *
   * 3. MAN OVERBOARD — adds the winch, over something that will not hold
   *    still. This is the mission the entire game exists for, and it is
   *    number three so that nobody meets it cold.
   * ------------------------------------------------------------------ */
  {
    id: 'overboard',
    game: 'heli',
    name: 'Man Overboard',
    short: 'The winch',
    difficulty: 'Medium',
    icon: '≋',
    map: 'kestrel-port',
    aircraft: 'harrier',
    blurb:
      'A crewman is in the water sixty metres astern of the Kestrel fishing boat. There is nowhere to '
      + 'land and nothing to land on. Hold a hover over him at sixty feet while the winch does the rest.',
    reward: 'Teaches the winch, and holding a hover over something that is moving.',
    weather: { time: 'day', condition: 'cloudy', windSpeedKts: 9, windDirDeg: 250 },
    parTime: 420,
    onStart: (ctx) => {
      unload(ctx);
      const swimmer = siteAt(ctx, 'swimmer');
      ctx.data.boat = new RescueBoat(ctx, swimmer);
      ctx.data.marker = siteMarker(ctx, ctx.data.boat.swimmer, 0xff6a4d);
    },
    spawn: { pos: new THREE.Vector3(SITES.harbour.x, 0, SITES.harbour.z), headingDeg: 300 },
    steps: [
      {
        id: 'out',
        text: 'Lift off and head out over the bay. The boat is about a mile and a half north-west.',
        hint: 'Follow the beacon. The orange strobe in the water is your man.',
        atc: {
          text: 'Skyhook three, Rescue Coordination. Man in the water off the Kestrel fishing boat. Launch, launch, launch.',
          voice: 'approach',
          urgency: 1,
        },
        targetLabel: 'The swimmer',
        target: (ctx) => (ctx.data.boat ? ctx.data.boat.swimmer.clone() : siteAt(ctx, 'swimmer')),
        check: (ctx) =>
          ctx.data.boat && dist2D(ctx.ac.pos, ctx.data.boat.swimmer) < 400 && ctx.ac.airborneTime > 8,
      },
      winchStep({
        id: 'winch',
        text: 'Come to a hover over the swimmer at about sixty feet and hold it steady. The winchman does the rest.',
        hint: 'Watch the drift, not the sea. Stop the machine first, then hold the height. Ten seconds.',
        atc: {
          text: 'Skyhook three, Rescue Coordination. Swimmer is sixty metres off her stern, you are cleared to winch.',
          voice: 'approach',
        },
        label: 'The swimmer',
        at: (ctx) => (ctx.data.boat ? ctx.data.boat.swimmer : siteAt(ctx, 'swimmer')),
        /*
         * Ten seconds of hover, not ten seconds of being nearby. Eighteen
         * metres is the winch height and the band is fifteen to twenty-five,
         * which over water means fifteen metres of clear air under the skids
         * even at the bottom of it — deliberately, because the sea does not
         * forgive and a child's first winch should not be flown at the edge.
         */
        spec: { radius: 12, aglMin: 15, aglMax: 25, driftMax: 1.5, seconds: 10 },
        onPicked: (ctx) => {
          load(ctx, CASUALTY_KG);
          ctx.sim.hud.showBanner('Winched aboard', 'He is in the cabin. Take him home.', 'good', 4);
        },
      }),
      {
        id: 'home',
        text: 'He is aboard. Take him to the hospital pad on the hill above the town.',
        hint: 'Straight across the island. The pad has a big white H on it.',
        atc: { text: 'Skyhook three, survivor recovered, routing to St Brendan.', voice: 'pilot' },
        targetLabel: 'St Brendan Hospital',
        target: (ctx) => siteAt(ctx, 'hospital'),
        check: (ctx) => landedAt(ctx, siteAt(ctx, 'hospital'), siteRadius('hospital')),
      },
    ],
    tick: heliTick,
    /*
     * The sea is the failure condition and it does not need a rule of its
     * own: flying into it is a crash and the runner already ends the mission
     * on a crash. Nothing else here can be lost, on purpose — this is the
     * mission that teaches the verb, and a mission you can fail while you are
     * still learning what the verb is teaches you to stop trying it.
     */
    onComplete: (ctx) => {
      unload(ctx);
      clearHeliProps(ctx.sim);
      ctx.sim.speak('Skyhook three, he is ashore and he is fine. That is what this machine is for.', 'tower');
    },
    score: (ctx) => {
      const l = ctx.data.lastTouchdown;
      return Math.round(40 + (l ? l.score : 25) * 0.4 + Math.max(0, 1 - ctx.elapsed / 700) * 20);
    },
  },

  /* ------------------------------------------------------------------ *
   * 4. THE LEDGE — adds nowhere to land at all.
   *
   * Winch-only, and the briefing says so before you go, because discovering
   * mid-hover that the option you were saving does not exist is not tension,
   * it is a trick.
   * ------------------------------------------------------------------ */
  {
    id: 'stackrescue',
    game: 'heli',
    name: 'The Ledge',
    short: 'Winch off a sea stack',
    difficulty: 'Hard',
    icon: '▲',
    map: 'stacks',
    aircraft: 'harrier',
    blurb:
      'A climber is stuck on a ledge on Needle Rock with a broken wrist. There is no flat ground within '
      + 'two kilometres and there is wind spilling over the top of the rock. The winch is the only way.',
    reward: 'Teaches holding a hover when the air will not hold still and there is no second option.',
    weather: { time: 'day', condition: 'cloudy', windSpeedKts: 18, windDirDeg: 300 },
    timeLimit: 600,
    parTime: 400,
    onStart: (ctx) => {
      unload(ctx);
      ctx.data.gaveUp = false;
      siteMarker(ctx, siteAt(ctx, 'ledge'), 0xff6a4d);
    },
    spawn: { pos: new THREE.Vector3(SITES.hospital.x, 0, SITES.hospital.z), headingDeg: 300 },
    steps: [
      {
        id: 'out',
        text: 'Lift off and fly out to Needle Rock. It is about four kilometres north-west.',
        hint: 'Get some height on the way. Arriving low at a cliff is arriving with no options.',
        atc: {
          text: 'Skyhook three, Rescue Coordination. Climber on the west face of Needle Rock, winch job, there is nowhere to put you down. Wind is eighteen over the top.',
          voice: 'approach',
          urgency: 1,
        },
        targetLabel: 'Needle Rock',
        target: (ctx) => siteAt(ctx, 'ledge'),
        check: (ctx) => dist2D(ctx.ac.pos, siteAt(ctx, 'ledge')) < 600 && ctx.ac.airborneTime > 10,
      },
      winchStep({
        id: 'winch',
        text: 'Hold a hover over the ledge at sixty feet for twelve seconds while they get him into the strop.',
        hint: 'The wind is pushing you off the rock. Hold a little into it and keep correcting — small, steady, early.',
        label: 'The ledge',
        at: (ctx) => siteAt(ctx, 'ledge'),
        /*
         * Twelve seconds rather than ten, and that is the entire increase in
         * difficulty over MAN OVERBOARD. The wind does the rest: eighteen
         * knots across a hover is a real correction to hold, and it is the
         * first time the player has to fly INTO something to stay still.
         */
        spec: { radius: 12, aglMin: 15, aglMax: 26, driftMax: 1.5, seconds: 12 },
        onPicked: (ctx) => {
          load(ctx, CASUALTY_KG);
          ctx.sim.hud.showBanner('On the wire', 'He is off the rock. Take him home.', 'good', 4);
        },
      }),
      {
        id: 'home',
        text: 'Take him to the hospital pad.',
        hint: 'Come off the rock and let the speed build before you climb.',
        targetLabel: 'St Brendan Hospital',
        target: (ctx) => siteAt(ctx, 'hospital'),
        check: (ctx) => landedAt(ctx, siteAt(ctx, 'hospital'), siteRadius('hospital')),
      },
    ],
    tick: (ctx, dt) => {
      heliTick(ctx, dt);
      /*
       * Going home without him is allowed, and it scores — badly.
       *
       * The runner is strictly linear: there is no branch, no alternative
       * step, no way to write "or". But complete() is a public method, so a
       * mission can end itself early and let its own score function say what
       * that was worth. Sitting the machine down on the hospital pad with an
       * empty cabin is a real decision a real pilot makes, and a game that
       * only allows the brave answer is not teaching judgement.
       */
      if (ctx.data.gaveUp || (ctx.ac.extraMass || 0) > 0) return;
      if (ctx.runner.stepIndex < 1) return;
      if (landedAt(ctx, siteAt(ctx, 'hospital'), siteRadius('hospital')) && ctx.elapsed > 60) {
        ctx.data.gaveUp = true;
        ctx.sim.speak(
          'Skyhook three is back on the ground, no survivor aboard. Understood. The lifeboat will try from the water.',
          'tower',
          1
        );
        ctx.sim.hud.showBanner('You came home empty', 'A real decision, honestly made.', 'warn', 6);
        ctx.runner.complete();
      }
    },
    onComplete: (ctx) => {
      unload(ctx);
      clearHeliProps(ctx.sim);
      if (!ctx.data.gaveUp) {
        ctx.sim.speak('Skyhook three, he is in the ambulance. That was flown properly.', 'tower');
      }
    },
    score: (ctx) => {
      if (ctx.data.gaveUp) return 22;
      const l = ctx.data.lastTouchdown;
      return Math.round(50 + (l ? l.score : 25) * 0.35 + Math.max(0, 1 - ctx.elapsed / 700) * 15);
    },
  },

  /* ------------------------------------------------------------------ *
   * 5. NIGHT DECK — adds darkness, weather, and a deck.
   *
   * Uses the night, the rain, the wind and the beacon exactly as they are.
   * The deck is looked up: a rig on Ironhead when that map exists, and the
   * carrier — which every map already has, because carrierBerth() finds deep
   * water wherever you are (main.js:2191) — until then. A pitching deck at
   * night in rain is the same lesson either way.
   * ------------------------------------------------------------------ */
  {
    id: 'nightdeck',
    game: 'heli',
    name: 'Night Deck',
    short: 'Deck landing, night, rain',
    difficulty: 'Hard',
    icon: '⬢',
    map: 'rigs',
    aircraft: 'harrier',
    blurb:
      'A crewman has been hurt out in open water, on a deck, at night, in rain, with twenty knots of '
      + 'wind across it. Get out there, get down on the deck, and bring him in.',
    reward: 'Teaches night flying, a deck approach and trusting the lights instead of the window.',
    weather: { time: 'night', condition: 'rainy', windSpeedKts: 20, windDirDeg: 270 },
    timeLimit: 780,
    parTime: 540,
    onStart: (ctx) => {
      unload(ctx);
    },
    spawn: { pos: new THREE.Vector3(SITES.hospital.x, 0, SITES.hospital.z), headingDeg: 270 },
    steps: [
      {
        id: 'out',
        text: 'Lift off and fly out to the deck. It is dark and it is raining — fly the instruments.',
        hint: 'The beacon is the only thing out there. Hold a height and let it come to you.',
        atc: {
          text: 'Skyhook three, Rescue Coordination. Casualty on the deck, wind two seven zero at twenty, deck lights are on for you.',
          voice: 'approach',
          urgency: 1,
        },
        targetLabel: 'The deck',
        target: (ctx) => deckTarget(ctx),
        check: (ctx) => {
          const d = deckTarget(ctx);
          return !!d && dist2D(ctx.ac.pos, d) < 1200 && ctx.ac.airborneTime > 10;
        },
      },
      {
        id: 'land',
        text: 'Come to a stop over the deck, then put it down on the middle of it.',
        hint: 'Stop over the deck FIRST. If you are still sliding when you touch, you slide off the edge.',
        targetLabel: 'The deck',
        target: (ctx) => deckTarget(ctx),
        check: (ctx) => {
          const d = deckTarget(ctx);
          if (!d) return false;
          // A deck is a platform as far as heightAt is concerned, so being ON
          // one is exactly the question platformAt() answers.
          const p = platformAt(ctx.ac.pos.x, ctx.ac.pos.z);
          return !!p && landedAt(ctx, d, 40);
        },
      },
      {
        id: 'wait',
        text: 'Hold it on the deck while they carry him aboard.',
        hint: 'Stay put and keep the collective down. Ten seconds.',
        check: (ctx) => ctx.ac.onGround && ctx.runner.stepElapsed > 10,
        onDone: (ctx) => {
          load(ctx, CASUALTY_KG);
          ctx.sim.hud.notify('He is aboard.', 'good', 4);
        },
      },
      {
        id: 'home',
        text: 'Lift off the deck and take him to the hospital pad.',
        hint: 'Off the side of the deck and let it fall away a little — that is how you get flying speed.',
        atc: { text: 'Skyhook three off the deck, one aboard, inbound St Brendan.', voice: 'pilot' },
        targetLabel: 'St Brendan Hospital',
        target: (ctx) => siteAt(ctx, 'hospital'),
        check: (ctx) => landedAt(ctx, siteAt(ctx, 'hospital'), siteRadius('hospital')),
      },
    ],
    tick: heliTick,
    onComplete: (ctx) => {
      unload(ctx);
      clearHeliProps(ctx.sim);
      ctx.sim.speak('Skyhook three, ambulance has him. Well done in that weather.', 'tower');
    },
    score: (ctx) => {
      const l = ctx.data.lastTouchdown;
      const gentle = l ? Math.max(0, 1 - Math.abs(l.vsFpm) / 600) : 0.3;
      return Math.round(45 + (l ? l.score : 25) * 0.3 + gentle * 25);
    },
  },

  /* ------------------------------------------------------------------ *
   * 6. LAST LIGHT — the one with teeth.
   *
   * Two people, opposite ends of the map, and the light going.
   *
   * THE BRIEF ASKED FOR THIS TO BE A FUEL AND POWER PROBLEM AND IT CANNOT BE,
   * and pretending otherwise would have produced a mission whose briefing
   * promised a choice the machine never actually forces. The numbers:
   *   Fuel. 420 L at 0.035 L/s flat out is 3h20m; with the realistic-fuel
   *   switch on it is a flat 1% per thirty seconds, fifty minutes. Nothing a
   *   twelve-minute mission does can empty that tank.
   *   Power. Hover collective is 0.5 * (1 + extraMass/2200). Two casualties
   *   and a winchman is 0.58 — eight points of a range that has fifty spare.
   *
   * So the resource is the light, which the runner already enforces with
   * timeLimit, and the choice is real: the far site and back is about five
   * and a half minutes of flying before you hover at all, the near one is
   * under two. You can have both if nothing goes wrong. Taking one and going
   * home scores, because that is a defensible answer and the mission says so.
   * ------------------------------------------------------------------ */
  {
    id: 'lastlight',
    game: 'heli',
    name: 'Last Light',
    short: 'Two calls, one evening',
    difficulty: 'Very hard',
    icon: '◑',
    map: 'kestrel-port',
    aircraft: 'harrier',
    blurb:
      'Two calls at once, at opposite ends of the island, and forty minutes of daylight left. Both if '
      + 'you are quick and nothing goes wrong. One, if you are honest about the time. Your call.',
    reward: 'Teaches deciding what you can actually do, and living with the answer.',
    weather: { time: 'sunset', condition: 'cloudy', windSpeedKts: 14, windDirDeg: 280 },
    // Ten minutes. Measured against roughly 45 m/s of sensible cruise: the far
    // site round trip is about 4 minutes of flying plus a 12-second hover, the
    // near one about 100 seconds. Both, flown well, lands around 8 minutes —
    // which leaves enough margin to be a decision and not enough to be free.
    timeLimit: 600,
    parTime: 480,
    onStart: (ctx) => {
      unload(ctx);
      ctx.data.saved = 0;
      siteMarker(ctx, siteAt(ctx, 'ledge'), 0xff6a4d);
      siteMarker(ctx, siteAt(ctx, 'eastshore'), 0xffb347);
      ctx.sim.hud.notify('Two calls. Needle Rock is four kilometres out; Gannet Point is close.', 'warn', 8);
    },
    spawn: { pos: new THREE.Vector3(SITES.hospital.x, 0, SITES.hospital.z), headingDeg: 90 },
    steps: [
      {
        id: 'choose',
        text: 'Two calls. Needle Rock is far and Gannet Point is close. Lift off and go to whichever you choose.',
        hint: 'Decide now and commit. Flying half way to one and changing your mind costs you both.',
        atc: {
          text: 'Skyhook three, two jobs and one of you. Climber on Needle Rock, walker at Gannet Point. We are losing the light in about ten minutes. Your call, and we will back whichever you make.',
          voice: 'approach',
          urgency: 1,
        },
        targetLabel: 'Gannet Point',
        target: (ctx) => siteAt(ctx, 'eastshore'),
        check: (ctx) => ctx.ac.airborneTime > 6 && ctx.ac.agl > 40,
      },
      winchStep({
        id: 'first',
        text: 'Hover over whichever casualty you chose and hold it while the winch runs.',
        hint: 'The hover is the same hover it always is. Nothing about the clock changes how you fly it.',
        label: 'Casualty',
        /*
         * The hover box follows whichever of the two you actually flew to.
         * Committing the mission to one of them at the briefing would have
         * made the choice a lie: the arrow would point at the answer the
         * mission had already picked.
         */
        at: (ctx) => nearerSite(ctx, ['ledge', 'eastshore']),
        spec: { radius: 12, aglMin: 15, aglMax: 26, driftMax: 1.5, seconds: 11 },
        onPicked: (ctx) => {
          load(ctx, CASUALTY_KG);
          ctx.data.firstKey = nearerKey(ctx, ['ledge', 'eastshore']);
          ctx.sim.hud.showBanner('One aboard', 'Hospital pad. Then decide about the other.', 'good', 5);
        },
      }),
      {
        id: 'drop',
        text: 'Take them to the hospital pad and set down.',
        hint: 'Watch the clock on the way in. What is left of it is what decides the rest of this.',
        targetLabel: 'St Brendan Hospital',
        target: (ctx) => siteAt(ctx, 'hospital'),
        check: (ctx) => landedAt(ctx, siteAt(ctx, 'hospital'), siteRadius('hospital')),
        onDone: (ctx) => {
          unload(ctx);
          ctx.data.saved = 1;
          const left = Math.max(0, 600 - ctx.elapsed);
          ctx.sim.speak(
            left > 230
              ? 'Skyhook three, that is one. There is time for the other if you go now.'
              : 'Skyhook three, that is one. The light is nearly gone — shutting down here is a good answer.',
            'tower',
            1
          );
          ctx.sim.hud.showBanner(
            'One saved',
            left > 230
              ? `About ${Math.round(left / 60)} minutes of light. Go again, or shut down here.`
              : 'Not much light left. Shutting down here scores.',
            left > 230 ? 'good' : 'warn',
            7
          );
        },
      },
      {
        id: 'second',
        /*
         * The last step has two honest endings and the runner only knows how
         * to have one. So this step ends when either happens: the second
         * casualty is winched (the tick hands it over), or the machine is shut
         * down on the pad — which the player does by simply staying there,
         * and which completes the mission at the one-saved score.
         */
        text: 'Go for the second one, or stay on the pad and shut down. Both are real answers.',
        hint: 'Sitting still on the hospital pad for fifteen seconds ends the evening with one saved.',
        targetLabel: 'The other casualty',
        target: (ctx) => siteAt(ctx, ctx.data.firstKey === 'ledge' ? 'eastshore' : 'ledge'),
        enter: (ctx) => {
          ctx.data.padSit = 0;
          ctx.data.hover = new HoverTask({
            at: (c) => siteAt(c, c.data.firstKey === 'ledge' ? 'eastshore' : 'ledge'),
            radius: 12,
            aglMin: 15,
            aglMax: 26,
            driftMax: 1.5,
            seconds: 11,
            label: 'Casualty',
          }).attach(ctx);
        },
        check: (ctx) => {
          if (ctx.data.hover && ctx.data.hover.done) {
            load(ctx, CASUALTY_KG);
            ctx.data.hover.dispose(ctx);
            ctx.data.hover = null;
            ctx.data.secondAboard = true;
            ctx.sim.hud.showBanner('Two aboard', 'Hospital pad, and do not rush it.', 'good', 4);
          }
          // Either ending ends the step: the second one is on the wire, or the
          // player has shut down on the pad and called it an evening.
          return !!ctx.data.secondAboard || !!ctx.data.stopHere;
        },
      },
      {
        id: 'finish',
        text: 'Bring them in to the hospital pad.',
        hint: 'Gently. This is the bit that counts.',
        targetLabel: 'St Brendan Hospital',
        target: (ctx) => siteAt(ctx, 'hospital'),
        check: (ctx) => {
          if (ctx.data.stopHere) return true;
          if (!landedAt(ctx, siteAt(ctx, 'hospital'), siteRadius('hospital'))) return false;
          if (ctx.data.secondAboard) ctx.data.saved = 2;
          return true;
        },
      },
    ],
    tick: (ctx, dt) => {
      heliTick(ctx, dt);
      // Shutting down on the pad with nobody aboard is the "one is enough"
      // ending. Fifteen seconds sitting still, so it cannot happen by accident
      // during a handover.
      if (ctx.runner.stepIndex < 3 || ctx.data.stopHere || ctx.data.secondAboard) return;
      const onPad = landedAt(ctx, siteAt(ctx, 'hospital'), siteRadius('hospital'));
      ctx.data.padSit = onPad ? (ctx.data.padSit || 0) + dt : 0;
      if (ctx.data.padSit > 15) {
        ctx.data.stopHere = true;
        ctx.sim.speak('Skyhook three is shutting down. One is better than none, and you knew it.', 'tower', 1);
      }
    },
    onComplete: (ctx) => {
      unload(ctx);
      clearHeliProps(ctx.sim);
      const n = ctx.data.saved || 0;
      ctx.sim.hud.showBanner(
        n > 1 ? 'Two saved' : 'One saved',
        n > 1 ? 'Both of them, before the light went.' : 'The lifeboat has the other one.',
        'good',
        6
      );
    },
    score: (ctx) => {
      const l = ctx.data.lastTouchdown;
      const n = ctx.data.saved || 0;
      // Two is worth more than one and one is worth a great deal. Nobody is
      // punished for the honest answer; they are simply beaten by the brave
      // one when the brave one comes off.
      return Math.round(n * 34 + (l ? l.score : 25) * 0.3 + Math.max(0, 1 - ctx.elapsed / 900) * 12);
    },
  },

  /* ------------------------------------------------------------------ *
   * ON CALL — the free mode.
   *
   * Not "free flight with a helicopter". You start on the hospital pad, a
   * call comes in every minute or two at a real place somewhere on the map,
   * you fly out, hover, winch, and bring them home. A LIVES SAVED counter and
   * nothing else — no clock, no fail, quit whenever.
   *
   * It is a mission definition with one step that never completes, and a tick
   * that runs the loop. That is a genuine use of the runner rather than a
   * trick: the step's target() is what the arrow and the beacon follow, so
   * every call gets full navigation for free, and failOnCrash is off so that
   * putting it in the sea costs you a restart and not the session.
   * ------------------------------------------------------------------ */
  {
    id: 'oncall',
    game: 'heli',
    freeplay: true,
    name: 'On Call',
    short: 'Free patrol',
    difficulty: 'Easy',
    icon: '◍',
    map: 'kestrel-port',
    aircraft: 'harrier',
    blurb:
      'No mission and no clock. Sit on the hospital pad and wait. When a call comes in, go and get them. '
      + 'The only number is how many people you have brought home.',
    reward: 'The whole game, for as long as you like.',
    weather: { time: 'day', condition: 'clear', windSpeedKts: 8, windDirDeg: 250 },
    failOnCrash: false,
    parTime: 600,
    spawn: { pos: new THREE.Vector3(SITES.hospital.x, 0, SITES.hospital.z), headingDeg: 270 },
    onStart: (ctx) => {
      unload(ctx);
      ctx.data.saved = 0;
      ctx.data.phase = 'wait';
      /*
       * Twenty-five seconds before the first call and sixty to a hundred and
       * ten after that — not the two to four minutes the brief asked for.
       * Two minutes of an empty sky is a long time at a school break, and a
       * child who has been given nothing to do for two minutes has already
       * decided what this mode is. The gaps can be lengthened in one place if
       * play-testing says otherwise.
       */
      ctx.data.wait = 25;
      ctx.data.call = null;
    },
    steps: [
      {
        id: 'patrol',
        text: 'You are on call. Wait on the pad — the radio will tell you where to go.',
        hint: 'Nothing to do until a call comes in. Sit on the pad, or go for a look round.',
        targetLabel: 'Call',
        target: (ctx) => (ctx.data.call ? ctx.data.call.pos.clone() : siteAt(ctx, 'hospital')),
        // Never true. The mode ends when the player quits, which is the point.
        check: () => false,
      },
    ],
    tick: (ctx, dt) => {
      const d = ctx.data;
      if (d.hover) d.hover.update(dt, ctx);
      for (const p of PROPS) if (p.update) p.update(dt);

      if (d.phase === 'wait') {
        d.wait -= dt;
        if (d.wait > 0) return;
        d.call = newCall(ctx);
        d.marker = siteMarker(ctx, d.call.pos, 0xff6a4d);
        d.phase = 'out';
        ctx.sim.speak(d.call.radio, 'approach', 1);
        ctx.sim.hud.setObjective(
          `Call — ${d.call.what}`,
          `${d.call.where}. Fly out, hold a hover over them, and bring them to the hospital pad.`
        );
        ctx.sim.hud.notify(`New call: ${d.call.what}. ${d.call.where}.`, 'warn', 6);
        return;
      }

      if (d.phase === 'out') {
        if (dist2D(ctx.ac.pos, d.call.pos) > 300) return;
        d.phase = 'winch';
        d.hover = new HoverTask({
          at: () => d.call.pos,
          radius: 12,
          aglMin: 15,
          aglMax: 25,
          driftMax: 1.5,
          seconds: 10,
          label: d.call.what,
        }).attach(ctx);
        ctx.sim.hud.setObjective('Winching', 'Hold a hover over them at about sixty feet. Ten seconds.');
        return;
      }

      if (d.phase === 'winch') {
        if (!d.hover.done) return;
        d.hover.dispose(ctx);
        d.hover = null;
        load(ctx, CASUALTY_KG);
        d.phase = 'home';
        clearHeliProps(ctx.sim);
        d.marker = null;
        ctx.sim.hud.showBanner('Aboard', 'Hospital pad.', 'good', 3.5);
        ctx.sim.hud.setObjective('Take them home', 'Land on the hospital pad.');
        return;
      }

      if (d.phase === 'home') {
        if (!landedAt(ctx, siteAt(ctx, 'hospital'), siteRadius('hospital'))) return;
        unload(ctx);
        d.saved++;
        d.phase = 'wait';
        d.wait = 60 + Math.random() * 50;
        d.call = null;
        ctx.sim.hud.showBanner(
          `${d.saved} ${d.saved === 1 ? 'life' : 'lives'} saved`,
          'Stand by for the next one.',
          'good',
          5
        );
        ctx.sim.hud.setObjective('On call', 'Wait on the pad. The radio will tell you where to go.');
        ctx.sim.speak('Skyhook three, received, they are with the doctors. Stand by.', 'tower');
      }
    },
    onComplete: (ctx) => {
      clearHeliProps(ctx.sim);
      unload(ctx);
    },
    score: (ctx) => Math.min(100, (ctx.data.saved || 0) * 20),
  },
];

/* ------------------------------------------------------------------ *
 * Helpers the missions above use.
 * ------------------------------------------------------------------ */

/**
 * Where the deck is, asked of the world rather than hard-coded.
 *
 * A rig pad when the pad system has one; otherwise the carrier, which every
 * map has because carrierBerth() goes and finds deep water wherever you are.
 * Either way it is a platform, so heightAt() puts the skids on it and
 * platformAt() confirms you are actually on the steel.
 */
function deckTarget(ctx) {
  const pads = (ctx.sim && ctx.sim.pads) || null;
  const rig = pads && pads.find ? pads.find((p) => p.kind === 'deck') : null;
  if (rig) return new THREE.Vector3(rig.x, rig.elev != null ? rig.elev : surfaceAt(rig.x, rig.z), rig.z);
  const c = ctx.sim && ctx.sim.carrier;
  if (c) return new THREE.Vector3(c.pos.x, c.deckY || 24, c.pos.z);
  return null;
}

/** Whichever of these sites the machine is actually nearest to. */
function nearerKey(ctx, keys) {
  let best = keys[0];
  let bestD = Infinity;
  for (const k of keys) {
    const d = dist2D(ctx.ac.pos, siteAt(ctx, k));
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

function nearerSite(ctx, keys) {
  return siteAt(ctx, nearerKey(ctx, keys));
}

/**
 * A call, somewhere real.
 *
 * A bearing and a distance from the hospital, rejected if it lands on top of
 * the pad. Whether the world underneath it is land or water decides what kind
 * of casualty it is, which means the variety comes out of the map instead of
 * out of a list — the same reason the missions gave up floating rings.
 */
function newCall(ctx) {
  const home = siteAt(ctx, 'hospital');
  let x = home.x;
  let z = home.z;
  for (let i = 0; i < 24; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 1200 + Math.random() * 2800;
    x = home.x + Math.cos(a) * r;
    z = home.z + Math.sin(a) * r;
    if (dist2D({ x, z }, home) > 900) break;
  }
  const ground = heightAt(x, z);
  const wet = ground <= 0;
  const pos = new THREE.Vector3(x, Math.max(0, ground), z);
  const compass = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  const bearing = (Math.atan2(x - home.x, -(z - home.z)) * 180) / Math.PI;
  const dir = compass[Math.round(((bearing + 360) % 360) / 45) % 8];
  const km = (dist2D(pos, home) / 1000).toFixed(1);
  const what = wet
    ? ['A swimmer in trouble', 'A capsized dinghy', 'A crewman in the water'][Math.floor(Math.random() * 3)]
    : ['A walker with a broken leg', 'A climber who cannot get down', 'A farmer hurt in a field'][
        Math.floor(Math.random() * 3)
      ];
  return {
    pos,
    what,
    wet,
    where: `${km} km ${dir} of the hospital`,
    radio: `Skyhook three, Rescue Coordination. ${what}, ${km} kilometres ${dir} of the hospital. Launch when you are ready.`,
  };
}

/** Free flight in the helicopter, for anyone who just wants to go and look. */
export const HELI_FREE = {
  id: 'helifree',
  game: 'heli',
  name: 'Free Flight',
  steps: [],
  failOnCrash: false,
  aircraft: 'harrier',
};
