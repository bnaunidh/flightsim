import * as THREE from '../vendor/three.module.js';
import { makeModel, addBox, addCylinder, addPlane, addInstanced, makeMaterial,
  paintTexture, registerPart, finishModel, seedRandom, tubeBetween } from './common.js';

// Island scenery. Metres, +Y up, -Z forward. Canvas art is generated and cached.
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const materialColors = ['#b9b29c', '#a9b2a4', '#baab99', '#b6b4a8'];
function transform(position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) {
  return new THREE.Matrix4().compose(new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale));
}
function between(a, b, width = 1) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const delta = end.clone().sub(start);
  return new THREE.Matrix4().compose(start.add(end).multiplyScalar(.5),
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize()),
    new THREE.Vector3(width, delta.length(), width));
}
function mergeGeometry(pieces) {
  const positions = [], normals = [], uvs = [], indices = [];
  let offset = 0;
  for (const { geometry, matrix = new THREE.Matrix4(), uv = [0, 0, 1, 1] } of pieces) {
    const copy = geometry.clone().applyMatrix4(matrix);
    const p = copy.attributes.position, n = copy.attributes.normal, t = copy.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      uvs.push(uv[0] + t.getX(i) * uv[2], uv[1] + t.getY(i) * uv[3]);
    }
    if (copy.index) for (const i of copy.index.array) indices.push(offset + i);
    else for (let i = 0; i < p.count; i++) indices.push(offset + i);
    offset += p.count; copy.dispose();
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  result.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  result.setIndex(indices); result.computeBoundingSphere();
  return result;
}
function grain(ctx, w, h, seed, count = 900, light = false) {
  const random = seedRandom(seed);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = light ? `rgba(239,233,211,${.02 + random() * .055})` : `rgba(37,35,26,${.02 + random() * .065})`;
    ctx.fillRect(random() * w, random() * h, 1 + random() * 3, .4 + random() * 2);
  }
}
function barkTexture() {
  return paintTexture('scenery-bark-v1', 256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#746b56'; ctx.fillRect(0, 0, w, h);
    const random = seedRandom(271);
    for (let y = 0; y < h; y += 15) {
      ctx.strokeStyle = '#595646'; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(0, y); ctx.bezierCurveTo(w * .3, y + 6, w * .7, y - 4, w, y + 2); ctx.stroke();
      ctx.fillStyle = 'rgba(222,210,179,.13)'; ctx.fillRect(0, y + 3, w, 2);
    }
    for (let i = 0; i < 140; i++) {
      ctx.fillStyle = `rgba(36,39,29,${random() * .19})`;
      ctx.fillRect(random() * w, random() * h, 1, 12 + random() * 55);
    }
    grain(ctx, w, h, 81);
  });
}
function foliageTexture(kind, variant) {
  return paintTexture(`scenery-leaf-${kind}-${variant}-v1`, 256, 256, (ctx, w, h) => {
    const random = seedRandom(143 + variant * 37 + (kind === 'palm' ? 0 : 719));
    ctx.clearRect(0, 0, w, h);
    if (kind === 'palm') {
      ctx.strokeStyle = '#a7a474'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(128, 246); ctx.quadraticCurveTo(140, 125, 128, 5); ctx.stroke();
      for (let i = 0; i < 26; i++) {
        const y = 17 + i * 8.4, reach = Math.sin((i + 1) / 29 * Math.PI) * (80 + variant * 4);
        for (const side of [-1, 1]) {
          ctx.strokeStyle = ['#506b42', '#627647', '#708151', '#435f3b'][(i + variant) % 4];
          ctx.lineWidth = 5.5; ctx.beginPath(); ctx.moveTo(129, y + 5);
          ctx.quadraticCurveTo(128 + side * reach * .65, y - 8, 128 + side * reach, y - 19 - random() * 7); ctx.stroke();
        }
      }
    } else {
      ctx.fillStyle = '#4c613c'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 250; i++) {
        const a = random() * TAU, r = Math.sqrt(random()) * 105;
        ctx.fillStyle = ['#506441', '#5f7349', '#718156', '#3e5636'][i % 4];
        ctx.beginPath(); ctx.ellipse(128 + Math.cos(a) * r, 128 + Math.sin(a) * r * .95,
          6 + random() * 13, 5 + random() * 9, random() * 2, 0, TAU); ctx.fill();
      }
    }
  });
}
function treeImpostor(kind, variant) {
  return paintTexture(`scenery-tree-impostor-${kind}-${variant}-v2`, 512, 512, (ctx, w, h) => {
    const random = seedRandom(100 + variant * 31 + (kind === 'palm' ? 0 : 177));
    ctx.clearRect(0, 0, w, h);
    const bend = [-30, 23, 45, -15][variant], crownY = [123, 135, 108, 127][variant];
    ctx.strokeStyle = '#746b56'; ctx.lineWidth = kind === 'palm' ? 14 : 26;
    ctx.beginPath(); ctx.moveTo(256, 512); ctx.bezierCurveTo(244, 335, 256 + bend, 235, 256 + bend, crownY); ctx.stroke();
    if (kind === 'palm') {
      const n = 6 + variant;
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU + .18, ex = 256 + Math.cos(a) * (183 + random() * 30),
          ey = crownY + 50 + Math.sin(a) * 80;
        const cx = (256 + bend + ex) * .5, cy = crownY - 96 + Math.sin(a) * 26;
        ctx.strokeStyle = '#596d43'; ctx.lineWidth = 7; ctx.beginPath();
        ctx.moveTo(256 + bend, crownY); ctx.quadraticCurveTo(cx, cy, ex, ey); ctx.stroke();
        for (let j = 1; j < 17; j++) {
          const t = j / 17, u = 1 - t;
          const x = u * u * (256 + bend) + 2 * u * t * cx + t * t * ex;
          const y = u * u * crownY + 2 * u * t * cy + t * t * ey;
          ctx.strokeStyle = j % 3 ? '#50643e' : '#718153'; ctx.lineWidth = 3.5;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (ex - 256) * .045, y + Math.sin(t * Math.PI) * 30); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - (ex - 256) * .025, y - Math.sin(t * Math.PI) * 17); ctx.stroke();
        }
      }
    } else {
      for (let i = 0; i < 420; i++) {
        const a = random() * TAU, r = Math.sqrt(random()), x = 256 + Math.cos(a) * 165 * r,
          y = 160 + Math.sin(a) * (109 + variant * 9) * r;
        ctx.fillStyle = ['#516741', '#3f5939', '#637a4d', '#75855a'][i % 4];
        ctx.beginPath(); ctx.ellipse(x, y, 12 + random() * 18, 9 + random() * 13, random() * 3, 0, TAU); ctx.fill();
      }
    }
  });
}
function crossedQuads() {
  const plane = new THREE.PlaneGeometry(1, 1); plane.translate(0, .5, 0);
  const result = mergeGeometry([{ geometry: plane }, { geometry: plane, matrix: transform([0, 0, 0], [0, Math.PI / 2, 0]) }]);
  plane.dispose(); return result;
}
function treeTrunk(kind, variant) {
  const cyl = new THREE.CylinderGeometry(.019, .033, 1, 6, 1, true);
  const bend = [.08, -.045, .13, -.09][variant];
  const points = [[0, 0, 0], [bend * .28, .29, .012], [bend * .85, .58, -.018], [bend, kind === 'palm' ? .82 : .64, .015]];
  const pieces = [];
  for (let i = 0; i < 3; i++) pieces.push({ geometry: cyl, matrix: between(points[i], points[i + 1], 1 - i * .12) });
  if (kind !== 'palm') for (const side of [-1, 1]) pieces.push({ geometry: cyl, matrix: between(points[2], [side * .16, .75, -.025], .65) });
  const result = mergeGeometry(pieces); cyl.dispose(); return result;
}
function treeCrown(kind, variant) {
  const pieces = [], random = seedRandom(617 + variant * 47);
  if (kind === 'palm') {
    // Deform a four-segment PlaneGeometry for each contiguous curved frond.
    const count = 6 + variant, bend = [.08, -.045, .13, -.09][variant];
    for (let leaf = 0; leaf < count; leaf++) {
      const az = leaf / count * TAU + variant * .12, reach = .42 + random() * .06;
      const plane = new THREE.PlaneGeometry(.19, 1, 1, 4);
      const position = plane.attributes.position, uv = plane.attributes.uv;
      for (let i = 0; i < position.count; i++) {
        const t = 1 - uv.getY(i), r = t * reach, x = position.getX(i);
        uv.setY(i, t);
        const y = .82 + Math.sin(t * Math.PI) * .08 - t * t * .16;
        position.setXYZ(i, bend + Math.cos(az) * x + Math.sin(az) * r, y, .015 - Math.sin(az) * x + Math.cos(az) * r);
      }
      position.needsUpdate = true; plane.computeVertexNormals();
      pieces.push({ geometry: plane });
    }
    const result = mergeGeometry(pieces);
    for (const piece of pieces) piece.geometry.dispose();
    return result;
  }
  const sphere = new THREE.SphereGeometry(1, 7, 4);
  for (let lobe = 0; lobe < 4; lobe++) {
    const a = lobe * TAU / 3 + variant * .25, r = lobe === 3 ? 0 : .14;
    pieces.push({ geometry: sphere, matrix: transform([Math.cos(a) * r, .73 + (lobe === 3 ? .13 : 0), Math.sin(a) * r], [0, a, 0], [.23 + random() * .06, .18 + random() * .035, .22 + random() * .05]) });
  }
  const result = mergeGeometry(pieces); sphere.dispose(); return result;
}

