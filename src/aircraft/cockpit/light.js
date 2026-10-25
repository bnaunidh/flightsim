/**
 * Light aircraft: the Skylark 172, the Kestrel Courier and the Tempest WR-4.
 *
 * Seen from the left seat, what makes these read as real aeroplanes is not
 * the instruments alone, it is the room: the windscreen meeting the door
 * posts where the outside says it does, a padded glareshield sitting on the
 * windscreen's sill, the six-pack in front of you with the radios beside it,
 * two control wheels, push-pull knobs (or a power quadrant in the twin), the
 * headliner over your head and a passenger seat beside you.
 *
 * The room is cut from the aeroplane's own fuselage (canopy.js
 * interiorShell): every opening is the exterior's window, every frame sits
 * on the exterior's window line. Everything else is placed relative to
 * that — the glareshield from the windscreen's sill, the panel a hand's
 * width behind it and as wide as the cabin is there, the wheels in front of
 * each seat — so none of it is a number that only fits one aeroplane.
 *
 * The instruments are gauges.js: painted once, needles and cards turned by
 * meshes, nothing repainted per frame.
 */

import * as THREE from '../../vendor/three.module.js';
import { clamp, lerp } from '../../core/noise.js';
import { leatherTexture, panelTexture, panelNormal } from '../../render/textures.js';
import { performanceFor } from '../types.js';
import { glazingOf, interiorShell, windscreenOf, lineAt } from './canopy.js';
import { GaugePanel } from './gauges.js';
import { label, roundRect, wrinkle, DIM, TEXT } from './paint.js';
import { TRAINER_EYE, warningLamps, cockpitEnv, rainMaterial, updateRain, ease } from './common.js';
import { carveExterior, insideOnly, mergeStatic } from './kit.js';

/* ------------------------------------------------------------------ *
 * Per-type character
 * ------------------------------------------------------------------ */

const LIGHT = {
  /*
   * A 172: grey wrinkle panel, cream headliner, putty sidewalls, grey
   * fabric seats. Throttle and mixture are push-pull knobs, the flaps an
   * electric switch, the trim a wheel between the seats, a wet compass on
   * the windscreen's centre strip.
   */
  skylark: {
    reg: 'N172SK',
    model: 'SKYLARK 172',
    trim: { head: '#d8d2c2', wall: '#b3ad9f', low: '#6c6a66', floor: '#3b3c40', frame: '#3a3c40' },
    panel: '#2e3238',
    glare: '#1b1c1f',
    seat: '#6a6862',
    seatTrim: '#4a4844',
    controls: 'plungers2',
    engines: 1,
    gear: 'fixed',
    compass: true,
    tach: { max: 3500, green: [2100, 2700], red: 2700, label: 'RPM', scale: 2700 },
    rearSeats: true,
    back: 0.08,
  },
  /*
   * A Bonanza-type tourer: darker blue-grey cabin, tan leather, three
   * push-pull knobs (throttle, propeller, mixture), a manifold pressure
   * gauge beside the tach, and the wheel-shaped gear handle with its three
   * green lights.
   */
  courier: {
    reg: 'N8PC',
    model: 'KESTREL COURIER',
    trim: { head: '#c9c6bf', wall: '#4f5865', low: '#353b44', floor: '#24272c', frame: '#22262c' },
    panel: '#2a2e35',
    glare: '#17191c',
    seat: '#8a6a4a',
    seatTrim: '#5b4532',
    controls: 'plungers3',
    engines: 1,
    gear: 'retract',
    compass: true,
    tach: { max: 3500, green: [2100, 2700], red: 2700, label: 'RPM', scale: 2700 },
    manifold: true,
    rearSeats: true,
    back: 0.05,
  },
  /*
   * A twin-turboprop research aeroplane: a crew of two on a grey flight
   * deck, a power quadrant between the seats (two power levers, two
   * condition levers), twin engine instruments — torque, propeller rpm,
   * turbine temperature — and the weather radar the whole aeroplane is
   * built to carry, sweeping. A bulkhead behind the seats closes the
   * flight deck off from the cabin of research racks.
   */
  tempest: {
    reg: 'N4WR',
    model: 'TEMPEST WR-4',
    trim: { head: '#b9bcbf', wall: '#7d8388', low: '#4a4f55', floor: '#2b2e33', frame: '#2a2d31' },
    panel: '#2b2f34',
    glare: '#17191c',
    seat: '#3d4248',
    seatTrim: '#2a2e33',
    controls: 'quadrant2',
    engines: 2,
    gear: 'retract',
    compass: false,
    radar: true,
    rearSeats: false,
    back: 0.62,
  },
};

/** The ASI's arcs from the aeroplane's own aerodynamics, as the hangar quotes them. */
function speedArcs(id, type) {
  let p = null;
  try {
    p = performanceFor(id);
  } catch (e) {
    p = null;
  }
  const vne = p ? p.vne : Math.round(((type && type.aero && type.aero.vne) || 82) * 1.94384);
  const vs1 = p ? p.stallClean : Math.round(vne * 0.3);
  const vs0 = p ? p.stallLanding : Math.round(vs1 * 0.9);
  const vno = Math.round(vne * 0.81);
  const vfe = Math.round(Math.min(vno - 5, vs0 * 1.9));
  const top = Math.ceil((vne * 1.08) / 20) * 20;
  const min = Math.max(20, Math.floor((vs0 * 0.75) / 10) * 10);
  const majorStep = top - min > 180 ? 40 : 20;
  return { min, max: top, white: [vs0, vfe], green: [vs1, vno], yellow: [vno, vne], red: vne, step: majorStep / 2, majorStep };
}

/* ------------------------------------------------------------------ *
 * The builder
 * ------------------------------------------------------------------ */

