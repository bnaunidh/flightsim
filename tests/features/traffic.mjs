/**
 * The traffic planner, on every map, with no page.
 *
 *   node tests/features/traffic.mjs            every map
 *   node tests/features/traffic.mjs kestrel    one map
 *
 * For every map the traffic runs on, every aeroplane type it would fly there,
 * both runway directions, every height it may be given, and every parking
 * slot the runtime would let that aeroplane use — tested the way the runtime
 * flies it, not the way it might have:
 *
 *   - the pushback and taxi-out, to EVERY connector the runtime may leave by,
 *     stay on the airfield with both wings and the nose clear of every
 *     building, and end at the holding point, short of the runway
 *   - the take-off lifts off with runway to spare, and the climb-out, the
 *     circuit, a tour of the islands, the holding orbit and a go-around all
 *     stay clear of the ground — on the arrival the runtime picks
 *     (planner.arrivalFor), at each of the six heights it hands out
 *   - the approach touches down ON the runway, past the threshold, comes down
 *     the glideslope without climbing, stops on the runway, and leaves it at
 *     an exit the aeroplane can taxi home from
 *   - the taxi-in, from EVERY exit the runtime may give it, ends on the slot
 *     facing the way the slot says — nose in, or pushed back into a nose-out
 *     hangar tail first — without a wing through anything, and no turn on
 *     the ground is tighter than 6 m
 *   - the climb-out climbs at the aeroplane's own gradient unless the ground
 *     asks for more, and the touchdown is in the first half of the runway
 *     unless the ground forces the aiming point further in
 *
 * A slot or a type the runtime refuses (a jumbo whose wings cannot clear the
 * hangars along a taxiway) is listed, not failed — but every flight map must
 * still get traffic. And on the maps it does not run on, that it says why.
 *
 * Then the extension itself, driven with a stand-in game (traffic.harness.mjs):
 * the long queue with the player sat at the start of runway 09, the player
 * parked on the taxiway, and an open sky — nobody inside anybody, nobody
 * through the player, no nose or wing touching another, nobody flying
 * through anybody, no wing through a building, no deadlock broken.
 *
 * Then the draw-call merge in traffic/lod.js, on a model whose answer is known.
 *
 * With the airport work's airportLayout()/parkingSlots() present the same
 * checks run against its stands and hangars; without them, against the stock
 * layout and the traffic's own slots.
 *
 * The obstacle boxes come from constructing the real Airport and Apron with a
 * stub scene, so "off the buildings" means the buildings airport.js actually
 * registers — including the second hangar, whose door is inside the terminal.
 */

global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};

const SRC = new URL('../../src/', import.meta.url).href;
const TR = await import(SRC + 'world/terrain.js');
const AP = await import(SRC + 'world/airport.js');
const APR = await import(SRC + 'world/apron.js');
const { MAPS } = await import(SRC + 'world/maps.js');
const F = await import(SRC + 'features/traffic/field.js');
const P = await import(SRC + 'features/traffic/planner.js');
const { rng, DEG, Draft } = await import(SRC + 'features/traffic/path.js');
const RU = await import(SRC + 'features/traffic/rules.js');

const only = process.argv[2] || null;
const checks = [];
let failed = 0;
function ok(name, pass, detail = '') {
  checks.push({ name, pass: !!pass, detail });
  if (!pass) {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
  return !!pass;
}

/** Maps the traffic must run on: every map offered for flying from a runway. */
const FLIGHT = new Set(MAPS.filter((m) => !m.game || m.game === 'flight').map((m) => m.id));

function loadMap(id) {
  TR.applyMap(id);
  AP.refreshRunways();
  APR.refreshApronElevation();
  TR.clearObstacles();
  TR.clearPlatforms();
  const scene = { add() {} };
  new AP.Airport(scene);
  new APR.Apron(scene, 'low');
}

/** Obstacle the point is inside (below its top), ignoring the slot's own building. */
function hitsBuilding(x, z, y, ownBox) {
  for (const o of TR.OBSTACLES) {
    if (o === ownBox) continue;
    if (x < o.x0 || x > o.x1 || z < o.z0 || z > o.z1) continue;
    if (y > o.y1) continue;
    return o;
  }
  return null;
}

/**
 * Walk a ground path: the whole wing and the fuselage clear of buildings,
 * wheels on the field.
 *
 * Written apart from the planner's own check (field.groundPathProblem) on
 * purpose, so the one does not mark its own homework: this walks the path a
 * metre at a time and the wing a metre at a time from tip to tip, where the
 * planner's first cut of this test looked only at the tips at every other
 * point drawn — which a two-metre hangar wall passes between.
 */
function checkGround(label, path, perf, field, ownBox, reverse = false) {
  let worst = null;
  let offField = null;
  const half = perf.span / 2;
  // Nose ahead and tail behind as drawn, where the roster's `plan` says
  // (perf.noseLen/tailLen); half the shape's length each way where not.
  // (The heading below is turned to the nose on a pushback.)
  const fore = perf.noseLen;
  const aft = perf.tailLen;
  const nose = Math.max(fore, aft);
  const wingY = field.elev + Math.max(1.5, -perf.gear.mainY + 0.6);
  // Only buildings anywhere near the path, and not the slot's own.
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < path.n; i++) {
    x0 = Math.min(x0, path.x[i]);
    x1 = Math.max(x1, path.x[i]);
    z0 = Math.min(z0, path.z[i]);
    z1 = Math.max(z1, path.z[i]);
  }
  const R = Math.max(half, nose) + 2;
  const own = ownBox ? (Array.isArray(ownBox) ? ownBox : [ownBox]) : [];
  const near = TR.OBSTACLES.filter((o) => !own.includes(o) && o.x1 > x0 - R && o.x0 < x1 + R && o.z1 > z0 - R && o.z0 < z1 + R && o.y0 <= wingY && o.y1 > field.elev + 0.3);
  // Those within reach of the point being walked, refilled for each point.
  const here = [];
  const hit = (px, pz) => here.find((o) => px > o.x0 && px < o.x1 && pz > o.z0 && pz < o.z1);
  for (let i = 0; i < path.n; i++) {
    const nx = i + 1 < path.n ? path.x[i + 1] : path.x[i];
    const nz = i + 1 < path.n ? path.z[i + 1] : path.z[i];
    here.length = 0;
    for (const o of near) {
      if (o.x1 > Math.min(path.x[i], nx) - R && o.x0 < Math.max(path.x[i], nx) + R && o.z1 > Math.min(path.z[i], nz) - R && o.z0 < Math.max(path.z[i], nz) + R) here.push(o);
    }
    // A metre at a time — for the wing tip, which on a turn moves further
    // than the middle does — with the heading turning between the points.
    const nh = i + 1 < path.n ? path.hdg[i + 1] : path.hdg[i];
    let dh = (nh - path.hdg[i]) % (2 * Math.PI);
    if (dh > Math.PI) dh -= 2 * Math.PI;
    if (dh < -Math.PI) dh += 2 * Math.PI;
    const steps = Math.max(1, Math.ceil(Math.hypot(nx - path.x[i], nz - path.z[i]) + Math.max(half, nose) * Math.abs(dh)));
    for (let k = 0; k < steps && here.length && !worst; k++) {
      const t = k / steps;
      const x = path.x[i] + (nx - path.x[i]) * t;
      const z = path.z[i] + (nz - path.z[i]) * t;
      const h = path.hdg[i] + dh * t + (reverse ? Math.PI : 0);
      const c = Math.cos(h);
      const s = Math.sin(h);
      // Right wing tip is at +(cos h, sin h); the nose at (sin h, -cos h).
      for (let w = -half; w <= half && !worst; w += 1) {
        const o = hit(x + c * w, z + s * w);
        if (o) worst = `${o.what} (wing, ${w.toFixed(0)} m out) at (${Math.round(x + c * w)}, ${Math.round(z + s * w)})`;
      }
      for (let a = -aft; a <= fore && !worst; a += 1) {
        const o = hit(x + s * a, z - c * a);
        if (o) worst = `${o.what} (fuselage) at (${Math.round(x + s * a)}, ${Math.round(z - c * a)})`;
      }
    }
    const g = TR.heightAt(path.x[i], path.z[i]);
    if (!TR.isPaved(path.x[i], path.z[i]) && Math.abs(g - field.elev) > 4.5 && !offField) {
      offField = `ground ${(g - field.elev).toFixed(1)} m off field level at (${Math.round(path.x[i])}, ${Math.round(path.z[i])})`;
    }
  }
  ok(`${label}: clear of the buildings`, !worst, worst || '');
  ok(`${label}: on the airfield`, !offField, offField || '');
}

/** The building a slot is inside — its hangar — as every box that contains its middle. */
function ownBoxFor(slot) {
  return TR.OBSTACLES.filter((o) => slot.x >= o.x0 && slot.x <= o.x1 && slot.z >= o.z0 && slot.z <= o.z1);
}

