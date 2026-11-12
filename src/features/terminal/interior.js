/**
 * One terminal's inside, standing in the world: built a step at a time on the
 * way to the doors (features/walk-in.js decides when), opened, closed, thrown
 * away. See plan.js for the building and look.js for the drawing.
 *
 * OPENING IT. Outside, the terminal is a solid box with a solid crash obstacle:
 * world/apron.js draws its hall and the bands under its glass as part of two
 * merged meshes. Open, those few triangles are folded away (apron.shellCut says
 * which) and bands with door holes stand in, the door lobbies lose their black
 * lining, the walker stops seeing the crash box and has this building's own
 * walls, and the floor is this building's (a second storey and stairs).
 * close() puts every bit of it back. A walker is the only thing that ever sees
 * it: an aeroplane still flies into the box.
 */
import * as THREE from '../../vendor/three.module.js';
import { AIRPORT, OBSTACLES } from '../../world/terrain.js';
import { MAPS } from '../../world/maps.js';
import { makeRandom } from '../../core/noise.js';
import { AIRLINE_LIVERIES, radioBrand } from '../../aircraft/liveries.js';
import { forgetObstacles, setFloorHook } from '../staff/walk.js';
import { onFoot } from '../onfoot.js';
import { Crowd } from '../life/people.js';
import { planInterior, fromWorld, floorIn, UP, FLOOR, CEIL, CEIL_LOW } from './plan.js';
import { Atlas, floorTexture, ceilingTexture, boardCanvas, drawBoard, passengerAirlines } from './atlas.js';
import { buildRoom, outerBands } from './look.js';
import { kerbPalms } from './dress.js';
import { warmShadersAsync } from '../../render/shader-warm.js';

const CELL = 6;
const STRIDE = 3.9;
/** People by tier. */
const PEOPLE = { low: 26, medium: 44, high: 70, ultra: 100 };
const BOARD_EVERY = 12;

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** A grid of world boxes { x0, x1, z0, z1, y0, y1, tag }, for what is near a point. */
export class BoxGrid {
  constructor() {
    this.cells = new Map();
    this.stamp = 0;
  }

  add(q) {
    q.mark = 0;
    const i0 = Math.floor(q.x0 / CELL);
    const i1 = Math.floor(q.x1 / CELL);
    const j0 = Math.floor(q.z0 / CELL);
    const j1 = Math.floor(q.z1 / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = i * 100003 + j;
        let l = this.cells.get(k);
        if (!l) this.cells.set(k, (l = []));
        l.push(q);
      }
    }
  }

  /** Each box within r of (x, z), once. */
  near(x, z, r, fn) {
    this.stamp++;
    const i0 = Math.floor((x - r) / CELL);
    const i1 = Math.floor((x + r) / CELL);
    const j0 = Math.floor((z - r) / CELL);
    const j1 = Math.floor((z + r) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const l = this.cells.get(i * 100003 + j);
        if (!l) continue;
        for (let k = 0; k < l.length; k++) {
          const q = l[k];
          if (q.mark === this.stamp) continue;
          q.mark = this.stamp;
          fn(q);
        }
      }
    }
  }

  /** Is the point inside (or within r of) any box? */
  at(x, y, z, r) {
    const l = this.cells.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
    if (!l) return false;
    for (let k = 0; k < l.length; k++) {
      const q = l[k];
      if (y < q.y0 || y > q.y1) continue;
      if (x > q.x0 - r && x < q.x1 + r && z > q.z0 - r && z < q.z1 + r) return true;
    }
    return false;
  }
}

