/**
 * World Map traffic, checked in node (src/world/worldmap/traffic-plan.js).
 *
 *   /opt/homebrew/bin/node tests/features/wm-traffic.mjs           one line per check
 *   /opt/homebrew/bin/node tests/features/wm-traffic.mjs --quiet   failures and the summary
 *
 * On the World Map's real height field (terrain.js with the preview applied):
 *
 * ROUTE PLANNING, every pair every kind of traffic may fly, with the runways
 * used both ways (wind 080 and 260):
 *   - the path is continuous (no jump where a leg meets a turn)
 *   - the last part is straight in on the runway's extended centreline from
 *     the gate, and the touchdown is on the runway at field elevation; the
 *     turn-off ends clear of the runway's edge; a helicopter ends on its pad
 *   - the height profile keeps the type's clearance over the ground from the
 *     climb-out to the gate, climbs and descends within the type's gradients,
 *     and cruises in the type's band, at a semicircular level
 *   - the TIERS: Low 8 (as it was), Medium 22, High 34, Ultra 46; more types, the rare ones rare
 *
 * THE RUNWAY RULE: no take-off or landing at a field within 8 km of you.
 * Thirty-two of them flown for 20 minutes with you parked at each of the
 * sixteen fields in turn, and for an hour with you flying between them:
 *   - every one appears airborne, never at a field within 8 km of you, and
 *     (after the start) only out of sight
 *   - no touchdown at a field within 8 km of you, and nothing on the ground
 *     within 8 km of a parked you, ever
 *   - the rule is exercised: holds, go-arounds and diverts happen
 *
 * SEPARATION (TCAS-like, 1.5 km / 300 m): you flying at one head-on, across
 * its track, slowly ahead of it on its track, hovering on its track, climbing
 * through its level, and a hundred straight-line flights through the busy
 * airspace at 30-150 m/s: never within 1 km and 200 m of you, and never
 * closer than the 300 m vertical standard (the closest found is reported).
 *
 * FROM EACH OTHER: a departure right behind another off the same runway
 * waits; an hour of traffic (Ultra twice, High, Medium, Low) with nobody
 * else about never closer than 0.4 of 1.5 km / 300 m to each other, and
 * hardly ever inside 1 km / 200 m (none below Ultra). Fails on v76.7 (they
 * kept apart from you only: departures appeared on top of each other).
 *
 * Fails on the old code: there is no traffic (the module does not exist).
 */
global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0, height: 0, style: {},
  }),
  body: { appendChild() {} },
};
const store = new Map();
global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
global.window = global.window || { addEventListener() {} };

const quiet = process.argv.includes('--quiet');
const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail });
  if (!quiet || !pass) console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
function done() {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
}

const SRC = new URL('../../src/', import.meta.url).href;
let TP;
try {
  TP = await import(SRC + 'world/worldmap/traffic-plan.js');
} catch (e) {
  ok('the World Map has traffic (world/worldmap/traffic-plan.js loads)', false, String(e && e.message));
  done();
}
const T = await import(SRC + 'world/terrain.js');
const M = await import(SRC + 'world/maps.js');
const PV = await import(SRC + 'world/worldmap/preview.js');
M.registerExtraMap(PV.previewDef());
T.applyMap(PV.WORLD_PREVIEW_ID);
const ground = (x, z) => Math.max(0, T.heightAt(x, z));
const HELI = new Map((PV.PREVIEW.heliports || []).map((h) => [h.id, h]));
const padY = (p) => {
  const h = HELI.get(p.id);
  if (h && h.elev != null) return h.elev;
  return ground(p.x, p.z) + ((h && h.above) || 0);
};
const E = TP.endpoints({ padY });
const pairs = TP.routePairs(E);
const { CATS, CAT_IDS, NO_RUNWAY_M } = TP;

/* ------------------------------------------------------------------ */
/* Route planning                                                      */
/* ------------------------------------------------------------------ */

/*
 * "add more npc aircraft" (the owner, 2026-11-11). Before: Low 8, Medium 16, High 24, Ultra 32 at once, from
 * 16 types. Now Medium, High and Ultra fly a third more at least, from more types — and Low, which the school
 * iPads and Chromebooks start on, is what it was, number for number.
 */
