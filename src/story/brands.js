/**
 * SIGNAL ZERO — the story's marks, painted in code.
 *
 * The project's art rule is that every texture is generated at load time,
 * so the two marks the story keeps coming back to are canvas painters, not
 * image files:
 *
 *   KITTIWAKE   the faded seabird of the 1986 range (orange on off-white): on
 *               the fin in chapter 1's photo, stencilled on the SENTINEL unit
 *               in chapter 2, on survey markers and, later, the silos;
 *   THORNEFIELD Thornefield Dynamics: grey and teal, a thorn in a hexagon
 *               and the wordmark — the contractor's helicopter, vests and
 *               crates from chapter 2 on.
 *
 * Painters draw onto any 2D context (a portrait, a photo reveal, a decal);
 * decalTexture() wraps one in a CanvasTexture for a 3D prop. Textures are
 * made per prop and disposed with it — never cached at module scope, because
 * disposeWorld() in main.js disposes every texture hanging off the world's
 * materials when the map changes (world/pads.js has the long version).
 */

import * as THREE from '../vendor/three.module.js';

export const KITTIWAKE = Object.freeze({ orange: '#ff7a1a', faded: '#d9763a', white: '#f2ebdd' });

export const THORNEFIELD = Object.freeze({
  name: 'Thornefield Dynamics',
  short: 'THORNEFIELD',
  grey: '#8a9097',
  teal: '#1f8a83',
  light: '#5fb8b0',
  dark: '#2c3140',
  /** For a HeliFlyer (features/ambient/flyers.js LIVERIES.thornefield) and an NpcFlyer scheme. */
  livery: { base: '#8a9097', accent: '#1f8a83' },
});

/**
 * The kittiwake: a seabird in flight, two arcs and a body, on a white
 * roundel. (cx, cy) the middle, s the half-span.
 */
export function paintKittiwake(g, cx, cy, s, { roundel = true, colour = KITTIWAKE.orange, alpha = 1 } = {}) {
  g.save();
  g.globalAlpha *= alpha;
  if (roundel) {
    g.fillStyle = KITTIWAKE.white;
    g.beginPath();
    g.ellipse(cx, cy, s * 1.3, s * 1.0, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = colour;
  g.lineWidth = Math.max(1.2, s * 0.24);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(cx - s, cy + s * 0.1);
  g.quadraticCurveTo(cx - s * 0.5, cy - s * 0.55, cx, cy - s * 0.05);
  g.quadraticCurveTo(cx + s * 0.5, cy - s * 0.55, cx + s, cy + s * 0.1);
  g.stroke();
  g.beginPath();
  g.moveTo(cx, cy - s * 0.05);
  g.lineTo(cx - s * 0.18, cy + s * 0.5);
  g.moveTo(cx, cy - s * 0.05);
  g.lineTo(cx + s * 0.18, cy + s * 0.5);
  g.stroke();
  g.restore();
}

/**
 * Thornefield's mark: a teal hexagon with a thorn through it, and the
 * wordmark to its right when `word` is set. (x, y) the hexagon's middle, r
 * its radius.
 */
export function paintThornefield(g, x, y, r, { word = true, colour = THORNEFIELD.teal, ink = '#f4f6f8' } = {}) {
  g.save();
  g.fillStyle = colour;
  g.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 6 + (k * Math.PI) / 3;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (k) g.lineTo(px, py);
    else g.moveTo(px, py);
  }
  g.closePath();
  g.fill();
  // The thorn: a stem with one barb, in the paper colour.
  g.strokeStyle = ink;
  g.lineWidth = Math.max(1.2, r * 0.18);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x - r * 0.15, y + r * 0.62);
  g.lineTo(x + r * 0.12, y - r * 0.62);
  g.moveTo(x - r * 0.02, y);
  g.lineTo(x + r * 0.45, y - r * 0.22);
  g.stroke();
  if (word) {
    g.fillStyle = colour;
    g.font = `800 ${Math.round(r * 0.95)}px 'Barlow Condensed', 'Jost', Arial, sans-serif`;
    g.textBaseline = 'middle';
    g.fillText(THORNEFIELD.short, x + r * 1.35, y + r * 0.04);
  }
  g.restore();
}

/**
 * A canvas painted by `paint(g, w, h)`, as a texture for a decal. The caller
 * owns it and disposes it with its prop.
 */
export function decalTexture(w, h, paint) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g || typeof g.fillRect !== 'function') return null;
  try {
    paint(g, w, h);
  } catch (e) {
    return null;
  }
  const tex = new THREE.CanvasTexture(c);
  if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