/** A seeded clustered grove. update(dt,{cameraPosition}) or update(cameraPosition). */
export function createTreeGrove(options = {}) {
  const model = makeModel('Tree grove'), random = seedRandom(options.seed ?? 771);
  const count = clamp(Math.floor(options.count ?? 48), 0, 512), radius = Math.max(5, options.radius ?? 38);
  const height = Math.max(1, options.height ?? 9), nearDistance = Math.max(12, options.nearDistance ?? 110);
  const farDistance = Math.max(nearDistance + 20, options.farDistance ?? 1800);
  const palmFraction = clamp(options.palmFraction ?? .62, 0, 1);
  const terrain = typeof options.terrain === 'function' ? options.terrain : () => ({ height: 0, slope: 0, rock: false, gully: .4 });
  const clusters = Array.from({ length: Math.max(2, Math.min(8, Math.ceil(count / 10))) }, () => ({ x: (random() - .5) * radius * 1.5, z: (random() - .5) * radius * 1.5 }));
  const placements = [];
  for (let attempt = 0; placements.length < count && attempt < count * 35; attempt++) {
    const cluster = clusters[Math.floor(random() * clusters.length)];
    const a = random() * TAU, r = Math.sqrt(random()) * radius * .3;
    const x = cluster.x + Math.cos(a) * r, z = cluster.z + Math.sin(a) * r;
    if (x * x + z * z > radius * radius) continue;
    const sample = terrain(x, z), data = typeof sample === 'number' ? { height: sample } : sample;
    if (!data || !Number.isFinite(data.height) || data.rock || (data.slope ?? 0) > .75) continue;
    const density = clamp(.48 + (data.gully ?? 0) * .48 - (data.ridge ?? 0) * .6 - (data.slope ?? 0) * .3, .04, 1);
    if (random() > density || placements.some(p => Math.hypot(p.x - x, p.z - z) < 1.8)) continue;
    placements.push({ id: `tree-${placements.length + 1}`, x, y: data.height, z, kind: random() < palmFraction ? 'palm' : 'broadleaf', variant: Math.floor(random() * 4), height: height * (.72 + random() * .48), yaw: random() * TAU });
  }
  const bark = makeMaterial(model, { map: barkTexture(), roughness: .94 });
  const batches = [], lod = { near: 0, far: 0, culled: 0, total: placements.length };
  for (const kind of ['palm', 'broadleaf']) for (let variant = 0; variant < 4; variant++) {
    const members = placements.filter(p => p.kind === kind && p.variant === variant);
    if (!members.length) continue;
    const group = new THREE.Group(); group.name = `${kind} variant ${variant + 1} grove`; model.add(group);
    const matrices = members.map(p => transform([p.x, p.y, p.z], [0, p.yaw, 0], [p.height, p.height, p.height]));
    const leaves = makeMaterial(model, { map: foliageTexture(kind, variant), roughness: .98, alphaTest: kind === 'palm' ? .4 : .18, side: THREE.DoubleSide });
    const impostor = makeMaterial(model, { map: treeImpostor(kind, variant), roughness: 1, alphaTest: .38, side: THREE.DoubleSide });
    const trunk = addInstanced(model, group, `${kind} trunks ${variant}`, treeTrunk(kind, variant), bark, matrices);
    const crown = addInstanced(model, group, `${kind} crowns ${variant}`, treeCrown(kind, variant), leaves, matrices);
    const far = addInstanced(model, group, `${kind} distant silhouettes ${variant}`, crossedQuads(), impostor, matrices);
    far.count = 0;
    for (const mesh of [trunk, crown, far]) { mesh.frustumCulled = false; mesh.castShadow = mesh !== far; mesh.receiveShadow = true; }
    const partId = `grove-${kind}-${variant + 1}`;
    registerPart(model, partId, `${kind === 'palm' ? 'Palm' : 'Broadleaf'} grove · silhouette ${variant + 1}`, [group], { massKg: members.length * 140 });
    batches.push({ members, matrices, trunk, crown, far, partId });
  }
  const world = new THREE.Vector3(), localCamera = new THREE.Vector3();
  function updateLOD(cameraPosition) {
    if (!cameraPosition || !Number.isFinite(cameraPosition.x) || !Number.isFinite(cameraPosition.y) || !Number.isFinite(cameraPosition.z)) return;
    model.updateWorldMatrix(true, false); localCamera.copy(cameraPosition); model.worldToLocal(localCamera);
    // Account for ordinary uniform scene scaling. Trees retain their metre-based thresholds.
    model.getWorldScale(world); const sceneScale = Math.max(Math.abs(world.x), Math.abs(world.y), Math.abs(world.z));
    lod.near = lod.far = lod.culled = 0;
    for (const batch of batches) {
      let near = 0, far = 0; const nearIds = [], farIds = [];
      if (!batch.trunk.parent.visible) continue;
      batch.members.forEach((p, i) => {
        const distance = localCamera.distanceTo(world.set(p.x, p.y + p.height * .5, p.z)) * sceneScale;
        if (distance < nearDistance) {
          batch.trunk.setMatrixAt(near, batch.matrices[i]); batch.crown.setMatrixAt(near++, batch.matrices[i]); nearIds.push(p.id);
        } else if (distance < farDistance) { batch.far.setMatrixAt(far++, batch.matrices[i]); farIds.push(p.id); }
        else lod.culled++;
      });
      batch.trunk.count = batch.crown.count = near; batch.far.count = far;
      batch.trunk.userData.treeIds = batch.crown.userData.treeIds = nearIds; batch.far.userData.treeIds = farIds;
      for (const mesh of [batch.trunk, batch.crown, batch.far]) mesh.instanceMatrix.needsUpdate = true;
      lod.near += near; lod.far += far;
    }
  }
  Object.assign(model.userData, { placements, treeBatches: batches, lod, updateLOD, nearDistance, farDistance,
    damageGranularity: 'One species/variant grove assembly; instance-to-tree IDs exposed for a game-specific per-tree collision adapter.' });
  finishModel(model, { update: (dt, state = {}) => updateLOD(state.cameraPosition), reset: () => updateLOD(new THREE.Vector3()) });
  const standardUpdate = model.userData.update;
  model.userData.update = (dtOrCamera, state = {}) => {
    if (dtOrCamera && typeof dtOrCamera === 'object' && Number.isFinite(dtOrCamera.x)) return updateLOD(dtOrCamera);
    return standardUpdate(dtOrCamera, state);
  };
  updateLOD(new THREE.Vector3());
  return model;
}

