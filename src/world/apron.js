/**
 * The apron: a working airport rather than a shed beside a runway.
 *
 * The terminal with its gates, a jet bridge on every contact stand, the stand
 * markings, the airliners parked at the gates, and the crews working them: a
 * pushback tug pinned to each nose leg, a stair truck at the back door, a
 * catering truck whose box rises on its scissor to the galley door and comes
 * down again, a belt loader at the forward hold with a baggage train
 * trundling round between it and the terminal, a fuel bowser under the wing
 * with its hose out, a ground power unit, cones at the wingtips. And a
 * follow-me van doing laps of the apron.
 *
 * All of it sits where airport-layout.js says the stands are, so it is the
 * same airport on a 450 m strip and on a 3.9 km one, just more of it.
 *
 * THE PARKED AEROPLANES are built by the same factory as the one you fly, so
 * a Meridian at the gate really is a Meridian — and then baked (airport-kit)
 * from 48 draw calls to 7, and instanced, so a second Meridian in the same
 * paint costs nothing.
 *
 * THE VEHICLES are one InstancedMesh per kind. Twenty tugs are one draw call.
 * What moves each frame is a handful of matrices; nothing allocates.
 *
 * YOUR AEROPLANE: a spare crew waits out of sight. The airport-services
 * feature (src/features/airport-services.js) calls callCrew() when you stop
 * on a stand and ask for it, and they drive out from behind the terminal to
 * your doors. See that file for the pushback.
 */

import * as THREE from '../vendor/three.module.js';
import { AIRPORT, MAP, addObstacleAt } from './terrain.js';
import { buildingTexture, roofTexture } from '../render/textures.js';
import { createAircraftModel } from '../aircraft/model-adapter.js';
import { LIVERIES, schemeFor } from '../aircraft/liveries.js';
import { AIRCRAFT, specFor } from '../aircraft/types.js';
import { airportLayout, NOSE_STOP } from './airport-layout.js';
import { OFFICE_TILE, officeFloors } from './airport.js';
import { Batch, vcMaterial, instanced, glowPoints, canvas, canvasTexture, trs, trse, yawOf, bakeModel, layer } from './airport-kit.js';
import * as V from './airport-vehicles.js';

/*
 * Field elevation, read once at import — which was Kestrel's, on every map.
 * The terminal, the air bridges, the parked aeroplanes and the service
 * vehicles all built themselves at the wrong height everywhere else.
 */
let ELEV = AIRPORT.elev;

/** Called from main.js after applyMap(), before the world is rebuilt. */
export function refreshApronElevation() {
  ELEV = AIRPORT.elev;
  return ELEV;
}

const D2R = Math.PI / 180;
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/* ------------------------------------------------------------------ */
/* An aeroplane's frame, and where its doors are                       */
/* ------------------------------------------------------------------ */

/**
 * A parked aeroplane's frame on the ground: origin, heading, forward and
 * right vectors, and its measurements (`info`, in its own frame).
 */
function makeTarget(x, z, headingDeg, info) {
  const h = headingDeg * D2R;
  return {
    ox: x,
    oy: ELEV + info.ground,
    oz: z,
    heading: headingDeg,
    fx: Math.sin(h),
    fz: -Math.cos(h),
    rx: Math.cos(h),
    rz: Math.sin(h),
    info,
  };
}

/** A point in the aeroplane's frame (x right, y up, z aft), in the world. */
function local(tg, lx, ly, lz, out = { x: 0, y: 0, z: 0 }) {
  out.x = tg.ox + tg.rx * lx - tg.fx * lz;
  out.y = tg.oy + ly;
  out.z = tg.oz + tg.rz * lx - tg.fz * lz;
  return out;
}

/**
 * Doors and holds from a bake: front door at the start of the parallel
 * fuselage, rear door at its end, sills a third of a radius below the
 * centreline (where the floor is), the forward hold a third of the way back.
 */
function infoFromMeasure(meas, typeId) {
  const b = meas.body;
  const hw = b.halfWidth;
  const yc = b.centreY;
  const spec = specFor(typeId);
  const lowest = spec.gearPoints.reduce((m, g) => Math.min(m, g.pos.y), 0);
  const nose = spec.gearPoints.find((g) => g.name === 'nose') || spec.gearPoints[0];
  return {
    typeId,
    ground: -lowest,
    hw,
    yc,
    noseZ: meas.box.min.z,
    tailZ: meas.box.max.z,
    frontDoorZ: b.front + Math.min(1.5, (b.rear - b.front) * 0.08),
    rearDoorZ: b.rear - Math.min(1.8, (b.rear - b.front) * 0.08),
    holdZ: b.front + (b.rear - b.front) * 0.3,
    sill: yc - 0.3 * hw,
    holdSill: yc - 0.8 * hw,
    halfSpan: meas.halfSpan,
    wingTipZ: meas.wingTipZ,
    wingLE: meas.wingLE,
    noseGear: { x: nose.pos.x, y: nose.pos.y, z: nose.pos.z },
  };
}

/**
 * The same numbers for an aeroplane nobody measured: worked out from its
 * roster shape, the way types.js works out its wheels. Used for traffic
 * parked on a stand, where baking every visitor would be a hitch each time.
 * Checked against the bake on the Meridian: half-width 1.67 vs 1.68 measured,
 * nose -7.2 vs -7.06.
 *
 * Nose, tail and span come from the type's `plan` (the drawn aeroplane from
 * above) where it has one: the shape's proportions are the original eight's,
 * and put an A320's nose 6.5 m inside the drawn one and a 747's 14 m. The
 * node check bakes every roster type and holds this to the drawing.
 */
const estimates = new Map();
export function estimateInfo(typeId) {
  if (estimates.has(typeId)) return estimates.get(typeId);
  const t = AIRCRAFT.find((a) => a.id === typeId);
  if (!t) return null;
  const s = t.shape;
  const sc = s.scale || 1;
  const bl = s.bodyLength || 1;
  const p = t.plan;
  const noseZ = p ? p.nose : -2.6 * bl * sc;
  const tailZ = p ? p.tail : 3.95 * bl * sc;
  const len = tailZ - noseZ;
  const hw = 0.71 * (s.bodyRadius || 1) * sc;
  const halfSpan = p ? p.span / 2 : ((s.wingRootX || 0) + (s.halfSpan || 5)) * sc;
  const wingTipZ = ((s.wingZ || 0) + (s.sweep || 0)) * sc;
  const meas = {
    box: { min: { z: noseZ }, max: { z: tailZ } },
    body: { halfWidth: hw, centreY: 0, front: noseZ + len * 0.22, rear: tailZ - len * 0.32 },
    halfSpan,
    wingTipZ,
    wingLE: (x) => ({ z: wingTipZ - (1 - Math.abs(x) / halfSpan) * (s.sweep || 0) * sc - 0.5 * sc, y: (s.wingY || 0) * sc }),
  };
  const info = infoFromMeasure(meas, typeId);
  estimates.set(typeId, info);
  return info;
}

/* ------------------------------------------------------------------ */
/* Paths                                                               */
/* ------------------------------------------------------------------ */

/** A closed or open polyline you can sample by distance, allocation-free. */
class Path {
  constructor(points, closed) {
    this.x = [];
    this.z = [];
    this.at = [];
    this.closed = closed;
    let d = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
      this.x.push(points[i].x);
      this.z.push(points[i].z);
      this.at.push(d);
      const j = (i + 1) % n;
      if (i < n - 1 || closed) d += Math.hypot(points[j].x - points[i].x, points[j].z - points[i].z);
    }
    this.length = Math.max(0.001, d);
  }
  /** Writes { x, z, yaw } for distance d. */
  sample(d, out) {
    const n = this.x.length;
    const L = this.length;
    let dd = this.closed ? ((d % L) + L) % L : Math.max(0, Math.min(L - 1e-4, d));
    let i = n - (this.closed ? 1 : 2);
    for (let k = 0; k < n - (this.closed ? 0 : 1); k++) {
      const end = k + 1 < n ? this.at[k + 1] : L;
      if (dd <= end) {
        i = k;
        break;
      }
    }
    const j = (i + 1) % n;
    const seg = (i + 1 < n ? this.at[i + 1] : L) - this.at[i];
    const t = seg > 1e-6 ? (dd - this.at[i]) / seg : 0;
    const dx = this.x[j] - this.x[i];
    const dz = this.z[j] - this.z[i];
    out.x = this.x[i] + dx * t;
    out.z = this.z[i] + dz * t;
    out.yaw = Math.atan2(-dx, -dz);
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Textures                                                            */
/* ------------------------------------------------------------------ */

let glazing = null;
/**
 * A curtain wall: one bay 6 m wide and two storeys high, mullions and
 * transoms in the paint. The emissive twin has the same frame with the panes
 * lit warm, which is what the departures hall looks like from the apron at
 * night — so the glazing is one mesh, not 24 panes, 24 mullions and 24 "lit"
 * panels as it was.
 */
function glazingTextures() {
  if (glazing) return glazing;
  const S = 256;
  const day = canvas(S, S * 1.5);
  const night = canvas(S, S * 1.5);
  const H = S * 1.5;
  for (const [c, lit] of [[day, false], [night, true]]) {
    const ctx = c.getContext('2d');
    ctx.fillStyle = lit ? '#000000' : '#6f8ea3';
    ctx.fillRect(0, 0, S, H);
    if (!lit) {
      const g = ctx.createLinearGradient(0, 0, S, H);
      g.addColorStop(0, 'rgba(210,230,245,0.55)');
      g.addColorStop(0.45, 'rgba(90,120,140,0.15)');
      g.addColorStop(0.5, 'rgba(200,225,240,0.4)');
      g.addColorStop(1, 'rgba(40,60,75,0.3)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, H);
    } else {
      // Warm panes, a little uneven so the hall does not read as one lamp.
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = `rgba(255,${200 + ((i * 37 + j * 11) % 40)},${140 + ((i * 23) % 50)},${0.75 + ((i + j) % 3) * 0.08})`;
          ctx.fillRect((i * S) / 4, (j * H) / 2, S / 4, H / 2);
        }
      }
    }
    // Mullions, transoms, and a floor slab edge at each storey.
    ctx.fillStyle = lit ? '#050505' : '#c9ced3';
    for (let i = 0; i <= 4; i++) ctx.fillRect((i * S) / 4 - 3, 0, 6, H);
    for (let j = 0; j <= 2; j++) ctx.fillRect(0, (j * H) / 2 - 7, S, 14);
    ctx.fillRect(0, H * 0.25 - 2, S, 4);
    ctx.fillRect(0, H * 0.75 - 2, S, 4);
  }
  glazing = { day: canvasTexture(day, { repeat: true }), night: canvasTexture(night, { repeat: true }) };
  return glazing;
}

