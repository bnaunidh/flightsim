/**
 * The B-1B Lancer, drawn at full size from the measurements the flight model
 * flies (LANCER_GEOMETRY and LANCER_WING in ../../aircraft/extra/lancer.js).
 *
 * WHAT MAKES IT READ AS ONE, from the chase camera and from 300 m:
 *   - the wings that move: each outer panel is the pack's own wing (its
 *     aileron, its flap, its lamp, its breakaway section) moved onto a pin
 *     in the fixed glove, and turned about it from 15 to 67.5 degrees;
 *   - the blended body: a long, pointed, slightly drooping radome, the flight
 *     deck high on the slope behind it, a body that flows into the glove, and
 *     an upswept tail cone — the civil kit's lofted hull, not three cylinders;
 *   - two box nacelles under the glove, two engines in each, side by side,
 *     with their intakes, four round nozzles and four afterburners;
 *   - one tall fin, with the all-moving stabilators low at its root, and
 *     the little swept vanes on the nose.
 *
 * THE WING AT REST is forward (15 degrees), which is how the aeroplane parks
 * and how the hangar, the airfield (`plan`) and the build-time measurements
 * see it. In flight `userData.sweepRig` says where it is:
 *   rig.sweep   degrees, set every frame by src/features/swing-wing.js for
 *               the aeroplane you fly; left null, the model works its sweep
 *               out for itself from its speed and wheels (a remote player's,
 *               the traffic's), on the same schedule the pilot's AUTO uses
 *   rig.burner  0-1, the afterburners; null: from the engines' rpm
 *   rig.shown   where it is drawn, for the tests
 * The game's wing-tip lamps (model-adapter addLights) are moved with the
 * tips.
 *
 * Proportions, held by tests/features/lancer.mjs on the built model: 44.5 m
 * long, 41.67 m across forward and 23.84 m swept, against the published
 * 44.5, 41.67 and 23.84. No insignia, unit badge or maker's mark: the tail
 * code is the game's own.
 */

import * as THREE from '../../vendor/three.module.js';
import { LANCER_GEOMETRY as G, LANCER_WING as W, panelPoint, autoSweep } from '../../aircraft/extra/lancer.js';
import { wing as foil } from '../../aircraft/models/civil-kit.js';
import { loftFuselage, placeFuselage, meshOf, piecewise, glazing, airlinerMaterials, DECAL } from './airliner-kit.js';
import { plate, refitAirlinerLeg as refitLeg, levelBogies, bodyOf } from './airliners.js';
import { flame, hotMaterial } from './fighters.js';
import { aircraftDecalTexture } from '../aircraft-textures.js';
import { FLASH } from '../../render/flash-safety.js';

const D2R = Math.PI / 180;
const KT = 1.94384;
const clamp = THREE.MathUtils.clamp;
const mix = (a, b, t) => a + (b - a) * t;
const axleY = (r) => G.ground + r;
/** The panel at its forward stop: its tip's leading edge, relative to the pin. */
const TIP_LE = { dx: W.span, dz: -W.rootAhead + W.span * Math.tan(W.min * D2R) };
const CUTS = [-14.0, 9.0];

/* ------------------------------------------------------------------ *
 * Paint
 * ------------------------------------------------------------------ */

const textures = new Map();
const css = (c, f) => {
  try {
    return '#' + new THREE.Color(c ?? f).getHexString();
  } catch (e) {
    return f;
  }
};
const luma = (c) => {
  const k = new THREE.Color(c);
  return 0.2126 * k.r + 0.7152 * k.g + 0.0722 * k.b;
};
function blend(a, b, t) {
  return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}

/**
 * The skin, along (canvas x, nose to tail) by round (canvas y, roof at the
 * top, belly at the bottom), in the hull's UVs. Panel seams and frames, the
 * radome a shade apart, the three weapon-bay doors and the crew hatch on the
 * belly, the refuelling receptacle on the nose, and — for an airline scheme
 * — its cheatline. Shared by colours, like the pack's own skins.
 */
