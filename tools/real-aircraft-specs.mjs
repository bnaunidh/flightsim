/**
 * The published figures the roster is measured against — one row per aircraft
 * id in src/aircraft/types.js, naming the real aeroplane each one is (or, for
 * the game's own designs, the real aeroplane it is closest to).
 *
 * Read by tools/aircraft-specs.mjs (which writes docs/aircraft-specs.md) and
 * by tests/features/aircraft-specs.mjs (which holds every type's game numbers
 * to a band of these). Manufacturer brochures and the usual references,
 * rounded; a figure marked in `approx` is an estimate (not published, or it
 * varies a lot with weight) and is held to a looser band or not at all.
 *
 * Units: kg, kN per engine (max, with reheat where there is one), kW per
 * engine for propellers (shaft power), m², m, knots (indicated, at a typical
 * landing weight for Vs0 / Vref), ft/min, ft, knots true for cruise, nm.
 *
 *   empty, mtow       operating empty weight, maximum take-off weight
 *   engines, thrust   number, and max thrust each (jets)
 *   power             shaft power each (propellers and the helicopter)
 *   wingArea, span    reference area and span (the rotor's diameter, for the helicopter)
 *   vs0               stalling speed, landing flap
 *   vr, vref          rotation and reference (approach) speeds
 *   vmo               the indicated-airspeed limit (Vne / Vmo)
 *   climb             initial rate of climb at sea level
 *   ceiling           service ceiling
 *   cruise            typical cruise, knots true
 *   range             typical range with payload
 *   fiction           the game's own design: `real` is the closest counterpart
 */
