/**
 * Helipads.
 *
 * There was exactly one pad in the whole world — DELIVERY_PAD — and it was
 * drawn by a bespoke function that also planted a village round it, so a
 * second pad meant a second village. A pad is a place to land, not a
 * settlement. This file is that function with the village taken out and the
 * position taken from map data instead of a constant.
 *
 * Why it matters more than any single new map: a helicopter goes where a
 * runway cannot, and every one of the nine existing maps is built around a
 * runway. Give each of them four pads and all nine become rescue maps for
 * about six lines of data each. That is the cheapest large thing in this
 * whole proposal.
 *
 * A pad entry in `map.scenery.pads` is:
 *
 *   { id, name, x, z, kind, r, elev?, above?, role? }
 *
 * `kind` decides what is drawn under the H and nothing else:
 *   ground   a circle of concrete sitting on the terrain. No platform is
 *            registered — the ground is already the landing surface — unless
 *            the ground turns out to be dead level, in which case one is,
 *            so the deck reads as paved and the touchdown is exactly flat.
 *   roof     a raised deck on four legs over a building block. Legs are cut
 *            individually to the ground under each one, so a roof pad stands
 *            up straight on any slope at all. That is not a detail: on most
 *            of these maps there IS no flat ground (see the note below).
 *   deck     a rig or ship deck out in open water, on four long legs.
 *   stack    a small pad on top of a sea stack.
 *
 * Heights are worked out rather than typed in wherever that is possible:
 *   ground   heightAt
 *   roof     `above` metres over the local ground (`elev` overrides)
 *   stack    the HIGHEST ground inside the pad footprint, so the pad always
 *            sits on the rock and never half inside it
 *   deck     `elev` above sea level, which is the one case where an absolute
 *            number is the honest one
 *
 * Typing absolute elevations for the other three would be guessing, and the
 * guess would be wrong: the terrain is noise, the summit of a 300 m sea stack
 * lands wherever the noise puts it, and a pad floating four metres over a
 * rock — or buried in it — is the sort of thing nobody notices until a child
 * lands on thin air.
 *
 * WHAT THIS COSTS TO DRAW: a fixed handful of draw calls, whatever the pad
 * count — the discs (one per marking), the legs, the rigs' plant modules,
 * the lights, and for roof pads the buildings (walls + roofs, per facade)
 * and the hospital signs. Eight rigs on Ironhead Deep cost the same number
 * of draw calls as one. Measured by building them in node, 2026-09-26:
 * Kestrel 7 draws / 734 triangles, Meridian 9 / 1,726 (a hospital and two
 * office roofs), Ironhead Deep 8 / 2,358.
 */

import * as THREE from '../vendor/three.module.js';
import { heightAt, MAP, addPlatform, addObstacleAt } from './terrain.js';

/**
 * The pads on the map that is loaded, in world space, with their heights
 * resolved. Missions, the free-flight start screen and the minimap all read
 * this; nothing else needs to know how a pad is built.
 */
export const PADS = [];

export function clearPads() {
  PADS.length = 0;
}

/** The pad list a map defines, without building anything. For the menus. */
export function padsOf(mapDef) {
  if (!mapDef) return [];
  return mapDef.pads || (mapDef.scenery && mapDef.scenery.pads) || [];
}

/** How many places a helicopter can put down on this map. For the map cards. */
export function padCount(mapDef) {
  return padsOf(mapDef).length;
}

export function padById(id) {
  return PADS.find((p) => p.id === id) || null;
}

