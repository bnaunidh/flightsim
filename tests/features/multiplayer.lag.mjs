/**
 * The lag bench: how far behind, how jerky and how often backwards a friend's
 * aeroplane is drawn — before and after list 2's "less lag".
 *
 *   node tests/features/multiplayer.lag.mjs          # the table, and exit 1 if "after" is not better
 *   node tests/features/multiplayer.lag.mjs --json=<file>
 *
 * Plain node, no browser, no network, seeded — the same numbers every run.
 *
 * WHAT IS MODELLED. A friend flies (or drives) a known path for 60 s; their
 * game sends snapshots from its own frames, encoded and decoded by the
 * shipped protocol.js; each goes to the host and on to this player over two
 * Wi-Fi legs; this player's game draws them once a frame with the shipped
 * interp.js, and each drawn position is compared with where the friend
 * REALLY is at that moment. Chromebook-class: sender, host and receiver all
 * at 30 fps with ±15 % frame jitter and an occasional 80-230 ms hitch —
 * and a hitch in the SENDER's game stops its aeroplane, as the real game
 * does (main.js runs at most 0.1 s of physics a frame), so "where they
 * really are" stands still through it. A "struggling" sender hitches for
 * 100-400 ms one frame in thirty; an "overloaded" lobby runs every game at
 * 12 fps with pauses of up to 800 ms, which is what eight game tabs sharing
 * one Chrome on a Mac busy with other work looked like in the lobby playtest.
 *
 *   paths    trainer  Skylark, 55 m/s, S-turns at 30° of bank, climbing and sinking
 *            fighter  220-250 m/s, reversals from 70° one way to 70° the other at 180°/s
 *            heli     dashes to 30 m/s and stops, turning
 *            car      25 m/s, braking into sharp corners
 *   networks good     2 ms + 3 ms mean jitter per leg, 0.5 % late by 40-250 ms, 0.3 % lost
 *            busy     a class of 40 on one access point: 4 ms + 12 ms mean,
 *                     5 % late by 40-250 ms (retries, power save), 3 % lost
 *
 * The network figures are a MODEL of typical Wi-Fi, not a measurement of the
 * school's; tests/features/multiplayer.browser.js measures the real WebRTC
 * stack's packet counts. What the model is for is comparing two pipelines
 * on exactly the same traffic.
 *
 *   before   sent when 62.7 ms had passed since the last (so 10-15 Hz at
 *            20-30 fps), relayed by the host the moment each arrives,
 *            drawn with Track.sample: 100-350 ms in the past
 *   after    sent on a 15 Hz clock that keeps its average at any frame
 *            rate, bundled by the host (one packet per player every 50 ms
 *            or so instead of one per snapshot), drawn with Track.predict
 *            + Smoother (speed-scaled snap) + RotSmoother: now
 *   predict  the "after" drawing on the "before" network — how much of the
 *            gain is the drawing
 *   nocoast  "after" without slowing down when a friend's stream goes quiet
 *            and without the no-backwards rule (the first version: fine on a
 *            steady sender, 12.7 m p95 in the eight-tab playtest, where the
 *            tabs hitch)
 *
 * Measured per frame after a 3 s settle:
 *   trail    metres between where the friend is drawn and where they are
 *   behind   the same along their path, as milliseconds of their own travel
 *   hop      frames per minute where the drawn speed jumps by more than
 *            3 m/s or a quarter of their speed from one frame to the next
 *   back     frames per minute drawn moving backwards along the path
 *   rot      degrees between the attitude drawn and the real one (95th pct)
 */

global.document = { createElement: () => ({ getContext: () => null, width: 0, height: 0, style: {} }), body: { appendChild() {} } };
const P = await import('../../src/features/multiplayer/protocol.js');
const I = await import('../../src/features/multiplayer/interp.js');
const S = await import('../../src/features/multiplayer/session.js');

const arg = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  return pass;
};

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/* ---- quaternions, just enough -------------------------------------------- */
const qmul = (a, b) => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
const qaxis = (ax, ay, az, ang) => ({ x: ax * Math.sin(ang / 2), y: ay * Math.sin(ang / 2), z: az * Math.sin(ang / 2), w: Math.cos(ang / 2) });
/** Heading psi (0 north = -Z, east = +X), flight-path pitch theta, bank phi (right wing down positive). */
const attitude = (psi, theta, phi) => qmul(qmul(qaxis(0, 1, 0, -psi), qaxis(1, 0, 0, theta)), qaxis(0, 0, 1, -phi));

/* ---- the paths ------------------------------------------------------------ */
const G = 9.81;
const D2R = Math.PI / 180;
const approach = (x, target, rate, dt) => x + Math.max(-rate * dt, Math.min(rate * dt, target - x));

