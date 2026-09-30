/**
 * Node checks for the rocket game. Run with plain node:
 *
 *   node tests/features/rocket.mjs            (add --verbose for every flight's events)
 *
 * No page and no graphics card: the flight model (features/rocket/physics.js),
 * the flight itself (rocket/flights.js) and the launch-site finder
 * (rocket/site.js) are pure numbers on purpose, and this runs them.
 *
 *   1. The planet: gravity, the air thinning out, what an orbit is.
 *   2. Every rocket can do its job with a margin, and no more than it should.
 *   3. A ROBOT PILOT flies all four missions and has to win each, cleanly
 *      and with a wobble; and it has to LOSE them when flown wrong — never
 *      steering the booster, never holding SPACE, leaning over on the way
 *      up, never firing at the top of the orbit climb.
 *   4. The goal is on screen for every step of every flight, short enough
 *      to read at a glance.
 *   5. A launch site on every map: on land where there is room, never on a
 *      runway, with the sea in front and the ship on open water.
 */

globalThis.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};

const root = new URL('../../src/', import.meta.url);
const imp = (p) => import(new URL(p, root).href);

const P = await imp('features/rocket/physics.js');
const F = await imp('features/rocket/flights.js');
const SITE = await imp('features/rocket/site.js');
const T = await imp('world/terrain.js');
const { MAPS } = await imp('world/maps.js');

const VERBOSE = process.argv.includes('--verbose');
let passed = 0;
let failed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const { PLANET, ROCKETS, Body, stepBody, orbitOf, circularSpeed, airDensity } = P;
const { Flight, robotInput, ROCKET_MISSIONS, GOALS, SOFT } = F;

/* 1. The planet ------------------------------------------------------- */
{
  const b = new Body({ role: 't', stages: [], payload: { mass: 100 }, pos: { x: 0, y: PLANET.R }, vel: { x: 0, y: 0 } });
  const before = b.vel.y;
  stepBody(b, 1 / 60, {});
  const g = (before - b.vel.y) * 60;
  ok('gravity at the surface is the Earth’s', Math.abs(g - 9.81) < 0.02, `${g.toFixed(3)} m/s²`);
  ok('the air thins out: half as thick about every 5 km, none in space', airDensity(0) > 1.2 && airDensity(4852) < 0.62 && airDensity(4852) > 0.6 && airDensity(150000) === 0);
  const v = circularSpeed(PLANET.R + 100000);
  ok('going round at 100 km takes about 2,250 m/s — a small planet', v > 2200 && v < 2300, `${v.toFixed(0)} m/s`);
  // A circular orbit stays one for a whole lap.
  const o = new Body({ role: 't', stages: [], payload: { mass: 100 }, pos: { x: 0, y: PLANET.R + 120000 }, vel: { x: circularSpeed(PLANET.R + 120000), y: 0 } });
  const period = (2 * Math.PI * o.r) / o.speed;
  let lo = Infinity;
  let hi = -Infinity;
  for (let t = 0; t < period; t += 1 / 60) {
    stepBody(o, 1 / 60, {});
    lo = Math.min(lo, o.alt);
    hi = Math.max(hi, o.alt);
  }
  ok('a circular orbit stays within 1 km of its height for a whole lap', hi - lo < 1000, `${(lo / 1000).toFixed(1)}–${(hi / 1000).toFixed(1)} km over ${(period / 60).toFixed(0)} min`);
  const oe = orbitOf(o);
  ok('orbitOf reads that orbit as round', Math.abs(oe.apoapsis - oe.periapsis) < 2000, `${(oe.periapsis / 1000).toFixed(0)}–${(oe.apoapsis / 1000).toFixed(0)} km`);
  const up = new Body({ role: 't', stages: [], payload: { mass: 100 }, pos: { x: 0, y: PLANET.R + 1000 }, vel: { x: 0, y: 1000 } });
  const ou = orbitOf(up);
  ok('straight up is not an orbit, and its top is finite', ou.periapsis < -PLANET.R * 0.9 && ou.apoapsis > 50000 && ou.apoapsis < 70000, `top ${(ou.apoapsis / 1000).toFixed(1)} km`);
}

