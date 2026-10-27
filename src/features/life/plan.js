/**
 * World life, planned: who walks where on the airfield, and which service
 * vehicles drive which apron route. PURE — no meshes, no THREE, no sim — so
 * tests/features/world-life.mjs checks every route in node against the same
 * layout the world is built from.
 *
 * The owner: "more ambient life in free flight and missions". The apron had
 * its crews' vehicles parked round every airliner and nobody in them, and
 * the terminal had a kerb nobody stood on. So, from the airport layout
 * (world/airport-layout.js) and what the apron actually parked
 * (world/apron.js `parked` and `crews`):
 *
 *   APRON CREWS   at every serviced airliner: a dispatcher by the nose, a
 *                 wing walker off the left wingtip, a loader walking between
 *                 the belt loader and the baggage carts, a fueller at the
 *                 bowser — each where the real one stands, on the side the
 *                 real one works.
 *   PASSENGERS    boarding or getting off by the stair truck (the rear door
 *                 at a gate — dual boarding — or the front one on a remote
 *                 stand): up or down the steps, then the walk between the
 *                 aircraft and the terminal, outboard of the engines on a
 *                 narrow-body and between the fuselage and the inboard engine
 *                 on a wide-body, one after another, a pause, and the next
 *                 load.
 *   A PILOT       walking round a parked light aeroplane: the walk-round.
 *   THE KERB      people with cases on the terminal's landside forecourt,
 *                 some waiting at the kerb, some walking along under the
 *                 canopy, some going in at the doors; at a flying club, a
 *                 few on the veranda watching the aeroplanes.
 *   BASE GUARDS   on the air base: pacing in front of the operations block
 *                 and by every parked jet, and a crew chief at each nose.
 *   VEHICLES      on an airport with gates: a baggage train, a fuel bowser,
 *                 an apron bus and a catering truck driving a loop of the
 *                 apron — along the airside road under the bridges, round
 *                 the end of the apron, back along its front — every metre of
 *                 it checked clear of the parked aeroplanes, their vehicles,
 *                 the bridges and the buildings.
 *
 * DENSITY follows the quality tier and the time of day: Low keeps a token
 * few (and Low parks no airliners, so it has no crews or passengers at
 * all), Ultra the most; at night the passengers and the kerb thin to a
 * third, the crews and the guards stay. NEVER IN THE WAY: nobody walks on a
 * runway or a taxiway — every route is on the apron, round its own parked
 * aeroplane, or landside; the passengers' walk stays inside their own
 * stand's width; and the runtime (features/world-life.js) stops a walker or
 * a vehicle that an aeroplane comes near. Nothing here is solid.
 */

/** People at most, per tier, before the time of day. */
export const PEOPLE_CAP = Object.freeze({ low: 14, medium: 40, high: 90, ultra: 140 });
/*
 * Service vehicles on the apron loop, per tier. None on Low: measured there,
 * the baggage train's two meshes and its beacons were most of a 5% frame
 * cost on a Chromebook-class budget (the apron's own crews still drive).
 */
export const VAN_CAP = Object.freeze({ low: 0, medium: 2, high: 4, ultra: 5 });
/** Crew members round each serviced airliner, per tier. */
const CREW_PER = Object.freeze({ low: 1, medium: 2, high: 4, ultra: 4 });
/** Passengers per load at a stair, per tier. */
const PAX_PER = Object.freeze({ low: 3, medium: 5, high: 8, ultra: 12 });
/** People on the kerb, per tier. */
const KERB = Object.freeze({ low: 4, medium: 10, high: 18, ultra: 28 });

/** The time of day's share of passengers and kerb (crews and guards work all night). */
export function timeFactor(time, condition) {
  const t = time === 'night' ? 0.35 : time === 'sunset' || time === 'dawn' ? 0.75 : 1;
  const wet = condition === 'rainy' || condition === 'stormy' ? 0.7 : 1;
  return t * wet;
}

