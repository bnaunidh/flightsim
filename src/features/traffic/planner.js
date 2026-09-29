/**
 * Flight plans for the AI traffic.
 *
 * One aeroplane's day is a chain of legs, each a Path it is moved along:
 *
 *   pushback   tail first out of a nose-in slot, swung to face along the
 *              apron or the taxiway (a nose-out hangar has none: it taxis out)
 *   taxi-out   to the holding point, where it stops and waits to be cleared
 *   lineup     on to the runway (backtracking to the end if it needs the length)
 *   takeoff    the roll, rotation, lift-off and a straight climb-out
 *   route      a circuit, or a tour of the islands, ending at the arrival gate
 *   orbit      a 360 at the gate, if the runway is not free yet
 *   approach   base, final, the flare, the roll-out and off at an exit
 *   taxi-in    back to its slot, nose in — or just past a nose-out hangar
 *   push-in    and then pushed back into it, tail first
 *   go-around  from anywhere on final, back round to the gate
 *
 * Speeds come from the aeroplane's own aerodynamics via performanceFor(), so
 * an airliner is visibly faster on the approach and longer on the roll than a
 * trainer without anyone typing a number for it.
 *
 * Pure planning: no Three, no scene. The node test calls these for every map.
 */

import { heightAt, MAP, ISLANDS } from '../../world/terrain.js';
import { AIRCRAFT, performanceFor, specFor } from '../../aircraft/types.js';
import { Draft, DEG, verticalProfile, headingOf, wrapPi } from './path.js';
import {
  groundY,
  groundPathProblem,
  runwayFor,
  pushbackDraft,
  taxiOutDraft,
  lineupDraft,
  taxiInDraft,
  uTurn,
  uTurnWidth,
  UTURN_BLEND,
  holdPoint,
  alongR2,
  r2HoldBack,
} from './field.js';
import { isOnRunway2 } from '../../world/terrain.js';

const KT = 0.514444;
const G = 9.81;

/* ------------------------------------------------------------------ */
/* Performance                                                         */
/* ------------------------------------------------------------------ */

/** light | airliner | military | helicopter | special — from the roster, or worked out. */
export function categoryOf(type) {
  if (!type) return 'special';
  if (type.category) return type.category;
  const power = type.shape && type.shape.power;
  const cls = String(type.class || '').toLowerCase();
  if ((power && power.rotor) || cls === 'helicopter') return 'helicopter';
  if (cls === 'airliner') return 'airliner';
  if (cls === 'fighter' || cls === 'carrier' || type.military) return 'military';
  return 'light';
}

/**
 * The numbers the traffic is flown by, from the type's own aerodynamics.
 *
 * Rotate at 1.08 × the clean stall, approach at 1.3 × the landing stall and
 * touch down at 1.12 × — the textbook margins. Everything else (how hard it
 * accelerates, how steeply it climbs, how high it flies the circuit) is by
 * category, because that is what differs between a trainer and a jet in a way
 * you can see from the ground.
 */
export function perfFor(type) {
  const cat = categoryOf(type);
  let p = null;
  try {
    p = performanceFor(type.id);
  } catch (e) {
    p = null;
  }
  let vsC = p && Number.isFinite(p.stallClean) ? p.stallClean * KT : 30;
  let vsL = p && Number.isFinite(p.stallLanding) ? p.stallLanding * KT : vsC * 0.85;
  // A new type whose numbers come out absurd still gets something flyable.
  if (!(vsC > 12 && vsC < 110)) vsC = cat === 'light' ? 26 : 50;
  if (!(vsL > 10 && vsL <= vsC)) vsL = vsC * 0.85;
  const vne = p && Number.isFinite(p.vne) && p.vne > 0 ? p.vne * KT : vsC * 3.5;
  const heavy = !!type.longHaul;
  const S = type.shape || {};
  const scale = S.scale || 1;
  const span = ((S.wingRootX || 0.62) + (S.halfSpan || 5.5)) * scale * 2;
  const length = (2.6 + 3.95) * (S.bodyLength || 1) * scale;
  /*
   * Where its nose and tail are as DRAWN, ahead of and behind the middle.
   * A roster entry with `plan` (the airliners and fighters, and the two
   * light types with their own models) says so; the shape cannot — its
   * numbers put a 747's nose and tail 21.8 m either side of the middle, and
   * the drawn one's are 31.1 m ahead and 39.5 m behind (the review, from the
   * model). Where known, these are what the ground checks and the queues go
   * by; `length` stays the shape's, which the ground routes are sized by.
   * Without a plan, half the shape's length each way, as before.
   */
  const P = type.plan;
  const plan = P && Number.isFinite(P.nose) && Number.isFinite(P.tail) && P.tail > P.nose ? P : null;
  const noseLen = plan ? Math.max(0, -plan.nose) : length / 2;
  const tailLen = plan ? Math.max(0, plan.tail) : length / 2;

  const vr = vsC * 1.08;
  const v2 = vsC * 1.22;
  const vapp = vsL * 1.3;
  const vtd = vsL * 1.12;
  const cruiseMul = cat === 'light' ? 1.75 : cat === 'airliner' ? 2.05 : 2.3;
  const cruise = Math.max(v2 * 1.1, Math.min(vne * 0.6, vsC * cruiseMul));
  const vGate = Math.max(vapp * 1.18, vapp + 5);
  const vCircuit = Math.min(cruise, Math.max(v2 * 1.15, vapp * 1.45));
  const accel = cat === 'military' ? 5 : cat === 'airliner' ? (heavy ? 1.9 : 2.4) : 2.3;
  const decel = cat === 'military' ? 3 : cat === 'airliner' ? 2.3 : 2.1;
  const bankDeg = cat === 'military' ? 35 : 25;
  const turnR = (v) => (v * v) / (G * Math.tan(bankDeg * DEG));
  const roll = (vr * vr) / (2 * accel);

  // Ground contact from the flight model's own gear points, so the traffic's
  // wheels touch where the player's would.
  let gear = { noseY: -1.42 * scale, noseZ: -1.15 * scale, mainY: -1.5 * scale, mainZ: 0.42 * scale };
  try {
    const spec = specFor(type.id);
    const nose = spec.gearPoints.find((g) => g.name === 'nose');
    const main = spec.gearPoints.find((g) => g.name === 'left') || spec.gearPoints[1];
    if (nose && main) gear = { noseY: nose.pos.y, noseZ: nose.pos.z, mainY: main.pos.y, mainZ: main.pos.z };
  } catch (e) {
    /* keep the trainer's, scaled */
  }
  // The attitude it sits at with both wheels on the ground (nose-down a touch
  // on a trainer, whose nose leg is shorter).
  const groundPitch = Math.atan2(gear.noseY - gear.mainY, gear.mainZ - gear.noseZ);

  return {
    cat,
    heavy,
    id: type.id,
    span,
    length,
    noseLen,
    tailLen,
    drawnPlan: !!plan,
    vr,
    v2,
    vapp,
    vtd,
    cruise,
    vGate,
    vCircuit,
    accel,
    decel,
    taxi: length > 40 ? 9 : 7,
    bankMax: bankDeg * DEG,
    turnR,
    rApp: turnR(vGate),
    gradClimb: cat === 'military' ? 0.14 : cat === 'airliner' ? (heavy ? 0.06 : 0.075) : 0.09,
    gradDesc: 0.065,
    // Four degrees for the light aircraft, which is what they fly into short
    // strips; three for everything else.
    tanGS: cat === 'light' ? Math.tan(4 * DEG) : Math.tan(3 * DEG),
    flareH: cat === 'light' ? 5 : cat === 'military' ? 7 : heavy ? 12 : 9,
    // Level on final for this long before the glideslope, so the turn on to
    // final is finished before the descent starts.
    establish: cat === 'light' ? 350 : cat === 'military' ? 700 : heavy ? 1300 : 900,
    baseLeg: cat === 'light' ? 400 : cat === 'military' ? 700 : 800,
    upwind: cat === 'light' ? 800 : cat === 'military' ? 1600 : 2200,
    /*
     * Circuit height above the field; each aeroplane adds its own layer on
     * top. Kept low on purpose: the first cut flew light aircraft at 240 m and
     * spent three and a half minutes on a straight-in final, which from the
     * apron is a speck that never arrives. At 180 m, descending on the base
     * leg, a trainer is on the ground about ninety seconds after turning base.
     */
    layerAGL: cat === 'light' ? 180 : cat === 'military' ? 330 : heavy ? 480 : 380,
    layerStep: cat === 'light' ? 45 : 80,
    cruiseAGL: cat === 'light' ? 420 : cat === 'military' ? 900 : heavy ? 1500 : 1100,
    clearance: cat === 'light' ? 140 : 260,
    alphaApp: cat === 'light' ? 5 * DEG : 4 * DEG,
    roll,
    toraNeed: roll * 1.25 + vr * 2 + 120,
    rollout: (vtd * vtd) / (2 * decel),
    gear,
    groundPitch,
  };
}

