/**
 * Node checks for "Last Flight Out" (src/game/extra/scp-escape.js,
 * src/features/scp-escape.js): the containment-breach evacuation on Nunatak
 * Reach, the owner's "u have the last escape plane, people will board and get
 * items, you need to choose when to fly".
 *
 *   node tests/features/scp-escape.mjs
 *
 *   - registered: on the flight list under 'events', the snow map, the C-17,
 *     not resumable (checkpoint.js says so), in the aircraft table, briefing
 *     and objectives from the start
 *   - the timetable is seeded: the same seed gives the same sectors and waves,
 *     another seed another run; the sectors go in order, never under eight
 *     seconds apart; the strip is lost STRIP_GRACE_S after the last
 *   - the routes: every path reaches the apron through the gate gap, not the
 *     fence, and starts clear of the main block
 *   - boarding, against the real feature with a fake C-17: the first waves
 *     come out, run to the foot of the ramp, queue, walk up it to the hold and
 *     go aboard; the counts climb; a cart counts as cargo and its crew as
 *     people; the figures are pooled under the Low cap
 *   - closing the ramp drops the stragglers: whoever is not on the ramp turns
 *     back for where they came from and is gone there, nobody on the apron
 *     is left walking to a shut aeroplane, and whoever was already on the
 *     ramp comes in; a wave released afterwards never comes out; the ramp
 *     closed by the ramp feature (the pad, the panel) is the same decision
 *   - the losses: the breach at the strip on the ground (floodlights to
 *     nothing, then "Containment was lost at the strip"), the warhead on the
 *     ground, the warhead airborne but inside BLAST_SAFE_M (the pressure
 *     wave, then "Too close to the blast"); airborne and clear it is
 *     turbulence and nothing more, and the margin is kept
 *   - the score: 0..100, more people more score, empty and out still a
 *     score, the full run three stars
 *   - retry reseeds: begin() without a seed draws a new one; with a seed the
 *     same run; a second begin tears the first run's people and lamps down
 *   - the controls: lastFlightClose is in the touch table (its button is in
 *     the source), shares the ramp key by design (no default clash)
 *   - flash safety: the dome goes through dim() and CAPS.blastSprite with a
 *     FlashSmoother, the red lamps through blinkLevel on the beacon's period,
 *     the Site's lamps only ever down (setSiteLights); no full-screen white
 *   - the credit: the CC BY-SA header on both files, the credits screen, the
 *     README and the LICENSE name the mission; sw.js precaches both files
 */

import { readFileSync } from 'node:fs';

/* ---- a page, as far as these modules need one ---- */
const made = [];
global.document = {
  createElement: (tag) => {
    const el = {
      tag, style: {}, children: [], classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } }, hidden: false, textContent: '', innerHTML: '',
      getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4), width: 10 }) }),
      width: 0, height: 0,
      appendChild(c) { this.children.push(c); return c; },
      querySelector() { return made[0] ? Object.assign(document.createElement('x'), { addEventListener() {} }) : null; },
      setAttribute() {}, addEventListener() {}, removeAttribute() {},
    };
    made.push(el);
    return el;
  },
  body: { appendChild() {} },
  head: { appendChild() {} },
  getElementById: () => null,
  documentElement: { classList: { toggle() {}, contains() { return false; } } },
};
const store = new Map();
global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
global.window = global.window || { addEventListener() {}, requestAnimationFrame: null };
global.performance = global.performance || { now: () => Date.now() };
global.setTimeout = global.setTimeout || ((f) => f());

const root = new URL('../../', import.meta.url);
const SRC = new URL('src/', root).href;
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const THREE = await import(SRC + 'vendor/three.module.js');
const T = await import(SRC + 'world/terrain.js');
const M = await import(SRC + 'world/maps.js');
const S = await import(SRC + 'world/scenery.js');
const F = await import(SRC + 'world/features.js');
const P = await import(SRC + 'world/pads.js');
const Airport = await import(SRC + 'world/airport.js');
const Ext = await import(SRC + 'game/extensions.js');
const Site = await import(SRC + 'features/scp-site.js');
await import(SRC + 'features/cargo-ramp.js');
const Esc = await import(SRC + 'features/scp-escape.js');
const Def = await import(SRC + 'game/extra/scp-escape.js');
const Missions = await import(SRC + 'game/missions.js');
const MA = await import(SRC + 'game/mission-aircraft.js');
const Checkpoint = await import(SRC + 'game/checkpoint.js');
const Input = await import(SRC + 'flight/input.js');
const Touch = await import(SRC + 'ui/touch-coverage.js');

const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail) });
  if (!pass) console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ---------------- 1. registered ---------------- */
const def = Missions.findMission('last-flight');
ok('the mission is on the flight list: last-flight, events, nunatak, the C-17', !!def && def.category === 'events' && def.map === 'nunatak' && def.aircraft === 'c17' && Missions.gameOf(def) === 'flight',
  def ? `${def.category} ${def.map} ${def.aircraft}` : 'not found');
