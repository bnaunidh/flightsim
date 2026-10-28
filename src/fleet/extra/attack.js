/**
 * The A-10 Thunderbolt II, drawn at full size, the way ./fighters.js draws
 * the jets (../aircraft-combat.js's shape of entry): body stations lofted
 * into a skin, a wing, a tail, fins, a canopy, gear, engines, and a
 * `decorate(ctx)` for everything a trapezoid cannot say. Metres, -Z
 * forward, +Y up, origin at the centre of gravity, so the physics' gear
 * points in ../../aircraft/extra/attack.js are these same numbers.
 *
 * WHAT MAKES IT ITSELF, from the chase camera and from the ground:
 *
 *   - a slab-sided body with the bubble canopy well forward and high;
 *   - the GUN: the seven-barrel cannon under the nose, its muzzle ahead of
 *     the tip, offset a hair to the left so the firing barrel is on the
 *     centreline — which is why the nose wheel sits to the right;
 *   - a thick STRAIGHT wing, low, the outer panels with dihedral and
 *     drooped tips, with the main gear in pods under it and the pylons
 *     and a rocket pod hung under each side;
 *   - two fat fans in nacelles HIGH on the rear fuselage, on short pylons,
 *     ahead of the tail;
 *   - a twin tail: the tailplane with an upright fin at each tip.
 *
 * Proportions against the published A-10C figures: 17.53 x 16.26 m (span
 * x length), 4.47 m to the top of the fins; tests/features/fighters.mjs
 * re-measures them off the triangles. Plain grey; no insignia — this game
 * names no air force.
 */
import * as THREE from '../../vendor/three.module.js';
import { fighterPlate as plate, boxLoft, pipe, mirror, driveFlames, hotMaterial } from './fighters.js';

