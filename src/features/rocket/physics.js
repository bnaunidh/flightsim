/**
 * Rocket physics — numbers only. No three.js, no page, no clock of its own,
 * so the node test can fly every mission with a robot and the game can fly
 * the same code at 60 frames a second.
 *
 * THE PLANET IS SMALL, ON PURPOSE
 * The island sits on a planet 600 km in radius — a tenth of the Earth's —
 * with the Earth's gravity at the surface and an Earth-like sky that thins
 * out every 7 km. Space still starts where it does on Earth, at 100 km (the
 * Kármán line, which is the number a ten-year-old will have been told), but
 * going sideways fast enough to stay up is 2,250 m/s instead of 7,800. That
 * is the whole trick that lets a child reach orbit in about three minutes
 * with two stages, and it is the same one Kerbal Space Program uses. The
 * curve of the planet is real in these equations: gravity points at the
 * centre, so a rocket going sideways fast enough really does fall round it.
 *
 * THE FLIGHT IS IN ONE PLANE
 * Everything happens in the vertical plane through the launch pad and the
 * direction the rocket is launched in: x along that direction from the
 * planet's centre's point of view, y up through the pad. That makes the
 * controls exactly two keys — lean left, lean right — and it is how real
 * ascents are flown anyway (a rocket does not wander sideways out of its
 * plane). The pad is at (0, R + its height).
 *
 * `tilt` is the lean from straight up, measured from the LOCAL vertical
 * wherever the rocket is — 0 is pointing at the sky, +90° is flat along the
 * direction of flight, negative is leaning back towards the pad. Holding a
 * tilt relative to the ground under you, rather than to the stars, is what a
 * pilot means by "hold 45 degrees", and it is what a child can follow.
 */

export const G0 = 9.81;

export const PLANET = Object.freeze({
  R: 600000,
  mu: G0 * 600000 * 600000,
  /** Where space begins. */
  SPACE: 100000,
  /** A satellite whose lowest point is above this is in orbit — above the air. */
  ORBIT_MIN: 80000,
  /** How quickly the air thins: its density halves every ~4.9 km. */
  H: 7000,
  RHO0: 1.225,
  /** Above this there is no air to speak of. */
  AIR_TOP: 140000,
});

const D2R = Math.PI / 180;

export function airDensity(h) {
  if (h >= PLANET.AIR_TOP) return 0;
  return PLANET.RHO0 * Math.exp(-Math.max(0, h) / PLANET.H);
}

/** 1 at sea level, 0 in space. */
export function pressureRatio(h) {
  if (h >= PLANET.AIR_TOP) return 0;
  return Math.exp(-Math.max(0, h) / PLANET.H);
}

export function circularSpeed(r) {
  return Math.sqrt(PLANET.mu / r);
}

/**
 * The rockets.
 *
 * Each is a stack of stages, bottom first, and whatever rides on top. The
 * numbers are made up but in proportion: engines lose a little push and a
 * little efficiency at sea level (the air pushes back on the nozzle), a
 * booster that is to land keeps some of its fuel back for the trip home,
 * and each rocket has just enough to do its job with room for a child's
 * wobbles — about a sixth more than a perfect robot needs.
 *
 * `height` and `radius` are metres, for the model and the drag.
 */
