/**
 * KID PLAYTEST — the Island Courier Van.
 *
 * tests/selftest-three-games.js asks whether the van is broken. This asks the
 * question the ten-year-old who owns the game actually asked, which was why it
 * is "SO COOKED". Everything here is driven the way a child drives it: with
 * KEYS, dispatched as real keydown/keyup events, and nothing else. Nobody sets
 * `vehicle.speed`, nobody teleports the van down the road, nobody reads the
 * answer out of the job definition. When a check needs a driver, the driver is
 * a small key-pressing loop that looks at the same arrow the HUD shows and does
 * what a child does with it: hold Shift, lean on A or D until the arrow is
 * straight, lift off for the bends, and stand on Ctrl when it says ARRIVING.
 *
 * The numbers each check asserts are the ones that mean "fun and not broken"
 * for a child on a keyboard, and every one of them was measured, before and
 * after, on Drover's Flat — the car game's default island:
 *
 *   - the Jobs board, opened from the menu, offers what the van's island has
 *     (the menu's island is the aeroplane's) with that island's lengths
 *   - the HUD in the van shows van things (no POWER %, no BRAKES / EASY MODE
 *     chips, no "wind on the nose")
 *   - the first frame looks at the back of the van, not at the sea
 *   - it starts ON the road, pointing ALONG it, and the job arrow agrees
 *   - holding Shift gets you to 50 km/h in about three seconds
 *   - a full circle on the keys is a circle: no spin, a little lean
 *   - the wheel comes back to the middle when you let go
 *   - let go of everything and it rolls to a stop and stays there
 *   - the brake stops it, and holding it backs you up
 *   - trees stop you; nothing launches you; pinned on one, W and a
 *     steering key get you off it; the Wide view never looks through one
 *   - grass is slower than tarmac but you can still drive on it, and off
 *     the road the van sits on the grass that is drawn, not above it
 *   - the arrow and the words under it never say two different things
 *   - the roads look like roads and sit on the ground
 *   - only car things happen in the car
 *   - the first job, start to finish, by following the arrow: 100/100, the
 *     drop-off beam gone once it is done, and a debrief in van words
 *   - "Drive again" on that debrief drives the job again, in the van; the
 *     pause menu's Restart and its other way back do too, in van words, and
 *     so do the ⋯ tray's (which has no Autopilot or Brace for impact in it)
 *   - and every other job on the island, the same way
 *   - and every job again as the kid who owns the game drives: W held down,
 *     steering by the arrow, and doing only what the screen says — lift off
 *     for SLOW DOWN, brake for BRAKE! and ARRIVING — with a score worth having
 *   - and as a careful kid, never above 30 km/h (40 on First Run and the
 *     Shuttle too), who stops the moment it says ARRIVING and WAITS: every
 *     job delivered, never left stopped under ARRIVING with nothing
 *     happening (the second review's blocker: ARRIVING came up 45 m of
 *     route out, the job counts a stop within 34 m)
 *   - and as a kid who lets go of W at ARRIVING and coasts: delivered
 *   - ARRIVING is never on the screen more than 34 m from the job's target
 *   - stopped just past the drop-off on purpose: BACK UP, a real distance
 *     to go, and doing what it says delivers
 *   - stopped anywhere 40-75 m from First Run's yard, any side, facing
 *     either way: doing what the screen says delivers it inside 45 s
 *   - round that yard, and on the farm fields nearest it, the word under
 *     the speed says what is drawn there (not "grass" on a stubble field)
 *   - head-on into a building: stopped outside it, BLOCKED on the screen,
 *     and W with the steering key its arrow points at drives out
 *   - off the road with a building between the van and the road, following
 *     the arrow gets back to the road: it goes round, and never burrows in
 *   - W and D held together, flat out, is a circle and not a lap
 *   - on every car island ({ allMaps }), the arrow never takes the wheels
 *     half a metre off the ground they ride, nor a fifth of a second
 *   - give up on Night Call-out half way and the menu is not left in the dark
 *
 * HOW TO RUN IT (browser console, or from a harness that has window.__sim):
 *
 *   const s = window.__sim;
 *   const { runCarPlaytest } = await import('/tests/features/car-playtest.browser.js');
 *   const res = await runCarPlaytest(s);   // { summary, failed, checks }
 *
 * or through the plug-in feature runner, which calls `check(sim, r, say)`.
 *
 * Options: { allMaps: true } also plays every job on every car island;
 * { allMaps: ['cape'], home: false } plays just those islands and skips the
 * Drover's Flat checks — run the islands a couple at a time from a harness
 * with a clock on it, because all eight in one go can run past an hour on a
 * busy machine.
 *
 * It takes one to three minutes in a headless Chrome sharing the machine
 * (58 s to 195 s measured), because it really drives about fifty minutes of game
 * time — every job twice over, once as each kind of driver. It stubs the
 * renderer for the duration
 * (a hidden pane does not composite, and every step() renders) and puts it
 * back at the end.
 */

import * as THREE from '../../src/vendor/three.module.js';

const KEYS = {
  go: ['ShiftLeft', 'Shift'],
  stop: ['ControlLeft', 'Control'],
  left: ['KeyA', 'a'],
  right: ['KeyD', 'd'],
  hand: ['Space', ' '],
  // The other ways a child drives: WASD, and the arrow keys.
  w: ['KeyW', 'w'],
  s: ['KeyS', 's'],
  up: ['ArrowUp', 'ArrowUp'],
  down: ['ArrowDown', 'ArrowDown'],
  arrowLeft: ['ArrowLeft', 'ArrowLeft'],
  arrowRight: ['ArrowRight', 'ArrowRight'],
  help: ['KeyH', 'h'],
};

/** The same tiny reporter selftest.js uses. */
function makeReporter() {
  const checks = [];
  return {
    checks,
    ok(name, pass, detail = '') {
      checks.push({ name, pass: !!pass, detail: String(detail) });
      return !!pass;
    },
    get failed() {
      return checks.filter((c) => !c.pass);
    },
  };
}

export async function runCarPlaytest(sim, opts = {}) {
  const r = makeReporter();
  const say = opts.verbose ? (...a) => console.log('[car-playtest]', ...a) : () => {};
  await check(sim, r, say, opts);
  const failed = r.failed;
  return {
    summary: `${r.checks.length - failed.length}/${r.checks.length} car playtest checks passed`,
    failed,
    checks: r.checks,
  };
}

