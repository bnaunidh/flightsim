/**
 * The damage chip's plan view, drawn from the aircraft you are flying.
 *
 * Owner (Oct 25): "in the B-2 the DAMAGE chip shows a normal plane
 * silhouette". The chip was one hand-drawn airliner for every type. It is
 * drawn from the type now, in the type's own proportions — span against
 * length from its drawn plan (`type.plan`, metres), wing root, tip, sweep and
 * tailplane from its physics shape — in one of six families:
 *
 *   conventional  a wing, a tailplane, a fuselage    (everything by default)
 *   flyingWing    the B-2: one swept wing, a sawtooth trailing edge, no tail
 *   delta         Concorde: an ogival delta, no tailplane
 *   swing         the B-1B: a fixed glove and the outer wing swept half back
 *   heli          a cabin, a tail boom and tail rotor, the rotor disc round it
 *   tandem        the Chinook: two rotor discs, no tail rotor
 *
 * The five zones are the same five the physics counts (physics.js
 * `damage`): leftWing, rightWing, nose, fuselage and tail, each a closed
 * path on the part of THIS aeroplane it means. On a helicopter the "wings"
 * are the cabin's sides (the stub wings, on the Apache) and the tail is the
 * boom and the tail rotor; the rotor disc is drawn round it, not coloured.
 *
 * Pure (no DOM): tests/features/airport-look.mjs checks every type in the
 * roster gets a planform whose family and proportions match it.
 */

import { HELI_GEOMETRY } from '../aircraft/extra/helis.js';

const VB = 80;
const PAD = 5;

/** Which of the six a type is drawn as. */
export function planformKind(type) {
  const S = (type && type.shape) || {};
  const P = S.power || {};
  if (P.rotor || /helicopter/i.test(String(type && type.class))) return P.tandem ? 'tandem' : 'heli';
  if (S.flyingWing) return 'flyingWing';
  if (type && type.swingWing) return 'swing';
  // No tailplane worth the name next to the wing: a tailless delta.
  if (S.hSpan != null && S.halfSpan > 0 && S.hSpan / S.halfSpan < 0.12) return 'delta';
  return 'conventional';
}

/** The type's size in metres: [span, nose z, tail z], from its plan when it has one. */
function sizeOf(type) {
  const S = type.shape || {};
  const p = type.plan;
  const zs = (S.scale || 1) * (S.bodyLength || 1);
  const span = p && p.span ? p.span : (S.halfSpan || 5) * 2 * (S.scale || 1);
  const nose = p && p.nose != null ? p.nose : -(2.9 * zs);
  const tail = p && p.tail != null ? p.tail : ((S.hZ || 3) + (S.hRootChord || 1)) * zs;
  return { span, nose, tail, xs: S.scale || 1, zs };
}

/**
 * Fit a set of metre-space paths into the 80 x 80 box, nose up. Each path
 * is a list of [x, z] points (closed). Returns SVG path data per key.
 */
function fit(parts, extent) {
  const { x0, x1, z0, z1 } = extent;
  const w = x1 - x0;
  const h = z1 - z0;
  const k = (VB - 2 * PAD) / Math.max(w, h, 1e-6);
  const ox = VB / 2 - ((x0 + x1) / 2) * k;
  const oy = VB / 2 - ((z0 + z1) / 2) * k;
  const fmt = (v) => (Math.round(v * 10) / 10).toString();
  const out = {};
  for (const [key, polys] of Object.entries(parts)) {
    out[key] = polys
      .filter((pts) => pts && pts.length >= 3)
      .map((pts) => 'M' + pts.map(([x, z]) => `${fmt(ox + x * k)} ${fmt(oy + z * k)}`).join(' L') + ' Z')
      .join(' ');
  }
  return { paths: out, k, ox, oy };
}

const mirror = (pts) => pts.map(([x, z]) => [-x, z]).reverse();

/** A body outline between two stations, half width `bw`, tapering to points at the ends given. */
function bodySeg(za, zb, bwa, bwb) {
  return [[-bwa, za], [bwa, za], [bwb, zb], [-bwb, zb]];
}

/** A nose cone: a point at `zn` widening to `bw` at `zb`, in a few facets. */
function noseCone(zn, zb, bw) {
  const L = zb - zn;
  return [[0, zn], [bw * 0.55, zn + L * 0.25], [bw * 0.9, zn + L * 0.6], [bw, zb], [-bw, zb], [-bw * 0.9, zn + L * 0.6], [-bw * 0.55, zn + L * 0.25]];
}

