/**
 * Node checks for the airfield: `node tests/features/airport.mjs`.
 *
 * For every one of the 32 maps:
 *   - parkingSlots() returns sane, unique, fresh slots
 *   - no slot, and no building, is on a runway, a taxiway or in the sea
 *   - every slot's box is on level ground and clear of the others
 *   - the airfield builds (Airport + Apron), registers its buildings as
 *     obstacles, keeps them off the runways, and stays inside a draw-call
 *     budget
 *   - every contact stand has a gate sign and a docking board, and nothing
 *     that stands still is left out of frustum culling
 * And on Kestrel, everything other code is written against is where it was:
 * the taxiway, the connectors, the apron, the tower and the windsock; the
 * docking board's arithmetic; the depth layers of the flat things; every
 * detail level building, and a detail change leaving nothing behind.
 * And on the three road maps, the router still reaches every place.
 *
 * Exits non-zero on any failure.
 */

if (typeof globalThis.document === 'undefined') {
  // Enough of a canvas for the texture painters: every 2D call is a no-op.
  globalThis.document = {
    createElement: () => ({
      getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
      width: 0,
      height: 0,
      style: {},
    }),
    body: { appendChild() {} },
    head: { appendChild() {} },
  };
}
if (typeof globalThis.window === 'undefined') globalThis.window = { addEventListener() {}, devicePixelRatio: 1 };

const src = new URL('../../src/', import.meta.url).href;
const THREE = await import(src + 'vendor/three.module.js');
const Terrain = await import(src + 'world/terrain.js');
const { MAPS, getMap } = await import(src + 'world/maps.js');
const AP = await import(src + 'world/airport.js');
const APR = await import(src + 'world/apron.js');
const Roads = await import(src + 'world/roads.js');

const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail) });
}

const overlaps = (a, b, m = 0) => a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.z0 < b.z1 + m && a.z1 > b.z0 - m;

/** The four corners and the middle of a slot's parking box. */
function slotPoints(s) {
  const h = (s.headingDeg * Math.PI) / 180;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const rx = Math.cos(h);
  const rz = Math.sin(h);
  const hs = s.maxSpan / 2;
  const hl = s.maxLength / 2;
  const pts = [[0, 0]];
  for (const a of [-1, 1]) for (const b of [-1, 1]) pts.push([a * hs, b * hl]);
  return pts.map(([x, l]) => ({ x: s.x + rx * x + fx * l, z: s.z + rz * x + fz * l }));
}
function slotRect(s) {
  const p = slotPoints(s);
  return {
    x0: Math.min(...p.map((q) => q.x)),
    x1: Math.max(...p.map((q) => q.x)),
    z0: Math.min(...p.map((q) => q.z)),
    z1: Math.max(...p.map((q) => q.z)),
  };
}

const faults = { slots: [], sea: [], runway: [], taxiway: [], level: [], overlap: [], build: [], obstacle: [], budget: [], pave: [], boards: [], cull: [], pushEnd: [], pushSweep: [], pushWay: [], parkedFit: [] };
let totalSlots = 0;
let minSlots = Infinity;
let parkedChecked = 0;

/*
 * The pushback, planned by the feature itself (its planPush and pushPose),
 * off every stand the aeroplane fits on, on every map with a ground crew.
 */
const SVC = await import(src + 'features/airport-services.js');
const LAYM = await import(src + 'world/airport-layout.js');
const PUSH = SVC.__airportServices;
const D2R = Math.PI / 180;
let pushes = 0;
const flips = [];

/*
 * Every aeroplane in the roster as it is drawn: built, baked the way the
 * apron bakes its parked ones, and measured. The airfield never builds a
 * model to decide which stand an aeroplane fits or where a parked one's nose
 * and tail are — typeSize() and estimateInfo() answer from the roster — and
 * from the physics shape alone they had the A320 29 m long (drawn: 37.6),
 * which put it on a 36 m stand with its tail over the taxiway. Each type's
 * answer may be no more than half a metre short of its drawing anywhere; a
 * `plan` may not be more than half a metre out either way, so it cannot go
 * stale when a model changes.
 */
