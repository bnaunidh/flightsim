/**
 * The canvas instrument panel: the cockpit's live instruments as one texture.
 *
 * All the static artwork (bezels, tick marks, arcs, lettering) is painted once
 * into an offscreen layer, then every repaint blits that layer and draws only
 * the needles on top. That keeps a full six-instrument panel plus radio stack
 * at well under a millisecond a repaint.
 *
 * This is the panel the cockpit has always had, moved here unchanged from
 * cockpit.js when the cockpit was split into per-family builders. The generic
 * builder (generic.js) still uses it for every family that has no builder of
 * its own yet; the light aircraft use gauges.js instead, which turns meshes
 * over a painted face and so never repaints or re-uploads a texture at all.
 */

import * as THREE from '../../vendor/three.module.js';
import { clamp, lerp } from '../../core/noise.js';
import { TEXT, DIM, ring, glassOver, label, arc, needle } from './paint.js';

const CW = 1600;
const CH = 800;

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
