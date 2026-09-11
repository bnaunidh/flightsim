/**
 * The aeroplane: a high-wing four-seat trainer, built entirely from lofted
 * geometry so there is no model file to download.
 *
 * Everything that moves on a real aeroplane moves here too — ailerons,
 * elevator, rudder, flaps, propeller, spinning wheels, retracting gear,
 * navigation and strobe lights — driven from the flight model each frame.
 */

import * as THREE from '../vendor/three.module.js';
import {
  airframeTexture,
  airframeNormal,
  propTexture,
  propBlurTexture,
  leatherTexture,
} from '../render/textures.js';
import { clamp, lerp } from '../core/noise.js';
import { getAircraft, DEFAULT_AIRCRAFT_ID } from './types.js';

/** NACA-style aerofoil outline, chord along +X, thickness along +Y. */
function aerofoil(steps = 18, thickness = 0.13, camber = 0.022) {
  const pts = [];
  const yt = (x) =>
    5 *
    thickness *
    (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  const yc = (x) => (x < 0.4 ? (camber / 0.16) * (2 * 0.4 * x - x * x) : (camber / 0.36) * (1 - 2 * 0.4 + 2 * 0.4 * x - x * x));
  // Upper surface, leading edge → trailing edge.
  for (let i = 0; i <= steps; i++) {
    const x = i / steps;
    pts.push(new THREE.Vector2(x, yc(x) + yt(x)));
  }
  // Lower surface back to the leading edge.
  for (let i = steps - 1; i >= 1; i--) {
    const x = i / steps;
    pts.push(new THREE.Vector2(x, yc(x) - yt(x)));
  }
  return pts;
}

/**
 * Loft a wing/stabiliser from section definitions:
 *   { y, chord, offsetX, offsetY, twist }
 * where y is the spanwise station (along local +X of the returned geometry).
 */
function loft(sections, profile) {
  const n = profile.length;
  const verts = [];
  const uvs = [];
  const idx = [];

  sections.forEach((s, si) => {
    for (let i = 0; i < n; i++) {
      const p = profile[i];
      const cos = Math.cos(s.twist || 0);
      const sin = Math.sin(s.twist || 0);
      const px = p.x * s.chord;
      const py = p.y * s.chord;
      const rx = px * cos - py * sin;
      const ry = px * sin + py * cos;
      // local: X = span, Y = up, Z = chordwise (aft positive)
      verts.push(s.y, ry + (s.offsetY || 0), rx + (s.offsetX || 0));
      uvs.push(i / n, si / (sections.length - 1));
    }
  });

  for (let si = 0; si < sections.length - 1; si++) {
    for (let i = 0; i < n; i++) {
      const a = si * n + i;
      const b = si * n + ((i + 1) % n);
      const c = (si + 1) * n + ((i + 1) % n);
      const d = (si + 1) * n + i;
      idx.push(a, b, c, a, c, d);
    }
  }

  // Cap both ends.
  const capStart = verts.length / 3;
  for (const which of [0, sections.length - 1]) {
    for (let i = 0; i < n; i++) {
      const base = which * n + i;
      verts.push(verts[base * 3], verts[base * 3 + 1], verts[base * 3 + 2]);
      uvs.push(0.5, 0.5);
    }
  }
  for (let k = 0; k < 2; k++) {
    const off = capStart + k * n;
    for (let i = 1; i < n - 1; i++) {
      if (k === 0) idx.push(off, off + i, off + i + 1);
      else idx.push(off, off + i + 1, off + i);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function metalMaterial(map, { roughness = 0.42, metalness = 0.35, color = 0xffffff } = {}) {
  return new THREE.MeshStandardMaterial({
    map,
    normalMap: airframeNormal(),
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughness,
    metalness,
    color,
  });
}

function glowSprite(color, size) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      color,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    })
  );
  s.scale.setScalar(size);
  return s;
}