function makePath(kind, T = 62) {
  const dt = 0.005;
  const n = Math.ceil(T / dt) + 1;
  const px = new Float64Array(n), py = new Float64Array(n), pz = new Float64Array(n);
  const vx = new Float64Array(n), vy = new Float64Array(n), vz = new Float64Array(n);
  const q = new Array(n);
  let x = 0, y = kind === 'car' ? 0.6 : 400, z = 0;
  let psi = 0.3, phi = 0, v = kind === 'fighter' ? 220 : kind === 'heli' ? 0 : kind === 'car' ? 10 : 55;
  let yawRate = 0;
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    let climb = 0;
    if (kind === 'trainer') {
      phi = approach(phi, 30 * D2R * Math.sign(Math.sin((2 * Math.PI * t) / 12) || 1), 45 * D2R, dt);
      yawRate = (G * Math.tan(phi)) / v;
      climb = 3 * Math.sin((2 * Math.PI * t) / 20);
    } else if (kind === 'fighter') {
      v = 235 + 15 * Math.sin(t / 5);
      const phase = Math.floor(t / 5) % 3;
      phi = approach(phi, [70, -70, 0][phase] * D2R, 180 * D2R, dt);
      yawRate = (G * Math.tan(phi)) / v;
      climb = 15 * Math.sin((2 * Math.PI * t) / 15);
    } else if (kind === 'heli') {
      const want = 30 * Math.max(0, Math.min(1, 1.5 * Math.sin((2 * Math.PI * t) / 16)));
      v = approach(v, want, 4, dt);
      yawRate = approach(yawRate, 0.3 * Math.sign(Math.sin((2 * Math.PI * t) / 7) || 1), 0.6, dt);
      phi = Math.atan((yawRate * v) / G);
      climb = 2 * Math.sin((2 * Math.PI * t) / 11);
    } else {
      // a car: 6 s cycles — straight and fast, brake, a sharp corner, away
      const c = t % 6;
      const corner = c > 3.5 && c < 5;
      v = approach(v, corner ? 8 : 25, corner ? 9 : 4, dt);
      yawRate = approach(yawRate, corner ? (Math.floor(t / 6) % 2 ? 0.9 : -0.9) : 0, 3, dt);
      phi = 0;
    }
    psi += yawRate * dt;
    const theta = v > 0.5 ? Math.asin(Math.max(-0.5, Math.min(0.5, climb / Math.max(v, 1)))) : 0;
    const hv = v * Math.cos(theta);
    const cv = kind === 'car' ? 0 : v > 0.5 ? v * Math.sin(theta) : climb;
    vx[i] = hv * Math.sin(psi); vy[i] = cv; vz[i] = -hv * Math.cos(psi);
    x += vx[i] * dt; y += vy[i] * dt; z += vz[i] * dt;
    px[i] = x; py[i] = y; pz[i] = z;
    q[i] = attitude(psi, theta, phi);
  }
  return {
    at(tMs) {
      const f = Math.max(0, Math.min(n - 1.001, tMs / 1000 / dt));
      const i = Math.floor(f);
      const k = f - i;
      const L = (A) => A[i] + (A[i + 1] - A[i]) * k;
      return { pos: { x: L(px), y: L(py), z: L(pz) }, vel: { x: L(vx), y: L(vy), z: L(vz) }, quat: q[k < 0.5 ? i : i + 1] };
    },
  };
}

