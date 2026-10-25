/**
 * Parts and finishes for the jet, airliner and helicopter cockpits.
 *
 * The light family (light.js) builds its own room from the fuselage's hull;
 * the cockpits added after it share this kit:
 *
 *   materials    one set per cockpit, PBR: matte anti-glare paint, a satin
 *                panel, bare and painted metal, rubber and leather, and the
 *                glass — so the sun lights them like everything else in the
 *                world and their shadows fall inside the cockpit
 *   geometry     rounded boxes, tubes along a path, lofted strips
 *   furniture    a bezel round a screen with its push-buttons, an ejection
 *                seat, a centre stick, a side-stick, throttle grips, airliner
 *                seats, thrust levers, a painted switch panel
 *   mergeStatic  everything that never moves, merged per material at the
 *                end, so a cockpit of a few hundred parts is a few dozen draws
 *   seeThrough   the exterior's own glass and seats, hidden from a camera
 *                inside the canopy only (the canopy's tint would otherwise
 *                darken the whole sky, and its dummy seat sit in yours)
 */

import * as THREE from '../../vendor/three.module.js';
import { panelTexture, panelNormal, leatherTexture } from '../../render/textures.js';
import { mergeGeometries } from '../models/airliner-parts.js';

/* ------------------------------------------------------------------ *
 * Materials
 * ------------------------------------------------------------------ */

/**
 * The cockpit's finishes, from a palette:
 *   panel   the instrument panel and consoles (satin, pebbled)
 *   glare   the glareshield and coaming (matte, almost black)
 *   trim    walls / tub (matte)
 *   frame   canopy / window frames (painted metal)
 *   seat    seat fabric or leather
 */
export function cockpitMaterials(p = {}) {
  const pal = {
    panel: '#2c3036',
    glare: '#111316',
    trim: '#3a3f46',
    frame: '#2a2e33',
    seat: '#2b2d31',
    floor: '#1d1f22',
    ...p,
  };
  const panelMap = panelTexture();
  const panelN = panelNormal();
  // The room's surfaces are drawn from both sides: a wall lofted between two
  // lines faces whichever way its winding says, and a wall that faces away
  // from the eye is a hole in the cockpit (the Node checks find them).
  const DS = THREE.DoubleSide;
  const m = {
    panel: new THREE.MeshStandardMaterial({ map: panelMap, normalMap: panelN, normalScale: new THREE.Vector2(0.35, 0.35), color: new THREE.Color(pal.panel).multiplyScalar(2.6), roughness: 0.72, metalness: 0.08, side: DS }),
    glare: new THREE.MeshStandardMaterial({ map: leatherTexture('#2a2a2a'), color: new THREE.Color(pal.glare).multiplyScalar(3), roughness: 0.96, metalness: 0, side: DS }),
    trim: new THREE.MeshStandardMaterial({ map: panelMap, color: new THREE.Color(pal.trim).multiplyScalar(2.4), roughness: 0.86, metalness: 0.04, side: DS }),
    frame: new THREE.MeshStandardMaterial({ color: pal.frame, roughness: 0.48, metalness: 0.35, side: DS }),
    floor: new THREE.MeshStandardMaterial({ map: panelMap, color: new THREE.Color(pal.floor).multiplyScalar(2.2), roughness: 0.95, side: DS }),
    seat: new THREE.MeshStandardMaterial({ map: leatherTexture(pal.seat), roughness: 0.9, metalness: 0 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9aa1aa, roughness: 0.3, metalness: 0.85 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x24282d, roughness: 0.42, metalness: 0.55 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.93, metalness: 0 }),
    bezel: new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.5, metalness: 0.25 }),
    button: new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.55, metalness: 0.2, emissive: 0xffffff, emissiveIntensity: 0, emissiveMap: null }),
    yellowBlack: new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.6 }),
    white: new THREE.MeshStandardMaterial({ color: 0xe6e8eb, roughness: 0.5 }),
    red: new THREE.MeshStandardMaterial({ color: 0xb3241c, roughness: 0.5 }),
    // The cockpit's own glass: a breath of tint and the sun's glint, from
    // inside. Not the exterior's, which is much darker (see seeThrough).
    glass: new THREE.MeshStandardMaterial({ color: 0xa8c4d6, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.2 }),
  };
  return { ...m, palette: pal };
}

