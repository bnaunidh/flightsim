/**
 * Assembly and animation for the civil aeroplanes.
 *
 * Each type file (skylark.js, courier.js, meridian.js, tempest.js,
 * skyhook.js) describes its own airframe through the Builder below; this
 * file owns the materials, the moving parts and the one update() that turns
 * the flight model's state into propellers, rotors, surfaces, gear and
 * lights. The contract is the one model.js has always offered:
 *
 *   Group, scaled by shape.scale, with userData.update(dt, ac, weather)
 *
 * update() is written to take whatever `ac` it is handed: the parked
 * aeroplanes on the apron and the rescue pair in the brace sequence pass a
 * hand-made object with half the fields missing, and a missing field must
 * mean "at rest", not NaN. It allocates nothing per frame.
 *
 * One naming rule: no mesh here is called "wheel", "tyre" or "tire".
 * model-adapter.js's groundOffsetFor() hunts for meshes by those names and
 * measures them in the model's scaled frame against metres — right for the
 * fleet pack, whose models are built at scale 1, and wrong by the shape's
 * scale for these. syncAircraftModel() only applies that offset to pack
 * models today, so a figure here would be ignored rather than harmful; it
 * is kept at 0 so nobody reads a wrong one off userData.groundOffsetY. The
 * drawn tyres are placed on the contact points instead, and
 * tests/features/civil.mjs measures that they are.
 */
import * as THREE from '../../vendor/three.module.js';
import { paintMaterial } from '../../render/paint.js';
import {
  airframeTexture,
  airframeNormal,
  propTexture,
} from '../../render/textures.js';
import { Batch, blade, turned, tubePath, naThick, naCamber } from './civil-kit.js';
import { strobeLevel, blinkLevel } from '../../render/flash-safety.js';
import { resolveLamps } from '../systems.js';
import { seatDoorsOnSkin } from '../bay-door-seat.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

/* ------------------------------------------------------------------ *
 * Lamps
 * ------------------------------------------------------------------ */

let glowTex = null;
/**
 * One glowing lamp. Also used by model-adapter.js for the fleet pack's
 * aeroplanes, through model.js's re-export.
 *
 * The texture is made once. It used to be a fresh 64x64 canvas per lamp —
 * seven per aeroplane, rebuilt on every aircraft change — for an image that
 * is identical every time; the colour is the material's.
 */
export function glowSprite(color, size) {
  if (!glowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    glowTex = new THREE.CanvasTexture(c);
    glowTex.colorSpace = THREE.SRGBColorSpace;
  }
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
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

/* ------------------------------------------------------------------ *
 * Blur discs
 * ------------------------------------------------------------------ */

/*
 * A running rotor or propeller is drawn as a disc, and the disc has to be
 * seen.
 *
 * It was the game's propeller blur: a pale texture at 0.06-0.10 alpha, drawn
 * additively at 0.42 (rotor) or 0.5 (propellers) opacity. Adding that little
 * light to a sunlit runway or a bright sky changes almost nothing, and the
 * Skyhook's blades were hidden behind it as soon as the rotor had spooled
 * up, three seconds after the engine started, on the ground and in the hover
 * alike. The reviewer measured the chase view with and without that disc in
 * headless Chrome: 5 of 255 levels apart on average, 13 at most. A
 * helicopter with a hub and no rotor.
 *
 * A real rotor at speed looks like a dark, see-through disc: densest near
 * the hub, where the blades cover most of each circle they sweep, thinner
 * outward, with the painted blade tips drawing a ring round the edge. So the
 * disc is drawn with normal blending in graphite, alpha falling from root to
 * tip, a tip ring, and a faint ghost of each blade that turns (slowly
 * enough to read as turning; see visRev below). Measured the same way on
 * this disc (tests/features/civil.browser.js does it every run): on the
 * runway 2.6% of the frame changes, by 59 levels on average and 124 at
 * most; in a 21 m hover 3.5%, by 37 and 121.
 */
const blurCache = new Map();

/**
 * The disc texture: `blades` ghosts, alpha `dense` at the hub cut-out falling
 * to `thin` at the tip, then tip rings `rings` [[r0, r1, css colour], ...]
 * as fractions of the radius. Cached per key: built once, never per frame.
 * Its design numbers ride on userData so the node checks can reason about
 * how much it covers without a canvas to read back.
 */
function blurTexture(key, { blades, body, hub, dense, thin, ghost, rings }) {
  const had = blurCache.get(key);
  if (had) return had;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const m = S / 2;
  const R = m - 1;
  const TAU = Math.PI * 2;
  const rgba = (a) => `rgba(${body[0]},${body[1]},${body[2]},${a})`;
  // The swept body, denser at the root.
  const g = ctx.createRadialGradient(m, m, R * hub, m, m, R);
  g.addColorStop(0, rgba(dense));
  g.addColorStop(1, rgba(thin));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(m, m, R, 0, TAU);
  ctx.fill();
  // Ghost blades: each blade smeared either side of where it is, as thin
  // wedges of falling alpha (no conic gradients: older iPads lack them).
  // Symmetric, so it is right for either turning sense.
  const slices = 11;
  const spread = (TAU / blades) * 0.5;
  for (let b = 0; b < blades; b++) {
    const a0 = (b / blades) * TAU - spread / 2;
    for (let k = 0; k < slices; k++) {
      const f = Math.sin(((k + 0.5) / slices) * Math.PI);
      ctx.fillStyle = rgba(ghost * f * f);
      ctx.beginPath();
      ctx.moveTo(m, m);
      ctx.arc(m, m, R * 0.985, a0 + (spread * k) / slices, a0 + (spread * (k + 1)) / slices);
      ctx.closePath();
      ctx.fill();
    }
  }
  // Painted tips, each a ring.
  for (const [r0, r1, colour] of rings) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = R * (r1 - r0);
    ctx.beginPath();
    ctx.arc(m, m, (R * (r0 + r1)) / 2, 0, TAU);
    ctx.stroke();
  }
  // The hub is drawn as a hub, not as blur.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(m, m, R * hub, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // The least the disc covers anywhere between hub and tip ring, and how
  // dark it is (relative luminance, sRGB-weighted, 0..1).
  tex.userData.minAlpha = Math.min(dense, thin);
  tex.userData.luminance = (0.2126 * body[0] + 0.7152 * body[1] + 0.0722 * body[2]) / 255;
  blurCache.set(key, tex);
  return tex;
}

const GRAPHITE = [34, 37, 42];
const rotorBlur = () =>
  blurTexture('rotor', { blades: 4, body: GRAPHITE, hub: 0.1, dense: 0.46, thin: 0.3, ghost: 0.3, rings: [[0.91, 0.97, 'rgba(236,238,232,0.62)']] });
// Tail rotors are painted in bands so the ground crew can see them turning.
const tailBlur = () =>
  blurTexture('tail', {
    blades: 2,
    body: GRAPHITE,
    hub: 0.12,
    dense: 0.4,
    thin: 0.26,
    ghost: 0.26,
    rings: [
      [0.76, 0.84, 'rgba(240,240,236,0.55)'],
      [0.87, 0.97, 'rgba(214,40,40,0.7)'],
    ],
  });
// Propellers: the same yellow tips propTexture paints on the blades. Thinner
// than a rotor — a propeller is two or four narrow blades on a small circle,
// and a pilot looks straight through it.
const propBlur = (blades) =>
  blurTexture('prop' + blades, { blades, body: GRAPHITE, hub: 0.14, dense: 0.34, thin: 0.2, ghost: 0.22, rings: [[0.92, 0.98, 'rgba(242,197,61,0.62)']] });