function facadeTexture(variant, timber = false) {
  return paintTexture(`scenery-facade-${variant}-${timber}-v2`, 512, 512, (ctx, w, h) => {
    ctx.fillStyle = materialColors[variant % 4]; ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 501 + variant, 2200);
    ctx.strokeStyle = timber ? 'rgba(53,48,33,.24)' : 'rgba(54,53,43,.1)'; ctx.lineWidth = 1;
    for (let y = 12; y < h; y += timber ? 22 : 38) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      if (!timber) for (let x = (Math.floor(y / 38) % 2) * 50; x < w; x += 100) { ctx.beginPath(); ctx.moveTo(x, y - 38); ctx.lineTo(x, y); ctx.stroke(); }
    }
    ctx.fillStyle = '#8a8371'; ctx.fillRect(0, h - 29, w, 29);
    for (const x of [67, 326]) {
      ctx.fillStyle = '#ded9c8'; ctx.fillRect(x - 10, 116, 128, 180);
      const g = ctx.createLinearGradient(0, 122, 0, 282); g.addColorStop(0, '#617477'); g.addColorStop(.48, '#425658'); g.addColorStop(.53, '#768581'); g.addColorStop(1, '#344244');
      ctx.fillStyle = g; ctx.fillRect(x, 126, 108, 151);
      ctx.fillStyle = '#cdc9b9'; ctx.fillRect(x + 51, 126, 6, 151); ctx.fillRect(x, 204, 108, 5);
      ctx.fillStyle = '#5d6756'; ctx.fillRect(x - 18, 121, 9, 159); ctx.fillRect(x + 117, 121, 9, 159);
      ctx.fillStyle = 'rgba(20,24,18,.2)'; ctx.fillRect(x - 11, 291, 128, 7);
    }
    ctx.fillStyle = '#575649'; ctx.fillRect(222, 284, 72, 199);
    ctx.fillStyle = '#7b7864'; ctx.fillRect(230, 297, 55, 176);
    ctx.strokeStyle = '#4d5044'; ctx.strokeRect(237, 308, 42, 69); ctx.strokeRect(237, 389, 42, 72);
    ctx.fillStyle = '#c5b78a'; ctx.fillRect(277, 383, 4, 13);
    for (let x = 0; x < w; x += 17) { ctx.fillStyle = 'rgba(38,45,29,.07)'; ctx.fillRect(x, 472 + (x % 9), 3, 35); }
  });
}
function roofTexture(variant = 0, thatch = false) {
  return paintTexture(`scenery-roof-${variant}-${thatch}-v1`, 512, 512, (ctx, w, h) => {
    ctx.fillStyle = thatch ? '#82765a' : ['#80675a', '#686d66', '#857466', '#686b68'][variant % 4]; ctx.fillRect(0, 0, w, h);
    const random = seedRandom(914 + variant);
    if (thatch) {
      for (let i = 0; i < 1700; i++) {
        const x = random() * w, y = random() * h;
        ctx.strokeStyle = i % 3 ? 'rgba(41,42,28,.15)' : 'rgba(213,197,147,.24)';
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + random() * 5, y + 16 + random() * 54); ctx.stroke();
      }
    } else for (let y = 0; y < h; y += 32) {
      ctx.fillStyle = 'rgba(28,30,27,.25)'; ctx.fillRect(0, y, w, 3);
      for (let x = (y / 32 % 2) * 24; x < w; x += 48) {
        ctx.fillStyle = 'rgba(204,196,175,.14)'; ctx.fillRect(x + 2, y + 4, 3, 27);
        ctx.fillStyle = 'rgba(25,31,27,.19)'; ctx.fillRect(x + 45, y + 3, 2, 28);
      }
    }
    grain(ctx, w, h, 116 + variant, 1100, true);
  });
}
function roofGeometry(hipped = false) {
  // Collapse a BoxGeometry's upper corners into a pitched or hipped ridge.
  const g = new THREE.BoxGeometry(1, 1, 1), position = g.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const upper = position.getY(i) > 0;
    position.setXYZ(i, upper ? 0 : position.getX(i), upper ? 1 : 0,
      position.getZ(i) * (upper && hipped ? .46 : 1));
  }
  // Remove the hidden underside and collapsed zero-area primitive triangles.
  const keep = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < g.index.count; i += 3) {
    const ia = g.index.getX(i), ib = g.index.getX(i + 1), ic = g.index.getX(i + 2);
    a.fromBufferAttribute(position, ia); b.fromBufferAttribute(position, ib); c.fromBufferAttribute(position, ic);
    if (a.y + b.y + c.y === 0) continue;
    if (b.sub(a).cross(c.sub(a)).lengthSq() > 1e-12) keep.push(ia, ib, ic);
  }
  g.setIndex(keep); g.clearGroups(); position.needsUpdate = true; g.computeVertexNormals(); return g;
}
function buildingMaterials(model, timber = false) {
  return {
    walls: Array.from({ length: 4 }, (_, i) => makeMaterial(model, { map: facadeTexture(i, timber), roughness: .88, metalness: .01 })),
    roofs: Array.from({ length: 4 }, (_, i) => makeMaterial(model, { map: roofTexture(i, timber), roughness: .95 })),
    wood: makeMaterial(model, { color: '#706b58', map: barkTexture(), roughness: .92 }),
    stone: makeMaterial(model, { color: '#929384', roughness: .98 }),
    pale: makeMaterial(model, { color: '#c6c4b3', roughness: .92 }),
  };
}
function boxBatch(model, parent, name, material, matrices) {
  return addInstanced(model, parent, name, new THREE.BoxGeometry(1, 1, 1), material, matrices);
}
function buildHouse(model, materials, { id, x, z, y = 0, width = 6, depth = 7, height = 3, yaw = 0, variant = 0, type = 'cottage', veranda = false }) {
  const group = new THREE.Group(); group.name = id; group.position.set(x, y, z); group.rotation.y = yaw; model.add(group);
  const wings = [[0, height * .5, 0, width, height, depth]];
  if (type === 'courtyard') wings.push([width * .66, height * .5, depth * .26, width * .34, height, depth * 1.5]);
  const walls = wings.map(([a, b, c, w, h, d]) => transform([a, b, c], [0, 0, 0], [w, h, d]));
  boxBatch(model, group, `${id} rendered walls`, materials.walls[variant], walls);
  const ridgeHeight = type === 'terrace' ? height * .27 : height * .45;
  const roofs = wings.map(([a, b, c, w, h, d]) => transform([a, h, c], [0, 0, 0], [w + .5, ridgeHeight, d + .6]));
  addInstanced(model, group, `${id} pitched roof`, roofGeometry(type === 'hipped' || type === 'courtyard'), materials.roofs[variant], roofs);
  const structural = [];
  if (veranda || type === 'terrace') {
    const frontZ = -depth * .5 - 1.05;
    structural.push(transform([0, .12, frontZ], [0, 0, 0], [width + .35, .24, 2.25]));
    for (const side of [-1, 1]) structural.push(transform([side * (width * .5 - .15), height * .4, frontZ - .8], [0, 0, 0], [.14, height * .8, .14]));
    structural.push(transform([0, height * .8, frontZ], [.1, 0, 0], [width + .45, .12, 2.5]));
    if (type === 'terrace') {
      structural.push(transform([0, height * .48, frontZ], [0, 0, 0], [width + .35, .15, 2.2]));
      structural.push(transform([0, height * .48 + .85, frontZ - 1], [0, 0, 0], [width + .3, .08, .08]));
      for (let i = 0; i < 6; i++) structural.push(transform([-width * .5 + i * width / 5, height * .48 + .43, frontZ - 1], [0, 0, 0], [.055, .85, .055]));
    }
  }
  if (structural.length) boxBatch(model, group, `${id} veranda and balcony`, materials.wood, structural);
  if (type !== 'hut') boxBatch(model, group, `${id} chimney`, materials.stone, [transform([width * .25, height + ridgeHeight * .68, depth * .23], [0, 0, 0], [.65, 1.65, .65])]);
  registerPart(model, id, `${type === 'hut' ? 'Village hut' : type[0].toUpperCase() + type.slice(1)} ${id.match(/\d+/)?.[0] ?? ''}`.trim(), [group], { massKg: width * depth * height * 105 });
  return { id, group, width, depth, height: height + ridgeHeight, type };
}
function groundMaterial(model, key = 'sand') {
  return makeMaterial(model, { map: paintTexture(`scenery-ground-${key}`, 512, 512, (ctx, w, h) => {
    ctx.fillStyle = key === 'road' ? '#77796f' : key === 'grass' ? '#858d68' : '#b3aa8d'; ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 815, 3200, true); grain(ctx, w, h, 927, 2000);
    if (key === 'road') { ctx.fillStyle = '#b3b3a0'; for (let x = 0; x < w; x += 80) ctx.fillRect(x, h * .49, 42, 3); }
  }), roughness: 1 });
}
function pathSegments(model, parent, points, width, material, name = 'path') {
  const matrices = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = new THREE.Vector3(...points[i]), b = new THREE.Vector3(...points[i + 1]), delta = b.clone().sub(a);
    matrices.push(transform(a.add(b).multiplyScalar(.5).toArray(), [-Math.PI / 2, 0, -Math.atan2(delta.z, delta.x)], [delta.length() + .2, width, 1]));
  }
  return addInstanced(model, parent, name, new THREE.PlaneGeometry(1, 1), material, matrices);
}
function buildJetty(model, materials, position = [0, 0, -44]) {
  const group = new THREE.Group(); group.name = 'Village timber jetty'; group.position.set(...position); model.add(group);
  boxBatch(model, group, 'Jetty deck boards', materials.wood, Array.from({ length: 15 }, (_, i) => transform([0, .55, -i * .85], [0, 0, 0], [3.5, .15, .79])));
  const posts = [];
  for (let i = 0; i < 4; i++) for (const side of [-1, 1]) posts.push(transform([side * 1.4, -.25, -i * 3.7], [0, 0, 0], [.22, 2.3, .22]));
  addInstanced(model, group, 'Jetty pilings', new THREE.CylinderGeometry(.5, .5, 1, 5), materials.wood, posts);
  registerPart(model, 'village-jetty', 'Timber jetty and pilings', [group], { massKg: 1800 });
  return group;
}
function washingLine(model, materials, position, index) {
  const group = new THREE.Group(); group.position.set(...position); group.rotation.y = index * .72; model.add(group);
  boxBatch(model, group, 'Washing line posts', materials.wood, [transform([-3, 1.25, 0], [0, 0, 0], [.1, 2.5, .1]), transform([3, 1.25, 0], [0, 0, 0], [.1, 2.5, .1])]);
  const ropes = [];
  for (let i = 0; i < 4; i++) ropes.push(between([-3 + i * 1.5, 2.4 - Math.sin(i / 4 * Math.PI) * .19, 0], [-1.5 + i * 1.5, 2.4 - Math.sin((i + 1) / 4 * Math.PI) * .19, 0], .017));
  addInstanced(model, group, 'Washing line rope', new THREE.CylinderGeometry(.5, .5, 1, 4), materials.wood, ropes);
  const clothMat = makeMaterial(model, { color: ['#b7b8a6', '#798f91', '#ae957f'][index % 3], side: THREE.DoubleSide, roughness: 1 });
  const cloth = addInstanced(model, group, 'Hanging blankets', new THREE.PlaneGeometry(1, 1), clothMat,
    [-1.75, -.4, 1.12].map((x, i) => transform([x, 1.75 + i * .035, .01], [0, 0, .03 * (i - 1)], [.85, .95, 1])));
  registerPart(model, `washing-line-${index + 1}`, `Washing line ${index + 1}`, [group], { massKg: 28 });
  return { group, cloth };
}

