/**
 * Two distinct piston singles for Island Flight Simulator.
 * Full-size metres; +Y up, -Z forward. These are fictional aircraft with
 * recognisable trainer / retractable touring-aircraft construction.
 */
import { buildAircraft } from './aircraft-core.js';

function decorateTrainer(ctx) {
  const { materials: m, parts, tube, panel, box } = ctx;
  const cabin = parts.fuselage;
  const nose = parts.nose || cabin;
  const metal = m.metal || m.frame || m.paint;
  const dark = m.dark || m.rubber || m.paint;
  const paint = m.skin || m.paint || m.body;

  // Actual nose intake mouths are narrow cheeks under the cowling shoulder.
  for (const s of [-1, 1]) {
    panel(`Cowling cooling inlet ${s < 0 ? 'port' : 'starboard'}`,
      [[s * .09, .09, -3.50], [s * .31, .065, -3.41],
       [s * .29, -.075, -3.41], [s * .09, -.055, -3.50]], dark, nose);
    tube(`Exhaust outlet ${s}`, [s * .29, -.38, -2.43],
      [s * .32, -.55, -2.30], .033, metal, nose, 6);
    // Small flush hardware follows the cabin-side infill; broad black door
    // outlines made the airframe look toy-like, so seams stay in its texture.
    const x = s * .473;
    tube(`Flush door handle ${s}`, [x, .035, .02], [x, .035, .17], .011, metal, cabin, 5);
    tube(`Cabin boarding step support ${s}`, [s * .395, -.37, -.31], [s * .75, -.67, -.31], .023, metal, cabin);
    box(`Non-slip boarding step ${s}`, [.30, .030, .13], [s * .80, -.675, -.31], dark, cabin);
  }

  tube('Pitot mast', [-2.48, .86, -.72], [-2.48, .64, -.72], .017, metal, parts.leftWing);
  tube('Forward pitot tube', [-2.48, .64, -.72], [-2.48, .64, -1.0], .013, metal, parts.leftWing);
  tube('VHF antenna', [.17, .34, 1.20], [.17, .68, 1.48], .012, paint, cabin);
  tube('VHF antenna rear', [-.14, .26, 1.70], [-.14, .53, 1.91], .011, paint, cabin);
  // No decorative external tailwheel: both aircraft use tricycle gear.
}

function decorateCourier(ctx) {
  const { materials: m, parts, tube, panel, box } = ctx;
  const cabin = parts.fuselage;
  const nose = parts.nose || cabin;
  const metal = m.metal || m.frame || m.paint;
  const dark = m.dark || m.rubber || m.paint;
  const paint = m.skin || m.paint || m.body;
  // Recessed cooling slots follow the tapered six-cylinder cowling.
  for (const s of [-1, 1]) {
    panel(`Cowling ram-air slot ${s}`,
      [[s * .10, .12, -3.65], [s * .39, .075, -3.55],
       [s * .37, -.09, -3.55], [s * .10, -.065, -3.65]], dark, nose);
    tube(`Exhaust pipe ${s}`, [s * .28, -.40, -2.87],
      [s * .37, -.57, -2.60], .041, metal, nose, 6);
  }
  // Single passenger door on the starboard side and walk strips on wing roots.
  tube('Touring cabin door handle', [.509, .045, .13], [.509, .045, .30], .011, metal, cabin, 5);
  for (const s of [-1, 1]) {
    const wing = s < 0 ? parts.leftWing : parts.rightWing;
    panel(`Wing-root anti-slip walkway ${s}`,
      [[s * .62, -.235, -.32], [s * .96, -.215, -.29],
       [s * .99, -.215, .83], [s * .63, -.235, .89]], dark, wing);
  }
  tube('Retractable boarding step stem', [.43, -.31, .64], [.78, -.77, .76], .024, metal, cabin);
  box('Tourer boarding step', [.30, .035, .12], [.86, -.77, .78], dark, cabin);
  tube('Tourer pitot mast', [-2.25, -.19, -.95], [-2.25, -.41, -.95], .019, metal, parts.leftWing);
  tube('Tourer pitot tube', [-2.25, -.41, -.95], [-2.25, -.41, -1.23], .014, metal, parts.leftWing);
  tube('Swept VHF aerial', [.10, .39, 1.25], [.10, .74, 1.51], .012, paint, cabin);
  tube('Lower navigation aerial', [0, -.35, 1.62], [0, -.70, 1.86], .012, paint, cabin);
}