/** The flights on the boards: what is really on the stands, then what is really moving. */
export function flightRows(sim, P, nowMin) {
  const ap = sim.apron;
  const rows = [];
  const places = MAPS.map((m) => m.name).filter((n) => n && !/preview|world map/i.test(n));
  const to = (i) => places[(i * 7 + 3) % places.length] || 'Kestrel Island';
  const clock = (m) => {
    const t = Math.floor(m) % 1440;
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  };
  const parked = (ap && ap.parked) || [];
  const lines = passengerAirlines();
  let i = 0;
  for (const g of P.gates) {
    if (!g.stand || !g.stand.occupant) continue;
    // What is parked there, in its own paint; Low parks nothing, but the stand still has its flight.
    const p = parked.find((q) => q.stand === g.stand);
    const id = p ? String(p.key || '').split('|')[1] : '';
    const l = AIRLINE_LIVERIES.find((q) => q.id === id) || (p ? null : lines[g.number % lines.length]);
    if (!l) continue;
    const n = 100 + ((g.number * 37 + l.id.length * 11) % 800);
    const left = 12 + i * 14 - (nowMin % 60) * 0.2;
    rows.push({
      time: clock(nowMin + Math.max(4, left)),
      flight: `${radioBrand(l)} ${n}`,
      to: to(g.number + i),
      gate: g.number,
      status: left < 10 ? 'Final call' : left < 22 ? 'Boarding' : 'On time',
    });
    i++;
  }
  const tr = Array.isArray(sim.traffic) ? sim.traffic : [];
  for (const t of tr) {
    if (!t || !t.callsign || rows.length >= 10) continue;
    if (t.phase === 'parked' || t.phase === 'cruise') continue;
    rows.push({
      time: clock(nowMin + rows.length * 3),
      flight: t.callsign,
      to: to(rows.length + 5),
      gate: '-',
      status: t.onGround ? 'Taxiing' : 'Departed',
    });
  }
  return rows;
}

export class Interior {
  constructor(sim, lay) {
    this.sim = sim;
    this.lay = lay;
    this.P = planInterior(lay);
    this.e = AIRPORT.elev;
    this.tier = (sim.settings && sim.settings.quality) || 'high';
    this.low = this.tier === 'low';
    this.group = new THREE.Group();
    this.group.name = 'terminal:inside';
    this.group.visible = false;
    this.ready = false;
    this.open = false;
    this.failed = false;
    this.grid = new BoxGrid();
    this.textures = [];
    this.materials = [];
    this.people = [];
    this.crowd = null;
    this.saved = null;
    this.boardT = 0;
    this.gen = this.steps();
    this.stepsDone = 0;
    this.longestStep = 0;
    this.boardCanvas = null;
    this.boardTex = null;
    this.hook = (x, z, y) => {
      const q = fromWorld(this.P, x, z);
      const f = floorIn(this.P, q.u, q.b, y - this.e);
      return f === null ? null : f + this.e;
    };
  }

  /** Run steps for up to `ms` this frame; true when it is all done. */
  pump(ms = 3) {
    if (this.ready || this.failed) return this.ready;
    if (this.waiting) return false;
    const t0 = performance.now();
    do {
      const s0 = performance.now();
      let r;
      try {
        r = this.gen.next();
      } catch (e) {
        console.warn('[walk-in] the inside did not build; the terminal stays shut', e);
        this.failed = true;
        return false;
      }
      this.longestStep = Math.max(this.longestStep, performance.now() - s0);
      this.stepsDone++;
      if (r.done) {
        this.ready = true;
        return true;
      }
    } while (performance.now() - t0 < ms && !this.waiting);
    return false;
  }

  *steps() {
    const P = this.P;
    const e = this.e;
    const atlas = new Atlas(this.low);
    yield* atlas.cells(P);
    const sheet = atlas.texture();
    const floorT = floorTexture();
    yield;
    const ceilT = ceilingTexture();
    this.textures.push(sheet, floorT, ceilT);
    const basic = (o) => {
      const m = new THREE.MeshBasicMaterial({ fog: false, ...o });
      this.materials.push(m);
      return m;
    };
    const out = {};
    yield* buildRoom(P, atlas, e, out);
    const add = (bake, mat, name) => {
      const m = bake.mesh(mat, name);
      if (m) this.group.add(m);
      return m;
    };
    this.fit = add(out.fit, basic({ map: sheet, vertexColors: true, color: 0xdcdcdc }), 'inside:fittings');
    // It does not rain in here: drawn before the rain, so the rain's own update cannot undo it.
    this.fit.onBeforeRender = () => {
      const rain = this.indoors && this.sim.rain;
      if (rain && rain.material) rain.material.uniforms.uOpacity.value = 0;
    };
    yield;
    add(out.floor, basic({ map: floorT, vertexColors: true, color: 0xcfcdc8 }), 'inside:floors');
    add(out.ceil, basic({ map: ceilT, vertexColors: true, color: 0xe4e4e4 }), 'inside:ceilings');
    const glass = add(out.glass, basic({ vertexColors: true, transparent: true, opacity: 0.1, depthWrite: false }), 'inside:glass');
    if (glass) glass.renderOrder = 2;
    yield;
    this.boardCanvas = boardCanvas();
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    drawBoard(this.boardCanvas, 'Departures', flightRows(this.sim, P, nowMin));
    this.boardTex = new THREE.CanvasTexture(this.boardCanvas);
    this.boardTex.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(this.boardTex);
    add(out.board, basic({ map: this.boardTex, vertexColors: true, toneMapped: false }), 'inside:boards');
    yield;
    this.buildKerb(out, sheet);
    this.extraSolids = out.solids || [];
    this.buildGrid();
    yield;
    this.buildDoors();
    this.bands = outerBands(P, this.sim.apron, e);
    if (this.bands) {
      this.bands.visible = false;
      this.sim.apron.group.add(this.bands);
    }
    yield;
    this.buildPeople();
    yield;
    // Up to the GPU one a frame, and the programs linked off the main thread, before anybody looks.
    const r = this.sim.renderer;
    for (const t of this.textures) {
      if (r && r.initTexture) r.initTexture(t);
      yield;
    }
    if (r && this.sim.camera && this.sim.scene) {
      this.waiting = true;
      const done = () => {
        this.waiting = false;
      };
      warmShadersAsync(r, this.group, this.sim.camera, this.sim.scene, { show: [this.group] }).then(done, done);
      yield;
    }
  }