/* 2 + 3. Every mission, flown ----------------------------------------- */
const fakeSite = {
  padY: 7,
  lzS: -SITE.LZ_BACK,
  bargeS: 9000,
  surface(s) {
    if (Math.abs(s) < SITE.PAD_HALF) return { y: 7, kind: 'pad' };
    if (Math.abs(s + SITE.LZ_BACK) < SITE.LZ_R) return { y: 6.5, kind: 'lz' };
    if (Math.abs(s - 9000) < SITE.BARGE_HALF) return { y: SITE.BARGE_DECK, kind: 'barge' };
    if (s > -2500 && s < 2200) return { y: 6, kind: 'land' };
    return { y: 0, kind: 'sea' };
  },
};

function fly(m, opts = {}, site = fakeSite) {
  const f = new Flight({ rocket: m.rocket, goal: m.goal, site, mission: m.id, helper: opts.helper !== false });
  const events = [];
  let steps = 0;
  let objBad = 0;
  let longest = 0;
  let longText = '';
  let warpMax = 0;
  while (!f.done && steps < 60 * 60 * 12) {
    robotInput(f, opts);
    f.step();
    steps++;
    for (const e of f.drain()) events.push(e.type);
    const o = f.objective();
    if (!o || !o.title || !o.text) objBad++;
    if (o && o.text.length > longest) { longest = o.text.length; longText = o.text; }
    warpMax = Math.max(warpMax, f.warpCap());
  }
  if (VERBOSE) console.log(`      ${m.id} ${JSON.stringify(opts)}: ${events.join(' ')}`);
  return { f, events, objBad, longest, longText, secs: steps / 60, warpMax };
}

for (const m of ROCKET_MISSIONS) {
  const clean = fly(m);
  const r = clean.f.result;
  ok(`${m.name}: the robot wins it`, r && r.success, r ? `${r.title} · ${r.score}/100 · ${r.reason}` : 'no result');
  const wob = fly(m, { sloppy: 10 });
  ok(`${m.name}: the robot wins it with a 10° wobble`, wob.f.result && wob.f.result.success, wob.f.result ? `${wob.f.result.title} · ${wob.f.result.score}/100` : 'no result');
  ok(`${m.name}: the goal is on screen at every step`, clean.objBad === 0 && wob.objBad === 0, `${clean.objBad + wob.objBad} steps without one`);
  ok(`${m.name}: the goal is short enough to read at a glance`, clean.longest <= 150, `longest ${clean.longest}: "${clean.longText}"`);
  ok(`${m.name}: done in under six minutes of flight`, clean.secs < 360, `${clean.secs.toFixed(0)} s`);
  ok(`${m.name}: the flight begins with a countdown and lift-off`, clean.events.indexOf('countdown') >= 0 && clean.events.indexOf('liftoff') > clean.events.indexOf('countdown'));
  if (m.goal !== 'space') {
    ok(`${m.name}: a stage is dropped on the way`, clean.events.includes('separation'));
  }
}

