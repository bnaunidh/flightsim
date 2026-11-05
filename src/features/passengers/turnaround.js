/**
 * The turnaround at the stand, the way you watch it from the chase camera
 * (the owner, 2026-10-16: "a realisitc loading passnegers etc thing (that u
 * can skip)"):
 *
 *   BOARDING   the jet bridge drives out to the front door (or, on a remote
 *              stand, the stair truck comes to it), and the ground crew
 *              drives out from behind the terminal on its own — the stair
 *              truck to the back door, the belt loader with the baggage train
 *              at the hold, the catering truck lifting its box, the fuel
 *              bowser. The passengers come aboard: most through the bridge,
 *              a quarter in a line across the apron from the terminal,
 *              suitcases and all, waiting at the foot of the stairs until the
 *              truck is there, then up them. The counter climbs, the cabin
 *              fills seat by seat; "Boarding complete", the doors shut, the
 *              bridge pulls back, and the pushback is yours (Y).
 *   GETTING OFF  the same backwards: park on a stand after a flight, the
 *              bridge docks, the crew comes out, and they file off — the
 *              bridge, and down the stairs and across to the terminal.
 *   SKIP       at any moment: Y, a tap on the prompt, or the panel's Skip
 *              boarding / Everyone off. Everybody is where they are going at
 *              once, the crew in place, the doors shut, the bridge back. The
 *              setting "Skip the boarding at the gate" does it for you.
 *
 * This file knows the apron (airport-services.js, world/apron.js); the
 * numbers — how long, how fast each door takes them, who is walking where —
 * are boarding.js's, and the people on the apron are drawn by walkers.js.
 * passengers.js owns the stage (gate → boarding → ready, arrived →
 * deplaning → off) and asks this file each frame what has happened.
 */

import * as V from '../../world/airport-vehicles.js';
import { airportLayout, standAt } from '../../world/airport-layout.js';
import { servicesState, crewNow, holdBridgeBack, __airportServices } from '../airport-services.js';
import { PAX } from './state.js';
import { boardSeconds, deplaneSeconds, doorRates, stairsShare, Path3, Stream, walkAround } from './boarding.js';
import { Walkers } from './walkers.js';

const D2R = Math.PI / 180;
/** Seconds after you stop on the stand before the ground crew is sent for. */
const CREW_AFTER = 1.0;
/** How fast the crew drives out (world/apron.js CREW_SPEED), m/s: for when the stair truck gets there. */
const CREW_SPEED = 8;
/** A stand where nothing comes at all: start anyway after this long. */
const GIVE_UP = 22;
/** A stair truck that is not at the door after this long is not coming. */
const STAIRS_GIVE_UP = 50;
/** Furthest walk from the terminal to the stairs, metres; past it they start out on the apron. */
const MAX_WALK = 60;

export const TA = {
  /** '' | 'board' | 'deplane' */
  kind: '',
  t: 0,
  bridged: false,
  dockedT: 0,
  crewAsked: false,
  crewT: 0,
  crewTries: 0,
  noCrew: false,
  rates: null,
  /** The line to the stairs: { stream, salt, lane, foot, opened }, or null. */
  stairs: null,
  /** People of the stairs' share not yet sent down the line. */
  stairsLeft: 0,
  stairsDoor: null,
  walkers: null,
  /** The bridge held back off the door once the doors shut (holdBridgeBack). */
  awayBridge: null,
  held: false,
};

/* ------------------------------------------------------------------ */
/* The apron, read                                                      */
/* ------------------------------------------------------------------ */

function myStand(sim) {
  const ac = sim.aircraft;
  return ac ? standAt(ac.pos.x, ac.pos.z, 3) : null;
}

/**
 * The jet bridge on your door (docked by the airport, or by your crew), or
 * null. Only your stand's: a bridge still on its way back from the last
 * stand you were on is not this one.
 */
export function ourBridge(sim) {
  const list = sim.apron && sim.apron.bridges;
  if (!Array.isArray(list)) return null;
  const st = myStand(sim);
  for (const b of list) if (b && (b.visitor === 'player' || b.visitor === 'spare') && (!st || !b.st || b.st === st)) return b;
  return null;
}

export function bridgeOn(sim) {
  const b = ourBridge(sim);
  return !!(b && b.target === 1 && b.ext > 0.97);
}

