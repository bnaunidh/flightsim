/**
 * The traffic extension's own hooks, driven in node with a stand-in for the
 * game: no page, no renderer, no physics. The player's aeroplane is a pose
 * the test sets and moves itself.
 *
 * Used by traffic.mjs (the long queue) and traffic.soak.mjs (every map, half
 * an hour at a time). What it measures is what a child would see go wrong:
 * two aeroplanes inside each other on the ground, one driving through the
 * player's, a wing tip through a building, one stuck for ever, one below the
 * ground, the extension switched off because a hook threw.
 *
 * Import it only after the DOM stub is in place (traffic.mjs sets one up;
 * this file sets it up too if nothing has).
 */

if (!global.document) {
  global.document = {
    createElement: () => ({
      getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
      width: 0,
      height: 0,
      style: {},
    }),
    body: { appendChild() {} },
  };
}

const SRC = new URL('../../src/', import.meta.url).href;
export const THREE = await import(SRC + 'vendor/three.module.js');
export const TR = await import(SRC + 'world/terrain.js');
const AP = await import(SRC + 'world/airport.js');
const APR = await import(SRC + 'world/apron.js');
const EXT = await import(SRC + 'game/extensions.js');
const TYPES = await import(SRC + 'aircraft/types.js');
export const TF = await import(SRC + 'features/traffic.js');
export const F = await import(SRC + 'features/traffic/field.js');
export const P = await import(SRC + 'features/traffic/planner.js');

export const ext = EXT.extensions().find((e) => e.id === 'traffic');

/**
 * Load a map and build its airport the way main.js does, with a stub scene.
 * `quality` is the graphics setting the apron is built at: at 'low' every
 * stand is free; above it the airport parks its own aeroplanes on some of
 * them (six at 'high', the game's default), and the traffic gets fewer.
 */
export function loadMap(id, quality = 'low') {
  TR.applyMap(id);
  AP.refreshRunways();
  APR.refreshApronElevation();
  TR.clearObstacles();
  TR.clearPlatforms();
  const scene = { add() {} };
  new AP.Airport(scene);
  new APR.Apron(scene, quality);
}

/** A game-shaped object with just what the traffic reads. */
export function makeSim({ typeId = 'skylark', quality = 'medium', wind = [90, 3] } = {}) {
  const type = TYPES.AIRCRAFT.find((t) => t.id === typeId) || TYPES.AIRCRAFT[0];
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1.6, 1, 60000);
  const sim = {
    scene,
    camera,
    state: 'flying',
    mode: 'free',
    settings: { quality, aircraft: type.id },
    aircraftType: type,
    model: null,
    weather: { windDirDeg: wind[0], windSpeedKts: wind[1], isNight: false, cond: { cloud: 0.2 } },
    runner: { def: null },
    traffic: [],
    notes: [],
    hud: { notify(text) { sim.notes.push(text); } },
    speak() {},
    aircraft: {
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      heading: 90,
      ias: 0,
      groundSpeed: 0,
      agl: 0,
      alt: 0,
      vs: 0,
      onGround: true,
      crashed: false,
      engineOn: true,
      gearDown: true,
    },
  };
  return sim;
}

/** Put the player somewhere: on the ground (agl 0) or in the air. */
export function placePlayer(sim, x, z, { headingDeg = 90, agl = 0, speed = 0 } = {}) {
  const a = sim.aircraft;
  const g = Math.max(TR.heightAt(x, z), 0);
  const ground = agl <= 0;
  const y = ground ? Math.max(g, TR.AIRPORT.elev) : g + agl;
  a.pos.set(x, y, z);
  a.heading = headingDeg;
  const h = (headingDeg * Math.PI) / 180;
  a.vel.set(Math.sin(h) * speed, 0, -Math.cos(h) * speed);
  a.ias = speed;
  a.groundSpeed = speed;
  a.agl = ground ? 0 : agl;
  a.alt = y;
  a.onGround = ground;
  sim.camera.position.set(x, y + 3, z + 12);
}

