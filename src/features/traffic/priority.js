/**
 * YOUR RUNWAY — the tower giving you priority.
 *
 * The owner, on the AI traffic in Free Flight: "there's still NPCs flying, but
 * the runway is yours till you get off", and "if you're near the runway — you
 * decide — it's your own again". So the traffic flies about the island as it
 * always did, and this file decides, once a frame, whether a pilot — you, or
 * in a multiplayer game anybody in the lobby — has CLAIMED a runway, the way a
 * tower would see it:
 *
 *   runway   on it: lined up, rolling, rolling out, stopped on it, or a few
 *            metres over it (a wreck on it counts too). Taxied off it, the
 *            claim ends two seconds later.
 *   climb    just off it after a take-off, still low over the far end: until
 *            250 m above the ground, 2.5 km past the end, 900 m off to the
 *            side, or a minute — whichever comes first. Then the runway is
 *            the traffic's again (the owner's "till you get off").
 *   final    coming back, lined up with a runway (within 35 degrees of its
 *            heading, pointing at it), within 8 km of the threshold and the
 *            700 m either side of the centreline that widens with distance,
 *            and under a 3.4-degree cone plus 150 m — a sensible approach,
 *            not a jet passing high overhead on the same heading.
 *   circuit  in the circuit of the field AND showing you mean to land. The
 *            circuit is a real one: within 2 km of either end and 1.6 km
 *            abeam, under 450 m (about 1,500 ft), not climbing and not
 *            flying away. Meaning to land is any of: the wheels coming DOWN
 *            on an aeroplane that can put them up (down since take-off says
 *            nothing — a kid who never pressed G is not landing, any more
 *            than the trainer whose wheels never move), flaps out, the
 *            autopilot flying its approach, or a descent of a metre a second
 *            and more kept up for four seconds (a sign seen in the last 25 s
 *            still counts while you stay in the circuit). It lasts until
 *            1.2 km further out, 600 m up, or flying away for ten seconds. A
 *            helicopter never claims the runway's circuit: it is not flying
 *            one.
 *
 *            The first cut claimed the circuit for anybody low near the
 *            field — a box 3.5 km past the ends and 2.6 km abeam, which on
 *            Kestrel is nine tenths of the island. The review flew a lap of
 *            the island at 250 m: the runway was yours all fifteen minutes,
 *            nobody landed or took off, and a star hunt at 200 m got
 *            thirteen tower pop-ups. The second cut counted wheels down on
 *            a retractable as the sign, and a Courier whose wheels had
 *            never been up held the runway for the same lap. The owner: "if
 *            you're near the runway — you decide — it's your own again". You
 *            decide: the circuit is yours when you fly it like someone
 *            coming in, not when you fly past.
 *
 *            The traffic HOLDS for every circuit claim (the safe way round),
 *            but the tower SPEAKS of one (traffic.js priorityTalk) only for a
 *            deliberate sign — wheels, flaps, the autopilot. A descent alone
 *            holds the traffic quietly: a kid dipping to a star near the
 *            field is not told they are number one, and the aeroplane that
 *            waited for them is not announced as free again.
 *
 * Every claim holds for a few seconds after the thing that made it stops
 * being true, so a wobble at an edge does not flick the tower on and off.
 *
 * PARKED on a runway that is not 09/27 — stopped for half a minute, with a
 * wing's length and more between you and 09/27 — the claim stays (that
 * runway is still yours: nobody taxis up it or across it, R2) but it no
 * longer holds 09/27: take-offs and landings there go on past you, as the
 * traffic's own rules have it for Kestrel's 18/36 (traffic.js r2Parked:
 * "a child parked there saw nothing happen"). Move, and 09/27 waits again.
 *
 * What the traffic does with a claim (traffic.js): nobody lines up or takes
 * off while any pilot has a claim on the runway it uses (they hold short); an
 * arrival on approach goes round unless it would be landed, rolled out and
 * off the runway well before the pilot could need it (`etaFor` below — a
 * real tower's "number two, continue"), and arrivals still at the gate hold
 * there. One already lined up when you come back is told to go now: the
 * quickest way off a runway is to take off from it.
 *
 * Runways: 09/27 (AIRPORT.runway), the crosswind one (AIRPORT.runway2) and,
 * for the maps that grow more of them, AIRPORT.runway3 and any in an
 * AIRPORT.runways list — each { cx, cz, length, halfWidth, headingDeg }. A
 * claim on a runway that does not cross the traffic's own (a parallel strip)
 * does not stop the traffic; one that crosses it does.
 *
 * No THREE, no DOM: node runs it as it is (tests/features/traffic.priority.mjs).
 */