const byId = Object.fromEntries(ROCKET_MISSIONS.map((m) => [m.id, m]));
{
  const r = fly(byId['rocket-space']).f;
  ok('First Launch: it goes past 100 km and the result says how high', r.result.success && /\d+ km/.test(r.result.reason) && r.focus.maxAlt > PLANET.SPACE, r.result.reason);
  const lean = fly(byId['rocket-space'], { leanOver: 50 }).f.result;
  ok('First Launch: leaning 50° over loses it, and says why', lean && !lean.success && /straight/i.test(lean.reason), lean && lean.reason);
}
{
  const r = fly(byId['rocket-home']);
  const b = r.f.booster;
  ok('Come Home: the booster lands upright, gently, on the landing pad', r.f.result.success && b.landed && !b.crashed && r.f.site.surface(b.downrange).kind === 'lz', r.f.result.reason);
  ok('Come Home: the upper stage flies itself on to space meanwhile', r.events.includes('upper-space'));
  ok('Come Home: the legs come out before touchdown', r.events.indexOf('legs') >= 0 && r.events.indexOf('legs') < r.events.indexOf('touchdown'));
  const noBurn = fly(byId['rocket-home'], { noBurn: true }).f.result;
  ok('Come Home: never holding SPACE crashes it, and says hold SPACE', noBurn && !noBurn.success && /hold SPACE/i.test(noBurn.reason), noBurn && noBurn.reason);
  const pro = fly(byId['rocket-home'], { noBurn: true, helper: false }).f.result;
  ok('Come Home: without the helper, never burning still crashes', pro && !pro.success, pro && pro.title);
  ok(`Come Home: the soft-landing limits are kind (${SOFT.down} m/s down, ${SOFT.side} sideways)`, SOFT.down >= 5 && SOFT.side >= 4);
}
{
  const lazy = fly(byId['rocket-barge'], { lazyLanding: true }).f.result;
  ok('Ship Landing: never steering the booster misses the ship', lazy && !lazy.success, lazy && `${lazy.title}: ${lazy.reason}`);
  const lazyPad = fly(byId['rocket-home'], { lazyLanding: true }).f.result;
  ok('Come Home: never steering misses the pad too (the wind sees to it)', lazyPad && !lazyPad.success, lazyPad && lazyPad.reason);
}
{
  const r = fly(byId['rocket-satellite']);
  const o = orbitOf(r.f.satellite);
  ok('Satellite Delivery: the satellite really is in orbit — its lowest point is above the air', o.periapsis >= PLANET.ORBIT_MIN && o.apoapsis < 1e6, `${(o.periapsis / 1000).toFixed(0)}–${(o.apoapsis / 1000).toFixed(0)} km`);
  ok('Satellite Delivery: two burns — engine off at the climb, on again at the top', r.events.indexOf('cut') > 0 && r.events.indexOf('relight') > r.events.indexOf('cut'));
  ok('Satellite Delivery: the nose cone opens on the way', r.events.includes('fairing'));
  const spare = r.f.upper.stage.fuelLeft / r.f.upper.stage.fuel;
  ok('Satellite Delivery: a perfect flight has fuel to spare, but not a tankful', spare > 0.1 && spare < 0.45, `${(spare * 100).toFixed(0)}% left`);
  // Never firing at the top.
  const f = new Flight({ rocket: 'albatross', goal: 'orbit', site: fakeSite, mission: 'x' });
  let n = 0;
  while (!f.done && n < 60 * 600) {
    robotInput(f);
    if (f.phase === 'coast') f.input.action = false;
    f.step();
    n++;
  }
  ok('Satellite Delivery: never firing at the top loses it, and says so', f.result && !f.result.success && /top/i.test(f.result.reason), f.result && f.result.reason);
  ok('Satellite Delivery: time can be sped up while it coasts, never while it lands', r.warpMax >= 4 && new Flight({ rocket: 'petrel', goal: 'land-pad', site: fakeSite }).warpCap() === 1);
}
{
  // Every rocket in the picker can do each of its goals.
  for (const id of Object.keys(ROCKETS)) {
    for (const g of ROCKETS[id].goals) {
      const r = fly({ id: `${id}-${g}`, rocket: id, goal: g });
      ok(`picker: ${ROCKETS[id].name} can ${GOALS[g].name.toLowerCase()}`, r.f.result && r.f.result.success, r.f.result && r.f.result.title);
    }
  }
}

/* 4b. A CHILD'S HANDS ------------------------------------------------------
 * The robot above leans by fractions of a key. A child cannot: ◀ ▶ and
 * SPACE are on or off, on the keyboard and on the touch pads alike. This
 * pilot presses only whole keys, looks at the screen four times a second,
 * and acts 0.35 s after it looks — and it reads ONLY what the screen says:
 * the goal line, the dial's word, the action button, and the landing card
 * (distance, sliding, coming down). It has to land the booster by doing
 * what the screen tells it, most of the time.
 */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * steer: 'card'    hold the way the card points; let go at "Right over it"
 *                  (or at `letGoAt` metres, for a child who lets go early)
 *        'careful' the same, but let go — or push back — when it closes fast
 *        'none'    never touch ◀ ▶ while landing
 * space: 'prompt'  hold SPACE from when the screen says "Hold SPACE!"
 *        'always'  hold it from the moment it is your turn
 */