const { AIRCRAFT } = await import(src + 'aircraft/types.js');
const { createAircraftModel } = await import(src + 'aircraft/model-adapter.js');
const { schemeFor } = await import(src + 'aircraft/liveries.js');
const { bakeModel } = await import(src + 'world/airport-kit.js');
const DRAWN = new Map();
{
  const bad = [];
  const TOL = 0.5;
  for (const type of AIRCRAFT) {
    let d;
    try {
      const model = createAircraftModel({ type, livery: schemeFor(type, 'house') });
      model.userData.update(
        0.016,
        { controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 1 }, rpm: 0, flaps: 0, gearPos: 1, gearDown: true, onGround: true, groundSpeed: 0, agl: 0, engineOn: false },
        { isNight: false, cond: { cloud: 0 } }
      );
      const bk = bakeModel(model);
      const b = bk.box;
      d = { nose: b.min.z, tail: b.max.z, span: Math.max(-b.min.x, b.max.x) * 2, halfSpan: bk.halfSpan, wingTipZ: bk.wingTipZ };
    } catch (e) {
      bad.push(`${type.id} would not build: ${e && e.message}`);
      continue;
    }
    DRAWN.set(type.id, d);
    const e = APR.estimateInfo(type.id);
    const z = LAYM.typeSize(type.id);
    const short = [];
    if (e.noseZ > d.nose + TOL) short.push(`nose ${(e.noseZ - d.nose).toFixed(1)} m`);
    if (e.tailZ < d.tail - TOL) short.push(`tail ${(d.tail - e.tailZ).toFixed(1)} m`);
    if (e.halfSpan * 2 < d.span - TOL || z.span < d.span - TOL) short.push(`span ${(d.span - Math.min(e.halfSpan * 2, z.span)).toFixed(1)} m`);
    if (z.length < d.tail - d.nose - TOL) short.push(`length ${(d.tail - d.nose - z.length).toFixed(1)} m`);
    const p = type.plan;
    const stale = p && (Math.abs(p.nose - d.nose) > TOL || Math.abs(p.tail - d.tail) > TOL || Math.abs(p.span - d.span) > TOL);
    if (short.length || stale) {
      bad.push(`${type.id} ${short.length ? short.join(', ') + ' short' : 'plan stale'} — drawn plan: { nose: ${d.nose.toFixed(2)}, tail: ${d.tail.toFixed(2)}, span: ${d.span.toFixed(2)} }`);
    }
  }
  ok('the airfield knows how big every aeroplane in the roster is drawn', bad.length === 0,
    bad.join('; ') || `${DRAWN.size} types within ${TOL} m, ${AIRCRAFT.filter((t) => t.plan).length} of them from a plan`);
}
/** Nose, tail and both wingtips of an aeroplane at a pose, in the world. */
function sweepPoints(info, pose) {
  const h = pose.h * D2R;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const rx = Math.cos(h);
  const rz = Math.sin(h);
  const at = (mx, mz) => ({ x: pose.x + rx * mx - fx * mz, z: pose.z + rz * mx - fz * mz });
  const tipZ = info.wingTipZ || 0;
  return [at(0, info.noseZ), at(0, info.tailZ), at(-info.halfSpan, tipZ), at(info.halfSpan, tipZ)];
}
/**
 * Is p within `m` metres of the aeroplane parked on stand q — inside the box
 * round it, nose to tail and tip to tip, in its own frame?
 */
function nearParked(q, p, m) {
  let ox;
  let oz;
  let hd;
  let info;
  if (q.parked && q.parked.info) {
    ({ ox, oz, heading: hd, info } = q.parked);
  } else {
    info = APR.estimateInfo(q.occupant);
    if (!info) return false;
    hd = q.headingDeg;
    const h = hd * D2R;
    const back = info.noseZ - LAYM.NOSE_STOP;
    ox = q.noseX + Math.sin(h) * back;
    oz = q.noseZ - Math.cos(h) * back;
  }
  return nearAt(ox, oz, hd, info, p, m);
}
function nearAt(ox, oz, hd, info, p, m) {
  const h = hd * D2R;
  const dx = p.x - ox;
  const dz = p.z - oz;
  const lx = dx * Math.cos(h) + dz * Math.sin(h);
  const lz = -(dx * Math.sin(h) - dz * Math.cos(h));
  return Math.abs(lx) < info.halfSpan + m && lz > info.noseZ - m && lz < info.tailZ + m;
}
let toTaxiway = 0;
let trafficPushes = 0;
/** Span and length of a roster type, the airfield's idea of it. */
function sizeOf(id) {
  const i = APR.estimateInfo(id);
  return i ? { span: i.halfSpan * 2, length: i.tailZ - i.noseZ } : null;
}
/*
 * What the traffic might park: the airliners and the jets as well as the
 * Meridian and the Skylark. The airport's own dressing and a stand's class
 * both change with the map, so the pool is the whole roster that could turn
 * up, and each stand gets the biggest of it (plan area) that fits there.
 */
const TRAFFIC_POOL = ['a380', 'b747', 'a320', 'meridian', 'f22', 'fa18', 'f35b', 'courier', 'skylark'].filter((id) => sizeOf(id));
const trafficTypes = new Set();
/*
 * The traffic team parks its aeroplanes on the stands parkingSlots() hands
 * out, in the middle of each box, which is further out than the airport's
 * own nose-in parking. Fill every free stand with the biggest aeroplane in
 * the pool that fits there by the slot's own numbers, then push off each of
 * them in turn with the rest still parked: sim.traffic is what the feature
 * reads them from.
 */