let _stripes = null;
/** Yellow and black, for the ejection handle. */
function stripeTexture() {
  if (_stripes) return _stripes;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#f2c21b';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#121212';
  for (let i = -64; i < 128; i += 16) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 8, 0);
    g.lineTo(i + 8 + 64, 64);
    g.lineTo(i + 64, 64);
    g.closePath();
    g.fill();
  }
  _stripes = new THREE.CanvasTexture(c);
  _stripes.colorSpace = THREE.SRGBColorSpace;
  _stripes.wrapS = _stripes.wrapT = THREE.RepeatWrapping;
  _stripes.userData.shared = true;
  return _stripes;
}

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

/**
 * A box with rounded vertical edges (and a small bevel top and bottom),
 * exactly w x h x d outside: the bevel grows the extruded outline by its
 * size, so the outline is drawn that much smaller.
 */
export function roundedBox(w, h, d, r = 0.01, seg = 3) {
  const bevPre = Math.min(Math.min(r, w / 2, d / 2) * 0.6, h * 0.25);
  const bs = bevPre * 0.8;
  w = Math.max(1e-3, w - 2 * bs);
  d = Math.max(1e-3, d - 2 * bs);
  r = Math.max(1e-4, Math.min(r, w / 2 - 1e-4, d / 2 - 1e-4));
  const s = new THREE.Shape();
  const x = w / 2 - r;
  const z = d / 2 - r;
  s.moveTo(-x, -d / 2);
  s.lineTo(x, -d / 2);
  s.absarc(x, -z, r, -Math.PI / 2, 0, false);
  s.lineTo(w / 2, z);
  s.absarc(x, z, r, 0, Math.PI / 2, false);
  s.lineTo(-x, d / 2);
  s.absarc(-x, z, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-w / 2, -z);
  s.absarc(-x, -z, r, Math.PI, Math.PI * 1.5, false);
  const bev = bevPre;
  const g = new THREE.ExtrudeGeometry(s, { depth: h - 2 * bev, bevelEnabled: bev > 1e-4, bevelThickness: bev, bevelSize: bs, bevelSegments: 2, curveSegments: seg });
  // Extruded along +z; stand it up so the extrusion is the height.
  g.rotateX(-Math.PI / 2);
  g.translate(0, -(h - 2 * bev) / 2, 0);
  g.computeVertexNormals();
  return g;
}

/** A tube along points (CatmullRom), radius r. */
export function tubeAlong(points, r, segs = 24, radial = 8, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
  return new THREE.TubeGeometry(curve, segs, r, radial, closed);
}

/**
 * A strip lofted between two polylines of equal length (a and b, Vector3
 * arrays): quads a[i] a[i+1] b[i+1] b[i]. Normals from the geometry; `flip`
 * to face the other way. Used for coamings, sills and walls that follow a
 * canopy's cross-section.
 */