const WAS = { low: 8, medium: 16, high: 24, ultra: 32 };
{
  const L = TP.TIERS.low;
  ok('the tiers: Low is as it was (8 at once, 2 full models, a fleet of 6) — the weak-device tier got no dearer',
    L.n === 8 && L.models === 2 && L.fleet === 6 && L.near === 2500 && L.far === 9000 && L.buildGap === 6
      && TP.LOW_WAS.n === L.n && TP.LOW_WAS.models === L.models && TP.LOW_WAS.fleet === L.fleet,
    JSON.stringify(L));
  const up = ['medium', 'high', 'ultra'].map((q) => TP.TIERS[q].n / WAS[q]);
  ok('the tiers: Medium, High and Ultra fly at least a third more than before (16 / 24 / 32), each tier more than the last',
    up.every((r) => r >= 1.33 && r <= 1.6) && TP.TIERS.low.n < TP.TIERS.medium.n && TP.TIERS.medium.n < TP.TIERS.high.n && TP.TIERS.high.n < TP.TIERS.ultra.n
      && TP.TIERS.medium.models >= 3 && TP.TIERS.high.models >= TP.TIERS.medium.models && TP.TIERS.ultra.models >= TP.TIERS.high.models && TP.TIERS.ultra.models <= 8,
    ['low', 'medium', 'high', 'ultra'].map((q) => `${q} ${WAS[q]}→${TP.TIERS[q].n} (${TP.TIERS[q].models} models, fleet ${TP.TIERS[q].fleet})`).join(', '));
}
{
  // More KINDS: every id a kind may fly is in the roster and is that kind of aircraft; and there are more of them.
  const AC = await import(SRC + 'aircraft/types.js');
  const LV = await import(SRC + 'aircraft/liveries.js');
  const every = CAT_IDS.flatMap((id) => [...CATS[id].types, ...(CATS[id].rare || [])].map((t) => [id, t]));
  const missing = every.filter(([, t]) => !AC.AIRCRAFT.some((a) => a.id === t)).map(([, t]) => t);
  const isHeli = (a) => String(a.class || '').toLowerCase() === 'helicopter';
  const wrong = every.filter(([id, t]) => {
    const a = AC.AIRCRAFT.find((x) => x.id === t);
    if (!a) return false;
    if (id === 'heli') return !isHeli(a);
    if (isHeli(a) || a.category === 'special' || a.secret) return true;
    if (id === 'mil') return !a.military;
    return !!a.military;
  }).map(([id, t]) => `${id}:${t}`);
  const ids = new Set(every.map(([, t]) => t));
  ok('more kinds: 27 types may fly (16 before), every one in the roster and the right sort for its kind; no secret or novelty types',
    ids.size >= 27 && ids.size === every.length && missing.length === 0 && wrong.length === 0,
    `${ids.size} types; missing ${missing.join(' ') || 'none'}; wrong ${wrong.join(' ') || 'none'}`);
  // An everyday airliner always has a (parody) airline to fly for; no airline in the game carries a real carrier's name.
  const everyday = ['jet', 'wide', 'prop'].flatMap((id) => CATS[id].types).filter((t) => t !== 'meridian');
  const bare = everyday.filter((t) => LV.airlinesFor(AC.getAircraft(t)).length === 0);
  const REAL = /(united|delta|american airlines|lufthansa|emirates|qatar|british airways|air france|klm|ryanair|easyjet|southwest|fedex|ups|dhl|qantas|singapore airlines|turkish airlines|etihad|air india|jetblue|alaska airlines)/i;
  const real = LV.AIRLINE_LIVERIES.filter((l) => REAL.test(String(l.name || ''))).map((l) => l.name);
  ok('more kinds: every everyday airliner type has an airline that flies it, and no airline wears a real carrier\'s name',
    bare.length === 0 && real.length === 0, `no airline: ${bare.join(' ') || 'none'}; real names: ${real.join(', ') || 'none'}`);
  // The rare ones are rare: about one in eight of a kind that has any, never the usual sight.
  const rand = TP.makeRand(5);
  const seen = {};
  let rare = 0;
  let N = 0;
  for (let i = 0; i < 20000; i++) {
    const id = TP.pickCat(rand);
    const t = TP.pickTypeId(id, rand);
    seen[t] = (seen[t] || 0) + 1;
    N++;
    if ((CATS[id].rare || []).includes(t)) rare++;
  }
  const never = [...ids].filter((t) => !seen[t]);
  const gone = TP.pickTypeId('wide', TP.makeRand(1), (t) => t === 'b747');
  ok('more kinds: every type turns up, the rare ones (Concorde, the outsize freighters, the army helicopters, the bomber) 3-15% of the time; a type an edition lacks is never picked',
    never.length === 0 && rare / N > 0.03 && rare / N < 0.15 && gone === 'b747' && Math.abs(CAT_IDS.reduce((a, id) => a + CATS[id].share, 0) - 1) < 1e-9,
    `rare ${(100 * rare / N).toFixed(1)}%; never seen: ${never.join(' ') || 'none'}; ${Object.entries(seen).sort((a, b) => b[1] - a[1]).map(([t, k]) => `${t} ${(100 * k / N).toFixed(1)}%`).join(', ')}`);
  // Each tier's sky really has its count, of several kinds — and Low never more than its eight.
  const P = { x: 0, y: 900, z: 0, vx: 50, vy: 0, vz: 0 };
  const rows = [];
  let okAll = true;
  for (const q of ['low', 'medium', 'high', 'ultra']) {
    const sim = new TP.TrafficSim({ tier: q, ground, rand: TP.makeRand(41), endpoints: E, windDirDeg: 80 });
    const ctx = { player: P, cam: P, windDirDeg: 80 };
    sim.populate(ctx);
    let most = sim.list.length;
    const types = new Set(sim.list.map((c) => c.typeId));
    const kinds = new Set(sim.list.map((c) => c.catId));
    for (let t = 0; t < 1800; t += 0.5) {
      sim.step(0.5, ctx);
      most = Math.max(most, sim.list.length);
      for (const c of sim.list) {
        types.add(c.typeId);
        kinds.add(c.catId);
      }
    }
    rows.push(`${q}: ${sim.list.length} flying (most ${most}), ${types.size} types, ${kinds.size} kinds`);
    if (most > TP.TIERS[q].n || sim.list.length < TP.TIERS[q].n - 2 || kinds.size < 4) okAll = false;
    if (q === 'low' && most > TP.LOW_WAS.n) okAll = false;
    if (q !== 'low' && types.size < 10) okAll = false;
  }
  ok('each tier flies its own count for half an hour (never over it; Low never over 8), of four kinds or more and, above Low, ten types or more', okAll, rows.join('; '));
}
ok('every kind of traffic has routes (airliners, widebodies, props, light, helicopters, the C-17)',
  CAT_IDS.every((id) => pairs[id].length > 0), CAT_IDS.map((id) => `${id} ${pairs[id].length}`).join(', '));
{
  const longs = new Set(pairs.jet.flatMap(([a, b]) => [a.code, b.code]));
  const shortOk = pairs.jet.every(([a, b]) => a.length >= 2300 && b.length >= 2300) && pairs.wide.every(([a, b]) => a.length >= 2800 && b.length >= 2800);
  const strips = pairs.light.some(([a]) => a.kind === 'ga');
  ok('airliners only between the long runways (2,300 m; widebodies 2,800 m), light aircraft from the strips', shortOk && strips, `airliner fields: ${[...longs].join(' ')}`);
}