function trafficOn(lay) {
  const out = [];
  for (const sl of AP.parkingSlots()) {
    if (sl.kind !== 'stand') continue;
    const st = lay.stands.find((q) => q.id === sl.id);
    let typeId = null;
    let best = 0;
    for (const id of TRAFFIC_POOL) {
      const z = sizeOf(id);
      if (z.span > sl.maxSpan || z.length > sl.maxLength || z.span * z.length <= best) continue;
      typeId = id;
      best = z.span * z.length;
    }
    if (st && typeId) out.push({ st, t: { id: `t-${sl.id}`, typeId, pos: { x: sl.x, z: sl.z }, heading: sl.headingDeg, speed: 0, onGround: true } });
    if (typeId) trafficTypes.add(typeId);
  }
  return out;
}
/*
 * Who is pushed: everything the airport parks — the light aeroplanes, the
 * Meridian, the airliners and the jets — off every stand each one fits.
 */
const PUSHERS = ['skylark', 'courier', 'meridian', 'f35b', 'f22', 'fa18', 'a320', 'b747', 'a380'].filter((id) => sizeOf(id));
let shortPushes = 0;
function checkPushes(m, lay, withTraffic = false) {
  if (lay.military || !lay.stands.length) return;
  const parkedTraffic = withTraffic ? trafficOn(lay) : [];
  const towerFace = ((((Terrain.AIRPORT.headingDeg || 90) + 180) % 360) + 360) % 360;
  for (const typeId of PUSHERS) {
    // Measured, as the feature measures the aeroplane you fly (playerInfo).
    const d = DRAWN.get(typeId);
    const info = d && { ...APR.estimateInfo(typeId), noseZ: d.nose, tailZ: d.tail, halfSpan: d.halfSpan, wingTipZ: d.wingTipZ };
    if (!info) continue;
    PUSH.S.info = info;
    for (const st of lay.stands) {
      // Every stand it fits, by the rule the feature's "park at a free
      // stand" uses.
      if (!LAYM.standFits(st, info.halfSpan * 2, info.tailZ - info.noseZ)) continue;
      if (withTraffic && !parkedTraffic.some((e) => e.st === st)) continue;
      // Everyone else's traffic, where the feature's scan would put it.
      const others = parkedTraffic.filter((e) => e.st !== st);
      PUSH.S.busy.clear();
      PUSH.S.busyBy.clear();
      for (const e of others) {
        PUSH.S.busy.add(e.st);
        PUSH.S.busyBy.set(e.st, e.t);
      }
      // Parked the way the "park at a free stand" action parks you.
      const h = st.headingDeg * D2R;
      const back = info.noseZ - LAYM.NOSE_STOP;
      const fake = {
        aircraft: { pos: { x: st.noseX + Math.sin(h) * back, z: st.noseZ - Math.cos(h) * back }, heading: st.headingDeg },
        aircraftType: { id: typeId },
      };
      const P = PUSH.planPush(fake);
      pushes++;
      if (withTraffic) trafficPushes++;
      if (P.toTaxiway) toTaxiway++;
      if (P.straight < 4) shortPushes++;
      const tag = `${m.id}:${st.number}/${typeId}${withTraffic ? ' among traffic' : ''}`;
      if (P.flipped) flips.push(tag);
      const end = PUSH.pushPose(P, P.total, {});
      const endPts = sweepPoints(info, end).slice(0, 2).concat([end]);
      if (!endPts.every((p) => LAYM.pavedIn(lay, p.x, p.z))) faults.pushEnd.push(tag);
      const dh = Math.abs(((((end.h - (P.flipped ? towerFace + 180 : towerFace)) % 360) + 540) % 360) - 180);
      if (dh > 1) faults.pushWay.push(`${tag} ends at ${end.h.toFixed(0)}`);
      // Nothing it sweeps comes within 1 m of an aeroplane parked on another stand.
      const pose = {};
      let hit = null;
      for (let s = 0; s <= P.total + 0.01 && !hit; s += 1.5) {
        PUSH.pushPose(P, Math.min(s, P.total), pose);
        for (const p of sweepPoints(info, pose)) {
          const o = lay.stands.find((q) => q !== st && LAYM.standTaken(q) && nearParked(q, p, 1));
          if (o) {
            hit = `${tag} into the ${o.occupant} on stand ${o.number} at ${s.toFixed(0)} m`;
            break;
          }
          const e = others.find((x) => nearAt(x.t.pos.x, x.t.pos.z, x.t.heading, APR.estimateInfo(x.t.typeId), p, 1));
          if (e) {
            hit = `${tag} into the traffic's ${e.t.typeId} on stand ${e.st.number} at ${s.toFixed(0)} m`;
            break;
          }
        }
      }
      if (hit) faults.pushSweep.push(hit);
    }
  }
  PUSH.S.info = null;
  PUSH.S.busy.clear();
  PUSH.S.busyBy.clear();
}

