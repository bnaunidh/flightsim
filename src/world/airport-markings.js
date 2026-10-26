/**
 * The paint and the lights a pilot follows on the ground, worked out from the
 * layout: what airport.js draws, and what tests/features/airport-look.mjs
 * checks, from the same answer.
 *
 * Owner (Oct 25): "yellow taxiway centrelines that curve onto/off the runway
 * at every entry and high-speed exit (lead-on/lead-off lines),
 * holding-position markings (double solid + double dashed yellow) at runway
 * entries, taxiway edge lines; at night green taxiway centreline lights +
 * yellow runway-exit guidance".
 *
 *   centre    the taxiway's centreline, stopping short of any runway it crosses
 *   lead      lead-on / lead-off lines: from each connector's centreline, a
 *             quarter circle each way onto the runway centreline, so a pilot
 *             turning on or off follows paint the whole way round. `pts` is
 *             the curve; `pieces` what is painted of it — broken over the
 *             runway's own white markings, and none where they cover most
 *             of it (runwayWhite)
 *   fillet    the curves from a connector's centreline into the parallel
 *             taxiway's, both ways, at the T
 *   edge      double yellow edge lines along the taxiway and each connector,
 *             broken wherever other pavement opens off them
 *   holds     every runway entry: each connector's hold, and both sides of
 *             every place the taxiway crosses the crosswind runway
 *   lights    green centreline lights every 15 m on the straight (7.5 m on a
 *             curve); green and yellow alternating from the runway centreline
 *             to the hold on the way off (runway-exit guidance)
 *
 * Pure: plain numbers in, plain numbers out, world coordinates [x, z].
 */

const GREEN = 0x1fff3e;
const YELLOW = 0xffc93a;

/** Points round a quarter circle in the frame, as world [x, z]. */
function arc(F, cu, cw, R, from, to, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = from + ((to - from) * i) / n;
    out.push([F.x(cu + Math.cos(a) * R), F.z(cw + Math.sin(a) * R)]);
  }
  return out;
}

/** Evenly spaced points along a polyline, `step` apart, starting `offset` in. */
export function along(pts, step, offset = 0) {
  const out = [];
  let carry = offset;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const L = Math.hypot(bx - ax, bz - az);
    let d = carry;
    while (d <= L + 1e-6) {
      const t = L > 0 ? d / L : 0;
      out.push([ax + (bx - ax) * t, az + (bz - az) * t]);
      d += step;
    }
    carry = d - L;
  }
  return out;
}

/** Subtract a list of [a, b] gaps from the range [lo, hi]: the pieces left. */
function cut(lo, hi, gaps) {
  let pieces = [[lo, hi]];
  for (const [a, b] of gaps) {
    const next = [];
    for (const [p, q] of pieces) {
      if (b <= p || a >= q) next.push([p, q]);
      else {
        if (a > p) next.push([p, a]);
        if (b < q) next.push([b, q]);
      }
    }
    pieces = next;
  }
  return pieces.filter(([p, q]) => q - p > 1);
}

/**
 * Where the main runway's own white paint is, as boxes in the frame (u along
 * the runway from its middle, w across it from the centreline): the
 * threshold bars, the designators, the aiming blocks and the touchdown-zone
 * bars, at both ends. The layout is the runway texture's (render/textures.js
 * runwayTexture: fractions of the length from each end, of the width from
 * the centreline) and the number decals' (airport.js runwayDesignators).
 *
 * Runway markings take precedence over taxiway markings (FAA AC
 * 150/5340-1): a yellow lead-on line is broken where it would cross them.
 * On the 450 m strips every end connector meets the runway beside its
 * numbers, and the curve was painted straight across them.
 */
export function runwayWhite(lay) {
  const out = [];
  if (!lay || !lay.runway) return out;
  const L = lay.runway.length;
  const hw = lay.runway.halfWidth;
  const len = Math.max(9, Math.min(18, 0.052 * L - 6));
  const wid = Math.min(len * 0.83, hw * 2 * 0.6);
  for (const e of [-1, 1]) {
    // A box `d0`..`d1` metres in from this end.
    const box = (d0, d1, w0, w1, what) => {
      const a = e * (L / 2 - d0);
      const b = e * (L / 2 - d1);
      out.push({ u0: Math.min(a, b), u1: Math.max(a, b), w0, w1, what });
    };
    box(0.028 * L, 0.063 * L, -0.74 * hw, 0.74 * hw, 'threshold');
    const dn = 0.063 * L + 4;
    box(dn, dn + len, -wid / 2, wid / 2, 'numbers');
    for (const sd of [-1, 1]) {
      const [w0, w1] = sd > 0 ? [0.37 * hw, 0.5 * hw] : [-0.5 * hw, -0.37 * hw];
      box(0.115 * L, 0.15 * L, w0, w1, 'aiming');
      for (let k = 0; k < 3; k++) box(0.148 * L + k * 0.05 * L, 0.192 * L + k * 0.05 * L, w0, w1, 'tdz');
    }
  }
  return out;
}

