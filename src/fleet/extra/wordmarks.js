/**
 * The airlines' names, drawn as wordmarks.
 *
 * The owner, twice: "now make sure FONTS ARE GOOD", then "come on, you cant
 * even fix the FONTS????". A name set with fillText in a nice font is still
 * default text on a tube. A real airline's name is a drawing: its own case,
 * spacing and proportions, usually one idea you remember it by, sometimes a
 * small line under it or a second, smaller line. So each name here is a lockup:
 * rows of letters placed one at a time (kerned by the face's own pairs, then by
 * hand where a pair still gaps), in the airline's own inks, with its one idea
 * drawn in paths: Parcel Brown stands
 * on a length of gold tape, Spit Air's I is an exclamation mark, Riverdelta stands on a
 * river that forks at its mouth.
 *
 * Every drawing is the game's own and every airline a parody: no real logotype
 * is traced, and no real airline's typeface is used (render/airline-fonts.js).
 * All colours are the scheme's own (aircraft/liveries.js).
 *
 * A spec:
 *   reads    what it says, for the tests and the console
 *   idea     the one thing it is remembered by, in a few words
 *   inks     [main, second, ...], colours out of the scheme
 *   rows     [{ runs: [{ t, f, ink, cap, gap, hollow, shape, w }], cap, track, gap, align, justify }]
 *              cap     cap height, 1 = the first row's
 *              track   letter spacing, em
 *              gap     (a row) the space over this row, in caps
 *              align   'left', 'right', 'centre' in the block
 *              justify tracked out to the first row's width
 *              (a run) t the letters; f another face; ink an index into inks;
 *              gap the space before it, in caps; hollow an outline this thick
 *              (em) instead of a fill; shape + w a drawn glyph (see SHAPES), w caps wide
 *   kern     { 'AV': -0.05 } extra kerning for a pair, em
 *   skew     forward lean (tan of the angle)
 *   bold     fine strokes fattened, em
 *   mark     { h, gap } the airline's mark ahead of the name, h caps tall
 *   deco     (d) => { ... } the small details, over the letters; see `tools` below
 *   room     { t, b, l, r } caps of room the details need outside the letters
 *   stack    what changes when the name is set in two rows (stackedWordmark)
 *
 * Pure canvas, no THREE. In node (no canvas to ask) a stand-in measure is used,
 * and every number below still comes out, so the placement can be tested.
 */
import { canvasFont, fontsLoaded } from '../../render/airline-fonts.js';
import { markCanvas } from './livery-art.js';

const JOST7 = { family: 'Jost', weight: 700, style: 'normal' };

/** A five-pointed star. */
function starPath(g, cx, cy, R, r = R * 0.42) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const q = i % 2 ? r : R;
    g[i ? 'lineTo' : 'moveTo'](cx + q * Math.cos(a), cy + q * Math.sin(a));
  }
  g.closePath();
}