export const ROCKETS = {
  starling: {
    id: 'starling',
    name: 'Starling',
    tag: 'One stage',
    blurb: 'Small and quick. Point it straight up and go.',
    colour: '#58c6ff',
    goals: ['space'],
    stages: [
      { id: 'core', name: 'Starling', dry: 700, fuel: 1300, thrustSL: 56000, thrustVac: 62000, ispSL: 230, ispVac: 262, height: 13, radius: 0.62, landable: false },
    ],
    payload: { id: 'probe', name: 'science probe', mass: 90, kind: 'probe', height: 2.6 },
    cd: 0.34,
  },
  petrel: {
    id: 'petrel',
    name: 'Petrel 9',
    tag: 'Two stages · reusable',
    blurb: 'The booster flies home and lands on its legs!',
    colour: '#ffc247',
    goals: ['land-pad', 'land-barge'],
    stages: [
      { id: 'booster', name: 'booster', dry: 2600, fuel: 4400, thrustSL: 200000, thrustVac: 220000, ispSL: 268, ispVac: 296, height: 24, radius: 0.95, landable: true, reserve: 0.18 },
      { id: 'upper', name: 'upper stage', dry: 500, fuel: 300, thrustSL: 24000, thrustVac: 30000, ispSL: 250, ispVac: 330, height: 7, radius: 0.95, landable: false },
    ],
    payload: { id: 'capsule', name: 'cargo capsule', mass: 180, kind: 'capsule', height: 3.2 },
    cd: 0.3,
  },
  albatross: {
    id: 'albatross',
    name: 'Albatross',
    tag: 'Two stages · heavy',
    blurb: 'The big one. It carries a satellite all the way to orbit.',
    colour: '#7ee8b2',
    goals: ['orbit'],
    stages: [
      { id: 'booster', name: 'booster', dry: 3000, fuel: 6000, thrustSL: 380000, thrustVac: 415000, ispSL: 272, ispVac: 300, height: 26, radius: 1.15, landable: true, reserve: 0 },
      { id: 'upper', name: 'upper stage', dry: 700, fuel: 1400, thrustSL: 44000, thrustVac: 60000, ispSL: 260, ispVac: 345, height: 9, radius: 1.15, landable: false },
    ],
    payload: { id: 'satellite', name: 'satellite', mass: 450, kind: 'satellite', height: 5 },
    /** Thrown away once the air is thin enough that the satellite needs no cover. */
    fairing: { mass: 160, dropAt: 62000 },
    cd: 0.32,
  },
};

export const ROCKET_IDS = Object.keys(ROCKETS);

/** A fresh, fuelled copy of one stage's spec. */
function freshStage(spec) {
  return { ...spec, fuelLeft: spec.fuel };
}

/**
 * One thing flying: the whole stack at launch, and later the booster and the
 * upper stage separately.
 */
export class Body {
  constructor({ role, stages, payload = null, fairing = null, pos, vel, tilt = 0, cd = 0.32 }) {
    this.role = role;
    this.stages = stages;
    this.payload = payload;
    this.fairing = fairing;
    this.pos = { x: pos.x, y: pos.y };
    this.vel = { x: vel.x, y: vel.y };
    this.tilt = tilt;
    this.cd = cd;
    this.throttle = 0;
    this.engineOn = false;
    /** Fuel below this (kg) the ascent will not touch — a landing booster's reserve. */
    this.fuelFloor = 0;
    this.legs = false;
    this.landed = false;
    this.crashed = false;
    this.gone = false;
    this.maxAlt = 0;
    this.q = 0;
    this.heat = 0;
    this.lastThrust = 0;
  }

  get stage() {
    return this.stages[0] || null;
  }

  get mass() {
    let m = 0;
    for (const s of this.stages) m += s.dry + s.fuelLeft;
    if (this.payload) m += this.payload.mass;
    if (this.fairing) m += this.fairing.mass;
    return m;
  }

  get radius() {
    let r = 0.5;
    for (const s of this.stages) r = Math.max(r, s.radius);
    return r;
  }

  get r() {
    return Math.hypot(this.pos.x, this.pos.y);
  }

  /** Height above sea level. */
  get alt() {
    return this.r - PLANET.R;
  }

  /** Distance along the ground from the pad, following the curve. */
  get downrange() {
    return PLANET.R * Math.atan2(this.pos.x, this.pos.y);
  }

  /** The local frame: `up` out of the planet, `along` in the launch direction. */
  frame(out = {}) {
    const r = this.r || 1;
    out.ux = this.pos.x / r;
    out.uy = this.pos.y / r;
    out.ax = out.uy;
    out.ay = -out.ux;
    return out;
  }

