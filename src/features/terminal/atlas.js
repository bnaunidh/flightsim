/**
 * The terminal's paintwork: one sheet with every shop front, shelf wall, sign,
 * airline panel and poster on it, and the floor and ceiling tiles. All drawn in
 * code. Every shop is invented: no real name, logo or typeface, nothing that
 * stands for one (the owner asked for "shops like" the real ones: coffee,
 * burgers, tech, duty free). Airlines are the game's own parody schemes.
 *
 * The sheet goes up a cell at a time (`cells()` yields), so it can share frames
 * with a flight's worth of nothing else happening.
 */
import { canvas, canvasTexture } from '../../world/airport-kit.js';
import { AIRLINE_LIVERIES } from '../../aircraft/liveries.js';

/** The shops: name, colours, and the little device beside the name. Invented, all of them. */
export const BRANDS = Object.freeze({
  coffee: { name: 'Starling Coffee', bg: '#1f4d45', fg: '#f4efe2', mark: 'bird', floor: 0xb49a7c, wall: 0x7c5a3e },
  burger: { name: "McGull's Burgers", bg: '#b3262a', fg: '#ffd23f', mark: 'gull', floor: 0xc9c4b8, wall: 0xc8342f },
  tech: { name: 'Pear', bg: '#f2f3f5', fg: '#23262b', mark: 'pear', floor: 0xe6e7e8, wall: 0xf4f5f6 },
  duty: { name: 'Tax Holiday Duty Free', bg: '#18324f', fg: '#e7c977', mark: 'palm', floor: 0x8f97a1, wall: 0x22394f },
  news: { name: 'Paper Plane News', bg: '#f5efe2', fg: '#2b3a55', mark: 'plane', floor: 0xcfc6b4, wall: 0xe9e1cf },
  pizza: { name: 'Holding Pattern Pizza', bg: '#2d6a3f', fg: '#ffffff', mark: 'pizza', floor: 0xb9a68e, wall: 0x8a3b24 },
  style: { name: 'Carry-On Couture', bg: '#2a2a30', fg: '#e9e3d8', mark: 'hanger', floor: 0xd9d4cc, wall: 0xeae6df },
});
export const LOUNGE = Object.freeze({ name: 'Top Flight Lounge', bg: '#2a2622', fg: '#d9b774', mark: 'plane' });

const SANS = 'bold 1px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const font = (px) => SANS.replace('1px', `${px}px`);

function device(g, kind, x, y, s, col) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.fillStyle = col;
  g.strokeStyle = col;
  g.lineWidth = 0.08;
  g.lineCap = 'round';
  const blob = (...p) => {
    g.beginPath();
    p.forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b)));
    g.closePath();
    g.fill();
  };
  if (kind === 'pear') {
    g.beginPath();
    g.arc(0, 0.18, 0.34, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(0, -0.14, 0.2, 0, Math.PI * 2);
    g.fill();
    g.fillRect(-0.02, -0.46, 0.05, 0.16);
    blob([0.03, -0.38], [0.2, -0.46], [0.13, -0.32]);
  } else if (kind === 'bird' || kind === 'gull') {
    g.beginPath();
    g.moveTo(-0.46, -0.02);
    g.quadraticCurveTo(-0.22, -0.36, 0, 0.02);
    g.quadraticCurveTo(0.22, -0.36, 0.46, -0.02);
    g.quadraticCurveTo(0.22, -0.14, 0, 0.22);
    g.quadraticCurveTo(-0.22, -0.14, -0.46, -0.02);
    g.fill();
  } else if (kind === 'palm') {
    g.fillRect(-0.03, -0.1, 0.07, 0.56);
    for (const a of [-2.6, -1.9, -1.2, -0.5, 0.2]) {
      g.beginPath();
      g.moveTo(0, -0.1);
      g.quadraticCurveTo(Math.cos(a) * 0.3, Math.sin(a) * 0.3 - 0.1, Math.cos(a) * 0.46, Math.sin(a) * 0.3 + 0.08);
      g.stroke();
    }
  } else if (kind === 'plane') {
    blob([-0.46, 0.06], [0.46, -0.34], [-0.1, 0.16], [-0.12, 0.36], [-0.22, 0.14]);
  } else if (kind === 'pizza') {
    g.beginPath();
    g.arc(0, 0, 0.42, 0, Math.PI * 2);
    g.stroke();
    for (let a = 0; a < 3; a++) {
      g.beginPath();
      g.moveTo(Math.cos(a) * 0.42, Math.sin(a) * 0.42);
      g.lineTo(-Math.cos(a) * 0.42, -Math.sin(a) * 0.42);
      g.stroke();
    }
  } else {
    g.beginPath();
    g.moveTo(-0.44, 0.26);
    g.lineTo(0, -0.04);
    g.lineTo(0.44, 0.26);
    g.closePath();
    g.stroke();
    g.beginPath();
    g.arc(0, -0.2, 0.12, Math.PI, Math.PI * 2.4);
    g.stroke();
  }
  g.restore();
}