/* ---- frames, the network, the host ---------------------------------------- */
const SENDERS = {
  chromebook: { fps: 30, jitter: 0.3, hitch: 1 / 150, min: 80, span: 150 },
  struggling: { fps: 30, jitter: 0.3, hitch: 1 / 30, min: 100, span: 300 },
  // Every game on the network this slow, the host and this player too: the lobby playtest on a Mac
  // already busy with other work measured 10 fps and pauses of up to 900 ms in every tab.
  overloaded: { fps: 12, jitter: 1, hitch: 1 / 8, min: 150, span: 650 },
  // A sender whose game never hitches: what is left is the network's doing (the v56 Wi-Fi rows).
  steady: { fps: 30, jitter: 0.3, hitch: 0, min: 0, span: 0 },
  // A Chromebook with the whole island to draw: fifteen frames a second (measured in the Wi-Fi playtest).
  fifteen: { fps: 15, jitter: 0.3, hitch: 1 / 150, min: 80, span: 150 },
};
function frameTimes(rand, fps, T, sender = SENDERS.chromebook) {
  const out = [];
  let t = rand() * 30;
  const f = sender.fps || fps;
  while (t < T) {
    out.push(t);
    t += (1000 / f) * (1 + sender.jitter * (rand() - 0.5)) + (rand() < sender.hitch ? sender.min + rand() * sender.span : 0);
  }
  return out;
}
const NETS = {
  good: { base: 2, mean: 3, spike: 0.005, loss: 0.003 },
  busy: { base: 4, mean: 12, spike: 0.05, loss: 0.03 },
  /*
   * v56 ("multiplayer still laggy af"): a real network's delay, which the two
   * above leave out — they are the noise on top of almost none. Each leg has
   * its own latency, 60-150 ms (one player's Wi-Fi and internet; a world
   * lobby across town), ±40 ms of jitter on every packet, and 2 % lost: the
   * figures the Wi-Fi playtest (multiplayer.wifi.playtest.mjs) puts on the
   * real data channels.
   */
  wifi: { uniform: true, lat: [60, 150], jitter: 40, loss: 0.02 },
};
/** One Wi-Fi leg: how long, or null for lost. `L` is the leg's own latency, for a uniform net. */
function leg(rand, net, L = 0) {
  if (rand() < net.loss) return null;
  if (net.uniform) return L + (rand() * 2 - 1) * net.jitter;
  return net.base - Math.log(1 - rand()) * net.mean + (rand() < net.spike ? 40 + rand() * 210 : 0);
}
/** A leg's latency, for a uniform net (0 for the others, whose delay is all in leg()). */
const legLatency = (rand, net) => (net.uniform ? net.lat[0] + rand() * (net.lat[1] - net.lat[0]) : 0);
/**
 * What the game would read off the host's pings for a leg: the smallest of
 * ten round trips, halved (Remotes.setLatency is given the sum of a path's legs).
 */
function pingLatency(rand, net, L) {
  if (!net.uniform) return 0;
  let min = Infinity;
  for (let i = 0; i < 10; i++) min = Math.min(min, 2 * L + (rand() * 2 - 1) * net.jitter + (rand() * 2 - 1) * net.jitter);
  return min / 2;
}

const SENDER_CLOCK = 1234.5;
const RECEIVER_CLOCK = 987654.25;
const BUNDLE_MS = 50;

/**
 * The friend's snapshots, as they arrive at this player: [{ at (receiver clock), snap }].
 * `cadence`: 'old' (62.7 ms since the last) or 'new' (a 15 Hz clock).
 * `relay`: 'now' (the host forwards each on arrival) or 'bundle' (the host sends each player one packet
 * per ~50 ms, on the next of: another player's snapshot arriving, or its own frame).
 */