/** Every hook call fenced the way extensions.js fences it: a throw is recorded, not raised. */
export function call(hook, ...args) {
  try {
    return { ok: true, out: ext[hook](...args) };
  } catch (err) {
    return { ok: false, err };
  }
}

/** World build and flight start, as main.js does them. */
export function startFlight(sim, opts = {}) {
  const group = new THREE.Group();
  sim.scene.add(group);
  const a = call('buildWorld', sim, group);
  if (!a.ok) return a;
  sim.traffic = [];
  // Traffic is Dev-mode-only in the game for now; the harness asks for it outright.
  return call('startMode', sim, 'free', { traffic: true, ...opts });
}

/**
 * The seams a child would see, measured every frame:
 *   merged    two traffic aeroplanes on the ground closer than half their
 *             nose-to-tail spacing — inside each other
 *   player    a traffic aeroplane on the ground inside the player's
 *   tips      a wing tip through a building
 *   under     below the ground in the air
 *   nan       a position that is not a number
 * plus, per aeroplane, the longest it sat still in 'moving', and why.
 */
export function makeWatch(sim) {
  return {
    frames: 0,
    t: 0,
    merged: 0,
    mergedFirst: null,
    minPair: Infinity,
    player: 0,
    playerFirst: null,
    minPlayer: Infinity,
    touch: 0,
    touchFirst: null,
    minGap: Infinity,
    touchPlayer: 0,
    touchPlayerFirst: null,
    minPlayerGap: Infinity,
    minAirPair: Infinity,
    airHit: 0,
    airHitFirst: null,
    tips: 0,
    tipsFirst: null,
    under: 0,
    underFirst: null,
    nan: 0,
    parkedArrivals: 0,
    landings: 0,
    departures: 0,
    stillest: 0,
    stillWhy: '',
    still: new Map(),
    lastPhase: new Map(),
    // Every type seen flying, over the whole run.
    types: new Set(),
    wait: new Map(),
    longestWait: 0,
    waitWhy: '',
    deadlocks: 0,
    threw: null,
    // Where each one was last frame, to catch one that jumps.
    last: new Map(),
    jumps: 0,
    jumpMax: 0,
    jumpFirst: null,
  };
}

const HALF_LEN = (c) => Math.max(3, (c.length || 8) / 2);
/*
 * Nose ahead and tail behind, as drawn: the roster's `plan` where it has one
 * (via the traffic's noseLen/tailLen), half the shape's length otherwise.
 * The review found this harness drew a 747 as 21.8 m each way where the
 * model's nose is 31.1 m ahead and its tail 39.5 m behind.
 */
const NOSE = (c) => Math.max(3, c.noseLen || (c.length || 8) / 2);
const TAIL = (c) => Math.max(3, c.tailLen || (c.length || 8) / 2);

/*
 * Touching, as a plan view sees it. "merged" above only counts two middles
 * within a few metres of each other, which misses a nose through a tail or a
 * wing tip through a wing at 8 or 15 m. So each aeroplane is also drawn as a
 * cross — the fuselage nose to tail, the wing tip to tip, both through its
 * middle — and two crosses closer than TOUCH metres anywhere are touching.
 */
const TOUCH = 1;

/** The four ends of an aeroplane's cross: nose, tail, right tip, left tip. */
function cross(x, z, hdgRad, nose, tail, halfSpan, out) {
  const s = Math.sin(hdgRad);
  const c = Math.cos(hdgRad);
  out[0] = x + s * nose;
  out[1] = z - c * nose;
  out[2] = x - s * tail;
  out[3] = z + c * tail;
  out[4] = x + c * halfSpan;
  out[5] = z + s * halfSpan;
  out[6] = x - c * halfSpan;
  out[7] = z - s * halfSpan;
  return out;
}

function pointSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2)) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function segSeg(ax, az, bx, bz, cx, cz, dx, dz) {
  const o = (px, pz, qx, qz, rx, rz) => Math.sign((qx - px) * (rz - pz) - (qz - pz) * (rx - px));
  if (o(ax, az, bx, bz, cx, cz) * o(ax, az, bx, bz, dx, dz) < 0 && o(cx, cz, dx, dz, ax, az) * o(cx, cz, dx, dz, bx, bz) < 0) return 0;
  return Math.min(pointSeg(ax, az, cx, cz, dx, dz), pointSeg(bx, bz, cx, cz, dx, dz), pointSeg(cx, cz, ax, az, bx, bz), pointSeg(dx, dz, ax, az, bx, bz));
}

const CA = new Float64Array(8);
const CB = new Float64Array(8);

/** Closest approach, metres, of two crosses (see cross()); 0 if they cross. */
export function crossGap(a, b) {
  let best = Infinity;
  for (let i = 0; i < 8; i += 4) {
    for (let j = 0; j < 8; j += 4) {
      const d = segSeg(a[i], a[i + 1], a[i + 2], a[i + 3], b[j], b[j + 1], b[j + 2], b[j + 3]);
      if (d < best) best = d;
    }
  }
  return best;
}

/** The player's aeroplane as a cross, or null if it has no shape to go by. */
function playerCross(sim, out) {
  const t = sim.aircraftType;
  const sh = t && t.shape;
  if (!sh) return null;
  const halfSpan = ((sh.wingRootX || 0.62) + (sh.halfSpan || 5.5)) * (sh.scale || 1);
  const halfLen = ((2.6 + 3.95) * (sh.bodyLength || 1) * (sh.scale || 1)) / 2;
  const pl = t.plan && Number.isFinite(t.plan.nose) && Number.isFinite(t.plan.tail) ? t.plan : null;
  const p = sim.aircraft.pos;
  return cross(p.x, p.z, ((sim.aircraft.heading || 0) * Math.PI) / 180, pl ? -pl.nose : halfLen, pl ? pl.tail : halfLen, pl ? Math.max(halfSpan, pl.span / 2) : halfSpan, out);
}
const CP = new Float64Array(8);

