/**
 * The camera spot for every map's loading picture (read by page.js; the
 * format is written at the top of it). One entry per map id in maps.js.
 * The light is always the game's own 'sunset': the sun is low in the west
 * (azimuth 255), so a camera east of the subject looking west shoots into
 * the sun, one west of it looking east has the sun on its back.
 *
 * The subject (the vehicle, or `anchor`) is turned to `place`: [34, 42] unless the spot says otherwise, which is
 * above the title, the name of the aircraft and the tip (bottom left of the loading screen).
 *
 * Headings: 0 = north (-Z), 90 = east (+X). `chase` offsets are metres in a
 * frame that faces `frame` degrees: back (behind it; negative is in front),
 * right (to its right hand), up.
 */

const plane = (id, at, hdg, agl, extra = {}) => ({ kind: 'plane', id, at, hdg, agl, speed: 60, ...extra });
const heli = (at, hdg, agl, extra = {}) => plane('harrier', at, hdg, agl, { speed: 8, ...extra });
// A boat `out` metres outside the harbour and `side` metres to the right of the way out, heading in.
const boat = (out, side = 0, extra = {}) => ({ kind: 'boat', at: { harbour: 'mouth', out, side }, hdg: 'out', hdgAdd: 180, ...extra });
const van = (t, extra = {}) => ({ kind: 'car', at: { road: 'longest', t }, hdg: 'road', ...extra });
const sunCam = { chase: true, frame: 262, back: 30, right: 6, up: 3.5, lookUp: 3 };
const vanCam = { chase: true, back: 11, right: -2.5, up: 2.2, lookFwd: 30, lookUp: 2.5 };

