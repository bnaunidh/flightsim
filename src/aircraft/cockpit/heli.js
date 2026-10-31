/**
 * The helicopter: the Skyhook H-3.
 *
 * What makes a helicopter cockpit is glass everywhere: the windscreen wraps
 * round and over, the doors are mostly window, and at your feet the chin
 * bubbles show the ground going by between the pedals. The panel is a hood
 * over a narrow console, not a wall, so it does not hide them. You fly it
 * with a cyclic between your knees, a collective at your left hand that
 * rises as you pull power (with the throttle twist-grip at its end), and the
 * anti-torque pedals.
 *
 * The room is cut from the machine's own hull (canopy.js interiorShell on
 * models/skyhook.js), the same one the outside is lofted from — when the
 * Blender model draws the outside, the hull is built here from the same
 * table, so the frames still sit on its windows.
 *
 * Instruments: the six (gauges.js, needles that cost nothing), the dual
 * tach (rotor and engine), torque and turbine temperature, fuel, and a small
 * moving map (displays.js) at the top of the console.
 */

import * as THREE from '../../vendor/three.module.js';
import { clamp, lerp } from '../../core/noise.js';
import { leatherTexture } from '../../render/textures.js';
import { glazingOf, interiorShell, windscreenOf } from './canopy.js';
import { GaugePanel } from './gauges.js';
import { label, roundRect, DIM, TEXT } from './paint.js';
import { TRAINER_EYE, warningLamps, cockpitEnv, rainMaterial, updateRain, ease } from './common.js';
import { Display, DisplayBus, readFlight, paintMap, paintPFD, paintND } from './displays.js';
import { cockpitMaterials, roundedBox, tubeAlong, loft, part, bezel, crewSeat, switchPanelMaterial, mergeStatic, carveExterior, insideOnly } from './kit.js';
import { skyhookHull } from '../models/skyhook.js';

const HELI = {
  trim: { head: '#cfd2d4', wall: '#8f969d', low: '#4c535a', floor: '#2b2e32', frame: '#2b2f34' },
  palette: { panel: '#2a2e33', trim: '#5a6168', glare: '#16181b', seat: '#3b4148', frame: '#2b2f34', floor: '#26292c' },
};

/**
 * Per-type character. The ROOM comes from each machine's own hull (its
 * windscreen, doors and chin windows are where the exterior draws them); this
 * is what the photographs show that the hull cannot
 * (.claude/devtools/briefs/cockpit-refs.md):
 *   glass   two screens (PFD + map) in front of the pilot instead of the six
 *           round dials (H145 Helionix, AW139, UH-60M, CH-47F, AH-64E)
 *   tandem  one seat a row: the Apache's pilot sits alone, high and aft, with
 *           the gunner's seat ahead of and below him; no second set of pedals
 */
const HELIS = {
  harrier: { title: 'SKYHOOK H-3', glass: false, tandem: false },
  bell407: { title: 'BELL 407', glass: false, tandem: false },
  r44: { title: 'R44 RAVEN II', glass: false, tandem: false },
  h145: { title: 'H145', glass: true, tandem: false },
  aw139: { title: 'AW139', glass: true, tandem: false },
  uh60: { title: 'UH-60M', glass: true, tandem: false },
  ch47: { title: 'CH-47F', glass: true, tandem: false },
  ah64: { title: 'AH-64E', glass: true, tandem: true },
  vh3d: { title: 'VH-3D', glass: false, tandem: false },
};

