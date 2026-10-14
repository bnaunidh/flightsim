/**
 * SIGNAL ZERO — portraits, painted in code.
 *
 * The project's art rule: every texture is generated at load time, there are
 * no image files. So the dialogue portraits are canvas busts, drawn flat in
 * three-quarter view like a graphic novel panel, from a few colours and a
 * hair style per character (script.js CAST[id].look). Ten characters share
 * one painter; a new one is a new `look`, not a new drawing.
 *
 * Three kinds:
 *   'bust'    head, hair, shoulders, an accessory (lanyard, aviators, headset…)
 *   'helmet'  the player: a visor, never a face
 *   'screen'  RANGE CONTROL: an old monitor with a waveform and scanlines
 *
 * Painted once per (id, size) and cached; a canvas is returned, so the caller
 * can drop it straight into the DOM or draw it onto another canvas.
 */

import { CAST } from './script.js';

const cache = new Map();

export function portrait(id, size = 96) {
  const key = `${id}:${size}`;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const who = CAST[id] || CAST.lark;
  try {
    paint(g, size, who);
  } catch (e) {
    // A painter that throws leaves a plain coloured disc, never a broken box.
    g.fillStyle = who.colour || '#888';
    g.beginPath();
    g.arc(size / 2, size / 2, size * 0.46, 0, Math.PI * 2);
    g.fill();
  }
  c.className = 'sz-portrait';
  cache.set(key, c);
  return c;
}

/** The character's data URL, for an <img> where a canvas is awkward. */
export function portraitUrl(id, size = 96) {
  return portrait(id, size).toDataURL('image/png');
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * k)));
  const gg = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * k)));
  const b = Math.min(255, Math.max(0, Math.round((n & 255) * k)));
  return `rgb(${r},${gg},${b})`;
}