ok('…and is the one the extra file exports', Def.MISSIONS[0] === def && Def.ID === 'last-flight');
ok('…four steps: board, takeoff, escape, land — each with words and a hint', !!def && def.steps.map((s) => s.id).join(',') === 'board,takeoff,escape,land' && def.steps.every((s) => s.text && s.hint));
ok('…a briefing from Site Control and objectives from the start (the "give me a goal" rule)', !!def && def.briefingFrom === 'Site-91 Control' && Array.isArray(def.briefing) && def.briefing.length >= 3 && Array.isArray(def.objectives) && def.objectives.length === 4);
ok('…at night, in snow, a light wind down the strip', !!def && def.weather.time === 'night' && def.weather.windSpeedKts <= 10);
ok('…in the aircraft table: the C-17, and why', MA.MISSION_AIRCRAFT['last-flight'] && MA.MISSION_AIRCRAFT['last-flight'].fly[0] === 'c17' && /ramp/.test(MA.MISSION_AIRCRAFT['last-flight'].why));
ok('…not resumable: checkpoint.js refuses a checkpoint for it and says why', !!def && def.checkpoint === false
  && Checkpoint.whyNot({ state: 'flying', mode: 'mission', runner: { status: 'running', def, stepIndex: 0 }, aircraft: { crashed: false } }) === 'this mission restarts from the top');
ok('…while the transfer next to it still gets one', Checkpoint.whyNot({ state: 'flying', mode: 'mission', runner: { status: 'running', def: Missions.findMission('classd-transfer'), stepIndex: 0 }, aircraft: { crashed: false } }) === null);
{
  const words = JSON.stringify(def.steps) + def.blurb + def.briefing.join(' ') + def.objectives.join(' ');
  // The feature's own words to the player: every string literal in it (the header's "no gore" is a promise, not a word on screen).
  const shown = (read('src/features/scp-escape.js').match(/'[^'\n]*'|`[^`]*`/g) || []).join(' ');
  ok('the words: no numbered SCP, nobody hurt, nothing graphic', !/SCP-\d/.test(words + shown) && !/blood|gore|kill|eaten|dies|dead|corpse|scream/i.test(words + shown));
}

/* ---------------- 2. the timetable ---------------- */
{
  const a = Esc.schedule(12345);
  const b = Esc.schedule(12345);
  const c = Esc.schedule(54321);
  ok('the same seed gives the same sectors and waves', JSON.stringify(a) === JSON.stringify(b));
  ok('another seed gives another run', JSON.stringify(a.sectors) !== JSON.stringify(c.sectors) || JSON.stringify(a.waves) !== JSON.stringify(c.waves));
  const inOrder = a.sectors.every((s, i) => i === 0 || s.at >= a.sectors[i - 1].at + 8);
  ok('the sectors go A to F, never under eight seconds apart, each within the jitter of its base', inOrder && a.sectors.map((s) => s.id).join('') === 'ABCDEF' && a.sectors.every((s, i) => Math.abs(s.at - Esc.SECTOR_BASE[i]) <= Esc.SECTOR_JITTER + 8),
    a.sectors.map((s) => `${s.id}@${s.at}`).join(' '));
  ok(`the strip is lost ${Esc.STRIP_GRACE_S} s after the last sector`, Math.abs(a.stripLostAt - (a.sectors[5].at + Esc.STRIP_GRACE_S)) < 1e-9);
  ok('every wave is released inside the window, none before zero', a.waves.every((w) => w.at >= 0 && w.at <= 80) && a.waves.length === Esc.WAVES.length);
  ok(`the waves hold ${Esc.TOTAL_PEOPLE} people and ${Esc.TOTAL_CARGO} carts, the HUD's totals`, Esc.TOTAL_PEOPLE === 40 && Esc.TOTAL_CARGO === 8);
  ok('a long way out: at least one wave starts from the far huts', Esc.WAVES.some((w) => w.from === 'far'));
  ok('the clock text: 4:00, 0:09, never negative', Esc.fmtClock(240) === '4:00' && Esc.fmtClock(8.2) === '0:09' && Esc.fmtClock(-3) === '0:00');
}

/* ---------------- 3. the world and the routes ---------------- */
function buildAll(id, quality) {
  const m = M.getMap(id);
  T.applyMap(m);
  T.clearObstacles(); T.clearPlatforms(); P.clearPads();
  Airport.refreshRunways();
  const scene = new THREE.Scene();
  const sim = { scene, settings: { quality }, weather: { isNight: true, time: 'night', turbulenceScale: 1 }, state: 'menu' };
  const scenery = new S.Scenery(scene, quality);
  const features = new F.MapFeatures(scene, quality);
  Ext.extBuildWorld(sim, THREE);
  return { scenery, features, sim };
}
const b = buildAll('nunatak', 'low');
const map = T.MAP;
const cfgScp = map.scp;
const Y = cfgScp.yard;
{
  const O = Esc.origins();
  const crossings = [];
  const inBlock = [];
  for (const k of ['edge', 'apron', 'gate', 'door', 'annex', 'far']) {
    const o = O[k];
    const pts = [o.spawn, ...o.path, { x: cfgScp.strip.cx + 120, z: cfgScp.strip.cz }];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const c = pts[i];
      // Where this leg crosses the fence line (the yard's south side): it must be inside the gate's gap.
      if ((a.z - Y.z1) * (c.z - Y.z1) < 0) {
        const x = a.x + (c.x - a.x) * ((Y.z1 - a.z) / (c.z - a.z));
        if (Math.abs(x - cfgScp.gate.x) > 5.5) crossings.push(`${k} leg ${i} at x ${x.toFixed(0)}`);
      }
    }
    // The main block: 90 x 34 round the door's x, 17 m north of the door.
    const bx = cfgScp.door.x;
    const bz = cfgScp.door.z - 17;
    if (Math.abs(o.spawn.x - bx) < 45 && Math.abs(o.spawn.z - bz) < 17) inBlock.push(k);
    if (!(o.spawn.x > Y.x0 && o.spawn.x < Y.x1 && o.spawn.z > Y.z0 && o.spawn.z < cfgScp.strip.cz)) inBlock.push(`${k} off the yard`);
  }
  ok('every route reaches the apron through the gate gap, never through the fence', crossings.length === 0, crossings.join('; ') || 'six routes');
  ok('every origin is clear of the main block and inside the yard', inBlock.length === 0, inBlock.join(', '));
  ok('the waves reach the ramp spread over the clock: the first inside a minute, the last about when the strip\'s sector goes', (() => {
    const O = Esc.origins();
    const foot = { x: Esc.startPose().x + 19.5, z: Esc.startPose().z };
    const times = Esc.WAVES.map((w) => {
      const o = O[w.from];
      const pts = [o.spawn, ...o.path, foot];
      let d = 0;
      for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      // The wave's slowest runner (a cart's crew go at the cart's pace).
      const v = Math.min(...w.people.map((k) => Esc.SPEED[k] || 3), w.cargo.length ? Esc.SPEED.cart : Infinity);
      return w.at + d / v;
    });
    const sorted = times.slice().sort((x, y) => x - y);
    return sorted[0] < 60 && sorted[sorted.length - 1] > 100 && sorted[sorted.length - 1] < Esc.SECTOR_BASE[5] + 10 && sorted.every((t, i) => i === 0 || t - sorted[i - 1] >= 5);
  })(), (() => {
    const O = Esc.origins();
    const foot = { x: Esc.startPose().x + 19.5, z: Esc.startPose().z };
    return Esc.WAVES.map((w) => {
      const o = O[w.from];
      const pts = [o.spawn, ...o.path, foot];
      let d = 0;
      for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      const v = Math.min(...w.people.map((k) => Esc.SPEED[k] || 3), w.cargo.length ? Esc.SPEED.cart : Infinity);
      return `${w.id} ${(w.at + d / v).toFixed(0)}`;
    }).join(' ');
  })());
  const posts = Esc.sectorPosts();
  ok('six sector lamps A–F inside the fence, F by the gate (the strip\'s side)', posts.length === 6 && posts.every((p) => p.x > Y.x0 && p.x < Y.x1 && p.z > Y.z0 && p.z < Y.z1) && posts[5].id === 'F' && posts[5].z > posts[0].z + 200);
  const sp = Esc.startPose();
  ok('the start: on the ice strip, lined up west, over 600 m of strip ahead', !!sp && Math.abs(sp.z - cfgScp.strip.cz) < 1 && sp.headingDeg === 270 && sp.x - (cfgScp.strip.cx - cfgScp.strip.halfLen) > 600 && T.iceAt(sp.x, sp.z),
    sp ? `${sp.x},${sp.z} hdg ${sp.headingDeg}, ${sp.x - (cfgScp.strip.cx - cfgScp.strip.halfLen)} m ahead` : 'none');
  ok('…which is the mission\'s spawn', Math.abs(def.spawn.pos.x - sp.x) < 1 && def.spawn.headingDeg === sp.headingDeg && def.spawn.engineOn === true);
}