for (const m of MAPS) {
  Terrain.applyMap(m.id);
  AP.refreshRunways();
  APR.refreshApronElevation();
  const lay = AP.airportLayout();
  const slots = AP.parkingSlots();
  totalSlots += slots.length;
  minSlots = Math.min(minSlots, slots.length);
  const elev = Terrain.AIRPORT.elev;

  // Shape of the contract.
  const ids = new Set();
  for (const s of slots) {
    const good =
      s && typeof s.id === 'string' && (s.kind === 'stand' || s.kind === 'hangar') &&
      [s.x, s.y, s.z, s.headingDeg, s.maxSpan, s.maxLength].every(Number.isFinite) && s.maxSpan > 5 && !ids.has(s.id);
    if (!good) faults.slots.push(`${m.id}:${s && s.id}`);
    ids.add(s && s.id);
  }
  if (!slots.some((s) => s.kind === 'stand')) faults.slots.push(`${m.id}: no free stand`);
  // Fresh objects each call.
  slots[0] && (slots[0].x += 1000);
  const again = AP.parkingSlots();
  if (slots[0] && again[0] && Math.abs(again[0].x - (slots[0].x - 1000)) > 1e-6) faults.slots.push(`${m.id}: parkingSlots shares its objects`);
  if (slots[0]) slots[0].x -= 1000;

  const taxi = lay.pavement.filter((p) => p.kind === 'taxiway' || p.kind === 'connector');
  for (const s of slots) {
    for (const p of slotPoints(s)) {
      const h = Terrain.heightAt(p.x, p.z);
      if (!(h > 1.5)) faults.sea.push(`${m.id}:${s.id}`);
      if (Math.abs(h - elev) > 1.0) faults.level.push(`${m.id}:${s.id} ${(h - elev).toFixed(1)} m`);
      if (Terrain.isOnAnyRunway(p.x, p.z, 3)) faults.runway.push(`${m.id}:${s.id}`);
    }
    const r = slotRect(s);
    if (s.kind === 'stand' && taxi.some((t) => overlaps(r, t, -0.5))) faults.taxiway.push(`${m.id}:${s.id}`);
    for (const o of slots) if (o !== s && overlaps(slotRect(o), r, -1.5)) faults.overlap.push(`${m.id}:${s.id}/${o.id}`);
  }
  /*
   * Made ground on the ground: pavement is drawn 5 cm up, so the field may
   * not rise more than 4 cm under it (it would poke through) or fall more
   * than 35 cm (the edge would float). Hangar floors the same, since you can
   * see them through the doors.
   */
  const made = lay.pavement.map((p) => ({ r: p, what: p.kind }));
  if (lay.carPark) made.push({ r: lay.carPark.rect, what: 'car park' });
  for (const h of lay.hangars) made.push({ r: h.rect, what: h.id, up: 0.09 });
  for (const { r, what, up } of made) {
    let worst = 0;
    for (let x = r.x0; x <= r.x1 + 0.01; x += Math.max(4, (r.x1 - r.x0) / 12)) {
      for (let z = r.z0; z <= r.z1 + 0.01; z += Math.max(4, (r.z1 - r.z0) / 12)) {
        if (Terrain.isOnAnyRunway(x, z, 0)) continue;
        const d = Terrain.heightAt(x, z) - elev;
        if (d > (up || 0.05) || d < -0.36) worst = Math.abs(d) > Math.abs(worst) ? d : worst;
      }
    }
    if (worst) faults.pave.push(`${m.id}:${what} ${worst.toFixed(2)} m`);
  }
  // Buildings: dry, level, clear of runways and taxiways.
  for (const b of lay.buildings) {
    const r = b.rect;
    for (const x of [r.x0, (r.x0 + r.x1) / 2, r.x1]) {
      for (const z of [r.z0, (r.z0 + r.z1) / 2, r.z1]) {
        const h = Terrain.heightAt(x, z);
        if (!(h > 1.5)) faults.sea.push(`${m.id}:${b.kind}`);
      }
    }
    if (lay.runways.some((rw) => overlaps(r, rw, 10))) faults.runway.push(`${m.id}:${b.kind}`);
    if (taxi.some((t) => overlaps(r, t, 1))) faults.taxiway.push(`${m.id}:${b.kind}`);
  }

  // Build it, as the world does.
  try {
    Terrain.clearObstacles();
    const scene = new THREE.Scene();
    const a = new AP.Airport(scene);
    const p = new APR.Apron(scene, 'high');
    const w = { windDirDeg: 90, windSpeedKts: 8, isNight: false, cond: { cloud: 0 } };
    for (let i = 0; i < 10; i++) {
      a.update(1 / 30, w);
      p.update(1 / 30, w);
    }
    let dc = 0;
    scene.traverse((o) => {
      let vis = true;
      for (let q = o; q; q = q.parent) if (!q.visible) vis = false;
      if (vis && (o.isMesh || o.isPoints || o.isSprite)) dc++;
    });
    // The field was 409 draw calls on Kestrel before; this is the ceiling now.
    if (dc > 110) faults.budget.push(`${m.id}: ${dc} draw calls`);
    for (const o of Terrain.OBSTACLES) {
      if (Terrain.isOnAnyRunway((o.x0 + o.x1) / 2, (o.z0 + o.z1) / 2, 5)) faults.obstacle.push(`${m.id}: ${o.what}`);
      const r = { x0: o.x0, x1: o.x1, z0: o.z0, z1: o.z1 };
      if (lay.runways.some((rw) => overlaps(r, rw, 2))) faults.obstacle.push(`${m.id}: ${o.what} overlaps a runway`);
    }
    if (lay.buildings.length && Terrain.OBSTACLES.length < lay.buildings.length) faults.obstacle.push(`${m.id}: ${Terrain.OBSTACLES.length} obstacles for ${lay.buildings.length} buildings`);
    // A docking board and a gate sign on every contact stand, and none elsewhere.
    const contact = lay.stands.filter((s) => s.bridge).length;
    const boards = p.boards ? p.boards.size : 0;
    if (lay.bridges && boards !== contact) faults.boards.push(`${m.id}: ${boards} boards for ${contact} contact stands`);
    if (!lay.bridges && boards) faults.boards.push(`${m.id}: ${boards} boards and no bridges`);
    /*
     * Nothing that stands still is left unculled: a mesh with culling off is
     * drawn in the shadow pass and the main pass wherever the camera looks.
     * The ones allowed are those whose own bounds are no use because they
     * move: the vehicle beacons.
     */
    scene.traverse((o) => {
      if ((o.isInstancedMesh || o.isPoints) && o.frustumCulled === false && !/beacon/.test(o.name)) faults.cull.push(`${m.id}: ${o.name || o.type}`);
    });
  } catch (e) {
    faults.build.push(`${m.id}: ${e && e.message}`);
  }
  /*
   * No parked aeroplane is bigger than its stand or hangar allows: its drawn
   * span and length within the numbers parkingSlots() would tell the traffic
   * for that place, and each one the apron drew (nose-in, at 'high') inside
   * its stand's box — so off the taxi lane and the taxiway.
   */
  const inBox = (tg, box) => {
    const i = tg.info;
    for (const mx of [-i.halfSpan, i.halfSpan]) {
      for (const mz of [i.noseZ, i.tailZ]) {
        const x = tg.ox + tg.rx * mx - tg.fx * mz;
        const z = tg.oz + tg.rz * mx - tg.fz * mz;
        if (x < box.x0 - 0.05 || x > box.x1 + 0.05 || z < box.z0 - 0.05 || z > box.z1 + 0.05) return false;
      }
    }
    return true;
  };
  const fitPlace = (where, id, maxSpan, maxLength, tg, box) => {
    const d = DRAWN.get(id);
    parkedChecked++;
    if (!d) return faults.parkedFit.push(`${m.id}:${where} ${id} not in the roster`);
    const len = d.tail - d.nose;
    if (d.span > maxSpan + 1e-6 || len > maxLength + 1e-6) {
      faults.parkedFit.push(`${m.id}:${where} ${id} ${len.toFixed(1)} x ${d.span.toFixed(1)} m on ${maxLength.toFixed(0)} x ${maxSpan.toFixed(0)}`);
    } else if (tg && box && !inBox(tg, box)) {
      faults.parkedFit.push(`${m.id}:${where} ${id} drawn outside its box`);
    }
  };
  for (const st of lay.stands) if (st.occupant) fitPlace(`stand ${st.number}`, st.occupant, st.maxSpan, LAYM.standMaxLength(st), st.parked, st.box);
  for (const h of lay.hangars) if (h.occupant) fitPlace(h.slot.id, h.occupant, h.slot.maxSpan, h.slot.maxLength, h.parked, h.rect);
  try {
    checkPushes(m, lay);
    checkPushes(m, lay, true);
  } catch (e) {
    faults.pushEnd.push(`${m.id}: threw ${e && e.message}`);
  }
}

