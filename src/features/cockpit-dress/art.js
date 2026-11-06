/**
 * The cockpit's printed surfaces: engraved plates, annunciators, overhead
 * panels, pedestal quadrants, the padded sidewall. Painted once into canvases
 * (features/cockpit-dress.js), in the game's own type, Titillium Web.
 *
 * Every name here is generic: what the system is, never whose it is.
 */

export const FONT = '"Titillium Web", Arial, sans-serif';

/** The maker's look: the plate, its lettering, what a lit legend is. */
export function styleOf(maker) {
  if (maker === 'airbus') return { plate: '#5a6876', hi: '#6c7a88', lo: '#465260', ink: '#eef2f5', dim: '#b8c3cd', btn: '#2b323a', lit: '#ffb13a', on: '#7fe7ff', square: true };
  if (maker === 'antonov') return { plate: '#4b8392', hi: '#5c97a6', lo: '#38656f', ink: '#f2f7f8', dim: '#c4dbe0', btn: '#28383d', lit: '#ffc14d', on: '#a4f0b0', square: false };
  if (maker === 'lockheed' || maker === 'rockwell') return { plate: '#4c5450', hi: '#5c645f', lo: '#39403c', ink: '#eceee8', dim: '#b8bdb4', btn: '#232825', lit: '#ffc14d', on: '#a4f0b0', square: false };
  return { plate: '#6a665f', hi: '#7a766e', lo: '#514d47', ink: '#f3efe6', dim: '#c8c3b6', btn: '#2c2a27', lit: '#ffb13a', on: '#7fd0ff', square: false };
}

export function txt(g, s, x, y, size, col, align = 'center', weight = 700) {
  g.font = `${weight} ${Math.max(5, size)}px ${FONT}`;
  g.fillStyle = col;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(s, x, y);
}

export function rr(g, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + k, y);
  g.arcTo(x + w, y, x + w, y + h, k);
  g.arcTo(x + w, y + h, x, y + h, k);
  g.arcTo(x, y + h, x, y, k);
  g.arcTo(x, y, x + w, y, k);
  g.closePath();
}

/** An instrument plate: a raised sheet with a lit top edge, a shadowed bottom edge and four screws. */
export function plate(g, x, y, w, h, S, unit = 1) {
  const r = 5 * unit;
  g.fillStyle = 'rgba(0,0,0,0.42)';
  rr(g, x - unit, y + 1.5 * unit, w + 2 * unit, h + 2 * unit, r);
  g.fill();
  const f = g.createLinearGradient(0, y, 0, y + h);
  f.addColorStop(0, S.hi);
  f.addColorStop(0.12, S.plate);
  f.addColorStop(1, S.lo);
  g.fillStyle = f;
  rr(g, x, y, w, h, r);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.14)';
  g.lineWidth = unit;
  g.beginPath();
  g.moveTo(x + r, y + unit * 0.5);
  g.lineTo(x + w - r, y + unit * 0.5);
  g.stroke();
  g.fillStyle = 'rgba(16,18,20,0.75)';
  const m = 4.5 * unit;
  for (const [sx, sy] of [[x + m, y + m], [x + w - m, y + m], [x + m, y + h - m], [x + w - m, y + h - m]]) {
    g.beginPath();
    g.arc(sx, sy, 1.5 * unit, 0, Math.PI * 2);
    g.fill();
  }
}

/** A push-button with its legend, dark until something lights it (Airbus square, Boeing bar). */
export function pushButton(g, x, y, w, h, top, bottom, S, topLit = false) {
  g.fillStyle = '#0e1114';
  rr(g, x - 1, y - 1, w + 2, h + 2, 2);
  g.fill();
  g.fillStyle = S.btn;
  rr(g, x, y, w, h, 2);
  g.fill();
  if (top) txt(g, top, x + w / 2, y + h * 0.3, h * 0.27, topLit ? S.lit : 'rgba(255,190,90,0.42)');
  if (bottom) txt(g, bottom, x + w / 2, y + h * 0.72, h * 0.27, 'rgba(235,240,245,0.85)');
}