/** Fourteen individually named huts along two irregular paths, shared square and jetty. */
export function createVillage(options = {}) {
  const model = makeModel('Mango Cay village'), materials = buildingMaterials(model, true), random = seedRandom(options.seed ?? 318);
  const count = clamp(Math.floor(options.count ?? 14), 12, 15), buildings = [];
  const ground = addPlane(model, model, 'Village common ground', 103, 108, [0, -.035, -3], groundMaterial(model, 'grass')); ground.rotation.x = -Math.PI / 2;
  const mainPath = [[-40, .01, 23], [-27, .01, 15], [-14, .01, 4], [0, .01, 0], [13, .01, -7], [29, .01, -13], [40, .01, -24]];
  pathSegments(model, model, mainPath, 3.6, groundMaterial(model), 'Curving village path');
  pathSegments(model, model, [[0, .015, 0], [-4, .015, -16], [2, .015, -31], [0, .015, -44]], 2.8, groundMaterial(model), 'Footpath to jetty');
  const square = addCylinder(model, model, 'Shared central clearing', 8, 8, .02, 12, [0, .015, 0], groundMaterial(model));
  const slots = [[-35, 9], [-27, 27], [-20, -1], [-12, 17], [3, 16], [15, 10], [22, -23], [33, -3], [38, -31], [-18, -20], [11, -28], [-15, -36], [15, -43], [-36, -12], [35, 14]];
  for (let i = 0; i < count; i++) {
    const [sx, sz] = slots[i], width = 4.9 + random() * 2.1, depth = 5.6 + random() * 2.5;
    buildings.push(buildHouse(model, materials, { id: `village-hut-${i + 1}`, x: sx + (random() - .5) * 2, z: sz + (random() - .5) * 2, width, depth, height: 2.3 + random() * .7, yaw: Math.atan2(-sx * .05, -sz * .05) + (random() - .5) * .6, variant: i % 4, type: 'hut', veranda: i % 3 !== 1 }));
  }
  const lines = [washingLine(model, materials, [-23, 0, -9], 0), washingLine(model, materials, [21, 0, -35], 1)];
  const jetty = buildJetty(model, materials);
  // Community benches are one repeated batch with an identifiable breakaway assembly.
  const benches = new THREE.Group(); model.add(benches);
  const pieces = [];
  for (const z of [-4.8, 4.8]) {
    pieces.push(transform([0, .55, z], [0, 0, 0], [3, .13, .65]));
    for (const x of [-1.1, 1.1]) pieces.push(transform([x, .25, z], [0, 0, 0], [.14, .5, .5]));
  }
  boxBatch(model, benches, 'Village square benches', materials.wood, pieces);
  registerPart(model, 'village-square-benches', 'Shared square benches', [benches], { massKg: 70 });
  Object.assign(model.userData, { buildings, washingLines: lines, jetty });
  let elapsed = 0;
  return finishModel(model, { update: (dt, state = {}) => {
    elapsed += dt; const strength = clamp(state.windSpeed ?? 3, 0, 20) / 20;
    for (const { group, cloth } of lines) if (group.visible) cloth.rotation.x = Math.sin(elapsed * 1.8) * strength * .15;
  }, reset: () => { elapsed = 0; for (const { cloth } of lines) cloth.rotation.x = 0; } });
}