  buildGrid() {
    const P = this.P;
    const F = P.F;
    const fz = (b) => F.z(P.T.front + b);
    for (const s of [...P.solids, ...(this.extraSolids || [])]) {
      const xa = F.x(s.u0);
      const xb = F.x(s.u1);
      const za = fz(s.b0);
      const zb = fz(s.b1);
      this.grid.add({
        x0: Math.min(xa, xb), x1: Math.max(xa, xb), z0: Math.min(za, zb), z1: Math.max(za, zb),
        y0: this.e + s.y0, y1: this.e + s.y1, tag: s.tag,
      });
    }
  }

  /**
   * The kerb's planting and signs (dress.js): outside the building, so in the
   * sun's light and the night's, and out from the moment they are built, not
   * from the moment the doors open: trees do not appear at seventy metres.
   * Only ever on foot: back in the seat the first frame puts them away.
   */
  buildKerb(out, sheet) {
    const ap = this.sim.apron;
    const g = new THREE.Group();
    g.name = 'terminal:kerb';
    const lit = out.kerb && ap && ap.mats && ap.mats.vc ? out.kerb.mesh(ap.mats.vc, { name: 'kerb:planting', cast: !this.low }) : null;
    if (lit) g.add(lit);
    const palms = kerbPalms(out.palms, !this.low);
    if (palms) {
      this.materials.push(palms.material);
      g.add(palms);
    }
    const signs = out.kerbSigns && out.kerbSigns.mesh(new THREE.MeshBasicMaterial({ map: sheet, vertexColors: true, color: 0xdcdcdc }), 'kerb:signs');
    if (signs) {
      this.materials.push(signs.material);
      g.add(signs);
    }
    // Asked every frame it is out (never culled, so never skipped): is anybody still on foot?
    const last = g.children[g.children.length - 1];
    if (last) {
      last.frustumCulled = false;
      last.onBeforeRender = () => {
        if (!onFoot.active) g.visible = false;
      };
    }
    this.kerb = g;
    this.sim.apron.group.add(g);
  }

