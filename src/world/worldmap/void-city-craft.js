/**
 * What stands on Nullspire's ramp (the owner, 2026-11-08: "the planes are
 * rockets etc etc yk"): no airliners here. Sleek spaceplanes nose-in to the
 * terminal, tail-sitting rockets on their pads, and north-east of the field
 * a launch complex with one rocket that lifts off now and then on a calm
 * flame, climbs out of sight and is back on its pad for the next time.
 *
 * All original shapes, in the airport kit's vertex-coloured Batch: the whole
 * ramp is one draw call, its lights one more, the rocket that flies its own
 * mesh (it moves) and its flame two (the rocket feature's own plume,
 * features/rocket/models.js buildPlume, run slow so nothing pulses fast).
 * Everything is in the field's frame (x along the runway, -z north).
 */
import * as THREE from '../../vendor/three.module.js';
import { Batch, vcMaterial, glowPoints, glowTexture, layer, trs, trse } from '../airport-kit.js';
import { Kit, buildPlume, updatePlume } from '../../features/rocket/models.js';
import { JAVELIN_SPOT } from './void-city.js';

const C = {
  // Pale hulls: the ramp is lit by its masts' glows alone, and a dark hull is nothing at night.
  hull: 0xd9dee4,
  hullLight: 0xb9c2cc,
  accent: 0x3fd1e0,
  amber: 0xffb04a,
  white: 0xe9edf0,
  nozzle: 0x2a2d32,
  pad: 0x6e7174,
  trench: 0x45484b,
  leg: 0x8b9199,
  mast: 0x9a9fa5,
};

/** A spaceplane, nose to -z, standing on its gear at (x, z); `L` metres long. */
function spaceplane(b, x, z, L, night, accent = C.accent) {
  const r = L * 0.052;
  const y = r + 2.2;
  // The hull: a flattened body, a long nose, a boat tail.
  const body = new THREE.CylinderGeometry(r, r, L * 0.62, 12, 1);
  body.rotateX(Math.PI / 2);
  body.scale(1.45, 0.78, 1);
  body.translate(x, y, z + L * 0.07);
  b.add(body, new THREE.Matrix4(), C.hull);
  body.dispose();
  const nose = new THREE.CylinderGeometry(r * 0.12, r, L * 0.3, 12, 1);
  nose.rotateX(-Math.PI / 2);
  nose.scale(1.45, 0.78, 1);
  nose.translate(x, y - r * 0.1, z - L * 0.39);
  b.add(nose, new THREE.Matrix4(), C.hull);
  nose.dispose();
  const tail = new THREE.CylinderGeometry(r, r * 0.55, L * 0.16, 12, 1);
  tail.rotateX(Math.PI / 2);
  tail.scale(1.45, 0.78, 1);
  tail.translate(x, y + r * 0.1, z + L * 0.46);
  b.add(tail, new THREE.Matrix4(), C.hull);
  tail.dispose();
  // A blended delta: a wide thin wedge each side, swept hard; an accent line along its leading edge.
  const span = L * 0.72;
  for (const side of [-1, 1]) {
    b.add(new THREE.BoxGeometry(span / 2, 0.5, L * 0.34), trse(x + side * span / 4, y - r * 0.5, z + L * 0.17, 0, -side * 0.72, side * 0.04), C.hullLight);
    b.add(new THREE.BoxGeometry(span / 2, 0.14, 0.9), trse(x + side * span / 4, y - r * 0.5 + 0.3, z + L * 0.17 - L * 0.17 + 0.2, 0, -side * 0.72, side * 0.04), accent);
    // Canted fins at the tail.
    b.add(new THREE.BoxGeometry(0.4, L * 0.12, L * 0.13), trse(x + side * r * 1.1, y + r * 0.9, z + L * 0.44, 0, 0, -side * 0.5), C.hullLight);
    // Two engines under the tail: dark bells.
    b.cyl(r * 0.42, r * 0.55, L * 0.08, x + side * r * 0.7, y - r * 0.35 - L * 0.04, z + L * 0.52, C.nozzle, 10, { rx: Math.PI / 2, open: true });
  }
  // A lit cabin strip down the spine, and the nose light.
  night.push([x, y + r * 0.8, z - L * 0.12, 3, C.accent]);
  night.push([x, y + r * 0.8, z + L * 0.08, 3, C.accent]);
  night.push([x, y - r * 0.2, z - L * 0.52, 2, 0xfff1d0]);
  // Wheels.
  b.cyl(0.55, 0.55, 0.5, x, 0.55, z - L * 0.28, 0x202326, 8, { rz: Math.PI / 2 });
  for (const side of [-1, 1]) b.cyl(0.7, 0.7, 0.6, x + side * r * 1.2, 0.7, z + L * 0.16, 0x202326, 8, { rz: Math.PI / 2 });
}