export const SPOTS = {
  /* ---------------- flight ---------------- */
  kestrel: {
    fov: 44,
    place: null,
    vehicle: plane('skylark', [-700, 250], 262, 110, { bank: -6 }),
    cam: { chase: true, frame: 258, back: 55, right: 14, up: -4, lookRight: 20, lookUp: -9 },
  },
  meadow: {
    fov: 42,
    vehicle: plane('courier', [-1500, 500], 255, 60, { bank: 5 }),
    cam: { chase: true, frame: 255, back: 42, right: 10, up: -4, lookRight: 16, lookUp: 4 },
  },
  atoll: {
    fov: 48,
    place: [50, 42],
    vehicle: plane('tempest', [2400, 1500], 20, 90, { bank: -10 }),
    cam: { chase: true, back: 42, right: 20, up: 8, lookFwd: 40, lookUp: 0 },
  },
  fjord: {
    fov: 48,
    place: [56, 46],
    cond: 'cloudy',
    vehicle: plane('skylark', [1500, 0], 270, 150),
    cam: { chase: true, back: 40, right: -14, up: 6, lookFwd: 60, lookUp: 2 },
  },
  ember: {
    fov: 50,
    anchor: [2500, 500, -2400], // the volcano, not the Tempest
    place: [62, 42],
    vehicle: plane('tempest', [500, -150], 42, 230, { bank: -8 }),
    cam: { chase: true, back: 80, right: 45, up: 20, lookAt: [2100, 380, -1950] },
  },
  airbase: {
    fov: 46,
    place: [60, 44],
    vehicle: plane('f22', [-250, 10], 90, 3, { speed: 80 }),
    cam: { chase: true, frame: 270, back: -26, right: 5, up: 1.3, lookFwd: 0, lookUp: 3.5 },
  },
  gateway: {
    fov: 46,
    vehicle: plane('a380', [1300, -3500], 5, 80),
    cam: { chase: true, back: 95, right: 38, up: 12, lookFwd: 800, lookUp: 40 },
  },
  northwatch: {
    fov: 48,
    place: [58, 44],
    cond: 'cloudy',
    vehicle: plane('f35b', [0, -2700], 0, 170),
    cam: { chase: true, back: 42, right: 0, up: 9, lookFwd: 300, lookUp: 36 },
  },
  condor: {
    place: [60, 44],
    // From the west, with the sun on the cliff face: the Skylark coming in over the sea at the strip on top.
    fov: 44,
    vehicle: plane('skylark', [-1150, 0], 90, null, { y: 215 }),
    cam: { chase: true, back: 70, right: 18, up: 14, lookFwd: 250, lookUp: -8 },
  },

  /* ---------------- boat ---------------- */
  // Looking into the sun from the east: the harbour, the headland and the lighthouse in silhouette, the sun on the water.
  sennen: { fov: 46, vehicle: boat(300, -420, { hdgAdd: 150 }), cam: sunCam },
  skerries: { fov: 46, vehicle: boat(300, -420, { hdgAdd: 150 }), cam: sunCam },
  archipelago: { fov: 46, vehicle: boat(300, -420, { hdgAdd: 150 }), cam: sunCam },
  harbour: { fov: 46, vehicle: boat(300, -420, { hdgAdd: 150 }), cam: sunCam },
  lagoon: { fov: 46, vehicle: boat(300, -420, { hdgAdd: 150 }), cam: sunCam },
  longbank: { fov: 46, vehicle: boat(600, 380, { hdgAdd: 200 }), cam: sunCam },
  delta: { fov: 46, vehicle: boat(500, 380, { hdgAdd: 200 }), cam: sunCam },
  // Close, low, and a big sea.
  stormcoast: { fov: 54, cond: 'stormy', vehicle: boat(300), cam: { chase: true, back: 17, right: 4, up: 2.8, lookFwd: 90, lookUp: 9 } },

  /* ---------------- car ---------------- */
  drovers: { fov: 55, vehicle: van(0.3), cam: vanCam },
  cape: { fov: 55, vehicle: van(0.8), cam: { chase: true, frameAdd: 180, back: 12, right: 2.5, up: 1.6, lookUp: 1.4 } },
  cullen: { fov: 55, vehicle: van(0.2), cam: { chase: true, frameAdd: 180, back: 12, right: 2.5, up: 1.6, lookUp: 1.4 } },
  town: { fov: 55, vehicle: van(0.3), cam: vanCam },
  coastroad: { fov: 55, vehicle: van(0.3), cam: { chase: true, frameAdd: 180, back: 12, right: 2.5, up: 1.6, lookUp: 1.4 } },
  mountainpass: { fov: 55, vehicle: van(0.35), cam: { chase: true, frameAdd: 180, back: 12, right: 2.5, up: 1.6, lookUp: 1.4 } },

  /* ---------------- helicopter ---------------- */
  'kestrel-port': { fov: 46, vehicle: heli([900, 300], 212, 70), cam: { chase: true, back: 32, right: 10, up: 5, lookFwd: 200, lookUp: -6 } },
  // The ring of stacks on the horizon, against the sun.
  stacks: { fov: 46, vehicle: heli([0, -300], 255, 60), cam: { chase: true, back: 50, right: 12, up: 5, lookFwd: 300, lookUp: 12 } },
  rigs: { fov: 46, vehicle: heli([3000, -1800], 270, null, { y: 60 }), cam: { chase: true, back: 50, right: 14, up: 8, lookFwd: 300, lookUp: 12 } },
  // A high oblique on the flight deck, the island and what is parked on it, with the Skyhook coming in.
  // (The carrier is a kilometre and a half long: this is a kilometre off, low, with the Skyhook alongside.)
  carriergroup: { fov: 44, anchor: [5600, 40, -4200], place: [60, 46], carrier: true, vehicle: heli([4500, -4150], 78, null, { y: 60 }), cam: { chase: true, back: 70, right: 24, up: 9, lookAt: [5700, 55, -4100] } },
  firewatch: { fov: 46, cond: 'cloudy', vehicle: heli([-1200, 100], 5, 80), cam: { chase: true, back: 40, right: 12, up: 8, lookFwd: 400, lookUp: 40 } },
  ravencrag: { fov: 46, anchor: [0, 200, -5000], place: [58, 42], cond: 'cloudy', vehicle: heli([0, -3500], 0, 200), cam: { chase: true, back: 38, right: 14, up: 6, lookFwd: 300, lookUp: 30 } },
  meridian: { fov: 40, vehicle: heli([650, 450], 126, 110), cam: { chase: true, back: 40, right: 14, up: 8, lookFwd: 400, lookUp: 25 } },
};