function kid({ lag = 0.35, look = 0.25, steer = 'card', space = 'prompt', letGoAt = 0, lateStart = 0, seed = 1 } = {}) {
  const rand = seeded(seed);
  const st = { queue: [], nextLook: -1, lean: 0, burn: false, latched: false, prev: null, prevAt: 0, turnAt: null };
  function read(f) {
    const o = f.objective();
    const p = f.phase;
    const dec = { lean: 0, burn: false, action: false };
    if (p === 'pad' || f.flags.stageWaiting) {
      dec.action = true; // LAUNCH, DROP STAGE: the button says press
      return dec;
    }
    if (p === 'ascent' || p === 'coast' || p === 'circ' || p === 'orbit') {
      const err = (f.guide() - f.focus.tilt) / P.DEG; // the dial's word: Lean ▶ / Lean ◀ / On the green
      if (Math.abs(err) >= 5) dec.lean = err > 0 ? 1 : -1;
      if (/Fire the engine/.test(o.title) || p === 'orbit') dec.action = true;
      return dec;
    }
    if (p !== 'landing') return dec;
    if (st.turnAt === null) st.turnAt = f.t;
    const L = f.landingInfo();
    const d = L.over ? 0 : Math.round(L.dist); // what the card shows
    if (space === 'always') dec.burn = true;
    else {
      if (/Hold SPACE!/.test(o.title)) st.latched = true;
      dec.burn = st.latched;
    }
    if (steer === 'none' || f.t - st.turnAt < lateStart) return dec;
    if (steer === 'card') {
      if (!L.over && Math.abs(d) >= letGoAt) dec.lean = Math.sign(d);
    } else if (steer === 'careful') {
      const closing = st.prev === null ? 0 : (Math.abs(st.prev) - Math.abs(d)) / Math.max(0.05, f.t - st.prevAt);
      if (Math.abs(d) >= 12 && closing < Math.min(40, Math.abs(d) / 6)) dec.lean = Math.sign(d);
      else if (closing > Math.abs(d) / 4 + 2) dec.lean = -Math.sign(d);
    }
    st.prev = d;
    st.prevAt = f.t;
    return dec;
  }
  return function drive(f) {
    if (f.t >= st.nextLook) {
      st.nextLook = f.t + look + (rand() - 0.5) * 0.2;
      st.queue.push({ at: f.t + lag + rand() * 0.1, dec: read(f) });
    }
    let action = false;
    while (st.queue.length && st.queue[0].at <= f.t) {
      const d = st.queue.shift().dec;
      st.lean = d.lean;
      st.burn = d.burn;
      if (d.action) action = true;
    }
    f.input.lean = st.lean;
    f.input.burn = st.burn;
    f.input.action = action;
  };
}

function flyWith(f, drive) {
  let n = 0;
  while (!f.done && n < 60 * 60 * 12) {
    drive(f);
    f.step();
    f.drain();
    n++;
  }
  return f;
}