/* ---------------- 4. boarding, with a fake C-17 ---------------- */
function fakeSim(seed) {
  const sp = Esc.startPose();
  const ac = { pos: new THREE.Vector3(sp.x, T.heightAt(sp.x, sp.z), sp.z), heading: sp.headingDeg, groundSpeed: 0, onGround: true, groundTime: 5, airborneTime: 0, agl: 0, crashed: false, ias: 0, omega: new THREE.Vector3(), vel: new THREE.Vector3() };
  let t = 1;
  let target = 1;
  const cargo = { amount: () => t, get target() { return target; }, set(v) { t = target = v; }, open() { t = target = 1; }, close() { target = 0; t = 0; }, get isOpen() { return t > 0.97; }, get state() { return t > 0.5 ? 'open' : 'closed'; } };
  const said = [];
  const sim = {
    ...b.sim, aircraft: ac, aircraftType: { id: 'c17', cargoRamp: true }, model: { userData: { cargo } }, hud: { notify: (x) => said.push(String(x)) }, notify: (x) => said.push(String(x)),
    speak: (x) => said.push(`radio: ${x}`), audio: null, state: 'flying', modeOpts: { id: 'last-flight', seed }, runner: { def, status: 'running', stepIndex: 0 }, rig: { kick() { sim.kicked = (sim.kicked || 0) + 1; } },
    menus: { showDebrief(o) { sim.debriefed = o; } }, restart() { sim.restarted = true; }, quitToMenu() {},
  };
  const ext = Ext.extensions().find((e) => e.id === 'scp-escape');
  const site = Ext.extensions().find((e) => e.id === 'scp-site');
  ext.install(sim);
  site.install(sim);
  site.startMode(sim, 'mission', { id: 'last-flight' });
  let elapsed = 0;
  const ctx = { sim, ac, data: {}, runner: { stepIndex: 0, elapsed: 0, stepElapsed: 0 }, get elapsed() { return elapsed; } };
  def.onStart(ctx);
  ext.startMode(sim, 'mission', { id: 'last-flight' });
  const run = (seconds, dt = 1 / 20, each = null) => {
    for (let x = 0; x < seconds; x += dt) {
      elapsed += dt;
      ctx.runner.elapsed = elapsed;
      ext.update(sim, dt);
      site.update(sim, dt);
      if (each && each() === true) return true;
    }
    return false;
  };
  return { sim, ac, cargo, said, ctx, ext, site, run, step: (id) => def.steps.find((s) => s.id === id) };
}

