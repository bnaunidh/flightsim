/**
 * How the terminal looks: its curtain wall by day and by night, and the
 * airport's name in lit letters on its roof.
 *
 * Owner (Oct 25, Gateway International at night): "Terminal facade = one
 * giant flat grid of pastel-lit tiles, way too bright/uniform at night →
 * real curtain wall: mullions with depth, dark tinted glass with only SOME
 * lit interior zones (gate lounges, shops), visible interior hints (ceiling
 * lights, columns), levels/floors". And "'GATEWAY INTERNATIONAL' is a plain
 * box → proper airport lettering on the roofline (backlit channel letters at
 * night)".
 *
 * THE GLASS. One texture, sixteen 6 m bays (96 m) by two 6 m storeys, so the
 * pattern repeats every 96 m rather than every bay:
 *   by day   dark blue-grey tinted glass, lighter where it catches the sky at
 *            the top of each storey, a dark floor slab between the storeys,
 *            light mullions every 1.5 m pane and heavier ones at each bay,
 *            and — faintly — the lit zones and columns behind the glass
 *   by night (the emissive twin) black, except the zones that are open:
 *            gate lounges on the upper (departures) floor in runs of two to
 *            four bays, a few shops below, each with a row of ceiling lights
 *            along its top, light falling off down the room, the columns
 *            standing dark against it, and the frames blocking the light
 * About two bays in five are lit upstairs and one in four downstairs — the
 * "only SOME" — and which ones is fixed (zoneFor), so it never flickers.
 *
 * THE NAME. Each letter cut out on a transparent texture, the face lit from
 * behind at night (channelLetters): the board in a frame it replaces read as
 * a plain box.
 */

import { canvas, canvasTexture } from './airport-kit.js';

/** The glazing texture's size in the world. */
export const BAY_M = 6;
export const BAYS = 16;
export const STOREY_M = 6;
export const TILE_W_M = BAY_M * BAYS;
export const TILE_H_M = STOREY_M * 2;

/**
 * What is behind the glass in bay `i` (0..15), storey `s` (0 = ground,
 * 1 = upper). Fixed, so the same rooms are lit every night.
 *   'lounge'  a gate lounge: warm white, ceiling lights, columns
 *   'shop'    a shop or a café: brighter, warmer, a coloured fascia
 *   'dim'     a corridor at night: faint cool light
 *   'dark'    closed
 */
export function zoneFor(i, s) {
  const UP = ['lounge', 'lounge', 'lounge', 'dark', 'dim', 'lounge', 'lounge', 'dark', 'dark', 'lounge', 'lounge', 'lounge', 'lounge', 'dark', 'dim', 'dark'];
  const DOWN = ['dark', 'shop', 'dark', 'dim', 'dark', 'dark', 'shop', 'shop', 'dark', 'dim', 'dark', 'dark', 'shop', 'dark', 'dim', 'dark'];
  const k = ((i % BAYS) + BAYS) % BAYS;
  return (s ? UP : DOWN)[k];
}

/** Of the 32 bay-storeys, how many have a lit room behind them. */
export function litFraction() {
  let n = 0;
  for (let s = 0; s < 2; s++) for (let i = 0; i < BAYS; i++) if (/lounge|shop/.test(zoneFor(i, s))) n++;
  return n / (BAYS * 2);
}

const SHOP_FASCIA = ['#c8402e', '#2f6fb3', '#2f8f5b', '#d99a1e'];

let cache = null;

/**
 * The day map and the night emissive map, made once. `small` (the Low tier)
 * draws them at half the size: the same rooms, the same frames, a quarter of
 * the memory.
 */
