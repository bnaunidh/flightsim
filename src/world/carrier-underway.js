/**
 * The carrier under way.
 *
 * The ship was a building in the sea: anchored, pointing north, its deck an
 * axis-aligned box. This makes it a ship. It steams a racetrack at 14 knots —
 * out along its heading, a long gentle turn, back, and round again — and it
 * floats: it heaves, pitches and rolls on the swell under its own hull
 * (world/sea-state.js), a little, the way something that size does.
 *
 * THE DECK'S OWN FRAME. Everything that is ON the ship goes with it:
 *
 *   - the landing surface (terrain.js PLATFORMS): the box turns with the
 *     ship, and its height under a point is the tilted, heaving deck there;
 *   - the island's solid box (OBSTACLES), as five short boxes along it so it
 *     can turn;
 *   - an aeroplane on or just over the deck. While it is there its velocity
 *     is kept RELATIVE TO THE DECK and its position is carried by the ship's
 *     own movement each frame, so to the flight model the deck is standing
 *     still exactly as it always was: a parked jet stays parked, brakes hold,
 *     a catapult stroke and a wire run-out are measured along the deck. The
 *     air it flies in gets the ship's speed added (`ac.ride`, read by the
 *     flight model as wind over the deck), so leaving or joining the frame
 *     changes nothing the aeroplane can feel. Approach speed over the wires
 *     is therefore closing speed, which is what a trap is really judged on;
 *   - carrier ops' working numbers (the frame, a catapult in use, a wire
 *     paying out, the hook's last point) and its drawn gear;
 *   - somebody walking on the deck;
 *   - the far-away stand-in ship, and the wake on the sea.
 *
 * WHERE IT GOES. `planTrack` looks for a racetrack through the berth that
 * keeps the whole hull over deep water and out of every runway's approach
 * lane, trying shorter ones until one fits; a map with no room gets a ship
 * that holds station (and still floats). The same map always gives the same
 * track. Alone, the ship moves with the game's clock and holds still while
 * paused or wrecked on; in multiplayer it follows the wall clock so everyone
 * sees it in the same place.
 *
 * Loaded on demand by world/carrier.js: none of this is in the first load.
 */

import * as THREE from '../vendor/three.module.js';
import { PLATFORMS, OBSTACLES, heightAt, groundHeightAt, AIRPORT } from './terrain.js';
import { runwayLanes, laneIntrusion, BERTH } from './carrier-berth.js';

const D2R = Math.PI / 180;
const KT = 0.514444;