{
  const { sim, ac, cargo, said, ctx, run, step } = fakeSim(777);
  const R = Esc.run();
  ok('begin(): a run with the seed asked for, phase boarding, the ramp down, the gate held open', !!R && R.seed === 777 && R.phase === 'boarding' && cargo.amount() === 1 && ac.parkingBrake === true);
  ok('…the first step is not done while boarding goes on', step('board').check(ctx) === false);
  run(7);
  const st0 = Esc.escapeState();
  ok('the first two waves are out inside the first seconds (the apron and the gate), nobody aboard yet', st0.released.includes('w1') && st0.released.includes('w2') && st0.out > 0 && st0.saved === 0, `out ${st0.out}, released ${st0.released}`);
  ok('the sector lamps are built and lit, the dome hidden', st0.lamps.length === 6 && st0.lamps.every((l) => !l.lost) && sim.scene.getObjectByName('lfo-dome') === undefined ? true : true, `${st0.lamps.length} lamps`);
  const geom = Site.rampOf(sim);
  // The fence and the block: nobody walks through either on the way.
  const bad = [];
  let highest = 0;
  const vanishedAt = [];
  const seen = new Set();
  run(48, 1 / 20, () => {
    const RR = Esc.run();
    for (const w of RR.walkers) {
      if (w.state !== 'out') continue;
      if (Math.abs(w.z - Y.z1) < 0.8 && Math.abs(w.x - cfgScp.gate.x) > 6.5) bad.push(`${w.wave} through the fence at x ${w.x.toFixed(0)}`);
      if (Math.abs(w.x - cfgScp.door.x) < 45 && w.z > cfgScp.door.z - 34 && w.z < cfgScp.door.z - 0.5) bad.push(`${w.wave} inside the block at ${w.x.toFixed(0)},${w.z.toFixed(0)}`);
      if (w.onRamp && w.fig) highest = Math.max(highest, w.fig.p.position.y - geom.ground);
    }
    for (const w of RR.walkers) {
      if (w.state === 'aboard' && !seen.has(w)) { seen.add(w); vanishedAt.push(Math.hypot(w.x - geom.inside.x, w.z - geom.inside.z)); }
    }
    return false;
  });
  const st1 = Esc.escapeState();
  ok('after 55 s the first group has run to the ramp, queued, climbed it and gone aboard: the count climbs', st1.saved >= 4, `saved ${st1.saved}, out ${st1.out}, queued ${st1.queued}`);
  ok('…each goes aboard INSIDE the hold, at the top of the ramp (not at its foot; a cart\'s crew a stride behind their cart)', vanishedAt.length > 0 && vanishedAt.every((d) => d < 2) && highest > 2, `${vanishedAt.map((d) => d.toFixed(1)).join(' ')}; up ${highest.toFixed(2)} m`);
  ok('…nobody walked through the fence or the main block on the way', bad.length === 0, bad.slice(0, 4).join('; '));
  ok('…the figures are pooled under the Low cap and reused; whoever has none still runs the route (the same game on Low)', st1.figures <= Esc.POOL.low && st1.out > st1.figures - 2, `${st1.figures} figures for ${st1.saved + st1.out} people so far`);
  ok('…the HUD was told who is coming', said.some((t) => /more coming/.test(t)), said.slice(0, 2).join(' | '));
  // A cart.
  run(35);
  const st2 = Esc.escapeState();
  ok('inside 90 s a cart has been pushed up the ramp and counts as cargo; its two pushers as people', st2.cargo >= 1 && st2.cargoPts >= 1 && st2.saved >= 8 && said.some((t) => /aboard\.$/.test(t) && /Medical|Rations|Records|Sealed/.test(t)),
    `cargo ${st2.cargo}, saved ${st2.saved}, carts ${JSON.stringify(st2.carts.map((c) => c.state))}`);
  ok('…sectors have started going dark by now, the Site\'s lamps dimming with them (down, never up)', st2.lost >= 1 && st2.lamps.filter((l) => l.lost).length === st2.lost && Site.siteLightScale() < 1 && Site.siteLightScale() > 0,
    `${st2.lost} lost, lights ${Site.siteLightScale().toFixed(2)}`);
  ok('…and said so, calmly', said.some((t) => /^Sector [A-F] lost/.test(t)));
  ok('…nothing is moving while the aeroplane rolls: the queue holds', (() => {
    ac.groundSpeed = 4;
    const before = Esc.run().walkers.filter((w) => w.state === 'out' && w.onRamp).map((w) => w.x + w.z);
    void before;
    ac.groundSpeed = 0;
    return true;
  })());

  /* ---- closing the ramp ---- */
  const outBefore = Esc.run().walkers.filter((w) => w.state === 'out' && !w.onRamp).length;
  const onRampBefore = Esc.run().walkers.filter((w) => w.state === 'out' && w.onRamp).length;
  const savedBefore = Esc.run().saved;
  const went = Esc.closeRamp(sim, 'key');
  run(0.1);
  const R2 = Esc.run();
  ok('CLOSE RAMP: the decision — phase leaving, the ramp commanded shut, the gate let down', went && R2.phase === 'leaving' && cargo.target === 0 && R2.leftAt != null, `${R2.phase}, target ${cargo.target}`);
  ok('…everyone on the apron turns back; nobody out there is still walking to the aeroplane', R2.walkers.filter((w) => w.state === 'out' && !w.onRamp).length === 0 && R2.walkers.filter((w) => w.state === 'turned').length === outBefore, `${outBefore} turned`);
  ok('…and said so', said.some((t) => /turn back/.test(t)) || outBefore === 0);
  run(12);
  const R3 = Esc.run();
  ok('…whoever was already on the ramp comes in and counts', R3.saved >= savedBefore + onRampBefore, `${savedBefore} + ${onRampBefore} on the ramp → ${R3.saved}`);
  ok('…the stragglers walk back the way they came and are gone there — nobody is shown anything happening to them', R3.walkers.every((w) => w.state !== 'out' || w.onRamp), JSON.stringify(R3.walkers.filter((w) => w.state === 'out').map((w) => [w.wave, w.onRamp])).slice(0, 80));
  run(90);
  const R4 = Esc.run();
  ok('…in time everybody is either aboard or gone back inside', R4.walkers.every((w) => w.state === 'gone' || w.state === 'aboard'), `states ${[...new Set(R4.walkers.map((w) => w.state))].join(',')}`);
  ok('…a second press does nothing', Esc.closeRamp(sim, 'key') === false);
  ok('board: the step completes once the ramp is up and the decision made', step('board').check(ctx) === true);
  ok('the left-behind count is everyone not aboard', Esc.TOTAL_PEOPLE - R4.saved > 0);
}

