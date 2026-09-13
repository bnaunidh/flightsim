/**
 * Scenery: palm groves, the island town, Mango Cay village with its delivery
 * pad, a lighthouse landmark on Needle Rock and a couple of fishing boats.
 *
 * Everything is instanced or built from primitives so the whole island costs
 * only a handful of draw calls.
 */

import * as THREE from '../vendor/three.module.js';
import { heightAt, scatter, MAP, ISLANDS, addObstacleAt, getFlat } from './terrain.js';
import { buildingTexture, roofTexture, foamTexture, asphaltTexture, asphaltNormal } from '../render/textures.js';
import { createFishingBoat } from '../fleet/maritime.js';
import { makeRandom } from '../core/noise.js';
import { buildPads, updatePads } from './pads.js';

export const DELIVERY_PAD = new THREE.Vector3(6200, 0, -5200);

/**
 * Merge a few small geometries into one, keeping vertex colours.
 *
 * Everything planted in this file is instanced, which means one geometry and
 * one material per species — so a tree made of a trunk and three canopy
 * pieces has to arrive as a single buffer with the colours baked into the
 * vertices. That is cheaper than it sounds and it is what lets a wood of six
 * hundred trees cost four draw calls.
 */
function mergeParts(parts) {
  const pos = [];
  const norm = [];
  const col = [];
  const idx = [];
  let offset = 0;
  for (const { geo, color } of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i++) pos.push(p[i]);
    for (let i = 0; i < n.length; i++) norm.push(n[i]);
    for (let i = 0; i < g.attributes.position.count; i++) {
      col.push(color[0], color[1], color[2]);
      idx.push(offset + i);
    }
    offset += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  return out;
}

/**
 * A tree, as geometry rather than as a picture of one.
 *
 * These were two crossed quads with a painted tree on them — four triangles,
 * which is the right answer for a forest seen from a mile up and the wrong
 * one for the tree you are about to land next to. From the air the crossed
 * pair reads as two flat cards that turn edge-on and vanish as you bank, and
 * on the ground it has no trunk you can walk round.
 *
 * So each species is built: a trunk, and a canopy made of the shape that
 * species actually is. Still one instanced draw call per species, and still
 * about forty triangles a tree, which is nothing.
 *
 * Built to a height of exactly 1 so the planting code can scale it to
 * whatever it wants, and to its own natural width at that height — a conifer
 * is narrow, a palm is wide — so scaling stays uniform and nothing is
 * stretched.
 */
const BARK = [0.29, 0.21, 0.14];
const PALM_BARK = [0.42, 0.34, 0.23];
function treeGeometry(kind = 0) {
  const parts = [];
  const trunk = (topR, botR, h, y, lean = 0) => {
    const g = new THREE.CylinderGeometry(topR, botR, h, 7);
    if (lean) g.rotateZ(lean);
    g.translate(lean ? Math.sin(lean) * h * -0.5 : 0, y, 0);
    return g;
  };
  if (kind === 0) {
    /* Palm: a bare leaning trunk with a crown of fronds on top of it. */
    parts.push({ geo: trunk(0.022, 0.045, 0.82, 0.41, 0.06), color: PALM_BARK });
    const green = [0.22, 0.44, 0.2];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const frond = new THREE.BoxGeometry(0.42, 0.018, 0.1);
      frond.translate(0.2, 0, 0);
      frond.rotateZ(-0.5);
      frond.rotateY(a);
      frond.translate(-0.05, 0.84, 0);
      parts.push({ geo: frond, color: green });
    }
    parts.push({ geo: new THREE.SphereGeometry(0.05, 6, 5).translate(-0.05, 0.85, 0), color: green });
  } else if (kind === 1) {
    /* Broadleaf: a short trunk under two overlapping crowns. */
    parts.push({ geo: trunk(0.035, 0.06, 0.46, 0.23), color: BARK });
    const leaf = [0.2, 0.38, 0.17];
    const leaf2 = [0.25, 0.45, 0.2];
    const a = new THREE.SphereGeometry(0.3, 9, 7);
    a.scale(1, 0.82, 1);
    a.translate(0, 0.62, 0);
    parts.push({ geo: a, color: leaf });
    const b = new THREE.SphereGeometry(0.22, 8, 6);
    b.translate(0.13, 0.8, -0.06);
    parts.push({ geo: b, color: leaf2 });
    const c = new THREE.SphereGeometry(0.2, 8, 6);
    c.translate(-0.14, 0.74, 0.08);
    parts.push({ geo: c, color: leaf2 });
  } else if (kind === 2) {
    /* Conifer: three stacked skirts on a straight trunk. */
    parts.push({ geo: trunk(0.028, 0.05, 1, 0.5), color: BARK });
    const dark = [0.14, 0.3, 0.18];
    const mid = [0.17, 0.35, 0.21];
    parts.push({ geo: new THREE.ConeGeometry(0.3, 0.44, 9).translate(0, 0.36, 0), color: dark });
    parts.push({ geo: new THREE.ConeGeometry(0.24, 0.4, 9).translate(0, 0.62, 0), color: mid });
    parts.push({ geo: new THREE.ConeGeometry(0.16, 0.34, 9).translate(0, 0.86, 0), color: dark });
  } else {
    /* Scrub: low, wide, no trunk worth speaking of. */
    const bush = [0.28, 0.36, 0.19];
    const a = new THREE.SphereGeometry(0.38, 8, 6);
    a.scale(1, 0.62, 1);
    a.translate(0, 0.26, 0);
    parts.push({ geo: a, color: bush });
    const b = new THREE.SphereGeometry(0.26, 7, 5);
    b.scale(1, 0.6, 1);
    b.translate(0.24, 0.18, 0.1);
    parts.push({ geo: b, color: [0.24, 0.32, 0.17] });
  }
  const g = mergeParts(parts);
  g.computeVertexNormals();
  return g;
}

