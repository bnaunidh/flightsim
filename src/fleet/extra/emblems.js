/**
 * The airlines' fin marks, drawn as a brand would draw them.
 *
 * The owner, on the old ones: "logo sucks". They were a few strokes of plain
 * geometry each — a polyline falcon, an ellipse crane with sticks for legs,
 * three rectangles for a tulip — which read as clip art from the apron and
 * as nothing at all from the runway. A real airline's mark is a silhouette
 * first: one or two filled shapes with clean curves, a weight that holds up
 * on a fin at two hundred metres, and negative space doing half the work.
 *
 * So every mark here is FILLED shapes built from smooth Bézier curves, laid
 * out on one grid (the unit square, -0.5..0.5 either way, the mark kept
 * inside 0.42 of the centre so the fin's taper never clips it), with gaps cut
 * clean through (destination-out) rather than painted over in the fin's
 * colour — so the fin's real paint shows through them on any scheme, and a
 * mark is crisp at the 256 px Low draws it at as well as at High's 512.
 *
 * CLOSE IN STYLE, NEVER A TRACING. Each is the game's own drawing of the
 * kind of mark the airline it parodies wears — a tulip where that one has a
 * crown, a falcon's wing round a pearl where that one has calligraphy, a
 * standing crane where that one has a bird in a ring — and none follows any
 * real logo's outline. The list (aircraft/liveries.js EMBLEMS):
 *
 *   stripes     Abyssinia      three pennants from one point, one per ink
 *   compass     Ununited       a ring broken by a four-point star, bevelled
 *   star        Liberty        one big five-point star
 *   wave        Bleu Ciel      two swept ribbons, white over red
 *   sun         Bharat         a disc and twelve heavy wedge rays
 *   moon        Night Freight  a crescent and a four-point star
 *   tulip       Kanal Royal    a three-petal tulip and its leaf
 *   riverlines  Riverdelta     a river dividing, as flowing lines
 *   falcon      Desert Pearl   a falcon's wing curled round a pearl
 *   lattice     Sandline       an eight-point star, interlaced
 *   speedlines  Dash Freight   a forward chevron with speed lines
 *   arrowbox    FlexShip       a parcel in three faces, an arrow cut through
 *   parcel      Parcel Brown   two stacked parcels, no badge round them
 *   seawave     Royal Isles    a breaking wave and its foam
 *   crane       Bosphorus      a standing crane, its neck in an S
 *   pearlshell  Pearl Gulf     an open oyster and its pearl
 *   suncrane    Rising Crane   a crane in flight across a sun
 *   bang        Spit Air       an exclamation mark, leaning in
 *   horizon     OverSea        a sun on the sea line, a gull, in a ring
 *
 * `globe` is kept as another name for the compass (an old saved scheme's).
 *
 * drawEmblem(g, style, S, inks) draws into a cleared S x S 2D context and
 * returns false for a name it does not know. Pure canvas: no THREE.
 */

/** Every mark this file draws. */
export const EMBLEM_STYLES = Object.freeze([
  'stripes', 'compass', 'globe', 'star', 'wave', 'sun', 'moon', 'tulip', 'riverlines', 'falcon', 'lattice',
  'speedlines', 'arrowbox', 'parcel', 'seawave', 'crane', 'pearlshell', 'suncrane', 'bang', 'horizon',
]);

/**
 * A pen on the unit grid. Every coordinate is in units of the square, the
 * centre at (0, 0), +y DOWN (canvas). FORWARD IS LEFT, the port-side view a
 * paint drawing is made in: the fin shows the mirror on the starboard side, so
 * a mark faces the nose on both (./livery-art.js).
 */