export function buildLightCockpit(ctx) {
  const { type, model, space, highContrast } = ctx;
  const id = type && LIGHT[type.id] ? type.id : 'skylark';
  const C = LIGHT[id];
  const k = space.k;
  const glazing = ctx.glazing || glazingOf(type, model, space);

  const group = new THREE.Group();
  group.name = 'cockpit';
  const E = new THREE.Vector3(...TRAINER_EYE);
  const eyeM = space.toModel(E); // the eye, in model units
  const L = (v, out) => space.toLocal(v, out); // model units -> cockpit metres
  const cx = L([0, 0, 0]).x; // the cabin's centreline, in cockpit metres
  const pilotX = E.x;
  const copilotX = 2 * cx - E.x;

  /* ================================================================ *
   * The room, cut from the fuselage
   * ================================================================ */
  const ws = windscreenOf(glazing);
  const wsZ0 = ws ? ws.z0 : eyeM.z - 1.0 / k;
  // Front bulkhead (the firewall) just ahead of the windscreen's sill; back
  // bulkhead behind the last window of the cabin — or, in the Tempest,
  // just behind the crew seats.
  const lastGlass = Math.max(...glazing.windows.map((w) => w.z1));
  const zFront = wsZ0 - 0.03 / k;
  let zBack = C.back < 0.5 ? lastGlass + C.back / k : eyeM.z + C.back / k;
  zBack = Math.min(zBack, glazing.hull.zMax - 0.2);
  const tc = {
    head: new THREE.Color(C.trim.head),
    wall: new THREE.Color(C.trim.wall),
    low: new THREE.Color(C.trim.low),
    floor: new THREE.Color(C.trim.floor),
  };
  // Colour by height above the eye's own level (model units): headliner
  // above the windows, sidewall between, darker below the belt, carpet on
  // the floor. Blended over a few centimetres so there are no hard seams.
  const _c = new THREE.Color();
  const eyeY = eyeM.y;
  const colourAt = (p) => {
    const y = (p.y - eyeY) * k; // metres above the eye
    if (y > 0.12) return _c.copy(tc.wall).lerp(tc.head, clamp((y - 0.12) / 0.06, 0, 1)).clone();
    if (y > -0.42) return _c.copy(tc.low).lerp(tc.wall, clamp((y + 0.42) / 0.06, 0, 1)).clone();
    return _c.copy(tc.floor).lerp(tc.low, clamp((y + 0.72) / 0.08, 0, 1)).clone();
  };
  const fabric = leatherTexture('#9a978f');
  const wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, map: fabric });
  const frameMat = new THREE.MeshStandardMaterial({ color: C.trim.frame, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide });
  const capMat = new THREE.MeshStandardMaterial({ color: C.trim.low, roughness: 0.85, side: THREE.DoubleSide });
  const backMat = new THREE.MeshStandardMaterial({ color: C.trim.wall, roughness: 0.9, side: THREE.DoubleSide, map: fabric });
  const rainMat = rainMaterial({ depthTest: true });
  rainMat.side = THREE.DoubleSide;
  const shell = interiorShell(glazing, {
    z0: zFront,
    z1: zBack,
    inset: 0.035 / k,
    frame: 0.03 / k,
    frameZ: 0.03 / k,
    maxStep: 0.08 / k,
    radial: 30,
    colourAt,
    materials: { wall: wallMat, frame: frameMat, glass: rainMat, cap: capMat, back: backMat },
  });
  const ext = space.exteriorGroup();
  ext.add(shell.group);
  group.add(ext);

  /* ---- Reference heights from the shell, in cockpit metres ---- */
  const toL = (p) => L(p, new THREE.Vector3());
  // The windscreen's sill on the inner skin, centre outward (right side).
  const sillM = ws ? shell.sill(ws, 16) : [];
  const sill = sillM.map(toL);
  const sillZ = sill.length ? sill[0].z : E.z - 1.0;
  /** Glareshield height at lateral offset |x - cx|: on the sill, else its end. */
  const sillY = (dx) => {
    if (!sill.length) return E.y - 0.18;
    const ax = Math.abs(dx);
    for (let i = 1; i < sill.length; i++) {
      const a = sill[i - 1];
      const b = sill[i];
      const xa = a.x - cx;
      const xb = b.x - cx;
      if (ax <= xb) return lerp(a.y, b.y, clamp((ax - xa) / (xb - xa || 1), 0, 1));
    }
    return sill[sill.length - 1].y;
  };
  /** Inner half-width of the cabin at cockpit-local (z, y). */
  const halfW = (z, y) => {
    const m = space.toModel([cx, y, z]);
    return shell.halfWidthAt(m.z, m.y) * k;
  };

  /* ================================================================ *
   * Glareshield
   * ================================================================ */
  const panelZ = sillZ + 0.17; // the panel face, a hand's width behind the sill
  const lipZ = panelZ + 0.05;
  const glareMat = new THREE.MeshStandardMaterial({ map: leatherTexture(C.glare), roughness: 0.82, color: 0xffffff });
  const glareW = halfW(sillZ + 0.05, sillY(0) - 0.04) - 0.006;
  {
    // Lofted across the cabin: front edge on the sill, padded top, rolled
    // lip, and the shadowed underside back to the panel.
    const prof = [
      [sillZ + 0.004, 0.0],
      [sillZ + 0.06, -0.004],
      [lipZ - 0.035, -0.008],
      [lipZ - 0.01, -0.016],
      [lipZ + 0.004, -0.033],
      [lipZ - 0.006, -0.052],
      [lipZ - 0.03, -0.058],
      [panelZ - 0.004, -0.06],
    ];
    const nx = 24;
    const pos = [];
    const uv = [];
    const idx = [];
    for (let i = 0; i <= nx; i++) {
      const dx = -glareW + (2 * glareW * i) / nx;
      const y0 = sillY(dx) - 0.006;
      prof.forEach(([z, dy], j) => {
        pos.push(cx + dx, y0 + dy, z);
        uv.push(i / nx * 4, j / (prof.length - 1));
      });
    }
    const np = prof.length;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < np - 1; j++) {
        const a = i * np + j;
        const b = (i + 1) * np + j;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    glareMat.side = THREE.DoubleSide;
    const glare = new THREE.Mesh(g, glareMat);
    glare.name = 'glareshield';
    group.add(glare);
  }

  /* ================================================================ *
   * Instrument panel
   * ================================================================ */
  const tilt = -0.14; // top leans away, so the face looks up at the pilot
  const panelTopC = sillY(0) - 0.066;
  const panelBot = E.y - 0.74;
  const panelMidY = (panelTopC + panelBot) / 2;
  // Outline in panel (u, v): follows the cabin wall at each height and the
  // glareshield along the top.
  const outline = [];
  const vBot = panelBot - panelMidY;
  const sampleV = (n) => Array.from({ length: n + 1 }, (_, i) => vBot + ((panelTopC - panelBot) * i) / n);
  const wallAt = (v) => Math.min(glareW, halfW(panelZ - Math.sin(-tilt) * v, panelMidY + v) - 0.006);
  const rightEdge = sampleV(10).map((v) => [wallAt(v), v]);
  const topAt = (u) => Math.min(sillY(u) - 0.066, panelTopC + 0.2) - panelMidY;
  // Right side bottom to top, top edge right to left, left side down.
  for (const [u, v] of rightEdge) outline.push([Math.min(u, wallAt(v)), Math.min(v, topAt(u))]);
  const uMax = Math.max(...rightEdge.map((p) => p[0]));
  for (let i = 1; i < 16; i++) {
    const u = uMax - (2 * uMax * i) / 16;
    outline.push([u, topAt(u)]);
  }
  for (const [u, v] of [...rightEdge].reverse()) outline.push([-Math.min(u, wallAt(v)), Math.min(v, topAt(-u))]);
  const pW = uMax * 2 + 0.002;
  const pH = Math.max(...outline.map((p) => p[1])) - vBot + 0.002;
  // The canvas covers [-pW/2, pW/2] x [vBot, vBot + pH]; GaugePanel centres
  // its canvas on (0, 0), so shift the outline to centre it vertically.
  const vShift = vBot + pH / 2;
  const panel = new GaugePanel({
    width: pW,
    height: pH,
    outline: outline.map(([u, v]) => [u, v - vShift]),
    colour: highContrast ? '#1a1d22' : C.panel,
    highContrast,
  });
  panel.group.position.set(cx, panelMidY + vShift, panelZ);
  panel.group.rotation.x = tilt;
  group.add(panel.group);
  // Panel coordinates are now (u, v) about panel.group: v = y - (panelMidY + vShift).
  const V = (y) => y - (panelMidY + vShift);
  const U = (x) => x - cx;
  const topV = (u) => topAt(u) - vShift;

  // The six-pack in front of the pilot.
  const R = 0.05;
  const pitchX = 0.123;
  const pitchY = 0.118;
  const up = U(pilotX);
  const row1 = Math.min(topV(up - pitchX), topV(up + pitchX)) - R * 1.32;
  const row2 = row1 - pitchY;
  const arcs = speedArcs(type ? type.id : 'skylark', type);
  panel.asi({ u: up - pitchX, v: row1, R, ...arcs });
  panel.ai({ u: up, v: row1, R });
  panel.alt({ u: up + pitchX, v: row1, R });
  panel.tc({ u: up - pitchX, v: row2, R: R * 0.92 });
  panel.hi({ u: up, v: row2, R });
  panel.vsi({ u: up + pitchX, v: row2, R: R * 0.92 });

  // Engine instruments right of the radio stack.
  const stack = { u0: U(cx) - 0.075, u1: U(cx) + 0.135 };
  const engU = stack.u1 + 0.075;
  const r2 = R * 0.82;
  const rpmOf = (ac) => clamp(ac.rpm || 0, 0, 1.1);
  const runningOf = (ac) => (ac.engineOn ? 1 : 0);
  const fuelFrac = (ac) => (typeof ac.fuelFraction === 'function' ? ac.fuelFraction() : 0.5);
  if (C.engines === 1) {
    panel.round({
      u: engU,
      v: row1,
      R: r2,
      min: 0,
      max: 35,
      start: -135,
      sweep: 270,
      step: 1,
      major: 5,
      arcs: [[21, 27, '#3ec96a'], [27, 35, '#e8402a']],
      labels: [[0, '0'], [5, '5'], [10, '10'], [15, '15'], [20, '20'], [25, '25'], [30, '30'], [35, '35']],
      labelSize: 13,
      title: 'RPM',
      sub: 'x100',
      value: (s, ac) => (rpmOf(ac) * C.tach.scale) / 100,
    });
    if (C.manifold) {
      panel.round({
        u: engU + 0.105,
        v: row1,
        R: r2 * 0.9,
        min: 10,
        max: 35,
        start: -135,
        sweep: 270,
        step: 1,
        major: 5,
        arcs: [[15, 29, '#3ec96a']],
        labels: [[10, '10'], [15, '15'], [20, '20'], [25, '25'], [30, '30'], [35, '35']],
        labelSize: 13,
        title: 'MAN PRESS',
        sub: 'IN HG',
        // Throttle opens it; altitude takes it away; a stopped engine reads
        // the air outside.
        value: (s, ac) => {
          const amb = 29.9 - ((ac.alt || 0) * 3.28084) / 1000;
          return ac.engineOn ? lerp(13, amb, clamp(ac.controls.throttle, 0, 1)) : amb;
        },
      });
    } else {
      panel.twin({
        u: engU + 0.105,
        v: row1,
        R: r2 * 0.9,
        title: 'FUEL QTY',
        left: { min: 0, max: 1, arcs: [[0, 0.12, '#e8402a']], labels: [[0, 'E'], [1, 'F']], title: 'L' },
        right: { min: 0, max: 1, arcs: [[0, 0.12, '#e8402a']], labels: [[0, 'E'], [1, 'F']], title: 'R' },
        values: (s, ac, env, out) => {
          const f = fuelFrac(ac);
          out[0] = f;
          out[1] = f;
        },
      });
    }
    panel.twin({
      u: engU,
      v: row2,
      R: r2 * 0.9,
      title: 'OIL',
      left: { min: 0, max: 1, arcs: [[0.2, 0.75, '#3ec96a']], labels: [[0, 'C'], [1, 'H']], title: 'TEMP' },
      right: { min: 0, max: 1, arcs: [[0.15, 0.8, '#3ec96a'], [0, 0.1, '#e8402a']], labels: [[0, 'L'], [1, 'H']], title: 'PRESS' },
      rate: 0.6,
      values: (s, ac, env, out) => {
        out[0] = 0.25 + runningOf(ac) * (0.2 + rpmOf(ac) * 0.25);
        out[1] = runningOf(ac) * (0.35 + rpmOf(ac) * 0.4);
      },
    });
    panel.twin({
      u: engU + 0.105,
      v: row2,
      R: r2 * 0.9,
      title: C.manifold ? 'FUEL' : 'EGT  VAC',
      left: C.manifold
        ? { min: 0, max: 1, arcs: [[0, 0.12, '#e8402a']], labels: [[0, 'E'], [1, 'F']], title: 'QTY' }
        : { min: 0, max: 1, labels: [[0, '-'], [1, '+']], title: 'EGT' },
      right: C.manifold
        ? { min: 0, max: 1, labels: [[0, '0'], [1, '20']], title: 'GPH' }
        : { min: 0, max: 1, arcs: [[0.45, 0.65, '#3ec96a']], labels: [[0, '3'], [1, '7']], title: 'SUCTION' },
      values: (s, ac, env, out) => {
        if (C.manifold) {
          out[0] = fuelFrac(ac);
          out[1] = runningOf(ac) * (0.15 + clamp(ac.controls.throttle, 0, 1) * 0.7);
        } else {
          out[0] = runningOf(ac) * (0.3 + clamp(ac.controls.throttle, 0, 1) * 0.5);
          out[1] = runningOf(ac) * 0.55;
        }
      },
    });
  } else {
    // The twin: one column per engine, torque / propeller / turbine temp.
    const eng = (u, n) => {
      panel.round({
        u,
        v: row1,
        R: r2 * 0.92,
        min: 0,
        max: 120,
        start: -135,
        sweep: 270,
        step: 10,
        major: 20,
        arcs: [[0, 100, '#3ec96a'], [100, 120, '#e8402a']],
        labels: [[0, '0'], [40, '40'], [80, '80'], [120, '120']],
        labelSize: 13,
        title: `TORQUE ${n}`,
        sub: '%',
        value: (s, ac) => runningOf(ac) * clamp(ac.controls.throttle, 0, 1) * 96 + runningOf(ac) * 6,
      });
      panel.round({
        u,
        v: row2,
        R: r2 * 0.92,
        min: 0,
        max: 110,
        start: -135,
        sweep: 270,
        step: 10,
        major: 20,
        arcs: [[70, 100, '#3ec96a'], [100, 110, '#e8402a']],
        labels: [[0, '0'], [40, '40'], [80, '80'], [100, '100']],
        labelSize: 13,
        title: `PROP ${n}`,
        sub: 'RPM %',
        value: (s, ac) => rpmOf(ac) * 100,
      });
    };
    eng(engU, 1);
    eng(engU + 0.098, 2);
    panel.twin({
      u: engU + 0.049,
      v: row2 - pitchY,
      R: r2 * 0.8,
      title: 'ITT',
      left: { min: 0, max: 1, arcs: [[0.3, 0.8, '#3ec96a']], labels: [[0, '0'], [1, '9']], title: '1' },
      right: { min: 0, max: 1, arcs: [[0.3, 0.8, '#3ec96a']], labels: [[0, '0'], [1, '9']], title: '2' },
      rate: 0.8,
      values: (s, ac, env, out) => {
        const v = runningOf(ac) * (0.35 + clamp(ac.controls.throttle, 0, 1) * 0.4);
        out[0] = v;
        out[1] = v;
      },
    });
  }

  /* ---- Annunciators + master caution, top of the centre stack ---- */
  // A 3 x 3 block: MASTER CAUTION first, then the eight lamps. On a light
  // single that is where the annunciator panel is — top centre, under the
  // glareshield, where both seats can see it.
  const sw = stack.u1 - stack.u0;
  const annTop = Math.min(topV(stack.u0), topV(stack.u1)) - 0.008;
  const lampGap = 0.004;
  const lampW = (sw - 2 * lampGap) / 3;
  const lampH = 0.017;
  const slot = (i) => [stack.u0 + lampW / 2 + (i % 3) * (lampW + lampGap), annTop - lampH / 2 - Math.floor(i / 3) * (lampH + lampGap)];
  const warn = warningLamps(panel.group, {
    size: [lampW, lampH],
    masterSize: [lampW, lampH],
    place: (m, i) => {
      const [u, v] = slot(i + 1);
      m.position.set(u, v, 0.003);
    },
    placeMaster: (m) => {
      const [u, v] = slot(0);
      m.position.set(u, v, 0.003);
    },
  });
  panel.paint((g, P) => {
    g.fillStyle = '#0c0e11';
    const pad = P.pr(0.004);
    roundRect(g, P.px(stack.u0) - pad, P.py(annTop) - pad, P.pr(sw) + 2 * pad, P.pr(3 * lampH + 2 * lampGap) + 2 * pad, pad);
    g.fill();
  });

  /* ---- The radio stack, painted once, with displays that die ---- */
  const stackTop = annTop - 3 * lampH - 2 * lampGap - 0.012;
  const radio = (v, h, title, lines, lcd) => {
    panel.paint((g, P) => {
      const x0 = P.px(stack.u0);
      const x1 = P.px(stack.u1);
      const y0 = P.py(v + h / 2);
      const y1 = P.py(v - h / 2);
      g.fillStyle = '#16191d';
      roundRect(g, x0, y0, x1 - x0, y1 - y0, P.pr(0.004));
      g.fill();
      g.strokeStyle = '#3b4148';
      g.lineWidth = P.pr(0.0015);
      g.stroke();
      // Knobs at each end.
      for (const xx of [x0 + P.pr(0.014), x1 - P.pr(0.014)]) {
        const kg = g.createRadialGradient(xx - 3, (y0 + y1) / 2 - 3, 1, xx, (y0 + y1) / 2, P.pr(0.009));
        kg.addColorStop(0, '#6b727b');
        kg.addColorStop(1, '#202328');
        g.fillStyle = kg;
        g.beginPath();
        g.arc(xx, (y0 + y1) / 2, P.pr(0.009), 0, Math.PI * 2);
        g.fill();
      }
      if (lcd) {
        g.fillStyle = '#05080a';
        g.fillRect(P.px(lcd[0]), P.py(v + lcd[1] / 2), P.pr(lcd[2]), P.pr(lcd[1]));
      }
      label(g, x0 + P.pr(0.03), y0 + P.pr(0.006), title, Math.round(P.pr(0.0055)), DIM, 'left');
      for (const [text, u, dv, size, colour, align] of lines) {
        g.font = `700 ${Math.round(P.pr(size))}px "Courier New", monospace`;
        g.fillStyle = colour;
        g.textAlign = align || 'left';
        g.textBaseline = 'middle';
        g.fillText(text, P.px(u), P.py(v + dv));
      }
    });
    if (lcd) panel.lcd({ u: lcd[0] + lcd[2] / 2, v, w: lcd[2], h: lcd[1] });
  };
  const lcdU = stack.u0 + 0.028;
  const lcdW = sw - 0.056;
  let sv = stackTop - 0.022;
  // Audio panel.
  panel.paint((g, P) => {
    const y = P.py(sv);
    g.fillStyle = '#16191d';
    roundRect(g, P.px(stack.u0), P.py(sv + 0.016), P.pr(sw), P.pr(0.032), P.pr(0.003));
    g.fill();
    const keys = ['COM1', 'COM2', 'NAV1', 'ADF', 'MKR', 'SPKR'];
    keys.forEach((t, i) => {
      const x = P.px(stack.u0 + 0.012 + (i * (sw - 0.024)) / (keys.length - 1));
      g.fillStyle = i === 0 ? '#3ec96a' : '#3a3f46';
      g.fillRect(x - P.pr(0.008), y - P.pr(0.004), P.pr(0.016), P.pr(0.005));
      label(g, x, y + P.pr(0.008), t, Math.round(P.pr(0.0042)), DIM);
    });
  });
  sv -= 0.052;
  radio(sv, 0.05, 'COM / NAV', [
    ['118.30', lcdU + 0.005, 0.008, 0.013, '#5df08a'],
    ['121.90', lcdU + 0.074, 0.008, 0.009, '#7ea6c8'],
    ['110.50', lcdU + 0.005, -0.012, 0.009, '#5df08a'],
    ['113.90', lcdU + 0.074, -0.012, 0.009, '#7ea6c8'],
  ], [lcdU, 0.04, lcdW]);
  sv -= 0.045;
  radio(sv, 0.036, 'XPDR', [
    ['1200', lcdU + 0.005, 0, 0.013, '#5df08a'],
    ['ALT', lcdU + 0.068, 0, 0.008, '#5df08a'],
  ], [lcdU, 0.026, lcdW]);
  sv -= 0.04;
  // Autopilot: the AP lamp lights when it is flying.
  radio(sv, 0.032, 'AUTOPILOT', [['HDG  ALT', lcdU + 0.04, 0, 0.007, '#9aa0a8']], null);
  panel.lamp({ u: lcdU + 0.016, v: sv, w: 0.024, h: 0.014, text: 'AP', colour: 0x3ec96a, on: (s, ac, env) => env.autopilot, size: 0.7 });

  /* ---- Bottom row: switches, key, placards ---- */
  const lowV = V(panelBot) + 0.045;
  panel.paint((g, P) => {
    const names = ['MASTER', 'BCN', 'LAND', 'TAXI', 'NAV', 'STROBE', 'PITOT', 'AVION'];
    const u0 = up - pitchX - R;
    const du = (2 * pitchX + 2 * R) / (names.length - 1);
    names.forEach((t, i) => {
      const x = P.px(u0 + i * du);
      const y = P.py(lowV);
      g.fillStyle = i === 0 ? '#8c1f1a' : '#e3e5e8';
      roundRect(g, x - P.pr(0.006), y - P.pr(0.011), P.pr(0.012), P.pr(0.022), P.pr(0.002));
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x - P.pr(0.006), y, P.pr(0.012), P.pr(0.011));
      label(g, x, y + P.pr(0.019), t, Math.round(P.pr(0.0048)), DIM);
    });
    // Ignition key, left of the switches.
    const kx = P.px(u0 - 0.04);
    const ky = P.py(lowV);
    g.fillStyle = '#1a1d21';
    g.beginPath();
    g.arc(kx, ky, P.pr(0.016), 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#8f969e';
    g.lineWidth = P.pr(0.002);
    g.stroke();
    g.fillStyle = '#b9bec4';
    g.fillRect(kx - P.pr(0.002), ky - P.pr(0.011), P.pr(0.004), P.pr(0.022));
    label(g, kx, ky + P.pr(0.024), 'OFF R L BOTH START', Math.round(P.pr(0.0036)), DIM);
    // Registration and type placard over the radio stack's foot.
    label(g, P.px((stack.u0 + stack.u1) / 2), P.py(lowV - 0.004), C.reg, Math.round(P.pr(0.009)), '#c9ced6', 'center', 700);
    label(g, P.px((stack.u0 + stack.u1) / 2), P.py(lowV - 0.019), C.model, Math.round(P.pr(0.0048)), DIM);
    // Right side: placards and the glovebox outline.
    const gx0 = P.px(engU - 0.02);
    const gx1 = P.px(Math.min(P.width / 2 - 0.03, engU + 0.25));
    const gy0 = P.py(lowV + 0.02);
    const gy1 = P.py(lowV - 0.03);
    g.strokeStyle = 'rgba(255,255,255,0.10)';
    g.lineWidth = P.pr(0.002);
    roundRect(g, gx0, gy0, gx1 - gx0, gy1 - gy0, P.pr(0.006));
    g.stroke();
    label(g, (gx0 + gx1) / 2, (gy0 + gy1) / 2 - P.pr(0.006), 'MANOEUVRING SPEED ' + Math.round(arcs.green[1] * 0.8) + ' KIAS', Math.round(P.pr(0.0045)), DIM);
    label(g, (gx0 + gx1) / 2, (gy0 + gy1) / 2 + P.pr(0.006), 'NO ACROBATIC MANOEUVRES', Math.round(P.pr(0.0045)), DIM);
  });

  /* ---- Gear lever and lights; flap indicator ---- */
  let gearHandle = null;
  if (C.gear === 'retract') {
    const gu = stack.u0 - 0.035;
    const gv = lowV + 0.075;
    panel.paint((g, P) => {
      g.fillStyle = '#121418';
      roundRect(g, P.px(gu - 0.012), P.py(gv + 0.05), P.pr(0.024), P.pr(0.1), P.pr(0.005));
      g.fill();
      label(g, P.px(gu), P.py(gv + 0.058), 'UP', Math.round(P.pr(0.0055)), TEXT);
      label(g, P.px(gu), P.py(gv - 0.058), 'DN', Math.round(P.pr(0.0055)), TEXT);
      label(g, P.px(gu + 0.04), P.py(gv + 0.038), 'GEAR', Math.round(P.pr(0.0045)), DIM);
    });
    for (const [i, du] of [[0, -0.012], [1, 0], [2, 0.012]].map(([i, d]) => [i, d])) {
      panel.lamp({ u: gu + 0.04 + du, v: gv + 0.02, w: 0.009, h: 0.009, round: true, colour: 0x3ec96a, on: (s, ac) => ac.gearPos > 0.98 });
    }
    panel.lamp({ u: gu + 0.04, v: gv + 0.003, w: 0.03, h: 0.01, text: 'UNSAFE', colour: 0xff3b25, on: (s, ac) => ac.gearPos > 0.02 && ac.gearPos < 0.98, size: 0.7 });
    // The handle itself: a little wheel on a stalk, up or down.
    gearHandle = new THREE.Group();
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 8), new THREE.MeshStandardMaterial({ color: 0xb9bec4, metalness: 0.8, roughness: 0.3 }));
    stalk.rotation.x = Math.PI / 2;
    stalk.position.z = 0.025;
    gearHandle.add(stalk);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.008, 18), new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.4 }));
    wheel.rotation.x = Math.PI / 2;
    wheel.position.z = 0.05;
    gearHandle.add(wheel);
    gearHandle.position.set(gu, gv, 0.002);
    gearHandle.userData.v0 = gv;
    panel.group.add(gearHandle);
  }
  panel.round({
    u: stack.u1 + 0.03,
    v: lowV + 0.028,
    R: 0.022,
    min: 0,
    max: 30,
    start: -60,
    sweep: 120,
    step: 10,
    major: 10,
    labels: [[0, '0'], [10, '10'], [20, '20'], [30, '30']],
    labelSize: 26,
    title: '',
    value: (s, ac) => clamp(ac.flaps || 0, 0, 1) * 30,
    rate: 3,
  });
  panel.paint((g, P) => label(g, P.px(stack.u1 + 0.03), P.py(lowV + 0.002), 'FLAPS', Math.round(P.pr(0.0048)), DIM));
  panel.finish();

  /* ================================================================ *
   * What you hold
   * ================================================================ */
  const blackMetal = new THREE.MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.45, metalness: 0.4 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc4c9cf, roughness: 0.25, metalness: 0.9 });
  const yokeMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.55, metalness: 0.15 });
  // The shafts come out of the panel under the six-pack, as a 172's do; the
  // horns then rise in front of its lower row.
  const sixBottomY = panel.group.position.y + (row2 - R * 1.25) * Math.cos(tilt);
  const yokeLow = Math.min(E.y - 0.36, sixBottomY - 0.035);
  const yokeZ = E.z - 0.5;
  const yokes = [];
  for (const x of [pilotX, copilotX]) {
    const y = new THREE.Group();
    y.name = 'control wheel';
    // The shaft out of the panel.
    const shaftLen = yokeZ - panelZ + 0.04;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, shaftLen, 10), chrome);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = -shaftLen / 2;
    y.add(shaft);
    // Ram's-horn wheel: a centre plate and two horns that curl up.
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.05, 0.03), yokeMat);
    plate.position.set(0, 0.0, 0.01);
    y.add(plate);
    const badge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.022, 0.004), new THREE.MeshStandardMaterial({ color: 0x6d747d, metalness: 0.7, roughness: 0.3 }));
    badge.position.set(0, 0.0, 0.027);
    y.add(badge);
    for (const side of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.07, 0.0, 0.01),
        new THREE.Vector3(side * 0.115, 0.005, 0.012),
        new THREE.Vector3(side * 0.145, 0.04, 0.012),
        new THREE.Vector3(side * 0.15, 0.1, 0.01),
      ]);
      const horn = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.016, 8, false), yokeMat);
      y.add(horn);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), yokeMat);
      cap.position.set(side * 0.15, 0.1, 0.01);
      y.add(cap);
    }
    y.position.set(x, yokeLow, yokeZ);
    group.add(y);
    yokes.push(y);
  }

  /* ---- Engine controls ---- */
  const levers = [];
  const plunger = (u, v, colour, shape, kind) => {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.14, 8), chrome);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = -0.07;
    g.add(shaft);
    const mat = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.45 });
    let knob;
    if (shape === 'ribbed') knob = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.022, 12), mat);
    else if (shape === 'square') knob = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.018), mat);
    else knob = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.014, 0.024, 14), mat);
    if (shape !== 'square') knob.rotation.x = Math.PI / 2;
    g.add(knob);
    g.position.set(u, v, 0.012);
    panel.group.add(g);
    levers.push({ g, kind, out: 0 });
    // Bezel hole, painted.
    panel.paint((c, P) => {
      c.fillStyle = '#0d0f12';
      c.beginPath();
      c.arc(P.px(u), P.py(v), P.pr(0.009), 0, Math.PI * 2);
      c.fill();
      label(c, P.px(u), P.py(v - 0.026), kind === 'throttle' ? 'THROTTLE' : kind === 'prop' ? 'PROP' : kind === 'mixture' ? 'MIXTURE' : 'CARB HEAT', Math.round(P.pr(0.0042)), DIM);
    });
    return g;
  };
  if (C.controls === 'plungers2' || C.controls === 'plungers3') {
    const pv = lowV + 0.035;
    const pu = (stack.u0 + stack.u1) / 2;
    if (C.controls === 'plungers2') {
      plunger(pu - 0.055, pv, 0x8a8f96, 'square', 'carb');
      plunger(pu, pv, 0x15171a, 'round', 'throttle');
      plunger(pu + 0.055, pv, 0x8c1c18, 'ribbed', 'mixture');
    } else {
      plunger(pu - 0.055, pv, 0x15171a, 'round', 'throttle');
      plunger(pu, pv, 0x1f4f9c, 'round', 'prop');
      plunger(pu + 0.055, pv, 0x8c1c18, 'ribbed', 'mixture');
    }
    panel.texture.needsUpdate = true;
  }

  /* ---- Pedestal between the seats ---- */
  const floorY = E.y - 1.02;
  const pedMat = new THREE.MeshStandardMaterial({
    map: panelTexture(),
    normalMap: panelNormal(),
    normalScale: new THREE.Vector2(0.5, 0.5),
    color: new THREE.Color(C.panel).multiplyScalar(1.6),
    roughness: 0.8,
  });
  const pedTop = C.controls === 'quadrant2' ? E.y - 0.5 : panelBot + 0.02;
  const pedLen = C.controls === 'quadrant2' ? 0.5 : 0.3;
  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.2, pedTop - floorY, pedLen), pedMat);
  pedestal.position.set(cx, (pedTop + floorY) / 2, panelZ + pedLen / 2);
  pedestal.name = 'pedestal';
  group.add(pedestal);
  // Trim wheel on its side, half buried in the pedestal.
  const trimWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.024, 24), new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.6 }));
  trimWheel.rotation.z = Math.PI / 2;
  trimWheel.position.set(cx, pedTop - 0.035, panelZ + pedLen * 0.62);
  trimWheel.name = 'trim wheel';
  group.add(trimWheel);
  const trimMark = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.004, 0.01), new THREE.MeshStandardMaterial({ color: 0xe9ecef }));
  trimMark.position.set(0, 0.0, 0.069);
  trimWheel.add(trimMark);
  // Fuel selector on the floor behind it.
  {
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.006, 20), blackMetal);
    plate.position.set(cx, floorY + 0.02, panelZ + pedLen + 0.08);
    group.add(plate);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.02, 0.07), new THREE.MeshStandardMaterial({ color: 0xb31f1a, roughness: 0.5 }));
    handle.position.set(cx, floorY + 0.034, panelZ + pedLen + 0.08);
    group.add(handle);
  }
  // Twin power quadrant on the pedestal top.
  if (C.controls === 'quadrant2') {
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.012, pedLen * 0.6), blackMetal);
    top.position.set(cx, pedTop + 0.006, panelZ + pedLen * 0.3);
    group.add(top);
    const lever = (dx, colour, kind, knob) => {
      const g = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.16, 0.012), chrome);
      stem.position.y = 0.08;
      g.add(stem);
      const m = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.45 });
      const h = knob === 'T'
        ? new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.022), m)
        : new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.03, 10), m);
      if (knob !== 'T') h.rotation.z = Math.PI / 2;
      h.position.y = 0.165;
      g.add(h);
      g.position.set(cx + dx, pedTop + 0.01, panelZ + pedLen * 0.3);
      group.add(g);
      // out: 0 to start — undefined, the first ease made it NaN and the
      // Tempest's power and condition levers were never drawn again.
      levers.push({ g, kind, quad: true, out: 0 });
    };
    lever(-0.05, 0x15171a, 'throttle', 'T');
    lever(-0.018, 0x15171a, 'throttle', 'T');
    lever(0.022, 0x1f4f9c, 'prop', 'r');
    lever(0.054, 0x1f4f9c, 'prop', 'r');
    // The flap lever, on the right of the quadrant.
    lever(0.088, 0xe9ecef, 'flaps', 'r');
  }

  /* ---- Rudder pedals, two pairs ---- */
  const pedals = [];
  const pedalMat = new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.6, metalness: 0.4 });
  for (const x of [pilotX, copilotX]) {
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.14, 0.02), pedalMat);
      p.position.set(x + side * 0.095, floorY + 0.14, panelZ + 0.12);
      p.rotation.x = -0.45;
      group.add(p);
      pedals.push({ mesh: p, side, z0: p.position.z });
    }
  }

  /* ---- Seats ---- */
  const seatMat = new THREE.MeshStandardMaterial({ map: leatherTexture(C.seat), roughness: 0.92, color: 0xffffff });
  const seatTrimMat = new THREE.MeshStandardMaterial({ color: C.seatTrim, roughness: 0.8 });
  // The pilot's own seat has no back: the eye is the pilot's head, and with
  // one the look-behind view (B) was a headrest at arm's length.
  const seat = (x, z, wide = 0.46, back = true) => {
    const g = new THREE.Group();
    g.name = 'seat';
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(wide, 0.1, 0.48), seatMat);
    cushion.position.set(0, 0.05, 0);
    g.add(cushion);
    if (back) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(wide, 0.62, 0.11), seatMat);
      b.position.set(0, 0.38, 0.24);
      b.rotation.x = -0.2;
      g.add(b);
      const head = new THREE.Mesh(new THREE.BoxGeometry(wide * 0.6, 0.16, 0.09), seatMat);
      head.position.set(0, 0.76, 0.32);
      head.rotation.x = -0.2;
      g.add(head);
    }
    const frame = new THREE.Mesh(new THREE.BoxGeometry(wide * 0.9, 0.16, 0.42), seatTrimMat);
    frame.position.set(0, -0.08, 0);
    g.add(frame);
    g.position.set(x, floorY + 0.24, z);
    group.add(g);
    return g;
  };
  seat(pilotX, E.z + 0.08, 0.46, false);
  seat(copilotX, E.z + 0.08);
  if (C.rearSeats) {
    const rz = E.z + 0.95;
    const mz = space.toModel([cx, floorY + 0.5, rz]).z;
    if (mz < zBack - 0.3 / k) seat(cx, rz, Math.min(1.0, 2 * halfW(rz, floorY + 0.4) - 0.06));
  }

  /* ---- Wet compass on the windscreen's centre strip ---- */
  let compassCard = null;
  if (C.compass && ws) {
    const zc = ws.z1 - 0.04 / k;
    const top = L(shell.insetPoint(zc, 0));
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.06), blackMetal);
    box.position.set(cx, top.y - 0.045, top.z + 0.03);
    group.add(box);
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#121417';
    g.fillRect(0, 0, 512, 64);
    g.fillStyle = '#f0f0f0';
    g.font = '700 30px Arial';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let d = 0; d < 360; d += 30) {
      const t = d === 0 ? 'N' : d === 90 ? 'E' : d === 180 ? 'S' : d === 270 ? 'W' : String(d / 10);
      // Cylinder u runs round from +z clockwise seen from above; the card
      // is read from behind, so the numbers run the other way.
      g.fillText(t, ((360 - d) / 360) * 512, 34);
    }
    for (let d = 0; d < 360; d += 5) {
      g.fillRect(((360 - d) / 360) * 512 - 1, 0, 2, d % 30 === 0 ? 12 : 7);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    compassCard = new THREE.Mesh(
      new THREE.CylinderGeometry(0.024, 0.024, 0.02, 32, 1, true),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.1 })
    );
    compassCard.position.set(cx, top.y - 0.045, top.z + 0.064);
    group.add(compassCard);
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.026), new THREE.MeshStandardMaterial({ color: 0x0a0c0f, transparent: true, opacity: 0.25, roughness: 0.05 }));
    lens.position.set(cx, top.y - 0.045, top.z + 0.0605);
    group.add(lens);
  }

  /* ---- Sun visors and vents at the windscreen's head ---- */
  if (ws) {
    const visorMat = new THREE.MeshStandardMaterial({ color: tc.head.clone().multiplyScalar(0.9), roughness: 0.9, map: fabric, side: THREE.DoubleSide });
    // Just behind the windscreen's head, against the headliner, over each
    // seat — stowed up, as they are in flight.
    const zc = ws.z1 + 0.05 / k;
    const roofAt = (x) => {
      // The inner roof over lateral position x (cockpit metres).
      const mx = (x - cx) / k;
      let best = null;
      for (let s = 0; s <= 1.4; s += 0.01) {
        const p = shell.insetPoint(zc, Math.sign(mx || 1) * s);
        if (!best || Math.abs(p.x - mx) < Math.abs(best.x - mx)) best = p.clone();
      }
      return L(best);
    };
    for (const x of [pilotX, copilotX]) {
      const at = roofAt(x);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.012, 0.13), visorMat);
      visor.position.set(x, at.y - 0.03, at.z + 0.08);
      visor.rotation.x = 0.06;
      visor.name = 'sun visor';
      group.add(visor);
      // An eyeball vent outboard of it — inboard where the cabin is too
      // narrow (the Courier): outboard, the roof has already turned down
      // into the side window there, and the vent hung in the glass.
      let vx = x + Math.sign(x - cx) * 0.17;
      let va = roofAt(vx);
      if (va.y < at.y - 0.06) {
        vx = x - Math.sign(x - cx) * 0.15;
        va = roofAt(vx);
      }
      const vent = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8), chrome);
      vent.position.set(vx, va.y - 0.03, va.z + 0.22);
      vent.name = 'vent';
      group.add(vent);
    }
  }

  /* ---- Door handle, pilot's side ---- */
  {
    const dz = E.z - 0.15;
    const m = space.toModel([pilotX, E.y - 0.3, dz]);
    const s = -glazing.hull.angleAt(m.z, m.y);
    const p = L(shell.insetPoint(m.z, s));
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, 0.12), chrome);
    handle.position.set(p.x + 0.025, p.y, p.z);
    group.add(handle);
    const rest = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.4), seatTrimMat);
    rest.position.set(p.x + 0.03, p.y - 0.06, p.z + 0.05);
    group.add(rest);
  }

  /* ---- The exterior from inside: its insides cut away (kit.js) ---- */
  if (model && glazing.source === 'hull') {
    const hw = halfW(E.z, E.y - 0.2) + 0.06;
    const lo = space.toModel(new THREE.Vector3(cx - hw, floorY - 0.05, L([0, 0, zFront]).z));
    const hi = space.toModel(new THREE.Vector3(cx + hw, E.y + 0.45, L([0, 0, zBack]).z));
    const cut = carveExterior(model, new THREE.Box3(lo.clone().min(hi), lo.clone().max(hi)), (o) => /prop|glass/i.test(o.name || ''));
    group.userData.carved = cut.carved;
    group.userData.viewing = insideOnly(cut.hidden.filter((o) => !/prop/i.test(o.name || '')));
  }

  /* ---- Merge what never moves (kit.js): about 85 draws become about 40 ---- */
  for (const y of yokes) y.userData.dynamic = true;
  for (const l of levers) l.g.userData.dynamic = true;
  if (gearHandle) gearHandle.userData.dynamic = true;
  trimWheel.userData.dynamic = true;
  for (const p of pedals) p.mesh.userData.dynamic = true;
  if (compassCard) compassCard.userData.dynamic = true;
  group.traverse((o) => { if (o.name === 'seat') o.userData.keepApart = true; });
  mergeStatic(group, (o) => o === panel.face || o.parent === shell.group || /glareshield/.test(o.name));

  /* ================================================================ *
   * Live
   * ================================================================ */
  const env = {};
  let t = 0;
  const glassMeshes = shell.meshes.glass ? [shell.meshes.glass] : [];
  group.userData.update = (dt, ac, weather, sim) => {
    t += dt;
    cockpitEnv(weather, sim, env);
    warn.update(t, ac, env);
    panel.update(dt, ac, env);
    const c = ac.controls || {};
    // Both wheels move together: turn for roll, in and out for pitch.
    for (const y of yokes) {
      y.rotation.z = ease(y.rotation.z, -(c.roll || 0) * 0.75, 10, dt);
      y.position.z = ease(y.position.z, yokeZ - (c.pitch || 0) * 0.08, 10, dt);
    }
    // Knobs come out as they are pulled back; levers rake forward as pushed.
    const thr = clamp(c.throttle || 0, 0, 1);
    const rpm = clamp(ac.rpm || 0, 0, 1);
    const lean = clamp(((ac.pos ? ac.pos.y : 0) - 300) / 2400, 0, 0.55);
    for (const l of levers) {
      const want =
        l.kind === 'throttle' ? 1 - thr : l.kind === 'prop' ? 1 - Math.max(rpm, thr) * 0.9 : l.kind === 'mixture' ? lean : l.kind === 'flaps' ? clamp(ac.flaps || 0, 0, 1) : 0;
      l.out = ease(l.out, want, 8, dt);
      if (l.quad) l.g.rotation.x = l.kind === 'flaps' ? 0.35 + l.out * 0.6 : -0.5 + l.out * 0.9;
      else l.g.position.z = 0.012 + l.out * 0.07;
    }
    if (gearHandle) gearHandle.position.y = ease(gearHandle.position.y, gearHandle.userData.v0 + (ac.gearDown ? -0.035 : 0.035), 6, dt);
    trimWheel.rotation.x = (ac.trim || 0) * 6;
    for (const p of pedals) p.mesh.position.z = p.z0 + (c.yaw || 0) * p.side * 0.04;
    if (compassCard) {
      // A wet compass swings and lags; it is not a gyro.
      const want = ((-(ac.heading || 0)) * Math.PI) / 180;
      let d = want - compassCard.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      compassCard.rotation.y += d * clamp(dt * 2.5, 0, 1) + Math.sin(t * 1.7) * 0.002 * (ac.airspeed || 0) * 0.02;
    }
    updateRain(rainMat, glassMeshes, t, ac, weather);
  };
  group.userData.panel = panel;
  group.userData.panelFace = panel.face;
  group.userData.warnings = warn.lamps;
  group.userData.family = 'light';
  group.userData.builder = `light:${id}`;
  group.userData.glazing = { source: glazing.source, windows: shell.openings.length };
  group.userData.shell = shell;
  return group;
}