/**
 * Plant a grove.
 *
 * `mix` is the weighting of the four species, so a coastline can be mostly
 * palm while high ground is mostly conifer. Each species gets its own
 * instanced mesh — one draw call each, four instead of one, which is nothing
 * next to what it buys.
 *
 * Trees are solid. They were scenery you flew through, which is a strange
 * thing in a game where you can hit a hangar: a palm is a heavy object and a
 * light aeroplane loses an argument with one. Only the ones big enough to
 * matter get a hitbox — a knee-high bush should not end a flight — and the box
 * is deliberately narrower than the canopy, because clipping a frond is not
 * the same as hitting the trunk.
 */
function addTrees(group, spots, height = 9, mix = [0.7, 0.15, 0.05, 0.1], solid = true) {
  const total = mix.reduce((a, b) => a + b, 0) || 1;
  const buckets = [[], [], [], []];
  for (const s of spots) {
    // Deterministic from the spot itself, so a given tree is always the same
    // species however many times the world is rebuilt.
    let r = ((Math.sin(s.x * 12.9898 + s.z * 78.233) * 43758.5453) % 1 + 1) % 1;
    r *= total;
    let k = 0;
    for (let i = 0; i < mix.length; i++) {
      if (r < mix[i]) { k = i; break; }
      r -= mix[i];
      k = i;
    }
    buckets[k].push(s);
  }

  const meshes = [];
  const d = new THREE.Object3D();
  buckets.forEach((list, kind) => {
    if (!list.length) return;
    /*
     * Vertex colours, no texture, no alpha test.
     *
     * The trunk and the canopy are one geometry, so their colours are baked
     * into the vertices — which is also why the leaves no longer need an
     * alpha-tested cut-out, and why they no longer flicker along their edges
     * at distance the way a cut-out does.
     */
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
    });
    const inst = new THREE.InstancedMesh(treeGeometry(kind), mat, list.length);
    inst.castShadow = true;
    inst.receiveShadow = false;
    // How tall this species is relative to the grove's nominal height.
    const shape = [
      { w: 0.8, h: 1.0 },
      { w: 0.95, h: 0.9 },
      { w: 0.72, h: 1.15 },
      { w: 1.05, h: 0.42 },
    ][kind];
    list.forEach((s, i) => {
      d.position.set(s.x, s.y - 0.4, s.z);
      d.rotation.set(0, s.rot, 0);
      const h = height * s.scale * shape.h;
      // Uniform: the species' proportions are built into its geometry now,
      // and squashing that by a separate width factor undid the point of it.
      d.scale.set(h, h, h);
      d.updateMatrix();
      inst.setMatrixAt(i, d.matrix);
      // Anything over four metres is worth hitting. The trunk box is a
      // quarter of the canopy width and stops short of the very top, so you
      // can brush the leaves without being killed by them.
      if (solid && kind !== 3 && h > 4) {
        const trunkW = Math.max(1.2, h * shape.w * 0.22);
        addObstacleAt(s.x, s.z, trunkW, trunkW, s.y - 0.4, h * 0.86, 'You flew into a tree');
      }
    });
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
    meshes.push(inst);
  });
  return meshes;
}

function addTown(group, spots) {
  // Four texture variants → four instanced meshes.
  const buckets = [[], [], [], []];
  spots.forEach((s, i) => buckets[i % 4].push(s));
  const roofMat = new THREE.MeshStandardMaterial({ map: roofTexture(), roughness: 0.9 });
  buckets.forEach((bucket, v) => {
    if (!bucket.length) return;
    const mat = new THREE.MeshStandardMaterial({
      map: buildingTexture(v),
      roughness: 0.82,
      metalness: 0.04,
    });
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, bucket.length);
    const roofs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), roofMat, bucket.length);
    inst.castShadow = inst.receiveShadow = true;
    roofs.castShadow = true;
    const d = new THREE.Object3D();
    bucket.forEach((s, i) => {
      const w = 10 + s.scale * 12;
      const dep = 9 + s.scale * 10;
      const h = 7 + s.scale * (v === 2 ? 26 : 12);
      d.position.set(s.x, s.y + h / 2 - 0.5, s.z);
      d.rotation.set(0, s.rot, 0);
      d.scale.set(w, h, dep);
      d.updateMatrix();
      inst.setMatrixAt(i, d.matrix);
      d.position.y = s.y + h + 0.4;
      d.scale.set(w + 1.2, 0.9, dep + 1.2);
      d.updateMatrix();
      roofs.setMatrixAt(i, d.matrix);
      // The town is solid too. Flying through a block of flats was every bit
      // as odd as flying through the trees.
      addObstacleAt(s.x, s.z, w, dep, s.y - 0.5, h + 1.3, 'You flew into a building');
    });
    inst.instanceMatrix.needsUpdate = true;
    roofs.instanceMatrix.needsUpdate = true;
    group.add(inst, roofs);
  });
}