const DEG = Math.PI / 180;

/** The numbers, in one place. Metres, seconds, metres a second. */
export const PRIORITY = {
  // On it: this far outside the paved edge still counts, below this height.
  onMargin: 20,
  onAgl: 15,
  // Taxied clear: the claim ends this long after you are off it.
  offAfter: 2,
  // Climbing away: the claim ends at the first of these.
  climbAgl: 250,
  climbBeyond: 2500,
  climbAside: 900,
  climbMax: 60,
  // Final.
  finalHdgDeg: 35,
  finalDist: 8000,
  finalLat: 700,
  finalLatPerM: 0.012,
  finalAglBase: 150,
  finalSlope: 0.06,
  finalClimbMax: 6,
  // The circuit, entering and staying: a real one, past the ends and abeam.
  circAlong: 2000,
  circLat: 1600,
  circAgl: 450,
  circClimbMax: 2,
  circOutExtra: 1200,
  circOutAgl: 600,
  circAwaySecs: 10,
  // Meaning to land: a descent this fast (m/s) kept up this long counts; a sign seen this recently still counts while in the circuit.
  circDescent: 1,
  circDescentSecs: 4,
  circIntentHold: 25,
  // Any claim stays this long after it stops being true.
  linger: 6,
  // Parked on a runway other than 09/27: stopped (slower than this) for this long, this far from 09/27's edge plus a wing.
  parkSpeed: 0.7,
  parkSecs: 30,
  parkClear: 35,
};

const KIND_RANK = { runway: 4, final: 3, circuit: 2, climb: 1 };

function name2(deg) {
  const n = Math.round((((deg % 360) + 360) % 360) / 10) || 36;
  return String(n).padStart(2, '0');
}

function mk(id, r, headingDeg) {
  const h = headingDeg * DEG;
  // A runway's own heading is one of its two ends; along the other axis for an east-west one.
  return {
    id,
    cx: r.cx,
    cz: r.cz,
    ux: Math.sin(h),
    uz: -Math.cos(h),
    half: r.length / 2,
    hw: r.halfWidth,
    headingDeg,
    name: `${name2(headingDeg)}/${name2(headingDeg + 180)}`,
    ends: [name2(headingDeg), name2(headingDeg + 180)],
  };
}

/**
 * Every runway on this map, the traffic's own (09/27) first. `airport` is
 * terrain.js's AIRPORT. Extra runways are taken from `runway3` and from a
 * `runways` list, skipping any that repeat one already here.
 */
export function runwayList(airport) {
  const out = [];
  if (!airport || !airport.runway) return out;
  out.push(mk('main', airport.runway, airport.headingDeg ?? 90));
  const more = [];
  if (airport.runway2) more.push(['r2', airport.runway2]);
  if (airport.runway3) more.push(['r3', airport.runway3]);
  if (Array.isArray(airport.runways)) airport.runways.forEach((r, i) => more.push([`rw${i}`, r]));
  for (const [id, r] of more) {
    if (!r || !Number.isFinite(r.cx) || !Number.isFinite(r.cz) || !(r.length > 0)) continue;
    const h = r.headingDeg ?? 180;
    const same = out.some((o) => Math.abs(o.cx - r.cx) < 5 && Math.abs(o.cz - r.cz) < 5 && Math.abs(Math.sin((o.headingDeg - h) * DEG)) < 0.05);
    if (!same) out.push(mk(id, { halfWidth: 15, ...r }, h));
  }
  // Which runways cross the traffic's own (09/27): a claim on one of those stops the traffic too.
  const m = out[0];
  for (const r of out) r.crossesMain = r === m || crosses(r, m);
  return out;
}