/**
 * The Javelin, parked: the secret aeroplane (aircraft/extra/javelin.js), drawn
 * the way its own airframe is (fleet/extra/javelin.js, v80), cheaply: the
 * flat-bottomed lifting body 24 m long in flat facets from a few of its hull
 * stations, the small trapezoid wings, the twin fins canted out, the scramjet
 * module under the aft belly, the narrow canopy, the city's amber down the
 * spine, on its gear, on its own lit pad. Nose to -z like the rest. Walking up
 * to it, or landing here, is the find. Its numbers are the airframe's.
 */
const JAV_HULL = [
  // z, half-width at the chine, belly y, spine y (about the centre of gravity)
  [-14.4, 0.03, 0.02, 0.08],
  [-12.0, 0.48, -0.16, 0.36],
  [-8.8, 1.02, -0.44, 0.62],
  [-5.2, 1.45, -0.66, 0.78],
  [-1.0, 1.72, -0.8, 0.98],
  [4.2, 1.7, -0.82, 0.94],
  [8.2, 1.3, -0.6, 0.7],
  [9.6, 1.0, -0.36, 0.46],
];
function javelin(b, x, z, night) {
  // The centre of gravity 2.1 m up: where the type's wheels touch.
  const Y = 2.1;
  const top = 0x1a1f28;
  const belly = 0x101318;
  const edge = 0x9aa0a6;
  b.cyl(1.24, 1.24, 0.3, x, 0, z, 0x5a4a30, 24);
  b.flat(14, 28, x, 0.2, z, 0x3a3028);
  const P = (px, py, pz) => [x + px, Y + py, z + pz];
  // A thin plate seen from both sides (the batch's material is one-sided).
  const plate = (a, c, d, e, col) => {
    b.quad(a, c, d, e, undefined, col);
    b.quad(a, e, d, c, undefined, col);
  };
  // The hull: one ring a station, keel / chine / shoulder / spine / shoulder / chine.
  const ring = ([sz, w, yb, yt]) => {
    const yc = yb + 0.05;
    const ys = yc + (yt - yc) * 0.82;
    return [P(0, yb, sz), P(w, yc, sz), P(w * 0.55, ys, sz), P(0, yt, sz), P(-w * 0.55, ys, sz), P(-w, yc, sz)];
  };
  const rings = JAV_HULL.map(ring);
  for (let i = 0; i < rings.length - 1; i++) {
    const A = rings[i];
    const B = rings[i + 1];
    for (let k = 0; k < 6; k++) {
      const k1 = (k + 1) % 6;
      // Belly (keel to chine either side) dark; the forebody's chines in the leading-edge grey; the upper surface in the tiles.
      const col = k === 0 || k === 5 ? (i < 2 ? edge : belly) : top;
      b.quad(A[k], A[k1], B[k1], B[k], undefined, col);
    }
  }
  // The blunt aft end: the nozzle's dark face.
  const T = rings[rings.length - 1];
  for (let k = 1; k < 5; k++) b.tri(T[0], T[k], T[k + 1], [0, 0], [0, 0], [0, 0], C.nozzle);
  for (const s of [-1, 1]) {
    // A wing: root at 1.5 m out, 8.4 m chord; tip at 4.75 m, 1.5 m chord, its leading edge 6.3 m aft; the lighter leading edge.
    const rLE = P(s * 1.5, -0.62, -1.4);
    const rTE = P(s * 1.5, -0.62, 7.0);
    const tTE = P(s * 4.75, -0.72, 6.4);
    const tLE = P(s * 4.75, -0.72, 4.9);
    plate(rLE, rTE, tTE, tLE, top);
    plate(rLE, tLE, P(s * 4.75, -0.7, 5.25), P(s * 1.5, -0.6, -0.9), edge);
    // A fin, canted 25 degrees out, amber at the tip.
    const fin = (t, aft) => P(s * (0.85 + 0.78 * t), 0.5 + 1.68 * t, aft ? 8.0 - 0.1 * t : 4.8 + 2.2 * t);
    plate(fin(0, 0), fin(0, 1), fin(0.84, 1), fin(0.84, 0), top);
    plate(fin(0.84, 0), fin(0.84, 1), fin(1, 1), fin(1, 0), C.amber);
    // A main wheel and its leg.
    b.cyl(0.37, 0.37, 0.28, x + s * 1.4, 0.23, z + 1.4, 0x202326, 8, { rz: Math.PI / 2 });
    b.box(0.14, 1.0, 0.14, x + s * 1.45, 0.86, z + 1.45, C.leg);
  }
  // The scramjet module under the aft belly, its inlet mouth dark.
  b.box(2.3, 0.56, 8.4, x, Y - 1.07, z + 3.6, belly);
  b.box(2.0, 0.42, 0.06, x, Y - 1.05, z - 0.62, C.nozzle);
  // The canopy, narrow, faired into the spine; the amber spine stripe behind it.
  const can = new THREE.SphereGeometry(1, 8, 4);
  b.add(can, trse(x, Y + 0.58, z - 8.6, 0, 0, 0, 0.42, 0.44, 1.7), 0x2b3a4a);
  can.dispose();
  for (let i = 3; i < rings.length - 2; i++) {
    const a = rings[i][3];
    const c = rings[i + 1][3];
    b.quad([a[0] - 0.12, a[1] + 0.03, a[2]], [a[0] + 0.12, a[1] + 0.03, a[2]], [c[0] + 0.12, c[1] + 0.03, c[2]], [c[0] - 0.12, c[1] + 0.03, c[2]], undefined, C.amber);
  }
  // The nose wheel and its leg.
  b.cyl(0.27, 0.27, 0.2, x, 0.17, z - 5.6, 0x202326, 8, { rz: Math.PI / 2 });
  b.box(0.12, 1.15, 0.12, x, 0.85, z - 5.5, C.leg);
  // Its pad is lit amber all round: the one thing on the ramp that is.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    night.push([x + Math.cos(a) * 9, 0.6, z + Math.sin(a) * 15, 2.4, C.amber]);
  }
  night.push([x, Y + 1.05, z - 1, 2.5, C.amber]);
}

