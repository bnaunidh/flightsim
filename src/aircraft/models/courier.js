/**
 * Kestrel Courier — a quick low-wing single with retractable gear, the
 * Bonanza / Mooney kind of tourer.
 *
 * What was wrong with it (rendered from outside, before this file):
 *
 *  - The cabin was a glass shed: a flat roof on four straight posts, glazed
 *    right down to the wing root, with a sawtooth where the skin had been
 *    cut away along triangle edges instead of along the window line.
 *  - Flaps and ailerons were slabs lying on top of the wing.
 *  - The main legs came out of the fuselage and splayed out to the wheels,
 *    like a high-wing's. A low-wing retractable's legs hang straight down
 *    from the wing and fold inward into it.
 *  - The same round lathe body, tall plank fin and floating elevator slab
 *    as the trainer, and a two-blade propeller where a tourer has three.
 *
 * Gear contact points, eye, scale, wing tips and strike points unchanged.
 */
import { hull, wing, roundNose, tubePath, turned } from './civil-kit.js';
import { tailGroup, oleoLeg, tailBumper } from './civil-details.js';

export function buildCourier(b) {
  const { S, m } = b;
  const tipX = S.wingRootX + S.halfSpan;

  /* ---------------- Fuselage ---------------- */
  const stations = [
    ...roundNose(-2.52, 0.5, { w: 0.43, top: 0.3, bot: -0.42, yc: -0.04, nT: 2.3, nB: 2.4 }, { y: -0.02 }, 5),
    { z: -1.7, w: 0.5, top: 0.36, bot: -0.5, yc: -0.03, nT: 2.4, nB: 2.5 },
    { z: -1.3, w: 0.54, top: 0.39, bot: -0.54, yc: -0.02, nT: 2.4, nB: 2.6 },
    { z: -0.95, w: 0.57, top: 0.58, bot: -0.56, yc: 0.0, nT: 2.3, nB: 2.7 },
    { z: -0.6, w: 0.59, top: 0.73, bot: -0.56, yc: 0.02, nT: 2.3, nB: 2.7 },
    { z: 0.35, w: 0.58, top: 0.74, bot: -0.55, yc: 0.03, nT: 2.3, nB: 2.7 },
    { z: 1.05, w: 0.52, top: 0.62, bot: -0.5, yc: 0.04, nT: 2.2, nB: 2.5 },
    { z: 1.7, w: 0.42, top: 0.5, bot: -0.4, yc: 0.05, nT: 2.1, nB: 2.3 },
    { z: 2.5, w: 0.3, top: 0.42, bot: -0.24, yc: 0.08, nT: 2.1, nB: 2.2 },
    { z: 3.3, w: 0.2, top: 0.37, bot: -0.08, yc: 0.12, nT: 2.0, nB: 2.1 },
    { z: 4.1, w: 0.11, top: 0.33, bot: 0.06, yc: 0.17, nT: 2.0, nB: 2.0 },
    { z: 4.75, w: 0.045, top: 0.3, bot: 0.17, yc: 0.23, nT: 2.0, nB: 2.0 },
  ];
  const h = hull({
    stations,
    radial: 10,
    maxStep: 0.36,
    // The side glass starts 0.64 round from the top centreline. At 0.42 it
    // met over the cabin with only a 0.3 m strip of paint between, so from
    // above and from the chase view the roof was glass: a trainer's sliding
    // bubble, where a Bonanza-type tourer has a metal roof and side windows.
    lines: { ctr: 0.04, ws: 1.05, roof: 0.64, belt: 1.36 },
    windows: [
      { z0: -1.28, z1: -0.66, from: 'ctr', to: 'ws' },
      { z0: -0.6, z1: 0.06, from: 'roof', to: 'belt' },
      { z0: 0.12, z1: 0.66, from: 'roof', to: 'belt' },
      { z0: 0.72, z1: 1.12, from: 'roof', to: 'belt' },
    ],
  });
  b.addHull(h);
  /*
   * The firewall, seen only from the cockpit — the Skylark has had one since
   * its rebuild and this one did not. From the pilot's eye every ray more
   * than 3 degrees below the horizon left through the inside of the cowl,
   * where every face is culled: 207 of the 323 rays through the cockpit's
   * windscreen opening, a spinner turning over the runway with no aeroplane
   * in front of the panel.
   */
  b.put(h.capAt(-1.3), m.dark);

  /* ---------------- Wing ---------------- */
  const le0 = S.wingZ;
  const yAt = (s) => S.wingY + S.dihedral * Math.max(0, (s - S.wingRootX) / S.halfSpan);
  const leAt = (s) => le0 + S.sweep * Math.max(0, (s - S.wingRootX) / S.halfSpan);
  const chordAt = (s) => S.rootChord + (S.tipChord - S.rootChord) * Math.max(0, (s - S.wingRootX) / S.halfSpan);
  const wingStations = [
    { s: 0, chord: S.rootChord, le: le0, y: S.wingY },
    { s: S.wingRootX, chord: S.rootChord, le: le0, y: S.wingY },
    { s: tipX, chord: S.tipChord, le: leAt(tipX), y: yAt(tipX) },
  ];
  const cuts = [
    { name: 'flap', s0: S.wingRootX + 0.04, s1: 2.95, hinge: 0.72 },
    { name: 'aileron', s0: 3.05, s1: tipX - 0.35, hinge: 0.75 },
  ];
  for (const side of ['right', 'left']) {
    const w = wing({ frame: side, stations: wingStations, t: 0.13, m: 0.02, cuts, tipRound: 0.14 });
    b.put(w.fixed, m.body);
    b.addSurface('flap', w.surfaces.flap);
    b.addSurface(side === 'right' ? 'aileronR' : 'aileronL', w.surfaces.aileron);
    // Wing-root fillet: blends the top of the wing into the fuselage side.
    const sx = side === 'right' ? 1 : -1;
    const fil = hull({
      stations: [
        ...roundNose(le0 - 0.05, 0.3, { w: 0.07, top: yAt(0.6) + 0.13, bot: yAt(0.6) - 0.04, yc: yAt(0.6) + 0.06 }, { y: yAt(0.6) + 0.02 }, 3),
        { z: le0 + S.rootChord * 0.55, w: 0.09, top: yAt(0.6) + 0.17, bot: yAt(0.6) - 0.04, yc: yAt(0.6) + 0.07 },
        { z: le0 + S.rootChord + 0.1, w: 0.02, top: yAt(0.6) + 0.07, bot: yAt(0.6) + 0.01, yc: yAt(0.6) + 0.04 },
      ],
      radial: 5,
      uvBand: 0.2,
      maxStep: 0.3,
    });
    const zF = le0 + S.rootChord * 0.5;
    b.put(fil.geometry, m.body, { p: [sx * (h.halfWidthAt(zF, yAt(0.6) + 0.06) - 0.03), 0, 0] });
  }

  /* ---------------- Tail ---------------- */
  tailGroup(b, {
    fin: { base: 0.3, le: S.finZ, root: S.finRootChord, tip: S.finRootChord * 0.45, height: S.finHeight, sweep: S.finSweep, dorsal: { len: 1.0, rise: 0.14 }, hinge: 0.6 },
    stab: { y: 0.22, le: S.hZ, root: S.hRootChord, tip: S.hRootChord * 0.62, span: S.hSpan, sweep: S.hRootChord * 0.3, dihedral: 0.04, hinge: 0.6, inner: 0.15 },
  });
  tailBumper(b, h, 3.95 * S.bodyLength, -0.12);

  /* ---------------- Nose ---------------- */
  for (const side of [-1, 1]) {
    b.put(turned([[0.001, -0.02], [0.07, 0], [0.07, 0.1]], 10, { closeEnds: true, yScale: 0.55 }), m.dark, { p: [side * 0.24, -0.16, -2.18] });
    // Exhaust stubs, low on each side of the cowl.
    b.put(tubePath([[side * 0.36, -0.36, -1.6], [side * 0.4, -0.44, -1.4]], 0.03, 6), m.grey);
  }
  b.addProp({ at: [0, 0, -2.48], radius: 1.1, blades: 3, chord: 0.15, spinner: { r: 0.19, len: 0.34 }, dir: 1 });

  /* ---------------- Gear ---------------- */
  const RM = S.wheelR.main;
  const RN = S.wheelR.nose;
  for (const side of [-1, 1]) {
    const x = side * S.main.x;
    const s = Math.abs(x);
    const topY = yAt(s) - 0.05;
    oleoLeg(b, {
      name: 'main gear',
      top: [x, topY, S.main.z],
      axle: [x - side * 0.08, S.main.y + RM, S.main.z],
      R: RM,
      width: 0.15,
      strut: 0.045,
      fold: { axis: [0, 0, 1], angle: -side * 1.52 },
      door: 'outboard',
      doorWidth: 0.26,
    });
  }
  oleoLeg(b, {
    name: 'nose gear',
    top: [0, -0.5, S.nose.z - 0.08],
    axle: [0, S.nose.y + RN, S.nose.z],
    R: RN,
    width: 0.12,
    strut: 0.04,
    steer: true,
    fold: { axis: [1, 0, 0], angle: -1.5 },
  });

  /* ---------------- Details ---------------- */
  // A com antenna on the cabin roof and a pitot under the left wing.
  b.put(tubePath([[0, h.topAt(1.3) - 0.02, 1.3], [0, h.topAt(1.3) + 0.28, 1.46]], 0.012, 4), m.dark);
  b.put(tubePath([[-3.8, yAt(3.8) - 0.06, leAt(3.8) + 0.3], [-3.8, yAt(3.8) - 0.1, leAt(3.8) - 0.12]], 0.012, 4), m.metal);

  /* ---------------- Lights ---------------- */
  const tipY = yAt(tipX);
  const tipZ = leAt(tipX) + S.tipChord * 0.2;
  b.lamp('navL', [-tipX - 0.02, tipY, tipZ]);
  b.lamp('navR', [tipX + 0.02, tipY, tipZ]);
  b.lamp('strobeL', [-tipX - 0.02, tipY, tipZ + 0.1]);
  b.lamp('strobeR', [tipX + 0.02, tipY, tipZ + 0.1]);
  b.lamp('tail', [0, 0.26, 4.8]);
  b.lamp('beacon', [0, 0.3 + S.finHeight + 0.03, S.finZ + S.finSweep + 0.25]);
  b.lamp('landing', [-2.2, yAt(2.2), leAt(2.2) - 0.02]);
  return { spot: [-2.2, yAt(2.2) - 0.05, leAt(2.2) - 0.2], hull: h };
}