function conventional(type, swing = false) {
  const S = type.shape;
  const { span, nose, tail, xs, zs } = sizeOf(type);
  const half = span / 2;
  const PL = S.plan || null;
  // The body: the plan's half-width where the airliners have one, otherwise
  // the physics shape's radius — never less than a tenth of the length's
  // worth of the chip, or a fighter's fuselage disappears.
  const len = tail - nose;
  let bw = PL && PL.halfWidth ? PL.halfWidth * xs : 0.42 * (S.bodyRadius || 1) * xs;
  bw = Math.max(bw, len * 0.035);
  const root = (S.rootChord || 1.5) * zs;
  const tip = (S.tipChord || 1) * zs;
  const sweep = (S.sweep || 0) * zs;
  const wz = (S.wingZ || 0) * zs;
  const parts = { leftWing: [], rightWing: [], nose: [], fuselage: [], tail: [] };
  if (swing) {
    /*
     * The B-1B: a glove fixed to the body, its leading edge swept well back,
     * and the outer wing pivoting out of it — drawn half back (about 45
     * degrees), the way it flies most of the time.
     */
    const pivotX = Math.max(bw * 1.6, half * 0.17);
    const pivotZ = wz - root * 0.15;
    const gloveLE = wz - root * 1.25;
    const outer = (half - pivotX) * 0.82;
    const a = (45 * Math.PI) / 180;
    const tipX = pivotX + outer * Math.cos(a);
    const tipZ = pivotZ + outer * Math.sin(a);
    const c0 = root * 0.85;
    const c1 = tip * 1.2;
    const right = [[bw, gloveLE], [pivotX, pivotZ - c0 * 0.35], [tipX, tipZ - c1 / 2], [tipX, tipZ + c1 / 2], [pivotX + c0 * 0.3, pivotZ + c0 * 0.55], [bw, pivotZ + c0 * 0.7]];
    parts.rightWing.push(right);
    parts.leftWing.push(mirror(right));
  } else {
    const right = [[bw * 0.9, wz - root / 2], [half, wz + sweep - tip / 2], [half, wz + sweep + tip / 2], [bw * 0.9, wz + root / 2]];
    parts.rightWing.push(right);
    parts.leftWing.push(mirror(right));
  }
  // The tailplane, both halves, in the tail zone with the rear fuselage.
  const hs = Math.min(half * 0.6, Math.max((S.hSpan || 1.5) * xs, bw * 2.2));
  const hc = (S.hRootChord || 1) * zs;
  // Its root just ahead of the end of the body, wherever the shape says.
  const hz = Math.min(tail - hc * 0.55, Math.max(wz + root * 0.6, (S.hZ || 3) * zs));
  const hsw = Math.min(hc * 0.8, 0.28 * zs);
  const tailStart = Math.min(hz - hc * 0.8, tail - len * 0.12);
  const rightH = [[bw * 0.7, hz - hc / 2], [hs, hz + hsw - hc * 0.3], [hs, hz + hsw + hc * 0.3], [bw * 0.5, hz + hc / 2]];
  parts.tail.push(rightH, mirror(rightH));
  // Nose, middle, tail of the body.
  const noseEnd = nose + len * 0.2;
  parts.nose.push(noseCone(nose, noseEnd, bw));
  parts.fuselage.push(bodySeg(noseEnd, tailStart, bw, bw * 0.92));
  parts.tail.push([[-bw * 0.92, tailStart], [bw * 0.92, tailStart], [bw * 0.35, tail], [-bw * 0.35, tail]]);
  const reach = Math.max(half, hs);
  return { parts, extent: { x0: -reach, x1: reach, z0: nose, z1: tail } };
}

function flyingWing(type) {
  const { span, nose, tail } = sizeOf(type);
  const half = span / 2;
  const len = tail - nose;
  /*
   * The B-2: a 33-degree leading edge from the nose to each tip, and the
   * double-W trailing edge — forward, back, forward again and back to the
   * point of the "beaver tail" in the middle.
   */
  // Stations as fractions of the length from the nose, against fractions of
  // the half span: the B-2's 0.8 length-to-half-span, its tips the aftmost
  // points of the outer wing, the notches always well behind the leading edge.
  const le = (x) => nose + 0.775 * len * (x / half);
  const at = (f) => nose + f * len;
  const tipLE = le(half);
  const te = [
    [half, at(0.875)],
    [half * 0.62, at(0.66)],
    [half * 0.4, at(0.875)],
    [half * 0.2, at(0.72)],
    [0, tail],
  ];
  const cx = half * 0.17;
  const parts = { leftWing: [], rightWing: [], nose: [], fuselage: [], tail: [] };
  // Outer panels: from the centre body's edge out to the tip.
  const right = [[cx, le(cx)], [half, tipLE], te[0], te[1], te[2], te[3]];
  parts.rightWing.push(right);
  parts.leftWing.push(mirror(right));
  // The centre body: the cockpit at the front, the bays behind it, the beaver tail.
  const nb = nose + len * 0.26;
  parts.nose.push([[0, nose], [cx * 0.8, le(cx * 0.8)], [cx, nb], [-cx, nb], [-cx * 0.8, le(cx * 0.8)]]);
  const fb = te[3][1];
  parts.fuselage.push([[-cx, nb], [cx, nb], [cx, fb], [-cx, fb]]);
  parts.tail.push([[-cx, fb], [cx, fb], [0, tail]]);
  return { parts, extent: { x0: -half, x1: half, z0: nose, z1: tail } };
}