/** Is the bridge that was on your door far enough back for the tug? */
export function bridgeClear() {
  const b = TA.awayBridge;
  return !b || b.ext < 0.3 || b.target === 1;
}

/** The spare crew, if it is round you and has a stair truck at a door. */
function stairTruck(sim) {
  const c = sim.apron && sim.apron.spare;
  if (!c || c.light || c.state !== 'working' || !c.poses || !c.poses.stairTruck) return null;
  return c.poses.stairTruck;
}

/** The model's door nearest the stair truck's, on the left. */
function doorNear(sim, z) {
  const md = sim.model && sim.model.userData && sim.model.userData.doors;
  if (!md || !Array.isArray(md.list)) return null;
  let best = null;
  for (const d of md.list) {
    if (d.side !== 'left' || d.deck === 'upper' || d.kind !== 'passenger') continue;
    if (!best || Math.abs(d.z - z) < Math.abs(best.z - z)) best = d;
  }
  return best;
}

function openDoor(sim, d, open) {
  const md = sim.model && sim.model.userData && sim.model.userData.doors;
  if (!md || !d) return;
  try {
    if (open) md.open(d.id);
    else md.close(d.id);
  } catch (e) {
    /* a door is a nicety */
  }
}

/**
 * The walk from the terminal to the top of the stairs: out of the terminal's
 * front, across the apron, round behind the stair truck, up the flight and in
 * at the door. World points, start first. Round the bridge's column and its
 * wheeled leg, never through them.
 */
export function stairsWalk(sim, P) {
  const elev = Number.isFinite(P.y) ? P.y : 0;
  const h = (P.heading || 0) * D2R;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  // Truck-local z (positive is the back of the truck, away from the door) in the world.
  const at = (lz, y) => ({ x: P.x - fx * lz, y, z: P.z - fz * lz });
  const door = at(V.STAIR_FRONT - 0.1, P.sill);
  const top = at(-1.6, P.sill);
  const foot = at(3.1, elev + V.STAIR_BED_Y);
  const ground = at(3.9, elev);
  const behind = at(6.2, elev);
  // Where they come from: the terminal's front, level with the stairs.
  let start = null;
  const lay = airportLayout();
  const F = lay && lay.frame;
  const T = lay && lay.terminal;
  if (F && T && Number.isFinite(T.front) && Number.isFinite(T.u0)) {
    const u = Math.max(T.u0 + 3, Math.min(T.u1 - 3, behind.x - F.cx));
    start = { x: F.x(u), y: elev, z: F.z(T.front - 0.6) };
  }
  if (!start) start = at(6.2 + MAX_WALK * 0.5, elev);
  const far = Math.hypot(start.x - behind.x, start.z - behind.z);
  if (far > MAX_WALK) {
    const k = MAX_WALK / far;
    start = { x: behind.x + (start.x - behind.x) * k, y: elev, z: behind.z + (start.z - behind.z) * k };
  }
  // A corner on the way, level with the stairs and out from them, so they come
  // in square behind the truck rather than cutting across its nose.
  const ac = sim.aircraft;
  const centre = ac ? { x: ac.pos.x, z: ac.pos.z } : null;
  const obstacles = [];
  const b = ourBridge(sim);
  if (b && b.rot) {
    obstacles.push({ x: b.rot.x, z: b.rot.z, r: 1.1 });
    const to = b.dock || null;
    if (to) {
      // Its leg, as poseBridge() puts it: two thirds of the way out.
      const dx = to.x - b.rot.x;
      const dz = to.z - b.rot.z;
      const L = Math.hypot(dx, dz) || 1;
      const sx = b.rot.x + (dx / L) * 2.4;
      const sz = b.rot.z + (dz / L) * 2.4;
      const ex = to.x - (dx / L) * 1.7;
      const ez = to.z - (dz / L) * 1.7;
      obstacles.push({ x: sx + (ex - sx) * 0.68, z: sz + (ez - sz) * 0.68, r: 1.9 });
    }
  }
  const ground2 = walkAround([start, behind], obstacles, centre);
  const pts = [...ground2, ground, foot, top, door];
  // Where the queue waits for stairs that are not there yet: just behind the truck.
  pts.footAt = ground2.length;
  return pts;
}

