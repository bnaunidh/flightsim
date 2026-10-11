import { buildAircraft } from './aircraft-core.js';
import { dressAirliner, refitAirlinerLeg, hullStation as st, ellipseStation as ell, bodyOf, ringsBetween } from './extra/airliners.js';

/*
 * The pack's Meridian (drawn when Settings turns the whole pack on), dressed
 * like the big three (./extra/airliners.js, brief item 1): its own loft with
 * a regional jet's long nose, the six-pane windscreen in black frames round
 * the (unchanged) eye, the livery painted for it, cabin windows, doors that
 * open, turbofans. Body, wing, gear, eye and engines' places are as they were.
 */
const MERIDIAN = {
  fuselage: {
    stations: [
      st(-14.0, -0.12, -0.12, 0, -0.12),
      st(-13.95, 0.06, -0.3, 0.2, -0.12),
      st(-13.8, 0.2, -0.45, 0.4, -0.12),
      st(-13.5, 0.33, -0.65, 0.65, -0.12),
      st(-13.0, 0.45, -0.88, 0.92, -0.1),
      st(-12.5, 0.53, -1.05, 1.1, -0.08),
      st(-12.15, 0.56, -1.14, 1.19, -0.06, 2.05),
      st(-11.95, 0.82, -1.19, 1.24, -0.04, 2.1),
      st(-11.72, 1.06, -1.23, 1.28, -0.02, 2.1),
      st(-11.3, 1.21, -1.27, 1.33, 0, 2.05),
      st(-10.6, 1.29, -1.3, 1.36, 0),
      st(-9.8, 1.31, -1.31, 1.37, 0),
      st(6.5, 1.31, -1.31, 1.37, 0),
      ell([9.0, 1.2, 1.17, 0.08]),
      ell([11.15, 0.79, 0.86, 0.19]),
      ell([13.0, 0.34, 0.39, 0.35]),
      ell([14, 0.035, 0.07, 0.46]),
    ],
    radial: 14,
    rings: ringsBetween(6.5, 14, 1.0),
    cuts: [-9.0, 6.5],
    alongKnots: [[-14, 0], [-9.0, 0.18], [14, 1]],
  },
  cabinZ: 0,
  bellyY: -0.85,
  laps: [0.95, -0.55],
  radomeZ: -12.3,
  cheat: { y0: -0.2, y1: 0.0, z0: -11.0, z1: 11.6 },
  reg: { z: 10.4, y: 0.62, w: 1.7 },
  // The titling band (schemes with words): above the windows, behind door 1.
  title: { z: -3.3, y: 0.95, w: 11 },
  frame: 0.05,
  panes: [
    { name: 'Windscreen', wiper: true, corners: [{ z: -12.15, x: 0.04 }, { z: -12.02, y: 0.58 }, { z: -11.74, y: 0.98 }, { z: -11.78, x: 0.04 }] },
    { name: 'Side window', corners: [{ z: -11.96, y: 0.58 }, { z: -11.45, y: 0.6 }, { z: -11.47, y: 1.04 }, { z: -11.68, y: 0.98 }] },
    { name: 'Rear side window', corners: [{ z: -11.38, y: 0.6 }, { z: -10.95, y: 0.62 }, { z: -11.02, y: 1.0 }, { z: -11.36, y: 1.05 }] },
  ],
  windows: [{ y: 0.42, z0: -8.65, z1: 7.0, pitch: 0.53, w: 0.24, ht: 0.34 }],
  doors: ['left', 'right'].flatMap((side) => [
    { id: `${side === 'left' ? 'L' : 'R'}1`, side, z: -9.45, y: 0.23, w: 0.8, h: 1.72, kind: 'passenger', sill: -0.63 },
    { id: `${side === 'left' ? 'L' : 'R'}2`, side, z: 7.6, y: 0.25, w: 0.72, h: 1.6, kind: 'passenger', sill: -0.55 },
  ]),
  fairing: [[-4.2, 1.0, 0.25, -1.1], [-2.5, 1.4, 0.45, -1.0], [0.5, 1.45, 0.48, -1.0], [2.0, 1.1, 0.3, -1.08], [2.8, 0.6, 0.15, -1.15]],
  aerials: { crown: [-5.8, 4.4], belly: [-7.6, -5.8] },
  beaconZ: -1.5,
};

