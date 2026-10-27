/**
 * Code F taxiing (wave 18, owner: "make sure taxi bigger btw so big planes
 * arent cooked"), in node, at every airport:
 *
 *   node tests/features/taxi-codef.mjs
 *
 * For each big aeroplane the game has (A380, BelugaXL, 747, C-17, An-225,
 * C-5, B-1B), at every map with an airfield:
 *
 *   - what the game OFFERS it there: the gate / stand / hangar / apron start
 *     the spawner resolves (Auto, and the picker's Gate and Remote choices);
 *   - for every one of those, every taxi route out — the pushback, the taxi
 *     along the apron's lane, the parallel taxiway and each connector to the
 *     runway's holding point, and the line-up — is driven with the aeroplane's
 *     own gear (nose and both main legs, from the flight model's gear points)
 *     and its wingtip-to-wingtip line:
 *       * every wheel on paving, with a margin;
 *       * the wing and the fuselage clear of every building, mast and wall
 *         (traffic/field.js groundPathProblem, the traffic's own test);
 *       * no sign under the wing (the envelope: half the span and 3 m either
 *         side of the track), no parked aeroplane or parked ground vehicle in it;
 *   - a field that cannot take it offers it no gate, stand, hangar or apron
 *     start at all (the runway, with the spawner's toast), never a start it
 *     cannot taxi out of.
 *
 * The existing airport / spawns / traffic tests hold the rest (and the wave 17
 * outline test in spawns.js for the A380 at Gateway's gate 11 stays).
 */

global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0, height: 0, style: {},
  }),
  body: { appendChild() {} },
  head: { appendChild() {} },
};
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
const warn = console.warn;
console.warn = (...a) => (/real vehicles|could not be loaded/.test(String(a[0])) ? null : warn(...a));

const SRC = new URL('../../src/', import.meta.url).href;
const THREE = await import(SRC + 'vendor/three.module.js');
const TR = await import(SRC + 'world/terrain.js');
const AP = await import(SRC + 'world/airport.js');
const APR = await import(SRC + 'world/apron.js');
const LAY = await import(SRC + 'world/airport-layout.js');
const SP = await import(SRC + 'world/spawns.js');
const TYPES = await import(SRC + 'aircraft/types.js');
const { MAPS } = await import(SRC + 'world/maps.js');
const F = await import(SRC + 'features/traffic/field.js');
const P = await import(SRC + 'features/traffic/planner.js');

const ONLY = process.env.MAP || null;
const VERBOSE = !!process.env.VERBOSE;