function buildLighthouse(group, x, z) {
  const y = heightAt(x, z);
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.7 });
  const red = new THREE.MeshStandardMaterial({ color: 0xc8241c, roughness: 0.7 });
  let h = 0;
  for (let i = 0; i < 6; i++) {
    const seg = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4 - i * 0.28, 3.7 - i * 0.28, 5, 16),
      i % 2 ? red : white
    );
    seg.position.y = h + 2.5;
    seg.castShadow = seg.receiveShadow = true;
    g.add(seg);
    h += 5;
  }
  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 0.7, 16), white);
  gallery.position.y = h + 0.3;
  g.add(gallery);
  const lamp = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 2.4, 4, 14),
    new THREE.MeshStandardMaterial({
      color: 0xffe9b0,
      emissive: 0xffd070,
      emissiveIntensity: 1.4,
      roughness: 0.2,
      transparent: true,
      opacity: 0.85,
    })
  );
  lamp.position.y = h + 2.6;
  g.add(lamp);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(3, 2.6, 14), red);
  cap.position.y = h + 6;
  g.add(cap);
  g.position.set(x, y, z);
  group.add(g);
  return lamp;
}

function buildDeliveryPad(group) {
  const y = heightAt(DELIVERY_PAD.x, DELIVERY_PAD.z);
  DELIVERY_PAD.y = y;

  // A short grass strip with a painted target circle: the drop zone.
  const padMat = new THREE.MeshStandardMaterial({ color: 0x6b6f5c, roughness: 0.95 });
  const geo = new THREE.PlaneGeometry(240, 44);
  geo.rotateX(-Math.PI / 2);
  const pad = new THREE.Mesh(geo, padMat);
  pad.position.set(DELIVERY_PAD.x, y + 0.08, DELIVERY_PAD.z);
  pad.receiveShadow = true;
  group.add(pad);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(14, 18, 40),
    new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(DELIVERY_PAD.x, y + 0.14, DELIVERY_PAD.z);
  group.add(ring);
  const cross = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 3.5),
    new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9 })
  );
  cross.rotation.x = -Math.PI / 2;
  cross.position.set(DELIVERY_PAD.x, y + 0.14, DELIVERY_PAD.z);
  group.add(cross);
  const cross2 = cross.clone();
  cross2.rotation.z = Math.PI / 2;
  group.add(cross2);

  // Village huts around the pad.
  const hutMat = new THREE.MeshStandardMaterial({ map: buildingTexture(1), roughness: 0.85 });
  const thatchMat = new THREE.MeshStandardMaterial({ color: 0x8d6b3f, roughness: 0.95 });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const r = 70 + (i % 3) * 22;
    const hx = DELIVERY_PAD.x + Math.cos(a) * r;
    const hz = DELIVERY_PAD.z + Math.sin(a) * r;
    const hy = heightAt(hx, hz);
    if (hy < 2) continue;
    const hut = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 8), hutMat);
    hut.position.set(hx, hy + 2.5, hz);
    hut.rotation.y = a;
    hut.castShadow = hut.receiveShadow = true;
    group.add(hut);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(7, 4, 4), thatchMat);
    roof.position.set(hx, hy + 7, hz);
    roof.rotation.y = a + Math.PI / 4;
    roof.castShadow = true;
    group.add(roof);
  }
  return pad;
}

function buildBoats(group, count, home = null) {
  const boats = [];
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.6 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x2b6ea8, roughness: 0.5 });
  const wakeTex = foamTexture();
  for (let i = 0; i < count; i++) {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.6, 16, 10, 1, false, 0, Math.PI), hullMat);
    hull.rotation.z = Math.PI / 2;
    hull.rotation.y = Math.PI;
    hull.position.y = 0.9;
    hull.castShadow = true;
    g.add(hull);
    const house = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 4.4), deckMat);
    house.position.set(-2, 2.6, 0);
    house.castShadow = true;
    g.add(house);
    const wake = new THREE.Mesh(
      new THREE.PlaneGeometry(70, 16),
      new THREE.MeshBasicMaterial({ map: wakeTex, transparent: true, opacity: 0.4, depthWrite: false })
    );
    wake.rotation.x = -Math.PI / 2;
    wake.position.set(-38, 0.3, 0);
    g.add(wake);
    // Start them in open water. Maps differ, so walk outwards from the nominal
    // spot until the sea floor is genuinely below us.
    //
    // `boatHome` is where a map wants its fleet. A working harbour with its
    // boats strung three kilometres across the middle of the map is not a
    // fleet, it is three boats that happen to be floating.
    let bx = home ? home[0] - i * 120 : -1400 - i * 900;
    let bz = home ? home[1] + i * 160 : 1800 + i * 1400;
    for (let tries = 0; tries < 40 && heightAt(bx, bz) > -6; tries++) {
      bx -= 260;
      bz += 190;
    }
    g.position.set(bx, 0, bz);
    g.rotation.y = i * 1.2;
    group.add(g);
    boats.push({ obj: g, speed: 3 + i, phase: i * 2 });
  }
  return boats;
}

/**
 * A military air base: shelters, revetments, blast walls and a radar.
 *
 * The class asked for military aircraft to have somewhere military to fly
 * from, and they were right to — flying a bomber off the same palm-fringed
 * tropical strip the trainer uses rather undercuts it.
 *
 * Everything here is instanced and solid, so the base costs a handful of draw
 * calls and you cannot fly through a blast wall.
 */