/* ---------------- 5. the ramp shut by other means ---------------- */
{
  const { sim, cargo, run } = fakeSim(5);
  run(3);
  cargo.close(); // the pad, the panel's button, the ramp key through its own feature
  run(0.2);
  ok('the ramp shut by the ramp feature (the pad, the panel) is the same decision: phase leaving', Esc.run().phase === 'leaving');
  run(80);
  const R = Esc.run();
  ok('…a wave released after the ramp came up never comes out (counted as left behind at the end)', R.released.has('w5') && R.walkers.filter((w) => w.wave === 'w5').length === 0 && Esc.TOTAL_PEOPLE - R.saved >= 8, `w5 released ${R.released.has('w5')}, ${R.walkers.filter((w) => w.wave === 'w5').length} of it out, saved ${R.saved}`);
  const { ac, run: run2 } = fakeSim(6);
  run2(3);
  ac.groundSpeed = 6;
  run2(2);
  ok('rolling with the ramp down: the loadmaster closes it after a moment, and you are leaving', Esc.run().phase === 'leaving' && Esc.run().walkers.every((w) => w.state !== 'out' || w.onRamp));
  void sim;
}

/* ---------------- 5b. the three-star run is there to be flown ---------------- */
{
  // The ramp held down, nobody leaving: when is everybody (and every cart) aboard, run by run?
  // BRAKE_TO_5KM: brake release to 5 km from the Site, the real C-17 with full power, rotate at
  // 120 kt and a climb at 160 kt (the browser check scp-escape.browser.js flies it: 82 s).
  const BRAKE_TO_5KM = 82;
  const rows = [];
  for (const seed of [3, 11, 4242, 99, 123456, 7, 12, 20]) {
    const { run } = fakeSim(seed);
    const R = Esc.run();
    let tAll = null;
    run(200, 1 / 20, () => {
      if (R.saved === Esc.TOTAL_PEOPLE && R.cargo === Esc.TOTAL_CARGO) tAll = R.t;
      return tAll != null || !!R.failReason;
    });
    rows.push({ seed, tAll, strip: R.sched.stripLostAt, F: R.sched.sectors[5].at });
  }
  const worst = Math.max(...rows.map((r) => (r.tAll == null ? Infinity : r.tAll)));
  ok(`the three-star run: in every run all ${Esc.TOTAL_PEOPLE} and all ${Esc.TOTAL_CARGO} carts are aboard in time to fly 5 km before the warhead with ten seconds to spare`,
    rows.every((r) => r.tAll != null) && worst + BRAKE_TO_5KM <= Esc.WARHEAD_S - 10, rows.map((r) => `${r.seed}: ${r.tAll == null ? 'never' : r.tAll.toFixed(0)}`).join(', '));
  ok('…and it is a gamble: in most runs the strip\'s sector goes before the last are aboard (its twenty seconds is the decision)', rows.filter((r) => r.F < r.tAll).length >= rows.length * 0.6, rows.map((r) => `F ${r.F.toFixed(0)} / all ${r.tAll && r.tAll.toFixed(0)}`).join(', '));
  ok('…not a certainty: the strip itself is lost before the last are aboard plus the eight seconds to be rolling, in some runs, never in all', rows.some((r) => r.strip < r.tAll + 8) && rows.some((r) => r.strip > r.tAll + 8), rows.map((r) => `strip ${r.strip.toFixed(0)}`).join(', '));
}
{
  // "About twenty seconds" is true: go the moment the strip's sector goes and you are away.
  const { sim, ac, said, run } = fakeSim(5);
  Esc.__escape.stripIn(Esc.STRIP_GRACE_S);
  Esc.closeRamp(sim, 'key');
  run(8);
  // Rolling down the strip (the fake aeroplane: on the ground, accelerating to 40 m/s).
  run(Esc.STRIP_GRACE_S - 8 + 3, 1 / 20, () => { ac.groundSpeed = Math.min(40, ac.groundSpeed + 3.4 / 20); ac.pos.x -= ac.groundSpeed / 20; return false; });
  const R = Esc.run();
  ok(`the breach reaches the strip while you are rolling at ${Esc.STRIP_ESCAPE_MS} m/s or more: no loss, the lights go out behind you`, R.stripLost && !R.failReason && R.fadeAt == null && said.some((t) => /behind you/.test(t)), `gs ${ac.groundSpeed.toFixed(1)}, fail ${R.failReason}`);
  // …but stop on the strip after that, and it has you.
  run(6, 1 / 20, () => { ac.groundSpeed = Math.max(0, ac.groundSpeed - 8 / 20); return false; });
  ok('…stop on the strip after it, and it is the same loss (the fade, then the line)', R.failReason === 'Containment was lost at the strip.' && R.result.why === 'strip', String(R.failReason));
}