export const REAL_SPECS = {
  skylark: { real: 'Cessna 172S Skyhawk', empty: 767, mtow: 1111, engines: 1, power: 134, wingArea: 16.2, span: 11.0, vs0: 40, vr: 55, vref: 65, vmo: 163, climb: 730, ceiling: 14000, cruise: 124, range: 640 },
  courier: { real: 'Beechcraft Bonanza G36', fiction: true, empty: 1146, mtow: 1656, engines: 1, power: 224, wingArea: 16.8, span: 10.2, vs0: 59, vr: 71, vref: 80, vmo: 205, climb: 1230, ceiling: 18500, cruise: 176, range: 920 },
  meridian: { real: 'Embraer ERJ-145 (a 40-50 seat regional jet)', fiction: true, empty: 12114, mtow: 22000, engines: 2, thrust: 33.0, wingArea: 51.2, span: 20.0, vs0: 100, vr: 125, vref: 130, vmo: 320, climb: 2500, ceiling: 37000, cruise: 450, range: 1550, approx: ['vs0', 'vr', 'vref', 'climb'] },
  vanguard: { real: 'Dassault Mirage 2000C', fiction: true, empty: 7500, mtow: 17000, engines: 1, thrust: 95.1, wingArea: 41, span: 9.13, vs0: 110, vr: 150, vref: 160, vmo: 750, climb: 56000, ceiling: 59000, cruise: 500, range: 1000, approx: ['vs0', 'vr', 'vref', 'cruise', 'range'] },
  osprey: { real: 'LTV A-7E Corsair II', fiction: true, empty: 8676, mtow: 19050, engines: 1, thrust: 66.7, wingArea: 34.8, span: 11.8, vs0: 105, vr: 135, vref: 130, vmo: 600, climb: 15000, ceiling: 42000, cruise: 460, range: 1100, approx: ['vs0', 'vr', 'vref'] },
  tempest: { real: 'Lockheed P-3 Orion (the hurricane hunter)', fiction: true, empty: 35000, mtow: 64400, engines: 4, power: 3661, wingArea: 120.8, span: 30.4, vs0: 100, vr: 125, vref: 130, vmo: 405, climb: 1950, ceiling: 28300, cruise: 328, range: 2380, approx: ['vs0', 'vr', 'vref'] },
  nightjar: { real: 'Northrop B-2A Spirit', fiction: true, empty: 71700, mtow: 170600, engines: 4, thrust: 77, wingArea: 478, span: 52.4, vs0: 110, vr: 140, vref: 140, vmo: null, climb: null, ceiling: 50000, cruise: 480, range: 6000, approx: ['vs0', 'vr', 'vref'] },
  harrier: { real: 'Airbus H125 (AS350 B3e)', fiction: true, helicopter: true, empty: 1174, mtow: 2250, engines: 1, power: 632, wingArea: null, span: 10.69, vs0: null, vr: null, vref: null, vmo: 155, climb: 1670, ceiling: 23000, cruise: 133, range: 340 },
  f22: { real: 'Lockheed Martin F-22A Raptor', empty: 19700, mtow: 38000, engines: 2, thrust: 156, wingArea: 78.04, span: 13.56, vs0: 110, vr: 150, vref: 150, vmo: 800, climb: 62000, ceiling: 65000, cruise: 970, range: 1600, approx: ['vs0', 'vr', 'vref', 'vmo', 'climb', 'cruise'] },
  f35b: { real: 'Lockheed Martin F-35B Lightning II', empty: 14700, mtow: 27200, engines: 1, thrust: 191, wingArea: 42.7, span: 10.67, vs0: 105, vr: 140, vref: 145, vmo: 700, climb: 45000, ceiling: 50000, cruise: 550, range: 900, approx: ['vs0', 'vr', 'vref', 'vmo', 'climb', 'cruise'] },
  fa18: { real: 'McDonnell Douglas F/A-18C Hornet', empty: 10433, mtow: 23541, engines: 2, thrust: 79.2, wingArea: 38, span: 12.3, vs0: 115, vr: 150, vref: 135, vmo: 700, climb: 50000, ceiling: 50000, cruise: 570, range: 1089, approx: ['vs0', 'vr', 'vmo'] },
  massimo: { real: 'none — the game\'s own record racer (the F-22 is the nearest thing)', fiction: true, racer: true, empty: null, mtow: null, engines: 1, thrust: null, wingArea: null, span: null, vs0: null, vr: null, vref: null, vmo: null, climb: null, ceiling: 75000, cruise: null, range: null },
  tpose: { real: 'none — T-Pose Harrison flies on Air Massimo\'s numbers', fiction: true, racer: true, empty: null, mtow: null, engines: 1, thrust: null, wingArea: null, span: null, vs0: null, vr: null, vref: null, vmo: null, climb: null, ceiling: 75000, cruise: null, range: null },
  a320: { real: 'Airbus A320-200 (CFM56-5B4)', empty: 42600, mtow: 78000, engines: 2, thrust: 120, wingArea: 122.6, span: 35.8, vs0: 105, vr: 135, vref: 135, vmo: 350, climb: 2500, ceiling: 39100, cruise: 447, range: 3300, approx: ['vs0', 'vr', 'vref'] },
  b747: { real: 'Boeing 747-400 (CF6-80C2B1F)', empty: 183500, mtow: 396890, engines: 4, thrust: 258, wingArea: 541, span: 64.4, vs0: 115, vr: 160, vref: 145, vmo: 365, climb: 2000, ceiling: 45100, cruise: 490, range: 7260, approx: ['vs0', 'vr', 'vref', 'climb'] },
  a380: { real: 'Airbus A380-800 (GP7270)', empty: 277000, mtow: 575000, engines: 4, thrust: 311, wingArea: 845, span: 79.75, vs0: 115, vr: 155, vref: 140, vmo: 340, climb: 2000, ceiling: 43000, cruise: 488, range: 8000, approx: ['vs0', 'vr', 'vref', 'climb'] },
  b737: { real: 'Boeing 737 MAX 8 (LEAP-1B)', empty: 45070, mtow: 82190, engines: 2, thrust: 130, wingArea: 127, span: 35.92, vs0: 110, vr: 145, vref: 140, vmo: 340, climb: 2500, ceiling: 41000, cruise: 453, range: 3550, approx: ['vs0', 'vr', 'vref', 'climb'] },
  a321: { real: 'Airbus A321neo (PW1133G)', empty: 50100, mtow: 97000, engines: 2, thrust: 147, wingArea: 122.6, span: 35.8, vs0: 115, vr: 150, vref: 140, vmo: 350, climb: 2300, ceiling: 39800, cruise: 450, range: 4000, approx: ['vs0', 'vr', 'vref', 'climb'] },
  b787: { real: 'Boeing 787-9 Dreamliner (GEnx-1B74)', empty: 128850, mtow: 254011, engines: 2, thrust: 330, wingArea: 377, span: 60.12, vs0: 115, vr: 155, vref: 140, vmo: 350, climb: 2800, ceiling: 43100, cruise: 488, range: 7565, approx: ['vs0', 'vr', 'vref', 'climb'] },
  a350: { real: 'Airbus A350-900 (Trent XWB-84)', empty: 142400, mtow: 280000, engines: 2, thrust: 374, wingArea: 442, span: 64.75, vs0: 115, vr: 155, vref: 140, vmo: 340, climb: 2800, ceiling: 43100, cruise: 488, range: 8100, approx: ['vs0', 'vr', 'vref', 'climb'] },
  b777: { real: 'Boeing 777-300ER (GE90-115B)', empty: 167800, mtow: 351500, engines: 2, thrust: 513, wingArea: 436.8, span: 64.8, vs0: 120, vr: 165, vref: 145, vmo: 330, climb: 2500, ceiling: 43100, cruise: 490, range: 7370, approx: ['vs0', 'vr', 'vref', 'climb'] },
  q400: { real: 'De Havilland Canada Dash 8 Q400 (PW150A)', empty: 17819, mtow: 29574, engines: 2, power: 3781, wingArea: 63.1, span: 28.42, vs0: 85, vr: 110, vref: 115, vmo: 286, climb: 2000, ceiling: 27000, cruise: 360, range: 1100, approx: ['vs0', 'vr', 'vref', 'climb'] },
  concorde: { real: 'Aérospatiale/BAC Concorde (Olympus 593 Mk 610)', empty: 78700, mtow: 185070, engines: 4, thrust: 169.2, wingArea: 358.25, span: 25.6, vs0: 125, vr: 195, vref: 162, vmo: 400, climb: 5000, ceiling: 60000, cruise: 1165, range: 3900, approx: ['vs0', 'climb'] },
  belugaxl: { real: 'Airbus A330-743L BelugaXL (Trent 772B)', empty: 127500, mtow: 227000, engines: 2, thrust: 316, wingArea: 361.6, span: 60.3, vs0: 110, vr: 145, vref: 135, vmo: 330, climb: 2000, ceiling: 35000, cruise: 400, range: 2200, approx: ['vs0', 'vr', 'vref', 'climb'] },
  dreamlifter: { real: 'Boeing 747-400LCF Dreamlifter (PW4062)', empty: 180530, mtow: 364235, engines: 4, thrust: 282, wingArea: 541, span: 64.44, vs0: 115, vr: 160, vref: 145, vmo: 365, climb: 2000, ceiling: 40000, cruise: 474, range: 4200, approx: ['vs0', 'vr', 'vref', 'vmo', 'climb', 'ceiling'] },
  an225: { real: 'Antonov An-225 Mriya (D-18T)', empty: 285000, mtow: 640000, engines: 6, thrust: 229.5, wingArea: 905, span: 88.4, vs0: 120, vr: 150, vref: 140, vmo: 350, climb: 1500, ceiling: 36000, cruise: 430, range: 2500, approx: ['vs0', 'vr', 'vref', 'vmo', 'climb'] },
  c5: { real: 'Lockheed C-5M Super Galaxy (F138-GE-100)', empty: 172370, mtow: 381000, engines: 4, thrust: 225, wingArea: 576, span: 67.89, vs0: 110, vr: 140, vref: 130, vmo: 350, climb: 1800, ceiling: 35700, cruise: 450, range: 4800, approx: ['vs0', 'vr', 'vref', 'climb'] },
  b1b: { real: 'Rockwell B-1B Lancer (F101-GE-102)', empty: 87100, mtow: 216400, engines: 4, thrust: 136.9, wingArea: 181.2, span: 41.8, vs0: 130, vr: 165, vref: 150, vmo: 700, climb: 5000, ceiling: 60000, cruise: 500, range: 5100, approx: ['vs0', 'vr', 'vref', 'vmo', 'climb'] },
  c17: { real: 'Boeing C-17A Globemaster III (F117-PW-100)', empty: 128100, mtow: 265350, engines: 4, thrust: 180, wingArea: 353, span: 51.75, vs0: 100, vr: 130, vref: 115, vmo: 350, climb: 2100, ceiling: 45000, cruise: 450, range: 2420, approx: ['vs0', 'vr', 'climb'] },
  a10: { real: 'Fairchild Republic A-10C Thunderbolt II (TF34-GE-100)', empty: 11321, mtow: 23000, engines: 2, thrust: 40.3, wingArea: 47, span: 17.53, vs0: 120, vr: 140, vref: 135, vmo: 450, climb: 6000, ceiling: 45000, cruise: 300, range: 695, approx: ['vr', 'vref'] },
};