/** Four residential archetypes and a church around legible streets and courtyards. */
export function createTown(options = {}) {
  const model = makeModel('Kestrel island town'), materials = buildingMaterials(model), random = seedRandom(options.seed ?? 1123);
  const base = addPlane(model, model, 'Town ground', 154, 132, [0, -.035, 0], groundMaterial(model, 'grass')); base.rotation.x = -Math.PI / 2;
  const roads = groundMaterial(model, 'road'), pavement = makeMaterial(model, { color: '#b2b1a2', roughness: .98 });
  pathSegments(model, model, [[-76, .02, 0], [76, .02, 0]], 8, roads, 'Main street');
  pathSegments(model, model, [[0, .023, -64], [0, .023, 64]], 7, roads, 'Church street');
  pathSegments(model, model, [[-71, .018, -42], [66, .018, -42]], 5, roads, 'Market lane');
  const sidewalks = boxBatch(model, model, 'Street pavements', pavement, [transform([0, .07, -5], [0, 0, 0], [152, .14, 1.6]), transform([0, .07, 5], [0, 0, 0], [152, .14, 1.6]), transform([-4.4, .07, 0], [0, 0, 0], [1.4, .14, 128]), transform([4.4, .07, 0], [0, 0, 0], [1.4, .14, 128])]);
  const buildings = [], types = ['cottage', 'hipped', 'courtyard', 'terrace'];
  const slots = [[-58, 18], [-35, 17], [-17, 19], [17, 19], [40, 17], [62, 21], [-58, -19], [-34, -18], [-16, -22], [18, -21], [43, -21], [63, -22], [-50, 48], [-22, 46], [24, 47], [58, 48]];
  const count = clamp(Math.floor(options.count ?? 16), 8, 24);
  for (let i = 0; i < count; i++) {
    const [x, z] = slots[i % slots.length], type = types[i % 4];
    const isTerrace = type === 'terrace';
    buildings.push(buildHouse(model, materials, { id: `town-building-${i + 1}`, x: x + (random() - .5), z: z + (i >= slots.length ? -73 : 0), width: isTerrace ? 13 : 7 + random() * 3, depth: 8 + random() * 3, height: isTerrace ? 7.3 : 4 + random() * 1.4, yaw: z > 0 ? 0 : Math.PI, variant: Math.floor(random() * 4), type, veranda: type === 'cottage' && i % 2 === 0 }));
  }
  const church = new THREE.Group(); church.name = 'St Kestrel church'; church.position.set(29, 0, -53); model.add(church);
  const churchWall = makeMaterial(model, { roughness: .94, map: paintTexture('scenery-church-stone-v1', 512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#c1bfad'; ctx.fillRect(0, 0, w, h); grain(ctx, w, h, 936, 2800);
    ctx.strokeStyle = 'rgba(75,74,58,.13)'; ctx.lineWidth = 1;
    for (let y = 0; y < h; y += 25) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      for (let x = (y / 25 % 2) * 42; x < w; x += 84) { ctx.beginPath(); ctx.moveTo(x, y - 25); ctx.lineTo(x, y); ctx.stroke(); }
    }
    ctx.fillStyle = '#a5a58f'; ctx.fillRect(0, 455, w, 57);
    for (const x of [76, 256, 436]) {
      ctx.fillStyle = '#d4d0bc'; ctx.fillRect(x - 26, 202, 52, 151);
      ctx.beginPath(); ctx.arc(x, 202, 26, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#465855'; ctx.fillRect(x - 17, 202, 34, 137);
      ctx.beginPath(); ctx.arc(x, 202, 17, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#b3b4a4'; ctx.fillRect(x - 2, 190, 4, 149); ctx.fillRect(x - 17, 263, 34, 3);
    }
    ctx.fillStyle = 'rgba(89,91,67,.18)'; ctx.fillRect(0, 493, w, 19);
  }) });
  boxBatch(model, church, 'Church nave and tower', churchWall, [transform([0, 4.2, 0], [0, 0, 0], [10, 8.4, 18]), transform([0, 7, -10.8], [0, 0, 0], [4.7, 14, 4.7])]);
  addInstanced(model, church, 'Church steep roofs', roofGeometry(), materials.roofs[1], [transform([0, 8.4, 0], [0, 0, 0], [10.8, 4.5, 18.5])]);
  const spire = addInstanced(model, church, 'Church spire', new THREE.ConeGeometry(3.65, 8, 4), materials.roofs[1], [transform([0, 18, -10.8], [0, Math.PI / 4, 0])]);
  const clockTex = paintTexture('scenery-church-clock', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#d9d6c6'; ctx.beginPath(); ctx.arc(128, 128, 114, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#424b46'; ctx.lineWidth = 9; ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * TAU; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(128 + Math.sin(a) * 87, 128 - Math.cos(a) * 87); ctx.lineTo(128 + Math.sin(a) * 102, 128 - Math.cos(a) * 102); ctx.stroke();
    }
    ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(88, 105); ctx.lineTo(128, 128); ctx.lineTo(128, 48); ctx.stroke();
  });
  const clock = addPlane(model, church, 'Clock face', 2.25, 2.25, [0, 11.5, -13.18], makeMaterial(model, { map: clockTex, alphaTest: .4, roughness: .85 })); clock.rotation.y = Math.PI;
  registerPart(model, 'town-church', 'Church landmark, nave and spire', [church], { massKg: 145000 });
  Object.assign(model.userData, { buildings, church, sidewalks, spire, landmark: { id: 'town-church', label: 'St Kestrel church' } });
  return finishModel(model);
}