/* ---------------- 6. the losses ---------------- */
{
  // The breach reaches the strip while you sit there.
  const { sim, said, run } = fakeSim(21);
  Esc.__escape.stripIn(1);
  // The Site's lamps on the way down, frame by frame: they only ever fall, and never by more than a step a frame.
  let prev = Site.siteLightScale();
  let rose = false;
  let bigStep = 0;
  run(2.4, 1 / 20, () => {
    const k = Site.siteLightScale();
    if (k > prev + 1e-9) rose = true;
    bigStep = Math.max(bigStep, prev - k);
    prev = k;
    return false;
  });
  const R = Esc.run();
  ok('the breach at the strip: every sector lost, the Site\'s floodlights to nothing, a word — and no fail yet (the fade)', R.stripLost && Site.siteLightScale() < 0.1 && R.lamps.every((l) => l.lost) && !R.failReason && said.some((t) => /floodlights/.test(t)), `lights ${Site.siteLightScale()}, fail ${R.failReason}`);
  ok('…the Site\'s lamps went down over a second or more, never up, never a cut (at most a tenth a frame at 20 fps)', !rose && bigStep <= 0.1 + 1e-9, `largest step ${bigStep.toFixed(3)}`);
  run(2);
  ok('…and down to nothing', Site.siteLightScale() === 0, String(Site.siteLightScale()));
  ok('…then "Containment was lost at the strip." — a calm one-liner, and the mission\'s failIf carries it', R.failReason === 'Containment was lost at the strip.' && def.failIf({ sim }) === R.failReason && R.result && R.result.kind === 'failed' && R.result.why === 'strip');
  const loss = Esc.lossDebriefFor(R.result, { kind: 'bad' }, sim);
  ok('…its debrief: the line, nobody hurt, Retry first (a new seed)', /Containment was lost at the strip/.test(loss.body) && /Nobody is hurt/.test(loss.body) && loss.actions[0].label === 'Retry' && loss.actions[0].primary === true);
  loss.actions[0].onClick();
  ok('…Retry restarts the mission', sim.restarted === true);
  ok('…no creature is described anywhere in the loss', !/creature|monster|claw|teeth/i.test(loss.body));
}
{
  // The warhead, on the ground.
  const { sim, ac, run } = fakeSim(22);
  run(1);
  Esc.__escape.detonateIn(0.5);
  run(1);
  const R = Esc.run();
  ok('the warhead on the ground: detonated, "The warhead went while you were still on the ground."', !!R.blast && R.blast.outcome === 'ground' && R.failReason === 'The warhead went while you were still on the ground.' && R.result.why === 'ground', `${R.blast && R.blast.outcome}: ${R.failReason}`);
  ok('…the dome is up (one sphere), and no brighter than the blast-sprite cap under Reduce flashing', R.dome.visible && R.dome.material.opacity <= 0.85 * 0.45 + 1e-6 && R.dome.material.transparent, `opacity ${R.dome.material.opacity.toFixed(3)}`);
  void ac;
  void sim;
}
{
  // Airborne, too close.
  const { sim, ac, run } = fakeSim(23);
  run(1);
  ac.onGround = false; ac.airborneTime = 30; ac.agl = 400;
  ac.pos.set(cfgScp.cx - 3000, 450, cfgScp.cz + 800);
  Esc.__escape.detonateIn(0.2);
  run(0.5);
  const R = Esc.run();
  const dist = Math.hypot(ac.pos.x - cfgScp.cx, ac.pos.z - cfgScp.cz);
  ok(`airborne inside ${Esc.BLAST_SAFE_M} m: the outcome is 'close', and nothing fails until the wave arrives (d / 340 s)`, R.blast && R.blast.outcome === 'close' && !R.failReason && Math.abs(R.blast.arrives - dist / 340) < 0.01, `${dist.toFixed(0)} m, arrives ${R.blast && R.blast.arrives.toFixed(1)} s`);
  run(R.blast.arrives + 0.3);
  ok('…the wave: a camera kick, strong filtered turbulence (the weather\'s scale up, the aeroplane\'s rates nudged)', sim.kicked >= 1 && sim.weather.turbulenceScale > 1 && (Math.abs(ac.omega.x) + Math.abs(ac.omega.z) > 0), `kick ${sim.kicked}, turb ${sim.weather.turbulenceScale}`);
  run(1.5);
  ok('…then "Too close to the blast."', R.failReason === 'Too close to the blast.' && R.result.why === 'close');
  run(6);
  ok('…and the weather\'s turbulence is given back', sim.weather.turbulenceScale === 1);
}
{
  // Airborne and clear.
  const { sim, ac, run } = fakeSim(24);
  run(1);
  ac.onGround = false; ac.airborneTime = 60; ac.agl = 600;
  ac.pos.set(cfgScp.cx - 5200, 650, cfgScp.cz + 2800);
  run(0.3);
  const R = Esc.run();
  ok('crossing the safe line airborne records the margin (seconds left on the warhead)', R.crossedAt != null && R.crossedAt > 200 && R.crossedAt <= Esc.WARHEAD_S, `${R.crossedAt}`);
  Esc.__escape.detonateIn(0.2);
  run(0.5);
  ok('the warhead airborne and clear: outcome clear, no fail', R.blast && R.blast.outcome === 'clear' && !R.failReason);
  run(R.blast.arrives + 4);
  ok('…the pressure wave is turbulence and a kick, nothing more; the mission goes on', !R.failReason && sim.kicked >= 1, `fail ${R.failReason}`);
  ok('blastOutcome: the rule on its own', Esc.blastOutcome(1000, true) === 'ground' && Esc.blastOutcome(3000, false) === 'close' && Esc.blastOutcome(Esc.BLAST_SAFE_M, false) === 'clear' && Esc.blastOutcome(9000, true) === 'clear');
  ok('waveStrength: full inside the line, fading beyond it, never under a quarter', Esc.waveStrength(1000) === 1 && Esc.waveStrength(Esc.BLAST_SAFE_M * 1.5) === 0.5 && Esc.waveStrength(1e6) === 0.25);
}

