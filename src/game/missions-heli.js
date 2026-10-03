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
 * That last one is no longer needed: this file clears its own props through
 * the plug-in hooks (see HELI_PROPS_HOOK below), so main.js is not touched
 * outside the helicopter's own branches.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from './extensions.js';
import { heightAt, platformAt, MAP } from '../world/terrain.js';
import { PADS } from '../world/pads.js';
import { UNITS, SPEC } from '../aircraft/physics.js';
import { isKidMode, parkingClearance, chaseViewClear } from '../aircraft/rotor-assist.js';
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

/**
 * Metres of air under the SKIDS. The band used to be judged from the
 * machine's centre, 1.7 m higher, while the card and the altimeter now read
 * the skids — sitting on a pad is zero on the panel, and it is zero here.
 * rotor-assist.js works it out every physics step; the fallback is the same
 * sum for a machine that has not flown a step yet.
 */
export function skidHeight(ac) {
  const R = ac.rotor;
  if (R && Number.isFinite(R.heightAbove)) return R.heightAbove;
  return ac.pos.y - surfaceAt(ac.pos.x, ac.pos.z) - 1.69;
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
  /*
   * Moved, measured 2026-09-23 on Port Kestrel's own height field. (-230,
   * 2260) was the sand itself, and the sand falls eight metres across the
   * twelve-metre landing circle — a 19 degree slope, which no helicopter
   * lands on. There is no level ground on this shore at all; the nearest
   * is the grass above the cove at (-400, 2000), 32 m up, 4 degrees across
   * thirty metres.
   */
  cove: { name: 'Cormorant Cove', x: -400, z: 2000, r: 14 },
  ledge: { name: 'Needle Rock ledge', x: -3280, z: -3660, r: 9 },
  eastshore: { name: 'Gannet Point', x: 2060, z: 60, r: 13 },
  /*
   * Moved to where the words say he is. The briefing puts the boat north-west
   * of the harbour, which is where Port Kestrel's fishing fleet works
   * (boatHome -2600, -2600); (-2950, 1250) was three kilometres SOUTH-west
   * of the real quay pad. This is 1.6 km north-west of it, in open water.
   */
  swimmer: { name: 'The swimmer', x: -2900, z: -2650, r: 12 },
};

/*
 * Which pad a site means on a map that calls it something else. The Stacks
 * has no Needle Rock: its climber is on Gannet Stack, which is the same four
 * kilometres north-west of the rescue pad that the briefing always said.
 *
 * Raven Crag (Last Light, moved here 2026-10-02 — the owner: "mountain
 * rescues on mountain maps"): the high call is the Anvil Shelf, the ledge
 * 800 m up the eastern wall; the near-but-far call is the Sentinel Strip pad
 * on the knoll five kilometres down the valley. Task Force Resolute (Man
 * Overboard): the launch pad is the shore base, and the hospital is the
 * Fleet Hospital Ship's deck, which the pad list already calls 'hospital'.
 */
const SITE_ALIASES = {
  stacks: { ledge: 'gannet' },
  ravencrag: { ledge: 'ridge', eastshore: 'field' },
  carriergroup: { harbour: 'field' },
};

/*
 * Sites that are not pads, on maps other than Kestrel: a measured point in
 * the water. The task force's swimmer is between the shore base and the
 * ships, 3.5 km from the island's middle in 55 m of water, so the boat is
 * on the way out and the hospital ship on the way back.
 */
const SITES_BY_MAP = {
  carriergroup: {
    swimmer: { name: 'The swimmer', x: 2600, z: -2300, r: 12 },
  },
};

function siteFallback(key) {
  const m = MAP && SITES_BY_MAP[MAP.id];
  return (m && m[key]) || SITES[key] || SITES.hospital;
}

function padFor(key) {
  const alias = MAP && SITE_ALIASES[MAP.id] && SITE_ALIASES[MAP.id][key];
  const id = alias || key;
  for (let i = 0; i < PADS.length; i++) if (PADS[i].id === id) return PADS[i];
  return null;
}

