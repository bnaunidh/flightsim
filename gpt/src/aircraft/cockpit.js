/**
 * Cockpit interior with live instruments.
 *
 * The panel is a canvas texture: all the static artwork (bezels, tick marks,
 * arcs, lettering) is painted once into an offscreen layer, then every frame we
 * blit that layer and draw only the needles on top. That keeps a full
 * six-instrument panel plus radio stack at well under a millisecond a frame.
 */

import * as THREE from '../vendor/three.module.js';
import { panelTexture, panelNormal, leatherTexture, dropletTexture } from '../render/textures.js';
import { clamp, lerp } from '../core/noise.js';
import { UNITS } from './physics.js';

const CW = 1600;
const CH = 800;

const FACE = '#0e1013';
const TEXT = '#e8eaee';
const DIM = '#9aa0a8';

/**
 * A milled aluminium bezel.
 *
 * Three passes, which is what makes it read as metal rather than a grey circle:
 * a lit rim (light from the top left, the direction the cabin light comes
 * from), a chamfer that catches that light along its upper edge and falls into
 * shadow along its lower one, and a contact shadow underneath so the
 * instrument sits *in* the panel instead of on top of a picture of one.
 */
function ring(ctx, x, y, r) {
  // Contact shadow first, offset down — the instrument is proud of the panel.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 7;
  ctx.fillStyle = '#2a2e34';
  ctx.beginPath();
  ctx.arc(x, y, r + 11, 0, Math.PI * 2);
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
  ctx.arc(x, y, r + 11, 0, Math.PI * 2);
  ctx.fill();

  // Chamfer: a bright arc across the top, a dark one across the bottom.
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.30)';
  ctx.beginPath();
  ctx.arc(x, y, r + 9.5, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.arc(x, y, r + 9.5, Math.PI * 0.08, Math.PI * 0.92);
  ctx.stroke();

  // Four bezel screws, at the corners like the real thing.
  ctx.fillStyle = '#9aa1aa';
  for (const a of [0.78, 2.36, 3.93, 5.5]) {
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * (r + 6), y + Math.sin(a) * (r + 6), 2.6, 0, Math.PI * 2);
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
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(x, y, r - 2, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * The reflection in the instrument glass. Drawn last, over the needles, so it
 * sits where glass actually is. Kept faint — a real dial you can still read.
 */
function glassOver(ctx, x, y, r) {
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

function label(ctx, x, y, text, size = 15, color = DIM, align = 'center') {
  ctx.fillStyle = color;
  ctx.font = `600 ${size}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

function arc(ctx, x, y, r, a0, a1, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(x, y, r, a0, a1);
  ctx.stroke();
}

function needle(ctx, x, y, angle, len, width, color, tail = 0.18) {
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

const GAUGE = {
  asi: { x: 200, y: 218, r: 108 },
  ai: { x: 448, y: 218, r: 116 },
  alt: { x: 700, y: 218, r: 108 },
  turn: { x: 200, y: 470, r: 100 },
  hdg: { x: 448, y: 470, r: 108 },
  vsi: { x: 700, y: 470, r: 100 },
  tach: { x: 930, y: 470, r: 92 },
  fuel: { x: 930, y: 218, r: 92 },
};

/** Where the two screens sit on the glass panel, in canvas pixels. */
const GLASS = {
  pfd: { x: 70, y: 70, w: 940, h: 640 },
  eng: { x: 1080, y: 70, w: 222, h: 640 },
};

export class InstrumentPanel {
  /**
   * @param {boolean} highContrast
   * @param {'classic'|'glass'} layout  round dials, or screens
   *
   * A 1970s six-pack in a fly-by-wire fighter was the last thing in here that
   * still looked like a placeholder. Jets and the airliner get a primary
   * flight display: speed and altitude as moving tapes either side of an
   * attitude ball, heading along the bottom, engine and fuel down the side —
   * the same numbers, arranged the way the aeroplane that has them arranges
   * them.
   */
  constructor(highContrast = false, layout = 'classic') {
    this.highContrast = highContrast;
    this.layout = layout;
    this.staticLayer = document.createElement('canvas');
    this.staticLayer.width = CW;
    this.staticLayer.height = CH;
    this.canvas = document.createElement('canvas');
    this.canvas.width = CW;
    this.canvas.height = CH;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.acc = 0;
    if (this.layout === 'glass') this.drawStaticGlass();
    else {
      this.drawStatic();
      this.drawGlassLayer();
    }
    // Smoothed instrument values — real needles have inertia.
    this.smooth = { ias: 0, alt: 0, vs: 0, hdg: 90, rpm: 0, pitch: 0, bank: 0, slip: 0, fuel: 1 };
  }

  /**
   * The panel itself, under the instruments: a wrinkle-finish casting with a
   * pool of light spilling down from the glareshield and the corners falling
   * away into shadow. The old panel was a flat grey rectangle with a vertical
   * gradient, which is why every instrument looked stuck to a wall.
   */
  drawPanelBase(ctx) {
    ctx.fillStyle = '#1c2025';
    ctx.fillRect(0, 0, CW, CH);

    // Wrinkle paint: fine speckle, the texture every light-aircraft panel has.
    let seed = 20240611;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 9000; i++) {
      const x = rnd() * CW;
      const y = rnd() * CH;
      const v = rnd();
      ctx.fillStyle = v > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.07)';
      ctx.fillRect(x, y, 1 + rnd() * 2, 1 + rnd() * 2);
    }

    // Light from the glareshield: brightest across the top, dying out below.
    const lit = ctx.createRadialGradient(CW * 0.42, -140, 80, CW * 0.42, 250, CH * 1.35);
    lit.addColorStop(0, 'rgba(255,244,220,0.16)');
    lit.addColorStop(0.45, 'rgba(255,240,215,0.04)');
    lit.addColorStop(1, 'rgba(0,0,0,0.34)');
    ctx.fillStyle = lit;
    ctx.fillRect(0, 0, CW, CH);

    // Corner vignette, so the panel edges recede into the cabin.
    const vig = ctx.createRadialGradient(CW / 2, CH / 2, CH * 0.3, CW / 2, CH / 2, CH * 1.05);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, CW, CH);

    // A raised sub-panel behind the flight instruments, as a real six-pack has.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = 'rgba(255,255,255,0.030)';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(56, 76, 1010, 560, 22) : ctx.rect(56, 76, 1010, 560);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(56, 76, 1010, 560, 22) : ctx.rect(56, 76, 1010, 560);
    ctx.stroke();

    // Panel fasteners around its edge.
    ctx.fillStyle = '#5c636c';
    for (let i = 0; i <= 6; i++) {
      const x = 56 + (1010 * i) / 6;
      for (const y of [76, 636]) {
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(x - 3.5, y - 0.8, 7, 1.6);
        ctx.fillStyle = '#5c636c';
      }
    }
  }

  /* ================================================================== *
   * Glass cockpit
   *
   * The same numbers as the round dials, arranged the way an aeroplane
   * that has screens arranges them: speed on a tape down the left,
   * altitude on a tape down the right, the attitude ball between them,
   * heading along the bottom, and the engine down the side.
   *
   * The reason a tape beats a dial here is not fashion. A needle tells you
   * a value; a tape tells you a value *and* what is coming — you can see
   * the numbers you are about to reach sliding towards the pointer, which
   * is what you actually want at 300 knots.
   * ================================================================== */

  /** Frames, bezels and lettering — painted once. */
  drawStaticGlass() {
    const ctx = this.staticLayer.getContext('2d');
    this.drawPanelBase(ctx);

    const G = GLASS;
    // The screens themselves: near-black glass, slightly proud of the panel.
    const screen = (x, y, w, h) => {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 6;
      ctx.fillStyle = '#2b3036';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x - 9, y - 9, w + 18, h + 18, 12) : ctx.rect(x - 9, y - 9, w + 18, h + 18);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#05070a';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, y, w, h, 6) : ctx.rect(x, y, w, h);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 2;
      ctx.stroke();
    };
    screen(G.pfd.x, G.pfd.y, G.pfd.w, G.pfd.h);
    screen(G.eng.x, G.eng.y, G.eng.w, G.eng.h);

    // Engine display headings, which never change.
    label(ctx, G.eng.x + G.eng.w / 2, G.eng.y + 26, 'ENGINE', 13, DIM);
    label(ctx, G.eng.x + 52, G.eng.y + 74, 'N1 %', 12, DIM);
    label(ctx, G.eng.x + 168, G.eng.y + 74, 'FUEL', 12, DIM);
    label(ctx, G.eng.x + G.eng.w / 2, G.eng.y + G.eng.h - 128, 'FLAPS', 12, DIM);
    label(ctx, G.eng.x + G.eng.w / 2, G.eng.y + G.eng.h - 62, 'GEAR', 12, DIM);
  }

  /** The live PFD. Called at ~30 Hz. */
  renderGlass(ac, weather) {
    const ctx = this.ctx;
    const r = ac.readouts();
    const s = this.smooth;
    const k = 0.3;
    s.ias = lerp(s.ias, r.iasKts, k);
    s.alt = lerp(s.alt, r.altFt, k);
    s.vs = lerp(s.vs, r.vsFpm, 0.18);
    let dh = ((r.heading - s.hdg + 540) % 360) - 180;
    s.hdg = (s.hdg + dh * k + 360) % 360;
    s.rpm = lerp(s.rpm, r.rpm, k);
    s.pitch = lerp(s.pitch, r.pitch, 0.35);
    s.bank = lerp(s.bank, r.bank, 0.35);
    s.slip = lerp(s.slip, r.slip, 0.2);
    s.fuel = lerp(s.fuel, r.fuelPct, 0.1);

    ctx.clearRect(0, 0, CW, CH);
    ctx.drawImage(this.staticLayer, 0, 0);

    const G = GLASS;
    const P = G.pfd;
    const cx = P.x + P.w / 2;
    const cy = P.y + P.h / 2 - 20;

    /* ---- Attitude: sky, ground, pitch ladder, bank pointer ---- */
    ctx.save();
    ctx.beginPath();
    ctx.rect(P.x + 150, P.y + 4, P.w - 300, P.h - 100);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate((-s.bank * Math.PI) / 180);
    const pxPerDeg = 6.2;
    const off = s.pitch * pxPerDeg;
    const sky = ctx.createLinearGradient(0, -P.h, 0, off);
    sky.addColorStop(0, '#0f4d86');
    sky.addColorStop(1, '#4aa3dd');
    ctx.fillStyle = sky;
    ctx.fillRect(-P.w, -P.h * 1.5 + off, P.w * 2, P.h * 1.5);
    const grd = ctx.createLinearGradient(0, off, 0, P.h);
    grd.addColorStop(0, '#8a5f30');
    grd.addColorStop(1, '#4a3218');
    ctx.fillStyle = grd;
    ctx.fillRect(-P.w, off, P.w * 2, P.h * 1.5);
    // Horizon.
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-P.w, off);
    ctx.lineTo(P.w, off);
    ctx.stroke();
    // Pitch ladder.
    ctx.lineWidth = 2;
    ctx.font = '600 15px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let d = -30; d <= 30; d += 5) {
      if (d === 0) continue;
      const yy = off - d * pxPerDeg;
      const w = d % 10 === 0 ? 62 : 30;
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(-w, yy);
      ctx.lineTo(w, yy);
      ctx.stroke();
      if (d % 10 === 0) {
        ctx.fillStyle = '#ffffff';
        ctx.fillText(String(Math.abs(d)), -w - 20, yy);
        ctx.fillText(String(Math.abs(d)), w + 20, yy);
      }
    }
    ctx.restore();

    /* ---- Bank scale and the fixed aircraft symbol ---- */
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    const bankR = 168;
    for (const d of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const a = (d * Math.PI) / 180;
      const len = d === 0 ? 18 : d % 30 === 0 ? 14 : 8;
      ctx.beginPath();
      ctx.moveTo(Math.sin(a) * bankR, -Math.cos(a) * bankR);
      ctx.lineTo(Math.sin(a) * (bankR - len), -Math.cos(a) * (bankR - len));
      ctx.stroke();
    }
    const ba = (-s.bank * Math.PI) / 180;
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.moveTo(Math.sin(ba) * (bankR - 20), -Math.cos(ba) * (bankR - 20));
    ctx.lineTo(Math.sin(ba) * (bankR - 20) - 10, -Math.cos(ba) * (bankR - 20) + 17);
    ctx.lineTo(Math.sin(ba) * (bankR - 20) + 10, -Math.cos(ba) * (bankR - 20) + 17);
    ctx.closePath();
    ctx.fill();
    // Slip: the little trapezoid under the bank pointer slides with the ball.
    ctx.fillStyle = '#ffffff';
    const slipX = clamp(s.slip, -1, 1) * 26;
    ctx.fillRect(Math.sin(ba) * (bankR - 20) - 11 + slipX, -Math.cos(ba) * (bankR - 20) + 20, 22, 6);
    // Aircraft symbol.
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-88, 0);
    ctx.lineTo(-34, 0);
    ctx.lineTo(-34, 16);
    ctx.moveTo(88, 0);
    ctx.lineTo(34, 0);
    ctx.lineTo(34, 16);
    ctx.stroke();
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(-5, -5, 10, 10);
    ctx.restore();

    /* ---- Speed tape ---- */
    this.tape(ctx, {
      x: P.x + 16,
      y: P.y + 20,
      w: 118,
      h: P.h - 140,
      value: s.ias,
      step: 10,
      pxPerUnit: 5.2,
      decimals: 0,
      label: 'KIAS',
      // Colour bands: green normal, amber caution, red at the limit.
      bands: [
        [0, 48, '#e8402a'],
        [48, 55, '#f2c53d'],
        [55, 130, '#3ec96a'],
        [130, 160, '#f2c53d'],
        [160, 400, '#e8402a'],
      ],
      align: 'right',
    });

    /* ---- Altitude tape ---- */
    this.tape(ctx, {
      x: P.x + P.w - 134,
      y: P.y + 20,
      w: 118,
      h: P.h - 140,
      value: s.alt,
      step: 100,
      pxPerUnit: 0.42,
      decimals: 0,
      label: 'FEET',
      align: 'left',
    });

    /* ---- Vertical speed, as a bar beside the altitude tape ---- */
    {
      const vx = P.x + P.w - 8;
      const vy = P.y + 20;
      const vh = P.h - 140;
      const mid = vy + vh / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(vx, vy, 4, vh);
      const v = clamp(s.vs, -2000, 2000);
      const len = (v / 2000) * (vh / 2 - 8);
      ctx.fillStyle = Math.abs(v) > 1500 ? '#f2c53d' : '#3ec96a';
      ctx.fillRect(vx, mid - Math.max(0, len), 4, Math.abs(len));
      label(ctx, vx + 2, vy - 8, 'VS', 10, DIM);
    }

    /* ---- Heading strip along the bottom ---- */
    {
      const hx = P.x + 150;
      const hw = P.w - 300;
      const hy = P.y + P.h - 74;
      ctx.fillStyle = 'rgba(4,7,11,0.9)';
      ctx.fillRect(hx, hy, hw, 46);
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(hx, hy, hw, 46);
      ctx.save();
      ctx.beginPath();
      ctx.rect(hx, hy, hw, 46);
      ctx.clip();
      const pxPerDegH = 4.6;
      const centre = hx + hw / 2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let d = -60; d <= 60; d += 5) {
        const deg = (Math.round(s.hdg / 5) * 5 + d + 720) % 360;
        const px = centre + (d - (s.hdg - Math.round(s.hdg / 5) * 5)) * pxPerDegH;
        const major = deg % 10 === 0;
        ctx.strokeStyle = '#c9ced6';
        ctx.lineWidth = major ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(px, hy + 46);
        ctx.lineTo(px, hy + 46 - (major ? 12 : 7));
        ctx.stroke();
        if (deg % 30 === 0) {
          ctx.fillStyle = '#e8eaee';
          ctx.font = '700 16px "Helvetica Neue", Arial, sans-serif';
          const t = deg === 0 ? 'N' : deg === 90 ? 'E' : deg === 180 ? 'S' : deg === 270 ? 'W' : String(deg / 10);
          ctx.fillText(t, px, hy + 18);
        }
      }
      ctx.restore();
      // The bug: current heading in a box in the middle.
      ctx.fillStyle = '#0b0e12';
      ctx.fillRect(centre - 42, hy - 26, 84, 28);
      ctx.strokeStyle = '#8fa2b4';
      ctx.lineWidth = 2;
      ctx.strokeRect(centre - 42, hy - 26, 84, 28);
      ctx.fillStyle = '#e8eaee';
      ctx.font = '700 20px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(Math.round(s.hdg)).padStart(3, '0'), centre, hy - 11);
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.moveTo(centre, hy + 2);
      ctx.lineTo(centre - 8, hy - 8);
      ctx.lineTo(centre + 8, hy - 8);
      ctx.closePath();
      ctx.fill();
    }

    /* ---- Engine strip ---- */
    {
      const E = GLASS.eng;
      // N1 and fuel as vertical bars.
      const bar = (bx, by, bh, frac, colour, text) => {
        ctx.fillStyle = '#0b0e12';
        ctx.fillRect(bx, by, 46, bh);
        ctx.fillStyle = colour;
        const fh = bh * clamp(frac, 0, 1);
        ctx.fillRect(bx + 3, by + bh - fh + 3 > by + bh ? by + bh : by + (bh - fh), 40, Math.max(0, fh - 3));
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bx, by, 46, bh);
        ctx.fillStyle = '#e8eaee';
        ctx.font = '700 17px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, bx + 23, by + bh + 20);
      };
      const bh = 200;
      bar(E.x + 30, E.y + 92, bh, s.rpm, s.rpm > 0.93 ? '#f2c53d' : '#3ec96a', `${Math.round(s.rpm * 100)}`);
      bar(
        E.x + 146,
        E.y + 92,
        bh,
        s.fuel,
        s.fuel < 0.15 ? '#ff5a3c' : '#3ec96a',
        `${Math.round(r.fuelL)}L`
      );

      // Flap and gear position.
      const strip = (sy, frac, colour, text) => {
        ctx.fillStyle = '#0b0e12';
        ctx.fillRect(E.x + 30, sy, 162, 24);
        ctx.fillStyle = colour;
        ctx.fillRect(E.x + 32, sy + 2, 158 * clamp(frac, 0, 1), 20);
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(E.x + 30, sy, 162, 24);
        ctx.fillStyle = '#e8eaee';
        ctx.font = '700 13px "Helvetica Neue", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(text, E.x + 111, sy + 12);
      };
      strip(E.y + E.h - 112, ac.flaps || 0, '#4a9fe0', `${Math.round((ac.flaps || 0) * 30)}°`);
      strip(
        E.y + E.h - 46,
        r.gearPos,
        r.gearPos > 0.95 ? '#3ec96a' : '#ffb020',
        r.gearPos > 0.95 ? 'DOWN' : r.gearPos < 0.05 ? 'UP' : 'MOVING'
      );

      // Warnings, in words, top of the engine screen.
      const warn = r.stalled
        ? ['STALL', '#ff3b30']
        : !r.engineOn
          ? ['ENGINE OUT', '#ff3b30']
          : r.fuelPct < 0.15
            ? ['LOW FUEL', '#ff3b30']
            : null;
      if (warn) {
        ctx.fillStyle = warn[1];
        ctx.fillRect(E.x + 20, E.y + 36, E.w - 40, 30);
        ctx.fillStyle = '#101216';
        ctx.font = '800 18px "Helvetica Neue", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(warn[0], E.x + E.w / 2, E.y + 51);
      }
    }

    this.texture.needsUpdate = true;
  }

  /**
   * A moving-tape instrument: numbers slide past a fixed pointer.
   * Used for both speed and altitude, which differ only in their scale.
   */
  tape(ctx, o) {
    const { x, y, w, h, value, step, pxPerUnit, label: lab, bands, align } = o;
    const mid = y + h / 2;
    ctx.save();
    ctx.fillStyle = 'rgba(4,7,11,0.86)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    // Colour bands down the edge, if this tape has them.
    if (bands) {
      const bx = align === 'right' ? x + w - 7 : x;
      for (const [lo, hi, col] of bands) {
        const yLo = mid + (value - lo) * pxPerUnit;
        const yHi = mid + (value - hi) * pxPerUnit;
        ctx.fillStyle = col;
        ctx.fillRect(bx, Math.min(yLo, yHi), 7, Math.abs(yLo - yHi));
      }
    }

    // Ticks and numbers.
    const first = Math.floor((value - h / 2 / pxPerUnit) / step) * step;
    const last = Math.ceil((value + h / 2 / pxPerUnit) / step) * step;
    ctx.textBaseline = 'middle';
    for (let v = first; v <= last; v += step) {
      if (v < 0) continue;
      const ty = mid + (value - v) * pxPerUnit;
      ctx.strokeStyle = '#c9ced6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (align === 'right') {
        ctx.moveTo(x + w - 10, ty);
        ctx.lineTo(x + w - 24, ty);
      } else {
        ctx.moveTo(x + 10, ty);
        ctx.lineTo(x + 24, ty);
      }
      ctx.stroke();
      ctx.fillStyle = '#e8eaee';
      ctx.font = '600 19px "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = align === 'right' ? 'right' : 'left';
      ctx.fillText(String(Math.round(v)), align === 'right' ? x + w - 30 : x + 30, ty);
    }
    ctx.restore();

    // The pointer box, drawn over the tape so the current value is unmissable.
    ctx.fillStyle = '#0b0e12';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (align === 'right') {
      ctx.moveTo(x - 2, mid - 20);
      ctx.lineTo(x + w - 16, mid - 20);
      ctx.lineTo(x + w - 2, mid);
      ctx.lineTo(x + w - 16, mid + 20);
      ctx.lineTo(x - 2, mid + 20);
    } else {
      ctx.moveTo(x + 2, mid);
      ctx.lineTo(x + 16, mid - 20);
      ctx.lineTo(x + w + 2, mid - 20);
      ctx.lineTo(x + w + 2, mid + 20);
      ctx.lineTo(x + 16, mid + 20);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 26px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.max(0, Math.round(value))), x + w / 2 - 4, mid);
    label(ctx, x + w / 2, y + h + 22, lab, 13, DIM);
  }

  /**
   * The reflections in all eight dial glasses, drawn once into their own layer.
   *
   * The reflection has to go on last, over the needles, so it cannot live in
   * the static layer — but it was being rebuilt from scratch thirty times a
   * second: eight clips, eight linear gradients and eight full-bezel fills for
   * a picture whose pixels never change, because the gauges do not move. On a
   * school Chromebook that is real time spent every frame for no difference on
   * screen. It is the same compositing step either way: translucent white over
   * whatever the needles left behind.
   */
  drawGlassLayer() {
    this.glassLayer = document.createElement('canvas');
    this.glassLayer.width = CW;
    this.glassLayer.height = CH;
    const ctx = this.glassLayer.getContext('2d');
    for (const k in GAUGE) glassOver(ctx, GAUGE[k].x, GAUGE[k].y, GAUGE[k].r);
  }

  drawStatic() {
    const ctx = this.staticLayer.getContext('2d');
    this.drawPanelBase(ctx);

    /* ---- Airspeed indicator: 40–170 kt over 300° ---- */
    {
      const { x, y, r } = GAUGE.asi;
      ring(ctx, x, y, r);
      const a = (kt) => (-140 + ((kt - 40) / 130) * 300) * (Math.PI / 180);
      arc(ctx, x, y, r - 14, a(48), a(90), '#e8eaee', 7); // white (flap) arc
      arc(ctx, x, y, r - 24, a(55), a(130), '#3ec96a', 9); // green normal range
      arc(ctx, x, y, r - 24, a(130), a(160), '#f2c53d', 9); // yellow caution
      arc(ctx, x, y, r - 24, a(160), a(170), '#e8402a', 9); // red line
      ctx.strokeStyle = TEXT;
      for (let kt = 40; kt <= 170; kt += 10) {
        const ang = a(kt);
        const major = kt % 20 === 0;
        ctx.lineWidth = major ? 3 : 1.6;
        const r0 = r - (major ? 32 : 26);
        ctx.beginPath();
        ctx.moveTo(x + Math.sin(ang) * r0, y - Math.cos(ang) * r0);
        ctx.lineTo(x + Math.sin(ang) * (r - 12), y - Math.cos(ang) * (r - 12));
        ctx.stroke();
        if (major) {
          const rt = r - 50;
          label(ctx, x + Math.sin(ang) * rt, y - Math.cos(ang) * rt, String(kt), 19, TEXT);
        }
      }
      label(ctx, x, y + 44, 'AIRSPEED', 13, DIM);
      label(ctx, x, y + 62, 'KNOTS', 11, DIM);
    }

    /* ---- Attitude indicator: just the bezel and the fixed aircraft ---- */
    {
      const { x, y, r } = GAUGE.ai;
      ring(ctx, x, y, r);
      label(ctx, x, y + r + 26, 'ATTITUDE', 13, DIM);
    }

    /* ---- Altimeter ---- */
    {
      const { x, y, r } = GAUGE.alt;
      ring(ctx, x, y, r);
      ctx.strokeStyle = TEXT;
      for (let i = 0; i < 50; i++) {
        const ang = (i / 50) * Math.PI * 2;
        const major = i % 5 === 0;
        ctx.lineWidth = major ? 3 : 1.4;
        const r0 = r - (major ? 30 : 22);
        ctx.beginPath();
        ctx.moveTo(x + Math.sin(ang) * r0, y - Math.cos(ang) * r0);
        ctx.lineTo(x + Math.sin(ang) * (r - 10), y - Math.cos(ang) * (r - 10));
        ctx.stroke();
        if (major) {
          const rt = r - 50;
          label(ctx, x + Math.sin(ang) * rt, y - Math.cos(ang) * rt, String(i / 5), 20, TEXT);
        }
      }
      label(ctx, x, y + 46, 'ALTITUDE', 13, DIM);
      label(ctx, x, y + 63, 'FEET', 11, DIM);
    }

    /* ---- Turn coordinator ---- */
    {
      const { x, y, r } = GAUGE.turn;
      ring(ctx, x, y, r);
      ctx.strokeStyle = TEXT;
      ctx.lineWidth = 3;
      for (const s of [-1, 1]) {
        for (const off of [0.42, 0.72]) {
          const ang = s * off;
          ctx.beginPath();
          ctx.moveTo(x + Math.sin(ang) * (r - 26), y - Math.cos(ang) * (r - 26));
          ctx.lineTo(x + Math.sin(ang) * (r - 10), y - Math.cos(ang) * (r - 10));
          ctx.stroke();
        }
      }
      label(ctx, x, y - 46, 'L        R', 15, DIM);
      // Slip/skid tube.
      ctx.strokeStyle = '#2b3037';
      ctx.lineWidth = 22;
      ctx.beginPath();
      ctx.arc(x, y + 8, r - 34, Math.PI * 0.30, Math.PI * 0.70);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      for (const s of [-1, 1]) {
        const ang = Math.PI * 0.5 + s * 0.12;
        const rr = r - 34;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(ang) * (rr - 12), y + 8 + Math.sin(ang) * (rr - 12));
        ctx.lineTo(x + Math.cos(ang) * (rr + 12), y + 8 + Math.sin(ang) * (rr + 12));
        ctx.stroke();
      }
      label(ctx, x, y + r + 24, 'TURN & SLIP', 13, DIM);
    }

    /* ---- Heading indicator: only the bezel + lubber line ---- */
    {
      const { x, y, r } = GAUGE.hdg;
      ring(ctx, x, y, r);
      ctx.fillStyle = '#f2c53d';
      ctx.beginPath();
      ctx.moveTo(x, y - r + 4);
      ctx.lineTo(x - 9, y - r + 22);
      ctx.lineTo(x + 9, y - r + 22);
      ctx.closePath();
      ctx.fill();
      label(ctx, x, y + r + 26, 'HEADING', 13, DIM);
    }

    /* ---- Vertical speed ---- */
    {
      const { x, y, r } = GAUGE.vsi;
      ring(ctx, x, y, r);
      const a = (v) => (v / 2000) * 150 * (Math.PI / 180) + Math.PI / 2;
      ctx.strokeStyle = TEXT;
      for (let v = -2000; v <= 2000; v += 250) {
        const ang = a(v) - Math.PI / 2;
        const major = v % 500 === 0;
        ctx.lineWidth = major ? 3 : 1.4;
        const r0 = r - (major ? 28 : 20);
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(ang) * r0, y + Math.sin(ang) * r0);
        ctx.lineTo(x + Math.cos(ang) * (r - 8), y + Math.sin(ang) * (r - 8));
        ctx.stroke();
        if (major && v % 1000 === 0) {
          const rt = r - 48;
          label(ctx, x + Math.cos(ang) * rt, y + Math.sin(ang) * rt, String(Math.abs(v / 100)), 17, TEXT);
        }
      }
      label(ctx, x, y + 44, 'CLIMB', 13, DIM);
      label(ctx, x, y + 61, '100 FT/MIN', 10, DIM);
      arc(ctx, x, y, r - 14, a(-300) - Math.PI / 2, a(300) - Math.PI / 2, 'rgba(62,201,106,0.55)', 5);
    }

    /* ---- Tachometer ---- */
    {
      const { x, y, r } = GAUGE.tach;
      ring(ctx, x, y, r);
      const a = (rpm) => (-135 + (rpm / 2700) * 270) * (Math.PI / 180);
      arc(ctx, x, y, r - 20, a(2100), a(2500), '#3ec96a', 8);
      arc(ctx, x, y, r - 20, a(2500), a(2700), '#e8402a', 8);
      ctx.strokeStyle = TEXT;
      for (let rpm = 0; rpm <= 2700; rpm += 300) {
        const ang = a(rpm);
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(x + Math.sin(ang) * (r - 28), y - Math.cos(ang) * (r - 28));
        ctx.lineTo(x + Math.sin(ang) * (r - 10), y - Math.cos(ang) * (r - 10));
        ctx.stroke();
        label(ctx, x + Math.sin(ang) * (r - 46), y - Math.cos(ang) * (r - 46), String(rpm / 100), 15, TEXT);
      }
      label(ctx, x, y + 40, 'RPM x100', 12, DIM);
    }

    /* ---- Fuel + engine ---- */
    {
      const { x, y, r } = GAUGE.fuel;
      ring(ctx, x, y, r);
      const a = (f) => (-120 + f * 240) * (Math.PI / 180);
      arc(ctx, x, y, r - 20, a(0), a(0.15), '#e8402a', 8);
      arc(ctx, x, y, r - 20, a(0.15), a(1), '#3ec96a', 8);
      ctx.strokeStyle = TEXT;
      for (const [f, t] of [[0, 'E'], [0.25, '¼'], [0.5, '½'], [0.75, '¾'], [1, 'F']]) {
        const ang = a(f);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + Math.sin(ang) * (r - 28), y - Math.cos(ang) * (r - 28));
        ctx.lineTo(x + Math.sin(ang) * (r - 10), y - Math.cos(ang) * (r - 10));
        ctx.stroke();
        label(ctx, x + Math.sin(ang) * (r - 46), y - Math.cos(ang) * (r - 46), t, 16, TEXT);
      }
      label(ctx, x, y + 40, 'FUEL', 12, DIM);
    }

    /* ---- Radio stack + annunciators on the right ---- */
    {
      const x0 = 1080;
      ctx.fillStyle = '#14171b';
      ctx.strokeStyle = '#3a4046';
      ctx.lineWidth = 3;
      const box = (x, y, w, h, r2 = 8) => {
        ctx.beginPath();
        ctx.moveTo(x + r2, y);
        ctx.arcTo(x + w, y, x + w, y + h, r2);
        ctx.arcTo(x + w, y + h, x, y + h, r2);
        ctx.arcTo(x, y + h, x, y, r2);
        ctx.arcTo(x, y, x + w, y, r2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      };
      // COM radio.
      box(x0, 90, 460, 118);
      label(ctx, x0 + 20, 118, 'COM 1', 15, DIM, 'left');
      ctx.fillStyle = '#3ec96a';
      ctx.font = '700 54px "Courier New", monospace';
      ctx.textAlign = 'left';
      ctx.fillText('118.30', x0 + 20, 175);
      label(ctx, x0 + 300, 118, 'STBY', 13, DIM, 'left');
      ctx.fillStyle = '#8fa2b4';
      ctx.font = '700 30px "Courier New", monospace';
      ctx.fillText('121.90', x0 + 300, 172);

      // Transponder.
      box(x0, 228, 460, 96);
      label(ctx, x0 + 20, 252, 'XPDR', 14, DIM, 'left');
      ctx.fillStyle = '#3ec96a';
      ctx.font = '700 44px "Courier New", monospace';
      ctx.textAlign = 'left';
      ctx.fillText('1200', x0 + 20, 297);
      label(ctx, x0 + 250, 252, 'ALT', 14, DIM, 'left');

      // Annunciator panel frame.
      box(x0, 344, 460, 210);
      label(ctx, x0 + 230, 366, 'ANNUNCIATORS', 12, DIM);

      // Placards.
      label(ctx, x0 + 230, 600, 'N172SK  ·  SKYLARK 172', 16, '#c9ced6');
      label(ctx, x0 + 230, 628, 'ISLAND FLIGHT ACADEMY', 12, DIM);
      // Throttle / mixture quadrant markings.
      box(x0 - 40, 660, 540, 110);
      label(ctx, x0 - 10, 690, 'THROTTLE', 12, DIM, 'left');
      label(ctx, x0 + 250, 690, 'FLAPS', 12, DIM, 'left');
      label(ctx, x0 + 390, 690, 'GEAR', 12, DIM, 'left');
    }

    // Left placards.
    label(ctx, 90, 690, 'FLAPS  0  10  20  30', 14, DIM, 'left');
    label(ctx, 90, 716, 'GEAR  DOWN / UP  (G)', 14, DIM, 'left');
    label(ctx, 90, 742, 'BRAKES  SPACE', 14, DIM, 'left');
  }

  /** Redraw the moving parts. Called at ~30 Hz. */
  render(ac, weather) {
    const ctx = this.ctx;
    const r = ac.readouts();
    const s = this.smooth;
    const k = 0.28;
    s.ias = lerp(s.ias, r.iasKts, k);
    s.alt = lerp(s.alt, r.altFt, k);
    s.vs = lerp(s.vs, r.vsFpm, 0.18);
    // Heading needs wrap-aware smoothing.
    let dh = ((r.heading - s.hdg + 540) % 360) - 180;
    s.hdg = (s.hdg + dh * k + 360) % 360;
    s.rpm = lerp(s.rpm, r.rpm * 2700, k);
    s.pitch = lerp(s.pitch, r.pitch, 0.35);
    s.bank = lerp(s.bank, r.bank, 0.35);
    s.slip = lerp(s.slip, r.slip, 0.2);
    s.fuel = lerp(s.fuel, r.fuelPct, 0.1);

    ctx.clearRect(0, 0, CW, CH);
    ctx.drawImage(this.staticLayer, 0, 0);

    /* Airspeed needle. */
    {
      const { x, y, r: rr } = GAUGE.asi;
      const kt = clamp(s.ias, 0, 175);
      const ang = ((-140 + ((kt - 40) / 130) * 300) * Math.PI) / 180;
      needle(ctx, x, y, ang, rr - 16, 6, '#f4f6f8');
      ctx.fillStyle = '#20242a';
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
    }

    /* Attitude indicator. */
    {
      const { x, y, r: rr } = GAUGE.ai;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, rr - 6, 0, Math.PI * 2);
      ctx.clip();
      ctx.translate(x, y);
      ctx.rotate((-s.bank * Math.PI) / 180);
      const pxPerDeg = 3.1;
      const off = s.pitch * pxPerDeg;
      // Sky and ground.
      ctx.fillStyle = '#2f7fc4';
      ctx.fillRect(-rr * 2, -rr * 2 + off, rr * 4, rr * 2);
      ctx.fillStyle = '#8a5a34';
      ctx.fillRect(-rr * 2, off, rr * 4, rr * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-rr * 2, off);
      ctx.lineTo(rr * 2, off);
      ctx.stroke();
      // Pitch ladder.
      ctx.lineWidth = 2;
      ctx.font = '600 13px Arial';
      ctx.textAlign = 'center';
      for (let d = -30; d <= 30; d += 5) {
        if (d === 0) continue;
        const yy = off - d * pxPerDeg;
        const w = d % 10 === 0 ? 40 : 20;
        ctx.beginPath();
        ctx.moveTo(-w, yy);
        ctx.lineTo(w, yy);
        ctx.stroke();
        if (d % 10 === 0) {
          ctx.fillStyle = '#ffffff';
          ctx.fillText(String(Math.abs(d)), -w - 16, yy + 4);
          ctx.fillText(String(Math.abs(d)), w + 16, yy + 4);
        }
      }
      ctx.restore();

      // Bank scale + fixed aircraft symbol.
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = '#f2f4f6';
      ctx.lineWidth = 2.5;
      for (const d of [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60]) {
        const a = (d * Math.PI) / 180;
        const len = d % 30 === 0 ? 16 : 9;
        ctx.beginPath();
        ctx.moveTo(Math.sin(a) * (rr - 8), -Math.cos(a) * (rr - 8));
        ctx.lineTo(Math.sin(a) * (rr - 8 - len), -Math.cos(a) * (rr - 8 - len));
        ctx.stroke();
      }
      // Roll pointer.
      const ba = (-s.bank * Math.PI) / 180;
      ctx.fillStyle = '#f2c53d';
      ctx.beginPath();
      ctx.moveTo(Math.sin(ba) * (rr - 26), -Math.cos(ba) * (rr - 26));
      ctx.lineTo(Math.sin(ba) * (rr - 26) - 8, -Math.cos(ba) * (rr - 26) + 14);
      ctx.lineTo(Math.sin(ba) * (rr - 26) + 8, -Math.cos(ba) * (rr - 26) + 14);
      ctx.closePath();
      ctx.fill();
      // Aircraft symbol.
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-52, 0);
      ctx.lineTo(-16, 0);
      ctx.moveTo(16, 0);
      ctx.lineTo(52, 0);
      ctx.moveTo(0, -3);
      ctx.lineTo(0, 3);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    /* Altimeter: hundreds needle, thousands needle, digital window. */
    {
      const { x, y, r: rr } = GAUGE.alt;
      const alt = s.alt;
      const hundreds = ((alt % 1000) / 1000) * Math.PI * 2;
      const thousands = ((alt % 10000) / 10000) * Math.PI * 2;
      // Digital window.
      ctx.fillStyle = '#05070a';
      ctx.fillRect(x + 18, y - 14, 74, 28);
      ctx.strokeStyle = '#4a5058';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 18, y - 14, 74, 28);
      ctx.fillStyle = '#e8eaee';
      ctx.font = '700 21px "Courier New", monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(Math.max(0, Math.round(alt))).padStart(5, ' '), x + 88, y + 1);
      needle(ctx, x, y, thousands, rr - 48, 8, '#f4f6f8', 0.22);
      needle(ctx, x, y, hundreds, rr - 16, 5.5, '#f4f6f8');
      ctx.fillStyle = '#20242a';
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
    }

    /* Turn coordinator: little aircraft banks with roll, ball shows slip. */
    {
      const { x, y, r: rr } = GAUGE.turn;
      ctx.save();
      ctx.translate(x, y - 6);
      // Right turn (positive rate) banks the miniature aeroplane right, which
      // on a canvas means a positive (clockwise) rotation.
      ctx.rotate(clamp((ac.turnRate / 3) * 0.35, -0.8, 0.8));
      ctx.strokeStyle = '#f4f6f8';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-rr * 0.55, 0);
      ctx.lineTo(rr * 0.55, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -rr * 0.3);
      ctx.stroke();
      ctx.fillStyle = '#f4f6f8';
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Slip ball.
      const ballAng = Math.PI * 0.5 + clamp(s.slip, -1, 1) * 0.19;
      const br = rr - 34;
      ctx.fillStyle = '#1b1e22';
      ctx.beginPath();
      ctx.arc(x + Math.cos(ballAng) * br, y + 8 + Math.sin(ballAng) * br, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d8dce2';
      ctx.beginPath();
      ctx.arc(x + Math.cos(ballAng) * br, y + 8 + Math.sin(ballAng) * br, 7.5, 0, Math.PI * 2);
      ctx.fill();
    }

    /* Heading indicator: rotating compass card. */
    {
      const { x, y, r: rr } = GAUGE.hdg;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, rr - 4, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = '#0b0d10';
      ctx.fill();
      ctx.translate(x, y);
      ctx.rotate((-s.hdg * Math.PI) / 180);
      ctx.strokeStyle = '#e8eaee';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let d = 0; d < 360; d += 5) {
        const a = (d * Math.PI) / 180;
        const major = d % 30 === 0;
        ctx.lineWidth = major ? 3 : 1.4;
        const r0 = rr - (major ? 30 : 22);
        ctx.beginPath();
        ctx.moveTo(Math.sin(a) * r0, -Math.cos(a) * r0);
        ctx.lineTo(Math.sin(a) * (rr - 10), -Math.cos(a) * (rr - 10));
        ctx.stroke();
        if (major) {
          const t = d === 0 ? 'N' : d === 90 ? 'E' : d === 180 ? 'S' : d === 270 ? 'W' : String(d / 10);
          ctx.save();
          ctx.translate(Math.sin(a) * (rr - 52), -Math.cos(a) * (rr - 52));
          ctx.rotate(a);
          ctx.fillStyle = d % 90 === 0 ? '#ffd23f' : '#e8eaee';
          ctx.font = `700 ${d % 90 === 0 ? 22 : 18}px Arial`;
          ctx.fillText(t, 0, 0);
          ctx.restore();
        }
      }
      ctx.restore();
      // Fixed aeroplane silhouette.
      ctx.strokeStyle = '#f4f6f8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y - 22);
      ctx.lineTo(x, y + 24);
      ctx.moveTo(x - 20, y - 2);
      ctx.lineTo(x + 20, y - 2);
      ctx.moveTo(x - 9, y + 18);
      ctx.lineTo(x + 9, y + 18);
      ctx.stroke();
      // Digital heading.
      ctx.fillStyle = '#05070a';
      ctx.fillRect(x - 34, y + rr - 44, 68, 26);
      ctx.fillStyle = '#3ec96a';
      ctx.font = '700 20px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(Math.round(s.hdg)).padStart(3, '0') + '°', x, y + rr - 30);
    }

    /* Vertical speed. */
    {
      const { x, y, r: rr } = GAUGE.vsi;
      const v = clamp(s.vs, -2100, 2100);
      const ang = (v / 2000) * 150 * (Math.PI / 180);
      needle(ctx, x, y, ang + Math.PI / 2, rr - 14, 5.5, '#f4f6f8');
      ctx.fillStyle = '#20242a';
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
    }

    /* Tachometer. */
    {
      const { x, y, r: rr } = GAUGE.tach;
      const ang = ((-135 + (clamp(s.rpm, 0, 2700) / 2700) * 270) * Math.PI) / 180;
      needle(ctx, x, y, ang, rr - 14, 5, '#f4f6f8');
      ctx.fillStyle = '#20242a';
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
    }

    /* Fuel. */
    {
      const { x, y, r: rr } = GAUGE.fuel;
      const ang = ((-120 + clamp(s.fuel, 0, 1) * 240) * Math.PI) / 180;
      needle(ctx, x, y, ang, rr - 14, 5, s.fuel < 0.15 ? '#ff5a3c' : '#f4f6f8');
      ctx.fillStyle = '#20242a';
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c9ced6';
      ctx.font = '700 16px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(r.fuelL)} L`, x, y + 62);
    }

    /* Annunciator lamps. */
    {
      const x0 = 1080;
      const lamps = [
        ['STALL', ac.stalled, '#ff3b30'],
        ['GEAR UP', !r.gearDown && r.gearPos < 0.05, '#ffb020'],
        ['GEAR DOWN', r.gearDown && r.gearPos > 0.95, '#3ec96a'],
        ['LOW FUEL', r.fuelPct < 0.15, '#ff3b30'],
        ['BRAKES', r.brakes > 0.5, '#ffb020'],
        ['ENGINE', !r.engineOn, '#ff3b30'],
      ];
      ctx.textAlign = 'center';
      lamps.forEach((l, i) => {
        const lx = x0 + 20 + (i % 2) * 230;
        const ly = 388 + Math.floor(i / 2) * 54;
        ctx.fillStyle = l[1] ? l[2] : '#242830';
        ctx.strokeStyle = '#3a4046';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(lx, ly, 200, 42, 6) : ctx.rect(lx, ly, 200, 42);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = l[1] ? '#101216' : '#6d747d';
        ctx.font = '700 17px Arial';
        ctx.textBaseline = 'middle';
        ctx.fillText(l[0], lx + 100, ly + 22);
      });

      // Throttle / flap / gear position bars.
      const barY = 712;
      const bar = (bx, w, frac, color) => {
        ctx.fillStyle = '#0c0e12';
        ctx.fillRect(bx, barY, w, 26);
        ctx.fillStyle = color;
        ctx.fillRect(bx + 2, barY + 2, (w - 4) * clamp(frac, 0, 1), 22);
        ctx.strokeStyle = '#3a4046';
        ctx.lineWidth = 2;
        ctx.strokeRect(bx, barY, w, 26);
      };
      bar(x0 + 60, 170, r.throttle, '#3ec96a');
      bar(x0 + 300, 70, ac.flaps || 0, '#4a9fe0');
      bar(x0 + 420, 70, r.gearPos, r.gearPos > 0.95 ? '#3ec96a' : '#ffb020');
    }

    // Glass last, over the needles — that is where the glass is. Pre-drawn in
    // drawGlassLayer(), because none of it changes from one frame to the next.
    ctx.drawImage(this.glassLayer, 0, 0);

    this.texture.needsUpdate = true;
  }

  update(dt, ac, weather) {
    this.acc += dt;
    if (this.acc >= 1 / 30) {
      this.acc = 0;
      if (this.layout === 'glass') this.renderGlass(ac, weather);
      else this.render(ac, weather);
    }
  }
}