function traffic(path, { cadence, relay, net, seed, T, sender, bundleMs = BUNDLE_MS, direct = false, others = 6 }) {
  const rand = rng(seed);
  // Each leg's own latency (a uniform net), and what the pings would make of it.
  const L1 = legLatency(rand, net);
  const L2 = direct ? 0 : legLatency(rand, net);
  const pinged = pingLatency(rand, net, L1) + (direct ? 0 : pingLatency(rand, net, L2));
  const period = 1000 / P.STATE_HZ;
  const sends = [];
  let last = -Infinity;
  let next = -Infinity;
  // The sender's own game time: at most 100 ms of it per frame, as main.js.
  const frames = frameTimes(rand, 30, T, SENDERS[sender]);
  const simAt = new Float64Array(frames.length);
  for (let i = 1; i < frames.length; i++) simAt[i] = simAt[i - 1] + Math.min(frames[i] - frames[i - 1], 100);
  const trueAt = (t) => {
    let lo = 0;
    let hi = frames.length - 1;
    if (t <= frames[0]) return path.at(frames[0]);
    if (t >= frames[hi]) return path.at(simAt[hi] + (t - frames[hi]));
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (frames[m] <= t) lo = m;
      else hi = m;
    }
    // Between two of its frames, its game time runs on at the rate it will have reached the next.
    const k = (t - frames[lo]) / (frames[hi] - frames[lo]);
    return path.at(simAt[lo] + (simAt[hi] - simAt[lo]) * k);
  };
  for (let fi = 0; fi < frames.length; fi++) {
    const t = frames[fi];
    let go = false;
    if (cadence === 'old') {
      if (t - last >= period - 4) { go = true; last = t; }
    } else if (t >= next) {
      // As multiplayer.js frame(): a 15 Hz clock, started again from now after a stall.
      go = true;
      next += period;
      if (next < t - period) next = t + period;
    }
    if (!go) continue;
    const s = path.at(simAt[fi]);
    const buf = P.encodeState({ id: 3, seq: sends.length, t: t + SENDER_CLOCK, pos: s.pos, quat: s.quat, vel: s.vel, game: 'flight', type: 'skylark', engineOn: true });
    sends.push({ t, snap: P.decodeState(buf) });
  }
  // At the host.
  const atHost = [];
  for (const s of sends) {
    const l = leg(rand, net, L1);
    if (l !== null) atHost.push({ t: s.t + l, snap: s.snap });
  }
  atHost.sort((a, b) => a.t - b.t);
  const out = [];
  if (direct) {
    // The host watching a player: one leg, nothing relayed.
    for (const h of atHost) out.push({ at: h.t, snap: h.snap });
  } else if (relay === 'now' || bundleMs <= 0) {
    for (const h of atHost) {
      const l = leg(rand, net, L2);
      if (l !== null) out.push({ at: h.t + l, snap: h.snap });
    }
  } else {
    // The host's other reasons to look at its outbox: the other players' snapshots (Poisson, 15/s each) and its own frames.
    const events = atHost.map((h) => ({ t: h.t, ours: h.snap }));
    for (let t = 0; others > 0 && t < T; t += -Math.log(1 - rand()) * (1000 / (15 * others))) events.push({ t });
    for (const t of frameTimes(rand, 30, T, sender === 'overloaded' ? SENDERS.overloaded : SENDERS.chromebook)) events.push({ t });
    events.sort((a, b) => a.t - b.t);
    let pending = null;
    let theirs = false;
    let lastFlush = -Infinity;
    for (const e of events) {
      if (e.ours) pending = e.ours;
      else theirs = true;
      // A bundle goes when something is waiting for this player — ours, or the others'.
      if ((pending || theirs) && e.t - lastFlush >= bundleMs) {
        lastFlush = e.t;
        const l = leg(rand, net, L2);
        if (l !== null) out.push({ at: e.t + l, snap: pending, theirs });
        pending = null;
        theirs = false;
      }
    }
  }
  out.sort((a, b) => a.at - b.at);
  return { arrivals: out.map((o) => ({ at: o.at + RECEIVER_CLOCK, snap: o.snap, theirs: !!o.theirs })), sent: sends.length, trueAt, pinged };
}

/* ---- drawing, and scoring it -------------------------------------------- */
function pct(a, p) {
  if (!a.length) return 0;
  const b = Float64Array.from(a).sort();
  return b[Math.min(b.length - 1, Math.floor(b.length * p))];
}
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

