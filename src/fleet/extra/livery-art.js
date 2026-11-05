/**
 * The airlines' paint, laid out the way a paint shop's drawing is: a side
 * view of the aeroplane, port side, nose to the left.
 *
 * The owner: "PLEASE MAKE THE COMPANY LOGOS AND FONTS AND PLANE DESGINS
 * REALSITIC". Every scheme used to be one of six templates in a new colour,
 * ruled straight along the texture: a white tube and a coloured fin. A real
 * scheme is a shape: the belly line lifts towards the tail, the tail colour
 * pours off the fin onto the body, a ribbon runs up into the fin root.
 *
 * So each scheme here is a short list of shapes in BODY coordinates:
 *   s  0 at the nose tip, 1 at the end of the tail cone
 *   t  0 on the belly, 1 on the crown, AT THAT STATION, so a line of constant
 *      t follows the taper and the upsweep of the tail by itself.
 * t is drawn for an A320, whose windows sit at t = 0.6; bodyMap moves it so
 * the same line stays clear of the windows on any type. Shapes go through
 * the (z, y) -> (u, v) the skin itself is mapped by, so a line is where it
 * was drawn on the fallback model and on a downloaded one alike.
 *
 *   ['under', ink, [[s, t], ...]]         everything below a smooth curve
 *   ['over',  ink, [[s, t], ...]]         everything above it
 *   ['rib',   ink, [[s, t, half], ...]]   a smooth ribbon, half-width in t
 *   ['poly',  ink, [[s, t], ...]]         a sharp-cornered shape
 *
 * The fin has its own square canvas, the shapes in FIN coordinates (c 0 at
 * the leading edge, 1 at the trailing edge; h 0 at the root, 1 at the tip),
 * and the mark laid in the largest circle the fin holds, so it is never
 * clipped and never stretched. Mark and paint are one surface: lit, shadowed
 * and bent with the fin, and they swing with the rudder.
 *
 * Marks and body shapes face FORWARD on both sides, as a real tail's do: the
 * mesh shows port and starboard the same canvas, one the mirror of the other.
 *
 * All colours are the schemes' own (aircraft/liveries.js); no shape here is
 * traced from anyone's livery. Pure canvas: no THREE.
 */
import { drawEmblem } from './emblems.js';