/*
 * Who flies where. Ids that are not in the roster are simply skipped, so the
 * new airliners and fighters join the traffic the day they land in
 * src/aircraft/extra/ and not before.
 */
const WANT = {
  // Ironhead is an air base: fast jets and the things that support them.
  military: ['f22', 'fa18', 'f35b', 'vanguard', 'osprey', 'massimo', 'nightjar', 'tempest'],
  // Three-kilometre runways: the airliners, with the odd light aeroplane.
  big: ['a320', 'b747', 'a380', 'meridian', 'tempest', 'courier'],
  // Eleven hundred metres and less: trainers, tourers and the small airliner.
  small: ['skylark', 'courier', 'tempest', 'meridian'],
};

/** The aeroplanes that make sense at this field, in order of preference. */
export function typesFor(field) {
  const mil = !!(field.military || (MAP && (MAP.id === 'airbase' || MAP.military)));
  const want = mil ? WANT.military : field.length >= 2400 ? WANT.big : WANT.small;
  const out = [];
  for (const id of want) {
    const t = AIRCRAFT.find((a) => a.id === id);
    if (!t) continue;
    const cat = categoryOf(t);
    if (cat === 'helicopter' || cat === 'special') continue;
    const perf = perfFor(t);
    // A first cut; the planner checks the real lift-off point.
    if (perf.toraNeed > field.length * 0.9) continue;
    if (!field.slots.some((s) => fits(s, perf))) continue;
    out.push(t);
  }
  return out;
}

/** Does this aeroplane fit this parking slot? */
export function fits(slot, perf) {
  return slot.maxSpan >= perf.span && !(slot.maxLength < perf.length);
}

/* ------------------------------------------------------------------ */
/* Legs                                                                */
/* ------------------------------------------------------------------ */

/** Heights on the ground at every point, and the ground flag. */
function groundify(path) {
  for (let i = 0; i < path.n; i++) {
    path.y[i] = groundY(path.x[i], path.z[i]);
    path.ground[i] = 1;
  }
  return path;
}

function leg(kind, path, extra = {}) {
  return { kind, path, reverse: false, needs: null, ...extra };
}

/**
 * How fast a tug moves this aeroplane, m/s. Out of a hangar it is a tow of a
 * hundred metres or more, and the first cut's 2.4 m/s made the stock hangar's
 * 116 m take 48 s — which from the apron is an aeroplane that looks stuck.
 */
function tugSpeed(slot) {
  return slot && slot.kind === 'hangar' ? 3.4 : 2.0;
}

/**
 * Leave the slot and get to the holding point. From a nose-in slot that is a
 * pushback and then the taxi; from a nose-out one (a hangar it was pushed
 * into tail first) it taxis straight out. Returns legs, the last of which
 * stops at the hold.
 */
export function planTaxiOut(field, perf, slot, dir, connector = null) {
  const rw = runwayFor(field, dir);
  const cx = connector == null ? rw.depConnector : connector;
  const legs = [];
  let from = { x: slot.x, z: slot.z };
  // Towards its holding point (on the taxiway, for the crosswind runway's).
  const hx = holdPoint(field, cx, perf).x;
  const noseDir = hx < slot.x ? -1 : 1;
  if (slot.nose !== 'out') {
    const pb = pushbackDraft(field, slot, perf, hx).finish();
    groundify(pb);
    pb.setSpeeds(() => tugSpeed(slot), { v0: 0, vEnd: 0, accel: 0.4, decel: 0.5, latAccel: 0.6 });
    from = { x: pb.x[pb.n - 1], z: pb.z[pb.n - 1] };
    legs.push(leg('pushback', pb, { reverse: true, phase: slot.kind === 'hangar' ? 'towed out of the hangar' : 'pushing back', pauseBefore: 2 }));
  }
  const to = taxiOutDraft(field, perf, from, noseDir, cx).finish();
  groundify(to);
  to.setSpeeds(() => perf.taxi, { v0: 0, vEnd: 0, accel: 0.8, decel: 1.0, latAccel: 1.5 });
  legs.push(leg('taxi-out', to, { phase: 'taxiing out', holdAtEnd: true, connector: cx }));
  return legs;
}

/**
 * On to the runway and away: lineup + takeoff. Needs a departure clearance
 * before it starts. Returns { legs, ok, why } — `ok` false when this
 * aeroplane cannot get off this runway in the length there is.
 */
export function planDeparture(field, perf, dir, connector = null) {
  const rw = runwayFor(field, dir);
  const cx = connector == null ? rw.depConnector : connector;
  const lu = lineupDraft(field, rw, perf, cx);
  const lp = lu.draft.finish();
  groundify(lp);
  lp.setSpeeds(() => Math.min(perf.taxi, 6), { v0: 0, vEnd: 0, accel: 0.7, decel: 1.0, latAccel: 1.4 });
  const x0 = lp.x[lp.n - 1];

  // The roll and the climb-out, on the centreline and straight on.
  const upX = rw.farEnd + rw.dir * perf.upwind;
  const d = new Draft(x0, field.cz);
  d.line(upX, field.cz, 12);
  const tk = d.finish();
  // Heights first on the ground so the speed profile knows where it is.
  for (let i = 0; i < tk.n; i++) tk.ground[i] = 1;
  const vClimb = perf.v2 * 1.12;
  tk.setSpeeds(() => vClimb, { v0: 0, accel: perf.accel, decel: 1, groundOnlyLat: true });
  // Rotate at Vr, lift off a second and a half later.
  let iRot = tk.n - 1;
  for (let i = 0; i < tk.n; i++) {
    if (tk.vmax[i] >= perf.vr) {
      iRot = i;
      break;
    }
  }
  const sRot = tk.s[iRot];
  const sLift = sRot + perf.vr * 1.5;
  const gLift = groundY(field.cx, field.cz);
  const Ltr = 150;
  const grad = climbGradient(field, perf, dir, x0 + rw.dir * sLift, tk.length - sLift);
  for (let i = 0; i < tk.n; i++) {
    const s = tk.s[i];
    if (s <= sLift) {
      tk.y[i] = groundY(tk.x[i], tk.z[i]);
      tk.ground[i] = 1;
    } else {
      const u = s - sLift;
      const climb = u < Ltr ? (grad * u * u) / (2 * Ltr) : grad * (u - Ltr / 2);
      tk.y[i] = gLift + climb;
      tk.ground[i] = 0;
    }
  }
  const xLift = x0 + rw.dir * sLift;
  const margin = (rw.farEnd - xLift) * rw.dir;
  const ok = margin > 80;
  // The runway is given back once the aeroplane is well up and past the end.
  const sEnd = Math.abs(rw.farEnd - x0);
  const sRelease = Math.max(sLift + 400, sEnd + 150);
  return {
    ok,
    why: ok ? null : `lifts off ${Math.round(-margin)} m past the end of runway ${rw.name}`,
    tora: lu.tora,
    backtrack: lu.backtrack,
    legs: [
      leg('lineup', lp, { phase: 'lining up', needs: 'departure', holdAtEnd: false, lockRunway: true }),
      leg('takeoff', tk, { phase: 'taking off', sRot, sLift, sRelease, releaseRunway: true }),
    ],
    end: { x: upX, z: field.cz, y: tk.y[tk.n - 1], hdg: rw.heading, v: vClimb },
    connector: cx,
  };
}

/**
 * Where an arrival is handed from its route to the approach: the gate.
 *
 * side +1 is south of the runway, -1 north, 0 straight in along the extended
 * centreline. `layer` is this aeroplane's height above the field, so two
 * aeroplanes waiting at once are at different heights and different gates.
 */