/** A tail-sitting rocket on its pad at (x, z): a body, a nose, four fins, four legs, bells under. */
function rocket(b, x, z, h, r, night, accent = C.amber, standing = true) {
  b.cyl(r * 1.1, r * 1.1, 0.4, x, 0, z, C.pad, 20);
  const legH = standing ? r * 1.6 : 0;
  const base = legH;
  b.cyl(r, r, h * 0.72, x, base, z, C.white, 18);
  b.cyl(r * 0.08, r, h * 0.22, x, base + h * 0.72, z, accent, 18);
  // A band of the accent, and a dark service stripe.
  b.cyl(r * 1.01, r * 1.01, h * 0.03, x, base + h * 0.5, z, accent, 18);
  b.cyl(r * 1.01, r * 1.01, h * 0.1, x, base + h * 0.02, z, C.hull, 18);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const fx = x + Math.cos(a) * r * 1.3;
    const fz = z + Math.sin(a) * r * 1.3;
    b.add(new THREE.BoxGeometry(r * 1.2, h * 0.16, 0.3), trse(fx, base + h * 0.1, fz, 0, -a, 0), C.hullLight);
    if (standing) b.cyl(0.18, 0.28, legH * 1.25, x + Math.cos(a) * r * 1.5, 0, z + Math.sin(a) * r * 1.5, C.leg, 6, { rx: Math.sin(a) * 0.5, rz: -Math.cos(a) * 0.5 });
  }
  const bells = r > 3 ? 5 : 3;
  for (let i = 0; i < bells; i++) {
    const a = (i / bells) * Math.PI * 2;
    const k = bells > 1 ? 0.55 : 0;
    b.cyl(r * 0.22, r * 0.34, r * 0.5, x + Math.cos(a) * r * k, base - r * 0.5 + 0.05, z + Math.sin(a) * r * k, C.nozzle, 10, { open: true });
  }
  night.push([x, base + h * 0.94, z, 2.5, 0xff4a3a]);
  night.push([x + r * 1.1, 0.5, z + r * 1.1, 2, 0xfff1d0]);
  night.push([x - r * 1.1, 0.5, z - r * 1.1, 2, 0xfff1d0]);
}