function addAirBase(group, base) {
  if (!base) return;
  const { cx = 0, cz = 0 } = base;
  const concrete = new THREE.MeshStandardMaterial({ color: 0x9a9a92, roughness: 0.94, metalness: 0.02 });
  const earth = new THREE.MeshStandardMaterial({ color: 0x7d7355, roughness: 1 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x5c6168, roughness: 0.6, metalness: 0.45 });

  /*
   * Hardened aircraft shelters, in a row off the taxiway.
   *
   * A half-cylinder laid on its side is what a HAS actually is, and it reads
   * as one instantly — which matters more than any amount of detail on it.
   */
  const parkSpots = [];
  const count = base.shelters ?? 8;
  const archGeo = new THREE.CylinderGeometry(13, 13, 30, 14, 1, false, 0, Math.PI);
  archGeo.rotateZ(Math.PI / 2);
  archGeo.rotateY(Math.PI / 2);
  const shelters = new THREE.InstancedMesh(archGeo, concrete, count);
  shelters.castShadow = shelters.receiveShadow = true;
  const d = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const along = (Math.floor(i / 2) - (count / 4 - 0.5)) * 150;
    const x = cx + along;
    const z = cz + side * (base.spread ?? 620);
    const y = heightAt(x, z);
    d.position.set(x, y, z);
    d.rotation.set(0, side > 0 ? 0 : Math.PI, 0);
    d.scale.setScalar(1);
    d.updateMatrix();
    shelters.setMatrixAt(i, d.matrix);
    addObstacleAt(x, z, 30, 26, y - 1, 13, 'You flew into a hardened shelter');
    // The apron in front of the shelter, facing out. parkJets() uses these.
    parkSpots.push({ x, y, z: z - side * 26, heading: side > 0 ? Math.PI : 0 });
  }
  shelters.instanceMatrix.needsUpdate = true;
  group.add(shelters);

  // Earth revetments: open-ended U-shaped banks for the aircraft that live
  // outside. Three boxes each, which is exactly what a revetment looks like.
  const revs = base.revetments ?? 6;
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  const banks = new THREE.InstancedMesh(wallGeo, earth, revs * 3);
  banks.castShadow = banks.receiveShadow = true;
  let n = 0;
  for (let i = 0; i < revs; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const along = (Math.floor(i / 2) - (revs / 4 - 0.5)) * 170 + 80;
    const bx = cx + along;
    const bz = cz + side * ((base.spread ?? 620) + 210);
    const by = heightAt(bx, bz);
    const pieces = [
      [0, -18, 44, 4],   // back wall, across
      [-20, 0, 4, 36],   // left
      [20, 0, 4, 36],    // right
    ];
    for (const [ox, oz, w, dep] of pieces) {
      d.position.set(bx + ox, by + 3, bz + oz * side);
      d.rotation.set(0, 0, 0);
      d.scale.set(w, 6, dep);
      d.updateMatrix();
      banks.setMatrixAt(n++, d.matrix);
      addObstacleAt(bx + ox, bz + oz * side, w, dep, by, 6.6, 'You flew into a revetment');
    }
  }
  banks.instanceMatrix.needsUpdate = true;
  group.add(banks);

  // Blast walls along the apron edge.
  const walls = base.walls ?? 14;
  const blast = new THREE.InstancedMesh(wallGeo, concrete, walls);
  blast.castShadow = blast.receiveShadow = true;
  for (let i = 0; i < walls; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const along = (Math.floor(i / 2) - (walls / 4 - 0.5)) * 96;
    const wx = cx + along;
    const wz = cz + side * (base.spread ?? 620) * 0.62;
    const wy = heightAt(wx, wz);
    d.position.set(wx, wy + 2.6, wz);
    d.rotation.set(0, 0, 0);
    d.scale.set(60, 5.2, 2.2);
    d.updateMatrix();
    blast.setMatrixAt(i, d.matrix);
    addObstacleAt(wx, wz, 60, 2.2, wy, 5.6, 'You flew into a blast wall');
  }
  blast.instanceMatrix.needsUpdate = true;
  group.add(blast);

  // A radar, which turns. It is the one thing on a base that moves, so it is
  // what tells you the place is alive.
  const rx = cx - (base.radarOffset ?? 900);
  const rz = cz + (base.spread ?? 620) * 1.5;
  const ry = heightAt(rx, rz);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.4, 26, 8), steel);
  mast.position.set(rx, ry + 13, rz);
  mast.castShadow = true;
  group.add(mast);
  const dish = new THREE.Group();
  const face = new THREE.Mesh(new THREE.BoxGeometry(16, 5, 1.1), steel);
  face.castShadow = true;
  dish.add(face);
  dish.position.set(rx, ry + 27, rz);
  group.add(dish);
  addObstacleAt(rx, rz, 6, 6, ry, 29, 'You flew into the radar');

  /*
   * A fuel farm.
   *
   * Three tanks and a bund. It is here because a base made only of things
   * that hide aeroplanes reads as a diagram of a base — you need one or two
   * pieces of ordinary infrastructure before the place looks like somewhere
   * people work. Tanks are the cheapest such piece: everyone knows what they
   * are from any distance and any angle.
   */
  const fx = cx + (base.radarOffset ?? 900) * 1.15;
  const fz = cz - (base.spread ?? 620) * 1.35;
  const tankMat = new THREE.MeshStandardMaterial({ color: 0xb8bcb4, roughness: 0.72, metalness: 0.28 });
  for (let i = 0; i < 3; i++) {
    const tx = fx + (i - 1) * 46;
    const ty = heightAt(tx, fz);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 13, 20), tankMat);
    tank.position.set(tx, ty + 6.5, fz);
    tank.castShadow = tank.receiveShadow = true;
    group.add(tank);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(15.4, 15.4, 0.7, 20), steel);
    lid.position.set(tx, ty + 13.2, fz);
    group.add(lid);
    addObstacleAt(tx, fz, 30, 30, ty, 14, 'You flew into the fuel farm');
  }
  // The bund wall around them — a low earth bank, which is what a real one is.
  const bundGeo = new THREE.BoxGeometry(1, 1, 1);
  const bund = new THREE.InstancedMesh(bundGeo, earth, 4);
  const bd = new THREE.Object3D();
  const by = heightAt(fx, fz);
  const sides = [
    [0, -34, 172, 3],
    [0, 34, 172, 3],
    [-86, 0, 3, 71],
    [86, 0, 3, 71],
  ];
  sides.forEach(([ox, oz, w, dep], i) => {
    bd.position.set(fx + ox, by + 1.6, fz + oz);
    bd.rotation.set(0, 0, 0);
    bd.scale.set(w, 3.2, dep);
    bd.updateMatrix();
    bund.setMatrixAt(i, bd.matrix);
  });
  bund.instanceMatrix.needsUpdate = true;
  bund.castShadow = bund.receiveShadow = true;
  group.add(bund);

  return { dish, parkSpots };
}