const t0 = Date.now();
let planned = 0;
const declined = [];
const usableOn = new Set();
/** map/type pairs with at least one slot the runtime lets that type use. */
const typesParked = new Set();
for (const map of MAPS) {
  if (only && map.id !== only) continue;
  loadMap(map.id);
  const field = F.buildField();
  if (!field.ok) {
    // Off the stock layout: must decline, and must say why.
    ok(`${map.id}: declines traffic with a reason`, !FLIGHT.has(map.id) && !!field.why, field.why || 'no reason given');
    continue;
  }
  console.log(`${map.id}: runway ${field.length} m, connectors ${field.connectors.join(', ')}, ${field.slots.length} slots (${field.slotSource})`);
  ok(`${map.id}: has somewhere to park`, field.slots.length > 0);
  // The second stock hangar's door is inside the terminal's service block:
  // offered as a slot, it must be refused, and say why.
  if (field.layout === 'stock') {
    const blocked = F.slotProblem(field, { id: 'hangar-east', kind: 'hangar', x: -100, z: -250, headingDeg: 0, maxSpan: 44 });
    ok(`${map.id}: the hangar behind the terminal is refused`, map.id === 'kestrel' ? /terminal/.test(blocked || '') : !!blocked, blocked || 'accepted');
  }
  // Nowhere the player is put to start a flight on the stand.
  const ps = F.playerStand();
  const onPlayer = field.slots.find((s) => Math.abs(s.x - ps.x) < s.maxSpan / 2 + 4 && Math.abs(s.z - ps.z) < s.maxSpan / 2 + 4);
  ok(`${map.id}: no slot on the player's own stand`, !onPlayer, onPlayer ? onPlayer.id : '');
  if (field.rejectedSlots.length) {
    /*
     * On a flight map every slot has to work, except the ones either side of
     * where you start a flight on the stand — the airport layout keeps its own
     * aeroplanes off those two for the same reason. Elsewhere the airfield may
     * sit in a hillside, and a refused slot is reported.
     */
    const bad = field.rejectedSlots.filter((r) => !/where you start/.test(r.why));
    if (FLIGHT.has(map.id) && bad.length) ok(`${map.id}: every slot usable`, false, JSON.stringify(bad));
    else declined.push(`${map.id}: slots refused ${JSON.stringify(field.rejectedSlots)}`);
  }
  const types = P.typesFor(field);
  ok(`${map.id}: has aeroplanes to fly`, types.length > 0, field.length);
  /*
   * Nose-out slots. The airport layout's hangars face out of their doors; on
   * the stock field there are none, so the push-in is exercised on the big
   * stand turned round, which is clear open apron either side.
   */
  let probeOut = [];
  if (!field.slots.some((s) => s.nose === 'out') && field.layout === 'stock') {
    const probe = { id: 'remote-1 (turned round)', kind: 'hangar', x: 59, z: -152, y: F.groundY(59, -152), headingDeg: 180, maxSpan: 68, maxLength: Infinity, nose: 'in' };
    const why = F.slotProblem(field, probe);
    if (ok(`${map.id}: a nose-out slot is accepted`, !why && probe.nose === 'out', why || probe.nose)) probeOut = [probe];
  }
  // Side-on is refused, and says so.
  const sideways = F.slotProblem(field, { id: 'x', kind: 'stand', x: (field.twX0 + field.twX1) / 2 + 40, z: field.Z(field.twW + 60), headingDeg: 90, maxSpan: 30 });
  ok(`${map.id}: a slot side-on to the taxiway is refused`, /side-on/.test(sideways || ''), sideways || 'accepted');
  for (const type of types) {
    const perf = P.perfFor(type);
    const tag = `${map.id}/${type.id}`;
    ok(`${tag}: sensible speeds`, perf.vr > 15 && perf.vr < 110 && perf.vapp > perf.vtd && perf.cruise > perf.vapp,
      `vr ${perf.vr.toFixed(1)} vapp ${perf.vapp.toFixed(1)} vtd ${perf.vtd.toFixed(1)} cruise ${perf.cruise.toFixed(1)}`);
    for (const dir of [1, -1]) {
      const rw = F.runwayFor(field, dir);
      const dtag = `${tag} rwy ${rw.name}`;
      // A runway end the planner says no to is not flown, so it is reported
      // rather than failed — as long as each map keeps at least one.
      const use = P.runwayUsable(field, perf, dir);
      if (!use.ok) {
        declined.push(`${dtag}: ${use.why}`);
        continue;
      }
      usableOn.add(map.id);

      /* ---- departure ---- */
      const dep = P.planDeparture(field, perf, dir);
      if (!ok(`${dtag}: gets off the ground with runway to spare`, dep.ok, dep.why || '')) continue;
      const lu = dep.legs[0].path;
      const tk = dep.legs[1].path;
      checkGround(`${dtag} lineup`, lu, perf, field, null);
      ok(`${dtag}: lines up on the centreline`, Math.abs(lu.z[lu.n - 1] - field.cz) < 0.5 && Math.abs(Math.sin(lu.hdg[lu.n - 1]) - dir) < 0.02,
        `ends at z ${lu.z[lu.n - 1].toFixed(1)}`);
      ok(`${dtag}: lineup ends on the runway`, TR.isOnRunway(lu.x[lu.n - 1], lu.z[lu.n - 1], 0));
      let bad = P.airClearance(tk, field, 40);
      ok(`${dtag}: climb-out clears the ground`, !bad, bad || '');
      // Wheels on the runway for the whole roll.
      let offRwy = null;
      for (let i = 0; i < tk.n; i++) {
        if (!tk.ground[i]) break;
        if (!TR.isOnRunway(tk.x[i], tk.z[i], 0)) offRwy = `(${Math.round(tk.x[i])}, ${Math.round(tk.z[i])})`;
      }
      ok(`${dtag}: take-off roll stays on the runway`, !offRwy, offRwy || '');
      /*
       * Climbs at its own gradient unless the ground ahead asks for more. The
       * first cut asked for 25 m over the runway itself 200 m after lift-off,
       * so everything went up at the cap — measured, a Skylark at 0.20.
       */
      {
        const sl = dep.legs[1].sLift;
        const ia = tk.indexAt(sl + 300);
        const ib = tk.indexAt(sl + 600);
        const grad = (tk.y[ib] - tk.y[ia]) / Math.max(1, tk.s[ib] - tk.s[ia]);
        const cap = perf.cat === 'military' ? 0.3 : 0.2;
        ok(`${dtag}: climb gradient between its own and the cap`, grad >= perf.gradClimb - 0.002 && grad <= cap + 0.002, grad.toFixed(3));
        // Atoll is the one map with nothing past either end higher than 7 m.
        if (map.id === 'atoll' && perf.cat === 'light') {
          ok(`${dtag}: over flat ground it climbs at its own gradient`, Math.abs(grad - perf.gradClimb) < 0.002, `${grad.toFixed(3)} for ${perf.gradClimb}`);
        }
      }

      /* ---- where it may park, and which ways in and out ---- */
      const usable = field.slots.filter((s) => P.slotUsable(field, perf, s, dir));
      for (const s of field.slots.filter((x) => P.fits(x, perf) && !usable.includes(x))) {
        const r = P.slotRoutes(field, perf, s);
        const outs = [...r.out.values()].filter(Boolean);
        const ins = [...r.in.values()].filter(Boolean);
        declined.push(`${dtag} slot ${s.id} refused: out ${outs.length}/${r.out.size} blocked (${outs[0] || '-'}), in ${ins.length}/${r.in.size} blocked (${ins[0] || '-'})`);
      }
      if (usable.length) typesParked.add(`${map.id}/${type.id}`);
      // Every connector any slot may leave by: its line-up and take-off.
      const conns = new Set();
      for (const s of usable) for (const cx of P.departureConnectors(field, perf, s, dir)) conns.add(cx);
      // Where each of those take-offs ends: the runtime plans the route from
      // there (planAfter), not from the usual connector's climb-out.
      const connEnds = [];
      for (const cx of conns) {
        if (cx === rw.depConnector) continue;
        const d2 = P.planDeparture(field, perf, dir, cx);
        ok(`${dtag} from connector ${cx}: gets off the ground with runway to spare`, d2.ok, d2.why || '');
        checkGround(`${dtag} from connector ${cx} lineup`, d2.legs[0].path, perf, field, null);
        const b2 = P.airClearance(d2.legs[1].path, field, 40);
        ok(`${dtag} from connector ${cx}: climb-out clears the ground`, !b2, b2 || '');
        if (d2.ok) connEnds.push([cx, d2.end]);
      }

      /* ---- the air, and back ---- */
      for (let layerIx = 0; layerIx < 6; layerIx++) {
        const layer = perf.layerAGL + perf.layerStep * layerIx;
        // What the runtime flies for the craft given this height and side.
        const geo = P.arrivalFor(field, perf, dir, layer, layerIx % 2 ? -1 : 1);
        const atag = `${dtag} layer ${layer}`;
        ok(`${atag}: the arrival it is given was checked`, geo.checked, `short by ${Math.round(geo.shortBy || 0)} m`);
        const start = dep.end;
        const circuit = P.planRoute(field, perf, start, geo, 'circuit');
        ok(`${atag}: circuit clears the ground`, circuit.ok, circuit.why || '');
        const tour = P.planRoute(field, perf, start, geo, 'tour', rng(7 + layerIx));
        ok(`${atag}: tour (${tour.name}) clears the ground`, tour.ok, tour.why || '');
        for (const [cx, end] of connEnds) {
          const c2 = P.planRoute(field, perf, end, geo, 'circuit');
          ok(`${atag}: circuit after leaving by connector ${cx} clears the ground`, c2.ok, c2.why || '');
          const t2 = P.planRoute(field, perf, end, geo, 'tour', rng(11 + layerIx));
          ok(`${atag}: tour after leaving by connector ${cx} clears the ground`, t2.ok, t2.why || '');
        }
        const route = circuit.legs[0].path;
        ok(`${atag}: route ends at the gate`,
          Math.hypot(route.x[route.n - 1] - geo.gate.x, route.z[route.n - 1] - geo.gate.z) < 1 &&
          Math.abs(route.y[route.n - 1] - geo.yGate) < 1);
        const orbit = P.planOrbit(field, perf, geo).path;
        bad = P.airClearance(orbit, field, 60);
        ok(`${atag}: holding orbit clears the ground`, !bad, bad || '');

        const app = P.planApproach(field, perf, geo, rw.depConnector);
        if (!ok(`${atag}: approach plans`, app.ok, app.why || '')) continue;
        const ap = app.legs[0].path;
        const iTD = ap.indexAt(app.sTD);
        const xTD = ap.x[iTD];
        const zTD = ap.z[iTD];
        ok(`${atag}: touches down on the runway`, TR.isOnRunway(xTD, zTD, 0) && (xTD - rw.approachEnd) * dir > 150,
          `at x ${xTD.toFixed(0)} (threshold ${rw.approachEnd})`);
        // In the first half: the first cut put every light aeroplane on Kestrel
        // down at x = 19, the middle, to save one degree of glideslope.
        {
          const gs = P.glidePath(field, perf, dir);
          const forced = gs.need200 > gs.comfy;
          ok(`${atag}: touches down in the first half of the runway, unless the ground forces it further in`,
            (xTD - rw.approachEnd) * dir < field.length / 2 || forced,
            `${Math.round((xTD - rw.approachEnd) * dir)} m in; ${(Math.atan(gs.need200) / DEG).toFixed(1)} deg at the usual point`);
        }
        ok(`${atag}: wheels meet the runway at touchdown`, Math.abs(ap.y[iTD] - F.groundY(xTD, zTD)) < 0.2,
          `${(ap.y[iTD] - F.groundY(xTD, zTD)).toFixed(2)} m`);
        // Never climbs on the approach, and never below the runway before it.
        // Clearance is asked for in proportion to height, up to 12 m: the
        // planner steepens the glideslope until it has 15 m plus 1% of the
        // distance over the centreline at 50 m spacing, and this samples
        // every point, off the centreline too, on the turn on to final.
        let climbs = null;
        let under = null;
        for (let i = 1; i <= iTD; i++) {
          if (ap.y[i] > ap.y[i - 1] + 0.01 && !climbs) climbs = `at s ${ap.s[i].toFixed(0)}`;
          const g = Math.max(TR.heightAt(ap.x[i], ap.z[i]), 0);
          const nearRwy = TR.isOnRunway(ap.x[i], ap.z[i], 30);
          const need = nearRwy ? 0 : Math.min(12, 0.4 * (ap.y[i] - field.elev));
          if (ap.y[i] < g + need && !under) under = `${(ap.y[i] - g).toFixed(1)} m above ground at (${Math.round(ap.x[i])}, ${Math.round(ap.z[i])})`;
        }
        ok(`${atag}: descends all the way down`, !climbs, climbs || '');
        ok(`${atag}: approach clears the ground`, !under, under || '');
        ok(`${atag}: arrives at touchdown speed`, ap.vmax[iTD] > perf.vtd * 0.85 && ap.vmax[iTD] < perf.vapp * 1.05,
          `${ap.vmax[iTD].toFixed(1)} m/s (vtd ${perf.vtd.toFixed(1)})`);
        // Roll-out: on the runway until the exit turn, and off it at the end.
        let rollOff = null;
        let lastOn = iTD;
        for (let i = iTD; i < ap.n; i++) {
          if (TR.isOnRunway(ap.x[i], ap.z[i], 0)) lastOn = i;
          else if (!rollOff && i < lastOn) rollOff = `(${Math.round(ap.x[i])}, ${Math.round(ap.z[i])})`;
        }
        // ...to that exit's holding point, off every runway: on the taxiway,
        // clear of 18/36, for the connector that is 18/36 (field.holdPoint).
        const eh = F.holdPoint(field, app.exit, perf);
        ok(`${atag}: leaves the runway at exit ${app.exit}, to its holding point`,
          !TR.isOnRunway(ap.x[ap.n - 1], ap.z[ap.n - 1], 2) && !TR.isOnRunway2(ap.x[ap.n - 1], ap.z[ap.n - 1], perf.span / 2 + 5) &&
            Math.hypot(ap.x[ap.n - 1] - eh.x, ap.z[ap.n - 1] - eh.z) < 0.5,
          `ends at (${ap.x[ap.n - 1].toFixed(1)}, ${ap.z[ap.n - 1].toFixed(1)}), hold (${eh.x.toFixed(1)}, ${eh.z.toFixed(1)})`);
        // R1: the only stop is at the end — never on either runway on the way.
        {
          let stopOn = null;
          for (let i = iTD; i < ap.n - 1; i++) {
            if (ap.vmax[i] < 0.3 && (TR.isOnRunway(ap.x[i], ap.z[i], perf.span / 2) || TR.isOnRunway2(ap.x[i], ap.z[i], perf.span / 2))) stopOn = `(${Math.round(ap.x[i])}, ${Math.round(ap.z[i])})`;
          }
          ok(`${atag}: never stops on a runway on the way off`, !stopOn, stopOn || '');
        }
        checkGround(`${atag} roll-out`, sliceGround(ap, iTD), perf, field, null);
        const ga = P.planGoAround(field, perf, geo, {
          x: ap.x[Math.max(0, iTD - 40)], z: ap.z[Math.max(0, iTD - 40)], y: ap.y[Math.max(0, iTD - 40)],
          hdg: ap.hdg[Math.max(0, iTD - 40)], v: perf.vapp,
        }).path;
        bad = P.airClearance(ga, field, 40);
        ok(`${atag}: go-around clears the ground`, !bad, bad || '');
        // And the one that turns away from you first, both ways round.
        for (const away of [1, -1]) {
          const gat = P.planGoAround(field, perf, geo, {
            x: ap.x[Math.max(0, iTD - 40)], z: ap.z[Math.max(0, iTD - 40)], y: ap.y[Math.max(0, iTD - 40)],
            hdg: ap.hdg[Math.max(0, iTD - 40)], v: perf.vapp,
          }, away).path;
          bad = P.airClearance(gat, field, 40);
          ok(`${atag}: go-around turning ${away > 0 ? 'right' : 'left'} for you clears the ground`, !bad, bad || '');
        }
        /*
         * And from wherever on the approach the runtime may send it round:
         * for you in the air ahead, from 3.5 km out; for you on the runway,
         * from 2.5 km; for another aeroplane on the runway, at the lock
         * point — all the way in to 30 m short of touchdown. The checks
         * above only went round from one point, 40 samples short.
         */
        {
          let worstGa = null;
          const sFrom = Math.max(0, app.sTD - 3500);
          for (let s = sFrom; s <= app.sTD - 30 && !worstGa; s += 400) {
            const i = ap.indexAt(s);
            for (const away of [0, 1, -1]) {
              const g2 = P.planGoAround(field, perf, geo, { x: ap.x[i], z: ap.z[i], y: ap.y[i], hdg: ap.hdg[i], v: Math.max(ap.vmax[i], perf.vapp) }, away).path;
              const b3 = P.airClearance(g2, field, 40);
              if (b3) {
                worstGa = `from ${Math.round(app.sTD - s)} m out, turning ${away}: ${b3}`;
                break;
              }
            }
          }
          ok(`${atag}: a go-around from anywhere on final clears the ground`, !worstGa, worstGa || '');
        }
        planned++;

        /* ---- parking ---- */
        if (layerIx) continue;
        for (const slot of usable.concat(probeOut.filter((s) => P.slotUsable(field, perf, s, dir)))) {
          checkParking(`${dtag} slot ${slot.id}`, field, perf, slot, dir, geo);
        }
      }
    }
  }
}

