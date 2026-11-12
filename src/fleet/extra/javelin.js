/**
 * The Nullspire Javelin's own airframe (aircraft/extra/javelin.js is the type;
 * this is what it looks like).
 *
 * Until v80 the Javelin was the Massimo racer drawn in the city's paint. This
 * is an original hypersonic research aircraft in the language of the real
 * ones (waveriders, scramjet demonstrators) without being any of them: a
 * flat-bottomed lifting body whose forebody is the inlet's compression ramp,
 * sharp chines running into small trapezoid wings, a scramjet module slung
 * under the aft belly (inlet lip, flow path, a 2-D nozzle whose expansion
 * ramp is the aft body's underside), twin fins canted out, a narrow canopy
 * faired into a dorsal spine, dark heat tiles with a lighter leading-edge
 * treatment, and the city's amber (#ffb04a) on #10131a.
 *
 * Built with the fleet core (../aircraft-core.js buildAircraft) like the
 * fighters (./fighters.js), so it has the same gear, hinges, damage sections,
 * lamps, haze and breakup as every other pack aeroplane. The core lofts a
 * round body; a lifting body is not round, so decorate() drops the core's
 * three body skins (as ./airliner-kit.js does) and lofts its own hull from
 * HULL below, split into the same nose / fuselage / tail sections. The
 * config's `body` stations are the hull's envelope, so everything that reads
 * the profile (gear attachments, the belly hard point, game/breakup.js's
 * frame) agrees with what is drawn.
 *
 * Metres, -Z forward, +Y up, origin at the centre of gravity. 24.0 m long,
 * 9.5 m span (span:length .40). Only the model is here: the flight model is
 * the type's own (aircraft/extra/javelin.js).
 *
 * NOT IN EXTRA_DEFINITIONS. The Javelin exists nowhere until found, so this
 * module is imported by nothing in the first load or the fleet index;
 * registerJavelinModel() puts the definition into the pack at the moment the
 * type is registered (aircraft/extra/javelin.js registerJavelin).
 */
import * as THREE from '../../vendor/three.module.js';
import { paintTexture } from '../common.js';
import { registerFleetAircraft } from '../aircraft-fleet.js';
import { EXTRA_DRAWS } from './index.js';
import { fighterPlate as plate, face, boxLoft, mirror, driveFlames, cantFins, flame, hotMaterial } from './fighters.js';

export const JAVELIN_ID = 'javelin';

/*
 * The hull, station by station: z, half-width at the chine, belly centre y,
 * top (spine) y. The belly is flat with the slightest vee (the chine sits
 * CHINE_V above the keel line); the upper surface is a superellipse from the
 * chine over the top, slab-sided low and rounded over the spine.
 *
 * Forebody: the belly rises 0.84 m to the nose over 13.4 m — the 3.6 degree
 * compression ramp a scramjet's inlet wants. Aft of the cowl's exit (z 7.8)
 * the belly rises again: that is the nozzle's expansion ramp.
 */
const HULL = [
  [-14.4, 0.03, 0.02, 0.08],
  [-13.4, 0.22, -0.06, 0.22],
  [-12.0, 0.48, -0.16, 0.36],
  [-10.4, 0.78, -0.3, 0.52],
  [-8.8, 1.02, -0.44, 0.62],
  [-7.0, 1.25, -0.56, 0.66],
  [-5.2, 1.45, -0.66, 0.78],
  [-3.2, 1.62, -0.74, 0.92],
  [-1.0, 1.72, -0.8, 0.98],
  [1.6, 1.75, -0.82, 0.98],
  [4.2, 1.7, -0.82, 0.94],
  [6.4, 1.58, -0.78, 0.86],
  [8.2, 1.3, -0.6, 0.7],
  [9.6, 1.0, -0.36, 0.46],
];
const CHINE_V = 0.05;
/** Station indices where the nose becomes the fuselage and the fuselage the tail (the core's three sections). */
const NOSE_END = 5; // z -7.0
const TAIL_START = 10; // z 4.2
/** The superellipse exponent of the upper surface and how many points go round one side of it. */
const SUPER_N = 2.4;
const ARC_STEPS = 5;

const lerp = (a, b, t) => a + (b - a) * t;

/** The hull's [w, yb, yt] at any z, interpolated along HULL. */
function hullAt(z) {
  let i = 0;
  while (i < HULL.length - 2 && HULL[i + 1][0] < z) i++;
  const a = HULL[i], b = HULL[i + 1];
  const t = Math.min(1, Math.max(0, (z - a[0]) / (b[0] - a[0])));
  return [lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];
}
const bellyY = (z) => hullAt(z)[1];
const topY = (z) => hullAt(z)[2];

