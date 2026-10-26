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
 *   stripes     Abyssinia      three swept pennants, one per ink
 *   compass     Ununited       an eight-point compass rose, bevelled
 *   star        Liberty        a five-point star in flight, three trails
 *   wave        Bleu Ciel      two swept ribbons, white over red
 *   sun         Bharat         a sun-wheel: a disc and sixteen lens rays
 *   moon        Night Freight  a crescent and a four-point star
 *   tulip       Kanal Royal    a three-petal tulip and its leaf
 *   wavetri     Riverdelta     a rounded delta cut by a river
 *   falcon      Desert Pearl   a falcon's wing curled round a pearl
 *   lattice     Sandline       an eight-point star, interlaced
 *   speedlines  Dash Freight   a forward chevron with speed lines
 *   arrowbox    FlexShip       a parcel in three faces, an arrow cut through
 *   parcel      Parcel Brown   a parcel inside a hexagon badge
 *   seawave     Royal Isles    a breaking wave and its foam
 *   crane       Bosphorus      a standing crane, its neck in an S
 *   antelope    Pearl Gulf     a gazelle's head and lyre horns
 *   suncrane    Rising Crane   a crane in flight over a rising sun
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
  'stripes', 'compass', 'globe', 'star', 'wave', 'sun', 'moon', 'tulip', 'wavetri', 'falcon', 'lattice',
  'speedlines', 'arrowbox', 'parcel', 'seawave', 'crane', 'antelope', 'suncrane', 'bang', 'horizon',
]);

