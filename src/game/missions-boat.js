/**
 * The boat missions — six shouts and a patrol.
 *
 *   1. First Shout       — a broken-down dinghy off the harbour mouth.
 *   2. Man Overboard     — a swimmer somewhere inside a search area.
 *   3. The Wren, Aground — three off a fishing boat on the shoals.
 *   4. Night Shout       — the same job, in the dark, by the lights.
 *   5. In the Gale       — a casualty drifting downwind faster than you like.
 *   6. The Long Tow      — a heavy vessel on the line, through the narrow lane.
 *
 * The loop is the same every time: a shout comes in, you leave the harbour,
 * you find somebody who is somewhere awkward, you get alongside SLOWLY, you
 * take them off or take a line, and you bring them home inside the breakwater.
 * The boathouse tells you how long it took.
 *
 * Three things are taught, in this order: read the chart before you go; a boat
 * does not stop; go slowly when you get there. Nothing here can be failed by
 * hitting the bottom — that is a bang, a dent and a mark against your score,
 * never the end of the run — because a game whose whole subject is threading
 * past shallow water cannot also make touching it terminal. The child would
 * simply stop going near the shoals, and the shoals are the only interesting
 * part of the map.
 *
 * WHAT THIS FILE DEPENDS ON, and why it is so little.
 *
 * The aeroplane missions lean on the world: RUNWAY, DELIVERY_PAD, the carrier,
 * the tornado. Four other people are building the boat's world at the same
 * time as this file is being written, so leaning on any of it the same way
 * would mean six missions that cannot be played until every one of them has
 * landed. So this file owns nearly everything it needs:
 *
 *   - It places the casualties itself, in a frame built from the harbour, so
 *     it does not care where on the map the harbour ends up being put.
 *   - It builds its own casualty props and moves them itself.
 *   - It reads the depth itself, out of heightAt, which has always been there.
 *   - It counts its own groundings, so it does not wait on the new grounding
 *     model in surface.js to be able to score you on them.
 *
 * The one thing it genuinely cannot do for itself is be started and be ticked,
 * which is the thirty-line runner seam the lead has specified: `sim.subject`,
 * `boat` in the runner's ctx, and `runner.update(dt)` inside the drive branch.
 *
 * And it degrades rather than breaks. No harbour on this map yet? It finds one
 * stretch of open water off the coast and uses that. No boat maps yet? getMap
 * already falls back to Kestrel Island and every distance here is measured
 * from the harbour rather than written down, so the missions still run.
 */

import * as THREE from '../vendor/three.module.js';
import { heightAt } from '../world/terrain.js';
import { clamp } from '../core/noise.js';
import { VOICES } from '../audio/atc.js';

/*
 * The fishing boat comes from the model pack, behind a try.
 *
 * Exactly the arrangement vehicles/models.js already uses for the player's
 * launch and for the car, and for the same reason: a game that will not start
 * is worse than one that looks plain. createFishingBoat has been sitting in
 * maritime.js imported by nothing — it is a proper 9.2 m hull with a
 * wheelhouse, a derrick and working nets, and it is the casualty in two of
 * these six missions. If it is ever unavailable, `workBoatFallback` below is
 * four boxes that read as a fishing boat from two hundred metres, which is the
 * only distance anybody sees it from.
 */
let packFishingBoat = null;
try {
  ({ createFishingBoat: packFishingBoat } = await import('../fleet/maritime.js'));
} catch (e) {
  console.warn('The pack fishing boat is unavailable; using the built-in one.', e);
}

/* ------------------------------------------------------------------ *
 * Numbers. All of them in metres and metres per second, because that
 * is what the vehicle works in; knots appear only where a person reads
 * them.
 * ------------------------------------------------------------------ */

/** How deep the launch sits. The game's own text says about a metre. */
export const DRAUGHT = 1.0;

/** 1 knot in metres per second. */
const KT = 0.514444;

/**
 * "Slowly" — the speed you have to be down to before anybody will step across.
 *
 * Two knots. It is the first time the game asks for restraint instead of
 * speed, and it is the whole lesson of the boat: she carries her way, so you
 * have to have decided to slow down a long time before you get there.
 */
const ALONGSIDE_SPEED = 2 * KT;

/** How close alongside is. A 7.4 m launch beside a 9.2 m boat. */
const ALONGSIDE_RANGE = 14;

/** Seconds of holding station it takes to get one person across. */
const PER_PERSON = 5;

/**
 * The tow.
 *
 * Six and a half metres a second is about twelve and a half knots — a
 * comfortable towing speed for a small boat with something heavy behind her,
 * and slow enough that the run home is a thing you have to be patient about.
 * Past it the line comes up bar-taut; snatch the lever open and it parts.
 *
 * It is not lower than this for one reason: a tow is the one leg in the game
 * that cannot be driven at Half ahead, so every hundred metres of it costs
 * fifteen seconds of a child holding one key. Six and a half is the fastest
 * speed at which "you are pulling too hard" is still a thing you can be told.
 */
const TOW_SPEED = 6.5;
const TOW_SNATCH = 2.6; // m/s² — opening the lever hard, rather than easing it
const TOW_LENGTH = 26;

/** Under this much water beneath the keel, you are on the bottom. */
const TOUCH_DEPTH = 0.12;

/* ------------------------------------------------------------------ *
 * Sea room.
 * ------------------------------------------------------------------ */

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
/** Scratch vectors for the per-frame parts (the tow, the drift). */
const _towWant = new THREE.Vector3();
const _drift = new THREE.Vector3();

/**
 * What is under the keel.
 *
 * heightAt is negative at sea, so -h is the depth of water, and taking the
 * draught off it gives the one number a small boat is steered by: the gap
 * between the bottom of the boat and the bottom of the sea.
 *
 * This is deliberately computed here rather than imported. terrain.js is
 * gaining a `depthUnderKeel` helper in the same round of work as this file,
 * and a static import of a name that is not exported yet does not fail
 * politely at runtime — it fails at link time, and the whole game does not
 * start. It is one subtraction. When the helper lands, swap the body of this
 * function for a call to it and delete the comment.
 */
export function depthAt(x, z, draught = DRAUGHT) {
  return -heightAt(x, z) - draught;
}