/*
 * Tail-rotor blades, painted the way real ones are: red and white bands at
 * the tip, so the ground crew can see them. Plain dark blades, as they were,
 * were lost against the Skyhook's own dark fin. The bands sit where the
 * tail disc draws its rings (blade v runs 0 at the root to 1 at the tip).
 */
let tailBladeTex = null;
function tailBladeTexture() {
  if (tailBladeTex) return tailBladeTex;
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 128;
  const ctx = c.getContext('2d');
  // Canvas top is v = 1 (the tip).
  const band = (v0, v1, colour) => {
    ctx.fillStyle = colour;
    ctx.fillRect(0, (1 - v1) * 128, 16, (v1 - v0) * 128);
  };
  band(0, 1, '#23262b');
  band(0.74, 0.83, '#f0f0ec');
  band(0.86, 1, '#d62828');
  tailBladeTex = new THREE.CanvasTexture(c);
  tailBladeTex.colorSpace = THREE.SRGBColorSpace;
  return tailBladeTex;
}

function blurMaterial(map) {
  return new THREE.MeshBasicMaterial({
    name: 'blur disc',
    map,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    // Transparent and double-sided draws twice, back face then front: the
    // same disc laid over itself, twice as dark. One pass is right for a flat disc.
    forceSinglePass: true,
  });
}

/*
 * How fast the drawn blades, and a disc's ghost blades, may APPEAR to turn,
 * in revolutions a second. The real figures — 6.5 rev/s for the rotor, 34
 * for the tail rotor, 7.5 for a propeller at idle — alias at 30 frames a
 * second: a four-bladed rotor at 6.5 rev/s moves 78 degrees a frame, which
 * the eye reads as 12 degrees BACKWARDS, and a two-bladed propeller at idle
 * moves 90, which is no motion at all. Kept under half a blade's spacing a
 * frame down to 20 frames a second, it reads as turning the right way:
 * 10 / blades, less a margin.
 */
const visRev = (blades) => 9 / Math.max(1, blades);

/*
 * Seen from inside, a disc is between the pilot and everything: a propeller
 * a metre in front of the windscreen would grey out the whole view ahead.
 * Real pilots look through it. So the disc thins as the camera comes near
 * it — measured from the disc's centre, in metres, as it is drawn — to
 * `floor` of its strength at `near`. Nothing is allocated.
 */
function thinWhenNear(mesh, near, far, floor) {
  mesh.userData.opacity = 0;
  mesh.onBeforeRender = (renderer, scene, camera) => {
    const a = mesh.matrixWorld.elements;
    const b = camera.matrixWorld.elements;
    const dx = a[12] - b[12];
    const dy = a[13] - b[13];
    const dz = a[14] - b[14];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const f = floor + (1 - floor) * clamp((d - near) / (far - near), 0, 1);
    mesh.material.opacity = mesh.userData.opacity * f;
  };
}

/* ------------------------------------------------------------------ *
 * Materials
 * ------------------------------------------------------------------ */

function paint(map, { roughness = 0.36, metalness = 0.4, color = 0xffffff } = {}) {
  // Paint over metal, with a clearcoat on High and Ultra (render/paint.js).
  return paintMaterial(map, { roughness, metalness, color, normalMap: airframeNormal() });
}

/** Window glass that stands out from this scheme's base paint (see below). */
function glassFor(scheme) {
  const base = new THREE.Color(scheme.base || '#eef1f5');
  // Relative luminance of the paint, in linear light.
  const lum = 0.2126 * base.r + 0.7152 * base.g + 0.0722 * base.b;
  const dark = lum < 0.2;
  return new THREE.MeshStandardMaterial({
    name: 'glass',
    color: dark ? 0x6a8aa8 : 0x1c2b3b,
    roughness: 0.06,
    metalness: dark ? 0.45 : 0.65,
  });
}

export function civilMaterials(scheme) {
  const skin = airframeTexture(scheme);
  /*
   * `finish: 'matte'` (an army helicopter's flat paint, liveries.js schemeFor
   * from the type's `paint`): no gloss and no clearcoat. Olive drab with an
   * airliner's shine on it read as a plastic kit.
   */
  const flat = scheme.finish === 'matte';
  const unshine = (m) => {
    if (flat && 'clearcoat' in m) m.clearcoat = 0;
    return m;
  };
  const body = unshine(paint(skin, flat ? { roughness: 0.8, metalness: 0.08 } : { roughness: 0.36, metalness: 0.4 }));
  const matte = unshine(paint(skin, flat ? { roughness: 0.86, metalness: 0.05 } : { roughness: 0.55, metalness: 0.25 }));
  const tail = scheme.tail ? paint(skin, { roughness: 0.38, metalness: 0.35, color: scheme.tail }) : body;
  const tailMatte = scheme.tail ? paint(skin, { roughness: 0.55, metalness: 0.25, color: scheme.tail }) : matte;
  return {
    body,
    matte,
    tail,
    tailMatte,
    /*
     * Glass that is dark and reflective, and opaque — which is how a cabin
     * window looks from outside in daylight. The see-through version cut
     * the skin away behind it and needed an interior to look into; what you
     * got was a hollow shell with two seats in it, and from any distance a
     * pale hole. FrontSide, so from inside (the cockpit view) it is culled
     * and does not tint the view out.
     *
     * Its shade follows the paint. At 0x17222d for every scheme, the windows
     * of the dark-painted types (the Courier is #1d2b3a, the Tempest
     * #243a4e) were the colour of the paint round them, and from the side
     * the Courier read as having no cabin at all; one mid blue-grey instead
     * fixed that and made the Skyhook's (#2f4a63) vanish the same way. So a
     * dark scheme gets pale, sky-reflecting glass and a light one dark glass.
     */
    glass: flat
      ? // Tinted, as service canopies are: the pale sky-glass a dark airliner
        // scheme gets looked like a toy's windows in olive drab.
        new THREE.MeshStandardMaterial({ name: 'glass', color: 0x34465a, roughness: 0.07, metalness: 0.62 })
      : glassFor(scheme),
    rubber: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.92, metalness: 0 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.32, metalness: 0.8 }),
    hub: new THREE.MeshStandardMaterial({ color: 0xd5d9de, roughness: 0.35, metalness: 0.65 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x101317, roughness: 0.85, metalness: 0.15 }),
    grey: new THREE.MeshStandardMaterial({ color: 0x5b626b, roughness: 0.6, metalness: 0.35 }),
    accent: new THREE.MeshStandardMaterial({
      color: new THREE.Color(scheme.accent || '#c8102e'),
      roughness: 0.3,
      metalness: 0.45,
    }),
    blade: new THREE.MeshStandardMaterial({ map: propTexture(), roughness: 0.5, metalness: 0.3 }),
  };
}

/* ------------------------------------------------------------------ *
 * Builder
 * ------------------------------------------------------------------ */

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

export class Builder {
  constructor(type, S, scheme) {
    this.type = type;
    this.S = S;
    this.scheme = scheme;
    this.m = civilMaterials(scheme);
    this.root = new THREE.Group();
    this.root.name = 'aircraft';
    this.static = new Batch(`${type.id} airframe`);
    this.surfaces = []; // { kind, obj, q0 }
    this.props = []; // { spin, disc, dir, blades, angle }
    this.rotor = null;
    // Every rotor on the machine (a Chinook has two); `rotor` is the first.
    this.rotors = [];
    this.gear = { legs: [], wheels: [], steer: [] };
    this.nozzles = [];
    this.lamps = {};
    // The moving parts a real aeroplane has besides its control surfaces
    // (see addSpoiler, addBayDoor, addReverser, addFan): one group each.
    this.spoilers = []; // { obj, sign }
    this.bayDoors = []; // { obj, sign }
    this.reversers = []; // { obj, travel }
    this.fans = []; // { obj }
    this.hullMeshes = [];
    // Per-frame work a type adds for itself (the Meridian's doors), run
    // after the shared update; and what it publishes on the model (doors,
    // the flight deck's outline) — see finish().
    this.updaters = [];
    this.doors = null;
    this.flightDeck = null;
  }