export function toggle(g, x, y, r, S, up = true) {
  g.fillStyle = '#14171a';
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#c9ced4';
  rr(g, x - r * 0.3, up ? y - r * 1.5 : y, r * 0.6, r * 1.5, r * 0.25);
  g.fill();
  g.fillStyle = '#eef1f4';
  g.beginPath();
  g.arc(x, up ? y - r * 1.4 : y + r * 1.4, r * 0.38, 0, Math.PI * 2);
  g.fill();
  void S;
}

export function knob(g, x, y, r) {
  g.fillStyle = '#0b0d0f';
  g.beginPath();
  g.arc(x, y + r * 0.1, r * 1.1, 0, Math.PI * 2);
  g.fill();
  const f = g.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.1, x, y, r);
  f.addColorStop(0, '#4a4f55');
  f.addColorStop(1, '#16191c');
  g.fillStyle = f;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#e8ecef';
  g.lineWidth = Math.max(1, r * 0.14);
  g.beginPath();
  g.moveTo(x, y - r * 0.2);
  g.lineTo(x, y - r * 0.9);
  g.stroke();
}

const OVERHEAD = [
  ['ADIRS', ['IR 1', 'IR 3', 'IR 2', 'NAV', 'ATT']],
  ['FLT CTL', ['ELAC 1', 'SEC 1', 'FAC 1', 'YAW', 'BUS']],
  ['EVAC', ['COMMAND', 'HORN', 'CAPT', 'PURS']],
  ['EMER ELEC', ['GEN', 'RAT', 'BAT', 'TEST']],
  ['GPWS', ['SYS', 'G/S', 'FLAP', 'TERR']],
  ['OXYGEN', ['CREW', 'PAX', 'MASK', 'RESET']],
  ['FIRE', ['ENG 1', 'APU', 'ENG 2', 'AGENT', 'TEST']],
  ['HYD', ['GREEN', 'BLUE', 'YELLOW', 'PTU', 'ELEC']],
  ['FUEL', ['L TK', 'CTR', 'R TK', 'XFEED', 'MODE']],
  ['ELEC', ['BAT 1', 'BAT 2', 'GEN 1', 'APU', 'GEN 2']],
  ['AIR COND', ['PACK 1', 'PACK 2', 'BLEED', 'HOT AIR', 'RAM']],
  ['ANTI ICE', ['WING', 'ENG 1', 'ENG 2', 'PROBE']],
  ['EXT LT', ['STROBE', 'BEACON', 'WING', 'NAV', 'LAND']],
  ['SIGNS', ['SEAT', 'SMOKE', 'EXIT', 'DOME']],
  ['APU', ['MASTER', 'START', 'BLEED', 'GEN']],
  ['INT LT', ['ANN', 'DOME', 'INTEG', 'FLOOD']],
];

/** The overhead: rows of labelled systems, each band a section with its name, as the crew read it. */
export function paintOverhead(g, W, H, S, rows, seed = 0) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, S.plate);
  bg.addColorStop(1, S.lo);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const rowH = H / rows;
  const cols = 4;
  const cw = W / cols;
  const unit = W / 512;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [name, items] = OVERHEAD[(r * cols + c + seed) % OVERHEAD.length];
      const x = c * cw;
      const y = r * rowH;
      g.strokeStyle = 'rgba(245,248,250,0.5)';
      g.lineWidth = 1.2 * unit;
      g.strokeRect(x + 4 * unit, y + 9 * unit, cw - 8 * unit, rowH - 13 * unit);
      const tw = (name.length * 7 + 14) * unit;
      g.fillStyle = S.plate;
      g.fillRect(x + cw / 2 - tw / 2, y + 3 * unit, tw, 12 * unit);
      txt(g, name, x + cw / 2, y + 9 * unit, 10 * unit, S.ink);
      const n = items.length;
      const bw = Math.min(26 * unit, (cw - 14 * unit) / n - 3 * unit);
      const bh = Math.max(12 * unit, Math.min(bw * 0.86, rowH - 42 * unit));
      // As many lines of them as fill the section.
      const lines = Math.max(1, Math.floor((rowH - 24 * unit) / (bh + 19 * unit)));
      for (let l = 0; l < lines; l++) {
        const y0 = y + 20 * unit + l * ((rowH - 24 * unit) / lines);
        items.forEach((_, i) => {
          const it = items[(i + l) % n];
          const bx = x + 7 * unit + i * ((cw - 14 * unit) / n) + ((cw - 14 * unit) / n - bw) / 2;
          if (S.square) pushButton(g, bx, y0, bw, bh, 'FAULT', 'OFF', S, false);
          else toggle(g, bx + bw / 2, y0 + bh * 0.62, 4 * unit, S, (i + r + c + l) % 3 !== 0);
          txt(g, it, bx + bw / 2, y0 + bh + 7 * unit, 7.5 * unit, S.dim);
        });
      }
    }
  }
}