function pen(g, S) {
  const c = S / 2;
  const X = (x) => c + x * S;
  const Y = (y) => c + y * S;
  const p = {
    g,
    S,
    begin() {
      g.beginPath();
      return p;
    },
    M(x, y) {
      g.moveTo(X(x), Y(y));
      return p;
    },
    L(x, y) {
      g.lineTo(X(x), Y(y));
      return p;
    },
    Q(cx, cy, x, y) {
      g.quadraticCurveTo(X(cx), Y(cy), X(x), Y(y));
      return p;
    },
    C(ax, ay, bx, by, x, y) {
      g.bezierCurveTo(X(ax), Y(ay), X(bx), Y(by), X(x), Y(y));
      return p;
    },
    A(x, y, r, a0 = 0, a1 = Math.PI * 2, ccw = false) {
      g.arc(X(x), Y(y), r * S, a0, a1, ccw);
      return p;
    },
    E(x, y, rx, ry, rot = 0) {
      g.ellipse(X(x), Y(y), rx * S, ry * S, rot, 0, Math.PI * 2);
      return p;
    },
    Z() {
      g.closePath();
      return p;
    },
    fill(ink) {
      g.fillStyle = ink;
      g.fill();
      return p;
    },
    /** Fill even-odd: a ring, a cut-out. */
    fillEO(ink) {
      g.fillStyle = ink;
      g.fill('evenodd');
      return p;
    },
    stroke(ink, w, cap = 'round') {
      g.strokeStyle = ink;
      g.lineWidth = w * S;
      g.lineCap = cap;
      g.lineJoin = 'round';
      g.stroke();
      return p;
    },
    /** Cut whatever this path covers out of everything drawn so far. */
    cut() {
      g.save();
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = '#000';
      g.fill();
      g.restore();
      return p;
    },
    cutStroke(w, cap = 'round') {
      g.save();
      g.globalCompositeOperation = 'destination-out';
      g.strokeStyle = '#000';
      g.lineWidth = w * S;
      g.lineCap = cap;
      g.lineJoin = 'round';
      g.stroke();
      g.restore();
      return p;
    },
  };
  return p;
}

/** A tapered blade between two curves: from (x0,y0) to (x1,y1), bowed by `bow`, `w` thick at the middle. */
function blade(P, x0, y0, x1, y1, bow, w) {
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L;
  const ny = dx / L;
  // Two control points per side: the bow, plus and minus half the width.
  const ox = nx * bow;
  const oy = ny * bow;
  const hx = nx * w;
  const hy = ny * w;
  P.M(x0, y0)
    .C(x0 + dx * 0.25 + ox + hx, y0 + dy * 0.25 + oy + hy, x0 + dx * 0.75 + ox + hx, y0 + dy * 0.75 + oy + hy, x1, y1)
    .C(x0 + dx * 0.75 + ox - hx, y0 + dy * 0.75 + oy - hy, x0 + dx * 0.25 + ox - hx, y0 + dy * 0.25 + oy - hy, x0, y0)
    .Z();
  return { mx, my };
}

/**
 * A flowing line, filled: a cubic from (x0,y0) to (x1,y1) through controls a
 * and b, half-width w0 narrowing to w1.
 */
function flow(P, ink, x0, y0, ax, ay, bx, by, x1, y1, w0, w1) {
  const unit = (dx, dy) => {
    const L = Math.hypot(dx, dy) || 1;
    return [-dy / L, dx / L];
  };
  const [n0x, n0y] = unit(ax - x0, ay - y0);
  const [n1x, n1y] = unit(x1 - bx, y1 - by);
  const m = (w0 + w1) / 2;
  P.begin()
    .M(x0 + n0x * w0, y0 + n0y * w0)
    .C(ax + n0x * m, ay + n0y * m, bx + n1x * m, by + n1y * m, x1 + n1x * w1, y1 + n1y * w1)
    .L(x1 - n1x * w1, y1 - n1y * w1)
    .C(bx - n1x * m, by - n1y * m, ax - n0x * m, ay - n0y * m, x0 - n0x * w0, y0 - n0y * w0)
    .Z()
    .fill(ink);
}

/** A regular star: `n` points, outer radius R, inner r, first point at angle a0. */
function star(P, cx, cy, n, R, r, a0 = -Math.PI / 2) {
  for (let i = 0; i < n * 2; i++) {
    const a = a0 + (i / (n * 2)) * Math.PI * 2;
    const d = i % 2 ? r : R;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    if (i) P.L(x, y);
    else P.M(x, y);
  }
  return P.Z();
}