/** A texture with each stand's number, one cell each, for painting on the concrete. */
function numberAtlas(n) {
  const cols = 8;
  const rows = Math.max(1, Math.ceil(n / cols));
  const cw = 128;
  const ch = 128;
  const c = canvas(cols * cw, rows * ch);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, cols * cw, rows * ch);
  const cells = [];
  for (let i = 0; i < n; i++) {
    const x = (i % cols) * cw;
    const y = Math.floor(i / cols) * ch;
    ctx.fillStyle = 'rgba(242,197,40,0.95)';
    ctx.font = 'bold 96px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), x + cw / 2, y + ch / 2 + 6, cw - 8);
    cells.push({ u0: x / c.width, u1: (x + cw) / c.width, v0: 1 - (y + ch) / c.height, v1: 1 - y / c.height });
  }
  const tex = canvasTexture(c);
  return { tex, cells };
}

/** Several name boards in one texture, a 1024 x 128 row each, top to bottom. */
function nameBoards(texts, bg = '#1d2a36', fg = '#ffffff') {
  const c = canvas(1024, 128 * texts.length);
  const ctx = c.getContext('2d');
  texts.forEach((text, i) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, i * 128, 1024, 128);
    ctx.fillStyle = fg;
    ctx.font = 'bold 76px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 512, i * 128 + 68, 980);
  });
  return canvasTexture(c);
}

/* ------------------------------------------------------------------ */
/* The docking board                                                   */
/* ------------------------------------------------------------------ */

/*
 * A stand-entry guidance board, the kind bolted to the terminal straight
 * ahead of every contact stand: amber on black, the aeroplane's name at the
 * top, the metres left to roll, an arrow if you are off the line, and STOP.
 * Real ones measure you with a laser. This one is told by the airport-services
 * feature, which knows where your nose is.
 *
 * States: 1 rolling in, 2 at the stop but still moving, 3 stopped on the
 * mark, 4 gone past it.
 */
export function dockState(r) {
  if (r.toGo < -0.8) return 4;
  if (r.toGo <= 0.6) return r.speed < 0.3 ? 3 : 2;
  return 1;
}

const AMBER = '#ffb21e';
/*
 * Metres. A real board is about 1 x 2 m and read from 5 m away; this one is
 * read from a Skylark's seat 30 m out on the lead-in, on a laptop screen, by
 * a ten-year-old — at 2.2 x 3.3 the count-down was a few pixels tall there.
 */
const BOARD_W = 2.6;
const BOARD_H = 3.9;
const DIM = '#4a3508';

function drawBoardIdle(ctx, x, y, number) {
  ctx.fillStyle = '#050505';
  ctx.fillRect(x, y, 128, 192);
  ctx.strokeStyle = DIM;
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 5, y + 5, 118, 182);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = AMBER;
  ctx.font = 'bold 20px Arial, Helvetica, sans-serif';
  ctx.fillText('STAND', x + 64, y + 30, 110);
  ctx.font = 'bold 72px Arial, Helvetica, sans-serif';
  ctx.fillText(String(number), x + 64, y + 96, 110);
  // The unlit bar the count-down will climb down.
  ctx.fillStyle = DIM;
  for (let i = 0; i < 5; i++) ctx.fillRect(x + 24 + i * 17, y + 156, 12, 12);
}

function arrow(ctx, cx, cy, dir, col) {
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(cx + dir * 16, cy);
  ctx.lineTo(cx - dir * 8, cy - 16);
  ctx.lineTo(cx - dir * 8, cy + 16);
  ctx.closePath();
  ctx.fill();
}

function drawBoardLive(ctx, state, r, lat, blink) {
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, 128, 192);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = AMBER;
  ctx.font = 'bold 15px Arial, Helvetica, sans-serif';
  ctx.fillText(String(r.name || 'AIRCRAFT').toUpperCase(), 64, 16, 118);
  const RED = '#ff2f23';
  if (state === 1) {
    const d = r.toGo;
    ctx.font = 'bold 46px Arial, Helvetica, sans-serif';
    ctx.fillText(d < 3 ? d.toFixed(1) : String(Math.round(d)), 58, 74, 100);
    ctx.font = 'bold 20px Arial, Helvetica, sans-serif';
    ctx.fillText('m', 112, 86);
    /*
     * The closing bar: a column that shortens as the stop comes up, full at
     * 15 m and gone at the mark — the thing a pilot actually watches.
     */
    const k = Math.max(0, Math.min(1, d / 15));
    const top = 110;
    const bottom = 178;
    ctx.fillStyle = DIM;
    ctx.fillRect(54, top, 20, bottom - top);
    ctx.fillStyle = AMBER;
    const h = (bottom - top) * k;
    ctx.fillRect(54, bottom - h, 20, h);
    // Steer toward the line: the arrow points the way to turn.
    if (lat && !blink) {
      const dir = lat === 1 ? 1 : -1;
      arrow(ctx, dir > 0 ? 104 : 24, 144, dir, AMBER);
    }
    return;
  }
  if (state === 4) {
    ctx.fillStyle = RED;
    ctx.font = 'bold 40px Arial, Helvetica, sans-serif';
    ctx.fillText('TOO', 64, 80, 118);
    ctx.fillText('FAR', 64, 124, 118);
    return;
  }
  ctx.fillStyle = RED;
  ctx.font = 'bold 40px Arial, Helvetica, sans-serif';
  ctx.fillText('STOP', 64, 82, 120);
  ctx.fillRect(14, 112, 100, 10);
  if (state === 3) {
    ctx.fillStyle = '#39e36b';
    ctx.font = 'bold 42px Arial, Helvetica, sans-serif';
    ctx.fillText('OK', 64, 156, 118);
  }
}

/* ------------------------------------------------------------------ */
/* The apron                                                           */
/* ------------------------------------------------------------------ */

/** Vehicle kinds, their geometry, and whether they use a per-instance colour. */
const KINDS = {
  tug: { geo: V.tugGeometry },
  stairTruck: { geo: V.stairTruckGeometry },
  stair: { geo: V.stairGeometry, cast: false },
  cateringTruck: { geo: V.cateringTruckGeometry },
  cateringBox: { geo: V.cateringBoxGeometry },
  scissor: { geo: V.scissorGeometry, cast: false },
  fuelTruck: { geo: V.fuelTruckGeometry },
  hose: { geo: () => new THREE.CylinderGeometry(0.07, 0.07, 1, 6, 1, true).translate(0, 0.5, 0), mat: 'hose', cast: false },
  beltLoader: { geo: V.beltLoaderGeometry },
  belt: { geo: V.beltGeometry, cast: false },
  tractor: { geo: V.baggageTractorGeometry },
  cart: { geo: V.baggageCartGeometry, colour: true },
  gpu: { geo: V.gpuGeometry },
  cone: { geo: V.coneGeometry, cast: false },
  followMe: { geo: V.followMeGeometry },
};

/** How fast the spare crew drives out to you, m/s: 29 km/h, brisk for an apron. */
const CREW_SPEED = 8;

const CART_COLOURS = [0x2f5f9e, 0xd23c3c, 0x2f8f5b, 0xe9b925, 0x7d4a9e, 0xe9ecee];