/* ------------------------------------------------------------------ */
/* The show                                                             */
/* ------------------------------------------------------------------ */

export function resetTurnaround(sim) {
  TA.kind = '';
  TA.t = 0;
  TA.bridged = false;
  TA.dockedT = 0;
  TA.crewAsked = false;
  TA.crewT = 0;
  TA.crewTries = 0;
  TA.noCrew = false;
  TA.rates = null;
  TA.stairs = null;
  TA.stairsLeft = 0;
  TA.stairsDoor = null;
  TA.awayBridge = null;
  TA.held = false;
  if (TA.walkers) TA.walkers.clear();
  if (sim) holdBridgeBack(sim, false);
}

/** Begin boarding or getting off, on the stand you are stopped on. */
export function beginTurnaround(sim, kind) {
  const keepWalkers = TA.walkers;
  resetTurnaround(null);
  TA.walkers = keepWalkers;
  TA.kind = kind;
  const st = myStand(sim);
  TA.bridged = !!(st && st.bridge);
  const s = servicesState().state;
  if (s === 'calling' || s === 'serviced') TA.crewAsked = true;
  if (!sim.apron || !sim.apron.spare) TA.noCrew = true;
  decideRates(sim);
}

/**
 * Send for the ground crew, a moment after you stop — they drive out while
 * the bridge does. The bridge is the airport's to dock to you (a crew sent
 * for re-labels it as theirs, which nothing else here needs), so it is
 * handed back as it was: everything else that watches it sees the same
 * bridge on your door as before.
 */
function askCrew(sim, dt) {
  if (TA.crewAsked || TA.noCrew) return;
  const s = servicesState().state;
  if (s === 'calling' || s === 'serviced' || s === 'pushback') {
    TA.crewAsked = true;
    return;
  }
  TA.crewT += dt;
  if (TA.crewT < CREW_AFTER + TA.crewTries * 1) return;
  TA.crewTries++;
  const before = ourBridge(sim);
  const was = before ? before.visitor : null;
  let ok = false;
  try {
    ok = !!(__airportServices && __airportServices.callCrew(sim));
  } catch (e) {
    ok = false;
  }
  if (ok) {
    TA.crewAsked = true;
    if (before && was === 'player' && before.visitor === 'spare') before.visitor = 'player';
  } else if (TA.crewTries >= 5) TA.noCrew = true;
}

/** Are the doors ready for people: the bridge on, or the stairs at the door, or nothing is coming. */
export function doorsReady(sim) {
  if (TA.bridged) return bridgeOn(sim) || TA.t > GIVE_UP;
  if (stairTruck(sim)) return true;
  // A remote stand with no stair truck coming (no crew here, or an aeroplane too small for one): its own steps.
  const c = sim.apron && sim.apron.spare;
  if (TA.noCrew || (c && c.light && TA.crewAsked)) return TA.t > 2;
  return TA.t > GIVE_UP;
}

/** Seconds until the crew's stair truck is at its door (its own drive), or null. */
function stairsETA(sim) {
  const c = sim.apron && sim.apron.spare;
  if (!c || !Array.isArray(c.moves)) return null;
  if (c.state === 'working') return 0;
  const mv = c.moves.find((m) => m && m.kind === 'stairTruck');
  if (!mv || !mv.path) return null;
  return mv.done ? 0 : Math.max(0, (mv.path.length - mv.d) / CREW_SPEED);
}

/** Boarding: may there be stairs (a crew here, an aeroplane big enough)? */
function stairsPossible(sim) {
  if (TA.noCrew) return false;
  const c = sim.apron && sim.apron.spare;
  if (!c) return false;
  if (c.state === 'arriving' || c.state === 'working') return !c.light && !!(c.poses && c.poses.stairTruck);
  const info = __airportServices && __airportServices.playerInfo ? __airportServices.playerInfo(sim) : null;
  return !!(info && info.halfSpan * 2 >= 18);
}

/**
 * The line to the stairs. Boarding: once the crew has been sent for, from
 * the terminal to where the stair truck is going — already part-way out,
 * as if they set off a little before you looked, so the head of the line
 * reaches the foot of the stairs about when the truck does (and waits there
 * if it is late). Getting off: once the truck is at the door, they come down.
 */