/**
 * A working harbour, built on whichever authored flat the map points at.
 *
 * Every other named place in this game is made by scattering objects on a
 * lawn, which is why the town reads as a field of sheds and the delivery pad
 * reads as a target painted on a hillside. A harbour cannot be made that way.
 * A quay is a level edge where the land stops, and the entire point of it is
 * that you can drive along it — so this builder scatters nothing. It reads one
 * rectangle out of MAP.flats, works out which end of it the water is at, and
 * lays the harbour out relative to that: deck, stone lip, bollards, container
 * stacks, a gantry, sheds, and the boats moored along the outer face.
 *
 * That is also why it carries no coordinates of its own and works on any map
 * at any elevation — it builds on whatever height resolveFlats decided the
 * ground actually was. About six draw calls, all primitives, nothing
 * downloaded.
 */
export function addHarbour(group, cfg) {
  if (!cfg) return null;
  const f = getFlat(cfg.flat || 'quay');
  if (!f) {
    // A warning rather than a silent nothing: a harbour whose flat has been
    // renamed is a one-word mistake in the map data, and an empty coastline
    // looks like a rendering bug rather than a typo.
    console.warn(`addHarbour: no flat called "${cfg.flat || 'quay'}" on this map.`);
    return null;
  }

  const rnd = makeRandom(cfg.seed || 808);
  const y = f.y;
  const wide = f.x1 - f.x0 > f.z1 - f.z0;
  const len = wide ? f.x1 - f.x0 : f.z1 - f.z0;
  const wid = wide ? f.z1 - f.z0 : f.x1 - f.x0;

  /*
   * Which way is the sea?
   *
   * A shore flat is authored as a rectangle straddling the coast: one end is
   * on the island, the other hangs over the water. Rather than make the map
   * author state which, sample the natural ground a little past each end and
   * take the lower. That keeps the map data to one rectangle and it stays
   * right if somebody nudges the rectangle later.
   */
  const probe = 180;
  const aX = wide ? f.x0 - probe : f.cx;
  const aZ = wide ? f.cz : f.z0 - probe;
  const bX = wide ? f.x1 + probe : f.cx;
  const bZ = wide ? f.cz : f.z1 + probe;
  const sign = heightAt(bX, bZ) < heightAt(aX, aZ) ? 1 : -1;
  /** Quay-local to world: `u` runs along the quay (+ is seaward), `v` across. */
  const P = (u, v) => (wide
    ? new THREE.Vector3(f.cx + u * sign, y, f.cz + v)
    : new THREE.Vector3(f.cx + v, y, f.cz + u * sign));
  const headingSeaward = wide ? (sign > 0 ? 90 : 270) : (sign > 0 ? 180 : 0);

  /* ------------------------------------------------------------- deck -- */

  const deckTex = asphaltTexture().clone();
  deckTex.needsUpdate = true;
  deckTex.wrapS = deckTex.wrapT = THREE.RepeatWrapping;
  deckTex.repeat.set(len / 24, wid / 24);
  const deckNrm = asphaltNormal().clone();
  deckNrm.needsUpdate = true;
  deckNrm.wrapS = deckNrm.wrapT = THREE.RepeatWrapping;
  deckNrm.repeat.set(len / 24, wid / 24);
  const deckGeo = new THREE.PlaneGeometry(wide ? len : wid, wide ? wid : len);
  deckGeo.rotateX(-Math.PI / 2);
  const deck = new THREE.Mesh(deckGeo, new THREE.MeshStandardMaterial({
    map: deckTex,
    normalMap: deckNrm,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.94,
    metalness: 0.02,
  }));
  // Six centimetres proud, the trick the runway and the apron already use: the
  // ground under it is level but its triangles are not exactly at f.y.
  deck.position.set(f.cx, y + 0.06, f.cz);
  deck.receiveShadow = true;
  group.add(deck);

  /* ---------------------------------------------------------- the edge -- */

  // A stone lip round three sides, so the quay stops at something rather than
  // fading into the water.
  const stone = new THREE.MeshStandardMaterial({ color: 0x9a978e, roughness: 0.95 });
  const lip = (cx, cz, w, d) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.8, d), stone);
    m.position.set(cx, y + 0.24, cz);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  };
  const end = P(len / 2, 0);
  lip(end.x, end.z, wide ? 3 : wid, wide ? wid : 3);
  const sideA = P(0, wid / 2);
  const sideB = P(0, -wid / 2);
  lip(sideA.x, sideA.z, wide ? len : 3, wide ? 3 : len);
  lip(sideB.x, sideB.z, wide ? len : 3, wide ? 3 : len);

  const bollards = Math.max(4, Math.round(len / 34));
  const bMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.42, 0.55, 1.1, 8),
    new THREE.MeshStandardMaterial({ color: 0x2f3438, roughness: 0.7, metalness: 0.3 }),
    bollards * 2
  );
  bMesh.castShadow = true;
  const d3 = new THREE.Object3D();
  let bi = 0;
  for (let i = 0; i < bollards; i++) {
    const u = len / 2 - 14 - (i * (len - 40)) / Math.max(1, bollards - 1);
    for (const v of [wid / 2 - 3.2, -wid / 2 + 3.2]) {
      const p = P(u, v);
      d3.position.set(p.x, y + 0.55, p.z);
      d3.rotation.set(0, 0, 0);
      d3.scale.set(1, 1, 1);
      d3.updateMatrix();
      bMesh.setMatrixAt(bi++, d3.matrix);
    }
  }
  bMesh.count = bi;
  bMesh.instanceMatrix.needsUpdate = true;
  group.add(bMesh);

  /* ------------------------------------------------------- containers -- */

  const nBoxes = cfg.containers || 14;
  const boxes = new THREE.InstancedMesh(
    new THREE.BoxGeometry(6.1, 2.6, 2.44),
    new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0.18 }),
    nBoxes
  );
  boxes.castShadow = boxes.receiveShadow = true;
  const tints = [0xb4432c, 0x2f6ea8, 0x3f7a4a, 0xc9973a, 0x6a5f7e, 0xa8a49a];
  const col = new THREE.Color();
  let ci = 0;
  // Stacked down the landward half, which is where a real yard puts them: the
  // seaward half has to stay clear for the crane and the boats. Only the
  // bottom box of each stack registers an obstacle, covering the full stack
  // height — one box per stack rather than one per container.
  for (let row = 0; ci < nBoxes && row < 8; row++) {
    for (let lane = -1; lane <= 1 && ci < nBoxes; lane++) {
      const high = 1 + ((rnd() * 2.4) | 0);
      for (let k = 0; k < high && ci < nBoxes; k++) {
        const u = -len / 2 + 26 + row * 9.2;
        const v = lane * (wid / 3.2);
        const p = P(u, v);
        d3.position.set(p.x, y + 1.35 + k * 2.68, p.z);
        d3.rotation.set(0, wide ? 0 : Math.PI / 2, 0);
        d3.scale.set(1, 1, 1);
        d3.updateMatrix();
        boxes.setMatrixAt(ci, d3.matrix);
        boxes.setColorAt(ci, col.setHex(tints[(rnd() * tints.length) | 0]));
        ci++;
        if (k === 0) {
          addObstacleAt(p.x, p.z, wide ? 6.4 : 2.8, wide ? 2.8 : 6.4, y, 2.7 * high,
            'You hit a shipping container');
        }
      }
    }
  }
  boxes.count = ci;
  boxes.instanceMatrix.needsUpdate = true;
  if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true;
  if (ci) group.add(boxes);

  /* ------------------------------------------------------------ crane -- */

  const steel = new THREE.MeshStandardMaterial({ color: 0xd8892c, roughness: 0.6, metalness: 0.35 });
  for (let c = 0; c < (cfg.cranes ?? 1); c++) {
    const u = len / 2 - 40 - c * 70;
    const beamY = y + 17;
    for (const v of [wid / 2 - 5, -wid / 2 + 5]) {
      const p = P(u, v);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1.6, 17, 1.6), steel);
      leg.position.set(p.x, y + 8.5, p.z);
      leg.castShadow = true;
      group.add(leg);
      addObstacleAt(p.x, p.z, 2.2, 2.2, y, 17, 'You hit the crane');
    }
    const mid = P(u, 0);
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(wide ? 2.2 : wid + 14, 2.2, wide ? wid + 14 : 2.2), steel);
    beam.position.set(mid.x, beamY, mid.z);
    beam.castShadow = true;
    group.add(beam);
    const trolley = new THREE.Mesh(
      new THREE.BoxGeometry(3, 2.4, 3),
      new THREE.MeshStandardMaterial({ color: 0x39404a, roughness: 0.7 })
    );
    const tp = P(u, wid * 0.18);
    trolley.position.set(tp.x, beamY - 2.4, tp.z);
    trolley.castShadow = true;
    group.add(trolley);
  }

  /* ------------------------------------------------------------ sheds -- */

  const shedMat = new THREE.MeshStandardMaterial({ map: buildingTexture(3), roughness: 0.86 });
  const harbourRoof = new THREE.MeshStandardMaterial({ map: roofTexture(), roughness: 0.9 });
  for (let i = 0; i < (cfg.sheds ?? 2); i++) {
    const u = -len / 2 + 14;
    const v = (i % 2 ? 1 : -1) * (wid / 2 - 11);
    const p = P(u + i * 2, v);
    const w = wide ? 26 : 15;
    const dp = wide ? 15 : 26;
    const hgt = 8.5;
    const shed = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, dp), shedMat);
    shed.position.set(p.x, y + hgt / 2, p.z);
    shed.castShadow = shed.receiveShadow = true;
    group.add(shed);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 1.4, 0.9, dp + 1.4), harbourRoof);
    roof.position.set(p.x, y + hgt + 0.45, p.z);
    roof.castShadow = true;
    group.add(roof);
    addObstacleAt(p.x, p.z, w, dp, y, hgt + 1.2, 'You hit the harbour shed');
  }

  /* ------------------------------------------------------------ boats -- */

  // createFishingBoat has been in the fleet since the maritime models landed
  // and was imported by absolutely nothing. A harbour is what it was for.
  const moored = [];
  for (let i = 0; i < (cfg.moored ?? 2); i++) {
    let boat;
    try {
      boat = createFishingBoat({ color: i % 2 ? '#5d6860' : '#7d6a52' });
    } catch (e) {
      console.warn('Could not build a fishing boat for the harbour.', e);
      break;
    }
    const p = P(len / 2 - 24 - i * 16, (wid / 2 + 6) * (i % 2 ? -1 : 1));
    boat.position.set(p.x, 0, p.z);
    boat.rotation.y = ((headingSeaward + 90) * Math.PI) / 180;
    group.add(boat);
    moored.push(boat);
  }

  return {
    flat: f,
    deck,
    moored,
    /** Where the van is loaded: the middle of the landward half. */
    loadPoint: P(-len / 4, 0),
    headingSeaward,
  };
}