export class Apron {
  constructor(scene, quality = 'high') {
    this.group = new THREE.Group();
    this.group.name = 'apron';
    this.t = 0;
    this.quality = quality;
    this.lay = airportLayout();
    /*
     * The layout is memoised per map and outlives this world, and the last
     * Apron wrote on it: which stands have an aeroplane drawn on them. Left
     * there, switching the detail from high to low kept two jet bridges
     * swung out on Kestrel to aeroplanes that were no longer built.
     */
    for (const st of this.lay.stands) st.parked = null;
    for (const h of this.lay.hangars) h.parked = null;
    this.lay.undrawn.clear();
    this.night = null;
    this.bridges = [];
    this.crews = [];
    this.parked = [];
    this.visitors = [];
    this.beacons = [];

    this.mats = {
      vc: vcMaterial({ roughness: 0.75, metalness: 0.1 }),
      paint: layer(vcMaterial({ roughness: 0.9 }), 'paint'),
      vehicle: vcMaterial({ roughness: 0.55, metalness: 0.25 }),
      hose: new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.8 }),
      wall: new THREE.MeshStandardMaterial({ map: buildingTexture(0), roughness: 0.82, metalness: 0.05 }),
      // Both sides: the vault overhangs the glass, and from the apron you
      // look up at its underside.
      roof: new THREE.MeshStandardMaterial({ map: roofTexture(), roughness: 0.9, side: THREE.DoubleSide }),
    };
    this.b = { vc: new Batch(), paint: new Batch(), wall: new Batch(), roof: new Batch() };

    this.buildTerminal();
    this.buildStandMarkings();
    this.buildStandSigns();
    if (quality !== 'low') this.buildParkedAircraft();
    for (const st of this.lay.stands) if (st.occupant && !st.parked) this.lay.undrawn.add(st);
    for (const h of this.lay.hangars) if (h.occupant && !h.parked) this.lay.undrawn.add(h);
    this.planCrews();
    this.buildBridges();
    this.buildFleet();
    this.flush();

    scene.add(this.group);
  }

  /* --------------------------------------------------------- terminal -- */

  /**
   * The terminal. Glass to the apron — two storeys of curtain wall, lit from
   * inside after dark — solid walls to the kerb, a barrel-vault roof, plant on
   * top and a canopy over the kerb. On a strip it is the flying club's
   * clubhouse, on the air base the operations block; same shape, less of it.
   */
  buildTerminal() {
    const lay = this.lay;
    const T = lay.terminal;
    if (!T) return;
    const F = lay.frame;
    const r = T.rect;
    const W = r.x1 - r.x0;
    const D = T.depth;
    const H = T.H;
    const cx = (r.x0 + r.x1) / 2;
    const zFront = F.z(T.front);
    const zBack = F.z(T.back);
    const dz = Math.sign(zBack - zFront);
    const zMid = (zFront + zBack) / 2;
    const vc = this.b.vc;
    const kind = lay.military ? 'ops' : lay.shape === 'strip' ? 'club' : 'terminal';
    const WHITE = 0xe8ecef;
    const STEEL = 0xa8b0b8;
    const FIN = 0xc9ced3;

    // The hall: textured walls (the offices, landside); the glass goes over
    // the front and, on the terminal and the clubhouse, round both ends.
    this.b.wall.box(W, H, D, cx, ELEV + H / 2, zMid, 0xffffff, 0, OFFICE_TILE);
    // On a concrete plinth 1.5 m into the ground, so a footprint on ground a
    // little below field level shows no daylight under it.
    vc.slab(r.x0 - 0.2, r.x1 + 0.2, ELEV - 1.5, ELEV + 0.02, r.z0 - 0.2, r.z1 + 0.2, 0xb4b6b0);
    addObstacleAt(cx, zMid, W, D, ELEV, H + (kind === 'terminal' ? 4 : 1.5), kind === 'terminal' ? 'You flew into the terminal' : 'You flew into a building');

    // The stands whose boards, gate signs and bridge links are on the glass:
    // no fin is stood in front of any of them.
    const busyX = [];
    for (const st of lay.stands) {
      if (!st.bridge) continue;
      busyX.push(F.x(st.u), F.x(st.u + lay.side * (st.size === 'heavy' ? 16 : 9)));
    }

    /*
     * Curtain wall: the front, facing the aeroplanes, and both ends.
     *
     * Only the front used to be glass. The ends wore the office-window
     * texture of the landside wall and the vault stopped flush with them, so
     * from the runway the building looked cut off with a knife — a glass box
     * with a slice of a block of flats stuck on the end. It wraps round now,
     * with fins every bay, a post at each corner, and one mesh for all of it.
     */
    if (kind !== 'ops') {
      const gh = H - (kind === 'club' ? 2.2 : 4.6);
      const g0 = ELEV + (kind === 'club' ? 1.0 : 2.6);
      const gy = g0 + gh / 2;
      const tex = glazingTextures();
      const mat = new THREE.MeshStandardMaterial({
        map: tex.day,
        emissiveMap: tex.night,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0,
        roughness: 0.15,
        metalness: 0.35,
      });
      const panes = new Batch();
      const pane = (len, x, z, ry) => {
        const g = new THREE.PlaneGeometry(len, gh);
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * len) / 6, (uv.getY(i) * gh) / 9);
        panes.add(g, trs(x, gy, z, ry), 0xffffff);
        g.dispose();
      };
      // A plane looks down +Z. The front glass looks away from the building (-dz); the ends look out along X.
      pane(W - 0.4, cx, zFront - dz * 0.1, dz < 0 ? 0 : Math.PI);
      pane(D - 0.4, r.x0 - 0.1, zMid, -Math.PI / 2);
      pane(D - 0.4, r.x1 + 0.1, zMid, Math.PI / 2);
      const glass = panes.mesh(mat, { cast: false, name: 'terminal-glass' });
      glass.geometry.deleteAttribute('color');
      this.group.add(glass);
      this.glassMat = mat;

      // Spandrel under the glass and fascia over it, both wrapped round the
      // ends. The end pieces start behind the front ones and stop short of the
      // back wall, so no two faces lie in one plane.
      const band = (h, y, t) => {
        vc.box(W + 2 * t, h, t, cx, y, zFront - dz * (t / 2 - 0.25), WHITE);
        for (const [ex, s] of [[r.x0, -1], [r.x1, 1]]) {
          vc.box(t, h, D - 0.5, ex + s * (t / 2 - 0.25), y, zMid, WHITE);
        }
      };
      if (kind === 'terminal') band(2.6, ELEV + 1.3, 0.7);
      band(kind === 'club' ? 1.0 : 2.0, ELEV + H - (kind === 'club' ? 0.5 : 0.6), 1.2);

      // Fins: a steel mullion every bay, standing proud of the glass.
      if (kind === 'terminal') {
        const finD = 0.7;
        // On the glazing's own bay lines, which start 0.2 m in from each corner.
        for (let x = r.x0 + 6.2; x < r.x1 - 3; x += 6) {
          if (busyX.some((bx) => Math.abs(bx - x) < 2.8)) continue;
          vc.box(0.28, gh - 0.2, finD, x, gy, zFront - dz * (finD / 2 + 0.11), FIN);
        }
        for (const [ex, s] of [[r.x0, -1], [r.x1, 1]]) {
          for (let w = 6.2; w < D - 3; w += 6) vc.box(finD, gh - 0.2, 0.28, ex + s * (finD / 2 + 0.11), gy, zFront + dz * w, FIN);
        }
      }
      // Corner posts, where the front glass turns the corner.
      for (const [ex, s] of [[r.x0, -1], [r.x1, 1]]) {
        vc.box(1.0, gh + 0.4, 1.0, ex + s * 0.3, gy, zFront - dz * 0.3, WHITE);
      }
    } else {
      // Operations block: a band of windows, a flat roof and an antenna farm.
      vc.box(W + 0.4, 1.4, D + 0.4, cx, ELEV + H + 0.2, zMid, 0x9aa1a8);
      for (let i = 0; i < 4; i++) this.b.vc.cyl(0.08, 0.1, 7, r.x0 + 6 + i * 5, ELEV + H + 0.9, zMid, STEEL, 6);
    }

    // Where the name goes: on the roof's edge, over the glass and over the kerb.
    let signFront = { z: zFront - dz * 0.9, y: ELEV + H + 0.2 };
    let signBack = { z: zBack + dz * 0.1, y: ELEV + H + 0.2 };

    if (kind === 'terminal') {
      /*
       * Roof: a shallow barrel vault, built from the two numbers that
       * describe one — how far apart the eaves are and how far it rises
       * between them.
       *
       * It overhangs now: 4-5 m over the glass on the airside (the canopy
       * that shades a real departures hall, and the shadow line that makes
       * the front read as a front), 1.5 m over the kerb, and 3 m past each
       * end, with a white fascia round its edge. It stopped flush with the
       * walls before, capped with a flat white gable at each end, which is
       * the other half of why the building looked sliced.
       */
      const oF = Math.min(6, Math.max(3, H * 0.18));
      const oB = 1.5;
      const oE = Math.min(4, 1.5 + W * 0.01);
      const span = D + oF + oB;
      const zC = zMid + (dz * (oB - oF)) / 2;
      const rise = Math.min(5, span * 0.1);
      const half = span / 2;
      const R = (half * half + rise * rise) / (2 * rise);
      const halfArc = Math.asin(Math.min(1, half / R));
      const eave = ELEV + H + 0.4;
      const yC = eave + rise - R;
      const len = W + 2 * oE;
      const vault = new THREE.CylinderGeometry(R, R, len, 40, 1, true, Math.PI / 2 - halfArc, halfArc * 2);
      this.b.roof.add(vault, trse(cx, yC, zC, 0, 0, Math.PI / 2), 0xffffff, 10);
      vault.dispose();
      const roofAt = (z) => yC + Math.sqrt(Math.max(0, R * R - (z - zC) * (z - zC)));
      // The fascia: along both eaves, and following the curve at both ends.
      const zE = [zC - dz * half, zC + dz * half];
      // (Ending inside the curved end pieces, so no end face lies in theirs.)
      for (const ze of zE) vc.box(len, 1.1, 0.4, cx, eave - 0.35, ze - Math.sign(ze - zC) * 0.1, WHITE);
      // At each end, the fascia follows the curve: one bent slab, 1.1 m deep
      // and 0.4 m thick, from just over the roof's skin inward.
      const seg = 20;
      for (const ex of [cx - len / 2, cx + len / 2]) {
        const pos = [];
        const ring = (a, d) => [zC + Math.sin(a) * (R - d), yC + Math.cos(a) * (R - d)];
        const quad = (p, q, r2, t) => pos.push(...p, ...q, ...r2, ...p, ...r2, ...t);
        for (let i = 0; i < seg; i++) {
          const a0 = -halfArc + (2 * halfArc * i) / seg;
          const a1 = -halfArc + (2 * halfArc * (i + 1)) / seg;
          const [zo0, yo0] = ring(a0, -0.05);
          const [zo1, yo1] = ring(a1, -0.05);
          const [zi0, yi0] = ring(a0, 1.05);
          const [zi1, yi1] = ring(a1, 1.05);
          for (const xs of [ex - 0.2, ex + 0.2]) quad([xs, yo0, zo0], [xs, yo1, zo1], [xs, yi1, zi1], [xs, yi0, zi0]);
          quad([ex - 0.2, yo0, zo0], [ex + 0.2, yo0, zo0], [ex + 0.2, yo1, zo1], [ex - 0.2, yo1, zo1]);
          quad([ex - 0.2, yi0, zi0], [ex - 0.2, yi1, zi1], [ex + 0.2, yi1, zi1], [ex + 0.2, yi0, zi0]);
        }
        // Every face both ways round is cheaper than getting each winding
        // right by hand, and a slab 0.4 m thick hides the inside faces.
        const n = pos.length / 3;
        const idx = [];
        for (let i = 0; i < n; i += 3) idx.push(i, i + 1, i + 2, i, i + 2, i + 1);
        const gg = new THREE.BufferGeometry();
        gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        gg.setIndex(idx);
        gg.computeVertexNormals();
        vc.add(gg, new THREE.Matrix4(), WHITE);
        gg.dispose();
      }
      // The end walls under the vault, above the glass: the curve filled in,
      // in the wall's own colour, set back behind the glass line.
      for (const ex of [r.x0 + 0.02, r.x1 - 0.02]) {
        const pos = [];
        const n = 16;
        const za0 = zFront;
        const zb0 = zBack;
        for (let i = 0; i < n; i++) {
          const z0 = za0 + ((zb0 - za0) * i) / n;
          const z1 = za0 + ((zb0 - za0) * (i + 1)) / n;
          pos.push(ex, ELEV + H, z0, ex, roofAt(z0) - 0.05, z0, ex, roofAt(z1) - 0.05, z1);
          pos.push(ex, ELEV + H, z0, ex, roofAt(z1) - 0.05, z1, ex, ELEV + H, z1);
        }
        const gg = new THREE.BufferGeometry();
        gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        // Wound to face out of the building at this end.
        const out = ex < cx ? -1 : 1;
        gg.computeVertexNormals();
        if (gg.attributes.normal.getX(0) * out < 0) {
          const idx = [];
          for (let i = 0; i < pos.length / 3; i += 3) idx.push(i, i + 2, i + 1);
          gg.setIndex(idx);
          gg.computeVertexNormals();
        }
        vc.add(gg, new THREE.Matrix4(), 0xd6dce1);
        gg.dispose();
      }
      // A strip of rooflights along the crown, and plant set back behind it.
      vc.box(len * 0.82, 0.2, Math.min(4, span * 0.08), cx, roofAt(zC) + 0.02, zC, 0x9fb6c8);
      const zp = zC + dz * span * 0.2;
      for (let x = r.x0 + 14; x < r.x1 - 10; x += 34) vc.box(7, 2.4, 5, x, roofAt(zp) + 0.9, zp, 0x8d949c);
      // Solid out to the edge of the overhangs, from well above the ground (the
      // road router and anyone on foot only care what starts under 4 m).
      addObstacleAt(cx, zC, len, span, ELEV + H - 1, rise + 1.6, 'You flew into the terminal');
      signFront = { z: zE[0] - dz * 0.35, y: eave + 0.15 };
      // The kerb gets its name on the canopy, between DEPARTURES and
      // ARRIVALS, rather than a second big board on the roof: on the compact
      // terminals that one stood right behind the airside board.
      signBack = null;

      // Kerbside canopy on the landside, on columns.
      vc.box(W * 0.7, 0.5, 5, cx, ELEV + 6.4, zBack + dz * 2.6, WHITE);
      for (let k = -3; k <= 3; k++) vc.box(0.5, 6.2, 0.5, cx + (k * W) / 9, ELEV + 3.1, zBack + dz * 4.6, STEEL);
      /*
       * The way in: two glazed entrances under the canopy, each in a white
       * frame, with DEPARTURES and ARRIVALS over them on the canopy's edge.
       * The kerb was a blank wall of office windows.
       */
      // Between the canopy's columns (every W/9), clear of all of them.
      const doors = [-W / 6, W / 6];
      this.entrances = [];
      for (const ox of doors) {
        const x = cx + ox;
        vc.box(8, 4.6, 0.3, x, ELEV + 2.3, zBack + dz * 0.12, 0x24323d);
        vc.box(9.2, 0.8, 1.2, x, ELEV + 5.0, zBack + dz * 0.5, WHITE);
        for (const s of [-1, 1]) vc.box(0.6, 4.6, 1.2, x + s * 4.3, ELEV + 2.3, zBack + dz * 0.5, WHITE);
        // The door leaves: two pairs, the frames between them.
        for (const s of [-2, -1, 0, 1, 2]) vc.box(0.12, 4.4, 0.34, x + s * 1.9, ELEV + 2.3, zBack + dz * 0.16, 0xc9ced3);
        this.entrances.push({ x, z: zBack + dz * 0.2 });
      }
      this.kerbSigns = [
        { row: 1, x: cx - W / 6, z: zBack + dz * 5.2, y: ELEV + 7.35 },
        { row: 2, x: cx + W / 6, z: zBack + dz * 5.2, y: ELEV + 7.35 },
      ];
    } else if (kind === 'club') {
      /*
       * A flat roof that oversails the walls by a metre and a half all round,
       * with a white fascia: the clubhouse's roof was a slab barely wider than
       * the building, so its ends read as cut off as the terminal's did.
       */
      vc.box(W + 3, 0.6, D + 3, cx, ELEV + H + 0.3, zMid, WHITE);
      vc.box(W + 2.4, 0.12, D + 2.4, cx, ELEV + H + 0.66, zMid, 0x8d949c);
      addObstacleAt(cx, zMid, W + 3, D + 3, ELEV + H - 0.2, 1.2, 'You flew into a building');
      // A veranda on the airside, where people watch the aeroplanes.
      vc.box(W, 0.25, 4.5, cx, ELEV + 3.2, zFront - dz * 2.4, WHITE);
      for (let x = r.x0 + 1; x <= r.x1 - 0.9; x += W / 5) vc.box(0.25, 3.2, 0.25, x, ELEV + 1.6, zFront - dz * 4.4, STEEL);
      // And a door on the kerb.
      vc.box(2.4, 2.6, 0.3, cx, ELEV + 1.3, zBack + dz * 0.12, 0x24323d);
      vc.box(3.4, 0.4, 1.6, cx, ELEV + 2.9, zBack + dz * 0.8, WHITE);
      signFront = { z: zFront - dz * 1.75, y: ELEV + H + 0.72 };
      signBack = { z: zBack + dz * 1.75, y: ELEV + H + 0.72 };
    } else {
      signFront = { z: zFront - dz * 0.45, y: ELEV + H + 0.95 };
      signBack = { z: zBack + dz * 0.45, y: ELEV + H + 0.95 };
    }

    /*
     * The name, over the glass and over the kerb: a lit board in a dark
     * frame, standing on the roof's edge. One texture holds it and, on the
     * terminal, DEPARTURES and ARRIVALS for the kerb; one mesh draws them all.
     */
    const name = (MAP && MAP.name ? MAP.name : 'Airport').toUpperCase();
    const label = kind === 'ops' ? `${name} — BASE OPERATIONS` : kind === 'club' ? `${name} FLYING CLUB` : name;
    const tex = nameBoards([label, 'DEPARTURES', 'ARRIVALS']);
    const bw = Math.min(W * 0.7, kind === 'terminal' ? 60 : 30);
    const bh = bw / 8;
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.2, roughness: 0.5 });
    const boards = new Batch();
    const board = (row, w, h, x, y, z, ry, frameOut) => {
      const g = new THREE.PlaneGeometry(w, h);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setY(i, (2 - row + uv.getY(i)) / 3);
      boards.add(g, trs(x, y, z, ry), 0xffffff);
      g.dispose();
      // The frame: a dark box behind the face, 3 cm clear of it.
      vc.box(w + 0.5, h + 0.5, 0.5, x - Math.sin(ry) * 0.28 * frameOut, y, z - Math.cos(ry) * 0.28 * frameOut, 0x1d2a36, ry);
    };
    // A plane looks down +Z; each board looks away from the building.
    const faceFront = dz < 0 ? 0 : Math.PI;
    const faceBack = dz < 0 ? Math.PI : 0;
    board(0, bw, bh, cx, signFront.y + bh / 2 + 0.25, signFront.z, faceFront, 1);
    if (signBack) board(0, bw, bh, cx, signBack.y + bh / 2 + 0.25, signBack.z, faceBack, 1);
    else board(0, 12.8, 1.6, cx, ELEV + 7.6, zBack + dz * 5.2, faceBack, 1);
    for (const k of this.kerbSigns || []) board(k.row, 9, 1.125, k.x, k.y, k.z, faceBack, 1);
    this.kerbSigns = null;
    const bm = boards.mesh(mat, { cast: false, name: 'terminal-signs' });
    bm.geometry.deleteAttribute('color');
    this.group.add(bm);
    this.boardMat = mat;
  }

  /* ---------------------------------------------------- stand markings -- */

  /**
   * On every stand: the yellow lead-in line a pilot follows onto it, the stop
   * bar where the nose wheel stops, the stand number, and white lines down
   * each side that a wingtip must not cross.
   */
  buildStandMarkings() {
    const lay = this.lay;
    if (!lay.stands.length) return;
    const F = lay.frame;
    const paint = this.b.paint;
    const Y = ELEV + 0.08;
    const yellow = 0xf2c53d;
    const white = 0xeeeeee;
    const red = 0xd23c2a;
    const lane = lay.apron.w0 + 6;
    for (const st of lay.stands) {
      const stopW = st.noseW - 3;
      paint.flat(0.5, stopW - lane, F.x(st.u), Y, F.z((lane + stopW) / 2), yellow);
      paint.flat(5, 0.6, F.x(st.u), Y, F.z(stopW), yellow);
      paint.flat(0.6, 2, F.x(st.u - 2.2), Y, F.z(stopW), yellow);
      paint.flat(0.6, 2, F.x(st.u + 2.2), Y, F.z(stopW), yellow);
      // Where the ground equipment waits, clear of the aeroplane.
      if (st.size !== 'light') paint.flat(st.pitch * 0.8, 0.3, F.x(st.u), Y, F.z(st.noseW + 3), red);
      // Wingtip lines.
      for (const e of [-1, 1]) {
        const u = st.u + (e * st.pitch) / 2;
        for (let w = st.noseW - st.depth + 2; w < st.noseW; w += 4) paint.flat(0.2, 2.2, F.x(u), Y, F.z(w + 1.1), white);
      }
    }
    // The numbers, from one texture.
    const { tex, cells } = numberAtlas(lay.stands.length);
    const nb = new Batch();
    lay.stands.forEach((st, i) => {
      const s = st.size === 'light' ? 3.5 : 6;
      const g = new THREE.PlaneGeometry(s, s);
      g.rotateX(-Math.PI / 2);
      const c = cells[i];
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) ? c.u1 : c.u0, uv.getY(k) ? c.v1 : c.v0);
      // Readable from the lead-in: the top of the digits toward the terminal.
      nb.add(g, trs(F.x(st.u + 3.8), Y + 0.005, F.z(lane + 5), lay.side < 0 ? 0 : Math.PI), 0xffffff);
      g.dispose();
    });
    const mat = layer(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }), 'decal');
    const m = nb.mesh(mat, { cast: false, name: 'stand-numbers' });
    if (m) {
      m.geometry.deleteAttribute('color');
      this.group.add(m);
    }

    /*
     * The airside road along the front of the terminal: a solid white edge on
     * the stands' side and a dashed white centre line. It is where the tugs,
     * the catering trucks and the baggage trains actually drive between the
     * stands and the building — the spare crew's lane (T.front - 8) is its
     * middle — and without it the strip under the bridges was bare concrete
     * that did not say what it was for.
     */
    const T = lay.terminal;
    if (T && lay.bridges) {
      const wEdge = Math.max(...lay.stands.map((s) => s.noseW)) + 4.5;
      const wMid = T.front - 8;
      if (wMid - wEdge > 2) {
        const u0 = T.u0 + 2;
        const u1 = T.u1 - 2;
        paint.flat(u1 - u0, 0.2, F.x((u0 + u1) / 2), Y, F.z(wEdge), white);
        for (let u = u0 + 1.5; u < u1 - 1.5; u += 6) paint.flat(3, 0.15, F.x(u), Y, F.z(wMid), white);
      }
    }
  }

  /* ------------------------------------------- gate signs and the boards -- */

  /**
   * Over every contact stand, on the glass: a GATE sign above the bridge,
   * and straight down the lead-in line, at a pilot's eye, the docking board
   * that talks you onto the stand — the stand's number while it waits, and a
   * count-down to STOP while an aeroplane rolls in (showDocking()). One
   * texture and one draw call for all of them, however many gates there are.
   */
  buildStandSigns() {
    const lay = this.lay;
    const T = lay.terminal;
    if (!T || !lay.bridges) return;
    const list = lay.stands.filter((s) => s.bridge);
    if (!list.length) return;
    const F = lay.frame;
    const n = list.length;
    // Gate signs: 256 x 64 cells, four to a row. Boards: 128 x 192, eight.
    const gRows = Math.ceil(n / 4);
    const bRows = Math.ceil(n / 8);
    const W = 1024;
    const H = gRows * 64 + bRows * 192;
    const c = canvas(W, H);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
    const gateCells = [];
    const boardCells = [];
    const cell = (x, y, w, h) => ({ u0: x / W, u1: (x + w) / W, v0: 1 - (y + h) / H, v1: 1 - y / H });
    list.forEach((st, i) => {
      const gx = (i % 4) * 256;
      const gy = Math.floor(i / 4) * 64;
      // GATE, then the number on a yellow block: read left to right.
      ctx.fillStyle = '#16191d';
      ctx.fillRect(gx, gy, 256, 64);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f4f4f4';
      ctx.font = 'bold 34px Arial, Helvetica, sans-serif';
      ctx.fillText('GATE', gx + 92, gy + 34, 160);
      ctx.fillStyle = '#f2c53d';
      ctx.fillRect(gx + 184, gy + 8, 64, 48);
      ctx.fillStyle = '#16191d';
      ctx.font = 'bold 40px Arial, Helvetica, sans-serif';
      ctx.fillText(String(st.number), gx + 216, gy + 34, 60);
      gateCells.push(cell(gx, gy, 256, 64));
      const bx = (i % 8) * 128;
      const by = gRows * 64 + Math.floor(i / 8) * 192;
      drawBoardIdle(ctx, bx, by, st.number);
      boardCells.push(cell(bx, by, 128, 192));
    });
    const tex = canvasTexture(c);
    const faces = new Batch();
    const vc = this.b.vc;
    const zFace = (w) => F.z(w);
    // A plane looks down +Z; the glass looks toward the runway, which is -side.
    const yaw = lay.side < 0 ? 0 : Math.PI;
    const put = (cellUV, w, h, x, y, z) => {
      const g = new THREE.PlaneGeometry(w, h);
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) ? cellUV.u1 : cellUV.u0, uv.getY(k) ? cellUV.v1 : cellUV.v0);
      faces.add(g, trs(x, y, z, yaw), 0xffffff);
      g.dispose();
    };
    this.boards = new Map();
    list.forEach((st, i) => {
      // The board, square on to the lead-in line, with a hood over it.
      const bw = BOARD_W;
      const bh = BOARD_H;
      const by = ELEV + 5.6;
      /*
       * The gate sign, over the board on the same centreline. Over the
       * bridge's link it stood right behind the parked bridge cab, and from
       * a Skylark's seat on the lead-in only the number showed round it.
       */
      const gy = by + bh / 2 + 1.5;
      vc.box(6.4, 1.8, 0.25, F.x(st.u), gy, zFace(T.front - 0.25), 0x2a2e33);
      put(gateCells[i], 6, 1.5, F.x(st.u), gy, zFace(T.front - 0.42));
      const bz = T.front - 0.3;
      vc.box(bw + 0.3, bh + 0.3, 0.35, F.x(st.u), by, zFace(bz + 0.05), 0x1b1e22);
      vc.box(bw + 0.5, 0.12, 0.9, F.x(st.u), by + bh / 2 + 0.2, zFace(bz - 0.35), 0x1b1e22);
      put(boardCells[i], bw, bh, F.x(st.u), by, zFace(bz - 0.19));
      this.boards.set(st, { x: F.x(st.u), y: by, z: zFace(bz - 0.21), w: bw, h: bh });
    });
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xe6e6e6 });
    const m = faces.mesh(mat, { cast: false, receive: false, name: 'gate-signs' });
    if (m) {
      m.geometry.deleteAttribute('color');
      this.group.add(m);
    }
    // The live board: one more face, moved to whichever stand is in use.
    const live = canvas(128, 192);
    this.dockCanvas = live;
    this.dockTex = canvasTexture(live);
    this.dockMesh = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_W, BOARD_H), new THREE.MeshBasicMaterial({ map: this.dockTex }));
    this.dockMesh.rotation.y = yaw;
    this.dockMesh.visible = false;
    this.dockMesh.name = 'docking-board';
    this.group.add(this.dockMesh);
    this.dockKey = -1;
    this.dockStand = null;
  }

  /**
   * Drive the docking board on `stand` from a reading:
   *   { toGo, lateral, speed, name } — metres to the stop, metres right of the
   *   line, ground speed m/s, and the aeroplane's name for the top line.
   * null (or a stand with no board) puts it back to waiting. Redraws only
   * when what it shows changes, which is a few times a second while rolling
   * in and never while parked.
   */
  showDocking(stand, reading) {
    if (!this.dockMesh) return false;
    const b = stand && reading && this.boards.get(stand);
    if (!b) {
      if (this.dockMesh.visible) this.dockMesh.visible = false;
      this.dockStand = null;
      this.dockKey = -1;
      return false;
    }
    if (this.dockStand !== stand) {
      this.dockStand = stand;
      this.dockMesh.position.set(b.x, b.y, b.z);
      this.dockKey = -1;
    }
    this.dockMesh.visible = true;
    const state = dockState(reading);
    // Everything the face shows, as one number, so an unchanged face costs a
    // comparison and not a redraw.
    // Decimetres inside 3 m, whole metres (offset past them) outside.
    const dm = reading.toGo < 3 ? Math.max(0, Math.round(reading.toGo * 10)) : 100 + Math.min(899, Math.round(reading.toGo));
    const lat = reading.lateral > 1 ? 2 : reading.lateral < -1 ? 1 : 0;
    const blink = state === 1 && lat ? Math.floor(this.t * 3) % 2 : 0;
    const key = state * 100000 + lat * 10000 + blink * 1000 + dm;
    if (key === this.dockKey) return true;
    this.dockKey = key;
    drawBoardLive(this.dockCanvas.getContext('2d'), state, reading, lat, blink);
    this.dockTex.needsUpdate = true;
    return true;
  }

  /* -------------------------------------------------- parked aircraft -- */

  /**
   * Aeroplanes on the stands, from the same fleet you fly, in different
   * airlines' colours — an apron where every aeroplane wears the same paint
   * looks like a factory, not an airport. The scheme is picked from the
   * layout's stand order so it is stable across rebuilds.
   */
  buildParkedAircraft() {
    const lay = this.lay;
    const painted = LIVERIES.filter((l) => !l.house);
    const bakes = new Map();
    /*
     * Two paint schemes per type, not one per aeroplane. Each scheme is its
     * own bake (about seven draw calls for a Meridian), and five Meridians at
     * San Francisco in five schemes measured 35 draw calls; in two schemes it
     * is 14, and an apron of alternating airlines still reads as an airport.
     */
    const perType = new Map();
    const liveryFor = (typeId) => {
      const k = perType.get(typeId) || 0;
      perType.set(typeId, k + 1);
      if (!painted.length) return null;
      let hsh = 0;
      for (const ch of typeId) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
      return painted[(hsh + (k % 2) * 2) % painted.length];
    };
    // How many a school laptop is asked to draw.
    const cap = this.quality === 'ultra' ? 99 : this.quality === 'medium' ? 3 : 6;
    const want = [];
    for (const st of lay.stands) {
      if (!st.occupant || want.length >= cap) continue;
      want.push({ kind: 'stand', st, typeId: st.occupant, livery: liveryFor(st.occupant) });
    }
    for (const h of lay.hangars) {
      if (!h.occupant || want.length >= cap) continue;
      // In the first scheme of its type, so it shares that bake and costs no
      // draw calls of its own.
      const first = want.find((q) => q.typeId === h.occupant);
      want.push({ kind: 'hangar', h, typeId: h.occupant, livery: first ? first.livery : liveryFor(h.occupant) });
    }
    for (const w of want) {
      const type = AIRCRAFT.find((a) => a.id === w.typeId);
      if (!type) continue;
      const key = `${type.id}|${w.livery ? w.livery.id : 'house'}`;
      let entry = bakes.get(key);
      if (!entry) {
        let bake = null;
        try {
          const model = createAircraftModel({ type, livery: w.livery || schemeFor(type, 'house') });
          // Parked: everything still, lights out, wheels on the ground.
          model.userData.update(
            0.016,
            {
              controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 1 },
              rpm: 0,
              flaps: 0,
              gearPos: 1,
              gearDown: true,
              onGround: true,
              groundSpeed: 0,
              agl: 0,
              engineOn: false,
            },
            { isNight: false, cond: { cloud: 0 } }
          );
          bake = bakeModel(model);
        } catch (e) {
          console.warn(`[apron] could not park a ${type.id}:`, e);
          continue;
        }
        entry = { bake, info: infoFromMeasure(bake, type.id), users: [] };
        bakes.set(key, entry);
      }
      entry.users.push(w);
    }
    for (const [key, entry] of bakes) {
      const meshes = entry.bake.parts.map((p) => {
        const m = instanced(p.geometry, p.material, entry.users.length, { name: `parked:${key}` });
        this.group.add(m);
        return m;
      });
      entry.users.forEach((w, i) => {
        const info = entry.info;
        let tg;
        if (w.kind === 'stand') {
          // Nose to the stop line, facing the terminal.
          const st = w.st;
          const h = st.headingDeg * D2R;
          // The nose stops NOSE_STOP short of the line. The model's nose is
          // at z = noseZ (negative, forward), so the origin is that far back.
          const noseBack = NOSE_STOP;
          const ox = st.noseX + Math.sin(h) * (info.noseZ - noseBack);
          const oz = st.noseZ - Math.cos(h) * (info.noseZ - noseBack);
          tg = makeTarget(ox, oz, st.headingDeg, info);
          st.parked = tg;
        } else {
          const s = w.h.slot;
          tg = makeTarget(s.x, s.z, s.headingDeg, info);
          w.h.parked = tg;
        }
        trs(tg.ox, tg.oy, tg.oz, yawOf(tg.heading), 1, 1, 1, _m);
        for (const m of meshes) m.setMatrixAt(i, _m);
        this.parked.push({ tg, meshes, index: i, key, kind: w.kind, stand: w.st || null });
      });
      for (const m of meshes) {
        m.instanceMatrix.needsUpdate = true;
        // They do not move, so they can be culled like anything else.
        m.computeBoundingSphere();
        m.frustumCulled = true;
      }
    }
    this.bakes = bakes;
  }

  /* ------------------------------------------------------------- crews -- */

  /**
   * Work out every vehicle's place before any mesh exists, so each kind can
   * be one InstancedMesh of exactly the right size.
   */
  planCrews() {
    this.slots = {};
    for (const k of Object.keys(KINDS)) this.slots[k] = [];
    const lay = this.lay;
    // A crew for every airliner at a stand.
    for (const p of this.parked) {
      if (p.kind !== 'stand') {
        // The one in the hangar gets a power cart and cones.
        this.addCrew(p.tg, { gpu: true, cones: true });
        continue;
      }
      const st = p.stand;
      // Stairs, catering and baggage are for airliners: a fighter on the air
      // base, like a light aeroplane, gets power and cones.
      if (st.size === 'light' || this.lay.military || p.tg.info.halfSpan * 2 < 18) {
        this.addCrew(p.tg, { gpu: true, cones: true });
        continue;
      }
      this.addCrew(p.tg, { full: true, bridge: st.bridge, stand: st });
    }
    // A spare crew, out of sight, for whoever lands next and asks for one.
    if (lay.stands.length && !lay.military) {
      this.spare = this.addCrew(null, { full: true, spare: true });
    }
    // The follow-me van, doing laps of the apron.
    if (lay.apron) {
      const F = lay.frame;
      const a = lay.apron;
      const w0 = a.w0 + 5;
      const w1 = a.w0 + 13;
      const pts = [
        { x: F.x(a.u0 + 12), z: F.z(w0) },
        { x: F.x(a.u1 - 12), z: F.z(w0) },
        { x: F.x(a.u1 - 8), z: F.z((w0 + w1) / 2) },
        { x: F.x(a.u1 - 12), z: F.z(w1) },
        { x: F.x(a.u0 + 12), z: F.z(w1) },
        { x: F.x(a.u0 + 8), z: F.z((w0 + w1) / 2) },
      ];
      this.followMe = { path: new Path(pts, true), d: 0, slot: this.take('followMe', null), beacon: this.addBeacon(0, 0, 0, 0xffa629) };
    }
  }

  /** Reserve one instance of a kind. `m` is its starting matrix (null: hidden). */
  take(kind, m, colour = null) {
    const list = this.slots[kind];
    list.push({ m: m ? m.clone() : HIDDEN.clone(), colour });
    return list.length - 1;
  }

  addBeacon(x, y, z, hex) {
    this.beacons.push({ x, y, z, hex });
    return this.beacons.length - 1;
  }

  /**
   * One crew round one aeroplane. `tg` is its frame (null for the spare,
   * which is placed when called). What the crew does is decided by
   * servicePoses(), so the spare can use exactly the same rules later.
   */
  addCrew(tg, opts) {
    const crew = { tg, opts, v: {}, lift: { phase: Math.random() * 60, h: 0 }, train: null, state: opts.spare ? 'away' : 'working', t: 0 };
    const poses = tg ? this.servicePoses(tg, opts) : null;
    const mk = (kind, pose) => {
      if (!pose) return this.take(kind, null);
      trs(pose.x, pose.y ?? ELEV, pose.z, pose.yaw, 1, 1, 1, _m);
      return this.take(kind, _m);
    };
    if (opts.full) {
      crew.v.tug = mk('tug', poses && poses.tug);
      crew.v.stairTruck = mk('stairTruck', poses && poses.stairTruck);
      crew.v.stair = this.take('stair', null);
      crew.v.cateringTruck = mk('cateringTruck', poses && poses.cateringTruck);
      crew.v.cateringBox = this.take('cateringBox', null);
      crew.v.scissor = this.take('scissor', null);
      crew.v.fuelTruck = mk('fuelTruck', poses && poses.fuelTruck);
      crew.v.hose = this.take('hose', null);
      crew.v.beltLoader = mk('beltLoader', poses && poses.beltLoader);
      crew.v.belt = this.take('belt', null);
      crew.v.tractor = this.take('tractor', null);
      crew.v.carts = [0, 1, 2].map((i) => this.take('cart', null, CART_COLOURS[(this.crews.length + i) % CART_COLOURS.length]));
      crew.beacons = {
        tug: this.addBeacon(0, -1e4, 0, 0xffa629),
        tractor: this.addBeacon(0, -1e4, 0, 0xffa629),
        cater: this.addBeacon(0, -1e4, 0, 0xffa629),
      };
    }
    if (opts.full || opts.gpu) crew.v.gpu = mk('gpu', poses && poses.gpu);
    if (opts.full || opts.cones) crew.v.cones = [0, 1, 2, 3].map((i) => mk('cone', poses && poses.cones[i]));
    crew.poses = poses;
    this.crews.push(crew);
    return crew;
  }

  /**
   * Where each vehicle stands round an aeroplane, from its measured doors.
   *
   * Left side: the bridge at the front door (the stairs there instead on a
   * remote stand), the stair truck at the back door, the power cart under
   * the nose. Right side, forward: the belt loader at the hold, with the
   * baggage train circling ahead of it. Right side, aft: the catering truck
   * at the galley door. Out beyond the baggage, the fuel bowser ahead of the
   * right wing. Tug on the nose leg. Cones at the wingtips and the tail.
   */
  servicePoses(tg, opts) {
    const I = tg.info;
    const p = (lx, lz, headingOffset, ly = 0) => {
      const w = local(tg, lx, ly, lz);
      return { x: w.x, y: ELEV, z: w.z, yaw: yawOf(tg.heading + headingOffset), heading: tg.heading + headingOffset };
    };
    const out = {};
    // Tug: its towbar pinned to the nose leg, facing the aeroplane.
    const ng = I.noseGear;
    out.tug = p(ng.x, ng.z - V.TUG_BAR_TIP, 180);
    const bridged = opts.bridge;
    // Stairs at the rear left door, or the front left one on a remote stand.
    const sz = bridged ? I.rearDoorZ : I.frontDoorZ;
    out.stairTruck = p(-(I.hw + 0.25 - V.STAIR_FRONT), sz, 90);
    out.stairTruck.sill = tg.oy + I.sill;
    out.stairTruck.doorZ = sz;
    // Catering at the rear right door.
    out.cateringTruck = p(I.hw + 0.25 - V.CATER_FRONT, I.rearDoorZ, -90);
    out.cateringTruck.sill = tg.oy + I.sill;
    // Belt loader at the forward hold.
    out.beltLoader = p(I.hw * 0.9 + 0.2 - V.BELT_FRONT, I.holdZ, -90);
    out.beltLoader.sill = tg.oy + I.holdSill;
    // Fuel bowser, ahead of the right wing and outboard of the baggage.
    const fx = Math.max(0.55 * I.halfSpan, I.hw + 12);
    const fz = I.wingTipZ - 0.35 * I.halfSpan - 5.5;
    out.fuelTruck = p(fx, fz, 0);
    const le = I.wingLE(0.45 * I.halfSpan);
    out.hoseTo = local(tg, 0.45 * I.halfSpan, le.y - 0.2, le.z + 1.0);
    out.gpu = p(-(I.hw + 2.2), I.noseZ + 3, 90);
    // The baggage loop: ahead of the loader, between it and the terminal.
    const lz0 = I.noseZ - 7;
    const lz1 = Math.max(lz0 + 6, I.holdZ - 5);
    const lx0 = I.hw + 2.5;
    const lx1 = I.hw + 7.5;
    out.loop = [
      local(tg, lx0, 0, lz0),
      local(tg, lx0, 0, lz1),
      local(tg, lx1, 0, lz1 + 1.5),
      local(tg, lx1, 0, lz0 - 1.5),
    ].map((q) => ({ x: q.x, z: q.z }));
    out.cones = [
      p(-(I.halfSpan + 1.2), I.wingTipZ, 0),
      p(I.halfSpan + 1.2, I.wingTipZ, 0),
      p(0, I.tailZ + 2, 0),
      p(-(I.hw + 1), I.noseZ + 1, 0),
    ];
    return out;
  }

  /* ------------------------------------------------------------ bridges -- */

  /**
   * An air bridge on every contact stand: a rotunda standing off the
   * terminal, a telescoping tunnel on a lifting leg, and a cab that swings
   * square to the door. A stand with an aeroplane on it has its bridge on
   * the front door; an empty one has it parked back against the terminal,
   * and it drives out when something stops on the stand.
   */
  buildBridges() {
    const lay = this.lay;
    if (!lay.bridges || !lay.terminal) return;
    const F = lay.frame;
    const T = lay.terminal;
    const vc = this.b.vc;
    const list = lay.stands.filter((s) => s.bridge);
    if (!list.length) return;
    const ROT_FLOOR = 4.6;
    for (const st of list) {
      const offset = st.size === 'heavy' ? 16 : 9;
      const u = st.u + lay.side * offset;
      const wRot = T.front - 3.2;
      const x = F.x(u);
      const z = F.z(wRot);
      // Rotunda, a link into the building, and its column.
      vc.cyl(2.5, 2.5, 3.8, x, ELEV + ROT_FLOOR - 0.6, z, 0xd9dde1, 14);
      vc.cyl(2.7, 2.7, 0.4, x, ELEV + ROT_FLOOR + 3.2, z, 0x8d949c, 14);
      vc.box(3.2, 3.2, 3.6, x, ELEV + ROT_FLOOR + 1.3, F.z(T.front - 1.4), 0xd9dde1);
      vc.cyl(0.7, 0.9, ROT_FLOOR - 0.6, x, ELEV, z, 0x8d949c, 10);
      // Gate number on the rotunda's canopy, readable from the apron.
      const home = { x: F.x(st.u + lay.side * (offset - 3)), y: ELEV + ROT_FLOOR + 1.2, z: F.z(wRot - 13) };
      const b = {
        st,
        rot: { x, y: ELEV + ROT_FLOOR, z },
        home,
        homeYaw: yawOf(st.headingDeg + 180),
        ext: st.parked ? 1 : 0,
        target: st.parked ? 1 : 0,
        dock: null,
        dockYaw: 0,
        slot: this.bridges.length,
        dirty: true,
      };
      if (st.parked) this.dockTo(b, st.parked);
      this.bridges.push(b);
    }
  }

  /** Aim a bridge's cab at an aeroplane's front left door. */
  dockTo(b, tg) {
    const I = tg.info;
    // The bellows 0.2 m off the skin (the cab is 3.2 m deep and its bellows
    // stand 0.7 m proud of it), its floor at the sill.
    const d = local(tg, -(I.hw + 0.2 + 2.3), I.sill + 1.7, I.frontDoorZ);
    b.dock = { x: d.x, y: d.y, z: d.z };
    b.dockYaw = yawOf(tg.heading + 90);
    b.dirty = true;
  }

  poseBridge(b) {
    const k = b.ext;
    const s = k * k * (3 - 2 * k);
    const to = b.dock || b.home;
    const cx = b.home.x + (to.x - b.home.x) * s;
    const cy = b.home.y + (to.y - b.home.y) * s;
    const cz = b.home.z + (to.z - b.home.z) * s;
    let yawDiff = b.dock ? b.dockYaw - b.homeYaw : 0;
    yawDiff = Math.atan2(Math.sin(yawDiff), Math.cos(yawDiff));
    const cabYaw = b.homeYaw + yawDiff * s;
    // Tunnel from the rotunda's rim to the back of the cab.
    const dx = cx - b.rot.x;
    const dz = cz - b.rot.z;
    const horiz = Math.hypot(dx, dz) || 1;
    const yaw = Math.atan2(-dx, -dz);
    const sx = b.rot.x + (dx / horiz) * 2.4;
    const sz = b.rot.z + (dz / horiz) * 2.4;
    const sy = b.rot.y + 1.5;
    const ex = cx - (dx / horiz) * 1.7;
    const ez = cz - (dz / horiz) * 1.7;
    const ey = cy;
    const len = Math.hypot(ex - sx, ez - sz, ey - sy);
    const pitch = Math.atan2(ey - sy, Math.hypot(ex - sx, ez - sz));
    _e.set(pitch, yaw, 0, 'YXZ');
    _q.setFromEuler(_e);
    _v.set(sx, sy, sz);
    _s.set(1, 1, Math.max(0.5, len));
    _m.compose(_v, _q, _s);
    this.bridgeTunnel.setMatrixAt(b.slot, _m);
    trs(cx, cy, cz, cabYaw, 1, 1, 1, _m);
    this.bridgeCab.setMatrixAt(b.slot, _m);
    // The leg, two-thirds of the way out, down to the ground.
    const lx = sx + (ex - sx) * 0.68;
    const lz = sz + (ez - sz) * 0.68;
    const ly = sy + (ey - sy) * 0.68 - 1.45;
    trs(lx, ELEV, lz, yaw, 1, Math.max(0.5, ly - ELEV), 1, _m);
    this.bridgeLeg.setMatrixAt(b.slot, _m);
    trs(lx, ELEV, lz, yaw, 1, 1, 1, _m);
    this.bridgeBogie.setMatrixAt(b.slot, _m);
    b.dirty = false;
  }

  /* -------------------------------------------------------------- fleet -- */

  buildFleet() {
    const M = this.mats;
    this.meshes = {};
    const col = new THREE.Color();
    for (const [kind, def] of Object.entries(KINDS)) {
      const list = this.slots[kind];
      if (!list.length) continue;
      const geo = def.geo();
      const mat = def.mat === 'hose' ? M.hose : M.vehicle;
      const m = instanced(geo, mat, list.length, { name: `ground:${kind}`, cast: def.cast !== false });
      list.forEach((s, i) => {
        m.setMatrixAt(i, s.m);
        if (def.colour) m.setColorAt(i, col.set(s.colour || 0xffffff));
      });
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      this.group.add(m);
      this.meshes[kind] = m;
    }
    // Bridges: four parts, one InstancedMesh each.
    if (this.bridges.length) {
      const n = this.bridges.length;
      const tb = new Batch();
      tb.box(3.0, 2.9, 1, 0, 0, -0.5, 0xe6e9ec);
      for (const s of [-1, 1]) tb.box(0.04, 0.8, 1, s * 1.51, 0.35, -0.5, 0x2f3d4a);
      tb.box(3.1, 0.2, 1, 0, 1.5, -0.5, 0x8d949c);
      this.bridgeTunnel = instanced(tb.geometry(), M.vehicle, n, { name: 'bridge-tunnel' });
      const cb = new Batch();
      cb.box(3.6, 3.4, 3.2, 0, 0, 0, 0xe6e9ec);
      cb.box(3.9, 3.6, 0.8, 0, 0, -1.9, 0x3b4148); // bellows at the door
      cb.box(3.7, 0.25, 3.6, 0, 1.8, -0.2, 0x8d949c); // canopy
      for (const s of [-1, 1]) cb.box(0.04, 1.2, 1.4, s * 1.81, 0.5, 0.3, 0x2f3d4a);
      this.bridgeCab = instanced(cb.geometry(), M.vehicle, n, { name: 'bridge-cab' });
      const lb = new Batch();
      for (const s of [-0.45, 0.45]) lb.box(0.35, 1, 0.35, s, 0.5, 0, 0x8d949c);
      lb.box(1.4, 0.15, 0.5, 0, 0.98, 0, 0x5c6168);
      this.bridgeLeg = instanced(lb.geometry(), M.vehicle, n, { name: 'bridge-leg' });
      const bb = new Batch();
      bb.box(3.0, 0.4, 1.2, 0, 0.75, 0, 0x5c6168);
      for (const s of [-1.1, 1.1]) {
        bb.cyl(0.5, 0.5, 0.4, s, 0.5, 0, 0x17191c, 10, { matrix: trse(s, 0.5, 0, 0, 0, Math.PI / 2) });
      }
      this.bridgeBogie = instanced(bb.geometry(), M.vehicle, n, { name: 'bridge-bogie' });
      this.group.add(this.bridgeTunnel, this.bridgeCab, this.bridgeLeg, this.bridgeBogie);
      for (const b of this.bridges) this.poseBridge(b);
      for (const m of [this.bridgeTunnel, this.bridgeCab, this.bridgeLeg, this.bridgeBogie]) m.instanceMatrix.needsUpdate = true;
    }
    /*
     * Culling. The vehicles move, so their instances' own bounds are no use;
     * but they never leave the apron, so one sphere round the apron and the
     * terminal (plus the lane the spare crew comes in on) bounds every one of
     * them, and the whole fleet drops out of the frame when you look away.
     */
    const lay = this.lay;
    if (lay.apron) {
      const r = lay.apron.rect;
      const t = lay.terminal ? lay.terminal.rect : r;
      const x0 = Math.min(r.x0, t.x0) - 60;
      const x1 = Math.max(r.x1, t.x1) + 60;
      const z0 = Math.min(r.z0, t.z0) - 60;
      const z1 = Math.max(r.z1, t.z1) + 60;
      const sphere = new THREE.Sphere(new THREE.Vector3((x0 + x1) / 2, ELEV + 5, (z0 + z1) / 2), Math.hypot(x1 - x0, z1 - z0) / 2);
      const all = Object.values(this.meshes);
      if (this.bridgeTunnel) all.push(this.bridgeTunnel, this.bridgeCab, this.bridgeLeg, this.bridgeBogie);
      for (const m of all) {
        m.boundingSphere = sphere.clone();
        m.frustumCulled = true;
      }
    }
    // Pose the parts that sit on their trucks, now the meshes exist.
    for (const c of this.crews) {
      if (c.tg) this.poseCrewStatic(c);
      if (c.tg && c.poses && c.opts.full) this.startTrain(c);
    }
    // Beacons: one Points, hidden until night or until something is moving.
    const pos = [];
    const cols = [];
    const cc = new THREE.Color();
    for (const b of this.beacons) {
      pos.push(b.x, b.y, b.z);
      cc.set(b.hex);
      cols.push(cc.r, cc.g, cc.b);
    }
    if (pos.length) {
      this.beaconPoints = glowPoints(pos, cols, 2.2, { opacity: 0.95, name: 'vehicle-beacons' });
      this.group.add(this.beaconPoints);
      this.beaconAttr = this.beaconPoints.geometry.attributes.position;
      this.beaconAttr.setUsage(THREE.DynamicDrawUsage);
    }
    this.syncBeacons();
  }

  /** Stairs, hose, belt and catering box, placed on their trucks. */
  poseCrewStatic(c) {
    const P = c.poses;
    if (!P || !c.opts.full) return;
    if (!c.light) {
      // Stairs on the stair truck, reaching its door.
      const st = P.stairTruck;
      const rise = Math.max(0.6, st.sill - (ELEV + V.STAIR_BED_Y));
      trs(st.x, ELEV + V.STAIR_BED_Y, st.z, st.yaw, 1, rise, 1, _m);
      this.set('stair', c.v.stair, _m);
      // The belt, up to the hold.
      const bl = P.beltLoader;
      const brise = Math.max(0.4, bl.sill - (ELEV + 0.8));
      trs(bl.x, ELEV + 0.8, bl.z, bl.yaw, 1, brise, 1, _m);
      this.set('belt', c.v.belt, _m);
    }
    // Hose, from the bowser's reel to the wing.
    const ft = P.fuelTruck;
    const h = ft.heading * D2R;
    const reel = V.FUEL_HOSE_REEL;
    const ax = ft.x + Math.cos(h) * reel[0] - Math.sin(h) * reel[2];
    const az = ft.z + Math.sin(h) * reel[0] + Math.cos(h) * reel[2];
    const ay = ELEV + reel[1];
    this.setTube('hose', c.v.hose, ax, ay, az, P.hoseTo.x, P.hoseTo.y, P.hoseTo.z);
    // Beacon on the tug.
    const tb = V.TUG_BEACON;
    const th = P.tug.heading * D2R;
    this.moveBeacon(c.beacons.tug, P.tug.x + Math.cos(th) * tb[0] - Math.sin(th) * tb[2], ELEV + tb[1], P.tug.z + Math.sin(th) * tb[0] + Math.cos(th) * tb[2]);
    if (c.light) return;
    // Catering box at its current height, and the truck's beacon.
    this.poseLift(c);
    const ch = P.cateringTruck.heading * D2R;
    this.moveBeacon(c.beacons.cater, P.cateringTruck.x + Math.sin(ch) * 3.4, ELEV + 2.5, P.cateringTruck.z - Math.cos(ch) * 3.4);
  }

  /** The catering box: up to the galley door, a while there, and down again. */
  poseLift(c) {
    const P = c.poses;
    const ct = P.cateringTruck;
    const top = Math.max(V.CATER_BED_Y + 0.3, ct.sill - ELEV);
    const low = V.CATER_BED_Y + 0.15;
    // A 60 s cycle: 9 s up, 24 s at the door, 9 s down, 18 s loaded below.
    const t = c.lift.phase % 60;
    let k;
    if (t < 9) k = t / 9;
    else if (t < 33) k = 1;
    else if (t < 42) k = 1 - (t - 33) / 9;
    else k = 0;
    k = k * k * (3 - 2 * k);
    const hgt = low + (top - low) * k;
    if (Math.abs(hgt - c.lift.h) < 1e-3 && c.lift.posed) return;
    c.lift.h = hgt;
    c.lift.posed = true;
    trs(ct.x, ELEV + hgt, ct.z, ct.yaw, 1, 1, 1, _m);
    this.set('cateringBox', c.v.cateringBox, _m);
    trs(ct.x, ELEV + V.CATER_BED_Y, ct.z, ct.yaw, 1, Math.max(0.05, hgt - V.CATER_BED_Y), 1, _m);
    this.set('scissor', c.v.scissor, _m);
  }

  startTrain(c) {
    c.train = { path: new Path(c.poses.loop, true), d: Math.random() * 40, speed: 2.4 };
  }

  set(kind, i, m) {
    const mesh = this.meshes && this.meshes[kind];
    if (!mesh || i == null) return;
    mesh.setMatrixAt(i, m);
    mesh.instanceMatrix.needsUpdate = true;
  }

  setTube(kind, i, ax, ay, az, bx, by, bz) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.05) return;
    _v.set(dx / len, dy / len, dz / len);
    _q.setFromUnitVectors(_s.set(0, 1, 0), _v);
    _v.set(ax, ay, az);
    _s.set(1, len, 1);
    _m.compose(_v, _q, _s);
    this.set(kind, i, _m);
  }

  moveBeacon(i, x, y, z) {
    if (i == null) return;
    const b = this.beacons[i];
    b.x = x;
    b.y = y;
    b.z = z;
    if (this.beaconAttr) {
      this.beaconAttr.setXYZ(i, x, y, z);
      this.beaconAttr.needsUpdate = true;
    }
  }

  syncBeacons() {
    if (!this.beaconAttr) return;
    this.beacons.forEach((b, i) => this.beaconAttr.setXYZ(i, b.x, b.y, b.z));
    this.beaconAttr.needsUpdate = true;
  }

  /* ------------------------------------------------------ the spare crew -- */

  /**
   * Send the spare crew to an aeroplane parked at (x, z) facing headingDeg.
   * `info` is its measurements (estimateInfo(typeId), or a measured one).
   * `stand` is the layout stand it is on, for the bridge. They come out from
   * behind the end of the terminal and drive to their places.
   */
  callCrew(x, z, headingDeg, info, stand = null) {
    const c = this.spare;
    if (!c || !info) return false;
    const tg = makeTarget(x, z, headingDeg, info);
    c.tg = tg;
    c.opts.bridge = !!(stand && stand.bridge);
    c.poses = this.servicePoses(tg, c.opts);
    c.state = 'arriving';
    c.t = 0;
    /*
     * Where they come from: the end of the terminal nearest the stand — but
     * no more than 120 m up the service road. At San Francisco the middle
     * gates are 530 m from either end, and the crew took 88 s to arrive at
     * 6 m/s; a ten-year-old has taxied off by then. Airside roads have ways
     * through between the gates; this is one of them.
     */
    const lay = this.lay;
    const F = lay.frame;
    const T = lay.terminal;
    let endU = T && Math.abs(F.x(T.u0) - x) < Math.abs(F.x(T.u1) - x) ? T.u0 - 8 : (T ? T.u1 + 8 : lay.apron.u1);
    const su = x - F.cx;
    if (Math.abs(endU - su) > 120) endU = su + Math.sign(endU - su) * 120;
    /*
     * The service lane: the airside road under the bridges, where there is a
     * terminal with bridges. A strip's stands back straight onto the
     * clubhouse, so the lane "behind" them (T.front - 8) was their nose line —
     * the crew drove out across every parked aeroplane's nose to get to you.
     * There they come along the taxi lane in front instead.
     */
    const behind = !!(T && lay.bridges);
    const laneW = behind ? T.front - 8 : lay.apron.w0 + 6;
    const from = { x: F.x(endU), z: F.z(laneW) };
    c.moves = [];
    /*
     * A light aeroplane gets fuel, power and the tug. A catering truck, a
     * belt loader and a baggage train round a four-seat Skylark buried it so
     * deep in trucks it could not be seen at all.
     */
    c.light = info.halfSpan * 2 < 18;
    const order = c.light ? ['tug', 'gpu', 'fuelTruck'] : ['tug', 'gpu', 'stairTruck', 'beltLoader', 'cateringTruck', 'fuelTruck'];
    order.forEach((kind, i) => {
      const pose = c.poses[kind];
      if (!pose) return;
      // Line up behind the target, then turn in: a point 14 m back along the
      // way the vehicle will finally face — but never beyond the lane, which
      // for the tug (facing the aeroplane from in front) is inside the
      // terminal on a bridged apron, and out on the taxiway on a strip.
      const hh = pose.heading * D2R;
      const pre = { x: pose.x - Math.sin(hh) * 14, z: pose.z + Math.cos(hh) * 14 };
      const wPre = (pre.z - F.cz) * F.side;
      if (behind ? wPre > laneW : wPre < laneW) pre.z = from.z;
      const lane = { x: pre.x, z: from.z };
      const path = new Path([from, lane, pre, { x: pose.x, z: pose.z }], false);
      c.moves.push({ kind, slot: c.v[kind], path, d: -i * 9, pose, done: false });
    });
    if (stand && stand.bridge && !c.light) this.dockVisitor(stand, tg);
    return true;
  }

  /** Is the spare crew finished parking round the aeroplane? */
  crewReady() {
    const c = this.spare;
    return !!(c && c.state === 'working');
  }

  /** Send the spare crew away again (after pushback). */
  dismissCrew() {
    const c = this.spare;
    if (!c || c.state === 'away') return;
    c.state = 'away';
    c.train = null;
    for (const k of Object.keys(c.v)) {
      const v = c.v[k];
      const kind = k === 'cones' ? 'cone' : k === 'carts' ? 'cart' : k;
      if (Array.isArray(v)) v.forEach((i) => this.set(kind, i, HIDDEN));
      else this.set(kind, v, HIDDEN);
    }
    for (const b of Object.values(c.beacons || {})) this.moveBeacon(b, 0, -1e4, 0);
    // The bridge they docked goes home.
    for (const b of this.bridges) if (b.visitor === 'spare') this.undock(b);
  }

  /** The spare crew's tug, for the pushback: its instance and pose. */
  spareTug() {
    const c = this.spare;
    return c ? { mesh: this.meshes.tug, index: c.v.tug } : null;
  }

  /** Put the spare tug at a pose (world), for the pushback feature. */
  placeSpareTug(x, z, yaw) {
    const c = this.spare;
    if (!c) return;
    trs(x, ELEV, z, yaw, 1, 1, 1, _m);
    this.set('tug', c.v.tug, _m);
    const tb = V.TUG_BEACON;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    this.moveBeacon(c.beacons.tug, x + tb[0] * cy + tb[2] * sy, ELEV + tb[1], z - tb[0] * sy + tb[2] * cy);
  }

  /** Clear the spare crew off the aeroplane, all but the tug. */
  clearForPushback() {
    const c = this.spare;
    if (!c) return;
    for (const k of Object.keys(c.v)) {
      if (k === 'tug') continue;
      const v = c.v[k];
      const kind = k === 'cones' ? 'cone' : k === 'carts' ? 'cart' : k;
      if (Array.isArray(v)) v.forEach((i) => this.set(kind, i, HIDDEN));
      else this.set(kind, v, HIDDEN);
    }
    c.train = null;
    c.state = 'pushback';
    this.moveBeacon(c.beacons.tractor, 0, -1e4, 0);
    this.moveBeacon(c.beacons.cater, 0, -1e4, 0);
    for (const b of this.bridges) if (b.visitor === 'spare') this.undock(b);
  }

  dockVisitor(stand, tg, who = 'spare') {
    const b = this.bridges.find((q) => q.st === stand);
    if (!b || b.st.parked) return;
    this.dockTo(b, tg);
    b.target = 1;
    b.visitor = who;
  }

  undock(b) {
    b.target = 0;
    b.visitor = null;
  }

  /**
   * Aeroplanes stopped on stands that are not ours — the player, the
   * traffic. [{ x, z, headingDeg, typeId, id }]. Each bridge whose stand has
   * one on it swings out to its door; a bridge whose visitor has gone swings
   * back. The services feature calls this twice a second.
   */
  setVisitors(list) {
    for (const b of this.bridges) {
      if (b.st.parked || b.visitor === 'spare') continue;
      const st = b.st;
      let found = null;
      let info = null;
      for (const v of list) {
        const dx = v.x - st.x;
        const dz = v.z - st.z;
        if (Math.abs(dx) > st.pitch / 2 || Math.abs(dz) > st.depth / 2 + 4) continue;
        // Facing into the stand, near enough.
        const dh = Math.abs(((v.headingDeg - st.headingDeg + 540) % 360) - 180);
        if (dh > 25) continue;
        // A bridge is for an airliner's door, not a four-seater's.
        const vi = v.info || estimateInfo(v.typeId);
        if (!vi || vi.halfSpan * 2 < 18) continue;
        found = v;
        info = vi;
        break;
      }
      if (found) {
        if (b.visitor !== found.id || !b.dock) this.dockTo(b, makeTarget(found.x, found.z, found.headingDeg, info));
        b.visitor = found.id;
        b.target = 1;
      } else if (b.visitor) {
        this.undock(b);
      }
    }
  }

  /* -------------------------------------------------------------- flush -- */

  flush() {
    const add = (b, mat, opts) => {
      const m = b.mesh(mat, opts);
      if (m) this.group.add(m);
      return m;
    };
    add(this.b.vc, this.mats.vc, { name: 'apron-structures' });
    add(this.b.paint, this.mats.paint, { cast: false, name: 'apron-paint' });
    const w = add(this.b.wall, this.mats.wall, { name: 'terminal-walls' });
    if (w) w.geometry.deleteAttribute('color');
    officeFloors(w, ELEV + 0.2);
    const r = add(this.b.roof, this.mats.roof, { name: 'terminal-roof' });
    if (r) r.geometry.deleteAttribute('color');
    this.b = null;
  }

  /* ------------------------------------------------------------- update -- */

  update(dt, weather) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    this.t += dt;
    const night = !!(weather && (weather.isNight || (weather.cond && weather.cond.cloud > 0.8)));
    if (night !== this.night) {
      this.night = night;
      if (this.glassMat) this.glassMat.emissiveIntensity = night ? 0.9 : 0;
      if (this.boardMat) this.boardMat.emissiveIntensity = night ? 1.0 : 0.2;
    }
    // Beacons flash once a second; brighter at night.
    if (this.beaconPoints) {
      this.beaconPoints.visible = this.t % 1 < 0.45;
      this.beaconPoints.material.opacity = night ? 1 : 0.8;
    }

    // Catering lifts and baggage trains.
    for (const c of this.crews) {
      if (!c.tg || !c.poses || !c.opts.full) continue;
      if (c.state === 'working' && !c.light) {
        c.lift.phase += dt;
        this.poseLift(c);
      }
      if (c.train && c.state === 'working') this.stepTrain(c, dt);
      if (c.state === 'arriving') this.stepArrival(c, dt);
    }
    // The follow-me van.
    const fm = this.followMe;
    if (fm && this.meshes.followMe) {
      fm.d += dt * 5.5;
      const s = fm.path.sample(fm.d, this._p || (this._p = { x: 0, z: 0, yaw: 0 }));
      trs(s.x, ELEV, s.z, s.yaw, 1, 1, 1, _m);
      this.set('followMe', fm.slot, _m);
      this.moveBeacon(fm.beacon, s.x, ELEV + 2.1, s.z);
    }
    // Bridges easing in and out: about ten seconds end to end.
    for (const b of this.bridges) {
      if (b.ext !== b.target) {
        const rate = dt / 10;
        b.ext = b.ext < b.target ? Math.min(b.target, b.ext + rate) : Math.max(b.target, b.ext - rate);
        if (b.ext === 0 && !b.visitor) b.dock = null;
        b.dirty = true;
      }
      if (b.dirty && this.bridgeTunnel) {
        this.poseBridge(b);
        for (const m of [this.bridgeTunnel, this.bridgeCab, this.bridgeLeg, this.bridgeBogie]) m.instanceMatrix.needsUpdate = true;
      }
    }
  }

  stepTrain(c, dt) {
    const tr = c.train;
    tr.d += dt * tr.speed;
    const p = this._p || (this._p = { x: 0, z: 0, yaw: 0 });
    tr.path.sample(tr.d, p);
    trs(p.x, ELEV, p.z, p.yaw, 1, 1, 1, _m);
    this.set('tractor', c.v.tractor, _m);
    this.moveBeacon(c.beacons.tractor, p.x, ELEV + 2.15, p.z);
    for (let i = 0; i < c.v.carts.length; i++) {
      tr.path.sample(tr.d - 3.1 - i * 2.9, p);
      trs(p.x, ELEV, p.z, p.yaw, 1, 1, 1, _m);
      this.set('cart', c.v.carts[i], _m);
    }
  }

  /** The spare crew driving in, one after another. */
  stepArrival(c, dt) {
    let all = true;
    const p = this._p || (this._p = { x: 0, z: 0, yaw: 0 });
    for (const mv of c.moves) {
      if (mv.done) continue;
      mv.d += dt * CREW_SPEED;
      if (mv.d < 0) {
        all = false;
        continue;
      }
      if (mv.d >= mv.path.length) {
        mv.done = true;
        trs(mv.pose.x, ELEV, mv.pose.z, mv.pose.yaw, 1, 1, 1, _m);
        this.set(mv.kind, mv.slot, _m);
        continue;
      }
      all = false;
      mv.path.sample(mv.d, p);
      trs(p.x, ELEV, p.z, p.yaw, 1, 1, 1, _m);
      this.set(mv.kind, mv.slot, _m);
      if (mv.kind === 'tug') this.moveBeacon(c.beacons.tug, p.x, ELEV + 2.6, p.z);
    }
    if (all) {
      c.state = 'working';
      c.lift.phase = 0;
      c.lift.posed = false;
      this.poseCrewStatic(c);
      // Cones out, and the baggage train starts its rounds.
      c.poses.cones.forEach((q, i) => {
        trs(q.x, ELEV, q.z, q.yaw, 1, 1, 1, _m);
        this.set('cone', c.v.cones[i], _m);
      });
      if (!c.light) this.startTrain(c);
    }
  }
}