export function arrivalGeometry(field, perf, dir, side, layer) {
  const rw = runwayFor(field, dir);
  const gs = glidePath(field, perf, dir);
  const tan = gs.tan;
  const dF = (2 * perf.flareH) / tan;
  const A = gs.aim;
  const TD = A + (rw.dir * dF) / 2;
  const yGround = groundY(A, field.cz);
  const yGate = field.elev + layer + gs.raise;
  const R = perf.rApp;
  // It starts down on the base leg, so it is lower by the time it is on
  // final: the gate-to-final distance at the descent gradient.
  const hFaf = Math.max(40, yGate - yGround - perf.gradDesc * baseToFinal(perf, side));
  const yFaf = yGround + hFaf;
  const dIntercept = hFaf / tan + dF / 2;
  const faf = A - rw.dir * (dIntercept + perf.establish);
  let gate;
  if (!side) {
    gate = { x: faf - rw.dir * (perf.baseLeg + R), z: field.cz, hdg: rw.heading };
  } else {
    gate = { x: faf - rw.dir * R, z: field.cz + side * (R + perf.baseLeg), hdg: headingOf(0, -side) };
  }
  // Where a circuit's downwind leg starts, abeam the upwind end. A straight-in
  // arrival has no downwind: the route goes to the gate directly.
  const dw = side
    ? { x: rw.farEnd, z: field.cz + side * (2 * R + perf.baseLeg), hdg: rw.heading + Math.PI }
    : null;
  return { rw, dir, side, A, TD, dF, faf, gate, dw, yGate, yFaf, yGround, R, tan, steep: gs.steep };
}

/** Flown distance from the gate to the start of the final straight. */
function baseToFinal(perf, side) {
  return side ? perf.baseLeg + (Math.PI / 2) * perf.rApp : perf.baseLeg + perf.rApp;
}

/**
 * The glideslope for this runway end: where to aim, and how steep.
 *
 * The approach corridor terrain.js cuts is held to a slope of 0.12 — about
 * seven degrees — so it guarantees the ground stays under THAT, not under a
 * three-degree glideslope. Measured: on Harrier Flats the ground 800 m short of
 * runway 09 stands 57 m above the field, and a 3.5 degree approach aimed at the
 * usual touchdown point went through the hill by 7 m. So the ground under the
 * final is read, and the aiming point is moved in (up to 400 m, runway
 * permitting) and the slope steepened until every point on it has 15 m plus
 * one per cent of the distance to spare — which is how real approaches over
 * high ground are built; London City's is five and a half degrees. Cached on
 * the field: it depends on the runway end and the kind of aeroplane, not on
 * which one is flying it.
 */
export function glidePath(field, perf, dir) {
  // Per type: the turn radius sets how far it descends on base, and the roll-out how deep it may aim.
  const key = `${perf.id}:${dir}`;
  field._glide = field._glide || {};
  if (field._glide[key]) return field._glide[key];
  const rw = runwayFor(field, dir);
  const base = perf.tanGS;
  const yGround = groundY(rw.aim, field.cz);
  const dF = (2 * perf.flareH) / base;
  // What the approach needs above the field at distance d from the aiming
  // point: the ground, plus 15 m and one per cent of the distance — but never
  // more margin than half the height the usual glideslope has there, or the
  // flat ground just short of the threshold would demand a cliff dive.
  const needAt = (A, d) =>
    Math.max(heightAt(A - rw.dir * d, field.cz), 0) - yGround + Math.min(15 + 0.01 * d, 0.5 * base * (d - dF / 2));
  let best = null;
  /*
   * Measured: Aurora Fjord and Ember Isle both have a ridge 65-90 m high
   * 300-600 m off each end of the runway, then open sea. Aimed 200 m in, that
   * needs an eight-degree approach; aimed 500 m in, under seven — and a
   * trainer still stops with half the runway left. So the aiming point may
   * move in as far as this aeroplane's roll-out allows.
   */
  /*
   * The steepest approach that still looks like an approach and not a dive.
   * The first cut took whichever aiming point gave the shallowest slope, by
   * any margin at all, and on Kestrel that put every light aeroplane's wheels
   * down at x = 19 — the middle of the runway, crossing the threshold 38 m up
   * — to save going from 4.1 to 5.3 degrees. Measured from the tower that
   * reads as a floaty landing by somebody who misjudged it. So the usual
   * aiming point is kept unless the slope there would pass this.
   */
  const comfy = Math.tan((perf.cat === 'light' ? 6 : perf.cat === 'military' ? 5.5 : 5) * DEG);
  let first = null;
  for (const aimIn of [200, 300, 400, 500, 600]) {
    if (aimIn > 200 && aimIn + dF / 2 + perf.rollout + 180 > field.length) break;
    const A = rw.approachEnd + rw.dir * aimIn;
    /*
     * The lowest gate height that clears the ground under the level part of
     * the final. Beyond the glideslope intercept the aeroplane is level, so
     * ground out there is a reason to come in higher, not steeper; raising the
     * gate moves the intercept further out, so it settles in a few rounds.
     */
    // The level part of the final is lower than the gate by the base-leg
    // descent (taken for a base leg with its quarter turn, the longest).
    const drop = perf.gradDesc * baseToFinal(perf, 1);
    let H = perf.layerAGL;
    let reach = 0;
    let level = H;
    for (let round = 0; round < 6; round++) {
      level = Math.max(40, H - drop);
      reach = level / base + dF / 2 + perf.establish + 400;
      let hmax = 0;
      for (let d = dF / 2 + 20; d < reach; d += 25) hmax = Math.max(hmax, needAt(A, d));
      if (hmax <= level - 5) break;
      H += hmax - level + 20;
    }
    // Then the slope: steep enough that every point clears — up to the level,
    // which is as high as the final goes.
    let need = base;
    for (let d = dF / 2 + 20; d < reach; d += 25) {
      const h = Math.min(needAt(A, d), level);
      if (h <= 0) continue;
      need = Math.max(need, h / (d - dF / 2));
    }
    const cand = { aimIn, need, A, H };
    if (!first) first = cand;
    // The nearest aiming point whose slope is not a dive, and otherwise the
    // one that saves real steepness.
    if (need <= comfy) {
      best = cand;
      break;
    }
    if (!best || need < best.need - 0.006) best = cand;
  }
  const out = {
    aim: best.A,
    aimIn: best.aimIn,
    // What the usual aiming point would have needed, so a test can tell a
    // move forced by the ground from one that was not.
    need200: first ? first.need : best.need,
    comfy,
    tan: Math.min(best.need, 0.13),
    steep: best.need > 0.13,
    // How much higher than usual this runway's gates have to be.
    raise: Math.max(0, best.H - perf.layerAGL),
  };
  field._glide[key] = out;
  return out;
}

/**
 * How steeply to climb out: the aeroplane's own gradient, or steeper if the
 * ground beyond the runway end rises faster — the same idea as the approach.
 */
export function climbGradient(field, perf, dir, xLift, distance) {
  const key = `c${dir}:${perf.gradClimb}:${Math.round(xLift)}:${Math.round(distance)}`;
  field._glide = field._glide || {};
  if (field._glide[key] != null) return field._glide[key];
  const rw = runwayFor(field, dir);
  const gLift = groundY(field.cx, field.cz);
  let need = perf.gradClimb;
  for (let u = 200; u < distance; u += 50) {
    const g = Math.max(heightAt(xLift + rw.dir * u, field.cz), 0) - gLift;
    /*
     * Only ground that stands above the field is something to climb over.
     * The first cut asked for 25 m over EVERY point, the runway included, and
     * 200 m after lift-off that is a gradient of 0.23 — so every departure on
     * every map went up at the cap: a Skylark at 0.2, twice its real climb,
     * standing on its tail. Measured on Kestrel 09 a Skylark now climbs at
     * its own 0.09 and passes 55 m over the rise beyond the far end.
     */
    if (g <= 3) continue;
    const margin = 25 + 0.02 * u;
    need = Math.max(need, (g + margin) / (u - 75));
  }
  const out = Math.min(need, perf.cat === 'military' ? 0.3 : 0.2);
  field._glide[key] = out;
  return out;
}