/**
 * A weapons range you can actually see.
 *
 * The mission has always said "a marked practice range with a bullseye", and
 * there was never anything there. The target was a bare coordinate in
 * missions.js, and on this map that coordinate fell fifty metres off the end
 * of the plain — you flew seven kilometres to an unmarked patch of open sea
 * and dropped a practice bomb into it. Nothing marked the middle, so "twelve
 * metres from the middle" was a number about a place you could not see.
 *
 * So: painted rings, corner markers, three wrecked hulks to aim at and a
 * scoring tower off to the side. The rings are displaced onto the ground
 * rather than laid on a flat disc, because nothing out here is flat, and a
 * bullseye floating over a slope would be worse than none.
 *
 * The range publishes where its middle is, and the mission asks — the same
 * arrangement as the carrier, and for the same reason: a mission carrying its
 * own copy of a coordinate is a mission that silently points at empty ground
 * the day anything moves.
 */
function addWeaponsRange(group, cfg) {
  if (!cfg) return null;
  const { cx, cz } = cfg;
  const R = cfg.radius ?? 130;
  const paint = (color, emissive = 0) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.98,
      metalness: 0,
      emissive,
      // Sit on the ground rather than fighting it for the same pixels.
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
  const white = paint(0xe8e6dc);
  const red = paint(0xb2342c);
  const rust = new THREE.MeshStandardMaterial({ color: 0x6b5344, roughness: 1, metalness: 0.05 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x5c6168, roughness: 0.6, metalness: 0.45 });

  /** Lay a flat ring on the ground, following it. */
  const band = (inner, outer, mat) => {
    const geo =
      inner > 0
        ? new THREE.RingGeometry(inner, outer, 64, 1)
        : new THREE.CircleGeometry(outer, 64);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, heightAt(cx + pos.getX(i), cz + pos.getZ(i)) + 0.14);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.position.set(cx, 0, cz);
    m.receiveShadow = true;
    group.add(m);
  };
  band(R * 0.72, R, white);
  band(R * 0.46, R * 0.6, red);
  band(R * 0.24, R * 0.34, white);
  band(0, R * 0.12, red);

  // Corner markers, so the range reads as a marked place from any height.
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const mx = cx + sx * R * 1.12;
    const mz = cz + sz * R * 1.12;
    const my = heightAt(mx, mz);
    const post = new THREE.Mesh(new THREE.BoxGeometry(2.4, 7, 2.4), white);
    post.position.set(mx, my + 3.5, mz);
    post.castShadow = true;
    group.add(post);
  }

  /*
   * Three hulks in the middle: something to aim at rather than a patch of
   * paint. Deliberately not solid — they are what you are trying to hit, and
   * a ten-year-old flying a low pass over the range should not be killed by
   * the scenery for doing exactly what they were asked to do.
   */
  const hulks = [
    [-22, 14, 0.6],
    [18, -9, 2.2],
    [6, 26, 3.9],
  ];
  for (const [ox, oz, rot] of hulks) {
    const hx = cx + ox;
    const hz = cz + oz;
    const hy = heightAt(hx, hz);
    const body = new THREE.Mesh(new THREE.BoxGeometry(7.2, 2.4, 3.6), rust);
    body.position.set(hx, hy + 1.2, hz);
    body.rotation.y = rot;
    body.castShadow = body.receiveShadow = true;
    group.add(body);
    const turret = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 1.3, 8), rust);
    turret.position.set(hx, hy + 3, hz);
    turret.castShadow = true;
    group.add(turret);
  }

  // The scoring tower, well clear of the pattern.
  const tx = cx + R * 2.1;
  const tz = cz - R * 1.6;
  const ty = heightAt(tx, tz);
  for (const [lx, lz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 11, 6), steel);
    leg.position.set(tx + lx, ty + 5.5, tz + lz);
    group.add(leg);
  }
  const cab = new THREE.Mesh(new THREE.BoxGeometry(9, 3.4, 9), steel);
  cab.position.set(tx, ty + 12.7, tz);
  cab.castShadow = true;
  group.add(cab);
  addObstacleAt(tx, tz, 9, 9, ty, 15, 'You flew into the range tower');

  return { pos: new THREE.Vector3(cx, heightAt(cx, cz), cz) };
}

