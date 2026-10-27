/**
 * The regional weather on the live map (World Map — Preview).
 *
 * The owner (2026-10-26): "the world map overlay shows rough weather per
 * region (cloud/rain/fog icons)". On the World Map each region rolls its own
 * weather (world/wx.js WxSystem) and the fronts drift across the sea; this
 * draws a small icon for each region's weather where its weather is now —
 * sun, cloud, rain, a storm, fog or mist, haze, snow — with its word under
 * it, over the chart when it is zoomed out far enough to see regions (the
 * live map's zoomed-out level: coastlines, regions, big airports, weather).
 * An additive layer (livemap.js addMapLayer); an ordinary map has one
 * place's weather and the wind card says it, so nothing is drawn there.
 *
 * `iconFor(cond)` is exported for the tests: which icon a weather gets.
 */
import { addMapLayer } from './livemap/livemap.js';

/** The icon a weather is drawn with. */
export function iconFor(c) {
  if (!c) return 'sun';
  if ((c.storm || 0) > 0.5 || (c.cb || 0) > 0.6) return 'storm';
  if ((c.snow || 0) > 0.2) return 'snow';
  if ((c.rain || 0) > 0.2) return 'rain';
  if ((c.mist || 0) > 0.5 && c.visM < 6000) return 'fog';
  if ((c.haze || 0) > 0.5) return 'haze';
  if ((c.cloud || 0) > 0.55) return 'cloud';
  if ((c.cloud || 0) > 0.3) return 'partly';
  return 'sun';
}

function cloud(g, x, y, r, fill) {
  g.beginPath();
  g.arc(x - r * 0.45, y + r * 0.1, r * 0.42, Math.PI * 0.5, Math.PI * 1.5);
  g.arc(x - r * 0.05, y - r * 0.22, r * 0.52, Math.PI * 1.05, Math.PI * 1.95);
  g.arc(x + r * 0.45, y + r * 0.05, r * 0.45, Math.PI * 1.4, Math.PI * 0.5);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.stroke();
}

function sun(g, x, y, r) {
  g.beginPath();
  g.arc(x, y, r * 0.42, 0, Math.PI * 2);
  g.fillStyle = '#ffd166';
  g.fill();
  g.stroke();
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    g.moveTo(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62);
    g.lineTo(x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85);
  }
  g.strokeStyle = '#ffd166';
  g.stroke();
}

/** Draw one icon of radius r at (x, y). */
export function drawIcon(g, kind, x, y, r) {
  g.save();
  g.lineWidth = Math.max(1, r * 0.09);
  g.strokeStyle = 'rgba(20, 28, 40, 0.75)';
  g.lineJoin = 'round';
  g.lineCap = 'round';
  if (kind === 'sun') sun(g, x, y, r);
  else if (kind === 'partly') {
    sun(g, x - r * 0.3, y - r * 0.3, r * 0.75);
    g.strokeStyle = 'rgba(20, 28, 40, 0.75)';
    cloud(g, x + r * 0.15, y + r * 0.2, r * 0.8, '#eef2f6');
  } else if (kind === 'cloud') cloud(g, x, y, r, '#d9dee5');
  else if (kind === 'haze') {
    sun(g, x, y - r * 0.15, r * 0.8);
    g.strokeStyle = 'rgba(235, 225, 200, 0.95)';
    g.beginPath();
    for (let i = 0; i < 3; i++) { g.moveTo(x - r * 0.75, y + r * (0.15 + i * 0.25)); g.lineTo(x + r * 0.75, y + r * (0.15 + i * 0.25)); }
    g.stroke();
  } else if (kind === 'fog') {
    g.strokeStyle = 'rgba(230, 236, 242, 0.95)';
    g.lineWidth = Math.max(1.5, r * 0.16);
    g.beginPath();
    for (let i = 0; i < 4; i++) {
      const yy = y - r * 0.45 + i * r * 0.3;
      const off = i % 2 ? r * 0.15 : 0;
      g.moveTo(x - r * 0.8 + off, yy);
      g.lineTo(x + r * 0.8 - off, yy);
    }
    g.stroke();
  } else {
    cloud(g, x, y - r * 0.2, r, kind === 'storm' ? '#6f7886' : '#aeb7c3');
    g.beginPath();
    if (kind === 'rain') {
      g.strokeStyle = '#7fb2ff';
      for (let i = -1; i <= 1; i++) { g.moveTo(x + i * r * 0.35, y + r * 0.35); g.lineTo(x + i * r * 0.35 - r * 0.12, y + r * 0.75); }
      g.stroke();
    } else if (kind === 'snow') {
      g.fillStyle = '#ffffff';
      for (let i = -1; i <= 1; i++) { g.moveTo(x + i * r * 0.35 + r * 0.08, y + r * 0.55); g.arc(x + i * r * 0.35, y + r * 0.55, r * 0.08, 0, Math.PI * 2); }
      g.fill();
    } else {
      // The storm: a bolt, drawn as a shape (nothing on the map flashes).
      g.fillStyle = '#ffd166';
      g.moveTo(x + r * 0.05, y + r * 0.2);
      g.lineTo(x - r * 0.2, y + r * 0.6);
      g.lineTo(x, y + r * 0.55);
      g.lineTo(x - r * 0.1, y + r * 0.9);
      g.lineTo(x + r * 0.25, y + r * 0.42);
      g.lineTo(x + r * 0.05, y + r * 0.47);
      g.closePath();
      g.fill();
    }
  }
  g.restore();
}

const _c = {};
/** What the layer last drew (the tests): { frames, icons }. */
export const WX_MAP = { frames: 0, icons: 0 };

/** The regions' weather as drawn: [{ id, name, x, z, icon, word }]. Exported for the tests. */
export function regionWeather(wx) {
  if (!wx || !wx.regions || wx.regions.length < 2) return [];
  return wx.regions.map((r) => {
    // Where the region's own weather is now: its centre, moved downwind with the fronts.
    const x = r.cx + wx.drift.x;
    const z = r.cz + wx.drift.z;
    const c = wx.at(x, z, _c);
    return { id: r.id, name: r.name, x, z, icon: iconFor(c), word: c.word || c.label };
  });
}

addMapLayer((g, v, sim) => {
  const wx = sim && sim.weather && sim.weather.wx;
  if (!wx || wx.regions.length < 2) return;
  // Zoomed out far enough to see regions: about 60 km across or more.
  const span = v.W / v.s;
  if (span < 60000) return;
  const fade = Math.min(1, (span - 60000) / 60000);
  const r = Math.max(9, Math.min(16, v.W / 90));
  g.save();
  g.globalAlpha = 0.55 + 0.4 * fade;
  g.font = `600 ${Math.round(r * 0.75)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  WX_MAP.frames++;
  WX_MAP.icons = 0;
  for (const p of regionWeather(wx)) {
    const sx = v.W / 2 + (p.x - v.cx) * v.s;
    const sy = v.H / 2 + (p.z - v.cz) * v.s;
    if (sx < -40 || sy < -40 || sx > v.W + 40 || sy > v.H + 40) continue;
    // Above the region's name the chart already prints, so the two do not collide.
    const y = sy - r * 2.6;
    drawIcon(g, p.icon, sx, y, r);
    WX_MAP.icons++;
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(10, 16, 24, 0.7)';
    g.strokeText(p.word, sx, y + r * 1.05);
    g.fillStyle = '#e8eef5';
    g.fillText(p.word, sx, y + r * 1.05);
  }
  g.restore();
});