function paint(g, S, who) {
  const look = who.look || { kind: 'bust' };
  const u = S / 100; // everything below is in a 100-unit square
  g.save();
  g.scale(u, u);
  // Background: a soft disc in the character's colour, a darker ring.
  const bg = g.createRadialGradient(42, 36, 6, 50, 50, 52);
  bg.addColorStop(0, shade(hexOf(who.colour), 0.55));
  bg.addColorStop(1, '#0b1220');
  g.fillStyle = bg;
  g.beginPath();
  g.arc(50, 50, 49, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.beginPath();
  g.arc(50, 50, 47, 0, Math.PI * 2);
  g.clip();
  if (look.kind === 'screen') paintScreen(g, who);
  else if (look.kind === 'helmet') paintHelmet(g, look);
  else paintBust(g, look);
  g.restore();
  g.lineWidth = 2.2;
  g.strokeStyle = who.colour;
  g.beginPath();
  g.arc(50, 50, 47.5, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

function hexOf(c) {
  return /^#[0-9a-f]{6}$/i.test(c) ? c : '#8899aa';
}

/* ---- a bust: shoulders, neck, head, hair, face marks, accessory ------ */

function paintBust(g, L) {
  const skin = L.skin || '#d7b08c';
  const hair = L.hair || '#333';
  const jacket = L.jacket || '#334';
  const shirt = L.shirt || '#ccc';

  // Shoulders and jacket (three-quarter: the near shoulder is bigger).
  g.fillStyle = jacket;
  g.beginPath();
  g.moveTo(8, 100);
  g.quadraticCurveTo(14, 70, 38, 66);
  g.lineTo(62, 66);
  g.quadraticCurveTo(90, 70, 96, 100);
  g.closePath();
  g.fill();
  // Shirt / collar V.
  g.fillStyle = shirt;
  g.beginPath();
  g.moveTo(40, 66);
  g.lineTo(50, 86);
  g.lineTo(60, 66);
  g.closePath();
  g.fill();
  // Lapels.
  g.fillStyle = shade(jacket, 0.75);
  g.beginPath();
  g.moveTo(38, 66);
  g.lineTo(46, 90);
  g.lineTo(34, 72);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(62, 66);
  g.lineTo(54, 90);
  g.lineTo(66, 72);
  g.closePath();
  g.fill();

  // Neck.
  g.fillStyle = shade(skin, 0.82);
  g.fillRect(44, 54, 13, 16);

  // Head: an egg, turned a little to the viewer's left.
  g.fillStyle = skin;
  g.beginPath();
  g.ellipse(49, 40, 17, 21, 0, 0, Math.PI * 2);
  g.fill();
  // Cheek shadow on the far side.
  g.fillStyle = shade(skin, 0.86);
  g.beginPath();
  g.ellipse(60, 44, 7, 15, 0.2, -Math.PI / 2, Math.PI / 2);
  g.fill();
  // Ear.
  g.fillStyle = shade(skin, 0.9);
  g.beginPath();
  g.ellipse(33, 42, 3.2, 5, 0, 0, Math.PI * 2);
  g.fill();

  // Eyes, brows, nose, mouth: ink marks, few of them.
  g.strokeStyle = '#1b1612';
  g.fillStyle = '#1b1612';
  g.lineWidth = 1.6;
  g.lineCap = 'round';
  // Brows.
  g.beginPath();
  g.moveTo(39, 33);
  g.lineTo(46, 32);
  g.moveTo(52, 32);
  g.lineTo(59, 33.5);
  g.stroke();
  // Eyes.
  g.beginPath();
  g.ellipse(42.5, 38, 2.1, 1.5, 0, 0, Math.PI * 2);
  g.ellipse(55.5, 38, 2.1, 1.5, 0, 0, Math.PI * 2);
  g.fill();
  // Nose.
  g.beginPath();
  g.moveTo(50, 39);
  g.lineTo(52, 47);
  g.lineTo(48.5, 47.5);
  g.stroke();
  // Mouth: a small, dry line.
  g.beginPath();
  g.moveTo(44, 53);
  g.quadraticCurveTo(50, 55, 55, 52.5);
  g.stroke();

  paintHair(g, L.hairStyle || 'short', hair);
  paintAccessory(g, L.accessory, L);
}

function paintHair(g, style, hair) {
  g.fillStyle = hair;
  switch (style) {
    case 'short':
      g.beginPath();
      g.ellipse(49, 26, 18, 10, 0, Math.PI, Math.PI * 2);
      g.lineTo(67, 30);
      g.lineTo(31, 30);
      g.closePath();
      g.fill();
      break;
    case 'crop':
      g.beginPath();
      g.ellipse(49, 25, 17.5, 8, 0, Math.PI, Math.PI * 2);
      g.lineTo(66.5, 27);
      g.lineTo(31.5, 27);
      g.closePath();
      g.fill();
      break;
    case 'messy':
      g.beginPath();
      g.moveTo(31, 32);
      g.quadraticCurveTo(30, 14, 50, 15);
      g.quadraticCurveTo(70, 13, 68, 32);
      g.lineTo(64, 26);
      g.lineTo(60, 31);
      g.lineTo(55, 24);
      g.lineTo(48, 30);
      g.lineTo(42, 24);
      g.lineTo(37, 30);
      g.closePath();
      g.fill();
      break;
    case 'curly':
      for (let i = 0; i < 9; i++) {
        const a = Math.PI + (i / 8) * Math.PI;
        g.beginPath();
        g.arc(49 + Math.cos(a) * 17, 29 + Math.sin(a) * 13, 5.5, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case 'long':
      g.beginPath();
      g.ellipse(49, 27, 18.5, 11, 0, Math.PI, Math.PI * 2);
      g.lineTo(69, 70);
      g.lineTo(60, 70);
      g.lineTo(62, 40);
      g.lineTo(36, 40);
      g.lineTo(38, 70);
      g.lineTo(29, 70);
      g.closePath();
      g.fill();
      break;
    case 'braids':
      g.beginPath();
      g.ellipse(49, 27, 18, 10.5, 0, Math.PI, Math.PI * 2);
      g.lineTo(67, 31);
      g.lineTo(31, 31);
      g.closePath();
      g.fill();
      g.lineWidth = 3.2;
      g.strokeStyle = hair;
      for (const x of [34, 38, 60, 64]) {
        g.beginPath();
        g.moveTo(x, 30);
        g.quadraticCurveTo(x + (x < 50 ? -3 : 3), 55, x + (x < 50 ? -1 : 1), 72);
        g.stroke();
      }
      break;
    case 'side':
      g.beginPath();
      g.moveTo(31, 31);
      g.quadraticCurveTo(33, 15, 52, 16);
      g.quadraticCurveTo(70, 17, 67, 32);
      g.quadraticCurveTo(58, 24, 40, 28);
      g.closePath();
      g.fill();
      break;
    case 'bun':
      g.beginPath();
      g.ellipse(49, 26, 18, 10, 0, Math.PI, Math.PI * 2);
      g.lineTo(67, 30);
      g.lineTo(31, 30);
      g.closePath();
      g.fill();
      g.beginPath();
      g.arc(62, 20, 6, 0, Math.PI * 2);
      g.fill();
      break;
    default:
      break;
  }
}

function paintAccessory(g, kind, L) {
  switch (kind) {
    case 'lanyard': {
      // Mara: a lanyard, and the small steel key she never takes off.
      g.strokeStyle = '#3a6ea5';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(42, 68);
      g.lineTo(49, 88);
      g.lineTo(57, 68);
      g.stroke();
      g.fillStyle = '#cfd6dd';
      g.fillRect(47.5, 88, 3, 7);
      g.beginPath();
      g.arc(49, 88, 2.4, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'aviators': {
      // Cole: aviators pushed up on his head, and gum.
      g.strokeStyle = '#d9c27a';
      g.lineWidth = 1.5;
      g.fillStyle = 'rgba(40,60,90,0.75)';
      for (const x of [41, 56]) {
        g.beginPath();
        g.ellipse(x, 20, 6, 4, 0, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
      g.beginPath();
      g.moveTo(47, 20);
      g.lineTo(50, 20);
      g.stroke();
      break;
    }
    case 'press': {
      // Priya: a press lanyard and card.
      g.strokeStyle = '#eee';
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(43, 68);
      g.lineTo(50, 84);
      g.lineTo(57, 68);
      g.stroke();
      g.fillStyle = '#f5f2e8';
      g.fillRect(45, 84, 10, 7);
      g.fillStyle = '#3fd1c0';
      g.fillRect(45, 84, 10, 2);
      break;
    }
    case 'tablet': {
      g.fillStyle = '#22262c';
      g.fillRect(70, 72, 22, 28);
      g.fillStyle = '#7ee07e';
      g.fillRect(72, 75, 18, 20);
      g.strokeStyle = '#22262c';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(74, 80);
      g.lineTo(88, 80);
      g.moveTo(74, 85);
      g.lineTo(86, 85);
      g.stroke();
      break;
    }
    case 'kneeboard': {
      // A collar with rank, plain.
      g.fillStyle = '#c9c9b0';
      g.fillRect(63, 70, 7, 2);
      g.fillRect(63, 74, 7, 2);
      break;
    }
    case 'binoculars': {
      g.fillStyle = '#1b1f26';
      g.beginPath();
      g.arc(76, 82, 7, 0, Math.PI * 2);
      g.arc(88, 82, 7, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#1b1f26';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(58, 68);
      g.quadraticCurveTo(70, 72, 82, 78);
      g.stroke();
      break;
    }
    case 'tie': {
      g.fillStyle = '#5b6a7f';
      g.beginPath();
      g.moveTo(47.5, 70);
      g.lineTo(52.5, 70);
      g.lineTo(51, 92);
      g.lineTo(49, 92);
      g.closePath();
      g.fill();
      break;
    }
    case 'coat': {
      g.fillStyle = shade(L.jacket || '#444', 1.25);
      g.fillRect(36, 66, 4, 34);
      g.fillRect(60, 66, 4, 34);
      break;
    }
    case 'headset': {
      g.strokeStyle = '#1b1f26';
      g.lineWidth = 2.6;
      g.beginPath();
      g.arc(49, 34, 21, Math.PI * 1.05, Math.PI * 1.95);
      g.stroke();
      g.fillStyle = '#1b1f26';
      g.beginPath();
      g.ellipse(31, 43, 4, 6, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(31, 48);
      g.quadraticCurveTo(36, 58, 44, 56);
      g.lineWidth = 1.8;
      g.stroke();
      g.beginPath();
      g.arc(44, 56, 2, 0, Math.PI * 2);
      g.fill();
      break;
    }
    default:
      break;
  }
}

/* ---- the player: a helmet and a visor, never a face ------------------ */

function paintHelmet(g, L) {
  g.fillStyle = L.suit || '#2d3e55';
  g.beginPath();
  g.moveTo(6, 100);
  g.quadraticCurveTo(12, 70, 38, 66);
  g.lineTo(62, 66);
  g.quadraticCurveTo(90, 70, 96, 100);
  g.closePath();
  g.fill();
  g.fillStyle = shade(L.skin || '#c9a27e', 0.85);
  g.fillRect(44, 56, 12, 12);
  // Helmet shell.
  g.fillStyle = '#e9ecef';
  g.beginPath();
  g.ellipse(50, 38, 21, 23, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#cfd4da';
  g.beginPath();
  g.ellipse(58, 40, 10, 20, 0.15, -Math.PI / 2, Math.PI / 2);
  g.fill();
  // Visor.
  const v = g.createLinearGradient(30, 28, 70, 50);
  v.addColorStop(0, shade(L.visor || '#2a4b74', 1.6));
  v.addColorStop(0.5, L.visor || '#2a4b74');
  v.addColorStop(1, '#0a1626');
  g.fillStyle = v;
  g.beginPath();
  g.moveTo(31, 36);
  g.quadraticCurveTo(50, 28, 69, 36);
  g.lineTo(66, 50);
  g.quadraticCurveTo(50, 56, 34, 50);
  g.closePath();
  g.fill();
  // A highlight stripe across the visor.
  g.strokeStyle = 'rgba(255,255,255,0.45)';
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(36, 38);
  g.quadraticCurveTo(50, 33, 64, 38);
  g.stroke();
  // Oxygen mask hose.
  g.strokeStyle = '#55606c';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(52, 56);
  g.quadraticCurveTo(60, 66, 70, 74);
  g.stroke();
}

/* ---- RANGE CONTROL: a 1986 monitor ----------------------------------- */

function paintScreen(g) {
  g.fillStyle = '#121214';
  g.fillRect(0, 0, 100, 100);
  g.fillStyle = '#2a2a2e';
  g.fillRect(14, 20, 72, 56);
  g.fillStyle = '#060a08';
  g.fillRect(18, 24, 64, 48);
  // A cold waveform, two notes.
  g.strokeStyle = '#ff4d4d';
  g.lineWidth = 1.8;
  g.beginPath();
  for (let x = 0; x <= 64; x += 2) {
    const t = x / 64;
    const y = 48 + Math.sin(t * Math.PI * 6) * (t > 0.3 && t < 0.7 ? 10 : 3);
    if (x === 0) g.moveTo(18 + x, y);
    else g.lineTo(18 + x, y);
  }
  g.stroke();
  // Caption glyphs: a line of blocks.
  g.fillStyle = '#ff4d4d';
  for (let i = 0; i < 9; i++) g.fillRect(21 + i * 6.6, 64, 4.4, 2.6);
  // Scanlines.
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = 24; y < 72; y += 3) g.fillRect(18, y, 64, 1);
  // Stand and a status lamp.
  g.fillStyle = '#2a2a2e';
  g.fillRect(40, 76, 20, 6);
  g.fillRect(30, 82, 40, 4);
  g.fillStyle = '#ff4d4d';
  g.beginPath();
  g.arc(80, 79, 1.8, 0, Math.PI * 2);
  g.fill();
}

/** For the tests: who can be painted. */
export const PORTRAIT_IDS = Object.keys(CAST);
