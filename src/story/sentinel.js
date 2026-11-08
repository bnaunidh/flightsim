/**
 * SIGNAL ZERO — a SENTINEL unit: the 1986 range-safety drone, as a prop.
 *
 * The bible (§6, chapter 2): "a scorched, finned machine with no cockpit and
 * no windows, stencilled SENTINEL · RANGE SAFETY UNIT 4 · KITTIWAKE". It is
 * the AttackField drone's shape (features/events/afo-combat.js: a long body,
 * a straight wing, twin fins at the tail) grown to the size of a light
 * aircraft and painted in the range's 1986 livery — off-white with an
 * orange band and the kittiwake on both fins. Built here once, so every
 * chapter that needs one uses the same machine: scorched and broken in the
 * burn scar (chapter 2), a shape with no lights (chapter 3), the drones
 * coming out of their silos (chapters 7, 10).
 *
 *   const s = buildSentinel({ scorched: true, unit: 4 });
 *   scene.add(s.group); … s.dispose();
 *
 * Every texture is painted in code (brands.js), owned by this prop and
 * disposed with it. One body texture, one fin texture, five materials, about
 * 700 triangles. School-safe by construction: it is unmanned — there is no
 * cockpit to be in.
 */

import * as THREE from '../vendor/three.module.js';
import { KITTIWAKE, paintKittiwake, decalTexture } from './brands.js';

const SOOT = '#1c1916';