/**
 * A pen on the unit grid. Every coordinate is in units of the square, the
 * centre at (0, 0), +y DOWN (canvas), so a mark reads the same on both sides
 * of the fin (finEmblem mirrors the UVs on the left).
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
  /** Abyssinia: three pennants swept up and back, each its own ink, the gaps between them clean. */
  stripes(P, ink) {
    const rows = [
      [-0.36, 0.3, 0.3, -0.24],
      [-0.3, 0.4, 0.38, -0.12],
      [-0.4, 0.2, 0.22, -0.36],
    ];
    // Back to front: the middle one first so the gaps cut through the outer two cleanly.
    const order = [1, 0, 2];
    for (const k of order) {
      const [x0, y0, x1, y1] = rows[k];
      P.begin();
      blade(P, x0, y0, x1, y1, -0.07, 0.085);
      P.fill(ink(k));
    }
  },

  /** Ununited: an eight-point compass rose, each long point split light and dark, in a fine ring. */
  compass(P, ink) {
    const R = 0.42;
    const g = P.g;
    // The ring, with a gap at each cardinal point where the long points pass through it.
    P.begin().A(0, 0, 0.33).A(0, 0, 0.3, 0, Math.PI * 2, true).fill(ink(0));
    // Short points (the diagonals), quieter.
    g.save();
    g.globalAlpha = 0.72;
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const ax = Math.cos(a);
      const ay = Math.sin(a);
      const px = -ay;
      const py = ax;
      P.begin().M(ax * 0.24, ay * 0.24).L(px * 0.045, py * 0.045).L(-px * 0.045, -py * 0.045).Z().fill(ink(0));
    }
    g.restore();
    // Long points: each a kite, its two halves in full and three-quarter ink — the bevel a rose is drawn with.
    for (let i = 0; i < 4; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 2;
      const ax = Math.cos(a);
      const ay = Math.sin(a);
      const px = -ay;
      const py = ax;
      const len = i === 0 ? R : R * 0.9;
      P.begin().M(ax * len, ay * len).L(px * 0.075, py * 0.075).L(0, 0).Z().fill(ink(0));
      g.save();
      g.globalAlpha = 0.62;
      P.begin().M(ax * len, ay * len).L(-px * 0.075, -py * 0.075).L(0, 0).Z().fill(ink(0));
      g.restore();
    }
    // The hub, cut through.
    P.begin().A(0, 0, 0.03).cut();
  },

  /** Liberty: a five-point star leaning into its climb, three trails cut behind it. */
  star(P, ink) {
    P.begin();
    star(P, 0.1, -0.06, 5, 0.3, 0.125, -Math.PI / 2 + 0.2);
    P.fill(ink(0));
    // Trails: tapered, longest in the middle, from the star's trailing side.
    const trails = [
      [-0.07, 0.12, -0.44, 0.3, 0.045],
      [-0.01, 0.21, -0.34, 0.39, 0.036],
      [-0.14, 0.03, -0.42, 0.16, 0.03],
    ];
    for (const [x0, y0, x1, y1, w] of trails) {
      P.begin();
      blade(P, x1, y1, x0, y0, 0, w);
      P.fill(ink(0));
    }
  },

  /** Bleu Ciel: two ribbons sweeping up and aft, a broad one over a fine one. */
  wave(P, ink) {
    // The broad ribbon: a band between two near-parallel curves that pinches at both ends.
    P.begin()
      .M(-0.44, 0.22)
      .C(-0.2, 0.2, 0.02, -0.02, 0.44, -0.3)
      .C(0.1, -0.12, -0.14, 0.06, -0.44, 0.06)
      .Q(-0.47, 0.14, -0.44, 0.22)
      .Z()
      .fill(ink(0));
    // The fine one under it, the second ink, with a clear gap between.
    P.begin()
      .M(-0.4, 0.34)
      .C(-0.16, 0.32, 0.1, 0.12, 0.44, -0.16)
      .C(0.14, 0.04, -0.12, 0.22, -0.4, 0.27)
      .Q(-0.42, 0.3, -0.4, 0.34)
      .Z()
      .fill(ink(1));
  },

  /** Bharat: a sun-wheel — a disc, a ring cut round it, and sixteen lens-shaped rays, long and short. */
  sun(P, ink) {
    P.begin().A(0, 0, 0.17).fill(ink(0));
    P.begin().A(0, 0, 0.11).cut();
    P.begin().A(0, 0, 0.075).fill(ink(0));
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const r0 = 0.21;
      const r1 = i % 2 ? 0.34 : 0.42;
      const w = i % 2 ? 0.03 : 0.04;
      const ax = Math.cos(a);
      const ay = Math.sin(a);
      const px = -ay;
      const py = ax;
      const mx = (r0 + r1) / 2;
      P.begin()
        .M(ax * r0, ay * r0)
        .Q(ax * mx + px * w, ay * mx + py * w, ax * r1, ay * r1)
        .Q(ax * mx - px * w, ay * mx - py * w, ax * r0, ay * r0)
        .Z()
        .fill(ink(Math.min(1, i % 2)));
    }
  },

  /** Night Freight: a crescent, its horns fine, and a four-point star in its arms. */
  moon(P, ink) {
    P.begin().A(-0.04, 0.02, 0.38).fill(ink(0));
    P.begin().A(0.1, -0.06, 0.33).cut();
    P.begin();
    star(P, 0.2, -0.04, 4, 0.13, 0.03, -Math.PI / 2);
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

  /** Riverdelta: a delta with rounded corners, a river cut across its lower third, the bank below in the second ink. */
  wavetri(P, ink) {
    const tri = [[0, -0.4], [0.42, 0.34], [-0.42, 0.34]];
    P.begin();
    roundPoly(P, tri, 0.06);
    P.fill(ink(0));
    // The lower part in the second ink, clipped to the delta.
    P.g.save();
    P.begin();
    roundPoly(P, tri, 0.06);
    P.g.clip();
    P.begin().M(-0.5, 0.1).C(-0.22, -0.02, 0.0, 0.2, 0.5, 0.02).L(0.5, 0.5).L(-0.5, 0.5).Z().fill(ink(1));
    P.g.restore();
    // The river between them: a clean gap, wider in the middle.
    P.begin().M(-0.5, 0.1).C(-0.22, -0.02, 0.0, 0.2, 0.5, 0.02).cutStroke(0.04, 'butt');
  },

  /** Desert Pearl: a falcon's head in profile, hooked beak, the dark stripe under its eye, a pearl for the eye. */
  falcon(P, ink) {
    const a = ink(0);
    P.begin()
      .M(0.3, 0.42)
      .C(0.34, 0.2, 0.34, 0.0, 0.26, -0.16)
      .C(0.18, -0.32, 0.02, -0.4, -0.12, -0.36)
      .C(-0.22, -0.33, -0.3, -0.26, -0.34, -0.18)
      .C(-0.39, -0.12, -0.41, -0.06, -0.4, -0.0)
      .C(-0.38, -0.03, -0.36, -0.05, -0.33, -0.06)
      .L(-0.3, -0.04)
      .C(-0.26, 0.02, -0.2, 0.04, -0.14, 0.04)
      .C(-0.12, 0.16, -0.06, 0.3, 0.0, 0.42)
      .Z()
      .fill(a);
    // The beak's cutting edge and the cere, cut clean.
    P.begin().M(-0.34, -0.14).C(-0.3, -0.1, -0.24, -0.08, -0.18, -0.1).cutStroke(0.018);
    // The malar stripe: a teardrop down from the eye, the falcon's moustache, as negative space.
    P.begin().M(-0.06, -0.12).C(-0.02, -0.04, -0.02, 0.08, -0.06, 0.18).C(-0.1, 0.08, -0.12, -0.04, -0.06, -0.12).Z().cut();
    // The pearl: the eye, in the second ink, a fine clear ring round it.
    P.begin().A(-0.13, -0.18, 0.068).cut();
    P.begin().A(-0.13, -0.18, 0.05).fill(ink(1));
    P.begin().E(-0.145, -0.195, 0.014, 0.01, -0.6).cut();
    // The neck cut off square-ish at the base, on a slant, as a crest is drawn.
    P.begin().M(-0.1, 0.46).L(0.5, 0.3).L(0.5, 0.5).L(-0.1, 0.5).Z().cut();
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

  /** Dash Freight: a forward chevron, heavy and italic, three speed lines running out behind it. */
  speedlines(P, ink) {
    // The chevron: two slanted bars meeting at a point, forward is +x.
    P.begin();
    roundPoly(P, [[0.06, -0.3], [0.22, -0.3], [0.44, 0], [0.22, 0.3], [0.06, 0.3], [0.27, 0]], 0.014);
    P.fill(ink(0));
    // Speed lines: parallelograms, the same slant, shorter as they go out.
    const lines = [
      [-0.12, -0.2, 0.3],
      [-0.06, -0.06, 0.38],
      [-0.06, 0.08, 0.38],
      [-0.12, 0.22, 0.3],
    ];
    for (const [x1, y, len] of lines) {
      const h = 0.07;
      const sl = 0.04;
      P.begin();
      roundPoly(P, [[x1 - len + sl, y - h / 2], [x1 + sl, y - h / 2], [x1 - sl * 0.2, y + h / 2], [x1 - len - sl * 0.2, y + h / 2]], 0.01);
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

  /** Parcel Brown: a hexagon badge (a ring), a parcel inside it with its tape. */
  parcel(P, ink) {
    const hex = (R) => {
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        pts.push([Math.cos(a) * R, Math.sin(a) * R]);
      }
      return pts;
    };
    P.begin();
    roundPoly(P, hex(0.43), 0.06);
    roundPoly(P, hex(0.355), 0.045);
    P.fillEO(ink(0));
    // The parcel: a cube's three faces, the top in full ink, the sides deeper.
    const h = 0.2;
    const k = 0.866;
    const cy = 0.02;
    const top = [[0, cy - h], [h * k, cy - h / 2], [0, cy], [-h * k, cy - h / 2]];
    const left = [[-h * k, cy - h / 2], [0, cy], [0, cy + h], [-h * k, cy + h / 2]];
    const right = [[h * k, cy - h / 2], [h * k, cy + h / 2], [0, cy + h], [0, cy]];
    P.begin();
    roundPoly(P, top, 0.01);
    P.fill(ink(0));
    P.g.save();
    P.g.globalAlpha = 0.82;
    P.begin();
    roundPoly(P, left, 0.01);
    P.fill(ink(0));
    P.g.restore();
    P.g.save();
    P.g.globalAlpha = 0.64;
    P.begin();
    roundPoly(P, right, 0.01);
    P.fill(ink(0));
    P.g.restore();
    // Seams and the tape across the top, cut clean.
    P.begin().M(-h * k, cy - h / 2).L(0, cy).L(h * k, cy - h / 2).M(0, cy).L(0, cy + h).cutStroke(0.014);
    P.begin().M(-h * k * 0.5, cy - h * 0.75).L(h * k * 0.5, cy - h * 0.25).cutStroke(0.03, 'butt');
  },

  /** Royal Isles: a swell rising to a crest that curls over, and a fine line of foam under it — two ribbons. */
  seawave(P, ink) {
    const wave = () => P.begin().M(-0.44, 0.28).C(-0.12, 0.26, 0.1, 0.08, 0.19, -0.14).C(0.25, -0.29, 0.39, -0.36, 0.44, -0.24).C(0.48, -0.13, 0.37, -0.07, 0.31, -0.14);
    wave().stroke(ink(0), 0.085);
    // The tail tapers to nothing: shave it from below.
    P.begin().M(-0.5, 0.0).L(-0.44, 0.0).L(-0.44, 0.5).L(-0.5, 0.5).Z().cut();
    P.begin().M(-0.44, 0.246).L(-0.18, 0.29).L(-0.18, 0.5).L(-0.44, 0.5).Z().cut();
    // Foam: a fine ribbon under the swell, in the second ink, tapering the same way.
    P.begin()
      .M(-0.42, 0.42)
      .C(-0.14, 0.4, 0.1, 0.26, 0.28, 0.0)
      .C(0.14, 0.3, -0.14, 0.45, -0.42, 0.46)
      .Z()
      .fill(ink(1));
  },

  /** Bosphorus: a crane standing, its neck an S, beak level, one leg straight and one drawn up. */
  crane(P, ink) {
    const a = ink(0);
    // Body and tail plumes, one shape.
    P.begin()
      .M(-0.12, -0.02)
      .C(-0.04, -0.1, 0.16, -0.08, 0.26, 0.02)
      .C(0.34, 0.08, 0.42, 0.16, 0.44, 0.24)
      .C(0.36, 0.2, 0.3, 0.18, 0.24, 0.16)
      .C(0.26, 0.2, 0.28, 0.24, 0.28, 0.28)
      .C(0.18, 0.22, 0.06, 0.18, -0.04, 0.12)
      .C(-0.12, 0.08, -0.16, 0.04, -0.12, -0.02)
      .Z()
      .fill(a);
    // The neck: an S from the breast up to the head.
    P.begin().M(-0.1, 0.0).C(-0.24, -0.08, -0.08, -0.22, -0.16, -0.32).stroke(a, 0.05);
    // The head and the beak, pointing forward (-x).
    P.begin().E(-0.17, -0.34, 0.045, 0.034, -0.2).fill(a);
    P.begin().M(-0.2, -0.36).L(-0.42, -0.31).L(-0.2, -0.32).Z().fill(a);
    // A crown cut from the head.
    P.begin().A(-0.155, -0.355, 0.012).cut();
    // Legs: one straight down, one drawn up with its foot tucked.
    P.begin().M(0.06, 0.16).L(0.04, 0.44).stroke(a, 0.022, 'butt');
    P.begin().M(0.12, 0.16).L(0.2, 0.3).L(0.1, 0.34).stroke(a, 0.02);
    P.begin().M(0.0, 0.44).L(0.1, 0.44).stroke(a, 0.018);
  },

  /** Pearl Gulf: a gazelle's head held high, muzzle forward, two horns swept back like a lyre. */
  antelope(P, ink) {
    const a = ink(0);
    // Head and neck, one silhouette.
    P.begin()
      .M(0.26, 0.44)
      .C(0.22, 0.26, 0.16, 0.06, 0.08, -0.08)
      .C(0.04, -0.14, -0.02, -0.18, -0.08, -0.16)
      .C(-0.16, -0.12, -0.24, -0.04, -0.3, 0.04)
      .C(-0.34, 0.09, -0.32, 0.13, -0.27, 0.13)
      .C(-0.2, 0.12, -0.12, 0.1, -0.06, 0.08)
      .C(-0.02, 0.2, 0.02, 0.32, 0.06, 0.44)
      .Z()
      .fill(a);
    // The horns: long, ringed at the base, rising back and turning in at the tips.
    P.begin().M(-0.06, -0.15).C(-0.08, -0.3, 0.0, -0.42, 0.12, -0.46).C(0.06, -0.4, 0.01, -0.3, 0.0, -0.15).Z().fill(a);
    P.begin().M(0.0, -0.14).C(0.02, -0.28, 0.12, -0.38, 0.26, -0.4).C(0.17, -0.34, 0.08, -0.26, 0.05, -0.12).Z().fill(a);
    for (const t of [0.22, 0.27]) {
      P.begin().M(-0.075, -t).L(-0.01, -t + 0.015).cutStroke(0.01, 'butt');
      P.begin().M(0.0, -t + 0.01).L(0.05, -t + 0.02).cutStroke(0.01, 'butt');
    }
    // The ear, a leaf laid back.
    P.begin().M(0.06, -0.1).C(0.14, -0.16, 0.24, -0.18, 0.3, -0.16).C(0.22, -0.1, 0.14, -0.06, 0.08, -0.06).Z().fill(a);
    // Eye and nostril, cut through; the white blaze down the face.
    P.begin().E(-0.1, -0.08, 0.022, 0.014, -0.5).cut();
    P.begin().E(-0.28, 0.06, 0.012, 0.008, -0.6).cut();
    P.begin().M(-0.04, -0.13).C(-0.12, -0.08, -0.2, -0.02, -0.25, 0.04).cutStroke(0.012);
  },

  /** Rising Crane: a crane in flight over a sun half risen — neck out, legs trailing, one wing raised. */
  suncrane(P, ink) {
    // The sun on the horizon, and the horizon, in the second ink.
    P.g.save();
    P.begin().M(-0.5, -0.5).L(0.5, -0.5).L(0.5, 0.3).L(-0.5, 0.3).Z();
    P.g.clip();
    P.begin().A(0, 0.3, 0.2).fill(ink(1));
    P.g.restore();
    P.begin();
    roundPoly(P, [[-0.42, 0.34], [0.42, 0.34], [0.42, 0.375], [-0.42, 0.375]], 0.017);
    P.fill(ink(1));
    // Rays: three short ones, cut as gaps in the sun's rim (the way a rising sun is drawn).
    for (const a of [-2.3, -1.57, -0.84]) {
      P.begin().M(Math.cos(a) * 0.12, 0.3 + Math.sin(a) * 0.12).L(Math.cos(a) * 0.24, 0.3 + Math.sin(a) * 0.24).cutStroke(0.02, 'butt');
    }
    const w = ink(0);
    // The body, slender, a little nose-down.
    P.begin().E(0.02, -0.02, 0.13, 0.045, 0.12).fill(w);
    // Neck out ahead, the head and a long beak.
    P.begin();
    blade(P, -0.08, -0.02, -0.36, -0.08, 0.01, 0.022);
    P.fill(w);
    P.begin().A(-0.37, -0.085, 0.032).fill(w);
    P.begin().M(-0.39, -0.1).L(-0.49, -0.06).L(-0.38, -0.068).Z().fill(w);
    // Legs trailing aft, past the tail.
    P.begin();
    blade(P, 0.1, 0.02, 0.46, 0.06, 0.0, 0.012);
    P.fill(w);
    // The near wing, raised high: a long blade with its primaries spread at the tip.
    P.begin()
      .M(-0.08, -0.04)
      .C(-0.06, -0.24, 0.08, -0.38, 0.32, -0.44)
      .C(0.26, -0.38, 0.22, -0.3, 0.2, -0.22)
      .C(0.16, -0.14, 0.12, -0.06, 0.08, -0.02)
      .Z()
      .fill(w);
    for (const [x0, y0, x1, y1] of [[0.32, -0.42, 0.22, -0.32], [0.29, -0.35, 0.2, -0.27], [0.25, -0.28, 0.18, -0.21]]) {
      P.begin().M(x0, y0).L(x1, y1).cutStroke(0.012);
    }
    // The far wing, down and back behind the body.
    P.begin()
      .M(-0.02, 0.0)
      .C(0.06, 0.08, 0.16, 0.12, 0.28, 0.13)
      .C(0.2, 0.08, 0.12, 0.02, 0.08, -0.02)
      .Z()
      .fill(w);
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

  /** OverSea: a ring; inside it a sun on the sea line, three swells, and a gull over the water. */
  horizon(P, ink) {
    P.begin().A(0, 0, 0.42).A(0, 0, 0.365, 0, Math.PI * 2, true).fill(ink(0));
    P.g.save();
    P.begin().A(0, 0, 0.33);
    P.g.clip();
    // The sun, half risen, in the second ink.
    P.begin().A(0.08, 0.06, 0.15).fill(ink(1));
    // The sea: three swells, the top one cutting the sun's lower half away.
    P.begin().M(-0.5, 0.06).L(0.5, 0.06).L(0.5, 0.5).L(-0.5, 0.5).Z().cut();
    const swell = (y, w) => {
      P.begin().M(-0.44, y);
      for (let i = 0; i < 4; i++) P.Q(-0.385 + i * 0.22, y - 0.045, -0.33 + i * 0.22, y).Q(-0.275 + i * 0.22, y + 0.045, -0.22 + i * 0.22, y);
      P.stroke(ink(0), w, 'butt');
    };
    swell(0.12, 0.034);
    swell(0.2, 0.028);
    swell(0.27, 0.022);
    P.g.restore();
    // The gull: two arcs meeting at the body, left of the sun.
    P.begin()
      .M(-0.24, -0.12)
      .Q(-0.17, -0.2, -0.1, -0.12)
      .Q(-0.03, -0.2, 0.04, -0.12)
      .Q(-0.03, -0.16, -0.1, -0.1)
      .Q(-0.17, -0.16, -0.24, -0.12)
      .Z()
      .fill(ink(0));
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
