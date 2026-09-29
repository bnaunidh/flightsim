/**
 * The cockpit warning system's rules — when each alert comes on, and off.
 *
 * Pure: no DOM, no audio, no three.js, no game object. It is handed one plain
 * READING a frame (numbers in feet, knots and feet per minute, because every
 * threshold below is written the way a real one is published) and it keeps its
 * own state. src/features/warnings.js builds the reading from the game, plays
 * what this decides and draws the panel. The node tests drive this file
 * directly with made-up readings, which is how "fires in its condition and not
 * in the normal circuit" is checked without a browser.
 *
 * THE RULE THAT MATTERS MOST: NEVER NAG.
 *
 *   - Every condition has an ON threshold and a looser OFF threshold, and has
 *     to hold for a moment before it counts, so nothing flickers at an edge.
 *   - Nothing fires on the ground, and the ground-proximity modes stand down
 *     below 30 ft, so a normal flare and touchdown are silent.
 *   - Once you have acknowledged an alert (R, or tap a light) it stops making
 *     noise. It stays lit until the condition has gone.
 *   - An alert that has cleared must stay cleared for a while before it can
 *     sound again — a bank angle wobbling around 45 degrees is one warning,
 *     not ten.
 */

/* ------------------------------------------------------------------ */
/* The alerts                                                          */
/* ------------------------------------------------------------------ */

/**
 * level     'warning' (red, master WARNING) | 'caution' (amber, master
 *           CAUTION) | 'advisory' (white, no master light, no sound)
 * sound     the Alerts method to play, or null when something else already
 *           makes the noise (the stall horn, the clacker, the low-fuel tone)
 * repeat    seconds between repeats while unacknowledged; 0 = once
 * say       words for sim.speak — only used when the player chose a voice
 * prio      who gets the one aural channel when two want it at once
 * on / off  seconds the condition must hold before it switches on / off
 * cmd       shown big in the middle of the screen while active
 * rearm     seconds after clearing before it may sound again
 */
