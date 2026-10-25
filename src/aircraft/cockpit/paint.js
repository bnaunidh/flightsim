/**
 * Shared instrument painting, for every cockpit.
 *
 * Everything here draws into a 2D canvas and is meant to be called ONCE, when
 * a panel's static art is made — bezels, dial faces, tick marks, arcs and
 * lettering never change, so they are never repainted. What moves (needles,
 * the attitude ball, the heading card) is either drawn on top per frame by
 * the old canvas panel (panel-canvas.js) or, in the new cockpits, is a mesh
 * that turns over the painted face (gauges.js), which costs no painting and
 * no texture upload at all.
 *
 * The functions take canvas pixels. A face painter takes its centre and its
 * dial radius `r`; the bezel round it is `r + 11` at the old panel's scale
 * and `r * 1.1` when `bezel` is given as a fraction.
 */

export const FACE = '#0e1013';
export const TEXT = '#e8eaee';
export const DIM = '#9aa0a8';

/**
 * A milled aluminium bezel.
 *
 * Three passes, which is what makes it read as metal rather than a grey circle:
 * a lit rim (light from the top left, the direction the cabin light comes
 * from), a chamfer that catches that light along its upper edge and falls into
 * shadow along its lower one, and a contact shadow underneath so the
 * instrument sits *in* the panel instead of on top of a picture of one.
 *
 * `rim` is the bezel's width in pixels (11 on the old 1600 px panel).
 */