function skinTexture(base, accent, line, along) {
  const key = `lancer|${base}|${accent}|${line}`;
  if (textures.has(key)) return textures.get(key);
  const Wd = 2048;
  const H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = Wd;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const U = (z) => along(z) * Wd;
  const dark = luma(base) < 0.35;
  g.fillStyle = base;
  g.fillRect(0, 0, Wd, H);
  // The radome, a little darker.
  g.fillStyle = blend(base, '#000000', 0.12);
  g.fillRect(0, 0, U(-22.3), H);
  // A faint belly tone.
  const grad = g.createLinearGradient(0, H * 0.75, 0, H);
  grad.addColorStop(0, base);
  grad.addColorStop(1, blend(base, dark ? '#000000' : '#8a9198', 0.18));
  g.fillStyle = grad;
  g.fillRect(U(-22.3), H * 0.75, Wd, H * 0.25);
  // Panel seams: frames round the body every 1.5 m, two lap joints along it.
  g.strokeStyle = dark ? 'rgba(255,255,255,0.07)' : 'rgba(20,30,40,0.1)';
  g.lineWidth = 1.5;
  for (let z = -21; z < 19; z += 1.5) {
    g.beginPath();
    g.moveTo(U(z), 0);
    g.lineTo(U(z), H);
    g.stroke();
  }
  for (const v of [0.3, 0.62, 0.86]) {
    g.beginPath();
    g.moveTo(U(-22.3), H * (1 - v));
    g.lineTo(Wd, H * (1 - v));
    g.stroke();
  }
  // The weapon bays and the crew hatch, on the belly (v near 0 is the bottom row).
  g.strokeStyle = dark ? 'rgba(235,240,245,0.22)' : 'rgba(25,32,40,0.45)';
  g.lineWidth = 2.5;
  for (const [z0, z1] of [[-13.2, -8.4], [-6.8, -2.2], [3.6, 8.2]]) {
    g.strokeRect(U(z0), H - H * 0.075, U(z1) - U(z0), H * 0.07);
    g.beginPath();
    g.moveTo(U(z0), H - 2);
    g.lineTo(U(z1), H - 2);
    g.stroke();
  }
  g.strokeRect(U(-15.6), H - H * 0.05, U(-14.5) - U(-15.6), H * 0.045);
  // The air-refuelling receptacle, on the nose ahead of the windscreen (top row).
  g.fillStyle = blend(base, '#000000', 0.45);
  g.fillRect(U(-21.9), 0, U(-21.2) - U(-21.9), H * 0.03);
  // An airline scheme on a bomber still gets its cheatline.
  if (line) {
    g.fillStyle = line;
    g.fillRect(U(-21.5), H * (1 - 0.6), U(17) - U(-21.5), H * 0.035);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.name = key;
  textures.set(key, t);
  return t;
}

/* ------------------------------------------------------------------ *
 * Parts
 * ------------------------------------------------------------------ */

/** The fixed glove, each side: a thick blended airfoil from inside the body out to the pin. */
function glove(ctx, side, mat) {
  const g = G.glove;
  const T = 0.085;
  const geo = foil({
    stations: [
      { s: g.rootX - 0.3, chord: g.rootTe - g.rootLe, le: g.rootLe, y: g.y, thick: g.rootThick / (g.rootTe - g.rootLe) / T },
      { s: g.outX, chord: g.outTe - g.outLe, le: g.outLe, y: g.y, thick: g.outThick / (g.outTe - g.outLe) / T },
    ],
    t: T,
    m: 0.0,
    steps: 9,
    rootCap: true,
    frame: side < 0 ? 'left' : 'right',
  }).fixed;
  return meshOf(ctx, side < 0 ? 'Port wing glove' : 'Starboard wing glove', geo, mat, ctx.parts.fuselage);
}

/**
 * The swing: everything the pack built in a wing's section — the panel, its
 * aileron and flap, its tip lamp — moved onto a pin at the pivot, kept where
 * it was drawn. The section stays the breakaway part; the pin is inside it.
 */
function pinWing(ctx, side) {
  const wing = ctx.parts[side < 0 ? 'leftWing' : 'rightWing'];
  if (!wing) return null;
  const pin = new THREE.Group();
  pin.name = side < 0 ? 'Port wing pivot' : 'Starboard wing pivot';
  pin.position.set(side * W.pivot.x, W.pivot.y, W.pivot.z);
  for (const c of [...wing.children]) {
    pin.add(c);
    c.position.sub(pin.position);
  }
  wing.add(pin);
  // The pin itself: a fairing on the glove's top, the overwing seal round it.
  ctx.tube('Wing pivot fairing', [side * W.pivot.x, W.pivot.y + 0.18, W.pivot.z - 0.6], [side * W.pivot.x, W.pivot.y + 0.18, W.pivot.z + 0.9], 0.2, ctx.materials.wing, ctx.parts.fuselage, 8);
  return pin;
}

/**
 * One engine's half of its nacelle: a boxy loft from the intake to the
 * nozzle, its intake mouth and splitter, the round nozzle and the burner.
 * Each engine its own group, so each can come away on its own.
 */
function engine(ctx, e, M, hot, flames) {
  const g = ctx.parts[e.id];
  if (!g) return;
  const N = G.nacelle;
  const inner = Math.abs(e.x) < (N.x0 + N.x1) / 2;
  const s = Math.sign(e.x);
  // Remove the pack's buried-nozzle discs; this draws its own.
  for (const c of [...g.children]) if (c.isMesh) c.removeFromParent();
  const half = (N.x1 - N.x0) / 4;
  const cx = e.x;
  const yMid = (N.top + N.bottomFront) / 2;
  const st = (z, bot, w = half) => ({ z, top: N.top, bot, w, yc: (N.top + bot) / 2, nT: 5, nB: 5 });
  const box = loftFuselage({
    stations: [st(N.z0, N.bottomFront, half * 0.98), st(N.z0 + 0.6, N.bottomFront, half), st((N.z0 + N.z1) / 2, mix(N.bottomFront, N.bottomAft, 0.45), half), st(N.z1 - 0.8, N.bottomAft, half * 0.96), st(N.z1, N.bottomAft + 0.08, half * 0.82)],
    radial: 10,
    maxStep: 1.5,
    along: (z) => 0.5 + z * 0.01,
  }, { closeTail: false });
  box.geometry.translate(cx, 0, 0);
  meshOf(ctx, 'Engine nacelle', box.geometry, M.nacelle, g);
  // The intake: a dark mouth inside the lip, raked back at the bottom.
  const x0 = cx - half * 0.86;
  const x1 = cx + half * 0.86;
  plate(ctx, 'Intake mouth', [
    [x0, N.top - 0.12, N.z0 + 0.35], [x1, N.top - 0.12, N.z0 + 0.35],
    [x1, N.bottomFront + 0.12, N.z0 + 0.15], [x0, N.bottomFront + 0.12, N.z0 + 0.15],
  ], 0.05, M.duct, g);
  ctx.tube('Intake lip', [x0, N.bottomFront + 0.06, N.z0 - 0.02], [x1, N.bottomFront + 0.06, N.z0 - 0.02], 0.06, M.lip, g, 6);
  ctx.tube('Intake lip', [x0, N.top - 0.05, N.z0 + 0.02], [x1, N.top - 0.05, N.z0 + 0.02], 0.05, M.lip, g, 6);
  if (inner) ctx.box('Intake splitter', [0.06, N.top - N.bottomFront - 0.1, 0.9], [s * (N.x0 + 0.02), yMid, N.z0 + 0.4], M.core, g);
  // The nozzle.
  const ny = N.bottomAft + (N.top - N.bottomAft) * 0.48;
  const r = Math.min(half * 0.9, (N.top - N.bottomAft) * 0.42);
  ctx.tube('Exhaust nozzle', [cx, ny, N.z1 - 0.3], [cx, ny, N.z1 + 0.85], r, M.core, g, 14);
  ctx.tube('Nozzle throat', [cx, ny, N.z1 + 0.6], [cx, ny, N.z1 + 0.88], r * 0.82, M.duct, g, 12);
  const core = new THREE.Mesh(ctx.model.userData.ownGeometry(new THREE.CircleGeometry(r * 0.7, 14)), hot);
  core.name = 'Hot exhaust core';
  core.position.set(cx, ny, N.z1 + 0.62);
  core.castShadow = false;
  g.add(core);
  flames.push(flame(ctx, `${e.id} afterburner`, g, { x: cx, y: ny, z: N.z1 + 0.86, r: r * 0.78, length: 4.6, color: '#ffa860' }));
}

/** The little swept vanes either side of the nose (the ride-control vanes). */
function vanes(ctx, mat) {
  for (const s of [-1, 1]) {
    const x = s * 0.95;
    const y = -0.62;
    plate(ctx, 'Nose vane', [
      [x, y, -21.6], [x, y, -20.6], [s * 1.75, y - 0.42, -20.75], [s * 1.75, y - 0.42, -21.15],
    ], 0.05, mat, ctx.parts.nose);
  }
}

/* ------------------------------------------------------------------ *
 * The aeroplane
 * ------------------------------------------------------------------ */

const ENGINES = G.engines.map((e) => ({
  id: `${e.x < 0 ? 'left' : 'right'}${Math.abs(e.x) < 4 ? 'Inboard' : 'Outboard'}Engine`,
  kind: 'jet',
  buried: true,
  x: e.x,
  y: e.y,
  z: e.z,
  radius: e.r,
  length: e.length,
  afterburner: true,
  dependsOn: 'fuselage',
}));

const lancer = {
  id: 'b1b',
  name: 'B-1B Lancer',
  kind: 'bomber',
  massKg: 24000,
  paint: '#5d646b',
  accent: '#2e3439',
  registration: null, // the tail code is painted on the fin below
  bodySegments: 12,
  body: bodyOf(G.stations),
  // The outer panel at its forward stop, rooted at the pin; decorate() moves it onto the pin.
  wing: {
    rootX: W.pivot.x, span: W.span, rootZ: W.pivot.z - W.rootAhead, rootY: W.pivot.y,
    rootChord: W.rootChord, tipChord: W.tipChord, sweep: TIP_LE.dz + W.rootAhead, dihedral: W.dihedral,
    thickness: W.thickness, tipThickness: W.tipThickness, flaps: true, struts: false,
  },
  tail: {
    rootX: 0.32, span: G.tail.span - 0.32, rootZ: G.tail.rootZ, rootY: G.tail.rootY,
    rootChord: G.tail.rootChord, tipChord: G.tail.tipChord, sweep: G.tail.sweep, dihedral: G.tail.dihedral, thickness: 0.24,
  },
  fin: { x: 0, rootZ: G.fin.rootZ, rootY: G.fin.rootY - 0.35, height: G.fin.height + 0.35, rootChord: G.fin.rootChord, tipChord: G.fin.tipChord, sweep: G.fin.sweep, thickness: 0.55 },
  canopy: null,
  gear: {
    nose: [0, axleY(G.nose.r), G.nose.z], main: [G.main.x, axleY(G.main.r), G.main.z],
    noseRadius: G.nose.r, mainRadius: G.main.r,
    noseAttach: [0, -1.25, G.nose.z + 0.25],
    retractable: true, dualMain: false, doors: false,
  },
  engines: ENGINES,
  eye: [...G.eye],
  hook: false,
  decorate(ctx) {
    const { parts, model, config: c } = ctx;
    const scheme = c.scheme && typeof c.scheme === 'object' ? c.scheme : null;
    const named = !!(scheme && scheme.id && scheme.id !== 'house');
    const base = css(c.paint, '#5d646b');
    const accent = css(c.accent, '#2e3439');
    const line = named && typeof scheme.cheatline === 'string' ? scheme.cheatline : null;
    const along = piecewise([[G.noseZ, 0], [CUTS[0], 0.24], [G.tailZ, 1]]);
    const tex = skinTexture(base, accent, line, along);
    const M = airlinerMaterials(model, { livery: tex, base });
    // Matte, not an airliner's gloss.
    M.skin.roughness = 0.72;
    M.skin.clearcoat = 0.05;
    M.skin.metalness = 0.12;
    M.nacelle.roughness = 0.7;
    M.nacelle.clearcoat = 0.05;
    M.nacelle.color.set(base);

    /* The body. */
    const F = { stations: G.stations, radial: 18, maxStep: 1.1, cuts: CUTS, rings: [-20.5, -19.5, -18.5, -17.5] };
    const h = loftFuselage({ ...F, along });
    placeFuselage(ctx, h, CUTS, M.skin);
    ctx.exports.fuselage = {
      nose: G.noseZ, tail: G.tailZ,
      halfWidth: Math.max(...G.stations.map((q) => q.w)),
      top: Math.max(...G.stations.map((q) => q.top)),
      bottom: Math.min(...G.stations.map((q) => q.bot)),
    };

    /* The flight deck: two pilots side by side, a windscreen and two side windows each. */
    const panes = [
      { name: 'Windscreen', wiper: true, corners: [{ z: -20.35, x: 0.08 }, { z: -20.15, y: 0.5 }, { z: -19.35, y: 1.02 }, { z: -19.6, x: 0.08 }] },
      { name: 'Side window', corners: [{ z: -20.0, y: 0.48 }, { z: -19.0, y: 0.52 }, { z: -19.05, y: 1.08 }, { z: -19.3, y: 1.04 }] },
      { name: 'Rear side window', corners: [{ z: -18.85, y: 0.53 }, { z: -18.25, y: 0.55 }, { z: -18.3, y: 1.12 }, { z: -18.85, y: 1.12 }] },
    ];
    const gz = glazing(h, panes, { frame: 0.075, frameOff: 0.03, glassOff: 0.042 });
    meshOf(ctx, 'Windscreen frames', gz.frames, M.frame, parts.nose).castShadow = false;
    meshOf(ctx, 'Flight deck glass', gz.glass, M.glass, parts.nose).castShadow = false;
    if (gz.wipers) meshOf(ctx, 'Windscreen wipers', gz.wipers, M.wiper, parts.nose);
    ctx.exports.flightDeck = { panes: gz.outlines, eye: [...c.eye], on: 'nose' };

    /* The glove, the pins, the swing. */
    for (const s of [-1, 1]) glove(ctx, s, ctx.materials.wing);
    const pins = [pinWing(ctx, -1), pinWing(ctx, 1)];

    /* The engines. */
    const hot = hotMaterial(ctx);
    const flames = [];
    for (const e of c.engines) engine(ctx, e, M, hot, flames);

    /* The nose: vanes, a pitot each side, the refuelling light. */
    vanes(ctx, ctx.materials.wing);
    for (const s of [-1, 1]) ctx.tube('Pitot probe', [s * 0.62, -0.25, -23.3], [s * 0.66, -0.26, -23.9], 0.025, M.gear, parts.nose, 5);

    /* The undercarriage: twin nose wheels, two four-wheel bogies. */
    const mats = { gear: M.gear, hub: M.hub, tyre: M.tyre, nacelle: M.nacelle };
    refitLeg(ctx, 'noseGear', { kind: 'dual', track: 0.56, r: G.nose.r, width: 0.29, oleo: 0.13, mats });
    const bogies = [];
    for (const id of ['leftGear', 'rightGear']) {
      const b = refitLeg(ctx, id, { kind: 'bogie', axles: 2, pitch: 1.3, track: 0.98, r: G.main.r, width: 0.4, oleo: 0.17, mats });
      if (b) bogies.push({ node: b, z: G.main.z });
    }
    levelBogies(ctx, bogies, G.main.z);

    /* The tail code, on the fin. */
    const reg = (named && scheme.reg) || 'KS 86-01';
    const light = luma(base) > 0.35;
    const decal = model.userData.ownMaterial(new THREE.MeshBasicMaterial({
      map: aircraftDecalTexture(reg, { color: light ? '#1f272e' : '#d9dee2', background: 'transparent', width: 512, height: 128 }),
      transparent: true, depthWrite: false, side: THREE.FrontSide, ...DECAL,
    }));
    const fz = G.fin.rootZ + G.fin.sweep * 0.32 + G.fin.rootChord * 0.42;
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(ctx.model.userData.ownGeometry(new THREE.PlaneGeometry(2.6, 0.62)), decal);
      m.name = 'Airframe registration';
      m.position.set(s * 0.245, G.fin.rootY + 1.6, fz);
      m.rotation.y = s * Math.PI / 2;
      m.castShadow = false;
      (parts.verticalFin || parts.tail).add(m);
    }

    /* Where the game hangs its lamps (model-adapter addLights), at the wing forward. */
    const tip = panelPoint(TIP_LE.dx, TIP_LE.dz + 0.15, W.min);
    const tipTe = panelPoint(TIP_LE.dx, TIP_LE.dz + W.tipChord - 0.15, W.min);
    const lamps = {
      navLeft: [-tip.x, W.pivot.y + 0.04, tip.z],
      navRight: [tip.x, W.pivot.y + 0.04, tip.z],
      strobeL: [-tipTe.x, W.pivot.y, tipTe.z],
      strobeR: [tipTe.x, W.pivot.y, tipTe.z],
      tail: [0, G.stations[G.stations.length - 1].yc + 0.05, G.tailZ - 0.1],
      beacon: [0, 1.66, -4.0],
      landing: [0, -1.4, G.nose.z + 0.9],
    };
    ctx.exports.lamps = lamps;

    /* The sweep, and the burners. */
    const rig = { sweep: null, burner: null, shown: W.min };
    ctx.exports.sweepRig = rig;
    let cur = W.min;
    // The lamps are hung on the finished model after it is built, so they are
    // looked for again whenever its children change (cheap: a count).
    let sprites = [];
    let scanned = -1;
    const findSprites = () => {
      const host = ctx.model.parent;
      sprites = [];
      if (!host) return;
      scanned = host.children.length;
      for (const o of host.children) {
        if (!o.isSprite) continue;
        for (const k of ['navLeft', 'navRight', 'strobeL', 'strobeR']) {
          const p = lamps[k];
          if (Math.abs(o.position.x - p[0]) < 1e-3 && Math.abs(o.position.z - p[2]) < 1e-3) {
            sprites.push({ o, side: Math.sign(p[0]), dz: k.startsWith('strobe') ? W.tipChord - 0.15 : 0.15 });
          }
        }
      }
    };
    ctx.registerAnimation((dt, state) => {
      let want;
      if (typeof rig.sweep === 'number' && Number.isFinite(rig.sweep)) want = rig.sweep;
      else {
        const v = state.worldVelocity;
        const sp = v ? Math.hypot(v.x || 0, v.y || 0, v.z || 0) : 0;
        want = state.onGround ? W.min : autoSweep({ M: sp / 315, iasKt: sp * KT * 0.9, flaps: state.flaps || 0, gearDown: (state.gear ?? 1) > 0.5 });
      }
      want = clamp(want, W.min, W.max);
      if (typeof rig.sweep === 'number' || !(dt > 0)) cur = want;
      else cur += clamp(want - cur, -W.rate * dt, W.rate * dt);
      rig.shown = cur;
      const d = (cur - W.min) * D2R;
      for (let i = 0; i < 2; i++) if (pins[i]) pins[i].rotation.y = -(i ? 1 : -1) * d;
      // The game's tip lamps follow the tips.
      if (ctx.model.parent && ctx.model.parent.children.length !== scanned) findSprites();
      for (const sp of sprites) {
        const p = panelPoint(TIP_LE.dx, TIP_LE.dz + sp.dz, cur);
        sp.o.position.x = sp.side * p.x;
        sp.o.position.z = p.z;
      }
      // The burners: what the feature says, or the engines near full power.
      const rpm = state.rpm || 0;
      hot.emissiveIntensity = Math.max(0, (rpm - 0.4) / 0.6) * 2.6;
      const k = typeof rig.burner === 'number' ? clamp(rig.burner, 0, 1) : clamp((rpm - 0.9) / 0.08, 0, 1);
      // The flames' lick, 4-7 times a second, is flicker by WCAG's count: at
      // night, burners lit, chase view, it flickered 6% of the worst 10-degree
      // field (tests/flicker-probe.js). With Reduce flashing on (the default)
      // they burn steady.
      const flick = FLASH.reduce ? 1 : 1 + Math.sin((state.time || 0) * 41) * 0.05 + Math.sin((state.time || 0) * 23) * 0.04;
      for (const f of flames) {
        const on = k > 0.01;
        f.outer.visible = on;
        f.inner.visible = on;
        if (!on) continue;
        f.mat.opacity = 0.5 * k;
        f.outer.scale.z = (0.55 + 0.45 * k) * flick;
        f.inner.scale.z = (0.4 + 0.3 * k) * flick;
      }
    });
  },
  description: 'A swing-wing bomber: a long pointed radome and a flight deck high behind it, a blended body flowing into the fixed glove, outer wing panels that sweep from 15 to 67.5 degrees on pins in the glove, two box nacelles of two afterburning engines each, one tall fin with the stabilators low at its root, and four-wheel main bogies.',
  inspiration: "Proportioned against the published B-1B dimensions; procedurally built, not a licensed replica. No insignia or maker's marks.",
};

export const DEFINITIONS = [lancer];
export const DRAWS = DEFINITIONS.map((d) => d.id);