/** The nearest pad to a point, which is what "take them to hospital" means. */
export function nearestPad(x, z, role = null) {
  let best = null;
  let bestD = Infinity;
  for (const p of PADS) {
    if (role && p.role !== role) continue;
    const d = (p.pos.x - x) ** 2 + (p.pos.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Markings                                                            */
/* ------------------------------------------------------------------ */

/**
 * The painted top of a pad, drawn once per world build.
 *
 * Deliberately NOT cached in a module-level variable, which is the obvious
 * thing to do and is wrong here: `disposeWorld()` in main.js walks every
 * material in the world and disposes the textures hanging off it, so a
 * module-scope texture is destroyed the first time you switch map and every
 * pad after that is drawn with a dead one. Two hundred microseconds of canvas
 * per world build is the correct price for not having that bug.
 */
function padTexture(role) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const mid = S / 2;

  // The deck itself: concrete, with a darker rim so the edge reads from above.
  g.clearRect(0, 0, S, S);
  g.fillStyle = role === 'hospital' ? '#8e9296' : '#6f7468';
  g.beginPath();
  g.arc(mid, mid, mid - 2, 0, Math.PI * 2);
  g.fill();

  // Grime, so it is a used pad rather than a clean disc of grey.
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * (mid - 4);
    g.fillStyle = `rgba(20, 24, 22, ${0.02 + Math.random() * 0.05})`;
    g.fillRect(mid + Math.cos(a) * r, mid + Math.sin(a) * r, 3, 3);
  }

  // The painted circle. A real helipad's ring is the touchdown limit, and it
  // is the thing a pilot actually aims the aircraft inside.
  g.strokeStyle = role === 'hospital' ? '#f4f7f9' : '#ffd23f';
  g.lineWidth = 9;
  g.beginPath();
  g.arc(mid, mid, mid * 0.72, 0, Math.PI * 2);
  g.stroke();

  // And the H. A hospital pad gets the H inside a cross, which is the one
  // marking a ten-year-old can pick out of a town from half a mile up.
  if (role === 'hospital') {
    g.fillStyle = '#c8241c';
    const arm = mid * 0.52;
    const th = mid * 0.20;
    g.fillRect(mid - arm, mid - th, arm * 2, th * 2);
    g.fillRect(mid - th, mid - arm, th * 2, arm * 2);
    g.fillStyle = '#f4f7f9';
  } else {
    g.fillStyle = '#f4f7f9';
  }
  const hw = mid * 0.30; // half the H's width
  const hh = mid * 0.34; // half its height
  const bar = mid * 0.095;
  g.fillRect(mid - hw, mid - hh, bar * 2, hh * 2);
  g.fillRect(mid + hw - bar * 2, mid - hh, bar * 2, hh * 2);
  g.fillRect(mid - hw, mid - bar, hw * 2, bar * 2);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/* ------------------------------------------------------------------ */
/* The building under a roof pad                                       */
/* ------------------------------------------------------------------ */

/*
 * A roof pad stood on a blank grey box: no windows, no door, no sign. On
 * every map the hospital is the tallest thing in the village and the place
 * the rescue missions send you, and from the circuit it was the one
 * building that did not look like a building — a concrete plinth with a
 * helipad on it. Now it has floors of windows, a teal band on each floor, a
 * glazed ground floor, a red cross on every face that stays bright after
 * dark, and its windows lit at night. Non-hospital roofs (a city spire, a
 * midrise, a row of shops) get an office front instead.
 *
 * One tile of the facade is FACADE_W x FACADE_H metres of wall — four bays,
 * two floors — and the walls are UV'd in metres, so a 22 m cottage
 * hospital and Meridian's 150 m spire both come out with 3.5 m floors
 * rather than one texture stretched over whatever height the block is.
 */
const FACADE_W = 14;
const FACADE_H = 7;

function facadeTexture(kind, night = false) {
  const W = 128;
  const H = 64;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  // Fixed pattern, so the lit panes at night are panes by day.
  let s = kind === 'hospital' ? 11 : 23;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const hospital = kind === 'hospital';
  g.fillStyle = night ? '#000000' : hospital ? '#eef0ea' : '#cdc6b6';
  g.fillRect(0, 0, W, H);
  const bays = 4;
  const floors = 2;
  const bw = W / bays;
  const fh = H / floors;
  for (let f = 0; f < floors; f++) {
    const y0 = f * fh;
    if (!night && hospital) {
      // The teal band under each row of windows.
      g.fillStyle = '#6fb3a6';
      g.fillRect(0, y0 + fh - 5, W, 3);
    }
    for (let b = 0; b < bays; b++) {
      const x0 = b * bw;
      const q = rnd();
      const wx = x0 + (hospital ? 3 : 7);
      const ww = bw - (hospital ? 6 : 14);
      const wy = y0 + 5;
      const wh = fh - (hospital ? 13 : 12);
      if (night) {
        // Half the wards lit, a third of the offices: all of them lit read
        // as a white box in the dark, measured off a night screenshot.
        if (q < (hospital ? 0.5 : 0.34)) {
          g.fillStyle = q < 0.2 ? '#f6e6c0' : q < 0.36 ? '#d8e4f2' : '#f0cc90';
          g.fillRect(wx, wy, ww, wh);
        }
        continue;
      }
      const shade = 60 + q * 36;
      g.fillStyle = `rgb(${(shade * 0.8) | 0},${(shade * 0.98) | 0},${(shade * 1.14) | 0})`;
      g.fillRect(wx, wy, ww, wh);
      // A mullion down the middle, and a sill.
      g.fillStyle = hospital ? '#dfe4e0' : '#9a9486';
      g.fillRect(wx + ww / 2 - 1, wy, 2, wh);
      g.fillRect(wx - 1, wy + wh, ww + 2, 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/**
 * Every roof-pad building on the map as ONE geometry: walls in group 0
 * (UV'd in facade tiles), roofs in group 1. Two draw calls for all of
 * them, whatever the count. No undersides: the ground is under them.
 */
function blockGeometry(list) {
  const pos = [];
  const nrm = [];
  const uv = [];
  const wallIdx = [];
  const roofIdx = [];
  let n = 0;
  const quad = (a, b, c2, d, nx, ny, nz, uvs, into) => {
    for (const p of [a, b, c2, d]) pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) nrm.push(nx, ny, nz);
    uv.push(...uvs);
    into.push(n, n + 1, n + 2, n, n + 2, n + 3);
    n += 4;
  };
  for (const b of list) {
    const h = Math.max(2, b.y1 - b.y0);
    const x0 = b.x - b.w;
    const x1 = b.x + b.w;
    const z0 = b.z - b.w;
    const z1 = b.z + b.w;
    const y0 = b.y0;
    const y1 = b.y0 + h;
    const u = (2 * b.w) / FACADE_W;
    // Floors counted from the building's own ground floor: the highest
    // ground along its walls (a rig module has none, and starts at its foot).
    // Below that, down the slope, a plinth of plain wall (the strip under
    // the texture's lower row of windows), so no window meets the ground.
    const vb = Math.min(y1 - 3.5, b.floor ?? b.y0);
    const v1 = (y1 - vb) / FACADE_H;
    const bands = vb > y0 + 0.05 ? [[y0, vb, [0, 0.005, u, 0.005, u, 0.03, 0, 0.03]], [vb, y1, [0, 0, u, 0, u, v1, 0, v1]]] : [[y0, y1, [0, (y0 - vb) / FACADE_H, u, (y0 - vb) / FACADE_H, u, v1, 0, v1]]];
    // Four walls, each wound counter-clockwise seen from outside.
    for (const [ya, yb, wall] of bands) {
      quad([x0, ya, z1], [x1, ya, z1], [x1, yb, z1], [x0, yb, z1], 0, 0, 1, wall, wallIdx);
      quad([x1, ya, z0], [x0, ya, z0], [x0, yb, z0], [x1, yb, z0], 0, 0, -1, wall, wallIdx);
      quad([x1, ya, z1], [x1, ya, z0], [x1, yb, z0], [x1, yb, z1], 1, 0, 0, wall, wallIdx);
      quad([x0, ya, z0], [x0, ya, z1], [x0, yb, z1], [x0, yb, z0], -1, 0, 0, wall, wallIdx);
    }
    const flat = [0, 0, 1, 0, 1, 1, 0, 1];
    quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 0, 1, 0, flat, roofIdx);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(wallIdx.concat(roofIdx));
  g.addGroup(0, wallIdx.length, 0);
  g.addGroup(wallIdx.length, roofIdx.length, 1);
  g.computeBoundingSphere();
  return g;
}

/**
 * The red cross on a white board, one per wall of every hospital, as one
 * instanced mesh. Unlit (MeshBasicMaterial), so it reads the same at noon
 * and at midnight — which is what a lit hospital sign is for. Colours are
 * written linear, the way the renderer reads vertex colours.
 */
function crossSignGeometry() {
  const pos = [];
  const col = [];
  const white = new THREE.Color(0xf6f7f4);
  const red = new THREE.Color(0xd0231c);
  const rect = (x0, y0, x1, y1, z, c) => {
    const v = [[x0, y0], [x1, y0], [x1, y1], [x0, y0], [x1, y1], [x0, y1]];
    for (const [x, y] of v) {
      pos.push(x, y, z);
      col.push(c.r, c.g, c.b);
    }
  };
  // A 5 m board, the cross three-fifths of it, standing 0.12 m proud.
  rect(-2.5, -2.5, 2.5, 2.5, 0, white);
  rect(-1.6, -0.5, 1.6, 0.5, 0.15, red);
  rect(-0.5, -1.6, 0.5, 1.6, 0.15, red);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/* ------------------------------------------------------------------ */
/* Building                                                            */
/* ------------------------------------------------------------------ */

/** The highest ground inside a footprint — nine samples, which is plenty. */
function groundMax(x, z, r) {
  let hi = -Infinity;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const h = heightAt(x + i * r * 0.8, z + j * r * 0.8);
      if (h > hi) hi = h;
    }
  }
  return hi;
}

/** The lowest and highest ground along the four walls of a square 2 half wide. */
function wallGround(x, z, half) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k <= 8; k++) {
    const t = -half + (2 * half * k) / 8;
    for (const [px, pz] of [[x + t, z - half], [x + t, z + half], [x - half, z + t], [x + half, z + t]]) {
      const h = heightAt(px, pz);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }
  return [lo, hi];
}

/** …and the lowest, which is what tells you whether a spot is really level. */
function groundMin(x, z, r) {
  let lo = Infinity;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const h = heightAt(x + i * r * 0.8, z + j * r * 0.8);
      if (h < lo) lo = h;
    }
  }
  return lo;
}

const _m = new THREE.Object3D();

/**
 * Build every pad this map defines and register the raised ones as landing
 * platforms.
 *
 * MUST be called during the scenery phase, never before `createTerrain`.
 * `heightAt` returns platform height over a registered platform, so a pad
 * registered before the terrain mesh is generated would pull the ground mesh
 * itself up to deck height and leave a concrete table in the hillside. The
 * carrier has always been built after the terrain for exactly this reason;
 * nobody wrote it down, so it is written down here.
 */
/**
 * How far above the pad's own height its painted disc is drawn.
 *
 * A pad on the ground lies over terrain the mesh draws a little off
 * heightAt, so its disc is lifted clear of it. A deck — roof, rig, sea stack
 * — has nothing under it but its platform, which is exactly where the
 * helicopter's skids rest; lifted 14 cm there too, the disc swallowed the
 * skids whole on every roof pad (the Skyhook's first pad at Kestrel is one),
 * and the walker's shoes with them. There it is the deck itself: nothing else
 * is drawn at that height for it to fight with.
 */
export function padDiscLift(p) {
  return p && p.kind && p.kind !== 'ground' ? 0 : 0.14;
}

export function buildPads(parent) {
  clearPads();
  const defs = padsOf(MAP);
  if (!defs.length) return null;

  /* -------- pass one: work out where every deck actually sits -------- */
  const legs = []; // {x, z, y0, y1, r}
  const blocks = []; // {x, z, y0, y1, w}
  for (const def of defs) {
    const r = def.r || 11;
    const kind = def.kind || 'ground';
    const ground = heightAt(def.x, def.z);
    let y;
    let platform = true;

    if (kind === 'roof') {
      y = def.elev != null ? def.elev : ground + (def.above != null ? def.above : 30);
      // One leg per corner, each cut to the ground under it. A roof pad on a
      // 30-degree hillside is then still a level deck, which is the whole
      // reason a hospital in a place like this has one.
      const d = r * 0.72;
      for (const [ox, oz] of [[-d, -d], [d, -d], [-d, d], [d, d]]) {
        legs.push({ x: def.x + ox, z: def.z + oz, y0: heightAt(def.x + ox, def.z + oz) - 1, y1: y, r: 0.9 });
      }
      /*
       * Down to the lowest ground along its walls, which stand 1.25 r out:
       * measured inside 0.8 r, the corners of a hospital on a hillside hung
       * up to 5 m in the air. And its floors counted from the HIGHEST ground
       * along them, so the ground-floor windows are above the ground on
       * every side; from 1 m under the lowest, they were 0.45 m into it on
       * level ground and deeper up the slope.
       */
      const [gLo, gHi] = wallGround(def.x, def.z, r * 1.25);
      blocks.push({
        x: def.x, z: def.z, y0: gLo - 1, y1: y - 1.4, w: r * 1.25, floor: gHi + 0.1,
        roof: true, hospital: (def.role || (def.id === 'hospital' ? 'hospital' : 'pad')) === 'hospital',
      });
      // Solid across the whole of what is drawn. addObstacleAt takes the FULL
      // width, and this passed the half-width drawn below (w = 1.25 r, drawn
      // 2w across), so the outer 6.9 m of every hospital was air.
      addObstacleAt(def.x, def.z, r * 2.5, r * 2.5, ground - 1, Math.max(2, y - 1.6 - ground), `You flew into ${def.name}`);
    } else if (kind === 'deck') {
      y = def.elev != null ? def.elev : 24;
      const d = r * 0.78;
      for (const [ox, oz] of [[-d, -d], [d, -d], [-d, d], [d, d]]) {
        // Legs run down past the waterline. Stopping them at y=0 leaves a rig
        // that appears to be balanced on the surface of the sea.
        legs.push({ x: def.x + ox, z: def.z + oz, y0: -8, y1: y, r: 1.5 });
      }
      // The plant: the module block a helideck is always cantilevered off.
      blocks.push({ x: def.x, z: def.z + r * 1.1, y0: y - 11, y1: y - 1.4, w: r * 1.1 });
      // Full width again (the module is drawn 2.2 r across; this was 1.1 r).
      addObstacleAt(def.x, def.z + r * 1.1, r * 2.2, r * 2.2, y - 11, 9.4, `You flew into ${def.name}`);
    } else if (kind === 'stack') {
      // The pad goes on the highest rock inside its own footprint. Anything
      // else and half the deck is inside the hill.
      y = Math.max(groundMax(def.x, def.z, r), def.elev != null ? def.elev : -Infinity) + 0.9;
      const d = r * 0.7;
      for (const [ox, oz] of [[-d, -d], [d, -d], [0, d]]) {
        legs.push({ x: def.x + ox, z: def.z + oz, y0: heightAt(def.x + ox, def.z + oz) - 1.5, y1: y, r: 0.7 });
      }
    } else {
      // Ground. The terrain is the landing surface, so no platform — UNLESS
      // the ground is genuinely level, in which case registering one costs
      // nothing and buys a dead-flat touchdown that counts as paved.
      y = ground;
      platform = groundMax(def.x, def.z, r) - groundMin(def.x, def.z, r) < 0.6;
    }

    if (platform) addPlatform(def.x, def.z, r * 2, r * 2, y, def.name);

    PADS.push({
      id: def.id,
      name: def.name,
      kind,
      role: def.role || (def.id === 'hospital' ? 'hospital' : 'pad'),
      r,
      pos: new THREE.Vector3(def.x, y, def.z),
      ground,
    });
  }

  /* -------- pass two: draw it, five instanced meshes and no more -------- */
  const group = new THREE.Group();
  group.name = 'pads';

  const disc = new THREE.CircleGeometry(1, 30);
  disc.rotateX(-Math.PI / 2);
  const byRole = { pad: [], hospital: [] };
  for (const p of PADS) byRole[p.role === 'hospital' ? 'hospital' : 'pad'].push(p);

  const marks = [];
  for (const role of ['pad', 'hospital']) {
    const list = byRole[role];
    if (!list.length) continue;
    const mat = new THREE.MeshStandardMaterial({
      map: padTexture(role),
      roughness: 0.94,
      metalness: 0.02,
      transparent: true,
      // A pad is looked at from directly above more than anything else in the
      // game, so it is the one surface where polygon offset earns its keep:
      // without it the disc fights the ground it is lying on.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const inst = new THREE.InstancedMesh(disc, mat, list.length);
    inst.receiveShadow = true;
    list.forEach((p, i) => {
      _m.position.set(p.pos.x, p.pos.y + padDiscLift(p), p.pos.z);
      _m.rotation.set(0, 0, 0);
      _m.scale.set(p.r, 1, p.r);
      _m.updateMatrix();
      inst.setMatrixAt(i, _m.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
    marks.push(inst);
  }

  const steel = new THREE.MeshStandardMaterial({ color: 0x7b8087, roughness: 0.72, metalness: 0.35 });
  if (legs.length) {
    const legGeo = new THREE.CylinderGeometry(1, 1, 1, 7);
    const inst = new THREE.InstancedMesh(legGeo, steel, legs.length);
    inst.castShadow = true;
    legs.forEach((l, i) => {
      const h = Math.max(1, l.y1 - l.y0);
      _m.position.set(l.x, l.y0 + h / 2, l.z);
      _m.rotation.set(0, 0, 0);
      _m.scale.set(l.r, h, l.r);
      _m.updateMatrix();
      inst.setMatrixAt(i, _m.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }

  /*
   * The buildings. Roof-pad buildings are one merged mesh with a facade
   * (see blockGeometry); a rig's plant module stays an instanced box, now
   * painted the way rig modules are — yellow, white, safety orange, grey —
   * rather than all the same concrete.
   */
  const roofs = blocks.filter((b) => b.roof);
  const plant = blocks.filter((b) => !b.roof);
  const facadeMats = [];
  if (roofs.length) {
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x8e918c, roughness: 0.95 });
    for (const kind of ['hospital', 'office']) {
      const list = roofs.filter((b) => (kind === 'hospital') === b.hospital);
      if (!list.length) continue;
      const wall = new THREE.MeshStandardMaterial({
        map: facadeTexture(kind),
        roughness: 0.82,
        metalness: 0.04,
        envMapIntensity: 0.7,
        emissive: 0xffffff,
        emissiveMap: facadeTexture(kind, true),
        emissiveIntensity: 0,
      });
      facadeMats.push(wall);
      const mesh = new THREE.Mesh(blockGeometry(list), [wall, roofMat]);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
    const hosp = roofs.filter((b) => b.hospital);
    if (hosp.length) {
      const signs = new THREE.InstancedMesh(
        crossSignGeometry(),
        new THREE.MeshBasicMaterial({ vertexColors: true }),
        hosp.length * 4
      );
      let k = 0;
      for (const b of hosp) {
        const h = Math.max(2, b.y1 - b.y0);
        // High on each wall, under the parapet: the thing you see first.
        const sy = b.y0 + h - 4;
        for (let f = 0; f < 4; f++) {
          const a = (f * Math.PI) / 2;
          _m.position.set(b.x + Math.sin(a) * (b.w + 0.2), sy, b.z + Math.cos(a) * (b.w + 0.2));
          _m.rotation.set(0, a, 0);
          _m.scale.set(1, 1, 1);
          _m.updateMatrix();
          signs.setMatrixAt(k++, _m.matrix);
        }
      }
      signs.instanceMatrix.needsUpdate = true;
      group.add(signs);
    }
  }
  if (plant.length) {
    const blockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.1 });
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), blockMat, plant.length);
    inst.castShadow = inst.receiveShadow = true;
    const paint = [0xd9ad3c, 0xe8e6de, 0xd8662e, 0x9aa0a4, 0xc9c24a];
    const col = new THREE.Color();
    plant.forEach((b, i) => {
      const h = Math.max(2, b.y1 - b.y0);
      _m.position.set(b.x, b.y0 + h / 2, b.z);
      _m.rotation.set(0, 0, 0);
      _m.scale.set(b.w * 2, h, b.w * 2);
      _m.updateMatrix();
      inst.setMatrixAt(i, _m.matrix);
      inst.setColorAt(i, col.setHex(paint[Math.abs(Math.round(b.x * 0.37 + b.z * 0.11)) % paint.length]));
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    group.add(inst);
  }

  /*
   * Perimeter lights.
   *
   * Eight per pad, and one shared material for all of them, so "turn the pads
   * on at night" is one number rather than a walk of the scene graph. The rig
   * mission is flown in the dark on purpose and this is what carries you in.
   */
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xcfd6b8,
    emissive: 0x9fb0d8,
    emissiveIntensity: 0.25,
    roughness: 0.5,
  });
  const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.45, 0.7), lampMat, PADS.length * 8);
  let n = 0;
  for (const p of PADS) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      // Standing on the disc (0.45 m tall), not hovering over it.
      _m.position.set(p.pos.x + Math.cos(a) * p.r * 0.97, p.pos.y + padDiscLift(p) + 0.225, p.pos.z + Math.sin(a) * p.r * 0.97);
      _m.rotation.set(0, 0, 0);
      _m.scale.set(1, 1, 1);
      _m.updateMatrix();
      lamps.setMatrixAt(n++, _m.matrix);
    }
  }
  lamps.instanceMatrix.needsUpdate = true;
  group.add(lamps);

  parent.add(group);
  return { group, marks, lampMat, facadeMats, lit: -1 };
}

/**
 * Pad lights come up at dusk and pulse very slightly, which is what makes a
 * lit pad findable from four miles out without being a beacon.
 */
export function updatePads(built, t, isNight) {
  if (!built || !built.lampMat) return;
  built.lampMat.emissiveIntensity = isNight ? 1.8 + Math.sin(t * 2.2) * 0.35 : 0.2;
  // The buildings' windows: written only when day turns to night or back.
  const want = isNight ? 0.85 : 0;
  if (built.facadeMats && want !== built.lit) {
    built.lit = want;
    for (const m of built.facadeMats) m.emissiveIntensity = want;
  }
}