/** Walking speeds, m/s. */
const WALK = { crew: 1.35, pax: 1.15, kerb: 1.2, guard: 0.9, pilot: 1.0 };

/** Outfits (features/life/people.js OUTFIT_COLOURS): the index is the look. */
export const OUTFIT = Object.freeze({ hivis: 0, hivisOrange: 1, pilot: 2, guard: 3, chief: 4, civvy: 5 });

/* ------------------------------------------------------------------ */
/* The frame of a parked aeroplane                                     */
/* ------------------------------------------------------------------ */

/** A point in a parked aeroplane's frame (x right, z aft) on the ground, in the world. */
function at(tg, lx, lz, y = 0) {
  return { x: tg.ox + tg.rx * lx - tg.fx * lz, y, z: tg.oz + tg.rz * lx - tg.fz * lz };
}

/** World → the aeroplane's frame. */
function toLocal(tg, x, z) {
  const dx = x - tg.ox;
  const dz = z - tg.oz;
  return { x: dx * tg.rx + dz * tg.rz, z: -(dx * tg.fx + dz * tg.fz) };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/* ------------------------------------------------------------------ */
/* What is in the way                                                  */
/* ------------------------------------------------------------------ */

/**
 * The obstacles on the apron as circles { x, z, r } and rectangles
 * { x0, x1, z0, z1 }: each parked aeroplane (fuselage and wings as strings
 * of circles), every crew vehicle where it stands, the bridge rotundas and
 * cabs, the terminal and the hangars.
 */
export function apronObstacles(lay, parked = [], crews = [], bridges = []) {
  const circles = [];
  const rects = [];
  for (const p of parked) {
    const tg = p && p.tg;
    if (!tg || !tg.info) continue;
    const I = tg.info;
    const L = I.tailZ - I.noseZ;
    // The fuselage as circles every 3 m, the nose's tapering with it.
    for (let z = I.noseZ + 0.6; z <= I.tailZ; z += 3) {
      const c = at(tg, 0, z);
      circles.push({ x: c.x, z: c.z, r: Math.min(I.hw + 0.8, 0.5 + (z - I.noseZ) * 0.55), tg, kind: 'plane' });
    }
    const tipZ = Number.isFinite(I.wingTipZ) ? I.wingTipZ : I.noseZ + L * 0.55;
    const rootZ = typeof I.wingLE === 'function' ? safeLE(I, 0) : tipZ - 6;
    for (const s of [-1, 1]) {
      for (let k = 0; k <= 8; k++) {
        const x = I.hw + (I.halfSpan - I.hw) * (k / 8);
        const z = rootZ + (tipZ - rootZ) * (k / 8) + 2;
        const c = at(tg, s * x, z);
        circles.push({ x: c.x, z: c.z, r: 3, tg, kind: 'plane' });
      }
    }
  }
  for (const c of crews) {
    const P = c && c.poses;
    if (!P) continue;
    // Half their length and a little: a tug 5.4 m, a stair truck 7, a catering truck 8, a bowser 9.
    const R = { tug: 3.0, stairTruck: 3.8, cateringTruck: 4.3, fuelTruck: 4.8, beltLoader: 4.0, gpu: 1.6 };
    for (const k of Object.keys(R)) {
      if (P[k]) circles.push({ x: P[k].x, z: P[k].z, r: R[k], tg: c.tg, kind: k });
    }
    // The baggage train's loop: its corners, and the middle of each side.
    if (Array.isArray(P.loop)) {
      P.loop.forEach((q, i) => {
        const n = P.loop[(i + 1) % P.loop.length];
        circles.push({ x: q.x, z: q.z, r: 2.6, tg: c.tg, kind: 'train' });
        circles.push({ x: (q.x + n.x) / 2, z: (q.z + n.z) / 2, r: 2.6, tg: c.tg, kind: 'train' });
      });
    }
  }
  for (const b of bridges) {
    if (b && b.rot) circles.push({ x: b.rot.x, z: b.rot.z, r: 2.9, kind: 'rotunda' }); // the drum, 2.75 m round its column
    const d = b && (b.dock || b.home);
    if (d) circles.push({ x: d.x, z: d.z, r: 3.2, kind: 'bridge' });
  }
  if (lay && lay.terminal && lay.terminal.rect) rects.push(lay.terminal.rect);
  for (const h of (lay && lay.hangars) || []) if (h && h.rect) rects.push(h.rect);
  return { circles, rects };
}

function safeLE(I, x) {
  try {
    const le = I.wingLE(x);
    return le && Number.isFinite(le.z) ? le.z : I.noseZ + (I.tailZ - I.noseZ) * 0.4;
  } catch (e) {
    return I.noseZ + (I.tailZ - I.noseZ) * 0.4;
  }
}

/** Is the segment a-b, swept `half` metres either side, clear of every obstacle? Sampled every 1.5 m. */
export function segmentClear(obs, a, b, half) {
  const L = dist(a, b);
  const n = Math.max(1, Math.ceil(L / 1.5));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    for (const c of obs.circles) if (Math.hypot(x - c.x, z - c.z) < c.r + half) return false;
    for (const r of obs.rects) if (x > r.x0 - half && x < r.x1 + half && z > r.z0 - half && z < r.z1 + half) return false;
  }
  return true;
}