/** Drawn glyphs: (g, x, base, w, cap, ink), in the design's own coordinates, y down. */
const SHAPES = {
  /** An exclamation mark that stands in for an I: a wedge and a ball. */
  bang(g, x, base, w, cap, ink) {
    g.fillStyle = ink;
    const ball = w * 0.5;
    g.beginPath();
    g.moveTo(x, base - cap);
    g.lineTo(x + w, base - cap);
    g.lineTo(x + w * 0.68, base - ball * 2 - cap * 0.08);
    g.lineTo(x + w * 0.32, base - ball * 2 - cap * 0.08);
    g.closePath();
    g.fill();
    g.beginPath();
    g.arc(x + w / 2, base - ball, ball, 0, Math.PI * 2);
    g.fill();
  },
  /** A star, as the word space. */
  star(g, x, base, w, cap, ink) {
    g.fillStyle = ink;
    starPath(g, x + w / 2, base - cap * 0.5, w / 2);
    g.fill();
  },
  /** A slash taller than the letters, as the word space. */
  slash(g, x, base, w, cap, ink) {
    const lean = cap * 0.3;
    g.fillStyle = ink;
    g.beginPath();
    g.moveTo(x, base + cap * 0.12);
    g.lineTo(x + lean, base - cap * 1.12);
    g.lineTo(x + w, base - cap * 1.12);
    g.lineTo(x + w - lean, base + cap * 0.12);
    g.closePath();
    g.fill();
  },
  /** A long dash, cut on the slant, as the word space. */
  dash(g, x, base, w, cap, ink) {
    const lean = cap * 0.12;
    const [top, foot] = [base - cap * 0.62, base - cap * 0.38];
    g.fillStyle = ink;
    g.beginPath();
    g.moveTo(x, foot);
    g.lineTo(x + lean, top);
    g.lineTo(x + w, top);
    g.lineTo(x + w - lean, foot);
    g.closePath();
    g.fill();
  },
  /** One small wave, as the word space. */
  wave(g, x, base, w, cap, ink) {
    const y = base - cap * 0.5;
    const a = cap * 0.3;
    g.strokeStyle = ink;
    g.lineWidth = cap * 0.15;
    g.lineCap = 'butt';
    g.beginPath();
    g.moveTo(x, y + a * 0.35);
    g.bezierCurveTo(x + w * 0.3, y - a * 1.5, x + w * 0.7, y + a * 1.5, x + w, y - a * 0.35);
    g.stroke();
  },
  /** A round dot, as the word space. */
  pearl(g, x, base, w, cap, ink) {
    g.fillStyle = ink;
    g.beginPath();
    g.arc(x + w / 2, base - cap * 0.46, w / 2, 0, Math.PI * 2);
    g.fill();
  },
};