/**
 * Leave a slot for the hold and come back into it: every leg on the airfield
 * with its wings off the buildings, the pushback (if there is one) starting
 * on the slot, the taxi-out stopping at the hold, and the last leg in —
 * forwards for a nose-in slot, pushed back tail first for a nose-out one —
 * ending on the slot with the nose the way the slot says.
 *
 * Out to EVERY connector the runtime may leave this slot by, and back from
 * EVERY exit it may be given — and the approach, planned with the runtime's
 * own rule, must turn off at one of those.
 */
function checkParking(stag, field, perf, slot, dir, geo) {
  const own = ownBoxFor(slot);
  const conns = P.departureConnectors(field, perf, slot, dir);
  const exits = P.arrivalExits(field, perf, slot);
  ok(`${stag}: has a way out and a way back`, conns.length > 0 && exits.length > 0, `out ${conns.join(',')} in ${exits.join(',')}`);
  for (const cx of conns) {
    const ctag = `${stag} out by ${cx}`;
    const out = P.planTaxiOut(field, perf, slot, dir, cx);
    const pb = out.find((l) => l.kind === 'pushback');
    const to = out.find((l) => l.kind === 'taxi-out');
    ok(`${ctag}: leaves the way it is parked`, slot.nose === 'out' ? !pb && out.length === 1 : !!pb && out.length === 2, out.map((l) => l.kind).join(','));
    if (pb) {
      checkGround(`${ctag} pushback`, pb.path, perf, field, own, true);
      ok(`${ctag}: pushback starts on the slot`, Math.hypot(pb.path.x[0] - slot.x, pb.path.z[0] - slot.z) < 0.5);
    } else {
      ok(`${ctag}: taxi-out starts on the slot`, Math.hypot(to.path.x[0] - slot.x, to.path.z[0] - slot.z) < 0.5);
    }
    checkGround(`${ctag} taxi-out`, to.path, perf, field, own);
    const tp = to.path;
    // At the connector's holding point, off every runway (R1): short of
    // 09/27, and for the connector that IS 18/36, on the taxiway short of it.
    const hp = F.holdPoint(field, cx, perf);
    const xe = tp.x[tp.n - 1];
    const ze = tp.z[tp.n - 1];
    ok(`${ctag}: taxi-out stops at its holding point, off every runway`,
      Math.hypot(xe - hp.x, ze - hp.z) < 0.5 && !TR.isOnRunway(xe, ze, 20) && !TR.isOnRunway2(xe, ze, perf.span / 2 + 5) && tp.vmax[tp.n - 1] < 0.01,
      `ends at (${xe.toFixed(1)}, ${ze.toFixed(1)})`);
    // ...and nothing on the way there goes on to a runway at all.
    {
      let on = null;
      for (let i = 0; i < tp.n && !on; i++) if (TR.isOnRunway(tp.x[i], tp.z[i], 0) || TR.isOnRunway2(tp.x[i], tp.z[i], perf.span / 2)) on = `(${Math.round(tp.x[i])}, ${Math.round(tp.z[i])})`;
      ok(`${ctag}: taxi-out stays off the runways`, !on, on || '');
    }
    // The way on from there is one leg, and it does not stop on 18/36 (R2).
    {
      const lu = P.planDeparture(field, perf, dir, cx).legs[0].path;
      let stop = null;
      for (let i = 0; i < lu.n - 1; i++) if (lu.vmax[i] < 0.3 && i > 0 && TR.isOnRunway2(lu.x[i], lu.z[i], perf.span / 2)) stop = `(${Math.round(lu.x[i])}, ${Math.round(lu.z[i])})`;
      ok(`${ctag}: lines up from its holding point without stopping on 18/36`, Math.hypot(lu.x[0] - hp.x, lu.z[0] - hp.z) < 0.5 && !stop, stop || `starts at (${lu.x[0].toFixed(1)}, ${lu.z[0].toFixed(1)})`);
    }
    checkTurns(ctag, out);
  }
  // The approach the runtime would plan for it, turning off where it may.
  const app = P.planApproach(field, perf, geo, { allow: (x) => exits.includes(x) });
  if (ok(`${stag}: an approach turns off where it can taxi home from`, app.ok && exits.includes(app.exit), app.why || `exit ${app.exit}`)) {
    const ap = app.legs[0].path;
    checkGround(`${stag} roll-out to ${app.exit}`, sliceGround(ap, ap.indexAt(app.sTD)), perf, field, null);
  }
  for (const ex of exits) {
    const etag = `${stag} in from ${ex}`;
    const back = P.planTaxiIn(field, perf, ex, slot);
    ok(`${etag}: comes back the way it parks`, slot.nose === 'out' ? back.length === 2 && back[1].kind === 'push-in' && back[1].reverse : back.length === 1,
      back.map((l) => l.kind).join(','));
    for (const l of back) checkGround(`${etag} ${l.kind}`, l.path, perf, field, own, !!l.reverse);
    const last = back[back.length - 1];
    const lp = last.path;
    const endErr = Math.hypot(lp.x[lp.n - 1] - slot.x, lp.z[lp.n - 1] - slot.z);
    const nose = lp.hdg[lp.n - 1] + (last.reverse ? Math.PI : 0);
    const noseErr = Math.abs(Math.sin((nose - (slot.headingDeg * Math.PI) / 180) / 2));
    ok(`${etag}: parks on the slot, nose ${slot.nose}`, endErr < 0.5 && noseErr < 0.02 && lp.vmax[lp.n - 1] < 0.01,
      `${endErr.toFixed(2)} m, nose ${((nose * 180) / Math.PI).toFixed(1)} for ${slot.headingDeg}`);
    checkTurns(etag, back);
  }
  planned++;
}