// Original, metre-authored silhouettes. These replace scaled trainer geometry;
// they do not copy a real manufacturer's mesh, livery, or flight certification.
export const meridianDefinition = {
  id: 'meridian',
  name: 'Meridian 220',
  kind: 'airliner',
  massKg: 16500,
  paint: '#e8eae7',
  accent: '#164b71',
  registration: 'N220IF',
  bodySegments: 8,
  body: bodyOf(MERIDIAN.fuselage.stations),
  wing: {
    rootX: 1.25, span: 11.85, rootZ: -2.55, rootY: -.50,
    rootChord: 4.95, tipChord: 1.65, sweep: 4.55,
    dihedral: .70, thickness: .28, tipThickness: .065,
    flaps: true, struts: false,
  },
  tail: {
    rootX: .36, span: 4.08, rootZ: 9.4, rootY: 1.04,
    rootChord: 2.60, tipChord: .88, sweep: 1.80,
    dihedral: .20, thickness: .15, tipThickness: .05,
  },
  fin: {
    rootZ: 8.40, rootY: .9, height: 4.05,
    rootChord: 4.75, tipChord: 1.40, sweep: 2.85,
  },
  canopy: {
    kind: 'airliner', z0: -12.8, z1: -10.25,
    width: 1.02, height: .73, baseY: .46,
  },
  // The cabin windows are the airliner kit's now (MERIDIAN.windows).
  passengerWindows: null,
  gear: {
    nose: [0, -2.48, -9.4], main: [2.4, -2.46, 1.1],
    noseRadius: .36, mainRadius: .48,
    // The doors are the airliner kit's (refitAirlinerLeg), not the core's boxes.
    retractable: true, dualMain: true, doors: false,
  },
  engines: [
    { id: 'leftEngine', kind: 'jet', x: -4.4, y: -1.48, z: -1.65, radius: .89, length: 3.8 },
    { id: 'rightEngine', kind: 'jet', x: 4.4, y: -1.48, z: -1.65, radius: .89, length: 3.8 },
  ],
  eye: [-.42, .91, -11.05],
  decorate(ctx) {
    const { group, box, materials } = ctx;
    const { M } = dressAirliner(ctx, MERIDIAN);
    // The core's flight-deck panes go (the kit's glazing replaces them); its
    // seats, coaming and sticks inside the canopy group stay.
    const canopy = ctx.parts.canopy;
    if (canopy) for (const c of [...canopy.children]) if (/flight-deck pane|Window frame/.test(c.name)) c.removeFromParent();
    // Twin-wheel legs with the airliners' oleos, links and doors.
    refitAirlinerLeg(ctx, 'noseGear', { kind: 'dual', track: 0.42, r: 0.36, width: 0.22, oleo: 0.09, mats: M });
    for (const id of ['leftGear', 'rightGear']) refitAirlinerLeg(ctx, id, { kind: 'dual', track: 0.72, r: 0.48, width: 0.3, oleo: 0.12, mats: M });
    const accent = materials.accent || materials.skin;
    for (const side of [-1, 1]) {
      const hand = side < 0 ? 'left' : 'right';
      const tip = group(`${hand}Winglet`, `${hand} swept winglet`, 36, `${hand}Wing`);
      const winglet = box(`${hand}-winglet`, [1, 1, 1], [0, 0, 0], accent, tip);
      const positions = winglet.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const height = positions.getY(i) + .5;
        const chord = positions.getZ(i) + .5;
        const thickness = positions.getX(i) * .045;
        positions.setXYZ(i,
          side * (13.1 + .30 * height) + thickness,
          .20 + 1.52 * height,
          2.0 + .58 * height + (1.65 - .99 * height) * chord);
      }
      winglet.geometry.computeVertexNormals();
    }
    // The aerials are the airliner kit's now (MERIDIAN.aerials).
  },
  description: 'A slender regional twin jet with swept wings, underwing fan engines, retractable twin-wheel main gear and a framed flight deck.',
  inspiration: 'Original fictional 40-seat regional transport; regional-jet proportions rather than a scaled light-aircraft body.',
};