/** One frame of measurement. `craft` is TF.trafficState().craft plus the internal numbers. */
export function measure(sim, W, dt) {
  const st = TF.trafficState();
  W.frames++;
  W.t += dt;
  W.deadlocks = st.stats.deadlocks || 0;
  const list = st.craft;
  const pl = sim.aircraft;
  const plType = sim.aircraftType;
  const plHalf = plType && plType.shape ? Math.max(3, ((2.6 + 3.95) * (plType.shape.bodyLength || 1) * (plType.shape.scale || 1)) / 2) : 4;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const [x, y, z] = a.pos;
    if (![x, y, z].every(Number.isFinite)) W.nan++;
    if (!a.onGround && y < Math.max(TR.heightAt(x, z), 0) - 0.5) {
      W.under++;
      if (!W.underFirst) W.underFirst = `${a.callsign} (${a.type}) ${a.phase} ${(y - Math.max(TR.heightAt(x, z), 0)).toFixed(1)} m under the ground at (${Math.round(x)}, ${Math.round(z)}), t ${W.t.toFixed(0)} s`;
    }
    W.types.add(a.type);
    /*
     * Never further in one frame than it can fly: its speed along the path,
     * plus stepping aside (at most 70% of that sideways and 30% up, and
     * 12 m/s drifting back), with room to spare. The review found one that
     * had stepped aside for a chasing player jump up to 1.3 km in a frame
     * when it went around, because the go-around was planned from where it
     * was drawn and the step aside was then added on top a second time.
     */
    const lp = W.last.get(a.id);
    if (lp) {
      const dj = Math.hypot(x - lp[0], y - lp[1], z - lp[2]);
      if (dj > 2.2 * Math.max(a.v, lp[3], 10) * dt + 5) {
        W.jumps++;
        if (dj > W.jumpMax) {
          W.jumpMax = dj;
          W.jumpFirst = `${a.callsign} (${a.type}) jumped ${dj.toFixed(0)} m in ${dt.toFixed(2)} s, ${lp[4]} -> ${a.phase}, at (${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)}), t ${W.t.toFixed(0)} s`;
        }
      }
      lp[0] = x;
      lp[1] = y;
      lp[2] = z;
      lp[3] = a.v;
      lp[4] = a.phase;
    } else W.last.set(a.id, [x, y, z, a.v, a.phase]);
    const prev = W.lastPhase.get(a.id);
    if (prev !== a.phase) {
      if (a.phase === 'parked' && prev === 'shutdown') W.parkedArrivals++;
      if (a.phase === 'rollout' && prev !== 'rollout') W.landings++;
      if (a.phase === 'takeoff' && prev !== 'takeoff') W.departures++;
      W.lastPhase.set(a.id, a.phase);
    }
    // Waiting to be let taxi: on its slot, or at the exit after landing.
    if (a.state === 'taxi-wait' || (a.state === 'startup' && a.waitWhy)) {
      const w = (W.wait.get(a.id) || 0) + dt;
      W.wait.set(a.id, w);
      if (w > W.longestWait) {
        W.longestWait = w;
        W.waitWhy = `${a.callsign} ${a.phase}: ${a.waitWhy || 'asking'}`;
      }
    } else W.wait.set(a.id, 0);
    // Sat still while meant to be moving.
    if (a.state === 'moving' && a.onGround && a.v < 0.05) {
      const s = (W.still.get(a.id) || 0) + dt;
      W.still.set(a.id, s);
      if (s > W.stillest) {
        W.stillest = s;
        W.stillWhy = `${a.callsign} ${a.phase} at (${Math.round(x)}, ${Math.round(z)}) blocked by ${a.blockedBy || '?'}`;
      }
    } else W.still.set(a.id, 0);
    if (!a.onGround) {
      // Two in the air: how close, middle to middle, and never within a
      // span of each other — that is flying through one another.
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.onGround) continue;
        const d = Math.hypot(b.pos[0] - x, b.pos[1] - y, b.pos[2] - z);
        if (d < W.minAirPair) {
          W.minAirPair = d;
          W.minAirWhat = `${a.callsign} (${a.phase}) and ${b.callsign} (${b.phase}) at (${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)}), t ${W.t.toFixed(0)} s`;
        }
        if (d < (a.span + b.span) / 2 + 10) {
          W.airHit += dt;
          if (!W.airHitFirst) W.airHitFirst = `${a.callsign} (${a.phase}) and ${b.callsign} (${b.phase}) ${d.toFixed(1)} m apart in the air at (${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)}), t ${W.t.toFixed(0)} s`;
        }
      }
      continue;
    }
    cross(x, z, (a.hdgDeg * Math.PI) / 180, NOSE(a), TAIL(a), a.span / 2, CA);
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (!b.onGround) continue;
      const d = Math.hypot(b.pos[0] - x, b.pos[2] - z);
      W.minPair = Math.min(W.minPair, d);
      if (d < 0.5 * (HALF_LEN(a) + HALF_LEN(b))) {
        W.merged += dt;
        if (!W.mergedFirst) W.mergedFirst = `${a.callsign} and ${b.callsign} ${d.toFixed(1)} m apart at (${Math.round(x)}, ${Math.round(z)}), t ${W.t.toFixed(0)} s, ${a.phase}/${b.phase}`;
      }
      // Nose, tail or wing of one within a metre of the other's.
      if (d < Math.max(NOSE(a), TAIL(a)) + Math.max(NOSE(b), TAIL(b)) + (a.span + b.span) / 2) {
        const g = crossGap(CA, cross(b.pos[0], b.pos[2], (b.hdgDeg * Math.PI) / 180, NOSE(b), TAIL(b), b.span / 2, CB));
        W.minGap = Math.min(W.minGap, g);
        if (g < TOUCH) {
          W.touch += dt;
          if (!W.touchFirst) W.touchFirst = `${a.callsign} (${a.phase}) and ${b.callsign} (${b.phase}) ${g.toFixed(1)} m apart, middles ${d.toFixed(1)} m, at (${Math.round(x)}, ${Math.round(z)}), t ${W.t.toFixed(0)} s`;
        }
      }
    }
    if (pl && pl.onGround) {
      const d = Math.hypot(pl.pos.x - x, pl.pos.z - z);
      W.minPlayer = Math.min(W.minPlayer, d);
      if (d < 0.8 * (plHalf + HALF_LEN(a))) {
        W.player += dt;
        if (!W.playerFirst) W.playerFirst = `${a.callsign} ${d.toFixed(1)} m from you at (${Math.round(x)}, ${Math.round(z)}), t ${W.t.toFixed(0)} s, ${a.phase}`;
      }
      const pc = d < 150 ? playerCross(sim, CP) : null;
      if (pc) {
        const g = crossGap(CA, pc);
        W.minPlayerGap = Math.min(W.minPlayerGap, g);
        if (g < TOUCH) {
          W.touchPlayer += dt;
          if (!W.touchPlayerFirst) W.touchPlayerFirst = `${a.callsign} (${a.phase}) ${g.toFixed(1)} m from your aeroplane, middles ${d.toFixed(1)} m, at (${Math.round(x)}, ${Math.round(z)}), t ${W.t.toFixed(0)} s`;
        }
      }
    }
    const hit = tipHit(a);
    if (hit) {
      W.tips += dt;
      if (!W.tipsFirst) W.tipsFirst = `${a.callsign} (${a.type}, span ${a.span.toFixed(0)} m) ${a.phase}: ${hit}, t ${W.t.toFixed(0)} s`;
    }
  }
}