ok('every map has free stands and hangars in parkingSlots()', faults.slots.length === 0 && minSlots >= 3, faults.slots.slice(0, 6).join(', ') || `${totalSlots} slots, fewest ${minSlots}`);
ok('no slot or building in the sea', faults.sea.length === 0, faults.sea.slice(0, 6).join(', ') || 'all dry');
ok('no slot or building on a runway', faults.runway.length === 0, faults.runway.slice(0, 6).join(', ') || 'all clear');
ok('no stand or building on a taxiway', faults.taxiway.length === 0, faults.taxiway.slice(0, 6).join(', ') || 'all clear');
ok('every slot is on level ground', faults.level.length === 0, faults.level.slice(0, 6).join(', ') || 'within 1 m of field elevation');
ok('no taxiway, apron, car park or hangar floor is buried or floating', faults.pave.length === 0, faults.pave.slice(0, 6).join(', ') || 'within +4 / -35 cm');
ok('no two slots overlap', faults.overlap.length === 0, faults.overlap.slice(0, 6).join(', ') || 'none');
ok('the airfield builds on all 32 maps', faults.build.length === 0, faults.build.slice(0, 4).join(' | ') || `${MAPS.length} maps`);
ok('buildings are solid, and none is on a runway', faults.obstacle.length === 0, faults.obstacle.slice(0, 4).join(', ') || 'ok');
ok('draw calls within budget on every map', faults.budget.length === 0, faults.budget.join(', ') || '<= 110');
ok('every contact stand has a gate sign and a docking board', faults.boards.length === 0, faults.boards.slice(0, 4).join(', ') || 'all');
ok('everything that stands still can be culled', faults.cull.length === 0, [...new Set(faults.cull)].slice(0, 6).join(', ') || 'all');
ok('no parked aeroplane is bigger than its stand or hangar allows, and every drawn one is inside its box', parkedChecked > 0 && faults.parkedFit.length === 0,
  faults.parkedFit.slice(0, 8).join(', ') || `${parkedChecked} parked on ${MAPS.length} maps`);
