/**
 * COCKPIT DRESS: what the rooms in aircraft/cockpit/ are finished with, the
 * first time the player sits in one. The owner: "cockpits are better, but
 * could be even better".
 *
 * The builders are in the first-load bundle, which has no room, and a room
 * that is never sat in should cost nothing; so this comes with the features,
 * after the menu, and only ever touches the cockpit in the view. What it adds:
 *
 *   fill      a little bounced daylight on everything inside: from a shaded
 *             seat the walls and the pillars were black (emissive only: no new
 *             shader, one number a change of light)
 *   panel     the empty sheet round the screens is the plates a real panel
 *             has there, painted into the panel's own canvas: lighting and
 *             display knobs, standby dials, a chronometer whose hand runs,
 *             brake pressure and flaps that read the aeroplane
 *   overhead  and the pedestal: printed in place of the random switch grid,
 *             per maker, the thrust scale and flap gate where the levers run
 *   walls     padded sidewalls and door cards, a surface fitted to the room
 *
 * Cost: no new canvas on Low that the room did not already have, its size
 * unchanged; 2 draws on Low, 3 elsewhere (tests/features/cockpit-dress.browser.js).
 * A dial here is a batched needle (gauges.js), not a repaint. No real names:
 * a plate says what a thing is, not who made it.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { clamp, lerp } from '../core/noise.js';
import { roundGauge } from '../aircraft/cockpit/paint.js';
import { styleOf, plate, txt, knob, pushButton, paintOverhead, paintPedestal, paintSidewall, paintDoorCard } from './cockpit-dress/art.js';

export const DRESS = Object.freeze({
  /** Bounce, as a share of each surface's own colour, in full daylight; at night the panel lights do the work. */
  fill: 0.085,
  fillNight: 0.04,
  fillSunset: 0.065,
});

