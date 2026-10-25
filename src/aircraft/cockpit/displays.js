/**
 * Glass displays: the screens of the jet and airliner cockpits, and the HUD.
 *
 * Every screen is a canvas painted from the game's own numbers — the speed,
 * height, heading and attitude the flight model has this frame, the engines,
 * the fuel, the gear and flaps, the autopilot's selections, and the map the
 * minimap has already drawn of the island — and uploaded as a texture. They
 * are painted at about twelve times a second, not every frame, and never all
 * on the same frame: a DisplayBus repaints the one that has waited longest,
 * at most two a frame, so a flight deck of six screens costs what one screen
 * would every frame. Nothing here touches the page (no DOM per frame).
 *
 * A painter is `paint(g, W, H, d, opts)`: g a 2D context, d the snapshot
 * readFlight() made (one object, reused, no allocation per frame). What it
 * draws is the numbers it read, so a screen can be checked against the sim:
 * every painter leaves the values it showed in `d.shown[name]`.
 */

import * as THREE from '../../vendor/three.module.js';
import { clamp } from '../../core/noise.js';
import { UNITS } from '../physics.js';
import { AIRPORT } from '../../world/terrain.js';

const { KTS, FT, FPM } = UNITS;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/* ------------------------------------------------------------------ *
 * The snapshot
 * ------------------------------------------------------------------ */

const _f = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * What the screens show, read once per paint from the aeroplane and the game.
 * `out` is reused: call it with the same object every time.
 */
export function readFlight(ac, sim, out = {}, engines = 2) {
  out.ias = (ac.ias || 0) * KTS;
  out.tas = (ac.airspeed || 0) * KTS;
  out.gs = (ac.groundSpeed || 0) * KTS;
  out.mach = (ac.airspeed || 0) / 340.3;
  out.alt = (ac.alt || 0) * FT;
  out.agl = (ac.agl ?? ac.alt ?? 0) * FT;
  out.vs = (ac.vs || 0) * FPM;
  out.hdg = ((ac.heading || 0) % 360 + 360) % 360;
  const fwd = typeof ac.forward === 'function' ? ac.forward(_f) : null;
  out.pitch = fwd ? Math.asin(clamp(fwd.y, -1, 1)) * R2D : 0;
  out.bank = typeof ac.bankAngleDeg === 'function' ? ac.bankAngleDeg() : 0;
  out.aoa = (ac.alpha || 0) * R2D;
  out.g = ac.gLoad ?? 1;
  out.slip = ac.slipBall || 0;
  // Where the aeroplane is going, against where it points: the flight path
  // marker. In body angles, degrees: right and up of the nose.
  out.fpmX = 0;
  out.fpmY = 0;
  out.track = out.hdg;
  if (ac.vel && ac.quat && ac.vel.lengthSq() > 4) {
    _v.copy(ac.vel).applyQuaternion(_q.copy(ac.quat).invert());
    out.fpmX = Math.atan2(_v.x, -_v.z) * R2D;
    out.fpmY = Math.atan2(_v.y, Math.hypot(_v.x, _v.z)) * R2D;
    out.track = ((Math.atan2(ac.vel.x, -ac.vel.z) * R2D) % 360 + 360) % 360;
  }
  const c = ac.controls || {};
  out.throttle = clamp(c.throttle || 0, 0, 1);
  out.brakes = Math.max(c.brakes || 0, ac.parkingBrake ? 1 : 0);
  out.parkBrake = !!ac.parkingBrake;
  out.rpm = clamp(ac.rpm || 0, 0, 1.2);
  out.engineOn = !!ac.engineOn;
  out.engines = engines;
  out.fuel = typeof ac.fuelFraction === 'function' ? clamp(ac.fuelFraction(), 0, 1) : 0.5;
  out.fuelL = ac.fuel || 0;
  out.flaps = clamp(ac.flaps || 0, 0, 1);
  out.gear = clamp(ac.gearPos ?? (ac.gearDown ? 1 : 0), 0, 1);
  out.gearDown = !!ac.gearDown;
  out.onGround = !!ac.onGround;
  out.stalled = !!ac.stalled;
  out.failures = ac.failures || null;
  out.x = (ac.pos && ac.pos.x) || 0;
  out.z = (ac.pos && ac.pos.z) || 0;
  const ap = sim && sim.autopilot;
  out.ap = !!(ap && ap.engaged);
  out.apMode = ap ? ap.mode : 'hold';
  out.selHdg = ap ? ap.selectedHeadingDeg ?? out.hdg : out.hdg;
  out.selAlt = ap ? ap.selectedAltFt ?? 2000 : 2000;
  out.selSpd = ap ? ap.targetSpeedKts ?? ap.selectedSpeedKts ?? 0 : 0;
  out.selVs = ap ? ap.selectedVsFpm ?? 0 : 0;
  // The thing to fly to: the mission's target, else the runway.
  const tgt = sim && sim.activeTarget && sim.activeTarget.pos;
  const rw = AIRPORT && AIRPORT.runway;
  out.tgtX = tgt ? tgt.x : rw ? rw.cx : 0;
  out.tgtZ = tgt ? tgt.z : rw ? rw.cz : 0;
  out.tgtName = tgt ? String((sim.activeTarget && (sim.activeTarget.label || sim.activeTarget.name)) || 'TGT').slice(0, 10).toUpperCase() : 'KESTREL';
  out.chart = sim && sim.minimap && sim.minimap.chart && sim.minimap.chart.canvas ? sim.minimap.chart : null;
  out.night = !!(sim && sim.weather && sim.weather.time === 'night');
  out.shown = out.shown || {};
  return out;
}

/** Distance (nm) and bearing (deg) from the aeroplane to the target. */
function toTarget(d) {
  const dx = d.tgtX - d.x;
  const dz = d.tgtZ - d.z;
  const brg = ((Math.atan2(dx, -dz) * R2D) % 360 + 360) % 360;
  return { nm: Math.hypot(dx, dz) / 1852, brg, dx, dz };
}

/* ------------------------------------------------------------------ *
 * Drawing helpers
 * ------------------------------------------------------------------ */

export const COL = {
  white: '#f2f5f8',
  dim: '#8b96a3',
  green: '#3cf27a',
  cyan: '#4fe3ff',
  magenta: '#ff5ce6',
  amber: '#ffb52e',
  red: '#ff4a3a',
  yellow: '#ffe14d',
  sky: '#2f7fd8',
  skyHi: '#1b56a8',
  ground: '#8c5a2a',
  groundLo: '#5e3b19',
  hud: '#7dff9a',
};

const FONT = '"Helvetica Neue", Arial, sans-serif';
const MONO = '"DejaVu Sans Mono", "Menlo", "Consolas", monospace';