function fieldTexture(crop, bump = false) {
  return paintTexture(`scenery-field-${crop}-${bump}-v2`, 512, 512, (ctx, w, h) => {
    const random = seedRandom(402 + crop * 17);
    ctx.fillStyle = bump ? '#777777' : ['#85905b', '#a69d69', '#6b7f50', '#91765a'][crop]; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 17) {
      ctx.fillStyle = bump ? '#515151' : 'rgba(47,49,28,.45)'; ctx.fillRect(0, y, w, 4);
      ctx.fillStyle = bump ? '#b0b0b0' : 'rgba(210,205,152,.17)'; ctx.fillRect(0, y + 5, w, 5);
      if (!bump) for (let x = 0; x < w; x += 7) {
        ctx.fillStyle = crop === 3 ? 'rgba(166,138,94,.45)' : ['#a4aa73', '#c1b97f', '#819c5d'][crop];
        ctx.fillRect(x + random() * 3, y + 7 + random() * 3, 2 + random() * 3, 3);
      }
    }
    if (!bump) {
      ctx.fillStyle = 'rgba(49,45,32,.22)'; ctx.fillRect(0, h * .24, w, 2); ctx.fillRect(0, h * .29, w, 2);
      grain(ctx, w, h, 434 + crop, 1800, true);
    }
  }, { srgb: !bump });
}