export function loft(a, b, flip = false) {
  const pos = [];
  const uv = [];
  const idx = [];
  const n = a.length;
  for (let i = 0; i < n; i++) {
    pos.push(a[i].x, a[i].y, a[i].z, b[i].x, b[i].y, b[i].z);
    uv.push(i / (n - 1), 0, i / (n - 1), 1);
  }
  for (let i = 0; i < n - 1; i++) {
    const p = i * 2;
    if (flip) idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3);
    else idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A flat polygon (Vector3s, roughly planar, convex), fan-triangulated. */
export function polygon(points, flip = false) {
  const pos = [];
  const idx = [];
  for (const p of points) pos.push(p.x, p.y, p.z);
  for (let i = 1; i < points.length - 1; i++) {
    if (flip) idx.push(0, i + 1, i);
    else idx.push(0, i, i + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(points.length * 2), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A mesh, placed, shadowed, added. */
export function part(parent, geo, mat, x = 0, y = 0, z = 0, name = '') {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  if (name) m.name = name;
  parent.add(m);
  return m;
}

/* ------------------------------------------------------------------ *
 * Furniture
 * ------------------------------------------------------------------ */

/**
 * A screen's bezel: a frame `bw` wide round a `w` x `h` glass, `n` buttons
 * on each side (none on the sides when `sideButtons` is false). The group's
 * origin is the glass centre; the glass faces +z.
 */
export function bezel(M, w, h, { bw = 0.022, depth = 0.018, n = 5, sideButtons = true, topButtons = true } = {}) {
  const g = new THREE.Group();
  g.name = 'bezel';
  const W = w + 2 * bw;
  const H = h + 2 * bw;
  const frame = [
    [W, bw, 0, (h + bw) / 2],
    [W, bw, 0, -(h + bw) / 2],
    [bw, h, -(w + bw) / 2, 0],
    [bw, h, (w + bw) / 2, 0],
  ];
  for (const [fw, fh, x, y] of frame) {
    const b = part(g, new THREE.BoxGeometry(fw, fh, depth), M.bezel, x, y, -depth / 2 + 0.004);
    b.name = 'bezel frame';
  }
  // A dark back so the glass sits in a box, not on the panel paint.
  part(g, new THREE.PlaneGeometry(w, h), M.rubber, 0, 0, -0.004);
  const btn = new THREE.BoxGeometry(Math.min(0.016, w / (n * 1.8)), 0.009, 0.006);
  const btnV = new THREE.BoxGeometry(0.009, Math.min(0.016, h / (n * 1.8)), 0.006);
  for (let i = 0; i < n; i++) {
    const f = (i + 1) / (n + 1) - 0.5;
    if (topButtons) {
      part(g, btn, M.button, f * w, h / 2 + bw * 0.5, 0.006);
      part(g, btn, M.button, f * w, -h / 2 - bw * 0.5, 0.006);
    }
    if (sideButtons) {
      part(g, btnV, M.button, -w / 2 - bw * 0.5, f * h, 0.006);
      part(g, btnV, M.button, w / 2 + bw * 0.5, f * h, 0.006);
    }
  }
  return g;
}

/**
 * An ejection seat, seen from the pilot's own eye: the bucket's sides and
 * the rails rising behind the shoulders, the seat pan, the yellow-and-black
 * firing handle between the knees. No headbox right behind the eye — the
 * camera IS the pilot's head, and a headbox there filled the look-behind
 * view; the rails either side of it are what a pilot sees over a shoulder.
 * Origin: the seat pan's front-centre, +z back.
 */
export function ejectionSeat(M, { width = 0.46, railTop = 0.62 } = {}) {
  const g = new THREE.Group();
  g.name = 'ejection seat';
  part(g, roundedBox(width - 0.06, 0.09, 0.42, 0.03), M.seat, 0, 0.045, 0.21, 'seat cushion');
  part(g, roundedBox(width, 0.14, 0.46, 0.02), M.darkMetal, 0, -0.07, 0.23, 'seat bucket');
  for (const s of [-1, 1]) {
    // Bucket side, the edge you see beside your thigh.
    part(g, roundedBox(0.035, 0.26, 0.44, 0.012), M.darkMetal, s * (width / 2), 0.1, 0.22, 'seat side');
    // A rail up behind the shoulder.
    const rail = part(g, roundedBox(0.05, railTop, 0.07, 0.015), M.darkMetal, s * (width / 2 - 0.02), railTop / 2 + 0.05, 0.5, 'seat rail');
    rail.rotation.x = -0.18;
    // Harness strap over the shoulder.
    part(g, new THREE.BoxGeometry(0.045, 0.006, 0.36), M.rubber, s * 0.11, 0.1, 0.19);
  }
  // Seat back, low (below the shoulders).
  const back = part(g, roundedBox(width - 0.08, 0.45, 0.09, 0.02), M.seat, 0, 0.3, 0.47, 'seat back');
  back.rotation.x = -0.2;
  // The firing handle, on the front of the seat pan between the knees.
  const handle = part(g, tubeAlong([new THREE.Vector3(-0.07, 0.11, -0.02), new THREE.Vector3(-0.05, 0.16, -0.035), new THREE.Vector3(0.05, 0.16, -0.035), new THREE.Vector3(0.07, 0.11, -0.02)], 0.012, 16, 6), M.yellowBlack, 0, 0, 0, 'ejection handle');
  handle.castShadow = false;
  return g;
}

/** A fighter's centre stick: boot, shaft and a grip with its switches. Origin: the pivot. */
export function centreStick(M) {
  const g = new THREE.Group();
  g.name = 'stick';
  part(g, new THREE.CylinderGeometry(0.05, 0.065, 0.06, 12), M.rubber, 0, 0.03, 0, 'stick boot');
  part(g, new THREE.CylinderGeometry(0.014, 0.017, 0.26, 10), M.darkMetal, 0, 0.16, 0);
  const grip = part(g, roundedBox(0.045, 0.13, 0.05, 0.018), M.rubber, 0, 0.33, -0.004, 'stick grip');
  grip.rotation.x = -0.12;
  part(g, new THREE.CylinderGeometry(0.008, 0.008, 0.012, 8), M.metal, 0.0, 0.405, -0.012);
  part(g, new THREE.BoxGeometry(0.012, 0.03, 0.012), M.darkMetal, 0, 0.32, -0.035, 'trigger');
  part(g, new THREE.BoxGeometry(0.012, 0.012, 0.012), M.red, 0.016, 0.39, -0.01, 'pickle');
  return g;
}

/** A side-stick on the right console (F-22, F-35, the Airbus). Origin: the pivot. */
export function sideStick(M, { airbus = false } = {}) {
  const g = new THREE.Group();
  g.name = 'side-stick';
  part(g, new THREE.CylinderGeometry(0.035, 0.045, 0.03, 12), M.rubber, 0, 0.015, 0);
  const grip = part(g, roundedBox(0.04, airbus ? 0.12 : 0.1, 0.045, 0.017), M.rubber, 0, airbus ? 0.09 : 0.08, 0);
  grip.rotation.x = -0.25;
  part(g, new THREE.BoxGeometry(0.01, 0.022, 0.01), airbus ? M.red : M.darkMetal, 0, airbus ? 0.15 : 0.13, -0.02);
  return g;
}

/** A throttle grip on its slide. Origin: the slot's middle. */
export function throttleGrip(M, { twin = false } = {}) {
  const g = new THREE.Group();
  g.name = 'throttle';
  const lever = new THREE.Group();
  lever.name = 'throttle lever';
  part(lever, new THREE.BoxGeometry(twin ? 0.06 : 0.035, 0.07, 0.03), M.darkMetal, 0, 0.035, 0);
  const grip = part(lever, roundedBox(twin ? 0.075 : 0.05, 0.075, 0.07, 0.02), M.rubber, 0, 0.1, -0.01, 'throttle grip');
  grip.rotation.x = 0.2;
  part(lever, new THREE.BoxGeometry(0.01, 0.01, 0.01), M.metal, 0.02, 0.14, -0.02);
  lever.userData.dynamic = true; // slides in the grip's slot
  g.add(lever);
  g.userData.lever = lever;
  return g;
}

/** An airliner seat: sheepskin cushion, tall back with a headrest, armrests. Origin: pan front-centre. */
export function crewSeat(M, { width = 0.52, headrest = true, back: backH = 0.7 } = {}) {
  const g = new THREE.Group();
  g.name = 'crew seat';
  part(g, roundedBox(width, 0.12, 0.5, 0.04), M.seat, 0, 0.06, 0.25, 'cushion');
  // The pilot's own seat is built with a low back and no headrest: the eye
  // is the pilot's head, and a headrest there is a wall at the camera.
  const back = part(g, roundedBox(width, backH, 0.12, 0.04), M.seat, 0, 0.1 + backH / 2, 0.5 + backH * 0.09, 'back');
  back.rotation.x = -0.18;
  if (headrest) {
    const h = part(g, roundedBox(width * 0.6, 0.2, 0.1, 0.04), M.seat, 0, 0.12 + backH + 0.1, 0.6 + backH * 0.15, 'headrest');
    h.rotation.x = -0.18;
  }
  for (const s of [-1, 1]) {
    part(g, roundedBox(0.07, 0.05, 0.36, 0.02), M.trim, s * (width / 2 + 0.04), 0.27, 0.3, 'armrest');
    part(g, new THREE.BoxGeometry(0.03, 0.2, 0.04), M.darkMetal, s * (width / 2 + 0.04), 0.15, 0.42);
  }
  part(g, new THREE.CylinderGeometry(0.05, 0.08, 0.36, 10), M.darkMetal, 0, -0.18, 0.28, 'seat post');
  return g;
}

/** A thrust lever on the pedestal: arm and a T-handle. Origin: its pivot. */
export function thrustLever(M, { colour = 0x2a2e33, knob = 'T' } = {}) {
  const g = new THREE.Group();
  g.name = 'thrust lever';
  part(g, new THREE.BoxGeometry(0.014, 0.17, 0.018), M.metal, 0, 0.085, 0);
  const km = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.5, metalness: 0.15 });
  if (knob === 'T') part(g, roundedBox(0.06, 0.026, 0.03, 0.01), km, 0, 0.17, 0, 'lever knob');
  else part(g, new THREE.CylinderGeometry(0.016, 0.016, 0.04, 12), km, 0, 0.17, 0, 'lever knob').rotation.z = Math.PI / 2;
  return g;
}

/**
 * A panel of switches and annunciators painted once into a canvas: rows of
 * toggle switches, push-buttons with dim legends, guarded switches, small
 * labels. Used for the overhead panel, the consoles and the pedestal's
 * radios. `layout(g, W, H)` may add its own art. Returns the material.
 */
export function switchPanelMaterial({ w = 512, h = 256, colour = '#3b4148', rows = 4, cols = 8, seed = 7, labels = null, layout = null, lit = '#ffd27a' } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = colour;
  g.fillRect(0, 0, w, h);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const cw = w / cols;
  const rh = h / rows;
  const words = labels || ['PUMP', 'HYD', 'BLEED', 'PACK', 'GEN', 'BAT', 'APU', 'XFEED', 'FUEL', 'ANTI ICE', 'WIPER', 'LIGHTS', 'SEAT BELT', 'NO SMOKE', 'PROBE', 'EMER'];
  // Panel divisions.
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.lineWidth = 3;
  for (let j = 1; j < rows; j++) {
    g.beginPath();
    g.moveTo(0, j * rh);
    g.lineTo(w, j * rh);
    g.stroke();
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = i * cw + cw / 2;
      const y = j * rh + rh / 2;
      const kind = rnd();
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.font = `600 ${Math.round(rh * 0.14)}px "Helvetica Neue", Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(words[Math.floor(rnd() * words.length)], x, j * rh + rh * 0.16);
      if (kind < 0.45) {
        // A push-button with a two-part legend.
        g.fillStyle = '#16191d';
        g.fillRect(x - cw * 0.3, y - rh * 0.22, cw * 0.6, rh * 0.5);
        g.fillStyle = rnd() < 0.3 ? lit : 'rgba(255,255,255,0.18)';
        g.fillRect(x - cw * 0.22, y - rh * 0.12, cw * 0.44, rh * 0.1);
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.fillRect(x - cw * 0.22, y + rh * 0.06, cw * 0.44, rh * 0.1);
      } else if (kind < 0.8) {
        // A toggle switch: a round base and a bat handle, light from above.
        g.fillStyle = '#1b1e22';
        g.beginPath();
        g.arc(x, y + rh * 0.05, rh * 0.13, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#c9ced4';
        g.fillRect(x - rh * 0.04, y - rh * 0.2, rh * 0.08, rh * 0.25);
        g.fillStyle = 'rgba(0,0,0,0.4)';
        g.fillRect(x - rh * 0.04, y + rh * 0.02, rh * 0.08, rh * 0.06);
      } else {
        // A rotary knob with a pointer.
        g.fillStyle = '#121417';
        g.beginPath();
        g.arc(x, y + rh * 0.05, rh * 0.17, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#e6e8eb';
        g.lineWidth = 2;
        const a = rnd() * Math.PI * 2;
        g.beginPath();
        g.moveTo(x, y + rh * 0.05);
        g.lineTo(x + Math.cos(a) * rh * 0.15, y + rh * 0.05 + Math.sin(a) * rh * 0.15);
        g.stroke();
      }
    }
  }
  if (layout) layout(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0.05, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.04, side: THREE.DoubleSide });
  mat.addEventListener('dispose', () => tex.dispose());
  return mat;
}

/* ------------------------------------------------------------------ *
 * Merging what never moves
 * ------------------------------------------------------------------ */

/**
 * Merge every static mesh under `root` (not under a node with
 * userData.dynamic, not a display, not transparent) into one mesh per
 * material, in root's own space. Cuts a cockpit of hundreds of parts to a
 * few dozen draw calls; nothing that moves or that a test looks for by name
 * is touched (`keep(mesh)` may veto more).
 *
 * Inside every moving part its own pieces are merged too, in its frame
 * (`{ movers: false }` to skip that), and the same for a part flagged
 * userData.keepApart.
 *
 * Hidden at build time counts as moving: a part that is hidden now is one
 * that is shown later (an OFF flag, a dead screen's black, a lit lamp), and
 * merged it would be shown for ever — or, merged with a shown one, never.
 */
export function mergeStatic(root, keep = () => false, { movers = true } = {}) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map();
  const victims = [];
  const moving = [];
  const visit = (o, dynamic) => {
    // The root's own flag does not count: merging inside a moving part is
    // how its pieces become one draw that moves with it.
    // userData.keepApart: a part that does not move but must stay a part of
    // its own (a seat, which the checks look past): merged within, not out.
    const own = o !== root && (!!o.userData.dynamic || !!o.userData.keepApart || o.visible === false);
    if (own && !dynamic && o.visible !== false && !o.userData.display) moving.push(o);
    const dyn = dynamic || own;
    if (o.isMesh && !dyn && o !== root && !o.isInstancedMesh && !o.isSkinnedMesh && !o.userData.display && !keep(o)) {
      const mat = o.material;
      if (mat && !Array.isArray(mat) && !mat.transparent && o.geometry && o.geometry.attributes.position) {
        if (!byMat.has(mat)) byMat.set(mat, []);
        byMat.get(mat).push(o);
        victims.push(o);
      }
    }
    for (const c of o.children) visit(c, dyn);
  };
  visit(root, false);
  const m = new THREE.Matrix4();
  let merged = 0;
  for (const [mat, list] of byMat) {
    if (list.length < 2) continue;
    const geos = list.map((o) => {
      m.multiplyMatrices(inv, o.matrixWorld);
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      g.applyMatrix4(m);
      return g;
    });
    const geo = mergeGeometries(geos);
    for (const g of geos) g.dispose();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `merged ${mat.name || mat.type}`;
    mesh.castShadow = list.some((o) => o.castShadow);
    mesh.receiveShadow = true;
    root.add(mesh);
    for (const o of list) {
      o.parent.remove(o);
      o.geometry.dispose();
    }
    merged += list.length;
  }
  /*
   * Then inside each moving part (a stick, a yoke, a lever, a pivot): its
   * own pieces never move against each other, so they merge in its frame
   * and move as one. A piece that moves inside it (a yoke's wheel, a
   * throttle's lever) is flagged dynamic and keeps its own transform.
   */
  if (movers) for (const o of moving) merged += mergeStatic(o, keep, { movers: true });
  return merged;
}

/** Layer the originals of batched moving parts are moved to: no camera, no shadow, no ray sees it. */
export const BATCHED_LAYER = 31;

/**
 * The moving parts drawn together.
 *
 * After mergeStatic every moving part (a stick, a yoke, a lever, a pedal) is
 * still a draw or two of its own — eight to fifteen per cockpit, most of
 * what the cockpit view costs over the follow view. Here every mesh that
 * moves with a part flagged userData.dynamic goes into ONE skinned mesh per
 * material, with the moving parts as its bones: the graphics chip moves
 * each piece by its part's own transform, as it moves today, and nothing
 * else changes — the builders still turn and slide the same parts, and the
 * checks still read them. The originals stay where they are, on a layer no
 * camera, shadow or ray looks at (so a part's children are untouched).
 *
 * Not batched: anything hidden when the cockpit is built (lamps, flags —
 * they are shown later), screens, glass, the needle mesh, and a material
 * only one moving piece uses (nothing to gain).
 */
export function batchMovers(root) {
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map();
  const visit = (o, bone) => {
    if (o !== root && o.visible === false) return;
    const b = o !== root && o.userData.dynamic ? o : bone;
    if (o.isMesh && b && !o.isSkinnedMesh && !o.isInstancedMesh && !o.userData.display && !o.userData.noBatch && o.layers.mask & 1) {
      const mat = o.material;
      const ok = mat && !Array.isArray(mat) && !mat.transparent && (mat.isMeshStandardMaterial || mat.isMeshBasicMaterial || mat.isMeshLambertMaterial || mat.isMeshPhongMaterial);
      if (ok && o.geometry && o.geometry.attributes.position) {
        if (!byMat.has(mat)) byMat.set(mat, []);
        byMat.get(mat).push({ mesh: o, bone: b });
      }
    }
    for (const c of o.children) visit(c, b);
  };
  visit(root, null);
  const m = new THREE.Matrix4();
  let batched = 0;
  for (const [mat, list] of byMat) {
    if (list.length < 2) continue;
    const bones = [...new Set(list.map((x) => x.bone))];
    const geos = list.map(({ mesh, bone }) => {
      m.multiplyMatrices(rootInv, mesh.matrixWorld);
      const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      g.applyMatrix4(m);
      return g;
    });
    const geo = mergeGeometries(geos);
    // Each piece wholly on its part's bone (mergeGeometries keeps the order).
    const n = geo.attributes.position.count;
    const idx = new Uint16Array(n * 4);
    const w = new Float32Array(n * 4);
    let at = 0;
    const parts = [];
    geos.forEach((g, i) => {
      const bi = bones.indexOf(list[i].bone);
      parts.push({ mesh: list[i].mesh, bone: list[i].bone, start: at, count: g.attributes.position.count });
      for (let k = 0; k < g.attributes.position.count; k++, at++) {
        idx[at * 4] = bi;
        w[at * 4] = 1;
      }
    });
    for (const g of geos) g.dispose();
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4));
    const skinned = new THREE.SkinnedMesh(geo, mat);
    skinned.name = `moving parts ${mat.name || mat.type}`;
    skinned.frustumCulled = false;
    skinned.userData.movers = bones;
    skinned.userData.parts = parts; // { mesh, bone, start, count }: which vertices are whose (for the checks)
    root.add(skinned);
    root.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(bones);
    skinned.bind(skeleton, skinned.matrixWorld);
    skeleton.update();
    geo.addEventListener('dispose', () => skeleton.dispose());
    fixSkinnedBounds(skinned);
    for (const { mesh, bone } of list) {
      mesh.layers.set(BATCHED_LAYER);
      mesh.userData.batchedIn = skinned;
      bone.userData.batched = skinned;
    }
    batched += list.length;
  }
  return batched;
}

/** How far a batched part may travel from where it was built (a yoke pushed in, the collective up), metres. */
const MOVER_TRAVEL = 0.25;
const _skinnedRaycast = THREE.SkinnedMesh.prototype.raycast;

/**
 * A batched skinned mesh's bounds, for the CPU, fixed once: the pose it was
 * built in, in its own frame, with room for the parts' travel.
 *
 * three works a skinned mesh's bounds (and a ray's hits on it) out from its
 * bones through `bindMatrixInverse`, which only updateMatrixWorld refreshes —
 * the renderer's, once a frame. Anything that measured the aeroplane between
 * two frames (Box3.setFromObject: PvP's size of your ride, taken while the
 * checks own the clock) carried the cockpit's box through the aeroplane's
 * position twice: the Skylark measured 1.8 km across, so its pellets left
 * 20 m to the side of its nose and its bumps never pushed. The drawing never
 * needed it (frustumCulled is off).
 */
function fixSkinnedBounds(skinned) {
  const geo = skinned.geometry;
  geo.computeBoundingBox();
  const box = geo.boundingBox.clone().expandByScalar(MOVER_TRAVEL);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  skinned.computeBoundingBox = function computeBoundingBox() {
    this.boundingBox = (this.boundingBox || new THREE.Box3()).copy(box);
  };
  skinned.computeBoundingSphere = function computeBoundingSphere() {
    this.boundingSphere = (this.boundingSphere || new THREE.Sphere()).copy(sphere);
  };
  skinned.computeBoundingBox();
  skinned.computeBoundingSphere();
  // A ray tests the pieces where they are now: the bind frame from this
  // matrixWorld, not from whenever the last frame was drawn.
  skinned.raycast = function raycast(raycaster, intersects) {
    if (this.bindMode === THREE.AttachedBindMode) this.bindMatrixInverse.copy(this.matrixWorld).invert();
    return _skinnedRaycast.call(this, raycaster, intersects);
  };
}

/* ------------------------------------------------------------------ *
 * The exterior from inside
 * ------------------------------------------------------------------ */

const _cam = new THREE.Vector3();

/**
 * Hide `mesh` (part of the exterior model) from any camera for which
 * `inside(localPoint)` is true — the camera position in the mesh's own
 * model frame. Done per draw, in onBeforeRender, by switching off colour and
 * depth writes for that one draw and putting them back after, so every
 * other camera (the chase view, a replay, a mirror) still sees it.
 */
export function seeThrough(mesh, model, inside) {
  if (!mesh || mesh.userData.seeThrough) return;
  mesh.userData.seeThrough = true;
  const prevBefore = mesh.onBeforeRender;
  const prevAfter = mesh.onAfterRender;
  const local = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  mesh.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
    if (prevBefore) prevBefore.call(this, renderer, scene, camera, geometry, material, group);
    inv.copy(model.matrixWorld).invert();
    local.copy(camera.getWorldPosition(_cam)).applyMatrix4(inv);
    const hide = !!inside(local);
    const mats = Array.isArray(material) ? material : [material];
    for (const mt of mats) {
      if (!mt) continue;
      if (hide) {
        mt.userData._cw = mt.colorWrite;
        mt.userData._dw = mt.depthWrite;
        mt.colorWrite = false;
        mt.depthWrite = false;
        mt.userData._hidden = true;
      }
    }
  };
  mesh.onAfterRender = function (renderer, scene, camera, geometry, material, group) {
    const mats = Array.isArray(material) ? material : [material];
    for (const mt of mats) {
      if (mt && mt.userData._hidden) {
        mt.colorWrite = mt.userData._cw;
        mt.depthWrite = mt.userData._dw;
        mt.userData._hidden = false;
      }
    }
    if (prevAfter) prevAfter.call(this, renderer, scene, camera, geometry, material, group);
  };
}

/**
 * Cut a box out of an exterior mesh, for a camera inside that box only.
 *
 * The exteriors are built as outsides: a fighter's centre fuselage runs on
 * under its canopy, and its top bulges up through the floor of the cockpit;
 * the 747's main deck runs under the flight deck on its hump. From the seat
 * those surfaces stand between the eye and the panel. Hiding the whole mesh
 * from inside would take the spine behind the canopy with it, so instead the
 * part inside `box` (model units, Box3) is clipped away: six clipping planes
 * with clipIntersection, so only what is inside all six goes.
 *
 * The planes stay on the materials for good (one shader, never switched per
 * draw — a switch per draw cost more than the cockpit itself) and are MOVED
 * instead: onto the box, in the world, just before a carved mesh is drawn
 * for a camera inside it (and before its shadow is drawn while that camera
 * is inside, or the cut part would still shade the cockpit); and out of the
 * way, clipping nothing, for every other camera. main.js turns local
 * clipping on for the renderer.
 */
const carveState = new WeakMap();
function carveFor(model, box) {
  let st = carveState.get(model);
  if (st) return st;
  const local = [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -box.max.x),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), box.min.x),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -box.max.y),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), box.min.y),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -box.max.z),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), box.min.z),
  ];
  const world = local.map((p) => p.clone());
  const inv = new THREE.Matrix4();
  const camLocal = new THREE.Vector3();
  const grow = box.clone().expandByScalar(0.02);
  st = {
    world,
    box,
    /** Put the planes where `camera` needs them; true if it is inside. */
    aim(camera) {
      inv.copy(model.matrixWorld).invert();
      camLocal.copy(camera.getWorldPosition(_cam)).applyMatrix4(inv);
      if (grow.containsPoint(camLocal)) {
        for (let i = 0; i < 6; i++) world[i].copy(local[i]).applyMatrix4(model.matrixWorld);
        return true;
      }
      // Clip nothing: with clipIntersection a point goes only if it is behind
      // all six, and nothing is behind a plane a billion metres away.
      world[0].set(_px, 1e9);
      return false;
    },
  };
  carveState.set(model, st);
  return st;
}
const _px = new THREE.Vector3(1, 0, 0);

export function carveFromInside(mesh, model, box) {
  if (!mesh || mesh.userData.carved) return;
  mesh.userData.carved = true;
  const st = carveFor(model, box);
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const mt of mats) {
    if (!mt || (mt.clippingPlanes && mt.clippingPlanes !== st.world)) continue;
    mt.clippingPlanes = st.world;
    mt.clipIntersection = true;
  }
  const prevBR = mesh.onBeforeRender;
  mesh.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
    if (prevBR) prevBR.call(this, renderer, scene, camera, geometry, material, group);
    if (camera) st.aim(camera);
  };
  const prevBS = mesh.onBeforeShadow;
  mesh.onBeforeShadow = function (renderer, object, camera, shadowCamera, geometry, depthMaterial, group) {
    if (prevBS) prevBS.call(this, renderer, object, camera, shadowCamera, geometry, depthMaterial, group);
    if (camera) st.aim(camera);
  };
}

/**
 * Every exterior mesh whose bounds reach into `box` (model units), cut there
 * from inside (carveFromInside). Glass and anything already handled is left.
 */
export function carveExterior(model, box, skip = () => false) {
  const hidden = [];
  if (!model) return { carved: 0, hidden };
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const bb = new THREE.Box3();
  let n = 0;
  model.traverse((o) => {
    if (!o.isMesh || o.userData.carved) return;
    for (let p = o; p && p !== model; p = p.parent) if (p.name === 'cockpit') return;
    const g = o.geometry;
    if (!g || !g.attributes.position) return;
    if (!g.boundingBox) g.computeBoundingBox();
    m.multiplyMatrices(inv, o.matrixWorld);
    bb.copy(g.boundingBox).applyMatrix4(m);
    if (!bb.intersectsBox(box)) return;
    // Wholly inside: nothing of it can be seen from the seat (it is all cut
    // away, or it faces out), so in the cockpit view it is not drawn at all —
    // a draw and a shadow saved each (the Hornet's twelve canopy-rim tubes,
    // the airliners' panes and frames).
    if (box.containsBox(bb) && !/wiper/i.test(o.name || '')) {
      hidden.push(o);
      return;
    }
    if (o.userData.seeThrough || skip(o)) return;
    // Its bounds reach in: cut it (a big surface can cross the box with no
    // vertex inside; cutting one that only nears it costs nothing seen).
    carveFromInside(o, model, box);
    n++;
  });
  return { carved: n, hidden };
}

/**
 * The cockpit view's own visibility: `viewing(true)` while the camera is in
 * the seat hides the exterior meshes that cannot be seen from it, and
 * `viewing(false)` puts back exactly what was there (main.js calls it every
 * frame; it does nothing unless the view changed).
 */
export function insideOnly(list) {
  let on = false;
  const was = new Map();
  return (inside) => {
    if (!!inside === on) return;
    on = !!inside;
    for (const o of list) {
      if (on) {
        was.set(o, o.visible);
        o.visible = false;
      } else if (was.has(o)) {
        // Only if nothing else changed it meanwhile.
        if (o.visible === false) o.visible = was.get(o);
        was.delete(o);
      }
    }
  };
}