function fascia(g, w, h, b) {
  g.fillStyle = b.bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.06)';
  g.fillRect(0, 0, w, h * 0.18);
  const px = Math.round(h * (b.name.length > 18 ? 0.42 : 0.52));
  g.font = font(px);
  const tw = g.measureText(b.name).width;
  const total = tw + h * 1.05;
  const x0 = (w - total) / 2;
  device(g, b.mark, x0 + h * 0.42, h * 0.5, h * 0.82, b.fg);
  g.fillStyle = b.fg;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(b.name, x0 + h * 1.05, h * 0.54);
}

const hash = (a, b) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** The wall behind a shop's counter or its shelves. */
function shelves(g, w, h, kind, b) {
  const H = h;
  if (kind === 'tech') {
    g.fillStyle = '#f4f5f6';
    g.fillRect(0, 0, w, H);
    const gr = g.createLinearGradient(0, 0, w, H);
    gr.addColorStop(0, '#2d6bb5');
    gr.addColorStop(1, '#7a4fb0');
    g.fillStyle = '#16181c';
    g.fillRect(w * 0.3, H * 0.12, w * 0.4, H * 0.62);
    g.fillStyle = gr;
    g.fillRect(w * 0.31, H * 0.15, w * 0.38, H * 0.56);
    device(g, 'pear', w * 0.5, H * 0.42, H * 0.34, 'rgba(255,255,255,0.9)');
    for (let i = 0; i < 6; i++) {
      const x = w * (i < 3 ? 0.04 + i * 0.08 : 0.74 + (i - 3) * 0.08);
      g.fillStyle = '#d7dadd';
      g.fillRect(x, H * 0.3, w * 0.05, H * 0.34);
      g.fillStyle = '#23262b';
      g.fillRect(x + 3, H * 0.32, w * 0.05 - 6, H * 0.3);
    }
    return;
  }
  if (kind === 'coffee' || kind === 'burger' || kind === 'pizza') {
    g.fillStyle = kind === 'coffee' ? '#3b2a20' : kind === 'burger' ? '#7d1a1c' : '#5a2a1a';
    g.fillRect(0, 0, w, H);
    const n = 5;
    const pw = w / n;
    for (let i = 0; i < n; i++) {
      const x = i * pw + 8;
      g.fillStyle = '#14161a';
      g.fillRect(x, H * 0.08, pw - 16, H * 0.52);
      for (let r = 0; r < 5; r++) {
        g.fillStyle = r === 0 ? b.fg : 'rgba(240,235,220,0.75)';
        g.fillRect(x + 8, H * 0.13 + r * H * 0.09, (pw - 34) * (0.55 + hash(i, r) * 0.45), r === 0 ? 6 : 4);
      }
      if (kind !== 'coffee') {
        g.fillStyle = ['#d9a02e', '#c8453b', '#e8c27a'][i % 3];
        g.beginPath();
        g.ellipse(x + (pw - 16) * 0.78, H * 0.5, 14, 8, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    // Back counter: machines, cups, a warming shelf.
    g.fillStyle = '#b8bcc0';
    g.fillRect(0, H * 0.72, w, 5);
    for (let i = 0; i < 26; i++) {
      g.fillStyle = hash(i, 3) > 0.5 ? '#e9e6df' : '#cfd3d6';
      g.fillRect(8 + i * (w / 26), H * 0.72 - 12, 10, 12);
    }
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(0, H * 0.76, w, H * 0.24);
    return;
  }
  // Rows of things: bottles, magazines, clothes.
  g.fillStyle = kind === 'duty' ? '#1b2c40' : kind === 'news' ? '#d8cfbc' : '#ece7df';
  g.fillRect(0, 0, w, H);
  const rows = kind === 'style' ? 2 : 4;
  const rowH = H / rows;
  for (let r = 0; r < rows; r++) {
    const y = r * rowH;
    g.fillStyle = kind === 'duty' ? '#c7a65e' : '#8d7d66';
    g.fillRect(0, y + rowH - 4, w, 4);
    const each = kind === 'duty' ? 12 : kind === 'news' ? 16 : 24;
    for (let x = 4, i = 0; x < w - each; x += each + 3, i++) {
      const c = ['#c8453b', '#2f6fbd', '#e7c977', '#3a8f63', '#e4e4e0', '#7a4fb0', '#d96f93', '#a8552c'][Math.floor(hash(i, r) * 8)];
      g.fillStyle = c;
      if (kind === 'duty') {
        const t = rowH * (0.45 + hash(i, r + 4) * 0.3);
        g.fillRect(x, y + rowH - 4 - t, each, t);
        g.fillStyle = 'rgba(255,255,255,0.28)';
        g.fillRect(x + 2, y + rowH - 4 - t + 4, 3, t - 8);
      } else if (kind === 'news') {
        g.fillRect(x, y + 6, each, rowH - 12);
        g.fillStyle = 'rgba(255,255,255,0.6)';
        g.fillRect(x + 2, y + 9, each - 4, 3);
      } else {
        g.fillRect(x, y + 12, each, rowH - 26);
        g.fillStyle = '#6f6f76';
        g.fillRect(x + each / 2, y + 6, 2, 8);
      }
    }
  }
}

function sign(g, w, h, text, arrow) {
  g.fillStyle = '#16181b';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffd23f';
  g.font = font(Math.round(h * 0.46));
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2 + (arrow ? h * 0.42 : 0), h * 0.54, w - (arrow ? h * 1.1 : 16));
  if (arrow) {
    // Up the sheet: a way on. The sign's own turn says which way.
    g.save();
    g.translate(h * 0.5, h * 0.5);
    g.lineWidth = h * 0.09;
    g.strokeStyle = '#ffd23f';
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(0, h * 0.28);
    g.lineTo(0, -h * 0.28);
    g.moveTo(-h * 0.2, -h * 0.06);
    g.lineTo(0, -h * 0.28);
    g.lineTo(h * 0.2, -h * 0.06);
    g.stroke();
    g.restore();
  }
}

const POSTERS = [
  { t: 'Long weekends start here', c0: '#0f6d8c', c1: '#f2c56b' },
  { t: 'Fly the island chain', c0: '#16324f', c1: '#e8784a' },
  { t: 'Sea, sky, repeat', c0: '#1b7f7a', c1: '#bfe6dc' },
  { t: 'Home by dinner', c0: '#4a2f6b', c1: '#f39c6b' },
];

function poster(g, w, h, p, i) {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, p.c0);
  gr.addColorStop(0.72, p.c1);
  gr.addColorStop(0.72, '#123');
  gr.addColorStop(1, '#0d1a26');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,245,215,0.9)';
  g.beginPath();
  g.arc(w * (0.22 + i * 0.18), h * 0.34, h * 0.13, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = font(Math.round(h * 0.13));
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(p.t, w / 2, h * 0.86);
}

function airlinePanel(g, w, h, l) {
  g.fillStyle = l.accent || '#26415f';
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.14)';
  g.fillRect(0, h * 0.78, w, h * 0.22);
  g.fillStyle = '#ffffff';
  g.font = font(Math.round(h * 0.4));
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(l.titling || l.name, w / 2, h * 0.44, w - 16);
}

