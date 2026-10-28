/**
 * Airliners: the A320, the 747, the A380 and the Meridian.
 *
 * An airliner's flight deck is a room, and it should feel like one: wide
 * enough that the first officer's seat is a long reach away, a glareshield
 * that runs the whole width under the windscreen with the autopilot panel in
 * the middle, six screens across the panel, a pedestal between the seats
 * with the thrust levers on it, the overhead panel full of switches over
 * your head, a bulkhead and a door behind you.
 *
 * The room is cut from the aeroplane's own nose. The exteriors publish the
 * hull they were lofted from and the six panes in its (z, s)
 * (`model.userData.flightDeck`, airliner-parts.js glazing); deck-skin.js
 * builds the inside of that same hull, set in by the skin's thickness, with
 * the panes cut out on their own edges and a frame round each. So every
 * window frame seen from the seat is where the outside draws the window, in
 * every one of them — the 747's on its upper deck included — and the size of
 * the room is the size of the aeroplane: the A380's is the biggest because
 * its nose is.
 *
 * Live: PFD, ND (the island from the minimap's chart), the engine page with
 * two or four engines, the systems page, the autopilot panel's windows and
 * the two pedestal CDUs, all from the sim at about 12 Hz (displays.js);
 * thrust levers, yokes or side-sticks, rudder pedals, flap lever, warning
 * lamps and master caution, blackout, panel lights at night.
 */

import * as THREE from '../../vendor/three.module.js';
import { clamp, lerp } from '../../core/noise.js';
import { GaugePanel } from './gauges.js';
import { label, roundRect, DIM, TEXT } from './paint.js';
import { TRAINER_EYE, warningLamps, cockpitEnv, ease, rainMaterial, updateRain } from './common.js';
import { Display, DisplayBus, readFlight, paintPFD, paintND, paintEICAS, paintSystems, paintMCP, paintCDU, paintHUD } from './displays.js';
import { cockpitMaterials, roundedBox, loft, polygon, part, bezel, crewSeat, sideStick, centreStick, thrustLever, switchPanelMaterial, mergeStatic, carveExterior, insideOnly } from './kit.js';
import { deckSkin, revealsAndGlass } from './deck-skin.js';

/** The most the cockpit view looks down by default, degrees (see viewPitchDeg below). */
export const VIEW_PITCH_MAX = 15;

/* ------------------------------------------------------------------ *
 * Per-type character
 *
 * The ROOM is never in this table: it is cut from the exterior's own nose
 * (the hull and panes it publishes), so a 777's deck is as wide as a 777's
 * nose and a Q400's as narrow as a Dash 8's. What the table holds is what
 * the photographs of each flight deck show that the hull cannot
 * (.claude/devtools/briefs/cockpit-refs.md): yoke, side-stick or a centre
 * stick (the C-17 and the B-1B fly on fighter sticks); one thrust lever per
 * engine (six on the An-225) and the Q400's condition levers behind its
 * power levers; the size of the screens; an overhead HUD where the real one
 * has it (787, C-17); the maker's colours (Boeing's warm greys and browns,
 * Airbus's blue-greys, the An-225's Soviet turquoise, Concorde's black
 * panels, the military greys).
 * ------------------------------------------------------------------ */