export const DEFS = {
  pullup: { level: 'warning', title: 'PULL UP', hint: 'Nose up and full power — the ground is close!', sound: 'gpwsWarning', repeat: 1.2, say: 'Pull up', prio: 100, on: 0.4, off: 1.0, cmd: true },
  windshear: { level: 'warning', title: 'WINDSHEAR', hint: 'Full power and hold the nose up — fly out of it', sound: 'windshear', repeat: 4, say: 'Windshear, windshear, windshear', prio: 98, on: 0.5, off: 2.5, cmd: true },
  terrain: { level: 'warning', title: 'TERRAIN', hint: 'High ground straight ahead — climb now!', sound: 'gpwsWarning', repeat: 2.4, say: 'Terrain ahead, pull up', prio: 96, on: 0.3, off: 1.5, cmd: true },
  tcasRA: { level: 'warning', title: 'CLIMB', hint: 'Another aircraft is close — climb now', sound: 'tcasResolution', repeat: 3.5, say: 'Climb, climb', prio: 90, on: 0.3, off: 2.0, cmd: true },
  stall: { level: 'warning', title: 'STALL', hint: 'Nose down and add power', sound: null, prio: 88, on: 0.2, off: 0.6 },
  gear: { level: 'warning', title: 'GEAR NOT DOWN', hint: 'Put the wheels down — {gear}', sound: 'gpwsCaution', repeat: 0, say: 'Too low, gear', prio: 84, on: 0.6, off: 1.0 },
  engineFire: { level: 'warning', title: 'ENGINE FIRE', hint: '{Ack} to pull the fire handle', sound: 'fireBell', repeat: 2.2, say: 'Engine fire', prio: 86, on: 0, off: 0 },
  engineFail: { level: 'warning', title: 'ENGINE FAIL', hint: 'Keep your speed up and glide to somewhere flat', sound: 'masterWarning', repeat: 0, say: 'Engine failure', prio: 80, on: 0.3, off: 1.0 },
  overspeed: { level: 'warning', title: 'OVERSPEED', hint: 'Too fast — power off and raise the nose', sound: null, prio: 78, on: 0.3, off: 1.0 },
  terrainAhead: { level: 'caution', title: 'TERRAIN AHEAD', hint: 'Hills in front — climb or turn away', sound: 'gpwsCaution', repeat: 5, say: 'Caution, terrain', prio: 72, on: 0.5, off: 2.0, rearm: 6 },
  sinkrate: { level: 'caution', title: 'SINK RATE', hint: 'Coming down too fast — raise the nose a little', sound: 'gpwsCaution', repeat: 2.5, say: 'Sink rate', prio: 70, on: 0.6, off: 1.0, rearm: 3 },
  dontsink: { level: 'caution', title: "DON'T SINK", hint: 'Keep climbing after take-off', sound: 'gpwsCaution', repeat: 2.5, say: "Don't sink", prio: 68, on: 0.8, off: 1.0, rearm: 4 },
  flaps: { level: 'caution', title: 'TOO LOW — FLAPS', hint: 'Put the flaps down for landing — {flaps}', sound: 'gpwsCaution', repeat: 0, say: 'Too low, flaps', prio: 66, on: 0.8, off: 1.0, rearm: 8 },
  bankangle: { level: 'caution', title: 'BANK ANGLE', hint: 'Too steep — level the wings', sound: 'bankAngle', repeat: 4, say: 'Bank angle, bank angle', prio: 64, on: 0.5, off: 1.0, rearm: 8 },
  tcasTA: { level: 'caution', title: 'TRAFFIC', hint: 'Another aircraft nearby — look out for it', sound: 'tcasTraffic', repeat: 0, say: 'Traffic, traffic', prio: 60, on: 0.3, off: 3.0, rearm: 8 },
  engineOff: { level: 'caution', title: 'ENGINE OFF', hint: '{Starter} to start it again', sound: 'masterCaution', repeat: 0, prio: 56, on: 0.5, off: 0.5 },
  engineRough: { level: 'caution', title: 'ENGINE ROUGH', hint: 'Only part power left — land soon', sound: 'masterCaution', repeat: 0, prio: 54, on: 0.3, off: 1.0 },
  shoal: { level: 'caution', title: 'SHALLOW WATER', hint: 'Shallow ahead — slow down, steer for the dark blue', sound: 'masterCaution', repeat: 0, prio: 52, on: 0.6, off: 2.0, rearm: 10 },
  lowFuel: { level: 'caution', title: 'LOW FUEL', hint: 'Head back to the airfield and land', sound: null, prio: 50, on: 0.5, off: 2.0 },
  fuelLeak: { level: 'caution', title: 'FUEL LEAK', hint: 'You are losing fuel fast — land soon', sound: 'masterCaution', repeat: 0, prio: 48, on: 0.3, off: 1.0 },
  apOff: { level: 'caution', title: 'AUTOPILOT OFF', hint: 'You are flying the plane now', sound: 'autopilotOff', repeat: 0, prio: 46, on: 0, off: 0 },
  fireOut: { level: 'advisory', title: 'FIRE OUT', hint: 'The fire is out — the engine is on part power', sound: null, prio: 10, on: 0, off: 0 },
};

/** Highest priority first — the order the panel lists them in. */
export const ORDER = Object.keys(DEFS).sort((a, b) => DEFS[b].prio - DEFS[a].prio);

/** The ground-proximity messages, most urgent first; only one is ever lit. */
const GP_FAMILY = ['pullup', 'terrain', 'terrainAhead', 'sinkrate', 'dontsink'];

/** Roughly how long each sound lasts, so the aural channel is not double-booked. */
export const SOUND_SECONDS = {
  gpwsWarning: 0.8,
  gpwsCaution: 0.35,
  bankAngle: 0.3,
  windshear: 1.0,
  fireBell: 0.9,
  masterWarning: 0.7,
  masterCaution: 0.5,
  tcasTraffic: 0.35,
  tcasResolution: 0.5,
  tcasClear: 0.4,
  radioAltitude: 0.3,
  autopilotOff: 1.1,
};

