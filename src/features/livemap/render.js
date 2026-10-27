/**
 * The live map's vector layers, over the base chart (chart.js): the
 * graticule, airspace rings, roads and towns, airports as runway symbols at
 * their true heading and length, heliports, fixes, the carrier, the flight
 * plan in magenta, the pin, traffic, you — and every label placed so that no
 * two collide, most important first.
 *
 * LEVEL OF DETAIL, by metres a CSS pixel (mpp), like a real moving map:
 *
 *   > 300   regions, the big islands, international fields as chart symbols
 *   < 300   every field, island names, towns as built-up tint, highways
 *   < 60    fixes, heliports, roads, airspace frequencies, town names
 *   < 12    runway numbers, field elevations
 *   < 5     taxiways, aprons and the terminal (where the field has a layout)
 *
 * The World Map preview's 400 km sea starts zoomed out; a normal map's ~25 km
 * starts at its whole island, which is already the "< 60" band.
 */

import { toLatLon, fromLatLon } from './geo.js';

const DEG = Math.PI / 180;
export const MAGENTA = '#e83ee6';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const measured = new Map();
function textW(g, font, text) {
  const k = `${font}|${text}`;
  let w = measured.get(k);
  if (w === undefined) {
    g.font = font;
    w = g.measureText(text).width;
    if (measured.size > 4000) measured.clear();
    measured.set(k, w);
  }
  return w;
}

/**
 * Labels without collisions. Each candidate has an anchor and a priority;
 * the most important are placed first, each tries a few positions round its
 * anchor (right, left, above, below), and one that fits nowhere is not drawn.
 * Symbols (runways, your arrow) are registered as obstacles first.
 */
export class LabelPlacer {
  constructor() {
    this.boxes = [];
    this.items = [];
  }

  reset() {
    this.boxes.length = 0;
    this.items.length = 0;
  }

  block(x0, y0, x1, y1) {
    this.boxes.push(x0, y0, x1, y1);
  }

  hits(x0, y0, x1, y1) {
    const b = this.boxes;
    for (let i = 0; i < b.length; i += 4) if (x0 < b[i + 2] && x1 > b[i] && y0 < b[i + 3] && y1 > b[i + 1]) return true;
    return false;
  }

  /** text, x, y anchor; prio higher first; style { font, fill, halo, italic, sub, subFont, gap } */
  add(text, x, y, prio, style) {
    if (!text) return;
    this.items.push({ text, x, y, prio, style });
  }

  /** Where a label of w × h may go round its anchor, best first: beside, above and below, the corners, further out. */
  static spots(w, h, lh, gap) {
    const g2 = gap * 2.4;
    return [
      [gap, -lh * 0.62], [-gap - w, -lh * 0.62], [-w / 2, -gap - h], [-w / 2, gap],
      [gap * 0.7, -h - gap * 0.4], [gap * 0.7, gap * 0.4], [-gap * 0.7 - w, -h - gap * 0.4], [-gap * 0.7 - w, gap * 0.4],
      [g2, -lh * 0.62], [-g2 - w, -lh * 0.62], [-w / 2, -g2 - h], [-w / 2, g2],
    ];
  }

  fits(x0, y0, x1, y1, W, H) {
    return !(x0 < 2 || y0 < 2 || x1 > W - 2 || y1 > H - 2) && !this.hits(x0, y0, x1, y1);
  }