/**
 * Is either wing, from the fuselage out to the tip, through a building?
 * Written separately from the planner's own check on purpose, so the one
 * does not mark its own homework: every obstacle box that reaches up to the
 * wing's height, against the line from tip to tip.
 */
function tipHit(a) {
  const half = a.span / 2;
  if (!(half > 0)) return null;
  const [x, , z] = a.pos;
  const h = (a.hdgDeg * Math.PI) / 180;
  const ex = Math.cos(h) * half;
  const ez = Math.sin(h) * half;
  const wingY = TR.AIRPORT.elev + Math.max(1.5, a.wingY || 2);
  for (const o of TR.OBSTACLES) {
    if (o.y0 > wingY || o.y1 < TR.AIRPORT.elev + 0.3) continue;
    // A building it is inside is the hangar it lives in.
    if (x > o.x0 - 2 && x < o.x1 + 2 && z > o.z0 - 2 && z < o.z1 + 2) continue;
    for (let k = -10; k <= 10; k++) {
      const px = x + (ex * k) / 10;
      const pz = z + (ez * k) / 10;
      if (px > o.x0 && px < o.x1 && pz > o.z0 && pz < o.z1) return `${String(o.what).replace(/^You flew into /, '')} at (${Math.round(px)}, ${Math.round(pz)})`;
    }
  }
  return null;
}

/** Run the extension for `seconds` at `dt`, calling `each(t, dt)` before every frame. */
export function run(sim, W, seconds, dt = 0.1, each = null) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    if (each) each(W.t, dt);
    const r = call('update', sim, dt);
    if (!r.ok) {
      W.threw = String((r.err && r.err.stack) || r.err);
      return W;
    }
    measure(sim, W, dt);
  }
  return W;
}

