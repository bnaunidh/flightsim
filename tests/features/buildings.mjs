/**
 * The buildings, checked in node: `node tests/features/buildings.mjs`.
 *
 * Every one of these was found wrong on the live build of 2026-09-29 (the
 * number after each is what it measured then, from the tree at 9eb942c):
 *
 *   - the runway numbers read the right way up from the aeroplane landing
 *     over them, say the right thing, and are the real size — every end on
 *     every map was upside down (09 read "60" from the threshold of 09), the
 *     crosswind runway said 09/27 instead of 18/36, and a digit was 21-272 m
 *     long instead of 18
 *   - no two faces of the airfield's buildings, the town, the estate or the
 *     air base lie in one plane over each other (the flicker at a distance)
 *     — 165 m2 of them on Kestrel, 326-328 at Ironhead, Northwatch and
 *     Gateway, 4,119 m2 over all thirty maps
 *   - the terminal is glass round both ends under a roof that oversails
 *     them, not sliced off flat (the owner's screenshot)
 *   - every hangar has its number up, big
 *   - every house and block has ONE front door, facing a street, with its
 *     sill on the ground in front of it (four doors a house, the uphill one
 *     underground); no window below the ground; windows no more than 1.5x
 *     out of shape (2.3x); walls down to the ground all along their feet
 *   - a ground floor with room for its windows has them — at 9f0ce59 (not
 *     live) a sign slip made the ground floor blank stone on flat ground,
 *     in 68% of house bays
 *   - the roof-pad buildings: no daylight under their walls (2.6 m) and no
 *     window cut by the ground (901 of 1,062 points along their feet)
 *   - the lighthouse door is on its plinth, not inside it
 *   - the town draws in at most seven meshes (twelve)
 *
 * Exits non-zero on any failure.
 */

global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
  head: { appendChild() {} },
};
const store = new Map();
global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
global.window = global.window || { addEventListener() {}, devicePixelRatio: 1 };

const SRC = new URL('../../src/', import.meta.url).href;
const THREE = await import(SRC + 'vendor/three.module.js');
const T = await import(SRC + 'world/terrain.js');
const M = await import(SRC + 'world/maps.js');
const P = await import(SRC + 'world/pads.js');
const R = await import(SRC + 'world/roads.js');
const S = await import(SRC + 'world/scenery.js');
const AP = await import(SRC + 'world/airport.js');
const APR = await import(SRC + 'world/apron.js');

const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

/* ------------------------------------------------------------------ */
/* Coplanar faces                                                      */
/* ------------------------------------------------------------------ */

/**
 * Triangles of the named meshes under `root`, instances expanded, less the
 * ones nobody can see: under the ground, on the underside of something
 * standing on it, inside a solid, or looking straight into a wall 30 cm
 * away (the back of a door).
 */