/** Catmull-Rom through the knots: `n` steps a span. Knots may carry extra numbers (a ribbon's width). */
function smooth(pts, n = 7) {
  if (pts.length < 3) return pts;
  const out = [];
  const at = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push(p1.map((_, d) => 0.5 * (2 * p1[d] + (p2[d] - p0[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (3 * p1[d] - p0[d] - 3 * p2[d] + p3[d]) * t3)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** A filled outline of [x, y] pixels. */
function fillPts(g, ink, list) {
  g.fillStyle = ink;
  g.beginPath();
  list.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fill();
}

/** The two edges of a ribbon, one forward and one back, in the shape's own coordinates. */
function ribbon(knots) {
  const c = smooth(knots);
  const a = [];
  const b = [];
  c.forEach(([s, t, w], i) => {
    const p = c[Math.max(0, i - 1)];
    const q = c[Math.min(c.length - 1, i + 1)];
    const ds = q[0] - p[0];
    const dt = q[1] - p[1];
    const L = Math.hypot(ds * 3, dt) || 1; // s is about a third the scale of t
    a.push([s - (dt / L) * w * 0.33, t + ((ds * 3) / L) * w]);
    b.push([s + (dt / L) * w * 0.33, t - ((ds * 3) / L) * w]);
  });
  return a.concat(b.reverse());
}

/**
 * The (s, t) -> canvas map for one airframe. m = { U(z), V(z, y), top(z),
 * bot(z), z0, z1, tw } where tw is the t of this type's main window row.
 */
export function bodyMap(m) {
  const tOf = (t) => (t <= 0.6 ? (t / 0.6) * m.tw : m.tw + ((t - 0.6) / 0.4) * (1 - m.tw));
  return ([s, t]) => {
    const z = m.z0 + Math.min(1, Math.max(0, s)) * (m.z1 - m.z0);
    const y = m.bot(z) + tOf(t) * (m.top(z) - m.bot(z));
    return [m.U(z), m.V(z, y)];
  };
}

/** Lay the scheme's body shapes on the canvas, back to front. */
export function paintBody(g, body, m, W, H) {
  const P = bodyMap(m);
  for (const op of body || []) {
    const [kind, ink, a] = op;
    if (kind === 'under' || kind === 'over') {
      const row = kind === 'under' ? H + 1 : -1;
      const line = smooth(a).map(P);
      fillPts(g, ink, [[line[0][0], row], ...line, [line[line.length - 1][0], row]]);
    } else if (kind === 'rib') fillPts(g, ink, ribbon(a).map(P));
    else if (kind === 'poly') fillPts(g, ink, a.map(P));
  }
}

/* ------------------------------------------------------------------ *
 * The fin
 * ------------------------------------------------------------------ */

/** What of the sky round a fin its canvas covers: the fin, and room for a fillet ahead of it. */
export function finBox(P) {
  const H = P.y1 - P.y0;
  return {
    zA: Math.min(P.le0, P.le1) - 0.3 * P.ch0,
    zB: Math.max(P.le0 + P.ch0, P.le1 + P.ch1) + 0.06 * P.ch0,
    yA: P.y0 - 0.2 * H,
    yB: P.y1 + 0.05 * H,
  };
}

/** A fin profile's (c, h) in metres, and in texture coordinates. */
export function finPoint(P, c, h) {
  const le = P.le0 + (P.le1 - P.le0) * h;
  const ch = P.ch0 + (P.ch1 - P.ch0) * h;
  return [le + c * ch, P.y0 + (P.y1 - P.y0) * h];
}
export function finUV(P, box, z, y) {
  return [(z - box.zA) / (box.zB - box.zA), (y - box.yA) / (box.yB - box.yA)];
}

/**
 * The largest circle the fin holds: centre (c, h) and radius in metres. It
 * sits off the rudder hinge line by `aft`, as a real mark does: a circle in a
 * swept trapezium lies low and forward, and looks it unless pulled up a little.
 */
export function finCircle(P) {
  const seg = (ax, ay, bx, by, x, y) => {
    const dx = bx - ax;
    const dy = by - ay;
    const k = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy);
    return Math.hypot(x - (ax + k * dx), y - (ay + k * dy));
  };
  let best = { c: 0.5, h: 0.45, r: 0 };
  for (let h = 0.3; h <= 0.62; h += 0.02) {
    for (let c = 0.3; c <= 0.7; c += 0.02) {
      const [z, y] = finPoint(P, c, h);
      const r = Math.min(
        seg(P.le0, P.y0, P.le1, P.y1, z, y),
        seg(P.le0 + P.ch0, P.y0, P.le1 + P.ch1, P.y1, z, y),
        P.y1 - y,
        y - P.y0,
      );
      if (r > best.r) best = { c, h, r };
    }
  }
  return best;
}

const marks = new Map();
/** A mark on its own transparent square (its cuts must not bite through the paint it is laid on). */
export function markCanvas(style, inks, S) {
  const key = `${style}|${inks.join()}|${S}`;
  if (marks.has(key)) return marks.get(key);
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  if (g && typeof g.clearRect === 'function') {
    g.clearRect(0, 0, S, S);
    if (!drawEmblem(g, style, S, inks)) {
      // A name this file does not know: a plain disc rather than nothing.
      g.fillStyle = inks[0];
      g.beginPath();
      g.arc(S / 2, S / 2, S * 0.3, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (marks.size > 48) marks.delete(marks.keys().next().value);
  marks.set(key, c);
  return c;
}

/**
 * Paint the fin on an S x S canvas. P is the fin profile, f the scheme's `fin`
 * block, `bg` the tail colour, emblem/inks the mark.
 */
export function paintFin(g, S, P, f, bg, emblem, inks) {
  const box = finBox(P);
  const px = (c, h) => {
    const [z, y] = finPoint(P, c, h);
    const [u, v] = finUV(P, box, z, y);
    return [u * S, (1 - v) * S];
  };
  g.fillStyle = (f && f.bg) || bg;
  g.fillRect(0, 0, S, S);
  for (const op of (f && f.ops) || []) {
    const [kind, ink, a] = op;
    if (kind === 'rib') fillPts(g, ink, ribbon(a).map(([c, h]) => px(c, h)));
    else if (kind === 'poly') fillPts(g, ink, a.map(([c, h]) => px(c, h)));
    else if (kind === 'blob') fillPts(g, ink, smooth([...a, a[0]]).map(([c, h]) => px(c, h)));
    else if (kind === 'tile') {
      // A diamond lattice across the fin, in metres so its cells are square.
      const cell = (P.y1 - P.y0) / 7;
      const sx = (S / (box.zB - box.zA)) * cell;
      const sy = (S / (box.yB - box.yA)) * cell;
      for (let r = 0, y = 0; y < S + sy; r++, y += sy / 2) {
        for (let x = r % 2 ? sx / 2 : 0; x < S + sx; x += sx) {
          const f = 0.36;
          fillPts(g, ink, [[x, y + sy * f], [x + sx * f, y], [x, y - sy * f], [x - sx * f, y]]);
        }
      }
    }
  }
  if (!emblem) return;
  const fit = finCircle(P);
  const at = (f && f.mark) || {};
  const [z, y] = finPoint(P, at.c ?? fit.c, at.h ?? fit.h);
  const [u, v] = finUV(P, box, z, y);
  // 0.84 of the patch is ink at most (emblems.js keeps it within 0.42 of the centre).
  const size = ((2 * fit.r) / 0.84) * (at.k ?? 0.86);
  const w = (size / (box.zB - box.zA)) * S;
  const h = (size / (box.yB - box.yA)) * S;
  const m = markCanvas(emblem, inks, S >= 512 ? 512 : 256);
  if ('imageSmoothingQuality' in g) g.imageSmoothingQuality = S >= 512 ? 'high' : 'medium';
  if (typeof g.drawImage === 'function') g.drawImage(m, u * S - w / 2, (1 - v) * S - h / 2, w, h);
}

/* ------------------------------------------------------------------ *
 * The schemes
 * ------------------------------------------------------------------ */

/** The lines more than one scheme is built on. */
const LINE = {
  /** A paint line low on the side, a shade off the belly: the grey most airlines leave underneath. */
  low: [[0, 0.1], [0.2, 0.18], [0.6, 0.2], [0.85, 0.24], [1, 0.42]],
  /** The belly colour lifting from the radome to the tail cone. */
  lift: [[0, 0.33], [0.07, 0.4], [0.17, 0.43], [0.5, 0.43], [0.72, 0.46], [0.88, 0.6], [1, 0.86]],
  /** The same, held flatter. */
  flat: [[0, 0.22], [0.1, 0.3], [0.5, 0.31], [0.75, 0.33], [0.9, 0.42], [1, 0.6]],
  /** Under the windows, nose to tail, a crown's lower edge. */
  crown: [[-0.02, 0.46], [0.06, 0.5], [0.16, 0.5], [0.6, 0.5], [0.76, 0.54], [0.9, 0.66], [1.02, 0.84]],
  /** A long sea swell. */
  swell: [[0, 0.3], [0.12, 0.41], [0.3, 0.35], [0.5, 0.42], [0.68, 0.37], [0.84, 0.54], [1, 0.84]],
};
/** A ribbon `half` thick, `off` above a line. */
const edge = (line, off, half) => line.map(([s, t]) => [s, t + off, half]);

/**
 * Per scheme, by id (nothing here is saved or sent: ids are the only link):
 *   body      the shapes on the fuselage
 *   fin       { bg, ops, mark: { c, h, k } }
 *   title     { cap, lead, t, dz, room, bold, on }: cap, the name's cap height (1 =
 *             a quarter of the body's height); lead, the mark's inks, for the mark
 *             small ahead of the name; t, a freighter's name's height on the body;
 *             bold, the fine strokes of a thin face fattened (em); on, the paint
 *             behind the name where it is not the body's (the hangar's plate)
 *   regInk    the registration's colour, where the scheme paints under it
 *   winglet   the winglets' colour (the wing's own if none)
 *   freighter no cabin windows: the windows are plugged, the name goes big
 */
/** Abyssinia's hillside: a ribbon out of the belly behind the wing, broadening up the aft body to the fin. */
const HIGHLAND = [[0.4, 0.14, 0], [0.56, 0.2, 0.03], [0.72, 0.36, 0.07], [0.86, 0.68, 0.1], [0.98, 1.12, 0.12]];
/** FlexShip's line between the white and the graphite: level to the wing, lifting behind it. */
const FLEX_LINE = [[-0.02, 0.34], [0.3, 0.34], [0.6, 0.36], [0.8, 0.5], [0.92, 0.74], [1.02, 1.1]];

export const LIVERY_ART = {
  // White over two blues' worth of belly, lifting to the tail; a gold line on the join.
  continental: {
    body: [
      ['under', '#1a4f8a', LINE.lift],
      ['rib', '#d4a62a', edge(LINE.lift, 0.012, 0.008)],
    ],
    fin: { ops: [['rib', '#d4a62a', [[-0.3, 0.02, 0.012], [0.4, 0.05, 0.016], [1.2, 0.2, 0.012]]]] },
    title: { cap: 1 },
    winglet: '#0d2f56',
  },
  // A terracotta hillside rising aft to the fin, an ochre line along its crest, an indigo fin over it.
  abyssinia: {
    body: [
      ['under', '#b7aea0', LINE.low],
      ['rib', '#b4462b', HIGHLAND],
      ['rib', '#e0a458', HIGHLAND.map(([s, t, half]) => [s, Math.min(1.12, t + half + 0.008), half ? 0.009 : 0])],
    ],
    fin: { mark: { k: 1 } },
    title: { cap: 1, lead: ['#b4462b'], bold: 0.012 },
    regInk: '#1f272e',
    winglet: '#262c66',
  },
  // Bare metal, a red line over a blue, sweeping up towards a band and a star on the fin.
  liberty: {
    body: [
      ['rib', '#c8102e', [[0.02, 0.5, 0.012], [0.2, 0.5, 0.018], [0.68, 0.5, 0.018], [0.84, 0.6, 0.02], [0.97, 0.9, 0.024]]],
      ['rib', '#143478', [[0.02, 0.45, 0.012], [0.2, 0.45, 0.018], [0.68, 0.45, 0.018], [0.85, 0.54, 0.02], [0.99, 0.82, 0.024]]],
      ['under', '#aab1b8', LINE.low],
    ],
    // One big star over one red band: no stripes and no flag-style field, which is another airline's tail.
    fin: { ops: [['rib', '#c8102e', [[-0.4, 0.04, 0.05], [0.3, 0.14, 0.085], [0.8, 0.3, 0.1], [1.3, 0.5, 0.1]]]], mark: { c: 0.46, h: 0.58, k: 0.76 } },
    title: { cap: 0.95 },
    winglet: '#143478',
  },
  // Clean white; the tail's two ribbons come down off the fin and die away on the aft body.
  bleuciel: {
    body: [
      ['under', '#b4bcc4', LINE.low],
      ['rib', '#12306b', [[0.62, 0.22, 0], [0.76, 0.42, 0.02], [0.88, 0.72, 0.05], [0.95, 1.08, 0.07]]],
      ['rib', '#c8142a', [[0.68, 0.22, 0], [0.8, 0.4, 0.014], [0.92, 0.68, 0.034], [1, 1, 0.05]]],
    ],
    fin: {},
    title: { cap: 1 },
    regInk: '#12306b',
    winglet: '#12306b',
  },
  // A saffron sweep that swells from a line under the windows to the whole tail cone, a red edge on it.
  bharat: {
    body: [
      ['under', '#b9bfc5', LINE.low],
      ['under', '#e8721f', [[0.04, 0.2], [0.3, 0.27], [0.6, 0.34], [0.76, 0.5], [0.86, 0.78], [0.91, 1.1]]],
      ['rib', '#b3121b', [[0.05, 0.215, 0.002], [0.3, 0.285, 0.012], [0.6, 0.36, 0.018], [0.76, 0.525, 0.024], [0.855, 0.8, 0.028], [0.905, 1.1, 0.03]]],
    ],
    fin: { mark: {} },
    title: { cap: 1, bold: 0.03 },
    regInk: '#fbf7f0',
    winglet: '#e8721f',
  },
  // A freighter in the small hours: no windows, the name across the body, one amber slash aft.
  nightfreight: {
    freighter: true,
    body: [
      ['under', '#1f2327', LINE.low],
      ['poly', '#e8a33c', [[0.68, -0.1], [0.72, -0.1], [0.84, 1.1], [0.8, 1.1]]],
      ['poly', '#e8a33c', [[0.735, -0.1], [0.745, -0.1], [0.865, 1.1], [0.855, 1.1]]],
    ],
    fin: { ops: [['poly', '#e8a33c', [[-0.5, 0.0], [1.3, 0.0], [1.3, 0.05], [-0.5, 0.05]]]] },
    title: { cap: 1.4, t: 0.56 },
    regInk: '#e9eef2',
    winglet: '#24282d',
  },
  // The crown: sky blue from the roof to under the windows, rising aft; a white belly below it.
  krd: {
    body: [
      ['under', '#d6dde4', LINE.low],
      ['over', '#39b4e6', LINE.crown],
      ['rib', '#0a3b6e', edge(LINE.crown, 0, 0.009)],
    ],
    fin: { ops: [['poly', '#0a3b6e', [[-0.5, 0.0], [1.3, 0.0], [1.3, 0.035], [-0.5, 0.035]]]] },
    title: { cap: 0.95, room: 1.1 },
    regInk: '#f4f7fa',
    winglet: '#39b4e6',
  },
  // White over navy; the fin's red pours down over a wedge of the aft body.
  riverdelta: {
    body: [
      ['under', '#003a70', LINE.lift],
      ['rib', '#c8102e', [[0.56, 0.45, 0], [0.7, 0.475, 0.014], [0.8, 0.54, 0.03], [0.9, 0.68, 0.05], [1, 0.86, 0.07]]],
      ['over', '#c8102e', [[0.74, 1.1], [0.8, 0.9], [0.9, 0.8], [1.02, 0.78]]],
    ],
    fin: {},
    title: { cap: 1, lead: ['#003a70', '#c8102e'] },
    regInk: '#1f272e',
    winglet: '#c8102e',
  },
  // Almost nothing, as the grandest do: white, a thin gold line up to the fin, a very big serif name.
  desertpearl: {
    body: [
      ['under', '#c9ced3', LINE.low],
      ['rib', '#c8a24a', [[0.6, 0.23, 0], [0.76, 0.4, 0.007], [0.88, 0.68, 0.012], [0.95, 1.05, 0.014]]],
    ],
    fin: { ops: [['rib', '#c8a24a', [[-0.3, 0.0, 0.012], [0.5, 0.03, 0.012], [1.2, 0.2, 0.012]]]] },
    title: { cap: 1.25, bold: 0.022 },
    winglet: '#d71920',
  },
  // A sand belly, and the fin's lattice breaking up as it runs forward along the aft body.
  sandline: {
    body: [
      ['under', '#c9a66b', LINE.flat],
      ['rib', '#7a5a30', edge(LINE.flat, 0.006, 0.005)],
      ['over', '#b08d57', [[0.72, 1.1], [0.8, 0.86], [0.9, 0.72], [1.02, 0.66]]],
      ['rib', '#7a5a30', [[0.73, 1.06, 0.004], [0.805, 0.84, 0.006], [0.905, 0.7, 0.007], [1.02, 0.64, 0.006]]],
    ],
    fin: { ops: [['tile', '#c9a66b']], mark: { k: 0.8 } },
    title: { cap: 1, bold: 0.022 },
    regInk: '#7a5a30',
    winglet: '#b08d57',
  },
  // Cobalt all over, a white billboard name, one coral line climbing the aft body to the fin.
  dashfreight: {
    freighter: true,
    body: [
      ['under', '#14308a', LINE.low],
      ['rib', '#ff6b4a', [[0.58, 0.1, 0], [0.72, 0.2, 0.014], [0.84, 0.46, 0.024], [0.94, 0.86, 0.03], [1, 1.12, 0.032]]],
    ],
    fin: { mark: { k: 1 } },
    title: { cap: 1.5, t: 0.56 },
    regInk: '#f5f7fb',
    winglet: '#ff6b4a',
  },
  // White over graphite, the line between them rising aft, a lime stripe along it.
  flexship: {
    freighter: true,
    body: [
      ['under', '#2b3138', FLEX_LINE],
      ['rib', '#8fc31f', edge(FLEX_LINE, 0.014, 0.01)],
    ],
    fin: { mark: { k: 1 } },
    title: { cap: 1.45, t: 0.72 },
    regInk: '#f5f7f6',
    winglet: '#8fc31f',
  },
  // Brown under, white over, and a gold band that widens all the way to the fin.
  parcelbrown: {
    freighter: true,
    body: [
      ['under', '#351c15', LINE.lift],
      ['rib', '#ffb500', [[0.1, 0.44, 0], [0.4, 0.45, 0.012], [0.68, 0.48, 0.02], [0.84, 0.62, 0.036], [1, 0.9, 0.06]]],
    ],
    fin: { ops: [['rib', '#ffb500', [[-0.3, 0.0, 0.02], [0.5, 0.04, 0.03], [1.2, 0.14, 0.03]]]] },
    title: { cap: 1.2, t: 0.78 },
    winglet: '#351c15',
  },
  // Navy under, and the flag on the tail flying as a wave: red and white crests across the fin.
  royalisles: {
    body: [
      ['under', '#0d2f6b', LINE.lift],
      ['rib', '#eb2226', edge(LINE.lift, 0.012, 0.009)],
    ],
    fin: { ops: [
      ['rib', '#f7f8fa', [[-0.3, 0.1, 0.05], [0.2, 0.3, 0.07], [0.6, 0.2, 0.06], [1.2, 0.46, 0.07]]],
      ['rib', '#eb2226', [[-0.3, 0.0, 0.05], [0.25, 0.17, 0.065], [0.65, 0.07, 0.055], [1.2, 0.28, 0.06]]],
    ], mark: { h: 0.68, k: 0.62 } },
    title: { cap: 0.92, lead: ['#eb2226', '#0d2f6b'] },
    winglet: '#eb2226',
  },
  // White, and the red of the fin wrapped round the tail cone with one clean curve.
  bosphorus: {
    body: [
      ['under', '#b9bfc5', LINE.low],
      ['over', '#c70a0c', [[0.67, 1.1], [0.72, 0.84], [0.8, 0.52], [0.9, 0.32], [1.02, 0.24]]],
      ['rib', '#1b1f5c', [[0.68, 1.06, 0.004], [0.725, 0.82, 0.007], [0.805, 0.505, 0.008], [0.905, 0.305, 0.008], [1.02, 0.225, 0.006]]],
    ],
    fin: {},
    title: { cap: 1.05, lead: ['#c70a0c'], bold: 0.01 },
    regInk: '#f7f8fa',
    winglet: '#c70a0c',
  },
  // Pearl grey, the maroon of the fin running down the whole tail in a long S.
  pearlgulf: {
    body: [
      ['under', '#a9adb2', LINE.low],
      ['over', '#5c0632', [[0.62, 1.1], [0.7, 0.86], [0.76, 0.56], [0.84, 0.32], [0.92, 0.14], [1.02, 0.04]]],
    ],
    fin: {},
    title: { cap: 1.05, bold: 0.022 },
    regInk: '#d4d6d9',
    winglet: '#5c0632',
  },
  // White, and a red arc of a rising sun struck across the aft body.
  risingcrane: {
    body: [
      ['under', '#bfc3c7', LINE.low],
      ['rib', '#b60005', [[0.62, 1.06, 0.022], [0.68, 0.72, 0.03], [0.76, 0.42, 0.036], [0.86, 0.18, 0.03], [0.96, 0.02, 0.02]]],
      ['rib', '#ffd166', [[0.655, 1.06, 0.006], [0.715, 0.72, 0.008], [0.795, 0.42, 0.009], [0.89, 0.2, 0.007], [0.98, 0.05, 0.005]]],
    ],
    fin: {},
    title: { cap: 1, lead: ['#b60005', '#ffd166'] },
    regInk: '#1a1a1a',
    winglet: '#b60005',
  },
  // Yellow all over, a black band low on the body, and the name as loud as it will go.
  spit: {
    body: [
      ['under', '#1a1a1a', LINE.low],
      ['under', '#ffe73a', [[0, 0.03], [0.3, 0.1], [0.7, 0.13], [1, 0.3]]],
    ],
    fin: {},
    title: { cap: 1.15 },
    winglet: '#1a1a1a',
  },
  // White over a swell of teal that rises and falls along the body, a gold crest on it.
  oversea: {
    body: [
      ['under', '#0f6e8c', LINE.swell],
      ['rib', '#f2b84b', edge(LINE.swell, 0.012, 0.008)],
    ],
    fin: { ops: [['rib', '#f2b84b', [[-0.3, -0.04, 0.012], [0.3, 0.04, 0.014], [0.7, 0.0, 0.014], [1.2, 0.06, 0.012]]]], mark: { k: 0.96 } },
    title: { cap: 1, lead: ['#0f6e8c', '#f2b84b'], bold: 0.012 },
    winglet: '#0f6e8c',
  },
};

/** The paint's art, or null: the scheme keeps its plain layout (Air Force One, the house colours). */
export const artFor = (scheme) => (scheme && LIVERY_ART[scheme.id]) || null;