/** The passenger airlines, parody all of them, from the game's own list. */
export function passengerAirlines() {
  return AIRLINE_LIVERIES.filter((l) => !/freight|express|flexship|dash/i.test(l.name));
}

export class Atlas {
  /** `small`: Low's half-size sheet. */
  constructor(small = false) {
    this.k = small ? 0.5 : 1;
    this.W = 2048 * this.k;
    this.H = 1024 * this.k;
    this.c = canvas(this.W, this.H);
    this.g = this.c.getContext('2d');
    this.g.fillStyle = '#ffffff';
    this.g.fillRect(0, 0, this.W, this.H);
    this.rects = Object.create(null);
    this.x = 12;
    this.y = 12;
    this.row = 0;
  }

  /** A plain white texel, for everything that is only a colour. */
  get white() {
    return [2 / this.W, 1 - 2 / this.H];
  }

  cell(name, w0, h0, draw) {
    const k = this.k;
    const w = Math.round(w0 * k);
    const h = Math.round(h0 * k);
    if (this.x + w + 8 > this.W) {
      this.x = 12;
      this.y += this.row + 8;
      this.row = 0;
    }
    const g = this.g;
    g.save();
    g.beginPath();
    g.rect(this.x, this.y, w, h);
    g.clip();
    g.translate(this.x, this.y);
    g.scale(k, k);
    draw(g, w0, h0);
    g.restore();
    this.rects[name] = [(this.x + 1) / this.W, 1 - (this.y + h - 1) / this.H, (this.x + w - 1) / this.W, 1 - (this.y + 1) / this.H];
    this.x += w + 8;
    this.row = Math.max(this.row, h);
    return this.rects[name];
  }