function visibleTriangles(root, want) {
  const out = [];
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const n = new THREE.Vector3();
  const im = new THREE.Matrix4();
  const mw = new THREE.Matrix4();
  root.updateMatrixWorld(true);
  const inSolid = (x, y, z, m) => T.OBSTACLES.some((o) => x > o.x0 + m && x < o.x1 - m && z > o.z0 + m && z < o.z1 - m && y > o.y0 + m && y < o.y1 - m && !/hangar/.test(o.what));
  root.traverse((o) => {
    if (!o.isMesh || !want(o.name)) return;
    const mat = o.material;
    if (!mat || Array.isArray(mat) || mat.polygonOffset || mat.transparent) return;
    const g = o.geometry;
    const pos = g.attributes.position;
    const idx = g.index;
    const cnt = idx ? idx.count : pos.count;
    for (let k = 0; k < (o.isInstancedMesh ? o.count : 1); k++) {
      if (o.isInstancedMesh) {
        o.getMatrixAt(k, im);
        mw.multiplyMatrices(o.matrixWorld, im);
      } else mw.copy(o.matrixWorld);
      for (let i = 0; i < cnt; i += 3) {
        for (let j = 0; j < 3; j++) v[j].fromBufferAttribute(pos, idx ? idx.getX(i + j) : i + j).applyMatrix4(mw);
        e1.subVectors(v[1], v[0]);
        e2.subVectors(v[2], v[0]);
        n.crossVectors(e1, e2);
        const area = n.length() / 2;
        if (area < 0.02) continue;
        n.normalize();
        const cx = (v[0].x + v[1].x + v[2].x) / 3;
        const cy = (v[0].y + v[1].y + v[2].y) / 3;
        const cz = (v[0].z + v[1].z + v[2].z) / 3;
        if (v.every((p) => p.y < T.heightAt(p.x, p.z) - 0.02)) continue;
        if (n.y < -0.9 && cy < T.heightAt(cx, cz) + 0.08) continue;
        if (inSolid(cx, cy, cz, 0.25)) continue;
        if (Math.abs(n.y) < 0.2 && inSolid(cx + n.x * 0.3, cy + n.y * 0.3, cz + n.z * 0.3, 0)) continue;
        out.push({ p: v.map((q) => [q.x, q.y, q.z]), n: [n.x, n.y, n.z], d: n.x * v[0].x + n.y * v[0].y + n.z * v[0].z, mesh: o.name });
      }
    }
  });
  return out;
}

function clip(poly, ax, ay, bx, by) {
  const out = [];
  const side = (p) => (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const sp = side(p);
    const sq = side(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}
const area2 = (p) => {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += p[i][0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * p[i][1];
  return s / 2;
};

/** Square metres of faces lying within 1 cm of each other, facing the same way, overlapping. */
function coplanar(tris) {
  const buckets = new Map();
  for (const t of tris) {
    // Half-metre buckets; the real test is below, point by point. (Plane offsets
    // are no good on their own this far from the origin: a thousandth of a
    // radian between two normals is metres of difference in n.p at 6 km.)
    const key = [Math.round(t.n[0] * 40), Math.round(t.n[1] * 40), Math.round(t.n[2] * 40), Math.round(t.d / 0.5)].join(',');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t);
  }
  let total = 0;
  const where = new Map();
  for (const list of buckets.values()) {
    for (let i = 0; i < list.length; i++) {
      const A = list[i];
      const ax = Math.abs(A.n[0]) > Math.abs(A.n[1]) ? (Math.abs(A.n[0]) > Math.abs(A.n[2]) ? 0 : 2) : Math.abs(A.n[1]) > Math.abs(A.n[2]) ? 1 : 2;
      const u = ax === 0 ? 1 : 0;
      const w = ax === 2 ? 1 : 2;
      const pa = A.p.map((q) => [q[u], q[w]]);
      if (area2(pa) < 0) pa.reverse();
      for (let j = i + 1; j < list.length; j++) {
        const B = list[j];
        if (A.n[0] * B.n[0] + A.n[1] * B.n[1] + A.n[2] * B.n[2] < 0.999) continue;
        if (B.p.some((q) => Math.abs(A.n[0] * (q[0] - A.p[0][0]) + A.n[1] * (q[1] - A.p[0][1]) + A.n[2] * (q[2] - A.p[0][2])) > 0.01)) continue;
        let poly = B.p.map((q) => [q[u], q[w]]);
        if (area2(poly) < 0) poly.reverse();
        for (let k = 0; k < 3 && poly.length; k++) poly = clip(poly, pa[k][0], pa[k][1], pa[(k + 1) % 3][0], pa[(k + 1) % 3][1]);
        const ar = poly.length >= 3 ? Math.abs(area2(poly)) : 0;
        if (ar < 0.01) continue;
        total += ar;
        const key = `${A.mesh}/${B.mesh}`;
        where.set(key, (where.get(key) || 0) + ar);
      }
    }
  }
  return { total, where: [...where.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, a]) => `${k} ${a.toFixed(1)} m2`) };
}