const a10 = {
  id: 'a10', name: 'A-10 Thunderbolt II', kind: 'fighter', massKg: 5200,
  paint: '#7e868d', accent: '#5a6168', registration: 'AF 10-07', bodySegments: 10,
  body: [
    [-7.85, 0.06, 0.06, -0.2], [-7.4, 0.34, 0.36, -0.15], [-6.6, 0.55, 0.6, -0.05], [-5.6, 0.66, 0.72, 0.05],
    [-4.4, 0.7, 0.82, 0.12], [-3.0, 0.72, 0.86, 0.12], [-1.0, 0.74, 0.88, 0.1], [1.2, 0.74, 0.86, 0.1],
    [3.4, 0.7, 0.8, 0.12], [5.4, 0.6, 0.66, 0.18], [7.0, 0.42, 0.44, 0.28], [7.9, 0.14, 0.14, 0.34],
  ],
  // Straight leading edge; the trailing edge tapers in on the outer panels.
  wing: { rootX: 0.74, span: 8.025, rootZ: -1.6, rootY: -0.45, rootChord: 3.1, tipChord: 2.0, sweep: 0,
    dihedral: 0.55, thickness: 0.5, tipThickness: 0.22, flaps: true, struts: false },
  tail: { rootX: 0.35, span: 2.52, rootZ: 5.9, rootY: 0.3, rootChord: 2.2, tipChord: 2.0, sweep: 0, dihedral: 0, thickness: 0.16, tipThickness: 0.1 },
  // Upright fins at the tailplane's tips.
  fin: { x: 2.8, rootZ: 5.7, rootY: 0.28, height: 2.6, rootChord: 2.5, tipChord: 1.7, sweep: 0.55, mirror: true, thickness: 0.14 },
  canopy: { kind: 'bubble', z0: -6.3, z1: -4.1, width: 0.55, height: 0.7, baseY: 0.74 },
  // The nose wheel to the right of the centreline (the gun is on it).
  gear: { nose: [0.35, -1.3, -5.0], main: [2.62, -1.15, 0.9], noseRadius: 0.3, mainRadius: 0.45,
    noseAttach: [0.35, -0.5, -4.85], mainAttach: [2.62, -0.5, 0.8], retractable: true, dualMain: false, doors: false },
  engines: [
    { id: 'leftEngine', kind: 'jet', x: -1.62, y: 1.15, z: 3.3, radius: 0.62, length: 3.4, dependsOn: 'fuselage' },
    { id: 'rightEngine', kind: 'jet', x: 1.62, y: 1.15, z: 3.3, radius: 0.62, length: 3.4, dependsOn: 'fuselage' },
  ],
  eye: [0, 1.05, -5.3], hook: false,
  decorate(ctx) {
    const { parts, materials: m, tube, box } = ctx;
    const hot = hotMaterial(ctx);
    for (const s of [-1, 1]) {
      const side = s < 0 ? 'left' : 'right';
      const wing = parts[`${side}Wing`];
      const eg = parts[`${side}Engine`];
      // The core's pylon reaches down to the wing; the A-10's is a short
      // one from the nacelle's inner face down onto the fuselage's flank.
      // The nacelles sit 1.62 m off the centreline (3.2 m apart, a clear
      // gap of air between each and the body, as on the real one; at 1.4
      // they touched the spine).
      if (eg) {
        for (const c of [...eg.children]) if (c.name === 'Engine support pylon') c.removeFromParent();
        boxLoft(ctx, `${side} engine pylon`, [
          mirror([[0.66, 0.5, 2.3], [0.66, 0.5, 4.4], [0.66, 0.86, 4.2], [0.66, 0.86, 2.55]], s),
          mirror([[1.2, 0.78, 2.3], [1.2, 0.78, 4.4], [1.2, 1.1, 4.2], [1.2, 1.1, 2.55]], s),
        ], m.skin, eg, { capStart: false, capEnd: false });
        // The hot core behind the fan: a dull glow at power.
        const core = new THREE.Mesh(ctx.model.userData.ownGeometry(new THREE.CircleGeometry(0.3, 10)), hot);
        core.name = `${side} exhaust core`;
        core.position.set(s * 1.62, 1.15, 3.3 + 1.7 - 0.02);
        core.castShadow = false;
        eg.add(core);
      }
      // Main gear pod under the wing: the wheel folds forward into it.
      pipe(ctx, `${side} gear pod`, s * 2.62, -0.62, [[-0.4, 0.06], [0.1, 0.34], [1.5, 0.36], [2.5, 0.22], [3.0, 0.04]], m.skin, wing, 8);
      // Drooped wingtip.
      plate(ctx, `${side} drooped tip`, mirror([[8.55, 0.56, -1.55], [8.55, 0.56, 0.35], [8.76, 0.14, 0.25], [8.76, 0.14, -1.4]], s), 0.06, m.wing, wing);
      // Three pylons a side, and a rocket pod on the middle one (the inner one is where the
      // heat-seeker pack hangs its missile: features/heatseek/fly.js stationsFor, 0.44 of the half-span).
      for (const x of [3.7, 4.7, 5.7]) {
        const t = (x - 0.74) / 8.025;
        const under = -0.45 + 0.55 * t - (0.5 - 0.28 * t) / 2;
        // The rocket pod's own pylon is named for it and kept out of the wing's static batch: under
        // the real skin (aircraft/real-models.js KEEP) the pod and the pylon it hangs from stay in
        // view together. Its root runs a little further up, so it meets the real wing's underside too.
        const pod = x === 4.7;
        const root = under + (pod ? 0.08 : 0.02);
        const py = plate(ctx, pod ? `${side} rocket pod pylon` : `${side} pylon`, mirror([[x, root, -1.15], [x, root, 0.35], [x, under - 0.42, 0.2], [x, under - 0.42, -0.95]], s), 0.1, m.skin, wing, 0);
        if (pod && py) py.userData.dynamic = true;
        if (pod) tube(`${side} rocket pod`, [s * x, under - 0.6, -1.7], [s * x, under - 0.6, 0.9], 0.19, m.dark, wing, 8);
      }
    }
    // The gun: the barrel cluster under the nose, the muzzle ahead of the tip.
    tube('cannon barrels', [-0.08, -0.5, -8.1], [-0.08, -0.5, -6.2], 0.12, m.dark, parts.nose, 8);
    tube('cannon muzzle', [-0.08, -0.5, -8.1], [-0.08, -0.5, -7.85], 0.15, m.metal, parts.nose, 8);
    // The gun's fairing along the lower nose, and the refuelling receptacle door ahead of the windscreen.
    box('cannon fairing', [0.5, 0.3, 1.8], [-0.08, -0.6, -6.5], m.skin, parts.nose);
    box('refuelling receptacle', [0.3, 0.03, 0.4], [0, 0.73, -6.9], m.dark, parts.nose);
    // The pitot ahead of the nose and the ladder door line.
    tube('nose pitot', [0.4, 0.15, -7.7], [0.4, 0.15, -8.1], 0.014, m.metal, parts.nose, 4);
    driveFlames(ctx, [], hot);
  },
  description: 'A slab-sided attack jet: bubble canopy forward, a seven-barrel cannon under the nose, a thick straight wing with drooped tips, gear pods and pylons, two fat fans in nacelles high on the rear fuselage, a twin tail with upright fins.',
  inspiration: 'Proportioned against the published A-10C dimensions; procedurally built, not a licensed replica.',
};

export const DEFINITIONS = [a10];
export const DRAWS = ['a10'];