{
  T.applyMap('kestrel');
  const ks = SITE.findLaunchSite({ heightAt: T.heightAt, islands: T.MAP.islands, blocked: (x, z, r) => T.isOnAnyRunway(x, z, r + 160) });
  const kestrel = { padY: ks.pad.y + 1.2, surface: SITE.surfaceFor(ks, T.heightAt), lzS: ks.lzS, bargeS: ks.bargeS };
  const styles = [
    { name: 'holds the way the card points', o: {} },
    { name: 'holds SPACE all the way down', o: { space: 'always' } },
    { name: 'lets go or pushes back when it closes fast', o: { steer: 'careful' } },
    { name: 'is slow (0.6 s late, looks 2½ times a second)', o: { lag: 0.6, look: 0.4 } },
    { name: 'starts steering 6 s after "your turn"', o: { lateStart: 6 } },
  ];
  for (const [id, need] of [['rocket-home', 10], ['rocket-barge', 9]]) {
    const m = byId[id];
    // Three whole flights, the climb flown by the child too; each handover is
    // then landed by every kind of child, four times, with different timing.
    const handovers = [];
    for (let i = 0; i < 3; i++) {
      const f = new Flight({ rocket: m.rocket, goal: m.goal, site: kestrel, mission: m.id });
      flyWith(f, kid({ seed: 100 + i }));
      if (f.handover) handovers.push(f.handover);
    }
    ok(`${m.name}: a child's hands get the booster to the handover every time`, handovers.length === 3, `${handovers.length}/3`);
    for (const s of styles) {
      let wins = 0;
      const why = {};
      let n = 0;
      for (const h of handovers) {
        for (let j = 0; j < 4; j++) {
          const f = new Flight({ rocket: m.rocket, goal: m.goal, site: kestrel, mission: m.id }).resumeFrom(h);
          flyWith(f, kid({ ...s.o, seed: 7 + n * 13 }));
          n++;
          if (f.result && f.result.success) wins++;
          else {
            const k = f.result ? `${f.result.title} ${(f.result.reason.match(/\d+ m\/s|[\d,]+ m (past|short of|from)/) || [''])[0]}` : 'no result';
            why[k] = (why[k] || 0) + 1;
          }
        }
      }
      ok(`${m.name}: a child who ${s.name} lands it (${need}+ of ${n})`, wins >= need && n === 12, `${wins}/${n} ${Object.keys(why).length ? JSON.stringify(why) : ''}`);
    }
    // Hands off the keys: the helper stops the slide — and the booster comes
    // straight down where it is, which is not the pad. Steering is the child's.
    let lazyWins = 0;
    for (const h of handovers) {
      const f = new Flight({ rocket: m.rocket, goal: m.goal, site: kestrel, mission: m.id }).resumeFrom(h);
      flyWith(f, kid({ steer: 'none' }));
      if (f.result && f.result.success) lazyWins++;
    }
    ok(`${m.name}: a child who never touches ◀ ▶ still misses`, lazyWins === 0, `${lazyWins}/${handovers.length} landed`);
  }

  // The advice after a miss works: let go 150 m out → misses, and is told to
  // hold until "Right over it"; "Try the landing again" from the same moment,
  // doing just that, lands it.
  const m = byId['rocket-home'];
  const first = flyWith(new Flight({ rocket: m.rocket, goal: m.goal, site: kestrel, mission: m.id }), kid({ letGoAt: 150, seed: 3 }));
  ok('Come Home: letting go 150 m out misses, and the screen says to hold until "Right over it"', first.result && !first.result.success && /Right over it/.test(first.result.reason), first.result && first.result.reason);
  const again = new Flight({ rocket: m.rocket, goal: m.goal, site: kestrel, mission: m.id }).resumeFrom(first.handover);
  ok('Try the landing again: it starts at the handover, 6 km up, the booster yours', again.phase === 'landing' && again.focus === again.booster && again.focus.alt > 5000 && again.focus.alt <= F.HANDOVER && again.drain().some((e) => e.type === 'your-turn'), `${Math.round(again.focus.alt)} m, ${again.phase}`);
  flyWith(again, kid({ seed: 4 }));
  ok('Try the landing again: following the advice, it lands', again.result && again.result.success, again.result && `${again.result.title} ${again.result.reason}`);
  const twice = new Flight({ rocket: m.rocket, goal: m.goal, site: kestrel, mission: m.id }).resumeFrom(again.handover);
  ok('Try the landing again: and again — the snapshot is not used up', again.handover === first.handover && twice.phase === 'landing' && twice.t === first.handover.t && !twice.focus.landed && !twice.focus.crashed);
  // The same moment comes back exactly: the same hands give the same landing.
  const a = flyWith(new Flight({ rocket: m.rocket, goal: m.goal, site: kestrel, mission: m.id }).resumeFrom(first.handover), (f) => robotInput(f));
  const b = flyWith(new Flight({ rocket: m.rocket, goal: m.goal, site: kestrel, mission: m.id }).resumeFrom(first.handover), (f) => robotInput(f));
  ok('Try the landing again: the same moment, the same wind — the same hands land it the same way', a.result && b.result && a.result.reason === b.result.reason && a.t === b.t, a.result && a.result.reason);

  // The card shows the slide, and hands off, the helper stops it.
  const s = new Flight({ rocket: m.rocket, goal: m.goal, site: kestrel, mission: m.id }).resumeFrom(first.handover);
  P.setAlong(s.focus, 40 * Math.sign(-(s.target().s - s.focus.downrange) || 1)); // sliding away from the pad
  const L0 = s.landingInfo();
  let t = 0;
  while (t < 12 && !s.done) {
    s.input.lean = 0;
    s.input.burn = true;
    s.step();
    t += 1 / 60;
  }
  const L1 = s.landingInfo();
  ok('landing card: sliding away from the pad shows as a warning, with its direction', Math.abs(L0.slide) > 35 && L0.slideTone === 'warn', `${L0.slide.toFixed(0)} m/s, ${L0.slideTone}`);
  ok('landing helper: hands off, it leans against a 40 m/s slide and stops it', Math.abs(L1.slide) < 1.5, `${L1.slide.toFixed(1)} m/s after 12 s`);

  // Without the helper, ◀ ▶ are the child's own lean, and the screen says
  // how to stop a slide: lean the other way (not "let go", which never works).
  const pro = new Flight({ rocket: m.rocket, goal: m.goal, site: kestrel, mission: m.id, helper: false }).resumeFrom(first.handover);
  P.setAlong(pro.focus, 30);
  const po = pro.objective();
  ok('no helper: sliding, the goal line says lean the other way', /lean the other way \(◀\)/.test(po.text), po.text);
}

