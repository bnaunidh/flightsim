/**
 * Fast jets: the Vanguard, the Osprey, the F-22, the F-35B, the Hornet, Air
 * Massimo (the racer) and the Nightjar's two-seat flight deck.
 *
 * From the seat of a fighter what you see is the canopy: the bubble all
 * round you, its sill rails at your shoulders, a bow overhead on the types
 * that have one, the HUD's glass standing on the glareshield with the world
 * through it, and under the glareshield the screens. The room is built from
 * the exterior's own canopy (the pack's `config.canopy`: an ellipsoid over
 * z0..z1, `width`, `height`, `baseY`), so the sill is where the glass meets
 * the fuselage outside and every frame sits on the glass — nothing here is a
 * number that fits one aeroplane only. The pack's tinted canopy and its
 * stand-in seat are hidden from a camera inside it (kit.js seeThrough).
 *
 * What is live:
 *   - the HUD: pitch ladder, flight path marker, heading, speed, height, G,
 *     Mach — scaled from the glass's distance so its horizon IS the horizon
 *   - the screens (displays.js): attitude and heading, the moving map from
 *     the minimap's chart, engines, fuel and the missiles left, painted at
 *     about 12 Hz, never all on one frame
 *   - stick, throttle and rudder pedals with the controls; warning lamps and
 *     the master caution (common.js); blackout; panel lights at night
 *
 * Layouts per type (what the real ones are like, built our own way):
 *   hornet    two colour DDIs either side of the UFC, the map below (F/A-18, Osprey)
 *   viper     two MFDs low, the ICP and DED under the HUD, standby gauges (Vanguard)
 *   raptor    a big primary screen, two up-front displays, three more (F-22)
 *   pano      one panoramic screen across the panel, symbology in the helmet (F-35B)
 *   racer     a big speed screen and two small ones (Air Massimo)
 *   bomber    the Nightjar: two seats side by side, four screens, a centre throttle quadrant
 */

import * as THREE from '../../vendor/three.module.js';
import { clamp, lerp } from '../../core/noise.js';
import { GaugePanel } from './gauges.js';
import { label, roundRect, DIM, TEXT } from './paint.js';
import { TRAINER_EYE, warningLamps, cockpitEnv, ease } from './common.js';
import {
  Display,
  DisplayBus,
  readFlight,
  paintAdiHsi,
  paintMap,
  paintJetSystems,
  paintUFC,
  paintHUD,
  paintRacer,
  paintPFD,
  paintND,
  paintEICAS,
  missilesLeft,
} from './displays.js';
import {
  cockpitMaterials,
  roundedBox,
  tubeAlong,
  loft,
  polygon,
  part,
  bezel,
  ejectionSeat,
  centreStick,
  sideStick,
  throttleGrip,
  thrustLever,
  switchPanelMaterial,
  mergeStatic,
  seeThrough,
  carveExterior,
  insideOnly,
} from './kit.js';

/* ------------------------------------------------------------------ *
 * Per-type character
 * ------------------------------------------------------------------ */

const JET = {
  vanguard: { layout: 'viper', bow: null, rearArch: true, stick: 'centre', engines: 1, palette: { panel: '#30353b', trim: '#3d434a', frame: '#3a3f45' }, glassTint: 0xa8c4d6, title: 'VANGUARD F-1' },
  osprey: { layout: 'hornet', bow: 0.36, rearArch: true, stick: 'centre', engines: 2, palette: { panel: '#2e3339', trim: '#3a4047', frame: '#4b535c' }, glassTint: 0xa8c4d6, title: 'OSPREY CV' },
  f22: { layout: 'raptor', bow: null, rearArch: true, stick: 'side', engines: 2, palette: { panel: '#26292d', trim: '#2f3337', frame: '#2c3034' }, glassTint: 0xd9b871, glassOpacity: 0.1, title: 'F-22' },
  f35b: { layout: 'pano', bow: 0.3, rearArch: true, stick: 'side', engines: 1, hmd: true, palette: { panel: '#25282c', trim: '#2e3236', frame: '#33373c' }, glassTint: 0xb8c6cf, title: 'F-35B' },
  fa18: { layout: 'hornet', bow: 0.36, rearArch: true, stick: 'centre', engines: 2, palette: { panel: '#2c3136', trim: '#394047', frame: '#3f464e' }, glassTint: 0xa8c4d6, title: 'F/A-18' },
  massimo: { layout: 'racer', bow: null, rearArch: true, stick: 'centre', engines: 2, racer: true, palette: { panel: '#1e2125', trim: '#e9ecef', frame: '#c4262b', glare: '#15171a', seat: '#8f1c1f' }, glassTint: 0xc8d8e2, title: 'AIR MASSIMO' },
  nightjar: { layout: 'bomber', engines: 4, palette: { panel: '#2a2e33', trim: '#3a3f45', frame: '#25292d' }, title: 'NIGHTJAR B-2' },
  // The A-10C: a Hornet-style pair of MFCDs flanking the up-front keypad
  // under a conventional HUD, a centre stick, two throttles on the left
  // console, grey-green panels; a flat-fronted bubble with no bow.
  a10: { layout: 'hornet', bow: null, rearArch: true, stick: 'centre', engines: 2, palette: { panel: '#2f3431', trim: '#3a403c', frame: '#3b403d' }, glassTint: 0xa8c4d6, title: 'A-10C' },
};

/**
 * An up-front keypad painted into the panel's canvas: function keys down the
 * left, the 3 x 4 number pad, the option windows down the right. (u, top)
 * in panel metres; static art, drawn once.
 */
function paintKeypad(panel, { u, top, w, h }) {
  panel.paint((g, P) => {
    const x0 = P.px(u - w / 2);
    const y0 = P.py(top);
    const W = P.pr(w);
    const H = P.pr(h);
    const r = (n) => P.pr(n);
    // The housing: a raised plate with a darker well round it.
    g.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(g, x0 - r(0.004), y0 - r(0.004), W + r(0.008), H + r(0.008), r(0.008));
    g.fill();
    g.fillStyle = '#1b1f24';
    roundRect(g, x0, y0, W, H, r(0.006));
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = Math.max(1, r(0.0012));
    g.stroke();
    const key = (cx, cy, kw, kh, text, size = 0.0072, colour = TEXT) => {
      g.fillStyle = '#0d0f12';
      roundRect(g, P.px(cx - kw / 2) - r(0.0012), P.py(cy + kh / 2) - r(0.0012), r(kw) + r(0.0024), r(kh) + r(0.0024), r(0.002));
      g.fill();
      const grd = g.createLinearGradient(0, P.py(cy + kh / 2), 0, P.py(cy - kh / 2));
      grd.addColorStop(0, '#3a4048');
      grd.addColorStop(1, '#262a30');
      g.fillStyle = grd;
      roundRect(g, P.px(cx - kw / 2), P.py(cy + kh / 2), r(kw), r(kh), r(0.0016));
      g.fill();
      if (text) label(g, P.px(cx), P.py(cy), text, Math.max(6, Math.round(r(size))), colour, 'center', 700);
    };
    const left = u - w / 2;
    // Function keys, left column.
    const fx = left + 0.022;
    ['A/P', 'IFF', 'TCN', 'D/L'].forEach((t, i) => key(fx, top - 0.018 - i * 0.022, 0.028, 0.015, t, 0.0062));
    // The number pad.
    const pads = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLR', '0', 'ENT'];
    pads.forEach((t, i) => {
      const cx = u - 0.016 + (i % 3) * 0.024;
      const cy = top - 0.02 - Math.floor(i / 3) * 0.022;
      key(cx, cy, 0.019, 0.016, t, t.length > 1 ? 0.0055 : 0.0085);
    });
    // Option windows, right column: dark glass with a colon cueing each.
    const ox = u + w / 2 - 0.02;
    for (let i = 0; i < 5; i++) {
      const cy = top - 0.016 - i * 0.02;
      g.fillStyle = '#05080a';
      roundRect(g, P.px(ox - 0.014), P.py(cy + 0.0065), r(0.028), r(0.013), r(0.0014));
      g.fill();
      g.strokeStyle = 'rgba(120,140,150,0.35)';
      g.lineWidth = Math.max(1, r(0.0008));
      g.stroke();
      label(g, P.px(ox - 0.01), P.py(cy), ':', Math.max(6, Math.round(r(0.007))), '#2f8f55', 'center', 700);
    }
  });
}