let failed = 0;
let passed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  if (!pass || VERBOSE) console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` — ${detail}` : ''}`);
}

export const BIG = ['a380', 'belugaxl', 'b747', 'c17', 'an225', 'c5', 'b1b'].filter((id) => TYPES.AIRCRAFT.some((t) => t.id === id));
/** Wheels on paving by this much at least (the outer main wheel to the edge: ICAO Code F asks 4 m on a straight). */
export const WHEEL_MARGIN = 1.5;
/** The wing's envelope: half the span and this, either side of the track, free of signs, parked aeroplanes and vehicles. */
export const WING_MARGIN = 3;

function loadMap(id) {
  TR.applyMap(id);
  AP.refreshRunways();
  APR.refreshApronElevation();
  TR.clearObstacles();
  TR.clearPlatforms();
  const scene = { add() {} };
  new AP.Airport(scene);
  return new APR.Apron(scene, 'high');
}

/** The aeroplane's wheels, body frame (x right, z aft): nose and the two outer main legs. */
function wheelsOf(type) {
  const spec = TYPES.specFor(type.id);
  const g = spec.gearPoints || [];
  const out = [];
  for (const p of g) {
    if (!p || !p.pos) continue;
    if (/tail|skid|wing|float/i.test(p.name || '')) continue;
    out.push({ x: p.pos.x, z: p.pos.z, name: p.name });
  }
  return out;
}

const paved = (x, z) => TR.isPaved(x, z) || TR.isOnRunway(x, z, 0);

/** How far is (x, z) inside the paving, up to `m` (sampled on a ring)? true when the whole ring is paved. */
function pavedBy(x, z, m) {
  if (!paved(x, z)) return false;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    if (!paved(x + Math.cos(a) * m, z + Math.sin(a) * m)) return false;
  }
  return true;
}

/** The parked aeroplanes and parked crew vehicles, as boxes { x0..z1, what }. */
function parkedThings(ap, ownStand) {
  const out = [];
  for (const p of ap.parked || []) {
    const tg = p.tg;
    if (!tg || !tg.info || (ownStand && p.stand === ownStand)) continue;
    const I = tg.info;
    const pts = [];
    for (const lx of [-I.halfSpan, I.halfSpan]) {
      for (const lz of [I.noseZ, I.tailZ]) {
        pts.push({ x: tg.ox + tg.rx * lx - tg.fx * lz, z: tg.oz + tg.rz * lx - tg.fz * lz });
      }
    }
    out.push({ x0: Math.min(...pts.map((q) => q.x)), x1: Math.max(...pts.map((q) => q.x)), z0: Math.min(...pts.map((q) => q.z)), z1: Math.max(...pts.map((q) => q.z)), what: `the aeroplane parked on ${p.stand ? p.stand.id : 'a hangar slot'}`, plane: p });
  }
  for (const c of ap.crews || []) {
    if (!c.tg || !c.poses || (c.opts && c.opts.spare)) continue;
    if (ownStand && c.opts && c.opts.stand === ownStand) continue;
    for (const k of ['tug', 'stairTruck', 'cateringTruck', 'fuelTruck', 'beltLoader', 'gpu']) {
      const q = c.poses[k];
      if (!q) continue;
      out.push({ x0: q.x - 3, x1: q.x + 3, z0: q.z - 3, z1: q.z + 3, what: `a parked ${k}` });
    }
  }
  return out;
}

/** Drive one leg: every metre, the wheels and the wing. Returns the first problem, or null. */
function driveLeg(leg, perf, type, lay, things, wheels) {
  const p = leg.path;
  const half = perf.span / 2;
  const env = half + WING_MARGIN;
  const signs = (lay && lay.signs) || [];
  for (let i = 0; i < p.n; i++) {
    const last = i === p.n - 1;
    const dx = last ? 0 : p.x[i + 1] - p.x[i];
    const dz = last ? 0 : p.z[i + 1] - p.z[i];
    const k = last ? 1 : Math.max(1, Math.ceil(Math.hypot(dx, dz) / 1.0));
    for (let j = 0; j < k; j++) {
      const t = j / k;
      const x = p.x[i] + dx * t;
      const z = p.z[i] + dz * t;
      // The heading the nose points: a pushback's path points the way it moves, tail first.
      let h = p.hdg[i] + (last ? 0 : F.wrapPi ? 0 : 0);
      if (!last) {
        const dh = Math.atan2(Math.sin(p.hdg[i + 1] - p.hdg[i]), Math.cos(p.hdg[i + 1] - p.hdg[i]));
        h = p.hdg[i] + dh * t;
      }
      if (leg.reverse) h += Math.PI;
      const c = Math.cos(h);
      const s = Math.sin(h);
      // Right is (cos h, sin h); the nose (sin h, -cos h); body z is aft.
      for (const w of wheels) {
        const wx = x + c * w.x - s * w.z;
        const wz = z + s * w.x + c * w.z;
        if (!pavedBy(wx, wz, WHEEL_MARGIN)) return `${leg.kind}: the ${w.name} wheels within ${WHEEL_MARGIN} m of the grass at (${Math.round(wx)}, ${Math.round(wz)})`;
      }
      for (const sg of signs) {
        // A runway's red sign that stays at a hold inside a junction's turn (airport-layout.js `inTurn`) is counted apart.
        if (sg.inTurn) continue;
        const rx = sg.x - x;
        const rz = sg.z - z;
        const along = rx * s - rz * c;
        const across = rx * c + rz * s;
        if (Math.abs(across) < env && along > -perf.tailLen && along < perf.noseLen) return `${leg.kind}: the ${sg.text || sg.kind} sign under the wing at (${Math.round(sg.x)}, ${Math.round(sg.z)}), ${Math.abs(across).toFixed(0)} m off the track`;
      }
      for (const o of things) {
        // The wing's line and the body's line against the box, grown by the margin.
        const ax = x - c * env;
        const az = z - s * env;
        const bx = x + c * env;
        const bz = z + s * env;
        if (segBox(ax, az, bx, bz, o, 0) || segBox(x - s * perf.tailLen, z + c * perf.tailLen, x + s * perf.noseLen, z - c * perf.noseLen, o, WING_MARGIN)) return `${leg.kind}: the wing over ${o.what} at (${Math.round(x)}, ${Math.round(z)})`;
      }
    }
  }
  return null;
}

function segBox(ax, az, bx, bz, o, pad) {
  const x0 = o.x0 - pad;
  const x1 = o.x1 + pad;
  const z0 = o.z0 - pad;
  const z1 = o.z1 + pad;
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  for (const [p, d, lo, hi] of [[ax, dx, x0, x1], [az, dz, z0, z1]]) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return false;
    } else {
      let u = (lo - p) / d;
      let v = (hi - p) / d;
      if (u > v) [u, v] = [v, u];
      t0 = Math.max(t0, u);
      t1 = Math.min(t1, v);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/** What the spawner hands this type here: the starts that are on the ground at the field, not the runway or a hover. */
function offeredStarts(mapId, type) {
  const cls = SP.spawnClassOf(type);
  const out = [];
  const seen = new Set();
  for (const choice of ['auto', 'gate', 'remote']) {
    let r;
    try {
      r = SP.resolveSpawn(mapId, cls, { type, choice });
    } catch (e) {
      continue;
    }
    if (!r || !['stand', 'hangar', 'apron'].includes(r.kind)) continue;
    const key = r.standId || `${r.kind}@${Math.round(r.x)},${Math.round(r.z)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

const SKIP = new Set(['world-preview']);
const maps = MAPS.filter((m) => !SKIP.has(m.id) && (!ONLY || m.id === ONLY));
const summary = [];
for (const m of maps) {
  let ap;
  try {
    ap = loadMap(m.id);
  } catch (e) {
    console.log(`     ${m.id}: no airfield built (${e.message})`);
    continue;
  }
  const lay = LAY.airportLayout();
  if (!lay || !lay.taxiway) continue;
  const field = F.buildField();
  for (const id of BIG) {
    const type = TYPES.AIRCRAFT.find((t) => t.id === id);
    const perf = P.perfFor(type);
    const wheels = wheelsOf(type);
    const starts = offeredStarts(m.id, type);
    if (!starts.length) {
      summary.push(`${m.id}/${id}: runway only`);
      continue;
    }
    for (const st of starts) {
      const name = `${m.id}: ${type.name} at ${st.label}`;
      if (!field.ok) {
        ok(`${name}: the field has a taxi plan`, false, field.why || 'no field');
        continue;
      }
      // The traffic's slot for this stand (same layout), or a slot made at the start point.
      let slot = field.slots.find((s) => s.id === st.standId || (Math.hypot(s.x - st.x, s.z - st.z) < 3));
      // The open apron start is on the taxiway itself, facing along it: it taxis straight off (no pushback).
      if (!slot) slot = { id: st.standId || 'start', x: st.x, z: st.z, headingDeg: st.headingDeg, kind: st.kind === 'hangar' ? 'hangar' : 'stand', nose: st.kind === 'stand' ? 'in' : 'out', maxSpan: 999, maxLength: 999 };
      const things = parkedThings(ap, st.standId ? lay.stands.find((s) => s.id === st.standId) : null);
      const problems = [];
      let routes = 0;
      for (const cx of field.connectors) {
        let legs;
        try {
          legs = P.planTaxiOut(field, perf, slot, 1, cx);
          const dep = P.planDeparture(field, perf, 1, cx);
          if (dep && dep.legs) legs = legs.concat(dep.legs.filter((l) => l.kind !== 'takeoff' && l.path && l.path.ground && l.path.ground[0]));
        } catch (e) {
          problems.push(`via ${Math.round(cx)}: no route (${e.message})`);
          continue;
        }
        routes++;
        for (const l of legs) {
          const b = F.groundPathProblem(field, perf, l.path, slot, !!l.reverse);
          if (b) {
            problems.push(`via ${Math.round(cx)}: ${l.kind}: ${b}`);
            break;
          }
          const d = driveLeg(l, perf, type, lay, things, wheels);
          if (d) {
            problems.push(`via ${Math.round(cx)}: ${d}`);
            break;
          }
        }
      }
      ok(`${name}: every taxi route out (${routes}) keeps its wheels on paving and its wing clear`, routes > 0 && problems.length === 0, problems.slice(0, 3).join(' | '));
      summary.push(`${m.id}/${id}: ${st.label} ${problems.length ? 'PROBLEMS ' + problems.length : 'clear'}`);
    }
  }
}
/* ---- the fields themselves ---- */
{
  const facts = [];
  const offered = [];
  const inTurn = [];
  for (const m of maps) {
    try {
      loadMap(m.id);
    } catch (e) {
      continue;
    }
    const lay = LAY.airportLayout();
    if (!lay || !lay.taxiway) continue;
    const big = BIG.filter((id) => offeredStarts(m.id, TYPES.AIRCRAFT.find((t) => t.id === id)).length);
    if (!lay.codeF) {
      if (big.length) offered.push(`${m.id}: ${big.join(',')}`);
      continue;
    }
    const tw = lay.taxiway.rect;
    const width = Math.min(Math.abs(tw.z1 - tw.z0), Math.abs(tw.x1 - tw.x0));
    if (width < LAY.CODE_F.width - 0.01) facts.push(`${m.id}: taxiway ${width} m`);
    for (const c of lay.connectors) {
      const w = Math.min(c.rect.x1 - c.rect.x0, c.rect.z1 - c.rect.z0);
      if (!c.onRunway && w < LAY.CODE_F.width - 0.01) facts.push(`${m.id}: connector ${c.id} ${w} m`);
    }
    // Every building along the taxiway at least objectClear from its centreline.
    const F2 = lay.frame;
    const wOf = (z) => (z - F2.cz) * F2.side;
    for (const o of TR.OBSTACLES) {
      if (o.y0 > TR.AIRPORT.elev + 20) continue;
      const u0 = o.x0 - F2.cx;
      const u1 = o.x1 - F2.cx;
      if (u1 < lay.taxiway.u0 || u0 > lay.taxiway.u1) continue;
      const wa = wOf(o.z0);
      const wb = wOf(o.z1);
      const d = Math.min(Math.abs(wa - lay.taxiway.w), Math.abs(wb - lay.taxiway.w));
      const straddles = (wa - lay.taxiway.w) * (wb - lay.taxiway.w) < 0;
      if ((straddles || d < LAY.CODE_F.objectClear - 0.01) && Math.max(wa, wb) > 0) facts.push(`${m.id}: ${o.what || 'an obstacle'} ${straddles ? 0 : d.toFixed(0)} m from the taxiway's centreline`);
    }
    // Every runway entry keeps its red sign, every crossing at least one.
    for (const c of lay.connectors) if (!c.onRunway && !lay.signs.some((s) => s.kind === 'mandatory' && s.entry === c.id)) facts.push(`${m.id}: ${c.id} lost its runway sign`);
    for (const x of lay.crossings || []) if (x.holds.length && !lay.signs.some((s) => s.kind === 'mandatory' && s.hold === x.id)) facts.push(`${m.id}: the ${x.name} crossing lost its signs`);
    for (const s of lay.signs) if (s.inTurn) inTurn.push(`${m.id} ${s.text}`);
    if (!lay.pavement.some((p) => p.kind === 'turnpad')) facts.push(`${m.id}: no turn pads`);
  }
  ok('Code F fields: 44 m taxiways and connectors, every building 51 m from the centreline, turn pads, every runway sign kept', facts.length === 0, facts.slice(0, 6).join(' | '));
  ok('a field that is not Code F offers the big jets no gate, stand, hangar or apron start (the runway, with a word)', offered.length === 0, offered.join(' | '));
  ok('red signs left at a hold inside a junction\'s turn: at most two in the game, and named', inTurn.length <= 2, inTurn.join(', ') || 'none');
}

/* ---- the big-jet rule, and the taxi start ---- */
{
  const big = BIG.filter((id) => SP.isBigJet(id));
  ok('the big jets are the big jets (the B-1B, 42 m and 45 m, is not one)', ['a380', 'belugaxl', 'b747', 'c17', 'an225', 'c5'].filter((id) => BIG.includes(id)).every((id) => big.includes(id)) && !SP.isBigJet('a320') && !SP.isBigJet('skylark'), big.join(','));
  loadMap('kestrel');
  const a380 = TYPES.AIRCRAFT.find((t) => t.id === 'a380');
  const r = SP.resolveSpawn('kestrel', SP.spawnClassOf(a380), { type: a380, choice: 'gate' });
  ok('Kestrel (not Code F): the A380 asked for a gate is lined up on the runway, and the word says why', r.kind === 'runway' && r.fallback && /too big for .*taxiways/.test(SP.bigJetNote(a380, 'Kestrel Island')), `${r.kind} ${r.fallback}`);
  ok('Kestrel: the field does not take big jets; Gateway does', !SP.fieldTakesBigJets() && (loadMap('gateway'), SP.fieldTakesBigJets()));
  const { readFileSync } = await import('node:fs');
  const main = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  ok('the taxi start (a small field\'s route) is never a big jet\'s: a gate on a Code F field, else the runway with the word', /wantsTaxi && isBigJet\(this\.aircraftType\)/.test(main) && /startAt: opts\.startAt && opts\.startAt !== 'runway' \? opts\.startAt : 'gate'/.test(main) && /bigJetNote\(this\.aircraftType\)/.test(main));
  const fs = readFileSync(new URL('../../src/features/spawns.js', import.meta.url), 'utf8');
  ok('the spawner\'s runway word for a big jet names the reason', /isBigJet\(type\) && !fieldTakesBigJets\(\) \? bigJetNote\(type\)/.test(fs));
}

if (VERBOSE) console.log(summary.join('\n'));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