/** Crop rows live in texture UVs; each field can rotate independently. */
export function createFields(options = {}) {
  const model = makeModel('Cultivated island fields'), random = seedRandom(options.seed ?? 401);
  const plots = options.plots ?? [
    { x: -25, z: -22, width: 43, depth: 35, crop: 0, rowDirection: .06 },
    { x: 25, z: -22, width: 42, depth: 34, crop: 1, rowDirection: .06 },
    { x: -27, z: 20, width: 38, depth: 38, crop: 2, rowDirection: -.04 },
    { x: 18, z: 20, width: 43, depth: 37, crop: 3, rowDirection: -.04 },
  ];
  const materials = Array.from({ length: 4 }, (_, crop) => makeMaterial(model, { map: fieldTexture(crop), bumpMap: fieldTexture(crop, true), bumpScale: .045, roughness: .98 }));
  const borders = makeMaterial(model, { color: '#9a9479', roughness: 1 });
  const safePlots = plots.slice(0, 48);
  safePlots.forEach((plot, i) => {
    const width = Math.max(2, plot.width ?? 35), depth = Math.max(2, plot.depth ?? 35), crop = clamp(Math.floor(plot.crop ?? i % 4), 0, 3);
    const group = new THREE.Group(); group.name = `Field ${i + 1}`; group.position.set(plot.x ?? 0, plot.y ?? 0, plot.z ?? 0); group.rotation.y = plot.rowDirection ?? random() * .2; model.add(group);
    addInstanced(model, group, 'Furrowed crop surface', new THREE.PlaneGeometry(1, 1), materials[crop], [transform([0, .014, 0], [-Math.PI / 2, 0, 0], [width, depth, 1])]);
    boxBatch(model, group, 'Field headlands', borders, [transform([0, .025, -depth * .5], [0, 0, 0], [width + 1, .05, .9]), transform([0, .025, depth * .5], [0, 0, 0], [width + 1, .05, .9]), transform([-width * .5, .025, 0], [0, 0, 0], [.9, .05, depth]), transform([width * .5, .025, 0], [0, 0, 0], [.9, .05, depth])]);
    // The terrain surface is not a detachable aircraft part. Field boundary structures are.
    registerPart(model, `field-${i + 1}-boundary`, `Field ${i + 1} boundary banks`, [group.children[1]], { massKg: (width + depth) * 40 });
  });
  model.userData.plots = safePlots.map(p => ({ ...p }));
  return finishModel(model);
}