function ensureStairs(sim) {
  if (TA.stairs || !TA.rates || !(TA.rates.stairs > 0) || !(TA.stairsLeft > 0)) return;
  const c = sim.apron && sim.apron.spare;
  let P = null;
  if (TA.kind === 'deplane') P = stairTruck(sim);
  else if (c && !c.light && (c.state === 'arriving' || c.state === 'working') && c.poses) P = c.poses.stairTruck || null;
  if (!P) return;
  const pts = stairsWalk(sim, P);
  if (TA.kind === 'deplane') pts.reverse();
  const path = new Path3(pts);
  const stream = new Stream(path, { rate: TA.rates.stairs });
  const L = { stream, salt: TA.kind === 'deplane' ? 41 : 17, lane: 1, foot: null, opened: false };
  TA.stairs = L;
  TA.stairsDoor = doorNear(sim, P.doorZ);
  if (TA.kind === 'deplane') {
    L.opened = true;
    openDoor(sim, TA.stairsDoor, true);
    return;
  }
  L.foot = path.at[pts.footAt] - 0.3;
  stream.hold = stairTruck(sim) ? null : L.foot;
  const eta = stairsETA(sim);
  const toFoot = L.foot / stream.speed;
  const ahead = Math.max(0, Math.min(toFoot, toFoot - (eta == null ? 20 : eta)));
  if (ahead > 0) stream.prefill(ahead, takeStairs);
}

/** The people still to board, not aboard nor walking. */
function leftToBoard(extra = 0) {
  return Math.max(0, PAX.booked - PAX.aboard - extra - (TA.stairs ? TA.stairs.stream.inTransit : 0));
}
/** One more walker's worth for the stairs, out of their share. */
function takeStairs(n) {
  const k = Math.min(n, TA.stairsLeft, leftToBoard(TA._got || 0));
  if (!(k > 1e-6)) return 0;
  TA.stairsLeft -= k;
  return k;
}

/** The door rates and the stairs' share for this stand. */
export function decideRates(sim) {
  const stairs = TA.kind === 'deplane' ? !TA.noCrew && !!(sim.apron && sim.apron.spare) && !sim.apron.spare.light : stairsPossible(sim);
  const bridge = TA.bridged || !stairs;
  const booked = TA.kind === 'deplane' ? Math.ceil(PAX.aboard) : PAX.booked;
  const seconds = TA.kind === 'deplane' ? deplaneSeconds(booked) : boardSeconds(booked);
  TA.rates = doorRates(booked, { bridge, stairs, seconds });
  TA.stairsLeft = stairsShare(booked, { bridge, stairs });
  return TA.rates;
}

/** The stairs are not coming after all: their share goes by the front door. */
function noStairs() {
  if (TA.stairs) TA.stairs.stream.clear();
  TA.stairs = null;
  TA.stairsLeft = 0;
  if (TA.rates) {
    TA.rates.bridge = Math.max(TA.rates.bridge, TA.rates.stairs);
    TA.rates.stairs = 0;
  }
}

/**
 * One frame of boarding: how many came aboard. `boarding` is false while the
 * stage is still waiting for its doors (the people walking to the stairs
 * may already be on their way).
 */
export function stepBoarding(sim, dt, boarding) {
  TA.t += dt;
  if (TA.bridged && bridgeOn(sim)) TA.dockedT += dt;
  askCrew(sim, dt);
  if (!TA.rates) decideRates(sim);
  // No stairs after all (no crew came, the truck never got there): the front door.
  if (TA.stairsLeft > 0 || TA.stairs) {
    const late = TA.t > STAIRS_GIVE_UP && !stairTruck(sim);
    if (TA.noCrew || late || (TA.crewAsked && !stairsPossible(sim))) noStairs();
  }
  TA._got = 0;
  ensureStairs(sim);
  const L = TA.stairs;
  let got = 0;
  if (L) {
    // Up the stairs once they are at the door; until then a queue at the foot.
    const there = !!stairTruck(sim);
    L.stream.hold = there ? null : L.foot;
    if (there && !L.opened) {
      L.opened = true;
      openDoor(sim, TA.stairsDoor, true);
    }
    got += L.stream.move(dt);
  }
  TA._got = got;
  // The front door takes all but the stairs' share.
  const bridgeRate = TA.rates.bridge;
  if (boarding && bridgeRate > 0 && (!TA.bridged || bridgeOn(sim) || TA.t > GIVE_UP)) {
    const k = Math.min(Math.max(0, leftToBoard(got) - TA.stairsLeft), bridgeRate * dt);
    got += k;
    TA._got = got;
  }
  if (L) L.stream.spawn(dt, takeStairs);
  TA._got = 0;
  return got;
}