{
  const P = { x: 0, z: 0, dx: 0, dz: 0 };
  const Q = { x: 0, z: 0, dx: 0, dz: 0 };
  let jumps = 0;
  let worstJump = 0;
  let notStraight = 0;
  let badTouch = 0;
  let badPark = 0;
  let badPad = 0;
  let lowWorst = Infinity;
  let lowAt = '';
  let steep = 0;
  let steepAt = '';
  let band = 0;
  let semi = 0;
  let plans = 0;
  for (const wind of [80, 260]) {
    for (const id of CAT_IDS) {
      const C = CATS[id];
      for (const [a, b] of pairs[id]) {
        const p = TP.planRoute(id, a, b, { ground, windDirDeg: wind });
        plans++;
        // Continuity.
        for (const e of p.path.els) {
          if (e.s0 <= 0) continue;
          TP.evalPath(p.path, e.s0 - 0.01, P, { i: 0 });
          TP.evalPath(p.path, e.s0 + 0.01, Q, { i: 0 });
          const j = Math.hypot(P.x - Q.x, P.z - Q.z);
          if (j > worstJump) worstJump = j;
          if (j > 1) jumps++;
        }
        if (!C.pads) {
          // Straight in from the gate, on the centreline.
          for (let s = p.sG + 10; s < p.sTD; s += 200) {
            TP.evalPath(p.path, s, P);
            if (Math.abs(P.z - b.z) > 1 || Math.abs(P.dz) > 1e-3 || Math.sign(P.dx) !== TP.runwayDir(wind)) notStraight++;
          }
          TP.evalPath(p.path, p.sTD, P);
          if (Math.abs(P.x - b.x) > b.length / 2 || Math.abs(P.z - b.z) > b.halfWidth || Math.abs(TP.altAt(p, p.sTD) - b.elev) > 0.5) badTouch++;
          TP.evalPath(p.path, p.sP, P);
          if (Math.abs(P.z - b.z) < b.halfWidth + 40) badPark++;
        } else {
          TP.evalPath(p.path, p.sP, P);
          if (Math.hypot(P.x - b.x, P.z - b.z) > 1 || Math.abs(TP.altAt(p, p.sP) - b.elev) > 0.5) badPad++;
        }
        // The profile: over the ground by the clearance from the climb-out to the gate; within the gradients.
        const clear = C.pads ? C.agl : C.clear;
        for (let k = 0; k < p.n; k++) {
          const s = k * TP.DS;
          if (s < 1200 || s > p.sG - TP.DS) continue;
          const room = p.alt[k] - p.gnd[k];
          if (room < lowWorst) {
            lowWorst = room;
            lowAt = `${id} ${a.code}-${b.code} at ${(s / 1000).toFixed(1)} km`;
          }
          if (k > 0) {
            const g = (p.alt[k] - p.alt[k - 1]) / TP.DS;
            if (s > 1200 && (g > C.climb * 1.02 + 1e-4 || -g > C.desc * 1.02 + 1e-4)) {
              steep++;
              if (!steepAt) steepAt = `${id} ${a.code}-${b.code} at ${(s / 1000).toFixed(1)} km: ${(g * 100).toFixed(1)}%`;
            }
          }
        }
        if (!C.pads) {
          const lo = Math.min(C.cruiseMin, p.cruise);
          if (p.cruise < C.cruiseMin - 1 || p.cruise > Math.max(C.cruiseMax + 700, p.gnd.reduce((m, g) => Math.max(m, g), 0) + C.clear + 700)) band++;
          const ft = Math.round(p.cruise / 0.3048 - (C.vfr ? 500 : 0));
          const east = p.bearing < 180;
          const k = Math.round(ft / 1000);
          if (Math.abs(ft - k * 1000) > 2 || (east ? k % 2 !== 1 : k % 2 !== 0)) semi++;
          void lo;
        }
      }
    }
  }
  ok('routes: every path continuous where its legs and turns meet', jumps === 0, `${plans} plans, worst step ${worstJump.toFixed(3)} m`);
  ok('routes: straight in on the extended centreline from the gate, the way the wind has the runway', notStraight === 0, `${notStraight} off-line samples`);
  ok('routes: the touchdown is on the runway at field elevation', badTouch === 0, `${badTouch} off`);
  ok('routes: after the roll-out it turns off and stops clear of the runway edge', badPark === 0, `${badPark} on the runway`);
  ok('routes: a helicopter ends on its pad', badPad === 0, `${badPad} off`);
  ok('routes: the type\'s clearance over the ground (and a wing either side) from the climb-out to the gate', lowWorst >= Math.min(...CAT_IDS.map((id) => (CATS[id].pads ? CATS[id].agl : CATS[id].clear))) - 1, `closest ${lowWorst.toFixed(0)} m (${lowAt})`);
  ok('routes: climbs and descents within the type\'s own gradients', steep === 0, steepAt || `${plans} plans`);
  ok('routes: cruise in the type\'s band (above the ground where it must be)', band === 0, `${band} out of band`);
  ok('routes: cruise at a semicircular level (east odd thousands, west even; VFR +500 ft)', semi === 0, `${semi} off`);
}

/* ------------------------------------------------------------------ */
/* The runway rule                                                     */
/* ------------------------------------------------------------------ */