/** Is the frame point (u, w) on any of `boxes`, within `m` metres? */
export function onWhite(boxes, u, w, m = 0.4) {
  for (const b of boxes) if (u >= b.u0 - m && u <= b.u1 + m && w >= b.w0 - m && w <= b.w1 + m) return true;
  return false;
}

/**
 * A polyline of world points, in the runs that stay off the runway's white
 * paint: each segment is kept or dropped by its middle, so a line is broken
 * cleanly either side of a marking and never painted over it.
 */
function offWhite(F, pts, boxes) {
  const runs = [];
  let run = null;
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i - 1][0] + pts[i][0]) / 2;
    const mz = (pts[i - 1][1] + pts[i][1]) / 2;
    const clear = !onWhite(boxes, mx - F.cx, (mz - F.cz) * F.side) && !onWhite(boxes, pts[i][0] - F.cx, (pts[i][1] - F.cz) * F.side, 0.2) && !onWhite(boxes, pts[i - 1][0] - F.cx, (pts[i - 1][1] - F.cz) * F.side, 0.2);
    if (clear) {
      if (!run) runs.push((run = [pts[i - 1]]));
      run.push(pts[i]);
    } else run = null;
  }
  return runs;
}

/** The total length of a list of polylines. */
function polyLength(lines) {
  let n = 0;
  for (const p of lines) for (let i = 1; i < p.length; i++) n += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return n;
}

/**
 * Everything, for one layout.
 *   { lines: [{ kind, pts, w }], holds: [...], lights: [{ x, z, hex, exit }] }
 * A hold: { x, z, ax, az, nx, nz, half, runway, connector? } — (ax, az) runs
 * along the hold line (across the taxiway), (nx, nz) points at the runway.
 */