/**
 * The ramp's craft and the launch complex for a field whose layout has a
 * `ramp` (void-city.js CITY_FIELD). Returns { mesh, lights, launcher, dispose }.
 * `launcher.update(dt)` flies the rocket; the group is in the field's frame.
 */
export function buildRampCraft(field, quality = 'medium') {
  const ramp = (field.layout.pavement || []).find((p) => p.kind === 'ramp');
  const b = new Batch();
  const night = [];
  // A pool of light on the concrete under each mast, as at the home apron (airport.js buildFloodlights): one draw call.
  const pb = new Batch();
  if (ramp) {
    // The Javelin first, on its own pad at the west end; then spaceplanes nose-in along the terminal's face, a rocket on a pad between every other pair.
    const z0 = ramp.z0;
    javelin(b, JAVELIN_SPOT.x, JAVELIN_SPOT.z, night);
    let x = ramp.x0 + 170;
    let i = 0;
    while (x < ramp.x1 - 60) {
      if (i % 3 === 2) rocket(b, x, z0 + 70, 30, 2.4, night, i % 2 ? C.amber : C.accent);
      else spaceplane(b, x, z0 + 60, i % 3 === 0 ? 52 : 44, night, i % 2 ? C.amber : C.accent);
      x += i % 3 === 2 ? 80 : 110;
      i++;
    }
    // Floodlight masts along the back of the ramp (the ordinary apron's, which this ramp does without).
    for (let mx = ramp.x0 + 60; mx < ramp.x1 - 20; mx += 160) {
      const mz = ramp.z1 + 8;
      b.cyl(0.35, 0.5, 24, mx, 0, mz, C.mast, 8);
      b.box(4, 1.2, 1, mx, 24.4, mz, 0x3d4246);
      night.push([mx, 23.6, mz, 4, 0xfff1d6]);
      const disc = new THREE.CircleGeometry(85, 24);
      disc.rotateX(-Math.PI / 2);
      pb.add(disc, trs(mx, 0.09, (ramp.z0 + ramp.z1) / 2), 0xffffff);
      disc.dispose();
    }
  }
  const pmat = layer(new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffe2b0, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }), 'decal');
  const pools = pb.mesh(pmat, { cast: false, receive: false, name: 'ramp-pools' });
  if (pools) pools.geometry.deleteAttribute('color');
  // The launch complex, north-east: a pad, its trench, four masts, and the rocket that flies.
  const LX = 1600;
  const LZ = -640;
  b.flat(90, 90, LX, 0.04, LZ, C.pad);
  b.box(14, 1.2, 70, LX + 30, 0.6, LZ, C.trench);
  for (const [dx, dz] of [[-38, -38], [38, -38], [-38, 38], [38, 38]]) {
    b.cyl(0.8, 1.3, 64, LX + dx, 0, LZ + dz, C.mast, 8);
    night.push([LX + dx, 64.5, LZ + dz, 3, 0xff4a3a]);
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    night.push([LX + Math.cos(a) * 44, 0.6, LZ + Math.sin(a) * 44, 2, 0xfff1d0]);
  }
  // A little emissive on everything: the ramp stands under its own floodlights, and the void has no moon to lend it.
  const mesh = b.mesh(vcMaterial({ roughness: 0.6, metalness: 0.15, emissive: 0x3a424c, emissiveIntensity: 1 }), { cast: quality !== 'low', receive: true, name: 'ramp-craft' });
  if (mesh) mesh.geometry.deleteAttribute('uv');

  const pos = [];
  const col = [];
  const cc = new THREE.Color();
  for (const [x, y, z, , c] of night) {
    pos.push(x, y, z);
    cc.set(c || 0xffe2a8);
    col.push(cc.r, cc.g, cc.b);
  }
  const lights = glowPoints(pos, col, 3.2, { name: 'ramp-lights' });

  // The one that flies: its own mesh, on the pad, with the rocket feature's flame under it.
  const fb = new Batch();
  const fl = [];
  const R = 4.2;
  const H = 62;
  rocket(fb, 0, 0, H, R, fl, C.accent, true);
  const flyer = fb.mesh(vcMaterial({ roughness: 0.6, metalness: 0.15, emissive: 0x3a424c, emissiveIntensity: 1 }), { cast: false, receive: false, name: 'launch-rocket' });
  if (flyer) flyer.geometry.deleteAttribute('uv');
  const group = new THREE.Group();
  group.name = 'launch';
  group.position.set(LX, 0, LZ);
  if (flyer) group.add(flyer);
  const kit = new Kit();
  const plume = buildPlume(kit, R * 0.9, R * 1.6 - R * 0.5);
  group.add(plume);

  const launcher = {
    group,
    plume,
    /** Seconds into the cycle: on the pad, then the burn and the climb, then gone until it is back. */
    t: 0,
    period: 150,
    liftAt: 92,
    burnS: 40,
    y: 0,
    power: 0,
    update(dt) {
      this.t = (this.t + Math.max(0, Math.min(0.25, dt))) % this.period;
      const s = (this.t - this.liftAt) / this.burnS;
      if (s < 0) {
        this.y = 0;
        this.power = 0;
        group.visible = true;
      } else if (s < 1) {
        // Slow off the pad, then away: the climb is the square of the time.
        this.y = 6000 * s * s;
        this.power = Math.min(1, s * 12);
        group.visible = true;
      } else {
        this.y = 6000;
        this.power = 0;
        group.visible = false;
      }
      group.position.y = this.y;
      // The flame, run slow: its own shimmer would be a pulse (features/rocket/models.js), and nothing here pulses.
      updatePlume(plume, this.t * 0.08, this.power, Math.min(0.7, this.y / 9000), R * 0.9);
    },
  };
  launcher.update(0);

  return {
    mesh,
    lights,
    pools,
    launcher,
    counts: { craft: night.length, launcher: 1 },
    dispose() {
      if (mesh) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      lights.geometry.dispose();
      lights.material.dispose();
      if (pools) pools.geometry.dispose();
      pmat.dispose(); // made even when there are no pools (no ramp): disposed either way
      if (flyer) {
        flyer.geometry.dispose();
        flyer.material.dispose();
      }
      kit.dispose();
    },
  };
}