/** Where the HUD's eye is in the realistic cockpit view (flight/camera.js REALISTIC_OFFSET). */
const REALISTIC = new THREE.Vector3(0, -0.02, 0.16);

/* ------------------------------------------------------------------ *
 * The builder
 * ------------------------------------------------------------------ */

export function buildJetCockpit(ctx) {
  const { type, model, space } = ctx;
  const id = type && JET[type.id] ? type.id : ctx.family === 'racer' ? 'massimo' : 'vanguard';
  const C = JET[id];
  if (C.layout === 'bomber') return buildBomber(ctx, C, id);

  const group = new THREE.Group();
  group.name = 'cockpit';
  const M = cockpitMaterials(C.palette);
  const E = new THREE.Vector3(...TRAINER_EYE);
  const eyeM = space.toModel(E);
  const L = (x, y, z) => space.toLocal([x, y, z], new THREE.Vector3());
  const cx = L(0, 0, 0).x;
  const k = space.k;

  /* ---- The canopy, in model units, then in cockpit metres ---- */
  const cfg = model && model.userData && model.userData.config;
  const q0 = cfg && cfg.canopy && typeof cfg.canopy.z0 === 'number' ? cfg.canopy : null;
  const q = q0 || { z0: eyeM.z - 1.4 / k, z1: eyeM.z + 1.7 / k, width: 0.55 / k, height: 0.6 / k, baseY: eyeM.y - 0.42 / k };
  const mid = (q.z0 + q.z1) / 2;
  const half = (q.z1 - q.z0) / 2;
  const zl = (zm) => L(0, 0, zm).z;
  const zm = (z) => space.toModel([cx, E.y, z]).z;
  const eAt = (z) => Math.sqrt(Math.max(0, 1 - ((zm(z) - mid) / half) ** 2));
  const W = q.width * k; // metres
  const Hc = q.height * k;
  const ySill = L(0, q.baseY, 0).y;
  const rim = (z) => W * eAt(z);
  /** The canopy's inner surface at local z, angle a from the top (+ right). */
  const canopyAt = (z, a, inset = 0.012) => {
    const e = eAt(z);
    const r = 1 - inset / Math.max(0.05, Math.min(W, Hc) * Math.max(e, 0.2));
    return new THREE.Vector3(cx + W * e * Math.sin(a) * r, ySill + Hc * e * Math.cos(a) * r, z);
  };
  /** Half-width of the canopy glass at local (z, y); 0 above it, rim below the sill. */
  const glassHalf = (z, y) => {
    const e = eAt(z);
    if (e <= 0) return 0;
    const t = (y - ySill) / (Hc * e);
    if (t <= 0) return W * e;
    if (t >= 1) return 0;
    return W * e * Math.sqrt(1 - t * t);
  };
  const zFront = zl(q.z0);
  const zBack = zl(q.z1);

  /* ---- Reference heights and depths (cockpit metres) ---- */
  const yGlare = E.y - 0.2;
  const zPanel = E.z - (C.racer ? 0.66 : 0.72);
  const zLip = zPanel + 0.035;
  const yPanelTop = yGlare - 0.03;
  const yFloor = E.y - 1.12;
  const yConsole = Math.min(ySill - 0.05, E.y - 0.5);
  const rimMin = Math.min(rim(zPanel), rim(E.z + 0.35));
  const xOut = Math.max(0.3, Math.min(rimMin - 0.012, 0.5));
  const xIn = Math.max(0.2, xOut - 0.16);
  const zTubBack = E.z + 0.55;
  // Where the glareshield's top meets the glass, centre line.
  let zMeet = zPanel;
  for (let z = zPanel; z > zFront; z -= 0.01) {
    if (glassHalf(z, yGlare) < 0.04) break;
    zMeet = z;
  }

  /* ================================================================ *
   * Canopy: sill rails, the bow and the rear arch
   *
   * No glass of its own: a transparent shell round the camera is a
   * full-screen blend every frame, and the cockpit view has to cost no more
   * than the follow view. The canopy reads from its frames, and the
   * exterior's tinted glass is hidden from inside (below).
   * ================================================================ */
  // Sill rails, along the rim each side.
  const railZ0 = Math.max(zFront + 0.05, zMeet - 0.1);
  const railZ1 = zBack - 0.05;
  for (const s of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 20; i++) {
      const z = lerp(railZ0, railZ1, i / 20);
      pts.push(new THREE.Vector3(cx + s * (rim(z) - 0.022), ySill + 0.012, z));
    }
    part(group, tubeAlong(pts, 0.022, 40, 8), M.frame, 0, 0, 0, 'canopy sill rail');
    // A flange under it, so the rail sits on something.
    const inner = pts.map((v) => new THREE.Vector3(v.x - s * 0.05, ySill - 0.01, v.z));
    const outer = pts.map((v) => new THREE.Vector3(v.x + s * 0.012, ySill - 0.004, v.z));
    part(group, loft(s > 0 ? inner : outer, s > 0 ? outer : inner, false), M.frame, 0, 0, 0, 'canopy sill');
  }
  /** An arch inside the glass across the canopy at local z: the bow. */
  const arch = (z, r = 0.026, flange = 0.06, name = 'canopy bow') => {
    const pts = [];
    const n = 24;
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI / 2 + (Math.PI * i) / n;
      pts.push(canopyAt(z, a, 0.03));
    }
    part(group, tubeAlong(pts, r, 48, 10), M.frame, 0, 0, 0, name);
    // The flange: a strip just inside the glass, fore and aft of the tube.
    const a1 = [];
    const b1 = [];
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI / 2 + (Math.PI * i) / n;
      a1.push(canopyAt(z - flange / 2, a, 0.02));
      b1.push(canopyAt(z + flange / 2, a, 0.02));
    }
    part(group, loft(a1, b1, true), M.frame, 0, 0, 0, `${name} flange`).material = M.frame;
    return pts;
  };
  if (C.bow) {
    const zb = E.z - C.bow;
    const top = arch(zb, 0.018, 0.045);
    // Three mirrors on the bow, angled back at the pilot.
    const mirrorMat = new THREE.MeshStandardMaterial({ color: 0xcfd8df, roughness: 0.05, metalness: 1, envMapIntensity: 1.4 });
    for (const a of [-0.28, 0, 0.28]) {
      const pt = canopyAt(zb, a, 0.05);
      const mm = part(group, roundedBox(0.09, 0.03, 0.01, 0.005), M.darkMetal, pt.x, pt.y, pt.z + 0.02, 'mirror');
      mm.rotation.set(0.35, 0, -a * 0.9);
      const glassM = part(group, new THREE.PlaneGeometry(0.082, 0.023), mirrorMat, 0, 0, 0.0055, 'mirror glass');
      mm.add(glassM);
    }
    group.userData.bow = top;
  }
  if (C.rearArch) arch(E.z + 0.42, 0.03, 0.08, 'canopy rear arch');

  /* ================================================================ *
   * The tub: sill walls, consoles, floor, front and back
   * ================================================================ */
  const zT0 = zPanel + 0.02;
  const zT1 = zTubBack;
  const tubN = 16;
  for (const s of [-1, 1]) {
    const top = [];
    const con = [];
    for (let i = 0; i <= tubN; i++) {
      const z = lerp(zT0, zT1, i / tubN);
      top.push(new THREE.Vector3(cx + s * (rim(z) - 0.01), ySill - 0.008, z));
      con.push(new THREE.Vector3(cx + s * xOut, yConsole, z));
    }
    // The sill wall: from under the rail down to the console.
    part(group, loft(s > 0 ? con : top, s > 0 ? top : con, false), M.trim, 0, 0, 0, 'sill wall');
    // The console: a switch panel on top, a padded side down to the floor.
    const conMat = switchPanelMaterial({ w: 256, h: 512, rows: 8, cols: 3, seed: s > 0 ? 11 : 5, colour: C.palette.panel, labels: s > 0 ? ['ECS', 'O2', 'LIGHTS', 'INS', 'IFF', 'RADAR', 'NAV', 'PROBE'] : ['FUEL', 'ENG', 'APU', 'COMM', 'GEN', 'FLAPS', 'HOOK', 'JETT'] });
    const ct = part(group, new THREE.PlaneGeometry(xOut - xIn, zT1 - zT0), conMat, cx + s * (xOut + xIn) / 2, yConsole, (zT0 + zT1) / 2, 'console top');
    ct.rotation.x = -Math.PI / 2;
    const side = part(group, new THREE.PlaneGeometry(zT1 - zT0, yConsole - yFloor), M.trim, cx + s * xIn, (yConsole + yFloor) / 2, (zT0 + zT1) / 2, 'console side');
    side.rotation.y = -s * Math.PI / 2;
    // A rolled edge along the console's inner top corner.
    const edge = part(group, new THREE.CylinderGeometry(0.012, 0.012, zT1 - zT0, 8), M.darkMetal, cx + s * xIn, yConsole + 0.002, (zT0 + zT1) / 2);
    edge.rotation.x = Math.PI / 2;
  }
  // Floor.
  const floor = part(group, new THREE.PlaneGeometry(2 * xIn, zT1 - zT0), M.floor, cx, yFloor, (zT0 + zT1) / 2, 'floor');
  floor.rotation.x = -Math.PI / 2;
  // Knee well: the front, under the panel.
  part(group, new THREE.PlaneGeometry(2 * xOut, yConsole - yFloor + 0.3), M.trim, cx, (yConsole + yFloor) / 2 - 0.1, zT0 - 0.01, 'knee well');
  // Back: a bulkhead behind the seat up to the sill, then the turtle deck back
  // under the canopy to its end.
  part(group, new THREE.PlaneGeometry(2 * xOut, ySill - yFloor), M.trim, cx, (ySill + yFloor) / 2, zT1, 'aft bulkhead').rotation.y = Math.PI;
  {
    const a = [];
    const b = [];
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const z = lerp(zT1, zBack, i / n);
      const r = Math.max(0.02, rim(z) - 0.012);
      a.push(new THREE.Vector3(cx - r, ySill + 0.01, z));
      b.push(new THREE.Vector3(cx + r, ySill + 0.01, z));
    }
    part(group, loft(a, b, true), M.trim, 0, 0, 0, 'turtle deck');
    // Avionics boxes and an oxygen bottle on the deck behind the seat.
    part(group, roundedBox(0.34, 0.12, 0.26, 0.02), M.darkMetal, cx - 0.04, ySill + 0.07, zT1 + 0.32);
    part(group, roundedBox(0.2, 0.09, 0.2, 0.02), M.panel, cx + 0.17, ySill + 0.055, zT1 + 0.5);
    part(group, new THREE.CylinderGeometry(0.06, 0.06, 0.3, 12), M.white, cx + 0.12, ySill + 0.07, zT1 + 0.16).rotation.x = Math.PI / 2;
  }

  /* ================================================================ *
   * Glareshield and coaming
   * ================================================================ */
  {
    // The coaming top: the canopy's horizontal section at the glareshield's
    // height, from where it meets the glass back to the lip.
    const n = 18;
    const a = [];
    const b = [];
    for (let i = 0; i <= n; i++) {
      const z = lerp(zMeet, zLip - 0.02, i / n);
      const hw = Math.max(0.02, glassHalf(z, yGlare) - 0.006);
      a.push(new THREE.Vector3(cx - hw, yGlare, z));
      b.push(new THREE.Vector3(cx + hw, yGlare, z));
    }
    part(group, loft(a, b, true), M.glare, 0, 0, 0, 'glareshield');
    // The padded lip, a rolled edge across the panel's top.
    const hwL = Math.max(0.1, glassHalf(zLip, yGlare) - 0.01);
    const lip = part(group, new THREE.CylinderGeometry(0.028, 0.028, 2 * hwL, 14), M.glare, cx, yGlare - 0.022, zLip - 0.004, 'glareshield lip');
    lip.rotation.z = Math.PI / 2;
    // Its shadowed underside, back to the panel.
    const under = part(group, new THREE.PlaneGeometry(2 * hwL, 0.05), M.rubber, cx, yGlare - 0.045, zLip - 0.03);
    under.rotation.x = Math.PI / 2;
    // The sides: from the coaming down to the sill, along the glass.
    for (const s of [-1, 1]) {
      const top = [];
      const bot = [];
      for (let i = 0; i <= n; i++) {
        const z = lerp(zMeet, zPanel + 0.02, i / n);
        top.push(new THREE.Vector3(cx + s * Math.max(0.02, glassHalf(z, yGlare) - 0.006), yGlare, z));
        bot.push(new THREE.Vector3(cx + s * Math.max(0.03, rim(z) - 0.01), ySill - 0.01, z));
      }
      part(group, loft(s > 0 ? bot : top, s > 0 ? top : bot, true), M.glare, 0, 0, 0, 'coaming side');
    }
  }

  /* ================================================================ *
   * The instrument panel
   * ================================================================ */
  const tilt = -0.2;
  const yBot = E.y - 0.7;
  const pMid = (yPanelTop + yBot) / 2;
  // Outline, in the panel's own (u, v): the full width under the lip, then
  // down each side following the glass to the sill, the console, the knees.
  const vOf = (y) => (y - pMid) / Math.cos(tilt);
  const zAtV = (v) => zPanel - Math.sin(-tilt) * v;
  const outline = [];
  const right = [];
  const vTop = vOf(yPanelTop);
  const vSill = vOf(ySill);
  const vCon = vOf(yConsole);
  const vBot = vOf(yBot);
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const v = lerp(vTop, vSill, i / steps);
    const y = pMid + v * Math.cos(tilt);
    right.push([Math.max(0.12, glassHalf(zAtV(v), y) - 0.01), v]);
  }
  right.push([Math.max(0.12, rim(zPanel) - 0.012), vCon]);
  right.push([xIn, vCon]);
  right.push([xIn, vBot]);
  // Up the left side, across the top, down the right: one loop.
  outline.push(...right.map(([u, v]) => [-u, v]).reverse(), ...right);
  // GaugePanel wants (u, v) about its own centre; its width spans the widest.
  const uMax = Math.max(...right.map((r) => r[0]));
  const pW = 2 * uMax + 0.004;
  const pH = vTop - vBot + 0.004;
  const vShift = (vTop + vBot) / 2;
  const panel = new GaugePanel({
    width: pW,
    height: pH,
    outline: outline.map(([u, v]) => [u, v - vShift]),
    colour: ctx.highContrast ? '#15181c' : C.palette.panel,
    highContrast: ctx.highContrast,
  });
  panel.group.position.set(cx, pMid + vShift * Math.cos(tilt), zPanel - Math.sin(-tilt) * vShift);
  panel.group.rotation.x = tilt;
  group.add(panel.group);
  const V = (y) => vOf(y) - vShift; // a height in cockpit metres -> panel v
  const vt = vTop - vShift;
  const vb = vBot - vShift;

  const bus = new DisplayBus({ hz: 10, maxPerFrame: 2 });
  const displays = [];
  /** Mount a screen on the panel at (u, v): its bezel in 3D, its recess painted. */
  const mount = (name, u, v, w, h, paint, opts = {}) => {
    const px = Math.round(512 * Math.min(1, w / h));
    const py = Math.round(512 * Math.min(1, h / w));
    const d = new Display({ name, w: px, h: py, widthM: w, heightM: h, paint, hz: opts.hz || 0 });
    d.mesh.position.set(u, v, 0.0125); // the glass, in front of the bezel's dark back (bezel at 0.012)
    d.mesh.receiveShadow = true;
    panel.group.add(d.mesh);
    const bz = bezel(M, w, h, { bw: opts.bw ?? 0.02, n: opts.buttons ?? 5, sideButtons: opts.side !== false, topButtons: opts.top !== false });
    bz.position.set(u, v, 0.012);
    panel.group.add(bz);
    panel.paint((g, P) => {
      g.fillStyle = 'rgba(0,0,0,0.55)';
      roundRect(g, P.px(u - w / 2 - 0.03), P.py(v + h / 2 + 0.03), P.pr(w + 0.06), P.pr(h + 0.06), P.pr(0.008));
      g.fill();
    });
    bus.add(d);
    displays.push(d);
    return d;
  };
  const stores = missilesLeft;
  const ufcRows = (d) => [
    [`${C.title}`, d.ap ? 'A/P' : ''],
    [`HDG ${String(Math.round(d.hdg) % 360).padStart(3, '0')}`, `ALT ${Math.round(d.alt)}`],
    [`SPD ${Math.round(d.ias)}`, `FUEL ${Math.round(d.fuel * 100)}%`],
  ];

  const lay = C.layout;
  let ufcV = vt - 0.06;
  if (lay === 'hornet') {
    // Two DDIs high either side of the HUD's foot (their tops clear of the
    // glareshield's overhang), the map display low in the middle; the UFC is
    // on the HUD's own face (below).
    const s = 0.165;
    const vU = vt - s / 2 - 0.05;
    mount('left DDI', -0.205, vU, s, s, (g, w, h, d) => paintAdiHsi(g, w, h, d, { title: 'ADI' }));
    mount('right DDI', 0.205, vU, s, s, (g, w, h, d) => paintJetSystems(g, w, h, d, { title: 'ENG', stores: C.racer ? null : stores }), { hz: 6 });
    mount('AMPCD', 0, vU - s / 2 - 0.035 - s / 2 + 0.035, s, s, (g, w, h, d) => paintMap(g, w, h, d, { title: 'MAP', rangeNm: 10 }), { hz: 6 });
    ufcV = vt - 0.06;
    // Between the DDIs, under the HUD: the up-front keypad. Painted once into
    // the panel (no draw of its own); left bare it read as a dead screen.
    paintKeypad(panel, { u: 0, top: vt - 0.08, w: 0.172, h: 0.108 });
  } else if (lay === 'viper') {
    // Two MFDs either side, the standby flight instruments between them
    // the steam way, the DED on the HUD's face above.
    const s = 0.145;
    const vM = vt - s / 2 - 0.13;
    mount('left MFD', -0.205, vM, s, s, (g, w, h, d) => paintMap(g, w, h, d, { title: 'HSD', rangeNm: 8 }), { hz: 6 });
    mount('right MFD', 0.205, vM, s, s, (g, w, h, d) => paintJetSystems(g, w, h, d, { title: 'SMS', stores }), { hz: 6 });
    const R = 0.04;
    panel.ai({ u: 0, v: vM + 0.035, R });
    panel.asi({ u: -0.07, v: vM - 0.06, R: R * 0.8, min: 0, max: 800, white: [120, 200], green: [150, 600], yellow: [600, 700], red: 700, step: 25, majorStep: 100 });
    panel.alt({ u: 0.07, v: vM - 0.06, R: R * 0.8 });
    ufcV = vt - 0.06;
  } else if (lay === 'raptor') {
    mount('primary MFD', 0, vt - 0.2, 0.2, 0.2, (g, w, h, d) => paintMap(g, w, h, d, { title: 'SA', rangeNm: 20 }), { hz: 6 });
    mount('UFD left', -0.15, vt - 0.05, 0.1, 0.06, (g, w, h, d) => paintUFC(g, w, h, d, { rows: (dd) => [[`SPD ${Math.round(dd.ias)}`, ''], [`M ${dd.mach.toFixed(2)}`, ''], [`G ${dd.g.toFixed(1)}`, '']] }), { buttons: 0, side: false, top: false, bw: 0.01 });
    mount('UFD right', 0.15, vt - 0.05, 0.1, 0.06, (g, w, h, d) => paintUFC(g, w, h, d, { rows: (dd) => [[`ALT ${Math.round(dd.alt)}`, ''], [`HDG ${String(Math.round(dd.hdg) % 360).padStart(3, '0')}`, ''], [`FUEL ${Math.round(dd.fuel * 100)}%`, '']] }), { buttons: 0, side: false, top: false, bw: 0.01 });
    mount('left MFD', -0.215, vt - 0.235, 0.13, 0.13, (g, w, h, d) => paintAdiHsi(g, w, h, d, { title: 'ATT' }));
    mount('right MFD', 0.215, vt - 0.235, 0.13, 0.13, (g, w, h, d) => paintJetSystems(g, w, h, d, { title: 'ENG', stores }), { hz: 6 });
    ufcV = vt - 0.05;
  } else if (lay === 'pano') {
    const w = 0.25;
    const h = 0.19;
    const v = vt - h / 2 - 0.04;
    mount('portal left', -w / 2 - 0.004, v, w, h, (g, ww, hh, d) => paintMap(g, ww, hh, d, { title: 'TSD', rangeNm: 15 }), { hz: 6, buttons: 0, side: false, top: false, bw: 0.012 });
    mount('portal right', w / 2 + 0.004, v, w, h, (g, ww, hh, d) => paintAdiHsi(g, ww, hh, d, { title: 'PFD' }), { buttons: 0, side: false, top: false, bw: 0.012 });
    mount('ICAW', 0, v - h / 2 - 0.05, 0.12, 0.05, (g, ww, hh, d) => paintJetSystems(g, ww, hh, d, { title: 'ENG', stores }), { hz: 6, buttons: 0, side: false, top: false, bw: 0.01 });
    ufcV = v + h / 2;
  } else if (lay === 'racer') {
    mount('race screen', 0, vt - 0.11, 0.21, 0.15, (g, w, h, d) => paintRacer(g, w, h, d), { buttons: 0, side: false, top: false, bw: 0.016 });
    mount('left MFD', -0.2, vt - 0.14, 0.11, 0.11, (g, w, h, d) => paintAdiHsi(g, w, h, d, { title: 'ATT' }), { buttons: 4 });
    mount('right MFD', 0.2, vt - 0.14, 0.11, 0.11, (g, w, h, d) => paintMap(g, w, h, d, { title: 'NAV', rangeNm: 25 }), { hz: 6, buttons: 4 });
  }

  /* ---- Lamps: the warning panel, right; master caution under the glareshield ---- */
  const lampU = Math.min(uMax - 0.07, 0.33);
  const warn = warningLamps(panel.group, {
    size: [0.05, 0.02],
    masterSize: [0.07, 0.026],
    place: (m, i) => m.position.set(lampU + (i % 2) * 0.054 - 0.027, vt - 0.11 - Math.floor(i / 2) * 0.024, 0.004),
    placeMaster: (m) => m.position.set(-Math.min(uMax - 0.08, 0.32), vt - 0.04, 0.004),
  });
  // Gear handle and its three greens, left; the AP lamp beside the UFC.
  const gu = -Math.min(uMax - 0.08, 0.33);
  const gv = vt - 0.14;
  panel.paint((g, P) => {
    g.fillStyle = '#0c0e11';
    roundRect(g, P.px(gu - 0.03), P.py(gv + 0.07), P.pr(0.06), P.pr(0.15), P.pr(0.006));
    g.fill();
    label(g, P.px(gu), P.py(gv + 0.08), 'LDG GEAR', Math.round(P.pr(0.006)), DIM);
    label(g, P.px(lampU), P.py(vt - 0.085), 'CAUTION', Math.round(P.pr(0.006)), DIM);
    label(g, P.px(0), P.py(vb + 0.02), C.title, Math.round(P.pr(0.009)), TEXT, 'center', 700);
  });
  for (const du of [-0.016, 0, 0.016]) {
    panel.lamp({ u: gu + du, v: gv - 0.06, w: 0.011, h: 0.011, round: true, colour: 0x3ec96a, on: (s, ac) => (ac.gearPos ?? 0) > 0.98 });
  }
  panel.lamp({ u: gu, v: gv - 0.08, w: 0.04, h: 0.013, text: 'UNSAFE', colour: 0xff3b25, on: (s, ac) => (ac.gearPos ?? 0) > 0.02 && (ac.gearPos ?? 0) < 0.98, size: 0.7 });
  panel.lamp({ u: 0.09, v: ufcV, w: 0.03, h: 0.014, text: 'A/P', colour: 0x3ec96a, on: (s, ac, env) => env.autopilot, size: 0.7 });
  const gearHandle = new THREE.Group();
  gearHandle.name = 'gear handle';
  gearHandle.userData.dynamic = true;
  part(gearHandle, new THREE.CylinderGeometry(0.004, 0.004, 0.06, 8), M.metal, 0, 0, 0.03).rotation.x = Math.PI / 2;
  part(gearHandle, new THREE.CylinderGeometry(0.014, 0.014, 0.01, 16), M.white, 0, 0, 0.06).rotation.x = Math.PI / 2;
  gearHandle.position.set(gu, gv, 0.002);
  gearHandle.userData.v0 = gv;
  panel.group.add(gearHandle);
  panel.finish();

  /* ================================================================ *
   * The HUD (or the helmet's symbology)
   * ================================================================ */
  let hud = null;
  {
    const hmd = !!C.hmd;
    const dist = hmd ? 0.95 : 0.56;
    const wc = hmd ? 0.42 : 0.19;
    const hc = hmd ? 0.34 : 0.17;
    const zH = E.z - dist;
    const top = E.y + hc * (hmd ? 0.4 : 0.32);
    const base = top - hc;
    const geom = { boreY: (top - E.y) / hc, ppd: 1 };
    const hudDisplay = new Display({
      name: hmd ? 'helmet symbology' : 'HUD',
      w: 512,
      h: Math.round((512 * hc) / wc),
      widthM: wc,
      heightM: hc,
      hud: true,
      hz: 12,
      colour: new THREE.Color(0x9dffb4).multiplyScalar(hmd ? 0.75 : 0.95),
      paint: (g, w, h, d) => {
        // The eye this frame: the realistic view sits back and a little lower.
        const real = !!d.realistic;
        const D = dist + (real ? REALISTIC.z : 0);
        const eyeY = E.y + (real ? REALISTIC.y : 0);
        geom.ppd = (w / wc) * D * Math.tan(Math.PI / 180);
        geom.boreY = (top - eyeY) / hc;
        paintHUD(g, w, h, d, { pxPerDeg: () => geom.ppd, boreY: geom.boreY });
      },
    });
    hudDisplay.mesh.position.set(cx, (top + base) / 2, zH + 0.002);
    hudDisplay.mesh.renderOrder = 40;
    // The helmet draws its symbology over everything, the coaming included.
    if (hmd) hudDisplay.material.depthTest = false;
    hudDisplay.userData = geom;
    group.add(hudDisplay.mesh);
    bus.add(hudDisplay);
    displays.push(hudDisplay);
    hud = hudDisplay;
    if (!hmd) {
      // The combiner glass, its frame posts and the projector under it.
      const glass = part(group, new THREE.PlaneGeometry(wc, hc), M.glass, cx, (top + base) / 2, zH, 'HUD combiner');
      glass.material = M.glass.clone();
      glass.material.color.set(0x9fe0b8);
      glass.material.opacity = 0.08;
      glass.castShadow = false;
      glass.renderOrder = 35;
      for (const s of [-1, 1]) {
        part(group, roundedBox(0.012, hc + 0.012, 0.016, 0.004), M.darkMetal, cx + s * (wc / 2 + 0.006), (top + base) / 2, zH, 'HUD frame');
      }
      part(group, roundedBox(wc + 0.024, 0.01, 0.016, 0.004), M.darkMetal, cx, top + 0.006, zH, 'HUD frame');
      // The projector under the combiner: forward of it, so it hides nothing
      // on the panel. Its face towards the pilot carries the up-front
      // control: a little screen over a row of keys (the Hornet's UFC, the
      // F-16's ICP and DED).
      const bodyH = Math.max(0.03, base - yGlare);
      const face = zH + 0.016;
      part(group, roundedBox(0.17, bodyH, 0.19, 0.012), M.darkMetal, cx, yGlare + bodyH / 2, face - 0.095, 'HUD body');
      const keysH = Math.min(0.04, bodyH * 0.45);
      part(group, new THREE.PlaneGeometry(0.15, keysH), switchPanelMaterial({ w: 256, h: 80, rows: 1, cols: 5, seed: 3, colour: '#1f2226', labels: ['TACAN', 'ILS', 'IFF', 'D/L', 'BCN'] }), cx, yGlare + 0.006 + keysH / 2, face + 0.001, 'UFC keys');
      if (lay === 'hornet' || lay === 'viper') {
        const uh = Math.max(0.02, bodyH - keysH - 0.016);
        const ufc = new Display({ name: lay === 'viper' ? 'DED' : 'UFC', hz: 4, kind: 'text', w: 512, h: Math.round((512 * uh) / 0.13), widthM: 0.13, heightM: uh, paint: (g, w, h, d) => paintUFC(g, w, h, d, { rows: ufcRows, colour: lay === 'viper' ? '#ffcf5a' : '#3cf27a' }) });
        ufc.mesh.position.set(cx, yGlare + bodyH - 0.006 - uh / 2, face + 0.002);
        group.add(ufc.mesh);
        bus.add(ufc);
        displays.push(ufc);
      }
    }
  }

  /* ================================================================ *
   * What you hold, and the seat
   * ================================================================ */
  const seat = ejectionSeat(M, { width: Math.min(0.5, 2 * xIn - 0.06) });
  seat.position.set(cx, E.y - 0.86, E.z - 0.32);
  group.add(seat);
  let stick;
  if (C.stick === 'side') {
    stick = sideStick(M);
    stick.position.set(cx + xIn + 0.07, yConsole + 0.005, E.z - 0.16);
    // The arm rest it is used from.
    part(group, roundedBox(0.09, 0.05, 0.26, 0.02), M.seat, cx + xIn + 0.07, yConsole + 0.03, E.z + 0.06, 'arm rest');
  } else {
    stick = centreStick(M);
    stick.position.set(cx, yFloor + 0.32, E.z - 0.43);
  }
  stick.userData.dynamic = true;
  group.add(stick);
  const throttle = throttleGrip(M, { twin: C.engines > 1 });
  throttle.position.set(cx - xIn - 0.065, yConsole + 0.004, E.z - 0.12);
  throttle.userData.dynamic = true;
  group.add(throttle);
  // Its slot.
  part(group, new THREE.BoxGeometry(0.02, 0.004, 0.24), M.rubber, cx - xIn - 0.065, yConsole + 0.002, E.z - 0.12);
  // Rudder pedals.
  const pedals = [];
  for (const s of [-1, 1]) {
    const p = part(group, roundedBox(0.09, 0.15, 0.025, 0.01), M.darkMetal, cx + s * 0.13, yFloor + 0.13, zPanel + 0.14, 'rudder pedal');
    p.rotation.x = -0.4;
    p.userData.dynamic = true;
    pedals.push({ mesh: p, side: s, z0: p.position.z });
  }

  /* ================================================================ *
   * The exterior from inside
   * ================================================================ */
  if (model && q0) {
    const inside = (p) => {
      const t = ((p.x) / q.width) ** 2 + ((p.y - q.baseY) / q.height) ** 2 + ((p.z - mid) / half) ** 2;
      return t < 1.15 && p.y > q.baseY - 0.9 / k;
    };
    model.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const glassy = mats.some((m) => m && m.transparent && m.opacity < 0.9 && /glaz|glass/i.test(m.name || ''));
      if (glassy) {
        // Glass casts no shadow: the sun comes in through the canopy.
        o.castShadow = false;
        seeThrough(o, model, inside);
      } else if (/seat/i.test(o.name || '')) seeThrough(o, model, inside);
    });
    // The fuselage runs on under the canopy and bulges up through the tub:
    // from inside, everything of the exterior within the cockpit's box is
    // cut away (the spine behind it, the nose ahead of it, stay).
    const box = new THREE.Box3(
      new THREE.Vector3(-q.width - 0.02 / k, eyeM.y - 1.3 / k, zm(zMeet) - 0.02 / k),
      new THREE.Vector3(q.width + 0.02 / k, q.baseY + q.height + 0.05 / k, q.z1 + 0.05 / k)
    );
    const cut = carveExterior(model, box);
    group.userData.carved = cut.carved;
    group.userData.viewing = insideOnly(cut.hidden);
  }

  /* ---- Merge what never moves ---- */
  mergeStatic(group, (o) => o === panel.face);

  /* ================================================================ *
   * Live
   * ================================================================ */
  const env = {};
  let t = 0;
  const engines = C.engines;
  const read = (out) => {
    readFlight(lastAc, lastSim, out, engines);
    out.realistic = !!(lastSim && lastSim.settings && lastSim.settings.realisticCockpit);
  };
  let lastAc = null;
  let lastSim = null;
  let painted = false;
  group.userData.update = (dt, ac, weather, sim) => {
    t += dt;
    lastAc = ac;
    lastSim = sim || null;
    cockpitEnv(weather, sim, env);
    warn.update(t, ac, env);
    panel.update(dt, ac, env);
    // The first frame paints every screen, so none is ever seen blank.
    if (!painted) {
      painted = true;
      bus.paintAll(read, env);
    } else bus.update(dt, read, env);
    const light = env.blackout ? 0 : 1;
    for (const d of displays) if (!d.hud) d.material.emissiveIntensity = light * (0.95 - env.panelLight * 0.35);
    const c = ac.controls || {};
    // Stick: forward and back for pitch, side to side for roll.
    stick.rotation.x = ease(stick.rotation.x, -(c.pitch || 0) * 0.28, 12, dt);
    stick.rotation.z = ease(stick.rotation.z, -(c.roll || 0) * 0.28, 12, dt);
    const thr = clamp(c.throttle || 0, 0, 1);
    throttle.userData.lever.position.z = ease(throttle.userData.lever.position.z, 0.08 - thr * 0.17, 8, dt);
    for (const p of pedals) p.mesh.position.z = p.z0 + (c.yaw || 0) * p.side * 0.04;
    gearHandle.position.y = ease(gearHandle.position.y, gearHandle.userData.v0 + (ac.gearDown ? -0.03 : 0.03), 6, dt);
  };
  group.userData.panel = panel;
  group.userData.panelFace = panel.face;
  group.userData.warnings = warn.lamps;
  group.userData.displays = displays;
  group.userData.bus = bus;
  group.userData.hud = hud;
  group.userData.family = ctx.family === 'racer' ? 'racer' : 'jet';
  group.userData.builder = `jet:${id}`;
  group.userData.canopy = { z0: q.z0, z1: q.z1, width: q.width, height: q.height, baseY: q.baseY, source: q0 ? 'pack' : 'default' };
  group.userData.eye = E.clone();
  group.userData.controls = { stick, throttle, pedals };
  return group;
}