export const SKYLARK_172 = {
  id: 'skylark', name: 'Skylark 172', kind: 'trainer', massKg: 1100,
  paint: '#e8e9e4', accent: '#a33230', registration: 'N172IF',
  description: 'Four-seat high-wing piston trainer with a straight, strut-braced wing and fixed tricycle undercarriage.',
  inspiration: 'Recognisable Cessna 172-type high-wing proportions; original fictional livery and geometry.',
  bodySegments: 12,
  // Fine nose cap -> long mechanical cowling -> nearly parallel cabin -> tapered tailcone.
  // The upper cabin volume belongs to the framed glass, rather than a body ellipsoid.
  body: [
    [-3.60, .075, .085, -.025],
    [-3.41, .285, .245, -.035],
    [-3.10, .385, .305, -.035],
    [-2.36, .425, .355, -.045],
    [-1.69, .485, .385, -.065],
    [-1.25, .550, .430, -.105],
    [ .23, .550, .435, -.100],
    [ .88, .465, .450, -.045],
    [1.57, .340, .355, .000],
    [2.68, .205, .230, .055],
    [3.66, .105, .155, .105],
    [4.30, .035, .080, .115],
  ],
  wing: {
    rootX: .51, span: 4.99, rootZ: -.92, rootY: .87,
    rootChord: 1.62, tipChord: 1.12, sweep: .24, dihedral: .18,
    thickness: .14, tipThickness: .068, flaps: true, struts: true,
  },
  tail: {
    rootX: .14, span: 1.59, rootZ: 3.04, rootY: .20,
    rootChord: 1.15, tipChord: .63, sweep: .39, dihedral: .018,
    thickness: .080, tipThickness: .034,
  },
  fin: { rootZ: 2.89, rootY: .23, height: 1.29, rootChord: 1.40, tipChord: .63, sweep: .64 },
  canopy: { kind: 'cabin', z0: -1.68, z1: .89, width: .565, height: .57, baseY: .25 },
  gear: {
    nose: [0, -1.165, -2.13], main: [1.255, -1.14, .42],
    noseRadius: .215, mainRadius: .275, retractable: false, dualMain: false, doors: false,
  },
  engines: [{ id: 'engine', kind: 'prop', x: 0, y: -.015, z: -3.76,
    radius: .31, length: .58, propRadius: .965, blades: 2 }],
  eye: [-.255, .565, -.80], hook: false,
  decorate: decorateTrainer,
};

export const KESTREL_COURIER = {
  id: 'courier', name: 'Kestrel Courier', kind: 'tourer', massKg: 1560,
  paint: '#e1e3df', accent: '#243b4c', registration: 'N808KP',
  secondaryAccent: '#b18b42',
  description: 'Long-nosed, four-seat low-wing tourer with a tapered wing, three-blade propeller and retractable tricycle gear.',
  inspiration: 'Conventional Bonanza / retractable touring-single proportions with an original straight-tail configuration.',
  bodySegments: 12,
  body: [
    [-3.93, .065, .080, -.025],
    [-3.67, .300, .245, -.015],
    [-3.33, .420, .330, -.020],
    [-2.38, .475, .370, -.040],
    [-1.78, .520, .390, -.050],
    [-1.31, .585, .450, -.090],
    [ .24, .595, .465, -.080],
    [ .93, .505, .445, -.040],
    [1.66, .375, .365, .015],
    [2.79, .235, .260, .065],
    [3.77, .115, .170, .105],
    [4.52, .035, .080, .140],
  ],
  wing: {
    rootX: .56, span: 5.24, rootZ: -1.10, rootY: -.33,
    rootChord: 1.83, tipChord: .97, sweep: .51, dihedral: .42,
    thickness: .145, tipThickness: .059, flaps: true, struts: false,
  },
  tail: {
    rootX: .14, span: 1.74, rootZ: 3.07, rootY: .28,
    rootChord: 1.27, tipChord: .67, sweep: .45, dihedral: .055,
    thickness: .088, tipThickness: .037,
  },
  fin: { rootZ: 2.94, rootY: .27, height: 1.42, rootChord: 1.53, tipChord: .65, sweep: .76 },
  canopy: { kind: 'cabin', z0: -1.71, z1: 1.04, width: .615, height: .67, baseY: .24 },
  gear: {
    nose: [0, -1.245, -2.24], main: [1.50, -1.23, .49],
    noseRadius: .235, mainRadius: .300, retractable: true, dualMain: false, doors: true,
  },
  engines: [{ id: 'engine', kind: 'prop', x: 0, y: -.015, z: -4.08,
    radius: .33, length: .62, propRadius: 1.03, blades: 3 }],
  eye: [-.285, .61, -.85], hook: false,
  decorate: decorateCourier,
};

export const planeDefinitions = [SKYLARK_172, KESTREL_COURIER];
export function createSkylark172(options = {}) { return buildAircraft(SKYLARK_172, options); }
export function createKestrelCourier(options = {}) { return buildAircraft(KESTREL_COURIER, options); }
export const previewModels = [
  { id: 'plane-skylark', label: 'Skylark 172 · high-wing trainer', create: createSkylark172,
    updateState: { rpm: 0, gear: 1 }, damagePart: 'leftWing', preview: { warmup: .2, elevation: .30 } },
  { id: 'plane-courier', label: 'Kestrel Courier · low-wing tourer', create: createKestrelCourier,
    updateState: { rpm: 0, gear: 1 }, damagePart: 'leftWing', preview: { warmup: .2, elevation: .30 } },
];