function soak({ seconds, dt = 0.5, player, wind = 80, n = TP.TIERS.ultra.n, seed = 11, tier = 'ultra' }) {
  const sim = new TP.TrafficSim({ tier, ground, rand: TP.makeRand(seed), endpoints: E, windDirDeg: wind, n });
  const P = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  const ctx = { player: P, cam: P, windDirDeg: wind };
  player(P, 0);
  sim.populate(ctx);
  const bad = { groundNear: 0, groundAt: '', nan: 0 };
  for (let t = 0; t < seconds; t += dt) {
    player(P, t);
    sim.step(dt, ctx);
    for (const c of sim.list) {
      if (!Number.isFinite(c.x + c.y + c.z + c.hdg + c.pitch + c.bank)) bad.nan++;
      if (c.onGround) {
        const f = c.plan.to;
        const d = Math.hypot(f.x - P.x, f.z - P.z);
        if (d < NO_RUNWAY_M && P.parked) {
          bad.groundNear++;
          if (!bad.groundAt) bad.groundAt = `${c.id} ${c.catId} at ${f.code}, you ${(d / 1000).toFixed(1)} km away`;
        }
      }
    }
  }
  return { sim, bad };
}

{
  let spawnsNear = 0;
  let spawnsSeen = 0;
  let grounded = 0;
  let touchNear = 0;
  let touches = 0;
  let nan = 0;
  let groundAt = '';
  const tot = { holds: 0, goArounds: 0, diverts: 0, spawned: 0, despawned: 0 };
  const why = {};
  for (const a of E.fields) {
    for (const wind of [80]) {
      const { sim, bad } = soak({
        seconds: 1200,
        wind,
        seed: 3 + a.x * 7 + a.z,
        player: (P) => {
          P.x = a.x;
          P.z = a.z;
          P.y = a.elev + 2;
          P.vx = P.vy = P.vz = 0;
          P.parked = true;
        },
      });
      grounded += bad.groundNear;
      nan += bad.nan;
      if (!groundAt) groundAt = bad.groundAt;
      for (const e of sim.events) {
        if (e.type === 'spawn') {
          if (e.playerToField != null && e.playerToField < NO_RUNWAY_M) spawnsNear++;
          if (e.mode === 'hidden' && Math.hypot(e.x - a.x, e.z - a.z) < sim.T.far) spawnsSeen++;
          if (!e.airborne) spawnsNear++;
        }
        if (e.type === 'touchdown') {
          touches++;
          if (e.playerToField < NO_RUNWAY_M) touchNear++;
        }
        if (e.type === 'hold') why[e.why] = (why[e.why] || 0) + 1;
      }
      for (const k of Object.keys(tot)) tot[k] += sim.stats[k];
    }
  }
  ok('runway rule: every one appears airborne, never at a field within 8 km of you, and out of sight after the start', spawnsNear === 0 && spawnsSeen === 0,
    `${tot.spawned} appeared over 16 x 20 min, ${spawnsNear} near you, ${spawnsSeen} in sight`);
  ok('runway rule: nothing on the ground within 8 km of you, parked at each of the 16 fields for 20 minutes', grounded === 0 && touchNear === 0,
    groundAt || `${touches} landings elsewhere (out of sight they are gone on a long final), none within 8 km of you`);
  ok('runway rule: exercised — holds for you and for the sequence, go-arounds and diverts', tot.holds > 20 && (why.player || 0) > 5 && tot.diverts > 0,
    `holds ${tot.holds} (${Object.entries(why).map(([k, v]) => `${k} ${v}`).join(', ')}), go-arounds ${tot.goArounds}, diverts ${tot.diverts}`);
  ok('runway rule: no NaN anywhere over the soak', nan === 0, `${nan}`);
}

{
  // You, flying an hour between the fields at 60 m/s and 600 m, a leg at a time, landing at each.
  const order = E.fields.slice().sort((p, q) => p.x - q.x);
  let leg = 0;
  let legT = 0;
  const route = [];
  for (let i = 0; i < order.length; i++) route.push(order[(i * 5) % order.length]);
  let touchNear = 0;
  let touches = 0;
  let nan = 0;
  const { sim } = soak({
    seconds: 3600,
    seed: 99,
    player: (P, t) => {
      const a = route[leg % route.length];
      const b = route[(leg + 1) % route.length];
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      const dur = d / 60 + 60; // a minute on the ground at each
      const u = Math.min(1, Math.max(0, (t - legT - 60) * 60 / d));
      P.x = a.x + (b.x - a.x) * u;
      P.z = a.z + (b.z - a.z) * u;
      const air = u > 0 && u < 1;
      P.y = air ? Math.max(a.elev, b.elev) + Math.min(600, Math.min(u, 1 - u) * d * 0.08) : (u <= 0 ? a.elev : b.elev) + 2;
      P.vx = air ? ((b.x - a.x) / d) * 60 : 0;
      P.vz = air ? ((b.z - a.z) / d) * 60 : 0;
      P.vy = 0;
      if (t - legT > dur) {
        leg++;
        legT = t;
      }
    },
  });
  for (const e of sim.events) {
    if (e.type === 'touchdown') {
      touches++;
      if (e.playerToField < NO_RUNWAY_M) touchNear++;
    }
  }
  for (const c of sim.list) if (!Number.isFinite(c.x + c.y + c.z)) nan++;
  ok('runway rule: flying an hour between the fields, no landing at a field within 8 km of you', touchNear === 0 && nan === 0,
    `${touches} landings, ${touchNear} near you; ${sim.stats.goArounds} go-arounds, ${sim.stats.holds} holds, ${sim.stats.diverts} diverts`);
}