/**
 * Where a site actually is this flight.
 *
 * Order matters: the live pad list wins, then the measured fallback. The y is
 * read from the world every time rather than stored, so a pad that moves onto
 * a roof or a rig deck brings the mission's arrow, its beacon and its landing
 * check up onto the deck with it and nothing here has to be told.
 *
 * MEASURED 2026-09-23: this used to look for `sim.pads` and
 * `sim.map.scenery.pads`, and neither has ever existed — the pad list is
 * PADS in world/pads.js. So every mission flew to the fallback numbers,
 * which were sampled on the OLD Kestrel map. On Port Kestrel the "harbour
 * pad" was a slope 2 km from the real quay pad; on The Stacks the spawn
 * point (520, 760) is open sea 48 m deep, so The Ledge put the helicopter
 * underwater on the first frame; on Ironhead Deep it is a 20-degree
 * hillside.
 */
export function siteAt(ctx, key) {
  const p = padFor(key);
  if (p) return new THREE.Vector3(p.pos.x, surfaceAt(p.pos.x, p.pos.z), p.pos.z);
  const fb = siteFallback(key);
  return new THREE.Vector3(fb.x, surfaceAt(fb.x, fb.z), fb.z);
}

function siteName(ctx, key) {
  const p = padFor(key);
  return (p && p.name) || (siteFallback(key) && siteFallback(key).name) || 'the pad';
}

function siteRadius(key) {
  const p = padFor(key);
  return (p && p.r) || (siteFallback(key) && siteFallback(key).r) || 12;
}

/** "about a mile north-west": how far and which way `to` is from `from`, for a briefing line. */
function whereWords(from, to) {
  const d = dist2D(from, to);
  const brg = (Math.atan2(to.x - from.x, -(to.z - from.z)) * 180) / Math.PI;
  const compass = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  const dir = compass[Math.round(((brg + 360) % 360) / 45) % 8];
  const km = d / 1000;
  const far = km < 1.3 ? 'about a mile' : km < 2.2 ? 'about a mile and a half' : `about ${km.toFixed(km < 5 ? 1 : 0)} kilometres`;
  return `${far} ${dir}`;
}

/**
 * A mission's start, on a pad, resolved when the flight starts — after the
 * map is built — rather than when this file is loaded. The same getter trick
 * missions.js uses for RUNWAY_START.
 */
function padSpawn(key, headingDeg) {
  return {
    get pos() {
      return siteAt(null, key);
    },
    headingDeg,
  };
}