const COCKPIT_FIRST = -100;
const shade = (hex, k) => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`;

/** Finish every opaque surface of the room with `fill`. Returns the materials and how bright each is at 1. */
export function collectFill(cp) {
  const out = new Map();
  cp.traverse((o) => {
    if (!o.isMesh || o.userData.display) return;
    const m = o.material;
    if (!m || Array.isArray(m) || !m.isMeshStandardMaterial || m.transparent) return;
    if (m.emissiveMap && m.userData.printed) out.set(m, 1);
    if (m.emissive.r + m.emissive.g + m.emissive.b > 0.001 || out.has(m)) return;
    const c = m.color;
    m.emissive.setRGB(Math.min(c.r, 0.75), Math.min(c.g, 0.75), Math.min(c.b, 0.75));
    if (m.vertexColors) m.emissive.setRGB(0.42, 0.42, 0.42);
    m.emissiveIntensity = 0;
    out.set(m, 1);
  });
  return [...out.keys()];
}

export function fillLevel(weather) {
  const time = weather && weather.time;
  const cloud = weather && weather.cond ? weather.cond.cloud || 0 : 0;
  const k = time === 'night' ? DRESS.fillNight : time === 'sunset' ? DRESS.fillSunset : DRESS.fill;
  return time === 'night' ? k : k * (1 - clamp(cloud - 0.5, 0, 0.5) * 0.7);
}

/** A sheet following the room's curve: `at(u, v, out)` for u, v in 0..1. One mesh, its uv the sheet. */
function surface(mat, at, nu = 10, nv = 4, list = [0]) {
  const pos = [];
  const uv = [];
  const idx = [];
  const P = new THREE.Vector3();
  let base = 0;
  for (const side of list) {
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        at(i / nu, j / nv, P, side);
        pos.push(P.x, P.y, P.z);
        uv.push(i / nu, j / nv);
      }
    }
    const row = nu + 1;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = base + j * row + i;
        idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
      }
    }
    base += (nu + 1) * (nv + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = COCKPIT_FIRST;
  m.receiveShadow = true;
  return m;
}

function canvasMaterial(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.82, metalness: 0.02, side: THREE.DoubleSide, emissive: 0x9a9a9a, emissiveMap: t, emissiveIntensity: 0 });
  m.userData.printed = true;
  m.addEventListener('dispose', () => t.dispose());
  return m;
}

/** Print over a material's own canvas. A new size on a canvas texture means a new one on the card. */
function reprint(mat, w, h, paint) {
  const t = mat && mat.map;
  if (!t || !t.image || !t.image.getContext) return false;
  const c = t.image;
  if (c.width !== w || c.height !== h) {
    t.dispose();
    c.width = w;
    c.height = h;
  }
  paint(c.getContext('2d'), w, h);
  t.needsUpdate = true;
  return true;
}

/** A dial on a finished panel: a batched needle, no hub of its own (the face is painted once). */
function dial(panel, { u, v, R, value, rate = 5, ...spec }) {
  const a = roundGauge(panel.ctx, panel.px(u), panel.py(v), panel.pr(R), spec);
  const n = panel._needle(u, v, R * 0.82, R * 0.05);
  let cur = spec.min || 0;
  panel.live.push((s, dt, ac, env) => {
    cur = lerp(cur, clamp(value(s, ac, env, dt), spec.min || 0, spec.max ?? 1), clamp(dt * rate, 0, 1));
    n.rotation.z = -a(cur);
  });
}

/** The panel clock: the sim's own local time (hud-readouts.js), hours, minutes and a stepping seconds hand. */
function chrono(panel, u, v, R, title = 'CHR') {
  const a = roundGauge(panel.ctx, panel.px(u), panel.py(v), panel.pr(R), {
    min: 0, max: 60, start: 0, sweep: 360, step: 5, major: 15, labels: [[15, '15'], [30, '30'], [45, '45']], labelSize: 16, title,
  });
  const h = panel._needle(u, v, R * 0.5, R * 0.07);
  const m = panel._needle(u, v, R * 0.74, R * 0.055);
  const n = panel._needle(u, v, R * 0.84, R * 0.03);
  panel.live.push(() => {
    const t = (D.sim && D.sim.clockSeconds) || 0;
    n.rotation.z = -a(t % 60);
    m.rotation.z = -a((t / 60) % 60);
    h.rotation.z = -a(((t / 3600) % 12) * 5);
  });
}

const FLAPS = { min: 0, max: 1, start: -120, sweep: 240, step: 0.25, major: 0.5, labels: [[0, 'UP'], [1, 'DN']], labelSize: 16, title: 'FLAP' };
const BRAKE = { min: 0, max: 4, start: -130, sweep: 260, step: 1, major: 2, arcs: [[0, 3, '#3ec96a']], labels: [[0, '0'], [2, '2'], [4, '4']], labelSize: 16, title: 'BRK', sub: 'PSI x1000' };

/** An airliner's panel: plates over the bare sheet, round the screens. */
function deckPanel(L, knobs) {
  const { panel, C, du, dv, vt, pilotU, uMax } = L;
  const S = styleOf(C.maker);
  const half = du * 1.05 + 0.036;
  const pu = Math.abs(pilotU);
  const vTop = dv - du / 2 - 0.04;
  const vBot = -vt + 0.012;
  panel.paint((g, P) => {
    const unit = P.pr(0.0026);
    const bay = (u0, v1, u1, v0) => plate(g, P.px(u0), P.py(v1), P.pr(u1 - u0), P.pr(v1 - v0), S, unit);
    for (const s of [-1, 1]) {
      const sideName = s < 0 ? 'CAPT' : 'F/O';
      // Under the screens, each pilot's.
      const a = s * pu - half;
      const b = s * pu + half;
      if (vTop - vBot > 0.05) {
        bay(a, vTop, b, vBot);
        const y = (vTop + vBot) / 2;
        txt(g, 'BRIGHTNESS', P.px(s * pu), P.py(vTop - 0.012), P.pr(0.0085), S.dim);
        for (const [i, t] of ['PFD', 'ND', 'WX', 'FLOOD'].entries()) {
          const x = s * pu + (i - 1.5) * 0.058;
          knobs.push([x, y + 0.002]);
          txt(g, t, P.px(x), P.py(y - 0.026), P.pr(0.0085), S.ink);
        }
      }
      // Outboard, to the wall.
      const o0 = pu + half + 0.01;
      const o1 = uMax - 0.012;
      if (o1 - o0 > 0.05) {
        const x0 = s < 0 ? -o1 : o0;
        const x1 = s < 0 ? -o0 : o1;
        bay(x0, vt - 0.03, x1, vBot);
        const cx = (x0 + x1) / 2;
        txt(g, sideName, P.px(cx), P.py(vt - 0.05), P.pr(0.0095), S.ink);
        // As many columns of audio knobs as the sheet has room for, then a row of switch lights.
        const n = Math.max(1, Math.min(3, Math.floor((o1 - o0) / 0.075)));
        for (let c = 0; c < n; c++) {
          const kx = cx + (c - (n - 1) / 2) * 0.075;
          for (const [i, t] of [['VHF', 'HF', 'INT'][c], ['LOUD', 'MIC', 'ID'][c]].entries()) {
            const y = vt - 0.105 - i * 0.075;
            knobs.push([kx, y]);
            txt(g, t, P.px(kx), P.py(y - 0.027), P.pr(0.0085), S.dim);
          }
        }
        const rows = Math.floor((vt - 0.26 - vBot) / 0.052);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < n; c++) {
            const lab = [['ON', 'SPLR'], ['ON', 'BLOW'], ['AUTO', 'MODE'], ['ON', 'DOME'], ['ON', 'NAV'], ['DIM', 'ANN'], ['ON', 'WIPER'], ['ON', 'RAIN'], ['ON', 'BRT']][(r * 3 + c) % 9];
            pushButton(g, P.px(cx + (c - n / 2) * 0.062 + 0.004), P.py(vt - 0.26 - r * 0.052), P.pr(0.054), P.pr(0.04), lab[0], lab[1], S);
          }
        }
      }
    }
    // Under the engine page.
    const cw = du / 2 + 0.03;
    if (vTop - vBot > 0.05) {
      bay(-cw, vTop, cw, vBot);
      const y = vTop - (vTop - vBot) * 0.42;
      for (const [i, t] of [['LO', 'BRK'], ['MED', 'BRK'], ['MAX', 'BRK'], ['ON', 'TERR']].entries()) {
        const w = Math.min(0.044, (2 * cw - 0.03) / 4 - 0.008);
        const x = -cw + 0.016 + i * ((2 * cw - 0.032) / 4) + 0.004;
        pushButton(g, P.px(x), P.py(y + 0.02), P.pr(w), P.pr(0.036), t[0], t[1], S, false);
      }
    }
  });
  // Live: standby speed and height under the captain's map, brake pressure and flaps under the first officer's.
  const R = Math.min(0.036, (vTop - vBot) * 0.42);
  if (vTop - vBot > 0.07) {
    const y = (vTop + vBot) / 2;
    const off = du * 1.05 + 0.02;
    for (const s of [-1, 1]) chrono(panel, s * (pu + off), y, R);
    const inner = -pu + du * 0.72;
    dial(panel, { u: pu - du * 0.72, v: y, R, value: (s, ac) => (ac.controls ? ac.controls.brakes || 0 : 0) * 3 + (ac.parkingBrake ? 3 : 0.4), ...BRAKE });
    dial(panel, { u: inner, v: y, R, value: (s, ac) => clamp(ac.flaps || 0, 0, 1), ...FLAPS });
  }
}

function dressAirliner(cp, low) {
  const L = cp.userData.layout;
  if (!L) return 0;
  const { C, E, cx, zPanel, zBack, wallX } = L;
  const knobs = [];
  deckPanel(L, knobs);
  L.panel.texture.needsUpdate = true;
  // At night the plates are dark and their lettering is read by the screens' light, not a light box.
  L.panel.faceGlow = 0.16;
  const S = styleOf(C.maker);
  const scale = low ? 1 : 2;
  const ud = cp.userData;
  if (ud.printed) {
    const airbus = C.maker === 'airbus';
    reprint(ud.printed.a, 512 * scale, 384 * scale, (g, w, h) => paintOverhead(g, w, h, S, 3, 0));
    reprint(ud.printed.b, 512 * scale, 512 * scale, (g, w, h) => paintOverhead(g, w, h, S, 4, 5));
    reprint(ud.printed.top, 256 * scale, 512 * scale, (g, w, h) => paintPedestal(g, w, h, S, { airbus, engines: C.engines, turboprop: C.levers === 'turboprop' }));
  }
  let draws = 0;
  // The padded walls, both sides, one draw.
  const wallMat = canvasMaterial(512, 192, (g, w, h) => paintSidewall(g, w, h, C.wall.wall, C.wall.low));
  const z0 = zPanel + 0.14;
  const z1 = Math.min(E.z + 0.55, zBack - 0.1);
  const wall = surface(wallMat, (u, v, P, side) => {
    const y = E.y - 0.3 - v * 0.34;
    const z = lerp(z0, z1, u);
    P.set(cx + side * (wallX(z, y) - 0.03), y, z);
  }, 12, 3, [-1, 1]);
  wall.name = 'padded sidewall';
  cp.add(wall);
  draws++;
  if (!low && knobs.length) {
    const g = new THREE.CylinderGeometry(0.0115, 0.0135, 0.016, 10);
    g.rotateX(Math.PI / 2);
    const m = new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: 0.42, metalness: 0.5 });
    const inst = new THREE.InstancedMesh(g, m, knobs.length);
    const mx = new THREE.Matrix4();
    knobs.forEach(([u, v], i) => inst.setMatrixAt(i, mx.makeTranslation(u, v, 0.008)));
    inst.name = 'panel knobs';
    inst.frustumCulled = false;
    inst.renderOrder = COCKPIT_FIRST;
    L.panel.group.add(inst);
    draws++;
  }
  return draws;
}

function dressLight(cp) {
  const L = cp.userData.layout;
  if (!L) return 0;
  const { panel, C, E, cx, halfW, panelZ, zDoor, row1, row2, R, floorY } = L;
  const S = styleOf('light');
  const engR = Math.max(...[row1, row2].map(() => R));
  // Right of the engine dials: the chronometer, the ammeter, the placards, the glove box.
  const u0 = 0.135 + 0.075 + 0.105 + R + 0.03 + (cx - cx);
  const uMax = panel.width / 2 - 0.02;
  const bottom = -panel.height / 2 + 0.02;
  if (uMax - u0 > 0.07) {
    panel.paint((g, P) => {
      const unit = P.pr(0.0026);
      plate(g, P.px(u0), P.py(row2 - 0.07), P.pr(uMax - u0), P.pr(row2 - 0.07 - bottom), S, unit);
      txt(g, 'GLOVE BOX', P.px((u0 + uMax) / 2), P.py(row2 - 0.1), P.pr(0.0095), S.ink);
      g.fillStyle = '#16181b';
      g.fillRect(P.px((u0 + uMax) / 2 - 0.018), P.py(row2 - 0.125), P.pr(0.036), P.pr(0.01));
      txt(g, 'NO SMOKING  FASTEN BELT', P.px((u0 + uMax) / 2), P.py(bottom + 0.02), P.pr(0.0075), S.dim);
    });
    const r = Math.min(engR * 0.8, (uMax - u0) / 2.4);
    chrono(panel, u0 + r + 0.012, row1, r, 'CLOCK');
    dial(panel, { u: u0 + r + 0.012, v: row2, R: r, min: -60, max: 60, start: -120, sweep: 240, step: 10, major: 30, labels: [[-60, '-'], [0, '0'], [60, '+']], labelSize: 16, title: 'AMPS', value: (s, ac) => (ac.engineOn ? 4 + (ac.rpm || 0) * 8 : -12) });
    panel.texture.needsUpdate = true;
  }
  const mat = canvasMaterial(512, 256, (g, w, h) => paintDoorCard(g, w, h, shade(C.trim.wall, 0.62), C.trim.low));
  const z0 = panelZ + 0.1;
  const z1 = Math.min(E.z + 0.5, zDoor - 0.1);
  const door = surface(mat, (u, v, P, side) => {
    const y = lerp(Math.max(floorY + 0.26, E.y - 0.72), E.y - 0.3, v);
    const z = lerp(z0, z1, u);
    P.set(cx + side * (halfW(z, y) - 0.012), y, z);
  }, 10, 4, [-1, 1]);
  door.name = 'door card';
  cp.add(door);
  return 1;
}

function dressHeli(cp, low) {
  const ud = cp.userData;
  const L = ud.layout;
  if (!L) return 0;
  const scale = low ? 1 : 2;
  if (ud.printed && ud.printed.top) reprint(ud.printed.top, 256 * scale, 384 * scale, (g, w, h) => paintOverhead(g, w, h, { ...styleOf('light'), square: false }, 4, 8));
  if (L.tandem) return 0;
  const { E, cx, halfW, panelZ, yFloor, trim } = L;
  const mat = canvasMaterial(512, 256, (g, w, h) => paintDoorCard(g, w, h, trim.low, trim.floor));
  const door = surface(mat, (u, v, P, side) => {
    const y = lerp(yFloor + 0.32, E.y - 0.26, v);
    const z = lerp(panelZ + 0.42, E.z + 0.42, u);
    P.set(cx + side * (halfW(z, y) - 0.06), y, z);
  }, 10, 4, [-1, 1]);
  door.name = 'door card';
  cp.add(door);
  return 1;
}

/**
 * Every panel, the same plate: a lit top edge under the coaming and a shadowed
 * foot, so it reads as a thing with thickness and not a dark sheet. Into the
 * canvas it already has: no draw, no program, one upload, once.
 */
function plateEdge(panel) {
  if (!panel || !panel.paint || !panel.canvas || !panel.ctx) return;
  panel.paint((g) => {
    const { width: W, height: H } = panel.canvas;
    const e = Math.max(3, Math.round(H * 0.012));
    const hi = g.createLinearGradient(0, 0, 0, e * 3);
    hi.addColorStop(0, 'rgba(0,0,0,0.5)');
    hi.addColorStop(0.45, 'rgba(255,255,255,0.1)');
    hi.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hi;
    g.fillRect(0, 0, W, e * 3);
    g.fillStyle = 'rgba(0,0,0,0.42)';
    g.fillRect(0, H - e, W, e);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(0, H - e * 1.5, W, e * 0.5);
  });
  if (panel.texture) panel.texture.needsUpdate = true;
}

export function dress(cp, sim) {
  const low = (sim.qualityBuilt || sim.settings.quality) === 'low';
  const fam = cp.userData.family;
  let draws = 0;
  plateEdge(cp.userData.panel);
  if (fam === 'airliner') draws = dressAirliner(cp, low);
  else if (fam === 'light') draws = dressLight(cp, low);
  else if (fam === 'heli') draws = dressHeli(cp, low);
  return { draws, fill: fam === 'none' ? [] : collectFill(cp), level: -1 };
}

const D = { cp: null, now: null, sim: null };

registerExtension({
  id: 'cockpit-dress',
  update(sim) {
    const cp = sim.cockpit;
    if (!cp || !sim.rig || sim.rig.mode !== 'cockpit' || sim.state !== 'flying') return;
    D.sim = sim;
    if (cp !== D.cp) {
      D.cp = cp;
      D.now = null;
      if (cp.userData.family && cp.userData.layout !== false) {
        D.now = dress(cp, sim);
        cp.userData.dress = D.now;
      }
    }
    if (!D.now) return;
    const k = fillLevel(sim.weather);
    if (Math.abs(k - D.now.level) > 0.004) {
      D.now.level = k;
      for (const m of D.now.fill) m.emissiveIntensity = k;
    }
  },
});

export const __dress = { D };