/** The radio altitude callouts, in feet, highest first. */
export const CALLOUTS = [100, 50, 40, 30, 20, 10];
const CALLOUT_WORDS = { 100: 'One hundred', 50: 'Fifty', 40: 'Forty', 30: 'Thirty', 20: 'Twenty', 10: 'Ten' };

/* ------------------------------------------------------------------ */
/* Envelopes                                                           */
/* ------------------------------------------------------------------ */

/*
 * GPWS mode 1, excessive descent rate. Descent in ft/min against radio
 * altitude in feet, 50 to 2,450 ft — the published envelope's shape with the
 * floor lifted, because a ten-year-old's approach is steeper than an airline
 * crew's and a warning on every one of them is a warning nobody hears.
 *
 * Measured against a normal approach flown by the controller in the browser
 * checks: 600–800 ft/min on the glide, never more than 1,000 below 300 ft.
 * SINK RATE at 50 ft is 1,270; at 300 ft, 1,620.
 */
export function sinkRateLimit(aglFt, heli = false) {
  return (1200 + 1.4 * aglFt) * (heli ? 1.5 : 1);
}
export function pullUpLimit(aglFt, heli = false) {
  return (1800 + 2.4 * aglFt) * (heli ? 1.5 : 1);
}

/** Bank angle limits by kind of aircraft: [on, off] in degrees. */
export function bankLimits(category, aglFt) {
  if (category === 'helicopter') return [50, 42];
  if (category === 'airliner') return [35, 30];
  if (category === 'military') return aglFt < 1000 ? [60, 52] : null; // aerobatics above 1,000 ft are the point
  return [45, 38];
}

/* ------------------------------------------------------------------ */
/* TCAS                                                                */
/* ------------------------------------------------------------------ */

/**
 * Traffic advisories and resolution advisories from sim.traffic.
 *
 * The contract (see the brief) is `{ id, typeId, pos, heading, speed, alt,
 * onGround, phase }`. Only `pos` is trusted here: velocity is worked out from
 * how far each one moved since last frame, so it does not matter what units
 * somebody else chose for `speed` or whether `heading` is degrees. Entries
 * without a `phase` are not traffic in the contract's sense — they are the
 * escort that formates on you during a mayday, or the interceptors in a chase
 * mission — and TCAS leaves them alone (they are still drawn on the map),
 * unless they carry `tcas: true`.
 *
 * Thresholds are the real ones scaled down to an island: a real TA looks
 * 35-48 s ahead over tens of miles; this looks 35 s ahead over a couple of
 * kilometres, which at 60 m/s is the same picture.
 *
 *   TA  closing within 35 s (or inside 450 m), missing by under 1,100 m,
 *       within 850 ft vertically now or at closest approach. Not below 400 ft
 *       above the ground, where everybody is using the same runway.
 *   RA  closing within 22 s (or inside 250 m), missing by under 450 m,
 *       within 600 ft at closest approach. Not below 1,000 ft above the
 *       ground, and never "descend" below 1,500 ft — real TCAS inhibits both,
 *       for the obvious reason.
 *
 * `mem` is a Map the caller keeps; `out` is reused. No allocation per frame
 * except a Map entry the first time an aircraft is seen.
 */