export const tempestDefinition = {
  id: 'tempest',
  name: 'Tempest WR-4',
  kind: 'research',
  massKg: 13500,
  paint: '#293f51',
  accent: '#c96a25',
  registration: 'WR04IF',
  bodySegments: 12,
  body: [
    [-9.5, .045, .06, -.05],
    [-9.12, .29, .28, -.03],
    [-8.3, .68, .57, 0],
    [-7.2, 1.03, .78, .03],
    [-5.8, 1.21, 1.16, .02],
    [-4.45, 1.24, 1.25, 0],
    [3.95, 1.24, 1.25, 0],
    [5.7, .96, .98, .15],
    [7.65, .49, .57, .34],
    [9.05, .15, .22, .52],
    [9.5, .025, .045, .58],
  ],
  wing: {
    rootX: 1.18, span: 10.82, rootZ: -2.1, rootY: 1.12,
    rootChord: 4.42, tipChord: 1.80, sweep: 1.10,
    dihedral: .39, thickness: .27, tipThickness: .075,
    flaps: true, struts: false,
  },
  tail: {
    rootX: .3, span: 3.85, rootZ: 5.65, rootY: 1.0,
    rootChord: 2.5, tipChord: .94, sweep: 1.20,
    dihedral: .1, thickness: .15, tipThickness: .05,
  },
  fin: {
    rootZ: 5.4, rootY: .83, height: 3.3,
    rootChord: 3.85, tipChord: 1.35, sweep: 1.95,
  },
  canopy: {
    kind: 'airliner', z0: -8.05, z1: -5.98,
    width: .94, height: .72, baseY: .41,
  },
  passengerWindows: {
    count: 8, z0: -4.1, z1: 3.35, y: .42,
    rx: 1.225, width: .39, height: .46,
  },
  gear: {
    nose: [0, -2.21, -6.0], main: [3.93, -2.20, .8],
    // Inside the aft nacelle skin: the cowling ends at z=.55, so placing
    // this at the wheel's z=.8 would leave the top of the leg unattached.
    mainAttach: [4.0, .42, -.35],
    noseRadius: .36, mainRadius: .45,
    retractable: true, dualMain: false, doors: true,
  },
  engines: [
    { id: 'leftEngine', kind: 'prop', x: -4.15, y: .80, z: -3.15, radius: .69, length: 3.7, propRadius: 1.85, blades: 6 },
    { id: 'rightEngine', kind: 'prop', x: 4.15, y: .80, z: -3.15, radius: .69, length: 3.7, propRadius: 1.85, blades: 6 },
  ],
  eye: [-.38, .9, -6.9],
  decorate(ctx) {
    const { group, panel, tube, box, materials } = ctx;
    const accent = materials.accent || materials.skin;
    const metal = materials.metal || materials.dark || accent;
    const paint = materials.skin;
    const probe = group('weatherProbe', 'Nose weather probe and sensors', 18, 'nose');
    tube('nose-weather-boom', [0, -.08, -9.22], [0, -.08, -10.90], .039, metal, probe, 6);
    tube('five-hole-probe-tip', [0, -.08, -10.90], [0, -.08, -11.17], .026, accent, probe, 5);
    tube('weather-probe-left-vane', [0, -.08, -10.86], [-.16, -.08, -10.92], .012, metal, probe, 4);
    tube('weather-probe-right-vane', [0, -.08, -10.86], [.16, -.08, -10.92], .012, metal, probe, 4);
    tube('weather-probe-top-vane', [0, -.08, -10.86], [0, .08, -10.92], .012, metal, probe, 4);

    for (const side of [-1, 1]) {
      const hand = side < 0 ? 'left' : 'right';
      const instruments = group(`${hand}WingSensors`, `${hand} wing research instruments`, 31, `${hand}Wing`);
      // Slender probe pods along the airflow; no weapon or ordnance fittings.
      box(`${hand}-sensor-pod`, [.20, .22, .82], [side * 8.0, 1.17, -.44], paint, instruments);
      tube(`${hand}-ice-sensor-probe`, [side * 8.0, 1.17, -.85], [side * 8.0, 1.17, -1.38], .023, metal, instruments, 5);
      panel(`${hand}-orange-tip-band`, [
        [side * 10.62, 1.53, -1.10], [side * 11.91, 1.55, -.99],
        [side * 11.91, 1.55, .82], [side * 10.62, 1.53, 1.14],
      ], accent, instruments);
    }
    const aerial = group('researchAerials', 'Dorsal research aerials', 8, 'fuselage');
    panel('dorsal-research-fin', [
      [-.035, 1.25, .35], [-.035, 1.75, .50],
      [-.035, 1.75, .68], [-.035, 1.25, 1.02],
    ], accent, aerial);
    tube('forward-research-aerial', [0, 1.25, -3.4], [0, 1.80, -3.25], .024, metal, aerial, 5);
  },
  description: 'A high-wing twin turboprop weather-research aircraft with two six-blade propellers, working landing gear and separate nose and wing instruments.',
  inspiration: 'Original fictional research transport with utility-turboprop proportions. WR-4 is a type designation, not an engine count.',
};

export function createMeridian220(options = {}) {
  return buildAircraft(meridianDefinition, options);
}

export function createTempestWR4(options = {}) {
  return buildAircraft(tempestDefinition, options);
}

export const planeDefinitions = [meridianDefinition, tempestDefinition];

export const previewModels = [
  { id: 'plane-meridian', label: 'Meridian 220 regional jet', create: createMeridian220,
    updateState: { rpm: 0, gear: 1 }, damagePart: 'leftWing', preview: { warmup: .2, elevation: .32 } },
  { id: 'plane-tempest', label: 'Tempest WR-4 weather research', create: createTempestWR4,
    updateState: { rpm: 0, gear: 1 }, damagePart: 'leftWing', preview: { warmup: .2, elevation: .32 } },
];
