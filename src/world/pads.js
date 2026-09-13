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
 * WHAT THIS COSTS TO DRAW: five instanced meshes, whatever the pad count.
 * Every disc in the world is one draw call, every leg is one, every block is
 * one, every light is one. Eight rigs on Ironhead Deep cost the same number
 * of draw calls as one pad on Kestrel.
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
      blocks.push({ x: def.x, z: def.z, y0: groundMin(def.x, def.z, r) - 1, y1: y - 1.4, w: r * 1.25 });
      addObstacleAt(def.x, def.z, r * 1.25, r * 1.25, ground - 1, Math.max(2, y - 1.6 - ground), `You flew into ${def.name}`);
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
      addObstacleAt(def.x, def.z + r * 1.1, r * 1.1, r * 1.1, y - 11, 9.4, `You flew into ${def.name}`);
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
      _m.position.set(p.pos.x, p.pos.y + 0.14, p.pos.z);
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

  if (blocks.length) {
    const blockMat = new THREE.MeshStandardMaterial({ color: 0xb9bcb4, roughness: 0.9 });
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), blockMat, blocks.length);
    inst.castShadow = inst.receiveShadow = true;
    blocks.forEach((b, i) => {
      const h = Math.max(2, b.y1 - b.y0);
      _m.position.set(b.x, b.y0 + h / 2, b.z);
      _m.rotation.set(0, 0, 0);
      _m.scale.set(b.w * 2, h, b.w * 2);
      _m.updateMatrix();
      inst.setMatrixAt(i, _m.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
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
      _m.position.set(p.pos.x + Math.cos(a) * p.r * 0.97, p.pos.y + 0.4, p.pos.z + Math.sin(a) * p.r * 0.97);
      _m.rotation.set(0, 0, 0);
      _m.scale.set(1, 1, 1);
      _m.updateMatrix();
      lamps.setMatrixAt(n++, _m.matrix);
    }
  }
  lamps.instanceMatrix.needsUpdate = true;
  group.add(lamps);

  parent.add(group);
  return { group, marks, lampMat };
}

/**
 * Pad lights come up at dusk and pulse very slightly, which is what makes a
 * lit pad findable from four miles out without being a beacon.
 */
export function updatePads(built, t, isNight) {
  if (!built || !built.lampMat) return;
  built.lampMat.emissiveIntensity = isNight ? 1.8 + Math.sin(t * 2.2) * 0.35 : 0.2;
}