  /** Put a geometry into the merged static airframe. */
  put(geo, mat, opts) {
    this.static.place(geo, mat, opts);
    return this;
  }

  /** A hull (see civil-kit.js), skin in `mat`, window quads in glass. */
  addHull(h, mat = this.m.body, name = 'fuselage') {
    const mesh = new THREE.Mesh(h.geometry, [mat, this.m.glass]);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    this.root.add(mesh);
    this.hullMeshes.push(mesh);
    return mesh;
  }

  /** A control surface, hinged at `pivot` with local +X along the hinge. */
  addSurface(kind, s, mat = this.m.matte) {
    const obj = new THREE.Group();
    obj.name = kind;
    obj.position.copy(s.pivot);
    obj.quaternion.copy(s.quat);
    const mesh = new THREE.Mesh(s.geometry, mat);
    mesh.castShadow = true;
    obj.add(mesh);
    this.root.add(obj);
    this.surfaces.push({ kind, obj, q0: s.quat.clone() });
    return obj;
  }

  /**
   * A propeller: spinner, blades and blur disc, turning about the local Z
   * axis, placed with its disc at `at`. `dir` is the turning sense seen from
   * behind (+1 clockwise, the usual way for a single).
   */
  addProp({ at, radius, blades = 2, chord = 0.15, spinner = { r: 0.2, len: 0.42 }, dir = 1, mat = null }) {
    const unit = new THREE.Group();
    unit.name = 'propeller';
    unit.position.set(at[0], at[1], at[2]);
    const spin = new THREE.Group();
    unit.add(spin);
    const bat = new Batch('propeller blades');
    const hubR = spinner ? spinner.r * 0.7 : 0.08;
    for (let i = 0; i < blades; i++) {
      const g = blade({ r0: hubR, r1: radius * 0.98, chord, rootChord: chord * 0.7, tipChord: chord * 0.6, twistRoot: 0.8 * dir, twistTip: 0.28 * dir, stations: 4 });
      bat.place(g, this.m.blade, { r: [0, 0, (i / blades) * Math.PI * 2] });
    }
    if (spinner) {
      const r = spinner.r;
      const L = spinner.len;
      // A parabolic spinner: pointed, but full-bodied at the back.
      const prof = [];
      for (let k = 0; k <= 4; k++) {
        const t = k / 4;
        prof.push([r * Math.pow(t, 0.62), -L * (1 - t) - 0.02]);
      }
      prof.push([r * 0.96, 0.05]);
      bat.add(turned(prof, 10, { closeEnds: true }), mat || this.m.accent);
    }
    bat.build(spin);
    // One material per disc: each fades by its own distance from the camera
    // (thinWhenNear), and a material shared by two discs drawn one after the
    // other keeps the first one's opacity for both.
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 32), blurMaterial(propBlur(blades)));
    disc.name = 'propeller disc';
    disc.position.z = 0.01;
    disc.visible = false;
    thinWhenNear(disc, 3, 7, 0.12);
    unit.add(disc);
    this.root.add(unit);
    this.props.push({ spin, disc, dir, blades, angle: 0 });
    return unit;
  }

  /**
   * A main rotor on its mast head, and a tail rotor.
   *
   * The head leans with the cyclic, the blades droop when stopped and cone
   * up under collective, and above a certain speed the blades give way to a
   * blur disc — the same trick as the propellers, laid flat.
   */
  /*
   * `dir` is the turning sense seen from above (+1 anticlockwise, the
   * American way; -1 clockwise: French and Russian machines, and the aft
   * rotor of a tandem). `flap` is how far the blades flap once a turn with
   * the airspeed (blowback), radians at 40 m/s, drawn while the blades are
   * drawn. `tail.fenestron` draws the tail rotor inside a shroud; `tail.cant`
   * leans its axis (radians, the Black Hawk's 20 degrees). `rootCut` keeps
   * the blade roots clear of a big hub.
   */
  addRotor({ hub, radius, blades = 4, chord = 0.24, droop = -0.035, cone = 0.05, tilt = 0.08, hz = 6.5, dir = 1, flap = 0.03, rootCut = 0.3, hubR = 0.2, tail = null }) {
    const head = new THREE.Group();
    head.name = 'rotor head';
    head.position.set(hub[0], hub[1], hub[2]);
    const spin = new THREE.Group();
    head.add(spin);
    const bladeGroup = new THREE.Group();
    spin.add(bladeGroup);
    // blade() builds along +Y with the chord on X; a rotor blade lies along
    // +X with its chord fore-and-aft and its thickness vertical.
    const lay = new THREE.Matrix4().set(0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1);
    const coners = [];
    for (let i = 0; i < blades; i++) {
      const arm = new THREE.Group();
      arm.rotation.y = (i / blades) * Math.PI * 2;
      bladeGroup.add(arm);
      const coner = new THREE.Group();
      arm.add(coner);
      coners.push(coner);
      const g = blade({ r0: rootCut, r1: radius, chord, rootChord: chord * 0.8, tipChord: chord * 0.9, twistRoot: 0.14 * dir, twistTip: 0.03 * dir, t: 0.12, stations: 5 });
      g.applyMatrix4(lay);
      const mesh = new THREE.Mesh(g, this.m.blade);
      mesh.castShadow = true;
      coner.add(mesh);
    }
    // Hub, grips and pitch links: they turn with the blades.
    const hb = new Batch('rotor hub');
    const hs = hubR / 0.2;
    hb.add(new THREE.CylinderGeometry(hubR, hubR * 1.2, 0.16 * hs, 12), this.m.grey);
    for (let i = 0; i < blades; i++) {
      const a = (i / blades) * Math.PI * 2;
      // Grip and pitch link, out to where the blade root starts.
      hb.place(new THREE.BoxGeometry(rootCut * 1.4, 0.09 * hs, 0.14 * hs), this.m.metal, { p: [Math.cos(a) * rootCut * 0.95, 0, -Math.sin(a) * rootCut * 0.95], r: [0, a, 0] });
      hb.place(new THREE.CylinderGeometry(0.018 * hs, 0.018 * hs, 0.22 * hs, 5), this.m.dark, { p: [Math.cos(a + 0.35) * rootCut * 0.8, -0.14 * hs, -Math.sin(a + 0.35) * rootCut * 0.8] });
    }
    hb.place(new THREE.CylinderGeometry(0.06 * hs, 0.1 * hs, 0.16 * hs, 8), this.m.grey, { p: [0, 0.14 * hs, 0] });
    hb.build(spin);
    // The disc turns with the head (its ghost blades go round) and leans
    // with it. From the cabin, right under it, it thins to a third. It is a
    // shallow cone, the way a loaded rotor is (coning), not a flat plate.
    const discGeo = new THREE.CircleGeometry(radius, 40);
    {
      const pos = discGeo.attributes.position;
      const tc = Math.tan(cone * 0.7);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        pos.setZ(i, Math.hypot(x, y) * tc);
      }
      discGeo.computeVertexNormals();
    }
    const disc = new THREE.Mesh(discGeo, blurMaterial(rotorBlur()));
    disc.name = 'rotor disc';
    disc.rotation.x = -Math.PI / 2;
    disc.visible = false;
    thinWhenNear(disc, 3, 7, 0.35);
    spin.add(disc);
    this.root.add(head);
    const R = { head, spin, blades: bladeGroup, coners, disc, droop, cone, tilt, hz, dir, flap, tail: null, tailBlades: null, tailDisc: null, tailCount: 2, tailDir: 1 };
    if (tail) {
      const tg = new THREE.Group();
      tg.name = 'tail rotor';
      tg.position.set(tail.at[0], tail.at[1], tail.at[2]);
      // A canted tail rotor (the Black Hawk's leans 20 degrees to lift a little).
      if (tail.cant) tg.rotation.z = tail.cant;
      // A fenestron: the fan inside a shroud in the fin.
      if (tail.fenestron) {
        const shroud = new Batch('fenestron shroud');
        // The duct is a thick ring with rounded lips (a lathe of its section,
        // axis along X), set into the fin: a torus read as a hoop stuck on.
        const ri = tail.radius + 0.03;
        const ro = tail.radius + 0.3;
        const ht = 0.19;
        const prof = [];
        for (let k = 0; k <= 6; k++) {
          const a = Math.PI / 2 + (k / 6) * Math.PI; // the inner lip, round
          prof.push(new THREE.Vector2(ri + 0.05 + Math.cos(a) * 0.05, Math.sin(a) * ht * 0.95));
        }
        prof.push(new THREE.Vector2(ro, -ht * 0.8), new THREE.Vector2(ro, ht * 0.8));
        prof.push(prof[0].clone());
        const duct = new THREE.LatheGeometry(prof.reverse(), 30).rotateZ(Math.PI / 2);
        shroud.add(duct, this.m.tail);
        // The hub on its stator vanes, still while the fan turns.
        shroud.add(new THREE.CylinderGeometry(0.13, 0.13, 0.26, 12).rotateZ(Math.PI / 2), this.m.grey);
        for (let k = 0; k < 3; k++) {
          const a = -Math.PI / 2 + (k - 1) * 0.55;
          shroud.place(new THREE.BoxGeometry(0.03, ri - 0.12, 0.05), this.m.grey, { p: [0.07, Math.sin(a) * (ri / 2 + 0.06), -Math.cos(a) * (ri / 2 + 0.06)], r: [a + Math.PI / 2, 0, 0] });
        }
        shroud.build(tg);
      }
      const tspin = new THREE.Group();
      tg.add(tspin);
      const tb = new THREE.Group();
      tspin.add(tb);
      const tbat = new Batch('tail rotor blades');
      const tailBladeMat = new THREE.MeshStandardMaterial({ map: tailBladeTexture(), roughness: 0.5, metalness: 0.2 });
      const n = tail.blades || 2;
      for (let i = 0; i < n; i++) {
        const g = blade({ r0: tail.fenestron ? 0.1 : 0.05, r1: tail.radius, chord: tail.chord || 0.12, twistRoot: 0.3, twistTip: 0.12, t: 0.1, stations: 4 });
        // Chord fore-and-aft, turning about X.
        // `tail.angles` (radians) places the blades unevenly: the Apache's
        // scissor tail rotor, two two-blade rotors set 55 degrees apart.
        const ang = Array.isArray(tail.angles) && tail.angles.length === n ? tail.angles[i] : (i / n) * Math.PI * 2;
        tbat.place(g, tailBladeMat, { r: [ang, 0, 0], q: new THREE.Quaternion().setFromEuler(new THREE.Euler(ang, Math.PI / 2, 0, 'XYZ')) });
      }
      tbat.add(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 8).rotateZ(Math.PI / 2), this.m.grey);
      tbat.build(tb);
      const tdisc = new THREE.Mesh(new THREE.CircleGeometry(tail.radius, 24), blurMaterial(tailBlur()));
      tdisc.name = 'tail rotor disc';
      tdisc.rotation.y = Math.PI / 2;
      tdisc.visible = false;
      thinWhenNear(tdisc, 3, 7, 0.35);
      tspin.add(tdisc);
      this.root.add(tg);
      R.tail = tspin;
      R.tailBlades = tb;
      R.tailDisc = tdisc;
      R.tailCount = n;
      R.tailDir = tail.dir || 1;
    }
    if (!this.rotor) this.rotor = R;
    this.rotors.push(R);
    return R;
  }

  /**
   * A gear leg: a group pivoting at `pivot` (the attachment), folding about
   * `axis` by `angle` as it retracts. Parts are added in aircraft
   * coordinates through the returned `add()`; they are moved into the leg's
   * own frame here.
   *
   * How it gives under load (see squash() below): by default each wheel
   * slides up its leg, as on an oleo. `swing: true` is a spring-steel leg,
   * which bends up about its root instead, taking everything on it along;
   * `lift: true` is a skid set, which rises as one piece.
   */
  addLeg({ pivot, axis = X_AXIS, angle = 0, name = 'gear leg', swing = false, lift = false }) {
    const leg = new THREE.Group();
    leg.name = name;
    leg.position.set(pivot[0], pivot[1], pivot[2]);
    this.root.add(leg);
    const bat = new Batch(name);
    const rec = {
      leg,
      axis: new THREE.Vector3(...(axis.isVector3 ? axis.toArray() : axis)).normalize(),
      angle,
      bat,
      swing: swing ? { side: Math.sign(pivot[0]) || 1, reach: 1, gp: pivot[0] < 0 ? 1 : 2 } : null,
      lift,
      baseY: pivot[1],
    };
    this.gear.legs.push(rec);
    const off = new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]);
    rec.add = (geo, mat, opts) => {
      bat.place(geo, mat, opts);
      geo.applyMatrix4(off);
      return rec;
    };
    return rec;
  }

  /**
   * A wheel on a leg: tyre and hub, spinning about the axle (local X).
   * `c` is the axle centre in aircraft coordinates; `R` the tyre's outer
   * radius, so the tyre's lowest point is exactly c.y - R.
   */
  addWheel(rec, c, R, width, { steer = false, hubMat = null, twin = 0 } = {}) {
    const parent = new THREE.Group();
    parent.position.set(c[0] - rec.leg.position.x, c[1] - rec.leg.position.y, c[2] - rec.leg.position.z);
    rec.leg.add(parent);
    let holder = parent;
    if (steer) {
      this.gear.steer.push(parent);
      holder = new THREE.Group();
      parent.add(holder);
    }
    const w = new THREE.Group();
    w.name = 'axle';
    /*
     * One tyre, or a pair either side of the axle centre on one axle, merged
     * into one mesh per material. The torus is turned so one of its vertices
     * is at the very bottom: with 12 segments round, none was, and the drawn
     * tyre stood 2.5% of its radius off the contact point.
     *
     * The hub was a disc 0.71 of the tyre's radius, flush with its sidewalls,
     * so from the side each wheel was a thin black ring round a big silver
     * plate — a toy's wheel. An aeroplane's tyre is mostly sidewall: a 5.00-5
     * on a 172 is 15 in across on a 5 in rim. The tube is thicker now and the
     * hub 0.44 of the radius, sunk to where the sidewall curves in to meet
     * it, and a single tyre gets 13 segments round instead of 11 (twins keep
     * 11: there are six of them on the Meridian and they are half the size).
     */
    const tube = R * 0.34;
    const around = twin ? 11 : 13;
    const wb = new Batch('axle');
    for (const dx of twin ? [-twin / 2, twin / 2] : [0]) {
      const tg = new THREE.TorusGeometry(R - tube, tube, 5, around).rotateZ(-Math.PI / 2);
      tg.scale(1, 1, width / (tube * 2)).rotateY(Math.PI / 2).translate(dx, 0, 0);
      wb.add(tg, this.m.rubber);
      // 0.6 of the tyre's width: where the five-sided section of the torus
      // has curved in to this radius, so the rim sits just inside the
      // sidewall rather than standing proud of it.
      const hg = new THREE.CylinderGeometry(R * 0.44, R * 0.44, width * 0.6, 10, 1).rotateZ(Math.PI / 2).translate(dx, 0, 0);
      wb.add(hg, hubMat || this.m.hub);
    }
    wb.build(w);
    holder.add(w);
    // Which of the flight model's three gear points carries this wheel, in
    // its order (nose, left, right) — by the side of the centreline it is on.
    const gp = Math.abs(c[0]) < 0.05 ? 0 : c[0] < 0 ? 1 : 2;
    if (rec.swing) rec.swing.reach = Math.max(0.2, Math.abs(c[0] - rec.leg.position.x));
    this.gear.wheels.push({ obj: w, R, parent, baseY: parent.position.y, gp, slide: !rec.swing && !rec.lift });
    return { wheel: w, holder, parent };
  }

  /** Register a lamp: 'navL', 'navR', 'tail', 'strobeL', 'strobeR', 'beacon', 'landing'. */
  lamp(kind, at) {
    const spec = {
      navL: [0xff2020, 0.42],
      navR: [0x20ff40, 0.42],
      tail: [0xffffff, 0.3],
      strobeL: [0xffffff, 0.8],
      strobeR: [0xffffff, 0.8],
      beacon: [0xff3010, 0.5],
      beacon2: [0xff3010, 0.45],
      landing: [0xfff0c0, 0.75],
    }[kind];
    const s = glowSprite(spec[0], spec[1]);
    s.position.set(at[0], at[1], at[2]);
    s.userData.baseScale = s.scale.x;
    this.root.add(s);
    this.lamps[kind] = s;
    return s;
  }

  /**
   * A spoiler panel lying on the wing's upper surface, hinged along its
   * forward edge. `stations` are the wing's own ({ s, chord, le, y, thick? },
   * see civil-kit wing()), `t` and `m` its thickness and camber, so the
   * panel sits on the very surface the wing was lofted to; s0..s1 along the
   * span, e0..e1 of the chord. `side` 'right' | 'left'. One quad.
   */
  addSpoiler({ stations, s0, s1, e0 = 0.6, e1 = 0.74, t = 0.11, m = 0, side = 'right' }) {
    const sx = side === 'left' ? -1 : 1;
    const at = (s) => {
      let i = 0;
      while (i < stations.length - 2 && stations[i + 1].s < s) i++;
      const a = stations[i];
      const b = stations[i + 1];
      const k = clamp((s - a.s) / Math.max(1e-6, b.s - a.s), 0, 1);
      return { chord: lerp(a.chord, b.chord, k), le: lerp(a.le, b.le, k), y: lerp(a.y, b.y, k), thick: lerp(a.thick ?? 1, b.thick ?? 1, k) };
    };
    const upper = (s, e) => {
      const w = at(s);
      return new THREE.Vector3(sx * s, w.y + w.chord * (naCamber(e, m) + naThick(e, t * w.thick)) + 0.012, w.le + w.chord * e);
    };
    const p00 = upper(s0, e0);
    const p10 = upper(s1, e0);
    const pivot = p00.clone();
    const dir = p10.clone().sub(pivot).normalize();
    const g = new THREE.Group();
    g.name = `${side} spoiler`;
    g.position.copy(pivot);
    g.quaternion.setFromUnitVectors(X_AXIS, dir);
    const inv = g.quaternion.clone().invert();
    const corners = [p00, p10, upper(s1, e1), upper(s0, e1)].map((p) => p.sub(pivot).applyQuaternion(inv));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(corners.flatMap((p) => [p.x, p.y, p.z]), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    // Upper face out: the port side is the mirror, so its winding flips.
    geo.setIndex(sx > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
    geo.computeVertexNormals();
    const mat = this.m.spoiler || (this.m.spoiler = Object.assign(this.m.matte.clone(), { side: THREE.DoubleSide, name: 'civil_spoiler' }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'spoiler panel';
    mesh.castShadow = true;
    g.add(mesh);
    this.root.add(g);
    // Trailing edge up is a turn about the hinge: negative on the right, where local X points outboard; positive on the left.
    // Flat on the wing until it rises: hidden (no draw call) until then, see updateCivil.
    g.visible = false;
    this.spoilers.push({ obj: g, sign: -sx, restQ: g.quaternion.clone() });
    return g;
  }

  /**
   * A wheel-well door hinged along one edge at `hinge` (aircraft coordinates,
   * the edge running fore-and-aft), `width` across, `length` along, swinging
   * down and out. `sign` +1 for a door whose hinge is on its +x edge (a right
   * main's outboard door, a nose bay's starboard door), -1 the other way.
   * Open while the gear travels, shut at both ends — see updateCivil.
   */
  addBayDoor({ hinge, width, length, sign = 1, mat = null }) {
    const g = new THREE.Group();
    g.name = 'bay door';
    g.position.set(hinge[0], hinge[1], hinge[2]);
    const geo = new THREE.BoxGeometry(width, 0.025, length);
    geo.translate(-sign * width * 0.5, 0, 0);
    const mesh = new THREE.Mesh(geo, mat || this.m.body);
    mesh.name = 'bay door panel';
    mesh.castShadow = true;
    g.add(mesh);
    this.root.add(g);
    // Shut until the gear moves: hidden until then (updateCivil shows it while it is open). Seated on the skin at finish().
    g.visible = false;
    this.bayDoors.push({ obj: g, sign });
    return g;
  }

  /**
   * A turbofan's thrust reverser: the aft part of the fan cowl as a sleeve
   * that slides aft on the landing roll, uncovering a dark cascade. `at` is
   * the cowl's front centre, `radius` and `length` the cowl's (jetNacelle).
   */
  addReverser({ at, radius: r, length: L }) {
    const [x, y, z] = at;
    // The cascade: static, a touch proud of the cowl, under the sleeve's forward part when stowed.
    this.put(turned([[r * 1.012, L * 0.44], [r * 0.985, L * 0.57]], 14), this.m.dark, { p: [x, y, z] });
    const g = new THREE.Group();
    g.name = 'reverser sleeve';
    g.position.set(x, y, z);
    const sleeve = turned([[r * 1.035, L * 0.44], [r * 1.03, L * 0.6], [r * 0.93, L * 0.8]], 14);
    const mesh = new THREE.Mesh(sleeve, this.m.nacelle || this.m.body);
    mesh.name = 'reverser sleeve skin';
    mesh.castShadow = true;
    g.add(mesh);
    this.root.add(g);
    this.reversers.push({ obj: g, travel: L * 0.15, z0: z });
    return g;
  }

  /**
   * The fan behind a turbofan's intake, spinning with the engine: a ring of
   * blades as one mesh, turning about local Z at `at` (the fan face centre).
   */
  addFan({ at, radius: r, blades = 12 }) {
    const g = new THREE.Group();
    g.name = 'fan';
    g.position.set(at[0], at[1], at[2]);
    const bat = new Batch('fan');
    // Two triangles a blade, both faces drawn: the fan is seen from ahead and, through the bypass, from behind.
    const mat = this.m.fan || (this.m.fan = Object.assign(this.m.metal.clone(), { side: THREE.DoubleSide, name: 'civil_fan' }));
    for (let k = 0; k < blades; k++) {
      const a = (k / blades) * Math.PI * 2;
      const geo = new THREE.PlaneGeometry(r * 0.1, r * 0.6);
      geo.translate(0, r * 0.42, 0);
      geo.rotateY(0.45);
      geo.rotateZ(a);
      bat.add(geo, mat);
    }
    bat.build(g, { castShadow: false });
    this.root.add(g);
    this.fans.push({ obj: g });
    return g;
  }

  /**
   * Finish: merge the static parts, hang the landing light, wire update().
   * `spot` is where the landing light's beam starts.
   */
  finish({ spot = [0, 0.3, -1.6], landingLight = true } = {}) {
    const S = this.S;
    this.static.build(this.root);
    for (const rec of this.gear.legs) rec.bat.build(rec.leg);
    // The wheel-well doors onto the skin that is really above them (bay-door-seat.js): the legs, the doors and the other moving parts are not skin.
    if (this.bayDoors.length) {
      const notSkin = new Set();
      for (const rec of this.gear.legs) rec.leg.traverse((o) => notSkin.add(o));
      for (const list of [this.bayDoors, this.spoilers, this.reversers, this.fans]) for (const d of list) d.obj.traverse((o) => notSkin.add(o));
      seatDoorsOnSkin(this.root, this.bayDoors, (o) => notSkin.has(o) || !!(o.material && o.material.transparent));
    }

    // See model.js buildCivil: a parked aeroplane can be built without it.
    let landingSpot = null;
    if (landingLight) {
      landingSpot = new THREE.SpotLight(0xfff0c8, 0, 260, 0.34, 0.45, 1.2);
      landingSpot.position.set(spot[0], spot[1], spot[2]);
      const spotTarget = new THREE.Object3D();
      spotTarget.position.set(spot[0], spot[1] - 0.7, spot[2] - 60);
      this.root.add(spotTarget);
      landingSpot.target = spotTarget;
      this.root.add(landingSpot);
    }

    const state = {
      type: this.type,
      shape: S,
      surfaces: this.surfaces,
      props: this.props,
      rotor: this.rotor,
      rotors: this.rotors,
      gear: this.gear,
      lamps: this.lamps,
      landingSpot,
      nozzles: this.nozzles,
      spoilers: this.spoilers,
      bayDoors: this.bayDoors,
      reversers: this.reversers,
      fans: this.fans,
      // The spoilers' and reversers' own positions (0..1), the wheels' own
      // spin (rad/s) and how long the aeroplane has been off the ground.
      spoiler: 0,
      reverser: 0,
      wheelOmega: 0,
      fanAngle: 0,
      airborneT: 0,
      wheelAngle: 0,
      strobeT: 0,
      spool: -1,
      qTmp: new THREE.Quaternion(),
      retractable: !!S.retractable,
      // The flight model's gear points, in its order and in shape units, with
      // the travel types.js gives each (0.2 nose, 0.26 mains, times scale).
      contacts: [
        { x: S.nose.x, y: S.nose.y, z: S.nose.z, travel: 0.2 },
        { x: -S.main.x, y: S.main.y, z: S.main.z, travel: 0.26 },
        { x: S.main.x, y: S.main.y, z: S.main.z, travel: 0.26 },
      ],
      squash: [0, 0, 0],
    };
    const root = this.root;
    root.userData.parts = state;
    const updaters = this.updaters;
    root.userData.update = updaters.length
      ? (dt, ac, weather) => {
        updateCivil(state, dt || 0, ac || REST, weather);
        for (let i = 0; i < updaters.length; i++) updaters[i](dt || 0);
      }
      : (dt, ac, weather) => updateCivil(state, dt || 0, ac || REST, weather);
    // Doors that open and the flight deck's glazing outline, in metres in
    // the model's frame — the same contract as the fleet's airliners.
    if (this.doors) root.userData.doors = this.doors;
    if (this.flightDeck) root.userData.flightDeck = this.flightDeck;
    root.userData.inspiration = 'Original ' + String(this.type.class || '').toLowerCase() + ' proportions; not a licensed replica.';
    // Which airframe drew this, for the tests: the generic factory in
    // model.js is the fallback if a civil build throws, and silently
    // measuring the fallback is how the wrong aeroplane gets signed off.
    root.userData.civil = this.type.id;
    // Built in shape units, then sized. The flight model's contact points are
    // scaled by the same number in types.js.
    root.scale.setScalar(S.scale);
    // One pass at rest, so a model that is never updated (a thumbnail, a
    // test) is still in a sensible pose rather than whatever the build left.
    root.userData.update(0, REST, null);
    return root;
  }
}

/* ------------------------------------------------------------------ *
 * Animation
 * ------------------------------------------------------------------ */

const REST_CONTROLS = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 0 };
const REST = { controls: REST_CONTROLS, rpm: 0, flaps: 0, gearPos: 1, onGround: true, groundSpeed: 0, engineOn: false, agl: 0 };

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** The y component of vector (x, y, z) turned by quaternion q — no allocation. */
function rotatedY(q, x, y, z) {
  const qx = q.x;
  const qy = q.y;
  const qz = q.z;
  const qw = q.w;
  // t = 2 (q.xyz x v); v' = v + w t + q.xyz x t
  const tx = 2 * (qy * z - qz * y);
  const tz = 2 * (qx * y - qy * x);
  const ty = 2 * (qz * x - qx * z);
  return y + qw * ty + (qz * tx - qx * tz);
}

function updateCivil(st, dt, ac, weather) {
  const c = ac.controls || REST_CONTROLS;
  const pitch = num(c.pitch, 0);
  const roll = num(c.roll, 0);
  const yaw = num(c.yaw, 0);
  const rpm = num(ac.rpm, 0);
  const onGround = ac.onGround !== false;
  const groundSpeed = num(ac.groundSpeed, 0);
  const running = !!ac.engineOn || rpm > 0.05;
  const k12 = clamp(dt * 12, 0, 1);
  const k6 = clamp(dt * 6, 0, 1);
  // At rest (dt 0) snap straight to the target rather than easing.
  const ease = dt > 0 ? k12 : 1;
  const easeFlap = dt > 0 ? k6 : 1;

  /* Propellers: spin, and fade to the blur disc as they wind up. */
  if (st.props.length) {
    // 42 rev/s at full power, drawn at no more than visRev allows for
    // this many blades.
    const blur = clamp((rpm - 0.22) / 0.45, 0, 1);
    for (let i = 0; i < st.props.length; i++) {
      const p = st.props[i];
      p.angle = (p.angle + Math.min(rpm * 42, visRev(p.blades)) * dt * Math.PI * 2) % (Math.PI * 2);
      p.spin.rotation.z = p.angle * p.dir;
      p.spin.visible = blur < 0.98;
      p.disc.visible = blur > 0.01;
      p.disc.rotation.z = p.angle * p.dir;
      p.disc.userData.opacity = blur;
    }
  }

  /* The rotor(s): spool up and down like a turbine, not like a light switch. */
  const rotors = st.rotors || (st.rotor ? [st.rotor] : null);
  if (rotors && rotors.length) {
    /*
     * The rotor's own speed when the flight model says (ac.rotor.nr, from
     * rotor-assist.js): engine out, a windmilling rotor keeps turning, and
     * the blades on screen must too. Without it, the old spool: ~3 s up,
     * ~8 s to wind down.
     */
    const RR = ac.rotor;
    const nrKnown = RR && Number.isFinite(RR.nr);
    if (st.spool < 0) st.spool = nrKnown ? clamp(RR.nr, 0, 1.1) : running ? (onGround ? 0.25 : 1) : 0;
    if (nrKnown) {
      st.spool = lerp(st.spool, clamp(RR.nr, 0, 1.1), clamp(dt * 4, 0, 1));
    } else {
      const target = running ? 1 : 0;
      const rate = target > st.spool ? 0.35 : 0.12;
      st.spool = st.spool + clamp(target - st.spool, -rate * dt, rate * dt);
    }
    // What the blades are lifting: the collective the rotor is actually at
    // (assist and all) when it is published, the engine's rpm otherwise.
    const coll = RR && Number.isFinite(RR.collective) ? clamp(RR.collective, 0, 1) : clamp(rpm, 0, 1);
    /*
     * Blades while it winds up, the disc once it is turning — and the disc
     * is dark enough to see (blurTexture). It was switched on this spool
     * figure before too, three seconds after start whatever the collective,
     * and then it was the disc that could not be seen. Drawn at full
     * strength from three-quarters spool: a rotor turning is a rotor you
     * can see, on the ground at idle and in the hover.
     */
    const blur = clamp((st.spool - 0.3) / 0.45, 0, 1);
    const flapV = clamp(groundSpeed / 40, 0, 1);
    for (let k = 0; k < rotors.length; k++) {
      const R = rotors[k];
      const w = st.spool * R.hz * Math.PI * 2;
      const dir = R.dir || 1;
      R.spin.rotation.y = (R.spin.rotation.y + dir * Math.min(w, visRev(R.coners.length) * Math.PI * 2) * dt) % (Math.PI * 2);
      R.blades.visible = blur < 0.97;
      R.disc.visible = blur > 0.01;
      R.disc.userData.opacity = blur;
      /*
       * Blades droop at rest and cone up with the collective — and FLAP:
       * once a turn, the blade coming forward into the airflow lifts and the
       * one going back drops (blowback), and the whole disc leans back the
       * faster it flies. Each blade's own azimuth, so two blades a turn
       * apart are a turn apart.
       */
      const cone = lerp(R.droop, lerp(0.02, R.cone, coll), clamp(st.spool * 1.6, 0, 1));
      const flapAmp = (R.flap || 0) * flapV * clamp(st.spool * 1.6, 0, 1);
      const n = R.coners.length;
      for (let i = 0; i < n; i++) {
        const psi = R.spin.rotation.y + (i / n) * Math.PI * 2;
        R.coners[i].rotation.z = cone + flapAmp * Math.cos(psi);
      }
      // The disc leans the way the cyclic is pushed — the reason it moves.
      // controls.pitch is +1 for stick BACK (input.js: pitchUp), and a turn
      // about +X by a positive angle lifts the front of the disc, so the lean
      // is +pitch. It was -pitch: pushing forward tipped the disc BACK, its
      // front 0.67 m higher than its back measured 3.75 m either side of the
      // hub (tests/features/civil.mjs now measures it that way).
      // Rolling right (+1) needs the right side down: a negative turn about Z.
      // And the blowback: the disc flaps back a little with the airspeed.
      const tilt = R.tilt * clamp(st.spool * 2, 0, 1);
      R.head.rotation.x = lerp(R.head.rotation.x, pitch * tilt + flapAmp * 0.5, ease);
      R.head.rotation.z = lerp(R.head.rotation.z, -roll * tilt, ease);
      if (R.tail) {
        R.tail.rotation.x = (R.tail.rotation.x + (R.tailDir || 1) * Math.min(w * 5.2, visRev(R.tailCount) * Math.PI * 2) * dt) % (Math.PI * 2);
        R.tailBlades.visible = blur < 0.97;
        R.tailDisc.visible = blur > 0.01;
        R.tailDisc.userData.opacity = blur;
      }
    }
  }

  /* Jet nozzles warm with power. */
  if (st.nozzles.length) {
    const heat = clamp((rpm - 0.35) / 0.65, 0, 1);
    for (const m of st.nozzles) m.emissiveIntensity = heat * 2.4;
  }

  /* Control surfaces. Positive angle is trailing edge down (or right, for a
   * rudder) about each surface's own hinge line. */
  const flaps = num(ac.flaps, 0);
  const q = st.qTmp;
  for (let i = 0; i < st.surfaces.length; i++) {
    const s = st.surfaces[i];
    let want = 0;
    let k = ease;
    switch (s.kind) {
      case 'elevator':
        want = -pitch * 0.4;
        break;
      case 'rudder':
        want = yaw * 0.42;
        break;
      case 'aileronL':
        want = roll * 0.36;
        break;
      case 'aileronR':
        want = -roll * 0.36;
        break;
      case 'flap':
        want = flaps * 0.62;
        k = easeFlap;
        break;
      default:
        break;
    }
    const cur = s.obj.userData.angle || 0;
    const next = lerp(cur, want, k);
    s.obj.userData.angle = next;
    s.obj.quaternion.copy(s.q0).multiply(q.setFromAxisAngle(X_AXIS, next));
  }

  /* Gear: fold about each leg's own axis, hide when stowed. */
  const g = st.retractable ? clamp(num(ac.gearPos, 1), 0, 1) : 1;
  for (let i = 0; i < st.gear.legs.length; i++) {
    const L = st.gear.legs[i];
    if (!L.angle) continue;
    L.leg.quaternion.setFromAxisAngle(L.axis, (1 - g) * L.angle);
    L.leg.visible = g > 0.02;
  }
  /* The wheel-well doors: open while a leg travels, shut once it is stowed
   * and shut again once it is down and locked. */
  if (st.bayDoors.length) {
    const open = st.retractable ? clamp(Math.min(g, 1 - g) * 8, 0, 1) : 0;
    for (let i = 0; i < st.bayDoors.length; i++) {
      const d = st.bayDoors[i];
      d.obj.rotation.z = lerp(d.obj.rotation.z, d.sign * open * 1.45, ease);
      // Shut, it lies flush under the skin: hidden, so it costs no draw call (as in fleet/aircraft-realism.js).
      d.obj.visible = Math.abs(d.obj.rotation.z) > 0.01;
    }
  }
  if (onGround) st.airborneT = 0;
  else st.airborneT += dt;
  /* Spoilers: ground spoilers full on the landing roll with the throttle
   * closed (the auto-spoilers); in the air the brakes are the speedbrake. */
  if (st.spoilers.length) {
    const throttle = num(c.throttle, 0);
    const brakes = num(c.brakes, 0);
    let want = 0;
    if (Number.isFinite(ac.spoilerPos)) want = clamp(ac.spoilerPos, 0, 1); // the pilot's lever and the armed ground spoilers (physics.js, systems.js)
    else if (onGround && groundSpeed > 18 && throttle < 0.3) want = 1;
    else if (!onGround && brakes > 0.2 && st.airborneT > 1) want = 0.5;
    const rate = want > st.spoiler ? 0.8 : 1.2;
    st.spoiler = dt > 0 ? st.spoiler + clamp(want - st.spoiler, -rate * dt, rate * dt) : want;
    // About the hinge line itself (the group's own X), not rotation.x — that turns about the parent's X and swings a swept hinge off the wing.
    for (let i = 0; i < st.spoilers.length; i++) {
      const sp = st.spoilers[i];
      sp.angle = sp.sign * st.spoiler * 0.85;
      sp.obj.quaternion.copy(sp.restQ).multiply(st.qTmp.setFromAxisAngle(X_AXIS, sp.angle));
      sp.obj.visible = st.spoiler > 1e-3;
    }
  }
  /* Reversers: out on the roll with the brakes on, in again below taxi speed. */
  if (st.reversers.length) {
    const brakes = num(c.brakes, 0);
    let want = st.reverser;
    if (Number.isFinite(ac.reverse)) want = ac.reverse > 0 ? 1 : 0; // the pilot's reverser lever (physics.js, systems.js)
    else {
      if (onGround && groundSpeed > 25 && brakes > 0.25) want = 1;
      if (!onGround || groundSpeed < 17 || brakes < 0.05) want = 0;
    }
    st.reverser = dt > 0 ? st.reverser + clamp(want - st.reverser, -dt / 1.2, dt / 1.2) : want;
    for (let i = 0; i < st.reversers.length; i++) {
      const r = st.reversers[i];
      r.obj.position.z = r.z0 + r.travel * st.reverser;
    }
  }
  /* The fans turn with the engine. */
  if (st.fans.length) {
    st.fanAngle = (st.fanAngle + rpm * 120 * dt) % (Math.PI * 2);
    for (let i = 0; i < st.fans.length; i++) st.fans[i].obj.rotation.z = st.fanAngle;
  }
  /*
   * Squash: the oleos give under the aeroplane's weight.
   *
   * The drawn tyres sit on the flight model's gear points, and those are the
   * points at FULL extension. Standing on the runway the springs compress —
   * which is the physics working — and nothing drawn gave, so every wheel
   * sank into the tarmac by the compression: measured in the game, the
   * Skylark's lowest point 0.129 m under the runway on 0.235 m tyres, the
   * Skyhook's skids 0.159 m. The compression is not handed to the model, so
   * it is worked out here the way the flight model works it out — each gear
   * point put through the aeroplane's attitude, against the ground under the
   * aeroplane — and each wheel rises by it. Only with a real pose to go on:
   * the apron's parked aeroplanes and the pursuers pass none.
   */
  const sq = st.squash;
  const acPos = ac.pos;
  const acQuat = ac.quat;
  const height = num(ac.agl, NaN);
  const wc = ac.wheelCompression;
  const sc0 = st.shape.scale;
  if (onGround && !ac.crashed && wc && Number.isFinite(wc.nose) && Number.isFinite(wc.left) && Number.isFinite(wc.right)) {
    // The flight model's own strut travel, per leg (physics.js writes it each step): exact, and it moves with the springs.
    sq[0] = clamp(wc.nose / sc0, 0, st.contacts[0].travel * 1.25);
    sq[1] = clamp(wc.left / sc0, 0, st.contacts[1].travel * 1.25);
    sq[2] = clamp(wc.right / sc0, 0, st.contacts[2].travel * 1.25);
  } else if (onGround && !ac.crashed && acPos && acQuat && Number.isFinite(height) && Number.isFinite(acPos.y)) {
    const sc = st.shape.scale;
    const groundY = acPos.y - height;
    for (let i = 0; i < 3; i++) {
      const c = st.contacts[i];
      const y = acPos.y + rotatedY(acQuat, c.x * sc, c.y * sc, c.z * sc);
      sq[i] = clamp((groundY - y) / sc, 0, c.travel * 1.25);
    }
  } else {
    sq[0] = sq[1] = sq[2] = 0;
  }
  for (let i = 0; i < st.gear.wheels.length; i++) {
    const w = st.gear.wheels[i];
    if (w.slide) w.parent.position.y = w.baseY + sq[w.gp];
  }
  for (let i = 0; i < st.gear.legs.length; i++) {
    const L = st.gear.legs[i];
    if (L.swing) L.leg.rotation.z = (L.swing.side * sq[L.swing.gp]) / L.swing.reach;
    // A rigid skid cannot meet three points; it rises by the most any of
    // them is pressed in, so nothing of it is under the ground.
    else if (L.lift) L.leg.position.y = L.baseY + Math.max(sq[0], sq[1], sq[2]);
  }

  const steerAng = -yaw * 0.5 * clamp(1 - groundSpeed / 40, 0.15, 1);
  for (let i = 0; i < st.gear.steer.length; i++) st.gear.steer[i].rotation.y = steerAng;
  /* Wheels: at the ground speed on the ground; in the air they wind down on
   * their own over a few seconds instead of stopping dead at lift-off. */
  if (st.gear.wheels.length) {
    const R0 = st.gear.wheels[0].R;
    if (onGround) st.wheelOmega = groundSpeed / R0;
    else st.wheelOmega *= dt > 0 ? Math.exp(-dt / 3.5) : 0;
    if (st.wheelOmega > 0.01) {
      st.wheelAngle = (st.wheelAngle + st.wheelOmega * dt) % (Math.PI * 2000);
      for (let i = 0; i < st.gear.wheels.length; i++) {
        const w = st.gear.wheels[i];
        w.obj.rotation.x = -st.wheelAngle * (R0 / w.R);
      }
    }
  }

  /* Lights: barely there by day, the whole show at night. */
  const dark = weather ? (weather.isNight ? 1 : weather.cond && weather.cond.cloud > 0.75 ? 0.55 : 0.18) : 0.5;
  st.strobeT += dt;
  // The double flash and the beacon's blink, or with Reduce flashing a soft,
  // dimmer pulse and a swell at the same rate (render/flash-safety.js).
  const strobe = strobeLevel(st.strobeT, 1.3, 0.06, 0.07);
  const beacon = blinkLevel(st.strobeT, 1.1, 0.35 / 1.1);
  const L = st.lamps;
  const agl = num(ac.agl, 0);
  // A wreck's lamps go out with it (see model-adapter.js updateLights: the strobe and taxi-light ground rules would flicker on a bouncing wreck).
  const lampsOn = running && !ac.crashed;
  const wantLanding = lampsOn && ((ac.gearDown ?? num(ac.gearPos, 1) > 0.5) || agl < 400);
  // Strobes once on the runway or in the air, as the checklist has it; on the
  // apron they stay off (they would blind the ramp). On the ground, slow, the
  // landing lamp is the taxi light: on, dimmer.
  const strobesOn = lampsOn && (!onGround || groundSpeed > 15);
  const taxi = onGround && groundSpeed < 15;
  // That is the automatic logic; the pilot's switches (aircraft/systems.js
  // resolveLamps: ac.lights, 'auto' | 'on' | 'off' per lamp) have the last word.
  const want = resolveLamps(ac.lights, {
    nav: lampsOn ? 1 : 0, beacon: lampsOn ? 1 : 0, strobe: strobesOn ? 1 : 0,
    landing: wantLanding && !taxi ? 1 : 0, taxi: wantLanding && taxi ? 1 : 0,
  }, { crashed: !!ac.crashed });
  const landingLit = Math.max(want.landing, want.taxi * 0.55);
  for (const k in L) {
    const s = L[k];
    let on = want.nav > 0;
    let lit = 1;
    if (k === 'strobeL' || k === 'strobeR') {
      lit = strobe;
      on = want.strobe > 0;
    } else if (k === 'beacon' || k === 'beacon2') {
      lit = beacon;
      on = want.beacon > 0;
    } else if (k === 'landing') {
      on = landingLit > 0;
      lit = landingLit;
    }
    s.visible = on && lit > 0.01;
    const boost = k === 'landing' ? 1.6 : 1;
    s.scale.setScalar(s.userData.baseScale * (0.55 + dark * 0.75) * boost);
    s.material.opacity = (0.35 + dark * 0.65) * lit;
  }
  if (st.landingSpot) st.landingSpot.intensity = landingLit * 190 * (0.25 + dark * 0.75);
}

export { X_AXIS, Y_AXIS, Z_AXIS };