export function createAircraftModel(opts = {}) {
  // One builder, five aeroplanes. Everything below is driven by the shape
  // description in types.js — the same one the flight model takes its gear and
  // wing-strike points from, so what you see is what you fly.
  const type = opts.type || getAircraft(DEFAULT_AIRCRAFT_ID);
  const S = opts.shape || type.shape;
  /*
   * Paint.
   *
   * `opts.livery` may be a scheme object from aircraft/liveries.js, or the
   * old plain hex string. Both are accepted so nothing that already calls this
   * has to change.
   */
  const scheme =
    opts.livery && typeof opts.livery === 'object'
      ? opts.livery
      : { base: opts.livery || type.livery || '#eef1f5', accent: opts.accent || type.accent || '#c8102e' };
  const isJet = S.power.kind === 'jet';

  const root = new THREE.Group();
  root.name = 'aircraft';

  const skin = airframeTexture(scheme);
  const bodyMat = metalMaterial(skin, { roughness: 0.36, metalness: 0.4 });
  const matteMat = metalMaterial(skin, { roughness: 0.62, metalness: 0.2 });
  /*
   * The tail gets its own material, and it has to.
   *
   * The fin is lofted with u running around the aerofoil section and v running
   * spanwise, and it is handed the same square image as the fuselage — so any
   * colour painted into that texture arrives on the fin as a band wrapped
   * across it, never as a coloured tail. A tinted material is the only way to
   * get the one marking that actually makes a scheme recognisable in the air.
   * `null` leaves the fin in body colour, which is what the house schemes want.
   */
  const tailMat = scheme.tail
    ? metalMaterial(skin, { roughness: 0.38, metalness: 0.35, color: scheme.tail })
    : bodyMat;
  const tailMatte = scheme.tail
    ? metalMaterial(skin, { roughness: 0.62, metalness: 0.2, color: scheme.tail })
    : matteMat;
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xa8c6d8,
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity: 0.38,
    transmission: 0,
    side: THREE.DoubleSide,
  });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95, metalness: 0 });
  const strutMat = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.35, metalness: 0.75 });

  /* ---------------- Fuselage ---------------- */
  const profile = [
    [0.05, -2.55],
    [0.30, -2.42],
    [0.50, -2.15],
    [0.62, -1.7],
    [0.70, -1.1],
    [0.76, -0.3],
    [0.78, 0.45],
    [0.75, 1.15],
    [0.66, 1.95],
    [0.52, 2.7],
    [0.34, 3.35],
    [0.18, 3.85],
    [0.05, 3.95],
  ].map(([r, z]) => new THREE.Vector2(r * S.bodyRadius, z * S.bodyLength));
  /**
   * Fuselage radius at a station, straight off the same profile the body is
   * lathed from. Anything that has to sit on the skin — windows, pylons —
   * asks this rather than assuming the body is a tube of constant width.
   */
  const bodyRadiusAt = (z) => {
    if (z <= profile[0].y) return profile[0].x;
    for (let i = 1; i < profile.length; i++) {
      if (z <= profile[i].y) {
        const a = profile[i - 1];
        const b = profile[i];
        const t = (z - a.y) / (b.y - a.y || 1);
        return lerp(a.x, b.x, t);
      }
    }
    return profile[profile.length - 1].x;
  };
  /** Half-width of the body at this station and this height above the axis. */
  const bodyHalfWidthAt = (z, y) => {
    const r = bodyRadiusAt(z);
    return Math.sqrt(Math.max(0.0001, r * r - y * y));
  };

  const fuseGeo = new THREE.LatheGeometry(profile, 26);
  fuseGeo.rotateX(Math.PI / 2); // lathe axis Y → Z, nose toward -Z
  const fuselage = new THREE.Mesh(fuseGeo, bodyMat);
  fuselage.castShadow = fuselage.receiveShadow = true;
  root.add(fuselage);

  // Cabin roof blister so the greenhouse is not a bare tube.
  // A fast jet has a bubble canopy instead, and an airliner a row of windows.
  if (S.canopy === 'cabin') {
  const roof = new THREE.Mesh(
    new THREE.SphereGeometry(0.82, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
    bodyMat
  );
  // Kept aft of the eye point (z = -0.28): a blister that reaches forward of
  // the pilot's head fills the entire cockpit view with painted metal.
  roof.scale.set(1, 0.52, 1.15);
  roof.position.set(0, 0.28, 0.88);
  roof.castShadow = true;
  root.add(roof);
  }

  // Windshield and side glass.
  const wsGeo = new THREE.SphereGeometry(0.86, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.46);
  const windshield = new THREE.Mesh(wsGeo, glassMat);
  windshield.scale.set(0.96, 0.7, 1.15);
  windshield.position.set(0, 0.22, -0.62);
  windshield.rotation.x = -0.3;
  root.add(windshield);

  if (S.canopy === 'cabin') {
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.62), glassMat);
      w.position.set(side * 0.75, 0.28, -0.1);
      w.rotation.y = side * Math.PI * 0.5;
      root.add(w);
      const w2 = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.5), glassMat);
      w2.position.set(side * 0.7, 0.26, 0.95);
      w2.rotation.y = side * Math.PI * 0.5;
      root.add(w2);
    }
  } else if (S.canopy === 'bubble') {
    // A single blown canopy over the pilot, faired into a spine behind.
    const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.62, 20, 14), glassMat);
    bubble.scale.set(0.86, 0.78, 2.0);
    bubble.position.set(0, 0.3, -0.5);
    root.add(bubble);
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 2.4), bodyMat);
    spine.position.set(0, 0.28, 1.35);
    spine.castShadow = true;
    root.add(spine);
  } else if (S.canopy === 'airliner') {
    // Flight-deck glass, then a passenger window line down each side.
    const fd = new THREE.Mesh(new THREE.SphereGeometry(0.72, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), glassMat);
    fd.scale.set(0.95, 0.62, 1.05);
    fd.position.set(0, 0.26, -1.72);
    fd.rotation.x = -0.34;
    root.add(fd);
    // The cabin window line. It used to be a fixed distance out from the
    // centreline, so from about the wing aft — where the body starts tapering
    // into the tail cone — the windows hung in the air beside the aeroplane.
    // Each one now sits on the skin at its own station, and the row stops
    // where the cabin does.
    const winMat = new THREE.MeshStandardMaterial({ color: 0x121a24, roughness: 0.2, metalness: 0.55 });
    const rowGeo = new THREE.BoxGeometry(0.05, 0.16, 0.16);
    const winY = 0.2 * S.bodyRadius;
    const zFrom = -1.35 * S.bodyLength;
    const zTo = 2.5 * S.bodyLength;
    const pitch = 0.34;
    const count = Math.max(4, Math.floor((zTo - zFrom) / pitch));
    for (const side of [-1, 1]) {
      const row = new THREE.InstancedMesh(rowGeo, winMat, count);
      const d = new THREE.Object3D();
      for (let i = 0; i < count; i++) {
        const z = zFrom + i * pitch;
        d.position.set(side * (bodyHalfWidthAt(z, winY) - 0.015), winY, z);
        d.updateMatrix();
        row.setMatrixAt(i, d.matrix);
      }
      row.instanceMatrix.needsUpdate = true;
      root.add(row);
    }
    // A cabin door up front and another at the back, which is what makes the
    // window line read as a cabin rather than a stripe.
    for (const dz of [-1.5 * S.bodyLength, 2.2 * S.bodyLength]) {
      for (const side of [-1, 1]) {
        const door = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.62, 0.34), matteMat);
        door.position.set(side * (bodyHalfWidthAt(dz, 0.06) - 0.012), 0.06, dz);
        root.add(door);
      }
    }
  }

  // Engine cowling with a slightly different sheen, plus air intakes.
  // Slightly slimmer and lower than the fuselage line, so that from the cockpit
  // it sits below the horizon instead of hiding it.
  if (!isJet) {
    const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.46, 0.9, 20), matteMat);
    cowl.rotation.x = Math.PI / 2;
    cowl.position.set(0, -0.06, -2.05 * S.bodyLength);
    cowl.castShadow = true;
    root.add(cowl);
    for (const side of [-1, 1]) {
      const intake = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.2), rubber);
      intake.position.set(side * 0.3, -0.16, -2.46 * S.bodyLength);
      root.add(intake);
    }
  }

  /* ---------------- Wings ---------------- */
  // Thin, sharp sections for anything fast; thick and cambered for the ones
  // that have to fly slowly.
  const fast = S.sweep > 1.4;
  const wingProfile = aerofoil(16, fast ? 0.075 : 0.135, fast ? 0.006 : 0.025);
  const halfSpan = S.halfSpan;
  // Chord, sweep and dihedral all interpolate from root to tip, so one set of
  // knobs describes a straight strut-braced wing and a swept jet wing alike.
  const stations = [0, 0.22, 0.62, 0.92, 1];
  const wingSections = stations.map((f) => ({
    y: f * halfSpan,
    // Taper is gentle inboard and quicker outboard, like a real planform.
    chord: lerp(S.rootChord, S.tipChord, Math.pow(f, 1.25)),
    offsetX: S.sweep * Math.pow(f, 1.1),
    offsetY: S.dihedral * f,
  }));
  const chordAt = (f) => lerp(S.rootChord, S.tipChord, Math.pow(f, 1.25));
  const sweepAt = (f) => S.sweep * Math.pow(f, 1.1);
  const wingGeo = loft(wingSections, wingProfile);

  const wings = new THREE.Group();
  for (const side of [-1, 1]) {
    const w = new THREE.Mesh(wingGeo, bodyMat);
    w.scale.x = side;
    w.position.set(side * S.wingRootX, S.wingY, S.wingZ);
    w.castShadow = w.receiveShadow = true;
    wings.add(w);
  }
  root.add(wings);

  // Wing struts (the classic high-wing braces).
  if (S.struts) for (const side of [-1, 1]) {
    for (const [ax, az, bx, bz] of [
      [side * 0.66, -0.42, side * 3.1, -0.75],
      [side * 0.66, -0.42, side * 3.0, 0.15],
    ]) {
      const a = new THREE.Vector3(ax, -0.35, az);
      const b = new THREE.Vector3(bx, 0.66, bz);
      const dir = new THREE.Vector3().subVectors(b, a);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, dir.length(), 8), strutMat);
      strut.position.copy(a).addScaledVector(dir, 0.5);
      strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      strut.castShadow = true;
      root.add(strut);
    }
  }

  // Ailerons and flaps on hinges, so they visibly deflect.
  const surfaces = {};
  function hingedSurface(width, chord, thickness = 0.055) {
    const g = new THREE.BoxGeometry(width, thickness, chord);
    g.translate(0, 0, chord / 2);
    const m = new THREE.Mesh(g, matteMat);
    m.castShadow = true;
    const pivot = new THREE.Group();
    pivot.add(m);
    return pivot;
  }

  // The moving surfaces ride on the wing's trailing edge, wherever the shape
  // description happens to have put it.
  const hinge = (f, chordFrac) => {
    const c = chordAt(f) * chordFrac;
    return {
      x: S.wingRootX + f * halfSpan,
      y: S.wingY + S.dihedral * f + 0.14,
      z: S.wingZ + sweepAt(f) + chordAt(f) - c * 0.9,
      chord: c,
    };
  };
  const ailAt = hinge(0.78, 0.26);
  const flapAt = hinge(0.4, 0.27);
  const ailWidth = halfSpan * 0.32;
  const flapWidth = halfSpan * 0.36;
  surfaces.aileronL = hingedSurface(ailWidth, ailAt.chord);
  surfaces.aileronL.position.set(-ailAt.x, ailAt.y, ailAt.z);
  surfaces.aileronR = hingedSurface(ailWidth, ailAt.chord);
  surfaces.aileronR.position.set(ailAt.x, ailAt.y, ailAt.z);
  surfaces.flapL = hingedSurface(flapWidth, flapAt.chord);
  surfaces.flapL.position.set(-flapAt.x, flapAt.y, flapAt.z);
  surfaces.flapR = hingedSurface(flapWidth, flapAt.chord);
  surfaces.flapR.position.set(flapAt.x, flapAt.y, flapAt.z);
  root.add(surfaces.aileronL, surfaces.aileronR, surfaces.flapL, surfaces.flapR);

  /* ---------------- Tail ---------------- */
  const tailProfile = aerofoil(12, 0.1, 0);
  const hSweep = fast ? S.hRootChord * 0.7 : S.hRootChord * 0.16;
  const hStabGeo = loft(
    [
      { y: 0, chord: S.hRootChord, offsetX: 0 },
      { y: S.hSpan * 0.6, chord: S.hRootChord * 0.86, offsetX: hSweep * 0.6 },
      { y: S.hSpan, chord: S.hRootChord * 0.7, offsetX: hSweep },
    ],
    tailProfile
  );
  for (const side of [-1, 1]) {
    const h = new THREE.Mesh(hStabGeo, bodyMat);
    h.scale.x = side;
    h.position.set(side * 0.12, 0.14, S.hZ);
    h.castShadow = true;
    root.add(h);
  }
  surfaces.elevator = hingedSurface(S.hSpan * 2.1, S.hRootChord * 0.42);
  surfaces.elevator.position.set(0, 0.2, S.hZ + S.hRootChord * 0.82 + hSweep * 0.2);
  root.add(surfaces.elevator);

  const vStabGeo = loft(
    [
      { y: 0, chord: S.finRootChord, offsetX: 0 },
      { y: S.finHeight * 0.52, chord: S.finRootChord * 0.85, offsetX: S.finSweep * 0.45 },
      { y: S.finHeight, chord: S.finRootChord * 0.62, offsetX: S.finSweep },
    ],
    tailProfile
  );
  const fin = new THREE.Mesh(vStabGeo, tailMat);
  fin.rotation.z = Math.PI / 2; // span becomes vertical
  fin.position.set(0, 0.18, S.finZ);
  fin.castShadow = true;
  root.add(fin);
  // Dorsal fillet.
  const fillet = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, S.finRootChord * 0.73), tailMat);
  fillet.position.set(0, 0.42, S.finZ - S.finRootChord * 0.3);
  root.add(fillet);

  surfaces.rudder = (() => {
    const h = S.finHeight * 0.85;
    const c = S.finRootChord * 0.35;
    const g = new THREE.BoxGeometry(0.06, h, c);
    g.translate(0, h / 2, c / 2);
    const m = new THREE.Mesh(g, tailMatte);
    m.castShadow = true;
    const pivot = new THREE.Group();
    pivot.add(m);
    pivot.position.set(0, 0.3, S.finZ + S.finRootChord * 0.55 + S.finSweep * 0.35);
    return pivot;
  })();
  root.add(surfaces.rudder);

  // An arrester hook, on the one that is meant to catch a wire.
  if (S.hook) {
    const hookArm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.5, 8), strutMat);
    hookArm.rotation.x = Math.PI / 2 - 0.42;
    hookArm.position.set(0, -0.5, S.hZ + 0.5);
    hookArm.castShadow = true;
    root.add(hookArm);
    const claw = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.05, 6, 12, Math.PI), strutMat);
    claw.position.set(0, -1.05, S.hZ + 1.25);
    claw.rotation.x = Math.PI / 2;
    root.add(claw);
  }

  /* ---------------- Landing gear ---------------- */
  function wheel(radius, width) {
    const g = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.78, radius * 0.26, 8, 16), rubber);
    tyre.rotation.y = Math.PI / 2;
    g.add(tyre);
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, width, 12),
      new THREE.MeshStandardMaterial({ color: 0xd7dbe0, roughness: 0.4, metalness: 0.6 })
    );
    hub.rotation.z = Math.PI / 2;
    g.add(hub);
    g.castShadow = true;
    return g;
  }

  const gear = { legs: [] };

  // The drawn wheels are positioned so their tyres touch exactly where
  // SPEC.gearPoints says the ground contact is — nose (0, -1.42, -1.15) and
  // mains (±1.42, -1.50, 0.42). Otherwise the aeroplane looks like it is
  // hovering or buried.
  const NOSE_R = S.wheelR.nose * (0.78 + 0.26); // tyre outer radius
  const MAIN_R = S.wheelR.main * (0.78 + 0.26);

  // Nose gear: strut + wheel, steers with the rudder pedals.
  const noseLeg = new THREE.Group();
  noseLeg.position.set(0, -0.42, S.nose.z);
  const noseWheelY = S.nose.y + NOSE_R - noseLeg.position.y; // local Y of the hub
  const noseStrut = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.09, Math.abs(noseWheelY), 10),
    strutMat
  );
  noseStrut.position.y = noseWheelY / 2;
  noseStrut.castShadow = true;
  noseLeg.add(noseStrut);
  const noseSteer = new THREE.Group();
  noseSteer.position.y = noseWheelY;
  const noseWheel = wheel(S.wheelR.nose, 0.16);
  noseSteer.add(noseWheel);
  noseLeg.add(noseSteer);
  root.add(noseLeg);
  gear.nose = { leg: noseLeg, steer: noseSteer, wheel: noseWheel };
  gear.legs.push(noseLeg);

  // Main gear: sprung tapered legs with fairings, Cessna style.
  gear.mains = [];
  for (const side of [-1, 1]) {
    const legGroup = new THREE.Group();
    const legRootX = S.main.x * 0.39;
    legGroup.position.set(side * legRootX, -0.35, S.main.z);
    // Hub position in the leg's local space.
    const hubX = S.main.x - legRootX;
    const hubY = S.main.y + MAIN_R - legGroup.position.y;
    const legLen = Math.hypot(hubX, hubY);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, legLen, 8), strutMat);
    leg.geometry.translate(0, -legLen / 2, 0);
    leg.rotation.z = side * Math.atan2(hubX, -hubY);
    leg.castShadow = true;
    legGroup.add(leg);
    const w = wheel(S.wheelR.main, 0.2);
    w.position.set(side * hubX, hubY, 0);
    legGroup.add(w);
    // Spats belong on fixed gear. On a retractable they would be stowed with
    // the leg, and drawn here they just look like the wheel is swollen.
    if (!S.retractable) {
      const fairing = new THREE.Mesh(new THREE.SphereGeometry(S.wheelR.main * 0.94, 12, 8), matteMat);
      fairing.scale.set(0.7, 0.7, 1.5);
      fairing.position.copy(w.position);
      legGroup.add(fairing);
    }
    root.add(legGroup);
    gear.mains.push({ group: legGroup, wheel: w, side });
    gear.legs.push(legGroup);
  }

  /* ---------------- Powerplant ---------------- */
  // Jets get nacelles and a nozzle that glows under power; propeller
  // aeroplanes get a spinner, blades and a blur disc.
  const nozzles = [];
  if (isJet) {
    const P = S.power;
    const nacelleMat = metalMaterial(skin, { roughness: 0.3, metalness: 0.72 });
    const hotMat = new THREE.MeshStandardMaterial({
      color: 0x2a2320,
      emissive: 0xff7020,
      emissiveIntensity: 0,
      roughness: 0.55,
      metalness: 0.4,
    });
    const sides = P.count === 2 ? [-1, 1] : [0];
    for (const side of sides) {
      const g = new THREE.Group();
      // Barrel, tapering slightly to the back.
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(P.radius, P.radius * 0.86, P.length * 2, 20, 1, true),
        nacelleMat
      );
      body.rotation.x = Math.PI / 2;
      body.castShadow = true;
      g.add(body);
      // Intake lip.
      const lip = new THREE.Mesh(new THREE.TorusGeometry(P.radius, P.radius * 0.11, 8, 22), nacelleMat);
      lip.position.z = -P.length;
      g.add(lip);
      // The dark throat, so the intake reads as a hole rather than a disc.
      const throat = new THREE.Mesh(
        new THREE.CircleGeometry(P.radius * 0.9, 20),
        new THREE.MeshBasicMaterial({ color: 0x0a0c10 })
      );
      throat.position.z = -P.length + 0.16;
      g.add(throat);
      // Fan face, just visible inside.
      const fan = new THREE.Mesh(
        new THREE.CircleGeometry(P.radius * 0.85, 20),
        new THREE.MeshStandardMaterial({ color: 0x8b939c, roughness: 0.3, metalness: 0.85 })
      );
      fan.position.z = -P.length + 0.2;
      g.add(fan);
      // Exhaust nozzle.
      const nozzle = new THREE.Mesh(
        new THREE.CylinderGeometry(P.radius * 0.78, P.radius * 0.6, P.length * 0.4, 18, 1, true),
        hotMat
      );
      nozzle.rotation.x = Math.PI / 2;
      nozzle.position.z = P.length * 1.1;
      g.add(nozzle);
      nozzles.push(nozzle.material);
      if (P.count === 2) {
        // Slung under the wing on a pylon that actually reaches it. The engine
        // used to sit a quarter of a metre below the wing with a radius of
        // more than twice that, so the top of the nacelle came up through the
        // wing surface.
        const f = (Math.abs(P.x) - S.wingRootX) / S.halfSpan;
        const wingUnderside = S.wingY - 0.06;
        const gap = wingUnderside - (P.y + P.radius);
        const pylon = new THREE.Mesh(
          new THREE.BoxGeometry(0.18, Math.max(0.12, gap + 0.2), P.length * 0.9),
          bodyMat
        );
        pylon.position.set(0, P.radius + Math.max(0.12, gap + 0.2) / 2 - 0.06, P.length * 0.35);
        pylon.castShadow = true;
        g.add(pylon);
      }
      g.position.set(side * (P.x || 0), P.y, P.z);
      root.add(g);
    }
    if (P.afterburner) {
      // A flame that only appears at high power.
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(P.radius * 0.55, P.length * 2.4, 14, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xffa64d,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      flame.rotation.x = -Math.PI / 2;
      flame.position.set(0, P.y, P.z + P.length * 2.3);
      root.add(flame);
      nozzles.afterburner = flame;
    }
  }

  /*
   * Propellers — one on the nose, or one per wing.
   *
   * `power.count` was read only inside the JET branch, so a type declaring two
   * propellers got exactly one, on the centreline, and its `x` nacelle offset
   * was dead data. The Tempest is a twin-turboprop and rendered as a single —
   * and the comment on its own power block asserted that the model "draws one
   * or two", which was true of jets and false of propellers, so the bug was
   * hidden behind a statement that made it look checked.
   */
  const propGroup = new THREE.Group();
  propGroup.visible = !isJet;
  const propCount = isJet ? 0 : S.power.count || 1;
  const propSides = propCount >= 2 ? [-1, 1] : [0];
  propGroup.position.set(0, 0.02, propCount >= 2 ? 0 : S.power.z);
  const spinMat = metalMaterial(skin, { roughness: 0.2, metalness: 0.7 });
  const nacelleMatProp = metalMaterial(skin, { roughness: 0.34, metalness: 0.5 });
  /** One spinner, blades and blur disc, at a given wing station. */
  const propUnit = (sx) => {
    const unit = new THREE.Group();
    unit.position.set(sx * (propCount >= 2 ? S.power.x || 2.6 : 0), 0, propCount >= 2 ? S.power.z : 0);
    // A twin carries its engines in nacelles; a single has its cowl already.
    if (propCount >= 2) {
      const nac = new THREE.Mesh(
        new THREE.CylinderGeometry(S.power.radius || 0.5, (S.power.radius || 0.5) * 0.82, S.power.length ? S.power.length * 2.2 : 2.4, 14),
        nacelleMatProp
      );
      nac.rotation.x = Math.PI / 2;
      nac.position.z = 0.9;
      nac.castShadow = true;
      unit.add(nac);
    }
    const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.55, 16), spinMat);
    spinner.rotation.x = -Math.PI / 2;
    spinner.position.z = -0.2;
    spinner.castShadow = true;
    unit.add(spinner);
    return unit;
  };

  const bladeMat = new THREE.MeshStandardMaterial({ map: propTexture(), roughness: 0.5, metalness: 0.3 });
  /** The spinning parts, so update() can turn every propeller on the aircraft. */
  const spinners = [];
  for (const sx of propSides) {
  const unit = propUnit(sx);
  const blades = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    // Blade length matches the blur disc it fades into (radius ~1.05 m, so a
    // 2.1 m propeller — right for an aeroplane this size). It used to reach
    // 1.85 m, which from the cockpit looked like a grey plank laid across the
    // windscreen and stuck out well past the disc from outside.
    const bladeLen = S.power.propRadius * 0.95;
    const bl = new THREE.Mesh(new THREE.BoxGeometry(0.13, bladeLen, 0.045), bladeMat);
    bl.geometry.translate(0, bladeLen / 2 + 0.02, 0);
    bl.rotation.z = i * Math.PI;
    bl.rotation.y = 0.34 * (i === 0 ? 1 : -1);
    bl.castShadow = true;
    blades.add(bl);
  }
  unit.add(blades);

  const disc = new THREE.Mesh(
    new THREE.PlaneGeometry(S.power.propRadius * 2, S.power.propRadius * 2),
    new THREE.MeshBasicMaterial({
      map: propBlurTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  disc.position.z = -0.05;
  unit.add(disc);
  propGroup.add(unit);
  spinners.push({ blades, disc });
  }
  root.add(propGroup);

  /* ---------------- Lights ---------------- */
  const lights = {};
  // On the wing tips, wherever this aeroplane's wing tips happen to be.
  const tipX = S.wingRootX + S.halfSpan;
  const tipY = S.wingY + S.dihedral + 0.16;
  const tipZ = S.wingZ + S.sweep + S.tipChord * 0.35;
  lights.navLeft = glowSprite(0xff2020, 0.42);
  lights.navLeft.position.set(-tipX, tipY, tipZ);
  lights.navRight = glowSprite(0x20ff40, 0.42);
  lights.navRight.position.set(tipX, tipY, tipZ);
  lights.tail = glowSprite(0xffffff, 0.3);
  lights.tail.position.set(0, 0.28, 3.95 * S.bodyLength);
  lights.strobeL = glowSprite(0xffffff, 0.8);
  lights.strobeL.position.set(-tipX, tipY, tipZ + 0.1);
  lights.strobeR = glowSprite(0xffffff, 0.8);
  lights.strobeR.position.set(tipX, tipY, tipZ + 0.1);
  lights.landing = glowSprite(0xfff0c0, 0.75);
  lights.landing.position.set(-tipX * 0.32, S.wingY - 0.06, S.wingZ - 0.45);
  for (const k in lights) root.add(lights[k]);
  // Base sizes, so the day/night scaling below has something to scale from.
  for (const k in lights) lights[k].userData.baseScale = lights[k].scale.x;

  // A real spot for the landing light so it actually lights the runway.
  const landingSpot = new THREE.SpotLight(0xfff0c8, 0, 260, 0.34, 0.45, 1.2);
  landingSpot.position.set(0, 0.4, -1.6);
  const spotTarget = new THREE.Object3D();
  spotTarget.position.set(0, -0.3, -60);
  root.add(spotTarget);
  landingSpot.target = spotTarget;
  root.add(landingSpot);

  /* ---------------- Cabin interior (seen through the glass) ---------- */
  const seatMat = new THREE.MeshStandardMaterial({ map: leatherTexture('#2b2119'), roughness: 0.8 });
  if (S.canopy === 'cabin') for (const side of [-1, 1]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.44), seatMat);
    seat.position.set(side * 0.3, -0.22, 0.1);
    root.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.1), seatMat);
    back.position.set(side * 0.3, 0.02, 0.34);
    root.add(back);
  }

  const state = {
    propAngle: 0,
    wheelAngle: 0,
    strobeT: 0,
    surfaces,
    gear,
    lights,
    landingSpot,
    // Every propeller, so a twin turns both. `disc`/`blades` are kept as the
    // first unit so anything outside that still reaches for them works.
    spinners,
    disc: spinners[0] ? spinners[0].disc : null,
    blades: spinners[0] ? spinners[0].blades : null,
    propGroup,
    glassMat,
    nozzles,
    isJet,
    type,
    shape: S,
  };

  /**
   * Animate the model from the flight model's state.
   * `ctrl` carries the raw control inputs so the surfaces move with the stick.
   */
  root.userData.update = function update(dt, ac, weather) {
    const c = ac.controls;
    // In daylight, aircraft lights are barely visible; at night they are the
    // whole show. Scaling both size and opacity keeps them from looking like
    // glowing blobs stuck to the wings on a sunny afternoon.
    const dark = weather ? (weather.isNight ? 1 : weather.cond.cloud > 0.75 ? 0.55 : 0.18) : 0.5;

    if (state.isJet) {
      // Jets: the nozzle heats up with power, and the afterburner lights at
      // the top of the range.
      const heat = clamp((ac.rpm - 0.35) / 0.65, 0, 1);
      for (const m of state.nozzles) m.emissiveIntensity = heat * 2.4;
      const ab = state.nozzles.afterburner;
      if (ab) {
        const lit = clamp((ac.rpm - 0.86) / 0.14, 0, 1);
        ab.material.opacity = lit * 0.75;
        ab.visible = lit > 0.01;
        // Flicker, so it does not look like a painted cone.
        ab.scale.set(1, 0.85 + Math.sin(state.strobeT * 47) * 0.12 + lit * 0.3, 1);
      }
    } else {
      // Propeller: spin, and fade in the blur disc as it speeds up.
      const rpmHz = ac.rpm * 42;
      state.propAngle += rpmHz * dt * Math.PI * 2;
      const blur = clamp((ac.rpm - 0.22) / 0.45, 0, 1);
      // Every propeller on the aircraft, not just the one on the centreline.
      for (let i = 0; i < state.spinners.length; i++) {
        const sp = state.spinners[i];
        // Counter-rotating on a twin, which is what stops the torque roll the
        // flight model already declines to apply to multi-engine types.
        sp.blades.rotation.z = state.spinners.length > 1 && i === 1 ? -state.propAngle : state.propAngle;
        sp.disc.material.opacity = blur * 0.5;
        sp.blades.visible = blur < 0.98;
      }
    }

    // Control surfaces.
    const s = state.surfaces;
    s.elevator.rotation.x = lerp(s.elevator.rotation.x, -c.pitch * 0.4, clamp(dt * 12, 0, 1));
    s.rudder.rotation.y = lerp(s.rudder.rotation.y, -c.yaw * 0.42, clamp(dt * 12, 0, 1));
    const ail = c.roll * 0.36;
    s.aileronL.rotation.x = lerp(s.aileronL.rotation.x, ail, clamp(dt * 12, 0, 1));
    s.aileronR.rotation.x = lerp(s.aileronR.rotation.x, -ail, clamp(dt * 12, 0, 1));
    const flap = (ac.flaps || 0) * 0.55;
    s.flapL.rotation.x = lerp(s.flapL.rotation.x, flap, clamp(dt * 6, 0, 1));
    s.flapR.rotation.x = lerp(s.flapR.rotation.x, flap, clamp(dt * 6, 0, 1));

    // Gear: retract by folding the legs up and hiding them when stowed.
    const g = ac.gearPos;
    state.gear.nose.leg.rotation.x = (1 - g) * 1.5;
    state.gear.nose.leg.visible = g > 0.02;
    state.gear.nose.steer.rotation.y = -c.yaw * 0.5 * clamp(1 - ac.groundSpeed / 40, 0.15, 1);
    for (const m of state.gear.mains) {
      m.group.rotation.z = (1 - g) * m.side * -1.35;
      m.group.visible = g > 0.02;
    }
    // Wheels spin while rolling.
    if (ac.onGround) {
      state.wheelAngle += (ac.groundSpeed / state.shape.wheelR.main) * dt;
      state.gear.nose.wheel.rotation.x = state.wheelAngle;
      for (const m of state.gear.mains) m.wheel.rotation.x = state.wheelAngle;
    }

    // Lights.
    state.strobeT += dt;
    const strobe = state.strobeT % 1.3 < 0.06 || (state.strobeT % 1.3 > 0.13 && state.strobeT % 1.3 < 0.19);
    const running = ac.engineOn || ac.rpm > 0.05;
    state.lights.navLeft.visible = running;
    state.lights.navRight.visible = running;
    state.lights.tail.visible = running;
    state.lights.strobeL.visible = running && strobe;
    state.lights.strobeR.visible = running && strobe;
    const wantLanding = running && (ac.gearDown || ac.agl < 400);
    state.lights.landing.visible = wantLanding;
    state.landingSpot.intensity = wantLanding ? 190 * (0.25 + dark * 0.75) : 0;

    for (const k in state.lights) {
      const l = state.lights[k];
      const base = l.userData.baseScale || 1;
      const boost = k === 'landing' ? 1.6 : 1;
      l.scale.setScalar(base * (0.55 + dark * 0.75) * boost);
      l.material.opacity = 0.35 + dark * 0.65;
    }
  };

  root.userData.parts = state;
  // Built at trainer scale throughout, then sized. The flight model's contact
  // points are scaled by exactly the same number in types.js, so the wheels
  // touch the ground where they appear to.
  root.scale.setScalar(S.scale);
  return root;
}