/** Where a thing is, as a boat would say it: "1.4 km south-west". */
function rangeAndBearing(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  const brg = (Math.atan2(dx, -dz) * 57.2958 + 360) % 360;
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const word = points[Math.round(brg / 45) % 8];
  const dist = d > 950 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d / 50) * 50} m`;
  return { d, brg, word, text: `${dist} ${word}` };
}

/** Flat distance. Nothing in the boat game cares about height. */
function flatDist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** The boat, whichever way the runner handed it over. */
function boatOf(ctx) {
  return ctx.boat || (ctx.sim && ctx.sim.vehicle) || null;
}

/* ------------------------------------------------------------------ *
 * The harbour frame.
 *
 * Every position in every mission below is written as "so far out of the
 * harbour mouth, so far to the right of the channel" rather than as a world
 * coordinate. Three reasons, and the third is the important one.
 *
 *   1. The harbours are being sited by somebody else, this week, and three
 *      boat maps plus nine retro-fitted ones is twelve places this could
 *      have been wrong.
 *   2. The same six missions then play on any map that has a harbour, which
 *      is what makes free patrol worth having everywhere.
 *   3. It keeps the legs honest. The world is 29 km across and the launch
 *      does 22 m/s flat out; a casualty put where a mission designer's
 *      instinct says "a decent way out" is five minutes of a ten-year-old
 *      holding one key while nothing happens. Written this way, every leg in
 *      this file is a number of metres from home that you can read off the
 *      page and check against a stopwatch. Nothing here is further out than
 *      1,500 m, which is a shade over two minutes at Half ahead.
 * ------------------------------------------------------------------ */

/**
 * The harbour this map has, or one found for it.
 *
 * world/harbour.js publishes `sim.harbour` as { berth, mouth, name } when it
 * builds one. Until it does — and on any map that never gets one — the
 * fallback walks out from the middle of the map looking for water, which is
 * not a harbour but is somewhere to start and somewhere to come back to.
 */
function harbourOf(sim) {
  const h = sim && sim.harbour;
  if (h && h.berth && h.mouth) return h;
  if (!sim) return null;
  if (!sim._boatFallbackHarbour) sim._boatFallbackHarbour = findAnchorage();
  return sim._boatFallbackHarbour;
}

/**
 * Somewhere to call home on a map with no harbour in it.
 *
 * Eight bearings out of the middle, stepping 120 m at a time, looking for the
 * first place there is 4 m of water and 600 m more of it beyond. The berth
 * goes just inside that, the mouth 350 m further out. Deliberately crude: it
 * exists so that six missions and a patrol can be played and tested before the
 * harbour lands, not to be a harbour.
 */
function findAnchorage() {
  let best = null;
  for (let a = 0; a < 8; a++) {
    const rad = (a * Math.PI) / 4;
    const ux = Math.sin(rad);
    const uz = -Math.cos(rad);
    for (let r = 600; r < 9000; r += 120) {
      const x = ux * r;
      const z = uz * r;
      if (depthAt(x, z) < 3) continue;
      // Is there sea room beyond it, or is this a puddle between two hills?
      let clear = true;
      for (let k = 120; k <= 600; k += 120) {
        if (depthAt(x + ux * k, z + uz * k) < 3) clear = false;
      }
      if (!clear) continue;
      if (!best || r < best.r) best = { r, x, z, ux, uz };
      break;
    }
  }
  if (!best) {
    console.warn('No water found for a fallback anchorage; using the map origin.');
    return { berth: V(0, 0, 0), mouth: V(0, 0, -350), name: 'the moorings', improvised: true };
  }
  return {
    berth: V(best.x, 0, best.z),
    mouth: V(best.x + best.ux * 350, 0, best.z + best.uz * 350),
    name: 'the moorings',
    improvised: true,
  };
}

/**
 * The local frame: home, the way out, and the way across.
 *
 * `ahead` is metres seaward of the harbour mouth down the line of the channel.
 * `right` is metres to starboard of that line as you go out. Both signed.
 */
function frameOf(sim) {
  const h = harbourOf(sim);
  const out = V(h.mouth.x - h.berth.x, 0, h.mouth.z - h.berth.z);
  if (out.lengthSq() < 1) out.set(0, 0, -1);
  out.normalize();
  const side = V(-out.z, 0, out.x);
  return {
    harbour: h,
    berth: h.berth.clone().setY(0),
    mouth: h.mouth.clone().setY(0),
    out,
    side,
    name: h.name || 'the harbour',
    place(ahead, right = 0) {
      return V(
        h.mouth.x + out.x * ahead + side.x * right,
        0,
        h.mouth.z + out.z * ahead + side.z * right
      );
    },
  };
}

/** The frame for this run, worked out once. */
function F(ctx) {
  if (!ctx.data._frame) ctx.data._frame = frameOf(ctx.sim);
  return ctx.data._frame;
}

/**
 * Where the boat starts a shout: on the berth, pointing out.
 *
 * Every aeroplane mission carries a literal `spawn` with world coordinates in
 * it, because the runway is in the same place on every map. A harbour is not:
 * it is wherever the map put it. So the boat missions carry no spawn at all
 * and main.js asks this instead — one call, and the same answer whichever of
 * the twelve harbours you are starting from.
 */
export function boatSpawnFor(sim) {
  const f = frameOf(sim);
  return {
    pos: f.berth.clone(),
    headingDeg: (Math.atan2(f.out.x, -f.out.z) * 57.2958 + 360) % 360,
  };
}

/**
 * Somewhere awkward to be in trouble: shallow water, but not dry land.
 *
 * Walks a spiral outward from a starting point looking for a spot with between
 * `min` and `max` metres under the keel. A casualty on the edge of a shoal is
 * the entire point of the game — it is what makes the chart worth reading —
 * but a casualty the map has put on a rock is a casualty you cannot reach, so
 * the search insists on water and gives up honestly rather than cheating.
 */
function shoalNear(origin, { min = 0.6, max = 3.2, reach = 420 } = {}) {
  for (let r = 40; r <= reach; r += 40) {
    for (let a = 0; a < 12; a++) {
      const rad = (a / 12) * Math.PI * 2 + r * 0.21;
      const x = origin.x + Math.sin(rad) * r;
      const z = origin.z + Math.cos(rad) * r;
      const d = depthAt(x, z);
      if (d >= min && d <= max) return V(x, 0, z);
    }
  }
  return null;
}

/** Deep enough to sit in, near where you wanted to be. */
function waterNear(origin, want = 4) {
  if (depthAt(origin.x, origin.z) >= want) return origin.clone();
  for (let r = 60; r <= 900; r += 60) {
    for (let a = 0; a < 12; a++) {
      const rad = (a / 12) * Math.PI * 2;
      const x = origin.x + Math.sin(rad) * r;
      const z = origin.z + Math.cos(rad) * r;
      if (depthAt(x, z) >= want) return V(x, 0, z);
    }
  }
  return origin.clone();
}

/* ------------------------------------------------------------------ *
 * The casualties.
 *
 * Three props, built from primitives, in the same spirit as the fallback boat
 * in vehicles/models.js: none of them is trying to be a beautiful model, each
 * is trying to be recognisable from the helm at the distance you actually see
 * it from. Everything orange is orange because that is the one colour you can
 * pick out of grey water, and a ten-year-old looking for a person in the sea
 * needs every bit of help the palette can give them.
 * ------------------------------------------------------------------ */

/**
 * Everything this file has put in the world, so it can take it out again.
 *
 * Module-level and not per-mission on purpose. A mission that is failed or
 * abandoned never runs its onComplete, so props tidied up there would be left
 * floating for the rest of the session — which is exactly the bug that left an
 * abandoned boat off the beach before stopDrive was wired up. main.js calls
 * clearBoatProps() from startDrive, stopDrive and startMode, and each mission
 * calls it on the way in as well, so the worst case is one dinghy that lives
 * until the next thing starts.
 */
const PROPS = [];

export function clearBoatProps(scene) {
  for (const p of PROPS) {
    if (p.model && p.model.parent) p.model.parent.remove(p.model);
    else if (scene && p.model) scene.remove(p.model);
    if (p.model && p.model.userData && typeof p.model.userData.dispose === 'function') {
      try {
        p.model.userData.dispose();
      } catch (e) {
        console.warn('A casualty would not dispose cleanly.', e);
      }
    }
  }
  PROPS.length = 0;
}

/** Take one casualty out of the world — she is safe, or she has gone. */
function removeProp(prop) {
  const i = PROPS.indexOf(prop);
  if (i >= 0) PROPS.splice(i, 1);
  if (prop.model && prop.model.parent) prop.model.parent.remove(prop.model);
  if (prop.model && prop.model.userData && typeof prop.model.userData.dispose === 'function') {
    try {
      prop.model.userData.dispose();
    } catch (e) {
      console.warn('A casualty would not dispose cleanly.', e);
    }
  }
}

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.rough ?? 0.75,
    metalness: opts.metal ?? 0.05,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  });
}

/** A person: head, body, and that is all anybody sees from a boat. */
function figure(colour = 0xff7a1a) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.5, 4, 8), mat(colour));
  body.position.y = 0.55;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), mat(0xe8b98c));
  head.position.y = 1.0;
  g.add(body, head);
  return g;
}

/**
 * A small open dinghy with an outboard that has stopped, two people in it and
 * a flag on a pole.
 *
 * The flag is not decoration. A grey dinghy on a grey sea at 800 m is
 * invisible on a school laptop screen at half brightness, and a child who
 * cannot see the thing the arrow is pointing at concludes the game is broken.
 */
function makeDinghy() {
  const g = new THREE.Group();
  g.name = 'casualty-dinghy';
  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 4.2), mat(0xdfe3e0, { rough: 0.5 }));
  hull.position.y = 0.12;
  const bow = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.3, 4), mat(0xdfe3e0, { rough: 0.5 }));
  bow.rotation.x = -Math.PI / 2;
  bow.rotation.y = Math.PI / 4;
  bow.position.set(0, 0.12, -2.5);
  const tube = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.2, 6, 14), mat(0xff7a1a));
  tube.rotation.x = Math.PI / 2;
  tube.scale.set(0.68, 1.5, 1);
  tube.position.y = 0.38;
  const engine = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.5, 0.3), mat(0x23282c));
  engine.position.set(0, 0.5, 2.15);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 5), mat(0x8a8f8c));
  pole.position.y = 1.35;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), mat(0xff5a10, { rough: 1 }));
  flag.material.side = THREE.DoubleSide;
  flag.position.set(0.45, 2.3, 0);
  g.add(hull, bow, tube, engine, pole, flag);
  const a = figure();
  a.position.set(-0.3, 0.3, 0.4);
  const b = figure(0xffd23f);
  b.position.set(0.35, 0.3, -0.5);
  g.add(a, b);
  g.userData.flag = flag;
  return g;
}

/**
 * A person in the water: a head, a lifejacket, and an arm that waves.
 *
 * Smaller and harder to see than anything else in these missions, on purpose —
 * Man Overboard is a searching exercise and it would not be one if he showed
 * up at a kilometre. The waving arm is what makes him readable once you are
 * within a couple of hundred metres: movement catches the eye where colour on
 * its own does not.
 */
function makeSwimmer() {
  const g = new THREE.Group();
  g.name = 'casualty-swimmer';
  const jacket = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.15, 6, 12), mat(0xff6a12));
  jacket.rotation.x = Math.PI / 2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), mat(0xe8b98c));
  head.position.y = 0.16;
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.5, 3, 6), mat(0xff6a12));
  arm.position.set(0.3, 0.35, 0);
  arm.rotation.z = -0.5;
  g.add(jacket, head, arm);
  g.userData.arm = arm;
  return g;
}

/** Four boxes that read as a fishing boat, if the pack one is unavailable. */
function workBoatFallback() {
  const g = new THREE.Group();
  g.name = 'casualty-workboat';
  const hull = new THREE.Mesh(new THREE.BoxGeometry(3, 1.5, 9.2), mat(0x5d6860));
  hull.position.y = 0.1;
  const house = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.5, 1.9), mat(0xe3e5dd));
  house.position.set(0, 1.55, -0.8);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.6, 5), mat(0x8a8f8c));
  mast.position.set(0, 2.6, 0.5);
  g.add(hull, house, mast);
  return g;
}

/**
 * Put a casualty in the world.
 *
 * `people` is how many are aboard, and they are drawn as figures on deck so
 * that the number on the HUD and the number you can see agree — the pips
 * filling up as each one steps across is the whole emotional payload of the
 * game and it is worth the fifteen lines it costs.
 */
function spawnCasualty(ctx, kind, pos, { people = 0, heading = 0, sinking = false } = {}) {
  let model;
  if (kind === 'fishing') {
    try {
      model = packFishingBoat ? packFishingBoat() : workBoatFallback();
    } catch (e) {
      console.warn('The pack fishing boat would not build; using the built-in one.', e);
      model = workBoatFallback();
    }
  } else if (kind === 'swimmer') model = makeSwimmer();
  else model = makeDinghy();

  model.position.set(pos.x, 0, pos.z);
  model.rotation.y = heading;
  ctx.sim.scene.add(model);

  const prop = {
    kind,
    model,
    people,
    rescued: 0,
    bobPhase: Math.random() * 6.28,
    /** Set by the mission when she is on the line behind you. */
    towed: false,
    update(dt, c) {
      const t = (this.bobPhase += dt);
      if (this.towed) return; // position is the tow's business, not the sea's
      /*
       * The same sine the player's boat bobs on, so everything moves together
       * — except when she is flooding, because then maritime.js's buoyancy
       * body owns the pose and has switched matrixAutoUpdate off. Writing a
       * bob into a model whose matrix is being composed by somebody else is
       * not wrong so much as silently ignored, which is worse.
       */
      const sea = c && c.sim && c.sim.weather ? seaState(c.sim.weather) : 0.3;
      if (!this.body) {
        model.position.y = Math.sin(t * 1.6) * 0.22 * sea + Math.sin(t * 2.7) * 0.1 * sea;
        model.rotation.z = Math.sin(t * 1.3) * 0.09 * sea;
      }
      if (kind === 'swimmer' && model.userData.arm) {
        model.userData.arm.rotation.z = -0.5 - Math.abs(Math.sin(t * 2.2)) * 0.9;
      }
      if (kind === 'fishing' && model.userData.update) {
        // The pack boat runs its own wake, flooding and capsize physics.
        model.userData.update(dt, { speedMps: 0, steer: 0 });
      }
    },
  };

  if (people > 0 && kind === 'fishing') {
    prop.figures = [];
    for (let i = 0; i < people; i++) {
      const f = figure(i === 0 ? 0xff7a1a : i === 1 ? 0xffd23f : 0xff4d4d);
      f.position.set(-0.7 + i * 0.7, 0.62, 1.2 - i * 0.5);
      model.add(f);
      prop.figures.push(f);
    }
  }

  if (sinking && kind === 'fishing' && model.userData.capsize) {
    try {
      /*
       * She floods and lists while you work, and she never quite founders.
       *
       * maritime.js has a complete flooding, free-surface-shift and capsize
       * body with six buoyancy sample points, and nothing in the game has ever
       * called it. This is what it is for. Two things are deliberately tamed:
       * the default spin-up of 4.5 rad/s would have her cartwheeling, and the
       * flood rate is slowed right down and then capped in the tick below, so
       * a child who is doing the right thing slowly is never beaten by a timer
       * they cannot see.
       */
      const body = model.userData.capsize({
        worldAngularVelocity: { x: 0, y: 0, z: 0.28 },
        floodRate: 0.0022,
      });
      body.flooding = 0.3;
      prop.body = body;
    } catch (e) {
      console.warn('The casualty would not flood; she will just sit there.', e);
    }
  }

  PROPS.push(prop);
  return prop;
}

/** How lively the sea is, 0 flat to 1 gale. Reused by the props and the tow. */
function seaState(weather) {
  const wind = clamp((weather.windSpeedKts || 0) / 30, 0, 1);
  const cond = weather.condition === 'stormy' ? 0.75 : weather.condition === 'rainy' ? 0.45 : 0.15;
  return clamp(wind * 0.7 + cond * 0.6, 0, 1);
}

/* ------------------------------------------------------------------ *
 * The shared step machinery: holding station, taking people off,
 * towing, and watching the bottom.
 * ------------------------------------------------------------------ */

/**
 * Are you alongside, and slow enough that somebody would step across?
 *
 * Returns the seconds you have held it for. The message is the important part:
 * a child who has arrived at exactly the right place and had nothing happen
 * has no way of knowing the game is waiting for them to slow down, and "get
 * alongside slowly" is the one instruction in this whole game that is easy to
 * say and hard to do.
 */
function holdStation(ctx, dt, targetPos, key = 'hold', range = ALONGSIDE_RANGE, maxSpeed = ALONGSIDE_SPEED) {
  const b = boatOf(ctx);
  const d = ctx.data;
  if (!b || !targetPos) return 0;
  const near = flatDist(b.pos, targetPos) < range;
  const slow = Math.abs(b.speed) < maxSpeed;
  if (near && slow) {
    d[key] = (d[key] || 0) + dt;
    d._fastSaid = false;
  } else {
    if (near && !slow && !d._fastSaid) {
      d._fastSaid = true;
      ctx.sim.hud.notify('Too fast to come alongside — stop her, then ease in.', 'warn', 4);
    }
    // Leaving does not throw the whole thing away; it costs you the time.
    d[key] = Math.max(0, (d[key] || 0) - dt * 1.5);
  }
  return d[key] || 0;
}

/**
 * Take people off, one at a time, while you hold her there.
 *
 * `sim.boatAboard` is the contract with the HUD: { aboard, total } while you
 * are carrying somebody, null when you are not. That is the row of pips.
 */
function takeOffPeople(ctx, dt, prop, total, maxSpeed = ALONGSIDE_SPEED) {
  const held = holdStation(ctx, dt, prop.model.position, 'hold', ALONGSIDE_RANGE, maxSpeed);
  const want = Math.min(total, Math.floor(held / PER_PERSON));
  if (want > prop.rescued) {
    prop.rescued = want;
    ctx.data.aboard = (ctx.data.aboard || 0) + 1;
    if (prop.figures && prop.figures[prop.rescued - 1]) {
      prop.figures[prop.rescued - 1].visible = false;
    }
    ctx.sim.boatAboard = { aboard: ctx.data.aboard, total };
    ctx.sim.hud.notify(
      prop.rescued >= total
        ? `That is everybody — ${total} aboard. Take them home.`
        : `${prop.rescued} of ${total} aboard. Hold her there.`,
      'good',
      3.4
    );
    ctx.sim.audio && ctx.sim.audio.available && ctx.sim.audio.alerts.checkpoint();
  }
  return prop.rescued >= total;
}

/**
 * Pass a line, and then keep it whole.
 *
 * The towed vessel follows a point astern of you, which is a cheat and an
 * entirely convincing one at the speeds a small boat tows at. What is not a
 * cheat is the line: open the lever hard and the acceleration spikes, the line
 * comes up with a bang and it parts. That is throttle discipline, which is the
 * last thing a child learns at the helm and the thing that separates driving a
 * boat from driving a car.
 */
function updateTow(ctx, dt, prop) {
  const b = boatOf(ctx);
  const d = ctx.data;
  // The weight on the line, for the boat's own drag (surface.js, towDragK).
  if (b) b.towLoad = prop && prop.towed ? 1 : 0;
  if (!b || !prop || !prop.towed) return;
  const rad = (b.heading * Math.PI) / 180;
  // A scratch vector: this runs every frame of every tow.
  const want = _towWant.set(b.pos.x - Math.sin(rad) * TOW_LENGTH, 0, b.pos.z + Math.cos(rad) * TOW_LENGTH);
  const m = prop.model;
  const k = clamp(dt * 1.6, 0, 1);
  m.position.x += (want.x - m.position.x) * k;
  m.position.z += (want.z - m.position.z) * k;
  const dx = b.pos.x - m.position.x;
  const dz = b.pos.z - m.position.z;
  m.rotation.y = Math.atan2(dx, -dz);
  m.position.y = Math.sin(prop.bobPhase * 1.4) * 0.16;

  /*
   * How hard you opened the lever, smoothed, and only when the frame was a
   * real one.
   *
   * Raw frame-to-frame acceleration is the wrong thing to test. On a school
   * Chromebook a dropped frame arrives as a dt of a fifth of a second with a
   * whole fifth of a second of speed change inside it, which reads as an
   * enormous snatch and parts the line because the laptop stuttered. So the
   * measurement is low-passed over about a fifth of a second and any frame
   * longer than a tenth is not measured at all.
   */
  const speed = Math.abs(b.speed);
  const raw = dt > 0.1 ? 0 : (speed - (d._towSpeed ?? speed)) / Math.max(dt, 1e-3);
  d._towSpeed = speed;
  d._towAccel = (d._towAccel || 0) + (raw - (d._towAccel || 0)) * clamp(dt * 5, 0, 1);
  /*
   * A snatch is an event, not a state.
   *
   * This first tested the condition every frame and added to the strain every
   * frame it was true, which meant opening the lever hard parted the line in
   * two frames — before the boat had moved a metre, and long before anybody
   * could have understood what they had done wrong. One snatch is one bang on
   * the line: it costs you half the strain you can take, it decays in under a
   * second if you ease off, and it takes two of them close together to part
   * it. The edge clears only once the acceleration has properly settled, so
   * holding the lever wide open is one snatch and not a hundred.
   */
  const hard = d._towAccel > TOW_SNATCH && speed > 2.5;
  const snatched = hard && !d._snatching;
  if (hard) d._snatching = true;
  else if (d._towAccel < 1) d._snatching = false;
  if (snatched) {
    ctx.sim.hud.notify('That was a snatch — the line came up with a bang. Ease her on.', 'warn', 4);
  }
  const overSpeed = speed > TOW_SPEED;
  if (overSpeed && !d._towWarn) {
    d._towWarn = true;
    ctx.sim.hud.notify('Easy — you are pulling too hard on the line.', 'warn', 3);
  }
  if (!overSpeed) d._towWarn = false;
  /*
   * A strain that builds while you pull and eases when you back off.
   *
   * The decay is deliberately slower than the build. Measured against a
   * skipper who slams the lever from Stop to Full and back once a second, a
   * fast decay meant the line never parted at all: each bang had gone by the
   * time the next one arrived, and the one mission in the game about throttle
   * discipline could not be failed by a total lack of it. At this rate a
   * single snatch is survivable and forgotten in under two seconds, two
   * snatches close together part it, and a couple of seconds of towing above
   * twelve knots parts it on its own.
   */
  d.towStrain = clamp(
    (d.towStrain || 0) + (overSpeed ? dt * 0.55 : -dt * 0.35) + (snatched ? 0.55 : 0),
    0,
    1.4
  );
  if (d.towStrain >= 1) partTheLine(ctx, prop);
}

/**
 * Whether the tow line is off, for the step labels that read it. Module
 * state because the runner reads `step.targetLabel` with no context, and
 * only one shout runs at a time.
 */
const lineState = { parted: false };

/**
 * Get another line on her: alongside, slowly, for three seconds.
 *
 * partTheLine has always said "Go back, get alongside slowly and pass
 * another", and only the Long Tow had a step that let you — anywhere else
 * the words sent a child back to a boat that could never be taken in tow
 * again.
 */
function repassLine(ctx, dt, prop, words) {
  if (!prop || prop.towed) {
    lineState.parted = false;
    return;
  }
  lineState.parted = true;
  const held = holdStation(ctx, dt, prop.model.position, 'repass');
  if (held > 3) {
    prop.towed = true;
    ctx.data.towStrain = 0;
    ctx.data.repass = 0;
    lineState.parted = false;
    ctx.sim.hud.notify(words, 'good', 6);
  }
}

function partTheLine(ctx, prop) {
  prop.towed = false;
  const b = boatOf(ctx);
  if (b) b.towLoad = 0;
  ctx.data.towStrain = 0;
  ctx.data.hold = 0;
  ctx.data.towsParted = (ctx.data.towsParted || 0) + 1;
  ctx.sim.hud.notify('The line has parted! Go back, get alongside slowly and pass another.', 'warn', 7);
  ctx.sim.speak('Line has gone. Take your time and pass us another one.', VOICE.casualty, 1);
}

/**
 * The bottom.
 *
 * The missions grade you on whether you touched it, and they do the counting
 * themselves rather than waiting to be told by the vehicle. That is not
 * duplication for its own sake: the new grounding model in surface.js is being
 * written this week by somebody else, and a mission that cannot score you
 * until it lands is a mission that cannot be tested. It is one subtraction per
 * frame against the same height field the hull is floating on, so the two
 * cannot disagree.
 */
function watchSeabed(ctx, dt) {
  const b = boatOf(ctx);
  const d = ctx.data;
  if (!b) return;
  const depth = depthAt(b.pos.x, b.pos.z);
  d.leastDepth = Math.min(d.leastDepth ?? 99, depth);
  /*
   * A touch is the boat saying so, as well as the water under her middle.
   *
   * The bow probe in surface.js stops her a boat's length SHORT of the bank,
   * so the water under her own keel is still a couple of metres deep when she
   * bumps. Measured playing the Long Tow at base: seven bumps, one counted
   * touch, so the debrief said the bottom had been touched once. The
   * vehicle's own `aground` edge is the bump.
   */
  const touching = depth < TOUCH_DEPTH || !!b.aground;
  if (touching && !d._onTheBottom) {
    d._onTheBottom = true;
    d.touches = (d.touches || 0) + 1;
    // The boat's own message is already on the screen when she bumps.
    if (!b.aground) ctx.sim.hud.notify("You're on the putty — astern, gently.", 'warn', 5);
  } else if (!touching && depth > 0.9) {
    d._onTheBottom = false;
  }
}

/**
 * Where "home" is, from wherever you are.
 *
 * Out at sea, home is the harbour mouth: that is the gap you have to hit, and
 * an arrow pointing at the berth from two kilometres out points through the
 * breakwater. Once you are inside the mouth, home is the berth. Two answers
 * from one function because the child should never have to work out which of
 * the two the game means.
 */
/*
 * FOUR of the six shouts pointed their "take her home" step straight at the
 * berth instead of calling this.
 *
 * The berth is inside the breakwater, so the arrow ran through the harbour
 * wall — and a child steering at the arrow drives into the wall. Measured on
 * two maps by driving exactly at the arrow every frame: the launch reached the
 * mouth and then ground, went astern, came ahead and ground again, for a
 * hundred and sixty-five seconds without ever getting into the basin. Those
 * missions were finishable only by somebody who already knew to ignore the
 * arrow and aim off. First Shout was the one that called this, and it is the
 * one that worked.
 */
/*
 * AND IT FLIPPED BACK AT THE QUAY. "Within 220 m of the mouth, aim at the
 * berth" — but on Sennen the berth is 258 m from the mouth, so a launch that
 * had come in and was lying at the berth was 222 m from the mouth, and the
 * arrow swung round and pointed back out to sea. Followed, it took her back
 * towards the mouth until she was inside 220 m, when it swung round again.
 * Measured by playing Man Overboard by the arrow: a figure of eight in the
 * basin between the berth and the mouth from 330 s to the end of a 700 s run.
 * Night Shout ends the same way and was stranded the same way; with this
 * change both finish. Once she is as close to the berth as the mouth is, the
 * berth is home.
 */
function wayHome(ctx) {
  const f = F(ctx);
  const b = boatOf(ctx);
  if (!b) return f.mouth.clone();
  const mouthToBerth = flatDist(f.mouth, f.berth);
  if (flatDist(b.pos, f.mouth) < 220 || flatDist(b.pos, f.berth) < mouthToBerth + 60) return f.berth.clone();
  return f.mouth.clone();
}

/** Inside the breakwater and stopped at the quay: the end of every shout. */
function alongsideAtHome(ctx, dt) {
  const f = F(ctx);
  const held = holdStation(ctx, dt, f.berth, 'homeHold', 22);
  return held > 2.5;
}

/* ------------------------------------------------------------------ *
 * The radio.
 *
 * Three parts, played by voices that already exist. The Coastguard and the
 * boathouse are the tower and ground retuned by context alone — they are the
 * calm, low, unhurried ones — and the casualty is the higher, less formal
 * voice. Adding two real entries to VOICES in audio/atc.js is two lines and
 * would be better; naming them here means that when somebody does add them,
 * one line changes and every call in this file follows.
 * ------------------------------------------------------------------ */
/*
 * And now they are three real entries, added from here rather than by editing
 * atc.js, in the same way the plug-in layer adds vehicles to VEHICLES.
 *
 * Borrowing the tower's voice borrowed its NAME: the subtitle over every
 * Coastguard call read "Kestrel Tower", and the casualty's read "Mango Cay".
 * Measured on the first frame of First Shout — the first words of the boat
 * game were credited to an airport tower on an island the shout is not on.
 * Each is the same synthesised voice as before (a copy of its settings) with
 * its own label, so it sounds exactly as it did and says who it is.
 */
const BOAT_VOICES = [
  ['coastguard', 'tower', 'Coastguard'],
  ['boathouse', 'ground', 'Boathouse'],
  ['casualty', 'village', 'Casualty'],
];
for (const [key, from, label] of BOAT_VOICES) {
  if (VOICES && VOICES[from] && !VOICES[key]) VOICES[key] = { ...VOICES[from], label };
}
const VOICE = {
  coastguard: VOICES && VOICES.coastguard ? 'coastguard' : 'tower',
  boathouse: VOICES && VOICES.boathouse ? 'boathouse' : 'ground',
  casualty: VOICES && VOICES.casualty ? 'casualty' : 'village',
};

/* ------------------------------------------------------------------ *
 * Scoring.
 *
 * Time taken, people recovered, and whether you touched the bottom — the same
 * three-part shape as the landing score, so nothing in the progression system
 * has to learn a new one.
 * ------------------------------------------------------------------ */
function boatScore(ctx, { people = 0 } = {}) {
  const d = ctx.data;
  const par = ctx.runner.def.parTime || 300;
  const timeScore = clamp(1 - (ctx.elapsed - par * 0.6) / (par * 1.4), 0, 1);
  const recovered = people ? clamp((d.aboard || 0) / people, 0, 1) : 1;
  const clean = clamp(1 - (d.touches || 0) * 0.34 - (d.towsParted || 0) * 0.2, 0, 1);
  return Math.round(recovered * 42 + timeScore * 33 + clean * 25);
}

/** The boathouse, at the end: how long it took, and what it cost. */
function boathouseSaysWellDone(ctx, result, words) {
  const d = ctx.data;
  const mins = Math.floor(ctx.elapsed / 60);
  const secs = Math.round(ctx.elapsed % 60);
  ctx.sim.boatAboard = null;
  ctx.sim.speak(words, VOICE.boathouse);
  ctx.sim.hud.notify(
    `Alongside in ${mins}m ${String(secs).padStart(2, '0')}s` +
      (d.touches ? ` · touched the bottom ${d.touches} time${d.touches > 1 ? 's' : ''}` : ' · never touched the bottom'),
    'good',
    7
  );
  /*
   * The debrief screen is written for an aeroplane and reads `result.landing`
   * for the touchdown lines; a boat has none, and the template already hides
   * those rows when it is null. This rides along so that whoever does the boat
   * debrief panel has the numbers waiting for them rather than having to
   * re-derive them.
   */
  result.landing = null;
  result.boat = {
    aboard: d.aboard || 0,
    touches: d.touches || 0,
    leastDepth: Math.round((d.leastDepth ?? 0) * 10) / 10,
    towsParted: d.towsParted || 0,
  };
}

/** Everything every shout does on the way in. */
function beginShout(ctx) {
  clearBoatProps(ctx.sim.scene);
  ctx.data.aboard = 0;
  ctx.data.touches = 0;
  ctx.data.leastDepth = 99;
  ctx.sim.boatAboard = null;
  F(ctx); // work the frame out now, not in the middle of a step
}

/** The tick every shout runs: the props, the bottom, and the flooding cap. */
function shoutTick(ctx, dt) {
  watchSeabed(ctx, dt);
  for (const p of PROPS) {
    p.update(dt, ctx);
    // She lists and settles. She does not founder while there is anybody on
    // her, because losing the people you were sent for to a number you cannot
    // see is not a lesson, it is a trick.
    if (p.body && p.body.flooding > 0.82) p.body.flooding = 0.82;
  }
}

/* ------------------------------------------------------------------ *
 * Where each shout happens: timed, not measured.
 *
 * Every one of these is a distance in metres out of the harbour mouth, and
 * every one of them was chosen with a stopwatch rather than a ruler.
 *
 * Half ahead is about 11 m/s, so 900 m out is eighty seconds of steaming and
 * the longest leg here — the 1,500 m tow home in the Long Tow, at 6.5 m/s —
 * is four and a half minutes. Nothing in this file is further out than that,
 * because the boat does 22 m/s flat out on a map that is 29 km across, and a
 * casualty put where an aeroplane designer's instinct says "a decent way out"
 * is five minutes of a ten-year-old holding one key while nothing happens.
 * ------------------------------------------------------------------ */
const FIRST_SHOUT_OUT = 900;
const MOB_SEARCH_OUT = 900;
const MOB_SEARCH_R = 150;
const WREN_OUT = 1500;
const NIGHT_OUT = 1150;
const GALE_OUT = 1500;
const LONGTOW_OUT = 1500;

export const BOAT_MISSIONS = [
  /* ---------------------------------------------------------------- *
   * 1. First Shout — the lever, the channel, the buoyage, and the fact
   *    that a boat does not stop.
   * ---------------------------------------------------------------- */
  {
    id: 'first-shout',
    subject: 'boat',
    vehicle: 'boat',
    name: 'First Shout',
    short: 'Tow in a broken-down dinghy',
    difficulty: 'Easy',
    icon: '⚓',
    blurb:
      'Two people in a dinghy just under a kilometre off the harbour mouth. The engine has stopped and they are ' +
      'drifting. Go out, get alongside, pass them a line and bring them home.',
    reward: 'Teaches the engine lever, the channel and coming alongside slowly.',
    map: 'sennen',
    weather: { time: 'day', condition: 'clear', windSpeedKts: 7, windDirDeg: 240 },
    // Eighty seconds out, a minute getting alongside, and a three-minute tow
    // home: par is what a careful child takes, not what a good one takes.
    parTime: 420,
    failOnCrash: false,
    onStart: (ctx) => {
      beginShout(ctx);
      const f = F(ctx);
      const where = waterNear(f.place(FIRST_SHOUT_OUT, 140), 5);
      ctx.data.casualty = spawnCasualty(ctx, 'dinghy', where, {
        people: 2,
        heading: Math.random() * 6.28,
      });
      lineState.parted = false;
    },
    /*
     * The tow, which First Shout talked about and never did.
     *
     * The alongside step sets the dinghy `towed`, and a towed prop stops
     * bobbing because "position is the tow's business" — but only The Long
     * Tow ever called updateTow, so here nothing moved her: the dinghy stayed
     * where she was found while the launch went home "towing" her, and "pull
     * too hard and the line will part" could never happen. Now she follows on
     * the line, the line can part, and the next thing the arrow asks is to go
     * back for her.
     */
    tick: (ctx, dt) => {
      shoutTick(ctx, dt);
      const c = ctx.data.casualty;
      updateTow(ctx, dt, c);
      if (ctx.data.lineOut) repassLine(ctx, dt, c, 'Line made fast again. Home, gently — Half ahead at most.');
    },
    steps: [
      {
        id: 'slip',
        text: 'Take her off the berth and out down the channel. Coming home, keep the red buoys on your left.',
        hint: 'The lever steps up with Shift: Stop, Slow, Half, Full. Slow until you are past the quay.',
        atc: {
          text:
            'Lifeboat, Coastguard. We have a small dinghy broken down half a mile off the harbour, two people on board. ' +
            'Launch when you are ready.',
          voice: VOICE.coastguard,
        },
        targetLabel: 'Harbour mouth',
        target: (ctx) => F(ctx).mouth.clone(),
        check: (ctx) => {
          const b = boatOf(ctx);
          const f = F(ctx);
          return !!b && flatDist(b.pos, f.mouth) < 60;
        },
      },
      {
        id: 'out',
        text: 'Out past the fairway buoy and on towards them. Half ahead is plenty.',
        hint: 'The arrow at the top of the screen points at them. The chart shows you what is under you.',
        targetLabel: 'Dinghy',
        target: (ctx) => ctx.data.casualty.model.position.clone(),
        check: (ctx) => flatDist(boatOf(ctx).pos, ctx.data.casualty.model.position) < 90,
        enter: (ctx) => {
          const f = F(ctx);
          const rb = rangeAndBearing(f.mouth, ctx.data.casualty.model.position);
          ctx.sim.hud.notify(`Dinghy adrift · ${rb.text} of the harbour mouth`, 'info', 6);
        },
      },
      {
        id: 'alongside',
        text: 'Now come alongside. Down to Slow, then Stop — you want to be doing less than two knots when you get there.',
        hint: 'She carries her way. Take the power off early and let her run up to them.',
        targetLabel: 'Dinghy',
        target: (ctx) => ctx.data.casualty.model.position.clone(),
        atc: {
          text: 'We can see you coming. Thank you — we could not get her started.',
          voice: VOICE.casualty,
        },
        check: (ctx, dt) => holdStation(ctx, dt, ctx.data.casualty.model.position, 'hold') > 3,
        onDone: (ctx) => {
          ctx.data.casualty.towed = true;
          ctx.data.towStrain = 0;
          /*
           * Towed is not aboard. The pips are people who have stepped across
           * onto your deck; these two are still in their own boat behind you,
           * and lighting three little figures on the HUD for people who are
           * not there would teach the child that the pips mean nothing.
           */
          ctx.data.towedHome = 2;
          ctx.data.lineOut = true;
          ctx.sim.hud.notify('Line made fast. Take her home gently — Half ahead at most, under twelve knots.', 'good', 6);
        },
      },
      {
        id: 'home',
        text: 'Bring her home. Gently: pull too hard and the line will part.',
        hint: 'Keep the red buoys on your left as you come in. Half ahead at most.',
        // Home — unless the line has parted, and then it is back to her.
        get targetLabel() {
          return lineState.parted ? 'Dinghy — pass another line' : 'Home';
        },
        target: (ctx) => (ctx.data.casualty.towed ? wayHome(ctx) : ctx.data.casualty.model.position.clone()),
        // Arriving without her is not arriving: see the same rule in the Long Tow.
        check: (ctx) => ctx.data.casualty.towed && flatDist(boatOf(ctx).pos, F(ctx).berth) < 260,
      },
      {
        id: 'berth',
        text: 'Inside the breakwater. Come alongside the yellow jetty and stop.',
        hint: 'Astern takes the way off her. Do not come in fast — there is nothing to stop you but the wall.',
        get targetLabel() {
          return lineState.parted ? 'Dinghy — pass another line' : 'Lifeboat berth';
        },
        target: (ctx) => (ctx.data.casualty.towed ? F(ctx).berth.clone() : ctx.data.casualty.model.position.clone()),
        check: (ctx, dt) => ctx.data.casualty.towed && alongsideAtHome(ctx, dt),
      },
    ],
    onComplete: (ctx, result) =>
      boathouseSaysWellDone(ctx, result, 'Lifeboat, boathouse. Nicely done — both of them are ashore and dry.'),
    score: (ctx) => boatScore(ctx, { people: 0 }),
  },

  /* ---------------------------------------------------------------- *
   * 2. Man Overboard — the arrow does not always know.
   * ---------------------------------------------------------------- */
  {
    id: 'man-overboard',
    subject: 'boat',
    vehicle: 'boat',
    name: 'Man Overboard',
    short: 'Search for a swimmer',
    difficulty: 'Easy',
    icon: '◎',
    blurb:
      'Somebody has gone into the water off the headland. Nobody knows exactly where. You are given a ' +
      'search area, not a position — run across it until you see him, and get him out before he is too cold.',
    reward: 'Teaches searching a patch of sea, and that the arrow does not always know.',
    // Coral Lagoon: calm water inside the reef, the kindest place to learn a search (the owner: "use different maps for different missions").
    map: 'lagoon',
    weather: { time: 'day', condition: 'cloudy', windSpeedKts: 10, windDirDeg: 200 },
    parTime: 320,
    failOnCrash: false,
    onStart: (ctx) => {
      beginShout(ctx);
      const f = F(ctx);
      // The middle of the search area, and him somewhere inside it.
      const centre = waterNear(f.place(MOB_SEARCH_OUT, -260), 4);
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * (MOB_SEARCH_R - 25);
      const at = waterNear(V(centre.x + Math.sin(a) * r, 0, centre.z + Math.cos(a) * r), 2.5);
      ctx.data.searchCentre = centre;
      ctx.data.casualty = spawnCasualty(ctx, 'swimmer', at);
      /*
       * Five minutes in the water, and the last one of them is a helping hand.
       *
       * The brief says four, and four is right for the drama. Measured against
       * an actual sweep it is not right for a ten-year-old: a 300 m circle
       * searched on 140 m spacing is three legs and two turns, and a child who
       * turns the wrong way once has used half of it. So the clock is five
       * minutes, and at the last sixty seconds the Coastguard narrows the
       * search and the arrow starts pointing at him.
       *
       * That is not letting them win. The searching is still the lesson and
       * still the first four minutes of it; what it removes is the one outcome
       * that teaches nothing at all, which is a child who did everything
       * asked of them being told the man died because they turned left.
       */
      ctx.data.cold = 300;
    },
    tick: (ctx, dt) => {
      shoutTick(ctx, dt);
      if (!ctx.data.searching || ctx.data.found) return;
      ctx.data.cold -= dt;
      if (ctx.data.cold <= 60 && !ctx.data.narrowed) {
        ctx.data.narrowed = true;
        ctx.sim.speak(
          'Lifeboat, Coastguard. We have a better position for him now — it is on your chart. Go straight to it.',
          VOICE.coastguard,
          1
        );
        ctx.sim.hud.notify('Coastguard has narrowed the search — the arrow has him now.', 'warn', 7);
      }
    },
    failIf: (ctx) => (ctx.data.searching && !ctx.data.found && ctx.data.cold <= 0
      ? 'He was in the water too long'
      : null),
    steps: [
      {
        id: 'launch',
        text: 'Out of the harbour and round to the search area west of the head.',
        hint: 'The circle on the chart is where he might be. The arrow points at the middle of it, not at him.',
        atc: {
          text:
            'Lifeboat, Coastguard. Person in the water off the head, reported about ten minutes ago. ' +
            'We have a search area for you, not a position. Go and find him.',
          voice: VOICE.coastguard,
          urgency: 1,
        },
        targetLabel: 'Search area',
        target: (ctx) => ctx.data.searchCentre.clone(),
        check: (ctx) => flatDist(boatOf(ctx).pos, ctx.data.searchCentre) < MOB_SEARCH_R + 40,
        onDone: (ctx) => {
          ctx.data.searching = true;
          ctx.sim.hud.notify('In the search area. Run back and forth across it — look for orange.', 'info', 7);
        },
      },
      {
        id: 'search',
        text: 'Search. Run lines across the area and look out for an orange lifejacket in the water.',
        hint: 'Go slowly enough to look. Sweep one way, turn, and come back a little further along.',
        targetLabel: 'Search area',
        target: (ctx) =>
          // Once you have him — or once the Coastguard has narrowed it down —
          // the arrow is allowed to know. Until then it points at the middle
          // of the area, which is the whole exercise.
          ctx.data.found || ctx.data.narrowed
            ? ctx.data.casualty.model.position.clone()
            : ctx.data.searchCentre.clone(),
        check: (ctx) => {
          if (ctx.data.found) return true;
          const d = flatDist(boatOf(ctx).pos, ctx.data.casualty.model.position);
          if (d < 70) {
            ctx.data.found = true;
            ctx.data.foundAt = ctx.elapsed;
            ctx.sim.hud.notify('There he is! Come round and get alongside him.', 'good', 6);
            ctx.sim.audio && ctx.sim.audio.available && ctx.sim.audio.alerts.checkpoint();
            return true;
          }
          return false;
        },
      },
      {
        id: 'recover',
        text: 'Get alongside him and stop. You cannot pull somebody out of the water at speed.',
        hint: 'Come up to him slowly with him on your side, not under your bow.',
        targetLabel: 'Swimmer',
        target: (ctx) => ctx.data.casualty.model.position.clone(),
        check: (ctx, dt) => {
          const got = takeOffPeople(ctx, dt, ctx.data.casualty, 1);
          // He is out of the water, so he is no longer in it.
          if (got) removeProp(ctx.data.casualty);
          return got;
        },
        onDone: (ctx) => {
          ctx.sim.speak('Lifeboat, Coastguard. Well found. Bring him in.', VOICE.coastguard);
        },
      },
      {
        id: 'home',
        text: 'He is aboard and he is cold. Take him home and stop alongside the yellow jetty.',
        hint: 'There is an ambulance waiting on the quay. Straight home now.',
        targetLabel: 'Lifeboat berth',
        target: wayHome,
        check: (ctx, dt) => alongsideAtHome(ctx, dt),
      },
    ],
    onComplete: (ctx, result) =>
      boathouseSaysWellDone(
        ctx,
        result,
        'Lifeboat, boathouse. He is in the ambulance and he is talking. That is a good morning.'
      ),
    score: (ctx) => boatScore(ctx, { people: 1 }),
  },

  /* ---------------------------------------------------------------- *
   * 3. The Wren, Aground — the chart is not decoration.
   * ---------------------------------------------------------------- */
  {
    id: 'wren-aground',
    subject: 'boat',
    vehicle: 'boat',
    name: 'The Wren, Aground',
    short: 'Three off a fishing boat on the shoals',
    difficulty: 'Medium',
    icon: '⚠',
    blurb:
      'The fishing boat Wren is on the shoals with three aboard and taking water. Get out to her fast, ' +
      'get alongside in two metres of water, and take all three off without putting yourself on the same rock.',
    reward: 'Teaches reading the chart, and that shallow water is a place not a colour.',
    map: 'skerries',
    weather: { time: 'day', condition: 'cloudy', windSpeedKts: 14, windDirDeg: 280 },
    parTime: 420,
    failOnCrash: false,
    onStart: (ctx) => {
      beginShout(ctx);
      const f = F(ctx);
      /*
       * On the shoal if the map has one, in shallow water if it has not.
       *
       * The shoals are being placed by the map specialist in the same week
       * this is written, so this asks the height field where the shallow
       * water actually is rather than naming a rock that may not exist. If it
       * finds none — a map with no shoals at all — she is aground in the
       * shallowest water within reach, which is still the same job.
       */
      const aim = f.place(WREN_OUT, 320);
      const where = shoalNear(aim, { min: 0.4, max: 2.6, reach: 700 }) || waterNear(aim, 2);
      ctx.data.casualty = spawnCasualty(ctx, 'fishing', where, {
        people: 3,
        heading: Math.random() * 6.28,
        sinking: true,
      });
      ctx.data.wrenAt = where.clone();
    },
    tick: shoutTick,
    steps: [
      {
        id: 'launch',
        text: 'Slip and go. Look at the chart before you pick your way — she is in among the shoals.',
        hint: 'Amber on the chart means no. Pale means care. Blue means you can take the boat there.',
        atc: {
          text:
            'Mayday relay, all stations. Fishing vessel Wren aground on the shoals, three persons on board, ' +
            'taking water. Lifeboat, this is yours.',
          voice: VOICE.coastguard,
          urgency: 1,
        },
        targetLabel: 'Harbour mouth',
        target: (ctx) => F(ctx).mouth.clone(),
        check: (ctx) => flatDist(boatOf(ctx).pos, F(ctx).mouth) < 60,
      },
      {
        id: 'out',
        text: 'Out to the Wren. Watch the depth under the keel the whole way — the sounder will tell you before the rocks do.',
        hint: 'Under three metres the sounder starts pinging, and it quickens as it shallows.',
        targetLabel: 'Fishing boat Wren',
        target: (ctx) => ctx.data.wrenAt.clone(),
        enter: (ctx) => {
          const rb = rangeAndBearing(F(ctx).mouth, ctx.data.wrenAt);
          ctx.sim.hud.notify(`MAYDAY · fishing boat Wren · aground · ${rb.text}`, 'warn', 8);
        },
        check: (ctx) => flatDist(boatOf(ctx).pos, ctx.data.wrenAt) < 120,
      },
      {
        id: 'take-off',
        text: 'Three of them. Get alongside, hold her there, and take them off one at a time.',
        hint: 'Stop short and let her drift the last few metres. If you touch, go astern gently and try again.',
        targetLabel: 'Wren',
        target: (ctx) => ctx.data.casualty.model.position.clone(),
        atc: {
          text: 'Lifeboat, Wren. We are on the rock and she is filling. Three of us. Come up on our port side.',
          voice: VOICE.casualty,
          urgency: 1,
        },
        check: (ctx, dt) => takeOffPeople(ctx, dt, ctx.data.casualty, 3),
      },
      {
        id: 'home',
        /*
         * The check is alongsideAtHome — stopped within 22 m of the berth —
         * and the words never said so: "take them home" and nothing about
         * the quay. Played by the words alone, the launch arrived at the
         * berth at Half and circled it for five minutes.
         */
        text: 'All three aboard. Get yourself off this shoal, take them home, and stop alongside the yellow jetty.',
        hint: 'Go back out the way you came in. The chart still applies on the way home. Slow, then Stop, at the jetty.',
        targetLabel: 'Lifeboat berth',
        target: wayHome,
        check: (ctx, dt) => alongsideAtHome(ctx, dt),
      },
    ],
    onComplete: (ctx, result) =>
      boathouseSaysWellDone(
        ctx,
        result,
        'Lifeboat, boathouse. Three ashore. The Wren is nobody’s problem now — well done.'
      ),
    score: (ctx) => boatScore(ctx, { people: 3 }),
  },

  /* ---------------------------------------------------------------- *
   * 4. Night Shout — the same job, by the lights.
   * ---------------------------------------------------------------- */
  {
    id: 'night-shout',
    subject: 'boat',
    vehicle: 'boat',
    name: 'Night Shout',
    short: 'A dinghy adrift, in the dark',
    difficulty: 'Medium',
    icon: '☾',
    blurb:
      'The same kind of job, at two in the morning. The lighthouse and the lit buoys are all you have ' +
      'to steer by, and only the chart knows where the rock is.',
    reward: 'Teaches trusting the chart when you cannot see the water.',
    // Cutter Bay: a working harbour with a marked channel — the chart is the whole job at night.
    map: 'harbour',
    weather: { time: 'night', condition: 'clear', windSpeedKts: 9, windDirDeg: 220 },
    parTime: 380,
    failOnCrash: false,
    onStart: (ctx) => {
      beginShout(ctx);
      const f = F(ctx);
      const aim = f.place(NIGHT_OUT, -300);
      const near = shoalNear(aim, { min: 1.6, max: 4, reach: 500 }) || waterNear(aim, 3);
      ctx.data.casualty = spawnCasualty(ctx, 'dinghy', near, { people: 2, heading: Math.random() * 6.28 });
    },
    tick: shoutTick,
    steps: [
      {
        id: 'launch',
        text: 'Out down the channel. The lit buoys are red to your left on the way home, so green to your left going out.',
        hint: 'Slow through the moorings. You cannot see what you are about to hit tonight.',
        atc: {
          text:
            'Lifeboat, Coastguard. Two persons in a dinghy, no lights, somewhere north-west of the head. ' +
            'Nothing else is out tonight — take your time.',
          voice: VOICE.coastguard,
        },
        targetLabel: 'Harbour mouth',
        target: (ctx) => F(ctx).mouth.clone(),
        check: (ctx) => flatDist(boatOf(ctx).pos, F(ctx).mouth) < 60,
      },
      {
        id: 'out',
        text: 'Out towards them. In the dark, the chart is the only thing that knows where the rock is — use it.',
        hint: 'Keep the depth above three metres and you will not find anything the hard way.',
        targetLabel: 'Dinghy',
        target: (ctx) => ctx.data.casualty.model.position.clone(),
        check: (ctx) => flatDist(boatOf(ctx).pos, ctx.data.casualty.model.position) < 110,
      },
      {
        id: 'alongside',
        text: 'Alongside, slowly, and take them both off.',
        hint: 'At night everything looks further away than it is. Be stopped before you think you need to be.',
        targetLabel: 'Dinghy',
        target: (ctx) => ctx.data.casualty.model.position.clone(),
        check: (ctx, dt) => takeOffPeople(ctx, dt, ctx.data.casualty, 2),
      },
      {
        id: 'home',
        text: 'Both aboard. Follow the lit buoys home — red ones on your left — and stop alongside the jetty lights.',
        hint: 'The lighthouse sweep is behind you now. Head for the two lights on the breakwater heads.',
        targetLabel: 'Lifeboat berth',
        target: wayHome,
        check: (ctx, dt) => alongsideAtHome(ctx, dt),
      },
    ],
    onComplete: (ctx, result) =>
      boathouseSaysWellDone(ctx, result, 'Lifeboat, boathouse. Both of them in, and the kettle is on. Good work in the dark.'),
    score: (ctx) => boatScore(ctx, { people: 2 }),
  },

  /* ---------------------------------------------------------------- *
   * 5. In the Gale — the target moves while you steam to it.
   * ---------------------------------------------------------------- */
  {
    id: 'in-the-gale',
    subject: 'boat',
    vehicle: 'boat',
    name: 'In the Gale',
    short: 'A casualty drifting downwind',
    difficulty: 'Hard',
    icon: '≋',
    blurb:
      'A big sea and a wind straight into the bay. There is a boat adrift off the head and she is going ' +
      'downwind faster than you would like. You cannot hold Full into this — go and get her anyway.',
    reward: 'Teaches allowing for a target that will not stay still.',
    // Squall Head: the storm coast — open water, one bay for home. Where a gale belongs.
    map: 'stormcoast',
    weather: { time: 'day', condition: 'stormy', windSpeedKts: 28, windDirDeg: 250 },
    parTime: 430,
    timeLimit: 720,
    failOnCrash: false,
    onStart: (ctx) => {
      beginShout(ctx);
      const f = F(ctx);
      const where = waterNear(f.place(GALE_OUT, -420), 5);
      ctx.data.casualty = spawnCasualty(ctx, 'dinghy', where, { people: 2, heading: Math.random() * 6.28 });
      ctx.data.drift = V();
    },
    /**
     * She drifts, and that is the mission.
     *
     * Eight per cent of the wind is about right for a small boat lying to it
     * with nobody driving — 1.15 m/s in this gale, which is a ninth of your
     * speed at Half ahead. Fast enough that steering at where she is now is
     * the wrong answer and you have to aim off; slow enough that you will
     * always catch her, because a mission a ten-year-old cannot win is not a
     * hard mission, it is a broken one.
     *
     * Two kindnesses, both of which are also true of the real thing. She
     * stops drifting in water too shallow to drift in, which keeps her off
     * the beach. And she stops the moment you are alongside, because a boat
     * that is alongside is in your lee — without that, holding station on
     * something moving at a knot and a bit while you are asked to be doing
     * under two is a task that reads as broken even to an adult.
     */
    tick: (ctx, dt) => {
      shoutTick(ctx, dt);
      const c = ctx.data.casualty;
      if (!c || c.towed || c.rescued) return;
      // Close enough to be in your lee: she stops going away from you. Without
      // this the step cannot be done at all — she drifts at 1.15 m/s and you
      // are being asked to be doing under 1.03, so you would never close the
      // last few metres however well you drove.
      const b = boatOf(ctx);
      if (b && flatDist(b.pos, c.model.position) < 45) return;
      const w = ctx.sim.weather.windVector(_drift).multiplyScalar(0.08);
      const m = c.model;
      const nx = m.position.x + w.x * dt;
      const nz = m.position.z + w.z * dt;
      if (depthAt(nx, nz) > 1.2) {
        m.position.x = nx;
        m.position.z = nz;
      }
      ctx.data.drift.copy(w);
    },
    steps: [
      {
        id: 'launch',
        text: 'Out you go. It is rough — she will slam, and you will not hold Full into it.',
        hint: 'Half ahead into a head sea is faster than Full, because Full just throws water over you.',
        atc: {
          text:
            'Lifeboat, Coastguard. Small boat adrift off the head, two on board, drifting east in this wind. ' +
            'Sea state is rough. Your call whether you launch.',
          voice: VOICE.coastguard,
          urgency: 1,
        },
        targetLabel: 'Harbour mouth',
        target: (ctx) => F(ctx).mouth.clone(),
        check: (ctx) => flatDist(boatOf(ctx).pos, F(ctx).mouth) < 60,
      },
      {
        id: 'chase',
        text: 'She is drifting downwind. Do not steer at her — steer at where she will be.',
        hint: 'The arrow shows where she is now. She is moving away from it the whole time.',
        targetLabel: 'Boat adrift',
        target: (ctx) => ctx.data.casualty.model.position.clone(),
        check: (ctx) => flatDist(boatOf(ctx).pos, ctx.data.casualty.model.position) < 100,
      },
      {
        id: 'alongside',
        text: 'Get alongside in this. Come up on her downwind side so you are blown off her, not onto her.',
        hint: 'In a sea you have to keep working the lever to hold station. Two knots, and hold it.',
        targetLabel: 'Boat adrift',
        target: (ctx) => ctx.data.casualty.model.position.clone(),
        // "Under two knots" means two knots relative to HER, and she is going
        // downwind. Judging it against the water would make this step harder
        // than the sea does, which is the wrong kind of hard.
        check: (ctx, dt) =>
          takeOffPeople(ctx, dt, ctx.data.casualty, 2, ALONGSIDE_SPEED + ctx.data.drift.length()),
      },
      {
        id: 'home',
        // The same missing half-sentence as the Wren's: the check wants her
        // stopped at the quay, and the words did not say so.
        text: 'Both aboard. Run home with the sea behind you — she will want to slew, so steer ahead of her — and stop alongside the yellow jetty.',
        hint: 'Running downwind she steers less and surfs more. Ease the lever back, and Stop at the jetty.',
        targetLabel: 'Lifeboat berth',
        target: wayHome,
        check: (ctx, dt) => alongsideAtHome(ctx, dt),
      },
    ],
    onComplete: (ctx, result) =>
      boathouseSaysWellDone(ctx, result, 'Lifeboat, boathouse. In this? That was properly done. Get yourselves dry.'),
    score: (ctx) => boatScore(ctx, { people: 2 }),
  },

  /* ---------------------------------------------------------------- *
   * 6. The Long Tow — throttle discipline.
   * ---------------------------------------------------------------- */
  {
    id: 'long-tow',
    subject: 'boat',
    vehicle: 'boat',
    name: 'The Long Tow',
    short: 'A heavy boat home through the narrow lane',
    difficulty: 'Hard',
    icon: '⚓',
    blurb:
      'A fishing boat with no engine, about a mile out, and a narrow lane between the shoals to bring ' +
      'her home through. Snatch the lever open and the line will part and you will start again.',
    reward: 'Teaches throttle discipline — the last thing you learn at a helm.',
    map: 'skerries',
    weather: { time: 'sunset', condition: 'cloudy', windSpeedKts: 16, windDirDeg: 300 },
    parTime: 540,
    failOnCrash: false,
    onStart: (ctx) => {
      beginShout(ctx);
      const f = F(ctx);
      const where = waterNear(f.place(LONGTOW_OUT, 260), 5);
      ctx.data.casualty = spawnCasualty(ctx, 'fishing', where, {
        people: 2,
        heading: Math.random() * 6.28,
      });
      lineState.parted = false;
    },
    /*
     * And the line can be passed again wherever it parts.
     *
     * The 'tow' step points you back at her once the line has gone, but its
     * check needs the line on, and the only step that could put it back on
     * ('repass') comes AFTER it — so a line parted on the way in could never
     * be replaced and the shout could not be finished. Measured by playing
     * it: parted once in the lane, then unfinished at twenty minutes.
     */
    tick: (ctx, dt) => {
      shoutTick(ctx, dt);
      updateTow(ctx, dt, ctx.data.casualty);
      if (ctx.data.lineOut) repassLine(ctx, dt, ctx.data.casualty, 'Line aboard again. Take the weight slowly — Slow, then Half.');
    },
    steps: [
      {
        id: 'out',
        text: 'Out to her. She is heavy and she has no engine at all, so everything from here is on your line.',
        hint: 'Have a look at the chart on the way out. You have to bring her back through that lane.',
        atc: {
          text:
            'Lifeboat, Coastguard. Fishing vessel with a dead engine about a mile out, two on board, ' +
            'no danger to life. They want a tow home.',
          voice: VOICE.coastguard,
        },
        targetLabel: 'Fishing boat',
        target: (ctx) => ctx.data.casualty.model.position.clone(),
        check: (ctx) => flatDist(boatOf(ctx).pos, ctx.data.casualty.model.position) < 110,
      },
      {
        id: 'pass',
        text: 'Get alongside slowly and pass her a line.',
        hint: 'Under two knots. A heavy boat and a fast approach is how people get hurt.',
        targetLabel: 'Fishing boat',
        target: (ctx) => ctx.data.casualty.model.position.clone(),
        check: (ctx, dt) => holdStation(ctx, dt, ctx.data.casualty.model.position, 'hold') > 3.5,
        onDone: (ctx) => {
          ctx.data.casualty.towed = true;
          ctx.data.towStrain = 0;
          ctx.data.lineOut = true;
          ctx.sim.hud.notify('Line aboard. Take the weight slowly — Slow ahead, then Half.', 'good', 7);
        },
      },
      {
        id: 'tow',
        text: 'Tow her home through the lane. Build the speed up gently and keep it there.',
        hint: 'If the line parts, go back, get alongside slowly and pass another. It costs you time, not the job.',
        get targetLabel() {
          return lineState.parted ? 'Fishing boat — pass another line' : 'Harbour mouth';
        },
        // Lose the line and the next place you have to be is back beside her,
        // so that is where the arrow goes. An arrow that keeps pointing home
        // while the boat you were sent for is a mile behind you is
        // the game telling a child to abandon somebody.
        target: (ctx) =>
          ctx.data.casualty.towed ? F(ctx).mouth.clone() : ctx.data.casualty.model.position.clone(),
        /*
         * You cannot finish this leg with the line broken.
         *
         * Without the second half of this check you could part the line at the
         * harbour mouth, motor the last hundred metres on your own and be told
         * well done while the boat you were sent for sat a mile out in the
         * dark. Arriving without her is not arriving.
         */
        check: (ctx) =>
          ctx.data.casualty.towed && flatDist(boatOf(ctx).pos, F(ctx).mouth) < 90,
        enter: (ctx) => {
          if (!ctx.data.casualty.towed) {
            ctx.sim.hud.notify('You have no line on her. Go back alongside and pass another.', 'warn', 6);
          }
        },
      },
      {
        id: 'repass',
        /*
         * A step that is usually skipped in its first frame.
         *
         * If the line is still on at the harbour mouth this completes
         * immediately and nobody ever sees it. If it parted on the way in, it
         * is the thing that sends you back out for her rather than quietly
         * letting the tow finish itself.
         */
        text: 'Pass her another line and bring her in.',
        hint: 'Alongside, under two knots, and take the weight gently this time.',
        targetLabel: 'Fishing boat',
        target: (ctx) => ctx.data.casualty.model.position.clone(),
        check: (ctx, dt) => {
          if (ctx.data.casualty.towed) return true;
          const held = holdStation(ctx, dt, ctx.data.casualty.model.position, 'hold');
          if (held > 3.5) {
            ctx.data.casualty.towed = true;
            ctx.data.towStrain = 0;
            return true;
          }
          return false;
        },
      },
      {
        id: 'berth',
        text: 'In through the mouth with her behind you, and stop at the yellow jetty.',
        hint: 'She will keep coming when you stop. Leave yourself room.',
        get targetLabel() {
          return lineState.parted ? 'Fishing boat — pass another line' : 'Lifeboat berth';
        },
        target: (ctx) => (ctx.data.casualty.towed ? F(ctx).berth.clone() : ctx.data.casualty.model.position.clone()),
        check: (ctx, dt) => ctx.data.casualty.towed && alongsideAtHome(ctx, dt),
      },
    ],
    onComplete: (ctx, result) => {
      const parted = ctx.data.towsParted || 0;
      boathouseSaysWellDone(
        ctx,
        result,
        parted === 0
          ? 'Lifeboat, boathouse. Never parted a line. That is as good a tow as I have seen.'
          : 'Lifeboat, boathouse. She is on the wall. You got her home, and that is what counts.'
      );
    },
    score: (ctx) => boatScore(ctx, { people: 0 }),
  },
];

/* ------------------------------------------------------------------ *
 * FREE MODE — PATROL.
 *
 * No clock, no debrief, and nothing you can fail. The harbour, the chart, the
 * weather you chose, and — unless you turn it off — a shout every few minutes
 * from wherever you happen to be.
 *
 * WHY THE SHOUTS ARE ON BY DEFAULT. "Out on the water with nothing to do" is
 * the failure mode the user has already named once, about this exact game:
 * given a boat and an empty sea, a child drives in a straight line for forty
 * seconds and quits. A checkbox is a much cheaper answer than a seventh
 * mission, and it means the free mode teaches the same three things the
 * missions do without anybody being made to do a mission.
 *
 * It is built as a mission with one step whose check never returns true, so
 * the runner drives it exactly like everything else: the step's `target` is
 * re-read every frame, which is what puts the arrow on the casualty and the
 * mark on the chart, and `tick` does the rest. No new system, no second
 * scheduler, nothing in main.js that has to know patrol is special.
 * ------------------------------------------------------------------ */

const PATROL_TEMPLATES = [
  {
    kind: 'dinghy',
    people: 2,
    label: 'dinghy adrift',
    call: 'Lifeboat, Coastguard. Small dinghy adrift with two on board, close to you. Can you have a look?',
    done: 'Lifeboat, Coastguard. Thank you — that is them safe.',
  },
  {
    kind: 'swimmer',
    people: 1,
    label: 'person in the water',
    call: 'Lifeboat, Coastguard. Person in the water near you. Orange lifejacket. Go now.',
    done: 'Lifeboat, Coastguard. Got him? Well found.',
  },
  {
    kind: 'fishing',
    people: 2,
    label: 'fishing boat, engine failure',
    call: 'Lifeboat, Coastguard. Fishing boat with engine trouble a little way from you. No danger to life.',
    done: 'Lifeboat, Coastguard. Nicely done. They can get themselves in from there.',
  },
];

/**
 * Somewhere to put a shout, found by walking outward from the player.
 *
 * Between 700 and 2,000 metres — near enough that it is two or three minutes
 * away at Half ahead, far enough that you have to go somewhere — in water that
 * is deep enough to float in. It walks outward rather than picking a point and
 * hoping, because half of any of these maps is dry land and a casualty on a
 * hillside would be the single most game-breaking thing in the file.
 */
function sitePatrolShout(from) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const a = Math.random() * Math.PI * 2;
    const r = 700 + Math.random() * 1300;
    const x = from.x + Math.sin(a) * r;
    const z = from.z + Math.cos(a) * r;
    if (depthAt(x, z) < 3) continue;
    // And the water has to keep going, so you are not sent into a pocket.
    let ok = true;
    for (let k = 80; k <= 240; k += 80) {
      if (depthAt(x + Math.sin(a) * k, z + Math.cos(a) * k) < 2) ok = false;
    }
    if (ok) return V(x, 0, z);
  }
  return null;
}

export const BOAT_PATROL = {
  id: 'boat-patrol',
  subject: 'boat',
  vehicle: 'boat',
  name: 'Patrol',
  short: 'Out on the water',
  difficulty: 'Free',
  blurb: 'No clock. Take her out, get to know the water, and answer anything that comes in.',
  failOnCrash: false,
  /** Set by the menu's "Answer shouts while you're out" checkbox. */
  shouts: true,
  onStart: (ctx) => {
    beginShout(ctx);
    ctx.data.nextShout = 60 + Math.random() * 90;
    ctx.data.shout = null;
    ctx.data.helped = 0;
    ctx.sim.hud.notify(
      ctx.runner.def.shouts === false
        ? 'Out you go. Nothing on the radio — the bay is yours.'
        : 'Out you go. Keep the radio on: something usually comes in.',
      'info',
      7
    );
  },
  tick: (ctx, dt) => {
    watchSeabed(ctx, dt);
    for (const p of PROPS) p.update(dt, ctx);
    const d = ctx.data;
    const b = boatOf(ctx);
    if (!b) return;
    if (ctx.runner.def.shouts === false) return;

    // Nothing on: count down to the next one.
    if (!d.shout) {
      d.nextShout -= dt;
      if (d.nextShout > 0) return;
      const at = sitePatrolShout(b.pos);
      if (!at) {
        // No sea room where you are. Ask again shortly rather than inventing
        // a casualty on a hillside.
        d.nextShout = 25;
        return;
      }
      const t = PATROL_TEMPLATES[Math.floor(Math.random() * PATROL_TEMPLATES.length)];
      const prop = spawnCasualty(ctx, t.kind, at, {
        people: t.people,
        heading: Math.random() * 6.28,
      });
      d.shout = { t, prop, since: 0 };
      const rb = rangeAndBearing(b.pos, at);
      ctx.sim.speak(t.call, VOICE.coastguard, 1);
      ctx.sim.hud.notify(`SHOUT · ${t.label} · ${rb.text}`, 'warn', 8);
      ctx.sim.hud.setObjective('Shout', `${t.label} — ${rb.text}. Get alongside slowly and take them off.`);
      return;
    }

    // Something on: are you alongside it?
    const s = d.shout;
    s.since += dt;
    const done = takeOffPeople(ctx, dt, s.prop, s.t.people);
    if (done) {
      ctx.sim.speak(s.t.done, VOICE.coastguard);
      d.helped++;
      removeProp(s.prop);
      d.shout = null;
      d.aboard = 0;
      ctx.sim.boatAboard = null;
      d.nextShout = 180 + Math.random() * 180;
      ctx.sim.hud.setObjective(
        'Patrol',
        `${d.helped} shout${d.helped > 1 ? 's' : ''} answered. Carry on — something else will come in.`
      );
    }
  },
  steps: [
    {
      id: 'patrol',
      text: 'Out you go. There is no clock on this one.',
      hint: 'The chart is the instrument that matters. Amber is no, pale is care, blue is yes.',
      targetLabel: 'Casualty',
      target: (ctx) =>
        ctx.data.shout ? ctx.data.shout.prop.model.position.clone() : F(ctx).mouth.clone(),
      /*
       * Never true, on purpose. Patrol does not end; you leave it with Esc,
       * the same way you leave a free flight. Returning false rather than
       * leaving the step with no check at all matters — the runner's default
       * for a step with neither gates nor a check is "done after three
       * seconds", which would have completed the whole thing before you had
       * got off the berth.
       */
      check: () => false,
    },
  ],
};

/* ------------------------------------------------------------------ *
 * THE WAY THERE: an arrow that keeps her afloat.
 *
 * Every step's `target` is a place — the dinghy, the harbour mouth, the
 * berth — and the arrow used to point straight at it. A straight line from
 * the berth to anything outside runs through the breakwater, and on the
 * Skerries a straight line to the Wren runs over half a dozen rocks. The
 * step text says "follow the arrow"; a child who does exactly that should
 * not be put on the putty for it.
 *
 * So the arrow points at the next corner of a route that stays in water
 * she floats in, found on a coarse depth grid: 20 m cells (the harbour mouth
 * is three and a half of them), a cell is water if there are 1.4 m under the
 * keel, and water under 4 m costs a little more so the route keeps to the
 * lane and the channel where there is one. A* over it, then pulled tight: the
 * arrow points at the FURTHEST point on the route she can steer straight
 * at without crossing anything shallow, so on open water it is simply the
 * target and it only bends where it has to.
 *
 * Cost, measured in the browser on Sennen: the grid for a First Shout area
 * (about 2.6 km square) is 17 thousand heightAt calls, once per mission,
 * and a plan is a few milliseconds. Plans are redone every three seconds,
 * or at once when the target moves or she leaves the route — never per
 * frame.
 * ------------------------------------------------------------------ */

const ROUTE_CELL = 20;
const ROUTE_WATER = 1.4;
const ROUTE_MAX_CELLS = 260;

let routeGridCache = null;
let routePlan = null;
/** How often the expensive parts ran, for the playtest to keep an eye on. */
export const boatRouteStats = { grids: 0, plans: 0, cells: 0 };

/** Forget the grid: a new map has a new sea floor. */
export function resetBoatRoute() {
  routeGridCache = null;
  routePlan = null;
}

/**
 * Build the grid for the water round this harbour now, at the start of the
 * trip, rather than on the frame the first route is asked for. Measured on
 * a desktop: 9 to 11 ms for a first plan, which on a 2019 Chromebook is two
 * or three dropped frames in the middle of a shout; at the start it hides
 * inside the map load that is happening anyway. Every shout in the game is
 * inside 1.6 km of its harbour mouth, so that is the square it covers.
 */
export function warmBoatRoute(sim) {
  const f = frameOf(sim);
  const R = 1600;
  routeGrid(
    Math.min(f.mouth.x, f.berth.x) - R,
    Math.min(f.mouth.z, f.berth.z) - R,
    Math.max(f.mouth.x, f.berth.x) + R,
    Math.max(f.mouth.z, f.berth.z) + R
  );
}

function routeGrid(x0, z0, x1, z1) {
  const mapKey = `${heightAt(137, -91).toFixed(3)}|${heightAt(-911, 733).toFixed(3)}`;
  const g = routeGridCache;
  if (g && g.mapKey === mapKey && x0 >= g.x0 && z0 >= g.z0 && x1 <= g.x0 + g.nx * ROUTE_CELL && z1 <= g.z0 + g.nz * ROUTE_CELL) {
    return g;
  }
  // Grow to cover the old one as well, so hopping between two places does
  // not rebuild it every time.
  if (g && g.mapKey === mapKey) {
    x0 = Math.min(x0, g.x0);
    z0 = Math.min(z0, g.z0);
    x1 = Math.max(x1, g.x0 + g.nx * ROUTE_CELL);
    z1 = Math.max(z1, g.z0 + g.nz * ROUTE_CELL);
  }
  let nx = Math.ceil((x1 - x0) / ROUTE_CELL) + 1;
  let nz = Math.ceil((z1 - z0) / ROUTE_CELL) + 1;
  // Never bigger than 260 cells a side (5.2 km): past that, centre on the
  // middle of what was asked for and let the far ends go straight.
  if (nx > ROUTE_MAX_CELLS) {
    x0 = (x0 + x1) / 2 - (ROUTE_MAX_CELLS * ROUTE_CELL) / 2;
    nx = ROUTE_MAX_CELLS;
  }
  if (nz > ROUTE_MAX_CELLS) {
    z0 = (z0 + z1) / 2 - (ROUTE_MAX_CELLS * ROUTE_CELL) / 2;
    nz = ROUTE_MAX_CELLS;
  }
  const depth = new Float32Array(nx * nz);
  boatRouteStats.grids++;
  boatRouteStats.cells = nx * nz;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      depth[j * nx + i] = depthAt(x0 + i * ROUTE_CELL, z0 + j * ROUTE_CELL);
    }
  }
  routeGridCache = { x0, z0, nx, nz, depth, mapKey, came: new Int32Array(nx * nz), cost: new Float32Array(nx * nz), heap: new Int32Array(nx * nz * 4), fsc: new Float32Array(nx * nz * 4) };
  return routeGridCache;
}

function cellOf(g, x, z) {
  const i = Math.round((x - g.x0) / ROUTE_CELL);
  const j = Math.round((z - g.z0) / ROUTE_CELL);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) return -1;
  return j * g.nx + i;
}

/** The nearest water cell to `c`, spiralling out up to `reach` cells. */
function nearestWater(g, c, reach) {
  if (c < 0) return -1;
  if (g.depth[c] >= ROUTE_WATER) return c;
  const ci = c % g.nx;
  const cj = (c / g.nx) | 0;
  for (let r = 1; r <= reach; r++) {
    let best = -1;
    let bestD = -1;
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) continue;
        const k = j * g.nx + i;
        if (g.depth[k] >= ROUTE_WATER && g.depth[k] > bestD) {
          best = k;
          bestD = g.depth[k];
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/**
 * Is the straight run from (ax, az) to (bx, bz) good water, with room either
 * side of her? Sampled every 8 m down the middle and 6 m out each side.
 *
 * It read the middle line only, against 1.0 m, and in the Gale that led the
 * launch into Longbank's harbour mouth close along a breakwater head: with
 * 0.7 m/s of leeway on her she bumped it six times in forty seconds. Two
 * metres down the middle and one either side keeps her a boat's width off.
 */
function clearRun(g, ax, az, bx, bz) {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(d / 8));
  const nx = d > 0 ? (-(bz - az) / d) * 6 : 0;
  const nz = d > 0 ? ((bx - ax) / d) * 6 : 0;
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    // The height field itself, not the grid: a 20 m cell can hide the corner
    // of a breakwater.
    if (depthAt(x, z) < 2) return false;
    if (depthAt(x + nx, z + nz) < 1 || depthAt(x - nx, z - nz) < 1) return false;
  }
  return true;
}

function planRoute(g, from, to) {
  const start = nearestWater(g, cellOf(g, from.x, from.z), 6);
  const goal = nearestWater(g, cellOf(g, to.x, to.z), 18);
  if (start < 0 || goal < 0) return null;
  const { nx, nz, depth, came, cost, heap, fsc } = g;
  cost.fill(Infinity);
  came.fill(-1);
  const gi = goal % nx;
  const gj = (goal / nx) | 0;
  const h = (k) => {
    const di = Math.abs((k % nx) - gi);
    const dj = Math.abs(((k / nx) | 0) - gj);
    return Math.max(di, dj) + 0.414 * Math.min(di, dj);
  };
  // A binary heap in two typed arrays: no objects, nothing to collect.
  let size = 0;
  const push = (k, f) => {
    if (size >= heap.length) return;
    let i = size++;
    heap[i] = k;
    fsc[i] = f;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (fsc[p] <= fsc[i]) break;
      const tk = heap[p]; heap[p] = heap[i]; heap[i] = tk;
      const tf = fsc[p]; fsc[p] = fsc[i]; fsc[i] = tf;
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    size--;
    heap[0] = heap[size];
    fsc[0] = fsc[size];
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < size && fsc[l] < fsc[m]) m = l;
      if (r < size && fsc[r] < fsc[m]) m = r;
      if (m === i) break;
      const tk = heap[m]; heap[m] = heap[i]; heap[i] = tk;
      const tf = fsc[m]; fsc[m] = fsc[i]; fsc[i] = tf;
      i = m;
    }
    return top;
  };
  cost[start] = 0;
  push(start, h(start));
  let found = false;
  let guard = 0;
  while (size > 0 && guard++ < nx * nz * 2) {
    const k = pop();
    if (k === goal) {
      found = true;
      break;
    }
    const ki = k % nx;
    const kj = (k / nx) | 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const i = ki + di;
        const j = kj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
        const n = j * nx + i;
        const dn = depth[n];
        if (dn < ROUTE_WATER) continue;
        // No cutting a corner between two shallow cells.
        if (di && dj && (depth[kj * nx + i] < ROUTE_WATER || depth[j * nx + ki] < ROUTE_WATER)) continue;
        const step = di && dj ? 1.414 : 1;
        // Water beside a wall or a rock costs three times as much, so the
        // route runs down the middle of a gap rather than along one side of it.
        let edge = 0;
        if (i > 0 && depth[n - 1] < ROUTE_WATER) edge = 1;
        else if (i < nx - 1 && depth[n + 1] < ROUTE_WATER) edge = 1;
        else if (j > 0 && depth[n - nx] < ROUTE_WATER) edge = 1;
        else if (j < nz - 1 && depth[n + nx] < ROUTE_WATER) edge = 1;
        const c = cost[k] + step * (1 + Math.max(0, 4 - dn) * 0.3 + edge * 2);
        if (c < cost[n]) {
          cost[n] = c;
          came[n] = k;
          push(n, c + h(n));
        }
      }
    }
  }
  if (!found) return null;
  const path = [];
  for (let k = goal; k >= 0; k = came[k]) {
    path.push(g.x0 + (k % nx) * ROUTE_CELL, g.z0 + ((k / nx) | 0) * ROUTE_CELL);
    if (k === start) break;
  }
  // Stored start-first, as a flat [x0, z0, x1, z1, ...].
  const flat = new Float32Array(path.length);
  for (let i = 0, n = path.length / 2; i < n; i++) {
    flat[i * 2] = path[(n - 1 - i) * 2];
    flat[i * 2 + 1] = path[(n - 1 - i) * 2 + 1];
  }
  return flat;
}

/**
 * Where the arrow should point: the next corner of a route that keeps her
 * afloat, on the way to `to`.
 *
 * Writes into and returns `out` ({ x, z, routed, legs }), so the caller owns
 * the object and nothing is allocated per call. `routed` is false when the
 * answer is simply the target itself (open water, or no route found — in
 * which case pointing at the target is the honest fallback).
 */
export function boatRoute(sim, from, to, out = { x: 0, z: 0, routed: false, legs: 0 }) {
  out.x = to.x;
  out.z = to.z;
  out.routed = false;
  out.legs = 0;
  if (!from || !to) return out;
  // Close in, or a clear run: just go there.
  const direct = Math.hypot(to.x - from.x, to.z - from.z);
  if (direct < 60 || clearRun(null, from.x, from.z, to.x, to.z)) {
    routePlan = null;
    return out;
  }
  const t = sim && sim.vehicle ? sim.vehicle.t : 0;
  const p = routePlan;
  const stale =
    !p ||
    Math.hypot(p.tx - to.x, p.tz - to.z) > 30 ||
    t - p.at > 3 ||
    t < p.at;
  if (stale) {
    const f = frameOf(sim);
    const pad = 500;
    const x0 = Math.min(from.x, to.x, f.berth.x, f.mouth.x) - pad;
    const z0 = Math.min(from.z, to.z, f.berth.z, f.mouth.z) - pad;
    const x1 = Math.max(from.x, to.x, f.berth.x, f.mouth.x) + pad;
    const z1 = Math.max(from.z, to.z, f.berth.z, f.mouth.z) + pad;
    const g = routeGrid(x0, z0, x1, z1);
    boatRouteStats.plans++;
    routePlan = { tx: to.x, tz: to.z, at: t, path: planRoute(g, from, to) };
  }
  const path = routePlan && routePlan.path;
  if (!path || path.length < 4) return out;
  // Pull the string tight: the furthest route point she can run straight at.
  let best = -1;
  let nearest = Infinity;
  let nearestI = 0;
  const n = path.length / 2;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(path[i * 2] - from.x, path[i * 2 + 1] - from.z);
    if (d < nearest) {
      nearest = d;
      nearestI = i;
    }
  }
  // Wandered well off it: plan again next time.
  if (nearest > 90 && routePlan) routePlan.at = -1e9;
  // At most ten straight-line tests, far to near, so a long route costs the
  // same as a short one: about a thousand heightAt calls at the very worst.
  const span = n - 1 - nearestI;
  const stride = Math.max(1, Math.ceil(span / 10));
  for (let i = n - 1; i > nearestI; i -= stride) {
    const x = path[i * 2];
    const z = path[i * 2 + 1];
    if (Math.hypot(x - from.x, z - from.z) > 700) continue;
    if (clearRun(null, from.x, from.z, x, z)) {
      best = i;
      break;
    }
  }
  if (best < 0) best = Math.min(n - 1, nearestI + 1);
  // The last corner is the water cell nearest the target; from there, the
  // target itself, even if it is in the shallows (the Wren is on a rock).
  if (best === n - 1 && clearRun(null, path[best * 2], path[best * 2 + 1], to.x, to.z)) {
    return out;
  }
  out.x = path[best * 2];
  out.z = path[best * 2 + 1];
  out.routed = true;
  out.legs = n - best;
  return out;
}

/**
 * An airfield that is not where the map says it is.
 *
 * world/apron.js lays the terminal, the air bridges, the stands and the
 * apron vehicles out at Kestrel's coordinates — round the world origin — at
 * whatever the map's airfield elevation is. Sennen Cove's airfield is on
 * Wester Isle, 5.6 km away, and its harbour is AT the origin: measured from
 * the berth, a jet bridge, a set of aircraft steps and a baggage train hang
 * 22 to 27 m in the air forty to sixty metres from the chase camera, with a
 * row of orange markers floating over the harbour mouth. That is the first thing a child sees in
 * the boat game.
 *
 * Fixing where apron.js puts things is its owner's job. What this does, for
 * the length of a boat trip only, is hide any top-level piece of the apron or
 * airport that is floating: its bottom more than eight metres above the
 * ground under it, within three kilometres of the harbour — on Longbank the
 * same terminal stands in the sea 1.3 km off the quay, on the horizon of the
 * whole Gale shout. A real airfield is never caught by this: the ground under
 * it is levelled to its own elevation, so nothing on it floats. It returns
 * what it hid so leave() can put it all back exactly as it was.
 */
export function hideStrayAirfield(sim) {
  const hidden = [];
  if (!sim) return hidden;
  const h = harbourOf(sim);
  if (!h) return hidden;
  const box = new THREE.Box3();
  const c = new THREE.Vector3();
  for (const owner of [sim.apron, sim.airport]) {
    const g = owner && owner.group;
    if (!g) continue;
    g.updateMatrixWorld(true);
    for (const o of g.children) {
      if (!o.visible) continue;
      box.setFromObject(o);
      if (box.isEmpty()) continue;
      box.getCenter(c);
      if (Math.hypot(c.x - h.berth.x, c.z - h.berth.z) > 3000) continue;
      const ground = Math.max(0, heightAt(c.x, c.z));
      if (box.min.y - ground > 8) {
        o.visible = false;
        hidden.push(o);
      }
    }
  }
  return hidden;
}

/** Put back what hideStrayAirfield() hid. */
export function restoreStrayAirfield(hidden) {
  if (!hidden) return;
  for (const o of hidden) o.visible = true;
  hidden.length = 0;
}

/* ------------------------------------------------------------------ */

export function findBoatMission(id) {
  if (id === BOAT_PATROL.id || id === 'patrol') return BOAT_PATROL;
  return BOAT_MISSIONS.find((m) => m.id === id) || null;
}

/** The shouts, in the order they should be flown. Used by the Boat menu. */
export function boatMissionList() {
  return BOAT_MISSIONS.map((m) => ({
    id: m.id,
    name: m.name,
    short: m.short,
    difficulty: m.difficulty,
    icon: m.icon,
    blurb: m.blurb,
    reward: m.reward,
    map: m.map,
    parTime: m.parTime,
  }));
}