/** Heights along an approach: level at the gate height until the glideslope, then down it and flare. */
function glideHeight(geo, dToTD) {
  const d = Math.max(0, dToTD);
  const tan = geo.tan;
  const g = d < geo.dF ? (tan * d * d) / (2 * geo.dF) : tan * (d - geo.dF / 2);
  return Math.min(geo.yGate, geo.yGround + g);
}

/**
 * From the gate to a stop at an exit's holding point: base, final, flare,
 * touchdown, roll-out, and off. Returns { legs, ok, why, exit }.
 */
export function planApproach(field, perf, geo, opts = null) {
  const rw = geo.rw;
  const cz = field.cz;
  const d = new Draft(geo.gate.x, geo.gate.z);
  d.dubins(geo.gate.hdg, geo.faf, cz, rw.heading, geo.R, 40);
  d.line(geo.TD, cz, 20);
  const iTD = d.n - 1;
  // `opts` was once just the connector to keep clear of; it still may be.
  const o = opts == null ? {} : typeof opts === 'number' ? { avoid: opts } : opts;
  const ex = exitPlan(field, rw, perf, geo.TD, o);
  if (!ex.ok) return { ok: false, why: ex.why, legs: [] };
  appendExit(d, field, rw, perf, geo.TD, ex);
  const p = d.finish();
  const sTD = p.s[iTD];
  for (let i = 0; i < p.n; i++) {
    const s = p.s[i];
    if (s < sTD) {
      // Down from the gate at the descent gradient to the final's level,
      // level until the glideslope, then down it.
      const lvl = Math.max(geo.yGate - perf.gradDesc * s, geo.yFaf);
      p.y[i] = Math.min(lvl, glideHeight(geo, sTD - s));
      p.ground[i] = 0;
    } else {
      p.y[i] = groundY(p.x[i], p.z[i]);
      p.ground[i] = 1;
    }
  }
  // Speeds: gate speed on the base leg, approach speed from well before the
  // glideslope, touchdown speed by the wheels, then the braking curve.
  const sFaf = Math.max(0, sTD - (geo.faf - geo.TD) * -rw.dir);
  const vtd = perf.vtd;
  const dec = perf.decel;
  p.setSpeeds(
    (i) => {
      const s = p.s[i];
      if (s < sFaf - 800) return perf.vGate;
      if (s < sTD - geo.dF) return perf.vapp;
      if (s <= sTD) return vtd + (perf.vapp - vtd) * ((sTD - s) / geo.dF);
      return Math.max(perf.taxi, Math.sqrt(Math.max(0, vtd * vtd - 2 * dec * (s - sTD))));
    },
    {
      v0: perf.vGate,
      vEnd: perf.taxi * 0.8,
      accel: 1.0,
      // Wheel brakes once it is down; only drag before that.
      decel: (i) => (p.ground[i + 1] ? dec : 0.9),
      latAccel: 1.6,
    }
  );
  const vAtTD = p.vmax[p.indexAt(sTD)];
  const ok = vAtTD >= vtd * 0.9;
  return {
    ok,
    why: ok ? null : `cannot stop for exit ${ex.x} after touching down on ${rw.name}`,
    exit: ex.x,
    sTD,
    legs: [
      leg('approach', p, {
        phase: 'on approach',
        needs: 'approach',
        sTD,
        sLock: Math.max(0, sTD - 1500),
        sGoAroundBy: sTD - 30,
        releaseRunway: true,
        sRelease: p.length - 1,
        exit: ex.x,
      }),
    ],
  };
}

/**
 * Which exit, and whether the roll-out reaches it or has to turn round and
 * come back. `avoid` is the departure connector, used only if nothing else is.
 */
export function exitPlan(field, rw, perf, xTD, opts = {}) {
  /*
   * opts.allow(x)  exits it may use at all — the ones whose way back to its
   *                slot its wings clear, and nobody is waiting at
   * opts.avoid     an exit (or a test of one) to use only if nothing else will do
   * opts.limitX    somewhere it must not roll past — the player, sat on the
   *                runway ahead. The first cut drove on towards the exit
   *                beyond them and waited behind them for ever; now it turns
   *                round short of them instead.
   * opts.turnFrom  somewhere it must be past before it turns round, if it
   *                has to — the far side of a runway crossing, rather than
   *                a turn round in the middle of the other runway
   */
  const { allow = null, avoid = null, limitX = null, turnFrom = null } = opts || {};
  const avoided = typeof avoid === 'function' ? avoid : (x) => x === avoid;
  const rEx = Math.min(field.halfWidth + 6, 20);
  const vEx = Math.max(perf.taxi, 8);
  const dSlow = (perf.vtd * perf.vtd - vEx * vEx) / (2 * perf.decel);
  const xSlow = xTD + rw.dir * (dSlow + rEx + 10);
  const before = (x) => limitX == null || (limitX - x) * rw.dir > 40;
  const usable = (x) => !allow || allow(x);
  const ahead = rw.exits.filter((x) => (x - xSlow) * rw.dir >= 0 && before(x) && usable(x)).sort((a, b) => (a - b) * rw.dir);
  const pick = (list) => list.find((x) => !avoided(x)) ?? list[0];
  if (ahead.length) return { ok: true, x: pick(ahead), backtrack: false, rEx };
  // Stop, turn round, come back.
  const w = uTurnWidth(field);
  const dStop = (perf.vtd * perf.vtd) / (2 * perf.decel);
  let xStop = xTD + rw.dir * (dStop + 20);
  if (turnFrom != null && (turnFrom - xStop) * rw.dir > 0) xStop = turnFrom;
  const end = limitX == null ? rw.farEnd : limitX - rw.dir * 40;
  const room = (end - xStop) * rw.dir;
  if (room < UTURN_BLEND + w + 8) return { ok: false, why: `stops ${Math.round(room)} m from the end of ${rw.name}, with no exit ahead and no room to turn round` };
  const behind = rw.exits.filter((x) => (xStop - x) * rw.dir >= rEx + 10 && usable(x)).sort((a, b) => (b - a) * rw.dir);
  if (!behind.length) return { ok: false, why: allow ? 'no exit it may use behind the turn-round' : 'no exit behind the turn-round' };
  return { ok: true, x: pick(behind), backtrack: true, xStop, w, rEx };
}

/**
 * The way off at exit x from where the runway part of a path turns off:
 * up the connector to its holding point — or, for a connector that is the
 * crosswind runway, up it and along the taxiway until clear of it, to the
 * holding point on the taxiway on the slots' side (field.holdPoint). One
 * path: nothing stops on 18/36 on the way.
 */
export function exitTail(field, perf, x, rEx, zFrom = null) {
  const cz = zFrom == null ? field.cz : zFrom;
  if (alongR2(field, x)) {
    const h = holdPoint(field, x, perf);
    return [
      { x, z: cz, r: rEx },
      { x, z: field.twZ, r: perf.length >= 44 ? 24 : 14 },
      { x: h.x, z: field.twZ, r: 0 },
    ];
  }
  return [
    { x, z: cz, r: rEx },
    { x, z: field.holdZ, r: 0 },
  ];
}

/** Draw the roll-out and exit on to a draft that is on the centreline at xFrom. */
function appendExit(d, field, rw, perf, xFrom, ex) {
  const cz = field.cz;
  if (!ex.backtrack) {
    d.fillet([{ x: xFrom, z: cz, r: 0 }, ...exitTail(field, perf, ex.x, ex.rEx)], 8, 6);
    return d;
  }
  d.line(ex.xStop, cz, 8);
  uTurn(d, rw.dir, cz, ex.w, -(field.side || -1));
  d.fillet([{ x: ex.xStop, z: cz, r: 0 }, ...exitTail(field, perf, ex.x, ex.rEx)], 5, 6);
  return d;
}

/**
 * Off the main runway NOW, from (x0, z0) on it, moving along it in
 * direction d (+1 east) at v0 — for the player turning up on it: by exit X,
 * straight on to it if it is ahead, or round and back to it if it is
 * behind, and never stopping on the runway on the way (the U-turn is a slow
 * one, not a stop). `limitX`, if given, is how far along d it may reach,
 * nose and all — the near side of the player. The turn round is as gentle as
 * there is room for before that: the full S-bend, a shorter one, or none (a
 * plain half circle, 7 m forward). Returns the path, speeds set, or null if
 * this aeroplane cannot get off that way from here.
 */