/** Nothing in any leg turns tighter than a tug or a nosewheel can. */
function checkTurns(tag, legs) {
  let tight = null;
  for (const l of legs) {
    const q = l.path;
    for (let i = 1; i < q.n - 1; i++) if (Math.abs(q.kappa[i]) > 1 / 6 && !tight) tight = `${l.kind} at (${Math.round(q.x[i])}, ${Math.round(q.z[i])}) radius ${(1 / Math.abs(q.kappa[i])).toFixed(1)} m`;
  }
  ok(`${tag}: no turn tighter than 6 m`, !tight, tight || '');
}

/** The ground part of a path from index i0, as a path-like view for checkGround. */
function sliceGround(p, i0) {
  const n = p.n - i0;
  return {
    n,
    x: p.x.subarray(i0),
    z: p.z.subarray(i0),
    hdg: p.hdg.subarray(i0),
  };
}

// Every flight map must actually get traffic, on at least one runway end.
for (const id of FLIGHT) {
  if (only && id !== only) continue;
  loadMap(id);
  const f = F.buildField();
  ok(`${id}: flight map runs traffic`, f.ok && usableOn.has(id), f.why || 'no aeroplane can use either end');
  const parks = [...typesParked].filter((k) => k.startsWith(`${id}/`)).map((k) => k.split('/')[1]);
  ok(`${id}: some aeroplane has somewhere to park`, parks.length > 0, parks.join(' '));
  console.log(`${id}: traffic types that can park: ${parks.join(', ') || 'none'}`);
}

/* ------------------------------------------------------------------ */
/* The extension itself: queues, the player in the way                 */
/* ------------------------------------------------------------------ */

/*
 * The review measured this with a harness like this one: the player sat at
 * the start of runway 09 for four minutes, and in 4 of 6 runs two traffic
 * aeroplanes ended up inside each other at the holding point; with the
 * player parked on the parallel taxiway, one queued behind drove through
 * the player's aeroplane. The browser check only held the player on the
 * runway for 200 s, too short to see it. These run the real hooks for
 * minutes at a time, seeded, so a failure repeats.
 */