function draw(trueAt, arrivals, { mode, seed, T, coast = true, sender = 'chromebook', track: topts = {}, smooth: sopts = {}, latency = 0, observer = null, held = false }) {
  const rand = rng(seed ^ 0x9e3779b9);
  const track = new I.Track(coast ? topts : { ...topts, stallMs: 0 });
  if (latency) track.setLatency(latency);
  const smooth = mode === 'sample' ? new I.Smoother() : new I.Smoother({ snapSecs: 0.6, noBack: coast, ...sopts });
  const rot = new I.RotSmoother();
  let k = 0;
  let prev = null;
  let prevT = null;
  const trail = [], behind = [], rotErr = [], velErr = [];
  let hop = 0, back = 0, frames = 0, stall = 0, surge = 0;
  let prevV = null;
  // When anything last came from the host: a bundle of the others' snapshots says the link is fine (Remotes passes this too).
  let othersAt = null;
  // `observer`: this player's own frames (else as the sender's); `held`: a snapshot that lands while this player's game is stopped is handled when it runs again, as a browser does.
  for (const t of frameTimes(rand, 30, T, observer ? SENDERS[observer] : sender === 'overloaded' ? SENDERS.overloaded : SENDERS.chromebook)) {
    const now = t + RECEIVER_CLOCK;
    while (k < arrivals.length && arrivals[k].at <= now) {
      const late = held && prevT !== null && t - prevT > 120 && arrivals[k].at > prevT + RECEIVER_CLOCK;
      if (arrivals[k].snap) track.push(arrivals[k].snap, late ? now : arrivals[k].at);
      // A bundle with anybody else's snapshot in it says the link is fine.
      if (!arrivals[k].snap || arrivals[k].theirs) othersAt = arrivals[k].at;
      k++;
    }
    const dt = prevT === null ? 1 / 30 : (t - prevT) / 1000;
    const s = mode === 'sample' ? track.sample(now) : track.predict(now, undefined, othersAt);
    if (!s) { prevT = t; continue; }
    const at = { ...smooth.step(s.pos, s.vel, dt) };
    const q = mode === 'sample' ? s.quat : { ...rot.step(s.quat, s.omega, dt) };
    const truth = trueAt(t);
    if (t > 3000 && prev) {
      frames++;
      const ex = at.x - truth.pos.x, ey = at.y - truth.pos.y, ez = at.z - truth.pos.z;
      trail.push(Math.hypot(ex, ey, ez));
      const sp = Math.hypot(truth.vel.x, truth.vel.y, truth.vel.z);
      if (sp > 3) behind.push((-(ex * truth.vel.x + ey * truth.vel.y + ez * truth.vel.z) / sp / sp) * 1000);
      rotErr.push(I.quatAngle(q, truth.quat) / D2R);
      // Against how they really moved this frame — standing still through their own game's hitch.
      const was = trueAt(prevT);
      const tx = (truth.pos.x - was.pos.x) / dt, ty = (truth.pos.y - was.pos.y) / dt, tz = (truth.pos.z - was.pos.z) / dt;
      const tsp = Math.hypot(tx, ty, tz);
      const ax = (at.x - prev.x) / dt, ay = (at.y - prev.y) / dt, az = (at.z - prev.z) / dt;
      velErr.push(Math.hypot(ax - tx, ay - ty, az - tz));
      // Drawn at under half, or over one and a half times, the speed they really went this frame: a stall or a surge.
      if (tsp > 3) {
        const along = (ax * tx + ay * ty + az * tz) / tsp;
        if (along < 0.5 * tsp && along > -0.05 / dt) stall++;
        else if (along > 1.5 * tsp) surge++;
      }
      if (prevV && Math.hypot(ax - prevV.x, ay - prevV.y, az - prevV.z) > Math.max(3, 0.25 * sp)) hop++;
      prevV = { x: ax, y: ay, z: az };
      // Backwards along their path by more than a few centimetres: a rubber band.
      if (sp > 3 && (ax * truth.vel.x + ay * truth.vel.y + az * truth.vel.z) / sp * dt < -0.05) back++;
    }
    prev = at;
    prevT = t;
  }
  const perMin = (x) => +(x / (frames / 30 / 60)).toFixed(1);
  return {
    trailMean: +mean(trail).toFixed(2), trailP95: +pct(trail, 0.95).toFixed(2), trailMax: +pct(trail, 1).toFixed(1),
    behindMs: Math.round(mean(behind)), rotP95: +pct(rotErr, 0.95).toFixed(1),
    velErrP95: +pct(velErr, 0.95).toFixed(1), hopPerMin: perMin(hop), backPerMin: perMin(back),
    stallPerMin: perMin(stall), surgePerMin: perMin(surge),
  };
}

/* ---- the run --------------------------------------------------------------- */
const T = 62000;
const CONFIGS = {
  before: { cadence: 'old', relay: 'now', mode: 'sample' },
  predict: { cadence: 'old', relay: 'now', mode: 'predict' },
  nocoast: { cadence: 'new', relay: 'bundle', mode: 'predict', coast: false },
  after: { cadence: 'new', relay: 'bundle', mode: 'predict' },
};
const table = {};
let seed = 11;
const runs = [];
for (const kind of ['trainer', 'fighter', 'heli', 'car']) for (const net of ['good', 'busy']) runs.push({ kind, net, sender: 'chromebook' });
for (const kind of ['trainer', 'fighter']) runs.push({ kind, net: 'busy', sender: 'struggling' });
runs.push({ kind: 'trainer', net: 'good', sender: 'overloaded' });
const paths = {};
for (const { kind, net, sender } of runs) {
  const path = paths[kind] || (paths[kind] = makePath(kind));
  seed += 101;
  for (const [name, c] of Object.entries(CONFIGS)) {
    const tr = traffic(path, { ...c, net: NETS[net], seed, T, sender });
    const m = draw(tr.trueAt, tr.arrivals, { mode: c.mode, seed, T, coast: c.coast !== false, sender, track: name === 'before' ? { offsetUp: 4, offsetDown: 4, offsetWinMs: 3000 } : {} });
    table[`${kind}/${net}${sender !== 'chromebook' ? `+${sender}` : ''}/${name}`] = { ...m, sentHz: +(tr.sent / (T / 1000)).toFixed(1) };
  }
}

const cols = ['trailMean', 'trailP95', 'trailMax', 'behindMs', 'hopPerMin', 'backPerMin', 'rotP95', 'sentHz'];
console.log(`\n${'path/network/pipeline'.padEnd(36)}${cols.map((c) => c.padStart(13)).join('')}`);
for (const [k, v] of Object.entries(table)) console.log(`${k.padEnd(36)}${cols.map((c) => String(v[c]).padStart(13)).join('')}`);
console.log('');

