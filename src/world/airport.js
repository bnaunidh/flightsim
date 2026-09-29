/**
 * The airfield: runways, taxiways, lights, signs, the control tower, hangars,
 * the fire station, the fuel farm and the car park — on whichever map is
 * loaded, sized to its runway.
 *
 * WHERE THINGS GO is not decided here. airport-layout.js works that out from
 * the map and checks every footprint against the ground, the runways, the
 * pavement and the map's own furniture; this file draws what it is given.
 * The terminal, the jet bridges, the parked aeroplanes and the vehicles are
 * in apron.js.
 *
 * WHAT IT COSTS. The airport that was here drew about 350 meshes. Everything
 * repeated is now one mesh or one InstancedMesh — every hangar's cladding is
 * one draw call, every light's glow on the field is one THREE.Points — and
 * the whole airfield, tower and all, is about thirty draw calls whichever
 * map it is.
 *
 * KEPT EXACTLY: the runway mesh, its elevation, RUNWAY and RUNWAY2 and the
 * objects inside them, refreshRunways(), the PAPI and updatePapi(). The
 * landing tests, the missions and the ATC are written against those.
 *
 * The PAPI (those four lights beside the runway) is the friendliest landing aid
 * there is: two white and two red means you are on a perfect glide path, and the
 * tutorial teaches exactly that.
 */

import * as THREE from '../vendor/three.module.js';
import * as Terrain from './terrain.js';
import { AIRPORT, heightAt, addObstacleAt } from './terrain.js';
import {
  runwayTexture,
  asphaltTexture,
  asphaltNormal,
  buildingTexture,
  hangarTexture,
  roofTexture,
} from '../render/textures.js';
import { airportLayout, onAirportPavement, pavedIn, standSlot } from './airport-layout.js';
import { Batch, vcMaterial, instanced, settle, glowPoints, canvas, canvasTexture, trs, trse, yawOf, layer } from './airport-kit.js';
import { fireEngineGeometry, carGeometry } from './airport-vehicles.js';

export { airportLayout } from './airport-layout.js';

/*
 * Field elevation.
 *
 * This was `const ELEV = AIRPORT.elev` — read once, at import, when AIRPORT is
 * still Kestrel's. Every other map then built its airport at Kestrel's height:
 * ten metres out at the three real fields, and 286 m out at the air base,
 * where the runway paint, the tower and every mission's touchdown point sat
 * underground while the aeroplane stood on the ground above them.
 *
 * `let`, refreshed by refreshRunways(), which main.js calls after applyMap().
 */
let ELEV = AIRPORT.elev;

/**
 * Re-read the field from whichever map is now loaded.
 *
 * RUNWAY and RUNWAY2 are mutated in place rather than replaced, because the
 * missions and the ATC director hold references to them and to the Vector3s
 * inside them — handing out new objects would leave every one of those
 * pointing at the old field.
 */
export function refreshRunways() {
  ELEV = AIRPORT.elev;

  Object.assign(RUNWAY, AIRPORT.runway, { elev: ELEV, headingDeg: AIRPORT.headingDeg ?? 90 });
  const halfLen = AIRPORT.runway.length / 2;
  /*
   * The aiming point, 200 m in from the westerly threshold.
   *
   * That is where it has always been on Kestrel (threshold -550, touchdown
   * -350) and it is what the tutorial, the missions and the landing grade are
   * all written around — so it is kept as a fixed distance from the threshold
   * rather than a fraction of the runway, which would move it on every map
   * with a different length.
   */
  RUNWAY.touchdown.set(AIRPORT.runway.cx - halfLen + 200, ELEV, AIRPORT.runway.cz);
  RUNWAY.thresholdWest.set(AIRPORT.runway.cx - halfLen, ELEV, AIRPORT.runway.cz);
  RUNWAY.thresholdEast.set(AIRPORT.runway.cx + halfLen, ELEV, AIRPORT.runway.cz);

  const r2 = AIRPORT.runway2;
  if (r2) {
    Object.assign(RUNWAY2, r2, { elev: ELEV });
    RUNWAY2.thresholdNorth.set(r2.cx, ELEV, r2.cz - r2.length / 2);
    RUNWAY2.thresholdSouth.set(r2.cx, ELEV, r2.cz + r2.length / 2);
  }
  return ELEV;
}
/** The crosswind runway, 18/36. */
export const RUNWAY2 = {
  ...AIRPORT.runway2,
  elev: ELEV,
  // 18 is flown southbound (+Z), 36 northbound.
  thresholdNorth: new THREE.Vector3(AIRPORT.runway2.cx, ELEV, AIRPORT.runway2.cz - AIRPORT.runway2.length / 2),
  thresholdSouth: new THREE.Vector3(AIRPORT.runway2.cx, ELEV, AIRPORT.runway2.cz + AIRPORT.runway2.length / 2),
};

export const RUNWAY = {
  ...AIRPORT.runway,
  elev: ELEV,
  headingDeg: 90,
  // Aiming point for a runway 09 (westerly) approach.
  touchdown: new THREE.Vector3(-350, ELEV, 0),
  thresholdWest: new THREE.Vector3(-550, ELEV, 0),
  thresholdEast: new THREE.Vector3(550, ELEV, 0),
};

/* ------------------------------------------------------------------ */
/* The contract other teams build against                               */
/* ------------------------------------------------------------------ */

/**
 * Where an aeroplane can be parked on this map, right now.
 *
 *   [{ id, kind: 'stand' | 'hangar', x, y, z, headingDeg, maxSpan,
 *      maxLength, noseX?, noseZ?, bridge?, size? }]
 *
 * (x, z) is the middle of the parking box: an aeroplane centred there and
 * pointing `headingDeg` fits without touching its neighbours, if its span is
 * no more than `maxSpan` and its length no more than `maxLength`. y is the
 * ground. On a stand, (noseX, noseZ) is the stop line, for anyone who wants to
 * pull the nose up to the bridge instead of centring. A hangar's heading
 * points out of the doors, because aeroplanes are put away tail first.
 *
 * Only FREE places: the stands with an aeroplane of the airport's own on them
 * are left out, so nothing is parked on top of anything. The list is pure —
 * computed from the map, not from the built world — so it can be asked
 * before the world exists, and every call returns fresh objects. Once the
 * world is built it also offers the stands whose aeroplane the detail level
 * left undrawn (none at 'low', three at 'medium'), which are empty concrete.
 */
export function parkingSlots() {
  const lay = airportLayout();
  const out = lay.slots.map((s) => ({ ...s }));
  for (const st of lay.stands) if (st.occupant && lay.undrawn.has(st)) out.push(standSlot(st, lay.elev));
  for (const h of lay.hangars) if (h.occupant && lay.undrawn.has(h)) out.push({ ...h.slot, y: lay.elev });
  return out;
}

/**
 * Where to stand to watch the field like a controller: on the tower's
 * gallery, on the runway side. camera.js still uses Kestrel's number for its
 * tower view; this is the same point on every map.
 */
export function towerViewpoint() {
  const lay = airportLayout();
  if (!lay.tower) return { x: 40, y: ELEV + 29, z: -195 };
  const t = lay.tower;
  const F = lay.frame;
  return { x: t.x, y: ELEV + Math.min(29, t.H * 0.45), z: F.z(t.w - t.size / 2 - 3) };
}

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */

/** Asphalt whose texture is laid in world metres, so every slab joins up. */
function pavementMaterial(which = 'pavement') {
  return layer(
    new THREE.MeshStandardMaterial({
      map: asphaltTexture(),
      normalMap: asphaltNormal(),
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 0.92,
      metalness: 0.02,
    }),
    which
  );
}

/*
 * Every building stands on a concrete plinth that goes 1.5 m into the ground.
 * The layout lets a footprint sit on ground up to 0.8 m below field level,
 * and without this the edge of that footprint is a gap you can see daylight
 * through.
 */
const PLINTH = 1.5;
function plinth(batch, x0, x1, z0, z1, color = 0xb4b6b0) {
  batch.slab(x0 - 0.2, x1 + 0.2, ELEV - PLINTH, ELEV + 0.02, z0 - 0.2, z1 + 0.2, color);
}

/** The asphalt texture used to be cloned with a repeat per slab; this
 *  is the same look at 20 m a tile, laid by world position instead. */
const PAVE_TILE = 20;

/* ------------------------------------------------------------------ */
/* Sign faces                                                          */
/* ------------------------------------------------------------------ */

/**
 * Every sign on the field in one texture: 4 x 8 cells of 256 x 64.
 * Styles are the real ones: mandatory is white on red, location is yellow on
 * black with a yellow border, direction is black on yellow.
 */