/**
 * Build the physical cockpit: panel shell, glareshield, yoke, throttle lever,
 * door frames, seats and the rain-streaked windshield overlay.
 */
/**
 * Per-aeroplane cockpit dressing.
 *
 * The instruments themselves are shared — an altimeter is an altimeter — but
 * what you hold and what the cabin is made of is not. A fast jet has a stick
 * between your knees and one thrust lever per engine; a light single has a
 * yoke and three knobs; an airliner has a wide, dark flight deck.
 */
const COCKPIT_STYLES = {
  // `panel` picks the instruments: round dials for the light aeroplanes,
  // screens for anything with a jet engine. A 1970s six-pack in a fly-by-wire
  // fighter was the last thing in here that still looked like a placeholder.
  trainer: { stick: 'yoke', levers: 'prop', shell: 0x8f949c, trim: '#241c15', panel: 'classic' },
  tourer: { stick: 'yoke', levers: 'prop', shell: 0x6d747e, trim: '#1b2029', panel: 'classic' },
  airliner: { stick: 'yoke', levers: 'jet2', shell: 0x4a5058, trim: '#15181d', panel: 'glass' },
  fighter: { stick: 'centre', levers: 'jet1', shell: 0x3c4148, trim: '#101318', panel: 'glass' },
  carrier: { stick: 'centre', levers: 'jet1', shell: 0x424851, trim: '#12161b', panel: 'glass' },
};