/* ------------------------------------------------------------------ */
/* Every map                                                           */
/* ------------------------------------------------------------------ */

const BUILDINGS = /^(airfield-structures|airfield-steel|wall|wallWarm|clad|roof|apron-structures|terminal-|town-|huts-|cottage-|estate-|airbase-)/;
const faults = { numbers: [], zf: [], terminal: [], hangars: [], doors: [], windows: [], blank: [], stretch: [], feet: [], facing: [], pads: [], lighthouse: [], draws: [] };
let ends = 0;
let digitLen = [Infinity, 0];
let zfMaps = 0;
let doorsTotal = 0;
let facedTotal = [0, 0];
let padSamples = 0;
let openBays = [0, 0];

for (const map of M.MAPS) {
  T.applyMap(map);
  T.clearObstacles();
  T.clearPlatforms();
  P.clearPads();
  if (map.courier && !(map.waters && map.waters.roads && map.waters.roads.length)) {
    const b = R.buildRoads(map);
    map.waters = map.waters || {};
    map.waters.roads = b.roads;
    delete map.waters._ready;
    T.applyMap(map);
    T.clearObstacles();
    T.clearPlatforms();
    P.clearPads();
  }
  AP.refreshRunways();
  APR.refreshApronElevation();
  const scene = new THREE.Scene();
  const a = new AP.Airport(scene);
  const ap = new APR.Apron(scene, 'high');
  const sc = new S.Scenery(scene, 'high');
  const lay = AP.airportLayout();
  const A = T.AIRPORT;

  /* ---- runway numbers ---- */
  const nums = a.group.getObjectByName('runway-numbers');
  const want = AP.runwayDesignators();
  const endList = [
    { x: A.runway.cx - A.runway.length / 2, z: A.runway.cz, hdg: 90 },
    { x: A.runway.cx + A.runway.length / 2, z: A.runway.cz, hdg: 270 },
  ];
  if (A.runway2) {
    const r2 = A.runway2;
    const hd = r2.headingDeg ?? 180;
    const fx = Math.sin((hd * Math.PI) / 180);
    const fz = -Math.cos((hd * Math.PI) / 180);
    endList.push({ x: r2.cx - (fx * r2.length) / 2, z: r2.cz - (fz * r2.length) / 2, hdg: hd % 360 });
    endList.push({ x: r2.cx + (fx * r2.length) / 2, z: r2.cz + (fz * r2.length) / 2, hdg: (hd + 180) % 360 });
  }
  if (!nums) faults.numbers.push(`${map.id}: no runway-numbers mesh`);
  else {
    const pos = nums.geometry.attributes.position;
    const uv = nums.geometry.attributes.uv;
    const texts = nums.userData.quads || [];
    const seen = new Set();
    for (let q = 0; q < pos.count / 6; q++) {
      const top = [0, 0, 0];
      const bot = [0, 0, 0];
      for (let k = 0; k < 6; k++) {
        const i = q * 6 + k;
        const t = uv.getY(i) > 0.5 ? top : bot;
        t[0] += pos.getX(i);
        t[1] += pos.getZ(i);
        t[2]++;
      }
      const tx = top[0] / top[2];
      const tz = top[1] / top[2];
      const bx = bot[0] / bot[2];
      const bz = bot[1] / bot[2];
      const mx = (tx + bx) / 2;
      const mz = (tz + bz) / 2;
      // Its end: the nearest threshold.
      const e = endList.reduce((b, c) => (Math.hypot(c.x - mx, c.z - mz) < Math.hypot(b.x - mx, b.z - mz) ? c : b));
      seen.add(e);
      const fx = Math.sin((e.hdg * Math.PI) / 180);
      const fz = -Math.cos((e.hdg * Math.PI) / 180);
      const ux = tx - bx;
      const uz = tz - bz;
      const L = Math.hypot(ux, uz);
      const text = texts[q];
      const d = want[q];
      if ((ux * fx + uz * fz) / L < 0.95) faults.numbers.push(`${map.id} ${text}: reads upside down from the approach`);
      if (text !== AP.designatorFor(e.hdg)) faults.numbers.push(`${map.id}: ${text} painted where ${AP.designatorFor(e.hdg)} belongs`);
      if (!d || d.len < 9 || d.len > 18) faults.numbers.push(`${map.id} ${text}: ${d && d.len} m long`);
      if (d) digitLen = [Math.min(digitLen[0], d.len), Math.max(digitLen[1], d.len)];
    }
    if (seen.size !== endList.length) faults.numbers.push(`${map.id}: numbers at ${seen.size} of ${endList.length} runway ends`);
    ends += endList.length;
  }

  /* ---- the terminal: glass round the ends, a roof over them ---- */
  const Tm = lay.terminal;
  if (Tm) {
    const kind = lay.military ? 'ops' : lay.shape === 'strip' ? 'club' : 'terminal';
    const glass = ap.group.getObjectByName('terminal-glass');
    if (kind !== 'ops') {
      let ends2 = 0;
      if (glass) {
        const nrm = glass.geometry.attributes.normal;
        let px = 0;
        let nx = 0;
        for (let i = 0; i < nrm.count; i++) {
          if (nrm.getX(i) > 0.99) px++;
          if (nrm.getX(i) < -0.99) nx++;
        }
        ends2 = (px > 0) + (nx > 0);
      }
      if (ends2 !== 2) faults.terminal.push(`${map.id}: glass on ${ends2} of 2 ends`);
    }
    if (kind === 'terminal') {
      const roof = ap.group.getObjectByName('terminal-roof');
      const bb = roof && new THREE.Box3().setFromObject(roof);
      const r = Tm.rect;
      const zF = lay.frame.z(Tm.front);
      const over = bb ? Math.min(r.x0 - bb.min.x, bb.max.x - r.x1, zF < (r.z0 + r.z1) / 2 ? zF - bb.min.z : bb.max.z - zF) : 0;
      if (!(over >= 2.5)) faults.terminal.push(`${map.id}: the roof oversails the ends and the glass by ${over.toFixed(1)} m`);
    }
  }

  /* ---- hangars: a number each ---- */
  const numbers = (a.plates || []).filter((p) => p.kind === 'number');
  if (numbers.length !== lay.hangars.length) faults.hangars.push(`${map.id}: ${numbers.length} numbers on ${lay.hangars.length} hangars`);

  /* ---- the town ---- */
  const town = sc.town || {};
  const f = town.facts;
  if (town.houses || town.blocks) {
    if (!f) faults.doors.push(`${map.id}: no facts from addTown`);
    else {
      doorsTotal += f.doors;
      if (f.doors !== town.houses + town.blocks) faults.doors.push(`${map.id}: ${f.doors} doors on ${town.houses + town.blocks} buildings`);
      if (!(f.doorGap >= 0.1)) faults.doors.push(`${map.id}: a door sill ${f.doorGap.toFixed(2)} m over its ground`);
      if (f.buriedBays) faults.windows.push(`${map.id}: ${f.buriedBays} windows below the ground`);
      openBays[0] += f.openBays - f.blankBays;
      openBays[1] += f.openBays;
      if (f.blankBays) faults.blank.push(`${map.id}: ${f.blankBays} of ${f.openBays} blank`);
      if (f.stretch > 1.5) faults.stretch.push(`${map.id}: windows ${f.stretch.toFixed(2)}x out of shape`);
    }
    // Front doors toward a street; every wall's foot on the ground.
    const plan = S.planTown(map.scenery.town, 1);
    const segs = [];
    for (const r of (map.waters && map.waters.roads) || []) for (let k = 1; k < r.path.length; k++) segs.push([r.path[k - 1][0], r.path[k - 1][1], r.path[k][0], r.path[k][1]]);
    for (const st of plan.streets || []) for (let k = 1; k < st.pts.length; k++) segs.push([st.pts[k - 1][0], st.pts[k - 1][1], st.pts[k][0], st.pts[k][1]]);
    const dist = (x, z) => {
      let b = Infinity;
      for (const [ax, az, bx, bz] of segs) {
        const dx = bx - ax;
        const dz = bz - az;
        const L2 = dx * dx + dz * dz;
        const u = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
        b = Math.min(b, Math.hypot(ax + dx * u - x, az + dz * u - z));
      }
      return b;
    };
    let faced = 0;
    let total = 0;
    for (const sp of plan.spots) {
      if (sp.kind === 'tower') continue;
      if (segs.length && sp.front) {
        total++;
        const vx = Math.sin(sp.rot) * sp.front;
        const vz = Math.cos(sp.rot) * sp.front;
        if (dist(sp.x + (vx * sp.d) / 2, sp.z + (vz * sp.d) / 2) < dist(sp.x - (vx * sp.d) / 2, sp.z - (vz * sp.d) / 2)) faced++;
      }
      const o = T.OBSTACLES.find((q) => Math.abs((q.x0 + q.x1) / 2 - sp.x) < 0.01 && Math.abs((q.z0 + q.z1) / 2 - sp.z) < 0.01);
      if (!o) continue;
      const c = Math.cos(sp.rot);
      const sn = Math.sin(sp.rot);
      let lo = Infinity;
      for (let i = 0; i <= 16; i++) {
        for (let j = 0; j <= 16; j++) {
          if (i % 16 && j % 16) continue;
          const lx = (-0.5 + i / 16) * sp.w;
          const lz = (-0.5 + j / 16) * sp.d;
          lo = Math.min(lo, T.heightAt(sp.x + c * lx + sn * lz, sp.z - sn * lx + c * lz));
        }
      }
      if (o.y0 > lo + 0.02) faults.feet.push(`${map.id}: ${sp.kind} at ${Math.round(sp.x)},${Math.round(sp.z)} ${(o.y0 - lo).toFixed(2)} m over its ground`);
    }
    facedTotal[0] += faced;
    facedTotal[1] += total;
    if (total && faced / total < 0.9) faults.facing.push(`${map.id}: ${faced}/${total}`);
    let meshes = 0;
    sc.group.traverse((o) => { if (o.isMesh && /^town-/.test(o.name)) meshes++; });
    if (meshes > 4) faults.draws.push(`${map.id}: ${meshes} town meshes`);
  }

  /* ---- roof-pad buildings ---- */
  sc.group.traverse((blk) => {
    if (!blk.isMesh || !Array.isArray(blk.material)) return;
    const pos = blk.geometry.attributes.position;
    const uv = blk.geometry.attributes.uv;
    const idx = blk.geometry.index;
    const byWall = new Map();
    for (let q = 0; q < blk.geometry.groups[0].count / 6; q++) {
      const i0 = idx.getX(q * 6);
      const i1 = idx.getX(q * 6 + 1);
      const i2 = idx.getX(q * 6 + 2);
      const key = [pos.getX(i0), pos.getZ(i0), pos.getX(i1), pos.getZ(i1)].map((v) => v.toFixed(2)).join(',');
      if (!byWall.has(key)) byWall.set(key, { a: [pos.getX(i0), pos.getZ(i0)], b: [pos.getX(i1), pos.getZ(i1)], bands: [] });
      byWall.get(key).bands.push({ y0: pos.getY(i0), y1: pos.getY(i2), v0: uv.getY(i0), v1: uv.getY(i2) });
    }
    for (const w of byWall.values()) {
      if (w.bands.some((bd) => bd.y0 < -5)) continue;
      const bottom = Math.min(...w.bands.map((bd) => bd.y0));
      for (let k = 0; k <= 16; k++) {
        const x = w.a[0] + ((w.b[0] - w.a[0]) * k) / 16;
        const z = w.a[1] + ((w.b[1] - w.a[1]) * k) / 16;
        const gr = T.heightAt(x, z);
        if (gr < 0.5) continue;
        padSamples++;
        if (bottom > gr + 0.02) faults.pads.push(`${map.id}: ${(bottom - gr).toFixed(2)} m of daylight under a roof-pad building`);
        const bd = w.bands.find((q) => gr >= q.y0 && gr <= q.y1);
        if (!bd || Math.abs(bd.v1 - bd.v0) < 0.05) continue;
        const v = bd.v0 + ((bd.v1 - bd.v0) * (gr - bd.y0)) / (bd.y1 - bd.y0);
        const inFloor = (((v * 7) % 3.5) + 3.5) % 3.5;
        if (inFloor > 0.55 && inFloor < 2.63) faults.pads.push(`${map.id}: the ground cuts a roof-pad building's window`);
      }
    }
  });

  /* ---- the lighthouse door ---- */
  sc.group.traverse((o) => {
    const p = o.isMesh && o.geometry.parameters;
    if (!p || o.geometry.type !== 'BoxGeometry' || p.width !== 1.6 || p.height !== 2.6 || p.depth !== 0.5) return;
    // The plinth's top is 3 m over the ground under the tower's middle.
    if (o.position.y - 1.3 < 3 - 1e-6) faults.lighthouse.push(`${map.id}: the door's sill ${(o.position.y - 1.3).toFixed(2)} m up, the plinth's top 3 m`);
  });

  /* ---- coplanar faces ---- */
  zfMaps++;
  const zf = coplanar(visibleTriangles(scene, (name) => BUILDINGS.test(name || '')));
  if (zf.total > 1) faults.zf.push(`${map.id}: ${zf.total.toFixed(1)} m2 (${zf.where.join(', ')})`);
}