/** A spec's `deco` and `under` get `d`: { g, W, cap, foot, glyphs, ink(i), row(i), rule, cut, text }. */
export const WORDMARKS = {
  abyssinia: {
    reads: 'Abyssinia Air',
    idea: 'warm sans, the acacia ahead, AIR tucked under the tail of the word',
    inks: ['#262c66', '#b4462b'],
    mark: { h: 1.72, gap: 0.34, inks: ['#b4462b'] },
    rows: [
      { runs: [{ t: 'Abyssinia' }], track: 0.004 },
      { runs: [{ t: 'AIR', ink: 1 }], cap: 0.4, track: 0.44, align: 'right', gap: 0.2 },
    ],
    kern: { Ab: -0.012, ss: 0.004 },
    bold: 0.006,
  },
  continental: {
    reads: 'UNUNITED',
    idea: 'the UN of it hollow, the UNITED solid',
    inks: ['#0d2f56'],
    rows: [{ runs: [{ t: 'UN', hollow: 0.07 }, { t: 'UNITED', gap: 0.05 }], track: 0.13 }],
    room: { l: 0.08, t: 0.05, b: 0.05 },
  },
  liberty: {
    reads: 'LIBERTY AIR',
    idea: 'a star for the word space, the AIR in red',
    inks: ['#12306b', '#c8102e'],
    rows: [{ runs: [{ t: 'LIBERTY' }, { shape: 'star', w: 0.74, ink: 1, gap: 0.3 }, { t: 'AIR', ink: 1, gap: 0.3 }], track: 0.075 }],
    kern: { LI: -0.01, RT: -0.015, TY: -0.03, AI: -0.012 },
    stack: {
      rows: [
        { runs: [{ t: 'LIBERTY' }], track: 0.075 },
        { runs: [{ shape: 'star', w: 0.8, ink: 1 }, { t: 'AIR', ink: 1, gap: 0.24 }], cap: 0.86, track: 0.2, align: 'right', gap: 0.26 },
      ],
    },
  },
  bleuciel: {
    reads: 'bleu ciel',
    idea: 'one lowercase word in two colours, round as the sky',
    inks: ['#12306b', '#c8142a'],
    rows: [{ runs: [{ t: 'bleu' }, { t: 'ciel', ink: 1, gap: 0.05 }], track: 0.012 }],
    kern: { ci: 0.01, el: 0.012 },
  },
  bharat: {
    reads: 'Bharat Air',
    idea: 'a flowing italic on a long saffron swash',
    inks: ['#960d15', '#e8721f'],
    rows: [{ runs: [{ t: 'Bharat' }, { t: 'Air', gap: 0.3 }], track: 0.012 }],
    bold: 0.016,
    room: { b: 0.36 },
    deco(d) {
      const { g, W, cap } = d;
      g.fillStyle = d.ink(1);
      g.beginPath();
      g.moveTo(cap * 0.1, cap * 0.14);
      g.bezierCurveTo(W * 0.3, cap * 0.38, W * 0.68, cap * 0.38, W * 1.01, cap * 0.04);
      g.bezierCurveTo(W * 0.7, cap * 0.2, W * 0.32, cap * 0.2, cap * 0.1, cap * 0.14);
      g.closePath();
      g.fill();
    },
  },
  nightfreight: {
    reads: 'NIGHT FREIGHT',
    idea: 'condensed cargo capitals split by the body\'s amber slash',
    inks: ['#e9eef2', '#f0b24a'],
    rows: [{ runs: [{ t: 'NIGHT' }, { shape: 'slash', w: 0.52, ink: 1, gap: 0.14 }, { t: 'FREIGHT', ink: 1, gap: 0.1 }], track: 0.05 }],
    kern: { GH: -0.005, HT: -0.008, RE: -0.005 },
    room: { t: 0.14, b: 0.14 },
    stack: {
      rows: [
        { runs: [{ t: 'NIGHT' }], track: 0.05, justify: true },
        { runs: [{ t: 'FREIGHT', ink: 1 }], track: 0.05, justify: true, gap: 0.2 },
      ],
      room: null,
    },
  },
  krd: {
    reads: 'KANAL ROYAL DUTCH',
    idea: 'one heavy word, the other two stacked at its side',
    inks: ['#072c54'],
    rows: [{ runs: [{ t: 'KANAL' }], track: 0.018 }],
    kern: { KA: -0.03, AN: -0.008, NA: -0.008, AL: -0.018 },
    room: { r: 3.16 },
    deco(d) {
      const { g, W, cap } = d;
      const x = W + cap * 0.2;
      g.fillStyle = d.ink(0);
      g.fillRect(x, -cap, cap * 0.05, cap);
      d.text('ROYAL', x + cap * 0.2, -cap * 0.56, cap * 0.44, 0.13);
      d.text('DUTCH', x + cap * 0.2, 0, cap * 0.44, 0.13);
    },
  },
  riverdelta: {
    reads: 'RIVERDELTA',
    idea: 'heavy capitals on a red river that forks at its mouth',
    inks: ['#003a70', '#c8102e'],
    rows: [{ runs: [{ t: 'RIVER' }, { t: 'DELTA', gap: 0.03 }], track: 0.035 }],
    kern: { RI: -0.004, IV: -0.012, VE: -0.024, ER: -0.004, RD: -0.01, LT: -0.05, TA: -0.05 },
    room: { b: 0.44 },
    deco(d) {
      // One line along the foot of the word, dividing in two under the last letters.
      const { g, W, cap } = d;
      const y = cap * 0.2;
      const th = cap * 0.05;
      const fork = W * 0.74;
      g.fillStyle = d.ink(1);
      g.beginPath();
      g.moveTo(0, y - th * 0.4);
      g.lineTo(fork, y - th);
      g.bezierCurveTo(fork + W * 0.08, y - th, W * 0.92, y - cap * 0.06, W, y - cap * 0.06);
      g.lineTo(W, y + cap * 0.0);
      g.bezierCurveTo(W * 0.92, y, fork + W * 0.1, y + th * 0.2, fork + W * 0.04, y + th * 0.5);
      g.bezierCurveTo(fork + W * 0.11, y + th, W * 0.9, y + cap * 0.17, W, y + cap * 0.19);
      g.lineTo(W, y + cap * 0.25);
      g.bezierCurveTo(W * 0.9, y + cap * 0.23, fork + W * 0.07, y + th * 1.4, fork, y + th);
      g.lineTo(0, y + th * 0.4);
      g.closePath();
      g.fill();
    },
  },
  desertpearl: {
    reads: 'Desert Pearl',
    idea: 'a fine serif, a gold pearl for the space, AIRLINES between hairlines',
    inks: ['#7d5a10', '#c8a24a'],
    rows: [
      { runs: [{ t: 'Desert' }, { shape: 'pearl', w: 0.24, ink: 1, gap: 0.12 }, { t: 'Pearl', gap: 0.12 }], track: 0.006 },
      { runs: [{ t: 'AIRLINES', f: JOST7 }], cap: 0.28, track: 0.56, align: 'centre', gap: 0.3 },
    ],
    bold: 0.012,
    kern: { rt: -0.006, Pe: -0.03 },
    deco(d) {
      const r = d.row(1);
      const y = r.base - r.cap * 0.5;
      const th = d.cap * 0.036;
      d.rule(0, r.x0 - d.cap * 0.22, y, th, d.ink(1));
      d.rule(r.x1 + d.cap * 0.22, d.W, y, th, d.ink(1));
    },
  },
  sandline: {
    reads: 'SANDLINE',
    idea: 'classical capitals over a long tapering line, a star at its middle',
    inks: ['#523a18', '#7a5a30'],
    rows: [{ runs: [{ t: 'SANDLINE' }], track: 0.17 }],
    kern: { AN: -0.02, LI: -0.012 },
    bold: 0.01,
    room: { b: 0.4 },
    deco(d) {
      const { g, W, cap } = d;
      const y = cap * 0.25;
      g.fillStyle = d.ink(1);
      g.beginPath();
      g.moveTo(0, y);
      g.quadraticCurveTo(W * 0.3, y - cap * 0.035, W / 2, y - cap * 0.035);
      g.quadraticCurveTo(W * 0.7, y - cap * 0.035, W, y);
      g.quadraticCurveTo(W * 0.7, y + cap * 0.035, W / 2, y + cap * 0.035);
      g.quadraticCurveTo(W * 0.3, y + cap * 0.035, 0, y);
      g.fill();
      for (let i = 0; i < 2; i++) {
        const R = cap * 0.15;
        const r = R * 0.34;
        g.beginPath();
        for (let k = 0; k < 16; k++) {
          const a = (k * Math.PI) / 8 + (i * Math.PI) / 8;
          const q = k % 2 ? r : R;
          g[k ? 'lineTo' : 'moveTo'](W / 2 + q * Math.sin(a), y + q * Math.cos(a));
        }
        g.closePath();
        g.fill();
      }
    },
  },
  dashfreight: {
    reads: 'DASH FREIGHT',
    idea: 'a fast italic with speed cut through the D, a coral dash for the space',
    inks: ['#f5f7fb', '#ff6b4a'],
    bold: 0.012,
    rows: [{ runs: [{ t: 'DASH' }, { shape: 'dash', w: 1.1, ink: 1, gap: 0.1 }, { t: 'FREIGHT', gap: 0.12 }], track: 0.018 }],
    skew: 0.05,
    kern: { AS: -0.01, RE: -0.008, HT: -0.008 },
    stack: {
      rows: [
        { runs: [{ t: 'DASH' }, { shape: 'dash', w: 1.34, ink: 1, gap: 0.12 }], track: 0.018 },
        { runs: [{ t: 'FREIGHT' }], track: 0.018, justify: true, gap: 0.22 },
      ],
    },
    deco(d) {
      // Two speed lines cut through the front of the first letter.
      const q = d.glyphs[0];
      const { cap } = d;
      d.cut(q.x - cap * 0.2, -cap * 0.68, q.w * 0.72 + cap * 0.2, cap * 0.075);
      d.cut(q.x - cap * 0.2, -cap * 0.4, q.w * 0.52 + cap * 0.2, cap * 0.075);
    },
  },
  flexship: {
    reads: 'FlexShip',
    idea: 'open round letters, one lime x, a lime bar under Ship',
    inks: ['#2b3138', '#8fc31f'],
    rows: [{ runs: [{ t: 'Fle' }, { t: 'x', ink: 1 }, { t: 'Ship', gap: 0.04 }], track: 0.03 }],
    kern: { Fl: -0.01, ex: -0.01 },
    room: { b: 0.22 },
    deco(d) {
      const q = d.glyphs[4];
      d.rule(q.x, d.W, d.cap * 0.16, d.cap * 0.075, d.ink(1));
    },
  },
  parcelbrown: {
    reads: 'PARCEL BROWN',
    idea: 'big confident condensed capitals on one thick length of gold parcel tape',
    inks: ['#351c15', '#ffb500'],
    rows: [{ runs: [{ t: 'PARCEL' }, { t: 'BROWN', gap: 0.42 }], track: 0.05 }],
    kern: { AR: -0.01, RC: -0.005, RO: -0.005, OW: -0.015, WN: -0.01 },
    room: { b: 0.3 },
    stack: {
      rows: [
        { runs: [{ t: 'PARCEL' }], track: 0.05, justify: true },
        { runs: [{ t: 'BROWN' }], track: 0.05, justify: true, gap: 0.2 },
      ],
    },
    deco(d) {
      d.rule(0, d.W, d.foot + d.cap * 0.14, d.cap * 0.15, d.ink(1));
    },
  },
  royalisles: {
    reads: 'ROYAL ISLES',
    idea: 'upright spaced capitals, one red wave for the word space',
    inks: ['#0d2f6b', '#eb2226'],
    rows: [{ runs: [{ t: 'ROYAL' }, { shape: 'wave', w: 0.92, ink: 1, gap: 0.26 }, { t: 'ISLES', gap: 0.26 }], track: 0.11 }],
    kern: { OY: -0.03, YA: -0.05, AL: -0.02 },
    stack: {
      rows: [
        { runs: [{ t: 'ROYAL' }], track: 0.11, justify: true },
        { runs: [{ t: 'ISLES', ink: 1 }], track: 0.11, justify: true, gap: 0.24 },
      ],
    },
  },
  bosphorus: {
    reads: 'Bosphorus',
    idea: 'a tight round geometric, a red rule from the crane',
    inks: ['#1b1f5c', '#c70a0c'],
    mark: { h: 1.6, gap: 0.5, inks: ['#c70a0c'] },
    rows: [{ runs: [{ t: 'Bosphorus' }], track: -0.006 }],
    kern: { Bo: -0.012, ph: 0.006, us: -0.004 },
    deco(d) {
      d.rule(-d.markGap * 0.5 - d.cap * 0.022, -d.markGap * 0.5 + d.cap * 0.022, 0, 0, d.ink(1), -d.cap * 1.1, d.cap * 0.34);
    },
  },
  pearlgulf: {
    reads: 'PEARL GULF',
    idea: 'wide serif capitals on a fine hairline, one pearl in the word space',
    inks: ['#5c0632'],
    rows: [{ runs: [{ t: 'PEARL' }, { shape: 'pearl', w: 0.26, gap: 0.3 }, { t: 'GULF', gap: 0.3 }], track: 0.14 }],
    bold: 0.014,
    kern: { EA: -0.01, AR: -0.02, LF: -0.01 },
    room: { b: 0.22 },
    stack: {
      rows: [
        { runs: [{ t: 'PEARL' }], track: 0.12, justify: true },
        { runs: [{ t: 'GULF' }], track: 0.12, justify: true, gap: 0.26 },
      ],
    },
    deco(d) {
      d.rule(0, d.W, d.foot + d.cap * 0.14, d.cap * 0.055, d.ink(0));
    },
  },
  risingcrane: {
    reads: 'RISING CRANE',
    idea: 'two words stacked to one width beside the sun-crane',
    inks: ['#1a1a1a', '#b60005'],
    mark: { h: 1.94, gap: 0.36, inks: ['#b60005', '#ffd166'] },
    rows: [
      { runs: [{ t: 'RISING' }], cap: 0.86, track: 0.1 },
      { runs: [{ t: 'CRANE', ink: 1 }], cap: 0.86, track: 0.1, justify: true, gap: 0.24 },
    ],
    kern: { RA: -0.02, AN: -0.01 },
  },
  spit: {
    reads: 'SPIT AIR',
    idea: 'loud black capitals, the I an exclamation mark, leaning in',
    inks: ['#1a1a1a'],
    rows: [{ runs: [{ t: 'SP' }, { shape: 'bang', w: 0.3, gap: 0.08 }, { t: 'T', gap: 0.08 }, { t: 'AIR', gap: 0.34 }], track: -0.008 }],
    skew: 0.13,
    kern: { AI: -0.02 },
  },
  oversea: {
    reads: 'OverSea',
    idea: 'a sporty italic in two sea blues, a gold arc riding over it',
    inks: ['#084a62', '#0f6e8c', '#f2b84b'],
    rows: [{ runs: [{ t: 'Over' }, { t: 'Sea', ink: 1, gap: 0.03 }], track: 0.004 }],
    room: { t: 0.42 },
    kern: { Ov: -0.03, ve: -0.008, Se: -0.004 },
    deco(d) {
      const { g, W, cap } = d;
      g.fillStyle = d.ink(2);
      g.beginPath();
      g.moveTo(cap * 0.2, -cap * 1.02);
      g.bezierCurveTo(W * 0.32, -cap * 1.52, W * 0.72, -cap * 1.46, W * 1.02, -cap * 0.86);
      g.bezierCurveTo(W * 0.74, -cap * 1.28, W * 0.34, -cap * 1.32, cap * 0.2, -cap * 1.02);
      g.closePath();
      g.fill();
    },
  },
  potus: {
    reads: 'UNITED STATES OF AMERICA',
    idea: 'wide formal serif capitals, nothing else',
    inks: ['#1c365e'],
    rows: [{ runs: [{ t: 'UNITED STATES OF AMERICA' }], track: 0.09 }],
    kern: { AT: -0.04, TA: -0.04, TE: -0.012, ME: -0.005 },
    bold: 0.008,
  },
};