  /** Place and draw. W, H the view (labels stay inside it). Returns how many were drawn. */
  draw(g, W, H) {
    const items = this.items.sort((a, b) => b.prio - a.prio);
    let drawn = 0;
    for (const it of items) {
      const s = it.style;
      // A two-line label that fits nowhere tries again as its first line alone (the code without the name).
      for (const sub of s.sub ? [s.sub, null] : [null]) {
        const w1 = textW(g, s.font, it.text);
        const w2 = sub ? textW(g, s.subFont, sub) : 0;
        const lh = s.size || 12;
        const sh = sub ? (s.subSize || 10) + 2 : 0;
        const w = Math.max(w1, w2);
        const h = lh + sh;
        const gap = s.gap ?? 7;
        const tries = s.center ? [[-w / 2, -h / 2], [-w / 2, -h / 2 - h - 2], [-w / 2, h / 2 + 2]] : LabelPlacer.spots(w, h, lh, gap);
        let placed = null;
        for (const [dx, dy] of tries) {
          const x0 = it.x + dx - 2;
          const y0 = it.y + dy - 1;
          if (!this.fits(x0, y0, x0 + w + 4, y0 + h + 2, W, H)) continue;
          placed = { x: it.x + dx, y: it.y + dy };
          this.block(x0, y0, x0 + w + 4, y0 + h + 2);
          break;
        }
        if (!placed) continue;
        drawn++;
        const cx = s.center ? 0.5 : 0;
        g.textAlign = 'left';
        g.textBaseline = 'top';
        g.lineJoin = 'round';
        g.font = s.font;
        if (s.halo) {
          g.strokeStyle = s.halo;
          g.lineWidth = s.haloW || 3;
          g.strokeText(it.text, placed.x + (w - w1) * cx, placed.y);
        }
        g.fillStyle = s.fill;
        g.fillText(it.text, placed.x + (w - w1) * cx, placed.y);
        if (sub) {
          g.font = s.subFont;
          if (s.halo) {
            g.lineWidth = (s.haloW || 3) * 0.85;
            g.strokeText(sub, placed.x + (w - w2) * cx, placed.y + lh + 1);
          }
          g.fillStyle = s.subFill || s.fill;
          g.fillText(sub, placed.x + (w - w2) * cx, placed.y + lh + 1);
        }
        it.placed = placed;
        break;
      }
    }
    return drawn;
  }
}

const HALO = 'rgba(8, 16, 24, 0.82)';
const ST = {
  region: { font: `600 13px ${FONT}`, size: 13, fill: 'rgba(235, 244, 250, 0.62)', halo: 'rgba(8,16,24,0.5)', center: true },
  island: { font: `italic 500 11.5px ${FONT}`, size: 11.5, fill: 'rgba(244, 248, 236, 0.88)', halo: HALO, center: true },
  hill: { font: `italic 500 10px ${FONT}`, size: 10, fill: 'rgba(236, 240, 226, 0.7)', halo: 'rgba(8,16,24,0.6)', center: true },
  town: { font: `600 11px ${FONT}`, size: 11, fill: '#f4ecdc', halo: HALO, gap: 6 },
  code: { font: `700 12.5px ${FONT}`, size: 12.5, fill: '#ffffff', halo: HALO, subFont: `500 10.5px ${FONT}`, subSize: 10.5, subFill: 'rgba(230, 238, 246, 0.86)' },
  fix: { font: `600 10px ${MONO}`, size: 10, fill: 'rgba(214, 228, 255, 0.92)', halo: HALO, gap: 6 },
  heli: { font: `500 10px ${FONT}`, size: 10, fill: 'rgba(255, 236, 236, 0.9)', halo: HALO, gap: 8 },
  wp: { font: `700 11px ${MONO}`, size: 11, fill: '#ffd6fb', halo: HALO, gap: 8 },
  zone: { font: `600 9.5px ${MONO}`, size: 9.5, fill: 'rgba(150, 196, 255, 0.9)', halo: HALO, center: true },
  rwy: { font: `700 9px ${MONO}`, size: 9, fill: '#ffffff', halo: HALO, center: true, haloW: 2.5 },
};

/** Grid spacings (arc minutes) the graticule may use, finest first. */
const GRAT_MIN = [1, 2, 5, 10, 15, 30, 60, 120, 300];

/**
 * Draw everything over the chart.
 * @param g      2D context in CSS pixels
 * @param v      { cx, cz, s, W, H }
 * @param P      places.js collectPlaces()
 * @param st     { me: {x, z, hdg, gsMs, alt}, plan, pin, sel, carrier, traffic, zones, lowTier, time }
 * @returns stats { labels, airports, fixes }
 */