function hash(i) {
  let h = (i * 2654435761) | 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** The body's skin: off-white, an orange band, the stencil on both sides; soot when scorched. */
function bodyTexture(unit, scorched) {
  return decalTexture(1024, 256, (g, W, H) => {
    g.fillStyle = scorched ? '#bdb6a6' : '#e8e3d6';
    g.fillRect(0, 0, W, H);
    // The orange band round the body, a fifth of the way back from the nose.
    g.fillStyle = scorched ? KITTIWAKE.faded : '#d9531e';
    g.fillRect(0, H * 0.16, W, H * 0.07);
    // Panel lines.
    g.strokeStyle = 'rgba(40,40,40,0.35)';
    g.lineWidth = 2;
    for (const v of [0.34, 0.52, 0.7, 0.86]) {
      g.beginPath();
      g.moveTo(0, H * v);
      g.lineTo(W, H * v);
      g.stroke();
    }
    // The stencil, once on each side (the cylinder's u goes round it).
    for (const u of [0.25, 0.75]) {
      g.save();
      g.translate(W * u, H * 0.52);
      g.rotate(Math.PI / 2);
      g.fillStyle = scorched ? 'rgba(30,28,26,0.82)' : '#2b2a26';
      g.font = "700 30px 'Barlow Condensed', 'Jost', Arial, sans-serif";
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('SENTINEL', 0, -28);
      g.font = "700 17px 'Barlow Condensed', 'Jost', Arial, sans-serif";
      g.fillText(`RANGE SAFETY UNIT ${unit}`, 0, 2);
      g.fillText('KITTIWAKE', 0, 26);
      g.restore();
      paintKittiwake(g, W * u, H * 0.42, 14, { alpha: scorched ? 0.7 : 1 });
    }
    if (scorched) {
      // Soot: soft dark blooms, heaviest at the tail where it burnt longest.
      for (let i = 0; i < 46; i++) {
        const x = hash(i * 3 + 1) * W;
        const y = H * (0.35 + hash(i * 3 + 2) * 0.65);
        const r = 18 + hash(i * 3 + 3) * 60;
        const grd = g.createRadialGradient(x, y, 1, x, y, r);
        grd.addColorStop(0, 'rgba(28,25,22,0.72)');
        grd.addColorStop(1, 'rgba(28,25,22,0)');
        g.fillStyle = grd;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      g.fillStyle = 'rgba(28,25,22,0.55)';
      g.fillRect(0, H * 0.9, W, H * 0.1);
    }
  });
}

function finTexture(scorched) {
  return decalTexture(256, 256, (g, W, H) => {
    g.fillStyle = scorched ? '#b3ac9c' : '#e8e3d6';
    g.fillRect(0, 0, W, H);
    paintKittiwake(g, W * 0.5, H * 0.45, 46, { alpha: scorched ? 0.75 : 1 });
    if (scorched) {
      const grd = g.createLinearGradient(0, H, 0, H * 0.4);
      grd.addColorStop(0, 'rgba(28,25,22,0.85)');
      grd.addColorStop(1, 'rgba(28,25,22,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, W, H);
    }
  });
}

/**
 * @param {object} opts
 *   scorched  burnt and broken, nose-down in the ground (the burn scar)
 *   unit      the number on the stencil
 *   scale     1 is a 7 m body
 */
export function buildSentinel({ scorched = false, unit = 4, scale = 1 } = {}) {
  const S = 1.4 * scale;
  const group = new THREE.Group();
  group.name = 'story:sentinel';
  // The machine itself, which a crash tilts; the scorched earth stays flat on the ground.
  const craft = new THREE.Group();
  group.add(craft);
  const geos = [];
  const mats = [];
  const texs = [];
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    craft.add(m);
    return m;
  };
  const bodyTex = bodyTexture(unit, scorched);
  const finTex = finTexture(scorched);
  if (bodyTex) texs.push(bodyTex);
  if (finTex) texs.push(finTex);
  const skin = new THREE.MeshStandardMaterial({ color: bodyTex ? 0xffffff : 0xe8e3d6, map: bodyTex, roughness: scorched ? 0.92 : 0.6, metalness: 0.18 });
  const plain = new THREE.MeshStandardMaterial({ color: scorched ? 0x6e675e : 0xdcd6c8, roughness: scorched ? 0.95 : 0.65, metalness: 0.15 });
  const finMat = new THREE.MeshStandardMaterial({ color: finTex ? 0xffffff : 0xe8e3d6, map: finTex, roughness: 0.75, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x24221f, roughness: 0.9, metalness: 0.2 });
  mats.push(skin, plain, finMat, dark);

  // The body along -Z (nose forward), a cone nose, a short tail cone and the exhaust.
  const L = 5 * S;
  const body = new THREE.CylinderGeometry(0.5 * S, 0.56 * S, L, 16, 1, true);
  body.rotateX(Math.PI / 2);
  geos.push(body);
  add(body, skin);
  const nose = new THREE.ConeGeometry(0.5 * S, 1.5 * S, 16);
  nose.rotateX(-Math.PI / 2);
  geos.push(nose);
  add(nose, plain, 0, 0, -L / 2 - 0.75 * S);
  const tail = new THREE.ConeGeometry(0.56 * S, 0.8 * S, 16, 1, true);
  tail.rotateX(Math.PI / 2);
  geos.push(tail);
  add(tail, plain, 0, 0, L / 2 + 0.4 * S);
  const jet = new THREE.CylinderGeometry(0.26 * S, 0.3 * S, 0.5 * S, 12);
  jet.rotateX(Math.PI / 2);
  geos.push(jet);
  add(jet, dark, 0, 0, L / 2 + 0.85 * S);

  // A straight wing, a little aft of the middle; scorched, the left one has snapped and drops.
  const wing = new THREE.BoxGeometry(2.9 * S, 0.08 * S, 1.2 * S);
  geos.push(wing);
  add(wing, plain, 1.45 * S + 0.4 * S, -0.12 * S, 0.2 * S, 0, 0.12, 0);
  if (scorched) add(wing, plain, -1.7 * S, -0.55 * S, 0.45 * S, 0.05, -0.32, 0.42);
  else add(wing, plain, -1.45 * S - 0.4 * S, -0.12 * S, 0.2 * S, 0, -0.12, 0);

  // Twin fins at the tail, canted out, with the bird on each.
  const fin = new THREE.BoxGeometry(0.06 * S, 1.1 * S, 1.0 * S);
  geos.push(fin);
  for (const side of [-1, 1]) add(fin, finMat, side * 0.45 * S, 0.75 * S, L / 2 - 0.35 * S, 0, 0, -side * 0.28);

  // No cockpit and no windows — but a sensor blister under the nose.
  const blister = new THREE.SphereGeometry(0.22 * S, 10, 8);
  geos.push(blister);
  add(blister, dark, 0, -0.45 * S, -L / 2 + 0.6 * S);

  if (scorched) {
    // Nose-down where it came in, rolled onto the broken wing, and a ring of turned earth.
    craft.rotation.set(0.16, 0.6, -0.12);
    const scar = new THREE.CircleGeometry(4.2 * S, 24);
    scar.rotateX(-Math.PI / 2);
    const scarMat = new THREE.MeshStandardMaterial({ color: 0x2a2520, roughness: 1, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    geos.push(scar);
    mats.push(scarMat);
    const ring = new THREE.Mesh(scar, scarMat);
    ring.position.set(0, -0.5 * S, 0);
    ring.receiveShadow = true;
    ring.userData.flat = true;
    group.add(ring);
  }

  return {
    group,
    /** Metres from the ground the group's origin sits at, so the belly rests on it. */
    rest: scorched ? 0.55 * S : 0.6 * S,
    length: L + 2.3 * S,
    dispose() {
      if (group.parent) group.parent.remove(group);
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
    },
  };
}