export function glazingTextures(small = false) {
  const key = small ? 'small' : 'full';
  if (cache && cache[key]) return cache[key];
  const BP = small ? 64 : 128; // pixels a bay
  const SP = small ? 64 : 128; // pixels a storey
  const W = BP * BAYS;
  const H = SP * 2;
  const day = canvas(W, H);
  const night = canvas(W, H);
  const d = day.getContext('2d');
  const n = night.getContext('2d');
  const k = BP / 128;
  const pane = BP / 4; // 1.5 m panes

  /* ---- by day: dark tinted glass ---- */
  for (let s = 0; s < 2; s++) {
    // Canvas y runs down: the upper storey (s = 1) is the top half.
    const y0 = (1 - s) * SP;
    const g = d.createLinearGradient(0, y0, 0, y0 + SP);
    g.addColorStop(0, '#5b7181');
    g.addColorStop(0.35, '#344753');
    g.addColorStop(1, '#1b262d');
    d.fillStyle = g;
    d.fillRect(0, y0, W, SP);
    for (let i = 0; i < BAYS; i++) {
      const z = zoneFor(i, s);
      const x0 = i * BP;
      // The room behind, just showing through the tint.
      if (z === 'lounge' || z === 'shop') {
        d.fillStyle = z === 'shop' ? 'rgba(255, 226, 170, 0.10)' : 'rgba(255, 238, 205, 0.07)';
        d.fillRect(x0, y0 + 10 * k, BP, SP - 20 * k);
        d.fillStyle = 'rgba(10, 14, 18, 0.35)';
        d.fillRect(x0 + BP / 2 - 3 * k, y0 + 12 * k, 6 * k, SP - 22 * k);
      }
      // Pane to pane, the reflection shifts a little.
      for (let p = 0; p < 4; p++) {
        const v = ((i * 7 + p * 3 + s * 5) % 9) / 9;
        d.fillStyle = `rgba(${v > 0.5 ? '210,226,238' : '8,14,20'}, ${0.03 + (Math.abs(v - 0.5) * 0.07).toFixed(3)})`;
        d.fillRect(x0 + p * pane, y0, pane, SP);
      }
    }
    // A long diagonal sheen across the storey.
    const sh = d.createLinearGradient(0, y0, W * 0.2, y0 + SP);
    sh.addColorStop(0, 'rgba(220,235,245,0)');
    sh.addColorStop(0.48, 'rgba(220,235,245,0.10)');
    sh.addColorStop(0.52, 'rgba(220,235,245,0.10)');
    sh.addColorStop(1, 'rgba(220,235,245,0)');
    d.fillStyle = sh;
    d.fillRect(0, y0, W, SP);
  }

  /* ---- by night: only the rooms that are open ---- */
  n.fillStyle = '#000000';
  n.fillRect(0, 0, W, H);
  for (let s = 0; s < 2; s++) {
    const y0 = (1 - s) * SP;
    for (let i = 0; i < BAYS; i++) {
      const z = zoneFor(i, s);
      const x0 = i * BP;
      if (z === 'dark') {
        // An exit sign, now and then, deep inside.
        if ((i + s) % 5 === 0) {
          n.fillStyle = 'rgba(60, 220, 120, 0.55)';
          n.fillRect(x0 + BP * 0.7, y0 + 22 * k, 8 * k, 4 * k);
        }
        continue;
      }
      if (z === 'dim') {
        const g = n.createLinearGradient(0, y0, 0, y0 + SP);
        g.addColorStop(0, 'rgba(120, 140, 165, 0.28)');
        g.addColorStop(1, 'rgba(40, 50, 60, 0.08)');
        n.fillStyle = g;
        n.fillRect(x0, y0 + 10 * k, BP, SP - 20 * k);
        continue;
      }
      const shop = z === 'shop';
      // Light falling off from the ceiling to the floor.
      const g = n.createLinearGradient(0, y0 + 8 * k, 0, y0 + SP - 10 * k);
      g.addColorStop(0, shop ? 'rgba(255, 238, 205, 0.98)' : 'rgba(255, 236, 200, 0.85)');
      g.addColorStop(0.45, shop ? 'rgba(240, 200, 140, 0.75)' : 'rgba(225, 190, 140, 0.55)');
      g.addColorStop(1, shop ? 'rgba(150, 105, 60, 0.55)' : 'rgba(110, 82, 50, 0.38)');
      n.fillStyle = g;
      n.fillRect(x0, y0 + 8 * k, BP, SP - 18 * k);
      // The shop's fascia, a coloured band under the ceiling.
      if (shop) {
        n.fillStyle = SHOP_FASCIA[i % SHOP_FASCIA.length];
        n.fillRect(x0 + 6 * k, y0 + 16 * k, BP - 12 * k, 12 * k);
      }
      // Ceiling lights: a row of bright points along the top of the room.
      n.fillStyle = 'rgba(255, 252, 240, 1)';
      for (let x = x0 + 8 * k; x < x0 + BP - 4 * k; x += 16 * k) n.fillRect(x, y0 + 10 * k, 6 * k, 3 * k);
      // A second row, further back, fainter: the room has depth.
      n.fillStyle = 'rgba(255, 245, 220, 0.55)';
      for (let x = x0 + 16 * k; x < x0 + BP - 4 * k; x += 16 * k) n.fillRect(x, y0 + 18 * k, 4 * k, 2 * k);
      // The columns, dark against the light, one a bay and a thinner one back.
      n.fillStyle = 'rgba(8, 6, 4, 0.92)';
      n.fillRect(x0 + BP / 2 - 4 * k, y0 + 13 * k, 8 * k, SP - 23 * k);
      n.fillStyle = 'rgba(8, 6, 4, 0.55)';
      n.fillRect(x0 + BP * 0.12, y0 + 22 * k, 4 * k, SP - 32 * k);
      // Seats and people as a low dark band in a lounge.
      if (!shop) {
        n.fillStyle = 'rgba(20, 14, 8, 0.5)';
        n.fillRect(x0, y0 + SP - 34 * k, BP, 12 * k);
      }
    }
  }

  /* ---- the frames, on both: slabs, transoms, mullions ---- */
  for (const [ctx, lit] of [[d, false], [n, true]]) {
    const frame = lit ? '#020202' : '#8b949b';
    const slab = lit ? '#000000' : '#262b30';
    for (let s = 0; s < 2; s++) {
      const y0 = (1 - s) * SP;
      // The floor slab's edge at the foot of each storey, and the ceiling void.
      ctx.fillStyle = slab;
      ctx.fillRect(0, y0 + SP - 10 * k, W, 10 * k);
      ctx.fillRect(0, y0, W, 6 * k);
      ctx.fillStyle = frame;
      // A transom a third of the way up.
      ctx.fillRect(0, y0 + SP * 0.62, W, 2 * k);
    }
    for (let x = 0; x <= W; x += pane) {
      const bay = Math.round(x / BP) * BP === x;
      ctx.fillStyle = frame;
      ctx.fillRect(x - (bay ? 3 : 1.5) * k, 0, (bay ? 6 : 3) * k, H);
    }
  }

  const out = {
    day: canvasTexture(day, { repeat: true }),
    night: canvasTexture(night, { repeat: true }),
    widthM: TILE_W_M,
    heightM: TILE_H_M,
  };
  cache = cache || {};
  cache[key] = out;
  return out;
}