function text(g, s, x, y, size, col, align = 'center', weight = 700, font = FONT) {
  g.fillStyle = col;
  g.font = `${weight} ${size}px ${font}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(s, x, y);
}

function line(g, x0, y0, x1, y1, col, w = 2) {
  g.strokeStyle = col;
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}

function box(g, x, y, w, h, col, lw = 2, fill = null) {
  if (fill) {
    g.fillStyle = fill;
    g.fillRect(x, y, w, h);
  }
  g.strokeStyle = col;
  g.lineWidth = lw;
  g.strokeRect(x, y, w, h);
}

const pad3 = (n) => String(Math.round(n) % 360 === 0 && Math.round(n) !== 0 ? 360 : Math.round(n) % 360).padStart(3, '0');

/** Soft-keys / labels round the edge of an MFD, the way the real ones read. */
function osbLabels(g, W, H, top = [], bottom = [], col = COL.dim) {
  const n = 5;
  top.forEach((t, i) => t && text(g, t, (W * (i + 1)) / (n + 1), 14, 15, i === 0 ? COL.white : col));
  bottom.forEach((t, i) => t && text(g, t, (W * (i + 1)) / (n + 1), H - 14, 15, col));
}

/* ------------------------------------------------------------------ *
 * Attitude: shared by the PFD, the jet ADI page and the standby.
 * ------------------------------------------------------------------ */

function attitude(g, cx, cy, d, { pxPerDeg, clipW, clipH, round = 0 }) {
  g.save();
  g.beginPath();
  if (round) g.arc(cx, cy, round, 0, Math.PI * 2);
  else g.rect(cx - clipW / 2, cy - clipH / 2, clipW, clipH);
  g.clip();
  g.translate(cx, cy);
  g.rotate(-d.bank * D2R);
  const off = d.pitch * pxPerDeg;
  const big = Math.max(clipW, clipH) * 2;
  const sky = g.createLinearGradient(0, off - big / 2, 0, off);
  sky.addColorStop(0, COL.skyHi);
  sky.addColorStop(1, COL.sky);
  g.fillStyle = sky;
  g.fillRect(-big, off - big, big * 2, big);
  const gr = g.createLinearGradient(0, off, 0, off + big / 2);
  gr.addColorStop(0, COL.ground);
  gr.addColorStop(1, COL.groundLo);
  g.fillStyle = gr;
  g.fillRect(-big, off, big * 2, big);
  line(g, -big, off, big, off, COL.white, 3);
  // The ladder: every 2.5 degrees, numbered every 10.
  g.font = `700 15px ${FONT}`;
  for (let p = -90; p <= 90; p += 2.5) {
    if (p === 0) continue;
    const y = off - p * pxPerDeg;
    if (Math.abs(y) > clipH * 0.42) continue;
    const major = p % 10 === 0;
    const half = p % 5 === 0 ? (major ? 46 : 24) : 10;
    line(g, -half, y, half, y, COL.white, major ? 2.5 : 1.8);
    if (major) {
      text(g, String(Math.abs(p)), -half - 16, y, 15, COL.white);
      text(g, String(Math.abs(p)), half + 16, y, 15, COL.white);
    }
  }
  g.restore();
}

function bankScale(g, cx, cy, r, d, col = COL.white) {
  g.save();
  g.translate(cx, cy);
  g.strokeStyle = col;
  g.lineWidth = 2.5;
  for (const a of [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60]) {
    const t = (a - 90) * D2R;
    const len = Math.abs(a) % 30 === 0 ? 16 : 9;
    g.beginPath();
    g.moveTo(Math.cos(t) * r, Math.sin(t) * r);
    g.lineTo(Math.cos(t) * (r + len), Math.sin(t) * (r + len));
    g.stroke();
  }
  // The zero index, fixed.
  g.fillStyle = COL.yellow;
  g.beginPath();
  g.moveTo(0, -r);
  g.lineTo(-9, -r - 14);
  g.lineTo(9, -r - 14);
  g.closePath();
  g.fill();
  // The pointer, turning with the aeroplane; the slip brick under it.
  g.rotate(-d.bank * D2R);
  g.fillStyle = COL.white;
  g.beginPath();
  g.moveTo(0, -r + 2);
  g.lineTo(-10, -r + 18);
  g.lineTo(10, -r + 18);
  g.closePath();
  g.fill();
  const sx = clamp(d.slip, -1, 1) * 16;
  g.fillRect(-11 + sx, -r + 21, 22, 6);
  g.restore();
}

function aircraftSymbol(g, cx, cy, s = 1) {
  g.save();
  g.translate(cx, cy);
  g.scale(s, s);
  g.fillStyle = '#0b0c0e';
  g.strokeStyle = COL.yellow;
  g.lineWidth = 3;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.moveTo(side * 30, -4);
    g.lineTo(side * 92, -4);
    g.lineTo(side * 92, 4);
    g.lineTo(side * 40, 4);
    g.lineTo(side * 40, 18);
    g.lineTo(side * 30, 18);
    g.closePath();
    g.fill();
    g.stroke();
  }
  g.fillRect(-5, -5, 10, 10);
  g.strokeRect(-5, -5, 10, 10);
  g.restore();
}

/** A vertical tape (speed or height) with its rolling readout box. */
function tape(g, { x, y, w, h, value, step, pxPer, labelEvery, side, bands = [], bug = null, bugCol = COL.magenta, decimals = 0, trend = 0 }) {
  g.save();
  g.fillStyle = 'rgba(40, 46, 56, 0.92)';
  g.fillRect(x, y, w, h);
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  const mid = y + h / 2;
  // Coloured bands beside the scale (stall, overspeed).
  for (const [lo, hi, col] of bands) {
    const y0 = mid - (hi - value) * pxPer;
    const y1 = mid - (lo - value) * pxPer;
    g.fillStyle = col;
    g.fillRect(side === 'left' ? x + w - 8 : x, y0, 8, y1 - y0);
  }
  const first = Math.floor((value - h / 2 / pxPer) / step) * step;
  for (let v = first; v <= value + h / 2 / pxPer + step; v += step) {
    if (v < 0 && side === 'left') continue;
    const yy = mid - (v - value) * pxPer;
    const major = Math.round(v / step) % Math.round(labelEvery / step) === 0;
    const tx = side === 'left' ? x + w : x;
    line(g, tx, yy, tx + (side === 'left' ? -1 : 1) * (major ? 14 : 8), yy, COL.white, 2);
    if (major) text(g, String(Math.round(v)), side === 'left' ? x + w - 20 : x + 18, yy, 17, COL.white, side === 'left' ? 'right' : 'left');
  }
  if (bug !== null) {
    const yy = clamp(mid - (bug - value) * pxPer, y + 4, y + h - 4);
    g.fillStyle = bugCol;
    const bx = side === 'left' ? x + w : x;
    const dir = side === 'left' ? -1 : 1;
    g.beginPath();
    g.moveTo(bx, yy);
    g.lineTo(bx + dir * 12, yy - 8);
    g.lineTo(bx + dir * 12, yy + 8);
    g.closePath();
    g.fill();
  }
  if (trend) {
    const tx = side === 'left' ? x + w - 3 : x + 3;
    const ty = mid - trend * pxPer;
    line(g, tx, mid, tx, ty, COL.green, 3);
  }
  g.restore();
  // The readout box, proud of the tape.
  const bw = w + 10;
  const bx = side === 'left' ? x - 4 : x - 6;
  g.fillStyle = '#000';
  g.fillRect(bx, mid - 18, bw, 36);
  box(g, bx, mid - 18, bw, 36, COL.white, 2.5);
  text(g, value.toFixed(decimals), bx + bw / 2, mid + 1, 24, COL.green, 'center', 700, MONO);
}

/* ------------------------------------------------------------------ *
 * Airliner PFD
 * ------------------------------------------------------------------ */

export function paintPFD(g, W, H, d, o = {}) {
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const cx = W * 0.5;
  const cy = H * 0.47;
  // Mode annunciators across the top, in boxes.
  const fma = [
    d.ap ? ['SPEED', COL.green] : ['MAN', COL.white],
    d.ap ? [d.apMode === 'level' ? 'ALT' : d.apMode === 'vs' ? 'V/S' : 'ALT HLD', COL.green] : ['', COL.white],
    d.ap ? ['HDG', COL.green] : ['', COL.white],
    d.ap ? ['AP1', COL.white] : [d.onGround ? 'GND' : 'FD', COL.dim],
  ];
  fma.forEach(([t, col], i) => {
    const x = (W / 4) * i;
    line(g, x, 4, x, 40, '#4b5563', 2);
    if (t) text(g, t, x + W / 8, 22, 18, col);
  });
  line(g, 0, 44, W, 44, '#4b5563', 2);
  attitude(g, cx, cy, d, { pxPerDeg: 7, clipW: 250, clipH: 300 });
  bankScale(g, cx, cy, 128, d);
  // Flight director: magenta bars leaning towards what the autopilot wants.
  if (d.ap) {
    const dh = (((d.selHdg - d.hdg + 540) % 360) - 180);
    const wantBank = clamp(dh * 0.8, -25, 25);
    const fdX = clamp((wantBank - d.bank) * 2.2, -60, 60);
    const wantPitch = clamp((d.selAlt - d.alt) / 250, -6, 8);
    const fdY = clamp((d.pitch - wantPitch) * 7, -60, 60);
    line(g, cx + fdX, cy - 70, cx + fdX, cy + 70, COL.magenta, 3.5);
    line(g, cx - 70, cy + fdY, cx + 70, cy + fdY, COL.magenta, 3.5);
  }
  aircraftSymbol(g, cx, cy, 1);
  // Radio height, near the ground.
  if (d.agl < 2500 && !d.onGround) text(g, String(Math.max(0, Math.round(d.agl / 10) * 10)), cx, cy + 128, 24, d.agl < 400 ? COL.amber : COL.green, 'center', 700, MONO);
  const stall = o.vs ?? 100;
  const vmax = o.vmo ?? 340;
  tape(g, {
    x: 22, y: 64, w: 82, h: 340, value: Math.max(0, d.ias), step: 10, pxPer: 3.2, labelEvery: 20, side: 'left',
    bands: [[0, stall, COL.red], [stall, stall * 1.15, COL.amber], [vmax, vmax + 400, COL.red]],
    bug: d.ap ? d.selSpd : null, trend: 0,
  });
  tape(g, {
    x: W - 112, y: 64, w: 82, h: 340, value: d.alt, step: 100, pxPer: 0.32, labelEvery: 500, side: 'right',
    bug: d.selAlt, bugCol: d.ap ? COL.magenta : COL.cyan,
  });
  text(g, String(Math.round(d.selAlt)), W - 71, 54, 17, d.ap ? COL.magenta : COL.cyan, 'center', 700, MONO);
  if (d.ap) text(g, String(Math.round(d.selSpd)), 63, 54, 17, COL.magenta, 'center', 700, MONO);
  // Vertical speed: a scale and a pointer from the right edge.
  {
    const x = W - 24;
    const top = 120;
    const bot = 360;
    const mid = (top + bot) / 2;
    g.fillStyle = 'rgba(40,46,56,0.9)';
    g.beginPath();
    g.moveTo(x, top);
    g.lineTo(x + 20, top + 30);
    g.lineTo(x + 20, bot - 30);
    g.lineTo(x, bot);
    g.closePath();
    g.fill();
    const vy = (v) => mid - Math.sign(v) * Math.min(1, Math.sqrt(Math.abs(v) / 6000)) * (mid - top - 6);
    for (const v of [-6000, -2000, -1000, 0, 1000, 2000, 6000]) line(g, x + 2, vy(v), x + 8, vy(v), COL.white, 2);
    line(g, x + 22, mid, x + 2, vy(d.vs), COL.green, 3);
    if (Math.abs(d.vs) > 200) text(g, String(Math.round(Math.abs(d.vs) / 100)), x + 10, d.vs > 0 ? top - 8 : bot + 10, 15, COL.green);
  }
  // Heading strip.
  {
    const y = H - 70;
    g.save();
    g.fillStyle = 'rgba(40,46,56,0.92)';
    g.fillRect(120, y, W - 240, 44);
    g.beginPath();
    g.rect(120, y, W - 240, 44);
    g.clip();
    const pxPer = 5;
    for (let a = Math.floor(d.hdg / 5) * 5 - 30; a <= d.hdg + 30; a += 5) {
      const x = cx + (a - d.hdg) * pxPer;
      const major = ((a % 10) + 10) % 10 === 0;
      line(g, x, y, x, y + (major ? 14 : 8), COL.white, 2);
      if (((a % 30) + 30) % 30 === 0) text(g, String(((a + 360) % 360) / 10), x, y + 28, 17, COL.white);
    }
    const dh = (((d.selHdg - d.hdg + 540) % 360) - 180);
    const bx = cx + clamp(dh, -26, 26) * pxPer;
    g.fillStyle = d.ap ? COL.magenta : COL.cyan;
    g.fillRect(bx - 6, y, 12, 7);
    g.restore();
    line(g, cx, y - 6, cx, y + 16, COL.yellow, 3);
  }
  // Speed in Mach and the altimeter setting under the tapes.
  if (d.mach > 0.4) text(g, '.' + String(Math.round(d.mach * 1000)).padStart(3, '0').slice(0, 3), 63, 432, 18, COL.green, 'center', 700, MONO);
  text(g, 'STD', W - 71, 432, 18, COL.cyan);
  d.shown.pfd = { ias: Math.round(Math.max(0, d.ias)), alt: Math.round(d.alt), hdg: Math.round(d.hdg) % 360 };
}

/* ------------------------------------------------------------------ *
 * The map: airliner ND and the jets' moving map share it.
 * ------------------------------------------------------------------ */

/**
 * The island under the aeroplane, from the chart the minimap has already
 * shaded (sim.minimap.chart): heading up, `rangeNm` from the aeroplane to the
 * edge of the arc. (ox, oy) is the aeroplane on the screen.
 */
function chartUnder(g, d, ox, oy, pxPerM, alpha = 0.6) {
  const ch = d.chart;
  if (!ch || !ch.canvas || !ch.extent) return;
  const ppm = ch.canvas.width / ch.extent; // chart pixels per metre
  const half = ch.extent / 2;
  g.save();
  g.globalAlpha = alpha;
  g.translate(ox, oy);
  g.rotate(-d.hdg * D2R);
  g.scale(pxPerM / ppm, pxPerM / ppm);
  // The aeroplane's own pixel in the chart goes to (0, 0).
  g.drawImage(ch.canvas, -(d.x - ch.cx + half) * ppm, -(d.z - ch.cz + half) * ppm);
  g.restore();
}

/** World (x, z) to the screen, heading up. */
function mapXY(d, x, z, ox, oy, pxPerM) {
  const dx = x - d.x;
  const dz = z - d.z;
  const h = d.hdg * D2R;
  // Rotate so the heading points up the screen.
  const rx = dx * Math.cos(h) + dz * Math.sin(h);
  const ry = -dx * Math.sin(h) + dz * Math.cos(h);
  return [ox + rx * pxPerM, oy + ry * pxPerM];
}

/**
 * The map's range: what was asked for, but never more than the chart the
 * minimap has shaded reaches, so the island fills the screen instead of
 * floating in it as a small square.
 */
function fitRange(d, want) {
  const ch = d.chart;
  if (!ch || !ch.extent) return want;
  const reach = (ch.extent * 0.42) / 1852;
  const steps = [2, 5, 10, 20, 40];
  let r = steps[0];
  for (const s of steps) if (s <= Math.min(want, reach)) r = s;
  return r;
}

export function paintND(g, W, H, d, o = {}) {
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const range = fitRange(d, o.rangeNm || 10);
  const ox = W / 2;
  const oy = H * 0.8;
  const R = H * 0.66;
  const pxPerM = R / (range * 1852);
  g.save();
  g.beginPath();
  g.arc(ox, oy, R + 2, Math.PI, 0);
  g.lineTo(W, H);
  g.lineTo(0, H);
  g.closePath();
  g.clip();
  chartUnder(g, d, ox, oy, pxPerM, 0.55);
  // A dark wash so the symbols read over the chart.
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, 0, W, H);
  // Half-range ring, dashed.
  g.setLineDash([6, 8]);
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(ox, oy, R / 2, Math.PI, 0);
  g.stroke();
  g.setLineDash([]);
  // The runway.
  if (AIRPORT && AIRPORT.runway) {
    const rw = AIRPORT.runway;
    const a = (AIRPORT.headingDeg || 90) * D2R;
    const hx = (Math.sin(a) * rw.length) / 2;
    const hz = (-Math.cos(a) * rw.length) / 2;
    const [x0, y0] = mapXY(d, rw.cx - hx, rw.cz - hz, ox, oy, pxPerM);
    const [x1, y1] = mapXY(d, rw.cx + hx, rw.cz + hz, ox, oy, pxPerM);
    line(g, x0, y0, x1, y1, COL.white, 4);
    text(g, 'KSTL', x1 + 10, y1 - 12, 14, COL.white, 'left');
  }
  // The target, with a magenta line from the aeroplane.
  const t = toTarget(d);
  {
    const [tx, ty] = mapXY(d, d.tgtX, d.tgtZ, ox, oy, pxPerM);
    g.strokeStyle = COL.magenta;
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(ox, oy);
    g.lineTo(tx, ty);
    g.stroke();
    g.fillStyle = COL.magenta;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const r = i % 2 ? 4 : 11;
      const a = (i * Math.PI) / 4;
      g[i ? 'lineTo' : 'moveTo'](tx + Math.cos(a) * r, ty + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    text(g, d.tgtName, tx + 14, ty - 12, 14, COL.magenta, 'left');
  }
  g.restore();
  // The compass arc.
  g.save();
  g.translate(ox, oy);
  g.strokeStyle = COL.white;
  g.lineWidth = 2.5;
  g.beginPath();
  g.arc(0, 0, R, Math.PI * 1.08, Math.PI * 1.92);
  g.stroke();
  for (let a = Math.floor((d.hdg - 60) / 5) * 5; a <= d.hdg + 60; a += 5) {
    const t2 = (a - d.hdg - 90) * D2R;
    if (t2 < -Math.PI * 0.92 || t2 > -Math.PI * 0.08) continue;
    const major = ((a % 10) + 10) % 10 === 0;
    const len = major ? 14 : 8;
    line(g, Math.cos(t2) * R, Math.sin(t2) * R, Math.cos(t2) * (R - len), Math.sin(t2) * (R - len), COL.white, 2);
    if (((a % 30) + 30) % 30 === 0) text(g, String(((a + 360) % 360) / 10), Math.cos(t2) * (R - 30), Math.sin(t2) * (R - 30), 18, COL.white);
  }
  // Selected heading bug.
  const sh = (((d.selHdg - d.hdg + 540) % 360) - 180);
  if (Math.abs(sh) < 58) {
    const t3 = (sh - 90) * D2R;
    g.fillStyle = d.ap ? COL.magenta : COL.cyan;
    g.save();
    g.rotate(t3 + Math.PI / 2);
    g.fillRect(-9, -R - 2, 18, 9);
    g.restore();
  }
  // Track line: where the aeroplane is actually going.
  const tr = (((d.track - d.hdg + 540) % 360) - 180) * D2R;
  g.save();
  g.rotate(tr);
  g.setLineDash([10, 8]);
  line(g, 0, -20, 0, -R, COL.green, 2);
  g.setLineDash([]);
  g.restore();
  g.restore();
  // Heading readout and pointer.
  g.fillStyle = '#000';
  g.fillRect(ox - 34, oy - R - 46, 68, 30);
  box(g, ox - 34, oy - R - 46, 68, 30, COL.white, 2);
  text(g, pad3(d.hdg), ox, oy - R - 30, 22, COL.green, 'center', 700, MONO);
  g.fillStyle = COL.yellow;
  g.beginPath();
  g.moveTo(ox, oy - R + 2);
  g.lineTo(ox - 8, oy - R - 12);
  g.lineTo(ox + 8, oy - R - 12);
  g.closePath();
  g.fill();
  // The aeroplane.
  g.strokeStyle = COL.yellow;
  g.lineWidth = 3.5;
  g.beginPath();
  g.moveTo(ox, oy - 18);
  g.lineTo(ox, oy + 16);
  g.moveTo(ox - 16, oy - 2);
  g.lineTo(ox + 16, oy - 2);
  g.moveTo(ox - 7, oy + 14);
  g.lineTo(ox + 7, oy + 14);
  g.stroke();
  // Corners: speeds and the next point.
  text(g, 'GS', 14, 22, 16, COL.white, 'left');
  text(g, String(Math.round(d.gs)), 46, 22, 20, COL.green, 'left', 700, MONO);
  text(g, 'TAS', 100, 22, 16, COL.white, 'left');
  text(g, String(Math.round(d.tas)), 138, 22, 20, COL.green, 'left', 700, MONO);
  text(g, d.tgtName, W - 14, 20, 17, COL.magenta, 'right');
  text(g, `${pad3(t.brg)}°  ${t.nm < 10 ? t.nm.toFixed(1) : Math.round(t.nm)} NM`, W - 14, 44, 16, COL.white, 'right', 700, MONO);
  text(g, String(range), ox - R / 2 - 4, oy - 12, 15, COL.cyan);
  d.shown.nd = { hdg: Math.round(d.hdg) % 360, gs: Math.round(d.gs), nm: +t.nm.toFixed(1) };
}

/* ------------------------------------------------------------------ *
 * Engines and systems
 * ------------------------------------------------------------------ */

/** One engine's N1, from the throttle and the engine's own spool-up. */
export function n1Of(d, i = 0) {
  if (!d.engineOn) return Math.max(0, d.rpm * 20);
  // Spool: rpm runs behind the throttle; idle is about 22 %.
  const spread = (i % 2 ? 0.4 : -0.3) * (d.engines > 2 ? 1 : 0.5);
  return clamp(22 + Math.max(d.rpm, 0) * 76 + spread, 0, 104);
}

function dialArc(g, x, y, r, frac, col, label, value, redFrom = 0.95) {
  const a0 = Math.PI * 0.8;
  const a1 = Math.PI * 2.2;
  g.strokeStyle = '#d8dde3';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(x, y, r, a0, a0 + (a1 - a0) * redFrom);
  g.stroke();
  g.strokeStyle = COL.red;
  g.beginPath();
  g.arc(x, y, r, a0 + (a1 - a0) * redFrom, a1);
  g.stroke();
  // The filled sector up to the value, like the real ones.
  const a = a0 + (a1 - a0) * clamp(frac, 0, 1.05);
  g.fillStyle = 'rgba(160,170,180,0.28)';
  g.beginPath();
  g.moveTo(x, y);
  g.arc(x, y, r - 2, a0, a);
  g.closePath();
  g.fill();
  line(g, x, y, x + Math.cos(a) * (r + 4), y + Math.sin(a) * (r + 4), col, 3.5);
  g.fillStyle = '#000';
  g.fillRect(x + 2, y - 20, r + 8, 26);
  box(g, x + 2, y - 20, r + 8, 26, '#9aa3ad', 1.5);
  text(g, value, x + r + 6, y - 6, 18, col, 'right', 700, MONO);
  if (label) text(g, label, x, y + r * 0.62, 13, COL.cyan);
}

export function paintEICAS(g, W, H, d, o = {}) {
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const n = d.engines || 2;
  const cols = n;
  const r = n > 2 ? 40 : 54;
  const left = n > 2 ? 64 : 110;
  const gap = n > 2 ? 94 : 150;
  const n1s = [];
  for (let i = 0; i < cols; i++) {
    const x = left + i * gap;
    const n1 = n1Of(d, i);
    n1s.push(Math.round(n1 * 10) / 10);
    dialArc(g, x, 80, r, n1 / 104, COL.green, i === 0 ? 'N1' : '', n1.toFixed(1), 0.96);
    const egt = d.engineOn ? 380 + n1 * 5.1 : 40;
    dialArc(g, x, 80 + r * 2 + 34, r * 0.82, egt / 1000, COL.green, i === 0 ? 'EGT' : '', String(Math.round(egt)), 0.92);
    const ff = d.engineOn ? (0.25 + d.rpm * 2.6) * (n > 2 ? 1.6 : 1) : 0;
    text(g, ff.toFixed(1), x + r * 0.4, 80 + r * 4 + 30, 18, COL.green, 'center', 700, MONO);
  }
  text(g, 'FF', 22, 80 + r * 4 + 30, 13, COL.cyan, 'left');
  // Right-hand column: fuel, flaps, gear.
  const rx = W - 128;
  text(g, 'FUEL', rx, 38, 15, COL.cyan, 'left');
  const kg = Math.round((d.fuelL || 0) * 0.8);
  text(g, kg > 0 ? String(kg) : `${Math.round(d.fuel * 100)}%`, W - 18, 62, 22, d.fuel < 0.1 ? COL.amber : COL.green, 'right', 700, MONO);
  text(g, kg > 0 ? 'KG' : '', W - 18, 82, 12, COL.cyan, 'right');
  // Flaps: a bar the slat-flap way.
  text(g, 'FLAPS', rx, 128, 15, COL.cyan, 'left');
  box(g, rx, 142, 104, 14, '#9aa3ad', 1.5);
  g.fillStyle = COL.green;
  g.fillRect(rx + 2, 144, 100 * d.flaps, 10);
  text(g, d.flaps < 0.02 ? 'UP' : String(Math.round(d.flaps * 30)), rx + 52, 172, 18, COL.green, 'center', 700, MONO);
  // Gear: three boxes, green DN, amber in transit.
  text(g, 'GEAR', rx, 210, 15, COL.cyan, 'left');
  const gearCol = d.gear > 0.98 ? COL.green : d.gear < 0.02 ? COL.white : COL.amber;
  const gearTxt = d.gear > 0.98 ? 'DN' : d.gear < 0.02 ? 'UP' : '||||';
  for (const [i, gx] of [[0, rx + 34], [1, rx], [2, rx + 68]].map((v) => v)) {
    const gy = i === 0 ? 226 : 262;
    box(g, gx, gy, 34, 28, gearCol, 2, '#000');
    text(g, gearTxt, gx + 17, gy + 15, 14, gearCol);
  }
  // Messages: warnings red, cautions amber, memos green.
  const msgs = [];
  const f = d.failures || {};
  if (f.engine) msgs.push(['ENG FAIL', COL.red]);
  if (f.fuelLeak) msgs.push(['FUEL LEAK', COL.red]);
  if (d.fuel < 0.075 && d.fuelL > 0) msgs.push(['FUEL LOW', COL.amber]);
  if (f.gear) msgs.push(['GEAR DISAGREE', COL.amber]);
  if (f.icing) msgs.push(['ANTI-ICE', COL.amber]);
  if (f.elevator) msgs.push(['FLT CTL', COL.amber]);
  if (f.brakes) msgs.push(['BRAKES', COL.amber]);
  if (d.stalled) msgs.push(['STALL', COL.red]);
  if (d.parkBrake) msgs.push(['PARK BRK', COL.green]);
  if (d.ap) msgs.push(['AUTOPILOT', COL.green]);
  if (!d.engineOn) msgs.push(['ENG SHUTDOWN', COL.amber]);
  if (!msgs.length) msgs.push(['', COL.green]);
  line(g, 10, H - 128, W - 10, H - 128, '#4b5563', 2);
  msgs.slice(0, 4).forEach(([t, col], i) => text(g, t, 22, H - 106 + i * 26, 18, col, 'left'));
  d.shown.eicas = { n1: n1s, flaps: Math.round(d.flaps * 30), gear: gearTxt, fuel: Math.round(d.fuel * 100) };
}

/** Lower centre: fuel and doors, the "systems" page. */
export function paintSystems(g, W, H, d) {
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  text(g, 'FUEL', W / 2, 24, 18, COL.white);
  line(g, W / 2 - 30, 36, W / 2 + 30, 36, COL.white, 2);
  const tank = (x, y, w, h, frac, label) => {
    box(g, x, y, w, h, '#d8dde3', 2);
    g.fillStyle = 'rgba(60, 242, 122, 0.35)';
    g.fillRect(x + 2, y + h - 2 - (h - 4) * frac, w - 4, (h - 4) * frac);
    text(g, label, x + w / 2, y + h + 14, 13, COL.cyan);
    text(g, String(Math.round(frac * 100)), x + w / 2, y + h / 2, 18, COL.green, 'center', 700, MONO);
  };
  tank(40, 70, 110, 90, d.fuel, 'L WING');
  tank(W / 2 - 55, 70, 110, 90, Math.max(0, d.fuel - 0.12) / 0.88, 'CTR');
  tank(W - 150, 70, 110, 90, d.fuel, 'R WING');
  // Pumps, with the engines.
  for (const x of [95, W - 95]) {
    g.fillStyle = d.engineOn ? COL.green : '#333';
    g.beginPath();
    g.arc(x, 210, 12, 0, Math.PI * 2);
    g.fill();
    line(g, x, 222, x, 262, d.engineOn ? COL.green : '#555', 3);
  }
  text(g, 'ENG 1', 95, 280, 14, COL.white);
  text(g, 'ENG 2', W - 95, 280, 14, COL.white);
  text(g, 'BRAKES', 40, 330, 15, COL.cyan, 'left');
  text(g, d.brakes > 0.05 ? 'ON' : 'OFF', 160, 330, 18, d.brakes > 0.05 ? COL.amber : COL.green, 'left');
  text(g, 'GW', 40, 362, 15, COL.cyan, 'left');
  text(g, `${Math.round(d.fuel * 100)} %`, 160, 362, 18, COL.green, 'left', 700, MONO);
  text(g, 'TAT', W - 170, 330, 15, COL.cyan, 'left');
  text(g, `${Math.round(15 - d.alt / 500)}°C`, W - 110, 330, 18, COL.green, 'left', 700, MONO);
  text(g, 'UTC', W - 170, 362, 15, COL.cyan, 'left');
  text(g, '12:00', W - 110, 362, 18, COL.green, 'left', 700, MONO);
  d.shown.sys = { fuel: Math.round(d.fuel * 100) };
}

/* ------------------------------------------------------------------ *
 * Jet MFD pages
 * ------------------------------------------------------------------ */

/** Attitude over a heading rose: the jet's "ADI / HSI" page. */
export function paintAdiHsi(g, W, H, d, o = {}) {
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const cx = W / 2;
  const cy = H * 0.36;
  attitude(g, cx, cy, d, { pxPerDeg: 4.2, clipW: 0, clipH: 300, round: 120 });
  g.strokeStyle = '#596270';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(cx, cy, 121, 0, Math.PI * 2);
  g.stroke();
  bankScale(g, cx, cy, 122, d);
  aircraftSymbol(g, cx, cy, 0.7);
  // Rose.
  const ry = H * 0.83;
  const R = 92;
  g.save();
  g.translate(cx, ry);
  g.rotate(-d.hdg * D2R);
  for (let a = 0; a < 360; a += 10) {
    g.save();
    g.rotate(a * D2R);
    line(g, 0, -R, 0, -R + (a % 30 === 0 ? 14 : 7), COL.white, 2);
    if (a % 30 === 0) text(g, a === 0 ? 'N' : a === 90 ? 'E' : a === 180 ? 'S' : a === 270 ? 'W' : String(a / 10), 0, -R + 28, 16, COL.white);
    g.restore();
  }
  // Course to the target.
  const t = toTarget(d);
  g.rotate(t.brg * D2R);
  line(g, 0, R - 8, 0, -R + 8, COL.magenta, 3);
  g.restore();
  g.strokeStyle = COL.yellow;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(cx, ry - 14);
  g.lineTo(cx, ry + 12);
  g.moveTo(cx - 12, ry);
  g.lineTo(cx + 12, ry);
  g.stroke();
  // Numbers at the sides.
  text(g, String(Math.round(Math.max(0, d.ias))), 52, cy - 10, 26, COL.green, 'center', 700, MONO);
  text(g, 'KCAS', 52, cy + 14, 13, COL.dim);
  text(g, String(Math.round(d.alt)), W - 60, cy - 10, 26, COL.green, 'center', 700, MONO);
  text(g, 'FT', W - 60, cy + 14, 13, COL.dim);
  text(g, pad3(d.hdg), cx, ry - R - 18, 20, COL.green, 'center', 700, MONO);
  osbLabels(g, W, H, [o.title || 'ADI', 'HSI', '', 'CRS', ''], ['', 'SA', 'MENU', 'ENG', '']);
  d.shown.adi = { ias: Math.round(Math.max(0, d.ias)), alt: Math.round(d.alt), hdg: Math.round(d.hdg) % 360 };
}

/** The moving map: the island from the minimap's chart, heading up. */
export function paintMap(g, W, H, d, o = {}) {
  g.fillStyle = '#04070b';
  g.fillRect(0, 0, W, H);
  const ox = W / 2;
  const oy = H * 0.62;
  const range = fitRange(d, o.rangeNm || 8);
  const R = H * 0.5;
  const pxPerM = R / (range * 1852);
  g.save();
  g.beginPath();
  g.rect(8, 30, W - 16, H - 60);
  g.clip();
  chartUnder(g, d, ox, oy, pxPerM, 0.85);
  // Range rings.
  g.strokeStyle = 'rgba(160, 230, 255, 0.35)';
  g.lineWidth = 1.5;
  for (const k of [0.5, 1]) {
    g.beginPath();
    g.arc(ox, oy, R * k, 0, Math.PI * 2);
    g.stroke();
  }
  const t = toTarget(d);
  const [tx, ty] = mapXY(d, d.tgtX, d.tgtZ, ox, oy, pxPerM);
  g.setLineDash([8, 6]);
  line(g, ox, oy, tx, ty, COL.cyan, 2);
  g.setLineDash([]);
  g.strokeStyle = COL.cyan;
  g.lineWidth = 3;
  g.beginPath();
  g.arc(tx, ty, 10, 0, Math.PI * 2);
  g.stroke();
  text(g, d.tgtName, tx + 14, ty - 14, 15, COL.cyan, 'left');
  // The airfield.
  if (AIRPORT && AIRPORT.runway) {
    const [ax, ay] = mapXY(d, AIRPORT.runway.cx, AIRPORT.runway.cz, ox, oy, pxPerM);
    g.strokeStyle = COL.white;
    g.lineWidth = 2;
    g.strokeRect(ax - 7, ay - 7, 14, 14);
  }
  g.restore();
  // Own ship.
  g.fillStyle = COL.white;
  g.beginPath();
  g.moveTo(ox, oy - 16);
  g.lineTo(ox - 11, oy + 12);
  g.lineTo(ox, oy + 6);
  g.lineTo(ox + 11, oy + 12);
  g.closePath();
  g.fill();
  text(g, pad3(d.hdg), ox, 46, 20, COL.green, 'center', 700, MONO);
  text(g, `${pad3(t.brg)}/${t.nm.toFixed(1)}`, W - 16, H - 40, 16, COL.cyan, 'right', 700, MONO);
  text(g, `${range} NM`, 16, H - 40, 15, COL.dim, 'left');
  osbLabels(g, W, H, [o.title || 'SA', 'MAP', 'RNG', 'DCLT', ''], ['', 'ADI', 'MENU', 'STRS', '']);
  d.shown.map = { hdg: Math.round(d.hdg) % 360, nm: +t.nm.toFixed(1) };
}

/** Engines, fuel and the weapons count: the jet's systems page. */
export function paintJetSystems(g, W, H, d, o = {}) {
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const n = Math.max(1, Math.min(2, d.engines || 1));
  const bar = (x, y, h, frac, col, label, val) => {
    box(g, x, y, 34, h, '#9aa3ad', 1.5);
    g.fillStyle = col;
    g.fillRect(x + 3, y + h - 3 - (h - 6) * clamp(frac, 0, 1), 28, (h - 6) * clamp(frac, 0, 1));
    text(g, label, x + 17, y + h + 16, 13, COL.cyan);
    text(g, val, x + 17, y - 14, 17, COL.green, 'center', 700, MONO);
  };
  const rpms = [];
  for (let i = 0; i < n; i++) {
    const rpm = d.engineOn ? clamp(68 + d.rpm * 32 + (i ? 0.4 : 0), 0, 104) : d.rpm * 20;
    rpms.push(Math.round(rpm));
    const x = 60 + i * 120;
    bar(x, 80, 180, rpm / 104, COL.green, 'RPM', String(Math.round(rpm)));
    const ftit = d.engineOn ? 520 + d.rpm * 380 : 60;
    bar(x + 50, 80, 180, ftit / 1000, ftit > 880 ? COL.amber : COL.green, 'FTIT', String(Math.round(ftit)));
  }
  const ab = d.throttle > 0.96 && d.engineOn;
  text(g, ab ? 'AB' : 'MIL', 60 + (n - 1) * 60 + 40, 305, 20, ab ? COL.amber : COL.green);
  // Fuel, total and as a bar.
  const fx = W - 150;
  bar(fx + 33, 80, 180, d.fuel, d.fuel < 0.15 ? COL.amber : COL.green, 'FUEL', `${Math.round(d.fuel * 100)}%`);
  // Stores: what the aeroplane carries, drawn as a planform.
  const sy = H - 130;
  line(g, 20, sy - 20, W - 20, sy - 20, '#4b5563', 2);
  text(g, o.stores ? 'STORES' : 'G', 40, sy + 6, 15, COL.cyan, 'left');
  if (o.stores) {
    const cx = W / 2;
    g.strokeStyle = COL.white;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx, sy - 6);
    g.lineTo(cx - 120, sy + 54);
    g.lineTo(cx + 120, sy + 54);
    g.closePath();
    g.stroke();
    const left = o.stores();
    for (let i = 0; i < 3; i++) {
      const sx = cx + (i - 1) * 80;
      g.fillStyle = left !== null && i < left ? COL.green : '#2b3138';
      g.fillRect(sx - 4, sy + 34, 8, 30);
    }
    if (left === null) text(g, 'SAFE', W - 30, sy + 6, 17, COL.dim, 'right', 700, MONO);
    else text(g, `MSL ${left}`, W - 30, sy + 6, 17, left ? COL.green : COL.amber, 'right', 700, MONO);
  }
  text(g, `G ${d.g.toFixed(1)}`, 40, H - 40, 18, COL.green, 'left', 700, MONO);
  text(g, `M ${d.mach.toFixed(2)}`, W - 40, H - 40, 18, COL.green, 'right', 700, MONO);
  osbLabels(g, W, H, [o.title || 'ENG', 'FUEL', '', 'BIT', ''], ['', 'SA', 'MENU', 'ADI', '']);
  d.shown.eng = { rpm: rpms, fuel: Math.round(d.fuel * 100) };
}

/** A small monochrome readout block (up-front / UFC / racer's lap screen). */
export function paintUFC(g, W, H, d, o = {}) {
  g.fillStyle = '#020403';
  g.fillRect(0, 0, W, H);
  const rows = o.rows ? o.rows(d) : [
    [`COM1 118.30`, `HDG ${pad3(d.hdg)}`],
    [`ALT ${Math.round(d.alt)}`, `SPD ${Math.round(d.ias)}`],
    [d.ap ? 'A/P  ON' : 'A/P  OFF', `FUEL ${Math.round(d.fuel * 100)}%`],
  ];
  const col = o.colour || COL.green;
  const h = H / (rows.length + 0.4);
  rows.forEach((r, i) => {
    text(g, r[0], 18, h * (i + 0.7), Math.round(h * 0.52), col, 'left', 700, MONO);
    if (r[1]) text(g, r[1], W - 18, h * (i + 0.7), Math.round(h * 0.52), col, 'right', 700, MONO);
  });
  d.shown.ufc = rows.map((r) => r.join(' '));
}

/** The racer's big screen: speed and Mach, huge, and the G. */
export function paintRacer(g, W, H, d) {
  g.fillStyle = '#05070a';
  g.fillRect(0, 0, W, H);
  const grd = g.createLinearGradient(0, 0, W, 0);
  grd.addColorStop(0, '#e0262b');
  grd.addColorStop(1, '#ff8a2a');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, 8);
  text(g, 'AIR MASSIMO', 20, 32, 18, '#ffffff', 'left', 800);
  text(g, String(Math.round(d.tas)), W / 2, H * 0.42, 120, '#ffffff', 'center', 800, MONO);
  text(g, 'KNOTS', W / 2, H * 0.62, 20, COL.dim);
  text(g, `MACH ${d.mach.toFixed(2)}`, 26, H - 44, 30, d.mach > 1 ? '#ff8a2a' : COL.green, 'left', 800, MONO);
  text(g, `${d.g.toFixed(1)} G`, W - 26, H - 44, 30, d.g > 7 ? COL.amber : COL.green, 'right', 800, MONO);
  // Thrust bar.
  g.fillStyle = '#1b2026';
  g.fillRect(20, H - 18, W - 40, 8);
  g.fillStyle = d.throttle > 0.96 ? '#ff8a2a' : COL.green;
  g.fillRect(20, H - 18, (W - 40) * d.throttle, 8);
  d.shown.racer = { tas: Math.round(d.tas), mach: +d.mach.toFixed(2) };
}

/**
 * The autopilot's glareshield panel (Boeing MCP / Airbus FCU): the selected
 * speed, heading, altitude and vertical speed in their windows, read off
 * sim.autopilot, and which of them the autopilot is flying.
 */
export function paintMCP(g, W, H, d, o = {}) {
  g.fillStyle = o.face || '#3b4249';
  g.fillRect(0, 0, W, H);
  const fields = [
    ['SPD', String(Math.round(d.selSpd || d.ias)).padStart(3, '0')],
    ['HDG', pad3(d.selHdg)],
    ['ALT', String(Math.round(d.selAlt)).padStart(5, '0')],
    ['V/S', `${d.selVs >= 0 ? '+' : '-'}${String(Math.round(Math.abs(d.selVs || 0))).padStart(4, '0')}`],
  ];
  const cw = W / fields.length;
  fields.forEach(([name, val], i) => {
    const x = cw * i + cw / 2;
    text(g, name, x, H * 0.18, Math.round(H * 0.16), '#d9dde2');
    g.fillStyle = '#050607';
    g.fillRect(x - cw * 0.34, H * 0.32, cw * 0.68, H * 0.42);
    text(g, val, x, H * 0.54, Math.round(H * 0.32), o.lcd || '#ffb44a', 'center', 700, MONO);
    // The mode button under each window, lit when the autopilot flies it.
    const lit = d.ap && (i === 1 || i === 2 || (i === 0 && d.selSpd > 0) || (i === 3 && d.apMode === 'vs'));
    g.fillStyle = lit ? '#46e07a' : '#1b1f23';
    g.fillRect(x - cw * 0.12, H * 0.82, cw * 0.24, H * 0.08);
  });
  text(g, d.ap ? 'AP' : 'AP', W - 10, H * 0.18, Math.round(H * 0.14), d.ap ? '#46e07a' : '#7a838c', 'right');
  d.shown.mcp = { hdg: Math.round(d.selHdg) % 360, alt: Math.round(d.selAlt), spd: Math.round(d.selSpd || d.ias) };
}

/** An FMS keypad screen (the MCDU / CDU on the pedestal). */
export function paintCDU(g, W, H, d) {
  g.fillStyle = '#020304';
  g.fillRect(0, 0, W, H);
  const t = toTarget(d);
  const rows = [
    ['     PROGRESS', COL.white],
    [`TO  ${d.tgtName}`, COL.green],
    [` ${pad3(t.brg)}°   ${t.nm.toFixed(1)} NM`, COL.green],
    [`GS ${Math.round(d.gs)}   ALT ${Math.round(d.alt)}`, COL.white],
    [`FUEL ${Math.round(d.fuel * 100)}%`, COL.cyan],
    ['<INDEX      NAV>', COL.white],
  ];
  const h = H / (rows.length + 0.5);
  rows.forEach(([r, c], i) => text(g, r, 12, h * (i + 0.8), Math.round(h * 0.55), c, 'left', 700, MONO));
  d.shown.cdu = { nm: +t.nm.toFixed(1) };
}

/**
 * Missiles left on the rails, from the heat-seeker feature when it is loaded
 * (it always is in the game; never in a Node test), or null when the
 * aeroplane carries none this flight. The module is the game's own copy —
 * a dynamic import of a module already loaded costs nothing and runs nothing.
 */
let HS = null;
let hsAsked = false;
export function missilesLeft() {
  if (!hsAsked && typeof window !== 'undefined' && window.__sim) {
    hsAsked = true;
    import('../../features/heatseek.js').then((m) => { HS = m.heatseek || null; }).catch(() => {});
  }
  if (!HS) return null;
  try {
    return HS.armed ? clamp(HS.left | 0, 0, 3) : null;
  } catch (e) {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * The HUD
 * ------------------------------------------------------------------ */

/**
 * Head-up symbology on a transparent canvas, drawn additively on the
 * combiner. `o.pxPerDeg(d)` is how many canvas pixels one degree is from the
 * pilot's eye — the builder works it out from the glass's distance, so the
 * horizon line lies on the real horizon.
 */
export function paintHUD(g, W, H, d, o = {}) {
  g.clearRect(0, 0, W, H);
  const col = o.colour || COL.hud;
  const ppd = o.pxPerDeg ? o.pxPerDeg() : 10;
  const cx = W / 2;
  const cy = H * (o.boreY ?? 0.42);
  g.strokeStyle = col;
  g.fillStyle = col;
  g.lineWidth = 3;
  g.lineCap = 'round';
  // Pitch ladder, about the flight path: solid above, dashed below.
  g.save();
  g.beginPath();
  g.rect(W * 0.12, H * 0.1, W * 0.76, H * 0.72);
  g.clip();
  g.translate(cx, cy);
  g.rotate(-d.bank * D2R);
  for (let p = -90; p <= 90; p += 5) {
    const y = (d.pitch - p) * ppd;
    if (Math.abs(y) > H * 0.6) continue;
    if (p === 0) {
      line(g, -W * 0.42, y, -46, y, col, 3);
      line(g, 46, y, W * 0.42, y, col, 3);
      continue;
    }
    g.setLineDash(p < 0 ? [10, 8] : []);
    const w0 = 34;
    const w1 = 96;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(s * w0, y);
      g.lineTo(s * w1, y);
      g.lineTo(s * w1, y + (p > 0 ? 10 : -10));
      g.stroke();
      text(g, String(Math.abs(p)), s * (w1 + 22), y, 20, col, 'center', 700, MONO);
    }
    g.setLineDash([]);
  }
  g.restore();
  // The flight path marker: where the aeroplane is actually going.
  const fx = cx + clamp(d.fpmX, -12, 12) * ppd;
  const fy = cy - clamp(d.fpmY - 0, -14, 14) * ppd;
  g.beginPath();
  g.arc(fx, fy, 10, 0, Math.PI * 2);
  g.stroke();
  line(g, fx - 28, fy, fx - 10, fy, col, 3);
  line(g, fx + 10, fy, fx + 28, fy, col, 3);
  line(g, fx, fy - 10, fx, fy - 22, col, 3);
  // The waterline: where the nose points.
  g.beginPath();
  g.moveTo(cx - 26, cy);
  g.lineTo(cx - 12, cy);
  g.lineTo(cx - 6, cy + 8);
  g.lineTo(cx, cy);
  g.lineTo(cx + 6, cy + 8);
  g.lineTo(cx + 12, cy);
  g.lineTo(cx + 26, cy);
  g.stroke();
  // Heading tape across the top.
  {
    const y = H * 0.07;
    g.save();
    g.beginPath();
    g.rect(cx - 150, y - 30, 300, 60);
    g.clip();
    for (let a = Math.floor(d.hdg / 5) * 5 - 20; a <= d.hdg + 20; a += 5) {
      const x = cx + (a - d.hdg) * 7;
      const major = ((a % 10) + 10) % 10 === 0;
      line(g, x, y + 10, x, y + (major ? 24 : 18), col, 2.5);
      if (major) text(g, String(((a + 360) % 360) / 10).padStart(2, '0'), x, y - 6, 18, col, 'center', 700, MONO);
    }
    g.restore();
    line(g, cx, y + 26, cx, y + 38, col, 3);
  }
  // Speed and height boxes.
  const by = cy - 10;
  box(g, 18, by - 22, 92, 40, col, 2.5);
  text(g, String(Math.round(Math.max(0, d.ias))), 64, by - 1, 26, col, 'center', 700, MONO);
  box(g, W - 122, by - 22, 104, 40, col, 2.5);
  text(g, String(Math.round(d.alt)), W - 70, by - 1, 26, col, 'center', 700, MONO);
  if (d.agl < 1500 && !d.onGround) text(g, `${Math.round(d.agl)}R`, W - 70, by + 34, 18, col, 'center', 700, MONO);
  // G, Mach and AoA bottom left; the vertical speed bottom right.
  text(g, `G ${d.g.toFixed(1)}`, 26, H * 0.74, 20, col, 'left', 700, MONO);
  text(g, `M ${d.mach.toFixed(2)}`, 26, H * 0.8, 20, col, 'left', 700, MONO);
  text(g, `α ${d.aoa.toFixed(1)}`, 26, H * 0.86, 20, col, 'left', 700, MONO);
  text(g, `${d.vs >= 0 ? '+' : '-'}${Math.round(Math.abs(d.vs))}`, W - 26, H * 0.74, 20, col, 'right', 700, MONO);
  if (d.ap) text(g, 'A/P', W - 26, H * 0.8, 20, col, 'right', 700, MONO);
  if (d.gearDown && !d.onGround) text(g, 'GEAR', W - 26, H * 0.86, 20, col, 'right', 700, MONO);
  if (o.extra) o.extra(g, W, H, d, col);
  d.shown.hud = { ias: Math.round(Math.max(0, d.ias)), alt: Math.round(d.alt), hdg: Math.round(d.hdg) % 360 };
}

/* ------------------------------------------------------------------ *
 * The screen object and the bus that paints them
 * ------------------------------------------------------------------ */

/**
 * What a screen's picture depends on, quantised to what it can show: if
 * this has not changed since its last paint, the paint (and the texture
 * upload, which is most of the cost) is skipped. `kind` 'text' screens (the
 * UFC, CDU, MCP) care only about the numbers; the rest about the attitude
 * and the map too.
 */
const q = (v, step) => Math.round((v || 0) / step);
export function signature(d, kind = 'flight') {
  const base = `${q(d.ias, 1)}|${q(d.alt, 10)}|${q(d.hdg, 1)}|${q(d.vs, 50)}|${q(d.throttle, 0.02)}|${q(d.fuel, 0.01)}|${q(d.gear, 0.1)}|${q(d.flaps, 0.05)}|${d.ap ? 1 : 0}|${q(d.selHdg, 1)}|${q(d.selAlt, 10)}|${q(d.selSpd, 1)}|${q(d.selVs, 50)}|${d.engineOn ? 1 : 0}|${q(d.rpm, 0.01)}|${d.stalled ? 1 : 0}`;
  if (kind === 'text') return base;
  return `${base}|${q(d.pitch, 0.25)}|${q(d.bank, 0.4)}|${q(d.fpmX, 0.2)}|${q(d.fpmY, 0.2)}|${q(d.g, 0.05)}|${q(d.x, 15)}|${q(d.z, 15)}|${q(d.gs, 1)}|${q(d.slip, 0.05)}|${d.realistic ? 1 : 0}|${q(d.agl, 10)}`;
}

/**
 * One screen: a canvas, its texture and the material that shows it.
 *
 * `widthM`/`heightM` the glass in metres; `paint(g, W, H, d)` the painter
 * (with its options already bound). `hud` screens are transparent and
 * additive; the rest are glossy black glass that glows.
 */
export class Display {
  constructor({ name, w = 512, h = 512, paint, widthM, heightM, hud = false, colour = null, res = 0.75, hz = 0, kind = 'flight' }) {
    this.name = name;
    this.kind = kind;
    // Its own repaint rate, if not the bus's: 15 for the HUD (the flight path
    // marker), 4 for a page of text that changes once a second.
    this.hz = hz;
    this.paintFn = paint;
    // Painters draw in a 512-ish logical square; the canvas behind it is
    // `res` of that — three-quarters by default, which is still sharper than
    // any screen in the cockpit is drawn on a monitor, for 56% of the upload.
    this.W = w;
    this.H = h;
    this.res = res;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(16, Math.round(w * res));
    this.canvas.height = Math.max(16, Math.round(h * res));
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.paints = 0;
    this.age = 0;
    this.hud = hud;
    this.dead = false;
    if (hud) {
      this.material = new THREE.MeshBasicMaterial({
        map: this.texture,
        color: colour || 0xffffff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
    } else {
      // Glossy black glass: the picture is light the screen gives off, and
      // the sky and the sun still reflect off it (the scene's environment).
      this.material = new THREE.MeshStandardMaterial({
        color: 0x07090b,
        emissive: 0xffffff,
        emissiveMap: this.texture,
        emissiveIntensity: 1,
        roughness: 0.14,
        metalness: 0.0,
        envMapIntensity: 0.55,
      });
    }
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(widthM, heightM), this.material);
    this.mesh.name = `display ${name}`;
    this.mesh.userData.display = this;
    // The screens own their textures; when the aeroplane's materials are
    // disposed on a type change, these go with them.
    this.material.addEventListener('dispose', () => this.texture.dispose());
  }

  paint(d, env) {
    const g = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (env && env.blackout) {
      if (!this.dead) {
        this.dead = true;
        g.setTransform(1, 0, 0, 1, 0, 0);
        if (this.hud) g.clearRect(0, 0, W, H);
        else {
          g.fillStyle = '#000';
          g.fillRect(0, 0, W, H);
        }
        this.texture.needsUpdate = true;
      }
      return;
    }
    this.dead = false;
    g.setTransform(this.res, 0, 0, this.res, 0, 0);
    this.paintFn(g, this.W, this.H, d);
    this.paints++;
    this.texture.needsUpdate = true;
  }
}

/**
 * Paints a cockpit's screens in turn: each about `hz` times a second, the
 * one that has waited longest first, never more than `maxPerFrame` in one
 * frame — so the texture uploads are spread out instead of all landing on
 * the same frame.
 */
export class DisplayBus {
  constructor({ hz = 12, maxPerFrame = 2 } = {}) {
    this.period = 1 / hz;
    this.maxPerFrame = maxPerFrame;
    this.list = [];
    this.data = {};
    this.skipped = 0;
  }

  add(display) {
    display.period = display.hz > 0 ? 1 / display.hz : this.period;
    display.sig = null;
    display.idle = 0;
    // Staggered from the start, so they never fall into step.
    display.age = display.period * (1 - this.list.length * 0.37 % 1);
    this.list.push(display);
    return display;
  }

  /** `read(out)` fills the snapshot; called only when something will paint. */
  update(dt, read, env) {
    for (const s of this.list) s.age += dt;
    let n = 0;
    const blackout = !!(env && env.blackout);
    if (blackout) {
      // The power is gone: every screen goes black at once (a fill, no paint).
      for (const s of this.list) if (!s.dead) s.paint(this.data, env);
      return 0;
    }
    let fresh = false;
    for (let guard = 0; guard < this.list.length + 2; guard++) {
      if (n >= this.maxPerFrame) break;
      let best = null;
      for (const s of this.list) {
        if (s.age < s.period && !s.dead) continue;
        // The most overdue, as a share of its own period.
        if (!best || s.age / s.period > best.age / best.period) best = s;
      }
      if (!best) break;
      if (!fresh) {
        read(this.data);
        fresh = true;
      }
      // Nothing it shows has changed (to the digit, the degree, the pixel
      // of a needle): no paint, no upload. Still at least once a second.
      const sig = signature(this.data, best.kind);
      if (sig === best.sig && best.idle < 1 && !best.dead) {
        best.idle += best.age;
        best.age = 0;
        this.skipped++;
        continue;
      }
      best.sig = sig;
      best.idle = 0;
      best.paint(this.data, env);
      best.age = 0;
      n++;
    }
    return n;
  }

  /** Paint every screen now (after building, so nothing starts blank). */
  paintAll(read, env) {
    read(this.data);
    for (const s of this.list) {
      s.paint(this.data, env);
      s.age = 0;
    }
  }
}