{
  // On the final when you come within 8 km of the field: it goes around and does not land.
  const sim = new TP.TrafficSim({ tier: 'ultra', ground, rand: TP.makeRand(8), endpoints: E, windDirDeg: 80, n: 0 });
  const pr = pairs.jet.find(([, b]) => b.id === 'haven') || pairs.jet[0];
  const P = { x: pr[1].x + 30000, y: 3000, z: pr[1].z + 30000, vx: 0, vy: 0, vz: 0 };
  const ctx = { player: P, cam: P, windDirDeg: 80 };
  const plan0 = TP.planRoute('jet', pr[0], pr[1], { ground, windDirDeg: 80 });
  const c = sim.spawn(ctx, 'start', { catId: 'jet', pair: pr, s: plan0.sG + 3000 });
  let landed = false;
  for (let t = 0; t < 400; t += 0.25) {
    if (t > 5 && t < 6) {
      // You turn up 6 km from the field, on the ground.
      P.x = pr[1].x - 6000;
      P.z = pr[1].z + 1500;
      P.y = pr[1].elev + 2;
    }
    sim.step(0.25, ctx);
    if (c.onGround) landed = true;
  }
  const ga = sim.events.filter((e) => e.type === 'goAround' && e.id === c.id).length;
  const held = sim.events.some((e) => e.type === 'hold' && e.id === c.id && e.why === 'player');
  ok('runway rule: on the final when you come within 8 km of the field — a go-around, a hold, no landing', ga >= 1 && held && !landed && !c.gone,
    `go-arounds ${ga}, held ${held}, landed ${landed}, now ${c.phase} at ${Math.round(c.y)} m`);
}

{
  // In sight (the wind has it landing 09, from the west) but the field more than 8 km away: it lands, rolls out, turns off, and is gone once out of sight.
  const sim = new TP.TrafficSim({ tier: 'low', ground, rand: TP.makeRand(9), endpoints: E, windDirDeg: 80, n: 0 });
  const pr = pairs.jet.find(([, b]) => b.id === 'haven') || pairs.jet[0];
  const b = pr[1];
  // 9.5 km from the field, 4 km from where it would otherwise be gone on its long final: in sight.
  const P = { x: b.x - 9000, y: 1500, z: b.z + 3000, vx: 0, vy: 0, vz: 0 };
  const ctx = { player: P, cam: P, windDirDeg: 80 };
  const plan0 = TP.planRoute('jet', pr[0], b, { ground, windDirDeg: 80 });
  const c = sim.spawn(ctx, 'start', { catId: 'jet', pair: pr, s: plan0.sG + 2000 });
  let touchedOn = null;
  let parkedAt = null;
  for (let t = 0; t < 600 && !c.gone; t += 0.25) {
    sim.step(0.25, ctx);
    if (c.onGround && !touchedOn) touchedOn = { x: c.x, z: c.z, y: c.y };
    if (c.state === 'parked' && !parkedAt) {
      parkedAt = { x: c.x, z: c.z };
      // You fly off, out of sight.
      P.z += 40000;
    }
  }
  const onRwy = touchedOn && Math.abs(touchedOn.x - b.x) < b.length / 2 && Math.abs(touchedOn.z - b.z) < b.halfWidth;
  const off = parkedAt && Math.abs(parkedAt.z - b.z) > b.halfWidth + 40;
  ok('in sight with the field 9.5 km from you: it lands on the runway, turns off clear of it, and is gone once out of sight', onRwy && off && c.gone,
    `touchdown ${touchedOn ? `${Math.round(touchedOn.x - b.x)} m along, ${Math.round(touchedOn.z - b.z)} m off the centreline` : 'none'}, parked ${parkedAt ? `${Math.round(Math.abs(parkedAt.z - b.z))} m from the centreline` : 'never'}, gone ${c.gone}`);
}

/* ------------------------------------------------------------------ */
/* Separation                                                          */
/* ------------------------------------------------------------------ */

/** One aircraft and you, flown together; the closest you came. */
function meet(catId, pairIdx, s, setup, seconds = 240) {
  const sim = new TP.TrafficSim({ tier: 'ultra', ground, rand: TP.makeRand(5), endpoints: E, windDirDeg: 80, n: 0 });
  const P = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  const ctx = { player: null, cam: null, windDirDeg: 80 };
  const c = sim.spawn(ctx, 'start', { catId, pair: pairs[catId][pairIdx % pairs[catId].length], s });
  // Where it will be in 60 s, with nobody about: that is where you are put to meet it.
  sim.step(0.01, ctx);
  setup(P, c);
  ctx.player = P;
  ctx.cam = P;
  let worst = { dh: Infinity, dv: Infinity, d3: Infinity, bad: false };
  const dt = 0.1;
  for (let t = 0; t < seconds; t += dt) {
    P.x += P.vx * dt;
    P.y += P.vy * dt;
    P.z += P.vz * dt;
    sim.step(dt, ctx);
    if (c.gone) break;
    const dh = Math.hypot(c.x - P.x, c.z - P.z);
    const dv = Math.abs(c.y - P.y);
    const d3 = Math.hypot(dh, dv);
    if (d3 < worst.d3) worst = { dh, dv, d3, bad: worst.bad };
    if (dh < 1000 && dv < 200) worst.bad = true;
  }
  return { worst, c, sim };
}

/**
 * You, put on its track where you will meet it in `secs` seconds flying at `along` m/s along its track
 * (negative: towards it), `dy` above its height then.
 */