export function escapePath(field, perf, x0, z0, d, v0, X, limitX = null) {
  const cz = field.cz;
  const rEx = Math.min(field.halfWidth + 6, 20);
  const dec = 3.2;
  const vTaxi = Math.min(perf.taxi, 7);
  const dr = new Draft(x0, z0);
  const reach = (x) => (limitX == null ? Infinity : (limitX - x) * d);
  if ((X - x0) * d > 0) {
    // Ahead: room to slow for the turn off, and the turn well short of the limit.
    const vTurn = Math.sqrt(1.4 * rEx);
    const need = Math.max(0, (v0 * v0 - vTurn * vTurn) / (2 * dec)) + rEx + 4;
    if ((X - x0) * d < need) return null;
    if (reach(X) < perf.noseLen + perf.span / 2 + 6) return null;
    dr.fillet([{ x: x0, z: z0, r: 0 }, ...exitTail(field, perf, X, rEx)], 5, 6);
  } else {
    const w = uTurnWidth(field);
    const vU = Math.sqrt(1.4 * w);
    const brake = Math.max(0, (v0 * v0 - vU * vU) / (2 * dec));
    // Forward before it turns: to slow down, and far enough past the exit
    // (the arc ends `blend` beyond where it starts) to turn into it after.
    let blend = 2.5 * w;
    const fits = (b) => {
      let xt = x0 + d * brake;
      const need = X + d * (rEx + 6) - d * b;
      if ((need - xt) * d > 0) xt = need;
      return { xt, room: reach(xt) - b - w - perf.noseLen - 3 };
    };
    let f = fits(blend);
    if (f.room < 0) {
      // Less S-bend, or none.
      blend = Math.max(0, blend + f.room);
      f = fits(blend);
      if (f.room < -0.01) return null;
    }
    if (Math.abs(f.xt - x0) > 0.5) dr.line(f.xt, cz, 8);
    uTurn(dr, d, cz, w, -(field.side || -1), blend, false);
    const xa = dr.lastX;
    const za = dr.lastZ;
    if ((xa - X) * d < rEx + 3) return null;
    dr.fillet([{ x: xa, z: za, r: 0 }, ...exitTail(field, perf, X, rEx, za)], 5, 6);
  }
  const p = dr.finish();
  groundify(p);
  p.setSpeeds((i) => Math.max(vTaxi, Math.sqrt(Math.max(0, v0 * v0 - 2 * dec * p.s[i]))), {
    v0,
    vEnd: 0,
    accel: 0.8,
    decel: dec,
    latAccel: 1.4,
  });
  // It could not slow down in time for the turns.
  if (p.vmax[0] < v0 - 0.6) return null;
  return p;
}

/**
 * Off the crosswind runway along the taxiway it is crossing: straight on
 * over 18/36 to the holding point on the far side, round on the taxiway
 * there (a U-turn inside its width), and stopped facing back — off the
 * runway, ready to cross again when it may. For one that had just rolled on
 * to 18/36 from the taxiway when the player turned up on it: across is the
 * quickest way off, and at right angles to them. Returns the path or null.
 */
export function acrossR2Path(field, perf, x0, v0, dirX) {
  if (!field.r2) return null;
  const r2 = field.r2;
  const xFar = r2.cx + dirX * (r2.hw + r2HoldBack(perf));
  if ((xFar - x0) * dirX < 5) return null;
  const w = Math.max(6, Math.min(uTurnWidth(field), field.twHalf - 2));
  // Taxiway enough beyond it to turn round on.
  const xEnd = xFar + dirX * (3.5 * w + 4);
  if (xEnd < field.twX0 || xEnd > field.twX1) return null;
  const dr = new Draft(x0, field.twZ);
  dr.line(xFar, field.twZ, 5);
  uTurn(dr, dirX, field.twZ, w, field.side || -1, 2.5 * w, true);
  const p = dr.finish();
  groundify(p);
  p.setSpeeds(() => Math.min(perf.taxi, 7), { v0, vEnd: 0, accel: 0.8, decel: 2.5, latAccel: 1.4 });
  if (p.vmax[0] < v0 - 0.6) return null;
  return p;
}


/**
 * From an exit's holding point to the slot: taxi in nose first, or — for a
 * hangar whose slot faces out of its doors — taxi just past it and be pushed
 * back in, tail first, the way hangars are filled.
 */
export function planTaxiIn(field, perf, exitX, slot) {
  const d = taxiInDraft(field, perf, exitX, slot);
  const p = d.taxi.finish();
  groundify(p);
  p.setSpeeds(() => perf.taxi, { v0: perf.taxi * 0.8, vEnd: 0, accel: 0.8, decel: 0.9, latAccel: 1.5 });
  const legs = [leg('taxi-in', p, { phase: 'taxiing in', holdAtEnd: true })];
  if (d.push) {
    const q = d.push.finish();
    groundify(q);
    q.setSpeeds(() => tugSpeed(slot), { v0: 0, vEnd: 0, accel: 0.4, decel: 0.5, latAccel: 0.6 });
    legs.push(
      leg('push-in', q, {
        reverse: true,
        holdAtEnd: true,
        // The tug is hooked on before anything moves.
        pauseBefore: 4,
        phase: slot.kind === 'hangar' ? 'pushed into the hangar' : 'pushed on to the stand',
      })
    );
  }
  return legs;
}

/**
 * Home to the slot from somewhere on the taxiway itself, facing along it —
 * the far side of the crosswind runway, where one that crossed it to get
 * off it waits (acrossR2Path). The same legs as planTaxiIn from there.
 */
export function planTaxiHome(field, perf, fromX, slot) {
  if (!slot) return [];
  const d = taxiInDraft(field, perf, null, slot, { x: fromX });
  const p = d.taxi.finish();
  groundify(p);
  p.setSpeeds(() => perf.taxi, { v0: 0, vEnd: 0, accel: 0.8, decel: 0.9, latAccel: 1.5 });
  const legs = [leg('taxi-in', p, { phase: 'taxiing in', holdAtEnd: true })];
  if (d.push) {
    const q = d.push.finish();
    groundify(q);
    q.setSpeeds(() => tugSpeed(slot), { v0: 0, vEnd: 0, accel: 0.4, decel: 0.5, latAccel: 0.6 });
    legs.push(leg('push-in', q, { reverse: true, holdAtEnd: true, pauseBefore: 4, phase: slot.kind === 'hangar' ? 'pushed into the hangar' : 'pushed on to the stand' }));
  }
  return legs;
}

/**
 * A rejected take-off or any other stop on the runway: brake, get off at the
 * next exit (or turn round for one), and go back to the slot.
 */
export function planVacate(field, perf, dir, x0, v0, slot, limitX = null, allow = null, turnFrom = null, avoid = undefined) {
  const rw = runwayFor(field, dir);
  // Treat it like a roll-out from the current speed.
  const p2 = { ...perf, vtd: Math.max(v0, 4) };
  // (The departures' connector only if nothing else will do — unless, in a
  // hurry to be off the runway, it is given `avoid` null: the nearest.)
  const ex = exitPlan(field, rw, p2, x0, { avoid: avoid === undefined ? rw.depConnector : avoid, limitX, allow, turnFrom });
  if (!ex.ok) return null;
  const d = new Draft(x0, field.cz);
  appendExit(d, field, rw, p2, x0, ex);
  const p = d.finish();
  groundify(p);
  const dec = perf.decel * 1.4;
  p.setSpeeds((i) => Math.max(perf.taxi, Math.sqrt(Math.max(0, v0 * v0 - 2 * dec * p.s[i]))), {
    v0,
    vEnd: perf.taxi * 0.8,
    accel: 0.8,
    decel: dec,
    latAccel: 1.6,
  });
  return [
    leg('vacate', p, { phase: 'leaving the runway', releaseRunway: true, sRelease: p.length - 1, exit: ex.x }),
    ...planTaxiIn(field, perf, ex.x, slot),
  ];
}

/* ------------------------------------------------------------------ */
/* Which ways in and out a wing span allows                            */
/* ------------------------------------------------------------------ */