/** Do two runway strips overlap anywhere (a crossing, or one on top of the other)? */
export function crosses(a, b) {
  // Separating axis on the two rectangles.
  const axes = [[a.ux, a.uz], [-a.uz, a.ux], [b.ux, b.uz], [-b.uz, b.ux]];
  const corners = (r) => {
    const px = -r.uz;
    const pz = r.ux;
    const out = [];
    for (const s of [-1, 1]) for (const t of [-1, 1]) out.push([r.cx + r.ux * r.half * s + px * r.hw * t, r.cz + r.uz * r.half * s + pz * r.hw * t]);
    return out;
  };
  const ca = corners(a);
  const cb = corners(b);
  for (const [ax, az] of axes) {
    let a0 = Infinity;
    let a1 = -Infinity;
    let b0 = Infinity;
    let b1 = -Infinity;
    for (const [x, z] of ca) {
      const d = x * ax + z * az;
      a0 = Math.min(a0, d);
      a1 = Math.max(a1, d);
    }
    for (const [x, z] of cb) {
      const d = x * ax + z * az;
      b0 = Math.min(b0, d);
      b1 = Math.max(b1, d);
    }
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}

/**
 * A pilot as this file reads one. The last five are the signs of landing the
 * circuit claim wants (see the header): a rotor instead of wings, whether the
 * wheels can come up and whether they are down, the flap step out, and the
 * autopilot flying its approach.
 */
export function blankPilot() {
  return { x: 0, y: 0, z: 0, agl: 0, onGround: true, crashed: false, hdgDeg: 90, vx: 0, vy: 0, vz: 0, gs: 0, rotor: false, retractable: false, gearDown: true, flaps: 0, apApproach: false };
}

/**
 * One pilot's claim, carried from frame to frame. `episodeAt` is when this
 * episode began, `descSince` when the present descent began (null level or
 * climbing), `gearWasUp` whether the wheels have been up this flight (so
 * down now means they came down — the sign; cleared on the ground),
 * `intentAt` the last time a sign of landing was seen, and `deliberate`
 * whether this episode has had a wheels/flaps/autopilot sign — the only
 * circuit claims the tower speaks of.
 */
export function newClaim() {
  return {
    kind: null, rw: null, since: 0, lastTrue: -Infinity, awaySince: null, eta: Infinity, episode: 0, episodeAt: -Infinity, offSince: null, x: 0, z: 0, hdgDeg: 0, stillSince: null, parkedOff: false,
    descSince: null, gearWasUp: false, intentAt: -Infinity, deliberate: false,
  };
}

/**
 * The deliberate signs a pilot means to land: the wheels come down on an
 * aeroplane that can put them up (`cl.gearWasUp` remembers they were up this
 * flight — down since take-off is no sign), flaps out, or the autopilot
 * flying its approach.
 */
export function landingSigns(p, cl) {
  return !!((p.retractable && p.gearDown && cl && cl.gearWasUp) || p.flaps > 0 || p.apApproach);
}

/** Where a pilot is relative to runway r: along it, across it, and how their nose lines up. */
function frame(r, p) {
  const rx = p.x - r.cx;
  const rz = p.z - r.cz;
  const a = rx * r.ux + rz * r.uz;
  const b = -rx * r.uz + rz * r.ux;
  const h = p.hdgDeg * DEG;
  const along = Math.sin(h) * r.ux - Math.cos(h) * r.uz;
  return { a, b, along };
}

function onRunway(r, p, f) {
  const P = PRIORITY;
  return Math.abs(f.a) <= r.half + P.onMargin && Math.abs(f.b) <= r.hw + P.onMargin && (p.onGround || p.crashed || p.agl < P.onAgl);
}

/** Distance to the threshold a pilot lined up with r is flying at (negative once over the runway), or null if not lined up. */
function toThreshold(r, p, f) {
  const lim = Math.cos(PRIORITY.finalHdgDeg * DEG);
  if (f.along > lim) return -r.half - f.a;
  if (f.along < -lim) return f.a - r.half;
  return null;
}

function isFinal(r, p, f) {
  const P = PRIORITY;
  if (p.onGround || p.crashed) return null;
  const d = toThreshold(r, p, f);
  if (d == null || d > P.finalDist || d < -r.half * 1.6) return null;
  const dd = Math.max(0, d);
  if (Math.abs(f.b) > P.finalLat + dd * P.finalLatPerM) return null;
  if (p.agl > P.finalAglBase + dd * P.finalSlope) return null;
  if (p.vy > P.finalClimbMax) return null;
  return d;
}

/** Flying away from the field: the way they are going points more than 110 degrees from the way to it. */
function flyingAway(r, p) {
  const tx = r.cx - p.x;
  const tz = r.cz - p.z;
  const d = Math.hypot(tx, tz);
  const v = Math.hypot(p.vx, p.vz);
  if (d < r.half || v < 5) return false;
  return (p.vx * tx + p.vz * tz) / (d * v) < Math.cos(110 * DEG);
}

/**
 * Work out a pilot's claim this frame (mutates and returns `cl`). `t` is a
 * clock in seconds. `rws` is runwayList(). The circuit is the traffic's own
 * runway's (rws[0]): the field's circuit, whichever strip you then land on.
 */
export function updateClaim(cl, p, rws, t) {
  const P = PRIORITY;
  if (!p || !rws.length) return endClaim(cl);
  // Where they are, for whoever asks which side of an aeroplane they are on.
  cl.x = p.x;
  cl.z = p.z;
  cl.hdgDeg = p.hdgDeg;
  let kind = null;
  let rw = null;
  let eta = Infinity;
  // How long they have been coming down (a sign of landing, for the circuit): kept up whatever the claim.
  if (!p.onGround && p.vy <= -P.circDescent) {
    if (cl.descSince == null) cl.descSince = t;
  } else cl.descSince = null;
  // Whether the wheels have been up this flight: down after that is the sign. A new flight (on the ground) forgets.
  if (p.onGround) cl.gearWasUp = false;
  else if (p.retractable && !p.gearDown) cl.gearWasUp = true;
  // On a runway: the strongest claim there is.
  for (const r of rws) {
    const f = frame(r, p);
    if (onRunway(r, p, f)) {
      kind = 'runway';
      rw = r;
      eta = 0;
      break;
    }
  }
  if (!kind && !p.onGround && !p.crashed) {
    // Just off the runway after a take-off: climbing away over it.
    if ((cl.kind === 'runway' || cl.kind === 'climb') && cl.rw) {
      const r = cl.rw;
      const f = frame(r, p);
      const beyond = Math.abs(f.a) - r.half;
      if (p.agl < P.climbAgl && beyond < P.climbBeyond && Math.abs(f.b) < P.climbAside && (cl.kind === 'runway' || t - cl.since < P.climbMax)) {
        kind = 'climb';
        rw = r;
      }
    }
    // Lined up with a runway, low enough to be landing on it.
    if (!kind) {
      let best = Infinity;
      for (const r of rws) {
        const f = frame(r, p);
        const d = isFinal(r, p, f);
        if (d != null && d < best) {
          best = d;
          kind = 'final';
          rw = r;
          eta = Math.max(0, d) / Math.max(p.gs, 25);
        }
      }
    }
    // In the circuit, not leaving it, and meaning to land (see the header). Not a helicopter: it flies no circuit of the runway.
    if (!kind && !p.rotor) {
      const r = rws[0];
      const f = frame(r, p);
      const staying = cl.kind === 'circuit';
      const along = Math.abs(f.a) - r.half;
      const inBox = along < P.circAlong + (staying ? P.circOutExtra : 0) && Math.abs(f.b) < P.circLat + (staying ? P.circOutExtra : 0);
      const low = p.agl < (staying ? P.circOutAgl : P.circAgl);
      const away = flyingAway(r, p);
      if (away) {
        if (cl.awaySince == null) cl.awaySince = t;
      } else cl.awaySince = null;
      // Flying away: never a reason to start a claim; one already in the circuit lasts ten seconds of it.
      const awayLong = cl.awaySince != null && (!staying || t - cl.awaySince > P.circAwaySecs);
      // Meaning to land: wheels, flaps or the approach autopilot now, a descent kept up long enough, or either seen lately while in the circuit.
      const deliberate = landingSigns(p, cl);
      const descending = cl.descSince != null && t - cl.descSince >= P.circDescentSecs;
      if (deliberate || descending) cl.intentAt = t;
      const intent = deliberate || descending || (staying && t - cl.intentAt < P.circIntentHold);
      if (inBox && low && !awayLong && intent && (staying || p.vy < P.circClimbMax)) {
        kind = 'circuit';
        rw = r;
        // Round the circuit to the nearer end: half as far again as straight there.
        const dEnd = Math.min(Math.hypot(f.a - r.half, f.b), Math.hypot(f.a + r.half, f.b));
        eta = Math.max(30, (dEnd * 1.5) / Math.max(p.gs, 25));
      }
    }
  }
  // Parked on a runway that is not the traffic's own, clear of it (see the header): it stops holding 09/27.
  if (kind === 'runway' && rw !== rws[0] && p.onGround && !p.crashed && p.gs < P.parkSpeed) {
    if (cl.stillSince == null || cl.kind !== 'runway') cl.stillSince = t;
    const m = rws[0];
    const f0 = frame(m, p);
    const clear = Math.abs(f0.a) > m.half + P.parkClear + (p.halfSpan || 6) || Math.abs(f0.b) > m.hw + P.parkClear + (p.halfSpan || 6);
    cl.parkedOff = clear && t - cl.stillSince > P.parkSecs;
  } else {
    cl.stillSince = null;
    cl.parkedOff = false;
  }
  if (kind) {
    // A new claim, or a stronger one: from now. The same or weaker: carried on.
    if (!cl.kind) {
      cl.episode++;
      cl.episodeAt = t;
      cl.since = t;
      cl.deliberate = false;
    } else if (kind !== cl.kind) cl.since = t;
    if (landingSigns(p, cl)) cl.deliberate = true;
    cl.kind = kind;
    cl.rw = rw;
    cl.eta = eta;
    cl.lastTrue = t;
    cl.offSince = null;
    return cl;
  }
  if (!cl.kind) return cl;
  // Nothing claims it now. Taxied off a runway: two seconds. Anything else: the linger.
  if (cl.kind === 'runway' && p.onGround) {
    if (cl.offSince == null) cl.offSince = t;
    if (t - cl.offSince >= P.offAfter) return endClaim(cl);
    return cl;
  }
  if (cl.kind === 'runway' && !p.onGround) {
    // Off the end in the air without meeting the climb's tests (straight up past 250 m, say): gone.
    return endClaim(cl);
  }
  if (t - cl.lastTrue >= P.linger) return endClaim(cl);
  return cl;
}

function endClaim(cl) {
  cl.stillSince = null;
  cl.parkedOff = false;
  cl.kind = null;
  cl.rw = null;
  cl.eta = Infinity;
  cl.offSince = null;
  cl.awaySince = null;
  // (descSince is kept: the descent is a fact about the aeroplane, not the claim.)
  cl.intentAt = -Infinity;
  cl.deliberate = false;
  return cl;
}

/** Does this claim keep the traffic off its runway (09/27)? */
export function blocksMain(cl) {
  return !!(cl && cl.kind && cl.rw && cl.rw.crossesMain && !cl.parkedOff);
}

/** Stronger of two claims (for the one the tower talks about): on it, then final, circuit, climb; then the sooner. */
export function stronger(a, b) {
  if (!a || !a.kind) return b && b.kind ? b : null;
  if (!b || !b.kind) return a;
  const ra = KIND_RANK[a.kind];
  const rb = KIND_RANK[b.kind];
  if (ra !== rb) return ra > rb ? a : b;
  return a.eta <= b.eta ? a : b;
}

/**
 * Seconds before a pilot with this claim could need the runway: 0 on it, the
 * time to the threshold on final, round the circuit in it, never climbing
 * away. An arrival lands only if it is down, rolled out and off well before.
 */
export function etaFor(cl) {
  if (!cl || !cl.kind) return Infinity;
  if (cl.kind === 'climb') return Infinity;
  return cl.eta;
}

/** Read the player's aeroplane (main.js's Aircraft) into a pilot. */
export function pilotFromAircraft(ac, out = blankPilot(), elev = 0) {
  if (!ac || !ac.pos) return null;
  out.x = ac.pos.x;
  out.y = ac.pos.y;
  out.z = ac.pos.z;
  out.agl = ac.agl != null ? ac.agl : ac.pos.y - elev;
  out.onGround = !!ac.onGround;
  out.crashed = !!ac.crashed;
  out.hdgDeg = ac.heading ?? 90;
  const v = ac.vel;
  out.vx = v ? v.x : 0;
  out.vy = v ? v.y : 0;
  out.vz = v ? v.z : 0;
  out.gs = v ? Math.hypot(v.x, v.z) : Math.abs(ac.groundSpeed || 0);
  // The wheels and the flaps: signs of landing (the circuit claim). Whether the wheels CAN come up is the type's (pilotIntent).
  out.gearDown = ac.gearDown !== false;
  out.flaps = typeof ac.flapStep === 'function' ? ac.flapStep() : Math.round((ac.flaps || 0) * 3);
  return out;
}

/**
 * What the aeroplane's type and the autopilot add to a pilot: a rotor instead
 * of wings (no circuit claim), whether the wheels can come up (down on one
 * that can is a sign of landing; a trainer's are always down and say
 * nothing), and whether the autopilot is flying its approach. `type` is
 * types.js's entry (sim.aircraftType), `ap` main.js's Autopilot; either may be
 * missing.
 */
export function pilotIntent(out, type, ap) {
  if (!out) return out;
  const sh = type && type.shape;
  out.rotor = !!(sh && sh.power && sh.power.rotor);
  out.retractable = !!(sh && sh.retractable);
  out.apApproach = !!(ap && ap.engaged && ap.mode === 'approach');
  return out;
}
