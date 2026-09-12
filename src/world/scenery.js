/**
 * Scenery: palm groves, the island town, Mango Cay village with its delivery
 * pad, a lighthouse landmark on Needle Rock and a couple of fishing boats.
 *
 * Everything is instanced or built from primitives so the whole island costs
 * only a handful of draw calls.
 */

import * as THREE from '../vendor/three.module.js';
import { heightAt, scatter, MAP, ISLANDS, addObstacleAt } from './terrain.js';
import { treeTexture, buildingTexture, roofTexture, foamTexture } from '../render/textures.js';

export const DELIVERY_PAD = new THREE.Vector3(6200, 0, -5200);

function treeGeometry() {
  // Two crossed quads: reads as a 3D tree from any angle, costs 4 triangles.
  const g1 = new THREE.PlaneGeometry(1, 1);
  g1.translate(0, 0.5, 0);
  const g2 = g1.clone();
  g2.rotateY(Math.PI / 2);
  const merged = new THREE.BufferGeometry();
  const pos = [];
  const uv = [];
  const norm = [];
  const idx = [];
  let offset = 0;
  for (const g of [g1, g2]) {
    const p = g.attributes.position.array;
    const u = g.attributes.uv.array;
    const n = g.attributes.normal.array;
    pos.push(...p);
    uv.push(...u);
    norm.push(...n);
    for (const i of g.index.array) idx.push(i + offset);
    offset += g.attributes.position.count;
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  merged.setIndex(idx);
  return merged;
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
    const mat = new THREE.MeshStandardMaterial({
      map: treeTexture(kind),
      transparent: false,
      alphaTest: 0.42,
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    const inst = new THREE.InstancedMesh(treeGeometry(), mat, list.length);
    inst.castShadow = true;
    inst.receiveShadow = false;
    // The scrub is low and wide; the conifer is tall and narrow.
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
      d.scale.set(h * shape.w, h, h * shape.w);
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

function buildBoats(group, count) {
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
    let bx = -1400 - i * 900;
    let bz = 1800 + i * 1400;
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
    this.boats = buildBoats(this.group, cfg.boats);

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