/** A rounded polygon through `pts` with corner radius `r` (units). */
function roundPoly(P, pts, r) {
  const n = pts.length;
  const g = P.g;
  const S = P.S;
  const c = S / 2;
  const at = (i) => pts[(i + n) % n];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m0 = mid(at(-1), at(0));
  g.moveTo(c + m0[0] * S, c + m0[1] * S);
  for (let i = 0; i < n; i++) {
    const p0 = at(i);
    const p1 = mid(at(i), at(i + 1));
    g.arcTo(c + p0[0] * S, c + p0[1] * S, c + p1[0] * S, c + p1[1] * S, r * S);
  }
  g.closePath();
  return P;
}

/* ------------------------------------------------------------------ */
/* The marks                                                           */
/* ------------------------------------------------------------------ */

const MARKS = {
  /** Abyssinia: three pennants streaming aft from one point, each its own ink, the gaps between them clean. */
  stripes(P, ink) {
    const rows = [
      [-0.44, 0.34, 0.44, -0.38, -0.09, 0.1],
      [-0.44, 0.34, 0.46, -0.08, -0.05, 0.085],
      [-0.44, 0.34, 0.4, 0.2, 0.0, 0.07],
    ];
    rows.forEach(([x0, y0, x1, y1, bow, w], k) => {
      P.begin();
      blade(P, x0, y0, x1, y1, bow, w);
      P.fill(ink(k));
    });
  },

  /** Ununited: a bold ring and a four-point star that breaks it, each point split light and dark. */
  compass(P, ink) {
    const g = P.g;
    P.begin().A(0, 0, 0.36).A(0, 0, 0.285, 0, Math.PI * 2, true).fill(ink(0));
    // The gaps the long points pass through, cut clean.
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const [ax, ay, px, py] = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a)];
      P.begin().M(ax * 0.2, ay * 0.2).L(ax * 0.5 + px * 0.13, ay * 0.5 + py * 0.13).L(ax * 0.5 - px * 0.13, ay * 0.5 - py * 0.13).Z().cut();
    }
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      const [ax, ay, px, py] = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a)];
      g.save();
      g.globalAlpha = 0.72;
      P.begin().M(ax * 0.27, ay * 0.27).L(px * 0.06, py * 0.06).L(-px * 0.06, -py * 0.06).Z().fill(ink(0));
      g.restore();
    }
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const [ax, ay, px, py] = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a)];
      const R = 0.46;
      P.begin().M(ax * R, ay * R).L(px * 0.095, py * 0.095).L(0, 0).Z().fill(ink(0));
      g.save();
      g.globalAlpha = 0.6;
      P.begin().M(ax * R, ay * R).L(-px * 0.095, -py * 0.095).L(0, 0).Z().fill(ink(0));
      g.restore();
    }
  },

  /** Liberty: one big five-point star, its corners eased, leaning a little into the climb. Nothing else. */
  star(P, ink) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 - 0.16 + (i / 10) * Math.PI * 2;
      const d = i % 2 ? 0.19 : 0.47;
      pts.push([Math.cos(a) * d, Math.sin(a) * d]);
    }
    P.begin();
    roundPoly(P, pts, 0.018);
    P.fill(ink(0));
  },

  /** Bleu Ciel: two ribbons streaming aft and up, a broad one over a fine one, joined at the nose end. */
  wave(P, ink) {
    P.begin()
      .M(-0.46, 0.3)
      .C(-0.2, 0.26, 0.06, 0.02, 0.46, -0.36)
      .C(0.2, -0.22, -0.1, -0.06, -0.46, 0.06)
      .Q(-0.5, 0.18, -0.46, 0.3)
      .Z()
      .fill(ink(0));
    P.begin()
      .M(-0.42, 0.42)
      .C(-0.14, 0.4, 0.16, 0.18, 0.46, -0.16)
      .C(0.22, 0.06, -0.1, 0.26, -0.42, 0.34)
      .Z()
      .fill(ink(1));
  },

  /** Bharat: a sun: a solid disc, a clean ring of air, twelve heavy wedge rays. */
  sun(P, ink) {
    P.begin().A(0, 0, 0.19).fill(ink(0));
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const [ax, ay, px, py] = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a)];
      const r0 = 0.245;
      const r1 = i % 2 ? 0.38 : 0.46;
      const w = 0.062;
      P.begin().M(ax * r1, ay * r1).Q(ax * (r0 + 0.05) + px * w * 0.7, ay * (r0 + 0.05) + py * w * 0.7, ax * r0 + px * w, ay * r0 + py * w).L(ax * r0 - px * w, ay * r0 - py * w).Q(ax * (r0 + 0.05) - px * w * 0.7, ay * (r0 + 0.05) - py * w * 0.7, ax * r1, ay * r1).Z().fill(ink(Math.min(1, i % 2)));
    }
  },

  /** Night Freight: a heavy crescent opening aft, its horns fine, and a four-point star in its arms. */
  moon(P, ink) {
    P.begin().A(-0.05, 0, 0.44).fill(ink(0));
    P.begin().A(0.11, -0.03, 0.37).cut();
    P.begin();
    star(P, 0.15, -0.03, 4, 0.2, 0.05, -Math.PI / 2);
    P.fill(ink(0));
  },

  /** Kanal Royal Dutch: a tulip — three petals, the gaps between them clean — on a curved stem with one leaf. */
  tulip(P, ink) {
    const a = ink(0);
    // The outer petals: a cup, rising to two points.
    P.begin()
      .M(0, 0.12)
      .C(-0.2, 0.12, -0.27, 0.0, -0.26, -0.2)
      .C(-0.26, -0.29, -0.24, -0.34, -0.21, -0.38)
      .C(-0.12, -0.3, -0.06, -0.22, -0.04, -0.12)
      .L(0.04, -0.12)
      .C(0.06, -0.22, 0.12, -0.3, 0.21, -0.38)
      .C(0.24, -0.34, 0.26, -0.29, 0.26, -0.2)
      .C(0.27, 0.0, 0.2, 0.12, 0, 0.12)
      .Z()
      .fill(a);
    // The middle petal, standing in front, taller; the gap round it cut first.
    const mid = () =>
      P.begin()
        .M(0, 0.1)
        .C(-0.11, 0.08, -0.14, -0.06, -0.12, -0.18)
        .C(-0.1, -0.28, -0.05, -0.36, 0, -0.42)
        .C(0.05, -0.36, 0.1, -0.28, 0.12, -0.18)
        .C(0.14, -0.06, 0.11, 0.08, 0, 0.1)
        .Z();
    P.g.save();
    P.g.translate(0, 0);
    mid();
    P.g.lineWidth = 0.035 * P.S;
    P.g.globalCompositeOperation = 'destination-out';
    P.g.stroke();
    P.g.restore();
    mid().fill(a);
    // The stem, curving, and a leaf off it to the left.
    P.begin().M(0, 0.1).C(0.01, 0.22, 0.03, 0.32, 0.06, 0.42).stroke(ink(1), 0.036, 'butt');
    P.begin()
      .M(0.03, 0.34)
      .C(-0.06, 0.32, -0.18, 0.28, -0.26, 0.12)
      .C(-0.14, 0.14, -0.04, 0.2, 0.03, 0.3)
      .Z()
      .fill(ink(1));
  },

  /** Riverdelta: a river seen from the air, one broad stream dividing into flowing lines that wander apart. No outline round them. */
  riverlines(P, ink) {
    const J = [0.04, -0.08];
    flow(P, ink(0), 0.34, -0.47, 0.42, -0.26, 0.14, -0.22, J[0], J[1], 0.06, 0.065);
    flow(P, ink(0), J[0], J[1], -0.08, 0.06, -0.24, -0.16, -0.46, -0.04, 0.055, 0.018);
    flow(P, ink(0), J[0], J[1], -0.04, 0.1, 0.1, 0.26, -0.08, 0.46, 0.055, 0.018);
    flow(P, ink(1), J[0], J[1], 0.12, 0.12, 0.24, 0.14, 0.45, 0.3, 0.05, 0.016);
  },

  /** Desert Pearl: a falcon's wing raised and fanned, five clean feathers from the shoulder, a pearl at its root. */
  falcon(P, ink) {
    const f = [[-0.3, 0.42, -0.3, -0.46, -0.1], [-0.26, 0.42, -0.02, -0.47, -0.11], [-0.22, 0.42, 0.22, -0.4, -0.11], [-0.18, 0.42, 0.4, -0.22, -0.1], [-0.14, 0.42, 0.47, 0.02, -0.08]];
    for (const [x0, y0, x1, y1, bow] of f) {
      P.begin();
      blade(P, x0, y0, x1, y1, bow, 0.085);
      P.fill(ink(0));
    }
    P.begin().A(-0.2, 0.28, 0.2).cut();
    P.begin().A(-0.2, 0.28, 0.155).fill(ink(1));
  },

  /** Sandline: an eight-point star of two squares, interlaced, its heart open, in three inks. */
  lattice(P, ink) {
    const sq = (rot, R) => {
      const pts = [];
      for (let i = 0; i < 4; i++) {
        const a = rot + (i / 4) * Math.PI * 2;
        pts.push([Math.cos(a) * R, Math.sin(a) * R]);
      }
      return pts;
    };
    const R = 0.4;
    // Outer band of each square: the frame, even-odd so the middle stays open.
    const frame = (rot, ink0) => {
      const o = sq(rot, R);
      const i = sq(rot, R - 0.075);
      P.begin();
      roundPoly(P, o, 0.02);
      roundPoly(P, i, 0.01);
      P.fillEO(ink0);
    };
    frame(0, ink(0));
    frame(Math.PI / 4, ink(1));
    // The heart: an octagon rosette in the third ink, an eight-point star cut through it.
    P.begin();
    star(P, 0, 0, 8, 0.2, 0.15, -Math.PI / 2);
    P.fill(ink(2));
    P.begin();
    star(P, 0, 0, 8, 0.11, 0.05, -Math.PI / 2 + Math.PI / 8);
    P.cut();
  },

  /** Dash Freight: a forward chevron, heavy and italic, four speed lines running out aft of it. */
  speedlines(P, ink) {
    P.begin();
    roundPoly(P, [[-0.06, -0.32], [-0.26, -0.32], [-0.46, 0], [-0.26, 0.32], [-0.06, 0.32], [-0.26, 0]], 0.014);
    P.fill(ink(0));
    for (const [x0, y, len] of [[0.12, -0.23, 0.3], [-0.06, -0.08, 0.5], [-0.06, 0.08, 0.5], [0.12, 0.23, 0.3]]) {
      const h = 0.09;
      const sl = 0.05;
      P.begin();
      roundPoly(P, [[x0 + sl, y - h / 2], [x0 + len + sl, y - h / 2], [x0 + len - sl, y + h / 2], [x0 - sl, y + h / 2]], 0.01);
      P.fill(ink(0));
    }
  },

  /** FlexShip: a parcel seen from above a corner — three faces — with an arrow cut clean through it. */
  arrowbox(P, ink) {
    const h = 0.4;
    const cx = 0;
    const cy = 0.02;
    const k = 0.866;
    const top = [[cx, cy - h], [cx + h * k, cy - h / 2], [cx, cy], [cx - h * k, cy - h / 2]];
    const left = [[cx - h * k, cy - h / 2], [cx, cy], [cx, cy + h], [cx - h * k, cy + h / 2]];
    const right = [[cx + h * k, cy - h / 2], [cx + h * k, cy + h / 2], [cx, cy + h], [cx, cy]];
    const face = (pts, inkX, alpha = 1) => {
      P.g.save();
      P.g.globalAlpha = alpha;
      P.begin();
      roundPoly(P, pts, 0.015);
      P.fill(inkX);
      P.g.restore();
    };
    face(top, ink(0));
    face(left, ink(0), 0.78);
    face(right, ink(1));
    // Seams between the faces.
    P.begin().M(cx - h * k, cy - h / 2).L(cx, cy).L(cx + h * k, cy - h / 2).M(cx, cy).L(cx, cy + h).cutStroke(0.018);
    // The arrow, cut through the top and the left face: forward along the box's left edge.
    P.begin()
      .M(-0.3, -0.06)
      .L(-0.02, -0.22)
      .L(-0.06, -0.29)
      .L(0.16, -0.25)
      .L(0.1, -0.04)
      .L(0.06, -0.11)
      .L(-0.22, 0.05)
      .Z()
      .cut();
  },

  /** Parcel Brown: two parcels stacked corner to corner, the seams and tape cut clean. Nothing round them. */
  parcel(P, ink) {
    const k = 0.866;
    const box = (cx, cy, h) => {
      const hull = [[cx, cy - h], [cx + h * k, cy - h / 2], [cx + h * k, cy + h / 2], [cx, cy + h], [cx - h * k, cy + h / 2], [cx - h * k, cy - h / 2]];
      // A clean gap round it, over whatever is behind.
      P.begin();
      roundPoly(P, hull, 0.01);
      P.cutStroke(0.05);
      const face = (pts, alpha) => {
        P.g.save();
        P.g.globalAlpha = alpha;
        P.begin();
        roundPoly(P, pts, 0.01);
        P.fill(ink(0));
        P.g.restore();
      };
      face([[cx, cy - h], [cx + h * k, cy - h / 2], [cx, cy], [cx - h * k, cy - h / 2]], 1);
      face([[cx - h * k, cy - h / 2], [cx, cy], [cx, cy + h], [cx - h * k, cy + h / 2]], 0.8);
      face([[cx + h * k, cy - h / 2], [cx + h * k, cy + h / 2], [cx, cy + h], [cx, cy]], 0.62);
      P.begin().M(cx - h * k, cy - h / 2).L(cx, cy).L(cx + h * k, cy - h / 2).M(cx, cy).L(cx, cy + h).cutStroke(0.016);
      P.begin().M(cx - h * k * 0.5, cy - h * 0.75).L(cx + h * k * 0.5, cy - h * 0.25).cutStroke(0.03, 'butt');
    };
    box(0.12, -0.12, 0.33);
    box(-0.2, 0.2, 0.23);
  },

  /** Royal Isles: one great breaking wave, its crest curling forward over a clean hollow. */
  seawave(P, ink) {
    P.begin()
      .M(0.46, 0.3)
      .C(0.32, 0.02, 0.2, -0.36, -0.14, -0.42)
      .C(-0.34, -0.46, -0.46, -0.3, -0.42, -0.14)
      .C(-0.34, -0.26, -0.22, -0.26, -0.16, -0.16)
      .C(-0.12, -0.06, -0.26, 0.0, -0.3, -0.1)
      .C(-0.36, 0.1, -0.2, 0.3, 0.06, 0.28)
      .C(-0.1, 0.36, -0.3, 0.34, -0.46, 0.3)
      .Z()
      .fill(ink(0));
    P.begin().M(-0.46, 0.4).C(-0.16, 0.46, 0.2, 0.4, 0.46, 0.34).C(0.2, 0.34, -0.16, 0.38, -0.46, 0.34).Z().fill(ink(1));
  },

  /** Bosphorus: a crane in a clean solid disc: one bold bird, neck an S, cut out of the sun behind it. */
  crane(P, ink) {
    const a = ink(0);
    P.begin()
      .M(-0.02, -0.04)
      .C(0.1, -0.12, 0.26, -0.06, 0.34, 0.06)
      .C(0.4, 0.14, 0.44, 0.24, 0.46, 0.34)
      .C(0.38, 0.28, 0.32, 0.24, 0.26, 0.22)
      .C(0.14, 0.2, 0.02, 0.16, -0.06, 0.08)
      .C(-0.1, 0.04, -0.08, 0, -0.02, -0.04)
      .Z()
      .fill(a);
    P.begin().M(-0.03, 0.03).C(-0.2, -0.04, -0.03, -0.2, -0.12, -0.33).stroke(a, 0.08);
    P.begin().E(-0.13, -0.35, 0.065, 0.05, -0.2).fill(a);
    P.begin().M(-0.15, -0.39).L(-0.46, -0.3).L(-0.14, -0.31).Z().fill(a);
    P.begin().A(-0.12, -0.365, 0.016).cut();
    P.begin().M(0.1, 0.17).L(0.06, 0.46).stroke(a, 0.034, 'butt');
    P.begin().M(0.18, 0.18).L(0.27, 0.32).L(0.14, 0.37).stroke(a, 0.03);
  },

  /** Pearl Gulf: an oyster open on its hinge, the lid raised, a pearl resting in the lower valve. */
  pearlshell(P, ink) {
    const a = ink(0);
    // The lower valve, a shallow bowl, the hinge aft.
    P.begin().M(0.44, 0.2).C(0.34, 0.44, -0.2, 0.5, -0.46, 0.22).C(-0.2, 0.32, 0.14, 0.32, 0.44, 0.2).Z().fill(a);
    // The lid, raised on the hinge.
    P.begin().M(0.45, 0.17).C(0.52, -0.1, 0.36, -0.42, 0.0, -0.46).C(-0.08, -0.46, -0.14, -0.44, -0.2, -0.4).C(0.06, -0.34, 0.28, -0.12, 0.34, 0.16).Z().fill(a);
    // Its frill and growth lines, cut.
    for (const [x, y] of [[0.42, -0.2], [0.27, -0.37], [0.09, -0.46]]) P.begin().A(x, y, 0.035).cut();
    P.begin().M(0.38, 0.1).C(0.34, -0.1, 0.2, -0.28, 0.02, -0.38).cutStroke(0.016);
    // The pearl, resting in the bowl.
    P.begin().A(-0.08, 0.12, 0.16).fill(ink(1));
  },

  /** Rising Crane: a crane flying forward across a whole sun, a clean line of air round the bird. */
  suncrane(P, ink) {
    P.begin().A(0.02, 0.1, 0.33).fill(ink(1));
    const bird = () => {
      P.begin();
      // Neck, body and trailing legs: one long blade, nose to tail.
      blade(P, -0.46, -0.07, 0.46, 0.15, -0.01, 0.05);
      // The raised wing, swept up and aft, its tip split.
      P.M(-0.13, -0.04).C(-0.12, -0.26, 0.04, -0.42, 0.3, -0.46).C(0.22, -0.34, 0.2, -0.2, 0.2, -0.1).C(0.2, -0.04, 0.16, 0.01, 0.1, 0.03).Z();
    };
    bird();
    P.g.lineWidth = 0.05 * P.S;
    P.g.lineJoin = 'round';
    P.g.save();
    P.g.globalCompositeOperation = 'destination-out';
    P.g.stroke();
    P.g.restore();
    bird();
    P.fill(ink(0));
  },

  /** Spit Air: an exclamation mark, leaning into its hurry: a tapered bar and a round dot. */
  bang(P, ink) {
    P.g.save();
    P.g.translate(P.S / 2, P.S / 2);
    P.g.transform(1, 0, -0.18, 1, 0, 0);
    P.g.translate(-P.S / 2, -P.S / 2);
    P.begin()
      .M(-0.1, -0.36)
      .Q(-0.1, -0.42, -0.04, -0.42)
      .L(0.04, -0.42)
      .Q(0.1, -0.42, 0.1, -0.36)
      .L(0.045, 0.1)
      .Q(0.04, 0.14, 0.0, 0.14)
      .Q(-0.04, 0.14, -0.045, 0.1)
      .Z()
      .fill(ink(0));
    P.begin().A(0, 0.3, 0.08).fill(ink(0));
    P.g.restore();
  },

  /** OverSea: a bold ring round a sun on the sea line, two swells under it. */
  horizon(P, ink) {
    P.begin().A(0, 0, 0.45).A(0, 0, 0.375, 0, Math.PI * 2, true).fill(ink(0));
    P.g.save();
    P.begin().A(0, 0, 0.335);
    P.g.clip();
    P.begin().A(0, 0.04, 0.2).fill(ink(1));
    P.begin().M(-0.5, 0.04).L(0.5, 0.04).L(0.5, 0.5).L(-0.5, 0.5).Z().cut();
    const swell = (y, w) => {
      P.begin().M(-0.44, y);
      for (let i = 0; i < 3; i++) P.Q(-0.35 + i * 0.3, y - 0.06, -0.29 + i * 0.3, y).Q(-0.2 + i * 0.3, y + 0.06, -0.14 + i * 0.3, y);
      P.stroke(ink(0), w, 'butt');
    };
    swell(0.12, 0.055);
    swell(0.24, 0.055);
    P.g.restore();
  },
};
MARKS.globe = MARKS.compass;

/**
 * Draw `style` into the S x S context `g` in `inks` (css colours; the last is
 * reused when a mark wants more than were given). False for a name this file
 * does not know (the caller draws its plain disc).
 */
export function drawEmblem(g, style, S, inks) {
  const fn = MARKS[style];
  if (!fn || !g || typeof g.beginPath !== 'function') return false;
  const list = Array.isArray(inks) && inks.length ? inks : ['#f4f6f8'];
  const ink = (i) => list[Math.min(i, list.length - 1)];
  g.save();
  try {
    fn(pen(g, S), ink);
  } finally {
    g.restore();
  }
  return true;
}