  rect(name) {
    return this.rects[name] || this.rects.blank;
  }

  /** Everything the building shows. A generator: one cell a step. */
  *cells(P) {
    this.cell('blank', 16, 16, (g) => {
      g.fillStyle = '#16181b';
      g.fillRect(0, 0, 16, 16);
    });
    for (const k of Object.keys(BRANDS)) {
      this.cell(`back:${k}`, 512, 128, (g, w, h) => shelves(g, w, h, k, BRANDS[k]));
      yield;
    }
    POSTERS.forEach((p, i) => this.cell(`ad:${i}`, 256, 128, (g, w, h) => poster(g, w, h, p, i)));
    yield;
    for (const k of Object.keys(BRANDS)) {
      this.cell(`fascia:${k}`, 640, 80, (g, w, h) => fascia(g, w, h, BRANDS[k]));
      yield;
    }
    this.cell('fascia:lounge', 640, 80, (g, w, h) => fascia(g, w, h, LOUNGE));
    for (const l of passengerAirlines()) {
      this.cell(`airline:${l.id}`, 256, 64, (g, w, h) => airlinePanel(g, w, h, l));
      yield;
    }
    for (const [n, text, arrow] of [
      ['departures', 'Departures', 1], ['security', 'Security and gates', 1], ['checkin', 'Check-in', 0],
      ['arrivals', 'Arrivals and exit', 1], ['gates', 'To the gates', 1], ['apron', 'Apron', 1], ['upgates', 'Gates', 1],
      ['exit', 'Way out', 1],
    ]) {
      this.cell(`sign:${n}`, 256, 64, (g, w, h) => sign(g, w, h, text, !!arrow));
    }
    yield;
    for (const g0 of P.gates) {
      this.cell(`gate:${g0.number}`, 128, 64, (g, w, h) => {
        g.fillStyle = '#ffd23f';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#16181b';
        g.font = font(34);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(`Gate ${g0.number}`, w / 2, h * 0.54);
      });
    }
  }