  /** Speed up (+) or down (-), and along the ground. */
  localVel(out = {}) {
    const f = this.frame(TMP);
    out.up = this.vel.x * f.ux + this.vel.y * f.uy;
    out.along = this.vel.x * f.ax + this.vel.y * f.ay;
    return out;
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.y);
  }

  /** Usable fuel in the active stage, above any reserve. */
  get usableFuel() {
    const s = this.stage;
    return s ? Math.max(0, s.fuelLeft - this.fuelFloor) : 0;
  }

  /** 0..1 of the active stage's tank. */
  get fuelFrac() {
    const s = this.stage;
    return s ? s.fuelLeft / s.fuel : 0;
  }
}

const TMP = {};

/**
 * The orbit this body is on, from where it is and how fast it is going.
 * Returns the highest and lowest points as heights above sea level. A body
 * still climbing out of the air has a lowest point deep inside the planet —
 * which is just the maths saying "this comes back down".
 */
export function orbitOf(body) {
  const { mu, R } = PLANET;
  const r = body.r;
  const v2 = body.vel.x * body.vel.x + body.vel.y * body.vel.y;
  const eps = v2 / 2 - mu / r;
  const hAng = body.pos.x * body.vel.y - body.pos.y * body.vel.x;
  const e = Math.sqrt(Math.max(0, 1 + (2 * eps * hAng * hAng) / (mu * mu)));
  let ra;
  let rp;
  if (eps < 0) {
    // Bound. Through the semi-major axis, which stays finite for a rocket
    // going straight up (e = 1, where p / (1 - e) would be 0 / 0).
    const a = -mu / (2 * eps);
    ra = a * (1 + e);
    rp = a * (1 - e);
  } else {
    ra = Infinity;
    rp = (hAng * hAng) / mu / (1 + e);
  }
  return { apoapsis: ra - R, periapsis: rp - R, e, energy: eps };
}

/**
 * One step of the flight model.
 *
 * `ctl.throttle` 0..1 is what the engine is asked for; the tank decides
 * whether it gets it. `ctl.tiltRate` is radians per second of lean, already
 * limited by the caller. `ctl.fins` is a -1..1 lean on the grid fins of a
 * booster falling engine-first — they steer it before the engine lights.
 *
 * Semi-implicit Euler at the caller's step (1/60 s): symplectic for gravity,
 * so an orbit stays an orbit for the few minutes anybody watches one.
 */
export function stepBody(body, dt, ctl = {}) {
  if (body.landed || body.crashed || body.gone) return;
  const { mu } = PLANET;

  body.tilt += (ctl.tiltRate || 0) * dt;

  const r = body.r;
  const h = r - PLANET.R;
  const f = body.frame(FRAME);
  // Where the nose points, in planet coordinates.
  const st = Math.sin(body.tilt);
  const ct = Math.cos(body.tilt);
  const nx = f.ax * st + f.ux * ct;
  const ny = f.ay * st + f.uy * ct;

  // Gravity, towards the centre, weaker with height.
  const g = mu / (r * r);
  let ax = (-g * body.pos.x) / r;
  let ay = (-g * body.pos.y) / r;

  // The engine.
  const stage = body.stage;
  const m = body.mass;
  body.lastThrust = 0;
  if (stage && body.engineOn && (ctl.throttle || 0) > 0 && body.usableFuel > 0) {
    const pr = pressureRatio(h);
    const thrust = (stage.thrustVac + (stage.thrustSL - stage.thrustVac) * pr) * ctl.throttle;
    const isp = stage.ispVac + (stage.ispSL - stage.ispVac) * pr;
    const burn = Math.min(body.usableFuel, (thrust / (isp * G0)) * dt);
    const frac = burn / ((thrust / (isp * G0)) * dt || 1);
    stage.fuelLeft -= burn;
    const T = thrust * frac;
    ax += (T * nx) / m;
    ay += (T * ny) / m;
    body.lastThrust = T;
  }
  body.throttle = body.lastThrust > 0 ? ctl.throttle || 0 : 0;

  // The air: drag against the way it is moving, and on a falling booster,
  // the grid fins pushing it sideways.
  const rho = airDensity(h);
  const v = body.speed;
  body.q = 0.5 * rho * v * v;
  body.heat = rho * v * v * v;
  if (rho > 0 && v > 0.01) {
    const area = Math.PI * body.radius * body.radius;
    const cd = ctl.cd || body.cd;
    const D = body.q * cd * area;
    ax -= (D * body.vel.x) / (v * m);
    ay -= (D * body.vel.y) / (v * m);
    if (ctl.fins) {
      // Lift from the fins, along the ground: lean right, slide right.
      const L = body.q * area * 0.55 * Math.max(-1, Math.min(1, ctl.fins));
      ax += (L * f.ax) / m;
      ay += (L * f.ay) / m;
    }
  }

  body.vel.x += ax * dt;
  body.vel.y += ay * dt;
  body.pos.x += body.vel.x * dt;
  body.pos.y += body.vel.y * dt;
  if (h > body.maxAlt) body.maxAlt = h;
}