export function tcasAssess(own, list, mem, dt, t, out) {
  out.level = 0;
  out.sense = null;
  out.nearest = Infinity;
  out.levels.clear();
  const n = list ? list.length : 0;
  const k = Math.min(1, dt / 0.5);
  for (let i = 0; i < n; i++) {
    const e = list[i];
    if (!e || !e.pos) continue;
    const key = e.id != null ? e.id : e;
    let m = mem.get(key);
    if (!m) {
      m = { x: e.pos.x, y: e.pos.y, z: e.pos.z, vx: 0, vy: 0, vz: 0, n: 0, seen: t };
      mem.set(key, m);
    } else if (dt > 0) {
      const ix = (e.pos.x - m.x) / dt;
      const iy = (e.pos.y - m.y) / dt;
      const iz = (e.pos.z - m.z) / dt;
      // A teleport (a respawn, a new circuit) is not a velocity.
      if (Math.abs(ix) < 600 && Math.abs(iy) < 200 && Math.abs(iz) < 600) {
        const kk = m.n < 2 ? 1 : k;
        m.vx += (ix - m.vx) * kk;
        m.vy += (iy - m.vy) * kk;
        m.vz += (iz - m.vz) * kk;
        m.n++;
      }
      m.x = e.pos.x;
      m.y = e.pos.y;
      m.z = e.pos.z;
    }
    m.seen = t;
    if (!own || !own.airborne) continue;
    /*
     * Nothing below 400 ft above the ground: real TCAS stops calling traffic
     * at about 500 ft, because down there every other aircraft is taking off
     * from or landing on the same runway you are, and "TRAFFIC" each time
     * one goes past on the circuit — with the traffic team's aircraft now
     * using it — is exactly the nagging this panel must not do.
     */
    if (!(own.aglFt >= 400)) continue;
    if (e.onGround) continue;
    if (!(typeof e.phase === 'string' || e.tcas === true)) continue;
    if (m.n < 2) continue; // no velocity yet

    const rx = m.x - own.x;
    const rz = m.z - own.z;
    const dy = m.y - own.y;
    const R = Math.hypot(rx, rz);
    if (R < out.nearest) out.nearest = R;
    if (R > 6000) continue;
    const vrx = m.vx - own.vx;
    const vrz = m.vz - own.vz;
    const vr2 = vrx * vrx + vrz * vrz;
    const dot = rx * vrx + rz * vrz;
    const closing = R > 1 ? -dot / R : 0;
    const tau = closing > 0.5 ? Math.max(0, (R - 150) / closing) : Infinity;
    const tCpa = vr2 > 1e-3 ? Math.min(60, Math.max(0, -dot / vr2)) : 0;
    const miss = Math.hypot(rx + vrx * tCpa, rz + vrz * tCpa);
    const dyCpa = dy + (m.vy - own.vy) * tCpa;

    let lvl = 0;
    const vClose = Math.abs(dy) < 260 || Math.abs(dyCpa) < 260;
    if ((tau < 35 || R < 450) && miss < 1100 && vClose) lvl = 1;
    if (
      lvl === 1 &&
      own.canRA &&
      own.aglFt > 1000 &&
      (tau < 22 || R < 250) &&
      miss < 450 &&
      Math.abs(dyCpa) < 180
    ) {
      // Which way? Away from where it will be.
      const sense = -dyCpa >= 0 ? 'climb' : 'descend';
      if (sense === 'descend' && own.aglFt < 1500) lvl = 1; // not towards the ground
      else {
        lvl = 2;
        if (out.level < 2) out.sense = sense;
      }
    }
    /*
     * Keyed by the aircraft's id where it has one, like `mem` above, not by
     * the entry object. The minimap reads these a frame later (it draws
     * before the extensions update), and a traffic feed that builds new entry
     * objects every frame would otherwise never find its intruder in here —
     * no amber, no red, on the one map that is meant to show it.
     */
    if (lvl > 0) out.levels.set(key, lvl);
    if (lvl > out.level) out.level = lvl;
  }
  // Forget aircraft not seen for five seconds.
  if (mem.size > n + 8) {
    for (const [key, m] of mem) if (t - m.seen > 5) mem.delete(key);
  }
  return out;
}

export function createTcasOut() {
  return { level: 0, sense: null, nearest: Infinity, levels: new Map() };
}