const AIRLINER = {
  a320: {
    title: 'A320', maker: 'airbus', engines: 2, du: 0.165, stick: 'side',
    palette: { panel: '#4c5967', trim: '#aeb5bc', glare: '#22272c', seat: '#34404c', frame: '#2b3036', floor: '#2a2d31' },
    wall: { head: '#d6d9dc', wall: '#b8bec4', low: '#7d8791' }, mcp: '#4c5967', lcd: '#ffb44a', vs: 110, vmo: 350,
  },
  a380: {
    title: 'A380', maker: 'airbus', engines: 4, du: 0.2, stick: 'side',
    palette: { panel: '#4a5663', trim: '#b1b8bf', glare: '#22272c', seat: '#323d48', frame: '#2b3036', floor: '#2a2d31' },
    wall: { head: '#d9dcdf', wall: '#bcc2c8', low: '#7f8993' }, mcp: '#4a5663', lcd: '#ffb44a', vs: 120, vmo: 340,
  },
  b747: {
    title: '747', maker: 'boeing', engines: 4, du: 0.19, stick: 'yoke',
    palette: { panel: '#5f5b55', trim: '#b3ada3', glare: '#1f2022', seat: '#4b3f35', frame: '#2c2c2d', floor: '#2b2a29' },
    wall: { head: '#d6d1c7', wall: '#bdb6aa', low: '#8a8478' }, mcp: '#5f5b55', lcd: '#f2f2ea', vs: 130, vmo: 365,
  },
  meridian: {
    title: 'MERIDIAN 220', maker: 'boeing', engines: 2, du: 0.15, stick: 'yoke', ndRange: 10,
    palette: { panel: '#3b424a', trim: '#b5bbc1', glare: '#1e2125', seat: '#2f3742', frame: '#26292d', floor: '#26282b' },
    wall: { head: '#d4d6d8', wall: '#b9bdc2', low: '#7a828a' }, mcp: '#3b424a', lcd: '#ffb44a', vs: 95, vmo: 300,
  },
  /* ---- Narrow-bodies ---- */
  b737: {
    title: '737 MAX 8', maker: 'boeing', engines: 2, du: 0.19, stick: 'yoke', ndRange: 20,
    palette: { panel: '#575c63', trim: '#b7b3aa', glare: '#1f2022', seat: '#4a4238', frame: '#2c2c2d', floor: '#2b2a29' },
    wall: { head: '#d8d4cb', wall: '#bfb9ae', low: '#8a847a' }, mcp: '#575c63', lcd: '#f2f2ea', vs: 108, vmo: 340,
  },
  a321: {
    title: 'A321neo', maker: 'airbus', engines: 2, du: 0.165, stick: 'side', ndRange: 20,
    palette: { panel: '#4c5967', trim: '#aeb5bc', glare: '#22272c', seat: '#34404c', frame: '#2b3036', floor: '#2a2d31' },
    wall: { head: '#d6d9dc', wall: '#b8bec4', low: '#7d8791' }, mcp: '#4c5967', lcd: '#ffb44a', vs: 112, vmo: 350,
  },
  /* ---- Wide-bodies: bigger screens, longer map ranges ---- */
  b787: {
    title: '787', maker: 'boeing', engines: 2, du: 0.2, stick: 'yoke', hud: true, ndRange: 40,
    palette: { panel: '#4a4f57', trim: '#b4b2ad', glare: '#1c1d1f', seat: '#3b3530', frame: '#2a2b2d', floor: '#28282a' },
    wall: { head: '#d9d8d4', wall: '#bdbbb5', low: '#84827c' }, mcp: '#4a4f57', lcd: '#f2f2ea', vs: 118, vmo: 360,
  },
  a350: {
    title: 'A350', maker: 'airbus', engines: 2, du: 0.2, stick: 'side', ndRange: 40,
    palette: { panel: '#4f5a66', trim: '#b0b7be', glare: '#22272c', seat: '#323c47', frame: '#2b3036', floor: '#2a2d31' },
    wall: { head: '#dadde0', wall: '#bcc2c8', low: '#7f8993' }, mcp: '#4f5a66', lcd: '#ffb44a', vs: 120, vmo: 350,
  },
  b777: {
    title: '777', maker: 'boeing', engines: 2, du: 0.19, stick: 'yoke', ndRange: 40,
    palette: { panel: '#5b5f66', trim: '#b5b0a6', glare: '#1f2022', seat: '#47403a', frame: '#2c2c2d', floor: '#2b2a29' },
    wall: { head: '#d6d2c9', wall: '#bdb7ad', low: '#89837a' }, mcp: '#5b5f66', lcd: '#f2f2ea', vs: 125, vmo: 360,
  },
  /* ---- Regional turboprop: power + condition levers, small screens ---- */
  q400: {
    title: 'Q400', maker: 'bombardier', engines: 2, du: 0.15, stick: 'yoke', levers: 'turboprop', ndRange: 10,
    palette: { panel: '#4a4f56', trim: '#b4b8bd', glare: '#1e2124', seat: '#333a44', frame: '#27292d', floor: '#27292b' },
    wall: { head: '#d5d7d9', wall: '#babfc4', low: '#7c848c' }, mcp: '#4a4f56', lcd: '#ffb44a', vs: 90, vmo: 245,
  },
  /* ---- Concorde: a 1970s deck, black panels, four engines, a tight room ---- */
  concorde: {
    title: 'CONCORDE', maker: 'aerospatiale', engines: 4, du: 0.14, stick: 'yoke', ndRange: 40,
    palette: { panel: '#2e3034', trim: '#a9adb3', glare: '#17181a', seat: '#2a3340', frame: '#222427', floor: '#232527' },
    wall: { head: '#cfd2d6', wall: '#aeb3b9', low: '#6f767e' }, mcp: '#2e3034', lcd: '#f4f1e6', vs: 130, vmo: 530,
  },
  /* ---- The giants ---- */
  belugaxl: {
    title: 'BELUGA XL', maker: 'airbus', engines: 2, du: 0.19, stick: 'side', ndRange: 40,
    palette: { panel: '#4c5967', trim: '#aeb5bc', glare: '#22272c', seat: '#34404c', frame: '#2b3036', floor: '#2a2d31' },
    wall: { head: '#d6d9dc', wall: '#b8bec4', low: '#7d8791' }, mcp: '#4c5967', lcd: '#ffb44a', vs: 115, vmo: 330,
  },
  dreamlifter: {
    title: 'DREAMLIFTER', maker: 'boeing', engines: 4, du: 0.19, stick: 'yoke', ndRange: 40,
    palette: { panel: '#5f5b55', trim: '#b3ada3', glare: '#1f2022', seat: '#4b3f35', frame: '#2c2c2d', floor: '#2b2a29' },
    wall: { head: '#d6d1c7', wall: '#bdb6aa', low: '#8a8478' }, mcp: '#5f5b55', lcd: '#f2f2ea', vs: 130, vmo: 365,
  },
  an225: {
    title: 'AN-225', maker: 'antonov', engines: 6, du: 0.13, stick: 'yoke', ndRange: 40,
    palette: { panel: '#3f7382', trim: '#9fc3cc', glare: '#1b2426', seat: '#4a5b63', frame: '#2a3539', floor: '#2b3134' },
    wall: { head: '#cfe0e4', wall: '#9fc3cc', low: '#5f8791' }, mcp: '#3f7382', lcd: '#f4f1e6', vs: 125, vmo: 350,
  },
  c5: {
    title: 'C-5M', maker: 'lockheed', engines: 4, du: 0.17, stick: 'yoke', ndRange: 40,
    palette: { panel: '#3f4a44', trim: '#9aa39c', glare: '#1a1f1c', seat: '#3a443e', frame: '#262c29', floor: '#262a28' },
    wall: { head: '#c9cfcb', wall: '#a3aba6', low: '#6b746f' }, mcp: '#3f4a44', lcd: '#9df0a0', vs: 110, vmo: 350,
  },
  /* ---- Military decks on centre sticks ---- */
  c17: {
    title: 'C-17A', maker: 'boeing', engines: 4, du: 0.17, stick: 'centre', hud: true, ndRange: 40,
    palette: { panel: '#3d4446', trim: '#9ea4a5', glare: '#191c1d', seat: '#3b4042', frame: '#272b2c', floor: '#272a2b' },
    wall: { head: '#cbd0d1', wall: '#a7adae', low: '#6e7576' }, mcp: '#3d4446', lcd: '#9df0a0', vs: 105, vmo: 350,
  },
  b1b: {
    title: 'B-1B', maker: 'rockwell', engines: 4, du: 0.15, stick: 'centre', ndRange: 40,
    palette: { panel: '#33383c', trim: '#8e9397', glare: '#15181a', seat: '#2f3437', frame: '#23272a', floor: '#242729' },
    wall: { head: '#bfc4c7', wall: '#9a9fa3', low: '#62686c' }, mcp: '#33383c', lcd: '#9df0a0', vs: 150, vmo: 600,
  },
};

/* ------------------------------------------------------------------ *
 * The builder
 * ------------------------------------------------------------------ */