export function createCockpit({ highContrast = false, type = null } = {}) {
  const style =
    COCKPIT_STYLES[String((type && type.class) || 'Trainer').toLowerCase()] || COCKPIT_STYLES.trainer;
  const group = new THREE.Group();
  group.name = 'cockpit';
  // Lifted with the eye point (see EYE in flight/camera.js) so the panel keeps
  // its framing: top of the panel roughly 20 degrees below the horizon, which is
  // what you see from the left seat of a real high-wing trainer.
  group.position.y = 0.29;

  const panel = new InstrumentPanel(highContrast, style.panel || 'classic');

  const shellMat = new THREE.MeshStandardMaterial({
    map: panelTexture(),
    normalMap: panelNormal(),
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.78,
    metalness: 0.06,
    color: style.shell,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    map: leatherTexture(style.trim),
    roughness: 0.85,
  });

  /**
   * The panel face is bent towards the pilot at the edges.
   *
   * A real panel is not a flat board — it wraps, so the outboard instruments
   * face you instead of facing sideways past your shoulder. On a flat plane
   * the fuel gauge and the radio stack were both being read at a glancing
   * angle, which is exactly why the panel looked like a poster.
   */
  const curvedPanel = (w, h, curve, segs = 28) => {
    const g = new THREE.PlaneGeometry(w, h, segs, 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = p.getX(i) / (w / 2);
      p.setZ(i, t * t * curve);
    }
    p.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  };

  // Instrument panel face.
  const face = new THREE.Mesh(
    curvedPanel(1.46, 0.73, 0.075),
    new THREE.MeshStandardMaterial({
      map: panel.texture,
      roughness: 0.34,
      metalness: 0.08,
      emissive: 0xffffff,
      emissiveMap: panel.texture,
      emissiveIntensity: 0.22,
    })
  );
  face.position.set(0, -0.26, -0.94);
  face.rotation.x = 0.2;
  group.add(face);
  group.userData.panelFace = face;

  // Panel shell / coaming around it.
  const shell = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.9, 0.3), shellMat);
  shell.position.set(0, -0.40, -1.10);
  group.add(shell);

  /**
   * The glareshield: a padded hood that overhangs the panel.
   *
   * It was a flat 10 cm strip, which cast nothing and hid nothing. A real one
   * juts out over the instruments — it is what stops the sun landing on the
   * dials, and in here it is what gives the top of the panel an edge to sit
   * under. Built as a lip plus an underside so it reads as thick.
   */
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.09, 0.30), trimMat);
  hood.position.set(0, 0.035, -0.95);
  hood.rotation.x = -0.20;
  group.add(hood);
  // The rolled front edge, a slightly proud cylinder along the lip.
  const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.64, 12), trimMat);
  lip.rotation.z = Math.PI / 2;
  lip.position.set(0, 0.012, -0.815);
  group.add(lip);
  // Underside, darker, so there is a shadow line above the instruments.
  const hoodUnder = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.02, 0.26),
    new THREE.MeshStandardMaterial({ color: 0x0b0d11, roughness: 0.95 })
  );
  hoodUnder.position.set(0, -0.018, -0.94);
  hoodUnder.rotation.x = -0.20;
  group.add(hoodUnder);

  /**
   * Centre pedestal and side consoles.
   *
   * Everything below the panel used to be one flat kick plate, so the throttle
   * quadrant and the trim wheel floated in front of nothing. These give them
   * something to be mounted on, and they close the cabin down towards the
   * floor the way a real one narrows around your knees.
   */
  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.34), shellMat);
  pedestal.position.set(0.14, -0.62, -0.66);
  pedestal.rotation.x = -0.16;
  group.add(pedestal);
  for (const side of [-1, 1]) {
    const console_ = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.34, 0.9), trimMat);
    console_.position.set(side * 0.66, -0.72, -0.42);
    group.add(console_);
  }

  // Windscreen posts and roof.
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.08), shellMat);
    post.position.set(side * 0.72, 0.35, -0.78);
    post.rotation.x = -0.28;
    post.rotation.z = side * 0.12;
    group.add(post);
    // The cabin sides.
    //
    // These used to be a single 0.62 m panel in a cabin 1.57 m tall and 2.1 m
    // deep, so there was open sky above them, below them, in front of them and
    // behind them — from the pilot's seat the cockpit had holes all round it.
    // Now the side is closed from floor to roof and front to back, with one
    // deliberate gap left where the side window belongs.
    const SIDE_X = side * 0.78;
    const WIN_LOW = -0.12; // window sill
    const WIN_HIGH = 0.32; // window head
    const FLOOR_Y = -0.95;
    const ROOF_Y = 0.62;
    const FRONT_Z = -1.12;
    const BACK_Z = 1.02;
    const wall = (h, y, d, z, mat = shellMat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, d), mat);
      m.position.set(SIDE_X, y, z);
      group.add(m);
      return m;
    };
    // Below the window, all the way along.
    wall(WIN_LOW - FLOOR_Y, (WIN_LOW + FLOOR_Y) / 2, BACK_Z - FRONT_Z, (BACK_Z + FRONT_Z) / 2);
    // Above the window, up to the roof.
    wall(ROOF_Y - WIN_HIGH, (ROOF_Y + WIN_HIGH) / 2, BACK_Z - FRONT_Z, (BACK_Z + FRONT_Z) / 2, trimMat);
    // Behind the window, closing the corner to the bulkhead.
    wall(WIN_HIGH - WIN_LOW, (WIN_HIGH + WIN_LOW) / 2, BACK_Z - 0.42, BACK_Z - (BACK_Z - 0.42) / 2);
    // A slim post between the windscreen and the side window.
    wall(WIN_HIGH - WIN_LOW, (WIN_HIGH + WIN_LOW) / 2, 0.16, FRONT_Z + 0.08, trimMat);
  }
  // Roof and floor are widened to meet the side walls — they were narrower
  // than the cabin, which left a seam of daylight down each top corner.
  const roofPanel = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.06, 2.2), trimMat);
  roofPanel.position.set(0, 0.62, -0.05);
  group.add(roofPanel);
  const bulkhead = new THREE.Mesh(new THREE.BoxGeometry(1.68, 1.62, 0.06), trimMat);
  bulkhead.position.set(0, -0.16, 1.02);
  group.add(bulkhead);

  // Floor and rudder pedals.
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.06, 2.2), trimMat);
  floor.position.set(0, -0.95, -0.05);
  group.add(floor);
  // Close the shin gap between the bottom of the instrument panel and the
  // floor, which was open straight through to the outside world.
  const kick = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.62, 0.06), shellMat);
  kick.position.set(0, -0.66, -1.1);
  group.add(kick);
  const pedals = [];
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.2, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.7, metalness: 0.3 })
    );
    p.position.set(side * 0.2, -0.78, -0.86);
    p.rotation.x = -0.5;
    group.add(p);
    pedals.push({ mesh: p, side });
  }

  // Yoke: column, hub and horns. Moves with the controls.
  const yoke = new THREE.Group();
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 0.42, 10),
    new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.4, metalness: 0.6 })
  );
  column.rotation.x = Math.PI / 2;
  // Forwards, into the panel. It used to run backwards towards the pilot,
  // which put a fat grey cylinder end-on in the middle of the windscreen.
  column.position.z = -0.2;
  yoke.add(column);
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.5, metalness: 0.3 });
  const hub = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.06), hubMat);
  yoke.add(hub);
  for (const side of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.017, 8, 14, Math.PI * 1.1), hubMat);
    horn.rotation.y = Math.PI / 2;
    horn.rotation.z = side > 0 ? -Math.PI * 0.55 : Math.PI * 0.45;
    horn.position.x = side * 0.02;
    yoke.add(horn);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.13, 8), hubMat);
    grip.rotation.z = Math.PI / 2;
    grip.position.set(side * 0.19, 0, 0);
    yoke.add(grip);
  }
  // Yoke height matters more than it sounds. Sat down at -0.36 it was 53
  // degrees below the pilot's eye line — completely outside the view, so the
  // aeroplane appeared to have no controls at all. Up here it sits in the lower
  // third of the windscreen where a real one does, and you can watch it move.
  yoke.position.set(-0.24, -0.09, -0.5);
  yoke.scale.setScalar(0.85);
  if (style.stick === 'yoke') {
    group.add(yoke);
  } else {
    // A fast jet has a stick between your knees, not a control wheel.
    const stick = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.021, 0.028, 0.34, 10),
      new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.42, metalness: 0.55 })
    );
    shaft.position.y = 0.17;
    stick.add(shaft);
    const grip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.034, 0.034, 0.13, 10),
      new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.85 })
    );
    grip.position.y = 0.4;
    stick.add(grip);
    const swMat = new THREE.MeshStandardMaterial({ color: 0x8d939b, roughness: 0.4, metalness: 0.6 });
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 8), swMat);
    hat.position.set(0, 0.47, -0.012);
    stick.add(hat);
    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.045, 0.014), swMat);
    trigger.position.set(0, 0.38, -0.036);
    stick.add(trigger);
    stick.position.set(-0.05, -0.46, -0.42);
    group.add(stick);
    group.userData.stick = stick;
  }

  /* ---------------- Throttle quadrant ---------------- */
  // Three levers, the way a real light single is laid out: black throttle,
  // blue propeller, red mixture, left to right, on the panel's lower centre.
  const quadrant = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.13, 0.18), shellMat);
  quadrant.position.set(0.14, -0.34, -0.8);
  group.add(quadrant);

  const makeLever = (colour, shape) => {
    const g = new THREE.Group();
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.013, 0.013, 0.19, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.35, metalness: 0.7 })
    );
    stem.position.y = 0.095;
    g.add(stem);
    const mat = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.5 });
    // Real quadrants use shape as well as colour so you can find the right
    // lever without looking: round throttle, flat-topped prop, ribbed mixture.
    const knobGeo =
      shape === 'flat'
        ? new THREE.CylinderGeometry(0.032, 0.032, 0.03, 12)
        : shape === 'ribbed'
          ? new THREE.CylinderGeometry(0.026, 0.03, 0.055, 10)
          : new THREE.SphereGeometry(0.033, 12, 8);
    const k = new THREE.Mesh(knobGeo, mat);
    k.position.y = 0.2;
    g.add(k);
    return g;
  };

  // Propeller aeroplanes get throttle / propeller / mixture. Jets get thrust
  // levers — one per engine and nothing else, because that is all there is.
  const throttleLever = makeLever(style.levers === 'prop' ? 0x14171b : 0x22262c, 'round');
  const propLever = makeLever(0x1f4f9c, 'flat');
  const mixture = makeLever(0x8a1f1a, 'ribbed');
  if (style.levers === 'prop') {
    throttleLever.position.set(0.03, -0.4, -0.78);
    propLever.position.set(0.14, -0.4, -0.78);
    mixture.position.set(0.25, -0.4, -0.78);
    group.add(throttleLever, propLever, mixture);
  } else {
    throttleLever.position.set(style.levers === 'jet2' ? 0.09 : 0.14, -0.4, -0.78);
    throttleLever.scale.set(1, 1.3, 1);
    group.add(throttleLever);
    if (style.levers === 'jet2') {
      const second = makeLever(0x22262c, 'round');
      second.position.set(0.2, -0.4, -0.78);
      second.scale.set(1, 1.3, 1);
      group.add(second);
      group.userData.throttle2 = second;
    }
  }

  /* ---------------- Flap lever ---------------- */
  // Sits right of the quadrant and steps through the same detents as the wing.
  const flapBase = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.12), shellMat);
  flapBase.position.set(0.4, -0.38, -0.76);
  group.add(flapBase);
  const flapLever = makeLever(0xd9dde3, 'flat');
  flapLever.scale.setScalar(0.85);
  flapLever.position.set(0.4, -0.4, -0.74);
  group.add(flapLever);

  /* ---------------- Trim wheel ---------------- */
  const trimWheel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.075, 0.028, 20),
    new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.6, metalness: 0.2 })
  );
  trimWheel.rotation.z = Math.PI / 2;
  trimWheel.position.set(0.14, -0.5, -0.66);
  group.add(trimWheel);

  // Rain on the windscreen (only visible when it is actually raining).
  const dropMat = new THREE.MeshBasicMaterial({
    map: dropletTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
  });
  const droplets = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.1), dropMat);
  droplets.position.set(0, 0.02, -0.62);
  droplets.renderOrder = 20;
  group.add(droplets);

  let t = 0;
  /* ---------------- Annunciator panel ----------------
   *
   * The row of warning lights along the top of the glareshield. They are dark
   * until something is wrong, which is the point: when the engine quits you
   * should not have to read a menu to find out, you should see red in front of
   * you. MASTER CAUTION flashes whenever any of the others is lit.
   */
  function annunciator(label, colour) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 48;
    const g = c.getContext('2d');
    g.fillStyle = '#0a0c10';
    g.fillRect(0, 0, 128, 48);
    g.fillStyle = '#ffffff';
    g.font = 'bold 010px system-ui, sans-serif'.replace('010', label.length > 8 ? '17' : '21');
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, 64, 25);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: new THREE.Color(colour),
      emissiveIntensity: 0,
      color: 0x141820,
      roughness: 0.6,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.108, 0.042), mat);
    return m;
  }

  const WARNINGS = [
    { key: 'engine', label: 'ENGINE', colour: 0xff3b25 },
    { key: 'fuelLeak', label: 'FUEL', colour: 0xff3b25 },
    { key: 'elevator', label: 'PITCH', colour: 0xffa42b },
    { key: 'icing', label: 'ICE', colour: 0xffa42b },
    { key: 'gear', label: 'GEAR', colour: 0xffa42b },
    { key: 'brakes', label: 'BRAKES', colour: 0xffa42b },
    { key: 'roughEngine', label: 'ENG ROUGH', colour: 0xffa42b },
    { key: 'tyre', label: 'TYRE', colour: 0xffa42b },
  ];
  const lamps = [];
  WARNINGS.forEach((w, i) => {
    const m = annunciator(w.label, w.colour);
    // Along the glareshield, tilted back towards the pilot.
    m.position.set(-0.34 + i * 0.116, 0.10, -0.96);
    m.rotation.x = -0.42;
    group.add(m);
    lamps.push({ ...w, mat: m.material });
  });
  const master = annunciator('MASTER CAUTION', 0xff2a1a);
  master.geometry = new THREE.PlaneGeometry(0.15, 0.05);
  master.position.set(0.34, 0.165, -0.93);
  master.rotation.x = -0.42;
  group.add(master);

  group.userData.update = (dt, ac, weather) => {
    t += dt;

    // Warning lights. Steady for the thing that is wrong, and a flashing
    // master caution so it catches your eye even if you are looking outside.
    const f = ac.failures || {};
    /*
     * Low fuel is a fraction of the tank, not a number of litres.
     *
     * The FUEL lamp lit below a flat twelve litres, which is seven and a half
     * per cent of the trainer's 160 litre tank and a rounding error in the
     * fighter's 5,200. So on every aeroplane but the Skylark the lamp sat dark
     * right up to the point where the tanks ran dry and the ENGINE lamp took
     * over — no warning at all, in the aeroplanes that burn fuel fastest.
     * fuelFraction() reads against the capacity of the type actually being
     * flown, and 0.075 is the old twelve litres expressed as what it always
     * meant.
     */
    const lowFuel = ac.fuel > 0 && ac.fuelFraction() < 0.075;
    let anyLit = false;
    for (const l of lamps) {
      const on = !!f[l.key] || (l.key === 'fuelLeak' && lowFuel);
      if (on) anyLit = true;
      l.mat.emissiveIntensity = on ? 2.4 : 0;
    }
    master.material.emissiveIntensity = anyLit && Math.sin(t * 7) > -0.2 ? 3.0 : 0;
    panel.update(dt, ac, weather);
    const c = ac.controls;
    // Yoke: rotate for aileron, push/pull for elevator.
    yoke.rotation.z = lerp(yoke.rotation.z, -c.roll * 0.8, clamp(dt * 10, 0, 1));
    yoke.position.z = lerp(yoke.position.z, -0.52 - c.pitch * 0.07, clamp(dt * 10, 0, 1));
    // Levers rake forward as they are pushed in, exactly like the real thing.
    throttleLever.rotation.x = lerp(throttleLever.rotation.x, 0.5 - c.throttle * 0.9, clamp(dt * 8, 0, 1));
    // Propeller lever tracks rpm; mixture leans off as you climb, which is what
    // a pilot would actually be doing with it.
    propLever.rotation.x = lerp(propLever.rotation.x, 0.5 - clamp(ac.rpm, 0, 1) * 0.85, clamp(dt * 5, 0, 1));
    const lean = clamp((ac.pos.y - 300) / 2400, 0, 0.55);
    mixture.rotation.x = lerp(mixture.rotation.x, -0.4 + lean, clamp(dt * 2, 0, 1));
    // Flap lever steps down through the detents with the flaps themselves.
    flapLever.rotation.x = lerp(flapLever.rotation.x, -0.45 + ac.flaps * 1.1, clamp(dt * 6, 0, 1));
    // Trim wheel winds as the trim runs.
    trimWheel.rotation.y = (ac.trim || 0) * 6;
    for (const p of pedals) {
      p.mesh.position.z = -0.86 + c.yaw * p.side * 0.05;
    }
    // Rain streaks slide across the glass, faster when you fly faster.
    const rain = weather.cond.rain;
    dropMat.opacity = rain * 0.55;
    if (rain > 0.01) {
      dropMat.map.offset.y = (t * (0.05 + ac.airspeed * 0.004)) % 1;
      dropMat.map.offset.x = Math.sin(t * 0.4) * 0.02;
    }
  };
  group.userData.panel = panel;

  return group;
}