/* ------------------------------------------------------------------ *
 * The Nightjar: a two-seat flight deck under four flat panes
 * ------------------------------------------------------------------ */

/** The pack's flight-deck glass, by name, as model-space polygons. */
const NIGHTJAR_GLASS = {
  'windshield left': [[-0.76, 0.4, -5.37], [0, 0.44, -5.56], [0, 0.79, -4.67], [-0.91, 0.64, -4.55]],
  'windshield right': [[0, 0.44, -5.56], [0.76, 0.4, -5.37], [0.91, 0.64, -4.55], [0, 0.79, -4.67]],
  'left side glass': [[-0.76, 0.4, -5.37], [-0.91, 0.64, -4.55], [-0.82, 0.62, -3.96], [-0.86, 0.43, -4.26]],
  'right side glass': [[0.76, 0.4, -5.37], [0.86, 0.43, -4.26], [0.82, 0.62, -3.96], [0.91, 0.64, -4.55]],
};

function buildBomber(ctx, C, id) {
  const { model, space } = ctx;
  const group = new THREE.Group();
  group.name = 'cockpit';
  const M = cockpitMaterials(C.palette);
  const E = new THREE.Vector3(...TRAINER_EYE);
  const L = (p) => space.toLocal(p, new THREE.Vector3());
  const cx = L([0, 0, 0]).x;
  const panes = {};
  for (const [n, pts] of Object.entries(NIGHTJAR_GLASS)) panes[n] = pts.map(L);
  const wl = panes['windshield left'];
  const wr = panes['windshield right'];
  const sl = panes['left side glass'];
  const sr = panes['right side glass'];
  // Key points.
  const ctrBot = wl[1]; // centre post, bottom
  const ctrTop = wl[2];
  const cornerBotL = wl[0];
  const cornerTopL = wl[3];
  const yFloor = E.y - 1.1;
  const zBackWall = Math.max(sl[2].z, sr[2].z) + 0.35;
  const halfIn = Math.abs(sl[3].x - cx) - 0.02;
  const mirror = (v) => new THREE.Vector3(2 * cx - v.x, v.y, v.z);

  /* ---- Frames along every pane edge ---- */
  const frameEdges = [
    [wl[0], wl[1]], [wr[0], wr[1]], [wl[1], wl[2]], [wl[2], wl[3]], [wr[2], wr[3]], [wl[3], wl[0]], [wr[3], wr[1]],
    [sl[0], sl[3]], [sl[3], sl[2]], [sl[2], sl[1]], [sr[0], sr[1]], [sr[1], sr[2]], [sr[2], sr[3]],
  ];
  const inward = (v, amt = 0.02) => new THREE.Vector3(lerp(v.x, cx, amt / Math.max(0.2, Math.abs(v.x - cx) + 0.2)), v.y - amt * 0.6, v.z + amt * 0.4);
  for (const [a, b] of frameEdges) {
    part(group, tubeAlong([inward(a), inward(b)], 0.018, 2, 8), M.frame, 0, 0, 0, 'window frame');
  }
  /* ---- The ceiling ----
   * The pack's roof is barely a hand's width over the pilot's eye, so the
   * ceiling inside starts on the windscreen's top frame and rises to a
   * flat 16 cm over the eye — never closer than the camera's near plane
   * can take — and runs back to the bulkhead. */
  const yRoof = Math.max(E.y + 0.16, ctrTop.y - 0.05);
  const front = [];
  const midL = [];
  const rear = [];
  const nRoof = 8;
  const zMidRoof = E.z - 0.05;
  for (let i = 0; i <= nRoof; i++) {
    const f = i / nRoof; // left corner -> centre -> right corner
    const a = f <= 0.5 ? cornerTopL.clone().lerp(ctrTop, f * 2) : ctrTop.clone().lerp(mirror(cornerTopL), (f - 0.5) * 2);
    a.y -= 0.025;
    front.push(a);
    midL.push(new THREE.Vector3(a.x, yRoof, Math.max(a.z + 0.05, zMidRoof)));
    rear.push(new THREE.Vector3(a.x, yRoof, zBackWall));
  }
  part(group, loft(front, midL, false), M.trim, 0, 0, 0, 'ceiling');
  part(group, loft(midL, rear, false), M.trim, 0, 0, 0, 'ceiling');
  const rearTop = new THREE.Vector3(cx, yRoof, zBackWall);
  /* ---- Walls under the side glass, down to the floor, and over it to the ceiling ---- */
  for (const s of [-1, 1]) {
    const side = s < 0 ? sl : [sr[0], sr[3], sr[2], sr[1]];
    const xw = cx + s * (halfIn + 0.02);
    const fb = side[0]; // front-bottom of the side glass
    const rb = side[3]; // rear-bottom
    const rt = side[2]; // rear-top
    const ft = side[1]; // front-top
    const wall = [
      new THREE.Vector3(xw, yFloor, fb.z - 0.2),
      new THREE.Vector3(xw, yFloor, zBackWall),
      new THREE.Vector3(xw, yRoof + 0.01, zBackWall),
      new THREE.Vector3(xw, yRoof + 0.01, rt.z),
      new THREE.Vector3(xw, rt.y, rt.z),
      new THREE.Vector3(xw, rb.y - 0.01, rb.z),
      new THREE.Vector3(xw, fb.y - 0.01, fb.z),
    ];
    part(group, polygon(wall, s < 0), M.trim, 0, 0, 0, 'side wall');
    // Over the side glass, up to the ceiling.
    const ftw = new THREE.Vector3(ft.x, ft.y + 0.005, ft.z);
    const rtw = new THREE.Vector3(rt.x, rt.y + 0.005, rt.z);
    part(group, loft([ftw, rtw], [new THREE.Vector3(ft.x, yRoof + 0.01, ft.z), new THREE.Vector3(xw, yRoof + 0.01, rt.z)], false), M.trim, 0, 0, 0, 'side wall');
    // A console along the wall.
    part(group, roundedBox(0.2, 0.06, 0.9, 0.015), M.panel, xw - s * 0.11, E.y - 0.55, E.z - 0.05, 'side console');
  }
  part(group, new THREE.PlaneGeometry(2 * halfIn + 0.06, zBackWall - (ctrBot.z - 0.3)), M.floor, cx, yFloor, (zBackWall + ctrBot.z - 0.3) / 2, 'floor').rotation.x = -Math.PI / 2;
  part(group, new THREE.PlaneGeometry(2 * halfIn + 0.06, rearTop.y - yFloor), M.trim, cx, (rearTop.y + yFloor) / 2, zBackWall, 'rear wall').rotation.y = Math.PI;
  // A door in the rear wall, to the crew's bunk.
  part(group, roundedBox(0.5, 0.95, 0.03, 0.02), M.panel, cx, yFloor + 0.5, zBackWall - 0.02, 'crew door');

  /* ---- Glareshield along the windscreen's sill, and the panel under it ---- */
  const yG = Math.max(cornerBotL.y, ctrBot.y) - 0.015;
  const glareA = [mirror(cornerBotL), ctrBot, cornerBotL].map((v) => new THREE.Vector3(v.x, yG, v.z + 0.01));
  const zPanel = Math.max(ctrBot.z, cornerBotL.z) + 0.34;
  const glareB = glareA.map((v) => new THREE.Vector3(v.x, yG, zPanel));
  part(group, loft(glareA.reverse(), glareB.reverse(), false), M.glare, 0, 0, 0, 'glareshield');
  const lip = part(group, new THREE.CylinderGeometry(0.03, 0.03, 2 * halfIn, 14), M.glare, cx, yG - 0.025, zPanel + 0.005, 'glareshield lip');
  lip.rotation.z = Math.PI / 2;
  const tilt = -0.18;
  const pTop = yG - 0.035;
  const pBot = E.y - 0.72;
  const pH = (pTop - pBot) / Math.cos(tilt);
  const pW = 2 * halfIn;
  const panel = new GaugePanel({ width: pW, height: pH, colour: C.palette.panel, highContrast: ctx.highContrast });
  panel.group.position.set(cx, (pTop + pBot) / 2, zPanel + 0.03);
  panel.group.rotation.x = tilt;
  group.add(panel.group);
  const bus = new DisplayBus({ hz: 10, maxPerFrame: 2 });
  const displays = [];
  const mount = (name, u, v, w, h, paint, opts = {}) => {
    const d = new Display({ name, w: 512, h: Math.round((512 * h) / w), widthM: w, heightM: h, paint, hz: opts.hz || 0 });
    d.mesh.position.set(u, v, 0.0125); // the glass, in front of the bezel's dark back (bezel at 0.012)
    panel.group.add(d.mesh);
    const bz = bezel(M, w, h, { bw: 0.018, n: 5 });
    bz.position.set(u, v, 0.012);
    panel.group.add(bz);
    bus.add(d);
    displays.push(d);
  };
  // Each seat: an attitude screen in front, a map beside it; engines between.
  const pilotU = E.x - cx;
  const s = 0.17;
  const vS = pH / 2 - s / 2 - 0.05;
  for (const side of [-1, 1]) {
    const u = side * Math.abs(pilotU);
    mount(side < 0 ? 'pilot PFD' : 'copilot PFD', u, vS, s, s, (g, w, h, d) => paintPFD(g, w, h, d, { vs: 120, vmo: 480 }));
    mount(side < 0 ? 'pilot map' : 'copilot map', u - side * 0.2, vS, s * 0.9, s * 0.9, (g, w, h, d) => paintND(g, w, h, d, { rangeNm: 20 }), { hz: 6 });
    // Outboard of each pilot: the systems page (fuel and brakes), if the
    // panel reaches that far.
    const uo = u + side * 0.2;
    if (Math.abs(uo) + s * 0.45 < pW / 2 - 0.02) mount(side < 0 ? 'pilot systems' : 'copilot systems', uo, vS, s * 0.9, s * 0.9, (g, w, h, d) => paintJetSystems(g, w, h, d, { title: 'FUEL' }), { hz: 6 });
  }
  mount('engines', 0, vS - s / 2 - 0.02 - 0.06, 0.14, 0.12, (g, w, h, d) => paintEICAS(g, w, h, d), { hz: 6 });
  const warn = warningLamps(panel.group, {
    size: [0.05, 0.02],
    masterSize: [0.07, 0.026],
    place: (m, i) => m.position.set(-0.11 + (i % 4) * 0.073, -pH / 2 + 0.06 + Math.floor(i / 4) * 0.026, 0.004),
    placeMaster: (m) => m.position.set(0, pH / 2 - 0.03, 0.004),
  });
  panel.lamp({ u: 0.12, v: pH / 2 - 0.03, w: 0.03, h: 0.014, text: 'A/P', colour: 0x3ec96a, on: (ss, ac, env) => env.autopilot, size: 0.7 });
  panel.finish();

  /* ---- Seats, sticks, the throttle quadrant between them ---- */
  const sticks = [];
  for (const side of [-1, 1]) {
    const x = cx + side * Math.abs(E.x - cx);
    const seat = ejectionSeat(M, { width: 0.48 });
    seat.position.set(x, E.y - 0.86, E.z - 0.32);
    group.add(seat);
    const st = centreStick(M);
    st.position.set(x, yFloor + 0.32, E.z - 0.43);
    st.userData.dynamic = true;
    group.add(st);
    sticks.push(st);
  }
  part(group, roundedBox(0.24, E.y - 0.5 - yFloor, 0.7, 0.03), M.panel, cx, (E.y - 0.5 + yFloor) / 2, E.z - 0.15, 'centre console');
  const levers = [];
  for (let i = 0; i < 4; i++) {
    const lv = thrustLever(M, { colour: 0x1d2024 });
    lv.position.set(cx - 0.075 + i * 0.05, E.y - 0.5, E.z - 0.2);
    lv.userData.dynamic = true;
    group.add(lv);
    levers.push(lv);
  }

  /* ---- The pack's glass, seen from inside ---- */
  if (model) {
    const lo = space.toModel(new THREE.Vector3(cx - halfIn - 0.2, yFloor, ctrBot.z - 0.4));
    const hi = space.toModel(new THREE.Vector3(cx + halfIn + 0.2, ctrTop.y + 0.2, zBackWall + 0.2));
    const inside = (p) => p.x > lo.x && p.x < hi.x && p.y > lo.y && p.y < hi.y && p.z > lo.z && p.z < hi.z;
    model.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.some((m) => m && m.transparent && m.opacity < 0.9 && /glaz|glass/i.test(m.name || ''))) {
        o.castShadow = false;
        seeThrough(o, model, inside);
      }
    });
    const cut = carveExterior(model, new THREE.Box3(lo, hi));
    group.userData.carved = cut.carved;
    group.userData.viewing = insideOnly(cut.hidden);
  }
  mergeStatic(group, (o) => o === panel.face);

  const env = {};
  let t = 0;
  let lastAc = null;
  let lastSim = null;
  const read = (out) => readFlight(lastAc, lastSim, out, 4);
  let painted = false;
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
    for (const d of displays) d.material.emissiveIntensity = env.blackout ? 0 : 0.95 - env.panelLight * 0.35;
    const c = ac.controls || {};
    for (const st of sticks) {
      st.rotation.x = ease(st.rotation.x, -(c.pitch || 0) * 0.28, 12, dt);
      st.rotation.z = ease(st.rotation.z, -(c.roll || 0) * 0.28, 12, dt);
    }
    const thr = clamp(c.throttle || 0, 0, 1);
    for (const lv of levers) lv.rotation.x = ease(lv.rotation.x, 0.45 - thr * 0.9, 8, dt);
  };
  group.userData.panel = panel;
  group.userData.panelFace = panel.face;
  group.userData.warnings = warn.lamps;
  group.userData.displays = displays;
  group.userData.bus = bus;
  group.userData.family = 'jet';
  group.userData.builder = `jet:${id}`;
  group.userData.eye = E.clone();
  group.userData.controls = { sticks, levers };
  return group;
}