function signAtlas(signs) {
  const W = 1024;
  const H = 512;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const cells = [];
  const style = {
    mandatory: ['#c8201c', '#ffffff'],
    location: ['#15171a', '#f2c200'],
    direction: ['#f2c200', '#15171a'],
    plate: ['#e9ecee', '#1d2a36'],
  };
  const arrow = (x, y, dir, col) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    const s = 18;
    if (dir === 'left') { ctx.moveTo(x - s, y); ctx.lineTo(x + s * 0.4, y - s); ctx.lineTo(x + s * 0.4, y + s); }
    else if (dir === 'right') { ctx.moveTo(x + s, y); ctx.lineTo(x - s * 0.4, y - s); ctx.lineTo(x - s * 0.4, y + s); }
    else if (dir === 'up') { ctx.moveTo(x, y - s); ctx.lineTo(x - s, y + s * 0.5); ctx.lineTo(x + s, y + s * 0.5); }
    else { ctx.moveTo(x, y + s); ctx.lineTo(x - s, y - s * 0.5); ctx.lineTo(x + s, y - s * 0.5); }
    ctx.closePath();
    ctx.fill();
  };
  signs.forEach((s, i) => {
    if (i >= 32) return;
    const cx = (i % 4) * 256;
    const cy = Math.floor(i / 4) * 64;
    const [bg, fg] = style[s.kind] || style.plate;
    ctx.fillStyle = bg;
    ctx.fillRect(cx, cy, 256, 64);
    if (s.kind === 'location') {
      ctx.strokeStyle = fg;
      ctx.lineWidth = 5;
      ctx.strokeRect(cx + 6, cy + 6, 244, 52);
    }
    ctx.fillStyle = fg;
    ctx.font = 'bold 40px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tx = s.arrow ? cx + 150 : cx + 128;
    ctx.fillText(s.text, tx, cy + 34, 200);
    if (s.arrow) arrow(cx + 44, cy + 32, s.arrow, fg);
    cells.push({ u0: cx / W, u1: (cx + 256) / W, v0: 1 - (cy + 64) / H, v1: 1 - cy / H });
  });
  const tex = canvasTexture(c);
  return { tex, cells };
}

/* ------------------------------------------------------------------ */
/* The airfield                                                        */
/* ------------------------------------------------------------------ */

export class Airport {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'airport';
    this.t = 0;
    this.lightsOn = false;
    this.layout = airportLayout();
    this.doorState = [];

    this.mats = {
      vc: vcMaterial({ roughness: 0.85, metalness: 0.05 }),
      metal: vcMaterial({ roughness: 0.45, metalness: 0.55 }),
      paint: layer(vcMaterial({ roughness: 0.9 }), 'paint'),
      lamps: vcMaterial({ roughness: 0.4, emissive: new THREE.Color(0xfff1d0), emissiveIntensity: 0 }),
      wall: new THREE.MeshStandardMaterial({ map: buildingTexture(2), roughness: 0.85 }),
      wallWarm: new THREE.MeshStandardMaterial({ map: buildingTexture(3), roughness: 0.85 }),
      clad: new THREE.MeshStandardMaterial({ map: hangarTexture(), roughness: 0.68, metalness: 0.35, side: THREE.DoubleSide }),
      roof: new THREE.MeshStandardMaterial({ map: roofTexture(), roughness: 0.9 }),
    };
    // Batches everything static on the field draws into.
    this.b = {
      vc: new Batch(),
      metal: new Batch(),
      paint: new Batch(),
      lamps: new Batch(),
      wall: new Batch(),
      wallWarm: new Batch(),
      clad: new Batch(),
      roof: new Batch(),
      pave: new Batch(),
    };
    // Every light's glow on the field, as flat arrays for two Points.
    this.glowPos = [];
    this.glowCol = [];
    this.glowPosS = [];
    this.glowColS = [];
    // Light fixtures (the bright dots themselves), for one InstancedMesh.
    this.fixtures = [];

    this.buildPavement();
    this.buildTower();
    this.buildHangars();
    this.buildFireStation();
    this.buildFuelFarm();
    this.buildCarPark();
    this.buildFloodlights();
    this.buildSigns();
    this.buildWindsock();
    this.buildLighting();
    this.flushBatches();

    /*
     * The physics' isPaved() knows Kestrel's taxiway by its coordinates, so
     * on 26 of the 32 maps the taxiways and apron roll like grass (rolling
     * friction 0.075 against 0.022). terrain.js is not this file's to edit;
     * if it grows the hook asked for in the integration notes, hand it this
     * layout's made ground. A closure over the layout, so the wheel test
     * never asks airportLayout() anything.
     */
    if (typeof Terrain.setPavedExtra === 'function') {
      const lay = this.layout;
      Terrain.setPavedExtra((x, z) => pavedIn(lay, x, z));
    }