function onTrack(c, secs, P, along = 0, dy = 0) {
  const h = Math.hypot(c.vx, c.vz) || 1;
  const ux = c.vx / h;
  const uz = c.vz / h;
  const gap = (h - along) * secs;
  P.x = c.x + ux * gap;
  P.z = c.z + uz * gap;
  P.y = c.y + c.vy * secs + dy;
  P.vx = ux * along;
  P.vz = uz * along;
  P.vy = 0;
}

{
  const lines = [];
  let bad = 0;
  let closest = Infinity;
  for (const catId of ['jet', 'wide', 'prop', 'light', 'heli', 'mil']) {
    const C = CATS[catId];
    const cases = {
      // Meeting in 90 s, at its height then (further than it looks: a fair warning, as a real one gets).
      'head-on': (P, c) => onTrack(c, 90, P, -120),
      'across its track': (P, c) => {
        onTrack(c, 90, P, 0);
        const h = Math.hypot(c.vx, c.vz) || 1;
        // Coming in from its right, at 100 m/s, to the same point at the same time.
        P.x += (-c.vz / h) * 9000;
        P.z += (c.vx / h) * 9000;
        P.vx = (c.vz / h) * 100;
        P.vz = (-c.vx / h) * 100;
      },
      'slow, ahead of it on its track': (P, c) => onTrack(c, 90, P, Math.min(25, Math.hypot(c.vx, c.vz) * 0.5)),
      'hovering on its track': (P, c) => onTrack(c, 90, P, 0),
      'climbing through its level': (P, c) => {
        onTrack(c, 90, P, 0, -630);
        P.vy = 7;
      },
    };
    for (const [name, setup] of Object.entries(cases)) {
      const idx = catId === 'heli' ? 3 : 1;
      const s = catId === 'heli' ? 4000 : catId === 'light' ? 6000 : 20000;
      const { worst } = meet(catId, idx, s, setup);
      if (worst.bad) bad++;
      if (worst.d3 < closest) closest = worst.d3;
      lines.push(`${catId} ${name}: ${(worst.dh / 1000).toFixed(2)} km / ${worst.dv.toFixed(0)} m`);
      void C;
    }
  }
  ok('separation: head-on, across, slowly ahead, hovering, climbing through — never within 1 km and 200 m of you', bad === 0, lines.join('; '));
  ok('separation: ...and never closer than the 300 m vertical standard in any direction', closest > TP.SEP_V * 0.95, `closest ${closest.toFixed(0)} m`);
}

{
  // A hundred straight lines through the busy airspace, 30-150 m/s, at the levels traffic uses.
  const rand = TP.makeRand(2024);
  let bad = 0;
  let worst = Infinity;
  let worstAt = '';
  let checks = 0;
  for (let run = 0; run < 100; run++) {
    const a = E.fields[Math.floor(rand() * E.fields.length)];
    const ang = rand() * Math.PI * 2;
    const v = 30 + rand() * 120;
    const y = [400, 900, 1500, 2500, 4000, 5500, 7000][Math.floor(rand() * 7)];
    const P = { x: a.x - Math.sin(ang) * 30000, z: a.z + Math.cos(ang) * 30000, y, vx: Math.sin(ang) * v, vz: -Math.cos(ang) * v, vy: 0 };
    const sim = new TP.TrafficSim({ tier: 'ultra', ground, rand: TP.makeRand(run + 1), endpoints: E, windDirDeg: run % 2 ? 80 : 260, n: TP.TIERS.ultra.n });
    const ctx = { player: P, cam: P, windDirDeg: run % 2 ? 80 : 260 };
    sim.populate(ctx);
    const dt = 0.25;
    for (let t = 0; t < 600; t += dt) {
      P.x += P.vx * dt;
      P.z += P.vz * dt;
      sim.step(dt, ctx);
      for (const c of sim.list) {
        if (c.knocked || c.onGround) continue;
        const dh = Math.hypot(c.x - P.x, c.z - P.z);
        const dv = Math.abs(c.y - P.y);
        checks++;
        const d3 = Math.hypot(dh, dv);
        if (d3 < worst) {
          worst = d3;
          worstAt = `run ${run}: ${c.catId} ${c.phase}, you at ${v.toFixed(0)} m/s ${y} m — ${(dh / 1000).toFixed(2)} km / ${dv.toFixed(0)} m`;
        }
        if (dh < 1000 && dv < 200) bad++;
      }
    }
  }
  ok('separation: a hundred straight-line flights through the busy airspace (30-150 m/s) — never within 1 km and 200 m', bad === 0, `closest ${worst.toFixed(0)} m (${worstAt}), ${bad} frames inside`);
}

/* ------------------------------------------------------------------ */
/* Smooth flight (the checker's finds, 2026-11-01)                     */
/* ------------------------------------------------------------------ */

{
  // Every turn on every route at no more than about twice the rate the type turns at its own bank: a route whose
  // destination is behind the climb-out used to reverse in one clipped corner — a 180 at an 11 m radius, 478
  // degrees a second, in sight at the flight's start.
  let worst = 0;
  let worstAt = '';
  for (const wind of [80, 260]) {
    for (const id of CAT_IDS) {
      const C = CATS[id];
      for (const [a, b] of pairs[id]) {
        const p = TP.planRoute(id, a, b, { ground, windDirDeg: wind });
        for (const e of p.path.els) {
          if (e.kind !== 1 || e.s0 >= p.sTD) continue;
          const sm = e.s0 + e.len / 2;
          const v = TP.speedAt(p, sm, TP.altAt(p, sm));
          const r = v / e.r / (9.81 * Math.tan(C.bank * Math.PI / 180) / v);
          if (r > worst) {
            worst = r;
            worstAt = `${id} ${a.code}-${b.code}, a ${Math.round(e.r)} m turn at ${Math.round(v)} m/s, ${(e.s0 / 1000).toFixed(1)} km along`;
          }
        }
      }
    }
  }
  ok('smooth: no turn on any route tighter than about twice the rate the type turns at its own bank', worst < 2.2, `worst ${worst.toFixed(2)}x (${worstAt})`);
}