export function ring(ctx, x, y, r, rim = 11) {
  const k = rim / 11;
  // Contact shadow first, offset down — the instrument is proud of the panel.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 16 * k;
  ctx.shadowOffsetY = 7 * k;
  ctx.fillStyle = '#2a2e34';
  ctx.beginPath();
  ctx.arc(x, y, r + rim, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // The bezel ring, lit from the top left.
  const g = ctx.createLinearGradient(x - r, y - r, x + r * 0.7, y + r);
  g.addColorStop(0, '#878d96');
  g.addColorStop(0.3, '#5b6169');
  g.addColorStop(0.62, '#3a3f46');
  g.addColorStop(1, '#20242a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r + rim, 0, Math.PI * 2);
  ctx.fill();

  // Chamfer: a bright arc across the top, a dark one across the bottom.
  ctx.lineWidth = 3 * k;
  ctx.strokeStyle = 'rgba(255,255,255,0.30)';
  ctx.beginPath();
  ctx.arc(x, y, r + rim - 1.5 * k, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.arc(x, y, r + rim - 1.5 * k, Math.PI * 0.08, Math.PI * 0.92);
  ctx.stroke();

  // Four bezel screws, at the corners like the real thing.
  ctx.fillStyle = '#9aa1aa';
  for (const a of [0.78, 2.36, 3.93, 5.5]) {
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * (r + rim * 0.55), y + Math.sin(a) * (r + rim * 0.55), 2.6 * k, 0, Math.PI * 2);
    ctx.fill();
  }

  // The dial face, very slightly domed by a radial gradient.
  const f = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  f.addColorStop(0, '#171a1f');
  f.addColorStop(1, '#0a0c0f');
  ctx.fillStyle = f;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // Inner shadow where the glass meets the dial.
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 4 * k;
  ctx.beginPath();
  ctx.arc(x, y, r - 2 * k, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * The reflection in the instrument glass. Drawn last, over the needles, so it
 * sits where glass actually is. Kept faint — a real dial you can still read.
 */
export function glassOver(ctx, x, y, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  const g = ctx.createLinearGradient(x - r, y - r, x + r * 0.4, y + r * 0.8);
  g.addColorStop(0, 'rgba(255,255,255,0.13)');
  g.addColorStop(0.42, 'rgba(255,255,255,0.03)');
  g.addColorStop(0.43, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

export function label(ctx, x, y, text, size = 15, color = DIM, align = 'center', weight = 600) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

export function arc(ctx, x, y, r, a0, a1, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(x, y, r, a0, a1);
  ctx.stroke();
}

export function needle(ctx, x, y, angle, len, width, color, tail = 0.18) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-width, -len * tail);
  ctx.lineTo(-width * 0.45, -len);
  ctx.lineTo(width * 0.45, -len);
  ctx.lineTo(width, -len * tail);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

/** A seeded speckle, the wrinkle finish every light-aircraft panel has. */
export function wrinkle(ctx, x0, y0, w, h, count, seed = 20240611, light = 0.035, dark = 0.07, size = 2) {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < count; i++) {
    const x = x0 + rnd() * w;
    const y = y0 + rnd() * h;
    const v = rnd();
    ctx.fillStyle = v > 0.5 ? `rgba(255,255,255,${light})` : `rgba(0,0,0,${dark})`;
    ctx.fillRect(x, y, 1 + rnd() * size, 1 + rnd() * size);
  }
}

/* ------------------------------------------------------------------ *
 * Dial faces
 *
 * One function per instrument. Each paints the bezel and the face with its
 * markings, and nothing that moves. Angles follow the old panel: 0 is
 * straight up, clockwise positive, in radians.
 * ------------------------------------------------------------------ */

/** Tick marks + optional numbers on a dial, from a value -> angle function. */
export function ticks(ctx, x, y, r, angleOf, values, { major = () => true, len = [26, 32], width = [1.6, 3], numbers = null, numberR = 50, size = 19, outer = 12, color = TEXT } = {}) {
  ctx.strokeStyle = color;
  for (const v of values) {
    const ang = angleOf(v);
    const M = major(v);
    ctx.lineWidth = M ? width[1] : width[0];
    const r0 = r - (M ? len[1] : len[0]);
    ctx.beginPath();
    ctx.moveTo(x + Math.sin(ang) * r0, y - Math.cos(ang) * r0);
    ctx.lineTo(x + Math.sin(ang) * (r - outer), y - Math.cos(ang) * (r - outer));
    ctx.stroke();
    if (numbers && M) {
      const t = numbers(v);
      if (t != null) label(ctx, x + Math.sin(ang) * (r - numberR), y - Math.cos(ang) * (r - numberR), String(t), size, color);
    }
  }
}

/** Arc between two dial values, in the dial's own angle convention. */
export function band(ctx, x, y, r, angleOf, lo, hi, color, width) {
  arc(ctx, x, y, r, angleOf(lo) - Math.PI / 2, angleOf(hi) - Math.PI / 2, color, width);
}

/**
 * Airspeed indicator. `o = { min, max, sweepDeg, start, white:[lo,hi],
 * green:[lo,hi], yellow:[lo,hi], red, step, majorStep }` in knots.
 * Returns the value -> angle function the needle must use.
 */
export function asiFace(ctx, x, y, r, o = {}, rim) {
  const { min = 40, max = 170, start = -140, sweepDeg = 300 } = o;
  ring(ctx, x, y, r, rim ?? r * 0.1);
  const s = r / 108;
  const a = (kt) => (start + ((kt - min) / (max - min)) * sweepDeg) * (Math.PI / 180);
  if (o.white) band(ctx, x, y, r - 14 * s, a, o.white[0], o.white[1], '#e8eaee', 7 * s);
  if (o.green) band(ctx, x, y, r - 24 * s, a, o.green[0], o.green[1], '#3ec96a', 9 * s);
  if (o.yellow) band(ctx, x, y, r - 24 * s, a, o.yellow[0], o.yellow[1], '#f2c53d', 9 * s);
  if (o.red != null) {
    // The red line itself: a radial bar at Vne.
    const ang = a(o.red);
    ctx.strokeStyle = '#e8402a';
    ctx.lineWidth = 5 * s;
    ctx.beginPath();
    ctx.moveTo(x + Math.sin(ang) * (r - 34 * s), y - Math.cos(ang) * (r - 34 * s));
    ctx.lineTo(x + Math.sin(ang) * (r - 10 * s), y - Math.cos(ang) * (r - 10 * s));
    ctx.stroke();
  }
  const step = o.step || 10;
  const majorStep = o.majorStep || 20;
  const vals = [];
  for (let kt = min; kt <= max + 1e-6; kt += step) vals.push(kt);
  ticks(ctx, x, y, r, a, vals, {
    major: (kt) => Math.abs(kt % majorStep) < 1e-6,
    len: [26 * s, 32 * s],
    width: [1.6 * s, 3 * s],
    outer: 12 * s,
    numbers: (kt) => kt,
    numberR: 50 * s,
    size: Math.round(19 * s),
  });
  label(ctx, x, y + 44 * s, 'AIRSPEED', Math.round(13 * s), DIM);
  label(ctx, x, y + 62 * s, 'KNOTS', Math.round(11 * s), DIM);
  return a;
}

/** Altimeter: 0-9 round the dial (hundreds of feet on the long needle). */
export function altFace(ctx, x, y, r, rim) {
  ring(ctx, x, y, r, rim ?? r * 0.1);
  const s = r / 108;
  const vals = [];
  for (let i = 0; i < 50; i++) vals.push(i);
  ticks(ctx, x, y, r, (i) => (i / 50) * Math.PI * 2, vals, {
    major: (i) => i % 5 === 0,
    len: [22 * s, 30 * s],
    width: [1.4 * s, 3 * s],
    outer: 10 * s,
    numbers: (i) => i / 5,
    numberR: 50 * s,
    size: Math.round(20 * s),
  });
  label(ctx, x, y - 40 * s, 'ALT', Math.round(13 * s), DIM);
  label(ctx, x, y + 50 * s, '100 FEET', Math.round(10 * s), DIM);
}

/** Vertical speed: +/- 2000 fpm over +/- 150 degrees, zero at nine o'clock. */
export function vsiFace(ctx, x, y, r, rim) {
  ring(ctx, x, y, r, rim ?? r * 0.1);
  const s = r / 100;
  const a = (v) => (v / 2000) * 150 * (Math.PI / 180) - Math.PI / 2;
  const vals = [];
  for (let v = -2000; v <= 2000; v += 250) vals.push(v);
  ticks(ctx, x, y, r, a, vals, {
    major: (v) => v % 500 === 0,
    len: [20 * s, 28 * s],
    width: [1.4 * s, 3 * s],
    outer: 8 * s,
    numbers: (v) => (v % 1000 === 0 ? Math.abs(v / 100) : null),
    numberR: 48 * s,
    size: Math.round(17 * s),
  });
  label(ctx, x + 8 * s, y - 30 * s, 'UP', Math.round(11 * s), DIM);
  label(ctx, x + 8 * s, y + 30 * s, 'DOWN', Math.round(11 * s), DIM);
  label(ctx, x + 22 * s, y + 4 * s, 'VERTICAL SPEED', Math.round(8 * s), DIM);
  label(ctx, x + 22 * s, y + 16 * s, '100 FT/MIN', Math.round(8 * s), DIM);
  return a;
}

/** Attitude indicator bezel only: the ball is drawn by whoever owns it. */
export function aiFace(ctx, x, y, r, rim) {
  ring(ctx, x, y, r, rim ?? r * 0.1);
}

/** Heading indicator bezel + the lubber mark at the top. */
export function hiFace(ctx, x, y, r, rim) {
  ring(ctx, x, y, r, rim ?? r * 0.1);
  const s = r / 108;
  ctx.fillStyle = '#f2c53d';
  ctx.beginPath();
  ctx.moveTo(x, y - r + 4 * s);
  ctx.lineTo(x - 9 * s, y - r + 22 * s);
  ctx.lineTo(x + 9 * s, y - r + 22 * s);
  ctx.closePath();
  ctx.fill();
}

/** Turn coordinator: the standard-rate marks, L / R, and the slip tube. */
export function tcFace(ctx, x, y, r, rim) {
  ring(ctx, x, y, r, rim ?? r * 0.1);
  const s = r / 100;
  ctx.strokeStyle = TEXT;
  ctx.lineWidth = 3 * s;
  // Wings level and standard-rate marks, as on the real dial: horizontal
  // marks at nine and three, and the "rate one" marks below them.
  for (const side of [-1, 1]) {
    for (const off of [Math.PI / 2, Math.PI / 2 + 0.33]) {
      const ang = side * off;
      ctx.beginPath();
      ctx.moveTo(x + Math.sin(ang) * (r - 24 * s), y - 6 * s - Math.cos(ang) * (r - 24 * s));
      ctx.lineTo(x + Math.sin(ang) * (r - 8 * s), y - 6 * s - Math.cos(ang) * (r - 8 * s));
      ctx.stroke();
    }
  }
  label(ctx, x - (r - 30 * s), y + 30 * s, 'L', Math.round(15 * s), TEXT);
  label(ctx, x + (r - 30 * s), y + 30 * s, 'R', Math.round(15 * s), TEXT);
  label(ctx, x, y - 44 * s, 'TURN COORDINATOR', Math.round(9 * s), DIM);
  label(ctx, x, y + r - 18 * s, '2 MIN', Math.round(9 * s), DIM);
  // Slip/skid tube.
  ctx.strokeStyle = '#2b3037';
  ctx.lineWidth = 20 * s;
  ctx.beginPath();
  ctx.arc(x, y - 30 * s, r * 0.9, Math.PI * 0.36, Math.PI * 0.64);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 2 * s;
  for (const side of [-1, 1]) {
    const ang = Math.PI * 0.5 + side * 0.07;
    const rr = r * 0.9;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(ang) * (rr - 11 * s), y - 30 * s + Math.sin(ang) * (rr - 11 * s));
    ctx.lineTo(x + Math.cos(ang) * (rr + 11 * s), y - 30 * s + Math.sin(ang) * (rr + 11 * s));
    ctx.stroke();
  }
}

/**
 * A plain round gauge: `o = { min, max, start, sweep (deg), step, major,
 * labels: [[v, text]], arcs: [[lo, hi, colour]], title, sub, redLine }`.
 * Returns value -> angle.
 */
export function roundGauge(ctx, x, y, r, o, rim) {
  ring(ctx, x, y, r, rim ?? r * 0.1);
  const s = r / 92;
  const { min = 0, max = 1, start = -135, sweep = 270 } = o;
  const a = (v) => (start + ((v - min) / (max - min)) * sweep) * (Math.PI / 180);
  for (const [lo, hi, col] of o.arcs || []) band(ctx, x, y, r - 20 * s, a, lo, hi, col, 8 * s);
  const vals = [];
  if (o.step) for (let v = min; v <= max + 1e-6; v += o.step) vals.push(v);
  ticks(ctx, x, y, r, a, vals, {
    major: (v) => !o.major || Math.abs((v - min) % o.major) < 1e-6 || Math.abs(((v - min) % o.major) - o.major) < 1e-6,
    len: [14 * s, 22 * s],
    width: [1.6 * s, 2.6 * s],
    outer: 9 * s,
  });
  for (const [v, t] of o.labels || []) {
    const ang = a(v);
    label(ctx, x + Math.sin(ang) * (r - 40 * s), y - Math.cos(ang) * (r - 40 * s), t, Math.round((o.labelSize || 15) * s), TEXT);
  }
  if (o.redLine != null) {
    const ang = a(o.redLine);
    ctx.strokeStyle = '#e8402a';
    ctx.lineWidth = 4 * s;
    ctx.beginPath();
    ctx.moveTo(x + Math.sin(ang) * (r - 30 * s), y - Math.cos(ang) * (r - 30 * s));
    ctx.lineTo(x + Math.sin(ang) * (r - 8 * s), y - Math.cos(ang) * (r - 8 * s));
    ctx.stroke();
  }
  if (o.title) label(ctx, x, y + (o.titleY ?? 38) * s, o.title, Math.round((o.titleSize || 12) * s), DIM);
  if (o.sub) label(ctx, x, y + (o.titleY ?? 38) * s + 15 * s, o.sub, Math.round(9 * s), DIM);
  return a;
}

/**
 * A twin-needle engine gauge, the "fuel quantity L / R" or "oil T / P" kind:
 * two half-dials, one each side, each with its own needle pivot on the
 * centreline. Returns { left, right } value -> angle for the two pivots.
 */
export function twinGauge(ctx, x, y, r, o, rim) {
  ring(ctx, x, y, r, rim ?? r * 0.1);
  const s = r / 92;
  const make = (side, spec) => {
    const { min = 0, max = 1 } = spec;
    // Left half: from about 7 to 11 o'clock; right half mirrored.
    const a = (v) => side * (Math.PI * 0.82 - ((v - min) / (max - min)) * Math.PI * 0.64);
    for (const [lo, hi, col] of spec.arcs || []) {
      const a0 = a(lo) - Math.PI / 2;
      const a1 = a(hi) - Math.PI / 2;
      arc(ctx, x, y, r - 18 * s, Math.min(a0, a1), Math.max(a0, a1), col, 7 * s);
    }
    const vals = [];
    for (let i = 0; i <= (spec.n || 4); i++) vals.push(min + ((max - min) * i) / (spec.n || 4));
    ticks(ctx, x, y, r, a, vals, { len: [16 * s, 16 * s], width: [2.2 * s, 2.2 * s], outer: 8 * s });
    for (const [v, t] of spec.labels || []) {
      const ang = a(v);
      label(ctx, x + Math.sin(ang) * (r - 36 * s), y - Math.cos(ang) * (r - 36 * s), t, Math.round(12 * s), TEXT);
    }
    label(ctx, x + side * r * 0.42, y + r * 0.5, spec.title || '', Math.round(9 * s), DIM);
    return a;
  };
  const left = make(-1, o.left);
  const right = make(1, o.right);
  if (o.title) label(ctx, x, y - r * 0.4, o.title, Math.round(10 * s), DIM);
  return { left, right };
}