/** The wordmark of a scheme, or null. */
export const wordmarkFor = (scheme) => (scheme && WORDMARKS[scheme.id]) || null;

/**
 * The same name in two rows, for a short wide room (the 747's, between its door
 * and its wing, or a turboprop's), or null if it only comes in one line.
 */
export function stackedWordmark(spec) {
  if (!spec || !spec.stack) return null;
  return { ...spec, ...spec.stack, stack: null, key: `${spec.reads}|stacked` };
}

/* ------------------------------------------------------------------ *
 * Layout
 * ------------------------------------------------------------------ */

let meter = null;
function ask() {
  try {
    meter = meter || document.createElement('canvas').getContext('2d');
  } catch (e) {
    return null;
  }
  return meter && typeof meter.measureText === 'function' && Number.isFinite(meter.measureText('H').width) ? meter : null;
}
const caps = new Map();
/** A face's cap height, a share of the em. */
function capShare(font) {
  const key = `${font.family}/${font.weight}/${font.style}`;
  if (caps.has(key)) return caps.get(key);
  const m = ask();
  let c = 0.7;
  if (m) {
    m.font = canvasFont(font, 100);
    const got = m.measureText('H').actualBoundingBoxAscent / 100;
    if (got > 0.2 && got < 1.2) c = got;
  }
  if (fontsLoaded()) caps.set(key, c);
  return c;
}
/** A letter's advance beside its neighbour, kerned as the face kerns them: px at 100 px to the em. */
function advance(ch, next, font) {
  const m = ask();
  if (!m) return { adv: 62, ink: 62, up: 70, down: /[gjpqy]/.test(ch) ? 20 : 0 };
  m.font = canvasFont(font, 100);
  if ('fontKerning' in m) m.fontKerning = 'normal';
  const one = m.measureText(ch);
  const adv = next ? m.measureText(ch + next).width - m.measureText(next).width : one.width;
  return { adv, ink: one.width, up: one.actualBoundingBoxAscent || 0, down: one.actualBoundingBoxDescent || 0 };
}