export function buildHeliCockpit(ctx) {
  const { type, model, space } = ctx;
  const id = type && HELIS[type.id] ? type.id : 'harrier';
  const C = HELIS[id];
  const k = space.k;
  // The hull: the model's own, or (the Blender model has none) the same
  // table the civil model is lofted from.
  let glazing = glazingOf(type, model, space);
  if (glazing.source !== 'hull' && type && type.id === 'harrier') {
    const h = skyhookHull();
    glazing = { source: 'hull', hull: h, lines: h.glazing.lines, windows: h.glazing.windows };
  }
  const group = new THREE.Group();
  group.name = 'cockpit';
  const M = cockpitMaterials(HELI.palette);
  const E = new THREE.Vector3(...TRAINER_EYE);
  const eyeM = space.toModel(E);
  const L = (v) => space.toLocal(v, new THREE.Vector3());
  const cx = L([0, 0, 0]).x;
  const pilotX = E.x;
  const copilotX = 2 * cx - E.x;

  /* ================================================================ *
   * The room
   * ================================================================ */
  const ws = windscreenOf(glazing);
  const wsZ0 = ws ? ws.z0 : eyeM.z - 1.0 / k;
  const lastGlass = Math.max(...glazing.windows.map((w) => w.z1));
  const zFront = Math.max(glazing.hull.zMin + 0.02, wsZ0 - 0.25 / k);
  const zBack = Math.min(lastGlass + 0.3 / k, glazing.hull.zMax - 0.2);
  const tc = { head: new THREE.Color(HELI.trim.head), wall: new THREE.Color(HELI.trim.wall), low: new THREE.Color(HELI.trim.low), floor: new THREE.Color(HELI.trim.floor) };
  const _c = new THREE.Color();
  const colourAt = (p) => {
    const y = (p.y - eyeM.y) * k;
    if (y > 0.14) return _c.copy(tc.wall).lerp(tc.head, clamp((y - 0.14) / 0.06, 0, 1)).clone();
    if (y > -0.45) return _c.copy(tc.low).lerp(tc.wall, clamp((y + 0.45) / 0.06, 0, 1)).clone();
    return _c.copy(tc.floor).lerp(tc.low, clamp((y + 0.75) / 0.08, 0, 1)).clone();
  };
  const fabric = leatherTexture('#9a978f');
  const wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, map: fabric });
  const frameMat = new THREE.MeshStandardMaterial({ color: HELI.trim.frame, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide });
  const capMat = new THREE.MeshStandardMaterial({ color: HELI.trim.low, roughness: 0.85, side: THREE.DoubleSide });
  const rainMat = rainMaterial({ depthTest: true });
  rainMat.side = THREE.DoubleSide;
  /*
   * A tandem pilot sits aft and high, his roof a hand's width over his head
   * and curving down in front of it: the strip of skin along the top of the
   * exterior's canopy (its windows start at the 'ctr' line) ran from just
   * above his eyes to straight ahead of them, a grey wedge across the middle
   * of the picture. From inside, his own canopy is glass from the top down
   * (the Apache's roof panels are flat glass); the exterior keeps its strip.
   */
  const shellGlazing = C.tandem
    ? { ...glazing, windows: glazing.windows.map((w) => (eyeM.z >= w.z0 && eyeM.z <= w.z1 ? { ...w, from: 'top' } : w)) }
    : glazing;
  const shell = interiorShell(shellGlazing, {
    z0: zFront,
    z1: zBack,
    inset: 0.035 / k,
    frame: 0.03 / k,
    frameZ: 0.03 / k,
    maxStep: 0.08 / k,
    radial: 30,
    colourAt,
    materials: { wall: wallMat, frame: frameMat, glass: rainMat, cap: capMat, back: capMat },
  });
  const ext = space.exteriorGroup();
  ext.add(shell.group);
  group.add(ext);
  shell.group.traverse((o) => {
    if (o.isMesh) {
      o.receiveShadow = true;
      o.castShadow = o.material !== rainMat;
    }
  });

  const sill = ws ? shell.sill(ws, 16).map(L) : [];
  const sillZ = sill.length ? sill[0].z : E.z - 0.9;
  const sillY = (dx) => {
    if (!sill.length) return E.y - 0.2;
    const ax = Math.abs(dx);
    for (let i = 1; i < sill.length; i++) {
      const xa = sill[i - 1].x - cx;
      const xb = sill[i].x - cx;
      if (ax <= xb) return lerp(sill[i - 1].y, sill[i].y, clamp((ax - xa) / (xb - xa || 1), 0, 1));
    }
    return sill[sill.length - 1].y;
  };
  const halfW = (z, y) => {
    const m = space.toModel([cx, y, z]);
    return shell.halfWidthAt(m.z, m.y) * k;
  };

  /* ================================================================ *
   * The hood and the console
   * ================================================================ */
  // A helicopter's windscreen runs right down to the nose, so the hood is
  // placed from the pilot, not from a sill: its top a hand's width under the
  // eye line, its face about 0.8 m ahead, reaching forward into the nose.
  //
  // Not on a tandem deck: 0.8 m ahead of the Apache's pilot is the gunner's
  // cockpit, where the hood came up through the divider between the two
  // canopies and the panel sat behind it, out of sight. His panel is under
  // that divider, closer and lower, and he looks down at it over the
  // gunner's canopy.
  const yHood = E.y - (C.tandem ? 0.28 : 0.21);
  const panelZ = E.z - (C.tandem ? 0.45 : 0.8);
  const hoodFront = panelZ - (C.tandem ? 0.12 : 0.3);
  // Wide enough to reach the pilot's seat: the Black Hawk's and the Chinook's
  // pilots sit 55 cm off the centreline under one panel across both seats.
  const hoodW = Math.max(0.3, Math.min(Math.max(0.44, Math.abs(pilotX - cx) + 0.17), halfW(panelZ - 0.1, yHood) - 0.04));
  {
    const nx = 18;
    const a = [];
    const b = [];
    for (let i = 0; i <= nx; i++) {
      const f = -1 + (2 * i) / nx;
      const dx = f * hoodW;
      a.push(new THREE.Vector3(cx + dx, yHood - 0.004, hoodFront + 0.08 * f * f));
      b.push(new THREE.Vector3(cx + dx, yHood - 0.01, panelZ + 0.03));
    }
    part(group, loft(a, b, false), M.glare, 0, 0, 0, 'glareshield');
    // Its front and sides, down into the nose, so it reads as a hood.
    const a2 = a.map((v) => new THREE.Vector3(v.x, v.y - 0.16, v.z + 0.02));
    part(group, loft(a, a2, false), M.glare, 0, 0, 0, 'glareshield');
    for (const end of [0, nx]) {
      const top0 = a[end];
      const top1 = b[end];
      part(group, loft([top0, top1], [new THREE.Vector3(top0.x, top0.y - 0.16, top0.z + 0.02), new THREE.Vector3(top1.x, top1.y - 0.2, top1.z)], false), M.glare);
    }
    const lip = part(group, new THREE.CylinderGeometry(0.025, 0.025, 2 * hoodW, 14), M.glare, cx, yHood - 0.03, panelZ + 0.03, 'glareshield lip');
    lip.rotation.z = Math.PI / 2;
  }
  // The panel: a wide band under the hood, then a narrow console to the floor.
  const yFloor = E.y - 1.08;
  const tilt = -0.2;
  const pTop = yHood - 0.04;
  const band = 0.2;
  const conHalf = 0.17;
  const pBot = yFloor + 0.25;
  const outline = [
    [-hoodW + 0.01, 0],
    [hoodW - 0.01, 0],
    [hoodW - 0.03, -band],
    [conHalf, -band - 0.04],
    [conHalf, -(pTop - pBot)],
    [-conHalf, -(pTop - pBot)],
    [-conHalf, -band - 0.04],
    [-hoodW + 0.03, -band],
  ];
  const pH = pTop - pBot;
  const pW = 2 * hoodW;
  const panel = new GaugePanel({ width: pW, height: pH, outline: outline.map(([u, v]) => [u, v + pH / 2]), colour: ctx.highContrast ? '#15181c' : HELI.palette.panel, highContrast: ctx.highContrast });
  panel.group.position.set(cx, pTop - pH / 2, panelZ);
  panel.group.rotation.x = tilt;
  group.add(panel.group);
  const vt = pH / 2;
  // The six in front of the pilot (the glass machines get two screens there instead, below).
  const R = 0.042;
  const sw = 0.12; // a glass machine's screen
  // In front of the pilot — but on the panel. The Chinook's pilots sit 55 cm
  // off the centreline under a hood the hull's width caps at about 40 cm a
  // side, so "in front of the pilot" put the pair of screens off the panel's
  // edge, floating over the console (the GM's audit: "panel shifted right with
  // a stray MFD"). The group is pulled inboard until it fits inside the hood,
  // with a finger's width to spare, on every machine.
  const reach = C.glass ? sw + 0.02 : 0.1 + R + 0.015;
  const px0 = clamp(pilotX - cx, -(hoodW - reach), hoodW - reach);
  const row1 = vt - R - 0.04; // clear of the hood's lip
  const row2 = row1 - 2 * R - 0.016;
  // Engine gauges: on the console's head beside the six; on a tandem deck
  // (nothing beside the pilot) in a row under the screens.
  const eng = C.tandem ? [[-0.09, row2 - 0.01], [0, row2 - 0.01], [0.09, row2 - 0.01]] : [[0.04, row1 + 0.002], [0.04, row2 + 0.004], [0.13, row2 + 0.004]];
  const lampX = C.tandem ? 0.2 : 0.11;
  const lampX2 = C.tandem ? 0.3 : 0.21;
  if (!C.glass) panel.asi({ u: px0 - 0.1, v: row1, R, min: 0, max: 160, white: [0, 0], green: [0, 120], yellow: [120, 140], red: 140, step: 10, majorStep: 20 });
  if (!C.glass) panel.ai({ u: px0, v: row1, R });
  if (!C.glass) panel.alt({ u: px0 + 0.1, v: row1, R });
  if (!C.glass) panel.round({ u: px0 - 0.1, v: row2, R: R * 0.9, min: 0, max: 120, start: -135, sweep: 270, step: 5, major: 20, arcs: [[90, 105, '#3ec96a'], [105, 120, '#e8402a']], labels: [[0, '0'], [40, '40'], [80, '80'], [120, '120']], labelSize: 13, title: 'NR / N2', sub: '%', value: (s, ac) => (ac.engineOn ? 100 : clamp((ac.propBlur ?? ac.rpm ?? 0) * 100, 0, 110)) });
  if (!C.glass) panel.hi({ u: px0, v: row2, R });
  if (!C.glass) panel.vsi({ u: px0 + 0.1, v: row2, R: R * 0.9 });
  // Engine: torque and turbine temperature on the console's head.
  panel.round({ u: eng[0][0], v: eng[0][1], R: R * 0.82, min: 0, max: 120, start: -135, sweep: 270, step: 5, major: 20, arcs: [[0, 100, '#3ec96a'], [100, 120, '#e8402a']], labels: [[0, '0'], [40, '40'], [80, '80'], [120, '120']], labelSize: 13, title: 'TORQUE', sub: '%', value: (s, ac) => (ac.engineOn ? 12 + clamp(ac.controls ? ac.controls.throttle || 0 : 0, 0, 1) * 88 : 0) });
  panel.round({ u: eng[1][0], v: eng[1][1], R: R * 0.82, min: 0, max: 10, start: -135, sweep: 270, step: 0.5, major: 2, arcs: [[3, 7.4, '#3ec96a'], [7.4, 10, '#e8402a']], labels: [[0, '0'], [2, '2'], [4, '4'], [6, '6'], [8, '8'], [10, '10']], labelSize: 13, title: 'TOT', sub: 'x100°C', value: (s, ac) => (ac.engineOn ? 4 + clamp(ac.controls ? ac.controls.throttle || 0 : 0, 0, 1) * 3 : 0.3) });
  panel.round({ u: eng[2][0], v: eng[2][1], R: R * 0.7, min: 0, max: 1, start: -60, sweep: 120, step: 0.25, major: 0.5, arcs: [[0, 0.12, '#e8402a']], labels: [[0, 'E'], [0.5, '½'], [1, 'F']], labelSize: 18, title: 'FUEL', value: (s, ac) => (typeof ac.fuelFraction === 'function' ? ac.fuelFraction() : 0.5) });
  // The moving map at the top of the console, and the radios under it.
  const bus = new DisplayBus({ hz: 12, maxPerFrame: 1 });
  const map = new Display({ name: 'map', w: 512, h: 448, widthM: 0.14, heightM: 0.12, paint: (g, w, h, d) => paintMap(g, w, h, d, { title: 'MAP', rangeNm: 5 }) });
  const mapV = vt - band - 0.04 - 0.075; // the top of the console
  map.mesh.position.set(0, mapV, 0.0125);
  panel.group.add(map.mesh);
  const bz = bezel(M, 0.14, 0.12, { bw: 0.014, n: 4, sideButtons: false });
  bz.position.set(0, mapV, 0.012);
  panel.group.add(bz);
  bus.add(map);
  // The glass machines: a PFD and a map in front of the pilot, where the six were.
  const screens = [];
  if (C.glass) {
    const vS = row1 - 0.03;
    const mountS = (name, u, v, paint, hz) => {
      const d = new Display({ name, w: 512, h: 512, widthM: sw, heightM: sw, paint, hz: hz || 0 });
      d.mesh.position.set(u, v, 0.0125);
      d.mesh.receiveShadow = true;
      panel.group.add(d.mesh);
      const bz = bezel(M, sw, sw, { bw: 0.012, n: 4, sideButtons: false });
      bz.position.set(u, v, 0.012);
      panel.group.add(bz);
      bus.add(d);
      screens.push(d);
      return d;
    };
    mountS('PFD', px0 - sw / 2 - 0.006, vS, (g, w, h, d) => paintPFD(g, w, h, d, { vs: 40, vmo: 165 }));
    mountS('ND', px0 + sw / 2 + 0.006, vS, (g, w, h, d) => paintND(g, w, h, d, { rangeNm: 10 }), 6);
  }
  panel.paint((g, P) => {
    const y0 = mapV - 0.075;
    for (let i = 0; i < 3; i++) {
      const y = y0 - i * 0.045;
      g.fillStyle = '#16191d';
      roundRect(g, P.px(-conHalf + 0.012), P.py(y + 0.018), P.pr(2 * conHalf - 0.024), P.pr(0.036), P.pr(0.004));
      g.fill();
      g.fillStyle = '#05080a';
      g.fillRect(P.px(-0.06), P.py(y + 0.011), P.pr(0.12), P.pr(0.022));
      g.font = `700 ${Math.round(P.pr(0.012))}px "Courier New", monospace`;
      g.fillStyle = '#5df08a';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(['123.45  121.90', '110.50  113.90', 'XPDR 1200 ALT'][i], P.px(0), P.py(y));
    }
    label(g, P.px(0), P.py(-vt + 0.02), C.title, Math.round(P.pr(0.009)), TEXT, 'center', 700);
  });
  const warn = warningLamps(panel.group, {
    size: [0.044, 0.017],
    masterSize: [0.06, 0.022],
    place: (m, i) => m.position.set(lampX + (i % 2) * 0.047, row1 + 0.03 - Math.floor(i / 2) * 0.021, 0.004),
    placeMaster: (m) => m.position.set(lampX2, row1 + 0.05 - 0.084, 0.004),
  });
  panel.lamp({ u: lampX2, v: row1 - 0.075, w: 0.04, h: 0.015, text: 'HOLD', colour: 0x3ec96a, on: (s, ac, env) => env.autopilot || !!ac.hoverAssist, size: 0.7 });
  panel.finish();

  /* ================================================================ *
   * Cyclic, collective, pedals, seats
   * ================================================================ */
  const metal = M.darkMetal;
  const cyclic = new THREE.Group();
  cyclic.name = 'cyclic';
  cyclic.userData.dynamic = true;
  {
    const top = new THREE.Vector3(0, E.y - 0.47 - (yFloor + 0.02), 0.2);
    part(cyclic, tubeAlong([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, top.y * 0.6, 0.04), top], 0.013, 12, 8), metal, 0, 0, 0, 'cyclic stick');
    const grip = part(cyclic, roundedBox(0.042, 0.12, 0.05, 0.016), M.rubber, top.x, top.y + 0.04, top.z, 'cyclic grip');
    grip.rotation.x = 0.35;
    part(cyclic, new THREE.CylinderGeometry(0.008, 0.008, 0.012, 8), M.red, top.x, top.y + 0.1, top.z + 0.01);
    part(cyclic, new THREE.CylinderGeometry(0.06, 0.07, 0.04, 12), M.rubber, 0, 0.02, 0, 'cyclic boot');
  }
  cyclic.position.set(pilotX, yFloor + 0.02, E.z - (C.tandem ? 0.3 : 0.55));
  group.add(cyclic);
  // Collective: hinged by the seat, its grip forward at the left hand.
  const collective = new THREE.Group();
  collective.name = 'collective';
  collective.userData.dynamic = true;
  {
    const len = 0.5;
    part(collective, new THREE.BoxGeometry(0.03, 0.035, len), metal, 0, 0, -len / 2, 'collective lever');
    const grip = part(collective, new THREE.CylinderGeometry(0.02, 0.02, 0.13, 12), M.rubber, 0, 0, -len - 0.04, 'throttle twist grip');
    grip.rotation.x = Math.PI / 2;
    part(collective, roundedBox(0.05, 0.04, 0.05, 0.01), M.panel, 0, 0.025, -len + 0.03, 'collective switch box');
  }
  collective.position.set(pilotX - 0.27, yFloor + 0.3, E.z + 0.08);
  group.add(collective);
  part(group, roundedBox(0.08, 0.3, 0.12, 0.02), M.trim, pilotX - 0.27, yFloor + 0.15, E.z + 0.08, 'collective base');
  const seatsX = C.tandem ? [pilotX] : [pilotX, copilotX];
  const pedals = [];
  for (const x of seatsX) {
    for (const s of [-1, 1]) {
      const p = part(group, roundedBox(0.075, 0.13, 0.022, 0.008), M.darkMetal, x + s * (C.tandem ? 0.22 : 0.1), yFloor + 0.17, panelZ + 0.12, 'anti-torque pedal');
      p.rotation.x = -0.5;
      p.userData.dynamic = true;
      pedals.push({ mesh: p, side: s, z0: p.position.z });
    }
  }
  for (const x of seatsX) {
    const seat = crewSeat(M, { width: 0.46, headrest: x !== pilotX, back: x === pilotX ? 0.48 : 0.62 });
    seat.position.set(x, E.y - 0.92, E.z - 0.22);
    group.add(seat);
  }
  // The rear bench against the bulkhead behind the doors.
  if (!C.tandem) part(group, roundedBox(Math.min(1.2, 2 * halfW(E.z + 0.9, E.y - 0.6) - 0.1), 0.12, 0.45, 0.04), M.seat, cx, yFloor + 0.4, E.z + 0.95, 'rear bench');
  // Overhead: a strip of breakers and the rotor brake handle. Not on a tandem
  // deck: placed from the windscreen's roof, the Apache's came under the
  // gunner's low canopy, a slab across his pilot's chest; and its pilot has
  // no overhead panel, only glass over his head.
  if (!C.tandem) {
    const zO = (ws ? L(shell.insetPoint(ws.z1, 0)).z : E.z - 0.4) + 0.12;
    const yO = L(shell.insetPoint(space.toModel(new THREE.Vector3(cx, E.y, zO)).z, 0)).y - 0.05;
    part(group, new THREE.PlaneGeometry(0.28, 0.42), switchPanelMaterial({ w: 256, h: 384, rows: 6, cols: 4, seed: 61, colour: HELI.palette.panel, labels: ['GEN', 'BATT', 'FUEL VALVE', 'HYD', 'ROTOR BRK', 'START', 'NAV', 'LDG LT'] }), cx, yO, zO + 0.24, 'overhead console').rotation.x = Math.PI / 2;
    part(group, roundedBox(0.3, 0.04, 0.44, 0.015), M.panel, cx, yO + 0.022, zO + 0.24);
  }
  // A wet compass on the centre post.
  let compassCard = null;
  if (ws) {
    const top = L(shell.insetPoint(ws.z1 - 0.04 / k, 0));
    part(group, roundedBox(0.07, 0.05, 0.06, 0.01), M.darkMetal, cx, top.y - 0.045, top.z + 0.03, 'compass');
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
    for (let d = 0; d < 360; d += 30) g.fillText(d === 0 ? 'N' : d === 90 ? 'E' : d === 180 ? 'S' : d === 270 ? 'W' : String(d / 10), ((360 - d) / 360) * 512, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    compassCard = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.02, 32, 1, true), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.1 }));
    compassCard.position.set(cx, top.y - 0.045, top.z + 0.064);
    compassCard.userData.dynamic = true;
    group.add(compassCard);
  }

  // The outside model's own cabin (the Blender machine has seats, screens
  // and trim of its own, and its body is not the hull this room is cut
  // from): from inside, everything of it within the cabin is cut away.
  if (model) {
    const top = L(shell.insetPoint(space.toModel(new THREE.Vector3(cx, E.y, E.z)).z, 0)).y + 0.15;
    const half = halfW(E.z, E.y - 0.3) + 0.25;
    const lo = space.toModel(new THREE.Vector3(cx - half, yFloor - 0.3, L([0, 0, zFront]).z - 0.05));
    const hi = space.toModel(new THREE.Vector3(cx + half, top, L([0, 0, zBack]).z));
    const cut = carveExterior(model, new THREE.Box3(lo.clone().min(hi), lo.clone().max(hi)), (o) => /rotor|blade/i.test(o.name || ''));
    group.userData.carved = cut.carved;
    group.userData.viewing = insideOnly(cut.hidden.filter((o) => !/rotor|blade/i.test(o.name || '')));
  }
  mergeStatic(group, (o) => o === panel.face || o.parent === shell.group);

  /* ================================================================ *
   * Live
   * ================================================================ */
  const env = {};
  let t = 0;
  let lastAc = null;
  let lastSim = null;
  let painted = false;
  const read = (out) => readFlight(lastAc, lastSim, out, 1);
  const glassMeshes = shell.meshes.glass ? [shell.meshes.glass] : [];
  group.userData.update = (dt, ac, weather, sim) => {
    t += dt;
    lastAc = ac;
    lastSim = sim || null;
    cockpitEnv(weather, sim, env);
    warn.update(t, ac, env);
    panel.update(dt, ac, env);
    if (!painted) {
      painted = true;
      bus.paintAll(read, env);
    } else bus.update(dt, read, env);
    for (const d of [map, ...screens]) d.material.emissiveIntensity = env.blackout ? 0 : 0.95 - env.panelLight * 0.35;
    const c = ac.controls || {};
    cyclic.rotation.x = ease(cyclic.rotation.x, -(c.pitch || 0) * 0.22, 12, dt);
    cyclic.rotation.z = ease(cyclic.rotation.z, -(c.roll || 0) * 0.22, 12, dt);
    // The collective rises with the lever (on this machine, the throttle).
    collective.rotation.x = ease(collective.rotation.x, 0.05 + clamp(c.throttle || 0, 0, 1) * 0.32, 10, dt);
    for (const p of pedals) p.mesh.position.z = p.z0 + (c.yaw || 0) * p.side * 0.04;
    if (compassCard) {
      const want = (-(ac.heading || 0) * Math.PI) / 180;
      let d = want - compassCard.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      compassCard.rotation.y += d * clamp(dt * 2.5, 0, 1);
    }
    updateRain(rainMat, glassMeshes, t, ac, weather);
  };
  group.userData.panel = panel;
  group.userData.panelFace = panel.face;
  group.userData.warnings = warn.lamps;
  group.userData.displays = [map, ...screens];
  group.userData.bus = bus;
  group.userData.family = 'heli';
  group.userData.builder = `heli:${id}`;
  group.userData.character = { glass: C.glass, tandem: C.tandem };
  // The tandem pilot's panel is low under the divider: the view looks down to it.
  if (C.tandem) group.userData.viewPitchDeg = 20;
  group.userData.glazing = { source: glazing.source, windows: shell.openings.length };
  group.userData.shell = shell;
  group.userData.eye = E.clone();
  group.userData.controls = { cyclic, collective, pedals };
  return group;
}