/* 5. A launch site on every map --------------------------------------- */
{
  let land = 0;
  const bad = [];
  let most = 0;
  let mostAt = '';
  for (const m of MAPS) {
    T.applyMap(m.id);
    // Counted in height samples, not milliseconds: a wall clock on a laptop
    // whose CPU is being shared out says more about the laptop than the code.
    let samples = 0;
    const counted = (x, z) => { samples++; return T.heightAt(x, z); };
    const site = SITE.findLaunchSite({ heightAt: counted, islands: T.MAP.islands, blocked: (x, z, r) => T.isOnAnyRunway(x, z, r + 160) || T.isPaved(x, z) });
    if (samples > most) { most = samples; mostAt = m.id; }
    const surface = SITE.surfaceFor(site, T.heightAt);
    const why = [];
    if (site.found) {
      land++;
      if (T.heightAt(site.pad.x, site.pad.z) < 1) why.push('pad in the sea');
      if (T.isOnAnyRunway(site.pad.x, site.pad.z, 60)) why.push('pad on a runway');
      if (T.heightAt(site.lz.x, site.lz.z) < 1) why.push('landing pad in the sea');
    }
    if (surface(site.bargeS).kind !== 'barge') why.push('no ship at bargeS');
    if (T.heightAt(site.barge.x, site.barge.z) > -5) why.push('ship aground');
    if (surface(0).kind !== 'pad' || surface(site.lzS).kind !== 'lz') why.push('pads not where the surface says');
    if (Math.abs(Math.hypot(site.az.x, site.az.z) - 1) > 1e-6) why.push('launch direction not a unit vector');
    if (why.length) bad.push(`${m.id}: ${why.join(', ')}`);
  }
  ok('a launch site on every map, the ship on open water', bad.length === 0, bad.join('; ') || `${MAPS.length} maps`);
  ok('most maps put the pad on land (the rest get a platform at sea)', land >= Math.floor(MAPS.length * 0.6), `${land} of ${MAPS.length} on land`);
  // A height sample is 0.16 µs to 0.3 µs (terrain.js), so 300,000 is under 0.1 s.
  ok('finding a site is quick enough to do at every launch', most < 300000, `most: ${most.toLocaleString('en-GB')} height samples (${mostAt})`);
  // A real flight from a real site: First Launch from Kestrel.
  T.applyMap('kestrel');
  const site = SITE.findLaunchSite({ heightAt: T.heightAt, islands: T.MAP.islands, blocked: (x, z, r) => T.isOnAnyRunway(x, z, r + 160) });
  const surface = SITE.surfaceFor(site, T.heightAt);
  for (const m of [byId['rocket-space'], byId['rocket-barge']]) {
    const r = fly(m, {}, { padY: site.pad.y + 1.2, surface, lzS: site.lzS, bargeS: site.bargeS });
    ok(`${m.name} from Kestrel's own pad`, r.f.result && r.f.result.success, r.f.result && `${r.f.result.title}: ${r.f.result.reason}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