const list = (k, fallback) => faults[k].slice(0, 5).join('; ') || fallback;
ok('every runway end has its number, the right one, the right way up from the approach, 9-18 m long', faults.numbers.length === 0,
  list('numbers', `${ends} ends on ${M.MAPS.length} maps; digits ${digitLen[0].toFixed(1)}-${digitLen[1].toFixed(1)} m`));
ok('no two faces of any building lie over each other in one plane', faults.zf.length === 0, list('zf', `none on ${zfMaps} maps`));
ok('the terminal is glass round both ends, under a roof that oversails them and the glass', faults.terminal.length === 0, list('terminal', 'every map'));
ok('every hangar has its number up', faults.hangars.length === 0, list('hangars', 'every map'));
ok('every house and block has one front door, its sill on the ground', faults.doors.length === 0, list('doors', `${doorsTotal} doors`));
ok('and most of them face a street', faults.facing.length === 0, list('facing', `${facedTotal[0]} of ${facedTotal[1]}`));
ok('no window of a house is below the ground', faults.windows.length === 0, list('windows', 'none'));
ok('every ground-floor bay with room for its windows has them (no storey of blank stone on flat ground)', faults.blank.length === 0,
  `${openBays[0]} of ${openBays[1]} bays have them` + (faults.blank.length ? '; ' + list('blank', '') : ''));
ok('no window is more than 1.5x out of shape', faults.stretch.length === 0, list('stretch', 'none'));
ok('every town wall reaches the ground all along its foot', faults.feet.length === 0, list('feet', 'all'));
ok('the roof-pad buildings stand on the ground with their windows out of it', faults.pads.length === 0, list('pads', `${padSamples} points along their feet`));
ok('the lighthouse door is on its plinth', faults.lighthouse.length === 0, list('lighthouse', 'every map'));
ok('the town draws in at most four meshes (towers apart)', faults.draws.length === 0, list('draws', 'every map'));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