for (const { kind, net: n0, sender } of runs) {
  {
    const net = `${n0}${sender !== 'chromebook' ? `+${sender}` : ''}`;
    const b = table[`${kind}/${net}/before`];
    const a = table[`${kind}/${net}/after`];
    if (sender !== 'chromebook') {
      /*
       * A friend whose own game stalls about once a second is the hard case:
       * where they really are stops and starts. Nearer on average and never
       * pulled backwards (the old way slid them back 30-40 times a minute),
       * but the worst moments are about as far off as before.
       */
      // Overloaded — every game in the lobby at 12 fps with long pauses — is only asked to be better, not much better.
      const [mk, pk] = sender === 'overloaded' ? [1, 1] : [0.6, 1.25];
      ok(`${kind} on ${net} Wi-Fi: nearer on average, never pulled backwards, the worst moments no worse than before${sender === 'overloaded' ? '' : ' by a quarter'}`,
        a.trailMean < b.trailMean * mk && a.backPerMin <= b.backPerMin && a.trailP95 < b.trailP95 * pk,
        `mean ${b.trailMean} → ${a.trailMean} m, p95 ${b.trailP95} → ${a.trailP95} m, backwards ${b.backPerMin} → ${a.backPerMin}/min`);
    } else {
      ok(`${kind} on ${net} Wi-Fi: drawn closer to where they really are (95th percentile)`, a.trailP95 < b.trailP95 * 0.5 + 0.3, `${b.trailP95} m → ${a.trailP95} m; ${b.behindMs} ms behind → ${a.behindMs} ms`);
    }
    ok(`${kind} on ${net} Wi-Fi: no more backwards frames than before, and speed hops within reason`,
      a.hopPerMin <= b.hopPerMin * 2 + 3 && a.backPerMin <= b.backPerMin + 1, `hops ${b.hopPerMin} → ${a.hopPerMin}/min, backwards ${b.backPerMin} → ${a.backPerMin}/min`);
  }
}
{
  const trainer = table['trainer/busy/after'];
  ok('a Skylark in S-turns on a busy classroom Wi-Fi is drawn within 2 m of where it is, 95 % of the time (was 10)', trainer.trailP95 < 2, `${trainer.trailP95} m (before: ${table['trainer/busy/before'].trailP95} m)`);
  const sent = ['trainer', 'fighter', 'heli', 'car'].map((k) => table[`${k}/busy/after`].sentHz);
  ok('a 30 fps game with hitches still sends 15 snapshots a second', sent.every((hz) => hz > 14 && hz < 15.3), `${sent.join(', ')} Hz (before: ${table['trainer/busy/before'].sentHz} Hz)`);
}
/*
 * v56: "multiplayer still laggy af". Everything above is on a network with
 * almost no delay — the noise on top of nothing, as loopback is — and that is
 * where every earlier pass was tuned. A real one has 60-150 ms on each leg and
 * ±40 ms of jitter (NETS.wifi). Three ways of being in a game:
 *
 *   relay3   a player watching another player, through the host, in a game of three
 *   relay8   the same in a lobby of eight
 *   direct   the host watching a player (one leg; also a player watching the host in a game of two)
 *
 * and the pipelines:
 *
 *   v55      what is live: the fixed 220 ms "they have stopped" rule, no
 *            latency put back, seams under 25 cm drawn as steps
 *   v56      the quiet allowed grows with the network's own lateness, the
 *            trip's latency (from the host's pings) is put back, every seam
 *            is slid over, and the host relays at once in a small game
 *   +stall, +lead   one change each on top of v55, to see which does what
 */