/** What `tcasAssess` said about one traffic entry: 0, 1 (TRAFFIC) or 2 (CLIMB/DESCEND). */
export function tcasLevelOf(out, e) {
  if (!e || !out) return 0;
  return out.levels.get(e.id != null ? e.id : e) || 0;
}

/* ------------------------------------------------------------------ */
/* The engine                                                          */
/* ------------------------------------------------------------------ */

export function createEngine() {
  const alerts = {};
  for (const id of ORDER) {
    alerts[id] = { on: false, tOn: 0, tOff: 0, acked: false, since: 0, next: 0, offAt: -1e9, played: false, until: 0 };
  }
  return {
    t: 0,
    alerts,
    events: [],
    play: null,
    say: null,
    busyUntil: 0,
    // Take-off: from lift-off to 1,000 ft or two minutes, for DON'T SINK.
    takeoff: { on: false, t: 0, maxAlt: 0, wasAirborne: false, liftoffAgl: 0 },
    callout: { armed: 0, lastAgl: 0, shown: null, shownT: 0 },
    tcasSense: null,
    raWasOn: false,
    stallWas: false,
    lastRaSense: null,
  };
}

/** Put everything out — a new flight, back to the menu, into a boat. */
export function resetEngine(E) {
  for (const id of ORDER) {
    const s = E.alerts[id];
    s.on = false;
    s.tOn = 0;
    s.tOff = 0;
    s.acked = false;
    s.next = 0;
    s.offAt = -1e9;
    s.played = false;
    s.until = 0;
  }
  E.events.length = 0;
  E.play = null;
  E.say = null;
  E.busyUntil = 0;
  E.takeoff.on = false;
  E.takeoff.wasAirborne = false;
  E.callout.armed = 0;
  E.callout.shown = null;
  E.tcasSense = null;
  E.raWasOn = false;
  E.stallWas = false;
}

/** Acknowledge everything that is lit. Returns how many were silenced. */
export function acknowledge(E) {
  let n = 0;
  for (const id of ORDER) {
    const s = E.alerts[id];
    if (s.on && !s.acked) {
      s.acked = true;
      n++;
    }
  }
  return n;
}

function drive(E, id, want, dt) {
  const s = E.alerts[id];
  const d = DEFS[id];
  if (want) {
    s.tOn += dt;
    s.tOff = 0;
  } else {
    s.tOff += dt;
    s.tOn = 0;
  }
  if (!s.on && want && s.tOn >= d.on) {
    s.on = true;
    s.since = E.t;
    // Re-arm: back within `rearm` seconds of clearing, it is the same event —
    // lit again, but it keeps whatever acknowledgement it had and does not
    // sound again.
    const quick = E.t - s.offAt < (d.rearm || 0);
    if (!quick) {
      s.acked = false;
      s.played = false;
      s.next = E.t;
    } else {
      s.next = s.played ? Infinity : E.t;
    }
    E.events.push({ type: 'on', id });
  } else if (s.on && !want && s.tOff >= d.off) {
    s.on = false;
    s.offAt = E.t;
    E.events.push({ type: 'off', id });
  }
}

/** Put one out now, because something that says the same thing louder is on. */
function quench(E, id) {
  const s = E.alerts[id];
  if (!s.on) return;
  s.on = false;
  s.offAt = E.t;
  s.tOn = 0;
  E.events.push({ type: 'off', id });
}

/**
 * One frame. `r` is the reading (see warnings.js, `reading()`), `dt` seconds.
 * Returns E; what to do this frame is in E.events, E.play and E.say.
 */