  /** A second pair of sliding doors at the wall inside each lobby: frosted, so the lobby is its own space. */
  buildDoors() {
    const P = this.P;
    const n = P.doors.length;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xb9ccd6, transparent: true, opacity: 0.72, fog: false });
    this.materials.push(mat);
    const mesh = new THREE.InstancedMesh(geo, mat, n * 2);
    mesh.name = 'inside:doors';
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.doorGeo = geo;
    this.doorMesh = mesh;
    this.doors = P.doors.map((d) => ({ d, open: 0 }));
    this.doors.forEach((_, i) => this.poseDoor(i));
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }

  poseDoor(i) {
    const { d, open } = this.doors[i];
    const P = this.P;
    const b = d.side === 'air' ? 0.16 : P.D - 0.16;
    const z = P.F.z(P.T.front + b);
    for (let k = 0; k < 2; k++) {
      const s = k ? 1 : -1;
      const x = d.x + s * (d.hw / 2 + d.hw * 0.96 * open);
      _m.compose(_p.set(x, this.e + d.h / 2, z), _q.identity(), _s.set(d.hw, d.h, 0.07));
      this.doorMesh.setMatrixAt(i * 2 + k, _m);
    }
  }

  buildPeople() {
    const P = this.P;
    const max = PEOPLE[this.tier] || PEOPLE.high;
    const rnd = makeRandom(4021);
    const list = [];
    const e = this.e;
    const add = (u, b, y, fu, fb, o = {}) => {
      if (list.length >= max) return null;
      const x = P.F.x(u);
      const z = P.F.z(P.T.front + b);
      const dx = P.F.x(u + fu) - x;
      const dz = P.F.z(P.T.front + b + fb) - z;
      const person = {
        x, y: e + y, z, yaw: Math.atan2(-dx, -dz), walk: rnd() * 6, moving: false, shift: rnd() * 6,
        outfit: 5, bag: rnd() < 0.45, hidden: false, look: Math.floor(rnd() * 997), sit: false, route: null, ...o,
      };
      list.push(person);
      return person;
    };
    // Queues and check-in staff first: they say what the hall is for.
    for (const isl of P.islands) {
      const c = isl.u0 + (rnd() * 0.6 + 0.2) * (isl.u1 - isl.u0);
      add(c, isl.b - 0.2, FLOOR, 0, 1, { outfit: 7, bag: false });
      const q = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < q; i++) add(c + (rnd() - 0.5) * 0.4, isl.b + 1.5 + i * 0.95, FLOOR, 0, -1);
    }
    for (const l of P.sec.lanes) {
      if (l.id % 2) add(l.u + 2, P.B + 0.5, FLOOR, 0, -1);
      if (l.id === 2) add(l.u + 2, P.B - 3.8, FLOOR, 0, 1, { outfit: 7, bag: false });
    }
    // A few on the move, downstairs and up.
    const movers = Math.round(max * 0.3);
    for (let i = 0; i < movers; i++) {
      const r = P.routes[i % P.routes.length];
      const t = rnd();
      const a = r.pts[0];
      const c = r.pts[1];
      const p = add(a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, r.y, 1, 0, { route: r, t, dir: rnd() < 0.5 ? 1 : -1, v: 1.05 + rnd() * 0.45, moving: true, outfit: i % 9 === 8 ? 6 : 5 });
      if (p) p.len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    }
    // And the gates fill up.
    for (const q of P.seatBlocks) {
      const n = Math.round((q.u1 - q.u0) / 0.62);
      const w = (q.u1 - q.u0) / n;
      for (let i = 0; i < n; i++) {
        if (rnd() > 0.34) continue;
        const s = rnd() < 0.5 ? -1 : 1;
        add(q.u0 + (i + 0.5) * w, q.b + s * 0.42, UP + FLOOR, 0, s, { sit: true, bag: false });
      }
    }
    this.people = list;
    this.crowd = new Crowd(Math.max(1, list.length), { simple: this.low, rnd, indoor: true });
    this.crowd.mesh.frustumCulled = false;
    this.crowd.group.name = 'inside:people';
    this.group.add(this.crowd.group);
  }

  stepPeople(dt, cam) {
    const F = this.P.F;
    const front = this.P.T.front;
    for (const p of this.people) {
      const r = p.route;
      if (!r) continue;
      p.t += (p.dir * p.v * dt) / p.len;
      if (p.t > 1 || p.t < 0) {
        p.dir = -p.dir;
        p.t = Math.max(0, Math.min(1, p.t));
      }
      const a = r.pts[0];
      const c = r.pts[1];
      const u = a[0] + (c[0] - a[0]) * p.t;
      const b = a[1] + (c[1] - a[1]) * p.t;
      const x = F.x(u);
      const z = F.z(front + b);
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx || dz) p.yaw = Math.atan2(-dx, -dz);
      p.x = x;
      p.z = z;
      p.walk += p.v * dt * STRIDE;
    }
    if (this.crowd) this.crowd.draw(this.people, cam);
  }

  /** The parts of the apron's merged meshes this building replaces. */
  parts() {
    const ap = this.sim.apron;
    const g = ap && ap.group;
    if (!g || !ap.shellCut) return [];
    const out = [];
    const wall = g.getObjectByName('terminal-walls');
    const vc = g.getObjectByName('apron-structures');
    if (wall) out.push([wall, [ap.shellCut.wall]]);
    if (vc) out.push([vc, ap.shellCut.vc]);
    return out;
  }

  /** Into the world: see the note at the top. */
  show() {
    if (this.open || !this.ready) return false;
    const ap = this.sim.apron;
    this.saved = [];
    for (const [mesh, ranges] of this.parts()) {
      const pos = mesh.geometry.attributes.position;
      for (const [a, b] of ranges) {
        const span = pos.array.slice(a * 3, b * 3);
        this.saved.push({ pos, a, span });
        pos.array.fill(0, a * 3, b * 3);
        pos.addUpdateRange(a * 3, (b - a) * 3);
      }
      pos.needsUpdate = true;
    }
    this.lining = ap.group.getObjectByName('terminal-door-lining');
    if (this.lining) this.lining.visible = false;
    if (this.bands) this.bands.visible = true;
    this.marked = OBSTACLES.filter((o) => /the terminal$/.test(o.what || '') && o.y0 < this.e + 3);
    for (const o of this.marked) o.walkIn = true;
    forgetObstacles();
    setFloorHook(this.hook);
    this.group.visible = true;
    if (this.kerb) this.kerb.visible = true;
    this.open = true;
    return true;
  }

  /** Out of the world: everything as it was. */
  hide() {
    if (!this.open) return;
    this.open = false;
    this.group.visible = false;
    setFloorHook(null);
    for (const o of this.marked || []) o.walkIn = false;
    this.marked = null;
    forgetObstacles();
    for (const s of this.saved || []) {
      s.pos.array.set(s.span, s.a * 3);
      s.pos.addUpdateRange(s.a * 3, s.span.length);
      s.pos.needsUpdate = true;
    }
    this.saved = null;
    if (this.lining) this.lining.visible = true;
    if (this.bands) this.bands.visible = false;
  }

  /** Is (x, z) under this roof? */
  under(x, z) {
    const q = fromWorld(this.P, x, z);
    return q.u > this.P.cu0 && q.u < this.P.cu1 && q.b > 0 && q.b < this.P.D;
  }

  /** May the camera be here? Not in a wall, a floor or a ceiling. */
  camBlocked(x, y, z) {
    if (this.grid.at(x, y, z, 0.15)) return true;
    const q = fromWorld(this.P, x, z);
    const P = this.P;
    if (q.u < P.cu0 || q.u > P.cu1 || q.b < 0 || q.b > P.D) return false;
    const Y = y - this.e;
    if (Y > CEIL - 0.25) return true;
    if (q.b < P.B && Y > CEIL_LOW - 0.1 && Y < UP + 0.3) {
      return !P.holes.some((h) => q.u > h.u0 && q.u < h.u1 && q.b > h.b0 && q.b < h.b1);
    }
    return false;
  }

  /** Every frame it is open. */
  update(dt, walker, cam) {
    const list = this.sim.apron && this.sim.apron.doors;
    let moved = false;
    for (let i = 0; i < this.doors.length; i++) {
      const D = this.doors[i];
      const q = D.d;
      const near = Math.hypot(q.x - walker.x, q.z - walker.z) < 5.5 && walker.y < this.e + 3;
      if (near && list && list[q.id] && this.sim.apron.wantDoor) this.sim.apron.wantDoor(q.id);
      const target = near ? 1 : 0;
      if (D.open !== target) {
        D.open = target > D.open ? Math.min(1, D.open + dt * 1.6) : Math.max(0, D.open - dt * 1.2);
        this.poseDoor(i);
        moved = true;
      }
    }
    if (moved) this.doorMesh.instanceMatrix.needsUpdate = true;
    this.stepPeople(dt, cam);
    this.boardT -= dt;
    if (this.boardT <= 0) {
      this.boardT = BOARD_EVERY;
      const now = new Date();
      drawBoard(this.boardCanvas, 'Departures', flightRows(this.sim, this.P, now.getHours() * 60 + now.getMinutes()));
      this.boardTex.needsUpdate = true;
    }
  }

  dispose() {
    this.hide();
    if (this.crowd) this.crowd.dispose();
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    if (this.doorMesh) this.doorMesh.dispose();
    for (const t of this.textures) t.dispose();
    for (const m of this.materials) m.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
    if (this.bands) {
      this.bands.geometry.dispose();
      if (this.bands.parent) this.bands.parent.remove(this.bands);
    }
    if (this.kerb) {
      for (const o of this.kerb.children) {
        o.geometry.dispose();
        if (o.isInstancedMesh) o.dispose();
      }
      if (this.kerb.parent) this.kerb.parent.remove(this.kerb);
      this.kerb = null;
    }
    this.textures = [];
    this.materials = [];
    this.people = [];
  }
}

export function createInterior(sim, lay) {
  return new Interior(sim, lay);
}