/**
 * The airport's name as channel letters: each letter on its own, cut out of
 * a transparent texture, white faces with a thin dark return round them
 * (the depth of a real letter's side, drawn), so they read as letters on the
 * roof, not a sign on a board. `glow` is the same shapes, for the emissive
 * map, lit from behind at night.
 *
 *   { tex, aspect }  aspect = width / height of the lettering
 */
export function channelLetters(text) {
  const H = 128;
  const font = 'bold 92px Arial, Helvetica, sans-serif';
  const probe = canvas(8, 8).getContext('2d');
  probe.font = font;
  const track = 10;
  let w = 0;
  for (const ch of text) w += (probe.measureText ? probe.measureText(ch).width || 56 : 56) + track;
  w = Math.max(64, Math.ceil(w + 24));
  // Keep it a sane texture: a long name is drawn narrower, not wider.
  const W = Math.min(4096, w);
  const sx = W / w;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.scale(sx, 1);
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  let x = 12;
  for (const ch of text) {
    const cw = probe.measureText ? probe.measureText(ch).width || 56 : 56;
    // The letter's return (its side), a dark rim, offset down and right.
    ctx.fillStyle = '#20262c';
    ctx.fillText(ch, x + 3, H / 2 + 6);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#3a434b';
    ctx.strokeText(ch, x, H / 2 + 3);
    // The face.
    ctx.fillStyle = '#f4f7fa';
    ctx.fillText(ch, x, H / 2 + 3);
    x += cw + track;
  }
  ctx.restore();
  const tex = canvasTexture(c);
  tex.anisotropy = 4;
  return { tex, aspect: w / H };
}