const words = (rows) => rows.map((r) => r.runs.map((u) => u.t || '').join('')).join('');
const layouts = new Map();

/**
 * Where everything goes, in caps of the first row: `glyphs`, `rowsAt`, the
 * letters' own width `W`, and `box`, everything's extent round the first
 * row's baseline at x 0: { x0, x1, y0, y1 }. `aspect` is the box's width over
 * its height and `h` its height in caps.
 */
export function layoutWordmark(spec, font) {
  const key = spec.key || spec.reads;
  if (fontsLoaded() && layouts.has(key)) return layouts.get(key);
  const glyphs = [];
  const rowsAt = [];
  const kern = spec.kern || {};
  spec.rows.forEach((row) => {
    const rowCap = row.cap ?? 1;
    const list = [];
    let x = 0;
    row.runs.forEach((run, u) => {
      const f = run.f || font;
      x += (run.gap || 0);
      if (run.shape) {
        list.push({ shape: run.shape, x, w: run.w * rowCap, ink: run.ink || 0, cap: rowCap, track: 0 });
        x += run.w * rowCap;
        return;
      }
      const em = rowCap / capShare(f);
      const next = row.runs[u + 1];
      for (let i = 0; i < run.t.length; i++) {
        const ch = run.t[i];
        const after = run.t[i + 1] || null;
        const a = advance(ch, after, f);
        list.push({ ch, f, em, x, w: (a.ink / 100) * em, ink: run.ink || 0, hollow: run.hollow || 0, up: (a.up / 100) * em, down: (a.down / 100) * em, run: u });
        x += (a.adv / 100) * em;
        if (after) x += ((kern[ch + after] || 0) + (row.track || 0)) * em;
        else if (next) x += (row.track || 0) * em;
      }
    });
    rowsAt.push({ list, w: x, cap: rowCap, row, base: 0, x0: 0, x1: 0 });
  });
  const W = Math.max(...rowsAt.map((r) => r.w));
  let y = 0;
  rowsAt.forEach((r, i) => {
    if (i) y += (r.row.gap ?? 0.3) + r.cap;
    r.base = y;
    // A row tracked out to the first row's width.
    if (r.row.justify) {
      const n = r.list.length - 1;
      const extra = n > 0 ? (W - r.w) / n : 0;
      r.list.forEach((q, k) => (q.x += extra * k));
      r.w = W;
    }
    const off = r.row.align === 'right' ? W - r.w : r.row.align === 'centre' ? (W - r.w) / 2 : 0;
    r.x0 = off;
    r.x1 = off + r.w;
    for (const q of r.list) {
      q.x += off;
      q.y = r.base;
      glyphs.push(q);
    }
  });
  const room = spec.room || {};
  const skew = spec.skew || 0;
  // The ink's real extent. Descenders count: nothing may be clipped by the patch.
  const low = Math.max(y + (room.b || 0), ...glyphs.map((q) => q.y + (q.down || 0)));
  const high = Math.min(-1 - (room.t || 0), ...glyphs.map((q) => q.y - (q.up || 0)));
  const lean = skew * Math.max(-high, low);
  const mark = spec.mark;
  const markW = mark ? mark.h + mark.gap : 0;
  const box = { x0: -markW - lean * 0.1 - (room.l || 0), x1: W + lean + (room.r || 0), y0: high, y1: low };
  if (mark) {
    box.y0 = Math.min(box.y0, (high + low) / 2 - mark.h / 2);
    box.y1 = Math.max(box.y1, (high + low) / 2 + mark.h / 2);
  }
  const out = { glyphs, rowsAt, W, box, skew, w: box.x1 - box.x0, h: box.y1 - box.y0, aspect: (box.x1 - box.x0) / (box.y1 - box.y0), rows: spec.rows.length, text: words(spec.rows) };
  if (fontsLoaded()) layouts.set(key, out);
  return out;
}