/** The pedestal's top: the thrust quadrant's scale, flaps, speed brake, radios. `y` is 0 at the panel end, H at the seats. */
export function paintPedestal(g, W, H, S, { airbus, engines = 2, turboprop = false }) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  const u = W / 256;
  g.fillStyle = S.lo;
  g.fillRect(0, 0, W, H);
  // Two radios and the transponder, the end nearest the panel.
  for (let i = 0; i < 2; i++) {
    const y = (8 + i * 62) * u;
    plate(g, 8 * u, y, 112 * u, 56 * u, S, u);
    g.fillStyle = '#06090b';
    g.fillRect(14 * u, y + 10 * u, 100 * u, 18 * u);
    txt(g, i ? 'ATC 1200' : '118.30', 34 * u, y + 19 * u, 12 * u, S.lit, 'center', 700);
    txt(g, i ? 'XPDR' : '121.90', 92 * u, y + 19 * u, 12 * u, S.on, 'center', 700);
    knob(g, 26 * u, y + 42 * u, 7 * u);
    knob(g, 96 * u, y + 42 * u, 7 * u);
    txt(g, i ? 'MODE' : 'VHF', 60 * u, y + 42 * u, 8 * u, S.dim);
    plate(g, 136 * u, y, 112 * u, 56 * u, S, u);
    for (let k = 0; k < 4; k++) pushButton(g, (142 + k * 26) * u, y + 8 * u, 22 * u, 18 * u, '', ['VHF', 'HF', 'INT', 'CAB'][k], S);
    txt(g, i ? 'WX RADAR' : 'AUDIO', 192 * u, y + 40 * u, 9 * u, S.dim);
  }
  // The thrust quadrant: its slot and scale.
  const y0 = 142 * u;
  const y1 = H - 80 * u;
  plate(g, 52 * u, y0, 152 * u, y1 - y0, S, u);
  g.fillStyle = '#0a0c0e';
  const n = engines;
  const pitch = Math.min(26 * u, (120 * u) / Math.max(1, n));
  for (let i = 0; i < n; i++) rr(g, W / 2 - (pitch / 2) * (n - 1) + i * pitch - 3 * u, y0 + 8 * u, 6 * u, y1 - y0 - 16 * u, 3 * u), g.fill();
  const stops = turboprop ? ['MAX', 'RATED', 'FI', 'DISC', 'REV'] : airbus ? ['TO', 'FLX', 'CL', 'IDLE', 'REV'] : ['FWD', '', 'CLB', 'IDLE', 'REV'];
  stops.forEach((t, i) => {
    const y = y0 + 14 * u + (i * (y1 - y0 - 28 * u)) / (stops.length - 1);
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = 1.5 * u;
    for (const [a, b] of [[56, 70], [186, 200]]) {
      g.beginPath();
      g.moveTo(a * u, y);
      g.lineTo(b * u, y);
      g.stroke();
    }
    if (t) txt(g, t, 30 * u, y, 10 * u, S.ink);
  });
  // Flaps on the right, speed brake on the left: their gates.
  const gate = (x, title, list) => {
    txt(g, title, x, y1 + 12 * u, 8.5 * u, S.dim);
    list.forEach((t, i) => txt(g, t, x, y0 + 14 * u + i * ((y1 - y0 - 30 * u) / Math.max(1, list.length - 1)), 9 * u, S.ink));
  };
  gate(226 * u, 'FLAPS', airbus ? ['0', '1', '2', '3', 'FULL'] : ['UP', '5', '15', '25', '40']);
  // Engine switches and the parking brake, the end nearest the seats.
  const yE = H - 62 * u;
  plate(g, 8 * u, yE, 240 * u, 54 * u, S, u);
  for (let i = 0; i < Math.min(n, 4); i++) {
    knob(g, (40 + i * 34) * u, yE + 24 * u, 9 * u);
    txt(g, `ENG ${i + 1}`, (40 + i * 34) * u, yE + 44 * u, 8 * u, S.dim);
  }
  knob(g, 208 * u, yE + 24 * u, 12 * u);
  txt(g, 'PARK BRK', 208 * u, yE + 44 * u, 8 * u, S.ink);
}