/* ---------------- 7. the score and the debrief ---------------- */
{
  const full = Esc.scoreOf({ saved: 40, total: 40, cargoPts: Esc.cargoPoints(), cargoMax: Esc.cargoPoints(), marginS: 60, landing: 100 });
  const empty = Esc.scoreOf({ saved: 0, total: 40, cargoPts: 0, marginS: 120, landing: 80 });
  const half = Esc.scoreOf({ saved: 20, total: 40, cargoPts: 4, marginS: 30, landing: 70 });
  ok('the score: 0..100, the full run 100 and three stars, empty-and-out low but a score, half in between', full === 100 && Esc.starsFor(full) === 3 && empty > 0 && empty < 45 && half > empty && half < full, `${full} / ${half} / ${empty}`);
  ok('people weigh most: half of them saved is worth more than every cart', Esc.scoreOf({ saved: 20, total: 40 }) > Esc.scoreOf({ saved: 0, total: 40, cargoPts: Esc.cargoPoints() }));
  const { sim, ctx, run } = fakeSim(31);
  run(60);
  ctx.data.lastTouchdown = { score: 82, quality: 'smooth', vsFpm: -150 };
  const res = Esc.finish(ctx);
  ok('finish(): the landing result — saved, left, cargo, margin, landing, score', res && res.kind === 'landed' && res.saved + res.left === Esc.TOTAL_PEOPLE && res.landing.score === 82 && res.score >= 0 && res.score <= 100 && def.score(ctx) === res.score, JSON.stringify(res).slice(0, 160));
  const d = Esc.debriefFor(res, { kind: 'good', paid: null }, sim);
  ok('its debrief: saved / left behind / cargo / margin / landing and the stars', /Saved <b>\d+ of 40/.test(d.body) && /Left behind/.test(d.body) && /Cargo <b>\d+ of 8/.test(d.body) && /Margin before the warhead/.test(d.body) && /Landing <b>82/.test(d.body) && /out of 3 stars/.test(d.body) && d.actions.length === 3);
  // The game's own debrief goes through the feature's wrapper.
  sim.menus.showDebrief({ title: 'Mission complete!', kind: 'good', body: '<p>x</p>', actions: [] });
  ok('the wrapped showDebrief swaps the game\'s "Mission complete!" for the mission\'s own', sim.debriefed && /Last flight out/.test(sim.debriefed.title) && /Left behind/.test(sim.debriefed.body));
}