/**
 * For one aeroplane and one slot: which connectors it can taxi out to, and
 * which exits it can taxi back in from, with its wings and nose clear of
 * every building. Each is a Map from the connector's x to null (clear) or the
 * reason it is not. Cached on the field; worked out only when asked, for the
 * slots and types actually in play, because it is a dozen routes each.
 *
 * Why it exists: on the integrated airport a 747 or an A380 put a wing
 * through a hangar wall or the fire station on every taxi at the big fields,
 * because the parallel taxiway runs 25 m in front of them. A jumbo there
 * now leaves by the one connector whose way it can clear — the middle one,
 * which still gives it 1.8 km of runway — and turns off at the same one.
 */
export function slotRoutes(field, perf, slot) {
  field._routes = field._routes || new Map();
  const key = `${perf.id}|${slot.id}|${perf.span.toFixed(1)}`;
  const hit = field._routes.get(key);
  if (hit) return hit;
  // The legs themselves are kept too, so the runtime never plans them twice.
  const r = { out: new Map(), in: new Map(), outLegs: new Map(), inLegs: new Map() };
  const walk = (legs) => {
    for (const l of legs) {
      const why = groundPathProblem(field, perf, l.path, slot, !!l.reverse);
      if (why) return `${l.kind}: ${why}`;
      // Along the taxiway over the crosswind runway: a crossing nobody has
      // cleared, so not a way it is given (a slot the far side of it).
      if (field.r2 && crossesR2(l.path, perf)) return `${l.kind}: across the crosswind runway on the taxiway`;
    }
    return null;
  };
  for (const cx of field.connectors) {
    let why;
    try {
      // The way out depends on the connector, not on the runway direction.
      const legs = planTaxiOut(field, perf, slot, 1, cx);
      r.outLegs.set(cx, legs);
      why = walk(legs);
    } catch (e) {
      why = 'no way out';
    }
    r.out.set(cx, why);
    try {
      const legs = planTaxiIn(field, perf, cx, slot);
      r.inLegs.set(cx, legs);
      why = walk(legs);
    } catch (e) {
      why = 'no way in';
    }
    r.in.set(cx, why);
  }
  field._routes.set(key, r);
  return r;
}

/** Does this ground path go on to the crosswind runway anywhere (its wings)? */
export function crossesR2(p, perf) {
  const m = perf.span / 2;
  for (let i = 0; i < p.n; i++) if (isOnRunway2(p.x[i], p.z[i], m)) return true;
  return false;
}

/**
 * The legs out of this slot to connector cx ('out'), or back into it from
 * exit cx ('in'), from slotRoutes()' cache — a fresh array each time, the
 * legs themselves shared (nothing writes to a leg once it is planned).
 */
export function routeLegs(field, perf, slot, way, cx) {
  const r = slotRoutes(field, perf, slot);
  const legs = (way === 'out' ? r.outLegs : r.inLegs).get(cx);
  if (legs) return [...legs];
  return way === 'out' ? planTaxiOut(field, perf, slot, 1, cx) : planTaxiIn(field, perf, cx, slot);
}

/**
 * The connectors this aeroplane may leave this slot by, for runway `dir`:
 * its wings clear the way there, and from there it lines up and gets off
 * the ground with runway to spare. Most runway ahead first.
 */
export function departureConnectors(field, perf, slot, dir) {
  const rw = runwayFor(field, dir);
  const r = slotRoutes(field, perf, slot);
  field._depOk = field._depOk || new Map();
  const out = [];
  for (const cx of rw.exits) {
    if (r.out.get(cx) !== null) continue;
    const key = `${perf.id}|${dir}|${cx}`;
    let ok = field._depOk.get(key);
    if (ok == null) {
      const dep = planDeparture(field, perf, dir, cx);
      ok = !!dep.ok && !groundPathProblem(field, perf, dep.legs[0].path) && !airClearance(dep.legs[1].path, field, 40);
      field._depOk.set(key, ok);
    }
    if (ok) out.push(cx);
  }
  return out;
}

/** The exits from which this aeroplane can taxi back to this slot. */
export function arrivalExits(field, perf, slot) {
  const r = slotRoutes(field, perf, slot);
  return field.connectors.filter((cx) => r.in.get(cx) === null);
}

/**
 * Can this aeroplane live on this slot while runway `dir` is in use: it
 * fits, it can get out to the runway, and an approach can turn off at an
 * exit it can taxi back in from. Cached on the field.
 */
export function slotUsable(field, perf, slot, dir) {
  if (!fits(slot, perf)) return false;
  field._slotOk = field._slotOk || new Map();
  const key = `${perf.id}|${slot.id}|${dir}`;
  const hit = field._slotOk.get(key);
  if (hit != null) return hit;
  let ok = departureConnectors(field, perf, slot, dir).length > 0;
  if (ok) {
    const exits = arrivalExits(field, perf, slot);
    ok = exits.length > 0;
    if (ok) {
      const geo = goodArrival(field, perf, dir, perf.layerAGL, 1);
      ok = planApproach(field, perf, geo, { allow: (x) => exits.includes(x) }).ok;
    }
  }
  field._slotOk.set(key, ok);
  return ok;
}

/* ------------------------------------------------------------------ */
/* In the air                                                          */
/* ------------------------------------------------------------------ */

/** Places worth flying over on this map: its islands and its named spots. */
export function sightsFor(field) {
  const out = [];
  for (const isl of ISLANDS || []) {
    if (!isl || !Number.isFinite(isl.cx)) continue;
    out.push({ name: isl.name || 'island', x: isl.cx, z: isl.cz, peak: isl.peak || 0 });
  }
  const sc = (MAP && MAP.scenery) || {};
  for (const p of sc.pads || []) {
    if (p && p.id !== 'field' && Number.isFinite(p.x)) out.push({ name: p.name, x: p.x, z: p.z, peak: 0 });
  }
  if (Array.isArray(sc.lighthouse)) out.push({ name: 'the lighthouse', x: sc.lighthouse[0], z: sc.lighthouse[1], peak: 0 });
  if (sc.town && Number.isFinite(sc.town.cx)) out.push({ name: 'the town', x: sc.town.cx, z: sc.town.cz, peak: 0 });
  return out;
}

/**
 * The ground (or the sea surface) under every point of a path, sampled once
 * and kept on the path. heightAt is a microsecond on a desktop and several on
 * a school Chromebook, and a route is a few hundred points — the floor, the
 * cruise height and the clearance check all read this rather than asking
 * again.
 */
export function terrainUnder(p) {
  if (p.terrain && p.terrain.length === p.n) return p.terrain;
  const t = new Float32Array(p.n);
  for (let i = 0; i < p.n; i++) t[i] = Math.max(heightAt(p.x[i], p.z[i]), 0);
  p.terrain = t;
  return t;
}

/**
 * The route from the end of the climb-out to the gate: a circuit, or a tour.
 * `kind` is 'circuit' | 'tour'. Returns { ok, why, legs, name }.
 */
export function planRoute(field, perf, start, geo, kind, rand = Math.random) {
  /*
   * Where the ground near the field is high — Aurora Fjord has a wall of rock
   * either side of the runway — a circuit turned at the usual place flies into
   * it. So when a plan does not clear, the next try flies further out along
   * the climb-out before turning, where the valley opens and there is height
   * in hand: 0, 1.5, 3 and 5 km. A tour also re-draws which islands it visits.
   */
  const EXT = [0, 1500, 3000, 5000];
  const tries = kind === 'tour' ? 8 : EXT.length;
  let last = null;
  let best = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    const r = planRouteOnce(field, perf, start, geo, kind, rand, EXT[attempt % EXT.length]);
    last = r;
    if (r.ok) return r;
    if (!best || r.margin > best.margin) best = r;
  }
  // A tour that will not clear anywhere is flown as a circuit instead.
  if (kind === 'tour') {
    const c = planRoute(field, perf, start, geo, 'circuit', rand);
    if (c.ok) return c;
  }
  return best || last;
}