/** Is a closed or open route clear, every leg of it? */
export function routeClear(obs, pts, half, closed = false) {
  for (let i = 0; i < pts.length - 1; i++) if (!segmentClear(obs, pts[i], pts[i + 1], half)) return false;
  if (closed && pts.length > 2 && !segmentClear(obs, pts[pts.length - 1], pts[0], half)) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* The plan                                                            */
/* ------------------------------------------------------------------ */

/**
 * Plan the airfield's life.
 *
 *   lay       airportLayout()
 *   parked    the apron's parked list [{ tg, kind, stand }]
 *   crews     the apron's crews [{ tg, opts, poses }]
 *   bridges   the apron's bridges [{ rot, home, dock, st }]
 *   tier      'low' | 'medium' | 'high' | 'ultra'
 *   time      'day' | 'sunset' | 'night' (weather.time); condition likewise
 *   entrances the terminal's kerb doors [{ x, z }] (apron.js), if it has them
 *   ground    (x, z) => metres above the field there (landside, where the
 *             ground is not the apron's): the kerb walkers follow it
 *   rnd       () => [0, 1)
 *   level     1 for free flight, less for a mission (its own share)
 *
 * Returns { walkers, vans, bounds, why } — `why` lists what was left out
 * and why (a route that was not clear, a cap reached).
 */
export function planLife({ lay, parked = [], crews = [], bridges = [], entrances = null, ground = () => 0, tier = 'high', time = 'day', condition = 'clear', rnd = Math.random, level = 1 } = {}) {
  const out = { walkers: [], vans: [], bounds: null, why: [], obs: { circles: [], rects: [] } };
  if (!lay || !lay.apron || !lay.frame) {
    out.why.push('no apron on this map');
    return out;
  }
  const T = PEOPLE_CAP[tier] != null ? tier : 'high';
  const tf = timeFactor(time, condition) * level;
  const cap = Math.max(0, Math.round(PEOPLE_CAP[T] * Math.min(1, level)));
  const obs = apronObstacles(lay, parked, crews, bridges);
  // The runtime keeps everybody's side-steps out of these too (life/crowd.js Statics).
  out.obs = obs;
  const W = out.walkers;
  const F = lay.frame;
  const term = lay.terminal && lay.terminal.rect ? lay.terminal : null;
  const add = (w) => {
    if (W.length >= cap) return false;
    W.push(w);
    return true;
  };
  const crewOf = (p) => crews.find((c) => c && c.tg === p.tg) || null;

  /* --- crews and passengers round each parked airliner, and the walk-round of a light one --- */
  const airliners = parked.filter((p) => p.kind === 'stand' && p.tg && p.tg.info && p.tg.info.halfSpan * 2 >= 18 && !lay.military);
  const lights = parked.filter((p) => p.kind === 'stand' && p.tg && p.tg.info && p.tg.info.halfSpan * 2 < 18 && !lay.military);
  const jets = parked.filter((p) => p.kind === 'stand' && p.tg && lay.military);
  const nCrew = CREW_PER[T];
  const nPax = Math.max(0, Math.round(PAX_PER[T] * tf));
  for (const p of airliners) {
    const tg = p.tg;
    const I = tg.info;
    const c = crewOf(p);
    const P = c && c.poses;
    const zone = p.stand ? p.stand.id || p.stand.number : null;
    // 1. Dispatcher: forward of the nose on the left, clear of the power cart, facing the flight deck.
    const disp = at(tg, -(I.hw + 4.4), I.noseZ + 0.6);
    if (spotClear(obs, disp, p)) add({ tg, skip: [], role: 'dispatcher', outfit: OUTFIT.hivis, mode: 'idle', path: [disp], yaw: yawTo(disp, at(tg, 0, I.noseZ + 3)), zone });
    // 2. Wing walker: off the left wingtip, outboard of the cone, facing forward.
    if (nCrew >= 2) {
      const tipZ = Number.isFinite(I.wingTipZ) ? I.wingTipZ : I.noseZ + (I.tailZ - I.noseZ) * 0.55;
      const ww = at(tg, -(I.halfSpan + 3.2), tipZ + 1);
      if (spotClear(obs, ww, p)) add({ tg, skip: [], role: 'wingwalker', outfit: OUTFIT.hivisOrange, mode: 'idle', path: [ww], yaw: yawTo(ww, at(tg, -(I.halfSpan + 3.2), tipZ - 10)), zone });
    }
    // 3. Loader: from the foot of the belt to the back of the baggage train's round, and back, on the right.
    if (nCrew >= 3 && P && P.beltLoader) {
      const bl = P.beltLoader;
      const h = (bl.heading * Math.PI) / 180;
      const foot = { x: bl.x - Math.sin(h) * 5.4, y: 0, z: bl.z + Math.cos(h) * 5.4 };
      const lf = toLocal(tg, foot.x, foot.z);
      const a = at(tg, lf.x, lf.z + 1.2);
      const b = at(tg, lf.x + 1.5, lf.z + 5.5);
      const route = [a, b];
      if (routeClearPeople(obs, route, p, { skip: ['beltLoader'] })) add({ tg, skip: ['beltLoader'], role: 'loader', outfit: OUTFIT.hivis, mode: 'pingpong', path: route, speed: WALK.crew, pause: 3, zone });
      else if (spotClear(obs, a, p, ['beltLoader'])) add({ tg, skip: ['beltLoader'], role: 'loader', outfit: OUTFIT.hivis, mode: 'idle', path: [a], yaw: yawTo(a, bl), zone });
    }
    // 4. Fueller: at the back of the bowser, on the right wing, watching the hose.
    if (nCrew >= 4 && P && P.fuelTruck) {
      const ft = P.fuelTruck;
      const h = (ft.heading * Math.PI) / 180;
      const f = { x: ft.x - Math.sin(h) * 5.6, y: 0, z: ft.z + Math.cos(h) * 5.6 };
      if (spotClear(obs, f, p, ['fuelTruck'])) add({ tg, skip: ['fuelTruck'], role: 'fueller', outfit: OUTFIT.hivis, mode: 'idle', path: [f], yaw: yawTo(f, P.hoseTo || ft), zone });
    }
    // 5. Passengers: by the stair truck's steps.
    if (nPax > 0 && P && P.stairTruck && !c.light) {
      // Inside their own stand's width: never across a neighbouring stand, empty or not.
      const maxLat = p.stand && p.stand.pitch ? p.stand.pitch / 2 - 1 : Infinity;
      const route = paxRoute(lay, tg, P.stairTruck, bridges, (pts) => routeClearPeople(obs, pts.slice(3), p, { skip: ['stairTruck'] }), maxLat);
      if (!route) {
        out.why.push(`stand ${zone}: no clear walk to the terminal`);
      } else {
        const board = rnd() < 0.5;
        const spacing = 2.4 + rnd() * 1.2;
        const L = pathLength(route);
        for (let i = 0; i < nPax; i++) {
          if (!add({
            tg, skip: ['stairTruck'], role: 'pax', outfit: OUTFIT.civvy, mode: 'cycle', path: board ? route.slice().reverse() : route, speed: WALK.pax * (0.85 + rnd() * 0.3),
            d0: -i * spacing, rest: 25 + rnd() * 20, length: L, bag: rnd() < 0.7, zone, board,
          })) break;
        }
      }
    }
  }
  // A pilot walking round each parked light aeroplane, clockwise, 3 m off its wingtips.
  for (const p of lights) {
    if (W.length >= cap) break;
    const tg = p.tg;
    const I = tg.info;
    const r = Math.max(I.halfSpan + 2.5, (I.tailZ - I.noseZ) / 2 + 2.5);
    const cz = (I.noseZ + I.tailZ) / 2;
    const ring = [];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      ring.push(at(tg, Math.cos(a) * r, cz + Math.sin(a) * r * 0.75));
    }
    if (routeClearPeople(obs, ring, p, { closed: true })) add({ tg, skip: [], role: 'pilot', outfit: OUTFIT.pilot, mode: 'loop', path: ring, speed: WALK.pilot, zone: p.stand ? p.stand.number : null });
  }

  /* --- the kerb, or a flying club's veranda --- */
  if (term && !lay.military && lay.shape !== 'strip' && term.rect) {
    // The forecourt under the canopy (world-life.js paves it): the canopy runs
    // 70% of the terminal's length, 5 m deep, its columns 4.6 m out; the doors
    // are apron.js's `entrances`. Walking lanes either side of the columns.
    const r = term.rect;
    const cx = (r.x0 + r.x1) / 2;
    const half = (r.x1 - r.x0) * 0.35;
    const nk = Math.max(1, Math.round(KERB[T] * tf));
    const doors = entrances && entrances.length ? entrances : [{ x: cx, z: F.z(term.back + 0.2) }];
    const zAt = (w) => F.z(term.back + w);
    const onGround = (q) => ({ ...q, y: ground(q.x, q.z) });
    for (let i = 0; i < nk && W.length < cap; i++) {
      const x = cx + (rnd() * 2 - 1) * (half - 2);
      const kind = rnd();
      if (kind < 0.3) {
        // Waiting at the kerb's edge with a case, facing the road.
        const q = onGround({ x, z: zAt(6.2 + rnd() * 1.2) });
        add({ role: 'kerb', outfit: OUTFIT.civvy, mode: 'idle', path: [q], yaw: yawTo(q, { x: q.x, z: zAt(30) }), bag: true });
      } else if (kind < 0.65) {
        // Walking along it, under the canopy or outside its columns.
        const span = 14 + rnd() * 24;
        const x0 = Math.max(cx - half + 1, Math.min(cx + half - 1 - span, x - span / 2));
        const w = rnd() < 0.5 ? 2.6 + rnd() * 0.8 : 6.0 + rnd() * 1.2;
        const leg = [];
        for (let k = 0; k <= Math.ceil(span / 4); k++) leg.push(onGround({ x: x0 + Math.min(span, k * 4), z: zAt(w) }));
        add({ role: 'kerb', outfit: OUTFIT.civvy, mode: 'pingpong', path: rnd() < 0.5 ? leg : leg.reverse(), speed: WALK.kerb * (0.85 + rnd() * 0.3), pause: 2 + rnd() * 6, bag: rnd() < 0.6, d0: rnd() * span });
      } else {
        // From the kerb in through the doors, one after another.
        const door = doors[Math.floor(rnd() * doors.length)];
        const dx = door.x + (rnd() - 0.5) * 5;
        const a = onGround({ x: dx + (rnd() - 0.5) * 6, z: zAt(7.2) });
        const m = onGround({ x: dx, z: zAt(3.2) });
        const b = onGround({ x: dx, z: zAt(0.5) });
        add({ role: 'kerb', outfit: OUTFIT.civvy, mode: 'cycle', path: [a, m, b], speed: WALK.kerb, d0: -rnd() * 30, rest: 8 + rnd() * 20, length: pathLength([a, m, b]), bag: true });
      }
    }
  } else if (term && !lay.military && term.rect) {
    // A flying club: a few people on the veranda on the airside, watching the aeroplanes.
    const r = term.rect;
    const n = Math.max(1, Math.round((T === 'low' ? 2 : T === 'medium' ? 3 : 5) * tf));
    for (let i = 0; i < n && W.length < cap; i++) {
      const u = (term.u0 + 3) + ((i + 0.5) / n) * (term.u1 - term.u0 - 6);
      const q = { x: F.x(u), y: 0, z: F.z(term.front - 2.6 - rnd() * 1.4) };
      add({ role: 'spectator', outfit: OUTFIT.civvy, mode: 'idle', path: [q], yaw: yawTo(q, { x: q.x, z: F.z(term.front - 60) }) });
    }
    void r;
  }

  /* --- the air base --- */
  if (lay.military) {
    if (term) {
      // Two guards pacing the front of the operations block, one at each end.
      const wF = term.front - 6;
      for (const [ua, ub] of [[term.u0 + 4, term.u0 + 16], [term.u1 - 16, term.u1 - 4]]) {
        const a = { x: F.x(ua), y: 0, z: F.z(wF) };
        const b = { x: F.x(ub), y: 0, z: F.z(wF) };
        if (routeClear(obs, [a, b], 0.5)) add({ role: 'guard', outfit: OUTFIT.guard, mode: 'pingpong', path: [a, b], speed: WALK.guard, pause: 4 });
      }
      // ...and one at the landside door.
      const d0 = { x: F.x((term.u0 + term.u1) / 2), z: F.z(term.back + 3) };
      const d = { ...d0, y: ground(d0.x, d0.z) };
      add({ role: 'guard', outfit: OUTFIT.guard, mode: 'idle', path: [d], yaw: yawTo(d, { x: d.x, z: F.z(term.back + 30) }) });
    }
    for (const p of jets) {
      if (W.length >= cap) break;
      const tg = p.tg;
      const I = tg.info;
      // The crew chief at the nose, the guard pacing a line ahead of it.
      const chief = at(tg, -(I.hw + 3.4), I.noseZ - 1.2);
      if (spotClear(obs, chief, p)) add({ tg, skip: [], role: 'chief', outfit: OUTFIT.chief, mode: 'idle', path: [chief], yaw: yawTo(chief, at(tg, 0, I.noseZ + 2)), zone: p.stand ? p.stand.number : null });
      const a = at(tg, -(I.halfSpan + 2), I.noseZ - 4);
      const b = at(tg, I.halfSpan + 2, I.noseZ - 4);
      if (routeClearPeople(obs, [a, b], p)) add({ tg, skip: [], role: 'guard', outfit: OUTFIT.guard, mode: 'pingpong', path: [a, b], speed: WALK.guard, pause: 5, zone: p.stand ? p.stand.number : null });
    }
  }

  /* --- vehicles --- */
  out.vans = planVans(lay, obs, T, rnd, out.why, level);

  // Bounds: everything above, for one culling sphere.
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  const grow = (q) => {
    x0 = Math.min(x0, q.x);
    x1 = Math.max(x1, q.x);
    z0 = Math.min(z0, q.z);
    z1 = Math.max(z1, q.z);
  };
  for (const w of W) for (const q of w.path) grow(q);
  for (const v of out.vans) for (const q of v.path) grow(q);
  if (Number.isFinite(x0)) out.bounds = { x: (x0 + x1) / 2, z: (z0 + z1) / 2, r: Math.hypot(x1 - x0, z1 - z0) / 2 + 12 };
  if (W.length >= cap) out.why.push(`people capped at ${cap} (${T})`);
  return out;
}