if (!only || only === 'kestrel') {
  const H = await import('./traffic.harness.mjs');
  /*
   * `quality` is the apron's: 'low' leaves every stand free; 'high', the
   * game's default, has the airport's own parked aeroplanes on six of them.
   * `drive(sim, f)` returns an each(t, dt) that moves the player every frame.
   */
  const scenario = (name, seeds, minutes, place, expect, { quality = 'low', drive = null, wind = undefined } = {}) => {
    for (const seed of seeds) {
      H.loadMap('kestrel', quality);
      const sim = H.makeSim({ typeId: 'skylark', quality, wind });
      const f = F.buildField();
      place(sim, f);
      const r = H.startFlight(sim, { trafficSeed: seed });
      if (!ok(`queue ${name} seed ${seed}: the flight starts`, r.ok, r.ok ? '' : String(r.err))) continue;
      const W = H.makeWatch(sim);
      H.run(sim, W, minutes * 60, 0.1, drive ? drive(sim, f) : null);
      const s = H.summary(W);
      const tag = `queue ${name} seed ${seed} (${minutes} min${quality !== 'low' ? `, apron at ${quality}` : ''})`;
      ok(`${tag}: no hook threw`, !s.threw, s.threw || '');
      ok(`${tag}: no two aeroplanes inside each other`, s.merged === 0, s.mergedFirst || `closest ${s.minPairOnGround} m`);
      ok(`${tag}: nobody through the player`, s.throughPlayer === 0, s.playerFirst || `closest ${s.minToPlayerOnGround} m`);
      ok(`${tag}: no nose, tail or wing within a metre of another's, or of yours`, s.touching === 0 && s.touchingPlayer === 0, s.touchFirst || s.touchPlayerFirst || '');
      ok(`${tag}: nobody flies through anybody`, s.airHit === 0, s.airHitFirst || '');
      ok(`${tag}: no wing through a building`, s.tips === 0, s.tipsFirst || '');
      ok(`${tag}: no deadlock had to be broken`, s.deadlocks === 0, `${s.deadlocks}`);
      ok(`${tag}: nothing below the ground or lost`, s.under === 0 && s.nan === 0, `${s.under} under (${s.underFirst || '-'}), ${s.nan} NaN`);
      ok(`${tag}: nobody jumps further in a frame than it can fly`, s.jumps === 0, `${s.jumps}: ${s.jumpFirst || ''}`);
      if (expect) expect(tag, s);
    }
  };
  // Sat at the start of runway 09, where Free Flight starts you.
  scenario('player on the runway', [1, 2, 3, 4, 5, 6], 5, (sim, f) => H.placePlayer(sim, f.west + 80, f.cz, { headingDeg: 90 }), null);
  // The same with the apron as the game draws it by default.
  scenario('player on the runway', [7, 8, 9], 5, (sim, f) => H.placePlayer(sim, f.west + 80, f.cz, { headingDeg: 90 }), null, { quality: 'high' });
  // Parked on the parallel taxiway, on the way to the far end.
  const onTaxiway = (tag, s) => {
    ok(`${tag}: the traffic still gets away, by another connector`, s.departures >= 1, `${s.departures} departures, ${s.parked} parked`);
  };
  scenario('player parked on the taxiway', [1, 2], 12, (sim, f) => H.placePlayer(sim, f.twX0 + 50, f.twZ, { headingDeg: 270 }), onTaxiway);
  scenario('player parked on the taxiway', [3], 12, (sim, f) => H.placePlayer(sim, f.twX0 + 50, f.twZ, { headingDeg: 270 }), onTaxiway, { quality: 'high' });
  /*
   * Chased: flying straight at one from behind at a quarter as fast again.
   * The review found one that had stepped aside jump up to 1.3 km in the
   * frame it went around, and the soak then found one chased on to final
   * still 450 m off to the side jump that far at touchdown.
   */
  scenario('player chasing them', [1, 2], 20, (sim, f) => H.placePlayer(sim, f.cx, f.cz - 20000, { headingDeg: 90, agl: 2000, speed: 60 }), null, { drive: (sim) => H.chaser(sim, 1.25) });
  /*
   * ...and as a step aside ends, the nose comes back round to the path, not
   * in one frame. The drift back used to be SET: one that turned on to final
   * in the middle of a step aside swung its nose 30-51 degrees in a frame
   * (the review), 37 degrees here. At 30 fps, the way the game draws it.
   */
  {
    H.loadMap('kestrel');
    const sim = H.makeSim({ typeId: 'skylark' });
    const f = F.buildField();
    H.placePlayer(sim, f.cx, f.cz - 20000, { headingDeg: 90, agl: 2000, speed: 60 });
    H.startFlight(sim, { trafficSeed: 102 });
    const chase = H.chaser(sim, 1.25);
    const last = new Map();
    let worst = 0;
    let what = '';
    H.run(sim, H.makeWatch(sim), 20 * 60, 1 / 30, (t, dt) => {
      chase(t, dt);
      for (const c of H.TF.trafficState().craft) {
        const lp = last.get(c.id);
        if (lp && !c.onGround && !lp.onGround) {
          const d = Math.abs(((((c.hdgDeg - lp.hdg + 180) % 360) + 360) % 360) - 180);
          if (d > worst) {
            worst = d;
            what = `${c.callsign} ${lp.phase} -> ${c.phase}, ${Math.round(Math.hypot(...c.off))} m aside, t ${Math.round(t)} s`;
          }
        }
        last.set(c.id, { hdg: c.hdgDeg, onGround: c.onGround, phase: c.phase });
      }
    });
    ok('queue player chasing them at 30 fps (20 min): no nose swings 15 degrees in a frame', worst < 15, `${worst.toFixed(1)} degrees: ${what}`);
    H.call('stop', sim, 'menu');
  }
  /*
   * On the crosswind runway, which crosses 09/27 on Kestrel and which the
   * traffic uses as a way on and off it. The first cut never looked: a
   * child rolling down 18/36 met traffic crossing it and traffic taking off
   * through the intersection.
   */
  if (TR.AIRPORT.runway2) {
    const r2 = TR.AIRPORT.runway2;
    const hd = ((r2.headingDeg ?? 180) * Math.PI) / 180;
    const ux = Math.sin(hd);
    const uz = -Math.cos(hd);
    for (const seed of [1, 2]) {
      H.loadMap('kestrel');
      const sim = H.makeSim({ typeId: 'skylark' });
      const f = F.buildField();
      // Using it: taxiing up and down the northern half of it at 5 m/s, all
      // five minutes (a child lining up, rolling, turning round).
      let a = -r2.length * 0.4;
      let way = 1;
      const at = () => H.placePlayer(sim, r2.cx + ux * a, r2.cz + uz * a, { headingDeg: (r2.headingDeg ?? 180) + (way > 0 ? 0 : 180), speed: 5 });
      at();
      H.startFlight(sim, { trafficSeed: seed });
      const W = H.makeWatch(sim);
      let onIt = 0;
      let onWhere = '';
      let rolled = 0;
      const wasOn = new Map();
      H.run(sim, W, 300, 0.1, (t, dt) => {
        a += way * 5 * dt;
        if (a > -60 || a < -r2.length * 0.45) way = -way;
        at();
        for (const c of H.TF.trafficState().craft) {
          if (!c.onGround) continue;
          const on = TR.isOnRunway2(c.pos[0], c.pos[2], c.span / 2);
          // On to it while you are there (not already on it when you arrived).
          if (on && wasOn.get(c.id) === false) {
            onIt += 0.1;
            if (!onWhere) onWhere = `${c.callsign} ${c.phase} at (${Math.round(c.pos[0])}, ${Math.round(c.pos[2])})`;
          }
          if (!wasOn.has(c.id) || !on) wasOn.set(c.id, on);
          if (c.phase === 'takeoff' && c.v > 10) rolled++;
        }
      });
      const s = H.summary(W);
      const tag = `queue player taxiing on runway 18/36 seed ${seed} (5 min)`;
      ok(`${tag}: the traffic knows`, H.TF.trafficState().player.runway2 && (!f.r2Crosses || H.TF.trafficState().player.usingRunway), JSON.stringify(H.TF.trafficState().player));
      ok(`${tag}: nobody taxis on to it`, onIt === 0, onWhere);
      if (f.r2Crosses) ok(`${tag}: nobody takes off across it`, rolled === 0, `${rolled} frames rolling`);
      ok(`${tag}: no two aeroplanes inside each other, nobody through you`, s.merged === 0 && s.throughPlayer === 0, s.mergedFirst || s.playerFirst || '');
    }
    /*
     * PARKED on it — where the parallel taxiway crosses it, and half-way up
     * it — for ten minutes. The review: every departure held and every
     * arrival circled the whole time, 8 runs of 8; a child parked there saw
     * nothing happen. Now, after half a minute stopped, the traffic takes
     * off and lands on 09/27 past you, and still goes round where you sit.
     */
    const spots = [
      ['where the taxiway crosses it', (sim, f) => H.placePlayer(sim, r2.cx, f.twZ, { headingDeg: 180 })],
      ['half-way up it', (sim) => H.placePlayer(sim, r2.cx + ux * -r2.length * 0.3, r2.cz + uz * -r2.length * 0.3, { headingDeg: 180 })],
    ];
    for (const [where, place] of spots) {
      scenario(`player parked on runway 18/36 ${where}`, [1, 2], 10, place, (tag, s) => {
        const st = H.TF.trafficState();
        ok(`${tag}: the traffic knows you are parked there`, st.player.runway2 && st.player.runway2Parked && !st.player.usingRunway, JSON.stringify(st.player));
        ok(`${tag}: take-offs and landings go on past you`, s.departures >= 1 && s.landed >= 1, `${s.departures} departures, ${s.landed} landings`);
      });
    }
    /*
     * Parked at one end of 18/36 for four minutes, then taking off along it.
     * The repair above first let the traffic back on to 18/36 while you sat
     * there: runway 27 departures taxied up the connector that IS 18/36 and
     * held on it at (250, -47), and when you rolled they were held there, in
     * front of you, for your using it (the review: rolled through one in 2-3
     * runs of 6). Nobody may be on 18/36 while you sit there, bar where it
     * crosses 09/27, nor on it ahead of you while you roll.
     */
    const PARK = 240;
    for (const [end, a0, hdg, seeds, wind] of [
      ['north', -r2.length / 2 + 40, r2.headingDeg ?? 180, [2, 3], [270, 12]],
      ['south', r2.length / 2 - 40, (r2.headingDeg ?? 180) + 180, [4], [270, 12]],
      ['north', -r2.length / 2 + 40, r2.headingDeg ?? 180, [2], [90, 3]],
    ]) {
      const seen = { parked: 0, parkedWhat: '', ahead: 0, aheadWhat: '' };
      const way = a0 < 0 ? 1 : -1;
      const drive = (sim) => {
        seen.parked = seen.ahead = 0;
        seen.parkedWhat = seen.aheadWhat = '';
        let s = 0;
        let v = 0;
        let agl = 0;
        return (t, dt) => {
          const rolling = t >= PARK;
          if (rolling) {
            // A standing start at a metre a second a second (a heavy one, or
            // a child easing the throttle open), off at 33 m/s.
            v = Math.min(v + dt, 40);
            s += v * dt;
            if (v > 33 || agl > 0) agl += 3.5 * dt;
            const a = a0 + way * s;
            H.placePlayer(sim, r2.cx + ux * a, r2.cz + uz * a, { headingDeg: hdg, agl, speed: v });
          }
          const p = sim.aircraft.pos;
          for (const c of H.TF.trafficState().craft) {
            if (!c.onGround || !TR.isOnRunway2(c.pos[0], c.pos[2], c.span / 2)) continue;
            const where = `${c.callsign} ${c.phase} at (${Math.round(c.pos[0])}, ${Math.round(c.pos[2])}), t ${Math.round(t)} s`;
            if (!rolling) {
              if (TR.isOnRunway(c.pos[0], c.pos[2], c.span / 2)) continue;
              seen.parked += dt;
              seen.parkedWhat = seen.parkedWhat || where;
            } else if (agl <= 0 && ((c.pos[0] - p.x) * ux + (c.pos[2] - p.z) * uz) * way > -10) {
              seen.ahead += dt;
              seen.aheadWhat = seen.aheadWhat || where;
            }
          }
        };
      };
      const place = (sim) => H.placePlayer(sim, r2.cx + ux * a0, r2.cz + uz * a0, { headingDeg: hdg });
      scenario(`player parked at the ${end} end of 18/36, traffic on ${wind[0] === 270 ? '27' : '09'}, then rolling`, seeds, (PARK + 60) / 60, place, (tag) => {
        ok(`${tag}: nobody on 18/36 while you sit there`, seen.parked === 0, `${seen.parked.toFixed(1)} s: ${seen.parkedWhat}`);
        ok(`${tag}: nobody on 18/36 ahead of you while you roll`, seen.ahead === 0, `${seen.ahead.toFixed(1)} s: ${seen.aheadWhat}`);
      }, { quality: 'high', wind, drive });
    }
    /*
     * The other way round: one is on its way out by that connector when you
     * turn up at the end of 18/36 and stop. Nobody waits ON 18/36 for the
     * runway any more — a departure by it holds short of it, on the taxiway,
     * and crosses on to it only with the runway its own (crossClear) — so:
     * one waiting short of it stays there, off 18/36, while you are on it;
     * one already crossing on to it goes on, lines up on 09/27 and rolls
     * away from the crossing, off 18/36 in 25 s, before you count as parked.
     * Before (the review): they held at (250, -47) for as long as 09/27 was
     * busy, and you rolled through them.
     */
    const alongR2 = (x, f) => x != null && TR.isOnRunway2(x, f.holdZ, 0);
    const onR2 = (c) => c.onGround && TR.isOnRunway2(c.pos[0], c.pos[2], c.span / 2) && !TR.isOnRunway(c.pos[0], c.pos[2], c.span / 2);
    for (const seed of [2, 4]) {
      for (const which of ['waiting short of it', 'crossing on to it']) {
        H.loadMap('kestrel', 'high');
        const sim = H.makeSim({ typeId: 'skylark', quality: 'high', wind: [270, 12] });
        const f = F.buildField();
        H.placePlayer(sim, f.cx, f.cz - 20000, { headingDeg: 90, agl: 2000, speed: 60 });
        H.startFlight(sim, { trafficSeed: seed });
        const want = which === 'waiting short of it'
          ? (c) => c.state === 'waiting' && alongR2(c.depConn, f)
          : (c) => alongR2(c.depConn, f) && onR2(c) && (c.phase === 'taxi-out' || c.phase === 'holding' || c.phase === 'lineup');
        let holder = null;
        for (let i = 0; i < 6000 && !holder; i++) {
          H.call('update', sim, 0.1);
          holder = H.TF.trafficState().craft.find(want) || null;
        }
        const tag = `queue one ${which} (18/36) when you stop at the end of it, seed ${seed}`;
        if (!ok(`${tag}: found one`, holder, 'nobody there in 10 min')) continue;
        H.placePlayer(sim, r2.cx + ux * (-r2.length / 2 + 40), r2.cz + uz * (-r2.length / 2 + 40), { headingDeg: r2.headingDeg ?? 180 });
        const W = H.makeWatch(sim);
        let onIt = 0;
        H.run(sim, W, 25, 0.1, () => {
          const c = H.TF.trafficState().craft.find((o) => o.id === holder.id);
          if (c && onR2(c)) onIt += 0.1;
        });
        const st = H.TF.trafficState();
        const now = st.craft.find((c) => c.id === holder.id);
        const at = now ? `${now.phase} at (${Math.round(now.pos[0])}, ${Math.round(now.pos[2])}); ${JSON.stringify(st.player)}` : 'gone';
        if (which === 'waiting short of it') ok(`${tag}: it holds off 18/36 while you are there`, onR2(holder) === false && onIt === 0, `${onIt.toFixed(1)} s on it; ${at}`);
        else ok(`${tag}: it is off 18/36 in 25 s, before you count as parked`, !st.player.runway2Parked && now && !onR2(now) && now.phase !== 'holding', at);
        ok(`${tag}: nobody through you`, W.player === 0, W.playerFirst || '');
        H.call('stop', sim, 'menu');
      }
    }
    /*
     * Turning up on 18/36 with the traffic already going — everything above
     * starts with you there. The review put you at an end of it after 150 or
     * 300 s of traffic, or landed you on it, and found aeroplanes turning off
     * along it and holding on it in front of you, and you rolling through
     * them: an arrival given the exit at x 250 before you were there (seed 1
     * and 4 on 09), a departure holding at (250, -47) behind one
     * back-taxiing for 27 (seed 2). And with the other exits each held by a
     * departure waiting for the runway, that arrival then had no way off but
     * along 18/36 and sat on 09/27 for as long as you were parked (seed 1 on
     * 09, parked: see planArrival). At 30 fps, as the game runs.
     */
    const visit = (name, { seed, wind, warm, end, land = false, park }) => {
      H.loadMap('kestrel', 'high');
      const sim = H.makeSim({ typeId: 'skylark', quality: 'high', wind });
      const f = F.buildField();
      const away = () => H.placePlayer(sim, f.cx, f.cz - 20000, { headingDeg: 90, agl: 2000, speed: 60 });
      away();
      H.startFlight(sim, { trafficSeed: seed });
      H.run(sim, H.makeWatch(sim), warm, 0.1, away);
      // Along +u from the north end, -u from the south.
      const way = end === 'north' ? 1 : -1;
      const hdg = way > 0 ? r2.headingDeg ?? 180 : (r2.headingDeg ?? 180) + 180;
      const a0 = -way * (r2.length / 2 - (land ? 60 : 40));
      const TA = Math.tan((3 * Math.PI) / 180);
      let a = land ? a0 - way * 4000 : a0;
      let v = land ? 50 : 0;
      let agl = land ? 4000 * TA : 0;
      let phase = land ? 'final' : 'parked';
      let stopT = land ? null : 0;
      const seen = { held: 0, heldWhat: '', ahead: 0, aheadWhat: '', deps: 0 };
      const last = new Map();
      const W = H.makeWatch(sim);
      H.run(sim, W, (land ? 90 : 0) + park + 60, 1 / 30, (t, dt) => {
        if (phase === 'final') {
          a += way * v * dt;
          agl = Math.max(0, (a0 - a) * way * TA);
          if ((a - a0) * way >= 0) [phase, agl, v] = ['landroll', 0, 35];
        } else if (phase === 'landroll') {
          v = Math.max(0, v - 2 * dt);
          a += way * v * dt;
          if (v === 0) [phase, stopT] = ['parked', t];
        } else if (phase === 'parked') {
          if (t - stopT >= park) phase = 'roll';
        } else {
          v = Math.min(v + dt, 45);
          a += way * v * dt;
          if (v > 33 || agl > 0) agl += 3.5 * dt;
        }
        H.placePlayer(sim, r2.cx + ux * a, r2.cz + uz * a, { headingDeg: hdg, agl, speed: v });
        for (const c of H.TF.trafficState().craft) {
          if (phase === 'parked' && c.phase === 'takeoff' && last.get(c.id) !== 'takeoff') seen.deps++;
          last.set(c.id, c.phase);
          if (!onR2(c) || agl > 0) continue;
          const where = `${c.callsign} ${c.phase} at (${Math.round(c.pos[0])}, ${Math.round(c.pos[2])}), t ${Math.round(t)} s, you ${phase}`;
          if (c.v < 0.3) {
            seen.held += dt;
            seen.heldWhat = seen.heldWhat || where;
          }
          if (phase !== 'parked' && ((c.pos[0] - r2.cx) * ux + (c.pos[2] - r2.cz) * uz - a) * way > -10) {
            seen.ahead += dt;
            seen.aheadWhat = seen.aheadWhat || where;
          }
        }
      });
      const tag = `queue ${name}, seed ${seed}`;
      ok(`${tag}: nobody through you`, W.player === 0 && W.touchPlayer === 0, W.playerFirst || W.touchPlayerFirst || '');
      ok(`${tag}: nobody stops on 18/36 while you are on it`, seen.held === 0, `${seen.held.toFixed(1)} s: ${seen.heldWhat}`);
      ok(`${tag}: nobody on 18/36 ahead of you`, seen.ahead === 0, `${seen.ahead.toFixed(1)} s: ${seen.aheadWhat}`);
      H.call('stop', sim, 'menu');
      return seen;
    };
    for (const end of ['north', 'south']) visit(`player turns up at the ${end} end of 18/36 after 150 s of traffic on 09, parks 35 s, rolls`, { seed: 4, wind: [90, 3], warm: 150, end, park: 35 });
    visit('player turns up at the north end of 18/36 after 300 s of traffic on 27, parks 90 s, rolls', { seed: 2, wind: [270, 12], warm: 300, end: 'north', park: 90 });
    visit('player lands on 18/36 from the north with traffic on 09, stops 40 s, takes off', { seed: 1, wind: [90, 3], warm: 150, end: 'north', land: true, park: 40 });
    const parked = visit('player turns up at the north end of 18/36 after 150 s of traffic on 09, parks 150 s, rolls', { seed: 1, wind: [90, 3], warm: 150, end: 'north', park: 150 });
    ok('queue ...and parked there, the traffic still takes off past you', parked.deps >= 1, `${parked.deps} take-offs while you sat there`);
    /*
     * The same on 09/27 — turning up at the east end of it after five minutes
     * of traffic on 27, sitting a minute and a half, then taking off west
     * along it. The review: one back-taxiing to line up at that end (a
     * Courier, seed 2; a Meridian, seed 4) drove up to you, stopped 22-32 m
     * from your nose and sat there, and you rolled through it. It turns
     * round and leaves the runway now (turnRoundForPlayer).
     */
    const rw1 = TR.AIRPORT.runway;
    for (const seed of [2, 4]) {
      H.loadMap('kestrel', 'high');
      const sim = H.makeSim({ typeId: 'skylark', quality: 'high', wind: [270, 12] });
      const f = F.buildField();
      const away = () => H.placePlayer(sim, f.cx, f.cz - 20000, { headingDeg: 90, agl: 2000, speed: 60 });
      away();
      H.startFlight(sim, { trafficSeed: seed });
      H.run(sim, H.makeWatch(sim), 300, 0.1, away);
      const x0 = rw1.cx + rw1.length / 2 - 40;
      let x = x0;
      let v = 0;
      let agl = 0;
      const seen = { ahead: 0, aheadWhat: '' };
      const W = H.makeWatch(sim);
      H.run(sim, W, 90 + 60, 1 / 30, (t, dt) => {
        if (t >= 90) {
          v = Math.min(v + dt, 45);
          x -= v * dt;
          if (v > 33 || agl > 0) agl += 3.5 * dt;
        }
        H.placePlayer(sim, x, rw1.cz, { headingDeg: 270, agl, speed: v });
        if (t < 90 || agl > 0) return;
        for (const c of H.TF.trafficState().craft) {
          if (!c.onGround || !TR.isOnRunway(c.pos[0], c.pos[2], c.span / 2) || TR.isOnRunway2(c.pos[0], c.pos[2], c.span / 2)) continue;
          if (x - c.pos[0] > -10 && c.v < 0.3) {
            seen.ahead += dt;
            seen.aheadWhat = seen.aheadWhat || `${c.callsign} ${c.phase} at (${Math.round(c.pos[0])}, ${Math.round(c.pos[2])}), t ${Math.round(t)} s`;
          }
        }
      });
      const tag = `queue player turns up at the east end of 09/27 after 300 s of traffic on 27, sits 90 s, rolls, seed ${seed}`;
      ok(`${tag}: nobody through you`, W.player === 0 && W.touchPlayer === 0, W.playerFirst || W.touchPlayerFirst || '');
      ok(`${tag}: nobody stopped on the runway in front of you as you roll`, seen.ahead === 0, `${seen.ahead.toFixed(1)} s: ${seen.aheadWhat}`);
      H.call('stop', sim, 'menu');
    }
  }

  /*
   * THE RUNWAY RULES (see src/features/traffic/rules.js). You turn up in the
   * middle of 09/27 — at x 0 either way, or 130 m in facing the other end —
   * with the traffic already going, sit 35 s, and roll at a gentle metre a
   * second a second. The review of the fourth repair round: rolled through
   * one in 20 of 378 fair runs — a take-off that had stopped for you waiting
   * nose to nose, departures lined up facing you for minutes, a back-taxi
   * turned round and sent 250 m along the runway ahead of you, a roll-out
   * stopped 26 m short of you. These are those runs. Nobody through you,
   * nobody stopped on the runway in front of you once you roll, and the
   * tower tells you "hold position" whenever one is on it ahead of you —
   * and never when none is.
   */
  const aheadOf = (sim, onRw, span) => {
    const p = sim.aircraft.pos;
    const h = (sim.aircraft.heading * Math.PI) / 180;
    return H.TF.trafficState().craft.filter((c) => c.onGround && onRw(c.pos[0], c.pos[2], c.span / 2) && (c.pos[0] - p.x) * Math.sin(h) - (c.pos[2] - p.z) * Math.cos(h) > 0);
  };
  const midRuns = [
    [1, 90, 130, -1, 150], [1, 90, 130, -1, 300], [2, 90, -130, 1, 300], [2, 270, 130, -1, 300],
    [3, 270, -130, 1, 300], [5, 270, -130, 1, 300], [4, 90, 130, -1, 150], [6, 270, -130, 1, 300],
  ];
  const tower = { said: 0, falseSaid: 0 };
  for (const [seed, windDir, x0, way, warm] of midRuns) {
    H.loadMap('kestrel', 'high');
    const sim = H.makeSim({ typeId: 'skylark', quality: 'high', wind: [windDir, windDir === 270 ? 12 : 5] });
    const f = F.buildField();
    const away = () => H.placePlayer(sim, f.cx, f.cz - 20000, { headingDeg: 90, agl: 2000, speed: 60 });
    away();
    H.startFlight(sim, { trafficSeed: seed });
    H.run(sim, H.makeWatch(sim), warm, 0.1, away);
    const hdg = way > 0 ? 90 : 270;
    let x = x0;
    let v = 0;
    let agl = 0;
    const seen = { ahead: 0, aheadWhat: '' };
    let notes = sim.notes.length;
    const W = H.makeWatch(sim);
    H.run(sim, W, 35 + 40, 1 / 30, (t, dt) => {
      if (t >= 35) {
        v = Math.min(v + dt, 45);
        x += way * v * dt;
        if (v > 30 || agl > 0) agl += 3.5 * dt;
      }
      H.placePlayer(sim, x, f.cz, { headingDeg: hdg, agl, speed: v });
      for (; notes < sim.notes.length; notes++) {
        if (!/^Hold position/.test(sim.notes[notes])) continue;
        tower.said++;
        if (!aheadOf(sim, (a, b, m) => TR.isOnRunway(a, b, m), 0).length) tower.falseSaid++;
      }
      if (t < 35 || agl > 0) return;
      for (const c of aheadOf(sim, (a, b, m) => TR.isOnRunway(a, b, m) && !TR.isOnRunway2(a, b, m))) {
        if (c.v < 0.3) {
          seen.ahead += dt;
          seen.aheadWhat = seen.aheadWhat || `${c.callsign} ${c.phase} at (${Math.round(c.pos[0])}, ${Math.round(c.pos[2])}), t ${Math.round(t)} s`;
        }
      }
    });
    const tag = `queue runway rules: you turn up at x ${x0} on 09/27 facing ${way > 0 ? 'east' : 'west'} after ${warm} s of traffic on ${windDir === 270 ? '27' : '09'}, sit 35 s, roll, seed ${seed}`;
    ok(`${tag}: nobody through you`, W.player === 0 && W.touchPlayer === 0, W.playerFirst || W.touchPlayerFirst || '');
    ok(`${tag}: nobody stopped on the runway in front of you as you roll`, seen.ahead === 0, `${seen.ahead.toFixed(1)} s: ${seen.aheadWhat}`);
    H.call('stop', sim, 'menu');
  }
  ok('queue runway rules: the tower says "hold position" only with one on the runway ahead of you', tower.falseSaid === 0, `${tower.said} said, ${tower.falseSaid} with nobody there`);
  ok('queue runway rules: ...and it did say it', tower.said > 0, `${tower.said} said`);
  /*
   * And 18/36: one on its way over it to 09/27 — just on to it from the
   * taxiway, where the first cut's holding point was 47 m down it — when you
   * turn up on it at either end and roll after three seconds. It goes across
   * to the far side, or on to 09/27, whichever keeps it out of your way;
   * never stopping on 18/36 (the review: rolled through one in 168 of 224).
   */
  if (TR.AIRPORT.runway2) {
    const r2 = TR.AIRPORT.runway2;
    for (const [seed, zSpot, way] of [[2, 100, -1], [2, -200, 1], [4, 100, -1], [4, -200, 1]]) {
      H.loadMap('kestrel', 'high');
      const sim = H.makeSim({ typeId: 'skylark', quality: 'high', wind: [270, 12] });
      const f = F.buildField();
      const away = () => H.placePlayer(sim, f.cx, f.cz - 20000, { headingDeg: 90, agl: 2000, speed: 60 });
      away();
      H.startFlight(sim, { trafficSeed: seed });
      const hit = () => H.TF.trafficState().craft.find((c) => c.onGround && Math.abs(c.pos[0] - r2.cx) < 20 && c.pos[2] > f.twZ - 5 && c.pos[2] < -20 && c.phase === 'lineup');
      let n = 0;
      while (!hit() && n++ < 9000) H.run(sim, H.makeWatch(sim), 0.1, 0.1, away);
      const tag = `queue runway rules: one on its way over 18/36 when you turn up on it at z ${zSpot}, seed ${seed}`;
      if (!ok(`${tag}: found one`, !!hit(), 'nobody in 15 min')) continue;
      const hdg = way > 0 ? 180 : 0;
      let z = zSpot;
      let v = 0;
      let agl = 0;
      let held = 0;
      let heldWhat = '';
      const W = H.makeWatch(sim);
      H.run(sim, W, 3 + 30, 1 / 30, (t, dt) => {
        if (t >= 3) {
          v = Math.min(v + dt, 45);
          z += way * v * dt;
          if (v > 30 || agl > 0) agl += 3.5 * dt;
        }
        H.placePlayer(sim, r2.cx, z, { headingDeg: hdg, agl, speed: v });
        for (const c of H.TF.trafficState().craft) {
          if (c.onGround && c.v < 0.3 && TR.isOnRunway2(c.pos[0], c.pos[2], c.span / 2) && !TR.isOnRunway(c.pos[0], c.pos[2], c.span / 2)) {
            held += dt;
            heldWhat = heldWhat || `${c.callsign} ${c.phase} at (${Math.round(c.pos[0])}, ${Math.round(c.pos[2])})`;
          }
        }
      });
      ok(`${tag}: nobody through you`, W.player === 0 && W.touchPlayer === 0, W.playerFirst || W.touchPlayerFirst || '');
      ok(`${tag}: nobody stops on 18/36`, held === 0, `${held.toFixed(1)} s: ${heldWhat}`);
      H.call('stop', sim, 'menu');
    }
  }

  /*
   * The Dev button with every stand taken. At the game's default graphics
   * the airport parks six of its own on Kestrel's stands, the traffic fills
   * the rest, and the first cut's button refused on every press (the
   * review). It now starts up the parked one due out soonest.
   */
  {
    H.loadMap('kestrel', 'high');
    const sim = H.makeSim({ typeId: 'skylark', quality: 'high' });
    const f = F.buildField();
    H.placePlayer(sim, f.cx, f.cz - 20000, { headingDeg: 90, agl: 2000, speed: 60 });
    H.startFlight(sim, { trafficSeed: 3 });
    let r = { ok: true };
    for (let i = 0; i < 8 && r.ok; i++) r = H.TF.spawnTraffic(sim, 'depart');
    const act = H.ext.devActions.find((a) => /one more \(departing\)/.test(a.label));
    const parkedBefore = H.TF.trafficState().craft.filter((c) => c.state === 'parked').map((c) => c.id);
    if (/park/.test(r.why || '') && parkedBefore.length) {
      sim.notes.length = 0;
      act.run(sim);
      H.run(sim, H.makeWatch(sim), 0.2, 0.1);
      const started = H.TF.trafficState().craft.filter((c) => parkedBefore.includes(c.id) && c.state !== 'parked');
      ok('dev button with every stand taken: a parked one starts up instead', started.length === 1, `${sim.notes.join(' | ')}; ${started.length} started`);
    } else {
      console.log(`dev button with every stand taken: not reached here (${r.why}; ${parkedBefore.length} parked)`);
    }
    H.call('stop', sim, 'menu');
  }

  // Out of the way altogether: the whole day goes round.
  scenario('an open sky', [1, 2], 20, (sim, f) => H.placePlayer(sim, f.cx, f.cz - 20000, { headingDeg: 90, agl: 2000, speed: 60 }), (tag, s) => {
    ok(`${tag}: aeroplanes take off and come back to park`, s.departures >= 3 && s.parked >= 2, `${s.departures} departures, ${s.parked} parked`);
    ok(`${tag}: nobody stuck on the ground for two minutes`, s.stillest < 120, `${s.stillest} s: ${s.stillWhy}`);
    ok(`${tag}: nobody waits three minutes to be let taxi`, s.longestWait < 180, `${s.longestWait} s: ${s.waitWhy}`);
  });
}

