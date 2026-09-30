/**
 * T-Pose Harrison in the game: in the hangar shop, on his own hangar card,
 * and close enough to the camera to see.
 *
 * The aeroplane itself is ../aircraft/extra/tpose.js (the numbers: Massimo's
 * with 0.19% less drag — exactly 1 km/h faster at the top) and
 * ../aircraft/models/tpose-harrison.js (the drawing). This file is only the
 * parts of the game around him:
 *
 *   THE SHOP. An aeroplane progression.js does not price is locked for ever
 *   (see airliners.js for how that bit the jumbos). He costs 3,601 credits:
 *   one more than Air Massimo, because of course he does.
 *
 *   THE CARD. The Free Flight picker draws every aeroplane's card as a plan
 *   view from its shape — which for a man on a board is a small green cross.
 *   His card gets his portrait instead: arms out, shades on, flame below, and
 *   a "+1 km/h" tag. Painted after the picker paints its own, whenever it
 *   does (the livery setting repaints every card).
 *
 *   THE CAMERA. The follow view stands 17 m back for an aeroplane, which
 *   makes a 3.3 m man a stick figure. He gets it at 8 m.
 */

import { registerExtension } from '../game/extensions.js';
import * as PROG from '../game/progression.js';

export const HARRISON_PRICE = 3601;

try {
  const rows = PROG.UNLOCKS;
  if (Array.isArray(rows) && !rows.some((u) => u && u.aircraft === 'tpose')) {
    rows.push({ aircraft: 'tpose', cost: HARRISON_PRICE, why: 'One km/h faster than Air Massimo' });
  }
} catch (e) {
  console.warn('[tpose] could not put T-Pose Harrison in the shop', e);
}

/** The follow view's standoff for him, metres (the game's is 17 and 5.2). */
const CHASE = { back: 8, up: 2.6 };

/** His portrait for the hangar card. Same size and class as the plan views. */
export function drawHarrisonCard(doc = document) {
  const W = 300;
  const H = 190;
  const c = doc.createElement('canvas');
  c.width = W * 2;
  c.height = H * 2;
  c.className = 'fleet-art';
  c.dataset.tpose = '1';
  const g = c.getContext('2d');
  if (!g) return c;
  g.scale(2, 2);
  const cx = W / 2;
  const rr = (x, y, w, h, r, fill) => {
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
    g.fill();
  };
  // The flame, Massimo blue, out of the back of the board (towards us, below).
  const fl = g.createLinearGradient(0, 150, 0, 188);
  fl.addColorStop(0, 'rgba(210,240,255,0.95)');
  fl.addColorStop(1, 'rgba(90,170,255,0)');
  g.fillStyle = fl;
  g.beginPath();
  g.moveTo(cx - 13, 152);
  g.lineTo(cx + 13, 152);
  g.lineTo(cx, 188);
  g.closePath();
  g.fill();
  // The board, seen from the front: purple, a yellow flash, three wheels.
  rr(cx - 44, 140, 88, 12, 6, '#7a3bd1');
  rr(cx - 30, 143, 60, 3, 1.5, '#ffd23f');
  g.fillStyle = '#141518';
  for (const x of [cx - 34, cx, cx + 34]) {
    g.beginPath();
    g.arc(x, 156, 5, 0, Math.PI * 2);
    g.fill();
  }
  // Legs, jeans, red trainers.
  rr(cx - 15, 96, 12, 44, 3, '#2f4f8a');
  rr(cx + 3, 96, 12, 44, 3, '#2f4f8a');
  rr(cx - 18, 134, 16, 7, 3, '#e0302b');
  rr(cx + 2, 134, 16, 7, 3, '#e0302b');
  // The arms, dead straight: the whole point of him.
  rr(cx - 118, 50, 236, 10, 5, '#e8b894');
  rr(cx - 34, 48, 68, 14, 5, '#2fb36b');
  g.fillStyle = '#e8b894';
  for (const x of [cx - 118, cx + 118]) {
    g.beginPath();
    g.arc(x, 55, 7, 0, Math.PI * 2);
    g.fill();
  }
  // The body: green T-shirt, big white T.
  rr(cx - 20, 46, 40, 54, 8, '#2fb36b');
  g.fillStyle = '#f4f6f8';
  g.fillRect(cx - 12, 56, 24, 6);
  g.fillRect(cx - 3, 56, 6, 24);
  // Head, spiky hair, shades, a grin.
  g.fillStyle = '#e8b894';
  g.beginPath();
  g.arc(cx, 30, 15, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#5a3a1e';
  g.beginPath();
  for (let k = 0; k < 6; k++) {
    const x0 = cx - 15 + k * 6;
    g.moveTo(x0, 22);
    g.lineTo(x0 + 3, 8 + (k % 2) * 4);
    g.lineTo(x0 + 6, 22);
  }
  g.fill();
  g.fillStyle = '#0b0b0b';
  rr(cx - 13, 26, 26, 6, 2, '#0b0b0b');
  g.strokeStyle = '#8a3a2a';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(cx, 36, 5, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();
  // The tag.
  rr(W - 96, 10, 84, 22, 11, '#ffd23f');
  g.fillStyle = '#1a1a1a';
  g.font = '800 12px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('+1 km/h', W - 54, 21.5);
  return c;
}

function paintCard(sim) {
  const layer = (sim.menus && sim.menus.layer) || (typeof document !== 'undefined' ? document : null);
  const host = layer && layer.querySelector ? layer.querySelector('[data-fleet-art="tpose"]') : null;
  if (!host) return false;
  host.innerHTML = '';
  host.appendChild(drawHarrisonCard());
  return true;
}

function wrapPicker(sim) {
  const m = sim.menus;
  if (!m || typeof m.repaintFleetArt !== 'function' || m._tposeArt) return;
  const inner = m.repaintFleetArt;
  m._tposeArt = true;
  m.repaintFleetArt = function repaintWithHarrison(...args) {
    const out = inner.apply(this, args);
    try {
      paintCard(sim);
    } catch (e) {
      console.warn('[tpose] could not paint his card', e);
    }
    return out;
  };
}

registerExtension({
  id: 'tpose',
  install(sim) {
    wrapPicker(sim);
    paintCard(sim);
  },
  startMode(sim) {
    if (!sim.aircraftType || sim.aircraftType.id !== 'tpose' || !sim.rig) return;
    // setAircraft() fits the standoff to the model on every change of type
    // and not otherwise, so this holds for as long as he is the one flying.
    sim.rig.chaseBack = CHASE.back;
    sim.rig.chaseUp = CHASE.up;
  },
});