// v55's clock offset: three seconds, 4 ms a packet either way (interp.js has eight seconds, quicker down, since lag pass 3).
const OLD_CLOCK = { offsetUp: 4, offsetDown: 4, offsetWinMs: 3000 };
const WIFI = {
  v55: { track: { jitterStall: false, ...OLD_CLOCK }, smooth: {}, lead: 0, bundleMs: 50, cadence: 'new' },
  '+stall': { track: { ...OLD_CLOCK }, smooth: {}, lead: 0, bundleMs: 50, cadence: 'new' },
  '+lead': { track: { jitterStall: false, ...OLD_CLOCK }, smooth: {}, lead: 1, bundleMs: 50, cadence: 'new' },
  '+relay': { track: { jitterStall: false, ...OLD_CLOCK }, smooth: {}, lead: 0, bundleMs: null, cadence: 'new' },
  '+seams': { track: { jitterStall: false, ...OLD_CLOCK }, smooth: { ignoreM: 0.02 }, lead: 0, bundleMs: 50, cadence: 'new' },
  v56: { track: {}, smooth: { ignoreM: 0.02 }, lead: I.LEAD_K, bundleMs: null, cadence: 'new' },
};
const wtable = {};
const SENDS = arg('senders') ? arg('senders').split(',') : ['steady', 'chromebook', 'fifteen'];
for (const sender of SENDS) {
  for (const kind of ['trainer', 'fighter', 'heli', 'car']) {
    for (const topo of ['relay3', 'relay8', 'direct']) {
      seed += 101;
      const path = paths[kind] || (paths[kind] = makePath(kind));
      const others = topo === 'relay3' ? 1 : topo === 'relay8' ? 6 : 0;
      for (const [name, c] of Object.entries(WIFI)) {
        // v56's host relays at once in a small game (session.js, bundleFor).
        const bundleMs = c.bundleMs ?? S.bundleFor(others + 1);
        const tr = traffic(path, { cadence: c.cadence, relay: 'bundle', net: NETS.wifi, seed, T, sender, bundleMs, direct: topo === 'direct', others });
        const m = draw(tr.trueAt, tr.arrivals, { mode: 'predict', seed, T, sender, track: c.track, smooth: c.smooth, latency: tr.pinged * c.lead });
        wtable[`${kind}/${topo}/${sender === 'chromebook' ? 'hitchy' : sender}/${name}`] = { ...m, sentHz: +(tr.sent / (T / 1000)).toFixed(1) };
      }
    }
  }
}
const wcols = ['trailMean', 'trailP95', 'trailMax', 'behindMs', 'hopPerMin', 'stallPerMin', 'surgePerMin', 'backPerMin', 'rotP95', 'sentHz'];
console.log(`\n${'wifi: path/game/pipeline'.padEnd(36)}${wcols.map((c) => c.padStart(13)).join('')}`);
for (const [k, v] of Object.entries(wtable)) console.log(`${k.padEnd(36)}${wcols.map((c) => String(v[c]).padStart(13)).join('')}`);
console.log('');
for (const kind of ['trainer', 'fighter', 'heli', 'car']) {
  for (const topo of ['relay3', 'relay8', 'direct']) {
    if (SENDS.includes('steady')) {
      // A steady sender: every stall, surge and hop is the network's and the drawing's.
      const b = wtable[`${kind}/${topo}/steady/v55`];
      const a = wtable[`${kind}/${topo}/steady/v56`];
      const jerks = (x) => x.stallPerMin + x.surgePerMin + x.hopPerMin;
      ok(`${kind}, ${topo}, real Wi-Fi: drawn nearer where they are (mean ${b.trailMean} → ${a.trailMean} m)`, a.trailMean < b.trailMean * 0.8 + 0.2, `${b.behindMs} → ${a.behindMs} ms behind; p95 ${b.trailP95} → ${a.trailP95} m`);
      ok(`${kind}, ${topo}, real Wi-Fi: smoother — fewer stalls, surges and hops, never more backwards`, jerks(a) <= jerks(b) * 0.6 + 2 && a.backPerMin <= b.backPerMin + 0.5,
        `stall ${b.stallPerMin} → ${a.stallPerMin}, surge ${b.surgePerMin} → ${a.surgePerMin}, hops ${b.hopPerMin} → ${a.hopPerMin}, backwards ${b.backPerMin} → ${a.backPerMin} a minute`);
    }
    if (SENDS.includes('fifteen')) {
      // A game at fifteen frames a second, as each of three games in one Chrome ran in the Wi-Fi playtest.
      const b = wtable[`${kind}/${topo}/fifteen/v55`];
      const a = wtable[`${kind}/${topo}/fifteen/v56`];
      ok(`${kind}, ${topo}, real Wi-Fi, a sender at 15 fps: still sends 15 a second, and is drawn nearer`, a.sentHz > 14 && a.trailMean < b.trailMean,
        `${b.sentHz} → ${a.sentHz} Hz; mean ${b.trailMean} → ${a.trailMean} m, p95 ${b.trailP95} → ${a.trailP95} m`);
    }
    if (SENDS.includes('chromebook')) {
      // A sender that hitches as a Chromebook does: no worse than before anywhere, and nearer.
      const b = wtable[`${kind}/${topo}/hitchy/v55`];
      const a = wtable[`${kind}/${topo}/hitchy/v56`];
      ok(`${kind}, ${topo}, real Wi-Fi, a hitching sender: nearer on average, the worst moments no worse, never more backwards`,
        a.trailMean < b.trailMean + 0.2 && a.trailP95 < b.trailP95 * 1.15 + 0.3 && a.backPerMin <= b.backPerMin + 0.5,
        `mean ${b.trailMean} → ${a.trailMean} m, p95 ${b.trailP95} → ${a.trailP95} m, backwards ${b.backPerMin} → ${a.backPerMin}/min`);
    }
  }
}

