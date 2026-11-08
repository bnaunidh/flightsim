/**
 * SIGNAL ZERO — small sets the chapters stand in the world.
 *
 * Props a chapter puts down and takes away again, built from primitives and
 * painted in code like everything else:
 *
 *   buildLookout()       a fire lookout: a raised helipad deck you can land
 *                        on (a terrain platform, the same mechanism as a rig
 *                        deck or a hospital roof — world/pads.js) and the
 *                        lookout's cabin on its stilts beside it, solid;
 *   buildSurveyMarker()  a concrete survey post with a brass disc (the
 *                        Kittiwake Files' "1986 survey point");
 *   buildCase()          a contractor's equipment case in Thornefield's grey
 *                        and teal, the mark on its lid and sides.
 *
 * Each returns { group, …, dispose() }. dispose() takes the platform and the
 * obstacle back out of the world's lists, so a chapter that ends — or fails,
 * or is quit — leaves nothing to land on or fly into.
 */

import * as THREE from '../vendor/three.module.js';
import { heightAt, addPlatform, addObstacleAt, PLATFORMS, OBSTACLES } from '../world/terrain.js';
import { decalTexture, KITTIWAKE, THORNEFIELD, paintThornefield } from './brands.js';

function groundMax(x, z, r) {
  let m = -Infinity;
  for (let a = 0; a < 12; a++) {
    const ang = (a / 12) * Math.PI * 2;
    for (const k of [0.4, 1]) m = Math.max(m, heightAt(x + Math.sin(ang) * r * k, z - Math.cos(ang) * r * k));
  }
  return Math.max(m, heightAt(x, z));
}

function padFace() {
  return decalTexture(256, 256, (g, W, H) => {
    g.fillStyle = '#8d8f8a';
    g.beginPath();
    g.arc(W / 2, H / 2, W * 0.49, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#f2c230';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(W / 2, H / 2, W * 0.42, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#f4f4f0';
    const s = W * 0.2;
    g.fillRect(W / 2 - s, H / 2 - s, s * 0.32, s * 2);
    g.fillRect(W / 2 + s * 0.68, H / 2 - s, s * 0.32, s * 2);
    g.fillRect(W / 2 - s, H / 2 - s * 0.16, s * 2, s * 0.32);
  });
}

/**
 * A lookout on a ridge: the pad at (x, z), its cabin `cabin.dist` metres off
 * on bearing `cabin.bearing` (degrees). Heights come from the ground: the
 * deck sits on the highest rock inside its footprint, like a stack pad.
 *
 * Returns { group, pad: {x, y, z, r, name}, cabin: {x, y, z}, door: {x, y, z}, dispose }.
 */
export function buildLookout(scene, { x, z, r = 9, name = 'Lookout pad', cabin = { bearing: 0, dist: 22 } } = {}) {
  const group = new THREE.Group();
  group.name = 'story:lookout';
  const geos = [];
  const mats = [];
  const texs = [];
  const y = groundMax(x, z, r) + 0.9;
  const platform = { cx: x, cz: z, w: r * 2, d: r * 2, y };
  addPlatform(x, z, r * 2, r * 2, y, name);
  const plat = PLATFORMS[PLATFORMS.length - 1];

  // The deck: a painted disc on a slab, on three legs cut to the rock.
  const face = padFace();
  if (face) texs.push(face);
  const deckMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: face, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const slabMat = new THREE.MeshStandardMaterial({ color: 0x6f716c, roughness: 0.95 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x7b8087, roughness: 0.7, metalness: 0.35 });
  mats.push(deckMat, slabMat, steel);
  const disc = new THREE.CircleGeometry(r, 32);
  disc.rotateX(-Math.PI / 2);
  const slab = new THREE.CylinderGeometry(r, r, 0.6, 32);
  geos.push(disc, slab);
  const top = new THREE.Mesh(disc, deckMat);
  top.position.set(x, y + 0.02, z);
  top.receiveShadow = true;
  const body = new THREE.Mesh(slab, slabMat);
  body.position.set(x, y - 0.3, z);
  body.castShadow = true;
  group.add(top, body);
  const leg = new THREE.CylinderGeometry(0.45, 0.45, 1, 7);
  geos.push(leg);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const lx = x + Math.sin(a) * r * 0.65;
    const lz = z - Math.cos(a) * r * 0.65;
    const g0 = heightAt(lx, lz) - 1;
    const h = Math.max(0.5, y - 0.6 - g0);
    const m = new THREE.Mesh(leg, steel);
    m.scale.set(1, h, 1);
    m.position.set(lx, g0 + h / 2, lz);
    group.add(m);
  }

  // The cabin on its stilts, glazed all round (the lookout's whole point), a pitched roof.
  const b = ((cabin.bearing || 0) * Math.PI) / 180;
  const cx = x + Math.sin(b) * (cabin.dist || 22);
  const cz = z - Math.cos(b) * (cabin.dist || 22);
  const cg = heightAt(cx, cz);
  const stilt = 5.5;
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fc4d8, roughness: 0.2, metalness: 0.3 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x8a2f22, roughness: 0.85 });
  mats.push(wood, glass, roofMat);
  const post = new THREE.BoxGeometry(0.3, stilt, 0.3);
  const room = new THREE.BoxGeometry(4.2, 2.6, 4.2);
  const pane = new THREE.BoxGeometry(4.3, 1.1, 4.3);
  const roof = new THREE.ConeGeometry(3.6, 1.6, 4);
  roof.rotateY(Math.PI / 4);
  geos.push(post, room, pane, roof);
  for (const [ox, oz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) {
    const p = new THREE.Mesh(post, wood);
    p.position.set(cx + ox, cg + stilt / 2 - 0.4, cz + oz);
    group.add(p);
  }
  const roomM = new THREE.Mesh(room, wood);
  roomM.position.set(cx, cg + stilt + 1.3 - 0.4, cz);
  roomM.castShadow = true;
  const paneM = new THREE.Mesh(pane, glass);
  paneM.position.set(cx, cg + stilt + 1.6 - 0.4, cz);
  const roofM = new THREE.Mesh(roof, roofMat);
  roofM.position.set(cx, cg + stilt + 2.6 + 0.8 - 0.4, cz);
  roofM.castShadow = true;
  group.add(roomM, paneM, roofM);
  const obstacle = addObstacleAt(cx, cz, 4.6, 4.6, cg - 1, stilt + 4.2, 'You flew into the lookout cabin');

  scene.add(group);
  return {
    group,
    pad: { x, y, z, r, name },
    cabin: { x: cx, y: cg, z: cz },
    // Where the crew wait: the deck's edge on the cabin side.
    door: { x: x + Math.sin(b) * (r - 1.5), y, z: z - Math.cos(b) * (r - 1.5) },
    platform,
    dispose() {
      if (group.parent) group.parent.remove(group);
      const i = PLATFORMS.indexOf(plat);
      if (i >= 0) PLATFORMS.splice(i, 1);
      const j = OBSTACLES.indexOf(obstacle);
      if (j >= 0) OBSTACLES.splice(j, 1);
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
    },
  };
}