/* ------------------------------------------------------------------ */
/* The runway rules' arithmetic (traffic/rules.js)                     */
/* ------------------------------------------------------------------ */
{
  loadMap('kestrel');
  const pm = RU.blankPlayer();
  Object.assign(pm, { on: true, x: -130, z: 0, ux: 1, uz: 0, v: 0, accel: 1, delay: 0, halfSpan: 6, nose: 4, tail: 4, dLift: 400 });
  // Standing start at 1 m/s/s: 50 m in 10 s.
  ok('rules: the player covers 50 m from a standstill in 10 s at 1 m/s/s', Math.abs(RU.playerTime(pm, 50) - 10) < 1e-6);
  // A box straight ahead, one off to the side.
  const ahead = RU.reachTime(pm, { x0: 0, x1: 20, z0: -10, z1: 10 });
  const aside = RU.reachTime(pm, { x0: 0, x1: 20, z0: 200, z1: 220 });
  ok('rules: the player can reach what is ahead of their nose, and not what is 200 m to the side', ahead > 10 && ahead < 20 && aside === Infinity, `${ahead.toFixed(1)} s, ${aside}`);
  // An aeroplane (a trainer's size) crossing 150 m in front of them at 5 m/s, and one stopping there.
  const perf = { span: 11, noseLen: 4, tailLen: 4 };
  const cross = new Draft(20, -60).line(20, 60, 2).finish();
  cross.setSpeeds(() => 5, { v0: 5, vEnd: 5 });
  const stop = new Draft(20, -60).line(20, 0, 2).finish();
  stop.setSpeeds(() => 5, { v0: 5, vEnd: 0 });
  const a = RU.pathSlack(cross, 0, 5, perf, pm, 1, {});
  const b = RU.pathSlack(stop, 0, 5, perf, pm, 1, {});
  ok('rules: crossing 150 m ahead, it is clear of their path before they could get there', a.slack > 0 && Number.isFinite(a.slack), a.slack.toFixed(1));
  ok('rules: stopping in their path is never safe', b.slack === -Infinity, String(b.slack));
  ok('rules: the safest way off wins, and a safe one that keeps its plan beats a quicker one',
    RU.choose([{ slack: -3, offT: 5 }, { slack: 2, offT: 30 }]).offT === 30 &&
      RU.choose([{ slack: 20, offT: 30, keep: true }, { slack: 30, offT: 5 }]).keep === true &&
      RU.choose([{ slack: 50, offT: 5, touch: true }, { slack: -1, offT: 9 }]).offT === 9);
  // A way off that closes on them along the runway only if nothing else is as safe.
  ok('rules: a way off towards the player loses to an equally safe one away from them',
    RU.choose([{ slack: 30, offT: 5, toward: true }, { slack: 30, offT: 20 }]).offT === 20);
}