ok('the pushback off every stand ends with nose, middle and tail on made ground', pushes > 0 && faults.pushEnd.length === 0,
  faults.pushEnd.slice(0, 6).join(', ') || `${pushes} pushes (${PUSHERS.join(', ')}, every stand each fits; ${shortPushes} start the turn straight off a short apron)`);
ok('and ends facing the start of the runway the tower gives out, or the other way where the apron has no room', faults.pushWay.length === 0,
  faults.pushWay.slice(0, 6).join(', ') || `${flips.length} of ${pushes} swing the other way for room${flips.length ? ': ' + flips.slice(0, 6).join(', ') : ''}`);
ok('and nothing it swings (nose, tail, wingtips) comes within 1 m of a parked aeroplane', faults.pushSweep.length === 0,
  faults.pushSweep.slice(0, 8).join(', ') || `clear; ${pushes} pushes, ${trafficPushes} of them with the traffic (${[...trafficTypes].join(', ')}) parked on every other free stand; ${toTaxiway} turn on the taxiway to stay clear`);

/* ---- Kestrel: what other code is written against ---- */
Terrain.applyMap('kestrel');
AP.refreshRunways();
APR.refreshApronElevation();
{
  const lay = AP.airportLayout();
  const t = lay.taxiway.rect;
  const apron = lay.apron.rect;
  const near = (a, b, e = 0.6) => Math.abs(a - b) <= e;
  ok('Kestrel taxiway is where isPaved() and the taxi tutorial expect', near(t.x0, -440) && near(t.x1, 440) && near(t.z0, -107) && near(t.z1, -83), JSON.stringify(t));
  ok('Kestrel apron is where isPaved() expects', near(apron.x0, -260) && near(apron.x1, 100) && near(apron.z0, -190) && near(apron.z1, -106), JSON.stringify(apron));
  const cu = lay.connectors.map((c) => c.u);
  ok('Kestrel connectors at x -430 and 0 are kept', cu.includes(-430) && cu.includes(0), cu.join(', '));
  ok('Kestrel tower is where the tower camera stands', near(lay.tower.x, 40) && near(lay.tower.z, -206), `${lay.tower.x}, ${lay.tower.z}`);
  ok('Kestrel windsock is where it was', lay.windsock && near(lay.windsock.x, -500) && near(lay.windsock.z, -60), JSON.stringify(lay.windsock));
  /*
   * The taxi tutorial starts at (-80, -150) and taxis to (-140, -112). No
   * parked aeroplane's stand may come within 6 m of that line — the
   * Skylark's half-span, so a wingtip never passes over somebody's tail.
   */
  const segDist = (px, pz, ax, az, bx, bz) => {
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(ax + dx * t - px, az + dz * t - pz);
  };
  const boxDist = (b) => {
    let best = Infinity;
    for (let i = 0; i <= 10; i++) {
      for (let j = 0; j <= 10; j++) {
        const x = b.x0 + ((b.x1 - b.x0) * i) / 10;
        const z = b.z0 + ((b.z1 - b.z0) * j) / 10;
        best = Math.min(best, segDist(x, z, -80, -150, -140, -112));
      }
    }
    return best;
  };
  const blocked = lay.stands.filter((s) => s.occupant && boxDist(s.box) < 6);
  ok("the taxi tutorial's route off the apron is clear of parked aeroplanes", blocked.length === 0, blocked.map((s) => `${s.id} ${boxDist(s.box).toFixed(1)} m`).join(', ') || 'clear');
  ok('RUNWAY is unchanged', AP.RUNWAY.cx === 0 && AP.RUNWAY.length === 1100 && AP.RUNWAY.halfWidth === 17 && AP.RUNWAY.touchdown.x === -350 && AP.RUNWAY.elev === 14, JSON.stringify({ cx: AP.RUNWAY.cx, L: AP.RUNWAY.length, td: AP.RUNWAY.touchdown.x }));
  // The PAPI still reads a 3 degree path as two white, two red.
  const scene = new THREE.Scene();
  Terrain.clearObstacles();
  const a = new AP.Airport(scene);
  const td = AP.RUNWAY.touchdown;
  const d = 2000;
  const hint = a.updatePapi(new THREE.Vector3(td.x - d, 14 + Math.tan((3 * Math.PI) / 180) * d, td.z));
  ok('the PAPI shows the perfect glide path at 3 degrees', hint && hint.state === 'good', hint && hint.text);
  a.setLightsOn(true);
  ok('airfield lights switch on', a.lightsOn && a.runwayLights.visible && a.glowGroup.visible);
}