export class Scenery {
  constructor(scene, quality = 'high') {
    this.group = new THREE.Group();
    this.group.name = 'scenery';
    this.t = 0;

    const density = quality === 'low' ? 0.35 : quality === 'medium' ? 0.65 : quality === 'ultra' ? 1.8 : 1;
    // Everything planted here is described by the active map: how many trees,
    // how tall, where the town goes, where the lighthouse stands.
    const cfg = MAP.scenery;
    const main = ISLANDS[0];

    // The delivery pad moves with the map, but it stays the same object so
    // anything already holding a reference to it stays correct.
    DELIVERY_PAD.set(cfg.deliveryPad[0], 0, cfg.deliveryPad[1]);

    // Trees along the coast of the main island.
    const coast = scatter({
      cx: main.cx,
      cz: main.cz,
      radius: main.radius * 0.96,
      count: Math.round(cfg.coastTrees * density),
      seed: 5,
      minH: 2.5,
      maxH: Math.max(40, cfg.hillBand[0] + 30),
      maxSlope: 0.45,
    });
    // Coast: palms, with a little scrub between them.
    addTrees(this.group, coast, cfg.coastTreeHeight, [0.72, 0.1, 0.02, 0.16]);

    // Denser stands up on the higher ground.
    const upland = scatter({
      cx: cfg.hillCentre[0],
      cz: cfg.hillCentre[1],
      radius: cfg.hillRadius,
      count: Math.round(cfg.hillTrees * density),
      seed: 55,
      minH: cfg.hillBand[0],
      maxH: cfg.hillBand[1],
      maxSlope: 0.7,
    });
    // High ground: conifer and broadleaf, which is what actually grows up there.
    addTrees(this.group, upland, cfg.hillTreeHeight, [0.06, 0.36, 0.46, 0.12]);

    // A military base, on the maps that have one.
    this.base = addAirBase(this.group, cfg.base);
    // And the range it practises on.
    this.range = addWeaponsRange(this.group, cfg.range);

    // The town, in whatever flat land this map has near the field.
    const town = scatter({
      cx: cfg.town.cx,
      cz: cfg.town.cz,
      radius: cfg.town.radius,
      count: Math.round(cfg.town.count * (density > 0.5 ? 1 : 0.7)),
      seed: 9,
      minH: cfg.town.minH,
      maxH: cfg.town.maxH,
      maxSlope: 0.16,
    });
    addTown(this.group, town);

    // Greenery around the outlying delivery strip.
    const padTrees = scatter({
      cx: DELIVERY_PAD.x,
      cz: DELIVERY_PAD.z,
      radius: 900,
      count: Math.round(cfg.padTrees * density),
      seed: 77,
      minH: 2.5,
      maxH: 240,
      maxSlope: 0.5,
      avoidAirport: false,
    });
    // Round the delivery pad, and NOT solid — landing there is the mission.
    addTrees(this.group, padTrees, cfg.coastTreeHeight, [0.6, 0.18, 0.02, 0.2], false);

    this.lighthouseLamp = buildLighthouse(this.group, cfg.lighthouse[0], cfg.lighthouse[1]);
    buildDeliveryPad(this.group);
    this.harbour = cfg.harbour ? addHarbour(this.group, cfg.harbour) : null;
    this.boats = buildBoats(this.group, cfg.boats, cfg.boatHome);

    /*
     * Helipads, last of everything.
     *
     * Order matters and it is not obvious. `heightAt` returns platform height
     * over a registered platform, so anything that samples the ground —
     * scatter for the trees, buildBoats looking for open water, the terrain
     * mesh itself — has to have finished before the pads register theirs, or
     * a rig deck reads as a hillside and the boats sail round it.
     */
    this.pads = buildPads(this.group);

    scene.add(this.group);
  }