function delta(type) {
  const S = type.shape;
  const { span, nose, tail, xs } = sizeOf(type);
  const half = span / 2;
  const len = tail - nose;
  const PL = S.plan || null;
  const bw = Math.max(PL && PL.halfWidth ? PL.halfWidth * xs : 0.4 * (S.bodyRadius || 1) * xs, len * 0.03);
  /*
   * Concorde's ogee: the leading edge leaves the body a third of the way
   * back, runs out almost straight along it, then sweeps out in a curve to a
   * short tip; the trailing edge is nearly square across.
   */
  const te = nose + len * 0.86;
  // Leading-edge stations: [x as a fraction of the half span, z as a
  // fraction of the length from the nose].
  const LE = [[0, 0.27], [0.12, 0.42], [0.3, 0.55], [0.55, 0.66], [0.8, 0.75], [1, 0.81]];
  const right = LE.map(([fx, fz]) => [bw + (half - bw) * fx, nose + fz * len]);
  right.push([half, te], [bw, te]);
  const parts = { leftWing: [right], rightWing: [], nose: [], fuselage: [], tail: [] };
  parts.rightWing = [right];
  parts.leftWing = [mirror(right)];
  const noseEnd = nose + len * 0.24;
  parts.nose.push(noseCone(nose, noseEnd, bw));
  parts.fuselage.push(bodySeg(noseEnd, te, bw, bw));
  // Behind the wing: the tail cone, and the fin's root on it.
  parts.tail.push([[-bw, te], [bw, te], [bw * 0.45, tail], [-bw * 0.45, tail]]);
  return { parts, extent: { x0: -half, x1: half, z0: nose, z1: tail } };
}