export async function check(sim, r, say = () => {}, opts = {}) {
  const Terrain = await import('../../src/world/terrain.js');
  const Roads = await import('../../src/world/roads.js');
  const Surface = await import('../../src/vehicles/surface.js');

  /* ------------------------------------------------------------ tackle -- */

  const realRender = sim.renderer.render;
  sim.renderer.render = () => {};
  const skyBefore = sim.weather ? `${sim.weather.time}/${sim.weather.condition}` : '';
  const origAutoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;

  const held = new Set();
  const press = (name, down) => {
    const [code, key] = KEYS[name];
    if (down === held.has(name)) return;
    if (down) held.add(name);
    else held.delete(name);
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key, bubbles: true }));
  };
  const releaseAll = () => {
    for (const n of Object.keys(KEYS)) press(n, false);
  };
  const DEG = Math.PI / 180;
  const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
  const bearing = (ax, az, bx, bz) => Math.atan2(bx - ax, -(bz - az)) / DEG;
  const kph = (v) => Math.abs(v.speed) * 3.6;

  /** Everything the game says, so "only car things happen" can be checked. */
  const said = [];
  const origNotify = sim.hud.notify;
  sim.hud.notify = function (msg, ...rest) {
    said.push({ t: clock, msg: String(msg) });
    return origNotify.call(this, msg, ...rest);
  };
  const origSimNotify = sim.notify;
  if (typeof origSimNotify === 'function') {
    sim.notify = function (msg, ...rest) {
      said.push({ t: clock, msg: String(msg) });
      return origSimNotify.call(this, msg, ...rest);
    };
  }
  let clock = 0;

  /** The drawn road's half-width, whatever this build calls it. */
  const drawnHalf = (rd) =>
    typeof Roads.PAVED_HALF === 'number' ? Roads.PAVED_HALF : (rd && rd.halfWidth ? rd.halfWidth : 18) * 0.78;

  const roadList = () => (sim.roads && (sim.roads.list || sim.roads.roads)) || [];

  /*
   * The ground the child sees under the van: the terrain mesh as built, where
   * this build can read it, else the height function. A van that follows the
   * drawn ground is not "lifted" where the drawn ground and heightAt differ.
   */
  let drawn = null;
  let drawnFor = null;
  const groundUnder = (x, z) => {
    if (typeof Roads.terrainMeshSampler === 'function' && sim.terrain) {
      if (drawnFor !== sim.terrain) {
        drawnFor = sim.terrain;
        drawn = Roads.terrainMeshSampler(sim.terrain);
      }
      const m = drawn ? drawn(x, z) : -Infinity;
      if (m > -1e6) return Math.max(m, 0);
    }
    return Math.max(Terrain.heightAt(x, z), 0);
  };

  /*
   * The ground the van RIDES: surface.js's own groundHeight where this build
   * has one (the tarmac where the road is drawn above the mesh, the mesh
   * beyond), else the drawn ground above. For "did the wheels leave it".
   */
  const rideGround = (x, z) =>
    typeof Surface.groundHeight === 'function' ? Math.max(Surface.groundHeight(x, z), 0) : groundUnder(x, z);

  /**
   * How far the van model's lowest point is above what is DRAWN under its
   * lowest wheel: the road ribbon where there is one, else the terrain. The
   * lowest wheel, not the middle: on a 1% slope the back tyres are 2.5 cm
   * lower than the centre of the van, and so is the road under them.
   * InstancedMesh caches its bounding box the first time anyone asks, so it
   * is asked afresh; call this with the van at rest, when the wheels are
   * where the model built them.
   */
  const tyreGap = () => {
    const v = sim.vehicle;
    const m = sim.vehicleModel;
    if (!v || !m) return null;
    m.updateMatrixWorld(true);
    m.traverse((o) => { if (o.isInstancedMesh) o.computeBoundingBox(); });
    const low = new THREE.Box3().setFromObject(m).min.y;
    const road = sim.roadMesh;
    if (road) road.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const drawnAt = (x, z) => {
      let y = groundUnder(x, z);
      if (road) {
        ray.set(new THREE.Vector3(x, v.pos.y + 50, z), new THREE.Vector3(0, -1, 0));
        ray.far = 100;
        const hit = ray.intersectObject(road, false);
        if (hit.length) y = Math.max(y, hit[0].point.y);
      }
      return y;
    };
    const hb = (v.spec.wheelbase || 2.7) / 2;
    const ht = (v.spec.track || 1.9) / 2;
    const fx = Math.sin(v.heading * DEG);
    const fz = -Math.cos(v.heading * DEG);
    let under = Infinity;
    for (const a of [-1, 1]) {
      for (const b of [-1, 1]) {
        under = Math.min(under, drawnAt(v.pos.x + fx * hb * a - fz * ht * b, v.pos.z + fz * hb * a + fx * ht * b));
      }
    }
    return low - under;
  };

  /** Nearest point on the network: distance off the centreline, and its heading. */
  function nearestRoad(x, z) {
    let best = null;
    for (const rd of roadList()) {
      const p = rd.path;
      for (let k = 1; k < p.length; k++) {
        const ax = p[k - 1][0];
        const az = p[k - 1][1];
        const ex = p[k][0] - ax;
        const ez = p[k][1] - az;
        const l2 = ex * ex + ez * ez;
        let t = l2 > 0 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(ax + ex * t - x, az + ez * t - z);
        if (!best || d < best.d) best = { d, heading: Math.atan2(ex, -ez) / DEG, rd, k, t };
      }
    }
    return best;
  }
  const onTarmacDrawn = (x, z) => {
    const n = nearestRoad(x, z);
    return !!n && n.d <= drawnHalf(n.rd) + 0.5;
  };

  /**
   * Camera sanity, sampled while driving: above the ground where it stands,
   * and able to see the van — no hillside between the lens and the roof.
   */
  const cam = { worstClear: Infinity, blocked: 0, samples: 0 };
  // Against the ground as drawn as well as heightAt: across a hollow the
  // terrain's flat triangles sit above heightAt, and that grass is what the
  // lens would be inside.
  const seen = (x, z) => Math.max(Terrain.heightAt(x, z), groundUnder(x, z));
  function sampleCamera() {
    const v = sim.vehicle;
    if (!v) return;
    const c = sim.camera.position;
    const clear = c.y - seen(c.x, c.z);
    cam.worstClear = Math.min(cam.worstClear, clear);
    cam.samples++;
    let hid = false;
    for (let i = 1; i < 8; i++) {
      const f = i / 8;
      const x = c.x + (v.pos.x - c.x) * f;
      const y = c.y + (v.pos.y + 1.2 - c.y) * f;
      const z = c.z + (v.pos.z - c.z) * f;
      if (seen(x, z) > y + 0.3) hid = true;
    }
    if (hid) cam.blocked++;
  }

  /** Step the game in 1/30 s slices, which is about how often a child's
   *  fingers can change their mind, calling `each` after every slice. */
  function drive(seconds, each) {
    const n = Math.round(seconds * 30);
    for (let i = 0; i < n; i++) {
      if (each && each(i / 30) === false) return i / 30;
      sim.step(1 / 30, 1 / 60);
      clock += 1 / 30;
      if (i % 6 === 0) sampleCamera();
    }
    return seconds;
  }

  /** A child keeping the van on the road: steer at a point on the nearest
   *  road some way ahead, in the direction the van is already going. */
  function laneKeepSteer(v, lookM = 28) {
    const n = nearestRoad(v.pos.x, v.pos.z);
    if (!n) return 0;
    const fwd = Math.abs(wrap180(n.heading - v.heading)) < 90 ? 1 : -1;
    const hdg = fwd > 0 ? n.heading : n.heading + 180;
    const p = n.rd.path;
    const ax = p[n.k - 1][0] + (p[n.k][0] - p[n.k - 1][0]) * n.t;
    const az = p[n.k - 1][1] + (p[n.k][1] - p[n.k - 1][1]) * n.t;
    const tx = ax + Math.sin(hdg * DEG) * lookM;
    const tz = az - Math.cos(hdg * DEG) * lookM;
    return wrap180(bearing(v.pos.x, v.pos.z, tx, tz) - v.heading);
  }
  function steerKeys(err, dead = 3) {
    press('right', err > dead);
    press('left', err < -dead);
  }

  /** What the chevron a child is looking at says, and the keys it means:
   *  the steering key the arrow leans towards, and S if it says back up. */
  function chevronKeys() {
    const h = sim.driveHud;
    const shown = h && h.chev && !h.chev.hidden;
    const what = shown ? h.chevWhat.textContent : '';
    const dist = shown ? h.chevDist.textContent : '';
    const m = shown ? /rotate\((-?[\d.]+)deg\)/.exec(h.chevArrow.style.transform || '') : null;
    const rot = m ? parseFloat(m[1]) : 0;
    return { what, dist, rot, steer: rot < -8 ? -1 : rot > 8 ? 1 : 0, back: what === 'BLOCKED' && /back up/i.test(dist) };
  }

  /** Where a flat bit of grass is, well away from any road, for the grass
   *  and tree checks. Walks outwards from a point until it finds one. */
  function findGrass(cx, cz, needRun = 180) {
    for (let ring = 1; ring < 40; ring++) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const x = cx + Math.cos(a) * ring * 60;
        const z = cz + Math.sin(a) * ring * 60;
        const h0 = Terrain.heightAt(x, z);
        if (h0 < 6) continue;
        const n = nearestRoad(x, z);
        if (n && n.d < 60) continue;
        // A straight run of open grass towards the east, no trees in it.
        let ok = true;
        for (let d = 0; d <= needRun && ok; d += 10) {
          const hx = x + d;
          const h = Terrain.heightAt(hx, z);
          if (Math.abs(h - h0) > needRun * 0.03 || h < 4) ok = false;
          const nn = nearestRoad(hx, z);
          if (nn && nn.d < 40) ok = false;
          if (Terrain.obstacleAt(hx, h + 1, z)) ok = false;
          if (Terrain.flatSurfaceAt && Terrain.flatSurfaceAt(hx, z)) ok = false;
          if (Terrain.padWeight && Terrain.padWeight(hx, z) > 0.2) ok = false;
        }
        if (ok) return { x, z, y: h0 };
      }
    }
    return null;
  }

  /*
   * Visible by what the browser will actually paint. Not `el.hidden`: the
   * attribute loses to any class that sets `display`, and `.hud-bar` sets
   * grid — the fuel bar was `hidden` and on screen the whole time.
   */
  const visibleEl = (n) => {
    if (!n) return false;
    let e = n;
    while (e && e !== sim.hud.wrap) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      e = e.parentElement;
    }
    return true;
  };

  /**
   * What the roads on the island in hand look like, from raycasts against
   * the drawn road mesh and the drawn terrain: how wide the tarmac is, and
   * every 18 m along every road whether it is buried (grass over the tarmac
   * at the centreline), floating (the road's outer edge standing more than
   * 35 cm clear of the grass — a lip you can see under) or draped (the
   * tarmac falling more than 8% from one edge to the other: a road laid
   * over a bank rather than a road). Null when there is no road mesh.
   */
  function measureRoads() {
    const mesh = sim.roadMesh || sim.scene.getObjectByName('roads');
    const terr = sim.terrain;
    const L = roadList();
    if (!mesh || !terr || !L.length) return null;
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const from = new THREE.Vector3();
    // The renderer is stubbed, so nothing has updated the world matrices
    // since the island was built: a raycast would see the terrain chunk at
    // the origin instead of where it stands. Measured, that alone read the
    // road as 58 m under the grass.
    sim.scene.updateMatrixWorld(true);
    /*
     * The terrain has 166,000 triangles and no acceleration structure, so a
     * raycast against all of it is 20 ms. Mesh.raycast honours drawRange,
     * and PlaneGeometry's index runs row by row, so ask only the three rows
     * of quads around the point. Same triangles, same intersection code.
     */
    const terrainY = (x, z) => {
      let best = null;
      for (const m of terr.children) {
        const g = m.geometry;
        const P = g && g.parameters;
        if (!P || !P.widthSegments || !g.index) continue;
        const segs = P.widthSegments;
        const lz = z - (m.position.z - P.height / 2);
        const lx = x - (m.position.x - P.width / 2);
        if (lx < 0 || lz < 0 || lx > P.width || lz > P.height) continue;
        const iy = Math.floor(lz / (P.height / P.heightSegments));
        const was = { start: g.drawRange.start, count: g.drawRange.count };
        g.setDrawRange(Math.max(0, iy - 1) * segs * 6, segs * 6 * 3);
        const h = ray.intersectObject(m, false);
        g.setDrawRange(was.start, was.count);
        if (h.length && (best == null || h[0].point.y > best)) best = h[0].point.y;
      }
      return best;
    };
    const hitY = (obj, x, z) => {
      ray.set(from.set(x, 2000, z), down);
      ray.far = 4000;
      if (obj === terr) return terrainY(x, z);
      const h = ray.intersectObject(obj, true);
      return h.length ? h[0].point.y : null;
    };
    const widths = [];
    const gaps = [];
    const lips = [];
    const falls = [];
    let hidden = 0;
    let covered = 0;
    let floating = 0;
    let draped = 0;
    let samples = 0;
    const worst = [];
    const feats = sim.features && sim.features.group;
    for (const rd of L) {
      const p = rd.path;
      // Width: across the middle of every road, where does the tarmac stop.
      const k = Math.max(1, Math.floor(p.length / 2));
      const ax = p[k - 1][0];
      const az = p[k - 1][1];
      const ex = p[k][0] - ax;
      const ez = p[k][1] - az;
      const l = Math.hypot(ex, ez) || 1;
      const mx = ax + ex * 0.5;
      const mz = az + ez * 0.5;
      const nx = -ez / l;
      const nz = ex / l;
      let lo = null;
      let hi = null;
      for (let o = -30; o <= 30; o += 0.5) {
        // The tarmac only: the paint material, if any, counts as tarmac;
        // a verge drawn in a different colour does not.
        ray.set(from.set(mx + nx * o, 2000, mz + nz * o), down);
        ray.far = 4000;
        const h = ray.intersectObject(mesh, true);
        let isTarmac = false;
        if (h.length) {
          const f = h[0].face;
          const m = Array.isArray(h[0].object.material) ? h[0].object.material[(f && f.materialIndex) || 0] : h[0].object.material;
          isTarmac = !(m && m.userData && m.userData.verge);
        }
        if (isTarmac) {
          if (lo == null) lo = o;
          hi = o;
        }
      }
      if (lo != null) widths.push(hi - lo);
      const edge = drawnHalf(rd) + (Roads.VERGE || 0) - 0.25;
      const lane = drawnHalf(rd) - 0.4;
      let run = 0;
      for (let j = 1; j < p.length; j++) {
        const sx = p[j - 1][0];
        const sz = p[j - 1][1];
        const dx = p[j][0] - sx;
        const dz = p[j][1] - sz;
        const len = Math.hypot(dx, dz);
        if (len < 0.01) continue;
        const ux = -dz / len;
        const uz = dx / len;
        // "Across" means across a straight bit of road. Where the path turns
        // a corner at a point, the line across one leg runs down the other
        // leg and reads that leg's grade as cross-fall — measured, a 10%
        // climb on Cullen read as a road draped 12% sideways.
        // Only near the corner, though: an authored road drawn as 150-300 m
        // straights with a 37-degree turn at every point (the mountain pass)
        // had every segment called a corner end to end, and nothing measured.
        const hdg = (i) => Math.atan2(p[i][0] - p[i - 1][0], -(p[i][1] - p[i - 1][1])) / DEG;
        const turnsAtStart = j > 1 && Math.abs(wrap180(hdg(j) - hdg(j - 1))) > 25;
        const turnsAtEnd = j < p.length - 1 && Math.abs(wrap180(hdg(j + 1) - hdg(j))) > 25;
        const CORNER_M = 20;
        for (let s = 0; s < len; s += 6) {
          const corner = (turnsAtStart && s < CORNER_M) || (turnsAtEnd && len - s < CORNER_M);
          run += 6;
          if (run % 18) continue;
          const x = sx + (dx * s) / len;
          const z = sz + (dz * s) / len;
          if (Terrain.padWeight && Terrain.padWeight(x, z) > 0.5) continue;
          const yr = hitY(mesh, x, z);
          const yt = hitY(terr, x, z);
          if (yr == null || yt == null) continue;
          samples++;
          const gap = yr - yt;
          gaps.push(gap);
          if (gap < 0.005) hidden++;
          // Anything of the map's own dressing (the crop patches) lying over
          // the tarmac hides it just as surely as grass does.
          if (feats) {
            ray.set(from.set(x, yr + 20, z), down);
            ray.far = 19.99;
            if (ray.intersectObject(feats, true).length) {
              covered++;
              hidden++;
            }
          }
          let lip = 0;
          for (const sd of [-1, 1]) {
            const ex2 = x + ux * edge * sd;
            const ez2 = z + uz * edge * sd;
            const ye = hitY(mesh, ex2, ez2);
            const yg = hitY(terr, ex2, ez2);
            if (ye != null && yg != null) lip = Math.max(lip, ye - yg);
          }
          lips.push(lip);
          if (lip > 0.35) floating++;
          const yl = corner ? null : hitY(mesh, x - ux * lane, z - uz * lane);
          const yq = corner ? null : hitY(mesh, x + ux * lane, z + uz * lane);
          if (yl != null && yq != null) {
            const fall = Math.abs(yl - yq) / (2 * lane);
            falls.push(fall);
            if (fall > 0.08) {
              draped++;
              if (worst.length < 4) worst.push(`${Math.round(x)},${Math.round(z)} ${(100 * fall).toFixed(0)}%`);
            }
          }
        }
      }
    }
    widths.sort((a, b) => a - b);
    const pct = (arr, q) => {
      if (!arr.length) return NaN;
      const s = arr.slice().sort((a, b) => a - b);
      return s[Math.floor(q * (s.length - 1))];
    };
    // Junctions: where roads meet, the tarmac covers the join.
    const ends = new Map();
    for (const rd of L) {
      for (const pt of [rd.path[0], rd.path[rd.path.length - 1]]) {
        const key = `${Math.round(pt[0] / 8)},${Math.round(pt[1] / 8)}`;
        const e = ends.get(key) || { x: pt[0], z: pt[1], n: 0 };
        e.n++;
        ends.set(key, e);
      }
    }
    let joins = 0;
    let holes = 0;
    for (const e of ends.values()) {
      if (e.n < 2) continue;
      joins++;
      const rad = Math.max(2, drawnHalf(L[0]) - 1);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const x = e.x + Math.cos(a) * rad;
        const z = e.z + Math.sin(a) * rad;
        // Where a road ends ON the apron, the apron is the junction.
        if (Terrain.isPaved && Terrain.padWeight && Terrain.padWeight(x, z) > 0.9 && Terrain.isPaved(x, z)) continue;
        if (hitY(mesh, x, z) == null) holes++;
      }
    }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    return {
      widths,
      wMid: widths[Math.floor(widths.length / 2)] || 0,
      samples,
      hidden,
      floating,
      draped,
      groundOk: samples > 50 && (hidden + floating) / samples <= 0.02,
      groundSays:
        `${samples} points: ${hidden} with grass over the tarmac (${covered} of them under a crop patch), ${floating} with the road's edge more than 35 cm clear of the grass; `
        + `centreline 5th/50th/95th percentile ${pct(gaps, 0.05).toFixed(2)} / ${pct(gaps, 0.5).toFixed(2)} / ${pct(gaps, 0.95).toFixed(2)} m above the grass, `
        + `edge 95th percentile ${pct(lips, 0.95).toFixed(2)} m`,
      levelOk: falls.length > 50 && draped / falls.length <= 0.02,
      falls: falls.length,
      levelSays:
        `${draped} of ${falls.length} points fall more than 8% across the tarmac`
        + `${worst.length ? ` (${worst.join('; ')})` : ''}; `
        + `cross-fall 50th/95th/max ${(100 * pct(falls, 0.5)).toFixed(1)} / ${(100 * pct(falls, 0.95)).toFixed(1)} / ${(100 * pct(falls, 1)).toFixed(1)}%`,
      paint: mats.filter((m) => m && m.userData && m.userData.paint).length,
      lines: mesh.userData && mesh.userData.markings,
      joins,
      holes,
    };
  }

  async function freshDrive(opts2) {
    releaseAll();
    sim.quitToMenu();
    sim.switchGame('car');
    await sim.startDrive('car', opts2);
  }

  try {
    /*
     * The car game's own island, checked the way a child meets it. Skipped
     * with { home: false } when a run is only for { allMaps: [...] } — the
     * all-islands pass is long enough on its own that it is run a map or two
     * at a time (an hour of it in one go ran out of the harness's clock).
     */
    if (opts.home !== false) {
      /* ======================================================= job board == */
      /*
       * The way a child finds the jobs: Car on the switcher, then the Jobs
       * card, with whatever island the menu happens to have loaded (Kestrel,
       * the aeroplane's). Every card is compared with the board graded on
       * the van's own island, loaded — which is where "Take this job" goes.
       * Once before any drive, and once after one and back to the menu.
       */
      say('job board');
      {
        const Jobs = await import('../../src/game/jobs.js');
        const openJobs = () => {
          releaseAll();
          sim.quitToMenu();
          sim.switchGame('car');
          const card = sim.menus.screens.main && sim.menus.screens.main.querySelector('[data-act="missions"]');
          if (card) card.click();
          else sim.menus.show('missions');
        };
        const readBoard = () => {
          const out = {};
          const sc = sim.menus.screens.missions;
          if (!sc) return out;
          for (const c of sc.querySelectorAll('[data-mission]')) {
            const btn = c.querySelector('[data-start]');
            const why = c.querySelector('[data-job-why]');
            out[c.dataset.mission] = { on: !!btn && !btn.disabled, note: why && !why.hidden ? why.textContent : '' };
          }
          return out;
        };
        openJobs();
        const menuIsland = Terrain.MAP.id;
        const first = readBoard();
        await freshDrive();
        const vans = Terrain.MAP.id;
        const truth = Jobs.jobsFor(sim);
        openJobs();
        const again = readBoard();
        const wrong = (board, notes) =>
          truth
            .filter((e) => {
              const c = board[e.job.id];
              if (!c || c.on !== e.available) return true;
              // A length that is not this island's is wrong; no length is not.
              return notes && e.available && c.note !== e.note && c.note !== '';
            })
            .map((e) => {
              const c = board[e.job.id];
              return `${e.job.id} ${c ? (c.on ? 'open' : 'greyed') : 'missing'}${c && c.note ? ` "${c.note}"` : ''}, on ${vans} it is ${e.available ? `open "${e.note}"` : `off (${e.why})`}`;
            });
        const w1 = wrong(first, true);
        r.ok(
          'job board, first thing from the menu: open exactly where the van\'s island has the job',
          truth.length > 0 && w1.length === 0,
          `menu on ${menuIsland}, van on ${vans}: ${w1.join('; ') || truth.map((e) => `${e.job.id} ${first[e.job.id] && first[e.job.id].on ? 'open' : 'greyed'}`).join(', ')}`
        );
        const w2 = truth.filter((e) => {
          const c = again[e.job.id];
          return !c || c.on !== e.available || (e.available && c.note !== e.note);
        });
        r.ok(
          'job board, after a drive: the van\'s island\'s jobs and lengths',
          truth.length > 0 && w2.length === 0,
          `menu back on ${Terrain.MAP.id}: ${w2.length ? wrong(again, true).join('; ') || w2.map((e) => `${e.job.id} "${(again[e.job.id] || {}).note}" against "${e.note}"`).join('; ') : truth.map((e) => `${e.job.id} ${e.available ? `"${e.note}"` : 'off'}`).join(', ')}`
        );
      }

      /* ============================================================ start == */
      say('free drive');
      await freshDrive();
      const v0 = sim.vehicle;

      // ---- the first frame, before a single update has run ----
      {
        const c = sim.camera.position;
        const dx = v0.pos.x - c.x;
        const dz = v0.pos.z - c.z;
        const dist = Math.hypot(dx, dz);
        const behind = (Math.sin(v0.heading * DEG) * dx - Math.cos(v0.heading * DEG) * dz) / Math.max(dist, 1e-3);
        const fwd = new THREE.Vector3();
        sim.camera.getWorldDirection(fwd);
        const toVan = new THREE.Vector3(v0.pos.x - c.x, v0.pos.y + 1 - c.y, v0.pos.z - c.z).normalize();
        const offAxis = Math.acos(Math.max(-1, Math.min(1, fwd.dot(toVan)))) / DEG;
        const clear = c.y - Terrain.heightAt(c.x, c.z);
        r.ok(
          'first frame: the camera is behind the van, looking at it',
          dist > 4 && dist < 22 && behind > 0.8 && offAxis < 20 && clear > 1,
          `${dist.toFixed(1)} m away, behind-ness ${behind.toFixed(2)}, van ${offAxis.toFixed(0)}° off the middle of the screen, ${clear.toFixed(1)} m above the ground`
        );
        /*
         * ...and the panel and the map on that frame are the van's. The
         * reviewer read HEADING 090 over a van facing 182, and the
         * aeroplane's arrow on the minimap, until the first update.
         */
        const shownHdg = sim.hud.hdgValue ? sim.hud.hdgValue.textContent : '';
        const wantHdg = String(Math.round(v0.heading)).padStart(3, '0');
        const mm = sim.minimap;
        const mmMode = mm && mm.visible ? mm.mode : 'hidden';
        r.ok(
          'first frame: the panel and the map are the van\'s',
          shownHdg === wantHdg && (mmMode === 'car' || mmMode === 'hidden'),
          `HEADING reads "${shownHdg}" over a van facing ${wantHdg}; the minimap is showing the ${mmMode} chart`
        );
      }

      // ---- HUD: the van's, not the aeroplane's ----
      sim.step(1 / 60);
      {
        const hud = sim.hud;
        const leaks = [];
        const aero = [
          ['POWER bar', hud.throttleBar && hud.throttleBar.root],
          ['FUEL bar', hud.fuelBar && hud.fuelBar.root],
          ['BRAKES chip', hud.brakeChip],
          ['EASY MODE chip', hud.modeChip],
          ['GEAR chip', hud.gearChip],
          ['FLAPS chip', hud.flapChip],
          ['TRIM chip', hud.trimChip],
          ['AUTOPILOT chip', hud.apChip],
          ['wind rose', hud.windRose],
          ['wind words', hud.windText],
        ];
        for (const [name, node] of aero) if (visibleEl(node)) leaks.push(name);
        const hint = sim.hud.wrap.querySelector('.hud-keyhint');
        const hintText = hint && visibleEl(hint) ? hint.textContent : '';
        if (/power/i.test(hintText)) leaks.push(`key hint "${hintText}"`);
        if (hintText && !/ctrl/i.test(hintText)) leaks.push(`key hint never says Ctrl is the brake: "${hintText}"`);
        // The ⋯ tray, opened: Guidance, Autopilot, Brace for impact and "Back
        // to the airfield" are the aeroplane's.
        if (hud.tray && typeof hud.setTrayOpen === 'function') {
          hud.setTrayOpen(true);
          for (const b of hud.tray.querySelectorAll('button')) {
            const words = b.textContent.trim();
            if (getComputedStyle(b).display !== 'none' && /autopilot|brace|airfield|guidance/i.test(words)) leaks.push(`"${words}" in the ⋯ tray`);
          }
          hud.setTrayOpen(false);
        }
        r.ok('hud: no aeroplane rows in the van', leaks.length === 0, leaks.join(', ') || 'speed, surface, trip, heading and the van keys only');
      }
      // A plug-in that keeps last frame's readouts to compare with this
      // frame's must not see them change under it (the first pass handed
      // every caller the same object, refilled).
      {
        const a = sim.vehicle.readouts();
        const kA = a.speedKph;
        press('go', true);
        sim.step(1 / 30);
        press('go', false);
        const b = sim.vehicle.readouts();
        r.ok(
          'the van\'s readouts are the caller\'s to keep',
          a !== b && a.speedKph === kA && typeof b.speedKph === 'number',
          a === b ? 'two calls returned the same object' : `last frame's copy still says ${kA.toFixed(1)} km/h; this frame's says ${b.speedKph.toFixed(1)}`
        );
      }

      // ---- where it starts ----
      {
        const v = sim.vehicle;
        const n = nearestRoad(v.pos.x, v.pos.z);
        const along = n ? Math.min(Math.abs(wrap180(n.heading - v.heading)), Math.abs(wrap180(n.heading + 180 - v.heading))) : 999;
        // And the road keeps going that way: 60 m ahead is still road.
        const ax = v.pos.x + Math.sin(v.heading * DEG) * 60;
        const az = v.pos.z - Math.cos(v.heading * DEG) * 60;
        const ahead = onTarmacDrawn(ax, az);
        r.ok(
          'start: on the road, pointing along it',
          !!n && n.d <= drawnHalf(n.rd) && along < 15 && ahead,
          n ? `${n.d.toFixed(1)} m off the centreline, ${along.toFixed(0)}° from the road's direction, 60 m ahead is ${ahead ? 'road' : 'grass'}` : 'no road'
        );
        // Free drive has somewhere to go, and the arrow does not open with
        // "turn around" at a child who has not touched a key yet.
        const chev = sim.driveHud && sim.driveHud.chev;
        const says = chev && !chev.hidden ? chev.textContent : '';
        r.ok(
          'free drive: the first arrow points up the road, not back',
          !!says && !/turn around/i.test(says),
          says ? `the arrow says "${says}"; ${sim.hud.objectiveText.textContent}` : 'no arrow at all'
        );
        // The tyres on the tarmac: the model's lowest point against the road
        // as drawn under the van, parked. Half a second parked first: the
        // suspension settles over a few frames.
        sim.step(0.5);
        const gap = tyreGap();
        r.ok(
          'the van sits on the road: tyres on the tarmac, not above it or in it',
          gap != null && Math.abs(gap) <= 0.03,
          gap == null ? 'no van model' : `lowest point of the van ${(Math.abs(gap) * 100).toFixed(1)} cm ${gap >= 0 ? 'above' : 'below'} the tarmac under it`
        );
      }

      // ---- H: the keys card is the van's ----
      {
        press('help', true);
        sim.step(1 / 60);
        press('help', false);
        const card = sim.hud.controlsCard;
        const text = card && visibleEl(card) ? card.textContent : '';
        press('help', true);
        sim.step(1 / 60);
        press('help', false);
        const closed = !card || !visibleEl(card);
        const aero = /pitch|roll|rudder|flaps|landing gear|autopilot|throttle|power/i.exec(text);
        r.ok(
          'H in the van shows the van\'s keys, and H again puts them away',
          !!text && !aero && /brake/i.test(text) && /handbrake/i.test(text) && closed,
          text ? `${aero ? `it lists "${aero[0]}" — an aeroplane key; ` : ''}${closed ? 'closed again' : 'did not close'}: "${text.slice(0, 120)}…"` : 'nothing came up'
        );
      }

      // ---- the other ways a child drives: WASD, and the arrows ----
      {
        // A fresh handle each time: freshDrive() builds a new van, and the
        // old one is no longer stepped.
        const tryKeys = (goKey, leftKey, stopKey) => {
          const v = sim.vehicle;
          const h0 = v.heading;
          drive(3, () => press(goKey, true));
          const fast = kph(v);
          drive(1, () => { press(goKey, true); press(leftKey, true); });
          const turned = wrap180(v.heading - h0);
          releaseAll();
          let backed = 0;
          drive(5, () => { press(stopKey, true); backed = Math.min(backed, v.speed); });
          releaseAll();
          return { fast, turned, backed: -backed * 3.6 };
        };
        const wasd = tryKeys('w', 'left', 's');
        await freshDrive();
        const arrows = tryKeys('up', 'arrowLeft', 'down');
        const ok = (q) => q.fast >= 30 && q.turned < -8 && q.backed >= 5;
        r.ok(
          'W A S D and the arrow keys drive it too',
          ok(wasd) && ok(arrows),
          [['WASD', wasd], ['arrows', arrows]]
            .map(([k, q]) => `${k}: ${q.fast.toFixed(0)} km/h after 3 s, ${Math.abs(q.turned).toFixed(0)}° ${q.turned < 0 ? 'left' : 'right'} in a second of steering, reversing at ${q.backed.toFixed(0)} km/h`)
            .join('; ')
        );
        await freshDrive();
      }

      // ---- a child's very first thing: hold Shift and touch nothing else ----
      {
        const v = sim.vehicle;
        const before = said.length;
        let onRoad = 0;
        let n = 0;
        drive(12, () => {
          press('go', true);
          n++;
          if (onTarmacDrawn(v.pos.x, v.pos.z)) onRoad++;
        });
        releaseAll();
        const found = said.slice(before).filter((s) => /found/i.test(s.msg));
        r.ok(
          'only car things: holding Shift for 12 s finds nothing by accident',
          found.length === 0,
          `${found.map((s) => `"${s.msg}"`).join(' | ') || 'no discovery popped up'}; `
            + `${Math.round((100 * onRoad) / n)}% of those 12 s on the tarmac with no steering at all`
        );
        /*
         * ...and the arrow and its words say the same thing. On Drover's
         * Flat the van runs off where the road bends at 10-11 s; keep
         * holding Shift another eight and read the chevron every frame:
         * pointing 40° or more one way while the words say STRAIGHT ON, or
         * name the other side, is two instructions at once.
         */
        const chev = sim.driveHud && sim.driveHud.chev;
        const arrowEl = sim.driveHud && sim.driveHud.chevArrow;
        let shown = 0;
        let clash = 0;
        let steered = 0;
        let example = '';
        drive(8, () => {
          press('go', true);
          if (!chev || chev.hidden || !arrowEl) return;
          shown++;
          const m = /rotate\((-?[\d.]+)deg\)/.exec(arrowEl.style.transform || '');
          const rot = m ? parseFloat(m[1]) : 0;
          const words = (sim.driveHud.chevWhat && sim.driveHud.chevWhat.textContent) || chev.textContent;
          if (Math.abs(rot) >= 40) {
            steered++;
            const other = rot < 0 ? /RIGHT/i : /LEFT/i;
            if (/STRAIGHT/i.test(words) || other.test(words)) {
              clash++;
              if (!example) example = `"${words}" with the arrow at ${rot}°`;
            }
          }
        });
        releaseAll();
        r.ok(
          'the arrow and its words agree',
          shown > 0 && clash === 0,
          shown === 0
            ? 'no arrow on screen in free drive'
            : `${shown} frames with the arrow up, ${steered} of them pointing 40° or more off the nose, ${clash} saying something else${example ? ` (${example})` : ''}`
        );
        await freshDrive();
      }

      // ---- hold go for ten seconds, steering to stay on the road ----
      {
        const v = sim.vehicle;
        let t50 = null;
        let maxLift = 0;
        let onRoad = 0;
        let n = 0;
        drive(10, (t) => {
          press('go', true);
          steerKeys(laneKeepSteer(v));
          if (t50 == null && kph(v) >= 50) t50 = t;
          const g = groundUnder(v.pos.x, v.pos.z);
          maxLift = Math.max(maxLift, v.pos.y - g - (v.spec.rideHeight || 0));
          n++;
          if (onTarmacDrawn(v.pos.x, v.pos.z)) onRoad++;
        });
        const v10 = kph(v);
        releaseAll();
        r.ok(
          'hold go 10 s: brisk, and still on the road',
          t50 != null && t50 <= 3.3 && v10 >= 80 && onRoad / n >= 0.9 && maxLift < 0.8,
          `50 km/h at ${t50 == null ? 'never' : t50.toFixed(1) + ' s'}, ${v10.toFixed(0)} km/h at 10 s, `
            + `${Math.round((100 * onRoad) / n)}% of it on the drawn tarmac, highest wheel lift ${maxLift.toFixed(2)} m`
        );

        // ---- let go of everything ----
        const from = kph(v);
        const p0 = v.pos.clone();
        let stopT = null;
        drive(30, (t) => {
          if (stopT == null && Math.abs(v.speed) < 0.05) stopT = t;
          if (stopT != null && t > stopT + 5) return false;
        });
        const run = Math.hypot(v.pos.x - p0.x, v.pos.z - p0.z);
        const parked = v.pos.clone();
        drive(5);
        const creep = Math.hypot(v.pos.x - parked.x, v.pos.z - parked.z);
        r.ok(
          'let go of everything: it rolls to a stop and stays there',
          stopT != null && stopT <= 16 && run > 25 && creep < 0.3,
          `from ${from.toFixed(0)} km/h: stopped after ${stopT == null ? 'never' : stopT.toFixed(1) + ' s'} and ${run.toFixed(0)} m, then crept ${creep.toFixed(2)} m in five seconds`
        );
      }

      /* =========================================================== on grass == */
      say('grass');
      const grass = findGrass(900, 400);
      let grassTop = null;
      let tarmacTop = null;
      if (grass) {
        await freshDrive();
        const v = sim.vehicle;
        v.reset({ pos: new THREE.Vector3(grass.x, grass.y, grass.z), headingDeg: 90 });
        sim.step(0.5);
        // Parked on the grass: the tyres on it, not hovering over it.
        const grassGap = tyreGap();
        r.ok(
          'on the grass the tyres are on the grass',
          grassGap != null && Math.abs(grassGap) <= 0.03,
          grassGap == null ? 'no van model' : `lowest point of the van ${(Math.abs(grassGap) * 100).toFixed(1)} cm ${grassGap >= 0 ? 'above' : 'below'} the grass under it`
        );
        let maxLift = 0;
        drive(10, () => {
          press('go', true);
          const g = groundUnder(v.pos.x, v.pos.z);
          maxLift = Math.max(maxLift, v.pos.y - g - (v.spec.rideHeight || 0));
        });
        grassTop = kph(v);
        const surf = v.surface ? v.surface.kind : '?';
        releaseAll();
        // The same ten seconds on the airfield's runway, which is tarmac on
        // every map, for the comparison.
        await freshDrive();
        const w = sim.vehicle;
        drive(10, () => {
          press('go', true);
          steerKeys(laneKeepSteer(w));
        });
        tarmacTop = kph(w);
        releaseAll();
        r.ok(
          'grass is slower than tarmac, but drivable',
          grassTop >= 45 && grassTop <= 0.85 * tarmacTop && maxLift < 0.8,
          `10 s of Shift: ${grassTop.toFixed(0)} km/h on ${surf}, ${tarmacTop.toFixed(0)} km/h on the road; highest wheel lift on the grass ${maxLift.toFixed(2)} m`
        );
      } else {
        r.ok('grass is slower than tarmac, but drivable', false, 'could not find a flat run of grass on this island');
      }

      /*
       * Off the road the van sits on the grass that is DRAWN. The drawn grass
       * is the terrain mesh, heightAt sampled every 25-39 m; between samples
       * heightAt can stand metres above it (a corridor's edge, a flat's lip).
       * Find the thirty off-road spots within 1.5 km of the start where it
       * stands highest, park the van on each, let it settle, and measure the
       * gap from its wheels to the drawn grass. A van hovering over the
       * field is the first thing a child driving across one sees.
       */
      say('the grass as drawn');
      {
        await freshDrive();
        const v = sim.vehicle;
        const cx = v.pos.x;
        const cz = v.pos.z;
        const cand = [];
        for (let x = cx - 1500; x <= cx + 1500; x += 20) {
          for (let z = cz - 1500; z <= cz + 1500; z += 20) {
            if (Math.hypot(x - cx, z - cz) > 1500) continue;
            const h = Terrain.heightAt(x, z);
            if (h < 2) continue;
            const g = groundUnder(x, z);
            if (h - g < 0.3) continue;
            // Somewhere a van can stand: the drawn grass under 20% across 6 m
            // each way. On a bank it rolls, and a rolling van is off the
            // ground for its own reasons.
            const sx = (groundUnder(x + 3, z) - groundUnder(x - 3, z)) / 6;
            const sz = (groundUnder(x, z + 3) - groundUnder(x, z - 3)) / 6;
            if (Math.hypot(sx, sz) > 0.2) continue;
            cand.push({ x, z, gap: h - g, h });
          }
        }
        cand.sort((a, b) => b.gap - a.gap);
        let worst = 0;
        let worstAt = '';
        let parked = 0;
        for (const p of cand) {
          if (parked >= 30) break;
          const n = nearestRoad(p.x, p.z);
          if (n && n.d < drawnHalf(n.rd) + (Roads.VERGE || 2) + 6) continue;
          if (Terrain.obstacleAt(p.x, p.h + 1, p.z)) continue;
          v.reset({ pos: new THREE.Vector3(p.x, p.h, p.z), headingDeg: 90 });
          // Parked means parked: the handbrake on while it settles.
          press('hand', true);
          sim.step(0.5);
          press('hand', false);
          parked++;
          // The lowest tyre against the grass under it, as for the parked
          // checks above: these spots are creases in the drawn ground, and
          // the middle of the van is not where its wheels are.
          const lift = tyreGap();
          if (lift == null) continue;
          if (Math.abs(lift) > Math.abs(worst)) {
            worst = lift;
            worstAt = `${Math.round(v.pos.x)},${Math.round(v.pos.z)} (heightAt ${p.gap.toFixed(1)} m over the grass there)`;
          }
        }
        r.ok(
          'off the road the van sits on the grass it is drawn on',
          parked > 0 && Math.abs(worst) <= 0.15,
          parked
            ? `${cand.length} off-road spots, under 20% steep, where heightAt is 30 cm or more above the drawn grass; parked on the worst ${parked}: `
              + `wheels ${Math.abs(worst).toFixed(2)} m ${worst >= 0 ? 'above' : 'below'} the grass at worst${worstAt ? `, at ${worstAt}` : ''}`
            : 'nowhere to measure'
        );
      }

      /* ========================================================== steering == */
      say('steering');
      if (grass) {
        // ---- a full circle, holding D, keeping the speed around 40 km/h ----
        // On the runway: the one big flat piece of tarmac every map has, so the
        // circle is about the van and not about the grass (which slides, on
        // purpose — that is what grass is for).
        await freshDrive();
        const v = sim.vehicle;
        const Air = await import('../../src/world/airport.js');
        const rw = Air.RUNWAY;
        const hdg = rw && rw.headingDeg != null ? rw.headingDeg : 90;
        const c0 = rw && rw.thresholdWest ? rw.thresholdWest : { x: -300, z: 0 };
        // A third of the way down it, ten metres left of the centreline, so a
        // right-hand circle stays on the concrete.
        const sx = c0.x + Math.sin(hdg * DEG) * 250 - Math.cos(hdg * DEG) * 10;
        const sz = c0.z - Math.cos(hdg * DEG) * 250 - Math.sin(hdg * DEG) * 10;
        v.reset({ pos: new THREE.Vector3(sx, Terrain.heightAt(sx, sz), sz), headingDeg: hdg });
        sim.step(0.2);
        drive(6, () => {
          press('go', kph(v) < 40);
          return kph(v) < 40;
        });
        press('go', false);
        let turned = 0;
        let last = v.heading;
        let maxDrift = 0;
        let lean = 0;
        let minV = Infinity;
        let circleT = null;
        let maxLift = 0;
        drive(20, (t) => {
          press('right', true);
          press('go', kph(v) < 36);
          const d = wrap180(v.heading - last);
          last = v.heading;
          turned += d;
          maxDrift = Math.max(maxDrift, Math.abs(v.drift || 0) / DEG);
          // Outward is left in a right-hand turn: bank is positive for that.
          if (t > 1.5) {
            lean = Math.max(lean, (v.bank || 0) / DEG - (0));
            minV = Math.min(minV, kph(v));
          }
          const g = groundUnder(v.pos.x, v.pos.z);
          maxLift = Math.max(maxLift, v.pos.y - g - (v.spec.rideHeight || 0));
          if (turned >= 360) {
            circleT = t;
            return false;
          }
        });
        const radius = circleT ? (Math.abs(v.speed) * circleT) / (2 * Math.PI) : null;
        // ---- let go of D: the wheel comes back by itself ----
        press('right', false);
        let straightT = null;
        let prevH = v.heading;
        drive(2, (t) => {
          const rate = Math.abs(wrap180(v.heading - prevH)) * 30;
          prevH = v.heading;
          if (t > 0 && straightT == null && rate < 2) straightT = t;
        });
        releaseAll();
        const circleOn = v.surface ? v.surface.kind : '?';
        r.ok(
          'full turn on the keys: a circle, no spin, a little lean',
          circleT != null && circleT <= 11 && maxDrift <= 12 && lean >= 1.5 && lean <= 9 && minV >= 18 && maxLift < 0.6,
          circleT == null
            ? `only ${turned.toFixed(0)}° in 20 s`
            : `on ${circleOn}: 360° in ${circleT.toFixed(1)} s (radius about ${radius.toFixed(0)} m), slowest ${minV.toFixed(0)} km/h, `
              + `drift ${maxDrift.toFixed(1)}°, body lean ${lean.toFixed(1)}° outwards`
        );
        r.ok(
          'let go of the steering: it straightens up by itself',
          straightT != null && straightT <= 0.6,
          straightT == null ? 'still turning after two seconds' : `turning under 2°/s ${straightT.toFixed(2)} s after letting go of D`
        );

        /*
         * ---- W and D held together, flat out, from standing ----
         * What a child does to "do a donut". Measured by the reviewer on the
         * first pass: a 43 m circle taking 24.6 s, because at full power the
         * van ran up to the speed where full lock is a big circle. With the
         * stability control (surface.js) it slows to where the tyres can take
         * a tight one.
         */
        {
          await freshDrive();
          const w = sim.vehicle;
          w.reset({ pos: new THREE.Vector3(sx, Terrain.heightAt(sx, sz), sz), headingDeg: hdg });
          sim.step(0.2);
          let turned2 = 0;
          let last2 = w.heading;
          let fullT = null;
          let top = 0;
          let quarterT = null;
          drive(30, (t) => {
            press('w', true);
            press('right', true);
            turned2 += wrap180(w.heading - last2);
            last2 = w.heading;
            top = Math.max(top, kph(w));
            if (quarterT == null && turned2 >= 90) quarterT = t;
            if (turned2 >= 450) {
              fullT = t - quarterT;
              return false;
            }
          });
          const circleKph = kph(w);
          releaseAll();
          const rad2 = fullT ? (Math.abs(w.speed) * fullT) / (2 * Math.PI) : null;
          r.ok(
            'W and D held together, flat out: a tight circle, not a lap',
            fullT != null && fullT <= 12,
            fullT == null
              ? `only ${turned2.toFixed(0)}° in 30 s`
              : `once round in ${fullT.toFixed(1)} s (after the first quarter), at about ${circleKph.toFixed(0)} km/h (fastest ${top.toFixed(0)}), radius about ${rad2.toFixed(0)} m`
          );
        }

        // ---- speed-sensitive: calm when fast ----
        // On the road the van starts on, up to motorway pace, then full lock.
        await freshDrive();
        const u = sim.vehicle;
        drive(12, () => {
          press('go', kph(u) < 82);
          steerKeys(laneKeepSteer(u));
        });
        press('go', false);
        releaseAll();
        const fastV = kph(u);
        const h0 = u.heading;
        let spin = 0;
        let latG = 0;
        let sumV = 0;
        let nV = 0;
        drive(1.5, () => {
          press('right', true);
          spin = Math.max(spin, Math.abs(u.drift || 0) / DEG);
          latG = Math.max(latG, Math.abs(u.latAccel || 0) / 9.81);
          sumV += Math.abs(u.speed);
          nV++;
        });
        const fastRate = Math.abs(wrap180(u.heading - h0)) / 1.5;
        /*
         * The radius at the speed it was actually doing. This took the speed
         * at the END over the rate across the whole 1.5 s, which was right
         * while the van held its speed through full lock; with the stability
         * control (surface.js) it slows into the turn, and a van that has
         * slowed turns tighter, as it should. What "flicked into a spin"
         * means is the tyres asked for more than they have: more than 0.9 g
         * sideways, or the tail out past 12 degrees.
         */
        const vAvg = sumV / Math.max(nV, 1);
        const fastR = vAvg / Math.max(fastRate * DEG, 1e-3);
        const endV = kph(u);
        releaseAll();
        r.ok(
          'fast: full lock does not flick it into a spin',
          latG <= 0.9 && spin <= 12 && fastR >= 25,
          `at ${fastV.toFixed(0)} km/h, 1.5 s of D: ${fastRate.toFixed(0)}°/s at ${(vAvg * 3.6).toFixed(0)} km/h on average (down to ${endV.toFixed(0)}), radius ${fastR.toFixed(0)} m, `
            + `${latG.toFixed(2)} g sideways at most, drift ${spin.toFixed(1)}°`
        );
      }

      /* ============================================== brakes, then reverse == */
      say('brakes and reverse');
      {
        await freshDrive();
        const v = sim.vehicle;
        drive(8, () => {
          press('go', kph(v) < 50);
          steerKeys(laneKeepSteer(v));
          if (kph(v) >= 50) return false;
        });
        releaseAll();
        const from = kph(v);
        const p0 = v.pos.clone();
        let stopAt = null;
        let reverseV = 0;
        let sawR = false;
        drive(6, (t) => {
          press('stop', true);
          if (stopAt == null && Math.abs(v.speed) < 0.3) stopAt = { t, d: Math.hypot(v.pos.x - p0.x, v.pos.z - p0.z) };
          reverseV = Math.min(reverseV, v.speed);
          const texts = Array.from(sim.hud.wrap.querySelectorAll('*'))
            .filter((n) => n.children.length === 0 && visibleEl(n))
            .map((n) => n.textContent.trim());
          if (texts.some((s) => s === 'R' || /revers/i.test(s))) sawR = true;
        });
        press('stop', false);
        let forwardAgain = null;
        drive(3, (t) => {
          press('go', true);
          if (forwardAgain == null && v.speed > 1) forwardAgain = t;
        });
        releaseAll();
        r.ok(
          'brake stops it, holding the brake backs it up',
          stopAt != null && stopAt.d <= 25 && reverseV <= -1.5 && forwardAgain != null && forwardAgain <= 2,
          `from ${from.toFixed(0)} km/h: stopped in ${stopAt ? stopAt.d.toFixed(1) + ' m' : 'never'}, `
            + `reversing at ${(-reverseV * 3.6).toFixed(0)} km/h, forwards again ${forwardAgain == null ? 'never' : 'after ' + forwardAgain.toFixed(1) + ' s'}`
        );
        r.ok('the HUD says when you are in reverse', sawR, sawR ? 'R shown while backing up' : 'nothing on screen says reverse');
      }

      // ---- Space, the key the hint calls the handbrake, stops it too ----
      {
        await freshDrive();
        const v = sim.vehicle;
        drive(8, () => {
          press('go', kph(v) < 50);
          steerKeys(laneKeepSteer(v));
          if (kph(v) >= 50) return false;
        });
        releaseAll();
        const from = kph(v);
        const p0 = v.pos.clone();
        let stopAt = null;
        drive(6, (t) => {
          press('hand', true);
          steerKeys(laneKeepSteer(v));
          if (stopAt == null && Math.abs(v.speed) < 0.3) stopAt = { t, d: Math.hypot(v.pos.x - p0.x, v.pos.z - p0.z) };
        });
        const after = kph(v);
        releaseAll();
        r.ok(
          'the handbrake on its own stops it',
          stopAt != null && stopAt.t <= 4 && stopAt.d <= 35,
          stopAt
            ? `from ${from.toFixed(0)} km/h: stopped in ${stopAt.t.toFixed(1)} s and ${stopAt.d.toFixed(1)} m holding Space`
            : `from ${from.toFixed(0)} km/h: still doing ${after.toFixed(0)} km/h after six seconds of Space`
        );
      }

      /* =============================================================== trees == */
      say('trees');
      {
        await freshDrive();
        const v = sim.vehicle;
        const trees = Terrain.OBSTACLES.filter((o) => /tree/i.test(o.what || ''));
        let tree = null;
        for (const o of trees) {
          const cx = (o.x0 + o.x1) / 2;
          const cz = (o.z0 + o.z1) / 2;
          const sx = cx - 30;
          const h0 = Terrain.heightAt(sx, cz);
          if (h0 < 5) continue;
          let clearRun = true;
          for (let d = 0; d < 26; d += 2) {
            if (Terrain.obstacleAt(sx + d, Terrain.heightAt(sx + d, cz) + 1, cz)) clearRun = false;
            if (Math.abs(Terrain.heightAt(sx + d, cz) - h0) > 3) clearRun = false;
          }
          if (clearRun) { tree = { cx, cz, o, sx, h0 }; break; }
        }
        if (tree) {
          v.reset({ pos: new THREE.Vector3(tree.sx, tree.h0, tree.cz), headingDeg: 90 });
          sim.step(0.2);
          const before = said.length;
          let through = false;
          let maxLift = 0;
          let maxV = 0;
          drive(8, () => {
            press('go', true);
            maxV = Math.max(maxV, kph(v));
            if (v.pos.x > tree.o.x1 + 1.5) through = true;
            const g = groundUnder(v.pos.x, v.pos.z);
            maxLift = Math.max(maxLift, v.pos.y - g - (v.spec.rideHeight || 0));
          });
          releaseAll();
          const words = said.slice(before).map((s) => s.msg);
          const flew = words.filter((w) => /flew|fly/i.test(w));
          r.ok(
            'a tree stops you, without launching you',
            !through && maxLift < 0.6 && flew.length === 0 && words.some((w) => /tree/i.test(w)),
            `${through ? 'drove straight through it' : 'stopped at it'} (${maxV.toFixed(0)} km/h at the most), `
              + `highest wheel lift ${maxLift.toFixed(2)} m, it said: ${words.join(' | ') || 'nothing'}`
          );
        } else {
          r.ok('a tree stops you, without launching you', false, 'no tree with a clear run-up on this island');
        }

        /*
         * ---- pinned on a tree, W and a steering key get you off it ----
         * The second review: head-on into six Drover's Flat trees, in three
         * of them 4 s of W and a steering key did nothing, and the
         * arrow-following kid held W and A against one for 30 s and moved
         * 0 m. Measured over 60 head-on hits from four sides before this
         * was fixed: W and A got 3 m clear in 52, W and D in 45, and in 7
         * neither did. Here: the first eight trees the van ends up pinned
         * on (BLOCKED on the screen), W and A for 4 s, and W and D for 4 s,
         * each from a fresh run-up.
         */
        {
          const sides = [[90, -1, 0], [270, 1, 0], [0, 0, 1], [180, 0, -1]];
          const rows = [];
          let off = 0;
          let offA = 0;
          for (const o of trees) {
            if (rows.length >= 8) break;
            const cx = (o.x0 + o.x1) / 2;
            const cz = (o.z0 + o.z1) / 2;
            for (const [hd, ox, oz] of sides) {
              if (rows.length >= 8) break;
              const sx = cx + ox * 30;
              const sz = cz + oz * 30;
              const h0 = Terrain.heightAt(sx, sz);
              if (h0 < 5) continue;
              let clearRun = true;
              for (let d = 2; d < 26 && clearRun; d += 2) {
                const x = sx - ox * d;
                const z = sz - oz * d;
                if (Terrain.obstacleAt(x, Terrain.heightAt(x, z) + 1, z) || Math.abs(Terrain.heightAt(x, z) - h0) > 3) clearRun = false;
              }
              if (!clearRun) continue;
              const got = {};
              for (const key of ['left', 'right']) {
                releaseAll();
                v.reset({ pos: new THREE.Vector3(sx, h0, sz), headingDeg: hd });
                sim.step(0.2);
                let pinned = false;
                drive(6, () => {
                  press('go', true);
                  if (sim.driveHud && !sim.driveHud.chev.hidden && sim.driveHud.chevWhat.textContent === 'BLOCKED') {
                    pinned = true;
                    return false;
                  }
                  return true;
                });
                if (!pinned) break;
                const x0 = v.pos.x;
                const z0 = v.pos.z;
                drive(4, () => {
                  press('go', true);
                  press(key, true);
                  return true;
                });
                got[key] = Math.hypot(v.pos.x - x0, v.pos.z - z0);
              }
              releaseAll();
              if (got.left == null || got.right == null) continue;
              if (got.left > 3) offA++;
              if (got.left > 3 || got.right > 3) off++;
              rows.push(`${Math.round(cx)},${Math.round(cz)} from ${hd}°: W+A ${got.left.toFixed(1)} m, W+D ${got.right.toFixed(1)} m`);
            }
          }
          r.ok(
            'pinned on a tree, W and a steering key get you off it (W and A every time)',
            rows.length >= 4 && offA === rows.length && off === rows.length,
            `${rows.length} trees pinned on: W and A got 3 m clear in ${offA}, one key or the other in ${off} — ${rows.join(' · ')}`
          );
        }

        /*
         * ---- the Wide view does not look at the van through a tree ----
         * The second review: C twice for the Wide view, and a pine filled the
         * whole screen with the van behind it. Six trees, the van parked 10 m
         * and 16 m in front of each facing away from it, a second and a half
         * in the Wide view: is the canopy (the trunk's box grown by one and a
         * half trunk widths, about what scenery.js draws) between the lens
         * and the van's roof?
         */
        {
          const rows = [];
          let hidden = 0;
          const cp = sim.camera.position;
          for (const o of trees) {
            if (rows.length >= 6) break;
            const cx = (o.x0 + o.x1) / 2;
            const cz = (o.z0 + o.z1) / 2;
            const g = (o.x1 - o.x0) * 1.5;
            let clear = Terrain.heightAt(cx + 10, cz) > 3;
            for (let d = 3; d < 46 && clear; d += 2) if (Terrain.obstacleAt(cx + d, Terrain.heightAt(cx + d, cz) + 1, cz)) clear = false;
            if (!clear) continue;
            const row = [];
            for (const dist of [10, 16]) {
              releaseAll();
              v.reset({ pos: new THREE.Vector3(cx + dist, Terrain.heightAt(cx + dist, cz), cz), headingDeg: 90 });
              sim.driveCam.mode = 'far';
              sim.driveCam.started = false;
              sim.step(1.5);
              let inTree = false;
              for (let i = 1; i < 40; i++) {
                const f = i / 40;
                const x = cp.x + (v.pos.x - cp.x) * f;
                const y = cp.y + (v.pos.y + 1.4 - cp.y) * f;
                const z = cp.z + (v.pos.z - cp.z) * f;
                if (x > o.x0 - g && x < o.x1 + g && z > o.z0 - g && z < o.z1 + g && y > o.y0 && y < o.y1 + g) inTree = true;
              }
              if (inTree) hidden++;
              row.push(`${dist} m: lens ${Math.hypot(cp.x - v.pos.x, cp.z - v.pos.z).toFixed(0)} m back${inTree ? ', THROUGH the tree' : ''}`);
            }
            rows.push(`${Math.round(cx)},${Math.round(cz)} (${row.join(', ')})`);
          }
          sim.driveCam.mode = 'chase';
          r.ok(
            'the Wide view does not look at the van through a tree',
            rows.length >= 3 && hidden === 0,
            `${rows.length} trees behind the van: ${hidden} views through the canopy — ${rows.join(' · ')}`
          );
        }

        // ---- and none of them are standing in the road ----
        // Walk every road every 3 m, at the centre and a lane either side, and
        // ask the collision boxes the van itself asks: is anything here?
        const inRoad = new Map();
        for (const rd of roadList()) {
          const p = rd.path;
          const half = drawnHalf(rd) * 0.8;
          for (let k = 1; k < p.length; k++) {
            const ax = p[k - 1][0];
            const az = p[k - 1][1];
            const ex = p[k][0] - ax;
            const ez = p[k][1] - az;
            const len = Math.hypot(ex, ez);
            if (len < 0.1) continue;
            for (let d = 0; d < len; d += 3) {
              for (const o of [-half, 0, half]) {
                const x = ax + (ex * d) / len - (ez / len) * o;
                const z = az + (ez * d) / len + (ex / len) * o;
                const hit = Terrain.obstacleAt(x, Math.max(0, Terrain.heightAt(x, z)) + 1, z);
                if (hit) inRoad.set(hit, `${(hit.what || '').replace(/^You (flew into|hit) /, '')} at ${Math.round(x)},${Math.round(z)}`);
              }
            }
          }
        }
        const list = [...inRoad.values()];
        r.ok('no trees or buildings standing in the road', list.length === 0, list.slice(0, 6).join('; ') + (list.length > 6 ? ` … ${list.length} in all` : '') || 'the tarmac is clear the whole length of every road');
      }

      /* ======================================================= a building == */
      /*
       * Flat out into the side of a building, then do what a child does:
       * keep W down, read the screen, and lean on a steering key. The
       * reviewer's run on the first pass: the van sat half inside a Drover's
       * Flat building (the chase camera saw a wall and no van), and W with a
       * steering key moved it 0 m in 90 s.
       */
      say('a building');
      {
        await freshDrive();
        const v = sim.vehicle;
        const blds = Terrain.OBSTACLES.filter((o) => !/tree/i.test(o.what || '') && o.x1 - o.x0 >= 6 && o.z1 - o.z0 >= 6);
        let b = null;
        for (const o of blds) {
          const cz = (o.z0 + o.z1) / 2;
          const bx = o.x0 - 40;
          const h0 = Terrain.heightAt(bx, cz);
          if (h0 < 3) continue;
          let clear = true;
          for (let d = 0; d < 39 && clear; d += 1.5) {
            const x = bx + d;
            const h = Terrain.heightAt(x, cz);
            for (const dz of [-1.2, 0, 1.2]) if (Terrain.obstacleAt(x, h + 1, cz + dz)) clear = false;
            if (Math.abs(h - h0) > 4 || h < 1) clear = false;
          }
          if (clear) {
            b = { o, cz, bx, h0 };
            break;
          }
        }
        if (b) {
          v.reset({ pos: new THREE.Vector3(b.bx, b.h0, b.cz), headingDeg: 90 });
          sim.step(0.2);
          // How much of the van is in the building: the point 1.2 m ahead of
          // its middle, which is inside the bonnet.
          let inside = 0;
          const inBonnet = () => {
            const h = v.heading * DEG;
            return !!Terrain.obstacleAt(v.pos.x + Math.sin(h) * 1.2, v.pos.y + 1, v.pos.z - Math.cos(h) * 1.2);
          };
          let hitKph = 0;
          let bumpT = null;
          let saidT = null;
          let says = '';
          const bumps0 = v.bumps || 0;
          // Keep W down until the screen says something about it (or 16 s).
          drive(16, (t) => {
            press('w', true);
            if (bumpT == null) hitKph = Math.max(hitKph, kph(v));
            if (inBonnet()) inside++;
            if (bumpT == null && (v.bumps || 0) > bumps0) bumpT = t;
            const chev = sim.driveHud && sim.driveHud.chev;
            const now = chev && !chev.hidden ? chev.textContent : '';
            if (bumpT != null && saidT == null && /BLOCKED/.test(now)) {
              saidT = t;
              says = now;
            }
            if (saidT != null && t > saidT + 0.5) return false;
            if (bumpT != null && saidT == null && t > bumpT + 4) {
              says = now;
              return false;
            }
          });
          const p0 = v.pos.clone();
          let freeT = null;
          let wayOut = '';
          drive(12, (t) => {
            // W, and the steering key the arrow points at (it points the way
            // out while it says BLOCKED).
            const k = chevronKeys();
            if (!wayOut && k.what === 'BLOCKED') wayOut = k.dist;
            press('w', !k.back);
            press('s', k.back);
            press('left', k.steer < 0);
            press('right', k.steer > 0);
            if (inBonnet()) inside++;
            if (freeT == null && Math.hypot(v.pos.x - p0.x, v.pos.z - p0.z) > 10) {
              freeT = t;
              return false;
            }
          });
          releaseAll();
          r.ok(
            'head-on into a building: stopped outside it, BLOCKED on screen, and W with a steering key drives out',
            inside === 0 && /BLOCKED/.test(says) && saidT - bumpT <= 2.5 && freeT != null && freeT <= 8,
            `${(b.o.what || 'building').replace(/^You (flew into|hit) /, '')} at ${Math.round(b.o.x0)},${Math.round(b.cz)}, hit at ${hitKph.toFixed(0)} km/h; `
              + `${inside ? `the bonnet inside it for ${inside} steps` : 'the bonnet never inside it'}; `
              + `${saidT != null ? `${(saidT - bumpT).toFixed(1)} s after the bump, with W still down, the screen said "${says}"` : `the screen said "${says || 'nothing'}"`}; `
              + `then W and the key the arrow pointed at ("${wayOut}"): ${freeT == null ? 'still there after 12 s' : `10 m clear after ${freeT.toFixed(1)} s`}`
          );
        } else {
          r.ok('head-on into a building: stopped outside it, BLOCKED on screen, and W with a steering key drives out', false, 'no building with a clear run-up on this island');
        }
      }

      /* ============================== behind a building, off the road == */
      /*
       * The reviewer's free-drive kid, as near as it can be set up: overshot
       * onto the grass with a building between the van and the road, W held
       * and steering by the arrow. On the first repair the arrow pointed
       * through the wall (the route's first leg is a straight line to the
       * road), the van nosed into it, turned a corner of the bonnet into it
       * with the steering, and burrowed in until its middle reached the wall:
       * measured from behind six Drover's Flat buildings, none of them got
       * back to the road in 90 s. Up to six buildings 20-70 m from a road, the
       * van 22 m the far side of each facing it, free drive, the kid who owns
       * the game: W, the key the arrow leans to, S when it says back up.
       */
      say('behind a building');
      {
        await freshDrive();
        const v = sim.vehicle;
        const cands = [];
        for (const o of Terrain.OBSTACLES) {
          if (cands.length >= 6) break;
          if (/tree/i.test(o.what || '') || o.x1 - o.x0 < 5 || o.z1 - o.z0 < 5 || o.x1 - o.x0 > 60 || o.z1 - o.z0 > 60) continue;
          const cx = (o.x0 + o.x1) / 2;
          const cz = (o.z0 + o.z1) / 2;
          const n = nearestRoad(cx, cz);
          if (!n || n.d > 70 || n.d < 20) continue;
          const p = n.rd.path;
          const ax = p[n.k - 1][0] + (p[n.k][0] - p[n.k - 1][0]) * n.t;
          const az = p[n.k - 1][1] + (p[n.k][1] - p[n.k - 1][1]) * n.t;
          const ux = (cx - ax) / n.d;
          const uz = (cz - az) / n.d;
          const half = Math.max(o.x1 - o.x0, o.z1 - o.z0) / 2;
          const sx = cx + ux * (half + 22);
          const sz = cz + uz * (half + 22);
          const h0 = Terrain.heightAt(sx, sz);
          if (h0 < 2 || Terrain.obstacleAt(sx, h0 + 1, sz)) continue;
          const n2 = nearestRoad(sx, sz);
          if (n2 && n2.d < 30) continue;
          cands.push({ o, sx, sz, h0, hdg: Math.atan2(-ux, uz) / DEG });
        }
        const rows = [];
        let bad = 0;
        for (const c of cands) {
          releaseAll();
          v.reset({ pos: new THREE.Vector3(c.sx, c.h0, c.sz), headingDeg: c.hdg });
          sim.step(0.1);
          let inside = 0;
          let blocked = 0;
          let longest = 0;
          let back = null;
          drive(60, (t) => {
            const k = chevronKeys();
            press('w', !k.back);
            press('s', k.back);
            press('left', k.steer < 0);
            press('right', k.steer > 0);
            blocked = k.what === 'BLOCKED' ? blocked + 1 / 30 : 0;
            longest = Math.max(longest, blocked);
            const h = v.heading * DEG;
            if (Terrain.obstacleAt(v.pos.x + Math.sin(h) * 1.2, v.pos.y + 1, v.pos.z - Math.cos(h) * 1.2)) inside++;
            if (v.surface && v.surface.kind === 'tarmac') {
              back = t;
              return false;
            }
          });
          releaseAll();
          if (back == null || inside || longest > 6) bad++;
          rows.push(`${(c.o.what || 'building').replace(/^You (flew into|hit) /, '')} at ${Math.round((c.o.x0 + c.o.x1) / 2)},${Math.round((c.o.z0 + c.o.z1) / 2)}: `
            + `${back == null ? 'NOT back on the road in 60 s' : `on the road in ${back.toFixed(0)} s`}`
            + `${inside ? `, the bonnet inside it for ${inside} steps` : ''}${longest > 0 ? `, BLOCKED ${longest.toFixed(1)} s at the longest` : ''}`);
        }
        r.ok(
          'off the road behind a building, the arrow gets you back to the road',
          cands.length >= 3 && bad === 0,
          rows.join(' · ') || 'no building near a road on this island'
        );
      }

      /* =========================================================== the roads == */
      say('what the roads look like');
      {
        const m = measureRoads();
        if (m) {
          r.ok(
            'roads: a sensible width',
            m.wMid >= 7 && m.wMid <= 14,
            `tarmac ${m.wMid.toFixed(1)} m wide across the middle of the typical road (${m.widths.map((w) => w.toFixed(0)).join(', ')} m)`
          );
          r.ok('roads: they sit on the ground — not buried, not floating', m.groundOk, m.groundSays);
          r.ok('roads: level from side to side, not draped over banks', m.levelOk, m.levelSays);
          r.ok(
            'roads: painted edge lines and a centre line',
            m.paint > 0 && !!m.lines && m.lines.edge > 0 && m.lines.centre > 0,
            m.lines ? `${m.lines.edge} m of edge line, ${m.lines.centre} m of centre dashes` : 'no markings at all'
          );
          r.ok(
            'roads: junctions join',
            m.joins > 0 && m.holes === 0,
            `${m.joins} junctions, ${m.holes} of ${m.joins * 12} points round them with no tarmac`
          );
        } else {
          r.ok('roads: a sensible width', false, 'no road mesh on this island');
        }
      }

    }

    /* ======================================== the first job, by the arrow == */
    say('first run, by the arrow');
    const jobs = [];
    const playJob = async (id, firstChecks = id === 'firstrun') => {
      await freshDrive({ job: id });
      const v = sim.vehicle;
      const def = sim.runner.def;
      const res = { id, done: false, t: 0, onRoad: 0, n: 0, swamped: 0, bumps: 0, lastStep: '', pips: null, stuck: 0, air: 0, maxLift: 0, liftAt: '', airRun: 0, longestAir: 0, airAt: '' };
      if (!def || def.id !== id) {
        res.why = 'did not start';
        return res;
      }
      // The first frame of the job, for the arrow check.
      const tr = sim.driveHud && sim.driveHud.tracker;
      sim.step(1 / 60);
      {
        const c0 = sim.driveHud && sim.driveHud.chev;
        res.firstArrow = c0 && !c0.hidden ? c0.textContent : '';
        // What the job's own weather is, for Night Call-out.
        res.weather = sim.weather ? `${sim.weather.time}/${sim.weather.condition}` : '';
      }
      if (firstChecks) {
        const route = tr ? tr.route : [];
        let firstLeg = null;
        let offRoad = 0;
        if (route && route.length >= 2) {
          // Direction of the route where the van is.
          let walked = 0;
          for (let k = 1; k < route.length && walked < 220; k++) {
            const a = route[k - 1];
            const b = route[k];
            const len = Math.hypot(b.x - a.x, b.z - a.z);
            if (firstLeg == null && len > 3) firstLeg = bearing(a.x, a.z, b.x, b.z);
            for (let s = 0; s < len && walked < 220; s += 10, walked += 10) {
              const x = a.x + ((b.x - a.x) * s) / len;
              const z = a.z + ((b.z - a.z) * s) / len;
              if (!onTarmacDrawn(x, z)) offRoad++;
            }
          }
        }
        const chev = sim.driveHud && sim.driveHud.chev;
        const label = chev && !chev.hidden ? chev.textContent : '';
        const err = firstLeg == null ? 999 : Math.abs(wrap180(firstLeg - v.heading));
        r.ok(
          "first job: the arrow points the way the van faces, along the road",
          err < 35 && offRoad === 0 && !!label && !/turn around/i.test(label),
          `route leaves ${err.toFixed(0)}° from the van's nose, ${offRoad} of the first 22 ten-metre marks off the tarmac, the arrow says "${label}"`
        );
        // The marker a child drives to: on the road, at the ground.
        const marker = sim.scene.getObjectByName('courier-drop');
        const tgt = sim.runner.activeTarget();
        const stale = sim.navGuide && sim.navGuide.group.visible;
        let mOk = false;
        let mWhy = 'no drop-off marker in the world';
        if (marker && marker.visible && tgt) {
          const g = Terrain.heightAt(marker.position.x, marker.position.z);
          const lift = marker.position.y - g;
          const n = nearestRoad(marker.position.x, marker.position.z);
          mOk = Math.abs(lift) < 1.5 && !!n && n.d <= drawnHalf(n.rd) + 2;
          mWhy = `marker ${lift.toFixed(2)} m above the ground, ${n ? n.d.toFixed(1) : '?'} m off the centreline`;
        }
        r.ok(
          'the job marker sits on the road, and no flight guidance hangs about',
          mOk && !stale,
          `${mWhy}${stale ? '; the aeroplane\'s guidance rails are still drawn' : ''}`
        );
      }

      // Now drive it, by the arrow.
      let stuckT = 0;
      let backT = 0;
      let backDir = 0;
      const limit = Math.min(def.maxSeconds || 600, 720) + 60;
      const t0 = clock;
      drive(limit, () => {
        if (sim.runner.status !== 'running') return false;
        res.lastStep = sim.runner.step ? sim.runner.step.id : '';
        res.n++;
        if (onTarmacDrawn(v.pos.x, v.pos.z)) res.onRoad++;
        if (v.swamped) res.swamped++;
        if (v.air) res.air++;
        // The longest the wheels stayed off the ground in one go, seconds.
        res.airRun = v.air ? res.airRun + 1 / 30 : 0;
        if (res.airRun > res.longestAir) {
          res.longestAir = res.airRun;
          res.airAt = `${Math.round(v.pos.x)},${Math.round(v.pos.z)} at ${kph(v).toFixed(0)} km/h`;
        }
        // How high the wheels went over the drawn ground, and where: a road
        // that throws the van off it is a road fault, whoever drove it.
        {
          const lift = v.pos.y - rideGround(v.pos.x, v.pos.z) - (v.spec.rideHeight || 0);
          if (lift > res.maxLift) {
            res.maxLift = lift;
            res.liftAt = `${Math.round(v.pos.x)},${Math.round(v.pos.z)} at ${kph(v).toFixed(0)} km/h`;
          }
        }
        const route = tr && tr.route && tr.route.length >= 2 ? tr.route : null;
        const tgt = sim.runner.activeTarget();
        const spd = kph(v);

        // Unsticking, the way a child does it: back up a bit, try again.
        if (backT > 0) {
          backT -= 1 / 30;
          press('go', false);
          press('stop', true);
          press('left', backDir < 0);
          press('right', backDir > 0);
          return true;
        }
        if (held.has('go') && spd < 2) stuckT += 1 / 30;
        else stuckT = 0;
        if (stuckT > 2.5) {
          stuckT = 0;
          res.stuck++;
          backT = 1.6;
          // Left one time, right the next: the same run gives the same
          // numbers every time, which Math.random() did not.
          backDir = res.stuck % 2 ? -1 : 1;
          return true;
        }

        // Where the arrow says to go: a point on the arrow's route 30 m on.
        let aimX = tgt ? tgt.pos.x : v.pos.x;
        let aimZ = tgt ? tgt.pos.z : v.pos.z;
        let bend = 0;
        let kink = 0;
        let left = tgt ? Math.hypot(tgt.pos.x - v.pos.x, tgt.pos.z - v.pos.z) : 0;
        if (route) {
          let bi = 0;
          let bd = Infinity;
          let bt = 0;
          for (let k = 1; k < route.length; k++) {
            const a = route[k - 1];
            const b = route[k];
            const ex = b.x - a.x;
            const ez = b.z - a.z;
            const l2 = ex * ex + ez * ez || 1e-6;
            let t = ((v.pos.x - a.x) * ex + (v.pos.z - a.z) * ez) / l2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const d = Math.hypot(a.x + ex * t - v.pos.x, a.z + ez * t - v.pos.z);
            if (d < bd) { bd = d; bi = k; bt = t; }
          }
          const look = 22 + Math.abs(v.speed) * 0.9;
          let need = look;
          let k = bi;
          let t = bt;
          let px = v.pos.x;
          let pz = v.pos.z;
          let h1 = null;
          let remaining = 0;
          for (let j = bi; j < route.length; j++) {
            const a = route[j - 1];
            const b = route[j];
            remaining += Math.hypot(b.x - a.x, b.z - a.z) * (j === bi ? 1 - bt : 1);
          }
          left = Math.min(left, remaining);
          while (k < route.length) {
            const a = route[k - 1];
            const b = route[k];
            const len = Math.hypot(b.x - a.x, b.z - a.z);
            const rest = len * (1 - t);
            if (h1 == null && len > 2) h1 = bearing(a.x, a.z, b.x, b.z);
            if (rest >= need) {
              const u = t + need / Math.max(len, 1e-6);
              px = a.x + (b.x - a.x) * u;
              pz = a.z + (b.z - a.z) * u;
              need = 0;
              break;
            }
            need -= rest;
            k++;
            t = 0;
            px = b.x;
            pz = b.z;
          }
          aimX = px;
          aimZ = pz;
          // How much the road turns, all told, in the stretch a child can see
          // coming at this speed — enough to brake for it. A hairpin written
          // every 16 m turns 30 degrees a segment and 180 all together; it
          // is the 180 that sets the corner speed.
          const seeM = 50 + (v.speed * v.speed) / 10;
          let walked = 0;
          let prev = h1;
          for (let j = bi + 1; j < route.length && walked < seeM; j++) {
            const a = route[j - 1];
            const b = route[j];
            const len = Math.hypot(b.x - a.x, b.z - a.z);
            if (len < 1) continue;
            const h = bearing(a.x, a.z, b.x, b.z);
            if (prev != null) {
              const dh = Math.abs(wrap180(h - prev));
              bend += dh;
              kink = Math.max(kink, dh);
            }
            prev = h;
            walked += len;
          }
        }
        const err = wrap180(bearing(v.pos.x, v.pos.z, aimX, aimZ) - v.heading);
        steerKeys(err, 2.5);

        // Where each knock to the load happened, for chasing one down.
        const cg = sim.runner.data && sim.runner.data.cargo;
        if (cg && cg.knocks.length > (res.knockAt || []).length) {
          res.knockAt = res.knockAt || [];
          res.knockAt.push(`${cg.knocks[cg.knocks.length - 1]} at ${Math.round(v.pos.x)},${Math.round(v.pos.z)} ${spd.toFixed(0)} km/h on ${v.surface ? v.surface.kind : '?'}`);
        }

        // Speed: a child's right foot, lifting for the bends and for the stop,
        // and flat to the floor where the road is straight — which is what
        // a child does with a straight road.
        const stopping = left < 12 + (spd / 3.6) * (spd / 3.6) / 7 + 6;
        // ...and a corner with no curve to it at all (a hand-drawn road that
        // turns at a point) is slower than the same turn spread over a bend.
        let want = bend > 100 || kink > 40 ? 30 : bend > 55 || kink > 25 ? 42 : bend > 25 ? 60 : bend > 12 ? 75 : 90;
        if (Math.abs(err) > 50) want = 22;
        if (stopping) want = 0;
        if (want === 0) {
          press('go', false);
          press('stop', v.speed > 0.4);
          // Stopped short of it: creep up.
          if (Math.abs(v.speed) < 0.4 && left > 22) {
            press('stop', false);
            press('go', true);
          }
        } else {
          press('stop', spd > want + 12);
          press('go', spd < want);
        }
        return true;
      });
      releaseAll();
      res.t = clock - t0;
      res.done = sim.runner.status === 'complete';
      res.score = sim.runner.data && sim.runner.data.score;
      res.pips = sim.runner.data && sim.runner.data.cargo ? sim.runner.data.cargo.pips : null;
      res.knocks = sim.runner.data && sim.runner.data.cargo ? sim.runner.data.cargo.knocks.slice() : [];
      res.bumps = v.bumps || 0;
      // What the debrief says. (It is the van's own now, built when the job
      // ends; the wait is for a build that still words it a microtask late.)
      await Promise.resolve();
      {
        const dbs = sim.menus && sim.menus.screens && sim.menus.screens.debrief;
        res.debrief = dbs && !dbs.hidden
          ? Array.from(dbs.querySelectorAll('[data-title], [data-body] p, [data-actions] button')).map((n) => n.textContent.trim()).join(' | ')
          : '';
      }
      // What is left standing behind the debrief.
      const mk = sim.scene.getObjectByName('courier-drop');
      res.markerAfter = !!(mk && mk.visible);
      res.stateAfter = sim.state;
      return res;
    };

    /*
     * THE KID WHO OWNS THE GAME, driving a job: W held down the whole way,
     * A or D whenever the arrow leans more than 8 degrees, and nothing else
     * except what the screen says in words — SLOW DOWN, lift off W; BRAKE!,
     * S; ARRIVING, S until stopped, and then WAIT (a child told to stop
     * here stops here); NEARLY THERE, keep going; BACK UP, hold S (and let
     * go once it is going backwards and says ARRIVING); BLOCKED, keep W and
     * steer where the arrow points (S if it says back up); TURN AROUND,
     * hold D. It never looks at the route, the map or the job: only at the
     * chevron a child sees.
     *
     * The first version of this kid crept forward again after 1.5 s stopped
     * under ARRIVING, and that hid the reviewer's blocker: ARRIVING came up
     * with 45 m of route left, the job only takes a stop within 34 m, and a
     * careful kid who did as they were told and waited sat 37-40 m out for
     * ever. This one waits, and counts it (stalls, below).
     *
     *   { ignoreSlow: true }  never lifts off at all;
     *   { cap: 30 }           never goes above 30 km/h (a careful kid);
     *   { coast: true }       at ARRIVING lets go of W and does not brake;
     *   { fastIn: true }      ignores SLOW DOWN and BRAKE! until it first
     *                         sees ARRIVING (after that it knows it is near);
     *   { ignoreArrive: true } drives straight on through ARRIVING;
     *   { keep: true }        drives on from where the van is, no new job;
     *   { seconds: n }        gives up after n seconds, not the job's limit;
     *   { until(v, res) }     stops driving when this says so.
     *
     * Measured on every frame, from the job's own target (which the driver
     * never looks at): how far out ARRIVING was ever shown (arrivingOut),
     * and how many times the van sat stopped under ARRIVING for three
     * seconds without the job taking it (stalls). Not on a frame where the
     * job has just moved to its next step: the panel is drawn before the
     * runner checks the step (main.js), so for one frame it still shows the
     * last one — measured, ARRIVING "2,647 m" from the Summit Relay's next
     * target on the frame the summit stop counted.
     */
    const hudKid = async (id, o2 = {}) => {
      if (!o2.keep) await freshDrive({ job: id });
      const v = sim.vehicle;
      const res = { id, done: false, t: 0, onRoad: 0, n: 0, slowT: 0, brakeT: 0, blockedT: 0, backT: 0, top: 0, arrivingOut: 0, stalls: 0, stallAt: '', words: new Set() };
      if (!sim.runner.def || sim.runner.def.id !== id) return { ...res, why: 'did not start' };
      let stillT = 0;
      let seenArrive = false;
      let seenStep = sim.runner.step;
      const t0 = clock;
      drive(o2.seconds || Math.min(sim.runner.def.maxSeconds || 600, 720) + 60, () => {
        if (sim.runner.status !== 'running') return false;
        if (o2.until && o2.until(v, res)) return false;
        const sameStep = sim.runner.step === seenStep;
        seenStep = sim.runner.step;
        res.n++;
        if (onTarmacDrawn(v.pos.x, v.pos.z)) res.onRoad++;
        const h = sim.driveHud;
        const shown = h && h.chev && !h.chev.hidden;
        const what = shown ? h.chevWhat.textContent : '';
        const under = shown ? h.chevDist.textContent : '';
        const m = shown ? /rotate\((-?[\d.]+)deg\)/.exec(h.chevArrow.style.transform || '') : null;
        const rot = m ? parseFloat(m[1]) : 0;
        const spd = kph(v);
        res.top = Math.max(res.top, spd);
        if (what) res.words.add(what);
        let go = true;
        let stop = false;
        let steer = rot < -8 ? -1 : rot > 8 ? 1 : 0;
        if (what === 'BLOCKED') {
          // Steer the way the arrow points (the chevron points the way out),
          // or back up when that is what it says.
          res.blockedT += 1 / 30;
          if (/back up/i.test(under)) {
            go = false;
            stop = true;
          }
        } else if (/TURN AROUND/.test(what)) {
          steer = 1;
          if (spd > 25) go = false;
        } else if (what === 'BACK UP') {
          res.backT += 1 / 30;
          go = false;
          stop = true;
          steer = 0;
        }
        const deaf = o2.ignoreSlow || (o2.fastIn && !seenArrive);
        if (what === 'SLOW DOWN') {
          res.slowT += 1 / 30;
          if (!deaf) go = false;
        }
        if (what === 'BRAKE!') {
          res.brakeT += 1 / 30;
          if (!deaf) {
            go = false;
            stop = true;
          }
        }
        if (what === 'ARRIVING') {
          seenArrive = true;
          if (!o2.ignoreArrive) {
            go = false;
            // Going backwards, "stop here" means let go of S; going forwards
            // it means S (unless this is the kid who only lets go).
            stop = !o2.coast && v.speed > 0.5;
          }
          const tg = sim.runner.activeTarget();
          if (tg && sameStep) res.arrivingOut = Math.max(res.arrivingOut, Math.hypot(tg.pos.x - v.pos.x, tg.pos.z - v.pos.z));
        }
        if (o2.cap && spd >= o2.cap) go = false;
        // Stopped, and the screen is telling it to stay stopped.
        if (spd < 0.5 && what === 'ARRIVING') {
          stillT += 1 / 30;
          if (stillT >= 3 && stillT - 1 / 30 < 3) {
            res.stalls++;
            const tg = sim.runner.activeTarget();
            res.stallAt = tg ? `${Math.hypot(tg.pos.x - v.pos.x, tg.pos.z - v.pos.z).toFixed(1)} m from the target, step ${sim.runner.step && sim.runner.step.id}` : '';
          }
        } else {
          stillT = 0;
        }
        press('w', go);
        press('s', stop);
        press('left', steer < 0);
        press('right', steer > 0);
        return true;
      });
      releaseAll();
      res.t = clock - t0;
      res.done = sim.runner.status === 'complete';
      res.score = sim.runner.data && sim.runner.data.score;
      res.pips = sim.runner.data && sim.runner.data.cargo ? sim.runner.data.cargo.pips : null;
      res.knocks = sim.runner.data && sim.runner.data.cargo ? sim.runner.data.cargo.knocks.slice() : [];
      return res;
    };

    if (opts.home !== false) {
      const first = await playJob('firstrun');
      jobs.push(first);
      r.ok(
        'first job, start to finish, by following the arrow',
        first.done && first.onRoad / Math.max(first.n, 1) >= 0.85 && !first.swamped && first.t <= 240,
        `${first.done ? 'delivered' : 'NOT delivered (stuck on "' + first.lastStep + '")'} in ${first.t.toFixed(0)} s, `
          + `${Math.round((100 * first.onRoad) / Math.max(first.n, 1))}% on the tarmac, ${first.bumps} bumps, ${first.stuck} times stuck`
      );
      // No clock and a load that cannot break: there is nothing to do better,
      // so a delivery is full marks, not a 70 under "try again".
      r.ok(
        'a clean First Run scores 100',
        first.done && first.score === 100,
        first.done ? `delivered with ${first.pips} of 5 pips, scored ${first.score}/100` : 'not delivered'
      );
      // The debrief is the last thing a child reads: after a delivery it
      // offered "Fly again", said "Mission complete", and said "Try it again
      // for a better score" under a 100/100.
      {
        const aero = /fly again|flown|flight|mission complete|try it again for a better score/i;
        r.ok(
          'after the job, the debrief speaks van',
          first.done && /drive again/i.test(first.debrief || '') && !aero.test(first.debrief || ''),
          first.done ? `"${first.debrief || 'no debrief on screen'}"` : 'not delivered'
        );
      }
      r.ok(
        'the drop-off beam goes when the job is done',
        first.done && !first.markerAfter,
        first.done
          ? `${first.stateAfter}: the green beam is ${first.markerAfter ? 'still standing behind it' : 'gone'}`
          : 'not delivered'
      );

      /*
       * ---- the big button on the debrief: the job again, in the van ----
       * The reviewer's blocker on the first pass: "Drive again" was the
       * aeroplane's restart with new words on it, and put the child in a
       * Skylark on Drover's Flat's runway under "Free Flight · Hold Shift for
       * full power". Pressed as a child presses it, then a frame.
       */
      const where = () => {
        const v = sim.vehicle;
        return {
          van: !!v && !v.isBoat && sim.mode === 'drive',
          job: sim.runner.status === 'running' && sim.runner.def ? sim.runner.def.id : null,
          step: sim.runner.step ? sim.runner.step.id : null,
          plane: !!(sim.model && sim.model.visible),
          title: sim.hud.objectiveTitle ? sim.hud.objectiveTitle.textContent : '',
          at: v ? `${Math.round(v.pos.x)},${Math.round(v.pos.z)}` : 'no van',
          say: `${sim.hud.objectiveTitle ? sim.hud.objectiveTitle.textContent : ''} · ${sim.hud.objectiveText ? sim.hud.objectiveText.textContent : ''}`,
        };
      };
      const settle = async (before) => {
        // Whatever path the button takes may finish on a microtask or after
        // an await (startMode awaits the audio): wait, up to a second, for a
        // new van, then one frame.
        for (let i = 0; i < 50 && (!sim.vehicle || sim.vehicle === before); i++) await new Promise((res) => setTimeout(res, 20));
        sim.step(1 / 30);
      };
      {
        const dbs = sim.menus.screens.debrief;
        const btn = dbs && !dbs.hidden ? Array.from(dbs.querySelectorAll('[data-actions] button')).find((b) => /again/i.test(b.textContent)) : null;
        const label = btn ? btn.textContent.trim() : '';
        const vanBefore = sim.vehicle;
        if (btn) btn.click();
        await settle(vanBefore);
        const w = where();
        r.ok(
          '"Drive again" drives First Run again, in the van',
          !!btn && w.van && w.job === 'firstrun' && !w.plane && !/free flight|shift for full power/i.test(w.say),
          btn ? `pressed "${label}": ${w.van ? 'in the van' : 'NOT in the van'}${w.plane ? ', the aeroplane on screen' : ''}, job ${w.job || 'none'} at step ${w.step || '-'}, at ${w.at}; the HUD says "${w.say}"` : 'no "again" button on the debrief'
        );
      }
      /*
       * ---- and the pause menu's ways back, mid-job ----
       * Restart is main.js restart(), which is the aeroplane's startMode;
       * "Return to the airfield" put the aeroplane back on runway 09. Both
       * measured by the reviewer dropping the job into a Free Flight.
       */
      {
        const at0 = where().at;
        drive(4, () => press('w', true));
        releaseAll();
        const moved = where().at;
        sim.pause();
        const ps = sim.menus.screens.pause;
        // The buttons as painted: a fold the van has hidden does not count,
        // and one it has not does, closed or open.
        const painted = (n) => {
          for (let e = n; e && e !== ps; e = e.parentElement) {
            const cs = getComputedStyle(e);
            if (cs.display === 'none' || cs.visibility === 'hidden' || e.hidden) return false;
          }
          return true;
        };
        const btns = ps
          ? Array.from(ps.querySelectorAll('.pause-actions > [data-act], details.pause-fold > summary')).filter(painted).map((b) => b.textContent.trim())
          : [];
        const info = ps ? ps.querySelector('[data-pause-info]').textContent.replace(/\s+/g, ' ').trim() : '';
        const aeroWords = btns.filter((t) => /flight|airfield|runway|cockpit|autopilot/i.test(t));
        const aeroInfo = /\bkt\b|\bft\b|fuel/i.test(info);
        const restart = ps && ps.querySelector('[data-act="restart"]');
        const van1 = sim.vehicle;
        if (restart) restart.click();
        await settle(van1);
        const w1 = where();
        drive(4, () => press('w', true));
        releaseAll();
        sim.pause();
        const back = ps && ps.querySelector('[data-act="airport"]');
        const backLabel = back ? back.textContent.trim() : '';
        const van2 = sim.vehicle;
        if (back) back.click();
        await settle(van2);
        const w2 = where();
        r.ok(
          'pause mid-job: Restart and the other way back both start the job again in the van',
          w1.van && w1.job === 'firstrun' && w1.step === 'pickup' && w1.at === at0 && !w1.plane
            && w2.van && w2.job === 'firstrun' && w2.step === 'pickup' && w2.at === at0 && !w2.plane,
          `from ${moved}: Restart put the van at ${w1.at} (start ${at0}), job ${w1.job || 'none'} step ${w1.step || '-'}${w1.plane ? ', aeroplane on screen' : ''}; `
            + `"${backLabel}" put it at ${w2.at}, job ${w2.job || 'none'} step ${w2.step || '-'}${w2.plane ? ', aeroplane on screen' : ''}`
        );
        r.ok(
          'the pause menu in the van speaks van',
          btns.length > 0 && aeroWords.length === 0 && !aeroInfo && /km\/h/.test(info),
          `buttons: ${btns.join(' / ')}; card: "${info}"`
        );
        // ...and the ⋯ tray's Restart and "Back to the start", the other
        // place a child finds them.
        const hud = sim.hud;
        const tries = [];
        for (const b of [hud.btnRestart, hud.btnAirport]) {
          if (!b) continue;
          drive(4, () => press('w', true));
          releaseAll();
          const vb = sim.vehicle;
          b.click();
          await settle(vb);
          const w = where();
          tries.push({ words: b.textContent.trim(), ok: w.van && w.job === 'firstrun' && w.step === 'pickup' && w.at === at0 && !w.plane, w });
        }
        r.ok(
          'the ⋯ tray\'s Restart and way back start the job again in the van',
          tries.length === 2 && tries.every((t) => t.ok),
          tries.map((t) => `"${t.words}": van at ${t.w.at} (start ${at0}), job ${t.w.job || 'none'} step ${t.w.step || '-'}${t.w.plane ? ', aeroplane on screen' : ''}`).join('; ') || 'no tray buttons'
        );
      }

      /* ============================================== every other job here == */
      if (opts.allJobs !== false) {
        say('every job');
        const Jobs = await import('../../src/game/jobs.js');
        const board = Jobs.jobsFor(sim);
        for (const e of board) {
          if (e.job.id === 'firstrun') continue;
          if (!e.available) {
            jobs.push({ id: e.job.id, skipped: e.why });
            continue;
          }
          jobs.push(await playJob(e.job.id));
        }
        const offered = jobs.filter((j) => !j.skipped);
        const done = offered.filter((j) => j.done);
        r.ok(
          'every job on the board, by following the arrow',
          done.length === offered.length && offered.every((j) => j.onRoad / Math.max(j.n, 1) >= 0.8),
          jobs
            .map((j) =>
              j.skipped
                ? `${j.id}: not offered (${j.skipped})`
                : `${j.id}: ${j.done ? 'done' : 'NOT done at "' + j.lastStep + '"'} ${j.t.toFixed(0)} s, `
                  + `${Math.round((100 * j.onRoad) / Math.max(j.n, 1))}% tarmac, pips ${j.pips}, score ${j.score}`
                  + (j.knocks && j.knocks.length ? ` (${j.knocks.join(', ')})` : '')
                  + (j.air ? `, ${(j.air / 30).toFixed(1)} s off the ground (highest ${j.maxLift.toFixed(2)} m, ${j.liftAt})` : '')
            )
            .join(' · ')
        );
        const backwards = offered.filter((j) => !j.firstArrow || /turn around/i.test(j.firstArrow));
        r.ok(
          'every job: the first arrow points the way the van is parked',
          offered.length > 0 && backwards.length === 0,
          offered.map((j) => `${j.id} "${j.firstArrow || 'no arrow'}"`).join(' · ')
        );
        /*
         * The kid who owns the game, on every job here (hudKid above). The
         * reviewer's version of this kid, with nothing on the screen saying
         * slow down, scored Coast Road 0/100 in 274 s and the Summit Relay
         * 0/100 in 377 s, five "Off the road at speed" knocks each. Each job
         * delivered, three-quarters of it on the tarmac, and scoring at
         * least 80. First measured with SLOW DOWN on the screen: 100 on all
         * six, the careful route-reading driver above being no better.
         */
        const kids = [];
        for (const e of board) {
          if (!e.available) continue;
          kids.push(await hudKid(e.job.id));
        }
        const poor = kids.filter((k) => !k.done || k.onRoad / Math.max(k.n, 1) < 0.75 || !(k.score >= 80));
        r.ok(
          'the kid who owns it: W held, steering by the arrow, doing what the screen says — every job, a score worth having',
          kids.length > 0 && poor.length === 0,
          kids
            .map((k) => `${k.id}: ${k.done ? 'done' : 'NOT done'} ${k.t.toFixed(0)} s, ${Math.round((100 * k.onRoad) / Math.max(k.n, 1))}% tarmac, `
              + `score ${k.score}, pips ${k.pips}, SLOW DOWN ${k.slowT.toFixed(0)} s, BRAKE! ${k.brakeT.toFixed(0)} s, top ${k.top.toFixed(0)} km/h`
              + (k.knocks && k.knocks.length ? ` (${k.knocks.join(', ')})` : ''))
            .join(' · ')
        );
        /*
         * And the same kid who never lifts off at all, on the two hardest
         * jobs: the screen said SLOW DOWN and they did not. Still delivered,
         * still on the road most of the way, and the stability control
         * keeps something of the load: not a zero.
         */
        const stubborn = [];
        for (const id of ['coastroad', 'summit']) {
          if (board.some((e) => e.job.id === id && e.available)) stubborn.push(await hudKid(id, { ignoreSlow: true }));
        }
        r.ok(
          'even never lifting off W, the hard jobs deliver and score something',
          stubborn.length > 0 && stubborn.every((k) => k.done && k.onRoad / Math.max(k.n, 1) >= 0.7 && k.score > 0),
          stubborn
            .map((k) => `${k.id}: ${k.done ? 'done' : 'NOT done'} ${k.t.toFixed(0)} s, ${Math.round((100 * k.onRoad) / Math.max(k.n, 1))}% tarmac, score ${k.score}, pips ${k.pips}`
              + (k.knocks && k.knocks.length ? ` (${k.knocks.join(', ')})` : ''))
            .join(' · ') || 'neither job on this island'
        );

        /*
         * THE CAREFUL KID — the reviewer's blocker on the second pass. Never
         * above 30 km/h (and 40 on the two jobs where it bit), everything
         * the screen says obeyed, stopping the moment it says ARRIVING and
         * then waiting for it to count. With ARRIVING shown on 45 m of route
         * left and the job counting a stop within 34 m, this kid stalled
         * 36.8-40.3 m out on First Run and the Shuttle in four runs of six,
         * for ever. Every job, delivered, and never once stopped under
         * ARRIVING for three seconds with nothing happening.
         */
        const careful = [];
        for (const e of board) {
          if (!e.available) continue;
          // At 30 km/h the Summit Relay is more than the twelve minutes the
          // other kids are given: 1,500 s, so slow is not the same as stuck.
          careful.push({ cap: 30, ...(await hudKid(e.job.id, { cap: 30, seconds: 1500 })) });
        }
        for (const id of ['firstrun', 'shuttle']) {
          if (board.some((e) => e.job.id === id && e.available)) careful.push({ cap: 40, ...(await hudKid(id, { cap: 40, seconds: 1500 })) });
        }
        r.ok(
          'a careful kid (never above 30 or 40 km/h) who stops the moment it says ARRIVING and waits: delivered, every job',
          careful.length > 0 && careful.every((k) => k.done && k.stalls === 0),
          careful
            .map((k) => `${k.id} at ${k.cap}: ${k.done ? 'done' : 'NOT done'} ${k.t.toFixed(0)} s, score ${k.score}`
              + (k.stalls ? `, stuck under ARRIVING ${k.stalls}× (${k.stallAt})` : ''))
            .join(' · ')
        );

        /*
         * The kid who holds W all the way in (no lifting for SLOW DOWN),
         * then lets go at ARRIVING and does not brake — the reviewer's Night
         * Call-out run: it coasted 37 m past the town and sat under
         * "ARRIVING, drop it here" for 760 s. Past the drop-off the screen
         * must say so (BACK UP, or TURN AROUND further out), and doing what
         * it says delivers. (Having overshot once it does lift for SLOW
         * DOWN: a kid who never brakes and never lifts goes round for ever,
         * whatever the screen says.)
         */
        const coasting = [];
        for (const e of board) {
          if (!e.available) continue;
          coasting.push(await hudKid(e.job.id, { coast: true, fastIn: true }));
        }
        r.ok(
          'holds W, lets go at ARRIVING and coasts: whatever happens next, the screen gets it delivered',
          coasting.length > 0 && coasting.every((k) => k.done && k.stalls === 0),
          coasting
            .map((k) => `${k.id}: ${k.done ? 'done' : 'NOT done'} ${k.t.toFixed(0)} s, score ${k.score}, BACK UP ${k.backT.toFixed(1)} s`
              + `${k.words.has('TURN AROUND') ? ', TURN AROUND' : ''}`
              + (k.stalls ? `, stuck under ARRIVING ${k.stalls}× (${k.stallAt})` : ''))
            .join(' · ')
        );

        /*
         * Every one of those kids, every frame: ARRIVING was only ever on
         * the screen inside the drop-off zone — 34 m from the job's own
         * target, the smallest zone any job stops in — and never over a van
         * that was stopped and waiting for nothing.
         */
        {
          const everyKid = [...kids, ...stubborn, ...careful, ...coasting];
          const far = everyKid.reduce((a, k) => (k.arrivingOut > a.arrivingOut ? k : a), { arrivingOut: 0, id: '-' });
          const stalled = everyKid.filter((k) => k.stalls);
          // ...and it was shown at all: a van that never gets there never
          // sees ARRIVING anywhere, which is not a pass.
          const saw = everyKid.filter((k) => k.words.has('ARRIVING')).length;
          r.ok(
            'ARRIVING is only shown where a stop counts, and nobody waits under it for nothing',
            everyKid.length > 0 && saw > 0 && far.arrivingOut <= 34.5 && stalled.length === 0,
            `${everyKid.length} runs, ${saw} of them saw ARRIVING: at most ${far.arrivingOut.toFixed(1)} m from the target (${far.id}; the zone is 34 m), `
              + `${stalled.length ? stalled.map((k) => `${k.id} stuck ${k.stalls}× (${k.stallAt})`).join('; ') : 'no van ever sat stopped under it'}`
          );
        }

        /*
         * Overshoot on purpose: First Run at 30 km/h, straight through the
         * drop-off and on down the road, stopping 8 m or more past the edge
         * of the zone with the yard behind. The first pass said ARRIVING
         * there (the route had nothing left, so it was always "arriving")
         * with TO GO 0.0 km and no way-back arrow. It must say BACK UP (or
         * TURN AROUND), with a real distance to go — and then doing only
         * what the screen says must deliver it.
         */
        {
          await freshDrive({ job: 'firstrun' });
          const v = sim.vehicle;
          const tgt = () => sim.runner.activeTarget();
          const dTo = () => {
            const t = tgt();
            return t ? Math.hypot(t.pos.x - v.pos.x, t.pos.z - v.pos.z) : Infinity;
          };
          const behind = () => {
            const t = tgt();
            return !!t && Math.abs(wrap180(bearing(v.pos.x, v.pos.z, t.pos.x, t.pos.z) - v.heading)) > 110;
          };
          // To the drop-off by the screen, at 30 km/h, until inside the zone.
          await hudKid('firstrun', { keep: true, cap: 30, ignoreArrive: true, until: () => sim.runner.step && sim.runner.step.id === 'drop' && dTo() < 22 });
          // Then on down the road, not stopping, until well past it.
          drive(40, () => {
            if (sim.runner.status !== 'running') return false;
            if (dTo() > 42 && behind()) return false;
            press('w', kph(v) < 30);
            press('s', false);
            steerKeys(laneKeepSteer(v));
            return true;
          });
          // And stop there.
          releaseAll();
          drive(8, () => {
            if (Math.abs(v.speed) < 0.2) return false;
            press('s', v.speed > 0.2);
            return true;
          });
          releaseAll();
          sim.step(1 / 30, 1 / 60);
          const past = dTo();
          const ck = chevronKeys();
          const toGo = sim.hud.altValue ? `${sim.hud.altValue.textContent} ${sim.driveHud.distUnit ? sim.driveHud.distUnit.textContent : ''}` : '';
          const status0 = sim.runner.status;
          const after = status0 === 'running' ? await hudKid('firstrun', { keep: true, seconds: 90 }) : { done: status0 === 'complete', t: 0 };
          r.ok(
            'stopped just past the drop-off: the screen says BACK UP (not ARRIVING), and doing that delivers it',
            status0 === 'running' && /BACK UP|TURN AROUND/.test(ck.what) && !/^0(\.0)? /.test(toGo) && after.done && !after.stalls,
            `stopped ${past.toFixed(1)} m from the yard (the zone is 34 m), the chevron said "${ck.what} / ${ck.dist}", TO GO ${toGo}; `
              + `${status0 !== 'running' ? `but the job was already ${status0} before the stop, so nothing was tested` : after.done ? `delivered ${after.t.toFixed(0)} s later` : 'NOT delivered in 90 s'}`
          );
        }

        /*
         * Stopped ANYWHERE near the drop-off, not just along the road: First
         * Run's last step, the van parked at rest 40, 55 and 75 m from the
         * yard on eight bearings, facing away from it and facing it, then
         * the kid who only reads the screen. Every one delivered inside 45 s,
         * and never left waiting under ARRIVING. (The overshoot above is one
         * of these; a van that ran wide across the grass or stopped short to
         * one side is the rest.) Measured on this branch before it was a
         * check: 62 of 62 starts on a 40-90 m ring delivered, the slowest in
         * 13 s.
         */
        {
          const rows = [];
          let n = 0;
          let late = 0;
          let worst = 0;
          for (const dist of [40, 55, 75]) {
            for (let b = 0; b < 360; b += 45) {
              for (const away of [true, false]) {
                await freshDrive({ job: 'firstrun' });
                const v = sim.vehicle;
                while (sim.runner.status === 'running' && sim.runner.step && sim.runner.step.id !== 'drop') sim.runner.skipStep();
                const tg = sim.runner.status === 'running' ? sim.runner.activeTarget() : null;
                if (!tg) continue;
                const x = tg.pos.x + Math.sin(b * DEG) * dist;
                const z = tg.pos.z - Math.cos(b * DEG) * dist;
                const h0 = Terrain.heightAt(x, z);
                if (!(h0 > 1)) continue;
                let inSomething = false;
                for (const [ox, oz] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]]) {
                  if (Terrain.obstacleAt(x + ox, Terrain.heightAt(x + ox, z + oz) + 1, z + oz)) inSomething = true;
                }
                if (inSomething) continue;
                releaseAll();
                v.reset({ pos: new THREE.Vector3(x, h0, z), headingDeg: away ? b : (b + 180) % 360 });
                sim.step(0.1);
                const k = await hudKid('firstrun', { keep: true, seconds: 45 });
                n++;
                if (k.done) worst = Math.max(worst, k.t);
                if (!k.done || k.stalls) {
                  late++;
                  rows.push(`${dist} m at ${b}° facing ${away ? 'away' : 'the yard'}: ${k.done ? 'done' : 'NOT done'} in ${k.t.toFixed(0)} s`
                    + (k.stalls ? `, stuck under ARRIVING (${k.stallAt})` : ''));
                }
              }
            }
          }
          r.ok(
            'stopped anywhere 40-75 m from the drop-off: doing what the screen says delivers it',
            n >= 24 && late === 0,
            `${n - late} of ${n} starts round First Run's yard delivered, the slowest in ${worst.toFixed(0)} s`
              + (rows.length ? ` — ${rows.slice(0, 8).join(' · ')}${rows.length > 8 ? ` … ${rows.length} in all` : ''}` : '')
          );
        }

        /*
         * ---- the word under the speed says what the ground looks like ----
         * The second review: "the surface word says 'grass' on the pale
         * sand-coloured town ground". Round First Run's yard a stubble
         * patch was drawn over the grass, pale beige on screen, and the panel
         * said grass on it. Here: every 12 m from 50 to 150 m out from the
         * yard, off the tarmac and clear of buildings, where the physics
         * calls it grass, the van parked and the word compared with what is
         * drawn there: a crop patch if a ray from above hits one (redder than
         * green: "field"), else what the terrain shader paints most of — its
         * own per-vertex weights read back out of the drawn chunk,
         * interpolated as the GPU does ("grass", "sand", rock as "dirt").
         *
         * And on the farm fields nearest the yard. The fields are laid out
         * as a patchwork now (features.js buildFields), and never within
         * 80 m of a town's edge — Drover's 300 m town, the yard in the
         * middle of it — so nothing but grass is drawn 50-150 m from the
         * yard any more, and a word that said "grass" on every field would
         * have passed. (It did not say grass on every field: it read the
         * patchwork as 6 x 6-vertex patches, and the fields are cut 4 to 12
         * quads a side, so it read corners out of the wrong ones.) So up to
         * 60 spots on the patchwork itself, the nearest to the yard first
         * and 20 m apart, go through the same comparison.
         */
        {
          await freshDrive({ job: 'firstrun' });
          const v = sim.vehicle;
          while (sim.runner.status === 'running' && sim.runner.step && sim.runner.step.id !== 'drop') sim.runner.skipStep();
          const tg = sim.runner.status === 'running' ? sim.runner.activeTarget() : null;
          const chunks = [];
          if (sim.terrain) {
            sim.terrain.traverse((o) => {
              const g = o.isMesh && o.geometry;
              if (g && g.parameters && g.parameters.widthSegments && g.attributes.aBlend) chunks.push(o);
            });
          }
          const NAMES = ['sand', 'grass', 'rock'];
          const painted = (x, z) => {
            let top = -Infinity;
            let most = null;
            for (const o of chunks) {
              const size = o.geometry.parameters.width;
              const segs = o.geometry.parameters.widthSegments;
              const lx = x - (o.position.x - size / 2);
              const lz = z - (o.position.z - size / 2);
              if (lx < 0 || lz < 0 || lx > size || lz > size) continue;
              const sp = size / segs;
              const ix = Math.min(segs - 1, Math.floor(lx / sp));
              const iy = Math.min(segs - 1, Math.floor(lz / sp));
              const u = lx / sp - ix;
              const w = lz / sp - iy;
              const W = segs + 1;
              const tri = u + w <= 1
                ? [[iy * W + ix, 1 - u - w], [iy * W + ix + 1, u], [(iy + 1) * W + ix, w]]
                : [[(iy + 1) * W + ix + 1, u + w - 1], [(iy + 1) * W + ix, 1 - u], [iy * W + ix + 1, 1 - w]];
              const ys = o.geometry.attributes.position.array;
              const bl = o.geometry.attributes.aBlend.array;
              const h = tri.reduce((a, [i, k]) => a + ys[i * 3 + 1] * k, 0);
              if (h <= top) continue;
              top = h;
              const wt = [0, 1, 2].map((c) => tri.reduce((a, [i, k]) => a + bl[i * 3 + c] * k, 0));
              most = NAMES[wt.indexOf(Math.max(...wt))];
            }
            return most;
          };
          // The patchwork (features.js): vertex-coloured and offset towards the camera.
          const patches = [];
          if (sim.features && sim.features.group) {
            sim.features.group.updateMatrixWorld(true);
            sim.features.group.traverse((o) => {
              const m = o.isMesh && o.material;
              if (m && m.vertexColors && m.polygonOffset && o.geometry.attributes.color) patches.push(o);
            });
          }
          const ray = new THREE.Raycaster();
          const DOWN = new THREE.Vector3(0, -1, 0);
          const WORD = { grass: 'grass', sand: 'sand', rock: 'dirt' };
          const expected = (x, z) => {
            if (patches.length) {
              ray.set(new THREE.Vector3(x, Terrain.heightAt(x, z) + 50, z), DOWN);
              ray.far = 200;
              const hits = ray.intersectObjects(patches, false);
              const hit = hits[0];
              if (hit && hit.face) {
                const wordOf = (h) => {
                  const c = h.object.geometry.attributes.color;
                  return c.getX(h.face.a) > c.getY(h.face.a) ? 'field' : 'grass';
                };
                /*
                 * Two patches at the same height. On the town's flat cut
                 * (62.66 m) every patch is laid at heightAt + 0.35, so where
                 * two overlap they are the same plane: measured at
                 * (1492,988), ploughed earth (patch 2) and pasture (patch 11)
                 * both hit at 63.01 m. The ray lists the earlier one first;
                 * the renderer, depth-testing less-or-equal, draws the later
                 * one over it where the depths come out equal, and the two
                 * speckle where rounding differs. Either word is what is on
                 * the screen there.
                 */
                const either = new Set();
                for (const h of hits) if (h.face && h.distance - hit.distance < 0.02) either.add(wordOf(h));
                return { what: either.size > 1 ? 'two crop patches at one height' : 'a crop patch', word: wordOf(hit), either };
              }
            }
            const p = painted(x, z);
            return p ? { what: `terrain painted ${p}`, word: WORD[p] } : null;
          };
          let n = 0;
          let notGrass = 0;
          let wrong = 0;
          let ties = 0;
          const bad = [];
          const words = {};
          const spots = [];
          for (let dx = -150; tg && dx <= 150; dx += 12) {
            for (let dz = -150; dz <= 150; dz += 12) {
              if (Math.hypot(dx, dz) >= 50) spots.push([tg.pos.x + dx, tg.pos.z + dz]);
            }
          }
          // The fields nearest the yard: the middles of the patchwork's
          // drawn triangles, nearest first, 20 m apart.
          let onFields = 0;
          if (tg) {
            const mids = [];
            for (const o of patches) {
              const P = o.geometry.attributes.position.array;
              const I = o.geometry.index ? o.geometry.index.array : null;
              if (!I) continue;
              for (let t = 0; t < I.length; t += 3) {
                if (I[t] === I[t + 1] || I[t + 1] === I[t + 2]) continue;
                const x = (P[I[t] * 3] + P[I[t + 1] * 3] + P[I[t + 2] * 3]) / 3;
                const z = (P[I[t] * 3 + 2] + P[I[t + 1] * 3 + 2] + P[I[t + 2] * 3 + 2]) / 3;
                mids.push([x, z, Math.hypot(x - tg.pos.x, z - tg.pos.z)]);
              }
            }
            mids.sort((a, b) => a[2] - b[2]);
            const took = [];
            for (const [x, z] of mids) {
              if (took.length >= 60) break;
              if (took.some(([ax, az]) => Math.hypot(ax - x, az - z) < 20)) continue;
              took.push([x, z]);
            }
            onFields = took.length;
            for (const q of took) spots.push(q);
          }
          for (const [x, z] of spots) {
            {
              const h = Terrain.heightAt(x, z);
              const nr = nearestRoad(x, z);
              if (!(h > 1) || (nr && nr.d < drawnHalf(nr.rd) + 6) || Terrain.obstacleAt(x, h + 1, z)) continue;
              const want = expected(x, z);
              if (!want) continue;
              releaseAll();
              v.reset({ pos: new THREE.Vector3(x, h, z), headingDeg: 0 });
              sim.step(1 / 30, 1 / 60);
              if (sim.runner.status !== 'running' || !v.surface || v.surface.kind !== 'grass') continue;
              const word = sim.hud.speedWord ? sim.hud.speedWord.textContent : '';
              n++;
              words[word] = (words[word] || 0) + 1;
              if (want.word !== 'grass') notGrass++;
              if (want.either && want.either.size > 1) ties++;
              if (word !== want.word && !(want.either && want.either.has(word))) {
                wrong++;
                if (bad.length < 5) bad.push(`${Math.round(x)},${Math.round(z)} ${want.what}, it said "${word}"`);
              }
            }
          }
          r.ok(
            'the word under the speed says what the ground looks like, round First Run\'s yard and on the fields nearest it',
            n >= 30 && notGrass > 0 && wrong === 0,
            `${n} spots the physics calls grass (${onFields} on the fields nearest the yard), ${notGrass} of them drawn as something else, ${ties} under two patches at one height: the word was wrong at ${wrong} — `
              + `${Object.entries(words).map(([k, c]) => `"${k}" ${c}`).join(', ')}${bad.length ? ` · ${bad.join(' · ')}` : ''}`
          );
        }

        // The job's card says what the sky is doing; the drive has to agree.
        const night = offered.find((j) => j.id === 'nightcall');
        const firstrun = offered.find((j) => j.id === 'firstrun');
        if (night) {
          r.ok(
            'Night Call-out is at night, in the rain',
            night.weather === 'night/rainy' && (!firstrun || firstrun.weather === 'day/clear'),
            `Night Call-out drove in ${night.weather}${firstrun ? `, First Run in ${firstrun.weather}` : ''}`
          );
        }
      }

      // ---- give up on the night job half way: the menu has its own sky ----
      // The pause menu's "Main menu" is quitToMenu, which does not go through
      // stopDrive; the front page stayed at night, in the rain.
      {
        releaseAll();
        sim.quitToMenu();
        sim.switchGame('car');
        const menuSky = `${sim.weather.time}/${sim.weather.condition}`;
        await sim.startDrive('car', { job: 'nightcall' });
        const v = sim.vehicle;
        drive(20, () => {
          press('go', kph(v) < 50);
          steerKeys(laneKeepSteer(v));
        });
        releaseAll();
        const jobSky = `${sim.weather.time}/${sim.weather.condition}`;
        sim.quitToMenu('main');
        sim.step(0.2);
        const after = `${sim.weather.time}/${sim.weather.condition}`;
        r.ok(
          'Night Call-out: night in the job, and the menu\'s own sky after quitting half way',
          jobSky === 'night/rainy' && after === menuSky,
          `menu ${menuSky}, twenty seconds into the job ${jobSky}, back at the menu ${after}`
        );
      }

    }

    /* ================================== every job on every car island == */
    /*
     * The same driver, the same arrow, on each of the car game's islands in
     * turn: every job the board offers there, start to finish. Off by
     * default — it is about forty minutes of game time — and asked for with
     * { allMaps: true }, or { allMaps: ['cape', 'cullen'] } for some of them.
     */
    if (opts.allMaps) {
      say('every job on every island');
      const Maps = await import('../../src/world/maps.js');
      const Jobs = await import('../../src/game/jobs.js');
      const was = sim.gameMap && sim.gameMap.car;
      const rows = [];
      let offeredN = 0;
      let doneN = 0;
      let lowRoad = 0;
      const summitOn = [];
      const roadsBad = [];
      // The highest the wheels left the drawn ground on any job, and every
      // job where they left it by more than 30 cm (a hop you see).
      let worstLift = { lift: 0, where: '' };
      let worstAir = { t: 0, where: '' };
      const thrown = [];
      const roadRows = [];
      // And the kid who only reads the screen ({ screenKid: false } skips it).
      const kidRows = [];
      let kidN = 0;
      let kidDone = 0;
      let kidFar = { d: 0, where: '' };
      let kidStalls = 0;
      try {
        const pick = Array.isArray(opts.allMaps) ? opts.allMaps : null;
        for (const m of Maps.MAPS.filter((q) => q.game === 'car' && (!pick || pick.includes(q.id)))) {
          sim.gameMap.car = m.id;
          await freshDrive();
          const look = measureRoads();
          if (look) {
            if (!look.groundOk || !look.levelOk) roadsBad.push(m.id);
            roadRows.push(`${m.id}: ${look.hidden + look.floating} of ${look.samples} off the ground, ${look.draped} of ${look.falls} draped${look.draped ? ' — ' + look.levelSays : ''}`);
          }
          const board = Jobs.jobsFor(sim);
          for (const e of board) {
            if (!e.available) {
              rows.push(`${m.id}/${e.job.id}: off the board (${e.why})`);
              continue;
            }
            if (e.job.id === 'summit') summitOn.push(m.id);
            // { only: ['cape/summit', ...] } plays just those, for chasing one.
            if (opts.only && !opts.only.includes(`${m.id}/${e.job.id}`)) continue;
            offeredN++;
            const j = await playJob(e.job.id, false);
            const share = j.onRoad / Math.max(j.n, 1);
            if (j.done) doneN++;
            if (share < 0.8) lowRoad++;
            if (j.maxLift > worstLift.lift) worstLift = { lift: j.maxLift, where: `${m.id}/${j.id} at ${j.liftAt}` };
            if (j.longestAir > worstAir.t) worstAir = { t: j.longestAir, where: `${m.id}/${j.id} at ${j.airAt}` };
            if (j.maxLift >= 0.5 || j.longestAir >= 0.2) {
              thrown.push(
                `${m.id}/${j.id}: ${j.maxLift.toFixed(2)} m up at ${j.liftAt}`
                  + (j.longestAir ? `, ${j.longestAir.toFixed(2)} s in the air at ${j.airAt}` : '')
              );
            }
            if (opts.screenKid !== false) {
              const k = await hudKid(e.job.id);
              kidN++;
              if (k.done) kidDone++;
              kidStalls += k.stalls;
              if (k.arrivingOut > kidFar.d) kidFar = { d: k.arrivingOut, where: `${m.id}/${k.id}` };
              kidRows.push(`${m.id}/${k.id}: ${k.done ? 'done' : 'NOT done'} ${k.t.toFixed(0)} s, score ${k.score}`
                + (k.backT ? `, BACK UP ${k.backT.toFixed(1)} s` : '')
                + (k.stalls ? `, stuck under ARRIVING ${k.stalls}× (${k.stallAt})` : ''));
            }
            rows.push(
              `${m.id}/${j.id}: ${j.done ? 'done' : 'NOT done at "' + j.lastStep + '"'} ${j.t.toFixed(0)} s, `
                + `${Math.round(100 * share)}% tarmac, pips ${j.pips}${j.stuck ? `, stuck ${j.stuck}x` : ''}`
                + `, wheels up ${j.maxLift.toFixed(2)} m${j.longestAir ? ` (${j.longestAir.toFixed(2)} s airborne)` : ''}`
                + (j.knocks && j.knocks.length ? ` (${(opts.where && j.knockAt ? j.knockAt : j.knocks).join(', ')})` : '')
            );
          }
        }
      } finally {
        sim.gameMap.car = was;
      }
      r.ok(
        'every job on every car island, by following the arrow',
        offeredN > 0 && doneN === offeredN && lowRoad === 0,
        `${doneN} of ${offeredN} offered jobs delivered, ${lowRoad} under 80% on the tarmac · ` + rows.join(' · ')
      );
      /*
       * Following the arrow never throws the van off the road: never half a
       * metre over the ground it rides, never a fifth of a second in the air.
       *
       * The reviewer's measurement on the first pass: on Airfield Perimeter
       * the Perimeter Loop left the airfield plateau down a 45% ramp at x
       * -225 to -185, and the arrow driver, downhill at 113-116 km/h, left
       * the ground by 0.62 and 0.72 m for about 0.6 s at a time. Measured
       * again at the start of the repair with this check: 2.46 m there on
       * four jobs, and 3.52 m on three of Cape Vessel's, over a 34 m drop at
       * the edge of its airfield. A seam in the ground (two roads' corridors
       * meeting at different heights, see roadHeight in terrain.js) is
       * ridden down as a short ramp and shows here as a brief lift of a few
       * tenths with no time in the air; that is why the line is at half a
       * metre and not at the suspension's 20 cm.
       */
      r.ok(
        'every car island: following the arrow never throws the van off the road',
        offeredN > 0 && thrown.length === 0,
        thrown.length
          ? `thrown on ${thrown.length} jobs: ${thrown.join(' · ')}`
          : `highest the wheels went over the ground they ride on any job: ${worstLift.lift.toFixed(2)} m (${worstLift.where || 'nowhere'}); `
            + `longest in the air: ${worstAir.t.toFixed(2)} s${worstAir.where ? ` (${worstAir.where})` : ''}`
      );
      if (opts.screenKid !== false) {
        r.ok(
          'every job on every car island, doing only what the screen says (W held, stopping and waiting at ARRIVING)',
          kidN > 0 && kidDone === kidN && kidStalls === 0 && kidFar.d <= 34.5,
          `${kidDone} of ${kidN} delivered, ARRIVING at most ${kidFar.d.toFixed(1)} m from the target (${kidFar.where || '-'}), `
            + `${kidStalls} waits under ARRIVING for nothing · ${kidRows.join(' · ')}`
        );
      }
      r.ok(
        'roads on every car island: on the ground and level across',
        roadRows.length > 0 && roadsBad.length === 0,
        roadRows.join(' · ')
      );
      if (opts.allMaps === true) r.ok(
        'the Summit Relay is offered somewhere',
        summitOn.length > 0,
        summitOn.length ? `on ${summitOn.join(', ')}` : 'on none of the car islands'
      );
    }

    /* ============================================ over the whole session == */
    r.ok(
      'the camera never went inside a hill, and could always see the van',
      cam.samples > 50 && cam.worstClear >= 1.2 && cam.blocked / cam.samples <= 0.01,
      `${cam.samples} samples: lowest ${cam.worstClear.toFixed(2)} m above the ground, van hidden behind terrain in ${cam.blocked}`
    );
    const aero = said.filter((s) => /\b(fly|flew|flight|runway|altitude|airspeed|aeroplane|plane|autopilot|stall)\b/i.test(s.msg));
    r.ok(
      'only car things: nothing about flying was said in the van',
      aero.length === 0,
      aero.slice(0, 5).map((s) => `"${s.msg}"`).join(' | ') || `${said.length} messages, every one about driving`
    );

    // ---- and the aeroplane gets its HUD back ----
    // The way a child leaves the van for the aeroplane: the game switcher.
    // First the van, so the rows have the van's numbers in them.
    releaseAll();
    if (!sim.vehicle) {
      await freshDrive();
      drive(3, () => press('go', true));
      releaseAll();
    }
    sim.switchGame('flight');
    /*
     * The first frame of the flight after it, before an update: the reviewer
     * read "AIRSPEED 99 kt tarmac" over the aeroplane.
     */
    {
      await sim.startMode('free', {});
      const hud = sim.hud;
      const row = [hud.speedValue, hud.speedWord, hud.altValue, hud.altWord].map((n) => (n ? n.textContent : '')).join(' ');
      r.ok(
        'the first frame of a flight after the van has none of the van\'s numbers',
        !/tarmac|grass|gravel|to the|travelled|km/i.test(row),
        `speed and height rows before the first update: "${row.trim() || '(blank until the first frame)'}"`
      );
      sim.quitToMenu('main');
      sim.switchGame('flight');
    }
    {
      const hud = sim.hud;
      const gone = [
        ['POWER bar', hud.throttleBar && hud.throttleBar.root],
        ['BRAKES chip', hud.brakeChip],
        ['EASY MODE chip', hud.modeChip],
        ['GEAR chip', hud.gearChip],
        ['FLAPS chip', hud.flapChip],
        ['wind panel', hud.windRose && (hud.windRose.closest('.hud-right') || hud.windRose)],
        ['Guidance button', hud.btnGuide],
        ['Autopilot button', hud.btnAuto],
        ['Brace for impact button', hud.btnBrace],
      ]
        .filter(([, n]) => n && (n.style.display === 'none' || n.hidden))
        .map(([k]) => k);
      if (hud.btnAirport && !/airfield/i.test(hud.btnAirport.textContent)) gone.push(`the tray's airfield button reads "${hud.btnAirport.textContent.trim()}"`);
      const hint = hud.wrap.querySelector('.hud-keyhint');
      const cls = Array.from(hud.wrap.classList).filter((c) => /drive|vehicle/.test(c));
      r.ok(
        'hud: the aeroplane rows come back after the van',
        gone.length === 0 && !!hint && /power/i.test(hint.textContent) && cls.length === 0,
        gone.length || cls.length
          ? `still hidden: ${gone.join(', ') || 'none'}; still wearing ${cls.join(' ') || 'nothing'}`
          : 'POWER, BRAKES, EASY MODE, GEAR, FLAPS, the wind and the tray\'s aeroplane buttons are all back, and the flight key hint'
      );
    }
    const skyAfter = sim.weather ? `${sim.weather.time}/${sim.weather.condition}` : '';
    r.ok(
      'the sky a job borrowed is put back afterwards',
      skyAfter === skyBefore,
      `${skyBefore} before the van, ${skyAfter} after it`
    );
    return { jobs, said };
  } finally {
    releaseAll();
    sim.hud.notify = origNotify;
    if (typeof origSimNotify === 'function') sim.notify = origSimNotify;
    try {
      sim.quitToMenu();
    } catch (e) {
      /* a menu that will not open is not this test's business */
    }
    sim.autoPauseOnHide = origAutoPause;
    sim.renderer.render = realRender;
  }
}

export default check;