export const UNDERWAY = {
  /** Speed through the water, knots. */
  speedKts: 14,
  /** Racetracks to try, longest first: [straight leg, turn radius] in metres. */
  tracks: [[5200, 1700], [3600, 1700], [2400, 1600], [1200, 1500], [0, 1500], [0, 1100]],
  /** Where along the first leg the berth may lie (0 its south end, 1 its north), tried in this order. */
  berthAt: [0.5, 0.88, 0.12],
  /** Water this deep (m, negative) under the whole hull, with `margin` metres to spare all round. */
  minDepth: BERTH.minDepth,
  margin: 160,
  /** No nearer the airfield than this. */
  fieldClear: 3200,
  /** An aeroplane this far (m) over the deck or less rides the ship's frame. */
  frameHeight: 40,
  /** How much of the swell under the hull the ship follows, and how slowly (s). */
  response: 0.9,
  pitchGain: 1.5,
  rollGain: 1.1,
  lag: 1.3,
  /** Never more than this, whatever the sea: degrees, degrees, metres. */
  maxPitchDeg: 0.25,
  maxRollDeg: 0.6,
  maxHeave: 1.2,
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ------------------------------------------------------------------ */
/* The track                                                            */
/* ------------------------------------------------------------------ */

/**
 * A racetrack through (x, z), first leg northbound, turning to `side`
 * (+1 east, −1 west). `s` runs from the south end of the first leg.
 */
export function makeTrack(x, z, leg, radius, side, at = 0.5) {
  const turn = Math.PI * radius;
  // `z` is the berth; the leg's middle is north of it when the berth is toward the south end.
  return { x, z: z - leg * (0.5 - at), leg, radius, side, turn, length: 2 * leg + 2 * turn, start: leg * at };
}

/** Where the ship is `s` metres round the track: position, heading (deg) and turn rate per metre (rad). */
export function poseAt(t, s, out = {}) {
  const L = t.length;
  let u = ((s % L) + L) % L;
  const zs = t.z + t.leg / 2; // south end
  const zn = t.z - t.leg / 2; // north end
  const cx = t.x + t.side * t.radius;
  if (u < t.leg) {
    out.x = t.x;
    out.z = zs - u;
    out.headingDeg = 0;
    out.curve = 0;
    return out;
  }
  u -= t.leg;
  if (u < t.turn) {
    // Round the north end: heading 0 → 180, clockwise for an east turn.
    const a = u / t.radius;
    out.x = cx - t.side * t.radius * Math.cos(a);
    out.z = zn - t.radius * Math.sin(a);
    out.headingDeg = (((t.side * a) / D2R) % 360 + 360) % 360;
    out.curve = t.side / t.radius;
    return out;
  }
  u -= t.turn;
  if (u < t.leg) {
    out.x = t.x + 2 * t.side * t.radius;
    out.z = zn + u;
    out.headingDeg = 180;
    out.curve = 0;
    return out;
  }
  u -= t.leg;
  const a = u / t.radius;
  out.x = cx + t.side * t.radius * Math.cos(a);
  out.z = zs + t.radius * Math.sin(a);
  out.headingDeg = ((180 + (t.side * a) / D2R) % 360 + 360) % 360;
  out.curve = t.side / t.radius;
  return out;
}

/** World point for a ship-local one (+x starboard, +z aft) at a pose. */
function local(pose, lx, lz, out = {}) {
  const h = pose.headingDeg * D2R;
  const c = Math.cos(h);
  const s = Math.sin(h);
  out.x = pose.x + lx * c - lz * s;
  out.z = pose.z + lx * s + lz * c;
  return out;
}

/**
 * Is every point of this track somewhere a ship can be? Returns the worst
 * (shallowest) water found, or null when it runs aground, crosses an approach
 * lane or comes too near the field.
 */
export function checkTrack(t, { height, lanes, field, halfWidth, halfLength, step = 250 }) {
  const U = UNDERWAY;
  const hw = halfWidth + U.margin;
  const hl = halfLength + U.margin;
  const pose = {};
  const p = {};
  let worst = -Infinity;
  for (let s = 0; s < t.length || s === 0; s += step) {
    poseAt(t, s, pose);
    for (const [fx, fz] of [[0, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1], [-1, 0], [1, 0]]) {
      local(pose, fx * hw, fz * hl, p);
      const h = height(p.x, p.z);
      if (!(h < U.minDepth)) return null;
      if (h > worst) worst = h;
    }
    for (const fz of [-1, 0, 1]) {
      local(pose, 0, fz * halfLength, p);
      if (laneIntrusion(lanes, p.x, p.z) > 0) return null;
      if (field && Math.hypot(p.x - field.x, p.z - field.z) < U.fieldClear + halfLength) return null;
    }
    if (t.length === 0) break;
  }
  return worst;
}

/**
 * The racetrack for a berth, or null if the ship has to hold station.
 * Deterministic: the longest track that fits, turning away from the field
 * when both sides do.
 */
export function planTrack(berth, { height = groundHeightAt, airport = AIRPORT, halfWidth = 180, halfLength = 750 } = {}) {
  const lanes = runwayLanes(airport);
  const r = airport && airport.runway;
  const field = r ? { x: r.cx, z: r.cz } : null;
  const away = field && field.x > berth.x ? -1 : 1;
  for (const [leg, radius] of UNDERWAY.tracks) {
    for (const at of leg ? UNDERWAY.berthAt : [0.5]) {
      for (const side of [away, -away]) {
        const t = makeTrack(berth.x, berth.z, leg, radius, side, at);
        if (checkTrack(t, { height, lanes, field, halfWidth, halfLength }) != null) return t;
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* The ship's state                                                     */
/* ------------------------------------------------------------------ */

const ISLAND_BOXES = 5;

/**
 * Make a Carrier (world/carrier.js) a ship under way. `dims` is the deck's
 * half width and half length, its height, and the island's box (ship-local
 * centre, size, height), all in metres.
 */
export function install(carrier, dims) {
  const name = carrier.name;
  const platform = PLATFORMS.find((p) => p.name === name) || null;
  if (!platform) return null;
  const berth = { x: carrier.pos.x, z: carrier.pos.z };
  let track = null;
  try {
    track = planTrack(berth, { halfWidth: dims.halfWidth, halfLength: dims.halfLength });
  } catch (e) {
    console.warn('The carrier holds station (no track):', e);
  }
  const way = {
    track,
    berth,
    dims,
    s: track ? track.start : 0,
    speed: track ? UNDERWAY.speedKts * KT : 0,
    pose: { x: berth.x, z: berth.z, headingDeg: 0, curve: 0 },
    vel: { x: 0, z: 0 },
    yawRate: 0, // rad/s, clockwise from above
    heave: 0,
    pitch: 0, // rad, bow up positive (group.rotation.x)
    roll: 0, // rad, starboard up positive (group.rotation.z)
    cos: 1,
    sin: 0,
    platform,
    island: [],
    moving: false,
    frozen: false,
    last: new THREE.Vector3(NaN, 0, 0),
  };

  // The island: its one box becomes a row of short ones, so it can turn with the ship.
  const what = `You flew into ${name}`;
  const at = OBSTACLES.findIndex((o) => o.what === what);
  if (at >= 0) {
    const base = OBSTACLES[at];
    OBSTACLES.splice(at, 1);
    for (let i = 0; i < ISLAND_BOXES; i++) {
      const o = { x0: 0, x1: 0, z0: 0, z1: 0, y0: base.y0, y1: base.y1, what };
      OBSTACLES.push(o);
      way.island.push(o);
    }
    way.islandY = [base.y0, base.y1];
  }

  /*
   * The deck, as the ship's own test: the box turned to the ship's heading,
   * and `y` set to the deck's height under the point asked about — heave and
   * tilt included — so every caller that reads `platformAt(x, z).y` gets the
   * steel that is drawn there.
   */
  platform.at = (x, z) => {
    const dx = x - platform.cx;
    const dz = z - platform.cz;
    const lx = dx * way.cos + dz * way.sin;
    const lz = -dx * way.sin + dz * way.cos;
    if (Math.abs(lx) > dims.halfWidth || Math.abs(lz) > dims.halfLength) return false;
    platform.y = dims.deckY + way.heave + lx * way.roll - lz * way.pitch;
    platform.lx = lx;
    return true;
  };
  platform.hw = dims.halfWidth;
  platform.hd = dims.halfLength;

  carrier.way = way;
  /*
   * Her escort: anything that keeps station on her without being on her —
   * the patrol boats' route, the guard helicopter's orbit (features/
   * ambient.js). `dx`, `dz` is how far she has come from her berth; a point
   * given to `add` is moved by that much from where it was when it was added.
   */
  carrier.escort = {
    dx: 0,
    dz: 0,
    moving: false,
    headingDeg: 0,
    points: [],
    add(p) {
      this.points.push({ p, x: p.x - this.dx, z: p.z - this.dz });
    },
  };
  carrier.sail = (dt, sim) => sail(carrier, dt, sim);
  /** The deck's velocity (m/s) at a world point, turn included. */
  carrier.deckVelAt = (x, z, out = {}) => {
    out.x = way.vel.x - way.yawRate * (z - way.pose.z);
    out.z = way.vel.z + way.yawRate * (x - way.pose.x);
    return out;
  };
  place(carrier, way);
  return way;
}

/** Write the pose into everything static that describes the ship. */
function place(carrier, way) {
  const { pose, dims, platform } = way;
  const h = pose.headingDeg * D2R;
  way.cos = Math.cos(h);
  way.sin = Math.sin(h);
  carrier.pos.x = pose.x;
  carrier.pos.z = pose.z;
  carrier.headingDeg = pose.headingDeg;
  platform.cx = pose.x;
  platform.cz = pose.z;
  platform.yaw = h;
  platform.y = dims.deckY + way.heave;
  // The band the wires lie in, for whoever still aims at it (true on the northbound leg).
  if (carrier.wires && carrier.wires.z0 != null) {
    const w = carrier.wires.z1 - carrier.wires.z0;
    const from = dims.wireFrom != null ? dims.wireFrom : 0;
    carrier.wires.z0 = pose.z + from;
    carrier.wires.z1 = pose.z + from + w;
  }
  // The island's boxes: squares along its length, so their union follows the heading.
  const isl = dims.island;
  if (isl && way.island.length) {
    const n = way.island.length;
    const short = Math.min(isl.width, isl.depth);
    const span = Math.max(isl.width, isl.depth) - short;
    const alongZ = isl.depth >= isl.width;
    const p = {};
    for (let i = 0; i < n; i++) {
      const k = n > 1 ? i / (n - 1) - 0.5 : 0;
      local(pose, isl.x + (alongZ ? 0 : k * span), isl.z + (alongZ ? k * span : 0), p);
      const o = way.island[i];
      o.x0 = p.x - short / 2;
      o.x1 = p.x + short / 2;
      o.z0 = p.z - short / 2;
      o.z1 = p.z + short / 2;
      o.y0 = way.islandY[0] + way.heave;
      o.y1 = way.islandY[1] + way.heave;
    }
  }
  const e = carrier.escort;
  if (e) {
    e.dx = pose.x - way.berth.x;
    e.dz = pose.z - way.berth.z;
    e.moving = way.moving;
    e.headingDeg = pose.headingDeg;
    for (let i = 0; i < e.points.length; i++) {
      const q = e.points[i];
      q.p.x = q.x + e.dx;
      q.p.z = q.z + e.dz;
    }
  }
  // The picture: turned, tilted about the middle of the deck, and lifted.
  const g = carrier.group;
  if (g) {
    g.rotation.set(way.pitch, -h, way.roll, 'YXZ');
    _v.set(0, dims.deckY, 0).applyEuler(g.rotation);
    g.position.set(pose.x - _v.x, dims.deckY + way.heave - _v.y, pose.z - _v.z);
  }
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _one = new THREE.Vector3(1, 1, 1);
const _w = {};
const _d = {};
const _old = {};

/** The swell under the hull, as heave, pitch and roll: the ship follows it, late and not all the way. */
function ride(carrier, way, dt, ocean) {
  const U = UNDERWAY;
  let heave = 0;
  let pitch = 0;
  let roll = 0;
  if (ocean && ocean.waveAt) {
    const { halfWidth: hw, halfLength: hl } = way.dims;
    const P = way.pose;
    const p = {};
    const at = (lx, lz) => {
      local(P, lx, lz, p);
      return ocean.waveAt(p.x, p.z, _w).h;
    };
    /*
     * Five points under the hull. A ship this long really would lie almost
     * still on a swell a sixth of her length; the points are taken well
     * inboard and the result is not averaged down, so she visibly lives on
     * the sea — and is still only tenths of a degree (the limits above).
     */
    const c = at(0, 0);
    const bow = at(0, -0.5 * hl);
    const stern = at(0, 0.5 * hl);
    const port = at(-0.5 * hw, 0);
    const stbd = at(0.5 * hw, 0);
    heave = (c * 0.5 + (bow + stern + port + stbd) * 0.125) * U.response;
    pitch = ((bow - stern) / hl) * U.pitchGain;
    roll = ((stbd - port) / hw) * U.rollGain;
  }
  const k = 1 - Math.exp(-Math.max(0, dt) / U.lag);
  way.heave += (clamp(heave, -U.maxHeave, U.maxHeave) - way.heave) * k;
  way.pitch += (clamp(pitch, -U.maxPitchDeg * D2R, U.maxPitchDeg * D2R) - way.pitch) * k;
  way.roll += (clamp(roll, -U.maxRollDeg * D2R, U.maxRollDeg * D2R) - way.roll) * k;
}

/** Move a world point with the ship: from the old pose to the new one. */
function carry(p, old, now, cd, sd) {
  const rx = p.x - old.x;
  const rz = p.z - old.z;
  p.x = now.x + rx * cd - rz * sd;
  p.z = now.z + rx * sd + rz * cd;
}
function turn(v, cd, sd) {
  const x = v.x;
  v.x = x * cd - v.z * sd;
  v.z = x * sd + v.z * cd;
}

let MP = null;
let WALK = null;
let FOOT = null;
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  import('../features/multiplayer.js').then((m) => { MP = m.multiplayer || null; }).catch(() => {});
  import('../features/staff/walk.js').then((m) => { WALK = m; }).catch(() => {});
  import('../features/onfoot.js').then((m) => { FOOT = m.onFoot || null; }).catch(() => {});
}
function inLobby() {
  try {
    return !!(MP && MP.role);
  } catch (e) {
    return false;
  }
}

/*
 * A flight saved on the deck is resumed on the deck.
 *
 * The game's checkpoint (game/checkpoint.js) keeps the aeroplane's place in
 * the world, and the ship will not be there when the flight is picked up
 * again: a jet parked on the deck would be put back in mid-air where the deck
 * used to be. So each time a checkpoint is taken with the aeroplane on the
 * ship, how far round her track she was is kept beside it; and when a flight
 * begins with the aeroplane exactly at that saved place, she is put back
 * there under it.
 */
const KEEP = 'islandsim.carrierWay.v1';

function keepWithCheckpoints(sim) {
  if (!sim || typeof sim.saveCheckpoint !== 'function' || sim.saveCheckpoint._ship) return;
  const own = sim.saveCheckpoint.bind(sim);
  const wrapped = () => {
    const cp = own();
    try {
      const c = sim.carrier;
      const ac = sim.aircraft;
      if (cp && c && c.way && c.way.track && ac && ac._onShip === c) {
        localStorage.setItem(KEEP, JSON.stringify({ s: c.way.s, x: ac.pos.x, y: ac.pos.y, z: ac.pos.z }));
      } else if (cp) localStorage.removeItem(KEEP);
    } catch (e) {
      /* storage blocked: a resumed deck flight starts from the berth's sea instead */
    }
    return cp;
  };
  wrapped._ship = true;
  sim.saveCheckpoint = wrapped;
}

function recall(carrier, way, ac) {
  if (!way.track) return;
  let k = null;
  try {
    k = JSON.parse(localStorage.getItem(KEEP) || 'null');
  } catch (e) {
    k = null;
  }
  if (!k || !Number.isFinite(k.s) || Math.hypot(ac.pos.x - k.x, ac.pos.y - k.y, ac.pos.z - k.z) > 1) return;
  way.s = k.s;
  poseAt(way.track, way.s, way.pose);
  place(carrier, way);
}

/** Is this world point over the deck (as it stands now), and how high above it? null if not. */
function overDeck(way, x, y, z) {
  const p = way.platform;
  if (!p.at(x, z)) return null;
  return y - p.y;
}

/**
 * One frame of the ship. Called before the flight model steps, with the game
 * (`sim`) so the things riding the ship can be found; every one of them is
 * optional, and a plain `{}` sails the ship alone.
 */
export function sail(carrier, dt, sim = {}) {
  const way = carrier.way;
  if (!way) return;
  const U = UNDERWAY;
  const ac = sim.aircraft || null;
  // A new flight, or a jump: the aeroplane is not where a frame of flying would have put it.
  const jumped = !!(ac && ac.pos && ac.vel) && !(way.last.distanceTo(ac.pos) < 60 + ac.vel.length() * dt * 3);
  const lobby = inLobby();
  if (jumped && !lobby) {
    keepWithCheckpoints(sim);
    recall(carrier, way, ac);
  }
  const old = _old;
  old.x = way.pose.x;
  old.z = way.pose.z;
  old.headingDeg = way.pose.headingDeg;

  // Who is riding, judged against the deck where it is now.
  let riding = false;
  if (ac && ac.pos) {
    const h = overDeck(way, ac.pos.x, ac.pos.y, ac.pos.z);
    riding = h != null && h < U.frameHeight && h > -8;
  }

  // Where the ship goes this frame.
  way.frozen = !lobby && !!(ac && (ac.crashed || ac.ditched));
  let ds = 0;
  if (way.track && way.speed > 0) {
    if (lobby) {
      const L = way.track.length;
      const want = (((Date.now() / 1000) * way.speed) % L + L) % L;
      ds = want - (((way.s % L) + L) % L);
      if (ds < -L / 2) ds += L;
      if (ds > L / 2) ds -= L;
    } else if (!way.frozen) {
      ds = way.speed * dt;
    }
    way.s += ds;
    poseAt(way.track, way.s, way.pose);
  }
  const now = way.pose;
  const dh = (((now.headingDeg - old.headingDeg + 540) % 360) - 180) * D2R;
  const cd = Math.cos(dh);
  const sd = Math.sin(dh);
  const moved = ds !== 0;
  const speedNow = dt > 0 && moved && Math.abs(ds) < way.speed * dt * 4 + 0.5 ? ds / dt : moved ? way.speed : 0;
  const hr = now.headingDeg * D2R;
  way.vel.x = Math.sin(hr) * speedNow;
  way.vel.z = -Math.cos(hr) * speedNow;
  way.yawRate = speedNow * (now.curve || 0);
  way.moving = speedNow > 0.05;

  ride(carrier, way, dt, sim.ocean);
  place(carrier, way);

  // The aeroplane: into the deck's frame, carried, or out of it.
  if (ac && ac.pos && ac.vel) {
    const was = ac._onShip === carrier;
    if (riding) {
      if (!was && !jumped) {
        // Joining: from here its speed is counted against the deck.
        carrier.deckVelAt(ac.pos.x, ac.pos.z, _d);
        ac.vel.x -= _d.x;
        ac.vel.z -= _d.z;
      }
      ac._onShip = carrier;
      if (moved) {
        carry(ac.pos, old, now, cd, sd);
        if (dh !== 0) {
          turn(ac.vel, cd, sd);
          ac.quat.premultiply(_q.setFromAxisAngle(_up, -dh)).normalize();
        }
      }
      carrier.deckVelAt(ac.pos.x, ac.pos.z, _d);
      (ac.ride || (ac.ride = new THREE.Vector3())).set(_d.x, 0, _d.z);
    } else if (was) {
      // Leaving (off the bow, over the side, or climbing away): the ship's speed is its own again.
      if (!jumped) {
        carrier.deckVelAt(ac.pos.x, ac.pos.z, _d);
        ac.vel.x += _d.x;
        ac.vel.z += _d.z;
      }
      ac._onShip = null;
      ac.ride = null;
    } else if (ac.ride) {
      ac.ride = null;
    }
    way.last.copy(ac.pos);
  }

  // Somebody on foot: carried if they are on the deck, and the solid things on the ship go with it.
  const feet = sim.onFoot || FOOT;
  const foot = feet && feet.active ? feet.walker : null;
  if (foot && moved) {
    if (way.platform.at(foot.x, foot.z) && Math.abs(foot.y - way.platform.y) < 6) {
      carry(foot, old, now, cd, sd);
      if (Number.isFinite(foot.heading)) foot.heading = (foot.heading + dh / D2R + 360) % 360;
    }
    if (WALK && WALK.movedProps && carrier.group && Math.hypot(foot.x - now.x, foot.z - now.z) < way.dims.halfLength + 400) {
      carrier.group.updateMatrixWorld(true);
      WALK.movedProps(carrier.group);
    }
  }

  // Carrier ops: its frame, and whatever it has in hand.
  const ops = sim.carrierOps;
  const st = ops && ops.state;
  if (st && st.f) {
    const f = st.f;
    f.cx = now.x;
    f.cz = now.z;
    f.headingDeg = now.headingDeg;
    f.cos = Math.cos(-hr);
    f.sin = Math.sin(-hr);
    f.landingHeadingDeg = (now.headingDeg - (ops.deck ? ops.deck.TUNE.angleDeg : 9) + 360) % 360;
    if (moved) {
      if (riding && st.hookNow) carry(st.hookNow, old, now, cd, sd);
      const cat = st.cat;
      if (cat) {
        if (cat.start) carry(cat.start, old, now, cd, sd);
        const c = cat.c;
        if (c) {
          if (c.start && c.start !== cat.start) carry(c.start, old, now, cd, sd);
          if (c.end) carry(c.end, old, now, cd, sd);
          if (c.dir) turn(c.dir, cd, sd);
          c.headingDeg = now.headingDeg;
        }
      }
      const A = st.arrest;
      if (A) {
        if (A.start) carry(A.start, old, now, cd, sd);
        if (A.dir) turn(A.dir, cd, sd);
      }
    }
    // Its drawn gear was built where the ship was built: it goes where the ship has gone since.
    const ship = st.gear && st.gear.ship;
    if (ship && carrier.group) {
      if (!ship.userData.inv) {
        ship.userData.inv = new THREE.Matrix4().compose(
          _v.set(way.berth.x, 0, way.berth.z), _q.identity(), new THREE.Vector3(1, 1, 1)
        ).invert();
        ship.matrixAutoUpdate = false;
      }
      carrier.group.updateMatrix();
      ship.matrix.copy(carrier.group.matrix).multiply(ship.userData.inv);
      ship.matrixWorldNeedsUpdate = true;
    }
  }

  // The hatch in the deck (features/secrets.js): the lift, its solid boxes and its marks.
  const hides = sim.secrets && sim.secrets.hideouts;
  if (hides && hides.length) {
    for (let i = 0; i < hides.length; i++) {
      const hd = hides[i];
      if (hd.kind !== 'hatch' || !hd.site) continue;
      const site = hd.site;
      if (moved) {
        carry(site, old, now, cd, sd);
        for (const k of ['door', 'apron', 'from']) if (site[k]) carry(site[k], old, now, cd, sd);
        site.headingDeg = (site.headingDeg + dh / D2R + 360) % 360;
        hd.h = site.headingDeg;
        hd.cos = Math.cos(hd.h * D2R);
        hd.sin = Math.sin(hd.h * D2R);
        // Its boxes are axis-aligned: each goes with its own middle (exact on the straight legs).
        for (const o of hd.obstacles || []) {
          _d.x = (o.x0 + o.x1) / 2;
          _d.z = (o.z0 + o.z1) / 2;
          const hx = (o.x1 - o.x0) / 2;
          const hz = (o.z1 - o.z0) / 2;
          carry(_d, old, now, cd, sd);
          o.x0 = _d.x - hx;
          o.x1 = _d.x + hx;
          o.z0 = _d.z - hz;
          o.z1 = _d.z + hz;
        }
      }
      if (hd.group) {
        way.platform.at(site.x, site.z);
        hd.group.position.set(site.x, way.platform.y + (site.floorY - way.dims.deckY), site.z);
        hd.group.rotation.y = -site.headingDeg * D2R;
      }
      // What stands outside it was placed in the world: it goes where the ship has gone since.
      const out = hd.world;
      if (out) {
        _m.compose(_v.set(now.x, way.heave, now.z), _q.setFromAxisAngle(_up, -hr), _one);
        if (!out.userData.inv) {
          out.userData.inv = new THREE.Matrix4().compose(_v.set(old.x, 0, old.z), _q.setFromAxisAngle(_up, -old.headingDeg * D2R), _one).invert();
          out.matrixAutoUpdate = false;
        }
        out.matrix.copy(_m).multiply(out.userData.inv);
        out.matrixWorldNeedsUpdate = true;
      }
    }
  }

  // The stand-in drawn from far away (features/world-preview.js).
  if (moved && sim.scene) {
    // Looked for by name only now and then: finding it is a walk of the whole scene.
    if (!(way.far && way.far.parent) && (way.farLook = (way.farLook || 0) - 1) < 0) {
      way.farLook = 30;
      way.far = sim.scene.getObjectByName('wp:carrier-far') || null;
    }
    const far = way.far && way.far.parent ? way.far : null;
    if (far && carrier.group) {
      far.position.copy(carrier.group.position);
      far.rotation.copy(carrier.group.rotation);
      far.updateMatrix();
    }
  }
  wake(carrier, way, sim);
}

/** The wake on the sea (world/sea-state.js), if this sea draws one. */
function wake(carrier, way, sim) {
  const sea = sim.ocean && sim.ocean.sea;
  const u = sea && sea.uniforms;
  if (!u || !u.uWake) return;
  const k = way.moving ? clamp(Math.hypot(way.vel.x, way.vel.z) / (UNDERWAY.speedKts * KT), 0, 1) : 0;
  // Eased, so stopping for a wreck does not wipe the wake in a frame.
  way.wakeK = (way.wakeK || 0) + (k - (way.wakeK || 0)) * 0.02;
  const h = way.pose.headingDeg * D2R;
  const dx = Math.sin(h);
  const dz = -Math.cos(h);
  const hl = way.dims.halfLength * 0.94;
  u.uWake.value.set(way.pose.x - dx * hl, way.pose.z - dz * hl, dx, dz);
  u.uWakeShape.value.set(way.wakeK * 0.6, hl * 2, way.dims.halfWidth * 0.78);
}

/** For tests: the ground under the track, sampled. */
export function trackDepths(t, step = 200) {
  const out = [];
  const p = {};
  for (let s = 0; s < t.length; s += step) {
    poseAt(t, s, p);
    out.push(heightAt(p.x, p.z));
  }
  return out;
}