const FRAME = {};

/**
 * Where the rocket should be leaning, for each kind of flight.
 *
 * This is the green wedge on the tilt dial. It is a real gravity turn for
 * the orbit — straight up out of the thick air, then over steadily — and a
 * gentle one for a booster that has to come home, because every metre a
 * second it carries away from the pad is a metre a second it has to take
 * off again to get back.
 *
 * An orbit is flown the way real rockets and Kerbal pilots fly it, in two
 * burns: the first climbs until the top of the path is high enough
 * (ORBIT_AIM) and the engine stops; the rocket coasts up; at the top it
 * fires again pointing FLAT, and that second burn is what turns "up high"
 * into "going round". `circularising` is that second burn: flat, leaning a
 * touch up or down to cancel any climb or fall that is left.
 */
export function guideTilt(goal, body, { circularising = false } = {}) {
  const h = body.alt;
  const km = h / 1000;
  const ramp = (pts) => {
    if (km <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (km <= pts[i][0]) {
        const [k0, a0] = pts[i - 1];
        const [k1, a1] = pts[i];
        return a0 + ((a1 - a0) * (km - k0)) / (k1 - k0);
      }
    }
    return pts[pts.length - 1][1];
  };
  let deg;
  if (goal === 'space') deg = 0;
  else if (goal === 'land-pad') deg = ramp([[1.2, 0], [4, 6], [12, 18], [30, 28], [60, 34]]);
  else if (goal === 'land-barge') deg = ramp([[1.2, 0], [4, 8], [12, 24], [30, 38], [60, 45]]);
  else if (goal === 'orbit') {
    if (circularising) {
      const up = body.localVel(LV).up;
      deg = 90 + Math.max(-12, Math.min(20, up / 25));
    } else {
      deg = ramp([[1.0, 0], [3, 10], [10, 30], [20, 46], [35, 60], [50, 70], [70, 78]]);
    }
  } else deg = 0;
  return deg * D2R;
}

/** The top of the path the first orbit burn climbs to before the engine stops. */
export const ORBIT_AIM = 110000;

/** Seconds until the top of the path — near enough, for a countdown. */
export function timeToTop(body) {
  const up = body.localVel(LV).up;
  if (up <= 0) return 0;
  const g = PLANET.mu / (body.r * body.r);
  return up / g;
}

/**
 * Throttle for the landing helper.
 *
 * Holding BURN does not mean "full power" — it means "slow me down safely".
 * It is how the real boosters land, done for you: fall with the engine off
 * until the braking it would take to stop exactly at the deck is about
 * half of what the engine can give, then light and brake at exactly that
 * rate all the way down, arriving at a walking pace. Held too early it
 * simply waits with the engine off; held late it brakes as hard as it can,
 * which may not be enough. What it cannot do is invent fuel, or put the
 * booster over the pad — those are the child's.
 *
 * `body.braking` remembers that the burn has begun, so it does not blink
 * off and on around the moment it starts.
 */