  texture() {
    const t = canvasTexture(this.c);
    t.anisotropy = 4;
    return t;
  }
}

/** The floor: pale stone, 1.2 m squares, 4.8 m a repeat. */
export function floorTexture() {
  const c = canvas(512, 512);
  const g = c.getContext('2d');
  const n = 4;
  const s = 512 / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = 226 + Math.round(hash(i, j) * 12);
      g.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
      g.fillRect(i * s, j * s, s, s);
    }
  }
  for (let i = 0; i < 2400; i++) {
    const t = hash(i, 9);
    g.fillStyle = t > 0.5 ? 'rgba(255,255,255,0.1)' : 'rgba(90,85,78,0.07)';
    g.fillRect(hash(i, 1) * 512, hash(i, 2) * 512, 1 + hash(i, 3) * 3, 1 + hash(i, 4) * 3);
  }
  g.strokeStyle = 'rgba(120,114,104,0.5)';
  g.lineWidth = 2;
  for (let i = 0; i <= n; i++) {
    g.beginPath();
    g.moveTo(i * s, 0);
    g.lineTo(i * s, 512);
    g.moveTo(0, i * s);
    g.lineTo(512, i * s);
    g.stroke();
  }
  const t = canvasTexture(c, { repeat: true });
  t.anisotropy = 4;
  return t;
}

/** The ceiling: white baffles with a run of light down each, 6 m a repeat. */
export function ceilingTexture() {
  const c = canvas(256, 256);
  const g = c.getContext('2d');
  g.fillStyle = '#d3d7da';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(90,96,104,0.45)';
  for (let i = 0; i < 12; i++) g.fillRect(i * 21.33, 0, 2, 256);
  // The strip of light runs along the building.
  g.fillStyle = '#fffdf4';
  g.fillRect(0, 104, 256, 48);
  g.fillStyle = 'rgba(255,250,235,0.5)';
  g.fillRect(0, 92, 256, 72);
  const t = canvasTexture(c, { repeat: true });
  t.anisotropy = 4;
  return t;
}

/** A blank departures screen; drawBoard writes on it. */
export function boardCanvas() {
  return canvas(1024, 512);
}

/** The departures board: `rows` are { time, flight, to, gate, status }. */
export function drawBoard(c, title, rows) {
  const g = c.getContext('2d');
  const W = c.width;
  const H = c.height;
  g.fillStyle = '#0b0e13';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#ffd23f';
  g.fillRect(0, 0, W, 58);
  g.fillStyle = '#16181b';
  g.font = font(36);
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(title, 22, 31);
  const cols = [[22, 'Time'], [122, 'Flight'], [454, 'To'], [760, 'Gate'], [846, 'Status']];
  g.font = font(21);
  g.fillStyle = '#9aa5b1';
  for (const [x, t] of cols) g.fillText(t, x, 80);
  g.font = font(26);
  const rowH = 41;
  rows.slice(0, 10).forEach((r, i) => {
    const y = 118 + i * rowH;
    if (i % 2) {
      g.fillStyle = '#141923';
      g.fillRect(0, y - rowH / 2, W, rowH);
    }
    g.fillStyle = '#f2f4f6';
    g.fillText(r.time, cols[0][0], y, 92);
    g.fillText(r.flight, cols[1][0], y, 318);
    g.fillText(r.to, cols[2][0], y, 292);
    g.fillText(String(r.gate), cols[3][0], y, 74);
    g.fillStyle = /board|final/i.test(r.status) ? '#7fe08f' : /delay/i.test(r.status) ? '#ff9a6b' : /depart|airborne/i.test(r.status) ? '#8fc7ff' : '#ffd23f';
    g.fillText(r.status, cols[4][0], y, 164);
  });
  if (!rows.length) {
    g.fillStyle = '#9aa5b1';
    g.fillText('No departures just now', 22, 130);
  }
}