    scene.add(this.group);
  }

  /* ---------------------------------------------------------- pavement -- */

  buildPavement() {
    // Runway. The texture's long axis is rotated onto the world X axis so the
    // painted numbers, threshold bars and centreline land where they belong.
    const rwTex = runwayTexture();
    const rwMat = new THREE.MeshStandardMaterial({
      map: rwTex,
      normalMap: asphaltNormal(),
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughness: 0.9,
      metalness: 0.02,
    });
    // Depth bias only — see LAYER. The mesh, its size and its height are as
    // they always were.
    layer(rwMat, 'runway');
    this.runwayMat = rwMat;
    const rgeo = new THREE.PlaneGeometry(RUNWAY.halfWidth * 2, RUNWAY.length);
    rgeo.rotateX(-Math.PI / 2);
    const runway = new THREE.Mesh(rgeo, rwMat);
    runway.rotation.y = Math.PI / 2;
    runway.position.set(RUNWAY.cx, ELEV + 0.06, RUNWAY.cz);
    runway.receiveShadow = true;
    this.group.add(runway);

    /*
     * Slightly raised shoulder so the runway does not look pasted on.
     *
     * It was laid at (0, 0), 62 m wide, whatever the map: on Sennen, where
     * the runway is at (-5600, 2400), the shoulder was a strip of tarmac
     * five and a half kilometres away on its own. It follows the runway now,
     * 14 m out from each edge as it always was on Kestrel.
     */
    const shoulderMat = pavementMaterial('shoulder');
    const pave = this.b.pave;
    const shW = RUNWAY.halfWidth * 2 + 28;
    this.shoulderMat = shoulderMat;
    const shoulders = new Batch();
    const addShoulder = (cx, cz, lx, lz) => {
      const g = new THREE.PlaneGeometry(lx, lz);
      g.rotateX(-Math.PI / 2);
      shoulders.add(g, trs(cx, ELEV + 0.02, cz), 0xffffff, 0);
      g.dispose();
    };
    addShoulder(RUNWAY.cx, RUNWAY.cz, RUNWAY.length + 40, shW);

    /*
     * The crosswind runway, 18/36.
     *
     * Same texture. The plane comes out of PlaneGeometry lying length-along-Z,
     * which is heading 180 — 18/36's own heading, and the reason this looked
     * right for as long as every second runway was north-south.
     *
     * It was never turned, though. The main runway above gets a rotation.y and
     * this one got none at all, so at Los Angeles, where the second runway is
     * parallel to the first rather than across it, the painted centreline, the
     * numbers and the threshold bars were all laid at right angles to the
     * tarmac they belong to. Turn it by its own heading, the same way round as
     * the main runway does.
     *
     * And only where there IS one. Twelve maps have a single runway, and
     * RUNWAY2 keeps whatever the previous map left in it (refreshRunways only
     * overwrites it when the new map has one) — so every one of those maps drew
     * a phantom crosswind runway at another map's coordinates and height.
     */
    const r2 = RUNWAY2;
    if (AIRPORT.runway2) {
      const r2geo = new THREE.PlaneGeometry(r2.halfWidth * 2, r2.length);
      r2geo.rotateX(-Math.PI / 2);
      const r2rot = THREE.MathUtils.degToRad(180 - (r2.headingDeg ?? 180));
      const runway2 = new THREE.Mesh(r2geo, rwMat);
      runway2.rotation.y = r2rot;
      runway2.position.set(r2.cx, ELEV + 0.055, r2.cz);
      runway2.receiveShadow = true;
      this.group.add(runway2);
      // The shoulder has to follow it round, or it lies across the runway.
      const alongX = Math.abs((((r2.headingDeg ?? 180) % 180) - 90)) < 45;
      const sw = r2.halfWidth * 2 + 26;
      if (alongX) addShoulder(r2.cx, r2.cz, r2.length + 40, sw);
      else addShoulder(r2.cx, r2.cz, sw, r2.length + 40);
    }
    const sh = shoulders.mesh(shoulderMat, { cast: false, name: 'shoulders' });
    if (sh) {
      // World-metre UVs, so the asphalt reads the same size on every map.
      const uv = sh.geometry.attributes.uv;
      const p = sh.geometry.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / PAVE_TILE, p.getZ(i) / PAVE_TILE);
      sh.geometry.deleteAttribute('color');
      this.group.add(sh);
    }

    // Taxiways, connectors, apron, hangar lead-ins, the fire station's
    // driveway: every piece of made ground in the layout, as one mesh.
    const lay = this.layout;
    for (const r of lay.pavement) {
      const g = new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0);
      g.rotateX(-Math.PI / 2);
      pave.add(g, trs((r.x0 + r.x1) / 2, ELEV + 0.05, (r.z0 + r.z1) / 2), 0xffffff);
      g.dispose();
    }

    /* ---- paint ---- */
    const paint = this.b.paint;
    const Y = ELEV + 0.075;
    const yellow = 0xd9c02a;
    const F = lay.frame;
    if (lay.taxiway) {
      const t = lay.taxiway;
      // Centreline, the whole length.
      paint.flat(t.u1 - t.u0 - 4, 0.45, F.x((t.u0 + t.u1) / 2), Y, F.z(t.w), yellow);
      // Edge lines, both sides.
      for (const e of [-1, 1]) paint.flat(t.u1 - t.u0, 0.25, F.x((t.u0 + t.u1) / 2), Y, F.z(t.w + e * (t.width / 2 - 0.6)), yellow);
    }
    for (const c of lay.connectors) {
      const wa = lay.runway.halfWidth + 1;
      const wb = lay.taxiway.w;
      paint.flat(0.45, wb - wa, F.x(c.u), Y, F.z((wa + wb) / 2), yellow);
      /*
       * The holding position: two solid lines on the taxiway side and two
       * dashed on the runway side. You may cross it from the dashed side
       * (vacating the runway) but never from the solid side without a
       * clearance — the one bit of paint every pilot is taught first.
       */
      const hw = lay.taxiway.width / 2 - 0.5;
      const hwv = c.hold.w;
      for (const k of [0, 1]) paint.flat(hw * 2, 0.3, F.x(c.u), Y, F.z(hwv + 0.8 + k * 0.9), yellow);
      for (const k of [0, 1]) {
        for (let d = -hw; d < hw - 0.6; d += 2.0) paint.flat(1.1, 0.3, F.x(c.u + d + 0.55), Y, F.z(hwv - 0.8 - k * 0.9), yellow);
      }
    }
    // The stand lead-ins, numbers and stop bars are drawn by apron.js.
  }

  /* ------------------------------------------------------------- tower -- */

  /**
   * The control tower.
   *
   * A tall one on anything with jet bridges: a tapering concrete shaft with a
   * stair core up its back, a gallery, and a cab whose glass leans OUT at the
   * bottom so the controllers can look straight down at the apron without
   * reflections in the way — which is why the cab is wider at the top than
   * the bottom. On a strip, the flying club's square three-storey tower.
   */
  buildTower() {
    const lay = this.layout;
    if (!lay.tower) return;
    const T = lay.tower;
    const TX = T.x;
    const TZ = T.z;
    const vc = this.b.vc;
    const metal = this.b.metal;
    const CONC = 0xc3c7cb;
    const STEEL = 0xa8b0b8;
    if (T.kind === 'small') {
      const s = T.size;
      const H = T.H;
      this.b.wallWarm.box(s, H - 4, s, TX, ELEV + (H - 4) / 2, TZ, 0xffffff, 0, 6);
      plinth(vc, TX - s / 2, TX + s / 2, TZ - s / 2, TZ + s / 2);
      vc.box(s + 0.6, 0.4, s + 0.6, TX, ELEV + H - 3.8, TZ, CONC);
      // The cab: glass all round, a flat roof with a lip.
      this.addGlassBox(s - 1, 3.2, s - 1, TX, ELEV + H - 2, TZ);
      vc.box(s + 1.2, 0.35, s + 1.2, TX, ELEV + H + 0.1, TZ, CONC);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        metal.box(0.08, 1.0, 0.08, TX + Math.cos(a) * (s / 2 + 0.2), ELEV + H - 3.1, TZ + Math.sin(a) * (s / 2 + 0.2), STEEL);
      }
      metal.cyl(0.05, 0.08, 4, TX, ELEV + H + 0.3, TZ, STEEL, 6);
      addObstacleAt(TX, TZ, s + 1, s + 1, ELEV, H + 4, 'You flew into the control tower');
      this.addBeacon(TX, ELEV + H + 4.6, TZ, 0.5);
      return;
    }

    // Scale everything off Kestrel's 16 m footprint, so the hub's 20 m tower
    // and the compact field's 12 m one are the same design.
    const k = T.size / 16;
    const TOWER_H = T.H;
    /*
     * The shaft is bare concrete.
     *
     * It wore the office-block window texture, four times round and a row
     * every 3.5 m, which made a 64 m tower read as a round block of flats
     * with a hat on. A real tower shaft is a lift and a stair in a concrete
     * tube with nobody living in it: solid, with one tall slot of glass up
     * the stair and a ring every few floors. The windows belong in the
     * two-storey base block, where the offices are.
     */
    const SHAFT = 0xd5d8da;
    vc.cyl(4.6 * k, 6.4 * k, TOWER_H, TX, ELEV, TZ, SHAFT, 24);
    // The stair core up its back, away from the runway.
    const back = lay.side; // +1: further from the runway is +side in z
    const coreZ = TZ + back * 6.2 * k;
    vc.box(3.6 * k, TOWER_H, 3.6 * k, TX, ELEV + TOWER_H / 2, coreZ, 0xc9ccce);
    // Its glass slot, on the face away from the runway, lighting the stair.
    vc.box(1.1 * k, TOWER_H - 14, 0.12, TX, ELEV + 9 + (TOWER_H - 14) / 2, coreZ + back * (1.8 * k + 0.05), 0x2c3b48);
    /*
     * A ring every seven metres down from the gallery. Their radius used to
     * grow 6 cm a ring while the shaft's grows 20: from the third one down
     * they were inside the concrete. Sized off the shaft at their own height
     * now, 15 cm proud of it.
     */
    const shaftR = (fromTop) => 4.6 * k + 1.8 * k * (fromTop / TOWER_H);
    // The base block and the flared foot on its roof stand 9.7 m tall. On the
    // 34 m compact tower the fifth ring came out 3.5 m up, inside the block;
    // a ring is only drawn where there is bare shaft to put it on.
    const podH = 7.5;
    const footTop = podH + 2.2;
    for (let i = 0; i < 5; i++) {
      const y = 2.25 + i * 7;
      if (TOWER_H - y - 0.5 < footTop + 0.5) break;
      vc.cyl(shaftR(y - 0.25) + 0.15, shaftR(y + 0.25) + 0.15, 0.5, TX, ELEV + TOWER_H - y - 0.25, TZ, CONC, 24);
    }
    /*
     * The base block: two storeys of offices square round the foot of the
     * shaft, inside the footprint the layout reserved for the tower, so it
     * moves nothing else on the field.
     */
    const s = T.size;
    this.b.wall.box(s, podH, s, TX, ELEV + podH / 2, TZ, 0xffffff, 0, 6);
    vc.box(s + 0.8, 0.5, s + 0.8, TX, ELEV + podH + 0.25, TZ, CONC);
    vc.box(s * 0.35, 3, 0.4, TX, ELEV + 1.5, TZ - back * (s / 2 + 0.1), 0x2c3b48);
    vc.box(s * 0.45, 0.35, 2.4, TX, ELEV + 3.3, TZ - back * (s / 2 + 1.2), CONC);
    plinth(vc, TX - s / 2, TX + s / 2, TZ - s / 2, TZ + s / 2);
    // Flared foot of the shaft on the base block's roof.
    vc.cyl(6.4 * k, 7.6 * k, 2.2, TX, ELEV + podH, TZ, CONC, 24);
    // Solid, all the way up to the cab — and the cab and gallery too, which
    // stand out past the shaft's box. Registered from well above the ground
    // so the road router (which ignores anything starting over 4 m up) still
    // sees only the tower's footprint.
    addObstacleAt(TX, TZ, T.size, T.size, ELEV, TOWER_H + 11 * k, 'You flew into the control tower');
    addObstacleAt(TX, TZ, 22.8 * k, 22.8 * k, ELEV + TOWER_H - 1.2, 10 * k, 'You flew into the control tower');

    // The gallery the cab sits on, with a railing round it.
    vc.cyl(11.4 * k, 11.4 * k, 0.5, TX, ELEV + TOWER_H - 0.85, TZ, CONC, 20);
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      metal.cyl(0.07, 0.07, 1.1, TX + Math.cos(a) * 11.1 * k, ELEV + TOWER_H - 0.35, TZ + Math.sin(a) * 11.1 * k, STEEL, 5);
    }
    const railGeo = new THREE.TorusGeometry(11.1 * k, 0.06, 6, 32);
    metal.add(railGeo, trse(TX, ELEV + TOWER_H + 0.7, TZ, Math.PI / 2, 0, 0), STEEL);
    railGeo.dispose();

    // Cab glass: wider at the top, as above.
    const cabMat = new THREE.MeshPhysicalMaterial({
      color: 0x9fd8ef,
      roughness: 0.05,
      metalness: 0.25,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    });
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(9.4 * k, 7.6 * k, 7, 16, 1, true), cabMat);
    cab.position.set(TX, ELEV + TOWER_H + 3.4, TZ);
    cab.castShadow = true;
    this.group.add(cab);
    // Mullions between the panes, leaning with the glass.
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const r = 8.5 * k;
      metal.add(
        new THREE.BoxGeometry(0.16, 7.2, 0.3),
        trse(TX + Math.cos(a) * r, ELEV + TOWER_H + 3.4, TZ + Math.sin(a) * r, 0.12, -a, 0, 1, 1, 1),
        STEEL
      );
    }
    // The lit room inside, so there is obviously somebody up there at night.
    const roomMat = new THREE.MeshBasicMaterial({ color: 0x9fd0a8, transparent: true, opacity: 0.12 });
    const room = new THREE.Mesh(new THREE.CylinderGeometry(7.4 * k, 6.6 * k, 6.4, 16), roomMat);
    room.position.set(TX, ELEV + TOWER_H + 3.2, TZ);
    this.group.add(room);
    this.towerRoom = room.material;
    // Consoles round the inside edge.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      vc.box(3.4 * k, 1.0, 1.4, TX + Math.cos(a) * 6.2 * k, ELEV + TOWER_H + 0.6, TZ + Math.sin(a) * 6.2 * k, 0x2b3138, -a);
    }

    // Roof: a shallow cone with an overhanging brow that shades the glass.
    const cone = new THREE.ConeGeometry(10.6 * k, 2.2, 16);
    this.b.roof.add(cone, trs(TX, ELEV + TOWER_H + 8, TZ), 0xffffff, 0);
    cone.dispose();
    vc.cyl(10.8 * k, 10.8 * k, 0.4, TX, ELEV + TOWER_H + 6.8, TZ, CONC, 16);

    // Mast, aerials and the radar dish on top.
    metal.cyl(0.16, 0.22, 6, TX, ELEV + TOWER_H + 9, TZ, STEEL, 8);
    for (const [ax, az, len] of [[1.6, 0, 2.2], [-1.6, 0, 2.0], [0, 1.6, 1.8]]) {
      metal.cyl(0.05, 0.05, len, TX + ax, ELEV + TOWER_H + 10.5 - len / 2, TZ + az, STEEL, 5);
    }
    const dish = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.45),
      new THREE.MeshStandardMaterial({ color: 0xdfe3e7, roughness: 0.45, metalness: 0.3, side: THREE.DoubleSide })
    );
    dish.position.set(TX, ELEV + TOWER_H + 9.6, TZ);
    dish.rotation.x = Math.PI * 0.72;
    this.group.add(dish);
    this.towerDish = dish;
    this.addBeacon(TX, ELEV + TOWER_H + 15.2, TZ, 0.9);
  }

  /** The rotating green-white aerodrome beacon on top of the tower. */
  addBeacon(x, y, z, r) {
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshBasicMaterial({ color: 0x35ff6a }));
    beacon.position.set(x, y, z);
    this.group.add(beacon);
    this.beacon = beacon;
  }

  /** A glass box (the small tower's cab). */
  addGlassBox(w, h, d, x, y, z) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshPhysicalMaterial({ color: 0x9fd8ef, roughness: 0.05, metalness: 0.25, transparent: true, opacity: 0.55 })
    );
    m.position.set(x, y, z);
    this.group.add(m);
    const roomMat = new THREE.MeshBasicMaterial({ color: 0x9fd0a8, transparent: true, opacity: 0.12 });
    const room = new THREE.Mesh(new THREE.BoxGeometry(w - 0.6, h - 0.4, d - 0.6), roomMat);
    room.position.set(x, y, z);
    this.group.add(room);
    this.towerRoom = roomMat;
  }

  /* ----------------------------------------------------------- hangars -- */

  /**
   * Maintenance hangars: clad walls, a shallow pitched roof, and a row of
   * door leaves across the whole front that slide aside on their own track.
   *
   * Solid as walls and a roof, NOT as a box. The old arch was registered as
   * one block, so it was a building you crashed into at the door; this one
   * has a doorway you can taxi through when the doors are open, and a roof
   * you still cannot fly through.
   */
  buildHangars() {
    const lay = this.layout;
    const F = lay.frame;
    const clad = this.b.clad;
    const vc = this.b.vc;
    const lamps = this.b.lamps;
    const leaves = [];
    for (const h of lay.hangars) {
      const W = h.width;
      const D = h.depth;
      const H = h.H;
      const rise = W * 0.1;
      const t = 0.6;
      const r = h.rect;
      const cx = (r.x0 + r.x1) / 2;
      // Front is the edge nearest the runway.
      const zFront = F.z(h.w0);
      const zBack = F.z(h.w0 + D);
      const dz = Math.sign(zBack - zFront); // +1 if the hangar runs toward +Z
      const zMid = (zFront + zBack) / 2;
      const doorH = H - 3;
      // Side walls and back wall.
      clad.box(t, H, D, r.x0 + t / 2, ELEV + H / 2, zMid, 0xffffff, 0, 6);
      clad.box(t, H, D, r.x1 - t / 2, ELEV + H / 2, zMid, 0xffffff, 0, 6);
      clad.box(W, H, t, cx, ELEV + H / 2, zBack - (dz * t) / 2, 0xffffff, 0, 6);
      // Header above the doors.
      clad.box(W, H - doorH, t, cx, ELEV + doorH + (H - doorH) / 2, zFront + (dz * t) / 2, 0xffffff, 0, 6);
      // Gables and a pitched roof, as two tilted slabs.
      const half = W / 2;
      const slope = Math.atan2(rise, half);
      const len = Math.hypot(half, rise) + 0.6;
      for (const s of [-1, 1]) {
        this.b.roof.add(
          new THREE.BoxGeometry(len, 0.3, D + 1.2),
          trse(cx + (s * half) / 2, ELEV + H + rise / 2, zMid, 0, 0, -s * slope),
          0xffffff,
          8
        );
      }
      for (const zz of [zFront, zBack]) {
        const gable = new THREE.BufferGeometry();
        gable.setAttribute('position', new THREE.Float32BufferAttribute([
          r.x0, ELEV + H, zz, r.x1, ELEV + H, zz, cx, ELEV + H + rise, zz,
          r.x1, ELEV + H, zz, r.x0, ELEV + H, zz, cx, ELEV + H + rise, zz,
        ], 3));
        gable.computeVertexNormals();
        clad.add(gable, new THREE.Matrix4(), 0xffffff, 6);
        gable.dispose();
      }
      // The floor inside, and a painted parking box.
      vc.slab(r.x0 + t, r.x1 - t, ELEV + 0.02, ELEV + 0.1, Math.min(zFront, zBack) + 0.2, Math.max(zFront, zBack) - 0.2, 0x9c9fa3);
      plinth(vc, r.x0, r.x1, r.z0, r.z1);
      this.b.paint.flat(W * 0.7, 0.3, cx, ELEV + 0.13, F.z(h.w0 + 3), 0xd9c02a);
      // Lights under the roof, on at night.
      for (let i = 0; i < 3; i++) {
        for (const s of [-0.25, 0.25]) {
          lamps.box(W * 0.12, 0.2, 1.2, cx + s * W, ELEV + H - 1.2, F.z(h.w0 + D * (0.25 + i * 0.25)), 0xfff6e0);
        }
      }
      // Hangar number over the door.
      this.addPlate(`HANGAR ${h.number}`, cx, ELEV + doorH + (H - doorH) / 2, zFront - dz * 0.05, dz < 0 ? 180 : 0, Math.min(W * 0.45, 22), Math.min(3.2, (H - doorH) * 0.8));

      // Solid: two side walls, the back, the header and the roof.
      const what = 'You flew into a hangar';
      addObstacleAt(r.x0 + 0.5, zMid, 1.2, D, ELEV, H + rise, what);
      addObstacleAt(r.x1 - 0.5, zMid, 1.2, D, ELEV, H + rise, what);
      addObstacleAt(cx, zBack - dz * 0.6, W, 1.2, ELEV, H + rise, what);
      addObstacleAt(cx, zMid, W, D, ELEV + doorH, H + rise - doorH, what);

      /*
       * The track the leaves hang from, running out past both walls to where
       * they stack when open, on posts at its ends, and its twin in the
       * ground. It is what makes the stacked leaves look parked on something
       * rather than floating beside the building.
       */
      const trackZ = zFront - dz * 0.6;
      const reach = W / 4 + 0.6;
      this.b.metal.box(W + 2 * reach, 0.35, 1.1, cx, ELEV + doorH + 0.1, trackZ, 0x4f565e);
      this.b.metal.box(W + 2 * reach, 0.06, 1.1, cx, ELEV + 0.03, trackZ, 0x4f565e);
      for (const s of [-1, 1]) this.b.metal.box(0.3, doorH + 0.3, 0.3, cx + s * (W / 2 + reach - 0.2), ELEV + (doorH + 0.3) / 2, trackZ - dz * 0.6, 0x4f565e);

      // Door leaves: four, each a quarter of the opening, on staggered tracks.
      const n = 4;
      const lw = W / n + 0.3;
      const hs = { leaves: [], open: h.occupant ? 1 : 0, target: h.occupant ? 1 : 0, hold: h.occupant ? 1e9 : 0, hangar: h };
      for (let i = 0; i < n; i++) {
        const home = r.x0 + (W / n) * (i + 0.5);
        const side = i < n / 2 ? -1 : 1;
        // Open: stacked beyond the walls, outboard of the opening.
        const stow = side < 0 ? r.x0 - lw / 2 + 0.2 + i * 0.4 : r.x1 + lw / 2 - 0.2 - (n - 1 - i) * 0.4;
        const zTrack = zFront - dz * (0.4 + (i % 2) * 0.35);
        hs.leaves.push({ index: leaves.length, home, stow, z: zTrack, w: lw, h: doorH });
        leaves.push(0);
      }
      this.doorState.push(hs);
    }
    if (leaves.length) {
      const g = new THREE.BoxGeometry(1, 1, 0.25);
      this.doors = instanced(g, this.mats.clad, leaves.length, { name: 'hangar-doors' });
      /*
       * Every other leaf a shade darker. In the cladding's own colour a shut
       * hangar was one blank wall — nothing said "these are doors", or that
       * they would open.
       */
      const tint = new THREE.Color();
      for (let i = 0; i < leaves.length; i++) this.doors.setColorAt(i, tint.setHex(i % 2 ? 0xb9c3cf : 0xe4e9ef));
      this.doors.instanceColor.needsUpdate = true;
      this.group.add(this.doors);
      this._doorM = new THREE.Matrix4();
      for (const hs of this.doorState) this.poseDoors(hs);
      // The leaves only ever slide along their own hangar's front, inside the
      // ground the layout cleared for the doors; one sphere round all of
      // those bounds every position they can take.
      const box = new THREE.Box3();
      for (const h of lay.hangars) {
        const r = h.clearRect || h.rect;
        box.expandByPoint(new THREE.Vector3(r.x0, ELEV, r.z0));
        box.expandByPoint(new THREE.Vector3(r.x1, ELEV + h.H, r.z1));
      }
      this.doors.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
      this.doors.frustumCulled = true;
    }
  }

  poseDoors(hs) {
    const m = this._doorM;
    for (const l of hs.leaves) {
      const x = l.home + (l.stow - l.home) * hs.open;
      trs(x, ELEV + l.h / 2, l.z, 0, l.w, l.h, 1, m);
      this.doors.setMatrixAt(l.index, m);
    }
    this.doors.instanceMatrix.needsUpdate = true;
  }

  /**
   * Open a hangar's doors — or all of them. The services feature calls this
   * when an aeroplane rolls up to one; they close again on their own after
   * `holdSeconds`.
   */
  openHangar(id = null, holdSeconds = 60) {
    for (const hs of this.doorState) {
      if (id && hs.hangar.id !== id) continue;
      hs.target = 1;
      hs.hold = Math.max(hs.hold, holdSeconds);
    }
  }

  /** Doors open for anything on the ground within 160 m of them. */
  watchHangars(points) {
    for (const hs of this.doorState) {
      const r = hs.hangar.rect;
      const cx = (r.x0 + r.x1) / 2;
      const cz = (r.z0 + r.z1) / 2;
      for (const p of points) {
        if ((p.x - cx) ** 2 + (p.z - cz) ** 2 < 160 * 160) {
          hs.target = 1;
          hs.hold = Math.max(hs.hold, 20);
          break;
        }
      }
    }
  }

  /**
   * A name plate on a wall, its face looking toward heading `facingDeg`.
   * Drawn with the taxiway signs, from the same texture, in buildSigns().
   */
  addPlate(text, x, y, z, facingDeg, w, h) {
    (this.plates || (this.plates = [])).push({ kind: 'plate', text, x, y, z, facingDeg, w, h });
  }

  /* -------------------------------------------------------- fire station -- */

  buildFireStation() {
    const f = this.layout.fire;
    if (!f) return;
    const F = this.layout.frame;
    const r = f.rect;
    const cx = (r.x0 + r.x1) / 2;
    const zFront = F.z(f.w0);
    const zBack = F.z(f.w0 + f.depth);
    const dz = Math.sign(zBack - zFront);
    const zMid = (zFront + zBack) / 2;
    const W = f.width;
    const H = f.H;
    const vc = this.b.vc;
    // Walls: warm brick-ish texture, flat roof with a parapet.
    this.b.wallWarm.box(W, H, f.depth, cx, ELEV + H / 2, zMid, 0xffffff, 0, 5);
    plinth(vc, r.x0, r.x1, r.z0, r.z1);
    this.b.roof.box(W + 0.6, 0.4, f.depth + 0.6, cx, ELEV + H + 0.2, zMid, 0xffffff, 0, 8);
    // The bays, facing the runway: red doors, one of them open.
    const bays = f.bays;
    const bw = (W - 2) / bays;
    for (let i = 0; i < bays; i++) {
      const bx = r.x0 + 1 + bw * (i + 0.5);
      const open = i === 0;
      vc.box(bw - 1.2, H * 0.62, 0.3, bx, ELEV + H * 0.31, zFront - dz * 0.1, open ? 0x16181b : 0xc8322a);
      if (!open) for (let k = 1; k < 5; k++) vc.box(bw - 1.3, 0.08, 0.32, bx, ELEV + (H * 0.62 * k) / 5, zFront - dz * 0.12, 0xa82620);
    }
    // Hose-drying tower at one end.
    this.b.wallWarm.box(4, H + 7, 4, r.x1 - 2.5, ELEV + (H + 7) / 2, zBack - dz * 2.5, 0xffffff, 0, 5);
    vc.box(4.6, 0.4, 4.6, r.x1 - 2.5, ELEV + H + 7.2, zBack - dz * 2.5, 0x8d949c);
    this.addPlate('FIRE STATION', cx, ELEV + H * 0.82, zFront - dz * 0.05, dz < 0 ? 180 : 0, Math.min(W * 0.6, 16), 1.8);
    addObstacleAt(cx, zMid, W, f.depth, ELEV, H + 1, 'You flew into the fire station');
    addObstacleAt(r.x1 - 2.5, zBack - dz * 2.5, 4, 4, ELEV, H + 7.5, 'You flew into the fire station');

    // Crash tenders: one inside the open bay, the rest out front, ready.
    const geo = fireEngineGeometry();
    const n = Math.min(3, bays + 1);
    const inst = instanced(geo, this.mats.vc, n, { name: 'fire-engines' });
    const m = new THREE.Matrix4();
    // Pointing out of the bays, at the runway.
    const hdg = F.side < 0 ? 180 : 0;
    for (let i = 0; i < n; i++) {
      const bx = r.x0 + 1 + bw * (Math.min(i, bays - 1) + 0.5);
      const inside = i === 0;
      const z = inside ? F.z(f.w0 + 5) : F.z(f.w0 - 8);
      const x = inside ? bx : r.x0 + 1 + bw * ((i % bays) + 0.5);
      trs(x, ELEV, z, yawOf(hdg), 1, 1, 1, m);
      inst.setMatrixAt(i, m);
    }
    this.group.add(settle(inst));
  }

  /* ---------------------------------------------------------- fuel farm -- */

  buildFuelFarm() {
    const f = this.layout.fuel;
    if (!f) return;
    const r = f.rect;
    const vc = this.b.vc;
    const metal = this.b.metal;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const W = r.x1 - r.x0;
    const D = r.z1 - r.z0;
    // The bund: a low concrete wall round the tanks, which is what holds a leak.
    const bh = 1.4;
    vc.slab(r.x0, r.x1, ELEV, ELEV + 0.15, r.z0, r.z1, 0x9a9d98);
    plinth(vc, r.x0, r.x1, r.z0, r.z1);
    vc.slab(r.x0, r.x0 + 0.4, ELEV, ELEV + bh, r.z0, r.z1, 0xb4b6b0);
    vc.slab(r.x1 - 0.4, r.x1, ELEV, ELEV + bh, r.z0, r.z1, 0xb4b6b0);
    vc.slab(r.x0, r.x1, ELEV, ELEV + bh, r.z0, r.z0 + 0.4, 0xb4b6b0);
    vc.slab(r.x0, r.x1, ELEV, ELEV + bh, r.z1 - 0.4, r.z1, 0xb4b6b0);
    // Upright tanks, white with a red band and a domed lid.
    const n = f.tanks;
    const R = Math.min(f.r, W / (n * 2.3), D / 2.6);
    const H = f.H;
    for (let i = 0; i < n; i++) {
      const tx = r.x0 + (W / n) * (i + 0.5);
      const tz = cz + (i % 2 ? -1 : 1) * Math.min(D * 0.12, 3);
      vc.cyl(R, R, H, tx, ELEV, tz, 0xe6e8ea, 20);
      vc.cyl(R + 0.05, R + 0.05, H * 0.1, tx, ELEV + H * 0.72, tz, 0xc8322a, 20);
      const dome = new THREE.SphereGeometry(R, 16, 6, 0, Math.PI * 2, 0, Math.PI * 0.22);
      vc.add(dome, trs(tx, ELEV + H - R * Math.cos(Math.PI * 0.22), tz), 0xd8dbde);
      dome.dispose();
      // A ladder up the side.
      metal.box(0.5, H, 0.1, tx + R + 0.1, ELEV + H / 2, tz, 0x7d858d);
      // Pipe to the manifold.
      metal.tube(tx, ELEV + 0.6, tz, tx, ELEV + 0.6, r.z0 + 1.2, 0.18, 0x8d949c, 6);
    }
    metal.tube(r.x0 + 1, ELEV + 0.6, r.z0 + 1.2, r.x1 - 1, ELEV + 0.6, r.z0 + 1.2, 0.22, 0x8d949c, 6);
    // Pump house.
    vc.box(Math.min(6, W * 0.2), 3, 4, r.x1 - Math.min(6, W * 0.2) / 2 - 1, ELEV + 1.5, r.z0 + 3, 0xd6d0c2);
    addObstacleAt(cx, cz, W, D, ELEV, H + 1, 'You flew into the fuel farm');
  }

  /* ----------------------------------------------------------- car park -- */

  buildCarPark() {
    const c = this.layout.carPark;
    if (!c) return;
    const r = c.rect;
    const F = this.layout.frame;
    // Tarmac with the same world-metre asphalt as the taxiways.
    const g = new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0);
    g.rotateX(-Math.PI / 2);
    this.b.pave.add(g, trs((r.x0 + r.x1) / 2, ELEV + 0.05, (r.z0 + r.z1) / 2), 0xffffff);
    g.dispose();
    // Rows of bays, 2.5 m wide, 5 m deep, with a 6 m aisle between each pair.
    const paint = this.b.paint;
    const Y = ELEV + 0.075;
    const bays = [];
    const W = r.x1 - r.x0;
    const D = r.z1 - r.z0;
    const rowPitch = 16; // bay, aisle, bay
    const rows = Math.max(1, Math.floor((D - 2) / rowPitch));
    for (let row = 0; row < rows; row++) {
      const z0 = r.z0 + 1 + row * rowPitch;
      for (const [zb, face] of [[z0, 1], [z0 + 11, -1]]) {
        if (zb + 5 > r.z1) continue;
        const nb = Math.floor((W - 2) / 2.5);
        for (let i = 0; i <= nb; i++) {
          const x = r.x0 + 1 + i * 2.5;
          paint.flat(0.12, 5, x, Y, zb + 2.5, 0xf2f2f2);
          if (i < nb) bays.push({ x: x + 1.25, z: zb + 2.5, face });
        }
      }
    }
    // Cars in about two bays in three, the same ones every time.
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const colours = [0xd23c3c, 0x2f5f9e, 0xe9ecee, 0x22262b, 0x9aa1a8, 0x2f8f5b, 0xe9b925, 0x7d4a9e, 0xc0c4c8];
    const parked = bays.filter(() => rnd() < 0.68).slice(0, 120);
    if (parked.length) {
      const cars = instanced(carGeometry(), vcMaterial({ roughness: 0.35, metalness: 0.4 }), parked.length, { name: 'car-park' });
      const m = new THREE.Matrix4();
      const col = new THREE.Color();
      parked.forEach((p, i) => {
        trs(p.x, ELEV + 0.05, p.z, p.face > 0 ? 0 : Math.PI, 1, 1, 1, m);
        cars.setMatrixAt(i, m);
        cars.setColorAt(i, col.set(colours[Math.floor(rnd() * colours.length)]));
      });
      this.group.add(settle(cars));
    }
    // Lamp posts down the middle, and a pay kiosk at the entrance.
    const metal = this.b.metal;
    for (let x = r.x0 + 8; x < r.x1 - 4; x += 24) {
      metal.cyl(0.1, 0.14, 8, x, ELEV, (r.z0 + r.z1) / 2, 0x7d858d, 6);
      this.b.lamps.box(1.4, 0.25, 0.5, x, ELEV + 8, (r.z0 + r.z1) / 2, 0xfff6e0);
      this.glow(x, ELEV + 7.8, (r.z0 + r.z1) / 2, 0xffe2b0);
    }
    this.b.vc.box(3, 2.6, 2.4, r.x0 + 2.5, ELEV + 1.3, F.z(c.w0) - F.side * 1.5, 0xe9ecee);
  }

  /* --------------------------------------------------------- floodlights -- */

  /**
   * Apron floodlight masts: a tall tapered pole, a head frame of lamps aimed
   * down at the stands, and at night a pool of light on the concrete under
   * each — which is the thing that actually makes an apron look lit.
   */
  buildFloodlights() {
    const lay = this.layout;
    if (!lay.floods.length) return;
    const metal = this.b.metal;
    const lamps = this.b.lamps;
    const pools = new Batch();
    for (const f of lay.floods) {
      metal.cyl(0.25, 0.45, f.H, f.x, ELEV, f.z, 0x8d949c, 8);
      metal.box(4.2, 0.2, 0.3, f.x, ELEV + f.H, f.z, 0x5c6168);
      metal.box(0.3, 1.8, 0.3, f.x, ELEV + f.H - 0.8, f.z, 0x5c6168);
      for (let i = -1; i <= 1; i++) {
        lamps.box(1.1, 0.8, 0.5, f.x + i * 1.35, ELEV + f.H + 0.55, f.z, 0xfff6e0);
        this.glow(f.x + i * 1.35, ELEV + f.H + 0.55, f.z, 0xfff0d0);
      }
      // The pool is laid toward the stands (the runway side of the mast).
      const toward = -lay.side;
      const rr = f.H * 1.9;
      const disc = new THREE.CircleGeometry(rr, 24);
      disc.rotateX(-Math.PI / 2);
      pools.add(disc, trs(f.x, ELEV + 0.09, f.z + toward * rr * 0.55), 0xffffff);
      disc.dispose();
      /*
       * Solid from 4.5 m up. The road router (roads.js) blocks a 90 m cell
       * for anything standing on the ground within 65 m of it, and ignores
       * boxes that start more than 4 m up; a pole registered from the
       * ground would have closed off the cells round the apron that the road
       * to "The Airfield" ends in. An aeroplane flying into one still hits it.
       */
      addObstacleAt(f.x, f.z, 1.2, 1.2, ELEV + 4.5, f.H - 3.5, 'You flew into a floodlight mast');
    }
    const c = canvas(128, 128);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,236,196,0.55)');
    g.addColorStop(0.55, 'rgba(255,230,180,0.22)');
    g.addColorStop(1, 'rgba(255,230,180,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const mat = new THREE.MeshBasicMaterial({
      map: canvasTexture(c),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    layer(mat, 'decal');
    this.pools = pools.mesh(mat, { cast: false, receive: false, name: 'flood-pools' });
    if (this.pools) {
      // The disc's own UVs, not colours: drop the colour attribute.
      this.pools.geometry.deleteAttribute('color');
      this.pools.visible = false;
      this.group.add(this.pools);
    }
  }

  /* -------------------------------------------------------------- signs -- */

  buildSigns() {
    const lay = this.layout;
    const plates = this.plates || [];
    const all = lay.signs.concat(plates);
    if (!all.length) return;
    const { tex, cells } = signAtlas(all);
    const faces = new Batch();
    const vc = this.b.vc;
    const cellUV = (g, c) => {
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) ? c.u1 : c.u0, uv.getY(k) ? c.v1 : c.v0);
    };
    all.forEach((s, i) => {
      if (!cells[i]) return;
      if (s.kind === 'plate') {
        const g = new THREE.PlaneGeometry(s.w, s.h);
        cellUV(g, cells[i]);
        // A plane looks down +Z; this turns it to look toward s.facingDeg.
        faces.add(g, trs(s.x, s.y, s.z, yawOf(s.facingDeg) + Math.PI), 0xffffff);
        g.dispose();
        return;
      }
      const w = s.small ? 2.2 : 3.2;
      const h = s.small ? 0.6 : 0.9;
      const y = ELEV + (s.small ? 0.8 : 1.1);
      const yaw = yawOf(s.facingDeg); // the reader's heading
      // The frame: a black box on two legs.
      vc.box(w + 0.2, h + 0.2, 0.3, s.x, y, s.z, 0x15171a, yaw);
      for (const e of [-0.35, 0.35]) {
        const lx = s.x + Math.cos(yaw) * e * w;
        const lz = s.z - Math.sin(yaw) * e * w;
        vc.box(0.12, y - ELEV - h / 2, 0.12, lx, ELEV + (y - ELEV - h / 2) / 2, lz, 0x5c6168);
      }
      // Two faces, so it reads from both directions the same way round.
      const c = cells[i];
      for (const back of [0, 1]) {
        const g = new THREE.PlaneGeometry(w, h);
        cellUV(g, c);
        // A plane faces +Z, and turning it by `yaw` points it back down the
        // reader's heading — at the reader. The second face looks the other way.
        const ry = yaw + (back ? Math.PI : 0);
        const off = back ? -0.16 : 0.16;
        faces.add(g, trs(s.x + Math.sin(yaw) * off, y, s.z + Math.cos(yaw) * off, ry), 0xffffff);
        g.dispose();
      }
    });
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0, roughness: 0.6 });
    const m = faces.mesh(mat, { cast: false, name: 'sign-faces' });
    if (m) {
      m.geometry.deleteAttribute('color');
      this.group.add(m);
      this.signMat = mat;
    }
  }

  /* ----------------------------------------------------------- windsock -- */

  buildWindsock() {
    // Kestrel's has always stood at (-500, -60); the layout keeps it there
    // and finds the equivalent spot on every other map.
    const at = this.layout.windsock || { x: RUNWAY.cx - RUNWAY.length / 2 + 50, z: RUNWAY.cz - RUNWAY.halfWidth - 40 };
    const gy = heightAt(at.x, at.z);
    const g = new THREE.Group();
    g.position.set(at.x, gy, at.z);
    // The pole is part of the field's steelwork.
    this.b.metal.cyl(0.22, 0.28, 9, at.x, gy, at.z, 0xbfc4c9, 10);

    // Striped sock: five cone frustums, one mesh (it was five, and five
    // materials, for one windsock).
    this.sockPivot = new THREE.Group();
    this.sockPivot.position.y = 9;
    g.add(this.sockPivot);
    const colors = [0xf05a28, 0xf2f2f2, 0xf05a28, 0xf2f2f2, 0xf05a28];
    const sock = new Batch();
    let z = 0;
    for (let i = 0; i < colors.length; i++) {
      const r0 = 1.05 - i * 0.13;
      const r1 = 1.05 - (i + 1) * 0.13;
      const seg = new THREE.CylinderGeometry(r1, r0, 1.3, 12, 1, true);
      sock.add(seg, trse(0, 0, z + 0.65, Math.PI / 2, 0, 0), colors[i]);
      seg.dispose();
      z += 1.3;
    }
    this.sockPivot.add(sock.mesh(vcMaterial({ roughness: 0.75, side: THREE.DoubleSide }), { name: 'windsock' }));
    this.group.add(g);
    this.windsock = g;
  }

  /* ----------------------------------------------------------- lighting -- */

  /**
   * One halo on the field. Big ones (the runway, the floodlights) read from
   * the approach; small ones (the taxiway's blue, the stop bars) are for
   * someone taxiing past them, where a 7 m halo round every blue light would
   * be a blue fog.
   */
  glow(x, y, z, hex, small = false) {
    const c = new THREE.Color(hex);
    const pos = small ? this.glowPosS : this.glowPos;
    const col = small ? this.glowColS : this.glowCol;
    pos.push(x, y, z);
    col.push(c.r, c.g, c.b);
  }

  /** One light: a bright dot at night, and its halo. */
  light(x, y, z, hex, r = 0.42) {
    this.fixtures.push({ x, y, z, hex, r });
    this.glow(x, y, z, hex, r < 0.4);
  }

  buildLighting() {
    /*
     * Runway edge lights, thresholds and the approach lead-in.
     *
     * These were laid relative to (0, 0) whatever the map, so on the five maps
     * whose runway is somewhere else they stood in a field kilometres away and
     * the runway itself was dark. Same pattern, measured from the runway.
     */
    const cx = RUNWAY.cx;
    const cz = RUNWAY.cz;
    const step = 60;
    for (let x = -RUNWAY.length / 2; x <= RUNWAY.length / 2 + 1; x += step) {
      for (const z of [-RUNWAY.halfWidth - 1.5, RUNWAY.halfWidth + 1.5]) {
        // Last 600 m of runway 09 shows amber, like the real thing.
        const amber = x > RUNWAY.length / 2 - 300;
        this.light(cx + x, ELEV + 0.45, cz + z, amber ? 0xffb347 : 0xfff4de);
      }
    }
    // Thresholds: green on the approach end, red on the far end.
    for (let i = -2; i <= 2; i++) {
      this.light(cx - RUNWAY.length / 2 - 2, ELEV + 0.45, cz + i * 7, 0x2bff6a);
      this.light(cx + RUNWAY.length / 2 + 2, ELEV + 0.45, cz + i * 7, 0xff3b30);
    }
    // Approach lead-in lights out over the water for runway 09.
    for (let i = 1; i <= 8; i++) {
      this.light(cx - RUNWAY.length / 2 - i * 60, ELEV + 0.6, cz, 0xffffff);
    }
    // The crosswind runway had no lights at all, so at night it was not there.
    if (AIRPORT.runway2) {
      const r2 = RUNWAY2;
      const alongX = Math.abs((((r2.headingDeg ?? 180) % 180) - 90)) < 45;
      for (let d = -r2.length / 2; d <= r2.length / 2 + 1; d += step) {
        for (const e of [-r2.halfWidth - 1.5, r2.halfWidth + 1.5]) {
          const x = alongX ? r2.cx + d : r2.cx + e;
          const z = alongX ? r2.cz + e : r2.cz + d;
          if (Terrain.isOnRunway(x, z, 0.5)) continue;
          this.light(x, ELEV + 0.45, z, 0xfff4de);
        }
      }
    }

    /* ---- taxiway edges: blue, every `edgeStep` metres ---- */
    const lay = this.layout;
    const blue = 0x3f7bff;
    const edge = (x0, z0, x1, z1, nx, nz) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.round(len / lay.edgeStep));
      for (let i = 0; i <= n; i++) {
        const x = x0 + ((x1 - x0) * i) / n;
        const z = z0 + ((z1 - z0) * i) / n;
        // Not where this edge opens onto other made ground or a runway.
        const ox = x + nx * 3;
        const oz = z + nz * 3;
        if (onAirportPavement(ox, oz) || Terrain.isOnAnyRunway(ox, oz, 1)) continue;
        if (Terrain.isOnAnyRunway(x, z, 3)) continue;
        this.light(x, ELEV + 0.3, z, blue, 0.26);
      }
    };
    for (const p of lay.pavement) {
      if (p.kind === 'drive') continue;
      const m = 0.8; // just outside the edge
      edge(p.x0 - m, p.z0 - m, p.x1 + m, p.z0 - m, 0, -1);
      edge(p.x0 - m, p.z1 + m, p.x1 + m, p.z1 + m, 0, 1);
      edge(p.x0 - m, p.z0 - m, p.x0 - m, p.z1 + m, -1, 0);
      edge(p.x1 + m, p.z0 - m, p.x1 + m, p.z1 + m, 1, 0);
    }
    // Stop bars: a row of red across every connector at its holding point.
    const F = lay.frame;
    for (const c of lay.connectors) {
      const hw = lay.taxiway.width / 2 - 1;
      for (let d = -hw; d <= hw + 0.01; d += 3) this.light(F.x(c.u + d), ELEV + 0.3, F.z(c.hold.w + 2.2), 0xff2a1a, 0.22);
    }

    const pos = this.fixtures;
    const geo = new THREE.SphereGeometry(1, 6, 5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const inst = new THREE.InstancedMesh(geo, mat, pos.length);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    pos.forEach((p, i) => {
      trs(p.x, p.y, p.z, 0, p.r, p.r, p.r, m);
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, col.set(p.hex));
    });
    settle(inst);
    inst.visible = false;
    this.group.add(inst);
    this.runwayLights = inst;

    // Every halo on the field — runway, taxiway, stop bars, floodlights and
    // the car park — as one Points. It was 56 separate sprites for the
    // runway alone.
    this.glowGroup = new THREE.Group();
    this.glowGroup.name = 'airfield-glow';
    // Static, so bounded by their own points and culled like anything else.
    const big = glowPoints(this.glowPos, this.glowCol, 7, { opacity: 0.85, name: 'glow-big' });
    big.frustumCulled = true;
    this.glowGroup.add(big);
    if (this.glowPosS.length) {
      const small = glowPoints(this.glowPosS, this.glowColS, 2.6, { opacity: 0.9, name: 'glow-small' });
      small.frustumCulled = true;
      this.glowGroup.add(small);
    }
    this.glowGroup.visible = false;
    this.group.add(this.glowGroup);

    /*
     * PAPI: four lights abreast the aiming point, out on the grass to the left
     * of runway 09.
     *
     * Both coordinates used to be written out as numbers — x -350 and z -32 —
     * and both of those are Kestrel's: its touchdown point 200 m in from the
     * threshold, and its 17 m half-width plus 15 m of grass. Ironhead's runway
     * is 3,200 m long and 68 m wide, so on that map -350 is more than a
     * kilometre past the threshold and -32 is still inside the edge: four
     * light boxes standing in the middle of the landing surface, well down the
     * roll-out from where its real aiming point is. updatePapi() measures the
     * glide angle to RUNWAY.touchdown, so the lights have to be measured off
     * the same runway rather than off Kestrel's.
     */
    /*
     * Four boxes, four lenses and four halos were twelve meshes and eight
     * materials. The boxes are in the field's merged structures now; the
     * lenses are one InstancedMesh and the halos one Points, each coloured
     * per light, so updatePapi() writes four colours instead of eight.
     */
    const papiX = RUNWAY.touchdown.x;
    const papiZ = RUNWAY.cz - RUNWAY.halfWidth - 15;
    const lensGeo = new THREE.CircleGeometry(0.62, 12);
    const lenses = new THREE.InstancedMesh(lensGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), 4);
    lenses.frustumCulled = false;
    const papiPos = [];
    const m4 = new THREE.Matrix4();
    const white = new THREE.Color(0xffffff);
    for (let i = 0; i < 4; i++) {
      this.b.vc.box(2.4, 1.5, 1.6, papiX, ELEV + 0.75, papiZ - i * 6, 0x2a2d33);
      trs(papiX - 1.3, ELEV + 0.85, papiZ - i * 6, -Math.PI / 2, 1, 1, 1, m4);
      lenses.setMatrixAt(i, m4);
      lenses.setColorAt(i, white);
      papiPos.push(papiX - 1.3, ELEV + 0.85, papiZ - i * 6);
    }
    this.group.add(settle(lenses));
    const glows = glowPoints(papiPos, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 6, { opacity: 0.85, name: 'papi-glow' });
    glows.frustumCulled = true;
    this.group.add(glows);
    this.papiLenses = lenses;
    this.papiGlows = glows;
    this.papiCol = new THREE.Color();
    // The shape updatePapi() and anything reading `papi` expect: one entry per light.
    this.papi = [0, 1, 2, 3].map((i) => ({ index: i }));
  }

  /** Turn the batches into meshes. One draw call each. */
  flushBatches() {
    const add = (b, mat, opts) => {
      const m = b.mesh(mat, opts);
      if (m) this.group.add(m);
      return m;
    };
    const M = this.mats;
    const pave = add(this.b.pave, pavementMaterial(), { cast: false, name: 'pavement' });
    if (pave) {
      const uv = pave.geometry.attributes.uv;
      const p = pave.geometry.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / PAVE_TILE, p.getZ(i) / PAVE_TILE);
      pave.geometry.deleteAttribute('color');
    }
    add(this.b.paint, M.paint, { cast: false, name: 'paint' });
    add(this.b.vc, M.vc, { name: 'airfield-structures' });
    add(this.b.metal, M.metal, { name: 'airfield-steel' });
    this.lampMesh = add(this.b.lamps, M.lamps, { cast: false, name: 'lamps' });
    for (const [k, mat] of [['wall', M.wall], ['wallWarm', M.wallWarm], ['clad', M.clad], ['roof', M.roof]]) {
      const m = add(this.b[k], mat, { name: k });
      if (m) m.geometry.deleteAttribute('color');
    }
    this.b = null;
  }

  /** Toggle the airfield lighting (night / low visibility). */
  setLightsOn(on) {
    if (this.lightsOn === on) return;
    this.lightsOn = on;
    this.runwayLights.visible = on;
    this.glowGroup.visible = on;
    if (this.pools) this.pools.visible = on;
    this.mats.lamps.emissiveIntensity = on ? 1.4 : 0;
    if (this.signMat) this.signMat.emissiveIntensity = on ? 0.9 : 0;
    // Somebody is on duty up there whatever the hour, and at night you can
    // see them.
    if (this.towerRoom) this.towerRoom.opacity = on ? 0.4 : 0.12;
  }

  /**
   * Update the PAPI from the aircraft position: it compares the actual glide
   * angle to the ideal 3° and lights red/white accordingly.
   * Returns a short human hint for the HUD.
   */
  updatePapi(aircraftPos) {
    const td = RUNWAY.touchdown;
    const dx = td.x - aircraftPos.x;
    const dz = td.z - aircraftPos.z;
    const dist = Math.hypot(dx, dz);
    const alt = aircraftPos.y - ELEV;
    // Only meaningful on a westerly approach within ~12 km.
    const approaching = aircraftPos.x < td.x && dist < 12000 && dist > 120 && alt > 3;
    let whites = 0;
    if (approaching) {
      const angle = (Math.atan2(alt, dist) * 180) / Math.PI;
      // 4 bars: each covers ~0.33° around the 3° path.
      const thresholds = [2.5, 2.83, 3.17, 3.5];
      whites = thresholds.filter((t) => angle > t).length;
    }
    const c = this.papiCol;
    const glowCol = this.papiGlows.geometry.attributes.color;
    for (let i = 0; i < 4; i++) {
      c.setHex(i < whites ? 0xffffff : 0xff2d20);
      this.papiLenses.setColorAt(i, c);
      glowCol.setXYZ(i, c.r, c.g, c.b);
    }
    this.papiLenses.instanceColor.needsUpdate = true;
    glowCol.needsUpdate = true;
    this.papiGlows.material.opacity = this.lightsOn ? 0.9 : 0.5;
    if (!approaching) return null;
    if (whites === 4) return { state: 'high', text: 'Too high — ease off and descend' };
    if (whites === 0) return { state: 'low', text: 'Too low — add power!' };
    if (whites === 2) return { state: 'good', text: 'On the perfect glide path' };
    return { state: whites > 2 ? 'slightlyHigh' : 'slightlyLow', text: whites > 2 ? 'A little high' : 'A little low' };
  }

  update(dt, weather) {
    if (this.towerDish) this.towerDish.rotation.z += dt * 0.9;

    this.t += dt;
    // Windsock points downwind and lifts as the wind increases.
    const fromRad = THREE.MathUtils.degToRad(weather.windDirDeg);
    // Sock tail points the way the wind is going.
    this.sockPivot.rotation.y = -fromRad + Math.PI;
    const lift = Math.min(1, weather.windSpeedKts / 15);
    this.sockPivot.rotation.x = (1 - lift) * 1.15 + Math.sin(this.t * 3.2) * 0.05 * lift;
    // Rotating green beacon.
    if (this.beacon) this.beacon.visible = this.lightsOn && Math.sin(this.t * 3) > 0;
    this.setLightsOn(weather.isNight || weather.cond.cloud > 0.8);

    // Hangar doors: ease toward where they are wanted; close when unwatched.
    for (const hs of this.doorState) {
      if (hs.hold > 0) hs.hold -= dt;
      else hs.target = 0;
      if (hs.open !== hs.target) {
        // A quarter of the opening a second is how fast a real one moves.
        const rate = 0.12 * dt;
        hs.open = hs.open < hs.target ? Math.min(hs.target, hs.open + rate) : Math.max(hs.target, hs.open - rate);
        this.poseDoors(hs);
      }
    }
  }
}