export function evaluate(E, r, dt) {
  E.t += dt;
  E.events.length = 0;
  E.play = null;
  E.say = null;
  const plane = r.kind === 'plane';
  const heli = r.kind === 'heli';
  const boat = r.kind === 'boat';
  const flying = (plane || heli) && r.airborne && !r.crashed;
  // A declared emergency (its own script owns the sound), or the panel dead
  // after a lightning strike (see warnings.js, reading()). The lights still
  // track the conditions underneath, so they are right the moment it is back.
  const inhibit = !!r.inhibit || !!r.blackout;
  const agl = r.aglFt;
  const vs = r.vsFpm;
  const descent = -vs;
  const A = E.alerts;

  /* ---- take-off phase -------------------------------------------- */
  const tk = E.takeoff;
  if (flying && !tk.wasAirborne && plane && r.iasKt > 20 && agl < 100) {
    tk.on = true;
    tk.t = 0;
    tk.maxAlt = r.altFt;
  }
  tk.wasAirborne = (plane || heli) && r.airborne && !r.crashed;
  if (tk.on) {
    tk.t += dt;
    if (r.altFt > tk.maxAlt) tk.maxAlt = r.altFt;
    if (!flying || agl > 1000 || tk.t > 120) tk.on = false;
  }

  /* ---- GPWS ------------------------------------------------------ */
  const gpws = flying && agl >= 30 && agl <= 2450;
  // Mode 1: excessive descent rate.
  const pull1 = gpws && descent > pullUpLimit(agl, heli) - (A.pullup.on ? 300 : 0);
  const sink = gpws && descent > sinkRateLimit(agl, heli) - (A.sinkrate.on ? 250 : 0);
  // Terrain ahead, from the look-ahead the glue ran.
  const tS = r.terrainS;
  const terrWarn = flying && agl >= 30 && tS <= (A.terrain.on ? 20 : 15);
  const terrCaut = flying && agl >= 30 && tS <= (A.terrainAhead.on ? 36 : 30);
  // A terrain warning that has been ignored for three seconds becomes PULL UP,
  // and stays PULL UP for as long as the ground is still in the way.
  const pullTerr = terrWarn && (A.pullup.on || (A.terrain.on && E.t - A.terrain.since > 3));
  /*
   * One ground-proximity message at a time, most urgent first: PULL UP, then
   * TERRAIN, TERRAIN AHEAD, SINK RATE, DON'T SINK. A worse one replaces the
   * milder at once rather than waiting out its off-delay (or the panel shows
   * four of them together for two seconds), and a milder one cannot come on
   * while a worse one is lit.
   */
  drive(E, 'pullup', pull1 || pullTerr, dt);
  drive(E, 'terrain', terrWarn && !A.pullup.on, dt);
  drive(E, 'terrainAhead', terrCaut && !A.terrain.on && !A.pullup.on, dt);
  drive(E, 'sinkrate', sink && !A.pullup.on && !A.terrain.on && !A.terrainAhead.on, dt);
  for (let i = 0; i < GP_FAMILY.length; i++) {
    if (!A[GP_FAMILY[i]].on) continue;
    for (let j = i + 1; j < GP_FAMILY.length; j++) quench(E, GP_FAMILY[j]);
    break;
  }

  // Mode 3: losing height straight after take-off.
  let dontSink = false;
  if (plane && tk.on && flying && agl >= 30 && agl <= 1000 && r.throttle > 0.25) {
    const lost = tk.maxAlt - r.altFt;
    const allow = Math.max(A.dontsink.on ? 30 : 50, (tk.maxAlt - (r.altFt - agl)) * 0.12);
    dontSink = lost > allow && vs < (A.dontsink.on ? 100 : -100);
  }
  drive(E, 'dontsink', dontSink && !A.pullup.on && !A.terrain.on && !A.terrainAhead.on && !A.sinkrate.on, dt);
  if (A.dontsink.on && (A.pullup.on || A.terrain.on || A.terrainAhead.on || A.sinkrate.on)) quench(E, 'dontsink');

  /*
   * Gear: the gear horn's condition OR GPWS mode 4A, as ONE alert. They are
   * two ways of saying the same thing and showing two gear rows was the kind
   * of doubling this panel exists to avoid. Retractable-gear check is by the
   * state the flight model is in, not by the type: the trainer's "fixed" gear
   * retracts in the physics if you press G, and lands on its belly if you do.
   */
  let gearWant = false;
  if (plane && flying && !r.gearDown && !tk.on) {
    const on = A.gear.on;
    // The horn: low, power back, coming down.
    const horn = agl < (on ? 650 : 590) && r.throttle < (on ? 0.45 : 0.35) && vs < (on ? 150 : -60);
    // Landing flap with the wheels still up is never what you meant.
    const flapsOut = r.flapStep >= 2 && agl < 1500;
    // GPWS mode 4A: low, slow and descending with the gear up.
    const mode4a = agl < (on ? 600 : 500) && vs < (on ? 0 : -200) && r.iasKt < Math.min(190, 2.4 * r.stallLandingKt);
    gearWant = agl >= 20 && (horn || flapsOut || mode4a);
  }
  drive(E, 'gear', gearWant, dt);

  // Mode 4B: gear down, no flaps, low and slow, in an aircraft that needs them.
  let flapsWant = false;
  if (plane && flying && r.needsFlaps && r.gearDown && !tk.on && r.flapStep === 0) {
    flapsWant = agl >= 30 && agl < (A.flaps.on ? 300 : 245) && vs < -200 && r.iasKt < 1.8 * r.stallLandingKt;
  }
  drive(E, 'flaps', flapsWant, dt);

  // Bank angle.
  let bankWant = false;
  if (flying && agl >= 30) {
    const lim = bankLimits(r.category, agl);
    if (lim) bankWant = Math.abs(r.bankDeg) > (A.bankangle.on ? lim[1] : lim[0]);
  }
  drive(E, 'bankangle', bankWant, dt);

  // Windshear, below 1,500 ft, from the F-factor the glue worked out.
  drive(E, 'windshear', plane && flying && agl >= 50 && agl <= 1500 && r.windshearF > (A.windshear.on ? 0.05 : 0.105), dt);

  /* ---- the aeroplane itself ------------------------------------- */
  const stallNow = flying && plane && !!r.stallWarn;
  drive(E, 'stall', stallNow, dt);
  const vne = r.vneKt || Infinity;
  drive(E, 'overspeed', flying && r.iasKt > (A.overspeed.on ? vne * 0.97 : vne), dt);
  drive(E, 'engineFire', flying && !!r.fire, dt);
  drive(E, 'fireOut', !!r.fireOut, dt);
  const failed = flying && !r.engineOn && !r.engineStarting && (r.engineFailed || r.engineStopReason === 'fuel' || r.engineStopReason === 'failure');
  drive(E, 'engineFail', failed, dt);
  drive(E, 'engineOff', flying && !r.engineOn && !r.engineStarting && !failed && r.engineStopReason === 'shutdown', dt);
  drive(E, 'engineRough', flying && !!r.engineRough && r.engineOn, dt);
  drive(E, 'lowFuel', flying && r.fuelFrac < (A.lowFuel.on ? 0.15 : 0.12), dt);
  drive(E, 'fuelLeak', flying && !!r.fuelLeak, dt);

  // Autopilot off: lit for five seconds by the event, then out on its own.
  if (r.apOffEvent && flying) {
    const s = A.apOff;
    s.tOn = 0;
    s.until = E.t + 5;
  }
  drive(E, 'apOff', flying && A.apOff.until > E.t, dt);

  /* ---- TCAS ----------------------------------------------------- */
  const tl = flying ? r.tcasLevel || 0 : 0;
  if (tl === 2 && !A.tcasRA.on && r.tcasSense) E.tcasSense = r.tcasSense;
  drive(E, 'tcasRA', tl === 2 || (A.tcasRA.on && tl >= 1 && E.t - A.tcasRA.since < 5), dt);
  drive(E, 'tcasTA', tl >= 1 && !A.tcasRA.on, dt);
  // One aircraft, one line: CLIMB replaces TRAFFIC at once rather than both
  // showing for TRAFFIC's three-second off-delay.
  if (A.tcasRA.on) quench(E, 'tcasTA');
  if (E.raWasOn && !A.tcasRA.on) E.events.push({ type: 'clear', id: 'tcasRA' });
  E.raWasOn = A.tcasRA.on;
  if (!A.tcasRA.on) E.tcasSense = null;

  /* ---- the boat --------------------------------------------------- */
  drive(E, 'shoal', boat && !r.aground && r.speedKt > 1.5 && r.shoalS <= (A.shoal.on ? 50 : 40), dt);

  /* ---- radio altitude callouts ---------------------------------- */
  const co = E.callout;
  let callout = null;
  if (plane && flying && r.gearDown) {
    if (agl > 200) co.armed = (1 << CALLOUTS.length) - 1;
    /*
     * Any downward crossing of a mark, unless climbing away. It used to want
     * a descent of 60 ft/min as well, and a crossing without one was lost for
     * good (lastAgl moves on below the mark): in a flare that floats — the
     * PAPI's own three degrees on the integrated terrain, in headless Chrome
     * — "twenty" was crossed nearly level and never said, so the landing went
     * "thirty … ten". Each mark still sounds once per approach (armed above
     * 200 ft), and the ground is where it disarms, so a float cannot repeat.
     */
    if (vs < 300 && !A.pullup.on && !A.terrain.on) {
      for (let i = 0; i < CALLOUTS.length; i++) {
        const mark = CALLOUTS[i];
        if (co.armed & (1 << i) && co.lastAgl >= mark && agl < mark) {
          co.armed &= ~(1 << i);
          callout = mark;
        }
      }
    }
  } else if (!flying) {
    co.armed = 0;
  }
  co.lastAgl = agl;
  if (callout) {
    co.shown = callout;
    co.shownT = E.t;
  } else if (co.shown && E.t - co.shownT > 1.1) {
    co.shown = null;
  }

  /* ---- the one aural channel -------------------------------------- */
  if (!inhibit) {
    if (callout && E.t >= E.busyUntil - 0.1) {
      // Callouts are timed to the height, so they jump the queue of anything
      // amber — a caution can wait a second, "ten" cannot.
      E.play = { sound: 'radioAltitude', arg: callout, id: 'callout' };
      E.say = CALLOUT_WORDS[callout];
      E.busyUntil = E.t + SOUND_SECONDS.radioAltitude;
    } else if (E.t >= E.busyUntil) {
      let best = null;
      for (const id of ORDER) {
        const s = A[id];
        const d = DEFS[id];
        if (!s.on || s.acked || !d.sound || E.t < s.next) continue;
        best = id;
        break; // ORDER is by priority
      }
      if (!best) {
        for (const ev of E.events) {
          if (ev.type === 'clear') {
            E.play = { sound: 'tcasClear', id: 'tcasClear' };
            E.say = 'Clear of conflict';
            E.busyUntil = E.t + SOUND_SECONDS.tcasClear;
          }
        }
      } else {
        const s = A[best];
        const d = DEFS[best];
        E.play = { sound: d.sound, id: best, arg: best === 'tcasRA' ? E.tcasSense : undefined };
        E.say = best === 'tcasRA' ? (E.tcasSense === 'descend' ? 'Descend, descend' : 'Climb, climb') : d.say || null;
        s.played = true;
        s.next = d.repeat ? E.t + d.repeat : Infinity;
        E.busyUntil = E.t + (SOUND_SECONDS[d.sound] || 0.5) + 0.25;
      }
    }
  }
  return E;
}

/** Is any alert of this level lit and not yet acknowledged? */
export function master(E, level) {
  for (const id of ORDER) {
    const s = E.alerts[id];
    if (s.on && !s.acked && DEFS[id].level === level) return true;
  }
  return false;
}

/** The id of the most urgent lit alert that wants the middle of the screen. */
export function command(E) {
  for (const id of ORDER) {
    if (E.alerts[id].on && DEFS[id].cmd) return id;
  }
  return null;
}