/** A padded sidewall: quilted panels, a seam, a map pocket and an oxygen stowage box. */
export function paintSidewall(g, W, H, base, dark) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  const cols = 6;
  for (let i = 0; i < cols; i++) {
    const x = (i * W) / cols;
    const f = g.createLinearGradient(x, 0, x + W / cols, 0);
    f.addColorStop(0, 'rgba(0,0,0,0.2)');
    f.addColorStop(0.15, 'rgba(255,255,255,0.05)');
    f.addColorStop(0.85, 'rgba(255,255,255,0.03)');
    f.addColorStop(1, 'rgba(0,0,0,0.26)');
    g.fillStyle = f;
    g.fillRect(x, 0, W / cols, H);
  }
  g.fillStyle = dark;
  g.fillRect(0, H * 0.62, W, H * 0.38);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(0, H * 0.6, W, H * 0.03);
  // The map pocket.
  g.fillStyle = 'rgba(0,0,0,0.42)';
  rr(g, W * 0.3, H * 0.68, W * 0.34, H * 0.24, H * 0.03);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.14)';
  g.fillRect(W * 0.3, H * 0.68, W * 0.34, H * 0.012);
  // The oxygen box.
  const bx = W * 0.72;
  g.fillStyle = 'rgba(14,16,18,0.92)';
  rr(g, bx, H * 0.66, W * 0.15, H * 0.26, H * 0.02);
  g.fill();
  txt(g, 'OXY', bx + W * 0.075, H * 0.74, H * 0.075, '#e8ecef');
  g.fillStyle = '#3ec96a';
  g.fillRect(bx + W * 0.05, H * 0.82, W * 0.05, H * 0.02);
}

/** A light aeroplane's door: a moulded card, an armrest's shadow, a pocket, a placard. */
export function paintDoorCard(g, W, H, base, dark) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  const f = g.createLinearGradient(0, 0, 0, H);
  f.addColorStop(0, 'rgba(255,255,255,0.08)');
  f.addColorStop(0.5, 'rgba(0,0,0,0)');
  f.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = f;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(0,0,0,0.3)';
  g.lineWidth = H * 0.012;
  rr(g, W * 0.05, H * 0.08, W * 0.9, H * 0.84, H * 0.06);
  g.stroke();
  g.fillStyle = dark;
  rr(g, W * 0.15, H * 0.42, W * 0.62, H * 0.11, H * 0.05);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.35)';
  rr(g, W * 0.18, H * 0.62, W * 0.55, H * 0.2, H * 0.03);
  g.fill();
  g.fillStyle = '#d8d4c8';
  g.fillRect(W * 0.8, H * 0.18, W * 0.1, H * 0.1);
  txt(g, 'DOOR', W * 0.85, H * 0.21, H * 0.03, '#26282b');
  txt(g, 'LOCK', W * 0.85, H * 0.25, H * 0.03, '#26282b');
}