function planRouteOnce(field, perf, start, geo, kind, rand, ext) {
  {
    const wps = [];
    let name = 'the circuit';
    let v = perf.vCircuit;
    if (kind === 'tour') {
      v = perf.cruise;
      const cands = sightsFor(field).filter((s) => {
        const r = Math.hypot(s.x - field.cx, s.z - field.cz);
        return r > 1800 && r < (perf.cat === 'light' ? 9000 : 15000);
      });
      if (!cands.length) {
        kind = 'circuit';
        v = perf.vCircuit;
      } else {
        const k = Math.min(cands.length, perf.cat === 'light' ? 1 + Math.floor(rand() * 2) : 2);
        const pick = [];
        const pool = [...cands];
        for (let i = 0; i < k && pool.length; i++) pick.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
        // Visit them in the order that makes the shorter loop.
        if (pick.length === 2) {
          const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
          const s0 = { x: start.x, z: start.z };
          const e0 = geo.dw || geo.gate;
          if (dist(s0, pick[1]) + dist(pick[0], e0) < dist(s0, pick[0]) + dist(pick[1], e0)) pick.reverse();
        }
        for (const s of pick) wps.push(s);
        name = pick.map((s) => s.name).join(' and ');
      }
    }
    const R = perf.turnR(v);
    const d = new Draft(start.x, start.z);
    if (ext > 0) d.ahead(ext, 60, start.hdg);
    let hdg = start.hdg;
    let px = d.lastX;
    let pz = d.lastZ;
    const into = geo.dw || geo.gate;
    for (let i = 0; i < wps.length; i++) {
      const w = wps[i];
      const next = i + 1 < wps.length ? wps[i + 1] : into;
      // Fly over it on the heading that splits the way in and the way out.
      const hin = headingOf(w.x - px, w.z - pz);
      const hout = headingOf(next.x - w.x, next.z - w.z);
      const h = hin + wrapPi(hout - hin) / 2;
      d.dubins(hdg, w.x, w.z, h, R, 60);
      hdg = h;
      px = w.x;
      pz = w.z;
    }
    const iDw = d.n;
    const iDwEnd = joinArrival(d, hdg, geo, field, kind === 'circuit' ? perf.turnR(perf.vCircuit) : R);
    const p = d.finish();
    // Heights: cruise over the tour, circuit height on the downwind, gate
    // height at the end, and always the clearance above the ground.
    const cruiseY = kind === 'tour' ? field.elev + perf.cruiseAGL : geo.yGate;
    const floor = new Float64Array(p.n);
    const ter = terrainUnder(p);
    let tMaxTour = -Infinity;
    if (kind === 'tour') for (let i = 0; i < iDw; i++) tMaxTour = Math.max(tMaxTour, ter[i]);
    const cruiseLevel = Math.max(cruiseY, tMaxTour + perf.clearance);
    for (let i = 0; i < p.n; i++) {
      const lvl = i >= iDwEnd ? geo.yGate : cruiseLevel;
      floor[i] = Math.max(lvl, ter[i] + perf.clearance);
    }
    verticalProfile(p, start.y, geo.yGate, floor, Math.max(perf.gradClimb, 0.12), perf.gradDesc);
    p.setSpeeds(() => v, { v0: start.v, vEnd: perf.vGate, accel: 0.7, decel: 0.5, groundOnlyLat: true });
    const worst = clearanceMargin(p, field, 60);
    const bad = worst >= 0 ? null : clearanceWhy(p, worst);
    return {
      ok: !bad,
      why: bad,
      margin: worst,
      legs: [leg('route', p, { phase: kind === 'tour' ? `flying to ${name}` : 'flying the circuit', routeName: name })],
      name,
      kind,
    };
  }
}

/** The worst (lowest) clearance on a path over what it needs, metres; negative is too low. */
export function clearanceMargin(p, field, minClear, fromS = 0, toS = Infinity) {
  let worst = Infinity;
  p._worstAt = -1;
  const ter = terrainUnder(p);
  for (let i = 0; i < p.n; i++) {
    if (p.ground[i] || p.s[i] < fromS || p.s[i] > toS) continue;
    const x = p.x[i];
    const z = p.z[i];
    const nearField = Math.abs(z - field.cz) < 600 && x > field.west - 2500 && x < field.east + 2500;
    const c = p.y[i] - ter[i] - (nearField ? 0 : minClear);
    if (c < worst) {
      worst = c;
      p._worstAt = i;
    }
  }
  return worst;
}

function clearanceWhy(p, worst) {
  const at = p._worstAt;
  return `${Math.round(-worst)} m too low near (${Math.round(p.x[at])}, ${Math.round(p.z[at])})`;
}

/**
 * The lowest the path gets above the ground, as a reason string, or null.
 * Within `nearField` metres of the runway ends it only has to be above it.
 */
export function airClearance(p, field, minClear, fromS = 0, toS = Infinity) {
  const worst = clearanceMargin(p, field, minClear, fromS, toS);
  return worst >= 0 ? null : clearanceWhy(p, worst);
}

/** A 360 at the gate, turning away from the runway. */
export function planOrbit(field, perf, geo) {
  const g = geo.gate;
  const R = geo.R;
  const right = { x: g.x + Math.cos(g.hdg) * R, z: g.z + Math.sin(g.hdg) * R };
  const left = { x: g.x - Math.cos(g.hdg) * R, z: g.z - Math.sin(g.hdg) * R };
  const far = (c) => Math.hypot(c.x - geo.A, c.z - field.cz);
  const turnRight = far(right) >= far(left);
  const d = new Draft(g.x, g.z).turn(g.hdg, turnRight ? Math.PI * 2 : -Math.PI * 2, R, 5);
  d.xs[d.n - 1] = g.x;
  d.zs[d.n - 1] = g.z;
  const p = d.finish();
  for (let i = 0; i < p.n; i++) p.y[i] = geo.yGate;
  p.setSpeeds(() => perf.vGate, { v0: perf.vGate, vEnd: perf.vGate, accel: 0.5, decel: 0.5 });
  return leg('orbit', p, { phase: 'holding for the runway' });
}

/**
 * Go round: power on, climb straight ahead, and fly the circuit back to the
 * gate. `from` is the current { x, y, z, hdg, v }.
 */
export function planGoAround(field, perf, geo, from, away = 0) {
  /*
   * Straight ahead first — over the runway, which is clear by definition — and
   * further out before turning if the ground near the field is high.
   *
   * Unless it is going round because of YOU, in the air ahead of it: then
   * straight ahead is straight at you. Measured head-on, the straight climb
   * came within 351 m; so it first turns 45 degrees away from you (`away`,
   * +1 right, -1 left), and that is used if it clears the ground — the
   * straight one if not.
   */
  const R = perf.turnR(perf.vCircuit);
  const tries = [];
  if (away) for (const ahead of [400, 1200]) tries.push({ turn: away * 45 * DEG, ahead });
  for (const ahead of [Math.max(600, perf.upwind * 0.6), 2500, 4500]) tries.push({ turn: 0, ahead });
  let best = null;
  for (const t of tries) {
    const d = new Draft(from.x, from.z);
    let hdg = from.hdg;
    if (t.turn) {
      d.turn(hdg, t.turn, Math.max(150, perf.turnR(from.v)), 5);
      hdg += t.turn;
    }
    d.ahead(t.ahead, 30, hdg);
    joinArrival(d, hdg, geo, field, R);
    const p = d.finish();
    const floor = new Float64Array(p.n);
    const ter = terrainUnder(p);
    for (let i = 0; i < p.n; i++) floor[i] = Math.max(geo.yGate, ter[i] + perf.clearance * 0.6);
    verticalProfile(p, from.y, geo.yGate, floor, Math.max(perf.gradClimb, 0.12), perf.gradDesc);
    p.setSpeeds(() => perf.vCircuit, { v0: from.v, vEnd: perf.vGate, accel: 0.9, decel: 0.5 });
    const m = clearanceMargin(p, field, 40);
    // A turning one only if it clears outright; otherwise the best of them.
    if (m >= 0) {
      best = { p, m };
      break;
    }
    if (!t.turn && (!best || m > best.m)) best = { p, m };
  }
  return leg('go-around', best.p, { phase: 'going around', margin: best.m });
}

/**
 * Can this aeroplane use this runway direction at all — get off it, fly a
 * circuit, come back down a glideslope that clears the ground, and stop?
 * Cached on the field. The runtime picks a direction this says yes to; the
 * node test checks everything it says yes to in detail.
 */