/** One frame of getting off: how many left the cabin. */
export function stepDeplaning(sim, dt, deplaning) {
  TA.t += dt;
  if (TA.bridged && bridgeOn(sim)) TA.dockedT += dt;
  askCrew(sim, dt);
  if (!TA.rates) decideRates(sim);
  if (deplaning && TA.stairsLeft > 0 && !TA.stairs && (TA.noCrew || TA.t > STAIRS_GIVE_UP)) noStairs();
  if (deplaning) ensureStairs(sim);
  let off = 0;
  const L = TA.stairs;
  if (L) {
    // They keep walking to the terminal after the cabin is empty.
    L.stream.step(dt, (n) => {
      if (!deplaning) return 0;
      const k = Math.min(n, TA.stairsLeft, Math.max(0, PAX.aboard - off));
      if (!(k > 1e-6)) return 0;
      TA.stairsLeft -= k;
      off += k;
      return k;
    });
  }
  if (!deplaning) return off;
  if (TA.rates.bridge > 0 && (!TA.bridged || bridgeOn(sim) || TA.t > GIVE_UP)) {
    // The bridge leaves the stairs their share while the stairs are still coming.
    off += Math.min(Math.max(0, PAX.aboard - off - TA.stairsLeft), TA.rates.bridge * dt);
  }
  return off;
}

/** The doors are shut: the bridge pulls back off the door. */
export function pullBridgeAway(sim, instant = false) {
  TA.held = true;
  const mine = ourBridge(sim);
  const b = holdBridgeBack(sim, true, instant) && mine;
  if (b) TA.awayBridge = b;
  else if (instant && TA.awayBridge) {
    TA.awayBridge.ext = 0;
    TA.awayBridge.dirty = true;
  }
  return b;
}

/** Keep it back while you are still on the stand (a crew called after the doors shut docks it again). */
export function keepBridgeAway(sim) {
  if (!TA.held) return;
  const b = ourBridge(sim);
  if (b && servicesState().state !== 'pushback') pullBridgeAway(sim);
}

/**
 * Everybody where they are going, now. Boarding: the crew round the
 * aeroplane (sent for first if nobody had), the bridge back against the
 * terminal. Getting off: nobody on the apron.
 */
export function skipTurnaround(sim) {
  if (TA.stairs) TA.stairs.stream.clear();
  TA.stairsLeft = 0;
  if (TA.walkers) TA.walkers.clear();
  if (TA.kind === 'board') {
    const s = servicesState().state;
    if (!TA.noCrew && (s === 'idle' || s === 'onStand')) {
      try {
        if (__airportServices && __airportServices.callCrew(sim)) TA.crewAsked = true;
      } catch (e) {
        /* no crew: the pushback is still there to ask for */
      }
    }
    try {
      crewNow(sim);
    } catch (e) {
      /* the crew is a nicety */
    }
    pullBridgeAway(sim, true);
  }
  openDoor(sim, TA.stairsDoor, false);
}

/** Shut the stairs door (boarding complete, or everyone off). */
export function closeStairsDoor(sim) {
  openDoor(sim, TA.stairsDoor, false);
}

/** The people on the apron, drawn (after everything has moved this frame). */
export function drawWalkers(sim) {
  const S = TA.stairs;
  if (!S || !S.stream.list.length) {
    if (TA.walkers && TA.walkers.shown) TA.walkers.clear();
    return 0;
  }
  if (!TA.walkers) TA.walkers = new Walkers(sim.scene);
  if (TA.walkers.root.parent !== sim.scene) sim.scene.add(TA.walkers.root);
  return TA.walkers.draw([S], sim.camera ? sim.camera.position : null);
}

export function disposeWalkers() {
  if (TA.walkers) TA.walkers.dispose();
  TA.walkers = null;
}