export function drawLayers(g, v, P, st, placer = new LabelPlacer()) {
  const s = v.s;
  const mpp = 1 / s;
  const W = v.W;
  const H = v.H;
  const X = (x) => W / 2 + (x - v.cx) * s;
  const Z = (z) => H / 2 + (z - v.cz) * s;
  const on = (x, z, m = 40) => {
    const px = X(x);
    const pz = Z(z);
    return px > -m && px < W + m && pz > -m && pz < H + m;
  };
  placer.reset();
  // The panel's own controls over the chart: no label under them.
  const res = st.reserved || [];
  for (const b of res) placer.block(b[0], b[1], b[2], b[3]);
  const underUi = (x, y) => res.some((b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]);
  const stats = { labels: 0, airports: 0, fixes: 0, towns: 0, heli: 0, rings: 0, lod: mpp };

  /* ---- the graticule: latitude and longitude, faint, labelled at the edges ---- */
  {
    const o = P.origin;
    const tl = toLatLon(v.cx - W / 2 * mpp, v.cz - H / 2 * mpp, o);
    const br = toLatLon(v.cx + W / 2 * mpp, v.cz + H / 2 * mpp, o);
    const spanMin = Math.abs(tl.lat - br.lat) * 60;
    let step = GRAT_MIN[GRAT_MIN.length - 1];
    for (const m of GRAT_MIN) {
      if (spanMin / m <= 7) {
        step = m;
        break;
      }
    }
    const d = step / 60;
    g.strokeStyle = 'rgba(255, 255, 255, 0.13)';
    g.lineWidth = 1;
    g.beginPath();
    const labels = [];
    for (let lat = Math.ceil(br.lat / d) * d; lat <= tl.lat; lat += d) {
      const p = fromLatLon(lat, o.lon, o);
      const y = Math.round(Z(p.z)) + 0.5;
      g.moveTo(0, y);
      g.lineTo(W, y);
      labels.push({ t: fmtGrat(lat, 'lat'), x: 64, y: y - 12 });
    }
    for (let lon = Math.ceil(tl.lon / d) * d; lon <= br.lon; lon += d) {
      const p = fromLatLon(o.lat, lon, o);
      const x = Math.round(X(p.x)) + 0.5;
      g.moveTo(x, 0);
      g.lineTo(x, H);
      labels.push({ t: fmtGrat(lon, 'lon'), x: x + 4, y: H - 16 });
    }
    g.stroke();
    g.font = `600 9.5px ${MONO}`;
    g.textBaseline = 'top';
    g.textAlign = 'left';
    g.fillStyle = 'rgba(230, 240, 248, 0.5)';
    for (const l of labels) {
      if (l.y < 54 || l.x > W - 60 || underUi(l.x + 20, l.y + 5)) continue;
      g.fillText(l.t, l.x, l.y);
    }
  }

  /* ---- airspace: each field's control zone, a faint dashed ring ---- */
  if (P.zones && P.zones.length) {
    g.strokeStyle = 'rgba(120, 172, 255, 0.42)';
    g.lineWidth = 1.2;
    g.setLineDash([6, 5]);
    g.beginPath();
    for (const z of P.zones) {
      const r = z.r * s;
      if (r < 6 || !on(z.x, z.z, r + 10)) continue;
      g.moveTo(X(z.x) + r, Z(z.z));
      g.arc(X(z.x), Z(z.z), r, 0, Math.PI * 2);
      stats.rings++;
      if (mpp < 80 && r > 40) placer.add(`${z.name} ${z.freq}`, X(z.x), Z(z.z) - r + 9, 20, ST.zone);
    }
    g.stroke();
    g.setLineDash([]);
    if (st.zone) {
      // The one you are in, a little brighter.
      const z = st.zone;
      g.strokeStyle = 'rgba(140, 190, 255, 0.7)';
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(X(z.x), Z(z.z), z.r * s, 0, Math.PI * 2);
      g.stroke();
    }
  }

  /* ---- towns: a built-up tint, then their names ---- */
  if (mpp < 300) {
    g.fillStyle = 'rgba(236, 222, 196, 0.26)';
    g.beginPath();
    for (const t of P.towns) {
      const r = Math.max(3, t.r * s);
      if (!on(t.x, t.z, r)) continue;
      g.moveTo(X(t.x) + r, Z(t.z));
      g.arc(X(t.x), Z(t.z), r, 0, Math.PI * 2);
      stats.towns++;
    }
    g.fill();
    if (mpp < 90) {
      for (const t of P.towns) if (on(t.x, t.z)) placer.add(t.name, X(t.x), Z(t.z), 40, ST.town);
    }
  }

  /* ---- roads: highways first and wider; minor roads only close in ---- */
  if (mpp < 120 && P.roads && P.roads.length) {
    const pass = (kind, w, colour) => {
      g.strokeStyle = colour;
      g.lineWidth = w;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      for (const r of P.roads) {
        if (r.kind !== kind || r.pts.length < 2) continue;
        g.moveTo(X(r.pts[0][0]), Z(r.pts[0][1]));
        for (let i = 1; i < r.pts.length; i++) g.lineTo(X(r.pts[i][0]), Z(r.pts[i][1]));
      }
      g.stroke();
    };
    pass('highway', 4.2, 'rgba(40, 30, 20, 0.55)');
    pass('highway', 2.6, '#f2b65a');
    if (mpp < 40) {
      pass('road', 2.8, 'rgba(30, 30, 30, 0.45)');
      pass('road', 1.5, 'rgba(250, 246, 236, 0.92)');
    }
  }

  /* ---- islands and regions: the place names, by hierarchy ---- */
  for (const r of P.regions || []) {
    if (mpp < 120 || !on(r.x, r.z)) continue;
    placer.add(r.name.toUpperCase(), X(r.x), Z(r.z), 30, ST.region);
  }
  for (const i of P.islands) {
    const rpx = i.r * s;
    if (rpx < 22 || !on(i.x, i.z, rpx)) continue;
    // A big island's name sits a little above its middle, out of its airport's way.
    placer.add(i.name, X(i.x), Z(i.z) - Math.min(rpx * 0.35, 40), 25 + Math.min(20, rpx / 20), ST.island);
  }
  // Hill ranges on an island, smaller and fainter, once zoomed in to them.
  for (const i of P.hills || []) {
    const rpx = i.r * s;
    if (rpx < 40 || mpp > 40 || !on(i.x, i.z, rpx)) continue;
    placer.add(i.name, X(i.x), Z(i.z), 12, ST.hill);
  }

  /* ---- airports: real runway symbols ---- */
  const minLenPx = [0, 12, 15, 18, 22];
  const minWPx = [0, 2.4, 3, 4, 5];
  for (const a of P.airports) {
    if (!on(a.x, a.z, 60)) continue;
    if (mpp > 300 && a.cls < 3) continue;
    stats.airports++;
    const ax = X(a.x);
    const az = Z(a.z);
    const longest = Math.max(...a.runways.map((r) => r.length));
    const symbolOnly = longest * s < 14;
    if (symbolOnly) {
      // Zoomed far out: the chart symbol — a ring with the runway through it.
      const towered = a.kind === 'hub' || a.kind === 'regional' || a.kind === 'remote';
      const col = towered ? '#7fb3ff' : '#e58ae8';
      const rr = 4 + a.cls;
      g.strokeStyle = col;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(ax, az, rr, 0, Math.PI * 2);
      g.stroke();
      const h = a.hdg * DEG;
      g.lineWidth = 2.6;
      g.strokeStyle = '#ffffff';
      g.beginPath();
      g.moveTo(ax - Math.sin(h) * (rr + 3), az + Math.cos(h) * (rr + 3));
      g.lineTo(ax + Math.sin(h) * (rr + 3), az - Math.cos(h) * (rr + 3));
      g.stroke();
      placer.block(ax - rr - 3, az - rr - 3, ax + rr + 3, az + rr + 3);
    } else {
      // Aprons, taxiways and the terminal, close in, where the field has them.
      if (mpp < 5 && a.layout && Array.isArray(a.layout.pavement)) {
        g.fillStyle = 'rgba(150, 156, 160, 0.9)';
        for (const p of a.layout.pavement) g.fillRect(X(p.x0), Z(p.z0), (p.x1 - p.x0) * s, (p.z1 - p.z0) * s);
        const t = a.layout.terminal && a.layout.terminal.rect;
        if (t) {
          g.fillStyle = 'rgba(70, 76, 86, 0.95)';
          g.fillRect(X(t.x0), Z(t.z0), (t.x1 - t.x0) * s, (t.z1 - t.z0) * s);
        }
      } else if (mpp < 5 && a.site) {
        const t = a.site;
        g.fillStyle = 'rgba(150, 156, 160, 0.55)';
        g.fillRect(X(t.x0), Z(t.z0), (t.x1 - t.x0) * s, (t.z1 - t.z0) * s);
      }
      for (const r of a.runways) {
        const h = r.hdg * DEG;
        const L = Math.max(r.length * s, minLenPx[a.cls]);
        const Wd = Math.max(r.width * s, minWPx[a.cls]);
        const cx = X(r.cx);
        const cz = Z(r.cz);
        g.save();
        g.translate(cx, cz);
        g.rotate(h);
        g.fillStyle = '#0d1b26';
        g.fillRect(-Wd / 2 - 1.5, -L / 2 - 1.5, Wd + 3, L + 3);
        g.fillStyle = a.surface === 'grass' ? '#bfe3a2' : a.surface === 'gravel' ? '#d9cfb6' : '#f6f7f8';
        g.fillRect(-Wd / 2, -L / 2, Wd, L);
        if (Wd > 7) {
          // The centreline, dashed, once the runway is wide enough to carry it.
          g.strokeStyle = '#0d1b26';
          g.lineWidth = 1;
          g.setLineDash([4, 4]);
          g.beginPath();
          g.moveTo(0, -L / 2 + 4);
          g.lineTo(0, L / 2 - 4);
          g.stroke();
          g.setLineDash([]);
        }
        g.restore();
        const ex = Math.abs(Math.sin(h)) * L / 2 + Wd;
        const ez = Math.abs(Math.cos(h)) * L / 2 + Wd;
        placer.block(cx - ex, cz - ez, cx + ex, cz + ez);
        // The numbers at each end, close in.
        if (mpp < 12) {
          const [n1, n2] = r.ident.split('/');
          const off = L / 2 + Wd + 9;
          // Approaching on 09 you fly east: "09" is painted at the WEST end.
          const lo = Math.round(r.hdg / 10) % 36 === Number(n1) % 36 ? [n1, n2] : [n2, n1];
          placer.add(lo[0], cx - Math.sin(h) * off, cz + Math.cos(h) * off, 70, ST.rwy);
          placer.add(lo[1], cx + Math.sin(h) * off, cz - Math.cos(h) * off, 70, ST.rwy);
        }
      }
    }
    const big = a.cls >= 3;
    const sub = mpp < 12 ? `${a.name} · ${Math.round((a.elev || 0) * 3.28084)} ft` : mpp < 160 || big ? a.name : '';
    const lx = symbolOnly ? ax : X(a.runways[0].cx) + (Math.abs(Math.sin(a.hdg * DEG)) * a.runways[0].length * s) / 2;
    placer.add(a.code, lx, az, 60 + a.cls * 5 + (st.sel && st.sel.ref === a.id ? 50 : 0), { ...ST.code, sub, gap: symbolOnly ? 10 : 8 });
  }

  /* ---- the carrier ---- */
  if (st.carrier && on(st.carrier.x, st.carrier.z)) {
    const c = st.carrier;
    const L = Math.max(14, 330 * s);
    const Wd = Math.max(4, 76 * s);
    g.save();
    g.translate(X(c.x), Z(c.z));
    g.rotate(c.hdg * DEG);
    g.fillStyle = '#0d1b26';
    g.fillRect(-Wd / 2 - 1.5, -L / 2 - 1.5, Wd + 3, L + 3);
    g.fillStyle = '#9aa6b0';
    g.beginPath();
    g.moveTo(0, -L / 2 - 3);
    g.lineTo(Wd / 2, -L / 2 + Wd);
    g.lineTo(Wd / 2, L / 2);
    g.lineTo(-Wd / 2, L / 2);
    g.lineTo(-Wd / 2, -L / 2 + Wd);
    g.closePath();
    g.fill();
    g.restore();
    placer.add('CARRIER', X(c.x), Z(c.z), 62, { ...ST.code, font: `700 10.5px ${FONT}`, size: 10.5 });
  }

  /* ---- heliports: an H in a circle ---- */
  if (mpp < 60) {
    for (const h of P.heliports) {
      if (!on(h.x, h.z)) continue;
      stats.heli++;
      const x = X(h.x);
      const y = Z(h.z);
      g.fillStyle = h.role === 'hospital' ? '#d64545' : '#2c4b63';
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(x, y, 7, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#ffffff';
      g.font = `800 9px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('H', x, y + 0.5);
      placer.block(x - 8, y - 8, x + 8, y + 8);
      if (mpp < 25) placer.add(h.name, x, y, 30, ST.heli);
    }
  }

  /* ---- fixes: the open triangle of a reporting point ---- */
  const fixUntil = P.isPreview ? 160 : 45;
  if (mpp < fixUntil) {
    g.strokeStyle = 'rgba(214, 228, 255, 0.9)';
    g.fillStyle = 'rgba(10, 20, 34, 0.55)';
    g.lineWidth = 1.4;
    g.beginPath();
    for (const f of P.fixes) {
      if (!on(f.x, f.z)) continue;
      stats.fixes++;
      const x = X(f.x);
      const y = Z(f.z);
      g.moveTo(x, y - 5.5);
      g.lineTo(x + 5, y + 3.5);
      g.lineTo(x - 5, y + 3.5);
      g.closePath();
      placer.block(x - 6, y - 6, x + 6, y + 5);
      placer.add(f.name, x, y, 35, ST.fix);
    }
    g.fill();
    g.stroke();
  }

  /* ---- the flight plan: magenta, the active leg solid, the rest dashed ---- */
  const plan = st.plan;
  if (plan && plan.legs.length) {
    const from = plan.fromOf(0) || st.me;
    let px = from ? from.x : st.me.x;
    let pz = from ? from.z : st.me.z;
    for (let i = 0; i < plan.legs.length; i++) {
      const w = plan.legs[i];
      const done = i < plan.active;
      const active = i === plan.active;
      if (active && plan.state === 'active') {
        // The active leg starts where it started (or at you, after DIRECT TO).
        const f = plan.fromOf(i) || st.me;
        px = f.x;
        pz = f.z;
      }
      if (!done) {
        g.strokeStyle = MAGENTA;
        g.lineWidth = active ? 3 : 2.2;
        g.setLineDash(active ? [] : [9, 7]);
        g.beginPath();
        g.moveTo(X(px), Z(pz));
        g.lineTo(X(w.x), Z(w.z));
        g.stroke();
        g.setLineDash([]);
      }
      px = w.x;
      pz = w.z;
    }
    for (let i = 0; i < plan.legs.length; i++) {
      const w = plan.legs[i];
      if (i < plan.active || !on(w.x, w.z)) continue;
      const x = X(w.x);
      const y = Z(w.z);
      g.fillStyle = i === plan.active ? MAGENTA : 'rgba(232, 62, 230, 0.55)';
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(x, y - 7);
      g.lineTo(x + 7, y);
      g.lineTo(x, y + 7);
      g.lineTo(x - 7, y);
      g.closePath();
      g.fill();
      g.stroke();
      placer.block(x - 8, y - 8, x + 8, y + 8);
      placer.add(w.name, x, y, 90, ST.wp);
    }
    if (plan.state === 'holding' && plan.to) {
      // The hold: a dashed ring round the last waypoint.
      g.strokeStyle = 'rgba(232, 62, 230, 0.6)';
      g.setLineDash([5, 5]);
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(X(plan.to.x), Z(plan.to.z), Math.max(8, (st.holdR || 2000) * s), 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
  }

  /* ---- the pin ---- */
  if (st.pin && on(st.pin.x, st.pin.z)) {
    const x = X(st.pin.x);
    const y = Z(st.pin.z);
    g.fillStyle = '#ff5a4f';
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x - 9, y - 12, x - 9, y - 24, x, y - 24);
    g.bezierCurveTo(x + 9, y - 24, x + 9, y - 12, x, y);
    g.fill();
    g.stroke();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(x, y - 16, 3.2, 0, Math.PI * 2);
    g.fill();
    placer.block(x - 10, y - 26, x + 10, y + 1);
  }

  /* ---- a selected place: a ring ---- */
  if (st.sel && st.sel.kind !== 'pin' && on(st.sel.x, st.sel.z)) {
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(X(st.sel.x), Z(st.sel.z), 14, 0, Math.PI * 2);
    g.stroke();
  }

  /* ---- traffic ---- */
  if (st.traffic && st.traffic.length && mpp < 120) {
    g.fillStyle = 'rgba(255, 255, 255, 0.9)';
    g.strokeStyle = 'rgba(8, 16, 24, 0.9)';
    g.lineWidth = 1;
    for (const t of st.traffic) {
      if (!on(t.x, t.z)) continue;
      const x = X(t.x);
      const y = Z(t.z);
      g.save();
      g.translate(x, y);
      g.rotate((t.hdg || 0) * DEG);
      g.beginPath();
      g.moveTo(0, -5);
      g.lineTo(4, 4);
      g.lineTo(0, 2);
      g.lineTo(-4, 4);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
    }
  }

  /* ---- you: the arrow, a short track line ahead, a range ring ---- */
  const me = st.me;
  if (me) {
    const x = X(me.x);
    const y = Z(me.z);
    const h = me.hdg * DEG;
    // Where you will be in a minute, if nothing changes.
    if (me.gsMs > 5) {
      const ahead = me.gsMs * 60 * s;
      g.strokeStyle = 'rgba(255, 214, 64, 0.7)';
      g.lineWidth = 1.6;
      g.setLineDash([3, 4]);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.sin(h) * ahead, y - Math.cos(h) * ahead);
      g.stroke();
      g.setLineDash([]);
    }
    g.save();
    g.translate(x, y);
    g.rotate(h);
    g.shadowColor = 'rgba(0, 0, 0, 0.45)';
    g.shadowBlur = 6;
    g.fillStyle = '#ffd640';
    g.strokeStyle = '#141414';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(0, -13);
    g.lineTo(9, 10);
    g.lineTo(0, 5);
    g.lineTo(-9, 10);
    g.closePath();
    g.fill();
    g.shadowBlur = 0;
    g.stroke();
    g.restore();
    placer.block(x - 14, y - 14, x + 14, y + 14);
  }

  stats.labels = placer.draw(g, W, H);
  return stats;
}

function fmtGrat(v, kind) {
  const a = Math.abs(v);
  let d = Math.floor(a + 1e-9);
  let m = Math.round((a - d) * 60);
  if (m === 60) {
    d++;
    m = 0;
  }
  const h = kind === 'lat' ? (v < 0 ? 'S' : 'N') : v < 0 ? 'W' : 'E';
  return `${h}${String(d).padStart(kind === 'lat' ? 2 : 3, '0')}°${String(m).padStart(2, '0')}'`;
}

/** A scale bar that is a round number of kilometres and 60-140 px long, and a north arrow. */
export function drawFurniture(g, v) {
  const s = v.s;
  const W = v.W;
  const H = v.H;
  const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200];
  let km = nice[nice.length - 1];
  for (const k of nice) {
    if (k * 1000 * s >= 70) {
      km = k;
      break;
    }
  }
  const px = km * 1000 * s;
  const nm = (km * 1000) / 1852;
  const x1 = W - 18;
  const x0 = x1 - px;
  const y = H - 22;
  g.fillStyle = 'rgba(8, 16, 24, 0.55)';
  roundRect(g, x0 - 10, y - 20, px + 20, 32, 8);
  g.fill();
  g.fillStyle = '#ffffff';
  g.fillRect(x0, y, px, 3);
  g.fillRect(x0, y - 4, 1.5, 7);
  g.fillRect(x1 - 1.5, y - 4, 1.5, 7);
  g.fillRect(x0 + px / 2 - 0.75, y - 2, 1.5, 5);
  g.font = `600 10.5px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'bottom';
  g.fillText(`${km < 1 ? km * 1000 + ' m' : km + ' km'} · ${nm < 1 ? nm.toFixed(2) : nm.toFixed(nm < 10 ? 1 : 0)} NM`, x0 + px / 2, y - 4);
  // North arrow, top right under the bar of buttons.
  const nx = W - 34;
  const ny = 86;
  g.fillStyle = 'rgba(8, 16, 24, 0.55)';
  g.beginPath();
  g.arc(nx, ny, 17, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(nx, ny - 12);
  g.lineTo(nx + 6, ny + 7);
  g.lineTo(nx, ny + 3);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(255, 255, 255, 0.45)';
  g.beginPath();
  g.moveTo(nx, ny - 12);
  g.lineTo(nx - 6, ny + 7);
  g.lineTo(nx, ny + 3);
  g.closePath();
  g.fill();
  g.font = `700 9px ${FONT}`;
  g.textBaseline = 'top';
  g.fillStyle = '#ffffff';
  g.fillText('N', nx, ny + 7);
  return { km, px };
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