/** Is a child flying this with the kid computer, or a pilot with a lever? */
let KID = true;
const kidWords = (kid, lever) => (KID ? kid : lever);

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
    /*
     * What the HUD's hold gauge reads. hud-rotor.js has been drawing its arc,
     * its three lights and its height band from `sim.hoverBox` since it was
     * written, and nothing ever set one — setHoverBox() does not exist — so
     * the gauge never appeared in a single winch. One object, made once,
     * updated in place.
     */
    this.box = {
      pos: this.pos,
      radius: this.spec.radius,
      minAgl: this.spec.aglMin,
      maxAgl: this.spec.aglMax,
      need: this.spec.seconds,
      held: 0,
      label: this.spec.label,
      driftOk: false,
      inCircle: false,
      aglOk: false,
      agl: 0,
    };
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
    } else if (ctx.sim) {
      ctx.sim.hoverBox = this.box;
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
    this.agl = skidHeight(ac);
    this.inside = dist2D(ac.pos, this.pos) <= this.spec.radius;
    this.driftOk = this.drift <= this.spec.driftMax;
    this.aglOk = this.agl >= this.spec.aglMin && this.agl <= this.spec.aglMax;

    const ok = this.inside && this.driftOk && this.aglOk;
    const before = this.held;
    this.held = clamp(this.held + (ok ? dt : -dt * this.spec.drain), 0, this.spec.seconds);
    this._peak = Math.max(this._peak, this.held);
    const b = this.box;
    b.held = this.held;
    b.driftOk = this.driftOk;
    b.inCircle = this.inside;
    b.aglOk = this.aglOk;
    b.agl = this.agl;
    if (ctx.sim && ctx.sim.hoverBox !== b && !this.done) ctx.sim.hoverBox = b;

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
              ? kidWords('Too low for the winch — tap Shift to go up a little.', 'Too low for the winch — a little more collective.')
              : kidWords('Too high for the winch — tap Ctrl to come down a little.', 'Too high for the winch — ease the collective down.')
            : kidWords('Moving too fast over the ground. Let go of W A S D and it will stop.', 'Moving too fast over the ground. Stop it, then hold it.'),
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
    if (ctx.sim && ctx.sim.hoverBox === this.box) ctx.sim.hoverBox = null;
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
  // A winch that was running when the last flight ended must not leave its
  // gauge on the next flight's HUD.
  if (sim) sim.hoverBox = null;
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

/*
 * HELI_PROPS_HOOK. Who calls clearHeliProps(). Every helicopter mission clears
 * them at its own top (begin()), and the flight that has to clear them
 * otherwise is the one AFTER a helicopter mission — which may be an
 * aeroplane, a boat or the car. The first repair did that with a call at the
 * top of main.js's startMode(), for every flight, which the review of
 * 30a4007 listed as an edit outside the helicopter's own branches. So it is
 * done from here, through the plug-in layer's hooks: back to the menu or the
 * runway (stop), and at the start of any flight or drive that is not a
 * helicopter mission (startMode — a helicopter mission's own begin() has
 * already run by then, from runner.start(), and made the props it needs).
 */
const HELI_IDS = new Set();
registerExtension({
  id: 'heli-mission-props',
  stop(sim) {
    clearHeliProps(sim);
  },
  startMode(sim) {
    const def = sim && sim.runner && sim.runner.def;
    if (!def || !HELI_IDS.has(def.id)) clearHeliProps(sim);
  },
});

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
    // Either words, or a function choosing words for kid mode or the lever.
    get text() {
      return typeof text === 'function' ? text() : text;
    },
    get hint() {
      return typeof hint === 'function' ? hint() : hint;
    },
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
  KID = isKidMode(ctx.ac);
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

/**
 * The top of every helicopter mission: last flight's props and gauge gone,
 * the cabin empty, and which words to use. main.js never did call
 * clearHeliProps() at the top of a flight, so a failed Man Overboard left its
 * boat and its strobe in the sea for whatever was flown next.
 */
function begin(ctx) {
  clearHeliProps(ctx.sim);
  unload(ctx);
  KID = isKidMode(ctx.ac);
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
      begin(ctx);
      ctx.data.turned = 0;
      siteMarker(ctx, siteAt(ctx, 'harbour'));
    },
    spawn: padSpawn('harbour', 250),
    steps: [
      {
        id: 'lift',
        get text() {
          return kidWords(
            'Hold Shift to lift off the pad. Let go when you are a little way up — it holds that height by itself.',
            'Hold Shift to raise the collective until the skids come off the pad.'
          );
        },
        /*
         * "About half of the range" was never true. The lever's idle is 0.18
         * of collective, so the hover sits at 39% of lever travel — and in kid
         * mode there is no range at all, Shift simply means up.
         */
        get hint() {
          return kidWords(
            'Shift goes up, Ctrl comes down, and letting go of both holds the height.',
            'Shift lifts, Ctrl lowers. It takes about 40% of the lever before it flies at all.'
          );
        },
        atc: {
          text: 'Skyhook three, Kestrel Rescue. Pad is yours, wind two five zero at four. Take your time.',
          voice: 'tower',
        },
        check: (ctx) => ctx.ac.agl > 2.5 && ctx.ac.airborneTime > 1.2,
      },
      winchStep({
        id: 'hold',
        text: () =>
          kidWords(
            'Now hold it at about twenty feet over the pad for five seconds. Let go of everything — it holds itself.',
            'Now hold twenty feet for five seconds. Do not chase it — tiny taps of Shift and Ctrl.'
          ),
        hint: () =>
          kidWords(
            'The HEIGHT light goes green in the band. Too high? Tap Ctrl. Too low? Tap Shift.',
            'If it climbs, let go of Shift and wait. The machine takes a second to answer. Wait for it.'
          ),
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
        get hint() {
          return kidWords(
            'Hold Ctrl. It slows down by itself just above the ground, so keep holding until the skids touch.',
            'Ease the collective off a little at a time. Aim for the middle and let it settle.'
          );
        },
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
      'A walker above Cormorant Cove has gone over on her ankle. There is level grass enough to land on, just. '
      + 'Put it down beside her, wait while she is loaded, and take her to the hospital pad.',
    reward: 'Teaches approaching a spot rather than a runway, and that a loaded machine flies differently.',
    weather: { time: 'day', condition: 'clear', windSpeedKts: 7, windDirDeg: 200 },
    parTime: 330,
    onStart: (ctx) => {
      begin(ctx);
      siteMarker(ctx, siteAt(ctx, 'cove'), 0xffb347);
    },
    spawn: padSpawn('harbour', 120),
    steps: [
      {
        id: 'out',
        text: 'Lift off and fly round the south of the island to Cormorant Cove.',
        get hint() {
          return kidWords(
            'Hold W to fly forwards and A or D to steer. Let go and it stops by itself.',
            'Nose down a little with W to go forwards. It flies like an aeroplane once it is moving.'
          );
        },
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
        text: 'Come to a stop over the orange ring above the cove, then let it down onto the grass beside her.',
        get hint() {
          return kidWords(
            'Let go of W over the ring so it stops, THEN hold Ctrl. It slows down by itself near the ground.',
            'Stop first, THEN descend. Trying to do both at once is what puts helicopters in the sea.'
          );
        },
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
        get hint() {
          return kidWords('Stay put. Hands off everything — it sits on its skids.', 'Stay put. Collective down, feet still.');
        },
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
        get hint() {
          return kidWords(
            'The hospital pad is on the roof. Come in above it, stop over the H, then hold Ctrl.',
            'It will want more collective than it did on the way out. That is the extra weight.'
          );
        },
        atc: { text: 'Skyhook three lifting, one aboard, routing to St Brendan.', voice: 'pilot' },
        get targetLabel() {
          return siteName(null, 'hospital');
        },
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
    /*
     * Task Force Resolute — a man in the water among the ships, out at sea
     * (the owner, 2026-10-02: "carrier ops on the carrier maps"). You launch
     * from the shore base, winch him out of 55 m of water between the island
     * and the fleet, and land him on the Fleet Hospital Ship's deck. The
     * sites come from the pad list and SITE_ALIASES/SITES_BY_MAP above, so
     * the briefing's distance and direction are worked out, not typed.
     */
    map: 'carriergroup',
    aircraft: 'harrier',
    blurb:
      'A crewman is in the water sixty metres astern of a fishing boat, out among the task force. There is nowhere to '
      + 'land and nothing to land on. Hold a hover over him at sixty feet while the winch does the rest — then take him to the hospital ship.',
    reward: 'Teaches the winch, and holding a hover over something that is moving.',
    weather: { time: 'day', condition: 'cloudy', windSpeedKts: 9, windDirDeg: 250 },
    parTime: 480,
    onStart: (ctx) => {
      begin(ctx);
      const swimmer = siteAt(ctx, 'swimmer');
      ctx.data.boat = new RescueBoat(ctx, swimmer);
      ctx.data.marker = siteMarker(ctx, ctx.data.boat.swimmer, 0xff6a4d);
    },
    spawn: padSpawn('harbour', 300),
    steps: [
      {
        id: 'out',
        get text() {
          return `Lift off and head out over the water. The boat is ${whereWords(siteAt(null, 'harbour'), siteAt(null, 'swimmer'))}.`;
        },
        hint: 'Follow the beacon. The orange strobe in the water is your man.',
        atc: {
          text: 'Skyhook three, Rescue Coordination. Man in the water off a fishing boat. Launch, launch, launch.',
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
        hint: () =>
          kidWords(
            'Let go of W A S D over the strobe and it stops and holds the spot. Shift or Ctrl until HEIGHT is green.',
            'Watch the drift, not the sea. Stop the machine first, then hold the height. Ten seconds.'
          ),
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
        get text() {
          return `He is aboard. Take him to ${siteName(null, 'hospital')} — ${whereWords(siteAt(null, 'swimmer'), siteAt(null, 'hospital'))} of where you found him.`;
        },
        hint: 'Follow the arrow. The pad has a big white H on it.',
        get atc() {
          return { text: `Skyhook three, survivor recovered, routing to ${siteName(null, 'hospital')}.`, voice: 'pilot' };
        },
        get targetLabel() {
          return siteName(null, 'hospital');
        },
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
      'A climber is stuck on top of Gannet Stack with a broken wrist, and their kit is all over the little '
      + 'pad up there. There is wind spilling over the rock and nowhere to land. The winch is the only way.',
    reward: 'Teaches holding a hover when the air will not hold still and there is no second option.',
    weather: { time: 'day', condition: 'cloudy', windSpeedKts: 18, windDirDeg: 300 },
    timeLimit: 600,
    parTime: 400,
    onStart: (ctx) => {
      begin(ctx);
      ctx.data.gaveUp = false;
      siteMarker(ctx, siteAt(ctx, 'ledge'), 0xff6a4d);
    },
    spawn: padSpawn('hospital', 300),
    steps: [
      {
        id: 'out',
        text: 'Lift off and fly out to Gannet Stack. It is about four and a half kilometres north-west.',
        get hint() {
          return kidWords(
            'The top of the stack is two hundred metres up. Hold Shift on the way — the helicopter climbs over the rock if you are low.',
            'Get some height on the way. Arriving low at a cliff is arriving with no options.'
          );
        },
        atc: {
          text: 'Skyhook three, Rescue Coordination. Climber on top of Gannet Stack, winch job, the pad up there is covered in their kit so there is nowhere to put you down. Wind is eighteen over the top.',
          voice: 'approach',
          urgency: 1,
        },
        targetLabel: 'Gannet Stack',
        target: (ctx) => siteAt(ctx, 'ledge'),
        check: (ctx) => dist2D(ctx.ac.pos, siteAt(ctx, 'ledge')) < 600 && ctx.ac.airborneTime > 10,
      },
      winchStep({
        id: 'winch',
        text: 'Hold a hover over the climber at sixty feet for twelve seconds while they get him into the strop.',
        hint: () =>
          kidWords(
            'Let go of W A S D over the strobe — the helicopter leans into the wind by itself. Shift or Ctrl until HEIGHT is green.',
            'The wind is pushing you off the rock. Hold a little into it and keep correcting — small, steady, early.'
          ),
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
        get targetLabel() {
          return siteName(null, 'hospital');
        },
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
      begin(ctx);
    },
    spawn: padSpawn('hospital', 270),
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
        get hint() {
          return kidWords(
            'Let go of W over the deck so it stops, then hold Ctrl all the way down.',
            'Stop over the deck FIRST. If you are still sliding when you touch, you slide off the edge.'
          );
        },
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
        get hint() {
          return kidWords('Stay put, hands off. Ten seconds.', 'Stay put and keep the collective down. Ten seconds.');
        },
        check: (ctx) => ctx.ac.onGround && ctx.runner.stepElapsed > 10,
        onDone: (ctx) => {
          load(ctx, CASUALTY_KG);
          ctx.sim.hud.notify('He is aboard.', 'good', 4);
        },
      },
      {
        id: 'home',
        text: 'Lift off the deck and take him to the hospital pad.',
        get hint() {
          return kidWords(
            'Shift to lift off the deck, then W towards the hospital beacon.',
            'Off the side of the deck and let it fall away a little — that is how you get flying speed.'
          );
        },
        atc: { text: 'Skyhook three off the deck, one aboard, inbound St Brendan.', voice: 'pilot' },
        get targetLabel() {
          return siteName(null, 'hospital');
        },
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
    /*
     * Raven Crag — the mountain rescue map (the owner, 2026-10-02: "mountain
     * rescues on mountain maps"): the high call is the Anvil Shelf, a ledge
     * 800 m up the eastern wall 1.3 km from the station; the far one is the
     * Sentinel Strip pad five kilometres down the valley. SITE_ALIASES maps
     * the story's 'ledge' and 'eastshore' onto those pads, and every name in
     * the words below is read off the pad list, so the same mission on
     * Kestrel still says Needle Rock and Gannet Point.
     */
    map: 'ravencrag',
    aircraft: 'harrier',
    blurb:
      'Two calls at once — one high on the mountain wall, one far down the valley — and forty minutes of daylight left. Both if '
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
      begin(ctx);
      ctx.data.saved = 0;
      siteMarker(ctx, siteAt(ctx, 'ledge'), 0xff6a4d);
      siteMarker(ctx, siteAt(ctx, 'eastshore'), 0xffb347);
      const home = siteAt(ctx, 'hospital');
      ctx.sim.hud.notify(`Two calls. ${siteName(ctx, 'ledge')} is ${whereWords(home, siteAt(ctx, 'ledge'))}; ${siteName(ctx, 'eastshore')} is ${whereWords(home, siteAt(ctx, 'eastshore'))}.`, 'warn', 8);
    },
    spawn: padSpawn('hospital', 90),
    steps: [
      {
        id: 'choose',
        get text() {
          return `Two calls: ${siteName(null, 'ledge')} and ${siteName(null, 'eastshore')}. Lift off and go to whichever you choose.`;
        },
        hint: 'Decide now and commit. Flying half way to one and changing your mind costs you both.',
        get atc() {
          return {
            text: `Skyhook three, two jobs and one of you. Climber on ${siteName(null, 'ledge')}, walker at ${siteName(null, 'eastshore')}. We are losing the light in about ten minutes. Your call, and we will back whichever you make.`,
            voice: 'approach',
            urgency: 1,
          };
        },
        get targetLabel() {
          return siteName(null, 'eastshore');
        },
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
        get targetLabel() {
          return siteName(null, 'hospital');
        },
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
        get targetLabel() {
          return siteName(null, 'hospital');
        },
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
    /*
     * Meridian City — a hospital roof in a city of rooftops (the owner,
     * 2026-10-02: "city jobs on town maps"). The calls come from a ring
     * round the hospital, land or water, so the city's streets, its park
     * and the sea round the island all turn up as places to go.
     */
    map: 'meridian',
    aircraft: 'harrier',
    blurb:
      'No mission and no clock. Sit on the hospital roof in Meridian City and wait. When a call comes in, go and get them. '
      + 'The only number is how many people you have brought home.',
    reward: 'The whole game, for as long as you like.',
    weather: { time: 'day', condition: 'clear', windSpeedKts: 8, windDirDeg: 250 },
    failOnCrash: false,
    parTime: 600,
    spawn: padSpawn('hospital', 270),
    onStart: (ctx) => {
      begin(ctx);
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
        /*
         * Home is the hospital. This pointed at the call until the call was
         * cleared, and the call is cleared on LANDING — so with them aboard
         * and the panel saying "Land on the hospital pad", the arrow and the
         * beacon still stood over the empty sea where they had been picked
         * up. Measured: the only way to find the hospital was to know it.
         */
        target: (ctx) =>
          ctx.data.call && ctx.data.phase !== 'home' ? ctx.data.call.pos.clone() : siteAt(ctx, 'hospital'),
        // Never true. The mode ends when the player quits, which is the point.
        check: () => false,
      },
    ],
    tick: (ctx, dt) => {
      const d = ctx.data;
      KID = isKidMode(ctx.ac);
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
for (const m of HELI_MISSIONS) HELI_IDS.add(m.id);

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
  /*
   * The deck NEAREST the hospital, from the real pad list — see the note on
   * siteAt(). Ironhead Deep has seven; the nearest, Foxtrot, is 3.4 km out,
   * which is the "get out there" the briefing describes. PADS carries the
   * resolved deck height in pos.y, so there is no elev to look up.
   */
  const home = siteAt(ctx, 'hospital');
  let rig = null;
  let best = Infinity;
  for (let i = 0; i < PADS.length; i++) {
    const p = PADS[i];
    if (p.kind !== 'deck') continue;
    const d = (p.pos.x - home.x) ** 2 + (p.pos.z - home.z) ** 2;
    if (d < best) {
      best = d;
      rig = p;
    }
  }
  if (rig) return new THREE.Vector3(rig.pos.x, rig.pos.y, rig.pos.z);
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

/* ------------------------------------------------------------------ *
 * WHERE FREE FLIGHT PUTS IT.
 *
 * A helicopter starts on a pad, not on the numbers of runway 09. Every map
 * has one by the airfield (`field`), and that is the first choice — but only
 * if it is fit to stand on:
 *
 *   - no road drawn over it. Measured in headless Chrome on Kestrel, the
 *     default Free Flight map: the airfield access road runs 7 m from the
 *     field pad's middle, 20 m wide and 3.7 m ABOVE the pad (17.7 m against
 *     14.0 m), so the start was a screenful of tarmac with the Skyhook buried
 *     under it until it had climbed out;
 *   - nothing taller than the deck close enough to put a hard point near it,
 *     whichever way round it is parked. Measured 2026-09-25: the next choice
 *     on Kestrel, the Cottage Hospital's roof pad, has a town block 7 m above
 *     the deck 5.9 m from the H's middle. Parked nose east (the calm-day
 *     heading) the tail boom ended 0.2 m from that wall, and a child who
 *     lifted straight up and held Ctrl hovered 6.5 m over the pad saying
 *     CAN'T LAND HERE;
 *   - a heading the Follow camera can see it from. The pad and heading
 *     chosen for room alone put the camera on the next block's roof, and
 *     the start was a grey slab with no helicopter in it (see parkOn and
 *     chaseViewClear in rotor-assist.js).
 *
 * Otherwise the fit pad nearest the runway, a roof counting 300 m further
 * than it is, a deck 1 km and a stack 3 km, so a child starts on a hospital
 * roof rather than on a sea stack. Nose into the wind when that is clear,
 * else whichever way round leaves the most room. The map data is not this
 * file's; the choice of pad and heading is.
 * ------------------------------------------------------------------ */
const START_ROOM = 5; // m from a hard point to anything taller: into wind if this clear
const START_MIN = 2.5; // m: less than this at every heading and the pad is not used

function roadOver(sim, p) {
  const roadList = (sim && sim.roads && sim.roads.list) || [];
  for (const rd of roadList) {
    const pts = rd.path || [];
    const reach = (rd.halfWidth || 18) * 0.78 + (p.r || 11);
    for (let k = 1; k < pts.length; k++) {
      const ax = pts[k - 1][0];
      const az = pts[k - 1][1];
      const ex = pts[k][0] - ax;
      const ez = pts[k][1] - az;
      const l2 = ex * ex + ez * ez;
      const t = l2 > 0 ? clamp(((p.pos.x - ax) * ex + (p.pos.z - az) * ez) / l2, 0, 1) : 0;
      if (Math.hypot(ax + ex * t - p.pos.x, az + ez * t - p.pos.z) > reach) continue;
      if (pts[k - 1][2] + (pts[k][2] - pts[k - 1][2]) * t > p.pos.y + 0.5) return true;
    }
  }
  return false;
}

/**
 * The heading with the most room on this pad, preferring into the wind —
 * among the headings the Follow camera can see the machine from.
 *
 * Measured 2026-09-25 (review of the first pass): on Kestrel's Cottage
 * Hospital roof the most-room headings were 22.5 and 157.5, equally far off
 * the calm-day 90, and the loop met 157.5 first. From there the camera stood
 * on the next block's roof and saw only that roof — 5 of 5 sight lines
 * blocked in three winds out of seven. So a heading the camera cannot see
 * from is not a choice at all, whatever its room; `view` says whether any
 * heading here was.
 */
function parkOn(p, windHdg) {
  let best = null;
  for (let i = 0; i < 16; i++) {
    const hdg = (windHdg + i * 22.5) % 360;
    const view = chaseViewClear(p.pos.x, p.pos.y, p.pos.z, hdg);
    const room = Math.min(START_ROOM, parkingClearance(SPEC, p.pos.x, p.pos.y, p.pos.z, hdg));
    // i runs outwards from the wind only one way round; the tie-break on
    // how far off the wind keeps "closest to into-wind" honest both ways.
    const off = Math.abs(((hdg - windHdg + 540) % 360) - 180);
    if (
      !best
      || (view && !best.view)
      || (view === best.view
        && (room > best.room + 0.05 || (Math.abs(room - best.room) <= 0.05 && off < best.off)))
    ) {
      best = { hdg, room, off, view };
    }
  }
  return best;
}

/**
 * The pad and heading Free Flight starts the Skyhook on, or null for a map
 * with no pads. `fromX/fromZ` is the runway start, which "nearest" means.
 */
export function heliFreeStart(sim, fromX, fromZ) {
  const w = sim && sim.weather;
  const windHdg = w && w.windSpeedKts > 3 ? Math.round(w.windDirDeg) : 90;
  const kindCost = { ground: 0, roof: 300, deck: 1000, stack: 3000 };
  const cost = (p) => Math.hypot(p.pos.x - fromX, p.pos.z - fromZ) + (kindCost[p.kind] ?? 3000);
  const field = PADS.find((p) => p.id === 'field');
  const order = PADS.slice().sort((a, b) => (a === field ? -1 : b === field ? 1 : cost(a) - cost(b)));
  // A pad with room but no heading the camera can see from is kept as a
  // second choice, ahead of the old fallback, rather than never used.
  let unseen = null;
  for (const p of order) {
    if (roadOver(sim, p)) continue;
    const park = parkOn(p, windHdg);
    if (park.room < START_MIN) continue;
    if (park.view) return { pad: p, headingDeg: park.hdg, room: park.room, view: true };
    if (!unseen) unseen = { pad: p, headingDeg: park.hdg, room: park.room, view: false };
  }
  if (unseen) return unseen;
  // Nothing fit: the field pad, or the nearest, as it always was.
  const p = field || order[0] || null;
  return p ? { pad: p, headingDeg: windHdg, room: 0, view: false } : null;
}