  /**
   * Park a few aeroplanes on the base.
   *
   * Same reasoning as the carrier deck: an empty apron reads as a model of an
   * air base, and you cannot tell how big any of it is until there is
   * something on it whose size you already know. Six shelters with nothing in
   * front of them is a diagram; two Nightjars and a Vanguard sitting out is a
   * place.
   *
   * The model factory is passed in rather than imported, so the world does not
   * have to know anything about aeroplanes — main.js owns that seam already.
   */
  parkJets(makeModel, type, scheme) {
    if (!makeModel || !type || !this.base || !this.base.parkSpots) return;
    const spots = this.base.parkSpots.slice(0, 4);
    for (const spot of spots) {
      let m;
      try {
        m = makeModel({ type, livery: scheme });
      } catch (e) {
        console.warn('Could not park an aeroplane on the base.', e);
        return;
      }
      m.position.set(spot.x, spot.y, spot.z);
      m.rotation.y = spot.heading;
      // Parked: engine off, wheels down, nothing turning.
      if (m.userData.update) {
        try {
          m.userData.update(0.016, {
            controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 1 },
            rpm: 0, flaps: 0, gearPos: 1, gearDown: true, onGround: true,
            groundSpeed: 0, agl: 0, alt: spot.y, engineOn: false,
            vel: new THREE.Vector3(), pos: m.position, quat: m.quaternion,
          }, { isNight: false, cond: { cloud: 0 } });
        } catch (e) {
          /* a model that will not animate parked is still fine to look at */
        }
      }
      this.group.add(m);
    }
  }

  update(dt, weather) {
    this.t += dt;
    // The base radar turns. It is the only moving thing on an air base, which
    // is what stops the place reading as a model of a base.
    if (this.base && this.base.dish) this.base.dish.rotation.y += dt * 0.55;
    updatePads(this.pads, this.t, weather.isNight);
    // Lighthouse sweeps.
    const on = weather.isNight || weather.cond.cloud > 0.75;
    this.lighthouseLamp.material.emissiveIntensity = on
      ? 1.2 + Math.max(0, Math.sin(this.t * 1.6)) * 3.2
      : 0.4;
    // Boats trundle along. They steer away before they run aground — without
    // this they sail happily up the nearest hillside, which is a very odd
    // thing to fly past.
    for (const b of this.boats) {
      const stepX = Math.cos(b.obj.rotation.y) * b.speed * dt;
      const stepZ = -Math.sin(b.obj.rotation.y) * b.speed * dt;
      // Look 220 m ahead; if that is land, turn away and try again next frame.
      const look = 220 / Math.max(b.speed * dt, 0.001);
      if (heightAt(b.obj.position.x + stepX * look, b.obj.position.z + stepZ * look) > -3) {
        b.obj.rotation.y += 0.9 * dt;
        continue;
      }
      b.obj.position.x += stepX;
      b.obj.position.z += stepZ;
      b.obj.rotation.z = Math.sin(this.t * 0.8 + b.phase) * 0.05 * (1 + weather.cond.turb);
      b.obj.position.y = Math.sin(this.t * 1.1 + b.phase) * 0.35 * (1 + weather.cond.turb);
    }
  }
}