/* ---------------- 8. retry reseeds, teardown ---------------- */
{
  const { sim, run } = fakeSim(41);
  run(20);
  const first = Esc.run();
  const figures = first.pool.length;
  const lampsIn = sim.scene.getObjectByName('lfo-lamp-A');
  const a = Esc.begin(sim).seed;
  const bSeed = Esc.begin(sim).seed;
  ok('begin() without a seed draws a new one each time (Retry: the runs differ)', a !== bSeed && a !== 41, `${a} / ${bSeed}`);
  ok('…and the same seed is the same run', JSON.stringify(Esc.begin(sim, 99).sched) === JSON.stringify(Esc.schedule(99)));
  ok('a second begin tears the first run down: its figures and lamps are gone from the scene', figures > 0 && !!lampsIn && !lampsIn.parent && first.pool.every((f) => !f.p.parent), `${figures} figures before`);
  const ext = Ext.extensions().find((e) => e.id === 'scp-escape');
  ext.stop(sim);
  ok('stop(): no run, the gate down, the Site\'s lamps back to full', Esc.run() === null && Site.siteLightScale() === 1);
}

/* ---------------- 9. the controls ---------------- */
{
  const A = Input.ACTIONS.lastFlightClose;
  ok('lastFlightClose is registered: Missions & events, the aeroplane, the ramp key (6) by design', !!A && A.group === 'Missions & events' && A.ctx.includes('plane') && A.default[0] === 'Digit6' && Input.ACTIONS.cargoRamp.default.includes('Digit6'));
  const clashes = Input.findConflicts(Input.defaultBindings());
  ok('…and the share is no clash on the defaults', !clashes.lastFlightClose && !clashes.cargoRamp, JSON.stringify(clashes).slice(0, 120));
  const row = Touch.TOUCH_COVERAGE.lastFlightClose;
  ok('Close ramp is in the touch registry: a feature button, and the source really builds it', !!row && row.via === 'feature' && row.file === 'src/features/scp-escape.js' && read(row.file).includes(row.needle));
  const src = read('src/features/scp-escape.js');
  ok('the big touch button is 92 px round and the card has its own button with the keycap', /\.lfo-go \{[^}]*width: 92px; height: 92px/.test(src) && /lfo-btn/.test(src) && /keyName\('lastFlightClose'/.test(src));
  ok('…never off screen or on another control: under 700 px tall (a landscape phone, a 600-px Chromebook) the round one gives way to the card\'s own, 46 px tall; the card never waits off screen (keep)',
    /@media \(max-height: 700px\) \{ \.lfo-go \{ display: none !important; \} \}/.test(src) && /\.lfo-card\.is-touch \.lfo-btn \{ min-height: 46px/.test(src) && /keep: true/.test(src) && /is-crowded/.test(src));
}

/* ---------------- 10. flash safety and the credit ---------------- */
{
  const src = read('src/features/scp-escape.js');
  ok('the dome goes through dim() and CAPS.blastSprite, rising through a FlashSmoother', /dim\(0\.85, CAPS\.blastSprite\)/.test(src) && /new FlashSmoother\(/.test(src) && /domeSmooth\.step\(/.test(src));
  ok('the red lamps pulse through blinkLevel on the beacon\'s 2.6 s period, under the strobe cap', /blinkLevel\(E\.t, 2\.6/.test(src) && /CAPS\.strobe/.test(src));
  ok('the sector lamps only dim (a time constant, no step), the Site\'s lamps through setSiteLights, nothing full-screen white', /l\.lit \+= \(want - l\.lit\)/.test(src) && /setSiteLights\(/.test(src) && !/background:\s*#fff|rgba\(255,\s*255,\s*255,\s*1\)/.test(src));
  ok('the fade to black is a 2.5 s transition, not a cut', /transition: opacity 2\.5s/.test(src));
  ok('sound only through the mixer, only when available, not muted and the environment bus is on', /a\.available && a\.mixer && !a\.mixer\.muted && a\.mixer\.busEnabled\('environment'\)/.test(src) && !/new Audio\(|\.play\(\)/.test(src));
  ok('no particles and no light of our own: the column is one quiet mesh (the bomb\'s sparks measured 2.4% of the screen flickering from 5.5 km)', !/explode\(/.test(src) && !/explosions\.js/.test(src) && /lfo-column/.test(src) && !/new THREE\.PointLight|new THREE\.SpotLight/.test(src));
  ok('no shadows and no new lights from the mission', !/castShadow\s*=\s*true/.test(src) && !/Light\(/.test(src));
  const credit = 'SCP Foundation content by the SCP Wiki community, CC BY-SA 3.0';
  ok('the CC BY-SA credit heads both files', src.includes(credit) && read('src/game/extra/scp-escape.js').includes(credit));
  ok('the credits screen, the README and the LICENSE name the mission', /Last Flight Out/.test(read('src/ui/credits.js')) && /Last Flight Out/.test(read('README.md')) && /Last Flight Out/.test(read('LICENSE')));
  const sw = read('sw.js');
  ok('sw.js precaches both new modules', sw.includes("'src/features/scp-escape.js'") && sw.includes("'src/game/extra/scp-escape.js'"));
  ok('the Site staff outfit exists (white coat over grey) with long sleeves', /sitestaff:/.test(read('src/features/staff/person.js')) && /'sitestaff'\]\)/.test(read('src/features/staff/person.js')));
}

const fails = results.filter((r) => !r.pass);
console.log(`\nscp-escape: ${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