/** One station's upper ring, chine to chine over the top: 2 * ARC_STEPS + 1 points. */
function upperRing([z, w, yb, yt]) {
  const yc = yb + CHINE_V;
  const pts = [];
  for (let k = -ARC_STEPS; k <= ARC_STEPS; k++) {
    const phi = (Math.abs(k) / ARC_STEPS) * (Math.PI / 2);
    const s = Math.sign(k) || 0;
    // phi = 0 at the chine, pi/2 at the top; k < 0 is port.
    const x = s === 0 ? 0 : s * w * Math.pow(Math.cos(Math.PI / 2 - phi), 2 / SUPER_N);
    const y = yc + (yt - yc) * Math.pow(Math.sin(Math.PI / 2 - phi), 2 / SUPER_N);
    pts.push([x, y, z]);
  }
  return pts;
}

/** One station's belly ring: port chine, keel, starboard chine. */
function bellyRing([z, w, yb]) {
  const yc = yb + CHINE_V;
  return [[-w, yc, z], [0, yb, z], [w, yc, z]];
}

/* ------------------------------------------------------------------ *
 * Geometry.
 * ------------------------------------------------------------------ */

function mesh(ctx, name, geo, mat, parent) {
  ctx.model.userData.ownGeometry(geo);
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = !mat.transparent;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/**
 * A surface lofted between rings of the same point count. `smooth` shares
 * vertices (round over the spine); flat gives every quad its own normals
 * (the belly's crease at the keel). UVs run u round the ring, v along z.
 * Winding is chosen so the outside faces away from `inside` (a point on the
 * centreline inside the hull).
 */
function loft(ctx, name, rings, mat, parent, { smooth = true, insideY = 0, uRange = [0, 0.82], pad = [0, 0] } = {}) {
  const [u0, u1] = uRange;
  const n = rings[0].length;
  const pos = [];
  const uv = [];
  const idx = [];
  // `pad` rings at each end are there for the normals only (so a hull split
  // into sections shades as one surface across the joins); their faces go.
  const [padA, padB] = pad;
  const outward = (a, b, c) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (a[0] + b[0] + c[0]) / 3, my = (a[1] + b[1] + c[1]) / 3 - insideY, mz = 0;
    return nx * mx + ny * my + nz * mz >= 0;
  };
  if (smooth) {
    for (let r = 0; r < rings.length; r++) {
      for (let i = 0; i < n; i++) {
        pos.push(...rings[r][i]);
        uv.push(lerp(u0, u1, i / (n - 1)), rings[r][i][2] * 0.08);
      }
    }
    // The first quad decides the winding for the whole strip.
    const flip = !outward(rings[0][0], rings[0][1], rings[1][1]);
    for (let r = 0; r < rings.length - 1; r++) {
      for (let i = 0; i < n - 1; i++) {
        const a = r * n + i, b = a + 1, c = a + n, d = c + 1;
        if (flip) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    if (padA || padB) {
      // Normals from the whole strip; faces only between the section's own rings.
      const per = (n - 1) * 6;
      g.setIndex(idx.slice(padA * per, idx.length - padB * per));
    }
    return mesh(ctx, name, g, mat, parent);
  }
  const push = (a, b, c) => {
    const ok = outward(a, b, c);
    const tri = ok ? [a, b, c] : [a, c, b];
    for (const p of tri) {
      pos.push(...p);
      uv.push(lerp(u0, u1, (p[0] / Math.max(0.2, Math.abs(rings[0][0][0]) || 1)) * 0.5 + 0.5), p[2] * 0.08);
    }
  };
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < n - 1; i++) {
      const A = rings[r][i], B = rings[r][i + 1], C = rings[r + 1][i], D = rings[r + 1][i + 1];
      push(A, B, C);
      push(B, D, C);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return mesh(ctx, name, g, mat, parent);
}

/** The hull between station indices i0..i1 (inclusive), upper and belly, into `parent`. */
function hullSection(ctx, label, i0, i1, mats, parent) {
  const st = HULL.slice(i0, i1 + 1);
  const a = i0 > 0 ? 1 : 0, b = i1 < HULL.length - 1 ? 1 : 0;
  loft(ctx, `${label} hull`, HULL.slice(i0 - a, i1 + 1 + b).map(upperRing), mats.tiles, parent, { smooth: true, insideY: -0.2, pad: [a, b] });
  loft(ctx, `${label} belly`, st.map(bellyRing), mats.tiles, parent, { smooth: false, insideY: 0.2, uRange: [0.84, 1] });
}

/* ------------------------------------------------------------------ *
 * Paint: heat tiles.
 * ------------------------------------------------------------------ */

/** Dark heat-shield tiles over the paint colour: a grid with gaps, each tile its own shade, a few replaced. */
function tileTexture(paint) {
  const tex = paintTexture(`Javelin_tiles_${paint}`, 512, 1024, (g, w, h) => {
    g.fillStyle = paint;
    g.fillRect(0, 0, w, h);
    const base = new THREE.Color(paint);
    const cols = 24, rows = 64;
    const tw = w / cols, th = h / rows;
    const bellyFrom = Math.round(cols * 0.84);
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const belly = i >= bellyFrom;
        let k = 0.84 + rnd() * 0.34;
        // A few tiles replaced: a shade newer and greyer, never bright.
        if (rnd() < 0.02) k *= 1.35;
        const c = base.clone().multiplyScalar(k);
        // The belly's band (u .84..1): the hottest tiles, darker and browned by the heat.
        if (belly) c.multiplyScalar(0.72).add(new THREE.Color(0.035, 0.02, 0.008));
        g.fillStyle = `#${c.getHexString()}`;
        g.fillRect(i * tw + 0.5, j * th + 0.5, tw - 1, th - 1);
      }
    }
    // Gaps between the tiles, a touch darker than the tiles.
    g.fillStyle = 'rgba(0,0,0,0.6)';
    for (let i = 0; i <= cols; i++) g.fillRect(i * tw - 0.5, 0, 1, h);
    for (let j = 0; j <= rows; j++) g.fillRect(0, j * th - 0.5, w, 1);
    // Heat staining: warm, soft, along the length.
    for (let k = 0; k < 9; k++) {
      const x = rnd() * w, y = rnd() * h, r = 40 + rnd() * 90;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(120,70,40,0.10)');
      grad.addColorStop(1, 'rgba(120,70,40,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
  // The hull's v runs along z in metres, well outside 0..1: the tiles must repeat.
  if (tex.wrapS !== THREE.RepeatWrapping) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
  }
  return tex;
}

/* ------------------------------------------------------------------ *
 * The definition.
 * ------------------------------------------------------------------ */

/** The cowl (scramjet module) sections: z, top y (just inside the belly), bottom y, top half-width, bottom half-width. */
const COWL = [
  [-0.6, -0.78, -1.3, 1.2, 1.0],
  [1.6, -0.8, -1.38, 1.32, 1.1],
  [4.2, -0.8, -1.36, 1.3, 1.08],
  [6.2, -0.76, -1.22, 1.22, 1.02],
  [7.8, -0.7, -1.0, 1.12, 0.96],
];
const cowlRect = ([z, yt, yb, xt, xb]) => [[-xb, yb, z], [xb, yb, z], [xt, yt, z], [-xt, yt, z]];

export const DEFINITION = {
  id: JAVELIN_ID, name: 'Nullspire Javelin', kind: 'hypersonic', massKg: 5200,
  paint: '#10131a', accent: '#ffb04a', registration: null, bodySegments: 8,
  // No stripes on the paint and a matte finish: the tiles and the leading edges are the livery.
  matte: true, minimalLivery: true,
  // The hull's envelope (see HULL): rx = half-width, ry = half-height, cy = mid-height.
  body: HULL.map(([z, w, yb, yt]) => [z, w, (yt - yb) / 2, (yt + yb) / 2]),
  wing: { rootX: 1.5, span: 3.25, rootZ: -1.4, rootY: -0.62, rootChord: 8.4, tipChord: 1.5, sweep: 6.3,
    dihedral: -0.1, thickness: 0.24, tipThickness: 0.05, flaps: true, struts: false },
  tail: null,
  fin: { x: 0.85, rootZ: 4.8, rootY: 0.5, height: 1.85, rootChord: 3.2, tipChord: 0.9, sweep: 2.2, mirror: true, thickness: 0.12 },
  canopy: { kind: 'bubble', z0: -10.3, z1: -6.9, width: 0.42, height: 0.44, baseY: 0.58 },
  // The wheels touch where the flight model's do (the type flies on the Massimo's shape.nose / shape.main:
  // contact at y -2.1, nose z -5.4 drawn at -5.6, mains x 1.4 z 1.4), so the picture and the physics agree.
  gear: { nose: [0, -1.83, -5.6], main: [1.4, -1.73, 1.4], noseRadius: 0.27, mainRadius: 0.37, retractable: true, dualMain: false, doors: true,
    noseAttach: [0, -0.3, -5.4], mainAttach: [1.55, -0.74, 1.5] },
  engines: [
    { id: 'leftEngine', kind: 'jet', buried: true, x: -0.55, y: -0.86, z: 7.0, radius: 0.32, length: 1.6, afterburner: true, dependsOn: 'fuselage' },
    { id: 'rightEngine', kind: 'jet', buried: true, x: 0.55, y: -0.86, z: 7.0, radius: 0.32, length: 1.6, afterburner: true, dependsOn: 'fuselage' },
  ],
  eye: [0, 0.9, -8.1], hook: false,
  decorate(ctx) {
    const { parts, materials: m, config } = ctx;
    const own = (mat) => ctx.model.userData.ownMaterial(mat);
    const drop = (g, names) => { for (const c of [...g.children]) if (names.includes(c.name)) c.removeFromParent(); };
    // The core's round body goes; the lifting body below replaces it.
    drop(parts.nose, ['Tapered nose']);
    drop(parts.fuselage, ['Shaped cabin fuselage']);
    drop(parts.tail, ['Tapered aft fuselage', 'Airframe registration']);

    const tiles = own(new THREE.MeshStandardMaterial({ name: 'Javelin_heat_tiles', map: tileTexture(config.paint), roughness: 0.84, metalness: 0.08 }));
    const edge = own(new THREE.MeshStandardMaterial({ name: 'Javelin_leading_edge', color: 0x9aa0a6, roughness: 0.6, metalness: 0.24 }));
    const mats = { tiles };

    // The hull, in the core's three sections. The first metre is the nose cap, in the leading-edge grey.
    loft(ctx, 'nose cap', HULL.slice(0, 2).map(upperRing), edge, parts.nose, { smooth: true, insideY: -0.1 });
    loft(ctx, 'nose cap belly', HULL.slice(0, 2).map(bellyRing), edge, parts.nose, { smooth: false, insideY: 0.1 });
    // The air-data boom every research aircraft carries.
    ctx.tube('nose boom', [0, 0.05, -14.38], [0, 0.05, -15.3], 0.016, m.metal, parts.nose, 4);
    hullSection(ctx, 'forward', 1, NOSE_END, mats, parts.nose);
    hullSection(ctx, 'centre', NOSE_END, TAIL_START, mats, parts.fuselage);
    hullSection(ctx, 'aft', TAIL_START, HULL.length - 1, mats, parts.tail);
    // The base: the thin wedge where the body ends, closed off dark (a fan over the whole section).
    {
      const last = HULL[HULL.length - 1];
      const ring = [...upperRing(last), bellyRing(last)[1]];
      const c = [0, (last[2] + last[3]) / 2, last[0]];
      const pos = [];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        // Facing aft (+z): wound so the normal points +z.
        pos.push(...c, ...b, ...a);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
      g.computeVertexNormals();
      const base = mesh(ctx, 'base', g, m.dark, parts.tail);
      base.castShadow = false;
    }

    // The dorsal fairing behind the canopy, blending its top into the spine.
    {
      const rings = [];
      const steps = [[-6.9, 0.42, 1.0], [-5.6, 0.36, 0.98], [-4.3, 0.26, 0.96], [-3.0, 0.1, 0.93]];
      for (const [z, w, peak] of steps) {
        const yb = topY(z) - 0.06;
        const pts = [];
        for (let k = -4; k <= 4; k++) {
          const a = (k / 4) * (Math.PI / 2);
          pts.push([Math.sin(a) * w, yb + Math.max(0, peak - yb) * Math.pow(Math.cos(a), 0.8), z]);
        }
        rings.push(pts);
      }
      loft(ctx, 'canopy fairing', rings, tiles, parts.fuselage, { smooth: true, insideY: 0.4 });
    }

    // The amber spine: a stripe from the fairing to the fins, following the top.
    {
      const zs = [-6.4, -5.2, -4.0, -3.0, -1.6, 0, 1.6, 3.0, 4.4];
      const y = (z) => Math.max(topY(z), z < -3.0 ? lerp(1.0, 0.93, (z + 6.9) / 3.9) : 0) + 0.012;
      const outline = [...zs.map((z) => [-0.12, y(z), z]), ...zs.slice().reverse().map((z) => [0.12, y(z), z])];
      plate(ctx, 'dorsal stripe', outline, 0.03, m.accent, parts.fuselage);
    }

    // The scramjet module under the aft belly: the cowl in two pieces (fuselage, tail), its inlet and its nozzle.
    boxLoft(ctx, 'scramjet cowl', COWL.slice(0, 3).map(cowlRect), tiles, parts.fuselage, { capStart: false, capEnd: false });
    boxLoft(ctx, 'scramjet cowl aft', COWL.slice(2).map(cowlRect), tiles, parts.tail, { capStart: false, capEnd: false });
    // The inlet: a dark mouth set back from the lip, a centre splitter, the cowl lip in the leading-edge grey.
    face(ctx, 'inlet mouth', [[1.14, -0.82, -0.5], [-1.14, -0.82, -0.5], [-0.96, -1.26, -0.5], [0.96, -1.26, -0.5]], [0, 0, 1], m.dark, parts.fuselage);
    plate(ctx, 'inlet splitter', [[0, -0.8, -0.6], [0, -1.28, -0.5], [0, -1.3, 0.4], [0, -0.8, 0.4]], 0.06, edge, parts.fuselage, 0);
    plate(ctx, 'cowl lip', [[-1.0, -1.3, -0.62], [1.0, -1.3, -0.62], [1.06, -1.33, -0.3], [-1.06, -1.33, -0.3]], 0.05, edge, parts.fuselage);
    for (const s of [-1, 1]) {
      plate(ctx, `${s < 0 ? 'port' : 'starboard'} cowl side lip`, mirror([[1.0, -1.3, -0.62], [1.2, -0.78, -0.62], [1.24, -0.78, -0.3], [1.04, -1.33, -0.3]], s), 0.05, edge, parts.fuselage, 0);
    }
    // The nozzle: a dark exit with the combustor's glow in two slots, and the plume behind each.
    const hot = hotMaterial(ctx);
    const flames = [];
    for (const s of [-1, 1]) {
      const e = config.engines[s < 0 ? 0 : 1];
      const eg = parts[e.id];
      drop(eg, ['Single recessed exhaust', 'Exhaust dark throat', 'Hot exhaust core']);
      face(ctx, `${s < 0 ? 'port' : 'starboard'} nozzle exit`, mirror([[0.02, -0.7, 7.78], [1.1, -0.7, 7.78], [0.94, -0.99, 7.78], [0.02, -0.99, 7.78]], s), [0, 0, -1], m.dark, parts.tail);
      face(ctx, `${s < 0 ? 'port' : 'starboard'} nozzle hot slot`, mirror([[0.14, -0.76, 7.79], [0.92, -0.76, 7.79], [0.86, -0.94, 7.79], [0.14, -0.94, 7.79]], s), [0, 0, -1], hot, parts.tail);
      flames.push(flame(ctx, `${s < 0 ? 'port' : 'starboard'} scramjet plume`, eg, { x: e.x, y: e.y, z: 7.82, r: 0.56, length: 7.5, color: '#a9d2ff', flatten: 0.5 }));
    }
    driveFlames(ctx, flames, hot);

    // Leading edges in the lighter grey: the forebody chines (nose) and the wings' leading edges.
    for (const s of [-1, 1]) {
      const side = s < 0 ? 'port' : 'starboard';
      const chine = [];
      const zs = [-13.4, -12.0, -10.4, -8.8, -7.0, -5.2, -3.2, -1.4];
      for (const z of zs) { const [w, yb] = hullAt(z); chine.push([w + 0.04, yb + CHINE_V, z]); }
      for (const z of zs.slice().reverse()) { const [w, yb] = hullAt(z); chine.push([w - 0.22, yb + CHINE_V + 0.01, z]); }
      plate(ctx, `${side} chine`, mirror(chine, s), 0.05, edge, parts.nose);
      const wing = parts[s < 0 ? 'leftWing' : 'rightWing'];
      const W = config.wing;
      const le = (t, back) => [W.rootX + W.span * t, W.rootY + W.dihedral * t, W.rootZ + W.sweep * t + back];
      plate(ctx, `${side} wing leading edge`, mirror([le(0, -0.03), le(1, -0.03), le(1, 0.26), le(0, 0.42)], s), 0.06, edge, wing);
      // Amber at the wing tip, as a racing aeroplane carries it.
      plate(ctx, `${side} wing tip band`, mirror([le(0.9, 0.3), le(1, 0.3), le(1, 1.45), le(0.9, 1.9)], s), 0.07, m.accent, wing);
    }
    // Amber on the fin tips, laid before the fins cant so it goes with them.
    {
      const f = config.fin;
      for (const s of [-1, 1]) {
        const x = s * f.x;
        plate(ctx, `${s < 0 ? 'port' : 'starboard'} fin tip band`, [
          [x, f.rootY + f.height * 0.84, f.rootZ + f.sweep * 0.84 + 0.05],
          [x, f.rootY + f.height, f.rootZ + f.sweep + 0.02],
          [x, f.rootY + f.height, f.rootZ + f.sweep + f.tipChord * 0.74],
          [x, f.rootY + f.height * 0.84, f.rootZ + f.sweep * 0.84 + lerp(f.rootChord, f.tipChord, 0.84) * 0.74],
        ], 0.08, m.accent, parts.verticalFin, 0);
      }
    }
    cantFins(ctx, 25);
  },
  description: 'An original hypersonic research aircraft: a flat-bottomed lifting body 24 m long whose forebody is the inlet ramp, sharp chines into small trapezoid wings, a scramjet module under the aft belly with a 2-D nozzle, twin canted fins, a narrow canopy faired into the spine, dark heat tiles with lighter leading edges and the city\'s amber.',
  inspiration: 'Original design for this game. Not based on any real aircraft.',
};

/**
 * The Hangar's and Free Flight's card: this airframe seen from above, nose
 * up (ui/menus.js aircraftThumbnail hands it the card's canvas as
 * type.cardArt). The type flies on the Massimo's `shape`, so the generic plan
 * view drew the Massimo; this draws HULL and DEFINITION, the airframe itself.
 */
export function drawJavelinPlan(g, W, H, { livery, accent, tail }) {
  const k = Math.min((W * 0.86) / 9.5, (H * 0.84) / 24);
  const px = (x) => W / 2 + x * k;
  const py = (z) => H / 2 + (z + 2.4) * k;
  const poly = (pts, fill) => {
    g.fillStyle = fill;
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(px(x), py(z)) : g.moveTo(px(x), py(z))));
    g.closePath();
    g.fill();
  };
  const w = DEFINITION.wing;
  const f = DEFINITION.fin;
  const tip = w.rootX + w.span;
  const tz = w.rootZ + w.sweep;
  for (const s of [-1, 1]) {
    poly([[s * w.rootX, w.rootZ], [s * tip, tz], [s * tip, tz + w.tipChord], [s * w.rootX, w.rootZ + w.rootChord]], livery);
    // Amber at the wing tip, as the airframe carries it.
    poly([[s * (tip - w.span * 0.1), tz - w.sweep * 0.1 + 0.3], [s * tip, tz + 0.3], [s * tip, tz + 1.45], [s * (tip - w.span * 0.1), tz - w.sweep * 0.1 + 1.9]], accent);
  }
  // The lifting body, chine to chine.
  poly([...HULL.map(([z, hw]) => [hw, z]), ...HULL.slice().reverse().map(([z, hw]) => [-hw, z])], livery);
  // The amber spine, the canopy, and the twin fins canted out (seen from above, a slanted sliver each).
  g.strokeStyle = accent;
  g.lineWidth = Math.max(1.6, 0.3 * k);
  g.beginPath();
  g.moveTo(px(0), py(-6.6));
  g.lineTo(px(0), py(f.rootZ));
  g.stroke();
  // cantFins(ctx, 25) below: 25 degrees out.
  const out = f.height * Math.sin((25 * Math.PI) / 180);
  for (const s of [-1, 1]) poly([[s * f.x, f.rootZ], [s * f.x, f.rootZ + f.rootChord], [s * (f.x + out), f.rootZ + f.sweep + f.tipChord], [s * (f.x + out), f.rootZ + f.sweep]], tail);
  const cz = (DEFINITION.canopy.z0 + DEFINITION.canopy.z1) / 2;
  g.fillStyle = 'rgba(150,205,240,0.75)';
  g.beginPath();
  g.ellipse(px(0), py(cz), DEFINITION.canopy.width * k, ((DEFINITION.canopy.z1 - DEFINITION.canopy.z0) / 2) * k, 0, 0, Math.PI * 2);
  g.fill();
}

/** Put the airframe into the fleet pack, once. Returns true when the pack now draws it. */
export function registerJavelinModel() {
  registerFleetAircraft(DEFINITION);
  if (!EXTRA_DRAWS.includes(JAVELIN_ID)) EXTRA_DRAWS.push(JAVELIN_ID);
  return true;
}