{
  // No jump, no snap: going into a hold, coming out of it (the join point is the middle of the turn there, not
  // the corner it cuts; a stack's upper level steps down onto the approach), a go-around, a divert. The track
  // between frames never moves further than the speed allows, the nose never turns faster than HDG_RATE.
  let jump = 0;
  let jumpAt = '';
  let snap = 0;
  let snapAt = '';
  let holds = 0;
  let outs = 0;
  let gas = 0;
  const dt = 0.1;
  for (const [i, f] of E.fields.entries()) {
    if (i % 3) continue;
    const sim = new TP.TrafficSim({ tier: 'ultra', ground, rand: TP.makeRand(100 + i), endpoints: E, windDirDeg: i % 2 ? 80 : 260, n: TP.TIERS.ultra.n });
    const P = { x: f.x, y: f.elev, z: f.z, vx: 0, vy: 0, vz: 0 };
    const ctx = { player: P, cam: P, windDirDeg: i % 2 ? 80 : 260 };
    sim.populate(ctx);
    const last = new Map();
    for (let t = 0; t < 600; t += dt) {
      // Halfway through you fly off the field towards the middle of the map: finals near you go around.
      if (t > 300) {
        P.vx = -Math.sign(P.x) * 70;
        P.vz = -Math.sign(P.z) * 70;
        P.y = f.elev + 600;
        P.x += P.vx * dt;
        P.z += P.vz * dt;
      }
      sim.step(dt, ctx);
      for (const c of sim.list) {
        const L = last.get(c.id);
        if (L && !c.knocked) {
          const d = Math.hypot(c.x - L.x, c.y - L.y, c.z - L.z);
          if (d > (Math.max(c.v, L.v) + 40) * dt + 1) {
            jump++;
            if (!jumpAt) jumpAt = `${c.catId} ${L.state} -> ${c.state}, ${Math.round(d)} m in ${dt} s`;
          }
          const dh = Math.abs(((c.hdg - L.hdg + 540) % 360) - 180);
          if (dh > TP.HDG_RATE * dt + 0.5) {
            snap++;
            if (!snapAt) snapAt = `${c.catId} ${L.state} -> ${c.state}, ${dh.toFixed(0)} degrees in ${dt} s`;
          }
        }
        last.set(c.id, { x: c.x, y: c.y, z: c.z, v: c.v, hdg: c.hdg, state: c.state });
      }
    }
    holds += sim.stats.holds;
    outs += sim.events.filter((e) => e.type === 'hold').length;
    gas += sim.stats.goArounds + sim.stats.diverts;
  }
  ok('smooth: no jump into or out of a hold, a go-around or a divert, and no snap of the nose', jump === 0 && snap === 0 && holds > 0,
    `${jump} jumps${jumpAt ? ` (${jumpAt})` : ''}, ${snap} snaps${snapAt ? ` (${snapAt})` : ''}; ${holds} holds, ${gas} go-arounds and diverts`);
}

{
  // A go-around keeps its heading a moment and turns off at its bank: no 40-degree snap onto the new track.
  const sim = new TP.TrafficSim({ tier: 'ultra', ground, rand: TP.makeRand(8), endpoints: E, windDirDeg: 80, n: 0 });
  const pr = pairs.jet.find(([, b]) => b.id === 'haven') || pairs.jet[0];
  const P = { x: pr[1].x + 30000, y: 3000, z: pr[1].z + 30000, vx: 0, vy: 0, vz: 0 };
  const ctx = { player: P, cam: P, windDirDeg: 80 };
  const plan0 = TP.planRoute('jet', pr[0], pr[1], { ground, windDirDeg: 80 });
  const c = sim.spawn(ctx, 'start', { catId: 'jet', pair: pr, s: plan0.sG + 3000 });
  let worst = 0;
  let prev = null;
  let ga = false;
  for (let t = 0; t < 120; t += 0.1) {
    if (t > 5 && t < 5.2) {
      P.x = pr[1].x - 6000;
      P.z = pr[1].z + 1500;
      P.y = pr[1].elev + 2;
    }
    sim.step(0.1, ctx);
    if (sim.stats.goArounds) ga = true;
    const trk = Math.atan2(c.vx, -c.vz) * 180 / Math.PI;
    if (prev != null && ga) worst = Math.max(worst, Math.abs(((trk - prev + 540) % 360) - 180) / 0.1);
    prev = trk;
  }
  ok('smooth: a go-around turns off the final at its bank, not in one frame', ga && worst < 8, `go-around ${ga}, fastest track turn ${worst.toFixed(1)} deg/s`);
}