/* ---- Docking: the board's arithmetic, and the depth layers ---- */
Terrain.applyMap('kestrel');
AP.refreshRunways();
APR.refreshApronElevation();
{
  const LAY = await import(src + 'world/airport-layout.js');
  const KIT = await import(src + 'world/airport-kit.js');
  const lay = LAY.airportLayout();
  const st = lay.stands.find((s) => s.bridge && !s.occupant);
  const F = lay.frame;
  const stopZ = F.z(st.noseW - LAY.NOSE_STOP);
  const at = (dx, dz, hdg = st.headingDeg) => LAY.standApproach(F.x(st.u) + dx, stopZ + dz, hdg, {});
  const a = at(0, 8 * F.side * -1);
  ok('the board counts the metres to the stop', a && a.stand === st && Math.abs(a.toGo - 8) < 1e-6, a && a.toGo);
  const b = at(0, 0);
  ok('at the mark the board reads zero', b && Math.abs(b.toGo) < 1e-6, b && b.toGo);
  const c = at(2, 0);
  // Facing into a north stand (heading 0) the pilot's right is +x.
  ok("off the line to the pilot's right reads as positive", c && c.lateral > 1.9 && c.lateral < 2.1, c && c.lateral);
  const d = at(0, 0, st.headingDeg + 90);
  ok('an aeroplane crossing the stand side-on is not docking', d === null, d && d.stand && d.stand.id);
  const e = at(0, F.side * 10);
  ok('ten metres past the stop is still on the stand, reading negative', e && e.toGo < -9.9, e && e.toGo);
  ok('the board states: rolling, stop, stopped, too far',
    APR.dockState({ toGo: 5, speed: 2 }) === 1 && APR.dockState({ toGo: 0.3, speed: 1 }) === 2 &&
      APR.dockState({ toGo: 0.3, speed: 0.1 }) === 3 && APR.dockState({ toGo: -2, speed: 0 }) === 4);

  // The live board redraws only when what it shows changes.
  Terrain.clearObstacles();
  const scene = new THREE.Scene();
  const apron = new APR.Apron(scene, 'high');
  const r = { toGo: 8.2, lateral: 0, speed: 2, name: 'Skylark 172' };
  apron.showDocking(st, r);
  const k1 = apron.dockKey;
  r.toGo = 8.1;
  apron.showDocking(st, r);
  const same = apron.dockKey === k1;
  r.toGo = 0.2;
  r.speed = 0;
  apron.showDocking(st, r);
  ok('the live board redraws only when its face changes', same && apron.dockKey !== k1 && apron.dockMesh.visible, `${k1} -> ${apron.dockKey}`);
  apron.showDocking(null);
  ok('and goes back to waiting when nobody is on the stand', !apron.dockMesh.visible);

  /*
   * The layout answers the frame loop without rebuilding or re-keying.
   * Counted, not timed: this used to assert 100,000 calls under 40 ms, which
   * measured JIT warm-up and the machine's load (148 ms at load average 300,
   * 3 ms idle) rather than the memo. What keeps the frame loop cheap is that
   * the fast path neither builds a key string nor a layout, so that is what is
   * checked. The time is reported for the record only.
   */
  const l0 = LAY.airportLayout();
  const st0 = { ...LAY.layoutMemoStats };
  let sameObj = true;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 100000; i++) if (LAY.airportLayout() !== l0) sameObj = false;
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const st1 = LAY.layoutMemoStats;
  ok('airportLayout() is a cheap answer once built',
    sameObj && st1.keyed === st0.keyed && st1.built === st0.built,
    `same object ${sameObj}, re-keyed ${st1.keyed - st0.keyed}, rebuilt ${st1.built - st0.built} in 100,000 calls (${ms.toFixed(1)} ms, not asserted)`);
  // And the memo does notice a change: another map re-keys and rebuilds.
  const k0 = LAY.layoutMemoStats.keyed;
  const b0 = LAY.layoutMemoStats.built;
  Terrain.applyMap('gateway');
  AP.refreshRunways();
  const lSfo = LAY.airportLayout();
  const sfoOk = lSfo !== l0 && lSfo.mapId === 'gateway' && LAY.layoutMemoStats.keyed > k0 && LAY.layoutMemoStats.built > b0;
  Terrain.applyMap('kestrel');
  AP.refreshRunways();
  APR.refreshApronElevation();
  const lBack = LAY.airportLayout();
  ok('and a map change is noticed', sfoOk && lBack !== lSfo && lBack.mapId === 'kestrel',
    `re-keyed ${LAY.layoutMemoStats.keyed - k0}, rebuilt ${LAY.layoutMemoStats.built - b0} over sfo and back`);
  const tx = lay.taxiway;
  ok('made ground is found, and open grass is not',
    LAY.pavedIn(lay, F.x(0), F.z(tx.w)) && !LAY.pavedIn(lay, F.x(200), F.z((lay.runway.halfWidth + tx.w - tx.width / 2) / 2)) && !LAY.pavedIn(lay, 5000, 5000));

  // Depth layers: ground < shoulder < taxiway/apron < runway < paint.
  const L = KIT.LAYER;
  const order = ['shoulder', 'pavement', 'runway', 'paint', 'decal'];
  let rising = true;
  for (let i = 1; i < order.length; i++) {
    const [f0, u0] = L[order[i - 1]];
    const [f1, u1] = L[order[i]];
    if (!(f1 <= f0 && u1 < u0)) rising = false;
  }
  const air = new AP.Airport(new THREE.Scene());
  ok('flat layers are pulled forward in order: shoulder, apron, runway, paint', rising && air.runwayMat.polygonOffset && air.runwayMat.polygonOffsetUnits === L.runway[1],
    order.map((k) => `${k} ${L[k].join('/')}`).join(', '));
}