export function landingThrottle(body, heightAboveDeck) {
  const stage = body.stage;
  if (!stage) return 0;
  const lv = body.localVel(LV);
  const m = body.mass;
  const g = PLANET.mu / (body.r * body.r);
  const pr = pressureRatio(body.alt);
  const Tmax = stage.thrustVac + (stage.thrustSL - stage.thrustVac) * pr;
  const aNet = Math.max(1, Tmax / m - g);
  const hh = Math.max(0.3, heightAboveDeck - 0.4);
  const v = -lv.up;
  const touch = 1.8;
  const aReq = (v * v - touch * touch) / (2 * hh);
  if (!body.braking) {
    if (v <= touch || aReq < 0.5 * aNet) return 0;
    body.braking = true;
  }
  const aCmd = g + (v > touch ? aReq : -(touch - v) * 2);
  const cosT = Math.max(0.5, Math.cos(body.tilt));
  return Math.max(0, Math.min(1, (m * aCmd) / (Tmax * cosT)));
}

const LV = {};

/**
 * Where a falling body will come down, if nobody touches it: a quick
 * forward run of the same equations at a coarse step, engine off, fins
 * straight. Used to aim the boostback, and by the HUD's "you will land
 * here" marker.
 */
export function predictImpact(body, { cd = null, groundAt = null, dt = 0.25, maxT = 600 } = {}) {
  const b = new Body({
    role: 'ghost',
    stages: body.stages.map((s) => ({ ...s })),
    payload: body.payload,
    pos: body.pos,
    vel: body.vel,
    tilt: 0,
    cd: cd || body.cd,
  });
  b.engineOn = false;
  let t = 0;
  while (t < maxT) {
    stepBody(b, dt, { cd: cd || body.cd });
    t += dt;
    const lv = b.localVel(LV);
    if (lv.up < 0) {
      const ground = groundAt ? groundAt(b.downrange) : 0;
      if (b.alt <= ground) return { downrange: b.downrange, t, speed: b.speed };
    }
  }
  return { downrange: b.downrange, t, speed: b.speed };
}

/**
 * The along-the-ground speed that brings a falling body down at `target`
 * metres downrange. Secant search on predictImpact, a handful of runs.
 */
export function aimAlong(body, target, opts = {}) {
  const f = body.frame({});
  const lv = body.localVel({});
  const tryV = (va) => {
    const b = cloneForAim(body, f, lv.up, va);
    return predictImpact(b, opts).downrange - target;
  };
  let v0 = lv.along;
  let e0 = tryV(v0);
  let v1 = v0 - Math.sign(e0 || 1) * 60;
  let e1 = tryV(v1);
  for (let i = 0; i < 10; i++) {
    if (Math.abs(e1) < 8 || e1 === e0) break;
    const v2 = v1 - (e1 * (v1 - v0)) / (e1 - e0);
    v0 = v1;
    e0 = e1;
    v1 = Math.max(-2500, Math.min(2500, v2));
    e1 = tryV(v1);
  }
  return v1;
}

function cloneForAim(body, f, up, along) {
  const b = new Body({
    role: 'ghost',
    stages: body.stages.map((s) => ({ ...s })),
    payload: body.payload,
    pos: body.pos,
    vel: { x: f.ux * up + f.ax * along, y: f.uy * up + f.ay * along },
    tilt: 0,
    cd: body.cd,
  });
  return b;
}

/** Set a body's along-the-ground speed, keeping its up/down speed. */
export function setAlong(body, along) {
  const f = body.frame({});
  const lv = body.localVel({});
  body.vel.x = f.ux * lv.up + f.ax * along;
  body.vel.y = f.uy * lv.up + f.ay * along;
}

export const DEG = D2R;