/**
 * People round their own aeroplane walk under its wings and beside its
 * fuselage, so its own airframe is not in their way — but its vehicles
 * are, except the ones named in `skip` (the passengers' stair truck, the
 * loader's belt loader), and everybody else's everything is.
 */
function routeClearPeople(obs, pts, own, { closed = false, skip = [] } = {}) {
  const tg = own && own.tg;
  const view = {
    circles: obs.circles.filter((c) => !(tg && c.tg === tg && (c.kind === 'plane' || skip.includes(c.kind)))),
    rects: obs.rects,
  };
  return routeClear(view, pts, 0.4, closed);
}

/** One spot clear for somebody standing (a 0.5 m circle). */
function spotClear(obs, q, own, skip = []) {
  return routeClearPeople(obs, [q, q], own, { skip });
}

function yawTo(a, b) {
  return Math.atan2(-(b.x - a.x), -(b.z - a.z));
}

export function pathLength(pts) {
  let L = 0;
  for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z, (pts[i + 1].y || 0) - (pts[i].y || 0));
  return L;
}

/**
 * The passengers' walk, from the aeroplane's door to the terminal: in at
 * the door on the stair's platform, down the flight to the truck's bed and
 * a step to the ground, forward round the front of the truck, out to a
 * corridor clear of the engines, forward along it to abeam the nose, and on
 * to the terminal's front wall (or, with no terminal, 25 m ahead of the
 * nose). Heights in `y`, above the field. Corridors are tried in turn —
 * between the fuselage and the inboard engine (a wide-body's), outboard of
 * a narrow-body's engines, outboard of everything — and the first that
 * `clear()` passes is used; null if none does.
 */