/* ------------------------------------------------------------------ *
 * Drawing
 * ------------------------------------------------------------------ */

/**
 * Draw the wordmark to fill a W x H canvas (a little margin all round: the
 * patch's edge must stay transparent). `emblem` is the scheme's mark.
 */
export function paintWordmark(g, spec, font, W, H, emblem) {
  const L = layoutWordmark(spec, font);
  const pad = Math.max(2, H * 0.03);
  const s = Math.min((W - pad * 2) / L.w, (H - pad * 2) / L.h);
  g.clearRect(0, 0, W, H);
  g.save();
  g.translate((W - L.w * s) / 2 - L.box.x0 * s, (H - L.h * s) / 2 - L.box.y0 * s);
  g.scale(s, s);
  const ink = (i) => spec.inks[Math.min(i, spec.inks.length - 1)];
  if ('fontKerning' in g) g.fontKerning = 'none'; // each letter is placed by hand
  if ('textRendering' in g) g.textRendering = 'geometricPrecision';
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  if ('imageSmoothingQuality' in g) g.imageSmoothingQuality = 'high';

  /** One letter. (Set at 100 times the size and scaled: canvas fonts stop at 1 px, and a cap here is 1.) */
  const letter = (ch, f, em, x, y, c, hollow = 0, bold = 0) => {
    const px = em * 100;
    g.save();
    g.translate(x, y);
    g.scale(0.01, 0.01);
    g.font = canvasFont(f, px);
    g.strokeStyle = c;
    g.fillStyle = c;
    if (hollow) {
      g.lineJoin = 'miter';
      g.miterLimit = 3;
      g.lineWidth = hollow * px;
      g.strokeText(ch, 0, 0);
    } else {
      g.fillText(ch, 0, 0);
      if (bold) {
        g.lineJoin = 'round';
        g.lineWidth = bold * px;
        g.strokeText(ch, 0, 0);
      }
    }
    g.restore();
  };

  const tools = {
    g, W: L.W, cap: 1, glyphs: L.glyphs, ink, markGap: spec.mark ? spec.mark.gap : 0,
    foot: L.rowsAt[L.rowsAt.length - 1].base,
    row: (i) => {
      const r = L.rowsAt[i];
      return { base: r.base, cap: r.cap, x0: r.x0, x1: r.x1 };
    },
    /** A flat line; or, with y0/y1, an upright one. */
    rule(x0, x1, y, th, c, y0, y1) {
      g.fillStyle = c;
      if (y0 != null) g.fillRect(x0, y0, x1 - x0, y1 - y0);
      else g.fillRect(x0, y, x1 - x0, th);
    },
    /** Take a slot out of the letters: the paint behind shows through. */
    cut(x, y, w, h) {
      g.save();
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = '#000';
      g.fillRect(x, y, w, h);
      g.restore();
    },
    /** A line of small letters in the main face. */
    text(t, x, base, cap, track, i = 0) {
      const em = cap / capShare(font);
      let at = x;
      for (let k = 0; k < t.length; k++) {
        letter(t[k], font, em, at, base, ink(i));
        const a = advance(t[k], t[k + 1] || null, font);
        at += (a.adv / 100) * em + track * em;
      }
    },
  };

  // The mark first, level with the letters' middle, outside the skew.
  if (spec.mark && emblem) {
    const m = markCanvas(emblem, spec.mark.inks, 256);
    const size = spec.mark.h / ((m.inkR || 0.42) * 2);
    const cx = -spec.mark.gap - spec.mark.h / 2;
    const cy = (L.box.y0 + L.box.y1) / 2;
    if (typeof g.drawImage === 'function') g.drawImage(m, cx - size / 2, cy - size / 2, size, size);
  }
  if (L.skew) g.transform(1, 0, -L.skew, 1, 0, 0);
  if (spec.under) spec.under(tools);
  for (const q of L.glyphs) {
    if (q.shape) {
      SHAPES[q.shape](g, q.x, q.y, q.w, q.cap, ink(q.ink));
      continue;
    }
    letter(q.ch, q.f, q.em, q.x, q.y, ink(q.ink), q.hollow, spec.bold);
  }
  if (spec.deco) spec.deco(tools);
  g.restore();
  // A trace of the lightest ink under everything: a transparent pixel is black to the
  // texture filter, which would edge pale letters in grey at any distance.
  const light = spec.inks.reduce((a, b) => (luma(b) > luma(a) ? b : a), spec.inks[0]);
  if (luma(light) > 0.45 && typeof g.fillRect === 'function') {
    g.save();
    g.globalCompositeOperation = 'destination-over';
    g.globalAlpha = 1 / 255;
    g.fillStyle = light;
    g.fillRect(0, 0, W, H);
    g.restore();
  }
}

function luma(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  if (!Number.isFinite(n)) return 0;
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}