/** A survey point: a squat concrete post with a brass disc on top. */
export function buildSurveyMarker(scene, { x, z } = {}) {
  const group = new THREE.Group();
  group.name = 'story:survey-marker';
  const y = heightAt(x, z);
  const conc = new THREE.MeshStandardMaterial({ color: 0xb9b4a8, roughness: 0.95 });
  const discTex = decalTexture(128, 128, (g, W, H) => {
    g.fillStyle = '#b08a3a';
    g.beginPath();
    g.arc(W / 2, H / 2, W * 0.48, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#6a4f1c';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(W / 2, H / 2, W * 0.4, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = KITTIWAKE.white;
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(W * 0.28, H * 0.52);
    g.quadraticCurveTo(W * 0.39, H * 0.38, W * 0.5, H * 0.5);
    g.quadraticCurveTo(W * 0.61, H * 0.38, W * 0.72, H * 0.52);
    g.stroke();
  });
  const brass = new THREE.MeshStandardMaterial({ color: 0xffffff, map: discTex, roughness: 0.4, metalness: 0.6 });
  const postG = new THREE.CylinderGeometry(0.35, 0.45, 0.9, 10);
  const discG = new THREE.CircleGeometry(0.3, 16);
  discG.rotateX(-Math.PI / 2);
  const post = new THREE.Mesh(postG, conc);
  post.position.set(x, y + 0.35, z);
  const disc = new THREE.Mesh(discG, brass);
  disc.position.set(x, y + 0.81, z);
  group.add(post, disc);
  scene.add(group);
  return {
    group,
    pos: { x, y: y + 0.8, z },
    dispose() {
      if (group.parent) group.parent.remove(group);
      postG.dispose();
      discG.dispose();
      conc.dispose();
      brass.dispose();
      if (discTex) discTex.dispose();
    },
  };
}

/** A Thornefield Dynamics equipment case: grey, a teal band, the mark on the lid and both long sides. */
export function buildCase(scene, { x, z, headingDeg = 0, w = 1.6, h = 0.7, d = 0.9 } = {}) {
  const group = new THREE.Group();
  group.name = 'story:thornefield-case';
  const tex = decalTexture(256, 128, (g, W, H) => {
    g.fillStyle = THORNEFIELD.grey;
    g.fillRect(0, 0, W, H);
    g.fillStyle = THORNEFIELD.teal;
    g.fillRect(0, H * 0.78, W, H * 0.1);
    paintThornefield(g, W * 0.17, H * 0.42, H * 0.22, { ink: '#f4f6f8' });
  });
  const marked = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.6, metalness: 0.25 });
  const plain = new THREE.MeshStandardMaterial({ color: 0x8a9097, roughness: 0.6, metalness: 0.25 });
  const geo = new THREE.BoxGeometry(w, h, d);
  // Box faces: +x, -x, +y, -y, +z, -z — the mark on the lid and the two long sides.
  const box = new THREE.Mesh(geo, [plain, plain, marked, plain, marked, marked]);
  const y = heightAt(x, z);
  box.position.set(0, h / 2, 0);
  box.castShadow = true;
  group.add(box);
  group.position.set(x, y, z);
  group.rotation.y = (-headingDeg * Math.PI) / 180;
  scene.add(group);
  return {
    group,
    dispose() {
      if (group.parent) group.parent.remove(group);
      geo.dispose();
      marked.dispose();
      plain.dispose();
      if (tex) tex.dispose();
    },
  };
}