export function runwayUsable(field, perf, dir) {
  field._usable = field._usable || {};
  const key = `${perf.id}:${dir}`;
  if (field._usable[key]) return field._usable[key];
  const name = dir > 0 ? '09' : '27';
  let out = { ok: true, why: null };
  const gs = glidePath(field, perf, dir);
  if (gs.steep) {
    out = { ok: false, why: `the ground under the final approach to ${name} is too high for a glideslope` };
  } else {
    const dep = planDeparture(field, perf, dir);
    const climb = dep.ok ? airClearance(dep.legs[1].path, field, 40) : null;
    if (!dep.ok) out = { ok: false, why: dep.why };
    else if (climb) out = { ok: false, why: `climb-out from ${name}: ${climb}` };
    else {
      const geo = goodArrival(field, perf, dir, perf.layerAGL, 1);
      const route = planRoute(field, perf, dep.end, geo, 'circuit');
      const app = planApproach(field, perf, geo);
      if (!route.ok) out = { ok: false, why: `circuit for ${name}: ${route.why}` };
      else if (!app.ok) out = { ok: false, why: app.why };
      else if (!geo.checked) out = { ok: false, why: `no circuit, hold and go-around for ${name} clears the ground (short by ${Math.round(geo.shortBy)} m)` };
    }
  }
  field._usable[key] = out;
  return out;
}

/**
 * The end of every route: downwind (if this arrival has one), base, and into
 * the gate. Returns the index where the downwind begins, from which the path
 * is flown at gate height.
 */
function joinArrival(d, hdg, geo, field, rRoute) {
  if (geo.dw) {
    // A circuit's turn from upwind to downwind has to fit inside the spacing.
    const r = Math.max(60, Math.min(rRoute, (Math.abs(geo.dw.z - field.cz) - 20) / 2));
    d.dubins(hdg, geo.dw.x, geo.dw.z, geo.dw.hdg, r, 60);
    const iDw = d.n - 1;
    d.dubins(geo.dw.hdg, geo.gate.x, geo.gate.z, geo.gate.hdg, geo.R, 60);
    return iDw;
  }
  const iDw = d.n - 1;
  d.dubins(hdg, geo.gate.x, geo.gate.z, geo.gate.hdg, Math.max(geo.R, rRoute * 0.8), 60);
  return iDw;
}

/**
 * Pick which side of the runway this aeroplane's circuit and gate are on:
 * whichever has lower ground under the downwind, the base leg and the
 * holding orbit — and straight in along the cleared approach if neither side
 * will do. `prefer` breaks a tie, so two aeroplanes can fly opposite circuits.
 */
export function chooseArrival(field, perf, dir, layer, prefer = 1) {
  let best = null;
  for (const side of [prefer, -prefer]) {
    const geo = arrivalGeometry(field, perf, dir, side, layer);
    const worst = arrivalTerrain(field, perf, geo);
    if (!best || worst < best.worst - 25) best = { geo, worst };
  }
  if (best.worst <= -perf.clearance * 0.7) return best.geo;
  const straight = arrivalGeometry(field, perf, dir, 0, layer);
  const w0 = arrivalTerrain(field, perf, straight);
  return w0 < best.worst ? straight : best.geo;
}

/**
 * The arrival this aeroplane will fly at this layer, checked the way it is
 * flown: the circuit from the climb-out to the gate, the holding orbit at the
 * gate, a go-around from short final back round to it, and an approach that
 * plans. The first of these candidates that clears the ground everywhere —
 * chooseArrival()'s pick at the asked-for height, then the other sides of the
 * runway, then a layer higher, lower, higher again — cached on the field.
 *
 * chooseArrival() alone looked only at the ground under the base leg and the
 * orbit, and took the best side even when that was not good enough. On the
 * integrated maps that sent a Courier's circuit 25 m below its margin into
 * the rock west of Aurora Fjord, a Skylark's holding orbit 24 m below it, and
 * a Meridian's circuit on Ember Isle 176 m below it — and the runtime flew
 * the failed plan anyway.
 */
export function goodArrival(field, perf, dir, layer, prefer = 1) {
  field._arr = field._arr || new Map();
  const key = `${perf.id}|${dir}|${Math.round(layer)}|${prefer}`;
  const hit = field._arr.get(key);
  if (hit) return hit;
  const dep = planDeparture(field, perf, dir);
  let best = null;
  const tried = new Set();
  for (const k of [0, 1, -1, 2, 3, -2, 4, 5]) {
    const L = layer + k * perf.layerStep;
    if (L < perf.layerAGL * 0.75) continue;
    const first = chooseArrival(field, perf, dir, L, prefer);
    for (const side of [first.side, prefer, -prefer, 0]) {
      const tag = `${L}|${side}`;
      if (tried.has(tag)) continue;
      tried.add(tag);
      const geo = side === first.side ? first : arrivalGeometry(field, perf, dir, side, L);
      const score = arrivalScore(field, perf, geo, dep.end);
      if (score >= 0) {
        geo.checked = true;
        field._arr.set(key, geo);
        return geo;
      }
      if (!best || score > best.score) best = { geo, score };
    }
  }
  best.geo.checked = false;
  best.geo.shortBy = -best.score;
  field._arr.set(key, best.geo);
  return best.geo;
}

/**
 * What the runtime flies: goodArrival() at this aeroplane's own layer and
 * side, or — if nothing there clears — the lowest layer on its side, then
 * the lowest layer on the south side, which runwayUsable() has checked.
 */
export function arrivalFor(field, perf, dir, layer, prefer = 1) {
  let g = goodArrival(field, perf, dir, layer, prefer);
  if (!g.checked) g = goodArrival(field, perf, dir, perf.layerAGL, prefer);
  if (!g.checked) g = goodArrival(field, perf, dir, perf.layerAGL, 1);
  return g;
}

/** The worst margin, metres, of everything an arrival on this geometry flies; negative is too low. */
function arrivalScore(field, perf, geo, start) {
  if (arrivalTerrain(field, perf, geo) > 0) return -1e6;
  let worst = clearanceMargin(planOrbit(field, perf, geo).path, field, 60);
  if (worst < 0) return worst;
  const route = planRoute(field, perf, start, geo, 'circuit');
  worst = Math.min(worst, route.ok ? 0 : route.margin);
  if (worst < 0) return worst;
  const app = planApproach(field, perf, geo);
  if (!app.ok) return -1e5;
  const ap = app.legs[0].path;
  const i = Math.max(0, ap.indexAt(app.sTD) - 40);
  const ga = planGoAround(field, perf, geo, { x: ap.x[i], y: ap.y[i], z: ap.z[i], hdg: ap.hdg[i], v: perf.vapp });
  return Math.min(worst, ga.margin);
}

/** Highest (ground - gate height) under the base leg, the turn and the orbit. Negative is clear. */
export function arrivalTerrain(field, perf, geo) {
  let worst = -Infinity;
  const probe = (x, z) => {
    worst = Math.max(worst, Math.max(heightAt(x, z), 0) - geo.yGate);
  };
  const g = geo.gate;
  const R = geo.R;
  // The base leg and turn, coarsely, against the height it descends through.
  for (let t = 0; t <= 1; t += 0.1) {
    const x = g.x + (geo.faf - g.x) * t;
    const z = g.z + (field.cz - g.z) * t;
    worst = Math.max(worst, Math.max(heightAt(x, z), 0) - (geo.yGate + (geo.yFaf - geo.yGate) * t));
  }
  // The orbit circle (either side — whichever is used).
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
    const cx1 = g.x + Math.cos(g.hdg) * R;
    const cz1 = g.z + Math.sin(g.hdg) * R;
    const cx2 = g.x - Math.cos(g.hdg) * R;
    const cz2 = g.z - Math.sin(g.hdg) * R;
    probe(cx1 + Math.cos(a) * R, cz1 + Math.sin(a) * R);
    probe(cx2 + Math.cos(a) * R, cz2 + Math.sin(a) * R);
  }
  // The downwind leg, for circuits.
  if (geo.dw) for (let t = 0; t <= 1; t += 0.1) probe(geo.dw.x + (g.x - geo.dw.x) * t, geo.dw.z);
  return worst;
}