/**
 * A child chasing the traffic: pick one in the air, start 1.5 km behind it at
 * its height, and fly straight at it at `k` times its speed (never under
 * 40 m/s), a new one every two and a half minutes or when it lands. Returns
 * an `each(t, dt)` for run(). Keeps the player 30 m over the ground.
 */
export function chaser(sim, k = 1.25) {
  let tgt = null;
  let since = 0;
  let picks = 0;
  const a = sim.aircraft;
  return (t, dt) => {
    since += dt;
    const craft = TF.trafficState().craft;
    let c = tgt ? craft.find((x) => x.id === tgt) : null;
    if (!c || c.onGround || since > 150) {
      const cand = craft.filter((x) => !x.onGround && x.v > 20);
      if (!cand.length) {
        tgt = null;
        return;
      }
      c = cand[picks++ % cand.length];
      tgt = c.id;
      since = 0;
      const h = (c.hdgDeg * Math.PI) / 180;
      const x = c.pos[0] - Math.sin(h) * 1500;
      const z = c.pos[2] + Math.cos(h) * 1500;
      const g = Math.max(TR.heightAt(x, z), 0);
      placePlayer(sim, x, z, { headingDeg: c.hdgDeg, agl: Math.max(60, c.pos[1] - g), speed: Math.max(40, c.v * k) });
      return;
    }
    const dx = c.pos[0] - a.pos.x;
    const dy = c.pos[1] - a.pos.y;
    const dz = c.pos[2] - a.pos.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const spd = Math.max(40, c.v * k);
    a.vel.set((dx / d) * spd, (dy / d) * spd, (dz / d) * spd);
    a.pos.addScaledVector(a.vel, dt);
    const g = Math.max(TR.heightAt(a.pos.x, a.pos.z), 0);
    if (a.pos.y < g + 30) a.pos.y = g + 30;
    a.agl = a.pos.y - g;
    a.alt = a.pos.y;
    a.onGround = false;
    a.heading = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
    a.ias = spd;
    a.groundSpeed = spd;
    sim.camera.position.set(a.pos.x, a.pos.y + 3, a.pos.z + 12);
  };
}

export function summary(W) {
  return {
    seconds: Math.round(W.t),
    merged: +W.merged.toFixed(1),
    mergedFirst: W.mergedFirst,
    minPairOnGround: Number.isFinite(W.minPair) ? +W.minPair.toFixed(1) : null,
    throughPlayer: +W.player.toFixed(1),
    playerFirst: W.playerFirst,
    minToPlayerOnGround: Number.isFinite(W.minPlayer) ? +W.minPlayer.toFixed(1) : null,
    touching: +W.touch.toFixed(1),
    touchFirst: W.touchFirst,
    minGapOnGround: Number.isFinite(W.minGap) ? +W.minGap.toFixed(1) : null,
    touchingPlayer: +W.touchPlayer.toFixed(1),
    touchPlayerFirst: W.touchPlayerFirst,
    minGapToPlayer: Number.isFinite(W.minPlayerGap) ? +W.minPlayerGap.toFixed(1) : null,
    minAirPair: Number.isFinite(W.minAirPair) ? +W.minAirPair.toFixed(1) : null,
    minAirWhat: W.minAirWhat || '',
    airHit: +W.airHit.toFixed(1),
    airHitFirst: W.airHitFirst,
    tips: +W.tips.toFixed(1),
    tipsFirst: W.tipsFirst,
    under: W.under,
    underFirst: W.underFirst,
    nan: W.nan,
    departures: W.departures,
    parked: W.parkedArrivals,
    landed: W.landings,
    stillest: Math.round(W.stillest),
    stillWhy: W.stillWhy,
    longestWait: Math.round(W.longestWait),
    waitWhy: W.waitWhy,
    deadlocks: W.deadlocks,
    jumps: W.jumps,
    jumpFirst: W.jumpFirst,
    threw: W.threw,
  };
}