/** UV-painted readable text. A real name is the default, and blank text is rejected. */
export function createTextSign(options = {}) {
  const text = String(options.text ?? 'KESTREL ISLAND AIRPORT').trim();
  if (!text) throw new TypeError('Sign text must contain readable characters.');
  const width = Math.max(.35, options.width ?? 12), height = Math.max(.2, options.height ?? 1.7), bg = options.background ?? '#243e45', color = options.color ?? '#e7e5d6';
  const model = makeModel(`Sign: ${text}`), pixelWidth = 1024, pixelHeight = Math.max(128, Math.min(512, Math.round(1024 * height / width)));
  const texture = paintTexture(`scenery-sign-v2-${text}-${bg}-${color}-${pixelHeight}`, pixelWidth, pixelHeight, (ctx, w, h) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, h * .018); ctx.strokeRect(w * .016, h * .09, w * .968, h * .82);
    let size = h * .5; ctx.font = `600 ${size}px Arial, sans-serif`;
    while (ctx.measureText(text).width > w * .9 && size > 10) { size -= 1; ctx.font = `600 ${size}px Arial, sans-serif`; }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(text, w * .5, h * .53);
    grain(ctx, w, h, text.length * 173, 450);
  });
  const frameMat = makeMaterial(model, { color: '#596465', metalness: .55, roughness: .55 });
  const faceMat = makeMaterial(model, { map: texture, roughness: .7, metalness: .1 });
  const board = new THREE.Group(); board.name = 'Nameboard assembly'; model.add(board);
  const centerY = options.postHeight === 0 ? height * .5 : (options.postHeight ?? 2.5) + height * .5;
  addBox(model, board, 'Sign metal backing', [width + .08, height + .08, .12], [0, centerY, 0], frameMat);
  const face = addPlane(model, board, 'Readable nameboard', width, height, [0, centerY, -.067], faceMat); face.rotation.y = Math.PI;
  registerPart(model, 'sign-board', `Nameboard: ${text}`, [board], { massKg: width * height * 6 });
  if (options.postHeight !== 0) {
    const posts = boxBatch(model, model, 'Nameboard support posts', frameMat, [-1, 1].map(side => transform([side * width * .36, centerY * .5, .015], [0, 0, 0], [.1, centerY, .1])));
    registerPart(model, 'sign-posts', 'Nameboard support posts', [posts], { massKg: centerY * 8 });
  }
  model.userData.text = text; return finishModel(model);
}
export function createTerminalNameboard(options = {}) {
  return createTextSign({ text: 'KESTREL ISLAND AIRPORT', width: 24, height: 2.6, postHeight: 0, ...options });
}
export function createStandNumber(options = {}) {
  return createTextSign({ text: `STAND ${options.number ?? '04'}`, width: 1.8, height: .75, postHeight: .85, background: '#c4b267', color: '#252c27', ...options });
}

export const previewModels = [
  { id: 'tree-grove', label: 'Clustered palms and broadleaf trees', create: () => createTreeGrove({ count: 32, radius: 25, height: 9, nearDistance: 600 }), damagePart: 'grove-palm-1' },
  { id: 'village', label: 'Mango Cay village, jetty and washing lines', create: () => createVillage(), damagePart: 'village-hut-4' },
  { id: 'town', label: 'Island town and church landmark', create: () => createTown(), damagePart: 'town-building-4' },
  { id: 'fields', label: 'Cultivated fields with furrows and crop variation', create: () => createFields(), damagePart: 'field-1-boundary' },
  { id: 'terminal-sign', label: 'Readable terminal nameboard', create: () => createTerminalNameboard(), damagePart: 'sign-board' },
  { id: 'stand-sign', label: 'Readable stand number', create: () => createStandNumber(), damagePart: 'sign-board' },
];