function paxRoute(lay, tg, stair, bridges, clear, maxLat = Infinity) {
  const I = tg.info;
  const sill = Math.max(1.2, stair.sill != null ? stair.sill - (tg.oy - I.ground) : I.sill + I.ground);
  const doorZ = stair.doorZ != null ? stair.doorZ : I.frontDoorZ;
  const hw = I.hw;
  // The stair truck stands at local x = -(hw + 3.65); its flight runs from
  // x = -(hw + 2.05) at the platform to -(hw + 6.75) at the bed (1.25 m up).
  const head = [
    at(tg, -(hw + 0.5), doorZ, sill),
    at(tg, -(hw + 2.0), doorZ, sill),
    at(tg, -(hw + 6.7), doorZ, 1.25),
    at(tg, -(hw + 8.1), doorZ, 0),
    at(tg, -(hw + 8.1), doorZ - 2.6, 0),
  ];
  const term = lay.terminal && lay.terminal.rect ? lay.terminal : null;
  const F = lay.frame;
  const wAt = (q) => (q.z - F.cz) * F.side;
  const corridors = [];
  if (I.halfSpan > 24) corridors.push(-Math.max(hw + 3.6, Math.min(hw + 5.5, 0.33 * I.halfSpan - 2.2)));
  corridors.push(-Math.max(hw + 9.5, 0.4 * I.halfSpan + 3.5));
  corridors.push(-(I.halfSpan + 4));
  for (const cx of corridors) {
    if (Math.abs(cx) > maxLat) continue;
    const pts = head.slice();
    pts.push(at(tg, cx, doorZ - 2.6));
    pts.push(at(tg, cx, I.noseZ + 1));
    let end;
    if (term) {
      const a = at(tg, cx, I.noseZ + 1);
      const b = at(tg, cx, I.noseZ - 5);
      const k = (term.front - 0.6 - wAt(a)) / Math.max(1e-3, wAt(b) - wAt(a));
      end = at(tg, cx, I.noseZ + 1 - 6 * k);
      // A rotunda's column just there: the door is along the wall past it.
      for (const br of bridges) {
        if (!br || !br.rot) continue;
        const dx = end.x - br.rot.x;
        if (Math.abs(dx) < 5 && Math.abs(end.z - br.rot.z) < 8) end = { x: br.rot.x + Math.sign(dx || 1) * 5.5, y: 0, z: end.z };
      }
    } else {
      end = at(tg, cx, I.noseZ - 25);
    }
    pts.push(end);
    if (!clear || clear(pts)) return pts;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* The vehicles' loop                                                  */
/* ------------------------------------------------------------------ */

/** The kinds that drive the loop, in the order a tier adds them. */
export const VAN_KINDS = Object.freeze(['baggage', 'fuelTruck', 'bus', 'cateringTruck', 'baggage']);

/**
 * One loop of the apron for the service vehicles, where there is a terminal
 * with gates: along the airside road under the bridges (8 m off the
 * terminal's face, the lane the spare crew already drives), round the end
 * of the apron and back along its front, inside the follow-me van's lap,
 * the ends joined where a connector clears every stand. Every leg is
 * checked, 1.7 m either side, against the obstacles; if no loop is clear,
 * one vehicle runs up and down the airside road on its own, and if even
 * that is blocked there are none.
 */
function planVans(lay, obs, tier, rnd, why, level) {
  const n = Math.max(0, Math.round(VAN_CAP[tier] * Math.min(1, level)));
  if (!n) return [];
  const T = lay.terminal;
  if (!T || !lay.bridges || lay.military) {
    why.push('vans: no terminal with gates here');
    return [];
  }
  const F = lay.frame;
  const A = lay.apron;
  const half = 1.5;
  const wA = T.front - 8;
  // Inside the follow-me van's lap (w0 + 5 .. w0 + 13), clear of it.
  const wB = A.w0 + 18;
  const uA0 = Math.max(A.u0 + 6, T.u0 - 4);
  const uA1 = Math.min(A.u1 - 6, T.u1 + 4);
  const p = (u, w) => ({ x: F.x(u), y: 0, z: F.z(w) });
  const roadClear = segmentClear(obs, p(uA0, wA), p(uA1, wA), half);
  if (!roadClear) {
    // Shorten it from both ends until it clears, or give up.
    why.push('vans: the airside road is not clear end to end');
    return [];
  }
  // A connector at each end: scanned inward from the apron's end, the first that clears.
  const connector = (from, to, step) => {
    for (let u = from; step > 0 ? u <= to : u >= to; u += step) {
      if (segmentClear(obs, p(u, wA), p(u, wB), half)) return u;
    }
    return null;
  };
  const cL = connector(A.u0 + 5, uA0 + 40, 2);
  const cR = connector(A.u1 - 5, uA1 - 40, -2);
  let loop = null;
  if (cL != null && cR != null && cR - cL > 40) {
    const pts = [p(cL, wA), p(cR, wA), p(cR, wB), p(cL, wB)];
    // The front edge must clear too.
    if (routeClear(obs, pts, half, true)) loop = pts;
  }
  const kinds = VAN_KINDS.slice(0, n);
  if (!loop) {
    why.push('vans: no clear loop; one runs the airside road');
    return [{ kind: kinds[0], path: [p(uA0, wA), p(uA1, wA)], mode: 'pingpong', speed: 5.5, d0: 0 }];
  }
  const L = pathLength(loop) + dist(loop[loop.length - 1], loop[0]);
  return kinds.map((kind, i) => ({ kind, path: loop, mode: 'loop', speed: kind === 'bus' ? 6.5 : 5.5, d0: (L * i) / kinds.length + rnd() * 10 }));
}