function heli(type, tandem) {
  const S = type.shape;
  const P = S.power || {};
  const sc = S.scale || 1;
  const G = HELI_GEOMETRY[type.id] || null;
  // The rotor and the hub, in metres (the rotary roster is drawn at scale 1).
  const R = (P.propRadius || 5) * sc;
  const hubZ = (G ? G.hubZ : P.z || 0) * sc;
  // A helicopter's `plan` runs from the front of the rotor disc to the tail,
  // so the fuselage's own length comes from its geometry table.
  const planTail = type.plan && type.plan.tail != null ? type.plan.tail : hubZ + R;
  let nose;
  let tail;
  if (tandem && G && G.aftHubZ != null) {
    const over = Math.max(1, (G.length - (G.aftHubZ - G.hubZ)) / 2);
    nose = G.hubZ - over;
    tail = G.aftHubZ + over;
  } else {
    tail = planTail;
    nose = G ? tail - G.length : Math.min(hubZ - R * 0.55, tail - R * 1.9);
  }
  const len = tail - nose;
  const parts = { leftWing: [], rightWing: [], nose: [], fuselage: [], tail: [] };
  const deco = [];
  if (tandem) {
    /*
     * The Chinook: one long box of a fuselage, a rotor at each end, no
     * tail boom. The tail zone is the aft pylon under the rear rotor.
     */
    const bw = len * 0.085;
    const fr = G ? G.hubZ : nose + R * 0.3;
    const ar = G ? G.aftHubZ : tail - R * 0.3;
    const noseEnd = nose + len * 0.18;
    const aft = tail - len * 0.22;
    parts.nose.push(noseCone(nose, noseEnd, bw));
    parts.fuselage.push(bodySeg(noseEnd, aft, bw, bw));
    parts.tail.push(bodySeg(aft, tail, bw, bw * 0.8));
    // The sponsons down each side, where the fuel and the wheels are.
    const sp = [[bw, nose + len * 0.42], [bw * 1.7, nose + len * 0.46], [bw * 1.7, nose + len * 0.7], [bw, nose + len * 0.74]];
    parts.rightWing.push(sp);
    parts.leftWing.push(mirror(sp));
    deco.push({ cx: 0, cz: fr, r: R }, { cx: 0, cz: ar, r: R });
    return { parts, deco, extent: { x0: -R, x1: R, z0: Math.min(nose, fr - R), z1: Math.max(tail, ar + R) } };
  }
  /*
   * A single-rotor helicopter: the cabin, round at the nose; the boom, thin,
   * back to the tail rotor; a stabiliser across it. The "wings" are the
   * cabin's sides — the stub wings on an armed one (the Apache: halfSpan
   * 2.6 m against 1.1-2 m on the others).
   */
  const cabinEnd = nose + len * 0.5;
  const bw = Math.max(len * 0.08, Math.min(1.4, (S.halfSpan || 1.3) * 0.55));
  const noseEnd = nose + len * 0.17;
  parts.nose.push([[0, nose], [bw * 0.7, nose + len * 0.035], [bw * 0.97, noseEnd], [-bw * 0.97, noseEnd], [-bw * 0.7, nose + len * 0.035]]);
  parts.fuselage.push([[-bw * 0.97, noseEnd], [bw * 0.97, noseEnd], [bw * 0.8, cabinEnd], [-bw * 0.8, cabinEnd]]);
  const stub = (S.halfSpan || 0) >= 2.4;
  const sx = stub ? S.halfSpan : bw * 1.55;
  const sz0 = nose + len * (stub ? 0.3 : 0.24);
  const sz1 = nose + len * (stub ? 0.4 : 0.46);
  const side = [[bw * 0.95, sz0], [sx, sz0 + (sz1 - sz0) * 0.15], [sx, sz1 - (sz1 - sz0) * 0.1], [bw * 0.85, sz1]];
  parts.rightWing.push(side);
  parts.leftWing.push(mirror(side));
  // The boom, its stabiliser, and the tail rotor at the end (on the left side, as on most).
  const boomW = Math.max(0.22, bw * 0.24);
  parts.tail.push([[-bw * 0.8, cabinEnd], [bw * 0.8, cabinEnd], [boomW, cabinEnd + len * 0.08], [boomW * 0.8, tail - len * 0.03], [-boomW * 0.8, tail - len * 0.03], [-boomW, cabinEnd + len * 0.08]]);
  const stz = tail - len * 0.14;
  const stw = bw * 1.15;
  parts.tail.push([[-stw, stz], [stw, stz], [stw, stz + len * 0.035], [-stw, stz + len * 0.035]]);
  const trR = Math.max(0.5, R * 0.17);
  parts.tail.push([[-boomW * 0.9 - 0.12, tail - trR], [-boomW * 0.9, tail - trR], [-boomW * 0.9, tail], [-boomW * 0.9 - 0.12, tail]]);
  deco.push({ cx: 0, cz: hubZ, r: R }, { cx: -boomW * 0.9 - 0.06, cz: tail - trR * 0.5, r: trR, small: true });
  return { parts, deco, extent: { x0: -R, x1: R, z0: Math.min(nose, hubZ - R), z1: Math.max(tail, hubZ + R) } };
}

/**
 * The plan view for a type.
 *   { kind, zones: { leftWing, rightWing, nose, fuselage, tail }, rings: [{cx, cy, r}], svg }
 * `zones` are SVG path data in an 80 x 80 box, nose up; `rings` are the
 * rotor discs (drawn, not coloured); `svg` is the inner markup ready to set.
 */
export function damagePlanform(type) {
  if (!type || !type.shape) return damagePlanform(FALLBACK);
  const kind = planformKind(type);
  let g;
  try {
    g =
      kind === 'flyingWing' ? flyingWing(type)
        : kind === 'delta' ? delta(type)
          : kind === 'heli' ? heli(type, false)
            : kind === 'tandem' ? heli(type, true)
              : conventional(type, kind === 'swing');
  } catch (e) {
    g = conventional(FALLBACK);
  }
  const { paths, k, ox, oy } = fit(g.parts, g.extent);
  const rings = (g.deco || []).map((d) => ({ cx: +(ox + d.cx * k).toFixed(1), cy: +(oy + d.cz * k).toFixed(1), r: +(d.r * k).toFixed(1), small: !!d.small }));
  const order = ['leftWing', 'rightWing', 'tail', 'fuselage', 'nose'];
  const svg =
    rings.map((r) => `<circle class="dmg-rotor${r.small ? ' is-small' : ''}" cx="${r.cx}" cy="${r.cy}" r="${r.r}"/>`).join('') +
    order.map((z) => `<path data-zone="${z}" d="${paths[z] || ''}"/>`).join('');
  return { kind, zones: paths, rings, svg, id: type.id };
}

/** The hand-drawn airliner the chip always showed, for a type with no shape. */
const FALLBACK = {
  id: 'generic',
  class: 'Airliner',
  plan: { nose: -18, tail: 20, span: 34 },
  shape: { scale: 2.5, bodyLength: 1.55, bodyRadius: 1, halfSpan: 6.2, rootChord: 1.2, tipChord: 0.36, sweep: 2, wingZ: -0.57, hSpan: 2.4, hRootChord: 0.9, hZ: 3.6, power: { kind: 'jet', count: 2 } },
};