export function buildFlightDeck(ctx) {
  const { type, model, space } = ctx;
  const id = type && AIRLINER[type.id] ? type.id : 'a320';
  const C = AIRLINER[id];
  const fd = model && model.userData && model.userData.flightDeck;
  const h = fd && (fd.hull || model.userData.cabinHull);
  if (!fd || !h || !Array.isArray(fd.quads) || !fd.quads.length || typeof h.point !== 'function') {
    // No outline to cut the room to: the generic cockpit is better than a
    // room whose windows are not where the aeroplane's are.
    throw new Error('this model publishes no flight-deck outline');
  }
  const k = space.k;
  const group = new THREE.Group();
  group.name = 'cockpit';
  const M = cockpitMaterials(C.palette);
  const E = new THREE.Vector3(...TRAINER_EYE);
  const eyeM = space.toModel(E);
  const L = (p) => space.toLocal(p, new THREE.Vector3());
  const cx = L([0, 0, 0]).x;
  const pilotX = E.x;
  const copilotX = 2 * cx - E.x;
  const side0 = Math.sign(pilotX - cx) || -1; // the captain's side

  /* ---- Extents, in hull units ---- */
  const quads = fd.quads;
  const allZ = quads.flatMap((q) => q.quad.map((c) => c[0]));
  const zWin0 = Math.min(...allZ);
  const zWin1 = Math.max(...allZ);
  const ws = quads.reduce((a, b) => (Math.min(...b.quad.map((c) => c[0])) < Math.min(...a.quad.map((c) => c[0])) ? b : a));
  const z0 = Math.max(h.zMin + 0.05 / k, zWin0 - 0.45 / k);
  const z1 = Math.min(h.zMax - 0.3 / k, Math.max(zWin1 + 0.3 / k, eyeM.z + 1.35 / k));
  const yFloor = E.y - 1.22;
  const yFloorM = space.toModel(new THREE.Vector3(cx, yFloor, E.z)).y;
  let sMax = 0;
  for (let i = 0; i <= 8; i++) {
    const z = lerp(z0, z1, i / 8);
    try {
      sMax = Math.max(sMax, h.angleAt(z, yFloorM));
    } catch (e) {
      sMax = Math.max(sMax, Math.PI * 0.75);
    }
  }
  sMax = Math.min(Math.PI, sMax + 0.2);
  const inset = 0.055 / k;

  /* ================================================================ *
   * The room: skin, frames, reveals, glass
   * ================================================================ */
  const ext = space.exteriorGroup('flight deck (exterior units)');
  group.add(ext);
  const wc = { head: new THREE.Color(C.wall.head), wall: new THREE.Color(C.wall.wall), low: new THREE.Color(C.wall.low) };
  const eyeYM = eyeM.y;
  const colourAt = (p) => {
    const y = (p.y - eyeYM) * k; // metres above the eye
    const c = new THREE.Color();
    if (y > 0.3) return c.copy(wc.wall).lerp(wc.head, clamp((y - 0.3) / 0.15, 0, 1));
    if (y > -0.45) return c.copy(wc.low).lerp(wc.wall, clamp((y + 0.45) / 0.12, 0, 1));
    return c.copy(wc.low).multiplyScalar(0.8);
  };
  const skin = deckSkin(h, quads, { z0, z1, sMax, inset, cell: 0.09 / k, colourAt, frameColour: C.palette.frame });
  const skinMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: M.trim.map, roughness: 0.86, metalness: 0.02 });
  const skinMesh = part(ext, skin.geometry, skinMat, 0, 0, 0, 'flight deck skin');
  const glassOff = (quads[0].glassOff ?? 0.04) * 0.8;
  const rg = revealsAndGlass(h, quads, { inset, glassOff });
  const revealMat = new THREE.MeshStandardMaterial({ color: C.palette.frame, roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide });
  part(ext, rg.reveals, revealMat, 0, 0, 0, 'window reveals');
  const rainMat = rainMaterial({ depthTest: true });
  rainMat.side = THREE.DoubleSide;
  const glassMeshes = [];
  for (const gg of rg.glass) {
    const m = new THREE.Mesh(gg, rainMat);
    m.name = 'window glass (rain)';
    m.renderOrder = 25;
    ext.add(m);
    glassMeshes.push(m);
  }

  /* ---- The windscreen's sill, in cockpit metres ---- */
  const P = new THREE.Vector3();
  const pt = (z, s) => L(h.point(z, s, P));
  const wq = ws.quad; // [inboard-bottom, outboard-bottom, outboard-top, inboard-top]
  const sillR = [pt(wq[0][0], wq[0][1]), pt(wq[1][0], wq[1][1])];
  const sillL = [pt(wq[0][0], -wq[0][1]), pt(wq[1][0], -wq[1][1])];
  const ySill = Math.min(sillR[0].y, sillR[1].y);
  const zSill = Math.max(sillR[0].z, sillR[1].z);
  /** Inner half-width of the room at local (z, y). */
  const wallX = (z, y) => {
    const m = space.toModel(new THREE.Vector3(cx, y, z));
    let s;
    try {
      s = h.angleAt(clamp(m.z, h.zMin, h.zMax), m.y);
    } catch (e) {
      s = Math.PI / 2;
    }
    const p = h.point(clamp(m.z, h.zMin, h.zMax), s, P);
    const n = h.normal(clamp(m.z, h.zMin, h.zMax), s, new THREE.Vector3());
    return Math.abs(L([p.x - n.x * inset * 1.4, p.y, p.z]).x - cx);
  };

  /* ================================================================ *
   * Glareshield, and the autopilot panel on its face
   * ================================================================ */
  const yG = ySill - 0.02;
  const zLip = zSill + 0.27;
  const zPanel = zLip + 0.03;
  const glareHalf = Math.min(wallX(zLip, yG), wallX(zSill, yG)) - 0.01;
  {
    // Front edge on the windscreens' sills (outboard, inboard, centre,
    // inboard, outboard), back edge straight across at the lip.
    const front = [
      new THREE.Vector3(cx - glareHalf, yG, Math.max(sillL[1].z, zSill - 0.02) + 0.02),
      new THREE.Vector3(sillL[1].x, yG, sillL[1].z + 0.02),
      new THREE.Vector3(sillL[0].x, yG, sillL[0].z + 0.02),
      new THREE.Vector3(sillR[0].x, yG, sillR[0].z + 0.02),
      new THREE.Vector3(sillR[1].x, yG, sillR[1].z + 0.02),
      new THREE.Vector3(cx + glareHalf, yG, Math.max(sillR[1].z, zSill - 0.02) + 0.02),
    ];
    const back = front.map((v) => new THREE.Vector3(v.x, yG - 0.012, zLip));
    /*
     * A flat shelf, so its normals are straight up. The loft's winding follows
     * the sills' zig-zag (outboard, inboard, centre...), which left two thirds
     * of the quads facing DOWN: drawn both-sided, the top was lit as an
     * underside — the hemisphere's ground colour, no sun — and the whole
     * glareshield was a black slab across the view in every airliner
     * (Tomm1z, 6:51: "look at what happened with the cockpit... a bit broken").
     */
    const shelf = loft(front, back, true);
    const sn = shelf.attributes.normal;
    for (let i = 0; i < sn.count; i++) sn.setXYZ(i, 0, 1, 0);
    sn.needsUpdate = true;
    part(group, shelf, M.glare, 0, 0, 0, 'glareshield');
    const lip = part(group, new THREE.CylinderGeometry(0.03, 0.03, 2 * glareHalf, 16), M.glare, cx, yG - 0.03, zLip, 'glareshield lip');
    lip.rotation.z = Math.PI / 2;
    part(group, new THREE.PlaneGeometry(2 * glareHalf, 0.08), M.rubber, cx, yG - 0.07, zLip + 0.012, 'glareshield face').rotation.x = 0;
  }
  // The autopilot panel: across the middle of the glareshield's face.
  const bus = new DisplayBus({ hz: 10, maxPerFrame: 2 });
  const displays = [];
  const mcpW = Math.min(0.7, glareHalf * 1.1);
  const mcp = new Display({ name: C.maker === 'airbus' ? 'FCU' : 'MCP', w: 1024, h: 120, hz: 4, kind: 'text', widthM: mcpW, heightM: 0.07, paint: (g, w, hh, d) => paintMCP(g, w, hh, d, { face: C.mcp, lcd: C.lcd }) });
  mcp.mesh.position.set(cx, yG - 0.075, zLip + 0.034);
  group.add(mcp.mesh);
  bus.add(mcp);
  displays.push(mcp);
  part(group, roundedBox(mcpW + 0.03, 0.09, 0.05, 0.01), M.panel, cx, yG - 0.075, zLip + 0.005, 'MCP housing');
  // EFIS control panels either side of it.
  for (const s of [-1, 1]) {
    const x = cx + s * (mcpW / 2 + 0.15);
    if (Math.abs(x - cx) + 0.12 > glareHalf) continue;
    part(group, new THREE.PlaneGeometry(0.2, 0.07), switchPanelMaterial({ w: 256, h: 96, rows: 1, cols: 4, seed: s > 0 ? 9 : 4, colour: C.palette.panel, labels: ['BARO', 'MINS', 'RANGE', 'MODE', 'FD', 'LS', 'CSTR', 'WPT'] }), x, yG - 0.075, zLip + 0.034, 'EFIS panel');
    part(group, roundedBox(0.22, 0.09, 0.05, 0.01), M.panel, x, yG - 0.075, zLip + 0.005);
  }

  /* ================================================================ *
   * The head-up display (787, C-17): the combiner hangs from an overhead
   * unit in front of the captain, folded down. Its symbology is the jet
   * HUD's (displays.js paintHUD), scaled by its distance from the eye.
   * ================================================================ */
  let hud = null;
  if (C.hud) {
    const dist = 0.56;
    const wc = 0.19;
    const top = E.y + 0.055;
    const base = Math.max(top - 0.17, yG + 0.015);
    const hc = top - base;
    const zH = E.z - dist;
    const geom = { boreY: (top - E.y) / hc, ppd: 1 };
    const hudDisplay = new Display({
      name: 'HUD',
      w: 512,
      h: Math.round((512 * hc) / wc),
      widthM: wc,
      heightM: hc,
      hud: true,
      hz: 12,
      colour: new THREE.Color(0x9dffb4).multiplyScalar(0.95),
      paint: (g, w, hh, d) => {
        // The eye this frame: the realistic view sits 16 cm back and 2 cm lower (flight/camera.js).
        const real = !!d.realistic;
        const D = dist + (real ? 0.16 : 0);
        const eyeY = E.y + (real ? -0.02 : 0);
        geom.ppd = (w / wc) * D * Math.tan(Math.PI / 180);
        geom.boreY = (top - eyeY) / hc;
        paintHUD(g, w, hh, d, { pxPerDeg: () => geom.ppd, boreY: geom.boreY });
      },
    });
    hudDisplay.mesh.position.set(pilotX, (top + base) / 2, zH + 0.002);
    hudDisplay.mesh.renderOrder = 40;
    hudDisplay.userData = geom;
    group.add(hudDisplay.mesh);
    bus.add(hudDisplay);
    displays.push(hudDisplay);
    hud = hudDisplay;
    const glass = part(group, new THREE.PlaneGeometry(wc, hc), M.glass.clone(), pilotX, (top + base) / 2, zH, 'HUD combiner');
    glass.material.color.set(0x9fe0b8);
    glass.material.opacity = 0.08;
    glass.castShadow = false;
    glass.renderOrder = 35;
    for (const s of [-1, 1]) part(group, roundedBox(0.012, hc + 0.012, 0.016, 0.004), M.darkMetal, pilotX + s * (wc / 2 + 0.006), (top + base) / 2, zH, 'HUD frame');
    part(group, roundedBox(wc + 0.024, 0.01, 0.016, 0.004), M.darkMetal, pilotX, top + 0.006, zH, 'HUD frame');
    // The overhead unit the combiner folds down from: up against the
    // ceiling, over the captain's head, so it stands in none of the windscreen.
    const ceilH = L(h.point(clamp(space.toModel(new THREE.Vector3(cx, E.y, zH + 0.1)).z, h.zMin, h.zMax), 0, P)).y - inset * k;
    const yUnit = Math.min(E.y + 0.5, ceilH - 0.05);
    part(group, roundedBox(0.16, 0.07, 0.22, 0.01), M.darkMetal, pilotX, yUnit, zH + 0.1, 'HUD overhead unit');
    part(group, roundedBox(0.016, yUnit - 0.035 - top, 0.016, 0.004), M.darkMetal, pilotX, (yUnit - 0.035 + top) / 2, zH + 0.004, 'HUD arm');
  }

  /* ================================================================ *
   * The main instrument panel
   * ================================================================ */
  const tilt = -0.12;
  const yTop = yG - 0.125;
  // The panel's bottom: 86 cm under the eye, and never less than 35 cm under
  // its top. The glareshield sits on the LOWEST corner of the windscreen's
  // sill, and on the blunt-nosed giants (C-17, An-225, C-5) that corner wraps
  // far down the side: the C-17's panel came out 9 cm tall, and with its eye
  // raised in wave 9 its height went negative — the canvas threw on a
  // negative corner radius and the deck fell back to the generic cockpit.
  const yBot = Math.min(E.y - 0.86, yTop - Math.max(0.35, C.du + 0.12));
  const pMid = (yTop + yBot) / 2;
  const halfAt = (y) => Math.max(0.3, Math.min(glareHalf, wallX(zPanel, y) - 0.012));
  const right = [];
  for (let i = 0; i <= 6; i++) {
    const y = lerp(yTop, yBot, i / 6);
    right.push([halfAt(y), (y - pMid) / Math.cos(tilt)]);
  }
  // One loop: down the right side, then up the left.
  const loop = [...right.map(([u, v]) => [u, v]), ...right.map(([u, v]) => [-u, v]).reverse()];
  const uMax = Math.max(...right.map((r) => r[0]));
  const pW = 2 * uMax + 0.004;
  const pH = (yTop - yBot) / Math.cos(tilt) + 0.004;
  const panel = new GaugePanel({ width: pW, height: pH, outline: loop, colour: ctx.highContrast ? '#1a1d22' : C.palette.panel, highContrast: ctx.highContrast });
  panel.group.position.set(cx, pMid, zPanel);
  panel.group.rotation.x = tilt;
  group.add(panel.group);
  const vt = pH / 2;
  const du = C.du;
  /** A screen on the panel, its bezel in 3D and its recess painted. */
  const mount = (name, u, v, w, hgt, paint, opts = {}) => {
    const d = new Display({ name, w: 512, h: Math.round((512 * hgt) / w), widthM: w, heightM: hgt, paint, hz: opts.hz || 0 });
    d.mesh.position.set(u, v, 0.0125); // the glass, in front of the bezel's dark back (bezel at 0.012)
    d.mesh.receiveShadow = true;
    panel.group.add(d.mesh);
    const bz = bezel(M, w, hgt, { bw: opts.bw ?? 0.018, n: opts.n ?? 4, sideButtons: false, topButtons: opts.buttons !== false });
    bz.position.set(u, v, 0.012);
    panel.group.add(bz);
    panel.paint((g, Pn) => {
      g.fillStyle = 'rgba(0,0,0,0.45)';
      roundRect(g, Pn.px(u - w / 2 - 0.024), Pn.py(v + hgt / 2 + 0.024), Pn.pr(w + 0.048), Pn.pr(hgt + 0.048), Pn.pr(0.006));
      g.fill();
    });
    bus.add(d);
    displays.push(d);
    return d;
  };
  const dv = vt - du / 2 - 0.035;
  const pfdOpts = { vs: C.vs, vmo: C.vmo };
  const pilotU = pilotX - cx;
  for (const s of [-1, 1]) {
    // Each pilot: the PFD in front, outboard; the ND inboard of it.
    const u0 = s * Math.abs(pilotU);
    const out = s * (du * 0.55 + 0.012);
    const who = s === side0 ? 'captain' : 'first officer';
    mount(`${who} PFD`, u0 + out, dv, du, du, (g, w, hh, d) => paintPFD(g, w, hh, d, pfdOpts));
    mount(`${who} ND`, u0 - out + 0, dv, du, du, (g, w, hh, d) => paintND(g, w, hh, d, { rangeNm: C.ndRange || 20 }), { hz: 6 });
  }
  // The centre: the engines. (The systems page is on the pedestal's head,
  // below, where nothing stands in front of it.)
  mount('upper EICAS', 0, dv, du, du, (g, w, hh, d) => paintEICAS(g, w, hh, d), { hz: 6 });
  // In the gaps either side of it: the caution lamps and the autopilot lamp
  // on the captain's side, the gear lever and its greens on the other.
  const gapU = du / 2 + 0.035;
  const lampSide = side0;
  const warn = warningLamps(panel.group, {
    size: [0.052, 0.021],
    masterSize: [0.07, 0.03],
    place: (m, i) => m.position.set(lampSide * (gapU + 0.027 + (i % 2) * 0.057), dv + 0.06 - Math.floor(i / 2) * 0.025, 0.004),
    placeMaster: (m) => m.position.set(pilotU + (side0 < 0 ? 0.05 : -0.05), dv + du / 2 + 0.019, 0.004),
  });
  panel.lamp({ u: lampSide * (gapU + 0.055), v: dv - 0.05, w: 0.05, h: 0.018, text: 'AP', colour: 0x3ec96a, on: (s, ac, env) => env.autopilot, size: 0.7 });
  const gu = -lampSide * (gapU + 0.03);
  const gv = dv - 0.01;
  panel.paint((g, Pn) => {
    g.fillStyle = '#121418';
    roundRect(g, Pn.px(gu - 0.03), Pn.py(gv + 0.08), Pn.pr(0.06), Pn.pr(0.17), Pn.pr(0.008));
    g.fill();
    label(g, Pn.px(gu), Pn.py(gv + 0.09), 'L/G', Math.round(Pn.pr(0.008)), DIM);
    label(g, Pn.px(0), Pn.py(dv - du / 2 - 0.022), `${C.title}`, Math.round(Pn.pr(0.011)), TEXT, 'center', 700);
    // The autobrake selector under the lamps, painted.
    const ax = lampSide * (gapU + 0.055);
    label(g, Pn.px(ax), Pn.py(dv - 0.078), 'AUTO BRK', Math.round(Pn.pr(0.007)), DIM);
    for (const [i, t] of ['LO', 'MED', 'MAX'].entries()) {
      g.fillStyle = '#1b1f23';
      g.fillRect(Pn.px(ax - 0.045 + i * 0.03), Pn.py(dv - 0.088), Pn.pr(0.024), Pn.pr(0.018));
      label(g, Pn.px(ax - 0.033 + i * 0.03), Pn.py(dv - 0.097), t, Math.round(Pn.pr(0.006)), '#c9ced6');
    }
  });
  const greens = gu + Math.sign(gu) * 0.045;
  for (const ddu of [-0.018, 0, 0.018]) {
    panel.lamp({ u: greens + ddu, v: gv + 0.05, w: 0.012, h: 0.012, round: true, colour: 0x3ec96a, on: (s, ac) => (ac.gearPos ?? 0) > 0.98 });
  }
  panel.lamp({ u: greens, v: gv + 0.028, w: 0.045, h: 0.014, text: 'UNSAFE', colour: 0xff3b25, on: (s, ac) => (ac.gearPos ?? 0) > 0.02 && (ac.gearPos ?? 0) < 0.98, size: 0.7 });
  const gearHandle = new THREE.Group();
  gearHandle.name = 'gear lever';
  gearHandle.userData.dynamic = true;
  part(gearHandle, new THREE.CylinderGeometry(0.006, 0.006, 0.07, 8), M.metal, 0, 0, 0.035).rotation.x = Math.PI / 2;
  part(gearHandle, new THREE.CylinderGeometry(0.02, 0.02, 0.014, 16), M.white, 0, 0, 0.07).rotation.x = Math.PI / 2;
  gearHandle.position.set(gu, gv, 0.002);
  gearHandle.userData.v0 = gv;
  panel.group.add(gearHandle);
  panel.finish();

  // The knee panel under it, down to the floor; rudder pedals in front of it.
  part(group, new THREE.PlaneGeometry(2 * uMax, yBot - yFloor + 0.05), M.trim, cx, (yBot + yFloor) / 2, zPanel + 0.06, 'knee panel');

  /* ================================================================ *
   * The pedestal between the seats
   * ================================================================ */
  // Where it starts and how high it stands are chosen so it hides none of
  // the panel: its head stays under the line from the eye to the bottom of
  // the row of screens.
  const pedW = 0.52;
  const pedZ0 = zPanel + 0.18;
  const pedZ1 = E.z + 0.45;
  const rowBottomY = panel.group.position.y + (dv - du / 2) * Math.cos(tilt);
  const rowZ = zPanel;
  const yLOS = E.y + ((rowBottomY - E.y) * (pedZ0 - E.z)) / (rowZ - E.z);
  const headRise = 0.08;
  const pedTop = Math.min(E.y - 0.62, yLOS - headRise - 0.015);
  const pedFrontTop = pedTop;
  const pedBackTop = pedTop;
  const headD = 0.17;
  {
    const len = pedZ1 - pedZ0;
    part(group, roundedBox(pedW, pedTop - yFloor, len, 0.02), M.panel, cx, (pedTop + yFloor) / 2, (pedZ0 + pedZ1) / 2, 'pedestal');
    // The head: a slope rising towards the panel, facing up at the seats,
    // with the systems screen in the middle and a CDU either side.
    const slope = Math.atan2(headRise, headD);
    const head = new THREE.Group();
    head.position.set(cx, pedTop + headRise / 2, pedZ0 + headD / 2);
    head.rotation.x = -(Math.PI / 2 - slope);
    group.add(head);
    part(head, new THREE.BoxGeometry(pedW, Math.hypot(headD, headRise), 0.03), M.panel, 0, 0, -0.016, 'pedestal head');
    // Closed under the slope: a front plate and the two side triangles.
    part(group, new THREE.PlaneGeometry(pedW, headRise), M.panel, cx, pedTop + headRise / 2, pedZ0, 'pedestal front');
    for (const sx of [-1, 1]) {
      const x = cx + sx * (pedW / 2);
      part(group, polygon([new THREE.Vector3(x, pedTop, pedZ0), new THREE.Vector3(x, pedTop + headRise, pedZ0), new THREE.Vector3(x, pedTop, pedZ0 + headD)]), M.panel);
    }
    const dw = Math.min(du * 0.95, 0.17);
    const sys = new Display({ name: 'lower EICAS', w: 512, h: 448, hz: 4, kind: 'text', widthM: dw, heightM: dw * 0.875, paint: (g, w, hh, d) => paintSystems(g, w, hh, d) });
    sys.mesh.position.set(0, 0.0, 0.002);
    head.add(sys.mesh);
    const sb0 = bezel(M, dw, dw * 0.875, { bw: 0.012, n: 4, sideButtons: false });
    sb0.position.set(0, 0, -0.0005);
    head.add(sb0);
    bus.add(sys);
    displays.push(sys);
    for (const s of [-1, 1]) {
      const cdu = new Display({ name: s === side0 ? 'captain CDU' : 'first officer CDU', w: 384, h: 320, hz: 4, kind: 'text', widthM: 0.1, heightM: 0.083, paint: paintCDU });
      cdu.mesh.position.set(s * (dw / 2 + 0.075), 0.035, 0.002);
      head.add(cdu.mesh);
      bus.add(cdu);
      displays.push(cdu);
      const keys = part(head, new THREE.PlaneGeometry(0.11, 0.07), switchPanelMaterial({ w: 128, h: 96, rows: 4, cols: 5, seed: 31 + s, colour: '#25292e', labels: ['A', 'B', 'C', 'D', 'E', '1', '2', '3', 'EXEC', 'PROG'] }), s * (dw / 2 + 0.075), -0.045, 0.002, 'CDU keys');
      void keys;
    }
    // Its top: radios, the flap lever's quadrant, trim, painted.
    const topMat = switchPanelMaterial({ w: 256, h: 512, rows: 7, cols: 2, seed: 21, colour: C.palette.panel, labels: ['VHF 1', 'VHF 2', 'ATC', 'WXR', 'ENG START', 'PARK BRK', 'RUDDER TRIM', 'FLAPS', 'SPEED BRK'] });
    const topLen = len - headD;
    const top = part(group, new THREE.PlaneGeometry(pedW - 0.02, topLen), topMat, cx, pedTop + 0.002, pedZ1 - topLen / 2, 'pedestal top');
    top.rotation.x = -Math.PI / 2;
  }
  // Thrust levers: one per engine, on the front of the pedestal top (the
  // An-225's six close up to fit the pedestal).
  const levers = [];
  const n = C.engines;
  const pitch = Math.min(0.07, (pedW - 0.08) / Math.max(1, n));
  const leverZ = Math.max(E.z - 0.3, pedZ0 + headD + 0.05);
  for (let i = 0; i < n; i++) {
    const lv = thrustLever(M, { colour: C.maker === 'airbus' ? 0x2b2f34 : 0x1c1d1f, knob: 'T' });
    lv.position.set(cx - (pitch / 2) * (n - 1) + i * pitch, pedBackTop + 0.004, leverZ);
    lv.userData.dynamic = true;
    group.add(lv);
    levers.push(lv);
  }
  // A turboprop (Q400) has its condition levers behind the power levers:
  // forward (MAX) with the engines running, back at START/FEATHER with them off.
  const conds = [];
  if (C.levers === 'turboprop') {
    for (let i = 0; i < n; i++) {
      const lv = thrustLever(M, { colour: 0x9a2a22, knob: 'r' });
      lv.scale.setScalar(0.85);
      lv.position.set(levers[i].position.x, pedBackTop + 0.004, leverZ + 0.11);
      lv.userData.dynamic = true;
      group.add(lv);
      conds.push(lv);
    }
  }
  // Flap lever, right of them; speed brake, left.
  const flap = thrustLever(M, { colour: 0xe2e5e8, knob: 'r' });
  flap.scale.setScalar(0.8);
  flap.position.set(cx + 0.18, pedBackTop + 0.004, E.z - 0.18);
  flap.userData.dynamic = true;
  group.add(flap);
  const sb = thrustLever(M, { colour: 0x3a3f46, knob: 'r' });
  sb.scale.setScalar(0.75);
  sb.position.set(cx - 0.18, pedBackTop + 0.004, E.z - 0.2);
  sb.rotation.x = 0.4;
  group.add(sb);
  // The big trim wheels on the pedestal's sides: every deck flown on a yoke
  // (Boeing, Concorde, the An-225, the C-5, the Q400); Airbus has none.
  const trimWheels = [];
  if (C.stick === 'yoke' && C.maker !== 'airbus') {
    for (const s of [-1, 1]) {
      const tw = part(group, new THREE.CylinderGeometry(0.11, 0.11, 0.03, 28), M.darkMetal, cx + s * (pedW / 2 + 0.017), pedFrontTop - 0.11, E.z - 0.15, 'trim wheel');
      tw.rotation.z = Math.PI / 2;
      tw.userData.dynamic = true;
      trimWheels.push(tw);
    }
  }

  /* ================================================================ *
   * Seats, controls, side consoles
   * ================================================================ */
  const sticks = [];
  const yokes = [];
  for (const x of [pilotX, copilotX]) {
    const isPilot = x === pilotX;
    const seat = crewSeat(M, { width: 0.52, headrest: !isPilot, back: isPilot ? 0.5 : 0.7 });
    seat.position.set(x, E.y - 0.86, E.z - 0.28);
    group.add(seat);
    const out = Math.sign(x - cx) || -1;
    // The side console by the window, with the tiller.
    const conTop = E.y - 0.6;
    // Against the wall, however wide the deck is there (the 747's upper deck
    // leaves a metre and more between the seat and the window).
    const conHalf = 0.1;
    // A side-stick stays at the pilot's hand, so an Airbus console stops there.
    const toWall = wallX(E.z, conTop) - conHalf - 0.01;
    const conX = cx + out * (C.stick === 'side' ? Math.min(Math.abs(x - cx) + 0.42, toWall) : Math.max(Math.abs(x - cx) + 0.32, toWall));
    part(group, roundedBox(conHalf * 2, conTop - yFloor, 0.95, 0.02), M.trim, conX, (conTop + yFloor) / 2, E.z - 0.2, 'side console');
    part(group, new THREE.CylinderGeometry(0.05, 0.05, 0.02, 20), M.darkMetal, conX, conTop + 0.012, E.z - 0.42, 'tiller');
    if (C.stick === 'side') {
      const st = sideStick(M, { airbus: true });
      st.position.set(conX, conTop + 0.004, E.z - 0.18);
      st.userData.dynamic = true;
      group.add(st);
      sticks.push(st);
      // The pull-out table in front of the pilot.
      part(group, roundedBox(0.4, 0.02, 0.22, 0.02), M.panel, x, yBot - 0.08, zPanel + 0.2, 'table');
    } else if (C.stick === 'centre') {
      // A fighter's stick between the knees, from the floor (C-17, B-1B).
      const st = centreStick(M);
      st.position.set(x, yFloor + 0.02, E.z - 0.5);
      st.userData.dynamic = true;
      group.add(st);
      sticks.push(st);
    } else {
      // A yoke on a column from the floor.
      const y = new THREE.Group();
      y.name = 'yoke';
      y.userData.dynamic = true;
      // Low and close: the wheel sits under the line to the screens.
      const colH = E.y - 0.66 - yFloor;
      part(y, new THREE.CylinderGeometry(0.03, 0.04, colH, 12), M.darkMetal, 0, -colH / 2, 0, 'yoke column');
      const wheel = new THREE.Group();
      wheel.name = 'yoke wheel';
      part(wheel, roundedBox(0.14, 0.05, 0.05, 0.015), M.rubber, 0, 0, 0);
      for (const s of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.016, 8, 16, Math.PI * 0.9), M.rubber);
        horn.rotation.z = s > 0 ? -Math.PI * 0.45 : Math.PI * 0.55;
        horn.position.set(s * 0.07, 0.03, 0);
        horn.castShadow = true;
        wheel.add(horn);
      }
      part(wheel, roundedBox(0.06, 0.03, 0.01, 0.004), M.metal, 0, 0, 0.026);
      wheel.position.y = 0.0;
      y.add(wheel);
      y.position.set(x, E.y - 0.66, E.z - 0.42);
      y.userData.wheel = wheel;
      wheel.userData.dynamic = true; // turns inside the column
      group.add(y);
      yokes.push(y);
    }
  }
  // Rudder pedals.
  const pedals = [];
  for (const x of [pilotX, copilotX]) {
    for (const s of [-1, 1]) {
      const p = part(group, roundedBox(0.09, 0.17, 0.03, 0.01), M.darkMetal, x + s * 0.12, yFloor + 0.15, zPanel + 0.18, 'rudder pedal');
      p.rotation.x = -0.45;
      p.userData.dynamic = true;
      pedals.push({ mesh: p, side: s, z0: p.position.z });
    }
  }
  // Floor, front bulkhead behind the panel, the aft bulkhead with the door.
  const roomHalf = wallX(E.z, E.y - 0.4) + 0.2;
  part(group, new THREE.PlaneGeometry(2 * roomHalf, L([0, 0, z1]).z - zPanel + 0.4), M.floor, cx, yFloor, (L([0, 0, z1]).z + zPanel) / 2, 'floor').rotation.x = -Math.PI / 2;
  const zBack = L([0, 0, z1]).z - 0.02;
  const ceiling = L(h.point(z1, 0, P)).y;
  part(group, new THREE.PlaneGeometry(2 * roomHalf + 1, ceiling - yFloor + 1), M.trim, cx, (ceiling + yFloor) / 2, zBack, 'aft bulkhead').rotation.y = Math.PI;
  // The nose ahead of the panel, closed below the glareshield only: above
  // it is the windscreen.
  {
    const top = yG - 0.04;
    const bot = yFloor - 0.6;
    part(group, new THREE.PlaneGeometry(2 * roomHalf + 1, top - bot), M.trim, cx, (top + bot) / 2, L([0, 0, z0]).z + 0.01, 'forward bulkhead');
  }
  {
    const door = part(group, roundedBox(0.8, Math.min(1.9, ceiling - yFloor - 0.05), 0.05, 0.02), M.panel, cx + side0 * -0.05, yFloor + Math.min(1.9, ceiling - yFloor - 0.05) / 2, zBack - 0.03, 'flight deck door');
    void door;
    part(group, new THREE.CylinderGeometry(0.012, 0.012, 0.12, 8), M.metal, cx + side0 * -0.05 + 0.3, yFloor + 1.0, zBack - 0.07).rotation.z = Math.PI / 2;
    // Circuit breaker panels on the back wall either side of the door.
    for (const s of [-1, 1]) {
      const cb = part(group, new THREE.PlaneGeometry(0.5, 0.6), switchPanelMaterial({ w: 256, h: 256, rows: 10, cols: 10, seed: 50 + s, colour: '#2e3338', labels: ['CB'] }), cx + s * (roomHalf - 0.45), E.y - 0.1, zBack - 0.03, 'breakers');
      cb.rotation.y = Math.PI;
    }
    // The observer's seat, folded, behind the captain.
    const obs = crewSeat(M, { width: 0.44, headrest: true });
    obs.position.set(cx + side0 * 0.25, E.y - 0.9, zBack - 0.75);
    obs.rotation.y = Math.PI * 0.1 * -side0;
    group.add(obs);
  }

  /* ================================================================ *
   * The overhead panel
   * ================================================================ */
  {
    const wsTopZ = Math.max(...ws.quad.map((c) => c[0]));
    const zOh0 = L([0, 0, wsTopZ]).z + 0.06;
    const zOh1 = Math.min(E.z + 0.75, zBack - 0.3);
    const ceilAt = (z) => L(h.point(space.toModel(new THREE.Vector3(cx, E.y, z)).z, 0, P)).y - inset * k - 0.035;
    const ohW = Math.min(0.95, 2 * wallX(E.z, ceilAt(E.z) - 0.1) - 0.3);
    const yA = ceilAt(zOh0) - 0.04;
    const yB = ceilAt(zOh1) - 0.02;
    const zMidOh = lerp(zOh0, zOh1, 0.35);
    const yM = Math.min(ceilAt(zMidOh), Math.max(yA, yB)) - 0.03;
    // Front, slanted at the pilots; rear, nearly flat.
    const ohMatA = switchPanelMaterial({ w: 512, h: 384, rows: 6, cols: 9, seed: 71, colour: C.palette.panel });
    const ohMatB = switchPanelMaterial({ w: 512, h: 512, rows: 8, cols: 9, seed: 83, colour: C.palette.panel });
    const quad = (a, b, c, d, mat, name) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
      g.setIndex([0, 2, 1, 0, 3, 2]);
      g.computeVertexNormals();
      return part(group, g, mat, 0, 0, 0, name);
    };
    const hw = ohW / 2;
    const v = (x, y, z) => new THREE.Vector3(cx + x, y, z);
    // Wound to face down, towards the seats.
    quad(v(-hw, yA, zOh0), v(hw, yA, zOh0), v(hw, yM, zMidOh), v(-hw, yM, zMidOh), ohMatA, 'overhead panel').geometry.computeVertexNormals();
    quad(v(-hw, yM, zMidOh), v(hw, yM, zMidOh), v(hw, yB, zOh1), v(-hw, yB, zOh1), ohMatB, 'overhead panel aft');
    for (const s of [-1, 1]) {
      part(group, loft([v(s * hw, yA, zOh0), v(s * hw, yM, zMidOh), v(s * hw, yB, zOh1)], [v(s * hw, yA + 0.06, zOh0), v(s * hw, yM + 0.06, zMidOh), v(s * hw, yB + 0.06, zOh1)], s > 0), M.panel, 0, 0, 0, 'overhead side');
    }
  }
  // Sun visors stowed at the top of the side windows, by each pilot.
  for (const x of [pilotX, copilotX]) {
    const out = Math.sign(x - cx) || -1;
    const vx = x + out * 0.28;
    const vy = E.y + 0.28;
    const visor = part(group, roundedBox(0.36, 0.008, 0.16, 0.01), new THREE.MeshStandardMaterial({ color: 0x2b3a2e, roughness: 0.3, transparent: true, opacity: 0.55 }), vx, vy, E.z - 0.35, 'sun visor');
    visor.rotation.z = out * 0.5;
    visor.castShadow = false;
  }

  /* ---- The exterior from inside ----
   * The 747's main deck runs on under its upper-deck flight deck, its top
   * above this floor: everything of the exterior inside the room, below a
   * little over the eye, is cut away from inside (kit.js). Not the wipers,
   * which are outside the glass and seen through it. */
  if (model) {
    const lo = space.toModel(new THREE.Vector3(cx - roomHalf, yFloor - 0.05, L([0, 0, z0]).z));
    const hi = space.toModel(new THREE.Vector3(cx + roomHalf, E.y + 0.5, L([0, 0, z1]).z));
    const cut = carveExterior(model, new THREE.Box3(lo.clone().min(hi), lo.clone().max(hi)), (o) => /wiper|glass|frame|door/i.test(o.name || ''));
    group.userData.carved = cut.carved;
    // And everything wholly behind the flight deck's door: from the seat no
    // airliner shows its wings, engines or tail (the windows are too far
    // forward), so in the cockpit view they cost no draw and no shadow.
    model.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
    const mm = new THREE.Matrix4();
    const bb = new THREE.Box3();
    const zDoor = Math.max(lo.z, hi.z) + 0.3 / k;
    const behind = [];
    model.traverse((o) => {
      if (!o.isMesh || cut.hidden.includes(o)) return;
      for (let p = o; p && p !== model; p = p.parent) if (p.name === 'cockpit') return;
      const g = o.geometry;
      if (!g || !g.attributes.position) return;
      if (!g.boundingBox) g.computeBoundingBox();
      mm.multiplyMatrices(inv, o.matrixWorld);
      bb.copy(g.boundingBox).applyMatrix4(mm);
      if (bb.min.z > zDoor) behind.push(o);
    });
    group.userData.viewing = insideOnly([...cut.hidden, ...behind]);
    group.userData.behind = behind.length;
  }

  /* ---- Merge what never moves ---- */
  // The glareshield stays its own mesh: a check finds it by name and reads its normals (tests/features/tomm1z-cockpit.mjs).
  mergeStatic(group, (o) => o === panel.face || o === skinMesh || /window glass/.test(o.name) || o.name === 'glareshield');

  /* ================================================================ *
   * Live
   * ================================================================ */
  const env = {};
  let t = 0;
  let lastAc = null;
  let lastSim = null;
  let painted = false;
  const read = (out) => readFlight(lastAc, lastSim, out, C.engines);
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
    for (const d of displays) if (!d.hud) d.material.emissiveIntensity = env.blackout ? 0 : 0.95 - env.panelLight * 0.35;
    if (hud) hud.material.opacity = env.blackout ? 0 : 1;
    const c = ac.controls || {};
    const thr = clamp(c.throttle || 0, 0, 1);
    for (const lv of levers) lv.rotation.x = ease(lv.rotation.x, 0.5 - thr * 0.95, 8, dt);
    for (const lv of conds) lv.rotation.x = ease(lv.rotation.x, ac.engineOn === false ? 0.45 : -0.35, 4, dt);
    flap.rotation.x = ease(flap.rotation.x, 0.4 - clamp(ac.flaps || 0, 0, 1) * 0.8, 6, dt);
    for (const st of sticks) {
      st.rotation.x = ease(st.rotation.x, -(c.pitch || 0) * 0.3, 12, dt);
      st.rotation.z = ease(st.rotation.z, -(c.roll || 0) * 0.3, 12, dt);
    }
    for (const y of yokes) {
      y.userData.wheel.rotation.z = ease(y.userData.wheel.rotation.z, -(c.roll || 0) * 0.8, 10, dt);
      y.rotation.x = ease(y.rotation.x, -(c.pitch || 0) * 0.12, 10, dt);
    }
    for (const tw of trimWheels) tw.rotation.x = (ac.trim || 0) * 8;
    for (const p of pedals) p.mesh.position.z = p.z0 + (c.yaw || 0) * p.side * 0.04;
    gearHandle.position.y = ease(gearHandle.position.y, gearHandle.userData.v0 + (ac.gearDown ? -0.035 : 0.035), 6, dt);
    updateRain(rainMat, glassMeshes, t, ac, weather);
  };
  group.userData.panel = panel;
  group.userData.panelFace = panel.face;
  group.userData.warnings = warn.lamps;
  group.userData.displays = displays;
  group.userData.bus = bus;
  // The view looks down far enough that the screens are in it, in the
  // realistic cockpit's narrower view too (its half-height is 28 degrees):
  // the row's middle about 21 degrees under the middle of the picture — but
  // never more than 15 degrees down. At the old cap of 20 (the 747 and the
  // Q400, whose screens hang deepest under their eyes) the horizon sat a
  // fifth of the way down from the top of the picture and the runway, on a
  // 3-degree approach, well above the middle: too much glareshield, too
  // little sky. Their screens' lower rows sit at the bottom edge of the
  // realistic view now; a glance down (look pitch) reads them.
  {
    const rowY = panel.group.position.y + dv * Math.cos(tilt);
    const down = (Math.atan2(E.y - rowY, E.z - zPanel) * 180) / Math.PI;
    group.userData.viewPitchDeg = clamp(down - 21, 8, VIEW_PITCH_MAX);
  }
  group.userData.family = 'airliner';
  group.userData.builder = `airliner:${id}`;
  group.userData.eye = E.clone();
  group.userData.deck = { panes: quads.length * 2, width: 2 * wallX(E.z, E.y), source: fd.hull ? 'pack' : 'hull', stick: C.stick, engines: C.engines };
  group.userData.hud = hud;
  group.userData.controls = { levers, conds, sticks, yokes, pedals, gear: gearHandle, flap };
  return group;
}