/*
 * Lag pass 3: THIS player's game struggling — twelve frames a second with
 * stops of up to 800 ms, as every tab in the Wi-Fi playtest on a busy Mac —
 * and every snapshot that lands during a stop handled when it runs again.
 * The clock offset was the smallest (arrival − sent) of three seconds,
 * moving as slowly down as up: a few stops in a row and the whole window was
 * late, the estimate crept up, and friends were drawn hundreds of ms behind
 * for seconds after. Now eight seconds, quicker down than up (interp.js).
 */
const OBS = {
  'v55': { track: { jitterStall: false, ...OLD_CLOCK }, smooth: {}, lead: 0, bundleMs: 50 },
  'v56-3s': { track: { ...OLD_CLOCK }, smooth: { ignoreM: 0.02 }, lead: I.LEAD_K, bundleMs: null },
  'now': { track: {}, smooth: { ignoreM: 0.02 }, lead: I.LEAD_K, bundleMs: null },
};
const otable = {};
for (const sender of ['steady', 'chromebook']) {
  for (const kind of ['trainer', 'fighter', 'heli', 'car']) {
    for (const topo of ['relay3', 'direct']) {
      seed += 101;
      const path = paths[kind] || (paths[kind] = makePath(kind));
      const others = topo === 'relay3' ? 1 : 0;
      for (const [name, c] of Object.entries(OBS)) {
        const bundleMs = c.bundleMs ?? S.bundleFor(others + 1);
        const tr = traffic(path, { cadence: 'new', relay: 'bundle', net: NETS.wifi, seed, T, sender, bundleMs, direct: topo === 'direct', others });
        const m = draw(tr.trueAt, tr.arrivals, { mode: 'predict', seed, T, sender, track: c.track, smooth: c.smooth, latency: tr.pinged * c.lead, observer: 'overloaded', held: true });
        otable[`${kind}/${topo}/${sender === 'chromebook' ? 'hitchy' : sender}/${name}`] = m;
      }
    }
  }
}
console.log(`\n${'struggling player: path/game/pipeline'.padEnd(40)}${wcols.slice(0, -1).map((c) => c.padStart(13)).join('')}`);
for (const [k, v] of Object.entries(otable)) console.log(`${k.padEnd(40)}${wcols.slice(0, -1).map((c) => String(v[c]).padStart(13)).join('')}`);
console.log('');
for (const sender of ['steady', 'hitchy']) {
  const rows = (name) => Object.entries(otable).filter(([k]) => k.includes(`/${sender}/`) && k.endsWith(`/${name}`)).map(([, v]) => v);
  const avg = (a, f) => +(a.reduce((x, v) => x + v[f], 0) / a.length).toFixed(2);
  const [o, b, a] = ['v55', 'v56-3s', 'now'].map(rows);
  ok(`a struggling player (12 fps, stops to 800 ms), ${sender} friends: drawn nearer than v55 and than the three-second clock`,
    avg(a, 'trailMean') < avg(b, 'trailMean') && avg(a, 'trailMean') < avg(o, 'trailMean') * 0.5 && avg(a, 'trailP95') < avg(b, 'trailP95'),
    `mean ${avg(o, 'trailMean')} → ${avg(b, 'trailMean')} → ${avg(a, 'trailMean')} m, p95 ${avg(o, 'trailP95')} → ${avg(b, 'trailP95')} → ${avg(a, 'trailP95')} m, behind ${avg(o, 'behindMs')} → ${avg(b, 'behindMs')} → ${avg(a, 'behindMs')} ms (v55 → v56 with the 3 s clock → now)`);
  // Drawn nearer now, a hitching friend is run into a little more often as they stop: within a tenth.
  ok(`a struggling player, ${sender} friends: stalls and surges within a tenth of the three-second clock's, never more backwards`,
    avg(a, 'stallPerMin') <= avg(b, 'stallPerMin') * 1.1 + 0.5 && avg(a, 'surgePerMin') <= avg(b, 'surgePerMin') * 1.1 + 0.5 && avg(a, 'backPerMin') <= avg(b, 'backPerMin') + 0.5,
    `stall ${avg(b, 'stallPerMin')} → ${avg(a, 'stallPerMin')}, surge ${avg(b, 'surgePerMin')} → ${avg(a, 'surgePerMin')}, backwards ${avg(b, 'backPerMin')} → ${avg(a, 'backPerMin')} a minute`);
}

if (arg('json')) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(arg('json'), JSON.stringify({ table, wifi: wtable, struggling: otable, results }, null, 1));
}
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