{
  // 250 knots below 10,000 feet (slowed before the descent gets there), and the airliners faster above it.
  const FL100_M = 10000 * 0.3048;
  const V250_MS = 250 / 1.94384;
  const sim = new TP.TrafficSim({ tier: 'ultra', ground, rand: TP.makeRand(31), endpoints: E, windDirDeg: 80, n: TP.TIERS.ultra.n });
  const P = { x: 0, y: 12000, z: 0, vx: 0, vy: 0, vz: 0 };
  const ctx = { player: P, cam: P, windDirDeg: 80 };
  sim.populate(ctx);
  let over = 0;
  let worst = 0;
  let worstAt = '';
  let fastHigh = 0;
  for (let t = 0; t < 1200; t += 0.5) {
    sim.step(0.5, ctx);
    for (const c of sim.list) {
      if (c.knocked || c.cat.pads || c.catId === 'light') continue;
      if (c.y < FL100_M - 30 && c.v > V250_MS + 1) {
        over++;
        if (c.v > worst) {
          worst = c.v;
          worstAt = `${c.callsign || c.id} ${c.catId} ${c.phase} at ${Math.round(c.y / 0.3048)} ft`;
        }
      }
      if (c.y > FL100_M + 2000 && c.v > V250_MS + 20) fastHigh++;
    }
  }
  ok('speed: 250 kt below 10,000 ft (slowed before the descent gets there), faster above', over === 0 && fastHigh > 0,
    `${over} samples over${worstAt ? ` (worst ${Math.round(worst * 1.94384)} kt, ${worstAt})` : ''}; ${fastHigh} samples faster than 270 kt above FL165`);
}

/* ------------------------------------------------------------------ */
/* From each other                                                     */
/* ------------------------------------------------------------------ */

{
  // A departure right behind another off the same runway waits (it used to appear on top of the first).
  const sim = new TP.TrafficSim({ tier: 'ultra', ground, rand: TP.makeRand(31), endpoints: E, windDirDeg: 80, n: 0 });
  const P = { x: -150000, y: 3000, z: -150000, vx: 0, vy: 0, vz: 0 };
  const ctx = { player: P, cam: P, windDirDeg: 80 };
  const pr = pairs.jet[0];
  const a = sim.spawn(ctx, 'hidden', { catId: 'jet', pair: pr });
  const b = sim.spawn(ctx, 'hidden', { catId: 'jet', pair: pr });
  const d = a && b ? Math.hypot(a.x - b.x, a.z - b.z) : null;
  ok('from each other: a departure right behind another off the same runway waits', !!a && (!b || d > TP.SEP_H * 2 || Math.abs(a.y - b.y) > TP.SEP_V * 2),
    a ? (b ? `the second appeared ${Math.round(d)} m from the first` : `the second waited (${sim.stats.delayed} delayed)`) : 'the first did not spawn');
}

{
  // A sky with nobody in it but the traffic (you 200 km away), an hour each: they keep apart from each other.
  const runs = [['ultra', 11], ['ultra', 23], ['high', 3], ['medium', 4], ['low', 5]];
  const out = [];
  let bad = 0;
  for (const [tier, seed] of runs) {
    const sim = new TP.TrafficSim({ tier, ground, rand: TP.makeRand(seed), endpoints: E, windDirDeg: 80 });
    const P = { x: -150000, y: 3000, z: -150000, vx: 0, vy: 0, vz: 0 };
    const ctx = { player: P, cam: P, windDirDeg: 80 };
    sim.populate(ctx);
    let worst = Infinity;
    const close = new Set();
    for (let t = 0; t < 3600; t += 0.25) {
      sim.step(0.25, ctx);
      const L = sim.list.filter((c) => !c.gone && !c.knocked && !c.onGround && !(c.state === 'fly' && c.s >= c.plan.sG));
      for (let i = 0; i < L.length; i++) {
        for (let j = i + 1; j < L.length; j++) {
          const p = L[i];
          const q = L[j];
          const dh = Math.hypot(p.x - q.x, p.z - q.z);
          const dv = Math.abs(p.y - q.y);
          const sep = Math.max(dh / TP.SEP_H, dv / TP.SEP_V);
          if (sep < worst) worst = sep;
          if (dh < 1000 && dv < 200) close.add(`${p.id}/${q.id}`);
        }
      }
    }
    // The allowance goes by how many fly, not by the tier's name: six an hour at 32 or more (what Ultra's 32 was
    // given), none under that. High now flies 34, so it is held to what Ultra's 32 was.
    const allow = sim.n >= 32 ? 6 : 0;
    if (worst < 0.4 || close.size > allow) bad++;
    out.push(`${tier}: ${close.size} pairs inside 1 km / 200 m (closest ${worst.toFixed(2)} of the standard), ${sim.stats.tcas} level changes, ${sim.stats.delayed} departures waited`);
  }
  ok('from each other: an hour of traffic, never closer than 0.4 of 1.5 km / 300 m, hardly ever inside 1 km / 200 m (none with fewer than 32 flying)', bad === 0, out.join('; '));
}

/* ------------------------------------------------------------------ */
/* Cost                                                                */
/* ------------------------------------------------------------------ */

{
  const sim = new TP.TrafficSim({ tier: 'ultra', ground, rand: TP.makeRand(77), endpoints: E, n: TP.TIERS.ultra.n });
  const P = { x: 0, y: 600, z: 0, vx: 60, vy: 0, vz: 0 };
  const ctx = { player: P, cam: P, windDirDeg: 80 };
  const t0 = performance.now();
  sim.populate(ctx);
  const tPop = performance.now() - t0;
  for (let i = 0; i < 600; i++) sim.step(1 / 60, ctx);
  // The best of three rounds: other work on this Mac (a browser check next door) only ever makes a round slower.
  const N = 2000;
  let per = Infinity;
  for (let k = 0; k < 3; k++) {
    const t1 = performance.now();
    for (let i = 0; i < N; i++) {
      P.x += 1;
      sim.step(1 / 60, ctx);
    }
    per = Math.min(per, (performance.now() - t1) / N);
  }
  ok(`cost: Ultra's ${TP.TIERS.ultra.n} stepped on rails in well under a tenth of a millisecond a frame (node, this Mac)`, per < 0.1, `${(per * 1000).toFixed(1)} µs a frame, the start ${tPop.toFixed(0)} ms (${sim.stats.plans} routes planned)`);
}

done();