/* ---- Every detail level builds, and 'low' parks nothing ---- */
{
  const bad = [];
  const parked = {};
  for (const id of ['kestrel', 'gateway', 'airbase', 'town', 'stacks']) {
    Terrain.applyMap(id);
    AP.refreshRunways();
    APR.refreshApronElevation();
    for (const q of ['low', 'medium', 'high', 'ultra']) {
      try {
        Terrain.clearObstacles();
        const scene = new THREE.Scene();
        new AP.Airport(scene);
        const p = new APR.Apron(scene, q);
        p.update(1 / 30, { isNight: true, cond: { cloud: 0 } });
        parked[`${id}/${q}`] = p.parked.length;
      } catch (e) {
        bad.push(`${id}/${q}: ${e && e.message}`);
      }
    }
  }
  const lowParks = Object.entries(parked).filter(([k, n]) => k.endsWith('/low') && n > 0);
  ok('the field builds at every detail level', bad.length === 0 && lowParks.length === 0,
    bad.join(' | ') || `parked: ${Object.entries(parked).map(([k, n]) => `${k} ${n}`).join(', ')}`);

  /*
   * High, then low, on the same map: the layout outlives the world, and the
   * first build's parked aeroplanes must not haunt the second. Measured
   * before the fix: two bridges still swung out to nothing on Kestrel.
   */
  Terrain.applyMap('kestrel');
  AP.refreshRunways();
  APR.refreshApronElevation();
  const build = (q) => {
    Terrain.clearObstacles();
    const scene = new THREE.Scene();
    new AP.Airport(scene);
    return new APR.Apron(scene, q);
  };
  const hi = build('high');
  const slotsHigh = AP.parkingSlots().length;
  const lo = build('low');
  const slotsLow = AP.parkingSlots().length;
  const out = lo.bridges.filter((b) => b.ext > 0.5).length;
  ok('switching the detail down leaves no bridge docked to an aeroplane that is gone', hi.bridges.some((b) => b.ext > 0.5) && out === 0, `${out} still out`);
  ok("stands the detail level leaves empty are offered to the traffic", slotsLow > slotsHigh, `${slotsHigh} slots at high, ${slotsLow} at low`);
}

/* ---- The road maps: every place still reached ---- */
{
  const stranded = [];
  const through = [];
  for (const id of ['drovers', 'cape', 'cullen']) {
    const map = getMap(id);
    Terrain.applyMap(id);
    AP.refreshRunways();
    APR.refreshApronElevation();
    Terrain.clearObstacles();
    const scene = new THREE.Scene();
    new AP.Airport(scene);
    new APR.Apron(scene, 'high');
    const { roads } = Roads.buildRoads(map);
    for (const p of (map.courier && map.courier.places) || []) {
      if (p.boatOnly || Terrain.heightAt(p.x, p.z) <= 0.5) continue;
      if (Terrain.padWeight(p.x, p.z) > 0.5) {
        // On the airfield: a road has to reach it anyway.
        let best = Infinity;
        for (const r of roads) for (const q of r.path) best = Math.min(best, Math.hypot(q[0] - p.x, q[1] - p.z));
        if (best > 60) stranded.push(`${id}/${p.id} ${best.toFixed(0)} m`);
        continue;
      }
      if (!Roads.onRoad(roads, p.x, p.z, 220)) stranded.push(`${id}/${p.id}`);
    }
    for (const r of roads) {
      for (let i = 1; i < r.path.length; i++) {
        const [ax, az] = r.path[i - 1];
        const [bx, bz] = r.path[i];
        const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 4);
        for (let k = 0; k <= n; k++) {
          const x = ax + ((bx - ax) * k) / n;
          const z = az + ((bz - az) * k) / n;
          const o = Terrain.obstacleAt(x, Terrain.heightAt(x, z) + 1.5, z);
          if (o) {
            through.push(`${id}: ${r.name} through ${o.what}`);
            break;
          }
        }
      }
    }
  }
  ok('the road router still reaches every place on the road maps', stranded.length === 0, stranded.join(', ') || 'drovers, cape, cullen');
  ok('no road runs through an airfield building', through.length === 0, through.slice(0, 3).join(', ') || 'none');
}

Terrain.applyMap('kestrel');

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