/* ------------------------------------------------------------------ */
/* Fewer draw calls: the merge in traffic/lod.js                        */
/* ------------------------------------------------------------------ */

/*
 * On a model where the right answer is known: a fuselage and two wings that
 * never move (one wing mirrored with a negative scale, as model factories
 * build left from right), a propeller pivot that spins with a hub and two
 * blades on it, three glass panes, a lamp the model shows only at night, and
 * an elevator that moves by itself. Checked: which parts are found moving,
 * what is merged into what, that nothing moved in the merging, that the
 * mirrored wing still faces outwards, and that the spinning parts still spin.
 */
{
  const THREE = await import(SRC + 'vendor/three.module.js');
  const LOD = await import(SRC + 'features/traffic/lod.js');
  const white = () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x99bbcc, transparent: true, opacity: 0.5 });
  const model = new THREE.Group();
  const add = (parent, geo, mat, x, y, z, name) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.name = name;
    parent.add(m);
    return m;
  };
  add(model, new THREE.BoxGeometry(1, 1, 6), white(), 0, 0, 0, 'fuselage');
  add(model, new THREE.BoxGeometry(4, 0.2, 1), white(), 2.5, 0, 0, 'right wing');
  const left = add(model, new THREE.BoxGeometry(4, 0.2, 1), white(), -2.5, 0, 0, 'left wing');
  left.scale.x = -1;
  const prop = new THREE.Group();
  prop.position.set(0, 0, -3.2);
  prop.name = 'prop pivot';
  model.add(prop);
  add(prop, new THREE.CylinderGeometry(0.2, 0.2, 0.3), white(), 0, 0, 0, 'hub');
  add(prop, new THREE.BoxGeometry(0.1, 1.6, 0.05), white(), 0, 0.8, 0, 'blade');
  add(prop, new THREE.BoxGeometry(0.1, 1.6, 0.05), white(), 0, -0.8, 0, 'blade');
  for (let i = 0; i < 3; i++) add(model, new THREE.PlaneGeometry(0.5, 0.4), glass, 0.51, 0.2, -1 + i * 0.6, 'pane');
  const lamp = add(model, new THREE.SphereGeometry(0.1), white(), 4.5, 0, 0, 'lamp');
  const elevator = add(model, new THREE.BoxGeometry(1.5, 0.1, 0.4), white(), 0, 0, 3.1, 'elevator');
  model.userData.update = (dt, ac, weather) => {
    prop.rotation.z += (ac.rpm || 0) * dt * 30;
    elevator.rotation.x = (ac.controls && ac.controls.pitch) || 0;
    lamp.visible = !!(weather && weather.isNight);
  };
  const probe = LOD.probeMotion(model, THREE);
  // After the probe, which has turned the propeller as the game would.
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model, true);
  const names = (set) => [...set].map((o) => o.name).sort().join(',');
  ok('lod: finds what the model moves by itself', names(probe.selfChanged) === 'elevator,lamp,prop pivot', names(probe.selfChanged));
  ok('lod: finds what the model shows and hides', names(probe.shownBySelf) === 'lamp', names(probe.shownBySelf));
  let before = 0;
  model.traverse((o) => { if (o.isMesh) before++; });
  const r = LOD.mergeStatic(model, THREE, probe);
  let after = 0;
  model.traverse((o) => { if (o.isMesh) after++; });
  // Fuselage + wings (3, one material look) -> 1; hub + blades -> 1 under the
  // pivot; three panes -> 1; lamp and elevator untouched.
  ok('lod: merges what it should', before === 11 && after === 5 && r.before === 9 && r.after === 3, `${before} -> ${after} meshes, ${r.before} into ${r.after}`);
  ok('lod: the propeller stays on its pivot', prop.children.length === 1 && prop.children[0].userData.merged === 3, `${prop.children.length} children`);
  model.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(model, true);
  ok('lod: nothing moved', box.min.distanceTo(box2.min) < 1e-4 && box.max.distanceTo(box2.max) < 1e-4,
    `${box.min.toArray()} ${box.max.toArray()} vs ${box2.min.toArray()} ${box2.max.toArray()}`);
  // The mirrored wing's top face must still face up: find the triangles at
  // the wing's top surface and check their normals from the winding.
  const body = model.children.find((o) => o.isMesh && o.userData.merged === 3 && o.material.type === 'MeshStandardMaterial');
  let inside = 0;
  let checked = 0;
  if (body) {
    const pos = body.geometry.attributes.position;
    const idx = body.geometry.index;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const n = new THREE.Vector3();
    const mid = new THREE.Vector3();
    for (let i = 0; i < idx.count; i += 3) {
      a.fromBufferAttribute(pos, idx.getX(i));
      b.fromBufferAttribute(pos, idx.getX(i + 1));
      c.fromBufferAttribute(pos, idx.getX(i + 2));
      mid.copy(a).add(b).add(c).divideScalar(3);
      if (Math.abs(mid.x) < 1 || Math.abs(mid.y) < 0.09) continue; // the wings' top and bottom faces only
      n.subVectors(b, a).cross(c.clone().sub(a));
      checked++;
      if (Math.sign(n.y) !== Math.sign(mid.y)) inside++;
    }
  }
  ok('lod: a mirrored part still faces outwards', !!body && checked > 0 && inside === 0, `${inside} of ${checked} wing faces inside out`);
  const spin0 = prop.children[0].getWorldQuaternion(new THREE.Quaternion());
  model.userData.update(0.5, { rpm: 1, controls: {} }, {});
  model.updateMatrixWorld(true);
  ok('lod: the merged propeller still turns', spin0.angleTo(prop.children[0].getWorldQuaternion(new THREE.Quaternion())) > 0.1);
  const parts = LOD.smallParts(model, THREE, probe.shownBySelf);
  ok('lod: small parts exclude what the model hides by itself', !parts.some((p) => p.o === lamp) && parts.some((p) => p.o === elevator),
    parts.map((p) => `${p.o.name || p.o.type}:${p.size.toFixed(1)}`).join(','));
}

if (declined.length) {
  console.log(`\nrunway ends the planner declines (not flown, so not failures):`);
  for (const d of declined) console.log(`  ${d}`);
}

const passed = checks.length - failed;
console.log(`\ntraffic planner: ${passed}/${checks.length} checks passed, ${planned} arrivals planned, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exitCode = failed ? 1 : 0;
