import { buildAircraft } from './aircraft-core.js';

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
  bodySegments: 14,
  body: [
    [-14, .045, .055, -.12],
    [-13.65, .28, .25, -.08],
    [-12.95, .66, .54, -.015],
    [-11.8, 1.04, .84, .04],
    [-10.4, 1.30, 1.16, .03],
    [-8.7, 1.37, 1.31, 0],
    [6.5, 1.37, 1.31, 0],
    [9.0, 1.20, 1.17, .08],
    [11.15, .79, .86, .19],
    [13.0, .34, .39, .35],
    [14, .035, .07, .46],
  ],
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
  passengerWindows: {
    count: 14, z0: -8.65, z1: 7.5, y: .42,
    rx: 1.355, width: .36, height: .46,
  },
  gear: {
    nose: [0, -2.48, -9.4], main: [2.4, -2.46, 1.1],
    noseRadius: .36, mainRadius: .48,
    retractable: true, dualMain: true, doors: true,
  },
  engines: [
    { id: 'leftEngine', kind: 'jet', x: -4.4, y: -1.48, z: -1.65, radius: .89, length: 3.8 },
    { id: 'rightEngine', kind: 'jet', x: 4.4, y: -1.48, z: -1.65, radius: .89, length: 3.8 },
  ],
  eye: [-.42, .91, -11.05],
  decorate(ctx) {
    const { group, panel, tube, box, materials } = ctx;
    const accent = materials.accent || materials.skin;
    const metal = materials.metal || materials.dark || accent;
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
    // Two restrained dorsal aerials sit on the airframe rather than floating
    // above it. Their attachment dependency follows the fuselage on impact.
    const aerial = group('communicationsAerials', 'Dorsal communications aerials', 5, 'fuselage');
    panel('forward-vhf-aerial', [
      [-.028, 1.31, -5.8], [-.028, 1.72, -5.51],
      [-.028, 1.72, -5.37], [-.028, 1.31, -5.19],
    ], accent, aerial);
    tube('aft-vhf-aerial', [0, 1.31, 4.4], [0, 1.83, 4.56], .026, metal, aerial, 5);
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