export function taxiMarkings(lay) {
  const out = { lines: [], holds: [], lights: [] };
  if (!lay || !lay.taxiway || !lay.frame) return out;
  const F = lay.frame;
  const t = lay.taxiway;
  const tw = t.w;
  const th = t.width / 2;
  const hw = lay.runway.halfWidth;
  const crossings = lay.crossings || [];
  const W = 0.45; // centreline width, as painted before
  const light = (x, z, hex, exit = false) => out.lights.push({ x, z, hex, exit });
  const white = runwayWhite(lay);

  /* ---- the parallel taxiway's centreline, off every runway it crosses ---- */
  const rwGaps = crossings.map((x) => [x.u0 - 1.5, x.u1 + 1.5]);
  const centre = cut(t.u0 + 2, t.u1 - 2, rwGaps);
  for (const [a, b] of centre) {
    const pts = [[F.x(a), F.z(tw)], [F.x(b), F.z(tw)]];
    out.lines.push({ kind: 'centre', pts, w: W });
    for (const [x, z] of along(pts, 15, 4)) light(x, z, GREEN);
  }

  /* ---- each connector: centreline, lead-on/off, fillets, holds ---- */
  for (const c of lay.connectors) {
    // One that is the crosswind runway's own pavement gets no taxiway paint.
    if (c.onRunway) continue;
    const u = c.u;
    // Its straight centreline, from the runway edge to the taxiway's.
    const straight = [[F.x(u), F.z(hw)], [F.x(u), F.z(tw)]];
    out.lines.push({ kind: 'centre', pts: straight, w: W, connector: c.id });
    // Lead-on / lead-off: a quarter circle of radius hw each way, from the
    // connector's centreline at the runway edge onto the runway centreline.
    const R = hw;
    const leads = [];
    for (const s of [-1, 1]) {
      // Centre at (u + s R, hw): from the connector (angle pi, or 0) a
      // quarter turn round to the runway centreline (3pi/2, or -pi/2).
      const a0 = s > 0 ? Math.PI : 0;
      const a1 = s > 0 ? Math.PI * 1.5 : -Math.PI / 2;
      const pts = arc(F, u + s * R, hw, R, a0, a1, 14);
      // What is painted: the same curve, finely, broken over the runway's
      // own white markings (runwayWhite). `pts` stays the whole curve.
      let pieces = offWhite(F, arc(F, u + s * R, hw, R, a0, a1, 72), white);
      /*
       * Where most of the curve would lie on the markings — a connector that
       * meets the runway at its threshold bars or beside its numbers, the
       * end connectors of every strip — it is not painted at all, nor lit:
       * yellow stubs either side of a white block read as a mistake, and a
       * real field paints no lead-on line across its threshold.
       */
      if (polyLength(pieces) < 0.6 * (Math.PI / 2) * R) pieces = [];
      out.lines.push({ kind: 'lead', pts, pieces, w: W, connector: c.id, dir: s });
      if (pieces.length) leads.push(pts);
    }
    // Fillets at the T, inside the parallel taxiway, both ways.
    for (const s of [-1, 1]) {
      // Only where the taxiway carries on past the curve: not into a stub.
      if (u + s * th < t.u0 + th + 2 || u + s * th > t.u1 - th - 2) continue;
      const a0 = s > 0 ? Math.PI : 0;
      const a1 = Math.PI / 2;
      const pts = arc(F, u + s * th, tw - th, th, a0, a1, 10);
      out.lines.push({ kind: 'fillet', pts, w: W, connector: c.id, dir: s });
      for (const [x, z] of along(pts, 7.5, 3.5)) light(x, z, GREEN);
    }
    // The hold: two solid lines on the taxiway side, two dashed on the runway's.
    out.holds.push({ x: F.x(u), z: F.z(c.hold.w), ax: 1, az: 0, nx: 0, nz: -F.side, half: th - 0.5, runway: 'main', connector: c.id });
    // Lights: green from the taxiway down to the hold; from the hold to the
    // runway centreline, and round each lead line, green and yellow by turns
    // — the runway-exit lights, which say "you are still on the runway's
    // business until you are past the yellow".
    for (const [x, z] of along([[F.x(u), F.z(tw - th - 1)], [F.x(u), F.z(c.hold.w + 2)]], 15, 0)) light(x, z, GREEN);
    let k = 0;
    for (const [x, z] of along([[F.x(u), F.z(c.hold.w)], [F.x(u), F.z(hw)]], 7.5, 0)) light(x, z, k++ % 2 ? YELLOW : GREEN, true);
    for (const pts of leads) {
      let j = 0;
      for (const [x, z] of along(pts, 7.5, 3.75)) light(x, z, j++ % 2 ? GREEN : YELLOW, true);
    }
  }

  /* ---- the crossings of the crosswind runway: a hold each side ---- */
  for (const x of crossings) {
    for (const h of x.holds) {
      out.holds.push({ x: F.x(h.u), z: F.z(tw), ax: 0, az: 1, nx: h.dir, nz: 0, half: th - 0.5, runway: x.id, crossing: x.id });
    }
  }

  /* ---- edge lines: double yellow, broken where pavement opens off them ---- */
  const pave = lay.pavement || [];
  const toFrame = (p) => {
    const u0 = p.x0 - F.cx;
    const u1 = p.x1 - F.cx;
    const wa = (p.z0 - F.cz) * F.side;
    const wb = (p.z1 - F.cz) * F.side;
    return { u0, u1, w0: Math.min(wa, wb), w1: Math.max(wa, wb), kind: p.kind };
  };
  const inner = tw - th + 0.6;
  const outer = tw + th - 0.6;
  const innerGaps = lay.connectors.map((c) => [c.u - th - 0.5, c.u + th + 0.5]).concat(rwGaps);
  const outerGaps = rwGaps.slice();
  for (const p of pave.map(toFrame)) {
    if (p.kind === 'taxiway' || p.kind === 'connector') continue;
    // Anything that starts at the taxiway's far edge opens off it there.
    if (Math.abs(p.w0 - (tw + th)) < 1.5 && p.u1 > t.u0 && p.u0 < t.u1) outerGaps.push([p.u0 - 0.5, p.u1 + 0.5]);
  }
  for (const [w, gaps] of [[inner, innerGaps], [outer, outerGaps]]) {
    for (const [a, b] of cut(t.u0 + 0.6, t.u1 - 0.6, gaps)) {
      for (const d of [-0.2, 0.2]) {
        const ww = w + d;
        out.lines.push({ kind: 'edge', pts: [[F.x(a), F.z(ww)], [F.x(b), F.z(ww)]], w: 0.15 });
      }
    }
  }
  for (const c of lay.connectors) {
    if (c.onRunway) continue;
    for (const e of [-1, 1]) {
      for (const d of [0, 0.4]) {
        const uu = c.u + e * (th - 0.6 - d);
        out.lines.push({ kind: 'edge', pts: [[F.x(uu), F.z(hw + 3)], [F.x(uu), F.z(tw - th)]], w: 0.15, connector: c.id });
      }
    }
  }
  return out;
}
